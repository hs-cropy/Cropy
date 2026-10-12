
"use client";

import { useId, type ReactNode } from "react";

interface AccordionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function Accordion({
  title,
  open,
  onToggle,
  children,
}: AccordionProps) {
  const id = useId();
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#ECECEF] bg-white">
      <h3>
        <button
          id={headerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={[
            "flex min-h-[3.25rem] w-full items-center",
            "justify-between gap-4 px-5 py-4",
            "text-left text-base font-bold text-[#191919]",
            "transition-colors hover:bg-[#EDF7F1]",
            "focus-visible:outline-2",
            "focus-visible:outline-inset",
            "focus-visible:outline-[#2E8B57]",
          ].join(" ")}
        >
          <span>{title}</span>

          <span
            aria-hidden="true"
            className={[
              "icon-[lucide--chevron-down]",
              "h-5 w-5 shrink-0 text-[#6B6B6B]",
              "transition-transform duration-200",
              "motion-reduce:transition-none",
              open ? "rotate-180" : "",
            ].join(" ")}
          />
        </button>
      </h3>

      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        aria-hidden={!open}
        className={[
          "grid transition-[grid-template-rows]",
          "duration-200 ease-in-out",
          "motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        ].join(" ")}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-[#ECECEF] px-5 pb-5 pt-4">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
