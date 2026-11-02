import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineFallback } from "./OfflineFallback";

function mockServiceWorker() {
  const register = vi.fn().mockResolvedValue({});
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  return register;
}

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("OfflineFallback", () => {
  it("운영 빌드에서 전체 범위의 오프라인 안내 서비스 워커를 등록한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = mockServiceWorker();

    render(<OfflineFallback />);

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("개발 중에는 등록하지 않는다", () => {
    vi.stubEnv("NODE_ENV", "development");
    const register = mockServiceWorker();

    render(<OfflineFallback />);

    expect(register).not.toHaveBeenCalled();
  });
});
