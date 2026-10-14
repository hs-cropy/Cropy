
import { fireEvent, render, screen } from "@testing-library/react";
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
            : [2, 20, "고추", undefined] );
    }
  );
}
