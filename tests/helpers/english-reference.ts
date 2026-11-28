// The English reading statistics of lib/readability.ts and the digit reader of lib/text.ts as they were before F-70 made them linear in the
// length of a text. They are kept here only as the reference that tests/english-linear.test.ts compares the new code with, over a
// generated corpus: the new code must give the same result on every text a reader could write. They are quadratic on a hostile text (a
// long run of marks before a letter, a long run of zeros, a term said many times in one sentence): nothing but that test may call them.
// The code below is readingStats() and inAverage() of lib/readability.ts before F-70, with only `export`, the `old` prefix and the
// types imported from the current file changed, and the one line of numbersIn() that counted a number's trailing zeros.
// New for this project; Cyber has no reading check.

import type { ReadingStats } from "../../lib/readability";
import { countSyllables } from "../../lib/readability";
import { blankUrls, countWords, splitSentences, wordRe } from "../../lib/text";

const WORDISH_RE = /[\p{L}\p{N}]/u;

function inAverage(core: string, first: boolean, from: number, to: number, ranges: readonly (readonly [number, number])[]): boolean {
  if (/\p{N}/u.test(core)) return false;
  if (!first && /^\p{Lu}/u.test(core) && !/^I(?:['’]\p{Ll}+)?$/u.test(core)) return false;
  return !ranges.some(([a, b]) => a < to && from < b);
}

export function oldReadingStats(text: string, opts: { terms?: readonly string[] } = {}): ReadingStats {
  const termRes = (opts.terms ?? []).filter((term) => term.trim() !== "")
    .map((term) => new RegExp(wordRe(term, { plurals: true }).source, "giu"));
  let sentences = 0;
  let syllableWords = 0;
  let syllables = 0;
  for (const sentence of splitSentences(blankUrls(text))) {
    const ranges = termRes.flatMap((re) => [...sentence.matchAll(re)].map((m) => [m.index, m.index + m[0].length] as const));
    let first = true;
    for (const token of sentence.matchAll(/\S+/gu)) {
      if (!WORDISH_RE.test(token[0])) continue;
      if (first) sentences += 1;
      const core = token[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const count = countSyllables(token[0]);
      if (count > 0 && inAverage(core, first, token.index, token.index + token[0].length, ranges)) {
        syllableWords += 1;
        syllables += count;
      }
      first = false;
    }
  }
  const words = countWords(text);
  const average = syllableWords === 0 ? 0 : syllables / syllableWords;
  const grade = words === 0 ? 0 : 0.39 * (words / sentences) + 11.8 * average - 15.59;
  return { words, sentences, syllableWords, syllables, grade };
}

/** The trailing zeros of the digits of a number, as numbersIn() counted them before F-70. */
export const oldTrailingZeros = (all: string): number => all.length - all.replace(/0+$/, "").length;
