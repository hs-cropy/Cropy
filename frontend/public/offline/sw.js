const CACHE = 'cropy-offline-shell-11881516999d04bc';
const SHELL = ['/offline/index.html', '/offline/app.mjs', '/offline/core.mjs',
  '/offline-runtime/ort.wasm.bundle.min.mjs', '/offline-runtime/ort-wasm-simd-threaded.mjs',
  '/offline-runtime/ort-wasm-simd-threaded.wasm', '/offline/manifest.webmanifest',
  '/offline/icons/icon-192.png', '/offline/icons/icon-512.png', '/offline/icons/icon-maskable-512.png',
  '/offline/icons/apple-touch-icon.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (SHELL.includes(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
});
