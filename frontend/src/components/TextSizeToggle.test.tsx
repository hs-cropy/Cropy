import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_SIZE_KEY, TextSizeToggle } from "./TextSizeToggle";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.textsize;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.textsize;
});

// 화면 폭에 따라 "큰 글자"(모바일)·"글자 크게"(md 부터) 중 하나만 보인다.
// jsdom 은 CSS 를 몰라 둘 다 이름에 들어가므로 앞부분으로 찾는다
function toggle() {
  return screen.getByRole("switch", { name: /큰 글자/ });
}

describe("TextSizeToggle", () => {
  it("기본은 꺼짐이다. 이름은 라벨뿐이고 상태는 aria-checked 로 알린다", () => {
    render(<TextSizeToggle />);

    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().textContent).toBe("큰 글자글자 크게");
  });

  it('모바일은 "큰 글자", md 부터는 Figma 데스크탑 헤더의 "글자 크게"를 보인다', () => {
    render(<TextSizeToggle />);

    expect(screen.getByText("큰 글자").className).toBe("md:hidden");
    expect(screen.getByText("글자 크게").className).toBe("hidden md:inline");
  });

  it("켜면 html 에 표시하고 저장한다", () => {
    render(<TextSizeToggle />);

    fireEvent.click(toggle());

    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.textsize).toBe("large");
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBe("large");
  });

  it("끄면 되돌리고 저장한다", () => {
    render(<TextSizeToggle />);

    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.textsize).toBe("normal");
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBe("normal");
  });

  it("첫 페인트 전에 큰 글자가 적용돼 있으면 켜진 상태로 보인다", () => {
    document.documentElement.dataset.textsize = "large";
    render(<TextSizeToggle />);

    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("저장이 막혀도 이번 화면에는 적용한다", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("저장할 수 없음");
    });
    render(<TextSizeToggle />);

    fireEvent.click(toggle());

    expect(setItem).toHaveBeenCalledWith(TEXT_SIZE_KEY, "large");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.textsize).toBe("large");
  });

  it("layout 의 인라인 스크립트와 같은 저장 키를 쓴다", () => {
    expect(TEXT_SIZE_KEY).toBe("cropcare:textsize");
  });

  it("배치용 className 을 스위치에 전달한다", () => {
    render(<TextSizeToggle className="xl:w-28" />);

    expect(Array.from(toggle().classList)).toContain("xl:w-28");
  });
});
