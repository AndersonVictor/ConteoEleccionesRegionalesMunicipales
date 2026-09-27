// Carga organizaciones políticas desde data/seed/*.json a la base de datos.
// Uso: npm run seed                 (carga todos los archivos de data/seed)
//      npm run seed -- arequipa     (solo data/seed/arequipa.json)
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { abrirDB } from '../server/db.js';
import { cargarSemilla } from '../server/organizaciones.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const db = abrirDB(process.env.DB_PATH || `${DATA}conteo.db`);
const filtro = process.argv[2];
const archivos = readdirSync(`${DATA}seed`).filter((f) => f.endsWith('.json') && (!filtro || f === `${filtro}.json`));
if (!archivos.length) {
  console.error('No se encontraron archivos de semilla');
  process.exit(1);
}
for (const f of archivos) {
  const n = cargarSemilla(db, JSON.parse(readFileSync(`${DATA}seed/${f}`, 'utf8')));
  console.log(`${f}: ${n} circunscripciones cargadas`);
}
