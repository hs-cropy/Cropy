
import type { HTMLAttributes, ReactNode } from "react";

interface AppCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: "normal" | "large";
}

export function AppCard({
  children,
  padding = "normal",
  className = "",
  ...props
}: AppCardProps) {
  return (
    <div
      {...props}
      className={[
        "rounded-2xl border border-[#ECECEF]",
        "bg-white shadow-sm",
        padding === "large" ? "p-6" : "p-5",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
