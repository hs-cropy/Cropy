//마이크 권한 요청, 녹음 데이터 수집, 중단, 취소, 마이크 트랙 해제 담당
export interface VoiceRecording {
  stop(): Promise<Blob>;
  cancel(): void;
}

export interface VoiceRecordingOptions {
  onLevel?: (level: number) => void;
}

export class VoiceRecorderError extends Error {
  constructor(message = "음성 안내를 시작하지 못했어요") {
    super(message);
    this.name = "VoiceRecorderError";
  }
}

export async function startVoiceRecording(
  options: VoiceRecordingOptions = {},
): Promise<VoiceRecording> {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    throw new VoiceRecorderError();
  }

  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  } catch {
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

  const release = () => {
    if (released) return;
    released = true;

    stopAnalysis();
    stream.getTracks().forEach((track) => track.stop());
  };

  recorder.addEventListener("dataavailable", (event) => {
    if (!cancelled && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  // MediaRecorder의 녹음과 별개로 마이크 신호를 분석한다.
  if (options.onLevel && typeof AudioContext !== "undefined") {
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
        if (released || cancelled) return;

        frameId = requestAnimationFrame(measure);

        // React 상태 갱신 횟수를 줄이기 위해 약 80ms 간격으로 전달
        if (timestamp - lastUpdate < 80) return;
        lastUpdate = timestamp;

        meter.getFloatTimeDomainData(samples);

        // RMS: 오디오 신호의 평균 에너지 크기
        let sum = 0;

        for (const sample of samples) {
          sum += sample * sample;
        }

        const rms = Math.sqrt(sum / samples.length);

        // 작은 주변 잡음을 제외하고 화면 표현용으로 증폭
        const level = Math.min(
          1,
          Math.max(0, (rms - 0.01) * 8),
        );

        options.onLevel?.(level);
      };

      frameId = requestAnimationFrame(measure);

      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => {
          // 분석 실패와 녹음 실패는 구분한다.
          // 녹음 자체는 계속 진행할 수 있다.
        });
      }
    } catch {
      // 음량 분석을 사용할 수 없어도 녹음은 계속 가능하다.
      stopAnalysis();
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

  return { stop, cancel };
}