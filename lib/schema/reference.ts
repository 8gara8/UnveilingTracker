// The Pace reference files (SPEC Appendix D, §10 P2 step 6, §3): `fixtures/reference/pace-reference.json`, the figures of the
// backfill's edition that CI reproduces offline, and the small index of `fixtures/openalex/`, which names the saved group-by
// answers that `fetchFeed()` serves in fixture runs (`UT_FIXTURE_FEEDS`).
//
// pace-reference.json follows Appendix D point by point: `inputs` is D.1 (the edition date and its cutoff, the config versions,
// the request count); `baseline` is D.2 (A and B for 2015 to 2019, pooled and per field, as k, n and the share as it prints);
// `pace` is D.3, laid out as the metrics file's `pace` block is laid out (§4.7), so a figure has one path in both files
// (`pace.leading.pooled.window`): the window and the year-ago window per field, the verdicts and the Pace sentence in both
// languages; `landmarks` and `hold` are D.4 (C by year, and the Hold rate); `known_differences` is D.5. Only counts, printed
// shares, verdicts and sentences are stored: every Wilson bound, direction and clause is worked out by the code under test.
//
// The index holds, for each of the 34 weeks the edition's metrics read besides the baseline (the provisional weeks, the window
// and the year-ago window), the four group-by answers of §5.1: 136 entries, each `{ file, content_type }` under its request URL,
// the shape `fetchFeed()` reads. Which weeks those are follows from the reference file alone (`referenceWeeks()`), so a test
// can hold the two files to each other without the config.
//
// The checks here are the facts a value states about itself: a printed share is `fmtPct1` of its counts, the pooled cell is the
// seven fields added up, A's papers are among B's, the dates agree with the data cutoff's rule, and the index's URLs are the
// group-by URLs of §5.1 with their file named by kind and week. Config values (`window_weeks`, `min_cases`) are never fixed here.
// New for this project; Cyber's lib/schema/reference.ts holds its own domain's reference rows.

import { z } from "zod";
import { addDays, dataCutoffFor, lastSunday, weekday } from "../dates";
import { fmtPct1 } from "../metrics/stats";
import { FIELDS, type FieldId as FieldName } from "../vocab";
import { Count, FieldId, IsoDate, MetricPath, realDates } from "./common";
import { ConfigVersions, Hold, Landmarks, OPENALEX_REQUESTS, PACE_BASELINE, VsBaseline, VsYearAgo, type OpenAlexRequestKind } from "./metrics";

// ── Tallies ──────────────────────────────────────────────────────────────────────────────────────

/** k AI-method papers of n papers, and the share as the page prints it (`fmtPct1`); a share of no papers is null (§5.3). */
export const ReferenceTally = z.strictObject({
  k: Count,
  n: Count,
  share: z.string().nullable().describe("fmtPct1(k, n), for example 8.4%; null when n is 0"),
}).superRefine((t, ctx) => {
  // A negative count is Count's own issue and does not stop this check from running; fmtPct1 refuses it, and a schema reports, not throws.
  if (t.k < 0 || t.n < 0) return;
  if (t.k > t.n) {
    ctx.addIssue({ code: "custom", message: "k is at most n", path: ["k"] });
    return;
  }
  const expected = t.n === 0 ? null : fmtPct1(t.k, t.n);
  if (t.share !== expected) {
    ctx.addIssue({ code: "custom", message: expected === null ? "A share of no papers is null" : `share is fmtPct1(k, n), ${expected}`, path: ["share"] });
  }
});

type Tally = z.infer<typeof ReferenceTally>;

/** True when `pooled` is the seven fields added up, k and n each. */
function pooledIsSum(pooled: { k: number; n: number }, byField: Record<FieldName, { k: number; n: number }>): boolean {
  let k = 0;
  let n = 0;
  for (const f of FIELDS) {
    k += byField[f].k;
    n += byField[f].n;
  }
  return pooled.k === k && pooled.n === n;
}

/** The pooled tally and one for each field. The pooled one is the fields added up (§5.3: the pooled cell sums the seven fields). */
export const ReferenceTallySet = z.strictObject({
  pooled: ReferenceTally,
  by_field: z.record(FieldId, ReferenceTally),
}).superRefine((s, ctx) => {
  if (!pooledIsSum(s.pooled, s.by_field)) {
    ctx.addIssue({ code: "custom", message: "pooled is the seven fields added up", path: ["pooled"] });
  }
});

/** One cell of D.3: the window and the year-ago window as tallies, and the two verdicts (the baseline is D.2's). */
export const ReferenceCell = z.strictObject({
  window: ReferenceTally,
  year_ago: ReferenceTally,
  vs_baseline: VsBaseline,
  vs_year_ago: VsYearAgo,
});

export const ReferenceCellSet = z.strictObject({
  pooled: ReferenceCell,
  by_field: z.record(FieldId, ReferenceCell),
}).superRefine((s, ctx) => {
  for (const part of ["window", "year_ago"] as const) {
    const fields = Object.fromEntries(FIELDS.map((f) => [f, s.by_field[f][part]])) as Record<FieldName, Tally>;
    if (!pooledIsSum(s.pooled[part], fields)) {
      ctx.addIssue({ code: "custom", message: `pooled ${part} is the seven fields added up`, path: ["pooled", part] });
    }
  }
});

// ── pace-reference.json ──────────────────────────────────────────────────────────────────────────

/** D.1: what the figures were computed from. */
export const ReferenceInputs = z.strictObject({
  edition_date: IsoDate.describe("The Taipei date of the backfill's edition (§8.4)"),
  data_cutoff: IsoDate.describe("The Sunday ending its newest week"),
  versions: ConfigVersions,
  requests: Count.describe("The OpenAlex requests the backfill made"),
});

/** D.2: A and B for 2015 to 2019, pooled and per field. */
export const ReferenceBaseline = z.strictObject({
  from: z.literal(PACE_BASELINE.from),
  to: z.literal(PACE_BASELINE.to),
  leading: ReferenceTallySet.describe("A: the journals with in_pace true"),
  all: ReferenceTallySet.describe("B: all papers"),
});

const DateSpan = z.strictObject({ from: IsoDate, to: IsoDate });

/** D.3: the window and the year-ago window on the edition date, the verdicts and the Pace sentence in both languages. */
export const ReferencePace = z.strictObject({
  window: DateSpan.describe("The newest firm weeks: a Monday to a Sunday"),
  provisional_from: IsoDate.describe("Monday of the first provisional week"),
  year_ago: DateSpan.describe("The window moved back 52 weeks"),
  leading: ReferenceCellSet,
  all: ReferenceCellSet,
  sentence: z.strictObject({ en: z.string().min(1), zh: z.string().min(1) }).describe("The Pace sentence of A's pooled cell, in both languages"),
});

/** D.5: a figure a later run may disagree with, and why ("do not fix these"). */
export const KnownDifference = z.strictObject({
  figure: MetricPath.describe("The figure's path in the metrics file, for example pace.leading.pooled.window"),
  what: z.string().min(1).describe("How a later figure differs"),
  why: z.string().min(1).describe("Why that is expected"),
});

export const PaceReferenceFile = z.strictObject({
  schema_version: z.literal(1),
  inputs: ReferenceInputs,
  baseline: ReferenceBaseline,
  pace: ReferencePace,
  landmarks: Landmarks,
  hold: Hold,
  known_differences: z.array(KnownDifference),
}).superRefine((ref, ctx) => {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
  const { data_cutoff, edition_date } = ref.inputs;
  const { window, year_ago, provisional_from } = ref.pace;
  if (realDates(edition_date, data_cutoff)) {
    if (data_cutoff !== lastSunday(dataCutoffFor(edition_date))) {
      issue(`data_cutoff is the newest Sunday on or before the edition date minus 2 days (${lastSunday(dataCutoffFor(edition_date))})`, ["inputs", "data_cutoff"]);
    }
    if (realDates(window.to) && data_cutoff <= window.to) issue("data_cutoff is after the window", ["inputs", "data_cutoff"]);
  }
  if (realDates(window.from, window.to, year_ago.from, year_ago.to, provisional_from)) {
    if (weekday(window.from) !== 1) issue("The window starts on a Monday", ["pace", "window", "from"]);
    if (weekday(window.to) !== 0) issue("The window ends on a Sunday", ["pace", "window", "to"]);
    if (window.to < window.from) issue("The window ends after it starts", ["pace", "window", "to"]);
    if (year_ago.from !== addDays(window.from, -364)) issue("year_ago starts 52 weeks before the window", ["pace", "year_ago", "from"]);
    if (year_ago.to !== addDays(window.to, -364)) issue("year_ago ends 52 weeks before the window", ["pace", "year_ago", "to"]);
    if (provisional_from !== addDays(window.to, 1)) issue("The provisional weeks start the day after the window ends", ["pace", "provisional_from"]);
  }

  // A's papers are among B's: the journals' papers are some of all papers, so no tally of A exceeds B's.
  const among = (a: Tally, b: Tally, path: (string | number)[]) => {
    if (a.k > b.k || a.n > b.n) issue("A's papers are among B's: its k and n are at most B's", path);
  };
  const compareSets = (a: z.infer<typeof ReferenceTallySet>, b: z.infer<typeof ReferenceTallySet>, path: (string | number)[]) => {
    among(a.pooled, b.pooled, [...path, "pooled"]);
    for (const f of FIELDS) among(a.by_field[f], b.by_field[f], [...path, "by_field", f]);
  };
  compareSets(ref.baseline.leading, ref.baseline.all, ["baseline", "leading"]);
  for (const part of ["window", "year_ago"] as const) {
    const pick = (set: z.infer<typeof ReferenceCellSet>): z.infer<typeof ReferenceTallySet> => ({
      pooled: set.pooled[part],
      by_field: Object.fromEntries(FIELDS.map((f) => [f, set.by_field[f][part]])) as Record<FieldName, Tally>,
    });
    compareSets(pick(ref.pace.leading), pick(ref.pace.all), ["pace", "leading", part]);
  }
});

// ── fixtures/openalex/index.json ─────────────────────────────────────────────────────────────────

/**
 * The group-by URL of §5.1 for one week, as `scripts/lib/openalex.ts` builds it: the date bounds, `type:article` and
 * `has_abstract:true`, then the journals' source filter for A, then the search filter for the AI-method papers, then the
 * group-by. The search filter is URL-encoded, so it holds no comma and no ampersand.
 */
const GROUP_BY_URL = new RegExp(
  "^https://api\\.openalex\\.org/works\\?filter=from_publication_date:(\\d{4}-\\d{2}-\\d{2}),to_publication_date:(\\d{4}-\\d{2}-\\d{2}),"
  + "type:article,has_abstract:true(,primary_location\\.source\\.id:[^,&]+)?(,title_and_abstract\\.search:[^,&]+)?&group_by=primary_topic\\.field\\.id$",
);

/** The request kind and the Monday a Pace group-by URL asks for, or null when it is not one: another URL, a week that does not run Monday to Sunday, or a URL holding a key. */
export function paceRequestOf(url: string): { request: OpenAlexRequestKind; week_start: string } | null {
  const m = GROUP_BY_URL.exec(url);
  if (!m) return null;
  const [, from, to, journals, search] = m;
  if (!realDates(from!, to!) || weekday(from!) !== 1 || to !== addDays(from!, 6)) return null;
  const request = journals ? (search ? "leading_ai" : "leading_total") : (search ? "all_ai" : "all_total");
  return { request, week_start: from! };
}

/** One saved answer: its file in the folder and its content type, the shape of a `fetchFeed()` fixture index entry. */
export const OpenAlexFixtureEntry = z.strictObject({
  file: z.string().min(1),
  content_type: z.literal("application/json"),
});

/**
 * The index of `fixtures/openalex/`: a record from request URL to saved answer, as `fetchFeed()` reads it. Every key is a Pace
 * group-by URL (§5.1), its file is `<request>-<Monday>.json`, and the entries run oldest week first with the four requests of a
 * week together in `OPENALEX_REQUESTS` order, none missing (the 136 answers of §10 P2 step 6 are four for each of 34 weeks).
 */
export const OpenAlexFixtureIndex = z.record(z.string(), OpenAlexFixtureEntry).superRefine((index, ctx) => {
  const entries = Object.entries(index);
  if (entries.length === 0) ctx.addIssue({ code: "custom", message: "The index lists at least one week" });
  if (entries.length % OPENALEX_REQUESTS.length !== 0) {
    ctx.addIssue({ code: "custom", message: `The index holds the ${OPENALEX_REQUESTS.length} requests of every week it lists, so its entries come in fours` });
  }
  let previousWeek: string | null = null;
  entries.forEach(([url, entry], i) => {
    const request = paceRequestOf(url);
    if (!request) {
      ctx.addIssue({ code: "custom", message: "The key is the group-by URL of a Pace week (SPEC §5.1), without any key or e-mail address", path: [url] });
      return;
    }
    const wanted = `${request.request}-${request.week_start}.json`;
    if (entry.file !== wanted) ctx.addIssue({ code: "custom", message: `The file is named ${wanted}`, path: [url, "file"] });
    const slot = i % OPENALEX_REQUESTS.length;
    if (request.request !== OPENALEX_REQUESTS[slot]) {
      ctx.addIssue({ code: "custom", message: `Entry ${i + 1} is ${OPENALEX_REQUESTS[slot]}: a week's requests come in the order ${OPENALEX_REQUESTS.join(", ")}`, path: [url] });
    }
    if (slot === 0) {
      if (previousWeek !== null && request.week_start <= previousWeek) {
        ctx.addIssue({ code: "custom", message: "Weeks run oldest first, each once", path: [url] });
      }
      previousWeek = request.week_start;
    } else if (request.week_start !== previousWeek) {
      ctx.addIssue({ code: "custom", message: "The four requests of a week are together", path: [url] });
    }
  });
});

/** The Mondays a well-formed index lists, oldest first, each once. */
export function openalexFixtureWeeks(index: Record<string, unknown>): string[] {
  const weeks: string[] = [];
  for (const url of Object.keys(index)) {
    const request = paceRequestOf(url);
    if (request && weeks.at(-1) !== request.week_start) weeks.push(request.week_start);
  }
  return weeks;
}

/**
 * The weeks the edition's metrics read besides the baseline, oldest first: the year-ago window, then the window, then the
 * provisional weeks (to the data cutoff). With 13, 13 and 8 weeks that is 34, and four answers each are the index's 136.
 */
export function referenceWeeks(ref: Pick<z.infer<typeof PaceReferenceFile>, "inputs" | "pace">): string[] {
  const weeks: string[] = [];
  const run = (from: string, to: string) => {
    for (let monday = from; monday <= to; monday = addDays(monday, 7)) weeks.push(monday);
  };
  run(ref.pace.year_ago.from, ref.pace.year_ago.to);
  run(ref.pace.window.from, ref.pace.window.to);
  run(ref.pace.provisional_from, ref.inputs.data_cutoff);
  return weeks;
}

export type ReferenceTally = z.infer<typeof ReferenceTally>;
export type ReferenceTallySet = z.infer<typeof ReferenceTallySet>;
export type ReferenceCell = z.infer<typeof ReferenceCell>;
export type ReferenceCellSet = z.infer<typeof ReferenceCellSet>;
export type ReferenceInputs = z.infer<typeof ReferenceInputs>;
export type ReferenceBaseline = z.infer<typeof ReferenceBaseline>;
export type ReferencePace = z.infer<typeof ReferencePace>;
export type KnownDifference = z.infer<typeof KnownDifference>;
export type PaceReferenceFile = z.infer<typeof PaceReferenceFile>;
export type OpenAlexFixtureEntry = z.infer<typeof OpenAlexFixtureEntry>;
export type OpenAlexFixtureIndex = z.infer<typeof OpenAlexFixtureIndex>;
