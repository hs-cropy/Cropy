import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

// attention: 위험·주의 (디자인 시스템이 두 등급에 같은 색을 쓰고 라벨로 구분한다)
// low: 낮음 / action: 재촬영 (위험 등급이 아니라 분석 상태. 값은 low 와 같고 토큰만 다르다)
type BadgeTone = "attention" | "low" | "action";
// pill: 카드·요약 안의 알약 모양 (Cropy/V2/Badge/Status)
// cell: 데스크탑 이력 테이블의 등급 칸 (화면 값: 폭 72px·모서리 8px·13px)
type BadgeVariant = "pill" | "cell";

// 높이 28px. 큰글씨 모드에서 라벨이 두 줄이 되면 늘어난다
const BASE =
  "inline-flex min-h-7 items-center justify-center break-keep py-0.5 text-center [overflow-wrap:break-word]";

const VARIANT: Record<BadgeVariant, string> = {
  // 두 글자 라벨이 Figma 와 같은 48px 이 되도록 최소 폭을 둔다
  pill: "min-w-12 rounded-full px-3 text-cropy-label-xs",
  cell: "w-[4.5rem] rounded-lg text-cropy-caption font-bold",
};

const TONE: Record<BadgeTone, string> = {
  attention: "bg-cropy-status-attention-surface text-cropy-status-attention",
  low: "bg-cropy-status-low-surface text-cropy-status-low",
  action: "bg-cropy-action-subtle text-cropy-action-primary",
};

interface BadgeProps extends ComponentPropsWithRef<"span"> {
  tone: BadgeTone;
  variant?: BadgeVariant;
}

/**
 * 상태를 알리는 짧은 라벨. 색만으로는 구분되지 않으므로("위험"과 "주의"가 같은 색이다)
 * 라벨을 항상 넣는다. 어떤 등급에 어떤 색과 문구를 쓸지는 쓰는 쪽이 정한다.
 * pill 의 폭은 글자에 맞춰지고(최소 48px), 고정 폭이 필요하면 className 으로 준다 (예: w-[4.5rem]).
 * cell 은 72px 고정이다.
 * 카드처럼 무엇의 상태인지 드러나지 않는 자리에서는 쓰는 쪽이 맥락을 붙인다
 * (예: <Badge tone="attention"><span className="sr-only">위험 등급 </span>주의</Badge>).
 */
export function Badge({ tone, variant = "pill", className, ...rest }: BadgeProps) {
  return <span {...rest} className={cn(BASE, VARIANT[variant], TONE[tone], className)} />;
}
