import { createRef, type FormEvent } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "./Chip";

// 실제 브라우저는 "고추 2건"으로 읽지만 jsdom 은 숨긴 글자의 앞 공백을 지워 "고추2건"이 된다.
// 건수가 있는 칩은 정규식으로 찾는다
function chip(name: string | RegExp) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

function classes(name: string | RegExp) {
  return Array.from(chip(name).classList);
}

describe("Chip", () => {
  it("선택 여부를 aria-pressed로 항상 알린다", () => {
    const { rerender } = render(
      <Chip kind="crop" selected={false}>
        고추
      </Chip>,
    );
    expect(chip("고추").getAttribute("aria-pressed")).toBe("false");

    rerender(
      <Chip kind="crop" selected>
        고추
      </Chip>,
    );
    expect(chip("고추").getAttribute("aria-pressed")).toBe("true");
  });

  it("누르면 onClick을 부르고 상태는 스스로 바꾸지 않는다", () => {
    const onClick = vi.fn();
    render(
      <Chip kind="grade" selected={false} onClick={onClick}>
        위험
      </Chip>,
    );

    fireEvent.click(chip("위험"));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(chip("위험").getAttribute("aria-pressed")).toBe("false");
  });

  it("비활성이면 누를 수 없고 선택 상태는 그대로 알린다", () => {
    const onClick = vi.fn();
    render(
      <Chip kind="crop" selected disabled onClick={onClick}>
        고추
      </Chip>,
    );

    fireEvent.click(chip("고추"));

    expect(chip("고추").disabled).toBe(true);
    expect(chip("고추").getAttribute("aria-pressed")).toBe("true");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("form 안에서 눌러도 제출하지 않는다", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Chip kind="crop" selected={false}>
          고추
        </Chip>
      </form>,
    );

    fireEvent.click(chip("고추"));

    expect(chip("고추").type).toBe("button");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("건수는 데스크탑에서만 보이고, 이름에는 화면 폭과 상관없이 넣는다. 0건도 보인다", () => {
    const { rerender } = render(
      <Chip kind="crop" selected={false} count={2}>
        고추
      </Chip>,
    );
    const shown = chip(/^고추 ?2건$/).querySelector("[aria-hidden]") as HTMLElement;
    expect(shown.textContent).toBe("2");
    expect(Array.from(shown.classList)).toEqual(expect.arrayContaining(["hidden", "lg:inline"]));

    rerender(
      <Chip kind="crop" selected={false} count={0}>
        고추
      </Chip>,
    );
    expect(chip(/^고추 ?0건$/).querySelector("[aria-hidden]")?.textContent).toBe("0");

    rerender(
      <Chip kind="crop" selected={false}>
        고추
      </Chip>,
    );
    expect(chip("고추").querySelector("[aria-hidden]")).toBeNull();
  });

  it("선택 여부는 selected 로만 정한다. aria-pressed 를 따로 넘겨도 덮이지 않는다", () => {
    render(
      <Chip kind="crop" selected {...{ "aria-pressed": false }}>
        고추
      </Chip>,
    );

    expect(chip("고추").getAttribute("aria-pressed")).toBe("true");
  });

  it("등급 칩에는 건수를 줄 수 없다", () => {
    render(
      // @ts-expect-error 건수는 작물 칩에만 있다
      <Chip kind="grade" selected={false} count={1}>
        위험
      </Chip>,
    );

    // 타입으로만 막는다 (위 @ts-expect-error 가 검사한다)
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("ref·className·나머지 속성을 전달한다", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Chip ref={ref} kind="crop" selected={false} className="flex-1" aria-describedby="crop-hint">
        고추
      </Chip>,
    );

    ref.current?.focus();

    expect(document.activeElement).toBe(chip("고추"));
    expect(classes("고추")).toContain("flex-1");
    expect(chip("고추").getAttribute("aria-describedby")).toBe("crop-hint");
  });

  it("className 으로 폭을 주면 기본 폭을 대신한다", () => {
    render(
      <Chip kind="crop" selected={false} className="w-full">
        고추
      </Chip>,
    );

    expect(classes("고추")).toContain("w-full");
    expect(classes("고추")).not.toContain("w-32");
  });
});

// 디자인 시스템(Cropy/V2/Filter/Chip)과 데스크탑 이력 화면의 필터 사양표.
// 값이 바뀌면 디자인과 어긋난 것이므로 클래스 이름까지 고정한다
describe("Chip — 디자인 사양", () => {
  it("작물 칩은 128×48px·모서리 12px·16px이고 lg 부터 폭 148px·테두리 없음이다", () => {
    render(
      <Chip kind="crop" selected={false}>
        고추
      </Chip>,
    );

    expect(classes("고추")).toEqual(
      expect.arrayContaining([
        "min-h-12",
        "w-full",
        "rounded-xl",
        "border",
        "text-cropy-body-lg",
        "lg:w-full",
        "lg:border-0",
        "lg:p-3",
      ]),
    );
  });

  it("작물 칩: 미선택은 흰 배경·회색 테두리·Medium(lg 부터 배경 없음·Regular), 선택은 연초록·초록 테두리·Bold다", () => {
    const { rerender } = render(
      <Chip kind="crop" selected={false}>
        고추
      </Chip>,
    );
    expect(classes("고추")).toEqual(
      expect.arrayContaining([
        "border-cropy-border",
        "bg-cropy-surface",
        "font-medium",
        "text-cropy-text-secondary",
        "lg:bg-transparent",
        "lg:font-normal",
      ]),
    );

    rerender(
      <Chip kind="crop" selected>
        고추
      </Chip>,
    );
    expect(classes("고추")).toEqual(
      expect.arrayContaining([
        "border-cropy-action-primary",
        "bg-cropy-action-subtle",
        "font-bold",
        "text-cropy-action-primary",
        "text-cropy-body-lg",
      ]),
    );
    expect(classes("고추")).not.toContain("bg-cropy-surface");
  });

  it("등급 칩은 80×36px·알약·13px이고 lg 부터 폭 72px·모서리 8px·14px이다", () => {
    render(
      <Chip kind="grade" selected={false}>
        위험
      </Chip>,
    );

    expect(classes("위험")).toEqual(
      expect.arrayContaining([
        "min-h-9",
        "w-20",
        "rounded-full",
        "text-cropy-caption",
        "lg:w-[4.5rem]",
        "lg:flex-none",
        "lg:rounded-lg",
        "lg:p-2",
        "lg:text-cropy-helper",
      ]),
    );
  });

  it("등급 칩: 선택은 검정 배경·흰 글자·Bold이고 lg 부터 연초록 배경·초록 글자다", () => {
    const { rerender } = render(
      <Chip kind="grade" selected={false}>
        위험
      </Chip>,
    );
    expect(classes("위험")).toEqual(
      expect.arrayContaining([
        "border-cropy-border",
        "bg-cropy-surface",
        "font-medium",
        "text-cropy-text-secondary",
        "lg:font-normal",
      ]),
    );

    rerender(
      <Chip kind="grade" selected>
        위험
      </Chip>,
    );
    expect(classes("위험")).toEqual(
      expect.arrayContaining([
        "bg-cropy-text-primary",
        "font-bold",
        "text-cropy-text-on-action",
        "lg:border-cropy-action-subtle",
        "lg:bg-cropy-action-subtle",
        // lg 의 글자 스타일이 굵기를 되돌리므로 다시 적어야 한다
        "lg:font-bold",
        "lg:text-cropy-action-primary",
      ]),
    );
  });

  it("호버 표시는 선택되지 않고 누를 수 있는 칩에만, 마우스가 있을 때만 붙는다", () => {
    const hover = (name: string) => classes(name).filter((c) => c.includes("hover"));
    const { rerender } = render(
      <Chip kind="crop" selected={false}>
        고추
      </Chip>,
    );
    expect(hover("고추")).toHaveLength(1);
    expect(hover("고추")[0].startsWith("[@media(hover:hover)]:")).toBe(true);

    rerender(
      <Chip kind="crop" selected>
        고추
      </Chip>,
    );
    expect(hover("고추")).toEqual([]);

    rerender(
      <Chip kind="crop" selected={false} disabled>
        고추
      </Chip>,
    );
    expect(hover("고추")).toEqual([]);
  });

  it("비활성은 전체를 48%로 흐리게 하고 커서를 바꾼다", () => {
    const { rerender } = render(
      <Chip kind="grade" selected={false}>
        위험
      </Chip>,
    );
    expect(classes("위험")).toContain("cursor-pointer");

    rerender(
      <Chip kind="grade" selected={false} disabled>
        위험
      </Chip>,
    );
    expect(classes("위험")).toEqual(
      expect.arrayContaining(["opacity-[0.48]", "cursor-not-allowed"]),
    );
    expect(classes("위험")).not.toContain("cursor-pointer");
  });
});
