
import type { Severity } from "@/types/diagnosis";
import { Badge } from "@/components/Badge";

interface StatusBadgeProps {
  severity?: Severity | null;
}

const STATUS: Record<
  Severity,
  { label: string; tone: "attention" | "low" }
> = {
  high: {
    label: "위험",
    tone: "attention",
  },
  medium: {
    label: "주의",
    tone: "attention",
  },
  low: {
    label: "낮음",
    tone: "low",
  },
};

export function StatusBadge({
  severity,
}: StatusBadgeProps) {
  if (!severity) return null;

  const status = STATUS[severity];

  if (!status) return null;

  return (
    <Badge tone={status.tone} variant="pill">
      {status.label}
    </Badge>
  );
}
