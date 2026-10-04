/** 백엔드 max_upload_mb(10)와 같은 기준. 넘으면 서버가 413으로 거절한다 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// image/jpg는 비표준이지만 일부 안드로이드 사진 선택기가 JPEG에 붙여 보낸다
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];

export type ImageValidation = { ok: true } | { ok: false; message: string };

/** 업로드 전에 형식·크기를 검사한다 (기능명세서 M02-F6, 문구는 카메라 기획서 7절) */
export function validateImage(file: File): ImageValidation {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, message: "JPEG·PNG만 올릴 수 있어요" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: "10MB 이하로 올려주세요" };
  }
  return { ok: true };
}
