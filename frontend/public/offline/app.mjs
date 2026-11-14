import * as ort from '/offline-runtime/ort.wasm.bundle.min.mjs';
import { softmax, distribution, fuse, summarize, failurePhase, viewFromHash, recordsNotice, updateAvailable, isDesktopDevice, gradeOf, isNotCrop, resultTimeSentence, recordTime } from './core.mjs';

ort.env.wasm.wasmPaths = '/offline-runtime/';
ort.env.wasm.numThreads = 1;
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bundle, session, selected, current, busy = false;
let previewUrl;
// 사진을 어디서 골랐는지 ('gallery'|'camera'). "다른 사진" 은 같은 곳을 다시 연다.
// 추가 사진은 고르자마자 입력을 비우므로(같은 사진을 다시 골라도 change 가 오게) 고른 파일을 따로 둔다
let photoSource = 'gallery', secondFile = null, secondSource = 'camera';
// 지금 보이는 화면, 저장된 모델을 다 불러왔는지, 기록 저장 공간이 모자랐는지, 나중에로 닫은 기록 안내
// offered: 이번 접속에서 업데이트를 이미 물었는지 (나중에를 누르면 다시 묻지 않는다)
// savedId: 방금 기기에 저장한 기록 (새 사진을 고를 때까지 머리에 저장 완료를 보인다)
let view = 'prepare', loaded = false, storageFull = false, dismissed = null, offered = false, savedId = null;
let stored = [], toastTimer;
const recordUrls = [];
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('cropy-on-device', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('assets');
    request.result.createObjectStore('records', {keyPath:'id'});
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('다른 Cropy 창을 닫은 뒤 다시 시작해 주세요.'));
});
async function db(store, operation, value, key) {
  const databaseHandle = await database;
  return new Promise((resolve, reject) => {
    const tx = databaseHandle.transaction(store, operation === 'get' || operation === 'getAll' ? 'readonly' : 'readwrite');
    const object = tx.objectStore(store);
    const request = operation === 'getAll' ? object.getAll() : operation === 'get' || operation === 'delete' ? object[operation](key) : object.put(value, key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || request.error);
  });
}
function message(error) {
  if (error?.name === 'QuotaExceededError') return '저장 공간이 부족해요. 기록을 내보내고 선택 삭제한 뒤 다시 시도해 주세요.';
  if (error?.name === 'AbortError') return '연결이 오래 멈춰 받기를 중단했어요. 다시 받으면 처음부터 받아요.';
  return error?.message || '처리하지 못했어요. 사진과 기존 기록은 유지돼요.';
}
// 오프라인 준비 상태 카드의 내용 (Figma "모바일 · 앱 설치 및 오프라인 이용"의 Offline/Mobile/*).
// 마스코트 파일 이름은 Mascot.tsx 의 별칭을 푼 것이다 (info → help, analysis → analyzing).
// desktop 은 PC 화면(Figma "데스크탑 · 앱 설치 및 오프라인 이용")에서 바뀌는 문구다
const desktop = isDesktopDevice(navigator.userAgent, navigator.maxTouchPoints);
const PHASES = {
  'not-ready': {label:'필수 파일 없음', lead:'처음 한 번 준비하면 인터넷 없이 사용할 수 있어요.', mascot:'help',
    title:'오프라인 사용 준비가 필요해요', body:'인터넷에 연결해 진단에 필요한 파일을 먼저 받아주세요. 준비 전에는 새 진단을 시작할 수 없어요.', actions:['guide','later']},
  download: {label:'다운로드 중', lead:'이 기기에서 사용할 진단 파일을 준비하고 있어요.', mascot:'analyzing',
    title:'진단 파일을 받고 있어요', body:'완료될 때까지 인터넷 연결을 유지해주세요. 준비가 끝나면 오프라인으로 진단할 수 있어요.', progress:true, actions:[]},
  verifying: {label:'파일 검증 · 실행 확인', lead:'파일을 확인한 뒤 오프라인 준비가 완료돼요.', mascot:'analyzing',
    title:'파일과 실행 환경을 확인해요', body:'파일이 올바른지 확인한 뒤, 이 기기에서 실행하고 저장할 수 있는지 확인해요.', note:'파일 받기 완료 · 확인 중', actions:[],
    desktop:{lead:'확인이 끝나면 오프라인 준비가 완료돼요.', body:'파일이 올바른지 확인한 뒤, 이 PC에서 실행하고 저장할 수 있는지 확인해요.'}},
  ready: {label:'오프라인 준비 완료', lead:'필요한 진단 파일과 안내가 이 기기에 준비됐어요.', mascot:'healthy',
    title:'인터넷 없이 진단할 수 있어요', body:'이 기기의 오프라인 사용 준비가 끝났어요. 사진을 선택해 진단을 시작해보세요.', actions:['start']},
  paused: {label:'연결 필요', lead:'필수 파일을 모두 받은 뒤 오프라인으로 사용할 수 있어요.', mascot:'connection',
    title:'다운로드가 멈췄어요', body:'인터넷 연결이 끊겼어요. 다시 연결한 뒤 다운로드를 시도해주세요.', retry:'다시 다운로드', actions:['prepare','later']},
  'storage-full': {label:'저장 공간 부족', lead:'기존 기록은 자동으로 삭제하지 않아요.', mascot:'warning',
    title:'기기 저장 공간이 부족해요', body:'새 기록을 저장할 공간이 없어요. 저장된 기록을 확인해 공간을 확보해주세요.', retry:'다시 시도', actions:['manage','later']},
  failed: {label:'준비 실패', lead:'오프라인 준비를 마치지 못했어요.', mascot:'failed',
    title:'진단 파일을 준비하지 못했어요', body:'처리하지 못했어요. 다시 시도해주세요.', retry:'다시 받기', actions:['prepare','later']},
};
const PHASE_ACTIONS = ['guide','prepare','start','manage','later'];
// 첫 화면의 checking 처럼 PHASES 에 없는 상태는 그대로 undefined 다
const phaseText = phase => desktop && phase?.desktop ? {...phase, ...phase.desktop} : phase;
// 새 진단·진단 결과·진단 기록 화면의 안내 카드 (Offline/Mobile/local-analysis-failed, storage-full, sync-pending, sync-failed).
// 기록 저장 공간 부족은 진단 기록 화면에 뜨고, 모델을 받다 공간이 모자란 경우는 위 PHASES 의 준비 카드다
const NOTICES = {
  'local-analysis-failed': {label:'기기 내 분석 오류', lead:'사진은 이 기기에서 분석돼요.', mascot:'retake',
    title:'이 기기에서 분석하지 못했어요', body:'사진은 그대로 유지돼요. 다시 시도하거나 다른 사진을 선택해주세요.', primary:'다시 분석', secondary:'다른 사진'},
  'storage-full': {label:'저장 공간 부족', lead:'기존 기록은 자동으로 삭제하지 않아요.', mascot:'warning',
    title:'기기 저장 공간이 부족해요', body:'새 기록을 저장할 공간이 없어요. 저장된 기록을 확인해 공간을 확보해주세요.', primary:'저장 공간 관리', secondary:'나중에'},
  'sync-pending': {label:'동기화 대기', lead:'새 진단과 기기 기록 조회는 계속 사용할 수 있어요.', mascot:'saved',
    title:'동기화를 기다리고 있어요', body:'기록은 이 기기에 저장됐어요. 인터넷에 연결되면 서버에 보낼 수 있어요.'},
  'sync-failed': {label:'서버 동기화 실패', lead:'기기 저장과 서버 동기화는 별도로 처리돼요.', mascot:'connection',
    title:'동기화하지 못했어요', body:'이 기기의 기록은 그대로 보관돼요. 연결 상태를 확인한 뒤 다시 시도해주세요.', primary:'동기화 재시도', secondary:'나중에'},
};
// 화면별 제목과, 안내 카드가 없을 때의 부제
const VIEWS = {
  prepare: {title:'오프라인 사용 준비', lead:'처음 한 번 준비하면 인터넷 없이 사용할 수 있어요.'},
  new: {title:'새 진단', lead:'사진은 이 기기에서 분석돼요.'},
  // 결과가 없는 진단 결과 화면 (온라인 DiagnosisScreen.tsx 의 empty 머리)
  result: {title:'진단 시작', lead:'사진을 찍거나 선택하면\n진단 결과와 관리 방법을 볼 수 있어요.'},
  records: {title:'진단 기록', lead:'인터넷 없이도 이 기기에 저장된 기록을 볼 수 있어요.'},
};
// 진단 결과 화면에 결과가 있을 때의 머리 (온라인 DiagnosisScreen.tsx 의 진단 결과). 넓은 화면은 진단 시각 문장이다
const RESULT = {title:'진단 결과', lead:'진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.', wide:'진단 요약을 확인하고, 아래 관리 방법을 참고해주세요.'};
// 판별 불가 결과의 머리 (온라인 LowConfidencePanel.tsx). 병해 결과가 아니라 다시 찍기를 안내한다
const NOT_CROP = {title:'작물 잎을 찾지 못했어요', lead:'고추·무·배추 잎으로 알아보기 어려운 사진이에요.'};
// 업데이트 다이얼로그가 떠 있는 동안의 준비 화면 머리 (Offline/Mobile/model-update)
const UPDATE = {label:'업데이트 가능', lead:'현재 준비된 파일로 오프라인 진단을 계속할 수 있어요.'};
// 기기에 저장한 직후의 진단 결과·진단 기록 화면 머리 (Offline/Mobile/local-saved). 부제는 화면 기본값이다
const SAVED = {label:'기기 저장 완료'};
// 화면마다 안내 카드 하나. 새 진단(진단 실패)과 진단 결과(추가 사진 확인 실패)는 분석 실패 카드를 함께 쓰고, 지금 화면 것만 보인다
const notices = {new:null, result:null, records:null};
// 준비 화면은 준비 카드의 상태, 나머지 화면은 떠 있는 안내 카드가 상태 라벨과 부제를 정한다.
// 안내 카드가 없고 방금 저장했으면 저장 완료다. 진단 결과 화면은 그 기록의 결과를 볼 때만이다
function renderHeader() {
  const saved = savedId !== null && (view === 'records' || (view === 'result' && current?.id === savedId));
  const entry = view === 'prepare'
    ? ($('update-dialog').open ? UPDATE : phaseText(PHASES[$('status-card').dataset.phase]))
    : NOTICES[notices[view]] || (saved ? SAVED : undefined);
  const hasResult = view === 'result' && Boolean(current);
  const showing = hasResult && !notices.result;
  const notCrop = showing && isNotCrop(current.result);
  $('view-title').textContent = notCrop ? NOT_CROP.title : hasResult ? RESULT.title : VIEWS[view].title;
  $('phase-lead').textContent = entry?.lead || (notCrop ? NOT_CROP.lead : showing ? RESULT.lead : VIEWS[view].lead);
  $('phase-lead-wide').textContent = notCrop ? NOT_CROP.lead : showing ? resultTimeSentence(current.created_at) || RESULT.wide : '';
  $('head-mascot').src = '/mascot/' + (notCrop ? 'retake' : 'result') + '.png';
  $('phase-label').textContent = entry?.label || ''; $('phase-label').hidden = !entry;
  $('page-head').dataset.mode = showing ? 'result' : '';
}
// 새 진단(new)·진단 결과(result)·진단 기록(records) 화면의 안내 카드를 띄우거나(name) 닫는다(null).
// 새 진단과 진단 결과는 분석 실패 카드 하나를 같이 쓰고, 보일지는 syncAnalyzeView 가 지금 화면으로 정한다
function notice(where, name) {
  const card = $(where === 'records' ? 'records-card' : 'analyze-card'), entry = NOTICES[name];
  const focused = document.activeElement;
  notices[where] = entry ? name : null;
  if (where === 'records') card.hidden = !entry; else syncAnalyzeView();
  if (entry) {
    card.querySelector('.mascot').src = '/mascot/' + entry.mascot + '.png';
    card.querySelector('h2').textContent = entry.title; card.querySelector('p').textContent = entry.body;
    const [primary, secondary] = card.querySelectorAll('.actions > button');
    primary.textContent = entry.primary || ''; primary.hidden = !entry.primary; primary.disabled = busy;
    secondary.textContent = entry.secondary || ''; secondary.hidden = !entry.secondary;
    card.querySelector('.actions').hidden = !entry.primary && !entry.secondary;
  }
  renderHeader();
  // 누른 버튼이 숨겨졌거나 포커스를 잃었으면, 카드가 떴을 땐 카드 제목으로, 닫혔으면 화면 제목으로 옮긴다
  if (where === view && (focused?.closest('[hidden]') || !focused || focused === document.body)) (entry ? card.querySelector('h2') : $('view-title')).focus();
}
// 기록 저장 공간 부족이 동기화 안내보다 먼저다. 나중에로 닫은 안내는 다시 동기화를 누를 때까지 띄우지 않는다
function updateRecordsNotice() {
  const name = storageFull ? 'storage-full' : recordsNotice(stored, navigator.onLine);
  notice('records', name === dismissed ? null : name);
}
function route(focus) {
  const wanted = viewFromHash(location.hash), before = view;
  // 준비된 모델이 없으면 새 진단 대신 준비 화면이다 (모델을 불러오는 동안은 기다린다).
  // 진단 결과는 기록의 결과 보기라 모델 없이도 열린다
  view = wanted === 'new' && loaded && !session ? 'prepare' : wanted;
  if (view !== wanted) window.history.replaceState(null, '', '#prepare');
  // 다른 화면에서 남은 문구가 새 화면의 결과에 붙어 보이지 않게 지운다 (진행 중 문구는 둔다)
  if (view !== before && !busy) $('state').textContent = '';
  // 새 진단과 진단 결과는 한 묶음(data-view="new result")을 같이 쓰고, 안의 카드는 syncAnalyzeView 가 고른다
  for (const section of document.querySelectorAll('main > [data-view]')) section.hidden = !section.dataset.view.split(' ').includes(view);
  syncAnalyzeView(true);
  // 준비 화면은 새 진단으로 가는 길이라 새 진단 탭이 켜진다
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === (view === 'prepare' ? 'new' : view)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  renderHeader();
  if (focus) { scrollTo(0, 0); $('view-title').focus(); }
  // 진단 기록은 들어올 때마다 다시 읽는다 (다른 창에서 저장한 기록도 보인다). 처음 그릴 때는 부팅이 읽는다
  if (focus && view === 'records') history().catch(error => { say(message(error)); });
}
// 버튼으로 화면을 옮긴다. 같은 # 이면 hashchange 가 오지 않아 직접 그린다
function go(name) {
  if (location.hash !== '#' + name) window.history.pushState(null, '', '#' + name);
  route(true);
}
// 연결돼 있으면 서버의 묶음 버전을 확인해 업데이트를 묻는다. 확인하지 못해도 지금 파일로 계속 쓰면 되니 조용히 넘긴다
async function checkUpdate() {
  if (!session || offered || busy || !navigator.onLine) return;
  try {
    const res = await fetch('/offline-assets/manifest.json', {cache:'no-store', signal:AbortSignal.timeout(5000)});
    if (!res.ok) return;
    const next = await res.json();
    if (offered || busy || !updateAvailable(bundle?.version, next.version)) return;
    offered = true; $('update-dialog').showModal(); renderHeader();
  } catch {}
}
function toast(text) {
  $('toast').textContent = text; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 3000);
}
// 안내 문구. 새 진단·진단 결과 화면은 맨 위 문구 자리를 보이게 하고 (긴 결과의 아래에서 눌러도 보인다),
// 그 자리가 숨겨진 다른 화면은 토스트로 알린다
function say(text) {
  $('state').textContent = text;
  if (view === 'new' || view === 'result') $('state').scrollIntoView({block:'nearest'});
  else toast(text);
}
// actions 를 주면 그 상태의 기본 버튼 대신 쓴다 (준비 중 저장 공간 부족은 다시 시도가 필요하다)
function show(name, body, actions = PHASES[name].actions) {
  const phase = phaseText(PHASES[name]);
  const focused = document.activeElement;
  $('status-card').hidden = false; $('resume').hidden = true; $('status-card').dataset.phase = name;
  $('status-mascot').src = '/mascot/' + phase.mascot + '.png';
  $('status-title').textContent = phase.title;
  $('ready').textContent = body || phase.body;
  $('download').hidden = !phase.progress && !phase.note;
  $('progress').hidden = !phase.progress;
  $('progress-text').textContent = phase.note || '';
  if (phase.retry) $('prepare').textContent = phase.retry;
  for (const id of PHASE_ACTIONS) $(id).hidden = !actions.includes(id);
  $('phase-actions').hidden = !actions.length;
  $('phase-actions').classList.toggle('single', actions.length === 1);
  renderHeader();
  // 누른 버튼이 숨겨졌으면 포커스가 사라지지 않게 카드 제목으로 옮긴다
  if (focused?.closest('[hidden]')) $('status-title').focus();
}
function setBusy(value) {
  busy = value;
  $('diagnose').disabled = value || !session || !selected;
  $('refine').disabled = value || !current;
  $('prepare').disabled = $('update-accept').disabled = value;
  $('start').disabled = value || !session;
  for (const id of ['file','file-camera','crop','second','second-camera','new-photo','empty-new',
    'dropzone','pick-gallery','pick-camera','pick-again','second-pick-camera','second-pick-gallery']) $(id).disabled = value;
  for (const id of ['analyze-card','records-card']) $(id).querySelector('[data-act="primary"]').disabled = value;
  for (const button of $('history').querySelectorAll('button')) button.disabled = value || button.dataset.locked === 'true';
}
async function initSession(model) {
  return ort.InferenceSession.create(new Uint8Array(model), {executionProviders:['wasm']});
}
async function prepare() {
  if (busy) return;
  setBusy(true);
  $('progress').value = 0; show('download'); $('progress-text').textContent = '다운로드 0%';
  // 다운로드 중에는 멈출 버튼이 없다. 30초 동안 받은 바이트가 없으면 끊고 다시 받기 화면으로 간다
  const stall = new AbortController(); let stallTimer;
  const alive = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => stall.abort(), 30000); };
  let candidate;
  try {
    alive();
    if (!window.isSecureContext || !('serviceWorker' in navigator)) throw new Error('이 기능은 HTTPS 또는 localhost에서 사용할 수 있어요.');
    await navigator.serviceWorker.register('/offline/sw.js', {scope:'/offline/'});
    await navigator.serviceWorker.ready;
    const res = await fetch('/offline-assets/manifest.json', {cache:'no-store', signal:stall.signal});
    if (!res.ok) throw new Error('오프라인 모델 묶음을 찾을 수 없어요. 서버에서 모델을 준비해 주세요.');
    const next = await res.json();
    const response = await fetch(next.model_url, {signal:stall.signal});
    if (!response.ok || !response.body) throw new Error('모델을 받지 못했어요. 연결을 확인하고 다시 준비해 주세요.');
    const chunks = []; let received = 0;
    const reader = response.body.getReader();
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      chunks.push(value); received += value.length; alive();
      $('progress').value = Math.min(99, received / next.model_bytes * 100);
      $('progress-text').textContent = '다운로드 ' + Math.floor($('progress').value) + '%';
    }
    // 받기가 끝나면 크기·해시 검증과 기기 실행 확인이다. 모두 통과해야 준비 완료로 넘어간다
    clearTimeout(stallTimer);
    show('verifying');
    if (received !== next.model_bytes) throw new Error('모델 파일 크기가 일치하지 않아요. 다시 준비해 주세요.');
    const model = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { model.set(chunk, offset); offset += chunk.length; }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', model)), x => x.toString(16).padStart(2,'0')).join('');
    if (hash !== next.sha256) throw new Error('모델 검증에 실패했어요. 이전 모델을 유지합니다.');
    candidate = await initSession(model.buffer);
    await db('assets','put',{manifest:next,model:model.buffer},'active');
    const previous = session;
    session = candidate; candidate = null; bundle = next;
    if (previous) await previous.release().catch(() => {});
    $('progress').value = 100;
    show('ready');
    // 권한 창을 띄우는 브라우저가 있어 답을 기다리지 않는다 (기다리면 그동안 사진을 고를 수 없다)
    navigator.storage?.persist?.().catch(() => {});
  } catch (error) {
    if (candidate) await candidate.release();
    // 업데이트에 실패해도 기존 모델이 있으면 준비 완료를 유지한다
    if (session) show('ready', message(error) + ' 기존 모델로 진단할 수 있어요.');
    else {
      const phase = failurePhase(error, navigator.onLine);
      // 연결이 끊긴 경우는 Figma 문구를, 나머지는 원인을 그대로 알린다
      if (phase === 'paused') show(phase);
      else show(phase, message(error), phase === 'storage-full' ? ['manage','prepare'] : undefined);
    }
  } finally { clearTimeout(stallTimer); setBusy(false); }
}
// 사진을 고르기 전에 걸러내는 문제. 분석 실패 카드가 아니라 문구로만 알린다
const invalid = text => Object.assign(new Error(text), {input:true});
async function predict(file) {
  if (!session) throw invalid('모델을 먼저 준비해 주세요.');
  if (!['image/jpeg','image/png'].includes(file.type)) throw invalid('JPEG 또는 PNG 사진을 선택해 주세요.');
  if (file.size > (bundle.upload?.max_bytes || 10 * 1024 * 1024)) throw invalid('사진 용량이 너무 커요. 더 작은 사진을 선택해 주세요.');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > (bundle.upload?.max_pixels || 40000000)) { bitmap.close(); throw invalid('사진 해상도가 너무 커요.'); }
  const size = bundle.input_size;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  context.drawImage(bitmap,0,0,size,size); bitmap.close();
  const pixels = context.getImageData(0,0,size,size).data;
  const tensor = new Float32Array(3 * size * size);
  for (let channel = 0; channel < 3; channel++) for (let i = 0; i < size * size; i++) {
    tensor[channel * size * size + i] = (pixels[i * 4 + channel] / 255 - bundle.mean[channel]) / bundle.std[channel];
  }
  const outputs = await session.run({image:new ort.Tensor('float32',tensor,[1,3,size,size])});
  return distribution(softmax(outputs.logits.data),bundle.class_ids);
}
function result(record) {
  // 다른 기록의 결과로 바뀌면 그 전 결과의 추가 사진과 추가 사진 확인 실패 카드는 내린다
  if (current?.id !== record.id) { clearSecond(); notices.result = null; }
  current = record; const r = record.result;
  $('result').innerHTML = resultHtml(record, resultPhotos(record), canRefine(record));
  $('refine-area').classList.toggle('hidden', !canRefine(record));
  $('guidance').textContent = r.recapture ? r.recapture.instruction + ' ' + r.recapture.candidates.map(c => c.cue).join(' ') : '';
  $('speak').disabled = false;
  // 판별 불가는 다시 찍는 것이 할 일이라 주요 버튼으로 보인다
  $('new-photo').textContent = isNotCrop(r) ? '다시 촬영하기' : '새 사진으로 진단하기';
  $('new-photo').classList.toggle('text-button', !isNotCrop(r));
  $('retry-local')?.addEventListener('click', async () => {if (busy) return; setBusy(true); try {await storeRecord(record);} finally {setBusy(false);}});
  syncAnalyzeView(); renderHeader();
}
// 고른 추가 사진을 내린다 (다른 기록으로 바뀌었거나 새 진단을 시작했다). 고르기 버튼이 다시 주 버튼이 된다
function clearSecond() {
  secondFile = null; $('second').value = ''; $('second-camera').value = ''; $('second-name').textContent = '';
  $('refine').hidden = true; secondRoles(false);
}
// 결과를 내린다 (보던 기록 삭제). 진단 결과 화면은 빈 안내로 돌아가고, 기록은 기기에 그대로 있다
function clearResult() {
  current = null; notices.result = null; $('result').replaceChildren(); $('refine-area').classList.add('hidden'); clearSecond(); $('speak').disabled = true; $('state').textContent = '';
  for (const url of resultUrls) URL.revokeObjectURL(url);
  resultFiles = []; resultUrls = [];
  syncAnalyzeView(); renderHeader();
}
// 두 번째 사진으로 다시 확인할 수 있는지. 서버에 보낸 뒤에는 보낸 기록과 달라지지 않게 막는다
function canRefine(record) {
  return Boolean(record?.result?.recapture) && !record.sync_attempted && record.sync_status !== 'saved' && !record.recovery_token;
}
// 결과 화면의 사진 주소 (기기에 저장한 원본·재촬영 사진). 같은 사진이면 주소를 다시 만들지 않는다
let resultFiles = [], resultUrls = [];
function resultPhotos(record) {
  const files = [record.file, record.refined_file].filter(Boolean);
  if (files.length !== resultFiles.length || files.some((file, i) => file !== resultFiles[i])) {
    for (const url of resultUrls) URL.revokeObjectURL(url);
    resultFiles = files; resultUrls = files.map(file => URL.createObjectURL(file));
  }
  return resultUrls;
}
const PHOTO_TIPS = ['잎이나 열매가 크게 보이게 찍어주세요.', '초점을 맞춘 뒤 흔들리지 않게 촬영하세요.', '빛 반사 없이 밝은 곳에서 촬영하세요.'];
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"/></svg>';
const ALERT = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></g></svg>';
// 진단 결과 (온라인 DiagnosisResultView.tsx 의 모바일 M-03 · 데스크탑 D-03).
// 모바일 요약 카드와 데스크탑 사진·제목 카드는 구성이 달라 둘 다 그리고 CSS 가 화면 폭에 맞는 쪽만 보인다.
// 등록 농약은 오프라인 묶음에 없어 상세 정보에서 뺀다 (면책 문구가 안내한다)
function resultHtml(record, photos, refinable) {
  const r = record.result, grade = gradeOf(r);
  const percent = Number.isFinite(r.confidence) ? Math.round(r.confidence * 100) + '%' : '-';
  const actions = r.management_actions || [], causes = r.causes || [], prevention = r.prevention || [];
  const summary = r.summary_message?.trim();
  const actionDetails = r.management_action_details ?? [];
  const actionsHtml = actions.map((title, index) => {
    const detail = actionDetails[index];
    const description = detail?.title === title
      ? detail.description?.trim()
      : '';
    return `<li><strong>${escape(title)}</strong>${
      description ? `<p>${escape(description)}</p>` : ''
    }</li>`;
  }).join('');
  const badge = grade ? `<span class="badge ${grade.tone}"><span class="sr-only">위험 등급 </span>${escape(grade.label)}</span>` : '';
  const uncertain = r.decision_reasons?.includes('low_confidence')
    ? `<p class="rv-uncertain">${ALERT}사진만으로는 확실하지 않아요. 병징이 잘 보이는 사진으로 다시 확인하고, 방제 전에 가까운 농업기술센터에 문의해 보세요.</p>` : '';
  const [photo, second] = photos;
  const pair = second ? `<div class="rv-pair">
      <figure><img src="${photo}" alt="처음 촬영한 작물"><figcaption>1차 촬영</figcaption></figure>
      <figure><img src="${second}" alt="판별부위를 다시 촬영한 사진"><figcaption>판별부위 재촬영</figcaption></figure></div>
    <p class="rv-pair-note${uncertain ? ' warn' : ''}">${uncertain ? '두 장의 사진을 함께 분석했지만 아직 결과가 확실하지 않아요. 병징이 뚜렷한 부위를 다시 확인해 주세요.' : '판별부위 사진까지 함께 분석한 결과예요.'}</p>` : '';
  const saved = `<p class="status">${record.refined_predictions ? '두 사진으로 결과를 갱신했어요. ' : ''}${record.saved ? '이 기기에 저장했어요.' : '기기 저장에 실패했어요. 화면의 결과는 유지돼요.'}</p>
    ${!record.saved ? '<button id="retry-local" type="button">이 기기에 다시 저장</button>' : ''}`;
  // 판별 불가는 병해 결과가 아니라 등급·신뢰도·관리 안내 대신 다시 찍는 방법만 보인다 (온라인 LowConfidencePanel.tsx)
  if (isNotCrop(r)) return `<div class="rv-notices">${saved}</div>
  <section class="card rv-notcrop" aria-label="작물 잎을 찾지 못한 사진 안내">${photo ? `<div class="rv-photo-main"><img src="${photo}" alt="진단한 사진"></div>` : ''}
    <div class="rv-notcrop-text"><h2>잎이 잘 보이게 다시 찍어 주세요</h2><p class="muted">작물이 아닌 사진이거나, 흐리거나 멀리서 찍은 사진일 수 있어요.</p>
      <ul class="rv-tips">${PHOTO_TIPS.map(tip => `<li>${tip}</li>`).join('')}</ul></div></section>`;
  const detail = (title, body) => `<details name="rv-detail"><summary>${title}${CHEVRON}</summary><div class="rv-panel">${body}</div></details>`;
  const missing = text => `<p>${text}</p>`;
  return `<div class="rv-notices">
    ${saved}
    ${r.crop_mismatch ? `<p class="rv-notice warn">선택한 작물은 ${escape(r.selected_crop)}이지만 사진은 ${escape(r.predicted_crop)}로 분류됐어요. 작물 선택과 사진을 확인한 뒤 다시 진단해 주세요.</p>` : ''}
    ${refinable ? '<div class="rv-notice"><p class="rv-notice-title">추가 촬영 안내가 있어요</p><p>아래 안내대로 판별 부위를 한 장 더 찍으면 두 사진으로 다시 확인할 수 있어요.</p></div>'
      : r.decision_reasons?.includes('confusion') ? '<p class="rv-notice warn">후보가 비슷해 추가 확인이 필요해요. 병징이 잘 보이는 사진으로 다시 확인해 주세요.</p>' : ''}
  </div>
  <div class="rv-grid">
    <section class="card rv-photo" aria-label="진단에 사용한 사진과 정보"><h2>진단에 사용한 사진</h2>
      ${pair || `<div class="rv-photo-main">${photo ? `<img src="${photo}" alt="진단한 작물">` : ''}</div>`}
      <dl class="rv-meta"><div><dt>작물</dt><dd>${escape(r.crop_type || '-')}</dd></div><div><dt>진단 시각</dt><dd>${escape(recordTime(record.created_at) || '-')}</dd></div>
        <div><dt>등급</dt><dd>${escape(grade?.label || '-')}</dd></div><div><dt>AI 신뢰도</dt><dd>${percent}</dd></div></dl>
      <p class="caption">AI 신뢰도는 참고 값이며<br>확정 진단을 의미하지 않습니다.</p></section>
    <div class="rv-main">
      <section class="card rv-summary" aria-label="진단 요약"><p class="rv-caption">AI 진단 결과</p>
        <div class="rv-sum-row"><div class="rv-thumb">${photo ? `<img src="${photo}" alt="진단한 작물">` : ''}</div>
          <div class="rv-sum-text">${r.crop_type ? `<p class="rv-caption">${escape(r.crop_type)}</p>` : ''}<h2>${escape(r.disease_name)}</h2>
            <div class="rv-badges">${badge}<p class="rv-caption">신뢰도 ${percent}</p></div></div></div>
        ${summary ? `<p>${escape(summary)}</p>` : ''}
        ${uncertain}${pair}</section>
      <section class="card rv-title"><div class="rv-title-row"><h2>${escape(r.disease_name)}</h2>${badge}</div>
      <p class="muted">${summary ? escape(summary) : '진단 요약을 확인하고, 아래 관리 방법을 참고해주세요.'}</p>${uncertain}</section>
      ${actions.length ? `<section class="card rv-todo" aria-labelledby="rv-todo-title"><div class="rv-todo-head"><h2 id="rv-todo-title">지금 해야 할 일</h2><p class="rv-todo-count">${actions.length}가지</p></div>
        <ol>${actionsHtml}</ol></section>` : ''}
      <section class="rv-details" aria-labelledby="rv-details-title"><h2 id="rv-details-title">상세 정보</h2>
        ${detail('증상', r.description ? `<p class="rv-strong">${escape(r.description)}</p><p>사진 속 증상과 비교해 주세요. AI 진단은 참고용입니다.</p>` : missing('이 병해의 증상 설명을 확인할 수 없어요.'))}
        ${detail('원인', causes.length ? `<ul class="rv-dots">${causes.map(x => `<li>${escape(x)}</li>`).join('')}</ul>` : missing('이 병해의 발병 원인 정보를 확인할 수 없어요.'))}
        ${detail('예방법', prevention.length ? `<ol class="rv-steps">${prevention.map(x => `<li>${escape(x)}</li>`).join('')}</ol>` : missing('이 병해의 예방법 정보를 확인할 수 없어요.'))}
      </section>
    </div>
  </div>`;
}
// 새 진단 화면은 사진 고르기, 진단 결과 화면은 결과(없으면 빈 안내)가 보인다.
// 그 화면의 분석 실패 카드가 떠 있으면 카드만 보인다.
// 누른 버튼이 숨겨졌으면 포커스가 사라지지 않게 화면 제목으로 옮긴다 (화면 전환은 route 가 포커스를 맡아 keep 으로 부른다)
function syncAnalyzeView(keep = false) {
  const focused = document.activeElement, here = view === 'new' || view === 'result';
  const failed = here && Boolean(notices[view]);
  $('analyze-card').hidden = !failed;
  $('diagnosis').hidden = view !== 'new' || failed;
  $('result-view').hidden = view !== 'result' || failed || !current;
  $('result-empty').hidden = view !== 'result' || failed || Boolean(current);
  // 진단 중 버튼이 비활성화되면 포커스가 body 로 빠지기도 한다 (다른 화면을 보는 중에는 옮기지 않는다)
  if (here && !keep && (focused?.closest?.('[hidden]') || !focused || focused === document.body)) $('view-title').focus();
}
async function storeRecord(record) {
  let saved;
  try {
    saved = {...record,saved:true}; await db('records','put',saved);
  } catch (error) {
    savedId = null; renderHeader();
    result({...record,saved:false}); say(message(error));
    // 결과를 보던 화면은 그대로 두고, 진단 기록 화면에 저장 공간 안내를 띄운다
    if (error?.name === 'QuotaExceededError') { storageFull = true; dismissed = null; updateRecordsNotice(); }
    return false;
  }
  storageFull = false; savedId = saved.id; result(saved); toast('이 기기에 저장했어요.'); renderHeader();
  await history().catch(error => { say(message(error)); });
  return true;
}
async function diagnose() {
  if (busy || !selected) return;
  clearSecond();
  const photo = selected, crop = $('crop').value;
  notice('new', null);
  setBusy(true); say('이 기기에서 분석하고 있어요.');
  try {
    const predictions = await predict(photo);
    const record = {id:crypto.randomUUID(), created_at:new Date().toISOString(), file:photo,
      selected_crop:crop || null, predictions, bundle_version:bundle.version, model_version:bundle.model_version,
      preprocessing_version:bundle.preprocessing_version, sync_status:'pending', saved:false,
      result:summarize(bundle,predictions,crop)};
    // 결과가 나오면 진단 결과 화면으로 옮긴다 (분석 중 진단 기록 등 다른 화면으로 갔으면 끌고 오지 않는다).
    // 진단한 사진은 내려 같은 사진을 두 번 진단하지 않게 한다. 결과는 진단 결과 화면에 남는다.
    // 저장에 실패하면 storeRecord 가 원인을 남긴다. 확진이 아니라는 안내는 화면 아래 문구가 한다
    result(record); if (view === 'new') go('result'); resetPhoto();
    if (await storeRecord(record)) $('state').textContent = '';
  } catch (error) { analysisFailed(error, 'new'); }
  finally { setBusy(false); }
}
// 사진 문제는 문구로 알리고, 실행 환경·모델·사진 처리 실패는 그 화면(where)에 분석 실패 카드를 띄운다 (오프라인 자체는 오류가 아니다)
function analysisFailed(error, where) {
  if (error?.input) { say(message(error)); return; }
  $('state').textContent = ''; notice(where, 'local-analysis-failed');
  // 분석 중 다른 탭으로 갔으면 카드가 보이지 않으니 토스트로 알린다. 카드는 그 탭에 돌아오면 보인다
  if (view !== where) toast('이 기기에서 분석하지 못했어요.');
}
async function refine() {
  const file = secondFile;
  if (busy) return;
  // 분석 실패 카드에서 다시 눌렀을 때도 아래 문구가 보이게 카드를 먼저 닫는다.
  // 그사이 서버에 보내 다시 확인할 수 없게 됐으면 카드만 닫고 결과를 보인다
  notice('result', null);
  if (!file || !current || !canRefine(current)) return;
  const base = current;
  if (current.bundle_version !== bundle.version) { say('모델이 변경됐어요. 새 진단을 시작해 주세요.'); return; }
  setBusy(true); say('두 사진으로 다시 확인하고 있어요.');
  try {
    const second = await predict(file);
    const combined = fuse(base.predictions,second,bundle.policy.second_photo_weight);
    const record = {...base,refined_file:file,refined_predictions:second,sync_status:'pending',saved:false,
      result:summarize(bundle,combined,base.selected_crop,true)};
    // 쓴 추가 사진은 내린다. 다시 추가 촬영이 필요하면 새 사진을 고른다 (실패하면 다시 시도하게 남긴다)
    clearSecond(); result(record); if (await storeRecord(record)) $('state').textContent = '';
  } catch (error) { analysisFailed(error, 'result'); }
  finally { setBusy(false); }
}
async function sync(record, button) {
  if (busy) return;
  setBusy(true); button.disabled = true;
  try {
    // Persist before sending: a lost response cannot prove that the server did
    // not commit. Preserve exactly this payload for every subsequent retry.
    record.sync_attempted = true;
    await db('records','put',record);
    if (current?.id === record.id) result(record);
    let response, data;
    if (record.recovery_token) {
      response = await fetch('/api/v1/results/' + record.recovery_token + '/save',{method:'POST'});
      data = await response.json();
      if ((response.status === 410 && data.code === 'RESULT_EXPIRED') ||
          (response.status === 404 && data.code === 'RESULT_NOT_FOUND')) {
        // The draft is gone. Keep the original id and payload so a lost
        // response is still safe to retry through the upload endpoint.
        record.recovery_token = null;
        await db('records','put',record);
      }
    }
    if (!record.recovery_token) {
      const metadata = Object.fromEntries(['selected_crop','created_at','model_version','preprocessing_version','bundle_version','predictions','refined_predictions'].filter(k => record[k] !== undefined).map(k => [k,record[k]]));
      metadata.client_record_id = record.id;
      const body = new FormData(); body.append('metadata',JSON.stringify(metadata)); body.append('file',record.file,'original.jpg');
      if (record.refined_file) body.append('refined_file',record.refined_file,'second.jpg');
      response = await fetch('/api/v1/offline/records',{method:'POST',body});
      data = await response.json();
    }
    if (!response.ok) throw new Error(data.detail || '서버에 저장하지 못했어요.');
    record.sync_status = data.save_status === 'saved' ? 'saved' : 'failed';
    record.server_id = data.id; record.recovery_token = data.recovery_token;
    await db('records','put',record); await history();
    if (current?.id === record.id) result(record);
  } catch (error) {
    record.sync_status = 'failed';
    await db('records','put',record).catch(error => { say(message(error)); });
    say(message(error) + ' 이 기기의 기록은 유지돼요.');
  } finally { setBusy(false); }
}
async function exportRecord(record) {
  const {file,refined_file,...data} = record;
  async function encode(blob) { return new Promise((resolve,reject) => {const reader = new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);}); }
  data.original_photo = await encode(file);
  if (refined_file) data.second_photo = await encode(refined_file);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
  const anchor = document.createElement('a'); anchor.href=url; anchor.download='cropy-'+record.id+'.json'; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function history() {
  for (const url of recordUrls) URL.revokeObjectURL(url); recordUrls.length=0;
  const records = await db('records','getAll'); records.sort((a,b)=>b.created_at.localeCompare(a.created_at));
  // 방금 저장한 기록을 지웠으면 저장 완료도 내린다
  stored = records; if (!records.some(r => r.id === savedId)) savedId = null; updateRecordsNotice();
  $('records-saved').hidden = !records.length;
  $('history').replaceChildren();
  if (!records.length) { $('history').textContent='아직 이 기기에 저장한 기록이 없어요.'; return; }
  for (const record of records) {
    const article = document.createElement('article');
    const title = document.createElement('h3'); title.textContent=record.result.disease_name+(isNotCrop(record.result)?'':' · '+Math.round(record.result.confidence*100)+'%'); article.append(title);
    const detail = document.createElement('p'); detail.className='muted'; detail.textContent=new Date(record.created_at).toLocaleString('ko-KR')+' · '+({saved:'서버 저장 완료',pending:'서버 전송 대기',failed:'서버 전송 실패'}[record.sync_status]); article.append(detail);
    for (const file of [record.file,record.refined_file].filter(Boolean)) { const img=document.createElement('img');const url=URL.createObjectURL(file);recordUrls.push(url);img.src=url;img.alt='저장한 진단 사진';article.append(img); }
    const actions=document.createElement('div');actions.className='row';
    for (const [label, handler, disabled] of [
      ['결과 보기',()=>{result(record);notice('result',null);go('result');},false],
      // 실패해도 목록과 동기화 안내가 새 상태를 보이게 다시 그린다
      ['서버에 저장',async event=>{dismissed=null;await sync(record,event.target);await history();},record.sync_status==='saved'],
      ['내보내기',()=>exportRecord(record),false],['이 기기에서 삭제',async()=>{if(confirm('이 기기의 사진과 기록을 삭제할까요? 내보낸 파일이나 서버 기록은 유지돼요.')){setBusy(true);try {await db('records','delete',null,record.id);if(current?.id===record.id)clearResult();storageFull=false;await history();}finally{setBusy(false);}}},false]]) {
      const button=document.createElement('button');button.textContent=label;button.className='secondary';button.dataset.locked=String(disabled);button.disabled=busy || disabled;
      button.addEventListener('click',event=>{if(busy)return;Promise.resolve(handler(event)).catch(error=>{say(message(error));});});actions.append(button);
    }
    article.append(actions);$('history').append(article);
  }
}
$('prepare').addEventListener('click',prepare);
// 업데이트: 준비 화면에서 새 파일을 받는다. 검증이 끝나야 교체되고, 실패하면 기존 파일로 계속 쓴다 (prepare 의 catch)
$('update-accept').addEventListener('click',()=>{$('update-dialog').close();go('prepare');prepare();});
$('update-later').addEventListener('click',()=>$('update-dialog').close());
// Esc 로 닫아도 나중에와 같다. 닫히면 머리를 원래 상태로 되돌린다
$('update-dialog').addEventListener('close',renderHeader);
addEventListener('online',checkUpdate);
// 진단 시작: 새 진단 화면으로만 간다. 갤러리·카메라 중 무엇으로 고를지는 사용자가 정한다
$('start').addEventListener('click',()=>go('new'));
$('manage').addEventListener('click',()=>{go('records');$('records').scrollIntoView();});
// 분석 실패 카드: 같은 사진으로 다시 분석하거나, 카드를 닫고 다른 사진을 고른다.
// 진단 결과 화면의 카드는 추가 사진 확인 실패, 새 진단 화면의 카드는 진단 실패다
$('analyze-card').querySelector('[data-act="primary"]').addEventListener('click',()=>view==='result'?refine():diagnose());
$('analyze-card').querySelector('[data-act="secondary"]').addEventListener('click',()=>{
  // 다른 사진: 앞서 고른 곳(카메라·갤러리)을 다시 연다. 누른 그 자리에서 열어야 브라우저가 막지 않는다
  if(view==='result'){notice('result',null);if(canRefine(current))pickSecond(secondSource);return;}
  notice('new',null);pickPhoto(photoSource);
});
// 기록 안내 카드: 저장 공간 관리는 목록으로, 동기화 재시도는 실패한 기록을 차례로 다시 보낸다
$('records-card').querySelector('[data-act="primary"]').addEventListener('click',async event=>{
  if(busy)return;
  if(notices.records==='storage-full'){$('records').scrollIntoView({behavior:'smooth'});return;}
  // await 뒤에는 event.currentTarget 이 비므로 버튼을 먼저 잡아 둔다
  const button=event.currentTarget;dismissed=null;
  for(const record of stored.filter(r=>r.sync_status==='failed'))await sync(record,button);
  await history().catch(error=>{say(message(error));});
});
$('records-card').querySelector('[data-act="secondary"]').addEventListener('click',()=>{dismissed=notices.records;notice('records',null);});
addEventListener('hashchange',()=>route(true));
// 진단 기록에서 진단 이력을 다시 누르면 hashchange 가 없으니 직접 다시 읽는다
for(const link of document.querySelectorAll('[data-nav="records"]'))link.addEventListener('click',event=>{if(location.hash==='#records'&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){event.preventDefault();go('records');}});
addEventListener('online',updateRecordsNotice);addEventListener('offline',updateRecordsNotice);
// 나중에: 카드를 접고 다시 펼칠 버튼만 남긴다 (준비 버튼이 모두 카드 안에 있다)
$('later').addEventListener('click',()=>{$('status-card').hidden=true;$('resume').hidden=false;$('resume').focus();});
$('resume').addEventListener('click',()=>{$('status-card').hidden=false;$('resume').hidden=true;$('status-title').focus();});
// 사진 고르기 (온라인 새 진단 M-01-0·RecapturePanel). 갤러리 입력(#file·#second)과 카메라 입력(capture)을 따로 연다.
// 데스크탑 브라우저는 capture 를 무시하고 파일 선택창을 열어 "카메라로 촬영" 이 맞지 않으므로 카메라 버튼을 숨긴다
const pickPhoto = source => (source==='camera'?$('file-camera'):$('file')).click();
const pickSecond = source => (source==='gallery'?$('second'):$('second-camera')).click();
if(desktop)for(const id of ['pick-camera','second-pick-camera'])$(id).hidden=true;
// 추가 사진을 고르면 "두 사진으로 다시 확인" 이 주 버튼이 되고 고르기 버튼은 보조로 내린다. 데스크탑은 갤러리가 주 버튼이다
function secondRoles(picked){
  $('second-pick-camera').classList.toggle('secondary',picked);
  $('second-pick-gallery').classList.toggle('secondary',picked||!desktop);
}
secondRoles(false);
// 고르기 전에는 점선 자리와 고르기 버튼, 고른 뒤에는 미리보기와 진단 버튼
function showPhoto(shown){
  $('dropzone').hidden=shown;$('pick-actions').classList.toggle('hidden',shown);
  $('selected-actions').classList.toggle('hidden',!shown);$('preview').classList.toggle('hidden',!shown);
}
function onPhoto(source,input){
  const file=input.files[0];
  // 고르기를 취소하면 빈 change 가 올 수 있다. 앞서 고른 사진을 그대로 둔다
  if(!file)return;
  // 같은 사진을 다시 골라도 change 가 오게 비운다 (고른 파일은 selected 가 갖는다)
  input.value='';
  // 새 사진을 고르면 진단 실패 카드를 닫는다. 지난 결과는 진단 결과 화면에 그대로 둔다
  selected=file;photoSource=source;savedId=null;notice('new',null);if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl=URL.createObjectURL(file);$('preview').src=previewUrl;
  $('pick-again').textContent=source==='camera'?'다른 사진 촬영하기':'다른 사진 선택하기';
  showPhoto(true);setBusy(busy);
  // 누른 고르기 버튼이 숨었으면 포커스가 사라지지 않게 진단 버튼(못 누르면 카드 제목)으로 옮긴다
  const focused=document.activeElement;
  if(!focused||focused===document.body||focused.closest('#pick-actions,#dropzone'))
    ($('diagnose').disabled?$('diagnosis-title'):$('diagnose')).focus();
}
function onSecond(source,input){
  const file=input.files[0];
  if(!file)return;
  input.value='';secondFile=file;secondSource=source;
  $('second-name').textContent=`고른 추가 사진: ${file.name}`;$('refine').hidden=false;secondRoles(true);setBusy(busy);
}
$('file').addEventListener('change',()=>onPhoto('gallery',$('file')));
$('file-camera').addEventListener('change',()=>onPhoto('camera',$('file-camera')));
$('second').addEventListener('change',()=>onSecond('gallery',$('second')));
$('second-camera').addEventListener('change',()=>onSecond('camera',$('second-camera')));
$('dropzone').addEventListener('click',()=>pickPhoto('gallery'));
$('pick-gallery').addEventListener('click',()=>pickPhoto('gallery'));
$('pick-camera').addEventListener('click',()=>pickPhoto('camera'));
$('pick-again').addEventListener('click',()=>pickPhoto(photoSource));
$('second-pick-camera').addEventListener('click',()=>pickSecond('camera'));
$('second-pick-gallery').addEventListener('click',()=>pickSecond('gallery'));
$('diagnose').addEventListener('click',diagnose);$('refine').addEventListener('click',refine);
// 고른 사진과 미리보기를 내린다 (진단을 마쳤거나 새 사진으로 진단하기). 결과는 진단 결과 화면에 남는다
function resetPhoto(){
  selected=null;photoSource='gallery';$('file').value='';$('file-camera').value='';
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;showPhoto(false);
  savedId=null;setBusy(busy);
}
// 새 사진으로 진단하기·빈 결과의 새 진단 시작하기: 새 진단 화면으로 가서 사진 고르기를 보인다.
// 갤러리·카메라 중 무엇으로 고를지는 사용자가 정한다. 준비된 모델이 없으면 route 가 준비 화면으로 보낸다
function startNew(){
  if(busy)return;
  resetPhoto();notice('new',null);go('new');
}
$('new-photo').addEventListener('click',startNew);$('empty-new').addEventListener('click',startNew);
// 새 진단 화면에서 새 진단 탭을 다시 누르면 떠 있던 진단 실패 카드를 닫는다 (같은 # 이라 hashchange 가 없어도 notice 가 다시 그린다).
// 다른 탭에서 돌아올 때는 아직 보지 못한 실패 카드를 그대로 보인다
for(const link of document.querySelectorAll('[data-nav="new"]'))link.addEventListener('click',()=>{if(!busy&&view==='new'&&notices.new)notice('new',null);});
$('speak').addEventListener('click',()=>{
  if(!current||!('speechSynthesis'in window)){ say('음성 안내를 사용할 수 없어요.');return; }
  const voice=speechSynthesis.getVoices().find(v=>v.localService&&v.lang.startsWith('ko'));
  if(!voice){say('이 기기에 한국어 오프라인 음성이 없어요. 글로 확인해 주세요.');return;}
  speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(isNotCrop(current.result)?'작물 잎을 찾지 못했어요. 잎이 잘 보이게 다시 찍어 주세요.':current.result.disease_name+'으로 분류됐어요. 확진을 뜻하지 않아요. '+current.result.description);speech.voice=voice;speech.lang='ko-KR';speech.onerror=()=>{say('음성 안내를 시작하지 못했어요.');};speechSynthesis.speak(speech);
});
// 연결 없이 다른 화면 링크를 누르면 메인 워커가 이동을 막고 알려 준다(public/sw.js)
navigator.serviceWorker?.addEventListener('message',event=>{
  if(event.data?.type==='cropy-offline-stay')say('인터넷에 연결되어 있지 않아 이 화면에 머물러요. 연결되면 다시 눌러 주세요.');
});
// 주소의 # 화면을 먼저 보인다. 모델을 다 불러온 뒤 한 번 더 확인한다 (없으면 새 진단 대신 준비 화면)
route();
try {
  const cached=await db('assets','get',null,'active');
  if(cached){bundle=cached.manifest;session=await initSession(cached.model);show('ready');$('progress').value=100;}
  else show('not-ready');
} catch(error){show('not-ready');$('ready').textContent=message(error);}
await history().catch(error => { say(message(error)); });
setBusy(false);
loaded=true;route();checkUpdate();
// 설치 안내의 "오프라인 파일 받기"는 ?prepare=1 로 들어와 바로 받기를 시작한다.
// 새로고침해도 다시 받지 않게 주소에서 지운다
if(!session&&new URLSearchParams(location.search).has('prepare')){window.history.replaceState(null,'',location.pathname);prepare();}
