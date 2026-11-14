/**
 * 브라우저 녹음(webm·mp4)을 STT 서버가 받는 16kHz 모노 16비트 PCM wav로 바꾼다.
 *
 * 브라우저가 녹음 파일을 디코드한 뒤 OfflineAudioContext로 다시 샘플링한다.
 * 서버에 ffmpeg를 두지 않아도 되고, 보내는 양도 30초에 약 1MB로 준다.
 */

export const WAV_SAMPLE_RATE = 16000;

export class AudioConversionError extends Error {
  constructor(message = "녹음한 소리를 처리하지 못했어요") {
    super(message);
    this.name = "AudioConversionError";
  }
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 디코드한 소리를 모노 16kHz로 다시 샘플링한다 */
async function resampleToMono(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(buffer.duration * WAV_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, WAV_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** float [-1, 1] 샘플을 16비트 PCM wav 바이트로 */
export function encodeWav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM 헤더 길이
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** 녹음 Blob → 16kHz 모노 wav Blob. 디코드할 수 없는 파일이면 AudioConversionError */
export async function recordingToWav(recording: Blob): Promise<Blob> {
  const Ctor = audioContextCtor();
  if (!Ctor || typeof OfflineAudioContext === "undefined") {
    throw new AudioConversionError();
  }
  const context = new Ctor();
  try {
    let decoded: AudioBuffer;
    try {
      // Safari의 decodeAudioData는 콜백 형식만 있는 버전이 있어 Promise로 감싼다
      const data = await recording.arrayBuffer();
      decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        const result = context.decodeAudioData(data, resolve, reject);
        if (result && typeof (result as Promise<AudioBuffer>).then === "function") {
          (result as Promise<AudioBuffer>).then(resolve, reject);
        }
      });
    } catch {
      throw new AudioConversionError();
    }
    const samples = await resampleToMono(decoded);
    return new Blob([encodeWav(samples)], { type: "audio/wav" });
  } finally {
    void context.close().catch(() => {});
  }
}
