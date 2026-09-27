import { readFileSync } from 'node:fs';

const RUTA = new URL('../../data/ubigeo.json', import.meta.url);

export const ARBOL = JSON.parse(readFileSync(RUTA, 'utf8'));
export const ARBOL_JSON = JSON.stringify(ARBOL);

const DEPS = new Map();
const PROVS = new Map();
const DISTS = new Map();
for (const d of ARBOL) {
  DEPS.set(d.c, d);
  for (const p of d.p) {
    PROVS.set(p.c, { ...p, dep: d });
    for (const x of p.d) DISTS.set(x.c, { ...x, prov: p, dep: d });
  }
}

export const esDistrito = (u) => DISTS.has(u);

/** Nombres legibles de un ubigeo de 2, 4 o 6 dígitos. */
export function describir(ubigeo) {
  const u = String(ubigeo || '');
  if (u.length === 6 && DISTS.has(u)) {
    const x = DISTS.get(u);
    return { ubigeo: u, nivel: 'distrito', departamento: x.dep.n, provincia: x.prov.n, distrito: x.n, reniec: x.r };
  }
  if (u.length === 4 && PROVS.has(u)) {
    const p = PROVS.get(u);
    return { ubigeo: u, nivel: 'provincia', departamento: p.dep.n, provincia: p.n };
  }
  if (u.length === 2 && DEPS.has(u)) return { ubigeo: u, nivel: 'departamento', departamento: DEPS.get(u).n };
  if (u === '') return { ubigeo: '', nivel: 'nacional' };
  return null;
}

/** Subdivisiones directas de un ubigeo (para el desglose del dashboard). */
export function hijos(ubigeo) {
  const u = String(ubigeo || '');
  if (u === '') return ARBOL.map((d) => ({ ubigeo: d.c, nombre: d.n }));
  if (u.length === 2) return (DEPS.get(u)?.p || []).map((p) => ({ ubigeo: p.c, nombre: p.n }));
  if (u.length === 4) return (PROVS.get(u)?.d || []).map((x) => ({ ubigeo: x.c, nombre: x.n }));
  return [];
}
