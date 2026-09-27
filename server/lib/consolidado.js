// Mantiene la tabla votos_mesa: los votos de cada mesa listos para sumarse con SQL.
//
// Varios personeros pueden contar la misma mesa. Para no sumarla dos veces se elige un acta:
//   'oficial': la cerrada más reciente de la mesa.
//   'parcial': la oficial o, si ninguna está cerrada, el borrador con más cédulas registradas.
// Se recalcula dentro de la misma transacción cada vez que cambia un acta de la mesa, así el
// dashboard nunca tiene que abrir los registros de cada acta.

import { createHash } from 'node:crypto';

/** Huella del conteo para detectar actas cerradas de una misma mesa con números distintos. */
export function firmaConteo(conteo) {
  const normal = Object.keys(conteo || {})
    .sort()
    .map((s) => [s, Object.entries(conteo[s].votos || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
  return createHash('sha1').update(JSON.stringify(normal)).digest('hex').slice(0, 16);
}

export async function recalcularMesa(t, mesaId) {
  // En Postgres se bloquea la mesa: si dos personeros de la misma mesa guardan a la vez,
  // el segundo espera al primero en vez de chocar al reescribir votos_mesa.
  // (SQLite ya ejecuta una transacción de escritura a la vez.)
  const bloqueo = t.motor === 'postgres' ? ' FOR UPDATE' : '';
  const mesa = await t.get(`SELECT ubigeo FROM mesas WHERE id = ?${bloqueo}`, [mesaId]);
  await t.run('DELETE FROM votos_mesa WHERE mesa_id = ?', [mesaId]);
  if (!mesa) return;
  const actas = await t.all('SELECT id, estado, conteo, cerrado_en, n_registros FROM actas WHERE mesa_id = ?', [mesaId]);
  const cerradas = actas.filter((a) => a.estado === 'cerrada').sort((a, b) => String(b.cerrado_en).localeCompare(String(a.cerrado_en)));
  const oficial = cerradas[0] || null;
  const borrador = actas.filter((a) => a.estado === 'borrador' && a.n_registros > 0).sort((a, b) => b.n_registros - a.n_registros)[0];
  const parcial = oficial || borrador || null;

  // Todas las filas de la mesa en una sola inserción (menos viajes a la base).
  const filas = [];
  for (const [tipo, acta] of [['oficial', oficial], ['parcial', parcial]]) {
    if (!acta) continue;
    const conteo = JSON.parse(acta.conteo || '{}');
    for (const [seccion, c] of Object.entries(conteo)) {
      for (const [opcion, votos] of Object.entries(c.votos || {})) {
        if (votos) filas.push(mesaId, mesa.ubigeo, tipo, seccion, opcion, votos);
      }
    }
  }
  if (filas.length) {
    const n = filas.length / 6;
    await t.run(`INSERT INTO votos_mesa (mesa_id, ubigeo, tipo, seccion, opcion, votos) VALUES ${Array(n).fill('(?, ?, ?, ?, ?, ?)').join(', ')}`, filas);
  }
}
