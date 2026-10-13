import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

function classes(element: Element) {
  return Array.from(element.classList);
}

describe("PageHeader", () => {
  it("제목은 기본 h1이고 headingLevel로 바꿀 수 있다", () => {
    const { rerender } = render(<PageHeader title="진단 시작" />);
    expect(screen.getByRole("heading", { name: "진단 시작", level: 1 })).toBeTruthy();

    rerender(<PageHeader title="진단 시작" headingLevel={2} />);
    expect(screen.getByRole("heading", { name: "진단 시작", level: 2 })).toBeTruthy();
  });

  it("설명은 줄 때만 그리고 줄바꿈을 그대로 둔다", () => {
    const { rerender, container } = render(<PageHeader title="진단 시작" />);
    expect(container.querySelector("h1 + div")).toBeNull();

    rerender(
      <PageHeader title="진단 시작" description={"사진을 찍거나 선택하면\n결과를 볼 수 있어요."} />,
    );
    const description = container.querySelector("h1 + div") as HTMLElement;
    expect(description.textContent).toBe("사진을 찍거나 선택하면\n결과를 볼 수 있어요.");
    expect(classes(description)).toContain("whitespace-pre-line");
  });

  it("마스코트는 줄 때만 그리고 장식이라 스크린리더가 읽지 않는다", () => {
    const { rerender, container } = render(<PageHeader title="진단 결과" />);
    expect(container.querySelector("img")).toBeNull();

    rerender(<PageHeader title="진단 결과" mascot="result" />);
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/mascot/result.png");
    expect(image.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("제목은 Tab으로 닿지 않지만 코드로 초점을 줄 수 있다", () => {
    const titleRef = createRef<HTMLHeadingElement>();
    render(<PageHeader title="진단 결과" titleRef={titleRef} />);
    const heading = screen.getByRole("heading", { name: "진단 결과" });

    expect(titleRef.current).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
    titleRef.current?.focus();
    expect(document.activeElement).toBe(heading);
  });

  it("ref·className·나머지 속성을 바깥 요소에 전달한다", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <PageHeader ref={ref} title="진단 이력" className="bg-cropy-surface" data-testid="head" />,
    );

    expect(ref.current).toBe(screen.getByTestId("head"));
    expect(classes(ref.current as HTMLElement)).toContain("bg-cropy-surface");
  });
});

// 화면의 MobileShell/Title 과 WebShell/Title 사양표.
// 값이 바뀌면 디자인과 어긋난 것이므로 클래스 이름까지 고정한다
describe("PageHeader — 디자인 사양", () => {
  it("모바일은 좌우 24px·상하 8px·최소 112px, lg부터 위 32px·아래 12px·최소 160px이다", () => {
    render(<PageHeader title="진단 시작" data-testid="head" />);
    const outer = screen.getByTestId("head");

    expect(classes(outer)).toEqual(
      expect.arrayContaining(["shrink-0", "px-6", "py-2", "lg:pt-8", "lg:pb-3", "xl:px-16"]),
    );
    // 112 = 8 + 96 + 8, 160 = 32 + 116 + 12
    expect(classes(outer.firstElementChild as Element)).toEqual(
      expect.arrayContaining(["min-h-24", "lg:min-h-[7.25rem]", "max-w-[75rem]", "mx-auto"]),
    );
  });

  it("제목은 24px/32px이고 lg부터 32px/44px이다. 설명은 14px 보조색이다", () => {
    const { container } = render(<PageHeader title="진단 시작" description="설명" />);

    expect(classes(screen.getByRole("heading"))).toEqual(
      expect.arrayContaining([
        "text-cropy-heading-lg",
        "lg:text-cropy-title-desktop",
        "text-cropy-text-primary",
      ]),
    );
    expect(classes(container.querySelector("h1 + div") as Element)).toEqual(
      expect.arrayContaining(["text-cropy-helper", "text-cropy-text-secondary"]),
    );
  });

  it("제목과 설명 사이는 6px, lg부터 8px이다", () => {
    render(<PageHeader title="진단 시작" description="설명" />);

    expect(classes(screen.getByRole("heading").parentElement as Element)).toEqual(
      expect.arrayContaining(["gap-1.5", "lg:gap-2", "flex-1", "min-w-0"]),
    );
  });

  it("마스코트는 64px이고 글과 12px 떨어진다. lg부터 88px이다", () => {
    const { container } = render(
      <PageHeader title="진단 결과" mascot="result" data-testid="head" />,
    );

    expect(classes(container.querySelector("img") as Element)).toEqual(
      expect.arrayContaining(["size-16", "lg:size-[5.5rem]", "shrink-0"]),
    );
    expect(classes(screen.getByTestId("head").firstElementChild as Element)).toContain("gap-3");
  });
});
