
"use client";

import { useEffect, useRef, useState } from "react";

import { fetchHistory } from "@/lib/api";
import type {
  DiagnosisSummary,
  Severity,
} from "@/types/diagnosis";

import { FilterChips } from "@/components/ui/FilterChips";
import { RecordRow } from "@/components/history/RecordRow";
import { HistoryEmptyState } from "@/components/history/HistoryEmptyState";

const PAGE_SIZE = 20;
const STORAGE_KEY = "cropy:history-view";

const CROP_OPTIONS = [
  { value: "", label: "전체 작물" },
  { value: "고추", label: "고추" },
  { value: "무", label: "무" },
  { value: "배추", label: "배추" },
];

const GRADE_OPTIONS: {
  value: Severity | "";
  label: string;
}[] = [
  { value: "", label: "전체" },
  { value: "high", label: "위험" },
  { value: "medium", label: "주의" },
  { value: "low", label: "낮음" },
];

export default function HistoryPage() {
  const [items, setItems] = useState<DiagnosisSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [crop, setCrop] = useState("");
  const [grade, setGrade] = useState<Severity | "">("");
  const [page, setPage] = useState(1);

  const [counts, setCounts] = useState({
    total: 0,
    unfiltered: 0,
  });

  const [refresh, setRefresh] = useState(0);
  const [restored, setRestored] = useState(false);

  const pendingScrollRef = useRef<number | null>(null);

  // ============================
  // 이전 이력 필터 복원
  // ============================

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);

      if (saved) {
        const state = JSON.parse(saved) as {
          crop?: string;
          grade?: string;
          page?: number;
          scrollY?: number;
        };

        if (
          typeof state.crop === "string" &&
          CROP_OPTIONS.some((c) => c.value === state.crop)
        ) {
          setCrop(state.crop);
        }

        if (
          typeof state.grade === "string" &&
          GRADE_OPTIONS.some((g) => g.value === state.grade)
        ) {
          setGrade(state.grade as Severity | "");
        }

        if (
          typeof state.page === "number" &&
          Number.isSafeInteger(state.page) &&
          state.page > 0
        ) {
          setPage(state.page);
        }

        if (
          typeof state.scrollY === "number" &&
          Number.isFinite(state.scrollY) &&
          state.scrollY >= 0
        ) {
          pendingScrollRef.current = state.scrollY;
        }

        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }

    setRestored(true);
  }, []);

  // 상세 페이지 이동 전 위치 기억
  const rememberPosition = () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        crop,
        grade,
        page,
        scrollY: window.scrollY,
      })
    );
  };

  // ============================
  // 이력 API 조회
  // ============================

  useEffect(() => {
    if (!restored) return;

    const controller = new AbortController();

    setLoading(true);
    setError(null);

    fetchHistory(
      page,
      PAGE_SIZE,
      crop || undefined,
      grade || undefined,
      controller.signal
    )
      .then((data) => {
        if (controller.signal.aborted) return;

        setItems(data.items);
        setCounts({
          total: data.total,
          unfiltered: data.unfiltered_total,
        });

        // 이전 마지막 페이지가 삭제 등으로 사라진 경우
        const lastPage = Math.max(
          1,
          Math.ceil(data.total / PAGE_SIZE)
        );

        if (page > lastPage) {
          setPage(lastPage);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "이력을 불러오지 못했어요."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [crop, grade, page, refresh, restored]);

  // 목록 로딩 완료 후 이전 위치 복원
  useEffect(() => {
    if (!restored || loading || error) return;
    if (pendingScrollRef.current === null) return;

    const position = pendingScrollRef.current;
    pendingScrollRef.current = null;

    const frame = requestAnimationFrame(() => {
      window.scrollTo({
        top: position,
        behavior: "instant",
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [restored, loading, error, items]);

  // ============================
  // 필터 및 페이지 변경
  // ============================

  const changeCrop = (value: string) => {
    setCrop(value);
    setPage(1);
    pendingScrollRef.current = null;
  };

  const changeGrade = (value: Severity | "") => {
    setGrade(value);
    setPage(1);
    pendingScrollRef.current = null;
  };

  const resetFilters = () => {
    setCrop("");
    setGrade("");
    setPage(1);
    pendingScrollRef.current = null;
  };

  const changePage = (next: number) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const totalPages = Math.max(
    1,
    Math.ceil(counts.total / PAGE_SIZE)
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">

      {/* ============================
          화면 제목
         ============================ */}
      <header>
        <h1 className="text-[1.375rem] font-extrabold leading-[1.875rem] tracking-tight text-[#191919] md:text-[2rem]">
          진단 이력
        </h1>

        <p className="mt-2 text-base leading-6 text-[#6B6B6B]">
          저장한 진단을 모아볼 수 있어요.
          <br />
          작물을 선택한 뒤 위험 등급별로 확인하세요.
        </p>
      </header>

      {/* ============================
          작물 및 위험 등급 필터
         ============================ */}
      <section
        aria-label="진단 이력 필터"
        className="space-y-5 rounded-2xl border border-[#ECECEF] bg-white p-5"
      >
        <FilterChips
          title="작물"
          options={CROP_OPTIONS}
          value={crop}
          onChange={changeCrop}
        />

        <div className="border-t border-[#ECECEF] pt-5">
          <FilterChips
            title="위험 등급"
            options={GRADE_OPTIONS}
            value={grade}
            onChange={changeGrade}
          />
        </div>
      </section>

      {/* ============================
          필터 결과 및 기록 목록
         ============================ */}
      <section aria-label="저장된 진단 목록">

        {/* 필터 결과 개수 */}
        {!loading && !error && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-2"
          >
            <h2 className="text-base font-bold text-[#191919]">
              {crop || "전체 작물"}
              {" · "}
              {GRADE_OPTIONS.find((g) => g.value === grade)?.label}
              {" "}
              <span className="text-[#2E8B57]">
                {counts.total}건
              </span>
            </h2>

            {(crop || grade) && (
              <button
                type="button"
                onClick={resetFilters}
                className="min-h-11 text-sm font-semibold text-[#2E8B57]"
              >
                필터 초기화
              </button>
            )}
          </div>
        )}

        {/* 로딩 */}
        {(loading || !restored) && (
          <div
            role="status"
            className="rounded-2xl border border-[#ECECEF] bg-white px-6 py-12 text-center"
          >
            <span
              aria-hidden="true"
              className="icon-[lucide--loader-circle] mx-auto block h-10 w-10 animate-spin text-[#2E8B57]"
            />

            <p className="mt-4 text-lg font-bold text-[#191919]">
              진단 이력을 불러오고 있어요
            </p>

            <p className="mt-2 text-base text-[#6B6B6B]">
              저장한 기록을 확인하는 중이에요.
            </p>
          </div>
        )}

        {/* API 오류 */}
        {!loading && error && (
          <div
            role="alert"
            className="rounded-2xl border border-[#ECECEF] bg-white px-6 py-10 text-center"
          >
            <span
              aria-hidden="true"
              className="icon-[lucide--triangle-alert] mx-auto block h-12 w-12 text-[#D92D20]"
            />

            <h2 className="mt-4 text-lg font-bold text-[#191919]">
              이력을 불러오지 못했어요
            </h2>

            <p className="mt-2 text-base leading-6 text-[#6B6B6B]">
              {error}
            </p>

            <button
              type="button"
              onClick={() => setRefresh((n) => n + 1)}
              className="mt-6 min-h-12 rounded-xl bg-[#2E8B57] px-6 py-3 text-base font-bold text-white"
            >
              다시 불러오기
            </button>
          </div>
        )}

        {/* 빈 상태 */}
        {!loading && !error && items.length === 0 && (
          <HistoryEmptyState
            hasAnyRecords={counts.unfiltered > 0}
            onReset={resetFilters}
          />
        )}

        {/* 진단 기록 목록 */}
        {!loading && !error && items.length > 0 && (
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((item) => (
              <RecordRow
                key={item.id}
                item={item}
                onOpen={rememberPosition}
              />
            ))}
          </ul>
        )}

        {/* 페이지네이션 */}
        {!loading && !error && totalPages > 1 && (
          <nav
            aria-label="진단 이력 페이지"
            className="mt-6 flex items-center justify-center gap-4"
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => changePage(page - 1)}
              className="min-h-11 rounded-xl border border-[#ECECEF] bg-white px-4 py-2 text-base font-semibold text-[#191919] disabled:opacity-40"
            >
              이전
            </button>

            <span className="text-sm font-semibold text-[#6B6B6B]">
              {page} / {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => changePage(page + 1)}
              className="min-h-11 rounded-xl border border-[#ECECEF] bg-white px-4 py-2 text-base font-semibold text-[#191919] disabled:opacity-40"
            >
              다음
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}
