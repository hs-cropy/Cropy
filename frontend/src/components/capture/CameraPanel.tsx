import type { Ref, RefObject } from "react";
import { cardClassName } from "@/components/Card";
import { Mascot } from "@/components/Mascot";
import { Switch } from "@/components/Switch";
import { cn } from "@/lib/cn";
import type { CameraStatus } from "@/types/camera";

interface CameraPanelProps {
  /** 카메라 스위치가 켜져 있는지 (M-01·D-01-1) / 꺼져 있는지 (M-01-1·D-01-2) */
  on: boolean;
  status: CameraStatus;
  videoRef: RefObject<HTMLVideoElement | null>;
  onToggle: (next: boolean) => void;
  /** 새 진단 뒤 초점을 받을 카메라 스위치 */
  switchRef?: Ref<HTMLButtonElement>;
  /** 꺼짐 안내 문구의 id. 비활성인 "사진 찍기" 버튼이 이유로 가리킨다 */
  offMessageId: string;
  /**
   * 스트림은 열렸지만 영상 재생이 막혔다 (자동재생 차단 등). 영상 요소를 그대로 두고
   * 안내만 띄운다 — 다시 시도가 클릭 안에서 바로 play() 해야 풀린다
   */
  playFailed?: boolean;
  /** 데스크탑 시안(D-01-1·D-01-2)의 제목·꺼짐 안내를 쓴다 */
  desktop?: boolean;
  /** 꺼짐 마스코트를 받는 때. 숨겨져 있을 수 있으면 "lazy" */
  mascotLoading?: "lazy" | "eager";
}

/**
 * 촬영 화면의 카메라 카드 (Camera/Panel): 머리줄(제목·카메라 스위치)과 프리뷰 영역.
 * 모바일: 높이 320px·모서리 20px·안쪽 16px, 머리줄에 카메라 아이콘, 꺼지면 마스코트 72px.
 * 데스크탑: 모서리 16px·안쪽 24px, 프리뷰 높이 328px, 꺼지면 카메라 아이콘 40px.
 * 카메라를 켜고 끄는 일(권한 요청 포함)은 쓰는 쪽이 onToggle 에서 한다.
 */
export function CameraPanel({
  on,
  status,
  videoRef,
  onToggle,
  switchRef,
  offMessageId,
  playFailed = false,
  desktop = false,
  mascotLoading,
}: CameraPanelProps) {
  const title = desktop
    ? on
      ? "카메라 프리뷰"
      : "카메라가 꺼져 있어요"
    : on
      ? "실시간 프리뷰"
      : "카메라 꺼짐";

  return (
    <section
      aria-label="카메라"
      className={cn(
        cardClassName({ radius: desktop ? "md" : "lg", padding: "none" }),
        // 큰글씨 모드에서 안내가 길어지면 카드가 늘어난다
        desktop ? "flex flex-col gap-4 p-6" : "flex min-h-80 flex-col gap-3 p-4",
      )}
    >
      <div className={cn("flex min-h-11 items-center", desktop ? "gap-4" : "gap-3")}>
        <h2
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 break-keep text-cropy-text-primary",
            desktop ? "text-cropy-feedback-title" : "text-cropy-caption font-bold",
          )}
        >
          {!desktop && <span aria-hidden className="icon-[lucide--camera] size-6 shrink-0" />}
          {title}
        </h2>
        <Switch ref={switchRef} checked={on} onCheckedChange={onToggle} className="lg:w-28">
          카메라
        </Switch>
      </div>

      <div
        className={cn(
          "relative flex flex-col items-center justify-center overflow-hidden rounded-xl bg-cropy-surface-canvas p-3 text-center",
          desktop ? "min-h-[20.5rem] gap-3" : "min-h-48 flex-1 gap-2",
        )}
      >
        {/* live region 은 켜고 끄는 것과 상관없이 늘 있어야 문구가 바뀔 때 스크린리더가 읽는다 */}
        <p
          role="status"
          className={cn(
            "relative z-10 empty:hidden",
            playFailed
              ? "rounded-lg bg-scrim/80 px-3 py-2 text-cropy-caption font-medium text-cropy-text-on-action"
              : "text-cropy-caption text-cropy-text-secondary",
          )}
        >
          {on && status === "opening"
            ? "카메라를 여는 중…"
            : playFailed
              ? "카메라 화면을 띄우지 못했어요. 아래 다시 시도를 눌러주세요."
              : ""}
        </p>
        {on ? (
          <>
            {/* useCaptureFrame 이 object-cover·가운데 기준으로 보이는 영역만 자른다 */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              aria-label="카메라 미리보기"
              className="absolute inset-0 size-full object-cover"
            />
            {status === "streaming" && (
              <p className="absolute inset-x-3 bottom-3 rounded-full bg-scrim/80 px-3 py-1.5 text-cropy-caption font-medium text-cropy-text-on-action">
                증상 부위를 화면에 맞춰주세요
              </p>
            )}
          </>
        ) : desktop ? (
          <>
            <span aria-hidden className="icon-[lucide--camera] size-10 text-cropy-text-secondary" />
            <p
              id={offMessageId}
              className="break-keep text-cropy-feedback-title font-medium text-cropy-text-secondary"
            >
              카메라를 켜면 촬영할 수 있어요
            </p>
          </>
        ) : (
          <>
            <Mascot name="camera-off" size={72} loading={mascotLoading} />
            <p className="text-cropy-body-lg font-bold text-cropy-text-primary">
              카메라가 꺼져 있어요
            </p>
            <p
              id={offMessageId}
              className="whitespace-pre-line break-keep text-cropy-caption text-cropy-text-secondary"
            >
              {"위 토글을 켜면 다시 촬영할 수 있어요.\n갤러리 사진은 계속 선택할 수 있어요."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
