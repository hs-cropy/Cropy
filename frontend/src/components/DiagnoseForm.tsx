"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CaseFeedback } from "@/features/feedback/CaseFeedback";
import type { FeedbackCaseId } from "@/features/feedback/cases";
import { PROMPT_HOME, useVoiceGuide } from "@/features/voice";
import { useLocationHash } from "@/hooks/useLocationHash";

import { subscribeNewDiagnosis } from "./newDiagnosis";
import { Toast, useToast } from "./Toast";
import { useCaptureScreen, type PhotoSource } from "./capture/CaptureScreen";
import { CAPTURE_PATH, DIAGNOSIS_PATH, useDiagnosisSession } from "./diagnosis/DiagnosisSession";
import { DiagnosisPageShell } from "./DiagnosisPageActions";

/**
 * 촬영 화면 (/, Figma 01·02): 카메라 촬영·사진 고르기·사진 확인·촬영 가이드(#guide).
 * "이 사진으로 진단하기"를 누르면 진단 결과 화면(/diagnosis)으로 옮겨 분석한다.
 * 고른 사진과 진단 상태는 DiagnosisSessionProvider 가 갖는다 (화면을 오가도 남는다).
 */
export function DiagnoseForm() {
  const router = useRouter();
  const session = useDiagnosisSession();
  const { file, preview, photoSource, loading, refineTarget } = session;

  // 새 진단 뒤 초점을 받는 촬영 화면의 첫 컨트롤 (사진 업로드 영역, M-01-0 · D-01)
  const captureFocusRef = useRef<HTMLButtonElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [focusAfterReset, setFocusAfterReset] = useState(false);
  // 새 진단 때마다 올려 촬영 화면의 카메라·권한 안내 상태를 처음으로 돌린다
  const [captureKey, setCaptureKey] = useState(0);
  // 고른 사진을 쓸 수 없을 때의 안내 (Figma inline/photo-format·photo-size). 다른 사진을 고르면 걷는다
  const [photoFeedback, setPhotoFeedback] = useState<FeedbackCaseId | null>(null);

  const { toast, showToast, clearToast } = useToast();
  const { speak, prime: primeSpeech, cancel: cancelSpeech } = useVoiceGuide();

  // 예전 주소(/#diagnosis)로 들어오면 진단 결과 화면으로 보낸다
  const locationHash = useLocationHash();
  useEffect(() => {
    if (locationHash === "#diagnosis") router.replace(DIAGNOSIS_PATH);
  }, [locationHash, router]);

  const selectFile = (next: File, source: PhotoSource): boolean => {
    const rejected = session.selectFile(next, source);
    setPhotoFeedback(rejected);
    if (rejected) return false;
    clearToast();
    cancelSpeech();
    return true;
  };

  // 갤러리 입력과 기기 카메라 입력이 함께 쓴다. 어느 쪽인지는 source 로 받는다
  const handleFileChange = (source: PhotoSource) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0];
    // 동일 파일을 재선택할 수 있도록 초기화
    e.target.value = "";
    // 고르는 창을 닫으면(취소) 파일이 없다. 지금 화면과 사진을 그대로 둔다
    if (next) selectFile(next, source);
  };

  /** 내비의 "새 진단"·결과 화면의 "새 진단": 진행 중인 진단을 취소하고 촬영 화면 처음으로 돌린다 */
  const reset = () => {
    session.reset();
    setCaptureKey((key) => key + 1);
    setPhotoFeedback(null);
    clearToast();
    cancelSpeech();
    // 촬영 가이드에 있었다면 닫는다
    if (window.location.hash && window.location.hash !== "#capture") {
      window.location.hash = "capture";
    }
    // 촬영 화면이 다시 그려진 뒤 초점 이동
    setFocusAfterReset(true);
  };

  useEffect(() => {
    if (!focusAfterReset || loading) return;
    const button = captureFocusRef.current;
    // 다시 그린 촬영 화면의 첫 컨트롤이 표시된 후 초점 이동
    if (button) {
      button.focus();
      setFocusAfterReset(false);
    }
  }, [focusAfterReset, loading]);

  // 렌더마다 다시 구독한다: reset 이 나중에 state 를 읽게 되어도 낡은 값을 보지 않는다
  useEffect(() => subscribeNewDiagnosis(reset));

  // 촬영 화면의 제목·버튼은 틀의 고정 영역에, 본문은 섹션에 넣는다
  const capture = useCaptureScreen({
    visible: true,
    preview,
    photoSource,
    photoName: file?.name,
    loading,
    onCapture: selectFile,
    onCaptureError: showToast,
    onPickGallery: () => galleryInputRef.current?.click(),
    onDeviceCamera: () => fallbackInputRef.current?.click(),
    onSubmit: session.submit,
    onClearPhoto: session.clearPhoto,
    onCameraStart: primeSpeech,
    focusRef: captureFocusRef,
    resetKey: captureKey,
    refine: refineTarget?.guidance,
  });

  /** 추가 촬영 취소: 고른 사진을 비우고 재촬영 안내(진단 결과·이력 상세)로 돌아간다 */
  const handleCancelRefine = () => {
    setPhotoFeedback(null);
    clearToast();
    cancelSpeech();
    session.cancelRefine();
  };

  // 다른 화면에서 넘어오며 남긴 일: 새 진단이면 처음 컨트롤에, 분석 취소·사진 고르기면 제목에
  // 초점을 두고, 진단 시작 안내의 "사진 찍기"면 카메라를 켜고, "촬영 방법 보기"면 가이드를 연다
  const { takeArrival } = session;
  // 개발 모드(StrictMode)에서 effect 가 두 번 돌아도 한 번만 꺼낸다
  const arrivedRef = useRef(false);
  useEffect(() => {
    if (arrivedRef.current) return;
    arrivedRef.current = true;
    // 예전 주소(/#diagnosis)는 곧 진단 결과 화면으로 옮겨 가니 처음 안내를 읽지 않는다
    if (window.location.hash === "#diagnosis") return;
    const arrival = takeArrival(CAPTURE_PATH);
    // 앱 안의 흐름(새 진단·분석 취소 등)으로 돌아왔으면 처음 안내를 다시 읽지 않는다
    if (!arrival) speak(PROMPT_HOME);
    if (arrival === "reset") setFocusAfterReset(true);
    else if (arrival === "focus") capture.focusTitle();
    else if (arrival === "camera") capture.openCamera();
    else if (arrival === "guide") capture.openGuide();
    // 처음 그릴 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DiagnosisPageShell scrollLabel="진단하기" header={capture.header} actions={capture.actions}>
      {/* 촬영 화면은 고정 제목 영역 바로 아래에서 시작한다.
        데스크탑은 본문 폭(최대 1200px)을 AppShellPage 가 정한다 */}
      <div className="mx-auto w-full max-w-[27.5rem] md:max-w-[44rem] lg:max-w-none">
        {/* 숨긴 파일 입력. 갤러리 입력을 먼저 둔다 (테스트가 첫 번째 파일 입력으로 사진을 고른다) */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleFileChange("gallery")}
          disabled={loading}
          className="hidden"
          aria-label="갤러리 사진 선택"
        />

        {/* 카메라 API 미지원 시 기본 카메라 앱 */}
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          onChange={handleFileChange("camera")}
          disabled={loading}
          className="hidden"
          aria-label="기기 카메라 촬영"
        />

        <section aria-label="사진 촬영">
          {/* 촬영 가이드에서는 감춘다. 가이드를 닫으면 다시 보인다 */}
          {photoFeedback && locationHash !== "#guide" && (
            <CaseFeedback
              caseId={photoFeedback}
              headingLevel={2}
              onPrimary={() => galleryInputRef.current?.click()}
              className="mx-auto mb-4 lg:mb-6 lg:max-w-[30rem]"
            />
          )}
          {capture.body}
          {/* 추가 촬영 중에는 그만두고 재촬영 안내로 돌아가는 길을 둔다 (진단 중·가이드에서는 감춘다) */}
          {refineTarget && !loading && locationHash !== "#guide" && (
            <button
              type="button"
              onClick={handleCancelRefine}
              className="mt-4 inline-flex min-h-cropy-control-md items-center gap-1 text-cropy-helper font-bold text-cropy-text-secondary hover:text-cropy-action-hover lg:mt-6"
            >
              <span aria-hidden="true" className="icon-[lucide--chevron-left] h-4 w-4" />
              추가 촬영 취소
            </button>
          )}
        </section>

        {/* 촬영 화면은 버튼 두 개짜리 행동 영역이 늘 있어 그 위에 띄운다 */}
        <Toast toast={toast} placement="aboveActions" />
      </div>
    </DiagnosisPageShell>
  );
}
