import { describe, expect, it } from "vitest";
import { autoSelectorKind, deviceKind } from "./deviceKind";
// 오프라인 화면의 같은 규칙. 두 쪽이 어긋나면 기기마다 받은 묶음과 고르는 선택기가 달라진다
import { deviceKind as offlineDeviceKind, functionBundleKind } from "../../../../public/offline/core.mjs";

const UA = {
  iPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1",
  iPad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  galaxy: "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  galaxyTab: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  pc: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

// [UA, 터치 수, 기기, WebGPU 없을 때, WebGPU 있을 때]
const CASES: [keyof typeof UA, number, string, string, string][] = [
  ["iPhone", 5, "ios", "mobile_clf", "mobile_clf"],
  ["iPad", 5, "ios", "mobile_clf", "mobile_clf"],
  ["galaxy", 5, "android", "mobile_clf", "mobile_clf"],
  ["galaxyTab", 10, "android", "mobile_clf", "mobile_clf"],
  ["pc", 0, "desktop", "server", "web_qwen"],
  ["mac", 0, "desktop", "server", "web_qwen"],
  ["chromebook", 10, "desktop", "server", "web_qwen"],
];

describe("deviceKind", () => {
  it.each(CASES)("%s → 기기 %s", (name, touchPoints, kind, withoutGpu, withGpu) => {
    expect(deviceKind(UA[name], touchPoints)).toBe(kind);
    expect(autoSelectorKind({ userAgent: UA[name], touchPoints, webgpu: false })).toBe(withoutGpu);
    expect(autoSelectorKind({ userAgent: UA[name], touchPoints, webgpu: true })).toBe(withGpu);
  });

  it("matches the offline screen's rules (public/offline/core.mjs)", () => {
    for (const [name, touchPoints] of CASES) {
      const userAgent = UA[name];
      expect(deviceKind(userAgent, touchPoints)).toBe(offlineDeviceKind({ userAgent, touchPoints }));
      for (const webgpu of [false, true]) {
        // 오프라인 화면은 받을 묶음이 없으면 null, 여기서는 server 다
        expect(autoSelectorKind({ userAgent, touchPoints, webgpu })).toBe(functionBundleKind({ userAgent, touchPoints, webgpu }) ?? "server");
      }
    }
  });
});
