// fixtures/state/ (SPEC §10 P2 step 3, §4.7, §5.4): `pace-weekly.json`, the weekly Pace state as the weekday edition's run (Wednesday 2026-10-14,
// data cutoff Sunday 2026-10-11) leaves it, built by fixtures/src/state.ts with the production builders. Then the P3 contract case: that state,
// and the nine group-by answers a morning on 2026-10-14 fetches, served with the state's own counts through `UT_FIXTURE_FEEDS`, give runMetrics()
// the morning tests/daily.test.ts will check stage by stage: the staged state is the fixture byte for byte, and the Pace block is the one in
// `fixtures/metrics/weekday.json`. Offline: the answers come from a temporary folder.
// New for this project; Cyber's tests/fixtures-state.test.ts is the pattern (the folder holds exactly the files, each parses and equals what the
// builder makes, the folder validates alone, and the morning built on it is the one the later stage checks).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { addDays } from "@/lib/dates";
import { jsonText } from "@/lib/json";
import { weeksToFetch } from "@/lib/metrics/index";
import { dataCutoff } from "@/lib/metrics/pace";
import { InputsManifest, MetricsFile, OPENALEX_REQUESTS, PaceWeeklyFile, type OpenAlexRequestKind } from "@/lib/schema/metrics";
import { validateAll } from "@/lib/validate";
import { FIELDS } from "@/lib/vocab";
import { PACE_STATE_PATH, stateOutputs, weekdayPaceState } from "@/fixtures/src/state";
import { EDITIONS } from "@/fixtures/src/world";
import { paceQuery } from "@/scripts/lib/openalex";
import { runMetrics } from "@/scripts/metrics";
import { OpenAlexWorld, makeRoot, repoRoot } from "./helpers/openalex-world";

const ROOT = repoRoot();
const config = loadConfig(path.join(ROOT, "config"));
const read = (file: string): string => fs.readFileSync(file, "utf8");
const readJson = (file: string): unknown => JSON.parse(read(file));
const D = EDITIONS.weekday.date;
const CUTOFF = "2026-10-11";
const LAST_MONDAY = "2026-10-05";
const NEWEST_FIRM = "2026-08-10";
const FIRST_PROVISIONAL = "2026-08-17";
const pv = { ai_terms: config.aiTerms.version, journals: config.journals.version, fields: config.fields.version };

const mondays = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addDays(m, 7)) out.push(m);
  return out;
};

describe("fixtures/state/", () => {
  it("holds exactly pace-weekly.json, which parses with its schema and is what weekdayPaceState() builds, byte for byte", () => {
    expect(fs.readdirSync(path.join(ROOT, "fixtures", "state")).sort()).toEqual(["pace-weekly.json"]);
    const text = read(path.join(ROOT, PACE_STATE_PATH));
    const parsed = PaceWeeklyFile.parse(JSON.parse(text));
    expect(jsonText(parsed, PaceWeeklyFile)).toBe(text);
    expect(jsonText(weekdayPaceState(), PaceWeeklyFile)).toBe(text);
    expect(stateOutputs()).toEqual([{ path: PACE_STATE_PATH, text }]);
  });

  it("is the state the weekday's run leaves: every week from 2015-01-05 to the cutoff 2026-10-11, the newest 8 provisional, all dated as the series has run every morning", () => {
    const state = PaceWeeklyFile.parse(readJson(path.join(ROOT, PACE_STATE_PATH)));
    expect(dataCutoff(D)).toBe(CUTOFF);
    expect(state).toMatchObject({ updated: D, versions: pv });
    expect(state.weeks.map((w) => w.week_start)).toEqual(mondays("2015-01-05", LAST_MONDAY));
    expect(state.weeks.filter((w) => w.provisional).map((w) => w.week_start)).toEqual(mondays(FIRST_PROVISIONAL, LAST_MONDAY));
    for (const w of state.weeks) {
      // The provisional weeks and the newest firm week were fetched that morning; an older firm week on its last morning, 70 days after its Monday.
      const fetched = w.provisional || w.week_start === NEWEST_FIRM ? D : addDays(w.week_start, 70);
      expect(w.fetched, w.week_start).toBe(fetched);
    }
  });

  it("owes no week a refetch: the next morning fetches the nine weeks and nothing older", () => {
    const state = PaceWeeklyFile.parse(readJson(path.join(ROOT, PACE_STATE_PATH)));
    for (const date of ["2026-10-15", "2026-10-16", "2026-10-17"]) {
      const plan = weeksToFetch(state, dataCutoff(date), config.run.pace);
      expect(plan.weeks, date).toEqual(mondays(NEWEST_FIRM, LAST_MONDAY).reverse());
      expect(plan.deferred, date).toEqual([]);
      expect(plan.uncovered, date).toEqual([]);
    }
  });

  it("passes validateAll() on a folder holding only state/", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ut-state-only-"));
    try {
      fs.cpSync(path.join(ROOT, "fixtures", "state"), path.join(tmp, "state"), { recursive: true });
      const r = validateAll(tmp, { config });
      expect([...r.errors, ...r.warnings]).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── The P3 contract case ─────────────────────────────────────────────────────────────────────────

describe("the weekday morning on this state (the contract tests/daily.test.ts will check)", () => {
  const roots: string[] = [];
  let world: OpenAlexWorld;
  let root: string;

  beforeEach(() => {
    world = new OpenAlexWorld(paceQuery(config.index));
    world.use();
    root = makeRoot();
    roots.push(root);
    fs.mkdirSync(path.join(root, "content", "state"), { recursive: true });
    fs.copyFileSync(path.join(ROOT, PACE_STATE_PATH), path.join(root, "content", "state", "pace-weekly.json"));
  });
  afterEach(() => world.close());
  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  /** Serves a week's four answers with the counts the state holds for it: what OpenAlex would say if it agreed with the fixture. */
  function serveFromState(state: PaceWeeklyFile): void {
    const ids = new Map<string, number>();
    for (const [id, field] of world.query.fields) if (field !== null && !ids.has(field)) ids.set(field, id);
    const weeks = state.weeks.filter((w) => w.week_start >= NEWEST_FIRM);
    for (const week of weeks) {
      for (const kind of OPENALEX_REQUESTS satisfies readonly OpenAlexRequestKind[]) {
        const groups = FIELDS.map((f) => {
          const [ai, total] = kind.startsWith("leading") ? week.leading[f] : week.all[f];
          return { key: `https://openalex.org/fields/${ids.get(f)}`, key_display_name: f, count: kind.endsWith("_ai") ? ai : total };
        });
        const body = JSON.stringify({ meta: { count: groups.reduce((n, g) => n + g.count, 0), groups_count: groups.length }, results: [], group_by: groups });
        // The index is written once, with the last answer.
        world.serve(kind, week.week_start, `${body}\n`, week === weeks.at(-1) && kind === OPENALEX_REQUESTS.at(-1));
      }
    }
  }

  it("fetches 36 requests for 2026-08-10 to 2026-10-05 and stages the fixture state again byte for byte, with the fixture's Pace block", async () => {
    const state = PaceWeeklyFile.parse(readJson(path.join(ROOT, PACE_STATE_PATH)));
    serveFromState(state);
    const r = await runMetrics({ date: D, root, now: new Date(`${D}T03:17:30+08:00`), apiKey: null });
    expect(r).toMatchObject({ code: 0, status: "ok" });
    expect(r.lines).toContain("Pace: 9 weeks fetched or read from the cache (36 requests, 0 cached, 198 credits).");
    const staged = path.join(root, "cache", "staged", D);
    expect(read(path.join(staged, "state", "pace-weekly.json"))).toBe(read(path.join(ROOT, PACE_STATE_PATH)));
    const manifest = InputsManifest.parse(readJson(path.join(staged, "metrics", "inputs", `${D}.json`)));
    expect([...new Set(manifest.openalex.map((q) => q.week_start))]).toEqual(mondays(NEWEST_FIRM, LAST_MONDAY));
    expect(manifest.openalex).toHaveLength(36);
    const metrics = MetricsFile.parse(readJson(path.join(staged, "metrics", `${D}.json`)));
    const fixture = MetricsFile.parse(readJson(path.join(ROOT, "fixtures", "metrics", "weekday.json")));
    expect(metrics).toMatchObject({ date: D, computed_at: `${D}T03:17:30+08:00`, data_cutoff: CUTOFF, versions: fixture.versions, status: "ok" });
    // The Pace block is the fixture's but for the quotable figures that come from the stored findings (C and D), which this root does not hold.
    const { quotable: ours, ...paceOurs } = metrics.pace;
    const { quotable: theirs, ...paceTheirs } = fixture.pace;
    expect(paceOurs).toEqual(paceTheirs);
    for (const [path_, text] of Object.entries(ours)) expect(theirs[path_], path_).toBe(text);
  });
});
