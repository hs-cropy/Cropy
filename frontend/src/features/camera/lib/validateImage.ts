/** 백엔드 기본 max_upload_mb(100)와 같은 기준. 실제 한도는 서버가 검증한다. */
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/heic,image/heif,image/x-adobe-dng,image/webp,image/avif,.jpg,.jpeg,.png,.heic,.heif,.dng,.webp,.avif";

// image/jpg는 비표준이지만 일부 안드로이드 사진 선택기가 JPEG에 붙여 보낸다
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif", "image/x-adobe-dng", "image/dng", "image/webp", "image/avif"];

/** 왜 거절했는지. 화면은 이 값으로 Figma 안내(photo-format·photo-size)를 고른다 */
export type ImageRejection = "format" | "size";

export type ImageValidation = { ok: true } | { ok: false; reason: ImageRejection; message: string };

/** 업로드 전에 형식·크기를 검사한다 (기능명세서 M02-F6, 문구는 카메라 기획서 7절) */
export function validateImage(file: File): ImageValidation {
  const type = file.type.toLowerCase();
  const unknownType = type === "" || type === "application/octet-stream";
  const photoExtension = /\.(jpe?g|png|heic|heif|dng|webp|avif)$/i.test(file.name);
  // 일부 모바일 사진 선택기는 HEIC/RAW 에 MIME 을 붙이지 않는다. 실제 내용은 서버가 검증한다
  if (!ALLOWED_TYPES.includes(type) && !(unknownType && photoExtension)) {
    return { ok: false, reason: "format", message: "JPG·PNG·HEIC/HEIF·DNG·WebP·AVIF 사진을 선택해 주세요" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "size", message: "100MB 이하로 올려주세요" };
  }
  return { ok: true };
}
