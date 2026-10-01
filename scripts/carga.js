// Prueba de carga: simula personeros contando votos y mirando el dashboard a la vez.
//
//   npm run carga -- http://localhost:8080            (contra el despliegue con Docker)
//   npm run carga -- http://localhost:3000 --personeros 300 --segundos 20
//
// El servidor debe tener RATE_LIMIT=0 durante la prueba (todos los pedidos salen de la misma IP).
// Pasos: 1) registra personeros y sus mesas; 2) mide el guardado de actas (PUT);
// 3) mide el dashboard (GET); 4) mide ambos mezclados, como el día de la elección.
import autocannon from 'autocannon';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) || 'http://localhost:3000').replace(/\/$/, '');
const opt = (nombre, def) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const PERSONEROS = opt('personeros', 200);
const SEGUNDOS = opt('segundos', 15);
const CONEXIONES = opt('conexiones', 100);
const CEDULAS = 150; // cédulas por acta en la prueba (una mesa real tiene hasta 300 electores)

async function llamar(ruta, { method = 'GET', body, token } = {}) {
  const r = await fetch(base + ruta, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${ruta}: ${r.status} ${datos.error || ''}`);
  return datos;
}

// Distritos de Arequipa incluidos en la semilla.
const DISTRITOS = ['040102', '040103', '040104', '040105', '040112', '040122', '040126', '040129', '040201', '040501'];
const semilla = Date.now() % 1000000;

console.log(`Preparando ${PERSONEROS} personeros contra ${base}…`);
const personeros = [];
for (let i = 0; i < PERSONEROS; i++) {
  const dni = String(70000000 + ((semilla * 1000 + i) % 29999999)).padStart(8, '0');
  let r;
  try {
    r = await llamar('/api/auth/registro', {
      method: 'POST',
      body: { dni, nombres: 'PERSONERO', apellido_paterno: 'DE PRUEBA', apellido_materno: 'CARGA', telefono: '999999999', password: 'prueba1234' },
    });
  } catch {
    r = await llamar('/api/auth/login', { method: 'POST', body: { usuario: dni, password: 'prueba1234' } });
  }
  const ubigeo = DISTRITOS[i % DISTRITOS.length];
  const numero = String(900000 + ((semilla + i) % 99999)).padStart(6, '0');
  const { acta } = await llamar('/api/actas', { method: 'POST', token: r.token, body: { numero, ubigeo, electores_habiles: 300 } }).catch(async () =>
    llamar('/api/actas', { method: 'POST', token: r.token, body: { numero: String(800000 + i), ubigeo, electores_habiles: 300 } }),
  );
  const { organizaciones } = await llamar(`/api/actas/${acta.id}`, { token: r.token });
  // Cédulas simuladas: votos repartidos entre las primeras organizaciones de cada sección.
  const registros = [];
  for (let c = 0; c < CEDULAS; c++) {
    const v = {};
    for (const s of acta.secciones) {
      const orgs = organizaciones[s].organizaciones;
      v[s] = c % 17 === 0 ? 'B' : c % 23 === 0 ? 'N' : String(orgs[(c * 7 + i) % Math.min(orgs.length, 6)]?.id ?? 'B');
    }
    registros.push({ id: `c${c}`, ts: Date.now(), v });
  }
  personeros.push({ token: r.token, acta: acta.id, ubigeo, registros });
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1} listos`);
}

let turno = 0;
const siguiente = () => personeros[turno++ % personeros.length];

const guardar = {
  method: 'PUT',
  setupRequest: (req) => {
    const p = siguiente();
    // Cada guardado lleva entre 1 y 150 cédulas, como un acta a medio contar.
    const n = 1 + Math.floor(Math.random() * p.registros.length);
    return {
      ...req,
      path: `/api/actas/${p.acta}`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.token}` },
      body: JSON.stringify({ registros: p.registros.slice(0, n), total_votantes: null, modo: 'cedula' }),
    };
  },
};
const AMBITOS = ['04', '0401', '040112', '040103', '0402', ''];
const mirar = {
  method: 'GET',
  setupRequest: (req) => {
    const p = siguiente();
    const u = AMBITOS[Math.floor(Math.random() * AMBITOS.length)];
    return { ...req, path: `/api/dashboard?ubigeo=${u}&borradores=1`, headers: { Authorization: `Bearer ${p.token}` } };
  },
};

function correr(titulo, requests) {
  return new Promise((resolve, reject) => {
    const inst = autocannon({ url: base, connections: CONEXIONES, duration: SEGUNDOS, requests }, (err, r) => (err ? reject(err) : resolve(r)));
    inst.on('error', reject);
    console.log(`\n▶ ${titulo} (${CONEXIONES} conexiones, ${SEGUNDOS} s)…`);
  });
}

const resultados = [];
for (const [titulo, reqs] of [
  ['Guardar actas (PUT)', [guardar]],
  ['Dashboard (GET)', [mirar]],
  ['Mezcla: 4 guardados por cada consulta al dashboard', [guardar, guardar, guardar, guardar, mirar]],
]) {
  const r = await correr(titulo, reqs);
  resultados.push({
    prueba: titulo,
    'pedidos/s': Math.round(r.requests.average),
    'latencia p50 ms': r.latency.p50,
    'latencia p99 ms': r.latency.p99,
    errores: r.errors + r.non2xx,
    total: r.requests.total,
  });
}
console.log('\nResultados:');
console.table(resultados);

// Estimación: un personero guarda como máximo una vez cada 3 s mientras cuenta (la app agrupa los toques)
// y mira el dashboard cada 20 s.
const put = resultados[0]['pedidos/s'];
console.log(`\nCon esta capacidad de guardado (${put}/s) se atienden ~${Math.round(put * 3).toLocaleString('es-PE')} personeros contando al mismo tiempo.`);
