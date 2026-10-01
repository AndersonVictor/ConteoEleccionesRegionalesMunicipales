import { actaLocal, api, local, sesion } from '../api.js';
import { confirmar, html, toast } from '../ui.js';
import { reiniciarGuias } from '../guia.js';
import { cambiarTema, temaActual } from '../tema.js';

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
        <div><div class="small muted">Nombre</div><b>${u?.nombre}</b>
          ${u?.dni_verificado ? html` <span class="chip ok verif">Verificado con RENIEC</span>` : html` <span class="chip warn">Sin verificar</span>`}</div>
        <div class="grid-2">
          <div><div class="small muted">DNI</div><b class="num">${u?.dni}</b></div>
          <div><div class="small muted">Rol</div><span class="chip ${u?.rol === 'admin' ? 'acc' : ''}">${u?.rol === 'admin' ? 'Administrador' : 'Personero'}</span></div>
        </div>
        <div><div class="small muted">Correo</div>${u?.email || html`<span class="muted">No registrado (opcional)</span>`}</div>
        ${u?.telefono ? html`<div><div class="small muted">Celular</div>${u.telefono}</div>` : ''}
        ${u?.organizacion ? html`<div><div class="small muted">Organización</div>${u.organizacion}</div>` : ''}
      </div>
      ${pendientes ? html`<div class="aviso warn">Tienes ${pendientes} acta(s) con cambios sin enviar. Conéctate a internet antes de cerrar sesión.</div>` : ''}
      <div class="card stack">
        <b>Apariencia</b>
        <div class="segmentado" id="tema">
          ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, t]) => html`<button data-t="${k}" class="${temaActual() === k ? 'activo' : ''}">${t}</button>`)}
        </div>
        <div class="small muted">"Automático" sigue el modo de tu celular.</div>
      </div>
      <button class="btn bloque" id="guias">Volver a ver las guías de uso</button>
      <button class="btn peligro bloque" id="salir">Cerrar sesión</button>
      <p class="small muted" style="text-align:center">Conteo ERM 2026 · herramienta de apoyo para personeros.<br>El resultado oficial es el de las actas electorales y la ONPE.</p>
    </div>`);
  app.querySelector('#tema').onclick = (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    cambiarTema(b.dataset.t);
    app.querySelectorAll('#tema button').forEach((x) => x.classList.toggle('activo', x === b));
  };
  app.querySelector('#guias').onclick = () => {
    reiniciarGuias();
    toast('Las guías se mostrarán otra vez en cada pantalla');
    location.hash = '#/mesas';
  };
  app.querySelector('#salir').onclick = async () => {
    const msg = pendientes ? 'Tienes cambios sin enviar que se perderán. ¿Cerrar sesión igual?' : '¿Cerrar sesión?';
    if (!(await confirmar(msg, { ok: 'Cerrar sesión', peligro: !!pendientes }))) return;
    sesion.salir();
    toast('Sesión cerrada');
    location.hash = '#/login';
  };
}
