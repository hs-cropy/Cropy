"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { APP_NAV_ITEMS, currentNavKey } from "./appNav";
import { AppShell, AppShellFooter } from "./AppShell";
import { Header } from "./Header";
import { MobileNav } from "./MobileNav";
import { DiagnosisSessionProvider, useDiagnosisSession } from "./diagnosis/DiagnosisSession";
import type { NavItem } from "./navItem";
import { requestNewDiagnosis } from "./newDiagnosis";
import { TextSizeToggle } from "./TextSizeToggle";
import {  clearVoiceReturn, readVoiceReturn, } from "./voice-mode/voiceNavigation";
import { VoiceGuideToggle } from "@/features/voice/components/VoiceGuideToggle";
import { VoiceModeEntry } from "./voice-mode/VoiceModeEntry";

const HEADER_SWITCH_CLASS =
  "min-w-[5.625rem] " +
  "[[data-textsize=large]_&]:min-w-0 " +
  "xl:w-[8.25rem] " +
  "xl:justify-between " +
  "xl:gap-3 " +
  "xl:px-[0.9375rem]";

// md~lg 는 Figma 에 없는 폭이라 글자 길이에 맞춘다. 스토리도 같은 값을 쓴다.
// 큰글씨에서는 90px 최소 폭이 113px 로 커져 320px 화면의 로고 자리가 사라지므로 최소 폭을 푼다
export const HEADER_TOGGLE =
  "min-w-[5.625rem] md:min-w-0 [[data-textsize=large]_&]:min-w-0 xl:w-[8.25rem] xl:justify-between xl:gap-3 xl:px-[0.9375rem]";

/**
 * 앱 전체의 틀을 조립한다: 헤더, 모바일 내비, 데스크탑 푸터. layout 에 한 번만 놓고,
 * 각 화면은 children 자리에 AppShellPage 를 그린다.
 * 현재 경로를 알아야 내비의 현재 항목을 표시할 수 있어 클라이언트 컴포넌트다.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  // 진단 상태(고른 사진·진행 중인 요청·결과)는 촬영 화면과 진단 결과 화면이 함께 쓰고,
  // 화면을 오가도 남아야 해서 앱 틀에 둔다
  const pathname = usePathname();

  // 스플래시는 헤더·하단 내비게이션 없이 전체 화면 표시
  if (pathname === "/splash") {
    return <>{children}</>;
  }

  return (
    <DiagnosisSessionProvider>
      <Frame>{children}</Frame>
    </DiagnosisSessionProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = currentNavKey(pathname);
  const session = useDiagnosisSession();
  const shellRef = useRef<HTMLDivElement>(null);
  const previousPathRef = useRef(pathname);

  // 화면을 옮긴 뒤 초점이 내비 링크에 남아 있으면
  // 키보드(PageDown·스페이스)로 본문을 내릴 수 없다. 옮긴 화면의 본문으로 초점을 보낸다.
  // 옮긴 화면이 이미 자기 제목 등으로 초점을 옮겼다면(분석 시작·취소) 그대로 둔다
  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    const main = shellRef.current?.querySelector("main");
    if (main?.contains(document.activeElement)) return;
    main?.querySelector<HTMLElement>("[role=region][tabindex]")?.focus({ preventScroll: true });
  }, [pathname]);
  // 음성 모드에서 돌아오면 저장된 문서 스크롤 위치 복원
  useEffect(() => {
    if (pathname === "/voice-mode") return;

    const previous = readVoiceReturn();
    if (!previous) return;

    const currentPath =
      window.location.pathname + window.location.search;

    // 저장된 진입 화면으로 돌아왔을 때만 복원
    if (currentPath !== previous.path) return;

    let secondFrame = 0;

    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        window.scrollTo({
          top: previous.scrollY,
          behavior: "instant",
        });

        clearVoiceReturn();
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [pathname]);

  // "새 진단"은 이전 사진·결과를 비우고 촬영 화면 처음으로 간다 (Figma 03 개발 가이드).
  // 촬영 화면에서 다시 누르면 같은 주소라 화면이 그대로 남으므로 처음 상태로 돌아가라고 알린다.
  // 다른 화면에서 누르면 진단 상태를 비우고 링크대로 옮겨 간다
  const handleNavClick = (item: NavItem, event: MouseEvent<HTMLAnchorElement>) => {
    if (item.key !== "capture") return;
    // 새 탭·새 창으로 여는 클릭은 지금 화면을 건드리지 않는다
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (pathname !== "/home") {
      session.reset();
      // 링크가 촬영 화면으로 옮긴 뒤 처음 컨트롤(사진 업로드 영역)에 초점을 둔다
      session.markArrival("/home", "reset");
      return;
    }
    // 같은 주소로 다시 옮겨 가지 않는다. 옮기려다 연결이 끊겨 있으면 화면을 통째로 새로 고칠 수 있다
    event.preventDefault();
    requestNewDiagnosis();
  };

  // 음성 모드는 전용 전체 화면을 사용한다.
  // DiagnosisSessionProvider는 상위 AppFrame에서 유지한다.
  if (pathname === "/voice-mode") {
    return <>{children}</>;
  }
  return (
    <AppShell
      ref={shellRef}
      header={
        <Header
          items={APP_NAV_ITEMS}
          current={current}
          onItemClick={handleNavClick}
          homeHref="/home"
          actions={
            <>
              <TextSizeToggle className={HEADER_SWITCH_CLASS} />

              <VoiceGuideToggle className={HEADER_SWITCH_CLASS} />

              <VoiceModeEntry />
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
