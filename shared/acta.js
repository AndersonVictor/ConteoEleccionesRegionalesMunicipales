// Lógica del acta compartida entre el servidor y el navegador (módulo ES sin dependencias).
//
// Un acta guarda una lista de "registros". Cada registro es lo que el personero anotó de
// una cédula: { id, ts, v: { regional: '12', consejero: '12', provincial: 'B', distrital: 'N' } }.
// En modo "por cédula" un registro trae las 4 secciones; en modo "por sección" trae solo una.
// Los conteos se derivan siempre de los registros, así deshacer es tan simple como borrar uno.

export const SECCIONES = {
  regional: { id: 'regional', titulo: 'Gobernador y Vicegobernador Regional', corto: 'Gobernador regional', abrev: 'Gobernador' },
  consejero: { id: 'consejero', titulo: 'Consejeros Regionales', corto: 'Consejo regional', abrev: 'Consejero' },
  provincial: { id: 'provincial', titulo: 'Alcalde y Regidores Provinciales', corto: 'Alcalde provincial', abrev: 'Provincial' },
  distrital: { id: 'distrital', titulo: 'Alcalde y Regidores Distritales', corto: 'Alcalde distrital', abrev: 'Distrital' },
};

export const ORDEN_SECCIONES = ['regional', 'consejero', 'provincial', 'distrital'];

// Opciones especiales que aparecen en toda sección además de las organizaciones.
export const ESPECIALES = {
  B: { id: 'B', nombre: 'Votos en blanco', corto: 'Blanco' },
  N: { id: 'N', nombre: 'Votos nulos', corto: 'Nulo' },
  I: { id: 'I', nombre: 'Votos impugnados', corto: 'Impugnado' },
};

export const LIMA_METROPOLITANA = '1501';

/** Secciones que tiene la cédula de un distrito (ubigeo INEI de 6 dígitos). */
export function seccionesParaUbigeo(ubigeo) {
  const u = String(ubigeo || '');
  const lista = [];
  // Lima Metropolitana tiene régimen especial: no elige gobierno regional.
  if (u.slice(0, 4) !== LIMA_METROPOLITANA) lista.push('regional', 'consejero');
  lista.push('provincial');
  // El distrito capital de provincia (código ..01) lo gobierna la municipalidad provincial.
  if (u.slice(4, 6) !== '01') lista.push('distrital');
  return lista;
}

/** Circunscripción (ubigeo INEI recortado) en la que compite cada sección. */
export function ambitoDeSeccion(seccion, ubigeo) {
  const u = String(ubigeo || '');
  if (seccion === 'regional') return u.slice(0, 2);
  if (seccion === 'consejero' || seccion === 'provincial') return u.slice(0, 4);
  return u.slice(0, 6);
}

/** Cuenta votos por sección a partir de los registros. */
export function contar(registros, secciones) {
  const conteo = {};
  for (const s of secciones) conteo[s] = { total: 0, votos: {} };
  for (const r of registros || []) {
    for (const [s, opcion] of Object.entries(r.v || {})) {
      const c = conteo[s];
      if (!c || opcion == null || opcion === '') continue;
      c.total += 1;
      c.votos[opcion] = (c.votos[opcion] || 0) + 1;
    }
  }
  return conteo;
}

/** Totales de una sección: válidos, blancos, nulos, impugnados, emitidos. */
export function resumenSeccion(c) {
  const votos = c?.votos || {};
  let validos = 0;
  for (const [k, n] of Object.entries(votos)) if (!ESPECIALES[k]) validos += n;
  const blancos = votos.B || 0;
  const nulos = votos.N || 0;
  const impugnados = votos.I || 0;
  return { validos, blancos, nulos, impugnados, emitidos: validos + blancos + nulos + impugnados };
}

/**
 * Revisa que el acta cuadre, igual que en la mesa:
 *  - total de votantes <= electores hábiles
 *  - cada sección suma exactamente el total de ciudadanos que votaron
 *  - todas las secciones suman lo mismo (cada cédula tiene todas las secciones)
 */
export function evaluarCuadre({ registros, secciones, totalVotantes, electoresHabiles }) {
  const conteo = contar(registros, secciones);
  const checks = [];
  const totales = secciones.map((s) => conteo[s].total);
  const maximo = Math.max(0, ...totales);
  const tv = Number.isInteger(totalVotantes) && totalVotantes >= 0 ? totalVotantes : null;
  const eh = Number.isInteger(electoresHabiles) && electoresHabiles > 0 ? electoresHabiles : null;

  if (tv === null) {
    checks.push({ ok: false, nivel: 'warn', msg: 'Ingresa el total de ciudadanos que votaron (de la lista de electores).' });
  } else if (eh !== null && tv > eh) {
    checks.push({ ok: false, nivel: 'error', msg: `Votaron ${tv} pero la mesa solo tiene ${eh} electores hábiles.` });
  } else {
    checks.push({ ok: true, nivel: 'ok', msg: `Votaron ${tv}${eh ? ` de ${eh} electores hábiles` : ''}.` });
  }

  const referencia = tv ?? maximo;
  for (const s of secciones) {
    const t = conteo[s].total;
    const titulo = SECCIONES[s].corto;
    if (t === referencia) {
      checks.push({ ok: true, nivel: 'ok', seccion: s, msg: `${titulo}: ${t} votos, cuadra.` });
    } else {
      const dif = t - referencia;
      checks.push({
        ok: false,
        nivel: 'error',
        seccion: s,
        msg: `${titulo}: ${t} votos, ${dif > 0 ? 'sobran' : 'faltan'} ${Math.abs(dif)} para llegar a ${referencia}.`,
      });
    }
  }

  const ok = checks.every((c) => c.ok) && referencia > 0;
  return { ok, checks, conteo, referencia };
}

/** Texto plano del resultado para compartir (WhatsApp, SMS). */
export function textoResultado({ mesa, secciones, conteo, nombres }) {
  const lineas = [`*Mesa ${mesa.numero}* - ${mesa.distrito} (${mesa.provincia}, ${mesa.departamento})`];
  for (const s of secciones) {
    const c = conteo[s];
    const r = resumenSeccion(c);
    lineas.push('', `*${SECCIONES[s].titulo}*`);
    const orgs = Object.entries(c.votos)
      .filter(([k]) => !ESPECIALES[k])
      .sort((a, b) => b[1] - a[1]);
    for (const [k, n] of orgs) lineas.push(`${nombres[k] || k}: ${n}`);
    lineas.push(`Blancos: ${r.blancos} | Nulos: ${r.nulos} | Impugnados: ${r.impugnados}`, `Total: ${r.emitidos}`);
  }
  return lineas.join('\n');
}
