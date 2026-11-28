// lib/metrics/index.ts (SPEC §5.4 the weekly series and the backfill, §4.7 the metrics file, its inputs manifest and the state, §8.4):
// `computeMetrics()` in its three statuses (ok, stale, missing), each file complete in shape and valid against `MetricsFile`; the weeks
// a morning fetches in each situation of §5.4 (a normal morning: 9 weeks; an older firm week fetched before its last morning; a week
// missing after nine weeks or more without a run; a gap the cap leaves; no state) and the backfill's full range; how fetched weeks join
// the state (provisional weeks, a week leaving them, nothing else recomputed); the E_METRICS text of a version mismatch for each of the
// three config files; the manifest's requests and ids; quotable paths; determinism; a season of mornings run one after another, with
// skipped mornings and gaps (no week keeps a count fetched before its last morning; a gap of more than 22 weeks is reported); that no key
// or e-mail address from a request URL reaches an error; and that no zone is read from a fetch time. Worked on
// `fixtures/state/pace-weekly.json` (the state the weekday's run leaves) and on small states built here. New for this project; Cyber's
// tests/metrics.test.ts has no counterpart.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { addDays, daysBetween } from "@/lib/dates";
import { sha256Hex } from "@/lib/json";
import {
  FIRST_WEEK, MetricsError, applyWeeks, checkStateVersions, computeMetrics, lastMorning, paceCovered, paceVersions, stateCutoff,
  stateVersionProblems, weekFromRequests, weeksToFetch, type MetricsInput, type MetricsSettings,
} from "@/lib/metrics/index";
import type { LedgerFinding } from "@/lib/metrics/ledger-stats";
import { dataCutoff, missingPace, paceRanges } from "@/lib/metrics/pace";
import { fmtPct1 } from "@/lib/metrics/stats";
import type { CounterReading, OpenAlexRequest, OpenAlexRequestKind, RequestRecord } from "@/lib/schema/metrics";
import { InputsManifest, MetricsFile, OPENALEX_REQUESTS, PaceWeeklyFile, type ConfigVersions, type PaceWeek } from "@/lib/schema/metrics";
import { FIELDS, type FieldId } from "@/lib/vocab";

const root = path.join(__dirname, "..");
const SEED = loadConfig(path.join(root, "config"));
const SETTINGS: MetricsSettings = { window_weeks: 13, provisional_weeks: 8, min_cases: 30, min_ratio: 1.25, hold_after_days: 182 };
const VERSIONS: ConfigVersions = { ai_terms: 1, journals: 1, fields: 1, counters: 1 };
const read = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
/** A pattern that matches exactly this message, nothing before it and nothing after. */
const exact = (message: string): RegExp => new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The weekly state the weekday's run (2026-10-14) leaves: 614 weeks to Sunday 2026-10-11, the newest 8 provisional and fetched that day. */
const FIXTURE_STATE = PaceWeeklyFile.parse(read("fixtures/state/pace-weekly.json"));
/** The metrics file that run wrote from it. */
const WEEKDAY = MetricsFile.parse(read("fixtures/metrics/weekday.json"));

/** Freezes a value and everything in it, so any write to it throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// ── Builders ─────────────────────────────────────────────────────────────────────────────────────

interface WeekSpec {
  readonly leadingTotal: number;
  readonly leadingAi: number;
  readonly allTotal: number;
  readonly allAi: number;
}
const SPEC: WeekSpec = { leadingTotal: 100, leadingAi: 10, allTotal: 1000, allAi: 50 };

/** The counts of a group-by answer: `n` plus the field's place, so that no two fields agree. */
const counts = (n: number): Record<FieldId, number> => Object.fromEntries(FIELDS.map((f, i) => [f, n + i])) as Record<FieldId, number>;

/** The four answers of a week (§5.1), fetched at `fetchedAt`. */
function weekRequests(monday: string, spec: WeekSpec = SPEC, fetchedAt = "2026-10-15T03:16:00+08:00"): OpenAlexRequest[] {
  const make = (request: OpenAlexRequestKind, n: number): OpenAlexRequest => ({
    request, week_start: monday, url: `https://api.openalex.org/works?filter=from_publication_date:${monday}&ut=${request}&group_by=primary_topic.field.id`,
    fetched_at: fetchedAt, sha256: sha256Hex(`${request}:${monday}`), counts: counts(n), excluded_n: 0, unmapped_n: 0,
  });
  return [make("leading_total", spec.leadingTotal), make("leading_ai", spec.leadingAi), make("all_total", spec.allTotal), make("all_ai", spec.allAi)];
}

/** The Mondays from `from` to `to`, oldest first. */
function mondays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addDays(m, 7)) out.push(m);
  return out;
}

/** The fixture state with the given weeks' `fetched` dates changed. */
function withFetched(state: PaceWeeklyFile, fetched: Record<string, string>): PaceWeeklyFile {
  return { ...state, weeks: state.weeks.map((w) => (w.week_start in fetched ? { ...w, fetched: fetched[w.week_start]! } : w)) };
}

/** The fixture state cut to the weeks that start on or before `lastMonday`. */
const truncated = (lastMonday: string): PaceWeeklyFile => ({ ...FIXTURE_STATE, weeks: FIXTURE_STATE.weeks.filter((w) => w.week_start <= lastMonday) });

const ZERO = { leadingTotal: 1, leadingAi: 0, allTotal: 1, allAi: 0 };

// ── lastMorning, stateCutoff, paceVersions ───────────────────────────────────────────────────────

describe("lastMorning: 64 days after a week's Sunday (SPEC §5.4)", () => {
  it("is 7 x provisional_weeks + 8 days after the Sunday", () => {
    expect(lastMorning("2026-08-16", SETTINGS)).toBe("2026-10-19");
    expect(daysBetween("2026-08-16", lastMorning("2026-08-16", SETTINGS))).toBe(64);
    expect(daysBetween("2026-08-16", lastMorning("2026-08-16", { provisional_weeks: 4 }))).toBe(36);
    expect(daysBetween("2026-08-16", lastMorning("2026-08-16", { provisional_weeks: 1 }))).toBe(15);
  });

  it("refuses a day that is not a Sunday", () => {
    expect(() => lastMorning("2026-08-17", SETTINGS)).toThrow(exact("A week's Sunday is a Sunday, got 2026-08-17"));
    expect(() => lastMorning("2026-08-15", SETTINGS)).toThrow(exact("A week's Sunday is a Sunday, got 2026-08-15"));
  });

  it("is the last morning on which the week is the newest firm week, from the data cutoff the morning has", () => {
    // The week of Monday 2026-08-10 has its Sunday on 2026-08-16.
    const last = lastMorning("2026-08-16", SETTINGS);
    expect(weeksToFetch(FIXTURE_STATE, dataCutoff(last), SETTINGS).weeks).toContain("2026-08-10");
    const nextDay = addDays(last, 1);
    const newest = weeksToFetch(withFetched(FIXTURE_STATE, { "2026-08-10": last }), dataCutoff(nextDay), SETTINGS);
    expect(newest.weeks).not.toContain("2026-08-10");
    expect(dataCutoff(nextDay)).toBe(addDays(dataCutoff(last), 7));
  });
});

describe("stateCutoff, paceVersions and paceCovered", () => {
  it("is the Sunday that ends the state's newest week, or null for no week", () => {
    expect(stateCutoff(FIXTURE_STATE)).toBe("2026-10-11");
    expect(stateCutoff({ weeks: [] })).toBeNull();
    expect(stateCutoff(truncated("2026-07-20"))).toBe("2026-07-26");
  });

  it("keeps the three versions the state depends on, and not the counters'", () => {
    expect(paceVersions({ ai_terms: 3, journals: 4, fields: 5, counters: 9 })).toEqual({ ai_terms: 3, journals: 4, fields: 5 });
    expect(paceVersions({ ai_terms: 3, journals: 4, fields: 5 })).toEqual({ ai_terms: 3, journals: 4, fields: 5 });
  });

  it("is covered when the window, the year-ago window and the baseline are all there", () => {
    expect(paceCovered(FIXTURE_STATE.weeks, "2026-10-11", SETTINGS)).toBe(true);
    expect(paceCovered(FIXTURE_STATE.weeks, "2026-07-26", SETTINGS)).toBe(true);
  });

  it.each([
    ["a week of the baseline", "2017-06-12"],
    ["the first week of the baseline", "2015-01-05"],
    ["the last week of the baseline", "2019-12-23"],
    ["the first week of the year-ago window", "2025-05-26"],
    ["the last week of the year-ago window", "2025-08-11"],
    ["the first week of the window", "2026-05-18"],
    ["the last week of the window", "2026-08-10"],
  ])("is not covered without %s", (_name, monday) => {
    const ranges = paceRanges("2026-10-11", SETTINGS);
    // the weeks named are inside the ranges of cutoff 2026-10-11 (window 2026-05-18 to 2026-08-16)
    expect(monday >= "2015-01-05").toBe(true);
    expect(paceCovered(FIXTURE_STATE.weeks.filter((w) => w.week_start !== monday), "2026-10-11", SETTINGS), `${monday} in ${JSON.stringify(ranges)}`)
      .toBe(false);
  });

  it("is not covered by a state that is too short for the cutoff, and does not need the provisional or the newest firm weeks", () => {
    expect(paceCovered(FIXTURE_STATE.weeks.filter((w) => w.week_start <= "2020-01-06"), "2026-10-11", SETTINGS)).toBe(false);
    expect(paceCovered(FIXTURE_STATE.weeks.filter((w) => w.week_start <= "2026-08-10"), "2026-10-11", SETTINGS)).toBe(true);
    expect(paceCovered([], "2026-10-11", SETTINGS)).toBe(false);
  });
});

// ── The version check ────────────────────────────────────────────────────────────────────────────

describe("the version check refuses to mix versions (SPEC §5.4)", () => {
  const state = { versions: { ai_terms: 1, journals: 2, fields: 3 } };

  it.each([
    ["ai_terms", "ai-terms", { ai_terms: 4, journals: 2, fields: 3 }, 1, 4],
    ["journals", "journals", { ai_terms: 1, journals: 7, fields: 3 }, 2, 7],
    ["fields", "fields", { ai_terms: 1, journals: 2, fields: 9 }, 3, 9],
  ] as const)("gives the exact E_METRICS text for a changed %s", (_key, name, config, built, now) => {
    const text = `pace-weekly.json was built with ${name} v${built}; config has v${now}: run npm run backfill -- --pace --refresh, with --push after go-live (SPEC §5.4).`;
    expect(stateVersionProblems(state, config)).toEqual([text]);
    expect(() => checkStateVersions(state, config)).toThrow(text);
    try {
      checkStateVersions(state, config);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MetricsError);
      expect((e as MetricsError).code).toBe("E_METRICS");
      expect((e as MetricsError).name).toBe("MetricsError");
      expect((e as MetricsError).message).toBe(text);
    }
  });

  it("passes a state built with the config's versions, and ignores the counters' version", () => {
    expect(stateVersionProblems(state, { ai_terms: 1, journals: 2, fields: 3 })).toEqual([]);
    expect(stateVersionProblems(state, { ai_terms: 1, journals: 2, fields: 3, counters: 99 })).toEqual([]);
    expect(() => checkStateVersions(state, { ai_terms: 1, journals: 2, fields: 3, counters: 99 })).not.toThrow();
  });

  it("names every file that changed, in the order ai-terms, journals, fields, and throws the first", () => {
    const problems = stateVersionProblems(state, { ai_terms: 2, journals: 3, fields: 4 });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("ai-terms v1; config has v2");
    expect(problems[1]).toContain("journals v2; config has v3");
    expect(problems[2]).toContain("fields v3; config has v4");
    expect(() => checkStateVersions(state, { ai_terms: 2, journals: 3, fields: 4 })).toThrow(problems[0]!);
  });

  it("is refused by applyWeeks and by computeMetrics, for a state that was built with other versions", () => {
    const options = { cutoff: "2026-10-11", updated: "2026-10-15", versions: { ai_terms: 1, journals: 1, fields: 2 }, settings: SETTINGS };
    expect(() => applyWeeks(FIXTURE_STATE, [], options)).toThrow(/pace-weekly\.json was built with fields v1; config has v2/);
    const input = (weekly: MetricsInput["weekly"]): MetricsInput => ({ ...baseInput(), weekly, versions: { ai_terms: 1, journals: 1, fields: 2, counters: 1 } });
    expect(() => computeMetrics(input({ kind: "current", state: FIXTURE_STATE, requests: [] }))).toThrow(MetricsError);
    expect(() => computeMetrics(input({ kind: "reused", state: FIXTURE_STATE }))).toThrow(/fields v1; config has v2/);
    expect(() => computeMetrics({ ...input({ kind: "none" }), versions: VERSIONS })).not.toThrow();
  });
});

// ── weeksToFetch ─────────────────────────────────────────────────────────────────────────────────

describe("weeksToFetch: a normal morning (SPEC §5.4)", () => {
  it("fetches the 8 provisional weeks and the newest firm week, newest first: 9 weeks, 36 requests", () => {
    const plan = weeksToFetch(FIXTURE_STATE, dataCutoff("2026-10-15"), SETTINGS);
    expect(plan.weeks).toEqual(["2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31", "2026-08-24", "2026-08-17", "2026-08-10"]);
    expect(plan.weeks.length * OPENALEX_REQUESTS.length).toBe(36);
    expect(plan.deferred).toEqual([]);
    expect(plan.uncovered).toEqual([]);
  });

  it("is the same 9 weeks on each morning of a week, and the next 9 from the morning the data cutoff moves a week on", () => {
    const monday = weeksToFetch(FIXTURE_STATE, dataCutoff("2026-10-19"), SETTINGS).weeks;
    expect(monday).toEqual(weeksToFetch(FIXTURE_STATE, dataCutoff("2026-10-15"), SETTINGS).weeks);
    const tuesday = weeksToFetch(FIXTURE_STATE, dataCutoff("2026-10-20"), SETTINGS);
    expect(tuesday.weeks.slice(0, 9)).toEqual(["2026-10-12", "2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31", "2026-08-24", "2026-08-17"]);
  });

  it("follows provisional_weeks and window_weeks of the settings", () => {
    expect(weeksToFetch(FIXTURE_STATE, "2026-10-11", { window_weeks: 13, provisional_weeks: 2 }).weeks).toEqual(["2026-10-05", "2026-09-28", "2026-09-21"]);
    expect(weeksToFetch(FIXTURE_STATE, "2026-10-11", { window_weeks: 1, provisional_weeks: 5 }).weeks).toEqual(
      ["2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31"]);
    expect(() => weeksToFetch(FIXTURE_STATE, "2026-10-12", SETTINGS)).toThrow(RangeError);
  });
});

describe("weeksToFetch: older firm weeks fetched before their last morning", () => {
  it("adds a week that the state holds with a fetch date before its last morning, and not one fetched on it", () => {
    // On the morning of 2026-10-20 (data cutoff 2026-10-18) the week of 2026-08-10 (Sunday 2026-08-16, last morning 2026-10-19) is
    // an older firm week. The fixture state fetched it on 2026-10-14, before that morning: it is owed.
    const owed = weeksToFetch(FIXTURE_STATE, dataCutoff("2026-10-20"), SETTINGS);
    expect(owed.weeks).toHaveLength(10);
    expect(owed.weeks[9]).toBe("2026-08-10");
    // fetched on its last morning, it is owed no longer
    const done = weeksToFetch(withFetched(FIXTURE_STATE, { "2026-08-10": "2026-10-19" }), dataCutoff("2026-10-20"), SETTINGS);
    expect(done.weeks).toHaveLength(9);
    // one day short of it, it is owed again
    const short = weeksToFetch(withFetched(FIXTURE_STATE, { "2026-08-10": "2026-10-18" }), dataCutoff("2026-10-20"), SETTINGS);
    expect(short.weeks).toHaveLength(10);
    // after it, never
    expect(weeksToFetch(withFetched(FIXTURE_STATE, { "2026-08-10": "2026-12-01" }), dataCutoff("2026-10-20"), SETTINGS).weeks).toHaveLength(9);
  });

  it("owes every older firm week of the fixture state nothing: each was fetched on its last morning", () => {
    expect(weeksToFetch(FIXTURE_STATE, dataCutoff("2026-10-19"), SETTINGS).weeks).toHaveLength(9);
    for (const w of FIXTURE_STATE.weeks.filter((x) => !x.provisional && x.week_start < "2026-08-10")) {
      expect(w.fetched, w.week_start).toBe(addDays(w.week_start, 70));
    }
  });

  it("fetches the owed weeks newest first, after the 9, and counts a week fetched by a backfill while it was newer as owed", () => {
    const state = withFetched(FIXTURE_STATE, { "2026-08-03": "2026-10-05", "2026-05-04": "2026-07-12", "2026-01-12": "2026-03-01" });
    const plan = weeksToFetch(state, "2026-10-11", SETTINGS);
    expect(plan.weeks.slice(9)).toEqual(["2026-08-03", "2026-05-04", "2026-01-12"]);
    expect(plan.deferred).toEqual([]);
  });

  it("fetches at most window_weeks of them, the newest, and defers the rest to later mornings", () => {
    const owedMondays = mondays("2026-03-23", "2026-08-03");
    expect(owedMondays).toHaveLength(20);
    const state = withFetched(FIXTURE_STATE, Object.fromEntries(owedMondays.map((m) => [m, "2020-01-01"])));
    const plan = weeksToFetch(state, "2026-10-11", SETTINGS);
    expect(plan.weeks).toHaveLength(9 + 13);
    expect(plan.weeks.slice(9)).toEqual(owedMondays.slice(7).reverse());
    expect(plan.deferred).toEqual(owedMondays.slice(0, 7).reverse());
    expect(plan.uncovered).toEqual([]);
  });

  it("caps at the settings' window_weeks", () => {
    const state = withFetched(FIXTURE_STATE, { "2026-08-03": "2020-01-01", "2026-07-27": "2020-01-01", "2026-07-20": "2020-01-01" });
    const plan = weeksToFetch(state, "2026-10-11", { window_weeks: 2, provisional_weeks: 8 });
    expect(plan.weeks.slice(9)).toEqual(["2026-08-03", "2026-07-27"]);
    expect(plan.deferred).toEqual(["2026-07-20"]);
  });
});

describe("weeksToFetch: weeks missing from the state (after nine weeks or more without a run)", () => {
  it("fetches the weeks missing between the state and the 9, newest first", () => {
    // The state ends with the week of 2026-07-20 (Sunday 2026-07-26): the morning of 2026-10-15 has two weeks, 2026-07-27 and 2026-08-03,
    // that the 9 it always fetches (2026-08-10 on) do not reach.
    const plan = weeksToFetch(truncated("2026-07-20"), dataCutoff("2026-10-15"), SETTINGS);
    expect(plan.weeks).toHaveLength(11);
    expect(plan.weeks.slice(9)).toEqual(["2026-08-03", "2026-07-27"]);
    expect(plan.uncovered).toEqual([]);
  });

  it("needs nothing more than the 9 for a run that follows one nine weeks before, and one week more leaves a week missing", () => {
    // The state's newest week is 2026-08-10 (its run's cutoff 2026-08-16), the week fetched on its last morning, 2026-10-19. A run with
    // cutoff 2026-10-18 (63 days on) has 9 weeks that start on 2026-08-17: none is missing.
    const state = withFetched(truncated("2026-08-10"), { "2026-08-10": "2026-10-19" });
    const plan = weeksToFetch(state, "2026-10-18", SETTINGS);
    expect(plan.weeks).toEqual(mondays("2026-08-17", "2026-10-12").reverse());
    // one week later (70 days on), the 9 start on 2026-08-24 and the week of 2026-08-17 is missing
    const later = weeksToFetch(state, "2026-10-25", SETTINGS);
    expect(later.weeks).toHaveLength(10);
    expect(later.weeks[9]).toBe("2026-08-17");
    expect(later.uncovered).toEqual([]);
  });

  it("reports the weeks the cap leaves missing as uncovered, so the morning knows it cannot make the state whole", () => {
    const state = truncated("2026-01-26");
    const missing = mondays("2026-02-02", "2026-08-03");
    expect(missing).toHaveLength(27);
    const plan = weeksToFetch(state, "2026-10-11", SETTINGS);
    expect(plan.weeks).toHaveLength(9 + 13);
    expect(plan.weeks.slice(9)).toEqual(missing.slice(-13).reverse());
    expect(plan.deferred).toEqual(missing.slice(0, 14).reverse());
    expect(plan.uncovered).toEqual(plan.deferred);
  });

  it("treats every older week as missing when there is no state", () => {
    const plan = weeksToFetch(null, "2026-10-11", SETTINGS);
    expect(plan.weeks).toHaveLength(22);
    expect(plan.weeks.slice(9)).toEqual(mondays("2026-05-11", "2026-08-03").reverse());
    expect(plan.uncovered).toHaveLength(daysBetween("2015-01-05", "2026-05-04") / 7 + 1);
    expect(plan.uncovered[plan.uncovered.length - 1]).toBe("2015-01-05");
    expect(plan.deferred).toEqual(plan.uncovered);
  });

  it("separates an owed week that the state holds (deferred only) from a missing one (also uncovered)", () => {
    const state = withFetched(truncated("2026-07-20"), Object.fromEntries(mondays("2026-04-06", "2026-07-20").map((m) => [m, "2020-01-01"])));
    const plan = weeksToFetch(state, "2026-10-11", { window_weeks: 1, provisional_weeks: 8 });
    expect(plan.weeks.slice(9)).toEqual(["2026-08-03"]);
    // 2026-07-27 is missing from the state and the cap leaves it; the 16 weeks the state holds with an early fetch date come after it
    expect(plan.deferred).toEqual(["2026-07-27", ...mondays("2026-04-06", "2026-07-20").reverse()]);
    expect(plan.uncovered).toEqual(["2026-07-27"]);
    // with a cap that reaches every missing week, the weeks the state holds that are deferred leave nothing uncovered
    const wide = weeksToFetch(state, "2026-10-11", { window_weeks: 3, provisional_weeks: 8 });
    expect(wide.weeks.slice(9)).toEqual(["2026-08-03", "2026-07-27", "2026-07-20"]);
    expect(wide.deferred).toHaveLength(15);
    expect(wide.uncovered).toEqual([]);
  });

  it("leaves a newest firm week that the state lacks to the 9, never to the cap", () => {
    const plan = weeksToFetch(truncated("2026-08-03"), "2026-10-11", SETTINGS);
    expect(plan.weeks).toHaveLength(9);
    expect(plan.weeks[8]).toBe("2026-08-10");
  });
});

describe("weeksToFetch: the backfill", () => {
  it("fetches every week from 2015-01-05 to the cutoff, newest first, whatever the state holds", () => {
    const cutoff = "2026-10-11";
    const weeks = mondays("2015-01-05", "2026-10-05");
    for (const state of [FIXTURE_STATE, null, truncated("2020-01-06")]) {
      const plan = weeksToFetch(state, cutoff, SETTINGS, "backfill");
      expect(plan.weeks).toEqual([...weeks].reverse());
      expect(plan.deferred).toEqual([]);
      expect(plan.uncovered).toEqual([]);
    }
    expect(weeks).toHaveLength(daysBetween("2015-01-05", "2026-10-05") / 7 + 1);
    expect(weeks[0]).toBe(FIRST_WEEK);
  });

  it("ends the range at the week that ends on the cutoff, and does not follow window_weeks", () => {
    expect(weeksToFetch(null, "2015-01-11", { window_weeks: 1, provisional_weeks: 1 }, "backfill").weeks).toEqual(["2015-01-05"]);
    expect(weeksToFetch(null, "2015-01-18", { window_weeks: 1, provisional_weeks: 1 }, "backfill").weeks).toEqual(["2015-01-12", "2015-01-05"]);
  });
});

// ── weekFromRequests and applyWeeks ──────────────────────────────────────────────────────────────

describe("weekFromRequests: one week's four answers", () => {
  it("takes each field's counts from the answers: leading from the leading pair, all from the all pair", () => {
    const week = weekFromRequests(weekRequests("2026-10-05"));
    expect(week.week_start).toBe("2026-10-05");
    expect(week.provisional).toBe(false);
    FIELDS.forEach((f, i) => {
      expect(week.leading[f]).toEqual([10 + i, 100 + i]);
      expect(week.all[f]).toEqual([50 + i, 1000 + i]);
    });
  });

  it("takes the order of the answers from nothing but their kinds", () => {
    const requests = weekRequests("2026-10-05");
    expect(weekFromRequests([...requests].reverse())).toEqual(weekFromRequests(requests));
  });

  it("dates the week by the earliest Taipei date of its four answers", () => {
    const [a, b, c, d] = weekRequests("2026-10-05");
    expect(weekFromRequests([{ ...a!, fetched_at: "2026-10-14T18:30:00Z" }, { ...b!, fetched_at: "2026-10-15T03:16:00+08:00" }, c!, d!]).fetched).toBe("2026-10-15");
    // 2026-10-14T23:59 Taipei is an earlier Taipei date than the rest
    expect(weekFromRequests([a!, b!, { ...c!, fetched_at: "2026-10-14T23:59:00+08:00" }, d!]).fetched).toBe("2026-10-14");
    // 2026-10-14T16:30Z is 2026-10-15 00:30 in Taipei, not 2026-10-14
    expect(weekFromRequests([{ ...a!, fetched_at: "2026-10-14T16:30:00Z" }, b!, c!, d!]).fetched).toBe("2026-10-15");
    expect(weekFromRequests([{ ...a!, fetched_at: "2026-10-14T15:30:00Z" }, b!, c!, d!]).fetched).toBe("2026-10-14");
  });

  it("refuses a fetch time with no offset, which Date.parse() would read in the machine's zone, and names the answer", () => {
    const requests = weekRequests("2026-10-05");
    for (const bad of ["2026-10-14T23:30:00", "2026-10-14", "2026-10-14T23:30", "yesterday", ""]) {
      for (const [i, kind] of requests.map((r, n) => [n, r.request] as const)) {
        const changed = requests.map((r, n) => (n === i ? { ...r, fetched_at: bad } : r));
        expect(() => weekFromRequests(changed), `${kind} ${bad}`).toThrow(exact(`The ${kind} answer for the week of 2026-10-05 has no fetch time with an offset`));
      }
    }
    expect(() => applyWeeks(FIXTURE_STATE, weekRequests("2026-10-05", SPEC, "2026-10-14T23:30:00"), { cutoff: "2026-10-11", updated: "2026-10-14", versions: VERSIONS, settings: SETTINGS }))
      .toThrow(/has no fetch time with an offset$/);
    // each offset form is read: Z, +00:00 and +08:00 give the Taipei date of the instant
    for (const [at, day] of [["2026-10-14T16:00:00Z", "2026-10-15"], ["2026-10-14T15:59:59Z", "2026-10-14"], ["2026-10-14T16:00:00+00:00", "2026-10-15"], ["2026-10-14T23:59:59+08:00", "2026-10-14"]] as const) {
      expect(weekFromRequests(weekRequests("2026-10-05", SPEC, at)).fetched, at).toBe(day);
    }
  });

  it("throws unless it has exactly one answer of each kind, all of one week", () => {
    const requests = weekRequests("2026-10-05");
    expect(() => weekFromRequests([])).toThrow(/^A week needs its four answers$/);
    for (const kind of OPENALEX_REQUESTS) {
      expect(() => weekFromRequests(requests.filter((r) => r.request !== kind))).toThrow(exact(`The week of 2026-10-05 has no ${kind} answer`));
    }
    expect(() => weekFromRequests([requests[0]!])).toThrow(exact("The week of 2026-10-05 has no leading_ai answer"));
    expect(() => weekFromRequests([...requests, requests[0]!])).toThrow(exact("The week of 2026-10-05 has two leading_total answers"));
    expect(() => weekFromRequests([...requests.slice(0, 3), { ...requests[3]!, week_start: "2026-10-12" }])).toThrow(exact("The answers are for two weeks: 2026-10-05 and 2026-10-12"));
    // the first answer names the week the others are compared with
    expect(() => weekFromRequests([{ ...requests[0]!, week_start: "2026-10-12" }, ...requests.slice(1)])).toThrow(exact("The answers are for two weeks: 2026-10-12 and 2026-10-05"));
  });

  it("throws, naming the field, when an answer counts more AI-method papers than papers", () => {
    const bad = weekRequests("2026-10-05", { ...SPEC, leadingAi: 150 });
    expect(() => weekFromRequests(bad)).toThrow(exact("OpenAlex counted more AI-method papers (150) than papers (100) in mathematics (leading journals) for the week of 2026-10-05"));
    const badAll = weekRequests("2026-10-05", { ...SPEC, allAi: 2000 });
    expect(() => weekFromRequests(badAll)).toThrow(exact("OpenAlex counted more AI-method papers (2000) than papers (1000) in mathematics (all papers) for the week of 2026-10-05"));
    expect(weekFromRequests(weekRequests("2026-10-05", { ...SPEC, leadingAi: 100 })).leading.mathematics).toEqual([100, 100]);
  });
});

describe("applyWeeks: fetched weeks join the state (SPEC §5.4)", () => {
  const options = { cutoff: "2026-10-11", updated: "2026-10-15", versions: VERSIONS, settings: SETTINGS };
  const nine = mondays("2026-08-10", "2026-10-05").flatMap((m) => weekRequests(m));

  it("replaces the 9 fetched weeks, marks the newest 8 provisional, and leaves every other week as it was", () => {
    const next = applyWeeks(FIXTURE_STATE, nine, options);
    expect(PaceWeeklyFile.safeParse(next).success).toBe(true);
    expect(next.weeks).toHaveLength(FIXTURE_STATE.weeks.length);
    expect(next.updated).toBe("2026-10-15");
    expect(next.versions).toEqual({ ai_terms: 1, journals: 1, fields: 1 });
    const fetched = new Set(mondays("2026-08-10", "2026-10-05"));
    next.weeks.forEach((w, i) => {
      const was = FIXTURE_STATE.weeks[i]!;
      expect(w.week_start).toBe(was.week_start);
      if (fetched.has(w.week_start)) {
        expect(w.fetched).toBe("2026-10-15");
        expect(w.leading.physics).toEqual([11, 101]);
        expect(w.all.humanities).toEqual([56, 1006]);
      } else {
        expect(w).toEqual(was);
      }
    });
    expect(next.weeks.filter((w) => w.provisional).map((w) => w.week_start)).toEqual(mondays("2026-08-17", "2026-10-05"));
    expect(next.weeks.find((w) => w.week_start === "2026-08-10")!.provisional).toBe(false);
  });

  it("gives the fixture state back when its own weeks are fetched again with the counts it holds", () => {
    const requests = mondays("2026-08-10", "2026-10-05").flatMap((m) => {
      const w = FIXTURE_STATE.weeks.find((x) => x.week_start === m)!;
      const pick = (set: "leading" | "all", i: 0 | 1): Record<FieldId, number> => Object.fromEntries(FIELDS.map((f) => [f, w[set][f][i]])) as Record<FieldId, number>;
      return (["leading_total", "leading_ai", "all_total", "all_ai"] as const).map((request): OpenAlexRequest => ({
        ...weekRequests(m)[0]!, request, counts: pick(request.startsWith("leading") ? "leading" : "all", request.endsWith("ai") ? 0 : 1),
        fetched_at: "2026-10-14T03:16:00+08:00",
      }));
    });
    expect(applyWeeks(FIXTURE_STATE, requests, { ...options, updated: "2026-10-14" })).toEqual(FIXTURE_STATE);
  });

  it("makes a week that leaves the provisional span firm with the fetch date it had", () => {
    // The next week: the cutoff is 2026-10-18, the span 2026-08-24 to 2026-10-12. The week of 2026-08-17 was provisional and is not
    // fetched here: it becomes firm with its last fetch, 2026-10-14.
    const next = applyWeeks(FIXTURE_STATE, weekRequests("2026-10-12", SPEC, "2026-10-20T03:16:00+08:00"), { ...options, cutoff: "2026-10-18", updated: "2026-10-20" });
    expect(next.weeks).toHaveLength(FIXTURE_STATE.weeks.length + 1);
    const find = (m: string): PaceWeek => next.weeks.find((w) => w.week_start === m)!;
    expect(find("2026-10-12")).toMatchObject({ provisional: true, fetched: "2026-10-20" });
    expect(find("2026-08-17")).toEqual({ ...FIXTURE_STATE.weeks.find((w) => w.week_start === "2026-08-17")!, provisional: false });
    expect(find("2026-08-17").fetched).toBe("2026-10-14");
    expect(find("2026-08-24")).toEqual(FIXTURE_STATE.weeks.find((w) => w.week_start === "2026-08-24"));
    expect(next.weeks.filter((w) => w.provisional)).toHaveLength(8);
  });

  it("drops the weeks of a state that run past the cutoff, and marks the provisional weeks again", () => {
    const next = applyWeeks(FIXTURE_STATE, [], { ...options, cutoff: "2026-10-04" });
    expect(next.weeks).toHaveLength(FIXTURE_STATE.weeks.length - 1);
    expect(next.weeks[next.weeks.length - 1]!.week_start).toBe("2026-09-28");
    expect(next.weeks.filter((w) => w.provisional).map((w) => w.week_start)).toEqual(mondays("2026-08-10", "2026-09-28"));
    expect(next.weeks.find((w) => w.week_start === "2026-08-03")!.provisional).toBe(false);
  });

  it("builds a state from nothing when every week is fetched (the backfill)", () => {
    const cutoff = "2016-03-06";
    const requests = mondays(FIRST_WEEK, "2016-02-29").flatMap((m) => weekRequests(m, SPEC, "2026-11-23T03:16:00+08:00"));
    const state = applyWeeks(null, requests, { ...options, cutoff, updated: "2026-11-23" });
    expect(state.weeks.map((w) => w.week_start)).toEqual(mondays(FIRST_WEEK, "2016-02-29"));
    expect(state.weeks.every((w) => w.fetched === "2026-11-23")).toBe(true);
    const span = paceRanges(cutoff, SETTINGS).provisional;
    expect(state.weeks.filter((w) => w.provisional).map((w) => w.week_start)).toEqual(mondays(span.from, addDays(cutoff, -6)));
    expect(PaceWeeklyFile.safeParse(state).success).toBe(true);
  });

  it("throws when a week is left missing, naming it", () => {
    expect(() => applyWeeks(truncated("2026-07-20"), nine, options)).toThrow(exact("The weekly state has no week starting 2026-07-27"));
    expect(() => applyWeeks(null, nine, options)).toThrow(exact("The weekly state has no week starting 2015-01-05"));
  });

  it("throws on a week that is not a Monday of the span", () => {
    for (const monday of ["2026-10-06", "2014-12-29", "2026-10-12"]) {
      expect(() => applyWeeks(FIXTURE_STATE, weekRequests(monday), options), monday).toThrow(exact(`${monday} is not a Monday from 2015-01-05 to 2026-10-05`));
    }
  });

  it("throws on a week with a missing or doubled answer, and on a count that is more than its total", () => {
    expect(() => applyWeeks(FIXTURE_STATE, weekRequests("2026-10-05").slice(1), options)).toThrow(exact("The week of 2026-10-05 has no leading_total answer"));
    expect(() => applyWeeks(FIXTURE_STATE, [...weekRequests("2026-10-05"), ...weekRequests("2026-10-05").slice(0, 1)], options)).toThrow(exact("The week of 2026-10-05 has two leading_total answers"));
    expect(() => applyWeeks(FIXTURE_STATE, weekRequests("2026-10-05", { ...SPEC, allAi: 5000 }), options))
      .toThrow(exact("OpenAlex counted more AI-method papers (5000) than papers (1000) in mathematics (all papers) for the week of 2026-10-05"));
  });

  it("does not change the state or the requests it reads", () => {
    const state = deepFreeze(structuredClone(FIXTURE_STATE));
    const requests = deepFreeze(structuredClone(nine));
    const next = applyWeeks(state, requests, options);
    expect(next.weeks.length).toBe(state.weeks.length);
    expect(state.updated).toBe("2026-10-14");
  });
});

// ── A season of mornings ─────────────────────────────────────────────────────────────────────────

/** The mornings of `from` to `to` that `skip` does not skip, each fetching what `weeksToFetch()` names and joining it to the state. */
function runMornings(skip: (date: string, i: number) => boolean, from: string, to: string): {
  state: PaceWeeklyFile; fetchedOn: Map<string, string[]>; uncovered: string[]; most: number;
} {
  let state = FIXTURE_STATE;
  const fetchedOn = new Map<string, string[]>();
  const uncovered: string[] = [];
  let most = 0;
  for (let date = from, i = 0; date <= to; date = addDays(date, 1), i += 1) {
    if (skip(date, i)) continue;
    const cutoff = dataCutoff(date);
    const plan = weeksToFetch(state, cutoff, SETTINGS);
    if (plan.uncovered.length > 0) {
      uncovered.push(date);
      continue;
    }
    most = Math.max(most, plan.weeks.length);
    const requests = plan.weeks.flatMap((m) => weekRequests(m, { ...SPEC, leadingTotal: 100 + i }, `${date}T03:16:00+08:00`));
    for (const m of plan.weeks) fetchedOn.set(m, [...(fetchedOn.get(m) ?? []), date]);
    state = applyWeeks(state, requests, { cutoff, updated: date, versions: VERSIONS, settings: SETTINGS });
    // No week keeps a count that was fetched while the week could still change: once a week's last morning has come, the state
    // holds a fetch of it made on that morning or later (§5.4), unless the cap leaves it for the next morning.
    for (const w of state.weeks) {
      const last = lastMorning(addDays(w.week_start, 6), SETTINGS);
      if (last <= date && !plan.deferred.includes(w.week_start)) expect(w.fetched >= last, `${date}: ${w.week_start} fetched ${w.fetched}, last morning ${last}`).toBe(true);
    }
  }
  return { state, fetchedOn, uncovered, most };
}

describe("weeksToFetch and applyWeeks over a season of mornings (SPEC §5.4)", () => {
  it("fetches each week on exactly the 63 mornings that it is among the newest 9, and never after its last morning", () => {
    const r = runMornings(() => false, "2026-10-15", "2026-12-31");
    expect(r.uncovered).toEqual([]);
    expect(r.most).toBe(9);
    // the week of 2026-10-12 (Sunday 2026-10-18) is the newest week from the morning of 2026-10-20 to its last morning, 2026-12-21
    const days = r.fetchedOn.get("2026-10-12")!;
    expect(days).toHaveLength(63);
    expect(days[0]).toBe("2026-10-20");
    expect(days[62]).toBe("2026-12-21");
    expect(days[62]).toBe(lastMorning("2026-10-18", SETTINGS));
    // the week that was the newest firm week on the first morning is fetched on the 5 mornings left to it, then no more
    expect(r.fetchedOn.get("2026-08-10")).toEqual(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]);
    // the state holds each of those weeks as the last morning left it, and the newest 8 weeks are provisional
    expect(r.state.weeks.find((w) => w.week_start === "2026-10-12")!.fetched).toBe("2026-12-21");
    expect(r.state.weeks.filter((w) => w.provisional)).toHaveLength(8);
    expect(r.state.weeks[r.state.weeks.length - 1]!.week_start).toBe("2026-12-21");
  }, 60_000);

  it("catches up after missed mornings and a gap of two weeks, fetching what it owes and never more than 22 weeks", () => {
    const r = runMornings((date, i) => i % 5 === 3 || (date >= "2026-11-10" && date <= "2026-11-23"), "2026-10-15", "2027-01-31");
    expect(r.uncovered).toEqual([]);
    expect(r.most).toBeLessThanOrEqual(9 + 13);
    expect(r.most).toBeGreaterThan(9);
    expect(r.state.weeks[r.state.weeks.length - 1]!.week_start).toBe("2027-01-18");
  }, 60_000);

  it("cannot make the state whole after a gap of more than 22 weeks: every morning of it reports the weeks it cannot reach", () => {
    const r = runMornings((date) => date > "2026-10-20" && date <= "2027-03-31", "2026-10-15", "2027-04-04");
    expect(r.uncovered).toEqual(["2027-04-01", "2027-04-02", "2027-04-03", "2027-04-04"]);
    expect(r.state.weeks[r.state.weeks.length - 1]!.week_start).toBe("2026-10-12");
  }, 60_000);
});

// ── computeMetrics ───────────────────────────────────────────────────────────────────────────────

/** A stored Landmark result at Checked with an AI role, first published and first briefed in March 2026. */
const lf = (id: string, over: Partial<LedgerFinding> = {}): LedgerFinding => ({
  id, field: "biology", subfield: "proteins", kind: "result", significance: "landmark", ai: { role: "ai_solved", confidence: "confirmed" },
  rung: "checked", rung_history: [{ rung: "checked", recorded: "2026-05-04" }], first_published: "2026-03-01", first_brief: "2026-03-05", history: false, ...over,
});

function baseInput(over: Partial<MetricsInput> = {}): MetricsInput {
  return {
    date: "2026-10-14", computedAt: "2026-10-14T03:17:30+08:00", settings: SETTINGS, versions: VERSIONS,
    weekly: { kind: "current", state: FIXTURE_STATE, requests: [] },
    findings: [], corrections: [],
    counters: { config: SEED.counters.counters, readToday: false, attempts: {}, previous: null },
    ...over,
  };
}

/** The quotable figures of a pace block that are the Pace's own (the paths under `pace.`). */
const paceOnly = (quotable: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(quotable).filter(([k]) => k.startsWith("pace.")));

describe("computeMetrics: status ok", () => {
  const result = computeMetrics(baseInput());

  it("is valid against MetricsFile and InputsManifest, whole in shape", () => {
    expect(MetricsFile.safeParse(result.metrics).success).toBe(true);
    expect(InputsManifest.safeParse(result.manifest).success).toBe(true);
    expect(result.metrics).toMatchObject({
      schema_version: 1, date: "2026-10-14", computed_at: "2026-10-14T03:17:30+08:00", data_cutoff: "2026-10-11", status: "ok", versions: VERSIONS,
    });
    expect(result.metrics.counters.map((c) => c.id)).toEqual(SEED.counters.counters.map((c) => c.id));
  });

  it("gives the Pace the state's own cells, sentence and ranges: the weekday fixture's, whole", () => {
    expect(result.metrics.pace.sentence).toEqual(WEEKDAY.pace.sentence);
    expect({ ...result.metrics.pace, quotable: paceOnly(result.metrics.pace.quotable) }).toEqual({ ...WEEKDAY.pace, quotable: paceOnly(WEEKDAY.pace.quotable) });
    expect(result.metrics.pace.window).toEqual({ from: "2026-05-18", to: "2026-08-16" });
    expect(result.metrics.pace.provisional_from).toBe("2026-08-17");
  });

  it("takes data_cutoff from the date: the newest Sunday on or before D - 2", () => {
    for (const [date, cutoff] of [["2026-10-13", "2026-10-11"], ["2026-10-19", "2026-10-11"], ["2026-10-20", "2026-10-18"], ["2026-10-21", "2026-10-18"]] as const) {
      const requests = cutoff === "2026-10-18" ? weekRequests("2026-10-12") : [];
      const state = applyWeeks(FIXTURE_STATE, requests, { cutoff, updated: date, versions: VERSIONS, settings: SETTINGS });
      expect(computeMetrics(baseInput({ date, weekly: { kind: "current", state, requests } })).metrics.data_cutoff, date).toBe(cutoff);
    }
  });

  it("computes the quotable shares of the state's own counts", () => {
    const window = FIXTURE_STATE.weeks.filter((w) => w.week_start >= "2026-05-18" && w.week_start <= "2026-08-10");
    expect(window).toHaveLength(13);
    const k = window.reduce((n, w) => n + FIELDS.reduce((s, f) => s + w.leading[f][0], 0), 0);
    const n = window.reduce((m, w) => m + FIELDS.reduce((s, f) => s + w.leading[f][1], 0), 0);
    expect(result.metrics.pace.quotable["pace.leading.pooled.window"]).toBe(fmtPct1(k, n));
    const kb = window.reduce((m, w) => m + w.leading.biology[0], 0);
    const nb = window.reduce((m, w) => m + w.leading.biology[1], 0);
    expect(result.metrics.pace.quotable["pace.leading.by_field.biology.window"]).toBe(fmtPct1(kb, nb));
    expect(Object.keys(result.metrics.pace.quotable)).toContain("pace.all.by_field.humanities.year_ago");
  });

  it("lists the requests of the manifest by week and kind, whatever order the script made them in", () => {
    const state = applyWeeks(FIXTURE_STATE, [], { cutoff: "2026-10-11", updated: "2026-10-14", versions: VERSIONS, settings: SETTINGS });
    const requests = mondays("2026-08-10", "2026-10-05").flatMap((m) => weekRequests(m, SPEC, "2026-10-14T03:16:00+08:00"));
    const current = applyWeeks(state, requests, { cutoff: "2026-10-11", updated: "2026-10-14", versions: VERSIONS, settings: SETTINGS });
    const shuffled = [...requests].reverse();
    const r = computeMetrics(baseInput({ weekly: { kind: "current", state: current, requests: shuffled } }));
    expect(r.manifest.openalex).toEqual(requests);
    expect(r.manifest.openalex.map((x) => `${x.week_start} ${x.request}`).slice(0, 5)).toEqual([
      "2026-08-10 leading_total", "2026-08-10 leading_ai", "2026-08-10 all_total", "2026-08-10 all_ai", "2026-08-17 leading_total",
    ]);
    expect(r.manifest.openalex).toHaveLength(36);
  });

  it("puts the requests of one week in the kinds' order from every order they arrive in", () => {
    const state = applyWeeks(FIXTURE_STATE, [], { cutoff: "2026-10-11", updated: "2026-10-14", versions: VERSIONS, settings: SETTINGS });
    const requests = mondays("2026-08-10", "2026-10-05").flatMap((m) => weekRequests(m, SPEC, "2026-10-14T03:16:00+08:00"));
    const current = applyWeeks(state, requests, { cutoff: "2026-10-11", updated: "2026-10-14", versions: VERSIONS, settings: SETTINGS });
    const arrivals = [
      requests.filter((_r, i) => i % 4 === 3).concat(requests.filter((_r, i) => i % 4 !== 3)),
      requests.filter((_r, i) => i % 4 === 1).concat(requests.filter((_r, i) => i % 4 !== 1)),
      requests.map((_r, i) => requests[(i * 7) % requests.length] as OpenAlexRequest),
      requests.map((_r, i) => requests[(i + 2) % requests.length] as OpenAlexRequest),
      requests.map((_r, i) => requests[i - (i % 4) + (([2, 0, 3, 1] as const)[i % 4] as number)] as OpenAlexRequest),
    ];
    for (const arrival of arrivals) {
      expect(new Set(arrival).size).toBe(36);
      const r = computeMetrics(baseInput({ weekly: { kind: "current", state: current, requests: arrival } }));
      expect(r.manifest.openalex).toEqual(requests);
    }
  });

  it("refuses requests that disagree with the state, or name a week it does not hold", () => {
    const requests = weekRequests("2026-10-05");
    expect(() => computeMetrics(baseInput({ weekly: { kind: "current", state: FIXTURE_STATE, requests } }))).toThrow(exact("The requests for the week of 2026-10-05 do not give the counts the state holds (mathematics, leading)"));
    const other = [{ ...requests[0]!, week_start: "2026-10-12" }, ...weekRequests("2026-10-12").slice(1)];
    expect(() => computeMetrics(baseInput({ weekly: { kind: "current", state: FIXTURE_STATE, requests: other } }))).toThrow(exact("The manifest lists a request for the week of 2026-10-12, which the state does not hold"));
    const agreeing = applyWeeks(FIXTURE_STATE, requests, { cutoff: "2026-10-11", updated: "2026-10-14", versions: VERSIONS, settings: SETTINGS });
    expect(() => computeMetrics(baseInput({ weekly: { kind: "current", state: agreeing, requests } }))).not.toThrow();
  });

  it("refuses requests that differ from the state in the AI count alone or in the total alone", () => {
    const requests = weekRequests("2026-10-05");
    const agreeing = applyWeeks(FIXTURE_STATE, requests, { cutoff: "2026-10-11", updated: "2026-10-14", versions: VERSIONS, settings: SETTINGS });
    const run = (spec: WeekSpec): unknown => computeMetrics(baseInput({ weekly: { kind: "current", state: agreeing, requests: weekRequests("2026-10-05", spec) } }));
    expect(() => run(SPEC)).not.toThrow();
    for (const [what, spec, set] of [
      ["the leading AI count", { ...SPEC, leadingAi: SPEC.leadingAi + 1 }, "leading"],
      ["the leading total", { ...SPEC, leadingTotal: SPEC.leadingTotal + 1 }, "leading"],
      ["the all-papers AI count", { ...SPEC, allAi: SPEC.allAi + 1 }, "all"],
      ["the all-papers total", { ...SPEC, allTotal: SPEC.allTotal + 1 }, "all"],
    ] as const) {
      expect(() => run(spec), what).toThrow(exact(`The requests for the week of 2026-10-05 do not give the counts the state holds (mathematics, ${set})`));
    }
  });

  it("refuses a request URL that holds a key or an e-mail address, and the error does not quote it (SPEC §5.1, §4.7)", () => {
    const requests = weekRequests("2026-10-05");
    const agreeing = applyWeeks(FIXTURE_STATE, requests, { cutoff: "2026-10-11", updated: "2026-10-14", versions: VERSIONS, settings: SETTINGS });
    const secret = "k3y-NOT-FOR-LOGS-9f2c";
    const quoted = (run: () => unknown): string => {
      try {
        run();
      } catch (e) {
        return `${(e as Error).message}\n${JSON.stringify(e)}\n${String((e as Error).stack)}`;
      }
      return expect.unreachable();
    };
    for (const param of [`api_key=${secret}`, `mailto=${secret}@example.org`, `x=1&API_KEY=${secret}`]) {
      const url = `https://api.openalex.org/works?filter=a:b&${param}`;
      // in an OpenAlex request
      const text = quoted(() => computeMetrics(baseInput({ weekly: { kind: "current", state: agreeing, requests: [{ ...requests[0]!, url }, ...requests.slice(1)] } })));
      expect(text, param).not.toContain(secret);
      // and in the request of a counter
      const reading: CounterReading = { id: "mathlib_theorems", kind: "api", value: 1, as_of: "2026-10-12", breakdown: [], source_url: SEED.counters.counters[1]!.source_url, status: "ok" };
      const counter = quoted(() => computeMetrics(baseInput({
        counters: { config: SEED.counters.counters, readToday: true, attempts: { mathlib_theorems: { outcome: "read", reading, requests: [{ url, fetched_at: "2026-10-12T03:16:00+08:00", sha256: "d".repeat(64) }] } }, previous: null },
      })));
      expect(counter, param).not.toContain(secret);
    }
    // a URL without either is listed as it is
    const clean = computeMetrics(baseInput({ weekly: { kind: "current", state: agreeing, requests } }));
    expect(JSON.stringify(clean.manifest)).not.toMatch(/api_key|mailto/i);
  });

  it("takes the manifest's header from the run: date, time, cutoff and versions", () => {
    expect(result.manifest).toMatchObject({
      schema_version: 1, date: "2026-10-14", computed_at: "2026-10-14T03:17:30+08:00", data_cutoff: "2026-10-11", versions: VERSIONS, openalex: [],
    });
  });

  it("refuses a current state that does not end on the data cutoff of D", () => {
    expect(() => computeMetrics(baseInput({ date: "2026-10-21" }))).toThrow(exact("The state of a run for 2026-10-21 ends on 2026-10-11, not on the data cutoff 2026-10-18"));
    expect(() => computeMetrics(baseInput({ date: "2026-10-13", weekly: { kind: "current", state: truncated("2026-10-05"), requests: [] } }))).not.toThrow();
    expect(() => computeMetrics(baseInput({ date: "2026-10-12" }))).toThrow(exact("The state of a run for 2026-10-12 ends on 2026-10-11, not on the data cutoff 2026-10-04"));
    expect(() => computeMetrics(baseInput({ weekly: { kind: "current", state: { ...FIXTURE_STATE, weeks: [] }, requests: [] } }))).toThrow(exact("The state of a run for 2026-10-14 ends on no week, not on the data cutoff 2026-10-11"));
  });

  it("is deterministic and changes nothing it reads", () => {
    const frozen = deepFreeze(structuredClone(baseInput({ findings: [lf("bio-2026-0001")], corrections: [] })));
    const a = computeMetrics(frozen);
    const b = computeMetrics(structuredClone(frozen));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(computeMetrics(baseInput()))).toBe(JSON.stringify(result));
  });
});

describe("computeMetrics: C, D and their quotable figures", () => {
  const findings = [
    lf("bio-2026-0001"), // a 2026 Landmark with an AI role
    lf("phys-2026-0002", { field: "physics", subfield: "plasma" }), // another
    lf("earth-2026-0003", { field: "earth", subfield: "climate", ai: { role: "none", confidence: null } }), // a Landmark with no AI role
    lf("bio-2016-0004", { first_published: "2016-05-05" }), // a baseline Landmark
    lf("bio-2026-0005", { kind: "setback" }), // a setback: out of C
    // two cases of D, first briefed at claimed more than 182 days before 2026-10-14
    lf("bio-2026-0006", {
      significance: "notable", rung_history: [{ rung: "claimed", recorded: "2026-03-05" }, { rung: "checked", recorded: "2026-06-01" }], first_brief: "2026-03-05",
    }),
    lf("bio-2026-0007", { significance: "notable", rung: "claimed", rung_history: [{ rung: "claimed", recorded: "2026-03-05" }], first_brief: "2026-03-05" }),
  ];
  const r = computeMetrics(baseInput({ findings }));

  it("computes C from the findings as filed on D - 1", () => {
    const year = (y: number) => r.metrics.landmarks.by_year.find((row) => row.year === y)!;
    expect(year(2026)).toEqual({ year: 2026, ai: 2, all: 3 });
    expect(year(2016)).toEqual({ year: 2016, ai: 1, all: 1 });
    expect(r.metrics.landmarks.baseline).toEqual({ ai: 1, all: 1 });
    expect(r.metrics.landmarks.by_year.map((row) => row.year)).toEqual(Array.from({ length: 12 }, (_, i) => 2015 + i));
  });

  it("computes D from the same findings", () => {
    expect(r.metrics.hold).toEqual({ cases: 2, held: 1, fell: 0, open: 1, too_few: true });
  });

  it("adds the counts to quotable by path, after the Pace's", () => {
    expect(r.metrics.pace.quotable["landmarks.this_year"]).toBe("2 of 3");
    expect(r.metrics.pace.quotable["landmarks.baseline"]).toBe("1 of 1");
    expect(r.metrics.pace.quotable.hold).toBe("1 of 2");
    expect(paceOnly(r.metrics.pace.quotable)).toEqual(paceOnly(computeMetrics(baseInput()).metrics.pace.quotable));
  });

  it("lists the findings C and D counted, in the manifest, in id order", () => {
    expect(r.manifest.landmark_ids).toEqual(["bio-2016-0004", "bio-2026-0001", "phys-2026-0002", "earth-2026-0003"]);
    expect(r.manifest.hold_case_ids).toEqual(["bio-2026-0006", "bio-2026-0007"]);
  });

  it("gives no quotable entry for a count of nothing", () => {
    const none = computeMetrics(baseInput()).metrics.pace.quotable;
    expect(Object.keys(none).filter((k) => !k.startsWith("pace."))).toEqual([]);
    expect(computeMetrics(baseInput()).manifest).toMatchObject({ landmark_ids: [], hold_case_ids: [] });
  });

  it("reads a correction dated D - 1 and not one dated D (§4.10)", () => {
    const base = lf("bio-2026-0008", { significance: "major" });
    const refile = (date: string) => ({ id: "C-0001", date, finding_id: base.id, type: "update" as const, path: "significance", after: { en: "landmark" } });
    const year = (m: ReturnType<typeof computeMetrics>) => m.metrics.landmarks.by_year.find((row) => row.year === 2026)!;
    expect(year(computeMetrics(baseInput({ findings: [base], corrections: [refile("2026-10-13")] })))).toEqual({ year: 2026, ai: 1, all: 1 });
    expect(year(computeMetrics(baseInput({ findings: [base], corrections: [refile("2026-10-14")] })))).toEqual({ year: 2026, ai: 0, all: 0 });
  });
});

describe("computeMetrics: the counters of the file", () => {
  const configCounters = SEED.counters.counters;
  const ok = (id: string, value: number): CounterReading => ({ id, kind: "api", value, as_of: "2026-10-12", breakdown: [], source_url: configCounters.find((c) => c.id === id)!.source_url, status: "ok" });
  const REQ: RequestRecord = { url: "https://example.org/ut-sample", fetched_at: "2026-10-12T03:16:00+08:00", sha256: "c".repeat(64) };

  it("reads each counter by §5.7's rules and carries the rest from the previous file", () => {
    const previous = { readings: [ok("mathlib_theorems", 100), ok("ai_drugs", 20)], inputs: [{ id: "mathlib_theorems", requests: [REQ], value: 100 }, { id: "ai_drugs", requests: [REQ], value: 20 }] };
    const r = computeMetrics(baseInput({ counters: { config: configCounters, readToday: false, attempts: { ai_drugs: { outcome: "failed" } }, previous } }));
    const by = (id: string) => r.metrics.counters.find((c) => c.id === id)!;
    expect(by("mathlib_theorems")).toMatchObject({ value: 100, as_of: "2026-10-12", status: "ok" });
    expect(by("ai_drugs")).toMatchObject({ value: 20, as_of: "2026-10-12", status: "stale" });
    expect(by("erdos_ai").status).toBe("missing");
    expect(by("full_bibles").status).toBe("missing");
    expect(by("ancient_texts_ai").status).toBe("missing");
    expect(r.manifest.counters.find((c) => c.id === "mathlib_theorems")).toEqual({ id: "mathlib_theorems", requests: [REQ], value: 100 });
    expect(r.log.some((l) => l.includes("ai_drugs"))).toBe(true);
    expect(MetricsFile.safeParse(r.metrics).success).toBe(true);
  });

  it("reads the ledger counter from the findings on a day the counters are read", () => {
    const f = lf("hum-2026-0001", { field: "humanities", subfield: "ancient-texts", significance: "notable" });
    const r = computeMetrics(baseInput({ date: "2026-10-12", weekly: { kind: "none" }, findings: [f], counters: { config: configCounters, readToday: true, attempts: {}, previous: null } }));
    expect(r.metrics.counters.find((c) => c.id === "ancient_texts_ai")).toMatchObject({ value: 1, as_of: "2026-10-11", status: "ok" });
  });
});

describe("computeMetrics: status stale (OpenAlex failed and the last good state is reused)", () => {
  // The state ends on 2026-10-11; the edition of 2026-11-02 would have a data cutoff of 2026-10-25.
  const input = baseInput({ date: "2026-11-02", computedAt: "2026-11-02T03:17:30+08:00", weekly: { kind: "reused", state: FIXTURE_STATE } });
  const r = computeMetrics(input);

  it("is valid and has the reused state's own data_cutoff, windows and cells", () => {
    expect(MetricsFile.safeParse(r.metrics).success).toBe(true);
    expect(r.metrics.status).toBe("stale");
    expect(r.metrics.data_cutoff).toBe("2026-10-11");
    expect(r.metrics.pace.window).toEqual(WEEKDAY.pace.window);
    expect(r.metrics.pace.year_ago).toEqual(WEEKDAY.pace.year_ago);
    expect(r.metrics.pace.provisional_from).toBe(WEEKDAY.pace.provisional_from);
    expect(r.metrics.pace.leading).toEqual(WEEKDAY.pace.leading);
    expect(r.metrics.pace.all).toEqual(WEEKDAY.pace.all);
    expect(paceOnly(r.metrics.pace.quotable)).toEqual(paceOnly(WEEKDAY.pace.quotable));
  });

  it("prints the stale line, dated by the reused state's data cutoff, before the sentence", () => {
    expect(r.metrics.pace.sentence.en).toBe(`(Data to 11 Oct; today's figures are not available.) ${WEEKDAY.pace.sentence.en}`);
    expect(r.metrics.pace.sentence.zh).toBe(`（資料截至 10 月 11 日；今日數字無法取得。）${WEEKDAY.pace.sentence.zh}`);
  });

  it("lists no OpenAlex request, and keeps the run's own date and versions", () => {
    expect(r.manifest.openalex).toEqual([]);
    expect(r.manifest).toMatchObject({ date: "2026-11-02", data_cutoff: "2026-10-11", versions: VERSIONS });
    expect(r.log).toContain("Pace: OpenAlex was not read; the last weekly state is reused, with data to 2026-10-11.");
  });

  it("is stale even when the reused state is already current", () => {
    const today = computeMetrics(baseInput({ weekly: { kind: "reused", state: FIXTURE_STATE } }));
    expect(today.metrics.status).toBe("stale");
    expect(today.metrics.data_cutoff).toBe("2026-10-11");
  });

  it("still computes C, D and the counters", () => {
    const withC = computeMetrics({ ...input, findings: [lf("bio-2026-0001")] });
    expect(withC.metrics.landmarks.by_year.find((row) => row.year === 2026)).toEqual({ year: 2026, ai: 1, all: 1 });
    expect(withC.metrics.pace.quotable["landmarks.this_year"]).toBe("1 of 1");
    expect(withC.metrics.counters).toHaveLength(7);
  });

  it("refuses a reused state that ends after the data cutoff of D", () => {
    expect(() => computeMetrics(baseInput({ date: "2026-10-12", weekly: { kind: "reused", state: FIXTURE_STATE } }))).toThrow(exact("The reused state ends on 2026-10-11, after the data cutoff 2026-10-04 of 2026-10-12"));
  });

  it("is missing instead when the reused state cannot give a Pace", () => {
    const short = computeMetrics(baseInput({ weekly: { kind: "reused", state: truncated("2016-12-26") } }));
    expect(short.metrics.status).toBe("missing");
    expect(short.metrics.pace).toEqual(missingPace("2026-10-14", SETTINGS));
    expect(short.log).toContain("Pace: the last weekly state cannot give a Pace; the file is missing.");
    const empty = computeMetrics(baseInput({ weekly: { kind: "reused", state: { ...FIXTURE_STATE, weeks: [] } } }));
    expect(empty.metrics.status).toBe("missing");
    expect(empty.log).toContain("Pace: the last weekly state cannot give a Pace; the file is missing.");
    expect(MetricsFile.safeParse(empty.metrics).success).toBe(true);
  });
});

describe("computeMetrics: status missing (no weekly state could be used)", () => {
  const r = computeMetrics(baseInput({ weekly: { kind: "none" }, findings: [lf("bio-2026-0001")] }));

  it("is valid, complete in shape, with D's own ranges and empty groups (§4.7)", () => {
    expect(MetricsFile.safeParse(r.metrics).success).toBe(true);
    expect(InputsManifest.safeParse(r.manifest).success).toBe(true);
    expect(r.metrics.status).toBe("missing");
    expect(r.metrics.data_cutoff).toBe("2026-10-11");
    expect(r.metrics.pace).toEqual(missingPace("2026-10-14", SETTINGS));
    expect(r.metrics.pace.window).toEqual({ from: "2026-05-18", to: "2026-08-16" });
    expect(r.metrics.pace.sentence).toEqual({ en: "The Pace is not available today.", zh: "今日無法取得進度。" });
    expect(r.metrics.pace.quotable).toEqual({});
    expect(r.metrics.pace.leading.pooled).toMatchObject({ vs_baseline: "too_few", vs_year_ago: "too_few", window: { k: 0, n: 0, share: 0, ci80: [0, 1] } });
    expect(Object.keys(r.metrics.pace.leading.by_field)).toEqual([...FIELDS]);
    expect(r.manifest.openalex).toEqual([]);
  });

  it("still computes C, D and the counters, as on any morning", () => {
    expect(r.metrics.landmarks.by_year.find((row) => row.year === 2026)).toEqual({ year: 2026, ai: 1, all: 1 });
    expect(r.metrics.hold.too_few).toBe(true);
    expect(r.metrics.counters).toHaveLength(7);
    expect(r.manifest.landmark_ids).toEqual(["bio-2026-0001"]);
  });

  it("takes D's own data cutoff, the newest Sunday on or before D - 2", () => {
    expect(computeMetrics(baseInput({ date: "2026-10-20", weekly: { kind: "none" } })).metrics.data_cutoff).toBe("2026-10-18");
    expect(computeMetrics(baseInput({ date: "2026-10-19", weekly: { kind: "none" } })).metrics.data_cutoff).toBe("2026-10-11");
  });

  it("says why in the log", () => {
    expect(r.log).toContain("Pace: there is no weekly state; the file is missing.");
  });
});

describe("the files of the three statuses agree in shape", () => {
  it("has the same keys, in the same order, whatever the status", () => {
    const shapes = [
      computeMetrics(baseInput()), computeMetrics(baseInput({ weekly: { kind: "reused", state: FIXTURE_STATE } })), computeMetrics(baseInput({ weekly: { kind: "none" } })),
    ].map((x) => [Object.keys(x.metrics), Object.keys(x.metrics.pace), Object.keys(x.manifest)]);
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("writes no em dash and no en dash in what it makes", () => {
    const dashes = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
    const text = JSON.stringify([computeMetrics(baseInput()), computeMetrics(baseInput({ weekly: { kind: "reused", state: FIXTURE_STATE } })), computeMetrics(baseInput({ weekly: { kind: "none" } }))]);
    for (const d of dashes) expect(text).not.toContain(d);
  });
});
