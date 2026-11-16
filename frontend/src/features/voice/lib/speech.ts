/**
 * Web Speech API(speechSynthesis) 저수준 래퍼.
 *
 * 서버 렌더 중이나 미지원 브라우저에서는 모든 함수가 조용히 아무것도 하지 않는다.
 * 음성 안내는 화면을 보조하는 기능이라, 실패해도 진단 흐름을 막지 않는다.
 */

/** 고령 사용자 기준으로 기본보다 조금 느리게 읽는다 (S3-01 사용자 테스트에서 조정) */
export const SPEECH_RATE = 0.9;

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** 일반 낭독용으로 쓸 만한 한국어 보이스 (Apple의 Yuna, Chrome의 Google 한국의 등) */
const PREFERRED_VOICE = /yuna|google|heami|sunhi|injoon/i;

/**
 * 한국어 보이스를 고른다. iOS·macOS는 Grandma·Rocko 같은 장난스러운 보이스도
 * 한국어로 나열하므로 기본 보이스 → 알려진 보이스 → 첫 번째 순으로 고른다.
 * Chrome은 getVoices()가 처음엔 빈 배열이다가 voiceschanged 뒤에 채워지므로,
 * 못 찾으면 lang만 지정해 브라우저 기본값에 맡긴다.
 */
function pickKoreanVoice(): SpeechSynthesisVoice | undefined {
  const korean = window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ko"));
  return (
    korean.find((v) => v.default) ??
    korean.find((v) => PREFERRED_VOICE.test(v.name)) ??
    korean[0]
  );
}

/** 보이스 목록 로드를 미리 깨워 둔다 (첫 발화가 기본 보이스로 나가는 것을 줄인다) */
export function warmUpVoices(): void {
  if (!isSpeechSupported()) return;
  window.speechSynthesis.getVoices();
}

/** 마지막으로 speak를 부른 쪽. 화면이 사라질 때 남이 시작한 낭독까지 끊지 않으려고 둔다 */
let currentOwner: symbol | undefined;
let primed = false;

/**
 * 읽던 문장을 끊는다. owner를 주면 그쪽이 마지막으로 시작한 낭독일 때만 끊는다
 * (예: 카메라를 닫을 때 그 사이 시작된 결과 낭독은 그대로 둔다).
 */
export function cancelSpeech(owner?: symbol): void {
  if (!isSpeechSupported()) return;
  if (owner && owner !== currentOwner) return;
  window.speechSynthesis.cancel();
}

/**
 * iOS Safari는 사용자 탭 안에서 한 번 발화해야 이후 비동기 발화를 허용한다.
 * 탭 핸들러에서 무음 utterance를 한 번 넣어 그 제한을 풀어 둔다.
 */
export function primeSpeech(): void {
  if (!isSpeechSupported() || primed) return;
  primed = true;
  const utterance = new SpeechSynthesisUtterance("");
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}

/**
 * 읽던 문장을 끊고 새 문장을 읽는다.
 *
 * 배열은 문장 단위 utterance로 나눠 큐에 넣는다. Chrome은 한 utterance가
 * 15초쯤 넘어가면 말을 멈춰버리는 문제가 있어 짧게 끊어 읽는 편이 안전하다.
 */
export function speak(text: string | string[], owner?: symbol): void {
  if (!isSpeechSupported()) return;
  const sentences = (Array.isArray(text) ? text : [text]).filter((s) => s.trim());
  if (sentences.length === 0) return;

  const synth = window.speechSynthesis;
  // 읽는 중이 아닐 때도 cancel하면 일부 Safari·Chrome에서 바로 뒤 utterance가 묻힌다
  if (synth.speaking || synth.pending) synth.cancel();
  currentOwner = owner;
  const voice = pickKoreanVoice();
  for (const sentence of sentences) {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = "ko-KR";
    utterance.rate = SPEECH_RATE;
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  }
}

/**
 * speak와 같지만 마지막 문장을 다 읽거나(end) 끊기거나(error·cancel) 했을 때 끝나는 Promise를 돌려준다.
 * 음성 모드가 "말하는 중" 상태를 실제 낭독 길이에 맞추는 데 쓴다. 미지원 환경이나 읽을 문장이
 * 없으면 바로 끝난다. 큐에 넣은 utterance가 시작도 못 하고 cancel되면 브라우저에 따라 end·error가
 * 오지 않을 수 있어, 호출한 쪽은 자기 상태 전환을 이 Promise에만 의존하지 않는다.
 *
 * 결과로 어떻게 끝났는지 돌려준다. 실제 발화 실패(not-allowed, audio-busy 등)를 다 읽은 것과 구분해야
 * 음성 모드가 무음인 채로 다시 듣기를 반복하지 않는다. started는 한 문장이라도 onstart가 왔는지로,
 * "시작 자체가 안 됨"과 "시작했지만 소리가 안 들림"을 가르는 데 쓴다.
 * 오류·끊김은 첫 이벤트에서 바로 결과를 낸다(뒤 문장의 이벤트를 기다리지 않는다).
 */
export type SpeechOutcome =
  | { status: "ended"; started: boolean }
  | { status: "cancelled"; started: boolean }
  | { status: "failed"; started: boolean; error: string }
  | { status: "unsupported"; started: false };

// cancel()로 끊긴 경우. 실패가 아니다
const CANCEL_ERRORS = new Set(["canceled", "interrupted"]);

export function speakAndWait(text: string | string[], owner?: symbol): Promise<SpeechOutcome> {
  if (!isSpeechSupported()) return Promise.resolve({ status: "unsupported", started: false });
  const sentences = (Array.isArray(text) ? text : [text]).filter((s) => s.trim());
  if (sentences.length === 0) return Promise.resolve({ status: "ended", started: false });

  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) synth.cancel();
  currentOwner = owner;
  const voice = pickKoreanVoice();
  return new Promise<SpeechOutcome>((resolve) => {
    let remaining = sentences.length;
    let started = false;
    let settled = false;
    const settle = (outcome: SpeechOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const ended = () => {
      remaining -= 1;
      if (remaining <= 0) settle({ status: "ended", started });
    };
    for (const sentence of sentences) {
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = "ko-KR";
      utterance.rate = SPEECH_RATE;
      if (voice) utterance.voice = voice;
      utterance.onstart = () => { started = true; };
      utterance.onend = ended;
      // 오류는 첫 번째에서 바로 끝낸다. 오류 뒤 큐에 남은 문장은 브라우저에 따라 end·error가 오지 않아
      // 남은 수를 세며 기다리면 Promise가 끝나지 않고 음성 모드가 speaking에 머문다
      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        if (settled) return;
        const code = event?.error ?? "unknown";
        if (CANCEL_ERRORS.has(code)) {
          settle({ status: "cancelled", started });
          return;
        }
        settle({ status: "failed", started, error: code });
        // 실패 뒤 남은 문장이 늦게 소리 나지 않게 비운다. 그 사이 다른 쪽이 낭독을 시작했으면 건드리지 않는다
        if (currentOwner === owner) synth.cancel();
      };
      synth.speak(utterance);
    }
  });
}
