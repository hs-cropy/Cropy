import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVoiceRecording, VoiceRecorderError, VoicePermissionError } from "./voiceRecorder";

describe("voiceRecorder", () => {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn();

  class FakeMediaRecorder extends EventTarget {
    state: RecordingState = "inactive";
    mimeType = "audio/webm";
    start = vi.fn(() => {
      this.state = "recording";
    });

    stop = vi.fn(() => {
      if (this.state === "inactive") {
        throw new Error("Already stopped");
      }

      this.state = "inactive";

      const event = new Event("dataavailable") as Event & {
        data: Blob;
      };
      event.data = new Blob(["recorded audio"], {
        type: "audio/webm",
      });

      this.dispatchEvent(event);
      this.dispatchEvent(new Event("stop"));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("마이크 권한을 요청하고 녹음을 시작한다", async () => {
    const recording = await startVoiceRecording();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });

    recording.cancel();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("녹음 종료 시 오디오 Blob을 생성하고 마이크를 해제한다", async () => {
    const recording = await startVoiceRecording();

    const audio = await recording.stop();

    expect(audio).toBeInstanceOf(Blob);
    expect(audio.size).toBeGreaterThan(0);
    expect(audio.type).toBe("audio/webm");
    expect(stopTrack).toHaveBeenCalled();
  });

  it("취소하면 마이크를 해제하고 이후 중복 취소해도 안전하다", async () => {
    const recording = await startVoiceRecording();

    recording.cancel();
    recording.cancel();

    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

    it("마이크 권한 거부 시 권한 설정 안내 오류를 반환한다", async () => {
        getUserMedia.mockRejectedValueOnce(
            new DOMException("Permission denied", "NotAllowedError"),
        );

        await expect(startVoiceRecording()).rejects.toBeInstanceOf(
            VoicePermissionError,
        );

        expect(stopTrack).not.toHaveBeenCalled();
    });

  it("AudioContext가 없어도 녹음은 유지하고 분석 불가를 알린다", async () => {
    vi.stubGlobal("AudioContext", undefined);

    const onLevel = vi.fn();
    const onAnalysisUnavailable = vi.fn();

    const recording = await startVoiceRecording({
      onLevel,
      onAnalysisUnavailable,
    });

    expect(onAnalysisUnavailable).toHaveBeenCalledTimes(1);

    const audio = await recording.stop();

    expect(audio.size).toBeGreaterThan(0);
    expect(audio.type).toBe("audio/webm");
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(onAnalysisUnavailable).toHaveBeenCalledTimes(1);
  });

  it("AudioContext 생성 실패 시에도 녹음을 유지한다", async () => {
    class FailingAudioContext {
      constructor() {
        throw new Error("AudioContext unavailable");
      }
    }

    vi.stubGlobal("AudioContext", FailingAudioContext);

    const onAnalysisUnavailable = vi.fn();

    const recording = await startVoiceRecording({
      onLevel: vi.fn(),
      onAnalysisUnavailable,
    });

    expect(onAnalysisUnavailable).toHaveBeenCalledTimes(1);

    const audio = await recording.stop();

    expect(audio.size).toBeGreaterThan(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("resume 후에도 AudioContext가 suspended이면 분석 불가를 알리고 녹음은 유지한다", async () => {
    class SuspendedAudioContext {
        state = "suspended";

        createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
        }

        createAnalyser() {
        return {
            fftSize: 1024,
            smoothingTimeConstant: 0.6,
            disconnect: vi.fn(),
        };
        }

        resume = vi.fn(async () => {
        // 성공해도 suspended 상태 유지
        });

        close = vi.fn(async () => {});
    }

    vi.stubGlobal("AudioContext", SuspendedAudioContext);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const onAnalysisUnavailable = vi.fn();

    const recording = await startVoiceRecording({
        onLevel: vi.fn(),
        onAnalysisUnavailable,
    });

    // resume() 완료 후의 비동기 처리까지 반영
    await Promise.resolve();
    await Promise.resolve();

    expect(onAnalysisUnavailable).toHaveBeenCalledTimes(1);

    // 분석 불가여도 MediaRecorder 녹음은 정상 종료되어야 한다.
    const audio = await recording.stop();

    expect(audio.size).toBeGreaterThan(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("녹음 취소 후 늦게 완료된 resume은 분석 실패를 알리지 않는다", async () => {
    let resolveResume!: () => void;

    const resumePromise = new Promise<void>((resolve) => {
        resolveResume = resolve;
    });

    class DelayedAudioContext {
        state: AudioContextState = "suspended";

        createMediaStreamSource() {
        return {
            connect: vi.fn(),
            disconnect: vi.fn(),
        };
        }

        createAnalyser() {
        return {
            fftSize: 1024,
            smoothingTimeConstant: 0.6,
            disconnect: vi.fn(),
        };
        }

        resume = vi.fn(() => resumePromise);
        close = vi.fn(async () => {});
    }

    vi.stubGlobal("AudioContext", DelayedAudioContext);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const onAnalysisUnavailable = vi.fn();
    const onLevel = vi.fn();

    const recording = await startVoiceRecording({
        onLevel,
        onAnalysisUnavailable,
    });

    // resume()이 완료되지 않은 상태에서 녹음을 취소한다.
    expect(onAnalysisUnavailable).not.toHaveBeenCalled();

    recording.cancel();

    expect(stopTrack).toHaveBeenCalledTimes(1);

    // 녹음을 취소한 뒤 resume()이 뒤늦게 완료된다.
    resolveResume();

    await resumePromise;
    await Promise.resolve();

    // 이미 취소했으므로 분석 실패 알림을 보내지 않는다.
    expect(onAnalysisUnavailable).not.toHaveBeenCalled();

    // 녹음 자원은 중복 해제되지 않는다.
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});