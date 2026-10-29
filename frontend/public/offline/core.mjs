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
export function summarize(bundle, predictions, crop) {
  const disease = bundle.diseases.find(d => d.model_class_id === predictions[0].class_id);
  const other = disease.category === 'other';
  const [first, second] = predictions;
  const pair = !other && second && bundle.policy.pairs.find(p => p.ids.includes(first.class_id) && p.ids.includes(second.class_id));
  const margin = second ? first.confidence - second.confidence : 1;
  const recapture = pair && margin < bundle.policy.confusion_margin ? {
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
    management_actions: disease.management_actions || [], pesticides: disease.pesticides || [],
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
// 오프라인 화면은 한 페이지에서 주소의 # 로 나눈다: 준비(기본)·사진 분석·진단 기록
export function viewFromHash(hash) {
  const name = String(hash || '').replace(/^#/, '');
  return name === 'analyze' || name === 'records' ? name : 'prepare';
}
// 서버에 새 진단 파일 묶음이 있는지. version 은 모델·전처리·병해 안내·정책을 합친 64자리 해시라 순서가 없어 다르면 새것이다.
// 받아 둔 묶음이 없거나 서버 값이 이상하면 묻지 않는다
export function updateAvailable(currentVersion, serverVersion) {
  return Boolean(currentVersion) && /^[0-9a-f]{64}$/.test(String(serverVersion)) && currentVersion !== serverVersion;
}
// 진단 기록 화면 위에 띄울 동기화 안내. 전송에 실패한 기록이 있으면 실패, 연결이 없는데 보낼 기록이 있으면 대기다
export function recordsNotice(records, online) {
  if (records.some(record => record.sync_status === 'failed')) return 'sync-failed';
  if (!online && records.some(record => record.sync_status === 'pending')) return 'sync-pending';
  return null;
}
