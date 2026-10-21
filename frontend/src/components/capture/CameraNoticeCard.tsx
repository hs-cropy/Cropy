import { cardClassName } from "@/components/Card";
import { cn } from "@/lib/cn";

interface CameraNoticeCardProps {
  title: string;
  /** \n 에서 줄을 바꾼다 */
  body: string;
  /** 오류(사용 불가)면 나타나자마자 읽어 준다 */
  alert?: boolean;
  /** 데스크탑 시안(D-01-3·D-01-4)의 크기를 쓴다 */
  desktop?: boolean;
}

/**
 * 카메라 권한 안내·사용 불가의 안내 카드 (Permission/Information). 버튼은 화면 아래 행동 영역에 둔다.
 * 모바일(M-01-2·M-01-3): 아이콘 32px, 제목 20/28px, 본문 15/22px, 안쪽 좌우 20px·상하 24px, 간격 16px.
 * 데스크탑(D-01-3·D-01-4): 아이콘 64px, 제목 24/32px, 본문 16/28px, 안쪽 24px, 모서리 16px.
 * 옆의 촬영 안내 카드와 높이를 맞추고 내용은 위아래로 벌린다.
 */
export function CameraNoticeCard({
  title,
  body,
  alert = false,
  desktop = false,
}: CameraNoticeCardProps) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn(
        cardClassName({ radius: desktop ? "md" : "lg", padding: "none" }),
        desktop
          ? "flex flex-1 flex-col items-start justify-between gap-6 p-6"
          : "flex flex-col items-start gap-4 px-5 py-6",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "icon-[lucide--camera] text-cropy-text-secondary",
          desktop ? "size-16" : "size-8",
        )}
      />
      {/* 카드가 늘어나도 제목과 본문은 한 묶음으로 아래에 붙는다 */}
      <div className={cn("flex flex-col", desktop ? "gap-6" : "gap-4")}>
        <h2
          className={cn(
            "break-keep text-cropy-text-primary",
            desktop ? "text-cropy-heading-lg" : "text-cropy-heading-md",
          )}
        >
          {title}
        </h2>
        <p
          className={cn(
            "whitespace-pre-line break-keep text-cropy-text-secondary",
            desktop ? "text-cropy-body-lg leading-7" : "text-cropy-feedback-body",
          )}
        >
          {body}
        </p>
      </div>
    </div>
  );
}
