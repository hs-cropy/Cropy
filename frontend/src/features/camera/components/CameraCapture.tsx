"use client";

import { useEffect, useRef, useState } from "react";
import { CameraViewfinder } from "./CameraViewfinder";
import { useCamera } from "../hooks/useCamera";
import { useCaptureFrame } from "../hooks/useCaptureFrame";
import { useCameraVoiceGuide } from "@/features/voice";
import type { CameraCaptureProps, FacingMode } from "@/types/camera";

const CAPTURE_ERROR_MESSAGE = "사진을 만들지 못했어요. 다시 찍어 주세요";

/**
 * 풀스크린 카메라 오버레이. 마운트되면 카메라가 켜지고 언마운트되면 꺼지므로
 * 부모는 `{open && <CameraCapture … />}`로 열고 닫는다.
 */
export function CameraCapture({
  onCapture,
  onClose,
  onCaptureError,
  onGallery,
  cropLabel,
  notice,
}: CameraCaptureProps) {
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const { videoRef, status, error, activeFacingMode, retry } = useCamera({ facingMode });
  const { capture } = useCaptureFrame();
  // 캡처(toBlob)를 기다리는 사이 닫혔다면 그 사진은 넘기지 않는다
  const mountedRef = useRef(true);
  useCameraVoiceGuide(status === "streaming", cropLabel);

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
    const result = await capture(video);
    if (!mountedRef.current) return;
    if (result.ok) {
      onCapture(result.file, { source: "camera", width: result.width, height: result.height });
    } else if (result.reason !== "busy") {
      // 오버레이는 그대로 두어 바로 다시 찍을 수 있게 한다
      onCaptureError?.(CAPTURE_ERROR_MESSAGE);
    }
  };

  return (
    <CameraViewfinder
      videoRef={videoRef}
      status={status}
      error={error}
      cropLabel={cropLabel}
      mirrored={activeFacingMode === "user"}
      onClose={onClose}
      onRetry={retry}
      notice={notice}
      onFlip={() => setFacingMode((mode) => (mode === "environment" ? "user" : "environment"))}
      // 캡처 중에도 비활성화하지 않는다(누른 버튼의 포커스가 빠지므로). 연타는 busy 잠금이 무시한다
      onShutter={handleShutter}
      onGallery={onGallery}
    />
  );
}
