// Page snapshots (SPEC §4.11 "Where the types come from", §4.12 opening paragraph and step 1, §8.13): scripts/lib/snapshot.ts.
// What each row of the spec says is one test: the cache file and its key, what a draft cites and what of it is unseen or untyped,
// the article types read out of the HTML, the GET (its options, HTML only, a PDF and an error answer give no snapshot, a blocked host
// is never requested, a redirect into one fails the URL, the final URL is kept), rounds until every URL has been started, and the
// hashes the archive index gets. Cyber's tests/snapshot.test.ts at the fork commit 3ced1fb, adapted: its pack-only rule, its types,
// its `resolved` and its rounds are new here. Every request goes to a fake fetch, to a server on 127.0.0.1, to a stubbed global fetch
// or to `fixtures/feeds/`; no test touches the network.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/lib/config";
import type { FetchOptions, FetchResult, fetchFeed } from "@/lib/feeds/http";
import { htmlText, textSha256 } from "@/lib/html-text";
import { sha256Hex } from "@/lib/json";
import type { Evidence } from "@/lib/schema/misc";
import { normalizeUrl } from "@/lib/urls";
import {
  ARTICLE_TYPE_MAX, ARTICLE_TYPES_MAX, SNAPSHOT_HEADERS, SNAPSHOT_LIMITS, articleTypesOf, citedUntyped, citedUnseen, citedUrls,
  readSnapshot, snapshotFile, snapshotHashes, snapshotTargets, snapshotUrls, type Snapshot,
} from "@/scripts/lib/snapshot";
import { FEEDS_DIR, PAPER_URL } from "./helpers/ledger-seeds";

const config = loadConfig(path.join(__dirname, "..", "config"));

const NATURE = "https://www.nature.com/articles/s41586-019-ut-sample-0001";
const NATURE_DOI = "https://doi.org/10.1038/s41586-019-ut-sample-0001";
const PUBMED = "https://pubmed.ncbi.nlm.nih.gov/9990001/";
const ARXIV = "https://arxiv.org/abs/2901.99003";
const APS = "https://journals.aps.org/prl/abstract/10.1103/ut-sample-0001";
const PAGE = [
  "<!DOCTYPE html><html><head><title>Sample page</title><style>p { color: red }</style>",
  "<meta name=\"dc.type\" content=\"OriginalPaper\"><meta name=\"citation_article_type\" content=\"Research Article\"></head><body>",
  "<nav>Home Products Support</nav><header>Site header</header>",
  "<script>var sample = 1;</script>",
  "<article><h1>SAMPLE page</h1><p>Version 9.2 fixes the flaw; 3 products are affected.</p></article>",
  "<footer>Footer text</footer></body></html>",
].join("");
const PAGE_TEXT = "SAMPLE page Version 9.2 fixes the flaw; 3 products are affected.";
const AT = Date.parse("2026-11-20T01:00:00Z");
const NOW = () => AT;

const roots: string[] = [];
const tmpRoot = (): string => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "ut-snapshot-"));
  roots.push(r);
  return r;
};
const saved = process.env.UT_FIXTURE_FEEDS;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.UT_FIXTURE_FEEDS;
  else process.env.UT_FIXTURE_FEEDS = saved;
});
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const soon = (ms = 20_000): number => Date.now() + ms;

/** What fetchFeed() gives back for a page that answered. */
function answer(url: string, body: string | Buffer | null, extra: Partial<FetchResult> = {}): FetchResult {
  return {
    ok: true, status: 200, finalUrl: url, body: body === null ? null : Buffer.from(body), contentType: "text/html; charset=utf-8",
    error: null, detail: null, durationMs: 1, attempts: 1, ...extra,
  };
}

/** A fetch that answers each URL from `replies` (HTML 200 when it is not listed) and records every call. */
function fakeFetch(replies: Record<string, Partial<FetchResult> & { html?: string }> = {}) {
  const calls: { url: string; options: FetchOptions }[] = [];
  const fn = (async (url: string, options: FetchOptions = {}) => {
    calls.push({ url, options });
    const r = replies[url];
    if (r === undefined) return answer(url, PAGE);
    const { html, ...rest } = r;
    return answer(url, html ?? PAGE, rest);
  }) as typeof fetchFeed;
  return { calls, fn };
}

/** The config with the PLOS entry's `type_field` replaced (a CSS selector, a meta name), for the selector tests. */
function withTypeField(typeField: string): Pick<typeof config, "sourceTiers"> {
  const sourceTiers = structuredClone(config.sourceTiers);
  const plos = sourceTiers.publishers.find((p) => p.hosts.includes("journals.plos.org"));
  if (plos === undefined) throw new Error("the seed has no journals.plos.org entry");
  plos.type_field = typeField;
  return { sourceTiers };
}

const evidence = (o: Partial<Evidence> = {}): Evidence => ({ urls: [], fetched: [], texts: {}, seen_as: {}, types: {}, resolved: {}, ...o });
const meta = (name: string, content: string): string => `<meta name="${name}" content="${content}">`;
const pageWith = (...tags: string[]): string => `<html><head>${tags.join("")}</head><body><p>text</p></body></html>`;

describe("limits and the cache file", () => {
  it("L1 the limits are §4.12's: 15 s, 5 redirects, 3 MB, 6 at a time, 3 minutes a round; the headers are browser-like", () => {
    expect(SNAPSHOT_LIMITS).toEqual({ timeoutMs: 15_000, redirects: 5, maxBytes: 3 * 1024 * 1024, concurrency: 6, roundMs: 180_000 });
    expect(SNAPSHOT_HEADERS.accept).toBe("text/html,application/xhtml+xml;q=0.9,*/*;q=0.8");
    expect(SNAPSHOT_HEADERS.acceptLanguage).toBe("en-US,en;q=0.9");
    expect(ARTICLE_TYPES_MAX).toBe(8);
    expect(ARTICLE_TYPE_MAX).toBe(100);
  });

  it("L2 snapshotFile is cache/snapshots/<sha256 of the normalised URL>.json under the root", () => {
    const root = tmpRoot();
    const url = "https://www.nature.com/articles/s41586-019-ut-sample-0001?utm_source=x#frag";
    expect(snapshotFile(root, url)).toBe(path.join(root, "cache", "snapshots", `${sha256Hex(normalizeUrl(url))}.json`));
    expect(snapshotFile(root, url)).toBe(snapshotFile(root, NATURE));
    expect(snapshotFile(root, NATURE)).not.toBe(snapshotFile(root, `${NATURE}-2`));
    expect(path.basename(snapshotFile(root, NATURE))).toMatch(/^[0-9a-f]{64}\.json$/);
  });
});

describe("readSnapshot", () => {
  const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
    url: NATURE, final_url: NATURE, status: 200, fetched_at: "2026-11-20T09:00:00+08:00", content_type: "text/html", text_sha256: "a".repeat(64),
    article_types: ["Article"], text: "SAMPLE text.", ...over,
  });
  const put = (root: string, value: unknown, url = NATURE): void => {
    const file = snapshotFile(root, url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };

  it("R1 reads a stored snapshot back, matched on the normalised URL, and returns a copy", () => {
    const root = tmpRoot();
    put(root, snap());
    expect(readSnapshot(root, NATURE)).toEqual(snap());
    expect(readSnapshot(root, `${NATURE}#frag`)).toEqual(snap());
    const a = readSnapshot(root, NATURE)!;
    a.article_types.push("changed");
    expect(readSnapshot(root, NATURE)!.article_types).toEqual(["Article"]);
  });

  it("R2 is null when the file is absent, unreadable or not a snapshot", () => {
    const root = tmpRoot();
    expect(readSnapshot(root, NATURE)).toBeNull();
    put(root, "{not json");
    expect(readSnapshot(root, NATURE)).toBeNull();
    for (const bad of [null, [], "x", 3, {}, { ...snap(), status: "200" }, { ...snap(), status: 200.5 }, { ...snap(), text: 3 }, { ...snap(), fetched_at: null }]) {
      put(root, bad);
      expect(readSnapshot(root, NATURE)).toBeNull();
    }
  });

  it("R3 is null when the file belongs to another URL (a file moved or copied under the wrong name)", () => {
    const root = tmpRoot();
    put(root, snap({ url: `${NATURE}-other` }));
    expect(readSnapshot(root, NATURE)).toBeNull();
  });

  it("R4 a file with no article_types, or one that is no list of strings, reads as having none", () => {
    const root = tmpRoot();
    const { article_types: _gone, ...older } = snap();
    put(root, older);
    expect(readSnapshot(root, NATURE)?.article_types).toEqual([]);
    for (const bad of ["Article", [1, 2], ["Article", 3], null, { 0: "Article" }]) {
      put(root, { ...snap(), article_types: bad });
      expect(readSnapshot(root, NATURE)?.article_types).toEqual([]);
    }
  });
});

describe("citedUrls", () => {
  it("C1 lists the brief's sources, then the new findings' sources, then the corrections' source_url, each once as first stored", () => {
    const draft = {
      sources: [{ id: "a", url: "https://example.org/ut-sample/a#top" }, { id: "b", url: "https://example.org/ut-sample/b" }],
      new_findings: [
        { ref: "new-1", sources: [{ id: "s1", url: "https://example.org/ut-sample/c" }, { id: "s2", url: "https://www.example.org/ut-sample/a?utm_source=x" }] },
        { ref: "new-2", sources: [{ id: "s1", url: "https://example.org/ut-sample/d" }] },
      ],
      corrections: [{ source_url: "https://example.org/ut-sample/e" }, { source_url: null }, { source_url: "https://example.org/ut-sample/b#again" }],
    };
    expect(citedUrls(draft)).toEqual([
      "https://example.org/ut-sample/a#top", "https://example.org/ut-sample/b", "https://example.org/ut-sample/c",
      "https://example.org/ut-sample/d", "https://example.org/ut-sample/e",
    ]);
  });

  it("C2 reads unknown input without throwing: a part that is no list, and an entry with no string or only a blank URL, add nothing", () => {
    for (const d of [null, undefined, 3, "x", [], {}, { sources: "no" }, { sources: [null, 1, [], { url: 4 }, { url: "" }, { url: "  " }] }, { new_findings: [null, { sources: 3 }, { sources: [{}] }] }, { corrections: [{}, null, { source_url: 7 }] }]) {
      expect(citedUrls(d)).toEqual([]);
    }
  });

  it("C3 a blank or non-string URL is skipped, not a stop: later entries of the same list and of later lists are still read", () => {
    const A = "https://example.org/ut-sample/a";
    const B = "https://example.org/ut-sample/b";
    const C = "https://example.org/ut-sample/c";
    const d = { sources: [{ url: "" }, { url: 4 }, { url: A }], new_findings: [{ sources: [{ url: "  " }, { url: B }] }], corrections: [{ source_url: null }, { source_url: C }] };
    expect(citedUrls(d)).toEqual([A, B, C]);
  });
});

describe("citedUnseen", () => {
  const A = "https://example.org/ut-sample/a";
  const B = "https://example.org/ut-sample/b";
  const C = "https://example.org/ut-sample/c";
  const draft = { sources: [{ id: "s1", url: A }, { id: "s2", url: B }, { id: "s3", url: C }] };

  it("U1 every cited URL is unseen when there is no evidence", () => {
    expect(citedUnseen(draft, null)).toEqual([A, B, C]);
  });

  it("U2 a URL with a text is seen, one with an empty text or none is not, and each is listed as the draft stores it", () => {
    const ev = evidence({ texts: { [normalizeUrl(A)]: "A page text.", [normalizeUrl(B)]: "" } });
    expect(citedUnseen(draft, ev)).toEqual([B, C]);
  });

  it("U3 a text that is only the pack's counts as unseen until the URL has a snapshot (§4.12)", () => {
    const ev = evidence({
      texts: { [normalizeUrl(A)]: "The pack's abstract.", [normalizeUrl(B)]: "A fetched page.", [normalizeUrl(C)]: "The pack's abstract and the snapshot's text." },
      seen_as: { [normalizeUrl(A)]: "pack", [normalizeUrl(B)]: "fetched", [normalizeUrl(C)]: "pack" },
    });
    expect(citedUnseen(draft, ev)).toEqual([A, C]);
    expect(citedUnseen(draft, ev, [{ url: C }])).toEqual([A]);
    expect(citedUnseen(draft, ev, [{ url: `${C}#frag` }, { url: A }])).toEqual([]);
    expect(citedUnseen(draft, ev, [{ url: B }])).toEqual([A, C]);
  });

  it("U4 a pack-only text with no seen_as entry is not taken for the pack's (the key is the proof)", () => {
    const ev = evidence({ texts: { [normalizeUrl(A)]: "Some text." }, seen_as: {} });
    expect(citedUnseen({ sources: [{ url: A }] }, ev)).toEqual([]);
  });

  it("U5 reads unknown input without throwing", () => {
    for (const d of [null, undefined, 3, "x", {}, { sources: "no" }, { sources: [null, 1, []] }]) expect(citedUnseen(d, null)).toEqual([]);
  });
});

describe("citedUntyped", () => {
  const cited = (...urls: string[]) => ({ sources: urls.map((url, i) => ({ id: `s${i + 1}`, url })) });

  it("T1 a doi.org URL is untyped until the evidence holds its landing (`resolved`)", () => {
    expect(citedUntyped(cited(NATURE_DOI), null, config)).toEqual([NATURE_DOI]);
    expect(citedUntyped(cited(NATURE_DOI), evidence(), config)).toEqual([NATURE_DOI]);
    expect(citedUntyped(cited(NATURE_DOI), evidence({ resolved: { [normalizeUrl(NATURE_DOI)]: NATURE } }), config)).toEqual([]);
  });

  it("T2 a typed publisher's page and a PubMed record are untyped until the evidence holds at least one type for them", () => {
    const draft = cited(NATURE, PUBMED);
    expect(citedUntyped(draft, null, config)).toEqual([NATURE, PUBMED]);
    expect(citedUntyped(draft, evidence({ types: { [normalizeUrl(NATURE)]: [] } }), config)).toEqual([NATURE, PUBMED]);
    expect(citedUntyped(draft, evidence({ types: { [normalizeUrl(NATURE)]: ["Article"] } }), config)).toEqual([PUBMED]);
    expect(citedUntyped(draft, evidence({ types: { [normalizeUrl(NATURE)]: ["Article"], [normalizeUrl(PUBMED)]: ["Journal Article"] } }), config)).toEqual([]);
  });

  it("T3 a URL the type check ignores is never listed: a preprint server, a publisher with no type_field, a host on no entry", () => {
    expect(citedUntyped(cited(ARXIV, APS, "https://example.org/ut-sample/page", "ftp://example.org/x", "not a url"), null, config)).toEqual([]);
  });

  it("T4 a draft's own order and form are kept", () => {
    expect(citedUntyped(cited(PUBMED, `${NATURE}#frag`, NATURE_DOI), null, config)).toEqual([PUBMED, `${NATURE}#frag`, NATURE_DOI]);
  });
});

describe("snapshotTargets", () => {
  it("G1 is citedUnseen then citedUntyped, once for each normalised URL, in the draft's order, each as the draft stores it", () => {
    const draft = {
      sources: [{ id: "s1", url: ARXIV }, { id: "s2", url: "https://example.org/ut-sample/seen" }, { id: "s3", url: NATURE }, { id: "s4", url: NATURE_DOI }],
      new_findings: [{ sources: [{ id: "s1", url: `${NATURE}#frag` }, { id: "s2", url: PUBMED }] }],
    };
    const ev = evidence({
      texts: { [normalizeUrl("https://example.org/ut-sample/seen")]: "seen text", [normalizeUrl(NATURE)]: "page text", [normalizeUrl(PUBMED)]: "abstract" },
      seen_as: { [normalizeUrl("https://example.org/ut-sample/seen")]: "fetched", [normalizeUrl(NATURE)]: "fetched", [normalizeUrl(PUBMED)]: "fetched" },
    });
    // arxiv: unseen; the seen page: neither; Nature: seen but untyped; the DOI: untyped; the PubMed record: seen but untyped.
    expect(snapshotTargets(draft, ev, config)).toEqual([ARXIV, NATURE, NATURE_DOI, PUBMED]);
    // With no evidence at all every cited URL is a target.
    expect(snapshotTargets(draft, null, config)).toEqual([ARXIV, "https://example.org/ut-sample/seen", NATURE, NATURE_DOI, PUBMED]);
  });

  it("G2 a URL that has a snapshot already is no longer a pack-only text, and a typed, resolved one is left alone", () => {
    const draft = { sources: [{ id: "s1", url: NATURE }, { id: "s2", url: ARXIV }] };
    const ev = evidence({
      texts: { [normalizeUrl(NATURE)]: "x", [normalizeUrl(ARXIV)]: "abstract" },
      seen_as: { [normalizeUrl(NATURE)]: "pack", [normalizeUrl(ARXIV)]: "pack" },
      types: { [normalizeUrl(NATURE)]: ["Article"] },
    });
    expect(snapshotTargets(draft, ev, config)).toEqual([NATURE, ARXIV]);
    expect(snapshotTargets(draft, ev, config, [{ url: NATURE }])).toEqual([ARXIV]);
    expect(snapshotTargets(draft, ev, config, [{ url: NATURE }, { url: ARXIV }])).toEqual([]);
  });
});

describe("articleTypesOf", () => {
  it("A1 reads the content of the <meta> tag named by the entry's type_field, the name compared without case", () => {
    expect(articleTypesOf(pageWith(meta("citation_article_type", "Article")), PAPER_URL, config)).toEqual(["Article"]);
    expect(articleTypesOf(pageWith(meta("Citation_Article_Type", "Review")), PAPER_URL, config)).toEqual(["Review"]);
    expect(articleTypesOf(pageWith(meta("citation_title", "A title"), meta("description", "Article")), PAPER_URL, config)).toEqual([]);
    expect(articleTypesOf(pageWith(`<meta property="citation_article_type" content="Article">`), PAPER_URL, config)).toEqual([]);
    expect(articleTypesOf(pageWith(`<meta name="citation_article_type">`), PAPER_URL, config)).toEqual([]);
  });

  it("A2 each typed publisher's own field: Nature's and Springer's dc.type, PLOS's citation_article_type, and none for Science, which no GET reads (K1b)", () => {
    expect(articleTypesOf(pageWith(meta("dc.type", "BriefCommunication")), NATURE, config)).toEqual(["BriefCommunication"]);
    expect(articleTypesOf(pageWith(meta("dc.type", "OriginalPaper")), "https://link.springer.com/article/10.1007/ut-sample", config)).toEqual(["OriginalPaper"]);
    expect(articleTypesOf(pageWith(meta("citation_article_type", "Research Article")), PAPER_URL, config)).toEqual(["Research Article"]);
    expect(articleTypesOf(pageWith(meta("dc.type", "Research Article")), "https://www.science.org/doi/10.1126/science.ut-sample", config)).toEqual([]);
    expect(articleTypesOf(pageWith(meta("citation_article_type", "Research Article")), NATURE, config)).toEqual([]);
  });

  it("A3 the entry is the FINAL URL's: a doi.org page names nothing, the page it landed on does", () => {
    const html = pageWith(meta("dc.type", "OriginalPaper"));
    expect(articleTypesOf(html, NATURE_DOI, config)).toEqual([]);
    expect(articleTypesOf(html, NATURE, config)).toEqual(["OriginalPaper"]);
  });

  it("A4 is [] for a URL on no entry with a type_field", () => {
    const html = pageWith(meta("citation_article_type", "Article"), meta("dc.type", "Article"));
    for (const url of [ARXIV, APS, PUBMED, "https://example.org/ut-sample/x", "not a url", ""]) expect(articleTypesOf(html, url, config)).toEqual([]);
  });

  it("A5 keeps page order, each type once, white space collapsed, invisible characters removed, empty values dropped", () => {
    const html = pageWith(
      meta("citation_article_type", "  Research\n   Article "), meta("citation_article_type", "Review"), meta("citation_article_type", "Research Article"),
      meta("citation_article_type", ""), meta("citation_article_type", "   "), meta("citation_article_type", "Com​mentary"),
    );
    expect(articleTypesOf(html, PAPER_URL, config)).toEqual(["Research Article", "Review", "Commentary"]);
  });

  it("A6 cuts a type at ARTICLE_TYPE_MAX characters and keeps at most ARTICLE_TYPES_MAX of them (a page is data and cannot make a long list)", () => {
    const long = "a".repeat(ARTICLE_TYPE_MAX + 50);
    const cut = articleTypesOf(pageWith(meta("citation_article_type", long)), PAPER_URL, config);
    expect(cut).toEqual(["a".repeat(ARTICLE_TYPE_MAX)]);
    const many = pageWith(...Array.from({ length: 20 }, (_, i) => meta("citation_article_type", `Type ${i}`)));
    const got = articleTypesOf(many, PAPER_URL, config);
    expect(got).toHaveLength(ARTICLE_TYPES_MAX);
    expect(got).toEqual(Array.from({ length: ARTICLE_TYPES_MAX }, (_, i) => `Type ${i}`));
  });

  it("A7 a type_field that is a CSS selector reads the text of each element it matches", () => {
    const html = "<html><body><div class=\"article-type\"> News  &amp; Views </div><span class=\"article-type\">Preview</span><span class=\"other\">Article</span></body></html>";
    expect(articleTypesOf(html, PAPER_URL, withTypeField(".article-type"))).toEqual(["News & Views", "Preview"]);
    expect(articleTypesOf(html, PAPER_URL, withTypeField("body > span.other"))).toEqual(["Article"]);
    expect(articleTypesOf(html, PAPER_URL, withTypeField(".absent"))).toEqual([]);
  });

  it("A8 a selector that does not parse gives [] (a page and a config can never make the step throw)", () => {
    expect(articleTypesOf("<p>x</p>", PAPER_URL, withTypeField(".a >> [b"))).toEqual([]);
  });
});

describe("snapshotUrls", () => {
  it("S1 requests each URL exactly as given with §4.12's options: headers, user agent, 15 s, 3 MB cut, the deadline, a refusal of blocked redirects", async () => {
    const f = fakeFetch();
    const deadline = soon();
    const r = await snapshotUrls({ root: tmpRoot(), urls: [`${NATURE}#frag`], deadline, config, fetch: f.fn });
    expect(r.failed).toEqual([]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(`${NATURE}#frag`);
    const o = f.calls[0]!.options;
    expect(o).toMatchObject({
      accept: SNAPSHOT_HEADERS.accept, acceptLanguage: SNAPSHOT_HEADERS.acceptLanguage, userAgent: config.run.user_agent,
      timeoutMs: SNAPSHOT_LIMITS.timeoutMs, maxBytes: SNAPSHOT_LIMITS.maxBytes, truncate: true, deadline,
    });
    // The blocked-host test is the redirect guard: a reason for a blocked hop, null for any other.
    expect(typeof o.refuseRedirect).toBe("function");
    expect(o.refuseRedirect!("https://web.archive.org/web/2026/https://example.org/x")).toEqual(expect.any(String));
    expect(o.refuseRedirect!("https://sample.onion/x")).toEqual(expect.any(String));
    expect(o.refuseRedirect!("https://example.org/ut-sample/fine")).toBeNull();
  });

  it("S2 turns HTML into text (script, style, nav, header and footer dropped), stores every field, and returns it", async () => {
    const root = tmpRoot();
    const f = fakeFetch();
    const r = await snapshotUrls({ root, urls: [NATURE], deadline: soon(), config, fetch: f.fn, now: NOW });
    expect(r.failed).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.resolved).toEqual({});
    expect(r.taken).toHaveLength(1);
    const s = r.taken[0]!;
    expect(s.text).toBe(PAGE_TEXT);
    expect(s.text).toBe(htmlText(PAGE));
    for (const gone of ["var sample", "Home Products", "Site header", "Footer text", "color"]) expect(s.text).not.toContain(gone);
    expect(s).toEqual({
      url: NATURE, final_url: NATURE, status: 200, fetched_at: "2026-11-20T09:00:00+08:00", content_type: "text/html; charset=utf-8",
      text_sha256: textSha256(PAGE_TEXT), article_types: ["OriginalPaper"], text: PAGE_TEXT,
    });
    // The file is the same object, with its keys in this order, under the hash of the normalised URL.
    const file = snapshotFile(root, NATURE);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(s);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")) as object)).toEqual([
      "url", "final_url", "status", "fetched_at", "content_type", "text_sha256", "article_types", "text",
    ]);
    expect(readSnapshot(root, NATURE)).toEqual(s);
    expect(readSnapshot(root, `${NATURE}?utm_source=x`)).toEqual(s);
  });

  it("S3 writes the file atomically: no temporary file is left in the folder", async () => {
    const root = tmpRoot();
    await snapshotUrls({ root, urls: [NATURE, ARXIV], deadline: soon(), config, fetch: fakeFetch().fn });
    const names = fs.readdirSync(path.join(root, "cache", "snapshots"));
    expect(names).toHaveLength(2);
    for (const n of names) expect(n).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it("S4 stores the article types the FINAL URL's entry finds, even when the URL asked for was a doi.org one", async () => {
    const f = fakeFetch({ [NATURE_DOI]: { finalUrl: NATURE, html: pageWith(meta("dc.type", "ReviewPaper")) } });
    const r = await snapshotUrls({ root: tmpRoot(), urls: [NATURE_DOI], deadline: soon(), config, fetch: f.fn });
    expect(r.taken.map((s) => [s.url, s.final_url, s.article_types])).toEqual([[NATURE_DOI, NATURE, ["ReviewPaper"]]]);
    expect(r.resolved).toEqual({ [normalizeUrl(NATURE_DOI)]: NATURE });
  });

  it("S5 a page with no type_field on its entry has no article types, and a page whose tag is absent has none", async () => {
    const f = fakeFetch({ [NATURE]: { html: "<html><body><p>No tag here.</p></body></html>" } });
    const r = await snapshotUrls({ root: tmpRoot(), urls: [ARXIV, NATURE], deadline: soon(), config, fetch: f.fn });
    expect(r.taken.map((s) => [s.url, s.article_types])).toEqual([[ARXIV, []], [NATURE, []]]);
  });

  it("S6 takes HTML and XHTML, and sniffs a body with no Content-Type; any other type, or an unsniffable body, is no snapshot", async () => {
    const urls = ["https://example.org/ut-sample/html", "https://example.org/ut-sample/xhtml", "https://example.org/ut-sample/sniffed", "https://example.org/ut-sample/sniffed-tag",
      "https://example.org/ut-sample/plain", "https://example.org/ut-sample/pdf", "https://example.org/ut-sample/json", "https://example.org/ut-sample/unsniffable"];
    const f = fakeFetch({
      [urls[0]!]: { contentType: "TEXT/HTML" },
      [urls[1]!]: { contentType: "application/xhtml+xml; charset=utf-8" },
      [urls[2]!]: { contentType: null, html: "  <!DOCTYPE html><p>sniffed</p>" },
      [urls[3]!]: { contentType: null, html: "<html lang=en><body><p>sniffed tag</p></body></html>" },
      [urls[4]!]: { contentType: "text/plain", html: "<p>plain</p>" },
      [urls[5]!]: { contentType: "application/pdf", html: "%PDF-1.7 sample" },
      [urls[6]!]: { contentType: "application/json", html: "{\"a\":1}" },
      [urls[7]!]: { contentType: null, html: "just words, no markup" },
    });
    const root = tmpRoot();
    const lines: string[] = [];
    const r = await snapshotUrls({ root, urls, deadline: soon(), config, fetch: f.fn, log: (l) => lines.push(l) });
    expect(r.taken.map((s) => s.url)).toEqual(urls.slice(0, 4));
    expect(r.taken[2]!.content_type).toBe("text/html");
    expect(r.failed).toEqual(urls.slice(4));
    for (const u of urls.slice(4)) expect(fs.existsSync(snapshotFile(root, u))).toBe(false);
    expect(lines.filter((l) => l.includes("is not HTML"))).toHaveLength(4);
  });

  it("S6c a body sniffed as HTML under an empty Content-Type header is stored as text/html, the same as one with no header", async () => {
    const empty = "https://example.org/ut-sample/sniff-empty-type";
    const f = fakeFetch({ [empty]: { contentType: "", html: "<!doctype html><p>empty header</p>" } });
    const r = await snapshotUrls({ root: tmpRoot(), urls: [empty], deadline: soon(), config, fetch: f.fn });
    expect(r.taken.map((s) => [s.url, s.content_type])).toEqual([[empty, "text/html"]]);
  });

  it("S6b the sniff reads the first 512 bytes only: a tag that ends at byte 512 counts, one that needs byte 513 does not", async () => {
    const inside = "https://example.org/ut-sample/sniff-inside";
    const outside = "https://example.org/ut-sample/sniff-outside";
    const f = fakeFetch({
      [inside]: { contentType: null, html: `${" ".repeat(506)}<html>` }, // "<html>" fills bytes 507 to 512
      [outside]: { contentType: null, html: `${" ".repeat(507)}<html>` }, // its ">" is byte 513
    });
    const r = await snapshotUrls({ root: tmpRoot(), urls: [inside, outside], deadline: soon(), config, fetch: f.fn });
    expect(r.taken.map((s) => s.url)).toEqual([inside]);
    expect(r.failed).toEqual([outside]);
  });

  it("S7 a PDF gets no snapshot even when its body would read as text (§4.12)", async () => {
    const f = fakeFetch({ [PAPER_URL]: { contentType: "application/pdf" } });
    const root = tmpRoot();
    const r = await snapshotUrls({ root, urls: [PAPER_URL], deadline: soon(), config, fetch: f.fn });
    expect(r).toEqual({ taken: [], failed: [PAPER_URL], skipped: [], resolved: {} });
    expect(fs.existsSync(snapshotFile(root, PAPER_URL))).toBe(false);
  });

  it("S8 an error answer, a fetch error and a result with no body or no status each fail the URL and write nothing", async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://example.org/ut-sample/bad-${i}`);
    const f = fakeFetch({
      [urls[0]!]: { ok: false, status: 404, error: "http_404" },
      [urls[1]!]: { ok: false, status: null, body: null, error: "dns" },
      [urls[2]!]: { ok: true, status: 200, body: null },
      [urls[3]!]: { ok: true, status: null },
      [urls[4]!]: { ok: false, status: 503, error: "http_503" },
    });
    const root = tmpRoot();
    const lines: string[] = [];
    const r = await snapshotUrls({ root, urls, deadline: soon(), config, fetch: f.fn, log: (l) => lines.push(l) });
    expect(r.taken).toEqual([]);
    expect(r.failed).toEqual(urls);
    expect(r.skipped).toEqual([]);
    expect(fs.existsSync(path.join(root, "cache", "snapshots"))).toBe(false);
    expect(lines).toContain(`snapshot: ${urls[0]} not read (http_404, HTTP 404).`);
    expect(lines).toContain(`snapshot: ${urls[1]} not read (dns).`);
  });

  it("S9 `resolved` holds the final URL of every URL started whose final URL differs, read or not (a doi.org landing that answered an error counts)", async () => {
    const same = "https://example.org/ut-sample/same";
    const moved = "https://example.org/ut-sample/moved";
    const f = fakeFetch({
      [NATURE_DOI]: { finalUrl: NATURE },
      [same]: { finalUrl: `${same}?utm_source=x#frag` },
      [moved]: { finalUrl: "https://www.example.org/ut-sample/landing-gone", ok: false, status: 404, error: "http_404" },
      [PUBMED]: { finalUrl: PUBMED },
    });
    const r = await snapshotUrls({ root: tmpRoot(), urls: [NATURE_DOI, same, moved, PUBMED], deadline: soon(), config, fetch: f.fn });
    expect(r.taken.map((s) => s.url)).toEqual([NATURE_DOI, same, PUBMED]);
    expect(r.failed).toEqual([moved]);
    expect(r.resolved).toEqual({ [normalizeUrl(NATURE_DOI)]: NATURE, [normalizeUrl(moved)]: "https://www.example.org/ut-sample/landing-gone" });
  });

  it("S10 a charset the Content-Type names is used, and an unknown one reads as UTF-8", async () => {
    const latin = Buffer.from("<html><body><p>café SAMPLE</p></body></html>", "latin1");
    const u1 = "https://example.org/ut-sample/latin";
    const u2 = "https://example.org/ut-sample/unknown-charset";
    const f = fakeFetch({
      [u1]: { html: latin as unknown as string, contentType: "text/html; charset=iso-8859-1" },
      [u2]: { html: "<html><body><p>café SAMPLE</p></body></html>", contentType: "text/html; charset=no-such-charset" },
    });
    const r = await snapshotUrls({ root: tmpRoot(), urls: [u1, u2], deadline: soon(), config, fetch: f.fn });
    expect(r.taken.map((s) => s.text)).toEqual(["café SAMPLE", "café SAMPLE"]);
  });

  it("S11 never requests a blocked host or a URL that is not http(s), a repeat of a normalised URL, or one that does not parse; each is skipped as given", async () => {
    const blocked = ["https://pastebin.com/ut-sample", "https://www.gist.github.com/ut-sample", "https://web.archive.org/web/2026/https://example.org/x", "https://sample.onion/x"];
    const odd = ["ftp://example.org/ut-sample/file", "mailto:a@example.org", "not a url", "javascript:alert(1)"];
    const ok = "https://example.org/ut-sample/page";
    const repeat = "https://www.example.org/ut-sample/page?utm_source=x#frag";
    const f = fakeFetch();
    const lines: string[] = [];
    const r = await snapshotUrls({ root: tmpRoot(), urls: [...blocked, ...odd, ok, repeat], deadline: soon(), config, fetch: f.fn, log: (l) => lines.push(l) });
    expect(f.calls.map((c) => c.url)).toEqual([ok]);
    expect(r.taken.map((s) => s.url)).toEqual([ok]);
    expect(r.skipped).toEqual([...blocked, ...odd, repeat]);
    expect(r.failed).toEqual([]);
    expect(lines.filter((l) => l.startsWith("snapshot: skipped a blocked host")).length).toBe(blocked.length);
    // A blocked host's address is never written to the log.
    expect(lines.every((l) => !/pastebin|gist|archive\.org|onion/.test(l))).toBe(true);
  });

  it("S12 a blocked or non-http(s) URL is never retried, even when rounds run until every URL has been started", async () => {
    const f = fakeFetch();
    const r = await snapshotUrls({ root: tmpRoot(), urls: ["https://pastebin.com/ut-sample", "ftp://example.org/x", NATURE], deadline: soon(), roundMs: 50, config, fetch: f.fn });
    expect(f.calls.map((c) => c.url)).toEqual([NATURE]);
    expect(r.skipped).toEqual(["https://pastebin.com/ut-sample", "ftp://example.org/x"]);
  });

  it("S13 with no deadline left nothing starts and every URL is skipped", async () => {
    const f = fakeFetch();
    const urls = [NATURE, ARXIV];
    const r = await snapshotUrls({ root: tmpRoot(), urls, deadline: Date.now() - 1, config, fetch: f.fn });
    expect(f.calls).toEqual([]);
    expect(r).toEqual({ taken: [], failed: [], skipped: urls, resolved: {} });
    const withRounds = await snapshotUrls({ root: tmpRoot(), urls, deadline: Date.now() - 1, roundMs: 1_000, config, fetch: f.fn });
    expect(f.calls).toEqual([]);
    expect(withRounds.skipped).toEqual(urls);
  });

  it("S14 requests at most 6 at a time", async () => {
    let inFlight = 0;
    let max = 0;
    const fn = (async (url: string) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight--;
      return answer(url, PAGE);
    }) as typeof fetchFeed;
    const urls = Array.from({ length: 15 }, (_, k) => `https://example.org/ut-sample/slow-${k}`);
    const r = await snapshotUrls({ root: tmpRoot(), urls, deadline: soon(), config, fetch: fn });
    expect(r.taken).toHaveLength(15);
    expect(max).toBe(SNAPSHOT_LIMITS.concurrency);
  });

  it("S15 in one round (no roundMs) a URL not started before the deadline is skipped, and the log says how many", async () => {
    // A clock that moves 100 ms with every request: the deadline falls after the third.
    let t = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const fn = (async (url: string) => {
      t += 100;
      return answer(url, PAGE);
    }) as typeof fetchFeed;
    const urls = Array.from({ length: 8 }, (_, k) => `https://example.org/ut-sample/n-${k}`);
    const lines: string[] = [];
    const r = await snapshotUrls({ root: tmpRoot(), urls, deadline: 1_000_250, config, fetch: fn, log: (l) => lines.push(l) });
    expect(r.taken.map((s) => s.url)).toEqual(urls.slice(0, 3));
    expect(r.skipped).toEqual(urls.slice(3));
    expect(r.failed).toEqual([]);
    expect(lines).toContain("snapshot: 5 URLs not started before the round's deadline.");
  });

  it("S16 with roundMs a URL not started in a round starts in the next one, until every URL has been started", async () => {
    let t = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const asked: string[] = [];
    const fn = (async (url: string) => {
      asked.push(url);
      t += 100;
      return answer(url, PAGE);
    }) as typeof fetchFeed;
    const urls = Array.from({ length: 10 }, (_, k) => `https://example.org/ut-sample/round-${k}`);
    const lines: string[] = [];
    const r = await snapshotUrls({ root: tmpRoot(), urls, deadline: Number.POSITIVE_INFINITY, roundMs: 350, config, fetch: fn, log: (l) => lines.push(l) });
    expect(r.taken.map((s) => s.url).sort()).toEqual([...urls].sort());
    expect(r.skipped).toEqual([]);
    expect(r.failed).toEqual([]);
    // Every URL was requested exactly once.
    expect([...asked].sort()).toEqual([...urls].sort());
    // Rounds of four requests each (350 ms at 100 ms a request): 10 URLs take three rounds, so two "not started" lines.
    expect(lines.filter((l) => l.includes("not started before the round's deadline"))).toEqual([
      "snapshot: 6 URLs not started before the round's deadline.",
      "snapshot: 2 URLs not started before the round's deadline.",
    ]);
  });

  it("S16b a request is cut by the call's own deadline and never by the end of its round: a URL started late in a round keeps its time", async () => {
    let t = 7_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const f = fakeFetch();
    const fn = (async (url: string, options: FetchOptions = {}) => {
      t += 100;
      return f.fn(url, options);
    }) as typeof fetchFeed;
    const urls = Array.from({ length: 6 }, (_, k) => `https://example.org/ut-sample/late-${k}`);
    const r = await snapshotUrls({ root: tmpRoot(), urls, deadline: 7_100_000, roundMs: 250, config, fetch: fn });
    expect(r.taken).toHaveLength(6);
    expect(f.calls.map((c) => c.options.deadline)).toEqual(urls.map(() => 7_100_000));
  });

  it("S17 with roundMs the overall deadline still ends the run: URLs not started by then are skipped", async () => {
    let t = 9_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const fn = (async (url: string) => {
      t += 100;
      return answer(url, PAGE);
    }) as typeof fetchFeed;
    const urls = Array.from({ length: 10 }, (_, k) => `https://example.org/ut-sample/end-${k}`);
    const r = await snapshotUrls({ root: tmpRoot(), urls, deadline: 9_000_700, roundMs: 350, config, fetch: fn });
    expect(r.taken).toHaveLength(7);
    expect(r.skipped).toHaveLength(3);
    expect(new Set([...r.taken.map((s) => s.url), ...r.skipped])).toEqual(new Set(urls));
  });

  it("S18 a roundMs of 0 or less, or not a number, is a RangeError before any request", async () => {
    const f = fakeFetch();
    for (const roundMs of [0, -1, Number.NaN]) {
      await expect(snapshotUrls({ root: tmpRoot(), urls: [NATURE], deadline: soon(), roundMs, config, fetch: f.fn })).rejects.toThrow(RangeError);
    }
    expect(f.calls).toEqual([]);
  });

  it("S18b any roundMs above 0 is accepted, a fraction of a millisecond included", async () => {
    const f = fakeFetch();
    const r = await snapshotUrls({ root: tmpRoot(), urls: [NATURE], deadline: soon(), roundMs: 0.5, config, fetch: f.fn });
    expect(r.taken.map((s) => s.url)).toEqual([NATURE]);
    expect(r.skipped).toEqual([]);
  });

  it("S19 a failed round URL is not retried in a later round (it was started)", async () => {
    let t = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const calls: string[] = [];
    const fn = (async (url: string) => {
      calls.push(url);
      t += 100;
      return url.endsWith("-1") ? answer(url, null, { ok: false, status: 500, error: "http_500", body: null }) : answer(url, PAGE);
    }) as typeof fetchFeed;
    const urls = Array.from({ length: 6 }, (_, k) => `https://example.org/ut-sample/f-${k}`);
    const r = await snapshotUrls({ root: tmpRoot(), urls, deadline: Number.POSITIVE_INFINITY, roundMs: 250, config, fetch: fn });
    expect(calls.sort()).toEqual([...urls].sort());
    expect(r.failed).toEqual([urls[1]]);
    expect(r.taken).toHaveLength(5);
  });
});

describe("snapshotUrls in fixture mode (fixtures/feeds/)", () => {
  it("F1 answers a real publisher's URL from its saved page and finds its article type", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const root = tmpRoot();
    const r = await snapshotUrls({ root, urls: [PAPER_URL], deadline: soon(), config, now: NOW });
    expect(r.failed).toEqual([]);
    const s = r.taken[0]!;
    expect(s.url).toBe(PAPER_URL);
    expect(s.final_url).toBe(PAPER_URL);
    expect(s.article_types).toEqual(["Research Article"]);
    expect(s.fetched_at).toBe("2026-11-20T09:00:00+08:00");
    expect(s.text).toContain("antibiotic");
    expect(s.text_sha256).toBe(textSha256(s.text));
  });

  it("F2 an error entry and a PDF entry give no snapshot, and a URL not in the index fails too", async () => {
    process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
    const urls = ["https://www.cell.com/cell/abstract/ut-sample-ledger-missing", "https://www.cell.com/cell/pdf/ut-sample-ledger-0001.pdf", "https://www.cell.com/cell/abstract/ut-sample-ledger-not-saved"];
    const root = tmpRoot();
    const r = await snapshotUrls({ root, urls, deadline: soon(), config });
    expect(r).toEqual({ taken: [], failed: urls, skipped: [], resolved: {} });
    for (const u of urls) expect(fs.existsSync(snapshotFile(root, u))).toBe(false);
  });

  it("F3 requests the URL exactly as cited, and stores it under the hash of the normalised one", async () => {
    const dir = tmpRoot();
    const url = "https://www.cell.com/cell/abstract/ut-sample-fragment#section-2";
    fs.writeFileSync(path.join(dir, "page.html"), "<html><body><article><p>SAMPLE fragment page text.</p></article></body></html>");
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ [url]: { file: "page.html", content_type: "text/html; charset=utf-8" } }));
    process.env.UT_FIXTURE_FEEDS = dir;
    const root = tmpRoot();
    const r = await snapshotUrls({ root, urls: [url], deadline: soon(), config });
    expect(r.taken.map((s) => [s.url, s.text])).toEqual([[url, "SAMPLE fragment page text."]]);
    expect(snapshotFile(root, url)).toBe(snapshotFile(root, "https://www.cell.com/cell/abstract/ut-sample-fragment"));
    expect(readSnapshot(root, "https://www.cell.com/cell/abstract/ut-sample-fragment")?.url).toBe(url);
    // The normalised form is not in the fixture index: requesting it instead would have failed.
    const other = await snapshotUrls({ root: tmpRoot(), urls: [normalizeUrl(url)], deadline: soon(), config });
    expect(other.failed).toEqual([normalizeUrl(url)]);
  });
});

describe("snapshotUrls through the real fetchFeed()", () => {
  let server: http.Server;
  let base = "";
  let inFlight = 0;
  let maxInFlight = 0;
  const seen: { url: string; headers: http.IncomingHttpHeaders }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      seen.push({ url, headers: req.headers });
      if (url.startsWith("/page")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(PAGE);
        return;
      }
      if (url.startsWith("/cut")) {
        // A marker 64 KiB past the 3 MB cut, behind a script the text drops: read whole, the text would end with it.
        res.writeHead(200, { "Content-Type": "text/html" });
        const head = "<html><body><main><p>SAMPLE start of the page</p><script>";
        res.write(head);
        const filler = "x".repeat(64 * 1024);
        for (let n = 0; n < Math.ceil((SNAPSHOT_LIMITS.maxBytes + 64 * 1024 - head.length) / filler.length); n++) res.write(filler);
        res.end("</script><p>SAMPLE text after the cut</p></main></body></html>");
        return;
      }
      if (url.startsWith("/pdf")) {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end("%PDF-1.7 sample");
        return;
      }
      if (url.startsWith("/missing")) {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<p>Not found</p>");
        return;
      }
      if (url.startsWith("/slow")) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight--;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<p>slow ${url}</p>`);
        }, 60);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<p>ok</p>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  afterEach(() => {
    seen.length = 0;
    inFlight = 0;
    maxInFlight = 0;
  });

  it("H1 sends the browser-like Accept and Accept-Language and the honest user agent, and the text is the page's", async () => {
    delete process.env.UT_FIXTURE_FEEDS;
    const r = await snapshotUrls({ root: tmpRoot(), urls: [`${base}/page`], deadline: soon(), config });
    expect(r.failed).toEqual([]);
    expect(r.taken.map((s) => s.text)).toEqual([PAGE_TEXT]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers).toMatchObject({ accept: SNAPSHOT_HEADERS.accept, "accept-language": SNAPSHOT_HEADERS.acceptLanguage, "user-agent": config.run.user_agent });
  });

  it("H2 reads no byte past 3 MB, and still takes the snapshot of a longer page", async () => {
    delete process.env.UT_FIXTURE_FEEDS;
    const r = await snapshotUrls({ root: tmpRoot(), urls: [`${base}/cut`], deadline: soon(), config });
    expect(r.failed).toEqual([]);
    expect(r.taken.map((s) => s.text)).toEqual(["SAMPLE start of the page"]);
  });

  it("H3 a PDF and an error answer give no snapshot", async () => {
    delete process.env.UT_FIXTURE_FEEDS;
    const root = tmpRoot();
    const urls = [`${base}/pdf`, `${base}/missing`];
    const r = await snapshotUrls({ root, urls, deadline: soon(), config });
    expect(r).toEqual({ taken: [], failed: urls, skipped: [], resolved: {} });
    for (const u of urls) expect(fs.existsSync(snapshotFile(root, u))).toBe(false);
  });

  it("H4 runs at most 6 requests at a time", async () => {
    delete process.env.UT_FIXTURE_FEEDS;
    const urls = Array.from({ length: 15 }, (_, k) => `${base}/slow?k=${k}`);
    const r = await snapshotUrls({ root: tmpRoot(), urls, deadline: soon(), config });
    expect(r.taken).toHaveLength(15);
    expect(maxInFlight).toBe(SNAPSHOT_LIMITS.concurrency);
  });

  it("H5 fails a URL after more than 5 redirects, and keeps the last URL in `resolved`", async () => {
    delete process.env.UT_FIXTURE_FEEDS;
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      calls++;
      const n = Number(new URL(url).searchParams.get("n") ?? "0");
      return new Response(null, { status: 301, headers: { location: `https://example.org/ut-sample/hop?n=${n + 1}` } });
    });
    const root = tmpRoot();
    const url = "https://example.org/ut-sample/hop?n=0";
    const r = await snapshotUrls({ root, urls: [url], deadline: soon(), config });
    expect(r.taken).toEqual([]);
    expect(r.failed).toEqual([url]);
    expect(calls).toBe(6);
    expect(fs.existsSync(snapshotFile(root, url))).toBe(false);
  });

  it("H6 follows up to 5 redirects, records the final URL as the snapshot's `final_url` and in `resolved`", async () => {
    delete process.env.UT_FIXTURE_FEEDS;
    vi.stubGlobal("fetch", async (url: string) => {
      const n = Number(new URL(url).searchParams.get("n") ?? "0");
      if (n === 5) return new Response("<p>arrived</p>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response(null, { status: 302, headers: { location: `https://example.org/ut-sample/hop?n=${n + 1}` } });
    });
    const url = "https://example.org/ut-sample/hop?n=0";
    const r = await snapshotUrls({ root: tmpRoot(), urls: [url], deadline: soon(), config });
    expect(r.taken.map((s) => [s.final_url, s.text])).toEqual([["https://example.org/ut-sample/hop?n=5", "arrived"]]);
    expect(r.resolved).toEqual({ [normalizeUrl(url)]: "https://example.org/ut-sample/hop?n=5" });
  });

  it("H7 follows no redirect into a blocked host: the hop is never requested and the URL fails", async () => {
    delete process.env.UT_FIXTURE_FEEDS;
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      if (url.endsWith("/hop")) return new Response(null, { status: 301, headers: { location: "https://web.archive.org/web/2026/https://example.org/x" } });
      if (url.endsWith("/hop-sub")) return new Response(null, { status: 302, headers: { location: "https://sample.onion/x" } });
      return new Response("<p>blocked page text</p>", { status: 200, headers: { "content-type": "text/html" } });
    });
    const root = tmpRoot();
    const urls = ["https://example.org/ut-sample/hop", "https://example.org/ut-sample/hop-sub"];
    const lines: string[] = [];
    const r = await snapshotUrls({ root, urls, deadline: soon(), config, log: (l) => lines.push(l) });
    expect(asked).toEqual(urls);
    expect(r.taken).toEqual([]);
    expect(r.failed).toEqual(urls);
    for (const u of urls) expect(fs.existsSync(snapshotFile(root, u))).toBe(false);
    expect(lines.every((l) => !l.includes("archive.org") && !l.includes("onion"))).toBe(true);
    expect(lines.filter((l) => l.includes("not read (redirects, HTTP 30"))).toHaveLength(2);
  });
});

describe("snapshotHashes", () => {
  const snap = (url: string, sha: string, at: string): Snapshot => ({
    url, final_url: url, status: 200, fetched_at: at, content_type: "text/html", text_sha256: sha, article_types: [], text: "t",
  });

  it("H1 maps each normalised URL to its text hash and fetch time; a later snapshot of a URL wins", () => {
    expect(snapshotHashes([])).toEqual({});
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const c = "c".repeat(64);
    const out = snapshotHashes([
      snap(`${NATURE}#frag`, a, "2026-11-20T09:00:00+08:00"), snap(ARXIV, b, "2026-11-20T09:01:00+08:00"), snap(`${NATURE}?utm_source=x`, c, "2026-11-21T09:00:00+08:00"),
    ]);
    expect(out).toEqual({
      [normalizeUrl(NATURE)]: { sha256: c, fetched_at: "2026-11-21T09:00:00+08:00" },
      [normalizeUrl(ARXIV)]: { sha256: b, fetched_at: "2026-11-20T09:01:00+08:00" },
    });
    expect(Object.keys(out)).toEqual([normalizeUrl(NATURE), normalizeUrl(ARXIV)]);
  });
});
