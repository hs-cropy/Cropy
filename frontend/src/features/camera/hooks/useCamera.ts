"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isCameraSupported } from "../lib/cameraSupport";
import type { CameraErrorCode, CameraStatus, FacingMode } from "@/types/camera";

interface UseCameraOptions {
  /** 기본 "environment"(후면). iOS에서 exact는 실패가 잦아 ideal로 요청한다 */
  facingMode?: FacingMode;
  /**
   * 마운트하자마자 카메라를 켤지. 기본 true(풀스크린 오버레이).
   * false 면 쓰는 쪽이 사용자 동작(클릭) 안에서 start()를 부른다 — iOS 는 그래야 권한을 묻는다
   */
  autoStart?: boolean;
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

export function useCamera({ facingMode = "environment", autoStart = true }: UseCameraOptions = {}) {
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
        // autoPlay가 막히는 브라우저 대비
        try {
          await video.play();
        } catch {
          // 새 요청·stop이 srcObject를 바꿔 중단(AbortError)된 경우는 조용히 끝낸다
          if (requestId !== requestIdRef.current) return;
          // 오류가 났어도 autoPlay로 이미 재생 중이면 정상이다.
          // 스트림은 남겨 두어 retry가 클릭 제스처 안에서 바로 play()할 수 있게 한다
          if (video.paused) {
            setError("play-failed");
            setStatus("error");
            return;
          }
        }
        if (requestId !== requestIdRef.current) return;
      }
      setStatus("streaming");
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(toErrorCode(err));
      setStatus("error");
    }
  }, [facingMode, releaseStream, setStatus]);

  /**
   * 에러 화면의 "다시 시도". 재생만 실패한 경우 getUserMedia를 기다리면 클릭 제스처가
   * 만료될 수 있으므로, 열린 스트림이 있으면 동기적으로 play()부터 다시 부른다
   */
  const retry = useCallback(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject !== stream) {
      start();
      return;
    }
    const requestId = requestIdRef.current;
    video.play().then(
      () => {
        if (requestId !== requestIdRef.current) return;
        setError(null);
        setStatus("streaming");
      },
      () => {
        // 그래도 안 되면 카메라를 처음부터 다시 연다. 기다리는 사이 숨겨졌다면 열지 않는다
        if (requestId === requestIdRef.current && !document.hidden) start();
      },
    );
  }, [start, setStatus]);

  const stop = useCallback(() => {
    requestIdRef.current++;
    releaseStream();
    setActiveFacingMode(null);
    setStatus("idle");
  }, [releaseStream, setStatus]);

  // 첫 마운트 때만 본다. 켜는 시점을 바꾸려고 다시 마운트할 일은 없다
  const autoStartRef = useRef(autoStart);

  // 정리(cleanup) 때 켜는 중·켜진 카메라가 있었는지. 개발 모드(StrictMode)는 마운트 직후 정리하고
  // 다시 효과를 돌리는데, 그 사이 다른 화면에서 넘어오며 켠 카메라(start)가 꺼진 채 남지 않게 다시 연다
  const restartOnRemountRef = useRef(false);

  useEffect(() => {
    const restart = restartOnRemountRef.current;
    restartOnRemountRef.current = false;
    if (autoStartRef.current || restart) {
      if (document.hidden) resumeOnVisibleRef.current = true;
      else start();
    }

    // 백그라운드로 가면 카메라(LED·배터리)를 끄고, 켜져 있었다면 돌아올 때 다시 연다
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const active = statusRef.current === "opening" || statusRef.current === "streaming";
        resumeOnVisibleRef.current = active;
        if (active) stop();
        else {
          // play-failed로 남겨 둔 스트림도 백그라운드에서는 끈다. 다시 시도하면 새로 연다.
          // 진행 중인 retry의 play()가 늦게 끝나도 무시되도록 요청 번호를 올린다
          requestIdRef.current++;
          releaseStream();
        }
      } else if (resumeOnVisibleRef.current) {
        resumeOnVisibleRef.current = false;
        start();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // play-failed 뒤 브라우저가 스스로(autoPlay) 재생을 시작하면 에러 화면을 거둔다
    const video = videoRef.current;
    const handlePlaying = () => {
      const stream = streamRef.current;
      if (statusRef.current !== "error" || !stream || video?.srcObject !== stream) return;
      setError(null);
      setStatus("streaming");
    };
    video?.addEventListener("playing", handlePlaying);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      video?.removeEventListener("playing", handlePlaying);
      restartOnRemountRef.current =
        statusRef.current === "opening" || statusRef.current === "streaming";
      stop();
    };
  }, [start, stop, releaseStream, setStatus]);

  return { videoRef, status, error, activeFacingMode, start, retry, stop };
}
