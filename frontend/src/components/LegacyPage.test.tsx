import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LegacyPage } from "./LegacyPage";

function classes(element: Element) {
  return Array.from(element.classList);
}

describe("LegacyPage", () => {
  it("화면을 main 안의 이름 있는 스크롤 영역에 넣는다", () => {
    render(
      <LegacyPage scrollLabel="진단 이력">
        <h1>진단 이력</h1>
      </LegacyPage>,
    );
    const region = screen.getByRole("region", { name: "진단 이력" });

    expect(screen.getByRole("main").contains(region)).toBe(true);
    expect(region.contains(screen.getByRole("heading", { level: 1 }))).toBe(true);
  });

  it("옛 layout 의 위 여백과 본문 폭을 그대로 둔다", () => {
    render(
      <LegacyPage scrollLabel="진단하기">
        <p data-testid="content">내용</p>
      </LegacyPage>,
    );
    const wrapper = screen.getByTestId("content").parentElement as HTMLElement;

    expect(classes(wrapper)).toEqual(
      expect.arrayContaining([
        "mx-auto",
        "w-full",
        "max-w-[27.5rem]",
        "pt-5",
        "md:max-w-[44rem]",
        "md:pt-8",
        "lg:max-w-[60rem]",
      ]),
    );
  });

  it("옛 화면의 덩어리 여백이 틀의 간격과 겹치지 않게 한 덩어리로 넣는다", () => {
    render(
      <LegacyPage scrollLabel="진단하기">
        <section data-testid="first">하나</section>
        <section>둘</section>
      </LegacyPage>,
    );
    const wrapper = screen.getByTestId("first").parentElement as HTMLElement;

    expect(wrapper.parentElement?.children).toHaveLength(1);
    expect(wrapper.children).toHaveLength(2);
  });

  it("className 으로 폭을 좁힐 수 있다", () => {
    render(
      <LegacyPage scrollLabel="진단 기록" className="md:max-w-2xl lg:max-w-2xl">
        <p data-testid="content">내용</p>
      </LegacyPage>,
    );
    const wrapper = screen.getByTestId("content").parentElement as HTMLElement;

    expect(classes(wrapper)).toEqual(expect.arrayContaining(["md:max-w-2xl", "lg:max-w-2xl"]));
    expect(classes(wrapper)).not.toContain("md:max-w-[44rem]");
    expect(classes(wrapper)).not.toContain("lg:max-w-[60rem]");
  });
});
