// The Chinese text checks of lib/zh.ts and the message excerpts of lib/rules/zh.ts as they were before F-70 made them linear in the
// length of a text: the numbers, the sentence start, the month names, the links, the Latin words, the names and the two excerpts.
// They are kept here only as the reference that tests/zh.test.ts and tests/rules-zh.test.ts compare the new functions with, over every
// Chinese fixture text and a generated corpus: the new code must give the same result on every text a reader could write. They are
// quadratic on a hostile text (a long Latin run, many numbers) and one throws on 5 MB: nothing but those tests may call them. The one
// difference the tests pin is deliberate: `urlsIn()` now reads a scheme of at most 32 characters (the safety rules' limit), so an
// address whose scheme is longer is found from its last 32 characters, ending at the same place.
// The code below is lib/zh.ts and lib/rules/zh.ts at the end of the FX2 fix pass, with only `export`, the `old` prefix of each exported
// name and the types imported from the current lib/zh.ts changed.
// New for this project; Cyber has no Chinese pass.

import { monthShort } from "../../lib/format";
import type { AvoidTerm, FixedTerm } from "../../lib/schema/config";
import { escapeRegExp, maskPhrases } from "../../lib/text";
import type { AvoidHit, NameRun, ParityGaps, ParityNumber, ParityProblems, Strings } from "../../lib/zh";
import { englishNumberWordKeys } from "../../lib/zh";

const joinText = (t: Strings): string => (typeof t === "string" ? t : t.join("\n"));

const NUMBER_RE = /(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?/g;
const SPACES = " \\u00A0\\u2009\\u202F";
/** After a number: a thousand, million or billion (a space or a hyphen between), or 萬 or 億 (nothing or a space between). */
const MULTIPLIER_RE = new RegExp(`^(?:[${SPACES}-](thousand|million|billion)(?!\\p{L})|[${SPACES}]?(萬|億))`, "iu");
/** After a number: %, "per cent" or "percent" (a word boundary, so "percentage" is not one). */
const PERCENT_RE = new RegExp(`^(?:[${SPACES}]*%|[${SPACES}-]per[ \\u00A0]?cent(?!\\p{L}))`, "iu");
/** Before a number: 百分之. */
const PERCENT_PREFIX_RE = new RegExp(`百分之[${SPACES}]*$`, "u");
/** The decimal places a multiplier moves the point: thousand 3, million 6, billion 9, 萬 4, 億 8. 千 is not read. */
const SHIFT: Readonly<Record<string, number>> = { thousand: 3, million: 6, billion: 9, "萬": 4, "億": 8 };

/** Full-width digits to ASCII, and ％ to %; a full-width comma or point between two full-width digits to its ASCII form. Every character stays one code unit. */
function foldWidth(text: string): string {
  return text
    .replace(/(?<=[０-９])[，．](?=[０-９])/g, (c) => (c === "，" ? "," : "."))
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    .replaceAll("％", "%");
}

/** `int.frac` times ten to the `shift`, as a plain decimal with no leading zero and no trailing zero after the point. */
function decimalValue(int: string, frac: string, shift: number): string {
  const point = int.length + shift;
  const digits = (int + frac).padEnd(point, "0");
  const whole = digits.slice(0, point).replace(/^0+/, "") || "0";
  const rest = digits.slice(point).replace(/0+$/, "");
  return rest === "" ? whole : `${whole}.${rest}`;
}

/**
 * The numbers of a text, read the same way in either language (§4.12 ZH_PARITY): each run of digits, glued to letters or not
 * (12th, COVID-19), years and dates included, with thousands separators dropped and decimals kept; full-width digits and ％ read
 * as ASCII ones. A thousand, million or billion after it (a space or a hyphen between), or a 萬 or 億 after it, multiplies it
 * (70 萬 is 700000; 千 is not read, as it starts units such as 千瓦); a %, "per cent" or "percent" after it, or a 百分之 before
 * it, makes it a percentage. Chinese numerals (一, 三, 兩, 百) are not read. In order of appearance, repeats included.
 */
export function oldParityNumbers(text: string): ParityNumber[] {
  const s = foldWidth(text);
  const out: ParityNumber[] = [];
  for (const m of s.matchAll(NUMBER_RE)) {
    const [int = "", frac = ""] = m[0].replaceAll(",", "").split(".");
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
    const prefix = PERCENT_PREFIX_RE.exec(s.slice(0, start));
    if (prefix) {
      percent = true;
      start -= prefix[0].length;
      length += prefix[0].length;
    }
    const value = decimalValue(int, frac, shift);
    out.push({ value, percent, key: percent ? `${value}%` : value, text: text.slice(start, start + length), index: start });
  }
  return out;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
  "December"] as const;
/** The full names, then the three-letter forms that monthShort() writes ("Sep" for September), as whole words. */
const MONTH_RE = new RegExp(`(?<!\\p{L})(${[...MONTH_NAMES, ...MONTH_NAMES.map((_, i) => monthShort(i + 1))].join("|")})(?!\\p{L})`, "gu");
const OPENERS = "\"'“‘„«‹「『([{（【";
const OPENING_TAIL_RE = new RegExp(`[\\s${escapeRegExp(OPENERS)}]*$`, "u");
const STOP_THEN_CLOSERS_RE = /[.!?。？！][)\]}"'”’»」』）】]*$/u;

/** Whether the word at `index` is a sentence's first: the text opens with it, or a line break or a stop (. ! ? 。 ？ ！) and then only quotes and brackets come before it. */
function startsSentence(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const skipped = OPENING_TAIL_RE.exec(before)![0];
  const rest = before.slice(0, before.length - skipped.length);
  return rest === "" || skipped.includes("\n") || STOP_THEN_CLOSERS_RE.test(rest);
}

/**
 * The month numbers (1 to 12) of the capitalised English month names in a text, each once, in order of appearance: the full names
 * and the three-letter forms of monthShort() (January to December, Jan to Dec). "May" as a sentence's first word counts only
 * when a number follows it (a day or a year: "May 5", "May 2024"); anywhere else a capitalised "May" is the month.
 */
export function oldEnglishMonthNumbers(text: string): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(MONTH_RE)) {
    const name = m[1]!;
    if (name === "May" && startsSentence(text, m.index) && !/^[ \u00A0]*\d/.test(text.slice(m.index + 3))) continue;
    const full = MONTH_NAMES.findIndex((month) => month === name || month.slice(0, 3) === name);
    seen.add(full + 1);
  }
  return [...seen];
}

const distinct = (numbers: readonly ParityNumber[]): ParityNumber[] => numbers.filter((n, i) => numbers.findIndex((o) => o.key === n.key) === i);

/**
 * ZH_PARITY's numbers (§4.12): every English number appears in the Chinese with the same value (a percentage as a percentage), and
 * every Chinese number is an English number, or the month number of a capitalised English month name, or the value of an English
 * number word from one to ten. Pass a term's name and definition as one array, and its Chinese the same way.
 */
export function oldParityGaps(en: Strings, zh: Strings): ParityGaps {
  const english = joinText(en);
  const inEnglish = oldParityNumbers(english);
  const inChinese = oldParityNumbers(joinText(zh));
  const have = new Set(inChinese.map((n) => n.key));
  const known = new Set([...inEnglish.map((n) => n.key), ...oldEnglishMonthNumbers(english).map(String), ...englishNumberWordKeys(english)]);
  return { missing: distinct(inEnglish.filter((n) => !have.has(n.key))), extra: distinct(inChinese.filter((n) => !known.has(n.key))) };
}

const URL_RES: readonly RegExp[] = [
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g,
  /(?<![\p{L}\p{N}.@])www\.\S+/giu,
  /(?<![\p{L}\p{N}.@-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?![\p{Script=Latin}\p{N}-])(?:[/?#]\S*)?/giu,
];

/**
 * The URLs a text holds (ZH_PARITY: a Chinese string holds none): anything with a scheme and `//`, anything that starts `www.`, and
 * a host written without a scheme (two or more dot-separated labels of letters, digits and hyphens, the last of two or more letters,
 * with any path). Each as written, in order of appearance, none twice; a host inside a longer URL is not a second one.
 */
export function oldUrlsIn(text: string): string[] {
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
const LATIN_WORD_RE = /[\p{Script=Latin}\p{Nd}]+/gu;
const HAS_LATIN_LETTER = /\p{Script=Latin}/u;

const latinWordsOf = (text: string): string[] => (text.match(LATIN_WORD_RE) ?? []).filter((w) => HAS_LATIN_LETTER.test(w));

/** A term's English as a bracket may hold it: case and runs of white space do not matter (the same test as `bracketMatcher()`). */
const termKey = (text: string): string => text.trim().split(/\s+/u).join(" ").toLowerCase();

/**
 * The Latin words of the Chinese that the English lacks (ZH_PARITY: no Latin word that the English lacks, except the English name of
 * a glossary term in full-width brackets), as written, each once, in order of appearance. A Latin word is a run of Latin letters and
 * digits that holds a letter (AlphaFold, CO2, Cas9), so COVID-19 is the word COVID; case does not matter. A run in full-width
 * brackets is skipped only when it is one of `terms` (the English names of the glossary terms that apply: the whole run, case and
 * runs of white space ignored); any other bracketed run is read as the text around it is, so its Latin words must be in the English.
 */
export function oldLatinWordsMissing(en: Strings, zh: Strings, terms: readonly string[] = []): string[] {
  const english = new Set(latinWordsOf(joinText(en)).map((w) => w.toLowerCase()));
  const names = new Set(terms.map(termKey));
  const outside = joinText(zh).replace(BRACKETED_RE, (run) => (names.has(termKey(run.slice(1, -1))) ? " " : run));
  return [...new Set(latinWordsOf(outside).filter((w) => !english.has(w.toLowerCase())))];
}

/**
 * All of ZH_PARITY (§4.12) for one Chinese text and its English: the numbers both ways, the URLs and the Latin words. `terms` are the
 * English names of the glossary terms whose English may stand in full-width brackets (`oldLatinWordsMissing()`).
 */
export function oldParityProblems(en: Strings, zh: Strings, terms: readonly string[] = []): ParityProblems {
  return { ...oldParityGaps(en, zh), urls: oldUrlsIn(joinText(zh)), latin: oldLatinWordsMissing(en, zh, terms) };
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
export function oldNameRuns(english: string): NameRun[] {
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

/** The first `max` characters of a Chinese string, for a message (lib/rules/zh.ts before F-70: the whole string is read). */
export function oldExcerpt(text: string, max = 40): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}…`;
}

/** The Chinese around a hit at UTF-16 offset `at`, for a message (lib/rules/zh.ts before F-70: the whole string is read). */
export function oldAround(text: string, at: number): string {
  const head = Array.from(text.slice(0, at));
  const tail = Array.from(text.slice(at));
  return `${head.length > 10 ? "…" : ""}${head.slice(-10).join("")}${tail.slice(0, 20).join("")}${tail.length > 20 ? "…" : ""}`;
}

/** The Latin words of a ZH_PARITY problem list that no link spells (lib/rules/zh.ts before F-70): a word is spelled by a link when it is a substring of one, case aside. Every link is lower-cased once for every word. */
export function oldWordsOutsideLinks(words: readonly string[], urls: readonly string[]): string[] {
  return words.filter((w) => !urls.some((u) => u.toLowerCase().includes(w.toLowerCase())));
}

/**
 * ZH_AVOID's hits (lib/zh.ts `avoidHits()` before the review of F-70): each hit is masked as it is found, by copying the whole text,
 * so a text of a million hits costs the square of that. Kept only as the reference of tests/zh.test.ts.
 */
export function oldAvoidHits(text: string, terms: { avoid: readonly AvoidTerm[]; fixed: readonly FixedTerm[] }): AvoidHit[] {
  let masked = maskPhrases(text, [...terms.fixed.map((f) => f.zh), ...terms.avoid.flatMap((a) => a.allow_in)]);
  const out: AvoidHit[] = [];
  for (const a of [...terms.avoid].sort((x, y) => y.term.length - x.term.length)) {
    for (let at = masked.indexOf(a.term); at !== -1; at = masked.indexOf(a.term, at + a.term.length)) {
      out.push({ term: a.term, taiwan: a.taiwan, index: at });
      masked = masked.slice(0, at) + " ".repeat(a.term.length) + masked.slice(at + a.term.length);
    }
  }
  return out.sort((x, y) => x.index - y.index);
}
