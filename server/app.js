import express from 'express';
import { fileURLToPath } from 'node:url';
import { autenticar, fallar, manejadorErrores } from './lib/http.js';
import { rutasAuth } from './services/auth.js';
import { rutasConteo } from './services/conteo.js';
import { rutasResultados } from './services/resultados.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const SHARED = fileURLToPath(new URL('../shared', import.meta.url));

// Solo se ejecuta código propio; las imágenes pueden venir de los logos del JNE.
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; " +
  "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

export const SERVICIOS = {
  auth: rutasAuth,
  conteo: rutasConteo,
  resultados: rutasResultados,
};

/**
 * Crea la aplicación HTTP.
 *  - servicios: qué servicios monta (por defecto todos: modo "todo en uno").
 *  - estaticos: si sirve la PWA (en el despliegue con microservicios la sirve Nginx).
 */
export function crearApp({ db, secreto, servicios = Object.keys(SERVICIOS), estaticos = true }) {
  const app = express();
  // Solo se confía en proxies de red privada (Nginx en Docker); así nadie falsea su IP con X-Forwarded-For.
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/salud', async (_req, res) => {
    try {
      await db.get('SELECT 1 AS ok');
      res.json({ ok: true, servicios, motor: db.motor });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api', autenticar({ db, secreto }));
  for (const s of servicios) app.use(SERVICIOS[s]({ db, secreto }));
  app.use('/api', (_req, _res, next) => {
    try {
      fallar(404, 'Ruta no encontrada');
    } catch (e) {
      next(e);
    }
  });

  if (estaticos) {
    app.use('/shared', express.static(SHARED, { maxAge: 0 }));
    app.use(express.static(PUBLIC, { maxAge: 0, index: 'index.html' }));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: PUBLIC }));
  }
  app.use(manejadorErrores);
  return app;
}
