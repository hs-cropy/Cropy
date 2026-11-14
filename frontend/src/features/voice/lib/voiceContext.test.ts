import { describe, expect, it } from "vitest";
import type { DiagnoseResponse } from "@/types/diagnosis";
import type { UiStage } from "./voiceApi";
import { compactContext, contextJson } from "./voiceContext";
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
