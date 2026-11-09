"use client";

import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { VoiceMode } from "@/components/voice-mode/VoiceMode";

export default function VoiceModePage() {
  const conversation = useVoiceConversation();

  return (
    <VoiceMode
      state={conversation.state}
      onMicClick={conversation.handleMicClick}
      micDisabled={
        conversation.state !== "idle" &&
        conversation.state !== "listening"
      }
    />
  );
}