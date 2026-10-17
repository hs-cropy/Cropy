import { ApiError } from "@/lib/api";
import type { ImageRejection } from "@/features/camera";
import type { FeedbackCaseId } from "./cases";

/** 어떤 요청이 실패했는지. 같은 오류 코드라도 요청마다 맞는 안내가 다르다 */
export type FailedRequest = "diagnose" | "refine";

// 백엔드 API 명세(오류 응답의 code)와 Figma 의 지속형 안내(Cropy/FeedbackV3/inline/*)를 잇는다.
// 명세에 있지만 Figma 에 맞는 안내가 없는 서버 쪽 오류(모델·DB·저장소 사용 불가, 요청 키 충돌,
// 처리하지 못한 오류 등)는 "사진을 보내지 못했어요"로 모은다. 사진은 그대로 두고 다시 보낼 수 있다
const PHOTO_CASES: Record<string, FeedbackCaseId> = {
  UNSUPPORTED_IMAGE_FORMAT: "photo-format",
  IMAGE_TOO_LARGE: "photo-size",
  IMAGE_RESOLUTION_TOO_LARGE: "photo-size",
  REQUEST_TOO_LARGE: "photo-size",
  EMPTY_IMAGE: "photo-read",
  INVALID_IMAGE: "photo-read",
};

// 재촬영 다시 분석에서 처음 진단 기록이 없어졌을 때
const MISSING_RECORD = new Set(["DIAGNOSIS_NOT_FOUND", "NOT_FOUND"]);

// 저장을 다시 해도 소용없는 오류: 보관 시간이 지났거나(410) 결과를 찾을 수 없거나(404)
// 결과가 바뀌었다(409). 나머지(SAVE_FAILED, DB·저장소 사용 불가 등)는 다시 저장할 수 있다
const FINAL_SAVE_ERRORS = new Set(["RESULT_EXPIRED", "RESULT_NOT_FOUND", "DIAGNOSIS_CHANGED"]);
const FINAL_SAVE_STATUS = new Set([404, 409, 410]);

/** 업로드 전 검사에서 거절한 사진의 안내 */
export function feedbackForRejectedImage(reason: ImageRejection): FeedbackCaseId {
  return reason === "format" ? "photo-format" : "photo-size";
}

/**
 * 진단·재촬영 다시 분석 요청이 실패했을 때 보일 안내.
 * 서버에 닿지 못했으면(오프라인·연결 끊김) 인터넷 연결 안내를 보인다
 */
export function feedbackForRequestError(error: unknown, request: FailedRequest): FeedbackCaseId {
  if (!(error instanceof ApiError)) return "analysis-offline";
  const photoCase = PHOTO_CASES[error.code];
  if (photoCase) return photoCase;
  // 프록시가 본문 없이 413 을 돌려주면 코드가 HTTP_ERROR 다
  if (error.status === 413) return "photo-size";
  if (request === "refine" && (MISSING_RECORD.has(error.code) || error.status === 404)) {
    return "record-unavailable";
  }
  return "photo-upload";
}

/** 결과 저장이 실패했을 때 "다시 저장"으로 다시 해 볼 만한지 */
export function canRetrySave(error: unknown) {
  if (!(error instanceof ApiError)) return true;
  return !FINAL_SAVE_ERRORS.has(error.code) && !FINAL_SAVE_STATUS.has(error.status);
}
