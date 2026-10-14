import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

// md: 이력 한 줄 같은 작은 카드 (Cropy/V2/History/RecordRow, 16px)
// lg: 진단 요약 같은 큰 카드 (Cropy/V2/Diagnosis/ResultSummary, 20px)
type CardRadius = "md" | "lg";
// md: 16px → lg 좌우 20px·상하 16px (RecordRow)
// lg: 16px → lg 24px (ResultSummary)
// none: 사진이나 색 띠가 카드 끝까지 닿을 때. 내용이 모서리 밖으로 나가지 않게 쓰는 쪽이
// className 으로 overflow-hidden 을 준다. 다른 여백이 필요할 때도 none 으로 두고 className 으로 준다
type CardPadding = "none" | "md" | "lg";

// 디자인 시스템의 카드는 흰 배경에 테두리만 있고 그림자가 없다
const BASE = "border border-cropy-border bg-cropy-surface";

const RADIUS: Record<CardRadius, string> = {
  md: "rounded-2xl",
  lg: "rounded-cropy-20",
};

const PADDING: Record<CardPadding, string> = {
  none: "",
  md: "p-4 lg:px-5",
  lg: "p-4 lg:p-6",
};

// Figma 에 호버·누름 상태가 없어 보조 버튼·칩과 같은 배경을 쓴다
const INTERACTIVE =
  "cursor-pointer transition [@media(hover:hover)]:[&:hover:not(:active)]:bg-cropy-surface-canvas active:bg-cropy-surface-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary";

interface CardStyleOptions {
  radius?: CardRadius;
  padding?: CardPadding;
  /** 카드 전체가 링크나 버튼일 때 호버·누름·초점 표시를 더한다 */
  interactive?: boolean;
}

/**
 * 카드 모양만 필요한 곳에 쓴다: section·article·li 처럼 뜻이 있는 요소, 그리고 카드 전체가
 * 눌리는 Link·button. interactive 는 실제로 누를 수 있는 요소에만 주고, 비활성 버튼에는 주지 않는다.
 * a 요소는 기본이 inline 이므로 호출부에서 block 이나 flex 를 함께 준다.
 * 배치 클래스를 덧붙일 때는 cn(cardClassName(), "flex …") 처럼 cn 으로 감싼다.
 */
export function cardClassName({
  radius = "md",
  padding = "md",
  interactive = false,
}: CardStyleOptions = {}) {
  return cn(BASE, RADIUS[radius], PADDING[padding], interactive && INTERACTIVE);
}

interface CardProps extends ComponentPropsWithRef<"div"> {
  radius?: CardRadius;
  padding?: CardPadding;
}

/**
 * 정보를 담는 흰 카드. 안쪽 배치(가로·세로, 간격)와 최소 높이는 쓰는 쪽이 className 으로 정한다.
 * div 가 아닌 요소나 눌리는 카드는 cardClassName 을 쓴다.
 * 모서리와 여백은 Figma 에 있는 두 카드(작은 카드 md·md, 큰 카드 lg·lg)에 맞춘 값이다.
 */
export function Card({
  radius,
  padding,
  // 배치용(flex, 간격, 폭, 최소 높이)으로만 쓴다. 여백은 padding 으로 고른다:
  // className 으로 p-8 을 줘도 lg 부터는 기본 여백(lg:px-5·lg:p-6)이 남아서 이긴다
  className,
  ...rest
}: CardProps) {
  return <div {...rest} className={cn(cardClassName({ radius, padding }), className)} />;
}
