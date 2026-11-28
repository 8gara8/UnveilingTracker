// The feed readers of scripts/lib/feeds.ts and the cache they leave, scripts/lib/feed-cache.ts (SPEC §4.13, §4.14, §5.7, §8.3, §8.10, §9.8): every
// reader against a hand-made body in the real shape (fixtures/feeds/, answered by UT_FIXTURE_FEEDS, or a fetcher a test injects as `ctx.fetch`),
// the queries character for character, arXiv's cache cases, the budgets, the fallback, the failure shapes, strings read from a feed as data, and
// the use of the per-host queues. No test reaches a host: the offline guard (tests/setup/offline.ts) would fail the file. Every sample is invented.
// New for this project; the harness cases follow Cyber's tests/feeds.test.ts at the fork commit 3ced1fb, adapted.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arxivListFor, usDateOf, windowAnnouncement } from "@/lib/feeds/arxiv";
import { cachePaths } from "@/lib/feeds/cache";
import {
  FEED_MAX_BYTES, FEED_TIMEOUTS, fetchBudget, fetchFeed, rateQueueOf, resetRateQueues, setHttpClock, type FetchOptions, type FetchResult, type HttpClock,
} from "@/lib/feeds/http";
import { FeedParseError } from "@/lib/feeds/types";
import { byCodeUnit } from "@/lib/ids";
import { sha256Hex } from "@/lib/json";
import type { RequestRecord } from "@/lib/schema/metrics";
import type { FeedEntry } from "@/lib/schema/registry";
import {
  ARXIV_MAX_RESULTS, ARXIV_QUERIES, BIORXIV_PAGE, CROSSREF_ROWS, CROSSREF_UPDATES_BATCH, CROSSREF_UPDATES_ROWS, CTGOV_BATCH, PAGE_FEEDS, PUBMED_BATCH, PUBMED_RETMAX,
  ReadFail, UNZIPPED_CAP, arxivApiUrl, biorxivUrl, cacheWrite, crossrefJournalUrl, crossrefUpdatesUrl, ctgovUrl, feedCtx, get, hasBudget, holdingsText, isCandidateFeed,
  isSmcReactionPath, journalIdOfFeed, newestCachedArxiv, parseAnthropic, parseArc, parseBiorxiv, parseClass, parseCrossrefNotices, parseCrossrefWorks, parseCtgov,
  parseErdos, parseEurekAlert, parseFutureHouse, parseIsomorphic, parseLila, parseMathlibStats, parseMetaFair, parsePeriodic, parsePubmedAbstracts, parsePubmedSearch,
  parsePubmedSummary, parseRcsbCount, parseRcsbUnreleased, parseRetractionWatch, parseSmcPage, plain, probeDataFeed, pubmedFetchUrl, pubmedSearchUrl, pubmedSummaryUrl,
  rcsbCountUrl, rcsbQuery, readArxiv, readArxivList, readBiorxiv, readCrossrefJournals, readCrossrefUpdates, readCtgov, readFeed, readMathlib, readPageFeed, readPdbStructures,
  readPubmed, readRcsbCounts, readRcsbUnreleased, readRetractionWatch, readRssFeed, readSmc, readerKind, spendOf, textDate,
  type FeedCtx, type FeedRun, type Spend,
} from "../scripts/lib/feeds";
import {
  ARXIV_KEEP_DAYS, cachedCtgov, cachedMathlib, cachedPdb, cachedRetractions, candidateFacts, dataFacts, feedIndexEntry, feedVerdict, freshNewest, pruneArxivLists,
  FeedIndexEntry, FeedIndexFile, readFeedIndex, staleArxivLists, writeFeedIndex, type FeedFacts,
} from "../scripts/lib/feed-cache";
import {
  FEEDS_DIR, FIXTURE_DATE, RETRACTION_HEADER, answer, feedEntry, fixtureRun, gzipJson, realConfig, removeTempDirs, retractionCsv, tempDir, writeFixtureDir,
} from "./helpers/feed-bodies";

// ── What the tests share ─────────────────────────────────────────────────────────────────────────

let root: string;
beforeEach(() => {
  root = tempDir("ut-feed-readers-");
  delete process.env.UT_FIXTURE_FEEDS;
});
afterEach(() => {
  delete process.env.UT_FIXTURE_FEEDS;
  setHttpClock(null);
  resetRateQueues();
  vi.unstubAllGlobals();
});
afterAll(() => removeTempDirs());

/** Answers every request from a fixture folder (the repository's by default) the way a fixture run does. */
const fromFixtures = (dir: string = FEEDS_DIR): void => {
  process.env.UT_FIXTURE_FEEDS = dir;
};

interface Call {
  url: string;
  opts: FetchOptions;
}

/** A fetcher that records each call and answers with `reply(url, n, opts)`, `n` counting the calls to that URL from 1. */
function fakeFetch(reply: (url: string, n: number, opts: FetchOptions) => FetchResult | Promise<FetchResult>): { calls: Call[]; fetch: typeof fetchFeed; urls: () => string[] } {
  const calls: Call[] = [];
  const fetch = (async (url: string, opts: FetchOptions = {}) => {
    calls.push({ url, opts });
    return reply(url, calls.filter((c) => c.url === url).length, opts);
  }) as typeof fetchFeed;
  return { calls, fetch, urls: () => calls.map((c) => c.url) };
}

/** A recording fetcher that passes every request on to `fetchFeed()` (so fixture mode answers it). */
const recording = () => fakeFetch((url, _n, opts) => fetchFeed(url, opts));

/** The failure a retried request gives: two attempts when the call allows a retry, one when it was sent with no retry delay. */
const failing = (error: FetchResult["error"] = "timeout") => (_url: string, _n: number, opts: FetchOptions): FetchResult =>
  answer(null, { error, attempts: opts.retryDelayMs === 0 ? 1 : 2 });

type TestCtx = FeedCtx & { lines: string[] };

/** A context on the temporary root with the log kept in `lines`. */
function ctxFor(over: Partial<FeedCtx> = {}): TestCtx {
  const lines: string[] = [];
  return Object.assign(feedCtx(root, { log: (l: string) => lines.push(l), ...over }), { lines });
}

/** The repository's fixture bytes of a file under fixtures/feeds/. */
const fixtureBytes = (rel: string): Buffer => fs.readFileSync(path.join(FEEDS_DIR, rel));
const fixtureText = (rel: string): string => fixtureBytes(rel).toString("utf8");

/** The body the cache holds for a feed (`cache/feeds/<name>`), or null. */
const cached = (name: string): string | null => {
  try {
    return fs.readFileSync(path.join(root, "cache", "feeds", name), "utf8");
  } catch {
    return null;
  }
};

const arxivCacheFile = (feedId: string, usDate: string): string => cachePaths(root).arxivList(feedId, usDate);

/** The morning's arXiv list for a registry feed and a US date. */
const listOf = (usDate: string) => {
  const list = arxivListFor(usDate, realConfig().sources.arxiv_skipped);
  if (!list) throw new Error(`no announcement on ${usDate}`);
  return list;
};

const MATH_WINDOW_URL = "https://export.arxiv.org/api/query?search_query=%28cat:math*+OR+cat:cs.IT+OR+cat:math-ph%29+AND+submittedDate:%5B202610191800+TO+202610201800%5D&start=0&max_results=2000&sortBy=submittedDate&sortOrder=ascending";
const MATH_SUN_URL = "https://export.arxiv.org/api/query?search_query=%28cat:math*+OR+cat:cs.IT+OR+cat:math-ph%29+AND+submittedDate:%5B202610151800+TO+202610161800%5D&start=0&max_results=2000&sortBy=submittedDate&sortOrder=ascending";
const MATH_MON_URL = "https://export.arxiv.org/api/query?search_query=%28cat:math*+OR+cat:cs.IT+OR+cat:math-ph%29+AND+submittedDate:%5B202610161800+TO+202610191800%5D&start=0&max_results=2000&sortBy=submittedDate&sortOrder=ascending";

// ── The harness ──────────────────────────────────────────────────────────────────────────────────

describe("feedCtx()", () => {
  it("is the real fetcher, a fresh 240 s budget, no deadline and the cache paths of the root", () => {
    const ctx = feedCtx(root);
    expect(ctx.fetch).toBe(fetchFeed);
    expect(ctx.budget.capMs).toBe(240_000);
    expect(ctx.budget.started).toBeNull();
    expect(ctx.deadline).toBe(Number.POSITIVE_INFINITY);
    expect(ctx.paths.feedIndex).toBe(cachePaths(root).feedIndex);
    expect(Math.abs(ctx.now() - Date.now())).toBeLessThan(5_000);
    expect(() => ctx.log("a line")).not.toThrow();
  });

  it("gives each context a budget of its own, and lets a caller override any part", () => {
    expect(feedCtx(root).budget).not.toBe(feedCtx(root).budget);
    const budget = fetchBudget(1_000);
    const ctx = feedCtx(root, { budget, deadline: 5, now: () => 7 });
    expect(ctx.budget).toBe(budget);
    expect([ctx.deadline, ctx.now()]).toEqual([5, 7]);
  });
});

describe("get()", () => {
  const entry = { id: "a-feed", budget: 3 };

  it("counts every attempt against the feed's own spend and logs a failure with its raw detail", async () => {
    const f = fakeFetch(() => answer(null, { error: "timeout", attempts: 2 }));
    const ctx = ctxFor({ fetch: f.fetch });
    const spend = spendOf(entry);
    const r = await get(ctx, spend, "https://example.org/ut-sample/a");
    expect([r.ok, r.error, spend.used]).toEqual([false, "timeout", 2]);
    expect(ctx.lines).toEqual(["fetch failed: https://example.org/ut-sample/a (timeout): a fake failure with raw detail"]);
    await get(ctx, spend, "https://example.org/ut-sample/a");
    expect(spend.used).toBe(4);
    expect(hasBudget(spend)).toBe(false);
  });

  it("names the HTTP status in the log when the answer had one", async () => {
    const f = fakeFetch(() => answer(null, { error: "http_503", status: 503 }));
    const ctx = ctxFor({ fetch: f.fetch });
    await get(ctx, spendOf(entry), "https://example.org/ut-sample/b");
    expect(ctx.lines[0]).toBe("fetch failed: https://example.org/ut-sample/b (http_503, HTTP 503): a fake failure with raw detail");
  });

  it("sends the last request left in the budget with no retry delay, and the others with the fetcher's own", async () => {
    const f = fakeFetch(() => answer("ok", { contentType: "text/plain" }));
    const ctx = ctxFor({ fetch: f.fetch });
    const spend = spendOf({ id: "x", budget: 3 });
    for (let i = 0; i < 3; i++) await get(ctx, spend, `https://example.org/ut-sample/${i}`);
    expect(f.calls.map((c) => c.opts.retryDelayMs)).toEqual([undefined, undefined, 0]);
    const single = spendOf({ id: "y", budget: 1 });
    await get(ctx, single, "https://example.org/ut-sample/single");
    expect(f.calls.at(-1)!.opts.retryDelayMs).toBe(0);
  });

  it("sends a request that has a fallback behind it with no retry when the retry would leave the fallback no request", async () => {
    const f = fakeFetch(() => answer("ok", { contentType: "text/plain" }));
    const ctx = ctxFor({ fetch: f.fetch });
    const cases: [number, number, number, number | undefined][] = [[2, 0, 1, 0], [3, 0, 1, undefined], [3, 1, 1, 0], [2, 0, 0, undefined], [1, 0, 1, 0], [4, 0, 2, undefined], [3, 0, 2, 0]];
    for (const [max, used, reserve, retry] of cases) {
      f.calls.length = 0;
      await get(ctx, { id: "r", max, used }, "https://example.org/ut-sample/reserve", { reserve });
      expect(f.calls[0]!.opts.retryDelayMs, `max ${max} used ${used} reserve ${reserve}`).toBe(retry);
    }
  });

  it("sends nothing once the budget is spent: no fetch, no attempt, a log line", async () => {
    const f = fakeFetch(() => answer("ok"));
    const ctx = ctxFor({ fetch: f.fetch });
    const spend: Spend = { id: "spent", max: 2, used: 2 };
    const r = await get(ctx, spend, "https://example.org/ut-sample/c");
    expect(f.calls).toHaveLength(0);
    expect([r.ok, r.error, r.attempts, r.body]).toEqual([false, "timeout", 0, null]);
    expect(spend.used).toBe(2);
    expect(ctx.lines).toEqual(["spent: the request budget of 2 is spent; https://example.org/ut-sample/c was not fetched"]);
  });

  it("starts the shared budget at the first request and gives the fetcher the nearer of its deadline and the run's", async () => {
    const f = fakeFetch(() => answer("ok"));
    const budget = fetchBudget(240_000);
    const ctx = ctxFor({ fetch: f.fetch, budget, now: () => 1_000 });
    await get(ctx, spendOf({ id: "d", budget: 5 }), "https://example.org/ut-sample/d");
    expect(budget.started).toBe(1_000);
    expect(f.calls[0]!.opts.deadline).toBe(241_000);
    const near = ctxFor({ fetch: f.fetch, budget: fetchBudget(240_000), now: () => 1_000, deadline: 5_000 });
    await get(near, spendOf({ id: "d", budget: 5 }), "https://example.org/ut-sample/e");
    expect(f.calls[1]!.opts.deadline).toBe(5_000);
  });

  it("uses the default timeout and body cap, and the named ones where a feed needs more", async () => {
    const f = fakeFetch(() => answer("ok"));
    const ctx = ctxFor({ fetch: f.fetch });
    const spend = spendOf({ id: "caps", budget: 9 });
    await get(ctx, spend, "https://example.org/ut-sample/1");
    await get(ctx, spend, "https://example.org/ut-sample/2", { limit: "arxivList", max: "arxivList" });
    await get(ctx, spend, "https://example.org/ut-sample/3", { limit: "retractionWatch", max: "retractionWatch" });
    expect(f.calls.map((c) => [c.opts.timeoutMs, c.opts.maxBytes])).toEqual([
      [FEED_TIMEOUTS.default, FEED_MAX_BYTES.default], [FEED_TIMEOUTS.arxivList, FEED_MAX_BYTES.arxivList], [FEED_TIMEOUTS.retractionWatch, FEED_MAX_BYTES.retractionWatch],
    ]);
    expect([FEED_TIMEOUTS.default, FEED_TIMEOUTS.arxivList, FEED_TIMEOUTS.retractionWatch]).toEqual([15_000, 45_000, 90_000]);
    expect([FEED_MAX_BYTES.default, FEED_MAX_BYTES.arxivList, FEED_MAX_BYTES.retractionWatch]).toEqual([5 * 1024 * 1024, 10 * 1024 * 1024, 128 * 1024 * 1024]);
  });
});

describe("cacheWrite()", () => {
  it("writes the file, makes its folders and leaves no temporary file behind", () => {
    const ctx = ctxFor();
    const file = path.join(root, "cache", "feeds", "deep", "x.json");
    cacheWrite(ctx, file, "{}");
    expect(fs.readFileSync(file, "utf8")).toBe("{}");
    expect(fs.readdirSync(path.dirname(file))).toEqual(["x.json"]);
    cacheWrite(ctx, file, Buffer.from([1, 2, 3]));
    expect([...fs.readFileSync(file)]).toEqual([1, 2, 3]);
  });

  it("writes nothing at or past the deadline", () => {
    const file = path.join(root, "late.json");
    cacheWrite(ctxFor({ now: () => 100, deadline: 100 }), file, "x");
    cacheWrite(ctxFor({ now: () => 101, deadline: 100 }), file, "x");
    expect(fs.existsSync(file)).toBe(false);
    cacheWrite(ctxFor({ now: () => 99, deadline: 100 }), file, "x");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("never throws: a folder that cannot be made is logged", () => {
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "a file where a folder is needed");
    const ctx = ctxFor();
    expect(() => cacheWrite(ctx, path.join(blocker, "x.json"), "x")).not.toThrow();
    expect(ctx.lines).toHaveLength(1);
    expect(ctx.lines[0]).toMatch(/^cache: could not write x\.json: /);
  });

  it("leaves no earlier file under the name when the write fails, so nothing later reads bytes this run did not keep", () => {
    const file = path.join(root, "kept.json");
    fs.writeFileSync(file, "an earlier body");
    fs.mkdirSync(`${file}.tmp-${process.pid}`);
    const ctx = ctxFor();
    cacheWrite(ctx, file, "a new body");
    expect(fs.existsSync(file)).toBe(false);
    expect(ctx.lines[0]).toMatch(/^cache: could not write kept\.json: /);
  });
});

describe("parseClass() and ReadFail", () => {
  it("is the class a parser or a reader named, and `parse` for anything else", () => {
    expect(parseClass(new FeedParseError("schema", "m"))).toBe("schema");
    expect(parseClass(new FeedParseError("empty", "m"))).toBe("empty");
    expect(parseClass(new ReadFail("too_large", "m"))).toBe("too_large");
    expect(parseClass(new Error("m"))).toBe("parse");
    expect(parseClass("a string")).toBe("parse");
    expect(parseClass(null)).toBe("parse");
    const e = new ReadFail("too_large", "over");
    expect([e.name, e.message, e.errorClass, e instanceof Error]).toEqual(["ReadFail", "over", "too_large", true]);
  });
});

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

describe("plain()", () => {
  it("is empty for anything that is not text or a number, and squashes plain text", () => {
    for (const v of [null, undefined, {}, [], true, ""]) expect(plain(v)).toBe("");
    expect(plain(5)).toBe("5");
    expect(plain("  a \n\t b  ")).toBe("a b");
    expect(plain("5 < 6 and 7 > 3")).toBe("5 < 6 and 7 > 3");
  });

  it("takes markup, entities and a JATS title out of what a feed gave", () => {
    expect(plain("<p>Hello <b>world</b> &amp; more</p>")).toBe("Hello world & more");
    expect(plain("<jats:title>Abstract</jats:title><jats:p>Text here</jats:p>")).toBe("Text here");
    expect(plain("<jats:p>One</jats:p><jats:p>Two</jats:p>")).toBe("One Two");
    expect(plain("a &lt;b&gt; c")).toBe("a <b> c");
    expect(plain("&amp;amp;")).toBe("&amp;");
  });

  it("drops a script's text and keeps no tag", () => {
    const out = plain('<script>alert("x")</script>Visible <img src="https://evil.example/p.png" onerror="x()"> text');
    expect(out).toBe("Visible text");
    expect(out).not.toMatch(/[<>]|evil|alert/);
  });
});

describe("textDate()", () => {
  it("reads every form of day the feeds print", () => {
    const forms: [string, string][] = [
      ["2026-11-27", "2026-11-27"], ["27-Nov-2026", "2026-11-27"], ["08 Oct 2026", "2026-10-08"], ["Nov 17, 2026", "2026-11-17"], ["November 20, 2026", "2026-11-20"],
      ["2026 Nov 27", "2026-11-27"], ["9 September 2026", "2026-09-09"], ["Sept 3, 2026", "2026-09-03"], ["March 9th, 2026", "2026-03-09"],
      ["Published 2026-10-21T04:00:00Z", "2026-10-21"],
    ];
    for (const [text, day] of forms) expect(textDate(text), text).toBe(day);
  });

  it("never invents a date: a day that does not exist, a month alone, or no date at all gives null", () => {
    for (const text of ["31 Feb 2026", "2026 Nov", "1st", "", "no date here", "2026-13-01", "Feb 30, 2026"]) expect(textDate(text), text).toBeNull();
  });

  it("skips an impossible day and takes the next one the text writes", () => {
    expect(textDate("on 2026-02-30 and 5 Mar 2026")).toBe("2026-03-05");
  });
});

describe("journalIdOfFeed() and isSmcReactionPath()", () => {
  it("is the id after the prefix, except for the two the spec shortens, and null for any other feed", () => {
    expect(journalIdOfFeed("journal-nature")).toBe("nature");
    expect(journalIdOfFeed("journal-jgr-atmospheres")).toBe("jgr-atmospheres");
    expect(journalIdOfFeed("journal-grl")).toBe("geophysical-research-letters");
    expect(journalIdOfFeed("journal-hts")).toBe("hts-theological-studies");
    expect(journalIdOfFeed("lab-openai")).toBeNull();
    expect(journalIdOfFeed("journal-")).toBeNull();
    expect(journalIdOfFeed("crossref-journals")).toBeNull();
  });

  it("maps every registry journal feed to a journal of config/journals.json", () => {
    const c = realConfig();
    const ids = new Set(c.journals.journals.map((j) => j.id));
    for (const f of c.sources.feeds.filter((x) => x.id.startsWith("journal-"))) expect(ids.has(journalIdOfFeed(f.id)!), f.id).toBe(true);
  });

  it("keeps the two reaction paths and nothing else", () => {
    expect(isSmcReactionPath("/expert-reaction-to-a-study/")).toBe(true);
    expect(isSmcReactionPath("/experts-react-to-a-statement/")).toBe(true);
    for (const p of ["/roundup/", "/", "/news/expert-reaction-to-x/", "/expert-reaction", "/EXPERT-REACTION-TO-x/"]) expect(isSmcReactionPath(p), p).toBe(false);
  });
});

// ── arXiv (SPEC §4.13 "arXiv's calendar") ────────────────────────────────────────────────────────

describe("arxivApiUrl(): the query, character for character", () => {
  const base = "https://export.arxiv.org/api/query";
  const tail = "&start=0&max_results=2000&sortBy=submittedDate&sortOrder=ascending";
  const window = "submittedDate:%5B202610191800+TO+202610201800%5D";
  const list = listOf("2026-10-20");

  it("is each feed's category group, AND the list's submittedDate range, from the first entry in order of submission", () => {
    const expected: Record<string, string> = {
      "arxiv-math": `%28cat:math*+OR+cat:cs.IT+OR+cat:math-ph%29+AND+${window}`,
      "arxiv-physics": `%28cat:physics*+OR+cat:hep*+OR+cat:gr-qc+OR+cat:nucl*%29+AND+${window}`,
      "arxiv-astro-ph": `cat:astro-ph*+AND+${window}`,
      "arxiv-cond-mat": `cat:cond-mat*+AND+${window}`,
      "arxiv-quant-ph": `cat:quant-ph+AND+${window}`,
      "arxiv-q-bio": `cat:q-bio*+AND+${window}`,
      "arxiv-physics-chem-ph": `cat:physics.chem-ph+AND+${window}`,
      "arxiv-stat-ml": `cat:stat.ML+AND+${window}`,
    };
    expect(Object.keys(expected).sort(byCodeUnit)).toEqual(Object.keys(ARXIV_QUERIES).sort(byCodeUnit));
    for (const [id, query] of Object.entries(expected)) expect(arxivApiUrl(base, id, list), id).toBe(`${base}?search_query=${query}${tail}`);
    expect(ARXIV_MAX_RESULTS).toBe(2000);
  });

  it("names the aliases the wildcard misses: cs.IT and math-ph for math, and hep*, gr-qc and nucl* beside physics*", () => {
    expect(ARXIV_QUERIES["arxiv-math"]).toBe("(cat:math* OR cat:cs.IT OR cat:math-ph)");
    expect(ARXIV_QUERIES["arxiv-physics"]).toBe("(cat:physics* OR cat:hep* OR cat:gr-qc OR cat:nucl*)");
  });

  it("escapes a space as + and the parentheses and brackets as %XX, and nothing else", () => {
    const url = arxivApiUrl(base, "arxiv-math", list);
    expect(url).not.toMatch(/[ ()[\]]/);
    expect(url).toContain("%28cat:math*+OR");
    expect(url).toContain("math-ph%29+AND+");
    expect(url).toContain("submittedDate:%5B202610191800+TO+202610201800%5D&");
    expect(url).toContain("cat:cs.IT");
  });

  it("takes the end minute of the deadline in US summer time (18:00 UTC) and in winter time (19:00 UTC)", () => {
    expect(arxivApiUrl(base, "arxiv-quant-ph", listOf("2026-12-01"))).toContain("submittedDate:%5B202611301900+TO+202612011900%5D");
    expect(arxivApiUrl(base, "arxiv-quant-ph", listOf("2026-10-20"))).toContain("submittedDate:%5B202610191800+TO+202610201800%5D");
  });

  it("asks a Monday's list for the whole weekend, and the list after a skipped announcement from the deadline before it", () => {
    expect(arxivApiUrl(base, "arxiv-quant-ph", listOf("2026-10-19"))).toContain("submittedDate:%5B202610161800+TO+202610191800%5D");
    // 2026-10-12 is skipped, so Tuesday's list starts at the Friday deadline the Sunday list would have started at.
    expect(arxivApiUrl(base, "arxiv-quant-ph", listOf("2026-10-13"))).toContain("submittedDate:%5B202610091800+TO+202610131800%5D");
  });

  it("refuses a feed with no category query, whatever its name (no prototype key is a feed)", () => {
    for (const id of ["arxiv-bogus", "constructor", "__proto__", "toString", "hasOwnProperty", ""]) {
      expect(() => arxivApiUrl(base, id, list), id).toThrow(/no category query/);
    }
  });
});

describe("readArxiv() on the fixture morning", () => {
  const entry = feedEntry("arxiv-math");

  it("reads the window's list and the one lookback list the budget of 2 allows, and says which it could not read", async () => {
    fromFixtures();
    const f = recording();
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readArxiv(entry, ctx, fixtureRun());
    expect(f.urls()).toEqual([MATH_WINDOW_URL, MATH_SUN_URL]);
    expect([r.ok, r.error, r.requests, r.urlUsed, r.fallbackUsed, r.triedFallback]).toEqual([true, null, 2, MATH_WINDOW_URL, false, false]);
    const d = r.data!;
    expect(d.items.map((i) => i.arxiv)).toEqual(["2610.99001", "2610.99002"]);
    expect(d.items[0]).toMatchObject({
      title: "A small neural network guesses the sign of a sample invariant", url: "https://arxiv.org/abs/2610.99001", published_at: "2026-10-21T08:00:00+08:00",
      categories: ["math.CO", "cs.LG"], doi: null, journal: null, types: [], journal_id: null, kind: null,
    });
    expect(d.items[1]).toMatchObject({ doi: "10.1000/ut-sample-arxiv-0002", categories: ["math.NT"] });
    expect(d.lookback.map((i) => [i.arxiv, i.published_at])).toEqual([["2610.99003", "2026-10-19T08:00:00+08:00"]]);
    expect([d.total, d.announcement, d.newest]).toEqual([2, "2026-10-21T08:00:00+08:00", "2026-10-21T08:00:00+08:00"]);
    expect(d.unread).toEqual(["2026-10-19"]);
    expect(r.note).toBe("The arXiv list of 2026-10-19 was not read: the request budget is spent.");
    expect(r.requests).toBeLessThanOrEqual(entry.budget);
  });

  it("keeps each list it read as the feed's file for the US date, byte for byte, and writes none for the list it did not read", async () => {
    fromFixtures();
    const r = await readArxiv(entry, ctxFor(), fixtureRun());
    expect(fs.readFileSync(arxivCacheFile("arxiv-math", "2026-10-20"), "utf8")).toBe(fixtureText("arxiv/arxiv-math.xml"));
    expect(fs.readFileSync(arxivCacheFile("arxiv-math", "2026-10-18"), "utf8")).toBe(fixtureText("arxiv/arxiv-math.2026-10-18.xml"));
    expect(fs.existsSync(arxivCacheFile("arxiv-math", "2026-10-19"))).toBe(false);
    expect(r.sha256).toBe(sha256Hex(fixtureBytes("arxiv/arxiv-math.xml")));
    expect(r.fetched.map((x) => [x.url, x.sha256])).toEqual([
      [MATH_WINDOW_URL, sha256Hex(fixtureBytes("arxiv/arxiv-math.xml"))], [MATH_SUN_URL, sha256Hex(fixtureBytes("arxiv/arxiv-math.2026-10-18.xml"))],
    ]);
    expect(r.bytes).toBe(fixtureBytes("arxiv/arxiv-math.xml").length + fixtureBytes("arxiv/arxiv-math.2026-10-18.xml").length);
    expect(r.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
  });

  it("asks the API with the long timeout and the large body cap of an arXiv list, and the run's deadline", async () => {
    fromFixtures();
    const f = recording();
    await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ lookback: false }));
    expect(f.calls).toHaveLength(1);
    expect([f.calls[0]!.opts.timeoutMs, f.calls[0]!.opts.maxBytes]).toEqual([45_000, 10 * 1024 * 1024]);
    expect(typeof f.calls[0]!.opts.deadline).toBe("number");
  });

  it("reads every one of the eight feeds within its budget of 2, and gives each its own window list", async () => {
    fromFixtures();
    const expectedFirst: Record<string, string> = {
      "arxiv-math": "2610.99001", "arxiv-physics": "2610.99011", "arxiv-astro-ph": "", "arxiv-cond-mat": "", "arxiv-quant-ph": "", "arxiv-q-bio": "", "arxiv-physics-chem-ph": "", "arxiv-stat-ml": "",
    };
    for (const id of Object.keys(expectedFirst)) {
      const f = recording();
      const r = await readArxiv(feedEntry(id), ctxFor({ fetch: f.fetch }), fixtureRun());
      expect(r.ok, id).toBe(true);
      expect(f.calls.length, id).toBeLessThanOrEqual(feedEntry(id).budget);
      expect(r.requests, id).toBeLessThanOrEqual(feedEntry(id).budget);
      expect(r.data!.items.length, id).toBeGreaterThan(0);
      if (expectedFirst[id]) expect(r.data!.items[0]!.arxiv, id).toBe(expectedFirst[id]);
      expect(r.data!.announcement, id).toBe("2026-10-21T08:00:00+08:00");
    }
  });

  it("dates every entry by its announcement, never by the time the paper was submitted", async () => {
    fromFixtures();
    const r = await readArxiv(feedEntry("arxiv-physics"), ctxFor(), fixtureRun({ lookback: false }));
    expect(r.data!.items.map((i) => i.published_at)).toEqual(["2026-10-21T08:00:00+08:00"]);
    expect(fixtureText("arxiv/arxiv-physics.xml")).toContain("<published>2026-10-13T11:00:00Z</published>");
  });
});

describe("readArxiv(): the mornings with no list", () => {
  const entry = feedEntry("arxiv-math");

  it("asks for nothing on a Sunday morning, a Monday morning and the morning a skipped announcement would have reached, and none of them is a failure", async () => {
    fromFixtures();
    for (const date of ["2026-10-25", "2026-10-26", "2026-10-14"]) {
      expect(windowAnnouncement(date, realConfig().sources.arxiv_skipped), date).toBeNull();
      const f = recording();
      const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ date, lookback: false }));
      expect(f.calls, date).toHaveLength(0);
      expect([r.ok, r.error, r.requests, r.urlUsed, r.sha256, r.note, r.fetched, r.triedFallback, r.fallbackUsed], date).toEqual([true, null, 0, null, null, null, [], false, false]);
      expect(r.data, date).toEqual({ items: [], lookback: [], newest: null, total: 0, announcement: null, unread: [] });
    }
  });

  it("reads the lookback from the cache on such a morning, and the feed's newest list is the newest in the cache, so it is not stale after a holiday", async () => {
    fromFixtures();
    // Monday 2026-10-26: its window is Saturday, and its lookback holds Thursday 2026-10-22's list (Friday has none).
    fs.mkdirSync(path.dirname(arxivCacheFile("arxiv-math", "2026-10-22")), { recursive: true });
    fs.copyFileSync(path.join(FEEDS_DIR, "arxiv", "arxiv-math.2026-10-18.xml"), arxivCacheFile("arxiv-math", "2026-10-22"));
    const f = recording();
    const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ date: "2026-10-26" }));
    expect(f.calls).toHaveLength(0);
    expect([r.ok, r.requests]).toEqual([true, 0]);
    expect(r.data!.items).toEqual([]);
    expect(r.data!.announcement).toBeNull();
    expect(r.data!.lookback.map((i) => [i.arxiv, i.published_at])).toEqual([["2610.99003", "2026-10-23T08:00:00+08:00"]]);
    expect(r.data!.newest).toBe("2026-10-23T08:00:00+08:00");
  });

  it("an announcement with no entry is a valid empty list: no failure, nothing kept, no announcement in the pack", async () => {
    fromFixtures();
    // Wednesday 2026-10-21: its window is Monday's list, which the API answers with no entry.
    const f = recording();
    const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ date: "2026-10-21" }));
    expect(f.urls()).toEqual([MATH_MON_URL, MATH_SUN_URL]);
    expect([r.ok, r.error]).toEqual([true, null]);
    expect(r.data!.items).toEqual([]);
    expect([r.data!.total, r.data!.announcement]).toEqual([0, null]);
    expect(fs.existsSync(arxivCacheFile("arxiv-math", "2026-10-19"))).toBe(false);
    expect(r.data!.lookback.map((i) => i.arxiv)).toEqual(["2610.99003"]);
    expect(r.data!.newest).toBe("2026-10-19T08:00:00+08:00");
  });
});

describe("readArxiv(): the cache of lists (SPEC §4.13)", () => {
  const entry = feedEntry("arxiv-math");
  const windowFile = () => arxivCacheFile("arxiv-math", "2026-10-20");

  it("reads a list it kept again without a request: only the lists not in the cache are asked for", async () => {
    fromFixtures();
    await readArxiv(entry, ctxFor(), fixtureRun());
    const f = recording();
    const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(f.urls()).toEqual([MATH_MON_URL]);
    expect(r.requests).toBe(1);
    expect(r.data!.items.map((i) => i.arxiv)).toEqual(["2610.99001", "2610.99002"]);
    expect(r.data!.lookback.map((i) => i.arxiv)).toEqual(["2610.99003"]);
    expect(r.data!.unread).toEqual([]);
    expect(r.note).toBeNull();
    expect(r.sha256).toBe(sha256Hex(fixtureBytes("arxiv/arxiv-math.xml")));
    expect(r.fetched).toHaveLength(1);
    expect(r.urlUsed).toBeNull();
  });

  it("asks for nothing at all when every list is in the cache", async () => {
    fromFixtures();
    await readArxiv(entry, ctxFor(), fixtureRun());
    fs.copyFileSync(path.join(FEEDS_DIR, "arxiv", "arxiv-math.xml"), arxivCacheFile("arxiv-math", "2026-10-19"));
    const f = recording();
    const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(f.calls).toHaveLength(0);
    expect([r.ok, r.requests]).toEqual([true, 0]);
    expect(r.data!.unread).toEqual([]);
    expect(r.data!.lookback.map((i) => i.arxiv as string).sort(byCodeUnit)).toEqual(["2610.99001", "2610.99002", "2610.99003"]);
  });

  it("removes a cached file that does not parse, and fetches the list again", async () => {
    fromFixtures();
    fs.mkdirSync(path.dirname(windowFile()), { recursive: true });
    fs.writeFileSync(windowFile(), "<<< this is not an Atom answer");
    const f = recording();
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readArxiv(entry, ctx, fixtureRun({ lookback: false }));
    expect(f.urls()).toEqual([MATH_WINDOW_URL]);
    expect(r.data!.items).toHaveLength(2);
    expect(fs.readFileSync(windowFile(), "utf8")).toBe(fixtureText("arxiv/arxiv-math.xml"));
    expect(ctx.lines.some((l) => l.startsWith("arxiv: the cached arxiv-math.2026-10-20.xml "))).toBe(true);
  });

  it("removes a cached file that holds no entry (an empty answer is never ours), and fetches the list again", async () => {
    fromFixtures();
    fs.mkdirSync(path.dirname(windowFile()), { recursive: true });
    fs.writeFileSync(windowFile(), fixtureText("arxiv/empty.xml"));
    const f = recording();
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readArxiv(entry, ctx, fixtureRun({ lookback: false }));
    expect(f.urls()).toEqual([MATH_WINDOW_URL]);
    expect(r.data!.items).toHaveLength(2);
    expect(ctx.lines).toContain("arxiv: the cached arxiv-math.2026-10-20.xml holds no entry; fetching it again.");
  });

  it("keeps no answer that has no entry, whichever list it was", async () => {
    fromFixtures();
    await readArxiv(feedEntry("arxiv-physics"), ctxFor(), fixtureRun());
    const names = fs.readdirSync(cachePaths(root).arxivDir).sort(byCodeUnit);
    expect(names).toEqual(["arxiv-physics.2026-10-20.xml"]);
  });

  it("uses a list the API gave in part for the morning, notes it, and does not keep it for a later lookback", async () => {
    const partial = fixtureText("arxiv/arxiv-math.xml").replace("<opensearch:totalResults>2<", "<opensearch:totalResults>5<");
    expect(partial).not.toBe(fixtureText("arxiv/arxiv-math.xml"));
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { body: partial, content_type: "application/atom+xml" } }));
    const r = await readArxiv(entry, ctxFor(), fixtureRun({ lookback: false }));
    expect(r.ok).toBe(true);
    expect(r.data!.items).toHaveLength(2);
    expect(r.note).toBe("arXiv: the list of 2026-10-20 was read in part (2 of 5 entries).");
    expect(fs.existsSync(windowFile())).toBe(false);
  });

  it("reads a truncated answer as the part it holds, notes it, and does not keep it", async () => {
    const whole = fixtureBytes("arxiv/arxiv-math.xml");
    const cut = whole.subarray(0, whole.toString("utf8").indexOf("<entry>", whole.toString("utf8").indexOf("<entry>") + 10) + 40);
    const f = fakeFetch(() => answer(cut, { contentType: "application/atom+xml" }));
    const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ lookback: false }));
    expect(r.ok).toBe(true);
    expect(r.data!.items).toHaveLength(1);
    expect(r.note).toBe("arXiv: the list of 2026-10-20 was read in part (1 of 2 entries).");
    expect(fs.existsSync(windowFile())).toBe(false);
  });

  it("does not write the cache past the run's deadline, and still returns what it read", async () => {
    fromFixtures();
    let t = 1_000;
    const ctx = ctxFor({ now: () => t, deadline: 1_500 });
    t = 2_000;
    const r = await readArxiv(entry, ctx, fixtureRun({ lookback: false }));
    expect(r.ok).toBe(true);
    expect(r.data!.items).toHaveLength(2);
    expect(fs.existsSync(windowFile())).toBe(false);
  });
});

describe("readArxiv(): the listing fallback and the failures", () => {
  const entry = feedEntry("arxiv-math");
  const LISTING = "https://rss.arxiv.org/atom/math";
  const listing = () => fixtureBytes("arxiv/listing-math.xml");

  it("reads the feed's listing when the API fails, drops the revisions of older papers, dates the entry by the announcement and keeps the list", async () => {
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 }, [LISTING]: { body: listing(), content_type: "application/atom+xml" } }));
    const f = recording();
    const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ lookback: false }));
    expect(f.urls()).toEqual([MATH_WINDOW_URL, LISTING]);
    expect([r.ok, r.requests, r.urlUsed, r.fallbackUsed, r.triedFallback]).toEqual([true, 2, LISTING, true, true]);
    expect(r.data!.items.map((i) => [i.arxiv, i.published_at])).toEqual([["2610.99001", "2026-10-21T08:00:00+08:00"]]);
    expect(r.data!.announcement).toBe("2026-10-21T08:00:00+08:00");
    expect(fs.readFileSync(arxivCacheFile("arxiv-math", "2026-10-20"), "utf8")).toBe(listing().toString("utf8"));
  });

  it("takes the listing feed's own header (id, announce type, `Abstract:`) off each summary, on the first read and on a read back from the cache, and keeps a cross-list and drops a replace-cross", async () => {
    const header = (id: string, type: string) => `arXiv:${id}v1 Announce Type: ${type} \nAbstract: `;
    const body = fixtureText("arxiv/listing-math.xml")
      .replace("We train a small neural network on invented examples.", `${header("2610.99001", "cross")}We train a small neural network on invented examples.`)
      .replace("A revised version of an older invented paper.", `${header("2610.99004", "replace-cross")}A revised version of an older invented paper.`)
      .replace("<arxiv:announce_type>new<", "<arxiv:announce_type>cross<")
      .replace("<arxiv:announce_type>replace<", "<arxiv:announce_type>replace-cross<");
    expect(body).toContain("Announce Type: cross");
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 }, [LISTING]: { body, content_type: "application/atom+xml" } }));
    const first = await readArxiv(entry, ctxFor(), fixtureRun({ lookback: false }));
    expect(first.data!.items.map((i) => [i.arxiv, i.abstract])).toEqual([["2610.99001", "We train a small neural network on invented examples."]]);
    const f = recording();
    const again = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ lookback: false }));
    expect(f.urls()).toEqual([]);
    expect(again.data!.items.map((i) => [i.arxiv, i.abstract])).toEqual([["2610.99001", "We train a small neural network on invented examples."]]);
  });

  it("takes the header off whatever its letter case or spacing, with no space after `Abstract:` too", async () => {
    const text = "We train a small neural network on invented examples.";
    for (const head of ["ARXIV:2610.99001V1 ANNOUNCE TYPE: NEW   ABSTRACT:   ", "arXiv:2610.99001v1 Announce Type:new\nAbstract:", "arXiv:2610.99001v1 Announce Type: replace-cross Abstract: "]) {
      const body = fixtureText("arxiv/listing-math.xml").replace(text, `${head}${text}`).replace("<arxiv:announce_type>replace<", "<arxiv:announce_type>new<");
      fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 }, [LISTING]: { body, content_type: "application/atom+xml" } }));
      root = tempDir("ut-feed-readers-header-");
      const r = await readArxiv(entry, ctxFor(), fixtureRun({ lookback: false }));
      expect(r.data!.items.filter((i) => i.arxiv === "2610.99001").map((i) => i.abstract), head).toEqual([text]);
    }
  });

  it("gives the same abstract on the first read of an API list and on its read back: the strip is made on every list, since a cached list does not say which feed wrote it", async () => {
    const api = fixtureText("arxiv/arxiv-math.xml");
    const first = /<summary>([^<]*)<\/summary>/.exec(api)![1]!;
    const prefixed = api.replace(first, `arXiv:2610.00001v1 Announce Type: new Abstract: ${first}`);
    expect(prefixed).not.toBe(api);
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { body: prefixed, content_type: "application/atom+xml" } }));
    const a = await readArxiv(entry, ctxFor(), fixtureRun({ lookback: false }));
    const f = recording();
    const b = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ lookback: false }));
    expect(f.urls()).toEqual([]);
    expect(b.data!.items.map((i) => i.abstract)).toEqual(a.data!.items.map((i) => i.abstract));
    expect(a.data!.items.map((i) => i.abstract)).toContain(first.trim());
  });

  it("takes off only a header at the start of a summary: the same words inside an abstract stay, and an abstract that begins with no header is unchanged", async () => {
    const inside = "We cite arXiv:2610.00001v1 Announce Type: new Abstract: as a header in the middle of the text.";
    const body = fixtureText("arxiv/listing-math.xml").replace("We train a small neural network on invented examples.", inside);
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 }, [LISTING]: { body, content_type: "application/atom+xml" } }));
    const r = await readArxiv(entry, ctxFor(), fixtureRun({ lookback: false }));
    expect(r.data!.items.map((i) => i.abstract)).toEqual([inside]);
  });

  it("refuses a listing built before the announcement, which holds an earlier list: the read fails as schema", async () => {
    const old = listing().toString("utf8").replace("<updated>2026-10-21T04:00:00Z</updated>", "<updated>2026-10-20T04:00:00Z</updated>");
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 }, [LISTING]: { body: old, content_type: "application/atom+xml" } }));
    const r = await readArxiv(entry, ctxFor(), fixtureRun({ lookback: false }));
    expect([r.ok, r.error, r.triedFallback, r.data]).toEqual([false, "schema", true, null]);
    expect(fs.existsSync(arxivCacheFile("arxiv-math", "2026-10-20"))).toBe(false);
  });

  it("fails with the error of the last URL tried when the API and the listing both fail, within the budget", async () => {
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 } }));
    const f = recording();
    const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ lookback: false }));
    expect([r.ok, r.error, r.triedFallback, r.urlUsed, r.sha256, r.data]).toEqual([false, "dns", true, LISTING, null, null]);
    expect(f.urls()).toEqual([MATH_WINDOW_URL, LISTING]);
  });

  it("never sends a lookback list to the listing feed, and a lookback list it cannot read does not fail the feed", async () => {
    fromFixtures(writeFixtureDir({
      [MATH_WINDOW_URL]: { body: fixtureBytes("arxiv/arxiv-math.xml"), content_type: "application/atom+xml" },
      [MATH_SUN_URL]: { error: "timeout" },
      [LISTING]: { body: listing(), content_type: "application/atom+xml" },
    }));
    const f = recording();
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readArxiv(entry, ctx, fixtureRun());
    expect(f.urls()).toEqual([MATH_WINDOW_URL, MATH_SUN_URL]);
    expect(r.ok).toBe(true);
    expect(r.data!.items).toHaveLength(2);
    expect(r.data!.unread.sort(byCodeUnit)).toEqual(["2026-10-18", "2026-10-19"]);
    expect(ctx.lines).toContain("arxiv-math: the lookback list of 2026-10-18 was not read (timeout)");
    expect(r.note).toBe("The arXiv list of 2026-10-19 was not read: the request budget is spent.");
  });

  it("fails the feed only when the window's list cannot be read, with the class of the failure and the raw detail in the log only", async () => {
    const f = fakeFetch(failing("timeout"));
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readArxiv(entry, ctx, fixtureRun());
    expect([r.ok, r.error, r.data]).toEqual([false, "timeout", null]);
    expect(r.note ?? "").not.toMatch(/raw detail/);
    expect(ctx.lines.some((l) => l.includes("a fake failure with raw detail"))).toBe(true);
    expect(f.calls.length).toBeLessThanOrEqual(entry.budget);
  });

  it("uses a context's own budget of requests: a budget spent before the read gives a timeout, not a hang", async () => {
    const f = fakeFetch(() => answer(fixtureBytes("arxiv/arxiv-math.xml")));
    const spend: Spend = { id: "arxiv-math", max: 2, used: 2 };
    const r = await readArxivList(entry, ctxFor({ fetch: f.fetch }), spend, listOf("2026-10-20"), { fallback: true });
    expect(f.calls).toHaveLength(0);
    expect([r.ok, r.error, r.source, r.items]).toEqual([false, "timeout", "none", []]);
    expect(r.note).toBe("The arXiv list of 2026-10-20 was not read: the request budget is spent.");
  });
});

describe("readArxivList()", () => {
  const entry = feedEntry("arxiv-math");

  it("says where each list came from: the API, then the cache", async () => {
    fromFixtures();
    const spend = spendOf(entry);
    const first = await readArxivList(entry, ctxFor(), spend, listOf("2026-10-20"), { fallback: true });
    expect([first.ok, first.source, first.entries, first.items.length, first.urlUsed, first.fallbackUsed]).toEqual([true, "api", 2, 2, MATH_WINDOW_URL, false]);
    expect(first.sha256).toBe(sha256Hex(fixtureBytes("arxiv/arxiv-math.xml")));
    const second = await readArxivList(entry, ctxFor(), spendOf(entry), listOf("2026-10-20"), { fallback: true });
    expect([second.ok, second.source, second.entries, second.urlUsed, second.fetched]).toEqual([true, "cache", 2, null, []]);
    expect(second.bytes).toBe(fixtureBytes("arxiv/arxiv-math.xml").length);
  });

  it("with no fallback, a failed API answer is a failure with no second request", async () => {
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 } }));
    const f = recording();
    const spend = spendOf(entry);
    const r = await readArxivList(entry, ctxFor({ fetch: f.fetch }), spend, listOf("2026-10-20"), { fallback: false });
    expect(f.urls()).toEqual([MATH_WINDOW_URL]);
    expect([r.ok, r.error, r.triedFallback, spend.used]).toEqual([false, "http_503", false, 1]);
  });
});

describe("newestCachedArxiv()", () => {
  const skipped = realConfig().sources.arxiv_skipped;
  const put = (feedId: string, usDate: string, text: string) => {
    const file = arxivCacheFile(feedId, usDate);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  it("is null when there is no cache folder or no list of the feed", () => {
    expect(newestCachedArxiv(ctxFor(), "arxiv-math", skipped)).toBeNull();
    put("arxiv-physics", "2026-10-20", fixtureText("arxiv/arxiv-physics.xml"));
    expect(newestCachedArxiv(ctxFor(), "arxiv-math", skipped)).toBeNull();
  });

  it("is the announcement of the newest list that parses and holds an entry, for this feed's files only", () => {
    put("arxiv-math", "2026-10-18", fixtureText("arxiv/arxiv-math.2026-10-18.xml"));
    expect(newestCachedArxiv(ctxFor(), "arxiv-math", skipped)).toBe("2026-10-19T08:00:00+08:00");
    put("arxiv-math", "2026-10-20", "<<< not an answer");
    put("arxiv-math", "2026-10-19", fixtureText("arxiv/empty.xml"));
    put("arxiv-math", "2026-10-23", fixtureText("arxiv/arxiv-math.xml"));
    put("arxiv-math", "2026-10-12", fixtureText("arxiv/arxiv-math.xml"));
    put("arxiv-physics", "2026-10-21", fixtureText("arxiv/arxiv-physics.xml"));
    fs.writeFileSync(`${arxivCacheFile("arxiv-math", "2026-10-21")}.tmp-123`, fixtureText("arxiv/arxiv-math.xml"));
    expect(newestCachedArxiv(ctxFor(), "arxiv-math", skipped)).toBe("2026-10-19T08:00:00+08:00");
    put("arxiv-math", "2026-10-20", fixtureText("arxiv/arxiv-math.xml"));
    expect(newestCachedArxiv(ctxFor(), "arxiv-math", skipped)).toBe("2026-10-21T08:00:00+08:00");
  });
});

describe("readArxiv(): the morning after the Thanksgiving skip", () => {
  const entry = feedEntry("arxiv-math");
  const skipped = realConfig().sources.arxiv_skipped;
  const MONDAY = "2026-11-30";
  const run = () => fixtureRun({ date: MONDAY, window: { start: "2026-11-29T03:15:00+08:00", end: "2026-11-30T03:15:00+08:00" } });
  const refMs = Date.parse("2026-11-30T03:15:00+08:00");

  it("asks for no list, because there is none to announce, and is not stale: the newest list held is Wednesday's, 3.76 days old, inside the feed's fresh_days", async () => {
    expect(skipped).toContain("2026-11-26");
    expect(entry.fresh_days).toBe(5);
    const file = arxivCacheFile("arxiv-math", "2026-11-25");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fixtureText("arxiv/arxiv-math.xml"));
    const f = recording();
    const r = await readArxiv(entry, ctxFor({ fetch: f.fetch }), run());
    expect(f.urls()).toEqual([]);
    expect([r.ok, r.requests, r.data!.items, r.data!.total, r.data!.announcement, r.data!.unread]).toEqual([true, 0, [], 0, null, []]);
    expect(r.data!.newest).toBe("2026-11-26T09:00:00+08:00");
    const age = (refMs - Date.parse(r.data!.newest!)) / 86_400_000;
    expect(age).toBeGreaterThan(3.7);
    expect(age).toBeLessThan(3.8);
    expect(feedVerdict(entry, candidateFacts(entry, r, refMs), refMs)).toEqual({ state: "ok", label: "OK", note: null });
  });

  it("is stale only when the cache holds nothing newer than the fresh_days allow: with no list at all the feed has no date (NODATE)", async () => {
    const r = await readArxiv(entry, ctxFor({ fetch: recording().fetch }), run());
    expect(r.data!.newest).toBeNull();
    const v = feedVerdict(entry, candidateFacts(entry, r, refMs), refMs);
    expect([v.state, v.label]).toEqual(["stale", "NODATE"]);
  });
});

// ── bioRxiv and medRxiv ──────────────────────────────────────────────────────────────────────────

/** One record of the details API, as it gives them: strings for the version and the date. */
const bioRecord = (n: number, over: Record<string, unknown> = {}) => ({
  doi: `10.1101/2026.10.20.${100_000 + n}`, title: `A sample paper ${n}`, date: "2026-10-20", version: "1", category: "genomics", abstract: `An invented abstract ${n}.`, ...over,
});
const bioPage = (records: unknown[], count: number, total: number | null, cursor = 0): string =>
  JSON.stringify({ messages: [{ status: "ok", cursor, count, ...(total === null ? {} : { total }) }], collection: records });

describe("biorxivUrl() and parseBiorxiv()", () => {
  it("is details/<server>/<from>/<to>/<cursor>, both days included", () => {
    expect(biorxivUrl("https://api.biorxiv.org/details/biorxiv", "2026-10-20", "2026-10-21", 0)).toBe("https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/0");
    expect(biorxivUrl("https://api.biorxiv.org/details/medrxiv", "2026-10-20", "2026-10-21", 60)).toBe("https://api.biorxiv.org/details/medrxiv/2026-10-20/2026-10-21/60");
    expect(BIORXIV_PAGE).toBe(30);
  });

  it("reads a page: the DOI, the title, the link built from the DOI and the version, the day, the category, and the page's own counts", () => {
    const page = parseBiorxiv(Buffer.from(bioPage([bioRecord(1, { version: "2" })], 1, 40, 30)), "biorxiv");
    expect(page).toMatchObject({ count: 1, total: 40, cursor: 30 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      doi: "10.1101/2026.10.20.100001", title: "A sample paper 1", url: "https://www.biorxiv.org/content/10.1101/2026.10.20.100001v2", published_at: "2026-10-20T00:00:00.000Z",
      abstract: "An invented abstract 1.", categories: ["genomics"], version: 2, arxiv: null, journal: null, types: [],
    });
  });

  it("starts a day-only date at the start of that day in the feed's zone, UTC when there is none", () => {
    const body = Buffer.from(bioPage([bioRecord(1)], 1, 1));
    expect(parseBiorxiv(body, "biorxiv").items[0]!.published_at).toBe("2026-10-20T00:00:00.000Z");
    expect(parseBiorxiv(body, "biorxiv", "+08:00").items[0]!.published_at).toBe("2026-10-19T16:00:00.000Z");
  });

  it("accepts bioRxiv's second DOI prefix and a version missing or not a number as version 1", () => {
    const page = parseBiorxiv(Buffer.from(bioPage([bioRecord(1, { doi: "10.64898/2026.10.21.99004", version: undefined }), bioRecord(2, { version: "x" })], 2, 2)), "biorxiv");
    expect(page.items.map((i) => [i.doi, i.version])).toEqual([["10.64898/2026.10.21.99004", 1], ["10.1101/2026.10.20.100002", 1]]);
  });

  it("leaves out a record with no DOI, a DOI that is no DOI or no title, and keeps the rest", () => {
    const records = [
      bioRecord(1, { doi: undefined }), bioRecord(2, { doi: "javascript:alert(1)" }), bioRecord(3, { title: "" }), bioRecord(4, { title: "   " }), "a string", null, bioRecord(5),
    ];
    const page = parseBiorxiv(Buffer.from(bioPage(records, 7, 7)), "biorxiv");
    expect(page.items.map((i) => i.doi)).toEqual(["10.1101/2026.10.20.100005"]);
    expect(page.count).toBe(7);
  });

  it("takes markup out of the title and the abstract, and builds the link from the DOI, never from a link the record gives", () => {
    const rec = bioRecord(1, { title: "A <b>bold</b> &amp; plain title", abstract: "<script>alert(1)</script>Text", jatsxml: "https://evil.example/x", url: "https://evil.example/y" });
    const item = parseBiorxiv(Buffer.from(bioPage([rec], 1, 1)), "medrxiv").items[0]!;
    expect(item.title).toBe("A bold & plain title");
    expect(item.abstract).toBe("Text");
    expect(item.url).toBe("https://www.medrxiv.org/content/10.1101/2026.10.20.100001v1");
  });

  it("falls back on the collection's length when the page has no message, and on no total", () => {
    const body = JSON.stringify({ collection: [bioRecord(1), bioRecord(2)] });
    expect(parseBiorxiv(Buffer.from(body), "biorxiv")).toMatchObject({ count: 2, total: null, cursor: null });
  });

  it("is a `schema` failure with no collection, and a `parse` failure for an answer that is no JSON object", () => {
    const fail = (body: string): FeedParseError => {
      try {
        parseBiorxiv(Buffer.from(body), "biorxiv");
      } catch (e) {
        return e as FeedParseError;
      }
      throw new Error("did not throw");
    };
    expect(fail('{"messages":[{"status":"no posts found"}]}').errorClass).toBe("schema");
    expect(fail('{"collection":"x"}').errorClass).toBe("schema");
    for (const body of ["not json", "", "[1,2]", "null", '{"collection": [']) expect(fail(body).errorClass, body).toBe("parse");
  });

  it("is a valid empty page when the collection is an empty list", () => {
    expect(parseBiorxiv(Buffer.from(bioPage([], 0, 0)), "biorxiv").items).toEqual([]);
  });
});

describe("readBiorxiv()", () => {
  it("reads the pages of the window's UTC days by cursor, moving it on by each page's count, and takes the later version of a DOI posted twice", async () => {
    fromFixtures();
    const f = recording();
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readBiorxiv(feedEntry("biorxiv"), ctx, fixtureRun());
    expect(f.urls()).toEqual(["https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/0", "https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/3"]);
    expect([r.ok, r.requests, r.note, r.urlUsed]).toEqual([true, 2, null, "https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/3"]);
    expect(r.data!.items.map((i) => i.doi)).toEqual(["10.1101/2026.10.20.99001", "10.1101/2026.10.20.99002", "10.1101/2026.10.19.99003", "10.64898/2026.10.21.99004"]);
    expect(r.data!.items[2]).toMatchObject({ url: "https://www.biorxiv.org/content/10.1101/2026.10.19.99003v2", published_at: "2026-10-21T00:00:00.000Z" });
    expect([r.data!.total, r.data!.newest, r.data!.unread]).toEqual([4, "2026-10-21T00:00:00.000Z", []]);
    expect(r.data!.items.every((i) => i.journal_id === null && i.kind === null)).toBe(true);
  });

  it("keeps the first page's body as the feed's file and the manifest row of every page", async () => {
    fromFixtures();
    const r = await readBiorxiv(feedEntry("biorxiv"), ctxFor(), fixtureRun());
    expect(cached("biorxiv.json")).toBe(fixtureText("api/biorxiv-p0.json"));
    expect(r.fetched.map((x) => x.sha256)).toEqual([sha256Hex(fixtureBytes("api/biorxiv-p0.json")), sha256Hex(fixtureBytes("api/biorxiv-p1.json"))]);
    expect(r.sha256).toBe(sha256Hex(fixtureBytes("api/biorxiv-p0.json")));
    expect(r.bytes).toBe(fixtureBytes("api/biorxiv-p0.json").length + fixtureBytes("api/biorxiv-p1.json").length);
  });

  it("reads medRxiv from its own address in one page when the page holds every record", async () => {
    fromFixtures();
    const f = recording();
    const r = await readBiorxiv(feedEntry("medrxiv"), ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(f.urls()).toEqual(["https://api.biorxiv.org/details/medrxiv/2026-10-20/2026-10-21/0"]);
    expect(r.data!.items.map((i) => i.url)).toEqual([
      "https://www.medrxiv.org/content/10.1101/2026.10.20.99101v1", "https://www.medrxiv.org/content/10.1101/2026.10.21.99102v1",
    ]);
  });

  it("uses the UTC days the window touches: a window that starts after midnight UTC starts that UTC day", async () => {
    const f = fakeFetch(() => answer(bioPage([], 0, 0)));
    await readBiorxiv(feedEntry("biorxiv"), ctxFor({ fetch: f.fetch }), fixtureRun({ window: { start: "2026-10-21T09:00:00+08:00", end: "2026-10-22T03:15:00+08:00" } }));
    expect(f.urls()).toEqual(["https://api.biorxiv.org/details/biorxiv/2026-10-21/2026-10-21/0"]);
  });

  it("keeps the pages before a page that fails, and says how many records it read", async () => {
    fromFixtures(writeFixtureDir({
      "https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/0": { body: fixtureBytes("api/biorxiv-p0.json"), content_type: "application/json" },
      "https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/3": { error: "timeout" },
    }));
    const r = await readBiorxiv(feedEntry("biorxiv"), ctxFor(), fixtureRun());
    expect([r.ok, r.error, r.note]).toEqual([true, null, "biorxiv: 3 of 5 records read."]);
    expect(r.data!.items).toHaveLength(3);
    expect(r.data!.unread).toEqual(["3 of 5 records read"]);
  });

  it("fails when its first page fails, with the page's class", async () => {
    fromFixtures(writeFixtureDir({ "https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/0": { error: "timeout" } }));
    const r = await readBiorxiv(feedEntry("biorxiv"), ctxFor(), fixtureRun());
    expect([r.ok, r.error, r.requests, r.data, r.sha256]).toEqual([false, "timeout", 1, null, null]);
    expect(r.urlUsed).toBe("https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/0");
  });

  it("stops at the feed's budget however many pages the days hold, and says what it left", async () => {
    for (const [id, budget] of [["biorxiv", 20], ["medrxiv", 5]] as const) {
      const f = fakeFetch((url) => {
        const cursor = Number(url.split("/").at(-1));
        return answer(bioPage(Array.from({ length: 30 }, (_, i) => bioRecord(cursor + i)), 30, 1_000, cursor), { contentType: "application/json" });
      });
      const r = await readBiorxiv(feedEntry(id), ctxFor({ fetch: f.fetch }), fixtureRun());
      expect(feedEntry(id).budget, id).toBe(budget);
      expect(f.calls, id).toHaveLength(budget);
      expect(f.urls().at(-1)!.endsWith(`/${(budget - 1) * 30}`), id).toBe(true);
      expect([r.ok, r.requests, r.data!.items.length], id).toEqual([true, budget, budget * 30]);
      expect(r.note, id).toBe(`${id}: ${budget * 30} of 1000 records read.`);
    }
  });

  it("stops at a page that counts nothing, and when the answer gives no total", async () => {
    const empty = fakeFetch(() => answer(bioPage([], 0, 0)));
    const e = await readBiorxiv(feedEntry("biorxiv"), ctxFor({ fetch: empty.fetch }), fixtureRun());
    expect([e.ok, e.requests, e.data!.items, e.note]).toEqual([true, 1, [], null]);
    const noTotal = fakeFetch(() => answer(JSON.stringify({ collection: [bioRecord(1)] })));
    const n = await readBiorxiv(feedEntry("biorxiv"), ctxFor({ fetch: noTotal.fetch }), fixtureRun());
    expect([n.requests, n.data!.items.length]).toEqual([1, 1]);
  });

  it("is `schema` for an answer with no collection and `parse` for a body that is no JSON, and writes no cache for either", async () => {
    for (const [body, error] of [[JSON.stringify({ messages: [{ status: "error" }] }), "schema"], ["<html>busy</html>", "parse"]] as const) {
      const f = fakeFetch(() => answer(body, { contentType: "application/json" }));
      const r = await readBiorxiv(feedEntry("biorxiv"), ctxFor({ fetch: f.fetch }), fixtureRun());
      expect([r.ok, r.error, r.requests]).toEqual([false, error, 1]);
    }
    expect(cached("biorxiv.json")).toBeNull();
  });
});

// ── PubMed ───────────────────────────────────────────────────────────────────────────────────────

const PUBMED_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

/** An `esummary` answer for some ids: each record has a title and a day. */
const pubmedSummary = (ids: readonly string[], over: Record<string, unknown> = {}): string =>
  JSON.stringify({ result: { uids: ids, ...Object.fromEntries(ids.map((id) => [id, { uid: id, title: `A sample article ${id}`, sortpubdate: "2026/10/21 00:00", fulljournalname: "Journal of Placeholder Medicine", pubtype: ["Journal Article"], articleids: [], ...over }])) } });
const pubmedFetchBody = (ids: readonly string[]): string =>
  `<PubmedArticleSet>${ids.map((id) => `<PubmedArticle><MedlineCitation><PMID>${id}</PMID><Article><Abstract><AbstractText>An invented abstract ${id}.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>`).join("")}</PubmedArticleSet>`;
const pubmedSearch = (ids: readonly string[], count: number = ids.length): string => JSON.stringify({ esearchresult: { count: String(count), idlist: ids } });
const pmids = (n: number, from = 1): string[] => Array.from({ length: n }, (_, i) => String(99_100_000 + from + i));

/** A fake E-utilities: a search that finds `ids`, and summaries and abstracts for any ids asked. */
function fakePubmed(ids: readonly string[], count: number = ids.length, over: { summary?: () => FetchResult; fetch?: () => FetchResult } = {}) {
  return fakeFetch((url) => {
    if (url.includes("esearch.fcgi")) return answer(pubmedSearch(ids, count), { contentType: "application/json" });
    const asked = decodeURIComponent(url.split("&id=")[1] ?? "").split(",");
    if (url.includes("esummary.fcgi")) return over.summary ? over.summary() : answer(pubmedSummary(asked), { contentType: "application/json" });
    return over.fetch ? over.fetch() : answer(pubmedFetchBody(asked), { contentType: "text/xml" });
  });
}

describe("PubMed URLs", () => {
  it("esearch: the AI phrases ORed in title or abstract, entered on the UTC days from mindate to maxdate, at most 1000 PMIDs, as JSON", () => {
    expect(pubmedSearchUrl(PUBMED_URL, ["machine learning", "AlphaFold"], "2026-10-20", "2026-10-21")).toBe(
      `${PUBMED_URL}?db=pubmed&retmode=json&retmax=1000&datetype=edat&mindate=2026/10/20&maxdate=2026/10/21&term=(%22machine%20learning%22%5BTitle%2FAbstract%5D%20OR%20%22AlphaFold%22%5BTitle%2FAbstract%5D)`,
    );
    expect(pubmedSearchUrl(PUBMED_URL, ["one"], "2026-01-02", "2026-01-03")).toBe(
      `${PUBMED_URL}?db=pubmed&retmode=json&retmax=1000&datetype=edat&mindate=2026/01/02&maxdate=2026/01/03&term=(%22one%22%5BTitle%2FAbstract%5D)`,
    );
    expect([PUBMED_RETMAX, PUBMED_BATCH]).toEqual([1000, 200]);
  });

  it("esummary and efetch sit beside esearch's file, one request for a list of PMIDs", () => {
    expect(pubmedSummaryUrl(PUBMED_URL, ["1", "2", "3"])).toBe("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=1,2,3");
    expect(pubmedFetchUrl(PUBMED_URL, ["1", "2", "3"])).toBe("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=1,2,3");
  });

  it("asks for the phrases of config/ai-terms.json, in file order, with each phrase quoted", () => {
    const phrases = realConfig().aiTerms.phrases.map((p) => p.phrase);
    const url = pubmedSearchUrl(feedEntry("pubmed").url, phrases, "2026-10-20", "2026-10-21");
    const term = decodeURIComponent(url.split("&term=")[1]!);
    expect(term).toBe(`(${phrases.map((p) => `"${p}"[Title/Abstract]`).join(" OR ")})`);
    expect(phrases.length).toBeGreaterThan(5);
  });
});

describe("parsePubmedSearch(), parsePubmedSummary() and parsePubmedAbstracts()", () => {
  it("search: the PMIDs that are numbers, and the count the answer gives (as text or a number)", () => {
    expect(parsePubmedSearch(Buffer.from(pubmedSearch(["1", "22", "333"], 9)))).toEqual({ count: 9, ids: ["1", "22", "333"] });
    const odd = JSON.stringify({ esearchresult: { count: 4, idlist: ["1", 2, "x3", "", "12345678901", "5"] } });
    expect(parsePubmedSearch(Buffer.from(odd))).toEqual({ count: 4, ids: ["1", "5"] });
    expect(parsePubmedSearch(Buffer.from(JSON.stringify({ esearchresult: { idlist: ["7"] } })))).toEqual({ count: 1, ids: ["7"] });
  });

  it("search: `schema` with no idlist and `parse` with no JSON", () => {
    const code = (body: string) => {
      try {
        parsePubmedSearch(Buffer.from(body));
      } catch (e) {
        return (e as FeedParseError).errorClass;
      }
      return null;
    };
    expect(code('{"esearchresult":{"count":"0"}}')).toBe("schema");
    expect(code('{"error":"Invalid"}')).toBe("schema");
    expect(code("")).toBe("parse");
    expect(code("[]")).toBe("parse");
  });

  it("summary: a record with its title, journal, DOI, types and day (sortpubdate first, then epubdate, then pubdate)", () => {
    const body = JSON.stringify({ result: { uids: ["1", "2", "3", "4", "5"],
      1: { title: "One", fulljournalname: "J One", sortpubdate: "2026/10/21 00:00", articleids: [{ idtype: "doi", value: "10.1000/ut-sample-a" }], pubtype: ["Journal Article", " Review "] },
      2: { title: "Two", epubdate: "2026 Oct 20", pubdate: "2026 Nov 1" },
      3: { title: "Three", pubdate: "2026 Oct 19" },
      4: { title: "Four", pubdate: "2026 Oct" },
      5: { title: "Five", sortpubdate: "2026/10/22 00:00", articleids: [{ idtype: "pubmed", value: "5" }, { idtype: "doi", value: "not a doi" }] } } });
    const got = parsePubmedSummary(Buffer.from(body));
    expect([...got.keys()]).toEqual(["1", "2", "3", "4", "5"]);
    expect(got.get("1")).toEqual({ pmid: "1", title: "One", doi: "10.1000/ut-sample-a", journal: "J One", day: "2026-10-21", types: ["Journal Article", "Review"] });
    expect(got.get("2")!.day).toBe("2026-10-20");
    expect(got.get("3")!.day).toBe("2026-10-19");
    expect(got.get("4")!.day).toBeNull();
    expect(got.get("5")!.doi).toBeNull();
  });

  it("summary: leaves out an error record, one with no title and a uid with no record", () => {
    const body = JSON.stringify({ result: { uids: ["1", "2", "3", "4"], 1: { title: "Kept" }, 2: { error: "cannot get document summary" }, 3: { title: "  " } } });
    expect([...parsePubmedSummary(Buffer.from(body)).keys()]).toEqual(["1"]);
  });

  it("summary: `schema` with no uids, `parse` with no JSON", () => {
    expect(() => parsePubmedSummary(Buffer.from('{"result":{}}'))).toThrow(/no result\.uids/);
    expect(() => parsePubmedSummary(Buffer.from("nope"))).toThrow(FeedParseError);
  });

  it("abstracts: the parts of a structured abstract joined by a space, markup out, a record with none left out", () => {
    const xml = `<PubmedArticleSet>
      <PubmedArticle><MedlineCitation><PMID>11</PMID><Article><Abstract>
        <AbstractText Label="A">First &amp; part.</AbstractText><AbstractText Label="B">Second <i>part</i> here.</AbstractText>
      </Abstract></Article></MedlineCitation></PubmedArticle>
      <PubmedArticle><MedlineCitation><PMID>12</PMID><Article><ArticleTitle>No abstract</ArticleTitle></Article></MedlineCitation></PubmedArticle>
      <PubmedArticle><MedlineCitation><PMID>13</PMID><Article><Abstract><AbstractText>   </AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>
      <PubmedArticle><MedlineCitation><PMID>x</PMID><Article><Abstract><AbstractText>Bad id.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>
    </PubmedArticleSet>`;
    expect([...parsePubmedAbstracts(Buffer.from(xml))]).toEqual([["11", "First & part. Second part here."]]);
  });

  it("abstracts: `parse` for an answer that is no PubmedArticleSet", () => {
    expect(() => parsePubmedAbstracts(Buffer.from("<html><body>busy</body></html>"))).toThrow(/not a PubmedArticleSet/);
    expect(() => parsePubmedAbstracts(Buffer.from(""))).toThrow(FeedParseError);
  });
});

describe("readPubmed()", () => {
  const entry = feedEntry("pubmed");

  it("searches, then asks for the summaries and the abstracts of what it found, one request each, in that order", async () => {
    fromFixtures();
    const f = recording();
    const r = await readPubmed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(f.urls()).toEqual([
      pubmedSearchUrl(entry.url, fixtureRun().aiPhrases, "2026-10-20", "2026-10-21"),
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=99000001,99000002,99000003",
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=99000001,99000002,99000003",
    ]);
    expect([r.ok, r.requests, r.note, r.urlUsed]).toEqual([true, 3, null, f.urls()[0]]);
    expect(r.data!.items.map((i) => [i.url, i.published_at, i.doi, i.journal])).toEqual([
      ["https://pubmed.ncbi.nlm.nih.gov/99000001/", "2026-10-21T00:00:00.000Z", "10.1000/ut-sample-pm-0001", "Journal of Placeholder Medicine"],
      ["https://pubmed.ncbi.nlm.nih.gov/99000002/", "2026-10-20T00:00:00.000Z", null, "Journal of Placeholder Medicine"],
      ["https://pubmed.ncbi.nlm.nih.gov/99000003/", "2026-10-21T00:00:00.000Z", "10.1000/ut-sample-pm-0003", "Placeholder Letters"],
    ]);
    expect(r.data!.items[0]).toMatchObject({
      title: "A sample trial of a machine learning triage tool", types: ["Journal Article", "Randomized Controlled Trial"],
      abstract: "Invented background about a sample triage tool. The invented tool ranked sample cases as well as a plain checklist.",
    });
    expect(r.data!.items[2]!.abstract).toBe("");
    expect([r.data!.total, r.data!.newest, r.data!.unread]).toEqual([3, "2026-10-21T00:00:00.000Z", []]);
  });

  it("keeps the first body of each of its three kinds as the feed's files, and a manifest row for each request", async () => {
    fromFixtures();
    const r = await readPubmed(entry, ctxFor(), fixtureRun());
    expect(cached("pubmed.json")).toBe(fixtureText("api/pubmed-search.json"));
    expect(cached("pubmed.summary.json")).toBe(fixtureText("api/pubmed-summary.json"));
    expect(cached("pubmed.fetch.xml")).toBe(fixtureText("api/pubmed-fetch.xml"));
    expect(r.fetched.map((x) => x.sha256)).toEqual(["api/pubmed-search.json", "api/pubmed-summary.json", "api/pubmed-fetch.xml"].map((x) => sha256Hex(fixtureBytes(x))));
  });

  it("reads the UTC days the window touches", async () => {
    const f = fakePubmed([]);
    await readPubmed(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ window: { start: "2026-10-21T09:00:00+08:00", end: "2026-10-22T03:15:00+08:00" } }));
    expect(f.urls()[0]).toContain("&mindate=2026/10/21&maxdate=2026/10/21&");
  });

  it("finds nothing: one request, no item, no failure", async () => {
    const f = fakePubmed([]);
    const r = await readPubmed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect([r.ok, r.requests, r.data!.items, r.note]).toEqual([true, 1, [], null]);
  });

  it("asks 200 PMIDs at a time: 450 PMIDs are one search, three summaries and three fetches", async () => {
    const ids = pmids(450);
    const f = fakePubmed(ids);
    const r = await readPubmed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    const asked = (kind: string) => f.urls().filter((u) => u.includes(kind)).map((u) => u.split("&id=")[1]!.split(",").length);
    expect(asked("esummary")).toEqual([200, 200, 50]);
    expect(asked("efetch")).toEqual([200, 200, 50]);
    expect(f.calls).toHaveLength(7);
    expect([r.ok, r.requests, r.data!.items.length, r.note]).toEqual([true, 7, 450, null]);
    expect(r.data!.items.every((i) => i.abstract.startsWith("An invented abstract"))).toBe(true);
    expect(f.urls().slice(1, 4).every((u) => u.includes("esummary"))).toBe(true);
  });

  it("stays inside the feed's 12 requests for a search that finds 1000 PMIDs, and says when the search found more than it was given", async () => {
    const f = fakePubmed(pmids(1000), 1_500);
    const r = await readPubmed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(entry.budget).toBe(12);
    expect(f.calls).toHaveLength(11);
    expect([r.ok, r.data!.items.length, r.note]).toEqual([true, 1000, "PubMed: 1000 of 1500 PMIDs not read."]);
    expect(r.data!.unread).toEqual(["1000 of 1500 PMIDs"]);
  });

  it("never sends more than the budget, retries included, when every summary fails", async () => {
    const f = fakePubmed(pmids(1000), 1000, { summary: () => answer(null, { error: "timeout", attempts: 2 }) });
    const r = await readPubmed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    const used = f.calls.reduce((n, c) => n + (c.url.includes("esummary") ? 2 : 1), 0);
    expect(used).toBeLessThanOrEqual(entry.budget);
    expect(r.requests).toBeLessThanOrEqual(entry.budget);
    expect(r.data!.items).toEqual([]);
    expect(r.note).toMatch(/^PubMed: summaries of /);
  });

  it("counts the PMIDs left without a summary when the budget ends, the last batch being short (450 PMIDs: 250 are left after one summary of 200)", async () => {
    const f = fakePubmed(pmids(450), 450);
    const r = await readPubmed({ ...entry, budget: 2 }, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect([r.ok, r.requests, r.data!.items.length]).toEqual([true, 2, 200]);
    expect(r.data!.unread).toEqual(["summaries of 250 PMIDs", "abstracts past the budget"]);
    const search = await readPubmed({ ...entry, budget: 1 }, ctxFor({ fetch: fakePubmed(pmids(250), 250).fetch }), fixtureRun());
    expect([search.ok, search.requests, search.data!.items.length]).toEqual([true, 1, 0]);
    expect(search.data!.unread[0]).toBe("summaries of 250 PMIDs");
  });

  it("fails when the search fails, with its class", async () => {
    const f = fakeFetch(failing("http_503" as never));
    const r = await readPubmed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect([r.ok, r.error, r.data]).toEqual([false, "http_503", null]);
    expect(f.calls).toHaveLength(1);
    expect(r.requests).toBeLessThanOrEqual(entry.budget);
  });

  it("fails as `schema` when the search answers with no idlist, and as `parse` when it is no JSON", async () => {
    for (const [body, error] of [['{"esearchresult":{"error":"x"}}', "schema"], ["<html>", "parse"]] as const) {
      const r = await readPubmed(entry, ctxFor({ fetch: fakeFetch(() => answer(body)).fetch }), fixtureRun());
      expect([r.ok, r.error]).toEqual([false, error]);
    }
  });

  it("leaves out the PMIDs of a summary that fails and notes it, and then asks for no abstract it has no record for", async () => {
    const f = fakePubmed(pmids(3), 3, { summary: () => answer(null, { error: "timeout" }) });
    const r = await readPubmed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect([r.ok, r.data!.items, r.note]).toEqual([true, [], "PubMed: summaries of 3 PMIDs not read."]);
    expect(f.urls().some((u) => u.includes("efetch"))).toBe(false);
  });

  it("keeps the items with no abstract when a fetch fails, and notes it", async () => {
    const f = fakePubmed(pmids(3), 3, { fetch: () => answer("<html>busy</html>", { contentType: "text/html" }) });
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readPubmed(entry, ctx, fixtureRun());
    expect([r.ok, r.data!.items.length, r.data!.items.map((i) => i.abstract)]).toEqual([true, 3, ["", "", ""]]);
    expect(r.note).toBe("PubMed: abstracts of 3 PMIDs not read.");
    expect(ctx.lines.some((l) => l.includes("a fetch did not parse"))).toBe(true);
  });
});

// ── Crossref: a journal's new articles ───────────────────────────────────────────────────────────

const CROSSREF_URL = "https://api.crossref.org/works";

const crossrefWork = (n: number, over: Record<string, unknown> = {}) => ({
  DOI: `10.1000/ut-sample-w-${n}`, URL: `https://doi.org/10.1000/ut-sample-w-${n}`, title: [`A sample work ${n}`], "container-title": ["Nature"],
  published: { "date-parts": [[2026, 10, 21]] }, ...over,
});
const crossrefBody = (items: unknown[], total: number = items.length): string => JSON.stringify({ status: "ok", "message-type": "work-list", message: { "total-results": total, items } });

describe("Crossref URLs and parseCrossrefWorks()", () => {
  it("a journal: the ISSN and the first day, 100 rows, with an offset for a later page", () => {
    expect(crossrefJournalUrl(CROSSREF_URL, "0028-0836", "2026-10-20")).toBe("https://api.crossref.org/works?filter=issn:0028-0836,from-pub-date:2026-10-20&rows=100");
    expect(crossrefJournalUrl(CROSSREF_URL, "1758-678X", "2026-10-20", 100)).toBe("https://api.crossref.org/works?filter=issn:1758-678X,from-pub-date:2026-10-20&rows=100&offset=100");
    expect(CROSSREF_ROWS).toBe(100);
  });

  it("notices: each DOI is `updates:<doi>`, joined by commas, 1000 rows, the slash and the colon as written and the rest escaped", () => {
    expect(crossrefUpdatesUrl(CROSSREF_URL, ["10.1000/a", "10.1000/b"])).toBe("https://api.crossref.org/works?filter=updates:10.1000/a,updates:10.1000/b&rows=1000");
    expect(crossrefUpdatesUrl(CROSSREF_URL, ["10.1000/a(b)<c>:d"])).toBe("https://api.crossref.org/works?filter=updates:10.1000/a(b)%3Cc%3E:d&rows=1000");
    expect([CROSSREF_UPDATES_BATCH, CROSSREF_UPDATES_ROWS]).toEqual([50, 1000]);
  });

  it("reads a work: DOI, title, link, container, the day (published-online, else published, else issued) and the abstract without markup", () => {
    const works = [
      crossrefWork(1, { abstract: "<jats:title>Abstract</jats:title><jats:p>An invented <jats:italic>abstract</jats:italic> &amp; more.</jats:p>" }),
      crossrefWork(2, { "published-online": { "date-parts": [[2026, 10, 19]] }, published: { "date-parts": [[2026, 10, 21]] } }),
      crossrefWork(3, { published: undefined, issued: { "date-parts": [[2026, 10, 18]] } }),
      crossrefWork(4, { published: { "date-parts": [[2026, 10]] }, issued: { "date-parts": [[2026]] } }),
      crossrefWork(5, { published: { "date-parts": [[2026, 2, 31]] } }),
    ];
    const got = parseCrossrefWorks(Buffer.from(crossrefBody(works, 5)));
    expect(got.total).toBe(5);
    expect(got.works.map((w) => w.day)).toEqual(["2026-10-21", "2026-10-19", "2026-10-18", null, null]);
    expect(got.works[0]).toEqual({
      doi: "10.1000/ut-sample-w-1", title: "A sample work 1", url: "https://doi.org/10.1000/ut-sample-w-1", day: "2026-10-21", abstract: "An invented abstract & more.", container: "Nature",
    });
    expect(got.works[1]!.abstract).toBe("");
  });

  it("leaves out a work with no title, and gives no link for one that is not an http address", () => {
    const works = [crossrefWork(1, { title: [] }), crossrefWork(2, { title: undefined }), crossrefWork(3, { URL: "javascript:alert(1)" }), crossrefWork(4, { DOI: "not a doi" }), "text", null];
    const got = parseCrossrefWorks(Buffer.from(crossrefBody(works)));
    expect(got.works.map((w) => [w.doi, w.url])).toEqual([["10.1000/ut-sample-w-3", null], [null, "https://doi.org/10.1000/ut-sample-w-4"]]);
  });

  it("has no total when the answer gives none that is a count", () => {
    expect(parseCrossrefWorks(Buffer.from(JSON.stringify({ message: { items: [], "total-results": "many" } }))).total).toBeNull();
  });

  it("is `schema` with no items and `parse` with no JSON", () => {
    expect(() => parseCrossrefWorks(Buffer.from('{"message":{}}'))).toThrow(/no message\.items/);
    expect(() => parseCrossrefWorks(Buffer.from("<html>"))).toThrow(FeedParseError);
    expect(() => parseCrossrefWorks(Buffer.from('"x"'))).toThrow(FeedParseError);
  });
});

describe("readCrossrefJournals()", () => {
  const entry = feedEntry("crossref-journals");
  const journals = realConfig().journals.journals;
  const urlOf = (j: { issn: string }, offset = 0) => crossrefJournalUrl(entry.url, j.issn, "2026-10-20", offset);

  it("asks once for each journal of config/journals.json, in file order, from the window's first UTC day, and is within its budget of 40", async () => {
    fromFixtures();
    const f = recording();
    const r = await readCrossrefJournals(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(journals).toHaveLength(30);
    expect(f.urls()).toEqual(journals.map((j) => urlOf(j)));
    expect([r.ok, r.requests, r.note, r.urlUsed]).toEqual([true, 30, null, entry.url]);
    expect(r.requests).toBeLessThanOrEqual(entry.budget);
    expect(r.data!.unread).toEqual([]);
    expect(r.fetched).toHaveLength(30);
  });

  it("gives each article its journal's id, the DOI-based link, the day, and an abstract only where Crossref holds one", async () => {
    fromFixtures();
    const r = await readCrossrefJournals(entry, ctxFor(), fixtureRun());
    expect(r.data!.items.map((i) => [i.journal_id, i.doi, i.published_at, i.abstract])).toEqual([
      ["nature", "10.1038/ut-sample-cr-0001", "2026-10-21T00:00:00.000Z", "An invented abstract with plain text only."],
      ["nature", "10.1038/ut-sample-cr-0002", "2026-10-20T00:00:00.000Z", ""],
      ["nature", "10.1038/ut-sample-cr-0003", null, ""],
      ["science", "10.1126/ut-sample-cr-0101", "2026-10-21T00:00:00.000Z", ""],
    ]);
    expect(r.data!.items[0]).toMatchObject({ url: "https://doi.org/10.1038/ut-sample-cr-0001", journal: "Nature", title: "A sample result from a learned model of invented chemistry" });
    expect([r.data!.total, r.data!.newest]).toEqual([4, "2026-10-21T00:00:00.000Z"]);
  });

  it("keeps each journal's first body as crossref-journals-<journal id>.json", async () => {
    fromFixtures();
    await readCrossrefJournals(entry, ctxFor(), fixtureRun());
    const files = fs.readdirSync(path.join(root, "cache", "feeds")).filter((n) => n.startsWith("crossref-journals-")).sort(byCodeUnit);
    expect(files).toEqual(journals.map((j) => `crossref-journals-${j.id}.json`).sort(byCodeUnit));
    expect(cached("crossref-journals-nature.json")).toBe(fixtureText("api/crossref-nature.json"));
    expect(cached("crossref-journals-science.json")).toBe(fixtureText("api/crossref-science.json"));
  });

  it("asks from the first UTC day of the window, whatever the Taipei day is", async () => {
    const f = fakeFetch(() => answer(crossrefBody([])));
    await readCrossrefJournals(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ journals: [{ id: "nature", issn: "0028-0836" }], window: { start: "2026-10-21T09:00:00+08:00", end: "2026-10-22T03:15:00+08:00" } }));
    expect(f.urls()).toEqual(["https://api.crossref.org/works?filter=issn:0028-0836,from-pub-date:2026-10-21&rows=100"]);
  });

  it("lists a journal that did not answer, keeps the others, and notes the count", async () => {
    const dir = writeFixtureDir({
      [urlOf(journals[0]!)]: { error: "timeout" },
      ...Object.fromEntries(journals.slice(1).map((j) => [urlOf(j), { body: crossrefBody([]), content_type: "application/json" }])),
    });
    fromFixtures(dir);
    const r = await readCrossrefJournals(entry, ctxFor(), fixtureRun());
    expect([r.ok, r.data!.unread, r.note]).toEqual([true, ["nature"], "Crossref: 1 request not answered."]);
  });

  it("fails only when no journal answered, with the class of the last failure, within the budget", async () => {
    const f = fakeFetch(failing("timeout"));
    const r = await readCrossrefJournals(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect([r.ok, r.error, r.data, r.urlUsed]).toEqual([false, "timeout", null, entry.url]);
    const used = f.calls.reduce((n, c) => n + (c.opts.retryDelayMs === 0 ? 1 : 2), 0);
    expect(used).toBeLessThanOrEqual(entry.budget);
    expect(r.requests).toBeLessThanOrEqual(entry.budget);
  });

  it("fails with a note when there is no journal to ask", async () => {
    const f = fakeFetch(() => answer(crossrefBody([])));
    const r = await readCrossrefJournals(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ journals: [] }));
    expect([r.ok, r.requests, r.note, f.calls.length]).toEqual([false, 0, "Crossref: no journal to ask.", 0]);
  });

  it("gives every journal its first request before any gets a second, then pages a journal that holds more than 100 works", async () => {
    const nature = journals[0]!;
    const f = fakeFetch((url) => {
      if (!url.includes(`issn:${nature.issn}`)) return answer(crossrefBody([]));
      const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? "0");
      const n = Math.min(100, 250 - offset);
      return answer(crossrefBody(Array.from({ length: n }, (_, i) => crossrefWork(offset + i + 1)), 250));
    });
    const r = await readCrossrefJournals(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(f.urls().slice(0, 30)).toEqual(journals.map((j) => urlOf(j)));
    expect(f.urls().slice(30)).toEqual([urlOf(nature, 100), urlOf(nature, 200)]);
    expect([r.ok, r.requests, r.data!.items.length, r.note]).toEqual([true, 32, 250, null]);
  });

  it("never sends more than the budget when every journal holds pages more", async () => {
    const f = fakeFetch((url) => {
      const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? "0");
      const issn = /issn:([^,]+),/.exec(url)![1]!;
      return answer(crossrefBody(Array.from({ length: 100 }, (_, i) => crossrefWork(offset + i + 1, { DOI: `10.1000/ut-sample-${issn}-${offset + i}`, URL: undefined })), 10_000));
    });
    const r = await readCrossrefJournals(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(f.calls).toHaveLength(40);
    expect([r.ok, r.requests]).toEqual([true, 40]);
    expect(f.urls().slice(30).every((u) => /offset=100/.test(u))).toBe(true);
  });

  it("reads each work once, whichever journal or page gave it", async () => {
    const f = fakeFetch(() => answer(crossrefBody([crossrefWork(1), crossrefWork(1), crossrefWork(2)])));
    const r = await readCrossrefJournals(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ journals: journals.slice(0, 2) }));
    expect(r.data!.items.map((i) => i.doi)).toEqual(["10.1000/ut-sample-w-1", "10.1000/ut-sample-w-2"]);
  });

  it("takes the JATS markup out of an abstract and keeps no tag from a title", async () => {
    const works = [crossrefWork(1, { title: ["A <i>sample</i> &amp; title"], abstract: "<jats:p>Plain <jats:sub>2</jats:sub> text<script>x()</script>.</jats:p>" })];
    const f = fakeFetch(() => answer(crossrefBody(works)));
    const r = await readCrossrefJournals(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ journals: journals.slice(0, 1) }));
    expect(r.data!.items[0]!.title).toBe("A sample & title");
    expect(r.data!.items[0]!.abstract).toBe("Plain 2 text.");
  });

  it("counts a body that is not JSON as an unanswered journal", async () => {
    const f = fakeFetch((url) => (url.includes(`issn:${journals[0]!.issn}`) ? answer("<html>busy</html>") : answer(crossrefBody([crossrefWork(7)]))));
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readCrossrefJournals(entry, ctx, fixtureRun({ journals: journals.slice(0, 2) }));
    expect([r.ok, r.data!.unread, r.data!.items.length]).toEqual([true, [journals[0]!.id], 1]);
    expect(ctx.lines.some((l) => l.includes("did not parse"))).toBe(true);
  });
});

// ── Crossref: notices that update a work ─────────────────────────────────────────────────────────

const noticeOf = (n: number, over: Record<string, unknown> = {}) => ({
  DOI: `10.1000/ut-sample-notice-${String(n).padStart(4, "0")}`, URL: `https://doi.org/10.1000/ut-sample-notice-${n}`, title: [`Notice ${n}`], "container-title": ["Journal of Placeholder Science"],
  publisher: "Placeholder Press", published: { "date-parts": [[2026, 10, 19]] },
  "update-to": [{ DOI: `10.1000/ut-sample-rw-${String(n).padStart(4, "0")}`, type: "retraction", label: "Retraction", source: "publisher", updated: { "date-parts": [[2026, 10, 19]] } }], ...over,
});
const watchDois = (n: number): string[] => Array.from({ length: n }, (_, i) => `10.1000/ut-sample-rw-${String(i + 1).padStart(4, "0")}`);

describe("parseCrossrefNotices()", () => {
  it("reads a notice: its DOI, title, container, publisher, link, day, and each update it makes", () => {
    const got = parseCrossrefNotices(fixtureBytes("api/crossref-updates.json"));
    expect(got.total).toBe(2);
    expect(got.rows).toBe(2);
    expect(got.notices).toEqual([
      {
        doi: "10.1000/ut-sample-notice-0001", title: "Retraction notice for a sample paper", container: "Journal of Placeholder Science", publisher: "Placeholder Press",
        url: "https://doi.org/10.1000/ut-sample-notice-0001", published: "2026-10-19", published_parts: [2026, 10, 19],
        updates: [{ doi: "10.1000/ut-sample-rw-0001", type: "retraction", source: "publisher", label: "Retraction", date: "2026-10-19" }],
      },
      {
        doi: "10.1000/ut-sample-notice-0002", title: "Expression of concern for a sample paper", container: "Journal of Placeholder Science", publisher: "Placeholder Press",
        url: "https://doi.org/10.1000/ut-sample-notice-0002", published: null, published_parts: [2026, 10],
        updates: [{ doi: "10.1000/ut-sample-rw-0002", type: "expression_of_concern", source: "retraction-watch", label: "Expression of concern", date: "2026-10-20" }],
      },
    ]);
  });

  it("never invents a day: a year alone or a year and a month is no day, and an update with only a time-of-day stamp takes its day", () => {
    const body = crossrefBody([
      noticeOf(1, { published: { "date-parts": [[2026]] } }),
      noticeOf(2, { "update-to": [{ DOI: "10.1000/ut-sample-rw-0002", type: "Correction", updated: { "date-time": "2026-10-20T08:00:00Z" } }] }),
      noticeOf(3, { "update-to": [{ DOI: "10.1000/ut-sample-rw-0003", type: "correction", updated: {} }] }),
    ]);
    const got = parseCrossrefNotices(Buffer.from(body)).notices;
    expect(got.map((n) => n.published)).toEqual([null, "2026-10-19", "2026-10-19"]);
    expect(got[1]!.updates).toEqual([{ doi: "10.1000/ut-sample-rw-0002", type: "correction", source: null, label: null, date: "2026-10-20" }]);
    expect(got[2]!.updates[0]!.date).toBeNull();
  });

  it("leaves out a notice with no DOI, an update with no DOI or no type, and keeps the rest", () => {
    const body = crossrefBody([
      noticeOf(1, { DOI: "nope" }), "text",
      noticeOf(2, { "update-to": [{ DOI: "bad", type: "retraction" }, { DOI: "10.1000/ut-sample-rw-0002", type: "" }, { DOI: "10.1000/ut-sample-rw-0002", type: "Retraction" }, 7] }),
    ]);
    const got = parseCrossrefNotices(Buffer.from(body));
    expect(got.rows).toBe(3);
    expect(got.notices.map((n) => n.doi)).toEqual(["10.1000/ut-sample-notice-0002"]);
    expect(got.notices[0]!.updates.map((u) => u.type)).toEqual(["retraction"]);
  });

  it("is `schema` with no items and `parse` with no JSON", () => {
    expect(() => parseCrossrefNotices(Buffer.from('{"message":{"items":"x"}}'))).toThrow(/no message\.items/);
    expect(() => parseCrossrefNotices(Buffer.from("<html>"))).toThrow(FeedParseError);
  });
});

describe("readCrossrefUpdates()", () => {
  const entry = feedEntry("crossref-updates");
  const dois = ["10.1000/ut-sample-rw-0001", "10.1000/ut-sample-rw-0002"];

  it("asks for up to 50 DOIs in one request and reads the notices, in code-unit order of their DOI", async () => {
    fromFixtures();
    const f = recording();
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), [...dois].reverse());
    expect(f.urls()).toEqual(["https://api.crossref.org/works?filter=updates:10.1000/ut-sample-rw-0001,updates:10.1000/ut-sample-rw-0002&rows=1000"]);
    expect([r.ok, r.requests, r.note, r.urlUsed]).toEqual([true, 1, null, entry.url]);
    expect(r.data!.notices.map((n) => n.doi)).toEqual(["10.1000/ut-sample-notice-0001", "10.1000/ut-sample-notice-0002"]);
    expect(r.data).toMatchObject({ answered: dois, unanswered: [], skipped: [], truncated: false });
    expect(cached("crossref-updates.json")).toBe(fixtureText("api/crossref-updates.json"));
  });

  it("asks each DOI once, in §4.1's form, and sets aside what is no DOI or holds a comma", async () => {
    const f = fakeFetch(() => answer(crossrefBody([])));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), [
      "10.1000/ut-sample-b", "10.1000/UT-SAMPLE-B", "https://doi.org/10.1000/ut-sample-a", "10.1000/has,comma", "not a doi", "", "10.1000/ut-sample-b",
    ]);
    expect(f.urls()).toEqual(["https://api.crossref.org/works?filter=updates:10.1000/ut-sample-a,updates:10.1000/ut-sample-b&rows=1000"]);
    expect(r.data!.skipped).toEqual(["10.1000/has,comma", "not a doi", ""]);
    expect(r.data!.answered).toEqual(["10.1000/ut-sample-a", "10.1000/ut-sample-b"]);
  });

  it("asks 50 DOIs a request: 120 DOIs are three requests, and 600 stop at the budget of 10 with the rest left unanswered", async () => {
    const f = fakeFetch(() => answer(crossrefBody([])));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), watchDois(120));
    expect(f.calls.map((c) => c.url.split("updates:").length - 1)).toEqual([50, 50, 20]);
    expect([r.ok, r.requests, r.data!.unanswered]).toEqual([true, 3, []]);
    const big = fakeFetch(() => answer(crossrefBody([])));
    const b = await readCrossrefUpdates(entry, ctxFor({ fetch: big.fetch }), watchDois(600));
    expect(entry.budget).toBe(10);
    expect(big.calls).toHaveLength(10);
    expect([b.ok, b.requests, b.data!.answered.length, b.data!.unanswered.length]).toEqual([true, 10, 500, 100]);
    expect(b.data!.unanswered).toEqual(watchDois(600).slice(500));
    expect(b.note).toBe("Crossref notices: 100 DOIs not checked.");
  });

  it("leaves the DOIs of a batch that fails unanswered and keeps the notices of the others", async () => {
    let n = 0;
    const f = fakeFetch(() => (++n === 2 ? answer(null, { error: "timeout" }) : answer(crossrefBody([noticeOf(n)]))));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), watchDois(120));
    expect([r.ok, r.data!.answered.length, r.data!.unanswered.length, r.data!.notices.length]).toEqual([true, 70, 50, 2]);
    expect(r.note).toBe("Crossref notices: 50 DOIs not checked.");
  });

  it("fails only when no batch answered, carrying what it learned of the DOIs", async () => {
    const f = fakeFetch(failing("timeout"));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), dois);
    expect([r.ok, r.error, r.data!.unanswered, r.data!.answered]).toEqual([false, "timeout", dois, []]);
    const bad = await readCrossrefUpdates(entry, ctxFor({ fetch: fakeFetch(() => answer("<html>")).fetch }), dois);
    expect([bad.ok, bad.error]).toEqual([false, "parse"]);
  });

  it("with no DOI to ask it sends nothing and reads fine", async () => {
    const f = fakeFetch(() => answer(crossrefBody([])));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), ["bad", "10.1000/a,b"]);
    expect([r.ok, r.requests, f.calls.length, r.data!.skipped]).toEqual([true, 0, 0, ["bad", "10.1000/a,b"]]);
  });

  it("flags a single DOI whose answer holds fewer notices than it says exist, and asks nothing narrower", async () => {
    const f = fakeFetch(() => answer(crossrefBody([noticeOf(1)], 1_300)));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), [dois[0]!]);
    expect(f.calls).toHaveLength(1);
    expect([r.ok, r.requests, r.note, r.data!.truncated, r.data!.answered, r.data!.unanswered]).toEqual([true, 1, null, true, [dois[0]], []]);
    expect(r.data!.notices.map((n) => n.doi)).toEqual(["10.1000/ut-sample-notice-0001"]);
  });

  it("does not flag an answer that holds every notice it says exist, even at the page's size", async () => {
    const f = fakeFetch(() => answer(crossrefBody([noticeOf(1), noticeOf(2)], 2)));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), dois);
    expect([f.calls.length, r.data!.truncated]).toEqual([1, false]);
  });

  it("flags an answer that holds one notice fewer than it says exist (3 said, 2 held), and one that holds every notice it says is whole", async () => {
    const one = watchDois(1);
    const asked = async (total: number) => {
      const f = fakeFetch(() => answer(crossrefBody([noticeOf(1), noticeOf(2)], total)));
      const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), one);
      return [f.calls.length, r.data!.truncated];
    };
    expect(await asked(3)).toEqual([1, true]);
    expect(await asked(2)).toEqual([1, false]);
  });

  // SPEC §5.8 "Settled in P2": a batch whose `total-results` exceeds `rows` halves and is asked again within the feed's budget.
  const askedOf = (url: string): number[] => [...url.matchAll(/ut-sample-rw-(\d{4})/g)].map((m) => Number(m[1]));

  it("splits a batch whose answer holds fewer notices than it says exist into halves, the first half and what it splits into before the second, and keeps the cut answer's notices", async () => {
    const ds = watchDois(5);
    const f = fakeFetch((url) => {
      const ks = askedOf(url);
      if (ks.length === 5) return answer(crossrefBody([noticeOf(5)], 1_300));
      if (ks.length === 3) return answer(crossrefBody([noticeOf(3)], 9));
      return answer(crossrefBody(ks.map((k) => noticeOf(k))));
    });
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), ds);
    expect(f.calls.map((c) => askedOf(c.url))).toEqual([[1, 2, 3, 4, 5], [1, 2, 3], [1, 2], [3], [4, 5]]);
    expect([r.ok, r.requests, r.note]).toEqual([true, 5, null]);
    expect(r.data).toMatchObject({ answered: ds, unanswered: [], truncated: false });
    expect(r.data!.notices.map((n) => n.doi)).toEqual([1, 2, 3, 4, 5].map((k) => `10.1000/ut-sample-notice-000${k}`));
    expect(r.fetched).toHaveLength(5);
  });

  it("splits a full batch of 50 into 25 and 25, and each half is asked with its own DOIs in code-unit order", async () => {
    const ds = watchDois(50);
    const f = fakeFetch((url) => (askedOf(url).length === 50 ? answer(crossrefBody([noticeOf(1)], 2_000)) : answer(crossrefBody([]))));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), [...ds].reverse());
    expect(f.calls.map((c) => askedOf(c.url))).toEqual([ds.map((_, i) => i + 1), ds.slice(0, 25).map((_, i) => i + 1), ds.slice(25).map((_, i) => i + 26)]);
    expect([r.ok, r.requests, r.data!.answered, r.data!.truncated]).toEqual([true, 3, ds, false]);
  });

  it("stops splitting when the budget is spent: the halves not asked are left unanswered, and the cut answer's notices stay", async () => {
    const ds = watchDois(4);
    const f = fakeFetch((url) => {
      const ks = askedOf(url);
      return ks.length >= 2 ? answer(crossrefBody([noticeOf(ks[0]!)], 50)) : answer(crossrefBody(ks.map((k) => noticeOf(k))));
    });
    const r = await readCrossrefUpdates({ ...entry, budget: 3 }, ctxFor({ fetch: f.fetch }), ds);
    expect(f.calls.map((c) => askedOf(c.url))).toEqual([[1, 2, 3, 4], [1, 2], [1]]);
    expect([r.ok, r.requests, r.data!.answered, r.data!.unanswered, r.data!.truncated]).toEqual([true, 3, [ds[0]], ds.slice(1), false]);
    expect(r.note).toBe("Crossref notices: 3 DOIs not checked.");
    expect(r.data!.notices.map((n) => n.doi)).toEqual(["10.1000/ut-sample-notice-0001"]);
  });

  it("leaves a half that fails unanswered and still answers the other half", async () => {
    const ds = watchDois(4);
    const f = fakeFetch((url) => {
      const ks = askedOf(url);
      if (ks.length === 4) return answer(crossrefBody([noticeOf(1)], 20));
      if (ks[0] === 1) return answer(null, { error: "http_503", status: 503 });
      return answer(crossrefBody(ks.map((k) => noticeOf(k))));
    });
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), ds);
    expect([r.ok, r.data!.answered, r.data!.unanswered]).toEqual([true, ds.slice(2), ds.slice(0, 2)]);
  });
});

// ── RSS, RDF and Atom feeds, and the Science Media Centre ────────────────────────────────────────

const rssDoc = (items: string): string => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>A sample feed</title><link>https://example.org/ut-sample/</link>${items}</channel></rss>`;
const rssItem = (title: string, link: string, pub: string | null, desc = ""): string =>
  `<item><title>${title}</title><link>${link}</link>${pub ? `<pubDate>${pub}</pubDate>` : ""}<description>${desc}</description></item>`;

describe("readRssFeed()", () => {
  it("reads RSS 1.0, RSS 2.0 and Atom, each with its own shape, and gives every item its journal's id", async () => {
    fromFixtures();
    const shapes: [string, string][] = [["journal-nature", "<rdf:RDF"], ["journal-annals-of-mathematics", "<rss"], ["lab-sakana-ai", "<feed"]];
    for (const [id, marker] of shapes) {
      const file = id === "lab-sakana-ai" ? "rss/lab-sakana-ai.xml" : `rss/${id}.xml`;
      expect(fixtureText(file), id).toContain(marker);
      const r = await readRssFeed(feedEntry(id), ctxFor());
      expect([r.ok, r.requests, r.fallbackUsed, r.data!.items.length], id).toEqual([true, 1, false, 2]);
      expect(r.data!.items.every((i) => i.journal_id === journalIdOfFeed(id) && i.kind === null && i.types.length === 0), id).toBe(true);
      expect(r.data!.items.every((i) => i.published_at !== null && i.url.startsWith("https://")), id).toBe(true);
      expect(cached(`${id}.xml`), id).toBe(fixtureText(file));
    }
  });

  it("gives the dated item in the window and the older one outside it, newest being the later date", async () => {
    fromFixtures();
    const r = await readRssFeed(feedEntry("journal-grl"), ctxFor());
    expect(r.data!.items.map((i) => [i.title, i.published_at, i.doi])).toEqual([
      ["Sample report grl: a learned model of invented data", "2026-10-21T12:00:00.000Z", "10.1029/ut-sample-journal-grl-0001"],
      ["Sample note grl: an older item outside the window", "2026-10-19T17:00:00.000Z", "10.1029/ut-sample-journal-grl-0002"],
    ]);
    expect(r.data!.items.every((i) => i.journal_id === "geophysical-research-letters")).toBe(true);
    expect(r.data!.newest).toBe("2026-10-21T12:00:00.000Z");
  });

  it("takes markup and entities out of the title and the abstract, and keeps no script", async () => {
    const body = rssDoc(rssItem("A <![CDATA[<b>bold</b>]]> &amp; plain title", "https://example.org/ut-sample/1", "Wed, 21 Oct 2026 02:00:00 +0000",
      "&lt;p&gt;An invented &lt;i&gt;abstract&lt;/i&gt; &amp;amp; more.&lt;/p&gt;&lt;img src=&quot;https://evil.example/p.png&quot;&gt;"));
    const r = await readRssFeed(feedEntry("lab-openai"), ctxFor({ fetch: fakeFetch(() => answer(body)).fetch }));
    expect(r.data!.items[0]!.title).toBe("A bold & plain title");
    expect(r.data!.items[0]!.abstract).toBe("An invented abstract & more.");
    expect(`${r.data!.items[0]!.title} ${r.data!.items[0]!.abstract}`).not.toMatch(/[<>]|evil/);
  });

  it("gives an item with no date a null date, and a feed with no date at all has no newest", async () => {
    const body = rssDoc(rssItem("No date", "https://example.org/ut-sample/2", null) + rssItem("Odd date", "https://example.org/ut-sample/3", "soon"));
    const r = await readRssFeed(feedEntry("lab-openai"), ctxFor({ fetch: fakeFetch(() => answer(body)).fetch }));
    expect(r.data!.items.map((i) => i.published_at)).toEqual([null, null]);
    expect(r.data!.newest).toBeNull();
  });

  it("reads a zone-less time in the feed's zone, and a time with a zone as it says", async () => {
    const atom = (updated: string) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title><entry><title>An entry</title><link href="https://example.org/ut-sample/z"/><id>z</id><updated>${updated}</updated></entry></feed>`;
    const entry = feedEntry("lab-sakana-ai");
    expect(entry.date_zone).toBe("+09:00");
    const zoneless = await readRssFeed(entry, ctxFor({ fetch: fakeFetch(() => answer(atom("2026-10-21T10:00:00"))).fetch }));
    expect(zoneless.data!.items[0]!.published_at).toBe("2026-10-21T01:00:00.000Z");
    const zoned = await readRssFeed(entry, ctxFor({ fetch: fakeFetch(() => answer(atom("2026-10-21T10:00:00Z"))).fetch }));
    expect(zoned.data!.items[0]!.published_at).toBe("2026-10-21T10:00:00.000Z");
  });

  it("tries the feed's fallback URL when the first fails, when it does not parse, and counts both against the budget", async () => {
    const entry = feedEntry("journal-cell");
    expect([entry.budget, typeof entry.fallback_url]).toEqual([2, "string"]);
    const good = rssDoc(rssItem("From the fallback", "https://example.org/ut-sample/fb", "Wed, 21 Oct 2026 02:00:00 +0000"));
    for (const first of [{ status: 500 }, { body: "<html>busy</html>", content_type: "text/html" }]) {
      fromFixtures(writeFixtureDir({ [entry.url]: first, [entry.fallback_url!]: { body: good, content_type: "application/rss+xml" } }));
      const f = recording();
      const r = await readRssFeed(entry, ctxFor({ fetch: f.fetch }));
      expect(f.urls()).toEqual([entry.url, entry.fallback_url]);
      expect([r.ok, r.requests, r.urlUsed, r.fallbackUsed, r.triedFallback]).toEqual([true, 2, entry.fallback_url, true, true]);
      expect(r.data!.items.map((i) => i.title)).toEqual(["From the fallback"]);
      expect(cached("journal-cell.xml")).toBe(good);
    }
  });

  it("fails with the class of the last URL tried when both fail, and when a feed has no fallback after one request", async () => {
    const cell = feedEntry("journal-cell");
    fromFixtures(writeFixtureDir({ [cell.url]: { error: "timeout" }, [cell.fallback_url!]: { status: 404 } }));
    const both = await readRssFeed(cell, ctxFor());
    expect([both.ok, both.error, both.triedFallback, both.urlUsed, both.data]).toEqual([false, "http_404", true, cell.fallback_url, null]);
    const nature = feedEntry("journal-nature");
    fromFixtures(writeFixtureDir({ [nature.url]: { error: "tls" } }));
    const one = await readRssFeed(nature, ctxFor());
    expect([one.ok, one.error, one.triedFallback, one.requests]).toEqual([false, "tls", false, 1]);
  });

  it("never sends more than a feed's budget, retries included, when every request fails", async () => {
    for (const id of ["journal-nature", "journal-cell", "lab-deepmind"]) {
      const entry = feedEntry(id);
      const f = fakeFetch(failing("timeout"));
      const r = await readRssFeed(entry, ctxFor({ fetch: f.fetch }));
      const attempts = f.calls.reduce((n, c) => n + (c.opts.retryDelayMs === 0 ? 1 : 2), 0);
      expect(attempts, id).toBeLessThanOrEqual(entry.budget);
      expect(r.requests, id).toBeLessThanOrEqual(entry.budget);
      expect(r.ok, id).toBe(false);
    }
  });

  it("never fetches an address it finds inside the feed", async () => {
    const body = rssDoc(rssItem("Linked", "https://evil.example/ut-sample/pwn", "Wed, 21 Oct 2026 02:00:00 +0000", "See https://evil.example/ut-sample/more and &lt;a href=&quot;https://evil.example/x&quot;&gt;this&lt;/a&gt;"));
    const f = fakeFetch(() => answer(body));
    const entry = feedEntry("lab-openai");
    await readRssFeed(entry, ctxFor({ fetch: f.fetch }));
    expect(f.urls()).toEqual([entry.url]);
  });
});

describe("readSmc()", () => {
  const entry = feedEntry("smc-reactions");

  it("keeps the items whose path is a reaction, as reactions, and counts everything the feed gave", async () => {
    fromFixtures();
    const r = await readSmc(entry, ctxFor());
    expect(r.data!.items.map((i) => [i.title, i.url, i.published_at, i.kind, i.journal_id])).toEqual([
      ["Expert reaction to a sample study of a learned weather model", "https://www.sciencemediacentre.org/expert-reaction-to-ut-sample-weather-model/", "2026-10-21T02:00:00.000Z", "reaction", null],
      ["Experts react to a sample announcement about language models", "https://www.sciencemediacentre.org/experts-react-to-ut-sample-announcement/", "2026-10-20T12:00:00.000Z", "reaction", null],
    ]);
    expect([r.data!.total, r.data!.newest, r.requests, r.fallbackUsed]).toEqual([3, "2026-10-21T02:00:00.000Z", 1, false]);
    expect(cached("smc-reactions.xml")).toBe(fixtureText("rss/smc-reactions.xml"));
  });

  it("reads its home page when the feed fails, keeps the reaction paths there too, and keeps the page as the feed's html file", async () => {
    fromFixtures(writeFixtureDir({
      [entry.url]: { status: 500 },
      [entry.fallback_url!]: { body: fixtureBytes("pages/feed-smc-reactions.html"), content_type: "text/html; charset=utf-8" },
    }));
    const r = await readSmc(entry, ctxFor());
    expect([r.ok, r.requests, r.fallbackUsed, r.urlUsed]).toEqual([true, 2, true, entry.fallback_url]);
    expect(r.data!.items.map((i) => [i.url, i.published_at, i.kind])).toEqual([["https://www.sciencemediacentre.org/expert-reaction-to-ut-sample-weather-model/", "2026-10-21T00:00:00.000Z", "reaction"]]);
    expect(r.data!.total).toBe(2);
    expect(cached("smc-reactions.html")).toBe(fixtureText("pages/feed-smc-reactions.html"));
    expect(cached("smc-reactions.xml")).toBeNull();
  });

  it("fails as `schema` when the page matches nothing, and when the feed holds no reaction it is an empty list, not a failure", async () => {
    fromFixtures(writeFixtureDir({ [entry.url]: { status: 500 }, [entry.fallback_url!]: { body: "<html><body><p>moved</p></body></html>", content_type: "text/html" } }));
    const bad = await readSmc(entry, ctxFor());
    expect([bad.ok, bad.error, bad.data]).toEqual([false, "schema", null]);
    const none = await readSmc(entry, ctxFor({ fetch: fakeFetch(() => answer(rssDoc(rssItem("A round-up", "https://www.sciencemediacentre.org/roundup/", "Wed, 21 Oct 2026 02:00:00 +0000")))).fetch }));
    expect([none.ok, none.data!.items, none.data!.total]).toEqual([true, [], 1]);
  });

  it("does not take a page's non-reaction path or a link out to another site for a reaction, and counts every article the page gave", async () => {
    const html = `<article class="article-list-item"><header><h3><a href="https://evil.example/expert-reaction-to-x/">Outside</a></h3></header></article>
      <article class="article-list-item"><header><h3><a href="/news/expert-reaction-to-y/">Wrong path</a></h3></header></article>
      <article class="article-list-item"><header><h3><a href="/experts-react-to-z/">Right</a></h3></header><time datetime="2026-10-21">x</time></article>`;
    expect(parseSmcPage(html, "https://www.sciencemediacentre.org/").map((i) => i.url)).toEqual([
      "https://evil.example/expert-reaction-to-x/", "https://www.sciencemediacentre.org/news/expert-reaction-to-y/", "https://www.sciencemediacentre.org/experts-react-to-z/",
    ]);
    fromFixtures(writeFixtureDir({ [entry.url]: { status: 500 }, [entry.fallback_url!]: { body: html, content_type: "text/html" } }));
    const r = await readSmc(entry, ctxFor());
    expect(r.data!.items.map((i) => [i.url, i.published_at])).toEqual([["https://www.sciencemediacentre.org/experts-react-to-z/", "2026-10-21T00:00:00.000Z"]]);
    expect(r.data!.total).toBe(3);
    const feedBody = rssDoc(rssItem("Outside", "https://evil.example/expert-reaction-to-x/", "Wed, 21 Oct 2026 02:00:00 +0000"));
    const viaFeed = await readSmc(entry, ctxFor({ fetch: fakeFetch(() => answer(feedBody)).fetch }));
    expect([viaFeed.data!.items, viaFeed.data!.total]).toEqual([[], 1]);
  });
});

// ── Page feeds ───────────────────────────────────────────────────────────────────────────────────

describe("the page parsers, on small pages", () => {
  const days = (items: { day: string | null }[]) => items.map((i) => i.day);

  it("EurekAlert!: article.post with a release link, the date printed as DD-Mon-YYYY, each release once, not the browse pages", () => {
    const html = `<article class="post"><a href="/news-releases/1001">First</a><p>Placeholder University | Peer-Reviewed Publication | 21-Oct-2026</p></article>
      <article class="post"><a href="/news-releases/browse/all">Browse</a></article>
      <article class="post"><a href="/news-releases/1001">First again</a></article>
      <article class="post"><a href="mailto:ut-sample@example.org">mail</a></article>
      <article class="post"><a href="/news-releases/1002"> </a></article>
      <article class="post"><a href="/news-releases/1003"><span>Third</span></a><p>No date here</p></article>
      <div class="other"><a href="/news-releases/1004">Not in an article</a></div>`;
    const items = parseEurekAlert(html, "https://www.eurekalert.org/news-releases/browse");
    expect(items.map((i) => [i.title, i.url, i.day])).toEqual([
      ["First", "https://www.eurekalert.org/news-releases/1001", "2026-10-21"], ["Third", "https://www.eurekalert.org/news-releases/1003", null],
    ]);
  });

  it("EurekAlert!: finds the date when the page is minified and no space separates the elements", () => {
    const html = '<article class="post"><a href="/news-releases/1001">First</a><span>Peer-Reviewed Publication</span><span>20-Oct-2026</span></article>';
    expect(days(parseEurekAlert(html, "https://www.eurekalert.org/"))).toEqual(["2026-10-20"]);
  });

  it("Anthropic's research page: one slug under /research/, the nearest time (its datetime, else its text), not the index, a deeper page or an outside link", () => {
    const html = `<ul>
      <li><div><time datetime="2026-10-20T09:30:00Z">Oct 20, 2026</time><a href="/research/slug-a"><h3>Title A</h3></a></div></li>
      <li><div><a href="/research">All research</a></div></li>
      <li><div><a href="/research/">Index again</a></div></li>
      <li><div><a href="/research/team/x">A team page</a></div></li>
      <li><div><time>Oct 14, 2026</time><a href="/research/slug-b/">Title B</a></div></li>
      <li><div><a href="/research/slug-c">Title C without a date</a></div></li>
      <li><div><a href="https://elsewhere.example/research/slug-d">Outside</a></div></li></ul>`;
    const items = parseAnthropic(html, "https://www.anthropic.com/research", false);
    expect(items.map((i) => [i.title, i.url, i.day])).toEqual([
      ["Title A", "https://www.anthropic.com/research/slug-a", "2026-10-20"], ["Title B", "https://www.anthropic.com/research/slug-b/", "2026-10-14"],
      ["Title C without a date", "https://www.anthropic.com/research/slug-c", null],
    ]);
  });

  it("Anthropic's news page, the fallback: an article with a /news/ slug and its time", () => {
    const html = `<article><time>Oct 21, 2026</time><a href="/news/slug-a"><h3>News A</h3></a></article>
      <article><a href="/news">All news</a></article><article><a href="/news/a/b"><h3>Deep</h3></a></article>`;
    expect(parseAnthropic(html, "https://www.anthropic.com/news", true).map((i) => [i.url, i.day])).toEqual([["https://www.anthropic.com/news/slug-a", "2026-10-21"]]);
    expect(parseAnthropic(html, "https://www.anthropic.com/news", false)).toEqual([]);
  });

  it("Meta's blog: a link with a slug under /blog/ and the date in its card, even when the card is minified; not the blog's own index", () => {
    const html = `<div class="card"><a href="/blog/slug-one/"><h3>Title One</h3></a><p>July 9, 2026</p></div>
      <div class="card"><a href="/blog/slug-two/"><h3>Title Two</h3></a></div>
      <div class="card"><a href="/blog/">All posts</a></div><div class="card"><a href="/blog/a/b/">Deep</a></div>`;
    expect(parseMetaFair(html, "https://ai.meta.com/blog/").map((i) => [i.title, i.url, i.day])).toEqual([
      ["Title One", "https://ai.meta.com/blog/slug-one/", "2026-07-09"], ["Title Two", "https://ai.meta.com/blog/slug-two/", null],
    ]);
  });

  it("FutureHouse: a card's cover link under /research/, titled by the link or else the card's heading, each page once, no date", () => {
    const html = `<div class="card"><a class="u-link-cover" href="/research/a"></a><h3>Heading A</h3></div>
      <div class="card"><a class="u-link-cover" href="/research/b">Title B</a></div>
      <div class="card"><a class="u-link-cover" href="/research">All</a></div>
      <div class="card"><a class="u-link-cover" href="/research/b">Duplicate</a></div>
      <div class="card"><a class="other" href="/research/c">Not a cover link</a></div>`;
    expect(parseFutureHouse(html, "https://www.futurehouse.org/research").map((i) => [i.title, i.url, i.day])).toEqual([
      ["Heading A", "https://www.futurehouse.org/research/a", null], ["Title B", "https://www.futurehouse.org/research/b", null],
    ]);
  });

  it("Periodic Labs: a link written ./news/<slug> that holds a time with a datetime, read against the page; a link with no such time is left out", () => {
    const html = `<a href="./news/one"><time datetime="2026-09-15T00:00:00.000Z">Sep 15, 2026</time><span>Post One</span></a>
      <a href="./news/two"><time>Aug 2, 2026</time><span>No datetime</span></a>
      <a href="./news/three"><span>No time</span></a>
      <a href="./news/four"><time datetime="2026-08-02">Aug 2</time><span>Post Four</span></a>`;
    expect(parsePeriodic(html, "https://periodic.com/news").map((i) => [i.title, i.url, i.day])).toEqual([
      ["Post One", "https://periodic.com/news/one", "2026-09-15"], ["Post Four", "https://periodic.com/news/four", "2026-08-02"],
    ]);
  });

  it("Isomorphic Labs: a news card or the featured title under /articles/, a heading before a bare link, each page once, no date", () => {
    const html = `<a class="news-featured_title" href="/articles/one">Featured One</a>
      <a class="news-card" href="/articles/two"><h4>Card Two</h4></a>
      <a class="news-card" href="/articles/one"><h4>Same page, with a heading</h4></a>
      <a class="news-card" href="/other/three"><h4>Not an article</h4></a>`;
    expect(parseIsomorphic(html, "https://www.isomorphiclabs.com/news").map((i) => [i.title, i.url, i.day])).toEqual([
      ["Same page, with a heading", "https://www.isomorphiclabs.com/articles/one", null], ["Card Two", "https://www.isomorphiclabs.com/articles/two", null],
    ]);
  });

  it("Lila: a news item's /news/ link and the date text beside it, even when minified; an outside link is no match", () => {
    const html = `<div class="news-list_item"><a href="/news/one"><h3>Post One</h3></a><p>October 20, 2026</p></div>
      <div class="news-list_item"><a href="https://press.example/story"><h3>Outside press</h3></a><p>October 5, 2026</p></div>
      <div class="news-list_item"><a href="/news/two"><h3>Post Two</h3></a></div>`;
    expect(parseLila(html, "https://www.lila.ai/news").map((i) => [i.title, i.url, i.day])).toEqual([
      ["Post One", "https://www.lila.ai/news/one", "2026-10-20"], ["Post Two", "https://www.lila.ai/news/two", null],
    ]);
  });

  it("Arc: a post item's /news/ link in its heading and the item's time", () => {
    const html = `<article class="PostList_postItem__a1"><h3><a href="/news/one">Post One</a></h3><time datetime="2026-10-12T00:00:00.000Z">Oct 12, 2026</time></article>
      <article class="Other_item"><h3><a href="/news/two">Not a post item</a></h3></article>
      <article class="PostList_postItem__a2"><h3><a href="/about/three">Wrong path</a></h3></article>`;
    expect(parseArc(html, "https://arcinstitute.org/news").map((i) => [i.title, i.url, i.day])).toEqual([["Post One", "https://arcinstitute.org/news/one", "2026-10-12"]]);
  });

  it("the Erdős problems: a thread item's title link and the date its item prints (DD Mon YYYY), minified too", () => {
    const html = `<ul class="thread-list"><li class="thread-item"><a class="thread-title" href="/forum/thread/1">Thread One</a><span>08 Oct 2026</span></li>
      <li class="thread-item"><a class="thread-title" href="/forum/thread/2">Thread Two</a></li>
      <li class="other"><a class="thread-title" href="/forum/thread/3">Not a thread item</a></li></ul>`;
    expect(parseErdos(html, "https://www.erdosproblems.com/").map((i) => [i.title, i.url, i.day])).toEqual([
      ["Thread One", "https://www.erdosproblems.com/forum/thread/1", "2026-10-08"], ["Thread Two", "https://www.erdosproblems.com/forum/thread/2", null],
    ]);
  });

  it("drops a link that is not an http address and never reads a javascript: link as a page", () => {
    const html = `<article class="post"><a href="javascript:alert(1)">Bad</a></article><article class="post"><a href="/news-releases/1">Good</a></article>`;
    expect(parseEurekAlert(html, "https://www.eurekalert.org/").map((i) => i.url)).toEqual(["https://www.eurekalert.org/news-releases/1"]);
  });
});

describe("readPageFeed()", () => {
  const fixtureItems = (id: string) => {
    const r = readPageFeed(feedEntry(id), ctxFor());
    return r.then((x) => x.data!.items.map((i) => [i.title, i.url, i.published_at]));
  };

  it("reads each of the nine page feeds' fixture in the shape the spec's table gives, and keeps the page as <id>.html", async () => {
    fromFixtures();
    expect(await fixtureItems("lab-anthropic")).toEqual([
      ["A sample study of invented model features", "https://www.anthropic.com/research/ut-sample-interpretability", "2026-10-20T00:00:00.000Z"],
      ["Sample evaluations of an invented assistant", "https://www.anthropic.com/research/ut-sample-evals", "2026-10-14T00:00:00.000Z"],
    ]);
    expect(await fixtureItems("lab-meta-fair")).toEqual([
      ["A sample vision model for invented images", "https://ai.meta.com/blog/ut-sample-vision-model/", "2026-10-15T00:00:00.000Z"],
      ["A sample speech model", "https://ai.meta.com/blog/ut-sample-speech/", "2026-09-28T00:00:00.000Z"],
    ]);
    expect(await fixtureItems("lab-futurehouse")).toEqual([
      ["A sample agent for invented literature", "https://www.futurehouse.org/research/ut-sample-agent", null],
      ["A sample benchmark of invented questions", "https://www.futurehouse.org/research/ut-sample-bench", null],
    ]);
    expect(await fixtureItems("lab-periodic-labs")).toEqual([
      ["A sample lab opens its invented doors", "https://periodic.com/news/ut-sample-first", "2026-09-15T00:00:00.000Z"],
      ["A second sample post", "https://periodic.com/news/ut-sample-second", "2026-08-02T00:00:00.000Z"],
    ]);
    expect(await fixtureItems("lab-isomorphic-labs")).toEqual([
      ["A sample featured article", "https://www.isomorphiclabs.com/articles/ut-sample-featured", null],
      ["A sample card", "https://www.isomorphiclabs.com/articles/ut-sample-card-one", null],
      ["Another sample card", "https://www.isomorphiclabs.com/articles/ut-sample-card-two", null],
    ]);
    expect(await fixtureItems("lab-lila-sciences")).toEqual([
      ["A sample launch of an invented laboratory", "https://www.lila.ai/news/ut-sample-launch", "2026-10-20T00:00:00.000Z"],
      ["A sample funding round", "https://www.lila.ai/news/ut-sample-funding", "2026-10-06T00:00:00.000Z"],
    ]);
    expect(await fixtureItems("lab-arc-institute")).toEqual([
      ["A sample model of invented cells", "https://arcinstitute.org/news/ut-sample-cell-model", "2026-10-12T00:00:00.000Z"],
      ["A sample grant note", "https://arcinstitute.org/news/ut-sample-grant", "2026-09-30T00:00:00.000Z"],
    ]);
    expect(await fixtureItems("erdos")).toEqual([
      ["A sample note on invented problem 99001", "https://www.erdosproblems.com/forum/thread/ut-sample-1", "2026-10-21T00:00:00.000Z"],
      ["Another sample thread", "https://www.erdosproblems.com/forum/thread/ut-sample-2", "2026-10-08T00:00:00.000Z"],
    ]);
    expect(await fixtureItems("eurekalert")).toEqual([
      ["A sample lab trains a language model on invented spectra", "https://www.eurekalert.org/news-releases/9990001", "2026-10-21T00:00:00.000Z"],
      ["Sample survey of invented soil samples", "https://www.eurekalert.org/news-releases/9990002", "2026-10-20T00:00:00.000Z"],
      ["A sample prize for an invented proof", "https://www.eurekalert.org/news-releases/9990003", "2026-10-19T00:00:00.000Z"],
    ]);
  });

  it("covers every page feed in the registry that has a reader, with no reader for any other", () => {
    const pages = realConfig().sources.feeds.filter((f) => f.parser === "html" && readerKind(f) === "page").map((f) => f.id).sort(byCodeUnit);
    expect(Object.keys(PAGE_FEEDS).sort(byCodeUnit)).toEqual(pages);
    expect(pages).toHaveLength(9);
  });

  it("keeps the first page's body as the feed's file and a manifest row for each page read", async () => {
    fromFixtures();
    const r = await readPageFeed(feedEntry("eurekalert"), ctxFor());
    expect(cached("eurekalert.html")).toBe(fixtureText("pages/feed-eurekalert.html"));
    expect(r.fetched.map((x) => x.url)).toEqual(["https://www.eurekalert.org/news-releases/browse", "https://www.eurekalert.org/news-releases/browse?page=2"]);
    expect(r.fetched.map((x) => x.sha256)).toEqual(["pages/feed-eurekalert.html", "pages/feed-eurekalert-2.html"].map((x) => sha256Hex(fixtureBytes(x))));
    expect([r.requests, r.bytes]).toEqual([2, fixtureBytes("pages/feed-eurekalert.html").length + fixtureBytes("pages/feed-eurekalert-2.html").length]);
  });

  it("EurekAlert!: asks for the second browse page after the first, within its budget of 2, and reads each release once", async () => {
    fromFixtures();
    const f = recording();
    const r = await readPageFeed(feedEntry("eurekalert"), ctxFor({ fetch: f.fetch }));
    expect(f.urls()).toEqual(["https://www.eurekalert.org/news-releases/browse", "https://www.eurekalert.org/news-releases/browse?page=2"]);
    expect(r.data!.items.map((i) => i.url)).toEqual([
      "https://www.eurekalert.org/news-releases/9990001", "https://www.eurekalert.org/news-releases/9990002", "https://www.eurekalert.org/news-releases/9990003",
    ]);
    expect([r.ok, r.requests, r.note, r.data!.unread]).toEqual([true, 2, null, []]);
    expect(PAGE_FEEDS.eurekalert!.more!("https://example.org/b")).toEqual(["https://example.org/b?page=2"]);
    expect(PAGE_FEEDS.eurekalert!.more!("https://example.org/b?x=1")).toEqual(["https://example.org/b?x=1&page=2"]);
  });

  it("EurekAlert!: a second page that fails, is a JSON error or matches nothing is left unread and noted, and the first page's items stand", async () => {
    const first = { body: fixtureBytes("pages/feed-eurekalert.html"), content_type: "text/html" };
    const second = "https://www.eurekalert.org/news-releases/browse?page=2";
    const cases: Record<string, { body?: string; content_type?: string; error?: "timeout" }> = {
      "a failed request": { error: "timeout" }, "a JSON answer": { body: '{"error":"x"}', content_type: "application/json" },
      "a good page sent as JSON (the type is judged, not the body)": { body: fixtureBytes("pages/feed-eurekalert-2.html").toString("utf8"), content_type: "application/json" },
      "a page with no release": { body: "<html><body>none</body></html>", content_type: "text/html" },
    };
    for (const [name, answerOf] of Object.entries(cases)) {
      fromFixtures(writeFixtureDir({ "https://www.eurekalert.org/news-releases/browse": first, [second]: answerOf }));
      const r = await readPageFeed(feedEntry("eurekalert"), ctxFor());
      expect([r.ok, r.data!.items.length, r.note, r.data!.unread], name).toEqual([true, 2, "eurekalert: 1 more page not read.", [second]]);
    }
  });

  it("falls back to the registry's other URL when the page fails, and Anthropic's /news page is read as the fallback form", async () => {
    const entry = feedEntry("lab-anthropic");
    fromFixtures(writeFixtureDir({ [entry.url]: { status: 502 }, [entry.fallback_url!]: { body: fixtureBytes("pages/feed-lab-anthropic-news.html"), content_type: "text/html; charset=utf-8" } }));
    const f = recording();
    const r = await readPageFeed(entry, ctxFor({ fetch: f.fetch }));
    expect(f.urls()).toEqual([entry.url, entry.fallback_url]);
    expect([r.ok, r.fallbackUsed, r.urlUsed, r.requests]).toEqual([true, true, entry.fallback_url, 2]);
    expect(r.data!.items.map((i) => [i.url, i.published_at])).toEqual([
      ["https://www.anthropic.com/news/ut-sample-announcement", "2026-10-21T00:00:00.000Z"], ["https://www.anthropic.com/news/ut-sample-partnership", "2026-10-12T00:00:00.000Z"],
    ]);
  });

  it("falls back when the page matches nothing, and fails as `schema` when neither URL matches", async () => {
    const entry = feedEntry("lab-anthropic");
    const empty = { body: "<html><body><p>New design</p></body></html>", content_type: "text/html" };
    fromFixtures(writeFixtureDir({ [entry.url]: empty, [entry.fallback_url!]: { body: fixtureBytes("pages/feed-lab-anthropic-news.html"), content_type: "text/html" } }));
    expect((await readPageFeed(entry, ctxFor())).fallbackUsed).toBe(true);
    fs.rmSync(path.join(root, "cache"), { recursive: true, force: true });
    fromFixtures(writeFixtureDir({ [entry.url]: empty, [entry.fallback_url!]: empty }));
    const r = await readPageFeed(entry, ctxFor());
    expect([r.ok, r.error, r.triedFallback, r.data]).toEqual([false, "schema", true, null]);
    expect(cached("lab-anthropic.html")).toBeNull();
  });

  it("a page that matches no item is a `schema` failure, never an empty feed", async () => {
    const entry = feedEntry("lab-futurehouse");
    const ctx = ctxFor({ fetch: fakeFetch(() => answer("<html><body><div>redesigned</div></body></html>", { contentType: "text/html" })).fetch });
    const r = await readPageFeed(entry, ctx);
    expect([r.ok, r.error, r.data, r.requests]).toEqual([false, "schema", null, 1]);
    expect(ctx.lines.some((l) => l.includes("the page has no item that matches the selector"))).toBe(true);
  });

  it("refuses a JSON, XML or PDF body where a page was expected, as `parse`, and accepts text/plain and an unnamed type", async () => {
    const entry = feedEntry("lab-futurehouse");
    const page = fixtureBytes("pages/feed-lab-futurehouse.html");
    for (const type of ["application/json", "application/pdf", "application/xml", "image/png"]) {
      const r = await readPageFeed(entry, ctxFor({ fetch: fakeFetch(() => answer(page, { contentType: type })).fetch }));
      expect([r.ok, r.error], type).toEqual([false, "parse"]);
    }
    for (const type of ["text/plain", "text/html; charset=ISO-8859-1", "application/xhtml+xml", null]) {
      const r = await readPageFeed(entry, ctxFor({ fetch: fakeFetch(() => answer(page, { contentType: type })).fetch }));
      expect([r.ok, r.data!.items.length], String(type)).toEqual([true, 2]);
    }
  });

  it("reads an item's day in the feed's zone: the start of that day there, as an instant", async () => {
    const entry = { ...feedEntry("lab-arc-institute"), date_zone: "+09:00" };
    fromFixtures();
    const r = await readPageFeed(entry, ctxFor());
    expect(r.data!.items[0]!.published_at).toBe("2026-10-11T15:00:00.000Z");
  });

  it("throws for a feed with no page reader, which is a call that should never be made", async () => {
    await expect(readPageFeed({ ...feedEntry("erdos"), id: "no-such-page-feed" }, ctxFor())).rejects.toThrow("No page reader for no-such-page-feed");
    for (const id of ["constructor", "__proto__", "toString"]) await expect(readPageFeed({ ...feedEntry("erdos"), id }, ctxFor()), id).rejects.toThrow(/No page reader/);
  });

  it("never fetches an address found on a page", async () => {
    const html = '<div class="card"><a class="u-link-cover" href="/research/a">A</a><a href="https://evil.example/ut-sample/pwn">B</a></div>';
    const f = fakeFetch(() => answer(html, { contentType: "text/html" }));
    const entry = feedEntry("lab-futurehouse");
    await readPageFeed(entry, ctxFor({ fetch: f.fetch }));
    expect(f.urls()).toEqual([entry.url]);
  });
});

// ── The counters' sources (SPEC §5.7) ────────────────────────────────────────────────────────────

const CTGOV_URL = "https://clinicaltrials.gov/api/v2/studies";
const nctIds = (n: number, from = 1): string[] => Array.from({ length: n }, (_, i) => `NCT${String(10_000_000 + from + i)}`);
const ctgovStudy = (id: string, status = "RECRUITING", phases: string[] = ["PHASE2"]) =>
  ({ protocolSection: { identificationModule: { nctId: id }, statusModule: { overallStatus: status }, designModule: { phases } } });

describe("ClinicalTrials.gov", () => {
  const entry = feedEntry("ctgov");

  it("asks for the ids it is given with the page size set to their number, the commas as written", () => {
    expect(ctgovUrl(CTGOV_URL, ["NCT09990201", "NCT09990202"])).toBe("https://clinicaltrials.gov/api/v2/studies?filter.ids=NCT09990201,NCT09990202&pageSize=2&fields=NCTId,OverallStatus,Phase");
    expect(CTGOV_BATCH).toBe(100);
  });

  it("parseCtgov(): each study's status and phases by NCT id, leaving out a study with no readable id", () => {
    const body = JSON.stringify({ studies: [ctgovStudy("NCT09990201"), ctgovStudy("NCT09990203", "COMPLETED", ["PHASE1", "PHASE2"]), ctgovStudy("bad"), { protocolSection: {} }, "x", ctgovStudy("NCT09990204", "", [])] });
    const got = parseCtgov(Buffer.from(body));
    expect([...got.keys()]).toEqual(["NCT09990201", "NCT09990203", "NCT09990204"]);
    expect(got.get("NCT09990203")).toEqual({ protocolSection: { statusModule: { overallStatus: "COMPLETED" }, designModule: { phases: ["PHASE1", "PHASE2"] } } });
    expect(got.get("NCT09990204")).toEqual({ protocolSection: { statusModule: {}, designModule: { phases: [] } } });
  });

  it("parseCtgov(): an answer that has a next page is not the whole list, no studies list is `schema`, and no JSON is `parse`", () => {
    const code = (body: string) => {
      try {
        parseCtgov(Buffer.from(body));
      } catch (e) {
        return (e as FeedParseError).errorClass;
      }
      return null;
    };
    expect(code(JSON.stringify({ studies: [], nextPageToken: "abc" }))).toBe("schema");
    expect(code(JSON.stringify({ studies: [], nextPageToken: "" }))).toBeNull();
    expect(code("{}")).toBe("schema");
    expect(code("nope")).toBe("parse");
  });

  it("readCtgov(): asks for each id once, in code-unit order, and gives every id asked: its study, or null for one the registry has none for", async () => {
    fromFixtures();
    const f = recording();
    const r = await readCtgov(entry, ctxFor({ fetch: f.fetch }), ["NCT09990203", "NCT09990201", "NCT09990202", "NCT09990201"]);
    expect(f.urls()).toEqual(["https://clinicaltrials.gov/api/v2/studies?filter.ids=NCT09990201,NCT09990202,NCT09990203&pageSize=3&fields=NCTId,OverallStatus,Phase"]);
    expect([r.ok, r.requests, r.note, r.error]).toEqual([true, 1, null, null]);
    expect([...r.data!.keys()]).toEqual(["NCT09990201", "NCT09990202", "NCT09990203"]);
    expect(r.data!.get("NCT09990201")).toEqual({ protocolSection: { statusModule: { overallStatus: "RECRUITING" }, designModule: { phases: ["PHASE2"] } } });
    expect(r.data!.get("NCT09990202")).toBeNull();
    expect(r.data!.get("NCT09990203")?.protocolSection?.designModule?.phases).toEqual(["PHASE1", "PHASE2"]);
    expect(cached("ctgov.p0.json")).toBe(fixtureText("api/ctgov-studies.json"));
  });

  it("readCtgov(): an id that is no NCT id is not asked, is null in the answer, and is logged", async () => {
    const f = fakeFetch(() => answer(fixtureBytes("api/ctgov-studies.json")));
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readCtgov(entry, ctx, ["NCT09990201", "nct09990201", "NCT123", "", "NCT09990202 ", "NCT09990203"]);
    expect(f.urls()).toEqual(["https://clinicaltrials.gov/api/v2/studies?filter.ids=NCT09990201,NCT09990203&pageSize=2&fields=NCTId,OverallStatus,Phase"]);
    expect([...r.data!.entries()].map(([k, v]) => [k, v === null]).sort()).toEqual([
      ["", true], ["NCT09990201", false], ["NCT09990202 ", true], ["NCT123", true], ["NCT09990203", false], ["nct09990201", true],
    ].sort());
    expect(ctx.lines.filter((l) => l.includes("is not an NCT id")).length).toBe(4);
  });

  it("readCtgov(): asks 100 ids a request, so 101 ids are two requests, and keeps each body as ctgov.p<k>.json in the order of the manifest", async () => {
    const ids = nctIds(101);
    const f = fakeFetch((url) => {
      const asked = /filter\.ids=([^&]+)/.exec(url)![1]!.split(",");
      return answer(JSON.stringify({ studies: asked.map((id) => ctgovStudy(id)) }));
    });
    const r = await readCtgov(entry, ctxFor({ fetch: f.fetch }), ids);
    expect(f.calls.map((c) => /pageSize=(\d+)/.exec(c.url)![1])).toEqual(["100", "1"]);
    expect([r.ok, r.requests, r.data!.size, r.fetched.length]).toEqual([true, 2, 101, 2]);
    expect(cached("ctgov.p0.json")).not.toBeNull();
    expect(cached("ctgov.p1.json")).not.toBeNull();
    expect(cached("ctgov.p2.json")).toBeNull();
  });

  it("readCtgov(): a batch that fails leaves its ids out of the answer and fails the read, with the other batches' studies kept", async () => {
    const ids = nctIds(250);
    let n = 0;
    const f = fakeFetch((url) => {
      n += 1;
      if (n === 2) return answer(null, { error: "timeout" });
      const asked = /filter\.ids=([^&]+)/.exec(url)![1]!.split(",");
      return answer(JSON.stringify({ studies: asked.map((id) => ctgovStudy(id)) }));
    });
    const r = await readCtgov(entry, ctxFor({ fetch: f.fetch }), ids);
    expect([r.ok, r.error, r.requests]).toEqual([false, "timeout", 3]);
    expect(r.data!.size).toBe(150);
    expect(r.data!.has(ids[100]!)).toBe(false);
    expect(r.data!.has(ids[0]!)).toBe(true);
    expect(r.data!.has(ids[249]!)).toBe(true);
  });

  it("readCtgov(): never sends more than the budget of 10, and fails with the ids past it left out", async () => {
    const f = fakeFetch((url) => answer(JSON.stringify({ studies: /filter\.ids=([^&]+)/.exec(url)![1]!.split(",").map((id) => ctgovStudy(id)) })));
    const r = await readCtgov(entry, ctxFor({ fetch: f.fetch }), nctIds(1_200));
    expect(entry.budget).toBe(10);
    expect(f.calls).toHaveLength(10);
    expect([r.ok, r.error, r.requests, r.data!.size]).toEqual([false, "timeout", 10, 1_000]);
  });

  it("readCtgov(): a next page, or a body that is no JSON, fails the batch with its class", async () => {
    const paged = await readCtgov(entry, ctxFor({ fetch: fakeFetch(() => answer(JSON.stringify({ studies: [], nextPageToken: "x" }))).fetch }), ["NCT09990201"]);
    expect([paged.ok, paged.error, paged.data!.size]).toEqual([false, "schema", 0]);
    const bad = await readCtgov(entry, ctxFor({ fetch: fakeFetch(() => answer("<html>")).fetch }), ["NCT09990201"]);
    expect([bad.ok, bad.error]).toEqual([false, "parse"]);
  });

  it("cachedCtgov(): reads the same studies back from the bodies the manifest names, and nothing from a body that changed or is gone", async () => {
    fromFixtures();
    const r = await readCtgov(entry, ctxFor(), ["NCT09990201", "NCT09990202", "NCT09990203"]);
    expect(cachedCtgov(root, r.fetched)).toEqual(r.data);
    expect(cachedCtgov(root, [])).toBeNull();
    fs.writeFileSync(path.join(root, "cache", "feeds", "ctgov.p0.json"), `${fixtureText("api/ctgov-studies.json")} `);
    expect(cachedCtgov(root, r.fetched)).toBeNull();
    fs.rmSync(path.join(root, "cache", "feeds", "ctgov.p0.json"));
    expect(cachedCtgov(root, r.fetched)).toBeNull();
  });
});

const RCSB_URL = "https://search.rcsb.org/rcsbsearch/v2/query";
const RCSB_2025_URL = `${RCSB_URL}?json=%7B%22query%22%3A%7B%22type%22%3A%22terminal%22%2C%22service%22%3A%22text%22%2C%22parameters%22%3A%7B%22attribute%22%3A%22rcsb_accession_info.deposit_date%22%2C%22operator%22%3A%22range%22%2C%22value%22%3A%7B%22from%22%3A%222025-01-01%22%2C%22to%22%3A%222025-12-31%22%2C%22include_lower%22%3Atrue%2C%22include_upper%22%3Atrue%7D%7D%7D%2C%22return_type%22%3A%22entry%22%2C%22request_options%22%3A%7B%22return_counts%22%3Atrue%7D%7D`;
const RCSB_2026_URL = `${RCSB_URL}?json=%7B%22query%22%3A%7B%22type%22%3A%22terminal%22%2C%22service%22%3A%22text%22%2C%22parameters%22%3A%7B%22attribute%22%3A%22rcsb_accession_info.deposit_date%22%2C%22operator%22%3A%22range%22%2C%22value%22%3A%7B%22from%22%3A%222026-01-01%22%2C%22to%22%3A%222026-10-22%22%2C%22include_lower%22%3Atrue%2C%22include_upper%22%3Atrue%7D%7D%7D%2C%22return_type%22%3A%22entry%22%2C%22request_options%22%3A%7B%22return_counts%22%3Atrue%7D%7D`;

describe("RCSB counts", () => {
  const entry = feedEntry("rcsb");

  it("the query is the range of the deposit date, both ends included, asking for a count only", () => {
    expect(rcsbQuery("2026-01-01", "2026-10-22")).toBe(
      '{"query":{"type":"terminal","service":"text","parameters":{"attribute":"rcsb_accession_info.deposit_date","operator":"range","value":{"from":"2026-01-01","to":"2026-10-22","include_lower":true,"include_upper":true}}},"return_type":"entry","request_options":{"return_counts":true}}',
    );
    expect(rcsbCountUrl(RCSB_URL, "2025-01-01", "2025-12-31")).toBe(RCSB_2025_URL);
    expect(rcsbCountUrl(RCSB_URL, "2026-01-01", "2026-10-22")).toBe(RCSB_2026_URL);
  });

  it("parseRcsbCount(): the total_count; a missing, negative, fractional or text count is `schema`, and no JSON is `parse`", () => {
    expect(parseRcsbCount(Buffer.from('{"total_count": 17052}'))).toBe(17052);
    expect(parseRcsbCount(Buffer.from('{"total_count": 0}'))).toBe(0);
    for (const body of ['{"total_count": -1}', '{"total_count": 1.5}', '{"total_count": "17052"}', "{}", '{"result_set": []}']) {
      expect(() => parseRcsbCount(Buffer.from(body)), body).toThrow(/no total_count/);
    }
    expect(() => parseRcsbCount(Buffer.from("<html>"))).toThrow(FeedParseError);
  });

  it("readRcsbCounts(): last year in full and this year to the run's day, one GET each, keyed by year", async () => {
    fromFixtures();
    const f = recording();
    const r = await readRcsbCounts(entry, ctxFor({ fetch: f.fetch }), "2026-10-22");
    expect(f.urls()).toEqual([RCSB_2025_URL, RCSB_2026_URL]);
    expect([r.ok, r.requests, r.data, r.urlUsed]).toEqual([true, 2, { "2025": 17052, "2026": 4632 }, RCSB_2026_URL]);
    expect(cached("rcsb.p0.json")).toBe(fixtureText("api/rcsb-2025.json"));
    expect(cached("rcsb.p1.json")).toBe(fixtureText("api/rcsb-2026.json"));
    expect(r.fetched.map((x) => x.url)).toEqual([RCSB_2025_URL, RCSB_2026_URL]);
  });

  it("readRcsbCounts(): both counts must answer, since one count is no reading", async () => {
    fromFixtures(writeFixtureDir({ [RCSB_2025_URL]: { body: fixtureBytes("api/rcsb-2025.json"), content_type: "application/json" }, [RCSB_2026_URL]: { error: "timeout" } }));
    const second = await readRcsbCounts(entry, ctxFor(), "2026-10-22");
    expect([second.ok, second.error, second.data, second.urlUsed]).toEqual([false, "timeout", null, RCSB_2026_URL]);
    fromFixtures(writeFixtureDir({ [RCSB_2025_URL]: { error: "dns" } }));
    const f = recording();
    const first = await readRcsbCounts(entry, ctxFor({ fetch: f.fetch }), "2026-10-22");
    expect([first.ok, first.error, first.requests, f.calls.length]).toEqual([false, "dns", 1, 1]);
  });

  it("readRcsbCounts(): an answer with no count is `schema` and writes no cache", async () => {
    const f = fakeFetch(() => answer('{"result_type":"entry"}'));
    const r = await readRcsbCounts(entry, ctxFor({ fetch: f.fetch }), "2026-10-22");
    expect([r.ok, r.error, r.requests]).toEqual([false, "schema", 1]);
    expect(cached("rcsb.p0.json")).toBeNull();
  });
});

describe("RCSB's holdings file", () => {
  const entry = feedEntry("rcsb-unreleased");
  const holdings = { "9ZZ1": { status_code: "AUTH", deposit_date: "2026-03-02T00:00:00+00:00" }, "9ZZ2": { status_code: "WDRN", deposit_date: "2025-04-04T00:00:00+00:00" } };

  it("holdingsText(): unzips a gzip by its magic bytes, reads a plain body as it is (a server that unzips in transit), and caps what a gzip unzips to", () => {
    expect(holdingsText(gzipJson({ a: 1 }))).toBe('{"a":1}');
    expect(holdingsText(Buffer.from('{"a":1}'))).toBe('{"a":1}');
    expect(UNZIPPED_CAP).toBe(64 * 1024 * 1024);
    const bomb = zlib.gzipSync(Buffer.alloc(100_000, 65));
    expect(bomb.length).toBeLessThan(1_000);
    expect(() => holdingsText(bomb, 1_000)).toThrow(ReadFail);
    try {
      holdingsText(bomb, 1_000);
    } catch (e) {
      expect(parseClass(e)).toBe("too_large");
    }
    expect(() => holdingsText(Buffer.alloc(1_001, 65), 1_000)).toThrow(/over 1000 bytes/);
    expect(holdingsText(Buffer.alloc(1_000, 65), 1_000)).toHaveLength(1_000);
  });

  it("holdingsText(): a body that starts like a gzip and is not one is `parse`", () => {
    expect(() => holdingsText(Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]))).toThrow(FeedParseError);
    try {
      holdingsText(Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]));
    } catch (e) {
      expect(parseClass(e)).toBe("parse");
    }
  });

  it("parseRcsbUnreleased(): every entry with its status and deposit date, withdrawn ones included, from a gzip or from plain JSON", () => {
    const want = [{ deposit_date: "2026-03-02T00:00:00+00:00", status: "AUTH" }, { deposit_date: "2025-04-04T00:00:00+00:00", status: "WDRN" }];
    expect(parseRcsbUnreleased(gzipJson(holdings))).toEqual(want);
    expect(parseRcsbUnreleased(Buffer.from(JSON.stringify(holdings)))).toEqual(want);
    expect(parseRcsbUnreleased(fixtureBytes("api/rcsb-unreleased.json"))).toHaveLength(7);
  });

  it("parseRcsbUnreleased(): no entry is `empty`, an entry that is no object or a root that is no object is `schema`, and no JSON is `parse`", () => {
    const code = (body: Buffer) => {
      try {
        parseRcsbUnreleased(body);
      } catch (e) {
        return parseClass(e);
      }
      return null;
    };
    expect(code(Buffer.from("{}"))).toBe("empty");
    expect(code(Buffer.from('{"9ZZ1": 1}'))).toBe("schema");
    expect(code(Buffer.from("[1]"))).toBe("schema");
    expect(code(Buffer.from("null"))).toBe("schema");
    expect(code(Buffer.from("not json"))).toBe("parse");
    expect(code(gzipJson({}))).toBe("empty");
  });

  it("readRcsbUnreleased(): keeps the file as it was received, gzip and all, and reads it", async () => {
    const gz = gzipJson(holdings);
    fromFixtures(writeFixtureDir({ [entry.url]: { body: gz, content_type: "application/gzip" } }));
    const r = await readRcsbUnreleased(entry, ctxFor());
    expect([r.ok, r.requests, r.data!.length, r.urlUsed]).toEqual([true, 1, 2, entry.url]);
    expect(fs.readFileSync(path.join(root, "cache", "feeds", "rcsb-unreleased.json.gz")).equals(gz)).toBe(true);
    expect(r.sha256).toBe(sha256Hex(gz));
  });

  it("readRcsbUnreleased(): fails as `too_large` when the fetcher says so, and as `empty` for a file with no entry", async () => {
    const big = await readRcsbUnreleased(entry, ctxFor({ fetch: fakeFetch(() => answer(null, { error: "too_large" })).fetch }));
    expect([big.ok, big.error]).toEqual([false, "too_large"]);
    const none = await readRcsbUnreleased(entry, ctxFor({ fetch: fakeFetch(() => answer(gzipJson({}))).fetch }));
    expect([none.ok, none.error]).toEqual([false, "empty"]);
  });

  it("readPdbStructures(): reads both, gives the counter's data only when both read, and cachedPdb() reads the same data back from the bodies", async () => {
    fromFixtures();
    const ok = await readPdbStructures(feedEntry("rcsb"), entry, ctxFor(), "2026-10-22");
    expect([ok.counts.ok, ok.unreleased.ok]).toEqual([true, true]);
    expect(ok.data!.released).toEqual({ "2025": 17052, "2026": 4632 });
    expect(ok.data!.unreleased).toHaveLength(7);
    const manifest: RequestRecord[] = [...ok.counts.fetched, ...ok.unreleased.fetched];
    expect(cachedPdb(root, manifest)).toEqual(ok.data);
    fs.appendFileSync(path.join(root, "cache", "feeds", "rcsb-unreleased.json.gz"), " ");
    expect(cachedPdb(root, manifest)).toBeNull();
    expect(cachedPdb(root, [])).toBeNull();
  });

  it("readPdbStructures(): a failing count still reads the holdings, and gives no data", async () => {
    fromFixtures(writeFixtureDir({ [RCSB_2025_URL]: { error: "timeout" }, [entry.url]: { body: fixtureBytes("api/rcsb-unreleased.json"), content_type: "application/json" } }));
    const r = await readPdbStructures(feedEntry("rcsb"), entry, ctxFor(), "2026-10-22");
    expect([r.counts.ok, r.unreleased.ok, r.data]).toEqual([false, true, null]);
    fromFixtures(writeFixtureDir({ [RCSB_2025_URL]: { body: fixtureBytes("api/rcsb-2025.json"), content_type: "application/json" }, [RCSB_2026_URL]: { body: fixtureBytes("api/rcsb-2026.json"), content_type: "application/json" }, [entry.url]: { status: 500 } }));
    const h = await readPdbStructures(feedEntry("rcsb"), entry, ctxFor(), "2026-10-22");
    expect([h.counts.ok, h.unreleased.ok, h.data]).toEqual([true, false, null]);
  });
});

describe("the Retraction Watch file", () => {
  const entry = feedEntry("retraction-watch");
  const rows = [
    { nature: "Retraction", reason: "+Computer-Aided Content or Computer-Generated Content;+Error in Data;", originalDoi: "10.1000/ut-sample-rw-0001", retractionDoi: "10.1000/ut-sample-notice-0001", date: "10/1/2026 0:00" },
    { nature: "Correction", reason: "Error in Text;", date: "10/21/2026 0:00" },
    { nature: "Retraction", reason: "Fake Peer Review;", date: "1/5/2027 0:00" },
    { nature: "Retraction", reason: "Duplicate Publication;", date: "not a date" },
  ];

  it("parseRetractionWatch(): reads the five columns of each row from a header with a trailing comma, and leaves out and counts a row dated after the run", () => {
    expect(RETRACTION_HEADER.endsWith(",")).toBe(true);
    const got = parseRetractionWatch(Buffer.from(retractionCsv(rows)), "2026-10-22");
    expect([got.total, got.future, got.newest, got.rows.length]).toEqual([4, 1, "2026-10-21", 3]);
    expect(got.rows[0]).toEqual({
      nature: "Retraction", reasons: ["Computer-Aided Content or Computer-Generated Content", "Error in Data"], original_doi: "10.1000/ut-sample-rw-0001",
      retraction_doi: "10.1000/ut-sample-notice-0001", retraction_date: "2026-10-01",
    });
    expect(got.rows.map((r) => r.nature)).toEqual(["Retraction", "Correction", "Retraction"]);
    expect(got.rows[2]!.retraction_date).toBeNull();
  });

  it("parseRetractionWatch(): a row dated on the run's day is kept, and one a day later is not", () => {
    const csv = retractionCsv([{ date: "10/22/2026 0:00" }, { date: "10/23/2026 0:00" }]);
    const got = parseRetractionWatch(Buffer.from(csv), "2026-10-22");
    expect([got.rows.length, got.future, got.newest]).toEqual([1, 1, "2026-10-22"]);
  });

  it("parseRetractionWatch(): no newest when no row is dated, `empty` for a file with a header only, `schema` for a file that is not this one", () => {
    expect(parseRetractionWatch(Buffer.from(retractionCsv([{ date: "never" }])), "2026-10-22").newest).toBeNull();
    const code = (body: string) => {
      try {
        parseRetractionWatch(Buffer.from(body), "2026-10-22");
      } catch (e) {
        return parseClass(e);
      }
      return null;
    };
    expect(code(`${RETRACTION_HEADER}\n`)).toBe("empty");
    expect(code("")).toBe("empty");
    expect(code("<html><body>busy</body></html>")).toBe("schema");
    expect(code("a,b\n1,2\n")).toBe("schema");
  });

  it("readRetractionWatch(): one GET with the feed's own timeout and body cap, the file kept whole, and a log line for the rows left out", async () => {
    const csv = retractionCsv(rows);
    const f = fakeFetch(() => answer(csv, { contentType: "text/csv; charset=utf-8" }));
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readRetractionWatch(entry, ctx, "2026-10-22");
    expect(f.calls).toHaveLength(1);
    expect([f.calls[0]!.opts.timeoutMs, f.calls[0]!.opts.maxBytes]).toEqual([90_000, 128 * 1024 * 1024]);
    expect([r.ok, r.requests, r.data!.rows.length, r.data!.future]).toEqual([true, 1, 3, 1]);
    expect(cached("retraction-watch.csv")).toBe(csv);
    expect(ctx.lines).toContain("retraction-watch: 1 row is dated after 2026-10-22 and left out");
    const two = await readRetractionWatch(entry, ctxFor({ fetch: fakeFetch(() => answer(retractionCsv([{ date: "1/5/2027 0:00" }, { date: "1/6/2027 0:00" }, { date: "1/1/2026 0:00" }]))).fetch }), "2026-10-22");
    expect(two.data!.future).toBe(2);
  });

  it("readRetractionWatch(): fails with the class of what went wrong, and keeps no file for a body that did not parse", async () => {
    const f = fakeFetch(() => answer("<html>busy</html>", { contentType: "text/html" }));
    const r = await readRetractionWatch(entry, ctxFor({ fetch: f.fetch }), "2026-10-22");
    expect([r.ok, r.error, r.data]).toEqual([false, "schema", null]);
    expect(cached("retraction-watch.csv")).toBeNull();
    const down = await readRetractionWatch(entry, ctxFor({ fetch: fakeFetch(failing("timeout")).fetch }), "2026-10-22");
    expect([down.ok, down.error, down.requests]).toEqual([false, "timeout", 1]);
  });

  it("cachedRetractions(): the same data back from the file, nothing from a file that changed or is gone, and the run's day applied again", async () => {
    const csv = retractionCsv(rows);
    const r = await readRetractionWatch(entry, ctxFor({ fetch: fakeFetch(() => answer(csv)).fetch }), "2026-10-22");
    expect(cachedRetractions(root, r.fetched, "2026-10-22")).toEqual(r.data);
    expect(cachedRetractions(root, r.fetched, "2027-02-01")!.future).toBe(0);
    expect(cachedRetractions(root, [], "2026-10-22")).toBeNull();
    fs.writeFileSync(path.join(root, "cache", "feeds", "retraction-watch.csv"), `${csv}\n`);
    expect(cachedRetractions(root, r.fetched, "2026-10-22")).toBeNull();
    fs.rmSync(path.join(root, "cache", "feeds", "retraction-watch.csv"));
    expect(cachedRetractions(root, r.fetched, "2026-10-22")).toBeNull();
  });
});

describe("mathlib's statistics page", () => {
  const table = (head: string, cell: string) => `<table class="table table-borderless"><tr><th>Definitions</th><th>${head}</th><th>Contributors</th></tr><tr><td>142,346</td><td>${cell}</td><td>772</td></tr></table>`;

  it("parseMathlibStats(): the Theorems cell of the first borderless table's second row, with or without thousands commas", () => {
    expect(parseMathlibStats(fixtureText("pages/feed-mathlib-stats.html"))).toBe(297_154);
    expect(parseMathlibStats(table("Theorems", "297154"))).toBe(297_154);
    expect(parseMathlibStats(table("theorems", "1,234,567"))).toBe(1_234_567);
    expect(parseMathlibStats(`${table("Theorems", "5")}${table("Theorems", "9")}`)).toBe(5);
  });

  it("parseMathlibStats(): a page that changed is `schema`, so it is never read as another number", () => {
    const fails = (html: string, why: RegExp) => expect(() => parseMathlibStats(html), html.slice(0, 60)).toThrow(why);
    fails("<html><body>moved</body></html>", /no table\.table-borderless/);
    fails('<table class="table"><tr><th>Theorems</th></tr><tr><td>5</td></tr></table>', /no table\.table-borderless/);
    fails('<table class="table-borderless"><tr><th>A</th><th>Theorems</th></tr></table>', /second cell/);
    fails(table("Lemmas", "297,154"), /not headed Theorems/);
    fails(table("Theorems", "n/a"), /no count/);
    fails(table("Theorems", "1,23"), /no count/);
    fails(table("Theorems", ""), /second cell/);
    fails(table("Theorems", "-5"), /no count/);
  });

  it("readMathlib(): the count from the page, which it keeps as mathlib-stats.html; cachedMathlib() reads it back and nothing from a changed or missing file", async () => {
    fromFixtures();
    const r = await readMathlib(feedEntry("mathlib-stats"), ctxFor());
    expect([r.ok, r.data, r.requests]).toEqual([true, 297_154, 1]);
    expect(cached("mathlib-stats.html")).toBe(fixtureText("pages/feed-mathlib-stats.html"));
    expect(cachedMathlib(root, r.fetched)).toBe(297_154);
    expect(cachedMathlib(root, [])).toBeNull();
    fs.appendFileSync(path.join(root, "cache", "feeds", "mathlib-stats.html"), "<!-- -->");
    expect(cachedMathlib(root, r.fetched)).toBeNull();
    fs.rmSync(path.join(root, "cache", "feeds", "mathlib-stats.html"));
    expect(cachedMathlib(root, r.fetched)).toBeNull();
  });

  it("readMathlib(): refuses a JSON body for the page, and fails as `schema` when the table is gone", async () => {
    const entry = feedEntry("mathlib-stats");
    const json = await readMathlib(entry, ctxFor({ fetch: fakeFetch(() => answer('{"error":1}', { contentType: "application/json" })).fetch }));
    expect([json.ok, json.error]).toEqual([false, "parse"]);
    const moved = await readMathlib(entry, ctxFor({ fetch: fakeFetch(() => answer("<html><body>moved</body></html>", { contentType: "text/html" })).fetch }));
    expect([moved.ok, moved.error, moved.data]).toEqual([false, "schema", null]);
  });
});

// ── Which reader a feed has ──────────────────────────────────────────────────────────────────────

describe("readerKind(), isCandidateFeed() and readFeed()", () => {
  const feeds = realConfig().sources.feeds;

  it("gives every registry feed the reader its id and parser name, and no feed is left without one", () => {
    const named: Record<string, string> = {
      biorxiv: "biorxiv", medrxiv: "biorxiv", pubmed: "pubmed", "crossref-journals": "crossref-journals", "crossref-updates": "crossref-updates", openalex: "openalex", ctgov: "ctgov",
      rcsb: "rcsb", "rcsb-unreleased": "rcsb-unreleased", "retraction-watch": "retraction-watch", "mathlib-stats": "mathlib", "smc-reactions": "smc", "naer-terms": "none",
      eurekalert: "page", erdos: "page", scrollprize: "rss",
    };
    for (const f of feeds) {
      const want = named[f.id] ?? (f.id.startsWith("arxiv-") ? "arxiv" : f.parser === "rss" ? "rss" : "page");
      expect(readerKind(f), f.id).toBe(want);
    }
    expect(feeds.filter((f) => readerKind(f) === null)).toEqual([]);
  });

  it("is null for a feed whose id and parser do not belong together, whatever its name", () => {
    const none: [string, FeedEntry["parser"]][] = [
      ["arxiv-bogus", "atom"], ["arxiv-math", "rss"], ["arxiv-math", "json"], ["biorxiv", "html"], ["medrxiv", "atom"], ["pubmed", "rss"], ["crossref-journals", "csv"], ["crossref-updates", "rss"],
      ["retraction-watch", "json"], ["mathlib-stats", "json"], ["smc-reactions", "html"], ["ctgov", "csv"], ["rcsb", "rss"], ["rcsb-unreleased", "csv"], ["openalex", "html"],
      ["a-new-page-feed", "html"], ["constructor", "html"], ["__proto__", "html"], ["toString", "atom"], ["lab-x", "csv"], ["lab-x", "json"], ["lab-x", "atom"],
    ];
    for (const [id, parser] of none) expect(readerKind({ id, parser }), `${id} ${parser}`).toBeNull();
    expect(readerKind({ id: "a-new-journal", parser: "rss" })).toBe("rss");
    expect(readerKind({ id: "anything", parser: "none" })).toBe("none");
  });

  it("gives candidates only for the seven kinds that read items", () => {
    const candidates = feeds.filter((f) => isCandidateFeed(f)).map((f) => readerKind(f));
    expect(new Set(candidates)).toEqual(new Set(["arxiv", "biorxiv", "pubmed", "crossref-journals", "rss", "smc", "page"]));
    for (const id of ["crossref-updates", "ctgov", "rcsb", "rcsb-unreleased", "retraction-watch", "mathlib-stats", "openalex", "naer-terms"]) {
      expect(isCandidateFeed(feedEntry(id)), id).toBe(false);
    }
    expect(isCandidateFeed({ id: "a-new-page-feed", parser: "html" })).toBe(false);
  });

  it("throws, and does not report a failure, for a feed that gives no candidates: that is a call that should never be made", async () => {
    for (const id of ["crossref-updates", "ctgov", "rcsb", "rcsb-unreleased", "retraction-watch", "mathlib-stats", "openalex", "naer-terms"]) {
      const f = fakeFetch(() => answer("x"));
      await expect(readFeed(feedEntry(id), ctxFor({ fetch: f.fetch }), fixtureRun()), id).rejects.toThrow(`readFeed: ${id} is not a candidate feed`);
      expect(f.calls, id).toHaveLength(0);
    }
  });
});

describe("probeDataFeed()", () => {
  it("is null for a feed that is never read, for OpenAlex (its client reads it) and for a candidate feed", async () => {
    for (const id of ["naer-terms", "openalex", "journal-nature", "arxiv-math", "pubmed"]) {
      const f = fakeFetch(() => answer("x"));
      expect(await probeDataFeed(feedEntry(id), ctxFor({ fetch: f.fetch }), fixtureRun()), id).toBeNull();
      expect(f.calls, id).toHaveLength(0);
    }
  });

  it("is null for a feed that needs ids the run did not give", async () => {
    const f = fakeFetch(() => answer("x"));
    for (const id of ["crossref-updates", "ctgov"]) {
      expect(await probeDataFeed(feedEntry(id), ctxFor({ fetch: f.fetch }), fixtureRun({ probe: undefined })), id).toBeNull();
      expect(await probeDataFeed(feedEntry(id), ctxFor({ fetch: f.fetch }), fixtureRun({ probe: { ncts: [], dois: [] } })), id).toBeNull();
    }
    expect(f.calls).toHaveLength(0);
  });

  it("asks each data feed one small question of its own kind, in the run's day", async () => {
    fromFixtures();
    const run = fixtureRun();
    const kinds: [string, (r: unknown) => boolean][] = [
      ["crossref-updates", (r) => (r as { notices: unknown[] }).notices.length === 2],
      ["ctgov", (r) => r instanceof Map && r.size === 3],
      ["rcsb", (r) => JSON.stringify(r) === JSON.stringify({ "2025": 17052, "2026": 4632 })],
      ["rcsb-unreleased", (r) => Array.isArray(r) && r.length === 7],
      ["mathlib-stats", (r) => r === 297_154],
    ];
    for (const [id, check] of kinds) {
      const r = await probeDataFeed(feedEntry(id), ctxFor(), run);
      expect(r, id).not.toBeNull();
      expect(r!.ok, id).toBe(true);
      expect(check(r!.data), id).toBe(true);
    }
    const rw = await probeDataFeed(feedEntry("retraction-watch"), ctxFor({ fetch: fakeFetch(() => answer(retractionCsv([{ date: "10/1/2026 0:00" }, { date: "1/5/2027 0:00" }]))).fetch }), run);
    expect(rw!.ok).toBe(true);
    expect((rw!.data as { future: number }).future).toBe(1);
  });

  it("asks for at most 50 DOIs and at most 100 trials, whatever the probe holds", async () => {
    const f = fakeFetch(() => answer(JSON.stringify({ message: { items: [] }, studies: [] })));
    await probeDataFeed(feedEntry("crossref-updates"), ctxFor({ fetch: f.fetch }), fixtureRun({ probe: { dois: watchDois(80) } }));
    await probeDataFeed(feedEntry("ctgov"), ctxFor({ fetch: f.fetch }), fixtureRun({ probe: { ncts: nctIds(150) } }));
    expect(f.calls.map((c) => c.url.includes("updates:") ? c.url.split("updates:").length - 1 : /pageSize=(\d+)/.exec(c.url)![1])).toEqual([50, "100"]);
  });
});

// ── Every candidate feed: the shapes a read may take ─────────────────────────────────────────────

describe("every candidate feed of the registry", () => {
  const candidates = realConfig().sources.feeds.filter((f) => isCandidateFeed(f));
  const HOSTILE = "<script>alert(1)</script> https://evil.example/ut-sample/leak?token=abc";
  const classes = ["timeout", "dns", "tls", "http_503", "too_large", "redirects", "network"] as const;

  it("reads from the fixtures within its request budget, with a manifest row and a SHA-256 for what it kept", async () => {
    fromFixtures();
    expect(candidates.length).toBeGreaterThan(50);
    for (const entry of candidates) {
      const f = recording();
      const r = await readFeed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
      expect(r.ok, entry.id).toBe(true);
      expect(f.calls.length, entry.id).toBeLessThanOrEqual(entry.budget);
      expect(r.requests, entry.id).toBeLessThanOrEqual(entry.budget);
      expect(r.sha256 ?? "", entry.id).toMatch(/^[0-9a-f]{64}$/);
      expect(r.fetched.length, entry.id).toBeGreaterThanOrEqual(1);
      expect(r.fetched.every((x) => /^[0-9a-f]{64}$/.test(x.sha256) && x.url.startsWith("https://")), entry.id).toBe(true);
      expect(r.data!.items.length, entry.id).toBeGreaterThan(0);
      for (const item of r.data!.items) {
        expect(item.title.trim(), entry.id).not.toBe("");
        expect(item.url, entry.id).toMatch(/^https?:\/\//);
        expect(item.published_at === null || !Number.isNaN(Date.parse(item.published_at)), `${entry.id} ${item.published_at}`).toBe(true);
        expect(Object.keys(item).sort(byCodeUnit), entry.id).toEqual(["abstract", "arxiv", "categories", "doi", "journal", "journal_id", "kind", "published_at", "title", "types", "url"]);
      }
    }
  });

  it("fails with the fetcher's own error class for each class of failure, never throws, and sends no more attempts than its budget", async () => {
    for (const entry of candidates) {
      for (const error of classes) {
        const f = fakeFetch((_u, _n, opts) => ({ ...answer(null, { error, attempts: opts.retryDelayMs === 0 ? 1 : 2, status: error === "http_503" ? 503 : null }), detail: HOSTILE }));
        const ctx = ctxFor({ fetch: f.fetch });
        const r = await readFeed(entry, ctx, fixtureRun());
        const label = `${entry.id} ${error}`;
        expect([r.ok, r.error, r.data], label).toEqual([false, error, null]);
        const attempts = f.calls.reduce((n, c) => n + (c.opts.retryDelayMs === 0 ? 1 : 2), 0);
        expect(attempts, label).toBeLessThanOrEqual(entry.budget);
        expect(r.requests, label).toBeLessThanOrEqual(entry.budget);
        expect(r.sha256, label).toBeNull();
        expect(JSON.stringify(r), label).not.toMatch(/evil\.example|<script>|token=abc/);
        expect(ctx.lines.some((l) => l.includes("evil.example")), label).toBe(true);
      }
    }
  });

  it("fails as `parse`, `schema` or `empty` when the body is unreadable bytes, and as the same for a body with no content type", async () => {
    for (const entry of candidates) {
      for (const [name, body, type] of [
        ["unreadable bytes", Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0xc3, 0x28]), "application/octet-stream"], ["an empty body", Buffer.alloc(0), null],
        ["an HTML error page", Buffer.from("<html><head><title>503</title></head><body>Service busy</body></html>"), "text/html"],
      ] as const) {
        const f = fakeFetch(() => answer(body, { contentType: type }));
        const r = await readFeed(entry, ctxFor({ fetch: f.fetch }), fixtureRun({ lookback: false }));
        const label = `${entry.id} ${name}`;
        expect(r.ok, label).toBe(false);
        expect(["parse", "schema", "empty"], label).toContain(r.error);
        expect(r.data, label).toBeNull();
        expect(f.calls.length, label).toBeLessThanOrEqual(entry.budget);
      }
    }
  });

  it("does not fetch an address found in what it read: every request is to the registry's own address or its fallback, or a URL its builders make", async () => {
    fromFixtures();
    for (const entry of candidates) {
      const f = recording();
      await readFeed(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
      const hosts = new Set([entry.url, entry.fallback_url].filter((u): u is string => u !== null).map((u) => new URL(u).host));
      for (const u of f.urls()) expect(hosts.has(new URL(u).host), `${entry.id} ${u}`).toBe(true);
    }
  });

  it("gives the same read for the same fixtures, and the same cache files, on a second run (a reader keeps no state between runs)", async () => {
    fromFixtures();
    const subset = ["arxiv-physics", "biorxiv", "pubmed", "journal-nature", "eurekalert", "smc-reactions", "lab-lila-sciences"];
    const first = new Map<string, string>();
    for (const id of subset) first.set(id, JSON.stringify((await readFeed(feedEntry(id), ctxFor(), fixtureRun({ lookback: false }))).data));
    root = tempDir("ut-feed-readers-second-");
    for (const id of subset) expect(JSON.stringify((await readFeed(feedEntry(id), ctxFor(), fixtureRun({ lookback: false }))).data), id).toBe(first.get(id));
  });
});

describe("what a read keeps in cache/feeds/", () => {
  it("leaves one body for each feed it read, named by the registry id and the kind of body, and no temporary file", async () => {
    fromFixtures();
    for (const id of ["journal-nature", "lab-anthropic", "biorxiv", "pubmed", "smc-reactions", "eurekalert", "crossref-journals"]) await readFeed(feedEntry(id), ctxFor(), fixtureRun({ lookback: false }));
    const names = fs.readdirSync(path.join(root, "cache", "feeds")).sort(byCodeUnit);
    expect(names.filter((n) => !n.startsWith("crossref-journals-"))).toEqual([
      "biorxiv.json", "eurekalert.html", "journal-nature.xml", "lab-anthropic.html", "pubmed.fetch.xml", "pubmed.json", "pubmed.summary.json", "smc-reactions.xml",
    ]);
    expect(names.filter((n) => n.startsWith("crossref-journals-"))).toHaveLength(30);
    expect(names.some((n) => n.includes(".tmp-"))).toBe(false);
  });

  it("writes nothing for a feed that failed, and replaces the earlier body of a feed that read again", async () => {
    const entry = feedEntry("journal-nature");
    const f1 = fakeFetch(() => answer(rssDoc(rssItem("First", "https://example.org/ut-sample/1", "Wed, 21 Oct 2026 02:00:00 +0000"))));
    await readRssFeed(entry, ctxFor({ fetch: f1.fetch }));
    expect(cached("journal-nature.xml")).toContain("First");
    const f2 = fakeFetch(() => answer(rssDoc(rssItem("Second", "https://example.org/ut-sample/2", "Wed, 21 Oct 2026 02:00:00 +0000"))));
    await readRssFeed(entry, ctxFor({ fetch: f2.fetch }));
    expect(cached("journal-nature.xml")).toContain("Second");
    expect(cached("journal-nature.xml")).not.toContain("First");
    await readRssFeed(entry, ctxFor({ fetch: fakeFetch(() => answer("<html>busy</html>")).fetch }));
    expect(cached("journal-nature.xml")).toContain("Second");
  });
});

// ── Strings read from a feed are data ────────────────────────────────────────────────────────────

describe("strings a feed gives", () => {
  it("leaves out an item whose link is not a web address, writes out a relative link against the feed, and keeps the count the feed gave", async () => {
    const body = rssDoc([
      rssItem("A script link", "javascript:alert(1)", "Wed, 21 Oct 2026 02:00:00 +0000"), rssItem("A mail link", "mailto:ut-sample@example.org", "Wed, 21 Oct 2026 02:00:00 +0000"),
      rssItem("A data link", "data:text/html,x", "Wed, 21 Oct 2026 02:00:00 +0000"), rssItem("A relative link", "/ut-sample/relative", "Wed, 21 Oct 2026 02:00:00 +0000"),
      rssItem("A web link", "https://example.org/ut-sample/web", "Wed, 21 Oct 2026 02:00:00 +0000"),
    ].join(""));
    const entry = feedEntry("lab-openai");
    const r = await readRssFeed(entry, ctxFor({ fetch: fakeFetch(() => answer(body)).fetch }));
    expect(r.data!.items.map((i) => [i.title, i.url])).toEqual([["A relative link", "https://openai.com/ut-sample/relative"], ["A web link", "https://example.org/ut-sample/web"]]);
    expect(r.data!.total).toBe(5);
  });

  it("gives a page feed's item no link that is not a web address, even when the page links one", async () => {
    const html = '<div class="card"><a class="u-link-cover" href="javascript:alert(1)">A</a></div><div class="card"><a class="u-link-cover" href="/research/ok">B</a></div>';
    const entry = feedEntry("lab-futurehouse");
    const r = await readPageFeed(entry, ctxFor({ fetch: fakeFetch(() => answer(html, { contentType: "text/html", url: entry.url })).fetch }));
    expect(r.data!.items.map((i) => i.url)).toEqual([new URL("/research/ok", entry.url).href]);
  });

  it("keeps a hostile title as plain text with no tag in it, in every kind of source that has markup", () => {
    const hostile = '<img src=x onerror="alert(1)">A <b>title</b> &lt;script&gt;x&lt;/script&gt;';
    for (const out of [plain(hostile), parseBiorxiv(Buffer.from(bioPage([bioRecord(1, { title: hostile })], 1, 1)), "biorxiv").items[0]!.title, parseCrossrefWorks(Buffer.from(crossrefBody([crossrefWork(1, { title: [hostile] })]))).works[0]!.title]) {
      expect(out).toBe("A title <script>x</script>");
    }
  });

  it("does not put a fetcher's raw detail in the note or the error of a read, only in the log", async () => {
    const f = fakeFetch(() => ({ ...answer(null, { error: "network" }), detail: "ECONNRESET at 10.0.0.7 <b>secret</b>" }));
    const ctx = ctxFor({ fetch: f.fetch });
    const r = await readPubmed(feedEntry("pubmed"), ctx, fixtureRun());
    expect(JSON.stringify(r)).not.toMatch(/ECONNRESET|10\.0\.0\.7|secret/);
    expect(ctx.lines.join("\n")).toMatch(/ECONNRESET at 10\.0\.0\.7/);
  });
});

// ── The per-host queues (SPEC §4.13 "Rate limits") ───────────────────────────────────────────────

/** The clock `fetchFeed()`'s queues read, driven by the test. */
class FakeClock implements HttpClock {
  t = 1_700_000_000_000;
  readonly origin = this.t;
  private timers: { at: number; seq: number; resolve: () => void }[] = [];
  private seq = 0;
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => this.timers.push({ at: this.t + Math.max(0, ms), seq: this.seq++, resolve }));
  }
  get elapsed(): number {
    return this.t - this.origin;
  }
  async run<T>(work: Promise<T>): Promise<T> {
    let settled = false;
    let value: T | undefined;
    let failure: unknown;
    work.then((v) => { value = v; settled = true; }, (e: unknown) => { failure = e; settled = true; });
    let idle = 0;
    while (!settled) {
      await new Promise<void>((r) => setImmediate(r));
      if (settled) break;
      const next = [...this.timers].sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) {
        idle += 1;
        if (idle > 200) throw new Error("fake clock: the work is waiting for nothing");
        continue;
      }
      idle = 0;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.resolve();
    }
    if (failure !== undefined) throw failure;
    return value as T;
  }
}

interface Timed {
  url: string;
  start: number;
  end: number;
}

/** A host the readers' own `fetchFeed()` reaches through the global fetch: it answers from the fixture index, each answer taking `ms` of the fake clock. */
function stubServer(clock: FakeClock, ms = 100, dir = FEEDS_DIR): Timed[] {
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as Record<string, { file?: string; content_type?: string; status?: number }>;
  const calls: Timed[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    const call: Timed = { url, start: clock.elapsed, end: 0 };
    calls.push(call);
    await clock.sleep(ms);
    call.end = clock.elapsed;
    const e = index[url];
    if (!e) return new Response("not in the index", { status: 404 });
    return new Response(e.file ? fs.readFileSync(path.join(dir, e.file)) : "", { status: e.status ?? 200, headers: e.content_type ? { "content-type": e.content_type } : {} });
  });
  return calls;
}

describe("the readers and the per-host queues", () => {
  let clock: FakeClock;
  beforeEach(() => {
    resetRateQueues();
    clock = new FakeClock();
    setHttpClock(clock);
  });

  const ctxOnClock = (over: Partial<FeedCtx> = {}) => ctxFor({ now: () => clock.now(), ...over });

  it("every URL the readers build for a rate-limited host is one of its queue's hosts, and no other host is in a queue", () => {
    const list = listOf("2026-10-20");
    const math = feedEntry("arxiv-math");
    expect(rateQueueOf(arxivApiUrl(math.url, "arxiv-math", list))).toBe("arxiv");
    expect(rateQueueOf(math.fallback_url!)).toBe("arxiv");
    for (const id of Object.keys(ARXIV_QUERIES)) expect(rateQueueOf(feedEntry(id).fallback_url!), id).toBe("arxiv");
    const pubmed = feedEntry("pubmed");
    for (const u of [pubmedSearchUrl(pubmed.url, ["x"], "2026-10-20", "2026-10-21"), pubmedSummaryUrl(pubmed.url, ["1"]), pubmedFetchUrl(pubmed.url, ["1"])]) expect(rateQueueOf(u)).toBe("eutils");
    const crossref = feedEntry("crossref-journals");
    expect(rateQueueOf(crossrefJournalUrl(crossref.url, "0028-0836", "2026-10-20"))).toBe("crossref");
    expect(rateQueueOf(crossrefUpdatesUrl(feedEntry("crossref-updates").url, ["10.1000/a"]))).toBe("crossref");
    for (const id of ["biorxiv", "medrxiv", "ctgov", "rcsb", "rcsb-unreleased", "retraction-watch", "mathlib-stats", "eurekalert", "journal-nature", "smc-reactions"]) {
      expect(rateQueueOf(feedEntry(id).url), id).toBeNull();
    }
  });

  it("arXiv: the window's list and the lookback's go out one after the other, the second 3 s after the first ended", async () => {
    const calls = stubServer(clock, 700);
    const r = await clock.run(readArxiv(feedEntry("arxiv-math"), ctxOnClock(), fixtureRun()));
    expect(r.ok).toBe(true);
    expect(calls.map((c) => [c.url, c.start, c.end])).toEqual([[MATH_WINDOW_URL, 0, 700], [MATH_SUN_URL, 3_700, 4_400]]);
  });

  it("arXiv: the listing feed shares the API's queue, so the fallback request starts 3 s after the failed API request ended", async () => {
    const LISTING = "https://rss.arxiv.org/atom/math";
    const dir = writeFixtureDir({ [MATH_WINDOW_URL]: { status: 404 }, [LISTING]: { body: fixtureBytes("arxiv/listing-math.xml"), content_type: "application/atom+xml" } });
    const calls = stubServer(clock, 100, dir);
    const r = await clock.run(readArxiv(feedEntry("arxiv-math"), ctxOnClock(), fixtureRun({ lookback: false })));
    expect([r.ok, r.fallbackUsed]).toEqual([true, true]);
    expect(calls.map((c) => [c.url, c.start, c.end])).toEqual([[MATH_WINDOW_URL, 0, 100], [LISTING, 3_100, 3_200]]);
  });

  it("arXiv: a failed API request is not retried (that would leave the listing no request), so the listing goes out 3 s after the API's request ended", async () => {
    const LISTING = "https://rss.arxiv.org/atom/math";
    const dir = writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 } });
    const calls = stubServer(clock, 100, dir);
    const r = await clock.run(readArxiv(feedEntry("arxiv-math"), ctxOnClock(), fixtureRun({ lookback: false })));
    expect([r.ok, r.error, r.requests, r.triedFallback]).toEqual([false, "http_404", 2, true]);
    expect(calls.map((c) => [c.url, c.start])).toEqual([[MATH_WINDOW_URL, 0], [LISTING, 3_100]]);
  });

  it("a feed with no fallback retries its one request once when its budget allows, 2 s later (and 3 s after the last one ended on the arXiv queue)", async () => {
    const dir = writeFixtureDir({ [MATH_WINDOW_URL]: { status: 503 } });
    const calls = stubServer(clock, 100, dir);
    const spend = { id: "arxiv-math", max: 2, used: 0 };
    const r = await clock.run(get(ctxOnClock(), spend, MATH_WINDOW_URL));
    expect([r.ok, r.attempts, spend.used]).toEqual([false, 2, 2]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.start - calls[0]!.end).toBeGreaterThanOrEqual(2_000);
  });

  it("PubMed: the three requests of a read start at least 334 ms apart (3 a second without a key)", async () => {
    const calls = stubServer(clock, 100);
    const r = await clock.run(readPubmed(feedEntry("pubmed"), ctxOnClock(), fixtureRun()));
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.start)).toEqual([0, 334, 668]);
  });

  it("Crossref: the 30 journal requests go one at a time, a filter at most once a second", async () => {
    const calls = stubServer(clock, 100);
    const r = await clock.run(readCrossrefJournals(feedEntry("crossref-journals"), ctxOnClock(), fixtureRun()));
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(30);
    expect(calls.map((c) => c.start)).toEqual(Array.from({ length: 30 }, (_, i) => i * 1_000));
    calls.slice(1).forEach((c, i) => expect(c.start).toBeGreaterThanOrEqual(calls[i]!.end));
  });

  it("a feed with no queue is not made to wait", async () => {
    const calls = stubServer(clock, 100);
    await clock.run(readPageFeed(feedEntry("eurekalert"), ctxOnClock()));
    expect(calls.map((c) => c.start)).toEqual([0, 100]);
  });

  it("the run's deadline cuts a wait for a turn: a request that cannot start in time is not made (the fetcher still counts its attempt, which only shortens the budget)", async () => {
    const calls = stubServer(clock, 100);
    const ctx = ctxOnClock({ deadline: clock.now() + 1_000 });
    const r = await clock.run(readArxiv(feedEntry("arxiv-math"), ctx, fixtureRun()));
    expect(calls.map((c) => c.url)).toEqual([MATH_WINDOW_URL]);
    expect(r.ok).toBe(true);
    expect(r.data!.items).toHaveLength(2);
    expect(r.data!.unread.sort(byCodeUnit)).toEqual(["2026-10-18", "2026-10-19"]);
    expect(r.requests).toBe(2);
  });

  it("a deadline that has passed stops a feed before its first request, as a timeout", async () => {
    const calls = stubServer(clock, 100);
    const r = await clock.run(readRssFeed(feedEntry("journal-nature"), ctxOnClock({ deadline: clock.now() })));
    expect([r.ok, r.error, r.requests, calls.length]).toEqual([false, "timeout", 0, 0]);
  });
});

// ── The feed index and the freshness judgement (feed-cache.ts) ───────────────────────────────────

/** A read as the index sees it, with the fields a test names. */
const readOf = (over: Partial<FeedFacts["read"]> = {}): FeedFacts["read"] => ({
  ok: true, error: null, urlUsed: "https://example.org/ut-sample/feed", triedFallback: false, fallbackUsed: false, sha256: "a".repeat(64), bytes: 1234, requests: 1,
  fetchedAt: "2026-10-22T03:20:00+08:00", note: null, ...over,
});

const REF = Date.parse("2026-10-21T19:15:00Z");
const DAY = 86_400_000;

describe("freshNewest()", () => {
  const item = (published_at: string | null) => ({ published_at } as { published_at: string | null } as never);
  const data = (dates: (string | null)[], newest: string | null = null) => ({ items: dates.map(item), newest }) as Parameters<typeof freshNewest>[1];

  it("is the announcement of the newest cached list for an arXiv feed, whatever the items hold", () => {
    expect(freshNewest("arxiv-math", data(["2026-10-21T01:00:00Z"], "2026-10-21T08:00:00+08:00"), REF)).toBe("2026-10-21T08:00:00+08:00");
    expect(freshNewest("arxiv-math", data([], null), REF)).toBeNull();
    expect(freshNewest("arxiv-quant-ph", data(["2026-10-21T01:00:00Z"], null), REF)).toBeNull();
  });

  it("is the latest item dated no later than the judging time for any other feed, so a future date cannot keep a feed fresh", () => {
    expect(freshNewest("journal-nature", data(["2026-10-20T02:00:00Z", "2026-10-21T02:00:00Z", "2026-10-19T00:00:00Z"]), REF)).toBe("2026-10-21T02:00:00Z");
    expect(freshNewest("journal-nature", data(["2026-10-20T02:00:00Z", "2027-01-01T00:00:00Z"]), REF)).toBe("2026-10-20T02:00:00Z");
    expect(freshNewest("journal-nature", data(["2027-01-01T00:00:00Z"]), REF)).toBeNull();
  });

  it("counts an item dated at the judging time itself, and leaves out an item with no date or a date that does not read", () => {
    const at = new Date(REF).toISOString();
    expect(freshNewest("pubmed", data([at]), REF)).toBe(at);
    expect(freshNewest("pubmed", data([new Date(REF + 1).toISOString()]), REF)).toBeNull();
    expect(freshNewest("pubmed", data([null, "not a date", "2026-10-18"]), REF)).toBe("2026-10-18");
    expect(freshNewest("pubmed", data([null, "not a date"]), REF)).toBeNull();
    expect(freshNewest("pubmed", data([]), REF)).toBeNull();
  });

  it("treats only an id that starts with `arxiv-` as an arXiv feed", () => {
    expect(freshNewest("arxiv", data(["2026-10-20T00:00:00Z"], "x"), REF)).toBe("2026-10-20T00:00:00Z");
    expect(freshNewest("a-arxiv-math", data(["2026-10-20T00:00:00Z"], "x"), REF)).toBe("2026-10-20T00:00:00Z");
  });
});

describe("candidateFacts() and dataFacts()", () => {
  const entry = { id: "journal-nature" };
  const dataOf = (dates: (string | null)[], total: number) => ({ items: dates.map((published_at) => ({ published_at })), total, newest: null }) as never;

  it("gives a failed read no newest day and no counts", () => {
    const read = { ...readOf({ ok: false, error: "dns" }), data: null } as never;
    const f = candidateFacts(entry, read, REF);
    expect([f.newest, f.items, f.records]).toEqual([null, 0, 0]);
    expect(f.read).toBe(read);
  });

  it("counts what the feed gave (`total`) apart from what the reader kept, and takes the newest day under the judging time", () => {
    const f = candidateFacts(entry, { ...readOf(), data: dataOf(["2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z", "2030-01-01T00:00:00Z"], 40) } as never, REF);
    expect([f.newest, f.items, f.records]).toEqual(["2026-10-21T00:00:00Z", 40, 3]);
  });

  it("gives an arXiv feed the announcement the reader found, not an item date", () => {
    const data = { items: [{ published_at: "2026-10-20T00:00:00Z" }], total: 1, newest: "2026-10-21T08:00:00+08:00" } as never;
    expect(candidateFacts({ id: "arxiv-math" }, { ...readOf(), data } as never, REF).newest).toBe("2026-10-21T08:00:00+08:00");
  });

  it("dataFacts() takes what the counter counted as both counts", () => {
    const r = readOf();
    expect(dataFacts(r, "2026-10-21", 5)).toEqual({ read: r, newest: "2026-10-21", items: 5, records: 5 });
    expect(dataFacts(r, null, 0)).toEqual({ read: r, newest: null, items: 0, records: 0 });
  });
});

describe("feedVerdict()", () => {
  const facts = (read: Partial<FeedFacts["read"]> = {}, newest: string | null = "2026-10-21T00:00:00Z"): FeedFacts => ({ read: readOf(read), newest, items: 3, records: 3 });

  it("is skipped, SKIP and no note for a feed that is never read", () => {
    expect(feedVerdict({ fresh_days: 3 }, null, REF)).toEqual({ state: "skipped", label: "SKIP", note: null });
    expect(feedVerdict({ fresh_days: null }, null, REF)).toEqual({ state: "skipped", label: "SKIP", note: null });
  });

  it("is failed and FAIL for a read that did not read, with the error class, and names the fallback when it was tried too", () => {
    expect(feedVerdict({ fresh_days: 3 }, facts({ ok: false, error: "dns" }), REF)).toEqual({ state: "failed", label: "FAIL", note: "Failed: dns." });
    expect(feedVerdict({ fresh_days: 3 }, facts({ ok: false, error: "http_503", triedFallback: true }), REF)).toEqual({ state: "failed", label: "FAIL", note: "Failed: http_503 on both URLs." });
    expect(feedVerdict({ fresh_days: null }, facts({ ok: false, error: null }), REF).note).toBe("Failed: network.");
    expect(feedVerdict({ fresh_days: null }, facts({ ok: false, error: "parse", note: "A fixed line." }), REF).note).toBe("Failed: parse. A fixed line.");
  });

  it("does not judge freshness of a failed read, and does not say the fallback was used", () => {
    const v = feedVerdict({ fresh_days: 1 }, facts({ ok: false, error: "tls", fallbackUsed: true }, "2000-01-01"), REF);
    expect([v.state, v.note]).toEqual(["failed", "Failed: tls."]);
  });

  it("is ok with no note for a read of a feed that has no `fresh_days`, however old its newest item", () => {
    expect(feedVerdict({ fresh_days: null }, facts({}, "2001-01-01"), REF)).toEqual({ state: "ok", label: "OK", note: null });
    expect(feedVerdict({ fresh_days: null }, facts({}, null), REF)).toEqual({ state: "ok", label: "OK", note: null });
  });

  it("puts the fallback line before the reader's own note", () => {
    expect(feedVerdict({ fresh_days: null }, facts({ fallbackUsed: true, note: "Read in part." }), REF)).toEqual({ state: "ok", label: "OK", note: "Fallback URL used. Read in part." });
    expect(feedVerdict({ fresh_days: null }, facts({ note: "Read in part." }), REF).note).toBe("Read in part.");
    expect(feedVerdict({ fresh_days: null }, facts({ fallbackUsed: true }), REF).note).toBe("Fallback URL used.");
  });

  it("is stale and NODATE when a feed with `fresh_days` has no newest day, or one that does not read", () => {
    expect(feedVerdict({ fresh_days: 3 }, facts({}, null), REF)).toEqual({ state: "stale", label: "NODATE", note: "Stale: no readable dates." });
    expect(feedVerdict({ fresh_days: 3 }, facts({ fallbackUsed: true }, "yesterday"), REF)).toEqual({ state: "stale", label: "NODATE", note: "Stale: no readable dates. Fallback URL used." });
  });

  it("is stale and STALE when the newest is older than `fresh_days` days, and fresh at exactly that age", () => {
    const edge = new Date(REF - 3 * DAY).toISOString();
    expect(feedVerdict({ fresh_days: 3 }, facts({}, edge), REF)).toEqual({ state: "ok", label: "OK", note: null });
    const over = new Date(REF - 3 * DAY - 1).toISOString();
    expect(feedVerdict({ fresh_days: 3 }, facts({}, over), REF)).toEqual({ state: "stale", label: "STALE", note: "Stale: newest item 2026-10-18." });
    expect(feedVerdict({ fresh_days: 3 }, facts({ fallbackUsed: true }, "2026-10-01"), REF).note).toBe("Stale: newest item 2026-10-01. Fallback URL used.");
  });

  it("is fresh for a newest day after the judging time, and judges a day-only date as the start of that day", () => {
    expect(feedVerdict({ fresh_days: 1 }, facts({}, "2026-12-01T00:00:00Z"), REF).state).toBe("ok");
    expect(feedVerdict({ fresh_days: 2 }, facts({}, "2026-10-19"), REF).state).toBe("stale");
    expect(feedVerdict({ fresh_days: 3 }, facts({}, "2026-10-19"), REF).state).toBe("ok");
  });

  it("keeps a note within 200 characters", () => {
    const long = "x".repeat(300);
    for (const f of [facts({ ok: false, error: "dns", note: long }), facts({ note: long }), facts({ fallbackUsed: true, note: long }, null), facts({ note: long }, "2000-01-01")]) {
      const note = feedVerdict({ fresh_days: 3 }, f, REF).note;
      expect(note!.length).toBe(200);
    }
  });
});

describe("feedIndexEntry()", () => {
  const nature = feedEntry("journal-nature");
  const facts = (read: Partial<FeedFacts["read"]> = {}, newest: string | null = "2026-10-21T00:00:00Z"): FeedFacts => ({ read: readOf(read), newest, items: 30, records: 12 });

  it("gives a feed that is never read a row of zeros with the SKIP label", () => {
    const row = feedIndexEntry(nature, null, REF);
    expect(row).toEqual({
      id: "journal-nature", kind: nature.kind, status: "skipped", label: "SKIP", error_class: null, url_used: null, fallback_used: false, newest: null, items: 0, records: 0, bytes: 0, requests: 0,
      sha256: null, fetched_at: null, note: null,
    });
    expect(FeedIndexEntry.parse(row)).toEqual(row);
  });

  it("gives a good read its counts, its hash and its time, and no error class", () => {
    const row = feedIndexEntry(nature, facts(), REF);
    expect(row).toEqual({
      id: "journal-nature", kind: nature.kind, status: "ok", label: "OK", error_class: null, url_used: "https://example.org/ut-sample/feed", fallback_used: false, newest: "2026-10-21T00:00:00Z",
      items: 30, records: 12, bytes: 1234, requests: 1, sha256: "a".repeat(64), fetched_at: "2026-10-22T03:20:00+08:00", note: null,
    });
    expect(FeedIndexEntry.parse(row)).toEqual(row);
  });

  it("gives a failed read its error class and no hash, and `network` when the read gave none", () => {
    const row = feedIndexEntry(nature, { ...facts({ ok: false, error: "dns", sha256: null, fetchedAt: null, urlUsed: "https://example.org/ut-sample/x" }, null), items: 0, records: 0 }, REF);
    expect([row.status, row.label, row.error_class, row.sha256, row.fetched_at, row.note]).toEqual(["failed", "FAIL", "dns", null, null, "Failed: dns."]);
    expect(FeedIndexEntry.parse(row)).toEqual(row);
    expect(feedIndexEntry(nature, facts({ ok: false, error: null }), REF).error_class).toBe("network");
  });

  it("records the fallback that answered, and stale as the status", () => {
    const row = feedIndexEntry({ ...nature, fresh_days: 3 }, facts({ fallbackUsed: true }, "2026-09-01"), REF);
    expect([row.status, row.label, row.fallback_used, row.note]).toEqual(["stale", "STALE", true, "Stale: newest item 2026-09-01. Fallback URL used."]);
    expect(FeedIndexEntry.parse(row)).toEqual(row);
  });

  it("passes the strict schema for every feed of the registry read from the fixtures, and for every feed that is never read", async () => {
    fromFixtures();
    const run = fixtureRun();
    const rows: FeedIndexEntry[] = [];
    for (const entry of realConfig().sources.feeds) {
      let f: FeedFacts | null = null;
      if (isCandidateFeed(entry)) f = candidateFacts(entry, await readFeed(entry, ctxFor(), run), REF);
      rows.push(feedIndexEntry(entry, f, REF));
    }
    expect(rows).toHaveLength(realConfig().sources.feeds.length);
    for (const row of rows) expect(FeedIndexEntry.parse(row), row.id).toEqual(row);
    expect(rows.filter((r) => r.status === "skipped").length).toBeGreaterThan(5);
    expect(rows.filter((r) => r.status === "failed")).toEqual([]);
  });
});

describe("writeFeedIndex() and readFeedIndex()", () => {
  const file = (): FeedIndexFile => ({
    schema_version: 1, date: "2026-10-22", generated_at: "2026-10-22T04:00:00+08:00",
    feeds: realConfig().sources.feeds.slice(0, 3).map((e) => feedIndexEntry(e, null, REF)),
  });

  it("writes the index as formatted JSON under cache/feeds/ and reads the same file back", () => {
    const p = cachePaths(root);
    writeFeedIndex(p, file());
    expect(p.feedIndex).toBe(path.join(root, "cache", "feeds", "index.json"));
    expect(fs.readFileSync(p.feedIndex, "utf8")).toBe(`${JSON.stringify(file(), null, 2)}\n`);
    expect(readFeedIndex(p)).toEqual(file());
  });

  it("replaces an earlier index and leaves no temporary file", () => {
    const p = cachePaths(root);
    writeFeedIndex(p, file());
    writeFeedIndex(p, { ...file(), date: "2026-10-23" });
    expect(readFeedIndex(p)!.date).toBe("2026-10-23");
    expect(fs.readdirSync(path.dirname(p.feedIndex))).toEqual(["index.json"]);
  });

  it("refuses an index that breaks the schema and writes nothing, and keeps the earlier one", () => {
    const p = cachePaths(root);
    expect(() => writeFeedIndex(p, { ...file(), date: "22 Oct" } as never)).toThrow();
    expect(fs.existsSync(p.feedIndex)).toBe(false);
    writeFeedIndex(p, file());
    const bad = file();
    (bad.feeds[0] as { status: string }).status = "great";
    expect(() => writeFeedIndex(p, bad)).toThrow();
    expect(readFeedIndex(p)).toEqual(file());
    const extra = { ...file(), feeds: [{ ...file().feeds[0], raw_error: "x" }] };
    expect(() => writeFeedIndex(p, extra as never)).toThrow();
  });

  it("reads null when there is no index, and throws when the file is not an index", () => {
    const p = cachePaths(root);
    expect(readFeedIndex(p)).toBeNull();
    fs.mkdirSync(path.dirname(p.feedIndex), { recursive: true });
    fs.writeFileSync(p.feedIndex, "not json");
    expect(() => readFeedIndex(p)).toThrow();
    fs.writeFileSync(p.feedIndex, JSON.stringify({ schema_version: 2, date: "2026-10-22", generated_at: "2026-10-22T04:00:00+08:00", feeds: [] }));
    expect(() => readFeedIndex(p)).toThrow();
    fs.writeFileSync(p.feedIndex, JSON.stringify({ ...file(), extra: 1 }));
    expect(() => readFeedIndex(p)).toThrow();
  });
});

describe("staleArxivLists() and pruneArxivLists()", () => {
  // 2026-10-22 00:30 UTC is 2026-10-21 20:30 in New York: the US date is the 21st.
  const NOW = Date.parse("2026-10-22T00:30:00Z");
  const p = () => cachePaths(root);
  const put = (...names: string[]) => {
    fs.mkdirSync(p().arxivDir, { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(p().arxivDir, n), "<feed/>");
  };

  it("keeps 60 days, counted from the US date of now, and names a list one day older", () => {
    expect(ARXIV_KEEP_DAYS).toBe(60);
    expect(usDateOf(NOW)).toBe("2026-10-21");
    put("arxiv-math.2026-08-22.xml", "arxiv-math.2026-08-21.xml", "arxiv-math.2026-10-21.xml", "arxiv-math.2025-01-01.xml");
    expect(staleArxivLists(p(), NOW)).toEqual(["arxiv-math.2025-01-01.xml", "arxiv-math.2026-08-21.xml"]);
  });

  it("goes by the date in the name, not the file's age, and by the keep days a caller gives", () => {
    put("arxiv-math.2026-10-10.xml", "arxiv-math.2026-10-19.xml", "arxiv-math.2026-10-20.xml");
    expect(staleArxivLists(p(), NOW, 1)).toEqual(["arxiv-math.2026-10-10.xml", "arxiv-math.2026-10-19.xml"]);
    expect(staleArxivLists(p(), NOW, 11)).toEqual([]);
    expect(staleArxivLists(p(), NOW, 10)).toEqual(["arxiv-math.2026-10-10.xml"]);
  });

  it("never names a file with another name, a date that is not one, or a name with a different case or extension", () => {
    put(
      "notes.txt", ".DS_Store", "arxiv-math.2026-13-45.xml", "arxiv-math.2026-02-30.xml", "Arxiv-math.2020-01-01.xml", "arxiv-math.2020-01-01.xml.tmp-1", "arxiv-math.2020-01-01.XML",
      "arxiv-math.20200101.xml", "-arxiv.2020-01-01.xml", "arxiv-math.2020-01-01.xml.bak", "arxiv-math.2020-1-1.xml", "arxiv-math.2020-01-01.xml ",
    );
    expect(staleArxivLists(p(), NOW)).toEqual([]);
  });

  it("lists in code-unit order across feeds and lists none when the folder is missing", () => {
    expect(staleArxivLists(p(), NOW)).toEqual([]);
    put("arxiv-physics.2020-01-02.xml", "arxiv-math.2020-01-03.xml", "arxiv-math.2020-01-01.xml", "arxiv-cs-ai.2020-01-01.xml");
    expect(staleArxivLists(p(), NOW)).toEqual(["arxiv-cs-ai.2020-01-01.xml", "arxiv-math.2020-01-01.xml", "arxiv-math.2020-01-03.xml", "arxiv-physics.2020-01-02.xml"]);
  });

  it("prunes the stale lists, returns their names and leaves everything else", () => {
    put("arxiv-math.2020-01-01.xml", "arxiv-math.2026-10-20.xml", "notes.txt");
    expect(pruneArxivLists(p(), NOW)).toEqual(["arxiv-math.2020-01-01.xml"]);
    expect(fs.readdirSync(p().arxivDir).sort(byCodeUnit)).toEqual(["arxiv-math.2026-10-20.xml", "notes.txt"]);
    expect(pruneArxivLists(p(), NOW)).toEqual([]);
    expect(pruneArxivLists({ arxivDir: path.join(root, "nowhere") }, NOW)).toEqual([]);
  });

  it("leaves a stale name it cannot remove and does not list it as removed", () => {
    fs.mkdirSync(path.join(p().arxivDir, "arxiv-math.2020-01-01.xml", "inner"), { recursive: true });
    put("arxiv-math.2020-01-02.xml");
    expect(pruneArxivLists(p(), NOW)).toEqual(["arxiv-math.2020-01-02.xml"]);
    expect(fs.existsSync(path.join(p().arxivDir, "arxiv-math.2020-01-01.xml"))).toBe(true);
  });
});

// ── Cases the first mutation check found missing ────────────────────────────────────────────────

describe("the Retraction Watch file: the newest day, the left-out rows and their log line", () => {
  const entry = feedEntry("retraction-watch");
  const AS_OF = "2026-10-22";

  it("takes the newest retraction day as the latest of the rows, whatever their order, and leaves a row dated after the run's day out of it", () => {
    const rows = (dates: string[]) => retractionCsv(dates.map((date) => ({ date })));
    const newest = (dates: string[]) => parseRetractionWatch(Buffer.from(rows(dates)), AS_OF).newest;
    expect(newest(["10/1/2026 0:00", "9/2/2026 0:00"])).toBe("2026-10-01");
    expect(newest(["9/2/2026 0:00", "10/1/2026 0:00", "8/30/2026 0:00"])).toBe("2026-10-01");
    expect(newest(["9/2/2026 0:00", "1/5/2027 0:00"])).toBe("2026-09-02");
    expect(newest(["1/5/2027 0:00"])).toBeNull();
  });

  it("logs the rows left out for a date after the run's day, in the singular for one and the plural for more, and logs nothing when there are none", async () => {
    const lines = async (dates: string[]) => {
      const ctx = ctxFor({ fetch: fakeFetch(() => answer(retractionCsv(dates.map((date) => ({ date }))), { contentType: "text/csv" })).fetch });
      const r = await readRetractionWatch(entry, ctx, AS_OF);
      expect(r.ok).toBe(true);
      return ctx.lines.filter((l) => l.includes("left out"));
    };
    expect(await lines(["10/1/2026 0:00"])).toEqual([]);
    expect(await lines(["10/1/2026 0:00", "1/5/2027 0:00"])).toEqual(["retraction-watch: 1 row is dated after 2026-10-22 and left out"]);
    expect(await lines(["2/5/2027 0:00", "1/5/2027 0:00", "10/1/2026 0:00"])).toEqual(["retraction-watch: 2 rows are dated after 2026-10-22 and left out"]);
  });
});

describe("parsePubmedSearch(): the count", () => {
  const body = (esearchresult: unknown) => Buffer.from(JSON.stringify({ esearchresult }));

  it("is the count the answer gives, even when that is 0 beside some ids; the number of ids when the answer gives none or one that is no number", () => {
    expect(parsePubmedSearch(body({ count: "0", idlist: ["12"] }))).toEqual({ count: 0, ids: ["12"] });
    expect(parsePubmedSearch(body({ count: "1500", idlist: ["12", "13"] })).count).toBe(1500);
    expect(parsePubmedSearch(body({ idlist: ["12", "13"] })).count).toBe(2);
    expect(parsePubmedSearch(body({ count: "many", idlist: ["12", "13", "14"] })).count).toBe(3);
  });
});

describe("parseErdos(): the thread list", () => {
  const base = "https://www.erdosproblems.com/";
  const list = (...items: string[]) => `<ul class="thread-list">${items.map((i) => `<li class="thread-item">${i}</li>`).join("")}</ul>`;

  it("leaves out a thread with no title, one with no readable link and a second link to a thread already listed", () => {
    const html = list(
      '<a class="thread-title" href="/forum/thread/1">   </a>', '<a class="thread-title" href="/forum/thread/2">Two</a>', '<a class="thread-title" href="/forum/thread/2">Two again</a>',
      '<a class="thread-title" href="javascript:void(0)">Script</a>', '<a class="thread-title">No link</a>', '<a class="thread-title" href="/forum/thread/3">Three</a>',
    );
    expect(parseErdos(html, base).map((i) => [i.title, i.url])).toEqual([["Two", `${base}forum/thread/2`], ["Three", `${base}forum/thread/3`]]);
  });
});

describe("parseFutureHouse(): the research page's slugs", () => {
  it("keeps a link with one slug, with or without a closing slash, and leaves out the index, a deeper path and a link seen before", () => {
    const card = (href: string, title: string) => `<div class="card"><a class="u-link-cover" href="${href}">${title}</a></div>`;
    const html = [
      card("/research/", "Index"), card("/research/a/b", "Deeper"), card("/research/ok", "One"), card("/research/ok", "One again"), card("/research/two/", "Two"), card("/research/three/x/", "Too deep"),
    ].join("");
    expect(parseFutureHouse(html, "https://www.futurehouse.org/research").map((i) => [i.title, i.url])).toEqual([
      ["One", "https://www.futurehouse.org/research/ok"], ["Two", "https://www.futurehouse.org/research/two/"],
    ]);
  });
});

describe("the card of a post on a page feed", () => {
  const dated = (levels: number) =>
    `<div class="top"><time datetime="2026-10-20T00:00:00Z">Oct 20, 2026</time>${"<div>".repeat(levels - 1)}<a href="/research/deep">Deep title</a>${"</div>".repeat(levels - 1)}</div>`;
  const day = (levels: number) => parseAnthropic(dated(levels), "https://www.anthropic.com/research", false).map((i) => i.day);

  it("reaches up five containers for the post's date and no further", () => {
    expect(day(1)).toEqual(["2026-10-20"]);
    expect(day(5)).toEqual(["2026-10-20"]);
    expect(day(6)).toEqual([null]);
  });

  it("stops at a container that holds another post's link, so the date of the neighbour is not taken", () => {
    const html = '<div class="top"><div><time datetime="2026-10-20T00:00:00Z">x</time><a href="/research/a">A</a></div><div><a href="/research/b">B</a></div></div>';
    expect(parseAnthropic(html, "https://www.anthropic.com/research", false).map((i) => [i.title, i.day])).toEqual([["A", "2026-10-20"], ["B", null]]);
  });
});

describe("readCrossrefUpdates(): one DOI left, and the body that is kept", () => {
  const entry = feedEntry("crossref-updates");

  it("says `1 DOI` for a single DOI left unchecked, and keeps the first answered body as the cache file", async () => {
    const bodies = [crossrefBody([noticeOf(1)]), crossrefBody([noticeOf(2)]), crossrefBody([])];
    let n = 0;
    const f = fakeFetch(() => (++n === 3 ? answer(null, { error: "timeout" }) : answer(bodies[n - 1]!)));
    const r = await readCrossrefUpdates(entry, ctxFor({ fetch: f.fetch }), watchDois(101));
    expect([r.ok, r.data!.answered.length, r.data!.unanswered]).toEqual([true, 100, [watchDois(101)[100]!]]);
    expect(r.note).toBe("Crossref notices: 1 DOI not checked.");
    expect(cached("crossref-updates.json")).toBe(bodies[0]);
    expect(r.fetched.map((x) => x.sha256)).toEqual([sha256Hex(bodies[0]!), sha256Hex(bodies[1]!)]);
  });
});

describe("parseRcsbUnreleased(): the class of a file that cannot be read", () => {
  const code = (body: Buffer, cap?: number) => {
    try {
      parseRcsbUnreleased(body, cap);
    } catch (e) {
      return parseClass(e);
    }
    return null;
  };

  it("is `too_large` for a gzip that unzips past the cap and for a plain body past it, and `parse` for a gzip that does not unzip", () => {
    const big = gzipJson({ "9ZZ1": { status_code: "AUTH", deposit_date: "2026-03-02T00:00:00+00:00", note: "x".repeat(5_000) } });
    expect(code(big, 1_000)).toBe("too_large");
    expect(code(Buffer.alloc(1_001, 65), 1_000)).toBe("too_large");
    expect(code(Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]))).toBe("parse");
    expect(code(big)).toBeNull();
  });
});

describe("parseCrossrefNotices(): a date with a part that is no integer", () => {
  it("keeps no date parts for it, so a half-read date is never kept", () => {
    const item = (parts: unknown[]) => crossrefBody([noticeOf(1, { published: { "date-parts": [parts] } })]);
    const keep = (parts: unknown[]) => parseCrossrefNotices(Buffer.from(item(parts))).notices[0]!;
    expect([keep([2026, 11, 24]).published, keep([2026, 11, 24]).published_parts]).toEqual(["2026-11-24", [2026, 11, 24]]);
    expect([keep([2026, "x", 24]).published, keep([2026, "x", 24]).published_parts]).toEqual([null, []]);
    expect([keep([2026, 11.5, 24]).published, keep([2026, 11.5, 24]).published_parts]).toEqual([null, []]);
    expect(keep([2026, 11]).published_parts).toEqual([2026, 11]);
  });
});

describe("cacheWrite() at the deadline", () => {
  it("writes nothing at the deadline itself and writes one millisecond before it", () => {
    const file = path.join(root, "cache", "feeds", "edge.txt");
    cacheWrite(ctxFor({ now: () => 1_000, deadline: 1_000 }), file, "late");
    expect(fs.existsSync(file)).toBe(false);
    cacheWrite(ctxFor({ now: () => 999, deadline: 1_000 }), file, "in time");
    expect(fs.readFileSync(file, "utf8")).toBe("in time");
  });
});

describe("the feed index row schema", () => {
  it("accepts a note of 200 characters and refuses one of 201, an empty one and a field it does not name", () => {
    const row = feedIndexEntry(feedEntry("journal-nature"), null, REF);
    expect(FeedIndexEntry.safeParse({ ...row, note: "x".repeat(200) }).success).toBe(true);
    expect(FeedIndexEntry.safeParse({ ...row, note: "x".repeat(201) }).success).toBe(false);
    expect(FeedIndexEntry.safeParse({ ...row, note: "" }).success).toBe(false);
    expect(FeedIndexEntry.safeParse({ ...row, raw: "x" }).success).toBe(false);
    expect(FeedIndexEntry.safeParse({ ...row, error_class: "" }).success).toBe(false);
    expect(FeedIndexEntry.safeParse({ ...row, sha256: "abc" }).success).toBe(false);
  });
});

describe("cachedPdb(): the manifest it is given", () => {
  it("is null when the holdings file is not among the requests, and when it is there twice", async () => {
    fromFixtures();
    const ok = await readPdbStructures(feedEntry("rcsb"), feedEntry("rcsb-unreleased"), ctxFor(), "2026-10-22");
    const counts = ok.counts.fetched;
    const holdings = ok.unreleased.fetched;
    expect(counts).toHaveLength(2);
    expect(cachedPdb(root, [...counts, ...holdings])).toEqual(ok.data);
    expect(cachedPdb(root, counts)).toBeNull();
    expect(cachedPdb(root, holdings)).toBeNull();
    expect(cachedPdb(root, [...counts, ...holdings, ...holdings])).toBeNull();
  });
});

describe("cachedPdb(): the year of a count request", () => {
  it("is read from a range that is a real day: a count request whose range starts at anything else is no count, so the manifest is refused", async () => {
    fromFixtures();
    const ok = await readPdbStructures(feedEntry("rcsb"), feedEntry("rcsb-unreleased"), ctxFor(), "2026-10-22");
    const rangeOf = (url: string) => JSON.parse(new URL(url).searchParams.get("json")!).query.parameters.value.from as unknown;
    // The first count request, its range start replaced; the second count and the holdings request as they were.
    const manifest = (from: unknown) => [...ok.counts.fetched, ...ok.unreleased.fetched].map((r, i) => {
      if (i !== 0) return r;
      const u = new URL(r.url);
      const q = JSON.parse(u.searchParams.get("json")!);
      q.query.parameters.value.from = from;
      u.searchParams.set("json", JSON.stringify(q));
      return { ...r, url: u.toString() };
    });
    expect(cachedPdb(root, manifest(rangeOf(ok.counts.fetched[0]!.url)))).toEqual(ok.data);
    for (const bad of ["not-a-date", "2025-13-45", "2025-02-30", 2025, null]) expect(cachedPdb(root, manifest(bad)), String(bad)).toBeNull();
  });
});

describe("what a read leaves in the cache at the run's deadline", () => {
  const entry = feedEntry("arxiv-math");
  const windowFile = () => arxivCacheFile("arxiv-math", "2026-10-20");

  it("removes a cached list that does not parse before the deadline, and leaves it when the clock is at the deadline", async () => {
    fromFixtures();
    fs.mkdirSync(path.dirname(windowFile()), { recursive: true });
    fs.writeFileSync(windowFile(), "<<< not an Atom answer");
    await readArxiv(entry, ctxFor({ now: () => 1_000, deadline: 1_000 }), fixtureRun({ lookback: false }));
    expect(fs.readFileSync(windowFile(), "utf8")).toBe("<<< not an Atom answer");
    await readArxiv(entry, ctxFor({ now: () => 999, deadline: 1_000 }), fixtureRun({ lookback: false }));
    expect(fs.readFileSync(windowFile(), "utf8")).toBe(fixtureText("arxiv/arxiv-math.xml"));
  });
});

describe("parseCrossrefNotices(): the type of an update", () => {
  it("is lower-cased and trimmed, and a notice whose type is empty after that updates nothing", () => {
    const kinds = (type: string) => parseCrossrefNotices(Buffer.from(crossrefBody([noticeOf(1, { "update-to": [{ DOI: "10.1000/ut-sample-rw-0001", type, updated: { "date-parts": [[2026, 10, 19]] } }] })]))).notices[0]!.updates.map((u) => u.type);
    expect(kinds("  Retraction \n")).toEqual(["retraction"]);
    expect(kinds("EXPRESSION_OF_CONCERN")).toEqual(["expression_of_concern"]);
    expect(kinds("   ")).toEqual([]);
  });
});

describe("the second mutation round's cases", () => {
  it("parsePubmedSearch(): a count written with spaces around it is still the count", () => {
    const body = (count: string) => Buffer.from(JSON.stringify({ esearchresult: { count, idlist: ["1", "2"] } }));
    expect(parsePubmedSearch(body(" 7 ")).count).toBe(7);
    expect(parsePubmedSearch(body("7 8")).count).toBe(2);
    expect(parsePubmedSearch(body("-7")).count).toBe(2);
  });

  it("parseCtgov(): a study that is null, a number, a string or has a protocol section that is no object is left out, and the valid ones stay", () => {
    const study = (id: string) => ({ protocolSection: { identificationModule: { nctId: id }, statusModule: { overallStatus: "COMPLETED" }, designModule: { phases: ["PHASE2"] } } });
    const body = (studies: unknown[]) => Buffer.from(JSON.stringify({ studies }));
    const got = parseCtgov(body([null, 5, "x", [], { protocolSection: 5 }, { protocolSection: null }, study("NCT09990201"), { protocolSection: { identificationModule: 7 } }]));
    expect([...got.keys()]).toEqual(["NCT09990201"]);
  });

  it("the arXiv listing: an entry whose announce type has spaces around `replace` is a revision of an older paper, and is dropped", async () => {
    const LISTING = "https://rss.arxiv.org/atom/math";
    const body = fixtureText("arxiv/listing-math.xml");
    expect(body).toMatch(/<arxiv:announce_type>replace/);
    const spaced = body.replace(/<arxiv:announce_type>replace/g, "<arxiv:announce_type>  replace");
    fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 404 }, [LISTING]: { body: spaced, content_type: "application/atom+xml" } }));
    const r = await readArxiv(feedEntry("arxiv-math"), ctxFor(), fixtureRun({ lookback: false }));
    expect(r.data!.items.map((i) => i.arxiv)).toEqual(["2610.99001"]);
  });

  it("a link of only spaces is no link: the item that carries it is left out of a page feed", () => {
    const html = '<article class="article-list-item"><header><h3><a href="   ">Spaces only</a></h3></header><time datetime="2026-10-21T02:00:00Z"></time></article>'
      + '<article class="article-list-item"><header><h3><a href="/reaction/ok">Fine</a></h3></header></article>';
    expect(parseSmcPage(html, "https://www.sciencemediacentre.org/").map((i) => i.title)).toEqual(["Fine"]);
  });

  it("the Science Media Centre's page: a link listed twice is kept once, with the title it had first, and a link with no title is left out", () => {
    const card = (href: string, text: string) => `<article class="article-list-item"><header><h3><a href="${href}">${text}</a></h3></header></article>`;
    const html = [card("/expert-reaction-to-one", "One"), card("/expert-reaction-to-one", "One again"), card("/expert-reaction-to-blank", "   "), card("/expert-reaction-to-two", "Two")].join("");
    expect(parseSmcPage(html, "https://www.sciencemediacentre.org/").map((i) => [i.title, i.url])).toEqual([
      ["One", "https://www.sciencemediacentre.org/expert-reaction-to-one"], ["Two", "https://www.sciencemediacentre.org/expert-reaction-to-two"],
    ]);
  });

  it("Isomorphic Labs: of two links to one page the first stays, unless the later one has a heading and the first has none", () => {
    const html = `<a class="news-card" href="/articles/one">Bare One</a>
      <a class="news-card" href="/articles/one">Bare One again</a>
      <a class="news-card" href="/articles/two"><h4>Head Two</h4></a>
      <a class="news-card" href="/articles/two"><h4>Head Two again</h4></a>
      <a class="news-card" href="/articles/three">Bare Three</a>
      <a class="news-card" href="/articles/three"><h4>Head Three</h4></a>`;
    expect(parseIsomorphic(html, "https://www.isomorphiclabs.com/news").map((i) => i.title)).toEqual(["Bare One", "Head Two", "Head Three"]);
  });

  it("readCrossrefJournals(): asks for a second page only when the journal holds more than the page it has read (100 of 100 is the whole)", async () => {
    const one = [{ id: "nature", issn: "0028-0836" }];
    const asked = async (total: number) => {
      const f = fakeFetch((url) => answer(crossrefBody(Array.from({ length: 100 }, (_, i) => crossrefWork(i + 1 + (/offset=100/.test(url) ? 100 : 0))), total)));
      const r = await readCrossrefJournals(feedEntry("crossref-journals"), ctxFor({ fetch: f.fetch }), fixtureRun({ journals: one }));
      return [f.calls.length, r.requests, r.data!.items.length];
    };
    expect(await asked(99)).toEqual([1, 1, 100]);
    expect(await asked(100)).toEqual([1, 1, 100]);
    expect(await asked(101)).toEqual([2, 2, 200]);
  });
});

describe("the third mutation round's cases", () => {
  it("the arXiv listing is accepted when it was built at the announcement itself, and refused when built one second before", async () => {
    const LISTING = "https://rss.arxiv.org/atom/math";
    const body = fixtureText("arxiv/listing-math.xml");
    const announced = windowAnnouncement(FIXTURE_DATE, realConfig().sources.arxiv_skipped)!;
    const built = (ms: number) => body.replace("<updated>2026-10-21T04:00:00Z</updated>", `<updated>${new Date(ms).toISOString().replace(".000Z", "Z")}</updated>`);
    const read = async (ms: number) => {
      fromFixtures(writeFixtureDir({ [MATH_WINDOW_URL]: { status: 404 }, [LISTING]: { body: built(ms), content_type: "application/atom+xml" } }));
      root = tempDir("ut-feed-readers-boundary-");
      return readArxiv(feedEntry("arxiv-math"), ctxFor(), fixtureRun({ lookback: false }));
    };
    expect((await read(announced.announcedMs)).ok).toBe(true);
    const early = await read(announced.announcedMs - 1_000);
    expect([early.ok, early.error]).toEqual([false, "schema"]);
  });

  it("parsePubmedSummary(): a publication type that is blank or no string is left out, and the rest are squashed", () => {
    const body = JSON.stringify({ result: { uids: ["1"], 1: { title: "One", pubtype: ["  Journal   Article ", "   ", 5, null, "", ["x"], "Review"] } } });
    expect(parsePubmedSummary(Buffer.from(body)).get("1")!.types).toEqual(["Journal Article", "Review"]);
  });

  it("parseBiorxiv(): the page's own count is kept when it is 0, even beside records", () => {
    const page = parseBiorxiv(Buffer.from(bioPage([bioRecord(1)], 0, 5)), "biorxiv");
    expect([page.count, page.items.length]).toEqual([0, 1]);
  });

  it("readBiorxiv(): keeps the highest version of a DOI whichever page or place it comes in, and a record with no valid DOI never gets here", async () => {
    const entry = feedEntry("biorxiv");
    const url = (cursor: number) => `https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-21/${cursor}`;
    const pages: Record<number, string> = {
      0: bioPage([bioRecord(1, { version: "3", title: "Third" }), bioRecord(1, { version: "1", title: "First" }), bioRecord(2, { version: "1", title: "Other" }), bioRecord(3, { doi: "not a doi" })], 2, 4),
      2: bioPage([bioRecord(1, { version: "2", title: "Second" }), bioRecord(2, { version: "4", title: "Other four" })], 2, 4, 2),
    };
    const f = fakeFetch((u) => answer(pages[Number(u.split("/").at(-1))]!, { contentType: "application/json" }));
    const r = await readBiorxiv(entry, ctxFor({ fetch: f.fetch }), fixtureRun());
    expect(f.urls()).toEqual([url(0), url(2)]);
    expect(r.data!.items.map((i) => [i.doi, i.title])).toEqual([["10.1101/2026.10.20.100001", "Third"], ["10.1101/2026.10.20.100002", "Other four"]]);
  });

  it("a page whose content type has spaces or capitals around the kind is still a page, and one that is JSON is not", async () => {
    const entry = feedEntry("lab-futurehouse");
    const html = '<div class="card"><a class="u-link-cover" href="/research/ok">Fine</a></div>';
    for (const type of [" TEXT/HTML ; charset=utf-8", "text/plain", "application/xhtml+xml", "Text/Html"]) {
      const r = await readPageFeed(entry, ctxFor({ fetch: fakeFetch(() => answer(html, { contentType: type })).fetch }));
      expect([type, r.ok]).toEqual([type, true]);
    }
    for (const type of ["application/json", "application/pdf", "text/xml"]) {
      const r = await readPageFeed(entry, ctxFor({ fetch: fakeFetch(() => answer(html, { contentType: type })).fetch }));
      expect([type, r.ok, r.error]).toEqual([type, false, "parse"]);
    }
  });

  it("a first address that answers the wrong kind of body hands over to the fallback, which is read as the page it is", async () => {
    const entry = feedEntry("lab-anthropic");
    const f = fakeFetch((url) => (url === entry.url ? answer('{"not":"a page"}', { contentType: "application/json" }) : answer(fixtureBytes("pages/feed-lab-anthropic-news.html"), { contentType: "text/html" })));
    const r = await readPageFeed(entry, ctxFor({ fetch: f.fetch }));
    expect(f.urls()).toEqual([entry.url, entry.fallback_url]);
    expect([r.ok, r.fallbackUsed, r.triedFallback, r.requests]).toEqual([true, true, true, 2]);
  });
});

describe("the fourth mutation round's cases", () => {
  it("parseArc(): leaves out an article with no title, one with no readable link and a second one for a link already listed", () => {
    const art = (inner: string, time = "2026-10-12T00:00:00Z") => `<article class="PostList_postItem__x"><h3>${inner}</h3><time datetime="${time}"></time></article>`;
    const html = [art('<a href="/news/blank">   </a>'), art('<a href="/news/one">One</a>'), art('<a href="/news/one">One again</a>'), art('<a href="/news/two">Two</a>', "2026-10-13T00:00:00Z"), '<article class="PostList_postItem__x"><h3>No link</h3></article>'].join("");
    expect(parseArc(html, "https://arcinstitute.org/news").map((i) => [i.title, i.url, i.day])).toEqual([["One", "https://arcinstitute.org/news/one", "2026-10-12"], ["Two", "https://arcinstitute.org/news/two", "2026-10-13"]]);
  });

  it("readCrossrefUpdates(): fails when the only batch fails, even with a single DOI, and gives the notices of the batches that answered otherwise", async () => {
    const entry = feedEntry("crossref-updates");
    const one = await readCrossrefUpdates(entry, ctxFor({ fetch: fakeFetch(() => answer(null, { error: "dns" })).fetch }), watchDois(1));
    expect([one.ok, one.error, one.data!.answered, one.data!.unanswered]).toEqual([false, "dns", [], watchDois(1)]);
    const none = await readCrossrefUpdates(entry, ctxFor({ fetch: fakeFetch(() => answer(null, { error: "dns" })).fetch }), []);
    expect([none.ok, none.requests, none.data!.answered, none.data!.unanswered]).toEqual([true, 0, [], []]);
  });
});

describe("the fifth mutation round's cases", () => {
  it("readPubmed(): a budget that runs out before the abstracts says so once, and one that runs out before the summaries says how many PMIDs were left", async () => {
    const entry = feedEntry("pubmed");
    const short = await readPubmed({ ...entry, budget: 8 }, ctxFor({ fetch: fakePubmed(pmids(1000)).fetch }), fixtureRun());
    expect([short.ok, short.requests, short.data!.items.length]).toEqual([true, 8, 1000]);
    expect(short.data!.unread).toEqual(["abstracts past the budget"]);
    expect(short.note).toBe("PubMed: abstracts past the budget not read.");
    const tiny = await readPubmed({ ...entry, budget: 3 }, ctxFor({ fetch: fakePubmed(pmids(1000)).fetch }), fixtureRun());
    expect([tiny.ok, tiny.requests, tiny.data!.items.length]).toEqual([true, 3, 400]);
    expect(tiny.data!.unread).toEqual(["summaries of 600 PMIDs", "abstracts past the budget"]);
  });

  it("parsePubmedSummary(): a record with no title is left out and the records after it are still read", () => {
    const body = JSON.stringify({ result: { uids: ["1", "2", "3"], 1: { title: "One" }, 2: { title: "  " }, 3: { title: "Three" } } });
    expect([...parsePubmedSummary(Buffer.from(body)).keys()]).toEqual(["1", "3"]);
  });

  it("a first request that has a fallback behind it may retry when the budget leaves room for both, and the fallback's own retry is not cut for the first's sake", async () => {
    const entry = { ...feedEntry("journal-cell"), budget: 4 };
    const f = fakeFetch(() => answer(null, { error: "timeout", attempts: 2 }));
    const r = await readRssFeed(entry, ctxFor({ fetch: f.fetch }));
    expect(f.calls.map((c) => c.opts.retryDelayMs)).toEqual([undefined, undefined]);
    expect([r.ok, r.error, r.requests, r.triedFallback]).toEqual([false, "timeout", 4, true]);
  });

  it("textDate(): month names in full or cut at three letters, with Sept as the four-letter form, in each of the layouts", () => {
    expect(textDate("20 October 2026")).toBe("2026-10-20");
    expect(textDate("October 20, 2026")).toBe("2026-10-20");
    expect(textDate("2026 October 20")).toBe("2026-10-20");
    expect(textDate("2026 Sept 20")).toBe("2026-09-20");
    expect(textDate("20 Sept 2026")).toBe("2026-09-20");
    expect(textDate("Sept 20, 2026")).toBe("2026-09-20");
    expect(textDate("20 Xyz 2026")).toBeNull();
  });

  it("readCrossrefJournals(): an article with a DOI and no link is linked through doi.org, and one with neither is left out and still counted", async () => {
    const entry = feedEntry("crossref-journals");
    const noUrl = (n: number, over: Record<string, unknown>) => ({ ...crossrefWork(n, { URL: undefined, ...over }) });
    const body = crossrefBody([noUrl(1, {}), noUrl(2, { DOI: undefined }), { ...noUrl(3, {}), DOI: "not a doi" }]);
    const r = await readCrossrefJournals(entry, ctxFor({ fetch: fakeFetch(() => answer(body)).fetch }), fixtureRun({ journals: realConfig().journals.journals.slice(0, 1).map((j) => ({ id: j.id, issn: j.issn })) }));
    expect(r.data!.items.map((i) => [i.title, i.url, i.doi])).toEqual([["A sample work 1", "https://doi.org/10.1000/ut-sample-w-1", "10.1000/ut-sample-w-1"]]);
    expect([r.data!.total, r.data!.items.length]).toEqual([3, 1]);
  });
});

describe("the reviewer's mutation round's cases", () => {
  it("readBiorxiv(): of two records with one DOI and one version the first read stays", async () => {
    const entry = feedEntry("biorxiv");
    const page = bioPage([bioRecord(1, { version: "2", title: "First of the two" }), bioRecord(1, { version: "2", title: "Second of the two" })], 2, 2);
    const r = await readBiorxiv(entry, ctxFor({ fetch: fakeFetch(() => answer(page, { contentType: "application/json" })).fetch }), fixtureRun());
    expect(r.data!.items.map((i) => i.title)).toEqual(["First of the two"]);
  });

  it("readCrossrefJournals(): a page that holds fewer works than the total says still sends the reader to the next page when it holds any, and not when it holds none", async () => {
    const one = [{ id: "nature", issn: "0028-0836" }];
    const asked = async (works: unknown[], total: number) => {
      const f = fakeFetch((url) => answer(/offset=100/.test(url) ? crossrefBody([], total) : crossrefBody(works, total)));
      const r = await readCrossrefJournals(feedEntry("crossref-journals"), ctxFor({ fetch: f.fetch }), fixtureRun({ journals: one }));
      return [f.calls.length, r.data!.items.length];
    };
    expect(await asked([crossrefWork(1)], 250)).toEqual([2, 1]);
    expect(await asked([], 250)).toEqual([1, 0]);
  });
});
