// Caché y contadores compartidos. Con REDIS_URL se usa Redis (todas las réplicas ven lo mismo);
// sin él, memoria del proceso (suficiente para una sola instancia).

let redis = null;

export async function iniciarCache(url = process.env.REDIS_URL) {
  if (!url || redis) return !!redis;
  const { createClient } = await import('redis');
  redis = createClient({ url });
  redis.on('error', (e) => console.error('[redis]', e.message));
  await redis.connect();
  return true;
}

export async function cerrarCache() {
  if (redis) await redis.quit().catch(() => {});
  redis = null;
}

const memoria = new Map(); // clave -> { valor, vence }
const MAX_MEMORIA = 5000;

function limpiarMemoria() {
  if (memoria.size < MAX_MEMORIA) return;
  const t = Date.now();
  for (const [k, v] of memoria) if (v.vence < t) memoria.delete(k);
  // Si sigue lleno, se descartan las más antiguas.
  for (const k of memoria.keys()) {
    if (memoria.size < MAX_MEMORIA * 0.8) break;
    memoria.delete(k);
  }
}

export async function cacheGet(clave) {
  if (redis) {
    const v = await redis.get(clave).catch(() => null);
    return v == null ? null : JSON.parse(v);
  }
  const e = memoria.get(clave);
  if (!e || e.vence < Date.now()) return null;
  return e.valor;
}

export async function cacheSet(clave, valor, segundos) {
  if (redis) {
    await redis.set(clave, JSON.stringify(valor), { EX: segundos }).catch(() => {});
    return;
  }
  limpiarMemoria();
  memoria.set(clave, { valor, vence: Date.now() + segundos * 1000 });
}

// Evita que muchas peticiones iguales calculen lo mismo a la vez en este proceso.
const enCurso = new Map();

/** Devuelve el valor en caché o lo calcula una sola vez. */
export async function cacheado(clave, segundos, calcular) {
  const hit = await cacheGet(clave);
  if (hit != null) return hit;
  if (enCurso.has(clave)) return enCurso.get(clave);
  const p = (async () => {
    try {
      const v = await calcular();
      await cacheSet(clave, v, segundos);
      return v;
    } finally {
      enCurso.delete(clave);
    }
  })();
  enCurso.set(clave, p);
  return p;
}

/** Incrementa un contador con vencimiento; devuelve el valor actual. */
export async function contar(clave, segundos) {
  if (redis) {
    const n = await redis.incr(clave);
    if (n === 1) await redis.expire(clave, segundos);
    return n;
  }
  const e = memoria.get(clave);
  if (!e || e.vence < Date.now()) {
    limpiarMemoria();
    memoria.set(clave, { valor: 1, vence: Date.now() + segundos * 1000 });
    return 1;
  }
  e.valor += 1;
  return e.valor;
}

/** Middleware de límite de peticiones por IP. */
export function limitador({ nombre, max, ventanaSeg }) {
  return async (req, res, next) => {
    if (process.env.RATE_LIMIT === '0') return next();
    try {
      const n = await contar(`rl:${nombre}:${req.ip}`, ventanaSeg);
      if (n > max) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    } catch {
      /* si falla Redis no bloqueamos al personero */
    }
    next();
  };
}
