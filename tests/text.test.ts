// Tests for lib/text.ts (SPEC §4.1 Words and Sentences, §4.4 mentionsAnthropic(), §4.12 DUPLICATE, NUMBER_SOURCED,
// QUOTE_VERBATIM, HYPE_WORDS, TERM_DEFINED and DUAL_USE). Cyber's tests/helpers.test.ts and tests/lib.test.ts at the
// fork commit 3ced1fb, adapted: its countWords, wordSet, jaccard, numbersIn and numberMatches cases are kept where the
// code is the same (no advisory ids; the examples are neutral); the splitSentences tests are new, one for each edge case
// that lib/text.ts decides, and so are those of the multipliers and the words mode of numbersIn, foldQuote, wordRe,
// wordsIn, maskPhrases and mentionsAnthropicText. Dashes and invisible characters are built from their character codes,
// so that no source line holds one.
import { describe, expect, it } from "vitest";
import {
  blankUrls, countWords, escapeRegExp, foldQuote, jaccard, maskPhrases, mentionsAnthropicText, numberMatches, numbersIn,
  quoteInText, splitSentences, wordRe, wordSet, wordsIn,
} from "@/lib/text";
import { ABBREVIATIONS, ANTHROPIC_PHRASES, CLAUDE_PEOPLE } from "@/lib/vocab";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const HYPHEN = String.fromCharCode(0x2010);
const NB_HYPHEN = String.fromCharCode(0x2011);
const MINUS = String.fromCharCode(0x2212);
const SHY = String.fromCharCode(0xad);
const ZWSP = String.fromCharCode(0x200b);
const FI_LIGATURE = String.fromCharCode(0xfb01);
const ELLIPSIS = String.fromCharCode(0x2026);
const WORD_MARK = String.fromCharCode(0xe000);

// ── Words ────────────────────────────────────────────────────────────────────────────────────────

describe("countWords", () => {
  it("counts the tokens that hold a letter or a digit", () => {
    expect(countWords("Researchers found the protein folds within days.")).toBe(7);
  });

  it("counts a hyphenated word and a number such as 1,800 as one word each", () => {
    expect(countWords("A 13-week window, 1,800 samples and 05:58 Taipei")).toBe(8);
  });

  it("leaves out URLs, markdown symbols and stray dashes", () => {
    expect(countWords("**Bold** text, see https://example.org/a/b?c=d and # - >")).toBe(4);
    expect(countWords(`one ${EM} two ${EN} three`)).toBe(3);
    expect(countWords("See (https://doi.org/10.1038/x) now")).toBe(2);
  });

  it("is 0 for no text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords("   \n ")).toBe(0);
  });

  it("counts a Chinese or Japanese run without spaces as one word", () => {
    expect(countWords("資安 漏洞")).toBe(2);
    expect(countWords("ゲノム編集")).toBe(1);
  });
});

describe("blankUrls", () => {
  it("replaces each URL with as many spaces, so every other character keeps its position", () => {
    const first = "https://doi.org/10.1038/x";
    const second = "HTTP://Example.org/a?b=1";
    const text = `See ${first} and ${second} now.`;
    const blank = blankUrls(text);
    expect(blank).toBe(`See ${" ".repeat(first.length)} and ${" ".repeat(second.length)} now.`);
    expect(blank).toHaveLength(text.length);
  });

  it("leaves text without a URL alone, and a word that only ends in http", () => {
    expect(blankUrls("No link here.")).toBe("No link here.");
    expect(blankUrls("xhttps://a.b")).toBe("xhttps://a.b");
  });
});

// ── Similarity ───────────────────────────────────────────────────────────────────────────────────

describe("wordSet and jaccard", () => {
  it("wordSet lower-cases, turns punctuation into spaces and reads full-width letters as plain ones", () => {
    expect([...wordSet("Protein folding, SOLVED!")].sort()).toEqual(["folding", "protein", "solved"]);
    expect([...wordSet("ＡＩ-driven")].sort()).toEqual(["ai", "driven"]);
  });

  it("wordSet turns a Han or Kana run into its character pairs, and a one-character run into itself", () => {
    expect([...wordSet("資安漏洞")]).toEqual(["資安", "安漏", "漏洞"]);
    expect([...wordSet("漏")]).toEqual(["漏"]);
    expect([...wordSet("AI發現")].sort()).toEqual(["ai", "發現"]);
    // The prolonged sound mark belongs to the Kana run, though its script is Common.
    expect([...wordSet("スーパー")]).toEqual(["スー", "ーパ", "パー"]);
  });

  it("jaccard is 1 for the same words, 0 for none shared, and the share of the union between", () => {
    expect(jaccard("Protein folding solved", "protein, folding: SOLVED!")).toBe(1);
    expect(jaccard("Protein folding solved", "Quantum gravity tested")).toBe(0);
    expect(jaccard("Protein folding solved", "Protein folding solved again")).toBe(0.75);
    expect(jaccard("AI proves new result in number theory", "AI proves a new result in number theory")).toBeCloseTo(7 / 8, 10);
  });

  it("jaccard scores two empty titles 1 and an empty one against a full one 0", () => {
    expect(jaccard("", "")).toBe(1);
    expect(jaccard("!!!", "...")).toBe(1);
    expect(jaccard("", "Protein folding")).toBe(0);
  });

  it("jaccard keeps two Chinese titles one character apart close together", () => {
    expect(jaccard("AI發現新蛋白質", "AI發現新蛋白")).toBeCloseTo(5 / 6, 10);
    expect(jaccard("AI發現新蛋白質", "量子重力測試")).toBe(0);
  });
});

// ── Sentences ────────────────────────────────────────────────────────────────────────────────────

describe("splitSentences", () => {
  it("splits after a stop followed by white space and a capital letter or a digit", () => {
    expect(splitSentences("The team agreed. It held! Did it work? Yes.\nThen 5 more followed. 12 tests passed.")).toEqual([
      "The team agreed.", "It held!", "Did it work?", "Yes.", "Then 5 more followed.", "12 tests passed."]);
  });

  it("returns the whole text trimmed when it holds no stop, and nothing for an empty or blank text", () => {
    expect(splitSentences("  A line with no stop  ")).toEqual(["A line with no stop"]);
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences(" \n\t ")).toEqual([]);
  });

  it("trims each sentence and drops the white space between them", () => {
    expect(splitSentences("  First one.   Second one.\n\n\nThird one.  ")).toEqual(["First one.", "Second one.", "Third one."]);
  });

  it("splits after a run of stops, a question and an exclamation mark together included", () => {
    expect(splitSentences("Really?! Yes. Wow!!! Okay.")).toEqual(["Really?!", "Yes.", "Wow!!!", "Okay."]);
  });

  it("does not split before a lower-case word or a symbol, as the spec says", () => {
    expect(splitSentences("Results were stable. mRNA levels rose. pH fell to 3.")).toEqual(["Results were stable. mRNA levels rose. pH fell to 3."]);
    expect(splitSentences("It held. % of cases rose.")).toEqual(["It held. % of cases rose."]);
  });

  describe("numbers, URLs and DOIs", () => {
    it("never splits inside a number or a dotted name, because no white space follows its dots", () => {
      expect(splitSentences("It rose 2.5 points on doi.org/10.1038/x and v2.1.3 shipped. Then it fell.")).toEqual([
        "It rose 2.5 points on doi.org/10.1038/x and v2.1.3 shipped.", "Then it fell."]);
    });

    it("ends a sentence at a number and a stop followed by a capital letter or a digit", () => {
      expect(splitSentences("The ratio was 2.5. Then it fell.")).toEqual(["The ratio was 2.5.", "Then it fell."]);
      expect(splitSentences("It reached 2.5.\nThen it fell.")).toEqual(["It reached 2.5.", "Then it fell."]);
      expect(splitSentences("We tested 12. Then we stopped.")).toEqual(["We tested 12.", "Then we stopped."]);
      expect(splitSentences("The value is 3. 5 teams agreed.")).toEqual(["The value is 3.", "5 teams agreed."]);
    });

    it("does not split inside a URL or a DOI, and splits after the stop that ends one", () => {
      expect(splitSentences("Read https://doi.org/10.1038/s41586-024-07487-w for details. Then it ended.")).toEqual([
        "Read https://doi.org/10.1038/s41586-024-07487-w for details.", "Then it ended."]);
      expect(splitSentences("The paper is at https://doi.org/10.1038/x. Then it ended.")).toEqual([
        "The paper is at https://doi.org/10.1038/x.", "Then it ended."]);
      expect(splitSentences("See doi:10.1038/12. Then it ended.")).toEqual(["See doi:10.1038/12.", "Then it ended."]);
    });
  });

  describe("abbreviations", () => {
    it("has entries to test", () => {
      expect(ABBREVIATIONS.length).toBeGreaterThan(0);
    });

    for (const abbreviation of ABBREVIATIONS) {
      it(`does not split after ${abbreviation}`, () => {
        expect(splitSentences(`See ${abbreviation} Smith for details. Then it ended.`)).toEqual([
          `See ${abbreviation} Smith for details.`, "Then it ended."]);
      });
    }

    it("does split after a word that is no abbreviation, so the tests above have a control", () => {
      expect(splitSentences("See Smith for details. Then it ended.")).toEqual(["See Smith for details.", "Then it ended."]);
    });

    it("reads the capitalised form of an entry that begins in lower case, as it opens a sentence", () => {
      const lower = ABBREVIATIONS.filter((a) => /^\p{Ll}/u.test(a));
      expect(lower.length).toBeGreaterThan(0);
      for (const abbreviation of lower) {
        const capitalised = abbreviation.charAt(0).toUpperCase() + abbreviation.slice(1);
        expect(splitSentences(`It was shown. ${capitalised} Smith (2020) agrees. Then it ended.`), capitalised).toEqual([
          "It was shown.", `${capitalised} Smith (2020) agrees.`, "Then it ended."]);
      }
    });

    it("does not read an entry at the end of another word", () => {
      expect(splitSentences("It was MyDr. Then it ended.")).toEqual(["It was MyDr.", "Then it ended."]);
    });

    it("reads No. as written: a sentence that ends in No. runs on, one that ends in no. does not", () => {
      expect(splitSentences("He said No. Then he left.")).toEqual(["He said No. Then he left."]);
      expect(splitSentences("He said no. Then he left.")).toEqual(["He said no.", "Then he left."]);
    });

    it("lets a sentence that ends in et al. or U.S. run on into the next, as the spec's never asks", () => {
      expect(splitSentences("It was reported by Smith et al. Nature agreed.")).toEqual(["It was reported by Smith et al. Nature agreed."]);
      expect(splitSentences("He moved to the U.S. Then he left.")).toEqual(["He moved to the U.S. Then he left."]);
    });
  });

  describe("initials and list markers", () => {
    it("does not split between initials: J. R. R. Tolkien is one name", () => {
      expect(splitSentences("J. R. R. Tolkien wrote it. Then he left.")).toEqual(["J. R. R. Tolkien wrote it.", "Then he left."]);
      expect(splitSentences("Papers by A. B. Smith and C. D. Jones agree. Then it ended.")).toEqual([
        "Papers by A. B. Smith and C. D. Jones agree.", "Then it ended."]);
    });

    it("splits after a lone capital that is not next to another initial, which a sentence ending in a capital needs", () => {
      expect(splitSentences("It was Plan B. The team agreed.")).toEqual(["It was Plan B.", "The team agreed."]);
      // The cost of that rule: a single initial before a first name is read as a sentence end.
      expect(splitSentences("J. Robert Oppenheimer led it.")).toEqual(["J.", "Robert Oppenheimer led it."]);
    });

    it("keeps a one or two digit list marker with its item", () => {
      expect(splitSentences("1. Mix the reagents. 2. Heat it.\n3. Cool it.")).toEqual(["1. Mix the reagents.", "2. Heat it.", "3. Cool it."]);
      expect(splitSentences("10. Mix it. 11. Heat it.")).toEqual(["10. Mix it.", "11. Heat it."]);
    });

    it("reads a number of three digits and a stop as a sentence end, not a marker", () => {
      expect(splitSentences("100. Mix it.")).toEqual(["100.", "Mix it."]);
    });
  });

  describe("quotations", () => {
    it("never splits inside a quoted span, whatever the quote marks", () => {
      expect(splitSentences('He said "It works. We checked." Then he left.')).toEqual(['He said "It works. We checked."', "Then he left."]);
      expect(splitSentences("She wrote “It works. We checked.” Then she left.")).toEqual(["She wrote “It works. We checked.”", "Then she left."]);
      expect(splitSentences('He wrote: "First claim. Second claim. Third claim." The editors agreed.')).toEqual([
        'He wrote: "First claim. Second claim. Third claim."', "The editors agreed."]);
    });

    it("splits after the closing quote that follows a stop, and not before it", () => {
      expect(splitSentences('He said "It works." Then he left.')).toEqual(['He said "It works."', "Then he left."]);
      expect(splitSentences("He said “It works!” Then he left.")).toEqual(["He said “It works!”", "Then he left."]);
    });

    it("splits before each kind of opening quote", () => {
      for (const opener of ['"', "'", "“", "‘", "„", "«", "‹", "「", "『"]) {
        expect(splitSentences(`It held. ${opener}Next one follows here.`), opener).toEqual(["It held.", `${opener}Next one follows here.`]);
      }
    });

    it("lets a quoted question run on into the sentence that holds it, and splits before an opening quote", () => {
      expect(splitSentences('"Why?" she asked. "Because." He left.')).toEqual(['"Why?" she asked.', '"Because."', "He left."]);
      expect(splitSentences('He left. "Why?" she asked.')).toEqual(["He left.", '"Why?" she asked.']);
    });

    it("reads nested quotes, and quotes of more than one kind, as one span", () => {
      expect(splitSentences('He said "she said “yes. no.” and left." Then he left.')).toEqual([
        'He said "she said “yes. no.” and left."', "Then he left."]);
    });

    it("lets a quote mark that never closes open no span", () => {
      expect(splitSentences('He said "it works. Then he left.')).toEqual(['He said "it works.', "Then he left."]);
    });

    it("never reads single quotes as a span, since they are also apostrophes", () => {
      expect(splitSentences("The 1990s' results held. Then they fell.")).toEqual(["The 1990s' results held.", "Then they fell."]);
      expect(splitSentences("He said 'it works. Then he left.'")).toEqual(["He said 'it works.", "Then he left.'"]);
    });
  });

  describe("brackets", () => {
    it("splits before a bracketed sentence and after a closing bracket that follows the stop", () => {
      expect(splitSentences("It held. (The team checked.) It was fine.")).toEqual(["It held.", "(The team checked.)", "It was fine."]);
      expect(splitSentences("The team agreed (it was close.) Then it ended.")).toEqual(["The team agreed (it was close.)", "Then it ended."]);
    });

    it("reads an abbreviation inside brackets, and the stop after the closing bracket", () => {
      expect(splitSentences("It held (see Fig. 2). Then it fell.")).toEqual(["It held (see Fig. 2).", "Then it fell."]);
    });
  });

  describe("ellipses", () => {
    it("splits after three dots when a capital follows, and not before a lower-case word", () => {
      expect(splitSentences("Wait... Then he left.")).toEqual(["Wait...", "Then he left."]);
      expect(splitSentences("Wait... then he left.")).toEqual(["Wait... then he left."]);
    });

    it("never splits at the single character for an ellipsis", () => {
      expect(splitSentences(`Wait${ELLIPSIS} Then he left.`)).toEqual([`Wait${ELLIPSIS} Then he left.`]);
    });
  });

  describe("Chinese", () => {
    it("splits after the full-width stop, question mark and exclamation mark, with no white space", () => {
      expect(splitSentences("我們發現了新蛋白質。它很重要。完成了嗎？是的！")).toEqual(["我們發現了新蛋白質。", "它很重要。", "完成了嗎？", "是的！"]);
    });

    it("keeps the closing mark with its sentence and reads a quoted span as one", () => {
      expect(splitSentences("他說：「好。」然後離開。")).toEqual(["他說：「好。」", "然後離開。"]);
      expect(splitSentences("他說：「好。是的。」然後離開。")).toEqual(["他說：「好。是的。」", "然後離開。"]);
      expect(splitSentences("他說：『好。是的。』然後離開。")).toEqual(["他說：『好。是的。』", "然後離開。"]);
      expect(splitSentences("（完成。）下一句。")).toEqual(["（完成。）", "下一句。"]);
    });

    it("reads a run of full-width stops as one, so a question and an exclamation mark do not leave a piece of their own", () => {
      expect(splitSentences("真的嗎？！是的。。完成。")).toEqual(["真的嗎？！", "是的。。", "完成。"]);
    });

    it("splits Chinese and English text together, each by its own stops", () => {
      expect(splitSentences("AI 找到答案。Then it ended.")).toEqual(["AI 找到答案。", "Then it ended."]);
      expect(splitSentences("版本 2.5 已發布。完成。")).toEqual(["版本 2.5 已發布。", "完成。"]);
    });

    it("returns text with no stop as one sentence", () => {
      expect(splitSentences("沒有句號")).toEqual(["沒有句號"]);
    });
  });

  it("reads a paragraph that holds several of these at once", () => {
    expect(splitSentences('Dr. Lee wrote "It works. It scales." Then 3.5 teams (e.g. Kyoto) agreed... Maybe? Yes!')).toEqual([
      'Dr. Lee wrote "It works. It scales."', "Then 3.5 teams (e.g. Kyoto) agreed...", "Maybe?", "Yes!"]);
  });

  it("loses and adds no character, and returns no empty or untrimmed sentence", () => {
    const texts = [
      "The team agreed. It held! Did it work? Yes.\nThen 5 more followed. 12 tests passed.",
      'He said "It works. We checked." Then he left.', "J. R. R. Tolkien wrote it. Then he left.", "1. Mix it. 2. Heat it.\n3. Cool it.",
      "It held. (The team checked.) It was fine.", "Wait... Then he left.", "他說：「好。」然後離開。完成了嗎？是的！", "AI 找到答案。Then it ended.",
      "See e.g. Smith et al. Nature agreed. Then it ended.",
    ];
    for (const text of texts) {
      const sentences = splitSentences(text);
      expect(sentences.every((s) => s !== "" && s === s.trim()), text).toBe(true);
      expect(sentences.join("").replace(/\s+/g, ""), text).toBe(text.replace(/\s+/g, ""));
    }
  });
});

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────

describe("numbersIn", () => {
  const read = (text: string, words = false) => numbersIn(text, { words }).map((n) => [n.raw, n.value, n.percent, n.approx]);
  const raws = (text: string, words = false) => numbersIn(text, { words }).map((n) => n.raw);

  it("gives each number its value, decimals, the place values of its last digits and its flags", () => {
    expect(numbersIn("about 1,400 hosts")).toEqual([
      { raw: "1,400", value: 1400, decimals: 0, step: 1, approx_step: 100, percent: false, approx: true, word: false }]);
    expect(numbersIn("4.5 million")).toEqual([
      { raw: "4.5 million", value: 4_500_000, decimals: 1, step: 100_000, approx_step: 100_000, percent: false, approx: false, word: false }]);
    expect(numbersIn("5.0 times")).toEqual([{ raw: "5.0", value: 5, decimals: 1, step: 0.1, approx_step: 1, percent: false, approx: false, word: false }]);
    expect(numbersIn("2.50")).toEqual([{ raw: "2.50", value: 2.5, decimals: 2, step: 0.01, approx_step: 0.1, percent: false, approx: false, word: false }]);
    expect(numbersIn("10 million")).toEqual([
      { raw: "10 million", value: 10_000_000, decimals: 0, step: 1_000_000, approx_step: 10_000_000, percent: false, approx: false, word: false }]);
    expect(numbersIn("0")).toEqual([{ raw: "0", value: 0, decimals: 0, step: 1, approx_step: 1, percent: false, approx: false, word: false }]);
    expect(numbersIn("37%")).toEqual([{ raw: "37%", value: 37, decimals: 0, step: 1, approx_step: 1, percent: true, approx: false, word: false }]);
  });

  it("gives values and place values without binary noise, as 2.3 hundred and four decimals show", () => {
    expect(read("2.3 hundred and 1.1 hundred")).toEqual([["2.3 hundred", 230, false, false], ["1.1 hundred", 110, false, false]]);
    expect(numbersIn("0.1234")).toMatchObject([{ value: 0.1234, decimals: 4, step: 0.0001, approx_step: 0.0001 }]);
    expect(numbersIn("1.5000")).toMatchObject([{ value: 1.5, decimals: 4, step: 0.0001, approx_step: 0.1 }]);
  });

  it("reads a magnitude: the minus sign is not part of a number", () => {
    expect(numbersIn("fell by -5 points")[0]?.value).toBe(5);
  });

  it("reads full-width digits as plain ones", () => {
    expect(read("３７％ and ２６ weeks")).toEqual([["37%", 37, true, false], ["26", 26, false, false]]);
  });

  it("reads percentages and multipliers: %, per cent, percent, hundred to trillion and bn", () => {
    expect(read("2.3bn, 12 million, 3 thousand, 4 hundred, 1.2 trillion, 5 BN, 40 per cent, 7 percent, 15 %, 37%")).toEqual([
      ["2.3bn", 2_300_000_000, false, false], ["12 million", 12_000_000, false, false], ["3 thousand", 3000, false, false],
      ["4 hundred", 400, false, false], ["1.2 trillion", 1_200_000_000_000, false, false], ["5 BN", 5_000_000_000, false, false],
      ["40 per cent", 40, true, false], ["7 percent", 7, true, false], ["15 %", 15, true, false], ["37%", 37, true, false]]);
    expect(read("1,400,000 and 44,944 records")).toEqual([["1,400,000", 1_400_000, false, false], ["44,944", 44_944, false, false]]);
  });

  it("does not read digits glued to letters, nor the glued m of 10m and 5M", () => {
    expect(read("COVID-19, 2FA, x86, 5G, 3rd, 1.5x, H1, 10m, 4.5m, 5M, 10x faster")).toEqual([]);
    expect(read("10-15 days, a 13-week window")).toEqual([["10", 10, false, false], ["15", 15, false, false], ["13", 13, false, false]]);
  });

  describe("approximation", () => {
    it("marks a number written after about, around, nearly, almost, roughly, more than, over or a tilde", () => {
      for (const lead of ["about", "around", "nearly", "almost", "roughly", "more than", "over", "About", "~"]) {
        expect(numbersIn(`${lead} 300 victims`)[0]?.approx, lead).toBe(true);
      }
      expect(numbersIn("about $5 million")[0]?.approx).toBe(true);
      expect(read("about 1,400 hosts, ~300 victims, more than 2 million records, nearly 40%")).toEqual([
        ["1,400", 1400, false, true], ["300", 300, false, true], ["2 million", 2_000_000, false, true], ["40%", 40, true, true]]);
    });

    it("does not mark a number that only has an approximation word somewhere before it", () => {
      for (const text of ["about the 300 victims", "overall 300 victims", "overnight 300 victims"]) {
        expect(numbersIn(text)[0]?.approx, text).toBe(false);
      }
      expect(numbersIn("300 victims and about 12 more").map((n) => n.approx)).toEqual([false, true]);
    });
  });

  describe("what is not a quantity", () => {
    it("removes dates, times, years, versions and section marks", () => {
      const text = "on 2026-11-05T04:50:12+08:00, 2026-11-05, at 05:12 and 9 pm, on 21 Oct, 21st October, October 21 and Nov. 3, "
        + `in 2024, the 2020s, 2023-24, 2023${EN}2024, version 4.2.7, v2.1, 10.0.0.1, §4.12.`;
      expect(read(text)).toEqual([]);
    });

    it("reads the years 1990 to 2099 as dates and the others as numbers", () => {
      expect(raws("in 1989, 1990, 2099 and 2100")).toEqual(["1989", "2100"]);
    });

    it("reads a day range in one month as one date", () => {
      for (const text of [
        "13 to 14 Oct", "from 11 to 12 Nov", "between 10 and 11 Nov", "Between 10 and 11 Nov", "11-12 Nov", `11${EN}12 Nov`, `11 ${EN} 12 Nov`,
        `11${NB_HYPHEN}12 Nov`, `2${EN}3 Nov`, "13 to 14 October", "13 to 14 OCT", "1 to 30 Sept", "13th to 14th Oct", "13th to 14th of October",
        "from the 13th to the 14th of October", "between the 13th and the 14th of Oct", "13 to 14 Oct.", "Oct 13 to 14", "Oct. 13 to 14",
        "October 13th to 14th", "Oct 13 to the 14th", "Oct 13-14", `Oct 13${EN}14`, "between Oct 13 and 14", "1 to 31 Dec", "Oct 1 to 31",
      ]) expect(read(text), text).toEqual([]);
    });

    it("reads every month name, full or short, in capitals too, and no lower-case word", () => {
      for (const month of ["January", "Jan", "February", "Feb", "March", "Mar", "April", "Apr", "May", "June", "Jun", "July", "Jul", "August",
        "Aug", "September", "Sept", "Sep", "October", "Oct", "November", "Nov", "December", "Dec", "SEPT", "DECEMBER"]) {
        expect(read(`13 to 14 ${month}`), month).toEqual([]);
      }
      expect(raws("13 to 14 may")).toEqual(["13", "14"]);
    });

    it("reads every weekday name, full or short, before the second day of a range", () => {
      for (const day of ["Monday", "Mon", "Tuesday", "Tue", "Tues", "Wednesday", "Wed", "Weds", "Thursday", "Thu", "Thur", "Thurs", "Friday", "Fri",
        "Saturday", "Sat", "Sunday", "Sun", "TUES"]) {
        expect(read(`from 9 to ${day} 12 Nov`), day).toEqual([]);
        expect(read(`from 9 to ${day}. 12 Nov`), `${day}.`).toEqual([]);
      }
    });

    it("reads a range across two months as two dates", () => {
      for (const text of [
        "30 Oct to 2 Nov", "from 31 Oct to 1 Nov", `30 Oct${EN}2 Nov`, "between 30 Oct and 2 Nov", "Oct 30 to Nov 2", `Oct 30${EN}Nov 2`,
        "Oct 30 to 2 Nov", "13 Oct to 14 Oct",
      ]) expect(read(text), text).toEqual([]);
    });

    it("keeps the numbers beside a date range", () => {
      expect(read("The trial between 13 and 14 Oct had 37% of 26 weeks.")).toEqual([["37%", 37, true, false], ["26", 26, false, false]]);
      expect(read("13 to 14 October's 26 weeks")).toEqual([["26", 26, false, false]]);
    });

    it("reads as numbers what only looks like a day range", () => {
      expect(raws("rose from 12 to 40")).toEqual(["12", "40"]);
      expect(raws("12 to 14 samples")).toEqual(["12", "14"]);
      expect(raws("between 2 and 30 days")).toEqual(["2", "30"]);
      expect(raws("14 to 13 Oct")).toEqual(["14"]);
      expect(raws("0 to 3 Nov")).toEqual(["0"]);
      expect(raws("from 12 to 40 Nov")).toEqual(["12"]);
      expect(raws("1.13 to 14 Oct")).toEqual(["1.13"]);
      expect(raws("Oct 14 to 13")).toEqual(["13"]);
      expect(raws("Oct 13 to 32")).toEqual(["32"]);
      expect(raws("Oct 13 to 14%")).toEqual(["14%"]);
      expect(raws("Oct 13 to 14.5")).toEqual(["14.5"]);
      expect(raws("Oct 13 to 14 million")).toEqual(["14 million"]);
    });

    it("reads the natural forms of a day range as one date: and, or, a slash, through, weekdays", () => {
      for (const text of [
        "on 11 and 12 Nov", "Nov 11 and 12", "on 11 or 12 Nov", "Nov 11 or 12", "from Tuesday 11 to Wednesday 12 Nov",
        "between Tuesday 11 and Wednesday 12 Nov", "overnight on 11/12 Nov", "Nov 11/12", "11 / 12 Nov", "11 through 12 Nov",
        "Nov 11 through 12", "11 thru 12 Nov", "from Friday 7 to Monday 10 Nov", "From Monday 2 to Sunday 8 Nov",
        "between Monday 2 and Sunday 8 Nov", "Tue 11 to Wed 12 Nov", "Tues. 11 to Weds 12 Nov", "Thursday, 13 to Friday, 14 Nov",
        "from Friday the 7th to Monday the 10th of November", "TUESDAY 11 to WEDNESDAY 12 NOV", "Nov 11 to Wednesday 12",
        "13 and 14 Oct", "Oct 13 and 14",
        // A spaced dash after the month joins the days at the end of a clause.
        `Oct 13 ${EN} 14.`, `Oct 13 ${EN} 14, the pace`, "Oct 13 - 14 2026", `Oct 13 ${EN} 14`,
      ]) expect(read(text), text).toEqual([]);
      expect(raws("From Monday 2 to Sunday 8 Nov, the trial grew 15% in 26 weeks.")).toEqual(["15%", "26"]);
    });

    it("keeps a count after a day, a multiplier, days out of order and a weekday before a count", () => {
      expect(raws(`Oct 2 - 12 samples were tested`)).toEqual(["12"]);
      expect(raws(`Oct 2 ${EN} 12 samples were tested`)).toEqual(["12"]);
      expect(raws("Oct 13 to 14 bn records")).toEqual(["14 bn"]);
      expect(raws("Oct 13 to 14bn")).toEqual(["14bn"]);
      expect(raws("Oct 13 and 14 million")).toEqual(["14 million"]);
      expect(raws("11/12")).toEqual(["11", "12"]);
      expect(raws("3 and 4 samples")).toEqual(["3", "4"]);
      expect(raws("Monday 2 samples")).toEqual(["2"]);
      expect(raws("Wednesday 12 to 14 samples")).toEqual(["12", "14"]);
      expect(raws("12 or 11 Nov")).toEqual(["12"]);
      expect(raws("from Friday 10 to Monday 7 Nov")).toEqual(["10"]);
    });

    it("joins two days of a month-first range by a word, a slash or a spaced dash only after between or at the end of a clause", () => {
      expect(raws("The study opened on Oct 3 and 12 days later it closed.")).toEqual(["12"]);
      expect(raws("Two were added on Nov 4 and 12 more on Nov 6.")).toEqual(["12"]);
      expect(raws("On Nov 11 or 12 labs may report.")).toEqual(["12"]);
      expect(raws("Reported Oct 3 through 19 days after the trial.")).toEqual(["19"]);
      expect(raws("Oct 3 thru 19 samples")).toEqual(["19"]);
      expect(raws("Released Nov 11/12 hours later.")).toEqual(["12"]);
      expect(raws("Mar 3 and 10 more")).toEqual(["10"]);
      for (const text of ["between Oct 3 and 4", "between Oct 3 and 4 samples were tested", "on Nov 11 and 12.", "Nov 11/12, Taipei", "Nov 11 or 12",
        "Nov 11 or 12; then", "Nov 11 through 12 2026", "Nov 11 and 12 Taipei time", "Nov 11/12 UTC", "Nov 11 thru 12)"]) {
        expect(read(text), text).toEqual([]);
      }
    });
  });

  describe("numbers written as words (words: true)", () => {
    it("reads none without the option", () => {
      expect(numbersIn("three hosts and twenty-one victims, one flaw, Ninety, twelve million, a thousand")).toEqual([]);
    });

    it("reads two to twenty, the tens, compounds and one, a or an before a multiplier, each marked as a word", () => {
      const tokens = numbersIn("three hosts and twenty-one victims, one flaw, Ninety, twelve million, a thousand, one hundred, two hundred",
        { words: true });
      expect(tokens.map((n) => [n.raw, n.value, n.word])).toEqual([
        ["3", 3, true], ["21", 21, true], ["90", 90, true], ["12 million", 12_000_000, true], ["1 thousand", 1000, true],
        ["1 hundred", 100, true], ["2 hundred", 200, true]]);
    });

    it("reads a digit number as not a word, beside a word number of the same value", () => {
      expect(numbersIn("12 hosts and twelve flaws", { words: true }).map((n) => [n.raw, n.word])).toEqual([["12", false], ["12", true]]);
    });

    it("reads the compound with a space, a hyphen or a hyphen character, in any case", () => {
      expect(raws(`twenty one, Twenty-One, thirty${HYPHEN}two, forty${NB_HYPHEN}five`, true)).toEqual(["21", "21", "32", "45"]);
    });

    it("does not read one on its own, a before another word, or a word that only starts like a number", () => {
      expect(raws("one flaw, a flaw, an issue, tenacious, fiftieth, threefold", true)).toEqual([]);
    });

    it("does not read an ordinal such as twenty-first, but reads a duration such as twenty-second", () => {
      expect(raws("the twenty-first century and the thirty-fifth president", true)).toEqual([]);
      expect(raws("a twenty-second clip", true)).toEqual(["20"]);
    });

    it("marks an approximation before a number word", () => {
      expect(numbersIn("about twelve hosts", { words: true })[0]).toMatchObject({ raw: "12", value: 12, approx: true, word: true });
    });

    it("ignores a private-use character in the input, which it uses itself to mark a word number", () => {
      expect(numbersIn(`${WORD_MARK}5 apples`)).toMatchObject([{ raw: "5", word: false }]);
    });
  });
});

describe("numberMatches", () => {
  it("matches a number at our number's decimal places", () => {
    const [exact] = numbersIn("1,400");
    expect(numberMatches(exact!, 1400)).toBe(true);
    expect(numberMatches(exact!, 1393)).toBe(false);
    const [share] = numbersIn("0.15");
    expect(numberMatches(share!, 0.145)).toBe(true);
    expect(numberMatches(share!, 0.144)).toBe(false);
    const [ratio] = numbersIn("5.2 times");
    expect(numberMatches(ratio!, 5.2498)).toBe(true);
    expect(numberMatches(ratio!, 5.25)).toBe(false);
    const [big] = numbersIn("4.5 million");
    expect(numberMatches(big!, 4_460_000)).toBe(true);
    expect(numberMatches(big!, 4_440_000)).toBe(false);
  });

  it("matches at our number's last non-zero digit after an approximation word", () => {
    const [about] = numbersIn("about 1,400");
    expect(numberMatches(about!, 1393)).toBe(true);
    expect(numberMatches(about!, 1449)).toBe(true);
    expect(numberMatches(about!, 1450)).toBe(false);
    expect(numberMatches(about!, 1349)).toBe(false);
    const [round] = numbersIn("over 12,000,000");
    expect(numberMatches(round!, 11_600_000)).toBe(true);
    expect(numberMatches(round!, 11_400_000)).toBe(false);
  });

  it("matches the magnitude of a source figure", () => {
    const [about] = numbersIn("about 1,400");
    expect(numberMatches(about!, -1393)).toBe(true);
  });

  it("matches a word number by its digits", () => {
    const [twelve] = numbersIn("twelve hosts", { words: true });
    expect(numberMatches(twelve!, 12)).toBe(true);
    expect(numberMatches(twelve!, 13)).toBe(false);
  });
});

// ── Quotes ───────────────────────────────────────────────────────────────────────────────────────

describe("foldQuote and quoteInText", () => {
  it("foldQuote lower-cases, removes quote marks and apostrophes, and collapses white space", () => {
    expect(foldQuote("“It’s  a   “test”.”")).toBe("its a test.");
    expect(foldQuote("  Hello,\n\tWorld  ")).toBe("hello, world");
    expect(foldQuote("")).toBe("");
  });

  it("foldQuote removes invisible format characters such as a soft hyphen and a zero-width space", () => {
    expect(foldQuote(`re${SHY}sult and zero${ZWSP}width`)).toBe("result and zerowidth");
  });

  it("foldQuote reads every dash and the minus sign as a hyphen", () => {
    expect(foldQuote(`state${EM}of${EN}the${HYPHEN}art${MINUS}tool`)).toBe("state-of-the-art-tool");
  });

  it("foldQuote reads compatibility forms as plain letters", () => {
    expect(foldQuote(`${FI_LIGATURE}nding, ＡＩ`)).toBe("finding, ai");
  });

  it("quoteInText finds a quote in the seen text whatever its quote marks, case, spacing or dashes", () => {
    const seen = `The authors wrote: “Our model didn’t fail ${EM}  it  learned.” They added more.`;
    expect(quoteInText("Our model didn't fail - it learned.", seen)).toBe(true);
    expect(quoteInText(`OUR MODEL DIDN’T FAIL ${EN} IT LEARNED`, seen)).toBe(true);
    expect(quoteInText("Our model did fail", seen)).toBe(false);
    expect(quoteInText("it learned our model", seen)).toBe(false);
  });

  it("quoteInText is false for an empty quote, or one of nothing but quote marks and white space", () => {
    expect(quoteInText("", "anything")).toBe(false);
    expect(quoteInText("“”", "anything")).toBe(false);
    expect(quoteInText("   ", "anything")).toBe(false);
  });

  it("quoteInText finds nothing in empty seen text", () => {
    expect(quoteInText("a quote", "")).toBe(false);
  });
});

// ── Word lists ───────────────────────────────────────────────────────────────────────────────────

describe("escapeRegExp", () => {
  it("makes any text safe to put in a pattern, the u flag included", () => {
    const all = ".*+?^${}()|[]\\/";
    expect(new RegExp(`^${escapeRegExp(all)}$`, "u").test(all)).toBe(true);
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
    expect(escapeRegExp("well-known")).toBe("well-known");
  });
});

describe("wordRe and wordsIn", () => {
  it("wordRe matches an entry as whole words in any case", () => {
    const re = wordRe("rare");
    expect(re.test("A rare find")).toBe(true);
    expect(re.test("RARE.")).toBe(true);
    expect(re.test("(rare)")).toBe(true);
    expect(re.test("rarely")).toBe(false);
    expect(re.test("a rare2 find")).toBe(false);
    expect(re.test("3rare")).toBe(false);
  });

  it("wordRe lets white space and any hyphen stand for each other between the words of an entry", () => {
    const re = wordRe("game-changing");
    for (const text of ["game-changing", "game changing", "Game  Changing", "game\nchanging", `game${HYPHEN}changing`, `game${NB_HYPHEN}changing`]) {
      expect(re.test(text), text).toBe(true);
    }
    expect(re.test("gamechanging")).toBe(false);
    expect(wordRe("step change").test("a step-change in speed")).toBe(true);
  });

  it("wordRe reads an apostrophe of either kind", () => {
    expect(wordRe("Hubble's law").test("Hubble’s law holds")).toBe(true);
    expect(wordRe("Hubble’s law").test("hubble's law holds")).toBe(true);
  });

  it("wordRe escapes the characters of an entry that mean something in a pattern", () => {
    expect(wordRe("a.b").test("a.b")).toBe(true);
    expect(wordRe("a.b").test("axb")).toBe(false);
    expect(wordRe("C++").test("the C++ language")).toBe(true);
  });

  it("wordRe reads Unicode letters as letters", () => {
    expect(wordRe("café").test("a Café au lait")).toBe(true);
    expect(wordRe("café").test("cafés")).toBe(false);
  });

  it("wordRe matches a plural of the last word only with plurals: true", () => {
    expect(wordRe("enzyme").test("two enzymes")).toBe(false);
    for (const [entry, text] of [
      ["enzyme", "two enzymes"], ["antibody", "many antibodies"], ["antibody", "one antibody"], ["box", "three boxes"],
      ["match", "five matches"], ["study", "ten studies"], ["key", "two keys"], ["novel protein", "novel proteins"], ["bus", "buses"],
    ] as const) {
      expect(wordRe(entry, { plurals: true }).test(text), `${entry} in ${text}`).toBe(true);
    }
    expect(wordRe("key", { plurals: true }).test("two keies")).toBe(false);
    expect(wordRe("novel protein", { plurals: true }).test("novels protein")).toBe(false);
    expect(wordRe("bus", { plurals: true }).test("buss")).toBe(false);
  });

  it("wordRe has no g flag, so one regex can be tested again and again, and serves every call", () => {
    const re = wordRe("rare");
    expect([re.test("rare"), re.test("rare"), re.test("rare")]).toEqual([true, true, true]);
    expect(re.global).toBe(false);
    expect(wordRe("rare")).toBe(re);
    expect(wordRe("rare", { plurals: true })).not.toBe(re);
  });

  it("wordsIn returns the entries the text holds, as listed and in list order", () => {
    expect(wordsIn("A revolutionary, game changing result", ["game-changing", "novel", "revolutionary"])).toEqual(["game-changing", "revolutionary"]);
    expect(wordsIn("Novel enzymes", ["novel enzyme"], { plurals: true })).toEqual(["novel enzyme"]);
    expect(wordsIn("Novel enzymes", ["novel enzyme"])).toEqual([]);
    expect(wordsIn("", ["novel"])).toEqual([]);
    expect(wordsIn("anything", [])).toEqual([]);
  });
});

describe("maskPhrases", () => {
  it("replaces every occurrence of a phrase, as listed, with as many spaces", () => {
    const text = "Nobel Prize winners, a Nobel Prize in physics, and a nobel prize";
    const masked = maskPhrases(text, ["Nobel Prize"]);
    expect(masked).toBe(`${" ".repeat(11)} winners, a ${" ".repeat(11)} in physics, and a nobel prize`);
    expect(masked).toHaveLength(text.length);
  });

  it("masks the longest phrase first, so a phrase inside a longer one leaves no end behind", () => {
    const text = "the Breakthrough Devices Program";
    expect(maskPhrases(text, ["Breakthrough Device", "Breakthrough Devices Program"]).trim()).toBe("the");
    expect(maskPhrases(text, ["Breakthrough Devices Program", "Breakthrough Device"]).trim()).toBe("the");
  });

  it("leaves an empty phrase alone, and never reorders the list it is given", () => {
    const phrases = ["ab", "abcd", ""];
    expect(maskPhrases("abcd ab", phrases)).toBe("       ");
    expect(phrases).toEqual(["ab", "abcd", ""]);
    expect(maskPhrases("nothing to mask", [""])).toBe("nothing to mask");
    expect(maskPhrases("x", [])).toBe("x");
  });
});

// ── Anthropic ────────────────────────────────────────────────────────────────────────────────────

describe("mentionsAnthropicText", () => {
  it("is true for the whole words Anthropic and Claude in any case, in a URL too", () => {
    for (const text of [
      "Anthropic released a model", "built with Claude", "CLAUDE wrote it", "anthropic's lab", "Claude’s answer", "an Anthropic-built tool",
      "https://www.anthropic.com/research/x", "https://claude.ai/chat", "claude_code did it", "(Claude)",
    ]) expect(mentionsAnthropicText(text), text).toBe(true);
  });

  it("is false for other words that hold them", () => {
    for (const text of ["Claudette agreed", "anthropology of belief", "misanthropic", "Claudius ruled", "the Anthropocene epoch", "nonclaude"]) {
      expect(mentionsAnthropicText(text), text).toBe(false);
    }
  });

  it("is false for Mythos and Glasswing, which the spec drops: mythos is an ordinary word of theology", () => {
    expect(mentionsAnthropicText("The myth of Mythos, and a Glasswing butterfly")).toBe(false);
  });

  it("is false for a person called Claude, in any case, with hyphens, underscores or no diacritics", () => {
    expect(CLAUDE_PEOPLE.length).toBeGreaterThan(0);
    for (const person of CLAUDE_PEOPLE) {
      for (const text of [`${person} was a pioneer.`, person.toUpperCase(), person.replaceAll(" ", "_"), person.replaceAll(" ", "-"), `${person}'s work`,
        `${person}\n`, person.normalize("NFD").replace(/\p{M}/gu, "")]) {
        expect(mentionsAnthropicText(text), text).toBe(false);
      }
    }
    expect(mentionsAnthropicText("Claude   Shannon")).toBe(false);
    expect(mentionsAnthropicText("Claude Levi Strauss")).toBe(false);
  });

  it("is false for the phrases of cosmology and philosophy, and for their plurals", () => {
    expect(ANTHROPIC_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of ANTHROPIC_PHRASES) {
      for (const text of [`The ${phrase} is debated`, phrase.toUpperCase(), phrase.replaceAll(" ", "-"), phrase.replaceAll(" ", "_")]) {
        expect(mentionsAnthropicText(text), text).toBe(false);
      }
    }
    expect(mentionsAnthropicText("the strong and weak anthropic principles")).toBe(false);
  });

  it("is true when a person or a phrase is named and the company or model is too", () => {
    expect(mentionsAnthropicText("Claude Shannon would have liked what Claude did.")).toBe(true);
    expect(mentionsAnthropicText("The anthropic principle, said Anthropic.")).toBe(true);
    expect(mentionsAnthropicText("Claude Monetization plans")).toBe(true);
  });

  it("is false for no text", () => {
    expect(mentionsAnthropicText("")).toBe(false);
    expect(mentionsAnthropicText(null)).toBe(false);
    expect(mentionsAnthropicText(undefined)).toBe(false);
  });
});
