import { api, sesion } from '../api.js';
import { html, toast } from '../ui.js';

export function vistaLogin(app) {
  let modo = 'login';
  const pintar = () => {
    app.innerHTML = String(html`
      <div class="marca">
        <img class="icono" src="/img/icono.svg" alt="">
        <h1>Conteo ERM 2026</h1>
        <p>Cuenta los votos de tu mesa desde el celular</p>
      </div>
      <div class="card stack">
        <div class="segmentado">
          <button data-modo="login" class="${modo === 'login' ? 'activo' : ''}">Ingresar</button>
          <button data-modo="registro" class="${modo === 'registro' ? 'activo' : ''}">Crear cuenta</button>
        </div>
        <form class="stack" id="form" novalidate>
          ${modo === 'login'
            ? html`
              <label class="campo"><span>Correo o DNI</span><input class="input" name="usuario" autocomplete="username" required></label>
              <label class="campo"><span>Contraseña</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>`
            : html`
              <label class="campo"><span>Nombre completo</span><input class="input" name="nombre" autocomplete="name" required></label>
              <div class="grid-2">
                <label class="campo"><span>DNI</span><input class="input" name="dni" inputmode="numeric" maxlength="8" pattern="\\d{8}" required></label>
                <label class="campo"><span>Celular</span><input class="input" name="telefono" inputmode="tel" autocomplete="tel"></label>
              </div>
              <label class="campo"><span>Correo</span><input class="input" name="email" type="email" autocomplete="email" required></label>
              <label class="campo"><span>Organización que representas <small class="muted">(opcional)</small></span>
                <input class="input" name="organizacion" placeholder="Ej. partido o movimiento regional"></label>
              <label class="campo"><span>Contraseña</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="6" required>
                <div class="ayuda">Mínimo 6 caracteres.</div></label>`}
          <button class="btn primario bloque" type="submit">${modo === 'login' ? 'Ingresar' : 'Crear cuenta'}</button>
        </form>
      </div>
      <p class="small muted" style="text-align:center;margin-top:20px">Herramienta de apoyo para personeros. El resultado oficial es el del acta electoral y la ONPE.</p>`);

    app.querySelectorAll('[data-modo]').forEach((b) => (b.onclick = () => { modo = b.dataset.modo; pintar(); }));
    app.querySelector('#form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const datos = Object.fromEntries(new FormData(e.target));
        const r = await api(modo === 'login' ? '/auth/login' : '/auth/registro', { method: 'POST', body: datos });
        sesion.guardar(r);
        if (modo === 'registro' && r.usuario.rol === 'admin') toast('Eres el primer usuario: tienes rol de administrador.');
        location.hash = '#/mesas';
      } catch (err) {
        toast(err.message, { error: true });
        btn.disabled = false;
      }
    };
  };
  if (sesion.token) {
    location.hash = '#/mesas';
    return;
  }
  pintar();
}
