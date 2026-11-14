
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
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

// 한 번 본 이력은 탭 메모리 캐시(lib/historyCache)로 다시 들어올 때 로딩 없이 바로 보인다
function listOnly(data: PaginatedHistory) {
  fetchMock.mockImplementation((_page, size) =>
    Promise.resolve(size === 1 ? countResponse : data)
  );
}

function loadingCard() {
  return screen.queryByRole("heading", { name: "진단 이력을 불러오고 있어요" });
}

it("처음 들어올 때만 마스코트 로딩을 보이고, 다시 들어오면 로딩 없이 지난 목록을 바로 보인 뒤 새로 불러와 고친다", async () => {
  listOnly(response("이전 진단", "고추"));
  const first = render(<HistoryPage />);
  await screen.findByText("이전 진단");
  first.unmount();

  let resolve!: (data: PaginatedHistory) => void;
  fetchMock.mockImplementation((_page, size) =>
    size === 1
      ? Promise.resolve(countResponse)
      : new Promise<PaginatedHistory>((res) => {
          resolve = res;
        })
  );
  render(<HistoryPage />);

  // 첫 화면부터 목록이 있고 로딩 안내가 없다
  expect(screen.getByText("이전 진단")).toBeTruthy();
  expect(loadingCard()).toBeNull();
  // 뒤에서 새로 불러온 결과로 바꾼다
  await act(async () => resolve(response("새 진단", "배추")));
  expect(screen.getByText("새 진단")).toBeTruthy();
  expect(screen.queryByText("이전 진단")).toBeNull();
});

it("다시 들어와 새로 불러오기에 실패해도 보이던 목록을 그대로 두고 오류를 띄우지 않는다", async () => {
  listOnly(response("이전 진단", "고추"));
  const first = render(<HistoryPage />);
  await screen.findByText("이전 진단");
  first.unmount();

  fetchMock.mockImplementation((_page, size) =>
    size === 1 ? Promise.resolve(countResponse) : Promise.reject(new Error("조회 실패"))
  );
  render(<HistoryPage />);
  await act(async () => {});

  expect(screen.getByText("이전 진단")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("상세에서 돌아오면 남긴 필터의 목록을 첫 화면부터 보인다", async () => {
  listOnly(response("배추 진단", "배추"));
  const first = render(<HistoryPage />);
  fireEvent.click(screen.getByRole("button", { name: /배추/ }));
  await screen.findByText("배추 진단");
  first.unmount();
  sessionStorage.setItem(
    "cropy:history-view",
    JSON.stringify({ crop: "배추", grade: "", page: 1, scrollY: 0 })
  );

  fetchMock.mockImplementation(() => new Promise(() => {}));
  render(<HistoryPage />);

  expect(screen.getByText("배추 진단")).toBeTruthy();
  expect(loadingCard()).toBeNull();
  expect(screen.getByRole("button", { name: /배추/ }).getAttribute("aria-pressed")).toBe("true");
});

it("새로고침 직후(캐시 없음)에는 개발 모드처럼 effect 가 두 번 돌아도 남긴 필터를 되살리고 지운다", async () => {
  listOnly(response("배추 진단", "배추"));
  sessionStorage.setItem(
    "cropy:history-view",
    JSON.stringify({ crop: "배추", grade: "", page: 1, scrollY: 0 })
  );

  render(
    <StrictMode>
      <HistoryPage />
    </StrictMode>
  );

  await screen.findByText("배추 진단");
  expect(screen.getByRole("button", { name: /배추/ }).getAttribute("aria-pressed")).toBe("true");
  expect(fetchMock.mock.calls.filter((args) => args[1] === 20).at(-1)?.[2]).toBe("배추");
  expect(sessionStorage.getItem("cropy:history-view")).toBeNull();
});

it("캐시로 다시 들어온 첫 화면은 남긴 상태를 읽기만 하고, 지우는 일은 화면을 그린 뒤에 한다", async () => {
  listOnly(response("이전 진단", "고추"));
  const first = render(<HistoryPage />);
  await screen.findByText("이전 진단");
  first.unmount();
  sessionStorage.setItem(
    "cropy:history-view",
    JSON.stringify({ crop: "", grade: "", page: 1, scrollY: 0 })
  );

  render(<HistoryPage />);

  expect(screen.getByText("이전 진단")).toBeTruthy();
  expect(sessionStorage.getItem("cropy:history-view")).toBeNull();
});
