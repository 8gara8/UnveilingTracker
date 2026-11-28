// scripts/backfill.ts (SPEC §8.4 `backfill.ts --pace`, §5.4 the backfill): each sentence of §8.4's second bullet is read as a test here. Every
// answer OpenAlex gives, and every counter source, is served from a temporary fixture folder through `UT_FIXTURE_FEEDS`
// (tests/helpers/openalex-world.ts), so no request leaves the machine; the script runs in-process against a temporary repository root that
// holds the real `config/`, with `publishState()` a stub that records what it is asked (scripts/publish.ts is P3's). The runs over the real
// span start at 2015-01-05 and end at the Monday of 2026-10-12 (the edition of Thursday 2026-10-22, data cutoff Sunday 2026-10-18): 615 weeks,
// 2,460 requests. The runs with `--to` use the earliest edition date, 2019-12-31 (data to 2019-12-29, 260 weeks), where a short build is enough.
// New for this project; Cyber's tests/backfill.test.ts is the pattern (a temp repo, a fixed clock, a stub publishState, a bare remote).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { addDays, daysBetween } from "@/lib/dates";
import { InputsManifest, MetricsFile, PaceWeeklyFile } from "@/lib/schema/metrics";
import { FIELDS } from "@/lib/vocab";
import { sha256Hex } from "@/lib/json";
import type { fetchFeed } from "@/lib/feeds/http";
import { BUDGET_RESET, paceQuery } from "@/scripts/lib/openalex";
import {
  DEFAULT_OUT, USAGE, UsageError, main, parseBackfillArgs, runBackfill, type BackfillDeps, type PublishStateOptions,
} from "@/scripts/backfill";
import { runMetrics } from "@/scripts/metrics";
import { OpenAlexWorld, filesHolding, makeRoot, repoRoot, serveCounterSources, sh } from "./helpers/openalex-world";

const config = loadConfig(path.join(repoRoot(), "config"));
const TODAY = "2026-10-22";
const CUTOFF = "2026-10-18";
const LAST_MONDAY = "2026-10-12";
const FIRST = "2015-01-05";
const EARLIEST = "2019-12-31";
const EARLIEST_CUTOFF = "2019-12-29";
const LAST_EARLIEST = "2019-12-23";
const at = (date: string, hhmm: string): Date => new Date(`${date}T${hhmm}:00+08:00`);
const NOW = at(TODAY, "05:10");
const read = (file: string): string => fs.readFileSync(file, "utf8");
const readJson = (file: string): unknown => JSON.parse(read(file));
const pv = { ai_terms: config.aiTerms.version, journals: config.journals.version, fields: config.fields.version };

const mondays = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addDays(m, 7)) out.push(m);
  return out;
};
const FULL = mondays(FIRST, LAST_MONDAY);
const SHORT = mondays(FIRST, LAST_EARLIEST);

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
 * One whole backfill over the real span, run once for the file (about 15 seconds of 2,460 fixture requests) on the edition of 2026-10-22 with
 * `--out content` and the counters' sources served: the tests of the real span read its output, and the others start from a copy of its
 * answer cache, which is what an earlier run of the same day leaves.
 */
const template: { root: string; run: { code: number; lines: string[] }; world: OpenAlexWorld } = {} as never;

beforeAll(async () => {
  template.world = new OpenAlexWorld(paceQuery(config.index));
  template.world.use();
  template.root = makeRoot();
  roots.push(template.root);
  template.world.serveWeeks(FIRST, LAST_MONDAY);
  serveCounterSources(template.world, config, TODAY);
  const lines: string[] = [];
  const code = await runBackfill(parseBackfillArgs(["--pace", "--out", "content"], template.root), { now: () => NOW, apiKey: null, print: (l) => lines.push(l) });
  template.run = { code, lines };
  template.world.close();
}, 240_000);

/** Copies the template's answer cache into `root`: the state of a machine that has fetched today's answers already. */
function warmCache(into: string = root): void {
  fs.cpSync(path.join(template.root, "cache", "openalex"), path.join(into, "cache", "openalex"), { recursive: true });
}

interface Run {
  code: number;
  lines: string[];
}

/** One run of the command, in-process: `argv` as typed, the clock `now`, no key, no publishState unless given. */
async function backfill(argv: string[], over: Partial<BackfillDeps> = {}, at_: string = root): Promise<Run> {
  const lines: string[] = [];
  const code = await runBackfill(parseBackfillArgs(argv, at_), { now: () => NOW, apiKey: null, print: (l) => lines.push(l), ...over });
  return { code, lines };
}

/** The numbers of the run's `Pace: N weeks fetched or read from the cache (R requests, C cached, K credits).` line. */
function pace(run: Run): { weeks: number; requests: number; cached: number; credits: number } {
  const m = /^Pace: (\d+) weeks fetched or read from the cache \((\d+) requests, (\d+) cached, (\d+) credits\)\.$/.exec(run.lines.find((l) => l.startsWith("Pace: ")) ?? "");
  if (!m) throw new Error(`no Pace line in ${JSON.stringify(run.lines)}`);
  return { weeks: Number(m[1]), requests: Number(m[2]), cached: Number(m[3]), credits: Number(m[4]) };
}

const staged = (...p: string[]): string => path.join(root, DEFAULT_OUT, ...p);
const stateAt = (file: string): PaceWeeklyFile => PaceWeeklyFile.parse(readJson(file));

/** The OpenAlex answers on disk, as `<Monday>/<file>`. */
function cachedAnswers(at_: string = root): string[] {
  const dir = path.join(at_, "cache", "openalex");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((week) => fs.readdirSync(path.join(dir, week)).sort().map((f) => `${week}/${f}`));
}

/** Every file under `dir` as relative path to bytes, sorted. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out[path.relative(dir, full)] = read(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/** The sum of k and n the world holds for A (the leading journals) over some Mondays, worked here and not by the code under test. */
function leadingSum(weeks: readonly string[]): { k: number; n: number } {
  let k = 0;
  let n = 0;
  for (const w of weeks) {
    for (const f of FIELDS) {
      const c = world.counts(w, f).leading;
      k += c[0];
      n += c[1];
    }
  }
  return { k, n };
}

// ── The command line (§8.4) ──────────────────────────────────────────────────────────────────────

describe("the command line (SPEC §8.4: `--pace [--refresh] [--to YYYY-MM-DD] [--out DIR] [--push]`)", () => {
  const usage = (argv: string[]): string => {
    try {
      parseBackfillArgs(argv, root);
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      return (e as Error).message;
    }
    throw new Error(`no usage error for ${argv.join(" ")}`);
  };

  it("reads every flag, and nothing else", () => {
    expect(parseBackfillArgs(["--pace"], root)).toEqual({
      root: path.resolve(root), pace: true, refresh: false, to: null, out: null, push: false, saveReference: null, edition: null,
    });
    expect(parseBackfillArgs(["--pace", "--refresh", "--to", EARLIEST, "--out", "content"], root)).toMatchObject({ refresh: true, to: EARLIEST, out: "content", push: false });
    expect(parseBackfillArgs(["--pace", "--push"], root)).toMatchObject({ push: true, out: null, to: null });
    expect(parseBackfillArgs(["--save-reference", "fixtures", "--edition", TODAY], root)).toMatchObject({ saveReference: "fixtures", edition: TODAY, pace: false });
    expect(usage(["--pace", "extra"])).toMatch(/positional|Unexpected/i);
    expect(usage(["--pace", "--nope"])).toMatch(/Unknown option/);
    expect(usage(["--pace", "--to"])).toMatch(/argument missing|requires/i);
  });

  it("needs --pace: --catch-up and --credits are not this phase's", () => {
    expect(usage([])).toContain("--pace is required");
    expect(usage(["--refresh"])).toContain("--pace is required");
    expect(usage(["--catch-up"])).toMatch(/Unknown option/);
    expect(usage(["--credits"])).toMatch(/Unknown option/);
  });

  it("makes --push with --out or --to a usage error", () => {
    expect(usage(["--pace", "--push", "--out", "content"])).toContain("leave out --out and --to");
    expect(usage(["--pace", "--push", "--to", EARLIEST])).toContain("leave out --out and --to");
    // --refresh is no clash: a push may rebuild every week (a config version changed, §5.4).
    expect(parseBackfillArgs(["--pace", "--push", "--refresh"], root)).toMatchObject({ push: true, refresh: true });
  });

  it("makes --to a date, --edition go with --save-reference only, and --save-reference a run of its own", () => {
    expect(usage(["--pace", "--to", "2019-02-30"])).toContain("--to takes a date");
    expect(usage(["--pace", "--to", "yesterday"])).toContain("--to takes a date");
    expect(usage(["--pace", "--out", ""])).toContain("--out takes a folder");
    expect(usage(["--pace", "--edition", TODAY])).toContain("--edition goes with --save-reference");
    expect(usage(["--save-reference", "x", "--pace"])).toContain("a run of its own");
    expect(usage(["--save-reference", "x", "--to", EARLIEST])).toContain("a run of its own");
    expect(usage(["--save-reference", "x", "--out", "y"])).toContain("a run of its own");
    expect(usage(["--save-reference", "x", "--push"])).toContain("a run of its own");
    expect(usage(["--save-reference", "x", "--edition", "2026-13-01"])).toContain("--edition takes a date");
    expect(usage(["--save-reference", ""])).toContain("--save-reference takes");
  });

  it("answers a usage error with exit 2 and the usage text, before any work (nothing fetched, nothing written)", async () => {
    for (const to of [TODAY, "2026-10-23", "2019-12-30", "2015-06-01"]) {
      const r = await backfill(["--pace", "--to", to]);
      expect(r.code, to).toBe(2);
      expect(r.lines.join("\n")).toContain(USAGE);
    }
    expect(fs.existsSync(path.join(root, "cache"))).toBe(false);
  });

  it("takes --to only for an edition date earlier than today whose data cutoff is on or after the baseline's end (2019-12-29)", async () => {
    // 2019-12-30 minus 2 days is Saturday 12-28, whose Sunday is 12-22: before the baseline's end. 2019-12-31 minus 2 is Sunday 12-29 itself.
    const early = await backfill(["--pace", "--to", "2019-12-30"]);
    expect(early.code).toBe(2);
    expect(early.lines.join("\n")).toContain("has data to 2019-12-22, before the baseline ends (2019-12-29)");
    const today = await backfill(["--pace", "--to", TODAY]);
    expect(today.code).toBe(2);
    expect(today.lines.join("\n")).toContain(`earlier edition date than today (${TODAY})`);
    warmCache();
    const ok = await backfill(["--pace", "--to", EARLIEST]);
    expect(ok.code).toBe(0);
    expect(ok.lines[0]).toBe(`Backfill ${EARLIEST}: 260 weeks, ${FIRST} to ${LAST_EARLIEST} (data to ${EARLIEST_CUTOFF}).`);
    // The day before today is an earlier edition date too.
    const yesterday = await backfill(["--pace", "--to", "2026-10-21", "--out", "elsewhere"]);
    expect(yesterday.code).toBe(0);
    expect(MetricsFile.parse(readJson(path.join(root, "elsewhere", "metrics", "2026-10-21.json"))).data_cutoff).toBe(CUTOFF);
  });

  it("main() answers a usage error with exit 2 and the usage text on stderr", async () => {
    const written: string[] = [];
    const err = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await main(["--catch-up"], {}, root)).toBe(2);
    } finally {
      process.stderr.write = err;
    }
    expect(written.join("")).toContain(USAGE);
  });
});

// ── The build ────────────────────────────────────────────────────────────────────────────────────

describe("the build to the earliest edition date, 2019-12-31 (SPEC §8.4, §5.4)", () => {
  const files = ["state/pace-weekly.json", `metrics/${EARLIEST}.json`, `metrics/inputs/${EARLIEST}.json`];

  /** One fresh run of `--to 2019-12-31` (1,040 requests), made once: the first three tests read what it left. */
  const short: { root: string; run: Run } = {} as never;
  beforeAll(async () => {
    const w = new OpenAlexWorld(paceQuery(config.index));
    w.use();
    short.root = makeRoot();
    roots.push(short.root);
    w.serveWeeks(FIRST, LAST_EARLIEST);
    short.run = await backfill(["--pace", "--to", EARLIEST], {}, short.root);
    w.close();
  }, 120_000);
  const shortStaged = (...p: string[]): string => path.join(short.root, DEFAULT_OUT, ...p);

  it("builds the whole weekly state from 2015-01-05 to the cutoff and writes D's two metrics files from it, in cache/staged/backfill/", () => {
    const r = short.run;
    expect(r.code, r.lines.join("\n")).toBe(0);
    expect(Object.keys(tree(shortStaged()))).toEqual([...files].sort());
    const state = stateAt(shortStaged("state", "pace-weekly.json"));
    expect(state).toMatchObject({ updated: TODAY, versions: pv });
    expect(state.weeks.map((w) => w.week_start)).toEqual(SHORT);
    expect(state.weeks).toHaveLength(260);
    for (const w of state.weeks) {
      expect({ leading: w.leading, all: w.all }, w.week_start).toEqual(template.world.pairs(w.week_start));
      expect(w.fetched, w.week_start).toBe(TODAY);
      expect(w.provisional, w.week_start).toBe(w.week_start >= "2019-11-04");
    }
    expect(state.weeks.filter((w) => w.provisional)).toHaveLength(8);
    expect(pace(r)).toEqual({ weeks: 260, requests: 1040, cached: 0, credits: 260 * 22 });
    expect(r.lines.at(-1)).toBe(`Backfill wrote 3 files to ${DEFAULT_OUT}.`);
  });

  it("reads the counters through the feed context it was given: their requests go to the caller's fetcher, and a source that fails leaves a counter missing", async () => {
    fs.cpSync(path.join(short.root, "cache", "openalex"), path.join(root, "cache", "openalex"), { recursive: true });
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(url);
      return { ok: false, status: 503, finalUrl: url, body: null, contentType: null, error: "http", detail: "stub", durationMs: 0, attempts: 1 };
    }) as unknown as typeof fetchFeed;
    const r = await backfill(["--pace", "--to", EARLIEST], { feedCtx: { fetch, log: () => {} } });
    expect(r.code, r.lines.join("\n")).toBe(0);
    expect(pace(r)).toMatchObject({ requests: 0, cached: 1040 });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u) => u.includes(config.sources.feeds.find((f) => f.id === "mathlib-stats")!.url))).toBe(true);
    const metrics = MetricsFile.parse(readJson(staged("metrics", `${EARLIEST}.json`)));
    expect(metrics.counters.find((c) => c.id === "mathlib_theorems")).toMatchObject({ status: "missing", value: null });
  });

  it("is a failure, exit 1, when the metrics files cannot be written: the state is still staged, and the cause is printed", async () => {
    fs.cpSync(path.join(short.root, "cache", "openalex"), path.join(root, "cache", "openalex"), { recursive: true });
    // `metrics` is a file where the run needs a folder.
    fs.mkdirSync(path.join(root, "blocked"), { recursive: true });
    fs.writeFileSync(path.join(root, "blocked", "metrics"), "in the way");
    const r = await backfill(["--pace", "--to", EARLIEST, "--out", "blocked"]);
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toMatch(/\S/);
    expect(r.lines.some((l) => l.startsWith("Backfill wrote"))).toBe(false);
    expect(fs.existsSync(path.join(root, "blocked", "state", "pace-weekly.json"))).toBe(true);
  });

  it("gives D's file from that state: status ok, data to the cutoff, and the baseline as the world's weeks 2015 to 2019 added up", () => {
    const metrics = MetricsFile.parse(readJson(shortStaged("metrics", `${EARLIEST}.json`)));
    expect(metrics).toMatchObject({ date: EARLIEST, data_cutoff: EARLIEST_CUTOFF, status: "ok", computed_at: "2026-10-22T05:10:00+08:00" });
    let k = 0;
    let n = 0;
    for (const w of SHORT) for (const f of FIELDS) {
      const c = template.world.counts(w, f).leading;
      k += c[0];
      n += c[1];
    }
    expect(metrics.pace.leading.pooled.baseline).toMatchObject({ k, n });
    expect(metrics.pace.window).toEqual({ from: "2019-08-05", to: "2019-11-03" });
    const manifest = InputsManifest.parse(readJson(shortStaged("metrics", "inputs", `${EARLIEST}.json`)));
    // The manifest lists every answer the state came from: 260 weeks of four.
    expect(manifest.openalex).toHaveLength(1040);
    expect(new Set(manifest.openalex.map((q) => q.week_start))).toEqual(new Set(SHORT));
    for (const q of manifest.openalex.slice(0, 8)) expect(q.sha256).toBe(sha256Hex(template.world.body(q.request, q.week_start)));
    expect(manifest.date).toBe(EARLIEST);
  });

  it("does not change the state when it writes the metrics files (frozen): the metrics stage fetches nothing and prints no Pace fetch line of its own", () => {
    const r = short.run;
    expect(pace(r).requests).toBe(1040);
    expect(r.lines.filter((l) => l.startsWith("Pace: "))).toHaveLength(1);
    expect(r.lines).toContain(`Metrics ${EARLIEST}: Pace ok, data to ${EARLIEST_CUTOFF}.`);
  });

  it("prints its progress every 52 weeks", () => {
    const progress = short.run.lines.filter((l) => l.startsWith("Backfill: "));
    expect(progress).toEqual([52, 104, 156, 208].map((n) => `Backfill: ${n} of 260 weeks done, to the week of ${SHORT[n - 1]}.`));
  });

  it("fetches the oldest week first, so a refused request leaves the oldest weeks cached and the newest, provisional ones for the last", async () => {
    const stop = "2015-06-01";
    world.serveWeeks(FIRST, LAST_EARLIEST);
    world.refuse("leading_total", stop, 402);
    const r = await backfill(["--pace", "--to", EARLIEST]);
    expect(r.code).toBe(1);
    const done = mondays(FIRST, addDays(stop, -7));
    expect(new Set(cachedAnswers().map((f) => f.split("/")[0]))).toEqual(new Set([...done, stop]));
    expect(cachedAnswers().filter((f) => f.startsWith(`${stop}/`))).toHaveLength(1);
    expect(cachedAnswers()).toHaveLength(done.length * 4 + 1);
  });

  it("writes `metrics/D.json exists` and no metrics file when content/ already holds D's, and still stages the state", async () => {
    warmCache();
    fs.mkdirSync(path.join(root, "content", "metrics"), { recursive: true });
    const metricsBytes = read(shortStaged("metrics", `${EARLIEST}.json`));
    fs.writeFileSync(path.join(root, "content", "metrics", `${EARLIEST}.json`), metricsBytes);
    const r = await backfill(["--pace", "--to", EARLIEST]);
    expect(r.code).toBe(0);
    expect(r.lines).toContain(`metrics/${EARLIEST}.json exists`);
    expect(Object.keys(tree(staged()))).toEqual(["state/pace-weekly.json"]);
    expect(r.lines.at(-1)).toBe(`Backfill wrote 1 files to ${DEFAULT_OUT}.`);
    expect(read(path.join(root, "content", "metrics", `${EARLIEST}.json`))).toBe(metricsBytes);
    expect(read(staged("state", "pace-weekly.json"))).toBe(read(shortStaged("state", "pace-weekly.json")));
  });

  it("empties its default staging folder first, and deletes nothing in a folder given with --out (--out content)", async () => {
    warmCache();
    fs.mkdirSync(staged(), { recursive: true });
    fs.writeFileSync(staged("left-over.txt"), "x");
    await backfill(["--pace", "--to", EARLIEST]);
    expect(fs.existsSync(staged("left-over.txt"))).toBe(false);
    fs.mkdirSync(path.join(root, "content", "findings"), { recursive: true });
    fs.writeFileSync(path.join(root, "content", "findings", "kept.txt"), "x");
    const r = await backfill(["--pace", "--to", EARLIEST, "--out", "content"]);
    expect(r.code).toBe(0);
    expect(read(path.join(root, "content", "findings", "kept.txt"))).toBe("x");
    expect(Object.keys(tree(path.join(root, "content", "state")))).toEqual(["pace-weekly.json"]);
    expect(fs.existsSync(path.join(root, "content", "metrics", `${EARLIEST}.json`))).toBe(true);
    expect(fs.existsSync(path.join(root, "content", "metrics", "inputs", `${EARLIEST}.json`))).toBe(true);
    expect(r.lines.at(-1)).toBe("Backfill wrote 3 files to content.");
  });

  it("is byte-identical on a rerun on the same Taipei date, every answer read from the cache and nothing fetched", async () => {
    warmCache();
    await backfill(["--pace", "--to", EARLIEST]);
    const first = tree(staged());
    expect(first["state/pace-weekly.json"]).toBe(read(shortStaged("state", "pace-weekly.json")));
    const answers = cachedAnswers();
    world.refuseAll(500);
    const again = await backfill(["--pace", "--to", EARLIEST], { now: () => at(TODAY, "09:45") });
    expect(again.code).toBe(0);
    expect(pace(again)).toEqual({ weeks: 260, requests: 0, cached: 1040, credits: 0 });
    // computed_at is the clock's, so the metrics file differs by that stamp alone; the state and the manifest's answers do not move.
    const second = tree(staged());
    expect(second["state/pace-weekly.json"]).toBe(first["state/pace-weekly.json"]);
    expect(cachedAnswers()).toEqual(answers);
    const one = InputsManifest.parse(JSON.parse(first[`metrics/inputs/${EARLIEST}.json`]!));
    const two = InputsManifest.parse(JSON.parse(second[`metrics/inputs/${EARLIEST}.json`]!));
    expect(two.openalex).toEqual(one.openalex);
    // With the same clock the whole tree is the same.
    const same = await backfill(["--pace", "--to", EARLIEST]);
    expect(same.code).toBe(0);
    expect(tree(staged())).toEqual(first);
  });
});

describe("a refused request stops the run, and the next day resumes from the cache (SPEC §5.4, M1)", () => {
  const stop = "2015-06-01";
  const index = mondays(FIRST, stop).indexOf(stop);

  it.each([402, 429])("stops cleanly on HTTP %i: exit 1, the weeks done kept, the message that says when the budget resets, no state written", async (status) => {
    world.serveWeeks(FIRST, LAST_EARLIEST);
    world.refuse("leading_total", stop, status);
    const r = await backfill(["--pace", "--to", EARLIEST]);
    expect(r.code).toBe(1);
    const text = r.lines.join("\n");
    expect(text).toContain(`Backfill stopped at the week of ${stop}: ${index} of 260 weeks done`);
    expect(text).toContain(`OpenAlex refused the request (HTTP ${status})`);
    expect(text).toContain(BUDGET_RESET);
    expect(text).toContain("Run the same command again after the budget resets, without --refresh.");
    expect(fs.existsSync(path.join(root, DEFAULT_OUT))).toBe(false);
    expect(cachedAnswers()).toHaveLength(index * 4 + 1);
  });

  it("resumes the next day from the cache: only the weeks not done are fetched, and the first day's answers are read, not refetched", async () => {
    world.serveWeeks(FIRST, LAST_EARLIEST);
    world.refuse("leading_total", stop, 402);
    await backfill(["--pace", "--to", EARLIEST]);
    const done = cachedAnswers();
    world.serveWeek(stop);
    const dayTwo = at("2026-10-23", "08:05");
    const r = await backfill(["--pace", "--to", EARLIEST], { now: () => dayTwo });
    expect(r.code).toBe(0);
    // 1040 answers in all: index weeks and one answer of the stop week were cached on day one.
    expect(pace(r)).toEqual({ weeks: 260, requests: 1040 - (index * 4 + 1), cached: index * 4 + 1, credits: pace(r).credits });
    expect(cachedAnswers()).toHaveLength(1040);
    for (const f of done) expect(cachedAnswers()).toContain(f);
    const state = stateAt(staged("state", "pace-weekly.json"));
    expect(state.updated).toBe("2026-10-23");
    // A week fetched on the first day keeps that date; the weeks fetched on the resumed day carry its date.
    expect(state.weeks.find((w) => w.week_start === FIRST)!.fetched).toBe(TODAY);
    // The week the stop fell in has its first answer from the first day: a week's date is the earliest of its four.
    expect(state.weeks.find((w) => w.week_start === stop)!.fetched).toBe(TODAY);
    expect(state.weeks.find((w) => w.week_start === addDays(stop, 7))!.fetched).toBe("2026-10-23");
    expect(state.weeks.at(-1)!.fetched).toBe("2026-10-23");
  });

  it("never refetches the first day's answers on the resumed day unless --refresh is given, which refetches every one not fetched that day", async () => {
    warmCache();
    world.serveWeeks(FIRST, LAST_EARLIEST);
    const dayTwo = at("2026-10-23", "08:05");
    const resumed = await backfill(["--pace", "--to", EARLIEST], { now: () => dayTwo });
    expect(pace(resumed)).toMatchObject({ requests: 0, cached: 1040 });
    const refreshed = await backfill(["--pace", "--to", EARLIEST, "--refresh"], { now: () => at("2026-10-24", "08:05") });
    expect(pace(refreshed)).toMatchObject({ requests: 1040, cached: 0 });
    // A refresh does not refetch what the same day fetched: a rerun of the refresh is read from the cache.
    const rerun = await backfill(["--pace", "--to", EARLIEST, "--refresh"], { now: () => at("2026-10-24", "09:00") });
    expect(pace(rerun)).toMatchObject({ requests: 0, cached: 1040 });
  });

  it("reports another failure (the network, an answer that is no answer) as a stop too, naming the week and telling the next step without the budget text", async () => {
    world.serveWeeks(FIRST, LAST_EARLIEST);
    world.drop("all_ai", stop);
    const r = await backfill(["--pace", "--to", EARLIEST]);
    expect(r.code).toBe(1);
    const text = r.lines.join("\n");
    expect(text).toContain(`Backfill stopped at the week of ${stop}:`);
    expect(text).toContain("OpenAlex gave no usable answer to all_ai");
    expect(text).not.toContain(BUDGET_RESET);
    expect(text).toContain("The answers fetched are kept in cache/openalex/; run the same command again.");
    expect(fs.existsSync(path.join(root, DEFAULT_OUT))).toBe(false);
  });
});

describe("the OpenAlex key (SPEC §5.1, §9.6: added on the wire only, never recorded)", () => {
  const KEY = "ut-test-key-7Hq2/+x9=";

  it("is sent with every request and is in no line, cache file or staged file, whether the run is stopped by the budget or goes on without it", async () => {
    world.serveWeeks(FIRST, "2015-02-02");
    world.refuse("leading_total", "2015-02-09", 402);
    world.requireKey(KEY);
    const keyless = await backfill(["--pace", "--to", EARLIEST]);
    expect(stoppedAt(keyless), "a keyless run is not served once the key is required").toBe("2015-01-05");
    const r = await backfill(["--pace", "--to", EARLIEST], { apiKey: KEY });
    expect(r.code).toBe(1);
    expect(stoppedAt(r)).toBe("2015-02-09");
    // A run with no key says so, since the backfill's credits are more than a keyless day's; a run with one does not.
    expect(keyless.lines.filter((l) => l.startsWith("No OpenAlex key was found in the keychain, so the run is keyless"))).toHaveLength(1);
    expect(r.lines.filter((l) => l.startsWith("No OpenAlex key"))).toEqual([]);
    expect(cachedAnswers().filter((f) => f.startsWith("2015-02-02/"))).toHaveLength(4);
    for (const text of [KEY, encodeURIComponent(KEY), "api_key"]) {
      expect(r.lines.join("\n")).not.toContain(text);
      expect(filesHolding(root, text), text).toEqual([]);
    }
  });
});

/** The week a stopped run names in its `Backfill stopped at the week of M` line, or null when it did not stop. */
function stoppedAt(run: Run): string | null {
  return /^Backfill stopped at the week of (\d{4}-\d{2}-\d{2}):/.exec(run.lines.find((l) => l.startsWith("Backfill stopped")) ?? "")?.[1] ?? null;
}

// ── The real span ────────────────────────────────────────────────────────────────────────────────

describe("the backfill over the real span, 2015-01-05 to the cutoff of today's edition (SPEC §5.4)", () => {
  it("fetches all 615 weeks, 2,460 requests and 13,530 credits, and its state and metrics file are the world's", () => {
    expect(FULL).toHaveLength(615);
    expect(daysBetween(FIRST, LAST_MONDAY) / 7 + 1).toBe(615);
    const r = template.run;
    expect(r.code, r.lines.join("\n")).toBe(0);
    expect(pace(r)).toEqual({ weeks: 615, requests: 2460, cached: 0, credits: 615 * 22 });
    expect(r.lines[0]).toBe(`Backfill ${TODAY}: 615 weeks, ${FIRST} to ${LAST_MONDAY} (data to ${CUTOFF}).`);
    const content = path.join(template.root, "content");
    const state = stateAt(path.join(content, "state", "pace-weekly.json"));
    expect(state.weeks.map((w) => w.week_start)).toEqual(FULL);
    expect(state.weeks.filter((w) => w.provisional).map((w) => w.week_start)).toEqual(mondays("2026-08-24", LAST_MONDAY));
    for (const w of state.weeks) expect({ leading: w.leading, all: w.all }, w.week_start).toEqual(template.world.pairs(w.week_start));
    const metrics = MetricsFile.parse(readJson(path.join(content, "metrics", `${TODAY}.json`)));
    expect(metrics.status).toBe("ok");
    const sum = (weeks: string[]) => {
      let k = 0;
      let n = 0;
      for (const w of weeks) for (const f of FIELDS) {
        const c = template.world.counts(w, f).leading;
        k += c[0];
        n += c[1];
      }
      return { k, n };
    };
    expect(metrics.pace.leading.pooled.baseline).toMatchObject(sum(mondays(FIRST, "2019-12-23")));
    expect(metrics.pace.window).toEqual({ from: "2026-05-25", to: "2026-08-23" });
    expect(metrics.pace.leading.pooled.window).toMatchObject(sum(mondays("2026-05-25", "2026-08-17")));
    expect(metrics.counters.filter((c) => c.kind === "api").map((c) => [c.id, c.status]).sort()).toEqual(
      [["ai_drugs", "ok"], ["ai_retractions", "ok"], ["mathlib_theorems", "ok"], ["pdb_structures", "ok"]],
    );
    const manifest = InputsManifest.parse(readJson(path.join(content, "metrics", "inputs", `${TODAY}.json`)));
    expect(manifest.openalex).toHaveLength(2460);
    expect(fs.readdirSync(path.join(template.root, "cache", "openalex")).sort()).toEqual(FULL);
    expect(cachedAnswers(template.root)).toHaveLength(2460);
  });

  it("leaves files that `metrics --recompute` reproduces (SPEC §10 P2 step 6): the state, the 2,460 answers and the counters' bodies are all it needs", async () => {
    const r = await runMetrics({ date: TODAY, root: template.root, recompute: true, now: NOW, apiKey: null });
    expect(r.lines.join("\n")).toContain("Reproduced.");
    expect(r).toMatchObject({ code: 0, status: "ok" });
  });

  it("refetches an answer cached while its week was provisional on a later date, and reuses it for a rerun on the same date", async () => {
    warmCache();
    // The nine newest weeks, the provisional ones and the newest firm week, were fetched while they were new: their last morning is after today.
    const nine = mondays("2026-08-17", LAST_MONDAY);
    expect(nine).toHaveLength(9);
    world.revise("2026-10-05", 40);
    world.revise("2026-08-17", 40);
    world.revise("2026-08-10", 40);
    world.serveWeeks("2026-08-10", LAST_MONDAY);
    const next = await backfill(["--pace"], { now: () => at("2026-10-23", "05:10") });
    expect(next.code).toBe(0);
    // Nine weeks of four requests each, 198 credits; every older week is read from the cache (its last morning is past).
    expect(pace(next)).toEqual({ weeks: 615, requests: 36, cached: 2460 - 36, credits: 198 });
    const state = stateAt(staged("state", "pace-weekly.json"));
    for (const w of nine) expect(state.weeks.find((x) => x.week_start === w)!.fetched, w).toBe("2026-10-23");
    for (const w of ["2026-10-05", "2026-08-17"]) expect(state.weeks.find((x) => x.week_start === w), w).toMatchObject(world.pairs(w));
    // The week of 2026-08-10 had its last morning on 2026-10-19, before the first run: its answer was reused, and the world's revision is not read.
    expect(state.weeks.find((x) => x.week_start === "2026-08-10")).toMatchObject({ fetched: TODAY });
    expect(state.weeks.find((x) => x.week_start === "2026-08-10")!.all.physics).not.toEqual(world.pairs("2026-08-10").all.physics);
    // A rerun on the same date reuses the answers the first of that date cached, whatever the world says now.
    world.revise("2026-10-05", 40);
    world.serveWeek("2026-10-05");
    const same = await backfill(["--pace"], { now: () => at("2026-10-23", "11:30") });
    expect(pace(same)).toEqual({ weeks: 615, requests: 0, cached: 2460, credits: 0 });
    expect(stateAt(staged("state", "pace-weekly.json"))).toEqual(state);
    expect(cachedAnswers()).toHaveLength(2460 + 36);
  });
});

// ── --push ───────────────────────────────────────────────────────────────────────────────────────

describe("--push (SPEC §8.4)", () => {
  interface Call extends PublishStateOptions {}

  /** A stub publishState that records what it is asked, and answers `sha` with the files. */
  function stub(sha: string | null = "0123456789abcdef0123456789abcdef01234567", fail?: Error) {
    const calls: Call[] = [];
    return {
      calls,
      publishState: async (o: PublishStateOptions) => {
        calls.push(o);
        if (fail) throw fail;
        return { sha, files: ["state/pace-weekly.json"] };
      },
    };
  }

  /** A git repository in `root` on `main`, clean: the config copy and a .gitignore that leaves the run's folders out, as the repository's does. */
  function repo(dir: string = root): void {
    fs.writeFileSync(path.join(dir, ".gitignore"), "/cache/\n/logs/\n");
    sh(dir, "init", "-q", "-b", "main");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-q", "-m", "base");
  }

  /** The answer cache of an earlier run of the day, so the build is quick and nothing is fetched. */
  async function warm(): Promise<void> {
    warmCache();
  }

  it("publishes the staged state through publishState() under the run lock, writes no metrics file, and releases the lock", async () => {
    repo();
    await warm();
    const s = stub();
    const r = await backfill(["--pace", "--push"], { publishState: s.publishState, now: () => at(TODAY, "05:10") });
    expect(r.code).toBe(0);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({
      root: path.resolve(root), date: TODAY, stagedDir: path.resolve(root, DEFAULT_OUT), cutoff: CUTOFF, dryRun: false, deadline: Number.POSITIVE_INFINITY,
    });
    expect(s.calls[0]!.now()).toBe(at(TODAY, "05:10").getTime());
    // With no repository given the option is absent, so publishState() uses its own default.
    expect("repo" in s.calls[0]!).toBe(false);
    expect(r.lines).toContain("Published 1 state files to main as 0123456.");
    expect(Object.keys(tree(staged()))).toEqual(["state/pace-weekly.json"]);
    expect(fs.existsSync(path.join(root, "content"))).toBe(false);
    expect(fs.existsSync(path.join(root, "logs", ".lock"))).toBe(false);
    expect(stateAt(staged("state", "pace-weekly.json")).weeks.at(-1)!.week_start).toBe(LAST_MONDAY);
  });

  it("hands the repository it was given to publishState() as it is", async () => {
    repo();
    await warm();
    const s = stub();
    const r = await backfill(["--pace", "--push"], { publishState: s.publishState, repo: "8gara8/example-repo" });
    expect(r.code, r.lines.join("\n")).toBe(0);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ repo: "8gara8/example-repo" });
  });

  it("holds the lock while it publishes: a lock file is there during publishState(), and gone after a failure too", async () => {
    repo();
    await warm();
    let during = false;
    const s = stub(null);
    const r = await backfill(["--pace", "--push"], {
      publishState: async (o) => {
        during = fs.existsSync(path.join(root, "logs", ".lock"));
        return s.publishState(o);
      },
    });
    expect(during).toBe(true);
    expect(r.code).toBe(0);
    expect(r.lines).toContain("Nothing was published: content/state/ already holds this state.");
    const failing = stub(null, Object.assign(new Error("push failed"), { code: "E_PUBLISH" }));
    const f = await backfill(["--pace", "--push"], { publishState: failing.publishState });
    expect(f.code).toBe(1);
    expect(f.lines).toContain("Nothing was published: E_PUBLISH.");
    expect(fs.existsSync(path.join(root, "logs", ".lock"))).toBe(false);
    const plain = stub(null, new Error("no remote here"));
    const g = await backfill(["--pace", "--push"], { publishState: plain.publishState });
    expect(g.lines).toContain("Nothing was published: no remote here.");
  });

  it("is refused while a run holds the lock: nothing is published, and the lock is not touched", async () => {
    repo();
    await warm();
    fs.mkdirSync(path.join(root, "logs"), { recursive: true });
    const held = JSON.stringify({ pid: process.pid, started: NOW.toISOString() });
    fs.writeFileSync(path.join(root, "logs", ".lock"), held);
    const s = stub();
    const r = await backfill(["--pace", "--push"], { publishState: s.publishState });
    expect(r.code).toBe(1);
    expect(r.lines).toContain(`The run lock is held (pid ${process.pid} since ${NOW.toISOString()}): nothing was published.`);
    expect(s.calls).toHaveLength(0);
    expect(read(path.join(root, "logs", ".lock"))).toBe(held);
  });

  it.each([["02:00"], ["03:00"], ["04:29"]])("is refused at %s Taipei, before any work: nothing fetched, nothing staged, publishState not called", async (hhmm) => {
    repo();
    world.serveWeeks(FIRST, LAST_MONDAY);
    const s = stub();
    const r = await backfill(["--pace", "--push"], { publishState: s.publishState, now: () => at(TODAY, hhmm) });
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toContain(`--push is refused from 02:00 to 04:30 Taipei (now ${hhmm})`);
    expect(s.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(root, "cache"))).toBe(false);
  });

  it.each([["01:59"], ["04:30"], ["12:00"]])("is allowed at %s Taipei (the refusal is from 02:00 up to 04:30)", async (hhmm) => {
    repo();
    await warm();
    const s = stub();
    const r = await backfill(["--pace", "--push"], { publishState: s.publishState, now: () => at(TODAY, hhmm) });
    expect(r.code, r.lines.join("\n")).toBe(0);
    expect(s.calls).toHaveLength(1);
  });

  it("is refused in a worktree, off main and with uncommitted changes, before any work and with no metrics file", async () => {
    repo();
    world.serveWeeks(FIRST, LAST_MONDAY);
    const s = stub();
    // Uncommitted changes (an untracked file counts).
    fs.writeFileSync(path.join(root, "notes.txt"), "x");
    let r = await backfill(["--pace", "--push"], { publishState: s.publishState });
    expect(r.code).toBe(1);
    expect(r.lines).toContain("--push needs a clean checkout: commit or stash the changes first.");
    fs.rmSync(path.join(root, "notes.txt"));
    // Off main.
    sh(root, "checkout", "-q", "-b", "other");
    r = await backfill(["--pace", "--push"], { publishState: s.publishState });
    expect(r.code).toBe(1);
    expect(r.lines).toContain("--push runs on main (this checkout is on other).");
    sh(root, "checkout", "-q", "main");
    // A worktree: its git directory is not the common one.
    const wt = `${root}-worktree`;
    roots.push(wt);
    sh(root, "worktree", "add", "-q", wt, "-b", "side");
    sh(wt, "checkout", "-q", "side");
    r = await backfill(["--pace", "--push"], { publishState: s.publishState }, wt);
    expect(r.code).toBe(1);
    expect(r.lines).toContain("--push runs in the main checkout, not a worktree.");
    expect(s.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(root, "cache"))).toBe(false);
    expect(fs.existsSync(path.join(wt, "cache"))).toBe(false);
    expect(fs.existsSync(path.join(root, "content"))).toBe(false);
  });

  it("is refused when the folder is no git repository", async () => {
    world.serveWeeks(FIRST, LAST_MONDAY);
    const s = stub();
    const r = await backfill(["--pace", "--push"], { publishState: s.publishState });
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toContain("--push needs the main checkout, and git could not be read here");
    expect(s.calls).toHaveLength(0);
  });

  it("is refused before any work when publishState() is not wired (scripts/publish.ts is P3's)", async () => {
    repo();
    world.serveWeeks(FIRST, LAST_MONDAY);
    const r = await backfill(["--pace", "--push"]);
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toContain("publishState() (scripts/publish.ts, P3), which is not wired here: nothing was done.");
    expect(fs.existsSync(path.join(root, "cache"))).toBe(false);
  });

  it("publishes nothing when the build ended from 03:00 to 04:30 (exit 1), keeps its answers, and a rerun from 04:30 publishes without fetching", async () => {
    repo();
    await warm();
    const stateFile = path.join(root, DEFAULT_OUT, "state", "pace-weekly.json");
    // The clock reads 01:30 until the build has staged its state, and 03:10 after.
    const clock = () => (fs.existsSync(stateFile) ? at(TODAY, "03:10") : at(TODAY, "01:30"));
    const s = stub();
    const r = await backfill(["--pace", "--push"], { publishState: s.publishState, now: clock });
    expect(r.code).toBe(1);
    expect(r.lines).toContain("The build ended at 03:10 Taipei, inside 03:00 to 04:30: nothing was published. Run the same command again from 04:30; today's answers are reused.");
    expect(s.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(root, "logs", ".lock"))).toBe(false);
    const answers = cachedAnswers();
    const later = stub();
    const again = await backfill(["--pace", "--push"], { publishState: later.publishState, now: () => at(TODAY, "04:30") });
    expect(again.code).toBe(0);
    expect(later.calls).toHaveLength(1);
    expect(cachedAnswers()).toEqual(answers);
  });

  it("publishes at the end of 04:30 and not at 04:29: the build's own end time decides", async () => {
    repo();
    await warm();
    const stateFile = path.join(root, DEFAULT_OUT, "state", "pace-weekly.json");
    const s = stub();
    // The clock reads 01:30 until the build has staged its state, and `hhmm` after; each call starts with no staged state, as a fresh run does.
    const code = async (hhmm: string): Promise<number> => {
      fs.rmSync(path.join(root, "cache", "staged"), { recursive: true, force: true });
      return (await backfill(["--pace", "--push"], { publishState: s.publishState, now: () => (fs.existsSync(stateFile) ? at(TODAY, hhmm) : at(TODAY, "01:30")) })).code;
    };
    expect(await code("04:29")).toBe(1);
    expect(await code("04:30")).toBe(0);
    expect(await code("02:59")).toBe(0);
    expect(await code("03:00")).toBe(1);
    expect(s.calls).toHaveLength(2);
  });
});

// ── --save-reference ─────────────────────────────────────────────────────────────────────────────

describe("--save-reference DIR (SPEC §10 P2 step 6)", () => {
  /** The template's content/ and answer cache, as a backfill with `--out content` left them. */
  function backfilled(): void {
    fs.cpSync(path.join(template.root, "content"), path.join(root, "content"), { recursive: true });
    warmCache();
  }

  it("writes the reference file and the 136 answers of the newest backfill edition in content/, byte-identically on a rerun", async () => {
    backfilled();
    const r = await backfill(["--save-reference", "fx"]);
    expect(r.code, r.lines.join("\n")).toBe(0);
    expect(r.lines[0]).toBe(`Reference of ${TODAY}: 136 answers for 34 weeks, and pace-reference.json (known_differences the defaults of scripts/lib/reference.ts).`);
    expect(r.lines[1]).toBe("Wrote 138 files to fx.");
    const first = tree(path.join(root, "fx"));
    expect(Object.keys(first)).toHaveLength(138);
    expect(Object.keys(first).filter((f) => f.startsWith("openalex/"))).toHaveLength(137);
    const again = await backfill(["--save-reference", "fx", "--edition", TODAY]);
    expect(again.code).toBe(0);
    expect(again.lines[0]).toContain("known_differences kept from the file there");
    expect(tree(path.join(root, "fx"))).toEqual(first);
  });

  it("chooses the newest edition whose manifest starts at the baseline, not a morning's (nine weeks) that is newer", async () => {
    backfilled();
    const manifest = InputsManifest.parse(readJson(path.join(root, "content", "metrics", "inputs", `${TODAY}.json`)));
    const morning = { ...manifest, date: "2026-10-23", openalex: manifest.openalex.filter((q) => q.week_start >= "2026-08-17") };
    fs.writeFileSync(path.join(root, "content", "metrics", "inputs", "2026-10-23.json"), `${JSON.stringify(morning)}\n`);
    fs.writeFileSync(path.join(root, "content", "metrics", "inputs", "notes.json"), "{");
    // An older edition whose manifest starts at the baseline too: the newest of the two is the one chosen.
    fs.writeFileSync(path.join(root, "content", "metrics", "inputs", "2026-10-21.json"), `${JSON.stringify({ ...manifest, date: "2026-10-21" })}\n`);
    const r = await backfill(["--save-reference", "fx"]);
    expect(r.code, r.lines.join("\n")).toBe(0);
    expect(r.lines[0]).toContain(`Reference of ${TODAY}:`);
  });

  it("takes the edition --edition names over the newest backfill's", async () => {
    backfilled();
    const r = await backfill(["--save-reference", "fx", "--edition", "2026-10-20"]);
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toContain("metrics/2026-10-20.json is missing");
    expect(fs.existsSync(path.join(root, "fx"))).toBe(false);
  });

  it("refuses when no edition starts at the baseline, and when the edition's files are missing", async () => {
    const r = await backfill(["--save-reference", "fx"]);
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toContain(`No edition in content/metrics/inputs/ starts at the baseline (${FIRST})`);
    const named = await backfill(["--save-reference", "fx", "--edition", TODAY]);
    expect(named.code).toBe(1);
    expect(named.lines.join("\n")).toContain(`metrics/${TODAY}.json is missing`);
    expect(fs.existsSync(path.join(root, "fx"))).toBe(false);
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

  it("runs main() when the file is the command (exit 2 and the usage text with no --pace), and does not when it is imported", () => {
    const direct = run(["scripts/backfill.ts"]);
    expect(direct).toMatchObject({ code: 2, stdout: "" });
    expect(direct.stderr).toContain(USAGE);
    const imported = run(["--input-type=module", "-e", "await import('./scripts/backfill.ts'); console.log('loaded');"]);
    expect(imported).toEqual({ code: 0, stdout: "loaded\n", stderr: "" });
  }, 60_000);
});
