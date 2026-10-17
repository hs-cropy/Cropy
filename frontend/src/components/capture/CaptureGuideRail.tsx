import { useId, type MouseEventHandler } from "react";
import { cardClassName } from "@/components/Card";
import { cn } from "@/lib/cn";

const GUIDE_LINK_CLASS =
  "inline-flex min-h-12 w-60 items-center justify-center gap-2 self-start rounded-lg px-3 text-cropy-helper font-medium text-cropy-text-primary hover:text-cropy-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary";

const TIPS = [
  { title: "증상 부위를 충분히 크게", body: "주변 잎이나 열매도 함께 보여주세요." },
  { title: "색과 무늬가 보이게", body: "짙은 그림자와 강한 빛 반사를 피해주세요." },
  { title: "흔들림 없이 선명하게", body: "초점을 맞춘 다음 사진을 찍어주세요." },
];

/**
 * 데스크탑 촬영 화면 오른쪽의 "촬영 전 확인해주세요" (Capture/GuideRail):
 * 폭 344px·안쪽 24px·모서리 16px, 제목 20/28px, 번호 배지와 제목 15/24px·설명 14/22px.
 * 아래의 "그림으로 촬영 방법 보기"는 기본 촬영 가이드(#guide, D-03-2)로 간다. 높이 48px·폭 240px·14/22px.
 */
export function CaptureGuideRail({
  className,
  showGuideLink = true,
  onOpenGuide,
}: {
  className?: string;
  /** 권한 안내·사용 불가 화면에서는 링크를 두지 않는다 */
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
        촬영 전 확인해주세요
      </h2>
      <ol className="flex flex-col gap-4">
        {TIPS.map((tip, index) => (
          <li key={tip.title} className="flex items-start gap-3">
            <span
              aria-hidden
              className="shrink-0 rounded-full bg-cropy-surface-canvas px-2.5 py-1 text-cropy-label-xs font-medium text-cropy-text-secondary"
            >
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1 break-keep">
              <span className="text-cropy-feedback-body font-bold leading-6 text-cropy-text-primary">
                {tip.title}
              </span>
              <span className="text-cropy-helper text-cropy-text-secondary">{tip.body}</span>
            </span>
          </li>
        ))}
      </ol>
      {showGuideLink && (
        // 해시 링크라 뒤로 가기로 지금 화면에 돌아온다
        <a href="#guide" onClick={onOpenGuide} className={GUIDE_LINK_CLASS}>
          그림으로 촬영 방법 보기
          <span aria-hidden className="icon-[lucide--chevron-right] size-4" />
        </a>
      )}
    </section>
  );
}
