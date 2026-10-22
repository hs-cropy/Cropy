import { describe, expect, it } from "vitest";
import { FEEDBACK, FEEDBACK_CASE_IDS } from "./cases";

// 버튼 수는 Figma 의 Cropy/FeedbackV3/inline/* 16종과 같아야 한다.
// service-unavailable·refine-unavailable·save-unrecoverable 은 Figma 시안 대기 중인 안내다 (cases.ts).
// 문구 원문은 여기에 베끼지 않는다 (같은 문자열을 두 번 적는 것이라 오타를 잡지 못한다)
const BUTTON_COUNT: Record<string, 0 | 1 | 2> = {
  "photo-format": 1,
  "photo-size": 1,
  "photo-read": 1,
  "photo-upload": 2,
  "camera-capture": 2,
  "camera-runtime": 2,
  "analysis-offline": 2,
  "analysis-delayed": 2,
  "analysis-timeout": 2,
  "save-pending": 0,
  "save-failed": 1,
  "result-photo-unavailable": 1,
  "history-loading": 0,
  "history-failed": 1,
  "record-unavailable": 1,
  "record-load-failed": 2,
  "service-unavailable": 2,
  "refine-unavailable": 2,
  "save-unrecoverable": 1,
};

describe("피드백 문구 사전", () => {
  it("Figma 의 지속형 안내 16종과 시안 대기 3종이 빠짐없이 있다", () => {
    expect([...FEEDBACK_CASE_IDS].sort()).toEqual(Object.keys(BUTTON_COUNT).sort());
  });

  it.each(FEEDBACK_CASE_IDS)("%s 는 제목과 본문을 갖는다", (id) => {
    const item = FEEDBACK[id];

    expect(item.title.trim()).not.toBe("");
    expect(item.message.trim()).not.toBe("");
    // 제목은 한 줄이다. 줄바꿈은 본문에만 쓴다
    expect(item.title).not.toContain("\n");
  });

  it.each(FEEDBACK_CASE_IDS)("%s 의 버튼 수가 Figma 와 같다", (id) => {
    const { primary, secondary } = FEEDBACK[id];

    expect([primary, secondary].filter(Boolean)).toHaveLength(BUTTON_COUNT[id]);
    // 보조 버튼만 있는 안내는 없다
    if (secondary) expect(primary).toBeTruthy();
  });

  it("진행 중 안내는 저장 중·이력 불러오는 중 2종이고 버튼이 없다", () => {
    const busy = FEEDBACK_CASE_IDS.filter((id) => FEEDBACK[id].busy);

    expect(busy.sort()).toEqual(["history-loading", "save-pending"]);
    for (const id of busy) {
      expect(FEEDBACK[id].primary).toBeUndefined();
      expect(FEEDBACK[id].secondary).toBeUndefined();
    }
  });

  it("버튼이 없는 안내는 진행 중 안내뿐이다", () => {
    const withoutButton = FEEDBACK_CASE_IDS.filter((id) => !FEEDBACK[id].primary);

    expect(withoutButton.every((id) => FEEDBACK[id].busy)).toBe(true);
  });
});
