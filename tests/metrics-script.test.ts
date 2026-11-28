// scripts/metrics.ts (SPEC §8.4 `metrics.ts`, §5.4 the weekly series, §5.7 the counters, §4.7 the files it stages): each sentence of §8.4 is
// read as a test here. Every answer OpenAlex gives, and every counter source, is served from a temporary fixture folder through
// `UT_FIXTURE_FEEDS` (tests/helpers/openalex-world.ts), so no request leaves the machine; the script runs in-process against a temporary
// repository root that holds the real `config/`. The morning of the tests is Thursday 2026-10-22 (data cutoff Sunday 2026-10-18): its nine
// weeks are the Mondays from 2026-08-17 (the newest firm week) to 2026-10-12.
// New for this project; Cyber's tests/metrics-script.test.ts is the pattern (a temp repo, a fixed clock, runMetrics in-process).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setHttpClock } from "@/lib/feeds/http";
import { loadConfig } from "@/lib/config";
import { addDays } from "@/lib/dates";
import { jsonText, sha256Hex } from "@/lib/json";
import { paceRanges } from "@/lib/metrics/pace";
import { InputsManifest, MetricsFile, PaceWeeklyFile, OPENALEX_REQUESTS } from "@/lib/schema/metrics";
import { FIELDS } from "@/lib/vocab";
import { BUDGET_RESET, paceQuery } from "@/scripts/lib/openalex";
import { USAGE, firstDifference, main, runMetrics, type RunMetricsOptions } from "@/scripts/metrics";
import { OpenAlexWorld, filesHolding, makeRoot, repoRoot, serveCounterSources, sh } from "./helpers/openalex-world";

const config = loadConfig(path.join(repoRoot(), "config"));
const settings = config.run.pace;
const D = "2026-10-22";
const CUTOFF = "2026-10-18";
const NOW = new Date(`${D}T03:20:00+08:00`);
const FIRST_FETCHED = "2026-08-17";
const LAST_MONDAY = "2026-10-12";
const read = (file: string): string => fs.readFileSync(file, "utf8");
const readJson = (file: string): unknown => JSON.parse(read(file));
const pv = { ai_terms: config.aiTerms.version, journals: config.journals.version, fields: config.fields.version };

const roots: string[] = [];
let world: OpenAlexWorld;
let root: string;

beforeEach(() => {
  world = new OpenAlexWorld(paceQuery(config.index));
  world.use();
  root = makeRoot();
  roots.push(root);
});
afterEach(() => world.close());
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/**
 * Writes the world's weekly state into `content/state/`: by default as the previous morning (Wednesday 2026-10-21, data to the same Sunday) left it.
 * A state that ends on 2026-10-11 was left by the run of Monday 2026-10-19, the last morning that had it as its cutoff.
 */
function seedState(over: { cutoff?: string; updated?: string } = {}): PaceWeeklyFile {
  const state = world.state(over.cutoff ?? CUTOFF, over.updated ?? "2026-10-21", pv);
  fs.mkdirSync(path.join(root, "content", "state"), { recursive: true });
  fs.writeFileSync(path.join(root, "content", "state", "pace-weekly.json"), jsonText(state, PaceWeeklyFile));
  return state;
}

/** One morning's run on the day, with no key. */
const morning = (over: Partial<RunMetricsOptions> = {}) => runMetrics({ date: D, root, now: NOW, apiKey: null, ...over });
const staged = (date = D) => path.join(root, "cache", "staged", date);

/** The OpenAlex answers on disk, as `<Monday>/<file>`. */
function cachedAnswers(): string[] {
  const dir = path.join(root, "cache", "openalex");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((week) => fs.readdirSync(path.join(dir, week)).sort().map((f) => `${week}/${f}`));
}


/** Copies the sample's one ancient-texts finding into `content/findings/` as a notable one: the ledger counter counts it, C does not. */
function addAncientTextsFinding(into: string): void {
  const source = path.join(repoRoot(), "fixtures", "site-content", "findings", "hum-2026-0148.json");
  const finding = { ...(readJson(source) as Record<string, unknown>), significance: "notable" };
  fs.mkdirSync(path.join(into, "content", "findings"), { recursive: true });
  fs.writeFileSync(path.join(into, "content", "findings", "hum-2026-0148.json"), `${JSON.stringify(finding, null, 2)}\n`);
}

/** The staged files of a date copied into `content/`, as a run's publish leaves them. */
function adopt(date = D): void {
  fs.cpSync(staged(date), path.join(root, "content"), { recursive: true });
}

const mondays = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addDays(m, 7)) out.push(m);
  return out;
};

describe("a normal morning (SPEC §8.4, §5.4)", () => {
  it("fetches the 8 provisional weeks and the newest firm week, 36 requests, and stages three files in cache/staged/D/", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const r = await morning();
    expect(r).toMatchObject({ code: 0, status: "ok", errorCode: null });
    expect(r.wrote).toEqual([`metrics/${D}.json`, `metrics/inputs/${D}.json`, "state/pace-weekly.json"]);
    expect(r.lines.at(-1)).toBe("Wrote 3 files to cache/staged/2026-10-22.");
    expect(r.firstLine).toBe(`Metrics ${D}: Pace ok, data to ${CUTOFF}.`);
    expect(r.lines).toContain("Pace: 9 weeks fetched or read from the cache (36 requests, 0 cached, 198 credits).");
    expect(fs.readdirSync(staged()).sort()).toEqual(["metrics", "state"]);
    expect(fs.readdirSync(path.join(staged(), "metrics")).sort()).toEqual([`${D}.json`, "inputs"]);
    const weeks = mondays(FIRST_FETCHED, LAST_MONDAY);
    expect(weeks).toHaveLength(9);
    expect(cachedAnswers()).toHaveLength(36);
    expect(new Set(cachedAnswers().map((f) => f.split("/")[0]))).toEqual(new Set(weeks));
  });

  it("lists the 36 requests in the manifest by week and then in OPENALEX_REQUESTS order, with the counts, the excluded and the unmapped works", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    const manifest = InputsManifest.parse(readJson(path.join(staged(), "metrics", "inputs", `${D}.json`)));
    expect(manifest.openalex).toHaveLength(36);
    expect(manifest.openalex.map((q) => [q.week_start, q.request])).toEqual(
      mondays(FIRST_FETCHED, LAST_MONDAY).flatMap((w) => OPENALEX_REQUESTS.map((k) => [w, k])),
    );
    for (const q of manifest.openalex) {
      expect(q.url).toBe(world.url(q.request, q.week_start));
      expect(q.sha256).toBe(sha256Hex(world.body(q.request, q.week_start)));
      expect(q.fetched_at).toBe("2026-10-22T03:20:00+08:00");
      expect(q.excluded_n).toBe(7);
      expect(q.unmapped_n).toBe(3);
      expect(q.ungrouped_n, "the works with no primary topic: the world's answers count 2").toBe(2);
      for (const f of FIELDS) {
        const c = world.counts(q.week_start, f);
        const want = q.request === "leading_total" ? c.leading[1] : q.request === "leading_ai" ? c.leading[0] : q.request === "all_total" ? c.all[1] : c.all[0];
        expect(q.counts[f], `${q.week_start} ${q.request} ${f}`).toBe(want);
      }
    }
    expect(manifest).toMatchObject({ date: D, data_cutoff: CUTOFF, computed_at: "2026-10-22T03:20:00+08:00", versions: config.versions });
  });

  it("stages the state: every week to the cutoff, the nine fetched ones dated today, the older ones untouched, the newest 8 provisional", async () => {
    const before = seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    const after = PaceWeeklyFile.parse(readJson(path.join(staged(), "state", "pace-weekly.json")));
    expect(after.updated).toBe(D);
    expect(after.versions).toEqual(pv);
    expect(after.weeks.map((w) => w.week_start)).toEqual(mondays("2015-01-05", LAST_MONDAY));
    const provisionalFrom = paceRanges(CUTOFF, settings).provisional.from;
    const old = new Map(before.weeks.map((w) => [w.week_start, w]));
    for (const w of after.weeks) {
      expect(w.provisional, w.week_start).toBe(w.week_start >= provisionalFrom);
      if (w.week_start >= FIRST_FETCHED) {
        expect(w.fetched, w.week_start).toBe(D);
        expect({ leading: w.leading, all: w.all }, w.week_start).toEqual(world.pairs(w.week_start));
      } else if (w.week_start < "2026-10-12") {
        expect(w, w.week_start).toEqual({ ...old.get(w.week_start)!, provisional: false });
      }
    }
    expect(provisionalFrom).toBe("2026-08-24");
    expect(after.weeks.filter((w) => w.provisional)).toHaveLength(8);
    expect(after.weeks.at(-1)!.week_start).toBe(LAST_MONDAY);
  });

  it("gives A from the state it staged: the window's pooled counts are the world's, added up outside the code under test", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    const metrics = MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`)));
    const ranges = paceRanges(CUTOFF, settings);
    expect(metrics.pace.window).toEqual(ranges.window);
    expect(metrics.pace.provisional_from).toBe("2026-08-24");
    expect(metrics.pace.year_ago).toEqual(ranges.yearAgo);
    let k = 0;
    let n = 0;
    for (const monday of mondays(ranges.window.from, ranges.window.to)) {
      for (const f of FIELDS) {
        k += world.counts(monday, f).leading[0];
        n += world.counts(monday, f).leading[1];
      }
    }
    expect(metrics.pace.leading.pooled.window).toMatchObject({ k, n });
    expect(metrics.data_cutoff).toBe(CUTOFF);
    expect(metrics.pace.sentence.en).toMatch(/^The Pace: \d+\.\d% of papers in leading journals named AI methods in the 13 weeks to /);
  });

  it("is deterministic: a second run with the same clock gives the same files byte for byte, reading every answer from the cache", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    const first = new Map(["metrics/2026-10-22.json", "metrics/inputs/2026-10-22.json", "state/pace-weekly.json"].map((f) => [f, read(path.join(staged(), f))]));
    const files = cachedAnswers();
    world.refuseAll(500);
    const r = await morning({ out: "second" });
    expect(r.code).toBe(0);
    expect(r.lines).toContain("Pace: 9 weeks fetched or read from the cache (0 requests, 36 cached, 0 credits).");
    for (const [f, text] of first) expect(read(path.join(root, "second", f)), f).toBe(text);
    expect(cachedAnswers()).toEqual(files);
  });

  it("empties the staged folder first, and deletes nothing in a folder given with --out", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    fs.mkdirSync(staged(), { recursive: true });
    fs.writeFileSync(path.join(staged(), "left-over.txt"), "x");
    await morning();
    expect(fs.existsSync(path.join(staged(), "left-over.txt"))).toBe(false);
    fs.mkdirSync(path.join(root, "elsewhere"), { recursive: true });
    fs.writeFileSync(path.join(root, "elsewhere", "kept.txt"), "x");
    const r = await morning({ out: "elsewhere" });
    expect(r.lines.at(-1)).toBe("Wrote 3 files to elsewhere.");
    expect(fs.readFileSync(path.join(root, "elsewhere", "kept.txt"), "utf8")).toBe("x");
    expect(fs.existsSync(path.join(root, "elsewhere", "metrics", `${D}.json`))).toBe(true);
  });

  it("prints `metrics/D.json exists` and stages nothing when content/ already holds D's file", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    adopt();
    fs.rmSync(staged(), { recursive: true });
    const r = await morning();
    expect(r).toMatchObject({ code: 0, lines: [`metrics/${D}.json exists`], wrote: [], status: null });
    expect(fs.existsSync(staged())).toBe(false);
  });

  it("is a failure for a date that is not a date, naming it", async () => {
    expect(await morning({ date: "2026-02-30" })).toMatchObject({ code: 1, lines: ["Invalid date: 2026-02-30"], wrote: [] });
  });

  it("reads each stored finding and correction for C and D (the sample content's findings are counted)", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    fs.cpSync(path.join(repoRoot(), "fixtures", "site-content", "findings"), path.join(root, "content", "findings"), { recursive: true });
    fs.copyFileSync(path.join(repoRoot(), "fixtures", "site-content", "corrections.json"), path.join(root, "content", "corrections.json"));
    const r = await morning();
    expect(r.code).toBe(0);
    const metrics = MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`)));
    const manifest = InputsManifest.parse(readJson(path.join(staged(), "metrics", "inputs", `${D}.json`)));
    expect(manifest.landmark_ids.length).toBeGreaterThan(0);
    expect(metrics.landmarks.by_year.reduce((n, y) => n + y.all, 0)).toBe(manifest.landmark_ids.length);
  });
});

describe("the stored findings are read as they are on disk each run", () => {
  it("does not take a copy cached by an earlier run in the same process: findings added between two runs are counted by the second", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning({ out: "first", counters: true });
    const none = MetricsFile.parse(readJson(path.join(root, "first", "metrics", `${D}.json`)));
    expect(none.counters.find((c) => c.id === "ancient_texts_ai")).toMatchObject({ value: 0, as_of: "2026-10-21", status: "ok" });
    addAncientTextsFinding(root);
    await morning({ out: "second", counters: true });
    const one = MetricsFile.parse(readJson(path.join(root, "second", "metrics", `${D}.json`)));
    expect(one.counters.find((c) => c.id === "ancient_texts_ai")).toMatchObject({ value: 1, as_of: "2026-10-21", status: "ok" });
  });
});

describe("the OpenAlex key (SPEC §5.1: added on the wire only, never recorded)", () => {
  const KEY = "ut-test-key-7Hq2/+x9=";

  it("is sent with every request, and is in no output, cache file, log line or recorded URL", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    world.requireKey(KEY);
    const keyless = await morning();
    expect(keyless.status, "a keyless run is not served once the key is required").toBe("stale");
    const r = await morning({ apiKey: KEY });
    expect(r).toMatchObject({ code: 0, status: "ok" });
    expect(r.lines).toContain("Pace: 9 weeks fetched or read from the cache (36 requests, 0 cached, 198 credits).");
    for (const text of [KEY, encodeURIComponent(KEY), "api_key"]) {
      expect(r.lines.join("\n")).not.toContain(text);
      expect(filesHolding(root, text), text).toEqual([]);
    }
    expect(InputsManifest.parse(readJson(path.join(staged(), "metrics", "inputs", `${D}.json`))).openalex.map((q) => q.url)).toEqual(
      mondays(FIRST_FETCHED, LAST_MONDAY).flatMap((w) => OPENALEX_REQUESTS.map((k) => world.url(k, w))),
    );
  });

  it.each([
    ["a refused request", "HTTP 429", () => world.refuse("all_ai", LAST_MONDAY, 429)],
    ["an answer that is no answer", "no usable group_by list", () => world.serve("leading_total", LAST_MONDAY, "{\"nothing\": true}")],
  ])("is in no line or file either when the run fails: %s", async (_name, said, spoil) => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    spoil();
    world.requireKey(KEY);
    const r = await morning({ apiKey: KEY });
    expect(r.status).toBe("stale");
    expect(r.lines.some((l) => l.includes(said)), r.lines.join("\n")).toBe(true);
    for (const text of [KEY, encodeURIComponent(KEY), "api_key"]) {
      expect(r.lines.join("\n")).not.toContain(text);
      expect(filesHolding(root, text), text).toEqual([]);
    }
  });
});

describe("OpenAlex fails (SPEC §8.4: stale, then missing)", () => {
  it("is stale when a request is refused for the budget: the last good state reused, its cutoff the file's, no state staged, the reset said", async () => {
    seedState({ cutoff: "2026-10-11", updated: "2026-10-19" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    world.refuse("all_ai", "2026-09-28", 402);
    const r = await morning();
    expect(r).toMatchObject({ code: 0, status: "stale" });
    expect(r.wrote).toEqual([`metrics/${D}.json`, `metrics/inputs/${D}.json`]);
    expect(r.lines.some((l) => l.startsWith("Pace: OpenAlex was not read (OpenAlex refused the request (HTTP 402)") && l.includes(BUDGET_RESET))).toBe(true);
    const metrics = MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`)));
    expect(metrics.status).toBe("stale");
    expect(metrics.data_cutoff).toBe("2026-10-11");
    expect(metrics.pace.window).toEqual(paceRanges("2026-10-11", settings).window);
    expect(metrics.pace.sentence.en).toMatch(/^\(Data to 11 Oct; today's figures are not available\.\) /);
    expect(fs.existsSync(path.join(staged(), "state"))).toBe(false);
    expect(InputsManifest.parse(readJson(path.join(staged(), "metrics", "inputs", `${D}.json`))).openalex).toEqual([]);
    // The answers fetched before the refusal stay in the cache, for the next run.
    expect(cachedAnswers().length).toBeGreaterThan(0);
    expect(cachedAnswers().length).toBeLessThan(36);
    expect(PaceWeeklyFile.parse(readJson(path.join(root, "content", "state", "pace-weekly.json"))).updated).toBe("2026-10-19");
  });

  it("treats a 429, a missing answer and an answer that is no group-by the same way", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    world.refuse("leading_ai", "2026-08-17", 429);
    expect(await morning()).toMatchObject({ code: 0, status: "stale" });
    world.serveWeek("2026-08-17");
    world.drop("all_total", "2026-08-17");
    const gone = await morning();
    expect(gone.status).toBe("stale");
    expect(gone.lines.some((l) => l.startsWith("Pace: OpenAlex was not read (OpenAlex gave no usable answer to all_total for the week of 2026-08-17"))).toBe(true);
    world.serve("all_total", "2026-08-17", "{\"nothing\": true}");
    const junk = await morning();
    expect(junk.status).toBe("stale");
    expect(junk.lines.some((l) => l.includes("no usable group_by list"))).toBe(true);
  });

  it("is stale when the AI-method count of a field is above its total: the answers disagree", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const body = JSON.parse(world.body("leading_total", "2026-09-07")) as { group_by: { count: number }[] };
    body.group_by[0]!.count += 5000;
    world.serve("leading_ai", "2026-09-07", JSON.stringify(body));
    const r = await morning();
    expect(r.status).toBe("stale");
    expect(r.lines.some((l) => l.includes("is above its total"))).toBe(true);
  });

  it("is stale when the run's deadline has passed, and writes nothing then", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const early = await morning({ deadline: Date.now() - 1000 });
    expect(early).toMatchObject({ code: 1, lines: [`Metrics ${D}: the deadline passed before anything was written.`], wrote: [] });
    expect(fs.existsSync(staged())).toBe(false);
  });

  it("starts no week when the deadline is this very millisecond: nothing is asked of OpenAlex and nothing is written", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      const r = await morning({ deadline: Date.now() });
      expect(r).toMatchObject({ code: 1, wrote: [] });
      expect(cachedAnswers()).toEqual([]);
      expect(fs.existsSync(staged())).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is missing, complete in shape, when there is no state to reuse: D's ranges and the file written", async () => {
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const r = await morning();
    expect(r).toMatchObject({ code: 0, status: "missing" });
    expect(r.wrote).toEqual([`metrics/${D}.json`, `metrics/inputs/${D}.json`]);
    const older = mondays("2015-01-05", "2026-08-10");
    expect(older).toHaveLength(606);
    expect(r.lines).toContain(`Pace: the weekly state lacks ${older.length - 13} weeks (2015-01-05 to ${older[older.length - 14]}) that a morning cannot fetch, 13 older weeks at most: run npm run backfill -- --pace, with --push after go-live (SPEC §5.4).`);
    const metrics = MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`)));
    expect(metrics.status).toBe("missing");
    expect(metrics.data_cutoff).toBe(CUTOFF);
    expect(metrics.pace.window).toEqual(paceRanges(CUTOFF, settings).window);
    expect(metrics.pace.leading.pooled.window.n).toBe(0);
    expect(r.lines).toContain("Pace: there is no weekly state; the file is missing.");
    // Nothing was fetched: the state could not be made whole today.
    expect(cachedAnswers()).toEqual([]);
  });

  it("is missing when the stored state cannot give a Pace (too few weeks around its cutoff)", async () => {
    // A state must hold every week from 2015-01-05, so the shortest is one that stops before the baseline ends.
    const early = world.state("2018-06-24", "2018-06-27", pv);
    fs.mkdirSync(path.join(root, "content", "state"), { recursive: true });
    fs.writeFileSync(path.join(root, "content", "state", "pace-weekly.json"), jsonText(early, PaceWeeklyFile));
    const r = await morning();
    expect(r.status).toBe("missing");
    expect(r.lines).toContain("Pace: the last weekly state cannot give a Pace; the file is missing.");
    expect(r.lines.some((l) => l.startsWith("Pace: the weekly state lacks "))).toBe(true);
  });

  it("is stale, spending no request, when the state has a gap a morning cannot close (more than 13 older weeks)", async () => {
    seedState({ cutoff: "2026-04-26", updated: "2026-04-29" });
    world.serveWeeks("2026-03-02", LAST_MONDAY);
    const r = await morning();
    expect(r.status).toBe("stale");
    // 16 weeks (2026-04-27 to 2026-08-10) are older than the newest firm week and missing: 13 is the most a morning fetches.
    expect(r.lines.find((l) => l.startsWith("Pace: the weekly state lacks"))).toBe(
      "Pace: the weekly state lacks 3 weeks (2026-04-27 to 2026-05-11) that a morning cannot fetch, 13 older weeks at most: run npm run backfill -- --pace, with --push after go-live (SPEC §5.4).",
    );
    expect(cachedAnswers()).toEqual([]);
    expect(MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`))).data_cutoff).toBe("2026-04-26");
  });

  it("is stale for a single week it cannot fetch too, and says `1 week`: 14 missing weeks are 13 a morning and one over", async () => {
    seedState({ cutoff: "2026-05-10", updated: "2026-05-13" });
    world.serveWeeks("2026-03-02", LAST_MONDAY);
    const r = await morning();
    expect(r.status).toBe("stale");
    expect(r.lines.find((l) => l.startsWith("Pace: the weekly state lacks"))).toBe(
      "Pace: the weekly state lacks 1 week (2026-05-11) that a morning cannot fetch, 13 older weeks at most: run npm run backfill -- --pace, with --push after go-live (SPEC §5.4).",
    );
    expect(cachedAnswers()).toEqual([]);
  });

  it("gives the run's deadline to the client too: a request that would start past it is not sent, whatever the loop saw", async () => {
    seedState();
    delete process.env.UT_FIXTURE_FEEDS;
    // The loop reads the real clock and sees time left; the HTTP harness's clock is a minute ahead, so only the client's own deadline stops a request.
    setHttpClock({ now: () => Date.now() + 60_000, sleep: async () => {} });
    try {
      const r = await morning({ deadline: Date.now() + 30_000 });
      expect(r.status).toBe("stale");
      expect(r.lines.some((l) => l.startsWith("Pace: OpenAlex was not read (OpenAlex gave no usable answer to") && l.endsWith("(timeout))")), r.lines.join("\n")).toBe(true);
    } finally {
      setHttpClock(null);
    }
  });
});

describe("the version check (SPEC §5.4: E_METRICS)", () => {
  const stateWith = (versions: { ai_terms: number; journals: number; fields: number }): void => {
    const state = world.state(CUTOFF, "2026-10-21", versions);
    fs.mkdirSync(path.join(root, "content", "state"), { recursive: true });
    fs.writeFileSync(path.join(root, "content", "state", "pace-weekly.json"), jsonText(state, PaceWeeklyFile));
  };

  it("refuses a state built with other versions with the exact text, stages none, and fetches nothing", async () => {
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    stateWith({ ...pv, ai_terms: pv.ai_terms + 1 });
    const r = await morning();
    expect(r).toMatchObject({
      code: 1, errorCode: "E_METRICS", wrote: [], status: null,
      lines: [`pace-weekly.json was built with ai-terms v${pv.ai_terms + 1}; config has v${pv.ai_terms}: run npm run backfill -- --pace --refresh, with --push after go-live (SPEC §5.4).`],
    });
    expect(r.firstLine).toBe(r.lines[0]);
    expect(fs.existsSync(staged())).toBe(false);
    expect(cachedAnswers()).toEqual([]);
  });

  it("names the first of the three that differs: ai-terms, then journals, then fields", async () => {
    stateWith({ ai_terms: pv.ai_terms, journals: pv.journals + 3, fields: pv.fields + 1 });
    expect((await morning()).lines[0]).toBe(`pace-weekly.json was built with journals v${pv.journals + 3}; config has v${pv.journals}: run npm run backfill -- --pace --refresh, with --push after go-live (SPEC §5.4).`);
    stateWith({ ai_terms: pv.ai_terms, journals: pv.journals, fields: pv.fields + 1 });
    expect((await morning()).lines[0]).toBe(`pace-weekly.json was built with fields v${pv.fields + 1}; config has v${pv.fields}: run npm run backfill -- --pace --refresh, with --push after go-live (SPEC §5.4).`);
  });

  it("removes a folder an earlier try staged for the date, so publish never finds it, but never touches a folder given with --out", async () => {
    stateWith({ ...pv, fields: pv.fields + 1 });
    fs.mkdirSync(path.join(staged(), "metrics"), { recursive: true });
    fs.writeFileSync(path.join(staged(), "metrics", `${D}.json`), "{}");
    fs.mkdirSync(path.join(root, "out"), { recursive: true });
    fs.writeFileSync(path.join(root, "out", "kept.txt"), "x");
    expect((await morning({ out: "out" })).errorCode).toBe("E_METRICS");
    expect(fs.existsSync(path.join(staged(), "metrics", `${D}.json`))).toBe(true);
    expect((await morning()).errorCode).toBe("E_METRICS");
    expect(fs.existsSync(staged())).toBe(false);
    expect(fs.existsSync(path.join(root, "out", "kept.txt"))).toBe(true);
  });

  it("does not take a counters version change for a mismatch: the state does not depend on the counters", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const r = await morning();
    expect(r.errorCode).toBeNull();
    expect(MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`))).versions.counters).toBe(config.counters.version);
  });

  it("is a failure, not an absent state, when the state file does not parse", async () => {
    fs.mkdirSync(path.join(root, "content", "state"), { recursive: true });
    fs.writeFileSync(path.join(root, "content", "state", "pace-weekly.json"), "{\"schema_version\": 1}\n");
    const r = await morning();
    expect(r.code).toBe(1);
    expect(r.lines[0]).toMatch(/^state\/pace-weekly\.json does not parse: /);
    expect(r.errorCode).toBeNull();
  });
});

describe("the counters (SPEC §5.7, §8.4)", () => {
  /** A Monday, whose run reads the counters; its cutoff is the same Sunday as the Thursday's. */
  const MONDAY = "2026-10-26";
  const monday = (over: Partial<RunMetricsOptions> = {}) => runMetrics({ date: MONDAY, root, now: new Date(`${MONDAY}T03:20:00+08:00`), apiKey: null, ...over });

  it("reads the four API counters on a Monday, dated the day they were read, with the requests and the bodies' hashes in the manifest", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const w = serveCounterSources(world, config, MONDAY);
    const r = await monday();
    expect(r.code).toBe(0);
    const metrics = MetricsFile.parse(readJson(path.join(staged(MONDAY), "metrics", `${MONDAY}.json`)));
    const by = new Map(metrics.counters.map((c) => [c.id, c]));
    expect(by.get("mathlib_theorems")).toMatchObject({ value: w.mathlib, as_of: MONDAY, status: "ok", breakdown: [] });
    const drugs = config.aiDrugs.drugs.filter((d) => d.approved !== null || d.trials.length > 0).length;
    const approved = config.aiDrugs.drugs.filter((d) => d.approved !== null).length;
    expect(by.get("ai_drugs")).toMatchObject({ value: drugs, as_of: MONDAY, status: "ok" });
    expect(by.get("ai_drugs")!.breakdown).toEqual([
      { key: "1", value: 0 }, { key: "2", value: drugs - approved }, { key: "3", value: 0 }, { key: "approved", value: approved },
    ]);
    expect(by.get("pdb_structures")).toMatchObject({ value: 4_632 + 3, as_of: MONDAY, status: "ok" });
    expect(by.get("pdb_structures")!.breakdown).toEqual([{ key: "2025", value: 17_052 + 1 }, { key: "2026", value: 4_635 }]);
    expect(by.get("ai_retractions")).toMatchObject({ value: 2, as_of: MONDAY, status: "ok" });
    expect(by.get("ai_retractions")!.breakdown).toEqual([{ key: "2025", value: 1 }, { key: "2026", value: 2 }]);
    expect(by.get("erdos_ai")).toMatchObject({ kind: "manual", value: 69, as_of: "2026-06-30" });
    expect(by.get("full_bibles")).toMatchObject({ kind: "manual", value: 20, as_of: "2025-08-01" });
    expect(by.get("ancient_texts_ai")).toMatchObject({ kind: "ledger", value: 0, as_of: "2026-10-25" });

    const manifest = InputsManifest.parse(readJson(path.join(staged(MONDAY), "metrics", "inputs", `${MONDAY}.json`)));
    const row = new Map(manifest.counters.map((c) => [c.id, c]));
    expect(row.get("mathlib_theorems")!.requests).toEqual([
      { url: config.sources.feeds.find((f) => f.id === "mathlib-stats")!.url, fetched_at: "2026-10-26T03:20:00+08:00", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    expect(row.get("pdb_structures")!.requests).toHaveLength(3);
    expect(row.get("pdb_structures")!.requests[2]!.url).toBe(config.sources.feeds.find((f) => f.id === "rcsb-unreleased")!.url);
    expect(row.get("pdb_structures")!.value).toBe(4_635);
    expect(row.get("erdos_ai")!.requests).toEqual([]);
    expect(manifest.counters.map((c) => c.id)).toEqual(config.counters.counters.map((c) => c.id));
    // Each body is kept in cache/feeds/ for --recompute.
    expect(fs.readdirSync(path.join(root, "cache", "feeds")).sort()).toEqual(
      ["ctgov.p0.json", "mathlib-stats.html", "rcsb-unreleased.json.gz", "rcsb.p0.json", "rcsb.p1.json", "retraction-watch.csv"],
    );
  });

  it("does not read the counters on another day, and carries each last reading with its own date, status and requests", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, MONDAY);
    await monday();
    adopt(MONDAY);
    const before = MetricsFile.parse(readJson(path.join(root, "content", "metrics", `${MONDAY}.json`)));
    const beforeRows = InputsManifest.parse(readJson(path.join(root, "content", "metrics", "inputs", `${MONDAY}.json`))).counters;
    // The counters' sources answer nothing on Tuesday: a read would show.
    world.close();
    world = new OpenAlexWorld(paceQuery(config.index));
    world.use();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const tuesday = "2026-10-27";
    const r = await runMetrics({ date: tuesday, root, now: new Date(`${tuesday}T03:20:00+08:00`), apiKey: null });
    expect(r.code).toBe(0);
    const after = MetricsFile.parse(readJson(path.join(staged(tuesday), "metrics", `${tuesday}.json`)));
    const rows = InputsManifest.parse(readJson(path.join(staged(tuesday), "metrics", "inputs", `${tuesday}.json`))).counters;
    for (const id of ["mathlib_theorems", "ai_drugs", "pdb_structures", "ai_retractions"]) {
      expect(after.counters.find((c) => c.id === id), id).toEqual(before.counters.find((c) => c.id === id));
      expect(rows.find((c) => c.id === id), id).toEqual(beforeRows.find((c) => c.id === id));
    }
    expect(after.counters.find((c) => c.id === "ancient_texts_ai")).toEqual(before.counters.find((c) => c.id === "ancient_texts_ai"));
    expect(r.lines.some((l) => l.startsWith("Counter "))).toBe(false);
  });

  it("carries from the newest earlier metrics file, not an older one or a later one, and passes a stray file by", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, MONDAY);
    await monday();
    adopt(MONDAY);
    const dir = path.join(root, "content", "metrics");
    // A file's name is the date the run reads it by; its own `date` stays the Monday's, so that it is a metrics file the schema accepts.
    const asIf = (name: string, mathlib: number): void => {
      const file = MetricsFile.parse(readJson(path.join(dir, `${MONDAY}.json`)));
      const counters = file.counters.map((c) => (c.id === "mathlib_theorems" ? { ...c, value: mathlib } : c));
      fs.writeFileSync(path.join(dir, `${name}.json`), jsonText(MetricsFile.parse({ ...file, counters }), MetricsFile));
    };
    asIf("2026-10-20", 111);
    asIf("2026-10-29", 777);
    fs.writeFileSync(path.join(dir, "bak2026-10-27.json"), "not a metrics file");
    const wednesday = "2026-10-28";
    const r = await runMetrics({ date: wednesday, root, now: new Date(`${wednesday}T03:20:00+08:00`), apiKey: null });
    expect(r.code, r.lines.join("\n")).toBe(0);
    const after = MetricsFile.parse(readJson(path.join(staged(wednesday), "metrics", `${wednesday}.json`)));
    expect(after.counters.find((c) => c.id === "mathlib_theorems")?.value).toBe(297_154);
  });

  it("dates what it reads and writes by the day it runs, not the edition's: the counters, the state's `updated`, and the answers it may reuse", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const later = new Date("2026-10-23T03:20:00+08:00");
    serveCounterSources(world, config, "2026-10-23");
    const first = await morning();
    expect(first.lines).toContain("Pace: 9 weeks fetched or read from the cache (36 requests, 0 cached, 198 credits).");
    const r = await morning({ now: later, counters: true });
    expect(r.code, r.lines.join("\n")).toBe(0);
    // The nine weeks' answers were fetched on the edition's day, before the run's day: they are fetched again.
    expect(r.lines).toContain("Pace: 9 weeks fetched or read from the cache (36 requests, 0 cached, 198 credits).");
    expect(PaceWeeklyFile.parse(readJson(path.join(staged(), "state", "pace-weekly.json"))).updated).toBe("2026-10-23");
    const file = MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`)));
    expect(file.computed_at).toBe("2026-10-23T03:20:00+08:00");
    expect(file.counters.filter((c) => c.kind === "api").map((c) => [c.id, c.as_of, c.status])).toEqual(
      ["mathlib_theorems", "ai_drugs", "pdb_structures", "ai_retractions"].map((id) => [id, "2026-10-23", "ok"]),
    );
  });

  it("reads the content folder `UT_CONTENT_DIR` names, for the file that already exists as for the rest", async () => {
    seedState();
    fs.mkdirSync(path.join(root, "alt", "metrics"), { recursive: true });
    fs.writeFileSync(path.join(root, "alt", "metrics", `${D}.json`), "{}");
    vi.stubEnv("UT_CONTENT_DIR", "alt");
    try {
      const r = await morning();
      expect(r).toMatchObject({ code: 0, wrote: [] });
      expect(r.lines).toEqual([`metrics/${D}.json exists`]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads them on any day with --counters, and not on a Tuesday without it", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const w = serveCounterSources(world, config, D);
    const without = await morning();
    expect(without.code).toBe(0);
    let metrics = MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`)));
    expect(metrics.counters.find((c) => c.id === "mathlib_theorems")).toMatchObject({ value: null, status: "missing", as_of: null });
    expect(without.lines).toContain("Counter mathlib_theorems: no reading.");
    const withFlag = await morning({ counters: true });
    expect(withFlag.code).toBe(0);
    metrics = MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`)));
    expect(metrics.counters.find((c) => c.id === "mathlib_theorems")).toMatchObject({ value: w.mathlib, as_of: D, status: "ok" });
    expect(metrics.counters.find((c) => c.id === "ancient_texts_ai")).toMatchObject({ as_of: "2026-10-21", status: "ok" });
  });

  it("keeps the last reading as stale, with its own date and its old requests, when its source fails on a day it is read", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, D);
    await morning({ counters: true });
    adopt();
    const first = MetricsFile.parse(readJson(path.join(root, "content", "metrics", `${D}.json`)));
    const firstRows = InputsManifest.parse(readJson(path.join(root, "content", "metrics", "inputs", `${D}.json`))).counters;
    // Monday: every counter source fails (the fixture folder has no answer for them), OpenAlex answers.
    world.close();
    world = new OpenAlexWorld(paceQuery(config.index));
    world.use();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const r = await monday();
    expect(r.code).toBe(0);
    const metrics = MetricsFile.parse(readJson(path.join(staged(MONDAY), "metrics", `${MONDAY}.json`)));
    const rows = InputsManifest.parse(readJson(path.join(staged(MONDAY), "metrics", "inputs", `${MONDAY}.json`))).counters;
    for (const id of ["mathlib_theorems", "ai_drugs", "pdb_structures", "ai_retractions"]) {
      const was = first.counters.find((c) => c.id === id)!;
      expect(metrics.counters.find((c) => c.id === id), id).toEqual({ ...was, status: "stale" });
      expect(rows.find((c) => c.id === id), id).toEqual(firstRows.find((c) => c.id === id));
      expect(r.lines).toContain(`Counter ${id}: its source failed, the reading of ${D} is kept.`);
      expect(r.lines).toContain(`Counter ${id}: its source gave no reading today.`);
    }
    expect(metrics.counters.find((c) => c.id === "ancient_texts_ai")).toMatchObject({ as_of: "2026-10-25", status: "ok" });
  });

  it("leaves a counter that fails with no earlier reading missing", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const r = await monday();
    expect(r.code).toBe(0);
    const metrics = MetricsFile.parse(readJson(path.join(staged(MONDAY), "metrics", `${MONDAY}.json`)));
    for (const id of ["mathlib_theorems", "ai_drugs", "pdb_structures", "ai_retractions"]) {
      expect(metrics.counters.find((c) => c.id === id), id).toMatchObject({ value: null, as_of: null, status: "missing" });
      expect(r.lines).toContain(`Counter ${id}: no reading.`);
    }
  });

  it("does not take half of a counter for a reading: pdb_structures needs both of its sources", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, MONDAY);
    world.serveRaw(config.sources.feeds.find((f) => f.id === "rcsb-unreleased")!.url, "not a holdings file", "text/plain");
    const r = await monday();
    const metrics = MetricsFile.parse(readJson(path.join(staged(MONDAY), "metrics", `${MONDAY}.json`)));
    expect(metrics.counters.find((c) => c.id === "pdb_structures")).toMatchObject({ value: null, status: "missing" });
    expect(metrics.counters.find((c) => c.id === "mathlib_theorems")).toMatchObject({ status: "ok" });
    expect(r.lines).toContain("Counter pdb_structures: its source gave no reading today.");
  });
});

describe("--recompute (SPEC §8.4: rebuilds D's file from inputs and the cache, compares bytes, exit 1 on a difference)", () => {
  /** A repository whose history holds the morning's files, as publish leaves them. */
  function committed(date = D): void {
    if (!fs.existsSync(path.join(root, ".git"))) {
      sh(root, "init", "-q", "-b", "main");
      fs.writeFileSync(path.join(root, ".gitignore"), "/cache/\n/logs/\n");
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "base");
    }
    adopt(date);
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", `data-only: ${date}`);
  }
  const recompute = (over: Partial<RunMetricsOptions> = {}) => runMetrics({ date: D, root, recompute: true, now: NOW, apiKey: null, ...over });

  it("reproduces an ok file: the same bytes from the manifest, the cache and the state at the commit, written to logs/recompute/D/", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    expect((await morning()).code).toBe(0);
    committed();
    world.refuseAll(500);
    const r = await recompute();
    expect(r.code).toBe(0);
    expect(r.firstLine).toBe("Reproduced.");
    expect(r.status).toBe("ok");
    expect(r.wrote).toEqual([`metrics/${D}.json`, `metrics/inputs/${D}.json`, "state/pace-weekly.json"]);
    const out = path.join(root, "logs", "recompute", D);
    expect(read(path.join(out, "metrics", `${D}.json`))).toBe(read(path.join(root, "content", "metrics", `${D}.json`)));
    expect(read(path.join(out, "metrics", "inputs", `${D}.json`))).toBe(read(path.join(root, "content", "metrics", "inputs", `${D}.json`)));
    expect(read(path.join(out, "state", "pace-weekly.json"))).toBe(read(path.join(root, "content", "state", "pace-weekly.json")));
    expect(r.lines).toContain("C, D and the ledger counter were computed from the findings as they are now.");
  });

  it("reproduces without git too, from the working tree's state (the files are written by --out content and not committed yet)", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning({ out: "content" });
    expect(fs.existsSync(path.join(root, ".git"))).toBe(false);
    const r = await recompute();
    expect(r.code).toBe(0);
    expect(r.firstLine).toBe("Reproduced.");
  });

  it("still reproduces the file of an earlier date after later mornings changed the state: it reads the state at its own commit", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    committed();
    const next = "2026-10-23";
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const second = await runMetrics({ date: next, root, now: new Date(`${next}T03:20:00+08:00`), apiKey: null });
    expect(second.code).toBe(0);
    committed(next);
    expect(read(path.join(root, "content", "state", "pace-weekly.json"))).toContain(`"updated": "${next}"`);
    expect((await recompute()).firstLine).toBe("Reproduced.");
    expect((await recompute({ date: next })).firstLine).toBe("Reproduced.");
  });

  it("reads the state at the first commit that added D's file when the file was removed and added again with another state", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    committed();
    // The file is taken out, and put back with a state that the cached answers do not give (its newest week is dated long ago).
    sh(root, "rm", "-q", "-r", "content/metrics");
    sh(root, "commit", "-q", "-m", "removed");
    // adopt() copies the staged files over content/, so the other state is written after it.
    adopt();
    const stateFile = path.join(root, "content", "state", "pace-weekly.json");
    const state = PaceWeeklyFile.parse(readJson(stateFile));
    fs.writeFileSync(stateFile, jsonText({ ...state, weeks: state.weeks.map((w, i) => (i === state.weeks.length - 1 ? { ...w, fetched: "2016-01-01" } : w)) }, PaceWeeklyFile));
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "added again");
    expect((await recompute()).firstLine).toBe("Reproduced.");
  });

  it("fails, naming the state file, when the state at D's commit does not parse (it is not taken for no state)", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    fs.writeFileSync(path.join(staged(), "state", "pace-weekly.json"), "{}\n");
    committed();
    const r = await recompute();
    expect(r.code).toBe(1);
    expect(r.firstLine).toMatch(/^state\/pace-weekly\.json does not parse: /);
  });

  it("is not reproduced, exit 1, when one count of the committed file differs, naming the first difference", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    committed();
    const file = path.join(root, "content", "metrics", `${D}.json`);
    const doc = readJson(file) as { pace: { leading: { pooled: { window: { k: number } } } } };
    doc.pace.leading.pooled.window.k += 1;
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const r = await recompute();
    expect(r.code).toBe(1);
    expect(r.firstLine).toBe("Not reproduced: the first difference is in metrics/2026-10-22.json at pace.leading.pooled.window.k.");
  });

  it("is not reproduced when the manifest differs, naming the manifest", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    committed();
    const file = path.join(root, "content", "metrics", "inputs", `${D}.json`);
    const doc = readJson(file) as { counters: { value: number }[] };
    doc.counters[0]!.value += 1;
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const r = await recompute();
    expect(r.code).toBe(1);
    expect(r.firstLine).toBe("Not reproduced: the first difference is in metrics/inputs/2026-10-22.json at counters[0].value.");
  });

  it("is not reproduced when a request's count of works with no primary topic differs: the manifest keeps it and the answer gives it back", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    committed();
    const file = path.join(root, "content", "metrics", "inputs", `${D}.json`);
    const doc = readJson(file) as { openalex: { ungrouped_n: number }[] };
    doc.openalex[3]!.ungrouped_n += 1;
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const r = await recompute();
    expect(r.code).toBe(1);
    expect(r.firstLine).toBe("Not reproduced: the first difference is in metrics/inputs/2026-10-22.json at openalex[3].ungrouped_n.");
  });

  it("keeps the committed reading of a counter whose manifest row lists no request: there is nothing to read back, and no crash", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    const monday = "2026-10-26";
    serveCounterSources(world, config, monday);
    await runMetrics({ date: monday, root, now: new Date(`${monday}T03:20:00+08:00`), apiKey: null });
    committed(monday);
    const file = path.join(root, "content", "metrics", "inputs", `${monday}.json`);
    const doc = readJson(file) as { counters: { id: string; requests: unknown[] }[] };
    doc.counters.find((c) => c.id === "mathlib_theorems")!.requests = [];
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const r = await runMetrics({ date: monday, root, recompute: true, now: new Date(`${monday}T03:20:00+08:00`), apiKey: null });
    expect(r.lines.join("\n")).not.toContain("Cannot read");
    expect(r.code, r.lines.join("\n")).toBe(0);
    expect(r.firstLine).toBe("Reproduced.");
  });

  it("is not reproduced when the committed state differs from what the cached answers give", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    const file = path.join(staged(), "state", "pace-weekly.json");
    const state = PaceWeeklyFile.parse(readJson(file));
    state.weeks.at(-1)!.all.physics[1] += 1;
    fs.writeFileSync(file, jsonText(state, PaceWeeklyFile));
    committed();
    const r = await recompute();
    expect(r.code).toBe(1);
    expect(r.firstLine).toBe("Not reproduced: the weekly state differs from the answers in the cache at weeks[614].all.physics[1].");
  });

  it("is not reproduced, naming the answer, when an answer the manifest lists is not in the cache", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    committed();
    const victim = cachedAnswers().find((f) => f.startsWith("2026-09-07/all_total."))!;
    fs.rmSync(path.join(root, "cache", "openalex", victim));
    const r = await recompute();
    expect(r.code).toBe(1);
    expect(r.firstLine).toBe("Not reproduced: 1 of the 36 OpenAlex answers the manifest lists are not in cache/openalex/ (first: all_total 2026-09-07).");
  });

  it("does not take an answer for the manifest's when its body is another one (the SHA-256 is read, not the name)", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    committed();
    const victim = path.join(root, "cache", "openalex", cachedAnswers().find((f) => f.startsWith("2026-09-07/leading_ai."))!);
    const doc = readJson(victim) as { body: string; sha256: string };
    doc.body = doc.body.replace(/"count": (\d+)/, (_m, n) => `"count": ${Number(n) + 1}`);
    doc.sha256 = sha256Hex(doc.body);
    fs.writeFileSync(victim, `${JSON.stringify(doc, null, 2)}\n`);
    const r = await recompute();
    expect(r.code).toBe(1);
    expect(r.firstLine).toMatch(/^Not reproduced: 1 of the 36 OpenAlex answers the manifest lists are not in cache\/openalex\//);
  });

  it("reproduces a stale file from the state it reused, and a missing one with none", async () => {
    seedState();
    world.refuseAll(402);
    const gone = await morning();
    expect(gone.status).toBe("stale");
    committed();
    const stale = await recompute();
    expect(stale).toMatchObject({ code: 0, firstLine: "Reproduced.", status: "stale" });
    expect(stale.wrote).toEqual([`metrics/${D}.json`, `metrics/inputs/${D}.json`]);

    const other = "2026-10-29";
    fs.rmSync(path.join(root, "content", "state"), { recursive: true });
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "state removed");
    const missing = await runMetrics({ date: other, root, now: new Date(`${other}T03:20:00+08:00`), apiKey: null });
    expect(missing.status).toBe("missing");
    committed(other);
    expect(await recompute({ date: other })).toMatchObject({ code: 0, firstLine: "Reproduced.", status: "missing" });
  });

  it("fails, naming what is missing, with no file to recompute, no manifest, or a file that does not parse", async () => {
    expect(await recompute()).toMatchObject({ code: 1, lines: [`metrics/${D}.json does not exist: nothing to recompute.`] });
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    adopt();
    fs.rmSync(path.join(root, "content", "metrics", "inputs", `${D}.json`));
    expect((await recompute()).lines).toEqual([`metrics/inputs/${D}.json is missing or does not parse: nothing to recompute from.`]);
    fs.writeFileSync(path.join(root, "content", "metrics", `${D}.json`), "{}\n");
    expect((await recompute()).lines[0]).toMatch(/^metrics\/2026-10-22\.json does not parse: /);
  });

  it("fails, naming the manifest, when the manifest is there and does not parse", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    adopt();
    fs.writeFileSync(path.join(root, "content", "metrics", "inputs", `${D}.json`), "{");
    expect((await recompute()).lines).toEqual([`metrics/inputs/${D}.json is missing or does not parse: nothing to recompute from.`]);
    fs.writeFileSync(path.join(root, "content", "metrics", "inputs", `${D}.json`), "{}");
    expect((await recompute()).lines).toEqual([`metrics/inputs/${D}.json is missing or does not parse: nothing to recompute from.`]);
  });

  it("computes the ledger counter from the findings as they are now when the run read it (a Monday, or --counters, dated the day before D): a finding added since is a difference of that counter alone", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, D);
    await morning({ counters: true });
    committed();
    expect(new Date(`${D}T12:00:00Z`).getUTCDay()).toBe(4);
    // Once with the findings as the run had them, then again with one added: each recompute reads the folder as it is, not a copy of the first.
    expect((await recompute()).firstLine).toBe("Reproduced.");
    addAncientTextsFinding(root);
    const metrics = MetricsFile.parse(readJson(path.join(root, "content", "metrics", `${D}.json`)));
    const at_ = metrics.counters.findIndex((c) => c.id === "ancient_texts_ai");
    expect(metrics.counters[at_]).toMatchObject({ value: 0, as_of: "2026-10-21" });
    const r = await recompute();
    expect(r.code).toBe(1);
    expect(r.firstLine).toBe(`Not reproduced: the first difference is in metrics/${D}.json at counters[${at_}].value.`);
    expect(r.lines).toContain("C, D and the ledger counter were computed from the findings as they are now.");
  });

  it("leaves the ledger counter a run carried as the file has it: dated another day than the day before D, on a day that is no Monday, it is not computed again", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, D);
    await morning({ counters: true });
    committed();
    addAncientTextsFinding(root);
    const file = path.join(root, "content", "metrics", `${D}.json`);
    const metrics = MetricsFile.parse(readJson(file));
    const at_ = metrics.counters.findIndex((c) => c.id === "ancient_texts_ai");
    fs.writeFileSync(file, jsonText({ ...metrics, counters: metrics.counters.map((c, i) => (i === at_ ? { ...c, as_of: "2026-10-01" } : c)) }, MetricsFile));
    const r = await recompute();
    // The counter is carried with its date as the file has it, not computed again from the findings added since: the file reproduces.
    expect(r.firstLine).toBe("Reproduced.");
  });

  it("fails when an ok file has no state to join the answers to", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    adopt();
    fs.rmSync(path.join(root, "content", "state"), { recursive: true });
    expect((await recompute()).lines).toEqual([`No weekly state is committed with metrics/${D}.json: nothing to recompute from.`]);
  });

  it("reads the counters this run read back from the bodies in cache/feeds/ with their SHA-256, and says when a body is gone or changed", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, D);
    await morning({ counters: true });
    committed();
    const ok = await recompute();
    expect(ok.firstLine).toBe("Reproduced.");
    expect(ok.lines.some((l) => l.startsWith("Counters not read back"))).toBe(false);
    // A reading that disagrees with its bodies is not reproduced.
    const metricsFile = path.join(root, "content", "metrics", `${D}.json`);
    const doc = readJson(metricsFile) as { counters: { id: string; value: number }[] };
    doc.counters.find((c) => c.id === "mathlib_theorems")!.value += 1;
    fs.writeFileSync(metricsFile, `${JSON.stringify(doc, null, 2)}\n`);
    const bad = await recompute();
    expect(bad.code).toBe(1);
    expect(bad.firstLine).toMatch(/^Not reproduced: the first difference is in metrics\/2026-10-22\.json at counters\[\d+\]\.value\.$/);
    fs.writeFileSync(metricsFile, read(path.join(root, "content", "metrics", `${D}.json`)).replace(String(doc.counters.find((c) => c.id === "mathlib_theorems")!.value), "297154"));
    expect((await recompute()).firstLine).toBe("Reproduced.");
    // A body that is gone, or is not the bytes recorded, cannot be read back: the committed reading is kept, and the output says so.
    fs.rmSync(path.join(root, "cache", "feeds", "mathlib-stats.html"));
    fs.writeFileSync(path.join(root, "cache", "feeds", "retraction-watch.csv"), "changed\n");
    const gone = await recompute();
    expect(gone.code).toBe(0);
    expect(gone.lines).toContain("Counters not read back (their bodies are not in cache/feeds/ as recorded): mathlib_theorems, ai_retractions; the committed readings are kept.");
  });

  it("reads back each counter by its own reading: one that failed that day (no reading, no requests) does not stop the others being read back", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, D);
    // The first counter's source answers with a page that holds no figure.
    world.serveRaw(config.sources.feeds.find((f) => f.id === "mathlib-stats")!.url, "<html><body>nothing here</body></html>", "text/html");
    await morning({ counters: true });
    const first = MetricsFile.parse(readJson(path.join(staged(), "metrics", `${D}.json`)));
    expect(first.counters.find((c) => c.id === "mathlib_theorems")).toMatchObject({ status: "missing" });
    expect(["ai_drugs", "pdb_structures", "ai_retractions"].map((id) => first.counters.find((c) => c.id === id)?.status)).toEqual(["ok", "ok", "ok"]);
    committed();
    const r = await recompute();
    expect(r.firstLine).toBe("Reproduced.");
    expect(r.lines.some((l) => l.startsWith("Counters not read back"))).toBe(false);
    // The readings really came back from the bodies: one of them changed in the committed file is a difference.
    const metricsFile = path.join(root, "content", "metrics", `${D}.json`);
    const doc = readJson(metricsFile) as { counters: { id: string; value: number }[] };
    doc.counters.find((c) => c.id === "ai_retractions")!.value += 1;
    fs.writeFileSync(metricsFile, `${JSON.stringify(doc, null, 2)}\n`);
    expect((await recompute()).code).toBe(1);
  });

  it("reads back only a counter whose committed reading is ok: one the file marks stale is kept as it is, though its requests are dated that day", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, D);
    await morning({ counters: true });
    committed();
    const metricsFile = path.join(root, "content", "metrics", `${D}.json`);
    const doc = readJson(metricsFile) as { counters: { id: string; status: string }[] };
    doc.counters.find((c) => c.id === "mathlib_theorems")!.status = "stale";
    fs.writeFileSync(metricsFile, `${JSON.stringify(doc, null, 2)}\n`);
    const r = await recompute();
    expect(r.lines.join("\n")).not.toContain("Counters not read back");
    // Not read back, the stale reading is carried as it is; read back, it would come out ok and differ from the file.
    expect(r.firstLine).toBe("Reproduced.");
  });

  it("keeps a counter a run carried as it was, and a counter read that day in the bodies, without asking the cache for the carried one", async () => {
    seedState({ cutoff: CUTOFF, updated: "2026-10-21" });
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    serveCounterSources(world, config, D);
    await morning({ counters: true });
    committed();
    const next = "2026-10-23";
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await runMetrics({ date: next, root, now: new Date(`${next}T03:20:00+08:00`), apiKey: null });
    committed(next);
    fs.rmSync(path.join(root, "cache", "feeds"), { recursive: true });
    const r = await recompute({ date: next });
    expect(r.firstLine).toBe("Reproduced.");
    expect(r.lines.some((l) => l.startsWith("Counters not read back"))).toBe(false);
  });
});

describe("the command line (SPEC §8.4: exit 0 done, 1 failed, 2 a usage error)", () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => (out.push(String(chunk)), true)) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => (err.push(String(chunk)), true)) as typeof process.stderr.write);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [[]], [["--date"]], [["--date", "2026-02-30"]], [["--date", "yesterday"]], [["--nope"]], [["--date", D, "extra"]], [["--date", D, "--nope"]],
    [["--date", D, "--recompute", "--out", "x"]], [["--date", D, "--recompute", "--counters"]],
  ])("answers the usage error %j with exit 2, the usage text on stderr, and nothing on stdout", async (argv) => {
    expect(await main(argv)).toBe(2);
    expect(err.join("")).toBe(`${USAGE}\n`);
    expect(out).toEqual([]);
    expect(fs.existsSync(path.join(root, "cache"))).toBe(false);
  });

  it("recomputes through the command line: exit 0 and `Reproduced.` on stdout, and exit 1 with the difference on stderr", async () => {
    seedState();
    world.serveWeeks(FIRST_FETCHED, LAST_MONDAY);
    await morning();
    adopt();
    expect(await main(["--date", D, "--recompute"])).toBe(0);
    expect(out.join("")).toMatch(/^Reproduced\.\n/);
    expect(err).toEqual([]);
    out = [];
    const file = path.join(root, "content", "metrics", `${D}.json`);
    const metrics = MetricsFile.parse(readJson(file));
    fs.writeFileSync(file, jsonText({ ...metrics, hold: { ...metrics.hold, too_few: !metrics.hold.too_few } }, MetricsFile));
    expect(await main(["--date", D, "--recompute"])).toBe(1);
    expect(err.join("")).toContain(`Not reproduced: the first difference is in metrics/${D}.json at hold.too_few.`);
    expect(out).toEqual([]);
  });
});

describe("the entry point", () => {
  const run = (args: string[]): { code: number; stdout: string; stderr: string } => {
    try {
      const stdout = execFileSync(process.execPath, ["--import", "tsx", ...args], { cwd: repoRoot(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, UT_FIXTURE_FEEDS: world.dir } });
      return { code: 0, stdout, stderr: "" };
    } catch (e) {
      const x = e as { status: number; stdout: string; stderr: string };
      return { code: x.status, stdout: x.stdout, stderr: x.stderr };
    }
  };

  it("runs main() when the file is the command (exit 2 and the usage text with no date), and does not when it is imported", () => {
    const direct = run(["scripts/metrics.ts"]);
    expect(direct).toMatchObject({ code: 2, stdout: "" });
    expect(direct.stderr).toBe(`${USAGE}\n`);
    const imported = run(["--input-type=module", "-e", "await import('./scripts/metrics.ts'); console.log('loaded');"]);
    expect(imported).toEqual({ code: 0, stdout: "loaded\n", stderr: "" });
  }, 60_000);
});

describe("firstDifference", () => {
  it("names the first path where two values differ, in key order, through arrays and objects", () => {
    expect(firstDifference({ a: 1 }, { a: 1 })).toBeNull();
    expect(firstDifference({ a: { b: [1, 2, { c: 3 }] } }, { a: { b: [1, 2, { c: 4 }] } })).toBe("a.b[2].c");
    expect(firstDifference([1, 2], [1, 2, 3])).toBe("[2]");
    expect(firstDifference({ a: 1 }, { a: 1, b: 2 })).toBe("b");
    expect(firstDifference(1, 2)).toBe("(top level)");
    expect(firstDifference({ a: null }, { a: {} })).toBe("a");
    expect(firstDifference({ a: [] }, { a: {} })).toBe("a");
  });
});
