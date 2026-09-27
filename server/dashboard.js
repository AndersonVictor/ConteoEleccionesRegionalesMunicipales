// Consolidado de resultados por ámbito (región, provincia, distrito).
//
// Varios personeros pueden contar la misma mesa. Para no sumarla dos veces se toma
// un acta por mesa: la cerrada más reciente; si ninguna está cerrada y se piden
// conteos en curso, el borrador más avanzado. Si dos actas cerradas de la misma mesa
// no coinciden, la mesa se reporta "con diferencias".

import { ESPECIALES, LIMA_METROPOLITANA, SECCIONES, ambitoDeSeccion, resumenSeccion, seccionesParaUbigeo } from '../shared/acta.js';
import { describir, hijos } from './ubigeo.js';
import { listarAmbito } from './organizaciones.js';

/** Secciones que tiene sentido consolidar en un ámbito, la principal primero. */
export function seccionesDeAmbito(ubigeo) {
  const u = String(ubigeo || '');
  if (u.length === 2) return ['regional'];
  if (u.length === 4) return u === LIMA_METROPOLITANA ? ['provincial'] : ['provincial', 'consejero', 'regional'];
  if (u.length === 6) {
    const s = seccionesParaUbigeo(u);
    return ['distrital', 'provincial', 'regional', 'consejero'].filter((x) => s.includes(x));
  }
  return [];
}

function firma(conteo) {
  return JSON.stringify(
    Object.keys(conteo).sort().map((s) => [s, Object.entries(conteo[s].votos || {}).sort()]),
  );
}

function elegirActas(db, prefijo, incluirBorradores) {
  const filas = db
    .prepare(
      `SELECT m.id AS mesa_id, m.numero, m.ubigeo, m.electores_habiles, a.id AS acta_id, a.estado, a.conteo,
              a.total_votantes, a.cerrado_en, a.actualizado_en, json_array_length(a.registros) AS n_registros
       FROM mesas m LEFT JOIN actas a ON a.mesa_id = m.id
       WHERE m.ubigeo LIKE ?`,
    )
    .all(`${prefijo}%`);

  const porMesa = new Map();
  for (const f of filas) {
    if (!porMesa.has(f.mesa_id)) porMesa.set(f.mesa_id, { mesa: f, actas: [] });
    if (f.acta_id) porMesa.get(f.mesa_id).actas.push({ ...f, conteo: JSON.parse(f.conteo || '{}') });
  }

  const elegidas = [];
  const stats = { registradas: porMesa.size, cerradas: 0, en_conteo: 0, contabilizadas: 0, con_diferencias: [] };
  for (const { mesa, actas } of porMesa.values()) {
    const cerradas = actas.filter((a) => a.estado === 'cerrada').sort((a, b) => String(b.cerrado_en).localeCompare(String(a.cerrado_en)));
    let elegida = null;
    if (cerradas.length) {
      stats.cerradas++;
      elegida = cerradas[0];
      if (new Set(cerradas.map((a) => firma(a.conteo))).size > 1) stats.con_diferencias.push(mesa.numero);
    } else {
      const activos = actas.filter((a) => a.n_registros > 0).sort((a, b) => b.n_registros - a.n_registros);
      if (activos.length) {
        stats.en_conteo++;
        if (incluirBorradores) elegida = activos[0];
      }
    }
    if (elegida) {
      stats.contabilizadas++;
      elegidas.push({ numero: mesa.numero, ubigeo: mesa.ubigeo, estado: elegida.estado, conteo: elegida.conteo, n_actas: actas.length });
    }
  }
  stats.con_diferencias.sort();
  return { elegidas, stats };
}

function nombresDe(db, ids) {
  const out = {};
  const q = db.prepare('SELECT id, nombre, logo FROM organizaciones WHERE id = ?');
  for (const id of ids) {
    const o = q.get(Number(id));
    if (o) out[id] = o;
  }
  return out;
}

function sumar(elegidas, seccion) {
  const votos = {};
  for (const e of elegidas) {
    for (const [k, n] of Object.entries(e.conteo?.[seccion]?.votos || {})) votos[k] = (votos[k] || 0) + n;
  }
  return votos;
}

function ranking(db, votos, organizacionesBase = []) {
  const r = resumenSeccion({ votos });
  const ids = new Set([...Object.keys(votos).filter((k) => !ESPECIALES[k]), ...organizacionesBase.map((o) => String(o.id))]);
  const nombres = nombresDe(db, ids);
  const orgs = [...ids]
    .map((id) => ({
      id: Number(id),
      nombre: nombres[id]?.nombre || `Organización ${id}`,
      logo: nombres[id]?.logo || null,
      votos: votos[id] || 0,
      pct_validos: r.validos ? (100 * (votos[id] || 0)) / r.validos : 0,
      pct_emitidos: r.emitidos ? (100 * (votos[id] || 0)) / r.emitidos : 0,
    }))
    .sort((a, b) => b.votos - a.votos || a.nombre.localeCompare(b.nombre, 'es'));
  return { ...r, organizaciones: orgs };
}

// Carrera "principal" para saber quién va ganando en cada subdivisión.
function carreraPrincipal(ubigeo) {
  return seccionesDeAmbito(ubigeo)[0] || null;
}

export function calcularDashboard(db, { ubigeo, seccion, incluirBorradores }) {
  const ambito = describir(ubigeo);
  const disponibles = seccionesDeAmbito(ubigeo);
  const sec = disponibles.includes(seccion) ? seccion : disponibles[0] || null;
  const { elegidas, stats } = elegirActas(db, ubigeo, incluirBorradores);

  let resultados = null;
  if (sec) {
    const aplicables = elegidas.filter((e) => seccionesParaUbigeo(e.ubigeo).includes(sec));
    const base = listarAmbito(db, sec, ambitoDeSeccion(sec, ubigeo));
    resultados = { seccion: sec, titulo: SECCIONES[sec].titulo, mesas: aplicables.length, ...ranking(db, sumar(aplicables, sec), base) };
  }

  const desglose = [];
  for (const h of hijos(ubigeo)) {
    const suyas = elegidas.filter((e) => e.ubigeo.startsWith(h.ubigeo));
    const hayMesas = db.prepare('SELECT COUNT(*) AS n FROM mesas WHERE ubigeo LIKE ?').get(`${h.ubigeo}%`).n;
    if (!hayMesas) continue;
    const carrera = carreraPrincipal(h.ubigeo);
    const r = carrera ? ranking(db, sumar(suyas.filter((e) => seccionesParaUbigeo(e.ubigeo).includes(carrera)), carrera)) : null;
    const [primero, segundo] = (r?.organizaciones || []).filter((o) => o.votos > 0);
    desglose.push({
      ubigeo: h.ubigeo,
      nombre: h.nombre,
      carrera,
      carrera_titulo: carrera ? SECCIONES[carrera].corto : null,
      mesas_registradas: hayMesas,
      mesas_contabilizadas: suyas.length,
      validos: r?.validos || 0,
      lider: primero || null,
      segundo: segundo || null,
    });
  }

  // En un distrito, el detalle es por mesa.
  let mesas = null;
  if (ubigeo.length === 6) {
    const principal = carreraPrincipal(ubigeo);
    const filas = db.prepare('SELECT id, numero FROM mesas WHERE ubigeo = ? ORDER BY numero').all(ubigeo);
    mesas = filas.map((m) => {
      const e = elegidas.find((x) => x.numero === m.numero);
      const actas = db.prepare('SELECT estado, json_array_length(registros) AS n FROM actas WHERE mesa_id = ?').all(m.id);
      const r = e ? ranking(db, e.conteo?.[principal]?.votos || {}) : null;
      return {
        numero: m.numero,
        estado: e?.estado || (actas.some((a) => a.n > 0) ? 'en_conteo' : 'pendiente'),
        personeros: actas.length,
        diferencias: stats.con_diferencias.includes(m.numero),
        lider: r?.organizaciones.find((o) => o.votos > 0) || null,
        emitidos: r?.emitidos || 0,
      };
    });
  }

  return {
    ambito,
    secciones: disponibles.map((s) => ({ id: s, titulo: SECCIONES[s].titulo, corto: SECCIONES[s].corto })),
    resultados,
    mesas_stats: stats,
    desglose,
    mesas,
    incluye_borradores: !!incluirBorradores,
    generado_en: new Date().toISOString(),
  };
}
