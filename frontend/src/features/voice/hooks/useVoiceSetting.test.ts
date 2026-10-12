import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isVoiceEnabled,
  setVoiceEnabled,
  useVoiceSetting,
  VOICE_SETTING_KEY,
} from "./useVoiceSetting";

describe("저장된 설정 읽기", () => {
  // 처음 한 번만 localStorage를 읽으므로 테스트마다 모듈을 새로 불러온다
  beforeEach(() => {
    vi.resetModules();
  });

  async function load() {
    return import("./useVoiceSetting");
  }

  it("저장된 값이 없으면 꺼짐이다", async () => {
    const setting = await load();
    expect(setting.isVoiceEnabled()).toBe(false);
  });

  it('저장된 값이 "on"이면 켜짐으로 시작한다', async () => {
    localStorage.setItem(VOICE_SETTING_KEY, "on");
    const setting = await load();
    expect(setting.isVoiceEnabled()).toBe(true);
  });

  it.each(["off", "true", ""])('저장된 값이 "%s"이면 꺼짐이다', async (stored) => {
    localStorage.setItem(VOICE_SETTING_KEY, stored);
    const setting = await load();
    expect(setting.isVoiceEnabled()).toBe(false);
  });

  it("localStorage를 한 번만 읽는다", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setting = await load();

    setting.isVoiceEnabled();
    setting.isVoiceEnabled();

    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("저장소 접근이 막혀도 오류 없이 꺼짐으로 둔다", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setting = await load();

    expect(setting.isVoiceEnabled()).toBe(false);
  });
});

describe("setVoiceEnabled", () => {
  beforeEach(() => {
    setVoiceEnabled(false);
    localStorage.clear();
  });

  it("상태를 바꾸고 on/off로 저장한다", () => {
    setVoiceEnabled(true);
    expect(isVoiceEnabled()).toBe(true);
    expect(localStorage.getItem(VOICE_SETTING_KEY)).toBe("on");

    setVoiceEnabled(false);
    expect(isVoiceEnabled()).toBe(false);
    expect(localStorage.getItem(VOICE_SETTING_KEY)).toBe("off");
  });

  it("저장이 막혀도 이번 세션 상태는 바뀐다", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => setVoiceEnabled(true)).not.toThrow();
    expect(isVoiceEnabled()).toBe(true);
  });
});

describe("useVoiceSetting", () => {
  beforeEach(() => {
    setVoiceEnabled(false);
  });

  it("다른 곳에서 설정을 바꾸면 다시 렌더된다", () => {
    const { result } = renderHook(() => useVoiceSetting());
    expect(result.current).toBe(false);

    act(() => setVoiceEnabled(true));
    expect(result.current).toBe(true);

    act(() => setVoiceEnabled(false));
    expect(result.current).toBe(false);
  });

  it("여러 컴포넌트가 같은 상태를 본다", () => {
    const first = renderHook(() => useVoiceSetting());
    const second = renderHook(() => useVoiceSetting());

    act(() => setVoiceEnabled(true));

    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
  });

  // 구독 해제(listeners.delete) 누락은 React가 언마운트된 컴포넌트 알림을 무시해
  // 겉으로 드러나지 않는다. 여기서는 언마운트 후 렌더·오류가 없는 것만 확인한다
  it("언마운트한 뒤 설정이 바뀌어도 다시 렌더되지 않는다", () => {
    const renders = vi.fn();
    const { unmount } = renderHook(() => {
      renders();
      return useVoiceSetting();
    });
    unmount();
    const before = renders.mock.calls.length;

    act(() => setVoiceEnabled(true));

    expect(renders).toHaveBeenCalledTimes(before);
  });
});
