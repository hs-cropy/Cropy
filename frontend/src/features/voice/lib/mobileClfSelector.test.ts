import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleCall, bundleFileUrl, mobileClfSelector, type ClfLabels } from "./mobileClfSelector";

const labels: ClfLabels = {
  functions: ["get_diagnosis", "get_pesticide_information", "chit_chat"],
  heads: [
    { function: "get_diagnosis", argument: "topic", values: ["result", "severity"] },
    { function: "get_pesticide_information", argument: "topic", values: ["list", "dilution", "usage"] },
    { function: "get_pesticide_information", argument: "product", values: ["current", "all"] },
  ],
};

describe("assembleCall", () => {
  it("가장 높은 기능과 그 기능의 인자만 1부터 세어 조립한다", () => {
    const call = assembleCall(labels, {
      fn_logits: [0.1, 2.0, 0.3],
      "get_diagnosis.topic": [5, 0],
      "get_pesticide_information.topic": [0.1, 0.9, 0.2],
      "get_pesticide_information.product": [0, 1],
    });
    expect(call).toBe("<hs_1>(topic=2, product=2)<hs_end>");
  });

  it("인자가 없는 기능은 빈 괄호", () => {
    expect(assembleCall(labels, { fn_logits: [0, 0, 1], "get_diagnosis.topic": [1, 0] })).toBe("<hs_2>()<hs_end>");
  });
});

describe("bundleFileUrl", () => {
  it("오프라인 화면이 캐시에 넣은 키와 같은 주소", () => {
    expect(bundleFileUrl({ version: "v", base_url: "/offline-assets/function/mobile_clf/0123456789abcdef/", files: [] }, "labels.json", "https://a.test"))
      .toBe("https://a.test/offline-assets/function/mobile_clf/0123456789abcdef/labels.json");
  });
});

describe("mobileClfSelector.isReady", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Cache Storage가 없는 환경이면 준비되지 않은 것으로 본다 (서버로 고른다)", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(mobileClfSelector.isReady()).resolves.toBe(false);
  });

  it("묶음을 받지 않았으면(IndexedDB 없음) 준비되지 않은 것으로 본다", async () => {
    vi.stubGlobal("caches", { open: vi.fn() });
    vi.stubGlobal("indexedDB", undefined);
    await expect(mobileClfSelector.isReady()).resolves.toBe(false);
  });
});
