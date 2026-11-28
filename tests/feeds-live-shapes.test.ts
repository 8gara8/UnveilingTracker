// The registry against its readers and their fixtures (SPEC §4.13, §8.3, §8.13, §9.8): `config/sources.yaml` and `fixtures/feeds/index.json` walked together, so a feed
// added to the registry without a reader, without a fixture body or without a test fails here by name. Every feed is read from its own saved body through
// UT_FIXTURE_FEEDS (the fetcher's fixture mode), its fallback is read when its first address fails, and the index and its bodies are checked the way
// tests/fixture-safety.test.ts checks the fixtures (that file scans every saved body for links, people, secrets and markup; the checks below are the ones that
// belong to the feed folder alone: names, content types, sizes, the three RSS shapes). No test reaches a host. New for this project.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchFeed, type FetchOptions, type FetchResult } from "@/lib/feeds/http";
import { byCodeUnit } from "@/lib/ids";
import type { FeedEntry } from "@/lib/schema/registry";
import {
  FeedIndexEntry, candidateFacts, dataFacts, feedIndexEntry, feedVerdict,
} from "../scripts/lib/feed-cache";
import {
  PAGE_FEEDS, feedCtx, isCandidateFeed, probeDataFeed, readFeed, readRetractionWatch, readerKind,
  type FeedData, type FeedCtx, type Read, type ReaderKind,
} from "../scripts/lib/feeds";
import { FEEDS_DIR, ROOT, answer, fixtureRun, realConfig, removeTempDirs, retractionCsv, tempDir } from "./helpers/feed-bodies";

const FEEDS: readonly FeedEntry[] = realConfig().sources.feeds;
/** The judging time of the fixture morning: the end of its window, 2026-10-22 03:15 Taipei. */
const REF = Date.parse("2026-10-21T19:15:00Z");
const EM_DASH = String.fromCharCode(0x2014);

type Index = Record<string, { file?: string; content_type?: string; status?: number }>;
const INDEX = JSON.parse(fs.readFileSync(path.join(FEEDS_DIR, "index.json"), "utf8")) as Index;

/** The Ledger's saved pages (P2's other half) are in the same index; no registry feed reads them. */
const isLedgerKey = (url: string): boolean => /ut-sample-ledger/.test(url) || (INDEX[url]?.file ?? "").startsWith("pages/ledger-");

// ── The walk: every feed read once, from its fixture ─────────────────────────────────────────────

interface Walked {
  read: Read<unknown> | null;
  urls: string[];
}

const walked = new Map<string, Walked>();
const fallbackWalked = new Map<string, Walked>();
const deepWalked = new Map<string, Walked>();
const usedKeys = new Set<string>();

/** A fetcher that notes every URL it is asked for and answers through `inner` (the real fetcher in fixture mode, by default). */
function noting(urls: string[], inner: (url: string, opts: FetchOptions) => Promise<FetchResult> = fetchFeed): FeedCtx["fetch"] {
  return (async (url: string, opts: FetchOptions = {}) => {
    urls.push(url);
    usedKeys.add(url);
    return inner(url, opts);
  }) as typeof fetchFeed;
}

const readerOf = (entry: FeedEntry): ReaderKind => readerKind(entry) as ReaderKind;

beforeAll(async () => {
  process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
  const rootMain = tempDir("ut-live-shapes-main-");
  const rootFallback = tempDir("ut-live-shapes-fallback-");
  const rootDeep = tempDir("ut-live-shapes-deep-");
  for (const entry of FEEDS) {
    const urls: string[] = [];
    const ctx = feedCtx(rootMain, { fetch: noting(urls) });
    const kind = readerKind(entry);
    let read: Read<unknown> | null = null;
    if (isCandidateFeed(entry)) read = await readFeed(entry, ctx, fixtureRun());
    else if (kind === "retraction-watch") {
      // The file's body cannot be committed (SPEC §8.13), so a test builds it.
      const csv = retractionCsv([{ date: "10/1/2026 0:00" }, { date: "9/2/2026 0:00" }]);
      read = await readRetractionWatch(entry, feedCtx(rootMain, { fetch: noting(urls, async () => answer(csv, { contentType: "text/csv" })) }), "2026-10-22");
    } else if (kind !== null && kind !== "none" && kind !== "openalex") read = await probeDataFeed(entry, ctx, fixtureRun());
    walked.set(entry.id, { read, urls });
  }
  for (const entry of FEEDS.filter((e) => isCandidateFeed(e) && e.fallback_url !== null)) {
    const urls: string[] = [];
    const inner = async (url: string, opts: FetchOptions): Promise<FetchResult> => (url === entry.fallback_url ? fetchFeed(url, opts) : answer(null, { error: "dns", attempts: 1 }));
    fallbackWalked.set(entry.id, { read: await readFeed(entry, feedCtx(rootFallback, { fetch: noting(urls, inner) }), fixtureRun({ lookback: false })), urls });
  }
  for (const entry of FEEDS.filter((e) => readerKind(e) === "arxiv")) {
    const urls: string[] = [];
    deepWalked.set(entry.id, { read: await readFeed({ ...entry, budget: 3 }, feedCtx(rootDeep, { fetch: noting(urls) }), fixtureRun()), urls });
  }
});

afterAll(() => {
  delete process.env.UT_FIXTURE_FEEDS;
  removeTempDirs();
});

// ── The registry ─────────────────────────────────────────────────────────────────────────────────

describe("config/sources.yaml and the readers", () => {
  it("gives every feed a reader, so a feed added without one fails here and names itself", () => {
    expect(FEEDS.filter((f) => readerKind(f) === null).map((f) => `${f.id} (${f.parser})`)).toEqual([]);
    expect(FEEDS.length).toBeGreaterThan(55);
  });

  it("has unique ids, and a budget that fits the feed: none for a feed never read, one at least for the rest, two at least when it has a fallback", () => {
    expect(new Set(FEEDS.map((f) => f.id)).size).toBe(FEEDS.length);
    for (const f of FEEDS) {
      if (f.parser === "none") expect([f.id, f.budget, readerKind(f)], f.id).toEqual([f.id, 0, "none"]);
      else expect(f.budget, f.id).toBeGreaterThanOrEqual(f.fallback_url === null ? 1 : 2);
      if (f.parser === "none") expect(f.fallback_url, f.id).toBeNull();
    }
  });

  it("holds only whole https addresses with no user info, port, fragment or key in them", () => {
    for (const f of FEEDS) {
      for (const u of [f.url, f.fallback_url].filter((x): x is string => x !== null)) {
        const url = new URL(u);
        expect(url.protocol, `${f.id} ${u}`).toBe("https:");
        expect([url.username, url.password, url.port, url.hash], `${f.id} ${u}`).toEqual(["", "", "", ""]);
        expect([...url.searchParams.keys()].filter((k) => /key|token|secret|mailto|email|password/i.test(k)), `${f.id} ${u}`).toEqual([]);
      }
    }
  });

  it("keeps the page parsers and the registry's page feeds the same set: no page parser without a feed, no `html` feed without a parser", () => {
    const pages = FEEDS.filter((f) => readerKind(f) === "page").map((f) => f.id).sort(byCodeUnit);
    expect(Object.keys(PAGE_FEEDS).sort(byCodeUnit)).toEqual(pages);
    expect(pages.length).toBe(9);
  });

  it("is read, for each kind of reader the registry uses, by a function that tests/feed-readers.test.ts calls", () => {
    const READER_FUNCTION: Record<ReaderKind, string | null> = {
      arxiv: "readArxiv", biorxiv: "readBiorxiv", pubmed: "readPubmed", "crossref-journals": "readCrossrefJournals", rss: "readRssFeed", smc: "readSmc", page: "readPageFeed",
      "crossref-updates": "readCrossrefUpdates", ctgov: "readCtgov", rcsb: "readRcsbCounts", "rcsb-unreleased": "readRcsbUnreleased", "retraction-watch": "readRetractionWatch",
      mathlib: "readMathlib", openalex: null, none: null,
    };
    const source = fs.readFileSync(path.join(ROOT, "tests", "feed-readers.test.ts"), "utf8");
    const kinds = new Set(FEEDS.map((f) => readerOf(f)));
    expect([...kinds].sort(byCodeUnit)).toEqual(Object.keys(READER_FUNCTION).sort(byCodeUnit));
    for (const [kind, fn] of Object.entries(READER_FUNCTION)) {
      if (fn === null) continue;
      expect(source.split(`${fn}(`).length - 1, `${kind}: ${fn}`).toBeGreaterThanOrEqual(3);
    }
  });
});

// ── The index and its bodies ─────────────────────────────────────────────────────────────────────

const walkFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const FILES = walkFiles(FEEDS_DIR).map((f) => path.relative(FEEDS_DIR, f).split(path.sep).join("/")).filter((f) => f !== "index.json");

describe("fixtures/feeds/index.json and its bodies", () => {
  it("lists the Ledger's six keys first, as they were written, then the feeds' keys sorted by code unit; each entry is a file with its content type, or a status alone", () => {
    const keys = Object.keys(INDEX);
    const ledger = keys.filter(isLedgerKey);
    expect(keys.slice(0, ledger.length)).toEqual(ledger);
    expect(ledger).toHaveLength(6);
    const rest = keys.slice(ledger.length);
    expect(rest).toEqual([...rest].sort(byCodeUnit));
    for (const [url, e] of Object.entries(INDEX)) {
      expect(Object.keys(e).every((k) => ["file", "content_type", "status"].includes(k)), url).toBe(true);
      if (e.file !== undefined) expect(typeof e.content_type, url).toBe("string");
      else expect(typeof e.status, url).toBe("number");
      if (e.status !== undefined) expect(e.status >= 100 && e.status < 600, url).toBe(true);
    }
  });

  it("keys whole https addresses, and every key's file exists in the folder, with no way out of it", () => {
    for (const [u, e] of Object.entries(INDEX)) {
      const url = new URL(u);
      expect([url.protocol, url.username, url.password, url.port, url.hash], u).toEqual(["https:", "", "", "", ""]);
      if (e.file === undefined) continue;
      expect(e.file, u).not.toMatch(/(^|\/)\.\.(\/|$)|^\/|\\/);
      expect(fs.lstatSync(path.join(FEEDS_DIR, e.file)).isFile(), u).toBe(true);
    }
  });

  it("leaves no body that no key names", () => {
    const named = new Set(Object.values(INDEX).flatMap((e) => (e.file === undefined ? [] : [e.file])));
    expect(FILES.filter((f) => !named.has(f))).toEqual([]);
  });

  it("holds only .json, .xml and pages/*.html files, each with the content type its extension says", () => {
    for (const [u, e] of Object.entries(INDEX)) {
      if (e.file === undefined) continue;
      const type = (e.content_type as string).toLowerCase();
      if (e.file.endsWith(".json")) expect(type, u).toMatch(/^application\/json/);
      else if (e.file.endsWith(".xml")) expect(type, u).toMatch(/^application\/(atom|rss|rdf)?\+?xml|^text\/xml/);
      else if (/^pages\/[^/]+\.html$/.test(e.file)) expect(type === "application/pdf" || /^text\/html/.test(type), u).toBe(true);
      else throw new Error(`${u}: ${e.file} is not a kind of body the folder keeps`);
    }
    for (const f of FILES) expect(/\.(json|xml)$|^pages\/[^/]+\.html$/.test(f), f).toBe(true);
  });

  it("holds strict UTF-8 text, small, with no em dash, no byte order mark, no NUL, no e-mail address on a real domain and no machine path", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const f of FILES) {
      const bytes = fs.readFileSync(path.join(FEEDS_DIR, f));
      expect(bytes.length, f).toBeGreaterThan(0);
      expect(bytes.length, f).toBeLessThan(64 * 1024);
      const text = decoder.decode(bytes);
      expect(text.charCodeAt(0), f).not.toBe(0xfeff);
      expect(text.includes(EM_DASH), f).toBe(false);
      expect(text.includes("\0"), f).toBe(false);
      const emails = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? []).filter((m) => !/@(?:[a-z0-9-]+\.)*example\.(?:org|com|net)$/i.test(m));
      expect(emails, f).toEqual([]);
      expect(/\/(?:Users|home)\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\\\/.test(text), f).toBe(false);
    }
  });

  it("holds well-formed JSON in each .json body, and no document type declaration that names an address or an entity in any .xml body", () => {
    for (const f of FILES) {
      const text = fs.readFileSync(path.join(FEEDS_DIR, f), "utf8");
      if (f.endsWith(".json")) expect(() => JSON.parse(text), f).not.toThrow();
      if (f.endsWith(".xml")) {
        expect(text.trimStart().startsWith("<"), f).toBe(true);
        expect(/<!DOCTYPE[^>]*(?:SYSTEM|PUBLIC|\[)|<!ENTITY/i.test(text), f).toBe(false);
      }
    }
  });

  it("holds the three RSS shapes the registry's journals use: RSS 2.0, RSS 1.0 (RDF) and Atom", () => {
    const roots = new Set(FILES.filter((f) => f.startsWith("rss/")).map((f) => /<(rdf:RDF|rss|feed)\b/.exec(fs.readFileSync(path.join(FEEDS_DIR, f), "utf8"))?.[1] ?? "none"));
    expect([...roots].sort(byCodeUnit)).toEqual(["feed", "rdf:RDF", "rss"]);
  });

  it("names a registry feed's body by the feed's id: rss/<id>.xml, pages/feed-<id>.html (a lab's own prefix kept), arxiv/<id>.xml", () => {
    for (const f of FEEDS) {
      const kind = readerOf(f);
      const file = INDEX[f.url]?.file;
      if (kind === "rss" || kind === "smc") expect(file, f.id).toBe(`rss/${f.id}.xml`);
      else if (kind === "page") expect(file, f.id).toBe(`pages/feed-${f.id}.html`);
      else if (kind === "mathlib") expect(file, f.id).toBe("pages/feed-mathlib-stats.html");
    }
    for (const f of FEEDS.filter((x) => readerKind(x) === "arxiv")) expect(FILES.includes(`arxiv/${f.id}.xml`), f.id).toBe(true);
  });
});

// ── Every feed, read from its body ───────────────────────────────────────────────────────────────

describe("every registry feed read from its fixture body", () => {
  for (const entry of FEEDS) {
    const kind = readerKind(entry);
    if (kind === "none") {
      it(`${entry.id}: is never read (parser none): no body, no request`, () => {
        expect(walked.get(entry.id)).toEqual({ read: null, urls: [] });
        expect(entry.budget).toBe(0);
      });
    } else if (kind === "openalex") {
      it(`${entry.id}: is read by the OpenAlex client, which the collect stage's tests cover, not by a reader here`, () => {
        expect(isCandidateFeed(entry)).toBe(false);
        expect(walked.get(entry.id)).toEqual({ read: null, urls: [] });
      });
    } else if (isCandidateFeed(entry)) {
      it(`${entry.id}: reads from its saved body, gives items, spends no more than its budget and is fresh on the fixture morning`, () => {
        const w = walked.get(entry.id)!;
        const r = w.read as Read<FeedData>;
        expect([r.ok, r.error], `${entry.id}: no fixture body, or the reader does not read it`).toEqual([true, null]);
        expect([r.triedFallback, r.fallbackUsed], `${entry.id}: its first address answered, so no fallback was tried`).toEqual([false, false]);
        expect(r.data!.items.length, entry.id).toBeGreaterThan(0);
        expect(r.requests, entry.id).toBeLessThanOrEqual(entry.budget);
        expect(w.urls.length, entry.id).toBeLessThanOrEqual(entry.budget);
        expect(w.urls.every((u) => u.startsWith("https://") && u in INDEX), entry.id).toBe(true);
        expect(r.sha256, entry.id).toMatch(/^[0-9a-f]{64}$/);
        for (const item of r.data!.items) {
          expect(item.title.trim(), entry.id).not.toBe("");
          expect(item.url, entry.id).toMatch(/^https?:\/\/[^\s]+$/);
        }
        const facts = candidateFacts(entry, r as Read<FeedData>, REF);
        if (entry.fresh_days !== null) expect(facts.newest, `${entry.id} has no dated item`).not.toBeNull();
        const verdict = feedVerdict(entry, facts, REF);
        expect([verdict.state, verdict.label], `${entry.id}: ${verdict.note}`).toEqual(["ok", "OK"]);
        const row = feedIndexEntry(entry, facts, REF);
        expect(FeedIndexEntry.parse(row)).toEqual(row);
      });
    } else {
      it(`${entry.id}: reads its counter from its saved body (or the body a test builds) within its budget`, () => {
        const w = walked.get(entry.id)!;
        const r = w.read as Read<unknown>;
        expect([r.ok, r.error], `${entry.id}: no fixture body, or the reader does not read it`).toEqual([true, null]);
        expect([r.triedFallback, r.fallbackUsed], `${entry.id}: it has one address`).toEqual([false, false]);
        expect(r.data, entry.id).not.toBeNull();
        expect(r.requests, entry.id).toBeLessThanOrEqual(entry.budget);
        expect(w.urls.length, entry.id).toBeLessThanOrEqual(entry.budget);
        expect(w.urls.every((u) => u.startsWith("https://")), entry.id).toBe(true);
        const facts = dataFacts(r, null, 1);
        expect(feedVerdict({ fresh_days: null }, facts, REF).state, entry.id).toBe("ok");
      });
    }
  }

  it("reads every registry feed that gives candidates, and every counter but the two that are not read here", () => {
    const read = [...walked.entries()].filter(([, w]) => w.read !== null).map(([id]) => id);
    const unread = [...walked.entries()].filter(([, w]) => w.read === null).map(([id]) => id).sort(byCodeUnit);
    expect(unread).toEqual(["naer-terms", "openalex"]);
    expect(read.length).toBe(FEEDS.length - 2);
  });
});

describe("every feed that has a fallback address", () => {
  const withFallback = FEEDS.filter((f) => isCandidateFeed(f) && f.fallback_url !== null);

  it("is a set the registry names: the eight arXiv feeds, two journals and the two labs' or centre's pages", () => {
    expect(withFallback.map((f) => f.id).sort(byCodeUnit)).toEqual([
      "arxiv-astro-ph", "arxiv-cond-mat", "arxiv-math", "arxiv-physics", "arxiv-physics-chem-ph", "arxiv-q-bio", "arxiv-quant-ph", "arxiv-stat-ml", "journal-cell", "journal-lancet",
      "lab-anthropic", "smc-reactions",
    ]);
  });

  for (const entry of withFallback) {
    it(`${entry.id}: reads its fallback when its first address fails, in two requests at most`, () => {
      const w = fallbackWalked.get(entry.id)!;
      const r = w.read as Read<FeedData>;
      expect([r.ok, r.error, r.fallbackUsed, r.triedFallback, r.urlUsed], entry.id).toEqual([true, null, true, true, entry.fallback_url]);
      expect(r.requests, entry.id).toBeLessThanOrEqual(entry.budget);
      expect(w.urls.at(-1), entry.id).toBe(entry.fallback_url);
      expect(w.urls.length, entry.id).toBeLessThanOrEqual(entry.budget);
      const row = feedIndexEntry(entry, candidateFacts(entry, r, REF), REF);
      expect([row.fallback_used, row.url_used], entry.id).toEqual([true, entry.fallback_url]);
      expect(row.note, entry.id).toContain("Fallback URL used.");
    });
  }
});

describe("the arXiv feeds with room for a second lookback list", () => {
  for (const entry of FEEDS.filter((f) => readerKind(f) === "arxiv")) {
    it(`${entry.id}: reads the window's list and both lookback lists in three requests, and none of the lists comes from the listing feed`, () => {
      const w = deepWalked.get(entry.id)!;
      const r = w.read as Read<FeedData>;
      expect([r.ok, r.requests, r.data!.unread], entry.id).toEqual([true, 3, []]);
      expect(w.urls.length, entry.id).toBe(3);
      expect(w.urls.every((u) => u.startsWith("https://export.arxiv.org/api/query?search_query=")), entry.id).toBe(true);
    });
  }
});

describe("the fixture index", () => {
  it("is read in full: every key is asked for by a reader of the registry, but the Ledger's own pages", () => {
    const unused = Object.keys(INDEX).filter((k) => !usedKeys.has(k)).sort(byCodeUnit);
    expect(unused.filter((k) => !isLedgerKey(k))).toEqual([]);
    expect(unused.length).toBeGreaterThan(0);
    expect(Object.keys(INDEX).filter((k) => usedKeys.has(k) && isLedgerKey(k))).toEqual([]);
  });
});
