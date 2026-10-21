import type { NavItem } from "./navItem";

// Figma 의 내비: 헤더는 새 진단·진단 결과·진단 이력, 모바일 하단은 촬영·진단·이력.
// 새 진단은 촬영 화면(/), 진단 결과는 진단 결과 화면(/diagnosis), 진단 이력은 /history 다.
// 진단 상태(고른 사진·결과)는 앱 틀이 갖고 있어 화면을 오가도 남는다 (DiagnosisSessionProvider)
export const APP_NAV_ITEMS: NavItem[] = [
  {
    key: "capture",
    href: "/",
    label: "새 진단",
    mobileLabel: "촬영",
    icon: "icon-[lucide--camera]",
    headerIcon: "icon-[lucide-20--camera]",
  },
  {
    key: "result",
    href: "/diagnosis",
    label: "진단 결과",
    mobileLabel: "진단",
    icon: "icon-[lucide--scan-search]",
    headerIcon: "icon-[lucide-20--scan-search]",
  },
  {
    key: "history",
    href: "/history",
    label: "진단 이력",
    mobileLabel: "이력",
    icon: "icon-[lucide--history]",
    headerIcon: "icon-[lucide-20--history]",
  },
];

/** 경로에 해당하는 내비 항목의 key. 어느 항목에도 속하지 않으면 undefined */
export function currentNavKey(pathname: string | null): string | undefined {
  if (pathname === "/") return "capture";
  if (pathname === "/diagnosis") return "result";
  if (pathname === "/history" || pathname?.startsWith("/history/")) return "history";
  return undefined;
}
