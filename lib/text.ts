// Text helpers (SPEC §4.1 Words and Sentences, §4.4 mentionsAnthropic(), §4.12): countWords() for the word
// budgets, wordSet() and jaccard() for DUPLICATE, splitSentences() (the one sentence splitter, for SENTENCE_LENGTH,
// DUAL_USE, READING_LEVEL and the chat edition), numbersIn() and numberMatches() for NUMBER_SOURCED, foldQuote()
// and quoteInText() for QUOTE_VERBATIM, wordRe(), wordsIn() and maskPhrases() for HYPE_WORDS, TERM_DEFINED and
// DUAL_USE, and mentionsAnthropicText() for the disclosure. All pure: no clock, file or network.
//
// Cyber's lib/text.ts at the fork commit 3ced1fb, adapted:
// - countWords(), wordSet() and jaccard() are Cyber's, unchanged in behaviour.
// - splitSentences() is rewritten to SPEC §4.1 (a quoted span is never split, initials, list markers and the
//   Chinese stops are decided; the rules are above it).
// - numbersIn() and numberMatches() keep Cyber's reading of dates, versions, years, percentages and multipliers.
//   Cyber's CVE and advisory ids, ratio readers (gluedRatios(), wordRatios()), label figures and dayBeforeDateName()
//   belong to its own rules and are dropped. New: `word` on each token (a number written as a word, for
//   NUMBER_SOURCED's "words up to ten" exemption), "hundred" and "trillion" as multipliers, and "one", "a" or "an"
//   before one of them read as 1; an ordinal such as "twenty-first" is not read. A multiplier "m" glued to digits is
//   dropped: in the sciences 10m is metres and 5M is a molar concentration, so a glued m is, as any digit run glued
//   to letters, not a number.
// - foldQuote() and quoteInText() are Cyber's lib/rules/snapshots.ts, which also fold invisible format characters
//   (soft hyphens, zero-width spaces) and the dashes, since publishers' pages carry both.
// - wordRe() and wordsIn() are Cyber's lib/rules/words.ts bannedWordRe() and bannedWordsIn(), with an option for
//   plurals; maskPhrases() and mentionsAnthropicText() are new (Cyber's ANTHROPIC_RE of lib/rules/ai.ts without
//   Mythos and Glasswing, and the two mask lists of SPEC §4.4). Where the spec leaves a choice, the disclosure errs
//   towards printing: a person of CLAUDE_PEOPLE is removed only as whole words, and an underscore separates words.
// Dashes in a pattern are built from character codes, so that no source line holds a dash of the kinds
// NO_EM_DASH reads.

import { ABBREVIATIONS, ANTHROPIC_PHRASES, CLAUDE_PEOPLE } from "./vocab";

// ── Words (SPEC §4.1) ────────────────────────────────────────────────────────────────────────────

// Word counting, Cyber's unchanged. URLs are removed, the rest is split on whitespace, and a token counts when it
// contains at least one letter or digit, so markdown symbols and stray dashes never count. Hyphenated words and
// numbers such as "1,800" each count as one word. A Chinese run without spaces counts as one word here; the Chinese
// budgets use countZhChars() (lib/zh.ts).

const URL_RE = /\bhttps?:\/\/\S+/gi;
const WORDISH_RE = /[\p{L}\p{N}]/u;

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  let n = 0;
  for (const token of text.replace(URL_RE, " ").split(/\s+/)) {
    if (WORDISH_RE.test(token)) n += 1;
  }
  return n;
}

/** `text` with each URL replaced by as many spaces, so every other character keeps its position. */
export function blankUrls(text: string): string {
  return text.replace(URL_RE, (url) => " ".repeat(url.length));
}

// ── Similarity (SPEC §4.12 DUPLICATE) ────────────────────────────────────────────────────────────

const HAN_KANA = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}" + String.fromCharCode(0x30fc);
const RUN_RE = new RegExp(`[${HAN_KANA}]+|[^${HAN_KANA}]+`, "gu");
const HAN_KANA_START = new RegExp(`^[${HAN_KANA}]`, "u");

/**
 * The lower-cased word set jaccard() compares: NFKC, punctuation to spaces, split on whitespace. A Han or Kana run
 * (no spaces in Chinese or Japanese) becomes its character bigrams, or the character itself when the run is one
 * character long, so two titles one character apart still share most of the set.
 */
export function wordSet(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  for (const token of cleaned.split(/\s+/)) {
    if (!token) continue;
    for (const run of token.match(RUN_RE) ?? []) {
      if (!HAN_KANA_START.test(run)) {
        out.add(run);
        continue;
      }
      const chars = Array.from(run);
      if (chars.length === 1) out.add(run);
      for (let i = 0; i + 1 < chars.length; i += 1) out.add(chars[i]! + chars[i + 1]!);
    }
  }
  return out;
}

/** Jaccard similarity of two titles' word sets (`wordSet()`), 0 to 1. Two empty titles score 1. */
export function jaccard(a: string, b: string): number {
  const A = wordSet(a);
  const B = wordSet(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// ── Sentences (SPEC §4.1) ────────────────────────────────────────────────────────────────────────
//
// splitSentences() splits after `.`, `?` or `!` that is followed by whitespace and then a capital letter, a digit or a
// quote mark, and after a Chinese 。 ？ or ！ (which needs no whitespace). It never splits inside a number, after an
// ABBREVIATIONS entry or inside a quoted span. The edge cases the spec leaves open are decided here, each pinned by a
// test in tests/text.test.ts:
//
// - A stop is closed by the quotes and brackets right after it, and the split comes after them: `He said "Go." Then
//   he left.` splits after `Go."`. A stop inside a quoted span (a pair of "…", “…”, 「…」, 『…』 or «…») whose closing
//   mark does not follow it directly never splits, so a long quotation is one long sentence (STYLE.md §8). A quote
//   mark that never closes opens no span. Single quotes are never spans: they are also apostrophes.
// - What starts the next sentence may be preceded by an opening bracket: `It held. (The team checked.)` splits.
// - A dot inside a number or a name of a site ("2.5", "doi.org/10.1038/x") is never followed by whitespace, so it
//   is never a stop; a final dot after a URL or a DOI is. "2.5. Then" splits after the second dot.
// - "..." (three or more dots) is a stop run, so `Wait... Then he left.` splits; the single character U+2026 is not
//   `.`, `?` or `!`, so it never splits.
// - An ABBREVIATIONS entry is matched as written, plus its capitalised form for an entry that begins in lower case
//   ("Cf." at the start of a sentence), after a character that is not a letter, digit or dot. A sentence that really
//   ends with "U.S." or "et al." therefore runs on into the next one, as the spec's "never" asks.
// - An initial is not a stop when it is in a chain of initials: "J. R. R. Tolkien" is one sentence start, but a
//   lone capital before a name ("J. Robert Oppenheimer", "Plan B. The team") splits.
// - A list marker is not a stop: a one or two digit number and a dot that opens the text, a line or a sentence
//   ("1. Mix the reagents. 2. Heat it.") belongs to its item. A number and a dot anywhere else is a sentence end.
// - A sentence that starts in lower case or with a symbol ("mRNA levels rose") does not start a sentence, as the spec
//   says; the text before it runs on.

/** A run of English stops, or of Chinese ones. */
const STOP_RE = /[.!?]+|[。？！]+/gu;
/** What may stand between a stop and the split: closing quotes and brackets. */
const CLOSERS = "\"'”’)]}»」』）】";
const BRACKET_OPENERS = "([{（【";
const QUOTE_OPENERS = "\"'“‘„«‹「『";
/** The closing mark of each paired opening mark; the straight double quote closes itself. */
const CLOSING_MARK: Readonly<Record<string, string>> = { "“": "”", "「": "」", "『": "』", "«": "»" };

const ABBREVIATION_FORMS: readonly string[] = [...new Set(ABBREVIATIONS.flatMap((a) =>
  /^\p{Ll}/u.test(a) ? [a, a.charAt(0).toUpperCase() + a.slice(1)] : [a]))];

/** The [open, close] index of each pair of quotation marks in the text; a mark without its partner opens no span. */
function quotedSpans(text: string): [open: number, close: number][] {
  const spans: [number, number][] = [];
  const open: { mark: string; at: number }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const mark = text.charAt(i);
    const top = open[open.length - 1];
    if (mark === '"') {
      if (top?.mark === '"') {
        spans.push([top.at, i]);
        open.pop();
      } else open.push({ mark, at: i });
    } else if (CLOSING_MARK[mark] !== undefined) open.push({ mark, at: i });
    else if (top && CLOSING_MARK[top.mark] === mark) {
      spans.push([top.at, i]);
      open.pop();
    }
  }
  return spans;
}

/** Whitespace, then (after opening brackets) a capital letter, a digit or a quote mark begins at `end`. */
function startsNextSentence(text: string, end: number): boolean {
  if (end >= text.length || !/\s/u.test(text.charAt(end))) return false;
  let j = end;
  while (j < text.length && /\s/u.test(text.charAt(j))) j += 1;
  while (j < text.length && BRACKET_OPENERS.includes(text.charAt(j))) j += 1;
  if (j >= text.length) return false;
  const next = String.fromCodePoint(text.codePointAt(j)!);
  return QUOTE_OPENERS.includes(next) || /^[\p{Lu}\p{Nd}]$/u.test(next);
}

function endsWithAbbreviation(through: string): boolean {
  return ABBREVIATION_FORMS.some((form) => {
    if (!through.endsWith(form)) return false;
    return !/[\p{L}\p{N}.]/u.test(through.charAt(through.length - form.length - 1));
  });
}

/** The one or two digits right before the stop open the text, a line or the sentence: "1. Item". */
function isListMarker(text: string, sentenceStart: number, stop: number): boolean {
  const digits = /(?<![\p{L}\p{N}.])\d{1,2}$/u.exec(text.slice(0, stop));
  if (!digits) return false;
  const lineStart = text.lastIndexOf("\n", digits.index - 1) + 1;
  return text.slice(Math.max(sentenceStart, lineStart), digits.index).trim() === "";
}

/** The capital right before the stop is a lone initial next to another one: "J. R. R." */
function isInitialInChain(text: string, stop: number): boolean {
  if (!/(?<![\p{L}\p{N}.])\p{Lu}$/u.test(text.slice(0, stop))) return false;
  return /(?<![\p{L}\p{N}.])\p{Lu}\.\s+$/u.test(text.slice(0, stop - 1)) || /^\s+\p{Lu}\.(?=\s|$)/u.test(text.slice(stop + 1));
}

/**
 * The sentences of `text` (SPEC §4.1), trimmed, in order, none empty. Prose without a stop is one sentence and
 * an empty or blank text has none. The rules and the decided edge cases are in the comment above.
 */
export function splitSentences(text: string): string[] {
  const spans = quotedSpans(text);
  const out: string[] = [];
  const push = (from: number, to: number): void => {
    const sentence = text.slice(from, to).trim();
    if (sentence) out.push(sentence);
  };
  let start = 0;
  for (const m of text.matchAll(STOP_RE)) {
    const stop = m.index;
    const chinese = !/^[.!?]/u.test(m[0]);
    let end = stop + m[0].length;
    while (end < text.length && CLOSERS.includes(text.charAt(end))) end += 1;
    if (!chinese && !startsNextSentence(text, end)) continue;
    if (spans.some(([open, close]) => open < stop && end <= close)) continue;
    if (m[0] === "." && (endsWithAbbreviation(text.slice(0, stop + 1)) || isListMarker(text, start, stop) || isInitialInChain(text, stop))) continue;
    push(start, end);
    start = end;
  }
  push(start, text.length);
  return out;
}

// ── Numbers (SPEC §4.12 NUMBER_SOURCED) ──────────────────────────────────────────────────────────

/** One number read from text by `numbersIn()`. */
export interface NumberToken {
  /** The digits as written, with any unit word: "1,393", "37%", "4.5 million". For a number written as words, its digits. */
  raw: string;
  /** The value with its multiplier applied; a magnitude (a leading minus sign is not read). */
  value: number;
  /** Digits after the decimal point as written. */
  decimals: number;
  /** The place value of the last digit written, times the multiplier: "1,400" 1, "4.5 million" 100,000. */
  step: number;
  /** The place value of the last non-zero digit written, times the multiplier: "1,400" 100. */
  approx_step: number;
  /** Written with %, "per cent" or "percent". */
  percent: boolean;
  /** Written after "about", "around", "nearly", "almost", "roughly", "more than", "over" or "~". */
  approx: boolean;
  /** Written as a word ("twelve", "twenty-one", "one million"); only with `numbersIn(text, { words: true })`. */
  word: boolean;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const MONTH_FORMS = [...new Set(MONTH_NAMES.flatMap((m) => {
  const forms = [m, m.slice(0, 3)];
  if (m === "September") forms.push("Sept");
  return forms.flatMap((f) => [f, f.toUpperCase()]);
}))].sort((a, b) => b.length - a.length);
const MONTH = `(?:${MONTH_FORMS.join("|")})`;
const ORDINAL = "(?:st|nd|rd|th)?";
const YEAR = "(?:199\\d|20\\d\\d)";

/** The hyphen, U+2010 and U+2011 (NFKC makes U+2011 a U+2010) and the en dash, as the inside of a character class. */
const DASHES = "\\-" + String.fromCharCode(0x2010, 0x2011, 0x2013);

const WEEKDAY_FORMS = [...new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].flatMap((d) => {
  const forms = [d, d.slice(0, 3)];
  if (d === "Tuesday") forms.push("Tues");
  if (d === "Wednesday") forms.push("Weds");
  if (d === "Thursday") forms.push("Thur", "Thurs");
  return forms.flatMap((f) => [f, f.toUpperCase()]);
}))].sort((a, b) => b.length - a.length);
/** A weekday name, full or short ("Tuesday", "Tue", "Tues"). */
const WEEKDAY = `(?:${WEEKDAY_FORMS.join("|")})`;
/** What may stand before a day of a range: a weekday ("Tuesday 11", "Tue., 11") and "the" ("the 14th"). */
const BEFORE_DAY = `(?:${WEEKDAY}\\.?,?\\s+)?(?:the\\s+)?`;
/** Between a range's two days: " to ", " and ", " or ", " through " or " thru ", "/", or a hyphen or en dash. */
const DAY_JOIN = `(?:\\s+(?:to|and|or|through|thru)\\s+|\\s?[${DASHES}/]\\s?)`;

/**
 * A day range in one month, read as one date: the first day, then " to ", " and ", " or ", " through ", "/", a
 * hyphen or an en dash, then the second day; or "between" the first "and" the second. A weekday or "the" may
 * stand before each day, and ordinals are allowed.
 */
const DAY_RANGE = (d1: string, d2: string): string =>
  `(?:[Bb]etween\\s+${BEFORE_DAY}${d1}${ORDINAL}\\s+and\\s+|${BEFORE_DAY}${d1}${ORDINAL}${DAY_JOIN})${BEFORE_DAY}${d2}${ORDINAL}`;
/** "13 to 14 Oct", "13-14 Oct", "between 13 and 14 Oct", "on 11 and 12 Nov", "11/12 Nov", "from Tuesday 11 to Wednesday 12 Nov". */
const DAY_RANGE_MONTH_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.,])${DAY_RANGE("(\\d{1,2})", "(\\d{1,2})")}\\s+(?:of\\s+)?${MONTH}\\.?(?![\\p{L}])`, "gu");
/**
 * "Oct 13 to 14", "Oct 13-14", "Nov 11 and 12.", "Nov 11/12, Taipei", "between Oct 13 and 14". The second day
 * is not a percentage, a decimal or a count in hundreds, thousands, millions or billions. " to " and an
 * unspaced dash always join the days; "and", "or", "through", "thru", "/" and a dash with spaces around it
 * join them only after "between" or at the end of a clause (CLAUSE_END_RE), so "Oct 3 and 12 days later" and
 * "Oct 2 - 12 critical flaws" keep their 12.
 */
const MONTH_DAY_RANGE_RE = new RegExp(
  `(?<![\\p{L}])([Bb]etween\\s+)?${MONTH}\\.?\\s+(?:the\\s+)?(\\d{1,2})${ORDINAL}` +
  `(?:\\s+to\\s+${BEFORE_DAY}|[${DASHES}]|(\\s+(?:and|or|through|thru)\\s+${BEFORE_DAY}|\\/|\\s[${DASHES}]\\s))(\\d{1,2})${ORDINAL}` +
  "(?![\\p{L}\\p{N}])(?![.,]\\d)(?!\\s?(?:%|per\\s?cent|percent))(?!\\s+(?:hundred|thousand|million|billion|trillion)(?![\\p{L}]))" +
  "(?!\\s?(?:bn|BN|Bn)(?![\\p{L}\\p{N}]))", "gu");
/** After a month-first range joined by a word, "/" or a spaced dash: the end of the text or of a clause, a year, or "Taipei" or "UTC". */
const CLAUSE_END_RE = /^(?:\s*$|[.,;:!?)\]]|\s+(?:199\d|20\d\d)(?!\d)|\s+(?:Taipei|UTC)(?![\p{L}]))/u;

/** A day range's days are 1 to 31, the first before the second; anything else is left for the other patterns. */
const isDayRange = (a: string, b: string): boolean => {
  const [x, y] = [Number(a), Number(b)];
  return x >= 1 && x < y && y <= 31;
};

/** What numbersIn() removes before reading digits, in order: a pattern, or a function that removes what it reads. */
const NOT_NUMBERS: readonly (RegExp | ((s: string) => string))[] = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d])/giu, // ISO dates and timestamps
  /(?<![\p{L}\p{N}])[vV]\d+(?:\.\d+)*(?![\p{L}\p{N}])/gu, // v-prefixed versions
  /(?<![\p{L}\p{N}.])\d+(?:\.\d+){2,}[\p{L}\p{N}+-]*/gu, // versions with two or more dots (and dotted quads)
  /(?<![\p{L}\p{N}])\d{1,2}:\d{2}(?::\d{2})?(?:\s?[aApP]\.?[mM]\.?)?(?![\p{L}\p{N}])/gu, // clock times
  /(?<![\p{L}\p{N}])\d{1,2}\s?[aApP]\.?[mM]\.?(?![\p{L}\p{N}])/gu, // "5 pm"
  // Day ranges before the single dates, so neither day of "13 to 14 Oct" or "Oct 13 to 14" is read.
  (s) => s.replace(DAY_RANGE_MONTH_RE, (m, a1?: string, a2?: string, b?: string) => (isDayRange(a1 ?? a2!, b!) ? " " : m)),
  (s) => s.replace(MONTH_DAY_RANGE_RE, (m, between: string | undefined, a: string, guarded: string | undefined, b: string, at: number,
    all: string) => (isDayRange(a, b) && (!guarded || between || CLAUSE_END_RE.test(all.slice(at + m.length))) ? " " : m)),
  new RegExp(`(?<![\\p{L}\\p{N}])\\d{1,2}${ORDINAL}\\s+(?:of\\s+)?${MONTH}\\.?(?![\\p{L}])`, "gu"), // "21 Oct", "21st October"
  new RegExp(`(?<![\\p{L}])${MONTH}\\.?\\s+\\d{1,2}${ORDINAL}(?![\\p{L}\\p{N}])`, "gu"), // "Oct 21", "October 21st"
  new RegExp(`(?<![\\p{L}\\p{N}.,])${YEAR}\\s?[${DASHES}]\\s?(?:${YEAR}|\\d{2})(?!\\d|[.,]\\d)`, "gu"), // "2023-24", "2023-2024"
  new RegExp(`(?<![\\p{L}\\p{N}.,])${YEAR}(?!\\d|[.,]\\d)`, "gu"), // years 1990 to 2099, "2020s" included
  /§\s*\d+(?:\.\d+)*/gu, // section marks
];

const WORD_VALUES: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const TENS_WORDS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const UNIT_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const MULTIPLIER_WORDS = "hundred|thousand|million|billion|trillion";
const COMPOUND_RE = new RegExp(`\\b(${TENS_WORDS.join("|")})[${DASHES}\\s](${UNIT_WORDS.join("|")})\\b`, "giu");
// A tens word, a hyphen and an ordinal ("twenty-first century") is an ordinal, not a quantity. "twenty-second" is left
// out of the list: it is as often a duration ("a twenty-second clip"), which is read as 20.
const ORDINAL_COMPOUND_RE = new RegExp(`\\b(?:${TENS_WORDS.join("|")})[${DASHES}](?:first|third|fourth|fifth|sixth|seventh|eighth|ninth)\\b`, "giu");
// "one" is read only before a multiplier ("one million"); on its own it is the pronoun as often as the number.
const ONE_BEFORE_MULTIPLIER_RE = new RegExp(`\\b(?:one|an?)(?=\\s+(?:${MULTIPLIER_WORDS})\\b)`, "giu");
const WORD_NUMBER_RE = new RegExp(`\\b(${Object.keys(WORD_VALUES).filter((w) => w !== "one").join("|")})\\b`, "giu");
/** Put right before the digits of a number that was written as a word; a private-use character that no text holds. */
const WORD_MARK = String.fromCharCode(0xe000);

const NUMBER_RE = new RegExp(
  "(?<![\\p{L}\\p{N}_])(?<!\\p{L}-)(?<!\\p{N}[.,])" + // not glued to a word, not inside "COVID-19" or "1,2"
  "(\\d{1,3}(?:,\\d{3})+(?!\\d)|\\d+)(?:\\.(\\d+))?(?![.,]\\d)" + // digits, thousands separators, decimals
  `(?:(\\s?(?:%|per\\s?cent\\b|percent\\b))|(\\s(?:${MULTIPLIER_WORDS})\\b)|(\\s?(?:bn|BN|Bn))(?![\\p{L}\\p{N}]))?` +
  "(?![\\p{L}\\p{N}])",
  "gu",
);
const APPROX_RE = /(?:\b(?:about|around|nearly|almost|roughly|more\s+than|over)|~)\s*(?:[A-Z]{0,3}[$€£¥])?\s*$/iu;
const MULTIPLIERS: Readonly<Record<string, number>> = { hundred: 1e2, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, bn: 1e9 };

/**
 * The numbers in a piece of text (§4.12). First removes what is not a quantity: ISO dates and timestamps,
 * clock times, day-month dates ("21 Oct", "October 21") and day ranges in one month ("13 to 14 Oct", "13-14 Oct",
 * "between 13 and 14 Oct", "on 11 and 12 Nov", "11 or 12 Nov", "11/12 Nov", "11 through 12 Nov", "from Tuesday 11 to
 * Wednesday 12 Nov", "Oct 13 to 14", "Oct 13-14", "Nov 11 and 12."; days 1 to 31, the first before the second; a
 * range across months is two dates, "30 Oct to 2 Nov"; a month-first range joined by "and", "or", "through", "/" or
 * a spaced dash only after "between" or at the end of a clause), years 1990 to 2099 and year ranges ("2023-24"),
 * version strings (two or more dots, or a leading v) and section marks. Years before 1990 are numbers. Then reads
 * each digit token (thousands separators dropped) with its unit: %, "per cent" or "percent" make a percentage; a
 * following "hundred", "thousand", "million", "billion", "trillion" or "bn" multiplies. A digit run glued to
 * letters ("2FA", "x86", "5G", "3rd", "COVID-19", "10m") is not a number.
 * With `words: true` two to twenty and the tens, compounds such as "twenty-one", and "one", "a" or "an" before a
 * multiplier ("one million", "a thousand") are read as numbers too, each with `word` true and its digits in `raw`
 * ("twelve million" gives raw "12 million"; an ordinal such as "twenty-first" is no number). A source's seen text
 * is read this way so that "twelve" finds our "12", and our own prose is read this way so that the rule can exempt
 * the words up to ten (`word` and `value` at most 10) and check the others.
 */
export function numbersIn(text: string, opts: { words?: boolean } = {}): NumberToken[] {
  let s = text.normalize("NFKC").replaceAll(WORD_MARK, " ");
  for (const re of NOT_NUMBERS) s = typeof re === "function" ? re(s) : s.replace(re, " ");
  if (opts.words) {
    s = s.replace(ORDINAL_COMPOUND_RE, " ");
    s = s.replace(COMPOUND_RE, (_m, tens: string, unit: string) => `${WORD_MARK}${WORD_VALUES[tens.toLowerCase()]! + WORD_VALUES[unit.toLowerCase()]!}`);
    s = s.replace(ONE_BEFORE_MULTIPLIER_RE, () => `${WORD_MARK}1`);
    s = s.replace(WORD_NUMBER_RE, (w) => `${WORD_MARK}${WORD_VALUES[w.toLowerCase()]!}`);
  }
  const out: NumberToken[] = [];
  for (const m of s.matchAll(NUMBER_RE)) {
    const [raw, intPart, frac = "", pct, multiple, bn] = m as unknown as [string, string, string | undefined, string?, string?, string?];
    const at = m.index!;
    const multiplierKey = multiple?.trim().toLowerCase() ?? (bn ? "bn" : null);
    const multiplier = multiplierKey ? MULTIPLIERS[multiplierKey]! : 1;
    const digits = intPart.replace(/,/g, "");
    const decimals = frac.length;
    const value = Number(`${digits}${decimals ? `.${frac}` : ""}`) * multiplier;
    const step = 10 ** -decimals * multiplier;
    const all = digits + frac;
    const trailingZeros = all.length - all.replace(/0+$/, "").length;
    const approxStep = all.replace(/0/g, "") === "" ? step : step * 10 ** trailingZeros;
    out.push({
      raw: raw.trim(),
      value: tidy(value),
      decimals,
      step: tidy(step),
      approx_step: tidy(approxStep),
      percent: Boolean(pct),
      approx: APPROX_RE.test(s.slice(Math.max(0, at - 30), at).replaceAll(WORD_MARK, "")),
      word: s.charAt(at - 1) === WORD_MARK,
    });
  }
  return out;
}

/** Removes binary noise from a product of a decimal and a power of ten (0.1 * 1e6 is 100000.00000000001). */
function tidy(x: number): number {
  return Number(x.toPrecision(15));
}

/** `q`, which is not negative, rounded half up, with a tolerance so a binary representation cannot move a half (0.145 / 0.01). */
function roundHalfUp(q: number): number {
  return Math.floor(q + 0.5 + 1e-9 + 1e-12 * q);
}

/**
 * §4.12's matching rule: `value` matches our number when, rounded to our number's decimal places (its `step`), it
 * equals our number; after an approximation word, rounded at our number's last non-zero digit ("about 1,400"
 * matches 1,393). Units are the caller's business (compare `percent` first). Against the metrics, matching is
 * exact equality instead: `ours.value === theirs.value`.
 */
export function numberMatches(ours: NumberToken, value: number): boolean {
  const step = ours.approx ? ours.approx_step : ours.step;
  return roundHalfUp(Math.abs(value) / step) === roundHalfUp(ours.value / step);
}

// ── Quotes (SPEC §4.12 QUOTE_VERBATIM) ───────────────────────────────────────────────────────────

const QUOTE_MARKS = /["'“”„‟‘’‚‛«»‹›「」『』〝〞〟]/gu;
/** The hyphen-like characters (U+2010 to U+2015 and the minus sign) that a page and a draft may write differently. */
const DASH_LIKE = new RegExp(`[${String.fromCharCode(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212)}]`, "gu");

/**
 * The text a quote is compared in (Cyber's normalisation): NFKC, invisible format characters removed (soft
 * hyphens, zero-width spaces), lower case, quotation marks and apostrophes removed, every dash read as a hyphen, white
 * space collapsed and trimmed.
 */
export function foldQuote(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase().replace(QUOTE_MARKS, "").replace(DASH_LIKE, "-")
    .replace(/\s+/gu, " ").trim();
}

/** True when the quote, folded, is a non-empty part of the seen text, folded. */
export function quoteInText(quote: string, seen: string): boolean {
  const folded = foldQuote(quote);
  return folded !== "" && foldQuote(seen).includes(folded);
}

// ── Word lists (SPEC §4.12 HYPE_WORDS, TERM_DEFINED, DUAL_USE) ──────────────────────────────────

/** `text` safe to put in a RegExp source (the `u` flag is on, so "-" is left alone). */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** A hyphen-like separator between the words of an entry: whitespace, a hyphen, U+2010 or U+2011. */
const ENTRY_GAP = `[\\s\\-${String.fromCharCode(0x2010, 0x2011)}]+`;
const wordRes = new Map<string, RegExp>();

/** The pattern of the last word of an entry with an optional plural: "enzyme" and "enzymes", "antibody" and "antibodies". */
function pluralForms(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${escapeRegExp(word.slice(0, -1))}(?:y|ies)`;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${escapeRegExp(word)}(?:es)?`;
  return `${escapeRegExp(word)}s?`;
}

/**
 * The pattern of one entry of a word list (Cyber's bannedWordRe()): the entry as whole words in any case, with any
 * run of whitespace, hyphens, U+2010 or U+2011 between its words and an apostrophe of either kind, so "game-changing"
 * finds "game changing" and "Hubble's law" finds "Hubble’s law". Whole words: no letter or digit on either side.
 * With `plurals`, the entry's last word may also be plural (-s, -es, or -ies after a consonant and y); an irregular
 * plural is listed as its own entry. The regex has no `g` flag, so `.test()` and `.exec()` are safe to repeat.
 */
export function wordRe(entry: string, opts: { plurals?: boolean } = {}): RegExp {
  const key = JSON.stringify([entry, Boolean(opts.plurals)]);
  let re = wordRes.get(key);
  if (!re) {
    const parts = entry.trim().split(new RegExp(ENTRY_GAP, "u"));
    const last = parts.length - 1;
    const body = parts.map((part, i) => (i === last && opts.plurals ? pluralForms(part) : escapeRegExp(part)).replace(/['’]/g, "['’]"))
      .join(ENTRY_GAP);
    re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
    wordRes.set(key, re);
  }
  return re;
}

/** The entries of `entries`, as listed, that `text` holds as whole words (`wordRe()`), in list order. */
export function wordsIn(text: string, entries: readonly string[], opts: { plurals?: boolean } = {}): string[] {
  return entries.filter((entry) => wordRe(entry, opts).test(text));
}

/**
 * `text` with each of the phrases replaced by as many spaces, so positions hold: every occurrence, as listed, case
 * included, the longest phrase first (so "Breakthrough Devices Program" goes before "Breakthrough Device"). It
 * masks the names that hold a banned word before the word lists are read (SPEC §4.12 HYPE_WORDS).
 */
export function maskPhrases(text: string, phrases: readonly string[]): string {
  let out = text;
  for (const phrase of [...phrases].filter((p) => p !== "").sort((a, b) => b.length - a.length)) {
    out = out.replaceAll(phrase, " ".repeat(phrase.length));
  }
  return out;
}

// ── Anthropic (SPEC §4.4) ────────────────────────────────────────────────────────────────────────

/** Lower case, with the combining marks of the decomposed form removed: "Lévi" becomes "levi". */
const foldMarks = (text: string): string => text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const NAME_GAP = "[\\s\\p{Pd}_]+";
const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}])";

/**
 * One entry of CLAUDE_PEOPLE or ANTHROPIC_PHRASES as a pattern over the folded text: its words joined by any run of
 * white space, hyphens or underscores. It starts at a word. A person also ends at one, so "Claude Monetization" is not
 * "Claude Monet" and keeps its "Claude"; a phrase may run on into a plural or other ending ("anthropic principles").
 */
const maskRe = (entry: string, person: boolean): RegExp =>
  new RegExp(NOT_LETTER_BEFORE + foldMarks(entry).split(new RegExp(NAME_GAP, "u")).map(escapeRegExp).join(NAME_GAP) +
    (person ? NOT_LETTER_AFTER : ""), "gu");
const ANTHROPIC_MASKS: readonly RegExp[] = [
  ...CLAUDE_PEOPLE.map((person) => maskRe(person, true)),
  ...ANTHROPIC_PHRASES.map((phrase) => maskRe(phrase, false)),
];
/** The two names as whole words; an underscore, like a hyphen, separates words ("claude_code" names Claude). */
const ANTHROPIC_WORD_RE = new RegExp(`${NOT_LETTER_BEFORE}(?:anthropic|claude)${NOT_LETTER_AFTER}`, "u");

/**
 * Whether the text names Anthropic or Claude (SPEC §4.4): the whole words "anthropic" or "claude" in any case,
 * after the people and phrases of `CLAUDE_PEOPLE` and `ANTHROPIC_PHRASES` are removed, matched in any case with
 * diacritics ignored and hyphens or underscores read as spaces. It reads one string; the finding-level
 * `mentionsAnthropic()` (a finding's strings, its systems' makers and its sources' hosts) is in lib/rules/ai.ts.
 */
export function mentionsAnthropicText(text: string | null | undefined): boolean {
  if (!text) return false;
  let s = foldMarks(text);
  for (const re of ANTHROPIC_MASKS) s = s.replace(re, " ");
  return ANTHROPIC_WORD_RE.test(s);
}
