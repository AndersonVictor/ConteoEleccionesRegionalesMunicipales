import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  dni TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  telefono TEXT,
  organizacion TEXT,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'personero' CHECK (rol IN ('personero', 'admin')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catálogo de organizaciones políticas (partidos y movimientos regionales).
CREATE TABLE IF NOT EXISTS organizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jne_id INTEGER UNIQUE,
  nombre TEXT NOT NULL,
  logo TEXT
);

-- Qué organizaciones compiten en cada sección de cada circunscripción.
-- ubigeo: 2 dígitos (región), 4 (provincia) o 6 (distrito), en codificación INEI.
CREATE TABLE IF NOT EXISTS circunscripcion_org (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seccion TEXT NOT NULL CHECK (seccion IN ('regional', 'consejero', 'provincial', 'distrital')),
  ubigeo TEXT NOT NULL,
  organizacion_id INTEGER NOT NULL REFERENCES organizaciones(id),
  orden INTEGER NOT NULL DEFAULT 0,
  fuente TEXT NOT NULL DEFAULT 'manual',
  creado_por INTEGER REFERENCES usuarios(id),
  UNIQUE (seccion, ubigeo, organizacion_id)
);

-- Última vez que se consultó al JNE por una circunscripción.
CREATE TABLE IF NOT EXISTS sincronizaciones (
  seccion TEXT NOT NULL,
  ubigeo TEXT NOT NULL,
  fuente TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  PRIMARY KEY (seccion, ubigeo)
);

CREATE TABLE IF NOT EXISTS mesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  ubigeo TEXT NOT NULL,
  local_votacion TEXT,
  electores_habiles INTEGER NOT NULL DEFAULT 300,
  creado_por INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un acta por personero y mesa. Varios personeros pueden contar la misma mesa.
CREATE TABLE IF NOT EXISTS actas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mesa_id INTEGER NOT NULL REFERENCES mesas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'cerrada')),
  modo TEXT NOT NULL DEFAULT 'cedula',
  total_votantes INTEGER,
  registros TEXT NOT NULL DEFAULT '[]',
  conteo TEXT NOT NULL DEFAULT '{}',
  cuadra INTEGER NOT NULL DEFAULT 0,
  observacion TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  cerrado_en TEXT,
  UNIQUE (mesa_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_mesas_ubigeo ON mesas(ubigeo);
CREATE INDEX IF NOT EXISTS idx_circ ON circunscripcion_org(seccion, ubigeo);
`;

export function abrirDB(ruta) {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec(ESQUEMA);
  return db;
}

/** Ejecuta fn dentro de una transacción. */
export function transaccion(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
