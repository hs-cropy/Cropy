"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Toast, type ToastState } from "@/components/Toast";
import type { CameraErrorCode, CameraStatus } from "@/types/camera";

const ERROR_MESSAGES: Record<CameraErrorCode, string> = {
  "permission-denied": "카메라 권한이 필요해요. 브라우저 설정에서 권한을 허용해 주세요.",
  "not-supported": "이 환경에서는 카메라를 쓸 수 없어요. HTTPS로 접속했는지 확인해 주세요.",
  "no-device": "카메라를 찾을 수 없어요.",
  "play-failed": "카메라 화면을 띄우지 못했어요. 다시 시도해 주세요.",
  unknown: "카메라를 사용할 수 없어요. 다른 앱이 카메라를 쓰고 있는지 확인해 주세요.",
};

interface CameraViewfinderProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: CameraErrorCode | null;
  /** 상단 칩에 "{cropLabel} 잎"으로 표시. 없으면 칩을 숨긴다 */
  cropLabel?: string;
  /** 전면 카메라일 때 거울처럼 보이도록 미리보기만 좌우 반전. 캡처 이미지에는 적용하지 않는다 */
  mirrored?: boolean;
  onClose: () => void;
  /** 에러 화면의 "다시 시도" 버튼. 사용자 제스처로 다시 열어야 자동재생 차단도 풀린다 */
  onRetry?: () => void;
  onFlip: () => void;
  /**
   * 오버레이 위 안내 토스트. aria-modal 밖의 live region은 스크린리더가 무시할 수 있어
   * dialog 안에 렌더한다
   */
  notice?: ToastState | null;
  /** 캡처·파일 선택이 연결되기 전까지는 미지정 → 버튼 비활성 */
  onShutter?: () => void;
  onGallery?: () => void;
}

export function CameraViewfinder({
  videoRef,
  status,
  error,
  cropLabel,
  mirrored = false,
  onClose,
  onRetry,
  onFlip,
  notice = null,
  onShutter,
  onGallery,
}: CameraViewfinderProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // 열리자마자 키보드·스크린리더 포커스를 오버레이 안으로 옮긴다
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="카메라 촬영"
      className="fixed inset-0 z-30 bg-paper"
    >
      <div className="mx-auto flex h-full w-full max-w-app flex-col bg-photo-deep">
        <div className="flex min-h-[52px] shrink-0 items-center justify-between px-5 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-my-1 -ml-[0.5625rem] flex h-11 w-11 items-center justify-center text-white"
          >
            <span aria-hidden className="icon-[lucide--x] h-[26px] w-[26px]" />
          </button>

          {cropLabel && (
            <div className="flex min-w-0 max-w-[65%] items-center gap-1.5 rounded-full bg-scrim/85 px-3.5 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- 18px 장식용 SVG */}
              <img src="/camera/leaf.svg" alt="" className="h-[18px] w-[18px] shrink-0" />
              <span className="min-w-0 truncate text-xs font-bold text-white">{cropLabel} 잎</span>
            </div>
          )}

          {/* 닫기 버튼과 같은 폭으로 작물 칩을 가운데에 둔다 */}
          <span aria-hidden className="-my-1 -mr-[0.5625rem] h-11 w-11" />
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            aria-label="카메라 미리보기"
            className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
          />

          {status === "streaming" && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[26px] pb-[26px] [container-type:size]">
              {/* 3:4를 유지하면서 뷰파인더 높이(팁 칩 자리 제외)와 폭 안에 들어가도록 높이를 정한다 */}
              <div className="aspect-[3/4] h-[min(400px,calc(100cqh-6rem),calc((100cqw-5.625rem)*4/3))] rounded-[140px] border-[3px] border-dashed border-brand" />
              {/* 좁은 화면 + 큰글씨에서는 잘리지 않고 두 줄로 넘어간다 */}
              <p className="flex max-w-[calc(100%-2.5rem)] items-center gap-2 rounded-full bg-scrim py-2.5 pl-4 pr-[18px] text-center text-xs font-bold text-white">
                <span
                  aria-hidden
                  className="icon-[lucide--lightbulb] h-[18px] w-[18px] shrink-0 text-brand"
                />
                잎 한 장이 노란 선 안에 꽉 차게
              </p>
            </div>
          )}

          {/* live region은 미리 있어야 문구가 바뀔 때 스크린리더가 읽는다 */}
          <p
            role="status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white"
          >
            {status === "opening" ? "카메라를 여는 중…" : ""}
          </p>

          {status === "error" && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <p role="alert" className="text-sm text-white">
                {ERROR_MESSAGES[error]}
              </p>
              {/* 미지원 환경은 다시 해도 같고, 권한 거부는 브라우저가 두 번째 요청을 무시한다 (기획서 7절) */}
              {onRetry && error !== "not-supported" && error !== "permission-denied" && (
                <button
                  type="button"
                  onClick={() => {
                    // 누른 버튼이 사라지면 포커스가 body로 빠지므로 먼저 옮겨 둔다
                    closeButtonRef.current?.focus();
                    onRetry();
                  }}
                  className="min-h-11 rounded-full border-2 border-white px-5 text-sm font-bold text-white"
                >
                  다시 시도
                </button>
              )}
            </div>
          )}
        </div>

        {/* 셔터가 정확히 가운데에 오도록 3칸 grid로 배치한다 */}
        <div className="grid shrink-0 grid-cols-3 items-center px-11 pb-[calc(20px+env(safe-area-inset-bottom))] pt-[22px]">
          <button
            type="button"
            onClick={onGallery}
            disabled={!onGallery}
            aria-label="갤러리에서 사진 선택"
            className="h-11 w-11 justify-self-start rounded-[10px] border-2 border-white bg-photo-leaf-light disabled:cursor-not-allowed disabled:opacity-60"
          />

          <button
            type="button"
            onClick={onShutter}
            disabled={!onShutter || status !== "streaming"}
            aria-label="촬영"
            className="flex h-20 w-20 items-center justify-self-center justify-center rounded-full border-4 border-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden className="h-16 w-16 rounded-full bg-white" />
          </button>

          <button
            type="button"
            // 여는 중에 다시 요청하면 일부 안드로이드에서 NotReadableError가 난다.
            // disabled를 쓰면 누른 버튼에서 포커스가 빠지므로 aria-disabled로 막는다
            onClick={() => {
              if (status !== "opening") onFlip();
            }}
            aria-disabled={status === "opening"}
            aria-label="카메라 전환"
            className="-mr-2 flex h-11 w-11 items-center justify-center justify-self-end text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            <span aria-hidden className="icon-[lucide--flip-horizontal] h-7 w-7" />
          </button>
        </div>
      </div>

      <Toast toast={notice} placement="top" />
    </div>
  );
}
