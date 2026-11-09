import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceConversation } from "./useVoiceConversation";

const recorderMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  onLevel: null as ((level: number) => void) | null,
}));

vi.mock("@/features/voice/lib/voiceRecorder", () => ({
  startVoiceRecording: recorderMock.start,
}));

describe("useVoiceConversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    recorderMock.onLevel = null;

    recorderMock.stop.mockResolvedValue(
      new Blob(["recorded audio"], { type: "audio/webm" }),
    );

    recorderMock.start.mockImplementation(
      async (options: { onLevel?: (level: number) => void }) => {
        recorderMock.onLevel = options.onLevel ?? null;

        return {
          stop: recorderMock.stop,
          cancel: recorderMock.cancel,
        };
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("초기 상태는 idle이다", () => {
    const { result } = renderHook(() => useVoiceConversation());

    expect(result.current.state).toBe("idle");
    expect(result.current.inputLevel).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("마이크를 누르면 녹음을 시작하고 listening으로 전환한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    expect(recorderMock.start).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("listening");
  });

  it("입력 음량을 UI에 전달한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      recorderMock.onLevel?.(0.45);
    });

    expect(result.current.inputLevel).toBe(0.45);
  });

  it("발화 이후 1.8초간 무음이면 자동 종료한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    // 최소 발화 시간 300ms 충족
    act(() => {
      recorderMock.onLevel?.(0.5);
      vi.advanceTimersByTime(400);
      recorderMock.onLevel?.(0.5);
      recorderMock.onLevel?.(0);
    });

    // 마지막 발화 감지 이후 1.8초 이상 경과
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });

    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("idle");
    expect(result.current.audio?.size).toBeGreaterThan(0);
    expect(result.current.error).toBeNull();
  });

  it("8초 동안 발화가 없으면 취소하고 오류를 설정한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });

    expect(recorderMock.cancel).toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe(
      "말씀을 듣지 못했어요. 다시 시도해 주세요.",
    );
  });

  it("사용자가 취소하면 녹음과 음량 상태를 초기화한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      recorderMock.onLevel?.(0.7);
      result.current.cancel();
    });

    expect(recorderMock.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("idle");
    expect(result.current.inputLevel).toBe(0);
    expect(result.current.audio).toBeNull();
  });

  it("마이크 권한 요청에 실패하면 idle로 돌아가고 오류를 설정한다", async () => {
    recorderMock.start.mockRejectedValueOnce(
      new Error("Permission denied"),
    );

    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe(
      "음성 안내를 시작하지 못했어요",
    );
  });

  it("화면을 벗어나면 녹음을 취소한다", async () => {
    const { result, unmount } = renderHook(
      () => useVoiceConversation(),
    );

    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(recorderMock.cancel).toHaveBeenCalledTimes(1);
  });
});