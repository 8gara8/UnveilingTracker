// SPEC §5.4 as scripts/metrics.ts runs it, one morning after another: which weeks a morning fetches (the 9 newest always; an older firm week fetched
// before its last morning, or missing from the state, newest first, at most 13 a morning), what the answer cache gives back (an answer fetched on the
// run's own date, or on or after the week's last morning, is read and never fetched again), a week leaving the provisional span becoming firm with its
// last fetch, and the cutoff moving with the date. Answers come from the temporary fixture folder of tests/helpers/openalex-world.ts through
// `UT_FIXTURE_FEEDS`; the weeks fetched are read off the answer cache (`cache/openalex/<Monday>/`) and the manifest, never off the code under test.
// New for this project; Cyber has no weekly state.
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { addDays } from "@/lib/dates";
import { jsonText } from "@/lib/json";
import { InputsManifest, MetricsFile, PaceWeeklyFile, type PaceWeek } from "@/lib/schema/metrics";
import { paceQuery } from "@/scripts/lib/openalex";
import { runMetrics } from "@/scripts/metrics";
import { OpenAlexWorld, makeRoot, repoRoot } from "./helpers/openalex-world";

const config = loadConfig(path.join(repoRoot(), "config"));
const pv = { ai_terms: config.aiTerms.version, journals: config.journals.version, fields: config.fields.version };
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

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

const mondays = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addDays(m, 7)) out.push(m);
  return out;
};

/** A week's last morning: 64 days after its Sunday, 70 after its Monday (SPEC §5.4). */
const lastMorning = (monday: string): string => addDays(monday, 70);

/** The state of a series in which every week was fetched on its last morning: none is owed a refetch, and the newest 8 are provisional. */
function quiet(cutoff: string, updated: string): PaceWeeklyFile {
  const state = world.state(cutoff, updated, pv);
  return PaceWeeklyFile.parse({ ...state, weeks: state.weeks.map((w) => ({ ...w, fetched: lastMorning(w.week_start) > updated ? updated : lastMorning(w.week_start) })) });
}

function store(state: PaceWeeklyFile): void {
  fs.mkdirSync(path.join(root, "content", "state"), { recursive: true });
  fs.writeFileSync(path.join(root, "content", "state", "pace-weekly.json"), jsonText(state, PaceWeeklyFile));
}

const stored = (): PaceWeeklyFile => PaceWeeklyFile.parse(readJson(path.join(root, "content", "state", "pace-weekly.json")));

/** A morning at 03:20 Taipei on `date`, its three files copied into content/ as publish leaves them. */
async function morning(date: string): Promise<Awaited<ReturnType<typeof runMetrics>>> {
  const r = await runMetrics({ date, root, now: new Date(`${date}T03:20:00+08:00`), apiKey: null });
  if (r.code === 0 && fs.existsSync(path.join(root, "cache", "staged", date))) fs.cpSync(path.join(root, "cache", "staged", date), path.join(root, "content"), { recursive: true });
  return r;
}

/** The Mondays whose answers are in the cache, by the date they were fetched: `<Monday>/<kind>.<date>.<hash>.json`. */
function fetchedOn(date: string): string[] {
  const dir = path.join(root, "cache", "openalex");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().filter((week) => fs.readdirSync(path.join(dir, week)).some((f) => f.includes(`.${date}.`)));
}

const manifestWeeks = (date: string): string[] => {
  const manifest = InputsManifest.parse(readJson(path.join(root, "content", "metrics", "inputs", `${date}.json`)));
  return [...new Set(manifest.openalex.map((q) => q.week_start))];
};

const NINE = mondays("2026-08-17", "2026-10-12");

describe("an older firm week (SPEC §5.4)", () => {
  it("is fetched again when it was fetched before its last morning, and not when it was fetched on it or later", async () => {
    const state = quiet("2026-10-18", "2026-10-21");
    const early = "2026-03-02";
    const onTheDay = "2026-03-09";
    const after = "2026-03-16";
    const edit = (monday: string, fetched: string): PaceWeek => ({ ...state.weeks.find((w) => w.week_start === monday)!, fetched });
    const weeks = state.weeks.map((w) => [early, onTheDay, after].includes(w.week_start)
      ? edit(w.week_start, w.week_start === early ? addDays(lastMorning(early), -1) : w.week_start === onTheDay ? lastMorning(onTheDay) : addDays(lastMorning(after), 30))
      : w);
    store(PaceWeeklyFile.parse({ ...state, weeks }));
    world.revise(early, 40);
    world.serveWeeks("2026-03-02", "2026-10-12");

    const r = await morning("2026-10-22");
    expect(r.code).toBe(0);
    expect(fetchedOn("2026-10-22")).toEqual([early, ...NINE]);
    const after2 = stored();
    const got = new Map(after2.weeks.map((w) => [w.week_start, w]));
    expect(got.get(early)).toMatchObject({ fetched: "2026-10-22", provisional: false, ...world.pairs(early) });
    expect(got.get(early)!.all.physics).not.toEqual(state.weeks.find((w) => w.week_start === early)!.all.physics);
    expect(got.get(onTheDay)!.fetched).toBe(lastMorning(onTheDay));
    expect(got.get(after)!.fetched).toBe(addDays(lastMorning(after), 30));
    expect(manifestWeeks("2026-10-22")).toEqual([early, ...NINE]);
    expect(r.lines).toContain("Pace: 10 weeks fetched or read from the cache (40 requests, 0 cached, 220 credits).");
  });

  it("is fetched when it is missing from the state: the state ends short of the newest firm week", async () => {
    store(quiet("2026-06-28", "2026-07-01"));
    world.serveWeeks("2026-05-04", "2026-10-12");
    expect(stored().weeks.at(-1)!.week_start).toBe("2026-06-22");
    const before = stored();
    const r = await morning("2026-10-22");
    expect(r.code).toBe(0);
    expect(r.status).toBe("ok");
    const missing = mondays("2026-06-29", "2026-08-10");
    expect(missing).toHaveLength(7);
    // The weeks the old state fetched before their last morning (the 4th of July for the week of 2026-04-27, and so on) are owed too: newest first,
    // 13 older weeks in all, so the 7 missing weeks leave room for the 6 newest owed ones; the older ones wait.
    const owed = mondays("2026-05-18", "2026-06-22");
    expect(owed).toHaveLength(6);
    expect(fetchedOn("2026-10-22")).toEqual([...owed, ...missing, ...NINE]);
    expect(r.lines).toContain("Pace: 22 weeks fetched or read from the cache (88 requests, 0 cached, 484 credits).");
    const after = stored();
    expect(after.weeks.at(-1)!.week_start).toBe("2026-10-12");
    for (const m of missing) expect(after.weeks.find((w) => w.week_start === m)).toMatchObject({ fetched: "2026-10-22", provisional: false, ...world.pairs(m) });
    for (const m of owed) expect(after.weeks.find((w) => w.week_start === m)).toMatchObject({ fetched: "2026-10-22", provisional: false });
    // The weeks that waited keep what the old state held, with the provisional mark they no longer have (they left the span).
    for (const m of mondays("2026-04-27", "2026-05-11")) expect(after.weeks.find((w) => w.week_start === m)).toEqual({ ...before.weeks.find((w) => w.week_start === m)!, provisional: false });
  });

  it("is fetched newest first and at most 13 a morning: the older owed weeks wait, said in the log, and the state stays whole", async () => {
    const state = quiet("2026-10-18", "2026-10-21");
    const owed = mondays("2025-02-03", "2025-06-16");
    expect(owed).toHaveLength(20);
    store(PaceWeeklyFile.parse({ ...state, weeks: state.weeks.map((w) => (owed.includes(w.week_start) ? { ...w, fetched: addDays(lastMorning(w.week_start), -1) } : w)) }));
    world.serveWeeks("2025-01-06", "2026-10-12");
    const r = await morning("2026-10-22");
    expect(r.code).toBe(0);
    expect(fetchedOn("2026-10-22")).toEqual([...owed.slice(-13), ...NINE]);
    expect(r.lines).toContain("Pace: 7 older weeks are owed a refetch and wait for a later morning.");
    const after = stored();
    expect(after.weeks).toHaveLength(state.weeks.length);
    for (const m of owed.slice(0, 7)) expect(after.weeks.find((w) => w.week_start === m)!.fetched).toBe(addDays(lastMorning(m), -1));
    // The next morning takes the 7 that waited.
    world.serveWeeks("2026-10-12", "2026-10-12");
    const next = await morning("2026-10-23");
    expect(next.code).toBe(0);
    expect(fetchedOn("2026-10-23")).toEqual([...owed.slice(0, 7), ...NINE]);
    expect(next.lines.some((l) => l.includes("wait for a later morning"))).toBe(false);
  });

  it("is refetched after missed mornings: a week fetched on the last morning's eve, as the nine-week rule alone would leave it", async () => {
    // The morning of 2026-10-22 fetched the newest firm week 2026-08-17; no run followed until 2026-10-29, whose newest firm week is 2026-08-24.
    // 2026-08-17's last morning is 2026-10-26, so what the 22nd fetched is before it: the 29th fetches it again.
    store(quiet("2026-10-18", "2026-10-21"));
    world.serveWeeks("2026-08-10", "2026-10-19");
    await morning("2026-10-22");
    expect(stored().weeks.find((w) => w.week_start === "2026-08-17")!.fetched).toBe("2026-10-22");
    await morning("2026-10-29");
    expect(fetchedOn("2026-10-29")).toEqual(mondays("2026-08-17", "2026-10-19"));
    expect(stored().weeks.find((w) => w.week_start === "2026-08-17")!.fetched).toBe("2026-10-29");
  });
});

describe("a week leaving the provisional span (SPEC §5.4)", () => {
  it("becomes firm with its last fetch, and is not fetched again after its last morning", async () => {
    store(quiet("2026-10-18", "2026-10-21"));
    world.serveWeeks("2026-08-10", "2026-10-19");
    await morning("2026-10-22");
    for (const date of ["2026-10-23", "2026-10-24", "2026-10-25"]) await morning(date);
    // Monday 2026-10-26 still has the cutoff 2026-10-18: 2026-08-17 is the newest firm week for the last time.
    expect((await morning("2026-10-26")).code).toBe(0);
    expect(fetchedOn("2026-10-26")).toEqual(NINE);
    expect(stored().weeks.find((w) => w.week_start === "2026-08-17")).toMatchObject({ fetched: "2026-10-26", provisional: false });
    // On Tuesday the cutoff moves to 2026-10-25: the week of 2026-08-24 is the newest firm one, and 2026-08-17 keeps its last fetch.
    const tuesday = await morning("2026-10-27");
    expect(tuesday.code).toBe(0);
    const weeks = mondays("2026-08-24", "2026-10-19");
    expect(fetchedOn("2026-10-27")).toEqual(weeks);
    const after = stored();
    expect(after.weeks.at(-1)!.week_start).toBe("2026-10-19");
    expect(after.weeks.find((w) => w.week_start === "2026-08-17")).toMatchObject({ fetched: "2026-10-26", provisional: false });
    expect(after.weeks.find((w) => w.week_start === "2026-08-24")).toMatchObject({ fetched: "2026-10-27", provisional: false });
    expect(after.weeks.find((w) => w.week_start === "2026-08-31")).toMatchObject({ fetched: "2026-10-27", provisional: true });
    expect(after.weeks.filter((w) => w.provisional)).toHaveLength(8);
    expect(MetricsFile.parse(readJson(path.join(root, "content", "metrics", "2026-10-27.json"))).data_cutoff).toBe("2026-10-25");
  });
});

describe("the answer cache (SPEC §5.4: reused on the run's own date, or on or after a week's last morning)", () => {
  it("refetches an answer cached while its week was provisional on a later date, and reuses it for a rerun on the same date", async () => {
    store(quiet("2026-10-18", "2026-10-21"));
    world.serveWeeks("2026-08-10", "2026-10-19");
    await morning("2026-10-22");
    const first = fs.readdirSync(path.join(root, "cache", "openalex", "2026-10-12")).sort();
    expect(first).toHaveLength(4);
    // A later date: the provisional week 2026-10-12 is fetched again, with what OpenAlex says now.
    world.revise("2026-10-12", 25);
    world.serveWeek("2026-10-12");
    fs.rmSync(path.join(root, "content", "metrics"), { recursive: true });
    const later = await morning("2026-10-23");
    expect(later.lines).toContain("Pace: 9 weeks fetched or read from the cache (36 requests, 0 cached, 198 credits).");
    expect(fs.readdirSync(path.join(root, "cache", "openalex", "2026-10-12"))).toHaveLength(8);
    expect(stored().weeks.find((w) => w.week_start === "2026-10-12")).toMatchObject({ fetched: "2026-10-23", ...world.pairs("2026-10-12") });
    // The same date again: everything is read from the cache, and the answers cached on the 23rd are the ones used.
    world.revise("2026-10-12", 25);
    world.serveWeek("2026-10-12");
    fs.rmSync(path.join(root, "content", "metrics"), { recursive: true });
    const again = await morning("2026-10-23");
    expect(again.lines).toContain("Pace: 9 weeks fetched or read from the cache (0 requests, 36 cached, 0 credits).");
    expect(fs.readdirSync(path.join(root, "cache", "openalex", "2026-10-12"))).toHaveLength(8);
    expect(stored().weeks.find((w) => w.week_start === "2026-10-12")!.all.physics).not.toEqual(world.pairs("2026-10-12").all.physics);
  });

  it("reads an old week's answer from the cache when it was fetched on or after its last morning, never refreshing it", async () => {
    // A week owed because the state lacks it, whose answer is in the cache from a backfill run on its last morning: the morning reads that file.
    const state = quiet("2026-10-18", "2026-10-21");
    const week = "2026-03-02";
    store(PaceWeeklyFile.parse({ ...state, weeks: state.weeks.map((w) => (w.week_start === week ? { ...w, fetched: addDays(lastMorning(week), -1) } : w)) }));
    world.serveWeeks("2026-03-02", "2026-03-02");
    world.serveWeeks("2026-08-10", "2026-10-19");
    // The answer the cache holds was fetched on the week's last morning: reused by any later run, whatever the world says now.
    const { createOpenAlexClient } = await import("@/scripts/lib/openalex");
    const old = createOpenAlexClient({
      cacheDir: path.join(root, "cache", "openalex"), query: paceQuery(config.index), provisionalWeeks: 8, today: lastMorning(week), now: () => new Date(`${lastMorning(week)}T05:00:00+08:00`),
    });
    await old.fetchWeek(week);
    world.revise(week, 500);
    world.serveWeek(week);
    const r = await morning("2026-10-22");
    expect(r.code).toBe(0);
    expect(r.lines).toContain("Pace: 10 weeks fetched or read from the cache (36 requests, 4 cached, 198 credits).");
    expect(fetchedOn("2026-10-22")).toEqual(NINE);
    expect(stored().weeks.find((w) => w.week_start === week)).toMatchObject({ fetched: lastMorning(week) });
  });
});

describe("the data cutoff moves with the date (SPEC §4.1, §5.3)", () => {
  it.each([
    ["2026-10-19", "2026-10-11"], ["2026-10-20", "2026-10-18"], ["2026-10-24", "2026-10-18"], ["2026-10-26", "2026-10-18"], ["2026-10-27", "2026-10-25"],
  ])("a morning on %s has data to %s", async (date, cutoff) => {
    store(quiet(addDays(cutoff, -7), addDays(cutoff, -4)));
    world.serveWeeks("2026-06-01", addDays(cutoff, -6));
    const r = await morning(date);
    expect(r.code).toBe(0);
    expect(MetricsFile.parse(readJson(path.join(root, "content", "metrics", `${date}.json`))).data_cutoff).toBe(cutoff);
    expect(stored().weeks.at(-1)!.week_start).toBe(addDays(cutoff, -6));
  });
});
