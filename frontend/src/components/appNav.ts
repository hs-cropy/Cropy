import type { NavItem } from "./navItem";

// Figma 의 내비: 헤더는 새 진단·진단 결과·진단 이력, 모바일 하단은 촬영·진단·이력.
// "진단 결과"는 아직 자기 화면(경로)이 없다. 진단 결과가 "/" 화면 안의 상태이기 때문이다.
// 그래서 지금은 자리만 차지하고 누를 수 없다(disabled).
// 결과 화면에 경로가 생기면 href 를 고치고 disabled 를 지운 뒤 currentNavKey 에 넣는다
export const APP_NAV_ITEMS: NavItem[] = [
  {
    key: "capture",
    href: "/",
    label: "새 진단",
    mobileLabel: "촬영",
    icon: "icon-[lucide--camera]",
  },
  {
    key: "result",
    href: "/",
    label: "진단 결과",
    mobileLabel: "진단",
    icon: "icon-[lucide--scan-search]",
    disabled: true,
  },
  {
    key: "history",
    href: "/history",
    label: "진단 이력",
    mobileLabel: "이력",
    icon: "icon-[lucide--history]",
  },
];

/** 경로에 해당하는 내비 항목의 key. 어느 항목에도 속하지 않으면 undefined */
export function currentNavKey(pathname: string | null): string | undefined {
  if (pathname === "/") return "capture";
  if (pathname === "/history" || pathname?.startsWith("/history/")) return "history";
  return undefined;
}
