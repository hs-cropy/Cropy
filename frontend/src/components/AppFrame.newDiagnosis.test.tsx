import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setVoiceEnabled } from "@/features/voice/hooks/useVoiceSetting";
import {
  installFakeSpeech,
  spokenTexts,
  type FakeSpeech,
} from "@/features/voice/testing/fakeSpeech";
import HomePage from "@/app/page";
import { diagnoseImage } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import { AppFrame } from "./AppFrame";
import { subscribeNewDiagnosis } from "./newDiagnosis";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  diagnoseImage: vi.fn(),
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

function renderHome() {
  return render(
    <AppFrame>
      <HomePage />
    </AppFrame>,
  );
}

function pickFile(container: HTMLElement, file: File) {
  // 파일 입력은 숨겨져 있고 라벨이 없다
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function pickPhoto(container: HTMLElement, name = "leaf.jpg") {
  pickFile(container, new File(["x"], name, { type: "image/jpeg" }));
}

function captureCard() {
  return screen.getAllByRole("button", {
    name: /사진 촬영하기/,
    hidden: true,
  })[0];
}

function submitButton(name: "AI 진단 시작" | "진단 중…") {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

async function startDiagnosis() {
  await userEvent.click(submitButton("AI 진단 시작"));
}

// jsdom 은 링크를 눌러 페이지를 옮기는 일을 하지 못한다. 앱의 클릭 처리가 끝난 뒤에 이동만 막는다
const stopNavigation = (event: Event) => {
  if ((event.target as Element).closest("a")) event.preventDefault();
};

let speech: FakeSpeech;

beforeEach(() => {
  speech = installFakeSpeech();
  localStorage.clear();
  delete document.documentElement.dataset.textsize;
  setVoiceEnabled(false);
  navigation.pathname = "/";
  vi.mocked(diagnoseImage).mockReset();
  document.addEventListener("click", stopNavigation);
  // jsdom 에 없는 것들
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

window.location.hash = "capture";

afterEach(() => {
  document.removeEventListener("click", stopNavigation);
});

describe("AppFrame — 진단 화면에서 새 진단을 다시 누를 때", () => {
  it.each(NEW_DIAGNOSIS)(
    "결과가 뜬 뒤 %s 의 %s 을 누르면 사진·결과·작물 선택을 비우고 촬영 카드로 초점을 보낸다",
    async (nav, name) => {
      vi.mocked(diagnoseImage).mockResolvedValue(result("d1", "고추 탄저병"));
      const { container } = renderHome();

      await userEvent.click(screen.getByRole("button", { name: "고추" }));
      pickPhoto(container);
      await startDiagnosis();
      await screen.findByRole("heading", { name: "고추 탄저병" });
      expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();

      await userEvent.click(navLink(nav, name));

      await userEvent.click(navLink(nav, name));

      // 새 진단 클릭 후 촬영 탭으로 돌아왔는지 확인
      await waitFor(() => {
        expect(window.location.hash).toBe("#capture");

        const captureSection = screen.getByRole("region", {
          name: "사진 촬영",
        });

        expect(captureSection.classList.contains("hidden")).toBe(false);
      });

      // 기존 테스트 유지
      expect(screen.queryByRole("heading", { name: "고추 탄저병" })).toBeNull();

      expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");

      expect(
        screen.getByRole("button", { name: "자동 감지" }).getAttribute("aria-pressed")
      ).toBe("true");

      expect(document.activeElement).toBe(captureCard());

      expect(screen.queryByRole("heading", { name: "고추 탄저병" })).toBeNull();
      expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
      expect(screen.getByRole("button", { name: "자동 감지" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(document.activeElement).toBe(captureCard());
    },
  );

  it("읽던 결과 안내를 끊고 처음 안내는 다시 읽지 않는다. 큰 글자·음성 안내 설정은 그대로 둔다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(result("d1", "고추 탄저병"));
    const { container } = renderHome();
    await userEvent.click(screen.getByRole("switch", { name: "큰 글자" }));
    await userEvent.click(screen.getByRole("switch", { name: "음성 안내" }));
    pickPhoto(container);
    await startDiagnosis();
    await screen.findByRole("heading", { name: "고추 탄저병" });
    const spokenBefore = spokenTexts(speech);
    expect(spokenBefore.some((text) => text.includes("고추 탄저병"))).toBe(true);
    speech.cancel.mockClear();

    await userEvent.click(navLink("주요 메뉴", "새 진단"));

    expect(speech.cancel).toHaveBeenCalled();
    expect(spokenTexts(speech)).toEqual(spokenBefore);
    expect(screen.getByRole("switch", { name: "큰 글자" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("switch", { name: "음성 안내" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("고른 사진이 없다는 오류 문구와 떠 있던 토스트도 지운다", async () => {
    const { container } = renderHome();
    await startDiagnosis();
    pickFile(container, new File(["x"], "memo.txt", { type: "text/plain" }));    
    expect(
      screen.getAllByText("먼저 사진을 촬영하거나 선택하세요.").length
    ).toBeGreaterThan(0);
    expect(screen.getByText("JPG·PNG·HEIC/HEIF·DNG·WebP·AVIF 사진을 선택해 주세요")).toBeTruthy();

    await userEvent.click(navLink("주요 메뉴", "새 진단"));

    expect(screen.queryByText("먼저 사진을 촬영하거나 선택하세요.")).toBeNull();
    expect(screen.queryByText("JPG·PNG·HEIC/HEIF·DNG·WebP·AVIF 사진을 선택해 주세요")).toBeNull();
  });

  it.each(NEW_DIAGNOSIS)(
    "진단 중에 %s 의 %s 을 누르면 요청을 취소하고 바로 다시 진단할 수 있게 한다",
    async (nav, name) => {
      const first = pendingDiagnosis();
      vi.mocked(diagnoseImage).mockReturnValue(first.promise);
      const { container } = renderHome();
      pickPhoto(container);
      await startDiagnosis();
      expect(submitButton("진단 중…").disabled).toBe(true);

      await userEvent.click(navLink(nav, name));

      expect(vi.mocked(diagnoseImage).mock.calls[0][2]?.signal?.aborted).toBe(true);
      expect(submitButton("AI 진단 시작").disabled).toBe(false);
      expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();      
      await waitFor(() => { expect(document.activeElement).toBe(captureCard()); });
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

    expect(submitButton("진단 중…").disabled).toBe(true);
    expect(screen.queryByRole("heading", { name: "이전 진단의 병" })).toBeNull();

    await act(async () => {
      second.resolve(result("d2", "새 진단의 병"));
    });
    expect(screen.getByRole("heading", { name: "새 진단의 병" })).toBeTruthy();
    expect(submitButton("AI 진단 시작").disabled).toBe(false);
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

    expect(submitButton("진단 중…").disabled).toBe(true);
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
    expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
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
    navigation.pathname = "/history";
    render(<AppFrame>화면</AppFrame>);

    await userEvent.click(navLink("주요 메뉴", "새 진단"));
    await userEvent.click(navLink("하단 메뉴", "촬영"));

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
