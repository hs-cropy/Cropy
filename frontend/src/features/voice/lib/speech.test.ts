import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeVoice, installFakeSpeech, spokenTexts } from "../testing/fakeSpeech";

// speech.ts는 마지막 화자(owner)와 prime 여부를 모듈 상태로 들고 있어
// 테스트마다 모듈을 새로 불러와 서로 영향이 없게 한다
async function loadSpeech() {
  return import("./speech");
}

beforeEach(() => {
  vi.resetModules();
});

describe("Web Speech 미지원 환경", () => {
  it("모든 함수가 오류 없이 아무것도 하지 않는다", async () => {
    const speech = await loadSpeech();

    expect(speech.isSpeechSupported()).toBe(false);
    expect(() => {
      speech.speak("안녕하세요");
      speech.cancelSpeech();
      speech.primeSpeech();
      speech.warmUpVoices();
    }).not.toThrow();
  });
});

describe("speak", () => {
  it("문장마다 utterance를 만들어 한국어·0.9배속으로 큐에 넣는다", async () => {
    const synth = installFakeSpeech();
    const { speak, SPEECH_RATE } = await loadSpeech();

    speak(["첫 문장", "둘째 문장"]);

    expect(spokenTexts(synth)).toEqual(["첫 문장", "둘째 문장"]);
    for (const [utterance] of synth.speak.mock.calls) {
      expect(utterance.lang).toBe("ko-KR");
      expect(utterance.rate).toBe(SPEECH_RATE);
    }
    expect(SPEECH_RATE).toBe(0.9);
  });

  it("빈 문장은 건너뛰고, 남는 게 없으면 아무것도 하지 않는다", async () => {
    const synth = installFakeSpeech();
    const { speak } = await loadSpeech();

    speak(["", "  ", "읽을 문장"]);
    expect(spokenTexts(synth)).toEqual(["읽을 문장"]);

    synth.speak.mockClear();
    speak("");
    speak([]);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it("아무것도 읽지 않을 때는 cancel하지 않는다", async () => {
    const synth = installFakeSpeech();
    const { speak } = await loadSpeech();

    speak("문장");

    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ["읽는 중", { speaking: true, pending: false }],
    ["대기 중", { speaking: false, pending: true }],
  ])("%s이면 끊고 새 문장을 읽는다", async (_, state) => {
    const synth = installFakeSpeech();
    Object.assign(synth, state);
    const { speak } = await loadSpeech();

    speak("새 문장");

    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      synth.speak.mock.invocationCallOrder[0],
    );
  });
});

describe("한국어 보이스 선택", () => {
  async function voiceUsedWith(voices: SpeechSynthesisVoice[]) {
    const synth = installFakeSpeech(voices);
    const { speak } = await loadSpeech();
    speak("문장");
    return synth.speak.mock.calls[0][0].voice;
  }

  it("기본 한국어 보이스를 가장 먼저 고른다", async () => {
    const yuna = fakeVoice("Yuna", "ko-KR");
    const fallbackDefault = fakeVoice("Eddy", "ko-KR", true);
    expect(await voiceUsedWith([yuna, fallbackDefault])).toBe(fallbackDefault);
  });

  it("기본이 없으면 알려진 보이스(Yuna·Google 등)를 고른다", async () => {
    const grandma = fakeVoice("Grandma", "ko-KR");
    const google = fakeVoice("Google 한국의", "ko-KR");
    expect(await voiceUsedWith([grandma, google])).toBe(google);
  });

  it("알려진 보이스도 없으면 첫 번째 한국어 보이스를 고른다", async () => {
    const rocko = fakeVoice("Rocko", "ko-KR");
    const sandy = fakeVoice("Sandy", "ko_KR");
    expect(await voiceUsedWith([fakeVoice("Samantha", "en-US", true), rocko, sandy])).toBe(rocko);
  });

  it("lang 표기가 ko_KR이어도 한국어로 본다", async () => {
    const underscore = fakeVoice("Yuna", "ko_KR");
    expect(await voiceUsedWith([underscore])).toBe(underscore);
  });

  it("한국어 보이스가 없으면 voice를 지정하지 않고 lang만 둔다", async () => {
    expect(await voiceUsedWith([fakeVoice("Samantha", "en-US", true)])).toBeNull();
  });
});

describe("cancelSpeech", () => {
  it("owner 없이 부르면 무조건 끊는다", async () => {
    const synth = installFakeSpeech();
    const { cancelSpeech } = await loadSpeech();

    cancelSpeech();

    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("마지막으로 읽기 시작한 owner일 때만 끊는다", async () => {
    const synth = installFakeSpeech();
    const { cancelSpeech, speak } = await loadSpeech();
    const camera = Symbol("camera");
    const form = Symbol("form");

    speak("촬영 안내", camera);
    speak("결과 낭독", form); // 앞 문장을 끊느라 부른 cancel은 여기서 제외한다
    synth.cancel.mockClear();
    cancelSpeech(camera);
    expect(synth.cancel).not.toHaveBeenCalled();

    cancelSpeech(form);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("owner 없이 시작한 낭독은 owner를 준 cancel로 끊기지 않는다", async () => {
    const synth = installFakeSpeech();
    const { cancelSpeech, speak } = await loadSpeech();

    speak("음성 안내를 켰어요");
    cancelSpeech(Symbol("form"));

    expect(synth.cancel).not.toHaveBeenCalled();
  });
});

describe("primeSpeech", () => {
  it("무음 빈 utterance를 한 번만 넣는다", async () => {
    const synth = installFakeSpeech();
    const { primeSpeech } = await loadSpeech();

    primeSpeech();
    primeSpeech();

    expect(synth.speak).toHaveBeenCalledTimes(1);
    const [utterance] = synth.speak.mock.calls[0];
    expect(utterance.text).toBe("");
    expect(utterance.volume).toBe(0);
  });

  it("탭 밖에서 먼저 speak했더라도 prime은 한 번 실행된다", async () => {
    // 첫 진입 홈 안내처럼 브라우저가 막았을 수 있는 발화는 iOS 제한을 풀지 못한다
    const synth = installFakeSpeech();
    const { primeSpeech, speak } = await loadSpeech();

    speak("작물을 고르고 잎을 찍어주세요");
    primeSpeech();

    expect(spokenTexts(synth)).toEqual(["작물을 고르고 잎을 찍어주세요", ""]);
  });
});

describe("warmUpVoices", () => {
  it("보이스 목록 로드를 미리 요청한다", async () => {
    const synth = installFakeSpeech();
    const { warmUpVoices } = await loadSpeech();

    warmUpVoices();

    expect(synth.getVoices).toHaveBeenCalled();
  });
});

describe("speakAndWait 실패 알림", () => {
  it("3초 안에 시작하지 않으면 한 번 더 읽어 보고, 그래도 안 되면 이유를 붙여 알린다", async () => {
    vi.useFakeTimers();
    const synth = installFakeSpeech();
    const speech = await loadSpeech();
    const promise = speech.speakAndWait("안녕하세요");
    await vi.advanceTimersByTimeAsync(3100 + 400 + 3100);
    const outcome = await promise;
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ spoken: false, reason: "no-start-retry" });
    expect(speech.speechFailureText(outcome)).toMatch(/소리로 읽지 못했어요.*\(no-start-retry\)/);
    vi.useRealTimers();
  });

  it("두 번째에 시작하면 성공으로 본다", async () => {
    vi.useFakeTimers();
    const synth = installFakeSpeech();
    const speech = await loadSpeech();
    const promise = speech.speakAndWait("안녕하세요");
    await vi.advanceTimersByTimeAsync(3100 + 400);
    const second = synth.speak.mock.calls[1][0] as unknown as { onstart: () => void; onend: () => void };
    second.onstart(); second.onend();
    expect(await promise).toEqual({ spoken: true });
    vi.useRealTimers();
  });

  it("첫 문장에서 not-allowed 오류가 나면 실패로, 끊김(interrupted)은 실패가 아니다", async () => {
    const synth = installFakeSpeech();
    const speech = await loadSpeech();
    const blocked = speech.speakAndWait("안녕하세요");
    (synth.speak.mock.calls[0][0] as unknown as { onerror: (e: { error: string }) => void }).onerror({ error: "not-allowed" });
    expect(await blocked).toEqual({ spoken: false, reason: "not-allowed" });
    expect(speech.speechFailureText({ spoken: false, reason: "language-unavailable" })).toMatch(/한국어를 설치/);
    expect(speech.speechFailureText({ spoken: false, reason: "interrupted" })).toBeNull();
    expect(speech.speechFailureText({ spoken: true })).toBeNull();
  });

  type Handlers = { onstart?: () => void; onend?: () => void; onerror?: (event: { error: string }) => void };
  const queued = (synth: ReturnType<typeof installFakeSpeech>) =>
    synth.speak.mock.calls.map(([utterance]) => utterance as unknown as Handlers);

  it("첫 문장에서 오류가 나고 뒤 문장 이벤트가 오지 않아도 바로 실패로 끝나고 남은 문장을 비운다", async () => {
    const synth = installFakeSpeech();
    const speech = await loadSpeech();
    const done = speech.speakAndWait(["첫 문장", "둘째 문장", "셋째 문장"]);
    synth.cancel.mockClear();
    queued(synth)[0].onerror?.({ error: "audio-busy" }); // 뒤 두 문장은 아무 이벤트도 오지 않는다
    expect(await done).toEqual({ spoken: false, reason: "audio-busy" });
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("읽던 중 오류가 나고 뒤 문장 이벤트가 오지 않아도 끝난다(읽은 데까지는 읽은 것으로 본다)", async () => {
    const synth = installFakeSpeech();
    const speech = await loadSpeech();
    const done = speech.speakAndWait(["첫 문장", "둘째 문장", "셋째 문장"]);
    const [first, second] = queued(synth);
    first.onstart?.();
    first.onend?.();
    second.onerror?.({ error: "audio-busy" });
    expect(await done).toEqual({ spoken: true });
  });

  it("첫 문장이 끊기고(interrupted) 뒤 문장 이벤트가 오지 않아도 끝나며 실패 안내는 없다", async () => {
    const synth = installFakeSpeech();
    const speech = await loadSpeech();
    const done = speech.speakAndWait(["첫 문장", "둘째 문장"]);
    queued(synth)[0].onerror?.({ error: "interrupted" });
    const outcome = await done;
    expect(speech.speechFailureText(outcome)).toBeNull();
  });

  it("실패 뒤 다른 쪽이 낭독을 시작했으면 그 낭독은 끊지 않는다", async () => {
    const synth = installFakeSpeech();
    const speech = await loadSpeech();
    const done = speech.speakAndWait(["첫 문장", "둘째 문장"], Symbol("mine"));
    const [first] = queued(synth);
    speech.speak("다른 안내", Symbol("other"));
    synth.cancel.mockClear();
    first.onerror?.({ error: "audio-busy" });
    expect(await done).toEqual({ spoken: false, reason: "audio-busy" });
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it("primeSpeech 는 누를 때마다 멈춘 낭독 엔진을 풀어 준다 (안드로이드 Chrome)", async () => {
    const synth = installFakeSpeech();
    const speech = await loadSpeech();
    speech.primeSpeech(); speech.primeSpeech();
    expect(synth.resume).toHaveBeenCalledTimes(2);
    expect(synth.speak).toHaveBeenCalledTimes(1);  // 무음 발화는 한 번만
  });
});
