"use client";

import { useCallback, useRef } from "react";

export type CaptureResult =
  | { ok: true; file: File; width: number; height: number }
  // busy: 셔터 연타라 무시하면 된다. 나머지는 사용자에게 알려야 하는 실패
  | { ok: false; reason: "busy" | "not-ready" | "encode-failed" };

/**
 * object-cover로 표시된 영역에 해당하는 원본 프레임 사각형.
 * 뷰파인더 video의 className(object-cover, 기본 object-position 가운데)과 맞춰야 한다
 */
function visibleRect(video: HTMLVideoElement) {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const boxW = video.clientWidth;
  const boxH = video.clientHeight;
  // 레이아웃 전이라 표시 크기를 모르면 전체 프레임을 쓴다
  if (!boxW || !boxH) return { sx: 0, sy: 0, sw: srcW, sh: srcH };

  const boxAspect = boxW / boxH;
  if (srcW / srcH > boxAspect) {
    // 원본이 더 넓다 → 좌우가 잘려 보인다
    const sw = Math.max(1, Math.round(srcH * boxAspect));
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH };
  }
  // 원본이 더 길다 → 위아래가 잘려 보인다
  const sh = Math.max(1, Math.round(srcW / boxAspect));
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh };
}

/**
 * 현재 <video> 프레임 중 화면에 보이는 영역만 JPEG File로 만든다.
 * 미리보기의 좌우 반전(CSS)은 저장 이미지에 들어가지 않는다
 */
export function useCaptureFrame() {
  // 셔터 연타로 같은 프레임을 두 번 넘기지 않도록 렌더를 기다리지 않는 잠금
  const busyRef = useRef(false);

  const capture = useCallback(async (video: HTMLVideoElement): Promise<CaptureResult> => {
    if (busyRef.current) return { ok: false, reason: "busy" };
    if (!video.videoWidth || !video.videoHeight) return { ok: false, reason: "not-ready" };

    busyRef.current = true;
    try {
      const { sx, sy, sw, sh } = visibleRect(video);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, reason: "encode-failed" };
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (!blob) return { ok: false, reason: "encode-failed" };
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      return { ok: true, file, width: sw, height: sh };
    } finally {
      busyRef.current = false;
    }
  }, []);

  return { capture };
}
