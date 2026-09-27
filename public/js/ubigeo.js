import { api, local } from './api.js';
import { html, titulo } from './ui.js';

let arbol = null;

export async function cargarUbigeo() {
  if (arbol) return arbol;
  arbol = local.get('ubigeo');
  if (!arbol) {
    arbol = await api('/ubigeo');
    local.set('ubigeo', arbol);
  }
  return arbol;
}

export const departamento = (c) => arbol?.find((d) => d.c === c);
export const provincia = (c) => departamento(c?.slice(0, 2))?.p.find((p) => p.c === c);
export const distrito = (c) => provincia(c?.slice(0, 4))?.d.find((d) => d.c === c);

const opciones = (lista, sel, vacio) =>
  html`<option value="">${vacio}</option>${lista.map((x) => html`<option value="${x.c}" ${x.c === sel ? 'selected' : ''}>${titulo(x.n)}</option>`)}`;

/**
 * Tres selects encadenados (departamento, provincia, distrito).
 * `hasta` limita la profundidad obligatoria; con `opcional` provincia y distrito permiten "Todos".
 */
export function selectoresUbigeo(valor = '', { opcional = false, nombre = 'ubigeo' } = {}) {
  const d = valor.slice(0, 2);
  const p = valor.length >= 4 ? valor.slice(0, 4) : '';
  const x = valor.length === 6 ? valor : '';
  const deps = arbol || [];
  const provs = departamento(d)?.p || [];
  const dists = provincia(p)?.d || [];
  return html`<div class="stack" data-ubigeo="${nombre}">
    <label class="campo"><span>Departamento / región</span>
      <select class="input" data-nivel="dep">${opciones(deps, d, 'Selecciona…')}</select></label>
    <label class="campo"><span>Provincia</span>
      <select class="input" data-nivel="prov" ${d ? '' : 'disabled'}>${opciones(provs, p, opcional ? 'Todas las provincias' : 'Selecciona…')}</select></label>
    <label class="campo"><span>Distrito</span>
      <select class="input" data-nivel="dist" ${p ? '' : 'disabled'}>${opciones(dists, x, opcional ? 'Todos los distritos' : 'Selecciona…')}</select></label>
  </div>`;
}

/** Conecta los selects; llama a alCambiar(ubigeo) con el código más profundo elegido. */
export function enlazarUbigeo(raiz, alCambiar, opts = {}) {
  const cont = raiz.querySelector(`[data-ubigeo="${opts.nombre || 'ubigeo'}"]`);
  if (!cont) return;
  cont.addEventListener('change', (e) => {
    const nivel = e.target.dataset.nivel;
    const dep = cont.querySelector('[data-nivel=dep]').value;
    const prov = nivel === 'dep' ? '' : cont.querySelector('[data-nivel=prov]').value;
    const dist = nivel === 'dist' ? cont.querySelector('[data-nivel=dist]').value : '';
    const valor = dist || prov || dep;
    cont.outerHTML = String(selectoresUbigeo(valor, opts));
    enlazarUbigeo(raiz, alCambiar, opts);
    alCambiar(valor);
  });
}
