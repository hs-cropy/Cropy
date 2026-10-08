"use client";

import { useSyncExternalStore } from "react";

export const VOICE_SETTING_KEY = "cropcare:voice";

/*
 * 앱바의 토글과 화면의 낭독 훅이 서로 다른 컴포넌트에 있어, 켜짐 상태를
 * 모듈 수준 store 하나로 공유한다. 기본값은 꺼짐 — 명세가 "토글 켜진 경우"에만
 * 읽도록 했고, 공공장소에서 갑자기 소리가 나는 일을 막는다.
 */
let enabled = false;
let loaded = false;
const listeners = new Set<() => void>();

/** 렌더 밖(이벤트 핸들러 등)에서 현재 켜짐 상태를 읽는다 */
export function isVoiceEnabled(): boolean {
  if (!loaded) {
    loaded = true;
    try {
      enabled = localStorage.getItem(VOICE_SETTING_KEY) === "on";
    } catch {
      // 저장소 접근이 막힌 환경 — 기본값(꺼짐)으로 둔다
    }
  }
  return enabled;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setVoiceEnabled(next: boolean) {
  enabled = next;
  loaded = true;
  try {
    localStorage.setItem(VOICE_SETTING_KEY, next ? "on" : "off");
  } catch {
    // 시크릿 모드 등 저장이 막힌 경우 — 이번 세션에만 적용된다
  }
  listeners.forEach((l) => l());
}

export function useVoiceSetting(): boolean {
  return useSyncExternalStore(subscribe, isVoiceEnabled, getServerSnapshot);
}
