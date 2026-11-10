import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceConversation } from "./useVoiceConversation";
import { VoicePermissionError } from "@/features/voice/lib/voiceRecorder";

const recorderMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  onLevel: null as ((level: number) => void) | null,
  onAnalysisUnavailable: null as (() => void) | null,
}));

vi.mock("@/features/voice/lib/voiceRecorder", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/voice/lib/voiceRecorder")>();

  return {
    ...actual,
    startVoiceRecording: recorderMock.start,
  };
});

describe("useVoiceConversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    recorderMock.onLevel = null;
    recorderMock.onAnalysisUnavailable = null;

    recorderMock.stop.mockResolvedValue(new Blob(["recorded audio"], { type: "audio/webm" }));

    recorderMock.start.mockImplementation(
      async (options: {
        onLevel?: (level: number) => void;
        onAnalysisUnavailable?: () => void;
      }) => {
        recorderMock.onLevel = options.onLevel ?? null;
        recorderMock.onAnalysisUnavailable = options.onAnalysisUnavailable ?? null;

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

  it("마이크 권한이 거부되면 브라우저 설정 안내를 표시한다", async () => {
    recorderMock.start.mockRejectedValueOnce(
        new VoicePermissionError(),
    );

    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
        await result.current.start();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toContain("마이크 사용을 허용");
    expect(result.current.audio).toBeNull();
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

    // 최소 발화 시간 150ms 충족
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
    expect(result.current.audio).toBeNull();
    expect(result.current.error).toBe(
    "음성 분석 기능을 준비하고 있어요.",
    );
    expect(result.current.inputLevel).toBe(0);
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
    expect(result.current.error).toBe("말씀을 듣지 못했어요. 다시 시도해 주세요.");
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
    recorderMock.start.mockRejectedValueOnce(new Error("Permission denied"));

    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe("음성 안내를 시작하지 못했어요");
  });

  it("화면을 벗어나면 녹음을 취소한다", async () => {
    const { result, unmount } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(recorderMock.cancel).toHaveBeenCalledTimes(1);
  });

  it("권한 요청 중 화면을 벗어나면 뒤늦게 획득한 마이크를 취소한다", async () => {
    let resolveRecording!: (recording: {
      stop: typeof recorderMock.stop;
      cancel: typeof recorderMock.cancel;
    }) => void;

    recorderMock.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecording = resolve;
        }),
    );

    const { result, unmount } = renderHook(() => useVoiceConversation());

    let startPromise!: Promise<void>;

    act(() => {
      startPromise = result.current.start();
    });

    unmount();

    await act(async () => {
      resolveRecording({
        stop: recorderMock.stop,
        cancel: recorderMock.cancel,
      });

      await startPromise;
    });

    expect(recorderMock.cancel).toHaveBeenCalledTimes(1);
    expect(recorderMock.stop).not.toHaveBeenCalled();
  });
  //최대 30초 녹음 제한 -> 마지막 발화 이후 무음이 길어지지 않도록 주기적으로 onLevel 호출
  it("발화가 계속 감지되어도 30초가 지나면 녹음을 종료한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    // 1초 간격으로 계속 발화가 감지되는 상황
    for (let i = 0; i < 30; i++) {
      await act(async () => {
        recorderMock.onLevel?.(0.5);
        await vi.advanceTimersByTimeAsync(1000);
      });
    }

    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.error).toBe(
        "음성 분석 기능을 준비하고 있어요.",
    );
  });

  //VAD 최소 발화 조건
  it("150ms 미만의 짧은 소음은 발화로 인정하지 않는다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      recorderMock.onLevel?.(0.5);
      vi.advanceTimersByTime(100);
      recorderMock.onLevel?.(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });

    expect(recorderMock.stop).not.toHaveBeenCalled();
    expect(recorderMock.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("말씀을 듣지 못했어요. 다시 시도해 주세요.");
  });
  it("200ms의 짧은 발화도 감지하고 무음 후 자동 종료한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
        await result.current.start();
    });

    // 짧은 발화 시작
    act(() => {
        recorderMock.onLevel?.(0.5);
        vi.advanceTimersByTime(200);
        recorderMock.onLevel?.(0.5);
        recorderMock.onLevel?.(0);
    });

    // 발화 이후 1.8초 이상 무음
    await act(async () => {
        await vi.advanceTimersByTimeAsync(1900);
    });

    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    expect(recorderMock.cancel).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.error).toBe(
        "음성 분석 기능을 준비하고 있어요.",
    );
  });
  it("녹음 종료 중 취소하면 늦게 반환된 결과를 무시한다", async () => {
    let resolveStop!: (audio: Blob) => void;

    recorderMock.stop.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          resolveStop = resolve;
        }),
    );

    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    let stopPromise!: Promise<void>;

    act(() => {
      stopPromise = result.current.stop();
    });

    act(() => {
      result.current.cancel();
    });

    await act(async () => {
      resolveStop(new Blob(["late audio"], { type: "audio/webm" }));
      await stopPromise;
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("수동 녹음 종료 후  API 미연동 안내와 함께 idle로 복귀한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.inputLevel).toBe(0);
    expect(result.current.error).toBe(
        "음성 분석 기능을 준비하고 있어요.",
    );
  });

  it("빈 녹음 결과는 분석하지 않고 오류 안내 후 idle로 복귀한다", async () => {
    recorderMock.stop.mockResolvedValueOnce(new Blob([], { type: "audio/webm" }));

    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.error).not.toBeNull();
  });

  it("음량 분석 실패 시 수동 종료 안내 상태로 전환한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      recorderMock.onAnalysisUnavailable?.();
    });

    expect(result.current.state).toBe("listening");
    expect(result.current.analysisAvailable).toBe(false);
    expect(result.current.inputLevel).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("음량 분석 불가 시 8초가 지나도 녹음을 취소하지 않는다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      recorderMock.onAnalysisUnavailable?.();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });

    expect(result.current.state).toBe("listening");
    expect(result.current.analysisAvailable).toBe(false);
    expect(result.current.error).toBeNull();
    expect(recorderMock.cancel).not.toHaveBeenCalled();
    expect(recorderMock.stop).not.toHaveBeenCalled();
  });

  it("음량 분석 불가 시 마이크 버튼으로 수동 종료할 수 있다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      recorderMock.onAnalysisUnavailable?.();
    });

    await act(async () => {
      result.current.handleMicClick();
      await Promise.resolve();
    });

    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.error).toBe(
        "음성 분석 기능을 준비하고 있어요.",
    );
    expect(result.current.inputLevel).toBe(0);
  });

  it("음량 분석 불가 시 30초가 지나면 자동 종료한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      recorderMock.onAnalysisUnavailable?.();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30100);
    });

    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.error).toBe(
        "음성 분석 기능을 준비하고 있어요.",
    );
    expect(result.current.inputLevel).toBe(0);
  });

  it("새 녹음을 시작하면 이전 분석 실패 상태를 초기화한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      recorderMock.onAnalysisUnavailable?.();
    });

    expect(result.current.analysisAvailable).toBe(false);

    act(() => {
      result.current.cancel();
    });

    expect(result.current.analysisAvailable).toBe(true);

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("listening");
    expect(result.current.analysisAvailable).toBe(true);
  });

  it("녹음 종료 후 대기 상태에서 다시 녹음을 시작할 수 있다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
        await result.current.start();
    });

    expect(result.current.state).toBe("listening");

    await act(async () => {
        await result.current.stop();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe(
        "음성 분석 기능을 준비하고 있어요.",
    );

    await act(async () => {
        await result.current.start();
    });

    expect(result.current.state).toBe("listening");
    expect(result.current.error).toBeNull();
    expect(recorderMock.start).toHaveBeenCalledTimes(2);
    });
});
