import { describe, expect, it } from "vitest";
import { isExitCommand } from "./exitIntent";

describe("isExitCommand", () => {
  it.each(["종료해줘", "종료", "그만", "이제 그만", "끝내자", "대화 끝", "멈춰", "나가기", "닫아 줘", "꺼 줘", "이제 됐어", "음성 모드 종료"])(
    "종료 명령: %s",
    (text) => expect(isExitCommand(text)).toBe(true),
  );

  it.each(["이거 무슨 병이야", "약 얼마나 타", "왜 다시 찍으라는 거야", "어떻게 끝내", "끝이 갈색으로 변했어 무슨 병이야", "", "사진 찍어 줘"])(
    "명령 아님: %s",
    (text) => expect(isExitCommand(text)).toBe(false),
  );
});
