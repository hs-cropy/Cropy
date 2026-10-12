import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "default" | "compact";

interface AppButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-[#2E8B57] text-white hover:bg-[#26784B] active:bg-[#1F633D]",
  secondary: "border border-[#2E8B57] bg-[#EDF7F1] text-[#1F633D] hover:bg-[#dcefe4]",
  ghost: "border border-[#ECECEF] bg-white text-[#191919] hover:bg-[#F7F7F8]",
  danger: "bg-[#D92D20] text-white hover:bg-[#b42318]",
};

export function AppButton({ children, variant = "primary", size = "default", fullWidth = false, className = "", type = "button", ...props }: AppButtonProps) {
  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E8B57]",
        "disabled:cursor-not-allowed disabled:bg-[#ECECEF] disabled:text-[#A5A5A5] disabled:border-transparent",
        size === "default" ? "min-h-[52px] text-base" : "min-h-11 text-sm",
        variants[variant],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
