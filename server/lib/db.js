// Capa de base de datos con dos motores y la misma interfaz asíncrona:
//   - SQLite (node:sqlite): por defecto, un solo archivo, ideal para una PC o un servidor pequeño.
//   - PostgreSQL (DATABASE_URL=postgres://...): para alto tráfico con varias réplicas de cada servicio.
//
// Las consultas se escriben con `?` y SQL común a ambos motores; el adaptador de Postgres
// convierte los `?` a $1, $2... Las fechas se guardan como texto ISO generado en JS.
//
//   db.all(sql, params)  -> filas
//   db.get(sql, params)  -> primera fila o undefined
//   db.run(sql, params)  -> { cambios }
//   db.insertar(sql, params) -> id insertado
//   db.tx(async (t) => ...)  -> transacción (t tiene la misma interfaz)

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export const ahora = () => new Date().toISOString();

const TABLAS = (tipos) => `
CREATE TABLE IF NOT EXISTS usuarios (
  id ${tipos.pk},
  dni TEXT NOT NULL UNIQUE,
  nombres TEXT NOT NULL,
  apellido_paterno TEXT NOT NULL,
  apellido_materno TEXT NOT NULL DEFAULT '',
  nombre TEXT NOT NULL,
  dni_verificado INTEGER NOT NULL DEFAULT 0,
  email TEXT UNIQUE,
  telefono TEXT,
  organizacion TEXT,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'personero' CHECK (rol IN ('personero', 'admin')),
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dni_cache (
  dni TEXT PRIMARY KEY,
  nombres TEXT NOT NULL,
  apellido_paterno TEXT NOT NULL,
  apellido_materno TEXT NOT NULL,
  consultado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizaciones (
  id ${tipos.pk},
  jne_id INTEGER UNIQUE,
  nombre TEXT NOT NULL,
  logo TEXT
);

CREATE TABLE IF NOT EXISTS circunscripcion_org (
  id ${tipos.pk},
  seccion TEXT NOT NULL CHECK (seccion IN ('regional', 'consejero', 'provincial', 'distrital')),
  ubigeo TEXT NOT NULL,
  organizacion_id INTEGER NOT NULL REFERENCES organizaciones(id),
  orden INTEGER NOT NULL DEFAULT 0,
  fuente TEXT NOT NULL DEFAULT 'manual',
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  UNIQUE (seccion, ubigeo, organizacion_id)
);

CREATE TABLE IF NOT EXISTS sincronizaciones (
  seccion TEXT NOT NULL,
  ubigeo TEXT NOT NULL,
  fuente TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  PRIMARY KEY (seccion, ubigeo)
);

CREATE TABLE IF NOT EXISTS mesas (
  id ${tipos.pk},
  numero TEXT NOT NULL UNIQUE,
  ubigeo TEXT NOT NULL,
  local_votacion TEXT,
  electores_habiles INTEGER NOT NULL DEFAULT 300,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actas (
  id ${tipos.pk},
  mesa_id INTEGER NOT NULL REFERENCES mesas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'cerrada')),
  modo TEXT NOT NULL DEFAULT 'cedula',
  total_votantes INTEGER,
  registros TEXT NOT NULL DEFAULT '[]',
  n_registros INTEGER NOT NULL DEFAULT 0,
  conteo TEXT NOT NULL DEFAULT '{}',
  firma TEXT NOT NULL DEFAULT '',
  cuadra INTEGER NOT NULL DEFAULT 0,
  observacion TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL,
  cerrado_en TEXT,
  UNIQUE (mesa_id, usuario_id)
);

-- Votos consolidados por mesa, listos para sumar con SQL en el dashboard.
-- tipo 'oficial': acta cerrada elegida de la mesa. tipo 'parcial': la cerrada o, si no hay, el borrador más avanzado.
CREATE TABLE IF NOT EXISTS votos_mesa (
  mesa_id INTEGER NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  ubigeo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  seccion TEXT NOT NULL,
  opcion TEXT NOT NULL,
  votos INTEGER NOT NULL,
  PRIMARY KEY (mesa_id, tipo, seccion, opcion)
);

-- Ajustes del sistema (p. ej. si ya se borraron los datos de prueba).
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mesas_ubigeo ON mesas(ubigeo);
CREATE INDEX IF NOT EXISTS idx_actas_mesa ON actas(mesa_id);
CREATE INDEX IF NOT EXISTS idx_actas_usuario ON actas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_circ ON circunscripcion_org(seccion, ubigeo);
CREATE INDEX IF NOT EXISTS idx_votos ON votos_mesa(tipo, seccion, ubigeo);
`;

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------
async function abrirSqlite(ruta) {
  const { DatabaseSync } = await import('node:sqlite');
  if (ruta !== ':memory:') {
    mkdirSync(dirname(ruta), { recursive: true });
    // Base de la versión 1 (sin apellidos ni votos consolidados): se respalda y se empieza de nuevo.
    if (existsSync(ruta)) {
      const vieja = new DatabaseSync(ruta);
      const cols = vieja.prepare("SELECT name FROM pragma_table_info('usuarios')").all().map((c) => c.name);
      vieja.close();
      if (cols.length && !cols.includes('apellido_paterno')) {
        const respaldo = ruta.replace(/\.db$/, '') + `.v1-${Date.now()}.db`;
        renameSync(ruta, respaldo);
        console.warn(`[db] Base de datos de la versión anterior respaldada en ${respaldo}. Se crea una nueva.`);
      }
    }
  }
  const s = new DatabaseSync(ruta);
  s.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  s.exec(TABLAS({ pk: 'INTEGER PRIMARY KEY AUTOINCREMENT' }));

  const stmts = new Map();
  const prep = (sql) => {
    let st = stmts.get(sql);
    if (!st) {
      st = s.prepare(sql);
      stmts.set(sql, st);
    }
    return st;
  };
  const api = {
    motor: 'sqlite',
    async all(sql, p = []) { return prep(sql).all(...p); },
    async get(sql, p = []) { return prep(sql).get(...p); },
    async run(sql, p = []) { return { cambios: Number(prep(sql).run(...p).changes) }; },
    async insertar(sql, p = []) { return Number(prep(sql).run(...p).lastInsertRowid); },
    async exec(sql) { s.exec(sql); },
    // SQLite es síncrono: mientras fn solo espere consultas de esta misma base, ninguna otra
    // petición se intercala dentro de la transacción.
    async tx(fn) {
      s.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn(api);
        s.exec('COMMIT');
        return r;
      } catch (e) {
        s.exec('ROLLBACK');
        throw e;
      }
    },
    async candado(_id, fn) { return fn(); },
    async cerrar() { s.close(); },
  };
  return api;
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------
const aPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

async function abrirPostgres(url) {
  const { default: pg } = await import('pg');
  // COUNT/SUM llegan como bigint/numeric: los convertimos a número.
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 20),
    idleTimeoutMillis: 30000,
    ssl: process.env.PG_SSL === '1' ? { rejectUnauthorized: false } : undefined,
  });

  const envolver = (c) => ({
    motor: 'postgres',
    async all(sql, p = []) { return (await c.query(aPg(sql), p)).rows; },
    async get(sql, p = []) { return (await c.query(aPg(sql), p)).rows[0]; },
    async run(sql, p = []) { return { cambios: (await c.query(aPg(sql), p)).rowCount }; },
    async insertar(sql, p = []) { return (await c.query(`${aPg(sql)} RETURNING id`, p)).rows[0]?.id; },
    async exec(sql) { await c.query(sql); },
  });

  const api = {
    ...envolver(pool),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(envolver(c));
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    // Ejecuta fn con exclusión entre réplicas (candado de Postgres).
    async candado(id, fn) {
      const c = await pool.connect();
      try {
        await c.query('SELECT pg_advisory_lock($1)', [id]);
        return await fn();
      } finally {
        await c.query('SELECT pg_advisory_unlock($1)', [id]).catch(() => {});
        c.release();
      }
    },
    async cerrar() { await pool.end(); },
  };

  // Varias réplicas arrancan a la vez: un candado evita que creen las tablas en paralelo.
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(20261004)');
    await c.query(TABLAS({ pk: 'SERIAL PRIMARY KEY' }));
  } finally {
    await c.query('SELECT pg_advisory_unlock(20261004)').catch(() => {});
    c.release();
  }
  return api;
}

/** Abre la base según la configuración: DATABASE_URL (Postgres) o un archivo SQLite. */
export async function abrirDB({ url = process.env.DATABASE_URL, ruta } = {}) {
  if (url && /^postgres(ql)?:\/\//.test(url)) return abrirPostgres(url);
  return abrirSqlite(ruta);
}
