import Link from "next/link";

interface HistoryEmptyStateProps {
  mode: "no-history" | "filtered";
  cropLabel?: string;
  gradeLabel?: string;
  onResetFilters: () => void;
  onResetGrade?: () => void;
}

export function HistoryEmptyState({
  mode,
  cropLabel,
  gradeLabel,
  onResetFilters,
  onResetGrade,
}: HistoryEmptyStateProps) {
  // 1) 저장된 기록 자체가 없을 때
  if (mode === "no-history") {
    return (
      <div className="rounded-2xl border border-[#ECECEF] bg-white p-6 text-center shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mobile-prototype/assets/5912e.png"
          alt=""
          aria-hidden="true"
          className="mx-auto h-24 w-24 object-contain"
        />

        <h2 className="mt-4 text-[28px] font-bold leading-9 tracking-tight text-[#191919]">
          아직 진단 이력이 없어요
        </h2>

        <p className="mt-3 text-[15px] leading-6 text-[#6B6B6B]">
          첫 사진을 찍으면 진단 결과가 여기에 저장됩니다.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-[#2E8B57] px-5 py-3 text-base font-bold text-white transition-colors hover:bg-[#26784B]"
        >
          첫 진단 시작하기
        </Link>
      </div>
    );
  }

  // 2) 이력은 있지만 현재 필터 결과가 없을 때
  const title =
    gradeLabel && gradeLabel !== "전체"
      ? `${cropLabel ?? "선택한 작물"}·${gradeLabel} 등급의 기록이 없어요`
      : `${cropLabel ?? "선택한 작물"} 기록이 없어요`;

  const buttonLabel =
    gradeLabel && gradeLabel !== "전체" ? "전체 등급 보기" : "전체 이력 보기";

  const handleClick =
    gradeLabel && gradeLabel !== "전체" && onResetGrade
      ? onResetGrade
      : onResetFilters;

  return (
    <div className="rounded-2xl border border-[#ECECEF] bg-white shadow-sm">
      <div className="flex min-h-[156px] flex-col items-center justify-center px-6 py-10 text-center lg:min-h-[130px] lg:px-8">
        <h2 className="text-[20px] font-bold leading-8 tracking-tight text-[#191919]">
          {title}
        </h2>

        <button
          type="button"
          onClick={handleClick}
          className="mt-5 inline-flex min-h-[48px] min-w-[176px] items-center justify-center rounded-xl border border-[#ECECEF] bg-white px-6 py-3 text-[15px] font-bold text-[#191919] transition-colors hover:bg-[#F7F7F8]"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}