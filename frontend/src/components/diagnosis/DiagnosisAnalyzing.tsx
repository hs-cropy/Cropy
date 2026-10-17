import { Button } from "@/components/Button";
import { cardClassName } from "@/components/Card";
import { cn } from "@/lib/cn";

// 서버가 단계별 진행을 알려 주지 않아 단계는 이름만 보인다. 지금 단계를 표시하거나
// 시간에 맞춰 넘기지 않는다 (Figma 개발 가이드: 실제 진행률이 없으면 임의 값을 넣지 않는다)
const MOBILE_STEPS = ["작물 인식", "병해 비교", "결과 정리"];
const DESKTOP_STEPS = ["사진 확인", "작물·병해 비교", "결과 정리"];

interface DiagnosisAnalyzingProps {
  /** 분석 중인 사진 (고른 사진의 미리보기 주소) */
  photo: string | null;
  /** 모바일은 본문 안의 "분석 취소"를 쓴다 (데스크탑은 화면 아래 행동 영역에 둔다) */
  onCancel: () => void;
  /** 취소를 눌러 화면을 떠나는 중 */
  cancelling?: boolean;
  desktop?: boolean;
}

function Photo({ photo, className }: { photo: string | null; className: string }) {
  return (
    <div className={className}>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- 기기 안의 사진(blob) 미리보기
        <img src={photo} alt="분석 중인 사진" className="size-full object-cover" />
      )}
    </div>
  );
}

/**
 * 사진 분석 중 (모바일 M-02 · 데스크탑 D-02): 고른 사진을 그대로 보이며 분석을 기다린다.
 * 진행률을 모르므로 막대는 한 조각이 오가기만 하고(값 없는 progressbar), 동작 줄이기 설정에서는
 * 멈춘 채 문구만 남는다.
 * 모바일: 사진 280px(모서리 20px), 로딩 48px, 진행 막대 4px과 단계 13px, "분석 취소" 160×44px, 13px 안내.
 * 데스크탑: 사진 카드 520px(사진 320px 높이·모서리 12px)과 진행 카드(로딩 32px, 24/32px 제목,
 * 16/24px 본문, 단계 01~03)를 32px 간격으로 나란히 둔다.
 */
export function DiagnosisAnalyzing({
  photo,
  onCancel,
  cancelling = false,
  desktop = false,
}: DiagnosisAnalyzingProps) {
  if (desktop) {
    return (
      <div className="flex items-center gap-8">
        <figure
          className={cn(
            cardClassName({ padding: "none" }),
            "flex w-[32.5rem] shrink-0 flex-col gap-4 p-6",
          )}
        >
          <Photo
            photo={photo}
            className="h-80 w-full overflow-hidden rounded-xl bg-cropy-surface-canvas"
          />
          <figcaption className="text-cropy-helper text-cropy-text-secondary">
            분석 중인 사진
          </figcaption>
        </figure>
        <div
          className={cn(
            cardClassName({ padding: "none" }),
            "flex min-w-0 flex-1 flex-col items-start gap-4 p-6",
          )}
        >
          <span
            role="progressbar"
            aria-label="사진 분석 진행"
            className="icon-[lucide--loader-circle] size-8 text-cropy-action-primary motion-safe:animate-spin"
          />
          <h2 className="break-keep text-cropy-heading-lg text-cropy-text-primary">
            조금만 기다려주세요
          </h2>
          <p className="whitespace-pre-line break-keep text-cropy-body-lg text-cropy-text-secondary">
            {"사진의 색과 형태를 비교하고 있습니다.\n다른 사진을 선택하려면 분석을 취소해주세요."}
          </p>
          <ol aria-label="분석 단계" className="flex w-full flex-col gap-4">
            {DESKTOP_STEPS.map((step, index) => (
              <li key={step} className="flex items-center gap-4">
                <span className="w-8 shrink-0 text-cropy-helper font-bold text-cropy-action-primary">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 break-keep text-cropy-body-lg text-cropy-text-secondary">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-5">
      <Photo
        photo={photo}
        className="mx-auto aspect-square w-[17.5rem] max-w-full overflow-hidden rounded-cropy-20 border border-cropy-border bg-cropy-surface"
      />
      <div className="flex justify-center">
        <span
          aria-hidden
          className="icon-[lucide--loader-circle] size-12 text-cropy-action-primary motion-safe:animate-spin"
        />
      </div>
      <div className="flex flex-col gap-3 px-6">
        <div
          role="progressbar"
          aria-label="사진 분석 진행"
          className="relative h-1 overflow-hidden rounded-sm bg-cropy-border"
        >
          <div className="absolute inset-y-0 left-0 w-2/5 rounded-sm bg-cropy-action-primary motion-safe:animate-cropy-indeterminate motion-reduce:hidden" />
        </div>
        <ol
          aria-label="분석 단계"
          className="grid grid-cols-3 text-center text-cropy-caption font-medium text-cropy-text-secondary"
        >
          {MOBILE_STEPS.map((step) => (
            <li key={step} className="break-keep">
              {step}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex justify-center">
        <Button
          type="button"
          variant="secondary"
          size="compact"
          disabled={cancelling}
          onClick={onCancel}
          className="w-40 rounded-cropy-14 text-cropy-helper font-medium"
        >
          분석 취소
        </Button>
      </div>
      <p className="break-keep text-cropy-caption leading-[1.375rem] text-cropy-text-secondary">
        분석이 끝나면 결과 화면으로 이동해요.
      </p>
    </div>
  );
}
