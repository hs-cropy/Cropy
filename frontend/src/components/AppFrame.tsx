"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { VoiceToggle } from "@/features/voice";
import { APP_NAV_ITEMS, currentNavKey } from "./appNav";
import { AppShell, AppShellFooter } from "./AppShell";
import { Header } from "./Header";
import { MobileNav } from "./MobileNav";
import type { NavItem } from "./navItem";
import { requestNewDiagnosis } from "./newDiagnosis";
import { TextSizeToggle } from "./TextSizeToggle";

/**
 * 앱 전체의 틀을 조립한다: 헤더, 모바일 내비, 데스크탑 푸터. layout 에 한 번만 놓고,
 * 각 화면은 children 자리에 AppShellPage 를 그린다.
 * 현재 경로를 알아야 내비의 현재 항목을 표시할 수 있어 클라이언트 컴포넌트다.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = currentNavKey(pathname);
  const shellRef = useRef<HTMLDivElement>(null);
  const previousPathRef = useRef(pathname);

  // 창이 아니라 본문 영역이 스크롤되므로, 화면을 옮긴 뒤 초점이 내비 링크에 남아 있으면
  // 키보드(PageDown·스페이스)로 본문을 내릴 수 없다. 옮긴 화면의 본문으로 초점을 보낸다
  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    shellRef.current
      ?.querySelector<HTMLElement>("main [role=region][tabindex]")
      ?.focus({ preventScroll: true });
  }, [pathname]);

  // 진단 화면에서 "새 진단"을 다시 누르면 같은 주소라 화면이 그대로 남는다.
  // 진단 폼에 처음 상태로 돌아가라고 알린다. 다른 화면에서 누르면 옮겨 가서 새로 열리므로 알릴 것이 없다
  const handleNavClick = (item: NavItem, event: MouseEvent<HTMLAnchorElement>) => {
    if (item.key !== "capture" || pathname !== "/") return;
    // 새 탭·새 창으로 여는 클릭은 지금 화면을 건드리지 않는다
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    // 같은 주소로 다시 옮겨 가지 않는다. 옮기려다 연결이 끊겨 있으면 화면을 통째로 새로 고칠 수 있다
    event.preventDefault();
    requestNewDiagnosis();
  };

  return (
    <AppShell
      ref={shellRef}
      header={
        <Header
          items={APP_NAV_ITEMS}
          current={current}
          onItemClick={handleNavClick}
          homeHref="/"
          actions={
            <>
              {/* 넓은 데스크탑(xl)에서는 Figma 의 고정 폭(112px, 132px)을 쓴다 */}
              <TextSizeToggle className="xl:w-28" />
              <VoiceToggle className="xl:w-[8.25rem]" />
            </>
          }
        />
      }
      nav={<MobileNav items={APP_NAV_ITEMS} current={current} onItemClick={handleNavClick} />}
      footer={<AppShellFooter />}
    >
      {children}
    </AppShell>
  );
}
