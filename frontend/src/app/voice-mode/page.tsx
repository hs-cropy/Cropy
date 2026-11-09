"use client";

import { VoiceMode } from "@/components/voice-mode/VoiceMode";
import { useVoiceConversation } from "@/features/voice/hooks/useVoiceConversation";

export default function VoiceModePage() {
  const conversation = useVoiceConversation();

  return (
    <VoiceMode
      state={conversation.state}
      onMicClick={conversation.handleMicClick}
      inputLevel={conversation.inputLevel}
      micDisabled={
        conversation.state !== "idle" &&
        conversation.state !== "listening"
      }
    />
  );
}