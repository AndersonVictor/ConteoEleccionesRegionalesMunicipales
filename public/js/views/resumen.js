import { actaLocal, api, enviarActa, guardarActaLocal, local } from '../api.js';
import { ESPECIALES, SECCIONES, errorObservacion, evaluarCuadre, motivoNoCierre, resumenSeccion, textoResultado } from '/shared/acta.js';
import { botonAyuda, cargando, confirmar, fmt, html, iconos, logo, modal, pct, titulo, toast } from '../ui.js';
import { cargarActa } from './conteo.js';
import { guia } from '../guia.js';

export async function vistaResumen(app, id) {
  app.innerHTML = String(cargando());
  let { acta, organizaciones } = await cargarActa(id);
  const secciones = acta.secciones;
  let tabSel = secciones[0];

  const orgDe = (s, k) => organizaciones?.[s]?.organizaciones.find((o) => String(o.id) === k) || { id: k, nombre: `Org. ${k}` };
  const nombres = () => {
    const n = {};
    for (const s of secciones) for (const o of organizaciones?.[s]?.organizaciones || []) n[o.id] = titulo(o.nombre);
    return n;
  };
  const guardar = () => guardarActaLocal(id, { acta, organizaciones });

  // Resultados de una elección: barras con logo, como en el dashboard.
  function panelSeccion(s, c) {
    const r = resumenSeccion(c);
    const filas = (organizaciones?.[s]?.organizaciones || []).map((o) => ({ o, n: c.votos[String(o.id)] || 0 }));
    // Votos a organizaciones que ya no están en la lista (p. ej. quitadas por el admin).
    for (const k of Object.keys(c.votos)) if (!ESPECIALES[k] && !filas.some((f) => String(f.o.id) === k)) filas.push({ o: orgDe(s, k), n: c.votos[k] });
    filas.sort((a, b) => b.n - a.n);
    const conVotos = filas.filter((f) => f.n);
    const ceros = filas.filter((f) => !f.n);
    const max = Math.max(1, ...conVotos.map((f) => f.n));
    return html`<div class="card stack">
      <div class="row between"><h2>${SECCIONES[s].titulo}</h2><span class="chip">${fmt(r.emitidos)} votos</span></div>
      ${conVotos.length ? html`<div class="barras">${conVotos.map(({ o, n }, i) => html`
        <div class="barra-org ${i === 0 ? 'primero' : ''}">
          ${logo(o, { chico: true })}
          <span class="nom">${titulo(o.nombre)}</span>
          <span class="val">${fmt(n)}<small>${pct(r.validos ? (100 * n) / r.validos : 0)}</small></span>
          <span class="pista" style="grid-column:2/4"><i style="width:${(100 * n) / max}%"></i></span>
        </div>`)}</div>` : html`<p class="muted small" style="margin:0">Aún no hay votos para organizaciones.</p>`}
      ${ceros.length ? html`<details><summary class="small muted" style="cursor:pointer">${ceros.length} organizaciones con 0 votos</summary>
        <div class="small muted" style="margin-top:4px">${ceros.map((f) => titulo(f.o.nombre)).join(' · ')}</div></details>` : ''}
      <div class="mini-kpis">
        <div><b class="num">${fmt(r.validos)}</b><span>Válidos</span></div>
        <div><b class="num">${fmt(r.blancos)}</b><span>Blancos</span></div>
        <div><b class="num">${fmt(r.nulos)}</b><span>Nulos</span></div>
        <div><b class="num">${fmt(r.impugnados)}</b><span>Impugnados</span></div>
      </div>
    </div>`;
  }

  // Estado general del acta, grande y con color.
  function estadoActa(cuadre, abierta) {
    const tv = acta.total_votantes;
    let clase = 'ok';
    let icono = '✓';
    let titulo_ = 'Todo cuadra';
    let texto = 'Compara estos números con el acta que firma la mesa.';
    if (!cuadre.ok) {
      clase = cuadre.totalIngresado ? 'err' : 'warn';
      icono = cuadre.totalIngresado ? '✕' : '!';
      titulo_ = cuadre.totalIngresado ? 'Aún no cuadra' : 'Falta el total de votantes';
      texto = cuadre.totalIngresado
        ? (cuadre.excedeHabiles ? 'El total que votó es mayor que los electores hábiles.' : `La mayor diferencia es de ${fmt(cuadre.diferenciaMaxima)} voto${cuadre.diferenciaMaxima === 1 ? '' : 's'}.`)
        : 'Anota cuántos ciudadanos votaron según la lista de electores.';
    }
    if (!abierta) {
      titulo_ = acta.cuadra ? 'Acta cerrada · cuadra' : 'Acta cerrada con observación';
      texto = acta.cuadra ? 'Tu resultado ya suma en el consolidado.' : acta.observacion || '';
    }
    return html`<div class="estado-acta ${clase}">
      <div class="row">
        <span class="icono-estado">${icono}</span>
        <div class="grow"><div class="t">${titulo_}</div><div class="d">${texto}</div></div>
      </div>
      <div class="total-votantes">
        <label><span>Total que votó</span>
          <input class="input num" id="tv" inputmode="numeric" maxlength="3" value="${tv ?? ''}" placeholder="—" ${abierta ? '' : 'disabled'}></label>
        <div class="de">de <b class="num">${fmt(acta.mesa.electores_habiles)}</b><span>electores hábiles</span></div>
      </div>
    </div>`;
  }

  // Avance de cada elección contra el total de votantes.
  function avance(cuadre) {
    const ref = cuadre.referencia || 0;
    return html`<div class="avance-elecciones">${secciones.map((s) => {
      const t = cuadre.conteo[s].total;
      const ok = ref > 0 && t === ref && cuadre.totalIngresado;
      const dif = t - ref;
      return html`<button class="tile-eleccion ${ok ? 'ok' : dif ? 'err' : ''} ${s === tabSel ? 'sel' : ''}" data-accion="tab" data-s="${s}">
        <span class="t">${SECCIONES[s].abrev}</span>
        <span class="v num">${fmt(t)}<small>/${fmt(ref)}</small></span>
        <span class="progreso"><i style="width:${ref ? Math.min(100, (100 * t) / ref) : 0}%"></i></span>
        <span class="e">${ok ? '✓ Cuadra' : !cuadre.totalIngresado ? '—' : dif > 0 ? `Sobran ${dif}` : dif < 0 ? `Faltan ${-dif}` : '✓ Cuadra'}</span>
      </button>`;
    })}</div>`;
  }

  function historial() {
    const regs = acta.registros.map((r, i) => ({ r, i })).reverse();
    const abierta = acta.estado === 'borrador';
    return html`<details class="card">
      <summary style="cursor:pointer;font-weight:700">Historial de registros (${fmt(acta.registros.length)})</summary>
      <ul class="historial" style="margin-top:8px">${regs.slice(0, 400).map(({ r, i }) => html`<li>
        <span class="n num">#${i + 1}</span>
        <span class="grow">${Object.entries(r.v).map(([s, op]) => html`<span class="chip" style="margin:2px">${SECCIONES[s].corto.split(' ')[0]}: ${ESPECIALES[op]?.corto || titulo(orgDe(s, op).nombre)}</span>`)}</span>
        ${abierta ? html`<button class="menos" data-accion="borrar" data-i="${i}" aria-label="Eliminar registro">×</button>` : ''}
      </li>`)}</ul>
    </details>`;
  }

  function pintar() {
    const cuadre = evaluarCuadre({
      registros: acta.registros,
      secciones,
      totalVotantes: acta.total_votantes ?? null,
      electoresHabiles: acta.mesa.electores_habiles,
    });
    const abierta = acta.estado === 'borrador';
    const motivo = motivoNoCierre(cuadre);
    app.innerHTML = String(html`
      <div class="encabezado">
        <a class="btn-icono" href="${abierta ? `#/acta/${id}` : '#/mesas'}" aria-label="Volver">${iconos.atras}</a>
        <div class="titulos"><h1>Mesa ${acta.mesa.numero}</h1>
          <div class="sub">${titulo(acta.mesa.distrito)}, ${titulo(acta.mesa.provincia)} · ${titulo(acta.mesa.departamento)}</div></div>
        ${abierta ? botonAyuda('resumen') : ''}
        ${abierta ? html`<span class="chip acc">En conteo</span>` : html`<span class="chip ${acta.cuadra ? 'ok' : 'warn'}">Cerrada</span>`}
      </div>
      <div class="stack-lg">
        ${estadoActa(cuadre, abierta)}
        ${avance(cuadre)}
        ${panelSeccion(tabSel, cuadre.conteo[tabSel])}
        ${historial()}
        <div class="stack">
          ${abierta && !cuadre.ok && motivo ? html`<div class="aviso warn">${motivo}</div>` : ''}
          ${abierta && !cuadre.ok && !motivo ? html`<div class="aviso warn">La diferencia es pequeña. Si la mesa la registró así en el acta oficial, puedes cerrar explicando el motivo.</div>
            <button class="btn bloque" data-accion="forzar">Cerrar con observación</button>` : ''}
          ${abierta ? '' : html`<button class="btn suave bloque" data-accion="reabrir">Reabrir para corregir</button>`}
          ${abierta && !acta.registros.length ? html`<button class="btn peligro bloque" data-accion="eliminar">Eliminar esta mesa</button>` : ''}
        </div>
      </div>
      <div class="barra-accion"><div class="dentro row">
        ${abierta
          ? html`<a class="btn-icono" href="#/acta/${id}" aria-label="Seguir contando">${iconos.atras}</a>
            <button class="btn primario registrar" data-accion="cerrar" ${cuadre.ok ? '' : 'disabled'}>
              ${cuadre.ok ? html`${iconos.check} Cerrar acta y enviar` : 'Aún no cuadra'}</button>`
          : html`<button class="btn-icono" data-accion="copiar" aria-label="Copiar texto">${iconos.copiar}</button>
            <button class="btn primario registrar" data-accion="compartir">${iconos.compartir} Compartir resultado</button>`}
      </div></div>`);

    const tv = app.querySelector('#tv');
    if (tv && abierta) {
      tv.onchange = () => {
        const v = tv.value.replace(/\D/g, '');
        acta.total_votantes = v === '' ? null : Number(v);
        guardar();
        pintar();
      };
    }
  }

  async function cerrar(forzar, observacion) {
    try {
      if (actaLocal(id)?.pendiente) await enviarActa(id);
      const r = await api(`/actas/${id}/cerrar`, { method: 'POST', body: { forzar, observacion } });
      acta = r.acta;
      guardarActaLocal(id, { acta, organizaciones }, { pendiente: false });
      toast('Acta cerrada. Tu resultado ya suma en el consolidado.');
      pintar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast(e.status === 0 ? 'Necesitas conexión para cerrar el acta. Tus votos están guardados.' : e.message, { error: true, duracion: 5000 });
    }
  }

  const texto = () => {
    const cuadre = evaluarCuadre({ registros: acta.registros, secciones, totalVotantes: acta.total_votantes, electoresHabiles: acta.mesa.electores_habiles });
    return `${textoResultado({ mesa: { ...acta.mesa, distrito: titulo(acta.mesa.distrito), provincia: titulo(acta.mesa.provincia), departamento: titulo(acta.mesa.departamento) }, secciones, conteo: cuadre.conteo, nombres: nombres() })}\n\nVotaron: ${acta.total_votantes ?? '-'} de ${acta.mesa.electores_habiles}`;
  };

  app.onclick = async (e) => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    if (a === 'tab') {
      tabSel = b.dataset.s;
      return pintar();
    }
    if (a === 'cerrar') {
      if (await confirmar('¿Cerrar el acta? Ya no podrás registrar más cédulas (podrás reabrirla si hace falta).', { ok: 'Cerrar acta' })) cerrar(false);
    } else if (a === 'forzar') {
      const m = modal(String(html`<form class="stack"><h2>Cerrar con observación</h2>
        <p class="small muted" style="margin:0">El conteo no cuadra por pocos votos. Explica el motivo, por ejemplo: "se extravió una cédula durante el escrutinio" o "la mesa anotó 2 votantes más en la lista".</p>
        <textarea class="input mayus" name="obs" rows="3" maxlength="500" required></textarea>
        <div class="error-campo" id="err-obs"></div>
        <div class="grid-2"><button type="button" class="btn suave" data-cerrar>Cancelar</button><button class="btn primario">Cerrar acta</button></div></form>`));
      m.el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
        const err = errorObservacion(ev.target.obs.value);
        if (err) {
          m.el.querySelector('#err-obs').textContent = err;
          return;
        }
        m.cerrar();
        cerrar(true, ev.target.obs.value);
      };
    } else if (a === 'reabrir') {
      if (!(await confirmar('¿Reabrir el acta? Su resultado dejará de contar en el consolidado hasta que la cierres de nuevo.', { ok: 'Reabrir' }))) return;
      try {
        acta = (await api(`/actas/${id}/reabrir`, { method: 'POST' })).acta;
        guardarActaLocal(id, { acta, organizaciones }, { pendiente: false });
        pintar();
      } catch (err) {
        toast(err.message, { error: true });
      }
    } else if (a === 'borrar') {
      const i = Number(b.dataset.i);
      if (!(await confirmar(`¿Eliminar el registro #${i + 1}?`, { ok: 'Eliminar', peligro: true }))) return;
      acta.registros = acta.registros.filter((_, j) => j !== i);
      guardar();
      pintar();
    } else if (a === 'compartir') {
      const t = texto();
      if (navigator.share) navigator.share({ text: t }).catch(() => {});
      else window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, '_blank');
    } else if (a === 'copiar') {
      try {
        await navigator.clipboard.writeText(texto());
        toast('Resultado copiado');
      } catch {
        toast('No se pudo copiar', { error: true });
      }
    } else if (a === 'eliminar') {
      if (!(await confirmar('¿Eliminar esta mesa de tu lista?', { ok: 'Eliminar', peligro: true }))) return;
      try {
        await api(`/actas/${id}`, { method: 'DELETE' });
        local.del(`acta:${id}`);
        location.hash = '#/mesas';
      } catch (err) {
        toast(err.message, { error: true });
      }
    }
  };
  pintar();
  if (acta.estado === 'borrador') guia('resumen');
  return () => { app.onclick = null; };
}
