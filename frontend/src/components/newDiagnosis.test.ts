import { describe, expect, it, vi } from "vitest";
import { requestNewDiagnosis, subscribeNewDiagnosis } from "./newDiagnosis";

describe("newDiagnosis", () => {
  it("구독한 쪽에 신호를 보낼 때마다 알린다", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNewDiagnosis(listener);

    requestNewDiagnosis();
    requestNewDiagnosis();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("구독을 끊으면 더 알리지 않는다", () => {
    const listener = vi.fn();
    subscribeNewDiagnosis(listener)();

    requestNewDiagnosis();

    expect(listener).not.toHaveBeenCalled();
  });

  it("신호는 남지 않는다. 보낸 뒤에 구독한 쪽은 받지 않는다", () => {
    requestNewDiagnosis();
    const listener = vi.fn();
    const unsubscribe = subscribeNewDiagnosis(listener);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
