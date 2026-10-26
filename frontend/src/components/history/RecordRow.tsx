
import Link from "next/link";

import type { DiagnosisSummary } from "@/types/diagnosis";
import { StatusBadge } from "@/components/history/StatusBadge";

interface RecordRowProps {
  item: DiagnosisSummary;
  onOpen?: () => void;
}

// 모바일에서 사용할 짧은 날짜
function formatHistoryDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "날짜 정보 없음";
  }

  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    const time = new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);

    return `오늘 ${time}`;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(date);
}

// 데스크톱에서 사용할 전체 진단 일시
function formatFullDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "날짜 정보 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function RecordRow({
  item,
  onOpen,
}: RecordRowProps) {
  // 판별 불가는 병해 등급·신뢰도가 없는 결과라 둘 다 "확인 불가"로 둔다
  const notCrop = item.category === "other";
  const confidence = !notCrop && Number.isFinite(item.confidence)
    ? `${Math.round(
        Math.max(0, Math.min(1, item.confidence)) * 100
      )}%`
    : "확인 불가";

  return (
    <li className="min-w-0">
      <Link
        href={`/history/${encodeURIComponent(item.id)}`}
        onClick={onOpen}
        aria-label={`${item.disease_name}, ${item.crop_type || "작물 미확인"}, 진단 상세 보기`}
        className={[
          // 공통
          "group min-w-0 bg-cropy-surface",
          "transition-colors hover:bg-cropy-surface-canvas",
          "focus-visible:outline-2",
          "focus-visible:outline-cropy-action-primary",

          // 모바일: 카드
          "flex min-h-[5.5rem] items-center gap-3",
          "rounded-2xl border border-cropy-border p-4",

          // 데스크톱: 가로형 행
          "lg:grid lg:min-h-[5.5rem]",
          "lg:grid-cols-[minmax(0,2.5fr)_minmax(0,1.3fr)_5.625rem_6.25rem_4.5rem]",
          "lg:items-center lg:gap-x-4",
          "lg:rounded-none lg:border-0",
          "lg:border-b lg:border-cropy-border",
          "lg:px-5 lg:py-3",
        ].join(" ")}
      >
        {/* =================================
            1. 진단 내역
           ================================= */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* 사진 썸네일 */}
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-cropy-surface-canvas">
            {item.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image_url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            {/* 병해명 */}
            <p className="break-words text-cropy-feedback-body font-bold text-cropy-text-primary">
              {item.disease_name}
            </p>

            {/* 모바일: 작물 + 날짜 */}
            <p className="mt-1 text-cropy-caption text-cropy-text-secondary lg:hidden">
              {item.crop_type || "작물 미확인"}
              {" · "}
              {formatHistoryDate(item.created_at)}
            </p>

            {/* 데스크톱: 작물명 */}
            <p className="mt-1 hidden text-cropy-caption text-cropy-text-secondary lg:block">
              {item.crop_type || "작물 미확인"}
            </p>

            {item.is_refined && (
              <p className="mt-1 text-cropy-helper font-semibold text-cropy-action-primary">
                재촬영으로 갱신됨
              </p>
            )}
          </div>
        </div>

        {/* =================================
            2. 진단 일시 - 데스크톱
           ================================= */}
        <span className="hidden text-cropy-helper text-cropy-text-secondary lg:block">
          {formatFullDate(item.created_at)}
        </span>

        {/* =================================
            3. 위험 등급
           ================================= */}
        <div className="flex shrink-0 items-center lg:justify-center">
          {item.severity && !notCrop ? (
            <StatusBadge severity={item.severity} />
          ) : (
            <span className="hidden text-cropy-helper text-cropy-text-secondary lg:inline">
              확인 불가
            </span>
          )}
        </div>

        {/* =================================
            4. AI 신뢰도 - 데스크톱
           ================================= */}
        <span className="hidden text-center text-cropy-helper font-semibold text-cropy-text-primary lg:block">
          {confidence}
        </span>

        {/* =================================
            5. 상세 보기 - 데스크톱
           ================================= */}
        <span
          aria-hidden="true"
          className={[
            "hidden min-h-10 items-center justify-center",
            "rounded-lg border border-cropy-border",
            "bg-cropy-surface px-3 text-cropy-helper font-semibold",
            "text-cropy-text-primary",
            "group-hover:border-cropy-action-primary",
            "group-hover:text-cropy-action-primary",
            "lg:inline-flex",
          ].join(" ")}
        >
          보기
        </span>
      </Link>
    </li>
  );
}
