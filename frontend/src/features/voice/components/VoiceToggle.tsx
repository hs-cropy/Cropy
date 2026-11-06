"use client";

import { useRouter } from "next/navigation";
import { Switch } from "@/components/Switch";
import { cancelSpeech } from "../lib/speech";
import { saveVoiceReturn } from "@/components/voice-mode/voiceNavigation";

interface VoiceToggleProps {
  className?: string;
}

/**
 * 헤더 음성 모드 진입 스위치.
 *
 * 음성 안내(TTS) 설정과 별개로 동작한다.
 * ON 시 전용 음성 모드로 이동하며,
 * 복귀하면 헤더 스위치는 OFF 상태로 표시된다.
 */
export function VoiceToggle({ className }: VoiceToggleProps) {
  const router = useRouter();

  const change = (next: boolean) => {
    if (!next) return;

    // 현재 문서의 경로와 스크롤 위치 저장
    saveVoiceReturn(
      window.location.pathname + window.location.search,
      window.scrollY,
    );

    // 기존 TTS 안내가 재생 중이면 중단
    // 저장된 TTS 음성 안내 설정 자체는 변경하지 않는다
    cancelSpeech();

    router.push("/voice-mode");
  };

  return (
    <Switch
      checked={false}
      onCheckedChange={change}
      aria-label="음성 모드"
      className={className}
    >
      <span className="md:hidden">음성</span>
      <span className="hidden md:inline">음성 모드</span>
    </Switch>
  );
}