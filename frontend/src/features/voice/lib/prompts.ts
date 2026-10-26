import type { DiagnoseResponse, RecaptureGuidance } from "@/types/diagnosis";

/**
 * 음성 안내 문장 사전 (06_웹앱_기능명세서 M01-F6 · M03-F3 · M04-F9 · M05-F8).
 *
 * 병명·숫자는 백엔드 값을 그대로 넣고 바꾸지 않는다 (02_스토리보드 발화 원칙).
 * 문장은 배열로 돌려줘 speak()가 문장 단위로 끊어 읽게 한다.
 */

export const PROMPT_HOME = "작물을 고르고 잎을 찍어주세요";
export const PROMPT_DIAGNOSING = "진단 중이에요";
/** 토글을 켠 탭이 곧 사용자 제스처라, 여기서 한 번 말해 두면 iOS 자동재생 제한도 풀린다 */
export const PROMPT_VOICE_ON = "음성 안내를 켰어요";

/** 카메라 화면이 켜졌을 때의 촬영 안내. 뷰파인더 상단의 "{작물} 잎" 칩과 같은 말을 쓴다 */
export function buildCameraPrompt(cropLabel?: string): string {
  return cropLabel
    ? `${cropLabel} 잎이 화면 가운데 오도록 찍어주세요`
    : "잎이 화면 가운데 오도록 찍어주세요";
}

/** 받침 유무로 목적격 조사를 고른다. 소리로 읽을 문장이라 판단이 안 되면 "을"로 둔다. */
function objectParticle(word: string): string {
  const trimmed = word.trim();
  const last = trimmed.charCodeAt(trimmed.length - 1);
  if (!trimmed || last < 0xac00 || last > 0xd7a3) return "을";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

/**
 * 정상 판정 여부. 프론트 타입은 "normal"이지만 백엔드 seed는 "healthy"를 내려주므로
 * 둘 다 받는다. 놓치면 "고추 정상, 등록 농약 정보가 없어요. 농업기술센터에
 * 문의하세요"처럼 건강한 작물에 상담을 권하게 된다.
 */
function isHealthy(result: DiagnoseResponse): boolean {
  const category: string | undefined = result.category;
  return category === "normal" || category === "healthy";
}

/** M04-F9 결과 낭독. 정상·농약 없음(M04-F6)은 화면 문구와 같은 말로 읽는다. */
export function buildResultPrompt(result: DiagnoseResponse): string[] {
  if (isHealthy(result)) return ["건강한 상태예요"];
  if (result.category === "other") return ["작물 잎을 찾지 못했어요", "잎이 잘 보이게 다시 찍어 주세요"];

  const pct = Math.round(result.confidence * 100);
  const head = `${result.disease_name}, 신뢰도 ${pct}%`;
  if (result.pesticides.length === 0) {
    return [head, "등록 농약 정보가 없어요. 농업기술센터에 문의하세요"];
  }
  return [head, `등록 농약 ${result.pesticides.length}종이 있어요`];
}

/** M05-F8 재촬영 안내. 찍을 부위는 응답의 region을 그대로 쓴다. */
export function buildRecapturePrompt(guidance: RecaptureGuidance): string[] {
  // "잎맥·잎 가장자리"의 가운뎃점은 엔진에 따라 "점"으로 읽혀 쉼표로 바꾼다
  const region = guidance.region.trim().replace(/\s*·\s*/g, ", ");
  return ["두 병이 비슷해요", `${region}${objectParticle(region)} 가까이 찍어주세요`];
}
