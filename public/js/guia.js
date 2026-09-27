// Guías paso a paso con driver.js: explican cada pantalla la primera vez que se abre.
// Se pueden repetir con el botón "?" de cada pantalla.
import { local } from './api.js';

const TEXTOS = {
  nextBtnText: 'Siguiente',
  prevBtnText: 'Atrás',
  doneBtnText: 'Entendido',
  progressText: '{{current}} de {{total}}',
};

// Cada paso: [selector, título, descripción, lado opcional]
const GUIAS = {
  registro: [
    ['[name=dni]', 'Empieza por tu DNI', 'Escribe tus 8 dígitos. Si RENIEC lo reconoce, tus nombres y apellidos se completan solos.'],
    ['#bloque-nombre', 'Tus nombres', 'Se guardan en MAYÚSCULAS, igual que en tu DNI. Si no se completaron solos, escríbelos tal como figuran en tu DNI.'],
    ['[name=telefono]', 'Celular', 'Nueve dígitos y empieza con 9. Sirve para que tu coordinador te ubique el día de la elección.'],
    ['[name=email]', 'Correo (opcional)', 'Puedes dejarlo vacío. Solo sirve como otra forma de ingresar y para recuperar tu cuenta más adelante.'],
    ['[name=password]', 'Contraseña', 'Mínimo 8 caracteres, con letras y números. Con tu DNI y esta contraseña ingresas desde cualquier celular.'],
  ],
  mesas: [
    ['[data-guia=nueva-mesa]', 'Registra tu mesa', 'Toca aquí para agregar la mesa donde eres personero. Puedes tener más de una.'],
    ['[data-guia=lista-mesas]', 'Tus mesas', 'Aquí aparecen tus mesas con su avance. Toca una para seguir contando.'],
    ['.nav', 'Menú', 'En "Resultados" ves quién va ganando en tu región, provincia y distrito.', 'top'],
  ],
  'nueva-mesa': [
    ['[name=numero]', 'Número de mesa', 'Son 6 dígitos. Está en el acta y en la lista de electores pegada en el aula.'],
    ['[data-ubigeo]', 'Ubicación', 'Elige departamento, luego provincia y al final distrito. Según el distrito cambia cuántas elecciones tiene la cédula.'],
    ['[name=electores_habiles]', 'Electores hábiles', 'Figura en la lista de electores. Una mesa tiene como máximo 300.'],
    ['[type=submit]', 'Listo', 'Toca aquí para empezar a contar.'],
  ],
  conteo: [
    ['#contador', 'Cédulas contadas', 'Este número sube cada vez que registras una cédula.'],
    ['[data-guia=modo]', 'Dos formas de contar', '"Por cédula": marcas la cédula completa. "Por elección": sumas palitos a un partido, como en el papel. Te recomendamos "Por cédula" porque el acta cuadra sola.'],
    ['.pasos', 'Las pestañas son las elecciones de la cédula', 'Cada cédula tiene estas elecciones. La pestaña con borde azul es la que estás marcando ahora; las que se pintan de celeste ya están marcadas. Puedes tocar una pestaña para corregirla.'],
    ['.opciones', 'Marca el voto', 'Toca la organización que el presidente de mesa lee en voz alta. Al tocarla pasas solo a la siguiente pestaña.'],
    ['.especiales', 'Blanco, nulo o impugnado', 'Si en esa elección la cédula está en blanco, es nula o fue impugnada, toca aquí.'],
    ['[data-accion=registrar]', 'Registra la cédula', 'Cuando marcaste todas las pestañas, este botón se activa. Tócalo y empieza la siguiente cédula.', 'top'],
    ['[data-accion=deshacer]', '¿Te equivocaste?', 'Deshacer quita la última cédula registrada o limpia lo que estás marcando.', 'top'],
    ['[data-guia=resumen]', 'Resumen y cuadre', 'Al terminar, entra aquí para revisar que todo cuadre y cerrar el acta.', 'top'],
  ],
  'conteo-seccion': [
    ['[data-guia=tabs-seccion]', 'Una pestaña por elección', 'Elige la elección que estás contando. Debajo de cada nombre ves cuántos votos lleva.'],
    ['.fila-seccion', 'Suma o resta votos', 'Toca "+" para sumar un voto (se dibuja un palito) y "−" si te equivocaste.'],
  ],
  resumen: [
    ['#tv', 'Total que votó', 'Copia aquí el número de ciudadanos que votaron según la lista de electores.'],
    ['.estado-acta .row', 'Estado del acta', 'Verde: todo cuadra. Rojo: hay diferencias. Amarillo: falta anotar cuántos votaron.'],
    ['.avance-elecciones', 'Cada elección', 'Cuántos votos lleva cada elección y si sobran o faltan. Toca una para ver sus resultados abajo.'],
    ['[data-accion=cerrar]', 'Cerrar acta', 'Solo se activa cuando todo cuadra. Al cerrarla, tu resultado se suma al consolidado.', 'top'],
  ],
  dashboard: [
    ['details.card', 'Elige el ámbito', 'Región, provincia o distrito. Si dejas provincia en "Todas", ves la región completa.'],
    ['.lider', 'Quién va ganando', 'La organización con más votos válidos y su ventaja sobre la segunda.'],
    ['.barras', 'Todas las organizaciones', 'Votos y porcentaje de votos válidos de cada una.'],
  ],
};

let activa = null;

/** Muestra la guía de una pantalla. Sin `forzar`, solo la primera vez. */
export function guia(nombre, { forzar = false } = {}) {
  const driverJs = window.driver?.js?.driver;
  const pasos = GUIAS[nombre];
  if (!driverJs || !pasos) return;
  if (!forzar && local.get(`guia:${nombre}`)) return;
  local.set(`guia:${nombre}`, true);
  const visibles = pasos
    .filter(([sel]) => {
      const el = document.querySelector(sel);
      return el && el.offsetParent !== null;
    })
    .map(([element, title, description, side]) => ({ element, popover: { title, description, side: side || 'bottom', align: 'start' } }));
  if (!visibles.length) return;
  activa?.destroy();
  activa = driverJs({ ...TEXTOS, showProgress: true, allowClose: true, smoothScroll: true, stagePadding: 6, stageRadius: 12, steps: visibles });
  // Pequeña espera para que la pantalla termine de dibujarse.
  setTimeout(() => activa.drive(), 250);
}

export function cerrarGuia() {
  activa?.destroy();
  activa = null;
}

export function reiniciarGuias() {
  for (const k of Object.keys(GUIAS)) local.del(`guia:${k}`);
}
