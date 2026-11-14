/**
 * 기능 선택기 (#165). 받아 적은 말과 화면 상태로 "<hs_N>(…)<hs_end>" 호출 문자열을 고른다.
 *
 * 구현은 기기마다 바꿔 끼운다. 어느 구현이든 결과 문자열은 같아서 그 뒤(답변 API·낭독)는 그대로다.
 *   server       서버가 고른다 (POST /voice/select-function). 기본이자 마지막 대안
 *   mobile_clf   휴대폰(iPhone·안드로이드) 소형 분류기 (#167)
 *   web_qwen     WebGPU PC 의 Qwen q4f16 (#168)
 *   board_rkllm  오렌지파이 보드 사이드카 (#169). 강제 지정으로만 쓴다
 *
 * 기기 안 구현은 registerSelector 로 붙인다. 아직 붙은 것이 없으면 늘 server 다.
 * 붙은 구현이 준비되지 않았거나(모델 미다운로드 등) 실패하면 server 로 다시 고른다. 사용자가 취소했으면 다시 고르지 않는다.
 * 측정·디버그용으로 음성 모드 주소에 ?selector=<kind> 를 붙이면 그 구현을 강제한다 (기억해 두고, ?selector=auto 로 푼다).
 */
import { autoSelectorKind, deviceKind, type SelectorKind } from "./deviceKind";
import { selectFunction, type UiStage } from "./voiceApi";

export type { SelectorKind };
export const SELECTOR_KINDS: readonly SelectorKind[] = ["server", "mobile_clf", "web_qwen", "board_rkllm"];
export const SELECTOR_OVERRIDE_KEY = "cropy:voice-selector";

export interface SelectorScreen {
  diagnosisId: string | null;
  uiStage: UiStage;
}

export interface FunctionSelector {
  kind: SelectorKind;
  /** 이 기기에서 지금 쓸 수 있는지 (모델을 받았는지 등). false 나 오류면 server 로 간다 */
  isReady(): Promise<boolean>;
  select(utterance: string, screen: SelectorScreen, signal?: AbortSignal): Promise<{ function_call: string; context?: Record<string, unknown> }>;
}

/** 고른 결과와 실제로 고른 구현. source 는 답변 API 에 그대로 보낸다 */
export interface FunctionSelection {
  function_call: string;
  context?: Record<string, unknown>;
  source: SelectorKind;
}

export const serverSelector: FunctionSelector = {
  kind: "server",
  isReady: async () => true,
  select: (utterance, screen, signal) => selectFunction(utterance, screen, signal),
};

const registry = new Map<SelectorKind, FunctionSelector>();

/** 기기 안 구현을 붙인다. 돌려받은 함수를 부르면 뗀다 */
export function registerSelector(selector: FunctionSelector): () => void {
  registry.set(selector.kind, selector);
  return () => {
    if (registry.get(selector.kind) === selector) registry.delete(selector.kind);
  };
}

const isSelectorKind = (value: unknown): value is SelectorKind => SELECTOR_KINDS.includes(value as SelectorKind);

/** 주소의 ?selector= 를 읽어 기억한다. auto 는 기억을 지운다. 잘못된 값은 무시한다. localStorage 가 막혀 있으면 주소 값만 쓴다 */
export function readSelectorOverride(search = typeof window === "undefined" ? "" : window.location.search): SelectorKind | null {
  const param = new URLSearchParams(search).get("selector");
  try {
    if (param === "auto") {
      localStorage.removeItem(SELECTOR_OVERRIDE_KEY);
      return null;
    }
    if (isSelectorKind(param)) {
      localStorage.setItem(SELECTOR_OVERRIDE_KEY, param);
      return param;
    }
    const saved = localStorage.getItem(SELECTOR_OVERRIDE_KEY);
    return isSelectorKind(saved) ? saved : null;
  } catch {
    return isSelectorKind(param) ? param : null;
  }
}

// WebGPU 는 navigator.gpu 가 있어도 어댑터를 못 받는 PC(GPU 차단·VM 등)가 있어 어댑터까지 확인한다. 한 번만 묻는다.
// 드라이버에 따라 답이 오지 않을 수 있어 기다리는 시간을 정해 둔다 (넘으면 없는 것으로 본다)
export const WEBGPU_TIMEOUT_MS = 1500;
let webgpuCheck: Promise<boolean> | null = null;
export function hasWebGpu(): Promise<boolean> {
  webgpuCheck ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), WEBGPU_TIMEOUT_MS); });
      return Boolean(await Promise.race([gpu.requestAdapter(), timeout]));
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
  return webgpuCheck;
}

/**
 * 이 기기에서 쓸 수 있는 선택기 종류. 강제 지정이 먼저다.
 * 휴대폰은 GPU 를 묻지 않고, PC 도 Qwen 구현(web_qwen)이 붙어 있을 때만 묻는다 (안 붙었으면 어차피 server 라 발화를 기다리게 하지 않는다)
 */
export async function preferredSelectorKind(): Promise<SelectorKind> {
  const override = readSelectorOverride();
  if (override) return override;
  const userAgent = navigator.userAgent;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  if (deviceKind(userAgent, touchPoints) !== "desktop" || !registry.has("web_qwen")) return autoSelectorKind({ userAgent, touchPoints });
  return autoSelectorKind({ userAgent, touchPoints, webgpu: await hasWebGpu() });
}

/** 지금 쓸 선택기. 바라는 구현이 없거나 준비되지 않았으면 server */
export async function resolveSelector(): Promise<FunctionSelector> {
  const kind = await preferredSelectorKind();
  const selector = kind === "server" ? undefined : registry.get(kind);
  if (!selector) return serverSelector;
  try {
    if (await selector.isReady()) return selector;
    console.info(`[voice] ${kind} 선택기가 준비되지 않아 서버로 고릅니다`);
  } catch (cause) {
    console.warn(`[voice] ${kind} 선택기 준비 확인 실패, 서버로 고릅니다`, cause);
  }
  return serverSelector;
}

/** 말 한 마디의 기능을 고른다. 기기 안 구현이 실패하면 server 로 다시 고른다 (취소된 경우는 그대로 던진다) */
export async function selectFunctionCall(utterance: string, screen: SelectorScreen, signal?: AbortSignal): Promise<FunctionSelection> {
  const selector = await resolveSelector();
  if (selector !== serverSelector) {
    try {
      return { ...(await selector.select(utterance, screen, signal)), source: selector.kind };
    } catch (cause) {
      if (signal?.aborted) throw cause;
      // 기기 안 선택기 원인을 남긴다 (#167~#169 디버깅). 사용자에게는 서버 결과나 서버 오류만 보인다
      console.warn(`[voice] ${selector.kind} 선택기 실패, 서버로 다시 고릅니다`, cause);
    }
  }
  return { ...(await serverSelector.select(utterance, screen, signal)), source: "server" };
}

/** 테스트용: 붙인 구현과 WebGPU 확인 결과를 비운다 */
export function resetFunctionSelectors(): void {
  registry.clear();
  webgpuCheck = null;
}
