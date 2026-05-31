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

  // Si no hay consignaciones, no hay intereses aún
  if (!f.consignaciones || !f.consignaciones.length) return [];

  // Usar la fecha de la primera consignación como inicio
  const primeraConsignacion = [...(f.consignaciones||[])].sort((a,b) => a.fecha.localeCompare(b.fecha))[0];
  const inicio = new Date(primeraConsignacion.fecha+'T00:00:00');

  const ocultos  = f.mesesOcultos || [];
  const esOculto = (m,y) => ocultos.some(o => o.mes===m && o.anio===y);
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
  let recaudado=0, interesMensual=0, pagadoMes=0, pendienteMes=0, consignadoTotal=0;

  S.fuentes.forEach(f => {
    recaudado      += f.monto;

    // Sumar todas las consignaciones al concesionario
    const totalConsignado = (f.consignaciones||[]).reduce((s,c) => s+c.monto, 0);
    consignadoTotal += totalConsignado;

    if (f.tipo==='propio') return;

    // Solo calcular intereses si hay consignaciones
    if (!f.consignaciones || !f.consignaciones.length) return;

    // Usar la fecha de la primera consignación
    const primeraConsignacion = [...(f.consignaciones||[])].sort((a,b) => a.fecha.localeCompare(b.fecha))[0];
    const ini = new Date(primeraConsignacion.fecha+'T00:00:00');

    interesMensual += getCuotaMes(f, hm, hy);

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
  return { recaudado, interesMensual, pagadoMes, pendienteMes, consignadoTotal, falta, pct, hm, hy };
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
  const pctConsignado = s.recaudado > 0 ? Math.min(100, Math.round(s.consignadoTotal/s.recaudado*100)) : 0;
  const faltaConsignar = Math.max(0, s.recaudado - s.consignadoTotal);

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
        <span class="progress-falta">${fmt(s.falta)} por recaudar</span>
      </div>
    </div>
    <div class="progress-wrap" style="margin-top:10px">
      <div class="progress-bar progress-bar-consignado"><div class="progress-fill progress-fill-consignado" style="width:${pctConsignado}%"></div></div>
      <div class="progress-labels">
        <span class="progress-pct-consignado"><i class="ti ti-building-bank" style="font-size:10px;vertical-align:-1px;margin-right:2px"></i>${pctConsignado}% consignado · ${fmt(s.consignadoTotal)}</span>
        <span class="progress-falta-consignado">${fmt(faltaConsignar)} por consignar</span>
      </div>
    </div>
  </div>`;
}

function renderSummary() {
  const s = calcStats();
  const disponibleConcesionario = s.recaudado - s.consignadoTotal;
  document.getElementById('summary').innerHTML=`
    <div class="metric"><div class="metric-label">Total recaudado</div><div class="metric-value green">${fmt(s.recaudado)}</div></div>
    <div class="metric"><div class="metric-label">Disponibilidad concesionario</div><div class="metric-value blue">${fmt(disponibleConcesionario)}</div></div>
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
  const enIntereses = S.tabActivo === 'intereses';
  const enPlan      = !enIntereses;

  const mainTabs = `<div class="filtros-bar" style="margin-bottom:8px">
    <div class="seg-ctrl">
      <button class="seg-btn${enPlan?' active':''}" onclick="setTab('lista')">Plan de pagos</button>
      <button class="seg-btn${enIntereses?' active':''}" onclick="setTab('intereses')"><i class="ti ti-percentage" style="font-size:11px;margin-right:3px;vertical-align:-1px"></i>Control de intereses</button>
    </div>
  </div>`;

  let subBar = '';
  if (enPlan) {
    const segHtml = `<div class="seg-ctrl">
      <button class="seg-btn${S.filtro==='todas'&&S.tabActivo!=='historial'?' active':''}"   onclick="setFiltro('todas')">Todas</button>
      <button class="seg-btn${S.filtro==='interes'&&S.tabActivo!=='historial'?' active':''}" onclick="setFiltro('interes')">Con interés</button>
      <button class="seg-btn${S.filtro==='propio'&&S.tabActivo!=='historial'?' active':''}"  onclick="setFiltro('propio')">Propios</button>
    </div>`;
    const histHtml = `<button class="hist-btn${S.tabActivo==='historial'?' active':''}" onclick="setTab('historial')">
      <i class="ti ti-history" style="font-size:12px"></i> Historial
    </button>`;
    subBar = `<div class="filtros-bar">${segHtml}<span class="filtros-gap"></span>${histHtml}</div>`;
  }

  document.getElementById('tabs').innerHTML = mainTabs + subBar;
}

function setFiltro(f) { S.filtro=f; S.tabActivo='lista'; renderTabs(); renderContenido(); }
function setTab(t)    { S.tabActivo=t; renderTabs(); renderContenido(); }

function renderFuenteCard(f) {
  const capitalActual = getCapitalActual(f);
  const esPropio      = f.tipo === 'propio';
  const hoy           = new Date();
  const interesActual = getCuotaMes(f, hoy.getMonth()+1, hoy.getFullYear());

  // Determinar fecha de inicio de intereses
  const primeraConsignacion = (f.consignaciones||[]).length
    ? [...(f.consignaciones||[])].sort((a,b) => a.fecha.localeCompare(b.fecha))[0]
    : null;

  const tipoBadge = esPropio
    ? `<span class="tipo-badge propio">Sin interés</span>`
    : `<span class="tipo-badge prestamo">${f.tasa_pct}% mensual</span>`;

  const etiqueta = `<span class="fuente-fecha" style="font-size:12px;font-weight:600;color:var(--text2)">${fechaDisp(f.fecha)}</span>`;
  const descLine = f.desc ? `<div style="font-size:11px;color:var(--text3);margin-top:1px">${f.desc}</div>` : '';

  const abonosHtml = (f.abonos||[]).length
    ? `<div class="abonos-wrap">${(f.abonos||[]).map(a =>
        `<div class="abono-item">
          <span class="abono-desc"><i class="ti ti-corner-down-right" style="font-size:10px;margin-right:3px;color:var(--text3)"></i>${a.desc||fechaDisp(a.fecha)}</span>
          <span class="abono-monto">-${fmt(a.monto)}</span>
        </div>`).join('')}</div>`
    : '';

  const totalConsignado = (f.consignaciones||[]).reduce((s,c) => s+c.monto, 0);
  const disponibleConsignar = f.monto - totalConsignado;

  const consignacionesHtml = (f.consignaciones||[]).length
    ? `<div class="consignaciones-wrap-detalle">${(f.consignaciones||[]).map(c =>
        `<div class="consignacion-item-detalle">
          <span class="consignacion-desc-detalle"><i class="ti ti-building-bank" style="font-size:9px;margin-right:3px;opacity:.6"></i>${c.desc||fechaDisp(c.fecha)}</span>
          <span class="consignacion-monto-detalle">${fmt(c.monto)}</span>
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

  // Texto de fecha de inicio de intereses
  let interesTexto = '';
  if (!esPropio) {
    if (primeraConsignacion) {
      interesTexto = `<div class="pcard-interes">${fmt(interesActual)}/mes</div>`;
    } else {
      interesTexto = `<div class="pcard-sin-consignar"><i class="ti ti-alert-circle" style="font-size:11px;vertical-align:-1px"></i> Sin consignar — interés inicia al consignar</div>`;
    }
  }

  const fechaTexto = primeraConsignacion
    ? `<div class="pcard-fecha">Interés desde ${fechaDisp(primeraConsignacion.fecha)}</div>`
    : `<div class="pcard-fecha">Ingresado ${fechaDisp(f.fecha)}</div>`;

  // Info de consignación
  let consignacionInfo = '';
  if (totalConsignado > 0) {
    if (disponibleConsignar > 0) {
      // Mostrar caja destacada cuando hay disponible
      consignacionInfo = `
        <div class="pcard-disponible-consignar">
          <div class="pcard-disponible-label">Disponible</div>
          <div class="pcard-disponible-monto">${fmt(disponibleConsignar)}</div>
        </div>
        ${consignacionesHtml}`;
    } else {
      // Mostrar texto discreto cuando está totalmente consignado
      consignacionInfo = `
        <div class="pcard-totalmente-consignado">
          <i class="ti ti-check" style="font-size:11px;margin-right:3px;vertical-align:-1px"></i>Totalmente consignado
        </div>
        ${consignacionesHtml}`;
    }
  }

  return `<div class="pcard${disponibleConsignar<=0?' consignada-total':''}">
    <div class="pcard-head">
      <div class="pcard-info">
        <div class="pcard-nombre-row">
          ${tipoBadge}${etiqueta}
        </div>
        ${descLine}
        <div class="pcard-monto-principal">${fmt(f.monto)}${!esPropio&&capitalActual<f.monto?` <span class="pcard-saldo">· Saldo: ${fmt(capitalActual)}</span>`:''}</div>
        ${interesTexto}
        ${fechaTexto}
        ${abonosHtml}
        ${consignacionInfo}
      </div>
      <div class="pcard-actions">
        <button class="icon-btn pcard-btn-edit" onclick="abrirEditarFuente(${f.id})" title="Editar fuente"><i class="ti ti-edit"></i></button>
        <button class="icon-btn pcard-btn-bank" onclick="abrirConsignarFuente(${f.id})" title="Consignar al concesionario"${disponibleConsignar<=0?' disabled style="opacity:.35;cursor:not-allowed"':''}><i class="ti ti-building-bank"></i></button>
        ${!esPropio?`<button class="icon-btn pcard-btn-cash" onclick="abrirAbonar(${f.id})" title="Abonar a capital"><i class="ti ti-trending-down"></i></button>`:''}
        <button class="icon-btn pcard-btn-del" onclick="eliminarFuente(${f.id})" title="Eliminar fuente"><i class="ti ti-trash"></i></button>
      </div>
    </div>
    ${bodyHtml}
  </div>`;
}

function renderContenido() {
  if (S.tabActivo==='historial')  { renderHistorial(); return; }
  if (S.tabActivo==='intereses')  { renderControlIntereses(); return; }
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

// ── Control de Intereses ──────────────────────────────────────────
function renderControlIntereses() {
  const el = document.getElementById('contenido');
  const fuentes = S.fuentes.filter(f =>
    f.tipo === 'prestamo' && f.tasa_pct && (f.consignaciones||[]).length > 0
  );
  if (!fuentes.length) {
    el.innerHTML = '<div class="empty"><i class="ti ti-percentage"></i>No hay fuentes con interés activo</div>';
    return;
  }
  el.innerHTML = fuentes.map(f => renderInteresCard(f)).join('');
}

function renderInteresCard(f) {
  const hoy = new Date();
  const hy = hoy.getFullYear(), hm = hoy.getMonth()+1;
  const capitalActual = getCapitalActual(f);
  const interesHoy    = getCuotaMes(f, hm, hy);
  const meses         = getMesesFuente(f);

  // Día de pago: día del mes de la primera consignación
  const primeraConsig = [...(f.consignaciones||[])].sort((a,b) => a.fecha.localeCompare(b.fecha))[0];
  const diaPago = primeraConsig ? parseInt(primeraConsig.fecha.split('-')[2]) : null;

  // Persona asociada
  const persona = getPersona(f.personaId);
  const pNombre = persona ? persona.nombre : 'Sin persona';
  const pi      = S.personas.indexOf(persona);
  const color   = colorIdx(pi >= 0 ? pi : 0);
  const ini     = pNombre.split(/[\s\/]+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase();

  const totalAbonosF = (f.abonos||[]).reduce((s,a) => s+a.monto, 0);

  const filas = meses.map(({mes, anio, cuota}) => {
    const interesMes    = getCuotaMes(f, mes, anio);
    const pagado        = cuota && cuota.estado === 'pagado';
    const fechaPago     = pagado && cuota.fecha_pago ? fechaDisp(cuota.fecha_pago) : '';
    const esActual      = mes === hm && anio === hy;
    const venceStr      = diaPago ? `${diaPago} ${MESES_C[mes-1]}` : '—';

    const abonosMes     = (f.abonos||[]).filter(a => { const [ay,am]=a.fecha.split('-').map(Number); return ay===anio&&am===mes; });
    const totalAbonoMes = abonosMes.reduce((s,a) => s+a.monto, 0);

    const checkHtml = pagado
      ? `<button class="ci-check-btn" onclick="desmarcarCuota(${f.id},${mes},${anio})" title="Desmarcar pago"><i class="ti ti-circle-check" style="color:var(--green-mid);font-size:17px"></i></button>`
      : `<button class="ci-check-btn" onclick="abrirPagarCuota(${f.id},${mes},${anio})" title="Registrar pago"><i class="ti ti-circle" style="font-size:17px"></i></button>`;

    const abonoCell = totalAbonoMes > 0
      ? `<span class="ci-abono-tag"><i class="ti ti-trending-down" style="font-size:9px;margin-right:3px"></i>${fmt(totalAbonoMes)}</span>`
      : `<button class="ci-abono-btn" onclick="abrirAbonar(${f.id})"><i class="ti ti-plus" style="font-size:9px;margin-right:2px"></i>Abonar</button>`;

    return `<tr class="ci-row${esActual?' ci-row-actual':''}${pagado?' ci-row-pagado':''}">
      <td class="ci-mes">${MESES_C[mes-1]} ${anio}</td>
      <td class="ci-vence">${venceStr}</td>
      <td class="ci-interes-val" style="${pagado?'color:var(--text3)':'color:var(--red-mid)'}">${fmt(interesMes)}</td>
      <td class="ci-check">${checkHtml}</td>
      <td class="ci-fecha">${fechaPago||'<span style="color:var(--text3)">—</span>'}</td>
      <td class="ci-abono-col">${abonoCell}</td>
    </tr>`;
  }).join('');

  return `<div class="ci-card">
    <div class="ci-card-head">
      <div class="ci-card-persona">
        <div class="ci-avatar" style="background:${color.bg};color:${color.text}">${ini}</div>
        <div>
          <div class="ci-card-nombre">${pNombre}${f.desc?` <span class="ci-card-desc">${f.desc}</span>`:''}</div>
          <div class="ci-card-info">
            ${f.tasa_pct}% mensual · Capital: <strong>${fmt(f.monto)}</strong>
            ${capitalActual < f.monto ? ` · Saldo: <strong style="color:var(--green-mid)">${fmt(capitalActual)}</strong>` : ''}
            ${diaPago ? ` · <span class="ci-dia-pago"><i class="ti ti-calendar-due" style="font-size:10px;margin-right:2px;vertical-align:-1px"></i>Pago día ${diaPago}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="ci-card-right">
        <div class="ci-interes-mes">${fmt(interesHoy)}<span class="ci-interes-mes-label">/mes</span></div>
        ${totalAbonosF > 0 ? `<div class="ci-abonado-total"><i class="ti ti-trending-down" style="font-size:9px;margin-right:2px"></i>${fmt(totalAbonosF)} abonado</div>` : ''}
        <button class="ci-btn-abonar" onclick="abrirAbonar(${f.id})"><i class="ti ti-trending-down" style="font-size:11px;margin-right:3px"></i>Abonar capital</button>
      </div>
    </div>
    ${meses.length
      ? `<table class="ci-table">
          <thead><tr>
            <th>Mes</th><th>Vence</th><th>Interés</th><th></th><th>Fecha pago</th><th style="text-align:right">Abono cap.</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>`
      : `<div style="font-size:12px;color:var(--text3);padding:12px 14px">Sin meses registrados</div>`
    }
  </div>`;
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
    (f.consignaciones||[]).forEach(c => {
      eventos.push({ tipo:'consignacion', fecha:c.fecha, monto:c.monto, desc:c.desc||'Consignación', fuente:f.nombre });
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
      if (e.tipo==='consignacion') return `<div class="hist-row">
        <div class="hist-icon consignacion"><i class="ti ti-building-bank"></i></div>
        <div class="hist-info"><div class="hist-title">${e.fuente}</div><div class="hist-sub">${e.desc}</div></div>
        <div class="hist-right"><span class="hist-monto consignacion">${fmt(e.monto)}</span><span class="hist-badge consignacion">Consignación</span></div>
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

function abrirConsignarFuente(fid) {
  const f = S.fuentes.find(x => x.id===fid);
  const hoy = new Date().toISOString().split('T')[0];
  const persona = getPersona(f.personaId);
  const pNombre = persona ? persona.nombre : '';
  const totalConsignado = (f.consignaciones||[]).reduce((s,c) => s+c.monto, 0);
  const disponible = f.monto - totalConsignado;

  modal('Consignar al concesionario',
    `<p style="font-size:13px;color:var(--text2);margin-bottom:14px">
      <strong>${pNombre}${f.desc?' · '+f.desc:''}</strong><br>
      Monto total: <strong style="font-family:'IBM Plex Mono',monospace">${fmt(f.monto)}</strong> ·
      Consignado: <strong style="font-family:'IBM Plex Mono',monospace;color:var(--blue)">${fmt(totalConsignado)}</strong> ·
      Disponible: <strong style="font-family:'IBM Plex Mono',monospace;color:var(--green-mid)">${fmt(disponible)}</strong>
    </p>
    <div class="form-group" style="margin-bottom:10px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px">
        <input type="checkbox" id="consig-todo" checked onchange="toggleConsignarTodo(${disponible})" style="width:auto;cursor:pointer">
        <span>Consignar todo (${fmt(disponible)})</span>
      </label>
    </div>
    <div class="form-group" id="consig-monto-wrap" style="display:none">
      <label>Monto a consignar ($)</label>
      <input id="consig-monto" type="number" placeholder="${disponible}" max="${disponible}">
      <div class="form-hint">Máximo disponible: ${fmt(disponible)}</div>
    </div>
    <div class="form-group">
      <label>Fecha de consignación</label>
      <input id="consig-fecha" type="date" value="${hoy}" autofocus>
    </div>
    <div class="form-group">
      <label>Descripción (opcional)</label>
      <input id="consig-desc" type="text" placeholder="Ej: Primera consignación">
    </div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarConsignacionFuente(${fid},${disponible})">Registrar consignación</button>`
  );
}

function toggleConsignarTodo(disponible) {
  const checked = document.getElementById('consig-todo')?.checked;
  const wrap = document.getElementById('consig-monto-wrap');
  if (wrap) wrap.style.display = checked ? 'none' : 'block';
  if (!checked) {
    setTimeout(() => document.getElementById('consig-monto')?.focus(), 100);
  }
}

async function guardarConsignacionFuente(fid, disponible) {
  const consignarTodo = document.getElementById('consig-todo')?.checked;
  const monto = consignarTodo ? disponible : (parseFloat(document.getElementById('consig-monto')?.value)||0);
  const fecha = document.getElementById('consig-fecha')?.value;
  const desc = document.getElementById('consig-desc')?.value.trim();

  if (!monto||!fecha) { alert('Completa monto y fecha'); return; }

  const f = S.fuentes.find(x => x.id===fid);
  const totalConsignado = (f.consignaciones||[]).reduce((s,c) => s+c.monto, 0);
  const disponibleActual = f.monto - totalConsignado;

  if (monto > disponibleActual) {
    alert(`No puedes consignar más de lo disponible (${fmt(disponibleActual)})`);
    return;
  }

  if (!f.consignaciones) f.consignaciones=[];
  f.consignaciones.push({ id:'c'+S.nextId++, monto, fecha, desc });
  f.consignaciones.sort((a,b) => a.fecha.localeCompare(b.fecha));
  cerrar(); render(); await guardarTodo();
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

  S.fuentes.push({ id:S.nextId++, personaId, tipo, monto, tasa_pct:tasa, fecha, desc, cuotas:[], abonos:[], mesesOcultos:[], consignaciones:[] });
  cerrar(); render(); await guardarTodo();
}

function abrirEditarFuente(fid) {
  const f = S.fuentes.find(x => x.id===fid);
  if (!f) return;

  const persona = getPersona(f.personaId);
  const pNombre = persona ? persona.nombre : '';

  modal('Editar fuente',
    `<p style="font-size:13px;color:var(--text2);margin-bottom:14px">
      <strong>${pNombre}</strong> · Editando información de la fuente
    </p>
    <div class="form-group">
      <label>Tipo</label>
      <select id="e-tipo" onchange="toggleTipoFormEdit(this.value)">
        <option value="propio"${f.tipo==='propio'?' selected':''}>Recursos propios — sin interés</option>
        <option value="prestamo"${f.tipo==='prestamo'?' selected':''}>Préstamo — genera interés</option>
      </select>
    </div>
    <div class="form-group">
      <label>Monto ($)</label>
      <input id="e-monto" type="number" value="${f.monto}" oninput="actualizarPreviewFuenteEdit()">
    </div>
    <div id="e-tasa-wrap"${f.tipo==='propio'?' style="display:none"':''}>
      <div class="form-row">
        <div class="form-group">
          <label>Tasa mensual (%)</label>
          <input id="e-tasa" type="number" value="${f.tasa_pct||0}" step="0.1" min="0" oninput="actualizarPreviewFuenteEdit()">
        </div>
        <div class="form-group">
          <label>Interés / mes</label>
          <input id="e-cuota-disp" type="text" readonly placeholder="—" style="background:var(--surface2);color:var(--red-mid);font-family:'IBM Plex Mono',monospace;font-weight:700;cursor:default">
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>Descripción (opcional)</label>
      <input id="e-desc" type="text" value="${f.desc||''}" placeholder="Ej: Segunda cuota, Para negocio...">
    </div>
    <div class="form-group">
      <label>Fecha de ingreso</label>
      <input id="e-fecha" type="date" value="${f.fecha}">
      <div class="form-hint">El día de esta fecha define cuándo empieza a generar interés</div>
    </div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarEdicionFuente(${f.id})">Guardar cambios</button>`
  );
  actualizarPreviewFuenteEdit();
}

function toggleTipoFormEdit(v) {
  document.getElementById('e-tasa-wrap').style.display = v==='propio' ? 'none' : 'block';
}

function actualizarPreviewFuenteEdit() {
  const monto = parseFloat(document.getElementById('e-monto')?.value)||0;
  const tasa  = parseFloat(document.getElementById('e-tasa')?.value)||0;
  const el    = document.getElementById('e-cuota-disp');
  if (el) el.value = monto&&tasa ? fmt(Math.round(monto*tasa/100)) : '';
}

async function guardarEdicionFuente(fid) {
  const f = S.fuentes.find(x => x.id===fid);
  if (!f) return;

  const tipo = document.getElementById('e-tipo').value;
  const monto= parseFloat(document.getElementById('e-monto').value)||0;
  const tasa = tipo==='propio' ? 0 : (parseFloat(document.getElementById('e-tasa')?.value)||0);
  const fecha= document.getElementById('e-fecha').value;
  const desc = document.getElementById('e-desc')?.value.trim() || '';

  if (!monto||!fecha) { alert('Completa el monto y la fecha'); return; }

  // Actualizar fuente
  f.tipo = tipo;
  f.monto = monto;
  f.tasa_pct = tasa;
  f.fecha = fecha;
  f.desc = desc;

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
  hF.getRange(1,1,1,7).setValues([['Nombre','Tipo','Monto original','Tasa %','Fecha','Capital actual','Consignado']]);
  if (data.fuentes && data.fuentes.length) {
    const rows = data.fuentes.map(f => {
      const ab = (f.abonos||[]).reduce((s,a)=>s+a.monto,0);
      const cons = (f.consignaciones||[]).reduce((s,c)=>s+c.monto,0);
      return [f.nombre, f.tipo, f.monto, f.tasa_pct||0, f.fecha, f.monto-ab, cons];
    });
    hF.getRange(2,1,rows.length,7).setValues(rows);
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
  let hCons = ss.getSheetByName('consignaciones') || ss.insertSheet('consignaciones');
  hCons.clearContents();
  hCons.getRange(1,1,1,4).setValues([['Fuente','Fecha','Monto','Descripción']]);
  const allCons = [];
  (data.fuentes||[]).forEach(f => (f.consignaciones||[]).forEach(c => allCons.push([f.nombre,c.fecha,c.monto,c.desc||''])));
  if (allCons.length) hCons.getRange(2,1,allCons.length,4).setValues(allCons);
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

// ── Menú de Reportes ──────────────────────────────────────────────
function abrirMenuReportes(event) {
  event.stopPropagation();
  const menu = document.getElementById('menu-reportes');
  if (menu) {
    menu.remove();
    return;
  }

  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();

  const menuHtml = `<div id="menu-reportes" class="dropdown-menu" style="position:fixed;top:${rect.bottom + 5}px;right:${window.innerWidth - rect.right}px">
    <div class="dropdown-item" onclick="generarReportePDF();cerrarMenuReportes()">
      <i class="ti ti-table"></i> Reporte de Fuentes
    </div>
    <div class="dropdown-item" onclick="generarReporteConsignaciones();cerrarMenuReportes()">
      <i class="ti ti-building-bank"></i> Reporte de Consignaciones
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', menuHtml);

  setTimeout(() => {
    document.addEventListener('click', cerrarMenuReportes, { once: true });
  }, 100);
}

function cerrarMenuReportes() {
  const menu = document.getElementById('menu-reportes');
  if (menu) menu.remove();
}

// ── Reporte PDF Fuentes ───────────────────────────────────────────
function generarReportePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Título
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text('Reporte de Consignaciones', 14, 20);

  // Fecha del reporte
  const hoy = new Date();
  const fechaReporte = `${hoy.getDate()}/${hoy.getMonth()+1}/${hoy.getFullYear()}`;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Generado: ${fechaReporte}`, 14, 27);

  // Resumen general
  const stats = calcStats();
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Resumen General', 14, 37);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(`Meta: ${fmt(S.meta.monto)}${S.meta.desc?' - '+S.meta.desc:''}`, 14, 43);
  doc.text(`Recaudado: ${fmt(stats.recaudado)} (${stats.pct}%)`, 14, 48);
  doc.text(`Consignado al concesionario: ${fmt(stats.consignadoTotal)}`, 14, 53);
  doc.text(`Disponible por consignar: ${fmt(stats.recaudado - stats.consignadoTotal)}`, 14, 58);
  doc.text(`Interés mensual total: ${fmt(stats.interesMensual)}`, 14, 63);

  // Preparar datos de la tabla - separar préstamos y propios
  const tableData = [];
  const prestamos = S.fuentes.filter(f => f.tipo === 'prestamo');
  const propios = S.fuentes.filter(f => f.tipo === 'propio');

  // Función para agregar fuente a la tabla
  const agregarFuente = (f) => {
    const persona = getPersona(f.personaId);
    const nombrePersona = persona ? persona.nombre : 'Sin persona';
    const tipo = f.tipo === 'propio' ? 'Propio' : 'Préstamo';
    const totalConsignado = (f.consignaciones||[]).reduce((s,c) => s+c.monto, 0);
    const disponible = f.monto - totalConsignado;

    // Obtener fecha de primera consignación
    let fechaConsignacion = '-';
    let fechaInicioInteres = '-';
    if (f.consignaciones && f.consignaciones.length > 0) {
      const primeraConsig = [...f.consignaciones].sort((a,b) => a.fecha.localeCompare(b.fecha))[0];
      fechaConsignacion = fechaDisp(primeraConsig.fecha);

      // Calcular fecha de inicio de interés (un mes después)
      if (f.tipo === 'prestamo') {
        const fc = new Date(primeraConsig.fecha+'T00:00:00');
        let m = fc.getMonth()+2; // +1 para el mes siguiente, +1 porque getMonth es 0-indexed
        let y = fc.getFullYear();
        if (m > 12) { m = 1; y++; }
        fechaInicioInteres = `${String(m).padStart(2,'0')}/${y}`;
      }
    }

    const tasa = f.tipo === 'propio' ? '-' : `${f.tasa_pct}%`;
    const interesActual = f.tipo === 'propio' ? '-' : fmt(getCuotaMes(f, hoy.getMonth()+1, hoy.getFullYear()));

    // Agregar fila con toda la información
    tableData.push([
      nombrePersona,
      f.desc || fechaDisp(f.fecha),
      tipo,
      fmt(f.monto),
      fmt(totalConsignado),
      fmt(disponible),
      fechaConsignacion,
      fechaInicioInteres,
      tasa,
      interesActual
    ]);

    // Agregar detalle de consignaciones si hay
    if (f.consignaciones && f.consignaciones.length > 1) {
      f.consignaciones.forEach(c => {
        tableData.push([
          '',
          `  └ ${c.desc || fechaDisp(c.fecha)}`,
          '',
          '',
          fmt(c.monto),
          '',
          fechaDisp(c.fecha),
          '',
          '',
          ''
        ]);
      });
    }
  };

  // Agregar primero los préstamos
  if (prestamos.length > 0) {
    prestamos.forEach(agregarFuente);
  }

  // Agregar separador si hay ambos tipos
  if (prestamos.length > 0 && propios.length > 0) {
    tableData.push([
      { content: 'RECURSOS PROPIOS (SIN INTERÉS)', colSpan: 10, styles: { fillColor: [237, 234, 228], fontStyle: 'bold', halign: 'center', fontSize: 8 } }
    ]);
  }

  // Agregar recursos propios
  if (propios.length > 0) {
    propios.forEach(agregarFuente);
  }

  // Generar tabla
  doc.autoTable({
    startY: 70,
    head: [[
      'Persona',
      'Fuente',
      'Tipo',
      'Monto',
      'Consignado',
      'Disponible',
      'Fecha Consig.',
      'Inicio Interés',
      'Tasa',
      'Interés/mes'
    ]],
    body: tableData,
    styles: {
      fontSize: 7,
      cellPadding: 2,
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: [26, 24, 20],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7
    },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 25 },
      2: { cellWidth: 15 },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 18 },
      7: { cellWidth: 18 },
      8: { cellWidth: 12, halign: 'center' },
      9: { cellWidth: 20, halign: 'right' }
    },
    alternateRowStyles: {
      fillColor: [245, 243, 238]
    }
  });

  // Guardar PDF
  const nombreArchivo = `Reporte-Fuentes-${fechaReporte.replace(/\//g,'-')}.pdf`;
  doc.save(nombreArchivo);
}

// ── Reporte PDF Consignaciones ────────────────────────────────────
function generarReporteConsignaciones() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Título
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text('Reporte de Consignaciones al Concesionario', 14, 20);

  // Fecha del reporte
  const hoy = new Date();
  const fechaReporte = `${hoy.getDate()}/${hoy.getMonth()+1}/${hoy.getFullYear()}`;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Generado: ${fechaReporte}`, 14, 27);

  // Recolectar todas las consignaciones
  const todasConsignaciones = [];
  S.fuentes.forEach(f => {
    const persona = getPersona(f.personaId);
    const nombrePersona = persona ? persona.nombre : 'Sin persona';

    (f.consignaciones || []).forEach(c => {
      todasConsignaciones.push({
        fecha: c.fecha,
        persona: nombrePersona,
        fuente: f.desc || 'Sin descripción',
        monto: c.monto,
        descripcion: c.desc || '-'
      });
    });
  });

  // Ordenar por fecha (más reciente primero)
  todasConsignaciones.sort((a, b) => b.fecha.localeCompare(a.fecha));

  // Calcular totales
  const totalConsignado = todasConsignaciones.reduce((sum, c) => sum + c.monto, 0);
  const stats = calcStats();

  // Resumen
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Resumen', 14, 37);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(`Total consignado: ${fmt(totalConsignado)}`, 14, 43);
  doc.text(`Número de consignaciones: ${todasConsignaciones.length}`, 14, 48);
  doc.text(`Total recaudado: ${fmt(stats.recaudado)}`, 14, 53);
  doc.text(`Disponible por consignar: ${fmt(stats.recaudado - totalConsignado)}`, 14, 58);

  if (todasConsignaciones.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text('No hay consignaciones registradas aún', 14, 75);
    doc.save(`Reporte-Consignaciones-${fechaReporte.replace(/\//g,'-')}.pdf`);
    return;
  }

  // Preparar datos para la tabla
  const tableData = todasConsignaciones.map(c => [
    fechaDisp(c.fecha),
    c.persona,
    c.fuente,
    c.descripcion,
    fmt(c.monto)
  ]);

  // Generar tabla
  doc.autoTable({
    startY: 65,
    head: [['Fecha', 'Persona', 'Fuente', 'Descripción', 'Monto']],
    body: tableData,
    foot: [['', '', '', 'TOTAL CONSIGNADO', fmt(totalConsignado)]],
    styles: {
      fontSize: 9,
      cellPadding: 3
    },
    headStyles: {
      fillColor: [24, 62, 122],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9
    },
    footStyles: {
      fillColor: [210, 229, 249],
      textColor: [24, 62, 122],
      fontStyle: 'bold',
      fontSize: 9
    },
    columnStyles: {
      0: { cellWidth: 25, halign: 'center' },
      1: { cellWidth: 35 },
      2: { cellWidth: 40 },
      3: { cellWidth: 50 },
      4: { cellWidth: 35, halign: 'right', fontStyle: 'bold' }
    },
    alternateRowStyles: {
      fillColor: [245, 243, 238]
    }
  });

  // Guardar PDF
  const nombreArchivo = `Reporte-Consignaciones-${fechaReporte.replace(/\//g,'-')}.pdf`;
  doc.save(nombreArchivo);
}

// ── Init ──────────────────────────────────────────────────────────
const _saved = localStorage.getItem('gas_url_pp');
if (_saved) CONFIG.SCRIPT_URL = _saved;
cargarDatos();
