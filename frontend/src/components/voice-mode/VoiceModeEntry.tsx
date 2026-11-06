"use client";

import { usePathname, useRouter } from "next/navigation";
import { cancelSpeech } from "@/features/voice/lib/speech";

export function VoiceModeEntry() {
  const router = useRouter();
  const pathname = usePathname();

  const enterVoiceMode = () => {
    // 돌아올 화면과 문서 스크롤 위치 저장
    sessionStorage.setItem(
      "cropy:voice-return",
      JSON.stringify({
        path: pathname + window.location.search,
        scrollY: window.scrollY,
      }),
    );

    // 기존 음성 안내가 재생 중이라면 중단
    // 단, 음성 안내 설정 자체는 변경하지 않음
    cancelSpeech();

    router.push("/voice-mode");
  };

  return (
    <button
      type="button"
      onClick={enterVoiceMode}
      className="
        inline-flex min-h-11 items-center gap-2
        rounded-xl border border-cropy-border
        bg-cropy-surface px-4
        text-cropy-body-lg font-semibold
        text-cropy-text-primary
        hover:bg-cropy-action-subtle
      "
    >
      <span
        aria-hidden="true"
        className="icon-[lucide--mic] h-5 w-5"
      />
      음성 대화
    </button>
  );
}