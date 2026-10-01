// Consulta de nombres por DNI con la API de Decolecta (datos de RENIEC).
//   GET https://api.decolecta.com/v1/reniec/dni?numero=12345678
//   Authorization: Bearer <DECOLECTA_TOKEN>
// Respuesta: { first_name, first_last_name, second_last_name, full_name, document_number }
//
// El token vive solo en el servidor (variable DECOLECTA_TOKEN), nunca llega al celular.
// Los resultados se guardan en la tabla dni_cache para no gastar consultas repetidas.

import { ahora } from './db.js';
import { mayusculas } from '../../shared/validacion.js';

const urlApi = () => process.env.DECOLECTA_URL || 'https://api.decolecta.com/v1/reniec/dni';
const TIMEOUT_MS = Number(process.env.DECOLECTA_TIMEOUT_MS || 6000);
const DIAS_CACHE = 30;

export const decolectaConfigurado = () => !!process.env.DECOLECTA_TOKEN;

/** Interpreta la respuesta (acepta también el formato antiguo de apis.net.pe). */
export function interpretar(json) {
  if (!json || typeof json !== 'object') return null;
  const d = json.data && typeof json.data === 'object' ? json.data : json;
  const nombres = mayusculas(d.first_name ?? d.nombres);
  const paterno = mayusculas(d.first_last_name ?? d.apellidoPaterno ?? d.apellido_paterno);
  const materno = mayusculas(d.second_last_name ?? d.apellidoMaterno ?? d.apellido_materno);
  if (!nombres || !paterno) return null;
  return { nombres, apellido_paterno: paterno, apellido_materno: materno };
}

/**
 * Busca un DNI. Devuelve { encontrado: true, nombres, apellido_paterno, apellido_materno }
 * o { encontrado: false, motivo } si no existe, no hay token o la API no responde.
 */
export async function consultarDni(db, dni, { fetchImpl = fetch } = {}) {
  const guardado = await db.get('SELECT * FROM dni_cache WHERE dni = ?', [dni]);
  if (guardado && Date.now() - new Date(guardado.consultado_en).getTime() < DIAS_CACHE * 86400000) {
    const { nombres, apellido_paterno, apellido_materno } = guardado;
    return { encontrado: true, nombres, apellido_paterno, apellido_materno };
  }
  if (!decolectaConfigurado()) return { encontrado: false, motivo: 'no_configurado' };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(`${urlApi()}?numero=${encodeURIComponent(dni)}`, {
      headers: { Authorization: `Bearer ${process.env.DECOLECTA_TOKEN}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (r.status === 404 || r.status === 422) return { encontrado: false, motivo: 'no_encontrado' };
    if (r.status === 401 || r.status === 403) {
      console.error(`[decolecta] ${r.status}: token inválido o sin saldo. Revisa DECOLECTA_TOKEN en .env`);
      return { encontrado: false, motivo: 'token_invalido' };
    }
    if (!r.ok) {
      console.error(`[decolecta] respondió ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      return { encontrado: false, motivo: 'no_disponible' };
    }
    const datos = interpretar(await r.json());
    if (!datos) return { encontrado: false, motivo: 'no_encontrado' };
    await db.run(
      `INSERT INTO dni_cache (dni, nombres, apellido_paterno, apellido_materno, consultado_en) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (dni) DO UPDATE SET nombres = excluded.nombres, apellido_paterno = excluded.apellido_paterno,
         apellido_materno = excluded.apellido_materno, consultado_en = excluded.consultado_en`,
      [dni, datos.nombres, datos.apellido_paterno, datos.apellido_materno, ahora()],
    );
    return { encontrado: true, ...datos };
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[decolecta]', e.message);
    return { encontrado: false, motivo: 'no_disponible' };
  } finally {
    clearTimeout(t);
  }
}
