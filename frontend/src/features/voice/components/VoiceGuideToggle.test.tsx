import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setVoiceEnabled, VOICE_SETTING_KEY } from "../hooks/useVoiceSetting";
import { installFakeSpeech, spokenTexts, type FakeSpeech } from "../testing/fakeSpeech";
import { VoiceGuideToggle } from "./VoiceGuideToggle";

const navigation = vi.hoisted(() => ({ pathname: "/home" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

let synth: FakeSpeech;

beforeEach(() => {
  synth = installFakeSpeech();
  setVoiceEnabled(false);
  localStorage.clear();
  navigation.pathname = "/home";
});

function toggleButton() {
  return screen.getByRole("switch", { name: "음성 안내" });
}

describe("VoiceToggle", () => {
  it('기본은 꺼짐이다. 이름은 "음성 안내"로 고정하고 상태는 aria-checked 로 알린다', () => {
    render(<VoiceGuideToggle />);

    expect(toggleButton().getAttribute("aria-checked")).toBe("false");
    // 좁은 화면에서는 "음성", md 부터 "음성 안내"로 보인다
    expect(Array.from(screen.getByText("음성").classList)).toContain("md:hidden");
    expect(Array.from(screen.getByText("음성 안내").classList)).toEqual(
      expect.arrayContaining(["hidden", "md:inline"]),
    );
  });

  it("켜면 저장하고, 홈에서는 켬 안내에 이어 홈 안내를 읽는다", () => {
    render(<VoiceGuideToggle />);

    fireEvent.click(toggleButton());

    expect(toggleButton().getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(VOICE_SETTING_KEY)).toBe("on");
    expect(spokenTexts(synth)).toEqual(["음성 안내를 켰어요", "작물을 고르고 잎을 찍어주세요"]);
  });

  it("홈이 아닌 화면에서 켜면 켬 안내만 읽는다", () => {
    navigation.pathname = "/history";
    render(<VoiceGuideToggle />);

    fireEvent.click(toggleButton());

    expect(spokenTexts(synth)).toEqual(["음성 안내를 켰어요"]);
  });

  it("끄면 저장하고 읽던 문장을 끊는다", () => {
    setVoiceEnabled(true);
    render(<VoiceGuideToggle />);

    fireEvent.click(toggleButton());

    expect(toggleButton().getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem(VOICE_SETTING_KEY)).toBe("off");
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("저장된 설정이 켜짐이면 켜진 상태로 보인다", () => {
    setVoiceEnabled(true);
    render(<VoiceGuideToggle />);

    expect(toggleButton().getAttribute("aria-checked")).toBe("true");
  });

  it("Web Speech 미지원 브라우저에서도 스위치를 표시하고 비활성화한다", () => {
    vi.unstubAllGlobals();
    render(<VoiceGuideToggle />);

    const toggle = toggleButton();

    // 미지원 환경에서도 스위치가 DOM에 존재한다.
    expect(toggle).not.toBeNull();
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.getAttribute("aria-describedby")).toBe(
      "voice-guide-unsupported",
    );

    // 미지원 사유를 스크린리더에 제공한다.
    expect(
      screen.getByText("이 브라우저에서는 음성 안내를 지원하지 않아요."),
    ).toBeTruthy();

    // 비활성화된 스위치를 눌러도 저장 상태가 바뀌지 않는다.
    fireEvent.click(toggle);

    expect(localStorage.getItem(VOICE_SETTING_KEY)).toBeNull();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("배치용 className 을 스위치에 전달한다", () => {
    render(<VoiceGuideToggle className="xl:w-[8.25rem]" />);

    expect(Array.from(toggleButton().classList)).toContain("xl:w-[8.25rem]");
  });
});
