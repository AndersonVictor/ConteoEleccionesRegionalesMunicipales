// Consolidado de resultados por ámbito (nacional, región, provincia, distrito).
// Todo se suma con SQL sobre votos_mesa (ver consolidado.js), por eso el costo no depende de
// cuántas cédulas tenga cada acta. El resultado se guarda unos segundos en caché: con miles de
// personeros mirando el mismo dashboard, la base calcula cada ámbito una sola vez.

import { ESPECIALES, LIMA_METROPOLITANA, SECCIONES, ambitoDeSeccion, resumenSeccion, seccionesParaUbigeo } from '../../shared/acta.js';
import { describir, hijos } from './ubigeo.js';
import { listarAmbito } from './organizaciones.js';
import { cacheado } from './cache.js';

const cacheSeg = () => Number(process.env.DASHBOARD_CACHE_SEG ?? 5);

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
const carreraPrincipal = (ubigeo) => seccionesDeAmbito(ubigeo)[0] || null;

async function nombresDe(db, ids) {
  const lista = [...ids].map(Number).filter(Number.isFinite);
  const out = {};
  for (let i = 0; i < lista.length; i += 500) {
    const parte = lista.slice(i, i + 500);
    const filas = await db.all(`SELECT id, nombre, logo FROM organizaciones WHERE id IN (${parte.map(() => '?').join(',')})`, parte);
    for (const o of filas) out[o.id] = o;
  }
  return out;
}

function ranking(votos, nombres, base = []) {
  const r = resumenSeccion({ votos });
  const ids = new Set([...Object.keys(votos).filter((k) => !ESPECIALES[k]), ...base.map((o) => String(o.id))]);
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

async function estadisticas(db, ubigeo, tipo) {
  const p = `${ubigeo}%`;
  const [reg, cer, enc, cont, dif] = await Promise.all([
    db.get('SELECT COUNT(*) AS n FROM mesas WHERE ubigeo LIKE ?', [p]),
    db.get(`SELECT COUNT(DISTINCT a.mesa_id) AS n FROM actas a JOIN mesas m ON m.id = a.mesa_id WHERE a.estado = 'cerrada' AND m.ubigeo LIKE ?`, [p]),
    db.get(
      `SELECT COUNT(DISTINCT a.mesa_id) AS n FROM actas a JOIN mesas m ON m.id = a.mesa_id
       WHERE a.estado = 'borrador' AND a.n_registros > 0 AND m.ubigeo LIKE ?
         AND NOT EXISTS (SELECT 1 FROM actas c WHERE c.mesa_id = a.mesa_id AND c.estado = 'cerrada')`,
      [p],
    ),
    db.get('SELECT COUNT(DISTINCT mesa_id) AS n FROM votos_mesa WHERE tipo = ? AND ubigeo LIKE ?', [tipo, p]),
    db.all(
      `SELECT m.numero FROM actas a JOIN mesas m ON m.id = a.mesa_id WHERE a.estado = 'cerrada' AND m.ubigeo LIKE ?
       GROUP BY m.numero HAVING COUNT(DISTINCT a.firma) > 1 ORDER BY m.numero LIMIT 200`,
      [p],
    ),
  ]);
  return {
    registradas: reg.n,
    cerradas: cer.n,
    en_conteo: enc.n,
    contabilizadas: cont.n,
    con_diferencias: dif.map((d) => d.numero),
  };
}

async function calcular(db, { ubigeo, seccion, incluirBorradores }) {
  const tipo = incluirBorradores ? 'parcial' : 'oficial';
  const p = `${ubigeo}%`;
  const ambito = describir(ubigeo);
  const disponibles = seccionesDeAmbito(ubigeo);
  const sec = disponibles.includes(seccion) ? seccion : disponibles[0] || null;
  const stats = await estadisticas(db, ubigeo, tipo);

  // Votos del ámbito para la sección elegida.
  let votosSec = {};
  let mesasSec = 0;
  let base = [];
  if (sec) {
    const filas = await db.all('SELECT opcion, SUM(votos) AS v FROM votos_mesa WHERE tipo = ? AND seccion = ? AND ubigeo LIKE ? GROUP BY opcion', [tipo, sec, p]);
    votosSec = Object.fromEntries(filas.map((f) => [f.opcion, f.v]));
    mesasSec = (await db.get('SELECT COUNT(DISTINCT mesa_id) AS n FROM votos_mesa WHERE tipo = ? AND seccion = ? AND ubigeo LIKE ?', [tipo, sec, p])).n;
    base = await listarAmbito(db, sec, ambitoDeSeccion(sec, ubigeo));
  }

  // Desglose: quién gana la carrera principal de cada subdivisión.
  const subdivisiones = hijos(ubigeo);
  const L = ubigeo.length === 0 ? 2 : ubigeo.length + 2;
  let porHijo = [];
  let mesasPorHijo = {};
  let contPorHijo = {};
  if (subdivisiones.length) {
    const carreras = [...new Set(subdivisiones.map((h) => carreraPrincipal(h.ubigeo)).filter(Boolean))];
    [porHijo, mesasPorHijo, contPorHijo] = await Promise.all([
      db.all(
        `SELECT substr(ubigeo, 1, ${L}) AS h, seccion, opcion, SUM(votos) AS v FROM votos_mesa
         WHERE tipo = ? AND ubigeo LIKE ? AND seccion IN (${carreras.map(() => '?').join(',')})
         GROUP BY substr(ubigeo, 1, ${L}), seccion, opcion`,
        [tipo, p, ...carreras],
      ),
      db.all(`SELECT substr(ubigeo, 1, ${L}) AS h, COUNT(*) AS n FROM mesas WHERE ubigeo LIKE ? GROUP BY substr(ubigeo, 1, ${L})`, [p])
        .then((f) => Object.fromEntries(f.map((x) => [x.h, x.n]))),
      db.all(`SELECT substr(ubigeo, 1, ${L}) AS h, COUNT(DISTINCT mesa_id) AS n FROM votos_mesa WHERE tipo = ? AND ubigeo LIKE ? GROUP BY substr(ubigeo, 1, ${L})`, [tipo, p])
        .then((f) => Object.fromEntries(f.map((x) => [x.h, x.n]))),
    ]);
  }

  // Detalle por mesa cuando el ámbito es un distrito.
  let filasMesas = [];
  let votosMesas = [];
  const principal = carreraPrincipal(ubigeo);
  if (ubigeo.length === 6) {
    [filasMesas, votosMesas] = await Promise.all([
      db.all(
        `SELECT m.id, m.numero,
                (SELECT COUNT(*) FROM actas a WHERE a.mesa_id = m.id) AS personeros,
                (SELECT COUNT(*) FROM actas a WHERE a.mesa_id = m.id AND a.estado = 'cerrada') AS cerradas,
                (SELECT COUNT(*) FROM actas a WHERE a.mesa_id = m.id AND a.n_registros > 0) AS con_votos
         FROM mesas m WHERE m.ubigeo = ? ORDER BY m.numero LIMIT 1000`,
        [ubigeo],
      ),
      db.all('SELECT mesa_id, opcion, votos FROM votos_mesa WHERE tipo = ? AND seccion = ? AND ubigeo = ?', [tipo, principal, ubigeo]),
    ]);
  }

  const ids = new Set([...Object.keys(votosSec), ...porHijo.map((f) => f.opcion), ...votosMesas.map((f) => f.opcion)].filter((k) => !ESPECIALES[k]));
  const nombres = await nombresDe(db, ids);

  const resultados = sec
    ? { seccion: sec, titulo: SECCIONES[sec].titulo, mesas: mesasSec, ...ranking(votosSec, nombres, base) }
    : null;

  const desglose = [];
  for (const h of subdivisiones) {
    if (!mesasPorHijo[h.ubigeo]) continue;
    const carrera = carreraPrincipal(h.ubigeo);
    const votos = {};
    for (const f of porHijo) if (f.h === h.ubigeo && f.seccion === carrera) votos[f.opcion] = f.v;
    const r = ranking(votos, nombres);
    const [primero, segundo] = r.organizaciones.filter((o) => o.votos > 0);
    desglose.push({
      ubigeo: h.ubigeo,
      nombre: h.nombre,
      carrera,
      carrera_titulo: carrera ? SECCIONES[carrera].corto : null,
      mesas_registradas: mesasPorHijo[h.ubigeo],
      mesas_contabilizadas: contPorHijo[h.ubigeo] || 0,
      validos: r.validos,
      lider: primero || null,
      segundo: segundo || null,
    });
  }

  let mesas = null;
  if (ubigeo.length === 6) {
    const porMesa = new Map();
    for (const v of votosMesas) {
      if (!porMesa.has(v.mesa_id)) porMesa.set(v.mesa_id, {});
      porMesa.get(v.mesa_id)[v.opcion] = v.votos;
    }
    mesas = filasMesas.map((m) => {
      const votos = porMesa.get(m.id);
      const r = votos ? ranking(votos, nombres) : null;
      return {
        numero: m.numero,
        estado: m.cerradas ? 'cerrada' : m.con_votos ? 'en_conteo' : 'pendiente',
        personeros: m.personeros,
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

export function calcularDashboard(db, opts) {
  const seg = cacheSeg();
  if (!(seg > 0)) return calcular(db, opts);
  const clave = `dash:${opts.ubigeo}:${opts.seccion || ''}:${opts.incluirBorradores ? 1 : 0}`;
  return cacheado(clave, seg, () => calcular(db, opts));
}
