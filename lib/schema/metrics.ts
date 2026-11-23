// The metrics file, its inputs manifest and the weekly Pace state (SPEC §4.7). All S: computed by scripts/metrics.ts and
// scripts/backfill.ts from OpenAlex, the counters' own records and the stored findings; §5 defines each value.
//
// Shape, and the facts a value states about itself that no rule owns: a share is k of n and its interval holds it, a
// window ends on a Sunday and its year-ago twin is 52 weeks earlier, the Hold rate's three outcomes add up to its cases,
// the weekly state runs week by week from 2015-01-05. Config values are never fixed here (`window_weeks`,
// `provisional_weeks`, `min_cases`): a check that needs one belongs to the code that reads config.
//
// Cyber's lib/schema/metrics.ts at the fork commit 3ced1fb, adapted: Cyber's exploit and flaw-volume blocks and its six
// state files give way to the Pace (A, B), the Landmark counts (C), the Hold rate (D), the counters and the one state
// file, `pace-weekly.json`; `Share`, `Fraction` and `Interval` are Cyber's idiom. The inputs manifest keeps its purpose,
// enough to audit every figure, with this project's inputs.

import { z } from "zod";
import { addDays, dataCutoffFor, lastSunday, weekday } from "../dates";
import {
  Count, CounterId, DataStatus, FieldId, FindingId, Fraction, FractionInterval, IsoDate, IsoTimestamp, L10n, MetricPath, Sha256,
  realDates,
} from "./common";

export const VS_BASELINE = ["higher", "lower", "no_clear_change", "too_few"] as const;
export const VS_YEAR_AGO = ["up", "level", "down", "too_few"] as const;
export const COUNTER_KINDS = ["api", "ledger", "manual"] as const;
/** The four group-by requests of one week (SPEC §5.1). */
export const OPENALEX_REQUESTS = ["leading_total", "leading_ai", "all_total", "all_ai"] as const;
/** The Pace's baseline weeks, 2015 to 2019 (SPEC §4.7, §5.3). */
export const PACE_BASELINE = { from: "2015-01-05", to: "2019-12-29" } as const;
/** The first and the last year of the baseline, 2015 and 2019. */
const BASELINE_FIRST_YEAR = Number(PACE_BASELINE.from.slice(0, 4));
const BASELINE_LAST_YEAR = Number(PACE_BASELINE.to.slice(0, 4));
/** A stored share may differ from k / n by the rounding to 4 decimals and no more. */
const SHARE_TOLERANCE = 0.00005 + 1e-9;

export const VsBaseline = z.enum(VS_BASELINE);
export const VsYearAgo = z.enum(VS_YEAR_AGO);
export const CounterKind = z.enum(COUNTER_KINDS);
export const OpenAlexRequestKind = z.enum(OPENALEX_REQUESTS);

/** A config file's version: a positive integer that increments on every change (SPEC §4.11). */
const Version = z.int().min(1);

/** The versions of the four config files the metrics read. */
export const ConfigVersions = z.strictObject({ ai_terms: Version, journals: Version, fields: Version, counters: Version });
/** The weekly state depends on the three that decide its counts, never on the counters (SPEC §5.4). */
export const PaceVersions = z.strictObject({ ai_terms: Version, journals: Version, fields: Version });

// ── The Pace (A and B) ───────────────────────────────────────────────────────────────────────────

/**
 * `k` AI-method papers of `n` papers, the share and its 80% Wilson interval (SPEC §5.2, §5.3). A share with no papers
 * stores share 0 and the interval [0, 1].
 */
export const ShareBase = z.strictObject({
  k: Count,
  n: Count,
  share: Fraction,
  ci80: FractionInterval,
});

export const Share = ShareBase.superRefine((s, ctx) => {
  const issue = (message: string, key: "k" | "share" | "ci80") => ctx.addIssue({ code: "custom", message, path: [key] });
  if (s.k > s.n) issue("k is at most n", "k");
  if (s.n === 0) {
    if (s.share !== 0) issue("A share of no papers is 0", "share");
    if (s.ci80[0] !== 0 || s.ci80[1] !== 1) issue("The interval of no papers is [0, 1]", "ci80");
    return;
  }
  if (Math.abs(s.share - s.k / s.n) > SHARE_TOLERANCE) issue("share is k / n to 4 decimal places", "share");
  if (s.share < s.ci80[0] || s.share > s.ci80[1]) issue("ci80 holds the share", "ci80");
});

export const PaceCell = z.strictObject({
  window: Share,
  baseline: Share,
  year_ago: Share,
  vs_baseline: VsBaseline,
  vs_year_ago: VsYearAgo,
});

/** The pooled cell and one cell for each field. */
export const PaceSet = z.strictObject({
  pooled: PaceCell,
  by_field: z.record(FieldId, PaceCell),
});

const DateSpan = z.strictObject({ from: IsoDate, to: IsoDate });

export const PaceBlockBase = z.strictObject({
  window: DateSpan.describe("The newest firm weeks: a Monday to a Sunday"),
  provisional_from: IsoDate.describe("Monday of the first provisional week, the day after the window ends"),
  baseline: z.strictObject({ from: z.literal(PACE_BASELINE.from), to: z.literal(PACE_BASELINE.to) }),
  year_ago: DateSpan.describe("The window moved back 52 weeks"),
  leading: PaceSet.describe("A: the journals with in_pace true"),
  all: PaceSet.describe("B: all papers"),
  sentence: L10n.describe("The Pace line (SPEC §5.2), the only Pace text any page or the chat prints"),
  quotable: z.record(MetricPath, z.string().min(1)).describe("The displayed figures the agent may quote, by path"),
});

export const PaceBlock = PaceBlockBase.superRefine((p, ctx) => {
  const { window, year_ago } = p;
  if (!realDates(window.from, window.to, year_ago.from, year_ago.to, p.provisional_from)) return;
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
  if (weekday(window.from) !== 1) issue("The window starts on a Monday", ["window", "from"]);
  if (weekday(window.to) !== 0) issue("The window ends on a Sunday", ["window", "to"]);
  if (window.to < window.from) issue("The window ends after it starts", ["window", "to"]);
  if (year_ago.from !== addDays(window.from, -364)) issue("year_ago starts 52 weeks before the window", ["year_ago", "from"]);
  if (year_ago.to !== addDays(window.to, -364)) issue("year_ago ends 52 weeks before the window", ["year_ago", "to"]);
  if (p.provisional_from !== addDays(window.to, 1)) issue("The provisional weeks start the day after the window ends", ["provisional_from"]);
});

// ── C, D and the counters ────────────────────────────────────────────────────────────────────────

/** C by year: the Landmarks of a calendar year whose kind is not a setback and whose rung counts, and those with an AI role (SPEC §5.5). */
export const LandmarkYear = z.strictObject({
  year: z.int().min(BASELINE_FIRST_YEAR),
  ai: Count,
  all: Count,
}).refine((y) => y.ai <= y.all, { error: "ai is at most all", path: ["ai"] });

export const LandmarkBaseline = z.strictObject({
  ai: Count,
  all: Count,
}).refine((b) => b.ai <= b.all, { error: "ai is at most all", path: ["ai"] });

/** C: the years run oldest first, and the baseline is 2015 to 2019 together. */
export const Landmarks = z.strictObject({
  by_year: z.array(LandmarkYear),
  baseline: LandmarkBaseline,
}).superRefine((c, ctx) => {
  c.by_year.forEach((y, i) => {
    if (i > 0 && y.year <= c.by_year[i - 1]!.year) {
      ctx.addIssue({ code: "custom", message: "by_year runs oldest first, one row a year", path: ["by_year", i, "year"] });
    }
  });
  const base = c.by_year.filter((y) => y.year >= BASELINE_FIRST_YEAR && y.year <= BASELINE_LAST_YEAR);
  const ai = base.reduce((sum, y) => sum + y.ai, 0);
  const all = base.reduce((sum, y) => sum + y.all, 0);
  if (c.baseline.ai !== ai || c.baseline.all !== all) {
    ctx.addIssue({ code: "custom", message: "baseline adds up the years 2015 to 2019", path: ["baseline"] });
  }
});

/** D: of the AI claims first briefed long enough ago, how many held, fell or are open (SPEC §5.6). `too_few` is a config test. */
export const Hold = z.strictObject({
  cases: Count,
  held: Count,
  fell: Count,
  open: Count,
  too_few: z.boolean(),
}).refine((h) => h.held + h.fell + h.open === h.cases, { error: "held, fell and open add up to cases", path: ["cases"] });

export const CounterBreakdownRow = z.strictObject({
  key: z.string().min(1).describe("1, 2, 3 or approved; a year; total (SPEC §5.7)"),
  value: Count,
});

export const CounterReadingBase = z.strictObject({
  id: CounterId,
  kind: CounterKind,
  value: z.int().nullable(),
  as_of: IsoDate.nullable(),
  breakdown: z.array(CounterBreakdownRow),
  source_url: z.string().min(1).describe("The primary record the number comes from"),
  status: DataStatus,
});

/** A counter with no reading has no value, and only then (SPEC §5.7: a failed source keeps its last reading as stale). */
export const CounterReading = CounterReadingBase.superRefine((c, ctx) => {
  if ((c.status === "missing") !== (c.value === null)) {
    ctx.addIssue({ code: "custom", message: "A counter has no value exactly when its status is missing", path: ["value"] });
  }
});

// ── The metrics file ─────────────────────────────────────────────────────────────────────────────

/** content/metrics/D.json. */
export const MetricsFile = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate,
  computed_at: IsoTimestamp,
  data_cutoff: IsoDate.describe("The Sunday ending the newest week used"),
  versions: ConfigVersions,
  status: DataStatus.describe("stale: OpenAlex failed and the last good weekly state was reused"),
  pace: PaceBlock,
  landmarks: Landmarks,
  hold: Hold,
  counters: z.array(CounterReading),
}).superRefine((m, ctx) => {
  m.counters.forEach((c, i) => {
    if (m.counters.findIndex((o) => o.id === c.id) !== i) {
      ctx.addIssue({ code: "custom", message: "A counter appears once", path: ["counters", i, "id"] });
    }
  });
  if (!realDates(m.date, m.data_cutoff)) return;
  if (weekday(m.data_cutoff) !== 0) {
    ctx.addIssue({ code: "custom", message: "data_cutoff is a Sunday", path: ["data_cutoff"] });
    return;
  }
  const newest = lastSunday(dataCutoffFor(m.date));
  if (m.status === "ok" ? m.data_cutoff !== newest : m.data_cutoff > newest) {
    ctx.addIssue({
      code: "custom",
      message: m.status === "ok"
        ? `data_cutoff is the newest Sunday on or before the date minus 2 days (${newest})`
        : `data_cutoff is no later than the newest Sunday on or before the date minus 2 days (${newest})`,
      path: ["data_cutoff"],
    });
  }
  if (realDates(m.pace.window.to) && m.data_cutoff <= m.pace.window.to) {
    ctx.addIssue({ code: "custom", message: "data_cutoff is after the window", path: ["data_cutoff"] });
  }
});

// ── The inputs manifest ──────────────────────────────────────────────────────────────────────────

/** A request URL as the manifest keeps it: any key and any e-mail address already removed (SPEC §5.1). */
const RequestUrl = z.string().min(1)
  .refine((u) => !/[?&](?:api_key|mailto)=/i.test(u), { error: "A request URL holds no key and no e-mail address" });

/** One request the run made: its URL without any key, when, and the SHA-256 of the answer. */
export const RequestRecord = z.strictObject({
  url: RequestUrl,
  fetched_at: IsoTimestamp,
  sha256: Sha256,
});

/** One of a week's four OpenAlex group-by requests, with the counts it gave for each of our fields (SPEC §5.1). */
export const OpenAlexRequest = z.strictObject({
  request: OpenAlexRequestKind,
  week_start: IsoDate,
  url: RequestUrl,
  fetched_at: IsoTimestamp,
  sha256: Sha256,
  counts: z.record(FieldId, Count).describe("The works counted for each of our fields"),
  excluded_n: Count.describe("Works in groups that fields.json excludes"),
  unmapped_n: Count.describe("Works in groups that fields.json does not list"),
});

export const CounterInput = z.strictObject({
  id: CounterId,
  requests: z.array(RequestRecord),
  value: z.int().nullable(),
});

/** content/metrics/inputs/D.json: enough to audit every figure and to let `--recompute` rebuild the file (SPEC §4.7, §8.4). */
export const InputsManifest = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate,
  computed_at: IsoTimestamp,
  data_cutoff: IsoDate,
  versions: ConfigVersions,
  openalex: z.array(OpenAlexRequest),
  counters: z.array(CounterInput),
  landmark_ids: z.array(FindingId).describe("The findings C counted"),
  hold_case_ids: z.array(FindingId).describe("The findings D counted as cases"),
});

// ── The weekly Pace state ────────────────────────────────────────────────────────────────────────

/** [AI-method papers, all papers] of a week in one field. */
const WeekCount = z.tuple([Count, Count]).refine(([ai, total]) => ai <= total, { error: "The AI-method papers are among all papers" });

export const PaceWeek = z.strictObject({
  week_start: IsoDate.describe("The Monday"),
  fetched: IsoDate.describe("The earliest fetch date of its four answers"),
  provisional: z.boolean(),
  leading: z.record(FieldId, WeekCount),
  all: z.record(FieldId, WeekCount),
});

/**
 * content/state/pace-weekly.json: every ISO week from 2015-01-05 to `data_cutoff`, oldest first, none missing; only the
 * newest weeks are provisional (SPEC §4.7, §5.4). `updated` is the Taipei date of the run that wrote it.
 */
export const PaceWeeklyFile = z.strictObject({
  schema_version: z.literal(1),
  versions: PaceVersions,
  updated: IsoDate,
  weeks: z.array(PaceWeek),
}).superRefine((s, ctx) => {
  s.weeks.forEach((w, i) => {
    const prev = i > 0 ? s.weeks[i - 1]! : null;
    if (realDates(w.week_start) && (prev === null || realDates(prev.week_start))) {
      const expected = prev === null ? PACE_BASELINE.from : addDays(prev.week_start, 7);
      if (w.week_start !== expected) {
        ctx.addIssue({ code: "custom", message: `Weeks run one by one from ${PACE_BASELINE.from}; expected ${expected}`, path: ["weeks", i, "week_start"] });
      }
    }
    if (prev !== null && prev.provisional && !w.provisional) {
      ctx.addIssue({ code: "custom", message: "Every week after a provisional one is provisional", path: ["weeks", i, "provisional"] });
    }
  });
});

export type VsBaseline = z.infer<typeof VsBaseline>;
export type VsYearAgo = z.infer<typeof VsYearAgo>;
export type CounterKind = z.infer<typeof CounterKind>;
export type OpenAlexRequestKind = z.infer<typeof OpenAlexRequestKind>;
export type ConfigVersions = z.infer<typeof ConfigVersions>;
export type PaceVersions = z.infer<typeof PaceVersions>;
export type Share = z.infer<typeof Share>;
export type PaceCell = z.infer<typeof PaceCell>;
export type PaceSet = z.infer<typeof PaceSet>;
export type PaceBlock = z.infer<typeof PaceBlock>;
export type LandmarkYear = z.infer<typeof LandmarkYear>;
export type Landmarks = z.infer<typeof Landmarks>;
export type Hold = z.infer<typeof Hold>;
export type CounterBreakdownRow = z.infer<typeof CounterBreakdownRow>;
export type CounterReading = z.infer<typeof CounterReading>;
export type MetricsFile = z.infer<typeof MetricsFile>;
export type RequestRecord = z.infer<typeof RequestRecord>;
export type OpenAlexRequest = z.infer<typeof OpenAlexRequest>;
export type CounterInput = z.infer<typeof CounterInput>;
export type InputsManifest = z.infer<typeof InputsManifest>;
export type PaceWeek = z.infer<typeof PaceWeek>;
export type PaceWeeklyFile = z.infer<typeof PaceWeeklyFile>;
