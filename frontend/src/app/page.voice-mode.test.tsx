
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VoiceModePage from "./voice-mode/page";

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  cancel: vi.fn(),
  handleMicClick: vi.fn(),
  clearError: vi.fn(),
  cancelSpeech: vi.fn(),
  previous: null as { path: string; scrollY: number } | null,
  conversation: {
    state: "idle" as "idle" | "listening" | "thinking" | "speaking",
    inputLevel: 0,
    error: null as string | null,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: mocks.back,
    replace: mocks.replace,
  }),
}));

vi.mock("@/features/voice/hooks/useVoiceConversation", () => ({
  useVoiceConversation: () => ({
    ...mocks.conversation,
    handleMicClick: mocks.handleMicClick,
    cancel: mocks.cancel,
    clearError: mocks.clearError,
    audio: null,
  }),
}));

vi.mock("@/features/voice/lib/speech", () => ({
  cancelSpeech: mocks.cancelSpeech,
}));

vi.mock("@/components/voice-mode/voiceNavigation", () => ({
  readVoiceReturn: () => mocks.previous,
}));

beforeEach(() => {
  vi.clearAllMocks();

  mocks.previous = null;
  mocks.conversation.state = "idle";
  mocks.conversation.inputLevel = 0;
  mocks.conversation.error = null;
});

describe("VoiceModePage — 음성 모드 페이지 연결", () => {
  it("초기에는 V-01 대기 화면을 표시한다", () => {
    render(<VoiceModePage />);

    expect(screen.getByText(/음성 대기/)).toBeTruthy();

    expect(
        (screen.getByRole("button", {
            name: "음성 입력 시작",
        }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("마이크 버튼을 누르면 Hook의 입력 동작을 호출한다", () => {
    render(<VoiceModePage />);

    fireEvent.click(
      screen.getByRole("button", { name: "음성 입력 시작" }),
    );

    expect(mocks.handleMicClick).toHaveBeenCalledTimes(1);
  });

  it("듣는 중에도 마이크 버튼으로 녹음을 종료할 수 있다", () => {
    mocks.conversation.state = "listening";
    mocks.conversation.inputLevel = 0.4;

    render(<VoiceModePage />);

    expect(screen.getByText(/듣고 있어요/)).toBeTruthy();

    const button = screen.getByRole("button", {
      name: "음성 입력 종료",
    });

    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);

    expect(mocks.handleMicClick).toHaveBeenCalledTimes(1);
  });

  it("녹음 오류가 발생하면 기존 토스트를 표시한다", async () => {
    mocks.conversation.error = "음성 안내를 시작하지 못했어요";

    render(<VoiceModePage />);

    expect(
      await screen.findByText("음성 안내를 시작하지 못했어요"),
    ).toBeTruthy();

    expect(mocks.clearError).toHaveBeenCalledTimes(1);
  });

  it("무음 시간 초과 오류도 기존 토스트로 표시한다", async () => {
    mocks.conversation.error =
      "말씀을 듣지 못했어요. 다시 시도해 주세요.";

    render(<VoiceModePage />);

    expect(
      await screen.findByText(
        "말씀을 듣지 못했어요. 다시 시도해 주세요.",
      ),
    ).toBeTruthy();

    expect(mocks.clearError).toHaveBeenCalledTimes(1);
  });

  it("이전 화면 정보 없이 복귀하면 녹음을 취소하고 홈으로 이동한다", () => {
    render(<VoiceModePage />);

    fireEvent.click(
      screen.getByRole("button", { name: "기본 화면" }),
    );

    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.cancelSpeech).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/home");
    expect(mocks.back).not.toHaveBeenCalled();
    expect(
      mocks.cancel.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.replace.mock.invocationCallOrder[0],
    );
  });

  it("이전 화면 정보가 있으면 녹음을 취소하고 뒤로 이동한다", () => {
    mocks.previous = {
      path: "/history",
      scrollY: 420,
    };
    mocks.conversation.state = "listening";

    render(<VoiceModePage />);

    fireEvent.click(
      screen.getByRole("button", { name: "기본 화면" }),
    );

    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.back).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(
      mocks.cancel.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.back.mock.invocationCallOrder[0],
    );
  });

  it("오류가 없을 때는 오류 토스트를 표시하지 않는다", async () => {
    render(<VoiceModePage />);

    await waitFor(() => {
      expect(mocks.clearError).not.toHaveBeenCalled();
    });

    expect(
      screen.queryByText("음성 안내를 시작하지 못했어요"),
    ).toBeNull();
  });
});
