// 메인 앱 오프라인 안내. 메인 화면은 캐시하지 않고, 연결이 없을 때 주소 이동만 기기 진단으로 돌린다.
// /offline/ 아래는 보통 범위가 더 좁은 /offline/sw.js가 맡지만, 그 등록이 없으면 여기로 온다.
const OFFLINE_PAGE = '/offline/index.html';
const DATABASE = 'cropy-on-device';
// 신호가 약하면 응답 없이 브라우저 타임아웃까지 빈 화면이 이어진다. 그 전에 대체 화면으로 넘어간다.
const NAVIGATION_TIMEOUT_MS = 6000;
const FALLBACK_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#FAF7F0">
<title>Cropy · 연결 없음</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf7f0;color:#1c2b22;font:16px/1.6 system-ui,sans-serif}
main{max-width:420px;padding:24px;text-align:center}h1{color:#28844b;font-size:24px}
button{border:0;border-radius:12px;padding:12px 18px;background:#318953;color:#fff;font-weight:700;font-size:15px}
</style></head><body><main><h1>인터넷에 연결되어 있지 않아요</h1>
<p>기기 진단은 연결된 상태에서 <b>인터넷 없이 기기에서 진단하기</b>로 들어가 모델을 한 번 준비해야 쓸 수 있어요.</p>
<button onclick="location.reload()">다시 시도</button></main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  self.clients.claim(),
  // 온라인 사용자의 첫 이동이 워커 기동을 기다리지 않게 한다.
  self.registration.navigationPreload?.enable(),
])));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(network(event).catch(() => offline(event)));
});

function network(event) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS); });
  const response = Promise.resolve(event.preloadResponse).then(preloaded => preloaded || fetch(event.request));
  return Promise.race([response, timeout]).finally(() => clearTimeout(timer));
}

async function offline(event) {
  const url = new URL(event.request.url);
  // 기기 진단 화면 요청을 다시 같은 주소로 돌리면 302가 반복된다. 캐시한 화면을 그대로 준다.
  if (url.pathname.startsWith('/offline/')) {
    return (await caches.match(url.pathname === '/offline/' ? OFFLINE_PAGE : url.pathname)) || fallback();
  }
  // 기기 진단 화면에서 누른 링크면 이동하지 않는다(204). 다시 불러오면 선택한 사진과 화면에만 있던 결과가 사라진다.
  if (fromOfflinePage(event.request)) {
    event.waitUntil(notifyOfflinePages());
    return new Response(null, {status: 204});
  }
  if (await modelReady()) return Response.redirect(new URL(OFFLINE_PAGE, self.location.origin).href, 302);
  return fallback();
}

function fallback() {
  return new Response(FALLBACK_HTML, {headers: {'Content-Type': 'text/html; charset=utf-8'}});
}

function fromOfflinePage(request) {
  try {
    const referrer = new URL(request.referrer);
    return referrer.origin === self.location.origin && referrer.pathname.startsWith('/offline/');
  } catch {
    return false;
  }
}

async function notifyOfflinePages() {
  const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
  for (const client of windows) {
    if (new URL(client.url).pathname.startsWith('/offline/')) client.postMessage({type: 'cropy-offline-stay'});
  }
}

// 모델 저장에 성공해야 assets/active가 생긴다. 셸 캐시는 모델보다 먼저 만들어지므로 준비 판단에 쓰지 않는다.
function modelReady() {
  return new Promise(resolve => {
    let request;
    try { request = indexedDB.open(DATABASE); } catch { resolve(false); return; }
    // DB가 없으면 지금 빈 DB가 만들어진다. 남으면 기기 진단 화면이 저장소를 만들지 못하므로 취소한다.
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      const done = ready => { db.close(); resolve(ready); };
      if (!db.objectStoreNames.contains('assets')) { done(false); return; }
      try {
        // 모델 바이트를 읽지 않도록 개수만 센다.
        const count = db.transaction('assets').objectStore('assets').count('active');
        count.onsuccess = () => done(count.result > 0);
        count.onerror = () => done(false);
      } catch {
        done(false);
      }
    };
  });
}
