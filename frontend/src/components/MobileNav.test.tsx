import { createRef } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MobileNav } from "./MobileNav";
import type { NavItem } from "./navItem";

const ITEMS: NavItem[] = [
  { key: "capture", href: "/capture", label: "새 진단", mobileLabel: "촬영", icon: "icon-camera" },
  { key: "result", href: "/", label: "진단 결과", mobileLabel: "진단", icon: "icon-scan" },
  { key: "history", href: "/history", label: "진단 이력", icon: "icon-history" },
];

function nav() {
  return screen.getByRole("navigation", { name: "하단 메뉴" });
}

function links() {
  return within(nav()).getAllByRole("link") as HTMLAnchorElement[];
}

describe("MobileNav", () => {
  it("항목을 넘긴 순서대로 그리고 짧은 라벨이 있으면 그것을 쓴다", () => {
    render(<MobileNav items={ITEMS} />);

    // history 는 mobileLabel 이 없어 label 을 그대로 쓴다
    expect(links().map((link) => link.textContent)).toEqual(["촬영", "진단", "진단 이력"]);
  });

  it("각 항목은 넘겨받은 경로로 가는 링크다", () => {
    render(<MobileNav items={ITEMS} />);

    expect(links().map((link) => link.getAttribute("href"))).toEqual(["/capture", "/", "/history"]);
  });

  it("현재 화면에 해당하는 항목만 aria-current로 알린다", () => {
    const { rerender } = render(<MobileNav items={ITEMS} current="result" />);
    expect(links().map((link) => link.getAttribute("aria-current"))).toEqual([null, "page", null]);

    rerender(<MobileNav items={ITEMS} current="history" />);
    expect(links().map((link) => link.getAttribute("aria-current"))).toEqual([null, null, "page"]);
  });

  it("현재 화면이 없거나 항목에 없는 이름이면 아무것도 선택하지 않는다", () => {
    const { rerender } = render(<MobileNav items={ITEMS} />);
    expect(links().every((link) => !link.hasAttribute("aria-current"))).toBe(true);

    rerender(<MobileNav items={ITEMS} current="settings" />);
    expect(links().every((link) => !link.hasAttribute("aria-current"))).toBe(true);
  });

  it("아이콘은 읽지 않고 링크 이름은 라벨뿐이다", () => {
    render(<MobileNav items={ITEMS} current="capture" />);

    const link = within(nav()).getByRole("link", { name: "촬영" });
    const icon = link.querySelector("span") as HTMLElement;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.classList.contains("icon-camera")).toBe(true);
  });

  it("내비 이름을 바꿀 수 있고 ref·className·나머지 속성을 전달한다", () => {
    const ref = createRef<HTMLElement>();
    render(
      <MobileNav ref={ref} items={ITEMS} aria-label="주요 화면" className="sticky" id="tabs" />,
    );

    const element = screen.getByRole("navigation", { name: "주요 화면" });
    expect(ref.current).toBe(element);
    expect(element.classList.contains("sticky")).toBe(true);
    expect(element.id).toBe("tabs");
  });

  it("항목이 없어도 그릴 수 있다", () => {
    render(<MobileNav items={[]} />);

    expect(within(nav()).queryAllByRole("link")).toEqual([]);
  });
});

// 디자인 시스템(Cropy/V2/Navigation/Mobile) 사양표. 값이 바뀌면 디자인과 어긋난 것이므로
// 클래스 이름까지 고정한다
describe("MobileNav — 디자인 시스템 사양", () => {
  it("흰 배경이고 홈 인디케이터만큼 아래를 띄운다. 넓은 화면에서 숨기는 일은 쓰는 쪽이 한다", () => {
    render(<MobileNav items={ITEMS} />);

    expect(Array.from(nav().classList)).toEqual(
      expect.arrayContaining(["bg-cropy-surface", "pb-[env(safe-area-inset-bottom)]"]),
    );
    expect(nav().classList.contains("md:hidden")).toBe(false);
  });

  it("높이 72px에 좌우 24px·상하 8px 여백이고 항목은 폭을 똑같이 나눈다", () => {
    render(<MobileNav items={ITEMS} />);
    const list = within(nav()).getByRole("list");

    expect(Array.from(list.classList)).toEqual(
      expect.arrayContaining(["h-[4.5rem]", "px-6", "py-2", "flex"]),
    );
    expect(
      within(list)
        .getAllByRole("listitem")
        .every((item) => item.classList.contains("flex-1")),
    ).toBe(true);
  });

  it("항목은 높이 56px에 아이콘 24px, 라벨 12px이다", () => {
    render(<MobileNav items={ITEMS} />);
    const link = links()[0];

    expect(Array.from(link.classList)).toEqual(
      expect.arrayContaining(["h-14", "flex-col", "gap-1", "text-cropy-label-xs"]),
    );
    expect(Array.from((link.querySelector("span") as HTMLElement).classList)).toEqual(
      expect.arrayContaining(["h-6", "w-6"]),
    );
  });

  it("선택된 항목은 초록 Bold, 나머지는 회색 Medium이다. 글자 크기와 서로 지우지 않는다", () => {
    render(<MobileNav items={ITEMS} current="capture" />);
    const [selected, other] = links();

    expect(Array.from(selected.classList)).toEqual(
      expect.arrayContaining(["font-bold", "text-cropy-action-primary", "text-cropy-label-xs"]),
    );
    expect(Array.from(other.classList)).toEqual(
      expect.arrayContaining(["font-medium", "text-cropy-text-secondary", "text-cropy-label-xs"]),
    );
    expect(other.classList.contains("text-cropy-action-primary")).toBe(false);
  });
});
