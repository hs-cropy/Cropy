import { existsSync } from "node:fs";
import path from "node:path";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell, AppShellFooter, AppShellPage } from "./AppShell";

// 어디서 실행해도 같은 폴더를 보도록 이 파일 위치에서 찾는다
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

function classes(element: Element) {
  return Array.from(element.classList);
}

describe("AppShell", () => {
  it("헤더 → 화면 → 내비 → 푸터 순서로 놓는다", () => {
    render(
      <AppShell
        data-testid="shell"
        header={<header>헤더</header>}
        nav={<nav aria-label="하단 메뉴">내비</nav>}
        footer={<footer>푸터</footer>}
      >
        <main>화면</main>
      </AppShell>,
    );
    const shell = screen.getByTestId("shell");

    // 맨 앞은 배경이다
    expect(Array.from(shell.children).map((child) => child.textContent)).toEqual([
      "",
      "헤더",
      "화면",
      "내비",
      "푸터",
    ]);
  });

  it("화면 높이를 꽉 채우고 틀 자체는 스크롤되지 않는다", () => {
    render(<AppShell data-testid="shell">화면</AppShell>);

    expect(classes(screen.getByTestId("shell"))).toEqual(
      expect.arrayContaining([
        "flex",
        "flex-col",
        "h-screen",
        "supports-[height:100dvh]:h-dvh",
        "overflow-hidden",
        "bg-cropy-surface",
      ]),
    );
  });

  it("화면 자리는 남은 높이를 차지하고 안쪽이 줄어들 수 있다", () => {
    render(
      <AppShell>
        <main>화면</main>
      </AppShell>,
    );

    expect(classes(screen.getByRole("main").parentElement as Element)).toEqual(
      expect.arrayContaining(["flex", "min-h-0", "flex-1", "flex-col"]),
    );
  });

  it("모바일 내비는 lg부터 숨긴다. 내비가 없으면 자리를 만들지 않는다", () => {
    const { rerender } = render(
      <AppShell data-testid="shell" nav={<nav aria-label="하단 메뉴">내비</nav>}>
        화면
      </AppShell>,
    );
    expect(classes(screen.getByRole("navigation").parentElement as Element)).toEqual(
      expect.arrayContaining(["shrink-0", "lg:hidden"]),
    );

    rerender(<AppShell data-testid="shell">화면</AppShell>);
    expect(screen.getByTestId("shell").children).toHaveLength(2);

    rerender(
      <AppShell data-testid="shell" nav={null}>
        화면
      </AppShell>,
    );
    expect(screen.getByTestId("shell").children).toHaveLength(2);
  });

  it("농장 배경은 장식이고 24%로 깔린다. 넓은 화면에서는 가로 사진을 쓴다", () => {
    const { container } = render(<AppShell>화면</AppShell>);
    const image = container.querySelector("img") as HTMLImageElement;
    const source = container.querySelector("source") as HTMLSourceElement;

    expect(image.closest("[aria-hidden]")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(image.getAttribute("alt")).toBe("");
    expect(classes(image)).toEqual(expect.arrayContaining(["object-cover", "opacity-[0.24]"]));
    expect(image.getAttribute("src")).toBe("/background/farm-mobile.webp");
    expect(source.getAttribute("srcset")).toBe("/background/farm-desktop.webp");
    expect(source.getAttribute("media")).toBe("(min-width: 1024px)");
  });

  it.each(["/background/farm-mobile.webp", "/background/farm-desktop.webp"])(
    "배경 파일 %s 가 public 에 있다",
    (src) => {
      expect(existsSync(path.join(PUBLIC_DIR, src))).toBe(true);
    },
  );

  it("ref·className·나머지 속성을 전달한다", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <AppShell ref={ref} className="max-h-[60rem]" data-testid="shell">
        화면
      </AppShell>,
    );

    expect(ref.current).toBe(screen.getByTestId("shell"));
    expect(classes(ref.current as HTMLElement)).toContain("max-h-[60rem]");
  });
});

describe("AppShellPage", () => {
  function renderPage() {
    render(
      <AppShellPage
        header={<div data-testid="head">제목 영역</div>}
        actions={<div data-testid="actions">행동 영역</div>}
      >
        <p>본문 하나</p>
        <p>본문 둘</p>
      </AppShellPage>,
    );
    return screen.getByRole("main");
  }

  it("화면의 main이고 제목 영역 → 본문 → 행동 영역 순서로 놓는다", () => {
    const main = renderPage();

    expect(Array.from(main.children)).toEqual([
      screen.getByTestId("head"),
      screen.getByRole("region", { name: "본문" }),
      screen.getByTestId("actions"),
    ]);
  });

  it("본문만 스크롤된다. 제목 영역과 행동 영역은 스크롤 영역 밖에 있다", () => {
    renderPage();
    const scroll = screen.getByRole("region", { name: "본문" });

    expect(classes(scroll)).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto", "overflow-x-hidden"]),
    );
    expect(scroll.contains(screen.getByText("본문 하나"))).toBe(true);
    expect(scroll.contains(screen.getByTestId("head"))).toBe(false);
    expect(scroll.contains(screen.getByTestId("actions"))).toBe(false);
  });

  it("본문 영역은 키보드로 스크롤할 수 있게 Tab으로 닿고, 이름을 바꿀 수 있다", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "본문" }).getAttribute("tabindex")).toBe("0");

    render(<AppShellPage scrollLabel="진단 이력 목록">목록</AppShellPage>);
    expect(screen.getByRole("region", { name: "진단 이력 목록" })).toBeTruthy();
  });

  it("본문은 좌우 24px·아래 20px이고 덩어리 간격은 16px, 최대 폭은 1200px이다", () => {
    renderPage();
    const scroll = screen.getByRole("region", { name: "본문" });

    expect(classes(scroll)).toEqual(
      expect.arrayContaining(["px-6", "pb-5", "lg:pb-6", "xl:px-16"]),
    );
    expect(classes(scroll.firstElementChild as Element)).toEqual(
      expect.arrayContaining(["flex-col", "gap-4", "max-w-[75rem]", "mx-auto"]),
    );
  });

  it("제목 영역과 행동 영역이 없으면 본문만 그린다", () => {
    render(<AppShellPage>본문</AppShellPage>);

    expect(screen.getByRole("main").children).toHaveLength(1);
  });

  it("ref·className·나머지 속성을 main에 전달한다", () => {
    const ref = createRef<HTMLElement>();
    render(
      <AppShellPage ref={ref} id="content" className="bg-cropy-surface-canvas">
        본문
      </AppShellPage>,
    );

    expect(ref.current).toBe(screen.getByRole("main"));
    expect(ref.current?.id).toBe("content");
    expect(classes(ref.current as HTMLElement)).toEqual(
      expect.arrayContaining(["bg-cropy-surface-canvas", "min-h-0", "flex-1"]),
    );
  });
});

describe("AppShellFooter", () => {
  it("서비스 이름과 AI 진단 안내 문구를 보여 주는 footer다", () => {
    render(<AppShellFooter />);
    const footer = screen.getByRole("contentinfo");

    expect(footer.textContent).toContain("Cropy");
    expect(footer.textContent).toContain(
      "AI 진단은 참고 정보입니다. 정확한 판단이 필요하면 지역 농업기술센터에 문의하세요.",
    );
  });

  it("데스크탑에만 보이고 높이 64px·위 테두리·흰 배경 96%다", () => {
    render(<AppShellFooter />);
    const footer = screen.getByRole("contentinfo");

    expect(classes(footer)).toEqual(
      expect.arrayContaining([
        "hidden",
        "lg:flex",
        "min-h-16",
        "shrink-0",
        "border-t",
        "border-cropy-border",
        "bg-cropy-surface/[0.96]",
        "xl:px-16",
      ]),
    );
    expect(classes(footer.firstElementChild as Element)).toEqual(
      expect.arrayContaining(["gap-6", "max-w-[75rem]"]),
    );
  });
});
