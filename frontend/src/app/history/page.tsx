
"use client";

import { useEffect, useRef, useState } from "react";

import { AppShellPage } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { fetchHistory } from "@/lib/api";
import type {
  DiagnosisSummary,
  Severity,
} from "@/types/diagnosis";

import { FilterChips } from "@/components/history/FilterChips";
import { RecordRow } from "@/components/history/RecordRow";
import { HistoryEmptyState } from "@/components/history/HistoryEmptyState";

import { CaseFeedback } from "@/features/feedback/CaseFeedback";

const PAGE_SIZE = 20;
const STORAGE_KEY = "cropy:history-view";

const CROP_OPTIONS = [
  { value: "", label: "전체" },
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

/**
 * 이력 페이지의 실제 스크롤 컨테이너.
 * 모바일과 데스크톱 모두 AppShellPage의 region을 사용한다.
 * window는 기본 스크롤 대상이 아니다.
 */
function scrollHistoryToTop(): void {
  setHistoryScrollPosition(0);
}

function getHistoryScrollElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="region"][aria-label="진단 이력"]',
  );
}

function getHistoryScrollPosition(): number {
  return getHistoryScrollElement()?.scrollTop ?? 0;
}

function setHistoryScrollPosition(position: number): void {
  const region = getHistoryScrollElement();

  if (region) {
    region.scrollTop = position;
  }
}

export default function HistoryPage() {
  const [items, setItems] = useState<DiagnosisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [crop, setCrop] = useState("");
  const [grade, setGrade] = useState<Severity | "">("");
  const [page, setPage] = useState(1);

  // 현재 필터 결과 건수 및 전체 이력 건수
  const [counts, setCounts] = useState({
    total: 0,
    unfiltered: 0,
  });

  // 작물별 전체 기록 건수
  const [cropCounts, setCropCounts] = useState<
    Record<string, number | null>
  >({
    고추: null,
    무: null,
    배추: null,
  });

  const [refresh, setRefresh] = useState(0);
  const [restored, setRestored] = useState(false);

  const pendingScrollRef = useRef<number | null>(null);

  // ======================================
  // 1. 이전 필터 및 스크롤 위치 복원 준비
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
      // 저장 상태가 잘못되어도 기본 필터로 진입
    }

    setRestored(true);
  }, []);

  // ======================================
  // 2. 상세 페이지 이동 전 목록 상태 저장
  // ======================================

  const rememberPosition = () => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          crop,
          grade,
          page,
          scrollY: getHistoryScrollPosition(),
        })
      );
    } catch {
      // 상태 저장에 실패해도 상세 이동 허용
    }
  };

  // ======================================
  // 3. 작물별 전체 진단 건수 조회
  // ======================================

  useEffect(() => {
    if (!restored) return;

    const controller = new AbortController();

    async function loadCropCounts() {
      const options = CROP_OPTIONS.filter(
        (option) => option.value !== ""
      );

      const totals = await Promise.all(
        options.map(async (option) => {
          try {
            const data = await fetchHistory(
              1,
              1,
              option.value,
              undefined,
              controller.signal
            );

            return [option.value, data.total] as const;
          } catch {
            return [option.value, null] as const;
          }
        })
      );

      if (controller.signal.aborted) return;

      setCropCounts(Object.fromEntries(totals));
    }

    void loadCropCounts();

    return () => controller.abort();
  }, [restored, refresh]);

  // ======================================
  // 4. 현재 필터에 따른 진단 이력 조회
  // ======================================

  useEffect(() => {
    if (!restored) return;

    // 개발 환경 전용 M-07 빈 상태 미리보기
    if (
      process.env.NODE_ENV === "development" &&
      new URLSearchParams(window.location.search).get("preview") ===
        "empty"
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
  // 5. 상세 페이지에서 돌아온 뒤 스크롤 복원
  // ======================================

  useEffect(() => {
    if (!restored || loading || error) return;
    if (pendingScrollRef.current === null) return;

    const position = pendingScrollRef.current;
    pendingScrollRef.current = null;

    const frame = requestAnimationFrame(() => {
      setHistoryScrollPosition(position);
    });

    return () => cancelAnimationFrame(frame);
  }, [restored, loading, error, items]);

  // ======================================
  // 6. 필터 및 페이지 변경
  // ======================================

  const changeCrop = (value: string) => {
    setCrop(value);
    setPage(1);
    pendingScrollRef.current = null;
    scrollHistoryToTop();
  };

  const changeGrade = (value: Severity | "") => {
    setGrade(value);
    setPage(1);
    pendingScrollRef.current = null;
    scrollHistoryToTop();
  };

  const resetFilters = () => {
    setCrop("");
    setGrade("");
    setPage(1);
    pendingScrollRef.current = null;
    scrollHistoryToTop();
  };

  const resetGradeOnly = () => {
    setGrade("");
    setPage(1);
    pendingScrollRef.current = null;
    scrollHistoryToTop();
  };

  const changePage = (next: number) => {
    setPage(next);
    pendingScrollRef.current = null;
    scrollHistoryToTop();
  };

  // ======================================
  // 7. 화면 상태 계산
  // ======================================

  const isPageLoading = !restored || loading;

  const isNoHistory =
    !isPageLoading &&
    !error &&
    counts.unfiltered === 0;

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
    <AppShellPage scrollLabel="진단 이력">
      <div className="mx-auto w-full max-w-5xl pb-8 pt-5 md:pt-8">

        {/* ======================================
            상단 제목 및 캐릭터
        ====================================== */}

        <header className="relative mb-6 min-h-28 pr-20">
          <h1 className="text-cropy-heading-lg text-cropy-text-primary">
            진단 이력
          </h1>

          <p className="mt-2 text-cropy-helper text-cropy-text-secondary">
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

          {/* 필터 로딩과 무관하게 캐릭터 유지 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mobile-prototype/assets/46875.png"
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-0 h-[4.75rem] w-[4.75rem] object-contain md:h-20 md:w-20"
          />
        </header>

        {/* ======================================
            작물 / 위험 등급 필터
        ====================================== */}

        {!isNoHistory && (
          <section
            aria-label="진단 이력 필터"
            className="mb-5 w-full max-w-[26.25rem] space-y-5 lg:max-w-[34rem]"
          >
            <FilterChips
              title="작물"
              variant="crop"
              options={CROP_OPTIONS}
              value={crop}
              onChange={changeCrop}
              counts={cropCounts}
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
            진단 이력 목록
        ====================================== */}

        <section
          aria-label="저장된 진단 목록"
          className="relative"
        >
          {/* 필터 결과 건수 */}
          {!isPageLoading &&
            !error &&
            !isNoHistory && (
              <div
                role="status"
                className="mb-4 flex min-h-5 items-center gap-3"
              >
                <p className="text-cropy-caption font-semibold text-cropy-text-secondary">
                  {crop || "전체 작물"}
                  {" · "}
                  {gradeLabel}
                  {" "}
                  {counts.total}건 · 최신순
                </p>
              </div>
            )}

          {/* 로딩: 항상 마운트하고 open으로 표시 여부 제어 */}
          <CaseFeedback
            caseId="history-loading"
            open={isPageLoading}
          />

          {/* API 오류 */}
          <CaseFeedback
            caseId="history-failed"
            open={!isPageLoading && Boolean(error)}
            onPrimary={() => setRefresh((n) => n + 1)}
          />


          {/* 전체 진단 이력이 없는 경우: M-07 */}
          {isNoHistory && (
            <div className="mx-auto w-full max-w-[26.25rem]">
              <HistoryEmptyState
                mode="no-history"
                onResetFilters={resetFilters}
              />
            </div>
          )}

          {/* ======================================
              진단 기록 또는 필터 결과 없음
              모바일: 카드
              데스크톱: 테이블
          ====================================== */}

          {!isPageLoading &&
            !error &&
            (items.length > 0 || isFilteredEmpty) && (
              <div
                className={[
                  "w-full",
                  "lg:overflow-hidden lg:rounded-2xl",
                  "lg:border lg:border-cropy-border",
                  "lg:bg-cropy-surface",
                ].join(" ")}
              >
                {/* 데스크톱 테이블 헤더 */}
                <div
                  className={[
                    "hidden lg:grid",
                    "lg:grid-cols-[minmax(0,2.5fr)_minmax(0,1.3fr)_90px_100px_72px]",
                    "lg:items-center lg:gap-x-4",
                    "lg:border-b lg:border-cropy-border",
                    "lg:bg-cropy-surface-canvas lg:px-5 lg:py-4",
                    "text-cropy-helper font-semibold text-cropy-text-secondary",
                  ].join(" ")}
                >
                  <span>진단 내용</span>
                  <span>진단일</span>
                  <span className="text-center">등급</span>
                  <span className="text-center">
                    AI 신뢰도
                  </span>
                  <span className="text-center">결과</span>
                </div>

                {isFilteredEmpty ? (
                  <HistoryEmptyState
                    mode="filtered"
                    cropLabel={crop || "전체 작물"}
                    gradeLabel={gradeLabel}
                    onResetFilters={resetFilters}
                    onResetGrade={resetGradeOnly}
                  />
                ) : (
                  <ul className="flex flex-col gap-3 lg:gap-0">
                    {items.map((item) => (
                      <RecordRow
                        key={item.id}
                        item={item}
                        onOpen={rememberPosition}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}

          {/* ======================================
              페이지네이션
          ====================================== */}
          {!isPageLoading &&
            !error &&
            totalPages > 1 && (
              <nav
                aria-label="진단 이력 페이지"
                className="mt-6 flex items-center justify-center gap-4"
              >
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={page <= 1}
                  onClick={() => changePage(page - 1)}
                >
                  이전
                </Button>

                <span className="text-cropy-helper text-cropy-text-secondary">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={page >= totalPages}
                  onClick={() => changePage(page + 1)}
                >
                  다음
                </Button>
              </nav>
            )}
        </section>
      </div>
    </AppShellPage>
  );
}
