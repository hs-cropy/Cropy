import { renderToString } from "react-dom/server";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_DOCK_SHOW_DELAY, ActionDock } from "./ActionDock";

function classes(element: Element) {
  return Array.from(element.classList);
}

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

// 움직이는 안쪽(버튼의 부모)을 돌려준다. 화면에 붙어 있는 틀은 그 부모다
function renderDock() {
  render(
    <main>
      <ActionDock>
        <button type="button">사진 선택</button>
      </ActionDock>
    </main>,
  );
  return screen.getByRole("button", { name: "사진 선택" }).parentElement as HTMLElement;
}

// 문서 높이 3000, 화면 높이 768 → 끝까지 내린 위치는 2232 (jsdom 은 문서·화면 높이가 0 이다)
const DOCUMENT_HEIGHT = 3000;
const VIEWPORT_HEIGHT = 768;
const MAX_SCROLL = DOCUMENT_HEIGHT - VIEWPORT_HEIGHT;

function setDocumentHeight(height: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: height,
  });
}

describe("ActionDock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: VIEWPORT_HEIGHT,
    });
    setDocumentHeight(DOCUMENT_HEIGHT);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { scrollY?: number }).scrollY;
    // 자기 속성을 지우면 jsdom 의 원래 getter 로 돌아간다
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
    delete (document.documentElement as { clientHeight?: number }).clientHeight;
  });

  it("모바일은 내비처럼 화면에 fixed 로 붙어 내비 바로 위에 있고, lg부터는 sticky 로 맨 아래다", () => {
    const dock = renderDock();
    const frame = dock.parentElement as HTMLElement;

    expect(classes(frame)).toEqual(
      expect.arrayContaining([
        "fixed",
        "inset-x-0",
        "z-10",
        "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]",
        "lg:sticky",
        "lg:inset-x-auto",
        "lg:bottom-0",
        "print:static",
      ]),
    );
    // 모바일에서 sticky 는 iOS 바운스·도구막대 변화 때 fixed 내비와 어긋난다
    expect(classes(frame)).not.toContain("sticky");
    expect(classes(dock)).toContain("transition-transform");
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("처음 HTML 에서는 높이를 재기 전이라 가장 큰 틀 높이만큼 비워 둔다 (본문 끝이 가려지지 않게)", () => {
    const html = renderToString(
      <ActionDock>
        <button type="button">사진 선택</button>
      </ActionDock>,
    );
    const spacer = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("[data-action-dock-spacer]") as HTMLElement;

    expect(classes(spacer)).toContain("h-[9rem]");
    // 높이를 덮는 style 이 없어야 기본 높이가 쓰인다
    expect(spacer.getAttribute("style")).toBeNull();
  });

  it("흐름에서 빠진 틀 높이만큼 앞에 빈 칸을 둔다 (모바일만, 스크린리더에는 숨김)", () => {
    // ResizeObserver 가 없는 브라우저에서도 처음 한 번은 잰다
    vi.stubGlobal("ResizeObserver", undefined);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(84);
    const dock = renderDock();
    const frame = dock.parentElement as HTMLElement;
    const spacer = frame.previousElementSibling as HTMLElement;

    expect(spacer.hasAttribute("data-action-dock-spacer")).toBe(true);
    expect(spacer.getAttribute("aria-hidden")).toBe("true");
    expect(classes(spacer)).toEqual(expect.arrayContaining(["lg:hidden", "print:hidden"]));
    // 잰 높이가 기본 높이(9rem)를 덮는다
    expect(spacer.style.height).toBe("84px");

    // 숨겨도 틀 높이는 그대로라 빈 칸이 출렁이지 않는다
    scrollTo(300);
    expect(classes(dock)).toContain("translate-y-full");
    expect(spacer.style.height).toBe("84px");
  });

  it("틀 높이가 바뀌면(버튼 수·큰글씨) 빈 칸이 따라가고, 사라질 때 관찰을 멈춘다", () => {
    let notify: () => void = () => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    class FakeResizeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    let frameHeight = 84;
    // 모의 함수와 전역 바꿔치기는 설정(restoreMocks·unstubAllGlobals)이 테스트마다 되돌린다
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => frameHeight);

    const { unmount } = render(
      <ActionDock>
        <button type="button">사진 선택</button>
      </ActionDock>,
    );
    const frame = screen.getByRole("button").parentElement?.parentElement as HTMLElement;
    const spacer = frame.previousElementSibling as HTMLElement;
    expect(observe).toHaveBeenCalledWith(frame);
    expect(spacer.style.height).toBe("84px");

    frameHeight = 144;
    act(() => notify());
    expect(spacer.style.height).toBe("144px");

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("숨을 때 틀은 제자리에 두고 안쪽만 내려, 밀려난 만큼 문서가 길어지지 않게 틀이 잘라 낸다", () => {
    const dock = renderDock();
    const frame = dock.parentElement as HTMLElement;

    // clip 은 스크롤 상자를 만들지 않는다. hidden 은 clip 을 모르는 옛 Safari 용이다
    expect(classes(frame)).toEqual(
      expect.arrayContaining([
        "overflow-hidden",
        "supports-[overflow:clip]:overflow-clip",
        "print:overflow-visible",
      ]),
    );

    scrollTo(300);
    expect(classes(dock)).toContain("translate-y-full");
    expect(classes(frame)).not.toContain("translate-y-full");
  });

  it("아래로 스크롤하는 동안 숨고, 멈추면 다시 나온다", () => {
    const dock = renderDock();
    const frame = dock.parentElement as HTMLElement;

    scrollTo(300);
    expect(classes(dock)).toContain("translate-y-full");
    // 비어 있는 틀이 아래 본문의 누름을 가로채지 않는다
    expect(classes(frame)).toContain("pointer-events-none");
    expect(frame.dataset.hidden).toBe("true");

    // 스크롤이 이어지면 기다리는 시간이 다시 시작된다
    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY - 50));
    scrollTo(400);
    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY - 50));
    expect(classes(dock)).toContain("translate-y-full");

    act(() => vi.advanceTimersByTime(50));
    expect(classes(dock)).not.toContain("translate-y-full");
    expect(classes(frame)).not.toContain("pointer-events-none");
    expect(frame.dataset.hidden).toBeUndefined();
  });

  it("숨은 뒤 위치가 그대로인 scroll 이벤트가 와도 멈추면 다시 나온다", () => {
    const dock = renderDock();

    scrollTo(300);
    act(() => vi.advanceTimersByTime(100));
    scrollTo(300);
    expect(classes(dock)).toContain("translate-y-full");

    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY));
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("위로 스크롤하면 바로 나온다", () => {
    const dock = renderDock();

    scrollTo(600);
    expect(classes(dock)).toContain("translate-y-full");

    scrollTo(500);
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("문서 맨 위 근처에서는 숨기지 않는다", () => {
    const dock = renderDock();

    scrollTo(20);
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("문서 끝 근처에서도 아래로 스크롤하는 동안 숨고, 멈추면 다시 나온다", () => {
    const dock = renderDock();

    // End 키처럼 끝까지 한 번에 건너뛰어도 바로 나오지 않는다
    scrollTo(300);
    scrollTo(MAX_SCROLL);
    expect(classes(dock)).toContain("translate-y-full");

    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY - 1));
    expect(classes(dock)).toContain("translate-y-full");
    act(() => vi.advanceTimersByTime(1));
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("문서 끝을 지나 당겨지는 바운스 구간에서는 숨지 않는다", () => {
    const dock = renderDock();

    scrollTo(MAX_SCROLL);
    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY));
    expect(classes(dock)).not.toContain("translate-y-full");

    // 끝을 넘었다가 되돌아와도 숨거나 튀지 않는다
    scrollTo(MAX_SCROLL + 40);
    expect(classes(dock)).not.toContain("translate-y-full");
    scrollTo(MAX_SCROLL + 10);
    scrollTo(MAX_SCROLL);
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("숨은 채로 바운스되면 되돌아오는 움직임에 바로 튀어나오지 않고, 멈추면 나온다", () => {
    const dock = renderDock();

    scrollTo(MAX_SCROLL - 100);
    scrollTo(MAX_SCROLL + 40);
    expect(classes(dock)).toContain("translate-y-full");

    // 바운스가 끝으로 되돌아오는 동안에도 숨은 채로 있다
    scrollTo(MAX_SCROLL + 10);
    scrollTo(MAX_SCROLL);
    expect(classes(dock)).toContain("translate-y-full");

    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY));
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("한 번에 끝을 넘어 튕겨도 아래로 내린 것이니 숨고, 되돌아오는 동안 튀어나오지 않는다", () => {
    const dock = renderDock();

    scrollTo(MAX_SCROLL - 100);
    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY));
    expect(classes(dock)).not.toContain("translate-y-full");

    scrollTo(MAX_SCROLL + 40);
    expect(classes(dock)).toContain("translate-y-full");

    scrollTo(MAX_SCROLL + 10);
    scrollTo(MAX_SCROLL);
    expect(classes(dock)).toContain("translate-y-full");

    // 되돌아오는 움직임이 타이머를 다시 세지도 않는다
    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY));
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("끝 위치가 앞당겨진 뒤(내용이 줄거나 도구막대가 접힘) 끝에 머물러도 위로 올린 것으로 보지 않는다", () => {
    const dock = renderDock();

    scrollTo(MAX_SCROLL);
    expect(classes(dock)).toContain("translate-y-full");

    // 문서가 짧아져 끝이 50px 앞당겨지고, 위치도 새 끝으로 맞춰진다
    setDocumentHeight(DOCUMENT_HEIGHT - 50);
    scrollTo(MAX_SCROLL);
    scrollTo(MAX_SCROLL - 50);
    // 위로 50px 올린 것으로 읽혀 바로 나오지는 않는다 (끝에서 잘라 읽으므로 움직임이 없다)
    expect(classes(dock)).toContain("translate-y-full");
  });

  it("위쪽 바운스(0보다 작은 위치)에서는 보인다", () => {
    const dock = renderDock();

    scrollTo(300);
    expect(classes(dock)).toContain("translate-y-full");

    scrollTo(-30);
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("조금씩 내린 것은 숨기지 않다가, 쌓여서 기준을 넘으면 숨는다", () => {
    const dock = renderDock();

    scrollTo(100);
    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY));
    expect(classes(dock)).not.toContain("translate-y-full");

    scrollTo(102);
    scrollTo(104);
    expect(classes(dock)).not.toContain("translate-y-full");

    scrollTo(106);
    expect(classes(dock)).toContain("translate-y-full");
  });

  it("숨을 때와 나올 때 모두 전환한다", () => {
    const dock = renderDock();

    scrollTo(300);
    expect(classes(dock)).toEqual(expect.arrayContaining(["translate-y-full", "transition-transform"]));

    act(() => vi.advanceTimersByTime(ACTION_DOCK_SHOW_DELAY));
    expect(classes(dock)).not.toContain("translate-y-full");
    expect(classes(dock)).toContain("transition-transform");
  });

  it("스크롤할 거리가 짧아도 아래로 내리면 숨는다", () => {
    const dock = renderDock();

    scrollTo(30);
    expect(classes(dock)).toContain("translate-y-full");
  });

  it("안의 버튼에 초점이 있으면 숨기지 않고, 숨어 있다가 초점을 받으면 나온다", () => {
    const dock = renderDock();
    const frame = dock.parentElement as HTMLElement;
    const button = screen.getByRole("button", { name: "사진 선택" });

    scrollTo(300);
    expect(classes(dock)).toContain("translate-y-full");

    // 초점 이동이 틀 안쪽을 스크롤해 두었더라도(옛 Safari) 되돌린다
    frame.scrollTop = 40;
    act(() => button.focus());
    expect(classes(dock)).not.toContain("translate-y-full");
    expect(classes(frame)).not.toContain("pointer-events-none");
    expect(frame.dataset.hidden).toBeUndefined();
    expect(frame.scrollTop).toBe(0);

    scrollTo(500);
    expect(classes(dock)).not.toContain("translate-y-full");
  });

  it("사라질 때 스크롤 감시를 멈춘다", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ActionDock>버튼</ActionDock>);

    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    remove.mockRestore();
  });
});
