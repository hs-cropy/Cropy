"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PROMPT_HOME, PROMPT_VOICE_ON } from "../lib/prompts";
import { cancelSpeech, isSpeechSupported, speak } from "../lib/speech";
import { setVoiceEnabled, useVoiceSetting } from "../hooks/useVoiceSetting";

/**
 * 음성 안내 켜기/끄기 (06_웹앱_기능명세서 공통 컴포넌트 VoiceGuide).
 *
 * 큰글씨 토글과 같은 모양으로 앱바에 나란히 두고, 아이콘만 두지 않고 "음성"
 * 라벨을 함께 보인다. 읽을 수 없는 브라우저에서는 버튼을 숨긴다.
 */
export function VoiceToggle() {
  const enabled = useVoiceSetting();
  const pathname = usePathname();
  const [supported, setSupported] = useState(true);

  // 서버 렌더 결과와 어긋나지 않도록 지원 여부는 마운트 후에 확인한다
  useEffect(() => {
    setSupported(isSpeechSupported());
  }, []);

  if (!supported) return null;

  const toggle = () => {
    const next = !enabled;
    setVoiceEnabled(next);
    // 홈 진입 안내(M01-F6)는 상호작용 전이라 브라우저가 막는 경우가 많아,
    // 홈에서 켜면 이 탭 안에서 홈 안내까지 이어 읽는다
    if (next) speak(pathname === "/" ? [PROMPT_VOICE_ON, PROMPT_HOME] : PROMPT_VOICE_ON);
    else cancelSpeech();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      className={`inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold transition ${
        enabled
          ? "border-brand bg-brand text-ink"
          : "border-line bg-surface text-ink hover:border-brand/60"
      }`}
    >
      <span
        aria-hidden
        className={`${enabled ? "icon-[lucide--volume-2]" : "icon-[lucide--volume-x]"} h-4 w-4`}
      />
      음성
      <span className="sr-only">{enabled ? " 안내 켜짐" : " 안내 꺼짐"}</span>
    </button>
  );
}
