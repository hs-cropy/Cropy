import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

// 디자인 시스템의 Cropy/V2/Toggle. 라벨과 스위치가 한 버튼이다.
// 모바일(Device=Mobile)이 기본이고 md 부터 웹 크기(Device=Web)가 된다.
// 라벨은 12px·13px Medium 이라 가까운 글자 스타일에 굵기만 맞춘다
const BASE =
  "inline-flex min-h-cropy-control-md items-center justify-center gap-1.5 break-keep rounded-xl border border-cropy-border bg-cropy-surface p-2 text-cropy-label-xs font-medium text-cropy-text-secondary [overflow-wrap:break-word] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary md:gap-2 md:text-cropy-caption md:font-medium";

// 트랙 30×18 → 36×20, 손잡이 14 → 16 (트랙 안쪽 2px)
const TRACK =
  "relative h-[1.125rem] w-[1.875rem] shrink-0 rounded-full transition-colors md:h-5 md:w-9";
const THUMB =
  "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-cropy-surface transition-transform md:h-4 md:w-4";

interface SwitchProps extends Omit<
  ComponentPropsWithRef<"button">,
  "role" | "aria-checked" | "aria-pressed"
> {
  /** 켜짐 여부. 상태는 쓰는 쪽이 갖는다 (설정 저장, 음성 실행 실패 시 되돌리기 등) */
  checked: boolean;
  /** 눌렀을 때 바뀔 값을 넘긴다 */
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * 켜짐·꺼짐을 바꾸는 스위치. 스크린리더가 상태를 "켜짐/꺼짐"으로 읽어 주므로
 * 라벨에는 상태와 무관한 이름만 쓴다 ("카메라 켜짐" 대신 "카메라").
 * 화면 폭에 따라 보이는 글자가 달라지고 짧은 쪽이 긴 쪽에 들어 있으면(모바일 "음성" /
 * 웹 "음성 안내") aria-label 로 이름을 긴 쪽 하나로 고정하고 보이는 글자만 바꾼다.
 * 서로를 포함하지 않으면("큰 글자" / "글자 크게") 고정하지 않는다 — 숨긴 쪽은 display:none 이라
 * 보이는 글자가 그대로 이름이 된다.
 */
export function Switch({
  checked,
  onCheckedChange,
  onClick,
  type = "button",
  disabled = false,
  // 배치용(폭, 여백)으로만 쓴다. cn으로 병합되므로 색·크기 클래스를 넘기면 실제로 덮인다
  className,
  children,
  ...rest
}: SwitchProps) {
  return (
    <button
      {...rest}
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked);
      }}
      className={cn(
        BASE,
        // 디자인 시스템의 State=Disabled 는 전체를 48%로 흐리게 한다
        disabled ? "cursor-not-allowed opacity-[0.48]" : "cursor-pointer",
        className,
      )}
    >
      <span className="min-w-0">{children}</span>
      <span
        aria-hidden
        className={cn(TRACK, checked ? "bg-cropy-action-primary" : "bg-cropy-border")}
      >
        <span className={cn(THUMB, checked ? "translate-x-3 md:translate-x-4" : "translate-x-0")} />
      </span>
    </button>
  );
}
