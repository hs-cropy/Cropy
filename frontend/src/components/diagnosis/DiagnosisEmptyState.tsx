import Link from "next/link";
import type { MouseEvent } from "react";

import { cardClassName } from "@/components/Card";
import { Mascot } from "@/components/Mascot";
import { cn } from "@/lib/cn";

// 28px/36px 큰 안내 문구 (디자인 시스템 글자 스타일에 없는 화면 값)
const HEADLINE =
  "break-keep text-[1.75rem] font-bold leading-9 tracking-[-0.015em] text-cropy-text-primary";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary";

/**
 * 진단 시작 안내 (모바일 M-03-1 · 데스크탑 D-03-1): 진단 결과 없이 진단 탭에 들어왔을 때.
 * 사진을 찍거나 고르는 버튼은 화면 아래 행동 영역에 둔다.
 * 모바일: 마스코트 96px, 28/36px 문구, 15/24px 본문, "촬영 방법 보기"(14px Bold), 13px 안내.
 * 데스크탑: 카드(안쪽 상하 48px·좌우 40px·모서리 16px·간격 20px) 가운데에 마스코트 120px,
 * 28/36px 문구, 16/24px 본문, "촬영 방법 보기 >"(240×48px).
 */
export function DiagnosisEmptyState({
  desktop = false,
  onOpenGuide,
}: {
  desktop?: boolean;
  /** "촬영 방법 보기": 가이드는 촬영 화면(/#guide)에 있어 쓰는 쪽이 그리로 옮겨 연다 */
  onOpenGuide: () => void;
}) {
  // 주소는 가이드로 두어 새 탭으로도 열 수 있게 하고, 그냥 누르면 쓰는 쪽이 앱 안에서 옮긴다
  // (Link 는 기본 동작을 막으면 스스로 옮기지 않는다)
  const handleGuideClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onOpenGuide();
  };

  if (desktop) {
    return (
      <div
        className={cn(
          cardClassName({ padding: "none" }),
          "flex flex-col items-center gap-5 px-10 py-12 text-center",
        )}
      >
        <Mascot name="greeting" size={96} loading="lazy" className="size-[7.5rem]" />
        <h2 className={HEADLINE}>먼저 작물 사진을 준비해주세요</h2>
        <p className="whitespace-pre-line break-keep text-cropy-body-lg text-cropy-text-secondary">
          {
            "사진을 찍거나 갤러리에서 선택해보세요.\n지난 진단 결과는 진단 이력에서 확인할 수 있어요."
          }
        </p>
        <Link
          href="/#guide"
          onClick={handleGuideClick}
          className={cn(
            "inline-flex min-h-12 w-60 items-center justify-center gap-2 rounded-lg px-3 text-cropy-helper font-medium text-cropy-text-primary hover:text-cropy-action-hover",
            FOCUS,
          )}
        >
          촬영 방법 보기
          <span aria-hidden className="icon-[lucide--chevron-right] size-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-5">
      <div className="flex flex-col items-center gap-4 text-center">
        <Mascot name="greeting" size={96} loading="lazy" />
        <h2 className={cn(HEADLINE, "whitespace-pre-line")}>
          {"사진으로 작물 상태를\n확인해보세요"}
        </h2>
        <p className="whitespace-pre-line break-keep text-[0.9375rem] leading-6 text-cropy-text-secondary">
          {"작물 사진을 찍거나 갤러리에서 선택하면\n진단 결과와 관리 방법을 확인할 수 있어요."}
        </p>
      </div>
      <Link
        href="/#guide"
        onClick={handleGuideClick}
        className={cn(
          "flex min-h-11 w-full items-center justify-center rounded-lg text-cropy-helper font-bold text-cropy-text-secondary",
          FOCUS,
        )}
      >
        촬영 방법 보기
      </Link>
      <p className="break-keep text-cropy-caption leading-[1.375rem] text-cropy-text-secondary">
        지난 진단은 이력에서 확인할 수 있어요.
      </p>
    </div>
  );
}
