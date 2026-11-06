
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearVoiceReturn,
  readVoiceReturn,
  saveVoiceReturn,
  VOICE_RETURN_KEY,
} from "./voiceNavigation";

beforeEach(() => {
  sessionStorage.clear();
});

describe("voiceNavigation — 음성 모드 복귀 정보", () => {
  it("복귀 정보가 없으면 null을 반환한다", () => {
    expect(readVoiceReturn()).toBeNull();
  });

  it("진입 직전 경로와 스크롤 위치를 저장하고 읽는다", () => {
    saveVoiceReturn("/history?page=2", 420);

    expect(readVoiceReturn()).toEqual({
      path: "/history?page=2",
      scrollY: 420,
    });
  });

  it("스크롤 위치가 음수면 0으로 저장한다", () => {
    saveVoiceReturn("/history", -100);

    expect(readVoiceReturn()).toEqual({
      path: "/history",
      scrollY: 0,
    });
  });

  it("복귀 정보를 삭제하면 다시 읽을 수 없다", () => {
    saveVoiceReturn("/history", 300);

    clearVoiceReturn();

    expect(sessionStorage.getItem(VOICE_RETURN_KEY)).toBeNull();
    expect(readVoiceReturn()).toBeNull();
  });

  it("잘못된 JSON은 안전하게 무시한다", () => {
    sessionStorage.setItem(VOICE_RETURN_KEY, "{invalid");

    expect(readVoiceReturn()).toBeNull();
  });

  it.each([
    "https://example.com",
    "//example.com",
    "/voice-mode",
    "/voice-mode/test",
  ])("잘못된 복귀 경로 %s는 거부한다", (path) => {
    sessionStorage.setItem(
      VOICE_RETURN_KEY,
      JSON.stringify({ path, scrollY: 100 }),
    );

    expect(readVoiceReturn()).toBeNull();
  });

  it.each([NaN, Infinity, -1])(
    "유효하지 않은 스크롤 위치 %s는 거부한다",
    (scrollY) => {
      sessionStorage.setItem(
        VOICE_RETURN_KEY,
        JSON.stringify({ path: "/history", scrollY }),
      );

      expect(readVoiceReturn()).toBeNull();
    },
  );
});
