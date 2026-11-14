
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { ApiError, fetchDiagnosisDetail } from "@/lib/api";
import {
  clearHistoryCache,
  readHistoryCache,
  writeHistoryCache,
} from "@/lib/historyCache";
import { InlineFeedback } from "@/components/InlineFeedback";
import type { DiagnoseResponse } from "@/types/diagnosis";

import { AppShellPage } from "@/components/AppShell";
import { DiagnosisResult } from "@/components/DiagnosisResult";
import { RecapturePanel } from "@/components/RecapturePanel";

import { CropMismatchNotice } from "@/components/CropMismatchNotice";
import { Button, buttonClassName } from "@/components/Button";
import { CAPTURE_PATH, useDiagnosisSession } from "@/components/diagnosis/DiagnosisSession";

// 이력 캐시의 키 (lib/historyCache)
const detailKey = (id: string) => `history:detail:${id}`;

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const session = useDiagnosisSession();

  // 이력에 다시 저장할 수 없는 결과의 "새 진단 시작": 진단 상태를 비우고 촬영 화면 처음으로 간다
  const startNewDiagnosis = () => {
    session.reset();
    session.navigate(CAPTURE_PATH, "reset");
  };

  // 한 번 본 기록은 캐시로 바로 그린다. 새로고침 직후에는 캐시가 비어 있어 서버 HTML 과 같다
  const [result, setResult] = useState<DiagnoseResponse | null>(
    () => readHistoryCache<DiagnoseResponse>(detailKey(id)) ?? null
  );

  const [loading, setLoading] = useState(() => result == null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // ======================================
  // 저장 결과 갱신
  // ======================================

  // 캐시로 먼저 그린 뒤 뒤에서 새로 불러오는 요청. 그동안 다시 저장하면 끊는다
  const revalidateRef = useRef<AbortController | null>(null);

  const updateResult = (saved: DiagnoseResponse) => {
    // 저장 전 상태를 담은 응답이 늦게 와서 방금 저장한 결과를 되돌리지 않게 한다
    revalidateRef.current?.abort();
    if (saved.id === id) writeHistoryCache(detailKey(id), saved);
    setResult((previous) =>
      previous?.id === saved.id ? saved : previous
    );
  };

  // ======================================
  // 저장된 진단 상세 조회
  // ======================================

  useEffect(() => {
    const controller = new AbortController();
    revalidateRef.current = controller;
    const key = detailKey(id);
    const cached = readHistoryCache<DiagnoseResponse>(key);

    // 캐시가 있으면 그대로 보이고 뒤에서 새로 불러와 고친다
    setResult(cached ?? null);
    setLoading(!cached);
    setError(null);

    fetchDiagnosisDetail(id, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;

        writeHistoryCache(key, data);
        setResult(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // 보이고 있는 기록을 새로 고치지 못한 것뿐이면 그대로 둔다.
        // 기록이 없어졌다는 응답(404)이면 목록 캐시까지 버리고 알린다
        const gone = err instanceof ApiError && err.status === 404;
        if (cached && !gone) return;
        if (gone) {
          clearHistoryCache();
          setResult(null);
        }

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
      {/* 모바일은 제목이 헤더 바로 아래(8px)에 온다 (Figma M-08 MobileShell/Title).
          목록으로 돌아가는 버튼은 모바일 헤더의 뒤로 버튼과 아래 "진단 이력으로 돌아가기"가 맡는다 */}
      <div className="mx-auto w-full max-w-[1200px] pt-2 pb-8 md:pt-8">

        {/* ======================================
            페이지 제목 및 캐릭터
        ====================================== */}
        <header className="relative mb-6 min-h-[5rem] pr-[4.5rem] md:min-h-[6.25rem] md:pr-20">
          <h1 className="text-cropy-heading-lg text-cropy-text-primary">
            저장된 진단
          </h1>

          <p className="mt-1.5 text-cropy-helper text-cropy-text-secondary md:mt-2">
            저장 당시의 결과예요.
            <br />
            현재 상태는 새 사진으로 확인하세요.
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mobile-prototype/assets/46875.png"
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1.5 h-16 w-16 object-contain md:top-0 md:h-[4.75rem] md:w-[4.75rem]"
          />
        </header>

        {/* ======================================
            로딩 상태: 이력 목록과 같은 마스코트 안내 카드.
            진행 중 안내라 항상 그려 두고 open 으로 켜고 끈다 (InlineFeedback)
        ====================================== */}
        <InlineFeedback
          mascot="analysis"
          tone="status"
          headingLevel={2}
          title="진단 기록을 불러오고 있어요"
          open={loading}
        >
          {"저장된 사진과 분석 결과를 확인하는 중이에요.\n잠시만 기다려주세요."}
        </InlineFeedback>

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
