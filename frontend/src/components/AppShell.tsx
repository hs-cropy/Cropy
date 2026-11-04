import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

// Figma 의 농장 배경(원본 PNG 1.4~1.7MB)을 WebP 로 줄인 파일. 흰 바탕 위에 24% 로 깐다
const BACKGROUND_MOBILE = "/background/farm-mobile.webp";
const BACKGROUND_DESKTOP = "/background/farm-desktop.webp";

// 화면 높이에 맞춘 틀. 주소 표시줄이 접히고 펴져도 맞도록 dvh 를 쓰고, 모르는 브라우저에는 vh 를 준다.
// 높이는 className 으로 바꿀 수 없다 (h-* 를 넘겨도 dvh 규칙이 남는다).
// 인쇄할 때는 높이 고정을 풀어 본문 전체가 나오게 한다
const ROOT =
  "relative isolate flex min-h-screen flex-col overflow-x-hidden bg-cropy-surface supports-[height:100dvh]:min-h-dvh print:!min-h-0 print:overflow-visible";

interface AppShellProps extends ComponentPropsWithRef<"div"> {
  /** 위쪽 Header */
  header?: ReactNode;
  /** 모바일 화면 아래의 MobileNav. lg 부터는 Header 안의 내비가 대신하므로 숨긴다 */
  nav?: ReactNode;
  /** 데스크탑 화면 아래의 AppShellFooter */
  footer?: ReactNode;
}

/**
 * 앱의 전체 레이아웃: 헤더, 화면, 모바일 내비게이션,
 * 데스크탑 푸터와 농장 배경을 배치한다.
 *
 * 콘텐츠 높이에 따라 페이지가 자연스럽게 늘어나며,
 * 모바일 하단 내비게이션만 화면 아래에 고정한다.
 *
 * 내비게이션이 마지막 콘텐츠를 가리지 않도록
 * 모바일에서는 하단 여백을 확보한다.
 */
export function AppShell({ header, nav, footer, className, children, ...rest }: AppShellProps) {
  return (
    <div {...rest} className={cn(ROOT, className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* picture 는 화면 폭에 맞는 한 장만 받는다 */}
        <picture>
          <source media="(min-width: 1024px)" srcSet={BACKGROUND_DESKTOP} />
          {/* eslint-disable-next-line @next/next/no-img-element -- 50KB 안쪽의 배경이라 next/image 최적화가 필요 없다 */}
          <img
            src={BACKGROUND_MOBILE}
            alt=""
            className="absolute inset-0 size-full object-cover opacity-[0.24]"
          />
        </picture>
      </div>
      {header}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          nav != null && nav !== false && "pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0",
        )}
      >
        {children}
      </div>

      {nav != null && nav !== false && (
        <div className="fixed inset-x-0 bottom-0 z-50 lg:hidden">
          {nav}
        </div>
      )}

      {footer}
    </div>
  );
}

interface AppShellPageProps extends Omit<ComponentPropsWithRef<"main">, "title"> {
  /** 스크롤되지 않는 제목 영역. PageHeader 를 넣는다 */
  header?: ReactNode;
  /** 스크롤되지 않는 아래 행동 영역. ActionBar 를 넣는다 */
  actions?: ReactNode;
  /** 스크롤되는 본문 영역의 이름 (스크린리더용) */
  scrollLabel?: string;
}

/**
 * 한 화면의 레이아웃: 제목 영역, 본문, 행동 영역.
 *
 * 세 영역은 모두 페이지 스크롤에 참여한다.
 * 본문은 좌우 24px(넓은 화면에서 64px),
 * 최대 폭 1200px이며 콘텐츠 간격은 16px이다.
 */
export function AppShellPage({
  header,
  actions,
  scrollLabel = "본문",
  className,
  children,
  ...rest
}: AppShellPageProps) {
  return (
    <main {...rest} className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {header}
      <div
        role="region"
        aria-label={scrollLabel}
        // 버튼이 없는 본문도 키보드(방향키·스페이스)로 스크롤할 수 있어야 한다
        tabIndex={-1}
        className="min-w-0 flex-1 px-6 pb-5 lg:pb-6 xl:px-16"
      >
        <div className="mx-auto flex w-full max-w-[75rem] flex-col gap-4">{children}</div>
      </div>
      {actions}
    </main>
  );
}

type AppShellFooterProps = ComponentPropsWithRef<"footer">;

/**
 * 데스크탑 화면 아래의 푸터 (WebShell/Footer): 높이 64px, 서비스 이름과 AI 진단 안내 문구.
 * 모바일에는 없다.
 */
export function AppShellFooter({ className, ...rest }: AppShellFooterProps) {
  return (
    <footer
      {...rest}
      className={cn(
        "hidden min-h-16 shrink-0 items-center border-t border-cropy-border bg-cropy-surface/[0.96] px-6 text-cropy-text-secondary lg:flex xl:px-16",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[75rem] items-center gap-6">
        <p className="w-20 shrink-0 text-cropy-helper font-bold">Cropy</p>
        <p className="min-w-0 flex-1 break-keep text-cropy-label-xs font-normal">
          AI 진단은 참고 정보입니다. 정확한 판단이 필요하면 지역 농업기술센터에 문의하세요.
        </p>
      </div>
    </footer>
  );
}
