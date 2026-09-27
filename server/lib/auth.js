import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const DURACION_TOKEN_MS = 1000 * 60 * 60 * 24 * 30; // 30 días: el personero no debe perder la sesión el día de la elección

export function cargarSecreto(ruta) {
  if (process.env.SECRET) return process.env.SECRET;
  if (!ruta || ruta === ':memory:') return randomBytes(32).toString('hex');
  if (existsSync(ruta)) return readFileSync(ruta, 'utf8').trim();
  mkdirSync(dirname(ruta), { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(ruta, s, { mode: 0o600 });
  return s;
}

// scrypt asíncrono: no bloquea el proceso mientras se registran o ingresan muchos personeros.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verificarPassword(password, guardado) {
  const [saltHex, hashHex] = String(guardado).split(':');
  if (!saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const hash = await scryptAsync(password, Buffer.from(saltHex, 'hex'), esperado.length);
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
