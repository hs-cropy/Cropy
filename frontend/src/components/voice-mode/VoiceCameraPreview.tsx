"use client";

import type { RefObject } from "react";
import type { CameraStatus } from "@/types/camera";

export interface VoiceCamera {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  /** 사용자 동작 안에서 카메라를 켠다 (iOS는 그래야 권한을 묻는다) */
  onStart: () => void;
  /** 지금 보이는 장면을 찍어 진단한다 */
  onShutter: () => void;
  shutterDisabled?: boolean;
}

/**
 * 음성 모드 안의 작은 카메라 미리보기. 말로("찍어 줘") 또는 셔터 버튼으로 지금 장면을 진단한다.
 * 촬영 화면의 전체 화면 뷰파인더와 달리 대화 화면 안에 머문다.
 */
export function VoiceCameraPreview({ videoRef, status, onStart, onShutter, shutterDisabled = false }: VoiceCamera) {
  const streaming = status === "streaming";
  return (
    <div className="w-full">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/80">
        {/* 스트림이 없을 때도 video 요소는 두어야 켤 때 srcObject를 바로 붙일 수 있다 */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="카메라 미리보기"
          className={`h-full w-full object-cover ${streaming ? "" : "invisible"}`}
        />
        {!streaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-white">
            {status === "opening" ? (
              <span>카메라를 켜는 중이에요</span>
            ) : (
              <>
                <span>카메라를 켜면 잎을 비추고 &quot;찍어 줘&quot;라고 말해 바로 진단할 수 있어요.</span>
                <button
                  type="button"
                  onClick={onStart}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#212A23]"
                >
                  카메라 켜기
                </button>
              </>
            )}
          </div>
        )}
        {streaming && (
          <button
            type="button"
            onClick={onShutter}
            disabled={shutterDisabled}
            aria-label="지금 장면 찍어 진단"
            className="absolute bottom-3 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/80 bg-white/30 disabled:opacity-40"
          >
            <span aria-hidden="true" className="h-10 w-10 rounded-full bg-white" />
          </button>
        )}
      </div>
      {streaming && <p className="mt-1.5 text-center text-xs text-[#647267]">잎을 비추고 &quot;찍어 줘&quot;라고 말하거나 셔터를 누르면 바로 진단해요</p>}
    </div>
  );
}
