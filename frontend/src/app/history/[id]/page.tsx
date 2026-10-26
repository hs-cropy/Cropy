
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { fetchDiagnosisDetail } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";

import { AppShellPage } from "@/components/AppShell";
import { DiagnosisResult } from "@/components/DiagnosisResult";
import { RecapturePanel } from "@/components/RecapturePanel";

import { CropMismatchNotice } from "@/components/CropMismatchNotice";
import { Button, buttonClassName } from "@/components/Button";
import { CAPTURE_PATH, useDiagnosisSession } from "@/components/diagnosis/DiagnosisSession";

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const session = useDiagnosisSession();

  // 이력에 다시 저장할 수 없는 결과의 "새 진단 시작": 진단 상태를 비우고 촬영 화면 처음으로 간다
  const startNewDiagnosis = () => {
    session.reset();
    session.navigate(CAPTURE_PATH, "reset");
  };

  const [result, setResult] = useState<DiagnoseResponse | null>(
    null
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // ======================================
  // 저장 결과 갱신
  // ======================================

  const updateResult = (saved: DiagnoseResponse) => {
    setResult((previous) =>
      previous?.id === saved.id ? saved : previous
    );
  };

  // ======================================
  // 저장된 진단 상세 조회
  // ======================================

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
    <AppShellPage scrollLabel="진단 기록">
      <div className="mx-auto w-full max-w-[1200px] pt-5 pb-8 md:pt-8">

        {/* ======================================
            상단: 진단 이력 목록으로 돌아가기
        ====================================== */}
        <nav aria-label="이력 상세 탐색" className="mb-5">
          <Link
            href="/history"
            className={[
              "inline-flex min-h-cropy-control-md items-center gap-2",
              "rounded-xl px-1 py-2",
              "text-cropy-body-lg font-semibold text-cropy-text-secondary",
              "transition-colors hover:text-cropy-action-hover",
              "focus-visible:outline-2",
              "focus-visible:outline-cropy-action-primary",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className="icon-[lucide--chevron-left] h-5 w-5"
            />
            이력 목록
          </Link>
        </nav>

        {/* ======================================
            페이지 제목 및 캐릭터
        ====================================== */}
        <header className="relative mb-6 min-h-[6.25rem] pr-20">
          <h1 className="text-cropy-heading-lg text-cropy-text-primary">
            저장된 진단
          </h1>

          <p className="mt-2 text-cropy-helper text-cropy-text-secondary">
            저장 당시의 결과예요.
            <br />
            현재 상태는 새 사진으로 확인하세요.
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mobile-prototype/assets/46875.png"
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-0 h-[4.75rem] w-[4.75rem] object-contain"
          />
        </header>

        {/* ======================================
            로딩 상태
        ====================================== */}
        {loading && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-cropy-border bg-cropy-surface px-6 py-12 text-center"
          >
            <span
              aria-hidden="true"
              className="icon-[lucide--loader-circle] mx-auto block h-10 w-10 animate-spin text-cropy-action-primary"
            />

            <h2 className="mt-5 text-cropy-feedback-title text-cropy-text-primary">
              진단 기록을 불러오고 있어요
            </h2>

            <p className="mt-2 text-cropy-body-lg text-cropy-text-secondary">
              저장된 사진과 분석 결과를 확인하는 중이에요.
            </p>
          </div>
        )}

        {/* ======================================
            오류 또는 기록 없음
        ====================================== */}
        {!loading && (error || !result) && (
          <div
            role="alert"
            className="rounded-2xl border border-cropy-border bg-cropy-surface px-6 py-10 text-center"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-cropy-status-attention-surface">
              <span
                aria-hidden="true"
                className="icon-[lucide--circle-alert] h-8 w-8 text-cropy-status-attention"
              />
            </div>

            <h2 className="mt-5 text-cropy-feedback-title text-cropy-text-primary">
              {error
                ? "진단 기록을 불러오지 못했어요"
                : "진단 기록을 찾을 수 없어요"}
            </h2>

            <p className="mt-3 break-words text-cropy-body-lg text-cropy-text-secondary">
              {error ||
                "요청한 진단 기록이 없거나 더 이상 조회할 수 없어요."}
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button
                variant="primary"
                size="default"
                onClick={() => setRefresh((value) => value + 1)}
                icon={
                  <span
                    aria-hidden="true"
                    className="icon-[lucide--refresh-cw] h-5 w-5"
                  />
                }
              >
                다시 불러오기
              </Button>

              <Link
                href="/history"
                className={buttonClassName({
                  variant: "secondary",
                  size: "default",
                })}
              >
                <span className="min-w-0">이력 목록으로</span>
              </Link>
            </div>
          </div>
        )}

        {/* ======================================
            저장된 진단 결과
        ====================================== */}

        {!loading && !error && result && (
          <div className="space-y-5">
            {result.recapture &&
            result.save_status === "saved" &&
            result.prediction_mode !== "browser" ? (
              <>
                {/* 혼동 후보 화면에서도 작물 불일치 안내 유지 */}
                <CropMismatchNotice result={result} />

                <RecapturePanel
                  key={result.id}
                  diagnosisId={result.id}
                  guidance={result.recapture}
                  origin={`/history/${encodeURIComponent(result.id)}`}
                />
              </>
            ) : (
              <DiagnosisResult
                result={result}
                onSaved={updateResult}
                onNewDiagnosis={startNewDiagnosis}
                isRecord
              />
            )}

            {/* 하단 이력 목록 복귀 */}
            <Link
              href="/history"
              className={[
                buttonClassName({
                  variant: "secondary",
                  size: "default",
                  fullWidth: true,
                }),
                "mt-2",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className="icon-[lucide--arrow-left] h-5 w-5 shrink-0"
              />
              <span className="min-w-0">
                진단 이력으로 돌아가기
              </span>
            </Link>
          </div>
        )}
      </div>
    </AppShellPage>
  );
}
