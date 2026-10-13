import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeSpeech } from "@/features/voice/testing/fakeSpeech";
import HomePage from "./page";

beforeEach(() => {
  installFakeSpeech();
});

describe("HomePage", () => {
  it("기기 안에서 진단하는 페이지로 가는 링크가 있다 (앱에서 그 페이지로 가는 유일한 길)", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("link", { name: "인터넷 없이 기기에서 진단하기" }).getAttribute("href"),
    ).toBe("/offline/index.html");
  });

  it("화면은 main 안의 스크롤 영역에 들어가고 큰 제목은 하나다", () => {
    render(<HomePage />);
    const region = screen.getByRole("region", { name: "진단하기" });

    expect(screen.getByRole("main").contains(region)).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
