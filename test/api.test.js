// Pruebas de la API completa. Corren con SQLite en memoria y, si se define
// TEST_DATABASE_URL (postgres://...), también contra PostgreSQL.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { abrirDB } from '../server/lib/db.js';
import { crearApp } from '../server/app.js';
import { cargarSemilla, sincronizarDistritoJNE, organizacionesDeDistrito } from '../server/lib/organizaciones.js';
import { revisarInicio } from '../server/lib/jornada.js';

process.env.JNE_AUTO = '0';
process.env.DASHBOARD_CACHE_SEG = '0';
process.env.RATE_LIMIT = '0';

// Imitación de la API de Decolecta para probar el autocompletado por DNI.
const DNIS = { 45678912: { first_name: 'ANA MARIA', first_last_name: 'QUISPE', second_last_name: 'MAMANI' } };
let decolecta;
before(async () => {
  decolecta = createServer((req, res) => {
    const numero = new URL(req.url, 'http://x').searchParams.get('numero');
    if (req.headers.authorization !== 'Bearer token-prueba') return res.writeHead(401).end('{}');
    const d = DNIS[numero];
    if (!d) return res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"message":"not found"}');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...d, document_number: numero }));
  }).listen(0);
  await new Promise((r) => decolecta.once('listening', r));
  process.env.DECOLECTA_URL = `http://127.0.0.1:${decolecta.address().port}/v1/reniec/dni`;
  process.env.DECOLECTA_TOKEN = 'token-prueba';
});
after(() => decolecta.close());

const motores = [['sqlite', { ruta: ':memory:', url: '' }]];
if (process.env.TEST_DATABASE_URL) motores.push(['postgres', { url: process.env.TEST_DATABASE_URL }]);

for (const [motor, opciones] of motores) {
  describe(`API con ${motor}`, () => {
    let server;
    let base;
    let db;

    before(async () => {
      if (motor === 'postgres') {
        const { default: pg } = await import('pg');
        const c = new pg.Client({ connectionString: opciones.url });
        await c.connect();
        await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await c.end();
      }
      db = await abrirDB(opciones);
      await cargarSemilla(db, JSON.parse(readFileSync(new URL('../data/seed/arequipa.json', import.meta.url), 'utf8')));
      server = crearApp({ db, secreto: 'test' }).listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${server.address().port}/api`;
    });
    after(async () => {
      server.close();
      await db.cerrar();
    });

    async function llamar(ruta, { method = 'GET', body, token } = {}) {
      const r = await fetch(base + ruta, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, ...(await r.json()) };
    }

    const datosRegistro = (n, extra = {}) => ({
      dni: String(10000000 + n),
      nombres: `personero ${'abcdefghij'[n]}`,
      apellido_paterno: 'perez',
      apellido_materno: 'rojas',
      telefono: '987654321',
      password: 'secreto123',
      confirmar: 'secreto123',
      ...extra,
    });

    async function registrar(n, extra) {
      const r = await llamar('/auth/registro', { method: 'POST', body: datosRegistro(n, extra) });
      assert.equal(r.status, 201, r.error);
      return r;
    }

    test('salud', async () => {
      const r = await llamar('/salud');
      assert.equal(r.ok, true);
      assert.equal(r.motor, motor);
    });

    test('validaciones del registro', async () => {
      const casos = [
        [{ dni: '123' }, 'dni'],
        [{ nombres: 'Juan3' }, 'nombres'],
        [{ apellido_paterno: '' }, 'apellido_paterno'],
        [{ telefono: '12345' }, 'telefono'],
        [{ email: 'no-es-correo' }, 'email'],
        [{ password: 'corta1', confirmar: 'corta1' }, 'password'],
        [{ password: 'sololetras', confirmar: 'sololetras' }, 'password'],
        [{ confirmar: 'otra12345' }, 'confirmar'],
      ];
      for (const [extra, campo] of casos) {
        const r = await llamar('/auth/registro', { method: 'POST', body: datosRegistro(9, extra) });
        assert.equal(r.status, 400, `${campo}: ${r.error}`);
        assert.equal(r.campo, campo);
      }
    });

    test('consulta de DNI con Decolecta y nombre oficial en mayúsculas', async () => {
      const encontrado = await llamar('/dni/45678912');
      assert.deepEqual(
        { ...encontrado, status: undefined },
        { encontrado: true, nombres: 'ANA MARIA', apellido_paterno: 'QUISPE', apellido_materno: 'MAMANI', status: undefined },
      );
      assert.equal((await llamar('/dni/11111111')).encontrado, false);
      assert.equal((await llamar('/dni/123')).status, 400);

      // Aunque el formulario mande otro nombre, se guarda el de RENIEC.
      const r = await llamar('/auth/registro', {
        method: 'POST',
        body: datosRegistro(0, { dni: '45678912', nombres: 'otro', apellido_paterno: 'nombre', email: 'ana@test.pe' }),
      });
      assert.equal(r.status, 201, r.error);
      assert.equal(r.usuario.nombre, 'ANA MARIA QUISPE MAMANI');
      assert.equal(r.usuario.dni_verificado, true);
      assert.equal(r.usuario.rol, 'admin'); // primer usuario

      // Un DNI ya registrado no devuelve nombres.
      assert.deepEqual((await llamar('/dni/45678912')).registrado, true);
      assert.equal((await llamar('/auth/registro', { method: 'POST', body: datosRegistro(0, { dni: '45678912' }) })).status, 409);
    });

    test('DNI no encontrado: se registra con el nombre escrito, en mayúsculas', async () => {
      const r = await registrar(1, { nombres: '  josé   luis ', apellido_paterno: 'ñique' });
      assert.equal(r.usuario.nombre, 'JOSÉ LUIS ÑIQUE ROJAS');
      assert.equal(r.usuario.dni_verificado, false);
      assert.equal(r.usuario.rol, 'personero');
      assert.equal(r.usuario.email, null);
    });

    test('flujo completo: mesa, conteo, cierre y dashboard', async () => {
      const admin = await llamar('/auth/login', { method: 'POST', body: { usuario: '45678912', password: 'secreto123' } });
      assert.equal(admin.status, 200);
      const p2 = await llamar('/auth/login', { method: 'POST', body: { usuario: '10000001', password: 'secreto123' } });
      assert.equal(p2.status, 200);
      assert.equal((await llamar('/auth/login', { method: 'POST', body: { usuario: '10000001', password: 'mal' } })).status, 401);
      assert.equal((await llamar('/actas')).status, 401);

      // Validaciones de la mesa
      assert.equal((await llamar('/actas', { method: 'POST', token: admin.token, body: { numero: '12', ubigeo: '040112', electores_habiles: 300 } })).campo, 'numero');
      assert.equal((await llamar('/actas', { method: 'POST', token: admin.token, body: { numero: '123456', ubigeo: '040112', electores_habiles: 301 } })).campo, 'electores_habiles');

      // Paucarpata, Arequipa (INEI 040112)
      const { acta } = await llamar('/actas', {
        method: 'POST', token: admin.token, body: { numero: '123456', ubigeo: '040112', electores_habiles: 300, local_votacion: 'ie san martín' },
      });
      assert.deepEqual(acta.secciones, ['regional', 'consejero', 'provincial', 'distrital']);
      assert.equal(acta.mesa.local_votacion, 'IE SAN MARTÍN');

      const orgs = await llamar(`/actas/${acta.id}`, { token: admin.token });
      const ids = Object.fromEntries(Object.entries(orgs.organizaciones).map(([s, v]) => [s, v.organizaciones.map((o) => String(o.id))]));
      for (const s of acta.secciones) assert.ok(ids[s].length > 5, `hay organizaciones para ${s}`);

      const [a, b] = [ids.regional[0], ids.regional[1]];
      const ced = (x) => ({ regional: x, consejero: ids.consejero[0], provincial: ids.provincial[0], distrital: ids.distrital[0] });
      const registros = [
        { id: '1', v: ced(a) }, { id: '2', v: ced(a) }, { id: '3', v: ced(b) },
        { id: '4', v: { regional: 'B', consejero: 'N', provincial: 'B', distrital: 'I' } },
      ];

      assert.equal((await llamar(`/actas/${acta.id}`, { method: 'PUT', token: p2.token, body: { registros } })).status, 403);
      assert.equal((await llamar(`/actas/${acta.id}`, { method: 'PUT', token: admin.token, body: { registros: [{ v: { regional: '999999' } }] } })).status, 400);
      assert.equal((await llamar(`/actas/${acta.id}`, { method: 'PUT', token: admin.token, body: { total_votantes: 301 } })).status, 400);

      let r = await llamar(`/actas/${acta.id}`, { method: 'PUT', token: admin.token, body: { registros, total_votantes: 5 } });
      assert.equal(r.status, 200);
      assert.equal(r.acta.cuadra, false);
      assert.equal((await llamar(`/actas/${acta.id}/cerrar`, { method: 'POST', token: admin.token })).status, 422);

      // En conteo: aparece solo si se piden resultados parciales.
      let d = await llamar('/dashboard?ubigeo=04', { token: p2.token });
      assert.equal(d.mesas_stats.en_conteo, 1);
      assert.equal(d.resultados.validos, 0);
      d = await llamar('/dashboard?ubigeo=04&borradores=1', { token: p2.token });
      assert.equal(d.resultados.validos, 3);

      r = await llamar(`/actas/${acta.id}`, { method: 'PUT', token: admin.token, body: { total_votantes: 4 } });
      assert.equal(r.acta.cuadra, true);
      r = await llamar(`/actas/${acta.id}/cerrar`, { method: 'POST', token: admin.token });
      assert.equal(r.acta.estado, 'cerrada');

      // Segundo personero en la misma mesa con un conteo distinto -> diferencias.
      const acta2 = (await llamar('/actas', { method: 'POST', token: p2.token, body: { numero: '123456' } })).acta;
      assert.notEqual(acta2.id, acta.id);
      await llamar(`/actas/${acta2.id}`, { method: 'PUT', token: p2.token, body: { registros: registros.slice(0, 3).concat([{ v: ced(b) }]), total_votantes: 4 } });
      await llamar(`/actas/${acta2.id}/cerrar`, { method: 'POST', token: p2.token });

      assert.equal((await llamar('/actas', { method: 'POST', token: p2.token, body: { numero: '123456', ubigeo: '040101' } })).status, 409);

      const dRegion = await llamar('/dashboard?ubigeo=04', { token: p2.token });
      assert.equal(dRegion.resultados.seccion, 'regional');
      assert.equal(dRegion.mesas_stats.registradas, 1);
      assert.equal(dRegion.mesas_stats.contabilizadas, 1);
      assert.deepEqual(dRegion.mesas_stats.con_diferencias, ['123456']);
      assert.equal(dRegion.desglose[0].ubigeo, '0401');
      // Cuenta el acta cerrada más reciente (la del segundo personero: 4 votos válidos).
      assert.equal(dRegion.resultados.organizaciones.reduce((s, o) => s + o.votos, 0), 4);

      const dNac = await llamar('/dashboard?ubigeo=', { token: p2.token });
      assert.equal(dNac.desglose[0].ubigeo, '04');
      assert.ok(dNac.desglose[0].lider);

      const dDist = await llamar('/dashboard?ubigeo=040112&seccion=distrital', { token: p2.token });
      assert.equal(dDist.resultados.seccion, 'distrital');
      assert.equal(dDist.mesas.length, 1);
      assert.equal(dDist.mesas[0].diferencias, true);
      assert.equal(dDist.mesas[0].estado, 'cerrada');

      // Reabrir quita el acta del consolidado oficial (queda la del otro personero).
      await llamar(`/actas/${acta2.id}/reabrir`, { method: 'POST', token: p2.token });
      const dTras = await llamar('/dashboard?ubigeo=04', { token: p2.token });
      assert.deepEqual(dTras.mesas_stats.con_diferencias, []);
      assert.equal(dTras.resultados.organizaciones.reduce((s, o) => s + o.votos, 0), 3);

      const lista = await llamar('/actas', { token: admin.token });
      assert.equal(lista.actas[0].cedulas, 4);
    });

    test('guardados simultáneos de varios personeros en la misma mesa', async () => {
      const us = [await registrar(5), await registrar(6), await registrar(7)];
      const actas = [];
      for (const u of us) actas.push((await llamar('/actas', { method: 'POST', token: u.token, body: { numero: '777777', ubigeo: '040103', electores_habiles: 300 } })).acta);
      const orgs = (await llamar(`/actas/${actas[0].id}`, { token: us[0].token })).organizaciones;
      const ced = { regional: String(orgs.regional.organizaciones[0].id), consejero: 'B', provincial: 'N', distrital: String(orgs.distrital.organizaciones[0].id) };
      // Cada personero guarda en orden (como la app), pero los tres a la vez.
      const r = (await Promise.all(us.map(async (u, k) => {
        const out = [];
        for (let i = 1; i <= 10; i++) {
          out.push(await llamar(`/actas/${actas[k].id}`, { method: 'PUT', token: u.token, body: { registros: Array.from({ length: i + k }, () => ({ v: ced })) } }));
        }
        return out;
      }))).flat();
      assert.deepEqual(r.filter((x) => x.status !== 200).map((x) => x.error), []);
      const d = await llamar('/dashboard?ubigeo=040103&borradores=1', { token: us[0].token });
      // El parcial toma el borrador más avanzado: 10 + 2 cédulas.
      assert.equal(d.resultados.emitidos, 12);
    });

    test('mesas no repetidas y cierre con observación solo con diferencia pequeña', async () => {
      const u = await registrar(8);
      const primero = (await llamar('/actas', { method: 'POST', token: u.token, body: { numero: '696969', ubigeo: '120401', electores_habiles: 300 } })).acta;
      // El mismo personero no puede duplicar la mesa: recibe la misma acta.
      const otraVez = (await llamar('/actas', { method: 'POST', token: u.token, body: { numero: '696969', ubigeo: '120401', electores_habiles: 300 } })).acta;
      assert.equal(otraVez.id, primero.id);
      // Nadie puede registrar ese número en otro lugar.
      const r409 = await llamar('/actas', { method: 'POST', token: u.token, body: { numero: '696969', ubigeo: '040112', electores_habiles: 300 } });
      assert.equal(r409.status, 409);

      const ced = { v: { regional: 'B', consejero: 'B', provincial: 'B' } };
      await llamar(`/actas/${primero.id}`, { method: 'PUT', token: u.token, body: { registros: [ced], total_votantes: 280 } });
      const obs = 'SE EXTRAVIÓ UNA CÉDULA DURANTE EL CONTEO';
      let r = await llamar(`/actas/${primero.id}/cerrar`, { method: 'POST', token: u.token, body: { forzar: true, observacion: obs } });
      assert.equal(r.status, 422, 'con 279 votos de diferencia no se puede cerrar');
      assert.match(r.error, /sigue contando/);

      // No se puede registrar más votos que electores hábiles.
      const tope = await llamar(`/actas/${primero.id}`, { method: 'PUT', token: u.token, body: { registros: Array(301).fill(ced) } });
      assert.equal(tope.status, 400);
      assert.match(tope.error, /300 electores hábiles/);

      await llamar(`/actas/${primero.id}`, { method: 'PUT', token: u.token, body: { registros: Array(278).fill(ced), total_votantes: 280 } });
      r = await llamar(`/actas/${primero.id}/cerrar`, { method: 'POST', token: u.token, body: { forzar: true, observacion: 'wwwww' } });
      assert.equal(r.status, 400, 'observación sin sentido');
      r = await llamar(`/actas/${primero.id}/cerrar`, { method: 'POST', token: u.token, body: { forzar: true, observacion: obs } });
      assert.equal(r.status, 200, r.error);
      assert.equal(r.acta.estado, 'cerrada');
      assert.equal(r.acta.cuadra, false);
    });

    test('con ADMIN_DNIS solo esos DNIs son administradores', async () => {
      process.env.ADMIN_DNIS = '10000009';
      try {
        assert.equal((await registrar(2)).usuario.rol, 'personero');
        assert.equal((await registrar(9)).usuario.rol, 'admin');
      } finally {
        delete process.env.ADMIN_DNIS;
      }
    });

    test('dashboard público sin cuenta (y restringible)', async () => {
      const r = await llamar('/dashboard?ubigeo=04');
      assert.equal(r.status, 200);
      assert.equal(r.resultados.seccion, 'regional');
      assert.ok(r.resultados.organizaciones.every((o) => !/^Organización \d+$/.test(o.nombre)), 'todas con nombre');
      // No expone datos personales de los personeros.
      assert.doesNotMatch(JSON.stringify(r), /PERSONERO|dni|telefono|email/i);
      process.env.DASHBOARD_PUBLICO = '0';
      try {
        assert.equal((await llamar('/dashboard?ubigeo=04')).status, 401);
      } finally {
        delete process.env.DASHBOARD_PUBLICO;
      }
      // Lo demás sigue requiriendo sesión.
      assert.equal((await llamar('/actas')).status, 401);
      assert.equal((await llamar('/admin/actas')).status, 401);
    });

    test('cabeceras de seguridad', async () => {
      const r = await fetch(base + '/salud');
      assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
    });

    test('agregar organización manual y permisos', async () => {
      const u = await registrar(3);
      const r = await llamar('/organizaciones', { method: 'POST', token: u.token, body: { seccion: 'distrital', ubigeo: '010102', nombre: 'Movimiento de Prueba' } });
      assert.equal(r.status, 201);
      const org = r.secciones.distrital.organizaciones.find((o) => o.nombre === 'MOVIMIENTO DE PRUEBA');
      assert.ok(org);
      const otro = await registrar(4);
      assert.equal((await llamar(`/circunscripcion/${org.circ_id}`, { method: 'DELETE', token: otro.token })).status, 403);
      assert.equal((await llamar(`/circunscripcion/${org.circ_id}`, { method: 'DELETE', token: u.token })).status, 200);
      assert.equal((await llamar('/admin/usuarios', { token: u.token })).status, 403);
    });

    test('jornada: cuenta regresiva y borrado de datos de prueba a la hora de inicio', async () => {
      process.env.ELECCION_INICIO = new Date(Date.now() + 3600e3).toISOString();
      try {
        let e = await llamar('/estado');
        assert.equal(e.modo_prueba, true);
        assert.equal(e.limpieza, null);
        const { n: mesasAntes } = await db.get('SELECT COUNT(*) AS n FROM mesas');
        assert.ok(Number(mesasAntes) > 0);
        assert.equal(await revisarInicio(db), null, 'antes de la hora no borra nada');

        process.env.ELECCION_INICIO = new Date(Date.now() - 1000).toISOString();
        const r = await revisarInicio(db);
        assert.ok(r.actas_borradas > 0);
        assert.equal(await revisarInicio(db), null, 'solo una vez');
        for (const t of ['mesas', 'actas', 'votos_mesa']) assert.equal(Number((await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n), 0, t);
        assert.ok(Number((await db.get('SELECT COUNT(*) AS n FROM usuarios')).n) > 0, 'las cuentas se conservan');
        assert.ok(Number((await db.get('SELECT COUNT(*) AS n FROM organizaciones')).n) > 0);

        e = await llamar('/estado');
        assert.equal(e.modo_prueba, false);
        assert.equal(e.limpieza.id, r.id);
        // Tras la limpieza se puede volver a registrar una mesa que antes se usó de prueba.
        const u = await llamar('/auth/login', { method: 'POST', body: { usuario: '10000001', password: 'secreto123' } });
        const nueva = await llamar('/actas', { method: 'POST', token: u.token, body: { numero: '123456', ubigeo: '040101', electores_habiles: 250 } });
        assert.equal(nueva.status, 201);
        // Borrado manual solo para admin y con confirmación.
        assert.equal((await llamar('/admin/limpiar-prueba', { method: 'POST', token: u.token, body: { confirmar: 'BORRAR' } })).status, 403);
      } finally {
        delete process.env.ELECCION_INICIO;
      }
    });

    test('sincronización con el JNE (respuesta simulada)', async () => {
      const pedidos = [];
      const fetchImpl = async (_url, opts) => {
        pedidos.push(JSON.parse(opts.body));
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [
              { idTipoEleccion: 4, tipoEleccion: 'REGIONAL', organizaciones: [
                { idOrganizacionPolitica: 90001, organizacionPolitica: 'PARTIDO A', URLlogoOP: '90001.png', listas: [{ tieneGobernadores: true, tieneConsejeros: true }] },
                { idOrganizacionPolitica: 90002, organizacionPolitica: 'PARTIDO B', listas: [{ tieneGobernadores: true, tieneConsejeros: false }] },
              ] },
              { idTipoEleccion: 5, tipoEleccion: 'MUNICIPAL PROVINCIAL', organizaciones: [{ idOrganizacionPolitica: 90001, organizacionPolitica: 'PARTIDO A' }] },
              { idTipoEleccion: 6, tipoEleccion: 'MUNICIPAL DISTRITAL', organizaciones: [{ idOrganizacionPolitica: 90003, organizacionPolitica: 'MOVIMIENTO C' }] },
            ],
          }),
        };
      };
      // Samegua, Moquegua: INEI 180104, RENIEC 170106
      const resumen = await sincronizarDistritoJNE(db, '180104', { fetchImpl });
      assert.deepEqual(pedidos[0], { dep: '17', pro: '01', dis: '06' });
      assert.deepEqual(resumen, { regional: 2, consejero: 1, provincial: 1, distrital: 1 });
      const o = await organizacionesDeDistrito(db, '180104');
      assert.equal(o.regional.ambito, '18');
      assert.equal(o.distrital.organizaciones[0].nombre, 'MOVIMIENTO C');
      assert.match(o.regional.organizaciones[0].logo, /90001\.png$/);
    });
  });
}
