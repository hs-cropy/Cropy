import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setVoiceEnabled, VOICE_SETTING_KEY } from "../hooks/useVoiceSetting";
import { installFakeSpeech, spokenTexts, type FakeSpeech } from "../testing/fakeSpeech";
import { VoiceToggle } from "./VoiceToggle";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

let synth: FakeSpeech;

beforeEach(() => {
  synth = installFakeSpeech();
  setVoiceEnabled(false);
  localStorage.clear();
  navigation.pathname = "/";
});

function toggleButton() {
  return screen.getByRole("button", { name: /음성/ });
}

describe("VoiceToggle", () => {
  it("기본은 꺼짐이고 스크린리더에 상태를 알려준다", () => {
    render(<VoiceToggle />);

    expect(toggleButton().getAttribute("aria-pressed")).toBe("false");
    expect(toggleButton().textContent).toContain("안내 꺼짐");
  });

  it("켜면 저장하고, 홈에서는 켬 안내에 이어 홈 안내를 읽는다", () => {
    render(<VoiceToggle />);

    fireEvent.click(toggleButton());

    expect(toggleButton().getAttribute("aria-pressed")).toBe("true");
    expect(toggleButton().textContent).toContain("안내 켜짐");
    expect(localStorage.getItem(VOICE_SETTING_KEY)).toBe("on");
    expect(spokenTexts(synth)).toEqual(["음성 안내를 켰어요", "작물을 고르고 잎을 찍어주세요"]);
  });

  it("홈이 아닌 화면에서 켜면 켬 안내만 읽는다", () => {
    navigation.pathname = "/history";
    render(<VoiceToggle />);

    fireEvent.click(toggleButton());

    expect(spokenTexts(synth)).toEqual(["음성 안내를 켰어요"]);
  });

  it("끄면 저장하고 읽던 문장을 끊는다", () => {
    setVoiceEnabled(true);
    render(<VoiceToggle />);

    fireEvent.click(toggleButton());

    expect(toggleButton().getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem(VOICE_SETTING_KEY)).toBe("off");
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("저장된 설정이 켜짐이면 켜진 상태로 보인다", () => {
    setVoiceEnabled(true);
    render(<VoiceToggle />);

    expect(toggleButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("Web Speech를 지원하지 않는 브라우저에서는 버튼을 숨긴다", () => {
    vi.unstubAllGlobals();
    render(<VoiceToggle />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
