"use client";

import { useSyncExternalStore } from "react";

/** 홈 화면·바탕화면에 설치한 앱으로 열었을 때 맞는 쿼리 (manifest 의 display 가 standalone) */
export const INSTALLED_QUERY = "(display-mode: standalone)";

function subscribe(onChange: () => void) {
  const list = window.matchMedia?.(INSTALLED_QUERY);
  list?.addEventListener?.("change", onChange);
  return () => list?.removeEventListener?.("change", onChange);
}

// iOS 홈 화면 앱은 navigator.standalone 도 본다 (public/offline/install.mjs 와 같은 판별)
function isInstalled() {
  return (
    window.matchMedia?.(INSTALLED_QUERY)?.matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * 설치한 앱으로 열었는지. 설치 앱에서는 "앱 설치하기"를 보이지 않는다.
 * 서버 렌더와 하이드레이션 중에는 알 수 없어 false(브라우저)로 본다.
 * 그동안 설치 버튼이 잠깐 보이지 않게 하려면 CSS 의 같은 미디어 쿼리로도 숨긴다.
 */
export function useInstalledApp(): boolean {
  return useSyncExternalStore(subscribe, isInstalled, () => false);
}
