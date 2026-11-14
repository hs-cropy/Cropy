"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { readVoiceReturn } from "@/components/voice-mode/voiceNavigation";
import { VoiceMode } from "@/components/voice-mode/VoiceMode";
import { Toast, useToast } from "@/components/Toast";
import { useCamera, useCaptureFrame } from "@/features/camera";
import { useVoiceConversation } from "@/features/voice/hooks/useVoiceConversation";
import { registerSelector } from "@/features/voice/lib/functionSelector";
import { mobileClfSelector } from "@/features/voice/lib/mobileClfSelector";
import { webQwenSelector } from "@/features/voice/lib/webQwenSelector";

export default function VoiceModePage() {
  // 음성 모드 안의 카메라: 잎을 비추고 "찍어 줘"라고 말하면 바로 진단한다
  const camera = useCamera({ autoStart: false });
  const { capture } = useCaptureFrame();
  const { videoRef, status: cameraStatus, start: startCamera } = camera;

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || cameraStatus !== "streaming") return null;
    const result = await capture(video);
    return result.ok ? result.file : null;
  }, [capture, cameraStatus, videoRef]);

  const router = useRouter();
  // 말로 "종료해 줘": '기본 화면' 버튼과 같이 들어오기 전 화면으로 돌아간다
  const exitByVoice = useCallback(() => {
    camera.stop();
    if (readVoiceReturn()) router.back();
    else router.replace("/home");
  }, [camera, router]);

  const conversation = useVoiceConversation({ captureFrame, onExitRequest: exitByVoice });
  const { toast, showToast, clearToast } = useToast();

  const { state, inputLevel, error, clearError, handleMicClick, cancel, transcript, assistantText, continuous, setContinuous, wakeEnabled, setWakeEnabled, captureNow, lastShot, history } = conversation;

  // 기기 안 기능 선택기. 휴대폰은 분류기(#167), WebGPU PC는 Qwen q4f16(#168). 모델을 받아 둔 기기에서만 쓰이고, 아니면 서버로 고른다
  useEffect(() => {
    const off = [registerSelector(mobileClfSelector), registerSelector(webQwenSelector)];
    return () => off.forEach((unregister) => unregister());
  }, []);

  // 처음에 한 번 켜 본다. iOS처럼 사용자 동작이 필요한 기기는 실패하고, 미리보기의 "카메라 켜기"로 켠다
  useEffect(() => {
    void startCamera();
  }, [startCamera]);

  // 녹음 오류가 발생하면 기존 토스트로 안내
  useEffect(() => {
    if (!error) return;

    showToast(error);
    clearError();
  }, [error, showToast, clearError]);

  const handleExit = () => {
    clearToast();
    cancel();
  };

  return (
    <>
      <VoiceMode
        state={state}
        onMicClick={handleMicClick}
        onExit={handleExit}
        inputLevel={inputLevel}
        transcript={transcript}
        assistantText={assistantText}
        analysisAvailable={conversation.analysisAvailable}
        micDisabled={state === "thinking"}
        continuous={continuous}
        onContinuousChange={setContinuous}
        wakeEnabled={wakeEnabled}
        onWakeEnabledChange={setWakeEnabled}
        history={history}
        camera={{
          videoRef,
          status: cameraStatus,
          onStart: () => { void startCamera(); },
          onShutter: () => { void captureNow(); },
          shutterDisabled: state === "thinking",
          lastShot,
        }}
      />

      <Toast toast={toast} placement="top" />
    </>
  );
}
