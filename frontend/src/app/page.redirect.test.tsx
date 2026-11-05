import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import HomePage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("루트 페이지 리다이렉트", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/ 접속 시 /splash로 리다이렉트한다", () => {
    HomePage();

    expect(redirect).toHaveBeenCalledExactlyOnceWith("/splash");
  });
});
