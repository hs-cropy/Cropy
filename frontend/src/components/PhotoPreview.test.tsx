import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PhotoPreview } from "./PhotoPreview";

it("keeps a selected mobile photo visible as a filename when the browser cannot decode it", () => {
  const view = render(<PhotoPreview key="one" src="blob:one" alt="사진" fileName="phone.DNG" />);
  fireEvent.error(screen.getByAltText("사진"));
  expect(screen.getByRole("status").textContent).toContain("phone.DNG");
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(<PhotoPreview key="two" src="blob:two" alt="사진" fileName="next.jpg" />);
  expect(screen.getByRole("img").getAttribute("src")).toBe("blob:two");
  expect(screen.queryByRole("status")).toBeNull();
});
