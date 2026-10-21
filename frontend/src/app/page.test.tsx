import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeSpeech } from "@/features/voice/testing/fakeSpeech";
import { DiagnosisSessionProvider } from "@/components/diagnosis/DiagnosisSession";
import Page from "./page";

vi.mock("next/navigation", async () => (await import("@/testing/fakeNavigation")).nextNavigation);

// 앱에서는 앱 틀(AppFrame)이 진단 상태를 준다
function HomePage() {
  return (
    <DiagnosisSessionProvider>
      <Page />
    </DiagnosisSessionProvider>
  );
}

// 촬영 화면의 최근 진단 카드가 부른다. 기록이 없으면 카드를 그리지 않는다
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchHistory: vi.fn(() =>
    Promise.resolve({ items: [], total: 0, page: 1, size: 1, unfiltered_total: 0, crop_total: 0 }),
  ),
}));

beforeEach(() => {
  installFakeSpeech();
});

describe("HomePage", () => {
  it("기기 안에서 진단하는 페이지로 가는 링크가 있다 (앱에서 그 페이지로 가는 유일한 길)", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("link", { name: "인터넷 없이 기기에서 진단하기" }).getAttribute("href"),
    ).toBe("/offline/index.html");
  });

  it("서버 HTML 에 촬영 화면의 제목과 하단 버튼이 들어 있다 (새로고침 때 뒤늦게 끼어들지 않게)", () => {
    const html = renderToString(<HomePage />);

    expect(html).toMatch(/<h1[^>]*>사진으로 작물 진단<\/h1>/);
    expect(html).toContain('aria-label="화면 행동"');
    expect(html).toContain("사진 선택하기");
    expect(html).toContain("카메라로 촬영");
  });

  it("서버 HTML 은 화면 폭을 몰라 모바일·데스크탑 촬영 화면을 둘 다 담고 CSS 로 하나만 보인다", () => {
    const html = renderToString(<HomePage />);

    // 모바일(M-01-0 사진 선택)은 lg 부터 숨고, 데스크탑(D-01 사진 업로드)은 lg 부터 보인다
    expect(html).toMatch(/class="lg:hidden"><div[^>]*>[\s\S]*?사진으로 작물 진단/);
    expect(html).toMatch(
      /class="hidden lg:block"><div[^>]*>[\s\S]*?사진으로 작물 상태를 확인하세요/,
    );
    expect(html).toContain("사진 선택하기");
    expect(html).toContain("카메라로 촬영");
    // 숨겨진 쪽 마스코트는 받지 않게 lazy 로 둔다
    expect(html).not.toMatch(/<img(?![^>]*loading="lazy")[^>]*src="\/mascot\//);
  });

  it("브라우저에서는 화면 폭에 맞는 한 쪽만 그린다 (큰 제목 하나)", () => {
    render(<HomePage />);

    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "사진으로 작물 진단",
    ]);
    expect(screen.queryByText("사진으로 작물 상태를 확인하세요")).toBeNull();
  });

  it("화면은 main 안의 스크롤 영역에 들어가고 큰 제목은 하나다", () => {
    render(<HomePage />);
    const region = screen.getByRole("region", { name: "진단하기" });

    expect(screen.getByRole("main").contains(region)).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
