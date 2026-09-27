import { actaLocal, api, enviarActa, guardarActaLocal, local } from '../api.js';
import { ESPECIALES, SECCIONES, evaluarCuadre, resumenSeccion, textoResultado } from '/shared/acta.js';
import { cargando, confirmar, fmt, html, iconos, logo, modal, palitos, titulo, toast } from '../ui.js';
import { cargarActa } from './conteo.js';

export async function vistaResumen(app, id) {
  app.innerHTML = String(cargando());
  let { acta, organizaciones } = await cargarActa(id);
  const secciones = acta.secciones;

  const orgDe = (s, k) => organizaciones?.[s]?.organizaciones.find((o) => String(o.id) === k) || { id: k, nombre: `Org. ${k}` };
  const nombres = () => {
    const n = {};
    for (const s of secciones) for (const o of organizaciones?.[s]?.organizaciones || []) n[o.id] = titulo(o.nombre);
    return n;
  };
  const guardar = () => guardarActaLocal(id, { acta, organizaciones });

  function tablaSeccion(s, c) {
    const r = resumenSeccion(c);
    const filas = (organizaciones?.[s]?.organizaciones || []).map((o) => ({ o, n: c.votos[String(o.id)] || 0 }));
    // Votos a organizaciones que ya no están en la lista (p. ej. quitadas por el admin).
    for (const k of Object.keys(c.votos)) if (!ESPECIALES[k] && !filas.some((f) => String(f.o.id) === k)) filas.push({ o: orgDe(s, k), n: c.votos[k] });
    filas.sort((a, b) => b.n - a.n);
    const ceros = filas.filter((f) => !f.n);
    return html`<div class="card stack">
      <div class="row between"><h2>${SECCIONES[s].titulo}</h2><span class="chip">${fmt(r.emitidos)}</span></div>
      <div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Organización</th><th class="n">Votos</th></tr></thead>
        <tbody>
          ${filas.filter((f) => f.n).map(({ o, n }) => html`<tr><td><div class="row">${logo(o, { chico: true })}<div class="grow"><div>${titulo(o.nombre)}</div>${palitos(n, { max: 60 })}</div></div></td><td class="n"><b>${fmt(n)}</b></td></tr>`)}
          ${ceros.length ? html`<tr class="sub"><td colspan="2"><details><summary class="small" style="cursor:pointer">${ceros.length} organizaciones con 0 votos</summary>
            <div class="small muted" style="margin-top:4px">${ceros.map((f) => titulo(f.o.nombre)).join(' · ')}</div></details></td></tr>` : ''}
          <tr class="sub"><td>Votos válidos</td><td class="n">${fmt(r.validos)}</td></tr>
          <tr class="sub"><td>Votos en blanco</td><td class="n">${fmt(r.blancos)}</td></tr>
          <tr class="sub"><td>Votos nulos</td><td class="n">${fmt(r.nulos)}</td></tr>
          <tr class="sub"><td>Votos impugnados</td><td class="n">${fmt(r.impugnados)}</td></tr>
          <tr class="total"><td>Total de votos emitidos</td><td class="n">${fmt(r.emitidos)}</td></tr>
        </tbody>
      </table></div>
    </div>`;
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
    app.innerHTML = String(html`
      <div class="encabezado">
        <a class="btn-icono" href="${abierta ? `#/acta/${id}` : '#/mesas'}" aria-label="Volver">${iconos.atras}</a>
        <div class="titulos"><h1>Mesa ${acta.mesa.numero}</h1>
          <div class="sub">${titulo(acta.mesa.distrito)}, ${titulo(acta.mesa.provincia)} · ${titulo(acta.mesa.departamento)}</div></div>
        ${abierta ? html`<span class="chip acc">En conteo</span>` : html`<span class="chip ${acta.cuadra ? 'ok' : 'warn'}">Cerrada</span>`}
      </div>
      <div class="stack-lg">
        <div class="card stack">
          <h2>Cuadre del acta</h2>
          <div class="grid-2">
            <label class="campo"><span>Total que votó</span>
              <input class="input num" id="tv" inputmode="numeric" value="${acta.total_votantes ?? ''}" placeholder="Total" ${abierta ? '' : 'disabled'}></label>
            <label class="campo"><span>Electores hábiles</span><input class="input num" value="${acta.mesa.electores_habiles}" disabled></label>
          </div>
          <ul class="checks">${cuadre.checks.map((c) => html`<li class="${c.nivel}"><span class="ic">${c.ok ? '✓' : c.nivel === 'warn' ? '!' : '✕'}</span><span>${c.msg}</span></li>`)}</ul>
          ${cuadre.ok ? html`<div class="aviso ok"><b>Todo cuadra.</b> Compara estos números con el acta que firma la mesa.</div>` : ''}
          ${acta.observacion ? html`<div class="aviso warn"><b>Observación:</b> ${acta.observacion}</div>` : ''}
        </div>
        ${secciones.map((s) => tablaSeccion(s, cuadre.conteo[s]))}
        ${historial()}
        <div class="stack">
          ${abierta
            ? html`
              <button class="btn primario bloque" data-accion="cerrar" ${cuadre.ok ? '' : 'disabled'}>${iconos.check} Cerrar acta y enviar resultado</button>
              ${cuadre.ok ? '' : html`<button class="btn bloque" data-accion="forzar">Cerrar con observación</button>`}
              <a class="btn suave bloque" href="#/acta/${id}">Seguir contando</a>`
            : html`
              <button class="btn primario bloque" data-accion="compartir">${iconos.compartir} Compartir resultado</button>
              <button class="btn bloque" data-accion="copiar">Copiar texto</button>
              <button class="btn suave bloque" data-accion="reabrir">Reabrir para corregir</button>`}
          ${abierta && !acta.registros.length ? html`<button class="btn peligro bloque" data-accion="eliminar">Eliminar esta mesa</button>` : ''}
        </div>
      </div>`);

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
    if (a === 'cerrar') {
      if (await confirmar('¿Cerrar el acta? Ya no podrás registrar más cédulas (podrás reabrirla si hace falta).', { ok: 'Cerrar acta' })) cerrar(false);
    } else if (a === 'forzar') {
      const m = modal(String(html`<form class="stack"><h2>Cerrar con observación</h2>
        <p class="small muted" style="margin:0">El conteo no cuadra. Explica el motivo (p. ej. "la mesa contabilizó 2 cédulas más", "se perdió una cédula").</p>
        <textarea class="input" name="obs" rows="3" required minlength="5"></textarea>
        <div class="grid-2"><button type="button" class="btn suave" data-cerrar>Cancelar</button><button class="btn primario">Cerrar acta</button></div></form>`));
      m.el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
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
  return () => { app.onclick = null; };
}
