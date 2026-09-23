"use client";

import { useEffect, useRef, useState } from "react";
import { CameraViewfinder } from "./CameraViewfinder";
import { useCamera } from "./hooks/useCamera";
import { useCaptureFrame } from "./hooks/useCaptureFrame";
import type { CameraCaptureProps, FacingMode } from "./types";

/**
 * 풀스크린 카메라 오버레이. 마운트되면 카메라가 켜지고 언마운트되면 꺼지므로
 * 부모는 `{open && <CameraCapture … />}`로 열고 닫는다.
 */
export function CameraCapture({ onCapture, onClose, onGallery, cropLabel }: CameraCaptureProps) {
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const { videoRef, status, error, activeFacingMode } = useCamera({ facingMode });
  const { capture, capturing } = useCaptureFrame();
  // 캡처(toBlob)를 기다리는 사이 닫혔다면 그 사진은 넘기지 않는다
  const mountedRef = useRef(true);

  // 오버레이 뒤 페이지가 스크롤되지 않게 한다
  useEffect(() => {
    mountedRef.current = true;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleShutter = async () => {
    const video = videoRef.current;
    if (!video) return;
    const frame = await capture(video);
    if (frame && mountedRef.current)
      onCapture(frame.file, { source: "camera", width: frame.width, height: frame.height });
  };

  return (
    <CameraViewfinder
      videoRef={videoRef}
      status={status}
      error={error}
      cropLabel={cropLabel}
      mirrored={activeFacingMode === "user"}
      onClose={onClose}
      onFlip={() => setFacingMode((mode) => (mode === "environment" ? "user" : "environment"))}
      onShutter={capturing ? undefined : handleShutter}
      onGallery={onGallery}
    />
  );
}
