"use client";

import { PhotoPreview } from "./PhotoPreview";
import { PHOTO_ACCEPT } from "@/features/camera/lib/validateImage";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { CameraCapture, isCameraSupported, validateImage, } from "@/features/camera";
import { refineDiagnosis } from "@/lib/api";
import type { DiagnoseResponse, RecaptureGuidance } from "@/types/diagnosis";
import { Button } from "@/components/Button";
import { DiagnosisPageActions } from "@/components/DiagnosisPageActions";
import { Card } from "@/components/Card";
import { Mascot } from "@/components/Mascot";
import { DiagnosisFailurePanel } from "@/components/DiagnosisFailurePanel";

interface Props {
  diagnosisId: string;
  guidance: RecaptureGuidance;
  onRefined: (result: DiagnoseResponse) => void;
  /** CSS로 숨겨진 진단 탭에서는 고정 버튼도 숨긴다. */
  actionsVisible?: boolean;
}

type Step = "candidates" | "guide" | "preview" | "failure";

function objectParticle(value: string): string {
  const word = value.trim();
  if (!word) return "을(를)";
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return "을(를)";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

export function RecapturePanel({
  diagnosisId,
  guidance,
  onRefined,
  actionsVisible = true,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>("candidates");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => requestRef.current?.abort();
  }, [diagnosisId]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectPhoto = (file: File): boolean => {
    if (loading) return false;

    const check = validateImage(file);

    if (!check.ok) {
      setError(check.message);
      return false;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setStep("preview");

    return true;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) selectPhoto(file);
  };

  
  const openCamera = () => {
    if (loading) return;

    if (isCameraSupported()) {
      // 프로젝트에 구현된 카메라 화면 실행
      setError(null);
      setCameraOpen(true);
    } else {
      // 브라우저 카메라 API 미지원 시 기본 촬영 기능 사용
      cameraRef.current?.click();
    }
  };

  const handleCameraCapture = (captured: File) => {
    // 촬영한 사진 검증 및 미리보기 표시
    if (selectPhoto(captured)) {
      setCameraOpen(false);
    }
  };

  const handleCameraGallery = () => {
    setCameraOpen(false);
    galleryRef.current?.click();
  };


  const analyze = async (file: File | null) => {
    if (!file || requestRef.current) return;
    const check = validateImage(file);
    if (!check.ok) {
      setError(check.message);
      setStep("preview");
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setLoading(true);

    try {
      const refined = await refineDiagnosis(diagnosisId, file, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSelectedFile(null);
      setPreviewUrl(null);
      setStep("candidates");
      onRefined(refined);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "재분석에 실패했어요. 다시 시도해 주세요.",
      );
      setStep("failure");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <section aria-label="추가 촬영 안내" className="flex flex-col gap-5">
      {step === "candidates" && (
        <>
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <h2 className="text-2xl font-bold text-cropy-text-primary lg:text-3xl">
                비슷한 증상이 보여요
              </h2>
              <p className="break-keep text-base leading-7 text-cropy-text-secondary">
                두 병해를 구분하기 위해 같은 잎의 특정 부위를 한 장 더 찍어주세요.
              </p>
            </div>
            <Mascot name="comparing" size={64} className="lg:size-20" />
          </header>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card radius="lg" padding="lg">
              <h3 className="text-lg font-bold text-cropy-text-primary">AI가 비교 중인 후보</h3>
              <div className="mt-4 space-y-3">
                {guidance.candidates.map((candidate, index) => (
                  <div key={`${candidate.name}-${index}`} className="rounded-xl bg-cropy-surface-canvas p-4">
                    <p className="font-bold text-cropy-text-primary">
                      <span className="mr-2 text-cropy-action-primary">후보 {index + 1}</span>
                      {candidate.name}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-cropy-text-secondary">
                후보 예시이며 아직 확정된 진단이 아니에요.
              </p>
            </Card>

            <Card radius="lg" padding="lg" className="space-y-4">
              <h3 className="text-lg font-bold text-cropy-text-primary">
                이번엔 {guidance.region}{objectParticle(guidance.region)} 찍어주세요
              </h3>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-cropy-surface-canvas px-4 py-6">
                <div className="flex flex-col items-center gap-2">
                  <span aria-hidden className="icon-[lucide--leaf] size-12 text-cropy-text-secondary" />
                  <span className="text-sm font-semibold text-cropy-text-secondary">앞면</span>
                </div>
                <span aria-hidden className="icon-[lucide--rotate-cw] size-6 text-cropy-text-secondary" />
                <div className="flex flex-col items-center gap-2">
                  <span aria-hidden className="icon-[lucide--leaf] size-12 text-cropy-action-primary" />
                  <span className="text-sm font-semibold text-cropy-action-primary">{guidance.region}</span>
                </div>
              </div>
              <p className="break-keep text-base leading-7 text-cropy-text-secondary">
                {guidance.instruction}
              </p>
            </Card>
          </div>
          <DiagnosisPageActions visible={actionsVisible}>
            <Button onClick={() => setStep("guide")}>
              그림 보고 다시 촬영하기
            </Button>
            <Button
              variant="secondary"
              onClick={openCamera}
            >
              바로 다시 촬영
            </Button>
          </DiagnosisPageActions>
        </>
      )}

      {step === "guide" && (
        <>
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <h2 className="text-2xl font-bold text-cropy-text-primary lg:text-3xl">
                추가 사진은 이렇게 찍어주세요
              </h2>
              <p className="break-keep text-base leading-7 text-cropy-text-secondary">
                크게, 밝게, 흔들리지 않게 찍어주세요.
              </p>
            </div>
            <Mascot name="retake" size={64} className="lg:size-20" />
          </header>

          <Card radius="lg" padding="lg" className="space-y-2">
            <h3 className="text-lg font-bold text-cropy-text-primary">이번 추가 촬영 부위: {guidance.region}</h3>
            <p className="break-keep text-base leading-7 text-cropy-text-secondary">
              {guidance.instruction}
            </p>
          </Card>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card radius="lg" padding="lg" className="space-y-3">
              <p className="font-bold text-cropy-text-primary">01 · 잎이 화면을 채우게</p>
              <div className="flex items-center justify-center gap-6 rounded-xl bg-cropy-surface-canvas py-5">
                <span aria-hidden className="icon-[lucide--leaf] size-6 text-cropy-text-secondary" />
                <span aria-hidden className="icon-[lucide--arrow-right] size-5 text-cropy-text-secondary" />
                <span aria-hidden className="icon-[lucide--leaf] size-14 text-cropy-action-primary" />
              </div>
              <p className="text-sm leading-6 text-cropy-text-secondary">
                병반이 있는 부위와 주변 잎을 화면에 크게 담아주세요.
              </p>
            </Card>
            <Card radius="lg" padding="lg" className="space-y-3">
              <p className="font-bold text-cropy-text-primary">02 · 색과 무늬가 보이게</p>
              <div className="flex items-center justify-center gap-6 rounded-xl bg-cropy-surface-canvas py-5">
                <span aria-hidden className="icon-[lucide--sun] size-10 text-cropy-text-secondary" />
                <span aria-hidden className="icon-[lucide--leaf] size-14 text-cropy-action-primary" />
              </div>
              <p className="text-sm leading-6 text-cropy-text-secondary">
                밝은 그늘에서 촬영하고 강한 빛 반사와 그림자를 피해 주세요.
              </p>
            </Card>
            <Card radius="lg" padding="lg" className="space-y-3">
              <p className="font-bold text-cropy-text-primary">03 · 초점을 맞춘 뒤 촬영</p>
              <div className="flex items-center justify-center gap-6 rounded-xl bg-cropy-surface-canvas py-5">
                <span aria-hidden className="icon-[lucide--focus] size-10 text-cropy-text-secondary" />
                <span aria-hidden className="icon-[lucide--leaf] size-14 text-cropy-action-primary" />
              </div>
              <p className="text-sm leading-6 text-cropy-text-secondary">
                촬영 전에 잎의 반점에 초점을 맞추고 흔들리지 않게 찍어주세요.
              </p>
            </Card>
          </div>
          <DiagnosisPageActions visible={actionsVisible}>
            <Button onClick={openCamera} disabled={loading}>
              {guidance.region} 다시 촬영
            </Button>
            <Button
              variant="secondary"
              onClick={() => galleryRef.current?.click()}
              disabled={loading}
            >
              갤러리에서 선택
            </Button>
          </DiagnosisPageActions>
          <button
            type="button"
            className="self-start text-sm font-semibold text-cropy-text-secondary underline-offset-4 hover:underline"
            onClick={() => setStep("candidates")}
          >
            후보 안내로 돌아가기
          </button>
        </>
      )}

      {step === "preview" && selectedFile && (
        <>
          <header className="space-y-2">
            <h2 className="text-2xl font-bold text-cropy-text-primary lg:text-3xl">
              추가 사진을 확인해 주세요
            </h2>
            <p className="text-base text-cropy-text-secondary">
              선택한 사진을 확인한 후 다시 분석할 수 있어요.
            </p>
          </header>
          <Card radius="lg" padding="lg" className="flex flex-col items-center gap-4">
            {previewUrl && (
              <PhotoPreview key={previewUrl} fileName={selectedFile.name}
                src={previewUrl}
                alt="새로 촬영한 작물 사진 미리보기"
                className="max-h-[24rem] w-full rounded-xl object-contain"
              />
            )}
            <p className="max-w-full break-all text-sm text-cropy-text-secondary">
              {selectedFile.name}
            </p>
          </Card>
          {loading && <p role="status" className="text-center text-base text-cropy-text-secondary">재촬영 사진을 분석하고 있어요.</p>}
          <DiagnosisPageActions visible={actionsVisible}>
            <Button
              loading={loading}
              onClick={() => void analyze(selectedFile)}
            >
              {loading ? "재분석 중…" : "이 사진으로 다시 분석"}
            </Button>
            <Button
              variant="secondary"
              onClick={openCamera}
              disabled={loading}
            >
              다시 촬영하기
            </Button>
          </DiagnosisPageActions>
          <button
            type="button"
            disabled={loading}
            className="self-start text-sm font-semibold text-cropy-text-secondary underline-offset-4 hover:underline disabled:opacity-50"
            onClick={() => galleryRef.current?.click()}
          >
            다른 사진을 갤러리에서 선택
          </button>
        </>
      )}

      {step === "failure" && (
        <DiagnosisFailurePanel
          message={error}
          loading={loading}
          onRetry={() => void analyze(selectedFile)}
          onPickDifferent={() => galleryRef.current?.click()}
          actionsVisible={actionsVisible}
        />
      )}

      {error && step !== "failure" && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}

      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
          onCaptureError={setError}
          onGallery={handleCameraGallery}
          notice={null}
        />
      )}

      <input
        ref={cameraRef}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        onChange={handleFileChange}
        disabled={loading}
        aria-label="카메라로 추가 촬영"
        className="sr-only"
        tabIndex={-1}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={PHOTO_ACCEPT}
        onChange={handleFileChange}
        disabled={loading}
        aria-label="갤러리에서 추가 사진 선택"
        className="sr-only"
        tabIndex={-1}
      />
    </section>
  );
}
