import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeSpeech } from "@/features/voice/testing/fakeSpeech";
import HistoryPage from "@/app/history/page";
import { fetchHistory } from "@/lib/api";
import { AppFrame } from "./AppFrame";
import { AppShellPage } from "./AppShell";
import { APP_NAV_ITEMS, currentNavKey } from "./appNav";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ fetchHistory: vi.fn() }));

beforeEach(() => {
  installFakeSpeech();
  localStorage.clear();
  delete document.documentElement.dataset.textsize;
  navigation.pathname = "/";
});

// 헤더 내비와 하단 내비에서 현재 화면으로 표시된 항목
function currentLinks() {
  return ["주요 메뉴", "하단 메뉴"].map((name) =>
    within(screen.getByRole("navigation", { name }))
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.textContent),
  );
}

describe("currentNavKey", () => {
  it.each([
    ["/home", "capture"],
    ["/diagnosis", "result"],
    ["/history", "history"],
    ["/history/abc", "history"],
    ["/historyx", undefined],
    ["/unknown", undefined],
    [null, undefined],
  ])("%s → %s", (pathname, key) => {
    expect(currentNavKey(pathname)).toBe(key);
  });

  it("내비 항목은 Figma 의 세 개다. 진단 결과는 진단 결과 화면(/diagnosis)으로 간다", () => {
    expect(APP_NAV_ITEMS.map((item) => [item.key, item.disabled ? null : item.href])).toEqual([
      ["capture", "/home"],
      ["result", "/diagnosis"],
      ["history", "/history"],
    ]);
  });

  it("헤더와 모바일 하단의 라벨이 Figma 와 같다", () => {
    expect(APP_NAV_ITEMS.map((item) => item.label)).toEqual(["새 진단", "진단 결과", "진단 이력"]);
    expect(APP_NAV_ITEMS.map((item) => item.mobileLabel)).toEqual(["촬영", "진단", "이력"]);
  });

  it("헤더 아이콘은 모바일과 같은 아이콘의 20px 용 굵은 선 세트다 (이름이 어긋나면 아이콘이 사라진다)", () => {
    for (const item of APP_NAV_ITEMS) {
      expect(item.icon).toMatch(/^icon-\[lucide--[a-z0-9-]+\]$/);
      expect(item.headerIcon).toBe(item.icon.replace("lucide--", "lucide-20--"));
    }
  });

  it("자기 화면이 없는 진단 결과는 어느 경로에서도 현재 화면이 아니다", () => {
    for (const pathname of ["/", "/history", "/history/abc", "/unknown"]) {
      expect(currentNavKey(pathname)).not.toBe("result");
    }
  });
});

describe("AppFrame", () => {
  it("헤더·화면·하단 내비·푸터를 이 순서로 그린다", () => {
    render(
      <AppFrame>
        <main>화면</main>
      </AppFrame>,
    );
    const header = screen.getByRole("banner");
    const main = screen.getByRole("main");
    const nav = screen.getByRole("navigation", { name: "하단 메뉴" });
    const footer = screen.getByRole("contentinfo");

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(header, main)).toBe(true);
    expect(follows(main, nav)).toBe(true);
    expect(follows(nav, footer)).toBe(true);
  });

  it("홈에서는 헤더 내비의 새 진단과 하단 내비의 촬영이 현재 화면이다", () => {
    navigation.pathname = "/home";
    render(<AppFrame>화면</AppFrame>);

    expect(currentLinks()).toEqual([["새 진단"], ["촬영"]]);
  });

  it("이력 목록과 이력 상세에서는 이력 항목이 현재 화면이다", () => {
    navigation.pathname = "/history";
    const { unmount } = render(<AppFrame>화면</AppFrame>);
    expect(currentLinks()).toEqual([["진단 이력"], ["이력"]]);
    unmount();

    navigation.pathname = "/history/abc";
    render(<AppFrame>화면</AppFrame>);
    expect(currentLinks()).toEqual([["진단 이력"], ["이력"]]);
  });

  it("내비에 없는 경로에서는 현재 화면 표시가 없다", () => {
    navigation.pathname = "/unknown";
    render(<AppFrame>화면</AppFrame>);

    expect(currentLinks()).toEqual([[], []]);
  });

  it("두 내비의 항목은 같은 곳으로 간다", () => {
    render(<AppFrame>화면</AppFrame>);

    for (const name of ["주요 메뉴", "하단 메뉴"]) {
      const links = within(screen.getByRole("navigation", { name })).getAllByRole("link");
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        "/home",
        "/diagnosis",
        "/history",
      ]);
    }
  });

  it("로고는 홈으로 간다", () => {
    render(<AppFrame>화면</AppFrame>);

    expect(screen.getByRole("link", { name: "Cropy 홈" }).getAttribute("href")).toBe("/home");
  });

  it("헤더 오른쪽에는 큰 글자·모바일 음성 모드·데스크톱 음성 안내 스위치가 잇다", () => {
    render(<AppFrame>화면</AppFrame>);
    const header = within(screen.getByRole("banner"));
    expect(header.getAllByRole("switch")).toHaveLength(3);

    expect(
      header.getByRole("switch", { name: /큰 글자/ }),
    ).toBeTruthy();

    expect(
      header.getByRole("switch", { name: "음성 모드" }),
    ).toBeTruthy();

    expect(
      header.getByRole("switch", { name: "음성 안내" }),
    ).toBeTruthy();
    expect(header.queryByRole("button")).toBeNull();
    // 로고와 내비 항목 말고는 링크가 없다 (기기 진단 링크는 진단 화면 본문으로 옮겼다)
    expect(header.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/home",
      "/home",
      "/diagnosis",
      "/history",
    ]);
  });

  it("모바일은 음성 모드, 데스크톱은 기존 TTS 토글을 표시하도록 구분한다", () => {
    render(<AppFrame>화면</AppFrame>);

    const mobileVoice = screen.getByRole("switch", {
      name: "음성 모드",
    });

    const desktopVoice = screen.getByRole("switch", {
      name: "음성 안내",
    });

    expect(mobileVoice.closest(".lg\\:hidden")).not.toBeNull();

    const desktopWrapper = desktopVoice.closest(".lg\\:block");
    expect(desktopWrapper).not.toBeNull();
    expect(desktopWrapper?.classList.contains("hidden")).toBe(true);
  });

  it("헤더 스위치는 Figma 크기를 쓴다: 모바일 90px, 넓은 데스크탑 132px·좌우 15px·양끝 정렬", () => {
    render(<AppFrame>화면</AppFrame>);

    const textSize = screen.getByRole("switch", {
      name: /큰 글자/,
    });

    expect(Array.from(textSize.classList)).toEqual(
      expect.arrayContaining([
        "min-w-[5.625rem]",
        "[[data-textsize=large]_&]:min-w-0",
        "xl:w-[8.25rem]",
        "xl:justify-between",
        "xl:gap-3",
        "xl:px-[0.9375rem]",
      ]),
    );
  });

  it("실제 화면을 넣어도 main 은 하나다", async () => {
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      size: 20,
      unfiltered_total: 0,
      crop_total: 0,
    });

    navigation.pathname = "/history";

    render(
      <AppFrame>
        <HistoryPage />
      </AppFrame>,
    );

    // 실제 진단 이력 화면이 렌더링되었는지 확인
    await screen.findByRole("heading", {
      name: "진단 이력",
    });

    // AppFrame과 HistoryPage를 함께 사용해도 main은 하나
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("화면을 옮기면 초점을 그 화면의 본문으로 보낸다. 처음 열 때는 옮기지 않는다", () => {
    const { rerender } = render(
      <AppFrame>
        <AppShellPage scrollLabel="진단하기">홈</AppShellPage>
      </AppFrame>,
    );
    expect(document.activeElement).toBe(document.body);

    screen.getByRole("link", { name: "이력" }).focus();
    navigation.pathname = "/history";
    rerender(
      <AppFrame>
        <AppShellPage scrollLabel="진단 이력">이력</AppShellPage>
      </AppFrame>,
    );

    expect(document.activeElement).toBe(screen.getByRole("region", { name: "진단 이력" }));
  });

  it("경로가 그대로면 다시 그려도 초점을 건드리지 않는다", () => {
    const { rerender } = render(
      <AppFrame>
        <AppShellPage scrollLabel="진단하기">홈</AppShellPage>
      </AppFrame>,
    );
    const voice = screen.getByRole("switch", { name: "음성 모드" });
    voice.focus();
    rerender(
      <AppFrame>
        <AppShellPage scrollLabel="진단하기">홈</AppShellPage>
      </AppFrame>,
    );

    expect(document.activeElement).toBe(voice);
  });
});
