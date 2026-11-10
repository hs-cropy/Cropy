import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ActionDock } from "./ActionDock";

// Figma 의 농장 배경(원본 PNG 1.4~1.7MB)을 WebP 로 줄인 파일. 흰 바탕 위에 24% 로 깐다
const BACKGROUND_MOBILE = "/background/farm-mobile.webp";
const BACKGROUND_DESKTOP = "/background/farm-desktop.webp";

// 화면 높이를 최소로 채우는 틀. 내용이 넘치면 틀(문서) 전체가 스크롤된다.
// 주소 표시줄이 접히고 펴져도 맞도록 dvh 를 쓰고, 모르는 브라우저에는 vh 를 준다.
// 가로로 넘치는 것만 잘라 좌우 스크롤이 생기지 않게 한다 (clip 은 스크롤 영역을 만들지 않는다)
const ROOT =
  "relative isolate flex min-h-screen flex-col overflow-x-clip bg-cropy-surface supports-[height:100dvh]:min-h-dvh";

interface AppShellProps extends ComponentPropsWithRef<"div"> {
  /** 위쪽 Header */
  header?: ReactNode;
  /** 모바일 화면 아래의 MobileNav. lg 부터는 Header 안의 내비가 대신하므로 숨긴다 */
  nav?: ReactNode;
  /** 데스크탑 화면 아래의 AppShellFooter */
  footer?: ReactNode;
}

/**
 * 앱의 틀: 헤더, 화면, 모바일 내비, 데스크탑 푸터와 농장 배경. 화면 높이를 최소로 채우고,
 * 내용이 넘치면 헤더부터 문서 전체가 함께 스크롤된다. 모바일 내비와 화면의 행동 영역(ActionBar)만
 * 화면 아래에 붙어 있다 (고정 영역이 본문을 거의 다 먹던 배율 125% 노트북·작은 휴대폰 대응).
 * 화면(page)은 children 자리에 AppShellPage 를 그린다.
 * 위아래 안전 영역은 Header 와 MobileNav 가 이미 띄운다. 다만 내비는 화면에 고정되어 흐름에서
 * 빠지므로, 화면 자리 아래에 내비 높이(72px + 아래 안전 영역)만큼 여백을 둔다.
 * 알려진 한계: 데스크탑 푸터는 아래 안전 영역을 띄우지 않는다.
 */
export function AppShell({ header, nav, footer, className, children, ...rest }: AppShellProps) {
  const hasNav = nav != null && nav !== false;
  return (
    <div {...rest} className={cn(ROOT, className)}>
      {/* 틀이 문서 길이만큼 늘어나므로, 배경이 함께 늘어나 확대되지 않게 화면에 고정한다 */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 print:absolute">
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
          "flex flex-1 flex-col",
          // 화면에 고정된 내비가 본문 끝을 가리지 않게 그 높이만큼 비워 둔다
          hasNav && "pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0 print:pb-0",
        )}
      >
        {children}
      </div>
      {hasNav && (
        // sticky 는 iOS 사파리의 바운스(문서 끝을 지나 당기기) 때 문서와 함께 끌려 올라가
        // 내비 아래 빈 바탕이 드러난다. fixed 는 바운스 중에도 화면 아래에 그대로 있다
        <div className="fixed inset-x-0 bottom-0 z-10 lg:hidden print:static">{nav}</div>
      )}
      {footer}
    </div>
  );
}

interface AppShellPageProps extends Omit<ComponentPropsWithRef<"main">, "title"> {
  /** 본문과 함께 스크롤되는 제목 영역. PageHeader 를 넣는다 */
  header?: ReactNode;
  /** 화면 아래에 붙어 있는 행동 영역. ActionBar 를 넣는다 */
  actions?: ReactNode;
  /** 본문 영역의 이름 (스크린리더용) */
  scrollLabel?: string;
}

/**
 * 한 화면의 틀: 제목 영역, 본문, 행동 영역. 제목·본문은 헤더와 함께 문서 스크롤로 흐르고,
 * 행동 영역은 화면 아래(모바일은 내비 72px 위, lg 부터는 맨 아래)에 붙어 있고, 아래로 스크롤하는
 * 동안에만 숨었다가 멈추면 다시 나온다 (ActionDock).
 * 본문은 좌우 24px(lg 24px → xl 64px)·최대 폭 1200px 이고 안의 덩어리 간격은 16px 이다.
 * 화면을 옮기면 AppFrame 이 본문 영역에 초점을 보내므로 Tab 으로 닿게 둔다 (초점이 본문에 있으면
 * 방향키·스페이스가 문서를 스크롤한다).
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
    <main {...rest} className={cn("flex flex-1 flex-col", className)}>
      {header}
      <div
        role="region"
        aria-label={scrollLabel}
        tabIndex={0}
        // 가로 넘침은 hidden 으로 자른다. 높이가 내용 크기라 세로로 넘칠 일이 없어 따로 스크롤되지 않고,
        // sticky 띠의 조상도 아니라 clip 을 모르는 옛 Safari 에서도 안전하다
        className="flex-1 overflow-x-hidden px-6 pb-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cropy-action-primary lg:pb-6 xl:px-16"
      >
        <div className="mx-auto flex w-full max-w-[75rem] flex-col gap-4">{children}</div>
      </div>
      {actions != null && actions !== false && <ActionDock>{actions}</ActionDock>}
    </main>
  );
}

type AppShellFooterProps = ComponentPropsWithRef<"footer">;

/**
 * 데스크탑 화면 아래의 푸터 (WebShell/Footer): 높이 64px, 서비스 이름과 AI 진단 안내 문구.
 * 모바일에는 없다.
 * 화면의 행동 영역(ActionDock, sticky z-10)은 숨을 때 자기 틀 안에서 잘려 푸터까지 내려오지 않지만,
 * 혹시 겹치더라도 푸터가 위에 오도록 푸터도 z-10 으로 띄운다 (DOM 에서 뒤라 같은 z-10 이면 위에 그려진다).
 */
export function AppShellFooter({ className, ...rest }: AppShellFooterProps) {
  return (
    <footer
      {...rest}
      className={cn(
        "relative z-10 hidden min-h-16 shrink-0 items-center border-t border-cropy-border bg-cropy-surface/[0.96] px-6 text-cropy-text-secondary lg:flex xl:px-16",
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
