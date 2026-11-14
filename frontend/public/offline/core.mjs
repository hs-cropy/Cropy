export function softmax(logits) {
  const max = Math.max(...logits);
  const values = Array.from(logits, x => Math.exp(x - max));
  const sum = values.reduce((a, b) => a + b, 0);
  return values.map(x => x / sum);
}
export function distribution(scores, ids) {
  return scores.map((confidence, i) => ({ class_id: ids[i], confidence })).sort((a, b) => b.confidence - a.confidence);
}
export function fuse(first, second, weight) {
  const map = new Map(second.map(p => [p.class_id, p.confidence]));
  return first.map(p => ({ class_id: p.class_id, confidence: (1 - weight) * p.confidence + weight * map.get(p.class_id) }))
    .sort((a, b) => b.confidence - a.confidence);
}
// refined: 재촬영 사진을 이미 합친 결과. 서버 recapture.check_recapture 와 같은 규칙이다.
// trigger "top1" 쌍은 첫 사진에서 1순위가 쌍에 속하면 마진과 무관하게 재촬영을 안내한다.
export function summarize(bundle, predictions, crop, refined = false) {
  const disease = bundle.diseases.find(d => d.model_class_id === predictions[0].class_id);
  const other = disease.category === 'other';
  const [first, second] = predictions;
  const margin = second ? first.confidence - second.confidence : 1;
  const pairs = bundle.policy.pairs;
  const pair = other ? null
    : (!refined && pairs.find(p => p.trigger === 'top1' && p.ids.includes(first.class_id)))
      || (second && margin < bundle.policy.confusion_margin
        && pairs.find(p => p.ids.includes(first.class_id) && p.ids.includes(second.class_id)));
  const recapture = pair ? {
    region: pair.region, instruction: pair.instruction, margin,
    candidates: pair.ids.map(id => ({ name: bundle.diseases.find(d => d.model_class_id === id).name, cue: pair.cues[id] })),
  } : null;
  // 판별 불가: no crop leaf was recognized, so mismatch/confusion/score do not apply.
  const reasons = other ? ['not_crop'] : [];
  if (!other && crop && crop !== disease.crop_type) reasons.push('crop_mismatch');
  if (recapture) reasons.push('confusion');
  if (!other && first.confidence < bundle.policy.low_confidence_threshold) reasons.push('low_confidence');
  return {
    disease_name: disease.name, predicted_crop: disease.crop_type, selected_crop: crop || null,
    crop_type: crop || (other ? null : disease.crop_type), crop_mismatch: reasons.includes('crop_mismatch'),
    prediction_mode: 'browser', model_version: bundle.model_version, preprocessing_version: bundle.preprocessing_version,
    category: disease.category, severity: disease.severity, confidence: first.confidence,
    top_predictions: predictions.slice(0, 3).map(p => ({ name: bundle.diseases.find(d => d.model_class_id === p.class_id).name, confidence: p.confidence })),
    description: disease.description, causes: disease.causes, prevention: disease.prevention,
    management_actions: disease.management_actions || [],
    summary_message: disease.summary_message ?? null,
    management_action_details: (disease.management_action_details ?? []).map(
      detail => ({ title: detail.title, description: detail.description }),
    ),
    pesticides: disease.pesticides || [],
    recapture, decision_status: reasons[0] || (disease.category === 'normal' ? 'normal' : 'disease'), decision_reasons: reasons,
    policy_version: `${bundle.policy.version}:low=${bundle.policy.low_confidence_threshold}`, content_status: 'snapshot', content_version: bundle.version,
  };
}
// 설치 안내 화면 중 무엇을 보일지. 설치 방법은 창 폭이 아니라 기기·브라우저에 달려 있어 UA 로 가른다.
// 휴대폰: 이미 설치한 앱으로 열었으면 설치 완료, 아이폰·아이패드는 홈 화면 추가 안내,
// 안드로이드는 설치 버튼이다. 아이패드 Safari 는 맥 UA 를 쓰므로 터치 수로 가린다.
// PC: 설치한 앱이면 설치 완료, Chrome·Edge(설치창 이벤트가 늦게 와도)는 앱 설치,
// Mac Safari 는 Dock 에 추가 안내, 그 밖의 브라우저는 설치 도움말이다.
// Chrome·Edge UA 에도 "Safari" 가 들어 있어 Chromium 을 먼저 가리고 Safari 는 Version/ 으로 확인한다.
// 큰 안드로이드 태블릿은 데스크톱 UA(Linux, Android 없음)를 보내므로 터치가 있으면 휴대폰으로 본다 (크롬북 CrOS 제외)
// 같은 판별(deviceKind)을 오프라인 준비 화면의 PC 문구도 쓴다
export const DESKTOP_VIEWS = ['pc', 'mac', 'pc-help', 'pc-installed'];
export function deviceKind({ userAgent, touchPoints = 0 }) {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent) || (/Linux/.test(userAgent) && !/CrOS/.test(userAgent) && touchPoints > 1)) return 'android';
  return 'desktop';
}
export const isDesktopDevice = (userAgent, touchPoints = 0) => deviceKind({ userAgent, touchPoints }) === 'desktop';
export function installView({ userAgent, standalone, promptable, touchPoints = 0 }) {
  const kind = deviceKind({ userAgent, touchPoints });
  if (kind !== 'desktop') return standalone ? 'installed' : kind;
  if (standalone) return 'pc-installed';
  if (promptable || /Chrome|Chromium|Edg\//.test(userAgent)) return 'pc';
  if (/Macintosh/.test(userAgent) && /Version\/[\d.]+.*Safari/.test(userAgent)) return 'mac';
  return 'pc-help';
}
// 오프라인 파일 받기가 실패했을 때 보일 상태. 받기가 중단됐거나 연결이 끊겼으면 다시 받기,
// 저장 공간이 모자라면 공간 관리, 나머지(묶음 없음·검증 실패 등)는 실패 안내다
export function failurePhase(error, online) {
  if (error?.name === 'AbortError' || (error instanceof TypeError && !online)) return 'paused';
  if (error?.name === 'QuotaExceededError') return 'storage-full';
  return 'failed';
}
// 오프라인 화면은 한 페이지에서 주소의 # 로 나눈다: 준비(기본)·새 진단·진단 결과·진단 기록.
// 예전 사진 분석 주소(#analyze)는 새 진단으로 연다
export function viewFromHash(hash) {
  const name = String(hash || '').replace(/^#/, '');
  if (name === 'analyze') return 'new';
  return name === 'new' || name === 'result' || name === 'records' ? name : 'prepare';
}
// 서버에 새 진단 파일 묶음이 있는지. version 은 모델·전처리·병해 안내·정책을 합친 64자리 해시라 순서가 없어 다르면 새것이다.
// 받아 둔 묶음이 없거나 서버 값이 이상하면 묻지 않는다
export function updateAvailable(currentVersion, serverVersion) {
  return Boolean(currentVersion) && /^[0-9a-f]{64}$/.test(String(serverVersion)) && currentVersion !== serverVersion;
}
// 진단 기록 화면 위에 띄울 동기화 안내. 전송에 실패한 기록이 있으면 실패, 연결이 없는데 보낼 기록이 있으면 대기다
export function recordsNotice(records, online) {
  if (records.some(record => syncStateOf(record) === 'failed')) return 'sync-failed';
  if (!online && records.some(record => syncStateOf(record) === 'pending')) return 'sync-pending';
  return null;
}
// 판별 불가(9_기타): 작물 잎을 알아보지 못한 결과 (lib/diagnosis.ts 의 isNotCrop)
export const isNotCrop = result => result?.category === 'other';
// 서버 동기화 상태. 판별 불가는 서버에 남기지 않으므로(#179) 이미 올라간 옛 기록이 아니면 'local_only'
export const syncStateOf = record =>
  isNotCrop(record?.result) && record.sync_status !== 'saved' ? 'local_only' : record.sync_status;
// 진단 결과 화면의 등급 배지 (DiagnosisResultView.tsx 의 gradeOf 와 같다). 위험·주의는 같은 색이고 라벨로 구분한다.
// 정상 판정이면 "정상", 판별 불가나 등급이 없으면 null
const SEVERITY = { high: { label: '위험', tone: 'attention' }, medium: { label: '주의', tone: 'attention' }, low: { label: '낮음', tone: 'low' } };
export function gradeOf(result) {
  if (isNotCrop(result)) return null;
  if (result?.category === 'normal' || result?.category === 'healthy') return { label: '정상', tone: 'low' };
  return SEVERITY[result?.severity] || null;
}
// "2026년 10월 6일 오후 2:18에 확인한 결과예요." (DiagnosisResultView.tsx). 날짜를 읽지 못하면 null
export function resultTimeSentence(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  const hours = date.getHours(), minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${hours < 12 ? '오전' : '오후'} ${hours % 12 || 12}:${minutes}에 확인한 결과예요.`;
}
// "2026.10.22 · 19:25" (RecentDiagnosisCard.tsx 의 recentDate). 날짜를 읽지 못하면 null
export function recordTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
// ── 기능 선택 모델 묶음 (#166) ──
// 음성 질문의 기능 선택 모델은 기기마다 다르다: 휴대폰(iPhone·안드로이드)은 소형 분류기(mobile_clf, 약 15MB),
// WebGPU 가 있는 PC 는 Qwen q4f16(web_qwen, 약 1.34GB). 그 밖의 기기는 서버가 고르므로 받을 파일이 없다
export const FUNCTION_CACHE = 'transformers-cache';
export function functionBundleKind({ userAgent, touchPoints = 0, webgpu = false }) {
  const kind = deviceKind({ userAgent, touchPoints });
  if (kind === 'ios' || kind === 'android') return 'mobile_clf';
  return webgpu ? 'web_qwen' : null;
}
// 묶음 파일의 주소. Cache Storage 키도 이 주소라, transformers.js 가 같은 주소로 요청하면 캐시에서 읽는다
export const bundleFileUrl = (bundle, file, origin) => new URL(bundle.base_url.replace(/\/$/, '') + '/' + file.name, origin).href;
export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + 'GB';
  return Math.max(1, Math.round(bytes / 1024 ** 2)) + 'MB';
}
// 받기 전 안내. estimate 는 navigator.storage.estimate() 결과(없으면 null). 남은 공간 추정이 묶음의 1.2배보다 작으면 부족으로 본다
export function bundleGuide(kind, totalBytes, estimate) {
  const size = '약 ' + formatBytes(totalBytes);
  const text = kind === 'web_qwen'
    ? `이 PC에서 음성 질문을 인터넷 없이 쓰려면 ${size} 파일을 받아요. Wi-Fi처럼 안정된 연결에서 받아주세요.`
    : `이 휴대폰에서 음성 질문을 인터넷 없이 쓰려면 ${size} 파일을 받아요.`;
  const free = estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage) ? estimate.quota - estimate.usage : null;
  const enough = free === null || free >= totalBytes * 1.2;
  return { text: enough ? text : `${text} 남은 저장 공간(약 ${formatBytes(Math.max(0, free))})이 부족할 수 있어요.`, enough };
}
// 받아 둔 묶음 기록(IndexedDB assets 'fn:<kind>')과 서버 묶음을 비교한다. none: 받은 적 없음, update: 새 버전, ready: 최신
export function bundleState(record, serverBundle) {
  if (!record?.version) return 'none';
  return serverBundle && /^[0-9a-f]{64}$/.test(String(serverBundle.version)) && serverBundle.version !== record.version ? 'update' : 'ready';
}
const hex = buffer => Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
// 묶음을 파일 단위로 받는다. 파일마다 크기·SHA-256 을 확인한 뒤에만 캐시에 넣으므로 검증에 실패한 파일은 남지 않는다.
// 이미 캐시에 같은 크기로 있는 파일은 건너뛴다 (끊겼다 다시 받으면 이어서 받는다). 파일 하나씩 메모리에 모아 검증한다(가장 큰 파일 약 300MB)
// deps: fetch, cache(Cache Storage 의 한 캐시), digest(bytes → ArrayBuffer), origin, signal, onProgress(done, total, file),
// onBytes(): 요청을 시작하거나 바이트를 받을 때마다(정지 감시 타이머를 다시 건다), onIdle(): 본문을 다 받아 검증·저장하는 동안(타이머를 멈춘다)
export async function downloadBundle(bundle, { fetch, cache, digest, origin, signal, onProgress = () => {}, onBytes = () => {}, onIdle = () => {} }) {
  const total = bundle.files.reduce((sum, file) => sum + file.bytes, 0);
  let done = 0, skipped = 0;
  for (const file of bundle.files) {
    const url = bundleFileUrl(bundle, file, origin);
    const hit = await cache.match(url);
    if (hit && Number(hit.headers.get('content-length')) === file.bytes) {
      done += file.bytes; skipped += 1; onProgress(done, total, file); continue;
    }
    onBytes();
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok || !response.body) throw new Error('음성 질문 파일을 받지 못했어요. 연결을 확인하고 다시 받아주세요.');
    const chunks = []; let received = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done: end, value } = await reader.read(); if (end) break;
      chunks.push(value); received += value.length; onBytes();
      if (received > file.bytes) { await reader.cancel().catch(() => {}); break; }
      onProgress(done + received, total, file);
    }
    // 300MB 파일은 합치기·해시·저장에 시간이 걸려 연결이 멀쩡해도 정지로 보일 수 있으므로 감시를 멈춘다
    onIdle();
    if (received !== file.bytes) throw new Error('음성 질문 파일 크기가 맞지 않아요. 다시 받아주세요.');
    const bytes = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    chunks.length = 0;
    if (hex(await digest(bytes)) !== file.sha256) throw Object.assign(new Error('음성 질문 파일 검증에 실패했어요. 다시 받아주세요.'), { name: 'IntegrityError' });
    await cache.put(url, new Response(bytes, { headers: { 'content-type': response.headers.get('content-type') || 'application/octet-stream', 'content-length': String(file.bytes) } }));
    done += file.bytes; onProgress(done, total, file);
  }
  return { skipped };
}
// 캐시에서 빠진 파일. 받아 둔 기록이 있어도 브라우저가 캐시를 지웠을 수 있어(특히 iOS) 불러오기 전에 확인한다
export async function missingBundleFiles(bundle, cache, origin) {
  const missing = [];
  for (const file of bundle.files) if (!(await cache.match(bundleFileUrl(bundle, file, origin)))) missing.push(file.name);
  return missing;
}
// 새 버전을 받은 뒤 지울 같은 종류의 이전 버전 캐시 키 (주소에 version 폴더가 들어 있다)
export function staleBundleKeys(urls, kind, keepBaseUrl, origin) {
  const prefix = new URL('/offline-assets/function/' + kind + '/', origin).href;
  const keep = new URL(keepBaseUrl.replace(/\/$/, '') + '/', origin).href;
  return urls.filter(url => url.startsWith(prefix) && !url.startsWith(keep));
}
