import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

function classes(text: string) {
  return Array.from(screen.getByText(text).classList);
}

describe("Badge", () => {
  it("라벨을 그대로 보여 주는 글자 요소다", () => {
    render(<Badge tone="attention">위험</Badge>);
    const badge = screen.getByText("위험");

    expect(badge.tagName).toBe("SPAN");
    // 맥락("등급")을 붙이는 일은 쓰는 쪽이 한다
    expect(badge.hasAttribute("role")).toBe(false);
    expect(badge.hasAttribute("aria-label")).toBe(false);
  });

  it("ref·className·나머지 속성을 전달하고 폭은 className으로 고정할 수 있다", () => {
    const ref = createRef<HTMLSpanElement>();
    render(
      <Badge ref={ref} tone="low" className="w-[4.5rem]" id="grade" title="위험 등급">
        낮음
      </Badge>,
    );

    expect(ref.current).toBe(screen.getByText("낮음"));
    expect(classes("낮음")).toContain("w-[4.5rem]");
    expect(ref.current?.id).toBe("grade");
    expect(ref.current?.title).toBe("위험 등급");
  });
});

// 디자인 시스템(Cropy/V2/Badge/Status)과 데스크탑 이력 테이블 화면의 사양표.
// 값이 바뀌면 디자인과 어긋난 것이므로 클래스 이름까지 고정한다
describe("Badge — 디자인 사양", () => {
  it.each([
    ["attention", "bg-cropy-status-attention-surface", "text-cropy-status-attention"],
    ["low", "bg-cropy-status-low-surface", "text-cropy-status-low"],
    ["action", "bg-cropy-action-subtle", "text-cropy-action-primary"],
  ] as const)("tone=%s 는 배경 %s, 글자 %s 다", (tone, background, color) => {
    render(<Badge tone={tone}>라벨</Badge>);

    expect(classes("라벨")).toEqual(expect.arrayContaining([background, color]));
  });

  it("기본은 높이 28px·좌우 12px의 알약 모양이고 12px Bold다. 폭은 글자에 맞추되 48px 보다 좁아지지 않는다", () => {
    render(<Badge tone="attention">위험</Badge>);

    expect(classes("위험")).toEqual(
      expect.arrayContaining([
        "min-h-7",
        "min-w-12",
        "px-3",
        "rounded-full",
        "text-cropy-label-xs",
      ]),
    );
    expect(classes("위험").some((c) => c.startsWith("w-"))).toBe(false);
  });

  it("cell은 폭 72px·모서리 8px·13px Bold다. 글자 크기·굵기·색을 서로 지우지 않는다", () => {
    render(
      <Badge tone="attention" variant="cell">
        주의
      </Badge>,
    );

    expect(classes("주의")).toEqual(
      expect.arrayContaining([
        "min-h-7",
        "w-[4.5rem]",
        "rounded-lg",
        "text-cropy-caption",
        "font-bold",
        "text-cropy-status-attention",
        "justify-center",
      ]),
    );
    expect(classes("주의")).not.toContain("rounded-full");
  });

  it("cell의 폭도 className으로 바꿀 수 있다", () => {
    render(
      <Badge tone="low" variant="cell" className="w-24">
        낮음
      </Badge>,
    );

    expect(classes("낮음")).toContain("w-24");
    expect(classes("낮음")).not.toContain("w-[4.5rem]");
  });
});
