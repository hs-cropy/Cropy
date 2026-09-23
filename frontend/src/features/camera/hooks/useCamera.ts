"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isCameraSupported } from "../lib/cameraSupport";
import type { CameraErrorCode, CameraStatus, FacingMode } from "../types";

interface UseCameraOptions {
  /** 기본 "environment"(후면). iOS에서 exact는 실패가 잦아 ideal로 요청한다 */
  facingMode?: FacingMode;
}

function errorName(err: unknown) {
  return typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
}

function toErrorCode(err: unknown): CameraErrorCode {
  switch (errorName(err)) {
    case "NotAllowedError":
    case "SecurityError":
      return "permission-denied";
    case "NotFoundError":
      return "no-device";
    default:
      return "unknown";
  }
}

async function openStream(facingMode: FacingMode) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    if (errorName(err) !== "OverconstrainedError") throw err;
    // 제약을 못 맞추는 기기는 조건 없이 한 번 더 요청
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

export function useCamera({ facingMode = "environment" }: UseCameraOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // start/stop이 겹칠 때 늦게 도착한 스트림을 버리기 위한 요청 번호
  const requestIdRef = useRef(0);
  // visibilitychange 핸들러가 최신 상태를 읽기 위한 사본
  const statusRef = useRef<CameraStatus>("idle");
  // 숨겨질 때 카메라가 켜져 있었는지. 에러 상태에서 복귀 시 권한을 다시 묻지 않기 위함
  const resumeOnVisibleRef = useRef(false);
  const [status, setStatusState] = useState<CameraStatus>("idle");
  const [error, setError] = useState<CameraErrorCode | null>(null);
  // 실제로 열린 카메라 방향. ideal 제약·재시도 때문에 요청값과 다를 수 있다
  const [activeFacingMode, setActiveFacingMode] = useState<FacingMode | null>(null);

  const setStatus = useCallback((next: CameraStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    releaseStream();
    setActiveFacingMode(null);

    if (!isCameraSupported()) {
      setError("not-supported");
      setStatus("error");
      return;
    }

    setError(null);
    setStatus("opening");

    try {
      const stream = await openStream(facingMode);
      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      // 재생 전에 정해 두어야 전면 카메라가 반전 없이 잠깐 보이는 일이 없다.
      // 데스크톱 웹캠 등은 facingMode를 알려주지 않으므로 요청값으로 대신한다
      const actual = stream.getVideoTracks()[0]?.getSettings().facingMode;
      setActiveFacingMode(actual === "user" || actual === "environment" ? actual : facingMode);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // autoPlay가 막히는 브라우저 대비. 중단(AbortError)은 무시
        await video.play().catch(() => {});
        if (requestId !== requestIdRef.current) return;
      }
      setStatus("streaming");
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(toErrorCode(err));
      setStatus("error");
    }
  }, [facingMode, releaseStream, setStatus]);

  const stop = useCallback(() => {
    requestIdRef.current++;
    releaseStream();
    setActiveFacingMode(null);
    setStatus("idle");
  }, [releaseStream, setStatus]);

  useEffect(() => {
    if (document.hidden) resumeOnVisibleRef.current = true;
    else start();

    // 백그라운드로 가면 카메라(LED·배터리)를 끄고, 켜져 있었다면 돌아올 때 다시 연다
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const active = statusRef.current === "opening" || statusRef.current === "streaming";
        resumeOnVisibleRef.current = active;
        if (active) stop();
      } else if (resumeOnVisibleRef.current) {
        resumeOnVisibleRef.current = false;
        start();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stop();
    };
  }, [start, stop]);

  return { videoRef, status, error, activeFacingMode, start, stop };
}
