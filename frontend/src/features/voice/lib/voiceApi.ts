/**
 * 음성 질문 API 세 단계. 기능 선택 모델이 어디서 돌든 3단계의 입력은 같은 문자열이다.
 *
 *   1. transcribe      녹음(wav) → 문장                       POST /api/v1/voice/transcribe
 *   2. selectFunction  문장 + 화면 상태 → "<hs_N>(…)<hs_end>"  POST /api/v1/voice/select-function (서버 경유)
 *   3. answerFunction  호출 문자열 + 진단 → 답변 문장           POST /api/v1/voice/function-call
 *
 * 2단계는 기기에 따라 브라우저 안 모델(아이폰 분류기, PC·안드로이드 Qwen)로 바뀐다(#165). 그때도 1·3단계는 그대로다.
 */

import { ApiError } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export type UiStage = "no_photo" | "photo_ready" | "analyzing" | "result" | "error";
export type FunctionCallSource = "server" | "web_qwen" | "ios_clf" | "board_rkllm";

export interface FunctionAnswer {
  function_name: string;
  status: "ok" | "insufficient_information" | "needs_clarification" | "unsupported_scope";
  text: string;
}

export interface SelectedFunction {
  function_call: string;
  context: Record<string, unknown>;
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(typeof body.detail === "string" ? body.detail : "요청 처리에 실패했습니다.",
      body.code || "HTTP_ERROR", res.status, body.retryable ?? false, body.request_id);
  }
  return res.json();
}

export async function transcribe(wav: Blob, signal?: AbortSignal): Promise<string> {
  const res = await fetch(API_BASE + "/api/v1/voice/transcribe", {
    method: "POST", body: wav, headers: { "Content-Type": "audio/wav" }, signal,
  });
  const body = await parse<{ text: string }>(res);
  return body.text;
}

export async function selectFunction(
  utterance: string,
  screen: { diagnosisId: string | null; uiStage: UiStage },
  signal?: AbortSignal,
): Promise<SelectedFunction> {
  const res = await fetch(API_BASE + "/api/v1/voice/select-function", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ utterance, diagnosis_id: screen.diagnosisId ?? undefined, ui_stage: screen.uiStage }),
  });
  return parse(res);
}

export async function answerFunction(
  diagnosisId: string,
  functionCall: string,
  source: FunctionCallSource = "server",
  signal?: AbortSignal,
): Promise<FunctionAnswer> {
  const res = await fetch(API_BASE + "/api/v1/voice/function-call", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ diagnosis_id: diagnosisId, function_call: functionCall, source }),
  });
  return parse(res);
}
