
import Link from "next/link";

interface HistoryEmptyStateProps {
  hasAnyRecords: boolean;
  onReset: () => void;
}

export function HistoryEmptyState({
  hasAnyRecords,
  onReset,
}: HistoryEmptyStateProps) {
  // 기록은 존재하지만 선택한 필터에 맞는 기록이 없는 경우
  if (hasAnyRecords) {
    return (
      <section className="rounded-[20px] border border-[#ECECEF] bg-white px-6 py-10 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#EDF7F1]">
          <span
            aria-hidden="true"
            className="icon-[lucide--search-x] h-8 w-8 text-[#2E8B57]"
          />
        </span>

        <h2 className="mt-5 text-xl font-bold text-[#191919]">
          선택한 조건의 기록이 없어요
        </h2>

        <p className="mt-3 text-base leading-6 text-[#6B6B6B]">
          다른 작물이나 위험 등급을 선택해 보세요.
        </p>

        <button
          type="button"
          onClick={onReset}
          className="mt-6 min-h-[52px] w-full rounded-[14px] bg-[#2E8B57] px-5 py-3 text-base font-bold text-white"
        >
          전체 이력 보기
        </button>
      </section>
    );
  }

  // M-07: 저장된 진단 기록이 하나도 없는 경우
  return (
    <>
      {/* 중앙 빈 상태 카드 */}
      <section
        aria-label="진단 이력 없음"
        className="relative flex min-h-[280px] flex-col items-center justify-center rounded-[20px] border border-[#E7E7EC] bg-white px-5 py-8 text-center"
      >
        {/* M-07 빈 상태 마스코트 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mobile-prototype/assets/5912e.png"
          alt=""
          aria-hidden="true"
          className="h-24 w-24 object-contain"
        />

        <h2 className="mt-5 text-lg font-bold leading-7 text-[#191919]">
          아직 진단 이력이 없어요
        </h2>

        <p className="mt-3 text-sm leading-[22px] text-[#6B6B6B]">
          첫 사진을 찍으면 진단 결과가 여기에 저장됩니다.
        </p>
      </section>

      {/* M-07 하단 고정 행동 버튼 */}
      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-10 bg-white px-6 py-4 md:static md:mt-8 md:rounded-2xl md:bg-transparent md:px-0">
        <div className="mx-auto w-full max-w-app">
          <Link
            href="/#capture"
            className="flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-[#2E8B57] px-5 py-3 text-base font-bold text-white transition-colors hover:bg-[#26784B] active:bg-[#1F633D]"
          >
            첫 진단 시작하기
          </Link>
        </div>
      </div>
    </>
  );
}
