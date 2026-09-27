import { actaLocal, api, local, sesion } from '../api.js';
import { confirmar, html, titulo, toast } from '../ui.js';

export async function vistaCuenta(app) {
  let u = sesion.usuario;
  try {
    ({ usuario: u } = await api('/me'));
    sesion.guardar({ usuario: u });
  } catch { /* sin conexión: se usa lo guardado */ }
  const pendientes = local.claves('acta:').filter((k) => actaLocal(k.slice(5))?.pendiente).length;
  app.innerHTML = String(html`
    <div class="encabezado"><div class="titulos"><h1>Mi cuenta</h1></div></div>
    <div class="stack-lg">
      <div class="card stack">
        <div><div class="small muted">Nombre</div><b>${titulo(u?.nombre)}</b></div>
        <div class="grid-2">
          <div><div class="small muted">DNI</div><b class="num">${u?.dni}</b></div>
          <div><div class="small muted">Rol</div><span class="chip ${u?.rol === 'admin' ? 'acc' : ''}">${u?.rol === 'admin' ? 'Administrador' : 'Personero'}</span></div>
        </div>
        <div><div class="small muted">Correo</div>${u?.email}</div>
        ${u?.telefono ? html`<div><div class="small muted">Celular</div>${u.telefono}</div>` : ''}
        ${u?.organizacion ? html`<div><div class="small muted">Organización</div>${u.organizacion}</div>` : ''}
      </div>
      ${pendientes ? html`<div class="aviso warn">Tienes ${pendientes} acta(s) con cambios sin enviar. Conéctate a internet antes de cerrar sesión.</div>` : ''}
      <button class="btn peligro bloque" id="salir">Cerrar sesión</button>
      <p class="small muted" style="text-align:center">Conteo ERM 2026 · herramienta de apoyo para personeros.<br>El resultado oficial es el de las actas electorales y la ONPE.</p>
    </div>`);
  app.querySelector('#salir').onclick = async () => {
    const msg = pendientes ? 'Tienes cambios sin enviar que se perderán. ¿Cerrar sesión igual?' : '¿Cerrar sesión?';
    if (!(await confirmar(msg, { ok: 'Cerrar sesión', peligro: !!pendientes }))) return;
    sesion.salir();
    toast('Sesión cerrada');
    location.hash = '#/login';
  };
}
