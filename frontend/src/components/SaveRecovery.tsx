"use client";
import { useState } from "react";
import { saveResult } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";

export function SaveRecovery({ result, onSaved }: { result: DiagnoseResponse; onSaved?: (result: DiagnoseResponse) => void }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  if (result.save_status !== "failed") return null;
  async function retry() {
    if (!result.recovery_token || loading) return;
    setLoading(true);
    try { onSaved?.(await saveResult(result.recovery_token)); }
    catch (err) { setMessage(err instanceof Error ? err.message : "저장하지 못했어요."); }
    finally { setLoading(false); }
  }
  return <section role="status" className="rounded-card bg-signal-med-tint p-4 text-center">
    <p className="font-bold">이력에 저장하지 못했어요</p>
    <p className="mt-1 text-sm">결과는 확인할 수 있어요. 서버의 보관 시간이 지나기 전에 다시 저장해주세요.</p>
    <button disabled={loading || !result.recovery_token} onClick={retry}
      className="mt-3 rounded-xl bg-brand px-5 py-2.5 font-bold text-ink disabled:opacity-50">
      {loading ? "저장 중…" : "다시 저장"}
    </button>
    {message && <p className="mt-2 text-sm">{message}</p>}
  </section>;
}
