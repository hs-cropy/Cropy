
import type { Severity } from "@/types/diagnosis";

interface StatusBadgeProps {
  severity?: Severity | null;
}

const STATUS = {
  high: {
    label: "위험",
    className: "bg-[#FFF1F0] text-[#B42318]",
  },
  medium: {
    label: "주의",
    className: "bg-[#FFF4DB] text-[#855600]",
  },
  low: {
    label: "낮음",
    className: "bg-[#EDF7F1] text-[#26784B]",
  },
};

export function StatusBadge({
  severity,
}: StatusBadgeProps) {
  if (!severity) return null;

  const status = STATUS[severity];

  if (!status) return null;

  return (
    <span
      className={[
        "inline-flex min-h-7 shrink-0 items-center",
        "justify-center rounded-full px-3 py-1",
        "text-sm font-bold",
        status.className,
      ].join(" ")}
    >
      {status.label}
    </span>
  );
}
