/**
 * 음성 모드에서 "지금 보고 있는 화면"을 알아낸다. 기능 선택 모델은 같은 말이라도 화면 상태에 따라
 * 다른 기능을 고르고, 답변은 보고 있던 진단 기록으로 만든다.
 *
 * 음성 모드는 별도 경로(/voice-mode)라 직전 화면 정보는 진입 버튼이 남긴 복귀 경로(voiceNavigation)와,
 * 진단 세션이 남긴 마지막 진단 id(sessionStorage `cropy:lastDiagnosisId`)로 되살린다.
 */

import { readVoiceReturn } from "@/components/voice-mode/voiceNavigation";
import type { UiStage } from "./voiceApi";

/** DiagnosisSession이 저장한 마지막 진단 결과 id의 키와 같아야 한다 */
export const LAST_DIAGNOSIS_KEY = "cropy:lastDiagnosisId";

export interface VoiceScreen {
  diagnosisId: string | null;
  uiStage: UiStage;
  /** 복귀 경로. 디버그·로그용 */
  path: string | null;
}

function lastDiagnosisId(): string | null {
  try {
    return sessionStorage.getItem(LAST_DIAGNOSIS_KEY);
  } catch {
    return null;
  }
}

/** /history/<id>에서 id를 꺼낸다 (쿼리·해시는 무시) */
export function diagnosisIdFromPath(path: string): string | null {
  const match = /^\/history\/([^/?#]+)/.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function readVoiceScreen(): VoiceScreen {
  const previous = readVoiceReturn();
  const path = previous?.path ?? null;

  if (path) {
    const fromPath = diagnosisIdFromPath(path);
    if (fromPath) return { diagnosisId: fromPath, uiStage: "result", path };
    if (path.startsWith("/diagnosis")) {
      const id = lastDiagnosisId();
      return { diagnosisId: id, uiStage: id ? "result" : "photo_ready", path };
    }
  }
  return { diagnosisId: null, uiStage: "no_photo", path };
}
