/**
 * "찍어 줘" 같은 촬영 명령인지. 모델(기능 선택)에는 촬영 실행 기능이 없으므로 앱이 먼저 가로챈다.
 * "사진은 어떻게 찍어"처럼 방법을 묻는 말은 모델로 보내 사용 안내(촬영 방법)를 받게 한다.
 */

const CAPTURE = /(찍|촬영|셔터)/;
// 방법·이유를 묻는 말은 명령이 아니다
const QUESTION = /(어떻게|어떡|방법|왜|뭐|무엇|언제|어디|되나|될까|되는|해야|하나요|할까)/;

export function isCaptureCommand(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (!CAPTURE.test(t)) return false;
  if (QUESTION.test(t)) return false;
  return true;
}
