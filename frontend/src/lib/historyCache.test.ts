import { describe, expect, it, vi } from "vitest";
import { diagnoseImage, fetchHistory, refineDiagnosis, saveResult } from "./api";
import { isHistoryCacheWarm, readHistoryCache, writeHistoryCache } from "./historyCache";

function stubFetch(ok: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(ok ? { id: "d1" } : { detail: "실패" }), {
          status: ok ? 200 : 500,
        }),
      ),
    ),
  );
}

const photo = () => new File(["x"], "leaf.jpg", { type: "image/jpeg" });

describe("이력 캐시", () => {
  it.each([
    ["진단", () => diagnoseImage(photo())],
    ["추가 촬영", () => refineDiagnosis("d1", photo())],
    ["다시 저장", () => saveResult("token")],
  ])("%s 요청이 성공하면 비운다", async (_, request) => {
    writeHistoryCache("history:list:||1", { items: [] });
    stubFetch(true);

    await request();

    expect(isHistoryCacheWarm()).toBe(false);
  });

  it("기록을 바꾸는 요청이 실패하면 그대로 둔다", async () => {
    writeHistoryCache("history:list:||1", { items: [] });
    stubFetch(false);

    await expect(diagnoseImage(photo())).rejects.toThrow();

    expect(readHistoryCache("history:list:||1")).toEqual({ items: [] });
  });

  it("이력을 읽기만 하는 요청은 비우지 않는다", async () => {
    writeHistoryCache("history:list:||1", { items: [] });
    stubFetch(true);

    await fetchHistory();

    expect(isHistoryCacheWarm()).toBe(true);
  });
});
