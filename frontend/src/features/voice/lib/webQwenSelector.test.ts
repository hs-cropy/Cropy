import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPrompt, cleanOutput, webQwenSelector } from "./webQwenSelector";
// eval/models/merged_hf 토크나이저의 apply_chat_template(enable_thinking=False)로 만든 기대값 (시스템 프롬프트 뒤 부분)
import cases from "./__fixtures__/qwen_prompt_cases.json";

describe("buildPrompt", () => {
  it.each(cases)("Python chat template과 같은 문자열: $utterance", ({ utterance, context, expected_suffix }) => {
    const system = "SYSTEM";
    expect(buildPrompt(system, utterance, context)).toBe("<|im_start|>system\n" + system + expected_suffix);
  });
});

describe("cleanOutput", () => {
  it("끝 토큰과 공백을 걷어 낸다", () => {
    expect(cleanOutput("<hs_4>(topic=1, product=2)<hs_end><|im_end|>\n")).toBe("<hs_4>(topic=1, product=2)<hs_end>");
  });
});

describe("webQwenSelector.isReady", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("WebGPU가 없으면 쓰지 않는다 (서버로 고른다)", async () => {
    vi.stubGlobal("caches", { open: vi.fn() });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" });
    await expect(webQwenSelector.isReady()).resolves.toBe(false);
  });

  it("Cache Storage가 없으면 쓰지 않는다", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(webQwenSelector.isReady()).resolves.toBe(false);
  });
});
