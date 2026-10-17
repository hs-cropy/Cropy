import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { canRetrySave, feedbackForRejectedImage, feedbackForRequestError } from "./errors";

const api = (code: string, status: number) => new ApiError("", code, status, false);

describe("feedbackForRequestError", () => {
  it.each([
    ["UNSUPPORTED_IMAGE_FORMAT", 400, "photo-format"],
    ["IMAGE_TOO_LARGE", 413, "photo-size"],
    ["IMAGE_RESOLUTION_TOO_LARGE", 413, "photo-size"],
    ["REQUEST_TOO_LARGE", 413, "photo-size"],
    ["HTTP_ERROR", 413, "photo-size"],
    ["EMPTY_IMAGE", 400, "photo-read"],
    ["INVALID_IMAGE", 400, "photo-read"],
    ["HTTP_ERROR", 400, "photo-upload"],
    ["IDEMPOTENCY_CONFLICT", 409, "photo-upload"],
    ["VALIDATION_ERROR", 422, "photo-upload"],
    ["HTTP_ERROR", 500, "photo-upload"],
    ["MODEL_UNAVAILABLE", 503, "photo-upload"],
    ["DATABASE_UNAVAILABLE", 503, "photo-upload"],
    ["IMAGE_STORAGE_UNAVAILABLE", 503, "photo-upload"],
    ["RECOVERY_STORAGE_UNAVAILABLE", 503, "photo-upload"],
  ] as const)("진단: %s(%i) → %s", (code, status, caseId) => {
    expect(feedbackForRequestError(api(code, status), "diagnose")).toBe(caseId);
  });

  it.each([
    ["DIAGNOSIS_NOT_FOUND", 404, "record-unavailable"],
    ["NOT_FOUND", 404, "record-unavailable"],
    ["REFINEMENT_UNAVAILABLE", 400, "photo-upload"],
    ["MODEL_VERSION_CONFLICT", 409, "photo-upload"],
    ["INVALID_IMAGE", 400, "photo-read"],
  ] as const)("재촬영 다시 분석: %s(%i) → %s", (code, status, caseId) => {
    expect(feedbackForRequestError(api(code, status), "refine")).toBe(caseId);
  });

  it("서버에 닿지 못한 오류는 인터넷 연결 안내다", () => {
    expect(feedbackForRequestError(new TypeError("Failed to fetch"), "diagnose")).toBe(
      "analysis-offline",
    );
  });
});

describe("feedbackForRejectedImage", () => {
  it("형식은 photo-format, 용량은 photo-size", () => {
    expect(feedbackForRejectedImage("format")).toBe("photo-format");
    expect(feedbackForRejectedImage("size")).toBe("photo-size");
  });
});

describe("canRetrySave", () => {
  it.each([
    ["SAVE_FAILED", 503, true],
    ["DATABASE_UNAVAILABLE", 503, true],
    ["RECOVERY_STORAGE_UNAVAILABLE", 503, true],
    ["HTTP_ERROR", 500, true],
    ["RESULT_EXPIRED", 410, false],
    ["RESULT_NOT_FOUND", 404, false],
    ["DIAGNOSIS_CHANGED", 409, false],
  ] as const)("%s(%i) → %s", (code, status, retryable) => {
    expect(canRetrySave(api(code, status))).toBe(retryable);
  });

  it("연결이 끊겼으면 다시 저장할 수 있다", () => {
    expect(canRetrySave(new TypeError("Failed to fetch"))).toBe(true);
  });
});
