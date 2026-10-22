import { useId, type MouseEventHandler } from "react";
import { cardClassName } from "@/components/Card";
import { cn } from "@/lib/cn";

const GUIDE_LINK_CLASS =
  "inline-flex min-h-12 w-60 items-center justify-center gap-2 self-start rounded-lg px-3 text-cropy-helper font-medium text-cropy-text-primary hover:text-cropy-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary";

/**
 * 데스크탑 사진 확인(D-01-5·D-01-6) 오른쪽의 "진단할 사진을 확인하세요" (Selected/ActionRail):
 * 폭 344px·안쪽 24px·모서리 16px·간격 16px, 제목 20/28px, 본문 16/24px.
 * 아래의 "촬영 방법 보기"는 기본 촬영 가이드(#guide, D-03-2)로 간다. 고른 사진은 그대로 남는다.
 */
export function PhotoCheckRail({
  className,
  showGuideLink = true,
  onOpenGuide,
}: {
  className?: string;
  /** 진단 중에는 가이드로 가지 않게 숨긴다 */
  showGuideLink?: boolean;
  /** 가이드 링크를 눌렀을 때 (앱 안에서 열었다는 표시) */
  onOpenGuide?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(cardClassName({ padding: "none" }), "flex flex-col gap-4 p-6", className)}
    >
      <h2 id={titleId} className="text-cropy-heading-md text-cropy-text-primary">
        진단할 사진을 확인하세요
      </h2>
      <p className="break-keep text-cropy-body-lg text-cropy-text-secondary">
        증상 부위와 주변 잎 또는 열매가 잘 보이나요? 사진이 어둡거나 흐리면 다른 사진을
        선택해주세요.
      </p>
      {showGuideLink && (
        <a href="#guide" onClick={onOpenGuide} className={GUIDE_LINK_CLASS}>
          촬영 방법 보기
          <span aria-hidden className="icon-[lucide--chevron-right] size-4" />
        </a>
      )}
    </section>
  );
}
