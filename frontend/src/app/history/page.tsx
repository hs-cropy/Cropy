
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

  const [crop, setCrop] = useState("고추");
  const [grade, setGrade] = useState<Severity | "">("");
  const [page, setPage] = useState(1);

  const [counts, setCounts] = useState({
    total: 0,
    unfiltered: 0,
  });

  const [refresh, setRefresh] = useState(0);
  const [restored, setRestored] = useState(false);

  const pendingScrollRef = useRef<number | null>(null);

  // ======================================
  // 이전 필터 및 스크롤 위치 복원
  // ======================================

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
          (state.crop === "" ||
            CROP_OPTIONS.some((c) => c.value === state.crop))
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
      // 저장된 상태가 잘못된 경우 기본 필터 사용
    }

    setRestored(true);
  }, []);

  // 상세 페이지 이동 전 목록 상태 저장
  const rememberPosition = () => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          crop,
          grade,
          page,
          scrollY: window.scrollY,
        })
      );
    } catch {
      // 저장에 실패해도 상세 페이지 이동은 허용
    }
  };

  // ======================================
  // 진단 이력 API 조회
  // ======================================


  useEffect(() => {
    if (!restored) return;

    // 개발 환경: 진단 이력 없음(M-07) 화면 미리보기
    if (
      process.env.NODE_ENV === "development" &&
      new URLSearchParams(window.location.search).get("preview") === "empty"
    ) {
      setItems([]);
      setCounts({
        total: 0,
        unfiltered: 0,
      });
      setError(null);
      setLoading(false);
      return;
    }

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

        setCounts({
          total: data.total,
          unfiltered: data.unfiltered_total,
        });

        const lastPage = Math.max(
          1,
          Math.ceil(data.total / PAGE_SIZE)
        );

        if (page > lastPage) {
          setItems([]);
          setPage(lastPage);
          return;
        }

        // 현재 페이지 기록 최신순 정렬
        setItems(
          [...data.items].sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
          )
        );
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

  // ======================================
  // 이력 상세에서 돌아왔을 때 스크롤 복원
  // ======================================

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

  // ======================================
  // 필터 및 페이지 변경
  // ======================================

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
    window.scrollTo({
      top: 0,
      behavior: "auto",
    });
  };

  // ======================================
  // 화면 상태 계산
  // ======================================

  const isPageLoading = !restored || loading;

  // 전체 이력이 아예 없는 상태
  const isNoHistory =
    !isPageLoading &&
    !error &&
    counts.unfiltered === 0;

  // 이력은 있지만 현재 필터 조건의 기록이 없는 상태
  const isFilteredEmpty =
    !isPageLoading &&
    !error &&
    counts.unfiltered > 0 &&
    items.length === 0;

  const totalPages = Math.max(
    1,
    Math.ceil(counts.total / PAGE_SIZE)
  );

  const gradeLabel =
    GRADE_OPTIONS.find((g) => g.value === grade)?.label ??
    "전체";

  return (
    <div
      className={[
        "relative isolate mx-auto w-full max-w-5xl",
        "min-h-[calc(100dvh-190px)] pb-28",
      ].join(" ")}
    >

      {/* ======================================
          상단 제목
         ====================================== */}

      <header className="relative mb-6 min-h-[112px] pr-20">
        <h1 className="text-[24px] font-bold leading-8 tracking-tight text-[#191919]">
          진단 이력
        </h1>

        <p className="mt-2 text-sm leading-[22px] text-[#6B6B6B]">
          {isNoHistory ? (
            "저장한 진단을 모아볼 수 있어요."
          ) : (
            <>
              작물을 선택한 뒤
              <br />
              위험 등급별로 확인하세요.
            </>
          )}
        </p>

        {/* 이력이 있을 때 상단 마스코트 표시 */}
        {!isPageLoading &&
          !error &&
          !isNoHistory && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/mobile-prototype/assets/46875.png"
                alt=""
                aria-hidden="true"
                className="absolute right-0 top-0 h-[76px] w-[76px] object-contain md:h-20 md:w-20"
              />
            </>
          )}
      </header>

      {/* ======================================
          작물 / 위험 등급 필터
          전체 이력이 없으면 숨김
         ====================================== */}

      {!isNoHistory && (
        <section
          aria-label="진단 이력 필터"
          className="mb-5 max-w-[420px] space-y-5"
        >
          <FilterChips
            title="작물"
            variant="crop"
            options={CROP_OPTIONS}
            value={crop}
            onChange={changeCrop}
          />

          <FilterChips
            title="위험 등급"
            variant="grade"
            options={GRADE_OPTIONS}
            value={grade}
            onChange={changeGrade}
          />
        </section>
      )}

      {/* ======================================
          이력 목록
         ====================================== */}

      <section
        aria-label="저장된 진단 목록"
        className="relative"
      >
        {/* 필터 조건 및 결과 건수 */}
        {!isPageLoading &&
          !error &&
          !isNoHistory && (
            <div
              role="status"
              className="mb-4 flex min-h-5 items-center justify-between gap-3"
            >
              <p className="text-[13px] font-semibold text-[#6B6B6B]">
                {crop || "전체 작물"}
                {" · "}
                {gradeLabel}
                {" "}
                {counts.total}건
              </p>

              {(grade !== "" || crop === "") && (
                <button
                  type="button"
                  onClick={() => {
                    setCrop("고추");
                    setGrade("");
                    setPage(1);
                  }}
                  className="min-h-9 text-xs font-semibold text-[#2E8B57]"
                >
                  기본 필터로
                </button>
              )}
            </div>
          )}

        {/* 로딩 */}
        {isPageLoading && (
          <div
            role="status"
            className="rounded-2xl border border-[#ECECEF] bg-white p-8 text-center"
          >
            <span
              aria-hidden="true"
              className="icon-[lucide--loader-circle] mx-auto block h-8 w-8 animate-spin text-[#2E8B57]"
            />

            <p className="mt-3 text-sm text-[#6B6B6B]">
              진단 이력을 불러오고 있어요.
            </p>
          </div>
        )}

        {/* API 오류 */}
        {!isPageLoading && error && (
          <div
            role="alert"
            className="rounded-2xl border border-[#ECECEF] bg-white p-6"
          >
            <h2 className="text-lg font-bold text-[#191919]">
              이력을 불러오지 못했어요
            </h2>

            <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
              {error}
            </p>

            <button
              type="button"
              onClick={() => setRefresh((n) => n + 1)}
              className="mt-4 min-h-11 rounded-xl bg-[#2E8B57] px-5 py-2 font-bold text-white"
            >
              다시 불러오기
            </button>
          </div>
        )}

        {/* M-07: 진단 이력 자체가 없는 상태 */}
        {isNoHistory && (
          <div className="mx-auto w-full max-w-[420px]">
            <HistoryEmptyState
              hasAnyRecords={false}
              onReset={resetFilters}
            />
          </div>
        )}

        {/* 이력은 있지만 현재 필터 결과가 없는 상태 */}
        {isFilteredEmpty && (
          <div className="w-full max-w-[420px]">
            <HistoryEmptyState
              hasAnyRecords={true}
              onReset={resetFilters}
            />
          </div>
        )}

        {/* 실제 진단 기록 목록 */}
        {!isPageLoading &&
          !error &&
          items.length > 0 && (
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
        {!isPageLoading &&
          !error &&
          totalPages > 1 && (
            <nav
              aria-label="진단 이력 페이지"
              className="mt-6 flex items-center justify-center gap-4"
            >
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => changePage(page - 1)}
                className="min-h-11 rounded-xl border border-[#ECECEF] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
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
                className="min-h-11 rounded-xl border border-[#ECECEF] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
              >
                다음
              </button>
            </nav>
          )}
      </section>
    </div>
  );
}
