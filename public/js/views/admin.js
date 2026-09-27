import { api, local, sesion } from '../api.js';
import { SECCIONES } from '/shared/acta.js';
import { cargarUbigeo, enlazarUbigeo, selectoresUbigeo } from '../ubigeo.js';
import { cargando, confirmar, fmt, html, logo, modal, titulo, toast } from '../ui.js';
import { enModoPrueba, inicio, sincronizarJornada } from '../jornada.js';

export async function vistaAdmin(app) {
  if (sesion.usuario?.rol !== 'admin') {
    location.hash = '#/mesas';
    return;
  }
  await cargarUbigeo();
  let tab = local.get('adminTab', 'organizaciones');
  let ubigeo = local.get('adminUbigeo', local.get('ultimoUbigeo', ''));
  let contenido = cargando();

  const pintar = () => {
    app.innerHTML = String(html`
      <div class="encabezado"><div class="titulos"><h1>Administración</h1><div class="sub">Organizaciones, actas y personeros</div></div></div>
      <div class="segmentado" style="margin-bottom:16px">
        ${[['organizaciones', 'Organizaciones'], ['actas', 'Actas'], ['usuarios', 'Personeros']].map(([k, t]) => html`
          <button data-tab="${k}" class="${tab === k ? 'activo' : ''}">${t}</button>`)}
      </div>
      ${tab !== 'usuarios' ? html`<div class="card" style="margin-bottom:16px">${selectoresUbigeo(ubigeo, { opcional: tab === 'actas' })}</div>` : ''}
      <div id="contenido">${contenido}</div>`);
    enlazarUbigeo(app, (u) => {
      ubigeo = u;
      local.set('adminUbigeo', u);
      cargar();
    }, { opcional: tab === 'actas' });
  };

  const setContenido = (c) => {
    contenido = c;
    const el = app.querySelector('#contenido');
    if (el) el.innerHTML = String(c);
  };

  async function cargarOrganizaciones() {
    if (ubigeo.length !== 6) return setContenido(html`<div class="aviso">Elige un distrito para ver y editar las organizaciones de cada elección.</div>`);
    const r = await api(`/organizaciones?ubigeo=${ubigeo}`);
    setContenido(html`
      <div class="stack-lg">
        <div class="card stack">
          <div class="row between wrap">
            <div><b>${titulo(r.ubigeo.distrito)}</b><div class="small muted">Código RENIEC para el JNE: ${r.ubigeo.reniec || 'no disponible'}</div></div>
            <button class="btn primario chico" data-accion="jne">Sincronizar con el JNE</button>
          </div>
          ${r.jne && !r.jne.ok ? html`<div class="aviso warn small">Consulta automática al JNE falló: ${r.jne.error}</div>` : ''}
          <p class="small muted" style="margin:0">Fuente: API pública de Voto Informado (JNE). Si no responde, puedes cargar las organizaciones manualmente en cada elección.</p>
        </div>
        ${Object.entries(r.secciones).map(([s, info]) => html`<div class="card stack">
          <div class="row between"><h2>${SECCIONES[s].titulo}</h2><span class="chip">${info.organizaciones.length}</span></div>
          <div class="small muted">Circunscripción ${info.ambito}${info.sincronizado ? ` · actualizado ${info.sincronizado.actualizado_en} (${info.sincronizado.fuente})` : ' · sin datos del JNE'}</div>
          <div class="stack">${info.organizaciones.map((o) => html`<div class="row">
            <input class="input num" style="width:64px;min-height:40px;padding:6px" value="${o.orden}" data-orden="${o.circ_id}" aria-label="Orden en la cédula">
            ${logo(o, { chico: true })}
            <div class="grow small"><b>${titulo(o.nombre)}</b> <span class="chip">${o.fuente}</span></div>
            <button class="menos" data-quitar="${o.circ_id}" aria-label="Quitar">×</button>
          </div>`)}</div>
          <form class="row" data-agregar="${s}">
            <input class="input grow" name="nombre" placeholder="Agregar organización manualmente">
            <button class="btn chico">Agregar</button>
          </form>
        </div>`)}
      </div>`);
  }

  async function cargarActas() {
    const { actas } = await api(`/admin/actas?ubigeo=${ubigeo}`);
    const cerradas = actas.filter((a) => a.estado === 'cerrada').length;
    setContenido(html`<div class="card stack" style="margin-bottom:16px">
      <h2>Datos de prueba</h2>
      <p class="small muted" style="margin:0">${enModoPrueba()
        ? `Se borran automáticamente el ${inicio()?.toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'full', timeStyle: 'short' })}.`
        : 'La jornada ya empezó: borrar ahora eliminaría los conteos reales.'}
        Se borran mesas, actas y votos; las cuentas de los personeros se conservan.</p>
      <button class="btn peligro chico" data-accion="limpiar">Borrar todas las mesas y actas ahora</button>
    </div>
    <div class="card stack">
      <div class="row between"><h2>Actas</h2><span class="small muted">${fmt(cerradas)} cerradas de ${fmt(actas.length)}</span></div>
      ${actas.length ? html`<div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Mesa</th><th>Personero</th><th>Estado</th><th class="n">Cédulas</th></tr></thead>
        <tbody>${actas.map((a) => html`<tr>
          <td><b class="num">${a.numero}</b><div class="small muted">${titulo(a.distrito)}</div></td>
          <td class="small">${a.personero}${a.organizacion ? html`<div class="muted">${a.organizacion}</div>` : ''}</td>
          <td><span class="chip ${a.estado === 'cerrada' ? (a.cuadra ? 'ok' : 'warn') : 'acc'}">${a.estado === 'cerrada' ? (a.cuadra ? 'Cerrada' : 'Con obs.') : 'En conteo'}</span>
            ${a.observacion ? html`<div class="small muted">${a.observacion}</div>` : ''}</td>
          <td class="n">${fmt(a.cedulas)}${a.total_votantes != null ? `/${fmt(a.total_votantes)}` : ''}</td>
        </tr>`)}</tbody></table></div>` : html`<p class="muted">No hay actas en este ámbito.</p>`}
    </div>`);
  }

  async function cargarUsuarios() {
    const { usuarios } = await api('/admin/usuarios');
    setContenido(html`<div class="card stack">
      <h2>Personeros registrados (${fmt(usuarios.length)})</h2>
      <div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Nombre</th><th class="n">Actas</th><th>Rol</th></tr></thead>
        <tbody>${usuarios.map((u) => html`<tr>
          <td><b>${u.nombre}</b> ${u.dni_verificado ? html`<span class="chip ok verif" title="Verificado con RENIEC"></span>` : ''}
            <div class="small muted">DNI ${u.dni}${u.telefono ? ` · ${u.telefono}` : ''}${u.email ? ` · ${u.email}` : ''}</div>
            ${u.organizacion ? html`<div class="small muted">${u.organizacion}</div>` : ''}</td>
          <td class="n">${fmt(u.cerradas)}/${fmt(u.actas)}</td>
          <td><select class="input" style="min-height:36px;padding:4px 8px" data-rol="${u.id}">
            <option value="personero" ${u.rol === 'personero' ? 'selected' : ''}>Personero</option>
            <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Admin</option></select></td>
        </tr>`)}</tbody></table></div>
    </div>`);
  }

  async function cargar() {
    setContenido(cargando());
    try {
      if (tab === 'organizaciones') await cargarOrganizaciones();
      else if (tab === 'actas') await cargarActas();
      else await cargarUsuarios();
    } catch (e) {
      setContenido(html`<div class="aviso err">${e.message}</div>`);
    }
  }

  app.onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      local.set('adminTab', tab);
      if (tab === 'organizaciones' && ubigeo.length !== 6) ubigeo = local.get('ultimoUbigeo', '');
      pintar();
      return cargar();
    }
    if (e.target.closest('[data-accion=limpiar]')) {
      const m = modal(`<form class="stack"><h2>¿Borrar todas las mesas y actas?</h2>
        <p class="small muted" style="margin:0">No se puede deshacer. Escribe <b>BORRAR</b> para confirmar.</p>
        <input class="input" name="c" autocomplete="off">
        <div class="grid-2"><button type="button" class="btn suave" data-cerrar>Cancelar</button><button class="btn peligro">Borrar</button></div></form>`);
      m.el.querySelector('form').onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          const r = await api('/admin/limpiar-prueba', { method: 'POST', body: { confirmar: ev.target.c.value.trim().toUpperCase() } });
          m.cerrar();
          toast(`Listo: se borraron ${r.limpieza.actas_borradas} actas`);
          await sincronizarJornada({ forzar: true });
          cargar();
        } catch (err) {
          toast(err.message, { error: true });
        }
      };
      return;
    }
    if (e.target.closest('[data-accion=jne]')) {
      e.target.disabled = true;
      try {
        const r = await api(`/admin/jne/${ubigeo}`, { method: 'POST' });
        toast(`JNE: ${Object.entries(r.resumen).map(([s, n]) => `${SECCIONES[s].corto} ${n}`).join(', ') || 'sin cambios'}`);
        cargar();
      } catch (err) {
        toast(err.message, { error: true, duracion: 6000 });
        e.target.disabled = false;
      }
    }
    const q = e.target.closest('[data-quitar]');
    if (q && (await confirmar('¿Quitar esta organización de la cédula de esta circunscripción?', { ok: 'Quitar', peligro: true }))) {
      try {
        await api(`/circunscripcion/${q.dataset.quitar}`, { method: 'DELETE' });
        cargar();
      } catch (err) {
        toast(err.message, { error: true });
      }
    }
  };
  app.onchange = async (e) => {
    const o = e.target.dataset.orden;
    const r = e.target.dataset.rol;
    try {
      if (o) {
        await api(`/circunscripcion/${o}`, { method: 'PATCH', body: { orden: Number(e.target.value) } });
        toast('Orden actualizado');
        cargar();
      } else if (r) {
        await api(`/admin/usuarios/${r}`, { method: 'PATCH', body: { rol: e.target.value } });
        toast('Rol actualizado');
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
  app.onsubmit = async (e) => {
    const s = e.target.dataset.agregar;
    if (!s) return;
    e.preventDefault();
    try {
      await api('/organizaciones', { method: 'POST', body: { seccion: s, ubigeo, nombre: e.target.nombre.value } });
      cargar();
    } catch (err) {
      toast(err.message, { error: true });
    }
  };

  pintar();
  cargar();
  return () => {
    app.onclick = app.onchange = app.onsubmit = null;
  };
}
