import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isVoiceEnabled,
  setVoiceEnabled,
  VOICE_SETTING_KEY,
} from "../../features/voice/hooks/useVoiceSetting";
import {
  installFakeSpeech,
  type FakeSpeech,
} from "../../features/voice/testing/fakeSpeech";
import {
  readVoiceReturn,
  VOICE_RETURN_KEY,
} from "@/components/voice-mode/voiceNavigation";
import { VoiceModeEntry } from "@/components/voice-mode/VoiceModeEntry";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigation.push,
  }),
}));

let speech: FakeSpeech;

beforeEach(() => {
  speech = installFakeSpeech();

  setVoiceEnabled(false);
  localStorage.clear();
  sessionStorage.clear();

  navigation.push.mockClear();

  window.history.replaceState({}, "", "/home");
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: 0,
  });
});

function voiceButton() {
  return screen.getByRole("button", { name: "음성 대화" });
}

describe("VoiceModeEntry — 음성 모드 진입", () => {
  it("음성 모드 진입 요소는 버튼이다", () => {
    render(<VoiceModeEntry />);

    expect(voiceButton()).toBeTruthy();
    expect(
      screen.queryByRole("switch", { name: "음성 모드" }),
    ).toBeNull();
  });

  it("버튼을 누르면 음성 모드로 이동한다", () => {
    render(<VoiceModeEntry />);

    fireEvent.click(voiceButton());

    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
      "/voice-mode",
    );
  });

  it("진입 직전 경로와 스크롤 위치를 저장한다", () => {
    window.history.replaceState(
      {},
      "",
      "/history?page=2",
    );

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 420,
    });

    render(<VoiceModeEntry />);
    fireEvent.click(voiceButton());

    expect(readVoiceReturn()).toEqual({
      path: "/history?page=2",
      scrollY: 420,
    });

    expect(sessionStorage.getItem(VOICE_RETURN_KEY)).not.toBeNull();
  });

  it.each([false, true])(
    "기존 TTS 설정이 %s여도 진입 시 설정값을 유지한다",
    (enabled) => {
      setVoiceEnabled(enabled);

      render(<VoiceModeEntry />);
      fireEvent.click(voiceButton());

      expect(isVoiceEnabled()).toBe(enabled);
      expect(localStorage.getItem(VOICE_SETTING_KEY)).toBe(
        enabled ? "on" : "off",
      );
      expect(navigation.push).toHaveBeenCalledWith(
        "/voice-mode",
      );
    },
  );

  it("진입할 때 기존 TTS 재생을 중단한다", () => {
    render(<VoiceModeEntry />);

    fireEvent.click(voiceButton());

    expect(speech.cancel).toHaveBeenCalledTimes(1);
    expect(speech.speak).not.toHaveBeenCalled();
  });
  it("모바일에서는 아이콘 버튼, 데스크톱에서는 텍스트를 함께 표시한다", () => {
    render(<VoiceModeEntry />);

    const button = voiceButton();

    expect(button.classList.contains("min-h-cropy-control-md")).toBe(true);
    expect(button.classList.contains("min-w-11")).toBe(true);

    const label = screen.getByText("음성 대화");
    expect(label.classList.contains("hidden")).toBe(true);
    expect(label.classList.contains("lg:inline")).toBe(true);

    expect(button.getAttribute("aria-label")).toBe("음성 대화");
  });

  it("sessionStorage 저장이 실패해도 음성 모드로 이동한다", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage blocked");
      });

    try {
      render(<VoiceModeEntry />);
      fireEvent.click(voiceButton());

      expect(navigation.push).toHaveBeenCalledWith("/voice-mode");
    } finally {
      spy.mockRestore();
    }
  });
});