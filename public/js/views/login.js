import { api, sesion } from '../api.js';
import { botonAyuda, botonTema, html, toast } from '../ui.js';
import { guia } from '../guia.js';
import { cuentaRegresiva } from '../jornada.js';
import {
  errorCelular, errorDni, errorEmail, errorNombre, errorPassword, errorTextoLibre, mayusculas,
} from '/shared/validacion.js';

// Validación de cada campo del registro (la misma que aplica el servidor).
const VALIDAR = {
  dni: (v) => errorDni(v),
  nombres: (v) => errorNombre(v, 'El nombre'),
  apellido_paterno: (v) => errorNombre(v, 'El apellido paterno'),
  apellido_materno: (v) => errorNombre(v, 'El apellido materno', { opcional: true }),
  telefono: (v) => errorCelular(v),
  email: (v) => errorEmail(v),
  organizacion: (v) => errorTextoLibre(v, 'La organización', 100),
  password: (v) => errorPassword(v),
  confirmar: (v, f) => (v === f.password.value ? null : 'Las contraseñas no coinciden'),
};

const campo = (etiqueta, input, ayuda = '') => html`<label class="campo"><span>${etiqueta}</span>${input}${ayuda ? html`<div class="ayuda">${ayuda}</div>` : ''}</label>`;
const pass = (name, auto) => html`<div class="campo-pass"><input class="input" name="${name}" type="password" autocomplete="${auto}" required>
  <button type="button" class="ver" data-ver="${name}">Ver</button></div>`;

export function vistaLogin(app) {
  let modo = 'login';

  function formLogin() {
    return html`
      ${campo('DNI', html`<input class="input" name="usuario" inputmode="numeric" autocomplete="username" placeholder="8 dígitos" required>`,
        'También puedes ingresar con tu correo si lo registraste.')}
      ${campo('Contraseña', pass('password', 'current-password'))}
      <button class="btn primario bloque" type="submit">Ingresar</button>`;
  }

  function formRegistro() {
    return html`
      <div class="row between"><b>Tus datos</b>${botonAyuda('registro')}</div>
      <label class="campo"><span>DNI</span>
        <input class="input num" name="dni" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="8 dígitos" required>
        <div id="estado-dni"></div></label>
      <div id="bloque-nombre" class="stack">
        ${campo('Nombres', html`<input class="input mayus" name="nombres" autocomplete="given-name" required>`)}
        <div class="grid-2">
          ${campo('Apellido paterno', html`<input class="input mayus" name="apellido_paterno" autocomplete="family-name" required>`)}
          ${campo('Apellido materno', html`<input class="input mayus" name="apellido_materno">`)}
        </div>
      </div>
      ${campo('Celular', html`<input class="input num" name="telefono" inputmode="tel" maxlength="9" autocomplete="tel" placeholder="9XXXXXXXX" required>`)}
      ${campo(html`Correo <small class="muted">(opcional)</small>`, html`<input class="input" name="email" type="email" autocomplete="email">`)}
      ${campo(html`Organización que representas <small class="muted">(opcional)</small>`,
        html`<input class="input mayus" name="organizacion" placeholder="Partido o movimiento regional">`)}
      ${campo('Contraseña', pass('password', 'new-password'), 'Mínimo 8 caracteres, con letras y números.')}
      ${campo('Repite la contraseña', pass('confirmar', 'new-password'))}
      <button class="btn primario bloque" type="submit">Crear cuenta</button>`;
  }

  function marcarError(form, nombre, msg) {
    const input = form.elements[nombre];
    if (!input) return;
    const cont = input.closest('label') || input.parentElement;
    cont.querySelector('.error-campo')?.remove();
    input.classList.toggle('invalido', !!msg);
    if (msg) cont.insertAdjacentHTML('beforeend', `<div class="error-campo">${msg.replace(/</g, '&lt;')}</div>`);
  }

  function validarCampo(form, nombre) {
    const input = form.elements[nombre];
    if (!input || !VALIDAR[nombre]) return null;
    const msg = VALIDAR[nombre](input.value, form.elements);
    marcarError(form, nombre, msg);
    return msg;
  }

  function fijarNombres(form, datos, bloquear) {
    for (const k of ['nombres', 'apellido_paterno', 'apellido_materno']) {
      form.elements[k].value = datos?.[k] || '';
      form.elements[k].readOnly = bloquear;
      marcarError(form, k, null);
    }
  }

  let dniConsultado = '';
  async function buscarDni(form) {
    const dni = form.dni.value;
    const estado = app.querySelector('#estado-dni');
    if (dni.length !== 8 || dni === dniConsultado) return;
    dniConsultado = dni;
    estado.innerHTML = '<div class="estado-dni"><span class="spinner"></span> Buscando tus datos en RENIEC…</div>';
    try {
      const r = await api(`/dni/${dni}`);
      if (form.dni.value !== dni) return;
      if (r.registrado) {
        estado.innerHTML = '<div class="estado-dni warn">Ya existe una cuenta con este DNI. <a href="#" data-modo-link="login">Ingresa aquí</a>.</div>';
        fijarNombres(form, null, false);
      } else if (r.encontrado) {
        estado.innerHTML = '<div class="estado-dni ok">✓ Datos encontrados en RENIEC</div>';
        fijarNombres(form, r, true);
        form.telefono.focus();
      } else {
        const msg = {
          no_encontrado: 'No encontramos tu DNI en RENIEC.',
          no_configurado: 'La consulta de DNI no está activada en el servidor (falta el token de Decolecta).',
          token_invalido: 'El token de Decolecta del servidor no es válido o no tiene saldo.',
        }[r.motivo] || 'No se pudo consultar RENIEC en este momento.';
        estado.innerHTML = `<div class="estado-dni warn">${msg} Escribe tus nombres y apellidos tal como figuran en tu DNI.</div>`;
        fijarNombres(form, null, false);
        form.nombres.focus();
      }
    } catch (e) {
      dniConsultado = '';
      estado.innerHTML = `<div class="estado-dni warn">${e.status === 429 ? 'Demasiadas consultas; escribe tus datos.' : 'Sin conexión para verificar; escribe tus datos.'}</div>`;
      fijarNombres(form, null, false);
    }
  }

  function pintar() {
    app.innerHTML = String(html`
      <div class="row" style="justify-content:flex-end">${botonTema()}</div>
      <div class="marca">
        <img class="icono" src="/img/icono.svg" alt="">
        <h1>Conteo ERM 2026</h1>
        <p>Cuenta los votos de tu mesa desde el celular</p>
      </div>
      ${cuentaRegresiva({ compacta: true })}
      <div class="card stack">
        <div class="segmentado">
          <button data-modo="login" class="${modo === 'login' ? 'activo' : ''}">Ingresar</button>
          <button data-modo="registro" class="${modo === 'registro' ? 'activo' : ''}">Crear cuenta</button>
        </div>
        <form class="stack" id="form" novalidate>${modo === 'login' ? formLogin() : formRegistro()}</form>
      </div>
      <a class="btn suave bloque" href="#/resultados" style="margin-top:16px">Ver resultados en vivo sin cuenta ›</a>
      <p class="small muted" style="text-align:center;margin-top:20px">Herramienta de apoyo para personeros. El resultado oficial es el del acta electoral y la ONPE.</p>`);

    const form = app.querySelector('#form');
    app.querySelectorAll('[data-modo]').forEach((b) => (b.onclick = () => { modo = b.dataset.modo; pintar(); }));

    form.addEventListener('click', (e) => {
      const ver = e.target.closest('[data-ver]');
      if (ver) {
        const i = form.elements[ver.dataset.ver];
        i.type = i.type === 'password' ? 'text' : 'password';
        ver.textContent = i.type === 'password' ? 'Ver' : 'Ocultar';
      }
      const link = e.target.closest('[data-modo-link]');
      if (link) {
        e.preventDefault();
        const dni = form.dni?.value;
        modo = 'login';
        pintar();
        if (dni) app.querySelector('[name=usuario]').value = dni;
      }
    });

    form.addEventListener('input', (e) => {
      const t = e.target;
      if (t.name === 'dni' || t.name === 'telefono' || (t.name === 'usuario' && /^\d*$/.test(t.value))) {
        t.value = t.value.replace(/\D/g, '');
      }
      if (t.classList.contains('mayus')) {
        const pos = t.selectionStart;
        t.value = t.value.toUpperCase();
        t.setSelectionRange?.(pos, pos);
      }
      if (t.classList.contains('invalido')) validarCampo(form, t.name);
      if (t.name === 'dni' && modo === 'registro') {
        if (t.value.length === 8) buscarDni(form);
        else if (dniConsultado) {
          dniConsultado = '';
          app.querySelector('#estado-dni').innerHTML = '';
          fijarNombres(form, null, false);
        }
      }
    });
    form.addEventListener('focusout', (e) => {
      if (modo !== 'registro' || !e.target.name || !e.target.value) return;
      if (e.target.classList.contains('mayus')) e.target.value = mayusculas(e.target.value);
      validarCampo(form, e.target.name);
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (modo === 'registro') {
        const errores = Object.keys(VALIDAR).map((k) => [k, validarCampo(form, k)]).filter(([, m]) => m);
        if (errores.length) {
          form.elements[errores[0][0]].focus();
          return toast(errores[0][1], { error: true });
        }
      }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const datos = Object.fromEntries(new FormData(form));
        const r = await api(modo === 'login' ? '/auth/login' : '/auth/registro', { method: 'POST', body: datos });
        sesion.guardar(r);
        if (modo === 'registro' && r.usuario.rol === 'admin') toast('Eres el primer usuario: tienes rol de administrador.');
        location.hash = '#/mesas';
      } catch (err) {
        toast(err.message, { error: true });
        if (err.datos?.campo) marcarError(form, err.datos.campo, err.message);
        btn.disabled = false;
      }
    };

    if (modo === 'registro') guia('registro');
  }

  if (sesion.token) {
    location.hash = '#/mesas';
    return;
  }
  pintar();
}
