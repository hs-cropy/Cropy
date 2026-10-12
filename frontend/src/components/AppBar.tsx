"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { VoiceToggle } from "@/features/voice";
import { TextSizeToggle } from "./TextSizeToggle";
import { useHomeTab } from "@/hooks/useHomeTab";

const NAV = [
  { href: "/#capture", label: "촬영" },
  { href: "/#diagnosis", label: "진단" },
  { href: "/history", label: "이력" },
];

export function AppBar() {
  const pathname = usePathname();
  const homeTab = useHomeTab();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex items-center gap-2.5 px-5 py-3.5 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-tint text-brown"
          >
            <span className="icon-[lucide--sprout] h-5 w-5" />
          </span>
          {/* 큰글씨·음성 토글이 나란히 들어가도록 좁은 화면에서는 로고 글자를 숨긴다
              (스크린리더용 링크 이름으로는 남긴다) */}
          <span className="sr-only leading-none sm:not-sr-only">
            <span className="block text-lg font-extrabold tracking-tight text-ink">CropCare</span>
            <span className="mt-0.5 block text-xs font-medium text-khaki">현장 병해충 진단</span>
          </span>
        </Link>

        {/* 큰글씨 토글은 화면 폭과 무관하게 항상 보여야 한다 (모바일에서 하단 탭이
            네비게이션을 가져가도 이 버튼은 앱바에 남는다) */}
        <div className="ml-auto flex items-center gap-2">
          <a href="/offline/index.html" className="rounded-full bg-brand-tint px-3 py-2 text-xs font-bold">기기 진단</a>
          <TextSizeToggle />
          <VoiceToggle />

          {/* Desktop nav — bottom tabs take over below md */}
          <nav className="hidden items-center gap-1.5 md:flex">
            {NAV.map((item) => {
              const active =
                item.href === "/history"
                  ? pathname.startsWith("/history")
                  : pathname === "/" &&
                    homeTab === (
                      item.href === "/#capture"
                        ? "capture"
                        : "diagnosis"
                    );

              const className = `rounded-full px-4 py-2.5 text-sm font-bold transition-colors ${
                active
                  ? "bg-[#EDF7F1] text-[#2E8B57]"
                  : "text-[#6B6B6B] hover:bg-[#F7F7F8]"
              }`;

              return item.href === "/history" ? (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={className}
                >
                  {item.label}
                </Link>
              ) : (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={className}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
