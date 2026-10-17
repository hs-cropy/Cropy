/** 백엔드 max_upload_mb(10)와 같은 기준. 넘으면 서버가 413으로 거절한다 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// image/jpg는 비표준이지만 일부 안드로이드 사진 선택기가 JPEG에 붙여 보낸다
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];

/** 왜 거절했는지. 화면은 이 값으로 Figma 안내(photo-format·photo-size)를 고른다 */
export type ImageRejection = "format" | "size";

export type ImageValidation = { ok: true } | { ok: false; reason: ImageRejection; message: string };

/** 업로드 전에 형식·크기를 검사한다 (기능명세서 M02-F6, 문구는 카메라 기획서 7절) */
export function validateImage(file: File): ImageValidation {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, reason: "format", message: "JPEG·PNG만 올릴 수 있어요" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "size", message: "10MB 이하로 올려주세요" };
  }
  return { ok: true };
}
