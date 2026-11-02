import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
function setup({online,cached}){
 const listeners={};
 const context=vm.createContext({
  self:{location:{origin:'https://cropy.test'},addEventListener:(type,fn)=>{listeners[type]=fn;},skipWaiting(){},clients:{claim(){}}},
  fetch:async()=>{if(!online)throw new TypeError('offline');return new Response('network');},
  caches:{match:async url=>cached&&url==='/offline/index.html'?new Response('shell'):undefined},
  Response,URL});
 vm.runInContext(source,context);
 return async mode=>{let reply;listeners.fetch({request:{mode},respondWith:p=>{reply=p;}});return reply&&await reply;};
}
test('online navigation uses the network',async()=>{
 const res=await setup({online:true,cached:true})('navigate');assert.equal(await res.text(),'network');
});
test('offline navigation redirects to the prepared device diagnosis',async()=>{
 const res=await setup({online:false,cached:true})('navigate');
 assert.equal(res.status,302);assert.match(res.headers.get('location'),/\/offline\/index\.html$/);
});
test('offline navigation without a prepared bundle explains how to prepare',async()=>{
 const res=await setup({online:false,cached:false})('navigate');
 assert.match(await res.text(),/모델을 한 번 준비/);
});
test('non-navigation requests are left to the browser',async()=>{
 assert.equal(await setup({online:false,cached:true})('cors'),undefined);
});
