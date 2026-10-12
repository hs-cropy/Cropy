import type { ReactNode } from "react";
import { StatusBadge } from "./StatusBadge";

type Grade = "high" | "medium" | "low" | "recapture";

interface RecordRowProps {
  diseaseName: string;
  crop: string;
  dateLabel: string;
  grade: Grade;
  onClick?: () => void;
  trailing?: ReactNode;
}

export function RecordRow({ diseaseName, crop, dateLabel, grade, onClick, trailing }: RecordRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-24 w-full items-center justify-between gap-3 rounded-2xl border border-[#ECECEF] bg-white p-4 text-left transition-colors hover:bg-[#F7F7F8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2E8B57]"
    >
      <span className="min-w-0">
        <span className="block truncate text-base font-bold text-[#191919]">{diseaseName}</span>
        <span className="mt-1 block text-sm text-[#6B6B6B]">{crop} · {dateLabel}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {trailing ?? <StatusBadge status={grade} />}
        <span aria-hidden="true" className="text-lg text-[#6B6B6B]">›</span>
      </span>
    </button>
  );
}
