
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isVoiceEnabled,
  setVoiceEnabled,
  VOICE_SETTING_KEY,
} from "../hooks/useVoiceSetting";
import {
  installFakeSpeech,
  type FakeSpeech,
} from "../testing/fakeSpeech";
import {
  readVoiceReturn,
  VOICE_RETURN_KEY,
} from "@/components/voice-mode/voiceNavigation";
import { VoiceToggle } from "./VoiceToggle";

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

function voiceSwitch() {
  return screen.getByRole("switch", { name: "음성 모드" });
}

describe("VoiceToggle — 음성 모드 진입", () => {
  it("기본은 OFF이며 음성 모드 스위치로 표시한다", () => {
    render(<VoiceToggle />);

    expect(voiceSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("ON을 누르면 음성 모드로 이동한다", () => {
    render(<VoiceToggle />);

    fireEvent.click(voiceSwitch());

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

    render(<VoiceToggle />);
    fireEvent.click(voiceSwitch());

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

      render(<VoiceToggle />);
      fireEvent.click(voiceSwitch());

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
    render(<VoiceToggle />);

    fireEvent.click(voiceSwitch());

    expect(speech.cancel).toHaveBeenCalledTimes(1);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("배치용 className을 스위치에 전달한다", () => {
    render(<VoiceToggle className="xl:w-[8.25rem]" />);

    expect(
      Array.from(voiceSwitch().classList),
    ).toContain("xl:w-[8.25rem]");
  });
});
