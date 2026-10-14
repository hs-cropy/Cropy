import { Children, type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

// 화면의 MobileShell/Actions: 흰 배경·위 테두리·좌우 24px·상하 16px, 버튼을 간격 8px 로 세로로 쌓는다
// (버튼 하나 84px, 둘 144px).
// lg 부터 WebShell/Actions: 높이 80px·흰 배경 96%, 버튼을 간격 12px 로 왼쪽부터 나란히 놓는다.
// 좌우 여백은 Header 와 같이 lg 24px → xl 64px 로 둔다.
// Figma 의 높이는 위 테두리 1px 을 포함하므로 위 여백에서 1px 을 뺀다.
// 안쪽이 비면(자식이 아무것도 그리지 않으면) 띠째로 숨긴다
const OUTER =
  "shrink-0 border-t border-cropy-border bg-cropy-surface px-6 pb-4 pt-[calc(1rem-1px)] has-[>:empty]:hidden lg:flex lg:min-h-20 lg:items-center lg:bg-cropy-surface/[0.96] lg:py-2 xl:px-16";

// 버튼 폭은 모바일에서 꽉 채우고 lg 부터 240px 이다. 높이는 Button 이 정한다.
// 이 폭은 자식의 w-* 클래스보다 우선한다
const INNER =
  "mx-auto flex w-full max-w-[75rem] flex-col gap-2 lg:flex-row lg:gap-3 [&>*]:w-full lg:[&>*]:w-60";

type ActionBarProps = ComponentPropsWithRef<"div">;

/**
 * 화면 아래의 행동 영역. 주 버튼을 먼저, 보조 버튼을 다음에 넣는다 (최대 2개).
 * 본문과 함께 스크롤되지 않게 AppShellPage 의 actions 자리에 넣는다.
 * 버튼이 없으면 아무것도 그리지 않으므로 {조건 && <Button />} 처럼 넘겨도 빈 띠가 남지 않는다
 * (조건은 true·false 로 준다. 0 이나 빈 문자열은 글자로 그려진다).
 * Button·buttonClassName 을 준 Link 를 바로 넣는다 (div 로 한 번 감싸면 폭이 맞지 않는다).
 */
export function ActionBar({
  children,
  className,
  "aria-label": ariaLabel = "화면 행동",
  ...rest
}: ActionBarProps) {
  if (Children.toArray(children).length === 0) return null;

  return (
    <div {...rest} role="group" aria-label={ariaLabel} className={cn(OUTER, className)}>
      <div className={INNER}>{children}</div>
    </div>
  );
}
