import type { ComponentPropsWithRef, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { Mascot, type MascotName } from "./Mascot";

// 화면의 MobileShell/Title: 높이 112px(상하 8px + 96px)·좌우 24px.
// lg 부터 WebShell/Title: 높이 160px(위 32px·아래 12px + 116px), 안쪽 폭은 최대 1200px.
// 좌우 여백은 Header 와 같이 lg 24px → xl 64px 로 둔다. 큰글씨나 긴 설명에서는 높이가 늘어난다
const OUTER = "shrink-0 px-6 py-2 lg:pb-3 lg:pt-8 xl:px-16";
const INNER =
  "mx-auto flex min-h-24 w-full max-w-[75rem] items-start gap-3 lg:min-h-[7.25rem] lg:items-center lg:gap-6";

// 제목은 화면 값인 24px/32px 을 쓴다 (디자인 시스템의 Title/Mobile 22px 과 다르고, 화면이 우선이다)
const TITLE =
  "break-keep text-cropy-heading-lg text-cropy-text-primary [overflow-wrap:break-word] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary lg:text-cropy-title-desktop";

interface PageHeaderProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  title: ReactNode;
  /** 제목 아래의 설명. 문자열의 \n 에서 줄을 바꾼다 */
  description?: ReactNode;
  /** 제목 옆의 마스코트. 모바일 64px, lg 부터 88px */
  mascot?: MascotName;
  /** 제목의 수준. 화면의 큰 제목이면 1 */
  headingLevel?: 1 | 2 | 3;
  /** 화면이 바뀐 뒤 초점을 제목으로 옮길 때 쓴다 (titleRef.current.focus()) */
  titleRef?: Ref<HTMLHeadingElement>;
}

/**
 * 화면의 제목 영역: 제목, 설명, 마스코트. 본문과 함께 스크롤되지 않게 AppShellPage 의
 * header 자리에 넣는다. 마스코트는 장식이라 스크린리더가 읽지 않는다.
 * 제목은 Tab 으로는 닿지 않지만 코드로 초점을 줄 수 있다.
 */
export function PageHeader({
  title,
  description,
  mascot,
  headingLevel = 1,
  titleRef,
  className,
  ...rest
}: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <div {...rest} className={cn(OUTER, className)}>
      <div className={INNER}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:gap-2">
          <Heading ref={titleRef} tabIndex={-1} className={TITLE}>
            {title}
          </Heading>
          {description != null && description !== false && (
            <div className="whitespace-pre-line break-keep text-cropy-helper text-cropy-text-secondary [overflow-wrap:break-word]">
              {description}
            </div>
          )}
        </div>
        {/* Figma 에서 마스코트는 제목 영역 위에서 14px 내려와 있다 (상하 여백 8px + 6px) */}
        {mascot && <Mascot name={mascot} size={64} className="mt-1.5 lg:mt-0 lg:size-[5.5rem]" />}
      </div>
    </div>
  );
}
