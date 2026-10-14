
"use client";

import { useEffect, useRef, useState } from "react";

import {
  CameraCapture,
  isCameraSupported,
  validateImage,
} from "@/features/camera";

import {
  PROMPT_DIAGNOSING,
  PROMPT_HOME,
  buildRecapturePrompt,
  buildResultPrompt,
  useVoiceGuide,
} from "@/features/voice";

import { useHomeTab } from "@/hooks/useHomeTab";
import { diagnoseImage } from "@/lib/api";

import type { DiagnoseResponse } from "@/types/diagnosis";

import { DiagnosisResult } from "./DiagnosisResult";
import { subscribeNewDiagnosis } from "./newDiagnosis";
import { RecapturePanel } from "./RecapturePanel";
import { Toast, useToast } from "./Toast";

import { LowConfidencePanel } from "./LowConfidencePanel";
import { DiagnosisFailurePanel } from "./DiagnosisFailurePanel";

import { CropMismatchNotice } from "./CropMismatchNotice";

// 작물 선택 목록
const CROP_TYPES = [
  { value: "", label: "자동 감지", icon: "✨" },
  { value: "고추", label: "고추", icon: "🌶️" },
  { value: "무", label: "무", icon: "🌱" },
  { value: "배추", label: "배추", icon: "🥬" },
];

// 사진 촬영 안내
const PHOTO_TIPS = [
  "잎이나 과실 전체가 화면에 들어오게 찍어주세요",
  "그늘보다 밝은 자연광 아래가 정확해요",
  "병반(얼룩·반점)에 초점을 맞춰 또렷하게 찍어주세요",
];

export function DiagnoseForm() {
  // 현재 탭: capture / diagnosis
  const activeTab = useHomeTab();

  // DOM 참조
  const captureCardRef = useRef<HTMLButtonElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [focusAfterReset, setFocusAfterReset] = useState(false);

  // 촬영 및 진단 상태
  const [cropType, setCropType] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnoseResponse | null>(null);

  // 토스트 및 음성 안내
  const { toast, showToast, clearToast } = useToast();

  const {
    speak,
    prime: primeSpeech,
    cancel: cancelSpeech,
  } = useVoiceGuide();

  // ==============================
  // 초기 진입 및 종료 처리
  // ==============================

  useEffect(() => {
    speak(PROMPT_HOME);
  }, [speak]);

  // 컴포넌트 종료 시 진행 중인 진단 요청 취소
  useEffect(() => {
    return () => {
      requestRef.current?.abort();
    };
  }, []);

  // 저장 상태가 갱신되었을 때 현재 결과 반영
  const updateResult = (saved: DiagnoseResponse) => {
    setResult((previous) =>
      previous?.id === saved.id ? saved : previous
    );
  };

  // ==============================
  // 탭 전환
  // ==============================

  useEffect(() => {
    // 진단 탭으로 이동하면 카메라 오버레이 닫기
    if (activeTab === "diagnosis") {
      setCameraOpen(false);
    }

    // 탭 전환 시 화면 맨 위로 이동
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    window.scrollTo({
      top: 0,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [activeTab]);

  // 진단 결과가 표시되는 탭에서만 결과 낭독
  useEffect(() => {
    if (!result || activeTab !== "diagnosis") return;

    if (result.recapture) {
      speak(buildRecapturePrompt(result.recapture));
    } else if (
      result.decision_reasons?.includes("low_confidence") &&
      result.save_status === "saved" &&
      result.prediction_mode !== "browser"
    ) {
      speak("추가 확인이 필요해요. 현재 사진만으로는 병해를 확정하기 어려워요. 사진을 다시 촬영해 주세요.");
    } else {
      speak(buildResultPrompt(result));
    }
  }, [result, activeTab, speak]);

  // 미리보기 URL 메모리 정리
  useEffect(() => {
    if (!preview) return;

    return () => {
      URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // ==============================
  // 사진 선택
  // ==============================

  const selectFile = (next: File): boolean => {
    if (loading) return false;

    // 기존 이미지 검증 로직 유지
    const check = validateImage(next);

    if (!check.ok) {
      showToast(check.message);
      return false;
    }

    // 사진 변경
    setFile(next);
    setPreview(URL.createObjectURL(next));

    // 이전 분석 결과 초기화
    cancelSpeech();
    setResult(null);
    setError(null);

    return true;
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const next = e.target.files?.[0];

    // 동일 파일을 재선택할 수 있도록 초기화
    e.target.value = "";

    if (next) {
      selectFile(next);
    }
  };

  // ==============================
  // 카메라 처리
  // ==============================

  const openCamera = () => {
    if (loading) return;

    // 브라우저 카메라 API 사용 가능
    if (isCameraSupported()) {
      primeSpeech();
      setCameraOpen(true);
    } else {
      // 카메라 API 미지원 시 기기 기본 촬영 기능
      fallbackInputRef.current?.click();
    }
  };

  const closeCamera = () => {
    clearToast();
    setCameraOpen(false);
    captureCardRef.current?.focus();
  };

  /** 내비의 "새 진단": 진행 중인 진단을 취소하고 촬영 화면으로 돌아간다 */
  const reset = () => {
    // 진행 중인 진단 요청 취소
    requestRef.current?.abort();
    requestRef.current = null;

    // 이전 진단 상태 초기화
    setLoading(false);
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setCropType("");
    setCameraOpen(false);

    clearToast();
    cancelSpeech();

    // 진단 결과 탭에 남지 않고 촬영 탭으로 이동
    if (window.location.hash !== "#capture") {
      window.location.hash = "capture";
    }

    // 촬영 탭이 화면에 반영된 후 초점 이동
    setFocusAfterReset(true);
  };

  // 렌더마다 다시 구독한다: reset 이 나중에 state 를 읽게 되어도 낡은 값을 보지 않는다
  
  useEffect(() => {
    // 초기화가 요청되지 않았거나,
    // 진단 중이거나,
    // 촬영 탭이 아직 화면에 반영되지 않았다면 대기
    if (
      !focusAfterReset ||
      loading ||
      activeTab !== "capture"
    ) {
      return;
    }

    const button = captureCardRef.current;

    // 버튼이 활성화되고 촬영 탭이 표시된 후 초점 이동
    if (button && !button.disabled) {
      button.focus();
      setFocusAfterReset(false);
    }
  }, [focusAfterReset, loading, activeTab]);

  useEffect(() => subscribeNewDiagnosis(reset));

  const handleCapture = (captured: File) => {
    // 검증 실패 시 카메라를 유지해서 다시 촬영 가능
    if (selectFile(captured)) {
      closeCamera();
    }
  };

  const handleCameraGallery = () => {
    closeCamera();
    galleryInputRef.current?.click();
  };

  // ==============================
  // AI 진단 API
  // ==============================

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (loading) return;

    if (!file) {
      setError("먼저 사진을 촬영하거나 선택하세요.");
      return;
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    requestRef.current = controller;

    // 기존 음성 안내 유지
    speak(PROMPT_DIAGNOSING);

    try {
      const data = await diagnoseImage(
        file,
        cropType || undefined,
        { signal: controller.signal }
      );

      if (controller.signal.aborted) return;

      // 분석 결과 저장
      
      const previewMode =
        process.env.NODE_ENV === "development"
          ? new URLSearchParams(window.location.search).get("preview")
          : null;

      let displayResult: DiagnoseResponse = data;

      // ① 낮은 신뢰도 미리보기
      if (previewMode === "low-confidence") {
        displayResult = {
          ...data,
          confidence: 0.42,
          decision_status: "low_confidence",
          decision_reasons: ["low_confidence"],
          recapture: null,
          save_status: "saved",
          prediction_mode: "mock",
        };
      }

      // ② 혼동쌍 미리보기
      if (previewMode === "confusion") {
        displayResult = {
          ...data,
          crop_type: "무",
          disease_name: "무 검은무늬병",
          confidence: 0.47,
          top_predictions: [
            {
              name: "무 검은무늬병",
              confidence: 0.47,
            },
            {
              name: "무 노균병",
              confidence: 0.42,
            },
          ],
          decision_status: "confusion",
          decision_reasons: ["confusion", "low_confidence"],
          save_status: "saved",
          prediction_mode: "mock",

          recapture: {
            region: "잎 뒷면",
            instruction:
              "같은 잎을 뒤집어 반점이 있는 곳의 뒷면이 보이도록 찍어주세요.",
            margin: 0.05,
            candidates: [
              {
                name: "무 노균병",
                cue: "",
              },
              {
                name: "무 검은무늬병",
                cue: "",
              },
            ],
          },
        };
      }

      setResult(displayResult);



      // 성공하면 진단 탭으로 이동
      window.location.hash = "diagnosis";
    } catch (err) {
      if (controller.signal.aborted) return;

      setError(
        err instanceof Error
          ? err.message
          : "진단에 실패했어요. 잠시 후 다시 시도해 주세요."
      );
      window.location.hash = "diagnosis";
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
      }

      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  // ==============================
  // 화면
  // ==============================

  return (
    <div className="w-full">
      {/* ====================================
          1. 촬영 탭
         ==================================== */}

      <section
        aria-label="사진 촬영"
        className={activeTab === "capture" ? "block" : "hidden"}
      >
        {/* 화면 제목 */}
        <div className="mb-6">
          <h1 className="text-[1.375rem] font-extrabold leading-[1.875rem] tracking-tight text-[#191919] md:text-[2rem] md:leading-tight">
            사진 한 장이면 충분해요
          </h1>

          <p className="mt-2 text-base leading-6 text-[#6B6B6B]">
            아픈 작물을 촬영하면 AI가 병해를 분석해 드려요.
          </p>          
          <a
            href="/offline/index.html"
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-brown hover:text-ink"
          >
            인터넷 없이 기기에서 진단하기
            <span
              aria-hidden="true"
              className="icon-[lucide--chevron-right] h-4 w-4"
            />
          </a>

        </div>

        {/* 데스크톱: 촬영 폼 / 촬영 안내 2열 */}
        <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-8">

          {/* 기존 촬영 기능 전체 유지 */}
          <form ref={formRef} onSubmit={handleSubmit} aria-busy={loading}>

            {/* 사진 촬영 카드 */}
            <button
              ref={captureCardRef}
              type="button"
              onClick={openCamera}
              disabled={loading}
              className={`group block aspect-[4/3] w-full overflow-hidden rounded-2xl transition-colors ${
                preview
                  ? "border border-[#ECECEF] bg-white"
                  : "border-2 border-dashed border-[#2E8B57]/40 bg-white hover:border-[#2E8B57]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {preview ? (
                <span className="relative block h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview}
                    alt="촬영한 작물 미리보기"
                    className="h-full w-full object-cover"
                  />

                  <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-4 py-2 text-sm font-bold text-white backdrop-blur">
                    다시 촬영하기
                  </span>
                </span>
              ) : (
                <span className="flex h-full flex-col items-center justify-center px-5 text-center">

                  {/* 카메라 아이콘 */}
                  <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#EDF7F1] text-[#2E8B57] transition-transform group-hover:scale-105">
                    <span
                      aria-hidden="true"
                      className="icon-[lucide--camera] h-8 w-8"
                    />
                  </span>

                  <span className="text-lg font-bold text-[#191919]">
                    사진 촬영하기
                  </span>

                  <span className="mt-2 text-base leading-6 text-[#6B6B6B]">
                    잎이나 과실이 선명하게
                    <br />
                    보이도록 찍어주세요.
                  </span>
                </span>
              )}
            </button>

            {/* 갤러리 사진 선택 */}
            <button
              type="button"
              disabled={loading}
              onClick={() =>
                galleryInputRef.current?.click()
              }
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 text-base font-semibold text-[#2E8B57] disabled:opacity-50"
            >
              <span
                aria-hidden="true"
                className="icon-[lucide--image] h-5 w-5"
              />
              앨범에서 사진 선택
            </button>

            {/* 갤러리 파일 입력 */}
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleFileChange}
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
              onChange={handleFileChange}
              disabled={loading}
              className="hidden"
              aria-label="기기 카메라 촬영"
            />

            {/* 기존 카메라 오버레이 기능 */}
            {cameraOpen && (
              <CameraCapture
                cropLabel={cropType || undefined}
                onCapture={handleCapture}
                onClose={closeCamera}
                onCaptureError={showToast}
                notice={toast}
                onGallery={handleCameraGallery}
              />
            )}

            {/* 작물 선택 */}
            <fieldset className="mt-6">
              <legend className="mb-3 text-base font-bold text-[#191919]">
                작물 선택
              </legend>

              <div className="flex flex-wrap gap-2">
                {CROP_TYPES.map((crop) => {
                  const active = cropType === crop.value;

                  return (
                    <button
                      key={crop.value || "auto"}
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        setCropType(crop.value)
                      }
                      aria-pressed={active}
                      className={`inline-flex min-h-12 items-center gap-1.5 rounded-xl border px-4 py-2 text-base font-semibold transition-colors ${
                        active
                          ? "border-[#2E8B57] bg-[#EDF7F1] text-[#2E8B57]"
                          : "border-[#ECECEF] bg-white text-[#6B6B6B] hover:border-[#2E8B57]/50"
                      } disabled:opacity-50`}
                    >
                      <span aria-hidden="true">
                        {crop.icon}
                      </span>

                      {crop.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* 진단 요청 실패 안내 */}
            {error && (
              <div
                role="alert"
                className="mt-4 rounded-xl bg-[#FFF1F0] p-4 text-base leading-6 text-[#D92D20]"
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="icon-[lucide--circle-alert] mt-0.5 h-5 w-5 shrink-0"
                  />

                  <span>{error}</span>
                </div>
              </div>
            )}

            {/* AI 진단 시작 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className="mt-6 flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl bg-[#2E8B57] px-5 py-3 text-base font-bold text-white transition-colors hover:bg-[#26784B] active:bg-[#1F633D] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span
                    aria-hidden="true"
                    className="icon-[lucide--loader-circle] h-5 w-5 animate-spin"
                  />

                  진단 중…
                </>
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className="icon-[lucide--scan-search] h-5 w-5"
                  />

                  AI 진단 시작
                </>
              )}
            </button>

          </form>

          {/* 데스크톱 촬영 도움말 */}
          <aside className="mt-6 hidden rounded-2xl border border-[#ECECEF] bg-white p-6 shadow-sm lg:mt-0 lg:block">

            <h2 className="flex items-center gap-2 text-lg font-bold text-[#191919]">
              <span
                aria-hidden="true"
                className="icon-[lucide--info] h-5 w-5 text-[#2E8B57]"
              />
              좋은 사진 촬영 팁
            </h2>

            <ul className="mt-5 space-y-4">
              {PHOTO_TIPS.map((tip) => (
                <li
                  key={tip}
                  className="flex items-start gap-3 text-base leading-6 text-[#6B6B6B]"
                >
                  <span
                    aria-hidden="true"
                    className="icon-[lucide--check] mt-1 h-5 w-5 shrink-0 text-[#2E8B57]"
                  />

                  <span>{tip}</span>
                </li>
              ))}
            </ul>

            <p className="mt-6 rounded-xl bg-[#EDF7F1] p-4 text-sm leading-6 text-[#2E8B57]">
              사진을 선택하고 진단을 시작하면
              AI 분석 결과를 확인할 수 있어요.
            </p>
          </aside>
        </div>
      </section>

      {/* ====================================
          2. 진단 탭
         ==================================== */}

      <section
        aria-label="AI 진단 결과"
        className={
          activeTab === "diagnosis"
            ? "mx-auto w-full max-w-5xl space-y-5"
            : "hidden"
        }
      >
        {result ? (
          <div className="space-y-5">
            {/* 예외 화면에서도 작물 불일치 안내 표시 */}
                {result.save_status === "saved" &&
                  result.prediction_mode !== "browser" &&
                  (result.recapture ||
                    result.decision_reasons?.includes("low_confidence")) && (
                    <CropMismatchNotice result={result} />
                  )}

                {/* 후보 혼동을 최우선 표시 */}
                {result.recapture &&
                  result.save_status === "saved" &&
                  result.prediction_mode !== "browser" ? (
                  <RecapturePanel
                    key={result.id}
                    diagnosisId={result.id}
                    guidance={result.recapture}
                    onRefined={updateResult}
                    actionsVisible={activeTab === "diagnosis"}
                  />
                ) : result.decision_reasons?.includes("low_confidence") &&
                  result.save_status === "saved" &&
                  result.prediction_mode !== "browser" ? (
                  <LowConfidencePanel
                    confidence={result.confidence}
                    onRetake={() => {
                      reset();
                      if (isCameraSupported()) {
                        primeSpeech();
                        setCameraOpen(true);
                      } else {
                        fallbackInputRef.current?.click();
                      }
                    }}
                    actionsVisible={activeTab === "diagnosis"}
                  />
            ) : (
              /* 일반 결과 / 저장 실패 복구는 기존 DiagnosisResult 유지 */
              <>
                <header className="space-y-2">
                  <h2 className="text-2xl font-bold text-cropy-text-primary lg:text-3xl">
                    진단 결과
                  </h2>
                  <p className="text-base text-cropy-text-secondary">
                    AI 분석 결과와 관리 방법을 확인하세요.
                  </p>
                </header>
                {result.recapture && result.save_status !== "saved" && (
                  <div role="status" className="rounded-xl border border-cropy-border bg-cropy-action-subtle p-4">
                    <p className="font-semibold text-cropy-text-primary">추가 촬영 안내가 있어요</p>
                    <p className="mt-2 text-base leading-6 text-cropy-text-secondary">
                      현재 진단 결과를 저장한 뒤 재촬영을 진행할 수 있어요.
                    </p>
                  </div>
                )}
                <DiagnosisResult result={result} onSaved={updateResult} />
                <button
                  type="button"
                  onClick={() => { window.location.hash = "capture"; }}
                  className="flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl border border-[#2E8B57] bg-white px-5 py-3 text-base font-semibold text-[#2E8B57] transition-colors hover:bg-[#EDF7F1]"
                >
                  <span aria-hidden className="icon-[lucide--camera] size-5" />
                  다른 사진으로 새 진단
                </button>
              </>
            )}
          </div>
        ) : error ? (
          <DiagnosisFailurePanel
            message={error}
            loading={loading}
            onRetry={() => formRef.current?.requestSubmit()}
            onPickDifferent={() => {
              window.location.hash = "capture";
              galleryInputRef.current?.click();
            }}
            actionsVisible={activeTab === "diagnosis"}
          />
        ) : (
          <div className="rounded-2xl border border-cropy-border bg-white px-6 py-10 text-center">
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-cropy-action-subtle">
              <span
                aria-hidden
                className={`size-8 text-cropy-action-primary ${
                  loading ? "icon-[lucide--loader-circle] animate-spin" : "icon-[lucide--scan-search]"
                }`}
              />
            </span>
            <h2 className="mt-5 text-xl font-bold text-cropy-text-primary">
              {loading ? "사진을 분석하고 있어요" : "아직 진단 결과가 없어요"}
            </h2>
            <p role="status" className="mt-3 whitespace-pre-line text-base leading-6 text-cropy-text-secondary">
              {loading
                ? "분석이 완료되면 결과를 보여드릴게요."
                : "촬영 탭에서 사진을 선택하고\nAI 진단을 시작해 주세요."}
            </p>
            {!loading && (
              <button
                type="button"
                onClick={() => { window.location.hash = "capture"; }}
                className="mt-6 min-h-[3.25rem] w-full rounded-xl bg-[#2E8B57] px-5 py-3 text-base font-semibold text-white hover:bg-[#26784B]"
              >
                사진 촬영하기
              </button>
            )}
          </div>
        )}
      </section>



      {/* ====================================
          공통 토스트
         ==================================== */}

      {/* 카메라 오버레이가 열려 있으면
          카메라 내부에서 토스트를 표시 */}
      <Toast toast={cameraOpen ? null : toast} />
    </div>
  );
}
