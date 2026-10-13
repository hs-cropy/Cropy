import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { InlineFeedback } from "./InlineFeedback";

function classes(element: Element) {
  return Array.from(element.classList);
}

describe("InlineFeedback", () => {
  it("기본은 제목을 이름으로 갖는 alert다", () => {
    render(
      <InlineFeedback mascot="connection" title="이력을 불러오지 못했어요">
        연결 상태를 확인해주세요.
      </InlineFeedback>,
    );
    const card = screen.getByRole("alert", { name: "이력을 불러오지 못했어요" });

    expect(card.tagName).toBe("SECTION");
    expect(card.textContent).toContain("연결 상태를 확인해주세요.");
    expect(card.hasAttribute("aria-busy")).toBe(false);
  });

  it("tone=status 는 하던 말을 끊지 않는 status다. 읽히지 않을 수 있어 aria-busy는 붙이지 않는다", () => {
    render(<InlineFeedback mascot="analysis" title="불러오고 있어요" tone="status" />);
    const region = screen.getByRole("status");

    expect(region.textContent).toContain("불러오고 있어요");
    expect(region.hasAttribute("aria-busy")).toBe(false);
    expect(region.firstElementChild?.hasAttribute("aria-busy")).toBe(false);
  });

  it("status 는 바깥 영역만 알린다. 안의 카드는 role 도 이름도 없어 랜드마크가 되지 않는다", () => {
    render(<InlineFeedback mascot="analysis" title="불러오고 있어요" tone="status" />);
    const card = screen.getByRole("status").firstElementChild as Element;

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(card.tagName).toBe("SECTION");
    expect(card.hasAttribute("role")).toBe(false);
    expect(card.hasAttribute("aria-labelledby")).toBe(false);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("status 는 open=false 여도 빈 영역을 그려 두고, 켜면 같은 영역 안에 카드를 넣는다", () => {
    const feedback = (open: boolean) => (
      <InlineFeedback mascot="analysis" title="불러오고 있어요" tone="status" open={open} />
    );
    const { rerender } = render(feedback(false));
    const region = screen.getByRole("status");

    expect(region.childElementCount).toBe(0);
    expect(region.textContent).toBe("");

    rerender(feedback(true));
    expect(screen.getByRole("status")).toBe(region);
    expect(screen.getByRole("heading", { name: "불러오고 있어요" })).toBeTruthy();
    expect(region.childElementCount).toBe(1);

    rerender(feedback(false));
    expect(screen.getByRole("status")).toBe(region);
    expect(region.childElementCount).toBe(0);
  });

  it("status 는 처음부터 켜져 있어도 빈 영역을 먼저 그린 뒤 카드를 넣는다", () => {
    const feedback = <InlineFeedback mascot="analysis" title="불러오고 있어요" tone="status" />;
    const first = document.createElement("div");
    first.innerHTML = renderToString(feedback);

    expect(first.querySelector("[role=status]")?.childElementCount).toBe(0);

    render(feedback);
    expect(screen.getByRole("status").childElementCount).toBe(1);
  });

  it("빈 status 영역은 숨기지 않고 흐름에서만 뺀다", () => {
    render(<InlineFeedback mascot="analysis" title="제목" tone="status" open={false} />);
    const region = screen.getByRole("status");

    expect(classes(region)).toEqual(["empty:absolute"]);
    expect(region.hasAttribute("hidden")).toBe(false);
  });

  it("alert 는 open=false 면 그리지 않고, 켜는 시점에 나타난다", () => {
    const feedback = (open: boolean) => <InlineFeedback mascot="warning" title="제목" open={open} />;
    const { container, rerender } = render(feedback(false));

    expect(container.childElementCount).toBe(0);

    rerender(feedback(true));
    expect(screen.getByRole("alert", { name: "제목" })).toBeTruthy();
  });

  it("제목은 기본 h3이고 headingLevel로 화면의 제목 순서에 맞춘다", () => {
    const { rerender } = render(<InlineFeedback mascot="warning" title="제목" />);
    expect(screen.getByRole("heading", { name: "제목", level: 3 })).toBeTruthy();

    rerender(<InlineFeedback mascot="warning" title="제목" headingLevel={2} />);
    expect(screen.getByRole("heading", { name: "제목", level: 2 })).toBeTruthy();

    rerender(<InlineFeedback mascot="warning" title="제목" headingLevel={4} />);
    expect(screen.getByRole("heading", { name: "제목", level: 4 })).toBeTruthy();
  });

  it("마스코트는 장식이라 스크린리더가 읽지 않는다", () => {
    const { container } = render(<InlineFeedback mascot="warning" title="제목" />);
    const image = container.querySelector("img");

    expect(screen.queryByRole("img")).toBeNull();
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("src")).toBe("/mascot/warning.png");
  });

  it("마스코트 → 제목 → 본문 → 버튼 순서로 놓는다", () => {
    render(
      <InlineFeedback
        mascot="warning"
        title="제목"
        actions={<Button size="compact">다시 시도</Button>}
      >
        본문
      </InlineFeedback>,
    );

    expect(Array.from(screen.getByRole("alert").children).map((child) => child.tagName)).toEqual([
      "IMG",
      "H3",
      "DIV",
      "DIV",
    ]);
  });

  it("본문과 버튼이 없으면 빈 자리를 남기지 않는다", () => {
    render(<InlineFeedback mascot="warning" title="제목" actions={false} />);

    expect(Array.from(screen.getByRole("alert").children).map((child) => child.tagName)).toEqual([
      "IMG",
      "H3",
    ]);
  });

  it("본문 문자열의 줄바꿈을 그대로 둔다", () => {
    render(
      <InlineFeedback mascot="warning" title="제목">
        {"첫 줄이에요.\n둘째 줄이에요."}
      </InlineFeedback>,
    );
    const body = screen.getByText(/첫 줄이에요/);

    expect(body.textContent).toBe("첫 줄이에요.\n둘째 줄이에요.");
    expect(classes(body)).toContain("whitespace-pre-line");
  });

  it("버튼이 하나여도 버튼 자리에 그대로 놓는다", async () => {
    const onRetry = vi.fn();
    render(
      <InlineFeedback
        mascot="connection"
        title="제목"
        actions={
          <Button size="compact" onClick={onRetry}>
            다시 불러오기
          </Button>
        }
      />,
    );
    const button = screen.getByRole("button", { name: "다시 불러오기" });

    expect(button.parentElement?.children).toHaveLength(1);
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("이름과 알림 방식은 쓰는 쪽이 바꿀 수 있다", () => {
    render(
      <>
        <p id="outer-title">바깥 제목</p>
        <InlineFeedback
          mascot="warning"
          title="제목"
          aria-labelledby="outer-title"
          aria-live="off"
        />
      </>,
    );
    const card = screen.getByRole("alert", { name: "바깥 제목" });

    expect(card.getAttribute("aria-live")).toBe("off");
  });

  it("status 의 알림 방식은 카드가 아니라 알리는 바깥 영역에 붙는다", () => {
    render(<InlineFeedback mascot="analysis" title="제목" tone="status" aria-live="off" />);
    const region = screen.getByRole("status");

    expect(region.getAttribute("aria-live")).toBe("off");
    expect(region.firstElementChild?.hasAttribute("aria-live")).toBe(false);
  });

  it("ref·className·나머지 속성을 전달하되 role은 tone으로만 정한다", () => {
    const ref = createRef<HTMLElement>();
    render(
      <InlineFeedback
        ref={ref}
        mascot="warning"
        title="제목"
        className="max-w-[30rem]"
        data-testid="feedback"
        {...{ role: "note" }}
      />,
    );

    expect(ref.current).toBe(screen.getByTestId("feedback"));
    expect(classes(ref.current as HTMLElement)).toContain("max-w-[30rem]");
    expect(ref.current?.getAttribute("role")).toBe("alert");
  });

  it("status 에서도 ref·className·나머지 속성은 카드로 가고, role 은 바깥 영역에만 있다", () => {
    const ref = createRef<HTMLElement>();
    render(
      <InlineFeedback
        ref={ref}
        mascot="analysis"
        title="제목"
        tone="status"
        className="max-w-[30rem]"
        data-testid="feedback"
        {...{ role: "note" }}
      />,
    );
    const card = screen.getByTestId("feedback");

    expect(ref.current).toBe(card);
    expect(card.parentElement).toBe(screen.getByRole("status"));
    expect(classes(card)).toEqual(expect.arrayContaining(["max-w-[30rem]", "bg-cropy-surface"]));
    expect(card.hasAttribute("role")).toBe(false);
  });
});

// 화면의 Cropy/FeedbackV3/inline/* 사양표.
// 값이 바뀌면 디자인과 어긋난 것이므로 클래스 이름까지 고정한다
describe("InlineFeedback — 디자인 사양", () => {
  function renderCard() {
    render(
      <InlineFeedback
        mascot="connection"
        title="제목"
        actions={
          <>
            <Button size="compact">다시 보내기</Button>
            <Button size="compact" variant="secondary">
              다른 사진 선택
            </Button>
          </>
        }
      >
        본문
      </InlineFeedback>,
    );
    return screen.getByRole("alert");
  }

  it("흰 배경·1px 테두리·모서리 18px·안쪽 20px·간격 12px이고 가운데 정렬한다. 그림자가 없다", () => {
    const card = renderCard();

    expect(classes(card)).toEqual(
      expect.arrayContaining([
        "bg-cropy-surface",
        "border",
        "border-cropy-border",
        "rounded-[1.125rem]",
        "p-5",
        "gap-3",
        "flex-col",
        "items-center",
        "text-center",
        "w-full",
      ]),
    );
    expect(classes(card).some((c) => c.startsWith("shadow"))).toBe(false);
  });

  it("마스코트는 64px이고 lg부터 80px이다", () => {
    const card = renderCard();

    expect(classes(card.querySelector("img") as Element)).toEqual(
      expect.arrayContaining(["size-16", "lg:size-20"]),
    );
  });

  it("제목은 18px Bold, 본문은 15px 보조색이고 어절 단위로 줄을 나눈다", () => {
    const card = renderCard();

    expect(classes(screen.getByRole("heading"))).toEqual(
      expect.arrayContaining([
        "text-cropy-feedback-title",
        "text-cropy-text-primary",
        "break-keep",
      ]),
    );
    expect(classes(card.children[2])).toEqual(
      expect.arrayContaining([
        "text-cropy-feedback-body",
        "text-cropy-text-secondary",
        "break-keep",
      ]),
    );
  });

  it("버튼 자리는 나란히·가운데·세로 쌓기용 클래스를 갖는다 (실제 배치는 스토리에서 잰다)", () => {
    const card = renderCard();
    const actions = card.lastElementChild as Element;

    expect(classes(actions)).toEqual(
      expect.arrayContaining([
        "flex",
        "justify-center",
        "gap-2",
        "[&>*]:flex-1",
        "[&>*:only-child]:flex-none",
        "[&>*:only-child]:min-w-[7.5rem]",
        "[&>*:only-child]:max-w-full",
        "[html[data-textsize=large]_&]:flex-col",
      ]),
    );
    expect(actions.children).toHaveLength(2);
  });
});
