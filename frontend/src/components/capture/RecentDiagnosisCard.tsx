"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { cardClassName } from "@/components/Card";
import { fetchHistory } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { DiagnosisSummary, Severity } from "@/types/diagnosis";

/** "고추 탄저병" → "고추 · 탄저병". 병해명이 작물로 시작하지 않으면 앞에 붙인다 */
export function recentLabel({ crop_type: crop, disease_name: name }: DiagnosisSummary) {
  if (!crop) return name;
  if (name.startsWith(`${crop} `)) return `${crop} · ${name.slice(crop.length + 1)}`;
  return `${crop} · ${name}`;
}

/** "2026.10.06 · 14:18". 날짜를 읽지 못하면 null */
export function recentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} · ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

// 등급 배지. 위험·주의는 같은 색이고 라벨로 구분한다 (디자인 시스템 Badge/Status)
const SEVERITY: Record<Severity, { label: string; tone: "attention" | "low" }> = {
  high: { label: "위험", tone: "attention" },
  medium: { label: "주의", tone: "attention" },
  low: { label: "낮음", tone: "low" },
};

/**
 * 가장 최근 진단 기록 한 건. 마운트할 때와 reloadKey 가 바뀔 때(새 진단)만 받는다
 * (화면 상태가 바뀔 때마다 다시 받으면 카드가 사라졌다 나타난다).
 * 다시 받는 동안에는 이전 기록을 그대로 보여준다. 기록이 없거나 불러오지 못하면 null 이다.
 */
export function useRecentDiagnosis(reloadKey = 0) {
  const [item, setItem] = useState<DiagnosisSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchHistory(1, 1, undefined, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setItem(data.items[0] ?? null);
      })
      .catch(() => {
        // 연결이 끊겼거나 서버 오류: 카드를 숨긴 채 둔다 (촬영을 막을 이유가 아니다)
      });
    return () => controller.abort();
  }, [reloadKey]);

  return item;
}

interface RecentDiagnosisCardProps {
  item: DiagnosisSummary;
  /** 데스크탑 시안(Recent/LatestRecord): 사진·날짜·등급·"기록 보기"가 한 줄에 놓인다 */
  desktop?: boolean;
}

/**
 * 촬영 화면의 "최근 진단" 카드. 카드 전체가 기록 상세로 가는 링크다.
 * 모바일(Recent/Record): 높이 72px 이상·모서리 16px·안쪽 좌우 16px·상하 12px, "고추 · 탄저병"과 "보기".
 * 데스크탑(Recent/LatestRecord): 안쪽 20px·간격 16px, 사진 56px, 병해명 16/24px, 날짜 14/22px,
 * 등급 배지, 96×48px "기록 보기".
 */
export function RecentDiagnosisCard({ item, desktop = false }: RecentDiagnosisCardProps) {
  const label = recentLabel(item);

  if (desktop) {
    const date = recentDate(item.created_at);
    const severity = item.severity ? SEVERITY[item.severity] : null;
    return (
      <Link
        href={`/history/${encodeURIComponent(item.id)}`}
        // aria-label 이 안의 글자를 덮으므로 화면에 보이는 날짜·등급도 넣는다
        aria-label={[`최근 진단 ${label}`, date, severity && `${severity.label} 등급`, "기록 보기"]
          .filter(Boolean)
          .join(", ")}
        className={cn(
          cardClassName({ interactive: true, padding: "none" }),
          "flex items-center gap-4 p-5",
        )}
      >
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cropy-surface-canvas">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- 서버가 준 기록 사진 썸네일
            <img src={item.image_url} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <span aria-hidden className="icon-[lucide--leaf] size-8 text-cropy-action-primary" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-cropy-label-xs font-medium text-cropy-text-secondary">
            최근 진단
          </span>
          <span className="break-keep text-cropy-body-lg font-bold text-cropy-text-primary">
            {item.disease_name}
          </span>
        </span>
        {date && (
          <span className="w-[10.5rem] shrink-0 text-cropy-helper text-cropy-text-secondary">
            {date}
          </span>
        )}
        {severity && (
          <Badge tone={severity.tone} className="min-h-0 px-2.5 py-1 font-medium">
            {severity.label}
          </Badge>
        )}
        {/* 링크 안이라 버튼 모양만 빌린다 (누르는 대상은 카드 전체) */}
        <span
          aria-hidden
          className={cn(buttonClassName({ variant: "secondary" }), "w-24 shrink-0")}
        >
          기록 보기
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/history/${encodeURIComponent(item.id)}`}
      aria-label={`최근 진단 ${label} 보기`}
      className={cn(
        cardClassName({ interactive: true, padding: "none" }),
        "flex min-h-[4.5rem] items-center gap-3 px-4 py-3",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-cropy-label-xs font-medium text-cropy-text-secondary">최근 진단</span>
        <span className="break-keep text-cropy-feedback-body font-bold leading-6 text-cropy-text-primary">
          {label}
        </span>
      </span>
      {/* Figma 는 green-600 이지만 13px 글자로는 흰 바탕 대비가 4.25:1 이라 한 단계 진한 색을 쓴다 */}
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center text-cropy-caption font-bold text-cropy-action-hover"
      >
        보기
      </span>
    </Link>
  );
}
