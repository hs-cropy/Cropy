import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../public/offline/app.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function setup(){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',classList:{toggle(){}},addEventListener(){}});return nodes.get(id);};
 const result={disease_name:'test',confidence:1,decision_reasons:[],top_predictions:[],causes:[],prevention:[],recapture:null};
 const context=vm.createContext({$,escape:String,busy:false,current:null,selected:{name:'new.jpg'},bundle:{version:'v1'},
 crypto:{randomUUID:()=> 'new-record'},setBusy(v){context.busy=v;},async predict(){return [];},summarize(){return result;},
 async storeRecord(record){context.result(record);return true;},message:e=>e.message,
 notices:[],notice(where,name){context.notices.push([where,name]);},toast(){}});
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
test('an inference failure shows the analysis-failed card and keeps the photo',async()=>{
 const h=setup();h.context.predict=async()=>{throw new Error('inference failed');};await h.context.diagnose();
 assert.deepEqual(h.context.notices.at(-1),['analyze','local-analysis-failed']);
 assert.equal(h.$('state').textContent,'');assert.equal(h.context.selected.name,'new.jpg');
 assert.equal(h.context.retryAnalysis,h.context.diagnose);
});
test('a rejected photo is explained in text without the analysis-failed card',async()=>{
 const h=setup();h.context.predict=async()=>{throw Object.assign(new Error('JPEG 또는 PNG 사진을 선택해 주세요.'),{input:true});};
 await h.context.diagnose();
 assert.deepEqual(h.context.notices,[['analyze',null]]);assert.match(h.$('state').textContent,/JPEG/);
});
function setupHeader({view,desktop=false,savedId=null,current=null,phase}){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,open:false,dataset:{phase},classList:{toggle(){}}});return nodes.get(id);};
 const context=vm.createContext({$,view,desktop,savedId,current,document:{activeElement:null}});
 vm.runInContext(source.slice(source.indexOf('const PHASES = {'),source.indexOf('function notice('))+
  source.slice(source.indexOf('function show('),source.indexOf('function setBusy('))+';globalThis.notices=notices;',context);
 const header=()=>{context.renderHeader();return {label:$('phase-label').hidden?null:$('phase-label').textContent,lead:$('phase-lead').textContent};};
 return {context,$,header};
}
test('the paused header asks for a connection on phone and PC',()=>{
 for(const desktop of [false,true]) assert.deepEqual(setupHeader({view:'prepare',desktop,phase:'paused'}).header(),
  {label:'연결 필요',lead:'필수 파일을 모두 받은 뒤 오프라인으로 사용할 수 있어요.'});
});
test('the verifying header uses the PC wording only on a PC',()=>{
 assert.equal(setupHeader({view:'prepare',phase:'verifying'}).header().lead,'파일을 확인한 뒤 오프라인 준비가 완료돼요.');
 assert.equal(setupHeader({view:'prepare',desktop:true,phase:'verifying'}).header().lead,'확인이 끝나면 오프라인 준비가 완료돼요.');
 for(const [desktop,place] of [[false,'이 기기에서'],[true,'이 PC에서']]){
  const h=setupHeader({view:'prepare',desktop});h.context.show('verifying');
  assert.match(h.$('ready').textContent,new RegExp(place));
 }
});
test('a fresh local save labels the analyze and records headers unless a notice is up',()=>{
 for(const view of ['analyze','records']){
  const h=setupHeader({view,savedId:'new',current:{id:'new'}});
  assert.deepEqual(h.header(),{label:'기기 저장 완료',lead:{analyze:'사진은 이 기기에서 분석돼요.',records:'인터넷 없이도 이 기기에 저장된 기록을 볼 수 있어요.'}[view]});
  h.context.notices[view]='sync-failed';assert.equal(h.header().label,'서버 동기화 실패');
  h.context.notices[view]=null;h.context.savedId=null;assert.equal(h.header().label,null);
 }
 assert.equal(setupHeader({view:'prepare',savedId:'new',phase:'ready'}).header().label,'오프라인 준비 완료');
});
test('viewing an older record result drops the saved label, the records list keeps it',()=>{
 assert.equal(setupHeader({view:'analyze',savedId:'new',current:{id:'old'}}).header().label,null);
 assert.equal(setupHeader({view:'records',savedId:'new',current:{id:'old'}}).header().label,'기기 저장 완료');
});
for(const failure of ['model','asset read']){
 test('history loads independently after '+failure+' failure',async()=>{
  let historyCalls=0;const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  const context=vm.createContext({$,bundle:null,session:null,URLSearchParams,location:{search:''},
   async db(){if(failure==='asset read')throw new Error('asset read failed');return {manifest:{},model:[]};},
   async initSession(){throw new Error('model failed');},async history(){historyCalls++;},message:e=>e.message,setBusy(){},show(){},route(){},checkUpdate(){}});
  await vm.runInContext('(async()=>{'+source.slice(source.lastIndexOf('\ntry {'))+'})()',context);
  assert.equal(historyCalls,1);assert.match($('ready').textContent,/failed/);
 });
}
