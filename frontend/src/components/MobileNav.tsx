import Link from "next/link";
import type { ComponentPropsWithRef, MouseEvent } from "react";
import { cn } from "@/lib/cn";
import type { NavItem } from "./navItem";

// 디자인 시스템의 Cropy/V2/Navigation/Mobile. 높이 72px, 항목 56px, 아이콘 24px, 라벨 12px.
// 선택된 항목은 색과 굵기로만 표시한다 (배경 없음)
const ITEM =
  "flex h-14 flex-col items-center justify-center gap-1 break-keep rounded-lg text-center text-cropy-label-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary";

interface MobileNavProps extends Omit<ComponentPropsWithRef<"nav">, "children"> {
  items: NavItem[];
  /** 현재 화면에 해당하는 항목의 key. 경로를 보고 정하는 일은 쓰는 쪽이 한다 */
  current?: string;
  /** 항목을 눌렀을 때. 이동은 링크가 하고, 쓰는 쪽이 event.preventDefault() 로 막을 수 있다 */
  onItemClick?: (item: NavItem, event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * 모바일 화면 아래의 내비게이션.
 * 화면 아래에 붙이는 배치(고정·겹침 순서)와, 헤더 안의 내비가 대신하는 넓은 화면에서
 * 숨기는 일(className="lg:hidden", Header 의 내비가 lg 부터 보인다)은 쓰는 쪽이 정한다.
 */
export function MobileNav({
  items,
  current,
  onItemClick,
  className,
  "aria-label": ariaLabel = "하단 메뉴",
  ...rest
}: MobileNavProps) {
  return (
    <nav
      {...rest}
      aria-label={ariaLabel}
      // 홈 인디케이터가 있는 기기에서는 그만큼 아래를 띄운다
      className={cn("shrink-0 bg-cropy-surface pb-[env(safe-area-inset-bottom)]", className)}
    >
      <ul className="flex h-[4.5rem] items-center px-6 py-2">
        {items.map((item) => {
          const active = item.key === current;
          const content = (
            <>
              <span aria-hidden className={cn(item.icon, "h-6 w-6 shrink-0")} />
              {item.mobileLabel ?? item.label}
            </>
          );
          return (
            <li key={item.key} className="min-w-0 flex-1">
              {item.disabled ? (
                // 갈 화면이 없는 항목: 링크가 아니다. current 로 지정되면
                // 선택된 모양으로 보이고 현재 위치로 읽힌다
                <span
                  role="link"
                  aria-disabled="true"
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    ITEM,
                    active
                      ? "font-bold text-cropy-action-primary"
                      : "font-medium text-cropy-text-secondary",
                  )}
                >
                  {content}
                </span>
              ) : (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => onItemClick?.(item, event)}
                  className={cn(
                    ITEM,
                    active
                      ? "font-bold text-cropy-action-primary"
                      : "font-medium text-cropy-text-secondary",
                  )}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
