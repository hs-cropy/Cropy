import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CaseFeedback } from "./CaseFeedback";
import { FEEDBACK, FEEDBACK_CASE_IDS } from "./cases";

describe("CaseFeedback", () => {
  it.each(FEEDBACK_CASE_IDS)("%s 의 제목·본문·버튼을 사전대로 보여 준다", (id) => {
    const { title, message, primary, secondary, busy } = FEEDBACK[id];
    render(<CaseFeedback caseId={id} />);

    const card = screen.getByRole(busy ? "status" : "alert", { name: title });
    expect(card.children[2].textContent).toBe(message);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.queryAllByRole("button").map((button) => button.textContent)).toEqual(
      [primary, secondary].filter(Boolean),
    );
  });

  it("진행 중 안내는 status로, 오류 안내는 alert로 알린다", () => {
    const { unmount } = render(<CaseFeedback caseId="history-loading" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();

    render(<CaseFeedback caseId="history-failed" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("주 버튼과 보조 버튼이 각자의 일을 한다", async () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      <CaseFeedback caseId="record-load-failed" onPrimary={onPrimary} onSecondary={onSecondary} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "이력으로" }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it("주 버튼의 일을 하는 중에는 다시 누를 수 없다. 보조 버튼은 누를 수 있다", async () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      <CaseFeedback
        caseId="record-load-failed"
        primaryLoading
        onPrimary={onPrimary}
        onSecondary={onSecondary}
      />,
    );
    const primary = screen.getByRole("button", { name: "다시 불러오기" }) as HTMLButtonElement;

    expect(primary.disabled).toBe(true);
    await userEvent.click(primary);
    expect(onPrimary).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "이력으로" }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it("버튼은 44px 컴팩트 크기이고 주 버튼은 초록, 보조 버튼은 흰 배경이다", () => {
    render(<CaseFeedback caseId="photo-upload" />);
    const primary = Array.from(screen.getByRole("button", { name: "다시 보내기" }).classList);
    const secondary = Array.from(screen.getByRole("button", { name: "다른 사진 선택" }).classList);

    expect(primary).toEqual(
      expect.arrayContaining(["min-h-cropy-control-md", "bg-cropy-action-primary"]),
    );
    expect(secondary).toEqual(
      expect.arrayContaining(["min-h-cropy-control-md", "bg-cropy-surface"]),
    );
  });

  it("ref·className·headingLevel 등은 안내 카드로 전달한다", () => {
    const ref = createRef<HTMLElement>();
    render(
      <CaseFeedback ref={ref} caseId="save-failed" className="max-w-[30rem]" headingLevel={2} />,
    );

    expect(ref.current).toBe(screen.getByRole("alert"));

    expect(Array.from(screen.getByRole("alert").classList)).toContain("max-w-[30rem]");
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
  });
});
