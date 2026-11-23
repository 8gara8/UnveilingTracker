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
  parityProblems, traditionalHits, urlsIn, latinWordsMissing, type OnceTerm,
} from "@/lib/zh";

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

  it("skips English in full-width brackets, not in half-width ones", () => {
    expect(latinWordsMissing("folds", "蛋白質摺疊（protein folding）")).toEqual([]);
    expect(latinWordsMissing("folds", "蛋白質摺疊(protein folding)")).toEqual(["protein", "folding"]);
    expect(latinWordsMissing("folds", "蛋白質（protein）與摺疊（folding）")).toEqual([]);
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

  it("gives a use to the first of two terms with the same Chinese; the other reports none", () => {
    const other: OnceTerm = { en: "folding of proteins", zh: "蛋白質摺疊" };
    expect(englishOnceProblems({ parts: ["蛋白質摺疊（protein folding）"], title: "", terms: [FOLDING, other] })).toEqual([
      { kind: "unused", term: other },
    ]);
  });

  it("reports a term whose Chinese is empty as unused", () => {
    const empty: OnceTerm = { en: "x", zh: "" };
    expect(englishOnceProblems({ parts: ["文字"], title: "", terms: [empty] })).toEqual([{ kind: "unused", term: empty }]);
  });

  it("names the part of each use, however many parts come before it", () => {
    const cell: OnceTerm = { en: "cell", zh: "細胞" };
    expect(englishOnceProblems({ parts: ["前言", "背景", "研究細胞", "結論"], title: "", terms: [cell] })).toEqual([
      { kind: "first_unbracketed", term: cell, part: 2 },
    ]);
  });

  it("gives the problems term by term in the order of terms", () => {
    expect(englishOnceProblems({ parts: ["蛋白質很重要", "蛋白質摺疊也是"], title: "", terms: [FOLDING, PROTEIN] })).toEqual([
      { kind: "first_unbracketed", term: FOLDING, part: 1 },
      { kind: "first_unbracketed", term: PROTEIN, part: 0 },
    ]);
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
