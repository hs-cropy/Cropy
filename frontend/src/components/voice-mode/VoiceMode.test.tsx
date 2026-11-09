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
  it("음성 모드 헤더에는 일반 메뉴를 표시하지 않는다", () => {
    render(<VoiceMode />);

    expect(returnButton()).toBeTruthy();

    expect(
      screen.queryByRole("navigation", {
        name: "주요 메뉴",
      }),
    ).toBeNull();
  });
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
  
  it("thinking에서는 인식된 사용자 문장을 표시한다", () => {
    render(
      <VoiceMode
        state="thinking"
        transcript="고추 잎에 갈색 점이 생겼어"
      />,
    );

    expect(
      screen.getByText("고추 잎에 갈색 점이 생겼어"),
    ).toBeTruthy();

    expect(screen.getByText("내 말")).toBeTruthy();
  });

  it("speaking에서는 크로피 답변과 스피커 아이콘을 표시한다", () => {
    render(
      <VoiceMode
        state="speaking"
        transcript="고추 잎에 갈색 점이 생겼어"
        assistantText="사진으로 확인해 볼게요."
      />,
    );

    expect(screen.getByText("사진으로 확인해 볼게요.")).toBeTruthy();
    expect(screen.getByText("크로피")).toBeTruthy();
    expect(
      screen.getByTestId("assistant-speaker-icon"),
    ).toBeTruthy();

    expect(
      screen.queryByText("고추 잎에 갈색 점이 생겼어"),
    ).toBeNull();
    expect(screen.queryByText("내 말")).toBeNull();
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

  it("speaking에서 사진 찍기 버튼을 누르면 촬영 동작을 호출한다", () => {
    const onPhotoClick = vi.fn();

    render(
      <VoiceMode
        state="speaking"
        assistantText="사진으로 확인해 주세요."
        onPhotoClick={onPhotoClick}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "사진 찍어 확인하기",
      }),
    );

    expect(onPhotoClick).toHaveBeenCalledTimes(1);
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
