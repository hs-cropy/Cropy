
import Link from "next/link";

import {
  Button,
  buttonClassName,
} from "@/components/Button";

interface HistoryEmptyStateProps {
  mode: "no-history" | "filtered";
  cropLabel?: string;
  gradeLabel?: string;
  onResetFilters: () => void;
  onResetGrade?: () => void;
}

export function HistoryEmptyState({
  mode,
  cropLabel,
  gradeLabel,
  onResetFilters,
  onResetGrade,
}: HistoryEmptyStateProps) {
  // 1. 저장된 기록 자체가 없을 때
  if (mode === "no-history") {
    return (
      <div className="rounded-2xl border border-cropy-border bg-cropy-surface p-6 text-center shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mobile-prototype/assets/5912e.png"
          alt=""
          aria-hidden="true"
          className="mx-auto h-24 w-24 object-contain"
        />

        <h2 className="mt-4 text-cropy-heading-lg text-cropy-text-primary">
          아직 진단 이력이 없어요
        </h2>

        <p className="mt-3 text-cropy-feedback-body text-cropy-text-secondary">
          첫 사진을 찍으면 진단 결과가 여기에 저장됩니다.
        </p>

        <Link
          href="/"
          className={[
            buttonClassName({
              variant: "primary",
              size: "default",
              fullWidth: true,
            }),
            "mt-6",
          ].join(" ")}
        >
          <span className="min-w-0">
            첫 진단 시작하기
          </span>
        </Link>
      </div>
    );
  }

  // 2. 이력은 있지만 현재 필터 결과가 없을 때
  const title =
    gradeLabel && gradeLabel !== "전체"
      ? `${cropLabel ?? "선택한 작물"}·${gradeLabel} 등급의 기록이 없어요`
      : `${cropLabel ?? "선택한 작물"} 기록이 없어요`;

  const buttonLabel =
    gradeLabel && gradeLabel !== "전체"
      ? "전체 등급 보기"
      : "전체 이력 보기";

  const handleClick =
    gradeLabel && gradeLabel !== "전체" && onResetGrade
      ? onResetGrade
      : onResetFilters;

  return (
    <div className="rounded-2xl border border-cropy-border bg-cropy-surface shadow-sm">
      <div className="flex min-h-[9.75rem] flex-col items-center justify-center px-6 py-10 text-center lg:min-h-[8.125rem] lg:px-8">
        <h2 className="text-cropy-heading-md text-cropy-text-primary">
          {title}
        </h2>

        <Button
          type="button"
          variant="secondary"
          size="default"
          onClick={handleClick}
          className="mt-5 min-w-[11rem]"
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
