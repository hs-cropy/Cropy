"use client";

import { useEffect, useRef, useState } from "react";

import { isCameraSupported, PHOTO_ACCEPT } from "@/features/camera";
import { CaseFeedback } from "@/features/feedback/CaseFeedback";
import type { FeedbackCaseId } from "@/features/feedback/cases";
import {
  PROMPT_DIAGNOSING,
  buildRecapturePrompt,
  buildResultPrompt,
  useVoiceGuide,
} from "@/features/voice";
import type { PhotoSource } from "@/components/capture/CaptureScreen";
import { CropMismatchNotice } from "@/components/CropMismatchNotice";
import { DiagnosisPageShell } from "@/components/DiagnosisPageActions";
import { LowConfidencePanel } from "@/components/LowConfidencePanel";
import { RecapturePanel } from "@/components/RecapturePanel";
import { isNotCrop } from "@/lib/diagnosis";
import { CAPTURE_PATH, DIAGNOSIS_PATH, useDiagnosisSession } from "./DiagnosisSession";
import { useDiagnosisScreen } from "./DiagnosisScreen";

const LOW_CONFIDENCE_PROMPT =
  "추가 확인이 필요해요. 현재 사진만으로는 병해를 확정하기 어려워요. 사진을 다시 촬영해 주세요.";
const NOT_CROP_PROMPT = "작물 잎을 찾지 못했어요. 고추, 무, 배추 잎이 잘 보이게 다시 찍어 주세요.";

/**
 * 진단 결과 화면 (/diagnosis, Figma 03): 진단 시작 안내, 사진 분석 중, 진단 결과와 예외 화면
 * (실패·저신뢰·재촬영). 진단 상태는 DiagnosisSessionProvider 가 갖고, 이 화면은 그리기와
 * 이 화면에서 시작하는 동작(사진 고르기·다시 촬영)만 맡는다. 고른 사진은 촬영 화면의 사진 확인에서 본다.
 */
export function DiagnosisPage() {
  const session = useDiagnosisSession();
  const { result, error, loading, restoring, preview, refineTarget } = session;

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const deviceCameraInputRef = useRef<HTMLInputElement>(null);
  // "분석 취소"로 촬영 화면에 돌아가는 사이 빈 안내가 잠깐 보이지 않게 한다 (이 화면은 곧 사라진다)
  const [cancelling, setCancelling] = useState(false);
  // 진단 시작 안내에서 고른 사진을 쓸 수 없을 때의 안내 (Figma inline/photo-format·photo-size)
  const [photoFeedback, setPhotoFeedback] = useState<FeedbackCaseId | null>(null);
  // 진단이 다시 시작되거나 끝나면 이전 사진 안내를 걷는다
  useEffect(() => setPhotoFeedback(null), [error]);

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

  // 결과 낭독. 다시 분석은 분석 중에도 원래 결과를 두므로 분석이 끝난 뒤에만 읽는다
  useEffect(() => {
    if (!result || loading) return;
    if (isNotCrop(result)) speak(NOT_CROP_PROMPT);
    else if (result.recapture) speak(buildRecapturePrompt(result.recapture));
    else if (isLowConfidence(result)) speak(LOW_CONFIDENCE_PROMPT);
    else speak(buildResultPrompt(result));
    // 분석이 끝났다고 같은 결과를 다시 읽지 않는다 (다시 분석 실패 뒤 등)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, speak]);

  /** 사진을 고르면 촬영 화면의 사진 확인으로 간다 */
  const pick = (file: File, source: PhotoSource) => {
    const rejected = session.selectFile(file, source);
    if (rejected) {
      setPhotoFeedback(rejected);
      return;
    }
    setPhotoFeedback(null);
    session.navigate(CAPTURE_PATH, "focus");
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
    setPhotoFeedback(null);
    session.navigate(CAPTURE_PATH, "reset");
  };

  /** 진단 시작 안내의 "사진 찍기"·"카메라로 촬영", 저신뢰 결과의 "다시 촬영하기": 촬영 화면에서 카메라를 켠다 */
  const handleShoot = () => {
    if (!isCameraSupported()) {
      // 브라우저 카메라를 못 쓰면 기기 카메라(파일 선택)를 이 클릭 안에서 바로 연다
      deviceCameraInputRef.current?.click();
      return;
    }
    primeSpeech();
    session.navigate(CAPTURE_PATH, "camera");
  };

  /** 진단 시작 안내·저신뢰/판별 불가 결과의 "촬영 방법 보기": 가이드는 촬영 화면에 있어 그리로 옮겨 연다 */
  const handleOpenGuide = () => {
    cancelSpeech();
    session.navigate(CAPTURE_PATH, "guide");
  };

  // 진단 실패. 추가 촬영(다시 분석)은 실패해도 원래 결과를 두므로 결과가 있어도 실패 안내를 먼저 보인다
  const failed = Boolean(error) && (!result || Boolean(refineTarget));

  // 판별 불가 안내는 저장된 기록이 없어도 되므로 저장·서버 진단 조건과 분리한다
  const exceptionVisible =
    !failed &&
    result != null &&
    (isNotCrop(result) ||
      (result.save_status === "saved" &&
        result.prediction_mode !== "browser" &&
        Boolean(result.recapture || isLowConfidence(result))));

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
          origin={DIAGNOSIS_PATH}
        />
      ) : (
        <LowConfidencePanel
          confidence={result.confidence}
          notCrop={isNotCrop(result)}
          onRetake={() => {
            cancelSpeech();
            session.reset();
            handleShoot();
          }}
          onOpenGuide={handleOpenGuide}
        />
      )}
    </div>
  ) : failed && error ? (
    // 진단 실패: API 오류 코드에 맞는 Figma 지속형 안내 (사진 문제·서버에 닿지 못함·서버 장애·보내지 못함)
    <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 pt-5 md:pt-8">
      <CaseFeedback
        // 실패 화면에서 다시 고른 사진도 쓸 수 없으면 그 안내로 바꿔 보인다
        caseId={photoFeedback ?? error}
        headingLevel={2}
        {...failureActions(photoFeedback ?? error, {
          retry: session.submit,
          newDiagnosis: handleNewDiagnosis,
          pickDifferent: () => galleryInputRef.current?.click(),
          checkPhoto: () => session.navigate(CAPTURE_PATH, "focus"),
          openHistory: () => {
            cancelSpeech();
            session.reset();
            session.navigate("/history");
          },
        })}
      />
      {/* 다시 분석이 실패하면 원래 결과(재촬영 안내)로 돌아가는 길을 둔다.
          다시 분석할 수 없는 기록이면 돌아가도 같은 실패를 되풀이하므로 두지 않는다 */}
      {refineTarget && error !== "refine-unavailable" && (
        <button
          type="button"
          onClick={() => {
            cancelSpeech();
            session.cancelRefine();
          }}
          className="inline-flex min-h-cropy-control-md items-center gap-1 self-start text-cropy-helper font-bold text-cropy-text-secondary hover:text-cropy-action-hover"
        >
          <span aria-hidden="true" className="icon-[lucide--chevron-left] h-4 w-4" />
          추가 촬영 취소
        </button>
      )}
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
          accept={PHOTO_ACCEPT}
          onChange={handleFileChange("gallery")}
          disabled={loading}
          className="hidden"
          aria-label="갤러리 사진 선택"
        />
        <input
          ref={deviceCameraInputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          capture="environment"
          onChange={handleFileChange("camera")}
          disabled={loading}
          className="hidden"
          aria-label="기기 카메라 촬영"
        />

        {/* 진단 시작 안내에서 고른 사진을 쓸 수 없을 때. 분석 중·결과 화면에서는 걷는다 */}
        {photoFeedback && !loading && !result && !error && (
          <CaseFeedback
            caseId={photoFeedback}
            headingLevel={2}
            onPrimary={() => galleryInputRef.current?.click()}
            className="mx-auto mt-5 md:mt-8 lg:max-w-[30rem]"
          />
        )}

        {screen.body}
      </div>
    </DiagnosisPageShell>
  );
}

/**
 * 실패 안내의 버튼이 할 일. 사진 문제(형식·용량·열기)는 다른 사진을 고르고, 보내지 못했으면 다시 보내거나
 * 다른 사진을, 인터넷이 끊겼거나 서버 장애면 다시 시도하거나 사진 확인(촬영 화면)으로 돌아간다.
 * 다시 분석할 기록이 없어졌으면(추가 촬영) 이력으로, 다시 분석할 수 없는 기록이면 새 진단이나 이력으로 간다
 */
function failureActions(
  caseId: FeedbackCaseId,
  actions: {
    retry: () => void;
    newDiagnosis: () => void;
    pickDifferent: () => void;
    checkPhoto: () => void;
    openHistory: () => void;
  },
) {
  switch (caseId) {
    case "record-unavailable":
      return { onPrimary: actions.openHistory };
    case "photo-upload":
      return { onPrimary: actions.retry, onSecondary: actions.pickDifferent };
    case "analysis-offline":
    case "service-unavailable":
      return { onPrimary: actions.retry, onSecondary: actions.checkPhoto };
    case "refine-unavailable":
      return { onPrimary: actions.newDiagnosis, onSecondary: actions.openHistory };
    default:
      return { onPrimary: actions.pickDifferent };
  }
}

function isLowConfidence(result: { decision_reasons?: string[] | null }) {
  return result.decision_reasons?.includes("low_confidence") ?? false;
}
