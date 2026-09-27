import express from 'express';
import { fileURLToPath } from 'node:url';
import { crearToken, hashPassword, leerToken, limitador, verificarPassword } from './auth.js';
import { ARBOL_JSON, describir, esDistrito } from './ubigeo.js';
import {
  agregarManual,
  asegurarOrganizaciones,
  organizacionesDeDistrito,
  sincronizarDistritoJNE,
} from './organizaciones.js';
import { calcularDashboard } from './dashboard.js';
import { ESPECIALES, SECCIONES, evaluarCuadre, seccionesParaUbigeo } from '../shared/acta.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const SHARED = fileURLToPath(new URL('../shared', import.meta.url));

class ErrorHttp extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
const fallar = (status, msg) => {
  throw new ErrorHttp(status, msg);
};
// Envuelve handlers async para que los errores lleguen al manejador central.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const usuarioPublico = (u) => u && { id: u.id, nombre: u.nombre, dni: u.dni, email: u.email, telefono: u.telefono, organizacion: u.organizacion, rol: u.rol };

export function crearApp({ db, secreto }) {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // ---- Autenticación ----------------------------------------------------
  app.use('/api', (req, _res, next) => {
    const auth = req.get('authorization') || '';
    const datos = auth.startsWith('Bearer ') ? leerToken(secreto, auth.slice(7)) : null;
    req.usuario = datos ? db.prepare('SELECT * FROM usuarios WHERE id = ?').get(datos.uid) : null;
    next();
  });
  const requiereLogin = (req, _res, next) => (req.usuario ? next() : next(new ErrorHttp(401, 'Inicia sesión para continuar')));
  const requiereAdmin = (req, _res, next) =>
    req.usuario?.rol === 'admin' ? next() : next(new ErrorHttp(403, 'Solo administradores'));

  const limite = limitador();

  app.post('/api/auth/registro', limite, h((req, res) => {
    const b = req.body || {};
    const nombre = String(b.nombre || '').trim();
    const dni = String(b.dni || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const telefono = String(b.telefono || '').trim();
    const organizacion = String(b.organizacion || '').trim();
    const password = String(b.password || '');
    if (nombre.length < 3) fallar(400, 'Ingresa tu nombre completo');
    if (!/^\d{8}$/.test(dni)) fallar(400, 'El DNI debe tener 8 dígitos');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fallar(400, 'Correo inválido');
    if (password.length < 6) fallar(400, 'La contraseña debe tener al menos 6 caracteres');
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ? OR dni = ?').get(email, dni)) fallar(409, 'Ya existe una cuenta con ese correo o DNI');
    // El primer usuario registrado administra el sistema.
    const esPrimero = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0;
    const adminsEnv = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim());
    const rol = esPrimero || adminsEnv.includes(email) ? 'admin' : 'personero';
    const id = Number(
      db.prepare('INSERT INTO usuarios (nombre, dni, email, telefono, organizacion, password_hash, rol) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(nombre, dni, email, telefono || null, organizacion || null, hashPassword(password), rol).lastInsertRowid,
    );
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    res.status(201).json({ token: crearToken(secreto, id), usuario: usuarioPublico(u) });
  }));

  app.post('/api/auth/login', limite, h((req, res) => {
    const usuario = String(req.body?.usuario || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ? OR dni = ?').get(usuario, usuario);
    if (!u || !verificarPassword(String(req.body?.password || ''), u.password_hash)) fallar(401, 'Usuario o contraseña incorrectos');
    res.json({ token: crearToken(secreto, u.id), usuario: usuarioPublico(u) });
  }));

  app.get('/api/me', requiereLogin, (req, res) => res.json({ usuario: usuarioPublico(req.usuario) }));

  // ---- Ubigeo y organizaciones ------------------------------------------
  app.get('/api/ubigeo', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400').type('json').send(ARBOL_JSON);
  });

  app.get('/api/organizaciones', requiereLogin, h(async (req, res) => {
    const ubigeo = String(req.query.ubigeo || '');
    if (!esDistrito(ubigeo)) fallar(400, 'Selecciona un distrito válido');
    const jne = await asegurarOrganizaciones(db, ubigeo);
    res.json({ ubigeo: describir(ubigeo), secciones: organizacionesDeDistrito(db, ubigeo), jne });
  }));

  app.post('/api/organizaciones', requiereLogin, h((req, res) => {
    const { seccion, ubigeo, nombre } = req.body || {};
    if (!esDistrito(ubigeo)) fallar(400, 'Distrito inválido');
    if (!seccionesParaUbigeo(ubigeo).includes(seccion)) fallar(400, 'Sección inválida para este distrito');
    const n = String(nombre || '').trim();
    if (n.length < 2 || n.length > 120) fallar(400, 'Nombre de organización inválido');
    const secciones = organizacionesDeDistrito(db, ubigeo);
    const id = agregarManual(db, { seccion, ubigeo: secciones[seccion].ambito, nombre: n, usuarioId: req.usuario.id });
    res.status(201).json({ id, secciones: organizacionesDeDistrito(db, ubigeo) });
  }));

  app.delete('/api/circunscripcion/:id', requiereLogin, h((req, res) => {
    const c = db.prepare('SELECT * FROM circunscripcion_org WHERE id = ?').get(req.params.id);
    if (!c) fallar(404, 'No encontrado');
    const propio = c.fuente === 'manual' && c.creado_por === req.usuario.id;
    if (!propio && req.usuario.rol !== 'admin') fallar(403, 'Solo un administrador puede quitar esta organización');
    db.prepare('DELETE FROM circunscripcion_org WHERE id = ?').run(c.id);
    res.json({ ok: true });
  }));

  app.patch('/api/circunscripcion/:id', requiereAdmin, h((req, res) => {
    const orden = Number(req.body?.orden);
    if (!Number.isInteger(orden)) fallar(400, 'Orden inválido');
    db.prepare('UPDATE circunscripcion_org SET orden = ? WHERE id = ?').run(orden, req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/admin/jne/:ubigeo', requiereAdmin, h(async (req, res) => {
    if (!esDistrito(req.params.ubigeo)) fallar(400, 'Distrito inválido');
    try {
      const resumen = await sincronizarDistritoJNE(db, req.params.ubigeo);
      res.json({ ok: true, resumen, secciones: organizacionesDeDistrito(db, req.params.ubigeo) });
    } catch (e) {
      fallar(502, `No se pudo consultar al JNE: ${e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message}`);
    }
  }));

  // ---- Mesas y actas -----------------------------------------------------
  const mesaConNombres = (m) => ({ ...m, ...describir(m.ubigeo) });

  function cargarActa(id, usuario) {
    const a = db.prepare('SELECT * FROM actas WHERE id = ?').get(id);
    if (!a) fallar(404, 'Acta no encontrada');
    if (a.usuario_id !== usuario.id && usuario.rol !== 'admin') fallar(403, 'Esta acta pertenece a otro personero');
    return a;
  }

  function actaCompleta(a) {
    const mesa = mesaConNombres(db.prepare('SELECT * FROM mesas WHERE id = ?').get(a.mesa_id));
    const secciones = seccionesParaUbigeo(mesa.ubigeo);
    return {
      id: a.id,
      estado: a.estado,
      modo: a.modo,
      total_votantes: a.total_votantes,
      registros: JSON.parse(a.registros),
      cuadra: !!a.cuadra,
      observacion: a.observacion,
      version: a.version,
      actualizado_en: a.actualizado_en,
      cerrado_en: a.cerrado_en,
      usuario_id: a.usuario_id,
      mesa,
      secciones,
    };
  }

  app.get('/api/mesas/:numero', requiereLogin, (req, res) => {
    const m = db.prepare('SELECT * FROM mesas WHERE numero = ?').get(String(req.params.numero));
    res.json({ mesa: m ? mesaConNombres(m) : null });
  });

  app.get('/api/actas', requiereLogin, (req, res) => {
    const filas = db
      .prepare(
        `SELECT a.*, m.numero, m.ubigeo, m.local_votacion, m.electores_habiles FROM actas a JOIN mesas m ON m.id = a.mesa_id
         WHERE a.usuario_id = ? ORDER BY a.actualizado_en DESC`,
      )
      .all(req.usuario.id);
    res.json({
      actas: filas.map((f) => ({
        id: f.id,
        estado: f.estado,
        cuadra: !!f.cuadra,
        total_votantes: f.total_votantes,
        cedulas: JSON.parse(f.registros).length,
        actualizado_en: f.actualizado_en,
        mesa: { numero: f.numero, local_votacion: f.local_votacion, electores_habiles: f.electores_habiles, ...describir(f.ubigeo) },
      })),
    });
  });

  app.post('/api/actas', requiereLogin, h((req, res) => {
    const b = req.body || {};
    const numero = String(b.numero || '').trim();
    if (!/^\d{6}$/.test(numero)) fallar(400, 'El número de mesa tiene 6 dígitos');
    let mesa = db.prepare('SELECT * FROM mesas WHERE numero = ?').get(numero);
    if (mesa) {
      if (b.ubigeo && b.ubigeo !== mesa.ubigeo) {
        const d = describir(mesa.ubigeo);
        fallar(409, `La mesa ${numero} ya está registrada en ${d.distrito} (${d.provincia}). Verifica el número.`);
      }
    } else {
      if (!esDistrito(b.ubigeo)) fallar(400, 'Selecciona el distrito de la mesa');
      const eh = Number(b.electores_habiles || 300);
      if (!Number.isInteger(eh) || eh < 1 || eh > 1000) fallar(400, 'Electores hábiles inválido');
      const id = db
        .prepare('INSERT INTO mesas (numero, ubigeo, local_votacion, electores_habiles, creado_por) VALUES (?, ?, ?, ?, ?)')
        .run(numero, b.ubigeo, String(b.local_votacion || '').trim() || null, eh, req.usuario.id).lastInsertRowid;
      mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(id);
    }
    db.prepare('INSERT INTO actas (mesa_id, usuario_id) VALUES (?, ?) ON CONFLICT (mesa_id, usuario_id) DO NOTHING').run(mesa.id, req.usuario.id);
    const a = db.prepare('SELECT * FROM actas WHERE mesa_id = ? AND usuario_id = ?').get(mesa.id, req.usuario.id);
    res.status(201).json({ acta: actaCompleta(a) });
  }));

  app.get('/api/actas/:id', requiereLogin, h(async (req, res) => {
    const acta = actaCompleta(cargarActa(req.params.id, req.usuario));
    const jne = await asegurarOrganizaciones(db, acta.mesa.ubigeo);
    res.json({ acta, organizaciones: organizacionesDeDistrito(db, acta.mesa.ubigeo), jne });
  }));

  function validarRegistros(registros, secciones) {
    if (!Array.isArray(registros)) fallar(400, 'Registros inválidos');
    if (registros.length > 3000) fallar(400, 'Demasiados registros');
    const existeOrg = db.prepare('SELECT 1 FROM organizaciones WHERE id = ?');
    const vistos = new Set();
    return registros.map((r) => {
      if (!r || typeof r !== 'object' || typeof r.v !== 'object' || !r.v) fallar(400, 'Registro inválido');
      const v = {};
      for (const [s, op] of Object.entries(r.v)) {
        if (!secciones.includes(s)) fallar(400, `Sección ${s} no corresponde a esta mesa`);
        const o = String(op);
        if (!ESPECIALES[o]) {
          if (!vistos.has(o) && !(/^\d+$/.test(o) && existeOrg.get(Number(o)))) fallar(400, `Organización ${o} desconocida`);
          vistos.add(o);
        }
        v[s] = o;
      }
      if (!Object.keys(v).length) fallar(400, 'Registro vacío');
      return { id: String(r.id || '').slice(0, 40), ts: Number(r.ts) || Date.now(), v };
    });
  }

  app.put('/api/actas/:id', requiereLogin, h((req, res) => {
    const a = cargarActa(req.params.id, req.usuario);
    if (a.estado === 'cerrada') fallar(409, 'El acta está cerrada. Reábrela para modificarla.');
    const actual = actaCompleta(a);
    const b = req.body || {};
    const registros = b.registros !== undefined ? validarRegistros(b.registros, actual.secciones) : actual.registros;
    let tv = b.total_votantes !== undefined ? b.total_votantes : a.total_votantes;
    if (tv === '' || tv === null) tv = null;
    else {
      tv = Number(tv);
      if (!Number.isInteger(tv) || tv < 0 || tv > 1000) fallar(400, 'Total de votantes inválido');
    }
    const modo = b.modo === 'seccion' ? 'seccion' : b.modo === 'cedula' ? 'cedula' : a.modo;
    const cuadre = evaluarCuadre({ registros, secciones: actual.secciones, totalVotantes: tv, electoresHabiles: actual.mesa.electores_habiles });
    db.prepare(
      `UPDATE actas SET registros = ?, conteo = ?, total_votantes = ?, modo = ?, cuadra = ?, version = version + 1, actualizado_en = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify(registros), JSON.stringify(cuadre.conteo), tv, modo, cuadre.ok ? 1 : 0, a.id);
    res.json({ acta: actaCompleta(db.prepare('SELECT * FROM actas WHERE id = ?').get(a.id)) });
  }));

  app.post('/api/actas/:id/cerrar', requiereLogin, h((req, res) => {
    const a = cargarActa(req.params.id, req.usuario);
    const acta = actaCompleta(a);
    const cuadre = evaluarCuadre({
      registros: acta.registros,
      secciones: acta.secciones,
      totalVotantes: acta.total_votantes,
      electoresHabiles: acta.mesa.electores_habiles,
    });
    const observacion = String(req.body?.observacion || '').trim();
    if (!cuadre.ok) {
      if (!req.body?.forzar) fallar(422, 'El acta no cuadra. Revisa los totales antes de cerrar.');
      if (observacion.length < 5) fallar(400, 'Explica en una observación por qué cierras un acta que no cuadra');
    }
    if (!acta.registros.length) fallar(400, 'El acta no tiene votos registrados');
    db.prepare(
      `UPDATE actas SET estado = 'cerrada', observacion = ?, cuadra = ?, conteo = ?, cerrado_en = datetime('now'), actualizado_en = datetime('now'), version = version + 1 WHERE id = ?`,
    ).run(observacion || null, cuadre.ok ? 1 : 0, JSON.stringify(cuadre.conteo), a.id);
    res.json({ acta: actaCompleta(db.prepare('SELECT * FROM actas WHERE id = ?').get(a.id)) });
  }));

  app.post('/api/actas/:id/reabrir', requiereLogin, h((req, res) => {
    const a = cargarActa(req.params.id, req.usuario);
    db.prepare(`UPDATE actas SET estado = 'borrador', cerrado_en = NULL, actualizado_en = datetime('now'), version = version + 1 WHERE id = ?`).run(a.id);
    res.json({ acta: actaCompleta(db.prepare('SELECT * FROM actas WHERE id = ?').get(a.id)) });
  }));

  app.delete('/api/actas/:id', requiereLogin, h((req, res) => {
    const a = cargarActa(req.params.id, req.usuario);
    if (a.estado === 'cerrada') fallar(409, 'No se puede eliminar un acta cerrada');
    db.prepare('DELETE FROM actas WHERE id = ?').run(a.id);
    // Si nadie más cuenta esa mesa, también se borra para liberar el número.
    db.prepare('DELETE FROM mesas WHERE id = ? AND NOT EXISTS (SELECT 1 FROM actas WHERE mesa_id = ?)').run(a.mesa_id, a.mesa_id);
    res.json({ ok: true });
  }));

  // ---- Dashboard ---------------------------------------------------------
  app.get('/api/dashboard', requiereLogin, h((req, res) => {
    const ubigeo = String(req.query.ubigeo || '');
    if (!describir(ubigeo)) fallar(400, 'Ámbito inválido');
    const seccion = req.query.seccion ? String(req.query.seccion) : null;
    if (seccion && !SECCIONES[seccion]) fallar(400, 'Sección inválida');
    res.json(calcularDashboard(db, { ubigeo, seccion, incluirBorradores: req.query.borradores === '1' }));
  }));

  // ---- Administración ----------------------------------------------------
  app.get('/api/admin/usuarios', requiereAdmin, (_req, res) => {
    const usuarios = db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM actas a WHERE a.usuario_id = u.id) AS actas,
                (SELECT COUNT(*) FROM actas a WHERE a.usuario_id = u.id AND a.estado = 'cerrada') AS cerradas
         FROM usuarios u ORDER BY u.creado_en DESC`,
      )
      .all();
    res.json({ usuarios: usuarios.map((u) => ({ ...usuarioPublico(u), actas: u.actas, cerradas: u.cerradas, creado_en: u.creado_en })) });
  });

  app.patch('/api/admin/usuarios/:id', requiereAdmin, h((req, res) => {
    const rol = req.body?.rol;
    if (!['admin', 'personero'].includes(rol)) fallar(400, 'Rol inválido');
    if (Number(req.params.id) === req.usuario.id && rol !== 'admin') fallar(400, 'No puedes quitarte el rol de administrador');
    db.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').run(rol, req.params.id);
    res.json({ ok: true });
  }));

  app.get('/api/admin/actas', requiereAdmin, (req, res) => {
    const ubigeo = String(req.query.ubigeo || '');
    const filas = db
      .prepare(
        `SELECT a.id, a.estado, a.cuadra, a.total_votantes, a.registros, a.observacion, a.actualizado_en,
                m.numero, m.ubigeo, m.electores_habiles, u.nombre AS personero, u.organizacion
         FROM actas a JOIN mesas m ON m.id = a.mesa_id JOIN usuarios u ON u.id = a.usuario_id
         WHERE m.ubigeo LIKE ? ORDER BY m.numero, a.actualizado_en DESC LIMIT 2000`,
      )
      .all(`${ubigeo}%`);
    res.json({
      actas: filas.map(({ registros, ...f }) => ({ ...f, cuadra: !!f.cuadra, cedulas: JSON.parse(registros).length, ...describir(f.ubigeo) })),
    });
  });

  // ---- Estáticos -----------------------------------------------------------
  app.use('/shared', express.static(SHARED, { maxAge: 0 }));
  app.use(express.static(PUBLIC, { maxAge: 0, index: 'index.html' }));
  app.use('/api', (_req, _res, next) => next(new ErrorHttp(404, 'Ruta no encontrada')));
  app.get('*', (_req, res) => res.sendFile('index.html', { root: PUBLIC }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
  });

  return app;
}
