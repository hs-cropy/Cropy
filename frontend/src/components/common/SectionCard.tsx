import type { HTMLAttributes, ReactNode } from "react";

interface SectionCardProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  children: ReactNode;
  description?: string;
}

export function SectionCard({ title, description, children, className = "", ...props }: SectionCardProps) {
  return (
    <section className={`rounded-2xl border border-[#ECECEF] bg-white p-5 ${className}`} {...props}>
      {title && <h2 className="text-lg font-bold text-[#191919]">{title}</h2>}
      {description && <p className="mt-1 text-sm leading-6 text-[#6B6B6B]">{description}</p>}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
