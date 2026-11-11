/**
 * 호출어 "크로피". 음성 모드에서 버튼 없이 대화를 시작한다.
 * STT가 이름을 비슷하게 적는 형태(크로삐·그로피 등)도 받고, 이름 뒤에 이어진 말은 바로 질문으로 쓴다.
 */

const WAKE = /(크로피|크로삐|그로피|클로피|크러피|크로비|코로피|크로피야)/;
// 이름 뒤에 붙는 부름말·문장부호
const AFTER_NAME = /^[\s,.!?~]*(야|아|님|씨)?[\s,.!?~]*/;

export interface WakeMatch {
  /** 이름 뒤에 이어진 말. 없으면 빈 문자열(이름만 부른 경우) */
  remainder: string;
}

export function matchWakeWord(text: string): WakeMatch | null {
  const m = WAKE.exec(text);
  if (!m) return null;
  const remainder = text.slice(m.index + m[0].length).replace(AFTER_NAME, "").trim();
  return { remainder };
}
