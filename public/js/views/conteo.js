import { actaLocal, alCambiarSync, api, guardarActaLocal, local } from '../api.js';
import { ESPECIALES, SECCIONES, contar, motivoTope } from '/shared/acta.js';
import { $, botonAyuda, cargando, confirmar, fmt, html, iconos, logo, logoEspecial, modal, palitos, titulo, toast, vibrar } from '../ui.js';
import { guia } from '../guia.js';

const nuevoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Carga el acta priorizando cambios locales que aún no llegan al servidor. */
export async function cargarActa(id) {
  const l = actaLocal(id);
  try {
    const r = await api(`/actas/${id}`);
    if (r.jne && !r.jne.ok) console.warn('JNE:', r.jne.error);
    const acta = l?.pendiente && r.acta.estado === 'borrador'
      ? { ...r.acta, registros: l.acta.registros, total_votantes: l.acta.total_votantes, modo: l.acta.modo }
      : r.acta;
    guardarActaLocal(id, { acta, organizaciones: r.organizaciones }, { pendiente: !!l?.pendiente && r.acta.estado === 'borrador' });
    return { acta, organizaciones: r.organizaciones, jne: r.jne };
  } catch (e) {
    if (l) return { acta: l.acta, organizaciones: l.organizaciones, offline: true };
    throw e;
  }
}

export async function vistaConteo(app, id) {
  app.innerHTML = String(cargando());
  let { acta, organizaciones, jne } = await cargarActa(id);
  if (acta.estado === 'cerrada') {
    location.replace(`#/acta/${id}/resumen`);
    return;
  }
  if (jne && !jne.ok) toast(`No se pudo actualizar desde el JNE: ${jne.error}`, { error: true, duracion: 5000 });

  const secciones = acta.secciones;
  let modo = acta.registros.length ? acta.modo : local.get('modoPreferido', acta.modo || 'cedula');
  let paso = 0;
  let seleccion = {};
  let tab = secciones[0];
  let sync = actaLocal(id)?.pendiente ? 'pendiente' : 'ok';
  let ultimoTocado = null;

  const orgsDe = (s) => organizaciones?.[s]?.organizaciones || [];
  const nombreOpcion = (s, op) => ESPECIALES[op]?.corto || orgsDe(s).find((o) => String(o.id) === op)?.nombre || `Org. ${op}`;

  function persistir() {
    guardarActaLocal(id, { acta: { ...acta, modo }, organizaciones });
    sync = 'pendiente';
  }

  function agregarRegistro(v) {
    acta.registros = [...acta.registros, { id: nuevoId(), ts: Date.now(), v }];
    persistir();
    vibrar();
  }

  // Si ya se anotó cuántos votaron, avisa al pasarse (puede ser un error de conteo o del total).
  function avisarTotalVotantes() {
    const tv = acta.total_votantes;
    if (tv == null) return;
    const max = Math.max(0, ...secciones.map((s) => contar(acta.registros, secciones)[s].total));
    if (max === tv + 1) toast(`Ojo: ya hay más cédulas (${max}) que ciudadanos que votaron (${tv}). Revisa el conteo o el total.`, { error: true, duracion: 6000 });
  }

  function deshacer() {
    const ultimo = acta.registros.at(-1);
    if (!ultimo) return toast('No hay nada que deshacer');
    acta.registros = acta.registros.slice(0, -1);
    persistir();
    toast(`Se quitó: ${Object.entries(ultimo.v).map(([s, op]) => nombreOpcion(s, op)).join(' · ')}`);
    pintar();
  }

  // ---- Pintado -----------------------------------------------------------
  function cabecera(conteo) {
    const cedulas = Math.max(0, ...secciones.map((s) => conteo[s].total));
    const txtSync = { ok: 'Guardado', pendiente: 'Guardando…', offline: 'Sin señal: guardado en el celular', error: 'Error al guardar' }[sync];
    return html`<div class="cabecera-conteo">
      <div class="row">
        <a class="btn-icono" href="#/mesas" aria-label="Volver">${iconos.atras}</a>
        <div class="grow">
          <div style="font-weight:800">Mesa ${acta.mesa.numero}</div>
          <div class="small muted ellipsis">${titulo(acta.mesa.distrito)} · ${titulo(acta.mesa.provincia)}</div>
          <span class="sync ${sync === 'ok' ? 'ok' : 'pendiente'}" id="sync">${txtSync}</span>
        </div>
        ${botonAyuda(modo === 'cedula' ? 'conteo' : 'conteo-seccion')}
        <div class="contador ${cedulas >= acta.mesa.electores_habiles ? 'lleno' : ''}"><b class="num" id="contador">${fmt(cedulas)}</b><span>de ${fmt(acta.mesa.electores_habiles)}</span></div>
      </div>
      <div class="segmentado" style="margin-top:10px" data-guia="modo">
        <button data-accion="modo" data-modo="cedula" class="${modo === 'cedula' ? 'activo' : ''}">Por cédula</button>
        <button data-accion="modo" data-modo="seccion" class="${modo === 'seccion' ? 'activo' : ''}">Por elección</button>
      </div>
    </div>`;
  }

  function sinOrganizaciones(s) {
    return html`<div class="aviso warn stack">
      <div>No hay organizaciones cargadas para <b>${SECCIONES[s].titulo}</b> en esta circunscripción.
      El sistema intenta traerlas del JNE; si no hay conexión con el JNE, agrégalas tal como aparecen en la cédula.</div>
      <button class="btn chico" data-accion="agregar-org" data-seccion="${s}">${iconos.mas} Agregar organización</button>
    </div>`;
  }

  function vistaCedula(conteo) {
    const s = secciones[paso];
    const sel = seleccion[s];
    const completa = secciones.every((x) => seleccion[x]);
    // Atajo para el voto "en plancha": misma organización en todas las elecciones.
    const primeraOrg = Object.values(seleccion).find((op) => !ESPECIALES[op]);
    const repetibles = primeraOrg ? secciones.filter((x) => !seleccion[x] && orgsDe(x).some((o) => String(o.id) === primeraOrg)) : [];
    const orgs = orgsDe(s);
    return html`
      <div class="pasos">${secciones.map((x, i) => html`<button class="paso ${i === paso ? 'actual' : ''} ${seleccion[x] ? 'lleno' : ''}" data-accion="paso" data-i="${i}">
        <span class="t">${SECCIONES[x].abrev}</span>
        <span class="v">${seleccion[x] ? titulo(nombreOpcion(x, seleccion[x])) : html`<span class="muted">Elegir</span>`}</span>
      </button>`)}</div>
      ${repetibles.length ? html`<button class="btn suave bloque chico" data-accion="repetir" style="margin-bottom:12px">
        Marcar ${titulo(nombreOpcion(secciones.find((x) => seleccion[x] === primeraOrg), primeraOrg))} en las ${repetibles.length} restantes</button>` : ''}
      <section id="seccion-actual" style="scroll-margin-top:150px">
        <div class="row between" style="margin-bottom:10px">
          <h2>${SECCIONES[s].titulo}</h2>
          <span class="chip">${fmt(conteo[s].total)} votos</span>
        </div>
        ${orgs.length ? '' : sinOrganizaciones(s)}
        <div class="opciones dos">${orgs.map((o) => {
          const k = String(o.id);
          return html`<button class="opcion ${sel === k ? 'sel' : ''}" data-accion="elegir" data-op="${k}">
            ${logo(o)}<span class="nombre">${titulo(o.nombre)}</span>
            <span class="cuenta num">${conteo[s].votos[k] || 0}</span>
            <span class="check">${iconos.check}</span>
          </button>`;
        })}</div>
        <div class="especiales">${Object.values(ESPECIALES).map((e) => html`<button class="opcion ${sel === e.id ? 'sel' : ''}" data-accion="elegir" data-op="${e.id}">
          <span class="nombre">${e.corto}</span><span class="cuenta num">${conteo[s].votos[e.id] || 0}</span></button>`)}</div>
        ${orgs.length ? html`<button class="btn chico suave" data-accion="agregar-org" data-seccion="${s}" style="margin-top:12px">${iconos.mas} Falta una organización</button>` : ''}
      </section>
      <div class="barra-accion"><div class="dentro row">
        <button class="btn-icono" data-accion="deshacer" aria-label="Deshacer última">${iconos.deshacer}</button>
        <button class="btn primario registrar" data-accion="registrar" ${completa ? '' : 'disabled'}>
          ${completa ? `Registrar cédula #${fmt(acta.registros.length + 1)}` : (secciones.filter((x) => !seleccion[x]).length === 1 ? 'Falta 1 elección' : `Faltan ${secciones.filter((x) => !seleccion[x]).length} elecciones`)}</button>
        <a class="btn-icono" href="#/acta/${id}/resumen" aria-label="Resumen y cuadre" data-guia="resumen">${iconos.lista}</a>
      </div></div>`;
  }

  function filaSeccion(s, k, conteo, cabezal) {
    const n = conteo[s].votos[k] || 0;
    return html`<div class="fila-seccion">
      ${cabezal}
      <div class="info"><div class="nombre">${ESPECIALES[k] ? ESPECIALES[k].nombre : titulo(nombreOpcion(s, k))}</div>${palitos(n)}</div>
      <span class="cuenta num ${ultimoTocado === `${s}:${k}` ? 'pulso' : ''}">${n}</span>
      <button class="menos" data-accion="menos" data-op="${k}" aria-label="Quitar uno">−</button>
      <button class="mas" data-accion="mas" data-op="${k}" aria-label="Sumar uno">+</button>
    </div>`;
  }

  function vistaSeccion(conteo) {
    const orgs = orgsDe(tab);
    return html`
      <div class="segmentado" style="margin:12px 0;overflow-x:auto" data-guia="tabs-seccion">${secciones.map((s) => html`<button data-accion="tab" data-s="${s}" class="${s === tab ? 'activo' : ''}">
        ${SECCIONES[s].corto}<br><small class="num">${conteo[s].total}</small></button>`)}</div>
      <h2 style="margin-bottom:10px">${SECCIONES[tab].titulo}</h2>
      ${orgs.length ? '' : sinOrganizaciones(tab)}
      <div class="stack">
        ${orgs.map((o) => filaSeccion(tab, String(o.id), conteo, logo(o)))}
        ${Object.keys(ESPECIALES).map((k) => filaSeccion(tab, k, conteo, logoEspecial(k)))}
      </div>
      ${orgs.length ? html`<button class="btn chico suave" data-accion="agregar-org" data-seccion="${tab}" style="margin-top:12px">${iconos.mas} Falta una organización</button>` : ''}
      <div class="barra-accion"><div class="dentro row">
        <button class="btn-icono" data-accion="deshacer" aria-label="Deshacer última">${iconos.deshacer}</button>
        <a class="btn primario registrar" href="#/acta/${id}/resumen" data-guia="resumen">Resumen y cuadre</a>
      </div></div>`;
  }

  function pintar() {
    const conteo = contar(acta.registros, secciones);
    app.innerHTML = String(html`${cabecera(conteo)}${modo === 'cedula' ? vistaCedula(conteo) : vistaSeccion(conteo)}`);
  }

  // ---- Acciones ----------------------------------------------------------
  function siguientePaso() {
    const libre = secciones.findIndex((x, i) => i > paso && !seleccion[x]);
    const cualquiera = secciones.findIndex((x) => !seleccion[x]);
    paso = libre >= 0 ? libre : cualquiera >= 0 ? cualquiera : paso;
  }

  async function agregarOrganizacion(seccion) {
    const m = modal(String(html`<form class="stack">
      <h2>Agregar organización</h2>
      <p class="small muted" style="margin:0">${SECCIONES[seccion].titulo}. Escríbela como figura en la cédula; quedará disponible para todos los personeros de esta circunscripción.</p>
      <input class="input" name="nombre" placeholder="Nombre de la organización política" required>
      <div class="grid-2"><button type="button" class="btn suave" data-cerrar>Cancelar</button><button class="btn primario">Agregar</button></div>
    </form>`));
    m.el.querySelector('input').focus();
    m.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/organizaciones', { method: 'POST', body: { seccion, ubigeo: acta.mesa.ubigeo, nombre: e.target.nombre.value } });
        organizaciones = r.secciones;
        guardarActaLocal(id, { acta: { ...acta, modo }, organizaciones }, { pendiente: !!actaLocal(id)?.pendiente });
        m.cerrar();
        pintar();
        toast('Organización agregada');
      } catch (err) {
        toast(err.message, { error: true });
      }
    };
  }

  const alClick = async (e) => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const accion = b.dataset.accion;
    if (accion === 'modo') {
      modo = b.dataset.modo;
      local.set('modoPreferido', modo);
      persistir();
      pintar();
      return guia(modo === 'cedula' ? 'conteo' : 'conteo-seccion');
    } else if (accion === 'paso') {
      paso = Number(b.dataset.i);
    } else if (accion === 'elegir') {
      const s = secciones[paso];
      seleccion = { ...seleccion, [s]: b.dataset.op };
      vibrar(15);
      siguientePaso();
      pintar();
      $('#seccion-actual')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    } else if (accion === 'repetir') {
      const org = Object.values(seleccion).find((op) => !ESPECIALES[op]);
      for (const x of secciones) if (!seleccion[x] && orgsDe(x).some((o) => String(o.id) === org)) seleccion[x] = org;
      siguientePaso();
    } else if (accion === 'registrar') {
      if (!secciones.every((x) => seleccion[x])) return;
      const tope = motivoTope(contar(acta.registros, secciones), secciones, acta.mesa.electores_habiles);
      if (tope) return toast(tope, { error: true, duracion: 6000 });
      agregarRegistro(seleccion);
      avisarTotalVotantes();
      seleccion = {};
      paso = 0;
      toast(`Cédula #${acta.registros.length} registrada`, { accion: 'Deshacer', alAccion: deshacer, duracion: 2500 });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (accion === 'deshacer') {
      if (modo === 'cedula' && Object.keys(seleccion).length) {
        seleccion = {};
        paso = 0;
        toast('Selección limpiada');
      } else {
        if (!acta.registros.length) return toast('No hay nada que deshacer');
        if (!(await confirmar('¿Quitar el último registro?', { ok: 'Quitar' }))) return;
        return deshacer();
      }
    } else if (accion === 'tab') {
      tab = b.dataset.s;
      ultimoTocado = null;
    } else if (accion === 'mas') {
      const tope = motivoTope(contar(acta.registros, secciones), secciones, acta.mesa.electores_habiles, tab);
      if (tope) return toast(tope, { error: true, duracion: 6000 });
      agregarRegistro({ [tab]: b.dataset.op });
      avisarTotalVotantes();
      ultimoTocado = `${tab}:${b.dataset.op}`;
    } else if (accion === 'menos') {
      const op = b.dataset.op;
      const i = acta.registros.findLastIndex((r) => r.v[tab] === op && Object.keys(r.v).length === 1);
      if (i < 0) {
        const enCedula = acta.registros.some((r) => r.v[tab] === op);
        return toast(enCedula ? 'Ese voto vino de una cédula completa: quítalo desde el historial en el resumen.' : 'No hay votos que quitar', { duracion: 4000 });
      }
      acta.registros = acta.registros.filter((_, j) => j !== i);
      persistir();
      ultimoTocado = `${tab}:${op}`;
    } else if (accion === 'agregar-org') {
      return agregarOrganizacion(b.dataset.seccion);
    }
    pintar();
  };

  app.addEventListener('click', alClick);
  const quitarSync = alCambiarSync((actaId, estado) => {
    if (String(actaId) !== String(id)) return;
    sync = estado;
    const el = $('#sync');
    if (el) {
      el.className = `sync ${estado === 'ok' ? 'ok' : 'pendiente'}`;
      el.textContent = { ok: 'Guardado', pendiente: 'Guardando…', offline: 'Sin señal: guardado en el celular', error: 'Error al guardar' }[estado];
    }
  });
  pintar();
  guia(modo === 'cedula' ? 'conteo' : 'conteo-seccion');
  return () => {
    app.removeEventListener('click', alClick);
    quitarSync();
  };
}
