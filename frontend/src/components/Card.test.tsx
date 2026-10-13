import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, cardClassName } from "./Card";

// 반응형 접두사가 붙은 것까지 포함한 여백 클래스
const PADDING_CLASS = /^([a-z0-9]+:)*p[xytrbl]?-/;

function classes(testId = "card") {
  return Array.from(screen.getByTestId(testId).classList);
}

describe("Card", () => {
  it("내용을 감싸는 div다", () => {
    render(<Card data-testid="card">고추 탄저병</Card>);
    const card = screen.getByTestId("card");

    expect(card.tagName).toBe("DIV");
    expect(card.textContent).toBe("고추 탄저병");
    // 뜻이 있는 요소(section·li)나 역할은 쓰는 쪽이 정한다
    expect(card.hasAttribute("role")).toBe(false);
  });

  it("ref·className·나머지 속성을 전달한다", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Card ref={ref} data-testid="card" className="flex min-h-[5.5rem] gap-3" aria-label="기록">
        내용
      </Card>,
    );

    expect(ref.current).toBe(screen.getByTestId("card"));
    expect(classes()).toEqual(expect.arrayContaining(["flex", "min-h-[5.5rem]", "gap-3"]));
    expect(ref.current?.getAttribute("aria-label")).toBe("기록");
  });

  it("다른 여백이 필요하면 padding=none 으로 두고 className으로 준다", () => {
    render(
      <Card data-testid="card" padding="none" className="p-8">
        내용
      </Card>,
    );

    // 기본 여백에 p-8 을 덮으면 lg:px-5 가 남아 넓은 화면에서 이긴다
    expect(classes().filter((c) => PADDING_CLASS.test(c))).toEqual(["p-8"]);
  });

  it("className으로 모서리를 바꿀 수 있다", () => {
    render(
      <Card data-testid="card" radius="lg" className="rounded-none">
        내용
      </Card>,
    );

    expect(classes()).toContain("rounded-none");
    expect(classes()).not.toContain("rounded-cropy-20");
  });

  it("div는 누를 수 없으므로 눌리는 모양을 갖지 않는다", () => {
    render(<Card data-testid="card">내용</Card>);

    expect(classes()).not.toContain("cursor-pointer");
    expect(classes().some((c) => c.includes("hover"))).toBe(false);
  });
});

describe("cardClassName", () => {
  it("옵션이 같으면 Card와 같은 모양을 낸다", () => {
    render(
      <Card data-testid="card" radius="lg" padding="lg">
        내용
      </Card>,
    );

    expect(screen.getByTestId("card").className).toBe(
      cardClassName({ radius: "lg", padding: "lg" }),
    );
  });

  it("interactive는 호버·누름·초점 표시와 손 모양 커서를 더한다", () => {
    const plain = cardClassName().split(" ");
    const interactive = cardClassName({ interactive: true }).split(" ");

    expect(interactive).toEqual(expect.arrayContaining(plain));
    expect(interactive).toEqual(
      expect.arrayContaining([
        "cursor-pointer",
        "[@media(hover:hover)]:[&:hover:not(:active)]:bg-cropy-surface-canvas",
        "active:bg-cropy-surface-canvas",
        "focus-visible:outline-2",
        "focus-visible:outline-cropy-action-primary",
      ]),
    );
    expect(plain).not.toContain("cursor-pointer");
  });

  it("interactive는 모서리·여백 옵션과 함께 쓸 수 있다", () => {
    const classNames = cardClassName({ radius: "lg", padding: "none", interactive: true }).split(
      " ",
    );

    expect(classNames).toEqual(expect.arrayContaining(["rounded-cropy-20", "cursor-pointer"]));
    expect(classNames.some((c) => PADDING_CLASS.test(c))).toBe(false);
  });
});

// 디자인 시스템의 RecordRow·ResultSummary 에서 뽑은 사양표.
// 값이 바뀌면 디자인과 어긋난 것이므로 클래스 이름까지 고정한다
describe("Card — 디자인 사양", () => {
  it("흰 배경에 1px 테두리이고 그림자가 없다", () => {
    render(<Card data-testid="card">내용</Card>);

    expect(classes()).toEqual(
      expect.arrayContaining(["border", "border-cropy-border", "bg-cropy-surface"]),
    );
    expect(classes().some((c) => c.startsWith("shadow"))).toBe(false);
  });

  it.each([
    ["md", "rounded-2xl"],
    ["lg", "rounded-cropy-20"],
  ] as const)("radius=%s 는 %s 다 (16px·20px)", (radius, expected) => {
    render(
      <Card data-testid="card" radius={radius}>
        내용
      </Card>,
    );

    expect(classes()).toContain(expected);
  });

  it("기본은 모서리 16px, 안쪽 16px이고 lg부터 좌우만 20px이다", () => {
    render(<Card data-testid="card">내용</Card>);

    expect(classes()).toEqual(expect.arrayContaining(["rounded-2xl", "p-4", "lg:px-5"]));
  });

  it("padding=lg 는 안쪽 16px이고 lg부터 24px이다", () => {
    render(
      <Card data-testid="card" padding="lg">
        내용
      </Card>,
    );

    expect(classes()).toEqual(expect.arrayContaining(["p-4", "lg:p-6"]));
    expect(classes()).not.toContain("lg:px-5");
  });

  it("padding=none 은 여백을 두지 않는다", () => {
    render(
      <Card data-testid="card" padding="none">
        내용
      </Card>,
    );

    expect(classes().some((c) => PADDING_CLASS.test(c))).toBe(false);
  });
});
