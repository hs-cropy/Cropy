"use client";

import { useEffect } from "react";

/**
 * 연결이 없을 때 메인 주소로 들어와도 기기 진단(/offline/)으로 안내하는
 * 서비스 워커(public/sw.js)를 등록한다. 개발 중에는 HMR과 섞이지 않도록 등록하지 않는다.
 */
export function OfflineFallback() {
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // 같은 주소에서 프로덕션 빌드(Docker 등)를 연 적이 있으면 워커가 남아 next dev의 주소 이동을 가로챈다.
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          registrations
            .filter((registration) => registration.scope === `${location.origin}/`)
            .forEach((registration) => registration.unregister()),
        )
        .catch(() => {});
      return;
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // 등록 실패는 온라인 사용에 영향이 없으므로 무시한다.
    });
  }, []);

  return null;
}
