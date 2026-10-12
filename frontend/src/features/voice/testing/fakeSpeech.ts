import { vi } from "vitest";

/**
 * 테스트용 가짜 speechSynthesis. jsdom에는 Web Speech API가 없어서
 * window.speechSynthesis와 SpeechSynthesisUtterance를 직접 심는다.
 * 실제 API처럼 speak하면 pending이 되고 cancel하면 비워진다.
 * 정리는 vitest.setup.ts의 vi.unstubAllGlobals()가 한다.
 */
export class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;

  constructor(text = "") {
    this.text = text;
  }
}

export function fakeVoice(name: string, lang: string, isDefault = false): SpeechSynthesisVoice {
  return { name, lang, default: isDefault, localService: true, voiceURI: name };
}

export function installFakeSpeech(voices: SpeechSynthesisVoice[] = []) {
  const synth = {
    speaking: false,
    pending: false,
    speak: vi.fn<(utterance: FakeUtterance) => void>(() => {
      synth.pending = true;
    }),
    cancel: vi.fn(() => {
      synth.speaking = false;
      synth.pending = false;
    }),
    getVoices: vi.fn(() => voices),
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return synth;
}

export type FakeSpeech = ReturnType<typeof installFakeSpeech>;

/** speak()에 넘어간 문장들 */
export function spokenTexts(synth: FakeSpeech): string[] {
  return synth.speak.mock.calls.map(([utterance]) => utterance.text);
}
