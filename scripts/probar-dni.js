// Prueba el token de Decolecta con un DNI y muestra la respuesta tal cual.
// Uso: npm run probar:dni -- 12345678     (lee DECOLECTA_TOKEN del archivo .env)
const dni = process.argv[2];
const token = process.env.DECOLECTA_TOKEN;
if (!token) {
  console.error('Falta DECOLECTA_TOKEN. Crea el archivo .env (copia .env.example) y pon: DECOLECTA_TOKEN=tu_token');
  process.exit(1);
}
if (!/^\d{8}$/.test(dni || '')) {
  console.error('Indica un DNI de 8 dígitos. Ej: npm run probar:dni -- 12345678');
  process.exit(1);
}
const url = `${process.env.DECOLECTA_URL || 'https://api.decolecta.com/v1/reniec/dni'}?numero=${dni}`;
const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
console.log(`HTTP ${r.status}`);
console.log(await r.text());
if (r.status === 401 || r.status === 403) console.error('\nEl token no es válido o no tiene saldo. Revísalo en decolecta.com');
