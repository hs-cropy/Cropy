
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

  it("thinking에서는 분석 포즈와 두 위치의 점 3개를 표시한다", () => {
    render(<VoiceMode state="thinking" micDisabled />);

    expect(
      screen.getByRole("img", { name: "생각하는 크로피" }),
    ).toBeTruthy();

    expect(
      screen.getByText(/생각하고 있어요/),
    ).toBeTruthy();

    const mascotDots = screen
      .getByTestId("mascot-thinking-dots")
      .querySelectorAll("span");

    const micDots = screen
      .getByTestId("mic-thinking-dots")
      .querySelectorAll("span");

    expect(mascotDots).toHaveLength(3);
    expect(micDots).toHaveLength(3);

    for (const dots of [mascotDots, micDots]) {
      Array.from(dots).forEach((dot, index) => {
        expect((dot as HTMLElement).style.animationDelay).toBe(
          `${index * 200}ms`,
        );
      });
    }
  });

  it("thinking에서는 마이크 버튼을 비활성화한다", () => {
    render(<VoiceMode state="thinking" micDisabled />);

    const button = screen.getByRole("button", {
      name: "답변 준비 중",
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it("speaking에서는 말하는 중 상태와 재생 중지 버튼을 표시한다", () => {
    render(<VoiceMode state="speaking" />);

    expect(
      screen.getByText(/말하는 중/),
    ).toBeTruthy();

    expect(
      screen.getByRole("button", {
        name: "음성 재생 중지",
      }),
    ).toBeTruthy();

    expect(
      screen.getByText("누르면 멈추고 말할 수 있어요"),
    ).toBeTruthy();
  });

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
