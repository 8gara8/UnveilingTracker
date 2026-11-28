// lib/metrics/pace.ts (SPEC §5.1 to §5.3 the window, the baseline, the shares and the two verdicts; §5.2 the Pace sentence and
// `quotable`; §4.7 the metrics file's `pace` block; STYLE-ZH §14 the Chinese sentence): every figure here is worked by hand from
// a synthetic weekly state of 619 weeks (2015-01-05 to 2026-11-09) whose weeks outside the three spans carry counts that would
// wreck any sum they leaked into, and every Wilson and Newcombe bound was computed outside the code under test. The twelve pairs
// of verdicts are pinned in both languages, with the SPEC's and STYLE-ZH's own sentences verbatim, and every form of the sentence
// (field counts, too few, stale, missing). New for this project; Cyber's tests/window.test.ts has no counterpart.
import { describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/dates";
import {
  buildPace, dataCutoff, fieldVerdicts, missingPace, PACE_MISSING, paceCell, paceQuotable, paceRanges, paceSentence, paceSet, shareOf,
  spanCounts, vsBaseline, vsYearAgo, weekCounts, type PaceSettings, type Tally,
} from "@/lib/metrics/pace";
import { newcombe80 } from "@/lib/metrics/stats";
import { PaceBlock, PaceSet, Share, type PaceCell, type PaceWeek, type VsBaseline, type VsYearAgo } from "@/lib/schema/metrics";
import { FIELDS, type FieldId } from "@/lib/vocab";

// `newcombe80` is the real one, except in the one describe that hands a verdict an interval touching 0, which no counts give.
vi.mock("@/lib/metrics/stats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/metrics/stats")>();
  return { ...actual, newcombe80: vi.fn(actual.newcombe80) };
});

const SETTINGS: PaceSettings = { window_weeks: 13, provisional_weeks: 8, min_cases: 30, min_ratio: 1.25 };
const t = (k: number, n: number): Tally => ({ k, n });

/** Freezes a value and everything in it, so any write to it throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// ── The synthetic weekly state ───────────────────────────────────────────────────────────────────
//
// 619 Mondays, 2015-01-05 to 2026-11-09 (4,326 days apart, 4,326 / 7 = 618, and 619 weeks counting both ends). For the edition of
// 2026-11-23 the data cutoff is Sunday 2026-11-15, so:
//   baseline    the 260 weeks 2015-01-05 to 2019-12-23 (Mondays), each with the counts BASE below
//   year-ago    the 13 weeks 2025-06-23 to 2025-09-15, each with YEAR
//   window      the 13 weeks 2026-06-22 to 2026-09-14, each with WIN
//   provisional the 8 weeks 2026-09-21 to 2026-11-09: never read, so each holds POISON
//   all others  the weeks between the spans: never read either, so POISON as well.
// POISON has every paper AI-method, 1,000 of 1,000 in every field: one leaked week moves a total by 7,000.

type Weekly = Record<FieldId, { base: [number, number]; win: [number, number]; year: [number, number] }>;

/** A, the leading journals: [AI-method papers, all papers] in one week, per field. Humanities has no papers in leading journals. */
const LEAD: Weekly = {
  mathematics: { base: [1, 40], win: [4, 40], year: [2, 40] },
  physics: { base: [2, 40], win: [6, 40], year: [6, 40] },
  chemistry: { base: [4, 40], win: [3, 40], year: [3, 40] },
  biology: { base: [4, 40], win: [10, 40], year: [8, 40] },
  earth: { base: [3, 40], win: [3, 40], year: [5, 40] },
  social: { base: [1, 20], win: [3, 20], year: [1, 20] },
  humanities: { base: [0, 0], win: [0, 0], year: [0, 0] },
};

/** B, all papers. */
const ALL: Weekly = {
  mathematics: { base: [2, 200], win: [4, 200], year: [4, 200] },
  physics: { base: [4, 200], win: [3, 200], year: [4, 200] },
  chemistry: { base: [2, 200], win: [3, 200], year: [2, 200] },
  biology: { base: [4, 200], win: [8, 200], year: [6, 200] },
  earth: { base: [2, 200], win: [2, 200], year: [2, 200] },
  social: { base: [1, 100], win: [2, 100], year: [1, 100] },
  humanities: { base: [1, 100], win: [1, 100], year: [1, 100] },
};

type Region = "base" | "win" | "year" | "poison";

function regionOf(monday: string): Region {
  if (monday <= "2019-12-23") return "base";
  if (monday >= "2025-06-23" && monday <= "2025-09-15") return "year";
  if (monday >= "2026-06-22" && monday <= "2026-09-14") return "win";
  return "poison";
}

function weekCountsOf(table: Weekly, region: Region): Record<FieldId, [number, number]> {
  return Object.fromEntries(FIELDS.map((f) => [f, region === "poison" ? [1000, 1000] : [...table[f][region]]])) as Record<FieldId, [number, number]>;
}

function buildState(): PaceWeek[] {
  const weeks: PaceWeek[] = [];
  for (let monday = "2015-01-05"; monday <= "2026-11-09"; monday = addDays(monday, 7)) {
    const region = regionOf(monday);
    weeks.push({
      week_start: monday, fetched: "2026-11-23", provisional: monday >= "2026-09-21",
      leading: weekCountsOf(LEAD, region), all: weekCountsOf(ALL, region),
    });
  }
  return weeks;
}

const STATE = buildState();
const CUTOFF = "2026-11-15";
const RANGES = paceRanges(CUTOFF, SETTINGS);

// What each field's cells hold, worked from the tables above: [window k, n], [baseline k, n], [year-ago k, n], then the verdicts.
// Window: 13 weeks.  Baseline: 260 weeks.  Year-ago: 13 weeks.  So mathematics (leading) is window 4 x 13 = 52 of 40 x 13 = 520,
// baseline 1 x 260 = 260 of 40 x 260 = 10,400, year-ago 2 x 13 = 26 of 520.
type Row = [FieldId, [number, number], [number, number], [number, number], VsBaseline, VsYearAgo];

const LEADING_ROWS: Row[] = [
  ["mathematics", [52, 520], [260, 10400], [26, 520], "higher", "too_few"], //     10.0% vs 2.5%: 4 times; year-ago k 26 < 30
  ["physics", [78, 520], [520, 10400], [78, 520], "higher", "level"], //           15.0% vs 5.0%: 3 times; same as a year ago
  ["chemistry", [39, 520], [1040, 10400], [39, 520], "lower", "level"], //         7.5% vs 10.0%: 0.75 of it; same as a year ago
  ["biology", [130, 520], [1040, 10400], [104, 520], "higher", "up"], //           25.0% vs 10.0%: 2.5 times; 20.0% a year ago
  ["earth", [39, 520], [780, 10400], [65, 520], "no_clear_change", "down"], //     7.5% vs 7.5%; 12.5% a year ago
  ["social", [39, 260], [260, 5200], [13, 260], "higher", "too_few"], //           15.0% vs 5.0%: 3 times; year-ago k 13 < 30
  ["humanities", [0, 0], [0, 0], [0, 0], "too_few", "too_few"], //                 no papers in leading journals at all
];

const ALL_ROWS: Row[] = [
  ["mathematics", [52, 2600], [520, 52000], [52, 2600], "higher", "level"], //     2.0% vs 1.0%; 2.0% a year ago
  ["physics", [39, 2600], [1040, 52000], [52, 2600], "lower", "down"], //          1.5% vs 2.0%: 0.75 of it; 2.0% a year ago
  ["chemistry", [39, 2600], [520, 52000], [26, 2600], "higher", "too_few"], //     1.5% vs 1.0%: 1.5 times; year-ago k 26 < 30
  ["biology", [104, 2600], [1040, 52000], [78, 2600], "higher", "up"], //          4.0% vs 2.0%; 3.0% a year ago
  ["earth", [26, 2600], [520, 52000], [26, 2600], "too_few", "too_few"], //       window k 26 < 30
  ["social", [26, 1300], [260, 26000], [13, 1300], "too_few", "too_few"], //       window k 26 < 30
  ["humanities", [13, 1300], [260, 26000], [13, 1300], "too_few", "too_few"], //   window k 13 < 30
];

function expectRows(set: PaceSet, rows: Row[]): void {
  expect(Object.keys(set.by_field)).toEqual([...FIELDS]);
  for (const [field, w, b, y, vb, vy] of rows) {
    const cell = set.by_field[field];
    expect([cell.window.k, cell.window.n], `${field} window`).toEqual(w);
    expect([cell.baseline.k, cell.baseline.n], `${field} baseline`).toEqual(b);
    expect([cell.year_ago.k, cell.year_ago.n], `${field} year-ago`).toEqual(y);
    expect([cell.vs_baseline, cell.vs_year_ago], `${field} verdicts`).toEqual([vb, vy]);
  }
}

// The pooled cells: the seven fields added up. Leading window per week 4 + 6 + 3 + 10 + 3 + 3 + 0 = 29 of 40 x 5 + 20 + 0 = 220, so
// 29 x 13 = 377 of 220 x 13 = 2,860 (13.2%: floor((2000 x 377 + 2860) / 5720) = 132 tenths). Baseline per week 1 + 2 + 4 + 4 + 3 + 1 + 0 =
// 15 of 220, so 15 x 260 = 3,900 of 57,200 (6.8%). Year-ago per week 2 + 6 + 3 + 8 + 5 + 1 + 0 = 25, so 325 of 2,860 (11.4%).
const LEADING_POOLED: PaceCell = {
  window: { k: 377, n: 2860, share: 0.1318, ci80: [0.1239, 0.1401] },
  baseline: { k: 3900, n: 57200, share: 0.0682, ci80: [0.0668, 0.0695] },
  year_ago: { k: 325, n: 2860, share: 0.1136, ci80: [0.1063, 0.1215] },
  vs_baseline: "higher", // Newcombe [0.0556, 0.0721], and 13.2 / 6.8 = 1.93 is at least 1.25
  vs_year_ago: "up", //     Newcombe [0.0071, 0.0293], wholly above 0
};

// All papers: window per week 4 + 3 + 3 + 8 + 2 + 2 + 1 = 23 of 200 x 5 + 100 + 100 = 1,200, so 299 of 15,600 (1.9%); baseline per week
// 2 + 4 + 2 + 4 + 2 + 1 + 1 = 16, so 4,160 of 312,000 (1.3%); year-ago per week 4 + 4 + 2 + 6 + 2 + 1 + 1 = 20, so 260 of 15,600 (1.7%).
const ALL_POOLED: PaceCell = {
  window: { k: 299, n: 15600, share: 0.0192, ci80: [0.0178, 0.0206] },
  baseline: { k: 4160, n: 312000, share: 0.0133, ci80: [0.0131, 0.0136] },
  year_ago: { k: 260, n: 15600, share: 0.0167, ci80: [0.0154, 0.018] },
  vs_baseline: "higher", // Newcombe [0.0045, 0.0073], and 1.9167 / 1.3333 = 1.44
  vs_year_ago: "up", //     Newcombe [0.0006, 0.0044]
};

// The figures `quotable` holds for those cells, each from the counts: floor((2000 k + n) / (2 n)) tenths of a percent.
const LEADING_QUOTABLE: Record<string, string> = {
  "pace.leading.pooled.window": "13.2%",
  "pace.leading.pooled.baseline": "6.8%",
  "pace.leading.pooled.year_ago": "11.4%",
  "pace.leading.by_field.mathematics.window": "10.0%",
  "pace.leading.by_field.mathematics.baseline": "2.5%",
  "pace.leading.by_field.mathematics.year_ago": "5.0%",
  "pace.leading.by_field.physics.window": "15.0%",
  "pace.leading.by_field.physics.baseline": "5.0%",
  "pace.leading.by_field.physics.year_ago": "15.0%",
  "pace.leading.by_field.chemistry.window": "7.5%",
  "pace.leading.by_field.chemistry.baseline": "10.0%",
  "pace.leading.by_field.chemistry.year_ago": "7.5%",
  "pace.leading.by_field.biology.window": "25.0%",
  "pace.leading.by_field.biology.baseline": "10.0%",
  "pace.leading.by_field.biology.year_ago": "20.0%",
  "pace.leading.by_field.earth.window": "7.5%",
  "pace.leading.by_field.earth.baseline": "7.5%",
  "pace.leading.by_field.earth.year_ago": "12.5%",
  "pace.leading.by_field.social.window": "15.0%",
  "pace.leading.by_field.social.baseline": "5.0%",
  "pace.leading.by_field.social.year_ago": "5.0%",
};

const ALL_QUOTABLE: Record<string, string> = {
  "pace.all.pooled.window": "1.9%",
  "pace.all.pooled.baseline": "1.3%",
  "pace.all.pooled.year_ago": "1.7%",
  "pace.all.by_field.mathematics.window": "2.0%",
  "pace.all.by_field.mathematics.baseline": "1.0%",
  "pace.all.by_field.mathematics.year_ago": "2.0%",
  "pace.all.by_field.physics.window": "1.5%",
  "pace.all.by_field.physics.baseline": "2.0%",
  "pace.all.by_field.physics.year_ago": "2.0%",
  "pace.all.by_field.chemistry.window": "1.5%",
  "pace.all.by_field.chemistry.baseline": "1.0%",
  "pace.all.by_field.chemistry.year_ago": "1.0%",
  "pace.all.by_field.biology.window": "4.0%",
  "pace.all.by_field.biology.baseline": "2.0%",
  "pace.all.by_field.biology.year_ago": "3.0%",
  "pace.all.by_field.earth.window": "1.0%",
  "pace.all.by_field.earth.baseline": "1.0%",
  "pace.all.by_field.earth.year_ago": "1.0%",
  "pace.all.by_field.social.window": "2.0%",
  "pace.all.by_field.social.baseline": "1.0%",
  "pace.all.by_field.social.year_ago": "1.0%",
  "pace.all.by_field.humanities.window": "1.0%",
  "pace.all.by_field.humanities.baseline": "1.0%",
  "pace.all.by_field.humanities.year_ago": "1.0%",
};

// The sentence for that state: 13.2% window, 6.8% baseline, 11.4% year-ago, 4 fields higher (mathematics, physics, biology, social),
// 1 too few (humanities), chemistry lower and earth no clear change counting as neither. The window ends Sunday 2026-09-20.
const STATE_SENTENCE = {
  en: "The Pace: 13.2% of papers in leading journals named AI methods in the 13 weeks to 20 Sep. "
    + "That is up from 6.8% in 2015 to 2019, and up from 11.4% a year earlier. "
    + "Clearly above the pre-AI level in 4 of 7 fields. Too few cases to judge in 1.",
  zh: "進度：截至 9 月 20 日的 13 週內，主要期刊有 13.2% 的論文提到 AI 方法，高於 2015 至 2019 年的 6.8%，也高於一年前的 11.4%。"
    + "7 個領域中有 4 個明顯高於 AI 出現之前。有 1 個領域的案例太少，無法判斷。",
};

describe("the synthetic state", () => {
  it("has 619 weekly rows from 2015-01-05 to 2026-11-09, one for each Monday, with the newest 8 provisional", () => {
    expect(STATE).toHaveLength(619);
    expect(STATE[0]!.week_start).toBe("2015-01-05");
    expect(STATE[618]!.week_start).toBe("2026-11-09");
    expect(STATE.filter((w) => w.provisional)).toHaveLength(8);
    expect(STATE.every((w, i) => i === 0 || addDays(STATE[i - 1]!.week_start, 7) === w.week_start)).toBe(true);
  });
});

// ── The ranges ───────────────────────────────────────────────────────────────────────────────────

describe("dataCutoff", () => {
  // The newest Sunday on or before D - 2. 2026-11-23 is a Monday.
  const TABLE: [string, string][] = [
    ["2026-11-23", "2026-11-15"], // Mon: D - 2 is Saturday 11-21, the Sunday before is 11-15
    ["2026-11-24", "2026-11-22"], // Tue: D - 2 is Sunday 11-22 itself
    ["2026-11-25", "2026-11-22"], // Wed
    ["2026-11-26", "2026-11-22"], // Thu
    ["2026-11-27", "2026-11-22"], // Fri
    ["2026-11-28", "2026-11-22"], // Sat
    ["2026-11-29", "2026-11-22"], // Sun: D - 2 is Friday 11-27
    ["2026-11-30", "2026-11-22"], // Mon: D - 2 is Saturday 11-28
    ["2026-12-01", "2026-11-29"], // Tue: D - 2 is Sunday 11-29
    ["2027-01-02", "2026-12-27"], // across the year: D - 2 is Thursday 12-31
    ["2027-01-04", "2026-12-27"],
    ["2027-01-05", "2027-01-03"],
  ];

  it("is the newest Sunday on or before D - 2, for each weekday and across a year end", () => {
    for (const [date, cutoff] of TABLE) expect(dataCutoff(date), date).toBe(cutoff);
  });
});

describe("paceRanges", () => {
  it("gives the provisional weeks, the window, the year-ago window and the baseline for the cutoff of 2026-11-15", () => {
    // Provisional: 8 x 7 - 1 = 55 days back from the cutoff, 2026-09-21 (Monday). Window: ends the day before, 2026-09-20, and
    // starts 13 x 7 - 1 = 90 days earlier, 2026-06-22. Year-ago: both ends 364 days back, 2025-06-23 and 2025-09-21.
    expect(paceRanges("2026-11-15", SETTINGS)).toEqual({
      cutoff: "2026-11-15",
      provisional: { from: "2026-09-21", to: "2026-11-15" },
      window: { from: "2026-06-22", to: "2026-09-20" },
      yearAgo: { from: "2025-06-23", to: "2025-09-21" },
      baseline: { from: "2015-01-05", to: "2019-12-29" },
    });
  });

  it("follows the cutoff across a year end", () => {
    expect(paceRanges("2027-01-03", SETTINGS)).toEqual({
      cutoff: "2027-01-03",
      provisional: { from: "2026-11-09", to: "2027-01-03" },
      window: { from: "2026-08-10", to: "2026-11-08" },
      yearAgo: { from: "2025-08-11", to: "2025-11-09" },
      baseline: { from: "2015-01-05", to: "2019-12-29" },
    });
  });

  it("reads the lengths from the settings", () => {
    // 4 window weeks and 2 provisional: provisional from 2026-11-15 - 13 = 2026-11-02; window 2026-10-05 to 2026-11-01.
    expect(paceRanges("2026-11-15", { window_weeks: 4, provisional_weeks: 2 })).toEqual({
      cutoff: "2026-11-15",
      provisional: { from: "2026-11-02", to: "2026-11-15" },
      window: { from: "2026-10-05", to: "2026-11-01" },
      yearAgo: { from: "2025-10-06", to: "2025-11-02" },
      baseline: { from: "2015-01-05", to: "2019-12-29" },
    });
  });

  it("starts the window on a Monday, ends it on a Sunday and puts it 91 days long, with the year-ago window 364 days back", () => {
    const r = paceRanges("2026-11-15", SETTINGS);
    expect(r.window.from).toBe("2026-06-22"); // a Monday
    expect(r.window.to).toBe("2026-09-20"); //   a Sunday
    expect(addDays(r.window.from, 90)).toBe(r.window.to);
    expect(addDays(r.window.to, 1)).toBe(r.provisional.from);
    expect(addDays(r.provisional.from, 55)).toBe(r.cutoff);
    expect(addDays(r.window.from, -364)).toBe(r.yearAgo.from);
  });

  it("refuses a cutoff that is not a Sunday, and settings that are not positive whole numbers", () => {
    expect(() => paceRanges("2026-11-16", SETTINGS)).toThrow(new RangeError("The data cutoff is a Sunday, got 2026-11-16"));
    expect(() => paceRanges("2026-11-14", SETTINGS)).toThrow(new RangeError("The data cutoff is a Sunday, got 2026-11-14"));
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => paceRanges("2026-11-15", { window_weeks: bad, provisional_weeks: 8 }), String(bad)).toThrow(new RangeError(`window_weeks must be a positive whole number, got ${bad}`));
      expect(() => paceRanges("2026-11-15", { window_weeks: 13, provisional_weeks: bad }), String(bad)).toThrow(new RangeError(`provisional_weeks must be a positive whole number, got ${bad}`));
    }
    expect(() => paceRanges("2026-11-15", { window_weeks: 1, provisional_weeks: 1 })).not.toThrow();
  });
});

// ── Counts ───────────────────────────────────────────────────────────────────────────────────────

describe("weekCounts", () => {
  const week: PaceWeek = {
    week_start: "2026-06-01", fetched: "2026-11-23", provisional: false,
    leading: { mathematics: [1, 10], physics: [2, 20], chemistry: [3, 30], biology: [4, 40], earth: [5, 50], social: [6, 60], humanities: [7, 70] },
    all: { mathematics: [10, 100], physics: [20, 200], chemistry: [30, 300], biology: [40, 400], earth: [50, 500], social: [60, 600], humanities: [70, 700] },
  };

  it("gives one field's [AI-method papers, all papers] from either set", () => {
    expect(weekCounts(week, "leading", "earth")).toEqual([5, 50]);
    expect(weekCounts(week, "all", "humanities")).toEqual([70, 700]);
    expect(weekCounts(week, "leading", "mathematics")).toEqual([1, 10]);
    expect(weekCounts(week, "all", "social")).toEqual([60, 600]);
  });

  it("adds the seven fields up for the pooled cell: 1 + 2 + ... + 7 = 28 of 280, and ten times that for all papers", () => {
    expect(weekCounts(week, "leading", null)).toEqual([28, 280]);
    expect(weekCounts(week, "all", null)).toEqual([280, 2800]);
  });

  it("returns a new pair, never the stored one", () => {
    const pair = weekCounts(week, "leading", "earth");
    expect(pair).not.toBe(week.leading.earth);
  });
});

describe("spanCounts", () => {
  it("adds the weeks of a span, window by window: pooled leading 29 x 13 = 377 of 220 x 13 = 2,860", () => {
    expect(spanCounts(STATE, RANGES.window, "leading", null)).toEqual({ k: 377, n: 2860 });
    expect(spanCounts(STATE, RANGES.baseline, "leading", null)).toEqual({ k: 3900, n: 57200 });
    expect(spanCounts(STATE, RANGES.yearAgo, "leading", null)).toEqual({ k: 325, n: 2860 });
    expect(spanCounts(STATE, RANGES.window, "all", null)).toEqual({ k: 299, n: 15600 });
    expect(spanCounts(STATE, RANGES.baseline, "all", null)).toEqual({ k: 4160, n: 312000 });
    expect(spanCounts(STATE, RANGES.yearAgo, "all", null)).toEqual({ k: 260, n: 15600 });
  });

  it("adds one field's weeks: biology's window is 10 x 13 = 130 of 40 x 13 = 520, and the baseline 4 x 260 = 1,040 of 10,400", () => {
    expect(spanCounts(STATE, RANGES.window, "leading", "biology")).toEqual({ k: 130, n: 520 });
    expect(spanCounts(STATE, RANGES.baseline, "leading", "biology")).toEqual({ k: 1040, n: 10400 });
    expect(spanCounts(STATE, RANGES.yearAgo, "all", "social")).toEqual({ k: 13, n: 1300 });
  });

  it("takes every week that starts within the span: Monday to Sunday is one week, and a span that ends on a Monday takes that week too", () => {
    // Each window week is 29 of 220 in A, pooled.
    expect(spanCounts(STATE, { from: "2026-06-22", to: "2026-06-28" }, "leading", null)).toEqual({ k: 29, n: 220 });
    expect(spanCounts(STATE, { from: "2026-06-22", to: "2026-06-22" }, "leading", null)).toEqual({ k: 29, n: 220 });
    expect(spanCounts(STATE, { from: "2026-06-22", to: "2026-06-29" }, "leading", null)).toEqual({ k: 58, n: 440 });
    expect(spanCounts(STATE, { from: "2026-06-22", to: "2026-06-21" }, "leading", null)).toEqual({ k: 0, n: 0 });
  });

  it("never reads the provisional weeks or the weeks between the spans", () => {
    // A span of the provisional weeks reads their poison, which proves the sums above left it out.
    expect(spanCounts(STATE, RANGES.provisional, "leading", "biology")).toEqual({ k: 8000, n: 8000 });
    expect(spanCounts(STATE, { from: "2020-01-06", to: "2020-01-12" }, "all", "earth")).toEqual({ k: 1000, n: 1000 });
  });

  it("counts a week with no papers as zero papers and goes on", () => {
    const weeks: PaceWeek[] = ["2026-06-01", "2026-06-08", "2026-06-15"].map((week_start, i) => ({
      week_start, fetched: "2026-11-23", provisional: false,
      leading: weekCountsOf({ ...LEAD, humanities: { base: [0, 0], win: i === 1 ? [2, 5] : [0, 0], year: [0, 0] } }, "win"),
      all: weekCountsOf(ALL, "win"),
    }));
    expect(spanCounts(weeks, { from: "2026-06-01", to: "2026-06-21" }, "leading", "humanities")).toEqual({ k: 2, n: 5 });
    expect(spanCounts(weeks, { from: "2026-06-01", to: "2026-06-07" }, "leading", "humanities")).toEqual({ k: 0, n: 0 });
  });

  it("refuses a span with a week the state lacks, naming its Monday, so that a gap never undercounts", () => {
    const gap = STATE.filter((w) => w.week_start !== "2026-07-06");
    expect(() => spanCounts(gap, RANGES.window, "leading", null)).toThrow(new RangeError("The weekly state has no week starting 2026-07-06"));
    expect(() => spanCounts(STATE, { from: "2026-06-23", to: "2026-07-05" }, "leading", null)).toThrow(new RangeError("The weekly state has no week starting 2026-06-23"));
    expect(() => spanCounts(STATE.slice(0, 10), RANGES.window, "leading", null)).toThrow(new RangeError("The weekly state has no week starting 2026-06-22"));
  });
});

describe("shareOf", () => {
  // The 80% Wilson interval for k of n at z = 1.28155 (z squared 1.642374): centre (p + z2 / 2n) / (1 + z2 / n), half
  // z sqrt(p (1 - p) / n + z2 / 4n2) / (1 + z2 / n). Bounds and the share are stored to 4 decimals.
  it("stores the share and its Wilson interval to 4 decimals", () => {
    expect(shareOf(338, 2860)).toEqual({ k: 338, n: 2860, share: 0.1182, ci80: [0.1107, 0.1261] }); // 338 / 2860 = 0.118182
    expect(shareOf(377, 2860)).toEqual({ k: 377, n: 2860, share: 0.1318, ci80: [0.1239, 0.1401] });
    expect(shareOf(3, 7)).toEqual({ k: 3, n: 7, share: 0.4286, ci80: [0.226, 0.6583] }); //             3 / 7 = 0.428571
    expect(shareOf(1, 40)).toEqual({ k: 1, n: 40, share: 0.025, ci80: [0.0075, 0.08] });
    expect(shareOf(84, 1000)).toEqual({ k: 84, n: 1000, share: 0.084, ci80: [0.0734, 0.0959] });
  });

  it("clamps the interval to [0, 1]: none in 5 has the upper bound z2 / (n + z2), all 5 the lower bound n / (n + z2)", () => {
    // 1.642374 / (5 + 1.642374) = 0.247262 and 5 / (5 + 1.642374) = 0.752738.
    expect(shareOf(0, 5)).toEqual({ k: 0, n: 5, share: 0, ci80: [0, 0.2473] });
    expect(shareOf(5, 5)).toEqual({ k: 5, n: 5, share: 1, ci80: [0.7527, 1] });
    expect(shareOf(0, 1)).toEqual({ k: 0, n: 1, share: 0, ci80: [0, 0.6216] }); // 1.642374 / 2.642374 = 0.621576
    expect(shareOf(1, 1)).toEqual({ k: 1, n: 1, share: 1, ci80: [0.3784, 1] }); // 1 / 2.642374 = 0.378424
  });

  it("rounds a half up on the printed decimal, as the stored values of §4.1 do", () => {
    // 1 / 20,000 = 0.00005 exactly: half up is 0.0001. 8,449 / 100,000 = 0.08449 stores as 0.0845.
    expect(shareOf(1, 20000)).toEqual({ k: 1, n: 20000, share: 0.0001, ci80: [0, 0.0002] });
    expect(shareOf(8449, 100000)).toEqual({ k: 8449, n: 100000, share: 0.0845, ci80: [0.0834, 0.0856] });
  });

  it("is the share 0 with the interval [0, 1] when there are no papers, and never asks for an interval", () => {
    expect(shareOf(0, 0)).toEqual({ k: 0, n: 0, share: 0, ci80: [0, 1] });
  });

  it("gives a value the Share schema accepts, an empty one included", () => {
    for (const [k, n] of [[338, 2860], [0, 5], [5, 5], [0, 0], [1, 20000], [8449, 100000], [0, 1], [1, 1]] as const) {
      expect(Share.safeParse(shareOf(k, n)).success, `${k} of ${n}`).toBe(true);
    }
  });

  it("refuses a count that is not a whole number with 0 <= k <= n", () => {
    // Each count alone is the fault, so each test of the condition has to catch its own; the message names both counts.
    for (const [k, n] of [[-1, 5], [6, 5], [1.5, 5], [1, 5.5], [Number.NaN, 5], [1, Number.NaN], [1, 0]] as const) {
      expect(() => shareOf(k, n), `${k} of ${n}`).toThrow(new RangeError(`A share needs 0 ≤ k ≤ n, got k=${k}, n=${n}`));
    }
  });
});

// ── The verdicts ─────────────────────────────────────────────────────────────────────────────────

describe("vsBaseline (SPEC §5.3)", () => {
  // Each row: the window, the baseline, the settings and the verdict; the Newcombe interval of the difference (window - baseline,
  // computed outside the code) and the ratio of the shares are in the comment. min_cases 30 and min_ratio 1.25 unless it says.
  const rows: [string, Tally, Tally, Partial<PaceSettings>, VsBaseline][] = [
    ["29 cases is too few, whatever the share", t(29, 100), t(1000, 100000), {}, "too_few"], //        interval [0.2256, 0.3412]
    ["30 cases is enough", t(30, 100), t(1000, 100000), {}, "higher"], //                           [0.2349, 0.3516], ratio 30
    ["exactly 1.25 times, equal n, is higher", t(1250, 10000), t(1000, 10000), {}, "higher"], //      [0.0193, 0.0307], ratio 1.25
    ["a hair under 1.25 times is no clear change", t(1249, 10000), t(1000, 10000), {}, "no_clear_change"], // [0.0192, 0.0306], 1.249
    ["exactly 1.25 times, unequal n, is higher", t(1500, 10000), t(6000, 50000), {}, "higher"], //     [0.0251, 0.0350]; 1500 x 50000 = 1.25 x 6000 x 10000
    ["a hair under, unequal n, is no clear change", t(1499, 10000), t(6000, 50000), {}, "no_clear_change"], // 1499 x 50000 = 74,950,000 < 75,000,000
    ["exactly 0.8 times is lower", t(800, 10000), t(10000, 100000), {}, "lower"], //                   [-0.0236, -0.0163]; 800 x 100000 x 1.25 = 10000 x 10000
    ["a hair over 0.8 times is no clear change", t(801, 10000), t(10000, 100000), {}, "no_clear_change"], // 801 x 100000 x 1.25 = 100,125,000 > 100,000,000
    ["1.25 times but the interval holds 0", t(30, 300), t(4, 50), {}, "no_clear_change"], //          [-0.0466, 0.0642]
    ["wholly above 0 but only 1.2 times", t(1200, 10000), t(1000, 10000), {}, "no_clear_change"], //  [0.0143, 0.0257]
    ["wholly below 0 but only 0.9 times", t(900, 10000), t(10000, 100000), {}, "no_clear_change"], // [-0.0138, -0.0061]
    ["0.6 times but the interval holds 0", t(30, 1000), t(5, 100), {}, "no_clear_change"], //          [-0.0564, 0.0027]
    ["equal shares", t(300, 1000), t(300, 1000), {}, "no_clear_change"], //                           [-0.0263, 0.0263]
    ["a baseline of none in 1,000 is any ratio", t(40, 100), t(0, 1000), {}, "higher"], //             [0.3393, 0.4639]
    ["a baseline with no papers is too few", t(40, 100), t(0, 0), {}, "too_few"],
    ["a window with no papers is too few even when 0 cases are enough", t(0, 0), t(10, 100), { min_cases: 0 }, "too_few"],
    ["no papers anywhere is too few even when 0 cases are enough", t(0, 0), t(0, 0), { min_cases: 0 }, "too_few"],
    ["no AI-method paper of 100 is lower when 0 cases are enough", t(0, 100), t(10, 100), { min_cases: 0 }, "lower"], // [-0.1451, -0.0640]
    ["1.2 times is higher when min_ratio is 1.1", t(1200, 10000), t(1000, 10000), { min_ratio: 1.1 }, "higher"],
    ["1.25 times is no clear change when min_ratio is 1.3", t(1250, 10000), t(1000, 10000), { min_ratio: 1.3 }, "no_clear_change"],
    ["0.9 times is lower when min_ratio is 1.1", t(900, 10000), t(10000, 100000), { min_ratio: 1.1 }, "lower"],
    ["0.91 times is not, since 1 / 1.1 is 0.909", t(910, 10000), t(10000, 100000), { min_ratio: 1.1 }, "no_clear_change"],
    ["99 cases is too few when min_cases is 100", t(99, 100), t(1000, 100000), { min_cases: 100 }, "too_few"],
    ["100 cases is enough when min_cases is 100", t(100, 100), t(1000, 100000), { min_cases: 100 }, "higher"],
  ];

  for (const [name, window, baseline, settings, expected] of rows) {
    it(`${name}: ${expected}`, () => {
      expect(vsBaseline(window, baseline, { ...SETTINGS, ...settings })).toBe(expected);
    });
  }
});

describe("vsYearAgo (SPEC §5.3)", () => {
  const rows: [string, Tally, Tally, Partial<PaceSettings>, VsYearAgo][] = [
    ["15% against 10% of 1,000 is up", t(150, 1000), t(100, 1000), {}, "up"], //                  interval [0.0311, 0.0689]
    ["10% against 15% of 1,000 is down", t(100, 1000), t(150, 1000), {}, "down"], //              [-0.0689, -0.0311]
    ["10.5% against 10% of 1,000 is level", t(105, 1000), t(100, 1000), {}, "level"], //          [-0.0124, 0.0224]
    ["30 of 100 each is level", t(30, 100), t(30, 100), {}, "level"], //                          [-0.0826, 0.0826]
    ["30% against 3% is up", t(300, 1000), t(30, 1000), {}, "up"], //                             [0.2502, 0.2899]
    ["3% against 30% is down", t(30, 1000), t(300, 1000), {}, "down"], //                         [-0.2899, -0.2502]
    ["a window of 29 cases is too few, whatever the change", t(29, 1000), t(100, 1000), {}, "too_few"], // would be down: [-0.0852, -0.0572]
    ["a year-ago window of 29 cases is too few, whatever the change", t(100, 1000), t(29, 1000), {}, "too_few"], // would be up
    ["a window with no papers is too few even when 0 cases are enough", t(0, 0), t(30, 100), { min_cases: 0 }, "too_few"],
    ["a year-ago window with no papers is too few even when 0 cases are enough", t(30, 100), t(0, 0), { min_cases: 0 }, "too_few"],
    ["99 cases is too few when min_cases is 100", t(99, 1000), t(200, 1000), { min_cases: 100 }, "too_few"],
    ["100 cases each is enough when min_cases is 100", t(100, 1000), t(200, 1000), { min_cases: 100 }, "down"],
  ];

  for (const [name, window, yearAgo, settings, expected] of rows) {
    it(`${name}: ${expected}`, () => {
      expect(vsYearAgo(window, yearAgo, { ...SETTINGS, ...settings })).toBe(expected);
    });
  }
});

describe("a bound at exactly 0 (SPEC §5.3: wholly above 0, wholly below 0)", () => {
  // No counts give a Newcombe bound of exactly 0, so the interval is handed to the verdict for one call. A bound at 0 is not
  // wholly above or wholly below 0, whatever the ratio, so the verdict is the middle one, though the same counts say more on
  // their own interval (each row's first line).
  const withInterval = (interval: [number, number]): void => {
    vi.mocked(newcombe80).mockReturnValueOnce(interval);
  };

  it("vsBaseline is no clear change when the lower bound is 0", () => {
    expect(vsBaseline(t(30, 100), t(1000, 100000), SETTINGS)).toBe("higher"); // [0.2349, 0.3516], 30 times
    withInterval([0, 0.3516]);
    expect(vsBaseline(t(30, 100), t(1000, 100000), SETTINGS)).toBe("no_clear_change");
  });

  it("vsBaseline is no clear change when the upper bound is 0", () => {
    expect(vsBaseline(t(800, 10000), t(10000, 100000), SETTINGS)).toBe("lower"); // [-0.0236, -0.0163], 0.8 times
    withInterval([-0.0236, 0]);
    expect(vsBaseline(t(800, 10000), t(10000, 100000), SETTINGS)).toBe("no_clear_change");
  });

  it("vsYearAgo is level when the lower bound is 0", () => {
    expect(vsYearAgo(t(150, 1000), t(100, 1000), SETTINGS)).toBe("up"); // [0.0311, 0.0689]
    withInterval([0, 0.0689]);
    expect(vsYearAgo(t(150, 1000), t(100, 1000), SETTINGS)).toBe("level");
  });

  it("vsYearAgo is level when the upper bound is 0", () => {
    expect(vsYearAgo(t(100, 1000), t(150, 1000), SETTINGS)).toBe("down"); // [-0.0689, -0.0311]
    withInterval([-0.0689, 0]);
    expect(vsYearAgo(t(100, 1000), t(150, 1000), SETTINGS)).toBe("level");
  });
});

describe("paceCell", () => {
  it("is the three shares and the two verdicts of the pooled leading counts", () => {
    expect(paceCell(t(377, 2860), t(3900, 57200), t(325, 2860), SETTINGS)).toEqual(LEADING_POOLED);
  });

  it("is a cell the schema accepts when a share has no papers", () => {
    const cell = paceCell(t(0, 0), t(0, 0), t(0, 0), SETTINGS);
    expect(cell).toEqual({
      window: shareOf(0, 0), baseline: shareOf(0, 0), year_ago: shareOf(0, 0), vs_baseline: "too_few", vs_year_ago: "too_few",
    });
    expect(PaceSet.safeParse({ pooled: cell, by_field: Object.fromEntries(FIELDS.map((f) => [f, cell])) }).success).toBe(true);
  });
});

// ── The pooled and per-field cells ───────────────────────────────────────────────────────────────

describe("paceSet", () => {
  const leading = paceSet(STATE, RANGES, "leading", SETTINGS);
  const all = paceSet(STATE, RANGES, "all", SETTINGS);

  it("gives A's pooled cell in full, the seven fields added up", () => {
    expect(leading.pooled).toEqual(LEADING_POOLED);
  });

  it("gives B's pooled cell in full", () => {
    expect(all.pooled).toEqual(ALL_POOLED);
  });

  it("gives A's cell for each of the seven fields, in the order of FIELDS", () => {
    expectRows(leading, LEADING_ROWS);
  });

  it("gives B's cell for each of the seven fields", () => {
    expectRows(all, ALL_ROWS);
  });

  it("gives biology in full, with its shares and intervals", () => {
    expect(leading.by_field.biology).toEqual({
      window: { k: 130, n: 520, share: 0.25, ci80: [0.2265, 0.2751] },
      baseline: { k: 1040, n: 10400, share: 0.1, ci80: [0.0963, 0.1038] },
      year_ago: { k: 104, n: 520, share: 0.2, ci80: [0.1785, 0.2234] },
      vs_baseline: "higher", // Newcombe [0.1262, 0.1754], 2.5 times
      vs_year_ago: "up", //     Newcombe [0.0168, 0.0831]
    });
  });

  it("gives earth, no clear change and down, in full", () => {
    expect(leading.by_field.earth).toEqual({
      window: { k: 39, n: 520, share: 0.075, ci80: [0.0615, 0.0912] },
      baseline: { k: 780, n: 10400, share: 0.075, ci80: [0.0718, 0.0784] },
      year_ago: { k: 65, n: 520, share: 0.125, ci80: [0.1076, 0.1448] },
      vs_baseline: "no_clear_change", // Newcombe [-0.0139, 0.0165]
      vs_year_ago: "down", //            Newcombe [-0.0739, -0.0262]
    });
  });

  it("gives humanities, a field with no papers in the leading journals, empty shares and verdicts of too few", () => {
    const empty = { k: 0, n: 0, share: 0, ci80: [0, 1] };
    expect(leading.by_field.humanities).toEqual({ window: empty, baseline: empty, year_ago: empty, vs_baseline: "too_few", vs_year_ago: "too_few" });
  });

  it("gives a result the PaceSet schema accepts, for A and for B", () => {
    expect(PaceSet.safeParse(leading).success).toBe(true);
    expect(PaceSet.safeParse(all).success).toBe(true);
  });

  it("reads each span from its own weeks, whatever the order of the state", () => {
    expect(paceSet([...STATE].reverse(), RANGES, "leading", SETTINGS)).toEqual(leading);
  });

  it("reads the cutoff's ranges: a different cutoff reads other weeks (the provisional weeks join the window when 0 are provisional)", () => {
    // With no provisional weeks the window is the 13 weeks to 2026-11-15, which hold poison in the first 8 weeks.
    const poisoned = paceSet(STATE, paceRanges(CUTOFF, { window_weeks: 13, provisional_weeks: 1 }), "leading", SETTINGS);
    expect(poisoned.pooled.window.k).toBeGreaterThan(5000);
  });

  it("refuses a state that lacks a week of the window, the year-ago window or the baseline", () => {
    const without = (monday: string) => STATE.filter((w) => w.week_start !== monday);
    expect(() => paceSet(without("2026-06-22"), RANGES, "leading", SETTINGS)).toThrow(new RangeError("The weekly state has no week starting 2026-06-22"));
    expect(() => paceSet(without("2025-09-15"), RANGES, "all", SETTINGS)).toThrow(new RangeError("The weekly state has no week starting 2025-09-15"));
    expect(() => paceSet(without("2019-12-23"), RANGES, "leading", SETTINGS)).toThrow(new RangeError("The weekly state has no week starting 2019-12-23"));
    expect(() => paceSet(without("2015-01-05"), RANGES, "leading", SETTINGS)).toThrow(new RangeError("The weekly state has no week starting 2015-01-05"));
  });
});

// ── quotable ─────────────────────────────────────────────────────────────────────────────────────

describe("paceQuotable", () => {
  const leading = paceSet(STATE, RANGES, "leading", SETTINGS);
  const all = paceSet(STATE, RANGES, "all", SETTINGS);

  it("holds every displayed share of A and B by path, each as the page prints it", () => {
    const quotable = paceQuotable({ leading, all });
    expect(quotable).toEqual({ ...LEADING_QUOTABLE, ...ALL_QUOTABLE });
    expect(Object.keys(quotable)).toHaveLength(45); // 2 sets x 8 cells x 3 shares = 48, less humanities' 3 empty shares in A
  });

  it("has no entry for a share with no papers, and keeps the other shares of the same cell", () => {
    const quotable = paceQuotable({ leading, all });
    for (const part of ["window", "baseline", "year_ago"]) expect(quotable[`pace.leading.by_field.humanities.${part}`]).toBeUndefined();
    expect(quotable["pace.all.by_field.humanities.window"]).toBe("1.0%");
    const half = paceSet(STATE, RANGES, "leading", SETTINGS);
    const partial = { ...half, by_field: { ...half.by_field, earth: { ...half.by_field.earth, year_ago: shareOf(0, 0) } } };
    const q = paceQuotable({ leading: partial, all });
    expect(q["pace.leading.by_field.earth.year_ago"]).toBeUndefined();
    expect(q["pace.leading.by_field.earth.window"]).toBe("7.5%");
    expect(q["pace.leading.by_field.earth.baseline"]).toBe("7.5%");
  });

  it("prints each share from its counts and never from the stored fraction", () => {
    // 8,449 of 100,000 stores as 0.0845, which would print 8.5%; the counts give floor((2000 x 8449 + 100000) / 200000) = 84 tenths.
    const stored = shareOf(8449, 100000);
    expect(stored.share).toBe(0.0845);
    const cell: PaceCell = { window: stored, baseline: shareOf(1, 1000), year_ago: shareOf(0, 0), vs_baseline: "higher", vs_year_ago: "too_few" };
    const set = { pooled: cell, by_field: Object.fromEntries(FIELDS.map((f) => [f, cell])) as Record<FieldId, PaceCell> };
    const q = paceQuotable({ leading: set, all: set });
    expect(q["pace.leading.pooled.window"]).toBe("8.4%");
    expect(q["pace.all.by_field.physics.window"]).toBe("8.4%");
    expect(q["pace.leading.pooled.baseline"]).toBe("0.1%");
    expect(q["pace.leading.pooled.year_ago"]).toBeUndefined();
  });

  it("has an entry for a share of one paper: 1 of 1 is 100.0% and 0 of 1 is 0.0%, while 0 of 0 has none", () => {
    const cell: PaceCell = { window: shareOf(1, 1), baseline: shareOf(0, 1), year_ago: shareOf(0, 0), vs_baseline: "too_few", vs_year_ago: "too_few" };
    const set = { pooled: cell, by_field: Object.fromEntries(FIELDS.map((f) => [f, cell])) as Record<FieldId, PaceCell> };
    const q = paceQuotable({ leading: set, all: set });
    expect(q["pace.leading.pooled.window"]).toBe("100.0%");
    expect(q["pace.all.by_field.earth.baseline"]).toBe("0.0%");
    expect(q["pace.leading.pooled.year_ago"]).toBeUndefined();
    expect(Object.keys(q)).toHaveLength(32); // 2 sets x 8 cells x 2 shares
  });

  it("writes a figure that is a whole percent with its decimal", () => {
    expect(paceQuotable({ leading, all })["pace.leading.by_field.biology.window"]).toBe("25.0%");
  });
});

describe("fieldVerdicts", () => {
  const byField = (verdicts: VsBaseline[]): Record<FieldId, PaceCell> =>
    Object.fromEntries(FIELDS.map((f, i) => [f, { ...paceCell(t(0, 0), t(0, 0), t(0, 0), SETTINGS), vs_baseline: verdicts[i]! }])) as Record<FieldId, PaceCell>;

  it("counts the fields that are higher and the fields that are too few, by vs_baseline", () => {
    expect(fieldVerdicts(byField(["higher", "higher", "too_few", "lower", "no_clear_change", "higher", "too_few"]))).toEqual({ above: 3, tooFew: 2 });
    expect(fieldVerdicts(byField(Array(7).fill("higher") as VsBaseline[]))).toEqual({ above: 7, tooFew: 0 });
    expect(fieldVerdicts(byField(Array(7).fill("too_few") as VsBaseline[]))).toEqual({ above: 0, tooFew: 7 });
    expect(fieldVerdicts(byField(["lower", "lower", "no_clear_change", "lower", "no_clear_change", "lower", "lower"]))).toEqual({ above: 0, tooFew: 0 });
  });

  it("reads the synthetic state: four fields higher, humanities too few", () => {
    expect(fieldVerdicts(paceSet(STATE, RANGES, "leading", SETTINGS).by_field)).toEqual({ above: 4, tooFew: 1 });
    expect(fieldVerdicts(paceSet(STATE, RANGES, "all", SETTINGS).by_field)).toEqual({ above: 3, tooFew: 3 });
  });
});

// ── The Pace sentence ────────────────────────────────────────────────────────────────────────────

describe("paceSentence", () => {
  // The SPEC's and STYLE-ZH's example: 8.4% in the window, 1.1% in 2015 to 2019, 6.9% a year earlier, the window ending 31 August.
  const WINDOW = { from: "2025-06-02", to: "2025-08-31" }; // 13 weeks, Monday to Sunday: 91 days
  type Pooled = Exclude<VsBaseline, "too_few">;

  const cell = (vsB: VsBaseline, vsY: VsYearAgo, w: [number, number] = [84, 1000], b: [number, number] = [11, 1000], y: [number, number] = [69, 1000]): PaceCell => ({
    window: shareOf(...w), baseline: shareOf(...b), year_ago: shareOf(...y), vs_baseline: vsB, vs_year_ago: vsY,
  });
  const leadingWith = (pooled: PaceCell, fields: VsBaseline[]): PaceSet => ({
    pooled,
    by_field: Object.fromEntries(FIELDS.map((f, i) => [f, cell(fields[i]!, "level")])) as Record<FieldId, PaceCell>,
  });
  const sixHigher: VsBaseline[] = ["higher", "higher", "higher", "higher", "higher", "higher", "no_clear_change"];
  /** The sentence of a block with this pooled cell and these fields' verdicts, with the Chinese as a string (it is never null). */
  const sentence = (pooled: PaceCell, fields: VsBaseline[] = sixHigher, window = WINDOW, stale?: string): { en: string; zh: string } => {
    const out = paceSentence({ window, leading: leadingWith(pooled, fields) }, stale);
    if (out.zh === null) throw new Error("The Pace sentence has a Chinese form");
    return { en: out.en, zh: out.zh };
  };

  const EN_FIRST = "The Pace: 8.4% of papers in leading journals named AI methods in the 13 weeks to 31 Aug.";
  const ZH_FIRST = "進度：截至 8 月 31 日的 13 週內，主要期刊有 8.4% 的論文提到 AI 方法";
  const EN_SIX = "Clearly above the pre-AI level in 6 of 7 fields.";
  const ZH_SIX = "7 個領域中有 6 個明顯高於 AI 出現之前。";

  it("is the SPEC's own example in English and in Chinese, word for word", () => {
    expect(sentence(cell("higher", "up"))).toEqual({
      en: "The Pace: 8.4% of papers in leading journals named AI methods in the 13 weeks to 31 Aug. "
        + "That is up from 1.1% in 2015 to 2019, and up from 6.9% a year earlier. "
        + "Clearly above the pre-AI level in 6 of 7 fields.",
      zh: "進度：截至 8 月 31 日的 13 週內，主要期刊有 8.4% 的論文提到 AI 方法，高於 2015 至 2019 年的 1.1%，也高於一年前的 6.9%。7 個領域中有 6 個明顯高於 AI 出現之前。",
    });
  });

  it("is STYLE-ZH's second example, no clear change and level with none of the fields above and two with too few cases, word for word", () => {
    const pooled = cell("no_clear_change", "level", [24, 1000], [22, 1000], [23, 1000]);
    const fields: VsBaseline[] = ["too_few", "too_few", "no_clear_change", "no_clear_change", "no_clear_change", "no_clear_change", "no_clear_change"];
    expect(sentence(pooled, fields)).toEqual({
      en: "The Pace: 2.4% of papers in leading journals named AI methods in the 13 weeks to 31 Aug. "
        + "That is no clear change from 2.2% in 2015 to 2019 or from 2.3% a year earlier. "
        + "Clearly above the pre-AI level in none of the 7 fields. Too few cases to judge in 2.",
      zh: "進度：截至 8 月 31 日的 13 週內，主要期刊有 2.4% 的論文提到 AI 方法，與 2015 至 2019 年的 2.2% 相比沒有明顯變化，與一年前的 2.3% 相比也沒有明顯變化。"
        + "7 個領域中沒有一個明顯高於 AI 出現之前。有 2 個領域的案例太少，無法判斷。",
    });
  });

  // The twelve pairs of verdicts (SPEC §5.2's table, STYLE-ZH §14's table): the baseline clause and the year-ago clause as one.
  const PAIRS: [Pooled, VsYearAgo, string, string][] = [
    ["higher", "up", "That is up from 1.1% in 2015 to 2019, and up from 6.9% a year earlier.", "，高於 2015 至 2019 年的 1.1%，也高於一年前的 6.9%。"],
    ["higher", "down", "That is up from 1.1% in 2015 to 2019, but down from 6.9% a year earlier.", "，高於 2015 至 2019 年的 1.1%，但低於一年前的 6.9%。"],
    ["higher", "level", "That is up from 1.1% in 2015 to 2019, with no clear change from 6.9% a year earlier.", "，高於 2015 至 2019 年的 1.1%，與一年前的 6.9% 相比沒有明顯變化。"],
    ["higher", "too_few", "That is up from 1.1% in 2015 to 2019.", "，高於 2015 至 2019 年的 1.1%。"],
    ["lower", "up", "That is down from 1.1% in 2015 to 2019, but up from 6.9% a year earlier.", "，低於 2015 至 2019 年的 1.1%，但高於一年前的 6.9%。"],
    ["lower", "down", "That is down from 1.1% in 2015 to 2019, and down from 6.9% a year earlier.", "，低於 2015 至 2019 年的 1.1%，也低於一年前的 6.9%。"],
    ["lower", "level", "That is down from 1.1% in 2015 to 2019, with no clear change from 6.9% a year earlier.", "，低於 2015 至 2019 年的 1.1%，與一年前的 6.9% 相比沒有明顯變化。"],
    ["lower", "too_few", "That is down from 1.1% in 2015 to 2019.", "，低於 2015 至 2019 年的 1.1%。"],
    ["no_clear_change", "up", "That is no clear change from 1.1% in 2015 to 2019, but up from 6.9% a year earlier.", "，與 2015 至 2019 年的 1.1% 相比沒有明顯變化，但高於一年前的 6.9%。"],
    ["no_clear_change", "down", "That is no clear change from 1.1% in 2015 to 2019, but down from 6.9% a year earlier.", "，與 2015 至 2019 年的 1.1% 相比沒有明顯變化，但低於一年前的 6.9%。"],
    ["no_clear_change", "level", "That is no clear change from 1.1% in 2015 to 2019 or from 6.9% a year earlier.", "，與 2015 至 2019 年的 1.1% 相比沒有明顯變化，與一年前的 6.9% 相比也沒有明顯變化。"],
    ["no_clear_change", "too_few", "That is no clear change from 1.1% in 2015 to 2019.", "，與 2015 至 2019 年的 1.1% 相比沒有明顯變化。"],
  ];

  it("has all twelve pairs of verdicts in both languages: parts joined with a space in English and with nothing in Chinese", () => {
    expect(PAIRS).toHaveLength(12);
    for (const [base, year, en, zh] of PAIRS) {
      expect(sentence(cell(base, year)), `${base} ${year}`).toEqual({
        en: `${EN_FIRST} ${en} ${EN_SIX}`,
        zh: `${ZH_FIRST}${zh}${ZH_SIX}`,
      });
    }
  });

  it("leaves the year-ago share out of the sentence when the year-ago verdict is too few, even when the state holds one", () => {
    const out = sentence(cell("higher", "too_few"));
    expect(out.en).not.toContain("6.9%");
    expect(out.zh).not.toContain("6.9%");
  });

  it("says how many of the seven fields are clearly above the pre-AI level: all, none, or n of 7", () => {
    const higher = cell("higher", "up");
    // The Chinese clause starts at the full stop that ends the year-ago clause, so nothing may sit between them.
    const forms: [VsBaseline[], string, string][] = [
      [Array(7).fill("higher") as VsBaseline[], "Clearly above the pre-AI level in all 7 fields.", "。7 個領域全都明顯高於 AI 出現之前。"],
      [Array(7).fill("no_clear_change") as VsBaseline[], "Clearly above the pre-AI level in none of the 7 fields.", "。7 個領域中沒有一個明顯高於 AI 出現之前。"],
      [["higher", "lower", "lower", "no_clear_change", "lower", "lower", "lower"], "Clearly above the pre-AI level in 1 of 7 fields.", "。7 個領域中有 1 個明顯高於 AI 出現之前。"],
      [["higher", "higher", "lower", "no_clear_change", "lower", "higher", "lower"], "Clearly above the pre-AI level in 3 of 7 fields.", "。7 個領域中有 3 個明顯高於 AI 出現之前。"],
      [["higher", "higher", "higher", "higher", "higher", "higher", "lower"], "Clearly above the pre-AI level in 6 of 7 fields.", "。7 個領域中有 6 個明顯高於 AI 出現之前。"],
    ];
    for (const [fields, en, zh] of forms) {
      const out = sentence(higher, fields);
      expect(out.en.endsWith(` ${en}`), en).toBe(true);
      expect(out.zh.endsWith(zh), zh).toBe(true);
    }
  });

  it("adds how many fields have too few cases, in both languages, and nothing when none does", () => {
    const higher = cell("higher", "up");
    const withTooFew = (n: number): VsBaseline[] => [...Array(n).fill("too_few"), ...Array(7 - n).fill("no_clear_change")] as VsBaseline[];
    expect(sentence(higher, withTooFew(0)).en.endsWith("none of the 7 fields.")).toBe(true);
    expect(sentence(higher, withTooFew(0)).zh.endsWith("無法判斷。")).toBe(false);
    for (const n of [1, 2, 7]) {
      const out = sentence(higher, withTooFew(n));
      expect(out.en.endsWith(`in none of the 7 fields. Too few cases to judge in ${n}.`), String(n)).toBe(true);
      expect(out.zh.endsWith(`7 個領域中沒有一個明顯高於 AI 出現之前。有 ${n} 個領域的案例太少，無法判斷。`), String(n)).toBe(true);
    }
    const mixed = sentence(higher, ["higher", "higher", "higher", "too_few", "too_few", "lower", "no_clear_change"]);
    expect(mixed.en.endsWith("in 3 of 7 fields. Too few cases to judge in 2.")).toBe(true);
    expect(mixed.zh.endsWith("7 個領域中有 3 個明顯高於 AI 出現之前。有 2 個領域的案例太少，無法判斷。")).toBe(true);
  });

  it("is the one fixed sentence when the pooled cell has too few cases, whatever else the cell and the fields say", () => {
    const tooFew = cell("too_few", "up");
    expect(sentence(tooFew)).toEqual({
      en: "The Pace: too few papers named AI methods in the 13 weeks to 31 Aug to compare with 2015 to 2019.",
      zh: "進度：截至 8 月 31 日的 13 週內，提到 AI 方法的論文太少，無法與 2015 至 2019 年比較。",
    });
    expect(sentence(tooFew, Array(7).fill("higher") as VsBaseline[])).toEqual(sentence(tooFew, Array(7).fill("too_few") as VsBaseline[]));
  });

  it("prints the share from the counts and never from the stored fraction", () => {
    // 8,449 of 100,000 stores as 0.0845; the sentence says 8.4%.
    const out = sentence(cell("higher", "up", [8449, 100000]));
    expect(out.en).toContain("The Pace: 8.4% of papers");
    expect(out.zh).toContain("主要期刊有 8.4% 的論文");
  });

  it("gets the number of weeks from the window: 12 weeks, 13 weeks", () => {
    const twelve = sentence(cell("higher", "up"), sixHigher, { from: "2025-06-09", to: "2025-08-31" });
    expect(twelve.en).toContain("in the 12 weeks to 31 Aug.");
    expect(twelve.zh).toContain("截至 8 月 31 日的 12 週內");
    const tooFewTwelve = sentence(cell("too_few", "up"), sixHigher, { from: "2025-06-09", to: "2025-08-31" });
    expect(tooFewTwelve.en).toContain("in the 12 weeks to 31 Aug to compare");
    expect(tooFewTwelve.zh).toContain("截至 8 月 31 日的 12 週內，提到");
    expect(sentence(cell("higher", "up")).en).toContain("in the 13 weeks to 31 Aug.");
  });

  it("reads a window of one week as 'the week' in English and '1 週' in Chinese, and a window of two as '2 weeks'", () => {
    const one = { from: "2025-08-25", to: "2025-08-31" }; // 7 days
    expect(sentence(cell("higher", "up"), sixHigher, one).en).toContain("named AI methods in the week to 31 Aug.");
    expect(sentence(cell("higher", "up"), sixHigher, one).zh).toContain("截至 8 月 31 日的 1 週內，主要期刊有");
    expect(sentence(cell("too_few", "up"), sixHigher, one).en).toContain("named AI methods in the week to 31 Aug to compare");
    expect(sentence(cell("too_few", "up"), sixHigher, one).zh).toContain("截至 8 月 31 日的 1 週內，提到");
    const two = { from: "2025-08-18", to: "2025-08-31" }; // 14 days
    expect(sentence(cell("higher", "up"), sixHigher, two).en).toContain("named AI methods in the 2 weeks to 31 Aug.");
    expect(sentence(cell("higher", "up"), sixHigher, two).zh).toContain("截至 8 月 31 日的 2 週內");
  });

  it("refuses a window that is not a whole number of weeks, one week at least", () => {
    const refused = [
      { from: "2025-06-02", to: "2025-08-30" }, //  90 days: 12 weeks and 6 days
      { from: "2025-08-25", to: "2025-08-27" }, //   3 days
      { from: "2025-08-25", to: "2025-09-05" }, //  12 days, a multiple of 6 and not of 7
      { from: "2025-08-25", to: "2025-09-09" }, //  16 days, a multiple of 8 and not of 7
      { from: "2025-08-31", to: "2025-08-25" }, //  Sunday back to Monday: -5 days
      { from: "2025-08-31", to: "2025-08-30" }, //   0 days: the day before the start
      { from: "2025-08-31", to: "2025-08-23" }, //  -7 days, a multiple of 7 below one week
    ];
    for (const window of refused) {
      const message = new RangeError(`A window is whole weeks, got ${window.from} to ${window.to}`);
      expect(() => sentence(cell("higher", "up"), sixHigher, window), `${window.from} ${window.to}`).toThrow(message);
      expect(() => sentence(cell("too_few", "up"), sixHigher, window), `${window.from} ${window.to}`).toThrow(message);
    }
  });

  it("gives the date as the day and the short month in English and as month and day in Chinese, with no leading zero", () => {
    const out = sentence(cell("higher", "up"), sixHigher, { from: "2025-02-24", to: "2025-05-25" });
    expect(out.en).toContain("in the 13 weeks to 25 May.");
    expect(out.zh).toContain("截至 5 月 25 日的 13 週內");
    const early = sentence(cell("higher", "up"), sixHigher, { from: "2025-02-03", to: "2025-05-04" });
    expect(early.en).toContain("to 4 May.");
    expect(early.zh).toContain("截至 5 月 4 日的 13 週內");
  });

  it("puts the stale line first when the state is the last good one, dated by the cutoff", () => {
    const stale = sentence(cell("higher", "up"), sixHigher, WINDOW, "2026-09-06");
    const plain = sentence(cell("higher", "up"));
    expect(stale.en).toBe(`(Data to 6 Sep; today's figures are not available.) ${plain.en}`);
    expect(stale.zh).toBe(`（資料截至 9 月 6 日；今日數字無法取得。）${plain.zh}`);
    const staleFew = sentence(cell("too_few", "up"), sixHigher, WINDOW, "2026-11-15");
    expect(staleFew.en.startsWith("(Data to 15 Nov; today's figures are not available.) The Pace: too few papers")).toBe(true);
    expect(staleFew.zh.startsWith("（資料截至 11 月 15 日；今日數字無法取得。）進度：截至 8 月 31 日")).toBe(true);
  });

  it("has a fixed sentence for a morning with no Pace at all", () => {
    expect(PACE_MISSING).toEqual({ en: "The Pace is not available today.", zh: "今日無法取得進度。" });
  });

  it("says the same about the synthetic state in both languages", () => {
    expect(paceSentence({ window: RANGES.window, leading: paceSet(STATE, RANGES, "leading", SETTINGS) })).toEqual(STATE_SENTENCE);
  });
});

// ── The whole block ──────────────────────────────────────────────────────────────────────────────

describe("buildPace", () => {
  const input = { weeks: STATE, cutoff: CUTOFF, settings: SETTINGS };
  const block = buildPace(input);

  it("gives the ranges of the cutoff: the window, the first provisional week, the baseline and the year-ago window", () => {
    expect(block.window).toEqual({ from: "2026-06-22", to: "2026-09-20" });
    expect(block.provisional_from).toBe("2026-09-21");
    expect(block.baseline).toEqual({ from: "2015-01-05", to: "2019-12-29" });
    expect(block.year_ago).toEqual({ from: "2025-06-23", to: "2025-09-21" });
  });

  it("gives A's and B's cells as worked by hand", () => {
    expect(block.leading.pooled).toEqual(LEADING_POOLED);
    expect(block.all.pooled).toEqual(ALL_POOLED);
    expectRows(block.leading, LEADING_ROWS);
    expectRows(block.all, ALL_ROWS);
  });

  it("gives the sentence and every quotable figure", () => {
    expect(block.sentence).toEqual(STATE_SENTENCE);
    expect(block.quotable).toEqual({ ...LEADING_QUOTABLE, ...ALL_QUOTABLE });
  });

  it("gives a block that the PaceBlock schema accepts", () => {
    const parsed = PaceBlock.safeParse(block);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("adds the stale line to the sentence, dated by the cutoff, when the state is stale", () => {
    const stale = buildPace({ ...input, stale: true });
    expect(stale.sentence.en).toBe(`(Data to 15 Nov; today's figures are not available.) ${STATE_SENTENCE.en}`);
    expect(stale.sentence.zh).toBe(`（資料截至 11 月 15 日；今日數字無法取得。）${STATE_SENTENCE.zh}`);
    expect({ ...stale, sentence: block.sentence }).toEqual(block);
    expect(buildPace({ ...input, stale: false })).toEqual(block);
    expect(PaceBlock.safeParse(stale).success).toBe(true);
  });

  it("joins the extra quotable figures to the Pace's", () => {
    const joined = buildPace({ ...input, extraQuotable: { "landmarks.this_year": "5 of 9", hold: "15 of 23" } });
    expect(joined.quotable).toEqual({ ...LEADING_QUOTABLE, ...ALL_QUOTABLE, "landmarks.this_year": "5 of 9", hold: "15 of 23" });
    expect(PaceBlock.safeParse(joined).success).toBe(true);
    expect(buildPace({ ...input, extraQuotable: {} }).quotable).toEqual(block.quotable);
  });

  it("does not depend on the order of the weeks, and changes neither the weeks nor the settings", () => {
    expect(buildPace({ ...input, weeks: [...STATE].reverse() })).toEqual(block);
    const frozen = deepFreeze({ weeks: structuredClone(STATE), cutoff: CUTOFF, settings: { ...SETTINGS }, extraQuotable: { hold: "1 of 2" } });
    expect(buildPace(frozen).quotable.hold).toBe("1 of 2");
  });

  it("reads the lengths from the settings: a 4-week window and 2 provisional weeks", () => {
    const small = buildPace({ ...input, settings: { ...SETTINGS, window_weeks: 4, provisional_weeks: 2 } });
    expect(small.window).toEqual({ from: "2026-10-05", to: "2026-11-01" });
    expect(small.provisional_from).toBe("2026-11-02");
    expect(small.year_ago).toEqual({ from: "2025-10-06", to: "2025-11-02" });
  });

  it("refuses a cutoff that is not a Sunday and a state that lacks a week", () => {
    expect(() => buildPace({ ...input, cutoff: "2026-11-16" })).toThrow(new RangeError("The data cutoff is a Sunday, got 2026-11-16"));
    expect(() => buildPace({ ...input, weeks: STATE.filter((w) => w.week_start !== "2026-08-03") })).toThrow(new RangeError("The weekly state has no week starting 2026-08-03"));
    expect(() => buildPace({ ...input, weeks: STATE.slice(0, 600) })).toThrow(new RangeError("The weekly state has no week starting 2026-07-06"));
  });
});

describe("missingPace", () => {
  const block = missingPace("2026-11-23", SETTINGS);

  it("gives the ranges of the cutoff for D, as buildPace does", () => {
    expect(block.window).toEqual({ from: "2026-06-22", to: "2026-09-20" });
    expect(block.provisional_from).toBe("2026-09-21");
    expect(block.baseline).toEqual({ from: "2015-01-05", to: "2019-12-29" });
    expect(block.year_ago).toEqual({ from: "2025-06-23", to: "2025-09-21" });
    expect(block.window).toEqual(buildPace({ weeks: STATE, cutoff: CUTOFF, settings: SETTINGS }).window);
  });

  it("follows the date: a Tuesday's cutoff is that Sunday and a window of other lengths shows in the ranges", () => {
    expect(missingPace("2026-11-24", SETTINGS).window).toEqual({ from: "2026-06-29", to: "2026-09-27" });
    expect(missingPace("2026-11-23", { window_weeks: 4, provisional_weeks: 2 }).window).toEqual({ from: "2026-10-05", to: "2026-11-01" });
  });

  it("has every share empty, every verdict too few, the fixed sentence and no quotable figure", () => {
    const empty = { k: 0, n: 0, share: 0, ci80: [0, 1] };
    const cell = { window: empty, baseline: empty, year_ago: empty, vs_baseline: "too_few", vs_year_ago: "too_few" };
    expect(block.leading.pooled).toEqual(cell);
    expect(block.all.pooled).toEqual(cell);
    expect(Object.keys(block.leading.by_field)).toEqual([...FIELDS]);
    expect(Object.keys(block.all.by_field)).toEqual([...FIELDS]);
    for (const f of FIELDS) {
      expect(block.leading.by_field[f]).toEqual(cell);
      expect(block.all.by_field[f]).toEqual(cell);
    }
    expect(block.sentence).toEqual({ en: "The Pace is not available today.", zh: "今日無法取得進度。" });
    expect(block.quotable).toEqual({});
  });

  it("gives a block the PaceBlock schema accepts", () => {
    const parsed = PaceBlock.safeParse(block);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("shares no object between its cells, so changing one changes no other", () => {
    expect(block.leading.pooled).not.toBe(block.all.pooled);
    expect(block.leading.by_field.biology).not.toBe(block.leading.by_field.physics);
    expect(block.leading.pooled.window).not.toBe(block.leading.pooled.baseline);
    expect(block.sentence).not.toBe(PACE_MISSING);
    expect(block.window).not.toBe(block.year_ago);
  });
});
