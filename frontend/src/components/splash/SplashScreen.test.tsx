import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplashScreen } from "./SplashScreen";

describe("SplashScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("앱 설치하기는 인터넷 없이도 열리는 설치 안내 페이지로 간다", () => {
    // 문구 타이핑을 건너뛰게 애니메이션 감소 설정으로 연다
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<SplashScreen />);
    expect(screen.getByRole("link", { name: "앱 설치하기" }).getAttribute("href")).toBe(
      "/offline/install.html",
    );
  });
});
