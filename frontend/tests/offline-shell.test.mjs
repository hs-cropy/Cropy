import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/offline/shell.mjs',import.meta.url),'utf8');
// 오프라인 화면·설치 안내가 함께 불러오는 shell.mjs가 / 범위 메인 워커를 등록하는지 본다
function run({secure=true,serviceWorker=true,fail=false}={}){
 const calls=[];
 const node=()=>({setAttribute(){},getAttribute(){return 'false';},addEventListener(){}});
 const navigator=serviceWorker?{serviceWorker:{register:(url,options)=>{calls.push({url,scope:options?.scope});return fail?Promise.reject(new Error('blocked')):Promise.resolve({});}}}:{};
 const context=vm.createContext({window:{isSecureContext:secure},navigator,
  document:{getElementById:node,documentElement:{dataset:{}}},localStorage:{getItem:()=>null,setItem(){}}});
 vm.runInContext(source,context);
 return calls;
}
test('offline pages register the main worker for the whole app scope',()=>{
 assert.deepEqual(run(),[{url:'/sw.js',scope:'/'}]);
});
test('main worker is not registered without a secure context or service worker support',()=>{
 assert.deepEqual(run({secure:false}),[]);
 assert.deepEqual(run({serviceWorker:false}),[]);
});
test('a failed main worker registration does not throw',async()=>{
 assert.deepEqual(run({fail:true}),[{url:'/sw.js',scope:'/'}]);
 await new Promise(resolve=>setTimeout(resolve,0));
});
