import type { NavItem } from "./navItem";

// 실제로 있는 화면만 넣는다. Figma 의 내비는 촬영·진단·이력 세 개인데,
// 촬영은 아직 화면(경로)이 아니라 진단 화면 안의 오버레이라서 탭으로 두지 않았다
export const APP_NAV_ITEMS: NavItem[] = [
  {
    key: "diagnose",
    href: "/",
    label: "새 진단",
    mobileLabel: "진단",
    icon: "icon-[lucide--camera]",
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
  if (pathname === "/") return "diagnose";
  if (pathname === "/history" || pathname?.startsWith("/history/")) return "history";
  return undefined;
}
