"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Switch } from "@/components/Switch";
import { CAPTURE_PATH } from "@/components/diagnosis/DiagnosisSession";
import { PROMPT_HOME, PROMPT_VOICE_ON } from "../lib/prompts";
import { cancelSpeech, isSpeechSupported, speak } from "../lib/speech";
import { setVoiceEnabled, useVoiceSetting } from "../hooks/useVoiceSetting";

interface VoiceToggleProps {
  /** 배치용 클래스 (폭 등). 스위치의 모양은 Switch 가 정한다 */
  className?: string;
}

/**
 * 음성 안내 켜기/끄기 (06_웹앱_기능명세서 공통 컴포넌트 VoiceGuide).
 *
 * 큰 글자 스위치와 같은 모양으로 헤더에 나란히 둔다. 좁은 화면에서는 글자를 "음성"으로
 * 줄이고 이름은 "음성 안내"로 고정한다. 읽을 수 없는 브라우저에서는 스위치를 숨긴다.
 */
export function VoiceToggle({ className }: VoiceToggleProps) {
  const enabled = useVoiceSetting();
  const pathname = usePathname();
  const [supported, setSupported] = useState(true);

  // 서버 렌더 결과와 어긋나지 않도록 지원 여부는 마운트 후에 확인한다
  useEffect(() => {
    setSupported(isSpeechSupported());
  }, []);

  if (!supported) return null;

  // 누른 그 자리에서 바로 읽어야 한다. 효과(effect)로 미루면 iOS 가 발화를 막는다
  const change = (next: boolean) => {
    setVoiceEnabled(next);
    // 홈 진입 안내(M01-F6)는 상호작용 전이라 브라우저가 막는 경우가 많아,
    // 홈에서 켜면 이 탭 안에서 홈 안내까지 이어 읽는다
    if (next) speak(pathname === CAPTURE_PATH ? [PROMPT_VOICE_ON, PROMPT_HOME] : PROMPT_VOICE_ON);
    else cancelSpeech();
  };

  return (
    <Switch checked={enabled} onCheckedChange={change} aria-label="음성 안내" className={className}>
      <span className="md:hidden">음성</span>
      <span className="hidden md:inline">음성 안내</span>
    </Switch>
  );
}
