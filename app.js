// ─────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────
const CONFIG = { SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyjI1dk1DEsVnlNEGwaALYMRKNiteJqxRFWSO29FCmHl6u139XLfQibZndYmjG5fZfNnA/exec' };

const MESES_N = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const COLORES = [
  {bg:'#CBF0E2',text:'#0A5E48'},{bg:'#D2E5F9',text:'#183E7A'},
  {bg:'#E5DDFB',text:'#3D1F8A'},{bg:'#FDEABF',text:'#6B3F07'},
  {bg:'#FBDADA',text:'#721B1B'},{bg:'#F0E4FB',text:'#6B1B8F'},
];

// ── Caché ─────────────────────────────────────────────────────────
const CACHE_KEY = 'pp_v1';
const CACHE_TTL = 5 * 60 * 1000;

function cacheGuardar(d) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({...d, _ts: Date.now()})); } catch {}
}
function cacheLeer() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function cacheEsFresca(c) { return c && c._ts && (Date.now() - c._ts) < CACHE_TTL; }
function cacheAplicar(c) {
  S.meta     = c.meta     || { monto: 0, desc: '' };
  S.personas = c.personas || [];
  S.fuentes  = c.fuentes  || [];
  S.nextId   = c.nextId   || 1;
  S.loaded   = true;
}

// ── Estado ────────────────────────────────────────────────────────
let S = {
  meta: { monto: 0, desc: '' },
  personas: [],
  fuentes: [],
  nextId: 1,
  filtro: 'todas',
  tabActivo: 'lista',
  loaded: false,
  usandoCache: false,
};

// ── Personas ──────────────────────────────────────────────────────
function initPersonas() {
  if (!S.personas) S.personas = [];
  if (!S.personas.length)
    S.personas.push({ id: S.nextId++, nombre: 'PROPIO', tipo_defecto: 'propio' });
}

function migrarFuentes() {
  S.fuentes.forEach(f => {
    if (f.personaId) return;
    const nombre = f.nombre || 'SIN NOMBRE';
    let p = S.personas.find(x => x.nombre === nombre);
    if (!p) {
      p = { id: S.nextId++, nombre, tipo_defecto: f.tipo === 'propio' ? 'propio' : 'prestamo' };
      S.personas.push(p);
    }
    f.personaId = p.id;
  });
}

function getPersona(pid) { return S.personas.find(p => p.id === pid); }

// ── API Google Sheets ─────────────────────────────────────────────
async function apiCall(action, data={}) {
  if (!CONFIG.SCRIPT_URL) return null;
  setSyncStatus('syncing', 'Sincronizando...');
  try {
    const url = CONFIG.SCRIPT_URL + '?action=' + action;
    const res  = await fetch(url, { method:'POST', body: JSON.stringify(data) });
    const json = await res.json();
    setSyncStatus('ok', 'Sincronizado');
    return json;
  } catch(e) {
    setSyncStatus('error', 'Error al sincronizar');
    return null;
  }
}

async function cargarDatos() {
  if (!CONFIG.SCRIPT_URL) {
    setSyncStatus('error', 'Sin configurar');
    renderSetupBanner();
    render();
    return;
  }
  const cached = cacheLeer();
  if (cacheEsFresca(cached)) {
    cacheAplicar(cached); initPersonas(); migrarFuentes();
    setSyncStatus('ok', 'Datos en caché');
    render();
    return;
  }
  if (cached) { cacheAplicar(cached); initPersonas(); migrarFuentes(); render(); setSyncStatus('syncing', 'Actualizando...'); }
  else          setSyncStatus('syncing', 'Cargando...');

  const data = await apiCall('getData');
  if (data && data.ok) {
    S.meta     = data.meta     || { monto: 0, desc: '' };
    S.personas = data.personas || [];
    S.fuentes  = data.fuentes  || [];
    S.nextId   = data.nextId   || 1;
    S.loaded   = true;
    S.usandoCache = false;
    initPersonas(); migrarFuentes();
    cacheGuardar({ meta:S.meta, personas:S.personas, fuentes:S.fuentes, nextId:S.nextId });
    setSyncStatus('ok', 'Sincronizado');
  } else {
    S.usandoCache = !!cached;
    if (!cached) setSyncStatus('error', 'No se pudo cargar');
  }
  render();
}

async function guardarTodo() {
  if (!CONFIG.SCRIPT_URL) return;
  const payload = { meta:S.meta, personas:S.personas, fuentes:S.fuentes, nextId:S.nextId };
  const result = await apiCall('saveData', payload);
  if (result && result.ok) cacheGuardar(payload);
}

function setSyncStatus(tipo, texto) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  if (!dot) return;
  dot.className = 'sync-dot' + (tipo !== 'ok' ? ' ' + tipo : '');
  txt.textContent = texto;
}

// ── Helpers ───────────────────────────────────────────────────────
function fmt(n)       { return '$' + Math.round(n).toLocaleString('es-CO'); }
function fechaDisp(f) { if(!f) return ''; const [y,m,d] = f.split('-'); return `${d}/${m}/${y}`; }
function colorIdx(idx){ return COLORES[idx % COLORES.length]; }

function getCapitalActual(f) {
  const totalAbonos = (f.abonos||[]).reduce((s,a) => s+a.monto, 0);
  return Math.max(0, f.monto - totalAbonos);
}

function getCuotaMes(f, mes, anio) {
  if (f.tipo === 'propio' || !f.tasa_pct) return 0;
  const abonosAntes = (f.abonos||[]).filter(a => {
    const [ay,am] = a.fecha.split('-').map(Number);
    return ay < anio || (ay === anio && am < mes);
  }).reduce((s,a) => s+a.monto, 0);
  return Math.round(Math.max(0, f.monto - abonosAntes) * f.tasa_pct / 100);
}

function getMesesFuente(f) {
  if (f.tipo === 'propio' || !f.tasa_pct) return [];
  const ocultos  = f.mesesOcultos || [];
  const esOculto = (m,y) => ocultos.some(o => o.mes===m && o.anio===y);
  const inicio   = new Date(f.fecha+'T00:00:00');
  const hoy      = new Date();
  let y = inicio.getFullYear(), m = inicio.getMonth()+2;
  if (m>12) { m=1; y++; }
  const hy = hoy.getFullYear(), hm = hoy.getMonth()+1;
  const result = [];
  while (y < hy || (y===hy && m<=hm)) {
    if (!esOculto(m,y)) {
      const cuota = (f.cuotas||[]).find(c => c.mes===m && c.anio===y) || null;
      result.push({mes:m, anio:y, cuota});
    }
    m++; if (m>12) { m=1; y++; }
  }
  (f.cuotas||[]).forEach(c => {
    const esFuturo = c.anio>hy || (c.anio===hy && c.mes>hm);
    if (esFuturo && !esOculto(c.mes,c.anio) && !result.find(r => r.mes===c.mes && r.anio===c.anio))
      result.push({mes:c.mes, anio:c.anio, cuota:c});
  });
  result.sort((a,b) => a.anio!==b.anio ? a.anio-b.anio : a.mes-b.mes);
  return result;
}

function fuentesFiltradas() {
  if (S.filtro==='interes') return S.fuentes.filter(f => f.tipo==='prestamo');
  if (S.filtro==='propio')  return S.fuentes.filter(f => f.tipo==='propio');
  return S.fuentes;
}

// ── Stats ─────────────────────────────────────────────────────────
function calcStats() {
  const hoy = new Date();
  const hy  = hoy.getFullYear(), hm = hoy.getMonth()+1;
  let recaudado=0, interesMensual=0, pagadoMes=0, pendienteMes=0;

  S.fuentes.forEach(f => {
    recaudado      += f.monto;
    interesMensual += getCuotaMes(f, hm, hy);
    if (f.tipo==='propio') return;
    const ini = new Date(f.fecha+'T00:00:00');
    let fcm = ini.getMonth()+2, fcy = ini.getFullYear();
    if (fcm>12) { fcm=1; fcy++; }
    if (!(hy>fcy || (hy===fcy && hm>=fcm))) return;
    const cuotaMes = (f.cuotas||[]).find(c => c.mes===hm && c.anio===hy);
    if (cuotaMes) {
      if (cuotaMes.estado==='pagado') pagadoMes   += cuotaMes.monto;
      else                            pendienteMes += cuotaMes.monto;
    } else {
      pendienteMes += getCuotaMes(f, hm, hy);
    }
  });

  const falta = Math.max(0, S.meta.monto - recaudado);
  const pct   = S.meta.monto>0 ? Math.min(100, Math.round(recaudado/S.meta.monto*100)) : 0;
  return { recaudado, interesMensual, pagadoMes, pendienteMes, falta, pct, hm, hy };
}

// ── Render ────────────────────────────────────────────────────────
function render() {
  renderSetupBanner();
  renderMeta();
  renderSummary();
  renderCacheBanner();
  renderTabs();
  renderContenido();
}

function renderSetupBanner() {
  const el = document.getElementById('setup-banner');
  if (CONFIG.SCRIPT_URL) { el.innerHTML=''; return; }
  el.innerHTML=`<div class="banner setup" style="margin-bottom:16px">
    <div>
      <div class="banner-text"><i class="ti ti-table" style="vertical-align:-2px;margin-right:5px"></i>Conecta tu Google Sheets para guardar los datos</div>
      <div class="banner-sub">Sin conexión, los datos se pierden al cerrar el navegador</div>
    </div>
    <button class="btn-setup" onclick="abrirSetup()">Configurar →</button>
  </div>`;
}

function renderMeta() {
  const el = document.getElementById('meta-section');
  if (!S.meta.monto) {
    el.innerHTML=`<div class="banner setup" style="margin-bottom:16px">
      <div>
        <div class="banner-text"><i class="ti ti-target" style="vertical-align:-2px;margin-right:5px"></i>Define tu meta de recaudación para empezar</div>
        <div class="banner-sub">¿Cuánto dinero necesitas juntar en total?</div>
      </div>
      <button class="btn-setup" onclick="abrirMeta()">Definir meta →</button>
    </div>`;
    return;
  }
  const s = calcStats();
  el.innerHTML=`<div class="meta-card">
    <div class="meta-top">
      <div>
        <div class="meta-label"><i class="ti ti-target" style="font-size:12px;vertical-align:-1px;margin-right:4px"></i>Meta${S.meta.desc?' · '+S.meta.desc:''}</div>
        <div class="meta-monto">${fmt(S.meta.monto)}</div>
      </div>
      <button class="meta-edit-btn" onclick="abrirMeta()" title="Editar meta"><i class="ti ti-edit"></i></button>
    </div>
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%"></div></div>
      <div class="progress-labels">
        <span class="progress-pct">${s.pct}% recaudado · ${fmt(s.recaudado)}</span>
        <span class="progress-falta">${fmt(s.falta)} faltante</span>
      </div>
    </div>
  </div>`;
}

function renderSummary() {
  const s = calcStats();
  document.getElementById('summary').innerHTML=`
    <div class="metric"><div class="metric-label">Total recaudado</div><div class="metric-value green">${fmt(s.recaudado)}</div></div>
    <div class="metric"><div class="metric-label">Interés mensual</div><div class="metric-value red">${fmt(s.interesMensual)}</div></div>
    <div class="metric metric-mes">
      <div class="metric-label">${MESES_N[s.hm-1]} ${s.hy}</div>
      <div class="metric-mes-row">
        <div class="metric-mes-item">
          <div class="metric-mes-sub">Pagado</div>
          <div class="metric-value green">${fmt(s.pagadoMes)}</div>
        </div>
        <div class="metric-mes-sep"></div>
        <div class="metric-mes-item">
          <div class="metric-mes-sub">Por pagar</div>
          <div class="metric-value red">${fmt(s.pendienteMes)}</div>
        </div>
      </div>
    </div>`;
}

function renderCacheBanner() {
  const el = document.getElementById('cache-banner');
  if (S.usandoCache) {
    el.innerHTML=`<div class="banner amber" style="margin-bottom:16px">
      <div>
        <div class="banner-text"><i class="ti ti-wifi-off" style="vertical-align:-2px;margin-right:5px"></i>Sin conexión con Google Sheets</div>
        <div class="banner-sub">Mostrando datos guardados localmente · Los cambios no se guardarán hasta reconectar</div>
      </div>
    </div>`;
  } else { el.innerHTML=''; }
}

function renderTabs() {
  const enLista = S.tabActivo !== 'historial';
  const segHtml = `<div class="seg-ctrl">
    <button class="seg-btn${enLista&&S.filtro==='todas'?' active':''}"   onclick="setFiltro('todas')">Todas</button>
    <button class="seg-btn${enLista&&S.filtro==='interes'?' active':''}" onclick="setFiltro('interes')">Con interés</button>
    <button class="seg-btn${enLista&&S.filtro==='propio'?' active':''}"  onclick="setFiltro('propio')">Propios</button>
  </div>`;
  const histHtml = `<button class="hist-btn${S.tabActivo==='historial'?' active':''}" onclick="setTab('historial')">
    <i class="ti ti-history" style="font-size:12px"></i> Historial
  </button>`;
  document.getElementById('tabs').innerHTML =
    `<div class="filtros-bar">${segHtml}<span class="filtros-gap"></span>${histHtml}</div>`;
}

function setFiltro(f) { S.filtro=f; S.tabActivo='lista'; renderTabs(); renderContenido(); }
function setTab(t)    { S.tabActivo=t; renderTabs(); renderContenido(); }

function renderFuenteCard(f) {
  const capitalActual = getCapitalActual(f);
  const esPropio      = f.tipo === 'propio';
  const hoy           = new Date();
  const interesActual = getCuotaMes(f, hoy.getMonth()+1, hoy.getFullYear());

  const tipoBadge = esPropio
    ? `<span class="tipo-badge propio">Sin interés</span>`
    : `<span class="tipo-badge prestamo">${f.tasa_pct}% mensual</span>`;

  const etiqueta = f.desc
    ? `<span class="fuente-desc">${f.desc}</span>`
    : `<span class="fuente-desc" style="color:var(--text3)">${fechaDisp(f.fecha)}</span>`;

  const abonosHtml = (f.abonos||[]).length
    ? `<div class="abonos-wrap">${(f.abonos||[]).map(a =>
        `<div class="abono-item">
          <span class="abono-desc"><i class="ti ti-corner-down-right" style="font-size:10px;margin-right:3px;color:var(--text3)"></i>${a.desc||fechaDisp(a.fecha)}</span>
          <span class="abono-monto">-${fmt(a.monto)}</span>
        </div>`).join('')}</div>`
    : '';

  let bodyHtml = '';
  if (!esPropio) {
    const meses = getMesesFuente(f);
    const mesesHtml = meses.map(({mes,anio,cuota}) => {
      const pagado  = cuota && cuota.estado==='pagado';
      const clase   = pagado ? 'pagado' : cuota ? cuota.estado : 'sin-cuota';
      const monto   = cuota ? cuota.monto : getCuotaMes(f, mes, anio);
      const chkClass= pagado ? ' pagado' : '';
      const chkIcon = pagado ? '<i class="ti ti-check"></i>' : '';
      const chkClick= pagado
        ? `desmarcarCuota(${f.id},${mes},${anio})`
        : `abrirPagarCuota(${f.id},${mes},${anio})`;
      const delBtn  = cuota
        ? `<button class="icon-btn" onclick="eliminarCuota(${f.id},'${cuota.id}')" title="Eliminar"><i class="ti ti-x"></i></button>`
        : `<button class="icon-btn" onclick="ocultarMesFuente(${f.id},${mes},${anio})" title="Ocultar"><i class="ti ti-x"></i></button>`;
      return `<div class="mes-row ${clase}">
        <div class="mes-left">
          <button class="chk-btn${chkClass}" onclick="${chkClick}" title="${pagado?'Desmarcar':'Registrar pago'}">${chkIcon}</button>
          <span class="mes-name">${MESES_C[mes-1]} ${anio}</span>
        </div>
        <div class="mes-right">
          <span class="mes-monto">${fmt(monto)}</span>
          ${delBtn}
        </div>
      </div>`;
    }).join('') || '<div style="font-size:12px;color:var(--text3);padding:4px 0">Sin cuotas aún</div>';

    bodyHtml = `<div class="pcard-body">
      ${mesesHtml}
      <button class="btn-add-mes" onclick="abrirPagarProximoMes(${f.id})"><i class="ti ti-plus" style="font-size:12px"></i> Agregar mes</button>
    </div>`;
  }

  return `<div class="pcard">
    <div class="pcard-head">
      <div class="pcard-info">
        <div class="pcard-nombre-row">
          ${tipoBadge}${etiqueta}
        </div>
        <div class="pcard-cuota" style="margin-top:3px">${fmt(f.monto)}${!esPropio&&capitalActual<f.monto?` · Saldo: <strong style="color:var(--green-mid)">${fmt(capitalActual)}</strong>`:''}</div>
        ${!esPropio?`<div class="pcard-desde"><span style="color:var(--red-mid);font-weight:600">${fmt(interesActual)}/mes</span> · desde ${fechaDisp(f.fecha)}</div>`:`<div class="pcard-desde">Ingresado ${fechaDisp(f.fecha)}</div>`}
        ${abonosHtml}
      </div>
      <div class="pcard-actions">
        ${!esPropio?`<button class="icon-btn pcard-btn-cash" onclick="abrirAbonar(${f.id})" title="Abonar a capital"><i class="ti ti-trending-down"></i></button>`:''}
        <button class="icon-btn pcard-btn-del" onclick="eliminarFuente(${f.id})" title="Eliminar fuente"><i class="ti ti-trash"></i></button>
      </div>
    </div>
    ${bodyHtml}
  </div>`;
}

function renderContenido() {
  if (S.tabActivo==='historial') { renderHistorial(); return; }
  const fuentes = fuentesFiltradas();
  const el = document.getElementById('contenido');
  if (!fuentes.length) {
    el.innerHTML='<div class="empty"><i class="ti ti-building-bank"></i>No hay fuentes registradas</div>';
    return;
  }

  // Agrupar por persona
  const grupos = {};
  fuentes.forEach(f => {
    const pid = f.personaId || 0;
    if (!grupos[pid]) grupos[pid] = [];
    grupos[pid].push(f);
  });

  el.innerHTML = Object.entries(grupos).map(([pidStr, fs]) => {
    const pid     = parseInt(pidStr);
    const persona = getPersona(pid);
    const nombre  = persona ? persona.nombre : 'Sin persona';
    const pi      = S.personas.indexOf(persona);
    const color   = colorIdx(pi >= 0 ? pi : 0);
    const ini     = nombre.split(/[\s\/]+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
    const hoy     = new Date();
    const totalMonto   = fs.reduce((s,f) => s+f.monto, 0);
    const interesTotal = fs.reduce((s,f) => s+getCuotaMes(f,hoy.getMonth()+1,hoy.getFullYear()), 0);

    return `<div class="responsable-block">
      <div class="resp-header">
        <div class="resp-avatar" style="background:${color.bg};color:${color.text}">${ini}</div>
        <div style="flex:1;min-width:0">
          <div class="resp-name">${nombre}</div>
          <div class="resp-info">${fs.length} fuente${fs.length>1?'s':''} · ${fmt(totalMonto)}${interesTotal>0?' · <span style="color:var(--red-mid)">'+fmt(interesTotal)+'/mes</span>':''}</div>
        </div>
        <button class="icon-btn" onclick="abrirNuevaFuente(${pid})" title="Agregar fuente a ${nombre}" style="width:28px;height:28px;background:var(--surface2);color:var(--text2)"><i class="ti ti-plus"></i></button>
      </div>
      <div class="fuentes-lista">${fs.map(f => renderFuenteCard(f)).join('')}</div>
    </div>`;
  }).join('');
}

function renderHistorial() {
  const el = document.getElementById('contenido');
  const eventos = [];
  S.fuentes.forEach(f => {
    eventos.push({ tipo:'ingreso', fecha:f.fecha, monto:f.monto, nombre:f.nombre, esPropio:f.tipo==='propio' });
    (f.cuotas||[]).forEach(c => {
      const fd = c.fecha_pago || (c.anio+'-'+String(c.mes).padStart(2,'0')+'-01');
      eventos.push({ tipo:'cuota', fecha:fd, mes:c.mes, anio:c.anio, monto:c.monto, estado:c.estado, fuente:f.nombre });
    });
    (f.abonos||[]).forEach(a => {
      eventos.push({ tipo:'abono', fecha:a.fecha, monto:a.monto, desc:a.desc||'Abono', fuente:f.nombre });
    });
  });
  if (!eventos.length) {
    el.innerHTML='<div class="empty"><i class="ti ti-history"></i>Sin historial registrado</div>';
    return;
  }
  eventos.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  const grupos = {};
  eventos.forEach(e => {
    const d = new Date(e.fecha+'T00:00:00');
    const k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if (!grupos[k]) grupos[k]=[];
    grupos[k].push(e);
  });
  el.innerHTML = Object.entries(grupos).sort((a,b) => b[0].localeCompare(a[0])).map(([k,evs]) => {
    const [y,m] = k.split('-').map(Number);
    const rows = evs.map(e => {
      if (e.tipo==='ingreso') return `<div class="hist-row">
        <div class="hist-icon ingreso"><i class="ti ti-arrow-down-circle"></i></div>
        <div class="hist-info"><div class="hist-title">${e.nombre}</div><div class="hist-sub">${e.esPropio?'Recursos propios':'Préstamo recibido'}</div></div>
        <div class="hist-right"><span class="hist-monto ingreso">${fmt(e.monto)}</span><span class="hist-badge ingreso">Ingreso</span></div>
      </div>`;
      if (e.tipo==='cuota') {
        const icon = e.estado==='pagado' ? 'ti-check' : 'ti-clock';
        return `<div class="hist-row">
          <div class="hist-icon ${e.estado}"><i class="ti ${icon}"></i></div>
          <div class="hist-info"><div class="hist-title">${e.fuente}</div><div class="hist-sub">Interés ${MESES_N[e.mes-1]} ${e.anio}</div></div>
          <div class="hist-right"><span class="hist-monto ${e.estado}">${fmt(e.monto)}</span><span class="hist-badge ${e.estado}">${e.estado.charAt(0).toUpperCase()+e.estado.slice(1)}</span></div>
        </div>`;
      }
      if (e.tipo==='abono') return `<div class="hist-row">
        <div class="hist-icon abono"><i class="ti ti-arrow-up-circle"></i></div>
        <div class="hist-info"><div class="hist-title">${e.fuente}</div><div class="hist-sub">${e.desc}</div></div>
        <div class="hist-right"><span class="hist-monto abono">-${fmt(e.monto)}</span><span class="hist-badge abono">Abono</span></div>
      </div>`;
    }).join('');
    return `<div class="hist-grupo"><div class="hist-mes-label">${MESES_N[m-1]} ${y}</div>${rows}</div>`;
  }).join('');
}

// ── Acciones ──────────────────────────────────────────────────────
function abrirPagarCuota(fid, mes, anio) {
  const f       = S.fuentes.find(x => x.id===fid);
  const cuota   = (f.cuotas||[]).find(c => c.mes===mes && c.anio===anio);
  const interes = cuota ? cuota.monto : getCuotaMes(f, mes, anio);
  modal(`Registrar pago — ${MESES_N[mes-1]} ${anio}`,
    `<div style="background:var(--red-bg);border:1px solid var(--red-border);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;color:var(--red);font-weight:500"><i class="ti ti-alert-circle" style="vertical-align:-2px;margin-right:4px"></i>Interés mínimo</span>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:17px;font-weight:700;color:var(--red-mid)">${fmt(interes)}</span>
    </div>
    <div class="form-group">
      <label>¿Cuánto vas a pagar?</label>
      <input id="pp-monto" type="number" placeholder="${interes}" oninput="actualizarPreviewPago(${interes})" autofocus>
    </div>
    <div id="pp-preview" class="pp-preview-box">Ingresa un monto para ver el desglose</div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarPagoCuota(${fid},${mes},${anio},${interes})">Registrar pago</button>`
  );
}

function actualizarPreviewPago(interes) {
  const monto = parseFloat(document.getElementById('pp-monto')?.value) || 0;
  const el    = document.getElementById('pp-preview');
  if (!el) return;
  if (!monto) { el.textContent='Ingresa un monto para ver el desglose'; el.className='pp-preview-box'; return; }
  if (monto < interes) {
    el.innerHTML=`<i class="ti ti-alert-circle" style="vertical-align:-2px;margin-right:4px"></i>Faltan <strong>${fmt(interes-monto)}</strong> para cubrir el interés`;
    el.className='pp-preview-box warn';
  } else {
    const abono = monto - interes;
    el.innerHTML=`<i class="ti ti-check" style="vertical-align:-2px;margin-right:4px"></i>${fmt(interes)} a interés${abono>0?` · <strong>${fmt(abono)}</strong> abono a capital`:''}`;
    el.className='pp-preview-box ok';
  }
}

async function guardarPagoCuota(fid, mes, anio, interes) {
  const monto = parseFloat(document.getElementById('pp-monto')?.value) || 0;
  if (!monto) { alert('Ingresa un monto'); return; }
  const f     = S.fuentes.find(x => x.id===fid);
  const hoy   = new Date().toISOString().split('T')[0];
  const estado= monto >= interes ? 'pagado' : 'pendiente';
  if (!f.cuotas) f.cuotas=[];
  let cuota = f.cuotas.find(c => c.mes===mes && c.anio===anio);
  if (cuota) {
    cuota.estado=estado; cuota.fecha_pago=estado==='pagado'?hoy:null;
  } else {
    f.cuotas.push({ id:'q'+S.nextId++, mes, anio, monto:interes, estado, fecha_pago:estado==='pagado'?hoy:null });
  }
  if (monto > interes) {
    if (!f.abonos) f.abonos=[];
    f.abonos.push({ id:'a'+S.nextId++, monto:monto-interes, fecha:hoy, desc:`Abono ${MESES_C[mes-1]} ${anio}` });
    f.abonos.sort((a,b) => a.fecha.localeCompare(b.fecha));
  }
  cerrar(); render(); await guardarTodo();
}

async function desmarcarCuota(fid, mes, anio) {
  const f     = S.fuentes.find(x => x.id===fid);
  const cuota = (f.cuotas||[]).find(c => c.mes===mes && c.anio===anio);
  if (cuota) { cuota.estado='pendiente'; cuota.fecha_pago=null; }
  render(); await guardarTodo();
}

function abrirPagarProximoMes(fid) {
  const f     = S.fuentes.find(x => x.id===fid);
  const meses = getMesesFuente(f);
  let nm, ny;
  if (meses.length) {
    const last=meses[meses.length-1]; nm=last.mes+1; ny=last.anio;
    if (nm>12) { nm=1; ny++; }
  } else {
    const hoy=new Date(); nm=hoy.getMonth()+2; ny=hoy.getFullYear();
    if (nm>12) { nm=1; ny++; }
  }
  abrirPagarCuota(fid, nm, ny);
}

async function eliminarCuota(fid, cid) {
  const f = S.fuentes.find(x => x.id===fid);
  if (!f.mesesOcultos) f.mesesOcultos=[];
  const cuota = f.cuotas.find(c => c.id===cid);
  if (cuota) f.mesesOcultos.push({mes:cuota.mes, anio:cuota.anio});
  f.cuotas = f.cuotas.filter(c => c.id!==cid);
  render(); await guardarTodo();
}

async function ocultarMesFuente(fid, mes, anio) {
  const f = S.fuentes.find(x => x.id===fid);
  if (!f.mesesOcultos) f.mesesOcultos=[];
  f.mesesOcultos.push({mes, anio});
  render(); await guardarTodo();
}

async function agregarMesSiguiente(fid) {
  const f = S.fuentes.find(x => x.id===fid);
  if (!f.cuotas) f.cuotas=[];
  const meses = getMesesFuente(f);
  let nm, ny;
  if (meses.length) {
    const last = meses[meses.length-1];
    nm=last.mes+1; ny=last.anio;
    if (nm>12) { nm=1; ny++; }
  } else {
    const hoy=new Date(); nm=hoy.getMonth()+2; ny=hoy.getFullYear();
    if (nm>12) { nm=1; ny++; }
  }
  f.cuotas.push({ id:'q'+S.nextId++, mes:nm, anio:ny, monto:getCuotaMes(f,nm,ny), estado:'pendiente', fecha_pago:null });
  render(); await guardarTodo();
}

async function eliminarFuente(id) {
  if (!confirm('¿Eliminar esta fuente?')) return;
  S.fuentes = S.fuentes.filter(x => x.id!==id);
  render(); await guardarTodo();
}

// ── Modales ───────────────────────────────────────────────────────
function cerrar() { document.getElementById('modal').innerHTML=''; }

function modal(titulo, bodyHtml, footHtml) {
  document.getElementById('modal').innerHTML=`
  <div class="overlay" onclick="if(event.target===this)cerrar()">
    <div class="modal">
      <div class="modal-head"><h2>${titulo}</h2><button class="modal-close" onclick="cerrar()"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot">${footHtml}</div>
    </div>
  </div>`;
}

function abrirMeta() {
  modal('Meta de recaudación',
    `<p style="font-size:13px;color:var(--text2);margin-bottom:14px">Define cuánto dinero necesitas juntar y para qué.</p>
    <div class="form-group"><label>Monto objetivo ($)</label><input id="m-monto" type="number" placeholder="20000000" value="${S.meta.monto||''}"></div>
    <div class="form-group"><label>Descripción (opcional)</label><input id="m-desc" type="text" placeholder="Ej: Capital para negocio" value="${S.meta.desc||''}"></div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarMeta()">Guardar</button>`
  );
}

async function guardarMeta() {
  const monto = parseFloat(document.getElementById('m-monto').value)||0;
  const desc  = document.getElementById('m-desc').value.trim();
  if (!monto) { alert('Ingresa un monto'); return; }
  S.meta = {monto, desc};
  cerrar(); render(); await guardarTodo();
}

function abrirNuevaFuente(preselPersonaId = null) {
  const hoy       = new Date().toISOString().split('T')[0];
  const tieneP    = S.personas.length > 0;
  const presel    = preselPersonaId || (tieneP ? S.personas[0].id : null);
  const tipoDefecto = presel ? (getPersona(presel)?.tipo_defecto || 'propio') : 'propio';

  const optsPersona = S.personas.map(p =>
    `<option value="${p.id}"${p.id===presel?' selected':''}>${p.nombre}</option>`
  ).join('');

  const selectHtml = tieneP
    ? `<div class="form-group"><label>¿De quién proviene?</label>
        <select id="f-persona" onchange="onPersonaChange(this.value)">
          ${optsPersona}
          <option value="nueva">+ Nueva persona...</option>
        </select>
       </div>`
    : '';

  modal('Nueva fuente de dinero',
    `${selectHtml}
    <div id="f-nueva-wrap" style="display:none">
      <div class="form-group"><label>Nombre de la persona</label>
        <input id="f-nueva-nombre" type="text" placeholder="Ej: BANCO X, TÍA MARÍA" style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()">
      </div>
    </div>
    <div class="form-group"><label>Tipo</label>
      <select id="f-tipo" onchange="toggleTipoForm(this.value)">
        <option value="propio"${tipoDefecto==='propio'?' selected':''}>Recursos propios — sin interés</option>
        <option value="prestamo"${tipoDefecto==='prestamo'?' selected':''}>Préstamo — genera interés</option>
      </select>
    </div>
    <div class="form-group"><label>Monto ($)</label>
      <input id="f-monto" type="number" placeholder="5000000" oninput="actualizarPreviewFuente()">
    </div>
    <div id="f-tasa-wrap"${tipoDefecto==='propio'?' style="display:none"':''}>
      <div class="form-row">
        <div class="form-group"><label>Tasa mensual (%)</label>
          <input id="f-tasa" type="number" value="2" step="0.1" min="0" oninput="actualizarPreviewFuente()">
        </div>
        <div class="form-group"><label>Interés / mes</label>
          <input id="f-cuota-disp" type="text" readonly placeholder="—" style="background:var(--surface2);color:var(--red-mid);font-family:'IBM Plex Mono',monospace;font-weight:700;cursor:default">
        </div>
      </div>
    </div>
    <div class="form-group"><label>Descripción (opcional)</label>
      <input id="f-desc" type="text" placeholder="Ej: Segunda cuota, Para negocio...">
    </div>
    <div class="form-group"><label>Fecha de ingreso</label>
      <input id="f-fecha" type="date" value="${hoy}">
      <div class="form-hint">El día de esta fecha define cuándo empieza a generar interés</div>
    </div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarFuente()">Guardar</button>`
  );
}

function onPersonaChange(v) {
  document.getElementById('f-nueva-wrap').style.display = v==='nueva' ? 'block' : 'none';
  if (v !== 'nueva') {
    const p = getPersona(parseInt(v));
    if (p) {
      const tipo = p.tipo_defecto || 'propio';
      document.getElementById('f-tipo').value = tipo;
      toggleTipoForm(tipo);
    }
  }
}

function toggleTipoForm(v) {
  document.getElementById('f-tasa-wrap').style.display = v==='propio' ? 'none' : 'block';
}
function actualizarPreviewFuente() {
  const monto = parseFloat(document.getElementById('f-monto')?.value)||0;
  const tasa  = parseFloat(document.getElementById('f-tasa')?.value)||0;
  const el    = document.getElementById('f-cuota-disp');
  if (el) el.value = monto&&tasa ? fmt(Math.round(monto*tasa/100)) : '';
}

async function guardarFuente() {
  const personaEl = document.getElementById('f-persona');
  const pv   = personaEl ? personaEl.value : 'nueva';
  const tipo = document.getElementById('f-tipo').value;
  const monto= parseFloat(document.getElementById('f-monto').value)||0;
  const tasa = tipo==='propio' ? 0 : (parseFloat(document.getElementById('f-tasa')?.value)||0);
  const fecha= document.getElementById('f-fecha').value;
  const desc = document.getElementById('f-desc')?.value.trim() || '';
  if (!monto||!fecha) { alert('Completa el monto y la fecha'); return; }

  let personaId;
  if (pv==='nueva') {
    const nn = document.getElementById('f-nueva-nombre')?.value.trim();
    if (!nn) { alert('Ingresa el nombre de la persona'); return; }
    const np = { id:S.nextId++, nombre:nn, tipo_defecto:tipo };
    S.personas.push(np);
    personaId = np.id;
  } else {
    personaId = parseInt(pv);
  }

  S.fuentes.push({ id:S.nextId++, personaId, tipo, monto, tasa_pct:tasa, fecha, desc, cuotas:[], abonos:[], mesesOcultos:[] });
  cerrar(); render(); await guardarTodo();
}

function abrirAbonar(fid) {
  const f = S.fuentes.find(x => x.id===fid);
  const capitalActual = getCapitalActual(f);
  const hoy = new Date().toISOString().split('T')[0];
  const persona = getPersona(f.personaId);
  const pNombre = persona ? persona.nombre : '';
  modal('Abonar a capital',
    `<p style="font-size:13px;color:var(--text2);margin-bottom:14px">
      <strong>${pNombre}${f.desc?' · '+f.desc:''}</strong> · Capital actual:
      <strong style="font-family:'IBM Plex Mono',monospace;color:var(--green-mid)">${fmt(capitalActual)}</strong>
    </p>
    <div class="form-group"><label>Monto del abono ($)</label>
      <input id="a-monto" type="number" placeholder="500000" oninput="actualizarPreviewAbono(${fid})">
    </div>
    <div class="form-group"><label>Fecha</label>
      <input id="a-fecha" type="date" value="${hoy}" oninput="actualizarPreviewAbono(${fid})">
    </div>
    <div class="form-group"><label>Descripción (opcional)</label>
      <input id="a-desc" type="text" placeholder="Ej: Abono extra mayo">
    </div>
    <div id="a-preview" class="dia-hint-box" style="margin-top:4px">Ingresa un monto para ver el impacto</div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarAbono(${fid})">Registrar abono</button>`
  );
}

function actualizarPreviewAbono(fid) {
  const f     = S.fuentes.find(x => x.id===fid);
  const monto = parseFloat(document.getElementById('a-monto')?.value)||0;
  const fecha = document.getElementById('a-fecha')?.value;
  const el    = document.getElementById('a-preview');
  if (!el||!monto||!fecha) { if(el) el.textContent='Ingresa un monto para ver el impacto'; return; }
  const [ay,am] = fecha.split('-').map(Number);
  const nm = am+1>12 ? 1 : am+1;
  const ny = am+1>12 ? ay+1 : ay;
  const abonosAntes = (f.abonos||[]).filter(a => {
    const [bay,bam] = a.fecha.split('-').map(Number);
    return bay<ny || (bay===ny && bam<nm);
  }).reduce((s,a) => s+a.monto, 0);
  const capitalNuevo  = Math.max(0, f.monto - abonosAntes - monto);
  const interesNuevo  = Math.round(capitalNuevo * f.tasa_pct / 100);
  const interesActual = getCuotaMes(f, nm, ny);
  el.innerHTML=`Desde ${MESES_N[nm-1]} ${ny}: capital <strong style="font-family:'IBM Plex Mono',monospace">${fmt(capitalNuevo)}</strong> · Interés <strong style="font-family:'IBM Plex Mono',monospace;color:var(--red-mid)">${fmt(interesNuevo)}/mes</strong> <span style="color:var(--green-mid)">(ahorras ${fmt(interesActual-interesNuevo)}/mes)</span>`;
}

async function guardarAbono(fid) {
  const monto = parseFloat(document.getElementById('a-monto').value)||0;
  const fecha = document.getElementById('a-fecha').value;
  const desc  = document.getElementById('a-desc').value.trim();
  if (!monto||!fecha) { alert('Completa monto y fecha'); return; }
  const f = S.fuentes.find(x => x.id===fid);
  if (!f.abonos) f.abonos=[];
  f.abonos.push({ id:'a'+S.nextId++, monto, fecha, desc });
  f.abonos.sort((a,b) => a.fecha.localeCompare(b.fecha));
  cerrar(); render(); await guardarTodo();
}

// ── Setup GAS ─────────────────────────────────────────────────────
function abrirSetup() {
  modal('Conectar Google Sheets',`
    <div class="step"><div class="step-num">1</div><div class="step-body">
      <div class="step-title">Crea un Google Sheet nuevo</div>
      <div class="step-desc">Ve a <a href="https://sheets.new" target="_blank" style="color:var(--blue)">sheets.new</a> y crea una hoja en blanco.</div>
    </div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">
      <div class="step-title">Abre Apps Script y pega el código</div>
      <div class="step-desc">En el Sheet, ve a <code>Extensiones → Apps Script</code>. Borra el código y pega este:</div>
      <button class="copy-btn" onclick="copiarScript()"><i class="ti ti-copy" style="font-size:12px;vertical-align:-1px"></i> Copiar código</button>
    </div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">
      <div class="step-title">Despliega como aplicación web</div>
      <div class="step-desc">Click en <code>Implementar → Nueva implementación</code>. Tipo: <code>Aplicación web</code>. Acceso: <code>Cualquier persona</code>. Copia la URL.</div>
    </div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">
      <div class="step-title">Pega la URL aquí</div>
      <div class="form-group" style="margin-top:8px;margin-bottom:0">
        <input id="setup-url" type="text" placeholder="https://script.google.com/macros/s/..." value="${CONFIG.SCRIPT_URL}">
      </div>
    </div></div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarSetup()">Conectar</button>`
  );
}

function copiarScript() {
  const code = `const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doPost(e) {
  const action = e.parameter.action;
  const data = JSON.parse(e.postData.contents || '{}');
  let result;
  try {
    if (action === 'getData') result = getData();
    else if (action === 'saveData') result = saveData(data);
    else result = { ok: false, error: 'Acción desconocida' };
  } catch(err) {
    result = { ok: false, error: err.toString() };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) { return doPost(e); }

function getData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('datos');
  if (!sheet) { sheet = ss.insertSheet('datos'); sheet.getRange('A1').setValue('{}'); }
  const raw = sheet.getRange('A1').getValue();
  return { ok: true, ...( raw ? JSON.parse(raw) : {} ) };
}

function saveData(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('datos');
  if (!sheet) sheet = ss.insertSheet('datos');
  sheet.getRange('A1').setValue(JSON.stringify(data));
  actualizarHojas(ss, data);
  return { ok: true };
}

function actualizarHojas(ss, data) {
  const meses = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  let hF = ss.getSheetByName('fuentes') || ss.insertSheet('fuentes');
  hF.clearContents();
  hF.getRange(1,1,1,6).setValues([['Nombre','Tipo','Monto original','Tasa %','Fecha','Capital actual']]);
  if (data.fuentes && data.fuentes.length) {
    const rows = data.fuentes.map(f => {
      const ab = (f.abonos||[]).reduce((s,a)=>s+a.monto,0);
      return [f.nombre, f.tipo, f.monto, f.tasa_pct||0, f.fecha, f.monto-ab];
    });
    hF.getRange(2,1,rows.length,6).setValues(rows);
  }
  let hC = ss.getSheetByName('cuotas') || ss.insertSheet('cuotas');
  hC.clearContents();
  hC.getRange(1,1,1,5).setValues([['Fuente','Mes','Año','Monto','Estado']]);
  const allC = [];
  (data.fuentes||[]).forEach(f => (f.cuotas||[]).forEach(c => allC.push([f.nombre,meses[c.mes]||c.mes,c.anio,c.monto,c.estado])));
  if (allC.length) hC.getRange(2,1,allC.length,5).setValues(allC);
  let hA = ss.getSheetByName('abonos') || ss.insertSheet('abonos');
  hA.clearContents();
  hA.getRange(1,1,1,4).setValues([['Fuente','Fecha','Monto','Descripción']]);
  const allA = [];
  (data.fuentes||[]).forEach(f => (f.abonos||[]).forEach(a => allA.push([f.nombre,a.fecha,a.monto,a.desc||''])));
  if (allA.length) hA.getRange(2,1,allA.length,4).setValues(allA);
}`;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector('.copy-btn');
    if (btn) { btn.textContent='✓ Copiado'; setTimeout(()=>{ btn.innerHTML='<i class="ti ti-copy" style="font-size:12px;vertical-align:-1px"></i> Copiar código'; },2000); }
  });
}

async function guardarSetup() {
  const url = document.getElementById('setup-url').value.trim();
  if (!url) { alert('Pega la URL del script'); return; }
  CONFIG.SCRIPT_URL = url;
  localStorage.setItem('gas_url_pp', url);
  cerrar();
  await cargarDatos();
}

// ── Init ──────────────────────────────────────────────────────────
const _saved = localStorage.getItem('gas_url_pp');
if (_saved) CONFIG.SCRIPT_URL = _saved;
cargarDatos();
