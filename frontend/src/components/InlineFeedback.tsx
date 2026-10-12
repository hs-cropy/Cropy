import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Mascot, type MascotName } from "./Mascot";

// alert: 오류·재시도 (나타나는 즉시 읽힌다) / status: 진행 중·참고 (하던 말을 끊지 않는다).
// 진행 중이라고 aria-busy 를 붙이지 않는다: 이 카드에 붙이면 "불러오고 있어요" 자체가 읽히지 않을 수 있다.
// aria-busy 는 불러오는 대상(목록 등)에 쓰는 쪽이 붙인다
type InlineFeedbackTone = "alert" | "status";

// Figma 의 Cropy/FeedbackV3/inline/*: 흰 배경·테두리·모서리 18px·안쪽 20px·간격 12px.
// 18px 은 디자인 시스템에 변수가 없는 값이다
const BASE =
  "flex w-full flex-col items-center gap-3 rounded-[1.125rem] border border-cropy-border bg-cropy-surface p-5 text-center";

// 어절 단위로 줄을 나누고, 한 줄에 못 들어가는 긴 낱말만 중간에서 끊는다
const TEXT = "w-full break-keep [overflow-wrap:break-word]";

// 버튼 하나는 글자 폭(최소 120px)으로 가운데에, 둘은 간격 8px 로 반반 나눈다.
// 큰글씨 모드에서는 Figma 가이드대로 세로로 쌓는다 (버튼 하나는 그대로 가운데)
const ACTIONS =
  "flex w-full justify-center gap-2 empty:hidden [&>*]:min-w-0 [&>*]:flex-1 [&>*:only-child]:min-w-[7.5rem] [&>*:only-child]:max-w-full [&>*:only-child]:flex-none [&>*:only-child]:self-center [html[data-textsize=large]_&]:flex-col";

interface InlineFeedbackProps extends Omit<ComponentPropsWithRef<"section">, "title" | "role"> {
  mascot: MascotName;
  title: ReactNode;
  /** 본문. 문자열의 \n 에서 줄을 바꾼다 */
  children?: ReactNode;
  /**
   * 버튼 0~2개. Button 에 size="compact" 를 주고, 주 버튼을 먼저 둔다.
   * 버튼(또는 buttonClassName 을 준 Link)을 바로 넣는다. div 로 한 번 감싸면 배치가 깨진다
   */
  actions?: ReactNode;
  tone?: InlineFeedbackTone;
  /** 제목의 수준. 놓이는 화면의 제목 순서에 맞춘다 */
  headingLevel?: 2 | 3 | 4;
}

/**
 * 화면 안에 계속 떠 있는 안내 카드: 오류·재시도·진행 중. 잠깐 떴다 사라지는 알림은 Toast,
 * 작업을 잃기 전에 되묻는 것은 ConfirmDialog 를 쓴다.
 * 폭은 부모를 따른다. 넓은 화면에서는 쓰는 쪽이 max-w-[30rem](480px)을 준다.
 * 스크린리더는 이 카드가 화면에 새로 나타날 때 읽으므로, 오류가 난 시점에 렌더링한다
 * (미리 그려 두고 내용만 바꾸면 읽히지 않을 수 있다). 초점은 옮기지 않는다.
 * 마스코트는 장식이고 뜻은 제목과 본문이 전한다.
 */
export function InlineFeedback({
  mascot,
  title,
  children,
  actions,
  tone = "alert",
  headingLevel = 3,
  // 배치용(폭, 여백)으로만 쓴다
  className,
  ...rest
}: InlineFeedbackProps) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;

  return (
    <section aria-labelledby={titleId} {...rest} role={tone} className={cn(BASE, className)}>
      {/* 모바일 64px, lg 부터 데스크탑 피드백 크기인 80px */}
      <Mascot name={mascot} size={64} className="lg:size-20" />
      <Heading
        id={titleId}
        className={cn(TEXT, "text-cropy-feedback-title text-cropy-text-primary")}
      >
        {title}
      </Heading>
      {children != null && children !== false && (
        <div
          className={cn(
            TEXT,
            "whitespace-pre-line text-cropy-feedback-body text-cropy-text-secondary empty:hidden",
          )}
        >
          {children}
        </div>
      )}
      {actions != null && actions !== false && <div className={ACTIONS}>{actions}</div>}
    </section>
  );
}
