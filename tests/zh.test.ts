// Tests for lib/zh.ts, the Chinese checks (SPEC §4.1 "Chinese characters", §4.11 terms-zh.json and hype-words.json, §4.12
// ZH_PARITY, ZH_TRADITIONAL, ZH_AVOID, ZH_TERMS, ZH_ENGLISH_ONCE, ZH_NO_DASH and ZH_HYPE). Each list check loops over the real
// config: every `avoid` term, `allow_in` string, `simplified_only` and `japanese_only` character and Chinese hype word. The
// spec's named cases come next, then one test for each decision lib/zh.ts pins. Every Chinese literal here is Taiwan usage and
// this file passes the checks it tests (the last block reads it); a bad character, term or dash is built from its code points or
// taken from the config. New for this project; Cyber has no Chinese pass.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, type LoadedConfig } from "@/lib/config";
import type { AvoidTerm, FixedTerm, HypeWordsFile } from "@/lib/schema/config";
import { FIELD_INFO, FIELDS } from "@/lib/vocab";
import {
  avoidHits, countZhChars, dashHits, englishMonthNumbers, englishNumberWordKeys, englishOnceProblems, fixedApplies,
  fixedEntriesFor, fixedMissing, fixedOccurrences, hypeHits, LANDMARK_ONLY_ZH, nameRuns, parityGaps, parityNumbers,
  parityProblems, traditionalHits, urlsIn, latinWordsMissing, wordsOutsideLinks, type OnceTerm,
} from "@/lib/zh";
import { ZH_ENGLISH, zhText } from "../fixtures/src/world-zh";
import { zhDraft } from "../fixtures/src/zh-drafts";
import { zhContext } from "../fixtures/src/zh-inputs";
import { EDITION_NAMES } from "../fixtures/src/world";
import {
  oldAvoidHits, oldEnglishMonthNumbers, oldLatinWordsMissing, oldNameRuns, oldParityNumbers, oldParityProblems, oldUrlsIn, oldWordsOutsideLinks,
} from "./helpers/zh-reference";

const ROOT = path.resolve(__dirname, "..");
const CONFIG: LoadedConfig = loadConfig(path.join(ROOT, "config"));
const TERMS = CONFIG.termsZh;
const FIXED = TERMS.fixed;
const HYPE = CONFIG.hypeWords;
const chr = (...cps: number[]): string => String.fromCodePoint(...cps);
const EM = chr(0x2014);
const EN = chr(0x2013);

const fixedEntry = (en: string): FixedTerm => {
  const entry = FIXED.find((f) => f.en === en);
  if (!entry) throw new Error(`terms-zh.json has no fixed entry ${en}`);
  return entry;
};
const avoidByTaiwan = (taiwan: string): AvoidTerm => {
  const entry = TERMS.avoid.find((a) => a.taiwan === taiwan);
  if (!entry) throw new Error(`terms-zh.json has no avoid entry for ${taiwan}`);
  return entry;
};
const keys = (text: string): string[] => parityNumbers(text).map((n) => n.key);
const gapKeys = (en: string | string[], zh: string | string[]): { missing: string[]; extra: string[] } => {
  const g = parityGaps(en, zh);
  return { missing: g.missing.map((n) => n.key), extra: g.extra.map((n) => n.key) };
};
const NO_GAPS = { missing: [], extra: [] };
const missingTerms = (en: string | string[], zh: string | string[], field: (typeof FIELDS)[number] | null = null): string[] =>
  fixedMissing(FIXED, en, zh, field).map((e) => e.en);

// ── countZhChars (§4.1) ──────────────────────────────────────────────────────────────────────────

describe("countZhChars", () => {
  it("counts the spec's examples: AlphaFold 3 is 2 and a term with its bracketed English is 7", () => {
    expect(countZhChars("AlphaFold 3")).toBe(2);
    expect(countZhChars("蛋白質摺疊（protein folding）")).toBe(7);
  });

  it("counts each Han character 1, a supplementary-plane one too", () => {
    expect(countZhChars("研究團隊")).toBe(4);
    expect(countZhChars(chr(0x20000) + "字")).toBe(2);
    expect(countZhChars(chr(0x2f00))).toBe(1);
  });

  it("counts a run of Latin letters and digits 1, and a Han character ends the run", () => {
    expect(countZhChars("AI模型AI")).toBe(4);
    expect(countZhChars("CO2")).toBe(1);
    expect(countZhChars("café")).toBe(1);
    expect(countZhChars("２０２６年")).toBe(2);
  });

  it("ends a run at punctuation, so a decimal and a number with commas are two runs each", () => {
    expect(countZhChars("8.4")).toBe(2);
    expect(countZhChars("2,000")).toBe(2);
    expect(countZhChars("a b")).toBe(2);
  });

  it("counts punctuation, symbols and spaces 0", () => {
    expect(countZhChars("")).toBe(0);
    expect(countZhChars("，。！？「」（） \n+©%")).toBe(0);
  });

  it("counts a letter or number of another script 1 each", () => {
    expect(countZhChars("αβ")).toBe(2);
    expect(countZhChars("ゲノム")).toBe(3);
    expect(countZhChars("Ⅻ")).toBe(1);
  });

  it("lets a combining mark or a format character neither count nor end a run", () => {
    expect(countZhChars(`e${chr(0x301)}x`)).toBe(1);
    expect(countZhChars(`ab${chr(0x200b)}cd`)).toBe(1);
    expect(countZhChars(chr(0x301))).toBe(0);
  });
});

// ── parityNumbers (§4.12 ZH_PARITY) ──────────────────────────────────────────────────────────────

describe("parityNumbers", () => {
  it("reads every run of digits, glued to letters or not, with what it wrote and where", () => {
    expect(parityNumbers("the 12th study")).toEqual([{ value: "12", percent: false, key: "12", text: "12", index: 4 }]);
    expect(parityNumbers("COVID-19")).toEqual([{ value: "19", percent: false, key: "19", text: "19", index: 6 }]);
    expect(keys("Cas9 and H2O")).toEqual(["9", "2"]);
  });

  it("reads years and dates in either language, repeats included, in order", () => {
    expect(keys("2026 年 8 月 31 日")).toEqual(["2026", "8", "31"]);
    expect(keys("31 August 2026")).toEqual(["31", "2026"]);
    expect(keys("2 and 2")).toEqual(["2", "2"]);
  });

  it("drops thousands separators and keeps decimals, as exact decimal strings", () => {
    expect(keys("$700,000")).toEqual(["700000"]);
    expect(keys("1,234,567")).toEqual(["1234567"]);
    expect(keys("1,2345")).toEqual(["1", "2345"]);
    expect(keys("1,234,5678")).toEqual(["1234", "5678"]);
    expect(keys("8.4 and 0.05")).toEqual(["8.4", "0.05"]);
    expect(keys("007, 0.50 and 1.0")).toEqual(["7", "0.5", "1"]);
  });

  it("reads full-width digits, a full-width comma or point between them, and ％ as ASCII", () => {
    expect(keys("１２３")).toEqual(["123"]);
    expect(keys("１，０００")).toEqual(["1000"]);
    expect(parityNumbers("３．５％")).toEqual([{ value: "3.5", percent: true, key: "3.5%", text: "３．５％", index: 0 }]);
    expect(keys("3.5％")).toEqual(["3.5%"]);
  });

  it("multiplies by thousand, million or billion after a space or a hyphen, in any case", () => {
    expect(parityNumbers("2.5 million")).toEqual([{ value: "2500000", percent: false, key: "2500000", text: "2.5 million", index: 0 }]);
    expect(keys("2.5-million")).toEqual(["2500000"]);
    expect(keys("2.5 Million")).toEqual(["2500000"]);
    expect(keys("1.1 million")).toEqual(["1100000"]);
    expect(keys("4 thousand and 3 billion")).toEqual(["4000", "3000000000"]);
    expect(keys(`5${chr(0xa0)}million`)).toEqual(["5000000"]);
  });

  it("needs a word boundary after the multiplier and a gap before it", () => {
    expect(keys("5millionth")).toEqual(["5"]);
    expect(keys("5 millions")).toEqual(["5"]);
    expect(keys("5 millionth")).toEqual(["5"]);
    expect(keys("5million")).toEqual(["5"]);
  });

  it("multiplies by 萬 and 億, touching the number or after a space: 70 萬 is 700000", () => {
    expect(parityNumbers("70 萬美元")).toEqual([{ value: "700000", percent: false, key: "700000", text: "70 萬", index: 0 }]);
    expect(keys("70萬")).toEqual(["700000"]);
    expect(keys("250 萬")).toEqual(["2500000"]);
    expect(keys("1.2 億")).toEqual(["120000000"]);
    expect(keys("0.5 萬")).toEqual(["5000"]);
  });

  it("does not read 千, trillion or 兆, nor Chinese numerals", () => {
    expect(keys("5 千瓦")).toEqual(["5"]);
    expect(keys("2 trillion")).toEqual(["2"]);
    expect(keys("2 兆")).toEqual(["2"]);
    expect(keys("三名學生、兩個、一百")).toEqual([]);
  });

  it("makes a percentage of a number with %, per cent or percent after it", () => {
    expect(keys("3.5%")).toEqual(["3.5%"]);
    expect(keys("3.5 %")).toEqual(["3.5%"]);
    expect(parityNumbers("30 percent")).toEqual([{ value: "30", percent: true, key: "30%", text: "30 percent", index: 0 }]);
    expect(keys("30 per cent")).toEqual(["30%"]);
    expect(keys("30-percent")).toEqual(["30%"]);
    expect(keys("30 Percent")).toEqual(["30%"]);
  });

  it("reads 3 percentage points and 3 百分點 as a plain 3 (a word boundary follows percent)", () => {
    expect(keys("3 percentage points")).toEqual(["3"]);
    expect(keys("3 個百分點")).toEqual(["3"]);
    expect(keys("3 percenter")).toEqual(["3"]);
  });

  it("makes a percentage of a number after 百分之, which its text then holds", () => {
    expect(parityNumbers("約百分之 30")).toEqual([{ value: "30", percent: true, key: "30%", text: "百分之 30", index: 1 }]);
    expect(keys("百分之30")).toEqual(["30%"]);
    expect(keys("百分之三十")).toEqual([]);
  });

  it("reads nothing in a text without digits", () => {
    expect(parityNumbers("")).toEqual([]);
    expect(parityNumbers("沒有數字")).toEqual([]);
  });
});

describe("englishMonthNumbers", () => {
  it("reads full month names and the three-letter forms monthShort() writes", () => {
    expect(englishMonthNumbers("February 2024")).toEqual([2]);
    expect(englishMonthNumbers("31 Aug")).toEqual([8]);
    expect(englishMonthNumbers("Sep 3 and Dec 12")).toEqual([9, 12]);
    expect(englishMonthNumbers("Sept 3")).toEqual([]);
  });

  it("gives each month once, in order of appearance", () => {
    expect(englishMonthNumbers("March, then January, then March")).toEqual([3, 1]);
  });

  it("reads only capitalised whole words", () => {
    expect(englishMonthNumbers("in may or march")).toEqual([]);
    expect(englishMonthNumbers("the Mayor said Marching")).toEqual([]);
    expect(englishMonthNumbers("NotMay 5 and SuperJune")).toEqual([]);
  });

  it("reads May inside a sentence as the month", () => {
    expect(englishMonthNumbers("published in May")).toEqual([5]);
  });

  it("reads May as a sentence's first word only before a day or a year", () => {
    expect(englishMonthNumbers("May it last.")).toEqual([]);
    expect(englishMonthNumbers("May 5 was the day.")).toEqual([5]);
    expect(englishMonthNumbers("May 2024 brought rain.")).toEqual([5]);
    expect(englishMonthNumbers("It ended. May it last.")).toEqual([]);
    expect(englishMonthNumbers("It ended. May 5 was the day.")).toEqual([5]);
    expect(englishMonthNumbers("He asked? “May it last?”")).toEqual([]);
    expect(englishMonthNumbers("He said “It ends.” May it last.")).toEqual([]);
    expect(englishMonthNumbers("He said (it ends.) May it last.")).toEqual([]);
    expect(englishMonthNumbers(`May${chr(0xa0)}5 was the day.`)).toEqual([5]);
    expect(englishMonthNumbers('"It ends." (May it last.)')).toEqual([]);
    expect(englishMonthNumbers("First line\nMay it last.")).toEqual([]);
    expect(englishMonthNumbers("Done! May we go")).toEqual([]);
  });
});

describe("englishNumberWordKeys", () => {
  it("frees the digit of each number word from one to ten, in any case, as whole words", () => {
    expect(englishNumberWordKeys("three students")).toEqual(["3"]);
    expect(englishNumberWordKeys("One of them")).toEqual(["1"]);
    expect(englishNumberWordKeys("ten and two")).toEqual(["10", "2"]);
    expect(englishNumberWordKeys("eleven, someone, often")).toEqual([]);
  });

  it("frees the percentage too when percent or per cent follows", () => {
    expect(englishNumberWordKeys("three percent")).toEqual(["3", "3%"]);
    expect(englishNumberWordKeys("three per cent")).toEqual(["3", "3%"]);
    expect(englishNumberWordKeys("three percentage points")).toEqual(["3"]);
  });
});

describe("parityGaps", () => {
  it("passes the spec's cases", () => {
    expect(gapKeys("three students", "3 名學生")).toEqual(NO_GAPS);
    expect(gapKeys("three students", "三名學生")).toEqual(NO_GAPS);
    expect(gapKeys("one of them", "其中一個")).toEqual(NO_GAPS);
    expect(gapKeys("February 2024", "2024 年 2 月")).toEqual(NO_GAPS);
    expect(gapKeys("published in May", "5 月發表")).toEqual(NO_GAPS);
    expect(gapKeys("31 Aug", "8 月 31 日")).toEqual(NO_GAPS);
    expect(gapKeys("$700,000", "70 萬美元")).toEqual(NO_GAPS);
    expect(gapKeys("2.5 million", "250 萬")).toEqual(NO_GAPS);
  });

  it("passes dates in either English order against the Chinese date", () => {
    expect(gapKeys("31 August 2026", "2026 年 8 月 31 日")).toEqual(NO_GAPS);
    expect(gapKeys("Aug 31", "8 月 31 日")).toEqual(NO_GAPS);
  });

  it("fails a changed digit both ways", () => {
    expect(gapKeys("4 students", "5 名學生")).toEqual({ missing: ["4"], extra: ["5"] });
  });

  it("judges a term's name and definition together, and fails a changed digit in a definition", () => {
    expect(gapKeys(["CRISPR", "A tool from 2012"], ["CRISPR", "2012 年的工具"])).toEqual(NO_GAPS);
    expect(gapKeys(["CRISPR", "A tool from 2012"], ["CRISPR", "2013 年的工具"])).toEqual({ missing: ["2012"], extra: ["2013"] });
  });

  it("keeps a percentage a percentage", () => {
    expect(gapKeys("3.5%", "3.5")).toEqual({ missing: ["3.5%"], extra: ["3.5"] });
    expect(gapKeys("30 percent", "百分之 30")).toEqual(NO_GAPS);
    expect(gapKeys("30 percent", "百分之三十")).toEqual({ missing: ["30%"], extra: [] });
    expect(gapKeys("3 percentage points", "3 個百分點")).toEqual(NO_GAPS);
    expect(gapKeys("three percent", "3%")).toEqual(NO_GAPS);
  });

  it("frees a sentence-initial May only next to a day or a year", () => {
    expect(gapKeys("May it last.", "5 月")).toEqual({ missing: [], extra: ["5"] });
    expect(gapKeys("May 5 it began.", "5 月 5 日")).toEqual(NO_GAPS);
  });

  it("compares sets: a repeat needs no repeat, and each gap is named once", () => {
    expect(gapKeys("2 cells and 2 more", "2 個")).toEqual(NO_GAPS);
    expect(gapKeys("one", "7 與 7")).toEqual({ missing: [], extra: ["7"] });
    expect(gapKeys("4 cells and 4 more", "沒有")).toEqual({ missing: ["4"], extra: [] });
    expect(parityGaps("4 cells", "5 個")).toEqual({
      missing: [{ value: "4", percent: false, key: "4", text: "4", index: 0 }],
      extra: [{ value: "5", percent: false, key: "5", text: "5", index: 0 }],
    });
  });

  it("reads trillion and 兆 as their own digits only", () => {
    expect(gapKeys("2 trillion", "2 兆")).toEqual(NO_GAPS);
  });
});

describe("urlsIn", () => {
  it("finds a URL with a scheme, a www. host and a host with no scheme, as written and in order", () => {
    expect(urlsIn("見 https://example.org/a 頁")).toEqual(["https://example.org/a"]);
    expect(urlsIn("見 ftp://files.example.org 頁")).toEqual(["ftp://files.example.org"]);
    expect(urlsIn("見 www.example.org 頁")).toEqual(["www.example.org"]);
    expect(urlsIn("見 www.例子.tw 頁")).toEqual(["www.例子.tw"]);
    expect(urlsIn("見 nature.com 與 doi.org/10.1/x 頁")).toEqual(["nature.com", "doi.org/10.1/x"]);
  });

  it("names a host inside a longer URL once, and a repeated URL once", () => {
    expect(urlsIn("https://example.org/a 與 example.org/b 與 https://example.org/a")).toEqual(["https://example.org/a", "example.org/b"]);
    expect(urlsIn("https://www.example.org")).toEqual(["https://www.example.org"]);
  });

  it("finds none in numbers, abbreviations, an e-mail host or plain text", () => {
    expect(urlsIn("3.5 倍、e.g 與 AlphaFold 3")).toEqual([]);
    expect(urlsIn("a@example.org")).toEqual([]);
    expect(urlsIn("x.ab2 與 example.co-op")).toEqual([]);
    expect(urlsIn("")).toEqual([]);
  });

  it("reads a dotted name such as Node.js as a host (a Chinese string holds no URL, so it should say Node 的 js)", () => {
    expect(urlsIn("用 Node.js 寫成")).toEqual(["Node.js"]);
  });
});

describe("latinWordsMissing", () => {
  it("names the Latin words of the Chinese that the English lacks, each once, as written", () => {
    expect(latinWordsMissing("predicted", "AlphaFold 預測 AlphaFold")).toEqual(["AlphaFold"]);
    expect(latinWordsMissing("AlphaFold predicted", "AlphaFold 預測")).toEqual([]);
  });

  it("ignores case, reads COVID-19 as the word COVID and digits alone as no word", () => {
    expect(latinWordsMissing("alphafold", "ALPHAFOLD")).toEqual([]);
    expect(latinWordsMissing("COVID-19", "COVID 19 疫情")).toEqual([]);
    expect(latinWordsMissing("CO2", "CO2 與 2024 年")).toEqual([]);
    expect(latinWordsMissing("", "CO2")).toEqual(["CO2"]);
  });

  describe("a bracketed run", () => {
    const TERMS = ["protein folding", "peer review", "CRISPR"];

    it("is skipped when it is the English name of a term it is given, in full-width brackets only", () => {
      expect(latinWordsMissing("folds", "蛋白質摺疊（protein folding）", TERMS)).toEqual([]);
      expect(latinWordsMissing("folds", "蛋白質摺疊(protein folding)", TERMS)).toEqual(["protein", "folding"]);
      expect(latinWordsMissing("folds", "同儕審查（peer review）與 CRISPR", TERMS)).toEqual(["CRISPR"]);
      expect(latinWordsMissing("folds", "蛋白質（protein folding）與審查（peer review）", TERMS)).toEqual([]);
    });

    it("matches a term whatever its case and spacing, as ZH_ENGLISH_ONCE does: spaces inside the brackets, a run of spaces, a no-break or ideographic space", () => {
      for (const run of ["Protein Folding", "PROTEIN FOLDING", " protein folding ", "protein   folding", `protein${String.fromCharCode(0xa0)}folding`, `protein${String.fromCharCode(0x3000)}folding`, "protein\nfolding"]) {
        expect(latinWordsMissing("folds", `蛋白質摺疊（${run}）`, TERMS), JSON.stringify(run)).toEqual([]);
      }
      expect(latinWordsMissing("folds", "基因編輯（crispr）", TERMS)).toEqual([]);
    });

    it("is read like the text around it when it is no term: its Latin words must be in the English, and only the missing ones are named", () => {
      expect(latinWordsMissing("folds", "它會摺疊（quantum computing）。", TERMS)).toEqual(["quantum", "computing"]);
      expect(latinWordsMissing("It is a quantum leap", "它會摺疊（quantum computing）。", TERMS)).toEqual(["computing"]);
      expect(latinWordsMissing("Quantum computing is new", "它會摺疊（quantum computing）。", TERMS)).toEqual([]);
      expect(latinWordsMissing("A Foo bar", "（Foo bar）", [])).toEqual([]);
      // Each bracket is judged on its own, and the same invented word is named once.
      expect(latinWordsMissing("folds", "（protein folding）（quantum）與（quantum）", TERMS)).toEqual(["quantum"]);
    });

    it("is no term when it holds more or less than the whole name: a part of a term, a term with a word added, two terms, a joined name", () => {
      expect(latinWordsMissing("folds", "（protein）", TERMS)).toEqual(["protein"]);
      expect(latinWordsMissing("folds", "（folding）", TERMS)).toEqual(["folding"]);
      expect(latinWordsMissing("folds", "（protein folding in cells）", TERMS)).toEqual(["protein", "folding", "in", "cells"]);
      expect(latinWordsMissing("folds", "（protein folding, peer review）", TERMS)).toEqual(["protein", "folding", "peer", "review"]);
      expect(latinWordsMissing("folds", "（proteinfolding）", TERMS)).toEqual(["proteinfolding"]);
      expect(latinWordsMissing("folds", "（protein-folding）", TERMS)).toEqual(["protein", "folding"]);
    });

    it("is read like the text around it when no term is given, and when the terms are other terms", () => {
      expect(latinWordsMissing("folds", "蛋白質摺疊（protein folding）")).toEqual(["protein", "folding"]);
      expect(latinWordsMissing("folds", "蛋白質摺疊（protein folding）", [])).toEqual(["protein", "folding"]);
      expect(latinWordsMissing("folds", "蛋白質摺疊（protein folding）", ["peer review"])).toEqual(["protein", "folding"]);
      expect(latinWordsMissing("folds", "蛋白質（protein）與摺疊（folding）", ["protein folding"])).toEqual(["protein", "folding"]);
    });

    it("leaves the words on either side of a skipped bracket apart, so they are read as two words and not one", () => {
      expect(latinWordsMissing("foo bar", "foo（protein folding）bar", TERMS)).toEqual([]);
      expect(latinWordsMissing("foo bar", "foo（quantum）bar", TERMS)).toEqual(["quantum"]);
    });

    it("frees only the bracket: the same words outside brackets are Latin words the English lacks", () => {
      expect(latinWordsMissing("folds", "蛋白質摺疊 protein folding（protein folding）", TERMS)).toEqual(["protein", "folding"]);
      expect(latinWordsMissing("folds", "蛋白質摺疊（protein folding）protein", TERMS)).toEqual(["protein"]);
    });

    it("reads an array of English strings as one unit, so a term's words in any of them free nothing more than a bracket does", () => {
      expect(latinWordsMissing(["peer review", "folds"], ["同儕審查（peer review）", "摺疊（protein folding）"], ["protein folding"])).toEqual([]);
      expect(latinWordsMissing(["a tool", "folds"], ["工具（peer review）", "摺疊（protein folding）"], ["protein folding"])).toEqual(["peer", "review"]);
    });
  });

  it("reads an array as one unit on each side", () => {
    expect(latinWordsMissing(["Cas9", "a tool"], ["Cas9", "工具"])).toEqual([]);
  });
});

describe("parityProblems", () => {
  it("runs the numbers, the URLs and the Latin words together", () => {
    const p = parityProblems("3 cells", "4 個細胞 Foo，見 example.org");
    expect(p.missing.map((n) => n.key)).toEqual(["3"]);
    expect(p.extra.map((n) => n.key)).toEqual(["4"]);
    expect(p.urls).toEqual(["example.org"]);
    expect(p.latin).toEqual(["Foo", "example", "org"]);
  });

  it("finds nothing in a faithful translation", () => {
    expect(parityProblems(["AlphaFold 3", "Released in May 2024 by 2 labs"], ["AlphaFold 3", "2024 年 5 月由 2 個實驗室發布"])).toEqual({
      missing: [], extra: [], urls: [], latin: [],
    });
  });

  it("passes the terms on to the Latin words: a bracket that is one of them is free, any other bracketed Latin word is named", () => {
    expect(parityProblems("3 cells", "3 個細胞（cell biology）", ["cell biology"]).latin).toEqual([]);
    expect(parityProblems("3 cells", "3 個細胞（cell biology）", ["cell"]).latin).toEqual(["cell", "biology"]);
    expect(parityProblems("3 cells", "3 個細胞（cell biology）").latin).toEqual(["cell", "biology"]);
    expect(parityProblems("3 cells", "3 個細胞（cell biology）", ["cell biology"])).toEqual({ missing: [], extra: [], urls: [], latin: [] });
  });
});

// ── ZH_TRADITIONAL ───────────────────────────────────────────────────────────────────────────────

describe("traditionalHits", () => {
  it("catches every simplified_only character of the config", () => {
    expect(CONFIG.index.simplifiedOnly.size).toBeGreaterThan(6000);
    const missed = [...CONFIG.index.simplifiedOnly].filter((c) => {
      const hits = traditionalHits(`研究${c}結果`, CONFIG.index);
      return !(hits.length === 1 && hits[0]!.char === c && hits[0]!.index === 2 && hits[0]!.list === "simplified_only");
    });
    expect(missed).toEqual([]);
  });

  it("catches every japanese_only character of the config", () => {
    expect(CONFIG.index.japaneseOnly.size).toBeGreaterThan(100);
    const missed = [...CONFIG.index.japaneseOnly].filter((c) => {
      const hits = traditionalHits(`研究${c}結果`, CONFIG.index);
      return !(hits.length === 1 && hits[0]!.char === c && hits[0]!.list === "japanese_only");
    });
    expect(missed).toEqual([]);
  });

  it("passes the Taiwan forms the config writes and the vocabulary's labels", () => {
    const taiwan = [...FIXED.map((f) => f.zh), ...TERMS.avoid.flatMap((a) => [a.taiwan, ...a.allow_in]), ...HYPE.zh,
      ...FIELDS.map((f) => FIELD_INFO[f].zh)];
    expect(taiwan.filter((t) => traditionalHits(t, CONFIG.index).length > 0)).toEqual([]);
  });

  it("gives each hit in order with its UTF-16 index, a supplementary-plane character counting two", () => {
    const simplified = [...CONFIG.index.simplifiedOnly][0]!;
    const japanese = [...CONFIG.index.japaneseOnly][0]!;
    expect(traditionalHits(`${chr(0x20000)}${simplified}與${japanese}`, CONFIG.index)).toEqual([
      { char: simplified, index: 2, list: "simplified_only" },
      { char: japanese, index: 2 + simplified.length + 1, list: "japanese_only" },
    ]);
  });

  it("uses the sets it is given, and names a character in both lists once, as simplified_only", () => {
    const index = { simplifiedOnly: new Set(["甲", "丙"]), japaneseOnly: new Set(["乙", "丙"]) };
    expect(traditionalHits("甲乙丙", index)).toEqual([
      { char: "甲", index: 0, list: "simplified_only" },
      { char: "乙", index: 1, list: "japanese_only" },
      { char: "丙", index: 2, list: "simplified_only" },
    ]);
  });
});

// ── ZH_AVOID ─────────────────────────────────────────────────────────────────────────────────────

describe("avoidHits", () => {
  it("catches every avoid term of the config in a sentence and names its Taiwan form", () => {
    expect(TERMS.avoid.length).toBeGreaterThanOrEqual(13);
    const missed = TERMS.avoid.filter((a) => {
      const hits = avoidHits(`我們用${a.term}做`, TERMS);
      return !(hits.length === 1 && hits[0]!.term === a.term && hits[0]!.taiwan === a.taiwan && hits[0]!.index === 3);
    });
    expect(missed).toEqual([]);
  });

  it("passes every allow_in string and every fixed translation of the config", () => {
    const allowed = TERMS.avoid.flatMap((a) => a.allow_in).filter((s) => avoidHits(`我們用${s}做`, TERMS).length > 0);
    expect(allowed).toEqual([]);
    expect(FIXED.filter((f) => avoidHits(`我們用${f.zh}做`, TERMS).length > 0).map((f) => f.zh)).toEqual([]);
  });

  it("passes 演算法, 納米比亞 and 電視頻道, and fails the mainland term for 演算法 on its own", () => {
    expect(avoidHits("演算法", TERMS)).toEqual([]);
    expect(avoidHits("納米比亞", TERMS)).toEqual([]);
    expect(avoidHits("電視頻道", TERMS)).toEqual([]);
    const algorithm = avoidByTaiwan("演算法");
    expect(avoidHits(algorithm.term, TERMS)).toEqual([{ term: algorithm.term, taiwan: "演算法", index: 0 }]);
    expect(avoidHits(`演算法與${algorithm.term}`, TERMS)).toEqual([{ term: algorithm.term, taiwan: "演算法", index: 4 }]);
  });

  it("masks every fixed translation, of any entry, before it looks", () => {
    const terms = { avoid: [{ term: "甲乙", taiwan: "丁", allow_in: [] }], fixed: [{ en: "x", zh: "丙甲乙", fields: [], except: [] }] };
    expect(avoidHits("丙甲乙", terms)).toEqual([]);
    expect(avoidHits("丙甲乙甲乙", terms)).toEqual([{ term: "甲乙", taiwan: "丁", index: 3 }]);
  });

  it("masks every allow_in string, of any entry, before it looks", () => {
    const terms = {
      avoid: [{ term: "甲乙", taiwan: "丁", allow_in: [] }, { term: "戊", taiwan: "己", allow_in: ["丙甲乙"] }], fixed: [],
    };
    expect(avoidHits("丙甲乙", terms)).toEqual([]);
  });

  it("reads the longest term first, so a term inside a longer one is not reported twice", () => {
    const terms = { avoid: [{ term: "甲乙", taiwan: "丁", allow_in: [] }, { term: "甲乙丙", taiwan: "戊", allow_in: [] }], fixed: [] };
    expect(avoidHits("甲乙丙", terms)).toEqual([{ term: "甲乙丙", taiwan: "戊", index: 0 }]);
  });

  it("reports every occurrence, in order of position", () => {
    const terms = { avoid: [{ term: "甲", taiwan: "丁", allow_in: [] }, { term: "乙乙", taiwan: "戊", allow_in: [] }], fixed: [] };
    expect(avoidHits("甲乙乙丙甲", terms)).toEqual([
      { term: "甲", taiwan: "丁", index: 0 },
      { term: "乙乙", taiwan: "戊", index: 1 },
      { term: "甲", taiwan: "丁", index: 4 },
    ]);
    expect(avoidHits("乙乙乙", terms)).toEqual([{ term: "乙乙", taiwan: "戊", index: 0 }]);
  });
});

// ── ZH_NO_DASH ───────────────────────────────────────────────────────────────────────────────────

describe("dashHits", () => {
  const cps = (text: string): string[] => dashHits(text).map((h) => h.codePoint);

  it("fails the spec's list: a doubled and a single em dash, U+2015, U+2E3A, U+FE58 and U+FF0D", () => {
    expect(cps(`研究${EM}${EM}結果`)).toEqual(["U+2014", "U+2014"]);
    expect(dashHits(`研究${EM}結果`)).toEqual([{ char: EM, index: 2, codePoint: "U+2014", kind: "dash" }]);
    for (const cp of [0x2015, 0x2e3a, 0xfe58, 0xff0d]) expect(cps(`研究${chr(cp)}結果`)).toEqual([`U+${cp.toString(16).toUpperCase()}`]);
  });

  it("fails every other dash punctuation, the forms NFKC makes a hyphen-minus included", () => {
    for (const cp of [0x2012, 0x2e3b, 0x301c, 0x30a0, 0xfe63, 0x58a]) {
      expect(cps(`甲${chr(cp)}乙`)).toEqual([`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`]);
    }
  });

  it("fails the box-drawing lines U+2500 and U+2501 as kind box, and no other box character", () => {
    expect(dashHits(`甲${chr(0x2500)}乙${chr(0x2501)}`)).toEqual([
      { char: chr(0x2500), index: 1, codePoint: "U+2500", kind: "box" },
      { char: chr(0x2501), index: 3, codePoint: "U+2501", kind: "box" },
    ]);
    expect(dashHits(`甲${chr(0x2502)}乙`)).toEqual([]);
  });

  it("passes the hyphen-minus, the hyphens U+2010 and U+2011 and the minus sign", () => {
    expect(dashHits(`COVID-19、Hartree${chr(0x2010)}Fock、a${chr(0x2011)}b、${chr(0x2212)}5`)).toEqual([]);
  });

  it("passes an en dash between digits only", () => {
    expect(dashHits(`1990${EN}2000`)).toEqual([]);
    expect(dashHits(`１${EN}２`)).toEqual([]);
    expect(cps(`a${EN}b`)).toEqual(["U+2013"]);
    expect(cps(`研究${EN}結果`)).toEqual(["U+2013"]);
    expect(cps(`5${EN}a`)).toEqual(["U+2013"]);
    expect(cps(`a${EN}5`)).toEqual(["U+2013"]);
    expect(cps(`${EN}5`)).toEqual(["U+2013"]);
    expect(cps(`5${EN}`)).toEqual(["U+2013"]);
    expect(cps(`5 ${EN} 6`)).toEqual(["U+2013"]);
  });

  it("gives UTF-16 indexes, a supplementary-plane character counting two", () => {
    expect(dashHits(`${chr(0x20000)}${EM}`)).toEqual([{ char: EM, index: 2, codePoint: "U+2014", kind: "dash" }]);
  });
});

// ── ZH_HYPE ──────────────────────────────────────────────────────────────────────────────────────

describe("hypeHits", () => {
  it("catches every Chinese hype word of the config, matched anywhere", () => {
    expect(HYPE.zh.length).toBeGreaterThan(0);
    const missed = HYPE.zh.filter((w) => {
      const hits = hypeHits(`這是${w}的成果`, HYPE, { landmark: false });
      return !(hits.length === 1 && hits[0]!.word === w && hits[0]!.index === 2);
    });
    expect(missed).toEqual([]);
  });

  it("lets only 突破 through in a Landmark's text, the word hype-words.json lists last", () => {
    expect(HYPE.zh.at(-1)).toBe(LANDMARK_ONLY_ZH);
    expect(LANDMARK_ONLY_ZH).toBe("突破");
    expect(hypeHits("重大突破", HYPE, { landmark: true })).toEqual([]);
    const others = HYPE.zh.filter((w) => w !== LANDMARK_ONLY_ZH && hypeHits(`這是${w}的成果`, HYPE, { landmark: true }).length !== 1);
    expect(others).toEqual([]);
  });

  it("passes 突破獎委員會 and fails 重大突破 outside a Landmark", () => {
    expect(hypeHits("突破獎委員會", HYPE, { landmark: false })).toEqual([]);
    expect(hypeHits("重大突破", HYPE, { landmark: false })).toEqual([{ word: "突破", index: 2 }]);
    expect(hypeHits("突破獎委員會稱之為突破", HYPE, { landmark: false })).toEqual([{ word: "突破", index: 9 }]);
  });

  it("masks each name's zh that is not null, and only those", () => {
    const hype: Pick<HypeWordsFile, "zh" | "names"> = { zh: ["甲乙"], names: [{ en: "A", zh: "甲乙丙" }, { en: "B", zh: null }] };
    expect(hypeHits("甲乙丙", hype, { landmark: false })).toEqual([]);
    expect(hypeHits("甲乙丁", hype, { landmark: false })).toEqual([{ word: "甲乙", index: 0 }]);
  });

  it("reports every occurrence in order of position", () => {
    const hype = { zh: ["乙", "甲"], names: [] };
    expect(hypeHits("甲乙甲", hype, { landmark: false })).toEqual([
      { word: "甲", index: 0 }, { word: "乙", index: 1 }, { word: "甲", index: 2 },
    ]);
  });
});

// ── Names kept in English and fixed terms (ZH_TERMS) ─────────────────────────────────────────────

describe("nameRuns", () => {
  const texts = (english: string): string[] => nameRuns(english).map((r) => r.text);

  it("finds a run of capitalised words, with where it starts and ends", () => {
    expect(nameRuns("stored in the Protein Data Bank")).toEqual([{ text: "Protein Data Bank", start: 14, end: 31 }]);
  });

  it("joins capitalised words over of, the, for, de and von", () => {
    expect(texts("in the Journal of the AMS today")).toEqual(["Journal of the AMS"]);
    expect(texts("at the Institut de Physique and the Max Planck Institute for Physics")).toEqual(["Institut de Physique", "Max Planck Institute for Physics"]);
    expect(texts("Ludwig von Mises")).toEqual(["Ludwig von Mises"]);
  });

  it("ends a run at and, so two names stay two", () => {
    expect(texts("Stanford University and the Protein Data Bank")).toEqual(["Stanford University", "Protein Data Bank"]);
    expect(texts("Stanford and Harvard")).toEqual([]);
  });

  it("does not end a run at a joiner with no capitalised word after it", () => {
    expect(texts("the University of the north")).toEqual([]);
    expect(texts("Data Bank of the world")).toEqual(["Data Bank"]);
    expect(texts("Data Bank, of the World")).toEqual(["Data Bank"]);
  });

  it("skips a sentence-initial article but keeps one inside a sentence", () => {
    expect(texts("The Protein Data Bank grew.")).toEqual(["Protein Data Bank"]);
    expect(texts("It grew. A New Method came")).toEqual(["New Method"]);
    expect(texts("An Old Rule")).toEqual(["Old Rule"]);
    expect(texts("in The Lancet today")).toEqual(["The Lancet"]);
  });

  it("starts a run at a sentence-initial word that is not an article", () => {
    expect(texts("Stanford University said so.")).toEqual(["Stanford University"]);
  });

  it("lets only spaces stand between a run's words, and ends it at a number or a mark", () => {
    expect(texts(`Protein  Data${chr(0xa0)}Bank`)).toEqual([`Protein  Data${chr(0xa0)}Bank`]);
    expect(texts("Protein, Data")).toEqual([]);
    expect(texts("Protein\nData")).toEqual([]);
    expect(texts("AlphaFold 3 Server")).toEqual([]);
  });

  it("reads a hyphenated or apostrophised word as one word", () => {
    expect(texts("the Hartree-Fock Theory")).toEqual(["Hartree-Fock Theory"]);
    expect(texts(`the Hartree${chr(0x2010)}Fock Theory`)).toEqual([`Hartree${chr(0x2010)}Fock Theory`]);
    expect(texts("at King's College")).toEqual(["King's College"]);
    expect(texts("at the École Normale Supérieure")).toEqual(["École Normale Supérieure"]);
  });

  it("finds no run in a text of one capitalised word or none", () => {
    expect(nameRuns("AlphaFold predicted it")).toEqual([]);
    expect(nameRuns("")).toEqual([]);
  });
});

describe("fixedOccurrences", () => {
  it("finds the entry outside its except phrases, whose plurals are left out too", () => {
    expect(fixedOccurrences(fixedEntry("model"), "a model organism and a Model, business model, role models, to model")).toEqual([
      { start: 23, end: 28, text: "Model" },
    ]);
    expect(fixedOccurrences(fixedEntry("scroll"), "the Dead Sea Scrolls and two scrolls").map((o) => o.text)).toEqual(["scrolls"]);
  });

  it("reads a regular plural and a hyphen as a space", () => {
    expect(fixedOccurrences(fixedEntry("algorithm"), "two algorithms").map((o) => o.text)).toEqual(["algorithms"]);
    expect(fixedOccurrences(fixedEntry("protein folding"), "protein-folding work").map((o) => o.text)).toEqual(["protein-folding"]);
  });

  it("reads an entry in capitals, such as AI, only in capitals; any other in any case", () => {
    expect(fixedOccurrences(fixedEntry("AI"), "The AI model").map((o) => o.text)).toEqual(["AI"]);
    expect(fixedOccurrences(fixedEntry("AI"), "ai and Ai Weiwei")).toEqual([]);
    expect(fixedOccurrences(fixedEntry("algorithm"), "ALGORITHM").map((o) => o.text)).toEqual(["ALGORITHM"]);
  });

  it("reads whole words only", () => {
    expect(fixedOccurrences(fixedEntry("model"), "modelling and remodel")).toEqual([]);
  });
});

describe("fixedApplies and fixedEntriesFor", () => {
  it("applies an entry with fields only in a finding of one of them", () => {
    const plasma = fixedEntry("plasma");
    expect(fixedApplies(plasma, "a hot plasma", "physics")).toBe(true);
    expect(fixedApplies(plasma, "a hot plasma", "biology")).toBe(false);
    expect(fixedApplies(plasma, "a hot plasma", null)).toBe(false);
    expect(fixedApplies(plasma, "blood plasma", "physics")).toBe(false);
  });

  it("applies an entry whose fields is [] everywhere, null included", () => {
    expect(fixedApplies(fixedEntry("algorithm"), "an algorithm", null)).toBe(true);
    expect(fixedApplies(fixedEntry("algorithm"), "a method", null)).toBe(false);
  });

  it("lists the entries that apply, in list order", () => {
    expect(fixedEntriesFor(FIXED, "The algorithm of protein folding", null).map((e) => e.en)).toEqual(["algorithm", "protein", "protein folding"]);
    expect(fixedEntriesFor(FIXED, "a hot plasma", "physics").map((e) => e.en)).toEqual(["plasma"]);
    expect(fixedEntriesFor(FIXED, "a hot plasma", "biology")).toEqual([]);
  });

  it("ignores names kept in English, since the Chinese does not exist yet", () => {
    expect(fixedEntriesFor(FIXED, "the Protein Data Bank", null).map((e) => e.en)).toEqual(["protein"]);
  });
});

describe("fixedMissing", () => {
  it("passes the spec's cases", () => {
    expect(missingTerms("The blood plasma sample", "血漿樣本", "chemistry")).toEqual([]);
    expect(missingTerms("The plasma sample", "血漿樣本", "biology")).toEqual([]);
    expect(missingTerms("a new business model", "新的商業模式")).toEqual([]);
    expect(missingTerms("stored in the Protein Data Bank", "存入 Protein Data Bank")).toEqual([]);
  });

  it("fails algorithm without 演算法, and passes it with", () => {
    expect(missingTerms("an algorithm", "一種方法")).toEqual(["algorithm"]);
    expect(missingTerms("an algorithm", "一種演算法")).toEqual([]);
  });

  it("fails plasma in a physics finding written as 血漿", () => {
    expect(missingTerms("The plasma sample", "血漿樣本", "physics")).toEqual(["plasma"]);
    expect(missingTerms("The plasma sample", "電漿樣本", "physics")).toEqual([]);
  });

  it("skips a name only where the Chinese keeps the whole name as written", () => {
    expect(missingTerms("stored in the Protein Data Bank", "存入 Protein 資料庫")).toEqual(["protein"]);
    expect(missingTerms("stored in the Protein Data Bank", "存入 protein data bank")).toEqual(["protein"]);
    expect(missingTerms("stored in the Protein Data Bank", "存入蛋白質資料庫")).toEqual([]);
    expect(missingTerms("the Protein Data Bank holds protein", "Protein Data Bank 收錄")).toEqual(["protein"]);
  });

  it("reads each English string of a unit on its own, and the Chinese of the unit together", () => {
    expect(missingTerms(["protein", "folding"], "蛋白質，摺疊")).toEqual([]);
    expect(missingTerms("protein\nfolding", "蛋白質，摺疊")).toEqual(["protein folding"]);
    expect(missingTerms(["algorithm", "a protein"], ["演算法", "蛋白質"])).toEqual([]);
    expect(missingTerms(["algorithm", "a protein"], ["演算法", "一種"])).toEqual(["protein"]);
  });

  it("checks only the entries it is given, in list order", () => {
    const entries = [fixedEntry("protein"), fixedEntry("algorithm")];
    expect(fixedMissing(entries, "an algorithm and a protein", "沒有", null).map((e) => e.en)).toEqual(["protein", "algorithm"]);
  });
});

// ── ZH_ENGLISH_ONCE ──────────────────────────────────────────────────────────────────────────────

describe("englishOnceProblems", () => {
  const FOLDING: OnceTerm = { en: "protein folding", zh: "蛋白質摺疊" };
  const PROTEIN: OnceTerm = { en: "protein", zh: "蛋白質" };
  const CRISPR: OnceTerm = { en: "CRISPR", zh: "CRISPR" };

  it("passes a first use bracketed and later uses bare", () => {
    expect(englishOnceProblems({ parts: ["蛋白質摺疊（protein folding）很重要", "蛋白質摺疊再次出現"], title: "蛋白質摺疊", terms: [FOLDING] })).toEqual([]);
  });

  it("needs no brackets when the term's Chinese is its English, such as CRISPR", () => {
    expect(englishOnceProblems({ parts: ["CRISPR 工具", "CRISPR 再用"], title: "CRISPR", terms: [CRISPR] })).toEqual([]);
    expect(englishOnceProblems({ parts: ["crispr 工具"], title: "", terms: [{ en: "CRISPR", zh: "crispr" }] })).toEqual([]);
    // white space around either side is not part of the word: " crispr " (the Chinese as the context gives it) is the English
    expect(englishOnceProblems({ parts: ["用 crispr 工具"], title: "", terms: [{ en: "CRISPR", zh: " crispr " }] })).toEqual([]);
    expect(englishOnceProblems({ parts: ["用 crispr 工具"], title: "", terms: [{ en: " CRISPR ", zh: " crispr " }] })).toEqual([]);
  });

  it("fails a first use without the full-width bracketed English, naming its part", () => {
    expect(englishOnceProblems({ parts: ["前言", "蛋白質摺疊很重要"], title: "", terms: [FOLDING] })).toEqual([
      { kind: "first_unbracketed", term: FOLDING, part: 1 },
    ]);
    expect(englishOnceProblems({ parts: ["蛋白質摺疊(protein folding)"], title: "", terms: [FOLDING] })).toEqual([
      { kind: "first_unbracketed", term: FOLDING, part: 0 },
    ]);
    expect(englishOnceProblems({ parts: ["蛋白質摺疊 （protein folding）"], title: "", terms: [FOLDING] })).toEqual([
      { kind: "first_unbracketed", term: FOLDING, part: 0 },
    ]);
    expect(englishOnceProblems({ parts: ["蛋白質摺疊（protein）"], title: "", terms: [FOLDING] })).toEqual([
      { kind: "first_unbracketed", term: FOLDING, part: 0 },
    ]);
  });

  it("ignores case and the spaces inside the brackets", () => {
    expect(englishOnceProblems({ parts: ["蛋白質摺疊（ Protein  Folding ）"], title: "", terms: [FOLDING] })).toEqual([]);
  });

  it("fails a later use that is bracketed, in either width, naming its part", () => {
    expect(englishOnceProblems({ parts: ["蛋白質摺疊（protein folding）", "又是蛋白質摺疊（protein folding）"], title: "", terms: [FOLDING] })).toEqual([
      { kind: "later_bracketed", term: FOLDING, part: 1 },
    ]);
    expect(englishOnceProblems({ parts: ["蛋白質摺疊（protein folding）與蛋白質摺疊(protein folding)"], title: "", terms: [FOLDING] })).toEqual([
      { kind: "later_bracketed", term: FOLDING, part: 0 },
    ]);
    expect(englishOnceProblems({ parts: ["CRISPR 工具", "CRISPR（CRISPR）"], title: "", terms: [CRISPR] })).toEqual([
      { kind: "later_bracketed", term: CRISPR, part: 1 },
    ]);
  });

  it("fails a title that carries the term's bracketed English, in either width", () => {
    const parts = ["蛋白質摺疊（protein folding）"];
    expect(englishOnceProblems({ parts, title: "蛋白質摺疊（protein folding）的新解", terms: [FOLDING] })).toEqual([
      { kind: "title_bracketed", term: FOLDING },
    ]);
    expect(englishOnceProblems({ parts, title: "蛋白質摺疊(Protein Folding)", terms: [FOLDING] })).toEqual([
      { kind: "title_bracketed", term: FOLDING },
    ]);
  });

  it("fails a term the explainer never uses, unless a part was removed", () => {
    expect(englishOnceProblems({ parts: ["沒有"], title: "", terms: [FOLDING] })).toEqual([{ kind: "unused", term: FOLDING }]);
    expect(englishOnceProblems({ parts: ["沒有"], title: "", terms: [FOLDING], partRemoved: true })).toEqual([]);
  });

  it("lets the first remaining use go without the English when a part was removed, but not a later bracketed one", () => {
    expect(englishOnceProblems({ parts: ["蛋白質摺疊很重要"], title: "", terms: [FOLDING], partRemoved: true })).toEqual([]);
    expect(englishOnceProblems({ parts: ["蛋白質摺疊", "蛋白質摺疊（protein folding）"], title: "", terms: [FOLDING], partRemoved: true })).toEqual([
      { kind: "later_bracketed", term: FOLDING, part: 1 },
    ]);
  });

  it("reads the longest term first, so 蛋白質 inside 蛋白質摺疊 counts only for 蛋白質摺疊", () => {
    expect(englishOnceProblems({ parts: ["蛋白質摺疊（protein folding）"], title: "", terms: [PROTEIN, FOLDING] })).toEqual([
      { kind: "unused", term: PROTEIN },
    ]);
    expect(englishOnceProblems({
      parts: ["蛋白質摺疊（protein folding）", "蛋白質（protein）由胺基酸組成"], title: "", terms: [PROTEIN, FOLDING],
    })).toEqual([]);
  });

  it("counts no use that overlaps one a longer term already took, whichever the terms' order", () => {
    const first: OnceTerm = { en: "a", zh: "蛋白質摺" };
    const second: OnceTerm = { en: "b", zh: "摺疊酶" };
    expect(englishOnceProblems({ parts: ["蛋白質摺疊酶"], title: "", terms: [first, second] })).toEqual([
      { kind: "first_unbracketed", term: first, part: 0 }, { kind: "unused", term: second },
    ]);
    const third: OnceTerm = { en: "c", zh: "質摺疊" };
    expect(englishOnceProblems({ parts: ["蛋白質摺疊酶"], title: "", terms: [third, second, first] })).toEqual([
      { kind: "unused", term: third }, { kind: "unused", term: second }, { kind: "first_unbracketed", term: first, part: 0 },
    ]);
  });

  it("finds the next use of a Chinese that overlaps itself one character on, even when the one before it overlapped a longer term's", () => {
    const longer: OnceTerm = { en: "l", zh: "白白摺" };
    const doubled: OnceTerm = { en: "d", zh: "摺摺" };
    // 摺摺 stands at 2 (its first character is the longer term's) and at 3 (free): the second is the use.
    expect(englishOnceProblems({ parts: ["白白摺摺摺"], title: "", terms: [longer, doubled] })).toEqual([
      { kind: "first_unbracketed", term: longer, part: 0 }, { kind: "first_unbracketed", term: doubled, part: 0 },
    ]);
    // Alone, the first 摺摺 is the use and the one that overlaps it is none: one use, so no later bracket is read.
    expect(englishOnceProblems({ parts: ["摺摺摺（d）"], title: "", terms: [doubled] })).toEqual([{ kind: "first_unbracketed", term: doubled, part: 0 }]);
  });

  it("reports a term whose Chinese is empty as unused, each such term for itself", () => {
    const other: OnceTerm = { en: "y", zh: "" };
    const empty: OnceTerm = { en: "x", zh: "" };
    expect(englishOnceProblems({ parts: ["文字"], title: "", terms: [empty, other] })).toEqual([
      { kind: "unused", term: empty }, { kind: "unused", term: other },
    ]);
  });

  it("names the part of each use, however many parts come before it", () => {
    const cell: OnceTerm = { en: "cell", zh: "細胞" };
    expect(englishOnceProblems({ parts: ["前言", "背景", "研究細胞", "結論"], title: "", terms: [cell] })).toEqual([
      { kind: "first_unbracketed", term: cell, part: 2 },
    ]);
  });

  describe("terms that share one Chinese (the config's pairs such as dataset and data set) are one group", () => {
    const DATASET: OnceTerm = { en: "dataset", zh: "資料集" };
    const DATA_SET: OnceTerm = { en: "data set", zh: "資料集" };
    const CORPUS: OnceTerm = { en: "corpus", zh: "資料集" };
    const once = (parts: string[], terms: OnceTerm[], title = "", partRemoved = false) => englishOnceProblems({ parts, title, terms, partRemoved });

    it("is met by the English of any one of them after the first use, whichever the terms' order", () => {
      for (const terms of [[DATASET, DATA_SET], [DATA_SET, DATASET], [DATASET, DATA_SET, CORPUS]]) {
        expect(once(["資料集（dataset）很大"], terms)).toEqual([]);
        expect(once(["資料集（data set）很大"], terms)).toEqual([]);
        expect(once(["前言", "資料集（ Data  Set ）很大", "資料集再次出現"], terms)).toEqual([]);
      }
    });

    it("fails once, for the group's first term, when the first use has no English after it, whichever the terms' order", () => {
      expect(once(["前言", "資料集很大"], [DATASET, DATA_SET])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 1 }]);
      expect(once(["前言", "資料集很大"], [DATA_SET, DATASET])).toEqual([{ kind: "first_unbracketed", term: DATA_SET, part: 1 }]);
      expect(once(["資料集很大"], [DATASET, DATA_SET, CORPUS])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 0 }]);
    });

    it("fails once when the first use is followed by the English of a term that is not in the group, or by half-width brackets", () => {
      expect(once(["資料集（corpus）很大"], [DATASET, DATA_SET])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 0 }]);
      expect(once(["資料集（dataset set）很大"], [DATASET, DATA_SET])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 0 }]);
      expect(once(["資料集(dataset)很大"], [DATASET, DATA_SET])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 0 }]);
      // a bracket of one width on one side and the other on the other is no full-width bracket either
      expect(once(["資料集(dataset）很大"], [DATASET, DATA_SET])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 0 }]);
      expect(once(["資料集（dataset)很大"], [DATASET, DATA_SET])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 0 }]);
      expect(once(["資料集 （dataset）很大"], [DATASET, DATA_SET])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 0 }]);
    });

    it("judges only the first use for that: a later use with the English of one of them is a different problem, and a bare later use none", () => {
      expect(once(["資料集（dataset）", "資料集再次出現"], [DATASET, DATA_SET])).toEqual([]);
      expect(once(["資料集很大", "資料集（dataset）"], [DATASET, DATA_SET])).toEqual([
        { kind: "first_unbracketed", term: DATASET, part: 0 }, { kind: "later_bracketed", term: DATASET, part: 1 },
      ]);
    });

    it("fails once, for its first term, when the Chinese explainer never uses it, unless a part was removed", () => {
      expect(once(["沒有"], [DATASET, DATA_SET])).toEqual([{ kind: "unused", term: DATASET }]);
      expect(once(["沒有"], [DATA_SET, DATASET, CORPUS])).toEqual([{ kind: "unused", term: DATA_SET }]);
      expect(once(["沒有"], [DATASET, DATA_SET], "", true)).toEqual([]);
    });

    it("refuses a later use that carries the English of any of them, in either width, for the term whose English it is", () => {
      expect(once(["資料集（dataset）", "又是資料集（data set）"], [DATASET, DATA_SET])).toEqual([{ kind: "later_bracketed", term: DATA_SET, part: 1 }]);
      expect(once(["資料集（data set）與資料集(dataset)與資料集（corpus）"], [DATASET, DATA_SET])).toEqual([{ kind: "later_bracketed", term: DATASET, part: 0 }]);
      expect(once(["資料集（dataset）與資料集（dataset）與資料集(data set)"], [DATASET, DATA_SET, CORPUS])).toEqual([
        { kind: "later_bracketed", term: DATASET, part: 0 }, { kind: "later_bracketed", term: DATA_SET, part: 0 },
      ]);
    });

    it("needs no brackets when the shared Chinese is the English of any one of them, such as CRISPR", () => {
      const CRISPR_SYSTEM: OnceTerm = { en: "CRISPR system", zh: "CRISPR" };
      expect(once(["CRISPR 工具"], [CRISPR_SYSTEM, CRISPR])).toEqual([]);
      expect(once(["CRISPR 工具"], [CRISPR, CRISPR_SYSTEM])).toEqual([]);
      expect(once(["CRISPR 工具", "CRISPR（CRISPR system）"], [CRISPR, CRISPR_SYSTEM])).toEqual([{ kind: "later_bracketed", term: CRISPR_SYSTEM, part: 1 }]);
      expect(once(["CRISPR 工具"], [CRISPR_SYSTEM])).toEqual([{ kind: "first_unbracketed", term: CRISPR_SYSTEM, part: 0 }]);
    });

    it("judges the title for each of them: each bracketed English in it is its own problem", () => {
      expect(once(["資料集（dataset）"], [DATASET, DATA_SET], "資料集（dataset）與（data set）")).toEqual([
        { kind: "title_bracketed", term: DATASET }, { kind: "title_bracketed", term: DATA_SET },
      ]);
      expect(once(["資料集（dataset）"], [DATASET, DATA_SET], "資料集（Data Set）")).toEqual([{ kind: "title_bracketed", term: DATA_SET }]);
    });

    it("keeps the order of terms: a group's problems stand where its first term does, and the title problem of each term after its own", () => {
      const PROTEIN_T: OnceTerm = { en: "protein", zh: "蛋白質" };
      expect(once(["蛋白質與資料集"], [DATASET, PROTEIN_T, DATA_SET], "資料集（data set）")).toEqual([
        { kind: "first_unbracketed", term: DATASET, part: 0 },
        { kind: "first_unbracketed", term: PROTEIN_T, part: 0 },
        { kind: "title_bracketed", term: DATA_SET },
      ]);
    });

    it("counts the uses of a group once, longest Chinese first, next to a group of a longer or shorter Chinese", () => {
      const SET_OF_DATA: OnceTerm = { en: "dataset collection", zh: "資料集合" };
      // 資料集合 holds no 資料集 and 資料集 holds no 資料集合: each is its own group; the longer of two that nest takes its use whole.
      expect(once(["資料集合（dataset collection）與資料集（dataset）"], [DATASET, DATA_SET, SET_OF_DATA])).toEqual([]);
      const DATA_WORD: OnceTerm = { en: "data", zh: "資料" };
      expect(once(["資料集（dataset）"], [DATA_WORD, DATASET, DATA_SET])).toEqual([{ kind: "unused", term: DATA_WORD }]);
      expect(once(["資料集（data set）與資料（data）"], [DATA_WORD, DATASET, DATA_SET])).toEqual([]);
    });

    it("holds a group of any size: the English of the third term meets it, and a later use that carries it is refused", () => {
      expect(once(["資料集（corpus）很大"], [DATASET, DATA_SET, CORPUS])).toEqual([]);
      expect(once(["資料集（dataset）", "資料集（corpus）"], [DATASET, DATA_SET, CORPUS])).toEqual([{ kind: "later_bracketed", term: CORPUS, part: 1 }]);
      expect(once(["資料集（dataset）", "資料集（corpus）"], [DATASET, DATA_SET])).toEqual([]);
    });

    it("reports one term listed twice once", () => {
      expect(once(["資料集很大"], [DATASET, DATASET])).toEqual([{ kind: "first_unbracketed", term: DATASET, part: 0 }]);
    });

    it("refuses a later bracket only where it follows the Chinese at once: a space or another character between them is no repeat", () => {
      expect(once(["資料集（dataset）", "資料集 （data set）與資料集，（dataset）與資料集(Data  Set)"], [DATASET, DATA_SET])).toEqual([
        { kind: "later_bracketed", term: DATA_SET, part: 1 },
      ]);
      expect(once(["資料集（dataset）", "資料集（ dataset ）"], [DATASET, DATA_SET])).toEqual([{ kind: "later_bracketed", term: DATASET, part: 1 }]);
      // a later use is refused the English in any mixture of the two widths
      expect(once(["資料集（dataset）", "資料集(dataset）與資料集（data set)"], [DATASET, DATA_SET])).toEqual([
        { kind: "later_bracketed", term: DATASET, part: 1 }, { kind: "later_bracketed", term: DATA_SET, part: 1 },
      ]);
    });

    it("stays linear in a long text with many uses and a large group: 100,000 characters and 30 terms of one Chinese in well under a second", () => {
      const members: OnceTerm[] = Array.from({ length: 30 }, (_, i) => ({ en: `term ${i}`, zh: "資" }));
      const started = performance.now();
      // Every use is followed by a bracket that holds none of their English; none of them is a repeat.
      expect(once(["資（x）".repeat(25_000)], members)).toEqual([{ kind: "first_unbracketed", term: members[0]!, part: 0 }]);
      // Every use is followed by the English of the 17th term (a space inside it is read as any white space): each is a repeat of that one.
      const repeats = once(["資（term 16）".repeat(10_000)], members);
      expect(repeats).toHaveLength(9_999);
      expect(repeats.every((p) => p.kind === "later_bracketed" && p.term === members[16] && p.part === 0)).toBe(true);
      // Every use is followed by an opening bracket and no more.
      expect(once(["資（".repeat(50_000)], members)).toEqual([{ kind: "first_unbracketed", term: members[0]!, part: 0 }]);
      expect(performance.now() - started).toBeLessThan(2000);
    });

    it("does not group a term with another that has the same English but another Chinese, nor two terms whose Chinese differs in case", () => {
      const OTHER: OnceTerm = { en: "dataset", zh: "數據集" };
      expect(once(["資料集（dataset）與數據集"], [DATASET, OTHER])).toEqual([{ kind: "first_unbracketed", term: OTHER, part: 0 }]);
      const lower: OnceTerm = { en: "x", zh: "abc" };
      const upper: OnceTerm = { en: "y", zh: "ABC" };
      expect(once(["abc ABC"], [lower, upper])).toEqual([
        { kind: "first_unbracketed", term: lower, part: 0 }, { kind: "first_unbracketed", term: upper, part: 0 },
      ]);
    });
  });

  it("gives the problems term by term in the order of terms", () => {
    expect(englishOnceProblems({ parts: ["蛋白質很重要", "蛋白質摺疊也是"], title: "", terms: [FOLDING, PROTEIN] })).toEqual([
      { kind: "first_unbracketed", term: FOLDING, part: 1 },
      { kind: "first_unbracketed", term: PROTEIN, part: 0 },
    ]);
  });
});

// ── Linear time (F-70) ───────────────────────────────────────────────────────────────────────────
// The Chinese pass is a model run that a hostile page may steer, so a string of megabytes must cost the ZH_PARITY checks what its length
// costs, never throw, and give the result it gave before on every text a reader could write (tests/helpers/zh-reference.ts holds the
// earlier functions; they are quadratic on these shapes and one overflows the engine's stack at 5 MB).

/** Runs `run` and fails when it takes `limitMs` or more. The limits are many times what the new code needs, and far below the earlier code. */
function within<T>(limitMs: number, run: () => T): T {
  const before = performance.now();
  const result = run();
  expect(performance.now() - before).toBeLessThan(limitMs);
  return result;
}

const SHORT_EN = "A short sentence.";
const BRACKET_TERMS = ["protein folding", "cell biology"];

/** The shapes of a hostile string, each made to a length: the ones that made the earlier functions quadratic, or overflow the stack, or allocate without end. */
const HOSTILE: [string, (n: number) => string][] = [
  ["a Latin run", (n) => `範例 ${"a".repeat(n)}。`],
  ["letters joined by hyphens", (n) => `範例 ${"a-".repeat(n / 2)}`],
  ["letters joined by dots", (n) => `範例 ${"a.".repeat(n / 2)}`],
  ["a long Latin word in brackets", (n) => `範例（${"a".repeat(n)}）`],
  ["a run of digits", (n) => `範例 ${"9".repeat(n)}。`],
  ["one link", (n) => `範例 https://example.org/${"k".repeat(n)}。`],
  ["Chinese text", (n) => "範".repeat(n)],
  ["opening brackets", (n) => "（".repeat(n)],
  ["closing brackets", (n) => "）".repeat(n)],
  ["bracketed words", (n) => "（a）".repeat(n / 3)],
  ["many equal numbers", (n) => "1 ".repeat(n / 2)],
  ["many different numbers", (n) => Array.from({ length: n / 7 }, (_, i) => String(1_000_000 + i)).join(" ")],
  ["numbers after 百分之", (n) => "百分之 5 ".repeat(n / 6)],
  ["thousands separators", (n) => `1${",000".repeat(n / 4)}`],
  ["decimals", (n) => "1.5 ".repeat(n / 4)],
  ["many equal links", (n) => "https://a.example/x ".repeat(n / 20)],
  ["many different links", (n) => Array.from({ length: n / 24 }, (_, i) => `https://a.example/${100_000 + i}`).join(" ")],
  ["many hosts with no scheme", (n) => "a.example.org ".repeat(n / 14)],
  ["many www hosts", (n) => "www.a.example ".repeat(n / 14)],
  ["many month names", (n) => "May 1 ".repeat(n / 6)],
  ["white space before a word", (n) => `${" ".repeat(n)}x${" ".repeat(10)}May`],
  ["capitals", (n) => "The A An ".repeat(n / 9)],
];

describe("linear time (F-70): ZH_PARITY's checks on a hostile string", () => {
  it.each(HOSTILE)("gives the result it gave before on %s of 3,000 characters, whichever language holds it", (_name, make) => {
    const text = make(3000);
    for (const terms of [[], BRACKET_TERMS]) {
      expect(parityProblems(SHORT_EN, text, terms)).toEqual(oldParityProblems(SHORT_EN, text, terms));
      expect(parityProblems(text, "範例", terms)).toEqual(oldParityProblems(text, "範例", terms));
      expect(parityProblems([text, SHORT_EN], [SHORT_EN, text], terms)).toEqual(oldParityProblems([text, SHORT_EN], [SHORT_EN, text], terms));
    }
    expect(nameRuns(text)).toEqual(oldNameRuns(text));
    expect(englishMonthNumbers(text)).toEqual(oldEnglishMonthNumbers(text));
  });

  it.each(HOSTILE)("reads %s of 300,000 characters in well under a second, whichever language holds it", (_name, make) => {
    const text = make(300_000);
    within(1000, () => parityProblems(SHORT_EN, text, BRACKET_TERMS));
    within(1000, () => parityProblems(text, "範例", BRACKET_TERMS));
    within(1000, () => nameRuns(text));
    within(1000, () => englishMonthNumbers(text));
  });

  it("reads a Latin run of 300,000 characters as no link and one Latin word", () => {
    const run = "a".repeat(300_000);
    const zh = `範例 ${run}。`;
    expect(within(1000, () => urlsIn(zh))).toEqual([]);
    expect(within(1000, () => latinWordsMissing(SHORT_EN, zh))).toEqual([run]);
    expect(within(1000, () => parityProblems(SHORT_EN, zh))).toEqual({ missing: [], extra: [], urls: [], latin: [run] });
  });

  it("reads a run of 5 MB of digits as one extra number and no Latin word, and does not throw", () => {
    const digits = "9".repeat(5_000_000);
    const p = within(6000, () => parityProblems(SHORT_EN, `範例 ${digits}。`));
    expect(p.missing).toEqual([]);
    expect(p.urls).toEqual([]);
    expect(p.latin).toEqual([]);
    expect(p.extra).toHaveLength(1);
    expect(p.extra[0]!.key).toBe(digits);
    expect(p.extra[0]!.index).toBe(3);
  });

  it("reads one link of 5 MB as the link and the words it spells, and does not throw", () => {
    const tail = "k".repeat(5_000_000);
    const link = `https://example.org/${tail}`;
    const p = within(6000, () => parityProblems(SHORT_EN, `範例 ${link}。`));
    expect(p.urls).toEqual([`${link}。`]);
    expect(p.latin).toEqual(["https", "example", "org", tail]);
    expect(p.missing).toEqual([]);
    expect(p.extra).toEqual([]);
  });

  it("reads 5 MB of Chinese text and of brackets, and does not throw", () => {
    const zh = within(6000, () => parityProblems(SHORT_EN, "範".repeat(5_000_000)));
    expect(zh).toEqual({ missing: [], extra: [], urls: [], latin: [] });
    expect(within(6000, () => parityProblems(SHORT_EN, "（".repeat(5_000_000)))).toEqual({ missing: [], extra: [], urls: [], latin: [] });
    expect(within(6000, () => parityProblems(SHORT_EN, "）".repeat(5_000_000)))).toEqual({ missing: [], extra: [], urls: [], latin: [] });
  });

  it("finds each of 200,000 different links once, in order", () => {
    const links = Array.from({ length: 200_000 }, (_, i) => `https://a.example/${i}`);
    const found = within(6000, () => urlsIn(links.join(" ")));
    expect(found).toHaveLength(200_000);
    expect(found[0]).toBe(links[0]);
    expect(found[199_999]).toBe(links[199_999]);
  });

  it("finds each of 100,000 numbers of the English that the Chinese lacks, and each of 100,000 extra ones of the Chinese, once", () => {
    const numbers = Array.from({ length: 100_000 }, (_, i) => String(1_000_000 + i));
    const gaps = within(6000, () => parityGaps(numbers.join(" "), "範例"));
    expect(gaps.missing.map((n) => n.key)).toEqual(numbers);
    expect(gaps.extra).toEqual([]);
    const back = within(6000, () => parityGaps("範例", numbers.join(" ")));
    expect(back.extra.map((n) => n.key)).toEqual(numbers);
    expect(back.missing).toEqual([]);
  });

  it("reads 100,000 numbers after 百分之 as 100,000 percentages, each with its 百分之 and the white space after it", () => {
    const found = within(2000, () => parityNumbers("百分之 5 ".repeat(100_000)));
    expect(found).toHaveLength(100_000);
    expect(found[0]).toEqual({ value: "5", percent: true, key: "5%", text: "百分之 5", index: 0 });
    expect(found[99_999]).toEqual({ value: "5", percent: true, key: "5%", text: "百分之 5", index: 599_994 });
  });

  it("finds the sentence starts of 100,000 capitalised words, and a long run of white space before a word, in well under a second", () => {
    expect(within(1000, () => englishMonthNumbers("May. ".repeat(100_000)))).toEqual([]);
    expect(within(1000, () => englishMonthNumbers("May 1 ".repeat(100_000)))).toEqual([5]);
    expect(within(1000, () => englishMonthNumbers(`${" ".repeat(200_000)}x${" ".repeat(10)}May`))).toEqual([5]);
    expect(within(1000, () => nameRuns(`${" ".repeat(200_000)}x ${" ".repeat(10)}The Big Name`)).map((r) => r.text)).toEqual(["The Big Name"]);
  });
});

describe("linear time (F-70): the same results as before", () => {
  /** The Chinese fixture texts as (English, Chinese) pairs: every edition's strings and terms, the table of sample translations and the invalid drafts. */
  function fixturePairs(): [string, string][] {
    const pairs: [string, string][] = [];
    for (const name of EDITION_NAMES) {
      const context = zhContext(name);
      const draft = zhDraft(name);
      for (const s of context.strings) pairs.push([s.en, draft.strings[s.key]!]);
      for (const t of context.terms) {
        const zh = draft.terms[t.id];
        if (zh !== undefined) pairs.push([`${t.en}\n${t.definition}`, `${zh.zh}\n${zh.definition}`]);
      }
    }
    for (const en of ZH_ENGLISH) pairs.push([en, zhText(en)]);
    const dir = path.join(ROOT, "fixtures/drafts-zh");
    const english = new Map(EDITION_NAMES.flatMap((name) => zhContext(name).strings.map((s): [string, string] => [`${name}/${s.key}`, s.en])));
    for (const file of fs.readdirSync(dir).filter((f) => /^invalid--.*\.zh\.json$/.test(f))) {
      const draft = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { strings?: Record<string, string>; terms?: Record<string, { zh: string; definition: string }> };
      for (const [key, zh] of Object.entries(draft.strings ?? {})) {
        pairs.push(["", zh]);
        for (const name of EDITION_NAMES) if (english.has(`${name}/${key}`)) pairs.push([english.get(`${name}/${key}`)!, zh]);
      }
      for (const t of Object.values(draft.terms ?? {})) pairs.push(["", `${t.zh}\n${t.definition}`]);
    }
    return pairs;
  }

  /** What every function the change touched gives on one pair, new and earlier side by side. */
  function bothWays(en: string, zh: string, terms: readonly string[]): { now: unknown; before: unknown } {
    return {
      now: [parityProblems(en, zh, terms), parityNumbers(zh), parityNumbers(en), englishMonthNumbers(en), englishMonthNumbers(zh), urlsIn(zh), latinWordsMissing(en, zh, terms), nameRuns(en), nameRuns(zh)],
      before: [oldParityProblems(en, zh, terms), oldParityNumbers(zh), oldParityNumbers(en), oldEnglishMonthNumbers(en), oldEnglishMonthNumbers(zh), oldUrlsIn(zh), oldLatinWordsMissing(en, zh, terms), oldNameRuns(en), oldNameRuns(zh)],
    };
  }

  it("gives the earlier result on every Chinese fixture text, with and without bracketed terms", () => {
    const pairs = fixturePairs();
    const names = [...new Set(EDITION_NAMES.flatMap((name) => zhContext(name).terms.map((t) => t.en)))];
    expect(names.length).toBeGreaterThan(1);
    expect(pairs.length).toBeGreaterThan(300);
    expect(pairs.some(([, zh]) => /（[A-Za-z ]+）/.test(zh))).toBe(true);
    for (const [en, zh] of pairs) {
      for (const terms of [[], names]) {
        const { now, before } = bothWays(en, zh, terms);
        expect(now, `${en} | ${zh}`).toEqual(before);
      }
    }
  });

  /** A deterministic generator (mulberry32), so that the corpus is the same on every run. */
  function random(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FRAGMENTS: readonly string[] = [
    // Chinese
    "範例", "蛋白質摺疊", "百分之", "萬", "億", "月", "日", "年", "名學生", "個", "第", "、", "。", "，", "（", "）", "（）", "（（", "））",
    // Latin words, names, months, number words, articles and percent words
    "AlphaFold", "Cas9", "CO2", "COVID-19", "cell", "Foo", "x", "protein folding", "cell biology", "（protein folding）", "（ cell  biology ）", "（CRISPR）", "（quantum computing）",
    "May", "May 5", "May 2024", "Jan", "Sep", "January", "December", "three", "ten", "percent", "per cent", "thousand", "million", "billion", "The", "A", "An",
    "Stanford University", "Protein Data Bank", "Journal of the AMS", "of", "and", "the", "for", "de", "von",
    // numbers
    "3", "12", "2024", "3.5", "1,000", "2,500,000", "1,2345", "007", "0", "0.50", "1.0", "１２３", "３．５", "１，０００", "％", "%", "70", "250", "5millionth",
    // links and hosts
    "https://example.org/a", "http://a.example", "ftp://files.example.org", "www.example.org", "nature.com", "doi.org/10.1/x", "example.co", "a@example.org",
    "x.ab2", "Node.js", "3.5.1", "https://x.y/z?q=1#f", "mailto:foo@example.org", "e.g",
    // marks that close, open or end a sentence
    ".", "!", "?", "…", ",", ";", ":", "-", EN, ")", "]", "}", "\"", "'", "(", "[", "{", chr(0x201c), chr(0x201d), chr(0x2018), chr(0x2019), "»", "«", "」", "『", "』", "「",
    "）", "】", "【", "！", "？", "。",
    // white space of every kind that \s or the number reader knows
    " ", "  ", "\n", "\t", "\r", chr(0xa0), chr(0x2009), chr(0x202f), chr(0x3000), chr(0x2002), chr(0xfeff), chr(0x2028),
  ];

  /** A scheme of 33 or more characters, which `urlsIn()` reads from its last 32 (the one difference, pinned by its own test): the corpus leaves such a text out. */
  const LONG_SCHEME = /[A-Za-z0-9+.-]{33}:\/\//;

  function corpus(count: number): [string, string][] {
    const next = random(20260127);
    const pick = (): string => FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]!;
    const text = (): string => {
      let out = "";
      for (let n = 3 + Math.floor(next() * 22); n > 0; n -= 1) out += next() < 0.5 ? pick() : `${pick()} `;
      return out;
    };
    const pairs: [string, string][] = [];
    while (pairs.length < count) {
      const en = text();
      const zh = next() < 0.3 ? `${en}${text()}` : text();
      if (!LONG_SCHEME.test(zh)) pairs.push([en, zh]);
    }
    return pairs;
  }

  it("gives the earlier result on a corpus of 2,000 mixed strings (Chinese, Latin, digits, links, brackets, marks and white space of every kind)", () => {
    const pairs = corpus(2000);
    expect(new Set(pairs.map(([en, zh]) => en + zh)).size).toBeGreaterThan(1990);
    let withLinks = 0;
    let withGaps = 0;
    let withWords = 0;
    for (const [en, zh] of pairs) {
      const { now, before } = bothWays(en, zh, BRACKET_TERMS);
      expect(now, `${JSON.stringify(en)} | ${JSON.stringify(zh)}`).toEqual(before);
      const p = parityProblems(en, zh, BRACKET_TERMS);
      if (p.urls.length > 0) withLinks += 1;
      if (p.missing.length + p.extra.length > 0) withGaps += 1;
      if (p.latin.length > 0) withWords += 1;
    }
    // The corpus reaches every kind of problem, so that the comparison above says something.
    expect(withLinks).toBeGreaterThan(300);
    expect(withGaps).toBeGreaterThan(1000);
    expect(withWords).toBeGreaterThan(300);
  });

  it("leaves out of the Latin words the words a link spells as before on every fixture text, and on the corpus except a word that is only part of a link's word", () => {
    for (const [en, zh] of fixturePairs()) {
      const p = parityProblems(en, zh, BRACKET_TERMS);
      expect(wordsOutsideLinks(p.latin, p.urls), `${en} | ${zh}`).toEqual(oldWordsOutsideLinks(p.latin, p.urls));
    }
    let partOfALinkWord = 0;
    for (const [en, zh] of corpus(2000)) {
      const p = parityProblems(en, zh, BRACKET_TERMS);
      const now = wordsOutsideLinks(p.latin, p.urls);
      const was = oldWordsOutsideLinks(p.latin, p.urls);
      // What is now kept and was left out is a word that is a part of a link's word, never a whole one.
      const linkWords = new Set(p.urls.flatMap((u) => u.toLowerCase().match(/[\p{Script=Latin}\p{Nd}]+/gu) ?? []));
      expect(now.filter((w) => !was.includes(w)).every((w) => !linkWords.has(w.toLowerCase()) && [...linkWords].some((l) => l.includes(w.toLowerCase()))), `${en} | ${zh}`).toBe(true);
      expect(was.every((w) => now.includes(w)), `${en} | ${zh}`).toBe(true);
      partOfALinkWord += now.length - was.length;
    }
    expect(partOfALinkWord).toBeGreaterThan(0);
  });

  it("gives the earlier month and name for every string that puts a sentence mark, a closing mark, an opening mark or white space before May, The and A", () => {
    const before = ["", "x", "x.", "x!", "x?", "x。", "x？", "x！", "x,", "x;", "x:", "x)", "x]", "x}", "x\"", "x'", "x”", "x’", "x»", "x」", "x』", "x）", "x】", "x.)", "x.)]", "x.”", "x!」", "x?）", "x…"];
    const joins = ["", " ", "  ", "\n", " \n ", "(", " (", "\"", " \"", "“", " “", "「", " 「", "[", "{", "（", "【", "‘", "'", "«", "‹", "„", "『", chr(0xa0), chr(0x3000), chr(0xfeff), chr(0x2028), "x"];
    let skipped = 0;
    let counted = 0;
    for (const stem of before) {
      for (const join of joins) {
        for (const word of ["May", "May 5", "The Big Name", "A New Method", "An Old Rule"]) {
          const text = `${stem}${join}${word}`;
          expect(englishMonthNumbers(text), JSON.stringify(text)).toEqual(oldEnglishMonthNumbers(text));
          expect(nameRuns(text), JSON.stringify(text)).toEqual(oldNameRuns(text));
          if (word === "May" && englishMonthNumbers(text).length === 0) skipped += 1;
          if (word === "May" && englishMonthNumbers(text).length > 0) counted += 1;
        }
      }
    }
    // Both outcomes occur, so that no mutation of the reader can keep the same results on this table.
    expect(skipped).toBeGreaterThan(100);
    expect(counted).toBeGreaterThan(100);
  });
});

describe("startsSentence, read through May and the articles", () => {
  const may = (before: string): number[] => englishMonthNumbers(`${before}May it last.`);

  it("reads May after a stop, then any closing marks and white space, as a sentence's first word", () => {
    for (const stop of [".", "!", "?", chr(0x3002), chr(0xff1f), chr(0xff01)]) {
      expect(may(`It ended${stop} `), `after ${stop}`).toEqual([]);
      for (const closer of [")", "]", "}", "\"", "'", chr(0x201d), chr(0x2019), chr(0xbb), chr(0x300d), chr(0x300f), chr(0xff09), chr(0x3011)]) {
        expect(may(`It ended${stop}${closer} `), `after ${stop} and ${closer}`).toEqual([]);
      }
    }
  });

  it("reads May after anything else as the month", () => {
    for (const mark of [",", ";", ":", "-", "a", "1", ")", "]", "…", "\"", chr(0x201d)]) expect(may(`It ended${mark} `), `after ${mark}`).toEqual([5]);
    expect(may("It ended.x ")).toEqual([5]);
    expect(may("It ended. x ")).toEqual([5]);
  });

  it("reads May at the start of the text, after opening marks, and after a line break, as a sentence's first word", () => {
    expect(may("")).toEqual([]);
    expect(may(" ")).toEqual([]);
    for (const opener of ["\"", "'", chr(0x201c), chr(0x2018), chr(0x201e), chr(0xab), chr(0x2039), chr(0x300c), chr(0x300e), "(", "[", "{", chr(0xff08), chr(0x3010)]) {
      expect(may(opener), opener).toEqual([]);
      expect(may(` ${opener} `), opener).toEqual([]);
    }
    expect(may("First line\n")).toEqual([]);
    expect(may("First line\r\n")).toEqual([]);
    expect(may("First line\n  ")).toEqual([]);
    expect(may(`First line.${chr(0xa0)}`)).toEqual([]);
    expect(may(`First line${chr(0x3000)}`)).toEqual([5]);
    expect(may("First line ")).toEqual([5]);
  });

  it("reads a stop or a stop and its closing marks right before the word, with no white space between, as a sentence's first word too", () => {
    expect(may("It ended.")).toEqual([]);
    expect(may("It ended.)")).toEqual([]);
    expect(may("It ended).")).toEqual([]);
    expect(may("It ended.)]")).toEqual([]);
  });
});

describe("linear time (F-70): the pieces and limits the new code reads by", () => {
  describe("latinWordsMissing reads a long run in pieces and joins them", () => {
    it("gives a run of any length as one word, as written, whether or not it is cut at a multiple of 4,096", () => {
      for (const n of [1, 4095, 4096, 4097, 8191, 8192, 8193, 12_289]) {
        const word = "a".repeat(n);
        expect(latinWordsMissing("", `範例 ${word} 範例`), String(n)).toEqual([word]);
      }
    });

    it("finds the one letter of a run of digits in any piece of it, and none in a run of digits alone", () => {
      const digits = "9".repeat(5000);
      expect(latinWordsMissing("", `範例 ${digits}a 範例`)).toEqual([`${digits}a`]);
      expect(latinWordsMissing("", `範例 a${digits} 範例`)).toEqual([`a${digits}`]);
      expect(latinWordsMissing("", `範例 ${"9".repeat(4096)}a${"9".repeat(4096)} 範例`)).toEqual([`${"9".repeat(4096)}a${"9".repeat(4096)}`]);
      expect(latinWordsMissing("", `範例 ${digits} 範例`)).toEqual([]);
      expect(latinWordsMissing("", `範例 ${"9".repeat(9000)} 範例`)).toEqual([]);
    });

    it("never cuts a character outside the Basic Multilingual Plane in two where it falls on a boundary", () => {
      const mathematicalZero = String.fromCodePoint(0x1d7ce);
      for (const before of [4094, 4095, 4096]) {
        const word = `${"a".repeat(before)}${mathematicalZero}${"b".repeat(5)}`;
        expect(latinWordsMissing("", `範例 ${word} 範例`), String(before)).toEqual([word]);
      }
    });

    it("keeps two long runs, a long run and the same one again, and a run that another character cuts, as the words they are", () => {
      const a = "a".repeat(5000);
      const b = "b".repeat(5000);
      expect(latinWordsMissing("", `${a} 範例 ${b}`)).toEqual([a, b]);
      expect(latinWordsMissing("", `${a} 範例 ${a}`)).toEqual([a]);
      expect(latinWordsMissing("", `${"a".repeat(4096)}。${"b".repeat(3)}`)).toEqual(["a".repeat(4096), "bbb"]);
      expect(latinWordsMissing(a, `${a} 範例 ${b}`)).toEqual([b]);
    });
  });

  describe("urlsIn reads a scheme of at most 32 characters", () => {
    const scheme = (n: number): string => "s".repeat(n);

    it("reads a scheme of 1 to 32 characters whole", () => {
      for (const n of [1, 2, 31, 32]) expect(urlsIn(`見 ${scheme(n)}://a.example/b 頁`), String(n)).toEqual([`${scheme(n)}://a.example/b`]);
    });

    it("reads a longer scheme from its last 32 characters, so that the address is found and ends where it did", () => {
      for (const n of [33, 40, 5000]) expect(urlsIn(`見 ${scheme(n)}://a.example/b 頁`), String(n)).toEqual([`${scheme(32)}://a.example/b`]);
      expect(urlsIn(`見 ${scheme(40)}+.-9://a.example/b 頁`)).toEqual([`${scheme(28)}+.-9://a.example/b`]);
    });

    it("finds a scheme longer than 32 characters only when a letter stands among its last 32, as the safety rules' reader does", () => {
      // The decision (F-70): no pattern scans an unbounded scheme, so a scheme whose last 32 characters hold no letter has no start.
      expect(urlsIn(`見 a${"1".repeat(31)}://x 頁`)).toEqual([`a${"1".repeat(31)}://x`]);
      expect(urlsIn(`見 a${"1".repeat(32)}://x 頁`)).toEqual([]);
      expect(urlsIn(`見 a${"-".repeat(40)}://x 頁`)).toEqual([]);
      expect(urlsIn(`見 a${"1".repeat(40)}b${"1".repeat(31)}://x 頁`)).toEqual([`b${"1".repeat(31)}://x`]);
    });

    it("reads the scheme's characters as RFC 3986 does, and a scheme starts with a letter", () => {
      expect(urlsIn("見 a+b.c-d9://a.example 頁")).toEqual(["a+b.c-d9://a.example"]);
      expect(urlsIn("見 9a://a.example 頁")).toEqual(["a://a.example"]);
      expect(urlsIn("見 a:/b 頁")).toEqual([]);
    });
  });

  describe("wordsOutsideLinks leaves out the words that a link spells", () => {
    it("drops each word that is one of the words of a link, whatever its case, and keeps the others in order", () => {
      expect(wordsOutsideLinks(["https", "Foo", "example", "ORG", "bar"], ["https://example.org/a"])).toEqual(["Foo", "bar"]);
      expect(wordsOutsideLinks(["Foo", "foo"], ["HTTPS://FOO.example"])).toEqual([]);
      expect(wordsOutsideLinks(["b2", "a1"], ["www.a1.example/b2"])).toEqual([]);
    });

    it("reads the words of every link, and a word of any one of them is spelled", () => {
      expect(wordsOutsideLinks(["one", "two", "three"], ["https://a.example/one", "https://b.example/two"])).toEqual(["three"]);
    });

    it("keeps a word that is only part of a link's word, and a word made of two links' ends, which no link spells", () => {
      expect(wordsOutsideLinks(["exam", "ample", "amp"], ["https://example.org"])).toEqual(["exam", "ample", "amp"]);
      expect(wordsOutsideLinks(["ab"], ["https://a.example", "https://b.example"])).toEqual(["ab"]);
      expect(wordsOutsideLinks(["ab"], ["https://xa.example", "https://bx.example"])).toEqual(["ab"]);
    });

    it("keeps every word when there is no link, and gives none when there is no word", () => {
      expect(wordsOutsideLinks(["Foo", "bar"], [])).toEqual(["Foo", "bar"]);
      expect(wordsOutsideLinks([], ["https://example.org"])).toEqual([]);
    });

    it("reads 50,000 links and 50,000 other words in well under a second", () => {
      const links = Array.from({ length: 50_000 }, (_, i) => `https://a.example/p${i}`);
      const words = Array.from({ length: 50_000 }, (_, i) => `q${i}`);
      const kept = within(1000, () => wordsOutsideLinks([...words, "example", "p7", "P49999"], links));
      expect(kept).toEqual(words);
    });
  });

  describe("parityNumbers reads a 百分之 and the white space after it by looking back from the number", () => {
    const SPACE_CHARS = [" ", chr(0xa0), chr(0x2009), chr(0x202f)];

    it("makes a percentage of a number that follows 百分之 and any of the four spaces the number reader knows, and keeps them in its text", () => {
      for (const space of SPACE_CHARS) {
        for (const gap of [space, space + space, ""]) {
          const found = parityNumbers(`是百分之${gap}5。`);
          expect(found, JSON.stringify(gap)).toEqual([{ value: "5", percent: true, key: "5%", text: `百分之${gap}5`, index: 1 }]);
        }
      }
    });

    it("reads a 百分之 at the very start of the text, and one after another number, as a prefix", () => {
      expect(parityNumbers("百分之5")).toEqual([{ value: "5", percent: true, key: "5%", text: "百分之5", index: 0 }]);
      expect(parityNumbers("百分之 5 百分之 6")).toEqual([
        { value: "5", percent: true, key: "5%", text: "百分之 5", index: 0 },
        { value: "6", percent: true, key: "6%", text: "百分之 6", index: 6 },
      ]);
    });

    it("reads a number that no 百分之 directly precedes as a plain one, whatever stands before it", () => {
      for (const before of ["", " ", "  ", "之", "分之", "百分之 之", "百分 ", "百之 ", "百分之x", "百分之，", "百分之。 ", "分之 ", "百分之\n", `百分之${chr(0x3000)}`, `百分之${chr(0x2002)}`, "百分之\t", "百分", "百分之百分之 百分 "]) {
        expect(parityNumbers(`${before}5`).map((n) => n.percent), JSON.stringify(before)).toEqual([false]);
      }
    });

    it("counts a space between the number and its % or percent as the number's own, and 百分之 before as one more percent mark, not two", () => {
      expect(parityNumbers("百分之 5%")[0]).toMatchObject({ percent: true, key: "5%", text: "百分之 5%", index: 0 });
    });
  });

  describe("parityNumbers gives a whole number its own digits and any other number its exact value", () => {
    it("drops leading zeros, and gives 0 for zeros alone", () => {
      expect(keys("0 00 000")).toEqual(["0", "0", "0"]);
      expect(keys("007 0010 01")).toEqual(["7", "10", "1"]);
      expect(keys("7 10 100 90 9")).toEqual(["7", "10", "100", "90", "9"]);
    });

    it("keeps a decimal and a multiplied number exact", () => {
      expect(keys("00.5 0.50 1.50 10.0 0.0")).toEqual(["0.5", "0.5", "1.5", "10", "0"]);
      expect(keys("2 million 0 thousand 05 萬 1,000,000")).toEqual(["2000000", "0", "50000", "1000000"]);
    });
  });

  describe("parityGaps reads the Chinese once and names the first of each number", () => {
    it("lists an extra number once, at its first place, in order, and a number the English knows never", () => {
      const gaps = parityGaps("2 cells", "5 個、5 隻、2 個、7 個、5 隻、7 個");
      expect(gaps.extra.map((n) => [n.key, n.index])).toEqual([["5", 0], ["7", 12]]);
      expect(gaps.missing).toEqual([]);
    });

    it("lists a missing number once, at its first place in the English, in order", () => {
      const gaps = parityGaps("3 and 3 and 4 and 2 and 3", "2");
      expect(gaps.missing.map((n) => [n.key, n.index])).toEqual([["3", 0], ["4", 12]]);
      expect(gaps.extra).toEqual([]);
    });

    it("tells a percentage from the same number apart, in both lists", () => {
      const gaps = parityGaps("5 and 6%", "6 and 5%");
      expect(gaps.missing.map((n) => n.key)).toEqual(["5", "6%"]);
      expect(gaps.extra.map((n) => n.key)).toEqual(["6", "5%"]);
    });
  });
});

describe("linear time (F-70): avoidHits masks the hits of a term once, after finding them all", () => {
  const entry = (term: string, taiwan: string, allow_in: string[] = []): AvoidTerm => ({ term, taiwan, allow_in });
  const fixed = (zh: string): FixedTerm => ({ en: "x", zh, fields: [], except: [] });
  /** Terms that overlap, touch, repeat and sit inside one another, with an allowed string and a fixed translation. */
  const TANGLED = {
    avoid: [entry("甲乙丙", "子"), entry("乙丙", "丑"), entry("甲甲", "寅"), entry("乙", "卯"), entry("丙丁甲甲", "辰"), entry("甲乙", "巳", ["丁甲乙"])],
    fixed: [fixed("戊乙"), fixed("丙乙丁")],
  };

  /** A deterministic generator (mulberry32). */
  function seeded(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("gives what it gave on every avoid term, allowed string and fixed translation of the config, alone, doubled and between others", () => {
    const pieces = [...TERMS.avoid.map((a) => a.term), ...TERMS.avoid.flatMap((a) => a.allow_in), ...FIXED.map((f) => f.zh)];
    expect(pieces.length).toBeGreaterThan(60);
    for (const piece of pieces) {
      for (const text of [piece, `${piece}${piece}`, `我們用${piece}做`, `${piece}和${piece}`, ` ${piece} `]) {
        expect(avoidHits(text, TERMS), text).toEqual(oldAvoidHits(text, TERMS));
      }
    }
  });

  it("gives what it gave on 3,000 texts of tangled terms, and on 2,000 texts made of the config's terms, allowed strings and fixed translations", () => {
    const next = seeded(20261127);
    const letters = ["甲", "乙", "丙", "丁", "戊", " ", "x"];
    let hits = 0;
    for (let i = 0; i < 3000; i += 1) {
      const text = Array.from({ length: Math.floor(next() * 16) }, () => letters[Math.floor(next() * letters.length)]!).join("");
      const now = avoidHits(text, TANGLED);
      expect(now, JSON.stringify(text)).toEqual(oldAvoidHits(text, TANGLED));
      hits += now.length;
    }
    expect(hits).toBeGreaterThan(3000);
    const pieces = [...TERMS.avoid.map((a) => a.term), ...TERMS.avoid.flatMap((a) => a.allow_in), ...FIXED.map((f) => f.zh), "我們", "用", " ", "的", "。"];
    let configHits = 0;
    for (let i = 0; i < 2000; i += 1) {
      const text = Array.from({ length: 1 + Math.floor(next() * 12) }, () => pieces[Math.floor(next() * pieces.length)]!).join("");
      const now = avoidHits(text, TERMS);
      expect(now, text).toEqual(oldAvoidHits(text, TERMS));
      configHits += now.length;
    }
    expect(configHits).toBeGreaterThan(1000);
  });

  it("names a term inside a longer one once, the longer one, and never a hit that an earlier hit's blank has made", () => {
    expect(avoidHits("甲乙丙", TANGLED)).toEqual([{ term: "甲乙丙", taiwan: "子", index: 0 }]);
    expect(avoidHits("甲甲甲", TANGLED)).toEqual([{ term: "甲甲", taiwan: "寅", index: 0 }]);
    expect(avoidHits("甲乙丙甲乙丙", TANGLED).map((h) => h.index)).toEqual([0, 3]);
    expect(avoidHits("乙 乙乙", TANGLED).map((h) => [h.term, h.index])).toEqual([["乙", 0], ["乙", 2], ["乙", 3]]);
  });

  it("reads 64,000 hits of one avoid term (256,000 characters) in well under a second, where copying the text for each hit took over ten", () => {
    const term = TERMS.avoid[0]!.term;
    const count = Math.ceil(256_000 / term.length);
    const hits = within(1000, () => avoidHits(term.repeat(count), TERMS));
    expect(hits).toHaveLength(count);
    expect(hits[count - 1]).toEqual({ term, taiwan: TERMS.avoid[0]!.taiwan, index: (count - 1) * term.length });
  });
});

// ── This file and lib/zh.ts pass the checks they hold ────────────────────────────────────────────

describe("the Chinese of this file and of lib/zh.ts", () => {
  for (const file of ["tests/zh.test.ts", "lib/zh.ts"]) {
    it(`${file} has no simplified-only or Japanese-only character, no avoid term and no dash (its section rules are box lines)`, () => {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(traditionalHits(text, CONFIG.index)).toEqual([]);
      expect(avoidHits(text, TERMS)).toEqual([]);
      expect(dashHits(text).filter((h) => h.kind === "dash")).toEqual([]);
    });
  }
});
