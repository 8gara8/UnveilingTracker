// `npm run sources:check` (SPEC §8.10, scripts/collect.ts `checkFeeds()`, `formatCheckTable()` and `--check-feeds`): every registry entry read with collect's own
// readers, the table of nine columns, the exit code (1 on a priority-1 feed that failed, has no date or is stale), freshness judged at the clock, the newest arXiv
// list that the API already holds, bodies kept in cache/check/ and never in collect's cache/feeds/, `--id` and `--json`. The fixture morning's folder answers the
// feeds it holds; a fake fetcher answers the four data feeds it does not (one needs a file that cannot be committed), and every failure. Offline: nothing reaches a
// host. New for this project; the table and the cases follow Cyber's tests/sources-check.test.ts at the fork commit 3ced1fb, adapted.
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { arxivListFor, newestListedAnnouncement } from "@/lib/feeds/arxiv";
import { fetchFeed, type FetchResult } from "@/lib/feeds/http";
import { jsonText } from "@/lib/json";
import {
  CHECK_PROBE, checkFeeds, formatCheckTable, freshColumn, isProblem, main as collectMain, secondsText, type CheckRow,
} from "../scripts/collect";
import { arxivApiUrl, isCandidateFeed } from "../scripts/lib/feeds";
import { FEEDS_DIR, ROOT, answer, feedEntry, realConfig, removeTempDirs, retractionCsv, tempDir } from "./helpers/feed-bodies";

afterAll(() => removeTempDirs());
beforeEach(() => {
  delete process.env.UT_FIXTURE_FEEDS;
});
afterEach(() => {
  delete process.env.UT_FIXTURE_FEEDS;
});

const config = realConfig();
const SKIPPED = config.sources.arxiv_skipped;
const MORNING = Date.parse("2026-10-22T03:16:20+08:00");
const fixture = (rel: string): string => fs.readFileSync(path.join(FEEDS_DIR, rel), "utf8");

/** A temporary root with a copy of the config. */
function root(): string {
  const dir = tempDir("ut-check-");
  fs.cpSync(path.join(ROOT, "config"), path.join(dir, "config"), { recursive: true });
  return dir;
}

/** The probe the fixture morning's saved answers were made for (tests/helpers/feed-bodies.ts's `fixtureRun`). */
const PROBE = { ncts: ["NCT09990201", "NCT09990202", "NCT09990203"], dois: ["10.1000/ut-sample-rw-0001", "10.1000/ut-sample-rw-0002"] };

type Fetch = typeof fetchFeed;
type Opts = Parameters<Fetch>[1];

/**
 * A fetcher that answers the four data feeds the fixture folder does not hold (the OpenAlex probe, Crossref's updates, ClinicalTrials.gov, the Retraction Watch file),
 * lets every other request through to fixture mode, and records every address asked.
 */
function fetcher(over: (url: string) => FetchResult | null = () => null): { fetch: Fetch; urls: string[] } {
  const urls: string[] = [];
  const fetch = (async (url: string, opts: Opts) => {
    urls.push(url);
    const custom = over(url);
    if (custom !== null) return custom;
    if (url.startsWith("https://api.openalex.org/works?per-page=1")) return answer('{"meta":{"count":1},"results":[]}', { contentType: "application/json" });
    if (url.startsWith("https://api.crossref.org/works?filter=updates")) return answer(fixture("api/crossref-updates.json"), { contentType: "application/json" });
    if (url.startsWith("https://clinicaltrials.gov/api/v2/studies")) return answer(fixture("api/ctgov-studies.json"), { contentType: "application/json" });
    if (url.includes("retraction_watch.csv")) return answer(retractionCsv([{ date: "10/1/2026 0:00" }, { date: "9/1/2026 0:00" }]), { contentType: "text/csv" });
    return fetchFeed(url, opts);
  }) as Fetch;
  return { fetch, urls };
}

const check = (o: { id?: string; now?: number; fetch?: Fetch; r?: string } = {}) =>
  checkFeeds({ id: o.id, root: o.r ?? root(), now: () => o.now ?? MORNING, probe: PROBE, deps: { fetch: o.fetch ?? fetcher().fetch } });

const byId = (rows: readonly CheckRow[]): Map<string, CheckRow> => new Map(rows.map((r) => [r.id, r]));

// ── The fixture morning ──────────────────────────────────────────────────────────────────────────

describe("sources:check on the fixture morning", () => {
  it("reads every registry entry, in registry order, and every one that has a reader is OK; the one without a reader is SKIP and no problem", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const r = await check();
    expect(r.rows.map((x) => x.id)).toEqual(config.sources.feeds.map((f) => f.id));
    expect(r.rows.filter((x) => x.state !== "OK").map((x) => [x.id, x.state])).toEqual([["naer-terms", "SKIP"]]);
    expect(r.exitCode).toBe(0);
    expect(r.rows.find((x) => x.id === "naer-terms")).toMatchObject({ status: "-", bytes: 0, items: 0, newest: null, fresh: "-", problem: null });
  });

  it("gives each row its kind, priority, bytes, items and newest as the reader found them", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const rows = byId((await check()).rows);
    const math = rows.get("arxiv-math")!;
    expect([math.kind, math.priority, math.state, math.status, math.items, math.newest, math.fresh, math.problem]).toEqual(["api", 1, "OK", "ok", 2, "2026-10-21T08:00:00+08:00", "yes", null]);
    expect(math.bytes).toBe(fixture("arxiv/arxiv-math.xml").length);
    const nature = rows.get("journal-nature")!;
    expect([nature.items, nature.newest, nature.fresh]).toEqual([2, "2026-10-21T00:00:00.000Z", "yes"]);
    expect(rows.get("retraction-watch")!.items).toBeGreaterThan(0);
    expect(rows.get("openalex")).toMatchObject({ state: "OK", items: 1 });
    // A page feed whose items carry no date has no newest, and nothing to judge (it is not stale).
    expect([rows.get("lab-futurehouse")!.newest, rows.get("lab-futurehouse")!.fresh, rows.get("lab-futurehouse")!.state]).toEqual([null, "-", "OK"]);
  });

  it("reads with the real fetcher (the fixture folder's) when none is passed", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const r = await checkFeeds({ id: "journal-nature", root: root(), now: () => MORNING, probe: PROBE });
    expect(r.rows.map((x) => [x.id, x.state])).toEqual([["journal-nature", "OK"]]);
  });

  it("keeps the bodies in cache/check/, and writes nothing to collect's cache/feeds/", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const dir = root();
    await check({ r: dir });
    expect(fs.existsSync(path.join(dir, "cache", "feeds"))).toBe(false);
    const kept = fs.readdirSync(path.join(dir, "cache", "check", "feeds")).sort();
    expect(kept).toContain("journal-nature.xml");
    expect(fs.existsSync(path.join(dir, "packs"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "logs"))).toBe(false);
  });

  it("times each read on the run's clock: nothing on a clock that stands still, a whole number of its ticks on one that moves", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    expect((await check({ id: "journal-nature" })).rows[0]!.ms).toBe(0);
    let tick = MORNING;
    const moving = await checkFeeds({ id: "journal-nature", root: root(), now: () => (tick += 1000), probe: PROBE, deps: { fetch: fetcher().fetch } });
    const ms = moving.rows[0]!.ms;
    expect(ms).toBeGreaterThan(0);
    expect(ms % 1000).toBe(0);
    expect(formatCheckTable(moving.rows)).toContain(` ${secondsText(ms)} `);
  });

  it("judges a feed with no fresh_days by nothing: its fresh column is a dash though it holds dated items", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const nature = feedEntry("journal-nature");
    expect(nature.fresh_days).not.toBeNull();
    const dated = (await check({ id: "journal-nature" })).rows[0]!;
    expect([dated.newest, dated.fresh]).toEqual(["2026-10-21T00:00:00.000Z", "yes"]);
    const dir = root();
    const registry = path.join(dir, "config", "sources.yaml");
    const text = fs.readFileSync(registry, "utf8");
    const block = text.indexOf("id: journal-nature\n");
    const from = text.indexOf("fresh_days:", block);
    fs.writeFileSync(registry, `${text.slice(0, from)}fresh_days: null${text.slice(text.indexOf("\n", from))}`);
    const undated = (await check({ id: "journal-nature", r: dir })).rows[0]!;
    expect([undated.state, undated.newest, undated.fresh]).toEqual(["OK", "2026-10-21T00:00:00.000Z", "-"]);
  });

  it("is the same on a second run", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const a = await check();
    const b = await check();
    expect(b).toEqual(a);
  });
});

// ── The arXiv list that the API holds ────────────────────────────────────────────────────────────

describe("sources:check and the arXiv lists", () => {
  const entry = feedEntry("arxiv-math");
  const askedFor = (now: number): { usDate: string; url: string } => {
    const list = newestListedAnnouncement(now, SKIPPED);
    return { usDate: list.usDate, url: arxivApiUrl(entry.url, entry.id, list) };
  };

  it("asks for the newest list announced before the last midnight US Eastern, one request, never the listing feed first", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const f = fetcher();
    await check({ id: "arxiv-math", fetch: f.fetch });
    expect(f.urls).toEqual([askedFor(MORNING).url]);
    expect(askedFor(MORNING).usDate).toBe("2026-10-20");
  });

  it("follows the clock: on a Tuesday morning in Taipei it is Sunday's list (announced Monday in Taipei), on a Monday morning Thursday's (the list before the weekend)", () => {
    expect(newestListedAnnouncement(Date.parse("2026-10-27T03:16:20+08:00"), SKIPPED).usDate).toBe("2026-10-25");
    expect(newestListedAnnouncement(Date.parse("2026-10-26T03:16:20+08:00"), SKIPPED).usDate).toBe("2026-10-22");
    // The list of the last evening in New York is not in the API yet (it is added at midnight), so it is not the one asked for.
    expect(newestListedAnnouncement(Date.parse("2026-10-22T03:16:20+08:00"), SKIPPED).usDate).not.toBe("2026-10-21");
    // A skipped date is passed over.
    expect(arxivListFor("2026-11-26", SKIPPED)).toBeNull();
    expect(newestListedAnnouncement(Date.parse("2026-11-27T20:00:00Z"), SKIPPED).usDate).toBe("2026-11-25");
  });

  it("calls the feed's newest the announcement of that list, and a list with no entry no newest", async () => {
    const dir = tempDir("ut-check-folder-");
    const url = askedFor(MORNING).url;
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ [url]: { file: "empty.xml", content_type: "application/atom+xml" } }));
    fs.copyFileSync(path.join(FEEDS_DIR, "arxiv", "empty.xml"), path.join(dir, "empty.xml"));
    process.env.UT_FIXTURE_FEEDS = dir;
    const r = await check({ id: "arxiv-math" });
    expect(r.rows[0]).toMatchObject({ id: "arxiv-math", status: "ok", items: 0, newest: null, fresh: "-" });
  });
});

// ── The exit code and the states ─────────────────────────────────────────────────────────────────

describe("sources:check and its exit code", () => {
  const failing = (error: FetchResult["error"] = "http_503") => (): FetchResult => answer(null, { error });
  const lowPriority = config.sources.feeds.find((f) => f.priority === 3 && isCandidateFeed(f) && f.kind === "rss")!;

  it("exits 1 when a priority-1 feed fails, naming its error class, and says so in the problem column without the raw text", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const target = feedEntry("journal-nature");
    const r = await check({ fetch: fetcher((u) => (u === target.url ? failing()() : null)).fetch });
    const row = byId(r.rows).get("journal-nature")!;
    expect([row.state, row.status, row.items, row.fresh]).toEqual(["FAIL", "http_503", 0, "-"]);
    expect(row.problem).toMatch(/^Failed: /);
    expect(row.problem).not.toContain("raw detail");
    expect(isProblem(row)).toBe(true);
    expect(r.exitCode).toBe(1);
    expect(formatCheckTable(r.rows)).not.toContain("raw detail");
  });

  it("exits 0 when only a feed of priority 2 or 3 fails", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    expect(lowPriority.priority).toBe(3);
    const r = await check({ fetch: fetcher((u) => (u === lowPriority.url || u === lowPriority.fallback_url ? failing("timeout")() : null)).fetch });
    expect(byId(r.rows).get(lowPriority.id)).toMatchObject({ state: "FAIL", status: "timeout" });
    expect(r.exitCode).toBe(0);
    expect(isProblem(byId(r.rows).get(lowPriority.id)!)).toBe(false);
  });

  it("says in the problem column when a feed was read from its fallback address, and does not count that as a problem", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const base = fetcher();
    // The primary address fails, and the fallback answers with the body the fixture folder holds for the primary.
    const fetch = (async (u: string, o: Opts) => {
      if (u === lowPriority.url) return answer(null, { error: "http_503" });
      if (u === lowPriority.fallback_url) return fetchFeed(lowPriority.url, o);
      return base.fetch(u, o);
    }) as Fetch;
    const r = await check({ fetch });
    const row = byId(r.rows).get(lowPriority.id)!;
    expect([row.state, row.status, row.problem]).toEqual(["OK", "ok", "Fallback URL used."]);
    expect(isProblem(row)).toBe(false);
  });

  it("calls a feed whose newest item is older than its fresh_days STALE, with its age in days, and exits 1 for a priority-1 one", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const later = Date.parse("2026-11-30T03:16:20+08:00");
    const r = await check({ now: later });
    const nature = byId(r.rows).get("journal-nature")!;
    expect([nature.state, nature.status, nature.newest, nature.fresh]).toEqual(["STALE", "ok", "2026-10-21T00:00:00.000Z", "no (39 d)"]);
    expect(r.exitCode).toBe(1);
    // Judged at the clock: the same body is fresh on the morning it was made for.
    expect(byId((await check()).rows).get("journal-nature")!.fresh).toBe("yes");
  });

  it("calls a priority-1 feed that gives items with no readable date NODATE, and exits 1", async () => {
    const undated = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>A machine learning thing</title><link>https://doi.org/10.1038/ut-sample-0001</link></item></channel></rss>`;
    const target = feedEntry("journal-nature");
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const r = await check({ fetch: fetcher((u) => (u === target.url ? answer(undated, { contentType: "application/rss+xml" }) : null)).fetch });
    const row = byId(r.rows).get("journal-nature")!;
    expect([row.state, row.status, row.items, row.newest, row.fresh]).toEqual(["NODATE", "ok", 1, null, "-"]);
    expect(r.exitCode).toBe(1);
  });

  it("counts a reader that throws as a failed read (parse) rather than stopping the check", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const target = feedEntry("journal-science");
    const base = fetcher();
    const fetch = (async (u: string, o: Opts) => {
      if (u === target.url) throw new Error("a surprise with raw detail");
      return base.fetch(u, o);
    }) as Fetch;
    const lines: string[] = [];
    const r = await checkFeeds({ root: root(), now: () => MORNING, probe: PROBE, deps: { fetch, log: (l) => lines.push(l) } });
    const row = byId(r.rows).get("journal-science")!;
    expect([row.state, row.status]).toEqual(["FAIL", "parse"]);
    expect([row.bytes, row.items, row.newest, row.fresh]).toEqual([0, 0, null, "-"]);
    expect(lines.some((l) => l.startsWith("journal-science: the check read threw"))).toBe(true);
    // With no log passed, the same read still fails quietly.
    const quiet = await checkFeeds({ id: "journal-science", root: root(), now: () => MORNING, probe: PROBE, deps: { fetch } });
    expect(quiet.rows.map((x) => [x.state, x.status])).toEqual([["FAIL", "parse"]]);
    expect(r.rows.length).toBe(config.sources.feeds.length);
    expect(formatCheckTable(r.rows)).not.toContain("raw detail");
  });

  it("asks the two feeds that need ids for the probe it is given, and for the real ones when none is", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const f = fetcher();
    await check({ fetch: f.fetch });
    expect(f.urls.some((u) => u.startsWith("https://clinicaltrials.gov/") && u.includes("NCT09990201"))).toBe(true);
    expect(f.urls.some((u) => u.startsWith("https://api.crossref.org/works?filter=updates") && u.includes("10.1000"))).toBe(true);
    const g = fetcher();
    await checkFeeds({ root: root(), now: () => MORNING, deps: { fetch: g.fetch } });
    expect(CHECK_PROBE.ncts).toHaveLength(1);
    expect(g.urls.some((u) => u.startsWith("https://clinicaltrials.gov/") && u.includes(CHECK_PROBE.ncts[0]!))).toBe(true);
    expect(CHECK_PROBE.dois).toEqual(["10.1038/nature14539"]);
    expect(g.urls.some((u) => u.startsWith("https://api.crossref.org/works?filter=updates:10.1038/nature14539"))).toBe(true);
  });
});

// ── One entry, the guard ─────────────────────────────────────────────────────────────────────────

describe("sources:check for one entry", () => {
  it("reads only the entry asked for, and refuses an id the registry does not have", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const f = fetcher();
    const r = await check({ id: "journal-nature", fetch: f.fetch });
    expect(r.rows.map((x) => x.id)).toEqual(["journal-nature"]);
    expect(f.urls).toEqual([feedEntry("journal-nature").url]);
    await expect(check({ id: "no-such-feed" })).rejects.toThrow('sources:check: no registry entry "no-such-feed"');
  });

  it("refuses to run in a fixture folder outside a test run", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(checkFeeds({ root: root(), deps: { fetch: fetcher().fetch } })).rejects.toThrow(/UT_FIXTURE_FEEDS is set outside a test run/);
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});

// ── The table ────────────────────────────────────────────────────────────────────────────────────

describe("the table", () => {
  const row = (over: Partial<CheckRow> = {}): CheckRow => ({
    id: "alpha", kind: "rss", state: "OK", status: "ok", bytes: 1234, items: 5, records: 3, newest: "2026-10-21", fresh: "yes", priority: 1, requests: 1, ms: 1234, problem: null, ...over,
  });

  it("has the nine columns, each as wide as its widest cell, two spaces between, the last one unpadded, and the summary line after", () => {
    const t = formatCheckTable([row(), row({ id: "a-much-longer-id", state: "FAIL", status: "http_503", bytes: 0, items: 0, newest: null, fresh: "-", ms: 12_350, problem: "Failed: http_503." })]);
    expect(t.split("\n")).toEqual([
      "id                state  status    bytes  items  newest      fresh  time    problem",
      "alpha             OK     ok        1234   5      2026-10-21  yes    1.2 s   -",
      "a-much-longer-id  FAIL   http_503  0      0      -           -      12.4 s  Failed: http_503.",
      "1 of 2 entries ok; 1 priority-1 problem.",
      "",
    ]);
  });

  it("writes a time as seconds with one decimal, rounded half up on whole numbers, and a dash for an entry that was not read", () => {
    expect([0, 49, 50, 99, 100, 950, 999, 1000, 12_349, 12_350, 600_000].map(secondsText)).toEqual(
      ["0.0 s", "0.0 s", "0.1 s", "0.1 s", "0.1 s", "1.0 s", "1.0 s", "1.0 s", "12.3 s", "12.4 s", "600.0 s"],
    );
    expect(formatCheckTable([row({ state: "SKIP", ms: 5000 })]).split("\n")[1]).toMatch(/\s-\s+-$/);
  });

  it("counts the entries that were read, not the skipped, and says 'problems' except for one", () => {
    const t = formatCheckTable([row(), row({ id: "b", state: "SKIP", status: "-" }), row({ id: "c", state: "STALE", fresh: "no (9 d)" }), row({ id: "d", state: "NODATE", newest: null })]);
    expect(t.trimEnd().split("\n").at(-1)).toBe("1 of 3 entries ok; 2 priority-1 problems.");
    expect(formatCheckTable([row()]).trimEnd().split("\n").at(-1)).toBe("1 of 1 entries ok; 0 priority-1 problems.");
    expect(formatCheckTable([]).trimEnd().split("\n").at(-1)).toBe("0 of 0 entries ok; 0 priority-1 problems.");
  });

  it("does not count a problem of priority 2 or 3, and counts FAIL, NODATE and STALE of priority 1", () => {
    expect(isProblem(row({ state: "FAIL" }))).toBe(true);
    expect(isProblem(row({ state: "NODATE" }))).toBe(true);
    expect(isProblem(row({ state: "STALE" }))).toBe(true);
    expect(isProblem(row({ state: "OK" }))).toBe(false);
    expect(isProblem(row({ state: "SKIP" }))).toBe(false);
    expect(isProblem(row({ state: "FAIL", priority: 2 }))).toBe(false);
    expect(isProblem(row({ state: "STALE", priority: 3 }))).toBe(false);
  });

  it("writes the fresh column as yes, no (N d), or a dash", () => {
    const ref = Date.parse("2026-11-30T00:00:00Z");
    expect(freshColumn("OK", "2026-11-29T00:00:00Z", ref)).toBe("yes");
    expect(freshColumn("STALE", "2026-11-20T12:00:00Z", ref)).toBe("no (9 d)");
    expect(freshColumn("STALE", "2026-11-30T00:00:00Z", ref)).toBe("no (0 d)");
    expect(freshColumn("STALE", "2026-12-05T00:00:00Z", ref)).toBe("no (0 d)");
    expect(freshColumn("OK", null, ref)).toBe("-");
    expect(freshColumn("NODATE", null, ref)).toBe("-");
    expect(freshColumn("FAIL", "2026-11-20", ref)).toBe("-");
    expect(freshColumn("SKIP", "2026-11-20", ref)).toBe("-");
    expect(freshColumn("STALE", "not a date", ref)).toBe("-");
    // A feed with no fresh_days is judged by nothing, so its newest date is no proof of freshness.
    expect(freshColumn("OK", "2026-11-29T00:00:00Z", ref, false)).toBe("-");
    expect(freshColumn("OK", "2026-11-29T00:00:00Z", ref, true)).toBe("yes");
  });
});

// ── The command line ─────────────────────────────────────────────────────────────────────────────

describe("npm run sources:check (--check-feeds)", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  };

  it("prints the table and exits with the check's code; --json prints the rows as JSON", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const dir = root();
    const t = io();
    // The real clock makes the fixtures stale and the data feeds unreachable, so the code is the table's own, whichever it is.
    const code = await collectMain(["--check-feeds", "--id", "journal-nature"], { io: t.io, root: dir });
    const text = t.out.join("\n");
    expect(text.split("\n")[0]).toMatch(/^id\s+state\s+status\s+bytes\s+items\s+newest\s+fresh\s+time\s+problem$/);
    expect(text).toMatch(/\n[01] of 1 entries ok; [01] priority-1 problems?\.$/);
    expect(code).toBe(/ 1 priority-1 problem\.$/.test(text) ? 1 : 0);
    const j = io();
    const jcode = await collectMain(["--check-feeds", "--id", "journal-nature", "--json"], { io: j.io, root: dir });
    const rows = JSON.parse(j.out.join("\n")) as CheckRow[];
    expect(rows.map((r) => r.id)).toEqual(["journal-nature"]);
    expect(jcode).toBe(rows.some(isProblem) ? 1 : 0);
    expect(j.out.join("\n")).toBe(jsonText(rows).trimEnd());
  });

  it("exits 2 for an id the registry does not have, naming it", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const t = io();
    expect(await collectMain(["--check-feeds", "--id", "nope"], { io: t.io, root: root() })).toBe(2);
    expect(t.err.join("\n")).toContain('no registry entry "nope"');
  });

  it("exits 2 in a fixture folder outside a test run, before it reads anything", async () => {
    const t = io();
    expect(await collectMain(["--check-feeds"], { io: t.io, env: { UT_FIXTURE_FEEDS: FEEDS_DIR }, root: root() })).toBe(2);
    expect(t.err.join("\n")).toContain("UT_FIXTURE_FEEDS is set outside a test run");
  });
});
