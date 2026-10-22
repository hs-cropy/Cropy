import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateImage } from "./validateImage";

function imageOfSize(size: number, type = "image/jpeg") {
  const file = new File(["x"], "leaf.jpg", { type });
  // 실제로 큰 파일을 만들지 않고 크기만 바꾼다
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateImage", () => {
  it("한도까지는 올릴 수 있다", () => {
    expect(validateImage(imageOfSize(MAX_IMAGE_BYTES))).toEqual({ ok: true });
  });

  it("한도를 넘으면 용량 때문이라고 돌려준다", () => {
    expect(validateImage(imageOfSize(MAX_IMAGE_BYTES + 1))).toMatchObject({
      ok: false,
      reason: "size",
    });
  });

  it("지원하는 사진 형식이 아니면 형식 때문이라고 거절한다", () => {
    expect(validateImage(imageOfSize(10, "image/gif"))).toMatchObject({
      ok: false,
      reason: "format",
    });
  });
});

describe("mobile photo selection", () => {
  it.each([
    ["phone.HEIC", "image/heic"], ["phone.heif", "image/heif"],
    ["phone.DNG", "image/x-adobe-dng"], ["phone.dng", "application/octet-stream"],
    ["phone.heic", ""], ["phone.avif", "image/avif"], ["phone.webp", "image/webp"],
    ["phone.jpg", "image/jpeg"], ["phone.png", "image/png"],
  ])("allows %s with %s for server validation", (name, type) => {
    expect(validateImage(new File(["photo"], name, { type }))).toEqual({ ok: true });
  });
  it("rejects a document even with a photo extension", () => {
    expect(validateImage(new File(["<svg/>"], "photo.heic", { type: "image/svg+xml" })).ok).toBe(false);
  });
  it("rejects unidentified non-photo files", () => {
    expect(validateImage(new File(["data"], "document.bin", { type: "application/octet-stream" })).ok).toBe(false);
  });
  it("allows a 75 MiB ProRAW but rejects more than 100 MiB", () => {
    const file = new File([], "photo.dng", { type: "image/x-adobe-dng" });
    Object.defineProperty(file, "size", { value: 75 * 1024 * 1024, configurable: true });
    expect(validateImage(file).ok).toBe(true);
    Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 + 1 });
    expect(validateImage(file).ok).toBe(false);
  });
});
