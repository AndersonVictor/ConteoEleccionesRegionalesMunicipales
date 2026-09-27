import { fileURLToPath } from 'node:url';
import { abrirDB } from './db.js';
import { cargarSecreto } from './auth.js';
import { crearApp } from './app.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const rutaDB = process.env.DB_PATH || `${DATA}conteo.db`;
const db = abrirDB(rutaDB);
const secreto = cargarSecreto(process.env.SECRET_PATH || `${DATA}secret.key`);
const puerto = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

crearApp({ db, secreto }).listen(puerto, host, () => {
  console.log(`Conteo ERM 2026 escuchando en http://localhost:${puerto}  (base de datos: ${rutaDB})`);
});
