
import Link from "next/link";

interface HistoryEmptyStateProps {
  hasAnyRecords: boolean;
  onReset: () => void;
}

export function HistoryEmptyState({
  hasAnyRecords,
  onReset,
}: HistoryEmptyStateProps) {
  return (
    <section className="rounded-2xl border border-[#ECECEF] bg-white px-6 py-10 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#EDF7F1]">
        <span
          aria-hidden="true"
          className="icon-[lucide--history] h-8 w-8 text-[#2E8B57]"
        />
      </div>

      <h2 className="mt-5 text-lg font-bold text-[#191919]">
        {hasAnyRecords
          ? "선택한 조건의 기록이 없어요"
          : "아직 진단 이력이 없어요"}
      </h2>

      <p className="mt-3 text-base leading-6 text-[#6B6B6B]">
        {hasAnyRecords
          ? "다른 작물이나 위험 등급을 선택해 보세요."
          : "첫 사진을 찍으면 진단 결과가 여기에 저장됩니다."}
      </p>

      {hasAnyRecords ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#2E8B57] px-6 py-3 text-base font-bold text-white"
        >
          전체 이력 보기
        </button>
      ) : (
        <Link
          href="/#capture"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#2E8B57] px-6 py-3 text-base font-bold text-white"
        >
          첫 진단 시작하기
        </Link>
      )}
    </section>
  );
}
