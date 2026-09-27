// Punto de entrada.
//   npm start                      -> todo en uno (API + PWA), SQLite por defecto
//   SERVICIO=auth npm start        -> solo el servicio de usuarios (microservicio)
//   SERVICIO=conteo npm start      -> solo mesas y actas
//   SERVICIO=resultados npm start  -> solo el dashboard
// Con DATABASE_URL usa PostgreSQL; con REDIS_URL comparte caché y límites entre réplicas.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { abrirDB } from './lib/db.js';
import { cargarSecreto } from './lib/auth.js';
import { iniciarCache } from './lib/cache.js';
import { cargarSemilla } from './lib/organizaciones.js';
import { crearApp, SERVICIOS } from './app.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));

// Lee el archivo .env de la carpeta del proyecto aunque el servidor se inicie sin `npm start`.
const ENV = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(ENV)) {
  process.loadEnvFile(ENV);
  console.log(`Configuración cargada de ${ENV}`);
}
const servicio = process.env.SERVICIO || '';
if (servicio && !SERVICIOS[servicio]) {
  console.error(`SERVICIO desconocido: ${servicio}. Usa ${Object.keys(SERVICIOS).join(', ')}`);
  process.exit(1);
}
if (servicio && !process.env.SECRET) {
  console.error('En modo microservicio todas las réplicas deben compartir la variable SECRET.');
  process.exit(1);
}

const db = await abrirDB({ ruta: process.env.DB_PATH || `${DATA}conteo.db` });
if (await iniciarCache()) console.log('Caché compartida en Redis');
if (!servicio || servicio === 'auth') {
  console.log(process.env.DECOLECTA_TOKEN
    ? 'Consulta de DNI (Decolecta): ACTIVADA'
    : 'Consulta de DNI (Decolecta): DESACTIVADA. Pon DECOLECTA_TOKEN=... en el archivo .env y reinicia.');
}
const secreto = cargarSecreto(process.env.SECRET_PATH || `${DATA}secret.key`);

// Primera vez: carga las organizaciones incluidas en data/seed.
// Con varias réplicas, el candado hace que solo una la cargue.
if ((!servicio || servicio === 'conteo') && process.env.SEMILLA_AL_INICIAR !== '0') {
  await db.candado(20261005, async () => {
    const { n } = await db.get('SELECT COUNT(*) AS n FROM organizaciones');
    if (Number(n)) return;
    for (const f of readdirSync(`${DATA}seed`).filter((x) => x.endsWith('.json'))) {
      const c = await cargarSemilla(db, JSON.parse(readFileSync(`${DATA}seed/${f}`, 'utf8')));
      console.log(`Semilla ${f}: ${c} circunscripciones`);
    }
  });
}

const app = crearApp({
  db,
  secreto,
  servicios: servicio ? [servicio] : Object.keys(SERVICIOS),
  estaticos: !servicio,
});
const puerto = Number(process.env.PORT || 3000);
const server = app.listen(puerto, process.env.HOST || '0.0.0.0', () => {
  console.log(`Conteo ERM 2026 [${servicio || 'todo en uno'}] en http://localhost:${puerto} (base: ${db.motor})`);
});
server.keepAliveTimeout = 65000;

// Apagado ordenado (Docker/Kubernetes envían SIGTERM al reemplazar réplicas).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(async () => {
      await db.cerrar();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
