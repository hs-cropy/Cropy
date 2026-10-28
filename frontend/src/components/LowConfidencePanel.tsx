"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { DiagnosisPageActions } from "@/components/DiagnosisPageActions";
import { Card } from "@/components/Card";
import { Mascot } from "@/components/Mascot";

interface LowConfidencePanelProps {
  /** API에서 받은 0~1 범위의 신뢰도. 화면 분기용 임계값으로 사용하지 않는다. */
  confidence: number;
  onRetake: () => void;
  /** 판별 불가(작물 잎을 알아보지 못함): 신뢰도 대신 작물 잎을 다시 찍도록 안내한다 */
  notCrop?: boolean;
  actionsVisible?: boolean;
}

const PHOTO_TIPS = [
  "잎이나 열매가 크게 보이게 찍어주세요.",
  "초점을 맞춘 뒤 흔들리지 않게 촬영하세요.",
  "빛 반사 없이 밝은 곳에서 촬영하세요.",
];

export function LowConfidencePanel({
  confidence,
  onRetake,
  notCrop = false,
  actionsVisible = true,
}: LowConfidencePanelProps) {
  const [showGuide, setShowGuide] = useState(false);
  const percent = Number.isFinite(confidence)
    ? `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`
    : "확인 중";

  return (
    <section aria-label={notCrop ? "작물 잎을 찾지 못한 사진 안내" : "낮은 진단 신뢰도 안내"} className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="text-2xl font-bold text-cropy-text-primary lg:text-3xl">
            {notCrop ? "작물 잎을 찾지 못했어요" : "추가 확인이 필요해요"}
          </h2>
          <p className="break-keep text-base leading-7 text-cropy-text-secondary">
            {notCrop
              ? "고추·무·배추 잎으로 알아보기 어려운 사진이에요."
              : "현재 사진만으로는 병해를 확정하기 어려워요."}
          </p>
        </div>
        <Mascot name="retake" size={64} className="lg:size-20" />
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-stretch">
        <Card radius="lg" padding="lg" className="flex min-h-40 items-center justify-center bg-cropy-surface-canvas">
          <div className="flex flex-col items-center gap-3 text-cropy-action-primary">
            <span aria-hidden className="icon-[lucide--leaf] size-16" />
            <p className="text-sm font-semibold">사진을 한 번 더 확인해 주세요</p>
          </div>
        </Card>
        <Card radius="lg" padding="lg" className="space-y-4">
          {notCrop ? (
            <>
              <h3 className="text-lg font-bold text-cropy-text-primary">잎이 잘 보이게 다시 찍어 주세요</h3>
              <p className="break-keep text-base leading-7 text-cropy-text-secondary">
                작물이 아닌 사진이거나, 흐리거나 멀리서 찍은 사진일 수 있어요.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-bold text-cropy-text-primary">정확한 진단까지 조금 더 필요해요</h3>
              <p className="text-base font-bold text-cropy-action-primary">AI 진단 신뢰도 {percent}</p>
              <p className="text-base leading-7 text-cropy-text-secondary">
                조금 더 선명한 사진이면 판단에 도움이 될 수 있어요. 이 결과는 확정된 진단이 아니에요.
              </p>
            </>
          )}
          <ul className="space-y-2">
            {PHOTO_TIPS.map((tip) => (
              <li key={tip} className="flex gap-2 text-sm leading-6 text-cropy-text-secondary">
                <span aria-hidden className="icon-[lucide--check] mt-1 size-4 shrink-0 text-cropy-action-primary" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {showGuide && (
        <Card radius="lg" padding="lg" className="space-y-3">
          <h3 className="text-lg font-bold text-cropy-text-primary">촬영 방법</h3>
          <ol className="list-inside list-decimal space-y-2 text-base leading-7 text-cropy-text-secondary">
            <li>병반이 있는 잎 또는 열매를 화면에 크게 담아주세요.</li>
            <li>초점이 맞았는지 확인하고 흔들림을 피해 주세요.</li>
            <li>밝은 그늘에서 반사광 없이 촬영해 주세요.</li>
          </ol>
        </Card>
      )}

      <DiagnosisPageActions visible={actionsVisible}>
        <Button onClick={onRetake}>
          다시 촬영하기
        </Button>
        <Button
          variant="secondary"
          onClick={() => setShowGuide((current) => !current)}
          aria-expanded={showGuide}
        >
          {showGuide ? "촬영 방법 닫기" : "촬영 방법 보기"}
        </Button>
      </DiagnosisPageActions>
    </section>
  );
}
