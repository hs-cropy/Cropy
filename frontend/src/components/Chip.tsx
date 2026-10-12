import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

// crop: 1차 선택(작물) / grade: 2차 선택(등급)
type ChipKind = "crop" | "grade";

// 모바일은 디자인 시스템의 Cropy/V2/Filter/Chip 이다.
// lg 부터는 데스크탑 이력 화면의 필터 모양을 쓴다 (디자인 시스템과 다르고, 화면이 우선이다).
// 세로 여백은 큰글씨 모드에서 라벨이 두 줄이 될 때 글자가 테두리에 붙지 않게 한다
const BASE =
  "inline-flex min-w-0 items-center justify-center gap-2 break-keep border px-3 py-1 text-center transition [overflow-wrap:break-word] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary";

// crop: 128×48px·모서리 12px·16px → lg 폭 148px·안쪽 12px·테두리 없음
// grade: 80×36px·알약·13px → lg 폭 72px·안쪽 8px·모서리 8px·14px
// 모바일에서는 쓰는 쪽이 flex-1 을 줘 한 줄을 똑같이 나눈다. lg 부터는 고정 폭이다
const KIND: Record<ChipKind, string> = {
  crop: "min-h-12 w-32 rounded-xl text-cropy-body-lg lg:w-[9.25rem] lg:flex-none lg:border-0 lg:p-3",
  grade:
    "min-h-9 w-20 rounded-full text-cropy-caption lg:w-[4.5rem] lg:flex-none lg:rounded-lg lg:p-2 lg:text-cropy-helper",
};

// 글자 스타일 클래스가 굵기까지 정하므로 lg 에서 크기를 바꾸는 grade 는 굵기를 다시 적는다
const STATE: Record<ChipKind, { default: string; selected: string }> = {
  crop: {
    default:
      "border-cropy-border bg-cropy-surface font-medium text-cropy-text-secondary lg:bg-transparent lg:font-normal",
    selected:
      "border-cropy-action-primary bg-cropy-action-subtle font-bold text-cropy-action-primary",
  },
  grade: {
    default:
      "border-cropy-border bg-cropy-surface font-medium text-cropy-text-secondary lg:font-normal",
    // 선택 때 테두리를 없애면 크기가 1px 씩 달라지므로 색만 바꾼다
    selected:
      "border-cropy-text-primary bg-cropy-text-primary font-bold text-cropy-text-on-action lg:border-cropy-action-subtle lg:bg-cropy-action-subtle lg:font-bold lg:text-cropy-action-primary",
  },
};

// Figma 에 호버·누름 상태가 없어 보조 버튼과 같은 배경을 쓴다. 선택된 칩은 그대로 둔다
const HOVER =
  "[@media(hover:hover)]:[&:hover:not(:active)]:bg-cropy-surface-canvas active:bg-cropy-surface-canvas";

type ChipProps = Omit<ComponentPropsWithRef<"button">, "aria-pressed"> & {
  /** 선택 여부. 상태는 쓰는 쪽이 갖는다 */
  selected: boolean;
} & (
    | {
        kind: "crop";
        /** 건수. 데스크탑(lg)에서 라벨 옆에 보이고(0 도 보인다), 스크린리더에는 "2건"으로 항상 읽힌다 */
        count?: number;
      }
    | { kind: "grade"; count?: never }
  );

/**
 * 여러 개 중 하나를 고르는 필터 칩. 눌렀을 때 무엇을 고를지는 onClick 에서 쓰는 쪽이 정한다.
 * 한 묶음은 role="group" 과 aria-label 을 가진 요소로 감싼다. 묶음에서 하나는 항상 선택돼
 * 있고, 선택된 칩을 다시 눌러도 풀리지 않는다 (필터를 푸는 것은 "전체" 칩으로 한다).
 * 창 폭 1024px 부터 데스크탑 이력 화면의 필터 모양으로 바뀐다.
 */
export function Chip({
  kind,
  selected,
  count,
  type = "button",
  disabled = false,
  // 배치용(flex-1, 폭)으로만 쓴다. cn으로 병합되므로 색·크기 클래스를 넘기면 실제로 덮인다
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        BASE,
        KIND[kind],
        selected ? STATE[kind].selected : STATE[kind].default,
        // 디자인 시스템의 다른 컨트롤처럼 비활성은 전체를 48%로 흐리게 한다
        disabled ? "cursor-not-allowed opacity-[0.48]" : "cursor-pointer",
        !disabled && !selected && HOVER,
        className,
      )}
    >
      <span className="min-w-0">{children}</span>
      {/* 보이는 건수는 데스크탑에만 있지만, 이름은 화면 폭과 상관없이 "고추 2건"으로 같게 읽힌다 */}
      {count !== undefined && (
        <>
          <span aria-hidden className="hidden lg:inline">
            {count}
          </span>
          {/* 앞의 공백이 없으면 이름이 "고추2건"으로 붙는다 */}
          <span className="sr-only">{` ${count}건`}</span>
        </>
      )}
    </button>
  );
}
