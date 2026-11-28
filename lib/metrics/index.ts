// The metrics run, as pure functions (SPEC §5, §4.7, §8.4): `computeMetrics()` joins the Pace (A and B, pace.ts), C and D
// (ledger-stats.ts), the counters (counters.ts) and the quotable figures into the metrics file and its inputs manifest, with the
// status `ok`, `stale` or `missing`; and the weekly state's own logic of §5.4: which weeks a morning or a backfill fetches
// (`weeksToFetch()`), how fetched weeks join the state (`applyWeeks()`), the refusal to mix config versions
// (`checkStateVersions()`) and a week's last morning (`lastMorning()`). Pure: no file, no clock, no network, no randomness; the
// scripts (`scripts/metrics.ts`, `scripts/backfill.ts`) fetch, read and stage, and pass in what they got, the date and the
// timestamp of the run.
//
// What a run does, in order (the scripts of wave 2 follow it):
//   1. `checkStateVersions(state, versions)` on the stored weekly state: a mismatch is `E_METRICS` and stages nothing.
//   2. `weeksToFetch(state, cutoff, settings)` names the weeks to ask OpenAlex for; the script fetches their four requests each.
//   3. `applyWeeks(state, requests, ...)` joins the answers to the state: the state to stage.
//   4. `computeMetrics({ weekly: { kind: "current", state, requests }, ... })` gives the file and the manifest. When OpenAlex
//      failed, `{ kind: "reused", state }` (the last good state) gives a stale file and `{ kind: "none" }` a missing one.
//
// Cyber's lib/metrics/index.ts at the fork commit 3ced1fb, adapted: its `computeMetrics()` (inputs, `ComputeResult`, the
// ok, stale and failed block statuses with a note, the manifest assembled from what was read) is the shape; its days, credits,
// flaw and exploit steps give way to this project's weekly Pace, C, D and counters, and the state logic of §5.4 is new.

import { addDays, taipeiDateOf, weekday } from "../dates";
import type { FilingCorrection } from "../items";
import { IsoTimestamp, type IsoDate } from "../schema/common";
import type { Counter } from "../schema/config";
import {
  InputsManifest, MetricsFile, OPENALEX_REQUESTS, PACE_BASELINE, PaceWeeklyFile,
  type ConfigVersions, type OpenAlexRequest, type PaceBlock, type PaceVersions, type PaceWeek,
} from "../schema/metrics";
import { FIELDS, type FieldId } from "../vocab";
import { computeCounters, type CounterAttempt, type PreviousCounters } from "./counters";
import { holdRate, landmarkCounts, ledgerQuotable, type HoldSettings, type LedgerFinding } from "./ledger-stats";
import { buildPace, dataCutoff, missingPace, paceRanges, type PaceSettings } from "./pace";

export type { CounterAttempt, PreviousCounters } from "./counters";

/** The first week of the state: the Monday the baseline starts, 2015-01-05 (SPEC §4.7). */
export const FIRST_WEEK: IsoDate = PACE_BASELINE.from;

/** `config/run.json`'s `pace` settings (SPEC §4.11): the Pace's four and the Hold rate's `hold_after_days`. */
export type MetricsSettings = PaceSettings & Pick<HoldSettings, "hold_after_days">;

// ── The config versions (§5.4) ───────────────────────────────────────────────────────────────────

/** `E_METRICS` (SPEC §5.4, §8.2): the run stages no metrics file, and the brief's Pace is `missing`. */
export class MetricsError extends Error {
  readonly code = "E_METRICS" as const;

  constructor(message: string) {
    super(message);
    this.name = "MetricsError";
  }
}

/** The three config files the weekly state is built from, as `versions` keys with the names the message gives them. */
const STATE_CONFIG_FILES = [["ai_terms", "ai-terms"], ["journals", "journals"], ["fields", "fields"]] as const;

/** The three versions the weekly state depends on, from all four a metrics file records: the counters do not touch it (§5.4). */
export function paceVersions(versions: PaceVersions | ConfigVersions): PaceVersions {
  return { ai_terms: versions.ai_terms, journals: versions.journals, fields: versions.fields };
}

/**
 * One message for each config file whose version differs from the one the state was built with, in the order ai-terms, journals,
 * fields: "pace-weekly.json was built with ai-terms v1; config has v2: run npm run backfill -- --pace --refresh, with --push after
 * go-live (SPEC §5.4)."
 */
export function stateVersionProblems(state: { readonly versions: PaceVersions }, config: PaceVersions | ConfigVersions): string[] {
  return STATE_CONFIG_FILES.filter(([key]) => state.versions[key] !== config[key]).map(([key, name]) =>
    `pace-weekly.json was built with ${name} v${state.versions[key]}; config has v${config[key]}: run npm run backfill -- --pace --refresh, with --push after go-live (SPEC §5.4).`);
}

/** Throws `MetricsError` with the first of `stateVersionProblems()` when the state was built with other versions than the config's. */
export function checkStateVersions(state: { readonly versions: PaceVersions }, config: PaceVersions | ConfigVersions): void {
  const [first] = stateVersionProblems(state, config);
  if (first !== undefined) throw new MetricsError(first);
}

// ── Which weeks to fetch (§5.4) ──────────────────────────────────────────────────────────────────

/**
 * A week's last morning (SPEC §5.4): the last morning that refetches it as the newest firm week, 7 × `provisional_weeks` + 8 days
 * after its Sunday (64 with 8 provisional weeks).
 */
export function lastMorning(weekSunday: IsoDate, settings: Pick<PaceSettings, "provisional_weeks">): IsoDate {
  if (weekday(weekSunday) !== 0) throw new RangeError(`A week's Sunday is a Sunday, got ${weekSunday}`);
  return addDays(weekSunday, 7 * settings.provisional_weeks + 8);
}

/** The Sunday that ends the newest week of a weekly state, or null for a state with no week. */
export function stateCutoff(state: { readonly weeks: readonly PaceWeek[] }): IsoDate | null {
  const newest = state.weeks[state.weeks.length - 1];
  return newest === undefined ? null : addDays(newest.week_start, 6);
}

/** Every Monday from `from` to `to`, newest first. */
function mondaysDown(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let monday = to; monday >= from; monday = addDays(monday, -7)) out.push(monday);
  return out;
}

export interface WeekPlan {
  /** The Mondays to fetch, newest first. */
  readonly weeks: IsoDate[];
  /** Weeks owed a fetch that the cap of `window_weeks` older weeks leaves for a later morning, newest first. */
  readonly deferred: IsoDate[];
  /**
   * The deferred weeks that are missing from the state. While there is one, the state cannot be made whole today (it must hold
   * every week, §4.7): the morning reuses the last good state, and the backfill (`npm run backfill -- --pace`) catches up.
   */
  readonly uncovered: IsoDate[];
}

/**
 * The weeks a run fetches (SPEC §5.4), as the Mondays of the weeks, newest first. For a morning (the default): the
 * `provisional_weeks` provisional weeks and the newest firm week (9 weeks, 36 requests), then the older firm weeks that were
 * fetched before their last morning or are missing from `state`, newest first, at most `window_weeks` of them. For the backfill:
 * every week from 2015-01-05 to the cutoff. The cutoff is the run's `data_cutoff`, a Sunday; `state` may be null (no state: every
 * older week is missing).
 */
export function weeksToFetch(
  state: { readonly weeks: readonly PaceWeek[] } | null, cutoff: IsoDate, settings: Pick<PaceSettings, "window_weeks" | "provisional_weeks">,
  mode: "morning" | "backfill" = "morning",
): WeekPlan {
  const ranges = paceRanges(cutoff, settings);
  const all = mondaysDown(FIRST_WEEK, addDays(cutoff, -6));
  if (mode === "backfill") return { weeks: all, deferred: [], uncovered: [] };
  const newestFirm = addDays(ranges.provisional.from, -7);
  const held = new Map((state?.weeks ?? []).map((w) => [w.week_start, w]));
  const owed = all.filter((monday) => {
    if (monday >= newestFirm) return false;
    const week = held.get(monday);
    return week === undefined || week.fetched < lastMorning(addDays(monday, 6), settings);
  });
  return {
    weeks: [...all.filter((monday) => monday >= newestFirm), ...owed.slice(0, settings.window_weeks)],
    deferred: owed.slice(settings.window_weeks),
    uncovered: owed.slice(settings.window_weeks).filter((monday) => !held.has(monday)),
  };
}

// ── Applying fetched weeks (§5.4) ────────────────────────────────────────────────────────────────

/** The [AI-method papers, all papers] of each of our fields from a group-by answer's counts. */
function pairs(ai: OpenAlexRequest, total: OpenAlexRequest, week: IsoDate, set: string): Record<FieldId, [number, number]> {
  return Object.fromEntries(FIELDS.map((field) => {
    const [k, n] = [ai.counts[field], total.counts[field]];
    if (k > n) throw new RangeError(`OpenAlex counted more AI-method papers (${k}) than papers (${n}) in ${field} (${set}) for the week of ${week}`);
    return [field, [k, n]];
  })) as Record<FieldId, [number, number]>;
}

/**
 * One week's `PaceWeek` from the four answers of its group-by requests (SPEC §5.1, §4.7): the counts per field are each answer's
 * `counts`, `leading` from `leading_ai` and `leading_total`, `all` from `all_ai` and `all_total`; `fetched` is the earliest Taipei
 * date of the four answers (each `fetched_at` must carry its offset). `provisional` is the caller's to set (`applyWeeks()` does). Throws
 * unless there is exactly one answer of each of the four kinds, all for the week's Monday, when an answer's fetch time has no offset, or
 * when an answer counts more AI-method papers than papers.
 */
export function weekFromRequests(requests: readonly OpenAlexRequest[]): PaceWeek {
  const first = requests[0];
  if (first === undefined) throw new RangeError("A week needs its four answers");
  const week = first.week_start;
  const by = new Map<string, OpenAlexRequest>();
  for (const r of requests) {
    if (r.week_start !== week) throw new RangeError(`The answers are for two weeks: ${week} and ${r.week_start}`);
    if (by.has(r.request)) throw new RangeError(`The week of ${week} has two ${r.request} answers`);
    by.set(r.request, r);
  }
  for (const kind of OPENALEX_REQUESTS) if (!by.has(kind)) throw new RangeError(`The week of ${week} has no ${kind} answer`);
  const get = (kind: (typeof OPENALEX_REQUESTS)[number]): OpenAlexRequest => by.get(kind) as OpenAlexRequest;
  // A timestamp with no offset would be read in the machine's zone by Date.parse(): refuse it, so no zone is ever read (§4.1).
  const fetchedOn = [...by.values()].map((r) => {
    if (!IsoTimestamp.safeParse(r.fetched_at).success) throw new RangeError(`The ${r.request} answer for the week of ${week} has no fetch time with an offset`);
    return taipeiDateOf(r.fetched_at);
  });
  return {
    week_start: week,
    fetched: fetchedOn.reduce((a, b) => (b < a ? b : a)),
    provisional: false,
    leading: pairs(get("leading_ai"), get("leading_total"), week, "leading journals"),
    all: pairs(get("all_ai"), get("all_total"), week, "all papers"),
  };
}

export interface ApplyOptions {
  /** The run's `data_cutoff`: the state ends with the week it ends. */
  readonly cutoff: IsoDate;
  /** The Taipei date of the run that writes the state (`updated`). */
  readonly updated: IsoDate;
  /** The versions of the three config files the state is built with. */
  readonly versions: PaceVersions | ConfigVersions;
  readonly settings: Pick<PaceSettings, "window_weeks" | "provisional_weeks">;
}

/**
 * The weekly state after a run (SPEC §5.4): `state` with the weeks of `requests` (four answers each) replacing the ones it holds,
 * every week from 2015-01-05 to the cutoff, and the newest `provisional_weeks` marked provisional, so a week that leaves the
 * provisional span becomes firm with the fetch date it already has. A week that was not fetched is kept as it is. Weeks of `state`
 * after the cutoff are dropped. `state` may be null (a backfill from nothing); a state built with other versions than `versions`
 * throws `MetricsError`. Throws when a fetched week is not a Monday of the span, or when a week is left missing (`weeksToFetch()`'s
 * `uncovered`): the result must be a state `PaceWeeklyFile` accepts.
 */
export function applyWeeks(state: PaceWeeklyFile | null, requests: readonly OpenAlexRequest[], options: ApplyOptions): PaceWeeklyFile {
  const versions = paceVersions(options.versions);
  if (state !== null) checkStateVersions(state, versions);
  const ranges = paceRanges(options.cutoff, options.settings);
  const lastMonday = addDays(options.cutoff, -6);
  const byWeek = new Map<IsoDate, OpenAlexRequest[]>();
  for (const r of requests) byWeek.set(r.week_start, [...(byWeek.get(r.week_start) ?? []), r]);
  const fetched = new Map<IsoDate, PaceWeek>();
  for (const [monday, group] of byWeek) {
    if (weekday(monday) !== 1 || monday < FIRST_WEEK || monday > lastMonday) {
      throw new RangeError(`${monday} is not a Monday from ${FIRST_WEEK} to ${lastMonday}`);
    }
    fetched.set(monday, weekFromRequests(group));
  }
  const held = new Map((state?.weeks ?? []).map((w) => [w.week_start, w]));
  const weeks: PaceWeek[] = [];
  for (let monday = FIRST_WEEK; monday <= lastMonday; monday = addDays(monday, 7)) {
    const week = fetched.get(monday) ?? held.get(monday);
    if (week === undefined) throw new RangeError(`The weekly state has no week starting ${monday}`);
    weeks.push({ ...week, provisional: monday >= ranges.provisional.from });
  }
  return PaceWeeklyFile.parse({ schema_version: 1, versions, updated: options.updated, weeks });
}

/** True when `weeks` holds every week the Pace of a state ending on `cutoff` reads: the window, the year-ago window and the baseline. */
export function paceCovered(weeks: readonly { readonly week_start: IsoDate }[], cutoff: IsoDate, settings: Pick<PaceSettings, "window_weeks" | "provisional_weeks">): boolean {
  const held = new Set(weeks.map((w) => w.week_start));
  const ranges = paceRanges(cutoff, settings);
  return [ranges.window, ranges.yearAgo, ranges.baseline].every((span) => {
    for (let monday = span.from; monday <= span.to; monday = addDays(monday, 7)) if (!held.has(monday)) return false;
    return true;
  });
}

// ── The metrics file ─────────────────────────────────────────────────────────────────────────────

/**
 * The weekly state the Pace is computed from, and how the run got it:
 * `current`: the state of this run, complete to the data cutoff of D (`applyWeeks()`'s result, or a backfill's frozen one), with the
 * OpenAlex requests the run's manifest lists (the weeks it fetched); status `ok`;
 * `reused`: OpenAlex failed and this is the last good state, as stored: status `stale`, dated by the state's own newest Sunday
 * (or `missing` when it cannot give a Pace);
 * `none`: there is no state: status `missing`.
 */
export type WeeklyInput =
  | { readonly kind: "current"; readonly state: PaceWeeklyFile; readonly requests: readonly OpenAlexRequest[] }
  | { readonly kind: "reused"; readonly state: PaceWeeklyFile }
  | { readonly kind: "none" };

export interface MetricsInput {
  /** The edition date D, a Taipei date. */
  readonly date: IsoDate;
  /** The time of the run, with its offset (`computed_at`). */
  readonly computedAt: IsoTimestamp;
  readonly settings: MetricsSettings;
  /** The versions of the four config files (`configVersions()` of lib/config.ts). */
  readonly versions: ConfigVersions;
  readonly weekly: WeeklyInput;
  /** Every stored finding and correction: C, D and the ledger counter read them as `filedAs()` files them on D - 1 (§4.10). */
  readonly findings: readonly LedgerFinding[];
  readonly corrections: readonly FilingCorrection[];
  readonly counters: {
    /** `config/counters.json`'s `counters`, in its order. */
    readonly config: readonly Counter[];
    /** Today is a day the counters are read: a Monday, or `metrics --counters` (`countersDue()`). */
    readonly readToday: boolean;
    /** What the script got for each API counter it tried today, by id; an API counter with no entry is carried. */
    readonly attempts: Readonly<Record<string, CounterAttempt | undefined>>;
    /** The previous metrics file's counters and its manifest's, or null when there is none. */
    readonly previous: PreviousCounters | null;
  };
}

export interface MetricsResult {
  /** The metrics file, checked against `MetricsFile`. */
  readonly metrics: MetricsFile;
  /** The inputs manifest, checked against `InputsManifest`. */
  readonly manifest: InputsManifest;
  /** One line for each thing worth a note in the run's log: a stale or missing Pace, a counter kept stale or without a reading. */
  readonly log: string[];
}

/** `OPENALEX_REQUESTS`' order, for sorting a week's requests. */
const REQUEST_ORDER: ReadonlyMap<string, number> = new Map(OPENALEX_REQUESTS.map((kind, i) => [kind, i]));

/** The requests the manifest lists, by week (oldest first) and then in `OPENALEX_REQUESTS`' order, whatever order the script made them in. */
function manifestRequests(requests: readonly OpenAlexRequest[]): OpenAlexRequest[] {
  return [...requests].sort((a, b) =>
    (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : 0) || (REQUEST_ORDER.get(a.request) as number) - (REQUEST_ORDER.get(b.request) as number));
}

/** Throws when a request disagrees with the state's week it names: the manifest must list the answers the figures came from. */
function checkRequestsAgree(state: PaceWeeklyFile, requests: readonly OpenAlexRequest[]): void {
  const weeks = new Map(state.weeks.map((w) => [w.week_start, w]));
  const byWeek = new Map<IsoDate, OpenAlexRequest[]>();
  for (const r of requests) byWeek.set(r.week_start, [...(byWeek.get(r.week_start) ?? []), r]);
  for (const [monday, group] of byWeek) {
    const week = weeks.get(monday);
    if (week === undefined) throw new RangeError(`The manifest lists a request for the week of ${monday}, which the state does not hold`);
    const built = weekFromRequests(group);
    for (const set of ["leading", "all"] as const) {
      for (const field of FIELDS) {
        if (built[set][field][0] !== week[set][field][0] || built[set][field][1] !== week[set][field][1]) {
          throw new RangeError(`The requests for the week of ${monday} do not give the counts the state holds (${field}, ${set})`);
        }
      }
    }
  }
}

/**
 * The metrics file and the inputs manifest of D (SPEC §4.7, §5, §8.4). The Pace is the state's (`ok`), the last good state's
 * (`stale`: its own `data_cutoff`, windows and cells, and the stale line of §5.2) or `missingPace()` (`missing`, also when a reused
 * state cannot give a Pace); C, D and the counters are computed as on any morning. A state built with other config versions throws
 * `MetricsError` whatever its use. A `current` state must end on D's own data cutoff and a `reused` one on or before it.
 */
export function computeMetrics(input: MetricsInput): MetricsResult {
  const { date, settings, weekly } = input;
  const log: string[] = [];
  const newest = dataCutoff(date);
  const { landmarks, ids: landmarkIds } = landmarkCounts(input.findings, input.corrections, date);
  const { hold, case_ids: holdCaseIds } = holdRate(input.findings, input.corrections, date, settings);
  const extraQuotable = ledgerQuotable(landmarks, hold, date);

  let status: MetricsFile["status"] = "missing";
  let cutoff = newest;
  let pace: PaceBlock = missingPace(date, settings);
  let requests: readonly OpenAlexRequest[] = [];
  if (weekly.kind !== "none") {
    checkStateVersions(weekly.state, input.versions);
    const own = stateCutoff(weekly.state);
    if (weekly.kind === "current") {
      if (own !== newest) throw new RangeError(`The state of a run for ${date} ends on ${own ?? "no week"}, not on the data cutoff ${newest}`);
      checkRequestsAgree(weekly.state, weekly.requests);
      status = "ok";
      pace = buildPace({ weeks: weekly.state.weeks, cutoff, settings, extraQuotable });
      requests = weekly.requests;
    } else if (own !== null && own > newest) {
      throw new RangeError(`The reused state ends on ${own}, after the data cutoff ${newest} of ${date}`);
    } else if (own === null || !paceCovered(weekly.state.weeks, own, settings)) {
      log.push("Pace: the last weekly state cannot give a Pace; the file is missing.");
    } else {
      status = "stale";
      cutoff = own;
      pace = buildPace({ weeks: weekly.state.weeks, cutoff, settings, stale: true, extraQuotable });
      log.push(`Pace: OpenAlex was not read; the last weekly state is reused, with data to ${own}.`);
    }
  } else {
    log.push("Pace: there is no weekly state; the file is missing.");
  }

  const counters = computeCounters({
    counters: input.counters.config, date, readToday: input.counters.readToday, attempts: input.counters.attempts,
    previous: input.counters.previous, findings: input.findings, corrections: input.corrections,
  });
  log.push(...counters.log);

  const metrics = MetricsFile.parse({
    schema_version: 1, date, computed_at: input.computedAt, data_cutoff: cutoff, versions: input.versions, status, pace, landmarks, hold,
    counters: counters.readings,
  });
  const manifest = InputsManifest.parse({
    schema_version: 1, date, computed_at: input.computedAt, data_cutoff: cutoff, versions: input.versions,
    openalex: manifestRequests(requests), counters: counters.inputs, landmark_ids: landmarkIds, hold_case_ids: holdCaseIds,
  });
  return { metrics, manifest, log };
}
