// Jornada electoral: hasta el inicio todo es de prueba. A la hora de inicio (por defecto el
// domingo 4 de octubre de 2026 a las 8:00 a. m., hora de Perú) se borran automáticamente las
// mesas, actas y votos registrados. Las cuentas de los personeros y las organizaciones se conservan.
import { ahora } from './db.js';

export const inicioJornada = () => new Date(process.env.ELECCION_INICIO || '2026-10-04T08:00:00-05:00');

async function leerConfig(db, clave) {
  const r = await db.get('SELECT valor FROM config WHERE clave = ?', [clave]);
  return r ? JSON.parse(r.valor) : null;
}

async function guardarConfig(db, clave, valor) {
  await db.run(
    'INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor',
    [clave, JSON.stringify(valor)],
  );
}

export async function estadoJornada(db) {
  const inicio = inicioJornada();
  return {
    inicio: inicio.toISOString(),
    ahora: new Date().toISOString(),
    modo_prueba: Date.now() < inicio.getTime(),
    // Cambia cada vez que se borran los datos: el celular lo usa para limpiar sus copias locales.
    limpieza: await leerConfig(db, 'limpieza'),
  };
}

/** Borra mesas, actas y votos (datos de prueba). Deja usuarios y organizaciones. */
export async function limpiarDatosDePrueba(db, { motivo }) {
  const cuenta = await db.tx(async (t) => {
    const { n } = await t.get('SELECT COUNT(*) AS n FROM actas');
    await t.run('DELETE FROM votos_mesa');
    await t.run('DELETE FROM actas');
    await t.run('DELETE FROM mesas');
    return Number(n);
  });
  const limpieza = { id: Date.now(), hecha_en: ahora(), motivo, actas_borradas: cuenta };
  await guardarConfig(db, 'limpieza', limpieza);
  console.log(`[jornada] Datos de prueba borrados (${motivo}): ${cuenta} actas`);
  return limpieza;
}

/** Borra los datos de prueba una sola vez al llegar la hora de inicio (aunque haya varias réplicas). */
export async function revisarInicio(db) {
  if (process.env.LIMPIEZA_AUTOMATICA === '0' || Date.now() < inicioJornada().getTime()) return null;
  return db.candado(20261006, async () => {
    if (await leerConfig(db, 'limpieza_automatica')) return null;
    const r = await limpiarDatosDePrueba(db, { motivo: 'inicio de la jornada' });
    await guardarConfig(db, 'limpieza_automatica', r);
    return r;
  });
}

/** Programa la limpieza para el instante exacto del inicio, con una revisión cada minuto de respaldo. */
export function programarInicio(db) {
  const revisar = () => revisarInicio(db).catch((e) => console.error('[jornada]', e.message));
  revisar();
  const falta = inicioJornada().getTime() - Date.now();
  if (falta > 0 && falta < 2 ** 31 - 1) setTimeout(revisar, falta + 50).unref();
  setInterval(revisar, 60000).unref();
}
