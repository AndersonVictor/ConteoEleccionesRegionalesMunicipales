import { enviarPendientes, sesion } from './api.js';
import { $, $$, toast } from './ui.js';
import { cerrarGuia, guia } from './guia.js';
import { alternarTema, aplicarTema } from './tema.js';
import { sincronizarJornada } from './jornada.js';
import { local } from './api.js';

aplicarTema();
import { vistaLogin } from './views/login.js';
import { vistaMesas } from './views/mesas.js';
import { vistaNuevaMesa } from './views/nueva-mesa.js';
import { vistaConteo } from './views/conteo.js';
import { vistaResumen } from './views/resumen.js';
import { vistaDashboard } from './views/dashboard.js';
import { vistaAdmin } from './views/admin.js';
import { vistaCuenta } from './views/cuenta.js';

const RUTAS = [
  [/^#\/login$/, vistaLogin, { publica: true, sinNav: true }],
  [/^#\/mesas$/, vistaMesas, { nav: 'mesas' }],
  [/^#\/mesa\/nueva$/, vistaNuevaMesa, { nav: 'mesas' }],
  [/^#\/acta\/(\d+)$/, vistaConteo, { nav: 'mesas', barra: true }],
  [/^#\/acta\/(\d+)\/resumen$/, vistaResumen, { nav: 'mesas', barra: true }],
  [/^#\/resultados(?:\?(.*))?$/, vistaDashboard, { nav: 'dashboard', publica: true }],
  [/^#\/admin$/, vistaAdmin, { nav: 'admin' }],
  [/^#\/cuenta$/, vistaCuenta, { nav: 'cuenta' }],
];

let limpiar = null;

async function enrutar() {
  const hash = location.hash === '#/dashboard' ? '#/resultados' : location.hash || '#/mesas';
  const ruta = RUTAS.find(([re]) => re.test(hash));
  if (!sesion.token && !ruta?.[2].publica) {
    location.hash = '#/login';
    return;
  }
  if (!ruta) {
    location.hash = '#/mesas';
    return;
  }
  const [re, vista, opts] = ruta;
  const params = hash.match(re).slice(1);
  // La primera vez se espera el estado de la jornada (cuenta regresiva); luego se actualiza en segundo plano.
  if (local.get('jornada')) sincronizarJornada();
  else await sincronizarJornada({ forzar: true });
  cerrarGuia();
  if (typeof limpiar === 'function') limpiar();
  limpiar = null;

  const app = $('#app');
  const nav = $('#nav');
  // Sin sesión (visitante del dashboard público) no hay menú inferior.
  const sinNav = !!opts.sinNav || !sesion.token;
  nav.hidden = sinNav;
  app.classList.toggle('sin-nav', sinNav);
  app.classList.toggle('con-barra', !!opts.barra);
  $('[data-nav=admin]').hidden = sesion.usuario?.rol !== 'admin';
  $$('#nav a').forEach((a) => a.classList.toggle('activo', a.dataset.nav === opts.nav));
  window.scrollTo(0, 0);
  try {
    limpiar = await vista(app, ...params);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Algo salió mal', { error: true });
  }
}

function conexion() {
  $('#barra-conexion').hidden = navigator.onLine;
  if (navigator.onLine) enviarPendientes();
}

window.addEventListener('hashchange', enrutar);
// Cualquier botón "?" repite la guía de su pantalla.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ayuda]');
  if (b) guia(b.dataset.ayuda, { forzar: true });
  if (e.target.closest('[data-tema]')) alternarTema();
});
window.addEventListener('online', conexion);
window.addEventListener('offline', conexion);
conexion();
enrutar();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
