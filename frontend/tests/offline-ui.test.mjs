import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {gradeOf,isNotCrop,resultTimeSentence,recordTime} from '../public/offline/core.mjs';
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
 notices:{new:null,result:null,records:null},calls:[],notice(where,name){context.calls.push([where,name]);context.notices[where]=name;},toasts:[],toast(text){context.toasts.push(text);},say(text){$('state').textContent=text;},renderHeader(){},view:'new',document:{activeElement:null,body:{}},
 went:[],go(name){context.went.push(name);context.view=name;},resets:0,resetPhoto(){context.resets++;context.selected=null;},secondRoles(){},
 gradeOf,isNotCrop,recordTime,URL:{createObjectURL(file){const url='blob:'+file.name;urls.made.push(url);return url;},revokeObjectURL(url){urls.revoked.push(url);}}});
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
test('a not-crop result shows how to retake instead of a disease result',()=>{
 const h=setup({escape:escapeHtml}),file={name:'a.jpg'};
 h.context.result(h.record('r',{file,result:{...full,category:'other',disease_name:'판별 불가',severity:null,decision_reasons:['not_crop'],crop_type:null,management_actions:['잎 가까이 찍기'],confidence:.42}}));
 const html=h.$('result').innerHTML;
 assert.match(html,/잎이 잘 보이게 다시 찍어 주세요/);assert.match(html,/이 기기에 저장했어요/);assert.match(html,/blob:a\.jpg/);
 for(const hidden of [/42%/,/class="badge/,/지금 해야 할 일/,/상세 정보/,/판별 불가/])assert.doesNotMatch(html,hidden);
 assert.equal(h.$('new-photo').textContent,'다시 촬영하기');
 h.context.result(h.record('n',{result:full}));assert.equal(h.$('new-photo').textContent,'새 사진으로 진단하기');
});
test('status text scrolls into view on the new diagnosis and result screens and toasts elsewhere',()=>{
 const run=view=>{const state={textContent:'',scrollIntoView(){this.scrolled=true;}},toasts=[];
  const context=vm.createContext({$:()=>state,view,toast(text){toasts.push(text);}});
  vm.runInContext(source.slice(source.indexOf('function say('),source.indexOf('// actions 를 주면')),context);
  context.say('문구');return {state,toasts};};
 for(const view of ['new','result']){const shown=run(view);assert.equal(shown.state.scrolled,true);assert.deepEqual(shown.toasts,[]);assert.equal(shown.state.textContent,'문구');}
 const records=run('records');assert.equal(records.state.scrolled,undefined);assert.deepEqual(records.toasts,['문구']);assert.equal(records.state.textContent,'문구');
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
test('the new diagnosis screen shows the photo picker and the result screen the result or the empty state',()=>{
 const h=setup(),shown=()=>['diagnosis','result-view','result-empty','analyze-card'].filter(id=>!h.$(id).hidden);
 h.context.syncAnalyzeView();assert.deepEqual(shown(),['diagnosis']);
 h.context.result(h.record('r'));assert.deepEqual(shown(),['diagnosis']);
 h.context.view='result';h.context.syncAnalyzeView();assert.deepEqual(shown(),['result-view']);
 h.context.clearResult();assert.deepEqual(shown(),['result-empty']);assert.equal(h.$('second').value,'');
 // 분석 실패 카드는 그 화면에서만 보이고, 떠 있으면 카드만 보인다
 h.context.notices.new='local-analysis-failed';h.context.syncAnalyzeView();assert.deepEqual(shown(),['result-empty']);
 h.context.view='new';h.context.syncAnalyzeView();assert.deepEqual(shown(),['analyze-card']);
 h.context.view='records';h.context.syncAnalyzeView();assert.deepEqual(shown(),[]);
});
test('a finished diagnosis moves to the result screen and clears the photo, unless the user left for another screen',async()=>{
 const h=setup();await h.context.diagnose();
 assert.deepEqual(h.context.went,['result']);assert.equal(h.context.resets,1);assert.equal(h.context.current.id,'new-record');
 const away=setup();away.context.view='records';await away.context.diagnose();
 assert.deepEqual(away.context.went,[]);assert.equal(away.context.current.id,'new-record');
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
test('an inference failure shows the analysis-failed card on the new diagnosis screen and keeps the photo',async()=>{
 const h=setup();h.context.predict=async()=>{throw new Error('inference failed');};await h.context.diagnose();
 assert.deepEqual(h.context.calls.at(-1),['new','local-analysis-failed']);
 assert.equal(h.$('state').textContent,'');assert.equal(h.context.selected.name,'new.jpg');
 assert.deepEqual(h.context.went,[]);assert.equal(h.context.resets,0);
});
test('a failure while on another tab is toasted and its card waits on the new diagnosis screen',async()=>{
 const h=setup();h.context.view='records';h.context.predict=async()=>{throw new Error('inference failed');};await h.context.diagnose();
 assert.equal(h.context.notices.new,'local-analysis-failed');assert.deepEqual(h.context.toasts,['이 기기에서 분석하지 못했어요.']);
 const here=setup();here.context.predict=h.context.predict;await here.context.diagnose();assert.deepEqual(here.context.toasts,[]);
});
test('a new or cleared result drops the second-photo failure card of the previous result',()=>{
 const h=setup();h.context.view='result';h.context.result(h.record('old'));
 h.context.notices.result='local-analysis-failed';h.context.result(h.record('old'));assert.equal(h.context.notices.result,'local-analysis-failed');
 h.context.result(h.record('new'));assert.equal(h.context.notices.result,null);assert.equal(h.$('result-view').hidden,false);
 h.context.notices.result='local-analysis-failed';h.context.clearResult();assert.equal(h.context.notices.result,null);assert.equal(h.$('result-empty').hidden,false);
});
test('a rejected photo is explained in text without the analysis-failed card',async()=>{
 const h=setup();h.context.predict=async()=>{throw Object.assign(new Error('JPEG 또는 PNG 사진을 선택해 주세요.'),{input:true});};
 await h.context.diagnose();
 assert.deepEqual(h.context.calls,[['new',null]]);assert.match(h.$('state').textContent,/JPEG/);
});
function setupHeader({view,desktop=false,savedId=null,current=null,phase}){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,open:false,dataset:{phase},classList:{toggle(){}}});return nodes.get(id);};
 const context=vm.createContext({$,view,desktop,savedId,current,document:{activeElement:null},resultTimeSentence,isNotCrop,renderConnection(){}});
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
test('a fresh local save labels the result and records headers unless a notice is up',()=>{
 for(const view of ['result','records']){
  const h=setupHeader({view,savedId:'new',current:{id:'new'}});
  assert.deepEqual(h.header(),{label:'기기 저장 완료',lead:{result:'진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.',records:'인터넷 없이도 이 기기에 저장된 기록을 볼 수 있어요.'}[view]});
  h.context.notices[view]='sync-failed';assert.equal(h.header().label,'서버 동기화 실패');
  h.context.notices[view]=null;h.context.savedId=null;assert.equal(h.header().label,null);
 }
 assert.equal(setupHeader({view:'prepare',savedId:'new',phase:'ready'}).header().label,'오프라인 준비 완료');
 // 새 진단 화면은 저장 완료를 보이지 않는다 (결과는 진단 결과 화면에 있다)
 assert.equal(setupHeader({view:'new',savedId:'new',current:{id:'new'}}).header().label,null);
});
test('a result on the result screen switches the header to the diagnosis result',()=>{
 const h=setupHeader({view:'result',current:{id:'r',created_at:'2026-10-06T14:18:00'}});
 assert.deepEqual(h.header(),{label:null,lead:'진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.'});
 assert.equal(h.$('view-title').textContent,'진단 결과');assert.equal(h.$('page-head').dataset.mode,'result');
 assert.equal(h.$('phase-lead-wide').textContent,'2026년 10월 6일 오후 2:18에 확인한 결과예요.');
 h.context.current={id:'r'};h.header();assert.equal(h.$('phase-lead-wide').textContent,'진단 요약을 확인하고, 아래 관리 방법을 참고해주세요.');
 // 추가 사진 확인 실패 카드가 떠 있으면 카드의 라벨이고 제목은 진단 결과다. 결과가 없으면 진단 시작 안내다
 h.context.notices.result='local-analysis-failed';assert.equal(h.header().label,'기기 내 분석 오류');assert.equal(h.$('view-title').textContent,'진단 결과');
 assert.equal(h.$('page-head').dataset.mode,'');
 h.context.notices.result=null;h.context.current=null;
 assert.deepEqual(h.header(),{label:null,lead:'사진을 찍거나 선택하면\n진단 결과와 관리 방법을 볼 수 있어요.'});
 assert.equal(h.$('view-title').textContent,'진단 시작');assert.equal(h.$('page-head').dataset.mode,'');
});
test('the new diagnosis header stays the same with a result and shows its failure card',()=>{
 const h=setupHeader({view:'new',current:{id:'r'}});
 assert.deepEqual(h.header(),{label:null,lead:'사진은 이 기기에서 분석돼요.'});assert.equal(h.$('view-title').textContent,'새 진단');
 h.context.notices.new='local-analysis-failed';assert.equal(h.header().label,'기기 내 분석 오류');assert.equal(h.$('view-title').textContent,'새 진단');
});
test('a not-crop result switches the header to the retake guidance',()=>{
 const h=setupHeader({view:'result',current:{id:'r',created_at:'2026-10-06T14:18:00',result:{category:'other'}}});
 assert.deepEqual(h.header(),{label:null,lead:'고추·무·배추 잎으로 알아보기 어려운 사진이에요.'});
 assert.equal(h.$('view-title').textContent,'작물 잎을 찾지 못했어요');assert.equal(h.$('phase-lead-wide').textContent,'고추·무·배추 잎으로 알아보기 어려운 사진이에요.');
 assert.equal(h.$('head-mascot').src,'/mascot/retake.png');
});
test('viewing an older record result drops the saved label, the records list keeps it',()=>{
 assert.equal(setupHeader({view:'result',savedId:'new',current:{id:'old'}}).header().label,null);
 assert.equal(setupHeader({view:'records',savedId:'new',current:{id:'old'}}).header().label,'기기 저장 완료');
});
for(const failure of ['model','asset read']){
 test('history loads independently after '+failure+' failure',async()=>{
  let historyCalls=0;const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  const context=vm.createContext({$,bundle:null,session:null,URLSearchParams,location:{search:''},
   async db(){if(failure==='asset read')throw new Error('asset read failed');return {manifest:{},model:[]};},
   async initSession(){throw new Error('model failed');},async history(){historyCalls++;},message:e=>e.message,setBusy(){},show(){},route(){},checkUpdate(){},async renderVoiceBundle(){},checkConnection(){}});
  await vm.runInContext('(async()=>{'+source.slice(source.lastIndexOf('\ntry {'))+'})()',context);
  assert.equal(historyCalls,1);assert.match($('ready').textContent,/failed/);
 });
}
test('result renders summary and matching action descriptions', () => {
  const h = setup({escape: escapeHtml});
  h.context.result(h.record('guidance', {
    result: {
      ...full,
      summary_message: '아래 관리 방법을 참고하세요.',
      management_actions: ['감염 부위 제거', '통풍 관리'],
      management_action_details: [
        {title: '감염 부위 제거', description: '증상이 있는 부위를 확인해 주세요.'},
        {title: '통풍 관리', description: '바람이 통하도록 관리해 주세요.'},
      ],
    },
  }));

  const html = h.$('result').innerHTML;
  assert.match(html, /아래 관리 방법을 참고하세요/);
  assert.match(html, /증상이 있는 부위를 확인해 주세요/);
  assert.match(html, /바람이 통하도록 관리해 주세요/);
  assert.ok(html.indexOf('감염 부위 제거') < html.indexOf('통풍 관리'));
});

test('legacy result keeps action titles without guidance fields', () => {
  const h = setup({escape: escapeHtml});
  h.context.result(h.record('legacy', {result: {...full}}));

  const html = h.$('result').innerHTML;
  for (const title of full.management_actions) {
    assert.ok(html.includes(escapeHtml(title)));
  }
  assert.match(html, /진단 요약을 확인하고, 아래 관리 방법을 참고해주세요/);
  assert.doesNotMatch(html, /undefined|null/);
});

test('result does not attach descriptions with mismatched titles', () => {
  const h = setup({escape: escapeHtml});
  h.context.result(h.record('mismatch', {
    result: {
      ...full,
      management_actions: ['감염 부위 제거', '통풍 관리'],
      management_action_details: [
        {title: '다른 제목', description: '표시하면 안 되는 설명'},
        {title: '통풍 관리', description: '일치하는 설명'},
        {title: '제목 없는 추가 항목', description: '추가하면 안 되는 설명'},
      ],
    },
  }));

  const html = h.$('result').innerHTML;
  assert.match(html, /감염 부위 제거/);
  assert.match(html, /일치하는 설명/);
  assert.doesNotMatch(html, /표시하면 안 되는 설명|추가하면 안 되는 설명/);
});

test('result escapes HTML in summary, action titles and descriptions', () => {
  const h = setup({escape: escapeHtml});
  const summary = '<script>alert(1)</script>';
  const title = '<b>감염 부위 제거</b>';
  const description = '<img src=x onerror=alert(1)>';

  h.context.result(h.record('escaped', {
    result: {
      ...full,
      summary_message: summary,
      management_actions: [title],
      management_action_details: [{title, description}],
    },
  }));

  const html = h.$('result').innerHTML;
  for (const text of [summary, title, description]) {
    assert.ok(html.includes(escapeHtml(text)));
    assert.ok(!html.includes(text));
  }
});

test('not-crop result keeps retake guidance instead of management guidance', () => {
  const h = setup({escape: escapeHtml});
  h.context.result(h.record('not-crop', {
    result: {
      ...full,
      category: 'other',
      severity: null,
      summary_message: '노출되면 안 되는 관리 요약',
      management_actions: ['노출되면 안 되는 행동'],
      management_action_details: [
        {title: '노출되면 안 되는 행동', description: '노출되면 안 되는 설명'},
      ],
    },
  }));

  const html = h.$('result').innerHTML;
  assert.match(html, /잎이 잘 보이게 다시 찍어 주세요/);
  assert.doesNotMatch(html, /노출되면 안 되는/);
});

const offlineHtml=(await readFile(new URL('../public/offline/index.html',import.meta.url),'utf8')).replaceAll('\r\n','\n');
test('photo and second-photo pickers each have a gallery input and a camera input, both hidden behind buttons',()=>{
 const inputs=Object.fromEntries((offlineHtml.match(/<input[^>]*type="file"[^>]*>/g)??[]).map(tag=>[tag.match(/id="([^"]+)"/)[1],tag]));
 assert.deepEqual(Object.keys(inputs).sort(),['file','file-camera','second','second-camera']);
 // capture 가 없으면 안드로이드는 갤러리만, capture 가 있으면 카메라를 바로 연다
 for(const id of ['file','second'])assert.doesNotMatch(inputs[id],/\scapture\b/);
 for(const id of ['file-camera','second-camera'])assert.match(inputs[id],/\scapture="environment"/);
 for(const tag of Object.values(inputs)){
  assert.match(tag,/accept="image\/jpeg,image\/png"/);assert.match(tag,/class="sr-only"/);assert.match(tag,/tabindex="-1"/);assert.match(tag,/aria-label="[^"]+"/);
 }
});
test('the photo picker follows the online new diagnosis screen (M-01-0) without the online size limit',()=>{
 for(const text of ['진단할 사진을 선택해주세요','>사진 선택하기<','>카메라로 촬영<','>이 기기에서 진단하기<','>다른 사진 선택하기<','>추가 사진 촬영<','>갤러리에서 선택<','>두 사진으로 다시 확인<'])
  assert.ok(offlineHtml.includes(text),text);
 // 오프라인 묶음의 용량 제한은 온라인(100 MB)과 다르다
 assert.doesNotMatch(offlineHtml,/100\s?MB/);
 // 진단 시작·새 진단은 고르는 창을 바로 열지 않는다 (갤러리·카메라를 사용자가 고른다)
 assert.match(source,/\$\('start'\)\.addEventListener\('click',\(\)=>go\('new'\)\);/);
 const startNew=source.slice(source.indexOf('function startNew(){'),source.indexOf("$('new-photo').addEventListener"));
 assert.doesNotMatch(startNew,/\.click\(\)/);
});
// app.mjs 의 사진 고르기 부분만 가짜 DOM 에서 돌린다
function pickerSetup({desktop=false}={}){
 const nodes=new Map(),clicks=[],urls={made:[],revoked:[]};
 const $=id=>{if(!nodes.has(id)){const classes=new Set(id==='second-pick-gallery'?['secondary']:[]);const listeners={};
  nodes.set(id,{id,value:'',files:[],hidden:false,textContent:'',src:'',disabled:false,classes,listeners,
   classList:{toggle(name,force){const on=force??!classes.has(name);if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
   addEventListener(type,fn){listeners[type]=fn;},click(){clicks.push(id);}});}
  return nodes.get(id);};
 const body={},focus=[];
 const context=vm.createContext({$,desktop,busy:false,selected:null,savedId:null,previewUrl:undefined,photoSource:'gallery',secondFile:null,secondSource:'camera',
  view:'new',went:[],go(name){context.went.push(name);context.view=name;},notices:[],notice(where,name){context.notices.push([where,name]);},
  document:{body,activeElement:body},focus,
  setBusy(){},diagnose(){},refine(){},URL:{createObjectURL(file){const url='blob:'+file.name;urls.made.push(url);return url;},revokeObjectURL(url){urls.revoked.push(url);}}});
 for(const id of ['diagnose','diagnosis-title'])$(id).focus=()=>focus.push(id);
 const start=source.indexOf('const pickPhoto'),end=source.indexOf("$('new-photo').addEventListener");
 assert.ok(start>0&&end>start,'picker block boundaries');
 vm.runInContext(source.slice(start,end),context);
 const fire=(id,type='click')=>nodes.get(id).listeners[type]();
 const choose=(id,file)=>{$(id).files=file?[file]:[];$(id).value=file?'C:\\fakepath\\'+file.name:'';fire(id,'change');};
 return {context,$,clicks,urls,fire,choose};
}
test('picker buttons open the gallery or the camera input, and "다른 사진" reopens where the photo came from',()=>{
 const h=pickerSetup();
 h.fire('pick-gallery');h.fire('dropzone');h.fire('pick-camera');
 assert.deepEqual(h.clicks,['file','file','file-camera']);
 h.choose('file-camera',{name:'cam.jpg'});
 assert.equal(h.context.selected.name,'cam.jpg');assert.equal(h.context.photoSource,'camera');
 // 같은 사진을 다시 골라도 change 가 오게 입력을 비운다
 assert.equal(h.$('file-camera').value,'');
 assert.equal(h.$('pick-again').textContent,'다른 사진 촬영하기');
 assert.equal(h.$('preview').src,'blob:cam.jpg');assert.equal(h.$('dropzone').hidden,true);
 assert.ok(h.$('pick-actions').classList.contains('hidden'));assert.ok(!h.$('selected-actions').classList.contains('hidden'));
 h.clicks.length=0;h.fire('pick-again');assert.deepEqual(h.clicks,['file-camera']);
 h.choose('file',{name:'gal.jpg'});assert.equal(h.$('pick-again').textContent,'다른 사진 선택하기');
 h.clicks.length=0;h.fire('pick-again');assert.deepEqual(h.clicks,['file']);
 assert.deepEqual(h.urls.revoked,['blob:cam.jpg']);
});
test('after choosing a photo, focus moves from the hidden picker button to the diagnose button',()=>{
 const h=pickerSetup();h.choose('file',{name:'a.jpg'});
 assert.deepEqual(h.context.focus,['diagnose']);
 // 아직 진단할 수 없으면(모델 준비 전) 카드 제목으로
 const off=pickerSetup();off.$('diagnose').disabled=true;off.choose('file-camera',{name:'b.jpg'});
 assert.deepEqual(off.context.focus,['diagnosis-title']);
 // 다른 곳에 포커스가 있으면 건드리지 않는다
 const kept=pickerSetup();kept.context.document.activeElement={closest:()=>null};kept.choose('file',{name:'c.jpg'});
 assert.deepEqual(kept.context.focus,[]);
});
test('cancelling the picker keeps the photo that was already chosen',()=>{
 const h=pickerSetup();
 h.choose('file',{name:'kept.jpg'});h.choose('file',null);h.choose('file-camera',null);
 assert.equal(h.context.selected.name,'kept.jpg');assert.deepEqual(h.urls.revoked,[]);assert.equal(h.$('preview').src,'blob:kept.jpg');
});
test('starting a new diagnosis clears the photo and shows the pickers without opening one',()=>{
 const h=pickerSetup();h.choose('file-camera',{name:'a.jpg'});h.clicks.length=0;
 h.context.startNew();
 assert.equal(h.context.selected,null);assert.equal(h.context.photoSource,'gallery');assert.deepEqual(h.clicks,[]);
 assert.equal(h.$('dropzone').hidden,false);assert.ok(!h.$('pick-actions').classList.contains('hidden'));
 assert.ok(h.$('selected-actions').classList.contains('hidden'));assert.deepEqual(h.context.went,['new']);
});
test('a second photo from the camera or the gallery is kept for refine, which then becomes the main action',()=>{
 const h=pickerSetup();
 assert.equal(h.$('second-pick-camera').classList.contains('secondary'),false);assert.equal(h.$('second-pick-gallery').classList.contains('secondary'),true);
 h.fire('second-pick-camera');h.fire('second-pick-gallery');assert.deepEqual(h.clicks,['second-camera','second']);
 h.choose('second-camera',{name:'leaf.jpg'});
 assert.equal(h.context.secondFile.name,'leaf.jpg');assert.equal(h.context.secondSource,'camera');assert.equal(h.$('second-camera').value,'');
 assert.equal(h.$('refine').hidden,false);assert.match(h.$('second-name').textContent,/leaf\.jpg/);
 assert.equal(h.$('second-pick-camera').classList.contains('secondary'),true);
 h.choose('second',null);assert.equal(h.context.secondFile.name,'leaf.jpg');
});
test('desktop hides the camera buttons because browsers ignore capture there',()=>{
 const h=pickerSetup({desktop:true});
 assert.equal(h.$('pick-camera').hidden,true);assert.equal(h.$('second-pick-camera').hidden,true);
 // 카메라 버튼이 없으니 갤러리가 추가 사진의 주 버튼이다
 assert.equal(h.$('second-pick-gallery').classList.contains('secondary'),false);
 // 추가 사진을 고르면 갤러리도 보조로 내려 "두 사진으로 다시 확인" 만 주 버튼이다
 h.choose('second',{name:'s.jpg'});assert.equal(h.$('second-pick-gallery').classList.contains('secondary'),true);
 assert.equal(pickerSetup().$('pick-camera').hidden,false);
});
test('refine uses the kept second photo and clearing it restores the pickers',()=>{
 assert.match(source,/async function refine\(\) \{\n  const file = secondFile;/);
 const h=setup();h.context.secondFile={name:'x.jpg'};h.$('refine').hidden=false;
 h.context.result(h.record('one'));h.context.result(h.record('two'));
 assert.equal(h.context.secondFile,null);assert.equal(h.$('refine').hidden,true);assert.equal(h.$('second-name').textContent,'');
});

// ── 연결 상태와 온라인 전환 ──
function setupConnection({search='',navOnline=false,reach=false,busy=false,selected=null,phase='ready'}={}){
 const nodes=new Map(),listeners={};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,tabIndex:0,open:false,dataset:{phase:id==='status-card'?phase:undefined},attrs:{},classes:new Set(),
  classList:{toggle(name,on){on?nodes.get(id).classes.add(name):nodes.get(id).classes.delete(name);}},setAttribute(k,v){this.attrs[k]=v;},addEventListener(type,fn){this['on'+type]=fn;}});return nodes.get(id);};
 const navigator={onLine:navOnline};const toasts=[];const location={search,href:'/offline/index.html'};
 const context=vm.createContext({$,navigator,location,URLSearchParams,AbortSignal:{timeout:()=>undefined},toasts,
  online:navOnline,busy,voiceBusy:false,selected,voiceSession:null,previewStream:null,PHASES:{'not-ready':{body:'인터넷에 연결해 받아주세요.'}},
  toast(t){toasts.push(t);},fetch:async()=>{if(!context.reach)throw new TypeError('offline');return {status:200};},reach,
  addEventListener(type,fn){listeners[type]=fn;},setInterval(){}});
 const start=source.indexOf('// ── 연결 상태와 온라인 전환 ──'),end=source.indexOf('// 주소의 # 화면을 먼저 보인다.');
 vm.runInContext(source.slice(start,end).replace('const cameFromOffline','var cameFromOffline').replace('let sawOffline','var sawOffline'),context);
 return {context,$,listeners,navigator,location,toasts};
}
test('offline: the online switch and download guide are disabled, with a note when no files are saved',()=>{
 const h=setupConnection({phase:'not-ready'});h.context.renderConnection();
 assert.equal(h.$('go-online').disabled,true);assert.equal(h.$('conn-bar').dataset.online,'false');
 assert.match(h.$('conn-text').textContent,/인터넷 연결 없음/);
 assert.equal(h.$('guide').attrs['aria-disabled'],'true');assert.ok(h.$('guide').classes.has('guide-off'));
 assert.equal(h.$('prepare').disabled,true);
 assert.match(h.$('ready').textContent,/인터넷이 연결되면 앱 설치와 오프라인 파일 받기를 할 수 있어요/);
});
test('coming back online enables the switch; a page opened because of no connection goes online by itself',async()=>{
 const h=setupConnection({search:'?from=offline',phase:'not-ready'});h.context.renderConnection();
 h.navigator.onLine=true;h.context.reach=true;await h.context.checkConnection();
 assert.equal(h.$('go-online').disabled,false);assert.equal(h.location.href,'/home');
 assert.equal(h.$('ready').textContent,'인터넷에 연결해 받아주세요.');
});
test('it does not leave by itself while something is in progress, and only tells once',async()=>{
 const h=setupConnection({search:'?from=offline',selected:{name:'a.jpg'}});
 h.navigator.onLine=true;h.context.reach=true;await h.context.checkConnection();await h.context.checkConnection();
 assert.equal(h.location.href,'/offline/index.html');assert.equal(h.$('go-online').disabled,false);assert.equal(h.toasts.length,1);
 h.$('go-online').onclick();assert.equal(h.location.href,'/home');
});
test('a page opened on purpose, or already online at start, does not switch by itself',async()=>{
 const purposely=setupConnection();purposely.navigator.onLine=true;purposely.context.reach=true;await purposely.context.checkConnection();
 assert.equal(purposely.location.href,'/offline/index.html');assert.equal(purposely.$('go-online').disabled,false);
 // 신호가 약해 넘어왔는데 처음부터 연결돼 보이면 다시 넘어오기를 되풀이하지 않게 가만히 있는다
 const weak=setupConnection({search:'?from=offline',navOnline:true,reach:true});await weak.context.checkConnection();
 assert.equal(weak.location.href,'/offline/index.html');
});
test('wifi without a server keeps the switch off',async()=>{
 const h=setupConnection({search:'?from=offline'});h.navigator.onLine=true;h.context.reach=false;await h.context.checkConnection();
 assert.equal(h.$('go-online').disabled,true);assert.equal(h.location.href,'/offline/index.html');
});
