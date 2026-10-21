import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { analyzingHold } from "@/components/diagnosis/analyzingHold";

// 분석 중 화면을 3초 붙잡는 기다림은 그것을 확인하는 테스트에서만 켠다
beforeEach(() => {
  analyzingHold.minMs = 0;
});

// globals를 끄면 Testing Library가 렌더 정리를 자동 등록하지 못해 직접 건다
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
