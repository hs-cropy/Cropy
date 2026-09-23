"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "진단", icon: "icon-[lucide--camera]", match: (p: string) => p === "/" },
  {
    href: "/camera",
    label: "촬영",
    icon: "icon-[lucide--camera]",
    match: (p: string) => p.startsWith("/camera"),
  },
  {
    href: "/history",
    label: "이력",
    icon: "icon-[lucide--history]",
    match: (p: string) => p.startsWith("/history"),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  // 카메라 화면은 풀스크린 뷰파인더라 앱 네비게이션을 그리지 않는다
  if (pathname.startsWith("/camera")) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-app grid-cols-3">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs font-bold transition-colors ${
                active ? "text-ink" : "text-khaki hover:text-ink"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors ${
                  active ? "bg-brand-tint" : ""
                }`}
              >
                <span className={`${tab.icon} h-[1.375rem] w-[1.375rem]`} />
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
