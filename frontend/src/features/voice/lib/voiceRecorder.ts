//마이크 권한 요청, 녹음 데이터 수집, 중단, 취소, 마이크 트랙 해제 담당
export interface VoiceRecording {
  stop(): Promise<Blob>;
  cancel(): void;
  /** 녹음에 쓴 마이크 스트림. keepStream이면 종료 뒤에도 살아 있어 다음 녹음에 바로 다시 쓴다 */
  stream: MediaStream;
}

export interface VoiceRecordingOptions {
  onLevel?: (level: number) => void;
  onAnalysisUnavailable?: () => void;
  /**
   * 이미 열어 둔 마이크 스트림. 연속 대화에서 매번 권한을 다시 묻고 장치를 다시 여는 데 수백 ms가 걸려
   * 말의 첫머리가 잘리는 것을 막는다. 끝난(active가 아닌) 스트림이면 새로 연다.
   */
  stream?: MediaStream | null;
  /** 종료·취소 때 마이크 트랙을 끄지 않고 둔다. 쓰는 쪽이 releaseStream으로 끈다 */
  keepStream?: boolean;
}

/** keepStream으로 남겨 둔 마이크를 끈다 */
export function releaseStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export class VoiceRecorderError extends Error {
  constructor(message = "음성 안내를 시작하지 못했어요") {
    super(message);
    this.name = "VoiceRecorderError";
  }
}

export class VoicePermissionError extends VoiceRecorderError {
  constructor() {
    super("마이크 권한이 거부되었어요. 설정에서 마이크 사용을 허용해 주세요.");
    this.name = "VoicePermissionError";
  }
}

export async function startVoiceRecording(
  options: VoiceRecordingOptions = {},
): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new VoiceRecorderError();
  }

  let stream: MediaStream;

  try {
    stream = options.stream && options.stream.active
      ? options.stream
      : await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        });
  } catch (error) {
    const errorName =
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      typeof error.name === "string"
        ? error.name
        : null;

    if (
      errorName === "NotAllowedError" ||
      errorName === "PermissionDeniedError"
    ) {
      throw new VoicePermissionError();
    }

    throw new VoiceRecorderError();
  }

  let recorder: MediaRecorder;

  try {
    recorder = new MediaRecorder(stream);
    recorder.start();
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new VoiceRecorderError();
  }

  const chunks: Blob[] = [];
  let cancelled = false;
  let stopping: Promise<Blob> | null = null;

  // 음량 분석에 사용하는 자원
  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let frameId: number | null = null;

  let released = false;

  const stopAnalysis = () => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }

    source?.disconnect();
    analyser?.disconnect();
    source = null;
    analyser = null;

    if (audioContext) {
      const context = audioContext;
      audioContext = null;
      void context.close().catch(() => {});
    }

    options.onLevel?.(0);
  };

  let analysisUnavailableNotified = false;

  const notifyAnalysisUnavailable = () => {
    // 녹음 종료·취소 이후에는 실패 알림을 보내지 않는다.
    if (released || cancelled || analysisUnavailableNotified) {
      return;
    }
    analysisUnavailableNotified = true;
    // 분석만 중단한다. MediaRecorder 녹음은 유지한다.
    stopAnalysis();
    options.onAnalysisUnavailable?.();
  };

  const release = () => {
    if (released) return;
    released = true;

    stopAnalysis();
    if (!options.keepStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  };

  recorder.addEventListener("dataavailable", (event) => {
    if (!cancelled && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  // MediaRecorder의 녹음과 별개로 마이크 신호를 분석한다.
  if (options.onLevel) {
    if (typeof AudioContext === "undefined") {
      notifyAnalysisUnavailable();
    } else {
      try {
        audioContext = new AudioContext();
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();

        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;

        source.connect(analyser);

        const samples = new Float32Array(analyser.fftSize);
        const meter = analyser;
        let lastUpdate = 0;

        const measure = (timestamp: number) => {
          if (released || cancelled || analysisUnavailableNotified) {
            return;
          }

          try {
            // React 상태 갱신 횟수를 줄이기 위해 약 80ms 간격으로 전달
            if (timestamp - lastUpdate >= 80) {
              lastUpdate = timestamp;

              meter.getFloatTimeDomainData(samples);

              let sum = 0;

              for (const sample of samples) {
                sum += sample * sample;
              }

              const rms = Math.sqrt(sum / samples.length);

              const level = Math.min(1, Math.max(0, (rms - 0.01) * 8));

              options.onLevel?.(level);
            }

            frameId = requestAnimationFrame(measure);
          } catch {
            notifyAnalysisUnavailable();
          }
        };

        frameId = requestAnimationFrame(measure);
        const context = audioContext;
        if (context.state === "suspended") {
          void context
            .resume()
            .then(() => {
              if (released || cancelled) return;

              if (context.state !== "running") {
                notifyAnalysisUnavailable();
              }
            })
            .catch(() => {
              if (released || cancelled) return;
              notifyAnalysisUnavailable();
            });
        } else if (context.state !== "running") {
          notifyAnalysisUnavailable();
        }
      } catch {
        // 음량 분석을 사용할 수 없어도 녹음은 계속 가능하다.
        notifyAnalysisUnavailable();
      }
    }
  }

  const stop = (): Promise<Blob> => {
    if (stopping) return stopping;

    stopping = new Promise<Blob>((resolve, reject) => {
      if (recorder.state === "inactive") {
        release();
        reject(new VoiceRecorderError());
        return;
      }

      let failed = false;

      recorder.addEventListener(
        "error",
        () => {
          failed = true;
        },
        { once: true },
      );

      recorder.addEventListener(
        "stop",
        () => {
          release();

          if (cancelled || failed) {
            reject(new VoiceRecorderError());
            return;
          }

          const audio = new Blob(chunks, {
            type: recorder.mimeType || "application/octet-stream",
          });

          if (audio.size === 0) {
            reject(new VoiceRecorderError());
            return;
          }

          resolve(audio);
        },
        { once: true },
      );

      try {
        recorder.stop();
      } catch {
        release();
        reject(new VoiceRecorderError());
      }
    });

    return stopping;
  };

  const cancel = () => {
    cancelled = true;

    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // 이미 종료됐거나 종료 중인 경우
      }
    }

    release();
  };

  return { stop, cancel, stream };
}
