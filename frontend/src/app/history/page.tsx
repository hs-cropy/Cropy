
"use client";

import { useEffect, useRef, useState } from "react";

import { AppShellPage } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { fetchHistory } from "@/lib/api";
import {
  isHistoryCacheWarm,
  readHistoryCache,
  writeHistoryCache,
} from "@/lib/historyCache";
import type {
  DiagnosisSummary,
  PaginatedHistory,
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

// AppShell은 헤더부터 문서 전체가 스크롤된다 (본문 영역이 따로 스크롤되지 않는다).
function getHistoryScrollElement(): HTMLElement {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function scrollHistoryToTop() {
  getHistoryScrollElement().scrollTop = 0;
}

interface SavedView {
  crop: string;
  grade: Severity | "";
  page: number;
  scrollY: number | null;
}

const DEFAULT_VIEW: SavedView = { crop: "", grade: "", page: 1, scrollY: null };

/**
 * 상세로 가기 전에 남긴 필터·페이지·스크롤을 읽는다. 없으면 null, 잘못된 값은 기본값.
 * 읽기만 한다: render 중에 불러도 되도록 지우는 일은 effect 가 한다
 */
function readSavedView(): SavedView | null {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const view = { ...DEFAULT_VIEW };

    const state = JSON.parse(saved) as {
      crop?: unknown;
      grade?: unknown;
      page?: unknown;
      scrollY?: unknown;
    };

    if (
      typeof state.crop === "string" &&
      CROP_OPTIONS.some((c) => c.value === state.crop)
    ) {
      view.crop = state.crop;
    }

    if (
      typeof state.grade === "string" &&
      GRADE_OPTIONS.some((g) => g.value === state.grade)
    ) {
      view.grade = state.grade as Severity | "";
    }

    if (
      typeof state.page === "number" &&
      Number.isSafeInteger(state.page) &&
      state.page > 0
    ) {
      view.page = state.page;
    }

    if (
      typeof state.scrollY === "number" &&
      Number.isFinite(state.scrollY) &&
      state.scrollY >= 0
    ) {
      view.scrollY = state.scrollY;
    }

    return view;
  } catch {
    // 저장 상태가 잘못되어도 기본 필터로 진입
    return { ...DEFAULT_VIEW };
  }
}

function forgetSavedView() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 지우지 못해도 다음 상세 이동 때 덮어쓴다
  }
}

// 이력 캐시의 키 (lib/historyCache)
const listKey = (crop: string, grade: string, page: number) =>
  `history:list:${crop}|${grade}|${page}`;
const CROP_COUNTS_KEY = "history:crop-counts";

const EMPTY_CROP_COUNTS: Record<string, number | null> = {
  고추: null,
  무: null,
  배추: null,
};

function newestFirst(items: DiagnosisSummary[]) {
  return [...items].sort(
    (a, b) =>
      new Date(b.created_at).getTime() -
      new Date(a.created_at).getTime()
  );
}

export default function HistoryPage() {
  // 앱 안에서 다시 들어온 때(캐시가 있을 때)는 저장 상태와 캐시를 첫 화면부터 쓴다.
  // 그래야 상세에서 돌아오거나 탭을 오갈 때 로딩 안내가 깜빡이지 않는다.
  // 새로고침 직후에는 캐시가 비어 있어 서버 HTML 과 같은 기본 화면을 그린 뒤 effect 에서 읽는다
  const [initial] = useState(() =>
    isHistoryCacheWarm() ? readSavedView() ?? DEFAULT_VIEW : null
  );
  const [initialList] = useState(() => {
    if (!initial) return undefined;
    const cached = readHistoryCache<PaginatedHistory>(
      listKey(initial.crop, initial.grade, initial.page)
    );
    // 기록이 줄어 남긴 페이지가 끝을 넘으면 캐시로 그리지 않고 effect 가 페이지를 고친다
    const lastPage = cached ? Math.max(1, Math.ceil(cached.total / PAGE_SIZE)) : 0;
    return cached && initial.page <= lastPage ? cached : undefined;
  });

  const [items, setItems] = useState<DiagnosisSummary[]>(() =>
    initialList ? newestFirst(initialList.items) : []
  );
  const [loading, setLoading] = useState(!initialList);
  const [error, setError] = useState<string | null>(null);

  const [crop, setCrop] = useState(initial?.crop ?? "");
  const [grade, setGrade] = useState<Severity | "">(initial?.grade ?? "");
  const [page, setPage] = useState(initial?.page ?? 1);

  // 현재 필터 결과 건수 및 전체 이력 건수
  const [counts, setCounts] = useState({
    total: initialList?.total ?? 0,
    unfiltered: initialList?.unfiltered_total ?? 0,
  });

  // 작물별 전체 기록 건수
  const [cropCounts, setCropCounts] = useState<
    Record<string, number | null>
  >(() =>
    (initial &&
      readHistoryCache<Record<string, number | null>>(CROP_COUNTS_KEY)) ||
    EMPTY_CROP_COUNTS
  );

  const [refresh, setRefresh] = useState(0);
  const [restored, setRestored] = useState(initial != null);

  const pendingScrollRef = useRef<number | null>(initial?.scrollY ?? null);

  // ======================================
  // 1. 이전 필터 및 스크롤 위치 복원 준비 (새로고침 직후)
  // ======================================

  useEffect(() => {
    if (initial) {
      // 첫 화면에서 이미 읽었으므로 지우기만 한다
      forgetSavedView();
      return;
    }

    // 개발 모드에서 effect 가 두 번 돌아도 두 번째(남긴 상태 없음)가 첫 번째를 덮지 않게
    // 남긴 상태가 있을 때만 바꾼다
    const view = readSavedView();
    if (view) {
      forgetSavedView();
      setCrop(view.crop);
      setGrade(view.grade);
      setPage(view.page);
      pendingScrollRef.current = view.scrollY;
    }
    setRestored(true);
  }, [initial]);

  // ======================================
  // 2. 상세 페이지 이동 전 목록 상태 저장
  // ======================================

  const rememberPosition = () => {
    try {
      const scroller = getHistoryScrollElement();

      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          crop,
          grade,
          page,
          scrollY: scroller.scrollTop,
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

      const next = Object.fromEntries(totals);
      setCropCounts(next);
      writeHistoryCache(CROP_COUNTS_KEY, next);
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
    const key = listKey(crop, grade, page);

    const apply = (data: PaginatedHistory) => {
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
        // 남긴 스크롤은 원래 페이지의 위치라 고친 페이지에는 쓰지 않는다
        pendingScrollRef.current = null;
        return;
      }

      setItems(newestFirst(data.items));
    };

    // 한 번 본 필터·페이지는 로딩 없이 바로 보이고, 뒤에서 새로 불러와 고친다
    const cached = readHistoryCache<PaginatedHistory>(key);
    setError(null);
    if (cached) {
      apply(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    fetchHistory(
      page,
      PAGE_SIZE,
      crop || undefined,
      grade || undefined,
      controller.signal
    )
      .then((data) => {
        if (controller.signal.aborted) return;

        writeHistoryCache(key, data);
        apply(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // 보이고 있는 기록을 새로 고치지 못한 것뿐이면 그대로 둔다
        if (cached) return;

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
      getHistoryScrollElement().scrollTop = position;
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
