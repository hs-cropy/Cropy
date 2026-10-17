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

  it("JPEG·PNG 가 아니면 형식 때문이라고 거절한다", () => {
    expect(validateImage(imageOfSize(10, "image/gif"))).toMatchObject({
      ok: false,
      reason: "format",
    });
  });
});
