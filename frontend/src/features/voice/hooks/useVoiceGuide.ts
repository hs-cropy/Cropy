"use client";

import { useCallback, useEffect, useState } from "react";
import { cancelSpeech, primeSpeech, speak as speakNow, warmUpVoices } from "../lib/speech";
import { isVoiceEnabled, useVoiceSetting } from "./useVoiceSetting";

/**
 * 화면에서 안내 문장을 읽게 하는 훅. 음성 안내가 꺼져 있으면 speak는 아무것도 하지 않는다.
 *
 * speak는 호출 시점의 켜짐 상태를 store에서 직접 읽어 항상 같은 함수로 유지된다.
 * 그래서 effect 의존성에 넣어도 토글을 바꿀 때마다 이전 결과를 다시 읽지 않는다.
 * 화면을 떠나면 이 화면이 시작한 낭독만 끊는다.
 */
export function useVoiceGuide() {
  const enabled = useVoiceSetting();
  const [owner] = useState(() => Symbol("voice-guide"));

  useEffect(() => {
    warmUpVoices();
    return () => cancelSpeech(owner);
  }, [owner]);

  const speak = useCallback(
    (text: string | string[]) => {
      if (isVoiceEnabled()) speakNow(text, owner);
    },
    [owner],
  );

  /** 탭 핸들러에서 불러 iOS의 비동기 발화 제한을 미리 푼다 */
  const prime = useCallback(() => {
    if (isVoiceEnabled()) primeSpeech();
  }, []);

  return { enabled, speak, prime, cancel: cancelSpeech };
}
