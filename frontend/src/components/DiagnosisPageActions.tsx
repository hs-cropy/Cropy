"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ActionBar } from "@/components/ActionBar";
import { AppShellPage } from "@/components/AppShell";

type ActionHost = HTMLDivElement | null;

interface ActionHostContextValue {
  host: ActionHost;
  inShell: boolean;
}

const ActionHostContext = createContext<ActionHostContextValue>({
  host: null,
  inShell: false,
});

/**
 * AppShellPage를 딱 한 번 만들고, 고정 actions 영역을 하위 화면에 제공한다.
 * 기존 AppShellPage / AppFrame / MobileNav는 수정하지 않는다.
 *
 * 처음부터 보이는 제목·버튼(촬영 화면)은 header·actions 로 직접 넘긴다. 그래야 서버 HTML 에
 * 들어가 새로고침 때 뒤늦게 끼어들지 않는다. DiagnosisPageActions(portal)는 결과가 나온 뒤에만
 * 그려지는 패널처럼, 하이드레이션 뒤에 나타나도 되는 버튼에 쓴다.
 */
export function DiagnosisPageShell({
  children,
  header,
  actions,
  scrollLabel = "진단하기",
}: {
  children: ReactNode;
  /** 스크롤되지 않는 제목 영역 (PageHeader) */
  header?: ReactNode;
  /** 스크롤되지 않는 행동 영역 (ActionBar) */
  actions?: ReactNode;
  scrollLabel?: string;
}) {
  const [host, setHost] = useState<ActionHost>(null);

  return (
    <ActionHostContext.Provider value={{ host, inShell: true }}>
      <AppShellPage
        scrollLabel={scrollLabel}
        header={header}
        actions={
          <>
            {actions}
            <div ref={setHost} />
          </>
        }
      >
        {children}
      </AppShellPage>
    </ActionHostContext.Provider>
  );
}

/**
 * 화면 컴포넌트가 소유한 버튼과 클릭 핸들러를 AppShellPage.actions 로 보낸다.
 * history/[id] 등 DiagnosisPageShell 바깥에서는 원래처럼 본문 아래에 표시한다.
 * 탭을 CSS로만 숨기는 DiagnoseForm에서는 visible도 함께 전달해야 한다.
 */
export function DiagnosisPageActions({
  children,
  visible = true,
}: {
  children: ReactNode;
  visible?: boolean;
}) {
  const { host, inShell } = useContext(ActionHostContext);

  if (!visible) return null;

  // 호스트가 아직 준비되지 않았을 때 버튼이 본문에 잠깐 나타나는 현상을 방지한다.
  if (inShell) {
    return host ? createPortal(<ActionBar>{children}</ActionBar>, host) : null;
  }

  // 이력 상세처럼 고정 행동 영역을 제공하지 않는 화면은 기존 본문 버튼 유지.
  return <div className="grid gap-2 [&>*]:w-full lg:flex lg:gap-3 lg:[&>*]:w-60">{children}</div>;
}
