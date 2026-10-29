import * as ort from '/offline-runtime/ort.wasm.bundle.min.mjs';
import { softmax, distribution, fuse, summarize, failurePhase, viewFromHash, recordsNotice, updateAvailable, isDesktopDevice } from './core.mjs';

ort.env.wasm.wasmPaths = '/offline-runtime/';
ort.env.wasm.numThreads = 1;
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bundle, session, selected, current, busy = false;
let previewUrl;
// 지금 보이는 화면, 저장된 모델을 다 불러왔는지, 기록 저장 공간이 모자랐는지, 나중에로 닫은 기록 안내
// offered: 이번 접속에서 업데이트를 이미 물었는지 (나중에를 누르면 다시 묻지 않는다)
// savedId: 방금 기기에 저장한 기록 (새 사진을 고를 때까지 머리에 저장 완료를 보인다)
let view = 'prepare', loaded = false, storageFull = false, dismissed = null, offered = false, savedId = null;
let stored = [], retryAnalysis, toastTimer;
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
// 사진 분석·진단 기록 화면의 안내 카드 (Offline/Mobile/local-analysis-failed, storage-full, sync-pending, sync-failed).
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
  analyze: {title:'사진 분석', lead:'사진은 이 기기에서 분석돼요.'},
  records: {title:'진단 기록', lead:'인터넷 없이도 이 기기에 저장된 기록을 볼 수 있어요.'},
};
// 업데이트 다이얼로그가 떠 있는 동안의 준비 화면 머리 (Offline/Mobile/model-update)
const UPDATE = {label:'업데이트 가능', lead:'현재 준비된 파일로 오프라인 진단을 계속할 수 있어요.'};
// 기기에 저장한 직후의 사진 분석·진단 기록 화면 머리 (Offline/Mobile/local-saved). 부제는 화면 기본값이다
const SAVED = {label:'기기 저장 완료'};
const notices = {analyze:null, records:null};
// 준비 화면은 준비 카드의 상태, 나머지 화면은 떠 있는 안내 카드가 상태 라벨과 부제를 정한다.
// 안내 카드가 없고 방금 저장했으면 저장 완료다. 사진 분석 화면은 그 기록의 결과를 볼 때만이다
function renderHeader() {
  const saved = savedId !== null && (view === 'records' || current?.id === savedId);
  const entry = view === 'prepare'
    ? ($('update-dialog').open ? UPDATE : phaseText(PHASES[$('status-card').dataset.phase]))
    : NOTICES[notices[view]] || (saved ? SAVED : undefined);
  $('view-title').textContent = VIEWS[view].title;
  $('phase-lead').textContent = entry?.lead || VIEWS[view].lead;
  $('phase-label').textContent = entry?.label || ''; $('phase-label').hidden = !entry;
}
// 사진 분석(analyze)·진단 기록(records) 화면의 안내 카드를 띄우거나(name) 닫는다(null)
function notice(where, name) {
  const card = $(where + '-card'), entry = NOTICES[name];
  const focused = document.activeElement;
  notices[where] = entry ? name : null;
  card.hidden = !entry;
  if (where === 'analyze') $('diagnosis').hidden = Boolean(entry);
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
  if (focused?.closest('[hidden]') || !focused || focused === document.body) (entry ? card.querySelector('h2') : $('view-title')).focus();
}
// 기록 저장 공간 부족이 동기화 안내보다 먼저다. 나중에로 닫은 안내는 다시 동기화를 누를 때까지 띄우지 않는다
function updateRecordsNotice() {
  const name = storageFull ? 'storage-full' : recordsNotice(stored, navigator.onLine);
  notice('records', name === dismissed ? null : name);
}
function route(focus) {
  const wanted = viewFromHash(location.hash);
  // 준비된 모델이 없으면 진단 대신 준비 화면이다 (모델을 불러오는 동안은 기다린다).
  // 기록의 결과 보기는 모델 없이도 되어야 해서, 볼 결과가 있으면 그대로 둔다
  view = wanted === 'analyze' && loaded && !session && !current ? 'prepare' : wanted;
  if (view !== wanted) window.history.replaceState(null, '', '#prepare');
  for (const section of document.querySelectorAll('main > [data-view]')) section.hidden = section.dataset.view !== view;
  // 진단 탭은 준비·사진 분석 화면 모두에서 켜진다 (Figma 내비 Diagnosis)
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === (view === 'records' ? 'records' : 'analyze')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  renderHeader();
  if (focus) { scrollTo(0, 0); $('view-title').focus(); }
  // 진단 기록은 들어올 때마다 다시 읽는다 (다른 창에서 저장한 기록도 보인다). 처음 그릴 때는 부팅이 읽는다
  if (focus && view === 'records') history().catch(error => { $('state').textContent = message(error); });
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
  for (const id of ['file','crop','second']) $(id).disabled = value;
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
  if (current?.id !== record.id) $('second').value = '';
  current = record; const r = record.result;
  // 판별 불가는 병해 확률이 아니므로 점수와 후보를 보이지 않는다
  const other = r.category === 'other';
  $('result').innerHTML = `<h2>${escape(r.disease_name)}${other ? '' : ` · ${Math.round(r.confidence*100)}%`}</h2>
    <p class="status">${record.refined_predictions ? '두 사진으로 결과를 갱신했어요. ' : ''}${record.saved ? '이 기기에 저장했어요.' : '기기 저장에 실패했어요. 화면의 결과는 유지돼요.'}</p>
    ${r.decision_reasons.length ? `<p class="status danger">${r.decision_reasons.map(x => ({not_crop:'고추·무·배추 잎으로 알아보기 어려워요. 잎이 잘 보이게 다시 찍어 주세요',crop_mismatch:'선택한 작물과 사진 분류가 달라요',confusion:'후보가 비슷해 추가 확인이 필요해요',low_confidence:'사진만으로 판단이 어려워요'}[x])).map(escape).join(' · ')}</p>` : ''}
    ${other ? '' : `<ul>${r.top_predictions.map(p => `<li>${escape(p.name)} ${Math.round(p.confidence*100)}%</li>`).join('')}</ul>`}
    <p>${escape(r.description)}</p><details><summary>원인·예방·관리 안내</summary>
    <ul>${[...r.causes,...r.prevention].map(x => `<li>${escape(x)}</li>`).join('')}</ul></details>
    ${!record.saved ? '<button id="retry-local">이 기기에 다시 저장</button>' : ''}`;
  $('refine-area').classList.toggle('hidden', !r.recapture || Boolean(record.sync_attempted) || record.sync_status === 'saved' || Boolean(record.recovery_token));
  $('guidance').textContent = r.recapture ? r.recapture.instruction + ' ' + r.recapture.candidates.map(c => c.cue).join(' ') : '';
  $('speak').disabled = false;
  $('retry-local')?.addEventListener('click', async () => {if (busy) return; setBusy(true); try {await storeRecord(record);} finally {setBusy(false);}});
}
async function storeRecord(record) {
  let saved;
  try {
    saved = {...record,saved:true}; await db('records','put',saved);
  } catch (error) {
    savedId = null; renderHeader();
    result({...record,saved:false}); $('state').textContent = message(error);
    // 결과를 보던 화면은 그대로 두고, 진단 기록 화면에 저장 공간 안내를 띄운다
    if (error?.name === 'QuotaExceededError') { storageFull = true; dismissed = null; updateRecordsNotice(); }
    return false;
  }
  storageFull = false; savedId = saved.id; result(saved); toast('이 기기에 저장했어요.'); renderHeader();
  await history().catch(error => { $('state').textContent = message(error); });
  return true;
}
async function diagnose() {
  if (busy || !selected) return;
  $('second').value = '';
  const photo = selected, crop = $('crop').value;
  notice('analyze', null);
  setBusy(true); $('state').textContent = '이 기기에서 분석하고 있어요.';
  try {
    const predictions = await predict(photo);
    const record = {id:crypto.randomUUID(), created_at:new Date().toISOString(), file:photo,
      selected_crop:crop || null, predictions, bundle_version:bundle.version, model_version:bundle.model_version,
      preprocessing_version:bundle.preprocessing_version, sync_status:'pending', saved:false,
      result:summarize(bundle,predictions,crop)};
    result(record); if (await storeRecord(record)) $('state').textContent = '모델 분류는 확진을 뜻하지 않아요.';
  } catch (error) { analysisFailed(error, diagnose); }
  finally { setBusy(false); }
}
// 사진 문제는 문구로 알리고, 실행 환경·모델·사진 처리 실패는 분석 실패 카드를 띄운다 (오프라인 자체는 오류가 아니다)
function analysisFailed(error, retry) {
  if (error?.input) { $('state').textContent = message(error); return; }
  $('state').textContent = ''; retryAnalysis = retry; notice('analyze', 'local-analysis-failed');
}
async function refine() {
  const file = $('second').files[0];
  if (busy || !file || !current || current.sync_attempted || current.sync_status === 'saved' || current.recovery_token) return;
  const base = current;
  // 분석 실패 카드에서 다시 눌렀을 때도 아래 문구가 보이게 카드를 먼저 닫는다
  notice('analyze', null);
  if (current.bundle_version !== bundle.version) { $('state').textContent = '모델이 변경됐어요. 새 진단을 시작해 주세요.'; return; }
  setBusy(true); $('state').textContent = '두 사진으로 다시 확인하고 있어요.';
  try {
    const second = await predict(file);
    const combined = fuse(base.predictions,second,bundle.policy.second_photo_weight);
    const record = {...base,refined_file:file,refined_predictions:second,sync_status:'pending',saved:false,
      result:summarize(bundle,combined,base.selected_crop)};
    result(record); if (await storeRecord(record)) $('state').textContent = '재촬영 결과를 확인해 주세요.';
  } catch (error) { analysisFailed(error, refine); }
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
    await db('records','put',record).catch(error => { $('state').textContent = message(error); });
    $('state').textContent = message(error) + ' 이 기기의 기록은 유지돼요.';
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
    const title = document.createElement('h3'); title.textContent=record.result.disease_name + ' · ' + Math.round(record.result.confidence*100)+'%'; article.append(title);
    const detail = document.createElement('p'); detail.className='muted'; detail.textContent=new Date(record.created_at).toLocaleString('ko-KR')+' · '+({saved:'서버 저장 완료',pending:'서버 전송 대기',failed:'서버 전송 실패'}[record.sync_status]); article.append(detail);
    for (const file of [record.file,record.refined_file].filter(Boolean)) { const img=document.createElement('img');const url=URL.createObjectURL(file);recordUrls.push(url);img.src=url;img.alt='저장한 진단 사진';article.append(img); }
    const actions=document.createElement('div');actions.className='row';
    for (const [label, handler, disabled] of [
      ['결과 보기',()=>{result(record);notice('analyze',null);go('analyze');},false],
      // 실패해도 목록과 동기화 안내가 새 상태를 보이게 다시 그린다
      ['서버에 저장',async event=>{dismissed=null;await sync(record,event.target);await history();},record.sync_status==='saved'],
      ['내보내기',()=>exportRecord(record),false],['이 기기에서 삭제',async()=>{if(confirm('이 기기의 사진과 기록을 삭제할까요? 내보낸 파일이나 서버 기록은 유지돼요.')){setBusy(true);try {await db('records','delete',null,record.id);if(current?.id===record.id){current=null;$('result').replaceChildren();$('refine-area').classList.add('hidden');$('speak').disabled=true;}storageFull=false;await history();}finally{setBusy(false);}}},false]]) {
      const button=document.createElement('button');button.textContent=label;button.className='secondary';button.dataset.locked=String(disabled);button.disabled=busy || disabled;
      button.addEventListener('click',event=>{if(busy)return;Promise.resolve(handler(event)).catch(error=>{$('state').textContent=message(error);});});actions.append(button);
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
$('start').addEventListener('click',()=>{go('analyze');$('file').click();});
$('manage').addEventListener('click',()=>{go('records');$('records').scrollIntoView();});
// 분석 실패 카드: 같은 사진으로 다시 분석하거나, 카드를 닫고 다른 사진을 고른다
$('analyze-card').querySelector('[data-act="primary"]').addEventListener('click',()=>retryAnalysis?.());
$('analyze-card').querySelector('[data-act="secondary"]').addEventListener('click',()=>{notice('analyze',null);$('file').click();});
// 기록 안내 카드: 저장 공간 관리는 목록으로, 동기화 재시도는 실패한 기록을 차례로 다시 보낸다
$('records-card').querySelector('[data-act="primary"]').addEventListener('click',async event=>{
  if(busy)return;
  if(notices.records==='storage-full'){$('records').scrollIntoView({behavior:'smooth'});return;}
  // await 뒤에는 event.currentTarget 이 비므로 버튼을 먼저 잡아 둔다
  const button=event.currentTarget;dismissed=null;
  for(const record of stored.filter(r=>r.sync_status==='failed'))await sync(record,button);
  await history().catch(error=>{$('state').textContent=message(error);});
});
$('records-card').querySelector('[data-act="secondary"]').addEventListener('click',()=>{dismissed=notices.records;notice('records',null);});
addEventListener('hashchange',()=>route(true));
// 진단 기록에서 진단 이력을 다시 누르면 hashchange 가 없으니 직접 다시 읽는다
for(const link of document.querySelectorAll('[data-nav="records"]'))link.addEventListener('click',event=>{if(location.hash==='#records'&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){event.preventDefault();go('records');}});
addEventListener('online',updateRecordsNotice);addEventListener('offline',updateRecordsNotice);
// 나중에: 카드를 접고 다시 펼칠 버튼만 남긴다 (준비 버튼이 모두 카드 안에 있다)
$('later').addEventListener('click',()=>{$('status-card').hidden=true;$('resume').hidden=false;$('resume').focus();});
$('resume').addEventListener('click',()=>{$('status-card').hidden=false;$('resume').hidden=true;$('status-title').focus();});
$('file').addEventListener('change',()=>{
  selected=$('file').files[0];savedId=null;notice('analyze',null);if(previewUrl)URL.revokeObjectURL(previewUrl);
  if(selected){previewUrl=URL.createObjectURL(selected);$('preview').src=previewUrl;$('preview').classList.remove('hidden');}
  setBusy(busy);
});
$('diagnose').addEventListener('click',diagnose);$('refine').addEventListener('click',refine);
$('speak').addEventListener('click',()=>{
  if(!current||!('speechSynthesis'in window)){ $('state').textContent='음성 안내를 사용할 수 없어요.';return; }
  const voice=speechSynthesis.getVoices().find(v=>v.localService&&v.lang.startsWith('ko'));
  if(!voice){$('state').textContent='이 기기에 한국어 오프라인 음성이 없어요. 글로 확인해 주세요.';return;}
  speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(current.result.disease_name+'으로 분류됐어요. 확진을 뜻하지 않아요. '+current.result.description);speech.voice=voice;speech.lang='ko-KR';speech.onerror=()=>{$('state').textContent='음성 안내를 시작하지 못했어요.';};speechSynthesis.speak(speech);
});
// 주소의 # 화면을 먼저 보인다. 모델을 다 불러온 뒤 한 번 더 확인한다 (없으면 사진 분석 대신 준비 화면)
route();
try {
  const cached=await db('assets','get',null,'active');
  if(cached){bundle=cached.manifest;session=await initSession(cached.model);show('ready');$('progress').value=100;}
  else show('not-ready');
} catch(error){show('not-ready');$('ready').textContent=message(error);}
await history().catch(error => { $('state').textContent=message(error); });
setBusy(false);
loaded=true;route();checkUpdate();
// 설치 안내의 "오프라인 파일 받기"는 ?prepare=1 로 들어와 바로 받기를 시작한다.
// 새로고침해도 다시 받지 않게 주소에서 지운다
if(!session&&new URLSearchParams(location.search).has('prepare')){window.history.replaceState(null,'',location.pathname);prepare();}
