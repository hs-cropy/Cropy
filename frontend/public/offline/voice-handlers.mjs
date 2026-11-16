// 오프라인 화면의 답변 핸들러. 서버 backend/app/services/llm_function_parser.py·llm_function_handler.py 를 그대로 옮겼다.
// 모델 출력 <hs_N>(인자=값)<hs_end> 를 계약대로 검사하고, 기기에 저장된 진단 결과(사실)만으로 문장을 만든다.
// 문구·분기·상태값이 서버와 같은지는 tests/offline-voice-handlers.test.mjs 가 Python 기준 출력으로 확인한다.
// 계약(함수 순서·인자 이름·값 개수)은 분류기 묶음의 labels.json 에서 읽는다 (서버 function_contract.json 과 같다).

export class InvalidFunctionOutput extends Error {}
export class InvalidFunctionContract extends Error {}

/** labels.json → [{name, arguments: [[이름, 개수], ...]}] */
export const contractFromLabels = labels => labels.functions.map(name => ({
  name, arguments: labels.heads.filter(h => h.function === name).map(h => [h.argument, h.values.length]),
}));

const CALL = /^<hs_([0-9]+)>\(((?:[a-z_]+=-?[0-9]+(?:, [a-z_]+=-?[0-9]+)*)?)\)<hs_end>$/;
export function parseFunctionOutput(output, contract) {
  if (typeof output !== 'string') throw new InvalidFunctionOutput('output must be a string');
  if (output.length > 512) throw new InvalidFunctionOutput('output is too long');
  const match = CALL.exec(output.trim());
  if (!match) throw new InvalidFunctionOutput('malformed v2 call');
  const index = Number(match[1]);
  if (index >= contract.length) throw new InvalidFunctionOutput('unknown function index');
  const spec = contract[index];
  const pairs = match[2] ? match[2].split(', ').map(p => p.split('=')) : [];
  if (pairs.map(p => p[0]).join(',') !== spec.arguments.map(a => a[0]).join(',')) throw new InvalidFunctionOutput('incorrect argument names or order');
  const args = {};
  pairs.forEach(([key, value], i) => {
    const n = Number(value);
    if (!(n >= 1 && n <= spec.arguments[i][1])) throw new InvalidFunctionOutput('argument is out of range');
    args[key] = n;
  });
  return { functionName: spec.name, arguments: args };
}

const TOPICS = {
  get_diagnosis: ['result', 'severity', 'observation', 'provenance', 'impact', 'food_safety', 'change'],
  get_prediction_metrics: ['confidence', 'ranking', 'distribution', 'limits', 'comparison'],
  get_recapture_guidance: ['where', 'why', 'certainty', 'provenance'],
  get_care_information: ['causes', 'prevention', 'priority'],
};
const CLARIFICATION = [
  '어떤 작물에 대해 물어보시는 건가요? 작물 이름을 알려 주세요.',
  '어떤 병에 대해 물어보시는 건가요? 병 이름을 알려 주세요.',
  '어떤 내용부터 알려 드릴까요? 한 가지씩 물어봐 주세요.',
  '어떤 점수를 말씀하시는 건가요? 궁금한 진단 후보를 알려 주세요.',
  '화면에 표시된 병의 심각도와 사진 속 작물 상태 중 어느 쪽이 궁금하세요?',
  '어느 진단 기록을 말씀하시는 건가요? 화면에서 해당 기록을 선택해 주세요.',
  '어떤 농약 제품을 말씀하시는 건가요? 제품 이름을 알려 주세요.',
  '말씀을 잘 알아듣지 못했어요. 조금 더 천천히 다시 말해 주세요.',
];
const SCOPE_LIMIT = [
  '현재 고추·무·배추만 진단할 수 있어요. 이 중 한 작물의 잎을 찍어 주세요.',
  '앱이 물 주기, 주문, 기기 조작 같은 일을 직접 실행할 수는 없어요. 진단 결과나 관리 방법이 궁금하시면 물어봐 주세요.',
  '사진으로 진단하려면 고추·무·배추 중 한 작물의 잎을 밝은 곳에서 초점을 맞춰 찍어 주세요.',
];

const strip = s => (s ?? '').trim();
const unique = items => [...new Set(items)];
const sameArgs = (spec, expected) => JSON.stringify(spec.arguments) === JSON.stringify(expected);

function checkArgs(contract, name, argument, count) {
  if (!sameArgs(contract.find(f => f.name === name), [[argument, count]])) throw new InvalidFunctionContract(`unsupported handler contract: ${name}`);
}

/** context: 서버 DiagnosisLLMInput 과 같은 필드 (llm_context.build_llm_input). 진단이 없으면 null */
export function handleFunctionOutput(output, context, contract, { uiStage = null } = {}) {
  const call = parseFunctionOutput(output, contract);
  const ctx = normalizeContext(context);
  const name = call.functionName;
  if (name === 'clarify_request') {
    checkArgs(contract, name, 'target', CLARIFICATION.length);
    return response(name, ctx, 'needs_clarification', CLARIFICATION[call.arguments.target - 1]);
  }
  if (name === 'handle_scope_limit') {
    checkArgs(contract, name, 'reason', SCOPE_LIMIT.length);
    return response(name, ctx, 'unsupported_scope', SCOPE_LIMIT[call.arguments.reason - 1]);
  }
  if (name === 'get_pesticide_information') {
    if (!sameArgs(contract.find(f => f.name === name), [['topic', 11], ['product', 2]])) throw new InvalidFunctionContract(`unsupported handler contract: ${name}`);
    return pesticideResponse(ctx, call.arguments.topic, call.arguments.product);
  }
  if (name === 'get_usage_guidance') {
    if (!sameArgs(contract.find(f => f.name === name), [['topic', 6], ['delivery', 2]])) throw new InvalidFunctionContract(`unsupported handler contract: ${name}`);
    return usageResponse(call.arguments.topic, call.arguments.delivery, uiStage);
  }
  if (name === 'chit_chat') {
    if (Object.keys(call.arguments).length) throw new InvalidFunctionContract('unsupported handler contract: chit_chat');
    return { function_name: 'chit_chat', status: 'ok', text: '안녕하세요! 작물 진단이나 앱 사용 방법이 궁금하면 물어봐 주세요.' };
  }
  const topics = TOPICS[name];
  if (!topics) throw new InvalidFunctionContract(`handler not implemented: ${name}`);
  checkArgs(contract, name, 'topic', topics.length);
  const topic = topics[call.arguments.topic - 1];
  return { get_diagnosis: diagnosisResponse, get_prediction_metrics: metricsResponse, get_recapture_guidance: recaptureResponse,
    get_care_information: careResponse }[name](topic, ctx);
}

// 진단이 없는 화면(사진 없음 등)도 서버는 빈 진단 문맥으로 답한다 (voice.py 의 _empty_context 와 같은 기본값)
function normalizeContext(c) {
  c = c || {};
  return {
    disease_name: c.disease_name ?? '', crop_type: c.crop_type ?? null, selected_crop: c.selected_crop ?? null,
    predicted_crop: c.predicted_crop ?? null, crop_mismatch: Boolean(c.crop_mismatch), prediction_mode: c.prediction_mode ?? 'legacy',
    decision_status: c.decision_status ?? '', decision_reasons: c.decision_reasons ?? [], policy_version: c.policy_version ?? null,
    management_actions: c.management_actions ?? [], category: c.category ?? '', severity: c.severity ?? null,
    confidence: c.confidence ?? 0, top_predictions: c.top_predictions ?? [], description: c.description ?? null,
    causes: c.causes ?? [], prevention: c.prevention ?? [], pesticides: c.pesticides ?? [], recapture: c.recapture ?? null,
  };
}

function response(name, ctx, status, text) {
  if (ctx.prediction_mode === 'mock') text = '데모 결과이며 실제 모델 진단이 아닙니다. ' + text;
  else if (!['model', 'browser'].includes(ctx.prediction_mode)) text = '추론 출처가 확인되지 않은 기록입니다. ' + text;
  return { function_name: name, status, text };
}

const isNotCrop = ctx => ctx.category === 'other' || ctx.decision_status === 'not_crop' || ctx.decision_reasons.includes('not_crop');
const hasReason = (ctx, reason) => ctx.decision_status === reason || ctx.decision_reasons.includes(reason) || (reason === 'crop_mismatch' && ctx.crop_mismatch);

function retakeReason(ctx) {
  if (isNotCrop(ctx)) return '사진에서 고추·무·배추 잎을 알아보기 어려워서예요.';
  if (hasReason(ctx, 'crop_mismatch')) return '선택한 작물과 사진에서 분류한 작물이 달라서예요.';
  if (hasReason(ctx, 'confusion')) return '비슷한 병의 후보를 구분할 추가 사진이 필요해서예요.';
  if (hasReason(ctx, 'low_confidence')) return '사진만으로는 AI가 충분히 자신 있게 구분하지 못해서예요.';
  return null;
}
const generalPhotoActions = ctx => isNotCrop(ctx) ? ctx.management_actions.map(strip).filter(Boolean) : [];

function recaptureResponse(topic, ctx) {
  const name = 'get_recapture_guidance', g = ctx.recapture, respond = (s, t) => response(name, ctx, s, t);
  if (topic === 'certainty') {
    let text = '다시 촬영하면 판단에 도움이 되는 단서를 더 얻을 수 있지만, 확진이나 후보 구분 성공을 보장하지 않습니다.';
    if (g && strip(g.instruction)) text += ' ' + strip(g.instruction);
    return respond('ok', text);
  }
  if (topic === 'why') {
    let reason = retakeReason(ctx);
    if (reason === null) return respond('insufficient_information', '현재 기록에서 다시 촬영해야 하는 이유를 확인할 수 없습니다. 점수 차이만으로 이유를 추측하지 않습니다.');
    if (g && strip(g.instruction)) reason += ' ' + strip(g.instruction);
    else { const actions = generalPhotoActions(ctx); if (actions.length) reason += ' 촬영 방법: ' + actions.join('; '); }
    return respond('ok', reason);
  }
  if (topic === 'where') {
    if (g) { const region = strip(g.region), instruction = strip(g.instruction); if (region && instruction) return respond('ok', `다시 찍을 곳은 ${region}입니다. ${instruction}`); }
    const actions = generalPhotoActions(ctx);
    if (actions.length) return respond('ok', '현재 기록에 저장된 촬영 방법입니다. ' + actions.join('; '));
    return respond('insufficient_information', '현재 기록에서 다시 찍을 부위와 촬영 방법을 충분히 확인할 수 없습니다.');
  }
  if (!g) return respond('insufficient_information', '현재 기록에는 구체적인 촬영 안내가 저장되어 있지 않습니다.');
  return respond('ok', '진단할 때 함께 저장된 촬영 안내예요. 이 답변을 위해 사진을 새로 분석한 것은 아닙니다.');
}

function careResponse(topic, ctx) {
  const name = 'get_care_information';
  if (retakeReason(ctx) !== null || !['normal', 'disease'].includes(ctx.decision_status)) {
    return response(name, ctx, 'insufficient_information', '현재 기록으로는 원인이나 관리 방법을 안내하기 어렵습니다. 진단 결과의 안내를 먼저 확인해 주세요.');
  }
  let items, prefix, suffix = '';
  if (topic === 'causes') { items = ctx.causes; prefix = '이 병의 일반적인 원인으로 등록된 내용이에요. '; suffix = ' 이 사진만으로 실제 원인을 확인한 것은 아닙니다.'; }
  else if (topic === 'prevention') { items = [...ctx.prevention, ...ctx.management_actions]; prefix = '진단 기록에 저장된 예방·관리 방법이에요. '; }
  else { items = ctx.management_actions; prefix = '진단 기록에서 첫 번째로 안내하는 관리 방법이에요. '; }
  const entries = unique(items.map(strip).filter(Boolean));
  if (!entries.length) return response(name, ctx, 'insufficient_information', '현재 진단 기록에는 질문에 답할 내용이 저장되어 있지 않습니다.');
  return response(name, ctx, 'ok', prefix + (topic === 'priority' ? entries[0] : entries.join('; ')) + suffix);
}

function diagnosisResponse(topic, ctx) {
  const respond = (s, t) => response('get_diagnosis', ctx, s, t);
  if (topic === 'provenance') {
    const source = { model: '서버의 AI 모델', browser: '브라우저에서 실행한 AI 모델', mock: '데모' }[ctx.prediction_mode];
    if (!source) return respond('insufficient_information', '현재 기록을 어떤 방식으로 분석했는지 확인할 수 없습니다.');
    return respond('ok', `현재 기록은 ${source}의 결과입니다. 이 답변을 위해 사진을 새로 분석하지 않았습니다.`);
  }
  if (topic === 'observation') {
    const description = strip(ctx.description);
    if (isNotCrop(ctx) || ctx.category !== 'disease' || !description) return respond('insufficient_information', '현재 결과에서 안내할 병의 일반적인 증상 설명을 확인할 수 없습니다.');
    return respond('ok', `현재 후보로 나온 병의 등록된 설명입니다. 이 병은 보통 다음과 같은 증상이 있어요. ${description} 사진에서 이 증상을 직접 확인했다는 뜻은 아닙니다.`);
  }
  const limitations = {
    impact: '현재 기록에는 실제 피해 면적이나 손실량이 없습니다. AI가 매긴 점수로 피해나 수확량 감소를 계산할 수 없습니다.',
    food_safety: '사진 분석만으로 먹어도 안전한지, 농약이 남아 있는지 확인할 수 없습니다.',
    change: '비교할 이전 관찰 자료가 없습니다. 이번 결과만으로 좋아졌는지 나빠졌는지 판단할 수 없습니다.',
  };
  if (limitations[topic]) return respond('insufficient_information', limitations[topic]);
  if (topic === 'severity') {
    const label = { high: '높음', medium: '보통', low: '낮음' }[ctx.severity];
    if (isNotCrop(ctx) || !label) return respond('insufficient_information', '현재 결과에는 병 자체의 심각도를 안내할 정보가 없습니다.');
    return respond('ok', `등록된 정보에서 병 자체의 심각도는 ${label}입니다. 사진 속 상태나 사진에서 측정한 병의 진행 정도를 뜻하지 않습니다.`);
  }
  if (isNotCrop(ctx)) return respond('ok', '현재 결과는 판별 불가입니다. 대상 작물의 잎을 알아보기 어려워 병이 있는지 판단하지 않습니다. 잎이 선명하게 보이도록 다시 찍어 주세요.');
  if (!strip(ctx.disease_name)) return respond('insufficient_information', '현재 기록에는 분류된 후보 이름이 없습니다.');
  let text = `현재 기록의 분류 후보는 ${ctx.disease_name}입니다.`;
  text += ['normal', 'healthy'].includes(ctx.category) ? ' 정상으로 분류됐지만 병이 전혀 없거나 먹어도 안전하다는 뜻은 아닙니다.' : ' 사진 분석 결과이며 확진이 아닙니다.';
  if (hasReason(ctx, 'crop_mismatch')) text += ' 선택한 작물과 사진에서 분류한 작물이 달라 확인이 필요합니다.';
  if (hasReason(ctx, 'confusion')) text += ' 후보 구분을 위한 추가 촬영이 필요한 상태입니다.';
  if (hasReason(ctx, 'low_confidence')) text += ' AI가 충분히 자신 있게 구분하지 못해 판정을 보류한 상태입니다.';
  return respond('ok', text);
}

const trimZeros = s => s.replace(/0+$/, '').replace(/\.$/, '');
const percent = v => trimZeros((v * 100).toFixed(2)) + '%';

function metricsResponse(topic, ctx) {
  const limit = ' 이 점수는 실제 발병 확률이나 피해 수준을 뜻하지 않습니다.', respond = (s, t) => response('get_prediction_metrics', ctx, s, t);
  if (topic === 'limits') return respond('ok', 'AI가 매긴 점수는 어떤 후보에 더 가깝게 분류했는지 비교하는 데 쓰는 값입니다.' + limit + ' 점수만으로 기존 판정 상태를 변경하지 않습니다.');
  if (topic === 'confidence') return respond('ok', `현재 결과에 기록된 AI 점수는 ${percent(ctx.confidence)}입니다.` + limit);
  let candidates = ctx.top_predictions;
  if (!candidates.length) return respond('insufficient_information', '현재 기록에는 비교할 후보 목록이 없습니다.');
  // Python sorted 는 안정 정렬이고 JS sort 도 안정 정렬이다
  const ranked = () => [...candidates].sort((a, b) => b.confidence - a.confidence);
  if (topic === 'comparison') {
    if (candidates.length < 2) return respond('insufficient_information', '후보가 두 개 이상 없어 점수를 비교할 수 없습니다.');
    const [first, second] = ranked();
    const difference = trimZeros((Math.abs(first.confidence - second.confidence) * 100).toFixed(2));
    return respond('ok', `${first.name}의 AI 점수는 ${percent(first.confidence)}, ${second.name}의 AI 점수는 ${percent(second.confidence)}입니다. `
      + `두 점수의 차이는 ${difference}퍼센트포인트입니다.` + limit + ' 이 차이로 재촬영 여부를 새로 판정하지 않습니다.');
  }
  if (topic === 'ranking') candidates = ranked();
  return respond('ok', '현재 기록에 있는 후보별 AI 점수입니다. ' + candidates.map(i => `${i.name}: ${percent(i.confidence)}`).join('; ')
    + '. 기록에 없는 후보의 점수는 알 수 없습니다.' + limit);
}

const USAGE_STEPS = {
  2: ['진단할 잎을 화면에 맞춰 주세요.', '초점이 맞으면 사진을 찍어 주세요.'],
  3: ['작물 선택 메뉴를 열어 주세요.', '지금 진단할 작물을 골라 주세요.'],
  5: ['화면에 표시된 오류 안내를 확인해 주세요.', '다시 시도 버튼이 보이면 눌러 주세요.'],
};
const USAGE_NEXT = {
  no_photo: ['진단할 작물을 골라 주세요.', '잎 사진을 찍어 주세요.'],
  photo_ready: ['촬영한 사진을 확인해 주세요.', '진단을 시작해 주세요.'],
  analyzing: ['분석이 끝날 때까지 잠시 기다려 주세요.'],
  result: ['화면에서 진단 결과를 확인해 주세요.', '아래 안내를 살펴봐 주세요.'],
  error: USAGE_STEPS[5],
};
function usageResponse(topic, delivery, uiStage) {
  const steps = topic === 1 ? USAGE_NEXT[uiStage] : topic === 4 && uiStage === 'analyzing' ? USAGE_NEXT.analyzing : USAGE_STEPS[topic];
  if (!steps) {
    const text = topic === 6 ? '직전 안내를 확인할 수 없어요. 다시 듣고 싶은 내용을 말씀해 주세요.' : '현재 화면 상태를 확인할 수 없어요. 화면에 표시된 안내를 확인해 주세요.';
    return { function_name: 'get_usage_guidance', status: 'insufficient_information', text };
  }
  return { function_name: 'get_usage_guidance', status: 'ok', text: delivery === 1 ? steps[0] : steps.map((s, i) => `${i + 1}. ${s}`).join('\n') };
}

function pesticideResponse(ctx, topic, product) {
  const name = 'get_pesticide_information', unavailable = '이 진단 기록에서 요청하신 농약 정보를 확인할 수 없어요. 제품 표시사항과 PSIS 등록정보를 확인해 주세요.';
  if (retakeReason(ctx) !== null || ctx.decision_status !== 'disease') return response(name, ctx, 'insufficient_information', '농약 정보를 안내하기 전에 작물과 병해를 확인해 주세요.');
  if (topic === 11) return response(name, ctx, 'insufficient_information', '이 기록으로는 혼용 가능 여부를 확인할 수 없어요. 제품 표시사항을 확인해 주세요.');
  const candidates = ctx.pesticides;
  if (product === 1 && candidates.length > 1) return response(name, ctx, 'needs_clarification', '어떤 농약 제품인지 이름을 알려 주세요.');
  const verified = candidates.filter(i => i.source === 'PSIS' && i.verification_status === 'verified' && i.synced_at != null && strip(i.name));
  if (!verified.length) return response(name, ctx, 'insufficient_information', unavailable);
  if (topic === 10 && (product === 1 || new Set(verified.map(i => i.name)).size < 2)) return response(name, ctx, 'insufficient_information', '비교하려면 확인된 제품 정보가 두 개 이상 필요해요.');
  const entries = [];
  for (const item of verified) {
    const phi = item.safety?.phi_days ?? null, reentry = item.safety?.reentry_hours ?? null;
    const fields = {
      1: null, 2: item.dilution, 3: item.usage,
      4: phi !== null ? `수확 전 사용 금지 기간 ${phi}일` : null, 5: reentry !== null ? `살포 후 재출입 간격 ${reentry}시간` : null,
      6: '이 기록에 PSIS 검증 정보가 있어요', 7: item.active_ingredient, 8: item.active_ingredient, 9: item.safety_notes, 10: item.active_ingredient,
    };
    const value = fields[topic];
    if ([1, 8, 10].includes(topic)) entries.push(value && strip(value) ? `${item.name}: ${strip(value)}` : item.name);
    else if (value && strip(value)) entries.push(`${item.name}: ${strip(value)}`);
    else if (product === 2) entries.push(`${item.name}: 요청하신 항목은 확인되지 않았어요`);
  }
  if (!entries.length || (![1, 8, 10].includes(topic) && entries.every(e => e.endsWith('요청하신 항목은 확인되지 않았어요')))) return response(name, ctx, 'insufficient_information', unavailable);
  let text = unique(entries).join('; ');
  if (topic === 10) text = '확인된 제품 정보를 나란히 안내할게요. ' + text;
  return response(name, ctx, 'ok', text);
}

/** 오프라인 진단 결과(core.mjs summarize) → 서버 DiagnosisLLMInput 과 같은 필드 (llm_context.build_llm_input) */
export function llmContext(result) {
  if (!result) return null;
  const pick = ['disease_name', 'crop_type', 'selected_crop', 'predicted_crop', 'crop_mismatch', 'prediction_mode', 'decision_status',
    'decision_reasons', 'policy_version', 'management_actions', 'category', 'severity', 'confidence', 'top_predictions', 'description',
    'causes', 'prevention', 'pesticides', 'recapture'];
  return Object.fromEntries(pick.map(k => [k, result[k] ?? null]));
}
