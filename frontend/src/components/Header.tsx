import Link from "next/link";
import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";
import type { NavItem } from "./navItem";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary";

// 모바일(Cropy/V2/Mobile/Header): 76px, 좌우 24px.
// lg 부터 데스크탑(Cropy/V2/Desktop/Header): 80px(아래 테두리 1px 포함), 본문 폭 최대 1200px.
// 배경은 없다. 디자인 시스템의 헤더는 배경색(모바일 회색·데스크탑 흰색)이 있지만 실제 화면에서는
// 틀의 농장 배경이 비치고, 화면이 우선이다. 배경이 필요한 곳은 className 으로 준다.
// Figma 는 390px 과 1440px 만 정의한다.
// - 1024px 미만은 내비 세 개가 들어갈 자리가 없어 모바일 모양을 쓴다 (큰글씨를 켜면 더 모자란다)
// - 1024~1279px 은 Figma 값(좌우 64px·간격 40px·항목 폭 112px)으로는 큰글씨에서 넘쳐서
//   여백과 간격을 줄이고, xl 부터 Figma 값을 쓴다
const BAR =
  "mx-auto flex h-[4.75rem] w-full max-w-[75rem] items-center gap-2 px-6 py-4 lg:h-[calc(5rem-1px)] lg:gap-4 lg:px-0 lg:py-0 xl:gap-10";

// 데스크탑 내비 항목: 폭 112px, 안쪽 12px, 모서리 8px, 아이콘 20px, 라벨 14/22px.
// 디자인 시스템의 Navigation/Web(88px·모서리 12px)과 값이 다른데, 실제 화면이 쓰는 쪽을 따른다
const NAV_ITEM =
  "flex items-center justify-center gap-2 whitespace-nowrap rounded-lg p-3 text-cropy-helper xl:w-28";

// 선택되지 않은 항목에 마우스를 올리면 연초록 배경이 가운데에서 둥글게 번져 나오고 글자가 초록이 된다.
// (Figma 에 호버 상태가 없어 정한 값. 손가락으로 누르는 기기에서는 호버가 남지 않게 뺀다)
// 배경은 글자 뒤의 ::before 로 그려서 크기와 투명도만 바꾼다
const NAV_ITEM_HOVER =
  "relative isolate transition-colors duration-200 before:absolute before:inset-0 before:-z-10 before:scale-50 before:rounded-full before:bg-cropy-action-subtle before:opacity-0 before:transition before:duration-200 before:ease-out [@media(hover:hover)]:hover:text-cropy-action-primary [@media(hover:hover)]:hover:before:scale-100 [@media(hover:hover)]:hover:before:opacity-100";

interface HeaderProps extends Omit<ComponentPropsWithRef<"header">, "children"> {
  /** lg 부터 보이는 내비 항목. 그보다 좁으면 하단 내비(MobileNav)가 대신한다 */
  items?: NavItem[];
  /** 현재 화면에 해당하는 항목의 key. 경로를 보고 정하는 일은 쓰는 쪽이 한다 */
  current?: string;
  /** 항목을 눌렀을 때. 이동은 링크가 하고, 쓰는 쪽이 event.preventDefault() 로 막을 수 있다 */
  onItemClick?: (item: NavItem, event: MouseEvent<HTMLAnchorElement>) => void;
  /** 로고를 눌렀을 때 갈 곳. 없으면 로고는 링크가 아니다 */
  homeHref?: string;
  homeLabel?: string;
  navLabel?: string;
  /** 오른쪽에 놓는 것 (큰 글자·음성 스위치). 상태와 동작은 쓰는 쪽이 갖는다 */
  actions?: ReactNode;
  /**
   * lg 미만에서 로고 대신 놓는 것 (이력 상세의 뒤로 버튼, Figma M-08 MobileShell/Back).
   * lg 부터는 데스크탑 화면(D-08)처럼 로고를 그대로 보인다
   */
  leading?: ReactNode;
}

/**
 * 화면 위의 헤더. 화면 위에 붙이는 배치(고정·겹침 순서)는 쓰는 쪽이 정한다.
 */
export function Header({
  items = [],
  current,
  onItemClick,
  homeHref,
  homeLabel = "Cropy 홈",
  navLabel = "주요 메뉴",
  actions,
  leading,
  className,
  ...rest
}: HeaderProps) {
  // 데스크탑 로고는 84×56px 이고 124px 자리를 차지한다 (Figma 의 Brand 영역).
  // 좁은 화면에서 큰글씨를 켜 자리가 모자라면 스위치가 밀려나는 대신 로고가 줄어든다
  const logo = "min-w-0 shrink lg:h-14 lg:w-[5.25rem]";

  return (
    <header
      {...rest}
      // 노치가 있는 기기에서는 그만큼 위를 띄운다
      className={cn(
        "shrink-0 pt-[env(safe-area-inset-top)] lg:border-b lg:border-cropy-border lg:px-6 xl:px-16",
        className,
      )}
    >
      <div className={BAR}>
        {leading && <div className="flex min-w-0 lg:hidden">{leading}</div>}
        <div
          className={cn(
            "flex min-w-0 xl:w-[7.75rem] xl:shrink-0",
            leading && "hidden lg:flex",
          )}
        >
          {homeHref ? (
            <Link
              href={homeHref}
              aria-label={homeLabel}
              className={cn("flex min-w-0 rounded-lg", FOCUS)}
            >
              <Logo alt="" className={logo} />
            </Link>
          ) : (
            <Logo className={logo} />
          )}
        </div>

        {items.length > 0 && (
          <nav aria-label={navLabel} className="hidden lg:block">
            <ul className="flex items-center gap-2">
              {items.map((item) => {
                const active = item.key === current;
                const content = (
                  <>
                    <span
                      aria-hidden
                      className={cn(item.headerIcon ?? item.icon, "h-5 w-5 shrink-0")}
                    />
                    {item.label}
                  </>
                );
                return (
                  <li key={item.key}>
                    {item.disabled ? (
                      // 갈 화면이 없는 항목: 모양은 선택되지 않은 항목과 같고 링크가 아니다
                      <span
                        role="link"
                        aria-disabled="true"
                        className={cn(NAV_ITEM, "font-medium text-cropy-text-secondary")}
                      >
                        {content}
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        onClick={(event) => onItemClick?.(item, event)}
                        className={cn(
                          NAV_ITEM,
                          FOCUS,
                          active
                            ? "bg-cropy-action-subtle font-bold text-cropy-action-primary"
                            : cn("font-medium text-cropy-text-secondary", NAV_ITEM_HOVER),
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
        )}

        <div className="min-w-0 flex-1" />

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
