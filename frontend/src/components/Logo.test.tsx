import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("이름이 Cropy인 이미지다", () => {
    render(<Logo />);

    const image = screen.getByRole("img", { name: "Cropy" }) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/brand/cropy-logo.png");
  });

  it("불러오기 전에도 자리를 잡도록 파일의 가로·세로를 적는다", () => {
    render(<Logo />);

    const image = screen.getByRole("img", { name: "Cropy" });
    expect(Number(image.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(image.getAttribute("height"))).toBeGreaterThan(0);
  });

  it("링크 안에서는 alt를 비워 장식으로 둘 수 있다", () => {
    const { container } = render(<Logo alt="" />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("기본은 모바일 헤더 크기(70×44px)이고 className으로 다른 크기를 준다", () => {
    const { rerender } = render(<Logo />);
    expect(Array.from(screen.getByRole("img").classList)).toEqual(
      expect.arrayContaining(["h-11", "w-[4.375rem]", "object-contain"]),
    );

    rerender(<Logo className="h-14 w-[5.25rem]" />);
    const classes = Array.from(screen.getByRole("img").classList);
    expect(classes).toEqual(expect.arrayContaining(["h-14", "w-[5.25rem]", "object-contain"]));
    expect(classes).not.toContain("h-11");
  });
});
