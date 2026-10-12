
"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

interface AppButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: "page" | "feedback";
  fullWidth?: boolean;
  loading?: boolean;
}

export function AppButton({
  children,
  variant = "primary",
  size = "page",
  fullWidth = true,
  loading = false,
  disabled,
  className = "",
  type = "button",
  ...props
}: AppButtonProps) {
  const variantClasses = {
    primary:
      "bg-[#2E8B57] text-white hover:bg-[#26784B] active:bg-[#1F633D]",
    secondary:
      "border border-[#2E8B57] bg-white text-[#2E8B57] hover:bg-[#EDF7F1]",
  };

  const sizeClasses = {
    page: "min-h-[3.25rem] md:min-h-[3rem]",
    feedback: "min-h-[2.75rem]",
  };

  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading}
      className={[
        "inline-flex items-center justify-center gap-2",
        "rounded-xl px-5 py-3 text-base font-semibold",
        "transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        "focus-visible:outline-[#2E8B57]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
    >
      {loading ? "처리 중..." : children}
    </button>
  );
}
