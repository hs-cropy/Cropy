// 호출어·촬영·종료 명령. 앱 음성 모드(src/features/voice/lib/wakeWord.ts·captureIntent.ts·exitIntent.ts)를 그대로 옮겼다.
// 규칙과 근거(실제 녹음에서 STT가 적은 형태)는 원본 파일의 주석을 본다.

const NAME = /([크그클코쿠](?:로|록|렇|러|롭|롤)[피페삐비끼費]|[크그클코쿠록로][피페끼](?=[\s,.!?~。？]|$)|크롭이|크로파이)/;
const NAME_ONLY = /^[\s,.!?~。？]*피[\s,.!?~。？]*$/;
const CALL = /^[\s,.!?~。？]*(여보세요|선생님|저기요|여기요|이봐요|이봐|안녕|야|얘|어이)(?=[\s,.!?~。？]|$)/;
const AFTER_NAME = /^[\s,.!?~。？]*(야|아|님|씨|야야)?[\s,.!?~。？]*/;

/** 호출어가 있으면 { remainder: 이어진 말, by: 'name' | 'call' }, 없으면 null */
export function matchWakeWord(text) {
  if (NAME_ONLY.test(text)) return { remainder: '', by: 'name' };
  const name = NAME.exec(text);
  if (name) {
    let remainder = text.slice(name.index + name[0].length).replace(AFTER_NAME, '').trim();
    for (let again = NAME.exec(remainder); again && again.index === 0; again = NAME.exec(remainder)) {
      remainder = remainder.slice(again[0].length).replace(AFTER_NAME, '').trim();
    }
    return { remainder, by: 'name' };
  }
  const call = CALL.exec(text);
  if (call) {
    const rest = text.slice(call.index + call[0].length);
    const inner = NAME.exec(rest);
    return { remainder: (inner ? rest.slice(inner.index + inner[0].length) : rest).replace(AFTER_NAME, '').trim(), by: 'call' };
  }
  return null;
}

const CAPTURE = /(찍|촬영|셔터)/;
const CAPTURE_QUESTION = /(어떻게|어떡|방법|왜|뭐|무엇|언제|어디|되나|될까|되는|해야|하나요|할까)/;
export function isCaptureCommand(text) {
  const t = text.replace(/\s+/g, '');
  return CAPTURE.test(t) && !CAPTURE_QUESTION.test(t);
}

const EXIT = /(종료|[종조](?:묘|려|료)(?:해|하)|그만|끝내|끝낼|끝|멈춰|나가|닫아|꺼\s?줘|꺼$|됐어|이제\s?됐|여기까지)/;
const EXIT_QUESTION = /(어떻게|어떡|방법|왜|뭐|무엇|언제|어디|되나|될까|하나요|할까|병|약|농약|찍)/;
export function isExitCommand(text) {
  const t = text.replace(/[\s,.!?~。？]/g, '');
  if (!t || t.length > 14) return false;
  return EXIT.test(t) && !EXIT_QUESTION.test(t);
}
