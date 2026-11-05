
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

// Figma의 농장 배경을 WebP로 최적화한 파일
// 흰 배경 위에 24% 불투명도로 표시한다.
const BACKGROUND_MOBILE = "/background/farm-mobile.webp";
const BACKGROUND_DESKTOP = "/background/farm-desktop.webp";

// 모바일에서는 화면 높이에 맞춰 고정 영역과 스크롤 영역을 분리한다.
// dvh를 지원하지 않는 브라우저에서는 vh를 사용한다.
// 데스크톱에서는 기존 전체 페이지 스크롤 구조를 유지한다.
// 인쇄 시에는 높이 제한과 overflow 제한을 해제한다.
const ROOT =
  "relative isolate flex h-screen min-h-0 flex-col overflow-hidden bg-cropy-surface " +
  "supports-[height:100dvh]:h-dvh " +
  "lg:h-auto lg:min-h-screen lg:overflow-visible " +
  "print:!h-auto print:!min-h-0 print:!overflow-visible";

interface AppShellProps extends ComponentPropsWithRef<"div"> {
  /** 앱 상단의 공통 Header */
  header?: ReactNode;

  /** 모바일 하단 내비게이션. lg부터 숨긴다. */
  nav?: ReactNode;

  /** 데스크톱 하단 Footer */
  footer?: ReactNode;
}

/**
 * 앱의 전체 레이아웃.
 *
 * 모바일:
 * - 앱 공통 헤더 고정
 * - AppShellPage의 제목과 본문 스크롤
 * - 행동 버튼은 본문 밖에 유지
 * - 하단 내비게이션 고정
 *
 * 데스크톱:
 * - 기존 콘텐츠 기반 페이지 스크롤 유지
 *
 * 모바일에서는 하단 내비게이션과 안전 영역만큼
 * 콘텐츠 영역의 여백을 확보한다.
 */
export function AppShell({
  header,
  nav,
  footer,
  className,
  children,
  ...rest
}: AppShellProps) {
  return (
    <div {...rest} className={cn(ROOT, className)}>
      {/* 장식용 농장 배경 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <picture>
          <source
            media="(min-width: 1024px)"
            srcSet={BACKGROUND_DESKTOP}
          />

          {/* eslint-disable-next-line @next/next/no-img-element -- 최적화된 배경 이미지 */}
          <img
            src={BACKGROUND_MOBILE}
            alt=""
            className="absolute inset-0 size-full object-cover opacity-[0.24]"
          />
        </picture>
      </div>

      {/* 앱 공통 상단 헤더: 스크롤 영역 밖 */}
      {header && (
        <div className="shrink-0">
          {header}
        </div>
      )}

      {/* 페이지 콘텐츠 영역 */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          nav != null &&
            nav !== false &&
            "pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0",
        )}
      >
        {children}
      </div>

      {/* 모바일 하단 내비게이션 */}
      {nav != null && nav !== false && (
        <div className="fixed inset-x-0 bottom-0 z-50 lg:hidden">
          {nav}
        </div>
      )}

      {/* 데스크톱 푸터 */}
      {footer}
    </div>
  );
}

interface AppShellPageProps
  extends Omit<ComponentPropsWithRef<"main">, "title"> {
  /**
   * 페이지 제목 영역.
   *
   * 모바일에서는 본문과 함께 스크롤된다.
   * PageHeader 컴포넌트를 전달할 수 있다.
   */
  header?: ReactNode;

  /**
   * 하단 행동 영역.
   * 본문 스크롤과 분리하여 고정한다.
   */
  actions?: ReactNode;

  /** 스크롤 영역의 접근성 이름 */
  scrollLabel?: string;
}

/**
 * 개별 페이지의 레이아웃.
 *
 * 모바일:
 * - 페이지 제목과 본문을 같은 스크롤 영역에 배치한다.
 * - 제목은 본문과 함께 스크롤된다.
 * - actions는 스크롤 영역 밖에 유지한다.
 *
 * 데스크톱:
 * - 기존처럼 페이지 높이에 따라 콘텐츠가 늘어난다.
 * - 데스크톱의 구체적인 배치는 추후 Figma 확인 후 수정한다.
 *
 * 제목과 본문을 동일한 region에 두므로
 * header를 복제해서 렌더링할 필요가 없다.
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
    <main
      {...rest}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        className,
      )}
    >
      {/* 제목과 본문이 함께 스크롤되는 영역 */}
      <div
        role="region"
        aria-label={scrollLabel}
        tabIndex={-1}
        className={cn(
          "min-h-0 min-w-0 flex-1",
          "overflow-y-auto overscroll-contain",
          "px-6 pb-5",
          "lg:overflow-visible lg:pb-6 xl:px-16",
          "print:!overflow-visible",
        )}
      >
        {/* 페이지 제목: 스크롤 영역 내부 */}
        {header && (
          <div className="-mx-6 xl:-mx-16">
            {header}
          </div>
        )}

        {/* 페이지 본문 */}
        <div className="mx-auto flex w-full max-w-[75rem] flex-col gap-4">
          {children}
        </div>
      </div>

      {/* 행동 버튼: 스크롤 영역 밖 */}
      {actions && (
        <div className="shrink-0">
          {actions}
        </div>
      )}
    </main>
  );
}

type AppShellFooterProps = ComponentPropsWithRef<"footer">;

/**
 * 데스크톱 하단 푸터.
 *
 * 높이 64px, 서비스 이름과 AI 진단 안내 문구를 표시한다.
 * 모바일에서는 렌더링 영역을 숨긴다.
 */
export function AppShellFooter({
  className,
  ...rest
}: AppShellFooterProps) {
  return (
    <footer
      {...rest}
      className={cn(
        "hidden min-h-16 shrink-0 items-center border-t border-cropy-border bg-cropy-surface/[0.96] px-6 text-cropy-text-secondary lg:flex xl:px-16",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[75rem] items-center gap-6">
        <p className="w-20 shrink-0 text-cropy-helper font-bold">
          Cropy
        </p>

        <p className="min-w-0 flex-1 break-keep text-cropy-label-xs font-normal">
          AI 진단은 참고 정보입니다. 정확한 판단이 필요하면 지역 농업기술센터에 문의하세요.
        </p>
      </div>
    </footer>
  );
}
