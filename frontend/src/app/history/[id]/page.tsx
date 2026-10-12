
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { fetchDiagnosisDetail } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";

import { DiagnosisResult } from "@/components/DiagnosisResult";
import { RecapturePanel } from "@/components/RecapturePanel";

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  // 진단 상세 상태
  const [result, setResult] = useState<DiagnoseResponse | null>(
    null
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // ==============================
  // 저장 또는 재촬영 결과 갱신
  // ==============================

  const updateResult = (saved: DiagnoseResponse) => {
    setResult((previous) =>
      previous?.id === saved.id ? saved : previous
    );
  };

  // ==============================
  // 저장된 진단 상세 조회
  // ==============================

  useEffect(() => {
    const controller = new AbortController();

    setResult(null);
    setLoading(true);
    setError(null);

    fetchDiagnosisDetail(id, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;

        setResult(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "진단 기록을 불러오지 못했어요."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [id, refresh]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* ====================================
          상단: 이력 목록으로 돌아가기
         ==================================== */}

      <nav aria-label="이력 상세 탐색" className="mb-5">
        <Link
          href="/history"
          className={[
            "inline-flex min-h-11 items-center gap-2",
            "rounded-xl px-1 py-2",
            "text-base font-semibold text-[#6B6B6B]",
            "transition-colors hover:text-[#2E8B57]",
            "focus-visible:outline-2",
            "focus-visible:outline-[#2E8B57]",
          ].join(" ")}
        >
          <span
            aria-hidden="true"
            className="icon-[lucide--chevron-left] h-5 w-5"
          />
          이력 목록
        </Link>
      </nav>

      {/* ====================================
          페이지 제목
         ==================================== */}

      <header className="mb-6">
        <h1 className="text-[1.375rem] font-extrabold leading-8 tracking-tight text-[#191919] md:text-[2rem]">
          저장된 진단 상세
        </h1>

        <p className="mt-2 text-base leading-6 text-[#6B6B6B]">
          저장한 진단 결과와 관리 방법을 확인하세요.
        </p>
      </header>

      {/* ====================================
          로딩 상태
         ==================================== */}

      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-[#ECECEF] bg-white px-6 py-12 text-center"
        >
          <span
            aria-hidden="true"
            className="icon-[lucide--loader-circle] mx-auto block h-10 w-10 animate-spin text-[#2E8B57]"
          />

          <h2 className="mt-5 text-lg font-bold text-[#191919]">
            진단 기록을 불러오고 있어요
          </h2>

          <p className="mt-2 text-base leading-6 text-[#6B6B6B]">
            저장된 사진과 분석 결과를 확인하는 중이에요.
          </p>
        </div>
      )}

      {/* ====================================
          오류 또는 기록 없음
         ==================================== */}

      {!loading && (error || !result) && (
        <div
          role="alert"
          className="rounded-2xl border border-[#ECECEF] bg-white px-6 py-10 text-center"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#FFF1F0]">
            <span
              aria-hidden="true"
              className="icon-[lucide--circle-alert] h-8 w-8 text-[#B42318]"
            />
          </div>

          <h2 className="mt-5 text-lg font-bold text-[#191919]">
            {error
              ? "진단 기록을 불러오지 못했어요"
              : "진단 기록을 찾을 수 없어요"}
          </h2>

          <p className="mt-3 break-words text-base leading-6 text-[#6B6B6B]">
            {error ||
              "요청한 진단 기록이 없거나 더 이상 조회할 수 없어요."}
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setRefresh((value) => value + 1)}
              className={[
                "inline-flex min-h-[3.25rem]",
                "items-center justify-center gap-2",
                "rounded-xl bg-[#2E8B57] px-5 py-3",
                "text-base font-bold text-white",
                "hover:bg-[#26784B]",
                "focus-visible:outline-2",
                "focus-visible:outline-offset-2",
                "focus-visible:outline-[#2E8B57]",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className="icon-[lucide--refresh-cw] h-5 w-5"
              />
              다시 불러오기
            </button>

            <Link
              href="/history"
              className={[
                "inline-flex min-h-[3.25rem]",
                "items-center justify-center",
                "rounded-xl border border-[#2E8B57]",
                "bg-white px-5 py-3",
                "text-base font-bold text-[#2E8B57]",
                "hover:bg-[#EDF7F1]",
              ].join(" ")}
            >
              이력 목록으로
            </Link>
          </div>
        </div>
      )}

      {/* ====================================
          저장된 진단 결과
         ==================================== */}

      {!loading && !error && result && (
        <div className="space-y-5">
          {/* 재촬영 가능한 저장 기록 */}         
          {result.recapture &&
          result.save_status === "saved" &&
          result.prediction_mode !== "browser" ? (
            <RecapturePanel
              key={result.id}
              diagnosisId={result.id}
              guidance={result.recapture}
              onRefined={updateResult}
            />
          ) : (
            <DiagnosisResult
              result={result}
              onSaved={updateResult}
              isRecord
            />
          )}

          {/* 하단 이력 목록 복귀 */}
          <Link
            href="/history"
            className={[
              "flex min-h-[3.25rem] w-full",
              "items-center justify-center gap-2",
              "rounded-xl border border-[#2E8B57]",
              "bg-white px-5 py-3",
              "text-base font-bold text-[#2E8B57]",
              "transition-colors hover:bg-[#EDF7F1]",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className="icon-[lucide--arrow-left] h-5 w-5"
            />
            진단 이력으로 돌아가기
          </Link>
        </div>
      )}
    </div>
  );
}
