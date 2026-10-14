"use client";

import { Button } from "@/components/Button";
import { DiagnosisPageActions } from "@/components/DiagnosisPageActions";
import { Card } from "@/components/Card";
import { Mascot } from "@/components/Mascot";

interface DiagnosisFailurePanelProps {
  message?: string | null;
  onRetry: () => void;
  onPickDifferent: () => void;
  loading?: boolean;
  actionsVisible?: boolean;
}

export function DiagnosisFailurePanel({
  message,
  onRetry,
  onPickDifferent,
  loading = false,
  actionsVisible = true,
}: DiagnosisFailurePanelProps) {
  return (
    <section aria-label="진단 분석 실패" className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="text-2xl font-bold text-cropy-text-primary lg:text-3xl">
            분석을 완료하지 못했어요
          </h2>
          <p className="break-keep text-base leading-7 text-cropy-text-secondary">
            다시 시도하거나 다른 사진으로 확인해 주세요.
          </p>
        </div>
        <Mascot name="failed" size={64} className="lg:size-20" />
      </header>

      <Card radius="lg" padding="lg" className="flex min-h-52 flex-col items-center justify-center gap-4 text-center lg:min-h-64">
        <Mascot name="failed" size={96} />
        <h3 className="text-lg font-bold text-cropy-text-primary">사진을 다시 확인해 볼까요?</h3>
        <p role="alert" className="max-w-lg break-keep text-base leading-7 text-cropy-text-secondary">
          {message || "분석 중 오류가 발생했어요. 잠시 후 다시 시도하거나 새 사진을 선택해 주세요."}
        </p>
      </Card>

      <DiagnosisPageActions visible={actionsVisible}>
        <Button loading={loading} onClick={onRetry}>
          {loading ? "다시 분석 중…" : "다시 시도하기"}
        </Button>
        <Button
          variant="secondary"
          onClick={onPickDifferent}
          disabled={loading}
        >
          다른 사진 선택
        </Button>
      </DiagnosisPageActions>
    </section>
  );
}
