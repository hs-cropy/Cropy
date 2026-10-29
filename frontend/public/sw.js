// 메인 앱 오프라인 안내. 메인 화면은 캐시하지 않고, 연결이 없을 때 주소 이동만 기기 진단으로 돌린다.
// /offline/ 아래는 범위가 더 좁은 /offline/sw.js가 맡으므로 여기로 오지 않는다.
const OFFLINE_PAGE = '/offline/index.html';
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
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(async () => {
    // 오프라인 묶음이 준비된 기기면 기기 진단으로, 아니면 준비 방법을 안내한다.
    if (await caches.match(OFFLINE_PAGE)) return Response.redirect(new URL(OFFLINE_PAGE, self.location.origin).href, 302);
    return new Response(FALLBACK_HTML, {headers: {'Content-Type': 'text/html; charset=utf-8'}});
  }));
});
