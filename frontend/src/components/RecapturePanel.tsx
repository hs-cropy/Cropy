
"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { validateImage } from "@/features/camera";
import { refineDiagnosis } from "@/lib/api";

import type {
  DiagnoseResponse,
  RecaptureGuidance,
} from "@/types/diagnosis";

import { AppButton } from "./ui/AppButton";
import { AppCard } from "./ui/AppCard";

interface Props {
  diagnosisId: string;
  guidance: RecaptureGuidance;
  onRefined: (result: DiagnoseResponse) => void;
}

function objectParticle(word: string): string {
  const trimmed = word.trim();

  if (!trimmed) return "을(를)";

  const last = trimmed.charCodeAt(trimmed.length - 1);

  if (last < 0xac00 || last > 0xd7a3) {
    return "을(를)";
  }

  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

export function RecapturePanel({
  diagnosisId,
  guidance,
  onRefined,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  const [guideOpen, setGuideOpen] = useState(false);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => requestRef.current?.abort();
  }, [diagnosisId]);

  const analyze = async (file: File) => {
    if (requestRef.current) return;

    const check = validateImage(file);

    if (!check.ok) {
      setError(check.message);
      return;
    }

    setRetryFile(file);
    setError(null);
    setLoading(true);

    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const refined = await refineDiagnosis(
        diagnosisId,
        file,
        { signal: controller.signal }
      );

      if (controller.signal.aborted) return;

      setRetryFile(null);
      onRefined(refined);
    } catch (err) {
      if (controller.signal.aborted) return;

      setError(
        err instanceof Error
          ? err.message
          : "재확정에 실패했어요. 다시 시도해 주세요."
      );
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleFileChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (file) {
      void analyze(file);
    }
  };

  return (
    <section
      aria-label="추가 촬영 안내"
      className="space-y-4"
    >
      {/* 1. 후보 안내 */}
      <AppCard>
        <div className="mb-4 flex items-center gap-2">
          <span
            aria-hidden
            className="icon-[lucide--scan-search] h-6 w-6 text-[#2E8B57]"
          />
          <h2 className="text-xl font-bold text-[#191919]">
            비슷한 증상이 보여요
          </h2>
        </div>

        <p className="text-base leading-6 text-[#6B6B6B]">
          현재 사진만으로는 병해 후보를 구분하기
          어려워요.
        </p>

        <h3 className="mt-6 text-base font-bold text-[#191919]">
          AI가 비교 중인 후보
        </h3>

        <div className="mt-3 space-y-3">
          {guidance.candidates.map((candidate, index) => (
            <div
              key={candidate.name}
              className="rounded-xl border border-[#ECECEF] p-4"
            >
              <p className="font-semibold text-[#191919]">
                <span className="mr-2 text-[#2E8B57]">
                  후보 {index + 1}
                </span>
                {candidate.name}
              </p>

              <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
                {candidate.cue}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-sm text-[#6B6B6B]">
          위 후보는 아직 확정된 진단이 아니에요.
        </p>
      </AppCard>

      {/* 2. 추가 촬영 부위 */}
      <AppCard>
        <h3 className="text-lg font-bold text-[#191919]">
          이번엔 {guidance.region}
          {objectParticle(guidance.region)} 찍어주세요
        </h3>

        <p className="mt-3 text-base leading-6 text-[#6B6B6B]">
          {guidance.instruction}
        </p>

        <div className="mt-4 rounded-xl bg-[#EDF7F1] p-4">
          <p className="font-semibold text-[#2E8B57]">
            추가 촬영 부위
          </p>
          <p className="mt-1 text-base font-bold text-[#191919]">
            {guidance.region}
          </p>
        </div>
      </AppCard>

      {/* 3. 촬영 방법 */}
      {guideOpen && (
        <AppCard>
          <h3 className="text-lg font-bold text-[#191919]">
            추가 촬영 방법
          </h3>

          <div className="mt-5 space-y-5">
            <div>
              <p className="font-bold text-[#191919]">
                01 · 해당 부위가 크게 보이게
              </p>
              <p className="mt-2 text-base leading-6 text-[#6B6B6B]">
                {guidance.region}와 주변 병징이
                사진에 충분히 크게 보이도록
                가까이 촬영해 주세요.
              </p>
            </div>

            <div className="border-t border-[#ECECEF] pt-5">
              <p className="font-bold text-[#191919]">
                02 · 색과 무늬가 잘 보이게
              </p>
              <p className="mt-2 text-base leading-6 text-[#6B6B6B]">
                밝은 곳에서 그림자와 빛 반사를 피하고,
                초점을 맞춰 촬영해 주세요.
              </p>
            </div>
          </div>
        </AppCard>
      )}

      {/* 4. 오류 및 재시도 */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#D92D20]/20 bg-[#FFF1F0] p-4"
        >
          <p className="font-semibold text-[#D92D20]">
            사진을 분석하지 못했어요
          </p>

          <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
            {error}
          </p>

          {retryFile && (
            <div className="mt-4">
              <AppButton
                disabled={loading}
                loading={loading}
                onClick={() => void analyze(retryFile)}
              >
                같은 사진으로 다시 시도
              </AppButton>
            </div>
          )}
        </div>
      )}

      {/* 5. 행동 버튼 */}
      <div className="space-y-3">
        {!guideOpen ? (
          <>
            <AppButton
              disabled={loading}
              onClick={() => setGuideOpen(true)}
            >
              촬영 방법 보기
            </AppButton>

            <AppButton
              variant="secondary"
              disabled={loading}
              onClick={() => cameraRef.current?.click()}
            >
              바로 다시 촬영
            </AppButton>
          </>
        ) : (
          <>
            <AppButton
              loading={loading}
              onClick={() => cameraRef.current?.click()}
            >
              {guidance.region} 다시 촬영
            </AppButton>

            <AppButton
              variant="secondary"
              disabled={loading}
              onClick={() => galleryRef.current?.click()}
            >
              갤러리에서 선택
            </AppButton>

            <button
              type="button"
              className="min-h-11 w-full text-sm font-semibold text-[#6B6B6B]"
              onClick={() => setGuideOpen(false)}
              disabled={loading}
            >
              후보 안내로 돌아가기
            </button>
          </>
        )}
      </div>

      {/* 실제 파일 입력 */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png"
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
        accept="image/jpeg,image/png"
        onChange={handleFileChange}
        disabled={loading}
        aria-label="갤러리에서 추가 사진 선택"
        className="sr-only"
        tabIndex={-1}
      />
    </section>
  );
}
