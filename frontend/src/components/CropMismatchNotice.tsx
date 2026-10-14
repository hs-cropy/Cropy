
import type { DiagnoseResponse } from "@/types/diagnosis";

interface Props {
  result: DiagnoseResponse;
}

export function CropMismatchNotice({ result }: Props) {
  if (!result.crop_mismatch) return null;

  return (
    <p
      role="status"
      className="rounded-xl bg-signal-med-tint p-4 text-cropy-feedback-body leading-relaxed text-signal-med-ink"
    >
      선택한 작물은 {result.selected_crop}이지만
      사진은 {result.predicted_crop}로 분류됐어요.
      작물 선택과 사진을 확인한 뒤 다시 진단해 주세요.
    </p>
  );
}
