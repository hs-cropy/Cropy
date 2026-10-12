import { createRef, type FormEvent } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

function getSwitch(name: string) {
  return screen.getByRole("switch", { name }) as HTMLButtonElement;
}

function track(element: HTMLElement) {
  return element.querySelector("[aria-hidden]") as HTMLElement;
}

function thumb(element: HTMLElement) {
  return track(element).firstElementChild as HTMLElement;
}

describe("Switch", () => {
  it("켜짐 여부를 aria-checked로 알린다", () => {
    const { rerender } = render(<Switch checked={false}>큰 글자</Switch>);
    expect(getSwitch("큰 글자").getAttribute("aria-checked")).toBe("false");

    rerender(<Switch checked>큰 글자</Switch>);
    expect(getSwitch("큰 글자").getAttribute("aria-checked")).toBe("true");
  });

  it("누르면 바뀔 값을 onCheckedChange로 넘긴다", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={onCheckedChange}>
        음성
      </Switch>,
    );

    fireEvent.click(getSwitch("음성"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <Switch checked onCheckedChange={onCheckedChange}>
        음성
      </Switch>,
    );
    fireEvent.click(getSwitch("음성"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it("상태를 스스로 바꾸지 않는다", () => {
    // 음성 실행에 실패하면 쓰는 쪽이 꺼짐으로 되돌릴 수 있어야 한다
    render(
      <Switch checked={false} onCheckedChange={() => {}}>
        음성
      </Switch>,
    );

    fireEvent.click(getSwitch("음성"));

    expect(getSwitch("음성").getAttribute("aria-checked")).toBe("false");
  });

  it("onClick에서 막으면 값을 바꾸지 않는다", () => {
    const onCheckedChange = vi.fn();
    const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <Switch checked={false} onClick={onClick} onCheckedChange={onCheckedChange}>
        음성
      </Switch>,
    );

    fireEvent.click(getSwitch("음성"));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("비활성이면 누를 수 없고 상태는 그대로 알린다", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch checked disabled onCheckedChange={onCheckedChange}>
        음성
      </Switch>,
    );

    fireEvent.click(getSwitch("음성"));

    expect(getSwitch("음성").disabled).toBe(true);
    expect(getSwitch("음성").getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("키보드로 누를 수 있는 버튼이고 눌림 버튼 속성은 쓰지 않는다", () => {
    render(<Switch checked={false}>큰 글자</Switch>);
    const element = getSwitch("큰 글자");

    expect(element.tagName).toBe("BUTTON");
    expect(element.hasAttribute("aria-pressed")).toBe(false);
  });

  it("이름은 라벨뿐이고 스위치 그림은 읽지 않는다", () => {
    render(<Switch checked>큰 글자</Switch>);

    // 상태 문구가 이름에 섞이면 "큰 글자 켜짐, 스위치, 켜짐"으로 두 번 읽힌다
    expect(getSwitch("큰 글자").textContent).toBe("큰 글자");
    expect(track(getSwitch("큰 글자")).getAttribute("aria-hidden")).toBe("true");
  });

  it("form 안에서 눌러도 제출하지 않는다", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Switch checked={false}>큰 글자</Switch>
      </form>,
    );

    fireEvent.click(getSwitch("큰 글자"));

    expect(getSwitch("큰 글자").type).toBe("button");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("aria-label 로 이름을 고정하면 보이는 글자가 달라도 같은 이름으로 찾는다", () => {
    render(
      <Switch checked={false} aria-label="음성 안내">
        음성
      </Switch>,
    );

    expect(getSwitch("음성 안내").textContent).toBe("음성");
  });

  it("ref로 초점을 옮길 수 있고 className과 나머지 속성을 전달한다", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Switch ref={ref} checked={false} className="w-28" aria-describedby="hint">
        큰 글자
      </Switch>,
    );

    ref.current?.focus();

    expect(document.activeElement).toBe(getSwitch("큰 글자"));
    expect(getSwitch("큰 글자").classList.contains("w-28")).toBe(true);
    expect(getSwitch("큰 글자").getAttribute("aria-describedby")).toBe("hint");
  });
});

// 디자인 시스템(Cropy/V2/Toggle) 사양표. 값이 바뀌면 디자인과 어긋난 것이므로
// 클래스 이름까지 고정한다
describe("Switch — 디자인 시스템 사양", () => {
  it("버튼은 44px·모서리 12px·흰 배경에 테두리다", () => {
    render(<Switch checked={false}>큰 글자</Switch>);

    expect(Array.from(getSwitch("큰 글자").classList)).toEqual(
      expect.arrayContaining([
        "min-h-cropy-control-md",
        "rounded-xl",
        "border-cropy-border",
        "bg-cropy-surface",
        "p-2",
        "gap-1.5",
        "md:gap-2",
      ]),
    );
  });

  it("라벨은 12px Medium이고 md 부터 13px이다. 글자색과 서로 지우지 않는다", () => {
    render(<Switch checked={false}>큰 글자</Switch>);

    expect(Array.from(getSwitch("큰 글자").classList)).toEqual(
      expect.arrayContaining([
        "text-cropy-label-xs",
        "font-medium",
        "md:text-cropy-caption",
        "md:font-medium",
        "text-cropy-text-secondary",
      ]),
    );
  });

  it("트랙은 30×18에서 md 부터 36×20, 손잡이는 14에서 16이다", () => {
    render(<Switch checked={false}>큰 글자</Switch>);
    const element = getSwitch("큰 글자");

    expect(Array.from(track(element).classList)).toEqual(
      expect.arrayContaining(["w-[1.875rem]", "h-[1.125rem]", "md:w-9", "md:h-5", "shrink-0"]),
    );
    expect(Array.from(thumb(element).classList)).toEqual(
      expect.arrayContaining(["w-3.5", "h-3.5", "md:w-4", "md:h-4", "left-0.5", "top-0.5"]),
    );
  });

  it("꺼짐은 회색 트랙에 손잡이가 왼쪽, 켜짐은 초록 트랙에 손잡이가 오른쪽이다", () => {
    const { rerender } = render(<Switch checked={false}>큰 글자</Switch>);
    let element = getSwitch("큰 글자");
    expect(track(element).classList.contains("bg-cropy-border")).toBe(true);
    expect(thumb(element).classList.contains("translate-x-0")).toBe(true);

    rerender(<Switch checked>큰 글자</Switch>);
    element = getSwitch("큰 글자");
    expect(track(element).classList.contains("bg-cropy-action-primary")).toBe(true);
    expect(track(element).classList.contains("bg-cropy-border")).toBe(false);
    expect(Array.from(thumb(element).classList)).toEqual(
      expect.arrayContaining(["translate-x-3", "md:translate-x-4"]),
    );
  });

  it("비활성은 전체를 48%로 흐리게 하고 커서를 바꾼다", () => {
    const { rerender } = render(<Switch checked={false}>큰 글자</Switch>);
    expect(getSwitch("큰 글자").classList.contains("cursor-pointer")).toBe(true);

    rerender(
      <Switch checked={false} disabled>
        큰 글자
      </Switch>,
    );
    const classes = Array.from(getSwitch("큰 글자").classList);
    expect(classes).toEqual(expect.arrayContaining(["opacity-[0.48]", "cursor-not-allowed"]));
    expect(classes).not.toContain("cursor-pointer");
  });
});
