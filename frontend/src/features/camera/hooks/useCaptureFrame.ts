"use client";

import { useCallback, useRef, useState } from "react";

interface CapturedFrame {
  file: File;
  width: number;
  height: number;
}

/** 현재 <video> 프레임을 JPEG File로 만든다. 미리보기의 좌우 반전(CSS)은 저장 이미지에 들어가지 않는다 */
export function useCaptureFrame() {
  const [capturing, setCapturing] = useState(false);
  // 셔터 연타로 같은 프레임을 두 번 넘기지 않도록 렌더를 기다리지 않는 잠금
  const busyRef = useRef(false);

  const capture = useCallback(async (video: HTMLVideoElement): Promise<CapturedFrame | null> => {
    if (busyRef.current) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    busyRef.current = true;
    setCapturing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (!blob) return null;
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      return { file, width, height };
    } finally {
      busyRef.current = false;
      setCapturing(false);
    }
  }, []);

  return { capture, capturing };
}
