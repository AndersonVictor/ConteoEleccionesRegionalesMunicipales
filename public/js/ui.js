// Utilidades de interfaz: plantillas con escape, toasts, modales, logos y palitos.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

/** Plantilla HTML: escapa todo lo interpolado salvo raw() y arrays de raw(). */
export function html(partes, ...valores) {
  let out = '';
  partes.forEach((p, i) => {
    out += p;
    if (i < valores.length) out += render(valores[i]);
  });
  return raw(out);
}
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v == null) return '';
  return esc(v);
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export const fmt = (n) => Number(n || 0).toLocaleString('es-PE');
export const pct = (n) => `${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const titulo = (s) => String(s || '').toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

export function toast(msg, { error = false, accion, alAccion, duracion = 3200 } = {}) {
  const cont = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.innerHTML = `<span>${esc(msg)}</span>${accion ? `<button type="button">${esc(accion)}</button>` : ''}`;
  if (accion) el.querySelector('button').onclick = () => { alAccion?.(); el.remove(); };
  cont.appendChild(el);
  setTimeout(() => el.remove(), duracion);
}

/** Modal tipo hoja inferior. contenido: string HTML. Devuelve { el, cerrar }. */
export function modal(contenido, { alCerrar } = {}) {
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${contenido}</div>`;
  const cerrar = () => { fondo.remove(); alCerrar?.(); };
  fondo.addEventListener('click', (e) => {
    if (e.target === fondo || e.target.closest('[data-cerrar]')) cerrar();
  });
  document.body.appendChild(fondo);
  return { el: fondo.firstElementChild, cerrar };
}

export function confirmar(mensaje, { ok = 'Aceptar', peligro = false } = {}) {
  return new Promise((resolve) => {
    let respondido = false;
    const m = modal(
      `<div class="stack"><p style="margin:0;font-size:1.05rem">${esc(mensaje)}</p>
       <div class="grid-2"><button class="btn suave" data-cerrar>Cancelar</button>
       <button class="btn ${peligro ? 'peligro' : 'primario'}" data-ok>${esc(ok)}</button></div></div>`,
      { alCerrar: () => !respondido && resolve(false) },
    );
    m.el.querySelector('[data-ok]').onclick = () => { respondido = true; m.cerrar(); resolve(true); };
  });
}

// Color estable por organización para el logo de respaldo (iniciales).
function colorDe(texto) {
  let h = 0;
  for (const c of String(texto)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}
function iniciales(nombre) {
  const palabras = String(nombre).replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((p) => p.length > 2 && !['PARTIDO', 'POLITICO', 'MOVIMIENTO', 'REGIONAL', 'PARA', 'POR', 'LOS', 'LAS', 'DEL'].includes(p));
  return (palabras.slice(0, 2).map((p) => p[0]).join('') || String(nombre).slice(0, 2)).toUpperCase();
}

const logosFallidos = new Set();
window.__logoFallo = (src) => logosFallidos.add(src);

/** Logo de una organización con respaldo de iniciales si la imagen no carga. */
export function logo(org, { chico = false } = {}) {
  const clase = `logo${chico ? ' chico' : ''}`;
  const ini = iniciales(org?.nombre || '?');
  // Las iniciales quedan debajo; la imagen solo se muestra si carga (el JNE puede no responder).
  const img = org?.logo && !logosFallidos.has(org.logo)
    ? html`<img src="${org.logo}" alt="" loading="lazy" onload="this.classList.add('ok')" onerror="window.__logoFallo?.(this.src);this.remove()">`
    : '';
  return html`<span class="${clase}" style="background:${colorDe(org?.nombre || '?')}">${ini}${img}</span>`;
}

export function logoEspecial(id, { chico = false } = {}) {
  const simbolo = { B: '○', N: '✕', I: '!' }[id] || '?';
  return html`<span class="logo especial${chico ? ' chico' : ''}">${simbolo}</span>`;
}

/** Palitos agrupados de 5, como en el papel del personero. */
export function palitos(n, { max = 100 } = {}) {
  if (!n) return '';
  const mostrar = Math.min(n, max);
  const grupos = [];
  for (let i = 0; i < mostrar; i += 5) {
    const k = Math.min(5, mostrar - i);
    let lineas = '';
    for (let j = 0; j < Math.min(k, 4); j++) lineas += `<line x1="${3 + j * 5}" y1="2" x2="${3 + j * 5}" y2="14"/>`;
    if (k === 5) lineas += '<line class="diag" x1="0" y1="12" x2="21" y2="4"/>';
    grupos.push(`<svg viewBox="0 0 22 16" class="${k === 5 ? 'completo' : ''}" aria-hidden="true">${lineas}</svg>`);
  }
  const extra = n > max ? `<span class="small muted">+${n - max}</span>` : '';
  return raw(`<div class="palitos" title="${n} votos">${grupos.join('')}${extra}</div>`);
}

export const iconos = {
  atras: raw('<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>'),
  deshacer: raw('<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>'),
  lista: raw('<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'),
  check: raw('<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>'),
  compartir: raw('<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>'),
  urna: raw('<svg viewBox="0 0 24 24"><path d="M4 11h16v9H4zM8 11V4h8v7M10 7h4"/></svg>'),
  mas: raw('<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'),
  refrescar: raw('<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>'),
};

export const cargando = () => html`<div class="cargando"><div class="spinner"></div></div>`;

export function vibrar(ms = 30) {
  try { navigator.vibrate?.(ms); } catch { /* sin soporte */ }
}
