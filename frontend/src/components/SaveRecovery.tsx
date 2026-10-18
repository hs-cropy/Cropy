"use client";
import { useState } from "react";
import { CaseFeedback } from "@/features/feedback/CaseFeedback";
import { canRetrySave } from "@/features/feedback/errors";
import { saveResult } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";

/**
 * 진단 결과를 이력에 저장하지 못했을 때의 안내 (Figma inline/save-failed).
 * 복구 토큰이 없거나 보관 시간이 지나는 등 다시 저장해도 안 되면 다시 저장 대신
 * 새 진단을 안내한다 (inline/save-unrecoverable)
 */
export function SaveRecovery({
  result,
  onSaved,
  onNewDiagnosis,
}: {
  result: DiagnoseResponse;
  onSaved?: (result: DiagnoseResponse) => void;
  /** 다시 저장할 수 없을 때의 "새 진단 시작". 없으면 버튼 없이 안내만 보인다 */
  onNewDiagnosis?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  // 다시 저장해도 소용없다고 판단한 복구 토큰. 다른 결과(토큰)가 들어오면 다시 저장할 수 있다
  const [finalToken, setFinalToken] = useState<string | null>(null);
  // 다시 저장이 실패한 횟수. 안내를 새로 그려 실패를 다시 알린다 (alert 는 나타날 때 읽힌다)
  const [failures, setFailures] = useState(0);
  if (result.save_status !== "failed") return null;
  const unrecoverable = !result.recovery_token || finalToken === result.recovery_token;
  if (unrecoverable) {
    return (
      <CaseFeedback
        caseId="save-unrecoverable"
        onPrimary={onNewDiagnosis}
        hideActions={!onNewDiagnosis}
        className="mx-auto lg:max-w-[30rem]"
      />
    );
  }
  async function retry() {
    if (!result.recovery_token || loading) return;
    setLoading(true);
    try {
      // onSaved?.(await ...) 로 쓰면 onSaved 가 없을 때 저장 요청 자체가 나가지 않는다
      const saved = await saveResult(result.recovery_token);
      onSaved?.(saved);
    } catch (err) {
      if (!canRetrySave(err)) setFinalToken(result.recovery_token);
      setFailures((count) => count + 1);
    } finally {
      setLoading(false);
    }
  }
  return (
    <CaseFeedback
      key={failures}
      caseId="save-failed"
      onPrimary={retry}
      primaryLoading={loading}
      className="mx-auto lg:max-w-[30rem]"
    />
  );
}
