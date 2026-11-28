// The Chinese checks (SPEC §4.1 "Chinese characters", §4.11 terms-zh.json and hype-words.json, §4.12 ZH_PARITY, ZH_TRADITIONAL,
// ZH_AVOID, ZH_TERMS, ZH_ENGLISH_ONCE, ZH_NO_DASH and ZH_HYPE; routine/STYLE-ZH.md is the guide they serve). Pure functions of
// a string and the config pieces they are given: no file, clock or network. The ZH_ rules of lib/rules/zh.ts, the page-text test
// and the Chinese context builder call these and never reimplement them; each rule's key, path and message are theirs.
//
// What is here, by rule:
// - ZH_CHARS: `countZhChars()`.
// - ZH_PARITY: `parityNumbers()`, `parityGaps()` (English numbers against Chinese ones), `urlsIn()`, `latinWordsMissing()` and
//   `parityProblems()`, which runs all four; `wordsOutsideLinks()` leaves out of the Latin words those that a link spells.
// - ZH_TRADITIONAL: `traditionalHits()`. ZH_AVOID: `avoidHits()`. ZH_NO_DASH: `dashHits()`. ZH_HYPE: `hypeHits()`.
// - ZH_TERMS: `fixedOccurrences()`, `fixedApplies()`, `fixedEntriesFor()` (the context's `fixed` list: `fields` and `except` only)
//   and `fixedMissing()` (which also skips a name the Chinese keeps in English, found by `nameRuns()`).
// - ZH_ENGLISH_ONCE: `englishOnceProblems()`.
// Left to the rules because they need no reading of text: ZH_KEYS, ZH_RUNG_LABEL, ZH_OFFICIAL and the limits of ZH_CHARS.
//
// Decisions the spec leaves open, each pinned by a test in tests/zh.test.ts:
// - countZhChars(): a Han character counts 1; a run of Latin letters and digits (accented and full-width ones too) counts 1,
//   so "8.4" and "2,000" are two runs, as STYLE-ZH.md §11 warns; a letter or number of any other script (Greek, kana, Hangul)
//   counts 1 each; punctuation, symbols and spaces count 0, and combining marks and format characters neither count nor end a run.
// - parityNumbers(): values are exact decimal strings, never floats (1.1 million is 1100000, not 1100000.0000000002). A number is
//   read after full-width digits and ％ are folded to ASCII (a full-width comma or point between two full-width digits too). A
//   multiplier word needs a space or a hyphen before it ("5million" is 5); 萬 and 億 may touch the number. "3 percentage points"
//   is a plain 3 (a word boundary follows "percent"). Trillion, 兆 and 千 are not read, so each passes only against itself.
// - parityGaps(): a set comparison, so a number repeated in one language needs no repeat in the other. An English month name
//   frees its number, "May" as a sentence's first word only before a day or a year; an English number word from one to ten frees
//   its digit, and "three percent" also frees 3%, since STYLE-ZH.md §5 has a percentage written with %.
// - latinWordsMissing(): case does not matter, a full-width bracket that holds a glossary term's English (one of the names it is
//   given) is skipped and any other bracketed run is read like the text around it, and a Latin word is a run of Latin letters and
//   digits that holds a letter.
// - nameRuns(): the capitalised-run rule of §4.11 with the decided change (a run starts at its first capitalised word that is not a
//   sentence-initial article and ends at "and"); of, the, for, de and von join, and only spaces stand between a run's words.
// - englishOnceProblems(): the English term follows the first use at once in full-width brackets (case and inner spaces ignored);
//   a later use or the title is refused it in either bracket width. Terms that share one Chinese (dataset and data set) are one
//   group: the first use of that Chinese needs the English of any of them, and the group is reported once, not term by term.
// - Linear time (F-70): the Chinese pass is a model run that a hostile page may steer, so a string of 5 MB must cost the checks of ZH_PARITY
//   what its length costs and never throw: no rescan of the text before a hit (the 百分之 before a number and the opening of a sentence are
//   found by looking back over the characters just before, which are never read twice), no pattern whose scheme or run has no limit
//   (`urlsIn()` reads a scheme of at most 32 characters, as the address check of the safety rules does), no comparison of each result with
//   each other one, and no regular expression that loops over a whole run of millions of characters (the engine's stack overflows there:
//   `latinWordsMissing()` reads a long run in pieces of 4,096 and joins them). Each of these has a test with a 5 MB string. The review of
//   F-70 found the same cost in ZH_AVOID: `avoidHits()` copied the text for each hit it masked, so it masks the hits of one term together.
//   A scheme that is longer than 32 characters is read from its last 32, so it is found only when a letter stands among them.
// New for this project; Cyber has no Chinese pass.

import type { ConfigIndex } from "./config";
import { monthShort } from "./format";
import type { AvoidTerm, FixedTerm, HypeWordsFile } from "./schema/config";
import { escapeRegExp, maskPhrases, wordRe } from "./text";
import type { FieldId } from "./vocab";

/** One string, or the strings of one unit (a term's name and definition) judged together: they are joined by a line break. */
export type Strings = string | readonly string[];

const joinText = (t: Strings): string => (typeof t === "string" ? t : t.join("\n"));

// ── Characters (SPEC §4.1) ───────────────────────────────────────────────────────────────────────

const HAN = /^\p{Script=Han}$/u;
const LATIN_OR_DIGIT = /^[\p{Script=Latin}\p{Nd}]$/u;
const INVISIBLE = /^[\p{M}\p{Cf}]$/u;
const OTHER_LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u;

/**
 * The Chinese length of a text (§4.1; ZH_CHARS): each Han character counts 1 and each run of Latin letters or digits counts 1;
 * punctuation and spaces count 0. So AlphaFold 3 is 2 and 蛋白質摺疊（protein folding）is 7. Punctuation ends a run, so a decimal
 * (8.4) or a number with commas (2,000) is two runs. A letter or number of another script counts 1 each, a symbol 0, and a
 * combining mark or format character counts 0 without ending a run. Read by code point.
 */
export function countZhChars(text: string): number {
  let n = 0;
  let inRun = false;
  for (const ch of text) {
    if (HAN.test(ch)) {
      n += 1;
      inRun = false;
    } else if (LATIN_OR_DIGIT.test(ch)) {
      if (!inRun) n += 1;
      inRun = true;
    } else if (!INVISIBLE.test(ch)) {
      inRun = false;
      if (OTHER_LETTER_OR_NUMBER.test(ch)) n += 1;
    }
  }
  return n;
}

// ── Numbers (SPEC §4.12 ZH_PARITY) ───────────────────────────────────────────────────────────────

/** One number read by `parityNumbers()`. */
export interface ParityNumber {
  /** The exact value, multiplier applied, as a plain decimal: "700000", "2.5", "0.5". Never a float. */
  value: string;
  /** Read as a percentage: written with %, "per cent" or "percent" after it, or 百分之 before it. */
  percent: boolean;
  /** The value, then "%" for a percentage: the string two numbers are the same by. */
  key: string;
  /** What the text wrote, from the first character that makes the number (百分之 included) to the last (the multiplier or the percent sign). */
  text: string;
  /** Where `text` starts in the string read. */
  index: number;
}

/** A number is each run of digits, thousands separators (a comma and exactly three digits) dropped, then an optional decimal part: the whole part is group 1, the decimal digits group 2. */
const NUMBER_RE = /((?:\d{1,3}(?:,\d{3})+(?!\d)|\d+))(?:\.(\d+))?/g;
const SPACES = " \\u00A0\\u2009\\u202F";
/** After a number: a thousand, million or billion (a space or a hyphen between), or 萬 or 億 (nothing or a space between). */
const MULTIPLIER_RE = new RegExp(`^(?:[${SPACES}-](thousand|million|billion)(?!\\p{L})|[${SPACES}]?(萬|億))`, "iu");
/** After a number: %, "per cent" or "percent" (a word boundary, so "percentage" is not one). */
const PERCENT_RE = new RegExp(`^(?:[${SPACES}]*%|[${SPACES}-]per[ \\u00A0]?cent(?!\\p{L}))`, "iu");
/** One of the white-space characters that may stand between a number and its 百分之, a multiplier or a percent sign. */
const SPACE_RE = new RegExp(`^[${SPACES}]$`, "u");
/** Before a number: 百分之. */
const PERCENT_PREFIX = "百分之";
/** The decimal places a multiplier moves the point: thousand 3, million 6, billion 9, 萬 4, 億 8. 千 is not read. */
const SHIFT: Readonly<Record<string, number>> = { thousand: 3, million: 6, billion: 9, "萬": 4, "億": 8 };

/** Full-width digits to ASCII, and ％ to %; a full-width comma or point between two full-width digits to its ASCII form. Every character stays one code unit. */
function foldWidth(text: string): string {
  return text
    .replace(/(?<=[０-９])[，．](?=[０-９])/g, (c) => (c === "，" ? "," : "."))
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    .replaceAll("％", "%");
}

/**
 * How many characters of 百分之, and the white space after it, end at `at` in `s`: the length of the match of `百分之[SPACES]*$` on the
 * text before `at`, or 0. Read backward from `at`, so that a text with a million numbers is not read a million times over.
 */
function percentPrefixLength(s: string, at: number): number {
  let from = at;
  while (from > 0 && SPACE_RE.test(s[from - 1]!)) from -= 1;
  const start = from - PERCENT_PREFIX.length;
  return start >= 0 && s.startsWith(PERCENT_PREFIX, start) ? at - start : 0;
}

/** `int.frac` times ten to the `shift`, as a plain decimal with no leading zero and no trailing zero after the point. */
function decimalValue(int: string, frac: string, shift: number): string {
  // A whole number with no multiplier and no leading zero is its own value: the case a text of millions of numbers repeats.
  if (shift === 0 && frac === "" && !int.startsWith("0")) return int;
  const point = int.length + shift;
  const digits = (int + frac).padEnd(point, "0");
  const whole = digits.slice(0, point).replace(/^0+/, "") || "0";
  const rest = digits.slice(point).replace(/0+$/, "");
  return rest === "" ? whole : `${whole}.${rest}`;
}

/**
 * Calls `visit` with each number of a text, as `parityNumbers()` reads them, in order of appearance, repeats included. No list is
 * kept: a text of millions of numbers read into a list costs the engine six times what reading it through does.
 */
function eachNumber(text: string, visit: (found: ParityNumber) => void): void {
  const s = foldWidth(text);
  for (const m of s.matchAll(NUMBER_RE)) {
    const int = m[1]!.replaceAll(",", "");
    const frac = m[2] ?? "";
    const rest = s.slice(m.index + m[0].length);
    let shift = 0;
    let percent = false;
    let length = m[0].length;
    const multiplier = MULTIPLIER_RE.exec(rest);
    const pct = PERCENT_RE.exec(rest);
    if (multiplier) {
      shift = SHIFT[(multiplier[1] ?? multiplier[2]!).toLowerCase()]!;
      length += multiplier[0].length;
    } else if (pct) {
      percent = true;
      length += pct[0].length;
    }
    let start = m.index;
    const prefix = percentPrefixLength(s, start);
    if (prefix > 0) {
      percent = true;
      start -= prefix;
      length += prefix;
    }
    const value = decimalValue(int, frac, shift);
    visit({ value, percent, key: percent ? `${value}%` : value, text: text.slice(start, start + length), index: start });
  }
}

/**
 * The numbers of a text, read the same way in either language (§4.12 ZH_PARITY): each run of digits, glued to letters or not
 * (12th, COVID-19), years and dates included, with thousands separators dropped and decimals kept; full-width digits and ％ read
 * as ASCII ones. A thousand, million or billion after it (a space or a hyphen between), or a 萬 or 億 after it, multiplies it
 * (70 萬 is 700000; 千 is not read, as it starts units such as 千瓦); a %, "per cent" or "percent" after it, or a 百分之 before
 * it, makes it a percentage. Chinese numerals (一, 三, 兩, 百) are not read. In order of appearance, repeats included.
 */
export function parityNumbers(text: string): ParityNumber[] {
  const out: ParityNumber[] = [];
  eachNumber(text, (n) => {
    out.push(n);
  });
  return out;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
  "December"] as const;
/** The full names, then the three-letter forms that monthShort() writes ("Sep" for September), as whole words. */
const MONTH_RE = new RegExp(`(?<!\\p{L})(${[...MONTH_NAMES, ...MONTH_NAMES.map((_, i) => monthShort(i + 1))].join("|")})(?!\\p{L})`, "gu");
const OPENERS = "\"'“‘„«‹「『([{（【";
const OPENING_RE = new RegExp(`^[\\s${escapeRegExp(OPENERS)}]$`, "u");
const STOPS = ".!?。？！";
const CLOSERS = ")]}\"'”’»」』）】";

/**
 * Whether the word at `index` is a sentence's first: the text opens with it, or a line break or a stop (. ! ? 。 ？ ！) and then only
 * quotes and brackets come before it. Read backward from the word, over the white space and opening marks just before it, then over
 * the closing marks: each character is read once for the word that follows it, so a text with a million words is read once, not a million times.
 */
function startsSentence(text: string, index: number): boolean {
  let at = index;
  let lineBreak = false;
  while (at > 0 && OPENING_RE.test(text[at - 1]!)) {
    at -= 1;
    if (text[at] === "\n") lineBreak = true;
  }
  if (at === 0 || lineBreak) return true;
  while (at > 0 && CLOSERS.includes(text[at - 1]!)) at -= 1;
  return at > 0 && STOPS.includes(text[at - 1]!);
}

/**
 * The month numbers (1 to 12) of the capitalised English month names in a text, each once, in order of appearance: the full names
 * and the three-letter forms of monthShort() (January to December, Jan to Dec). "May" as a sentence's first word counts only
 * when a number follows it (a day or a year: "May 5", "May 2024"); anywhere else a capitalised "May" is the month.
 */
export function englishMonthNumbers(text: string): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(MONTH_RE)) {
    const name = m[1]!;
    if (name === "May" && startsSentence(text, m.index) && !/^[ \u00A0]*\d/.test(text.slice(m.index + 3))) continue;
    const full = MONTH_NAMES.findIndex((month) => month === name || month.slice(0, 3) === name);
    seen.add(full + 1);
  }
  return [...seen];
}

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"] as const;
const NUMBER_WORD_RE = new RegExp(`(?<!\\p{L})(${NUMBER_WORDS.join("|")})(?!\\p{L})`, "giu");

/**
 * The keys (as ParityNumber.key) the English number words one to ten free in the Chinese: "3" for "three", and "3%" as well when
 * "percent" or "per cent" follows it. In order of appearance, repeats included.
 */
export function englishNumberWordKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(NUMBER_WORD_RE)) {
    const value = String(NUMBER_WORDS.indexOf(m[1]!.toLowerCase() as (typeof NUMBER_WORDS)[number]) + 1);
    keys.push(value);
    if (PERCENT_RE.test(text.slice(m.index + m[0].length))) keys.push(`${value}%`);
  }
  return keys;
}

/** What a Chinese text and its English do not share, each number once, in order of appearance. */
export interface ParityGaps {
  /** Numbers of the English that the Chinese lacks (the same value, a percentage as a percentage). */
  missing: ParityNumber[];
  /** Numbers of the Chinese that are not in the English, nor the month number of one of its month names, nor the value of one of its number words from one to ten. */
  extra: ParityNumber[];
}

/** Each number once, the first of its key, in order. One pass with a set: comparing each number with every earlier one would cost the square of their count. */
function distinct(numbers: readonly ParityNumber[]): ParityNumber[] {
  const seen = new Set<string>();
  return numbers.filter((n) => {
    if (seen.has(n.key)) return false;
    seen.add(n.key);
    return true;
  });
}

/**
 * ZH_PARITY's numbers (§4.12): every English number appears in the Chinese with the same value (a percentage as a percentage), and
 * every Chinese number is an English number, or the month number of a capitalised English month name, or the value of an English
 * number word from one to ten. Pass a term's name and definition as one array, and its Chinese the same way.
 */
export function parityGaps(en: Strings, zh: Strings): ParityGaps {
  const english = joinText(en);
  const inEnglish = parityNumbers(english);
  const known = new Set([...inEnglish.map((n) => n.key), ...englishMonthNumbers(english).map(String), ...englishNumberWordKeys(english)]);
  // The Chinese is read once and never kept (it is the draft's, which may be millions of numbers): its first number of each key is an
  // extra when the English does not know the key.
  const have = new Set<string>();
  const extra: ParityNumber[] = [];
  eachNumber(joinText(zh), (n) => {
    if (have.has(n.key)) return;
    have.add(n.key);
    if (!known.has(n.key)) extra.push(n);
  });
  return { missing: distinct(inEnglish.filter((n) => !have.has(n.key))), extra };
}

// ── Links and Latin words (ZH_PARITY) ────────────────────────────────────────────────────────────

/** The longest scheme `urlsIn()` reads before `://`: an RFC 3986 scheme has no limit, but a pattern that scans without one is quadratic in a long run of letters (32 is the limit of the safety rules' address reader). */
const SCHEME_MAX = 32;
const URL_RES: readonly RegExp[] = [
  new RegExp(`[A-Za-z][A-Za-z0-9+.-]{0,${SCHEME_MAX - 1}}:\\/\\/\\S+`, "g"),
  /(?<![\p{L}\p{N}.@])www\.\S+/giu,
  /(?<![\p{L}\p{N}.@-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?![\p{Script=Latin}\p{N}-])(?:[/?#]\S*)?/giu,
];

/**
 * The URLs a text holds (ZH_PARITY: a Chinese string holds none): anything with a scheme and `//`, anything that starts `www.`, and
 * a host written without a scheme (two or more dot-separated labels of letters, digits and hyphens, the last of two or more letters,
 * with any path). Each as written, in order of appearance, none twice; a host inside a longer URL is not a second one.
 */
export function urlsIn(text: string): string[] {
  const found = URL_RES.flatMap((re) => [...text.matchAll(re)].map((m) => ({ start: m.index, length: m[0].length, url: m[0] })));
  // A stable sort, so at one start the earlier pattern wins: a scheme or www. match is never shorter than a bare host there.
  found.sort((a, b) => a.start - b.start);
  const out: string[] = [];
  let covered = 0;
  for (const f of found) {
    if (f.start < covered) continue;
    out.push(f.url);
    covered = f.start + f.length;
  }
  return [...new Set(out)];
}

const BRACKETED_RE = /（[^（）]*）/gu;
/** The most characters of a run that one match of the word pattern reads: a pattern that loops over millions of characters at once overruns the engine's stack. */
const WORD_PIECE = 4096;
const LATIN_WORD_RE = new RegExp(`[\\p{Script=Latin}\\p{Nd}]{1,${WORD_PIECE}}`, "gu");
const HAS_LATIN_LETTER = /\p{Script=Latin}/u;

/** The runs of Latin letters and digits of a text that hold a letter, as written, in order. A run longer than WORD_PIECE comes in pieces that touch, which are joined. */
function latinWordsOf(text: string): string[] {
  const runs: string[] = [];
  let end = -1;
  for (const m of text.matchAll(LATIN_WORD_RE)) {
    if (m.index === end) runs[runs.length - 1] += m[0];
    else runs.push(m[0]);
    end = m.index + m[0].length;
  }
  return runs.filter((w) => HAS_LATIN_LETTER.test(w));
}

/** A term's English as a bracket may hold it: case and runs of white space do not matter (the same test as `bracketMatcher()`). */
const termKey = (text: string): string => text.trim().split(/\s+/u).join(" ").toLowerCase();

/**
 * The Latin words of the Chinese that the English lacks (ZH_PARITY: no Latin word that the English lacks, except the English name of
 * a glossary term in full-width brackets), as written, each once, in order of appearance. A Latin word is a run of Latin letters and
 * digits that holds a letter (AlphaFold, CO2, Cas9), so COVID-19 is the word COVID; case does not matter. A run in full-width
 * brackets is skipped only when it is one of `terms` (the English names of the glossary terms that apply: the whole run, case and
 * runs of white space ignored); any other bracketed run is read as the text around it is, so its Latin words must be in the English.
 */
export function latinWordsMissing(en: Strings, zh: Strings, terms: readonly string[] = []): string[] {
  const english = new Set(latinWordsOf(joinText(en)).map((w) => w.toLowerCase()));
  const names = new Set(terms.map(termKey));
  const outside = joinText(zh).replace(BRACKETED_RE, (run) => (names.has(termKey(run.slice(1, -1))) ? " " : run));
  return [...new Set(latinWordsOf(outside).filter((w) => !english.has(w.toLowerCase())))];
}

/** What ZH_PARITY finds in one Chinese text against its English, each list empty when the text passes. */
export interface ParityProblems extends ParityGaps {
  /** URLs in the Chinese (`urlsIn()`). */
  urls: string[];
  /** Latin words in the Chinese that the English lacks (`latinWordsMissing()`). */
  latin: string[];
}

/**
 * The Latin words of `words` that no link of `urls` spells (the letters of a link are no Latin words of their own: the link is the
 * problem), as written, in order. A word is spelled by a link when it is one of the words of a link, case aside. The words of every
 * link are read once into a set, so a text of tens of thousands of links and words costs their length, not their product.
 */
export function wordsOutsideLinks(words: readonly string[], urls: readonly string[]): string[] {
  const spelled = new Set(latinWordsOf(urls.join("\n")).map((w) => w.toLowerCase()));
  return words.filter((w) => !spelled.has(w.toLowerCase()));
}

/**
 * All of ZH_PARITY (§4.12) for one Chinese text and its English: the numbers both ways, the URLs and the Latin words. `terms` are the
 * English names of the glossary terms whose English may stand in full-width brackets (`latinWordsMissing()`).
 */
export function parityProblems(en: Strings, zh: Strings, terms: readonly string[] = []): ParityProblems {
  return { ...parityGaps(en, zh), urls: urlsIn(joinText(zh)), latin: latinWordsMissing(en, zh, terms) };
}

// ── Taiwan usage: characters, avoided terms, dashes and hype ─────────────────────────────────────

/** One character that Taiwan does not write, found by `traditionalHits()`. */
export interface CharHit {
  char: string;
  /** Its index in the text (UTF-16 offset, so a character outside the Basic Multilingual Plane is two units). */
  index: number;
  list: "simplified_only" | "japanese_only";
}

/**
 * ZH_TRADITIONAL (§4.12): every `simplified_only` and `japanese_only` character of a text, in order, read by code point and as
 * written (no NFKC). `index.simplifiedOnly` and `index.japaneseOnly` are the loader's sets.
 */
export function traditionalHits(text: string, index: Pick<ConfigIndex, "simplifiedOnly" | "japaneseOnly">): CharHit[] {
  const out: CharHit[] = [];
  let at = 0;
  for (const char of text) {
    if (index.simplifiedOnly.has(char)) out.push({ char, index: at, list: "simplified_only" });
    else if (index.japaneseOnly.has(char)) out.push({ char, index: at, list: "japanese_only" });
    at += char.length;
  }
  return out;
}

/** One `avoid` term found by `avoidHits()`, with the Taiwan form the message names. */
export interface AvoidHit {
  term: string;
  taiwan: string;
  index: number;
}

/**
 * ZH_AVOID (§4.11, §4.12): every `avoid` term left in a text once every `fixed` translation and every `allow_in` string is masked
 * (Chinese has no spaces, so a term can sit inside a Taiwan word, as one sits inside 演算法). The longest term goes first and its hits are
 * masked, so a term inside a longer one is not reported twice. In order of position; `taiwan` is the form to write instead.
 * A term's hits are found first and masked together, once, by one pass over the text: masking each hit as it was found copied the whole
 * text for each of them, so a text of a million hits cost the square of that (a hostile draft, F-70). A hit is searched for only after
 * the hit before it, so masking it at once or at the end of the term gives the same text for the terms that follow.
 */
export function avoidHits(text: string, terms: { avoid: readonly AvoidTerm[]; fixed: readonly FixedTerm[] }): AvoidHit[] {
  let masked = maskPhrases(text, [...terms.fixed.map((f) => f.zh), ...terms.avoid.flatMap((a) => a.allow_in)]);
  const out: AvoidHit[] = [];
  for (const a of [...terms.avoid].sort((x, y) => y.term.length - x.term.length)) {
    const at: number[] = [];
    for (let i = masked.indexOf(a.term); i !== -1; i = masked.indexOf(a.term, i + a.term.length)) at.push(i);
    if (at.length === 0) continue;
    const blank = " ".repeat(a.term.length);
    const pieces: string[] = [];
    let from = 0;
    for (const i of at) {
      out.push({ term: a.term, taiwan: a.taiwan, index: i });
      pieces.push(masked.slice(from, i), blank);
      from = i + a.term.length;
    }
    pieces.push(masked.slice(from));
    masked = pieces.join("");
  }
  return out.sort((x, y) => x.index - y.index);
}

/** One dash found by `dashHits()`. */
export interface DashHit {
  char: string;
  /** Its index in the text (UTF-16 offset). */
  index: number;
  /** "U+2014" form. */
  codePoint: string;
  kind: "dash" | "box";
}

/** The hyphen-minus and the two hyphens, which ZH_NO_DASH lets through. */
const ALLOWED_HYPHENS: ReadonlySet<number> = new Set([0x2d, 0x2010, 0x2011]);
const EN_DASH = 0x2013;
const IS_DASH = /^\p{Pd}$/u;
const IS_DIGIT = /^\p{Nd}$/u;

/**
 * ZH_NO_DASH (§4.12): every dash of a text, read as written, before any NFKC. A dash is any `\p{Pd}` character except the
 * hyphen-minus (U+002D), the hyphens U+2010 and U+2011 and an en dash (U+2013) between digits, and the box-drawing lines U+2500
 * and U+2501 (kind "box"). So U+2014 (alone or doubled), U+2015, U+2E3A, U+FE58 and U+FF0D are hits. In order of position.
 */
export function dashHits(text: string): DashHit[] {
  const chars = [...text];
  const out: DashHit[] = [];
  let at = 0;
  chars.forEach((char, i) => {
    const cp = char.codePointAt(0)!;
    const codePoint = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    if (cp === 0x2500 || cp === 0x2501) out.push({ char, index: at, codePoint, kind: "box" });
    else if (IS_DASH.test(char) && !ALLOWED_HYPHENS.has(cp) && !(cp === EN_DASH && IS_DIGIT.test(chars[i - 1] ?? "") && IS_DIGIT.test(chars[i + 1] ?? ""))) {
      out.push({ char, index: at, codePoint, kind: "dash" });
    }
    at += char.length;
  });
  return out;
}

/** The one Chinese hype word that a Landmark's text may hold (HYPE_WORDS' "breakthrough"): `hype-words.json` lists it last. */
export const LANDMARK_ONLY_ZH = "突破";

/** One hype word found by `hypeHits()`. */
export interface HypeHit {
  word: string;
  index: number;
}

/**
 * ZH_HYPE (§4.11, §4.12): every `hype-words.json` `zh` word in a text, matched anywhere (Chinese has no spaces between words),
 * after each `names` entry's `zh` that is not null (突破獎) is masked wherever it appears. 突破 is let through when `landmark` is
 * true: the text is a Landmark's own (as HYPE_WORDS reads it; the caller decides). In order of position, then list order.
 */
export function hypeHits(text: string, hype: Pick<HypeWordsFile, "zh" | "names">, opts: { landmark: boolean }): HypeHit[] {
  const masked = maskPhrases(text, hype.names.flatMap((n) => (n.zh === null ? [] : [n.zh])));
  const out: HypeHit[] = [];
  for (const word of hype.zh) {
    if (opts.landmark && word === LANDMARK_ONLY_ZH) continue;
    for (let at = masked.indexOf(word); at !== -1; at = masked.indexOf(word, at + word.length)) out.push({ word, index: at });
  }
  return out.sort((x, y) => x.index - y.index);
}

// ── Fixed terms and names kept in English (ZH_TERMS) ─────────────────────────────────────────────

/** A name the English holds: a run of two or more capitalised words. */
export interface NameRun {
  /** The run as the English wrote it. */
  text: string;
  start: number;
  end: number;
}

const WORD_TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’\-\u2010\u2011][\p{L}\p{N}\p{M}]+)*/gu;
/** Words that join the capitalised words of a name (§4.11). "and" is not one: it ends a run, so two names are not swallowed. */
const JOINERS: ReadonlySet<string> = new Set(["of", "the", "for", "de", "von"]);
/** Articles that a sentence starts with, capitalised only for that: they do not start a run. */
const ARTICLES: ReadonlySet<string> = new Set(["The", "A", "An"]);
const ONLY_SPACES_RE = /^[ \u00A0\u2009\u202F]+$/;
const isCapitalised = (word: string): boolean => /^\p{Lu}/u.test(word);

/**
 * The names an English text holds (§4.11 ZH_TERMS): each run of two or more capitalised words (Protein Data Bank, Journal of the
 * AMS). A run starts at its first capitalised word that is not a sentence-initial article (The, A, An) and goes on through single
 * spaces to the next capitalised word, over of, the, for, de and von; "and", any other word, a number and any mark end it, so
 * "Stanford University and the Protein Data Bank" holds two names. In order of position.
 */
export function nameRuns(english: string): NameRun[] {
  const tokens = [...english.matchAll(WORD_TOKEN_RE)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
  const joined = (a: number, b: number): boolean => ONLY_SPACES_RE.test(english.slice(tokens[a]!.end, tokens[b]!.start));
  const runs: NameRun[] = [];
  let i = 0;
  while (i < tokens.length) {
    const first = tokens[i]!;
    if (!isCapitalised(first.word) || (ARTICLES.has(first.word) && startsSentence(english, first.start))) {
      i += 1;
      continue;
    }
    let last = i;
    let words = 1;
    for (;;) {
      let k = last + 1;
      while (k < tokens.length && JOINERS.has(tokens[k]!.word) && joined(k - 1, k)) k += 1;
      if (k >= tokens.length || !isCapitalised(tokens[k]!.word) || !joined(k - 1, k)) break;
      last = k;
      words += 1;
    }
    if (words >= 2) runs.push({ text: english.slice(first.start, tokens[last]!.end), start: first.start, end: tokens[last]!.end });
    i = last + 1;
  }
  return runs;
}

/** An entry in capitals only (AI, DNA) matches only in capitals; any other entry in any case. */
const inCapitals = (entry: string): boolean => entry === entry.toUpperCase() && entry !== entry.toLowerCase();
const spanRes = new Map<string, RegExp>();

/** Each place an `fixed` entry's English (or an `except` phrase) stands in a text, as whole words: any case (capitals only for an entry in capitals), a hyphen read as a space, a regular plural of the last word. */
function spansOf(entry: string, text: string): { start: number; end: number }[] {
  const caps = inCapitals(entry);
  const key = `${caps ? "C" : "I"}${entry}`;
  let re = spanRes.get(key);
  if (!re) {
    re = new RegExp(wordRe(entry, { plurals: true }).source, caps ? "gu" : "giu");
    spanRes.set(key, re);
  }
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** An occurrence of a fixed entry's English. */
export interface FixedOccurrence {
  start: number;
  end: number;
  /** The words as the English wrote them. */
  text: string;
}

/**
 * Where a `fixed` entry's `en` stands in an English text outside its `except` phrases (§4.11): whole words, in any case (an `en`
 * in capitals, such as AI, only in capitals), a hyphen counting as a space, with a regular plural of the last word; an `except`
 * phrase matches the same way. It ignores the entry's `fields` and any name kept in English.
 */
export function fixedOccurrences(entry: FixedTerm, english: string): FixedOccurrence[] {
  const excluded = entry.except.flatMap((phrase) => spansOf(phrase, english));
  return spansOf(entry.en, english)
    .filter((o) => !excluded.some((x) => o.start < x.end && x.start < o.end))
    .map((o) => ({ ...o, text: english.slice(o.start, o.end) }));
}

const inFields = (entry: FixedTerm, field: FieldId | null): boolean => entry.fields.length === 0 || (field !== null && entry.fields.includes(field));

/**
 * Whether a `fixed` entry applies to an English string by its `fields` and its `except` phrases (§4.11): `field` is the field of the
 * finding the string belongs to (`null` for the Lead, an idea, the big picture, the strongest evidence against, a correction on no
 * finding and a glossary term, to which only entries whose `fields` is [] apply). Names kept in English are not considered, since
 * the Chinese does not exist yet: this is the test behind `ZhContext.fixed`.
 */
export function fixedApplies(entry: FixedTerm, english: string, field: FieldId | null): boolean {
  return inFields(entry, field) && fixedOccurrences(entry, english).length > 0;
}

/** The entries of `entries` that apply to an English string (`fixedApplies()`), in list order. */
export function fixedEntriesFor(entries: readonly FixedTerm[], english: string, field: FieldId | null): FixedTerm[] {
  return entries.filter((entry) => fixedApplies(entry, english, field));
}

/**
 * ZH_TERMS (§4.12): the `fixed` entries that apply to the English and that the Chinese does not hold. An entry applies where its `en`
 * stands (`fixedOccurrences()`) in a finding of one of its `fields` and not inside a name the Chinese keeps in English: an occurrence
 * in a run of two or more capitalised words (`nameRuns()`) that the Chinese holds as written. It is met when the Chinese holds the
 * entry's `zh`. Pass a term's name and definition as one array, and its Chinese the same way (judged together): each English string
 * is read on its own, so a name and a definition never make a phrase between them. In list order.
 */
export function fixedMissing(entries: readonly FixedTerm[], english: Strings, chinese: Strings, field: FieldId | null): FixedTerm[] {
  const strings = typeof english === "string" ? [english] : english;
  const zh = joinText(chinese);
  const runs = strings.map((s) => nameRuns(s));
  return entries.filter((entry) => {
    if (!inFields(entry, field) || zh.includes(entry.zh)) return false;
    return strings.some((s, i) => fixedOccurrences(entry, s).some((o) => !runs[i]!.some((r) => r.start <= o.start && o.end <= r.end && zh.includes(r.text))));
  });
}

// ── The English term once (ZH_ENGLISH_ONCE) ──────────────────────────────────────────────────────

/** A glossary term of a finding: its English name and the Chinese the explainer must use. */
export interface OnceTerm {
  en: string;
  zh: string;
}

/** A problem `englishOnceProblems()` found; `term` is one of the input's terms, `part` an index into its `parts`. */
export type OnceProblem =
  | { kind: "unused"; term: OnceTerm }
  | { kind: "first_unbracketed"; term: OnceTerm; part: number }
  | { kind: "later_bracketed"; term: OnceTerm; part: number }
  | { kind: "title_bracketed"; term: OnceTerm };

/** What ZH_ENGLISH_ONCE reads of one finding. */
export interface OnceInput {
  /** The Chinese explainer's parts, in part order (found, matters, ai_helped, how_sure, background, could_lead). */
  parts: readonly string[];
  /** The Chinese title. */
  title: string;
  /** The finding's terms. */
  terms: readonly OnceTerm[];
  /** A part was removed (§4.10 "Removed text"): a term need not appear, and the first remaining use need not carry the English. */
  partRemoved?: boolean;
}

const bracketBody = (en: string): string => en.trim().split(/\s+/).map(escapeRegExp).join("\\s+");

/** The test for the English term in brackets at a position: full-width brackets only, or either width with `anyWidth`; case and inner spaces do not matter. Sticky, so it reads only where `lastIndex` stands. */
function bracketMatcher(en: string, anyWidth: boolean): RegExp {
  const open = anyWidth ? "[\\uFF08(]" : "\\uFF08";
  const close = anyWidth ? "[\\uFF09)]" : "\\uFF09";
  return new RegExp(`${open}\\s*${bracketBody(en)}\\s*${close}`, "iuy");
}

/** The length of the English term in brackets that `matcher` finds starting at `at`, or 0. */
function bracketLength(text: string, at: number, matcher: RegExp): number {
  matcher.lastIndex = at;
  return matcher.exec(text)?.[0].length ?? 0;
}

/**
 * ZH_ENGLISH_ONCE (§4.12) for one finding whose explainer has Chinese: each of its terms appears in the Chinese explainer; the first
 * use there, in part order, is followed at once by the English term in full-width brackets (none is needed when the term's Chinese
 * is its English, such as CRISPR) and no later use is (in either bracket width); the title never carries a term's bracketed English.
 * A use is the term's `zh` in the text, longest term first, so 蛋白質 inside 蛋白質摺疊 counts only for 蛋白質摺疊.
 * Terms with the same `zh` (config pairs such as dataset and data set) cannot each have their own bracket at one first use, so they
 * are one group: the group is met when its first use is followed by the English of any one of its terms, is unmet (reported once,
 * for its first term in `terms`) when the first use has no such bracket, or when none of its use is there, and is refused a later
 * use that carries the English of any of them (reported for the term whose English it is). The title is judged for each term,
 * since each bracketed English in it is a separate thing to remove. A term whose `zh` is empty has no use and is its own group.
 * The problems come term by term in the order of `terms` (a group where its first term stands), then by use.
 */
export function englishOnceProblems(input: OnceInput): OnceProblem[] {
  const text = input.parts.join("\n");
  const starts = input.parts.map((_, i) => input.parts.slice(0, i).reduce((n, p) => n + p.length + 1, 0));
  const partAt = (at: number): number => starts.filter((s) => s <= at).length - 1;
  const groups = new Map<string, OnceTerm[]>();
  for (const term of input.terms) if (term.zh !== "") groups.set(term.zh, [...(groups.get(term.zh) ?? []), term]);
  const taken = new Array<boolean>(text.length).fill(false);
  const uses = new Map<string, number[]>();
  // A stable sort: of two Chinese renderings of the same length, the one met first in `terms` takes the uses.
  for (const zh of [...groups.keys()].sort((a, b) => b.length - a.length)) {
    const found: number[] = [];
    for (let at = text.indexOf(zh); at !== -1; at = text.indexOf(zh, at + 1)) {
      if (taken.slice(at, at + zh.length).some(Boolean)) continue;
      found.push(at);
      taken.fill(true, at, at + zh.length);
    }
    uses.set(zh, found);
  }
  const out: OnceProblem[] = [];
  const judged = new Set<string>();
  for (const term of input.terms) {
    const firstOfGroup = term.zh === "" || !judged.has(term.zh);
    judged.add(term.zh);
    if (firstOfGroup) {
      const found = uses.get(term.zh) ?? [];
      if (found.length === 0) {
        if (!input.partRemoved) out.push({ kind: "unused", term });
      } else {
        const group = groups.get(term.zh)!;
        const chineseIsEnglish = group.some((t) => t.zh.trim().toLowerCase() === t.en.trim().toLowerCase());
        const [first, ...later] = found as [number, ...number[]];
        if (!chineseIsEnglish && !input.partRemoved && !group.some((t) => bracketLength(text, first + term.zh.length, bracketMatcher(t.en, false)) > 0)) {
          out.push({ kind: "first_unbracketed", term, part: partAt(first) });
        }
        // Each member's matcher is made once, and a use is read only where an opening bracket follows it, so a long text with many
        // uses costs its length times the group's size at worst.
        const repeats = later.length === 0 ? [] : group.map((t) => ({ t, matcher: bracketMatcher(t.en, true) }));
        for (const at of later) {
          const next = text[at + term.zh.length];
          if (next !== "\uFF08" && next !== "(") continue;
          const repeated = repeats.find((r) => bracketLength(text, at + term.zh.length, r.matcher) > 0);
          if (repeated !== undefined) out.push({ kind: "later_bracketed", term: repeated.t, part: partAt(at) });
        }
      }
    }
    const bracketed = new RegExp(`[\\uFF08(]\\s*${bracketBody(term.en)}\\s*[\\uFF09)]`, "iu");
    if (bracketed.test(input.title)) out.push({ kind: "title_bracketed", term });
  }
  return out;
}
