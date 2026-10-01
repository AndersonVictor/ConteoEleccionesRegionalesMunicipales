// Cuenta regresiva hasta el inicio de la jornada y limpieza de datos de prueba en el celular.
import { api, local } from './api.js';
import { html, toast } from './ui.js';

let estado = local.get('jornada'); // último estado conocido (sirve sin señal)
let desfase = 0; // diferencia entre el reloj del servidor y el del celular
let ultimaConsulta = 0;

export const enModoPrueba = () => !!estado && Date.now() + desfase < new Date(estado.inicio).getTime();
export const inicio = () => (estado ? new Date(estado.inicio) : null);

/** Consulta el estado de la jornada (como máximo una vez por minuto salvo `forzar`). */
export async function sincronizarJornada({ forzar = false } = {}) {
  if (!forzar && Date.now() - ultimaConsulta < 60000) return estado;
  ultimaConsulta = Date.now();
  try {
    estado = await api('/estado');
    desfase = new Date(estado.ahora).getTime() - Date.now();
    local.set('jornada', estado);
    borrarCopiasDePrueba();
  } catch { /* sin señal: se usa el último estado */ }
  return estado;
}

// Tras borrar los datos de prueba en el servidor, también se borran las copias del celular
// guardadas antes de ese momento (las actas creadas después no se tocan).
function borrarCopiasDePrueba() {
  const l = estado?.limpieza;
  if (!l || local.get('limpiezaVista') === l.id) return;
  let borradas = 0;
  for (const k of local.claves('acta:')) {
    if ((local.get(k)?.guardado || 0) < l.id) {
      local.del(k);
      borradas++;
    }
  }
  local.set('limpiezaVista', l.id);
  if (borradas) toast('Se borraron los conteos de prueba. ¡Empezó la jornada: registra tu mesa!', { duracion: 7000 });
}

const fechaInicio = () =>
  inicio()?.toLocaleString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) || '';

/** Bloque de cuenta regresiva (solo mientras dure el modo prueba). */
export function cuentaRegresiva({ compacta = false } = {}) {
  if (!enModoPrueba()) return '';
  return html`<div class="cuenta-regresiva ${compacta ? 'compacta' : ''}" data-cuenta>
    <div class="cr-titulo">Las elecciones empiezan en</div>
    <div class="cr-numeros">
      <div><b data-u="d">0</b><span>días</span></div>
      <div><b data-u="h">0</b><span>horas</span></div>
      <div><b data-u="m">0</b><span>min</span></div>
      <div><b data-u="s">0</b><span>seg</span></div>
    </div>
    <div class="cr-nota"><span class="chip warn">MODO PRUEBA</span> Hasta el ${fechaInicio()} todo lo que se registre es de prueba y
      <b>se borrará automáticamente</b>. Practica con confianza.</div>
  </div>`;
}

/** Consejo para el día de la elección. */
export function recomendacionLlegada() {
  return html`<div class="aviso consejo">
    <b>${enModoPrueba() ? 'El día de la elección, al llegar a tu mesa:' : '¡Empezó la jornada! Apenas llegues a tu mesa:'}</b> regístrala con su número y la <b>cantidad de electores hábiles</b>
    que figura en la lista de electores pegada en el aula. Así, al terminar el conteo, el sistema verifica que todo cuadre.
  </div>`;
}

function tic() {
  const els = document.querySelectorAll('[data-cuenta]');
  if (!els.length || !estado) return;
  const falta = new Date(estado.inicio).getTime() - (Date.now() + desfase);
  if (falta <= 0) {
    els.forEach((e) => e.remove());
    // Da unos segundos al servidor para borrar y luego actualiza la pantalla.
    setTimeout(async () => {
      await sincronizarJornada({ forzar: true });
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }, 5000);
    return;
  }
  const s = Math.floor(falta / 1000);
  const partes = { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
  els.forEach((el) => {
    for (const [k, v] of Object.entries(partes)) {
      const b = el.querySelector(`[data-u="${k}"]`);
      const txt = k === 'd' ? String(v) : String(v).padStart(2, '0');
      if (b && b.textContent !== txt) b.textContent = txt;
    }
  });
}
setInterval(tic, 1000);
// Primer pintado inmediato cuando aparece una cuenta regresiva en pantalla.
new MutationObserver(() => tic()).observe(document.documentElement, { childList: true, subtree: true });
