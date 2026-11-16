/**
 * 듣기 시작을 알리는 짧은 소리. 연속 대화에서는 버튼을 누르지 않으므로, 언제부터 말해도 되는지
 * 귀로 알 수 있어야 첫머리가 잘리지 않는다. 미지원 환경에서는 조용히 아무것도 하지 않는다.
 */

let context: AudioContext | null = null;

export function playListenCue(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return;
  try {
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume().catch(() => {});
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {
    // 소리는 보조 신호다. 실패해도 듣기는 계속한다
  }
}

/** 탭 핸들러에서 불러 오디오를 미리 깨운다. iOS는 탭 밖에서 만든 AudioContext 가 소리를 내지 않는다 */
export function primeListenCue(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return;
  try {
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    // 보조 신호라 실패해도 그만이다
  }
}
