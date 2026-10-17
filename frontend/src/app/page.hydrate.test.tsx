import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeSpeech } from "@/features/voice/testing/fakeSpeech";
import { DiagnosisSessionProvider } from "@/components/diagnosis/DiagnosisSession";
import Page from "./page";

vi.mock("next/navigation", async () => (await import("@/testing/fakeNavigation")).nextNavigation);

// 앱에서는 앱 틀(AppFrame)이 진단 상태를 준다
function HomePage() {
  return (
    <DiagnosisSessionProvider>
      <Page />
    </DiagnosisSessionProvider>
  );
}

// 촬영 화면의 최근 진단 카드가 부른다. 기록이 없으면 카드를 그리지 않는다
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchHistory: vi.fn(() =>
    Promise.resolve({ items: [], total: 0, page: 1, size: 1, unfiltered_total: 0, crop_total: 0 }),
  ),
}));

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  installFakeSpeech();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

// 서버 HTML 을 넣고, 브라우저 폭을 정한 뒤 하이드레이션한다 (새로고침과 같은 순서)
async function refresh(desktop: boolean) {
  container.innerHTML = renderToString(<HomePage />);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop && query === "(min-width: 1024px)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const errors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container, <HomePage />, {
      onRecoverableError: (error) => errors.push(error),
    });
  });
  await act(async () => {});
  return errors;
}

function headings() {
  return Array.from(container.querySelectorAll("h1"), (h) => h.textContent);
}

describe("HomePage — 새로고침 (서버 HTML → 하이드레이션)", () => {
  it("서버 HTML 에 마스코트 미리 받기 링크가 없다 (숨겨진 쪽 그림을 받지 않는다)", () => {
    expect(renderToString(<HomePage />)).not.toMatch(/<link[^>]*rel="preload"[^>]*\/mascot\//);
  });

  it.each([
    [true, "사진으로 작물 상태를 확인하세요"],
    [false, "사진으로 작물 진단"],
  ])(
    "데스크탑=%s: 불일치 없이 하이드레이션하고, 맞는 화면 한 벌만 남기고, 초점을 건드리지 않는다",
    async (desktop, title) => {
      const errors = await refresh(desktop);

      expect(errors).toEqual([]);
      expect(headings()).toEqual([title]);
      // 폭이 정해져 화면이 바뀐 것은 사용자 동작이 아니라 제목으로 초점을 옮기지 않는다
      expect(document.activeElement).toBe(document.body);
    },
  );
});
