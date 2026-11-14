import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { DiagnoseResponse } from "@/types/diagnosis";
import { DiagnosisDetails } from "./DiagnosisDetails";

function result(description?: string): DiagnoseResponse {
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
    save_status: "saved",
    description,
  };
}

async function openSymptoms(description?: string) {
  render(<DiagnosisDetails result={result(description)} variant="screen" />);
  await userEvent.click(screen.getByRole("button", { name: "증상" }));
  return screen.getByRole("region", { name: "증상" });
}

describe("DiagnosisDetails — 증상 (M-03-E1)", () => {
  it("설명을 줄바꿈마다 문단으로 나누고 빈 줄은 버린 뒤 안내 문단을 붙인다", async () => {
    const panel = await openSymptoms("열매에 갈색 병반이 생깁니다.\n\n  검은 점이 보일 수 있습니다.  \n");

    expect(Array.from(panel.querySelectorAll("p")).map((p) => p.textContent)).toEqual([
      "열매에 갈색 병반이 생깁니다.",
      "검은 점이 보일 수 있습니다.",
      "사진 속 증상과 비교해 주세요. AI 진단은 참고용입니다.",
    ]);
  });

  it("문단은 따로 글자 크기·색을 주지 않고 본문의 14px 보조색을 따른다", async () => {
    const panel = await openSymptoms("열매에 갈색 병반이 생깁니다.");

    for (const p of panel.querySelectorAll("p")) expect(p.className).toBe("");
  });

  it.each([["없으면", undefined], ["공백뿐이면", " \n\n "]])("설명이 %s 확인할 수 없다고 안내한다", async (_, description) => {
    const panel = await openSymptoms(description);

    expect(panel.textContent).toBe("이 병해의 증상 설명을 확인할 수 없어요.");
  });
});
