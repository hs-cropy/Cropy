
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  installFakeSpeech,
  type FakeSpeech,
} from "@/features/voice/testing/fakeSpeech";
import {
  saveVoiceReturn,
} from "./voiceNavigation";
import { VoiceMode } from "./VoiceMode";

const navigation = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: navigation.back,
    replace: navigation.replace,
  }),
}));

let speech: FakeSpeech;

beforeEach(() => {
  speech = installFakeSpeech();
  sessionStorage.clear();
  navigation.back.mockClear();
  navigation.replace.mockClear();
});

function returnButton() {
  return screen.getByRole("button", {
    name: "기본 화면",
  });
}

describe("VoiceMode — 음성 모드 화면", () => {
  it("기본 상태는 V-01 음성 대기 화면이다", () => {
    render(<VoiceMode />);
    expect(
      screen.getByRole("status").textContent,
    ).toContain("음성 대기");
    expect(
      screen.getByRole("heading", {
        name: "무엇이 궁금하세요?",
      }),
    ).toBeTruthy();
    expect(returnButton()).toBeTruthy();
  });

  it.each([
    ["idle", "음성 대기"],
    ["listening", "듣고 있어요"],
    ["thinking", "생각하고 있어요"],
    ["speaking", "말하는 중"],
  ] as const)(
    "%s 상태에서는 %s를 표시한다",
    (state, status) => {
      render(<VoiceMode state={state} />);

      expect(
        screen.getByRole("status").textContent,
      ).toContain(status);
    },
  );

  it("복귀 정보가 있으면 기본 화면 버튼으로 뒤로 간다", () => {
    saveVoiceReturn("/history", 420);
    render(<VoiceMode />);

    fireEvent.click(returnButton());

    expect(navigation.back).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("복귀 정보가 없으면 /home으로 이동한다", () => {
    render(<VoiceMode />);

    fireEvent.click(returnButton());

    expect(navigation.replace).toHaveBeenCalledWith(
      "/home",
    );
    expect(navigation.back).not.toHaveBeenCalled();
  });

  it("기본 화면 버튼을 누르면 재생 중인 음성을 중단한다", () => {
    saveVoiceReturn("/home", 0);
    render(<VoiceMode />);

    speech.cancel.mockClear();

    fireEvent.click(returnButton());

    expect(speech.cancel).toHaveBeenCalled();
  });

  it("화면에서 벗어나면 음성 재생을 중단한다", () => {
    const { unmount } = render(
      <VoiceMode state="speaking" />,
    );

    speech.cancel.mockClear();

    unmount();

    expect(speech.cancel).toHaveBeenCalled();
  });
});
