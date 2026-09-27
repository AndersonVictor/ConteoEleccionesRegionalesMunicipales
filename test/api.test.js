import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abrirDB } from '../server/db.js';
import { crearApp } from '../server/app.js';
import { cargarSemilla, sincronizarDistritoJNE, organizacionesDeDistrito } from '../server/organizaciones.js';

process.env.JNE_AUTO = '0';

let server;
let base;
let db;

before(async () => {
  db = abrirDB(':memory:');
  cargarSemilla(db, JSON.parse(readFileSync(new URL('../data/seed/arequipa.json', import.meta.url), 'utf8')));
  server = crearApp({ db, secreto: 'test' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function llamar(ruta, { method = 'GET', body, token } = {}) {
  const r = await fetch(base + ruta, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, ...(await r.json()) };
}

async function registrar(n) {
  const r = await llamar('/auth/registro', {
    method: 'POST',
    body: { nombre: `Personero ${n}`, dni: String(10000000 + n), email: `p${n}@test.pe`, password: 'secreto1' },
  });
  assert.equal(r.status, 201, r.error);
  return r;
}

test('flujo completo: registro, mesa, conteo, cierre y dashboard', async () => {
  const admin = await registrar(1);
  assert.equal(admin.usuario.rol, 'admin');
  const p2 = await registrar(2);
  assert.equal(p2.usuario.rol, 'personero');

  const login = await llamar('/auth/login', { method: 'POST', body: { usuario: '10000002', password: 'secreto1' } });
  assert.equal(login.status, 200);
  assert.equal((await llamar('/auth/login', { method: 'POST', body: { usuario: 'p2@test.pe', password: 'mal' } })).status, 401);
  assert.equal((await llamar('/actas')).status, 401);

  // Paucarpata, Arequipa (INEI 040112)
  const { acta } = await llamar('/actas', { method: 'POST', token: admin.token, body: { numero: '123456', ubigeo: '040112', electores_habiles: 300 } });
  assert.deepEqual(acta.secciones, ['regional', 'consejero', 'provincial', 'distrital']);

  const orgs = await llamar(`/actas/${acta.id}`, { token: admin.token });
  const ids = Object.fromEntries(Object.entries(orgs.organizaciones).map(([s, v]) => [s, v.organizaciones.map((o) => String(o.id))]));
  for (const s of acta.secciones) assert.ok(ids[s].length > 5, `hay organizaciones para ${s}`);

  const [a, b] = [ids.regional[0], ids.regional[1]];
  const ced = (x) => ({ regional: x, consejero: ids.consejero[0], provincial: ids.provincial[0], distrital: ids.distrital[0] });
  const registros = [
    { id: '1', v: ced(a) }, { id: '2', v: ced(a) }, { id: '3', v: ced(b) },
    { id: '4', v: { regional: 'B', consejero: 'N', provincial: 'B', distrital: 'I' } },
  ];

  // Otro personero no puede tocar mi acta.
  assert.equal((await llamar(`/actas/${acta.id}`, { method: 'PUT', token: p2.token, body: { registros } })).status, 403);

  // Organización inexistente es rechazada.
  assert.equal((await llamar(`/actas/${acta.id}`, { method: 'PUT', token: admin.token, body: { registros: [{ v: { regional: '999999' } }] } })).status, 400);

  let r = await llamar(`/actas/${acta.id}`, { method: 'PUT', token: admin.token, body: { registros, total_votantes: 5 } });
  assert.equal(r.status, 200);
  assert.equal(r.acta.cuadra, false);
  assert.equal((await llamar(`/actas/${acta.id}/cerrar`, { method: 'POST', token: admin.token })).status, 422);

  r = await llamar(`/actas/${acta.id}`, { method: 'PUT', token: admin.token, body: { total_votantes: 4 } });
  assert.equal(r.acta.cuadra, true);
  r = await llamar(`/actas/${acta.id}/cerrar`, { method: 'POST', token: admin.token });
  assert.equal(r.acta.estado, 'cerrada');

  // Segundo personero en la misma mesa con un conteo distinto -> diferencias.
  const acta2 = (await llamar('/actas', { method: 'POST', token: p2.token, body: { numero: '123456' } })).acta;
  assert.notEqual(acta2.id, acta.id);
  await llamar(`/actas/${acta2.id}`, { method: 'PUT', token: p2.token, body: { registros: registros.slice(0, 3).concat([{ v: ced(b) }]), total_votantes: 4 } });
  await llamar(`/actas/${acta2.id}/cerrar`, { method: 'POST', token: p2.token });

  // Mesa con número repetido en otro distrito.
  assert.equal((await llamar('/actas', { method: 'POST', token: p2.token, body: { numero: '123456', ubigeo: '040101' } })).status, 409);

  const dRegion = await llamar('/dashboard?ubigeo=04', { token: p2.token });
  assert.equal(dRegion.resultados.seccion, 'regional');
  assert.equal(dRegion.mesas_stats.registradas, 1);
  assert.equal(dRegion.mesas_stats.contabilizadas, 1);
  assert.deepEqual(dRegion.mesas_stats.con_diferencias, ['123456']);
  assert.equal(dRegion.desglose[0].ubigeo, '0401');
  const total = dRegion.resultados.organizaciones.reduce((s, o) => s + o.votos, 0);
  assert.equal(total, 3);

  const dDist = await llamar('/dashboard?ubigeo=040112&seccion=distrital', { token: p2.token });
  assert.equal(dDist.resultados.seccion, 'distrital');
  assert.equal(dDist.mesas.length, 1);
  assert.equal(dDist.mesas[0].diferencias, true);
});

test('agregar organización manual y permisos', async () => {
  const u = await registrar(3);
  const r = await llamar('/organizaciones', { method: 'POST', token: u.token, body: { seccion: 'distrital', ubigeo: '010102', nombre: 'Movimiento de Prueba' } });
  assert.equal(r.status, 201);
  const org = r.secciones.distrital.organizaciones.find((o) => o.nombre === 'MOVIMIENTO DE PRUEBA');
  assert.ok(org);
  assert.equal((await llamar(`/circunscripcion/${org.circ_id}`, { method: 'DELETE', token: u.token })).status, 200);
});

test('sincronización con el JNE (respuesta simulada)', async () => {
  const pedidos = [];
  const fetchImpl = async (url, opts) => {
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
  const o = organizacionesDeDistrito(db, '180104');
  assert.equal(o.regional.ambito, '18');
  assert.equal(o.distrital.organizaciones[0].nombre, 'MOVIMIENTO C');
  assert.match(o.regional.organizaciones[0].logo, /90001\.png$/);
});
