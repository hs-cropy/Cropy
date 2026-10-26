"use client";

import type { DiagnoseResponse } from "@/types/diagnosis";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { DiagnosisResultView } from "./diagnosis/DiagnosisResultView";

interface Props {
  result: DiagnoseResponse;
  onSaved?: (result: DiagnoseResponse) => void;
  /** 저장할 수 없는 기록에서 새 진단을 시작하는 실제 동작 */
  onNewDiagnosis?: () => void;
  isRecord?: boolean;
}

/**
 * 진단 결과 및 저장된 이력 상세는 같은 결과 화면을 사용한다.
 * 서버 렌더 중에는 화면 폭을 모르므로 CSS로 한쪽을 숨기고,
 * 브라우저에서는 해당 화면만 렌더링한다.
 */
export function DiagnosisResult({
  result,
  onSaved,
  onNewDiagnosis,
  isRecord = false,
}: Props) {
  const desktopMatch = useMediaQuery(DESKTOP_QUERY);
  const common = {
    result,
    photo: null,
    onSaved,
    onNewDiagnosis,
    isRecord,
  };

  if (desktopMatch === null) {
    return (
      <>
        <div className="lg:hidden">
          <DiagnosisResultView {...common} desktop={false} />
        </div>
        <div className="hidden lg:block">
          <DiagnosisResultView {...common} desktop />
        </div>
      </>
    );
  }

  return <DiagnosisResultView {...common} desktop={desktopMatch} />;
}
