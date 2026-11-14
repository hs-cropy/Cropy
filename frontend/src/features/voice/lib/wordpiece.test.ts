import { describe, expect, it } from "vitest";
import { WordPieceTokenizer } from "./wordpiece";

const vocab = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "이거", "무슨", "병", "##이야", "{", "}", "\"", ":", ",", "ui", "##_", "##stage", "result", "약", "?", "中"];
const tokenizer = new WordPieceTokenizer({
  model: { type: "WordPiece", vocab: Object.fromEntries(vocab.map((t, i) => [t, i])), unk_token: "[UNK]", continuing_subword_prefix: "##", max_input_chars_per_word: 100 },
});
const id = (t: string) => vocab.indexOf(t);

describe("WordPieceTokenizer", () => {
  it("공백으로 나누고 이어지는 조각은 ##로 찾는다", () => {
    expect(tokenizer.tokenize("이거 무슨 병이야")).toEqual([id("이거"), id("무슨"), id("병"), id("##이야")]);
  });

  it("문장부호는 따로 떼어 낸다", () => {
    expect(tokenizer.tokenize("약?")).toEqual([id("약"), id("?")]);
    expect(tokenizer.preTokenize('{"ui_stage":"result"}')).toEqual(["{", "\"", "ui", "_", "stage", "\"", ":", "\"", "result", "\"", "}"]);
  });

  it("사전에 없는 단어는 통째로 [UNK]", () => {
    expect(tokenizer.tokenize("고추")).toEqual([id("[UNK]")]);
  });

  it("제어 문자는 지우고 탭·줄바꿈은 공백, 한자는 앞뒤를 띄운다", () => {
    expect(tokenizer.normalize("약\u0007\t병\n中")).toBe("약 병  中 ");
  });

  it("쌍 인코딩은 [CLS] A [SEP] B [SEP]이고 B의 type id는 1", () => {
    const enc = tokenizer.encodePair("이거", "약");
    expect(enc.inputIds).toEqual([id("[CLS]"), id("이거"), id("[SEP]"), id("약"), id("[SEP]")]);
    expect(enc.typeIds).toEqual([0, 0, 0, 1, 1]);
    expect(enc.attentionMask).toEqual([1, 1, 1, 1, 1]);
  });

  it("길이를 넘으면 두 번째 문장만 자른다", () => {
    const enc = tokenizer.encodePair("이거 무슨", "약 약 약 약", 7);
    expect(enc.inputIds).toEqual([id("[CLS]"), id("이거"), id("무슨"), id("[SEP]"), id("약"), id("약"), id("[SEP]")]);
    expect(enc.typeIds).toEqual([0, 0, 0, 0, 1, 1, 1]);
  });
});
