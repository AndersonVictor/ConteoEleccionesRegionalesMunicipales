import { api, local, sesion } from '../api.js';
import { cargarUbigeo, enlazarUbigeo, selectoresUbigeo } from '../ubigeo.js';
import { botonAyuda, botonTema, cargando, fmt, html, iconos, logo, pct, titulo, toast } from '../ui.js';
import { guia } from '../guia.js';

const REFRESCO_MS = 20000;

// El enlace lleva el ámbito y la elección (#/resultados?u=0401&s=provincial) para compartirlo.
export async function vistaDashboard(app, query = '') {
  await cargarUbigeo();
  const q = new URLSearchParams(query || '');
  const enlace = q.has('u') && /^\d{0,6}$/.test(q.get('u')) ? q.get('u') : null;
  let ubigeo = enlace ?? local.get('dashUbigeo') ?? (local.get('ultimoUbigeo', '') || '').slice(0, 2);
  let seccion = q.get('s') || null;
  const publico = !sesion.token;

  // Actualiza la dirección sin recargar, para que "Compartir" copie lo que se está viendo.
  function actualizarEnlace() {
    const p = new URLSearchParams({ u: ubigeo, ...(seccion ? { s: seccion } : {}) });
    history.replaceState(null, '', `#/resultados?${p}`);
  }
  const urlCompartir = () => `${location.origin}/#/resultados?${new URLSearchParams({ u: ubigeo, ...(seccion ? { s: seccion } : {}) })}`;
  let borradores = local.get('dashBorradores', false);
  let datos = null;
  let timer = null;
  let activo = true;

  function nombreAmbito(a) {
    if (!a) return '';
    if (a.nivel === 'distrito') return `${titulo(a.distrito)} (${titulo(a.provincia)})`;
    if (a.nivel === 'provincia') return `Provincia de ${titulo(a.provincia)}`;
    if (a.nivel === 'departamento') return `Región ${titulo(a.departamento)}`;
    return 'Todo el país';
  }

  function resultados(r) {
    const conVotos = r.organizaciones.filter((o) => o.votos > 0);
    const [p, s] = conVotos;
    const maximo = Math.max(1, ...r.organizaciones.map((o) => o.votos));
    return html`
      ${p ? html`<div class="lider">
          ${logo(p)}
          <div class="grow">
            <div class="etq">Va ganando · ${r.titulo}</div>
            <div class="nom">${titulo(p.nombre)}</div>
            <div class="pct">${pct(p.pct_validos)}</div>
            <div class="small muted">${fmt(p.votos)} votos${s ? ` · ventaja de ${fmt(p.votos - s.votos)} sobre ${titulo(s.nombre)}` : ''}</div>
          </div>
        </div>`
        : html`<div class="aviso">Aún no hay votos ${borradores ? '' : 'de actas cerradas '}para ${r.titulo.toLowerCase()} en este ámbito.</div>`}
      <div class="kpis">
        <div class="kpi"><div class="v">${fmt(r.mesas)}</div><div class="l">Mesas contabilizadas</div></div>
        <div class="kpi"><div class="v">${fmt(r.validos)}</div><div class="l">Votos válidos</div></div>
        <div class="kpi"><div class="v">${fmt(r.blancos)}</div><div class="l">En blanco</div></div>
        <div class="kpi"><div class="v">${fmt(r.nulos + r.impugnados)}</div><div class="l">Nulos e impugnados</div></div>
      </div>
      <div class="card stack">
        <div class="row between"><h2>${r.titulo}</h2><span class="small muted">% de votos válidos</span></div>
        <div class="barras" role="list">${r.organizaciones.map((o, i) => html`
          <div class="barra-org ${i === 0 && o.votos > 0 ? 'primero' : ''}" role="listitem"
               title="${titulo(o.nombre)}: ${fmt(o.votos)} votos · ${pct(o.pct_validos)} de válidos · ${pct(o.pct_emitidos)} de emitidos">
            ${logo(o, { chico: true })}
            <span class="nom">${titulo(o.nombre)}</span>
            <span class="val">${fmt(o.votos)}<small>${pct(o.pct_validos)}</small></span>
            <span class="pista" style="grid-column:2/4"><i style="width:${(100 * o.votos) / maximo}%"></i></span>
          </div>`)}
        </div>
        ${r.organizaciones.length ? '' : html`<p class="muted small">No hay organizaciones registradas para este ámbito.</p>`}
      </div>`;
  }

  function desglose(d) {
    if (!d.desglose.length) return '';
    const nivelHijo = { departamento: 'Provincia', provincia: 'Distrito', nacional: 'Región' }[d.ambito.nivel] || 'Ámbito';
    return html`<div class="card stack">
      <h2>¿Quién va ganando en cada ${nivelHijo.toLowerCase()}?</h2>
      <div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>${nivelHijo}</th><th>Va ganando</th><th class="n">Mesas</th></tr></thead>
        <tbody>${d.desglose.map((x) => html`<tr data-ir="${x.ubigeo}" style="cursor:pointer">
          <td><b>${titulo(x.nombre)}</b><div class="small muted">${x.carrera_titulo || ''}</div></td>
          <td>${x.lider
            ? html`<div class="row">${logo(x.lider, { chico: true })}<div class="grow"><div class="small"><b>${titulo(x.lider.nombre)}</b></div>
                <div class="small muted">${pct(x.lider.pct_validos)}${x.segundo ? ` · +${fmt(x.lider.votos - x.segundo.votos)} votos` : ''}</div></div></div>`
            : html`<span class="muted small">Sin votos aún</span>`}</td>
          <td class="n">${fmt(x.mesas_contabilizadas)}/${fmt(x.mesas_registradas)}</td>
        </tr>`)}</tbody>
      </table></div>
    </div>`;
  }

  function mesas(d) {
    if (!d.mesas?.length) return '';
    const etq = { cerrada: ['ok', 'Cerrada'], borrador: ['acc', 'En conteo'], en_conteo: ['acc', 'En conteo'], pendiente: ['', 'Sin iniciar'] };
    return html`<div class="card stack">
      <h2>Mesas del distrito</h2>
      <div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Mesa</th><th>Estado</th><th>Va ganando</th><th class="n">Votos</th></tr></thead>
        <tbody>${d.mesas.map((m) => html`<tr>
          <td><b class="num">${m.numero}</b><div class="small muted">${m.personeros} personero${m.personeros === 1 ? '' : 's'}</div></td>
          <td><span class="chip ${etq[m.estado]?.[0] || ''}">${etq[m.estado]?.[1] || m.estado}</span>
            ${m.diferencias ? html`<span class="chip err">Diferencias</span>` : ''}</td>
          <td class="small">${m.lider ? titulo(m.lider.nombre) : '—'}</td>
          <td class="n">${fmt(m.emitidos)}</td>
        </tr>`)}</tbody>
      </table></div>
    </div>`;
  }

  function pintar() {
    const d = datos;
    const st = d?.mesas_stats;
    app.innerHTML = String(html`
      ${publico ? html`<div class="barra-publica">
        <img src="/img/icono.svg" alt=""><span class="grow"><b>Conteo ERM 2026</b><br><small>Resultados en vivo de los personeros</small></span>
        <a class="btn chico" href="#/login">Soy personero</a>
      </div>` : ''}
      <div class="encabezado">
        <div class="titulos"><h1>Resultados</h1><div class="sub">${d ? nombreAmbito(d.ambito) : 'Elige un ámbito'}</div></div>
        ${botonTema()}
        ${botonAyuda('dashboard')}
        <button class="btn-icono" data-accion="compartir" aria-label="Compartir enlace">${iconos.compartir}</button>
        <button class="btn-icono" data-accion="refrescar" aria-label="Actualizar">${iconos.refrescar}</button>
      </div>
      <div class="stack-lg">
        <details class="card" ${ubigeo ? '' : 'open'}>
          <summary style="cursor:pointer;font-weight:700">Ámbito: ${d ? nombreAmbito(d.ambito) : '—'}</summary>
          <div style="margin-top:12px">${selectoresUbigeo(ubigeo, { opcional: true })}</div>
          <label class="row" style="margin-top:12px;cursor:pointer">
            <input type="checkbox" id="borradores" ${borradores ? 'checked' : ''} style="width:20px;height:20px">
            <span class="small">Incluir mesas que aún están en conteo (resultado parcial)</span></label>
        </details>
        ${!d ? cargando() : html`
          ${d.secciones.length > 1 ? html`<div class="segmentado">${d.secciones.map((s) => html`
            <button data-accion="seccion" data-s="${s.id}" class="${d.resultados?.seccion === s.id ? 'activo' : ''}">${s.corto}</button>`)}</div>` : ''}
          ${st.con_diferencias.length ? html`<div class="aviso err">Mesas con conteos distintos entre personeros: <b>${st.con_diferencias.join(', ')}</b>. Revísalas con el acta oficial.</div>` : ''}
          ${d.resultados ? resultados(d.resultados) : html`<div class="aviso">Elige una región para ver resultados. A nivel nacional se muestra el resumen por región.</div>`}
          ${publico ? html`<div class="aviso small">Resultados no oficiales, reportados por personeros desde sus mesas. Los oficiales son los de la ONPE.</div>` : ''}
          <div class="small muted">Mesas: ${fmt(st.registradas)} registradas · ${fmt(st.cerradas)} cerradas · ${fmt(st.en_conteo)} en conteo.
            Se actualiza cada 20 s · ${new Date(d.generado_en).toLocaleTimeString('es-PE')}</div>
          ${desglose(d)}
          ${mesas(d)}`}
      </div>`);

    enlazarUbigeo(app, (u) => {
      ubigeo = u;
      local.set('dashUbigeo', u);
      actualizarEnlace();
      seccion = null;
      cargar();
    }, { opcional: true });
    app.querySelector('#borradores').onchange = (e) => {
      borradores = e.target.checked;
      local.set('dashBorradores', borradores);
      cargar();
    };
  }

  async function cargar() {
    clearTimeout(timer);
    if (!activo) return;
    if (document.visibilityState !== 'visible') {
      timer = setTimeout(cargar, REFRESCO_MS);
      return;
    }
    try {
      const q = new URLSearchParams({ ubigeo, ...(seccion ? { seccion } : {}), ...(borradores ? { borradores: '1' } : {}) });
      datos = await api(`/dashboard?${q}`);
      if (activo) {
        const abierto = app.querySelector('details')?.open;
        const y = window.scrollY;
        pintar();
        if (abierto !== undefined) app.querySelector('details').open = abierto || !ubigeo;
        window.scrollTo(0, y);
        guia('dashboard');
      }
    } catch (e) {
      toast(e.message, { error: true });
    }
    if (activo) timer = setTimeout(cargar, REFRESCO_MS);
  }

  app.onclick = (e) => {
    const b = e.target.closest('[data-accion],[data-ir]');
    if (!b) return;
    if (b.dataset.ir) {
      ubigeo = b.dataset.ir;
      local.set('dashUbigeo', ubigeo);
      seccion = null;
      actualizarEnlace();
      datos = null;
      pintar();
      cargar();
      window.scrollTo(0, 0);
    } else if (b.dataset.accion === 'seccion') {
      seccion = b.dataset.s;
      actualizarEnlace();
      cargar();
    } else if (b.dataset.accion === 'compartir') {
      const url = urlCompartir();
      const texto = `Resultados en vivo del conteo de personeros: ${datos ? nombreAmbito(datos.ambito) : ''}`;
      if (navigator.share) navigator.share({ title: 'Conteo ERM 2026', text: texto, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast('Enlace copiado: compártelo por WhatsApp o redes')).catch(() => toast(url));
    } else if (b.dataset.accion === 'refrescar') {
      cargar();
    }
  };

  pintar();
  if (enlace !== null || q.has('s')) actualizarEnlace();
  cargar();
  return () => {
    activo = false;
    clearTimeout(timer);
    app.onclick = null;
  };
}
