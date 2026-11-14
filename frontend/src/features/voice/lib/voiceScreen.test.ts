import { beforeEach, describe, expect, it } from "vitest";
import { saveVoiceReturn } from "@/components/voice-mode/voiceNavigation";
import { diagnosisIdFromPath, LAST_DIAGNOSIS_KEY, readVoiceScreen } from "./voiceScreen";

beforeEach(() => {
  sessionStorage.clear();
});

describe("diagnosisIdFromPath", () => {
  it("/history/<id>에서 id를 꺼낸다", () => {
    expect(diagnosisIdFromPath("/history/abc-123")).toBe("abc-123");
    expect(diagnosisIdFromPath("/history/abc-123?from=list#top")).toBe("abc-123");
    expect(diagnosisIdFromPath("/history/%ED%95%9C%EA%B8%80")).toBe("한글");
  });

  it("목록·다른 경로에서는 null", () => {
    expect(diagnosisIdFromPath("/history")).toBeNull();
    expect(diagnosisIdFromPath("/history/")).toBeNull();
    expect(diagnosisIdFromPath("/home")).toBeNull();
  });
});

describe("readVoiceScreen", () => {
  it("진단 이력 상세에서 들어오면 그 진단의 결과 화면이다", () => {
    saveVoiceReturn("/history/abc-123", 0);
    expect(readVoiceScreen()).toEqual({ diagnosisId: "abc-123", uiStage: "result", path: "/history/abc-123" });
  });

  it("진단 화면에서 들어오면 세션의 마지막 진단 id를 쓴다", () => {
    saveVoiceReturn("/diagnosis", 120);
    sessionStorage.setItem(LAST_DIAGNOSIS_KEY, "last-1");
    expect(readVoiceScreen()).toEqual({ diagnosisId: "last-1", uiStage: "result", path: "/diagnosis" });
  });

  it("진단 화면인데 저장된 결과가 없으면 사진 준비 단계다", () => {
    saveVoiceReturn("/diagnosis", 0);
    expect(readVoiceScreen()).toEqual({ diagnosisId: null, uiStage: "photo_ready", path: "/diagnosis" });
  });

  it("복귀 정보가 없거나 홈이면 사진 없음 단계다", () => {
    expect(readVoiceScreen()).toEqual({ diagnosisId: null, uiStage: "no_photo", path: null });
    saveVoiceReturn("/home", 0);
    expect(readVoiceScreen()).toEqual({ diagnosisId: null, uiStage: "no_photo", path: "/home" });
  });
});
