// The Pace, A and B (SPEC §5.1 to §5.3, §4.7): from the weekly OpenAlex counts (`PaceWeek`, `content/state/pace-weekly.json`)
// and `config/run.json`'s `pace` settings, passed as a plain object, this computes the data cutoff, the provisional weeks, the
// 13-week window, the year-ago window and the 2015 to 2019 baseline; each cell's shares with their 80% Wilson intervals; the two
// verdicts; the pooled and per-field cells; `quotable`, the displayed figures the agent may quote; the Pace sentence in both
// languages in every form (§5.2, STYLE-ZH.md §14); and the whole `pace` block of a metrics file. Pure: no file, no network, no
// clock; a date, a setting and a state are always arguments, and nothing here fetches or reads a config file.
// A share with no papers is never given to `wilson80()`, `newcombe80()` or `pct1()`, which throw on it (§5.3): it stores share 0
// and the interval [0, 1], has the verdict `too_few`, and no `quotable` entry.
// Cyber's lib/metrics/window.ts (its directions from Newcombe intervals) and lib/chat.ts (the stale line) at the fork commit
// 3ced1fb, adapted: the Window, the Flood and the speed tests give way to this project's two verdicts over weekly field counts;
// the sentence templates, the provisional span and `buildPace()` are new.

import { addDays, dataCutoffFor, daysBetween, lastSunday, weekday } from "../dates";
import { dayMonth, zhDayMonth } from "../format";
import type { L10n } from "../i18n";
import type { IsoDate } from "../schema/common";
import { PACE_BASELINE, type PaceBlock, type PaceCell, type PaceSet, type PaceWeek, type Share, type VsBaseline, type VsYearAgo } from "../schema/metrics";
import { FIELDS, type FieldId } from "../vocab";
import { fmtPct1, newcombe80, round4, wilson80 } from "./stats";

/** `config/run.json`'s `pace` settings that the Pace reads (SPEC §4.11); `hold_after_days` is the Hold rate's. */
export interface PaceSettings {
  /** Weeks in the window and in the year-ago window: 13. */
  readonly window_weeks: number;
  /** The newest weeks, never used in the sentence because OpenAlex still adds papers to them: 8. */
  readonly provisional_weeks: number;
  /** Fewest AI-method papers in a window that a verdict may rest on: 30. */
  readonly min_cases: number;
  /** How many times the baseline's share the window's must be to be `higher`, and at most its reciprocal to be `lower`: 1.25. */
  readonly min_ratio: number;
}

/** A date range, both ends included. */
export interface Span {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/** `k` AI-method papers of `n` papers; a `Share` is one. */
export interface Tally {
  readonly k: number;
  readonly n: number;
}

/** The two sets of weekly counts: A, the leading journals, and B, all papers (SPEC §5). */
export type PaceSetName = "leading" | "all";

// ── The ranges (§5.3) ────────────────────────────────────────────────────────────────────────────

/** `data_cutoff` (SPEC §4.1, §5.3): the newest Sunday on or before D - 2. */
export function dataCutoff(date: IsoDate): IsoDate {
  return lastSunday(dataCutoffFor(date));
}

export interface PaceRanges {
  /** The Sunday that ends the newest week used. */
  readonly cutoff: IsoDate;
  /** The newest `provisional_weeks` weeks, Monday to the cutoff: charted and marked, never in the sentence. */
  readonly provisional: Span;
  /** The `window_weeks` weeks before the provisional ones, Monday to Sunday. */
  readonly window: Span;
  /** The window moved back 52 weeks (364 days). */
  readonly yearAgo: Span;
  /** 2015-01-05 to 2019-12-29: 260 weeks, before AI was widely used in research. */
  readonly baseline: Span;
}

function assertWeeks(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive whole number, got ${value}`);
}

/** The provisional span, the window, the year-ago window and the baseline for a data cutoff, which must be a Sunday (SPEC §5.3). */
export function paceRanges(cutoff: IsoDate, settings: Pick<PaceSettings, "window_weeks" | "provisional_weeks">): PaceRanges {
  if (weekday(cutoff) !== 0) throw new RangeError(`The data cutoff is a Sunday, got ${cutoff}`);
  assertWeeks(settings.window_weeks, "window_weeks");
  assertWeeks(settings.provisional_weeks, "provisional_weeks");
  const provisionalFrom = addDays(cutoff, -(7 * settings.provisional_weeks - 1));
  const windowTo = addDays(provisionalFrom, -1);
  const windowFrom = addDays(windowTo, -(7 * settings.window_weeks - 1));
  return {
    cutoff,
    provisional: { from: provisionalFrom, to: cutoff },
    window: { from: windowFrom, to: windowTo },
    yearAgo: { from: addDays(windowFrom, -364), to: addDays(windowTo, -364) },
    baseline: { from: PACE_BASELINE.from, to: PACE_BASELINE.to },
  };
}

// ── Counts and shares ────────────────────────────────────────────────────────────────────────────

/** A week's [AI-method papers, all papers] in one field, or summed over the seven fields when `field` is null (the pooled cell). */
export function weekCounts(week: PaceWeek, set: PaceSetName, field: FieldId | null): [number, number] {
  const counts = week[set];
  if (field !== null) return [counts[field][0], counts[field][1]];
  let k = 0;
  let n = 0;
  for (const f of FIELDS) {
    k += counts[f][0];
    n += counts[f][1];
  }
  return [k, n];
}

function sumSpan(index: ReadonlyMap<string, PaceWeek>, span: Span, set: PaceSetName, field: FieldId | null): Tally {
  let k = 0;
  let n = 0;
  for (let monday = span.from; monday <= span.to; monday = addDays(monday, 7)) {
    const week = index.get(monday);
    if (week === undefined) throw new RangeError(`The weekly state has no week starting ${monday}`);
    const [weekK, weekN] = weekCounts(week, set, field);
    k += weekK;
    n += weekN;
  }
  return { k, n };
}

/**
 * The counts of every week that starts within `span` (`from` is a Monday), summed: a span of Monday to Sunday is one week, and
 * a span that ends on a Monday takes the week that starts then too. Throws when the state lacks one of them, since a missing
 * week would undercount.
 */
export function spanCounts(weeks: readonly PaceWeek[], span: Span, set: PaceSetName, field: FieldId | null): Tally {
  return sumSpan(new Map(weeks.map((w) => [w.week_start, w])), span, set, field);
}

/** A `Share` (SPEC §4.7) from counts: the share and its 80% Wilson interval stored to 4 decimals; a share with no papers is 0 with the interval [0, 1]. */
export function shareOf(k: number, n: number): Share {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n) throw new RangeError(`A share needs 0 ≤ k ≤ n, got k=${k}, n=${n}`);
  if (n === 0) return { k, n, share: 0, ci80: [0, 1] };
  const [lo, hi] = wilson80(k, n);
  return { k, n, share: round4(k / n), ci80: [round4(lo), round4(hi)] };
}

// ── The two verdicts (§5.3) ──────────────────────────────────────────────────────────────────────

/**
 * `vs_baseline`: `too_few` when the window's `k` is below `min_cases` or the baseline has no papers (and the window has none);
 * `higher` when `newcombe80(window, baseline)` is wholly above 0 and the window's share is at least `min_ratio` times the
 * baseline's; `lower` when it is wholly below 0 and the share is at most the baseline's divided by `min_ratio`; else
 * `no_clear_change`. The shares are compared as exact cross products of the counts, never as stored fractions.
 */
export function vsBaseline(window: Tally, baseline: Tally, settings: Pick<PaceSettings, "min_cases" | "min_ratio">): VsBaseline {
  if (window.k < settings.min_cases || window.n === 0 || baseline.n === 0) return "too_few";
  const [lo, hi] = newcombe80(window.k, window.n, baseline.k, baseline.n);
  if (lo > 0 && window.k * baseline.n >= settings.min_ratio * baseline.k * window.n) return "higher";
  if (hi < 0 && window.k * baseline.n * settings.min_ratio <= baseline.k * window.n) return "lower";
  return "no_clear_change";
}

/**
 * `vs_year_ago`: `too_few` when either `k` is below `min_cases` (or either window has no papers); `up` when
 * `newcombe80(window, year_ago)` is wholly above 0, `down` when wholly below, else `level`.
 */
export function vsYearAgo(window: Tally, yearAgo: Tally, settings: Pick<PaceSettings, "min_cases">): VsYearAgo {
  if (window.k < settings.min_cases || yearAgo.k < settings.min_cases || window.n === 0 || yearAgo.n === 0) return "too_few";
  const [lo, hi] = newcombe80(window.k, window.n, yearAgo.k, yearAgo.n);
  if (lo > 0) return "up";
  if (hi < 0) return "down";
  return "level";
}

/** One cell (SPEC §4.7): the three shares and the two verdicts. */
export function paceCell(window: Tally, baseline: Tally, yearAgo: Tally, settings: Pick<PaceSettings, "min_cases" | "min_ratio">): PaceCell {
  return {
    window: shareOf(window.k, window.n),
    baseline: shareOf(baseline.k, baseline.n),
    year_ago: shareOf(yearAgo.k, yearAgo.n),
    vs_baseline: vsBaseline(window, baseline, settings),
    vs_year_ago: vsYearAgo(window, yearAgo, settings),
  };
}

/** The pooled cell and one cell for each field, for one set of counts, over the ranges. Throws when the state lacks a week of the window, the year-ago window or the baseline. */
export function paceSet(weeks: readonly PaceWeek[], ranges: PaceRanges, set: PaceSetName, settings: PaceSettings): PaceSet {
  const index = new Map(weeks.map((w) => [w.week_start, w]));
  const cell = (field: FieldId | null): PaceCell =>
    paceCell(sumSpan(index, ranges.window, set, field), sumSpan(index, ranges.baseline, set, field), sumSpan(index, ranges.yearAgo, set, field), settings);
  return { pooled: cell(null), by_field: Object.fromEntries(FIELDS.map((f) => [f, cell(f)])) as Record<FieldId, PaceCell> };
}

// ── quotable (§5.2) ──────────────────────────────────────────────────────────────────────────────

const SHARE_PARTS = ["window", "baseline", "year_ago"] as const;

/**
 * The displayed figures of A and B the agent may quote, by path in the metrics file: `pace.<leading or all>.pooled.<window,
 * baseline or year_ago>` and `pace.<leading or all>.by_field.<field>.<...>`, each the share as the page prints it
 * (`fmtPct1`, "8.4%"). A share with no papers has no entry.
 */
export function paceQuotable(pace: { readonly leading: PaceSet; readonly all: PaceSet }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, set] of [["leading", pace.leading], ["all", pace.all]] as const) {
    const cells: [string, PaceCell][] = [["pooled", set.pooled], ...FIELDS.map((f): [string, PaceCell] => [`by_field.${f}`, set.by_field[f]])];
    for (const [path, cell] of cells) {
      for (const part of SHARE_PARTS) {
        const share = cell[part];
        if (share.n > 0) out[`pace.${name}.${path}.${part}`] = fmtPct1(share.k, share.n);
      }
    }
  }
  return out;
}

// ── The Pace sentence (§5.2, STYLE-ZH.md §14) ────────────────────────────────────────────────────

/** The sentence of a morning with no Pace at all (§5.2). */
export const PACE_MISSING: L10n = { en: "The Pace is not available today.", zh: "今日無法取得進度。" };

/** How many of A's fields are `higher` than the pre-AI level, and how many have `too_few` cases to say (the fields' `vs_baseline`). */
export function fieldVerdicts(byField: Record<FieldId, PaceCell>): { above: number; tooFew: number } {
  const cells = FIELDS.map((f) => byField[f]);
  return {
    above: cells.filter((c) => c.vs_baseline === "higher").length,
    tooFew: cells.filter((c) => c.vs_baseline === "too_few").length,
  };
}

/** The whole weeks a window spans: a window is Monday to Sunday, so its length is a multiple of 7 days, and one week at least. */
function weeksIn(window: Span): number {
  const weeks = (daysBetween(window.from, window.to) + 1) / 7;
  if (!Number.isInteger(weeks) || weeks < 1) throw new RangeError(`A window is whole weeks, got ${window.from} to ${window.to}`);
  return weeks;
}

type Pooled = Exclude<VsBaseline, "too_few">;

const BASELINE_EN: Record<Pooled, (b: string) => string> = {
  higher: (b) => `That is up from ${b} in 2015 to 2019`,
  lower: (b) => `That is down from ${b} in 2015 to 2019`,
  no_clear_change: (b) => `That is no clear change from ${b} in 2015 to 2019`,
};

const BASELINE_ZH: Record<Pooled, (b: string) => string> = {
  higher: (b) => `，高於 2015 至 2019 年的 ${b}`,
  lower: (b) => `，低於 2015 至 2019 年的 ${b}`,
  no_clear_change: (b) => `，與 2015 至 2019 年的 ${b} 相比沒有明顯變化`,
};

/** The year-ago clause (§5.2's table): "and" or "but" by whether it goes the way the baseline clause did. */
function yearClauseEn(base: Pooled, year: VsYearAgo, y: string): string {
  switch (year) {
    case "up":
      return base === "higher" ? `, and up from ${y} a year earlier.` : `, but up from ${y} a year earlier.`;
    case "down":
      return base === "lower" ? `, and down from ${y} a year earlier.` : `, but down from ${y} a year earlier.`;
    case "level":
      return base === "no_clear_change" ? ` or from ${y} a year earlier.` : `, with no clear change from ${y} a year earlier.`;
    case "too_few":
      return ".";
  }
}

function yearClauseZh(base: Pooled, year: VsYearAgo, y: string): string {
  switch (year) {
    case "up":
      return base === "higher" ? `，也高於一年前的 ${y}。` : `，但高於一年前的 ${y}。`;
    case "down":
      return base === "lower" ? `，也低於一年前的 ${y}。` : `，但低於一年前的 ${y}。`;
    case "level":
      return base === "no_clear_change" ? `，與一年前的 ${y} 相比也沒有明顯變化。` : `，與一年前的 ${y} 相比沒有明顯變化。`;
    case "too_few":
      return "。";
  }
}

/** What the sentence reads of the `pace` block: the window and A's cells. */
export interface SentenceInput {
  readonly window: Span;
  readonly leading: PaceSet;
}

/**
 * The Pace sentence in both languages (SPEC §5.2, STYLE-ZH.md §14), from A's pooled cell and its fields' verdicts: the pooled
 * share, the clause for `vs_baseline` and the one for `vs_year_ago` that depends on it, then how many of the seven fields are
 * clearly above the pre-AI level, and how many have too few cases. With the pooled cell `too_few` it is the one fixed sentence.
 * With `staleSince` (the data cutoff of the reused state) the stale line comes first. English parts are joined with a space,
 * Chinese ones with nothing. The window is as many whole weeks as it spans ("the 13 weeks to 20 Sep", "the week to 20 Sep"); it
 * throws when the window is not whole weeks.
 */
export function paceSentence(pace: SentenceInput, staleSince?: IsoDate): L10n {
  const { window, leading } = pace;
  const weeks = weeksIn(window);
  const weeksEn = weeks === 1 ? "week" : `${weeks} weeks`;
  const cell = leading.pooled;
  let en: string;
  let zh: string;
  if (cell.vs_baseline === "too_few") {
    en = `The Pace: too few papers named AI methods in the ${weeksEn} to ${dayMonth(window.to)} to compare with 2015 to 2019.`;
    zh = `進度：截至 ${zhDayMonth(window.to)}的 ${weeks} 週內，提到 AI 方法的論文太少，無法與 2015 至 2019 年比較。`;
  } else {
    const base = cell.vs_baseline;
    const p = fmtPct1(cell.window.k, cell.window.n);
    const b = fmtPct1(cell.baseline.k, cell.baseline.n);
    const y = cell.vs_year_ago === "too_few" ? "" : fmtPct1(cell.year_ago.k, cell.year_ago.n);
    const { above, tooFew } = fieldVerdicts(leading.by_field);
    const total = FIELDS.length;
    const fieldsEn = above === total ? `in all ${total} fields` : above === 0 ? `in none of the ${total} fields` : `in ${above} of ${total} fields`;
    const fieldsZh = above === total ? `${total} 個領域全都` : above === 0 ? `${total} 個領域中沒有一個` : `${total} 個領域中有 ${above} 個`;
    en = [
      `The Pace: ${p} of papers in leading journals named AI methods in the ${weeksEn} to ${dayMonth(window.to)}.`,
      `${BASELINE_EN[base](b)}${yearClauseEn(base, cell.vs_year_ago, y)}`,
      `Clearly above the pre-AI level ${fieldsEn}.${tooFew > 0 ? ` Too few cases to judge in ${tooFew}.` : ""}`,
    ].join(" ");
    zh = [
      `進度：截至 ${zhDayMonth(window.to)}的 ${weeks} 週內，主要期刊有 ${p} 的論文提到 AI 方法`,
      `${BASELINE_ZH[base](b)}${yearClauseZh(base, cell.vs_year_ago, y)}`,
      `${fieldsZh}明顯高於 AI 出現之前。${tooFew > 0 ? `有 ${tooFew} 個領域的案例太少，無法判斷。` : ""}`,
    ].join("");
  }
  if (staleSince === undefined) return { en, zh };
  return {
    en: `(Data to ${dayMonth(staleSince)}; today's figures are not available.) ${en}`,
    zh: `（資料截至 ${zhDayMonth(staleSince)}；今日數字無法取得。）${zh}`,
  };
}

// ── The whole block (§4.7) ───────────────────────────────────────────────────────────────────────

export interface PaceInput {
  /** The weekly state, oldest first: every week of the window, the year-ago window and the baseline. */
  readonly weeks: readonly PaceWeek[];
  /** The Sunday that ends the newest week used: the metrics file's `data_cutoff`. */
  readonly cutoff: IsoDate;
  readonly settings: PaceSettings;
  /** The state is the last good one, reused because OpenAlex failed: the sentence gets the stale line, dated `cutoff`. */
  readonly stale?: boolean;
  /** More displayed figures to join `quotable`, such as `ledgerQuotable()`'s (lib/metrics/ledger-stats.ts). */
  readonly extraQuotable?: Readonly<Record<string, string>>;
}

/**
 * The `pace` block of a metrics file (SPEC §4.7) that `PaceBlock` accepts: the ranges, A's and B's cells, the sentence and
 * `quotable`. Throws when the weekly state lacks a week the ranges need.
 */
export function buildPace(input: PaceInput): PaceBlock {
  const ranges = paceRanges(input.cutoff, input.settings);
  const leading = paceSet(input.weeks, ranges, "leading", input.settings);
  const all = paceSet(input.weeks, ranges, "all", input.settings);
  return {
    window: { ...ranges.window },
    provisional_from: ranges.provisional.from,
    baseline: { ...PACE_BASELINE },
    year_ago: { ...ranges.yearAgo },
    leading,
    all,
    sentence: paceSentence({ window: ranges.window, leading }, input.stale === true ? input.cutoff : undefined),
    quotable: { ...paceQuotable({ leading, all }), ...input.extraQuotable },
  };
}

/**
 * The `pace` block of a morning with no Pace data at all (status `missing`, SPEC §4.7): the ranges for D, every share empty,
 * every verdict `too_few`, no `quotable` figure and the sentence `PACE_MISSING`.
 */
export function missingPace(date: IsoDate, settings: Pick<PaceSettings, "window_weeks" | "provisional_weeks">): PaceBlock {
  const ranges = paceRanges(dataCutoff(date), settings);
  const cell = (): PaceCell => ({
    window: shareOf(0, 0), baseline: shareOf(0, 0), year_ago: shareOf(0, 0), vs_baseline: "too_few", vs_year_ago: "too_few",
  });
  const set = (): PaceSet => ({ pooled: cell(), by_field: Object.fromEntries(FIELDS.map((f) => [f, cell()])) as Record<FieldId, PaceCell> });
  return {
    window: { ...ranges.window },
    provisional_from: ranges.provisional.from,
    baseline: { ...PACE_BASELINE },
    year_ago: { ...ranges.yearAgo },
    leading: set(),
    all: set(),
    sentence: { ...PACE_MISSING },
    quotable: {},
  };
}
