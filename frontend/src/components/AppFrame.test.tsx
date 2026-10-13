import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeSpeech } from "@/features/voice/testing/fakeSpeech";
import { AppFrame } from "./AppFrame";
import { APP_NAV_ITEMS, currentNavKey } from "./appNav";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

beforeEach(() => {
  installFakeSpeech();
  localStorage.clear();
  delete document.documentElement.dataset.textsize;
  navigation.pathname = "/";
});

function currentLinks() {
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

describe("currentNavKey", () => {
  it.each([
    ["/", "diagnose"],
    ["/history", "history"],
    ["/history/abc", "history"],
    ["/historyx", undefined],
    ["/unknown", undefined],
    [null, undefined],
  ])("%s → %s", (pathname, key) => {
    expect(currentNavKey(pathname)).toBe(key);
  });

  it("내비 항목은 실제로 있는 화면만 가리킨다", () => {
    expect(APP_NAV_ITEMS.map((item) => [item.key, item.href])).toEqual([
      ["diagnose", "/"],
      ["history", "/history"],
    ]);
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

  it("홈에서는 헤더 내비와 하단 내비의 진단 항목이 현재 화면이다", () => {
    render(<AppFrame>화면</AppFrame>);

    expect(currentLinks()).toEqual(["새 진단", "진단"]);
  });

  it("이력 목록과 이력 상세에서는 이력 항목이 현재 화면이다", () => {
    navigation.pathname = "/history";
    const { unmount } = render(<AppFrame>화면</AppFrame>);
    expect(currentLinks()).toEqual(["진단 이력", "이력"]);
    unmount();

    navigation.pathname = "/history/abc";
    render(<AppFrame>화면</AppFrame>);
    expect(currentLinks()).toEqual(["진단 이력", "이력"]);
  });

  it("내비에 없는 경로에서는 현재 화면 표시가 없다", () => {
    navigation.pathname = "/unknown";
    render(<AppFrame>화면</AppFrame>);

    expect(currentLinks()).toEqual([]);
  });

  it("두 내비의 항목은 같은 곳으로 간다", () => {
    render(<AppFrame>화면</AppFrame>);

    for (const name of ["주요 메뉴", "하단 메뉴"]) {
      const links = within(screen.getByRole("navigation", { name })).getAllByRole("link");
      expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/history"]);
    }
  });

  it("로고는 홈으로 간다", () => {
    render(<AppFrame>화면</AppFrame>);

    expect(screen.getByRole("link", { name: "Cropy 홈" }).getAttribute("href")).toBe("/");
  });

  it("헤더에 기기 진단 링크와 큰글씨·음성 버튼이 있다", () => {
    render(<AppFrame>화면</AppFrame>);
    const header = within(screen.getByRole("banner"));

    expect(header.getByRole("link", { name: "기기 진단" }).getAttribute("href")).toBe(
      "/offline/index.html",
    );
    expect(header.getByRole("button", { name: /큰글씨/ })).toBeTruthy();
    expect(header.getByRole("button", { name: /음성/ })).toBeTruthy();
  });
});
