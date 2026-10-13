import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeSpeech } from "@/features/voice/testing/fakeSpeech";
import HistoryPage from "@/app/history/page";
import { fetchHistory } from "@/lib/api";
import { AppFrame } from "./AppFrame";
import { APP_NAV_ITEMS, currentNavKey } from "./appNav";
import { LegacyPage } from "./LegacyPage";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
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
    ["/", "capture"],
    ["/history", "history"],
    ["/history/abc", "history"],
    ["/historyx", undefined],
    ["/unknown", undefined],
    [null, undefined],
  ])("%s → %s", (pathname, key) => {
    expect(currentNavKey(pathname)).toBe(key);
  });

  it("내비 항목은 Figma 의 세 개다. 자기 화면이 없는 진단 결과는 누를 수 없다", () => {
    expect(APP_NAV_ITEMS.map((item) => [item.key, item.disabled ? null : item.href])).toEqual([
      ["capture", "/"],
      ["result", null],
      ["history", "/history"],
    ]);
  });

  it("헤더와 모바일 하단의 라벨이 Figma 와 같다", () => {
    expect(APP_NAV_ITEMS.map((item) => item.label)).toEqual(["새 진단", "진단 결과", "진단 이력"]);
    expect(APP_NAV_ITEMS.map((item) => item.mobileLabel)).toEqual(["촬영", "진단", "이력"]);
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
      expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", null, "/history"]);
    }
  });

  it("로고는 홈으로 간다", () => {
    render(<AppFrame>화면</AppFrame>);

    expect(screen.getByRole("link", { name: "Cropy 홈" }).getAttribute("href")).toBe("/");
  });

  it("헤더 오른쪽에는 큰 글자·음성 안내 스위치만 있다", () => {
    render(<AppFrame>화면</AppFrame>);
    const header = within(screen.getByRole("banner"));

    expect(header.getAllByRole("switch")).toHaveLength(2);
    expect(header.getByRole("switch", { name: "큰 글자" })).toBeTruthy();
    expect(header.getByRole("switch", { name: "음성 안내" })).toBeTruthy();
    expect(header.queryByRole("button")).toBeNull();
    // 로고와 내비 항목 말고는 링크가 없다 (기기 진단 링크는 진단 화면 본문으로 옮겼다)
    expect(header.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/",
      null,
      "/history",
    ]);
  });

  it("넓은 데스크탑에서 스위치는 Figma 의 고정 폭을 쓴다", () => {
    render(<AppFrame>화면</AppFrame>);

    expect(Array.from(screen.getByRole("switch", { name: "큰 글자" }).classList)).toContain(
      "xl:w-28",
    );
    expect(Array.from(screen.getByRole("switch", { name: "음성 안내" }).classList)).toContain(
      "xl:w-[8.25rem]",
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
    await screen.findByText("아직 진단 기록이 없어요");

    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("화면을 옮기면 초점을 그 화면의 본문으로 보낸다. 처음 열 때는 옮기지 않는다", () => {
    const { rerender } = render(
      <AppFrame>
        <LegacyPage scrollLabel="진단하기">홈</LegacyPage>
      </AppFrame>,
    );
    expect(document.activeElement).toBe(document.body);

    screen.getByRole("link", { name: "이력" }).focus();
    navigation.pathname = "/history";
    rerender(
      <AppFrame>
        <LegacyPage scrollLabel="진단 이력">이력</LegacyPage>
      </AppFrame>,
    );

    expect(document.activeElement).toBe(screen.getByRole("region", { name: "진단 이력" }));
  });

  it("경로가 그대로면 다시 그려도 초점을 건드리지 않는다", () => {
    const { rerender } = render(
      <AppFrame>
        <LegacyPage scrollLabel="진단하기">홈</LegacyPage>
      </AppFrame>,
    );
    const voice = screen.getByRole("switch", { name: "음성 안내" });
    voice.focus();
    rerender(
      <AppFrame>
        <LegacyPage scrollLabel="진단하기">홈</LegacyPage>
      </AppFrame>,
    );

    expect(document.activeElement).toBe(voice);
  });
});
