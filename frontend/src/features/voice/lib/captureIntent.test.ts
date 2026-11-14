import { describe, expect, it } from "vitest";
import { isCaptureCommand } from "./captureIntent";

describe("isCaptureCommand", () => {
  it.each(["찍어", "사진 찍어 줘", "지금 찍어봐", "촬영해", "촬영 해 줘", "이거 찍어서 봐 줘", "셔터 눌러"])(
    "촬영 명령: %s",
    (text) => expect(isCaptureCommand(text)).toBe(true),
  );

  it.each(["사진은 어떻게 찍어", "사진 찍는 방법 알려줘", "왜 다시 찍으라는 거야", "어디를 찍어야 돼", "언제 찍으면 돼", "이거 무슨 병이야", "약 얼마나 타서 뿌려"])(
    "명령 아님: %s",
    (text) => expect(isCaptureCommand(text)).toBe(false),
  );
});
