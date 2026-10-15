import { describe, expect, it } from "vitest";
import { validateImage } from "./validateImage";

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
