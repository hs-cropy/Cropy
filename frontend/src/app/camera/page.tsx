"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CameraViewfinder, useCamera, type FacingMode } from "@/features/camera";

function CameraScreen() {
  const router = useRouter();
  const cropLabel = useSearchParams().get("crop") ?? undefined;
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const { videoRef, status, error, activeFacingMode } = useCamera({ facingMode });

  const handleClose = () => {
    router.push("/");
  };

  return (
    <CameraViewfinder
      videoRef={videoRef}
      status={status}
      error={error}
      cropLabel={cropLabel}
      mirrored={activeFacingMode === "user"}
      onClose={handleClose}
      onFlip={() => setFacingMode((mode) => (mode === "environment" ? "user" : "environment"))}
    />
  );
}

export default function CameraPage() {
  // useSearchParams는 정적 렌더링 시 Suspense 경계가 필요하다
  return (
    <Suspense fallback={<div className="fixed inset-0 z-30 bg-photo-deep" />}>
      <CameraScreen />
    </Suspense>
  );
}
