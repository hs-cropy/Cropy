/**
 * 휴대폰 분류기(#167)용 BERT WordPiece 토크나이저. KoELECTRA-small-v3의 `tokenizer.json`을 그대로 읽는다.
 *
 * 학습 때 쓴 Hugging Face tokenizers와 같은 규칙만 구현한다.
 *   - BertNormalizer: clean_text, handle_chinese_chars, lowercase 끔, strip_accents 끔
 *   - BertPreTokenizer: 공백으로 나누고 문장부호는 한 글자씩 떼어 낸다
 *   - WordPiece: 앞에서부터 가장 긴 조각, 이어지는 조각은 "##", 100글자 넘는 단어는 [UNK]
 *   - 쌍 인코딩: [CLS] A [SEP] B [SEP], 넘치면 B(화면 상태)만 자른다 (truncation='only_second')
 * 전체 validation 1,160행에서 Python tokenizers와 같은 id를 내는지는 wordpiece.model.test.ts가 확인한다.
 */

interface TokenizerJson {
  model: { type: string; vocab: Record<string, number>; unk_token: string; continuing_subword_prefix: string; max_input_chars_per_word: number };
}

export interface PairEncoding {
  inputIds: number[];
  typeIds: number[];
  attentionMask: number[];
}

// BERT가 한자로 보는 범위 (한글은 해당 없음)
const CJK: Array<[number, number]> = [
  [0x4e00, 0x9fff], [0x3400, 0x4dbf], [0x20000, 0x2a6df], [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f], [0x2b820, 0x2ceaf], [0xf900, 0xfaff], [0x2f800, 0x2fa1f],
];
const isCjk = (cp: number) => CJK.some(([a, b]) => cp >= a && cp <= b);
const OTHER = /\p{C}/u; // 제어·서식 문자 (Rust char::is_other)
const PUNCT = /\p{P}/u;
const isWhitespace = (ch: string) => ch === "\t" || ch === "\n" || ch === "\r" || /\s/u.test(ch);
const isControl = (ch: string) => ch !== "\t" && ch !== "\n" && ch !== "\r" && OTHER.test(ch);
function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return PUNCT.test(ch);
}

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly unk: number;
  private readonly cls: number;
  private readonly sep: number;
  private readonly prefix: string;
  private readonly maxChars: number;

  constructor(json: TokenizerJson) {
    if (json.model?.type !== "WordPiece") throw new Error("WordPiece 토크나이저가 아니에요");
    this.vocab = new Map(Object.entries(json.model.vocab));
    const id = (token: string) => {
      const value = this.vocab.get(token);
      if (value === undefined) throw new Error(`토크나이저에 ${token}이 없어요`);
      return value;
    };
    this.unk = id(json.model.unk_token);
    this.cls = id("[CLS]");
    this.sep = id("[SEP]");
    this.prefix = json.model.continuing_subword_prefix;
    this.maxChars = json.model.max_input_chars_per_word;
  }

  /** BertNormalizer (lowercase·strip_accents 끔) */
  normalize(text: string): string {
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      if (isWhitespace(ch)) out += " ";
      else if (isCjk(cp)) out += ` ${ch} `;
      else out += ch;
    }
    return out;
  }

  /** BertPreTokenizer: 공백으로 나누고 문장부호를 따로 떼어 낸다 */
  preTokenize(text: string): string[] {
    const words: string[] = [];
    let current = "";
    const flush = () => { if (current) { words.push(current); current = ""; } };
    for (const ch of text) {
      if (isWhitespace(ch)) flush();
      else if (isPunctuation(ch)) { flush(); words.push(ch); }
      else current += ch;
    }
    flush();
    return words;
  }

  private wordPiece(word: string): number[] {
    const chars = Array.from(word);
    if (chars.length > this.maxChars) return [this.unk];
    const ids: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: number | undefined;
      while (start < end) {
        let piece = chars.slice(start, end).join("");
        if (start > 0) piece = this.prefix + piece;
        found = this.vocab.get(piece);
        if (found !== undefined) break;
        end -= 1;
      }
      if (found === undefined) return [this.unk];
      ids.push(found);
      start = end;
    }
    return ids;
  }

  tokenize(text: string): number[] {
    return this.preTokenize(this.normalize(text)).flatMap((word) => this.wordPiece(word));
  }

  /** (발화, 화면 상태 JSON) 쌍. 넘치면 두 번째만 자른다 */
  encodePair(first: string, second: string, maxLength = 256): PairEncoding {
    const a = this.tokenize(first);
    let b = this.tokenize(second);
    const room = maxLength - a.length - 3;
    if (b.length > room) b = b.slice(0, Math.max(0, room));
    const inputIds = [this.cls, ...a, this.sep, ...b, this.sep];
    const typeIds = [...new Array(a.length + 2).fill(0), ...new Array(b.length + 1).fill(1)];
    return { inputIds, typeIds, attentionMask: new Array(inputIds.length).fill(1) };
  }
}
