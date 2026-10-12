import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary";
// default: 화면 하단 행동 버튼(52px) / compact: 다이얼로그·안내 카드 안 버튼(44px)
type ButtonSize = "default" | "compact";

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

// Tailwind가 클래스를 찾을 수 있도록 조각을 이어 붙이지 않고 완성된 문자열로 둔다
const BASE =
  "inline-flex items-center justify-center gap-2 border text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-green-600";

// 세로 여백은 큰글씨 모드에서 라벨이 두 줄이 될 때 글자가 가장자리에 붙지 않게 한다
const SIZE: Record<ButtonSize, string> = {
  default: "min-h-cropy-button-mobile px-4 py-2 text-sm font-bold leading-6",
  compact: "min-h-cropy-control-md px-3 py-2 text-cropy-compact-button",
};

// Figma에서 보조 버튼만 12px이고 주요·비활성은 14px이다
const RADIUS: Record<ButtonSize, Record<ButtonVariant | "disabled", string>> = {
  default: { primary: "rounded-cropy-14", secondary: "rounded-xl", disabled: "rounded-cropy-14" },
  compact: {
    primary: "rounded-[0.625rem]",
    secondary: "rounded-[0.625rem]",
    disabled: "rounded-[0.625rem]",
  },
};

// 주요·비활성 버튼에도 투명 테두리를 둬 보조 버튼과 안쪽 크기를 맞춘다
const COLOR: Record<ButtonVariant | "disabled", string> = {
  primary: "border-transparent bg-cropy-green-600 text-cropy-text-on-action",
  secondary: "border-cropy-border bg-cropy-surface text-cropy-text-primary",
  disabled: "border-transparent bg-cropy-action-disabled text-cropy-text-disabled",
};

// Figma에 누름·호버 상태가 없어 색을 새로 만들지 않고 밝기와 크기로만 표시한다.
// 커서도 여기서 정하므로 label·Link 쪽에서 cursor-pointer를 따로 붙이지 않는다
// (붙이면 비활성일 때도 눌릴 것처럼 보인다)
const INTERACTIVE = "cursor-pointer hover:brightness-95 active:scale-[0.99]";

/**
 * 버튼 모양만 필요한 곳(Link, 파일 선택 label)에 쓴다. 그 밖에는 Button을 쓴다.
 * disabled와 loading이 함께면 비활성 모양이 우선한다.
 * label은 초점을 받지 않으므로 초점 표시는 호출부에서 따로 챙겨야 한다.
 */
export function buttonClassName({
  variant = "primary",
  size = "default",
  fullWidth = false,
  disabled = false,
  loading = false,
}: ButtonStyleOptions = {}) {
  const look = disabled ? "disabled" : variant;
  return cn(
    BASE,
    SIZE[size],
    RADIUS[size][look],
    COLOR[look],
    disabled ? "cursor-not-allowed" : loading ? "cursor-wait" : INTERACTIVE,
    fullWidth && "w-full",
  );
}

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /**
   * 진행 중에는 색을 유지한 채 스피너를 보이고 누를 수 없게 한다.
   * 스피너는 스크린리더에 읽히지 않으니 라벨도 "저장 중…"처럼 바꿔서 넘긴다.
   */
  loading?: boolean;
  /** 라벨 앞에 놓는 아이콘. aria-hidden 을 붙여서 넘긴다 */
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  icon,
  // form 안에서 뜻하지 않게 제출되지 않도록 기본은 button. 제출 버튼은 submit을 명시한다
  type = "button",
  disabled = false,
  // 배치용(flex-1, 폭, 여백, block)으로만 쓴다. cn으로 병합되므로 색·크기·초점 표시
  // 클래스를 넘기면 Figma 사양이 실제로 덮인다
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClassName({ variant, size, fullWidth, disabled, loading }), className)}
      {...rest}
    >
      {loading ? (
        <span aria-hidden className="icon-[lucide--loader-circle] h-5 w-5 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
