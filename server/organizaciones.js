// Catálogo de organizaciones por circunscripción y sincronización con el JNE.
//
// La plataforma Voto Informado del JNE expone un endpoint público (POST JSON, sin sesión):
//   POST https://votoinformado.jne.gob.pe/api/v1/candidatos/organizaciones
//   body: { "dep": "04", "pro": "01", "dis": "09" }   <- códigos RENIEC, no INEI
// La respuesta agrupa las organizaciones por tipo de elección:
//   idTipoEleccion 4 = REGIONAL (listas con tieneGobernadores / tieneConsejeros)
//   idTipoEleccion 5 = MUNICIPAL PROVINCIAL
//   idTipoEleccion 6 = MUNICIPAL DISTRITAL
// No es una API documentada oficialmente: si cambia o no responde, el sistema sigue
// funcionando con lo que haya en la base (semilla, sincronizaciones previas o carga manual).

import { transaccion } from './db.js';
import { ambitoDeSeccion, seccionesParaUbigeo } from '../shared/acta.js';
import { describir } from './ubigeo.js';

export const JNE_API = process.env.JNE_API || 'https://votoinformado.jne.gob.pe/api/v1/candidatos/organizaciones';
export const JNE_LOGOS = 'https://stovotoinformadodev.blob.core.windows.net/contenedor-2/';
const JNE_TIMEOUT_MS = Number(process.env.JNE_TIMEOUT_MS || 10000);
const JNE_REFRESCO_HORAS = Number(process.env.JNE_REFRESCO_HORAS || 24);

export function upsertOrganizacion(db, { jne_id, nombre, logo }) {
  nombre = String(nombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!nombre) throw new Error('Nombre de organización vacío');
  if (jne_id) {
    const existe = db.prepare('SELECT id FROM organizaciones WHERE jne_id = ?').get(jne_id);
    if (existe) {
      db.prepare('UPDATE organizaciones SET nombre = ?, logo = COALESCE(?, logo) WHERE id = ?').run(nombre, logo || null, existe.id);
      return existe.id;
    }
    // Si alguien la cargó a mano antes, la vinculamos al JNE en vez de duplicarla.
    const manual = db.prepare('SELECT id FROM organizaciones WHERE jne_id IS NULL AND nombre = ?').get(nombre);
    if (manual) {
      db.prepare('UPDATE organizaciones SET jne_id = ?, logo = COALESCE(?, logo) WHERE id = ?').run(jne_id, logo || null, manual.id);
      return manual.id;
    }
    return Number(db.prepare('INSERT INTO organizaciones (jne_id, nombre, logo) VALUES (?, ?, ?)').run(jne_id, nombre, logo || null).lastInsertRowid);
  }
  const existe = db.prepare('SELECT id FROM organizaciones WHERE nombre = ?').get(nombre);
  if (existe) return existe.id;
  return Number(db.prepare('INSERT INTO organizaciones (nombre, logo) VALUES (?, ?)').run(nombre, logo || null).lastInsertRowid);
}

/** Reemplaza la lista de una circunscripción proveniente de una fuente (las cargas manuales se conservan). */
export function reemplazarAmbito(db, { seccion, ubigeo, fuente, organizaciones }) {
  transaccion(db, () => {
    db.prepare('DELETE FROM circunscripcion_org WHERE seccion = ? AND ubigeo = ? AND fuente = ?').run(seccion, ubigeo, fuente);
    const ins = db.prepare(
      `INSERT INTO circunscripcion_org (seccion, ubigeo, organizacion_id, orden, fuente) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (seccion, ubigeo, organizacion_id) DO UPDATE SET fuente = excluded.fuente`,
    );
    organizaciones.forEach((o, i) => ins.run(seccion, ubigeo, upsertOrganizacion(db, o), o.orden ?? i + 1, fuente));
    db.prepare(
      `INSERT INTO sincronizaciones (seccion, ubigeo, fuente, actualizado_en) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (seccion, ubigeo) DO UPDATE SET fuente = excluded.fuente, actualizado_en = excluded.actualizado_en`,
    ).run(seccion, ubigeo, fuente);
  });
}

export function agregarManual(db, { seccion, ubigeo, nombre, usuarioId }) {
  const orgId = upsertOrganizacion(db, { nombre });
  const max = db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM circunscripcion_org WHERE seccion = ? AND ubigeo = ?').get(seccion, ubigeo).m;
  db.prepare(
    `INSERT INTO circunscripcion_org (seccion, ubigeo, organizacion_id, orden, fuente, creado_por) VALUES (?, ?, ?, ?, 'manual', ?)
     ON CONFLICT (seccion, ubigeo, organizacion_id) DO NOTHING`,
  ).run(seccion, ubigeo, orgId, max + 1, usuarioId ?? null);
  return orgId;
}

export function listarAmbito(db, seccion, ubigeo) {
  return db
    .prepare(
      `SELECT c.id AS circ_id, o.id, o.nombre, o.logo, o.jne_id, c.orden, c.fuente
       FROM circunscripcion_org c JOIN organizaciones o ON o.id = c.organizacion_id
       WHERE c.seccion = ? AND c.ubigeo = ? ORDER BY c.orden, o.nombre`,
    )
    .all(seccion, ubigeo);
}

/** Organizaciones de cada sección que se vota en un distrito. */
export function organizacionesDeDistrito(db, ubigeoDistrito) {
  const out = {};
  for (const s of seccionesParaUbigeo(ubigeoDistrito)) {
    const ambito = ambitoDeSeccion(s, ubigeoDistrito);
    const sync = db.prepare('SELECT fuente, actualizado_en FROM sincronizaciones WHERE seccion = ? AND ubigeo = ?').get(s, ambito);
    out[s] = { ambito, organizaciones: listarAmbito(db, s, ambito), sincronizado: sync || null };
  }
  return out;
}

function necesitaSync(db, ubigeoDistrito) {
  const limite = Date.now() - JNE_REFRESCO_HORAS * 3600 * 1000;
  return seccionesParaUbigeo(ubigeoDistrito).some((s) => {
    const r = db.prepare('SELECT actualizado_en FROM sincronizaciones WHERE seccion = ? AND ubigeo = ?').get(s, ambitoDeSeccion(s, ubigeoDistrito));
    return !r || new Date(r.actualizado_en + 'Z').getTime() < limite;
  });
}

async function consultarJNE(body, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), JNE_TIMEOUT_MS);
  try {
    const r = await fetchImpl(JNE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'es-PE,es;q=0.9' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`JNE respondió ${r.status}`);
    const json = await r.json();
    if (!json || !Array.isArray(json.data)) throw new Error('Respuesta del JNE sin datos');
    return json.data;
  } finally {
    clearTimeout(t);
  }
}

const aOrg = (o) => ({
  jne_id: o.idOrganizacionPolitica,
  nombre: o.organizacionPolitica,
  logo: o.URLlogoOP ? JNE_LOGOS + o.URLlogoOP : null,
});
const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es');

function bloque(data, id, texto) {
  return data.find((b) => b.idTipoEleccion === id) || data.find((b) => String(b.tipoEleccion || '').toUpperCase().includes(texto));
}

/**
 * Descarga del JNE las organizaciones de las secciones de un distrito y las guarda.
 * Devuelve un resumen { seccion: cantidad }.
 */
export async function sincronizarDistritoJNE(db, ubigeoDistrito, { fetchImpl } = {}) {
  const info = describir(ubigeoDistrito);
  if (!info || info.nivel !== 'distrito') throw new Error('Ubigeo de distrito inválido');
  if (!info.reniec) throw new Error(`No hay código RENIEC para ${info.distrito}; carga las organizaciones manualmente.`);
  const r = info.reniec;
  const data = await consultarJNE({ dep: r.slice(0, 2), pro: r.slice(2, 4), dis: r.slice(4, 6) }, fetchImpl);
  const secciones = seccionesParaUbigeo(ubigeoDistrito);
  const resumen = {};

  const reg = bloque(data, 4, 'REGIONAL');
  if (reg && secciones.includes('regional')) {
    const orgs = reg.organizaciones || [];
    const conLista = (flag) =>
      orgs.filter((o) => !o.listas?.length || o.listas.some((l) => l[flag] !== false)).map(aOrg).sort(porNombre);
    const gob = conLista('tieneGobernadores');
    const cons = conLista('tieneConsejeros');
    reemplazarAmbito(db, { seccion: 'regional', ubigeo: ambitoDeSeccion('regional', ubigeoDistrito), fuente: 'jne', organizaciones: gob });
    reemplazarAmbito(db, { seccion: 'consejero', ubigeo: ambitoDeSeccion('consejero', ubigeoDistrito), fuente: 'jne', organizaciones: cons });
    resumen.regional = gob.length;
    resumen.consejero = cons.length;
  }
  const prov = bloque(data, 5, 'PROVINCIAL');
  if (prov) {
    const orgs = (prov.organizaciones || []).map(aOrg).sort(porNombre);
    reemplazarAmbito(db, { seccion: 'provincial', ubigeo: ambitoDeSeccion('provincial', ubigeoDistrito), fuente: 'jne', organizaciones: orgs });
    resumen.provincial = orgs.length;
  }
  const dist = bloque(data, 6, 'DISTRITAL');
  if (dist && secciones.includes('distrital')) {
    const orgs = (dist.organizaciones || []).map(aOrg).sort(porNombre);
    reemplazarAmbito(db, { seccion: 'distrital', ubigeo: ubigeoDistrito, fuente: 'jne', organizaciones: orgs });
    resumen.distrital = orgs.length;
  }
  return resumen;
}

/** Intenta sincronizar si faltan datos o están viejos; nunca lanza (el JNE puede no responder). */
const fallosRecientes = new Map(); // ubigeo -> timestamp; evita esperar al JNE en cada pantalla si está caído
const ESPERA_TRAS_FALLO_MS = 10 * 60 * 1000;

export async function asegurarOrganizaciones(db, ubigeoDistrito) {
  if (process.env.JNE_AUTO === '0' || !necesitaSync(db, ubigeoDistrito)) return null;
  if (Date.now() - (fallosRecientes.get(ubigeoDistrito) || 0) < ESPERA_TRAS_FALLO_MS) return null;
  try {
    const resumen = await sincronizarDistritoJNE(db, ubigeoDistrito);
    fallosRecientes.delete(ubigeoDistrito);
    return { ok: true, resumen };
  } catch (e) {
    fallosRecientes.set(ubigeoDistrito, Date.now());
    return { ok: false, error: e.name === 'AbortError' ? 'El JNE no respondió a tiempo' : e.message };
  }
}

/** Carga un archivo semilla (formato data/seed/*.json). */
export function cargarSemilla(db, semilla) {
  let n = 0;
  for (const a of semilla.ambitos || []) {
    reemplazarAmbito(db, { seccion: a.tipo, ubigeo: a.ubigeo, fuente: 'jne', organizaciones: [...a.organizaciones].sort(porNombre) });
    n++;
  }
  return n;
}
