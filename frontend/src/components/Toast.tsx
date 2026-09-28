"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastState {
  id: number;
  message: string;
}

/** 오류·안내 메시지를 잠깐 띄운다 (기능명세서 0-2절: 3초 표시) */
export function useToast(duration = 3000) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 같은 문구를 다시 띄울 때도 새 노드로 바꿔 스크린리더가 다시 읽게 한다
  const nextIdRef = useRef(0);

  const showToast = useCallback(
    (message: string) => {
      clearTimeout(timerRef.current);
      setToast({ id: ++nextIdRef.current, message });
      timerRef.current = setTimeout(() => setToast(null), duration);
    },
    [duration],
  );

  const clearToast = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { toast, showToast, clearToast };
}

const PLACEMENT = {
  // 하단 탭(모바일) 위
  bottom: "bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-8",
  // 카메라 오버레이의 닫기 버튼 줄 아래. 하단 셔터를 가리지 않는다
  top: "top-[calc(4rem+env(safe-area-inset-top))]",
};

interface ToastProps {
  toast: ToastState | null;
  placement?: keyof typeof PLACEMENT;
}

export function Toast({ toast, placement = "bottom" }: ToastProps) {
  return (
    // live region은 항상 있어야 문구가 바뀔 때 스크린리더가 읽는다.
    // 카메라 오버레이(z-30)보다 위에 띄운다
    <div
      role="status"
      className={`pointer-events-none fixed inset-x-0 z-40 flex justify-center px-5 ${PLACEMENT[placement]}`}
    >
      {toast && (
        <p
          key={toast.id}
          className="flex max-w-app items-center gap-2 rounded-xl border border-signal-high/30 bg-signal-high-tint px-4 py-3 text-sm font-semibold text-signal-high-ink shadow-card"
        >
          <span aria-hidden className="icon-[lucide--circle-alert] h-5 w-5 shrink-0" />
          {toast.message}
        </p>
      )}
    </div>
  );
}
