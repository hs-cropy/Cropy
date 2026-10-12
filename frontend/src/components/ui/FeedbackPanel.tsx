
import type { ReactNode } from "react";
import { AppCard } from "./AppCard";

interface FeedbackPanelProps {
  title: string;
  description: string;
  variant?: "info" | "warning" | "error";
  children?: ReactNode;
}

export function FeedbackPanel({
  title,
  description,
  variant = "info",
  children,
}: FeedbackPanelProps) {
  const styles = {
    info: {
      icon: "icon-[lucide--info]",
      background: "bg-[#EDF7F1]",
      text: "text-[#2E8B57]",
    },
    warning: {
      icon: "icon-[lucide--circle-alert]",
      background: "bg-amber-50",
      text: "text-amber-800",
    },
    error: {
      icon: "icon-[lucide--triangle-alert]",
      background: "bg-[#FFF1F0]",
      text: "text-[#D92D20]",
    },
  };

  const style = styles[variant];

  return (
    <AppCard className="text-center">
      <div
        role={variant === "error" ? "alert" : "status"}
        className="flex flex-col items-center"
      >
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-full ${style.background}`}
        >
          <span
            aria-hidden="true"
            className={`${style.icon} h-8 w-8 ${style.text}`}
          />
        </div>

        <h2 className="mt-4 text-lg font-bold text-[#191919]">
          {title}
        </h2>

        <p className="mt-2 whitespace-pre-line text-base leading-6 text-[#6B6B6B]">
          {description}
        </p>
      </div>

      {children && (
        <div className="mt-6 flex flex-col gap-3">
          {children}
        </div>
      )}
    </AppCard>
  );
}
