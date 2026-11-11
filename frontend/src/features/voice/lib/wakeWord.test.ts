import { describe, expect, it } from "vitest";
import { matchWakeWord } from "./wakeWord";

describe("matchWakeWord", () => {
  it.each([
    ["크로피", ""],
    ["크로피야", ""],
    ["크로피야 이거 무슨 병이야", "이거 무슨 병이야"],
    ["크로피, 약 얼마나 타", "약 얼마나 타"],
    ["어 크로삐 사진 찍어 줘", "사진 찍어 줘"],
    ["그로피 님 안녕", "안녕"],
  ])("%s → 이어진 말 %s", (text, remainder) => {
    expect(matchWakeWord(text)).toEqual({ remainder });
  });

  it.each(["이거 무슨 병이야", "오늘 날씨 좋다", "크로마키 켜 줘", ""])("호출어 없음: %s", (text) => {
    expect(matchWakeWord(text)).toBeNull();
  });
});
