import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambitoDeSeccion, contar, evaluarCuadre, resumenSeccion, seccionesParaUbigeo } from '../shared/acta.js';

test('secciones según el distrito', () => {
  assert.deepEqual(seccionesParaUbigeo('040112'), ['regional', 'consejero', 'provincial', 'distrital']);
  // Distrito capital de provincia: no hay elección distrital.
  assert.deepEqual(seccionesParaUbigeo('040101'), ['regional', 'consejero', 'provincial']);
  // Lima Metropolitana: sin gobierno regional.
  assert.deepEqual(seccionesParaUbigeo('150132'), ['provincial', 'distrital']);
  assert.deepEqual(seccionesParaUbigeo('150101'), ['provincial']);
  // Callao sí elige gobierno regional.
  assert.deepEqual(seccionesParaUbigeo('070102'), ['regional', 'consejero', 'provincial', 'distrital']);
});

test('ámbito de cada sección', () => {
  assert.equal(ambitoDeSeccion('regional', '040112'), '04');
  assert.equal(ambitoDeSeccion('consejero', '040112'), '0401');
  assert.equal(ambitoDeSeccion('provincial', '040112'), '0401');
  assert.equal(ambitoDeSeccion('distrital', '040112'), '040112');
});

const S = ['regional', 'consejero', 'provincial', 'distrital'];
const ced = (r, c, p, d) => ({ v: { regional: r, consejero: c, provincial: p, distrital: d } });

test('conteo y resumen', () => {
  const regs = [ced('1', '1', '2', 'B'), ced('1', '2', '2', 'N'), ced('3', '1', 'I', '5')];
  const c = contar(regs, S);
  assert.equal(c.regional.total, 3);
  assert.deepEqual(c.regional.votos, { 1: 2, 3: 1 });
  assert.deepEqual(resumenSeccion(c.distrital), { validos: 1, blancos: 1, nulos: 1, impugnados: 0, emitidos: 3 });
  assert.deepEqual(resumenSeccion(c.provincial), { validos: 2, blancos: 0, nulos: 0, impugnados: 1, emitidos: 3 });
});

test('cuadre: todo cuadra', () => {
  const regs = [ced('1', '1', '2', 'B'), ced('1', '2', '2', 'N')];
  const r = evaluarCuadre({ registros: regs, secciones: S, totalVotantes: 2, electoresHabiles: 300 });
  assert.equal(r.ok, true);
});

test('cuadre: falta un voto en una sección', () => {
  const regs = [ced('1', '1', '2', 'B'), ced('1', '2', '2', 'N'), { v: { regional: '1' } }];
  const r = evaluarCuadre({ registros: regs, secciones: S, totalVotantes: 3, electoresHabiles: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.checks.filter((c) => !c.ok).length, 3);
  assert.match(r.checks.find((c) => c.seccion === 'consejero').msg, /faltan 1/);
});

test('cuadre: más votantes que electores hábiles', () => {
  const r = evaluarCuadre({ registros: [ced('1', '1', '1', '1')], secciones: S, totalVotantes: 301, electoresHabiles: 300 });
  assert.equal(r.ok, false);
});

test('cuadre: sin total de votantes no cierra', () => {
  const r = evaluarCuadre({ registros: [ced('1', '1', '1', '1')], secciones: S, totalVotantes: null, electoresHabiles: 300 });
  assert.equal(r.ok, false);
});
