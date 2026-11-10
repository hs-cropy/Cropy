"use client";

import { useRouter } from "next/navigation";
import { cancelSpeech } from "@/features/voice/lib/speech";
import { saveVoiceReturn } from "./voiceNavigation";

export function VoiceModeEntry() {
  const router = useRouter();

  const enterVoiceMode = () => {
    // 기존 화면과 스크롤 위치를 저장한다.
    saveVoiceReturn(
      window.location.pathname + window.location.search,
      window.scrollY,
    );

    // 현재 재생 중인 TTS만 중단하고 설정은 유지한다.
    cancelSpeech();

    router.push("/voice-mode");
  };

  return (
    <button
      type="button"
      onClick={enterVoiceMode}
      aria-label="음성 대화"
      className="
        inline-flex min-h-cropy-control-md min-w-11
        items-center justify-center gap-1.5
        rounded-xl border border-cropy-border
        bg-cropy-surface p-2
        text-cropy-label-xs font-medium
        text-cropy-text-secondary
        transition-colors
        hover:bg-cropy-action-subtle
        focus-visible:outline
        focus-visible:outline-2
        focus-visible:outline-offset-2
        focus-visible:outline-cropy-action-primary
        lg:gap-2
        lg:text-cropy-caption
      "
    >
      <span
        aria-hidden="true"
        className="icon-[lucide-20--mic] h-5 w-5 shrink-0"
      />
      <span className="hidden lg:inline whitespace-nowrap">
        음성 대화
      </span>
    </button>
  );
}