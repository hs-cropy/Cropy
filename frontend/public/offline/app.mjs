import * as ort from '/offline-runtime/ort.wasm.bundle.min.mjs';
import { softmax, distribution, fuse, summarize } from './core.mjs';

ort.env.wasm.wasmPaths = '/offline-runtime/';
ort.env.wasm.numThreads = 1;
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bundle, session, selected, current, download, busy = false;
let previewUrl;
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
  if (error?.name === 'AbortError') return '받기를 중단했어요. 다시 준비하면 처음부터 받아요. 기존 모델은 유지돼요.';
  return error?.message || '처리하지 못했어요. 사진과 기존 기록은 유지돼요.';
}
function setBusy(value) {
  busy = value;
  $('diagnose').disabled = value || !session || !selected;
  $('refine').disabled = value || !current;
  $('prepare').disabled = value;
  for (const id of ['file','crop','second','reload']) $(id).disabled = value;
  for (const button of $('history').querySelectorAll('button')) button.disabled = value || button.dataset.locked === 'true';
}
async function initSession(model) {
  return ort.InferenceSession.create(new Uint8Array(model), {executionProviders:['wasm']});
}
async function prepare() {
  if (busy) return;
  setBusy(true); $('pause').disabled = false; $('ready').textContent = '필요한 파일을 받는 중이에요.';
  download = new AbortController();
  let candidate;
  try {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) throw new Error('이 기능은 HTTPS 또는 localhost에서 사용할 수 있어요.');
    await navigator.serviceWorker.register('/offline/sw.js', {scope:'/offline/'});
    await navigator.serviceWorker.ready;
    const res = await fetch('/offline-assets/manifest.json', {cache:'no-store', signal:download.signal});
    if (!res.ok) throw new Error('오프라인 모델 묶음을 찾을 수 없어요. 서버에서 모델을 준비해 주세요.');
    const next = await res.json();
    const response = await fetch(next.model_url, {signal:download.signal});
    if (!response.ok || !response.body) throw new Error('모델을 받지 못했어요. 연결을 확인하고 다시 준비해 주세요.');
    const chunks = []; let received = 0;
    const reader = response.body.getReader();
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      chunks.push(value); received += value.length;
      $('progress').value = Math.min(99, received / next.model_bytes * 100);
    }
    if (received !== next.model_bytes) throw new Error('모델 파일 크기가 일치하지 않아요. 다시 준비해 주세요.');
    const model = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { model.set(chunk, offset); offset += chunk.length; }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', model)), x => x.toString(16).padStart(2,'0')).join('');
    if (hash !== next.sha256) throw new Error('모델 검증에 실패했어요. 이전 모델을 유지합니다.');
    $('ready').textContent = '이 기기에서 모델을 실행할 수 있는지 확인하고 있어요.';
    candidate = await initSession(model.buffer);
    await db('assets','put',{manifest:next,model:model.buffer},'active');
    const previous = session;
    session = candidate; candidate = null; bundle = next;
    if (previous) await previous.release().catch(() => {});
    $('progress').value = 100;
    $('ready').textContent = '이 기기에서 오프라인 진단할 준비가 됐어요.';
    await navigator.storage?.persist?.();
  } catch (error) {
    if (candidate) await candidate.release();
    $('ready').textContent = message(error) + (session ? ' 기존 모델로 진단할 수 있어요.' : '');
  } finally { download = null; $('pause').disabled = true; setBusy(false); }
}
async function predict(file) {
  if (!session) throw new Error('모델을 먼저 준비해 주세요.');
  if (!['image/jpeg','image/png'].includes(file.type)) throw new Error('JPEG 또는 PNG 사진을 선택해 주세요.');
  if (file.size > (bundle.upload?.max_bytes || 10 * 1024 * 1024)) throw new Error('사진 용량이 너무 커요. 더 작은 사진을 선택해 주세요.');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > (bundle.upload?.max_pixels || 40000000)) { bitmap.close(); throw new Error('사진 해상도가 너무 커요.'); }
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
  current = record; const r = record.result;
  $('result').innerHTML = `<h2>${escape(r.disease_name)} · ${Math.round(r.confidence*100)}%</h2>
    <p class="status">${record.refined_predictions ? '두 사진으로 결과를 갱신했어요. ' : ''}${record.saved ? '이 기기에 저장했어요.' : '기기 저장에 실패했어요. 화면의 결과는 유지돼요.'}</p>
    ${r.decision_reasons.length ? `<p class="status danger">${r.decision_reasons.map(x => ({crop_mismatch:'선택한 작물과 사진 분류가 달라요',confusion:'후보가 비슷해 추가 확인이 필요해요',low_confidence:'사진만으로 판단이 어려워요'}[x])).map(escape).join(' · ')}</p>` : ''}
    <ul>${r.top_predictions.map(p => `<li>${escape(p.name)} ${Math.round(p.confidence*100)}%</li>`).join('')}</ul>
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
  } catch (error) { result({...record,saved:false}); $('state').textContent = message(error); return false; }
  result(saved);
  await history().catch(error => { $('state').textContent = message(error); });
  return true;
}
async function diagnose() {
  if (busy || !selected) return;
  const photo = selected, crop = $('crop').value;
  setBusy(true); $('state').textContent = '이 기기에서 분석하고 있어요.';
  try {
    const predictions = await predict(photo);
    const record = {id:crypto.randomUUID(), created_at:new Date().toISOString(), file:photo,
      selected_crop:crop || null, predictions, bundle_version:bundle.version, model_version:bundle.model_version,
      preprocessing_version:bundle.preprocessing_version, sync_status:'pending', saved:false,
      result:summarize(bundle,predictions,crop)};
    result(record); if (await storeRecord(record)) $('state').textContent = '모델 분류는 확진을 뜻하지 않아요.';
  } catch (error) { $('state').textContent = message(error); }
  finally { setBusy(false); }
}
async function refine() {
  const file = $('second').files[0];
  if (busy || !file || !current || current.sync_attempted || current.sync_status === 'saved' || current.recovery_token) return;
  const base = current;
  if (current.bundle_version !== bundle.version) { $('state').textContent = '모델이 변경됐어요. 새 진단을 시작해 주세요.'; return; }
  setBusy(true); $('state').textContent = '두 사진으로 다시 확인하고 있어요.';
  try {
    const second = await predict(file);
    const combined = fuse(base.predictions,second,bundle.policy.second_photo_weight);
    const record = {...base,refined_file:file,refined_predictions:second,sync_status:'pending',saved:false,
      result:summarize(bundle,combined,base.selected_crop)};
    result(record); if (await storeRecord(record)) $('state').textContent = '재촬영 결과를 확인해 주세요.';
  } catch (error) { $('state').textContent = message(error); }
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
    let response;
    if (record.recovery_token) response = await fetch('/api/v1/results/' + record.recovery_token + '/save',{method:'POST'});
    else {
      const metadata = Object.fromEntries(['selected_crop','created_at','model_version','preprocessing_version','bundle_version','predictions','refined_predictions'].filter(k => record[k] !== undefined).map(k => [k,record[k]]));
      metadata.client_record_id = record.id;
      const body = new FormData(); body.append('metadata',JSON.stringify(metadata)); body.append('file',record.file,'original.jpg');
      if (record.refined_file) body.append('refined_file',record.refined_file,'second.jpg');
      response = await fetch('/api/v1/offline/records',{method:'POST',body});
    }
    const data = await response.json();
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
  $('history').replaceChildren();
  if (!records.length) { $('history').textContent='아직 이 기기에 저장한 기록이 없어요.'; return; }
  for (const record of records) {
    const article = document.createElement('article');
    const title = document.createElement('h3'); title.textContent=record.result.disease_name + ' · ' + Math.round(record.result.confidence*100)+'%'; article.append(title);
    const detail = document.createElement('p'); detail.className='muted'; detail.textContent=new Date(record.created_at).toLocaleString('ko-KR')+' · '+({saved:'서버 저장 완료',pending:'서버 전송 대기',failed:'서버 전송 실패'}[record.sync_status]); article.append(detail);
    for (const file of [record.file,record.refined_file].filter(Boolean)) { const img=document.createElement('img');const url=URL.createObjectURL(file);recordUrls.push(url);img.src=url;img.alt='저장한 진단 사진';article.append(img); }
    const actions=document.createElement('div');actions.className='row';
    for (const [label, handler, disabled] of [
      ['결과 보기',()=>result(record),false],['서버에 저장',event=>sync(record,event.target),record.sync_status==='saved'],
      ['내보내기',()=>exportRecord(record),false],['이 기기에서 삭제',async()=>{if(confirm('이 기기의 사진과 기록을 삭제할까요? 내보낸 파일이나 서버 기록은 유지돼요.')){setBusy(true);try {await db('records','delete',null,record.id);if(current?.id===record.id){current=null;$('result').replaceChildren();$('refine-area').classList.add('hidden');$('speak').disabled=true;}await history();}finally{setBusy(false);}}},false]]) {
      const button=document.createElement('button');button.textContent=label;button.className='secondary';button.dataset.locked=String(disabled);button.disabled=busy || disabled;
      button.addEventListener('click',event=>{if(busy)return;Promise.resolve(handler(event)).catch(error=>{$('state').textContent=message(error);});});actions.append(button);
    }
    article.append(actions);$('history').append(article);
  }
}
$('prepare').addEventListener('click',prepare);
$('pause').addEventListener('click',()=>download?.abort());
$('file').addEventListener('change',()=>{
  selected=$('file').files[0];if(previewUrl)URL.revokeObjectURL(previewUrl);
  if(selected){previewUrl=URL.createObjectURL(selected);$('preview').src=previewUrl;$('preview').classList.remove('hidden');}
  setBusy(busy);
});
$('diagnose').addEventListener('click',diagnose);$('refine').addEventListener('click',refine);
$('reload').addEventListener('click',()=>history().catch(error=>{$('state').textContent=message(error);}));
$('speak').addEventListener('click',()=>{
  if(!current||!('speechSynthesis'in window)){ $('state').textContent='음성 안내를 사용할 수 없어요.';return; }
  const voice=speechSynthesis.getVoices().find(v=>v.localService&&v.lang.startsWith('ko'));
  if(!voice){$('state').textContent='이 기기에 한국어 오프라인 음성이 없어요. 글로 확인해 주세요.';return;}
  speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(current.result.disease_name+'으로 분류됐어요. 확진을 뜻하지 않아요. '+current.result.description);speech.voice=voice;speech.lang='ko-KR';speech.onerror=()=>{$('state').textContent='음성 안내를 시작하지 못했어요.';};speechSynthesis.speak(speech);
});
try {
  const cached=await db('assets','get',null,'active');
  if(cached){bundle=cached.manifest;session=await initSession(cached.model);$('ready').textContent='저장한 모델로 이 기기에서 진단할 수 있어요.';$('progress').value=100;}
  else $('ready').textContent='연결된 상태에서 모델을 먼저 준비해 주세요.';
  await history();
} catch(error){$('ready').textContent=message(error);}
setBusy(false);
