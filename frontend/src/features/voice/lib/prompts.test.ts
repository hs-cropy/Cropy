import { describe, expect, it } from "vitest";
import type { DiagnoseResponse, RecaptureGuidance } from "@/types/diagnosis";
import {
  buildCameraPrompt,
  buildRecapturePrompt,
  buildResultPrompt,
  PROMPT_DIAGNOSING,
  PROMPT_HOME,
} from "./prompts";

function makeResult(overrides: Partial<DiagnoseResponse> = {}): DiagnoseResponse {
  return {
    id: "d1",
    disease_name: "고추 탄저병",
    category: "disease",
    confidence: 0.914,
    top_predictions: [],
    causes: [],
    pesticides: [
      { name: "A 수화제", safety: {} },
      { name: "B 유제", safety: {} },
    ],
    prevention: [],
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function makeGuidance(region: string): RecaptureGuidance {
  return { region, instruction: "", margin: 0.05, candidates: [] };
}

describe("고정 안내 문장", () => {
  it("기능명세서 문구와 같다", () => {
    expect(PROMPT_HOME).toBe("작물을 고르고 잎을 찍어주세요");
    expect(PROMPT_DIAGNOSING).toBe("진단 중이에요");
  });
});

describe("buildResultPrompt (M04-F9)", () => {
  it("병명·신뢰도·농약 수를 명세 예시대로 읽는다", () => {
    expect(buildResultPrompt(makeResult())).toEqual([
      "고추 탄저병, 신뢰도 91%",
      "등록 농약 2종이 있어요",
    ]);
  });

  it("신뢰도는 반올림한 정수 퍼센트로 읽는다", () => {
    expect(buildResultPrompt(makeResult({ confidence: 0.875 }))[0]).toBe("고추 탄저병, 신뢰도 88%");
    expect(buildResultPrompt(makeResult({ confidence: 1 }))[0]).toBe("고추 탄저병, 신뢰도 100%");
  });

  it("등록 농약이 없으면 M04-F6 문구로 읽는다", () => {
    expect(buildResultPrompt(makeResult({ pesticides: [] }))).toEqual([
      "고추 탄저병, 신뢰도 91%",
      "등록 농약 정보가 없어요. 농업기술센터에 문의하세요",
    ]);
  });

  it('정상 판정은 category가 "normal"이어도 "healthy"여도 건강 문구만 읽는다', () => {
    const normal = makeResult({ disease_name: "고추 정상", category: "normal", pesticides: [] });
    // 백엔드 seed는 "healthy"를 내려주지만 프론트 타입에는 없는 값이다
    const healthy = { ...normal, category: "healthy" } as unknown as DiagnoseResponse;

    expect(buildResultPrompt(normal)).toEqual(["건강한 상태예요"]);
    expect(buildResultPrompt(healthy)).toEqual(["건강한 상태예요"]);
  });

  it("판별 불가는 점수·농약 대신 다시 찍기를 읽는다", () => {
    expect(buildResultPrompt(makeResult({ disease_name: "판별 불가", category: "other", pesticides: [] }))).toEqual([
      "작물 잎을 찾지 못했어요",
      "잎이 잘 보이게 다시 찍어 주세요",
    ]);
  });

  it("category가 없으면 병해로 보고 읽는다", () => {
    expect(buildResultPrompt(makeResult({ category: undefined }))[1]).toBe(
      "등록 농약 2종이 있어요",
    );
  });
});

describe("buildRecapturePrompt (M05-F8)", () => {
  it("받침이 있는 부위에는 '을'을 붙인다", () => {
    expect(buildRecapturePrompt(makeGuidance("잎 뒷면"))).toEqual([
      "두 병이 비슷해요",
      "잎 뒷면을 가까이 찍어주세요",
    ]);
  });

  it("받침이 없는 부위에는 '를'을 붙인다", () => {
    expect(buildRecapturePrompt(makeGuidance("줄기"))[1]).toBe("줄기를 가까이 찍어주세요");
  });

  it("한글로 끝나지 않으면 '을'로 둔다", () => {
    expect(buildRecapturePrompt(makeGuidance("leaf"))[1]).toBe("leaf을 가까이 찍어주세요");
  });

  it("가운뎃점은 쉼표로 바꿔 읽고 앞뒤 공백을 정리한다", () => {
    expect(buildRecapturePrompt(makeGuidance("  잎맥 · 잎 가장자리 "))[1]).toBe(
      "잎맥, 잎 가장자리를 가까이 찍어주세요",
    );
  });
});

describe("buildCameraPrompt", () => {
  it("작물을 골랐으면 작물 이름을 넣는다", () => {
    expect(buildCameraPrompt("고추")).toBe("고추 잎이 화면 가운데 오도록 찍어주세요");
  });

  it("자동 감지면 작물 이름 없이 읽는다", () => {
    expect(buildCameraPrompt()).toBe("잎이 화면 가운데 오도록 찍어주세요");
    expect(buildCameraPrompt("")).toBe("잎이 화면 가운데 오도록 찍어주세요");
  });
});
