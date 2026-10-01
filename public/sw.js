// Service worker: permite abrir la app sin señal (los votos ya se guardan en localStorage).
const CACHE = 'conteo-erm-v7';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/manifest.webmanifest',
  '/img/icono.svg',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/ubigeo.js',
  '/js/guia.js',
  '/js/tema.js',
  '/js/jornada.js',
  '/vendor/driver/driver.js.iife.js',
  '/vendor/driver/driver.css',
  '/js/views/login.js',
  '/js/views/mesas.js',
  '/js/views/nueva-mesa.js',
  '/js/views/conteo.js',
  '/js/views/resumen.js',
  '/js/views/dashboard.js',
  '/js/views/admin.js',
  '/js/views/cuenta.js',
  '/shared/acta.js',
  '/shared/validacion.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Red primero (para recibir siempre la última versión) y caché si no hay señal.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
