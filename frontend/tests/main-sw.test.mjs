import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
// assets/active 유무만 흉내 낸다. database: 없음(undefined) | 저장소 없음('empty') | 모델 없음('pending') | 준비됨('ready')
function fakeIndexedDB(database,log){
 return {open(name){
  const request={};
  setTimeout(()=>{
   if(database===undefined){
    let aborted=false;
    request.transaction={abort(){aborted=true;}};
    request.onupgradeneeded?.();
    if(aborted){request.onerror?.();return;}
    log.created=true;
   }
   request.result={
    objectStoreNames:{contains:store=>store==='assets'&&database!=='empty'},
    close(){log.closed=true;},
    transaction:()=>({objectStore:()=>({count(key){const req={};setTimeout(()=>{req.result=database==='ready'&&key==='active'?1:0;req.onsuccess();});return req;}})}),
   };
   request.onsuccess();
  });
  return request;
 }};
}
function setup({online=false,hang=false,cached=true,database,clients=[]}={}){
 const listeners={},log={},messages=[];
 const context=vm.createContext({
  self:{location:{origin:'https://cropy.test'},addEventListener:(type,fn)=>{listeners[type]=fn;},skipWaiting(){},
   registration:{navigationPreload:{enable:async()=>{log.preload=true;}}},
   clients:{claim(){},matchAll:async()=>clients.map(url=>({url,postMessage:data=>messages.push({url,data})}))}},
  fetch:()=>hang?new Promise(()=>{}):online?Promise.resolve(new Response('network')):Promise.reject(new TypeError('offline')),
  caches:{match:async url=>cached&&url.startsWith('/offline/')?new Response(`shell:${url}`):undefined},
  indexedDB:fakeIndexedDB(database,log),
  setTimeout:(fn,ms)=>setTimeout(fn,ms===6000&&hang?5:ms),clearTimeout,
  Response,URL,Promise});
 vm.runInContext(source,context);
 const navigate=async({mode='navigate',url='https://cropy.test/history',referrer='',preloadResponse}={})=>{
  let reply;const waits=[];
  listeners.fetch({request:{mode,url,referrer},preloadResponse,respondWith:p=>{reply=p;},waitUntil:p=>waits.push(p)});
  const res=reply&&await reply;await Promise.all(waits);return res;
 };
 return {navigate,listeners,log,messages};
}
test('online navigation uses the network',async()=>{
 const res=await setup({online:true,database:'ready'}).navigate();assert.equal(await res.text(),'network');
});
test('navigation preload response is used when available',async()=>{
 const res=await setup({online:false}).navigate({preloadResponse:Promise.resolve(new Response('preloaded'))});
 assert.equal(await res.text(),'preloaded');
});
test('activate enables navigation preload',async()=>{
 const {listeners,log}=setup();let pending;
 listeners.activate({waitUntil:p=>{pending=p;}});await pending;assert.equal(log.preload,true);
});
test('offline navigation redirects to device diagnosis when the model is saved',async()=>{
 const res=await setup({database:'ready'}).navigate();
 assert.equal(res.status,302);assert.match(res.headers.get('location'),/\/offline\/index\.html\?from=offline$/);
});
test('shell cache alone does not count as prepared',async()=>{
 const res=await setup({cached:true,database:'pending'}).navigate();
 assert.match(await res.text(),/저장된 오프라인 파일이 없어요/);
});
test('checking readiness does not leave an empty database behind',async()=>{
 const {navigate,log}=setup({database:undefined});
 assert.match(await (await navigate()).text(),/저장된 오프라인 파일이 없어요/);assert.equal(log.created,undefined);
});
test('database without the assets store is not prepared',async()=>{
 const {navigate,log}=setup({database:'empty'});
 assert.match(await (await navigate()).text(),/저장된 오프라인 파일이 없어요/);assert.equal(log.closed,true);
});
test('device diagnosis page itself is served from cache instead of redirecting to itself',async()=>{
 const {navigate}=setup({database:'ready'});
 const res=await navigate({url:'https://cropy.test/offline/index.html'});
 assert.equal(res.status,200);assert.equal(await res.text(),'shell:/offline/index.html');
 assert.equal(await (await navigate({url:'https://cropy.test/offline/'})).text(),'shell:/offline/index.html');
});
test('device diagnosis page without a cached shell explains how to prepare',async()=>{
 const res=await setup({cached:false}).navigate({url:'https://cropy.test/offline/index.html'});
 assert.match(await res.text(),/저장된 오프라인 파일이 없어요/);
});
test('links from the device diagnosis page keep the page and notify it',async()=>{
 const {navigate,messages}=setup({database:'ready',clients:['https://cropy.test/offline/index.html','https://cropy.test/home']});
 const res=await navigate({url:'https://cropy.test/home',referrer:'https://cropy.test/offline/index.html'});
 assert.equal(res.status,204);
 assert.deepEqual(messages.map(m=>[m.url,m.data.type]),[['https://cropy.test/offline/index.html','cropy-offline-stay']]);
});
test('slow network falls back after the navigation timeout',async()=>{
 const res=await setup({hang:true,database:'ready'}).navigate();assert.equal(res.status,302);
});
test('without saved files the fallback offers install and file download, disabled until online',async()=>{
 const html=await (await setup({database:'pending'}).navigate()).text();
 assert.match(html,/인터넷이 연결되면 앱 설치와 오프라인 파일 받기를 할 수 있어요/);
 assert.match(html,/data-href="\/offline\/install\.html" disabled>앱 설치하기/);
 assert.match(html,/data-href="\/offline\/index\.html\?prepare=1" disabled>오프라인 파일 받기/);
 assert.match(html,/addEventListener\('online',sync\)/);
});
test('non-navigation requests are left to the browser',async()=>{
 assert.equal(await setup({database:'ready'}).navigate({mode:'cors'}),undefined);
});
