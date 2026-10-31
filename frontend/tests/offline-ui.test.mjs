import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {gradeOf,resultTimeSentence,recordTime} from '../public/offline/core.mjs';
const source=(await readFile(new URL('../public/offline/app.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
// app.mjs 의 실제 escape (결과 HTML 테스트용)
const escapeHtml=vm.runInNewContext(source.match(/const escape = (.*);\n/)[1]);
function setup({escape=String}={}){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,classList:{toggle(){},add(){}},addEventListener(){},replaceChildren(){this.innerHTML='';},focus(){}});return nodes.get(id);};
 const result={disease_name:'test',confidence:1,decision_reasons:[],top_predictions:[],causes:[],prevention:[],recapture:null};
 const urls={made:[],revoked:[]};
 const context=vm.createContext({$,escape,busy:false,current:null,selected:{name:'new.jpg'},bundle:{version:'v1'},
 crypto:{randomUUID:()=> 'new-record'},setBusy(v){context.busy=v;},async predict(){return [];},summarize(){return result;},
 async storeRecord(record){context.result(record);return true;},message:e=>e.message,
 notices:[],notice(where,name){context.notices.push([where,name]);},toast(){},renderHeader(){},view:'analyze',document:{activeElement:null,body:{}},
 gradeOf,recordTime,URL:{createObjectURL(file){const url='blob:'+file.name;urls.made.push(url);return url;},revokeObjectURL(url){urls.revoked.push(url);}}});
 vm.runInContext(source.slice(source.indexOf('function result('),source.indexOf('async function storeRecord('))+
 source.slice(source.indexOf('async function diagnose('),source.indexOf('async function refine(')),context);
 return {context,$,urls,record:(id,extra={})=>({id,result,saved:true,...extra})};
}
const full={disease_name:'고추 탄저병',confidence:.914,crop_type:'고추',severity:'high',category:'disease',decision_reasons:[],
 top_predictions:[{name:'고추 탄저병',confidence:.914},{name:'고추 정상',confidence:.05}],description:'열매에 병반이 생겨요.',
 causes:['고온 다습'],prevention:['병든 과실 제거'],management_actions:['병든 과실 즉시 제거·소각','통풍·배수 관리'],recapture:null};
test('the result shows the summary, grade badge, actions and details like the online result',()=>{
 const h=setup();h.context.result({id:'r',saved:true,created_at:'2026-10-22T10:25:00',result:full});
 const html=h.$('result').innerHTML;
 assert.match(html,/AI 진단 결과/);assert.match(html,/<span class="badge attention"><span class="sr-only">위험 등급 <\/span>위험<\/span>/);
 assert.match(html,/신뢰도 91%/);assert.match(html,/지금 해야 할 일/);assert.match(html,/2가지/);
 assert.match(html,/<summary>증상/);assert.match(html,/<summary>원인/);assert.match(html,/<summary>예방법/);
 assert.match(html,/2026\.10\.22 · 10:25/);assert.match(html,/이 기기에 저장했어요/);
 // 후보 목록과 등록 농약은 없다 (온라인 결과와 같다 · 농약은 오프라인 묶음에 없다)
 assert.doesNotMatch(html,/고추 정상/);assert.doesNotMatch(html,/농약/);
});
test('grade badges follow the online mapping and missing details fall back to a message',()=>{
 for(const [extra,badge] of [[{severity:'medium'},'attention">.*주의'],[{severity:'low'},'low">.*낮음'],[{category:'normal',severity:'high'},'low">.*정상'],[{category:'healthy'},'low">.*정상']]){
  const h=setup();h.context.result(h.record('r',{result:{...full,category:'disease',severity:undefined,...extra}}));
  assert.match(h.$('result').innerHTML,new RegExp('badge '+badge));
 }
 const h=setup();h.context.result(h.record('bare'));const html=h.$('result').innerHTML;
 assert.doesNotMatch(html,/class="badge/);assert.doesNotMatch(html,/지금 해야 할 일/);
 assert.match(html,/증상 설명을 확인할 수 없어요/);assert.match(html,/발병 원인 정보를 확인할 수 없어요/);
});
test('low confidence, crop mismatch and a pending second photo get their notices',()=>{
 const h=setup();h.context.result(h.record('r',{result:{...full,decision_reasons:['crop_mismatch','low_confidence'],crop_mismatch:true,selected_crop:'무',predicted_crop:'고추',
  recapture:{instruction:'잎 뒷면을 찍어주세요.',candidates:[]}}}));
 const html=h.$('result').innerHTML;
 assert.match(html,/선택한 작물은 무이지만 사진은 고추로 분류됐어요/);assert.match(html,/사진만으로는 확실하지 않아요/);assert.match(html,/추가 촬영 안내가 있어요/);
 // 서버에 보내 두 번째 사진으로 확인할 수 없으면 후보가 비슷하다는 안내만 남는다
 h.context.result(h.record('r',{sync_attempted:true,result:{...full,decision_reasons:['confusion'],recapture:{instruction:'',candidates:[]}}}));
 assert.doesNotMatch(h.$('result').innerHTML,/추가 촬영 안내가 있어요/);assert.match(h.$('result').innerHTML,/후보가 비슷해 추가 확인이 필요해요/);
});
test('clearing the result also clears the leftover status text',()=>{
 const h=setup();h.context.result(h.record('r'));h.$('state').textContent='저장 공간이 부족해요.';h.context.clearResult();
 assert.equal(h.$('state').textContent,'');
});
test('result text is escaped',()=>{
 const h=setup({escape:escapeHtml});h.context.result(h.record('r',{result:{...full,disease_name:'<img src=x onerror=alert(1)>'}}));
 assert.doesNotMatch(h.$('result').innerHTML,/<img src=x/);
});
test('result photos are made once per photo and released when the result is cleared',()=>{
 const h=setup(),file={name:'a.jpg'},second={name:'b.jpg'};
 h.context.result(h.record('r',{file}));h.context.result(h.record('r',{file}));
 assert.deepEqual(h.urls.made,['blob:a.jpg']);assert.deepEqual(h.urls.revoked,[]);
 h.context.result(h.record('r',{file,refined_file:second}));
 assert.deepEqual(h.urls.revoked,['blob:a.jpg']);assert.match(h.$('result').innerHTML,/판별부위 재촬영/);
 h.context.clearResult();
 assert.deepEqual(h.urls.revoked,['blob:a.jpg','blob:a.jpg','blob:b.jpg']);assert.equal(h.context.current,null);
});
test('the analyze screen shows the photo picker, the result or the failure card, one at a time',()=>{
 const h=setup();h.$('analyze-card').hidden=true;h.context.result(h.record('r'));
 assert.equal(h.$('result-view').hidden,false);assert.equal(h.$('diagnosis').hidden,true);
 h.$('analyze-card').hidden=false;h.context.syncAnalyzeView();
 assert.equal(h.$('result-view').hidden,true);assert.equal(h.$('diagnosis').hidden,true);
 h.$('analyze-card').hidden=true;h.context.clearResult();
 assert.equal(h.$('result-view').hidden,true);assert.equal(h.$('diagnosis').hidden,false);assert.equal(h.$('second').value,'');
});
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
 const context=vm.createContext({$,view,desktop,savedId,current,document:{activeElement:null},resultTimeSentence});
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
  assert.deepEqual(h.header(),{label:'기기 저장 완료',lead:{analyze:'진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.',records:'인터넷 없이도 이 기기에 저장된 기록을 볼 수 있어요.'}[view]});
  h.context.notices[view]='sync-failed';assert.equal(h.header().label,'서버 동기화 실패');
  h.context.notices[view]=null;h.context.savedId=null;assert.equal(h.header().label,null);
 }
 assert.equal(setupHeader({view:'prepare',savedId:'new',phase:'ready'}).header().label,'오프라인 준비 완료');
});
test('a result on the analyze screen switches the header to the diagnosis result',()=>{
 const h=setupHeader({view:'analyze',current:{id:'r',created_at:'2026-10-06T14:18:00'}});
 assert.deepEqual(h.header(),{label:null,lead:'진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.'});
 assert.equal(h.$('view-title').textContent,'진단 결과');assert.equal(h.$('page-head').dataset.mode,'result');
 assert.equal(h.$('phase-lead-wide').textContent,'2026년 10월 6일 오후 2:18에 확인한 결과예요.');
 h.context.current={id:'r'};h.header();assert.equal(h.$('phase-lead-wide').textContent,'진단 요약을 확인하고, 아래 관리 방법을 참고해주세요.');
 // 분석 실패 카드가 떠 있으면 카드의 머리, 결과가 없으면 사진 분석이다
 h.context.notices.analyze='local-analysis-failed';assert.equal(h.header().label,'기기 내 분석 오류');assert.equal(h.$('view-title').textContent,'사진 분석');
 h.context.notices.analyze=null;h.context.current=null;h.header();
 assert.equal(h.$('view-title').textContent,'사진 분석');assert.equal(h.$('page-head').dataset.mode,'');
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
