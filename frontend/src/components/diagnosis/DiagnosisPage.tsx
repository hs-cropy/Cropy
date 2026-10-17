"use client";

import { useEffect, useRef, useState } from "react";

import { CameraCapture, isCameraSupported } from "@/features/camera";
import {
  PROMPT_DIAGNOSING,
  buildRecapturePrompt,
  buildResultPrompt,
  useVoiceGuide,
} from "@/features/voice";
import type { PhotoSource } from "@/components/capture/CaptureScreen";
import { CropMismatchNotice } from "@/components/CropMismatchNotice";
import { DiagnosisFailurePanel } from "@/components/DiagnosisFailurePanel";
import { DiagnosisPageShell } from "@/components/DiagnosisPageActions";
import { LowConfidencePanel } from "@/components/LowConfidencePanel";
import { RecapturePanel } from "@/components/RecapturePanel";
import { Toast, useToast } from "@/components/Toast";
import { CAPTURE_PATH, DIAGNOSIS_PATH, useDiagnosisSession } from "./DiagnosisSession";
import { useDiagnosisScreen } from "./DiagnosisScreen";

const LOW_CONFIDENCE_PROMPT =
  "추가 확인이 필요해요. 현재 사진만으로는 병해를 확정하기 어려워요. 사진을 다시 촬영해 주세요.";

/**
 * 진단 결과 화면 (/diagnosis, Figma 03): 진단 시작 안내, 사진 분석 중, 진단 결과와 예외 화면
 * (실패·저신뢰·재촬영). 진단 상태는 DiagnosisSessionProvider 가 갖고, 이 화면은 그리기와
 * 이 화면에서 시작하는 동작(사진 고르기·다시 촬영)만 맡는다. 고른 사진은 촬영 화면의 사진 확인에서 본다.
 */
export function DiagnosisPage() {
  const session = useDiagnosisSession();
  const { result, error, loading, restoring, preview } = session;

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const deviceCameraInputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // "분석 취소"로 촬영 화면에 돌아가는 사이 빈 안내가 잠깐 보이지 않게 한다 (이 화면은 곧 사라진다)
  const [cancelling, setCancelling] = useState(false);

  const { toast, showToast, clearToast } = useToast();
  const { speak, prime: primeSpeech, cancel: cancelSpeech } = useVoiceGuide();

  // 새로고침했다면 마지막 결과를 다시 불러온다
  const { restore, takeArrival } = session;
  useEffect(() => {
    restore();
    // 처음 그릴 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) speak(PROMPT_DIAGNOSING);
  }, [loading, speak]);

  // 결과 낭독
  useEffect(() => {
    if (!result) return;
    if (result.recapture) speak(buildRecapturePrompt(result.recapture));
    else if (isLowConfidence(result)) speak(LOW_CONFIDENCE_PROMPT);
    else speak(buildResultPrompt(result));
  }, [result, speak]);

  /** 사진을 고르면 촬영 화면의 사진 확인으로 간다 */
  const pick = (file: File, source: PhotoSource) => {
    const message = session.selectFile(file, source);
    if (message) {
      showToast(message);
      return false;
    }
    session.navigate(CAPTURE_PATH, "focus");
    return true;
  };

  const handleFileChange = (source: PhotoSource) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0];
    // 같은 파일을 다시 고를 수 있게 비운다
    e.target.value = "";
    if (next) pick(next, source);
  };

  const handleCancel = () => {
    if (!loading) return;
    setCancelling(true);
    cancelSpeech();
    session.cancel();
  };

  const handleNewDiagnosis = () => {
    cancelSpeech();
    session.reset();
    session.navigate(CAPTURE_PATH, "reset");
  };

  /** 진단 시작 안내의 "사진 찍기"·"카메라로 촬영": 촬영 화면에서 카메라를 켠다 */
  const handleShoot = () => {
    if (!isCameraSupported()) {
      // 브라우저 카메라를 못 쓰면 기기 카메라(파일 선택)를 이 클릭 안에서 바로 연다
      deviceCameraInputRef.current?.click();
      return;
    }
    primeSpeech();
    session.navigate(CAPTURE_PATH, "camera");
  };

  /** 진단 시작 안내의 "촬영 방법 보기": 가이드는 촬영 화면에 있어 그리로 옮겨 연다 */
  const handleOpenGuide = () => {
    cancelSpeech();
    session.navigate(CAPTURE_PATH, "guide");
  };

  const exceptionVisible =
    result?.save_status === "saved" &&
    result.prediction_mode !== "browser" &&
    Boolean(result.recapture || isLowConfidence(result));

  // 예외 화면(재촬영·저신뢰·실패)은 각 패널이 제목과 버튼을 갖는다
  const exception = exceptionVisible ? (
    <div className="mx-auto w-full max-w-5xl space-y-5 pt-5 md:pt-8">
      {/* 예외 화면에서도 작물 불일치 안내 표시 */}
      <CropMismatchNotice result={result} />
      {/* 후보 혼동을 최우선 표시 */}
      {result.recapture ? (
        <RecapturePanel
          key={result.id}
          diagnosisId={result.id}
          guidance={result.recapture}
          onRefined={session.updateResult}
        />
      ) : (
        <LowConfidencePanel
          confidence={result.confidence}
          onRetake={() => {
            cancelSpeech();
            session.reset();
            if (isCameraSupported()) {
              primeSpeech();
              setCameraOpen(true);
            } else {
              deviceCameraInputRef.current?.click();
            }
          }}
        />
      )}
    </div>
  ) : !result && error ? (
    <div className="mx-auto w-full max-w-5xl pt-5 md:pt-8">
      <DiagnosisFailurePanel
        message={error}
        loading={loading}
        onRetry={session.submit}
        onPickDifferent={() => galleryInputRef.current?.click()}
      />
    </div>
  ) : null;

  const screen = useDiagnosisScreen({
    result,
    loading,
    cancelling,
    restoring,
    photo: preview,
    analysisStartedAt: session.analysisStartedAt,
    exception,
    onSaved: session.updateResult,
    onCancel: handleCancel,
    onNewDiagnosis: handleNewDiagnosis,
    onShoot: handleShoot,
    onPickGallery: () => galleryInputRef.current?.click(),
    onOpenGuide: handleOpenGuide,
  });

  // 촬영 화면에서 진단을 시작해 넘어왔으면 바뀐 화면의 제목으로 초점을 옮긴다.
  // 새로고침·주소로 들어온 때는 옮기지 않는다 (열자마자 제목에 초점 테두리가 생긴다)
  const { focusTitle } = screen;
  // 개발 모드(StrictMode)에서 effect 가 두 번 돌아도 한 번만 꺼낸다
  const arrivedRef = useRef(false);
  useEffect(() => {
    if (arrivedRef.current) return;
    arrivedRef.current = true;
    if (takeArrival(DIAGNOSIS_PATH) === "focus") focusTitle();
    // 처음 그릴 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DiagnosisPageShell scrollLabel="진단 결과" header={screen.header} actions={screen.actions}>
      <div className="mx-auto w-full max-w-[27.5rem] md:max-w-[44rem] lg:max-w-none">
        {/* 숨긴 파일 입력. 갤러리 입력을 먼저 둔다 */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleFileChange("gallery")}
          disabled={loading}
          className="hidden"
          aria-label="갤러리 사진 선택"
        />
        <input
          ref={deviceCameraInputRef}
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          onChange={handleFileChange("camera")}
          disabled={loading}
          className="hidden"
          aria-label="기기 카메라 촬영"
        />

        {/* 풀스크린 카메라 (저신뢰 결과의 다시 촬영) */}
        {cameraOpen && (
          <CameraCapture
            onCapture={(captured) => {
              // 검증에 실패하면 카메라를 그대로 두어 다시 찍게 한다
              if (pick(captured, "camera")) {
                clearToast();
                setCameraOpen(false);
              }
            }}
            onClose={() => {
              clearToast();
              setCameraOpen(false);
            }}
            onCaptureError={showToast}
            notice={toast}
            onGallery={() => {
              clearToast();
              setCameraOpen(false);
              galleryInputRef.current?.click();
            }}
          />
        )}

        {screen.body}

        <Toast
          toast={cameraOpen ? null : toast}
          placement={screen.hasActions ? "aboveActions" : "bottom"}
        />
      </div>
    </DiagnosisPageShell>
  );
}

function isLowConfidence(result: { decision_reasons?: string[] | null }) {
  return result.decision_reasons?.includes("low_confidence") ?? false;
}
