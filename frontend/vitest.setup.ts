import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// globals를 끄면 Testing Library가 렌더 정리를 자동 등록하지 못해 직접 건다
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
