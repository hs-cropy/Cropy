
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fetchHistory } from "@/lib/api";
import type { PaginatedHistory } from "@/types/diagnosis";
import HistoryPage from "./page";

vi.mock("@/lib/api", () => ({
  fetchHistory: vi.fn(),
}));

const fetchMock = vi.mocked(fetchHistory);

const response = (
  disease_name: string,
  crop_type: string
): PaginatedHistory => ({
  items: [
    {
      id: disease_name,
      disease_name,
      crop_type,
      confidence: 0.9,
      created_at: "2026-10-10T00:00:00Z",
    },
  ],
  total: 21,
  unfiltered_total: 21,
  crop_total: 21,
  page: 1,
  size: 20,
});

const countResponse: PaginatedHistory = {
  items: [],
  total: 0,
  unfiltered_total: 21,
  crop_total: 0,
  page: 1,
  size: 1,
};

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();

  // 기본 테스트 환경은 모바일로 설정
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

for (const change of ["crop", "page"]) {
  it(
    "hides previous results when a " +
      change +
      " request fails, then shows the retried results",
    async () => {
      let listRequestCount = 0;

      fetchMock.mockImplementation((_page, size) => {
        // 작물별 건수 조회
        if (size === 1) {
          return Promise.resolve(countResponse);
        }

        // 실제 이력 목록 조회
        listRequestCount += 1;

        if (listRequestCount === 1) {
          return Promise.resolve(
            response("이전 진단", "고추")
          );
        }

        if (listRequestCount === 2) {
          return Promise.reject(
            new Error("조회 실패")
          );
        }

        if (listRequestCount === 3) {
          return Promise.resolve(
            response("새 진단", "배추")
          );
        }

        return Promise.reject(
          new Error("예상하지 못한 추가 목록 조회")
        );
      });

      render(<HistoryPage />);

      // 최초 기록 표시
      await screen.findByText("이전 진단");

      // 작물 또는 페이지 변경

    if (change === "crop") {
        fireEvent.click(
            screen.getByRole("button", { name: /배추/ })
        );
        } else {
        fireEvent.click(
            screen.getByRole("button", { name: "다음" })
        );
    }


      // 조회 실패 확인
      await screen.findByRole("alert");
      expect(screen.queryByText("이전 진단")).toBeNull();
        expect(
        screen.queryByRole("navigation", {
            name: "진단 이력 페이지",
        })
    ).toBeNull();


      expect(
        screen.queryByText("선택한 조건의 기록이 없어요")
      ).toBeNull();

      // 다시 불러오기
      fireEvent.click(
        screen.getByRole("button", {
          name: "다시 불러오기",
        })
      );

      await screen.findByText("새 진단");

      expect(screen.queryByRole("alert")).toBeNull();

      // 건수 조회를 제외한 목록 요청만 검사
      const listCalls = fetchMock.mock.calls.filter(
        (args) => args[1] === 20
      );      
    expect(listCalls[2].slice(0, 4)).toEqual(
      change === "crop"
        ? [1, 20, "배추", undefined]
        : [2, 20, undefined, undefined] );
    }
  );
}

it("모바일에서 이력 목록 복귀 시 본문 스크롤 위치를 복원한다", async () => {
  sessionStorage.setItem(
    "cropy:history-view",
    JSON.stringify({
      crop: "",
      grade: "",
      page: 1,
      scrollY: 640,
    }),
  );

  fetchMock.mockImplementation((_page, size) =>
    Promise.resolve(
      size === 1
        ? countResponse
        : response("저장된 진단", "고추"),
    ),
  );

  render(<HistoryPage />);

  const region = screen.getByRole("region", {
    name: "진단 이력",
  });

  // 이력 목록이 로딩되어 실제로 표시될 때까지 기다린다.
  await screen.findByText("저장된 진단");

  // 이전에 저장한 스크롤 위치로 이동해야 한다.
  await waitFor(() => {
    expect(region.scrollTop).toBe(640);
  });

  // 복원에 사용한 저장 정보는 다시 사용하지 않는다.
  expect(sessionStorage.getItem("cropy:history-view")).toBeNull();
});

it("모바일에서 작물 필터를 변경하면 본문 스크롤을 맨 위로 이동시킨다", async () => {
  fetchMock.mockImplementation((_page, size) =>
    Promise.resolve(
      size === 1
        ? countResponse
        : response("고추 진단", "고추"),
    ),
  );

  render(<HistoryPage />);

  await screen.findByText("고추 진단");

  const region = screen.getByRole("region", {
    name: "진단 이력",
  });

  region.scrollTop = 640;

  fireEvent.click(
    screen.getByRole("button", { name: /배추/ }),
  );

  expect(region.scrollTop).toBe(0);
});

it("모바일에서 페이지를 변경하면 본문 스크롤을 맨 위로 이동시킨다", async () => {
  fetchMock.mockImplementation((_page, size) =>
    Promise.resolve(
      size === 1
        ? countResponse
        : response("고추 진단", "고추"),
    ),
  );
  
  render(<HistoryPage />);

  await screen.findByText("고추 진단");

  const region = screen.getByRole("region", {
    name: "진단 이력",
  });

  region.scrollTop = 640;

  fireEvent.click(
    screen.getByRole("button", { name: "다음" }),
  );

  expect(region.scrollTop).toBe(0);
});

it("데스크톱에서 이력 목록 복귀 시 본문 region의 스크롤 위치를 복원한다", async () => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string): MediaQueryList => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  );

  sessionStorage.setItem(
    "cropy:history-view",
    JSON.stringify({
      crop: "",
      grade: "",
      page: 1,
      scrollY: 640,
    }),
  );

  fetchMock.mockImplementation((_page, size) =>
    Promise.resolve(
      size === 1
        ? countResponse
        : response("저장된 진단", "고추"),
    ),
  );

  render(<HistoryPage />);

  const region = screen.getByRole("region", {
    name: "진단 이력",
  });

  await screen.findByText("저장된 진단");

  await waitFor(() => {
    expect(region.scrollTop).toBe(640);
  });

  expect(sessionStorage.getItem("cropy:history-view")).toBeNull();
});

it("모바일에서 진단 이력 상세로 이동하기 전에 본문 스크롤 위치를 저장한다", async () => {
  fetchMock.mockImplementation((_page, size) =>
    Promise.resolve(
      size === 1
        ? countResponse
        : response("고추 진단", "고추"),
    ),
  );

  render(<HistoryPage />);

  await screen.findByText("고추 진단");

  const region = screen.getByRole("region", {
    name: "진단 이력",
  });

  region.scrollTop = 640;

  const detailLink = screen.getByRole("link", {
    name: /고추 진단.*진단 상세 보기/,
  });

  // 브라우저의 기본 링크 이동을 막고 클릭 시 스크롤 위치가 저장되는지만 검증한다
  const clickEvent = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });

  clickEvent.preventDefault();
  fireEvent(detailLink, clickEvent);

  expect(detailLink.getAttribute("href")).toBe(
    "/history/%EA%B3%A0%EC%B6%94%20%EC%A7%84%EB%8B%A8",
  );

  expect(
    JSON.parse(
      sessionStorage.getItem("cropy:history-view") ?? "{}",
    ),
  ).toEqual({
    crop: "",
    grade: "",
    page: 1,
    scrollY: 640,
  });
});