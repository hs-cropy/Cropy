// 오프라인 화면의 음성 질문 — 인터넷 없이 기기 안에서 끝까지 돈다.
//   마이크 → 말 끝 감지(에너지) → 받아 적기(voice-stt) → 용어 보정(voice-lexicon) → 호출어·명령(voice-intents)
//   → 기능 선택(voice-clf, 휴대폰 분류기) → 답변 문장(voice-handlers, 기기에 저장된 진단 결과) → 기기 안 음성으로 읽기
// 온라인 음성 모드와 같게 마이크 버튼(한 번 듣고 답함), "부르면 시작"(대기 중 "여보세요"·"크로피"로 부르면 듣고 답함),
// "연속 대화"(답을 다 읽으면 버튼 없이 다시 듣고, 말이 없는 일이 두 번 이어지면 대기로 돌아감)가 있다.
// 모델 파일은 음성 질문 파일 카드에서 받아 둔 묶음(IndexedDB assets 'fn:stt'·'fn:mobile_clf', Cache Storage)을 쓴다.

import { createRecognizer, parseTokens, normalizeTranscript, resample } from './voice-stt.mjs';
import { Lexicon, parseTerms } from './voice-lexicon.mjs';
import { WordPieceTokenizer, createClassifier, compactContext } from './voice-clf.mjs';
import { handleFunctionOutput, contractFromLabels, llmContext } from './voice-handlers.mjs';
import { matchWakeWord, isCaptureCommand, isExitCommand } from './voice-intents.mjs';

export const VOICE_KINDS = ['stt', 'mobile_clf'];
export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const FRAME = 2048;                 // ScriptProcessor 버퍼 (48kHz 에서 약 43ms)
const START_FRAMES = 3, END_SILENCE = 0.8, MAX_SECONDS = 8, MIN_SECONDS = 0.35, PREROLL = 0.3;
// 질문을 듣는 중 말이 없으면 그만 듣는다 (앱 useVoiceConversation 의 NO_SPEECH_MS·MAX_SILENT_ROUNDS 와 같다)
const NO_SPEECH_MS = 8000, MAX_SILENT_ROUNDS = 2;

/** 말소리 구간 나누기. 소음 바닥을 따라가며 그보다 충분히 크면 말소리로 본다 */
export class Segmenter {
  constructor(rate) { this.rate = rate; this.reset(); }
  reset() { this.noise = 0.004; this.loud = 0; this.silent = 0; this.speaking = false; this.chunks = []; this.pre = []; this.length = 0; }
  /** 프레임 하나를 넣는다. 구간이 끝나면 Float32Array(원래 표본율)를 돌려준다 */
  push(frame) {
    let sum = 0; for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length), threshold = Math.max(0.012, this.noise * 3);
    const seconds = frame.length / this.rate;
    if (!this.speaking) {
      this.pre.push(frame); while (this.pre.length * seconds > PREROLL) this.pre.shift();
      if (rms > threshold) { if (++this.loud >= START_FRAMES) { this.speaking = true; this.chunks = [...this.pre]; this.length = this.chunks.reduce((n, c) => n + c.length, 0); this.silent = 0; } }
      else { this.loud = 0; this.noise = 0.95 * this.noise + 0.05 * rms; }
      return null;
    }
    this.chunks.push(frame); this.length += frame.length;
    this.silent = rms > threshold * 0.7 ? 0 : this.silent + seconds;
    if (this.silent >= END_SILENCE || this.length / this.rate >= MAX_SECONDS) {
      const out = new Float32Array(this.length); let o = 0;
      for (const c of this.chunks) { out.set(c, o); o += c.length; }
      const speech = this.length / this.rate - this.silent;
      this.speaking = false; this.loud = 0; this.chunks = []; this.pre = []; this.length = 0; this.silent = 0;
      return speech >= MIN_SECONDS ? out : null;
    }
    return null;
  }
}

async function cachedText(cache, record, name) { return new TextDecoder().decode(await cachedBytes(cache, record, name)); }
async function cachedBytes(cache, record, name) {
  const hit = await cache.match(new URL(record.base_url.replace(/\/$/, '') + '/' + name, location.origin).href);
  if (!hit) throw new Error('음성 질문 파일이 이 기기에 없어요. 준비 화면에서 다시 받아주세요.');
  return new Uint8Array(await hit.arrayBuffer());
}

/** 받아 둔 묶음으로 받아 적기·기능 선택을 준비한다. records: {stt, mobile_clf} (IndexedDB 묶음 기록) */
export async function loadVoiceModels(ort, cache, records) {
  const stt = records.stt, clf = records.mobile_clf;
  const [meta, tokens, terms, labels, tokenizer] = await Promise.all([
    cachedText(cache, stt, 'sensevoice.json').then(JSON.parse), cachedText(cache, stt, 'tokens.txt').then(parseTokens),
    cachedText(cache, stt, 'terms.txt').then(parseTerms), cachedText(cache, clf, 'labels.json').then(JSON.parse),
    cachedText(cache, clf, 'tokenizer.json').then(JSON.parse),
  ]);
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const clfSession = await ort.InferenceSession.create(await cachedBytes(cache, clf, 'model_int8.onnx'), options);
  const sttSession = await ort.InferenceSession.create(await cachedBytes(cache, stt, 'model.int8.onnx'), options);
  return {
    transcribe: createRecognizer(ort, sttSession, meta, tokens), lexicon: new Lexicon(terms),
    select: createClassifier(ort, clfSession, new WordPieceTokenizer(tokenizer), labels), contract: contractFromLabels(labels),
    release: () => Promise.all([sttSession.release?.(), clfSession.release?.()]),
  };
}

export const WAKE_REPLY = '네, 말씀하세요.';
export const EXIT_REPLY = '음성 질문을 마칠게요.';
export const NOT_HEARD = '잘 듣지 못했어요. 다시 말씀해 주세요.';
export const CAPTURE_FAILED = '사진을 찍지 못했어요. 화면의 카메라 버튼으로 찍어 주세요.';

/** 받아 적은 말 하나에 답한다. hooks: getScreen() → {result, uiStage}, capture() → 답 문장(진단 결과 읽기)이나 null */
export async function answerUtterance(models, raw, hooks) {
  const text = models.lexicon.correct(normalizeTranscript(raw)).text;
  if (!text) return { kind: 'empty', text, reply: NOT_HEARD };
  if (isExitCommand(text)) return { kind: 'exit', text, reply: EXIT_REPLY };
  if (isCaptureCommand(text)) return { kind: 'capture', text, reply: (await hooks.capture()) ?? CAPTURE_FAILED };
  const { result, uiStage } = hooks.getScreen();
  const context = compactContext(result, uiStage);
  const call = await models.select(text, context);
  console.debug('[cropy-voice]', text, call, JSON.stringify(context));
  try {
    const answer = handleFunctionOutput(call, llmContext(result), models.contract, { uiStage });
    return { kind: 'answer', text, call, reply: answer.text, status: answer.status };
  } catch {
    return { kind: 'answer', text, call, reply: '잘 이해하지 못했어요. 다른 말로 다시 물어봐 주세요.', status: 'invalid' };
  }
}

/** 마이크와 대화 흐름. ui: {state(name, detail)}, speak(text) → Promise (끝날 때 resolve).
 *  wake: 대기 중 호출어를 들을지, continuous: 답한 뒤 다시 들을지 (앱 음성 모드의 두 스위치) */
export function createVoiceSession({ models, hooks, ui, speak, wake = false, continuous = false }) {
  let stream, context, node, segmenter, mode = 'off', busy = false, muted = false, pending = null;
  let silentTimer = null, silentRounds = 0, wantListen = false;

  async function openMic() {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    context = new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    node = context.createScriptProcessor(FRAME, 1, 1);
    segmenter = new Segmenter(context.sampleRate);
    node.onaudioprocess = event => {
      if (muted || busy || mode === 'off') return;
      const segment = segmenter.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      if (segmenter.speaking) clearSilence();
      if (segment) onSegment(resample(segment, context.sampleRate));
    };
    source.connect(node); node.connect(context.destination);
  }
  function closeMic() {
    node?.disconnect(); stream?.getTracks().forEach(t => t.stop()); context?.close().catch(() => {});
    stream = context = node = segmenter = null;
  }
  // 휴대폰은 마이크를 잡은 채로는 답이 들리지 않는다 (안드로이드 Chrome 무음 #183, iOS 는 수화부로 작게).
  // 그래서 휴대폰에서는 읽기 전에 마이크를 놓고, 다 읽은 뒤 다시 연다 (앱 useVoiceConversation 과 같다)
  async function say(text) {
    muted = true; ui.state('speaking', text);
    const release = isMobile();
    if (release) closeMic();
    // iOS 는 마이크를 놓은 뒤 오디오가 재생 상태로 돌아올 시간이 필요하다 (앱 #198 과 같은 0.7초)
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (release && ios) await new Promise(r => setTimeout(r, 700));
    try {
      const failure = await speak(text);
      if (failure) ui.state('error', failure);
    } finally {
      await new Promise(r => setTimeout(r, 300));
      if (release && mode !== 'off') await openMic().catch(() => {});
      segmenter?.reset(); muted = false;
    }
  }

  async function onSegment(samples) {
    busy = true;
    try {
      ui.state('thinking');
      const raw = await models.transcribe(samples);
      if (mode === 'wake' && !pending) {
        const match = matchWakeWord(normalizeTranscript(raw));
        if (!match) { ui.state('waiting'); return; }  // 호출어가 아니면 조용히 계속 기다린다
        if (!match.remainder) { pending = 'question'; await say(WAKE_REPLY); ui.state('listening'); return; }
        await respond(match.remainder);
        return;
      }
      pending = null;
      await respond(raw);
    } catch (error) {
      ui.state('error', error?.message || '음성 질문을 처리하지 못했어요.');
      if (mode !== 'off') await idle();
    } finally {
      busy = false;
      // 받아 적는 중에 마이크 버튼을 눌렀으면 끝난 뒤 바로 질문을 듣는다
      if (wantListen && mode !== 'off') { wantListen = false; await listen().catch(() => {}); }
      else if (mode === 'wake' && !pending) ui.state('waiting');
    }
  }
  async function respond(raw) {
    const out = await answerUtterance(models, raw, hooks);
    ui.state('heard', out.text);
    await say(out.reply);
    if (out.kind === 'exit') { stop(); return; }
    silentRounds = 0;
    // 연속 대화면 버튼 없이 다시 듣고, 아니면 대기로 돌아간다
    if (continuous && mode !== 'off') await listen(); else await idle();
  }
  // 질문 듣기. 말이 없으면 NO_SPEECH_MS 뒤 그만 듣고, 연속 대화에서 두 번 이어지면 대기로 돌아간다
  async function listen() {
    mode = 'once'; pending = 'question';
    await openMic(); segmenter.reset(); ui.state('listening');
    clearSilence();
    silentTimer = setTimeout(() => {
      silentTimer = null;
      if (mode !== 'once' || busy || segmenter?.speaking) return;
      silentRounds += 1;
      if (continuous && silentRounds < MAX_SILENT_ROUNDS) { listen().catch(() => {}); return; }
      silentRounds = 0; idle().catch(() => {});
    }, NO_SPEECH_MS);
  }
  function clearSilence() { if (silentTimer) { clearTimeout(silentTimer); silentTimer = null; } }
  // 대기: 부르면 시작이 켜져 있으면 호출어를 듣고, 꺼져 있으면 마이크를 끈다
  async function idle() {
    clearSilence(); pending = null;
    if (!wake) { stop(); return; }
    mode = 'wake'; await openMic(); segmenter.reset(); ui.state('waiting');
  }

  function stop() { clearSilence(); wantListen = false; mode = 'off'; pending = null; closeMic(); ui.state('off'); }
  return {
    get mode() { return mode; },
    get wake() { return wake; },
    get continuous() { return continuous; },
    /** 마이크 버튼: 질문을 듣는다 (듣는 중에 누르면 그만 듣고 대기로) */
    async listenOnce() { silentRounds = 0; if (busy) { wantListen = true; ui.state('thinking'); return; } await listen(); },
    /** 듣기를 그만두고 대기로 (부르면 시작이 켜져 있으면 호출어를 다시 기다린다) */
    async idle() { silentRounds = 0; await idle(); },
    /** 부르면 시작 켜기·끄기. 듣거나 말하는 중이 아니면 바로 대기 상태를 바꾼다 */
    async setWake(on) { wake = on; if (mode !== 'once' && !busy) await idle(); },
    /** 연속 대화 켜기·끄기 */
    setContinuous(on) { continuous = on; },
    stop,
    /** 셔터로 찍은 진단 결과처럼 질문 없이 읽을 문장. 휴대폰은 읽는 동안 마이크를 놓고, 다 읽으면 하던 상태로 돌아간다 */
    async announce(text) {
      if (busy) return;
      await say(text);
      ui.state(mode === 'wake' ? 'waiting' : mode === 'once' ? 'listening' : 'off');
    },
  };
}
