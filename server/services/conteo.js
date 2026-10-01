// Servicio de conteo: ubigeo, organizaciones por circunscripción, mesas y actas.
import { Router } from 'express';
import { ahora } from '../lib/db.js';
import { ARBOL_JSON, describir, esDistrito } from '../lib/ubigeo.js';
import { agregarManual, asegurarOrganizaciones, organizacionesDeDistrito, sincronizarDistritoJNE } from '../lib/organizaciones.js';
import { firmaConteo, recalcularMesa } from '../lib/consolidado.js';
import { estadoJornada, limpiarDatosDePrueba } from '../lib/jornada.js';
import { fallar, h, requiereAdmin, requiereLogin } from '../lib/http.js';
import { ESPECIALES, SECCIONES, contar, errorObservacion, evaluarCuadre, motivoNoCierre, seccionesParaUbigeo } from '../../shared/acta.js';
import { errorElectores, errorNumeroMesa, errorTextoLibre, mayusculas } from '../../shared/validacion.js';

const MAX_REGISTROS = 1000; // una mesa tiene como máximo 300 electores; margen para registros por sección

export function rutasConteo({ db }) {
  const r = Router();

  // ---- Jornada: cuenta regresiva y datos de prueba -------------------------
  r.get('/api/estado', h(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await estadoJornada(db));
  }));

  r.post('/api/admin/limpiar-prueba', requiereAdmin, h(async (req, res) => {
    if (req.body?.confirmar !== 'BORRAR') fallar(400, 'Escribe BORRAR para confirmar');
    res.json({ ok: true, limpieza: await limpiarDatosDePrueba(db, { motivo: `manual por ${req.usuario.nombre}` }) });
  }));

  // ---- Ubigeo y organizaciones ------------------------------------------
  r.get('/api/ubigeo', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400').type('json').send(ARBOL_JSON);
  });

  r.get('/api/organizaciones', requiereLogin, h(async (req, res) => {
    const ubigeo = String(req.query.ubigeo || '');
    if (!esDistrito(ubigeo)) fallar(400, 'Selecciona un distrito válido');
    const jne = await asegurarOrganizaciones(db, ubigeo);
    res.json({ ubigeo: describir(ubigeo), secciones: await organizacionesDeDistrito(db, ubigeo), jne });
  }));

  r.post('/api/organizaciones', requiereLogin, h(async (req, res) => {
    const { seccion, ubigeo } = req.body || {};
    if (!esDistrito(ubigeo)) fallar(400, 'Distrito inválido');
    if (!seccionesParaUbigeo(ubigeo).includes(seccion)) fallar(400, 'Sección inválida para este distrito');
    const nombre = mayusculas(req.body?.nombre);
    if (nombre.length < 2) fallar(400, 'Escribe el nombre de la organización');
    const err = errorTextoLibre(nombre, 'El nombre', 120);
    if (err) fallar(400, err);
    const secciones = await organizacionesDeDistrito(db, ubigeo);
    const id = await agregarManual(db, { seccion, ubigeo: secciones[seccion].ambito, nombre, usuarioId: req.usuario.id });
    res.status(201).json({ id, secciones: await organizacionesDeDistrito(db, ubigeo) });
  }));

  r.delete('/api/circunscripcion/:id', requiereLogin, h(async (req, res) => {
    const c = await db.get('SELECT * FROM circunscripcion_org WHERE id = ?', [req.params.id]);
    if (!c) fallar(404, 'No encontrado');
    const propio = c.fuente === 'manual' && c.creado_por === req.usuario.id;
    if (!propio && req.usuario.rol !== 'admin') fallar(403, 'Solo un administrador puede quitar esta organización');
    await db.run('DELETE FROM circunscripcion_org WHERE id = ?', [c.id]);
    res.json({ ok: true });
  }));

  r.patch('/api/circunscripcion/:id', requiereAdmin, h(async (req, res) => {
    const orden = Number(req.body?.orden);
    if (!Number.isInteger(orden) || orden < 0 || orden > 999) fallar(400, 'Orden inválido');
    await db.run('UPDATE circunscripcion_org SET orden = ? WHERE id = ?', [orden, req.params.id]);
    res.json({ ok: true });
  }));

  r.post('/api/admin/jne/:ubigeo', requiereAdmin, h(async (req, res) => {
    if (!esDistrito(req.params.ubigeo)) fallar(400, 'Distrito inválido');
    try {
      const resumen = await sincronizarDistritoJNE(db, req.params.ubigeo);
      res.json({ ok: true, resumen, secciones: await organizacionesDeDistrito(db, req.params.ubigeo) });
    } catch (e) {
      fallar(502, `No se pudo consultar al JNE: ${e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message}`);
    }
  }));

  // ---- Mesas y actas -----------------------------------------------------
  const mesaConNombres = (m) => ({ ...m, ...describir(m.ubigeo) });

  async function cargarActa(id, usuario) {
    const a = await db.get('SELECT * FROM actas WHERE id = ?', [id]);
    if (!a) fallar(404, 'Acta no encontrada');
    if (a.usuario_id !== usuario.id && usuario.rol !== 'admin') fallar(403, 'Esta acta pertenece a otro personero');
    return a;
  }

  async function actaCompleta(a, conexion = db) {
    const mesa = mesaConNombres(await conexion.get('SELECT * FROM mesas WHERE id = ?', [a.mesa_id]));
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
      secciones: seccionesParaUbigeo(mesa.ubigeo),
    };
  }
  const releer = async (id) => actaCompleta(await db.get('SELECT * FROM actas WHERE id = ?', [id]));

  r.get('/api/mesas/:numero', requiereLogin, h(async (req, res) => {
    const m = await db.get('SELECT * FROM mesas WHERE numero = ?', [String(req.params.numero)]);
    res.json({ mesa: m ? mesaConNombres(m) : null });
  }));

  r.get('/api/actas', requiereLogin, h(async (req, res) => {
    const filas = await db.all(
      `SELECT a.id, a.estado, a.cuadra, a.total_votantes, a.n_registros, a.actualizado_en,
              m.numero, m.ubigeo, m.local_votacion, m.electores_habiles
       FROM actas a JOIN mesas m ON m.id = a.mesa_id WHERE a.usuario_id = ? ORDER BY a.actualizado_en DESC`,
      [req.usuario.id],
    );
    res.json({
      actas: filas.map((f) => ({
        id: f.id,
        estado: f.estado,
        cuadra: !!f.cuadra,
        total_votantes: f.total_votantes,
        cedulas: f.n_registros,
        actualizado_en: f.actualizado_en,
        mesa: { numero: f.numero, local_votacion: f.local_votacion, electores_habiles: f.electores_habiles, ...describir(f.ubigeo) },
      })),
    });
  }));

  r.post('/api/actas', requiereLogin, h(async (req, res) => {
    const b = req.body || {};
    const numero = String(b.numero || '').trim();
    const errNum = errorNumeroMesa(numero);
    if (errNum) fallar(400, errNum, { campo: 'numero' });
    let mesa = await db.get('SELECT * FROM mesas WHERE numero = ?', [numero]);
    if (mesa) {
      if (b.ubigeo && b.ubigeo !== mesa.ubigeo) {
        const d = describir(mesa.ubigeo);
        fallar(409, `La mesa ${numero} ya está registrada en ${d.distrito} (${d.provincia}). Verifica el número.`, { campo: 'numero' });
      }
    } else {
      if (!esDistrito(b.ubigeo)) fallar(400, 'Selecciona el distrito de la mesa', { campo: 'ubigeo' });
      const eh = Number(b.electores_habiles);
      const errEh = errorElectores(eh);
      if (errEh) fallar(400, errEh, { campo: 'electores_habiles' });
      const local = mayusculas(b.local_votacion) || null;
      const errLocal = errorTextoLibre(local, 'El local de votación', 120);
      if (errLocal) fallar(400, errLocal, { campo: 'local_votacion' });
      // ON CONFLICT: dos personeros pueden registrar la misma mesa al mismo tiempo.
      await db.run(
        `INSERT INTO mesas (numero, ubigeo, local_votacion, electores_habiles, creado_por, creado_en) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (numero) DO NOTHING`,
        [numero, b.ubigeo, local, eh, req.usuario.id, ahora()],
      );
      mesa = await db.get('SELECT * FROM mesas WHERE numero = ?', [numero]);
      if (mesa.ubigeo !== b.ubigeo) fallar(409, `La mesa ${numero} acaba de ser registrada en otro distrito. Verifica el número.`);
    }
    await db.run(
      'INSERT INTO actas (mesa_id, usuario_id, actualizado_en) VALUES (?, ?, ?) ON CONFLICT (mesa_id, usuario_id) DO NOTHING',
      [mesa.id, req.usuario.id, ahora()],
    );
    const a = await db.get('SELECT * FROM actas WHERE mesa_id = ? AND usuario_id = ?', [mesa.id, req.usuario.id]);
    res.status(201).json({ acta: await actaCompleta(a) });
  }));

  r.get('/api/actas/:id', requiereLogin, h(async (req, res) => {
    const acta = await actaCompleta(await cargarActa(req.params.id, req.usuario));
    const jne = await asegurarOrganizaciones(db, acta.mesa.ubigeo);
    res.json({ acta, organizaciones: await organizacionesDeDistrito(db, acta.mesa.ubigeo), jne });
  }));

  async function validarRegistros(registros, secciones, electoresHabiles) {
    if (!Array.isArray(registros)) fallar(400, 'Registros inválidos');
    if (registros.length > MAX_REGISTROS) fallar(400, 'Demasiados registros para una mesa');
    const orgs = new Set();
    const limpios = registros.map((r) => {
      if (!r || typeof r !== 'object' || typeof r.v !== 'object' || !r.v) fallar(400, 'Registro inválido');
      const v = {};
      for (const [s, op] of Object.entries(r.v)) {
        if (!secciones.includes(s)) fallar(400, `Sección ${s} no corresponde a esta mesa`);
        const o = String(op);
        if (!ESPECIALES[o]) {
          if (!/^\d{1,9}$/.test(o)) fallar(400, `Organización ${o} desconocida`);
          orgs.add(Number(o));
        }
        v[s] = o;
      }
      if (!Object.keys(v).length) fallar(400, 'Registro vacío');
      return { id: String(r.id || '').slice(0, 40), ts: Number(r.ts) || Date.now(), v };
    });
    // Ninguna elección puede tener más votos que electores hábiles tiene la mesa.
    const conteo = contar(limpios, secciones);
    for (const s of secciones) {
      if (conteo[s].total > electoresHabiles) {
        fallar(400, `${SECCIONES[s].corto} tiene ${conteo[s].total} votos y la mesa solo tiene ${electoresHabiles} electores hábiles`);
      }
    }
    if (orgs.size) {
      const ids = [...orgs];
      const { n } = await db.get(`SELECT COUNT(*) AS n FROM organizaciones WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      if (n !== ids.length) fallar(400, 'El acta tiene una organización desconocida');
    }
    return limpios;
  }

  r.put('/api/actas/:id', requiereLogin, h(async (req, res) => {
    const a = await cargarActa(req.params.id, req.usuario);
    if (a.estado === 'cerrada') fallar(409, 'El acta está cerrada. Reábrela para modificarla.');
    const actual = await actaCompleta(a);
    const b = req.body || {};
    const registros = b.registros !== undefined ? await validarRegistros(b.registros, actual.secciones, actual.mesa.electores_habiles) : actual.registros;
    let tv = b.total_votantes !== undefined ? b.total_votantes : a.total_votantes;
    if (tv === '' || tv === null) tv = null;
    else {
      tv = Number(tv);
      if (!Number.isInteger(tv) || tv < 0 || tv > actual.mesa.electores_habiles) {
        fallar(400, `El total de votantes debe estar entre 0 y ${actual.mesa.electores_habiles}`);
      }
    }
    const modo = b.modo === 'seccion' ? 'seccion' : b.modo === 'cedula' ? 'cedula' : a.modo;
    const cuadre = evaluarCuadre({ registros, secciones: actual.secciones, totalVotantes: tv, electoresHabiles: actual.mesa.electores_habiles });
    await db.tx(async (t) => {
      await t.run(
        `UPDATE actas SET registros = ?, n_registros = ?, conteo = ?, firma = ?, total_votantes = ?, modo = ?, cuadra = ?,
                version = version + 1, actualizado_en = ? WHERE id = ?`,
        [JSON.stringify(registros), registros.length, JSON.stringify(cuadre.conteo), firmaConteo(cuadre.conteo), tv, modo, cuadre.ok ? 1 : 0, ahora(), a.id],
      );
      await recalcularMesa(t, a.mesa_id);
    });
    // Respuesta liviana: el celular ya tiene los registros; solo necesita confirmar el guardado.
    res.json({ acta: { id: a.id, estado: 'borrador', version: a.version + 1, cuadra: cuadre.ok } });
  }));

  r.post('/api/actas/:id/cerrar', requiereLogin, h(async (req, res) => {
    const a = await cargarActa(req.params.id, req.usuario);
    const acta = await actaCompleta(a);
    const cuadre = evaluarCuadre({
      registros: acta.registros,
      secciones: acta.secciones,
      totalVotantes: acta.total_votantes,
      electoresHabiles: acta.mesa.electores_habiles,
    });
    const observacion = mayusculas(req.body?.observacion);
    if (!cuadre.ok) {
      if (!req.body?.forzar) fallar(422, 'El acta no cuadra. Revisa los totales antes de cerrar.');
      const motivo = motivoNoCierre(cuadre);
      if (motivo) fallar(422, motivo);
      const err = errorObservacion(observacion);
      if (err) fallar(400, err);
    }
    if (observacion.length > 500) fallar(400, 'La observación es muy larga');
    if (!acta.registros.length) fallar(400, 'El acta no tiene votos registrados');
    await db.tx(async (t) => {
      await t.run(
        `UPDATE actas SET estado = 'cerrada', observacion = ?, cuadra = ?, conteo = ?, firma = ?, cerrado_en = ?, actualizado_en = ?,
                version = version + 1 WHERE id = ?`,
        [observacion || null, cuadre.ok ? 1 : 0, JSON.stringify(cuadre.conteo), firmaConteo(cuadre.conteo), ahora(), ahora(), a.id],
      );
      await recalcularMesa(t, a.mesa_id);
    });
    res.json({ acta: await releer(a.id) });
  }));

  r.post('/api/actas/:id/reabrir', requiereLogin, h(async (req, res) => {
    const a = await cargarActa(req.params.id, req.usuario);
    await db.tx(async (t) => {
      await t.run(`UPDATE actas SET estado = 'borrador', cerrado_en = NULL, actualizado_en = ?, version = version + 1 WHERE id = ?`, [ahora(), a.id]);
      await recalcularMesa(t, a.mesa_id);
    });
    res.json({ acta: await releer(a.id) });
  }));

  r.delete('/api/actas/:id', requiereLogin, h(async (req, res) => {
    const a = await cargarActa(req.params.id, req.usuario);
    if (a.estado === 'cerrada') fallar(409, 'No se puede eliminar un acta cerrada');
    await db.tx(async (t) => {
      await t.run('DELETE FROM actas WHERE id = ?', [a.id]);
      // Si nadie más cuenta esa mesa, también se borra para liberar el número.
      const quedan = await t.get('SELECT COUNT(*) AS n FROM actas WHERE mesa_id = ?', [a.mesa_id]);
      if (!quedan.n) {
        await t.run('DELETE FROM votos_mesa WHERE mesa_id = ?', [a.mesa_id]);
        await t.run('DELETE FROM mesas WHERE id = ?', [a.mesa_id]);
      } else {
        await recalcularMesa(t, a.mesa_id);
      }
    });
    res.json({ ok: true });
  }));

  r.get('/api/admin/actas', requiereAdmin, h(async (req, res) => {
    const ubigeo = String(req.query.ubigeo || '');
    if (!/^\d{0,6}$/.test(ubigeo)) fallar(400, 'Ámbito inválido');
    const filas = await db.all(
      `SELECT a.id, a.estado, a.cuadra, a.total_votantes, a.n_registros, a.observacion, a.actualizado_en,
              m.numero, m.ubigeo, m.electores_habiles, u.nombre AS personero, u.organizacion
       FROM actas a JOIN mesas m ON m.id = a.mesa_id JOIN usuarios u ON u.id = a.usuario_id
       WHERE m.ubigeo LIKE ? ORDER BY m.numero, a.actualizado_en DESC LIMIT 2000`,
      [`${ubigeo}%`],
    );
    res.json({ actas: filas.map(({ n_registros, ...f }) => ({ ...f, cuadra: !!f.cuadra, cedulas: n_registros, ...describir(f.ubigeo) })) });
  }));

  return r;
}
