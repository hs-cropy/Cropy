"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** 지금 주소의 해시("#guide" 등). 서버 렌더와 하이드레이션 때는 "" 이다 */
export function useLocationHash() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
}

/**
 * 방문 기록을 남기지 않고 해시를 바꾼다. 뒤로 가기로 다시 돌아오면 안 되는 화면(촬영 가이드에서
 * 사진 찍기를 누른 뒤 등)에 쓴다. replaceState 는 hashchange 를 내지 않아 직접 알린다
 */
export function replaceHash(hash: string) {
  if (window.location.hash === `#${hash}`) return;
  window.history.replaceState(window.history.state, "", `#${hash}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
