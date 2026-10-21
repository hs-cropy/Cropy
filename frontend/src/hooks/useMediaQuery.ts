"use client";

import { useCallback, useSyncExternalStore } from "react";

/** 데스크탑 화면(Figma 1440px 시안)으로 바꾸는 폭. Tailwind 의 lg 와 같다 */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * 미디어 쿼리가 맞는지. 화면 구성(버튼·문구)이 달라 CSS 만으로 바꿀 수 없을 때 쓴다.
 * 모양만 다르면 lg: 클래스를 쓴다.
 * 서버 렌더와 하이드레이션 중에는 화면 폭을 알 수 없어 null 이다. 그동안은 두 화면을 다 그리고
 * CSS 로 하나만 보이게 해야 새로고침 때 다른 화면이 잠깐 보이지 않는다.
 * matchMedia 가 없는 환경(jsdom)은 false 다.
 */
export function useMediaQuery(query: string): boolean | null {
  // 렌더마다 다시 구독하지 않게 쿼리가 바뀔 때만 새로 만든다
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.("change", onChange);
      return () => list?.removeEventListener?.("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore<boolean | null>(
    subscribe,
    () => window.matchMedia?.(query)?.matches ?? false,
    () => null,
  );
}
