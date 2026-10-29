
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplashScreen } from "./SplashScreen";
import { afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SplashScreen", () => {
  it("스플래시 화면과 로고를 렌더링한다", () => {
    render(<SplashScreen />);

    expect(screen.getByRole("main")).toBeTruthy();

    const logo = screen.getByRole("img", { name: "Cropy" });
    expect(logo.getAttribute("src")).toBe(
      "/brand/cropy-splash-logo.svg",
    );
  });

  it("시작하기 버튼은 촬영 화면으로 이동한다", () => {
    render(<SplashScreen />);

    const link = screen.getByRole("link", {
      name: "시작하기",
    });

    expect(link.getAttribute("href")).toBe("/home");
  });

  it("브랜드 문구를 스크린리더에 제공한다", () => {
    const { container } = render(<SplashScreen />);

    const accessibleTagline = container.querySelector(
      "p.sr-only",
    );

    expect(accessibleTagline).not.toBeNull();
    expect(accessibleTagline?.textContent?.trim()).not.toBe("");
  });

    it("앱 설치하기 버튼을 표시한다", () => {
    render(<SplashScreen />);

    expect(
        screen.getByRole("button", { name: "앱 설치하기" }),
    ).toBeTruthy();
    });
});
