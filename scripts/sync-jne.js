// Descarga del JNE (Voto Informado) las organizaciones de todos los distritos de un
// departamento o provincia y las guarda en la base. Hace una consulta por distrito,
// con pausa entre consultas para no saturar el portal.
//
// Uso: npm run sync:jne -- 04        (todo Arequipa, ubigeo INEI)
//      npm run sync:jne -- 0401      (solo provincia de Arequipa)
//      npm run sync:jne -- 040112    (un distrito)
import { fileURLToPath } from 'node:url';
import { abrirDB } from '../server/db.js';
import { ARBOL } from '../server/ubigeo.js';
import { sincronizarDistritoJNE } from '../server/organizaciones.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const db = abrirDB(process.env.DB_PATH || `${DATA}conteo.db`);
const prefijo = String(process.argv[2] || '');
const pausaMs = Number(process.env.PAUSA_MS || 1200);
if (!/^\d{2}(\d{2}(\d{2})?)?$/.test(prefijo)) {
  console.error('Indica un ubigeo INEI de departamento (2), provincia (4) o distrito (6 dígitos). Ej: npm run sync:jne -- 04');
  process.exit(1);
}

const distritos = ARBOL.flatMap((d) => d.p.flatMap((p) => p.d.map((x) => ({ ...x, prov: p.n, dep: d.n })))).filter((x) =>
  x.c.startsWith(prefijo),
);
console.log(`Sincronizando ${distritos.length} distritos con el JNE...`);
let ok = 0;
for (const [i, x] of distritos.entries()) {
  try {
    const r = await sincronizarDistritoJNE(db, x.c);
    ok++;
    console.log(`[${i + 1}/${distritos.length}] ${x.c} ${x.n} (${x.prov}) ->`, JSON.stringify(r));
  } catch (e) {
    console.warn(`[${i + 1}/${distritos.length}] ${x.c} ${x.n}: ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, pausaMs));
}
console.log(`Listo: ${ok}/${distritos.length} distritos sincronizados.`);
