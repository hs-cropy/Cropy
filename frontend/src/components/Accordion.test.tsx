import { createRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Accordion, type AccordionItem } from "./Accordion";

const ITEMS: AccordionItem[] = [
  { id: "symptom", title: "증상", content: <p>열매에 갈색 병반이 생깁니다.</p> },
  { id: "cause", title: "원인", content: <p>비가 잦을 때 잘 퍼집니다.</p> },
  { id: "prevention", title: "예방법", content: <p>병든 열매를 치워주세요.</p> },
];

function trigger(name: string) {
  return screen.getByRole("button", { name });
}

function classes(element: Element) {
  return Array.from(element.classList);
}

describe("Accordion", () => {
  it("처음에는 모두 닫혀 있고 닫힌 내용은 화면에도 스크린리더에도 없다", () => {
    render(<Accordion items={ITEMS} />);

    for (const name of ["증상", "원인", "예방법"]) {
      expect(trigger(name).getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText("열매에 갈색 병반이 생깁니다.")).toBeNull();
  });

  it("머리를 누르면 펼치고, 다시 누르면 닫는다", async () => {
    render(<Accordion items={ITEMS} />);

    await userEvent.click(trigger("증상"));
    expect(trigger("증상").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "증상" }).textContent).toBe(
      "열매에 갈색 병반이 생깁니다.",
    );

    await userEvent.click(trigger("증상"));
    expect(trigger("증상").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("한 번에 하나만 펼친다. 다른 항목을 누르면 앞의 항목이 닫힌다", async () => {
    render(<Accordion items={ITEMS} />);

    await userEvent.click(trigger("증상"));
    await userEvent.click(trigger("원인"));

    expect(trigger("증상").getAttribute("aria-expanded")).toBe("false");
    expect(trigger("원인").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "원인" })).toBeTruthy();
  });

  it("키보드로는 Tab으로 옮기고 Enter·Space로 펼친다", async () => {
    render(<Accordion items={ITEMS} />);

    await userEvent.tab();
    expect(document.activeElement).toBe(trigger("증상"));
    await userEvent.keyboard("{Enter}");
    expect(trigger("증상").getAttribute("aria-expanded")).toBe("true");

    await userEvent.tab();
    expect(document.activeElement).toBe(trigger("원인"));
    await userEvent.keyboard(" ");
    expect(trigger("원인").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("증상").getAttribute("aria-expanded")).toBe("false");
  });

  it("머리와 내용을 서로 연결한다", async () => {
    render(<Accordion items={ITEMS} defaultValue="cause" />);
    const button = trigger("원인");
    const panel = screen.getByRole("region", { name: "원인" });

    expect(button.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(button.id);
    // 닫힌 항목의 머리도 자기 내용 자리를 가리킨다
    const closed = document.getElementById(trigger("증상").getAttribute("aria-controls") as string);
    expect(closed?.hidden).toBe(true);
    expect(closed?.textContent).toBe("");
  });

  it("머리는 제목 안의 버튼이다. 수준은 기본 h3이고 바꿀 수 있다", () => {
    const { rerender } = render(<Accordion items={ITEMS} />);
    expect(screen.getByRole("heading", { name: "증상", level: 3 }).contains(trigger("증상"))).toBe(
      true,
    );
    expect(trigger("증상").getAttribute("type")).toBe("button");

    rerender(<Accordion items={ITEMS} headingLevel={2} />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
  });

  it("defaultValue로 처음에 펼칠 항목을 정한다", () => {
    render(<Accordion items={ITEMS} defaultValue="prevention" />);

    expect(trigger("예방법").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "예방법" })).toBeTruthy();
  });

  it("펼침이 바뀔 때 알린다. 닫히면 null이다", async () => {
    const onValueChange = vi.fn();
    render(<Accordion items={ITEMS} onValueChange={onValueChange} />);

    await userEvent.click(trigger("증상"));
    await userEvent.click(trigger("원인"));
    await userEvent.click(trigger("원인"));

    expect(onValueChange.mock.calls).toEqual([["symptom"], ["cause"], [null]]);
  });

  it("value를 주면 쓰는 쪽의 상태를 따른다. 상태가 바뀌지 않으면 펼침도 그대로다", async () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Accordion items={ITEMS} value="symptom" onValueChange={onValueChange} />,
    );

    await userEvent.click(trigger("원인"));
    expect(onValueChange).toHaveBeenCalledWith("cause");
    expect(trigger("증상").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("원인").getAttribute("aria-expanded")).toBe("false");

    rerender(<Accordion items={ITEMS} value={null} onValueChange={onValueChange} />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("쓰는 쪽이 상태를 가지면 밖에서 모두 닫을 수 있다", async () => {
    function Controlled() {
      const [value, setValue] = useState<string | null>("symptom");
      return (
        <>
          <button type="button" onClick={() => setValue(null)}>
            모두 닫기
          </button>
          <Accordion items={ITEMS} value={value} onValueChange={setValue} />
        </>
      );
    }
    render(<Controlled />);

    await userEvent.click(trigger("원인"));
    expect(screen.getByRole("region", { name: "원인" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "모두 닫기" }));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("key가 바뀌면 펼침이 처음으로 돌아간다", async () => {
    const { rerender } = render(<Accordion key="record-1" items={ITEMS} />);
    await userEvent.click(trigger("증상"));
    expect(screen.getByRole("region")).toBeTruthy();

    rerender(<Accordion key="record-2" items={ITEMS} />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("항목 id에 공백이나 한글이 있어도 머리와 내용이 연결된다", async () => {
    render(
      <Accordion
        items={[
          { id: "등록 농약", title: "등록 농약", content: <p>약제 안내</p> },
          { id: "a b", title: "다른 항목", content: <p>내용</p> },
        ]}
      />,
    );

    await userEvent.click(trigger("등록 농약"));
    const panel = screen.getByRole("region", { name: "등록 농약" });

    expect(panel.id).not.toMatch(/\s/);
    expect(trigger("등록 농약").getAttribute("aria-controls")).toBe(panel.id);
  });

  it("쓰는 쪽이 상태를 가질 때 펼친 항목을 누르면 null로 알린다. 없는 id를 주면 모두 닫힌다", async () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Accordion items={ITEMS} value="symptom" onValueChange={onValueChange} />,
    );

    await userEvent.click(trigger("증상"));
    expect(onValueChange).toHaveBeenCalledWith(null);

    rerender(<Accordion items={ITEMS} value="unknown" onValueChange={onValueChange} />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("묶음 둘을 한 화면에 놓아도 id가 겹치지 않는다", () => {
    render(
      <>
        <Accordion items={ITEMS} defaultValue="symptom" />
        <Accordion items={ITEMS} defaultValue="symptom" />
      </>,
    );
    const ids = screen.getAllByRole("region").map((panel) => panel.id);

    expect(new Set(ids).size).toBe(2);
  });

  it("ref·className·나머지 속성을 전달한다", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Accordion ref={ref} items={ITEMS} className="lg:max-w-[53rem]" data-testid="list" />);

    expect(ref.current).toBe(screen.getByTestId("list"));
    expect(classes(ref.current as HTMLElement)).toContain("lg:max-w-[53rem]");
  });
});

// 화면의 FixedMobile/DiagnosisDetails 와 Desktop/DiagnosisDetails 사양표.
// 값이 바뀌면 디자인과 어긋난 것이므로 클래스 이름까지 고정한다
describe("Accordion — 디자인 사양", () => {
  it("항목은 흰 배경·테두리·모서리 16px이고 항목 사이는 8px이다", () => {
    render(<Accordion items={ITEMS} data-testid="list" />);
    const list = screen.getByTestId("list");

    expect(classes(list)).toEqual(expect.arrayContaining(["flex", "flex-col", "gap-2"]));
    expect(list.children).toHaveLength(3);
    expect(classes(list.firstElementChild as Element)).toEqual(
      expect.arrayContaining([
        "overflow-hidden",
        "rounded-2xl",
        "border",
        "border-cropy-border",
        "bg-cropy-surface",
      ]),
    );
  });

  it("머리는 좌우 16px·상하 12px·15px Bold이고 lg부터 안쪽 16px·최소 56px·16px Bold다", () => {
    render(<Accordion items={ITEMS} />);

    expect(classes(trigger("증상"))).toEqual(
      expect.arrayContaining([
        "w-full",
        "px-4",
        "py-3",
        "gap-3",
        "text-left",
        "text-cropy-feedback-body",
        "font-bold",
        "text-cropy-text-primary",
        "lg:min-h-14",
        "lg:py-4",
        "lg:gap-4",
        "lg:text-cropy-body-lg",
        "lg:font-bold",
        "focus-visible:outline-2",
      ]),
    );
  });

  it("머리는 터치로 눌러도 배경이 바뀌지 않고, 마우스 기기에서만 호버 배경을 준다", () => {
    render(<Accordion items={ITEMS} />);
    const list = classes(trigger("증상"));

    expect(list.filter((name) => /(^|:)(active|hover):bg-|:hover/.test(name))).toEqual([
      "[@media(hover:hover)]:hover:bg-cropy-surface-canvas",
    ]);
  });

  it("화살표는 20px 장식이고 펼치면 위를 가리킨다", async () => {
    render(<Accordion items={ITEMS} />);
    const icon = () => trigger("증상").querySelector("[aria-hidden]") as Element;

    expect(classes(icon())).toEqual(
      expect.arrayContaining(["icon-[lucide--chevron-down]", "h-5", "w-5", "shrink-0"]),
    );
    expect(classes(icon())).not.toContain("rotate-180");

    await userEvent.click(trigger("증상"));
    expect(classes(icon())).toContain("rotate-180");
  });

  it("내용은 좌우 16px·아래 18px·문단 간격 12px·14px 보조색이고 lg부터 아래 20px·간격 8px이다", () => {
    render(<Accordion items={ITEMS} defaultValue="symptom" />);

    expect(classes(screen.getByRole("region"))).toEqual(
      expect.arrayContaining([
        "flex-col",
        "gap-3",
        "px-4",
        "pb-[1.125rem]",
        "text-cropy-helper",
        "text-cropy-text-secondary",
        "lg:gap-2",
        "lg:pb-5",
      ]),
    );
  });
});
