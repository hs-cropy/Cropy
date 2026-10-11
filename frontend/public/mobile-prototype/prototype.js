/* Figma-derived visual prototype. All diagnosis, download and sync operations below are simulations. */
(() => {
'use strict';
const $ = (selector) => document.querySelector(selector);
const app = $('#mobile-app'), phone = $('#phone'), dialog = $('#confirm-dialog');
const escape = (value) => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const image = (file, cls = '', alt = '') => '<img src="assets/' + file + '" class="' + cls + '" alt="' + escape(alt) + '">';
const mascot = (file = 'e9bde.png', cls = 'mascot') => image(file, cls);
const button = (label, action, cls = 'btn', attrs = '') => '<button type="button" class="' + cls + '" data-action="' + action + '" ' + attrs + '>' + escape(label) + '</button>';
const stateInfo = window.FIGMA_STATES;
let screen = 'start', selectedPhoto = null, photoUrl = null, stream = null;
let timer = null, toastTimer = null, lastFocus = null, dialogConfirm = null;
let large = false, voice = false, risk = '전체', crop = '고추', openDetail = null;
let outcome = 'result', progress = 45, offlinePrepared = false, currentRecord = null;
let historyScroll = 0, pendingTarget = 'start', unsaved = false, pinned = false;
const initialRecords = [
 {id:'pepper-1', crop:'고추', disease:'탄저병', risk:'주의', time:'오늘 오후 2:18', confidence:90},
 {id:'pepper-2', crop:'고추', disease:'흰가루병', risk:'낮음', time:'9월 26일', confidence:87},
 {id:'radish-1', crop:'무', disease:'검은무늬병', risk:'주의', time:'9월 25일', confidence:88},
 {id:'cabbage-1', crop:'배추', disease:'노균병', risk:'위험', time:'9월 24일', confidence:92}
];
let records = initialRecords.map(r => ({...r}));
let diagnosisId = null, diagnosisSequence = 0;
let photoRequest = 0, cameraRequest = 0;
try { large = localStorage.getItem('cropy:prototype:large') === 'true'; } catch {}
const core = [
 ['start','진단 시작','526:5530'],['camera','작물 촬영','526:5444'],['camera-off','카메라 꺼짐','526:5471'],
 ['permission','카메라 권한','526:5499'],['camera-unavailable','카메라 사용 불가','526:5514'],
 ['guide','촬영 방법','526:5549'],['photo','사진 확인','526:5636'],['analysis','사진 분석 중','526:5653'],
 ['result','진단 결과','526:5680'],['low','낮은 신뢰도','526:5702'],['pair','혼동쌍 안내','526:5720'],
 ['extra-guide','추가 촬영 가이드','526:5760'],['failed','분석 실패','526:5849'],
 ['history','진단 이력','526:5868'],['empty-history','이력 없음','526:5877'],['record','저장된 기록','526:5890']
];
const feedbackKeys = ['discard-photo','leave-analysis','cancel-analysis','unsaved-result','saved','save-retry-success','analysis-cancelled','voice-unavailable','photo-format','photo-size','photo-read','photo-upload','camera-capture','camera-runtime','analysis-offline','analysis-delayed','analysis-timeout','save-pending','save-failed','result-photo-unavailable','history-loading','history-failed','record-unavailable','record-load-failed'];
const offlineKeys = ['offline-not-ready','model-download','download-paused','offline-ready','local-analysis-failed','local-saved','sync-pending','sync-failed','storage-full','model-update'];
const labels = {'discard-photo':'사진 취소 확인','leave-analysis':'분석 중 화면 이탈','cancel-analysis':'분석 취소 확인','unsaved-result':'저장 전 화면 이탈','saved':'이력 저장 완료','save-retry-success':'저장 재시도 완료','analysis-cancelled':'분석 취소 완료','voice-unavailable':'음성 실행 실패','photo-format':'사진 형식 오류','photo-size':'사진 용량 오류','photo-read':'사진 읽기 오류','photo-upload':'사진 업로드 실패','camera-capture':'촬영 실패','camera-runtime':'카메라 연결 끊김','analysis-offline':'네트워크 연결 오류','analysis-delayed':'분석 지연','analysis-timeout':'분석 시간 초과','save-pending':'결과 저장 중','save-failed':'결과 저장 실패','result-photo-unavailable':'결과 사진 조회 실패','history-loading':'이력 로딩','history-failed':'이력 조회 실패','record-unavailable':'기록 없음','record-load-failed':'기록 조회 실패','offline-not-ready':'오프라인 준비 필요','model-download':'진단 파일 다운로드','download-paused':'다운로드 중단','offline-ready':'오프라인 준비 완료','local-analysis-failed':'로컬 분석 실패','local-saved':'기기에 저장 완료','sync-pending':'동기화 대기','sync-failed':'동기화 실패','storage-full':'기기 저장 공간 부족','model-update':'진단 파일 업데이트'};
const navIcons = {camera:'01064.svg',diagnosis:'5aa40.svg',history:'ffe89.svg'};
function stopTimer(){if(timer){clearTimeout(timer);clearInterval(timer);timer=null;}}
function stopCamera(){cameraRequest++;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}}
function photo(){return selectedPhoto ? '<img class="selected-photo" src="' + escape(photoUrl) + '" alt="선택한 작물 사진">' : image('a4d78.svg','sample-leaf','작물 사진 표시 예시');}
function header(offline=false){return '<header class="header ' + (offline?'offline-header':'') + '">' + image('7a754.png','logo','Cropy') + '<button class="toggle" data-action="large" aria-pressed="' + large + '">큰 글자' + image(large?'f565e.svg':'33a0c.svg') + '</button><button class="toggle" data-action="voice" aria-pressed="' + voice + '">음성' + image(voice?'f565e.svg':'33a0c.svg') + '</button></header>';}
function title(main, sub, icon=null){return '<section class="title ' + (icon?'has-mascot':'') + '"><h1 tabindex="-1">' + escape(main) + '</h1><p>' + escape(sub) + '</p>' + (icon?mascot(icon):'') + '</section>';}
function nav(active){return '<nav class="nav" aria-label="주 메뉴">' + [['camera','촬영'],['diagnosis','진단'],['history','이력']].map(([key,label])=>'<button data-action="nav:' + key + '" class="' + (active===key?'active':'') + '" ' + (active===key?'aria-current="page"':'') + '><span class="icon-slot">' + image(key===active ? {camera:'ff275.svg',diagnosis:'5aa40.svg',history:'95eb6.svg'}[key] : navIcons[key==='diagnosis'?'inactive':key]||'cc315.svg') + '</span>' + label + '</button>').join('') + '</nav>';}
function actions(items){return items.length ? '<div class="actions ' + (items.length===2?'two':'one') + '">' + items.map(([label,action],i)=>button(label,action,'btn' + (i?' secondary':''))).join('') + '</div>' : '';}
function shell(main,sub,body,items=[],active='diagnosis',icon=null){return header() + title(main,sub,icon) + '<main class="content"><div class="stack">' + body + '</div></main>' + actions(items) + nav(active);}
function toast(message){clearTimeout(toastTimer);const t=$('#toast');t.textContent=message;t.hidden=false;toastTimer=setTimeout(()=>t.hidden=true,4000);}
function feedbackAsset(key){
 const a=stateInfo[key]?.assets||{};
 return a.imgMascotConfirmation||a.imgMascotConnection||a.imgMascotWarning||a.imgMascotHealthy||a.imgMascotAnalysis||a.imgMascotSaved||a.imgMascotEmpty||a.imgMascotPhoto||a.imgMascotInfo||Object.entries(a).find(([n])=>/Mascot/.test(n))?.[1]||'a3484.png';
}
function feedback(key, actionsList=[]){
 const data=stateInfo[key];return '<section class="feedback" data-state="' + key + '">' + mascot(feedbackAsset(key)) + (data.title?'<h2>' + escape(data.title) + '</h2>':'') + '<p>' + escape(data.message||'') + '</p>' +
 (key==='model-download'?'<div class="progress"><div class="progress-track"><span style="width:'+progress+'%"></span></div><p>다운로드 '+progress+'% · 예시</p></div>':'') +
 (actionsList.length?'<div class="feedback-actions">'+actionsList.map(([label,act],i)=>button(label,act,'compact-btn'+(i?' secondary':''))).join('')+'</div>':'') + '</section>';
}
function dialogFor(key,confirm){
 lastFocus=document.activeElement;dialogConfirm=confirm;
 $('#dialog-content').innerHTML=feedback(key,[[stateInfo[key].paragraphs.at(-2)||'돌아가기','dialog-stay'],[stateInfo[key].paragraphs.at(-1)||'나가기','dialog-confirm']]).replace('<h2>','<h2 id="dialog-title">');
 dialog.showModal();dialog.querySelector('button').focus();
}
function closeDialog(){if(dialog.open)dialog.close();if(lastFocus?.isConnected)lastFocus.focus();dialogConfirm=null;}
dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
dialog.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const buttons=[...dialog.querySelectorAll('button')];const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
function clearPhoto(){photoRequest++;diagnosisId=null;if(photoUrl)URL.revokeObjectURL(photoUrl);selectedPhoto=null;photoUrl=null;$('#photo-picker').value='';}
function goto(next,options={}){
 photoRequest++;
 if(screen==='history')historyScroll=$('.content')?.scrollTop||0;
 stopTimer();if(next!=='camera')stopCamera();
 if(window.speechSynthesis)speechSynthesis.cancel();
 screen=next;pinned=options.pinned||false;$('#toast').hidden=true;
 if(!options.keepDetail)openDetail=null;render();
 if(screen==='history')$('.content').scrollTop=historyScroll;
 $('#frame-label').textContent=core.find(x=>x[0]===screen)?.[1]||labels[screen]||'프로토타입';
 if(window.matchMedia('(max-width:690px)').matches)$('.scenario-menu').open=false;
 if(voice)speak();
}
function requestNavigation(target){
 if(target===screen)return;
 if(screen==='photo'||(screen.startsWith('photo-')&&photoUrl)){pendingTarget=target;dialogFor('discard-photo',()=>{clearPhoto();goto(target);});}
 else if(screen==='analysis'){pendingTarget=target;dialogFor('leave-analysis',()=>{goto(target);toast(stateInfo['analysis-cancelled'].message);});}
 else if(unsaved&&['save-failed','result'].includes(screen)){pendingTarget=target;dialogFor('unsaved-result',()=>{unsaved=false;goto(target);});}
 else goto(target);
}
function renderMenu(){
 const group=(heading,rows)=>'<div class="scenario-group"><h2>'+heading+'</h2>'+rows.map(([key,label,id])=>'<button class="scenario '+(screen===key?'active':'')+'" data-scenario="'+key+'"><span>'+escape(label)+'</span><small>'+(id?'MOBILE':'STATE')+'</small></button>').join('')+'</div>';
 $('#scenario-list').innerHTML=group('01 · 촬영과 진단',core)+group('02 · 피드백 · 오류 · 확인',feedbackKeys.map(k=>[k,labels[k]]))+group('03 · 오프라인 · 온디바이스',offlineKeys.map(k=>[k,labels[k]]));
}
function detailBlocks(record=null){
 const known=!record||(record.crop==='고추'&&record.disease==='탄저병');
 const detailText={
 '증상':'<p>주로 열매에 둥글고 움푹 팬 갈색 병반이 생깁니다.</p><p>병반 위에 검은 점이나 주황빛 포자층이 보일 수 있습니다.</p><p>사진 속 증상과 비교해 주세요. AI 진단은 참고용입니다.</p>',
 '원인':'<p>병든 열매와 잔재에 남은 병원균이 전염원이 될 수 있습니다.</p><p>덥고 습한 날씨, 잦은 비와 물 튀김이 확산에 영향을 줍니다.</p>',
 '예방법':'<p>01　병든 열매와 잔재를 먼저 제거하세요.</p><p>02　주변 포기와 작업 도구를 확인하세요.</p><p>03　통풍을 확보하고 과습과 물 튀김을 줄이세요.</p>',
 '등록 농약':'<p><strong>작물·병해에 맞는 등록 정보 확인</strong></p><p>실제 등록 농약 데이터는 아직 연결되지 않았어요. 제품명과 사용량은 임의로 표시하지 않습니다.</p><dl>'+[['작물 / 병해','고추 / 탄저병'],['제품명','최신 등록정보 확인 필요'],['희석배수','제품 라벨 확인'],['사용 시기·횟수','제품 라벨 확인'],['수확 전 일수','제품 라벨 확인']].map(([a,b])=>'<div><dt>'+a+'</dt><dd>'+b+'</dd></div>').join('')+'</dl><p>농약 사용 전 제품 라벨과 최신 안전사용기준을 반드시 확인하세요.</p>'
 };
 return '<div class="details"><h2 class="details-label">상세 정보</h2>'+Object.keys(detailText).map(k=>'<section class="accordion '+(openDetail===k?'open':'')+'"><button data-action="detail:'+k+'" aria-expanded="'+(openDetail===k)+'">'+k+image('09e0b.svg')+'</button>'+(openDetail===k?'<div class="accordion-body">'+(known?detailText[k]:'이 기록의 상세 안내는 아직 연결되지 않았어요.')+'</div>':'')+'</section>').join('')+'</div>';
}
function resultBody(record=null,notice=''){
 const r=record||{crop:'고추',disease:'탄저병',risk:'주의',confidence:90};
 const known=r.crop==='고추'&&r.disease==='탄저병';
 return notice+'<section class="card summary"><p class="eyebrow">'+(record?'저장된 기록':'AI 진단 결과')+'</p><div class="diagnosis-row"><div class="thumbnail">'+(selectedPhoto&&!record?'<img src="'+escape(photoUrl)+'" alt="진단 사진">':image('6a9f4.svg','','진단 사진 표시 예시'))+'</div><div><p class="eyebrow">'+r.crop+'</p><h2>'+r.crop+' '+r.disease+'</h2><div class="badge-row"><span class="badge '+(r.risk==='낮음'?'low':'')+'">'+r.risk+'</span><span class="confidence">신뢰도 '+r.confidence+'%</span></div></div></div><p class="summary-note">'+(record?'저장 당시의 결과예요. 현재 상태는 새 사진으로 확인하세요.':'지금 관리하면 확산을 줄일 수 있어요.')+'</p></section>'+
 (known?'<section class="card management"><h2>'+(record?'진단 당시 관리 안내':'지금 해야 할 일')+'<span>3가지</span></h2>'+[['감염 부위 제거','병든 열매와 잔재를 먼저 치워주세요'],['주변 포기 확인','주변 포기와 도구를 함께 확인하세요'],['약제 기준 확인','등록 농약과 안전사용기준을 확인하세요']].map(([a,b],i)=>'<div class="action-row"><span class="number">'+(i+1)+'</span><div><strong>'+a+'</strong><p>'+b+'</p></div></div>').join('')+'</section>':'<section class="card"><p class="small-note">이 기록의 관리 안내는 아직 연결되지 않았어요.</p></section>')+
 detailBlocks(r)+button('새 사진으로 진단하기','new-photo','text-link');
}
function historyBody(){
 const filtered=records.filter(r=>r.crop===crop&&(risk==='전체'||r.risk===risk));
 return '<div class="crop-filters">'+['고추','무','배추'].map(c=>button(c,'crop:'+c,c===crop?'active':'','aria-pressed="'+(c===crop)+'"')).join('')+'</div><div><p class="filter-label">위험 등급</p><div class="risk-filters">'+['전체','위험','주의','낮음'].map(r=>button(r,'risk:'+r,r===risk?'active':'','aria-pressed="'+(r===risk)+'"')).join('')+'</div></div><p class="history-count">'+crop+' · '+risk+' '+filtered.length+'건</p>'+
 (filtered.length?filtered.map(r=>'<button class="history-item" data-action="record:'+r.id+'"><span class="empty-thumbnail"></span><div><strong>'+r.crop+' '+r.disease+'</strong><p>'+r.crop+' · '+r.time+'</p></div><span class="badge '+(r.risk==='낮음'?'low':r.risk==='위험'?'danger':'')+'">'+r.risk+'</span></button>').join(''):'<div class="empty">'+mascot('46875.png')+'<h2>조건에 맞는 기록이 없어요</h2><p>작물이나 위험 등급을 바꿔 확인해주세요.</p>'+button('전체 등급 보기','risk:전체','text-link')+'</div>');
}
function guideBody(extra=false){
 const examples=[['01　잎이 화면을 채우게','반점과 주변 잎이 함께 보이게 가까이 대세요. 잎이 틀 안에 크게 들어오면 좋아요.','21110.svg','너무 멀어요','이 정도로 크게'],['02　색과 무늬가 보이게','밝은 그늘이나 창가에서 찍어주세요. 검은 그림자와 하얀 빛 반사를 피해 주세요.','57162.svg','어두워 안 보여요','색이 잘 보여요'],['03　반점에 초점을 맞춰요','화면의 반점을 눌러 초점을 맞춘 뒤, 손을 멈추고 찍어주세요.','ab331.svg','흔들려 흐려요','경계가 선명해요']];
 return (extra?'<p class="small-note">이번 추가 촬영 부위: 잎 뒷면</p>':'')+examples.map(([a,b,bad,badLabel,goodLabel],i)=>'<section class="card guide-card"><h2>'+a+'</h2><p>'+b+'</p><div class="guide-examples"><div><div class="guide-example">'+image(bad)+(i===0?image('efb36.svg','guide-frame'):i===1?'<div class="dark-overlay"></div>':'')+'</div><small>'+badLabel+'</small></div><div><div class="guide-example">'+image('57162.svg')+image('efb36.svg','guide-frame')+'</div><small class="good-label">'+goodLabel+'</small></div></div></section>').join('')+'<p class="small-note">그림은 촬영 방법을 설명하기 위한 예시예요.<br>병해를 구분하는 진단 사진은 아니에요.</p>';
}
 const feedbackActions = {
 'photo-format':[['다른 사진 선택','choose']], 'photo-size':[['다른 사진 선택','choose']], 'photo-read':[['다른 사진 선택','choose']],
 'photo-upload':[['다시 보내기','analyze'],['다른 사진 선택','choose']],
 'camera-capture':[['다시 촬영하기','to:camera'],['갤러리에서 선택','choose']],
 'camera-runtime':[['카메라 다시 켜기','to:camera'],['갤러리에서 선택','choose']],
 'analysis-offline':[['다시 시도하기','analyze'],['사진 확인으로','to:photo']],
 'analysis-delayed':[['계속 기다리기','continue-analysis'],['분석 취소','cancel']],
 'analysis-timeout':[['다시 분석하기','analyze'],['사진 확인으로','to:photo']],
 'save-failed':[['다시 저장','save']], 'result-photo-unavailable':[['사진 다시 불러오기','to:result']],
 'history-failed':[['다시 불러오기','to:history']], 'record-unavailable':[['이력으로','to:history']],
 'record-load-failed':[['다시 불러오기','to:record'],['이력으로','to:history']],
 'offline-not-ready':[['다운로드 안내','download'],['나중에','to:start']],
 'download-paused':[['다시 다운로드','download'],['나중에','to:start']],
 'offline-ready':[['진단 시작','to:start']],
 'local-analysis-failed':[['다시 분석','analyze'],['다른 사진','choose']],
 'sync-failed':[['동기화 재시도','sync'],['나중에','to:history']],
 'storage-full':[['저장 공간 관리','to:history'],['나중에','to:result']],
 'model-update':[['업데이트','download'],['나중에','to:start']]
};
function render(){
 phone.classList.toggle('large',large);renderMenu();let html='';
 switch(screen){
 case 'start':html=shell('진단 시작','사진을 찍거나 선택하면\n진단 결과와 관리 방법을 볼 수 있어요.','<div class="entry">'+mascot()+'<h2>사진으로 작물 상태를<br>확인해보세요</h2><p>작물 사진을 찍거나 갤러리에서 선택하면<br>진단 결과와 관리 방법을 확인할 수 있어요.</p></div>'+button('촬영 방법 보기','to:guide','text-link')+'<p class="small-note">지난 진단은 이력에서 확인할 수 있어요.</p>',[['사진 찍기','to:camera'],['갤러리에서 선택','choose']]);break;
 case 'camera':case 'camera-off':html=shell('작물 촬영','증상 부위가 잘 보이도록\n가까이에서 한 장 찍어주세요.','<section class="card camera-card"><div class="camera-heading"><span class="icon-slot">'+image('ae449.svg')+'</span>'+(screen==='camera'?'실시간 프리뷰':'카메라 꺼짐')+button('카메라'+image(screen==='camera'?'f565e.svg':'33a0c.svg'),'camera-toggle','toggle').replace(/카메라&amp;lt;.*?(?=<\/button>)/,'카메라')+'</div><div class="camera-viewport">'+(screen==='camera'?image('a4d78.svg','leaf-large','작물 촬영 예시')+'<p>증상 부위가 잘 보이도록 찍어주세요</p>':mascot('cb97b.png')+'<p>카메라가 꺼져 있어요</p><p>위 토글을 켜면 다시 촬영할 수 있어요.<br>갤러리 사진은 계속 선택할 수 있어요.</p>')+'</div></section><section class="card recent"><div><p class="eyebrow">최근 진단</p><strong>고추 · 탄저병</strong></div>'+button('보기','to:record','text-link')+'</section>',[['사진 찍기','capture'],['갤러리에서 선택','choose']],'camera',screen==='camera'?'4bd01.png':null);break;
 case 'permission':html=shell('카메라 권한','사진 촬영에 필요한 권한을 확인해주세요.','<div class="empty">'+'<h2>카메라 사용을 허용해주세요</h2><p>작물 사진을 촬영하기 위해<br>카메라 권한이 필요해요.</p><p>허용하지 않아도 갤러리 사진을<br>선택할 수 있어요.</p></div>',[['허용','enable-camera'],['허용 안 함','to:camera-unavailable']],'camera','4bd01.png');break;
 case 'camera-unavailable':html=shell('카메라 권한','촬영이 어려우면 저장된 사진을 선택하세요.','<div class="empty">'+'<h2>카메라를 사용할 수 없어요</h2><p>설정에서 카메라 권한을 허용한 뒤<br>다시 시작해주세요.</p><p>저장된 사진으로도 진단할 수 있어요.</p></div>',[['권한 허용 후 다시 시작','enable-camera'],['갤러리에서 선택','choose']],'camera','38d45.png');break;
 case 'guide':case 'extra-guide':html=shell(screen==='guide'?'촬영 방법':'추가 촬영 방법',screen==='guide'?'작물과 증상이 잘 보이도록\n크고 밝고 선명하게 찍어주세요.':'같은 잎의 뒷면을\n크고 밝고 선명하게 찍어주세요.',guideBody(screen==='extra-guide'),[[screen==='guide'?'사진 찍기':'잎 뒷면 다시 촬영','to:camera'],['갤러리에서 선택','choose']],'diagnosis','4bd01.png');break;
 case 'photo':html=shell('사진 확인','증상 부위와 주변 잎이\n선명하게 보이는지 확인해주세요.','<section class="card photo-card"><div class="photo-stage">'+photo()+'</div><p class="small-note">'+(selectedPhoto?escape(selectedPhoto.name):'선택한 사진 예시')+'</p>'+''+'</section>',[['이 사진으로 진단하기','analyze'],['사진 선택 취소','discard']],'diagnosis','d567f.png');break;
 case 'analysis':html=shell('사진 분석 중','작물과 증상을 확인하고 있어요.\n잠시만 기다려주세요.','<div class="analysis-photo">'+photo()+'</div><div class="analysis-status">'+image('35e4b.svg','analysis-spinner')+'<div class="analysis-line"><span></span></div><div class="steps"><span>작물 인식</span><span>병해 비교</span><span>결과 정리</span></div>'+button('분석 취소','cancel','analysis-cancel')+'</div><p class="small-note">분석이 끝나면 결과 화면으로 이동해요.</p>',[],'diagnosis','5199f.png');break;
 case 'result':html=shell('진단 결과','진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.',resultBody(),[],'diagnosis','7dc05.png');break;
 case 'record':{const record=currentRecord||records[0]||initialRecords[0];html=shell('저장된 진단','저장 당시의 결과예요.\n현재 상태는 새 사진으로 확인하세요.',button('‹ 뒤로','to:history','back-link')+'<p class="small-note">'+record.time+'</p>'+resultBody(record),[],'history','7dc05.png');break;}
 case 'history':html=shell('진단 이력','작물을 선택한 뒤\n위험 등급별로 확인하세요.',historyBody(),[],'history','46875.png');break;
 case 'empty-history':html=shell('진단 이력','저장한 진단을 모아볼 수 있어요.','<div class="empty">'+mascot('5912e.png')+'<h2>아직 진단 이력이 없어요</h2><p>첫 사진을 찍으면 진단 결과가<br>여기에 저장됩니다.</p>'+button('첫 진단 시작하기','to:start')+'</div>',[],'history');break;
 case 'low':html=shell('추가 확인이 필요해요','현재 사진만으로는\n병해를 확정하기 어려워요.','<section class="card low-card"><h2>진단 신뢰도 54%</h2><p>조금 더 선명한 사진이면 정확도를 높일 수 있어요.</p><p>• 잎이나 열매가 크게 보이게<br>• 초점을 맞춘 뒤 흔들리지 않게<br>• 빛 반사 없이 밝은 곳에서</p></section>',[['다시 촬영하기','to:camera'],['촬영 방법 보기','to:guide']],'diagnosis','6bf5b.png');break;
 case 'pair':html=shell('비슷한 증상이 보여요','후보를 구분하기 위해\n같은 잎의 뒷면을 한 장 더 찍어주세요.','<section class="card stack"><h2 style="font-size:18px">AI가 비교 중인 후보</h2><div class="pair-candidates"><div><small>후보 1</small><br><strong>무 검은무늬병</strong></div><div><small>후보 2</small><br><strong>무 노균병</strong></div></div><p class="small-note">후보 예시 · 아직 확정된 진단이 아니에요.</p></section><section class="card stack"><h2 style="font-size:18px">이번엔 잎 뒷면을 찍어주세요</h2>'+'<div class="pair-leaves"><div>'+image('a8785.svg','','잎 앞면 예시')+'<small>앞면</small></div>'+image('f5e23.svg')+'<div>'+image('d8e23.svg','','잎 뒷면 예시')+'<small>뒷면</small></div></div>'+'<p class="small-note">같은 잎을 뒤집어 반점이 있는 곳의<br>뒷면이 보이도록 찍어주세요.</p></section>',[['그림 보고 다시 촬영하기','to:extra-guide'],['바로 다시 촬영','to:camera']],'diagnosis','733c9.png');break;
 case 'failed':html=shell('분석을 완료하지 못했어요','다시 시도하거나\n다른 사진으로 확인해주세요.','<div class="empty">'+mascot('03af9.png')+'<h2>분석 중 오류가 발생했어요</h2><p>잠시 후 다시 시도하거나<br>새 사진을 선택해주세요.</p></div>',[['다시 시도하기','analyze'],['다른 사진 선택','choose']]);break;
 default:
 if(offlineKeys.includes(screen)){
  const status={'offline-not-ready':'필수 파일 없음','model-download':'다운로드 중','download-paused':'다운로드 대기','offline-ready':'오프라인 준비 완료','sync-pending':'서버 전송 대기','sync-failed':'서버 전송 실패','storage-full':'기기 저장 공간 확인'};
  html=header(true)+'<section class="title offline-title"><h1>오프라인 사용 준비</h1><p>'+(screen==='offline-ready'?'필요한 진단 파일과 안내가 이 기기에 준비됐어요.':'처음 한 번 준비하면 인터넷 없이 사용할 수 있어요.')+'</p><div class="offline-status">'+(status[screen]||'기기 상태 확인')+'</div></section><main class="content"><div class="stack">'+feedback(screen,feedbackActions[screen]||[])+(screen==='local-saved'?button('저장된 기록 보기','to:history','text-link'):'')+(screen==='sync-pending'?button('지금 동기화','sync','text-link'):'')+'</div></main>'+nav('diagnosis');
 }else if(stateInfo[screen]){
  if(['save-failed','save-pending','result-photo-unavailable'].includes(screen)){html=shell('진단 결과','진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.',resultBody(null,feedback(screen,feedbackActions[screen]||[])),[],'diagnosis','7dc05.png');}
  else if(screen.startsWith('history-')||screen.startsWith('record-')){html=shell(screen.startsWith('record-')?'저장된 진단':'진단 이력','저장한 진단을 확인해주세요.',feedback(screen,feedbackActions[screen]||[]),[],'history','46875.png');}
  else html=shell(screen.startsWith('camera-')?'작물 촬영':screen.startsWith('photo-')?'사진 확인':'사진 분석 중','선택한 사진을 확인해주세요.',feedback(screen,feedbackActions[screen]||[]),[],screen.startsWith('camera-')?'camera':'diagnosis','d567f.png');
 }
 }
 app.innerHTML=html;
 const captureButton=app.querySelector('[data-action="capture"]');if(captureButton)captureButton.disabled=screen==='camera-off';
 const cameraButton=app.querySelector('[data-action="camera-toggle"]');
 if(cameraButton)cameraButton.innerHTML='카메라'+image(screen==='camera'?'f565e.svg':'33a0c.svg');
 if(screen==='camera'&&stream){const v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.muted=true;v.srcObject=stream;$('.camera-viewport').append(v);}
}
function saveResult(){
 unsaved=false;
 if(!diagnosisId)diagnosisId='diagnosis-'+ ++diagnosisSequence;
 if(!records.some(r=>r.id===diagnosisId))records.unshift({id:diagnosisId,crop:'고추',disease:'탄저병',risk:'주의',time:'방금 전',confidence:90});
 goto('result');toast(offlinePrepared?stateInfo['local-saved'].message:stateInfo['saved'].message);
}
function analyze(){diagnosisId='diagnosis-'+ ++diagnosisSequence;goto('analysis');function finish(){if(screen!=='analysis')return;if(dialog.open){timer=setTimeout(finish,150);return;}timer=null;if(outcome==='result')saveResult();else if(outcome==='save-failed'){unsaved=true;goto('save-failed');}else goto(outcome);}timer=setTimeout(finish,2200);}
function download(){goto('model-download');progress=45;timer=setInterval(()=>{progress=Math.min(progress+11,100);render();if(progress===100){offlinePrepared=true;goto('offline-ready');}},450);}
function speak(){
 if(!window.speechSynthesis){voice=false;render();toast(stateInfo['voice-unavailable'].message);return;}
 speechSynthesis.cancel();const text=app.querySelector('h1')?.textContent||'Cropy';const speech=new SpeechSynthesisUtterance(text);speech.lang='ko-KR';speech.rate=.9;speech.onerror=e=>{if(e.error==='canceled'||e.error==='interrupted')return;voice=false;render();toast(stateInfo['voice-unavailable'].message);};speechSynthesis.speak(speech);
}
async function enableCamera(){
 if(!navigator.mediaDevices?.getUserMedia){goto('camera-unavailable');return;}
 stopCamera();const request=cameraRequest;
 try{
  const cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
  if(request!==cameraRequest){cameraStream.getTracks().forEach(t=>t.stop());return;}
  stream=cameraStream;goto('camera');
 }catch{if(request===cameraRequest)goto('camera-unavailable');}
}
async function capture(){
 if(screen==='camera-off')return;
 const video=$('.camera-viewport video');
 if(video&&video.videoWidth){const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(blob){clearPhoto();selectedPhoto=new File([blob],'촬영한 사진.jpg',{type:'image/jpeg'});photoUrl=URL.createObjectURL(blob);}}
 goto('photo');
}
function handle(action){
 if(action.startsWith('to:')){requestNavigation(action.slice(3));return;}
 if(action.startsWith('nav:')){requestNavigation({camera:'camera',diagnosis:photoUrl?'photo':'start',history:'history'}[action.slice(4)]);return;}
 if(action.startsWith('detail:')){const key=action.slice(7),top=$('.content').scrollTop;openDetail=openDetail===key?null:key;render();$('.content').scrollTop=top;app.querySelector('[data-action="'+action+'"]').focus({preventScroll:true});return;}
 if(action.startsWith('crop:')){crop=action.slice(5);historyScroll=0;render();return;}
 if(action.startsWith('risk:')){risk=action.slice(5);historyScroll=0;render();return;}
 if(action.startsWith('record:')){currentRecord=records.find(r=>r.id===action.slice(7));goto('record');return;}
 switch(action){
 case 'large':large=!large;try{localStorage.setItem('cropy:prototype:large',String(large));}catch{}render();break;
 case 'voice':voice=!voice;render();if(voice)speak();else if(window.speechSynthesis)speechSynthesis.cancel();break;
 case 'choose':$('#photo-picker').click();break;
 case 'capture':capture();break;
 case 'analyze':outcome='result';analyze();break;
 case 'continue-analysis':outcome='result';analyze();break;
 case 'cancel':dialogFor('cancel-analysis',()=>{goto('photo');toast(stateInfo['analysis-cancelled'].message);});break;
 case 'discard':dialogFor('discard-photo',()=>{clearPhoto();goto('start');});break;
 case 'new-photo':{const start=()=>{unsaved=false;clearPhoto();goto('start');};if(unsaved)dialogFor('unsaved-result',start);else start();break;}
 case 'camera-toggle':if(screen==='camera')goto('camera-off');else goto('permission');break;
 case 'enable-camera':enableCamera();break;
 case 'save':saveResult();break;
 case 'download':download();break;
 case 'sync':goto('sync-pending');timer=setTimeout(()=>{goto('history');toast('기록을 동기화했어요.');},1200);break;
 case 'dialog-stay':closeDialog();break;
 case 'dialog-confirm':{const confirm=dialogConfirm;closeDialog();if(confirm)confirm();break;}
 }
}
document.addEventListener('click',e=>{
 const control=e.target.closest('[data-action]');if(control){handle(control.dataset.action);return;}
 const scenario=e.target.closest('[data-scenario]');if(scenario)showScenario(scenario.dataset.scenario);
});
function showScenario(key){
 diagnosisId=null;
 unsaved=false;currentRecord=null;outcome='result';
 if(key==='discard-photo'){goto('photo',{pinned:true});dialogFor(key,()=>{clearPhoto();goto('start');});return;}
 if(key==='leave-analysis'||key==='cancel-analysis'){goto('analysis',{pinned:true});dialogFor(key,()=>{goto(key==='leave-analysis'?'start':'photo');toast(stateInfo['analysis-cancelled'].message);});return;}
 if(key==='unsaved-result'){goto('save-failed',{pinned:true});unsaved=true;dialogFor(key,()=>{unsaved=false;goto('start');});return;}
 if(['saved','save-retry-success','local-saved','analysis-cancelled','voice-unavailable'].includes(key)){goto(key==='analysis-cancelled'?'photo':key==='voice-unavailable'?'start':'result',{pinned:true});toast(stateInfo[key].message);return;}
 if(['low','pair','failed','save-failed','analysis-offline'].includes(key))outcome=key;
 if(key==='save-failed')unsaved=true;
 if(key==='model-update'){goto('offline-ready',{pinned:true});dialogFor(key,download);const primary=dialog.querySelector('[data-action="dialog-stay"]'),secondary=dialog.querySelector('[data-action="dialog-confirm"]');primary.dataset.action='dialog-confirm';secondary.dataset.action='dialog-stay';return;}
 if(key==='offline-ready')offlinePrepared=true;
 if(key==='model-download')progress=45;
 goto(key,{pinned:true});
}
$('#photo-picker').addEventListener('change',async e=>{
 const request=++photoRequest;
 const file=e.target.files?.[0];if(!file)return;
 if(!['image/jpeg','image/png'].includes(file.type)){goto('photo-format');e.target.value='';return;}
 if(file.size>10*1024*1024){goto('photo-size');e.target.value='';return;}
 const candidate=URL.createObjectURL(file);const img=new Image();
 const valid=await new Promise(resolve=>{img.onload=()=>resolve(img.naturalWidth*img.naturalHeight<=40000000);img.onerror=()=>resolve(false);img.src=candidate;});
 if(request!==photoRequest){URL.revokeObjectURL(candidate);return;}
 if(!valid){URL.revokeObjectURL(candidate);goto('photo-read');e.target.value='';return;}
 clearPhoto();selectedPhoto=file;photoUrl=candidate;goto('photo');
});
$('#reset-demo').addEventListener('click',()=>{closeDialog();clearPhoto();records=initialRecords.map(r=>({...r}));crop='고추';risk='전체';unsaved=false;outcome='result';offlinePrepared=false;voice=false;historyScroll=0;goto('start');});
window.addEventListener('pagehide',()=>{stopTimer();stopCamera();clearPhoto();if(window.speechSynthesis)speechSynthesis.cancel();});
if(matchMedia('(max-width:690px)').matches)$('.scenario-menu').open=false;
render();
})();
