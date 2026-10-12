
import Link from "next/link";

import type { DiagnosisSummary } from "@/types/diagnosis";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface RecordRowProps {
  item: DiagnosisSummary;
  onOpen?: () => void;
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "날짜 정보 없음";
  }

  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    const time = new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);

    return `오늘 ${time}`;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(date);
}

export function RecordRow({
  item,
  onOpen,
}: RecordRowProps) {
  return (
    <li className="min-w-0">
      <Link
        href={`/history/${encodeURIComponent(item.id)}`}
        onClick={onOpen}
        className={[
          "flex min-h-[88px] items-center gap-3",
          "rounded-2xl border border-[#ECECEF]",
          "bg-white p-4 transition-colors",
          "hover:border-[#2E8B57]/40",
          "focus-visible:outline-2",
          "focus-visible:outline-[#2E8B57]",
        ].join(" ")}
      >
        {/* 사진이 없으면 회색 플레이스홀더 */}
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#F7F7F8]">
          {item.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </div>

        {/* 기록 정보 */}
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-bold leading-6 text-[#191919]">
            {item.disease_name}
          </p>

          <p className="mt-1 text-[13px] leading-5 text-[#6B6B6B]">
            {item.crop_type || "작물 미확인"}
            {" · "}
            {formatHistoryDate(item.created_at)}
          </p>

          {item.is_refined && (
            <p className="mt-1 text-xs font-semibold text-[#2E8B57]">
              재촬영으로 갱신됨
            </p>
          )}
        </div>

        <StatusBadge severity={item.severity} />
      </Link>
    </li>
  );
}
