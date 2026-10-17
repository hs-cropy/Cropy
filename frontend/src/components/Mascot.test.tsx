import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Mascot, MASCOT_NAMES, mascotSrc } from "./Mascot";

// 어디서 실행해도 같은 폴더를 보도록 이 파일 위치에서 찾는다
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

function image(container: HTMLElement) {
  return container.querySelector("img") as HTMLImageElement;
}

describe("Mascot", () => {
  it("기본은 장식이라 스크린리더가 읽지 않는다", () => {
    const { container } = render(<Mascot name="greeting" />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(image(container).getAttribute("alt")).toBe("");
    expect(image(container).getAttribute("src")).toBe("/mascot/greeting.png");
  });

  it("옆에 글이 없으면 alt로 이름을 준다", () => {
    render(<Mascot name="empty" alt="아직 기록이 없어요" />);

    expect(screen.getByRole("img", { name: "아직 기록이 없어요" })).toBeTruthy();
  });

  it("불러오기 전에도 자리를 잡도록 파일의 가로·세로를 적는다", () => {
    const { container } = render(<Mascot name="greeting" />);

    expect(image(container).getAttribute("width")).toBe("288");
    expect(image(container).getAttribute("height")).toBe("288");
  });

  it("ref·className·나머지 속성을 전달하고 className으로 크기를 바꿀 수 있다", () => {
    const ref = createRef<HTMLImageElement>();
    const { container } = render(
      <Mascot ref={ref} name="greeting" className="size-14" loading="lazy" />,
    );
    const classes = Array.from(image(container).classList);

    expect(ref.current).toBe(image(container));
    expect(classes).toContain("size-14");
    expect(classes).not.toContain("size-24");
    expect(ref.current?.getAttribute("loading")).toBe("lazy");
  });

  it("src는 밖에서 바꿀 수 없다", () => {
    const { container } = render(
      // @ts-expect-error 그림은 name 으로만 고른다
      <Mascot name="greeting" src="/other.png" />,
    );

    expect(image(container).getAttribute("src")).toBe("/mascot/greeting.png");
  });
});

describe("Mascot — 이름과 파일", () => {
  it("화면용 13종, 피드백 전용 4종, 피드백 별칭 3종이 있다", () => {
    expect(MASCOT_NAMES).toHaveLength(20);
    expect(new Set(MASCOT_NAMES).size).toBe(20);
  });

  it.each(MASCOT_NAMES)("%s 의 파일이 public/mascot 에 있다", (name) => {
    expect(existsSync(path.join(PUBLIC_DIR, mascotSrc(name)))).toBe(true);
  });

  it("public/mascot 에 쓰지 않는 파일이 없다", () => {
    const used = new Set(MASCOT_NAMES.map((name) => path.basename(mascotSrc(name))));

    const files = readdirSync(path.join(PUBLIC_DIR, "mascot")).filter((f) => f.endsWith(".png"));

    expect(files.sort()).toEqual([...used].sort());
  });

  it("파일은 모두 img 에 적은 크기(288×288)다", () => {
    const sizes = new Set(
      MASCOT_NAMES.map((name) => {
        // PNG 는 16번째 바이트부터 가로·세로가 4바이트씩 들어 있다
        const header = readFileSync(path.join(PUBLIC_DIR, mascotSrc(name)));
        return `${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`;
      }),
    );

    expect([...sizes]).toEqual(["288x288"]);
  });

  // Figma 의 Cropy/FeedbackV3/Mascot/* 이름 9개를 그대로 쓸 수 있어야 한다
  it.each([
    ["confirmation", "/mascot/confirmation.png"],
    ["connection", "/mascot/connection.png"],
    ["warning", "/mascot/warning.png"],
    ["healthy", "/mascot/healthy.png"],
    ["analysis", "/mascot/analyzing.png"],
    ["saved", "/mascot/saved.png"],
    ["empty", "/mascot/empty.png"],
    ["photo", "/mascot/retake.png"],
    ["info", "/mascot/help.png"],
  ] as const)("피드백 이름 %s 는 %s 를 쓴다", (name, src) => {
    expect(mascotSrc(name)).toBe(src);
  });
});

// Figma 가이드의 크기: 화면 96px, 데스크탑 피드백 80px, 카메라 꺼짐 72px, 모바일 피드백 64px,
// 토스트 50px. rem 이라 큰글씨 모드에서 글자와 함께 커진다
describe("Mascot — 디자인 사양", () => {
  it.each([
    [50, "size-[3.125rem]"],
    [64, "size-16"],
    [72, "size-[4.5rem]"],
    [80, "size-20"],
    [96, "size-24"],
  ] as const)("size=%i 는 %s 다", (size, expected) => {
    const { container } = render(<Mascot name="greeting" size={size} />);

    expect(Array.from(image(container).classList)).toEqual(
      expect.arrayContaining([expected, "shrink-0", "object-contain"]),
    );
  });

  it("기본 크기는 96px이다", () => {
    const { container } = render(<Mascot name="greeting" />);

    expect(Array.from(image(container).classList)).toContain("size-24");
  });
});
