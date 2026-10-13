"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchDiagnosisDetail } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import { DiagnosisResult } from "@/components/DiagnosisResult";
import { LegacyPage } from "@/components/LegacyPage";
import { RecapturePanel } from "@/components/RecapturePanel";

export default function HistoryDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [result, setResult] = useState<DiagnoseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const updateResult = (saved: DiagnoseResponse) => setResult(previous => previous?.id === saved.id ? saved : previous);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setLoading(true); setError(null);
    fetchDiagnosisDetail(id, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "기록을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, refresh]);

  return (
    <LegacyPage scrollLabel="진단 기록" className="md:max-w-2xl lg:max-w-2xl">
      <Link
        href="/history"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-ink"
      >
        <span aria-hidden className="icon-[lucide--chevron-left] h-4 w-4" />
        이력 목록
      </Link>

      {loading && <p className="py-10 text-center text-sm text-khaki">불러오는 중…</p>}
      {(error || (!loading && !result)) && (
        <div role="alert" className="rounded-card bg-signal-high-tint px-4 py-3 text-sm font-medium text-signal-high-ink">
          {error || "해당 기록을 찾을 수 없습니다."}
          <button className="mt-2 block rounded-lg bg-brand px-4 py-2 text-ink" onClick={() => setRefresh(x => x + 1)}>다시 불러오기</button>
        </div>
      )}
      {result && (
        <div className="space-y-4">
          {result.recapture && result.save_status === "saved" && result.prediction_mode !== "browser" && (
            <RecapturePanel key={result.id} diagnosisId={result.id} guidance={result.recapture} onRefined={updateResult} />
          )}
          <DiagnosisResult result={result} onSaved={updateResult} isRecord />
        </div>
      )}
    </LegacyPage>
  );
}
