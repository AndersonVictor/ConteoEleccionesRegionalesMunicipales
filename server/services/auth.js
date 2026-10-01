// Servicio de usuarios: registro (con consulta de DNI), ingreso, perfil y administración de personeros.
import { Router } from 'express';
import { ahora } from '../lib/db.js';
import { crearToken, hashPassword, verificarPassword } from '../lib/auth.js';
import { limitador } from '../lib/cache.js';
import { consultarDni } from '../lib/decolecta.js';
import { fallar, h, olvidarUsuario, requiereAdmin, requiereLogin, usuarioPublico } from '../lib/http.js';
import {
  errorCelular, errorDni, errorEmail, errorNombre, errorPassword, errorTextoLibre, mayusculas, nombreCompleto,
} from '../../shared/validacion.js';

export function rutasAuth({ db, secreto }) {
  const r = Router();
  // Límites por IP. En redes móviles muchos celulares comparten IP (CGNAT), por eso son holgados
  // y configurables.
  const limiteLogin = limitador({ nombre: 'login', max: Number(process.env.LIMITE_LOGIN || 100), ventanaSeg: 600 });
  const limiteDni = limitador({ nombre: 'dni', max: Number(process.env.LIMITE_DNI || 60), ventanaSeg: 600 });

  // Autocompleta el formulario de registro. No revela nombres de DNI ya registrados.
  r.get('/api/dni/:dni', limiteDni, h(async (req, res) => {
    const dni = String(req.params.dni);
    const err = errorDni(dni);
    if (err) fallar(400, err);
    if (await db.get('SELECT 1 FROM usuarios WHERE dni = ?', [dni])) {
      return res.json({ encontrado: false, registrado: true });
    }
    res.json(await consultarDni(db, dni));
  }));

  r.post('/api/auth/registro', limiteLogin, h(async (req, res) => {
    const b = req.body || {};
    const dni = String(b.dni || '').trim();
    const datos = {
      nombres: mayusculas(b.nombres),
      apellido_paterno: mayusculas(b.apellido_paterno),
      apellido_materno: mayusculas(b.apellido_materno),
      telefono: String(b.telefono || '').replace(/\s/g, ''),
      email: String(b.email || '').trim().toLowerCase() || null,
      organizacion: mayusculas(b.organizacion) || null,
    };
    const errores = {
      dni: errorDni(dni),
      nombres: errorNombre(datos.nombres, 'El nombre'),
      apellido_paterno: errorNombre(datos.apellido_paterno, 'El apellido paterno'),
      apellido_materno: errorNombre(datos.apellido_materno, 'El apellido materno', { opcional: true }),
      telefono: errorCelular(datos.telefono),
      email: errorEmail(datos.email),
      organizacion: errorTextoLibre(datos.organizacion, 'La organización', 100),
      password: errorPassword(b.password),
    };
    if (b.password !== undefined && b.confirmar !== undefined && b.password !== b.confirmar) errores.confirmar = 'Las contraseñas no coinciden';
    const primero = Object.entries(errores).find(([, v]) => v);
    if (primero) fallar(400, primero[1], { campo: primero[0] });

    if (await db.get('SELECT 1 FROM usuarios WHERE dni = ?', [dni])) fallar(409, 'Ya existe una cuenta con ese DNI. Ingresa con tu contraseña.', { campo: 'dni' });
    if (datos.email && (await db.get('SELECT 1 FROM usuarios WHERE email = ?', [datos.email]))) fallar(409, 'Ese correo ya está registrado', { campo: 'email' });

    // Si RENIEC (vía Decolecta) conoce el DNI, manda el nombre oficial.
    const reniec = await consultarDni(db, dni);
    const verificado = reniec.encontrado ? 1 : 0;
    if (reniec.encontrado) {
      datos.nombres = reniec.nombres;
      datos.apellido_paterno = reniec.apellido_paterno;
      datos.apellido_materno = reniec.apellido_materno;
    }

    const hash = await hashPassword(String(b.password));
    const id = await db.tx(async (t) => {
      // El primer usuario registrado administra el sistema.
      const { n } = await t.get('SELECT COUNT(*) AS n FROM usuarios');
      const adminsEnv = String(process.env.ADMIN_DNIS || '').split(',').map((s) => s.trim()).filter(Boolean);
      // Con ADMIN_DNIS definido, solo esos DNIs son administradores. Sin él, el primer usuario lo es
      // (cómodo para probar, pero en un servidor público hay que definir ADMIN_DNIS).
      const rol = (adminsEnv.length ? adminsEnv.includes(dni) : Number(n) === 0) ? 'admin' : 'personero';
      return t.insertar(
        `INSERT INTO usuarios (dni, nombres, apellido_paterno, apellido_materno, nombre, dni_verificado, email, telefono, organizacion, password_hash, rol, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dni, datos.nombres, datos.apellido_paterno, datos.apellido_materno, nombreCompleto(datos), verificado, datos.email,
          datos.telefono, datos.organizacion, hash, rol, ahora()],
      );
    }).catch((e) => {
      // Dos registros simultáneos con el mismo DNI o correo.
      if (e.code === '23505' || /UNIQUE/i.test(e.message)) fallar(409, 'Ya existe una cuenta con ese DNI o correo');
      throw e;
    });
    const u = await db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
    res.status(201).json({ token: crearToken(secreto, id), usuario: usuarioPublico(u) });
  }));

  r.post('/api/auth/login', limiteLogin, h(async (req, res) => {
    const usuario = String(req.body?.usuario || '').trim().toLowerCase();
    const u = await db.get('SELECT * FROM usuarios WHERE dni = ? OR email = ?', [usuario, usuario]);
    if (!u || !(await verificarPassword(String(req.body?.password || ''), u.password_hash))) fallar(401, 'DNI o contraseña incorrectos');
    res.json({ token: crearToken(secreto, u.id), usuario: usuarioPublico(u) });
  }));

  r.get('/api/me', requiereLogin, (req, res) => res.json({ usuario: usuarioPublico(req.usuario) }));

  r.get('/api/admin/usuarios', requiereAdmin, h(async (_req, res) => {
    const filas = await db.all(
      `SELECT u.*, COUNT(a.id) AS actas, SUM(CASE WHEN a.estado = 'cerrada' THEN 1 ELSE 0 END) AS cerradas
       FROM usuarios u LEFT JOIN actas a ON a.usuario_id = u.id
       GROUP BY u.id ORDER BY u.creado_en DESC LIMIT 5000`,
    );
    res.json({ usuarios: filas.map((u) => ({ ...usuarioPublico(u), actas: u.actas, cerradas: u.cerradas || 0, creado_en: u.creado_en })) });
  }));

  r.patch('/api/admin/usuarios/:id', requiereAdmin, h(async (req, res) => {
    const rol = req.body?.rol;
    if (!['admin', 'personero'].includes(rol)) fallar(400, 'Rol inválido');
    if (Number(req.params.id) === req.usuario.id && rol !== 'admin') fallar(400, 'No puedes quitarte el rol de administrador');
    await db.run('UPDATE usuarios SET rol = ? WHERE id = ?', [rol, req.params.id]);
    olvidarUsuario(req.params.id);
    res.json({ ok: true });
  }));

  return r;
}
