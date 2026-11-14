"use client";

import type { RefObject } from "react";
import type { CameraStatus } from "@/types/camera";
import type { LastShot } from "@/features/voice/hooks/useVoiceConversation";

export interface VoiceCamera {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  /** 사용자 동작 안에서 카메라를 켠다 (iOS는 그래야 권한을 묻는다) */
  onStart: () => void;
  /** 지금 보이는 장면을 찍어 진단한다 */
  onShutter: () => void;
  shutterDisabled?: boolean;
  /** 방금 찍어 진단한 사진. 구석에 썸네일·병명으로 남기고, 재촬영 안내가 있으면 영상 위에 표시한다 */
  lastShot?: LastShot | null;
}

/**
 * 음성 모드 안의 작은 카메라 미리보기. 말로("찍어 줘") 또는 셔터 버튼으로 지금 장면을 진단한다.
 * 촬영 화면의 전체 화면 뷰파인더와 달리 대화 화면 안에 머문다.
 */
export function VoiceCameraPreview({ videoRef, status, onStart, onShutter, shutterDisabled = false, lastShot = null }: VoiceCamera) {
  const streaming = status === "streaming";
  const recapture = streaming ? lastShot?.recapture ?? null : null;
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
        {/* 재촬영 안내: 다음엔 어디를 비출지 영상 위에 바로 보여 준다 (Gemini Live의 시각 안내처럼) */}
        {recapture && (
          <>
            <div aria-hidden="true" className="pointer-events-none absolute inset-4 rounded-xl border-2 border-dashed border-[#F5B301]/90" />
            <div
              role="note"
              className="absolute left-3 right-3 top-3 rounded-xl bg-[#F5B301] px-3 py-2 text-left text-xs font-semibold text-[#3D2F1A] shadow"
            >
              다음엔 {recapture.region}을(를) 비춰 주세요
              <span className="block font-normal">{recapture.instruction}</span>
            </div>
          </>
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
      {/* 영상 아래 한 줄: 찍은 결과가 있으면 썸네일·병명(지금 무엇에 대해 답하는지), 없으면 사용 안내 */}
      {streaming && lastShot ? (
        <div className="mt-1.5 flex items-center justify-center gap-2 text-left">
          {lastShot.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob URL은 next/image로 최적화할 수 없다
            <img src={lastShot.url} alt="방금 찍은 사진" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
          ) : (
            <span aria-hidden="true" className="icon-[lucide--image] h-5 w-5 text-[#647267]" />
          )}
          <span className="text-xs leading-tight text-[#647267]">
            방금 찍은 결과 <span className="font-semibold text-[#212A23]">{lastShot.diseaseName}</span>
            <span className="block">이어서 물어보면 이 결과로 답해요</span>
          </span>
        </div>
      ) : streaming ? (
        <p className="mt-1.5 text-center text-xs text-[#647267]">잎을 비추고 &quot;찍어 줘&quot;라고 말하거나 셔터를 누르면 바로 진단해요</p>
      ) : null}
    </div>
  );
}
