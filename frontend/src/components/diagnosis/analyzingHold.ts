/**
 * 분석 중 화면(M-02 · D-02)을 보이는 시간. 진행 막대가 이 시간 동안 0% 에서 100% 로 차오른다
 * (실제 진행률이 아니라 시간에 맞춘 표시다)
 */
export const ANALYZING_MS = 3000;

/**
 * 진단을 시작하면 분석 중 화면을 적어도 이만큼 보인 뒤 결과·실패로 넘긴다.
 * 응답이 빨라도 화면이 번쩍 지나가지 않고, 막대가 다 찬 뒤에 넘어간다.
 * 테스트는 vitest.setup.ts 에서 0 으로 두고, 기다림을 확인하는 테스트만 되돌린다
 */
export const analyzingHold = { minMs: ANALYZING_MS };

/** 시작한 때부터 minMs 가 지날 때까지 기다린다. 취소(signal)되면 바로 끝난다 */
export function waitAnalyzingHold(startedAt: number, signal: AbortSignal) {
  const remaining = analyzingHold.minMs - (Date.now() - startedAt);
  if (remaining <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, remaining);
    signal.addEventListener("abort", done);
  });
}
