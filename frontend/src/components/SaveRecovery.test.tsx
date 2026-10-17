import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, saveResult } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import { SaveRecovery } from "./SaveRecovery";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  saveResult: vi.fn(),
}));

function failed(overrides: Partial<DiagnoseResponse> = {}): DiagnoseResponse {
  return {
    id: "d1",
    crop_type: "고추",
    disease_name: "고추 탄저병",
    severity: "medium",
    confidence: 0.9,
    top_predictions: [],
    management_actions: [],
    causes: [],
    pesticides: [],
    prevention: [],
    created_at: "2026-10-06T14:18:00",
    save_status: "failed",
    recovery_token: "token",
    ...overrides,
  };
}

// 오류는 부를 때 만든다. 미리 만들어 넘기면 vitest 가 그 오류를 테스트 실패로 잡는다
function failSaveWith(code: string, status: number) {
  vi.mocked(saveResult).mockImplementation(async () => {
    throw new ApiError("", code, status, false);
  });
}

const notice = () => screen.getByRole("alert", { name: "이력에 저장하지 못했어요" });

describe("SaveRecovery (Figma inline/save-failed)", () => {
  it("저장된 결과에는 아무것도 보이지 않는다", () => {
    const { container } = render(<SaveRecovery result={failed({ save_status: "saved" })} />);
    expect(container.innerHTML).toBe("");
  });

  it("다시 저장에 성공하면 저장된 결과를 넘긴다", async () => {
    const saved = failed({ save_status: "saved" });
    vi.mocked(saveResult).mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<SaveRecovery result={failed()} onSaved={onSaved} />);

    await userEvent.click(within(notice()).getByRole("button", { name: "다시 저장" }));

    expect(saveResult).toHaveBeenCalledWith("token");
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("SAVE_FAILED 처럼 다시 해 볼 수 있는 오류면 다시 저장 버튼을 남긴다", async () => {
    failSaveWith("SAVE_FAILED", 503);
    render(<SaveRecovery result={failed()} />);

    await userEvent.click(within(notice()).getByRole("button", { name: "다시 저장" }));

    expect(saveResult).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        within(notice()).getByRole("button", { name: "다시 저장" }).hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it.each([
    ["RESULT_EXPIRED", 410],
    ["RESULT_NOT_FOUND", 404],
    ["DIAGNOSIS_CHANGED", 409],
  ])("%s(%i) 면 다시 저장해도 소용없어 버튼을 뺀다", async (code, status) => {
    failSaveWith(code, status);
    render(<SaveRecovery result={failed()} />);

    await userEvent.click(within(notice()).getByRole("button", { name: "다시 저장" }));

    await waitFor(() => expect(within(notice()).queryByRole("button")).toBeNull());
  });

  it("복구 토큰이 없으면 버튼 없이 안내만 보인다", () => {
    render(<SaveRecovery result={failed({ recovery_token: null })} />);
    expect(within(notice()).queryByRole("button")).toBeNull();
  });
});
