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


  it("모바일은 화면 높이에 맞추고 데스크톱은 콘텐츠 높이를 허용한다", () => {
    render(<AppShell data-testid="shell">화면</AppShell>);

    const shell = classes(screen.getByTestId("shell"));

    expect(shell).toEqual(
      expect.arrayContaining([
        "flex",
        "flex-col",
        "h-screen",
        "min-h-0",
        "overflow-hidden",
        "supports-[height:100dvh]:h-dvh",
        "lg:h-auto",
        "lg:min-h-screen",
        "lg:overflow-visible",
        "bg-cropy-surface",
      ]),
    );
  });

  it("인쇄할 때 높이 제한과 잘림 없이 콘텐츠를 표시한다", () => {
    render(
      <AppShell data-testid="shell">
        <AppShellPage>화면</AppShellPage>
      </AppShell>,
    );

    const shell = classes(screen.getByTestId("shell"));

    expect(shell).toEqual(
      expect.arrayContaining([
        "print:!h-auto",
        "print:!min-h-0",
        "print:!overflow-visible",
      ]),
    );
  });

  it("화면 영역은 남는 공간을 사용하면서 콘텐츠 높이에 따라 늘어난다", () => {
    render(
      <AppShell>
        <main>화면</main>
      </AppShell>,
    );

    const wrapper = screen.getByRole("main").parentElement as Element;

    expect(classes(wrapper)).toEqual(
      expect.arrayContaining(["flex", "min-w-0", "flex-1", "flex-col"]),
    );
  });

  it("모바일 내비는 화면 아래에 고정하고 lg부터 숨긴다", () => {
    const { rerender } = render(
      <AppShell data-testid="shell" nav={<nav aria-label="하단 메뉴">내비</nav>}>
        화면
      </AppShell>,
    );
    expect(classes(screen.getByRole("navigation").parentElement as Element)).toEqual(
      expect.arrayContaining(["fixed", "inset-x-0", "bottom-0", "z-50", "lg:hidden"]),
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
  
  it("모바일 내비 높이와 안전 영역만큼 본문 아래에 여백을 확보한다", () => {
    render(
      <AppShell nav={<nav>내비</nav>}>
        <main>화면</main>
      </AppShell>,
    );

    const wrapper = screen.getByRole("main").parentElement as Element;

    expect(classes(wrapper)).toContain(
      "pb-[calc(4.5rem+env(safe-area-inset-bottom))]",
    );
    expect(classes(wrapper)).toContain("lg:pb-0");
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

  it("제목과 본문은 스크롤 영역에, 행동 영역은 그 아래에 배치한다", () => {
    const main = renderPage();
    const children = Array.from(main.children);

    const region = screen.getByRole("region", {
      name: "본문",
    });

    const head = screen.getByTestId("head");
    const actions = screen.getByTestId("actions");

    // main의 직접 자식은 스크롤 영역과 행동 영역 2개
    expect(children).toHaveLength(2);
    expect(children[0]).toBe(region);

    // 제목은 스크롤 영역 내부
    expect(region.contains(head)).toBe(true);

    // 본문 역시 같은 스크롤 영역 내부
    expect(region.contains(screen.getByText("본문 하나"))).toBe(true);
    expect(region.contains(screen.getByText("본문 둘"))).toBe(true);

    // 행동 영역은 스크롤 영역 바깥
    expect(children[1].contains(actions)).toBe(true);
    expect(region.contains(actions)).toBe(false);
  });

  it("모바일에서 제목과 본문은 함께 스크롤하고 행동 영역은 분리한다", () => {
    const main = renderPage();

    const region = screen.getByRole("region", {
      name: "본문",
    });

    const head = screen.getByTestId("head");
    const actions = screen.getByTestId("actions");

    expect(classes(region)).toEqual(
      expect.arrayContaining([
        "min-h-0",
        "flex-1",
        "overflow-y-auto",
        "overscroll-contain",
        "lg:overflow-visible",
      ]),
    );

    // 제목도 본문 스크롤 영역에 포함
    expect(region.contains(head)).toBe(true);

    // 본문도 동일한 스크롤 영역에 포함
    expect(region.contains(screen.getByText("본문 하나"))).toBe(true);

    // 행동 영역은 스크롤 영역 밖에 유지
    expect(region.contains(actions)).toBe(false);

    // main에는 스크롤 영역과 행동 영역만 존재
    expect(main.children).toHaveLength(2);
    expect(main.children[0]).toBe(region);
    expect(main.children[1].contains(actions)).toBe(true);
  });

  it("본문은 일반 Tab 이동에서 제외하고 화면 전환 시 초점을 받을 수 있다", () => {
    renderPage();

    const region = screen.getByRole("region", { name: "본문" });

    expect(region.getAttribute("tabindex")).toBe("-1");

    region.focus();
    expect(document.activeElement).toBe(region);
  });

  it("본문 영역의 접근성 이름을 변경할 수 있다", () => {
    render(
      <AppShellPage scrollLabel="진단 이력 목록">
        목록
      </AppShellPage>,
    );

    expect(
      screen.getByRole("region", { name: "진단 이력 목록" }),
    ).toBeTruthy();
  });

  it("본문 여백과 콘텐츠 간격 및 최대 너비를 유지한다", () => {
    renderPage();

    const scroll = screen.getByRole("region", {
      name: "본문",
    });

    expect(classes(scroll)).toEqual(
      expect.arrayContaining([
        "px-6",
        "pb-5",
        "lg:pb-6",
        "xl:px-16",
      ]),
    );

    const titleWrapper = scroll.children[0];
    const contentWrapper = scroll.children[1];

    // 제목 래퍼
    expect(titleWrapper.contains(screen.getByTestId("head"))).toBe(true);

    // 본문 래퍼
    expect(classes(contentWrapper)).toEqual(
      expect.arrayContaining([
        "mx-auto",
        "flex",
        "w-full",
        "max-w-[75rem]",
        "flex-col",
        "gap-4",
      ]),
    );

    expect(
      contentWrapper.contains(screen.getByText("본문 하나")),
    ).toBe(true);
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
