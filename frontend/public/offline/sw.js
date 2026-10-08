const CACHE = 'cropy-offline-shell-3249e77799a50296';
const SHELL = ['/offline/index.html', '/offline/app.mjs', '/offline/core.mjs',
  '/offline-runtime/ort.wasm.bundle.min.mjs', '/offline-runtime/ort-wasm-simd-threaded.mjs',
  '/offline-runtime/ort-wasm-simd-threaded.wasm'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (SHELL.includes(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
});
