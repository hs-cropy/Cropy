"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/Badge";
import { cardClassName } from "@/components/Card";
import { CropMismatchNotice } from "@/components/CropMismatchNotice";
import { SaveRecovery } from "@/components/SaveRecovery";
import { recentDate } from "@/components/capture/RecentDiagnosisCard";
import { cn } from "@/lib/cn";
import type { DiagnoseResponse, Severity } from "@/types/diagnosis";
import { DiagnosisDetails } from "./DiagnosisDetails";

// 값이 없을 때 (Figma 개발 가이드: 누락된 값은 확인 불가로 표시한다)
const MISSING = "확인 불가";

// 위험 등급 배지. 위험·주의는 같은 색이고 라벨로 구분한다 (디자인 시스템 Badge/Status)
const SEVERITY: Record<Severity, { label: string; tone: "attention" | "low" }> = {
  high: { label: "위험", tone: "attention" },
  medium: { label: "주의", tone: "attention" },
  low: { label: "낮음", tone: "low" },
};

/** 등급 라벨과 색. 정상 판정이면 "정상", 등급이 없으면 null */
export function gradeOf(result: DiagnoseResponse) {
  // 백엔드가 정상을 "healthy" 로 줄 때도 있다 (features/voice/lib/prompts.ts)
  const category: string | undefined = result.category;
  if (category === "normal" || category === "healthy") {
    return { label: "정상", tone: "low" as const };
  }
  return result.severity ? SEVERITY[result.severity] : null;
}

/** "2026년 10월 6일 오후 2:18에 확인한 결과예요." 날짜를 읽지 못하면 null */
export function resultTimeSentence(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${period} ${hour12}:${minutes}에 확인한 결과예요.`;
}

function percent(confidence: number) {
  return Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : MISSING;
}

/** 진단에 쓴 사진. 서버에 저장된 사진이 없으면 고른 사진의 미리보기를 쓴다 */
function photoOf(result: DiagnoseResponse, fallback: string | null) {
  return result.image_url ?? fallback;
}

// 위험 등급과 AI 신뢰도는 서로 다른 개념이라 함께 두되 따로 읽힌다
function GradeBadge({ result, desktop }: { result: DiagnoseResponse; desktop: boolean }) {
  const grade = gradeOf(result);
  if (!grade) return null;
  return (
    <Badge tone={grade.tone} variant={desktop ? "cell" : "pill"}>
      <span className="sr-only">위험 등급 </span>
      {grade.label}
    </Badge>
  );
}

/** 저장 상태·시연·출처 안내. 결과 카드보다 먼저 읽혀야 하는 상태라 위에 둔다 */
function Notices({
  result,
  onSaved,
}: {
  result: DiagnoseResponse;
  onSaved?: (result: DiagnoseResponse) => void;
}) {
  return (
    <>
      <SaveRecovery result={result} onSaved={onSaved} />
      {result.prediction_mode === "browser" && (
        <p
          role="status"
          className="rounded-xl bg-cropy-action-subtle p-4 text-cropy-body-lg text-cropy-text-primary"
        >
          브라우저에서 생성해 동기화한 결과예요. 서버에서 사진을 다시 분석한 결과는 아닙니다.
        </p>
      )}
      {result.prediction_mode === "mock" && (
        <p
          role="status"
          className="rounded-xl bg-signal-med-tint p-4 text-cropy-body-lg text-signal-med-ink"
        >
          시연용 예시 결과입니다. 업로드한 사진의 실제 진단 결과가 아닙니다.
        </p>
      )}
      {result.recapture && result.save_status !== "saved" && (
        <div
          role="status"
          className="rounded-xl border border-cropy-border bg-cropy-action-subtle p-4"
        >
          <p className="font-semibold text-cropy-text-primary">추가 촬영 안내가 있어요</p>
          <p className="mt-2 text-cropy-body-lg leading-6 text-cropy-text-secondary">
            현재 진단 결과를 저장한 뒤 재촬영을 진행할 수 있어요.
          </p>
        </div>
      )}
      <CropMismatchNotice result={result} />
    </>
  );
}

/** 저장은 됐지만 신뢰도가 낮다고 판단된 결과의 안내 (예외 화면으로 가지 않은 경우) */
function UncertainNote({ result }: { result: DiagnoseResponse }) {
  if (!result.decision_reasons?.includes("low_confidence")) return null;
  return (
    <p className="flex items-start gap-2 break-keep text-cropy-caption text-signal-med-ink">
      <span aria-hidden className="icon-[lucide--circle-alert] mt-0.5 size-4 shrink-0" />
      사진만으로는 확실하지 않아요. 병징이 잘 보이는 사진으로 다시 확인하고, 방제 전에 가까운
      농업기술센터에 문의해 보세요.
    </p>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-[4.75rem] shrink-0 text-cropy-caption text-cropy-text-secondary">{label}</dt>
      <dd className="tnum min-w-0 flex-1 break-keep text-right text-cropy-helper font-bold text-cropy-text-primary">
        {children}
      </dd>
    </div>
  );
}

interface DiagnosisResultViewProps {
  result: DiagnoseResponse;
  /** 서버에 저장된 사진이 없을 때 보일 고른 사진의 미리보기 */
  photo: string | null;
  onSaved?: (result: DiagnoseResponse) => void;
  /** 모바일 본문 끝의 "새 사진으로 진단하기" (데스크탑은 화면 아래 행동 영역의 "새 진단") */
  onNewDiagnosis: () => void;
  desktop?: boolean;
}

/**
 * 진단 결과 (모바일 M-03 · 데스크탑 D-03). 화면의 모든 값은 같은 분석 응답에서 온다.
 * 모바일: 요약 카드(모서리 20px·안쪽 16px, 썸네일 68px, 병해 24/32px, 등급 배지·신뢰도),
 * "지금 해야 할 일" 카드(18/26px, 번호 28px 원), 상세 정보, 본문 안의 "새 사진으로 진단하기".
 * 데스크탑: 왼쪽 320px 카드(사진 208px·작물·진단 시각·등급·AI 신뢰도·안내)와 오른쪽(병해 28/36px·
 * 등급 72px 배지, 3열 할 일, 상세 정보)을 32px 간격으로 둔다.
 * 이력 상세는 DiagnosisResult 를 그대로 쓴다.
 */
export function DiagnosisResultView({
  result,
  photo: fallbackPhoto,
  onSaved,
  onNewDiagnosis,
  desktop = false,
}: DiagnosisResultViewProps) {
  const photo = photoOf(result, fallbackPhoto);
  const actions = result.management_actions ?? [];
  const confidence = percent(result.confidence);

  if (desktop) {
    const grade = gradeOf(result);
    return (
      <div className="flex flex-col gap-5">
        <Notices result={result} onSaved={onSaved} />
        <div className="flex items-start gap-8">
          <section
            aria-label="진단에 사용한 사진과 정보"
            className={cn(
              cardClassName({ padding: "none" }),
              "flex w-80 shrink-0 flex-col gap-4 p-6",
            )}
          >
            <h2 className="text-cropy-body-lg font-bold text-cropy-text-primary">
              진단에 사용한 사진
            </h2>
            <div className="h-52 overflow-hidden rounded-xl bg-cropy-surface-canvas">
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element -- 서버·기기 안의 사진
                <img src={photo} alt="진단한 작물" className="size-full object-cover" />
              )}
            </div>
            <dl className="flex flex-col gap-4">
              <MetaRow label="작물">{result.crop_type || MISSING}</MetaRow>
              <MetaRow label="진단 시각">{recentDate(result.created_at) ?? MISSING}</MetaRow>
              <MetaRow label="등급">{grade?.label ?? MISSING}</MetaRow>
              <MetaRow label="AI 신뢰도">{confidence}</MetaRow>
            </dl>
            <p className="whitespace-pre-line break-keep text-cropy-caption text-cropy-text-secondary">
              {"AI 신뢰도는 참고 값이며\n확정 진단을 의미하지 않습니다."}
            </p>
          </section>

          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <section className={cn(cardClassName({ padding: "none" }), "flex flex-col gap-2 p-5")}>
              <div className="flex items-center gap-4">
                <h2 className="min-w-0 flex-1 break-keep text-[1.75rem] font-bold leading-9 tracking-[-0.015em] text-cropy-text-primary">
                  {result.disease_name}
                </h2>
                <GradeBadge result={result} desktop />
              </div>
              <p className="break-keep text-cropy-helper text-cropy-text-secondary">
                진단 요약을 확인하고, 아래 관리 방법을 참고해주세요.
              </p>
              <UncertainNote result={result} />
            </section>

            {actions.length > 0 && (
              <section
                aria-labelledby="diagnosis-actions-desktop"
                className={cn(cardClassName({ padding: "none" }), "flex flex-col gap-3 p-5")}
              >
                <h2
                  id="diagnosis-actions-desktop"
                  className="text-cropy-feedback-title text-cropy-text-primary"
                >
                  지금 해야 할 일
                </h2>
                <ol className="grid grid-cols-3 gap-3">
                  {actions.map((action, index) => (
                    <li
                      key={index}
                      className="flex gap-2 break-keep rounded-xl bg-cropy-surface-canvas p-3 text-cropy-helper font-bold text-cropy-text-primary"
                    >
                      <span className="tnum shrink-0">{String(index + 1).padStart(2, "0")}</span>
                      <span className="min-w-0">{action}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <DiagnosisDetails result={result} variant="screen" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-5">
      <Notices result={result} onSaved={onSaved} />

      <section
        aria-label="진단 요약"
        className={cn(cardClassName({ radius: "lg", padding: "none" }), "flex flex-col gap-2 p-4")}
      >
        <p className="text-cropy-label-xs font-medium text-cropy-text-secondary">AI 진단 결과</p>
        <div className="flex items-center gap-3">
          <div className="size-[4.25rem] shrink-0 overflow-hidden rounded-2xl border border-cropy-border bg-cropy-surface">
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element -- 서버·기기 안의 사진
              <img src={photo} alt="진단한 작물" className="size-full object-cover" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {result.crop_type && (
              <p className="text-cropy-label-xs font-medium text-cropy-text-secondary">
                {result.crop_type}
              </p>
            )}
            <h2 className="break-keep text-cropy-heading-lg text-cropy-text-primary [overflow-wrap:break-word]">
              {result.disease_name}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <GradeBadge result={result} desktop={false} />
              <p className="text-cropy-label-xs font-medium text-cropy-text-secondary">
                신뢰도 {confidence}
              </p>
            </div>
          </div>
        </div>
        <UncertainNote result={result} />
      </section>

      {actions.length > 0 && (
        <section
          aria-labelledby="diagnosis-actions-mobile"
          className={cn(cardClassName({ padding: "none" }), "flex flex-col gap-2 p-4")}
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="diagnosis-actions-mobile"
              className="text-cropy-feedback-title text-cropy-text-primary"
            >
              지금 해야 할 일
            </h2>
            <p className="shrink-0 text-cropy-label-xs text-cropy-action-primary">
              {actions.length}가지
            </p>
          </div>
          <ol className="flex flex-col gap-1">
            {actions.map((action, index) => (
              <li key={index} className="flex min-h-12 items-center gap-2">
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cropy-action-primary text-cropy-label-xs text-cropy-text-on-action"
                >
                  {index + 1}
                </span>
                <p className="min-w-0 flex-1 break-keep text-[0.9375rem] font-bold leading-6 text-cropy-text-primary [overflow-wrap:break-word]">
                  {action}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <DiagnosisDetails result={result} variant="screen" />

      <button
        type="button"
        onClick={onNewDiagnosis}
        className="flex min-h-11 w-full items-center justify-center rounded-cropy-14 px-4 text-cropy-helper font-medium text-cropy-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary active:bg-cropy-surface-canvas [@media(hover:hover)]:hover:bg-cropy-surface-canvas"
      >
        새 사진으로 진단하기
      </button>
    </div>
  );
}
