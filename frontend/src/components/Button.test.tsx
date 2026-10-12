import { createRef, type FormEvent } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonClassName } from "./Button";

function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

// 배경·글자·테두리 색만 뽑는다
function colorOf(className: string) {
  return className
    .split(" ")
    .filter((c) => /^(bg|text-cropy-text|border)-/.test(c))
    .join(" ");
}

function hasInteraction(className: string) {
  return className.split(" ").some((c) => c.includes("hover:") || c.startsWith("active:"));
}

describe("Button", () => {
  it("기본 type은 button이고 submit은 명시해야 한다", () => {
    render(
      <>
        <Button>확인</Button>
        <Button type="submit">보내기</Button>
      </>,
    );

    expect(button("확인").type).toBe("button");
    expect(button("보내기").type).toBe("submit");
  });

  it("form 안에서 기본 버튼은 제출하지 않고 submit 버튼만 제출한다", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>취소</Button>
        <Button type="submit">보내기</Button>
      </form>,
    );

    fireEvent.click(button("취소"));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(button("보내기"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("누르면 onClick을 부른다", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>확인</Button>);

    fireEvent.click(button("확인"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("비활성이면 누를 수 없다", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        확인
      </Button>,
    );

    fireEvent.click(button("확인"));

    expect(button("확인").disabled).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("진행 중이면 누를 수 없고 aria-busy를 붙인다", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        저장
      </Button>,
    );

    fireEvent.click(button("저장"));

    expect(button("저장").getAttribute("aria-busy")).toBe("true");
    expect(button("저장").disabled).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("진행 중이 아니면 aria-busy를 붙이지 않는다", () => {
    render(<Button>저장</Button>);

    expect(button("저장").hasAttribute("aria-busy")).toBe(false);
  });

  it("진행 중인 제출 버튼은 form을 다시 제출하지 않는다", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          진단 중…
        </Button>
      </form>,
    );

    fireEvent.click(button("진단 중…"));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("진행 중에는 색을 유지하되 누름 표시는 뺀다", () => {
    render(
      <>
        <Button>평소</Button>
        <Button loading>진행</Button>
      </>,
    );

    expect(colorOf(button("진행").className)).toBe(colorOf(button("평소").className));
    expect(hasInteraction(button("평소").className)).toBe(true);
    expect(hasInteraction(button("진행").className)).toBe(false);
  });

  it("비활성과 진행 중이 함께면 비활성 모양이 우선한다", () => {
    render(
      <>
        <Button>평소</Button>
        <Button disabled>비활성</Button>
        <Button disabled loading>
          둘 다
        </Button>
      </>,
    );

    expect(colorOf(button("둘 다").className)).toBe(colorOf(button("비활성").className));
    expect(colorOf(button("비활성").className)).not.toBe(colorOf(button("평소").className));
  });

  it("아이콘을 라벨 앞에 그리고, 진행 중에는 스피너로 바꾼다", () => {
    const icon = <span aria-hidden data-testid="icon" />;
    const { rerender } = render(<Button icon={icon}>사진 찍기</Button>);

    expect(button("사진 찍기").firstElementChild?.contains(screen.getByTestId("icon"))).toBe(true);

    rerender(
      <Button icon={icon} loading>
        사진 찍기
      </Button>,
    );

    expect(screen.queryByTestId("icon")).toBeNull();
    expect(button("사진 찍기").firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("ref로 버튼에 초점을 옮길 수 있다", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>확인</Button>);

    ref.current?.focus();

    expect(document.activeElement).toBe(button("확인"));
  });

  it("넘긴 className과 나머지 속성을 그대로 전달한다", () => {
    render(
      <Button className="flex-1" aria-describedby="hint">
        확인
      </Button>,
    );

    expect(button("확인").classList.contains("flex-1")).toBe(true);
    expect(button("확인").getAttribute("aria-describedby")).toBe("hint");
  });

  it("className으로 배치를 바꾸면 기본 배치 클래스를 대신한다", () => {
    render(<Button className="flex mt-2">확인</Button>);

    const classes = Array.from(button("확인").classList);
    expect(classes).toContain("flex");
    expect(classes).toContain("mt-2");
    expect(classes).not.toContain("inline-flex");
  });
});

describe("buttonClassName", () => {
  // 디자인 시스템(Cropy/V2/Button) 사양표. 값이 바뀌면 디자인과 어긋난 것이므로
  // 클래스 이름까지 고정한다
  it.each([
    [{}, "min-h-cropy-button-mobile", "rounded-cropy-14", "bg-cropy-action-primary"],
    [{ variant: "secondary" }, "min-h-cropy-button-mobile", "rounded-xl", "bg-cropy-surface"],
    [
      { size: "compact" },
      "min-h-cropy-control-md",
      "rounded-[0.625rem]",
      "bg-cropy-action-primary",
    ],
    [
      { size: "compact", variant: "secondary" },
      "min-h-cropy-control-md",
      "rounded-[0.625rem]",
      "bg-cropy-surface",
    ],
    [
      { disabled: true },
      "min-h-cropy-button-mobile",
      "rounded-cropy-14",
      "bg-cropy-action-disabled",
    ],
    // 비활성이어도 보조 버튼의 모서리는 12px 그대로다
    [
      { variant: "secondary", disabled: true },
      "min-h-cropy-button-mobile",
      "rounded-xl",
      "bg-cropy-action-disabled",
    ],
  ] as const)("%o → 높이 %s, 모서리 %s, 배경 %s", (options, height, radius, background) => {
    const classes = buttonClassName(options).split(" ");

    expect(classes).toContain(height);
    expect(classes).toContain(radius);
    expect(classes).toContain(background);
  });

  it("md 부터 웹 크기(48px·15px·모서리 12px)가 된다", () => {
    const primary = buttonClassName().split(" ");
    expect(primary).toEqual(
      expect.arrayContaining(["md:min-h-cropy-button-web", "md:text-[0.9375rem]", "md:rounded-xl"]),
    );

    // 피드백 카드 안 버튼은 화면 폭과 상관없이 44px이다
    const compact = buttonClassName({ size: "compact" });
    expect(compact).not.toContain("md:");
  });

  it("호버·누름 색은 종류마다 디자인 시스템 값을 쓴다", () => {
    const primary = buttonClassName().split(" ");
    expect(primary).toEqual(
      expect.arrayContaining([
        "[@media(hover:hover)]:[&:hover:not(:active)]:bg-cropy-action-hover",
        "active:bg-cropy-action-pressed",
      ]),
    );

    const secondary = buttonClassName({ variant: "secondary" }).split(" ");
    expect(secondary).toEqual(
      expect.arrayContaining([
        "[@media(hover:hover)]:[&:hover:not(:active)]:bg-cropy-surface-canvas",
        "active:bg-cropy-surface-canvas",
      ]),
    );
  });

  it("글자 크기·굵기·행간을 모두 남긴다", () => {
    // cn은 글자 크기가 행간보다 뒤에 오면 행간을 지운다. 클래스 순서가 바뀌면 여기서 잡힌다
    const normal = buttonClassName().split(" ");
    expect(normal).toEqual(expect.arrayContaining(["text-sm", "font-bold", "leading-6"]));

    const compact = buttonClassName({ size: "compact" }).split(" ");
    expect(compact).toEqual(
      expect.arrayContaining(["text-cropy-compact-button", "text-cropy-text-on-action"]),
    );
  });

  it("줄바꿈 규칙 두 개를 모두 남긴다", () => {
    // 어절 단위 줄바꿈과 넘칠 때만 끊기. 같은 묶음의 클래스로 쓰면 cn 이 하나를 지운다
    const classes = buttonClassName().split(" ");
    expect(classes).toEqual(expect.arrayContaining(["break-keep", "[overflow-wrap:break-word]"]));
  });

  it("비활성은 종류와 상관없이 같은 색이다", () => {
    expect(colorOf(buttonClassName({ variant: "secondary", disabled: true }))).toBe(
      colorOf(buttonClassName({ variant: "primary", disabled: true })),
    );
  });

  it("fullWidth일 때만 폭을 채운다", () => {
    expect(buttonClassName({ fullWidth: true }).split(" ")).toContain("w-full");
    expect(buttonClassName().split(" ")).not.toContain("w-full");
  });

  it("커서는 상태에 맞는 것 하나만 붙인다", () => {
    const cursors = (className: string) =>
      className.split(" ").filter((c) => c.startsWith("cursor-"));

    expect(cursors(buttonClassName())).toEqual(["cursor-pointer"]);
    expect(cursors(buttonClassName({ loading: true }))).toEqual(["cursor-wait"]);
    expect(cursors(buttonClassName({ disabled: true }))).toEqual(["cursor-not-allowed"]);
    expect(cursors(buttonClassName({ disabled: true, loading: true }))).toEqual([
      "cursor-not-allowed",
    ]);
  });

  it("비활성·진행 중이면 누름·호버 표시를 빼서 링크나 label에서도 눌리는 것처럼 보이지 않는다", () => {
    expect(hasInteraction(buttonClassName())).toBe(true);
    expect(hasInteraction(buttonClassName({ disabled: true }))).toBe(false);
    expect(hasInteraction(buttonClassName({ loading: true }))).toBe(false);
  });
});
