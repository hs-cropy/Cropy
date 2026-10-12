import type { ReactNode } from "react";
import { AppButton } from "./AppButton";

type Kind = "empty" | "error" | "loading" | "info";
interface Props {
  title: string;
  description: string;
  kind?: Kind;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  icon?: ReactNode;
}

const symbols: Record<Kind, string> = { empty: "▢", error: "!", loading: "◌", info: "i" };

export function FeedbackPanel({ title, description, kind = "info", actionLabel, onAction, secondaryLabel, onSecondary, icon }: Props) {
  return (
    <section role={kind === "error" ? "alert" : "status"} className="rounded-2xl border border-[#ECECEF] bg-white px-5 py-8 text-center">
      <div aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#EDF7F1] text-3xl font-bold text-[#2E8B57]">
        {icon ?? symbols[kind]}
      </div>
      <h2 className="mt-4 text-lg font-bold text-[#191919]">{title}</h2>
      <p className="mt-2 whitespace-pre-line text-base leading-6 text-[#6B6B6B]">{description}</p>
      {(actionLabel || secondaryLabel) && (
        <div className="mt-6 flex flex-col gap-2">
          {actionLabel && onAction && <AppButton fullWidth size="compact" onClick={onAction}>{actionLabel}</AppButton>}
          {secondaryLabel && onSecondary && <AppButton fullWidth size="compact" variant="ghost" onClick={onSecondary}>{secondaryLabel}</AppButton>}
        </div>
      )}
    </section>
  );
}
