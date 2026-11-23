import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTALLED_QUERY } from "@/hooks/useInstalledApp";
import { SplashScreen } from "./SplashScreen";

// 문구 타이핑을 건너뛰게 애니메이션 감소 설정으로 열고, 설치 앱 여부는 installed 로 정한다
function stubMedia(installed: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === INSTALLED_QUERY ? installed : true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("SplashScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("앱 설치하기는 인터넷 없이도 열리는 설치 안내 페이지로 간다", () => {
    stubMedia(false);
    render(<SplashScreen />);
    expect(screen.getByRole("link", { name: "앱 설치하기" }).getAttribute("href")).toBe(
      "/offline/install.html",
    );
  });

  it("설치한 앱으로 열면 앱 설치하기가 없고 시작하기만 있다", () => {
    stubMedia(true);
    render(<SplashScreen />);
    expect(screen.queryByRole("link", { name: "앱 설치하기" })).toBeNull();
    expect(screen.getByRole("link", { name: "시작하기" })).toBeTruthy();
  });

  it("iOS 홈 화면 앱(navigator.standalone)도 설치한 앱으로 본다", () => {
    stubMedia(false);
    vi.stubGlobal("navigator", { ...navigator, standalone: true });
    render(<SplashScreen />);
    expect(screen.queryByRole("link", { name: "앱 설치하기" })).toBeNull();
  });

  it("서버 HTML 은 설치 여부를 몰라 버튼을 담고, CSS 미디어 쿼리가 설치 앱에서 숨긴다", () => {
    const html = renderToString(<SplashScreen />);
    expect(html).toContain("앱 설치하기");
  });
});
