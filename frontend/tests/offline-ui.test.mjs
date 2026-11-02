import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../public/offline/app.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function setup(){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',classList:{toggle(){}},addEventListener(){}});return nodes.get(id);};
 const result={disease_name:'test',confidence:1,decision_reasons:[],top_predictions:[],causes:[],prevention:[],recapture:null};
 const context=vm.createContext({$,busy:false,current:null,selected:{name:'new.jpg'},bundle:{version:'v1'},
 crypto:{randomUUID:()=> 'new-record'},setBusy(v){context.busy=v;},async predict(){return [];},summarize(){return result;},
 async storeRecord(record){context.result(record);return true;},message:e=>e.message});
 const escapeLine = source.split('\n').find(
  line => line.startsWith('const escape ='),
 );
 assert.ok(escapeLine, 'app.mjs의 escape 함수를 찾을 수 없습니다');
 vm.runInContext(escapeLine, context);
 vm.runInContext(source.slice(source.indexOf('function result('),source.indexOf('async function storeRecord('))+
 source.slice(source.indexOf('async function diagnose('),source.indexOf('async function refine(')),context);
 return {context,$,record:id=>({id,result,saved:true})};
}
test('switching records clears the previous second photo',()=>{
 const h=setup();h.context.result(h.record('old'));h.$('second').value='old-second.jpg';
 h.context.result(h.record('new'));assert.equal(h.$('second').value,'');
});
test('rendering the same record preserves its selected second photo',()=>{
 const h=setup();h.context.result(h.record('same'));h.$('second').value='selected.jpg';
 h.context.result(h.record('same'));assert.equal(h.$('second').value,'selected.jpg');
});
test('starting a diagnosis clears the second photo even if inference fails',async()=>{
 const h=setup();h.context.result(h.record('old'));h.$('second').value='old-second.jpg';
 h.context.predict=async()=>{throw new Error('inference failed');};await h.context.diagnose();
 assert.equal(h.$('second').value,'');
});
for(const failure of ['model','asset read']){
 test('history loads independently after '+failure+' failure',async()=>{
  let historyCalls=0;const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  const context=vm.createContext({$,bundle:null,session:null,
   async db(){if(failure==='asset read')throw new Error('asset read failed');return {manifest:{},model:[]};},
   async initSession(){throw new Error('model failed');},async history(){historyCalls++;},message:e=>e.message,setBusy(){}});
  await vm.runInContext('(async()=>{'+source.slice(source.lastIndexOf('\ntry {'))+'})()',context);
  assert.equal(historyCalls,1);assert.match($('ready').textContent,/failed/);
 });
}
test('result renders summary and matching action descriptions', () => {
 const h = setup();
 const record = h.record('guidance');
 record.result = {
  ...record.result,
  summary_message: '한 줄 테스트 안내',
  management_actions: ['첫 번째 행동', '두 번째 행동'],
  management_action_details: [
   {title: '첫 번째 행동', description: '첫 번째 상세 설명'},
   {title: '두 번째 행동', description: '두 번째 상세 설명'},
  ],
 };

 h.context.result(record);
 const html = h.$('result').innerHTML;

 assert.ok(html.includes('한 줄 테스트 안내'));
 assert.ok(html.includes('첫 번째 상세 설명'));
 assert.ok(html.includes('두 번째 상세 설명'));
 assert.ok(html.indexOf('첫 번째 행동') < html.indexOf('두 번째 행동'));
});

test('legacy result keeps action titles without guidance fields', () => {
 const h = setup();
 const record = h.record('legacy');
 record.result = {
  ...record.result,
  management_actions: ['이전 기록 행동'],
 };

 h.context.result(record);
 const html = h.$('result').innerHTML;

 assert.ok(html.includes('이전 기록 행동'));
 assert.ok(!html.includes('undefined'));
 assert.ok(!html.includes('null'));
});

test('result does not attach descriptions with mismatched titles', () => {
 const h = setup();
 const record = h.record('mismatch');
 record.result = {
  ...record.result,
  management_actions: ['원래 행동'],
  management_action_details: [
   {title: '다른 행동', description: '표시하면 안 되는 설명'},
  ],
 };

 h.context.result(record);
 const html = h.$('result').innerHTML;

 assert.ok(html.includes('원래 행동'));
 assert.ok(!html.includes('다른 행동'));
 assert.ok(!html.includes('표시하면 안 되는 설명'));
});

test('result escapes HTML in summary, action titles and descriptions', () => {
 const h = setup();
 const record = h.record('escaped');
 record.result = {
  ...record.result,
  summary_message: '<script>alert("summary")</script>',
  management_actions: ['<b>행동</b>'],
  management_action_details: [
   {title: '<b>행동</b>', description: '<img src=x onerror=alert(1)>'},
  ],
 };

 h.context.result(record);
 const html = h.$('result').innerHTML;

 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes('&lt;b&gt;행동&lt;/b&gt;'));
 assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('<b>행동</b>'));
 assert.ok(!html.includes('<img'));
});