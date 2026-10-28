import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CAPTURE_PATH } from "@/components/diagnosis/DiagnosisSession";
import { HistoryEmptyState } from "./HistoryEmptyState";

vi.mock("next/navigation", async () => (await import("@/testing/fakeNavigation")).nextNavigation);

describe("HistoryEmptyState", () => {
  // "/" 는 스플래시로 넘어가므로 촬영 화면 주소로 바로 보낸다
  it("기록이 없을 때 첫 진단 버튼은 촬영 화면으로 간다", () => {
    render(<HistoryEmptyState mode="no-history" onResetFilters={() => {}} />);

    const link = screen.getByRole("link", { name: "첫 진단 시작하기" });
    expect(link.getAttribute("href")).toBe(CAPTURE_PATH);
  });
});
