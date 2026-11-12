import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setVoiceEnabled, isVoiceEnabled } from "@/features/voice/hooks/useVoiceSetting";
import {
  installFakeSpeech,
  spokenTexts,
  type FakeSpeech,
} from "@/features/voice/testing/fakeSpeech";
import HomePage from "@/app/home/page";
import DiagnosisRoute from "@/app/diagnosis/page";
import { FakeRoutes, fakeNavigation, fakeRouter } from "@/testing/fakeNavigation";

const fakeRouterBack = () => fakeRouter.back();
import { diagnoseImage } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import { AppFrame } from "./AppFrame";
import { subscribeNewDiagnosis } from "./newDiagnosis";

vi.mock("next/navigation", async () => (await import("@/testing/fakeNavigation")).nextNavigation);
vi.mock("next/link", async () => ({
  default: (await import("@/testing/fakeNavigation")).FakeLink,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  diagnoseImage: vi.fn(),
  // 촬영 화면의 최근 진단 카드가 부른다. 기록이 없으면 카드를 그리지 않는다
  fetchHistory: vi.fn(() =>
    Promise.resolve({ items: [], total: 0, page: 1, size: 1, unfiltered_total: 0, crop_total: 0 }),
  ),
}));

function result(id: string, disease: string): DiagnoseResponse {
  return {
    id,
    disease_name: disease,
    confidence: 0.93,
    top_predictions: [{ name: disease, confidence: 0.93 }],
    causes: [],
    pesticides: [],
    prevention: [],
    created_at: "2026-10-13T00:00:00Z",
    save_status: "saved",
  };
}

// 끝나는 때를 테스트가 정하는 진단 요청
function pendingDiagnosis() {
  let resolve!: (value: DiagnoseResponse) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<DiagnoseResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// 헤더 내비(데스크탑)와 하단 내비(모바일)의 같은 항목
const NEW_DIAGNOSIS = [
  ["주요 메뉴", "새 진단"],
  ["하단 메뉴", "촬영"],
] as const;

function navLink(nav: string, name: string) {
  return within(screen.getByRole("navigation", { name: nav })).getByRole("link", { name });
}

// 앱의 app/ 폴더처럼 경로마다 화면을 바꿔 그린다
function renderApp() {
  return render(
    <AppFrame>
      <FakeRoutes
        routes={{ "/home": <HomePage />, "/diagnosis": <DiagnosisRoute />, "/history": <p>이력</p> }}
      />
    </AppFrame>,
  );
}
const renderHome = renderApp;

function pickFile(container: HTMLElement, file: File) {
  // 파일 입력은 숨겨져 있고 라벨이 없다
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function pickPhoto(container: HTMLElement, name = "leaf.jpg") {
  pickFile(container, new File(["x"], name, { type: "image/jpeg" }));
}

// 새 진단 뒤 초점을 받는 촬영 화면 처음의 사진 업로드 영역 (M-01-0)
function firstControl() {
  return within(screen.getByRole("region", { name: "사진 업로드" })).getByRole("button");
}

function submitButton(name: "이 사진으로 진단하기" | "진단 중…") {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

async function startDiagnosis() {
  await userEvent.click(submitButton("이 사진으로 진단하기"));
}

// 진단 결과 화면의 분석 중 (Figma M-02. 테스트의 화면 폭은 모바일이다)
function analyzingTitle() {
  return screen.queryByRole("heading", { level: 1, name: "사진 분석 중" });
}

// 링크 이동은 가짜 next/link 가 가짜 라우터로 한다. 브라우저 기본 이동(jsdom 은 못 한다)만 막는다
const stopNavigation = (event: Event) => {
  if ((event.target as Element).closest("a")) event.preventDefault();
};

let speech: FakeSpeech;

beforeEach(() => {
  speech = installFakeSpeech();
  localStorage.clear();
  delete document.documentElement.dataset.textsize;
  setVoiceEnabled(false);
  fakeNavigation.reset("/home");
  sessionStorage.clear();
  vi.mocked(diagnoseImage).mockReset();
  document.addEventListener("click", stopNavigation);
  // jsdom 에 없는 것들
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  // 앞 테스트가 촬영 가이드(#guide)에서 끝나도 촬영 화면 처음에서 시작한다
  window.location.hash = "capture";
});

afterEach(() => {
  document.removeEventListener("click", stopNavigation);
});

describe("AppFrame — 진단 화면에서 새 진단을 다시 누를 때", () => {
  it.each(NEW_DIAGNOSIS)(
    "결과가 뜬 뒤 %s 의 %s 을 누르면 사진·결과를 비우고 촬영 카드로 초점을 보낸다",
    async (nav, name) => {
      vi.mocked(diagnoseImage).mockResolvedValue(result("d1", "고추 탄저병"));
      const { container } = renderHome();

      pickPhoto(container);
      await startDiagnosis();
      // 작물을 고르는 화면이 없어 자동 감지로 진단한다
      expect(vi.mocked(diagnoseImage).mock.calls[0][1]).toBeUndefined();
      await screen.findByRole("heading", { name: "고추 탄저병" });
      expect(fakeNavigation.pathname).toBe("/diagnosis");

      // 진단 결과 화면에서 누르면 촬영 화면으로 옮기고, 거기서 다시 누르면 처음 상태로 돌린다
      await userEvent.click(navLink(nav, name));
      await userEvent.click(navLink(nav, name));

      await waitFor(() => {
        expect(fakeNavigation.pathname).toBe("/home");
        expect(screen.getByRole("region", { name: "사진 촬영" })).toBeTruthy();
      });

      // 기존 테스트 유지
      expect(screen.queryByRole("heading", { name: "고추 탄저병" })).toBeNull();

      expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");

      expect(document.activeElement).toBe(firstControl());
    },
    // 진단 → 결과 → 새 진단을 두 번 누르는 가장 긴 흐름이다. 보통 1~2초지만 PC 가 바쁘면
    // 파일의 첫 테스트(jsdom 준비 포함)가 기본 5초를 넘겨 실패한다
    15_000,
  );

  it("읽던 결과 안내를 끊고 처음 안내는 다시 읽지 않는다. 큰 글자·음성 안내 설정은 그대로 둔다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(result("d1", "고추 탄저병"));
    const { container } = renderHome();
    await userEvent.click(screen.getByRole("switch", { name: /큰 글자/ }));

    // 기존 TTS 음성 안내 설정을 직접 활성화한다.
    // 헤더의 "음성 모드" 스위치와는 별개다.
    act(() => {
      setVoiceEnabled(true);
    });

    pickPhoto(container);
    await startDiagnosis();
    await screen.findByRole("heading", { name: "고추 탄저병" });
    const spokenBefore = spokenTexts(speech);
    expect(spokenBefore.some((text) => text.includes("고추 탄저병"))).toBe(true);
    speech.cancel.mockClear();

    await userEvent.click(navLink("주요 메뉴", "새 진단"));

    expect(speech.cancel).toHaveBeenCalled();
    expect(spokenTexts(speech)).toEqual(spokenBefore);
    expect(screen.getByRole("switch", { name: /큰 글자/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(isVoiceEnabled()).toBe(true);

    // 새 진단을 시작해도 TTS 설정은 유지된다.
    expect(isVoiceEnabled()).toBe(true);

    expect(
      screen.getByRole("switch", { name: "음성 안내" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    // 음성 모드 진입은 별도의 버튼이다.
    expect(
      screen.getByRole("button", { name: "음성 대화" }),
    ).toBeTruthy();
  });

  it("카메라를 쓸 수 없다는 화면에서 새 진단을 누르면 사진 업로드로 돌아가 그 영역에 초점을 둔다", async () => {
    renderHome();
    // jsdom 에는 카메라 API 가 없어 켜면 바로 사용 불가 화면이 된다
    await userEvent.click(
      within(screen.getByRole("group", { name: "화면 행동" })).getByRole("button", {
        name: "카메라로 촬영",
      }),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("카메라 권한");

    await userEvent.click(navLink("주요 메뉴", "새 진단"));

    await waitFor(() => expect(document.activeElement).toBe(firstControl()));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("사진으로 작물 진단");
  });

  it("사진을 골라도(사진 확인) 하단 내비는 촬영 그대로이고, 헤더도 새 진단 그대로다", async () => {
    const { container } = renderHome();
    const bottomStep = () =>
      within(screen.getByRole("navigation", { name: "하단 메뉴" })).getByRole("link", {
        name: "진단",
      });

    pickPhoto(container);

    expect(bottomStep().hasAttribute("aria-current")).toBe(false);
    expect(navLink("하단 메뉴", "촬영").getAttribute("aria-current")).toBe("page");
    expect(navLink("주요 메뉴", "새 진단").getAttribute("aria-current")).toBe("page");
    expect(navLink("주요 메뉴", "진단 결과").hasAttribute("aria-current")).toBe(false);
  });

  it("진단 결과 화면(분석 중·결과)은 경로대로 하단 진단·헤더 진단 결과를 선택해 보인다", async () => {
    const pending = pendingDiagnosis();
    vi.mocked(diagnoseImage).mockReturnValue(pending.promise);
    const { container } = renderApp();
    const bottomStep = () => navLink("하단 메뉴", "진단");
    const headerStep = () => navLink("주요 메뉴", "진단 결과");

    pickPhoto(container);
    await startDiagnosis();
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/diagnosis"));
    expect(headerStep().getAttribute("aria-current")).toBe("page");
    expect(bottomStep().getAttribute("aria-current")).toBe("page");
    expect(navLink("주요 메뉴", "새 진단").hasAttribute("aria-current")).toBe(false);

    await act(async () => {
      pending.resolve(result("d1", "고추 탄저병"));
    });
    await screen.findByRole("heading", { name: "고추 탄저병" });
    expect(headerStep().getAttribute("aria-current")).toBe("page");
    expect(bottomStep().getAttribute("aria-current")).toBe("page");
  });

  it.each([
    ["주요 메뉴", "진단 결과"],
    ["하단 메뉴", "진단"],
  ] as const)(
    "%s 의 %s 은 진단 결과 화면(/diagnosis)으로 옮기고, 돌아오면 고른 사진이 그대로다",
    async (nav, name) => {
      const { container } = renderApp();
      pickPhoto(container);
      expect(navLink(nav, name).getAttribute("href")).toBe("/diagnosis");

      await userEvent.click(navLink(nav, name));

      expect(fakeNavigation.pathname).toBe("/diagnosis");
      expect(screen.getByRole("heading", { level: 1, name: "진단 시작" })).toBeTruthy();
      expect(navLink(nav, name).getAttribute("aria-current")).toBe("page");

      await act(async () => {
        fakeRouterBack();
      });
      expect(fakeNavigation.pathname).toBe("/home");
      expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
    },
  );

  it("이력에 다녀와도 진단 결과 화면은 마지막 결과를 그대로 보인다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(result("d1", "고추 탄저병"));
    const { container } = renderApp();
    pickPhoto(container);
    await startDiagnosis();
    await screen.findByRole("heading", { name: "고추 탄저병" });

    await userEvent.click(navLink("주요 메뉴", "진단 이력"));
    expect(fakeNavigation.pathname).toBe("/history");
    expect(navLink("주요 메뉴", "진단 결과").hasAttribute("aria-current")).toBe(false);

    await userEvent.click(navLink("주요 메뉴", "진단 결과"));

    expect(fakeNavigation.pathname).toBe("/diagnosis");
    expect(screen.getByRole("heading", { name: "고추 탄저병" })).toBeTruthy();
  });

  it("다른 화면에서 새 진단을 누르면 이전 사진·결과를 비우고 촬영 화면 처음으로 간다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(result("d1", "고추 탄저병"));
    const { container } = renderApp();
    pickPhoto(container);
    await startDiagnosis();
    await screen.findByRole("heading", { name: "고추 탄저병" });
    await userEvent.click(navLink("주요 메뉴", "진단 이력"));

    await userEvent.click(navLink("주요 메뉴", "새 진단"));

    expect(fakeNavigation.pathname).toBe("/home");
    expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(firstControl()));
    await userEvent.click(navLink("주요 메뉴", "진단 결과"));
    expect(screen.getByRole("heading", { level: 1, name: "진단 시작" })).toBeTruthy();
  });

  it("촬영 가이드는 촬영 화면이라 하단 촬영·헤더 새 진단을 선택해 보인다 (M-03-2 · D-03-2)", async () => {
    renderHome();

    await act(async () => {
      window.location.hash = "guide";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(navLink("하단 메뉴", "촬영").getAttribute("aria-current")).toBe("page");
    expect(navLink("하단 메뉴", "진단").hasAttribute("aria-current")).toBe(false);
    expect(navLink("주요 메뉴", "새 진단").getAttribute("aria-current")).toBe("page");
    expect(navLink("주요 메뉴", "진단 결과").hasAttribute("aria-current")).toBe(false);
  });

  it("떠 있던 사진 안내도 지운다", async () => {
    const { container } = renderHome();
    pickFile(container, new File(["x"], "memo.txt", { type: "text/plain" }));
    expect(screen.getByText("지원하지 않는 사진 형식이에요")).toBeTruthy();

    await userEvent.click(navLink("주요 메뉴", "새 진단"));

    expect(screen.queryByText("지원하지 않는 사진 형식이에요")).toBeNull();
  });

  it.each(NEW_DIAGNOSIS)(
    "진단 중에 %s 의 %s 을 누르면 요청을 취소하고 바로 다시 진단할 수 있게 한다",
    async (nav, name) => {
      const first = pendingDiagnosis();
      vi.mocked(diagnoseImage).mockReturnValue(first.promise);
      const { container } = renderHome();
      pickPhoto(container);
      await startDiagnosis();
      await waitFor(() => expect(analyzingTitle()).toBeTruthy());

      await userEvent.click(navLink(nav, name));

      expect(vi.mocked(diagnoseImage).mock.calls[0][2]?.signal?.aborted).toBe(true);
      await waitFor(() => expect(analyzingTitle()).toBeNull());
      expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();
      await waitFor(() => {
        expect(document.activeElement).toBe(firstControl());
      });

      // 사진을 다시 고르면 바로 진단할 수 있다
      pickPhoto(container, "again.jpg");
      expect(submitButton("이 사진으로 진단하기").disabled).toBe(false);
    },
  );

  it("취소한 요청이 뒤늦게 성공해도 새로 시작한 진단의 결과와 진행 상태를 바꾸지 않는다", async () => {
    const first = pendingDiagnosis();
    const second = pendingDiagnosis();
    vi.mocked(diagnoseImage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { container } = renderHome();
    pickPhoto(container, "first.jpg");
    await startDiagnosis();

    await userEvent.click(navLink("주요 메뉴", "새 진단"));
    pickPhoto(container, "second.jpg");
    await startDiagnosis();
    // 이전 요청이 끝난 뒤의 처리까지 화면에 반영한 다음에 본다
    await act(async () => {
      first.resolve(result("d1", "이전 진단의 병"));
    });

    expect(analyzingTitle()).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "이전 진단의 병" })).toBeNull();

    await act(async () => {
      second.resolve(result("d2", "새 진단의 병"));
    });
    expect(screen.getByRole("heading", { name: "새 진단의 병" })).toBeTruthy();
    // 진단이 끝나 진행 상태가 풀렸다
    expect(analyzingTitle()).toBeNull();
    expect(screen.queryByRole("heading", { name: "이전 진단의 병" })).toBeNull();
  });

  it("취소한 요청이 뒤늦게 실패해도 오류를 띄우거나 새 진단의 진행 상태를 풀지 않는다", async () => {
    const first = pendingDiagnosis();
    const second = pendingDiagnosis();
    vi.mocked(diagnoseImage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { container } = renderHome();
    pickPhoto(container, "first.jpg");
    await startDiagnosis();

    await userEvent.click(navLink("주요 메뉴", "새 진단"));
    pickPhoto(container, "second.jpg");
    await startDiagnosis();
    await act(async () => {
      first.reject(new Error("이전 요청의 오류"));
    });

    expect(analyzingTitle()).toBeTruthy();
    expect(screen.queryByText("이전 요청의 오류")).toBeNull();

    await act(async () => {
      second.resolve(result("d2", "새 진단의 병"));
    });
    expect(screen.getByRole("heading", { name: "새 진단의 병" })).toBeTruthy();
    expect(screen.queryByText("이전 요청의 오류")).toBeNull();
  });

  it("Ctrl·⌘ 클릭처럼 새 탭으로 여는 클릭은 지금 화면을 그대로 둔다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(result("d1", "고추 탄저병"));
    const { container } = renderHome();
    pickPhoto(container);
    await startDiagnosis();
    await screen.findByRole("heading", { name: "고추 탄저병" });

    const link = navLink("주요 메뉴", "새 진단");
    for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
      fireEvent.click(link, { [key]: true });
    }

    expect(screen.getByRole("heading", { name: "고추 탄저병" })).toBeTruthy();
    expect(screen.getByAltText("진단한 작물")).toBeTruthy();
    expect(fakeNavigation.pathname).toBe("/diagnosis");
  });
});

describe("AppFrame — 새 진단 신호를 보내는 때", () => {
  function listen() {
    const listener = vi.fn();
    const unsubscribe = subscribeNewDiagnosis(listener);
    return { listener, unsubscribe };
  }

  it.each(NEW_DIAGNOSIS)(
    "진단 화면에서 %s 의 %s 을 누를 때 한 번 보내고, 같은 주소로 다시 옮겨 가지 않게 막는다",
    (nav, name) => {
      const { listener, unsubscribe } = listen();
      render(<AppFrame>화면</AppFrame>);
      // 앱이 스스로 이동을 막는지 본다
      document.removeEventListener("click", stopNavigation);

      const moved = fireEvent.click(navLink(nav, name));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(moved).toBe(false);
      unsubscribe();
    },
  );

  it("다른 화면에서 누르면 옮겨 가기만 하고 보내지 않는다", async () => {
    const { listener, unsubscribe } = listen();
    fakeNavigation.reset("/history");
    render(<AppFrame>화면</AppFrame>);

    // 누르면 촬영 화면으로 옮겨 가므로 하나씩 이력 화면에서 누른다
    await userEvent.click(navLink("주요 메뉴", "새 진단"));
    expect(fakeNavigation.pathname).toBe("/home");
    act(() => fakeNavigation.reset("/history"));
    await userEvent.click(navLink("하단 메뉴", "촬영"));

    expect(fakeNavigation.pathname).toBe("/home");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("진단 화면에서 다른 항목이나 로고를 누를 때는 보내지 않는다", async () => {
    const { listener, unsubscribe } = listen();
    render(<AppFrame>화면</AppFrame>);

    await userEvent.click(navLink("주요 메뉴", "진단 이력"));
    await userEvent.click(screen.getByRole("link", { name: "Cropy 홈" }));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
