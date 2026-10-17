import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCamera } from "./useCamera";

function fakeStream() {
  const track = { stop: vi.fn(), getSettings: () => ({ facingMode: "environment" }) };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
  };
}

function denied(name: string) {
  return Object.assign(new Error(name), { name });
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  // jsdom 에는 카메라 API 가 없고 보안 컨텍스트도 아니다
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

describe("useCamera", () => {
  it("기본은 마운트하자마자 카메라를 켠다 (풀스크린 오버레이)", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const { result } = renderHook(() => useCamera());

    await act(async () => {});

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("streaming");
  });

  it("autoStart=false 면 start() 를 부르기 전까지 권한을 묻지 않는다", async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useCamera({ autoStart: false }));

    await act(async () => {});
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("streaming");
  });

  it("stop() 은 카메라 트랙을 끄고 idle 로 돌아간다", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useCamera({ autoStart: false }));

    await act(async () => {
      await result.current.start();
    });
    act(() => result.current.stop());

    expect(track.stop).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("화면에서 사라지면 켜 둔 카메라를 끈다", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { result, unmount } = renderHook(() => useCamera({ autoStart: false }));

    await act(async () => {
      await result.current.start();
    });
    unmount();

    expect(track.stop).toHaveBeenCalled();
  });

  it.each([
    ["NotAllowedError", "permission-denied"],
    ["NotFoundError", "no-device"],
    ["NotReadableError", "unknown"],
  ])("%s 로 거절되면 error 를 %s 로 둔다", async (name, code) => {
    getUserMedia.mockRejectedValue(denied(name));
    const { result } = renderHook(() => useCamera({ autoStart: false }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(code);
  });

  it("카메라 API 가 없는 환경이면 묻지 않고 not-supported 로 둔다", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { result } = renderHook(() => useCamera({ autoStart: false }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe("not-supported");
  });
});

describe("useCamera — 백그라운드 전환 (autoStart=false)", () => {
  function setHidden(hidden: boolean) {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  afterEach(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("켜 둔 적이 없으면 돌아와도 켜지 않는다", async () => {
    renderHook(() => useCamera({ autoStart: false }));

    await act(async () => setHidden(true));
    await act(async () => setHidden(false));

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("켜 두었으면 숨겨질 때 끄고 돌아오면 다시 켠다", async () => {
    const first = fakeStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(fakeStream().stream);
    const { result } = renderHook(() => useCamera({ autoStart: false }));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => setHidden(true));
    expect(first.track.stop).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");

    await act(async () => setHidden(false));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("streaming");
  });
});
