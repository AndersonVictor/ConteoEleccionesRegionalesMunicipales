// Piezas HTTP comunes a todos los servicios: errores, autenticación y roles.
import { leerToken } from './auth.js';

export class ErrorHttp extends Error {
  constructor(status, msg, extra) {
    super(msg);
    this.status = status;
    this.extra = extra;
  }
}

export const fallar = (status, msg, extra) => {
  throw new ErrorHttp(status, msg, extra);
};

// Envuelve handlers async para que los errores lleguen al manejador central.
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const usuarioPublico = (u) =>
  u && {
    id: u.id,
    dni: u.dni,
    nombres: u.nombres,
    apellido_paterno: u.apellido_paterno,
    apellido_materno: u.apellido_materno,
    nombre: u.nombre,
    dni_verificado: !!u.dni_verificado,
    email: u.email,
    telefono: u.telefono,
    organizacion: u.organizacion,
    rol: u.rol,
  };

// Caché corta de usuarios por id: evita ir a la base en cada toque del personero.
const usuarios = new Map();
const TTL_USUARIO_MS = 30000;
export const olvidarUsuario = (id) => usuarios.delete(Number(id));

/** Lee el token Bearer y deja req.usuario (o null). */
export function autenticar({ db, secreto }) {
  return h(async (req, _res, next) => {
    const auth = req.get('authorization') || '';
    const datos = auth.startsWith('Bearer ') ? leerToken(secreto, auth.slice(7)) : null;
    req.usuario = null;
    if (datos) {
      const c = usuarios.get(datos.uid);
      if (c && Date.now() - c.t < TTL_USUARIO_MS) req.usuario = c.u;
      else {
        req.usuario = (await db.get('SELECT * FROM usuarios WHERE id = ?', [datos.uid])) || null;
        if (usuarios.size > 20000) usuarios.clear();
        if (req.usuario) usuarios.set(datos.uid, { u: req.usuario, t: Date.now() });
      }
    }
    next();
  });
}

export const requiereLogin = (req, _res, next) => (req.usuario ? next() : next(new ErrorHttp(401, 'Inicia sesión para continuar')));
export const requiereAdmin = (req, _res, next) =>
  req.usuario?.rol === 'admin' ? next() : next(new ErrorHttp(req.usuario ? 403 : 401, 'Solo administradores'));

// eslint-disable-next-line no-unused-vars
export function manejadorErrores(err, _req, res, _next) {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message, ...(err.extra || {}) });
}
