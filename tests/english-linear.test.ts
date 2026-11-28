// The English text readers of lib/text.ts and lib/readability.ts on a hostile string (F-70). The Chinese checks were made linear in the
// length of a text, and a search of the English side for the same patterns found three that were not: numbersIn() counted a number's
// trailing zeros with `/0+$/` (quadratic on a long run of zeros before another digit), readingStats() stripped a token's end with
// `[^\p{L}\p{N}]+$` (quadratic on a long run of marks before a letter) and checked each token against every match of a finding's terms
// (quadratic on a sentence that says a term many times). Each test checks that the result is the old one on every text a reader could
// write (tests/helpers/english-reference.ts holds the old code), and that a text a hundred thousand characters long takes well under a second.
//
// New for this project; Cyber's text helpers had no length limit and its reading check did not exist.

import { describe, expect, it } from "vitest";
import { countSyllables, readingGrade, readingStats } from "@/lib/readability";
import { numbersIn } from "@/lib/text";
import { oldReadingStats, oldTrailingZeros } from "./helpers/english-reference";

/** Runs `run` and fails when it took `limitMs` or longer; gives its result. */
function within<T>(limitMs: number, run: () => T): T {
  const before = performance.now();
  const result = run();
  expect(performance.now() - before).toBeLessThan(limitMs);
  return result;
}

/** A seeded generator (mulberry32), so that a failing text can be found again. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EM_DASH = String.fromCharCode(0x2014);
const MARK = String.fromCharCode(0x301);
const HIGH_HALF = String.fromCharCode(0xd83d);
const EMOJI = String.fromCodePoint(0x1f600);
const NO_BREAK = String.fromCharCode(0xa0);
const WIDE_STAR = String.fromCharCode(0xff0a);

describe("numbersIn() counts the zeros that end a number without a regular expression that tries every start", () => {
  /** The `approx_step` the old reading gave: the step times ten to the trailing zeros of all the digits, or the step when they are all zeros. */
  function oldApproxStep(whole: string, fraction: string): number {
    const step = 10 ** -fraction.length;
    const all = whole + fraction;
    return Number((all.replace(/0/g, "") === "" ? step : step * 10 ** oldTrailingZeros(all)).toPrecision(15));
  }

  it("gives each figure its step at the last non-zero digit, as before", () => {
    const table: [string, number][] = [
      ["1,400", 100], ["3000", 1000], ["7", 1], ["70", 10], ["0", 1], ["000", 1], ["0.50", 0.1], ["10.0", 10], ["1.20", 0.1], ["100,000", 100000],
      ["0.00", 0.01], ["1,000,000", 1000000], ["305", 1], ["3050", 10], ["0.5", 0.1], ["12.340", 0.01], ["900.0", 100], ["1.0", 1],
    ];
    expect(table.map(([text]) => numbersIn(text)[0]!.approx_step)).toEqual(table.map(([, step]) => step));
  });

  it("gives the old step for 2,000 generated figures, whole or with decimals, thick with zeros", () => {
    const next = seeded(7);
    const digit = (): string => (next() < 0.55 ? "0" : String(1 + Math.floor(next() * 9)));
    const run = (length: number): string => Array.from({ length }, digit).join("");
    for (let i = 0; i < 2000; i += 1) {
      const whole = run(1 + Math.floor(next() * 6)).replace(/^0+(?=\d)/, "");
      const fraction = next() < 0.5 ? "" : run(1 + Math.floor(next() * 5));
      const text = fraction === "" ? whole : `${whole}.${fraction}`;
      if (/^(?:199\d|20\d\d)$/.test(text)) continue; // a year is no figure
      const found = numbersIn(text);
      expect(found, text).toHaveLength(1);
      expect(found[0]!.approx_step, text).toBe(oldApproxStep(whole, fraction));
    }
  });

  it("reads a run of 200,000 zeros before a 1, and a 1 before 200,000 zeros, in well under a second", () => {
    const [low] = within(1000, () => numbersIn(`${"0".repeat(200_000)}1`));
    expect(low!.approx_step).toBe(1);
    const [high] = within(1000, () => numbersIn(`1${"0".repeat(200_000)}`));
    expect(high!.value).toBe(Infinity);
  });

  it("reads 200,000 zeros alone, and zeros with a decimal point, in well under a second", () => {
    expect(within(1000, () => numbersIn("0".repeat(200_000))[0]!.approx_step)).toBe(1);
    expect(within(1000, () => numbersIn(`0.${"0".repeat(200_000)}`)[0]!.decimals)).toBe(200_000);
  });
});

describe("readingStats() reads a token's core and the finding's terms in one pass over the sentence", () => {
  const TERMS = ["protein folding", "papyrus", "ai"];
  const PIECES = [
    "the", "model", "The", "Model", "I", "I'm", "DNA", "NASA", "cat's", "don't", "2024", "3.5", "x86", "B-12", "state-of-the-art", "and/or",
    "protein folding", "Protein Folding", "papyrus", "papyri", "AI", "ai", "folding", "protein",
    "(", ")", "[", "]", '"', "'", "“", "”", "...", "!!!", "??", "--", EM_DASH, "*", "#", ".", ",", ";", ":",
    "(DNA)", "'cat'", '"Model"', "...x...", "!!x!!", "(2024)", "(protein", "folding)", "(papyrus).", "abc2", "a2c", "2abc", "(abc2)", "(x)a", "Ab2",
    `a${MARK}`, `${MARK}${MARK}a`, `x${MARK}${MARK}`, EMOJI, `${EMOJI}a${EMOJI}`, `a${EMOJI}${EMOJI}b`, HIGH_HALF, `a${HIGH_HALF}`, `${HIGH_HALF}b`,
    "範例", "（範例）", "例", NO_BREAK,
    "https://example.org/a", "https://example.org/b.c",
  ];
  const SEPARATORS = [" ", " ", " ", " ", "  ", "\n", `${NO_BREAK}`, ". ", "! ", "? "];

  function corpus(count: number, seed: number): string[] {
    const next = seeded(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
    return Array.from({ length: count }, () => {
      const length = 1 + Math.floor(next() * 14);
      let text = "";
      for (let i = 0; i < length; i += 1) text += pick(PIECES) + (i === length - 1 ? "" : pick(SEPARATORS));
      return text;
    });
  }

  it("gives the old words, sentences, syllables and grade for 3,000 generated texts, with no terms and with terms", () => {
    for (const text of corpus(3000, 11)) {
      expect(readingStats(text), JSON.stringify(text)).toEqual(oldReadingStats(text));
      expect(readingStats(text, { terms: TERMS }), JSON.stringify(text)).toEqual(oldReadingStats(text, { terms: TERMS }));
    }
  });

  it("gives the old statistics where terms overlap, touch a word, repeat, or are empty", () => {
    const cases: [string, string[]][] = [
      ["A protein folding model works.", ["protein folding"]],
      ["A protein folding model works.", ["protein", "protein folding", "folding model"]],
      ["Protein folding, protein foldings and protein-folding are here.", ["protein folding"]],
      ["Proteins fold. Protein folding is hard. Papyrus helps.", ["protein", "papyrus"]],
      ["The AI and the ai say AI.", ["ai"]],
      ["Nothing to match here at all.", ["protein folding"]],
      ["Papyrus papyrus papyrus papyri.", ["papyrus", "papyrus"]],
      ["Protein folding is hard.", ["", "  ", "protein folding"]],
      ["Folding protein folding protein.", ["folding protein", "protein folding"]],
      ["(protein folding)! 'papyrus'...", ["protein folding", "papyrus"]],
      ["A protein folding model works.", ["protein folding model", "folding"]],
      ["Proteins fold. Papyrus helps. Protein folding is hard.", ["papyrus", "protein"]],
      ["Proteins fold. Papyrus helps. Protein folding is hard.", ["protein", "papyrus", "protein folding"]],
      ["See (x)a b and a c.", ["a"]],
      ["See model2 and cat2dog and (abc2) now.", []],
    ];
    for (const [text, terms] of cases) expect(readingStats(text, { terms }), `${text} ${terms.join("|")}`).toEqual(oldReadingStats(text, { terms }));
  });

  it("leaves a term's own words out of the syllable average, and only those", () => {
    // Five words; "protein" and "folding" are the term; the other three are A (1 syllable), model (2) and works (1): 4 syllables.
    expect(readingStats("A protein folding model works.", { terms: ["protein folding"] })).toMatchObject({ words: 5, sentences: 1, syllableWords: 3, syllables: 4 });
    expect(readingStats("A protein folding model works.")).toMatchObject({ words: 5, sentences: 1, syllableWords: 5, syllables: 8 });
  });

  it("takes a capitalised name, an acronym and a word with a digit out of the average whatever marks stand round it", () => {
    // Only "See" (first) and "the" count: "(DNA)", "'Model'" and "!!2024!!" are left out. "the" is 1 syllable and "See" 1.
    expect(readingStats("See (DNA) the 'Model' !!2024!!")).toMatchObject({ words: 5, sentences: 1, syllableWords: 2, syllables: 2 });
    expect(readingGrade("See (DNA) the 'Model' !!2024!!")).toBe(readingStats("See (DNA) the 'Model' !!2024!!").grade);
  });

  it("reads a token of 100,000 marks, characters from beyond the Basic Multilingual Plane, or lone halves, between two letters in well under a second", () => {
    for (const mark of ["!", MARK, EMOJI, HIGH_HALF, WIDE_STAR]) {
      const stats = within(1000, () => readingStats(`See a${mark.repeat(100_000)}x now`));
      expect(stats, JSON.stringify(mark)).toMatchObject({ words: 3, sentences: 1 });
    }
  });

  it("reads 1,000,000 characters of one term said again and again in one sentence, with the term, in a few seconds", () => {
    const text = "protein folding ".repeat(62_500);
    const stats = within(4000, () => readingStats(text, { terms: ["protein folding"] }));
    expect(stats).toMatchObject({ words: 125_000, sentences: 1, syllableWords: 0, syllables: 0 });
  });

  it("reads many terms that overlap in one sentence the same way, and keeps the words between them", () => {
    const text = "protein folding is hard ".repeat(30_000);
    const stats = within(4000, () => readingStats(text, { terms: ["protein", "protein folding", "folding"] }));
    expect(stats).toMatchObject({ words: 120_000, sentences: 1, syllableWords: 60_000, syllables: 60_000 });
  });
});

describe("countSyllables() reads a word of millions of characters without overflowing the stack", () => {
  it("gives a 5,000,000-mark run between two letters its two syllables, and one letter its one, in well under a few seconds", () => {
    expect(within(4000, () => countSyllables(`a${MARK.repeat(5_000_000)}b`))).toBe(2);
    expect(within(4000, () => countSyllables(`${MARK.repeat(5_000_000)}a`))).toBe(1);
  });

  it("reads 5,000,000 capital letters, 5,000,000 apostrophes and a 1,700,000-piece hyphenated word", () => {
    expect(within(4000, () => countSyllables("A".repeat(5_000_000)))).toBe(5_000_000);
    expect(within(4000, () => countSyllables("'".repeat(5_000_000)))).toBe(0);
    expect(within(4000, () => countSyllables("ab-".repeat(1_700_000)))).toBe(1_700_000);
  });

  it("reads a long token through readingStats() the same way, with an issue and no exception", () => {
    const stats = within(6000, () => readingStats(`See a${MARK.repeat(5_000_000)}b now`));
    expect(stats).toMatchObject({ words: 3, sentences: 1 });
  });
});
