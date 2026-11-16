// 오프라인 화면의 기기 안 기능 선택 (휴대폰 분류기 mobile_clf). 앱의 TS 모듈을 그대로 옮겼다:
//   WordPieceTokenizer ← src/features/voice/lib/wordpiece.ts
//   compactContext·contextJson ← voiceContext.ts (서버 backend/app/services/voice_context.py 와 같은 규칙)
//   clfContext·assembleCall ← mobileClfSelector.ts (11차 clf_v2 입력 형식, selector/server.py 와 같다)
// 같은 결과인지는 tests/offline-voice-clf.test.mjs 가 앱과 같은 기준 파일로 확인한다.

const CJK = [[0x4e00, 0x9fff], [0x3400, 0x4dbf], [0x20000, 0x2a6df], [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f], [0x2b820, 0x2ceaf], [0xf900, 0xfaff], [0x2f800, 0x2fa1f]];
const isCjk = cp => CJK.some(([a, b]) => cp >= a && cp <= b);
const OTHER = /\p{C}/u, PUNCT = /\p{P}/u;
const isWhitespace = ch => ch === '\t' || ch === '\n' || ch === '\r' || /\s/u.test(ch);
const isControl = ch => ch !== '\t' && ch !== '\n' && ch !== '\r' && OTHER.test(ch);
function isPunctuation(ch) {
  const cp = ch.codePointAt(0);
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return PUNCT.test(ch);
}

export class WordPieceTokenizer {
  constructor(json) {
    if (json.model?.type !== 'WordPiece') throw new Error('WordPiece 토크나이저가 아니에요');
    this.vocab = new Map(Object.entries(json.model.vocab));
    const id = token => { const v = this.vocab.get(token); if (v === undefined) throw new Error(`토크나이저에 ${token}이 없어요`); return v; };
    this.unk = id(json.model.unk_token); this.cls = id('[CLS]'); this.sep = id('[SEP]');
    this.prefix = json.model.continuing_subword_prefix; this.maxChars = json.model.max_input_chars_per_word;
  }
  normalize(text) {
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      if (isWhitespace(ch)) out += ' '; else if (isCjk(cp)) out += ` ${ch} `; else out += ch;
    }
    return out;
  }
  preTokenize(text) {
    const words = []; let current = '';
    const flush = () => { if (current) { words.push(current); current = ''; } };
    for (const ch of text) {
      if (isWhitespace(ch)) flush(); else if (isPunctuation(ch)) { flush(); words.push(ch); } else current += ch;
    }
    flush(); return words;
  }
  wordPiece(word) {
    const chars = Array.from(word);
    if (chars.length > this.maxChars) return [this.unk];
    const ids = []; let start = 0;
    while (start < chars.length) {
      let end = chars.length, found;
      while (start < end) {
        let piece = chars.slice(start, end).join('');
        if (start > 0) piece = this.prefix + piece;
        found = this.vocab.get(piece);
        if (found !== undefined) break;
        end -= 1;
      }
      if (found === undefined) return [this.unk];
      ids.push(found); start = end;
    }
    return ids;
  }
  tokenize(text) { return this.preTokenize(this.normalize(text)).flatMap(w => this.wordPiece(w)); }
  encodePair(first, second, maxLength = 256) {
    const a = this.tokenize(first); let b = this.tokenize(second);
    const room = maxLength - a.length - 3;
    if (b.length > room) b = b.slice(0, Math.max(0, room));
    const inputIds = [this.cls, ...a, this.sep, ...b, this.sep];
    const typeIds = [...new Array(a.length + 2).fill(0), ...new Array(b.length + 1).fill(1)];
    return { inputIds, typeIds, attentionMask: new Array(inputIds.length).fill(1) };
  }
}

export const CONTEXT_KEYS = ['ui_stage', 'selected_crop', 'predicted_crop', 'crop_mismatch', 'prediction_mode', 'category',
  'disease_name', 'confidence', 'top_predictions', 'severity', 'decision_status', 'save_status',
  'recapture', 'pesticides', 'selected_usage_id', 'pending_target'];
const isEmpty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** 점수는 학습 데이터처럼 소수 둘째 자리 (voiceContext.ts roundScore·백엔드 voice_context._score 와 같은 Python round) */
export function roundScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const scaled = value * 100;
  if (Number.isInteger(value * 8) && !Number.isInteger(scaled)) { const low = Math.floor(scaled); return (low % 2 === 0 ? low : low + 1) / 100; }
  return Number(value.toFixed(2));
}

/** 진단 결과(오프라인 summarize 결과나 서버 응답) → 학습 때와 같은 화면 상태 */
export function compactContext(diagnosis, uiStage) {
  const raw = {};
  if (diagnosis) {
    const pesticides = diagnosis.pesticides?.length ? diagnosis.pesticides : diagnosis.current_pesticides ?? [];
    Object.assign(raw, {
      selected_crop: diagnosis.selected_crop, predicted_crop: diagnosis.predicted_crop, crop_mismatch: diagnosis.crop_mismatch,
      prediction_mode: diagnosis.prediction_mode, category: diagnosis.category, disease_name: diagnosis.disease_name,
      confidence: roundScore(diagnosis.confidence),
      top_predictions: (diagnosis.top_predictions ?? []).map(p => ({ name: p.name, confidence: roundScore(p.confidence) })),
      severity: diagnosis.severity, decision_status: diagnosis.decision_status, save_status: diagnosis.save_status,
      recapture: diagnosis.recapture ? { ...diagnosis.recapture } : null, pesticides: pesticides.map(p => p.name),
    });
  }
  if (uiStage) raw.ui_stage = uiStage;
  const context = {};
  for (const key of CONTEXT_KEYS) if (!isEmpty(raw[key])) context[key] = raw[key];
  if (raw.crop_mismatch === false) context.crop_mismatch = false;
  if (!('ui_stage' in context)) context.ui_stage = raw.disease_name ? 'result' : 'no_photo';
  if (context.recapture && typeof context.recapture === 'object') context.recapture = { region: context.recapture.region ?? null };
  if (Array.isArray(context.top_predictions)) context.top_predictions = context.top_predictions.slice(0, 2);
  if (Array.isArray(context.pesticides)) context.pesticides = context.pesticides.slice(0, 5);
  const ordered = {};
  for (const key of CONTEXT_KEYS) if (key in context) ordered[key] = context[key];
  return ordered;
}

const FLOAT_KEYS = new Set(['confidence', '점수']);
/** json.dumps(context, ensure_ascii=False, separators=(",", ":")) 와 같은 문자열 */
export function contextJson(context) {
  const write = (value, key) => {
    if (typeof value === 'number') return key && FLOAT_KEYS.has(key) && Number.isInteger(value) ? `${value}.0` : JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(v => write(v, key)).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${write(v, k)}`).join(',')}}`;
    return JSON.stringify(value ?? null);
  };
  return write(context);
}

const CLF_KEYS = {
  ui_stage: '단계', selected_crop: '선택작물', predicted_crop: '예측작물', crop_mismatch: '작물불일치',
  prediction_mode: '방식', category: '분류', disease_name: '병명', confidence: '점수', top_predictions: '후보',
  severity: '심각도', decision_status: '판정', save_status: '저장', recapture: '재촬영', pesticides: '농약',
  selected_usage_id: '선택제품', pending_target: '되물음', name: '이름', region: '부위',
};
const renameKeys = v => Array.isArray(v) ? v.map(renameKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [CLF_KEYS[k] ?? k, renameKeys(x)])) : v;
export function clfContext(context, format) {
  if (format !== 'clf_v2') return context;
  const copy = { ...context };
  if (Array.isArray(copy.pesticides)) copy.pesticides = copy.pesticides.length;
  return renameKeys(copy);
}

const argmax = values => { let best = 0; for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i; return best; };
export function assembleCall(labels, outputs) {
  const index = argmax(outputs.fn_logits), fn = labels.functions[index];
  const args = labels.heads.filter(h => h.function === fn).map(h => `${h.argument}=${argmax(outputs[`${h.function}.${h.argument}`]) + 1}`);
  return `<hs_${index}>(${args.join(', ')})<hs_end>`;
}

/** 분류기 하나. session 은 model_int8.onnx 로 만든 ort.InferenceSession */
export function createClassifier(ort, session, tokenizer, labels) {
  return async function select(utterance, context) {
    const enc = tokenizer.encodePair(utterance, contextJson(clfContext(context, labels.context_format)), 256);
    const n = enc.inputIds.length, values = { input_ids: enc.inputIds, attention_mask: enc.attentionMask, token_type_ids: enc.typeIds };
    const feeds = {};
    for (const name of session.inputNames) feeds[name] = new ort.Tensor('int64', BigInt64Array.from(values[name], v => BigInt(v)), [1, n]);
    const out = await session.run(feeds);
    const logits = {};
    for (const [name, tensor] of Object.entries(out)) logits[name] = tensor.data;
    return assembleCall(labels, logits);
  };
}
