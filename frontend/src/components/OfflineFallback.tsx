"use client";

import { useEffect } from "react";

/**
 * 연결이 없을 때 메인 주소로 들어와도 기기 진단(/offline/)으로 안내하는
 * 서비스 워커(public/sw.js)를 등록한다. 개발 중에는 HMR과 섞이지 않도록 등록하지 않는다.
 */
export function OfflineFallback() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // 등록 실패는 온라인 사용에 영향이 없으므로 무시한다.
    });
  }, []);

  return null;
}
