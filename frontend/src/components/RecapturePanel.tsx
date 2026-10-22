"use client";

import { useRef, useState, type ChangeEvent } from "react";

import { isCameraSupported, PHOTO_ACCEPT } from "@/features/camera";
import { useVoiceGuide } from "@/features/voice";
import type { RecaptureGuidance } from "@/types/diagnosis";
import { Button } from "@/components/Button";
import { DiagnosisPageActions } from "@/components/DiagnosisPageActions";
import { Card } from "@/components/Card";
import { Mascot } from "@/components/Mascot";
import type { PhotoSource } from "@/components/capture/CaptureScreen";
import { CAPTURE_PATH, useDiagnosisSession } from "@/components/diagnosis/DiagnosisSession";
import { CaseFeedback } from "@/features/feedback/CaseFeedback";
import type { FeedbackCaseId } from "@/features/feedback/cases";

interface Props {
  diagnosisId: string;
  guidance: RecaptureGuidance;
  /** 추가 촬영을 취소하면 돌아올 이 화면의 경로 (진단 결과·이력 상세) */
  origin: string;
  /** CSS로 숨겨진 진단 탭에서는 고정 버튼도 숨긴다. */
  actionsVisible?: boolean;
}

type Step = "candidates" | "guide";

function objectParticle(value: string): string {
  const word = value.trim();
  if (!word) return "을(를)";
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return "을(를)";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

/**
 * 후보 혼동 결과의 재촬영 안내 (후보·촬영 방법). 다시 촬영·갤러리로 고른 사진은 촬영 화면(/)의
 * 카메라·사진 확인에서 보고, "이 사진으로 다시 분석"으로 이 진단을 다시 분석한다 (추가 촬영)
 */
export function RecapturePanel({
  diagnosisId,
  guidance,
  origin,
  actionsVisible = true,
}: Props) {
  const session = useDiagnosisSession();
  const { prime: primeSpeech } = useVoiceGuide();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("candidates");
  // 고른 사진을 쓸 수 없을 때의 안내 (Figma 지속형 안내의 케이스 ID)
  const [failure, setFailure] = useState<FeedbackCaseId | null>(null);

  const target = { id: diagnosisId, guidance, origin };

  /** 고른 사진을 이 진단의 추가 사진으로 두고 촬영 화면의 사진 확인으로 간다 */
  const pick = (file: File, source: PhotoSource) => {
    // 다른 진단이 분석 중이면 사진을 받지 않는다 (버튼도 막혀 있다)
    if (session.loading) return;
    const rejected = session.selectFile(file, source, target);
    setFailure(rejected);
    if (!rejected) session.navigate(CAPTURE_PATH, "focus");
  };

  const handleFileChange = (source: PhotoSource) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) pick(file, source);
  };

  /** 다시 촬영: 촬영 화면에서 카메라를 켠다. 브라우저 카메라를 못 쓰면 기기 카메라를 이 클릭 안에서 연다 */
  const openCamera = () => {
    if (session.loading) return;
    if (!isCameraSupported()) {
      cameraRef.current?.click();
      return;
    }
    primeSpeech();
    session.startRefine(target);
    session.navigate(CAPTURE_PATH, "camera");
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
                후보를 구분하기 위해 같은 잎의 특정 부위를 한 장 더 찍어주세요.
              </p>
            </div>
            <Mascot name="comparing" size={64} className="lg:size-20" />
          </header>

          <div className="grid gap-4 lg:grid-cols-2 lg:gap-8 xl:grid-cols-[minmax(0,440px)_minmax(0,728px)] xl:max-w-[1200px]">
            <Card radius="lg" padding="lg" className="lg:min-h-[314px] lg:p-6">
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

            <Card radius="lg" padding="lg" className="flex flex-col gap-4 lg:min-h-[314px] lg:p-6">
              <h3 className="text-lg font-bold text-cropy-text-primary">
                이번엔 {guidance.region}{objectParticle(guidance.region)} 찍어주세요
              </h3>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl bg-cropy-surface-canvas px-4 py-4 lg:flex-1 lg:py-0">
                <div className="flex flex-col items-center gap-2">
                  <img
                    src="/guide/leaf.svg"
                    alt=""
                    aria-hidden="true"
                    className="size-20 object-contain lg:size-[136px]"
                  />
                  <span className="text-sm font-semibold text-cropy-text-secondary">
                    앞면
                  </span>
                </div>

                <span
                  aria-hidden="true"
                  className="icon-[lucide--rotate-cw] size-6 text-cropy-text-secondary"
                />

                <div className="flex flex-col items-center gap-2">
                  <img
                    src="/guide/leaf-underside.svg"
                    alt=""
                    aria-hidden="true"
                    className="size-20 object-contain lg:size-[136px]"
                  />
                  <span className="text-sm font-semibold text-cropy-action-primary">
                    뒷면
                  </span>
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
              disabled={session.loading}
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
                크기·밝기·초점, 세 가지만 확인해보세요.
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
              <p className="font-bold text-cropy-text-primary">
                01 · 잎이 화면을 채우게
              </p>
              <p className="text-sm leading-6 text-cropy-text-secondary">
                반점과 주변 잎이 함께 보이게 가까이 대세요.
                잎이 틀 안에 크게 들어오면 좋아요.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-cropy-surface-canvas">
                    <img
                      src="/guide/leaf-small.svg"
                      alt=""
                      className="h-1/3 w-1/3 object-contain"
                    />
                    <img
                      src="/guide/frame.svg"
                      alt=""
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    />
                  </div>
                  <p className="text-center text-xs text-cropy-text-primary/57">
                    너무 멀어요
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-cropy-surface-canvas">
                    <img
                      src="/guide/leaf.svg"
                      alt=""
                      className="h-3/4 w-3/4 object-contain"
                    />
                    <img
                      src="/guide/frame.svg"
                      alt=""
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    />
                  </div>
                  <p className="text-center text-xs font-semibold text-cropy-action-primary">
                    이 정도로 크게
                  </p>
                </div>
              </div>
            </Card>
            <Card radius="lg" padding="lg" className="space-y-3">
              <p className="font-bold text-cropy-text-primary">
                02 · 색과 무늬가 보이게
              </p>

              <p className="text-sm leading-6 text-cropy-text-secondary">
                밝은 그늘이나 창가에서 찍어주세요.
                검은 그림자와 하얀 빛 반사를 피해 주세요.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-cropy-surface-canvas">
                    <img
                      src="/guide/leaf.svg"
                      alt=""
                      className="h-3/4 w-3/4 object-contain"
                    />

                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 bg-black/50"
                    />
                  </div>

                  <p className="text-center text-xs text-cropy-text-primary/57">
                    어두워 안 보여요
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-cropy-surface-canvas">
                    <img
                      src="/guide/leaf.svg"
                      alt=""
                      className="h-3/4 w-3/4 object-contain"
                    />
                    <img
                      src="/guide/frame.svg"
                      alt=""
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    />
                  </div>

                  <p className="text-center text-xs font-semibold text-cropy-action-primary">
                    색이 잘 보여요
                  </p>
                </div>
              </div>
            </Card>
            <Card radius="lg" padding="lg" className="space-y-3">
              <p className="font-bold text-cropy-text-primary">
                03 · 반점의 경계가 선명하게
              </p>

              <p className="text-sm leading-6 text-cropy-text-secondary">
                카메라 초점을 맞춘 뒤 흔들리지 않게 찍어주세요.
                사진을 올릴 때도 반점의 경계를 확인하세요.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-cropy-surface-canvas">
                    <img
                      src="/guide/leaf-blurred.svg"
                      alt=""
                      className="h-3/4 w-3/4 object-contain"
                    />
                  </div>

                  <p className="text-center text-xs text-cropy-text-primary/57">
                    흔들려 흐려요
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-cropy-surface-canvas">
                    <img
                      src="/guide/leaf.svg"
                      alt=""
                      className="h-3/4 w-3/4 object-contain"
                    />
                    <img
                      src="/guide/frame.svg"
                      alt=""
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    />
                  </div>

                  <p className="text-center text-xs font-semibold text-cropy-action-primary">
                    경계가 선명해요
                  </p>
                </div>
              </div>
            </Card>
          </div>
          <DiagnosisPageActions visible={actionsVisible}>
            <Button onClick={openCamera} disabled={session.loading}>
              {guidance.region} 다시 촬영
            </Button>
            <Button
              variant="secondary"
              onClick={() => galleryRef.current?.click()}
              disabled={session.loading}
            >
              갤러리에서 선택
            </Button>
          </DiagnosisPageActions>
          <button
            type="button"
            className="self-start text-sm font-semibold text-cropy-text-secondary underline-offset-4 hover:underline"
            onClick={() => {
              setFailure(null);
              setStep("candidates");
            }}
          >
            후보 안내로 돌아가기
          </button>
        </>
      )}

      {/* 고른 사진을 쓸 수 없을 때 (Figma 지속형 안내) */}
      {failure && (
        <CaseFeedback
          caseId={failure}
          headingLevel={3}
          className="mx-auto lg:max-w-[30rem]"
          onPrimary={() => galleryRef.current?.click()}
        />
      )}

      <input
        ref={cameraRef}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        onChange={handleFileChange("camera")}
        aria-label="카메라로 추가 촬영"
        className="sr-only"
        tabIndex={-1}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={PHOTO_ACCEPT}
        onChange={handleFileChange("gallery")}
        aria-label="갤러리에서 추가 사진 선택"
        className="sr-only"
        tabIndex={-1}
      />
    </section>
  );
}
