/**
 * 음성 질문 API 세 단계. 기능 선택 모델이 어디서 돌든 3단계의 입력은 같은 문자열이다.
 *
 *   1. transcribe      녹음(wav) → 문장                       POST /api/v1/voice/transcribe
 *   2. selectFunction  문장 + 화면 상태 → "<hs_N>(…)<hs_end>"  POST /api/v1/voice/select-function (서버 경유)
 *   3. answerFunction  호출 문자열 + 진단 → 답변 문장           POST /api/v1/voice/function-call
 *
 * 2단계는 기기에 따라 브라우저 안 모델(휴대폰 분류기, WebGPU PC 의 Qwen)로 바뀐다. 어느 쪽을 쓸지는 functionSelector.ts 가 고른다(#165).
 * 그때도 1·3단계는 그대로다.
 */

import { ApiError } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export type UiStage = "no_photo" | "photo_ready" | "analyzing" | "result" | "error";
// 호출 문자열을 고른 기능 선택기. mobile_clf 는 휴대폰(iPhone·안드로이드) 분류기다 (서버는 예전 이름 ios_clf 도 받는다)
export type FunctionCallSource = "server" | "web_qwen" | "mobile_clf" | "board_rkllm";

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

/** 진단 결과를 읽어 줄 문장(서버 speech_script). 음성 모드에서 방금 찍은 사진의 결과를 들려줄 때 쓴다 */
export async function fetchSpeechScript(diagnosisId: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(API_BASE + "/api/v1/diagnose/" + encodeURIComponent(diagnosisId) + "/speech/script", { signal });
  const body = await parse<{ sentences: string[]; text: string }>(res);
  return body.sentences;
}

export async function answerFunction(
  diagnosisId: string,
  functionCall: string,
  source: FunctionCallSource = "server",
  signal?: AbortSignal,
  uiStage?: UiStage,
): Promise<FunctionAnswer> {
  const res = await fetch(API_BASE + "/api/v1/voice/function-call", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ diagnosis_id: diagnosisId, function_call: functionCall, source, ui_stage: uiStage }),
  });
  return parse(res);
}
