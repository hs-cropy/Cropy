"use client";

import { useEffect } from "react";
import { VoiceMode } from "@/components/voice-mode/VoiceMode";
import { Toast, useToast } from "@/components/Toast";
import { useVoiceConversation } from "@/features/voice/hooks/useVoiceConversation";

export default function VoiceModePage() {
  const conversation = useVoiceConversation();
  const { toast, showToast, clearToast } = useToast();

  const { state, inputLevel, error, clearError, handleMicClick, cancel, transcript, assistantText, continuous, setContinuous } = conversation;

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
      />

      <Toast toast={toast} placement="top" />
    </>
  );
}
