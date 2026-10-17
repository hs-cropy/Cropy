import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeSpeech, spokenTexts, type FakeSpeech } from "../testing/fakeSpeech";
import { useCameraVoiceGuide } from "./useCameraVoiceGuide";
import { setVoiceEnabled } from "./useVoiceSetting";

let synth: FakeSpeech;

beforeEach(() => {
  synth = installFakeSpeech();
  setVoiceEnabled(true);
});

function renderCameraGuide(streaming: boolean, cropLabel?: string) {
  return renderHook(
    (props: { streaming: boolean; cropLabel?: string }) =>
      useCameraVoiceGuide(props.streaming, props.cropLabel),
    { initialProps: { streaming, cropLabel } },
  );
}

describe("useCameraVoiceGuide", () => {
  it("영상이 나오기 전(카메라 여는 중)에는 읽지 않는다", () => {
    renderCameraGuide(false, "고추");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("영상이 나오기 시작하면 작물 이름을 넣어 한 번 읽는다", () => {
    const { rerender } = renderCameraGuide(false, "고추");

    rerender({ streaming: true, cropLabel: "고추" });

    expect(spokenTexts(synth)).toEqual(["고추 잎이 화면 가운데 오도록 찍어주세요"]);
  });

  it("작물을 고르지 않았으면 이름 없이 읽는다", () => {
    renderCameraGuide(true);
    expect(spokenTexts(synth)).toEqual(["잎이 화면 가운데 오도록 찍어주세요"]);
  });

  it("카메라 전환·백그라운드 복귀로 다시 streaming이 되어도 반복하지 않는다", () => {
    const { rerender } = renderCameraGuide(true, "무");

    rerender({ streaming: false, cropLabel: "무" });
    rerender({ streaming: true, cropLabel: "무" });

    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("음성 안내가 꺼져 있으면 읽지 않는다", () => {
    setVoiceEnabled(false);
    renderCameraGuide(true, "고추");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("카메라를 닫으면 아직 읽는 촬영 안내를 끊는다", () => {
    const { unmount } = renderCameraGuide(true, "고추");

    unmount();

    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("다시 열면(새로 마운트) 다시 읽는다", () => {
    renderCameraGuide(true, "고추").unmount();
    renderCameraGuide(true, "고추");

    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

  it("resetKey 가 바뀌면 다음에 영상이 나올 때 다시 읽는다 (화면 안 카메라의 새 진단)", () => {
    const { rerender } = renderHook(
      (props: { streaming: boolean; resetKey: number }) =>
        useCameraVoiceGuide(props.streaming, undefined, props.resetKey),
      { initialProps: { streaming: true, resetKey: 0 } },
    );
    rerender({ streaming: false, resetKey: 0 });
    rerender({ streaming: true, resetKey: 0 });
    expect(spokenTexts(synth)).toHaveLength(1);

    rerender({ streaming: false, resetKey: 1 });
    rerender({ streaming: true, resetKey: 1 });

    expect(spokenTexts(synth)).toHaveLength(2);
  });
});
