import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { analyzingHold } from "@/components/diagnosis/analyzingHold";
import { clearHistoryCache } from "@/lib/historyCache";

// 분석 중 화면을 3초 붙잡는 기다림은 그것을 확인하는 테스트에서만 켠다.
// 이력 캐시는 모듈 메모리라 앞 테스트의 기록이 새지 않게 비운다
beforeEach(() => {
  analyzingHold.minMs = 0;
  clearHistoryCache();
});

// globals를 끄면 Testing Library가 렌더 정리를 자동 등록하지 못해 직접 건다
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // node 환경 테스트(// @vitest-environment node)에는 localStorage가 없다
  if (typeof localStorage !== "undefined") localStorage.clear();
});
