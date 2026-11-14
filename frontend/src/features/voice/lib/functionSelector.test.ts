import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ selectFunction: vi.fn() }));
vi.mock("./voiceApi", () => ({ selectFunction: api.selectFunction }));

import {
  SELECTOR_OVERRIDE_KEY,
  WEBGPU_TIMEOUT_MS,
  hasWebGpu,
  preferredSelectorKind,
  readSelectorOverride,
  registerSelector,
  resetFunctionSelectors,
  resolveSelector,
  selectFunctionCall,
  serverSelector,
  type FunctionSelector,
} from "./functionSelector";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.7 Mobile/15E148 Safari/604.1";
const PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";
const SCREEN = { diagnosisId: "diag-1", uiStage: "result" as const };

// navigator 값은 unstubAllGlobals 로 돌아오지 않으므로 직접 되돌린다
const originals = new Map<string, PropertyDescriptor | undefined>();
function setNavigator(key: string, value: unknown) {
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(navigator, key));
  Object.defineProperty(navigator, key, { configurable: true, value });
}
function device(userAgent: string, touchPoints: number, gpu?: unknown) {
  setNavigator("userAgent", userAgent);
  setNavigator("maxTouchPoints", touchPoints);
  setNavigator("gpu", gpu);
}
function fakeSelector(kind: FunctionSelector["kind"], overrides: Partial<FunctionSelector> = {}): FunctionSelector {
  return { kind, isReady: async () => true, select: vi.fn(async () => ({ function_call: `<hs_1>(${kind})<hs_end>` })), ...overrides };
}

beforeEach(() => {
  resetFunctionSelectors();
  // 서버로 넘어갈 때 남기는 진단 로그는 테스트 출력에서 숨긴다
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  api.selectFunction.mockReset().mockResolvedValue({ function_call: "<hs_0>(topic=1)<hs_end>", context: { ui_stage: "result" } });
  window.history.replaceState(null, "", "/voice-mode");
});
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else delete (navigator as unknown as Record<string, unknown>)[key];
  }
  originals.clear();
});

describe("readSelectorOverride", () => {
  it("remembers a valid ?selector= value, ignores invalid ones and clears on auto", () => {
    expect(readSelectorOverride("")).toBeNull();
    expect(readSelectorOverride("?selector=board_rkllm")).toBe("board_rkllm");
    expect(localStorage.getItem(SELECTOR_OVERRIDE_KEY)).toBe("board_rkllm");
    // 주소에서 빠져도 기억한 값을 쓴다
    expect(readSelectorOverride("")).toBe("board_rkllm");
    expect(readSelectorOverride("?selector=ios_clf")).toBe("board_rkllm");
    expect(readSelectorOverride("?selector=auto")).toBeNull();
    expect(localStorage.getItem(SELECTOR_OVERRIDE_KEY)).toBeNull();
  });

  it("still honours the URL when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readSelectorOverride("?selector=web_qwen")).toBe("web_qwen");
  });
});

describe("preferredSelectorKind", () => {
  it("phones prefer the small classifier without asking for a GPU", async () => {
    const requestAdapter = vi.fn(async () => ({}));
    device(IPHONE, 5, { requestAdapter });
    expect(await preferredSelectorKind()).toBe("mobile_clf");
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it("PCs do not ask for a GPU while no Qwen selector is registered", async () => {
    const requestAdapter = vi.fn(async () => ({}));
    device(PC, 0, { requestAdapter });
    expect(await preferredSelectorKind()).toBe("server");
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it("a GPU that never answers counts as no WebGPU after the timeout", async () => {
    vi.useFakeTimers();
    try {
      device(PC, 0, { requestAdapter: () => new Promise(() => {}) });
      const check = hasWebGpu();
      await vi.advanceTimersByTimeAsync(WEBGPU_TIMEOUT_MS);
      expect(await check).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("PCs prefer Qwen only when a WebGPU adapter is available", async () => {
    registerSelector(fakeSelector("web_qwen"));
    device(PC, 0, { requestAdapter: async () => ({}) });
    expect(await preferredSelectorKind()).toBe("web_qwen");
    for (const gpu of [{ requestAdapter: async () => null }, { requestAdapter: async () => { throw new Error("blocked"); } }, undefined]) {
      resetFunctionSelectors();
      registerSelector(fakeSelector("web_qwen"));
      device(PC, 0, gpu);
      expect(await preferredSelectorKind()).toBe("server");
    }
    resetFunctionSelectors();
    device(PC, 0, undefined);
    expect(await preferredSelectorKind()).toBe("server");
  });

  it("asks the GPU once and the override wins over the device", async () => {
    const requestAdapter = vi.fn(async () => ({}));
    device(PC, 0, { requestAdapter });
    await hasWebGpu();
    await hasWebGpu();
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, "", "/voice-mode?selector=board_rkllm");
    expect(await preferredSelectorKind()).toBe("board_rkllm");
  });
});

describe("resolveSelector", () => {
  beforeEach(() => device(IPHONE, 5));

  it("uses the server when no on-device selector is registered", async () => {
    expect(await resolveSelector()).toBe(serverSelector);
  });

  it("uses a registered selector only when it is ready", async () => {
    const ready = fakeSelector("mobile_clf");
    const unregister = registerSelector(ready);
    expect(await resolveSelector()).toBe(ready);
    unregister();
    registerSelector(fakeSelector("mobile_clf", { isReady: async () => false }));
    expect(await resolveSelector()).toBe(serverSelector);
    registerSelector(fakeSelector("mobile_clf", { isReady: async () => { throw new Error("no model"); } }));
    expect(await resolveSelector()).toBe(serverSelector);
  });

  it("does not use a selector registered for another device", async () => {
    registerSelector(fakeSelector("web_qwen"));
    expect(await resolveSelector()).toBe(serverSelector);
  });
});

describe("selectFunctionCall", () => {
  beforeEach(() => device(IPHONE, 5));

  it("goes through the server with the same arguments when nothing is registered", async () => {
    const signal = new AbortController().signal;
    const result = await selectFunctionCall("이 병 뭐야", SCREEN, signal);
    expect(api.selectFunction).toHaveBeenCalledWith("이 병 뭐야", SCREEN, signal);
    expect(result).toEqual({ function_call: "<hs_0>(topic=1)<hs_end>", context: { ui_stage: "result" }, source: "server" });
  });

  it("reports the on-device selector as the source", async () => {
    const selector = fakeSelector("mobile_clf");
    registerSelector(selector);
    const result = await selectFunctionCall("이 병 뭐야", SCREEN);
    expect(result).toEqual({ function_call: "<hs_1>(mobile_clf)<hs_end>", source: "mobile_clf" });
    expect(api.selectFunction).not.toHaveBeenCalled();
  });

  it("falls back to the server when the on-device selector fails", async () => {
    registerSelector(fakeSelector("mobile_clf", { select: async () => { throw new Error("wasm crashed"); } }));
    const result = await selectFunctionCall("이 병 뭐야", SCREEN);
    expect(result.source).toBe("server");
    expect(api.selectFunction).toHaveBeenCalledTimes(1);
  });

  it("does not retry on the server after the user cancelled", async () => {
    const controller = new AbortController();
    registerSelector(fakeSelector("mobile_clf", { select: async () => { controller.abort(); throw new DOMException("aborted", "AbortError"); } }));
    await expect(selectFunctionCall("이 병 뭐야", SCREEN, controller.signal)).rejects.toThrow("aborted");
    expect(api.selectFunction).not.toHaveBeenCalled();
  });
});
