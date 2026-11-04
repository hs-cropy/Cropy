const CACHE = 'cropy-offline-shell-4d375eb850a2a871';
const SHELL = ['/offline/index.html', '/offline/app.mjs', '/offline/core.mjs',
  '/offline-runtime/ort.wasm.bundle.min.mjs', '/offline-runtime/ort-wasm-simd-threaded.mjs',
  '/offline-runtime/ort-wasm-simd-threaded.wasm',
  '/brand/cropy-logo.png', '/background/farm-mobile.webp', '/background/farm-desktop.webp',
  '/mascot/help.png', '/mascot/analyzing.png', '/mascot/healthy.png', '/mascot/connection.png',
  '/mascot/warning.png', '/mascot/failed.png', '/mascot/retake.png', '/mascot/saved.png', '/mascot/confirmation.png',
  '/mascot/result.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
// 파일이 바뀔 때마다 캐시 이름이 바뀌므로 이전 셸 캐시(런타임 약 14MB 포함)를 지운다
self.addEventListener('activate', event => event.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(key => key.startsWith('cropy-offline-shell-') && key !== CACHE).map(key => caches.delete(key))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (SHELL.includes(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
});
