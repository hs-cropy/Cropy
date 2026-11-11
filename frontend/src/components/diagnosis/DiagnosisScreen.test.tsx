import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "@/features/camera";
import { setVoiceEnabled } from "@/features/voice/hooks/useVoiceSetting";
import { PROMPT_DIAGNOSING } from "@/features/voice";
import { installFakeSpeech, spokenTexts } from "@/features/voice/testing/fakeSpeech";
import HomePage from "@/app/home/page";
import DiagnosisRoute from "@/app/diagnosis/page";
import HistoryDetailPage from "@/app/history/[id]/page";
import { FakeRoutes, fakeNavigation, fakeRouter } from "@/testing/fakeNavigation";
import { ApiError, diagnoseImage, fetchDiagnosisDetail, refineDiagnosis } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import { AppFrame } from "../AppFrame";
import { ANALYZING_MS, analyzingHold } from "./analyzingHold";
import {
  DiagnosisResultView,
  gradeOf,
  resultTimeSentence,
} from "./DiagnosisResultView";

vi.mock("next/navigation", async () => (await import("@/testing/fakeNavigation")).nextNavigation);
vi.mock("next/link", async () => ({
  default: (await import("@/testing/fakeNavigation")).FakeLink,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  diagnoseImage: vi.fn(),
  refineDiagnosis: vi.fn(),
  fetchDiagnosisDetail: vi.fn(),
  fetchHistory: vi.fn(() =>
    Promise.resolve({ items: [], total: 0, page: 1, size: 1, unfiltered_total: 0, crop_total: 0 }),
  ),
}));

function response(overrides: Partial<DiagnoseResponse> = {}): DiagnoseResponse {
  return {
    id: "d1",
    crop_type: "고추",
    disease_name: "고추 탄저병",
    severity: "medium",
    confidence: 0.9,
    top_predictions: [{ name: "고추 탄저병", confidence: 0.9 }],
    management_actions: ["감염 부위 제거", "주변 포기 확인"],
    causes: [],
    pesticides: [],
    prevention: [],
    // 시간대와 상관없이 같은 시각으로 읽히게 지역 시각으로 둔다
    created_at: "2026-10-06T14:18:00",
    save_status: "saved",
    ...overrides,
  };
}

function pendingDiagnosis() {
  let resolve!: (value: DiagnoseResponse) => void;
  const promise = new Promise<DiagnoseResponse>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const stopNavigation = (event: Event) => {
  if ((event.target as Element).closest("a")) event.preventDefault();
};

// 서버 장애 안내 (feedback/cases.ts service-unavailable)
const SERVICE_DOWN = "일시적으로 진단 서비스를 사용할 수 없어요";

// 앱의 app/ 폴더처럼 경로마다 화면을 바꿔 그린다
function renderHome() {
  return render(
    <AppFrame>
      <FakeRoutes
        routes={{ "/home": <HomePage />, "/diagnosis": <DiagnosisRoute />, "/history": <p>이력</p> }}
      />
    </AppFrame>,
  );
}

function pickPhoto(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["x"], "leaf.jpg", { type: "image/jpeg" })] },
  });
}

function title() {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

function action(name: string) {
  return within(screen.getByRole("group", { name: "화면 행동" })).getByRole("button", { name });
}

function bottomDiagnosis() {
  return within(screen.getByRole("navigation", { name: "하단 메뉴" })).getByRole("link", {
    name: "진단",
  });
}

function stubDesktop() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1024px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

async function goTo(path: string) {
  await act(async () => {
    fakeRouter.push(path);
  });
}

beforeEach(() => {
  installFakeSpeech();
  localStorage.clear();
  setVoiceEnabled(false);
  fakeNavigation.reset("/home");
  sessionStorage.clear();
  vi.mocked(fetchDiagnosisDetail).mockReset();
  vi.mocked(diagnoseImage).mockReset();
  vi.mocked(refineDiagnosis).mockReset();
  document.addEventListener("click", stopNavigation);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  window.location.hash = "capture";
});

afterEach(() => {
  document.removeEventListener("click", stopNavigation);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "scrollingElement");
});

describe("진단 시작 안내 (M-03-1 · D-03-1)", () => {
  it("결과 없이 진단 결과 화면에 오면 안내와 사진 찍기·갤러리 버튼을 보이고, 하단 내비는 진단이다", async () => {
    renderHome();
    await goTo("/diagnosis");

    expect(title()).toBe("진단 시작");
    expect(screen.getByRole("heading", { name: /사진으로 작물 상태를/ })).toBeTruthy();
    // 가이드는 촬영 화면에 있어 그 주소를 둔다 (새 탭으로 열어도 가이드가 나온다)
    expect(screen.getByRole("link", { name: "촬영 방법 보기" }).getAttribute("href")).toBe(
      "/home#guide",
    );
    expect(action("사진 찍기")).toBeTruthy();
    expect(action("갤러리에서 선택")).toBeTruthy();
    expect(bottomDiagnosis().getAttribute("aria-current")).toBe("page");
  });

  it("데스크탑은 카드 안내와 사진 선택하기·카메라로 촬영 버튼이다", async () => {
    stubDesktop();
    renderHome();
    await goTo("/diagnosis");

    expect(screen.getByRole("heading", { name: "먼저 작물 사진을 준비해주세요" })).toBeTruthy();
    expect(action("사진 선택하기")).toBeTruthy();
    expect(action("카메라로 촬영")).toBeTruthy();
  });

  it("갤러리에서 사진을 고르면 촬영 화면의 사진 확인으로 간다", async () => {
    const { container } = renderHome();
    await goTo("/diagnosis");

    pickPhoto(container);

    await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
    expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
  });

  it("촬영 방법 보기는 촬영 화면으로 옮겨 가이드를 열고, 가이드의 사진 찍기는 촬영 화면에 남는다", async () => {
    const back = vi.spyOn(window.history, "back");
    const { container } = renderHome();
    await goTo("/diagnosis");

    await userEvent.click(screen.getByRole("link", { name: "촬영 방법 보기" }));

    await waitFor(() => expect(title()).toBe("촬영 방법"));
    expect(fakeNavigation.pathname).toBe("/home");
    expect(window.location.hash).toBe("#guide");

    // 브라우저 카메라가 없으면 가이드를 닫고 기기 카메라를 연다. 뒤로 가기로 진단 결과 화면에 가지 않는다
    const deviceCamera = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    const click = vi.spyOn(deviceCamera, "click");
    await userEvent.click(action("사진 찍기"));

    expect(click).toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#capture");
    expect(fakeNavigation.pathname).toBe("/home");
  });

  it("Ctrl 을 누르고 연 촬영 방법 보기(새 탭)는 이 화면을 옮기지 않는다", async () => {
    renderHome();
    await goTo("/diagnosis");

    fireEvent.click(screen.getByRole("link", { name: "촬영 방법 보기" }), { ctrlKey: true });

    expect(fakeNavigation.pathname).toBe("/diagnosis");
  });

  it("브라우저 카메라가 없으면 사진 찍기는 기기 카메라(파일 선택)를 연다", async () => {
    const { container } = renderHome();
    await goTo("/diagnosis");
    const deviceCamera = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    const click = vi.spyOn(deviceCamera, "click");

    await userEvent.click(action("사진 찍기"));

    expect(click).toHaveBeenCalled();
  });
});

describe("사진 분석 중 (M-02 · D-02)", () => {
  it("진단을 시작하면 진단 결과 화면(/diagnosis)에서 고른 사진·진행 막대·분석 취소를 보인다 (막대는 3초 동안 차오르고 값은 읽지 않는다)", async () => {
    vi.mocked(diagnoseImage).mockReturnValue(pendingDiagnosis().promise);
    const { container } = renderHome();
    pickPhoto(container);

    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));

    await waitFor(() => expect(title()).toBe("사진 분석 중"));
    expect(fakeNavigation.pathname).toBe("/diagnosis");
    // 눌렀던 버튼은 촬영 화면과 함께 사라졌으니 바뀐 화면의 제목으로 초점을 옮긴다
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })),
    );
    expect(screen.getByAltText("분석 중인 사진").getAttribute("src")).toBe("blob:preview");
    const progress = screen.getByRole("progressbar", { name: "사진 분석 진행" });
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    const fill = progress.firstElementChild as HTMLElement;
    expect(fill.className).toContain("animate-cropy-progress-fill");
    expect(fill.style.animationDuration).toBe(`${ANALYZING_MS}ms`);
    expect(screen.getByRole("button", { name: "분석 취소" })).toBeTruthy();
    // 모바일은 화면 아래 고정 버튼이 없다
    expect(screen.queryByRole("group", { name: "화면 행동" })).toBeNull();
    expect(bottomDiagnosis().getAttribute("aria-current")).toBe("page");
  });

  it("분석 취소는 요청을 끊고 사진 그대로 사진 확인으로 돌아가며, 늦게 온 응답은 버린다", async () => {
    const pending = pendingDiagnosis();
    vi.mocked(diagnoseImage).mockReturnValue(pending.promise);
    const back = vi.spyOn(fakeRouter, "back");
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    await waitFor(() => expect(title()).toBe("사진 분석 중"));

    await userEvent.click(screen.getByRole("button", { name: "분석 취소" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(vi.mocked(diagnoseImage).mock.calls[0][2]?.signal?.aborted).toBe(true);
    // 뒤로 가기로 진단 결과 화면 기록을 지우고 사진 확인으로 돌아간다
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
    expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
    // 사진 확인의 제목으로 초점을 옮긴다 (사라진 취소 버튼에 남지 않는다)
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe(
        screen.getByRole("heading", { level: 1 }).textContent,
      ),
    );
    expect(document.activeElement?.tagName).toBe("H1");
    expect(
      (screen.getByRole("button", { name: "이 사진으로 진단하기" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await act(async () => {
      pending.resolve(response());
    });
    expect(fakeNavigation.pathname).toBe("/home");
    expect(screen.queryByRole("heading", { name: "고추 탄저병" })).toBeNull();
  });

  describe("분석 중 화면은 3초 동안 보인다", () => {
    beforeEach(() => {
      analyzingHold.minMs = ANALYZING_MS;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function startDiagnosis() {
      const { container } = renderHome();
      pickPhoto(container);
      fireEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
      await act(async () => {});
      expect(title()).toBe("사진 분석 중");
    }

    it.each([
      ["성공", false],
      ["실패", true],
    ] as const)(
      "분석 중 아래로 스크롤했더라도 %s 화면은 맨 위에서 시작한다",
      async (_, failed) => {
        const scrollTo = vi.fn();

        Object.defineProperty(document, "scrollingElement", {
          configurable: true,
          value: {
            scrollTo,
          },
        });
        if (failed) {
          vi.mocked(diagnoseImage).mockRejectedValue(
            new TypeError("Failed to fetch"),
          );
        } else {
          vi.mocked(diagnoseImage).mockResolvedValue(response());
        }

        await startDiagnosis();

        // 분석 중 화면으로 이동하면서 발생한 호출은 제외한다.
        scrollTo.mockClear();

        await act(() => vi.advanceTimersByTimeAsync(ANALYZING_MS));

        if (failed) {
          expect(
            screen.getByRole("alert", {
              name: "인터넷 연결을 확인해주세요",
            }),
          ).toBeTruthy();
        } else {
          expect(title()).toBe("진단 결과");
        }

        expect(scrollTo).toHaveBeenCalledWith({
          top: 0,
          behavior: "instant",
        });
      },
    );

    it("응답이 바로 와도 3초가 지나야 결과로 넘어간다", async () => {
      vi.mocked(diagnoseImage).mockResolvedValue(response());
      await startDiagnosis();

      await act(() => vi.advanceTimersByTimeAsync(2900));
      expect(title()).toBe("사진 분석 중");

      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(title()).toBe("진단 결과");
    });

    it("실패해도 3초 뒤에 실패 화면으로 넘어간다", async () => {
      vi.mocked(diagnoseImage).mockRejectedValue(new TypeError("Failed to fetch"));
      await startDiagnosis();

      await act(() => vi.advanceTimersByTimeAsync(2900));
      expect(title()).toBe("사진 분석 중");

      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(screen.getByRole("alert", { name: "인터넷 연결을 확인해주세요" })).toBeTruthy();
    });

    it("기다리는 동안 분석 취소를 누르면 받아 둔 결과를 보이지 않는다", async () => {
      vi.mocked(diagnoseImage).mockResolvedValue(response());
      await startDiagnosis();
      await act(() => vi.advanceTimersByTimeAsync(1000));

      fireEvent.click(screen.getByRole("button", { name: "분석 취소" }));
      await act(() => vi.advanceTimersByTimeAsync(2000));

      expect(fakeNavigation.pathname).toBe("/home");
      expect(screen.queryByRole("heading", { name: "고추 탄저병" })).toBeNull();
      expect(sessionStorage.getItem("cropy:lastDiagnosisId")).toBeNull();
    });

    it("기다리는 동안 새 진단을 누르면 받아 둔 결과를 보이지 않고 촬영 화면 처음으로 간다", async () => {
      vi.mocked(diagnoseImage).mockResolvedValue(response());
      await startDiagnosis();
      await act(() => vi.advanceTimersByTimeAsync(1000));

      fireEvent.click(
        within(screen.getByRole("navigation", { name: "주요 메뉴" })).getByRole("link", {
          name: "새 진단",
        }),
      );
      await act(() => vi.advanceTimersByTimeAsync(2000));

      expect(fakeNavigation.pathname).toBe("/home");
      expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();
      expect(screen.queryByRole("heading", { name: "고추 탄저병" })).toBeNull();
      expect(sessionStorage.getItem("cropy:lastDiagnosisId")).toBeNull();
    });
  });

  it("데스크탑은 사진 카드·단계 카드와 화면 아래의 분석 취소다", async () => {
    stubDesktop();
    vi.mocked(diagnoseImage).mockReturnValue(pendingDiagnosis().promise);
    const { container } = renderHome();
    pickPhoto(container);

    await userEvent.click(action("이 사진으로 진단하기"));

    await waitFor(() => expect(title()).toBe("사진을 분석하고 있어요"));
    expect(screen.getByRole("heading", { name: "조금만 기다려주세요" })).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "분석 단계" })).getAllByRole("listitem"),
    ).toHaveLength(3);
    expect(action("분석 취소")).toBeTruthy();
  });
});

describe("진단 결과 (M-03 · D-03)", () => {
  it("요약·등급·신뢰도·할 일 개수·상세 정보를 같은 응답으로 보이고, 새 사진으로 진단하기는 처음으로 돌린다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(response());
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));

    await screen.findByRole("heading", { name: "고추 탄저병" });
    expect(title()).toBe("진단 결과");
    const summary = screen.getByRole("region", { name: "진단 요약" });
    expect(
      within(summary).getByText("위험 등급", { exact: false }).parentElement?.textContent,
    ).toBe("위험 등급 주의");
    expect(within(summary).getByText("신뢰도 90%")).toBeTruthy();
    expect(screen.getByText("2가지")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "상세 정보" })).toBeTruthy();
    // Figma 에 없는 신뢰도 막대·다른 후보는 보이지 않는다
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("그 밖의 가능성")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "새 사진으로 진단하기" }));

    await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
    expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();
  });

  it("저신뢰 결과의 다시 촬영하기는 촬영 화면으로 옮겨 카메라를 켠다", async () => {
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    try {
      vi.mocked(diagnoseImage).mockResolvedValue(
        response({ confidence: 0.42, decision_reasons: ["low_confidence"] }),
      );
      const { container } = renderHome();
      pickPhoto(container);
      await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
      await screen.findByRole("heading", { name: "추가 확인이 필요해요" });
      expect(getUserMedia).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "다시 촬영하기" }));

      await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
      expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    }
  });

  it.each([
    ["저장에 실패해도", { save_status: "failed" as const }],
    ["브라우저 진단이어도", { prediction_mode: "browser" as const }],
  ])("판별 불가는 %s 재촬영 안내로 간다", async (_, extra) => {
    vi.mocked(diagnoseImage).mockResolvedValue(
      response({ disease_name: "판별 불가", category: "other", severity: null, decision_status: "not_crop",
        decision_reasons: ["not_crop"], ...extra }),
    );
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    await screen.findByRole("heading", { name: "작물 잎을 찾지 못했어요" });
    expect(screen.queryByText("지금 해야 할 일")).toBeNull();
  });

  it("판별 불가 결과는 신뢰도 대신 작물 잎을 다시 찍도록 안내한다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(
      response({
        disease_name: "판별 불가",
        category: "other",
        confidence: 0.91,
        decision_status: "not_crop",
        decision_reasons: ["not_crop"],
      }),
    );
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    await screen.findByRole("heading", { name: "작물 잎을 찾지 못했어요" });
    expect(screen.queryByText(/AI 진단 신뢰도/)).toBeNull();
    expect(screen.getByRole("button", { name: "다시 촬영하기" })).toBeTruthy();
  });

  it("브라우저 카메라가 없으면 저신뢰 결과의 다시 촬영하기는 기기 카메라(파일 선택)를 연다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(
      response({ confidence: 0.42, decision_reasons: ["low_confidence"] }),
    );
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    await screen.findByRole("heading", { name: "추가 확인이 필요해요" });
    const deviceCamera = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    const click = vi.spyOn(deviceCamera, "click");

    await userEvent.click(screen.getByRole("button", { name: "다시 촬영하기" }));

    expect(click).toHaveBeenCalled();
    expect(fakeNavigation.pathname).toBe("/diagnosis");
  });

  it("데스크탑은 진단 시각 문장·사진 정보 카드·화면 아래의 새 진단이고, 없는 값은 확인 불가다", async () => {
    stubDesktop();
    vi.mocked(diagnoseImage).mockResolvedValue(
      response({ crop_type: undefined, severity: undefined }),
    );
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(action("이 사진으로 진단하기"));

    await screen.findByRole("heading", { name: "고추 탄저병" });
    expect(screen.getByText("2026년 10월 6일 오후 2:18에 확인한 결과예요.")).toBeTruthy();
    const meta = screen.getByRole("region", { name: "진단에 사용한 사진과 정보" });
    expect(within(meta).getByText("2026.10.06 · 14:18")).toBeTruthy();
    expect(within(meta).getAllByText("확인 불가")).toHaveLength(2);
    expect(within(meta).getByText("90%")).toBeTruthy();
    expect(action("새 진단")).toBeTruthy();
  });
});

describe("진단 결과 화면 새로고침", () => {
  it("저장된 마지막 결과를 다시 불러와 보인다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValue(response());
    const { container, unmount } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    await screen.findByRole("heading", { name: "고추 탄저병" });
    expect(sessionStorage.getItem("cropy:lastDiagnosisId")).toBe("d1");

    // 새로고침: 앱이 처음부터 다시 그려지고 메모리의 결과는 사라진다
    unmount();
    vi.mocked(fetchDiagnosisDetail).mockResolvedValue(
      response({ disease_name: "다시 불러온 병", image_url: "/media/d1.jpg" }),
    );
    fakeNavigation.reset("/diagnosis");
    renderHome();

    expect(screen.getByText("마지막 진단 결과를 불러오고 있어요")).toBeTruthy();
    await screen.findByRole("heading", { name: "다시 불러온 병" });
    expect(vi.mocked(fetchDiagnosisDetail).mock.calls[0][0]).toBe("d1");
    expect(screen.getByAltText("진단한 작물").getAttribute("src")).toBe("/media/d1.jpg");
  });

  it("불러오지 못하면 진단 시작 안내를 보이고 저장한 id 를 지운다", async () => {
    sessionStorage.setItem("cropy:lastDiagnosisId", "gone");
    vi.mocked(fetchDiagnosisDetail).mockRejectedValue(new Error("없음"));
    fakeNavigation.reset("/diagnosis");
    renderHome();

    await waitFor(() => expect(title()).toBe("진단 시작"));
    expect(sessionStorage.getItem("cropy:lastDiagnosisId")).toBeNull();
  });

  it("저장한 결과가 없으면 불러오지 않고 진단 시작 안내다", async () => {
    fakeNavigation.reset("/diagnosis");
    renderHome();

    expect(title()).toBe("진단 시작");
    expect(fetchDiagnosisDetail).not.toHaveBeenCalled();
  });

  it("새로고침 후 결과를 복원할 때는 문서 스크롤을 초기화하지 않는다", async () => {
    const scrollTo = vi.fn();
    const original = Object.getOwnPropertyDescriptor(document, "scrollingElement");

    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: { scrollTo },
    });

    try {
      let resolveDetail!: (value: DiagnoseResponse) => void;

      vi.mocked(fetchDiagnosisDetail).mockReturnValue(
        new Promise<DiagnoseResponse>((resolve) => {
          resolveDetail = resolve;
        }),
      );

      sessionStorage.setItem("cropy:lastDiagnosisId", "d1");
      fakeNavigation.reset("/diagnosis");

      renderHome();

      // 복원 중 상태에서는 스크롤을 변경하지 않는다.
      expect(
        screen.getByText("마지막 진단 결과를 불러오고 있어요"),
      ).toBeTruthy();
      expect(scrollTo).not.toHaveBeenCalled();

      // 저장된 진단 결과를 불러온다.
      await act(async () => {
        resolveDetail(response());
      });

      expect(title()).toBe("진단 결과");

      // restoring → result 전환도 기존 스크롤 위치를 유지한다.
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      if (original) {
        Object.defineProperty(document, "scrollingElement", original);
      } else {
        Reflect.deleteProperty(document, "scrollingElement");
      }
    }
  });
});

describe("진단 결과 화면 — 화면을 오갈 때", () => {
  it("이력에 다녀온 뒤 분석 취소는 뒤로 가지 않고 촬영 화면으로 간다", async () => {
    vi.mocked(diagnoseImage).mockReturnValue(pendingDiagnosis().promise);
    const back = vi.spyOn(fakeRouter, "back");
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    await waitFor(() => expect(title()).toBe("사진 분석 중"));
    await goTo("/history");
    await goTo("/diagnosis");

    await userEvent.click(screen.getByRole("button", { name: "분석 취소" }));

    expect(back).not.toHaveBeenCalled();
    expect(fakeNavigation.pathname).toBe("/home");
    expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
  });

  it("새 사진을 고른 뒤에는 이전 결과를 되살리지 않고, 새 진단이 실패하면 실패 화면이다", async () => {
    vi.mocked(diagnoseImage).mockResolvedValueOnce(response());
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    await screen.findByRole("heading", { name: "고추 탄저병" });
    await goTo("/home");

    pickPhoto(container);
    expect(sessionStorage.getItem("cropy:lastDiagnosisId")).toBeNull();
    await goTo("/diagnosis");
    expect(fetchDiagnosisDetail).not.toHaveBeenCalled();
    expect(title()).toBe("진단 시작");

    await goTo("/home");
    vi.mocked(diagnoseImage).mockRejectedValueOnce(
      new ApiError("서버 오류", "MODEL_UNAVAILABLE", 503, true),
    );
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));

    await screen.findByRole("alert", { name: SERVICE_DOWN });
    expect(screen.queryByRole("heading", { name: "고추 탄저병" })).toBeNull();
  });
});

describe("진단 실패 안내 — API 오류 코드별 Figma 지속형 안내", () => {
  async function failWith(error: unknown) {
    vi.mocked(diagnoseImage).mockRejectedValueOnce(error);
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    return container;
  }

  it.each([
    ["UNSUPPORTED_IMAGE_FORMAT", 400, "지원하지 않는 사진 형식이에요", ["다른 사진 선택"]],
    ["IMAGE_TOO_LARGE", 413, "사진 용량이 너무 커요", ["다른 사진 선택"]],
    ["IMAGE_RESOLUTION_TOO_LARGE", 413, "사진 용량이 너무 커요", ["다른 사진 선택"]],
    ["REQUEST_TOO_LARGE", 413, "사진 용량이 너무 커요", ["다른 사진 선택"]],
    ["EMPTY_IMAGE", 400, "사진을 열지 못했어요", ["다른 사진 선택"]],
    ["INVALID_IMAGE", 400, "사진을 열지 못했어요", ["다른 사진 선택"]],
    ["IDEMPOTENCY_CONFLICT", 409, "사진을 보내지 못했어요", ["다시 보내기", "다른 사진 선택"]],
    ["HTTP_ERROR", 400, "사진을 보내지 못했어요", ["다시 보내기", "다른 사진 선택"]],
    // 서버 장애는 사진·연결 문제로 오해하지 않게 서비스 안내로 보인다
    ["MODEL_UNAVAILABLE", 503, SERVICE_DOWN, ["다시 시도하기", "사진 확인으로"]],
    ["DATABASE_UNAVAILABLE", 503, SERVICE_DOWN, ["다시 시도하기", "사진 확인으로"]],
    ["HTTP_ERROR", 500, SERVICE_DOWN, ["다시 시도하기", "사진 확인으로"]],
  ])('%s(%i) 이면 "%s" 안내를 보인다', async (code, status, heading, buttons) => {
    await failWith(new ApiError("서버 문구", code, status, false));

    const alert = await screen.findByRole("alert", { name: heading });
    expect(
      within(alert)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(buttons);
    // 서버의 문구 대신 Figma 문구를 보인다
    expect(screen.queryByText("서버 문구")).toBeNull();
  });

  it("서버에 닿지 못하면 인터넷 연결 안내를 보이고, 사진 확인으로 돌아갈 수 있다", async () => {
    await failWith(new TypeError("Failed to fetch"));

    const alert = await screen.findByRole("alert", { name: "인터넷 연결을 확인해주세요" });
    await userEvent.click(within(alert).getByRole("button", { name: "사진 확인으로" }));

    expect(fakeNavigation.pathname).toBe("/home");
    expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
  });

  it("다시 보내기를 누르면 같은 사진으로 다시 진단한다", async () => {
    await failWith(new ApiError("", "IDEMPOTENCY_CONFLICT", 409, false));
    vi.mocked(diagnoseImage).mockResolvedValueOnce(response());

    const alert = await screen.findByRole("alert", { name: "사진을 보내지 못했어요" });
    await userEvent.click(within(alert).getByRole("button", { name: "다시 보내기" }));

    await screen.findByRole("heading", { name: "고추 탄저병" });
    expect(diagnoseImage).toHaveBeenCalledTimes(2);
  });

  it("서버 장애에서 다시 시도하기를 누르면 같은 사진으로 다시 진단한다", async () => {
    await failWith(new ApiError("", "MODEL_UNAVAILABLE", 503, true));
    vi.mocked(diagnoseImage).mockResolvedValueOnce(response());

    const alert = await screen.findByRole("alert", { name: SERVICE_DOWN });
    await userEvent.click(within(alert).getByRole("button", { name: "다시 시도하기" }));

    await screen.findByRole("heading", { name: "고추 탄저병" });
    expect(diagnoseImage).toHaveBeenCalledTimes(2);
  });

  it("사진 문제면 다른 사진 선택이 사진 고르기 창을 연다", async () => {
    await failWith(new ApiError("", "INVALID_IMAGE", 400, false));
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

    const alert = await screen.findByRole("alert", { name: "사진을 열지 못했어요" });
    await userEvent.click(within(alert).getByRole("button", { name: "다른 사진 선택" }));

    expect(click).toHaveBeenCalled();
    expect((click.mock.contexts[0] as HTMLInputElement).getAttribute("aria-label")).toBe(
      "갤러리 사진 선택",
    );
  });

  it("촬영 화면에서 쓸 수 없는 사진을 고르면 안내를 보이고, 맞는 사진을 고르면 걷는다", async () => {
    const { container } = renderHome();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["x"], "leaf.gif", { type: "image/gif" })] },
    });
    expect(screen.getByRole("alert", { name: "지원하지 않는 사진 형식이에요" })).toBeTruthy();

    pickPhoto(container);
    expect(screen.queryByRole("alert", { name: "지원하지 않는 사진 형식이에요" })).toBeNull();
    expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
  });

  it("실패 화면에서 다시 고른 사진도 쓸 수 없으면 그 안내로 바꿔 보인다", async () => {
    const container = await failWith(new ApiError("", "MODEL_UNAVAILABLE", 503, true));
    await screen.findByRole("alert", { name: SERVICE_DOWN });

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "leaf.gif", { type: "image/gif" })] },
    });

    expect(screen.getByRole("alert", { name: "지원하지 않는 사진 형식이에요" })).toBeTruthy();
    expect(screen.queryByRole("alert", { name: SERVICE_DOWN })).toBeNull();
  });

  it("진단 시작 안내에서 너무 큰 사진을 고르면 용량 안내를 보인다", async () => {
    const { container } = renderHome();
    await goTo("/diagnosis");
    const big = new File(["x"], "leaf.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: MAX_IMAGE_BYTES + 1 });

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [big] },
    });

    expect(screen.getByRole("alert", { name: "사진 용량이 너무 커요" })).toBeTruthy();
    expect(fakeNavigation.pathname).toBe("/diagnosis");
  });
});

describe("후보 혼동의 추가 촬영 — 촬영 화면에서 찍고 다시 분석한다", () => {
  const confusion = () =>
    response({
      confidence: 0.47,
      decision_reasons: ["confusion"],
      recapture: {
        region: "잎 뒷면",
        instruction: "같은 잎을 뒤집어 뒷면이 보이도록 찍어주세요.",
        margin: 0.05,
        candidates: [
          { name: "무 노균병", cue: "" },
          { name: "무 검은무늬병", cue: "" },
        ],
      },
    });

  async function showConfusion() {
    vi.mocked(diagnoseImage).mockResolvedValueOnce(confusion());
    const view = renderHome();
    pickPhoto(view.container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));
    await screen.findByRole("heading", { name: "비슷한 증상이 보여요" });
    return view;
  }

  /** 촬영 방법 단계의 갤러리에서 추가 사진을 골라 촬영 화면의 사진 확인으로 간다 */
  async function pickExtraPhoto() {
    await userEvent.click(screen.getByRole("button", { name: "그림 보고 다시 촬영하기" }));
    fireEvent.change(screen.getByLabelText("갤러리에서 추가 사진 선택"), {
      target: { files: [new File(["y"], "back.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
  }

  it("바로 다시 촬영은 촬영 화면으로 옮겨 카메라를 켜고, 찍을 부위를 제목에 둔다", async () => {
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    try {
      await showConfusion();

      await userEvent.click(screen.getByRole("button", { name: "바로 다시 촬영" }));

      await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
      expect(title()).toBe("잎 뒷면 추가 촬영");
      // 옛 풀스크린 카메라를 띄우지 않는다
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    }
  });

  it("갤러리로 고른 사진은 촬영 화면에서 확인하고, 다시 분석은 같은 진단을 다시 분석한다", async () => {
    await showConfusion();
    await pickExtraPhoto();

    expect(title()).toBe("추가 사진 확인");
    expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
    // 결과를 지우지 않아 새로고침해도 원래 진단을 다시 불러온다
    expect(sessionStorage.getItem("cropy:lastDiagnosisId")).toBe("d1");

    vi.mocked(refineDiagnosis).mockResolvedValueOnce(response({ disease_name: "무 노균병" }));
    await userEvent.click(action("이 사진으로 다시 분석"));

    await screen.findByRole("heading", { name: "무 노균병" });
    expect(fakeNavigation.pathname).toBe("/diagnosis");
    expect(refineDiagnosis).toHaveBeenCalledWith("d1", expect.any(File), expect.anything());
    expect(vi.mocked(refineDiagnosis).mock.calls[0][1].name).toBe("back.jpg");
    expect(diagnoseImage).toHaveBeenCalledTimes(1);

    // 다시 분석이 끝나면 추가 촬영도 끝난다. 다음 사진은 새 진단이다
    await userEvent.click(screen.getByRole("button", { name: "새 사진으로 진단하기" }));
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
    expect(title()).not.toBe("잎 뒷면 추가 촬영");
  });

  it("다시 분석이 실패하면 결과가 있어도 실패 안내를 보이고, 다시 시도하기는 다시 분석으로 간다", async () => {
    await showConfusion();
    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockRejectedValueOnce(
      new ApiError("", "MODEL_UNAVAILABLE", 503, true),
    );

    await userEvent.click(action("이 사진으로 다시 분석"));

    const alert = await screen.findByRole("alert", { name: SERVICE_DOWN });
    expect(screen.queryByRole("heading", { name: "비슷한 증상이 보여요" })).toBeNull();

    vi.mocked(refineDiagnosis).mockResolvedValueOnce(response({ disease_name: "무 노균병" }));
    await userEvent.click(within(alert).getByRole("button", { name: "다시 시도하기" }));

    await screen.findByRole("heading", { name: "무 노균병" });
    expect(refineDiagnosis).toHaveBeenCalledTimes(2);
    expect(diagnoseImage).toHaveBeenCalledTimes(1);
  });

  it("다시 분석할 기록이 없어졌으면 이력으로 가는 안내다", async () => {
    await showConfusion();
    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockRejectedValueOnce(
      new ApiError("", "DIAGNOSIS_NOT_FOUND", 404, false),
    );

    await userEvent.click(action("이 사진으로 다시 분석"));

    const alert = await screen.findByRole("alert", { name: "이 기록을 찾을 수 없어요" });
    await userEvent.click(within(alert).getByRole("button", { name: "이력으로" }));

    await waitFor(() => expect(fakeNavigation.pathname).toBe("/history"));
  });

  it.each([
    ["MODEL_VERSION_CONFLICT", 409],
    ["REFINEMENT_UNAVAILABLE", 400],
  ])("%s(%i) 면 다시 보내지 않고 새 진단이나 이력으로 안내한다", async (code, status) => {
    await showConfusion();
    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockRejectedValueOnce(new ApiError("", code, status, false));

    await userEvent.click(action("이 사진으로 다시 분석"));

    const alert = await screen.findByRole("alert", { name: "이 사진으로 다시 분석할 수 없어요" });
    expect(
      within(alert)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["새 진단 시작", "이력으로"]);
    // 재촬영 안내로 돌아가도 같은 실패를 되풀이하므로 추가 촬영 취소를 두지 않는다
    expect(screen.queryByRole("button", { name: "추가 촬영 취소" })).toBeNull();

    await userEvent.click(within(alert).getByRole("button", { name: "이력으로" }));
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/history"));
  });

  it("서버 장애에서 사진 확인으로는 고른 사진을 둔 채 촬영 화면으로 돌아간다", async () => {
    vi.mocked(diagnoseImage).mockRejectedValueOnce(new ApiError("", "MODEL_UNAVAILABLE", 503, true));
    const { container } = renderHome();
    pickPhoto(container);
    await userEvent.click(screen.getByRole("button", { name: "이 사진으로 진단하기" }));

    const alert = await screen.findByRole("alert", { name: SERVICE_DOWN });
    await userEvent.click(within(alert).getByRole("button", { name: "사진 확인으로" }));

    expect(fakeNavigation.pathname).toBe("/home");
    expect(screen.getByAltText("촬영한 작물 미리보기")).toBeTruthy();
  });

  it("다시 분석할 수 없을 때 새 진단 시작은 추가 촬영을 끝내고 촬영 화면 처음으로 간다", async () => {
    await showConfusion();
    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockRejectedValueOnce(
      new ApiError("", "MODEL_VERSION_CONFLICT", 409, false),
    );

    await userEvent.click(action("이 사진으로 다시 분석"));
    const alert = await screen.findByRole("alert", { name: "이 사진으로 다시 분석할 수 없어요" });
    await userEvent.click(within(alert).getByRole("button", { name: "새 진단 시작" }));

    await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
    expect(title()).not.toBe("잎 뒷면 추가 촬영");
    expect(title()).not.toBe("추가 사진 확인");
    expect(refineDiagnosis).toHaveBeenCalledTimes(1);
  });

  it("추가 촬영 취소는 사진을 비우고 재촬영 안내로 돌아간다", async () => {
    await showConfusion();
    await pickExtraPhoto();

    await userEvent.click(screen.getByRole("button", { name: "추가 촬영 취소" }));

    await screen.findByRole("heading", { name: "비슷한 증상이 보여요" });
    expect(fakeNavigation.pathname).toBe("/diagnosis");
    await goTo("/home");
    expect(screen.queryByAltText("촬영한 작물 미리보기")).toBeNull();
    expect(screen.queryByRole("button", { name: "추가 촬영 취소" })).toBeNull();
  });

  it("추가 촬영 중 분석 취소는 추가 사진 확인으로 돌아간다", async () => {
    await showConfusion();
    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockReturnValueOnce(pendingDiagnosis().promise);

    await userEvent.click(action("이 사진으로 다시 분석"));
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/diagnosis"));
    await userEvent.click(screen.getByRole("button", { name: "분석 취소" }));

    await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
    expect(title()).toBe("추가 사진 확인");
    expect(action("이 사진으로 다시 분석")).toBeTruthy();
  });

  it("다시 분석 중에는 원래 결과를 읽지 않고 분석 중 안내만 읽는다", async () => {
    const speech = installFakeSpeech();
    setVoiceEnabled(true);
    await showConfusion();
    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockReturnValueOnce(pendingDiagnosis().promise);
    speech.speak.mockClear();

    await userEvent.click(action("이 사진으로 다시 분석"));
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/diagnosis"));

    expect(spokenTexts(speech)).toEqual([PROMPT_DIAGNOSING]);
  });

  it("다시 분석이 실패하면 추가 촬영 취소로 재촬영 안내로 돌아간다", async () => {
    await showConfusion();
    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockRejectedValueOnce(
      new ApiError("", "MODEL_UNAVAILABLE", 503, true),
    );
    await userEvent.click(action("이 사진으로 다시 분석"));
    await screen.findByRole("alert", { name: SERVICE_DOWN });

    await userEvent.click(screen.getByRole("button", { name: "추가 촬영 취소" }));

    await screen.findByRole("heading", { name: "비슷한 증상이 보여요" });
    expect(screen.queryByRole("alert", { name: SERVICE_DOWN })).toBeNull();
  });

  it("재촬영 안내에서 쓸 수 없는 사진을 고르면 안내만 보이고 추가 촬영을 시작하지 않는다", async () => {
    await showConfusion();
    await userEvent.click(screen.getByRole("button", { name: "그림 보고 다시 촬영하기" }));

    fireEvent.change(screen.getByLabelText("갤러리에서 추가 사진 선택"), {
      target: { files: [new File(["x"], "leaf.gif", { type: "image/gif" })] },
    });

    expect(
      await screen.findByRole("alert", { name: "지원하지 않는 사진 형식이에요" }),
    ).toBeTruthy();
    expect(fakeNavigation.pathname).toBe("/diagnosis");
    await goTo("/home");
    expect(screen.queryByRole("button", { name: "추가 촬영 취소" })).toBeNull();
  });

  it("다시 분석이 끝난 뒤 새 사진은 새 진단으로 보낸다", async () => {
    const { container } = await showConfusion();
    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockResolvedValueOnce(response({ disease_name: "무 노균병" }));
    await userEvent.click(action("이 사진으로 다시 분석"));
    await screen.findByRole("heading", { name: "무 노균병" });

    await userEvent.click(screen.getByRole("button", { name: "새 사진으로 진단하기" }));
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/home"));
    vi.mocked(diagnoseImage).mockResolvedValueOnce(response());
    pickPhoto(container);
    await userEvent.click(action("이 사진으로 진단하기"));

    await screen.findByRole("heading", { name: "고추 탄저병" });
    expect(diagnoseImage).toHaveBeenCalledTimes(2);
    expect(refineDiagnosis).toHaveBeenCalledTimes(1);
  });

  it("이력 상세에서 시작한 추가 촬영은 취소하면 이력 상세로, 다시 분석하면 진단 결과로 간다", async () => {
    vi.mocked(fetchDiagnosisDetail).mockResolvedValue(confusion());
    render(
      <AppFrame>
        <FakeRoutes
          routes={{
            "/home": <HomePage />,
            "/diagnosis": <DiagnosisRoute />,
            "/history/d1": <HistoryDetailPage />,
          }}
        />
      </AppFrame>,
    );
    await goTo("/history/d1");
    await screen.findByRole("heading", { name: "비슷한 증상이 보여요" });

    await pickExtraPhoto();
    expect(title()).toBe("추가 사진 확인");
    await userEvent.click(screen.getByRole("button", { name: "추가 촬영 취소" }));
    await waitFor(() => expect(fakeNavigation.pathname).toBe("/history/d1"));
    await screen.findByRole("heading", { name: "비슷한 증상이 보여요" });

    await pickExtraPhoto();
    vi.mocked(refineDiagnosis).mockResolvedValueOnce(response({ disease_name: "무 노균병" }));
    await userEvent.click(action("이 사진으로 다시 분석"));

    await screen.findByRole("heading", { name: "무 노균병" });
    expect(fakeNavigation.pathname).toBe("/diagnosis");
    expect(refineDiagnosis).toHaveBeenCalledWith("d1", expect.any(File), expect.anything());
    expect(diagnoseImage).not.toHaveBeenCalled();
  });

  it("다른 화면으로 가면 추가 촬영을 그만둔다", async () => {
    await showConfusion();
    await pickExtraPhoto();

    await goTo("/history");
    await goTo("/home");

    expect(screen.queryByRole("button", { name: "추가 촬영 취소" })).toBeNull();
    expect(action("이 사진으로 진단하기")).toBeTruthy();
  });
});

describe("결과 표시 도우미", () => {
  it("진단 시각을 문장으로 만든다 (자정·정오 포함)", () => {
    expect(resultTimeSentence("2026-10-06T00:05:00")).toBe(
      "2026년 10월 6일 오전 12:05에 확인한 결과예요.",
    );
    expect(resultTimeSentence("2026-10-06T12:30:00")).toBe(
      "2026년 10월 6일 오후 12:30에 확인한 결과예요.",
    );
    expect(resultTimeSentence("날짜 아님")).toBeNull();
  });

  it("정상 판정은 정상, 등급이 없으면 null 이다", () => {
    expect(gradeOf(response({ category: "normal" }))?.label).toBe("정상");
    expect(gradeOf(response({ severity: "high" }))?.label).toBe("위험");
    expect(gradeOf(response({ severity: undefined }))).toBeNull();
  });
});
describe.each([false, true])("결과 안내 표시 desktop=%s", (desktop) => {
  it("응답의 한 줄 안내와 행동별 설명을 표시한다", () => {
    render(
      <DiagnosisResultView
        result={response({
          summary_message: "결과 카드 테스트 안내",
          management_action_details: [
            {
              title: "감염 부위 제거",
              description: "첫 번째 행동 테스트 설명",
            },
            {
              title: "주변 포기 확인",
              description: "두 번째 행동 테스트 설명",
            },
          ],
        })}
        photo={null}
        desktop={desktop}
      />,
    );

    expect(screen.getByText("결과 카드 테스트 안내")).toBeTruthy();
    expect(screen.getByText("첫 번째 행동 테스트 설명")).toBeTruthy();
    expect(screen.getByText("두 번째 행동 테스트 설명")).toBeTruthy();
  });

  it("상세 설명이 없는 이전 기록은 행동 제목을 유지한다", () => {
    render(
      <DiagnosisResultView
        result={response({
          summary_message: null,
          management_action_details: [],
        })}
        photo={null}
        desktop={desktop}
        isRecord
      />,
    );

    expect(screen.getByText("감염 부위 제거")).toBeTruthy();
    expect(screen.getByText("주변 포기 확인")).toBeTruthy();
    expect(screen.queryByText("결과 카드 테스트 안내")).toBeNull();
  });

  it("행동 제목과 일치하지 않는 설명은 표시하지 않는다", () => {
    render(
      <DiagnosisResultView
        result={response({
          management_action_details: [
            {
              title: "다른 행동 제목",
              description: "표시하면 안 되는 설명",
            },
          ],
        })}
        photo={null}
        desktop={desktop}
      />,
    );

    expect(screen.getByText("감염 부위 제거")).toBeTruthy();
    expect(screen.queryByText("다른 행동 제목")).toBeNull();
    expect(screen.queryByText("표시하면 안 되는 설명")).toBeNull();
  });
});
