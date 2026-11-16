/**
 * 기능 선택 모델에 넣는 화면 상태(context). 백엔드 `backend/app/services/voice_context.py`의 compact_context를
 * 그대로 옮겼다. 기기 안 선택기(#167~)는 서버를 거치지 않으므로 같은 규칙으로 직접 만들어야 모델 입력이 같아진다.
 * 키 순서와 줄임 규칙, JSON 직렬화(공백 없음, 실수는 Python처럼 1.0)가 학습 데이터와 같아야 한다.
 */
import type { DiagnoseResponse } from "@/types/diagnosis";
import type { UiStage } from "./voiceApi";

/** 학습 데이터의 context 키 순서 (ml/qwen/spec_v2.CONTEXT_KEYS) */
export const CONTEXT_KEYS = [
  "ui_stage", "selected_crop", "predicted_crop", "crop_mismatch", "prediction_mode", "category",
  "disease_name", "confidence", "top_predictions", "severity", "decision_status", "save_status",
  "recapture", "pesticides", "selected_usage_id", "pending_target",
] as const;

export type CompactContext = Record<string, unknown>;

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0);

export function compactContext(diagnosis: DiagnoseResponse | null, uiStage?: UiStage | null): CompactContext {
  const raw: Record<string, unknown> = {};
  if (diagnosis) {
    const pesticides = diagnosis.pesticides?.length ? diagnosis.pesticides : diagnosis.current_pesticides ?? [];
    Object.assign(raw, {
      selected_crop: diagnosis.selected_crop,
      predicted_crop: diagnosis.predicted_crop,
      crop_mismatch: diagnosis.crop_mismatch,
      prediction_mode: diagnosis.prediction_mode,
      category: diagnosis.category,
      disease_name: diagnosis.disease_name,
      confidence: diagnosis.confidence,
      top_predictions: (diagnosis.top_predictions ?? []).map((p) => ({ name: p.name, confidence: p.confidence })),
      severity: diagnosis.severity,
      decision_status: diagnosis.decision_status,
      save_status: diagnosis.save_status,
      recapture: diagnosis.recapture ? { ...diagnosis.recapture } : null,
      pesticides: pesticides.map((p) => p.name),
    });
  }
  if (uiStage) raw.ui_stage = uiStage;

  const context: CompactContext = {};
  for (const key of CONTEXT_KEYS) if (!isEmpty(raw[key])) context[key] = raw[key];
  if (raw.crop_mismatch === false) context.crop_mismatch = false;
  if (!("ui_stage" in context)) context.ui_stage = raw.disease_name ? "result" : "no_photo";
  if (context.recapture && typeof context.recapture === "object") {
    context.recapture = { region: (context.recapture as { region?: unknown }).region ?? null };
  }
  if (Array.isArray(context.top_predictions)) context.top_predictions = context.top_predictions.slice(0, 2);
  if (Array.isArray(context.pesticides)) context.pesticides = context.pesticides.slice(0, 5);

  const ordered: CompactContext = {};
  for (const key of CONTEXT_KEYS) if (key in context) ordered[key] = context[key];
  return ordered;
}

// Python json.dumps는 실수 1.0을 "1.0"으로 쓴다. 점수 필드만 실수이므로 그 자리만 맞춘다 (분류기 clf_v2 형식에서는 "점수")
const FLOAT_KEYS = new Set(["confidence", "점수"]);

/** json.dumps(context, ensure_ascii=False, separators=(",", ":"))와 같은 문자열 */
export function contextJson(context: CompactContext): string {
  const write = (value: unknown, key?: string): string => {
    if (typeof value === "number") {
      if (key && FLOAT_KEYS.has(key) && Number.isInteger(value)) return `${value}.0`;
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map((v) => write(v, key)).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${write(v, k)}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
  };
  return write(context);
}
