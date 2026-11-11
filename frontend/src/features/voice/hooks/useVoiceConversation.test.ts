import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceConversation } from "./useVoiceConversation";
import { VoicePermissionError } from "@/features/voice/lib/voiceRecorder";
import type { UiStage } from "@/features/voice/lib/voiceApi";

const fakeStream = { active: true, getTracks: () => [{ stop: () => {} }] } as unknown as MediaStream;

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

// 녹음 뒤의 세 단계(받아 적기 → 기능 고르기 → 답변)와 wav 변환·낭독·화면 상태는 모두 가짜로 둔다
const pipeline = vi.hoisted(() => ({
  recordingToWav: vi.fn(),
  transcribe: vi.fn(),
  selectFunction: vi.fn(),
  answerFunction: vi.fn(),
  speakAndWait: vi.fn(),
  cancelSpeech: vi.fn(),
  fetchSpeechScript: vi.fn(),
  diagnoseImage: vi.fn(),
  screen: { diagnosisId: "diag-1" as string | null, uiStage: "result" as UiStage, path: "/history/diag-1" as string | null },
}));

vi.mock("@/features/voice/lib/wav", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/voice/lib/wav")>();
  return { ...actual, recordingToWav: pipeline.recordingToWav };
});

vi.mock("@/features/voice/lib/voiceApi", () => ({
  transcribe: pipeline.transcribe,
  selectFunction: pipeline.selectFunction,
  answerFunction: pipeline.answerFunction,
  fetchSpeechScript: pipeline.fetchSpeechScript,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, diagnoseImage: pipeline.diagnoseImage };
});

vi.mock("@/features/voice/lib/speech", () => ({
  speakAndWait: pipeline.speakAndWait,
  cancelSpeech: pipeline.cancelSpeech,
}));

vi.mock("@/features/voice/lib/voiceScreen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/voice/lib/voiceScreen")>();
  return { ...actual, readVoiceScreen: () => pipeline.screen };
});

vi.mock("@/features/voice/lib/listenCue", () => ({
  playListenCue: vi.fn(),
}));

function resetPipeline() {
  pipeline.recordingToWav.mockReset().mockResolvedValue(new Blob(["wav"], { type: "audio/wav" }));
  pipeline.transcribe.mockReset().mockResolvedValue("이 병 뭐야");
  pipeline.selectFunction.mockReset().mockResolvedValue({ function_call: "<hs_0>(topic=1)<hs_end>", context: { ui_stage: "result" } });
  pipeline.answerFunction.mockReset().mockResolvedValue({ function_name: "get_diagnosis", status: "ok", text: "현재 진단은 고추 탄저병입니다." });
  pipeline.speakAndWait.mockReset().mockResolvedValue(undefined);
  pipeline.cancelSpeech.mockReset();
  pipeline.fetchSpeechScript.mockReset().mockResolvedValue(["고추 탄저병으로 분류됐어요.", "병든 잎을 떼어 내세요."]);
  pipeline.diagnoseImage.mockReset().mockResolvedValue({ id: "new-diag", disease_name: "고추 탄저병", recapture: null });
  pipeline.screen = { diagnosisId: "diag-1", uiStage: "result", path: "/history/diag-1" };
}

describe("useVoiceConversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetPipeline();
    localStorage.clear();
    // 호출어 듣기는 대기 중에 녹음을 시작해 recorder.start 횟수를 바꾸므로, 호출어 테스트에서만 켠다
    localStorage.setItem("cropy:voice-wake", "off");

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
          stream: fakeStream,
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
    // 받아 적기 → 답변 → 낭독(가짜는 즉시 끝남) 뒤 대기로 돌아온다
    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.assistantText).toBe("현재 진단은 고추 탄저병입니다.");
    expect(result.current.inputLevel).toBe(0);
  });

  it("8초 동안 발화가 없으면 취소하고 오류를 설정한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    act(() => { result.current.setContinuous(false); }); // 연속 대화는 첫 무발화를 조용히 다시 듣는다 (별도 테스트)

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
    expect(result.current.error).toBeNull();
    expect(pipeline.transcribe).toHaveBeenCalledTimes(1);
  });

  //VAD 최소 발화 조건
  it("150ms 미만의 짧은 소음은 발화로 인정하지 않는다", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    act(() => { result.current.setContinuous(false); });

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
    expect(result.current.error).toBeNull();
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

  it("수동 녹음 종료 후 받아 적기 → 기능 고르기 → 답변 → 낭독 순으로 호출한다", async () => {
    const { result } = renderHook(() => useVoiceConversation());

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    expect(pipeline.recordingToWav).toHaveBeenCalledTimes(1);
    expect(pipeline.transcribe).toHaveBeenCalledTimes(1);
    expect(pipeline.selectFunction).toHaveBeenCalledWith("이 병 뭐야", pipeline.screen, expect.any(AbortSignal));
    expect(pipeline.answerFunction).toHaveBeenCalledWith("diag-1", "<hs_0>(topic=1)<hs_end>", "server", expect.any(AbortSignal));
    expect(pipeline.speakAndWait).toHaveBeenCalledWith("현재 진단은 고추 탄저병입니다.", expect.any(Symbol));
    const order = [pipeline.transcribe, pipeline.selectFunction, pipeline.answerFunction, pipeline.speakAndWait]
      .map((fn) => fn.mock.invocationCallOrder[0]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    expect(result.current.transcript).toBe("이 병 뭐야");
    expect(result.current.assistantText).toBe("현재 진단은 고추 탄저병입니다.");
    expect(result.current.state).toBe("idle");
    expect(result.current.audio).toBeNull();
    expect(result.current.inputLevel).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("답변을 읽는 동안은 speaking이고, 다 읽으면 idle로 돌아온다", async () => {
    let finishSpeaking!: () => void;
    pipeline.speakAndWait.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSpeaking = resolve; }));

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });

    let stopPromise!: Promise<void>;
    await act(async () => {
      stopPromise = result.current.stop();
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(result.current.state).toBe("speaking");
    expect(result.current.assistantText).toBe("현재 진단은 고추 탄저병입니다.");

    await act(async () => { finishSpeaking(); await stopPromise; });
    expect(result.current.state).toBe("idle");
  });

  it("말하는 중에 마이크를 누르면 낭독을 끊고 idle로 돌아온다", async () => {
    pipeline.speakAndWait.mockImplementationOnce(() => new Promise<void>(() => {}));

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    await act(async () => { void result.current.stop(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe("speaking");

    act(() => { result.current.handleMicClick(); });

    expect(pipeline.cancelSpeech).toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("받아 적은 문장이 비어 있으면 다시 말해 달라고 안내한다", async () => {
    pipeline.transcribe.mockResolvedValueOnce("   ");

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(pipeline.selectFunction).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe("말씀을 알아듣지 못했어요. 다시 말씀해 주세요.");
  });

  it("보고 있는 진단이 없으면 기능은 고르되 진단 화면에서 물어보라고 읽어 준다", async () => {
    pipeline.screen = { diagnosisId: null, uiStage: "no_photo", path: "/home" };

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(pipeline.selectFunction).toHaveBeenCalledTimes(1);
    expect(pipeline.answerFunction).not.toHaveBeenCalled();
    expect(result.current.assistantText).toContain("찍어 줘라고 말하거나");
    expect(pipeline.speakAndWait).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("아직 답을 못 만드는 기능(501)은 오류 대신 안내 문장을 읽어 준다", async () => {
    const { ApiError } = await import("@/lib/api");
    pipeline.answerFunction.mockRejectedValueOnce(new ApiError("아직", "FUNCTION_NOT_IMPLEMENTED", 501, false));

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(result.current.assistantText).toContain("아직 답을 준비하지 못했어요");
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe("idle");
  });

  it("서버와 연결되지 않으면 토스트 오류와 함께 idle로 돌아온다", async () => {
    pipeline.transcribe.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe("서버와 연결되지 않아요. 연결을 확인하고 다시 시도해 주세요.");
    expect(pipeline.speakAndWait).not.toHaveBeenCalled();
  });

  it("음성 인식 서버가 꺼져 있으면(503) 서버의 안내를 토스트로 보여 준다", async () => {
    const { ApiError } = await import("@/lib/api");
    pipeline.transcribe.mockRejectedValueOnce(new ApiError("음성 인식을 사용할 수 없습니다.", "STT_UNAVAILABLE", 503, true));

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(result.current.error).toBe("음성 인식을 사용할 수 없습니다.");
    expect(result.current.state).toBe("idle");
  });

  it("녹음 파일을 wav로 바꾸지 못하면 안내하고 서버를 부르지 않는다", async () => {
    const { AudioConversionError } = await import("@/features/voice/lib/wav");
    pipeline.recordingToWav.mockRejectedValueOnce(new AudioConversionError());

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(pipeline.transcribe).not.toHaveBeenCalled();
    expect(result.current.error).toBe("녹음한 소리를 처리하지 못했어요");
  });

  describe("호출어", () => {
    function wakeOn() {
      localStorage.setItem("cropy:voice-wake", "on");
    }

    async function speakIntoWake() {
      // 대기 400ms 뒤 호출어 녹음 시작 → 말소리 → 700ms 묵음 → 받아 적기
      await act(async () => { await vi.advanceTimersByTimeAsync(450); });
      expect(recorderMock.start).toHaveBeenCalledTimes(1);
      act(() => { recorderMock.onLevel?.(0.5); vi.advanceTimersByTime(300); recorderMock.onLevel?.(0.5); recorderMock.onLevel?.(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    }

    it("\"크로피 이거 무슨 병이야\"라고 하면 바로 그 질문에 답한다", async () => {
      wakeOn();
      pipeline.transcribe.mockResolvedValueOnce("크로피 이거 무슨 병이야");
      const { result } = renderHook(() => useVoiceConversation());
      act(() => { result.current.setContinuous(false); }); // 답한 뒤 연속 대화로 다시 듣지 않게
      await speakIntoWake();

      expect(pipeline.selectFunction).toHaveBeenCalledWith("이거 무슨 병이야", expect.anything(), expect.any(AbortSignal));
      expect(result.current.history[0]).toEqual({ role: "user", text: "이거 무슨 병이야" });
      expect(pipeline.speakAndWait).toHaveBeenCalledTimes(1);
      expect(result.current.state).toBe("idle");
    });

    it("이름만 부르면 신호음 뒤 듣기를 시작한다", async () => {
      wakeOn();
      pipeline.transcribe.mockResolvedValueOnce("크로피야");
      const { result } = renderHook(() => useVoiceConversation());
      await speakIntoWake();

      expect(pipeline.selectFunction).not.toHaveBeenCalled();
      expect(result.current.state).toBe("listening");
      expect(recorderMock.start).toHaveBeenCalledTimes(2); // 호출어 녹음 + 본 녹음
    });

    it("호출어가 아니면 버리고 계속 듣는다", async () => {
      wakeOn();
      pipeline.transcribe.mockResolvedValueOnce("오늘 날씨 좋다");
      const { result } = renderHook(() => useVoiceConversation());
      await speakIntoWake();

      expect(pipeline.selectFunction).not.toHaveBeenCalled();
      expect(result.current.state).toBe("idle");
      expect(result.current.history).toEqual([]);
      expect(recorderMock.start).toHaveBeenCalledTimes(2); // 다시 호출어 듣기 시작
    });

    it("끄면 대기 중에 녹음하지 않는다", async () => {
      const { result } = renderHook(() => useVoiceConversation());
      expect(result.current.wakeEnabled).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(recorderMock.start).not.toHaveBeenCalled();
    });
  });

  it("\"종료해 줘\"라고 하면 모델에 보내지 않고 인사한 뒤 나가기를 요청하고 다시 듣지 않는다", async () => {
    pipeline.transcribe.mockResolvedValueOnce("종료해 줘");
    const onExitRequest = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ onExitRequest }));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(pipeline.selectFunction).not.toHaveBeenCalled();
    expect(pipeline.speakAndWait).toHaveBeenCalledWith("음성 대화를 마칠게요.", expect.any(Symbol));
    expect(onExitRequest).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(recorderMock.start).toHaveBeenCalledTimes(1); // 연속 대화가 켜져 있어도 다시 듣지 않는다
  });

  it("\"찍어 줘\"라고 하면 모델에 보내지 않고 카메라로 찍어 진단하고 결과를 읽어 준다", async () => {
    pipeline.transcribe.mockResolvedValueOnce("사진 찍어 줘");
    pipeline.screen = { diagnosisId: null, uiStage: "no_photo", path: "/home" };
    const file = new File(["jpg"], "leaf.jpg", { type: "image/jpeg" });
    const captureFrame = vi.fn().mockResolvedValue(file);

    const { result } = renderHook(() => useVoiceConversation({ captureFrame }));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(captureFrame).toHaveBeenCalledTimes(1);
    expect(pipeline.diagnoseImage).toHaveBeenCalledWith(file, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(pipeline.selectFunction).not.toHaveBeenCalled();
    expect(pipeline.speakAndWait).toHaveBeenCalledWith(["고추 탄저병으로 분류됐어요.", "병든 잎을 떼어 내세요."], expect.any(Symbol));
    expect(result.current.screen).toEqual({ diagnosisId: "new-diag", uiStage: "result", path: "/home" });
    expect(sessionStorage.getItem("cropy:lastDiagnosisId")).toBe("new-diag");
  });

  it("찍은 사진은 썸네일·병명·재촬영 안내로 남고, 주고받은 말은 기록에 쌓인다", async () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:shot-1"), revokeObjectURL: vi.fn() });
    pipeline.diagnoseImage.mockResolvedValueOnce({
      id: "new-diag", disease_name: "무 검은무늬병",
      recapture: { region: "잎 뒷면", instruction: "잎을 뒤집어 뒷면이 꽉 차게 찍어 주세요", margin: 0.1, candidates: [] },
    });
    pipeline.transcribe.mockResolvedValueOnce("찍어 줘");
    const captureFrame = vi.fn().mockResolvedValue(new File(["jpg"], "leaf.jpg", { type: "image/jpeg" }));

    const { result } = renderHook(() => useVoiceConversation({ captureFrame }));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(result.current.lastShot).toEqual({
      url: "blob:shot-1", diseaseName: "무 검은무늬병",
      recapture: { region: "잎 뒷면", instruction: "잎을 뒤집어 뒷면이 꽉 차게 찍어 주세요" },
    });
    expect(result.current.history).toEqual([
      { role: "user", text: "찍어 줘" },
      { role: "assistant", text: "고추 탄저병으로 분류됐어요. 병든 잎을 떼어 내세요." },
    ]);
  });

  it("찍은 뒤의 질문은 방금 찍은 진단으로 답한다", async () => {
    pipeline.transcribe.mockResolvedValueOnce("찍어").mockResolvedValueOnce("이거 무슨 병이야");
    pipeline.screen = { diagnosisId: null, uiStage: "no_photo", path: "/home" };
    const captureFrame = vi.fn().mockResolvedValue(new File(["jpg"], "leaf.jpg", { type: "image/jpeg" }));

    const { result } = renderHook(() => useVoiceConversation({ captureFrame }));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); }); // 연속 대화로 다시 듣는 중
    await act(async () => { await result.current.stop(); });

    expect(pipeline.selectFunction).toHaveBeenCalledWith("이거 무슨 병이야", expect.objectContaining({ diagnosisId: "new-diag", uiStage: "result" }), expect.any(AbortSignal));
    expect(pipeline.answerFunction).toHaveBeenCalledWith("new-diag", "<hs_0>(topic=1)<hs_end>", "server", expect.any(AbortSignal));
  });

  it("\"사진은 어떻게 찍어\"는 촬영이 아니라 모델에 보낸다", async () => {
    pipeline.transcribe.mockResolvedValueOnce("사진은 어떻게 찍어");
    const captureFrame = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ captureFrame }));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });
    expect(captureFrame).not.toHaveBeenCalled();
    expect(pipeline.selectFunction).toHaveBeenCalledTimes(1);
  });

  it("카메라가 꺼져 있으면 찍는 대신 카메라를 켜라고 읽어 준다", async () => {
    pipeline.transcribe.mockResolvedValueOnce("찍어 줘");
    const { result } = renderHook(() => useVoiceConversation({ captureFrame: async () => null }));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });
    expect(pipeline.diagnoseImage).not.toHaveBeenCalled();
    expect(result.current.assistantText).toContain("카메라가 꺼져 있어요");
  });

  it("셔터 버튼(captureNow)은 듣지 않고도 찍어 진단하고 읽어 준다", async () => {
    const captureFrame = vi.fn().mockResolvedValue(new File(["jpg"], "leaf.jpg", { type: "image/jpeg" }));
    const { result } = renderHook(() => useVoiceConversation({ captureFrame }));
    await act(async () => { await result.current.captureNow(); });
    expect(pipeline.diagnoseImage).toHaveBeenCalledTimes(1);
    expect(pipeline.speakAndWait).toHaveBeenCalledTimes(1);
    expect(result.current.screen.diagnosisId).toBe("new-diag");
    expect(result.current.state).toBe("idle");
  });

  it("두 번째 녹음부터는 열어 둔 마이크 스트림을 다시 쓴다", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    expect(recorderMock.start.mock.calls[0][0]).toMatchObject({ keepStream: true, stream: null });

    await act(async () => { await result.current.stop(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(recorderMock.start).toHaveBeenCalledTimes(2);
    expect(recorderMock.start.mock.calls[1][0].stream).toBe(fakeStream);
  });

  it("연속 대화가 켜져 있으면 답을 다 읽은 뒤 잠깐 쉬고 다시 듣는다", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    expect(result.current.continuous).toBe(true); // 기본값 켜짐

    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });
    expect(result.current.state).toBe("idle");
    expect(recorderMock.start).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(recorderMock.start).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("listening");
  });

  it("연속 대화를 끄면 답을 읽은 뒤 대기 상태에 머문다", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    act(() => { result.current.setContinuous(false); });
    expect(localStorage.getItem("cropy:voice-continuous")).toBe("off");

    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(recorderMock.start).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("idle");
  });

  it("연속 대화 중 말이 없으면 한 번은 조용히 다시 듣고, 두 번째에는 안내 뒤 멈춘다", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });

    // 1회차 무발화 8초 → 오류 없이 자동으로 다시 듣기
    await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
    expect(result.current.error).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(recorderMock.start).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("listening");

    // 2회차 무발화 → 안내하고 대기
    await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
    expect(result.current.error).toBe("말씀을 듣지 못했어요. 다시 시도해 주세요.");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(recorderMock.start).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("idle");
  });

  it("말하는 중 마이크로 끊으면 자동으로 다시 듣지 않는다", async () => {
    pipeline.speakAndWait.mockImplementationOnce(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });
    await act(async () => { void result.current.stop(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe("speaking");

    act(() => { result.current.handleMicClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.state).toBe("idle");
    expect(recorderMock.start).toHaveBeenCalledTimes(1);
  });

  it("분석 중 취소하면 늦게 온 답변을 무시하고 읽지 않는다", async () => {
    let resolveTranscript!: (text: string) => void;
    pipeline.transcribe.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveTranscript = resolve; }));

    const { result } = renderHook(() => useVoiceConversation());
    await act(async () => { await result.current.start(); });

    let stopPromise!: Promise<void>;
    await act(async () => { stopPromise = result.current.stop(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe("thinking");

    act(() => { result.current.cancel(); });
    await act(async () => { resolveTranscript("늦은 문장"); await stopPromise; });

    expect(result.current.state).toBe("idle");
    expect(pipeline.selectFunction).not.toHaveBeenCalled();
    expect(pipeline.speakAndWait).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
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
    expect(result.current.error).toBeNull();
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
    expect(result.current.error).toBeNull();
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
    expect(result.current.error).toBeNull();
    expect(result.current.assistantText).toBe("현재 진단은 고추 탄저병입니다.");

    await act(async () => {
        await result.current.start();
    });

    expect(result.current.state).toBe("listening");
    expect(result.current.error).toBeNull();
    expect(recorderMock.start).toHaveBeenCalledTimes(2);
    });
});
