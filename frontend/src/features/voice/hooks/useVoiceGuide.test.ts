import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelSpeech, primeSpeech, speak } from "../lib/speech";
import { installFakeSpeech, spokenTexts, type FakeSpeech } from "../testing/fakeSpeech";
import { useVoiceGuide } from "./useVoiceGuide";
import { setVoiceEnabled } from "./useVoiceSetting";

// primeSpeech는 한 번만 실행되는 모듈 상태가 있어, 훅이 부르는지만 spy로 본다
// (무음 발화 자체는 speech.test.ts에서 검증)
vi.mock("../lib/speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/speech")>();
  return { ...actual, primeSpeech: vi.fn(actual.primeSpeech) };
});

let synth: FakeSpeech;

beforeEach(() => {
  synth = installFakeSpeech();
  setVoiceEnabled(false);
});

describe("useVoiceGuide", () => {
  it("음성 안내가 꺼져 있으면 읽지 않는다", () => {
    const { result } = renderHook(() => useVoiceGuide());

    result.current.speak("진단 중이에요");

    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("켜져 있으면 읽는다", () => {
    setVoiceEnabled(true);
    const { result } = renderHook(() => useVoiceGuide());

    result.current.speak(["두 병이 비슷해요", "잎 뒷면을 가까이 찍어주세요"]);

    expect(spokenTexts(synth)).toEqual(["두 병이 비슷해요", "잎 뒷면을 가까이 찍어주세요"]);
  });

  it("enabled는 현재 설정을 따라간다", () => {
    const { result } = renderHook(() => useVoiceGuide());
    expect(result.current.enabled).toBe(false);

    act(() => setVoiceEnabled(true));

    expect(result.current.enabled).toBe(true);
  });

  it("토글을 바꿔도 speak 함수와 마운트 effect가 그대로다", () => {
    const { result } = renderHook(() => useVoiceGuide());
    const before = result.current.speak;
    const warmUps = synth.getVoices.mock.calls.length;

    act(() => setVoiceEnabled(true));

    expect(result.current.speak).toBe(before);
    expect(synth.getVoices).toHaveBeenCalledTimes(warmUps);
    // 같은 함수지만 호출 시점의 설정을 읽는다
    result.current.speak("문장");
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("마운트하면 보이스 목록 로드를 미리 요청한다", () => {
    renderHook(() => useVoiceGuide());
    expect(synth.getVoices).toHaveBeenCalled();
  });
});

describe("언마운트 시 낭독 정리", () => {
  beforeEach(() => {
    setVoiceEnabled(true);
  });

  it("이 화면이 시작한 낭독은 끊는다", () => {
    const { result, unmount } = renderHook(() => useVoiceGuide());
    result.current.speak("작물을 고르고 잎을 찍어주세요");

    unmount();

    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("그 뒤 다른 화면이 시작한 낭독은 끊지 않는다", () => {
    // 진단 대기 중 카메라를 열었다 닫는 상황: 카메라 안내 → 결과 낭독 → 카메라 닫힘
    const camera = renderHook(() => useVoiceGuide());
    const form = renderHook(() => useVoiceGuide());

    camera.result.current.speak("잎이 화면 가운데 오도록 찍어주세요");
    form.result.current.speak("고추 탄저병, 신뢰도 91%"); // 앞 문장을 끊는 cancel은 정상
    synth.cancel.mockClear();
    camera.unmount();

    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it("owner 없이 시작한 낭독(토글 안내)은 끊지 않는다", () => {
    const { unmount } = renderHook(() => useVoiceGuide());
    speak("음성 안내를 켰어요");

    unmount();

    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it("cancel은 owner와 상관없이 읽던 문장을 끊는다", () => {
    const { result } = renderHook(() => useVoiceGuide());
    expect(result.current.cancel).toBe(cancelSpeech);

    result.current.cancel();

    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("prime", () => {
  it("꺼져 있으면 아무것도 하지 않는다", () => {
    const { result } = renderHook(() => useVoiceGuide());

    result.current.prime();

    expect(primeSpeech).not.toHaveBeenCalled();
  });

  it("켜져 있으면 iOS 발화 준비를 요청한다", () => {
    setVoiceEnabled(true);
    const { result } = renderHook(() => useVoiceGuide());

    result.current.prime();

    expect(primeSpeech).toHaveBeenCalledTimes(1);
  });
});
