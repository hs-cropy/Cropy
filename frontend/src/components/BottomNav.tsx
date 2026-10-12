
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHomeTab } from "@/hooks/useHomeTab";

const TABS = [
  {
    href: "/#capture",
    label: "촬영",
    icon: "icon-[lucide--camera]",
    tab: "capture",
  },
  {
    href: "/#diagnosis",
    label: "진단",
    icon: "icon-[lucide--scan-search]",
    tab: "diagnosis",
  },
  {
    href: "/history",
    label: "이력",
    icon: "icon-[lucide--history]",
    tab: "history",
  },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const homeTab = useHomeTab();

  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-[#ECECEF] bg-white/95 backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-app grid-cols-3">
        {TABS.map((tab) => {
          const active =
            tab.tab === "history"
              ? pathname.startsWith("/history")
              : pathname === "/" && homeTab === tab.tab;

          const className = [
            "flex min-h-[4rem] flex-col items-center",
            "justify-center gap-1 px-2 py-2",
            "text-sm font-semibold transition-colors",
            active
              ? "text-[#2E8B57]"
              : "text-[#6B6B6B] hover:text-[#191919]",
          ].join(" ");

          const content = (
            <>
              <span
                aria-hidden="true"
                className={`flex h-8 w-14 items-center justify-center rounded-full ${
                  active ? "bg-[#EDF7F1]" : ""
                }`}
              >
                <span className={`${tab.icon} h-6 w-6`} />
              </span>
              <span>{tab.label}</span>
            </>
          );

          // 같은 페이지의 탭 이동은 브라우저 해시를 사용해
          // DiagnoseForm 상태를 유지한다.
          if (tab.tab !== "history") {
            return (
              <a
                key={tab.tab}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={className}
              >
                {content}
              </a>
            );
          }

          return (
            <Link
              key={tab.tab}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={className}
            >
              {content}
            </Link>
          );
        })}
      </div>

      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
