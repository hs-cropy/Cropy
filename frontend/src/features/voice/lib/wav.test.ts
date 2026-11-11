import { describe, expect, it } from "vitest";
import { encodeWav, WAV_SAMPLE_RATE } from "./wav";

function ascii(view: DataView, offset: number, length: number) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

describe("encodeWav", () => {
  it("16kHz 모노 16비트 PCM 헤더를 쓴다", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const view = new DataView(encodeWav(samples));

    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // 모노
    expect(view.getUint32(24, true)).toBe(WAV_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16); // 비트
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(view.byteLength).toBe(44 + samples.length * 2);
  });

  it("[-1, 1] 밖의 값은 자르고 16비트 범위로 바꾼다", () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5])));
    const pcm = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(pcm).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });
});
