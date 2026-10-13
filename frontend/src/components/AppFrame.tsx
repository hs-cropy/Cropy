"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { VoiceToggle } from "@/features/voice";
import { APP_NAV_ITEMS, currentNavKey } from "./appNav";
import { AppShell, AppShellFooter } from "./AppShell";
import { Header } from "./Header";
import { MobileNav } from "./MobileNav";
import { TextSizeToggle } from "./TextSizeToggle";

/**
 * 앱 전체의 틀을 조립한다: 헤더, 모바일 내비, 데스크탑 푸터. layout 에 한 번만 놓고,
 * 각 화면은 children 자리에 AppShellPage 를 그린다.
 * 현재 경로를 알아야 내비의 현재 항목을 표시할 수 있어 클라이언트 컴포넌트다.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const current = currentNavKey(usePathname());

  return (
    <AppShell
      header={
        <Header
          items={APP_NAV_ITEMS}
          current={current}
          homeHref="/"
          actions={
            <>
              {/* 기기 안에서 진단하는 정적 페이지. 앱에서 그 페이지로 가는 길은 여기뿐이다 */}
              <a
                href="/offline/index.html"
                className="shrink-0 whitespace-nowrap rounded-full bg-brand-tint px-3 py-2 text-xs font-bold"
              >
                기기 진단
              </a>
              <TextSizeToggle />
              <VoiceToggle />
            </>
          }
        />
      }
      nav={<MobileNav items={APP_NAV_ITEMS} current={current} />}
      footer={<AppShellFooter />}
    >
      {children}
    </AppShell>
  );
}
