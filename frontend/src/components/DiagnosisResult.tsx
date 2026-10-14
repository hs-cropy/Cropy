
"use client";

import type {
  DiagnoseResponse,
  Severity,
} from "@/types/diagnosis";

import { SaveRecovery } from "./SaveRecovery";
import { DiagnosisDetails } from "./diagnosis/DiagnosisDetails";

import { CropMismatchNotice } from "./CropMismatchNotice";

interface Props {
  result: DiagnoseResponse;
  onSaved?: (result: DiagnoseResponse) => void;
  isRecord?: boolean;
}

// 위험 등급과 AI 신뢰도는 별도의 정보로 표시
const SEVERITY: Record<
  Severity,
  { label: string; text: string; bg: string; dot: string }
> = {
  high: {
    label: "위험",
    text: "text-signal-high-ink",
    bg: "bg-signal-high-tint",
    dot: "bg-signal-high",
  },
  medium: {
    label: "주의",
    text: "text-signal-med-ink",
    bg: "bg-signal-med-tint",
    dot: "bg-signal-med",
  },
  low: {
    label: "낮음",
    text: "text-signal-low-ink",
    bg: "bg-signal-low-tint",
    dot: "bg-signal-low",
  },
};

// 촬영 이미지 공통 표시
function Shot({
  src,
  alt,
  label,
  accent = false,
}: {
  src: string;
  alt: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl bg-[#EDF7F1]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="h-36 w-full object-cover"
      />

      <figcaption
        className={`px-3 py-2 text-sm font-bold ${
          accent
            ? "text-[#2E8B57]"
            : "text-[#6B6B6B]"
        }`}
      >
        {label}
      </figcaption>
    </figure>
  );
}

export function DiagnosisResult({
  result,
  onSaved,
  isRecord = false,
}: Props) {
  const isHealthy = result.category === "normal";

  const severity = SEVERITY[
    result.severity ?? "medium"
  ];

  const pct = Math.round(result.confidence * 100);

  // 재촬영한 사진까지 있는지 확인
  const isRefined = Boolean(
    result.image_url && result.refined_image_url
  );

  // 백엔드 판단 사유를 기준으로 낮은 신뢰도 판정
  const isUncertain =
    result.decision_reasons?.includes("low_confidence") ??
    false;

  return (
    <div className="space-y-5">

      {/* ==================================
          저장 상태 및 재시도
         ================================== */}
      <SaveRecovery
        result={result}
        onSaved={onSaved}
      />

      {/* 브라우저 진단 출처 */}
      {result.prediction_mode === "browser" && (
        <p
          role="status"
          className="rounded-xl bg-[#EDF7F1] p-4 text-base leading-6 text-[#191919]"
        >
          브라우저에서 생성해 동기화한 결과예요.
          서버에서 사진을 다시 분석한 결과는 아닙니다.
        </p>
      )}

      {/* 과거 저장 기록 안내 */}
      {isRecord && (
        <p
          role="status"
          className="rounded-xl bg-[#EDF7F1] p-4 text-base leading-6 text-[#191919]"
        >
          {result.content_status === "snapshot"
            ? "저장 당시의 결과와 관리 안내예요. 현재 상태는 새 사진으로 확인하세요."
            : "이전 기록에는 당시 안내가 없어 현재 참고 안내를 표시해요."}
        </p>
      )}

      {/* 시연용 모드 */}
      {result.prediction_mode === "mock" && (
        <p
          role="status"
          className="rounded-xl bg-signal-med-tint p-4 text-base leading-6 text-signal-med-ink"
        >
          시연용 예시 결과입니다.
          업로드한 사진의 실제 진단 결과가 아닙니다.
        </p>
      )}

      {/* 작물 불일치 안내 */}
      <CropMismatchNotice result={result} />

      {/* ==================================
          진단 결과 요약 카드
         ================================== */}
      <section className="overflow-hidden rounded-2xl border border-[#ECECEF] bg-white shadow-sm">

        {/* 위험 등급 */}
        <div
          className={`flex flex-wrap items-center gap-2 px-5 py-3 ${
            isHealthy
              ? "bg-signal-low-tint"
              : severity.bg
          }`}
        >
          {isHealthy ? (
            <>
              <span
                aria-hidden="true"
                className="icon-[lucide--circle-check] h-5 w-5 text-signal-low-ink"
              />

              <span className="text-base font-bold text-signal-low-ink">
                {isUncertain
                  ? "정상 여부가 확실하지 않아요"
                  : "정상으로 분류됐어요"}
              </span>
            </>
          ) : (
            <>
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-full ${severity.dot}`}
              />

              <span
                className={`text-base font-bold ${severity.text}`}
              >
                {severity.label}
              </span>
            </>
          )}

          {/* 재촬영한 결과 표시 */}
          {isRefined && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-[#2E8B57]">
              <span
                aria-hidden="true"
                className="icon-[lucide--scan-search] h-4 w-4"
              />
              사진 2장 분석
            </span>
          )}
        </div>

        <div className="p-5">

          {/* 촬영 이미지 */}
          {isRefined ? (
            <div className="mb-5">
              <div className="grid grid-cols-2 gap-3">
                <Shot
                  src={result.image_url!}
                  alt="처음 촬영한 작물"
                  label="1차 촬영"
                />

                <Shot
                  src={result.refined_image_url!}
                  alt="판별부위를 다시 촬영한 사진"
                  label="판별부위 재촬영"
                  accent
                />
              </div>

              {/* 재촬영 분석 안내 */}
              <p
                className={`mt-3 flex items-start gap-2 rounded-xl p-3 text-sm leading-6 ${
                  isUncertain
                    ? "bg-signal-med-tint text-signal-med-ink"
                    : "bg-[#EDF7F1] text-[#26784B]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1 h-4 w-4 shrink-0 ${
                    isUncertain
                      ? "icon-[lucide--circle-alert]"
                      : "icon-[lucide--layers]"
                  }`}
                />

                {isUncertain
                  ? "두 장의 사진을 함께 분석했지만 아직 결과가 확실하지 않아요. 병징이 뚜렷한 부위를 다시 확인해 주세요."
                  : "판별부위 사진까지 함께 분석한 결과예요."}
              </p>
            </div>
          ) : (
            result.image_url && (
              <div className="mb-5 overflow-hidden rounded-2xl bg-[#EDF7F1]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.image_url}
                  alt="진단한 작물"
                  className="h-48 w-full object-cover"
                />
              </div>
            )
          )}

          {/* 작물 */}
          {result.crop_type && (
            <p className="text-sm font-semibold text-[#6B6B6B]">
              {result.crop_type}
            </p>
          )}

          {/* 병해 이름 */}
          <h2 className="mt-2 text-2xl font-extrabold leading-8 tracking-tight text-[#191919]">
            {result.disease_name}
          </h2>

          {/* 모델 신뢰도 */}
          <div className="mt-5">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-base font-semibold text-[#6B6B6B]">
                AI 진단 신뢰도
              </span>

              <span className="tnum text-2xl font-extrabold text-[#191919]">
                {pct}%
              </span>
            </div>

            <div
              role="progressbar"
              aria-label="AI 진단 신뢰도"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-3 overflow-hidden rounded-full bg-[#EDF7F1]"
            >
              <div
                className="h-full rounded-full bg-[#2E8B57]"
                style={{
                  width: `${Math.max(0, Math.min(100, pct))}%`,
                }}
              />
            </div>

            {/* 낮은 신뢰도 안내 */}
            {isUncertain && (
              <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-signal-med-ink">
                <span
                  aria-hidden="true"
                  className="icon-[lucide--circle-alert] mt-1 h-4 w-4 shrink-0"
                />

                <span>
                  사진만으로는 확실하지 않아요.
                  병징이 잘 보이는 사진으로 다시 확인하고,
                  방제 전에 가까운 농업기술센터에 문의해 보세요.
                </span>
              </p>
            )}
          </div>

          {/* 다른 진단 후보 */}
          {result.top_predictions.length > 1 && (
            <div className="mt-5 border-t border-[#ECECEF] pt-4">
              <h3 className="mb-3 text-base font-bold text-[#191919]">
                그 밖의 가능성
              </h3>

              <div className="flex flex-wrap gap-2">
                {result.top_predictions.slice(1).map((p) => (
                  <span
                    key={p.name}
                    className="rounded-lg bg-[#F7F7F8] px-3 py-2 text-sm text-[#6B6B6B]"
                  >
                    {p.name}
                    {" · "}
                    {Math.round(p.confidence * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ==================================
          현재 또는 저장 당시 관리 안내
         ================================== */}
      {!!result.management_actions?.length && (
        <section className="rounded-2xl border border-[#ECECEF] bg-white p-5">
          <h2 className="text-xl font-extrabold text-[#191919]">
            {isRecord
              ? "진단 당시 관리 안내"
              : "지금 해야 할 일"}
          </h2>

          <ol className="mt-4 space-y-4">
            {result.management_actions.map(
              (action, index) => (
                <li
                  key={index}
                  className="flex items-start gap-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EDF7F1] text-sm font-bold text-[#2E8B57]">
                    {index + 1}
                  </span>

                  <p className="pt-0.5 text-base leading-7 text-[#191919]">
                    {action}
                  </p>
                </li>
              )
            )}
          </ol>
        </section>
      )}

      {/* ==================================
          06번 피그마 상세 정보 아코디언
         ================================== */}
      <DiagnosisDetails
        result={result}
        isRecord={isRecord}
      />
    </div>
  );
}
