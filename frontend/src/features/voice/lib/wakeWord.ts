/**
 * 호출어 "크로피". 음성 모드에서 버튼 없이 대화를 시작한다.
 * STT가 이름을 비슷하게 적는 형태(크로삐·그로피 등)도 받고, 이름 뒤에 이어진 말은 바로 질문으로 쓴다.
 */

// 이름(STT가 비슷하게 적는 형태 포함). 문장 어디에 있어도 된다
const NAME = /(크로피|크로삐|그로피|클로피|크러피|크로비|코로피|크롭이|크로파이|클로비|크로푸이)/;
// 이름 없이 부르는 말. 짧아서 소음에도 잘 잡히므로 문장 **맨 앞**에 올 때만 받는다 ("야 이거 무슨 병이야", "저기요")
const CALL = /^[\s,.!?~]*(여보세요|저기요|여기요|이봐요|이봐|야|얘|어이)(?=[\s,.!?~]|$)/;
// 이름 뒤에 붙는 부름말·문장부호
const AFTER_NAME = /^[\s,.!?~]*(야|아|님|씨|야야)?[\s,.!?~]*/;

export interface WakeMatch {
  /** 이름 뒤에 이어진 말. 없으면 빈 문자열(이름만 부른 경우) */
  remainder: string;
  /** 무엇으로 불렀는지 (크로피 이름 / 부르는 말) */
  by: "name" | "call";
}

export function matchWakeWord(text: string): WakeMatch | null {
  const name = NAME.exec(text);
  if (name) {
    const remainder = text.slice(name.index + name[0].length).replace(AFTER_NAME, "").trim();
    return { remainder, by: "name" };
  }
  const call = CALL.exec(text);
  if (call) {
    // "야 크로피 …"처럼 뒤에 이름이 또 오면 이름 뒤부터
    const rest = text.slice(call.index + call[0].length);
    const inner = NAME.exec(rest);
    const remainder = (inner ? rest.slice(inner.index + inner[0].length) : rest).replace(AFTER_NAME, "").trim();
    return { remainder, by: "call" };
  }
  return null;
}
