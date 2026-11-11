/**
 * 호출어 "크로피". 음성 모드에서 버튼 없이 대화를 시작한다.
 * STT가 이름을 비슷하게 적는 형태(크로삐·그로피 등)도 받고, 이름 뒤에 이어진 말은 바로 질문으로 쓴다.
 */

// 이름. SenseVoice는 "크로피"를 그로피·그록피·그렇피·그로페·그피·록피처럼 적는다(2026-11-11 실제 녹음).
// 첫 글자 [크그클코쿠] + 가운데(없거나 로·록·렇·러·롭) + 끝 [피페삐비費]로 느슨하게 잡고, 가운데가 없는 두 글자 꼴(그피·록피·로피)도 받는다
const NAME = /([크그클코쿠](?:로|록|렇|러|롭|롤)[피페삐비끼費]|[크그클코쿠록로][피페끼](?=[\s,.!?~。？]|$)|크롭이|크로파이)/;
// 이름만 짧게 부르면 STT가 첫 글자를 떨어뜨려 "피"만 남기기도 한다. 다른 말 없이 그것만 들렸을 때만 이름으로 본다
const NAME_ONLY = /^[\s,.!?~。？]*피[\s,.!?~。？]*$/;
// 이름 없이 부르는 말. 짧아서 소음에도 잘 잡히므로 문장 **맨 앞**에 올 때만 받는다 ("야 이거 무슨 병이야", "저기요")
const CALL = /^[\s,.!?~。？]*(여보세요|저기요|여기요|이봐요|이봐|야|얘|어이)(?=[\s,.!?~。？]|$)/;
// 이름 뒤에 붙는 부름말·문장부호
const AFTER_NAME = /^[\s,.!?~。？]*(야|아|님|씨|야야)?[\s,.!?~。？]*/;

export interface WakeMatch {
  /** 이름 뒤에 이어진 말. 없으면 빈 문자열(이름만 부른 경우) */
  remainder: string;
  /** 무엇으로 불렀는지 (크로피 이름 / 부르는 말) */
  by: "name" | "call";
}

export function matchWakeWord(text: string): WakeMatch | null {
  if (NAME_ONLY.test(text)) return { remainder: "", by: "name" };
  const name = NAME.exec(text);
  if (name) {
    let remainder = text.slice(name.index + name[0].length).replace(AFTER_NAME, "").trim();
    // "그費? 그록피 이거 …"처럼 이름을 두 번 적은 경우 뒤의 이름도 걷어 낸다
    for (let again = NAME.exec(remainder); again && again.index === 0; again = NAME.exec(remainder)) {
      remainder = remainder.slice(again[0].length).replace(AFTER_NAME, "").trim();
    }
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
