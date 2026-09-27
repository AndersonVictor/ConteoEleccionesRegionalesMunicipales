// Cliente de la API y almacenamiento local (sesión y actas pendientes de enviar).

const PREFIJO = 'erm26:';

export const local = {
  get(k, def = null) {
    try {
      const v = localStorage.getItem(PREFIJO + k);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v) {
    try { localStorage.setItem(PREFIJO + k, JSON.stringify(v)); } catch { /* almacenamiento lleno o bloqueado */ }
  },
  del(k) {
    try { localStorage.removeItem(PREFIJO + k); } catch { /* nada */ }
  },
  claves(prefijo) {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(PREFIJO + prefijo)).map((k) => k.slice(PREFIJO.length));
    } catch {
      return [];
    }
  },
};

export const sesion = {
  get token() { return local.get('token'); },
  get usuario() { return local.get('usuario'); },
  guardar({ token, usuario }) {
    if (token) local.set('token', token);
    if (usuario) local.set('usuario', usuario);
  },
  salir() {
    local.del('token');
    local.del('usuario');
    for (const k of local.claves('acta:')) local.del(k);
  },
};

export class ErrorApi extends Error {
  constructor(status, msg, datos = {}) {
    super(msg);
    this.status = status;
    this.datos = datos;
  }
}

export async function api(ruta, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (sesion.token) headers.Authorization = `Bearer ${sesion.token}`;
  let r;
  try {
    r = await fetch(`/api${ruta}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ErrorApi(0, 'Sin conexión con el servidor');
  }
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && sesion.token && !ruta.startsWith('/auth')) {
    sesion.salir();
    location.hash = '#/login';
  }
  if (!r.ok) throw new ErrorApi(r.status, datos.error || `Error ${r.status}`, datos);
  return datos;
}

// ---- Actas con respaldo local ------------------------------------------
// Cada cambio se guarda primero en el celular y luego se envía al servidor.
// Si no hay señal, queda marcado como pendiente y se reintenta.
// Los toques se agrupan: se envía como máximo una vez cada pocos segundos por acta, lo que
// reduce muchísimo la carga del servidor cuando miles de personeros cuentan a la vez.
const ESPERA_ENVIO_MS = 3000;

const temporizadores = new Map();
const oyentes = new Set();
export const alCambiarSync = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn); };
const avisar = (id, estado) => oyentes.forEach((fn) => fn(id, estado));

export function actaLocal(id) {
  return local.get(`acta:${id}`);
}

export function guardarActaLocal(id, datos, { pendiente = true } = {}) {
  local.set(`acta:${id}`, { ...datos, pendiente, guardado: Date.now() });
  if (pendiente) programarEnvio(id);
}

function programarEnvio(id, ms = ESPERA_ENVIO_MS, estado = 'pendiente', reprogramar = false) {
  avisar(id, estado);
  // Si ya hay un envío programado, ese envío llevará también este cambio (no se posterga).
  if (temporizadores.has(id) && !reprogramar) return;
  clearTimeout(temporizadores.get(id));
  temporizadores.set(id, setTimeout(() => {
    temporizadores.delete(id);
    enviarActa(id).catch(() => {});
  }, ms));
}

const enCurso = new Map(); // un solo envío a la vez por acta, para que no lleguen desordenados

export async function enviarActa(id) {
  if (enCurso.has(id)) {
    // Espera el envío actual y luego manda lo que haya cambiado mientras tanto.
    await enCurso.get(id).catch(() => {});
    return enviarActa(id);
  }
  const p = enviarActaAhora(id);
  enCurso.set(id, p);
  try {
    return await p;
  } finally {
    enCurso.delete(id);
  }
}

async function enviarActaAhora(id) {
  const l = actaLocal(id);
  if (!l?.pendiente) return null;
  try {
    const { acta } = await api(`/actas/${id}`, {
      method: 'PUT',
      body: { registros: l.acta.registros, total_votantes: l.acta.total_votantes, modo: l.acta.modo },
    });
    // Solo se marca como enviado si no hubo cambios nuevos mientras viajaba la petición.
    const ahora = actaLocal(id);
    if (ahora && ahora.guardado === l.guardado) {
      local.set(`acta:${id}`, { ...ahora, acta: { ...ahora.acta, version: acta.version, cuadra: acta.cuadra }, pendiente: false });
      avisar(id, 'ok');
    }
    return acta;
  } catch (e) {
    if (e.status === 0 || e.status === 429 || e.status >= 500) {
      // Sin señal o servidor saturado: se reintenta con espera aleatoria para no llegar todos juntos.
      programarEnvio(id, 10000 + Math.random() * 10000, navigator.onLine ? 'error' : 'offline', true);
    } else {
      avisar(id, 'error');
      if (e.status === 409) local.set(`acta:${id}`, { ...l, pendiente: false });
    }
    throw e;
  }
}

export function enviarPendientes() {
  for (const k of local.claves('acta:')) {
    const id = k.slice(5);
    if (actaLocal(id)?.pendiente) enviarActa(id).catch(() => {});
  }
}
