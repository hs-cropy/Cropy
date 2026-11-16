import { describe, expect, it } from "vitest";
import type { DiagnoseResponse } from "@/types/diagnosis";
import type { UiStage } from "./voiceApi";
import { compactContext, contextJson, roundScore } from "./voiceContext";
// 백엔드 backend/app/services/voice_context.compact_context 로 만든 기대값 (Python json.dumps, separators=(",", ":"))
import cases from "./__fixtures__/compact_context_cases.json";

describe("compactContext", () => {
  it.each(cases)("백엔드와 같은 문자열: $name", ({ diagnosis, ui_stage, expected }) => {
    const context = compactContext(diagnosis as unknown as DiagnoseResponse | null, ui_stage as UiStage | null);
    expect(contextJson(context)).toBe(expected);
  });
});

describe("contextJson", () => {
  it("점수가 정수로 떨어지면 Python처럼 1.0으로 쓴다", () => {
    expect(contextJson({ confidence: 1, top_predictions: [{ name: "a", confidence: 0 }] })).toBe('{"confidence":1.0,"top_predictions":[{"name":"a","confidence":0.0}]}');
  });

  it("한글을 이스케이프하지 않고 공백 없이 쓴다", () => {
    expect(contextJson({ ui_stage: "result", disease_name: "고추 탄저병", crop_mismatch: false })).toBe('{"ui_stage":"result","disease_name":"고추 탄저병","crop_mismatch":false}');
  });
});

describe("roundScore", () => {
  it("학습 데이터처럼 소수 둘째 자리 (Python round 와 같다)", () => {
    expect(roundScore(0.9118661279106783)).toBe(0.91);
    expect(roundScore(0.005)).toBe(0.01);       // 이진값이 0.005보다 조금 크다 (Python 0.01)
    expect(roundScore(0.125)).toBe(0.12);       // 정확히 가운데 → 짝수 쪽 (Python 0.12)
    expect(roundScore(0.375)).toBe(0.38);
    expect(roundScore(1)).toBe(1);
    expect(roundScore(null)).toBe(null);
  });
});
