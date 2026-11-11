/**
 * "종료해 줘", "그만", "끝내" 같은 음성 모드 끝내기 명령인지. 모델(기능 선택)에는 이런 기능이 없으므로 앱이 먼저 가로챈다.
 * 짧은 말이라 다른 문장에 섞이기 쉬우므로, 질문(어떻게·왜 등)이 들어 있거나 문장이 길면 명령으로 보지 않는다.
 */

// STT가 "종료"를 "종묘·종려·조묘"로 적은 사례(2026-11-12)가 있다. 종묘(씨·모종)는 농사 말이라 '해·하'가 바로 붙을 때만 받는다
const EXIT = /(종료|[종조](?:묘|려|료)(?:해|하)|그만|끝내|끝낼|끝|멈춰|나가|닫아|꺼\s?줘|꺼$|됐어|이제\s?됐|여기까지)/;
const QUESTION = /(어떻게|어떡|방법|왜|뭐|무엇|언제|어디|되나|될까|하나요|할까|병|약|농약|찍)/;
const MAX_LENGTH = 14; // 공백 뺀 글자 수. "이제 그만 종료해 줘" 정도까지

export function isExitCommand(text: string): boolean {
  const t = text.replace(/[\s,.!?~。？]/g, "");
  if (!t || t.length > MAX_LENGTH) return false;
  if (!EXIT.test(t)) return false;
  if (QUESTION.test(t)) return false;
  return true;
}
