// 농업 용어 보정 — stt/lexicon.py 를 그대로 옮겼다. 규칙 설명과 근거는 그 파일의 머리말을 본다.
// 서버와 같은 결과인지는 tests/offline-voice-lexicon.test.mjs 가 Python 기준 출력으로 확인한다.

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ',
  'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const FUZZY_MIN = 3;

export const isHangul = ch => { const c = ch.codePointAt(0); return c >= 0xac00 && c <= 0xd7a3; };

export function toJamo(text) {
  let out = '';
  for (const ch of text) {
    if (isHangul(ch)) { const c = ch.codePointAt(0) - 0xac00; out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28]; }
    else out += ch;
  }
  return out;
}

function distance(a, b) {
  a = [...a]; b = [...b];
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const cur = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] !== b[j - 1] ? 1 : 0)); prev = cur; }
  }
  return row[b.length];
}

const maxDistance = (termCompact, termJamo, spansSpace) =>
  spansSpace || [...termCompact].length <= FUZZY_MIN ? 1 : Math.floor([...termJamo].length / 4);

/** terms.txt 내용 → 줄 목록 (# 뒤 주석·빈 줄 제외) */
export const parseTerms = text => text.split('\n').map(l => l.split('#')[0].trim()).filter(Boolean);

const usable = w => [...w].length >= 2 && [...w].every(isHangul);
const usableAlias = w => [...w].length >= 2 && [...w].some(isHangul);
const isSpace = ch => /\s/u.test(ch);

// Python 튜플 정렬과 같게: (거리, -길이, 시작, 끝, 용어, 바꿀지)
function cmp(a, b) {
  for (let i = 0; i < 6; i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (typeof x === 'string') return x < y ? -1 : 1;
    return Number(x) < Number(y) ? -1 : 1;
  }
  return 0;
}

export class Lexicon {
  constructor(terms) {
    this.terms = []; this.aliases = new Map();
    for (const entry of [...new Set(terms)]) {
      const at = entry.indexOf('=');
      const term = (at < 0 ? entry : entry.slice(0, at)).trim(), heard = at < 0 ? '' : entry.slice(at + 1);
      const compact = term.replaceAll(' ', '');
      if (!usable(compact)) continue;
      this.terms.push([term, compact, toJamo(compact)]);
      for (let alias of heard.split(',')) {
        alias = alias.replaceAll(' ', '');
        if (usableAlias(alias) && alias !== compact) this.aliases.set(alias, term);  // 같은 말이 또 나오면 뒤 용어 (Python dict 와 같다)
      }
    }
  }

  correct(text) {
    const src = [...text];
    const chars = []; src.forEach((ch, i) => { if (!isSpace(ch)) chars.push([ch, i]); });
    const compact = chars.map(c => c[0]);
    const wordStart = chars.map(([, i]) => i === 0 || !isHangul(src[i - 1]));
    const candidates = [];
    const exact = (word, term) => {
      const w = [...word], size = w.length;
      for (let s = 0; s + size <= compact.length; s++) {
        if (compact.slice(s, s + size).join('') === word) candidates.push([0, -size, s, s + size, term, word !== term.replaceAll(' ', '')]);
      }
    };
    for (const [term, termCompact, termJamo] of this.terms) {
      exact(termCompact, term);
      const tc = [...termCompact], n = tc.length;
      if (n < FUZZY_MIN) continue;
      for (let s = 0; s + n <= compact.length; s++) {
        const win = compact.slice(s, s + n);
        const window = win.join('');
        if (window === termCompact || !wordStart[s] || !win.every(isHangul)) continue;
        if (win[n - 1] !== tc[n - 1]) continue;
        const spansSpace = chars[s + n - 1][1] - chars[s][1] !== n - 1;
        const d = distance(toJamo(window), termJamo);
        if (d <= maxDistance(termCompact, termJamo, spansSpace)) candidates.push([d, -n, s, s + n, term, true]);
      }
    }
    for (const [alias, term] of this.aliases) exact(alias, term);

    const taken = new Array(compact.length).fill(false), chosen = [];
    for (const [, , s, e, term, replace] of candidates.sort(cmp)) {
      if (taken.slice(s, e).some(Boolean)) continue;
      for (let k = s; k < e; k++) taken[k] = true;
      if (replace) chosen.push([s, e, term]);
    }
    const corrections = [];
    let out = src;
    for (const [s, e, term] of chosen.sort((a, b) => b[0] - a[0] || b[1] - a[1] || (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0))) {
      const lo = chars[s][1], hi = chars[e - 1][1] + 1;
      corrections.push({ heard: src.slice(lo, hi).join(''), term });
      out = [...out.slice(0, lo), ...term, ...out.slice(hi)];
    }
    corrections.reverse();
    return { text: out.join(''), corrections };
  }
}
