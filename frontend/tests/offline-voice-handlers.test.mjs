// 오프라인 답변 핸들러·기능 선택 입력이 서버·앱과 같은지 본다.
// handlers.json 은 fixtures/offline-voice/make_handler_fixtures.py 가 서버 handler(Python)로 만든 기준 출력이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleFunctionOutput, contractFromLabels, parseFunctionOutput, InvalidFunctionOutput, llmContext } from '../public/offline/voice-handlers.mjs';
import { compactContext, contextJson, clfContext, assembleCall } from '../public/offline/voice-clf.mjs';
import { matchWakeWord, isCaptureCommand, isExitCommand } from '../public/offline/voice-intents.mjs';
import { summarize } from '../public/offline/core.mjs';

const contractJson = JSON.parse(readFileSync(new URL('../../backend/app/data/function_contract.json', import.meta.url), 'utf8'));
// labels.json 과 같은 모양으로 만든다 (함수 순서·인자 이름·값 개수만 쓴다)
const labels = {
  functions: Object.keys(contractJson.functions),
  heads: Object.entries(contractJson.functions).flatMap(([fn, args]) => args.map(([argument, n]) => ({ function: fn, argument, values: Array.from({ length: n }, (_, i) => String(i)) }))),
};
const contract = contractFromLabels(labels);

test('답변 핸들러가 서버 handler 와 모든 진단 상태·호출·화면 단계에서 같다', () => {
  const { contexts, rows } = JSON.parse(readFileSync(new URL('./fixtures/offline-voice/handlers.json', import.meta.url), 'utf8'));
  const wrong = [];
  for (const row of rows) {
    let got;
    try { got = handleFunctionOutput(row.call, contexts[row.context], contract, { uiStage: row.ui_stage }); }
    catch (error) { got = error instanceof InvalidFunctionOutput ? 'InvalidFunctionOutput' : `${error.name}: ${error.message}`; }
    const expected = row.error ?? row.out;
    if (JSON.stringify(got) !== JSON.stringify(expected)) wrong.push(`${row.context} ${row.call} ${row.ui_stage}\n  JS ${JSON.stringify(got)}\n  PY ${JSON.stringify(expected)}`);
  }
  assert.equal(wrong.length, 0, wrong.slice(0, 5).join('\n'));
  assert.ok(rows.length > 1500);
});

test('계약: labels.json 에서 함수 순서·인자 개수를 읽는다', () => {
  assert.deepEqual(contract[4], { name: 'get_pesticide_information', arguments: [['topic', 11], ['product', 2]] });
  assert.deepEqual(parseFunctionOutput('<hs_4>(topic=2, product=1)<hs_end>', contract), { functionName: 'get_pesticide_information', arguments: { topic: 2, product: 1 } });
  assert.throws(() => parseFunctionOutput('<hs_4>(topic=12, product=1)<hs_end>', contract), InvalidFunctionOutput);
});

const bundle = {
  model_version: 'm', preprocessing_version: 'p', version: 'v',
  diseases: [
    { model_class_id: 0, name: '고추 탄저병', crop_type: '고추', category: 'disease', severity: 'high', description: '설명', causes: ['원인'], prevention: ['예방'], management_actions: ['할 일'],
      pesticides: [{ name: '포룸디', source: 'PSIS', verification_status: 'verified', synced_at: '2026-10-20T14:45:29Z', dilution: '500배', usage: '경엽처리', safety: { phi_days: 7, reentry_hours: null }, active_ingredient: '디메토모르프', safety_notes: '수확 7일 전' }] },
    { model_class_id: 1, name: '고추 흰가루병', crop_type: '고추', category: 'disease', severity: 'medium', pesticides: [] },
  ],
  policy: { version: 'decision-v3', low_confidence_threshold: 0.8, confusion_margin: 0.2, second_photo_weight: 0.6, pairs: [] },
};

test('오프라인 진단 결과로 농약 질문에 답한다 (묶음의 등록 농약)', () => {
  const result = summarize(bundle, [{ class_id: 0, confidence: 0.92 }, { class_id: 1, confidence: 0.05 }], '고추');
  const answer = handleFunctionOutput('<hs_4>(topic=2, product=2)<hs_end>', llmContext(result), contract, { uiStage: 'result' });
  assert.deepEqual(answer, { function_name: 'get_pesticide_information', status: 'ok', text: '포룸디: 500배' });
  const list = handleFunctionOutput('<hs_4>(topic=1, product=2)<hs_end>', llmContext(result), contract, { uiStage: 'result' });
  assert.equal(list.text, '포룸디');
});

test('화면 상태: 오프라인 결과도 앱·서버와 같은 키·순서·직렬화', () => {
  const result = summarize(bundle, [{ class_id: 0, confidence: 0.92 }, { class_id: 1, confidence: 0.05 }], '고추');
  const context = compactContext(result, 'result');
  assert.equal(contextJson(context),
    '{"ui_stage":"result","selected_crop":"고추","predicted_crop":"고추","crop_mismatch":false,"prediction_mode":"browser","category":"disease",'
    + '"disease_name":"고추 탄저병","confidence":0.92,"top_predictions":[{"name":"고추 탄저병","confidence":0.92},{"name":"고추 흰가루병","confidence":0.05}],'
    + '"severity":"high","decision_status":"disease","pesticides":["포룸디"]}');
  assert.ok(contextJson(clfContext(context, 'clf_v2')).startsWith('{"단계":"result","선택작물":"고추","예측작물":"고추","작물불일치":false'));
  assert.ok(contextJson(clfContext(context, 'clf_v2')).endsWith('"농약":1}'));
  assert.equal(contextJson(compactContext(null, 'no_photo')), '{"ui_stage":"no_photo"}');
  // 긴 확률값은 학습 데이터처럼 소수 둘째 자리로 (#195)
  const long = summarize(bundle, [{ class_id: 0, confidence: 0.9118661279106783 }, { class_id: 1, confidence: 0.01351857340215168 }], '');
  assert.ok(contextJson(compactContext(long, 'result')).includes('"confidence":0.91,"top_predictions":[{"name":"고추 탄저병","confidence":0.91},{"name":"고추 흰가루병","confidence":0.01}]'));
});

test('분류기 출력 조립: 값은 1부터', () => {
  const call = assembleCall({ functions: ['a', 'b'], heads: [{ function: 'b', argument: 'topic', values: ['x', 'y'] }] },
    { fn_logits: [0, 1], 'b.topic': [0.1, 0.9] });
  assert.equal(call, '<hs_1>(topic=2)<hs_end>');
});

test('호출어·명령: 앱 음성 모드와 같은 규칙', () => {
  assert.deepEqual(matchWakeWord('여보세요 크로피 이거 무슨 병이야'), { remainder: '이거 무슨 병이야', by: 'name' });  // 이름이 있으면 이름 우선 (앱과 같다)
  assert.deepEqual(matchWakeWord('여보세요 이거 무슨 병이야'), { remainder: '이거 무슨 병이야', by: 'call' });
  assert.deepEqual(matchWakeWord('그로피야, 농약 알려 줘'), { remainder: '농약 알려 줘', by: 'name' });
  assert.equal(matchWakeWord('오늘 날씨 좋다'), null);
  assert.equal(isCaptureCommand('찍어 줘'), true);
  assert.equal(isCaptureCommand('사진 어떻게 찍어'), false);
  assert.equal(isExitCommand('이제 그만'), true);
  assert.equal(isExitCommand('농약 그만 뿌려도 돼'), false);
});

// 실제 분류기 (선택): CROPY_CLF_DIR=<mobile_clf 폴더> CROPY_CLF_REF=<ref.json> — 앱 mobileClf.model.test.ts 와 같은 기준 파일
const clfDir = process.env.CROPY_CLF_DIR, clfRef = process.env.CROPY_CLF_REF;
test('실제 분류기: 오프라인 모듈의 입력 문자열·토큰·호출이 Python 기준과 같다', { skip: !(clfDir && clfRef), timeout: 600_000 }, async () => {
  const { join } = await import('node:path');
  const { WordPieceTokenizer, createClassifier } = await import('../public/offline/voice-clf.mjs');
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const realLabels = JSON.parse(readFileSync(join(clfDir, 'labels.json'), 'utf8'));
  const tok = new WordPieceTokenizer(JSON.parse(readFileSync(join(clfDir, 'tokenizer.json'), 'utf8')));
  const session = await ort.InferenceSession.create(readFileSync(join(clfDir, 'model_int8.onnx')), { executionProviders: ['wasm'] });
  const select = createClassifier(ort, session, tok, realLabels);
  const rows = JSON.parse(readFileSync(clfRef, 'utf8'));
  let badCtx = 0, badIds = 0, same = 0;
  for (const row of rows) {
    const ctx = contextJson(clfContext(row.context, realLabels.context_format));
    if (ctx !== row.ctx) badCtx++;
    if (JSON.stringify(tok.encodePair(row.utterance, ctx, 256).inputIds) !== JSON.stringify(row.ids)) badIds++;
    if (await select(row.utterance, row.context) === row.output) same++;
  }
  console.info(`[clf] 입력 다름 ${badCtx}, 토큰 다름 ${badIds}, 호출 같음 ${same}/${rows.length}`);
  assert.equal(badCtx, 0); assert.equal(badIds, 0);
  assert.ok(same / rows.length >= 0.99);
});
