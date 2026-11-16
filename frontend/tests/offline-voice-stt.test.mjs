// 기기 안 받아 적기: 특징 추출·용어 보정·문장 정리가 서버(sherpa-onnx·stt/lexicon.py·stt_service)와 같은지 본다.
// 기준 데이터는 fixtures/offline-voice/make_fixtures.py 가 Python으로 만든다.
// 실제 모델 확인(선택): CROPY_STT_DIR=<model.int8.onnx·tokens.txt·sensevoice.json 폴더> CROPY_STT_REF=<ref.json> node --test tests/offline-voice-stt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fbank, lfrCmvn, ctcDecode, parseTokens, normalizeTranscript, resample } from '../public/offline/voice-stt.mjs';
import { Lexicon, parseTerms, toJamo } from '../public/offline/voice-lexicon.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/offline-voice/${name}`, import.meta.url), 'utf8'));

test('fbank 80차가 kaldi-native-fbank(sherpa SenseVoice 설정)와 같다', () => {
  const { pcm16_base64, fbank: ref } = fixture('fbank.json');
  const pcm = new Int16Array(Uint8Array.from(Buffer.from(pcm16_base64, 'base64')).buffer);
  const samples = Float32Array.from(pcm, v => v / 32768);
  const { data, frames } = fbank(samples);
  assert.equal(frames, ref.length);
  let worst = 0;
  for (let t = 0; t < frames; t++) for (let m = 0; m < 80; m++) worst = Math.max(worst, Math.abs(data[t * 80 + m] - ref[t][m]));
  assert.ok(worst < 1e-3, `최대 차이 ${worst}`);
});

test('LFR 은 1+(T-1)/6 프레임, 양끝 복제, CMVN 적용', () => {
  const frames = 13, data = Float32Array.from({ length: frames * 80 }, (_, i) => Math.floor(i / 80));  // 프레임 번호를 값으로
  const zero = new Float32Array(560), one = new Float32Array(560).fill(1);
  const out = lfrCmvn({ data, frames }, zero, one);
  assert.equal(out.frames, 3);
  const first = Array.from({ length: 7 }, (_, j) => out.data[j * 80]);
  assert.deepEqual(first, [0, 0, 0, 0, 1, 2, 3]);  // 왼쪽 3칸은 첫 프레임 복제
  const last = Array.from({ length: 7 }, (_, j) => out.data[2 * 560 + j * 80]);
  assert.deepEqual(last, [9, 10, 11, 12, 12, 12, 12]);
  const shifted = lfrCmvn({ data, frames }, new Float32Array(560).fill(-1), new Float32Array(560).fill(2));
  assert.equal(shifted.data[4 * 80], (1 - 1) * 2);
});

test('CTC: 빈칸·반복을 접고 앞 4토큰(언어·감정·이벤트·ITN)을 버린다', () => {
  const tokens = parseTokens('<unk> 0\n<|ko|> 1\n<|NEUTRAL|> 2\n<|Speech|> 3\n<|withitn|> 4\n▁이 5\n병 6\n');
  const seq = [1, 2, 3, 4, 5, 5, 0, 6, 6, 0, 6];
  const vocab = 7, logits = new Float32Array(seq.length * vocab);
  seq.forEach((id, t) => { logits[t * vocab + id] = 5; });
  assert.equal(ctcDecode(logits, seq.length, vocab, tokens), '이병병');
});

test('문장 정리: 서버 normalize_transcript 와 같은 규칙', () => {
  assert.equal(normalizeTranscript('이 병이 뭐야?'), '이 병이 뭐야');
  assert.equal(normalizeTranscript('녹인병 맞아。'), '녹인병 맞아');
  assert.equal(normalizeTranscript('끝ねさ？ 0.5배, 1,000배'), '끝 0.5배 1,000배');
  assert.equal(normalizeTranscript('ロキ？ 이 병…'), '이 병');
});

test('리샘플: 48kHz → 16kHz 길이와 값', () => {
  const x = Float32Array.from({ length: 4800 }, (_, i) => i % 3);
  const y = resample(x, 48000);
  assert.equal(y.length, 1600);
  assert.equal(y[1], x[3]);
});

test('용어 보정이 stt/lexicon.py 와 모든 문장에서 같다', () => {
  const terms = parseTerms(readFileSync(new URL('../../stt/terms.txt', import.meta.url), 'utf8'));
  const lex = new Lexicon(terms);
  const wrong = fixture('lexicon.json').filter(r => lex.correct(r.in).text !== r.out).map(r => `${r.in} → ${lex.correct(r.in).text} (기준 ${r.out})`);
  assert.deepEqual(wrong, []);
  assert.equal(toJamo('탄저병'), 'ㅌㅏㄴㅈㅓㅂㅕㅇ');
});

// ── 실제 모델 (환경 변수가 있을 때만) ──
const sttDir = process.env.CROPY_STT_DIR, sttRef = process.env.CROPY_STT_REF;
test('실제 SenseVoice 를 onnxruntime-web 으로 돌려 서버(sherpa-onnx)와 받아 적기를 비교한다', { skip: !(sttDir && sttRef), timeout: 900_000 }, async () => {
  const { createRecognizer } = await import('../public/offline/voice-stt.mjs');
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const { join } = await import('node:path');
  const session = await ort.InferenceSession.create(readFileSync(join(sttDir, 'model.int8.onnx')), { executionProviders: ['wasm'] });
  const meta = JSON.parse(readFileSync(join(sttDir, 'sensevoice.json'), 'utf8'));
  const transcribe = createRecognizer(ort, session, meta, parseTokens(readFileSync(join(sttDir, 'tokens.txt'), 'utf8')));
  const rows = JSON.parse(readFileSync(sttRef, 'utf8'));
  let sameSherpa = 0, samePy = 0, ms = 0, audio = 0;
  for (const row of rows) {
    const buf = readFileSync(row.wav), pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) >> 1);
    const samples = Float32Array.from(pcm, v => v / 32768);
    const t0 = performance.now(); const text = await transcribe(samples); ms += performance.now() - t0; audio += samples.length / 16000;
    sameSherpa += text === row.sherpa; samePy += text === row.py;
    if (text !== row.sherpa) console.info(`  다름: ${row.sherpa} | ${text}`);
  }
  console.info(`[stt] sherpa와 같음 ${sameSherpa}/${rows.length}, Python ORT와 같음 ${samePy}/${rows.length}, 음성 ${audio.toFixed(1)}초를 ${(ms / 1000).toFixed(1)}초에`);
  assert.ok(sameSherpa / rows.length >= 0.75);
});
