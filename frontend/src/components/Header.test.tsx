import { createRef } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./Header";
import type { NavItem } from "./navItem";
import { Switch } from "./Switch";

const ITEMS: NavItem[] = [
  { key: "capture", href: "/capture", label: "새 진단", mobileLabel: "촬영", icon: "icon-camera" },
  { key: "result", href: "/", label: "진단 결과", mobileLabel: "진단", icon: "icon-scan" },
  {
    key: "history",
    href: "/history",
    label: "진단 이력",
    mobileLabel: "이력",
    icon: "icon-history",
  },
];

function nav() {
  return screen.getByRole("navigation", { name: "주요 메뉴" });
}

function navLinks() {
  return within(nav()).getAllByRole("link") as HTMLAnchorElement[];
}

describe("Header", () => {
  it("항목을 누르면 그 항목을 알린다. 이동은 링크가 그대로 한다", async () => {
    const onItemClick = vi.fn((_item: NavItem, event: { preventDefault: () => void }) =>
      // jsdom 은 페이지를 옮기지 못한다
      event.preventDefault(),
    );
    render(<Header items={ITEMS} onItemClick={onItemClick} />);

    await userEvent.click(within(nav()).getByRole("link", { name: "진단 이력" }));

    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick.mock.calls[0][0]).toBe(ITEMS[2]);
    expect(navLinks()[2].getAttribute("href")).toBe("/history");
  });

  it("누를 수 없는 항목과 로고는 알리지 않는다", async () => {
    const onItemClick = vi.fn();
    render(
      <Header
        items={[ITEMS[0], { ...ITEMS[1], disabled: true }]}
        homeHref="#home"
        onItemClick={onItemClick}
      />,
    );

    await userEvent.click(within(nav()).getByRole("link", { name: "진단 결과" }));
    await userEvent.click(screen.getByRole("link", { name: "Cropy 홈" }));

    expect(onItemClick).not.toHaveBeenCalled();
  });

  it("로고를 그린다. 갈 곳을 주지 않으면 링크가 아니다", () => {
    render(<Header />);

    expect(screen.getByRole("img", { name: "Cropy" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("갈 곳을 주면 로고가 홈 링크가 되고 이름을 한 번만 읽는다", () => {
    render(<Header homeHref="/" />);

    const home = screen.getByRole("link", { name: "Cropy 홈" }) as HTMLAnchorElement;
    expect(home.getAttribute("href")).toBe("/");
    // 링크가 이름을 갖고 있으므로 안의 이미지는 장식으로 둔다
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("항목을 넘긴 순서대로 긴 라벨로 그린다", () => {
    render(<Header items={ITEMS} />);

    expect(navLinks().map((link) => link.textContent)).toEqual([
      "새 진단",
      "진단 결과",
      "진단 이력",
    ]);
    expect(navLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/capture",
      "/",
      "/history",
    ]);
  });

  it("항목이 없으면 내비를 그리지 않는다", () => {
    render(<Header />);

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("현재 화면에 해당하는 항목만 aria-current로 알린다", () => {
    const { rerender } = render(<Header items={ITEMS} current="capture" />);
    expect(navLinks().map((link) => link.getAttribute("aria-current"))).toEqual([
      "page",
      null,
      null,
    ]);

    rerender(<Header items={ITEMS} current="settings" />);
    expect(navLinks().every((link) => !link.hasAttribute("aria-current"))).toBe(true);
  });

  it("아이콘은 읽지 않고 링크 이름은 라벨뿐이다", () => {
    render(<Header items={ITEMS} />);

    const icon = within(nav()).getByRole("link", { name: "새 진단" }).querySelector("span");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.classList.contains("icon-camera")).toBe(true);
  });

  it("오른쪽 자리에 넘겨받은 것을 그대로 그린다", () => {
    render(
      <Header
        actions={
          <>
            <Switch checked={false}>큰 글자</Switch>
            <Switch checked aria-label="음성 안내">
              음성
            </Switch>
          </>
        }
      />,
    );

    expect(screen.getByRole("switch", { name: "큰 글자" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.getByRole("switch", { name: "음성 안내" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("이름을 바꿀 수 있고 ref·className·나머지 속성을 전달한다", () => {
    const ref = createRef<HTMLElement>();
    render(
      <Header
        ref={ref}
        items={ITEMS}
        homeHref="/"
        homeLabel="처음으로"
        navLabel="화면 이동"
        className="sticky"
        id="top"
      />,
    );

    expect(screen.getByRole("link", { name: "처음으로" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "화면 이동" })).toBeTruthy();
    expect(ref.current?.tagName).toBe("HEADER");
    expect(ref.current?.classList.contains("sticky")).toBe(true);
    expect(ref.current?.id).toBe("top");
  });
});

// 디자인 시스템(Cropy/V2/Mobile/Header, Cropy/V2/Desktop/Header) 사양표.
// 값이 바뀌면 디자인과 어긋난 것이므로 클래스 이름까지 고정한다
describe("Header — 디자인 시스템 사양", () => {
  it("배경이 없어 틀의 배경이 비친다 (화면이 디자인 시스템보다 우선). 필요하면 className 으로 준다", () => {
    const ref = createRef<HTMLElement>();
    const { rerender } = render(<Header ref={ref} />);

    expect(Array.from(ref.current!.classList).filter((name) => /(^|:)bg-/.test(name))).toEqual([]);

    rerender(<Header ref={ref} className="bg-cropy-surface" />);
    expect(Array.from(ref.current!.classList)).toContain("bg-cropy-surface");
  });

  it("lg 부터 아래 테두리가 있고 노치만큼 위를 띄운다", () => {
    const ref = createRef<HTMLElement>();
    render(<Header ref={ref} />);

    expect(Array.from(ref.current!.classList)).toEqual(
      expect.arrayContaining([
        "lg:border-b",
        "lg:border-cropy-border",
        "pt-[env(safe-area-inset-top)]",
      ]),
    );
  });

  it("높이는 76px에서 lg 부터 80px, 본문 폭은 최대 1200px, xl 부터 좌우 64px·간격 40px이다", () => {
    const ref = createRef<HTMLElement>();
    render(<Header ref={ref} />);

    expect(Array.from(ref.current!.classList)).toContain("xl:px-16");
    expect(Array.from(ref.current!.firstElementChild!.classList)).toEqual(
      expect.arrayContaining([
        "h-[4.75rem]",
        "lg:h-[calc(5rem-1px)]", // 아래 테두리 1px 을 더해 80px
        "px-6",
        "gap-2",
        "xl:gap-10",
        "max-w-[75rem]",
      ]),
    );
  });

  it("로고는 70×44px에서 lg 부터 84×56px이고, 자리가 모자라면 줄어든다", () => {
    render(<Header />);

    expect(Array.from(screen.getByRole("img", { name: "Cropy" }).classList)).toEqual(
      expect.arrayContaining(["h-11", "w-[4.375rem]", "lg:h-14", "lg:w-[5.25rem]", "shrink"]),
    );
    expect(screen.getByRole("img", { name: "Cropy" }).classList.contains("shrink-0")).toBe(false);
  });

  it("내비는 lg 부터 보이고 항목은 폭 112px(xl 부터)·안쪽 12px·모서리 8px·아이콘 20px·라벨 14px이다", () => {
    render(<Header items={ITEMS} />);
    const link = navLinks()[0];

    expect(Array.from(nav().classList)).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
    expect(Array.from(link.classList)).toEqual(
      expect.arrayContaining(["xl:w-28", "p-3", "rounded-lg", "gap-2", "text-cropy-helper"]),
    );
    expect(Array.from((link.querySelector("span") as HTMLElement).classList)).toEqual(
      expect.arrayContaining(["h-5", "w-5"]),
    );
  });

  it("선택된 항목은 연초록 배경에 초록 Bold, 나머지는 회색 Medium이다", () => {
    render(<Header items={ITEMS} current="capture" />);
    const [selected, other] = navLinks();

    expect(Array.from(selected.classList)).toEqual(
      expect.arrayContaining([
        "bg-cropy-action-subtle",
        "font-bold",
        "text-cropy-action-primary",
        "text-cropy-helper",
      ]),
    );
    expect(Array.from(other.classList)).toEqual(
      expect.arrayContaining(["font-medium", "text-cropy-text-secondary", "text-cropy-helper"]),
    );
    expect(other.classList.contains("bg-cropy-action-subtle")).toBe(false);
  });

  it("선택되지 않은 항목은 마우스를 올리면 연초록 배경이 둥글게 번지고 글자가 초록이 된다", () => {
    render(<Header items={ITEMS} current="capture" />);
    const [selected, other] = navLinks();

    expect(Array.from(other.classList)).toEqual(
      expect.arrayContaining([
        "relative",
        "isolate",
        "before:absolute",
        "before:inset-0",
        "before:-z-10",
        "before:rounded-full",
        "before:bg-cropy-action-subtle",
        "before:opacity-0",
        "before:scale-50",
        "before:transition",
        "[@media(hover:hover)]:hover:before:opacity-100",
        "[@media(hover:hover)]:hover:before:scale-100",
        "[@media(hover:hover)]:hover:text-cropy-action-primary",
      ]),
    );
    // 선택된 항목은 이미 배경이 있어 호버 효과를 겹치지 않는다
    expect(Array.from(selected.classList).some((name) => name.includes("hover"))).toBe(false);
  });
});

describe("Header — 갈 화면이 없는 항목", () => {
  const WITH_DISABLED: NavItem[] = ITEMS.map((item) =>
    item.key === "result" ? { ...item, disabled: true } : item,
  );

  it("자리와 라벨은 그대로 두되 링크가 아니라서 Tab 으로 닿지 않는다", () => {
    render(<Header items={WITH_DISABLED} />);
    const nav = within(screen.getByRole("navigation", { name: "주요 메뉴" }));
    const disabled = nav.getByRole("link", { name: "진단 결과" });

    expect(nav.getAllByRole("listitem")).toHaveLength(3);
    expect(disabled.tagName).toBe("SPAN");
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.hasAttribute("href")).toBe(false);
    expect(disabled.hasAttribute("tabindex")).toBe(false);
  });

  it("current 로 지정해도 현재 화면으로 표시하지 않는다", () => {
    render(<Header items={WITH_DISABLED} current="result" />);
    const nav = within(screen.getByRole("navigation", { name: "주요 메뉴" }));

    expect(nav.getByRole("link", { name: "진단 결과" }).hasAttribute("aria-current")).toBe(false);
    expect(nav.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))).toEqual(
      [],
    );
  });

  it("모양은 선택되지 않은 항목과 같다", () => {
    render(<Header items={WITH_DISABLED} />);
    const nav = within(screen.getByRole("navigation", { name: "주요 메뉴" }));
    const classes = Array.from(nav.getByRole("link", { name: "진단 결과" }).classList);

    expect(classes).toEqual(expect.arrayContaining(["font-medium", "text-cropy-text-secondary"]));
  });
});
