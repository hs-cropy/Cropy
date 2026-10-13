import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AppShellPage } from "./AppShell";

interface LegacyPageProps {
  /** 스크롤되는 본문 영역의 이름 (스크린리더용) */
  scrollLabel: string;
  className?: string;
  children: ReactNode;
}

/**
 * 아직 새 디자인으로 옮기지 않은 화면을 새 틀(AppShellPage)에 넣는 임시 래퍼.
 * 옛 layout 이 주던 위 여백과 본문의 최대 폭(모바일 440px·md 704px·lg 960px)을 그대로 둔다.
 * 좌우 여백은 틀의 값(24px)을 따르므로 좁은 화면에서는 옛 화면(20px)보다 본문이 8px 좁다.
 * 화면을 새로 쓸 때는 AppShellPage 에 PageHeader·ActionBar 를 직접 넣고,
 * 쓰는 곳이 없어지면 이 파일을 지운다.
 */
export function LegacyPage({ scrollLabel, className, children }: LegacyPageProps) {
  return (
    <AppShellPage scrollLabel={scrollLabel}>
      <div
        className={cn(
          "mx-auto w-full max-w-[27.5rem] pt-5 md:max-w-[44rem] md:pt-8 lg:max-w-[60rem]",
          className,
        )}
      >
        {children}
      </div>
    </AppShellPage>
  );
}
