// 기기 안 받아 적기 (SenseVoice int8, onnxruntime-web). 서버 STT(stt/server.py, sherpa-onnx)와 같은 계산을 JS로 한다.
// 특징: kaldi fbank 80차 (16kHz, 25ms/10ms, DC 제거, 프리엠퍼시스 0.97, hamming, FFT 512, mel 20Hz~나이퀴스트, dither 0, snip_edges)
//  → LFR(7개 묶음, 6칸 이동, 양끝 프레임 복제) → CMVN(모델 메타데이터) → CTC 탐욕 디코딩, 앞 4토큰(언어·감정·이벤트·ITN) 버림.
// 근거: sherpa-onnx offline-recognizer-sense-voice-impl.h, lfr.cc. 수치 확인은 tests/offline-voice-stt.test.mjs.

export const SAMPLE_RATE = 16000;
const FRAME = 400, SHIFT = 160, NFFT = 512, MELS = 80, LFR_M = 7, LFR_N = 6;

const WINDOW = Float64Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (FRAME - 1)));

function melBanks() {
  const mel = f => 1127 * Math.log(1 + f / 700);
  const lo = mel(20), hi = mel(SAMPLE_RATE / 2), delta = (hi - lo) / (MELS + 1);
  const banks = [];
  for (let m = 0; m < MELS; m++) {
    const l = lo + m * delta, c = l + delta, r = c + delta, w = [];
    for (let k = 0; k < NFFT / 2; k++) {
      const f = mel(k * SAMPLE_RATE / NFFT);
      if (f > l && f < r) w.push([k, f <= c ? (f - l) / (c - l) : (r - f) / (r - c)]);
    }
    banks.push(w);
  }
  return banks;
}
const BANKS = melBanks();

// 512점 복소 FFT (제자리, 비트 뒤집기 + 버터플라이)
const REV = new Uint16Array(NFFT);
for (let i = 0, bits = Math.log2(NFFT); i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); REV[i] = r; }
const COS = Float64Array.from({ length: NFFT / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / NFFT));
const SIN = Float64Array.from({ length: NFFT / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / NFFT));
function fft(re, im) {
  for (let i = 0; i < NFFT; i++) { const j = REV[i]; if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let size = 2; size <= NFFT; size *= 2) {
    const half = size / 2, step = NFFT / size;
    for (let start = 0; start < NFFT; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half, wr = COS[k * step], wi = SIN[k * step];
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** samples: Float32Array (-1~1, 16kHz) → Float32Array (frames × 80) */
export function fbank(samples) {
  const n = samples.length < FRAME ? 0 : 1 + Math.floor((samples.length - FRAME) / SHIFT);
  const out = new Float32Array(n * MELS), re = new Float64Array(NFFT), im = new Float64Array(NFFT), frame = new Float64Array(FRAME);
  const floor = 1.1920928955078125e-7; // FLT_EPSILON
  for (let t = 0; t < n; t++) {
    let mean = 0;
    for (let i = 0; i < FRAME; i++) { frame[i] = samples[t * SHIFT + i] * 32768; mean += frame[i]; }
    mean /= FRAME;
    for (let i = 0; i < FRAME; i++) frame[i] -= mean;
    for (let i = FRAME - 1; i > 0; i--) frame[i] -= 0.97 * frame[i - 1];
    frame[0] -= 0.97 * frame[0];
    re.fill(0); im.fill(0);
    for (let i = 0; i < FRAME; i++) re[i] = frame[i] * WINDOW[i];
    fft(re, im);
    for (let m = 0; m < MELS; m++) {
      let e = 0;
      for (const [k, w] of BANKS[m]) e += w * (re[k] * re[k] + im[k] * im[k]);
      out[t * MELS + m] = Math.log(Math.max(e, floor));
    }
  }
  return { data: out, frames: n };
}

/** LFR + CMVN. negMean·invStd 는 560차 (모델 메타데이터) */
export function lfrCmvn({ data, frames }, negMean, invStd) {
  if (!frames) return { data: new Float32Array(0), frames: 0 };
  const n = 1 + Math.floor((frames - 1) / LFR_N), dim = MELS * LFR_M, left = (LFR_M - 1) / 2;
  const out = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < LFR_M; j++) {
      const src = Math.min(Math.max(i * LFR_N - left + j, 0), frames - 1);
      for (let m = 0; m < MELS; m++) {
        const d = j * MELS + m;
        out[i * dim + d] = (data[src * MELS + m] + negMean[d]) * invStd[d];
      }
    }
  }
  return { data: out, frames: n };
}

/** CTC 탐욕 디코딩 → 글자. 0 = 빈칸. 앞 4토큰은 언어·감정·이벤트·ITN 표시 */
export function ctcDecode(logits, frames, vocab, tokens) {
  const ids = [];
  let prev = -1;
  for (let t = 0; t < frames; t++) {
    let best = 0, bv = -Infinity;
    for (let v = 0, o = t * vocab; v < vocab; v++) if (logits[o + v] > bv) { bv = logits[o + v]; best = v; }
    if (best !== prev && best !== 0) ids.push(best);
    prev = best;
  }
  return ids.slice(4).map(i => tokens[i]).join('').replaceAll('▁', ' ').trim();
}

export function parseTokens(text) {
  const tokens = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const at = line.lastIndexOf(' ');
    tokens[Number(line.slice(at + 1))] = line.slice(0, at);
  }
  return tokens;
}

/** 모델 메타데이터(neg_mean 등)는 ORT 웹이 읽지 못해 묶음의 sensevoice.json 에 따로 둔다 */
export function createRecognizer(ort, session, meta, tokens) {
  const negMean = Float32Array.from(meta.neg_mean), invStd = Float32Array.from(meta.inv_stddev);
  return async function transcribe(samples) {
    const feats = lfrCmvn(fbank(samples), negMean, invStd);
    if (!feats.frames) return '';
    const out = await session.run({
      x: new ort.Tensor('float32', feats.data, [1, feats.frames, MELS * LFR_M]),
      x_length: new ort.Tensor('int32', Int32Array.of(feats.frames), [1]),
      language: new ort.Tensor('int32', Int32Array.of(meta.lang_ko), [1]),
      text_norm: new ort.Tensor('int32', Int32Array.of(meta.with_itn), [1]),
    });
    const logits = out.logits;
    return ctcDecode(logits.data, logits.dims[1], logits.dims[2], tokens);
  };
}

// 서버 stt_service.normalize_transcript 와 같다: 전각 문장부호 5개 → 반각, 한국어가 아닌 한자·가나 제거, 소수점·천 단위 밖의 문장부호 제거
const NON_KOREAN_CJK = /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]+/gu;
const PUNCTUATION = /[!?;:…~]|(?<!\d)[.,]|[.,](?!\d)/gu;
const FULLWIDTH = { '。': '.', '？': '?', '！': '!', '，': ',', '、': ',' };
export function normalizeTranscript(text) {
  const half = text.replace(/[。？！，、]/gu, c => FULLWIDTH[c]);
  return half.replace(NON_KOREAN_CJK, ' ').replace(PUNCTUATION, ' ').replace(/\s+/gu, ' ').trim();
}

/** 16kHz 로 선형 보간 리샘플 (마이크는 보통 44.1/48kHz) */
export function resample(input, fromRate) {
  if (fromRate === SAMPLE_RATE) return input;
  const n = Math.floor(input.length * SAMPLE_RATE / fromRate), out = new Float32Array(n), ratio = fromRate / SAMPLE_RATE;
  for (let i = 0; i < n; i++) {
    const x = i * ratio, j = Math.floor(x), f = x - j;
    out[i] = j + 1 < input.length ? input[j] * (1 - f) + input[j + 1] * f : input[j];
  }
  return out;
}
