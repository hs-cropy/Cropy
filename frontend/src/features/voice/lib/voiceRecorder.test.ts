import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startVoiceRecording,
  VoiceRecorderError,
} from "./voiceRecorder";

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

  it("마이크 권한 거부 시 오류를 반환한다", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    await expect(startVoiceRecording()).rejects.toBeInstanceOf(
      VoiceRecorderError,
    );
  });
});