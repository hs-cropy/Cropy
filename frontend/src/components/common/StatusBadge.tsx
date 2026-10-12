type Status = "high" | "medium" | "low" | "recapture";

const meta: Record<Status, { label: string; style: string }> = {
  high: { label: "위험", style: "bg-[#FFF1F0] text-[#B42318]" },
  medium: { label: "주의", style: "bg-[#FFF5E8] text-[#965A13]" },
  low: { label: "낮음", style: "bg-[#EDF7F1] text-[#1F633D]" },
  recapture: { label: "재촬영", style: "bg-[#F0F1F5] text-[#444B5A]" },
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  return <span className={`inline-flex min-h-7 items-center rounded-full px-3 text-xs font-bold ${meta[status].style}`}>{label ?? meta[status].label}</span>;
}
