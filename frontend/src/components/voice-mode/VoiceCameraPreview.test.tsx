import { createRef } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceCameraPreview } from "./VoiceCameraPreview";
import type { CameraStatus } from "@/types/camera";

// jsdom은 레이아웃이 없어 offsetParent가 늘 null이다. data-hidden 안이면 숨은 것으로 본다 (display:none과 같게)
let restore: PropertyDescriptor | undefined;
beforeEach(() => {
  restore = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest("[data-hidden]") ? null : this.parentElement;
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});
afterEach(() => {
  if (restore) Object.defineProperty(HTMLElement.prototype, "offsetParent", restore);
  vi.restoreAllMocks();
});

function Two({ videoRef, status, hideFirst }: { videoRef: React.RefObject<HTMLVideoElement | null>; status: CameraStatus; hideFirst: boolean }) {
  const camera = { videoRef, status, onStart: () => {}, onShutter: () => {} };
  return (
    <>
      <div data-testid="narrow" {...(hideFirst ? { "data-hidden": "" } : {})}><VoiceCameraPreview {...camera} /></div>
      <div data-testid="wide" {...(hideFirst ? {} : { "data-hidden": "" })}><VoiceCameraPreview {...camera} /></div>
    </>
  );
}

describe("VoiceCameraPreview 두 개 (좁은 화면·넓은 화면)", () => {
  it("휴대폰 폭: 뒤에 그려진 넓은 화면용이 아니라 보이는 미리보기가 videoRef를 갖는다", () => {
    const videoRef = createRef<HTMLVideoElement | null>() as React.RefObject<HTMLVideoElement | null>;
    const { getByTestId } = render(<Two videoRef={videoRef} status="idle" hideFirst={false} />);
    expect(videoRef.current).toBe(getByTestId("narrow").querySelector("video"));
  });

  it("넓은 화면: 보이는 넓은 화면용이 videoRef를 갖는다", () => {
    const videoRef = createRef<HTMLVideoElement | null>() as React.RefObject<HTMLVideoElement | null>;
    const { getByTestId } = render(<Two videoRef={videoRef} status="idle" hideFirst />);
    expect(videoRef.current).toBe(getByTestId("wide").querySelector("video"));
  });

  it("숨은 쪽에 스트림이 붙어 있으면 보이는 미리보기가 넘겨받는다", () => {
    const videoRef = createRef<HTMLVideoElement | null>() as React.RefObject<HTMLVideoElement | null>;
    const { getByTestId, rerender } = render(<Two videoRef={videoRef} status="opening" hideFirst={false} />);
    const narrow = getByTestId("narrow").querySelector("video")!;
    const wide = getByTestId("wide").querySelector("video")!;
    const stream = { id: "s" } as unknown as MediaStream;
    // 하이드레이션 순서 등으로 숨은 쪽이 먼저 스트림을 받은 경우
    videoRef.current = wide;
    wide.srcObject = stream;
    rerender(<Two videoRef={videoRef} status="streaming" hideFirst={false} />);
    expect(narrow.srcObject).toBe(stream);
    expect(videoRef.current).toBe(narrow);
  });
});
