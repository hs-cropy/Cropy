import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineFallback } from "./OfflineFallback";

function mockServiceWorker(registrations: { scope: string; unregister: () => Promise<boolean> }[] = []) {
  const register = vi.fn().mockResolvedValue({});
  const getRegistrations = vi.fn().mockResolvedValue(registrations);
  Object.defineProperty(navigator, "serviceWorker", { value: { register, getRegistrations }, configurable: true });
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

  it("개발 중에는 남아 있는 전체 범위 워커만 해제한다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const root = { scope: `${location.origin}/`, unregister: vi.fn().mockResolvedValue(true) };
    const offline = { scope: `${location.origin}/offline/`, unregister: vi.fn().mockResolvedValue(true) };
    mockServiceWorker([root, offline]);

    render(<OfflineFallback />);

    await waitFor(() => expect(root.unregister).toHaveBeenCalled());
    expect(offline.unregister).not.toHaveBeenCalled();
  });
});
