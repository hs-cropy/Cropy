"use client";

import { useEffect, useRef, useState } from "react";
import { CameraCapture, isCameraSupported, validateImage } from "@/features/camera";
import {
  PROMPT_DIAGNOSING,
  PROMPT_HOME,
  buildRecapturePrompt,
  buildResultPrompt,
  useVoiceGuide,
} from "@/features/voice";
import { diagnoseImage } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import { DiagnosisResult } from "./DiagnosisResult";
import { RecapturePanel } from "./RecapturePanel";
import { Toast, useToast } from "./Toast";

const CROP_TYPES = [
  { value: "", label: "자동 감지", icon: "✨" },
  { value: "고추", label: "고추", icon: "🌶️" },
  { value: "무", label: "무", icon: "🌱" },
  { value: "배추", label: "배추", icon: "🥬" },
];

const PHOTO_TIPS = [
  "잎이나 과실 전체가 화면에 들어오게 찍어주세요",
  "그늘보다 밝은 자연광 아래가 정확해요",
  "병반(얼룩·반점)이 또렷하게 초점을 맞춰주세요",
];

export function DiagnoseForm() {
  const captureCardRef = useRef<HTMLButtonElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [cropType, setCropType] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  // 카메라로 찍은 사진은 <input>에 넣을 수 없어 선택된 파일을 state로 들고 있는다
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnoseResponse | null>(null);
  const { toast, showToast, clearToast } = useToast();
  const { speak, prime: primeSpeech, cancel: cancelSpeech } = useVoiceGuide();

  // M01-F6 화면 진입 안내. 페이지와 상호작용하기 전이면 브라우저가 막을 수 있다
  useEffect(() => {
    speak(PROMPT_HOME);
  }, [speak]);
  useEffect(() => () => requestRef.current?.abort(), []);
  const updateResult = (saved: DiagnoseResponse) => setResult(previous => previous?.id === saved.id ? saved : previous);

  // on phones the result renders below the fold — bring it into view
  useEffect(() => {
    if (!result) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [result]);

  // 재촬영이 필요하면 결과 대신 재촬영 안내를 읽는다 (M05-F8 > M04-F9).
  // 재촬영 뒤 확정된 결과도 setResult로 들어오므로 여기서 함께 읽힌다
  useEffect(() => {
    if (!result) return;
    speak(result.recapture ? buildRecapturePrompt(result.recapture) : buildResultPrompt(result));
  }, [result, speak]);

  // 사진이 바뀌거나 화면을 떠날 때 이전 미리보기 URL을 해제한다
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  /** 형식·크기가 맞지 않으면 toast만 띄우고 기존 사진은 그대로 둔다 */
  const selectFile = (next: File) => {
    if (loading) return false;
    const check = validateImage(next);
    if (!check.ok) {
      showToast(check.message);
      return false;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    // 이전 결과를 지우므로 읽던 결과 문장도 끊는다
    cancelSpeech();
    setResult(null);
    setError(null);
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0];
    // 같은 사진을 다시 골라도 onChange가 불리도록 비운다
    e.target.value = "";
    if (next) selectFile(next);
  };

  const openCamera = () => {
    if (loading) return;
    // http 접속·미지원 브라우저는 기기 카메라 앱으로 바로 연결한다 (M01-F2 예외)
    if (isCameraSupported()) {
      // 촬영 안내는 카메라가 켜진 뒤(비동기)에 나오므로 이 탭에서 iOS 발화 제한을 풀어 둔다
      primeSpeech();
      setCameraOpen(true);
    }
    else fallbackInputRef.current?.click();
  };

  const closeCamera = () => {
    // 오버레이 안에 떠 있던 안내가 닫힌 뒤 하단에 다시 뜨지 않게 한다
    clearToast();
    setCameraOpen(false);
    captureCardRef.current?.focus();
  };

  const handleCapture = (captured: File) => {
    // 통과하지 못하면 카메라를 열어 둔 채 다시 찍게 한다
    if (selectFile(captured)) closeCamera();
  };

  const handleCameraGallery = () => {
    closeCamera();
    galleryInputRef.current?.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!file) {
      setError("먼저 사진을 촬영하거나 선택하세요.");
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    // M03-F3 — 탭 직후에 말해야 iOS가 이후 결과 낭독까지 허용한다
    speak(PROMPT_DIAGNOSING);
    try {
      const data = await diagnoseImage(file, cropType || undefined, {signal: controller.signal});
      if (controller.signal.aborted) return;
      setResult(data);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "진단에 실패했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-8">
      <form onSubmit={handleSubmit}>
        {/* Capture card — the hero of this screen */}
        <button
          ref={captureCardRef}
          type="button"
          onClick={openCamera}
          className={`group block aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-card transition ${
            preview
              ? "border border-line bg-surface"
              : "border-2 border-dashed border-khaki/35 bg-surface hover:border-brand/60"
          }`}
        >
          {preview ? (
            <span className="relative block h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="촬영한 작물 미리보기"
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink/75 px-3.5 py-1.5 text-xs font-bold text-white backdrop-blur">
                다시 촬영하기
              </span>
            </span>
          ) : (
            <span className="flex h-full flex-col items-center justify-center px-6 text-center">
              <span className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-ink shadow-cta transition group-hover:scale-105">
                <span className="icon-[lucide--camera] h-7 w-7" />
              </span>
              <span className="text-base font-bold text-ink">사진 촬영하기</span>
              <span className="mt-1 text-xs text-khaki">
                잎·과실이 선명하게 보이도록 찍어주세요
              </span>
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          className="mt-1 flex min-h-11 w-full items-center justify-center gap-1 text-sm font-bold text-brown hover:text-ink"
        >
          앨범에서 사진 선택
          <span aria-hidden className="icon-[lucide--chevron-right] h-4 w-4" />
        </button>

        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleFileChange}
          className="hidden"
        />
        {/* 카메라를 못 쓰는 환경에서 촬영 카드가 여는 기기 카메라 앱 */}
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
        />

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

        {/* Crop selector — 항상 줄바꿈해 모든 작물이 보이게 한다.
            가로 스와이프 행이면 좁은 화면이나 큰글씨 모드에서 마지막 작물이 잘리는데,
            스크롤바를 숨겨둔 탓에 더 있다는 단서조차 없다. 선택지가 셋뿐이라
            접어두는 이득보다 놓치는 위험이 크다. */}
        <div role="group" aria-label="작물 선택" className="mt-4 flex flex-wrap items-center gap-2">
          <span aria-hidden className="shrink-0 text-sm font-bold text-ink">
            작물
          </span>
          {CROP_TYPES.map((c) => {
            const active = cropType === c.value;
            return (
              <button
                key={c.value || "auto"}
                type="button"
                disabled={loading}
                onClick={() => setCropType(c.value)}
                aria-pressed={active}
                className={`inline-flex min-h-12 shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
                  active
                    ? "border-brand bg-brand text-ink"
                    : "border-line bg-surface text-muted hover:border-brand/50 hover:text-ink"
                }`}
              >
                <span aria-hidden>{c.icon}</span>
                {c.label}
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-signal-high-tint px-3.5 py-2.5 text-sm font-medium text-signal-high-ink">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-4 text-base font-bold text-ink shadow-cta transition active:scale-[0.99] hover:bg-brand-deep disabled:opacity-60"
        >
          {loading ? (
            <>
              <span aria-hidden className="icon-[lucide--loader-circle] h-5 w-5 animate-spin" />
              진단 중…
            </>
          ) : (
            "AI 진단 시작"
          )}
        </button>
      </form>

      {/* Right column on desktop, below the form on phones */}
      <div ref={resultRef} className={`scroll-mt-20 lg:mt-0 ${result ? "mt-6" : ""}`}>
        {result ? (
          <div className="space-y-4">
            {result.recapture && !loading && result.save_status === "saved" && (
              <RecapturePanel
                diagnosisId={result.id}
                guidance={result.recapture}
                key={result.id}
                onRefined={updateResult}
              />
            )}
            <DiagnosisResult result={result} onSaved={updateResult} />
          </div>
        ) : (
          <aside className="hidden rounded-card border border-line bg-surface p-5 shadow-card lg:block">
            <h4 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-khaki">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
              좋은 사진 촬영 팁
            </h4>
            <ul className="space-y-2.5">
              {PHOTO_TIPS.map((tip) => (
                <li key={tip} className="flex gap-2 text-sm text-ink/80">
                  <span
                    aria-hidden
                    className="icon-[lucide--check] mt-0.5 h-4 w-4 shrink-0 text-brand-ink"
                  />
                  {tip}
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-xl bg-brand-tint px-3.5 py-2.5 text-xs leading-relaxed text-brown-deep">
              사진을 올리고 진단을 시작하면 결과가 이 자리에 표시됩니다.
            </p>
          </aside>
        )}
      </div>

      {/* 카메라가 열려 있으면 오버레이 안에서 띄운다 */}
      <Toast toast={cameraOpen ? null : toast} />
    </div>
  );
}
