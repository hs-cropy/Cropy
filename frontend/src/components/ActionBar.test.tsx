import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionBar } from "./ActionBar";
import { Button } from "./Button";

function classes(element: Element) {
  return Array.from(element.classList);
}

describe("ActionBar", () => {
  it("버튼을 이름 있는 묶음으로 감싼다", () => {
    render(
      <ActionBar>
        <Button>사진 찍기</Button>
        <Button variant="secondary">갤러리에서 선택</Button>
      </ActionBar>,
    );
    const group = screen.getByRole("group", { name: "화면 행동" });

    expect(
      Array.from(group.querySelectorAll("button")).map((button) => button.textContent),
    ).toEqual(["사진 찍기", "갤러리에서 선택"]);
  });

  it("묶음의 이름을 바꿀 수 있다", () => {
    render(
      <ActionBar aria-label="사진 고르기">
        <Button>사진 찍기</Button>
      </ActionBar>,
    );

    expect(screen.getByRole("group", { name: "사진 고르기" })).toBeTruthy();
  });

  it.each([
    ["없음", undefined],
    ["null", null],
    ["false", false],
    ["빈 배열", []],
  ])("버튼이 %s 이면 아무것도 그리지 않는다", (_, children) => {
    const { container } = render(<ActionBar>{children}</ActionBar>);

    expect(container.firstChild).toBeNull();
  });

  it("자식이 아무것도 그리지 않으면 띠째로 숨길 클래스를 갖는다 (빈 Fragment, null 을 돌려주는 컴포넌트)", () => {
    function Nothing() {
      return null;
    }
    render(
      <ActionBar data-testid="bar">
        <Nothing />
      </ActionBar>,
    );
    const bar = screen.getByTestId("bar");

    expect(bar.firstElementChild?.childNodes).toHaveLength(0);
    expect(classes(bar)).toContain("has-[>:empty]:hidden");
  });

  it("조건에 따라 버튼 하나만 남아도 그 버튼만 그린다", () => {
    const showSecondary = false;
    render(
      <ActionBar>
        <Button>다시 촬영하기</Button>
        {showSecondary && <Button variant="secondary">갤러리에서 선택</Button>}
      </ActionBar>,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("ref·className·나머지 속성을 전달한다", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ActionBar ref={ref} className="lg:hidden" data-testid="bar">
        <Button>확인</Button>
      </ActionBar>,
    );

    expect(ref.current).toBe(screen.getByTestId("bar"));
    expect(classes(ref.current as HTMLElement)).toContain("lg:hidden");
  });
});

// 화면의 MobileShell/Actions 와 WebShell/Actions 사양표.
// 값이 바뀌면 디자인과 어긋난 것이므로 클래스 이름까지 고정한다
describe("ActionBar — 디자인 사양", () => {
  function renderBar() {
    render(
      <ActionBar>
        <Button>사진 찍기</Button>
        <Button variant="secondary">갤러리에서 선택</Button>
      </ActionBar>,
    );
    return screen.getByRole("group");
  }

  it("흰 배경·위 테두리·좌우 24px·상하 16px(테두리 포함)이고, lg부터 최소 80px·흰 배경 96%다", () => {
    expect(classes(renderBar())).toEqual(
      expect.arrayContaining([
        "shrink-0",
        "border-t",
        "border-cropy-border",
        "bg-cropy-surface",
        "px-6",
        "pb-4",
        "pt-[calc(1rem-1px)]",
        "lg:min-h-20",
        "lg:py-2",
        "has-[>:empty]:hidden",
        "lg:bg-cropy-surface/[0.96]",
        "xl:px-16",
      ]),
    );
  });

  it("버튼을 간격 8px로 세로로 쌓고 폭을 채운다. lg부터 간격 12px로 나란히 놓고 폭 240px이다", () => {
    expect(classes(renderBar().firstElementChild as Element)).toEqual(
      expect.arrayContaining([
        "flex-col",
        "gap-2",
        "[&>*]:w-full",
        "lg:flex-row",
        "lg:gap-3",
        "lg:[&>*]:w-60",
        "max-w-[75rem]",
      ]),
    );
  });
});
