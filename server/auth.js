import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DURACION_TOKEN_MS = 1000 * 60 * 60 * 24 * 30; // 30 días: el personero no debe perder la sesión el día de la elección

export function cargarSecreto(ruta) {
  if (process.env.SECRET) return process.env.SECRET;
  if (ruta === ':memory:') return randomBytes(32).toString('hex');
  if (existsSync(ruta)) return readFileSync(ruta, 'utf8').trim();
  mkdirSync(dirname(ruta), { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(ruta, s, { mode: 0o600 });
  return s;
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verificarPassword(password, guardado) {
  const [saltHex, hashHex] = String(guardado).split(':');
  if (!saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), esperado.length);
  return timingSafeEqual(hash, esperado);
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function crearToken(secreto, uid) {
  const payload = b64(JSON.stringify({ uid, exp: Date.now() + DURACION_TOKEN_MS }));
  const firma = createHmac('sha256', secreto).update(payload).digest('base64url');
  return `${payload}.${firma}`;
}

export function leerToken(secreto, token) {
  const [payload, firma] = String(token || '').split('.');
  if (!payload || !firma) return null;
  const esperada = createHmac('sha256', secreto).update(payload).digest();
  const recibida = Buffer.from(firma, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
  try {
    const datos = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!datos.exp || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

/** Limitador simple en memoria para login/registro (por IP). */
export function limitador({ ventanaMs = 10 * 60 * 1000, max = 30 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const ahora = Date.now();
    const clave = req.ip;
    const h = (hits.get(clave) || []).filter((t) => ahora - t < ventanaMs);
    h.push(ahora);
    hits.set(clave, h);
    if (h.length > max) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    next();
  };
}
