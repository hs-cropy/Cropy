import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CAPTURE_PATH } from "@/components/diagnosis/DiagnosisSession";
import NotFound from "./not-found";

describe("NotFound", () => {
  // 서버 컴포넌트라 CAPTURE_PATH 를 가져오지 못하고 주소를 직접 적었다. 값이 어긋나지 않는지 지킨다
  it("진단 화면 링크는 촬영 화면 주소와 같다", () => {
    render(<NotFound />);

    const link = screen.getByRole("link", { name: "진단 화면으로" });
    expect(link.getAttribute("href")).toBe(CAPTURE_PATH);
  });
});
