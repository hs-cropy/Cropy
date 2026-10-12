
import Link from "next/link";

import type { DiagnosisSummary } from "@/types/diagnosis";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface RecordRowProps {
  item: DiagnosisSummary;
  onOpen?: () => void;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "날짜 정보 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function RecordRow({
  item,
  onOpen,
}: RecordRowProps) {
  const confidence = Math.round(item.confidence * 100);

  return (
    <li>
      <Link
        href={`/history/${encodeURIComponent(item.id)}`}
        onClick={onOpen}
        className={[
          "flex min-h-28 items-center gap-4",
          "rounded-2xl border border-[#ECECEF]",
          "bg-white p-4 transition-colors",
          "hover:border-[#2E8B57]/50",
          "focus-visible:outline-2",
          "focus-visible:outline-[#2E8B57]",
        ].join(" ")}
      >
        {/* 기록 이미지 */}
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[#EDF7F1]">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span
                aria-hidden="true"
                className="icon-[lucide--image] h-8 w-8 text-[#2E8B57]"
              />
            </div>
          )}
        </div>

        {/* 기록 정보 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 break-words text-base font-bold text-[#191919]">
              {item.disease_name}
            </h3>

            <StatusBadge severity={item.severity} />
          </div>

          <p className="mt-1 text-sm text-[#6B6B6B]">
            {item.crop_type || "작물 미확인"}
            {" · "}
            {formatDate(item.created_at)}
          </p>

          <p className="mt-1 text-sm font-semibold text-[#6B6B6B]">
            진단 신뢰도 {confidence}%
          </p>

          {item.is_refined && (
            <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-[#2E8B57]">
              <span
                aria-hidden="true"
                className="icon-[lucide--scan-search] h-4 w-4"
              />
              재촬영으로 갱신된 결과
            </p>
          )}
        </div>

        <span
          aria-hidden="true"
          className="icon-[lucide--chevron-right] h-5 w-5 shrink-0 text-[#6B6B6B]"
        />
      </Link>
    </li>
  );
}
