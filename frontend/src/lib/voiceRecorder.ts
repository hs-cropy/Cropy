//마이크 권한 요청, 녹음 데이터 수집, 중단, 취소, 마이크 트랙 해제 담당
export interface VoiceRecording {
  stop(): Promise<Blob>;
  cancel(): void;
}

export class VoiceRecorderError extends Error {
  constructor(message = "음성 안내를 시작하지 못했어요") {
    super(message);
    this.name = "VoiceRecorderError";
  }
}

export async function startVoiceRecording(): Promise<VoiceRecording> {
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

  const release = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  let recorder: MediaRecorder;

  try {
    recorder = new MediaRecorder(stream);
  } catch {
    release();
    throw new VoiceRecorderError();
  }

  const chunks: Blob[] = [];
  let cancelled = false;
  let stopping: Promise<Blob> | null = null;

  recorder.addEventListener("dataavailable", (event) => {
    if (!cancelled && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  const stop = (): Promise<Blob> => {
    if (stopping) return stopping;

    stopping = new Promise<Blob>((resolve, reject) => {
      if (recorder.state === "inactive") {
        release();
        reject(new VoiceRecorderError());
        return;
      }

      recorder.addEventListener(
        "stop",
        () => {
          release();

          if (cancelled) {
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

      recorder.addEventListener(
        "error",
        () => {
          release();
          reject(new VoiceRecorderError());
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
        // 화면을 벗어나면서 이미 종료된 경우
      }
    }

    release();
  };

  try {
    recorder.start();
  } catch {
    release();
    throw new VoiceRecorderError();
  }

  return { stop, cancel };
}
