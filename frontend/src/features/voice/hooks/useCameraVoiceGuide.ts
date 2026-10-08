"use client";

import { useEffect, useRef } from "react";
import { buildCameraPrompt } from "../lib/prompts";
import { useVoiceGuide } from "./useVoiceGuide";

/**
 * 카메라 영상이 나오기 시작하면 촬영 안내를 읽는다. 열리는 중에는 화면이 까매서
 * 기다린다. 카메라 전환·백그라운드 복귀 때도 다시 streaming이 되므로, 한 번 열 때
 * 한 번만 읽는다 (첫 영상 전에 오류가 나 다시 시도한 경우엔 그때 한 번 읽는다).
 * 카메라를 닫으면 이 안내가 아직 읽히는 중일 때만 끊는다.
 */
export function useCameraVoiceGuide(streaming: boolean, cropLabel?: string) {
  const { speak } = useVoiceGuide();
  const guidedRef = useRef(false);

  useEffect(() => {
    if (!streaming || guidedRef.current) return;
    guidedRef.current = true;
    speak(buildCameraPrompt(cropLabel));
  }, [streaming, cropLabel, speak]);
}
