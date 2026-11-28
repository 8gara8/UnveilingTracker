// scripts/lib/openalex.ts (SPEC §5.1 the four group-by requests and the field map, §5.4 the answer cache and a week's last morning,
// §8.3 the DOI lookup, §9.6 the key, §10 P2 step 2 the sampler): every request URL is pinned as a literal string, built by hand
// from the spec's own sentences, and every answer the client reads is served from a fixture folder through `UT_FIXTURE_FEEDS`, so no
// request leaves the machine. `fetchFeed` itself is the real one, wrapped in a spy that records the URLs and the options it was
// given: the order of a week's requests, the key on the wire and nowhere else, and the options each request carries are read there.
// The numbers (the shares of a draw, the PRNG's outputs) were worked outside the code under test, in a separate implementation.
// New for this project; Cyber has no OpenAlex client.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/lib/config";
import { addDays, dataCutoffFor, lastSunday } from "@/lib/dates";
import * as http from "@/lib/feeds/http";
import { paceRequestOf } from "@/lib/schema";
import { OPENALEX_REQUESTS, OpenAlexRequest, PaceWeek, type OpenAlexRequestKind } from "@/lib/schema/metrics";
import { FIELDS, type FieldId } from "@/lib/vocab";
import {
  BUDGET_RESET, CREDITS, DOI_BATCH_MAX, FILTER_VALUES_MAX, OPENALEX_KEY_SERVICE, OPENALEX_ORIGIN, OpenAlexBudgetError, OpenAlexError,
  PER_PAGE_MAX, SAMPLE_SELECT, SEED_MAX, abstractText, answerPath, askableDois, compareWorkIds, createOpenAlexClient, doiLookupUrl,
  groupByUrl, inputsRecord, lastMorning, lookupDois, mapGroups, mulberry32, openalexFieldNumber, paceFilter, paceQuery, paceWeek,
  parseGroupBy, readCachedAnswer, readOpenAlexKey, requestCredits, reusable, sampleFilter, sampleUrl, sampleWorks, searchExpression,
  searchFilter, seededDraw, weekEnd, weekFetch, weekInputs, weekRequests,
  type DoiCandidate, type GroupByAnswer, type OpenAlexClient, type PaceQuery, type SampleSpec,
} from "@/scripts/lib/openalex";

// The real harness, behind a spy: it answers from the fixture folder, and the spy keeps what it was asked.
vi.mock("@/lib/feeds/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feeds/http")>();
  return { ...actual, fetchFeed: vi.fn(actual.fetchFeed) };
});
const fetchSpy = vi.mocked(http.fetchFeed);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ut-openalex-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// ── The fixture rig ──────────────────────────────────────────────────────────────────────────────

/** The sample query: two journals, two phrases and ten OpenAlex fields (two of them excluded). */
const QUERY: PaceQuery = {
  sources: ["S100", "S200"],
  phrases: ["machine learning", "deep learning"],
  fields: new Map<number, FieldId | null>([
    [26, "mathematics"], [31, "physics"], [16, "chemistry"], [13, "biology"], [27, "biology"], [19, "earth"], [33, "social"], [12, "humanities"],
    [17, null], [22, null],
  ]),
};
const FIELD = (n: number) => `https://openalex.org/fields/${n}`;

/** What the spy's mock of `fetchFeed` was last called with: the URL and the options. */
const calls = () => fetchSpy.mock.calls.map(([url, options]) => ({ url, options }));
const urls = () => fetchSpy.mock.calls.map(([url]) => url);

/** The Taipei morning clock: 09:00 on `date`. */
const morning = (date: string) => () => new Date(`${date}T09:00:00+08:00`);
const TODAY = "2026-11-28";

type Entry = { status?: number; file?: string; content_type?: string; error?: string };

/** A fixture folder (an index of URL to saved answer, read at every request), a cache folder, and a client factory. */
class Rig {
  readonly cache: string;
  readonly fixtures: string;
  private readonly index: Record<string, Entry> = {};
  private count = 0;

  constructor() {
    const dir = fs.mkdtempSync(path.join(root, "rig-"));
    this.cache = path.join(dir, "cache");
    this.fixtures = path.join(dir, "fixtures");
    fs.mkdirSync(this.fixtures);
    this.save();
    process.env.UT_FIXTURE_FEEDS = this.fixtures;
  }

  private save(): void {
    fs.writeFileSync(path.join(this.fixtures, "index.json"), JSON.stringify(this.index));
  }

  /** Serves `body` (an object is printed as JSON, a string as it is) for `url`. */
  serve(url: string, body: unknown, entry: Entry = {}): string {
    const text = typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`;
    const file = `answer-${(this.count += 1)}.json`;
    fs.writeFileSync(path.join(this.fixtures, file), text);
    this.index[url] = { file, content_type: "application/json", ...entry };
    this.save();
    return text;
  }

  refuse(url: string, status: number): void {
    this.index[url] = { status };
    this.save();
  }

  fail(url: string, error: string): void {
    this.index[url] = { error };
    this.save();
  }

  drop(url: string): void {
    delete this.index[url];
    this.save();
  }

  client(over: Partial<Parameters<typeof createOpenAlexClient>[0]> = {}): OpenAlexClient {
    return createOpenAlexClient({ cacheDir: this.cache, query: QUERY, provisionalWeeks: 8, now: morning(TODAY), ...over });
  }

  /** Every file under the cache folder, with its text. */
  cached(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else out.set(path.relative(this.cache, full), fs.readFileSync(full, "utf8"));
      }
    };
    walk(this.cache);
    return out;
  }
}

let rig: Rig;
beforeEach(() => {
  fetchSpy.mockClear();
  rig = new Rig();
});
afterEach(() => {
  delete process.env.UT_FIXTURE_FEEDS;
});

/** A group-by answer: each group's OpenAlex field key to its count, and `meta.count` (the sum unless given). */
function groupBody(groups: Record<string, number>, total?: number): unknown {
  const sum = Object.values(groups).reduce((a, b) => a + b, 0);
  return {
    meta: { count: total ?? sum, db_response_time_ms: 12, page: 1, per_page: 200, groups_count: Object.keys(groups).length },
    results: [],
    group_by: Object.entries(groups).map(([key, count]) => ({ key, key_display_name: `Field ${key}`, count })),
  };
}

type WeekData = Record<OpenAlexRequestKind, Record<string, number>>;

/** Week A: every figure below is worked from these groups by hand (see WEEK_A_FETCH). Field 99 is in no list; 17 is excluded; 13 and 27 are both biology. */
const WEEK_A: WeekData = {
  leading_total: { [FIELD(26)]: 10, [FIELD(31)]: 20, [FIELD(13)]: 30, [FIELD(27)]: 5, [FIELD(17)]: 3, [FIELD(99)]: 2 },
  leading_ai: { [FIELD(26)]: 4, [FIELD(31)]: 5, [FIELD(13)]: 9, [FIELD(27)]: 1, [FIELD(17)]: 1, [FIELD(99)]: 1 },
  all_total: { [FIELD(26)]: 100, [FIELD(31)]: 200, [FIELD(13)]: 300, [FIELD(27)]: 50, [FIELD(12)]: 40, [FIELD(17)]: 30, [FIELD(99)]: 20 },
  all_ai: { [FIELD(26)]: 8, [FIELD(31)]: 12, [FIELD(13)]: 20, [FIELD(27)]: 3, [FIELD(12)]: 2, [FIELD(17)]: 2, [FIELD(99)]: 1 },
};

/** [AI-method papers, all papers] of each field, from WEEK_A: biology adds fields 13 and 27, so 9 + 1 of 30 + 5. */
const WEEK_A_LEADING: Record<FieldId, [number, number]> = {
  mathematics: [4, 10], physics: [5, 20], chemistry: [0, 0], biology: [10, 35], earth: [0, 0], social: [0, 0], humanities: [0, 0],
};
const WEEK_A_ALL: Record<FieldId, [number, number]> = {
  mathematics: [8, 100], physics: [12, 200], chemistry: [0, 0], biology: [23, 350], earth: [0, 0], social: [0, 0], humanities: [2, 40],
};

/** Serves a week's four answers; `totals` gives the works with no topic each answer counts beyond its groups (default 0). */
function serveWeek(r: Rig, monday: string, data: WeekData, query: PaceQuery = QUERY, ungrouped: Partial<Record<OpenAlexRequestKind, number>> = {}): Map<OpenAlexRequestKind, string> {
  const bodies = new Map<OpenAlexRequestKind, string>();
  for (const req of weekRequests(monday, query)) {
    const sum = Object.values(data[req.request]).reduce((a, b) => a + b, 0);
    bodies.set(req.request, r.serve(req.url, groupBody(data[req.request], sum + (ungrouped[req.request] ?? 0))));
  }
  return bodies;
}

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

// ── Request builders (§5.1) ──────────────────────────────────────────────────────────────────────

describe("search expressions and filters", () => {
  it("O1: phrases are quoted and joined with OR; a NOT puts the excluded ones in their own brackets", () => {
    expect(searchExpression(["machine learning"])).toBe('"machine learning"');
    expect(searchExpression(["machine learning", "deep learning", "AlphaFold"])).toBe('"machine learning" OR "deep learning" OR "AlphaFold"');
    expect(searchExpression(["a b"], ["c"])).toBe('("a b") NOT ("c")');
    expect(searchExpression(["a", "b"], ["c", "d"])).toBe('("a" OR "b") NOT ("c" OR "d")');
    expect(searchExpression([], ["c", "d"])).toBe('NOT ("c" OR "d")');
    expect(() => searchExpression([])).toThrow(RangeError);
    expect(() => searchExpression([], [])).toThrow(RangeError);
  });

  it("O2: a phrase is words of letters and digits joined by single spaces or hyphens, in the include list and the exclude list alike", () => {
    for (const ok of ["AlphaFold", "self-driving laboratory", "Bayesian optimization", "GPT4", "神經網路", "naïve bayes", "a"]) {
      expect(() => searchExpression([ok])).not.toThrow();
      expect(() => searchExpression([], [ok])).not.toThrow();
    }
    const bad = ["", " machine", "machine ", "machine  learning", 'say "x"', "a,b", "a|b", "a&b", "a:b", "a\nb", "-a", "a-", "a--b", "a(b)", "a*", "a/b", "a.b", "x_y", "a\tb", "a%20b"];
    for (const phrase of bad) {
      expect(() => searchExpression([phrase]), JSON.stringify(phrase)).toThrow(RangeError);
      expect(() => searchExpression(["ok"], [phrase]), JSON.stringify(phrase)).toThrow(RangeError);
      expect(() => searchExpression([phrase], ["ok"]), JSON.stringify(phrase)).toThrow(RangeError);
    }
  });

  it("O3: the filter's expression is URL-encoded, so it holds no comma, no ampersand, no space and no quote", () => {
    expect(searchFilter('"machine learning" OR "deep learning"')).toBe("title_and_abstract.search:%22machine%20learning%22%20OR%20%22deep%20learning%22");
    expect(searchFilter('("a") NOT ("b")')).toBe("title_and_abstract.search:(%22a%22)%20NOT%20(%22b%22)");
    expect(searchFilter('"神經"')).toBe("title_and_abstract.search:%22%E7%A5%9E%E7%B6%93%22");
    expect(searchFilter(searchExpression(["a-b", "c d"], ["e"]))).not.toMatch(/[ ,&"]/);
  });
});

describe("the weekly filters", () => {
  const BASE = "from_publication_date:2026-09-07,to_publication_date:2026-09-13,type:article,has_abstract:true";
  const SEARCH = "title_and_abstract.search:%22machine%20learning%22%20OR%20%22deep%20learning%22";

  it("O4: the four filters of a week are the spec's, in the spec's order of parts: dates, type, abstract, journals, then the terms", () => {
    expect(paceFilter("all_total", "2026-09-07", QUERY)).toBe(BASE);
    expect(paceFilter("leading_total", "2026-09-07", QUERY)).toBe(`${BASE},primary_location.source.id:S100|S200`);
    expect(paceFilter("all_ai", "2026-09-07", QUERY)).toBe(`${BASE},${SEARCH}`);
    expect(paceFilter("leading_ai", "2026-09-07", QUERY)).toBe(`${BASE},primary_location.source.id:S100|S200,${SEARCH}`);
  });

  it("O5: a week runs Monday to Sunday: the bounds across a month end, a year end and a leap day", () => {
    const endOf = (monday: string) => /to_publication_date:(\d{4}-\d{2}-\d{2})/.exec(paceFilter("all_total", monday, QUERY))![1];
    expect(endOf("2015-01-05")).toBe("2015-01-11");
    expect(endOf("2026-01-26")).toBe("2026-02-01");
    expect(endOf("2025-12-29")).toBe("2026-01-04");
    expect(endOf("2024-02-26")).toBe("2024-03-03");
    expect(endOf("2028-02-28")).toBe("2028-03-05");
    expect(weekEnd("2024-02-26")).toBe("2024-03-03");
    expect(weekEnd("2026-09-07")).toBe("2026-09-13");
  });

  it("O6: a week that does not start on a Monday, a date that is not one, and a kind that is not one are refused", () => {
    for (const day of ["2026-09-06", "2026-09-08", "2026-09-13", "2026-02-30", "2026-13-01", "", "09/07/2026", "2026-9-7"]) {
      expect(() => paceFilter("all_total", day, QUERY), day).toThrow(RangeError);
      expect(() => weekRequests(day, QUERY), day).toThrow(RangeError);
    }
    expect(() => paceFilter("leading" as OpenAlexRequestKind, "2026-09-07", QUERY)).toThrow(RangeError);
    expect(() => paceFilter("all_totals" as OpenAlexRequestKind, "2026-09-07", QUERY)).toThrow(RangeError);
  });

  it("O7: the journals joined by | are 1 to 100: none or 101 is refused for A, and B names no journal at all", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `S${i + 1}`);
    expect(paceFilter("leading_total", "2026-09-07", { ...QUERY, sources: many(100) })).toBe(`${BASE},primary_location.source.id:${many(100).join("|")}`);
    expect(() => paceFilter("leading_total", "2026-09-07", { ...QUERY, sources: many(101) })).toThrow("A filter joins 1 to 100 journals, got 101");
    expect(() => paceFilter("leading_ai", "2026-09-07", { ...QUERY, sources: [] })).toThrow("A filter joins 1 to 100 journals, got 0");
    expect(paceFilter("all_total", "2026-09-07", { ...QUERY, sources: [] })).toBe(BASE);
    expect(paceFilter("all_ai", "2026-09-07", { ...QUERY, sources: many(101) })).toBe(`${BASE},${SEARCH}`);
    expect(FILTER_VALUES_MAX).toBe(100);
  });

  it("O8: the AI kinds need a phrase, and the total kinds do not read the phrases at all", () => {
    expect(() => paceFilter("all_ai", "2026-09-07", { ...QUERY, phrases: [] })).toThrow(new RangeError("A search expression needs a phrase"));
    expect(() => searchExpression([])).toThrow(new RangeError("A search expression needs a phrase"));
    expect(() => searchExpression([], [])).toThrow(new RangeError("A search expression needs a phrase"));
    expect(() => paceFilter("leading_ai", "2026-09-07", { ...QUERY, phrases: ["bad,phrase"] })).toThrow(RangeError);
    expect(paceFilter("all_total", "2026-09-07", { ...QUERY, phrases: [] })).toBe(BASE);
  });

  it("O9: the URL is the works endpoint with the filter and the field group-by, and a week is four of them in the table's order", () => {
    expect(groupByUrl("f")).toBe("https://api.openalex.org/works?filter=f&group_by=primary_topic.field.id");
    expect(OPENALEX_ORIGIN).toBe("https://api.openalex.org");
    expect([...OPENALEX_REQUESTS]).toEqual(["leading_total", "leading_ai", "all_total", "all_ai"]);
    const requests = weekRequests("2026-09-07", QUERY);
    expect(requests.map((r) => r.request)).toEqual(["leading_total", "leading_ai", "all_total", "all_ai"]);
    expect(requests.map((r) => r.week_start)).toEqual(Array(4).fill("2026-09-07"));
    expect(requests[2]!.url).toBe(`https://api.openalex.org/works?filter=${BASE}&group_by=primary_topic.field.id`);
    expect(requests[3]!.url).toBe(`https://api.openalex.org/works?filter=${BASE},${SEARCH}&group_by=primary_topic.field.id`);
    expect(new Set(requests.map((r) => r.url)).size).toBe(4);
    for (const r of requests) {
      expect(r.url).not.toMatch(/api_key|mailto/);
      expect(r.url.split("&")).toHaveLength(2);
    }
  });

  it("O10: the URLs the client builds are the keys the reference schema reads back as the same kind and week", () => {
    for (const monday of ["2015-01-05", "2024-02-26", "2026-09-07"]) {
      for (const r of weekRequests(monday, QUERY)) expect(paceRequestOf(r.url)).toEqual({ request: r.request, week_start: monday });
    }
  });
});

describe("the query from the config", () => {
  const index = (sources: string[], phrases: string[], fields = new Map<number, FieldId | null>([[26, "mathematics"], [17, null]])) =>
    ({ paceJournals: sources.map((s) => ({ openalex_source: s })) as never, pacePhrases: phrases, openalexFields: fields });

  it("O11: it takes the journals and phrases in file order, and a copy of the field map", () => {
    const fields = new Map<number, FieldId | null>([[26, "mathematics"], [17, null]]);
    const phrases = ["machine learning", "AlphaFold"];
    const q = paceQuery(index(["S9", "S1"], phrases, fields));
    expect(q.sources).toEqual(["S9", "S1"]);
    expect(q.phrases).toEqual(["machine learning", "AlphaFold"]);
    expect([...q.fields]).toEqual([[26, "mathematics"], [17, null]]);
    phrases.push("changed later");
    fields.set(99, "physics");
    expect(q.phrases).toHaveLength(2);
    expect(q.fields.has(99)).toBe(false);
  });

  it("O12: no journal, more than 100, no phrase, a source id that is not S and digits, or a phrase that is not safe is refused", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `S${i + 1}`);
    expect(() => paceQuery(index([], ["a"]))).toThrow(new RangeError("No journal has in_pace true: the Pace has nothing to count"));
    expect(paceQuery(index(many(100), ["a"])).sources).toHaveLength(100);
    expect(() => paceQuery(index(many(101), ["a"]))).toThrow(/at most 100/);
    expect(() => paceQuery(index(["S1"], []))).toThrow(new RangeError("No AI phrase has in_pace true: the Pace has nothing to match"));
    for (const bad of ["s100", "S", "S1a", "100", "https://openalex.org/S1", "S1|S2", " S1", "S1\n"]) expect(() => paceQuery(index([bad], ["a"])), bad).toThrow(/source id/);
    expect(() => paceQuery(index(["S1"], ["a", "b|c"]))).toThrow(RangeError);
  });

  it("O13: the seed config makes a query whose four requests every pass the Pace URL check", () => {
    const config = loadConfig();
    const q = paceQuery(config.index);
    expect(q.sources.length).toBeGreaterThan(0);
    expect(q.sources.length).toBeLessThanOrEqual(100);
    for (const s of q.sources) expect(s).toMatch(/^S\d+$/);
    expect(q.phrases).toEqual(config.aiTerms.phrases.filter((p) => p.in_pace).map((p) => p.phrase));
    expect(q.sources).toEqual(config.journals.journals.filter((j) => j.in_pace).map((j) => j.openalex_source));
    expect(q.fields.get(17)).toBeNull();
    expect(q.fields.get(26)).toBe("mathematics");
    for (const r of weekRequests("2026-09-07", q)) expect(paceRequestOf(r.url)?.week_start).toBe("2026-09-07");
    expect(weekRequests("2026-09-07", q)[1]!.url).toContain(`primary_location.source.id:${q.sources.join("|")}`);
  });

  it("O14: a request costs 10 credits when its filter, its search or its group_by holds a search, else 1", () => {
    const [lt, la, at, aa] = weekRequests("2026-09-07", QUERY).map((r) => requestCredits(r.url));
    expect([lt, la, at, aa]).toEqual([1, 10, 1, 10]);
    expect(CREDITS).toEqual({ plain: 1, search: 10 });
    expect(requestCredits(`${OPENALEX_ORIGIN}/works?filter=doi:10.1000%2Fabc|10.1000%2Fdef&per-page=100&select=doi,primary_topic`)).toBe(1);
    expect(requestCredits(`${OPENALEX_ORIGIN}/works?search=machine%20learning&per-page=1`)).toBe(10);
    expect(requestCredits(`${OPENALEX_ORIGIN}/works?filter=type:article&group_by=title_and_abstract.search`)).toBe(10);
    expect(requestCredits(`${OPENALEX_ORIGIN}/works?filter=openalex:W1|W2&per-page=100`)).toBe(1);
    // A week's four requests: 1 + 10 + 1 + 10.
    expect(lt! + la! + at! + aa!).toBe(22);
  });
});

// ── Reading an answer (§5.1) ─────────────────────────────────────────────────────────────────────

describe("parseGroupBy", () => {
  it("O15: it reads the total and each group, with keys as text and extra members ignored", () => {
    const text = JSON.stringify({ meta: { count: 7, other: 1 }, results: [], group_by: [{ key: "https://openalex.org/fields/26", key_display_name: "Math", count: 4 }, { key: 31, count: 3 }] });
    expect(parseGroupBy(text)).toEqual({ total: 7, groups: [{ key: "https://openalex.org/fields/26", count: 4 }, { key: "31", count: 3 }] });
    expect(parseGroupBy('{"group_by": []}')).toEqual({ total: null, groups: [] });
    expect(parseGroupBy('{"meta": {}, "group_by": []}')).toEqual({ total: null, groups: [] });
    expect(parseGroupBy('{"meta": {"count": 0}, "group_by": []}')).toEqual({ total: 0, groups: [] });
    expect(parseGroupBy('{"group_by": [{"key": "a", "count": 0}]}')).toEqual({ total: null, groups: [{ key: "a", count: 0 }] });
  });

  it("O16: an answer that is not JSON, has no group_by list, or has a group without a key or a whole count is an answer error naming the URL", () => {
    const url = "https://api.openalex.org/works?filter=x";
    const bad = [
      "", "not json", "[]", "null", "{}", '{"group_by": "x"}', '{"group_by": {}}', '{"group_by": [{"count": 1}]}', '{"group_by": [{"key": "a"}]}',
      '{"group_by": [{"key": "a", "count": -1}]}', '{"group_by": [{"key": "a", "count": 1.5}]}', '{"group_by": [{"key": "a", "count": "3"}]}',
      '{"meta": {"count": -1}, "group_by": []}', '{"meta": {"count": 1.5}, "group_by": []}', '{"group_by": [{"key": null, "count": 1}]}',
    ];
    for (const text of bad) {
      let error: unknown;
      try {
        parseGroupBy(text, url);
      } catch (e) {
        error = e;
      }
      expect(error, JSON.stringify(text)).toBeInstanceOf(OpenAlexError);
      expect((error as OpenAlexError).kind).toBe("answer");
      expect((error as OpenAlexError).message, JSON.stringify(text)).toBe(["", "not json"].includes(text) ? "OpenAlex's answer is not JSON" : "OpenAlex's answer has no usable group_by list");
      expect((error as OpenAlexError).url).toBe(url);
      expect((error as OpenAlexError).status).toBeNull();
    }
  });
});

describe("the field map", () => {
  it("O17: a field's number is read from the full URL, `fields/N` or the bare number, and from nothing else", () => {
    for (const key of ["https://openalex.org/fields/17", "http://openalex.org/fields/17", "openalex.org/fields/17", "https://OpenAlex.org/fields/17", "fields/17", "17", " 17 ", "https://openalex.org/fields/017"]) {
      expect(openalexFieldNumber(key), key).toBe(17);
    }
    expect(openalexFieldNumber("https://openalex.org/fields/0")).toBe(0);
    for (const key of ["", "unknown", "-1", "17.0", "fields/", "fields/x", "1 7", "https://openalex.org/subfields/1702", "https://openalex.org/domains/3", "https://openalex.org/fields/17/extra", "https://example.org/fields/17", "topics/17", "T17"]) {
      expect(openalexFieldNumber(key), key).toBeNull();
    }
  });

  it("O18: groups map to our fields, several OpenAlex fields of one field add up, and excluded and unmapped works are counted apart", () => {
    const mapped = mapGroups(parseGroupBy(JSON.stringify(groupBody(WEEK_A.all_total))).groups, QUERY.fields);
    expect(mapped.counts).toEqual({ mathematics: 100, physics: 200, chemistry: 0, biology: 350, earth: 0, social: 0, humanities: 40 });
    expect(mapped.excluded_n).toBe(30);
    expect(mapped.unmapped_n).toBe(20);
    expect(Object.keys(mapped.counts)).toEqual([...FIELDS]);
  });

  it("O19: a key that is no field at all (a subfield, `unknown`) is unmapped, a repeated key adds up, and no groups give zeros", () => {
    const groups = [{ key: "unknown", count: 4 }, { key: "https://openalex.org/subfields/1702", count: 3 }, { key: FIELD(26), count: 2 }, { key: "26", count: 5 }, { key: FIELD(22), count: 7 }];
    expect(mapGroups(groups, QUERY.fields)).toEqual({
      counts: { mathematics: 7, physics: 0, chemistry: 0, biology: 0, earth: 0, social: 0, humanities: 0 }, excluded_n: 7, unmapped_n: 7,
    });
    expect(mapGroups([], QUERY.fields)).toEqual({ counts: { mathematics: 0, physics: 0, chemistry: 0, biology: 0, earth: 0, social: 0, humanities: 0 }, excluded_n: 0, unmapped_n: 0 });
    expect(mapGroups(groups, new Map())).toMatchObject({ excluded_n: 0, unmapped_n: 21 });
  });
});

// ── The cache's names and its rule (§5.4) ────────────────────────────────────────────────────────

describe("the answer cache's names and rule", () => {
  it("O20: an answer's file is under its Monday, named by request, fetch date and the first 10 hex of the URL's SHA-256", () => {
    const url = weekRequests("2026-09-07", QUERY)[1]!.url;
    const hash = sha256(url).slice(0, 10);
    expect(answerPath("/c", "leading_ai", "2026-09-07", "2026-11-28", url)).toBe(path.join("/c", "2026-09-07", `leading_ai.2026-11-28.${hash}.json`));
    expect(answerPath("/c", "all_total", "2026-09-07", "2026-11-28", url)).toBe(path.join("/c", "2026-09-07", `all_total.2026-11-28.${hash}.json`));
    expect(answerPath("/c", "leading_ai", "2026-09-07", "2026-11-28", `${url}&x`)).not.toBe(answerPath("/c", "leading_ai", "2026-09-07", "2026-11-28", url));
    expect(() => answerPath("/c", "leading_ai", "2026-09-08", "2026-11-28", url)).toThrow(RangeError);
    expect(() => answerPath("/c", "leading" as OpenAlexRequestKind, "2026-09-07", "2026-11-28", url)).toThrow(RangeError);
    expect(() => answerPath("/c", "leading_ai", "2026-09-07", "2026-02-30", url)).toThrow(RangeError);
  });

  it("O21: a week's last morning is 7 x provisional_weeks + 8 = 64 days after its Sunday, and it is the last morning the week is the newest firm week", () => {
    expect(lastMorning("2026-09-07", 8)).toBe("2026-11-16");
    expect(lastMorning("2026-09-07", 13)).toBe(addDays("2026-09-13", 99));
    expect(lastMorning("2026-09-07", 1)).toBe(addDays("2026-09-13", 15));
    expect(lastMorning("2024-02-26", 8)).toBe("2024-05-06");
    // Worked from the other side with the project's own date rules: on morning D the data cutoff is the newest Sunday on or before
    // D minus 2, the newest firm week ends 56 days before it, and the last D for which that week ends on S is the last morning.
    const newestFirmEnd = (d: string) => addDays(lastSunday(dataCutoffFor(d)), -56);
    for (const monday of ["2026-01-05", "2026-03-30", "2026-09-07", "2027-02-01"]) {
      const sunday = addDays(monday, 6);
      const days = Array.from({ length: 140 }, (_, i) => addDays(sunday, i));
      const last = days.filter((d) => newestFirmEnd(d) === sunday).at(-1);
      expect(lastMorning(monday, 8), monday).toBe(last);
    }
    expect(() => lastMorning("2026-09-08", 8)).toThrow(RangeError);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => lastMorning("2026-09-07", bad), String(bad)).toThrow(RangeError);
  });

  it("O22: an answer is reused when fetched on the run's own Taipei date, or without --refresh on or after its week's last morning", () => {
    const o = { weekStart: "2026-09-07", today: "2026-12-30", provisionalWeeks: 8, refresh: false };
    // Fetched today: always, even with refresh.
    expect(reusable("2026-12-30", o)).toBe(true);
    expect(reusable("2026-12-30", { ...o, refresh: true })).toBe(true);
    // The last morning of 2026-09-07 is 2026-11-16: the day before is too early, the day itself and after are final.
    expect(reusable("2026-11-15", o)).toBe(false);
    expect(reusable("2026-11-16", o)).toBe(true);
    expect(reusable("2026-11-17", o)).toBe(true);
    expect(reusable("2026-12-29", o)).toBe(true);
    // With refresh, any other date is refetched.
    for (const fetched of ["2026-11-15", "2026-11-16", "2026-12-29"]) expect(reusable(fetched, { ...o, refresh: true }), fetched).toBe(false);
    // A provisional week fetched on an earlier morning is refetched, not frozen.
    expect(reusable("2026-11-28", { weekStart: "2026-10-12", today: "2026-11-29", provisionalWeeks: 8, refresh: false })).toBe(false);
    expect(reusable("2026-11-28", { weekStart: "2026-10-12", today: "2026-11-28", provisionalWeeks: 8, refresh: false })).toBe(true);
  });
});

// ── The client: fetching, the cache and the records ──────────────────────────────────────────────

const MONDAY = "2026-09-07";
const urlOf = (monday: string, kind: OpenAlexRequestKind, query: PaceQuery = QUERY): string => weekRequests(monday, query).find((r) => r.request === kind)!.url;
/** A group-by body of one week and kind with the given groups, served at its URL. */
const serveOne = (r: Rig, monday: string, kind: OpenAlexRequestKind, groups: Record<string, number>, query: PaceQuery = QUERY): string => r.serve(urlOf(monday, kind, query), groupBody(groups));
const dropWeek = (r: Rig, monday: string): void => weekRequests(monday, QUERY).forEach((q) => r.drop(q.url));
/** The answers of a week as plain values, so two reads compare without their `cached` flag. */
const plain = (a: GroupByAnswer) => ({ ...a, cached: false });

describe("a fetched answer", () => {
  it("C1: it is read into counts by field and kept for good with its URL, its Taipei fetch time and the SHA-256 of the body as received", async () => {
    const bodies = serveWeek(rig, MONDAY, WEEK_A);
    const client = rig.client();
    const answer = await client.groupBy("leading_total", MONDAY);
    const url = urlOf(MONDAY, "leading_total");
    const text = bodies.get("leading_total")!;
    expect(answer).toEqual({
      request: "leading_total", week_start: MONDAY, url, fetched_at: "2026-11-28T09:00:00+08:00", fetched: "2026-11-28", sha256: sha256(text),
      total: 70, ungrouped_n: 0,
      groups: [{ key: FIELD(26), count: 10 }, { key: FIELD(31), count: 20 }, { key: FIELD(13), count: 30 }, { key: FIELD(27), count: 5 }, { key: FIELD(17), count: 3 }, { key: FIELD(99), count: 2 }],
      counts: { mathematics: 10, physics: 20, chemistry: 0, biology: 35, earth: 0, social: 0, humanities: 0 }, excluded_n: 3, unmapped_n: 2, cached: false,
    });
    const files = rig.cached();
    expect([...files.keys()]).toEqual([path.join(MONDAY, `leading_total.2026-11-28.${sha256(url).slice(0, 10)}.json`)]);
    const file = JSON.parse([...files.values()][0]!);
    expect(Object.keys(file)).toEqual(["schema_version", "url", "fetched_at", "sha256", "body"]);
    expect(file).toEqual({ schema_version: 1, url, fetched_at: "2026-11-28T09:00:00+08:00", sha256: sha256(text), body: text });
    expect(client.stats()).toEqual({ requests: 1, cache_hits: 0, credits: 1 });
  });

  it("C2: the works a total counts and no group does (those with no primary topic) are `ungrouped_n`, and it is null without a total", async () => {
    serveWeek(rig, MONDAY, WEEK_A, QUERY, { leading_total: 4 });
    const client = rig.client();
    const a = await client.groupBy("leading_total", MONDAY);
    expect([a.total, a.ungrouped_n, a.counts.mathematics]).toEqual([74, 4, 10]);
    // No meta.count: no total, so nothing to subtract.
    rig.serve(urlOf(MONDAY, "all_ai"), { group_by: [{ key: FIELD(26), count: 2 }] });
    const b = await client.groupBy("all_ai", MONDAY);
    expect([b.total, b.ungrouped_n, b.counts.mathematics]).toEqual([null, null, 2]);
    // A total below the groups' sum (counts that moved between two reads) leaves nothing ungrouped, never a negative number.
    rig.serve(urlOf(MONDAY, "all_total"), groupBody({ [FIELD(26)]: 5 }, 3));
    expect((await client.groupBy("all_total", MONDAY)).ungrouped_n).toBe(0);
  });

  it("C3: a rerun on the same Taipei date reads every answer from the cache: no request, no credit, and not one byte of the cache changes", async () => {
    serveWeek(rig, MONDAY, WEEK_A);
    const first = await rig.client().fetchWeek(MONDAY);
    const before = rig.cached();
    expect(before.size).toBe(4);
    dropWeek(rig, MONDAY);
    fetchSpy.mockClear();
    const second = rig.client();
    const again = await second.fetchWeek(MONDAY);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(second.stats()).toEqual({ requests: 0, cache_hits: 4, credits: 0 });
    expect(rig.cached()).toEqual(before);
    for (const kind of OPENALEX_REQUESTS) {
      expect(again.answers[kind].cached).toBe(true);
      expect(first.answers[kind].cached).toBe(false);
      expect(plain(again.answers[kind])).toEqual(plain(first.answers[kind]));
    }
    expect({ ...again, answers: null }).toEqual({ ...first, answers: null });
    // Nothing but finished files: the write goes through a temporary name that is renamed away.
    expect([...before.keys()].every((name) => name.endsWith(".json"))).toBe(true);
  });

  it("C4: a provisional week fetched on an earlier morning is fetched again, every fetch is kept, and the newest one is read", async () => {
    const week = "2026-10-12";
    const at = (date: string) => rig.client({ now: morning(date) });
    serveOne(rig, week, "leading_total", { [FIELD(26)]: 10 });
    expect((await at("2026-11-28").groupBy("leading_total", week)).counts.mathematics).toBe(10);
    serveOne(rig, week, "leading_total", { [FIELD(26)]: 11 });
    expect((await at("2026-11-29").groupBy("leading_total", week)).counts.mathematics).toBe(11);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The same morning again: the 29th's answer, no request.
    expect((await at("2026-11-29").groupBy("leading_total", week)).cached).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // 2026-12-21 is this week's last morning (Sunday 2026-10-18 + 64): it still refetches, since the 29th's answer came before it.
    serveOne(rig, week, "leading_total", { [FIELD(26)]: 12 });
    expect((await at("2026-12-21").groupBy("leading_total", week)).counts.mathematics).toBe(12);
    // Afterwards the answer of the last morning is final: read on any later date, never fetched again, and it beats the older two.
    rig.drop(urlOf(week, "leading_total"));
    const later = await at("2027-01-05").groupBy("leading_total", week);
    expect([later.counts.mathematics, later.cached, later.fetched]).toEqual([12, true, "2026-12-21"]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect([...rig.cached().keys()].map((name) => name.split(".")[1])).toEqual(["2026-11-28", "2026-11-29", "2026-12-21"]);
  });

  it("C5: a firm week fetched on or after its last morning is reused on a later date, and --refresh fetches it again but never an answer of the run's own date", async () => {
    const week = "2020-03-02";
    serveWeek(rig, week, WEEK_A);
    await rig.client({ now: morning("2026-11-28") }).fetchWeek(week);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    // The backfill's second day: nothing to fetch.
    const next = rig.client({ now: morning("2026-11-29") });
    await next.fetchWeek(week);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(next.stats().cache_hits).toBe(4);
    // With --refresh on that later date every answer of an earlier date is fetched again ...
    const refreshing = rig.client({ now: morning("2026-11-29"), refresh: true });
    await refreshing.fetchWeek(week);
    expect(fetchSpy).toHaveBeenCalledTimes(8);
    expect(refreshing.stats()).toMatchObject({ requests: 4, cache_hits: 0 });
    // ... and on that date a second pass reuses what the first fetched, refresh or not.
    const again = rig.client({ now: morning("2026-11-29"), refresh: true });
    await again.fetchWeek(week);
    expect(fetchSpy).toHaveBeenCalledTimes(8);
    expect(again.stats()).toMatchObject({ requests: 0, cache_hits: 4 });
  });

  it("C6: an answer fetched the day before its last morning is not frozen: it is fetched again, and one fetched on the last morning is final", async () => {
    // Week 2026-09-07: last morning 2026-11-16.
    serveOne(rig, MONDAY, "all_total", { [FIELD(26)]: 1 });
    await rig.client({ now: morning("2026-11-15") }).groupBy("all_total", MONDAY);
    serveOne(rig, MONDAY, "all_total", { [FIELD(26)]: 2 });
    const refetched = await rig.client({ now: morning("2026-11-28") }).groupBy("all_total", MONDAY);
    expect([refetched.counts.mathematics, refetched.cached]).toEqual([2, false]);
    const other = fs.mkdtempSync(path.join(root, "other-"));
    serveOne(rig, MONDAY, "all_total", { [FIELD(26)]: 3 });
    await rig.client({ cacheDir: other, now: morning("2026-11-16") }).groupBy("all_total", MONDAY);
    serveOne(rig, MONDAY, "all_total", { [FIELD(26)]: 4 });
    const kept = await rig.client({ cacheDir: other, now: morning("2026-11-28") }).groupBy("all_total", MONDAY);
    expect([kept.counts.mathematics, kept.cached]).toEqual([3, true]);
  });

  it("C7: an answer is reused for its own URL only: another journal list is another file, and a URL that names no journal is the same one", async () => {
    const other: PaceQuery = { ...QUERY, sources: ["S100", "S300"] };
    serveWeek(rig, MONDAY, WEEK_A);
    serveWeek(rig, MONDAY, WEEK_A, other);
    await rig.client().fetchWeek(MONDAY);
    fetchSpy.mockClear();
    const client = rig.client({ query: other });
    await client.fetchWeek(MONDAY);
    // B's two requests name no journal, so they are the same URLs and come from the cache; A's two are new.
    expect(urls()).toEqual([urlOf(MONDAY, "leading_ai", other), urlOf(MONDAY, "leading_total", other)]);
    expect(client.stats()).toMatchObject({ requests: 2, cache_hits: 2 });
    expect(rig.cached().size).toBe(6);
  });

  it("C8: a damaged cache file is as good as none: the answer is fetched again and the file is made whole", async () => {
    const url = urlOf(MONDAY, "leading_total");
    const file = path.join(rig.cache, answerPath(rig.cache, "leading_total", MONDAY, TODAY, url).slice(rig.cache.length + 1));
    const good = serveOne(rig, MONDAY, "leading_total", { [FIELD(26)]: 10 });
    await rig.client().groupBy("leading_total", MONDAY);
    const whole = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(whole) as Record<string, unknown>;
    const damage: [string, string][] = [
      ["empty", ""], ["not JSON", "{"], ["a list", "[]"],
      ["an extra member", JSON.stringify({ ...parsed, extra: 1 })],
      ["a wrong version", JSON.stringify({ ...parsed, schema_version: 2 })],
      ["another URL", JSON.stringify({ ...parsed, url: `${url}&x=1` })],
      ["a body changed since", JSON.stringify({ ...parsed, body: `${good} ` })],
      ["a hash that is not one", JSON.stringify({ ...parsed, sha256: "abc" })],
      ["a fetch time on another Taipei date than the name", JSON.stringify({ ...parsed, fetched_at: "2026-11-27T09:00:00+08:00" })],
      ["a fetch time that is no timestamp", JSON.stringify({ ...parsed, fetched_at: "yesterday" })],
      ["a body that is no group-by answer, with its own hash", JSON.stringify({ ...parsed, body: "{}", sha256: sha256("{}") })],
      ["a URL that holds a key", JSON.stringify({ ...parsed, url: `${url}&api_key=zzz` })],
    ];
    for (const [what, text] of damage) {
      fs.writeFileSync(file, text);
      fetchSpy.mockClear();
      const answer = await rig.client().groupBy("leading_total", MONDAY);
      expect(fetchSpy, what).toHaveBeenCalledTimes(1);
      expect(answer.cached, what).toBe(false);
      expect(fs.readFileSync(file, "utf8"), what).toBe(whole);
    }
  });

  it("C9: a file whose name is not an answer's, or whose request, URL hash or date part is another, is left alone and never read", async () => {
    const url = urlOf(MONDAY, "leading_total");
    const hash = sha256(url).slice(0, 10);
    const dir = path.join(rig.cache, MONDAY);
    fs.mkdirSync(dir, { recursive: true });
    // Each stray holds a whole, valid answer for this very URL (with another count), so only its name keeps it from being read.
    const body = JSON.stringify(groupBody({ [FIELD(26)]: 77 }));
    const whole = JSON.stringify({ schema_version: 1, url, fetched_at: "2026-11-28T09:00:00+08:00", sha256: sha256(body), body });
    const stray = {
      "notes.txt": whole, [`leading_total.2026-11-28.${hash}.json.tmp-1`]: whole, [`leading_total.2026-11-28.${hash.toUpperCase()}.json`]: whole,
      [`leading_total.2026-11-28.${"0".repeat(10)}.json`]: whole, [`leading_ai.2026-11-28.${hash}.json`]: whole, [`leading_total.28-11-2026.${hash}.json`]: whole,
      [`all_total.2026-11-28.${hash}.json`]: whole,
    };
    for (const [name, text] of Object.entries(stray)) fs.writeFileSync(path.join(dir, name), text);
    serveOne(rig, MONDAY, "leading_total", { [FIELD(26)]: 10 });
    const answer = await rig.client().groupBy("leading_total", MONDAY);
    expect(answer.cached).toBe(false);
    expect(answer.counts.mathematics).toBe(10);
    for (const [name, text] of Object.entries(stray)) expect(fs.readFileSync(path.join(dir, name), "utf8")).toBe(text);
    expect(fs.readdirSync(dir)).toHaveLength(Object.keys(stray).length + 1);
  });

  it("C10: readCachedAnswer gives the newest answer, or the one whose body has the SHA-256 a manifest names, and null when there is none", async () => {
    const week = "2026-10-12";
    const first = serveOne(rig, week, "all_total", { [FIELD(26)]: 10 });
    await rig.client({ now: morning("2026-11-28") }).groupBy("all_total", week);
    const second = serveOne(rig, week, "all_total", { [FIELD(26)]: 11 });
    await rig.client({ now: morning("2026-11-29") }).groupBy("all_total", week);
    const ref = { request: "all_total" as const, week_start: week, url: urlOf(week, "all_total") };
    expect(readCachedAnswer(rig.cache, QUERY.fields, ref)).toMatchObject({ cached: true, fetched: "2026-11-29", sha256: sha256(second), counts: { mathematics: 11 } });
    expect(readCachedAnswer(rig.cache, QUERY.fields, { ...ref, sha256: sha256(first) })).toMatchObject({ cached: true, fetched: "2026-11-28", counts: { mathematics: 10 } });
    expect(readCachedAnswer(rig.cache, QUERY.fields, { ...ref, sha256: sha256("other") })).toBeNull();
    expect(readCachedAnswer(rig.cache, QUERY.fields, { ...ref, request: "all_ai", url: urlOf(week, "all_ai") })).toBeNull();
    expect(readCachedAnswer(path.join(root, "missing"), QUERY.fields, ref)).toBeNull();
    expect(readCachedAnswer(rig.cache, QUERY.fields, { ...ref, week_start: "2026-10-19" })).toBeNull();
  });

  it("C10b: a manifest's week is a calendar date and never a path: a week that climbs out of the cache folder reads nothing, though a matching file is there", async () => {
    const week = "2026-10-12";
    serveOne(rig, week, "all_total", { [FIELD(26)]: 10 });
    await rig.client().groupBy("all_total", week);
    const url = urlOf(week, "all_total");
    // Copy the answer's file to a folder beside the cache, where "../planted" reaches it.
    const planted = path.join(path.dirname(rig.cache), "planted");
    fs.mkdirSync(planted);
    const name = fs.readdirSync(path.join(rig.cache, week))[0]!;
    fs.copyFileSync(path.join(rig.cache, week, name), path.join(planted, name));
    const ref = { request: "all_total" as const, week_start: "../planted", url };
    expect(readCachedAnswer(rig.cache, QUERY.fields, ref)).toBeNull();
    // The same file under its own week is read, so the refusal is the path's.
    expect(readCachedAnswer(rig.cache, QUERY.fields, { ...ref, week_start: week })).not.toBeNull();
    for (const bad of ["", "2026-02-30", "2026-10-1", ".", "..", "2026-10-12/..", "/2026-10-12"]) expect(readCachedAnswer(rig.cache, QUERY.fields, { ...ref, week_start: bad }), bad).toBeNull();
  });

  it("C10c: a write that fails leaves no temporary file and no half-written answer, and the error reaches the caller", async () => {
    const url = urlOf(MONDAY, "all_total");
    serveOne(rig, MONDAY, "all_total", { [FIELD(26)]: 10 });
    // A directory sits where the answer's file would go, so the rename onto it fails after the temporary file was written.
    const target = answerPath(rig.cache, "all_total", MONDAY, TODAY, url);
    fs.mkdirSync(target, { recursive: true });
    await expect(rig.client().groupBy("all_total", MONDAY)).rejects.toThrow();
    expect(fs.readdirSync(path.dirname(target))).toEqual([path.basename(target)]);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it("C10d: a write that fails before it makes any file reports its own error, not the cleanup's, and leaves the cache as it was", async () => {
    const url = urlOf(MONDAY, "all_total");
    serveOne(rig, MONDAY, "all_total", { [FIELD(26)]: 10 });
    const write = fs.writeFileSync;
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, data: unknown, options?: unknown) => {
      if (String(file).includes(".tmp-")) throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      return (write as (...a: unknown[]) => void)(file, data, options);
    }) as typeof fs.writeFileSync);
    try {
      await expect(rig.client().groupBy("all_total", MONDAY)).rejects.toMatchObject({ message: "no space left on device", code: "ENOSPC" });
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(answerPath(rig.cache, "all_total", MONDAY, TODAY, url))).toBe(false);
    expect(fs.readdirSync(path.join(rig.cache, MONDAY))).toEqual([]);
  });

  it("C11: a file that holds a URL with a key is never read, though its name and its URL agree", () => {
    const keyed = `${urlOf(MONDAY, "all_total")}&api_key=zzz`;
    const body = JSON.stringify(groupBody({ [FIELD(26)]: 1 }));
    const entry = { schema_version: 1, url: keyed, fetched_at: "2026-11-28T09:00:00+08:00", sha256: sha256(body), body };
    const file = answerPath(rig.cache, "all_total", MONDAY, TODAY, keyed);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entry));
    const ref = { request: "all_total" as const, week_start: MONDAY, url: keyed };
    expect(readCachedAnswer(rig.cache, QUERY.fields, ref)).toBeNull();
    // The same file with the key taken out of its URL is found, so the refusal is the key's.
    const clean = urlOf(MONDAY, "all_total");
    const cleanFile = answerPath(rig.cache, "all_total", MONDAY, TODAY, clean);
    fs.writeFileSync(cleanFile, JSON.stringify({ ...entry, url: clean }));
    expect(readCachedAnswer(rig.cache, QUERY.fields, { ...ref, url: clean })).not.toBeNull();
  });
});

describe("a week", () => {
  it("C12: the AI-method request is fetched before its total, A before B, and each field's pair is [AI-method papers, all papers]", async () => {
    serveWeek(rig, MONDAY, WEEK_A);
    const client = rig.client();
    const w = await client.fetchWeek(MONDAY);
    expect(urls()).toEqual(["leading_ai", "leading_total", "all_ai", "all_total"].map((k) => urlOf(MONDAY, k as OpenAlexRequestKind)));
    expect(Object.keys(w.answers)).toEqual([...OPENALEX_REQUESTS]);
    expect(w.week_start).toBe(MONDAY);
    expect(w.fetched).toBe(TODAY);
    expect(w.leading).toEqual(WEEK_A_LEADING);
    expect(w.all).toEqual(WEEK_A_ALL);
    expect(Object.keys(w.leading)).toEqual([...FIELDS]);
    expect(client.stats()).toEqual({ requests: 4, cache_hits: 0, credits: 22 });
  });

  it("C13: a field whose AI-method count is above its total is an answer error naming the field, the week and both numbers, for A and for B", async () => {
    for (const [side, field, key] of [["leading", "mathematics", 26], ["all", "physics", 31]] as const) {
      const data: WeekData = structuredClone(WEEK_A);
      data[`${side}_ai`][FIELD(key)] = data[`${side}_total`][FIELD(key)]! + 1;
      const r = new Rig();
      serveWeek(r, MONDAY, data);
      const error = await r.client().fetchWeek(MONDAY).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OpenAlexError);
      expect((error as OpenAlexError).kind).toBe("answer");
      expect((error as OpenAlexError).message).toContain(`AI-method count of ${field} in the week of ${MONDAY} (${data[`${side}_total`][FIELD(key)]! + 1}) is above its total (${data[`${side}_total`][FIELD(key)]})`);
    }
  });

  it("C14: weekFetch takes four answers: an AI count equal to its total is fine, and its fetch date is the earliest of the four", async () => {
    const week = "2026-10-12";
    const data: WeekData = structuredClone(WEEK_A);
    data.leading_ai[FIELD(26)] = data.leading_total[FIELD(26)]!;
    serveWeek(rig, week, data);
    const got = {} as Record<OpenAlexRequestKind, GroupByAnswer>;
    for (const [kind, date] of [["leading_total", "2026-11-20"], ["leading_ai", "2026-11-28"], ["all_total", "2026-11-25"], ["all_ai", "2026-11-28"]] as const) {
      got[kind] = await rig.client({ now: morning(date) }).groupBy(kind, week);
    }
    const w = weekFetch(got);
    expect(w.fetched).toBe("2026-11-20");
    expect(w.leading.mathematics).toEqual([10, 10]);
    // An AI count above the total, in the right slots, is an answer error ...
    const inflated = { ...got.leading_ai, counts: { ...got.leading_ai.counts, mathematics: got.leading_total.counts.mathematics + 1 } };
    expect(() => weekFetch({ ...got, leading_ai: inflated })).toThrow(OpenAlexError);
  });

  it("C14b: four answers that are not one week's four requests are refused, whichever slot is wrong", async () => {
    const other = "2026-10-19";
    serveWeek(rig, "2026-10-12", WEEK_A);
    serveWeek(rig, other, WEEK_A);
    const mine = await rig.client().fetchWeek("2026-10-12");
    const theirs = await rig.client().fetchWeek(other);
    expect(() => weekFetch(mine.answers)).not.toThrow();
    for (const slot of OPENALEX_REQUESTS) {
      // Another week's answer in one slot.
      expect(() => weekFetch({ ...mine.answers, [slot]: theirs.answers[slot] }), slot).toThrow(RangeError);
      // Another request's answer in one slot.
      const wrong = OPENALEX_REQUESTS.find((k) => k !== slot)!;
      expect(() => weekFetch({ ...mine.answers, [slot]: mine.answers[wrong] }), slot).toThrow(RangeError);
    }
    expect(() => weekFetch({ ...mine.answers, leading_ai: mine.answers.leading_total, leading_total: mine.answers.leading_ai })).toThrow("The leading_total slot holds the leading_ai answer of the week of 2026-10-12; a week is four answers of the week of 2026-10-12");
    expect(() => weekFetch({ ...mine.answers, all_ai: theirs.answers.all_ai })).toThrow("The all_ai slot holds the all_ai answer of the week of 2026-10-19; a week is four answers of the week of 2026-10-12");
  });

  it("C15: the weekly state's record and the manifest's records are the four answers' own, in the spec's order, with the URL as recorded", async () => {
    const bodies = serveWeek(rig, MONDAY, WEEK_A);
    const w = await rig.client().fetchWeek(MONDAY);
    expect(paceWeek(w, true)).toEqual({ week_start: MONDAY, fetched: TODAY, provisional: true, leading: WEEK_A_LEADING, all: WEEK_A_ALL });
    expect(paceWeek(w, false).provisional).toBe(false);
    expect(PaceWeek.parse(paceWeek(w, false))).toEqual(paceWeek(w, false));
    const inputs = weekInputs(w);
    expect(inputs.map((r) => r.request)).toEqual([...OPENALEX_REQUESTS]);
    expect(inputs[1]).toEqual({
      request: "leading_ai", week_start: MONDAY, url: urlOf(MONDAY, "leading_ai"), fetched_at: "2026-11-28T09:00:00+08:00", sha256: sha256(bodies.get("leading_ai")!),
      counts: { mathematics: 4, physics: 5, chemistry: 0, biology: 10, earth: 0, social: 0, humanities: 0 }, excluded_n: 1, unmapped_n: 1,
    });
    expect(Object.keys(inputs[1]!)).toEqual(["request", "week_start", "url", "fetched_at", "sha256", "counts", "excluded_n", "unmapped_n"]);
    for (const r of inputs) expect(OpenAlexRequest.parse(r)).toEqual(r);
    expect(inputsRecord(w.answers.all_ai)).toEqual(inputs[3]);
    expect(inputs.map((r) => [r.excluded_n, r.unmapped_n])).toEqual([[3, 2], [1, 1], [30, 20], [2, 1]]);
  });

  it("C16: only a Monday is a week", async () => {
    await expect(rig.client().fetchWeek("2026-09-08")).rejects.toThrow(RangeError);
    await expect(rig.client().groupBy("all_total", "2026-09-08")).rejects.toThrow(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the client's options", () => {
  it("C17: today is the Taipei date of the clock unless given, and a provisional_weeks that is not a positive whole number is refused", () => {
    expect(rig.client({ now: () => new Date("2026-11-28T17:00:00Z") }).today).toBe("2026-11-29");
    expect(rig.client({ now: () => new Date("2026-11-28T15:59:59Z") }).today).toBe("2026-11-28");
    expect(rig.client({ today: "2026-10-01" }).today).toBe("2026-10-01");
    expect(rig.client().query).toBe(QUERY);
    expect(() => rig.client({ today: "2026-02-30" })).toThrow(RangeError);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => rig.client({ provisionalWeeks: bad }), String(bad)).toThrow(RangeError);
    expect(() => rig.client({ provisionalWeeks: 1 })).not.toThrow();
  });

  it("C18: stats() hands out a copy", async () => {
    serveWeek(rig, MONDAY, WEEK_A);
    const client = rig.client();
    await client.groupBy("all_total", MONDAY);
    const stats = client.stats();
    stats.requests = 99;
    stats.credits = 99;
    expect(client.stats()).toEqual({ requests: 1, cache_hits: 0, credits: 1 });
  });

  it("C19: a request goes to api.openalex.org only, and a URL that holds a key is refused before anything is sent", async () => {
    const client = rig.client();
    for (const url of ["https://example.org/works", "http://api.openalex.org/works?x=1", "https://api.openalex.org.example.org/works", "https://api.openalex.org", "/works"]) {
      await expect(client.request(url), url).rejects.toThrow(new RangeError("The client asks api.openalex.org only"));
    }
    for (const url of ["https://api.openalex.org/works?api_key=x", "https://api.openalex.org/works?filter=a&api_key=x", "https://api.openalex.org/works?filter=a&API_KEY=x"]) {
      await expect(client.request(url), url).rejects.toThrow(new RangeError("A request URL is built without its key; the client adds it"));
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("C20: each request carries the JSON accept header, the default timeout and the default body cap, and the deadline when there is one", async () => {
    const url = urlOf(MONDAY, "all_total");
    rig.serve(url, groupBody({}));
    await rig.client().request(url);
    await rig.client({ deadline: 1_900_000_000_000 }).request(url);
    const base = { accept: "application/json", timeoutMs: 15_000, maxBytes: 5 * 1024 * 1024, refuseRedirect: expect.any(Function) };
    expect(calls()).toEqual([
      { url, options: base },
      { url, options: { ...base, deadline: 1_900_000_000_000 } },
    ]);
    expect(http.FEED_TIMEOUTS.default).toBe(15_000);
    expect(http.FEED_MAX_BYTES.default).toBe(5 * 1024 * 1024);
  });

  it("C20a: a redirect is followed only within api.openalex.org, so a key never goes to another host; every request URL joins the host's one-a-second queue", async () => {
    const url = urlOf(MONDAY, "all_total");
    rig.serve(url, groupBody({}));
    await rig.client().request(url);
    const refuse = calls()[0]!.options!.refuseRedirect!;
    expect(refuse("https://api.openalex.org/works?filter=a&api_key=sample-key-123")).toBeNull();
    expect(refuse("https://api.openalex.org/")).toBeNull();
    for (const target of [
      "https://example.org/works?filter=a&api_key=sample-key-123", "https://api.openalex.org.example.org/works", "https://api.openalex.org:8443/works",
      "http://api.openalex.org/works", "https://api.openalex.org", "https://openalex.org/works", "https://user@api.openalex.org.evil.example/works", "",
    ]) {
      expect(refuse(target), target).toBe("the client follows redirects within api.openalex.org only");
    }
    // The harness paces by host: every URL the client builds is one it holds in the OpenAlex queue.
    const query = QUERY;
    const made = [
      ...weekRequests(MONDAY, query).map((r) => r.url), doiLookupUrl(["10.1000/abc"]), doiLookupUrl(["10.1000/abc"], "resolver"),
      sampleUrl(sampleFilter(query, { from: "2026-06-29", to: "2026-09-27", scope: "all", n: 5, seed: 7 }), 5, 7),
    ];
    for (const u of made) expect(http.rateQueueOf(u), u).toBe("openalex");
    expect(http.rateQueueOf("https://example.org/works")).toBeNull();
  });

  it("C20b: a result counts as an answer only when it is ok and has a body, whichever of the two the harness gets wrong", async () => {
    const url = urlOf(MONDAY, "all_total");
    const result = (over: Partial<http.FetchResult>): http.FetchResult =>
      ({ ok: true, status: 200, finalUrl: url, body: Buffer.from("{}"), contentType: "application/json", error: null, detail: null, durationMs: 1, attempts: 1, ...over });
    const client = rig.client();
    // With no `what` a request is called "a request"; with no error class at all the class is "network".
    fetchSpy.mockResolvedValueOnce(result({ body: null }));
    await expect(client.request(url)).rejects.toMatchObject({ kind: "network", message: "OpenAlex gave no usable answer to a request (network)" });
    fetchSpy.mockResolvedValueOnce(result({ ok: false, status: 500, error: "http_500" }));
    await expect(client.request(url)).rejects.toMatchObject({ kind: "http", status: 500, message: "OpenAlex answered HTTP 500 to a request" });
    fetchSpy.mockResolvedValueOnce(result({ ok: false, status: 0, error: "dns" }));
    await expect(client.request(url, "the test")).rejects.toMatchObject({ kind: "network", message: "OpenAlex gave no usable answer to the test (dns)" });
    fetchSpy.mockResolvedValueOnce(result({}));
    await expect(client.request(url)).resolves.toMatchObject({ text: "{}" });
    expect(client.stats().requests).toBe(1);
  });

  it("C21: request() gives the body text and the Taipei time it arrived, and tallies the credits of what OpenAlex answered", async () => {
    const lai = urlOf(MONDAY, "leading_ai");
    const text = rig.serve(lai, groupBody({ [FIELD(26)]: 1 }));
    const client = rig.client({ now: () => new Date("2026-11-28T16:30:05Z") });
    expect(await client.request(lai)).toEqual({ text, fetched_at: "2026-11-29T00:30:05+08:00" });
    expect(client.stats()).toEqual({ requests: 1, cache_hits: 0, credits: 10 });
    // A failed request costs nothing in the tally.
    rig.refuse(urlOf(MONDAY, "all_total"), 500);
    await expect(client.request(urlOf(MONDAY, "all_total"))).rejects.toBeInstanceOf(OpenAlexError);
    expect(client.stats()).toEqual({ requests: 1, cache_hits: 0, credits: 10 });
  });
});

describe("the key", () => {
  const KEY = "sample-key-123";

  it("C22: the key is added to the request on the wire, and to nothing that is recorded", async () => {
    const bodies = serveWeek(rig, MONDAY, WEEK_A);
    // Only the keyed URLs are served: a request without the key would find nothing.
    for (const r of weekRequests(MONDAY, QUERY)) {
      rig.drop(r.url);
      rig.serve(`${r.url}&api_key=${KEY}`, groupBody(WEEK_A[r.request]));
    }
    const client = rig.client({ apiKey: KEY });
    const w = await client.fetchWeek(MONDAY);
    expect(urls()).toEqual(["leading_ai", "leading_total", "all_ai", "all_total"].map((k) => `${urlOf(MONDAY, k as OpenAlexRequestKind)}&api_key=${KEY}`));
    expect(w.answers.leading_total.url).toBe(urlOf(MONDAY, "leading_total"));
    const everything = [...rig.cached().values()].join("\n") + JSON.stringify(w) + JSON.stringify(weekInputs(w)) + JSON.stringify(client.stats());
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("api_key");
    expect(bodies.size).toBe(4);
  });

  it("C23: a key with characters a URL reads as its own syntax is percent-encoded on the wire", async () => {
    const url = urlOf(MONDAY, "all_total");
    const key = "a b&c=d/é+";
    rig.serve(`${url}&api_key=a%20b%26c%3Dd%2F%C3%A9%2B`, groupBody({}));
    await rig.client({ apiKey: key }).request(url);
    expect(urls()).toEqual([`${url}&api_key=a%20b%26c%3Dd%2F%C3%A9%2B`]);
  });

  it("C24: no key, an empty key and a null key all send the URL as it is", async () => {
    const url = urlOf(MONDAY, "all_total");
    rig.serve(url, groupBody({}));
    await rig.client().request(url);
    await rig.client({ apiKey: null }).request(url);
    await rig.client({ apiKey: "" }).request(url);
    expect(urls()).toEqual([url, url, url]);
  });

  it("C25: no failure says the key: not the message, the recorded URL, the name or the stack, whatever the status", async () => {
    const url = urlOf(MONDAY, "all_total");
    const keyed = `${url}&api_key=${KEY}`;
    const failures: (() => void)[] = [
      () => rig.refuse(keyed, 429), () => rig.refuse(keyed, 402), () => rig.refuse(keyed, 500), () => rig.refuse(keyed, 404),
      () => rig.fail(keyed, "dns"), () => rig.fail(keyed, "timeout"), () => rig.fail(keyed, "tls"), () => rig.serve(keyed, "not json"),
      () => rig.serve(keyed, "x".repeat(5 * 1024 * 1024 + 1)),
    ];
    for (const set of failures) {
      set();
      const error = await rig.client({ apiKey: KEY }).groupBy("all_total", MONDAY).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OpenAlexError);
      const e = error as OpenAlexError;
      expect(e.url).toBe(url);
      expect(`${e.message}\n${e.url}\n${e.name}\n${e.stack ?? ""}\n${JSON.stringify(e)}`).not.toContain(KEY);
    }
    expect(rig.cached().size).toBe(0);
  });

  it("C26: the key comes from the keychain item `unveiling-openalex-key`, trimmed, and is null when there is none", () => {
    expect(OPENALEX_KEY_SERVICE).toBe("unveiling-openalex-key");
    const bin = path.join(root, "security-fake");
    const script = (body: string) => fs.writeFileSync(bin, `#!${process.execPath}\nconst a = process.argv.slice(2);\nif (a[0] !== "find-generic-password" || a[1] !== "-s" || a[3] !== "-w") process.exit(64);\n${body}\n`, { mode: 0o755 });
    script(`if (a[2] === "unveiling-openalex-key") process.stdout.write("  the-key\\n"); else process.exit(44);`);
    expect(readOpenAlexKey({ bin })).toBe("the-key");
    script(`process.stderr.write("SECRET"); process.exit(44);`);
    expect(readOpenAlexKey({ bin })).toBeNull();
    script(`process.stdout.write("\\n");`);
    expect(readOpenAlexKey({ bin })).toBeNull();
    expect(readOpenAlexKey({ bin: path.join(root, "missing") })).toBeNull();
  });
});

describe("failures and the budget", () => {
  const url = () => urlOf(MONDAY, "all_total");

  it("C27: 429 and 402 are a spent budget: an OpenAlexBudgetError that says when the budget resets, and no retry loop is left to the caller", async () => {
    expect(BUDGET_RESET).toBe("resets at 00:00 UTC (08:00 Taipei)");
    for (const status of [429, 402]) {
      rig.refuse(url(), status);
      const error = await rig.client().groupBy("all_total", MONDAY).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OpenAlexBudgetError);
      expect(error).toBeInstanceOf(OpenAlexError);
      const e = error as OpenAlexBudgetError;
      expect([e.kind, e.status, e.url, e.name]).toEqual(["budget", status, url(), "OpenAlexBudgetError"]);
      expect(e.message).toContain(`HTTP ${status}`);
      expect(e.message).toContain("resets at 00:00 UTC (08:00 Taipei)");
      // The harness keeps no header and no body, so the daily budget and a new key's throttle look the same: the message names both.
      expect(e.message).toContain("a new key's first $1 is released $0.10 every 5 minutes");
      expect(e.message).toContain("the answers already cached are reused");
    }
  });

  it("C28: any other status is an http error with its status, and never the budget", async () => {
    for (const status of [400, 401, 403, 404, 500, 503]) {
      rig.refuse(url(), status);
      const error = await rig.client().groupBy("all_total", MONDAY).catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(OpenAlexError);
      expect(error, String(status)).not.toBeInstanceOf(OpenAlexBudgetError);
      expect([(error as OpenAlexError).kind, (error as OpenAlexError).status, (error as OpenAlexError).name]).toEqual(["http", status, "OpenAlexError"]);
      expect((error as OpenAlexError).url).toBe(url());
      expect((error as OpenAlexError).message).toBe(`OpenAlex answered HTTP ${status} to all_total for the week of ${MONDAY}`);
    }
  });

  it("C29: no answer at all is a network error with the class and no status, and a body over the cap is an answer error", async () => {
    for (const cls of ["dns", "timeout", "tls", "network", "redirects"]) {
      rig.fail(url(), cls);
      const error = (await rig.client().groupBy("all_total", MONDAY).catch((e: unknown) => e)) as OpenAlexError;
      expect([error.kind, error.status]).toEqual(["network", null]);
      expect(error.message).toBe(`OpenAlex gave no usable answer to all_total for the week of ${MONDAY} (${cls})`);
    }
    rig.serve(url(), "x".repeat(5 * 1024 * 1024 + 1));
    const big = (await rig.client().groupBy("all_total", MONDAY).catch((e: unknown) => e)) as OpenAlexError;
    expect([big.kind, big.status]).toEqual(["answer", null]);
    expect(big.message).toContain(`${5 * 1024 * 1024} byte cap`);
  });

  it("C30: an answer that is not a group-by answer is an answer error and is not cached", async () => {
    for (const body of ["not json", "{}", '{"group_by": 3}', ""]) {
      rig.serve(url(), body);
      const error = (await rig.client().groupBy("all_total", MONDAY).catch((e: unknown) => e)) as OpenAlexError;
      expect(error, body).toBeInstanceOf(OpenAlexError);
      expect(error.kind, body).toBe("answer");
    }
    expect(rig.cached().size).toBe(0);
  });

  it("C31: a failure caches nothing and tallies nothing, and the same client fetches the answer once OpenAlex answers", async () => {
    rig.refuse(url(), 500);
    const client = rig.client();
    await expect(client.groupBy("all_total", MONDAY)).rejects.toBeInstanceOf(OpenAlexError);
    expect(rig.cached().size).toBe(0);
    expect(client.stats()).toEqual({ requests: 0, cache_hits: 0, credits: 0 });
    rig.serve(url(), groupBody({ [FIELD(26)]: 5 }));
    expect((await client.groupBy("all_total", MONDAY)).counts.mathematics).toBe(5);
    expect(client.stats()).toEqual({ requests: 1, cache_hits: 0, credits: 1 });
  });

  it("C32: a week stops at its first failure, and the answers fetched before it stay cached, so the next run fetches only what is missing", async () => {
    serveWeek(rig, MONDAY, WEEK_A);
    rig.refuse(urlOf(MONDAY, "all_ai"), 429);
    const day = rig.client();
    await expect(day.fetchWeek(MONDAY)).rejects.toBeInstanceOf(OpenAlexBudgetError);
    expect(urls()).toEqual([urlOf(MONDAY, "leading_ai"), urlOf(MONDAY, "leading_total"), urlOf(MONDAY, "all_ai")]);
    expect(day.stats()).toEqual({ requests: 2, cache_hits: 0, credits: 11 });
    expect(rig.cached().size).toBe(2);
    // Budget back (the next morning's reset, a day later): the rest of the week, and only that.
    rig.serve(urlOf(MONDAY, "all_ai"), groupBody(WEEK_A.all_ai));
    fetchSpy.mockClear();
    const next = rig.client({ now: morning("2026-11-29") });
    const w = await next.fetchWeek(MONDAY);
    expect(urls()).toEqual([urlOf(MONDAY, "all_ai"), urlOf(MONDAY, "all_total")]);
    expect(w.fetched).toBe("2026-11-28");
    expect(w.leading).toEqual(WEEK_A_LEADING);
    expect(w.all).toEqual(WEEK_A_ALL);
  });
});

// ── The DOI lookup (§8.3) ────────────────────────────────────────────────────────────────────────

/** A stand-in for the client: it answers each request with what `handler` returns, or throws what it throws. */
function fakeClient(handler: (url: string, call: number) => unknown): { client: Pick<OpenAlexClient, "request" | "query">; requested: string[]; whats: (string | undefined)[] } {
  const requested: string[] = [];
  const whats: (string | undefined)[] = [];
  const client: Pick<OpenAlexClient, "request" | "query"> = {
    query: QUERY,
    async request(url: string, what?: string) {
      requested.push(url);
      whats.push(what);
      const answer = handler(url, requested.length);
      return { text: typeof answer === "string" ? answer : JSON.stringify(answer), fetched_at: "2026-11-28T09:00:00+08:00" };
    },
  };
  return { client, requested, whats };
}

const doiAnswer = (...records: unknown[]) => ({ meta: { count: records.length }, results: records });
const record = (doi: string | null, fieldId?: string | number | null, topic: unknown = undefined) => ({
  doi, primary_topic: topic !== undefined ? topic : fieldId === undefined ? null : { field: { id: fieldId, display_name: "x" } },
});

/** 150 candidates, one new DOI each, whose publication dates run in an order that is not the order of their numbers: i * 37 mod 150 days after 2026-01-01. */
function candidates150(): { all: DoiCandidate[]; oldestFirst: string[] } {
  const doi = (i: number) => `10.5555/d${String(i).padStart(3, "0")}`;
  const day = (i: number) => (i * 37) % 150;
  const all = Array.from({ length: 150 }, (_, i) => ({ doi: i % 2 === 0 ? doi(i).toUpperCase() : `https://doi.org/${doi(i)}`, published_at: addDays("2026-01-01", day(i)) }));
  const oldestFirst = [...Array(150).keys()].sort((a, b) => day(a) - day(b)).map(doi);
  return { all, oldestFirst };
}

describe("which DOIs are asked, and in what order", () => {
  it("C33: each DOI once in §4.1's form, oldest candidate first, with those that cannot be asked left out", () => {
    const list: DoiCandidate[] = [
      { doi: "10.1000/B", published_at: "2026-03-01" },
      { doi: "https://doi.org/10.1000/a", published_at: "2026-02-01" },
      { doi: "10.1000/b", published_at: "2026-01-15" },
      { doi: null, published_at: "2026-01-01" },
      { doi: "not a doi", published_at: "2026-01-01" },
      { doi: "10.1000/c,d", published_at: "2026-01-01" },
      { doi: "10.1000/e|f", published_at: "2026-01-01" },
      { doi: "10.1000/g", published_at: "2026-04-01" },
    ];
    // b's oldest date is 2026-01-15, a's 2026-02-01, g's 2026-04-01.
    expect(askableDois(list)).toEqual(["10.1000/b", "10.1000/a", "10.1000/g"]);
    expect(askableDois([])).toEqual([]);
    expect(askableDois([{ doi: null, published_at: null }])).toEqual([]);
  });

  it("C33b: a DOI with an unpaired surrogate is left out (no URL can carry it), and a paired one is asked for, URL-encoded as its UTF-8", async () => {
    const lone = String.fromCharCode(0xd83d);
    const loneLow = String.fromCharCode(0xde00);
    const pair = "\u{1F600}";
    const list: DoiCandidate[] = [
      { doi: `10.1000/a${lone}b`, published_at: "2026-01-01" },
      { doi: `10.1000/c${loneLow}d`, published_at: "2026-01-02" },
      { doi: `10.1000/${lone}`, published_at: "2026-01-03" },
      { doi: `10.1000/${loneLow}${lone}`, published_at: "2026-01-04" },
      { doi: `10.1000/ok${pair}`, published_at: "2026-01-05" },
      { doi: "10.1000/plain", published_at: "2026-01-06" },
    ];
    expect(askableDois(list)).toEqual([`10.1000/ok${pair}`, "10.1000/plain"]);
    expect(doiLookupUrl([`10.1000/ok${pair}`])).toContain("filter=doi:10.1000%2Fok%F0%9F%98%80&");
    // The lookup never throws for such a candidate: the other DOIs are asked as usual.
    const { client, requested } = fakeClient((url) => doiAnswer(...decodeURIComponent(url.split("filter=doi:")[1]!.split("&")[0]!).split("|").map((d) => record(d, FIELD(26)))));
    const result = await lookupDois(client, list, { maxRequests: 12 });
    expect(requested).toEqual([doiLookupUrl([`10.1000/ok${pair}`, "10.1000/plain"])]);
    expect(result.stats).toMatchObject({ askable: 2, asked: 2, mapped: 2, failed_requests: 0 });
  });

  it("C34: DOIs of the same date are in code-unit order, never locale order", () => {
    const same = "2026-02-01";
    // Code units: "1x" (0x31) is before "_x" (0x5F), which is before "ax"; a locale compare puts punctuation first.
    const list = ["10.1000/ax", "10.1000/_x", "10.1000/1x"].map((doi) => ({ doi, published_at: same }));
    expect(askableDois(list)).toEqual(["10.1000/1x", "10.1000/_x", "10.1000/ax"]);
    expect(askableDois([...list].reverse())).toEqual(["10.1000/1x", "10.1000/_x", "10.1000/ax"]);
  });

  it("C35: a candidate with no usable date is asked last, and dates with an offset compare as the moments they are", () => {
    const list: DoiCandidate[] = [
      { doi: "10.1000/none", published_at: null },
      { doi: "10.1000/bad", published_at: "last week" },
      { doi: "10.1000/c-bare", published_at: "2026-01-02" },
      { doi: "10.1000/b-offset", published_at: "2026-01-02T01:00:00+08:00" },
      { doi: "10.1000/a-bare", published_at: "2026-01-01" },
    ];
    // 2026-01-02T01:00+08:00 is 2026-01-01T17:00Z: after the bare 2026-01-01 and before the bare 2026-01-02.
    expect(askableDois(list)).toEqual(["10.1000/a-bare", "10.1000/b-offset", "10.1000/c-bare", "10.1000/bad", "10.1000/none"]);
  });

  it("C36: a DOI that is listed twice takes the oldest of its dates, whatever the form it is written in", () => {
    const list: DoiCandidate[] = [
      { doi: "10.1000/x", published_at: "2026-05-01" },
      { doi: "10.1000/y", published_at: "2026-03-01" },
      { doi: "HTTPS://DOI.ORG/10.1000/X", published_at: "2026-02-01" },
      { doi: "10.1000/x", published_at: null },
    ];
    expect(askableDois(list)).toEqual(["10.1000/x", "10.1000/y"]);
  });
});

describe("the DOI request", () => {
  it("C37: the filter joins the DOIs with a literal bar, each DOI URL-encoded, with 100 to a page and only the two members selected", () => {
    expect(doiLookupUrl(["10.1000/abc", "10.1000/def"])).toBe("https://api.openalex.org/works?filter=doi:10.1000%2Fabc|10.1000%2Fdef&per-page=100&select=doi,primary_topic");
    expect(doiLookupUrl(["10.1000/abc"], "resolver")).toBe("https://api.openalex.org/works?filter=doi:https%3A%2F%2Fdoi.org%2F10.1000%2Fabc&per-page=100&select=doi,primary_topic");
    expect(doiLookupUrl(["10.1000/abc", "10.1000/def"], "resolver")).toContain("doi:https%3A%2F%2Fdoi.org%2F10.1000%2Fabc|https%3A%2F%2Fdoi.org%2F10.1000%2Fdef&");
    expect(DOI_BATCH_MAX).toBe(100);
    expect(PER_PAGE_MAX).toBe(100);
    expect(SEED_MAX).toBe(2_147_483_647);
  });

  it("C38: characters a URL reads as its own are percent-encoded in a DOI, in both forms, and a `%` in a DOI is escaped before the resolver form encodes it", () => {
    const odd = "10.1002/(sici)1097-4571(199801)49:1<1::aid-asi1>3.0.co;2-z";
    expect(doiLookupUrl([odd])).toContain("filter=doi:10.1002%2F(sici)1097-4571(199801)49%3A1%3C1%3A%3Aaid-asi1%3E3.0.co%3B2-z&");
    expect(doiLookupUrl([odd], "resolver")).toContain("filter=doi:https%3A%2F%2Fdoi.org%2F10.1002%2F(sici)1097-4571(199801)49%3A1%3C1%3A%3Aaid-asi1%3E3.0.co%3B2-z&");
    expect(doiLookupUrl(["10.1000/a%b"])).toContain("filter=doi:10.1000%2Fa%25b&");
    expect(doiLookupUrl(["10.1000/a%b"], "resolver")).toContain("filter=doi:https%3A%2F%2Fdoi.org%2F10.1000%2Fa%2525b&");
  });

  it("C39: 1 to 100 DOIs make a request: none or 101 is refused, and so is a DOI that is not in §4.1's form or holds a comma or a bar", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `10.1000/p${i}`);
    expect(doiLookupUrl(many(100)).split("|")).toHaveLength(100);
    expect(() => doiLookupUrl([])).toThrow(RangeError);
    expect(() => doiLookupUrl(many(101))).toThrow(RangeError);
    for (const bad of ["10.1000/ABC", "https://doi.org/10.1000/abc", "10.1000/a,b", "10.1000/a|b", "abc", " 10.1000/abc", ""]) {
      expect(() => doiLookupUrl([bad]), bad).toThrow(RangeError);
      expect(() => doiLookupUrl([bad], "resolver"), bad).toThrow(RangeError);
    }
  });
});

describe("the DOI lookup", () => {
  const ok = (field = FIELD(26)) => (url: string) => doiAnswer(...decodeURIComponent(url.split("filter=doi:")[1]!.split("&")[0]!).split("|").map((d) => record(d, field)));

  it("C40: 150 DOIs are two requests, the 100 oldest first and then the 50 others, each DOI once", async () => {
    const { all, oldestFirst } = candidates150();
    const { client, requested } = fakeClient(ok());
    const result = await lookupDois(client, [...all, { doi: "10.5555/d000", published_at: "2027-01-01" }, { doi: "10.5555/x,y", published_at: "2020-01-01" }], { maxRequests: 12 });
    expect(requested).toEqual([doiLookupUrl(oldestFirst.slice(0, 100)), doiLookupUrl(oldestFirst.slice(100))]);
    expect(requested.join("")).not.toContain("%2C");
    expect(result.stats).toEqual({ askable: 150, asked: 150, not_asked: 0, requests: 2, failed_requests: 0, records: 150, not_indexed: 0, no_topic: 0, excluded: 0, unmapped: 0, mapped: 150 });
    expect(result.stopped_on_budget).toBe(false);
    expect(result.fields.size).toBe(150);
    expect([...result.fields.values()].every((f) => f === "mathematics")).toBe(true);
    expect([...result.fields.keys()].every((d) => d === d.toLowerCase())).toBe(true);
  });

  it("C40b: each request of the lookup is named \"a DOI lookup\"", async () => {
    const { client, whats } = fakeClient(ok());
    await lookupDois(client, [{ doi: "10.5555/a", published_at: "2026-01-01" }], { maxRequests: 3 });
    expect(whats).toEqual(["a DOI lookup"]);
  });

  it("C41: it makes at most `maxRequests` requests, oldest DOIs first, and counts the DOIs it left for want of one", async () => {
    const { all, oldestFirst } = candidates150();
    const one = fakeClient(ok());
    const first = await lookupDois(one.client, all, { maxRequests: 1 });
    expect(one.requested).toEqual([doiLookupUrl(oldestFirst.slice(0, 100))]);
    expect(first.stats).toMatchObject({ askable: 150, asked: 100, not_asked: 50, requests: 1, mapped: 100 });
    expect(first.fields.has(oldestFirst[99]!)).toBe(true);
    expect(first.fields.has(oldestFirst[100]!)).toBe(false);
    const none = fakeClient(ok());
    const zero = await lookupDois(none.client, all, { maxRequests: 0 });
    expect(none.requested).toEqual([]);
    expect(zero.stats).toMatchObject({ askable: 150, asked: 0, not_asked: 150, requests: 0, mapped: 0 });
    // The spec's cap of 12 requests: 1,300 DOIs leave 100.
    const wide = Array.from({ length: 1300 }, (_, i) => ({ doi: `10.5555/w${String(i).padStart(4, "0")}`, published_at: addDays("2020-01-01", i) }));
    const capped = fakeClient(ok());
    const twelve = await lookupDois(capped.client, wide, { maxRequests: 12 });
    expect(capped.requested).toHaveLength(12);
    expect(twelve.stats).toMatchObject({ asked: 1200, not_asked: 100, requests: 12 });
    expect(twelve.fields.has("10.5555/w1199")).toBe(true);
    expect(twelve.fields.has("10.5555/w1200")).toBe(false);
  });

  it("C42: a bad request cap is refused", async () => {
    const { client, requested } = fakeClient(ok());
    for (const bad of [-1, 1.5, Number.NaN]) await expect(lookupDois(client, [], { maxRequests: bad }), String(bad)).rejects.toThrow(RangeError);
    expect(requested).toEqual([]);
  });

  it("C43: a record is matched by its DOI in any case or form, its field is read from its primary topic, and every DOI that does not take a field is counted by why", async () => {
    const dois = Array.from({ length: 10 }, (_, i) => ({ doi: `10.1000/d${i + 1}`, published_at: addDays("2026-01-01", i) }));
    const answer = doiAnswer(
      record("https://doi.org/10.1000/D1", FIELD(26)),
      record("https://doi.org/10.1000/d2", 31),
      record("10.1000/d3", "13"),
      record("https://doi.org/10.1000/d3", FIELD(31)),
      record("https://doi.org/10.1000/d4", FIELD(17)),
      record("https://doi.org/10.1000/d5", FIELD(99)),
      record("https://doi.org/10.1000/d6", undefined, null),
      record("https://doi.org/10.1000/d7", undefined, { field: null }),
      record("https://doi.org/10.1000/d8", null),
      record("https://doi.org/10.1000/d10", "unknown"),
      record("https://doi.org/10.1000/not-asked", FIELD(26)),
      record(null, FIELD(26)),
      { primary_topic: { field: { id: FIELD(26) } } },
    );
    const { client } = fakeClient(() => answer);
    const result = await lookupDois(client, dois, { maxRequests: 12 });
    expect([...result.fields]).toEqual([["10.1000/d1", "mathematics"], ["10.1000/d2", "physics"], ["10.1000/d3", "biology"]]);
    // d1 d2 d3 (twice) d4 d5 d6 d7 d8 d10: ten records; d9 has none.
    expect(result.stats).toEqual({ askable: 10, asked: 10, not_asked: 0, requests: 1, failed_requests: 0, records: 10, not_indexed: 1, no_topic: 3, excluded: 1, unmapped: 2, mapped: 3 });
  });

  it("C44: a request that fails leaves its DOIs to the next mapping, and the next batch is still asked", async () => {
    const { all, oldestFirst } = candidates150();
    for (const failure of [new OpenAlexError("network", "no answer", "u"), new OpenAlexError("http", "HTTP 500", "u", 500), new TypeError("boom"), "not json", { results: 3 }, { meta: {} }]) {
      const { client, requested } = fakeClient((url, call) => {
        if (call === 1) {
          if (failure instanceof Error) throw failure;
          return failure;
        }
        return ok()(url);
      });
      const result = await lookupDois(client, all, { maxRequests: 12 });
      expect(requested, String(failure)).toHaveLength(2);
      expect(result.stopped_on_budget).toBe(false);
      expect(result.stats, String(failure)).toMatchObject({ asked: 150, not_asked: 0, requests: 2, failed_requests: 1, records: 50, not_indexed: 0, mapped: 50 });
      expect([...result.fields.keys()].sort()).toEqual(oldestFirst.slice(100).sort());
    }
  });

  it("C45: a spent budget stops the lookup at once: what was answered before it is kept, and the DOIs not yet asked are counted", async () => {
    const { all, oldestFirst } = candidates150();
    const first = fakeClient(() => {
      throw new OpenAlexBudgetError("u", 429);
    });
    const none = await lookupDois(first.client, all, { maxRequests: 12 });
    expect(first.requested).toHaveLength(1);
    expect(none.stopped_on_budget).toBe(true);
    expect(none.stats).toMatchObject({ asked: 100, not_asked: 50, requests: 1, failed_requests: 1, mapped: 0 });
    const wide = Array.from({ length: 250 }, (_, i) => ({ doi: `10.5555/w${String(i).padStart(3, "0")}`, published_at: addDays("2020-01-01", i) }));
    const second = fakeClient((url, call) => {
      if (call === 2) throw new OpenAlexBudgetError("u", 402);
      return ok()(url);
    });
    const some = await lookupDois(second.client, wide, { maxRequests: 12 });
    expect(second.requested).toHaveLength(2);
    expect(some.stopped_on_budget).toBe(true);
    expect(some.stats).toMatchObject({ askable: 250, asked: 200, not_asked: 50, requests: 2, failed_requests: 1, mapped: 100 });
    expect(some.fields.size).toBe(100);
    expect(oldestFirst).toHaveLength(150);
  });

  it("C46: no candidate that can be asked is no request, and the form names the resolver form when asked to", async () => {
    const empty = fakeClient(ok());
    const r = await lookupDois(empty.client, [{ doi: null, published_at: null }, { doi: "10.1000/a|b", published_at: null }], { maxRequests: 12 });
    expect(empty.requested).toEqual([]);
    expect(r.stats).toEqual({ askable: 0, asked: 0, not_asked: 0, requests: 0, failed_requests: 0, records: 0, not_indexed: 0, no_topic: 0, excluded: 0, unmapped: 0, mapped: 0 });
    expect(r.fields.size).toBe(0);
    expect(r.stopped_on_budget).toBe(false);
    const bare = fakeClient(() => doiAnswer());
    await lookupDois(bare.client, [{ doi: "10.1000/a", published_at: null }], { maxRequests: 1 });
    const resolver = fakeClient(() => doiAnswer());
    await lookupDois(resolver.client, [{ doi: "10.1000/a", published_at: null }], { maxRequests: 1, form: "resolver" });
    expect(bare.requested).toEqual([doiLookupUrl(["10.1000/a"], "bare")]);
    expect(resolver.requested).toEqual([doiLookupUrl(["10.1000/a"], "resolver")]);
    expect(resolver.requested[0]).not.toBe(bare.requested[0]);
  });

  it("C47: through the real client the lookup costs one credit a request, sends the key, and caches nothing", async () => {
    const batch = ["10.1000/a", "10.1000/b"];
    rig.serve(`${doiLookupUrl(batch)}&api_key=sample-key-123`, doiAnswer(record("https://doi.org/10.1000/a", FIELD(33)), record("https://doi.org/10.1000/b", FIELD(12))));
    const client = rig.client({ apiKey: "sample-key-123" });
    const result = await lookupDois(client, batch.map((doi, i) => ({ doi, published_at: `2026-01-0${i + 1}` })), { maxRequests: 12 });
    expect([...result.fields]).toEqual([["10.1000/a", "social"], ["10.1000/b", "humanities"]]);
    expect(client.stats()).toEqual({ requests: 1, cache_hits: 0, credits: 1 });
    expect(urls()).toEqual([`${doiLookupUrl(batch)}&api_key=sample-key-123`]);
    expect(rig.cached().size).toBe(0);
  });
});

// ── The sampler (§10 P2 step 2) ──────────────────────────────────────────────────────────────────

describe("the seeded generator", () => {
  /** Worked in a separate implementation of mulberry32 (Tommy Ettinger's), as the integers the first four calls give before the division by 2^32. */
  const FIRST_FOUR: [number, number[]][] = [
    [0, [1144304738, 1416247, 958946056, 627933444]],
    [1, [2693262067, 11749833, 2265367787, 4213581821]],
    [7, [50271532, 266108690, 4195786334, 3002305430]],
    [42, [2581720956, 1925393290, 3661312704, 2876485805]],
    [2147483647, [1842962257, 546041740, 1654754255, 1702490205]],
    [4294967295, [3850105811, 813802916, 3073704848, 4054706436]],
    [4294967301, [2962560684, 3318907087, 943874942, 2676532661]],
  ];

  it("S1: mulberry32 gives the same numbers on every platform: its first four outputs for seven seeds, as fractions of 2^32", () => {
    for (const [seed, outputs] of FIRST_FOUR) {
      const next = mulberry32(seed);
      expect([next(), next(), next(), next()], String(seed)).toEqual(outputs.map((n) => n / 4_294_967_296));
    }
  });

  it("S2: a seed is read as an unsigned 32-bit integer, and every output is below 1", () => {
    expect(mulberry32(4294967301)()).toBe(mulberry32(5)());
    expect(mulberry32(-1)()).toBe(mulberry32(4294967295)());
    const next = mulberry32(99);
    for (let i = 0; i < 1000; i += 1) {
      const x = next();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  it("S3: a draw takes n of the items in a seeded random order, and the same items, n and seed give the same draw", () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(seededDraw(ten, 4, 7)).toEqual([1, 2, 10, 8]);
    expect(seededDraw(ten, 4, 8)).toEqual([2, 7, 5, 8]);
    expect(seededDraw(ten, 10, 7)).toEqual([1, 2, 10, 8, 4, 5, 6, 7, 3, 9]);
    expect(seededDraw(ten, 20, 1)).toEqual([7, 2, 1, 10, 4, 3, 9, 5, 6, 8]);
    expect(seededDraw(["a", "b", "c", "d", "e"], 2, 0)).toEqual(["b", "a"]);
    expect(seededDraw(["a", "b", "c", "d", "e"], 2, 2147483647)).toEqual(["c", "b"]);
    expect(seededDraw(Array.from({ length: 100 }, (_, i) => i + 1), 5, 12345)).toEqual([98, 32, 50, 83, 53]);
    expect(seededDraw(Array.from({ length: 250 }, (_, i) => i + 1), 10, 42)).toEqual([151, 113, 214, 169, 48, 135, 73, 159, 218, 123]);
    expect(seededDraw(ten, 0, 7)).toEqual([]);
    expect(seededDraw([], 3, 7)).toEqual([]);
  });

  it("S4: a draw has no repeats, leaves its input as it was, and refuses an n that is not a whole number of 0 or more", () => {
    const items = Array.from({ length: 50 }, (_, i) => `W${i}`);
    const copy = [...items];
    const drawn = seededDraw(items, 20, 3);
    expect(items).toEqual(copy);
    expect(new Set(drawn).size).toBe(20);
    expect(drawn.every((d) => items.includes(d))).toBe(true);
    expect(seededDraw(items, 50, 3).slice().sort()).toEqual([...items].sort());
    expect(seededDraw(Object.freeze([1, 2, 3]), 2, 1)).toHaveLength(2);
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => seededDraw(items, bad, 3), String(bad)).toThrow(RangeError);
  });
});

describe("the sample's filter and URL", () => {
  const DATES = "from_publication_date:2026-06-29,to_publication_date:2026-09-27,type:article,has_abstract:true";
  const SPEC: SampleSpec = { from: "2026-06-29", to: "2026-09-27", scope: "all", n: 5, seed: 7 };

  it("S5: the filter is the dates, article, abstract, then the journals for A, the fields, and the search last", () => {
    expect(sampleFilter(QUERY, SPEC)).toBe(DATES);
    expect(sampleFilter(QUERY, { ...SPEC, scope: "leading" })).toBe(`${DATES},primary_location.source.id:S100|S200`);
    expect(sampleFilter(QUERY, { ...SPEC, fields: ["biology", "physics"] })).toBe(`${DATES},primary_topic.field.id:13|27|31`);
    expect(sampleFilter(QUERY, { ...SPEC, scope: "leading", fields: ["humanities"], include: ["machine learning"] }))
      .toBe(`${DATES},primary_location.source.id:S100|S200,primary_topic.field.id:12,title_and_abstract.search:%22machine%20learning%22`);
  });

  it("S6: the field ids are in numeric order, and only the mapped ones of the fields asked are named, never an excluded one", () => {
    const q: PaceQuery = { ...QUERY, fields: new Map<number, FieldId | null>([[26, "mathematics"], [9, "mathematics"], [31, "physics"], [17, null]]) };
    expect(sampleFilter(q, { ...SPEC, fields: ["mathematics"] })).toBe(`${DATES},primary_topic.field.id:9|26`);
    expect(sampleFilter(q, { ...SPEC, fields: ["physics", "mathematics"] })).toBe(`${DATES},primary_topic.field.id:9|26|31`);
    expect(() => sampleFilter(q, { ...SPEC, fields: [] })).toThrow(new RangeError("None of the sample's fields has an OpenAlex field id"));
    expect(() => sampleFilter(q, { ...SPEC, fields: ["chemistry"] })).toThrow(new RangeError("None of the sample's fields has an OpenAlex field id"));
  });

  it("S6b: an A sample names 1 to 100 journals, as the weekly filters do: none or 101 is refused, and a sample of all papers names none", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `S${i + 1}`);
    const leading: SampleSpec = { ...SPEC, scope: "leading" };
    expect(() => sampleFilter({ ...QUERY, sources: [] }, leading)).toThrow("A filter joins 1 to 100 journals, got 0");
    expect(() => sampleFilter({ ...QUERY, sources: many(101) }, leading)).toThrow("A filter joins 1 to 100 journals, got 101");
    expect(sampleFilter({ ...QUERY, sources: many(100) }, leading)).toBe(`${DATES},primary_location.source.id:${many(100).join("|")}`);
    expect(sampleFilter({ ...QUERY, sources: [] }, SPEC)).toBe(DATES);
  });

  it("S7: include and exclude make the search: either alone, or the first with the second as a NOT", () => {
    const search = (f: string) => `${DATES},title_and_abstract.search:${f}`;
    expect(sampleFilter(QUERY, { ...SPEC, include: ["machine learning", "deep learning"] })).toBe(search("%22machine%20learning%22%20OR%20%22deep%20learning%22"));
    expect(sampleFilter(QUERY, { ...SPEC, include: ["machine learning"], exclude: ["deep learning"] })).toBe(search("(%22machine%20learning%22)%20NOT%20(%22deep%20learning%22)"));
    expect(sampleFilter(QUERY, { ...SPEC, exclude: ["deep learning", "AlphaFold"] })).toBe(search("NOT%20(%22deep%20learning%22%20OR%20%22AlphaFold%22)"));
    expect(sampleFilter(QUERY, { ...SPEC, include: [], exclude: [] })).toBe(DATES);
  });

  it("S8: dates that run backwards or are not dates, an n outside 1 to 100, a seed outside 0 to 2,147,483,647 and a phrase that is not safe are refused", () => {
    for (const bad of [{ from: "2026-09-28", to: "2026-09-27" }, { from: "2026-02-30" }, { to: "tomorrow" }, { n: 0 }, { n: 101 }, { n: 1.5 }, { n: Number.NaN }, { seed: -1 }, { seed: 2_147_483_648 }, { seed: 1.5 }, { include: ["a,b"] }, { exclude: ['a"b'] }]) {
      expect(() => sampleFilter(QUERY, { ...SPEC, ...bad } as SampleSpec), JSON.stringify(bad)).toThrow(RangeError);
    }
    for (const fine of [{ from: "2026-09-27" }, { n: 1 }, { n: 100 }, { seed: 0 }, { seed: 2_147_483_647 }]) {
      expect(() => sampleFilter(QUERY, { ...SPEC, ...fine } as SampleSpec), JSON.stringify(fine)).not.toThrow();
    }
  });

  it("S9: the sample request asks for `sample`, `seed`, a page of the same size and the five members it reads", () => {
    expect(SAMPLE_SELECT).toBe("id,doi,title,publication_date,abstract_inverted_index");
    expect(sampleUrl("F", 5, 7)).toBe("https://api.openalex.org/works?filter=F&sample=5&seed=7&per-page=5&select=id,doi,title,publication_date,abstract_inverted_index");
  });
});

describe("compareWorkIds and abstractText", () => {
  it("S10: ids are compared as numbers, so W9 comes before W10 and W100", () => {
    expect(["W100", "W9", "W10", "W2", "W33"].sort(compareWorkIds)).toEqual(["W2", "W9", "W10", "W33", "W100"]);
    expect(compareWorkIds("W5", "W5")).toBe(0);
    expect(compareWorkIds("W12", "W13")).toBeLessThan(0);
  });

  it("S11: an abstract is its words in the order of their positions, a word at several positions once each there, and null for none", () => {
    expect(abstractText({ b: [1], a: [0, 2] })).toBe("a b a");
    expect(abstractText({ Deep: [0], learning: [1], helps: [2], science: [3], deep: [4] })).toBe("Deep learning helps science deep");
    // Two words at one position: code-unit order.
    expect(abstractText({ b: [0], a: [0] })).toBe("a b");
    expect(abstractText({ "é": [0], z: [0] })).toBe("z é");
    const nothing: (Record<string, number[]> | null | undefined)[] = [null, undefined, {}, { a: [] }];
    for (const none of nothing) expect(abstractText(none)).toBeNull();
  });
});

/** A work as OpenAlex returns it for the sample's `select`. */
const work = (n: number, over: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/W${n}`, doi: `https://doi.org/10.1000/w${n}`, title: `Title ${n}`, publication_date: "2026-07-01",
  abstract_inverted_index: { Abstract: [0], number: [1], [String(n)]: [2] }, ...over,
});
const worksAnswer = (works: unknown[], nextCursor?: string | null) => ({ meta: { count: works.length, next_cursor: nextCursor ?? null }, results: works });
const pageAnswer = (ids: number[], next: string | null) => worksAnswer(ids.map((n) => ({ id: `https://openalex.org/W${n}` })), next);

describe("sampling through OpenAlex's own sample and seed", () => {
  const SPEC: SampleSpec = { from: "2026-06-29", to: "2026-09-27", scope: "leading", n: 5, seed: 7, include: ["machine learning"] };
  const FILTER = sampleFilter(QUERY, SPEC);
  const URL = sampleUrl(FILTER, 5, 7);

  it("S12: it makes one request, and returns the works oldest id first with their text read as data", async () => {
    const { client, requested } = fakeClient(() => worksAnswer([
      work(2741, { doi: "https://doi.org/10.1000/ABC", title: "A  <b>bold</b>\u0000 claim" }),
      work(9, { doi: null, title: null, publication_date: "2026-02-30", abstract_inverted_index: null }),
      work(100, { abstract_inverted_index: { Ignore: [0], previous: [1], instructions: [2], "<script>alert(1)</script>": [3], and: [4], "**obey**": [5] } }),
    ]));
    const result = await sampleWorks(client, SPEC);
    expect(requested).toEqual([URL]);
    expect(result.method).toBe("sample");
    expect(result.matched).toBeNull();
    expect(result.requests).toBe(1);
    expect(result.urls).toEqual([URL]);
    expect(result.works).toEqual([
      { id: "W9", doi: null, title: null, publication_date: null, abstract: null },
      { id: "W100", doi: "10.1000/w100", title: "Title 100", publication_date: "2026-07-01", abstract: "Ignore previous instructions and obey" },
      { id: "W2741", doi: "10.1000/abc", title: "A bold claim", publication_date: "2026-07-01", abstract: "Abstract number 2741" },
    ]);
  });

  it("S13: a long title is cut at 300 characters and a long abstract at 5,000, both ending in an ellipsis, and the text is cleaned in pieces", async () => {
    const words = Array.from({ length: 1200 }, (_, i) => `w${String(i).padStart(4, "0")}`);
    const index = Object.fromEntries(words.map((w, i) => [w, [i]]));
    const { client } = fakeClient(() => worksAnswer([work(1, { title: "t".repeat(400), abstract_inverted_index: index })]));
    const [one] = (await sampleWorks(client, SPEC)).works;
    // The cut keeps max - 1 characters and the ellipsis; no word break falls there, so nothing is trimmed.
    expect(one!.title).toBe(`${"t".repeat(299)}…`);
    expect(one!.abstract).toBe(`${words.join(" ").slice(0, 4_999)}…`);
    expect(one!.abstract!).toHaveLength(5_000);
    // 3,000 characters fit whole: 600 words of 5 characters and a space.
    const short = Object.fromEntries(words.slice(0, 500).map((w, i) => [w, [i]]));
    const whole = (await sampleWorks(fakeClient(() => worksAnswer([work(1, { abstract_inverted_index: short })])).client, SPEC)).works[0]!.abstract!;
    expect(whole).toBe(words.slice(0, 500).join(" "));
  });

  it("S13b: markup that spans several words is cleaned as one text, so a script block with spaces in it leaves nothing behind", async () => {
    const index = { Before: [0], "<script>": [1], "alert(1)": [2], "</script>": [3], after: [4] };
    const { client } = fakeClient(() => worksAnswer([work(1, { abstract_inverted_index: index })]));
    expect((await sampleWorks(client, SPEC)).works[0]!.abstract).toBe("Before after");
  });

  it("S13c: a text is cut into pieces of at most 800 characters at word breaks: a word that ends a piece at exactly 800 stays in it, one more character starts the next", async () => {
    const indexOf = (words: string[]): Record<string, number[]> => {
      const index: Record<string, number[]> = {};
      words.forEach((w, i) => (index[w] ??= []).push(i));
      return index;
    };
    // `fill` characters of filler words (78 of 9, then one more), a space, then `<script>`: the piece holds fill + 1 + 8 characters.
    const abstractFor = async (fill: number): Promise<string | null> => {
      const last = fill - (78 * 10 - 1) - 1;
      const filler = [...Array.from({ length: 78 }, () => "a".repeat(9)), "b".repeat(last)];
      const words = [...filler, "<script>", "LEAK", "</script>", "tail"];
      expect(filler.join(" ")).toHaveLength(fill);
      const { client } = fakeClient(() => worksAnswer([work(1, { abstract_inverted_index: indexOf(words) })]));
      return (await sampleWorks(client, SPEC)).works[0]!.abstract;
    };
    // 791 + 1 + 8 = 800: `<script>` ends the first piece, so the script block is cut in two and its text is left.
    expect(await abstractFor(791)).toMatch(/ LEAK tail$/);
    // 792 + 1 + 8 = 801: `<script>` starts the second piece, whole with its end tag, and the block goes.
    const whole = await abstractFor(792);
    expect(whole).toMatch(/ tail$/);
    expect(whole).not.toContain("LEAK");
  });

  it("S14: more works than n, a work twice, a work with no W id and an answer that is not a list of works are answer errors", async () => {
    const tooMany = "OpenAlex's sample is not at most 5 different works";
    const noId = "A work in OpenAlex's answer has no W id";
    const bad: [unknown, string][] = [
      [worksAnswer([1, 2, 3, 4, 5, 6].map((n) => work(n))), tooMany],
      [worksAnswer([work(1), work(1)]), tooMany],
      [worksAnswer([work(1, { id: "https://openalex.org/A1" })]), noId],
      [worksAnswer([work(1, { id: "W1/extra" })]), noId],
      ["not json", "OpenAlex's answer is not JSON"],
      [{ results: "x" }, "OpenAlex's answer has no usable results list"],
      [{ meta: {} }, "OpenAlex's answer has no usable results list"],
      [{ results: [{ title: "no id" }] }, "OpenAlex's answer has no usable results list"],
    ];
    for (const [answer, message] of bad) {
      const error = await sampleWorks(fakeClient(() => answer).client, SPEC).catch((e: unknown) => e);
      expect(error, JSON.stringify(answer)).toBeInstanceOf(OpenAlexError);
      expect((error as OpenAlexError).kind).toBe("answer");
      expect((error as OpenAlexError).message, JSON.stringify(answer)).toBe(message);
    }
    // Exactly n works is fine, and so is none.
    expect((await sampleWorks(fakeClient(() => worksAnswer([1, 2, 3, 4, 5].map((n) => work(n)))).client, SPEC)).works).toHaveLength(5);
    expect((await sampleWorks(fakeClient(() => worksAnswer([])).client, SPEC)).works).toEqual([]);
  });

  it("S15: the spec is checked before any request is made", async () => {
    const { client, requested } = fakeClient(() => worksAnswer([]));
    await expect(sampleWorks(client, { ...SPEC, n: 101 })).rejects.toThrow(RangeError);
    await expect(sampleWorks(client, { ...SPEC, seed: -1 })).rejects.toThrow(RangeError);
    await expect(sampleWorks(client, { ...SPEC, method: "page", n: 0 })).rejects.toThrow(RangeError);
    expect(requested).toEqual([]);
  });

  it("S16: through the real client, a sample with a search costs 10 credits and carries the key; one without costs 1", async () => {
    rig.serve(`${URL}&api_key=sample-key-123`, worksAnswer([work(3)]));
    const client = rig.client({ apiKey: "sample-key-123" });
    const result = await sampleWorks(client, SPEC);
    expect(result.works.map((w) => w.id)).toEqual(["W3"]);
    expect(result.urls).toEqual([URL]);
    expect(client.stats()).toEqual({ requests: 1, cache_hits: 0, credits: 10 });
    const plainSpec = { ...SPEC, include: undefined };
    rig.serve(sampleUrl(sampleFilter(QUERY, plainSpec), 5, 7), worksAnswer([work(4)]));
    const plainClient = rig.client();
    await sampleWorks(plainClient, plainSpec);
    expect(plainClient.stats().credits).toBe(1);
  });
});

describe("sampling by paging through the matches", () => {
  const SPEC: SampleSpec = { from: "2026-06-29", to: "2026-09-27", scope: "all", n: 3, seed: 7, include: ["machine learning"], exclude: ["deep learning"] };
  const BASE = "from_publication_date:2026-06-29,to_publication_date:2026-09-27,type:article,has_abstract:true";
  const INCLUDE = `${BASE},title_and_abstract.search:%22machine%20learning%22`;
  const EXCLUDE = `${BASE},title_and_abstract.search:%22deep%20learning%22`;
  const page = (filter: string, cursor: string) => `https://api.openalex.org/works?filter=${filter}&per-page=100&select=id&cursor=${cursor}`;
  const detail = (...ids: number[]) => `https://api.openalex.org/works?filter=openalex:${ids.map((n) => `W${n}`).join("|")}&per-page=100&select=id,doi,title,publication_date,abstract_inverted_index`;

  /** A handler for the page path: the ids each filter matches, 2 to a page, and the works of any `openalex:` request. */
  function pages(matches: Record<string, number[]>) {
    return (url: string): unknown => {
      if (url.includes("&sample=")) throw new OpenAlexError("http", "HTTP 400", url, 400);
      if (url.includes("filter=openalex:")) {
        return worksAnswer(url.split("filter=openalex:")[1]!.split("&")[0]!.split("|").map((id) => work(Number(id.slice(1)))).reverse());
      }
      const filter = url.split("filter=")[1]!.split("&per-page")[0]!;
      const cursor = decodeURIComponent(url.split("cursor=")[1]!);
      const ids = matches[filter]!;
      const at = cursor === "*" ? 0 : Number(cursor.replace("cursor-", ""));
      const slice = ids.slice(at, at + 2);
      return pageAnswer(slice, at + 2 < ids.length ? `cursor-${at + 2}` : null);
    };
  }

  it("S17: the sample's 4xx sends `auto` to the pages: the matches of include less those of exclude, drawn with the seed, then one request for the drawn works", async () => {
    // Include matches W5 W3 W1 W2 W4 (two pages and a half), exclude matches W2 and W9: candidates W1 W3 W4 W5.
    const { client, requested } = fakeClient(pages({ [INCLUDE]: [5, 3, 1, 2, 4], [EXCLUDE]: [2, 9] }));
    const result = await sampleWorks(client, SPEC);
    // The draw of 3 from [1, 3, 4, 5] with seed 7, worked in a separate implementation of the generator: 1, 3, 5.
    expect(result.method).toBe("page");
    expect(result.matched).toBe(4);
    expect(result.works.map((w) => w.id)).toEqual(["W1", "W3", "W5"]);
    expect(requested).toEqual([
      sampleUrl(sampleFilter(QUERY, SPEC), 3, 7),
      page(INCLUDE, "*"), page(INCLUDE, "cursor-2"), page(INCLUDE, "cursor-4"),
      page(EXCLUDE, "*"),
      detail(1, 3, 5),
    ]);
    expect(result.urls).toEqual(requested);
    expect(result.requests).toBe(6);
  });

  it("S17b: each request is named for what it asks, so a failure says which step it was", async () => {
    const { client, whats } = fakeClient(pages({ [INCLUDE]: [5, 3, 1, 2, 4], [EXCLUDE]: [2, 9] }));
    await sampleWorks(client, SPEC);
    expect(whats).toEqual(["a sample", "a page of matching works", "a page of matching works", "a page of matching works", "a page of matching works", "the drawn works"]);
  });

  it("S18: the draw is over the candidates in numeric id order, not in the order OpenAlex listed them or the order of the text", async () => {
    // Numeric order W2 W9 W10 W33 W100 with seed 3 and n 2 draws W33 and W9; text order (W10 W100 W2 W33 W9) would draw W33 and W100.
    const spec: SampleSpec = { ...SPEC, exclude: undefined, n: 2, seed: 3, method: "page" };
    const { client, requested } = fakeClient(pages({ [INCLUDE]: [100, 9, 33, 2, 10] }));
    const result = await sampleWorks(client, spec);
    expect(result.works.map((w) => w.id)).toEqual(["W9", "W33"]);
    expect(requested.at(-1)).toBe(detail(9, 33));
    expect(result.matched).toBe(5);
  });

  it("S19: with fewer candidates than n all of them are drawn, a work listed on two pages counts once, and a cursor with odd characters is encoded", async () => {
    const odd = "AoE/Xz+Q==";
    const seen: string[] = [];
    const { client, requested } = fakeClient((url) => {
      seen.push(url);
      if (url.includes("filter=openalex:")) return worksAnswer(url.split("filter=openalex:")[1]!.split("&")[0]!.split("|").map((id) => work(Number(id.slice(1)))));
      return url.endsWith("cursor=*") ? pageAnswer([3, 1], odd) : pageAnswer([1, 5], null);
    });
    const result = await sampleWorks(client, { ...SPEC, exclude: undefined, n: 10, method: "page" });
    expect(requested).toEqual([page(INCLUDE, "*"), page(INCLUDE, "AoE%2FXz%2BQ%3D%3D"), detail(1, 3, 5)]);
    expect(result.matched).toBe(3);
    expect(result.works.map((w) => w.id)).toEqual(["W1", "W3", "W5"]);
    expect(seen).toHaveLength(3);
  });

  it("S20: exclude alone is the whole base less what exclude matches, and with neither the whole base is paged", async () => {
    const onlyExclude = fakeClient(pages({ [BASE]: [1, 2, 3], [EXCLUDE]: [2] }));
    const a = await sampleWorks(onlyExclude.client, { ...SPEC, include: undefined, n: 5, method: "page" });
    expect(onlyExclude.requested).toEqual([page(BASE, "*"), page(BASE, "cursor-2"), page(EXCLUDE, "*"), detail(1, 3)]);
    expect(a.works.map((w) => w.id)).toEqual(["W1", "W3"]);
    const neither = fakeClient(pages({ [BASE]: [4, 6] }));
    const b = await sampleWorks(neither.client, { ...SPEC, include: undefined, exclude: undefined, n: 5, method: "page" });
    expect(neither.requested).toEqual([page(BASE, "*"), detail(4, 6)]);
    expect(b.matched).toBe(2);
  });

  it("S21: A's sample names the journals and a field sample the fields, in the paged requests as in the sample's", async () => {
    const spec: SampleSpec = { ...SPEC, scope: "leading", fields: ["physics"], include: undefined, exclude: undefined, n: 5, method: "page" };
    const base = `${BASE},primary_location.source.id:S100|S200,primary_topic.field.id:31`;
    const { client, requested } = fakeClient(pages({ [base]: [8] }));
    const result = await sampleWorks(client, spec);
    expect(requested).toEqual([page(base, "*"), detail(8)]);
    expect(result.works.map((w) => w.id)).toEqual(["W8"]);
  });

  it("S22: nothing matching is no draw and no request for works, and a page that ends the list by an empty cursor, an empty page or no cursor ends the paging", async () => {
    const none = fakeClient(pages({ [INCLUDE]: [] }));
    const result = await sampleWorks(none.client, { ...SPEC, exclude: undefined, method: "page" });
    expect(none.requested).toEqual([page(INCLUDE, "*")]);
    expect(result).toEqual({ method: "page", works: [], matched: 0, requests: 1, urls: [page(INCLUDE, "*")] });
    for (const last of [pageAnswer([1], ""), pageAnswer([], "cursor-2"), pageAnswer([1], null)]) {
      const { client, requested } = fakeClient((url) => (url.includes("filter=openalex:") ? worksAnswer([work(1)]) : last));
      const r = await sampleWorks(client, { ...SPEC, exclude: undefined, method: "page" });
      expect(requested).toHaveLength(last.results.length === 0 ? 1 : 2);
      expect(r.matched).toBe(last.results.length);
    }
  });

  it("S23: matches that fill more pages than maxPages are an answer error, and a page with a work that has no W id is one too", async () => {
    const endless = fakeClient((url) => pageAnswer([Number(decodeURIComponent(url.split("cursor=")[1]!).replace(/\D/g, "") || "1")], "cursor-9"));
    const error = await sampleWorks(endless.client, { ...SPEC, exclude: undefined, method: "page", maxPages: 3 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenAlexError);
    expect((error as OpenAlexError).kind).toBe("answer");
    expect((error as OpenAlexError).message).toBe("The matching works fill more than 3 pages of 100");
    expect(endless.requested).toHaveLength(3);
    const noId = fakeClient(() => worksAnswer([{ id: "https://openalex.org/A5" }]));
    await expect(sampleWorks(noId.client, { ...SPEC, exclude: undefined, method: "page" })).rejects.toMatchObject({ kind: "answer", message: "A work in OpenAlex's answer has no W id" });
  });

  it("S24: the drawn works are the ones the detail request returns, oldest id first, and fewer of them is not an error", async () => {
    const { client } = fakeClient((url) => (url.includes("filter=openalex:") ? worksAnswer([work(5), work(1)]) : pageAnswer([1, 3, 5], null)));
    const result = await sampleWorks(client, { ...SPEC, exclude: undefined, n: 3, method: "page" });
    expect(result.works.map((w) => w.id)).toEqual(["W1", "W5"]);
    expect(result.matched).toBe(3);
  });
});

describe("choosing between the two ways", () => {
  const SPEC: SampleSpec = { from: "2026-06-29", to: "2026-09-27", scope: "all", n: 2, seed: 7, include: ["machine learning"] };
  const sampleRequest = (url: string) => url.includes("&sample=");
  const handler = (status: number) => (url: string): unknown => {
    if (sampleRequest(url)) throw new OpenAlexError("http", `HTTP ${status}`, url, status);
    if (url.includes("filter=openalex:")) return worksAnswer([work(1), work(2)]);
    return pageAnswer([1, 2], null);
  };

  it("S25: a 4xx from the sample request sends `auto` to the pages, whatever the 4xx, and the refused request is counted among the requests made", async () => {
    for (const status of [400, 401, 403, 404, 422, 499]) {
      const { client, requested } = fakeClient(handler(status));
      const result = await sampleWorks(client, SPEC);
      expect(result.method, String(status)).toBe("page");
      expect(sampleRequest(requested[0]!)).toBe(true);
      expect(result.urls).toEqual(requested);
      expect(result.requests).toBe(3);
    }
  });

  it("S26: a spent budget, a 5xx, no answer or a bad answer from the sample request is thrown as it is, with no fallback", async () => {
    const errors = [new OpenAlexBudgetError("u", 429), new OpenAlexBudgetError("u", 402), new OpenAlexError("http", "HTTP 500", "u", 500), new OpenAlexError("http", "HTTP 399", "u", 399),
      new OpenAlexError("network", "none", "u"), new OpenAlexError("answer", "bad", "u"), new TypeError("boom")];
    for (const e of errors) {
      const { client, requested } = fakeClient(() => {
        throw e;
      });
      await expect(sampleWorks(client, SPEC), e.message).rejects.toBe(e);
      expect(requested).toHaveLength(1);
    }
  });

  it("S27: `sample` never falls back, and `page` never asks for a sample", async () => {
    const refused = fakeClient(handler(400));
    await expect(sampleWorks(refused.client, { ...SPEC, method: "sample" })).rejects.toMatchObject({ kind: "http", status: 400 });
    expect(refused.requested).toHaveLength(1);
    const paged = fakeClient(handler(400));
    const result = await sampleWorks(paged.client, { ...SPEC, method: "page" });
    expect(paged.requested.some(sampleRequest)).toBe(false);
    expect(result.urls).toEqual(paged.requested);
    expect(result.requests).toBe(2);
  });

  it("S28: a budget that runs out while paging is thrown, not answered with something smaller", async () => {
    let n = 0;
    const { client } = fakeClient((url) => {
      if (sampleRequest(url)) throw new OpenAlexError("http", "HTTP 400", url, 400);
      n += 1;
      if (n === 2) throw new OpenAlexBudgetError(url, 429);
      return pageAnswer([n], "next");
    });
    await expect(sampleWorks(client, SPEC)).rejects.toBeInstanceOf(OpenAlexBudgetError);
  });

  it("S29: through the real client the page path's include pages cost 10 credits each and the detail request 1", async () => {
    const spec: SampleSpec = { ...SPEC, method: "page" };
    const filter = "from_publication_date:2026-06-29,to_publication_date:2026-09-27,type:article,has_abstract:true,title_and_abstract.search:%22machine%20learning%22";
    rig.serve(`https://api.openalex.org/works?filter=${filter}&per-page=100&select=id&cursor=*`, pageAnswer([1, 2], null));
    rig.serve("https://api.openalex.org/works?filter=openalex:W1|W2&per-page=100&select=id,doi,title,publication_date,abstract_inverted_index", worksAnswer([work(1), work(2)]));
    const client = rig.client();
    const result = await sampleWorks(client, spec);
    expect(result.works.map((w) => w.id)).toEqual(["W1", "W2"]);
    expect(client.stats()).toEqual({ requests: 2, cache_hits: 0, credits: 11 });
  });
});
