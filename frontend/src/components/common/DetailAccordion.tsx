"use client";

import { useState } from "react";

export type DetailSection = { id: string; title: string; content: React.ReactNode };

export function DetailAccordion({ items }: { items: DetailSection[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const isOpen = openId === item.id;
        const panelId = `detail-panel-${item.id}`;
        return (
          <section key={item.id} className="overflow-hidden rounded-2xl border border-[#ECECEF] bg-white">
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenId(isOpen ? null : item.id)}
                className="flex min-h-[56px] w-full items-center justify-between gap-3 px-5 py-3 text-left text-base font-bold text-[#191919] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#2E8B57]"
              >
                {item.title}
                <span aria-hidden="true" className={`text-[#6B6B6B] transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}>⌄</span>
              </button>
            </h3>
            <div id={panelId} hidden={!isOpen} className="border-t border-[#ECECEF] px-5 py-4 text-base leading-7 text-[#191919]">
              {item.content}
            </div>
          </section>
        );
      })}
    </div>
  );
}
