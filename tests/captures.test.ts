// The capture tool and the saved captures (SPEC §4.12, §8.10; fixtures/src/scrub-feed.ts): what the scrubber keeps, replaces and refuses for each of its six
// kinds, and that its output still reads through the production readers; the namespace list held equal to tests/fixture-safety.test.ts's; and the
// command line. Every input is hand-made in the real format with invented prose and ids (no real person, paper or page); nothing reaches a host.
// There are no live captures yet (Kobol's K1e makes them, SPEC §10 P2 step 2): the folder fixtures/feeds/live/ may be absent, and when it is present each
// file in it must be named after a registry id and read through its reader, which the last block checks. New for this project; the layout of the cases
// follows Cyber's tests/captures.test.ts and the scrubber's own cases at the fork commit 3ced1fb, adapted.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { parseArxivEntries } from "@/lib/feeds/arxiv";
import { fetchFeed } from "@/lib/feeds/http";
import { byCodeUnit } from "@/lib/ids";
import { blockedEntry } from "@/lib/urls";
import {
  IdMap, LinkRewriter, NAMESPACE_PREFIXES, isInvented, SAMPLE_LINK_HOST, SCRUB_ITEMS_MAX, SCRUB_KINDS, ScrubRefused, parseCsv, scrubCsv, scrubFeed, scrubHtml, scrubJson, scrubOptionsFor, unsafeUrls, main as scrubMain,
  type ScrubKind, type ScrubOptions,
} from "../fixtures/src/scrub-feed";
import { feedCtx, parseCrossrefWorks, parseRetractionWatch, readFeed } from "../scripts/lib/feeds";
import { FEEDS_DIR, ROOT, answer, feedEntry, fixtureRun, realConfig, removeTempDirs, tempDir } from "./helpers/feed-bodies";

afterAll(() => removeTempDirs());

const options = scrubOptionsFor(realConfig());
const scrub = (kind: ScrubKind, body: string | Buffer, o: ScrubOptions = options): string => scrubFeed(kind, Buffer.from(body), o).toString("utf8");
const URL_RE = /\bhttps?:\/\/[^\s"'<>\\)\]]+/g;
const urlsIn = (text: string): string[] => text.match(URL_RE) ?? [];
/** A refusal's addresses, or null when the scrub went through. */
const refusal = (kind: ScrubKind, body: string): string[] | null => {
  try {
    scrubFeed(kind, Buffer.from(body), options);
    return null;
  } catch (e) {
    if (e instanceof ScrubRefused) return e.urls;
    throw e;
  }
};

// ── The inputs: real shapes, invented text ───────────────────────────────────────────────────────

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel rdf:about="https://www.nature.com/nature.rss">
    <title>Nature</title>
    <link>https://www.nature.com/</link>
    <description>The weekly journal of the Invented Society</description>
    <items><rdf:Seq>
${Array.from({ length: 9 }, (_, i) => `      <rdf:li rdf:resource="https://www.nature.com/articles/s41586-026-1000${i}-1"/>`).join("\n")}
    </rdf:Seq></items>
  </channel>
${Array.from({ length: 9 }, (_, i) => `  <item rdf:about="https://www.nature.com/articles/s41586-026-1000${i}-1">
    <title>Jane Placeholder finds a machine learning route to a thing number ${i}</title>
    <link>https://www.nature.com/articles/s41586-026-1000${i}-1?utm_source=rss&amp;utm_medium=feed</link>
    <description>Contact jane.placeholder@university.example.edu. We train a neural network to find things.</description>
    <dc:creator>Jane Placeholder</dc:creator>
    <dc:date>2026-10-${String(10 + i).padStart(2, "0")}</dc:date>
    <prism:doi>10.1038/s41586-026-1000${i}-1</prism:doi>
    <dc:identifier>doi:10.1038/s41586-026-1000${i}-1</dc:identifier>
    <prism:publicationName>Nature</prism:publicationName>
  </item>`).join("\n")}
</rdf:RDF>
`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <id>https://arxiv.org/api/AbCdEfGh</id>
  <title>arXiv Query: search_query=cat:cs.LG</title>
  <updated>2026-10-21T00:00:00-04:00</updated>
  <opensearch:totalResults>2</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>2000</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2610.01234v2</id>
    <updated>2026-10-12T15:00:00Z</updated>
    <published>2026-10-12T15:00:00Z</published>
    <title>A deep learning study of invented lattices</title>
    <summary>We study invented lattices with a neural network and report a result.</summary>
    <author><name>Jane Placeholder</name><arxiv:affiliation>Invented University</arxiv:affiliation></author>
    <arxiv:doi>10.1000/real-looking-doi-77</arxiv:doi>
    <link href="http://arxiv.org/abs/2610.01234v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2610.01234v2" rel="related" type="application/pdf"/>
    <arxiv:primary_category term="math.AG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="math.AG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2610.05678v1</id>
    <updated>2026-10-13T15:00:00Z</updated>
    <published>2026-10-13T15:00:00Z</published>
    <title>Another note on the other ideas</title>
    <summary>Words about other things.</summary>
    <author><name>John Placeholder</name></author>
    <link href="http://arxiv.org/abs/2610.05678v1" rel="alternate" type="text/html"/>
    <arxiv:primary_category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
`;

const CROSSREF = JSON.stringify({
  status: "ok", "message-type": "work-list",
  message: {
    "total-results": 8, "items-per-page": 100,
    items: Array.from({ length: 8 }, (_, i) => ({
      DOI: `10.1038/S41586-026-2000${i}-1`, URL: `https://doi.org/10.1038/s41586-026-2000${i}-1`,
      title: [`A study with a machine learning model, part ${i}`], "container-title": ["Nature"], type: "journal-article",
      author: [{ given: "Jane", family: "Placeholder", ORCID: "https://orcid.org/0000-0002-1825-0097", affiliation: [{ name: "Invented University" }] }],
      abstract: "<jats:p>A longer abstract with several invented words in it.</jats:p>",
      issued: { "date-parts": [[2026, 10, 10 + i]] }, published: { "date-parts": [[2026, 10, 10 + i]] },
    })),
  },
});

const RETRACTION_HEADER = "Record ID,Title,Subject,Institution,Journal,Publisher,Country,Author,URLS,ArticleType,RetractionDate,RetractionDOI,RetractionPubMedID,OriginalPaperDate,OriginalPaperDOI,OriginalPaperPubMedID,RetractionNature,Reason,Paywalled,Notes,";
const retractionRow = (i: number): string => `${40000 + i},"A paper, with a comma, number ${i}",(BLS) Biology - Cell;(PHY) Physics,"Invented University, Dept of Things",Journal of Invented Things,Invented Press,Nowhere,Jane Placeholder;John Placeholder,https://www.example.org/x/${i},Research Article,10/${i + 1}/2026 0:00,10.1000/retraction-notice-${i},0,1/${i + 1}/2026 0:00,10.1038/S41586-026-3000${i % 3}-1,${31000000 + i},Retraction,+Computer-Aided Content or Computer-Generated Content;+Concerns/Issues About Data;,No,"A free note, with a name: Jane Placeholder",`;
const CSV = `${RETRACTION_HEADER}\n${Array.from({ length: 9 }, (_, i) => retractionRow(i)).join("\n")}\n`;

const HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Research | Invented Lab</title>
<script>var secret = "https://tracker.example.net/collect?uid=1";</script><style>.x{color:red}</style></head>
<body><!-- a comment with jane.placeholder@university.example.edu -->
<main><ul>
<li><a href="/research"><span>All research</span></a></li>
<li><div><time datetime="2026-10-20">Oct 20, 2026</time><a href="/research/jane-placeholder-finds-a-thing"><h3>Jane Placeholder finds a machine learning thing</h3></a></div></li>
<li><div><time>Oct 14, 2026</time><a href="/research/another-real-looking-slug"><h3>Evaluations of an invented assistant</h3></a></div></li>
<li><a href="https://www.nytimes.com/2026/10/20/science/real-looking-story.html">Press coverage</a></li>
<li><a href="https://twitter.com/janeplaceholder">Follow</a></li>
</ul></main>
</body></html>
`;

// ── The namespace list ───────────────────────────────────────────────────────────────────────────

describe("the namespaces a capture may keep", () => {
  it("equals the list tests/fixture-safety.test.ts allows over http, in the same order", () => {
    const source = fs.readFileSync(path.join(ROOT, "tests", "fixture-safety.test.ts"), "utf8");
    const block = /const XML_NAMESPACE_PREFIXES = \[([\s\S]*?)\];/.exec(source)![1]!;
    const listed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(listed.length).toBeGreaterThan(5);
    expect([...NAMESPACE_PREFIXES]).toEqual(listed);
  });

  it("holds only http addresses (an https namespace would need a host the run reads)", () => {
    for (const p of NAMESPACE_PREFIXES) expect(p.startsWith("http://"), p).toBe(true);
  });

  it("lists the six kinds the capture tool reads", () => {
    expect([...SCRUB_KINDS]).toEqual(["rss", "atom", "json", "csv", "html", "gz"]);
  });
});

// ── rss ──────────────────────────────────────────────────────────────────────────────────────────

describe("scrubbing an rss feed", () => {
  const out = scrub("rss", RSS);

  it("keeps at most 6 items, and the same 6 in the channel's list", () => {
    expect(out.match(/<item\b/g)).toHaveLength(SCRUB_ITEMS_MAX);
    expect(out.match(/<rdf:li\b/g)).toHaveLength(SCRUB_ITEMS_MAX);
  });

  it("replaces every title, description and author, keeping the AI phrases the text held", () => {
    expect(out).not.toContain("Jane Placeholder");
    expect(out).not.toContain("Invented Society");
    expect(out).toContain("<title>SAMPLE title 1</title>");
    expect(out).toMatch(/<title>SAMPLE title \d+ machine learning<\/title>/);
    expect(out).toMatch(/<description>SAMPLE text \d+ neural network<\/description>/);
    expect(out).toContain("<dc:creator>SAMPLE Author</dc:creator>");
  });

  it("removes every e-mail address", () => {
    expect(out).not.toContain("university.example.edu");
    expect(RSS).toContain("jane.placeholder@");
  });

  it("keeps the dates and the namespace declarations, and writes the same DOI the same way everywhere (once as a field, once in the identifier)", () => {
    expect(out).toContain("<dc:date>2026-10-10</dc:date>");
    expect(out).toContain('xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"');
    const dois = [...out.matchAll(/<prism:doi>([^<]+)<\/prism:doi>/g)].map((m) => m[1]!);
    expect(dois).toEqual(["10.1000/ut-sample-0001", "10.1000/ut-sample-0002", "10.1000/ut-sample-0003", "10.1000/ut-sample-0004", "10.1000/ut-sample-0005", "10.1000/ut-sample-0006"]);
    expect([...out.matchAll(/<dc:identifier>doi:([^<]+)<\/dc:identifier>/g)].map((m) => m[1])).toEqual(dois);
  });

  it("rewrites every address to an invented page of a host the run reads, or of the example host, and drops the tracking parameters", () => {
    for (const u of urlsIn(out)) {
      if (NAMESPACE_PREFIXES.some((p) => u.startsWith(p))) continue;
      expect(u, u).toMatch(/^https:\/\/www\.nature\.com\/ut-sample\/item-\d+$/);
    }
    expect(out).not.toContain("utm_");
    expect(out).not.toContain("s41586");
    expect(unsafeUrls(out, options)).toEqual([]);
  });

  it("gives the same page the same slug, in the item's link, its rdf:about and the list", () => {
    const about = [...out.matchAll(/<item rdf:about="([^"]+)"/g)].map((m) => m[1]!);
    const links = [...out.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]!).filter((l) => l.includes("/ut-sample/"));
    const list = [...out.matchAll(/<rdf:li rdf:resource="([^"]+)"/g)].map((m) => m[1]!);
    expect(about).toEqual(list);
    expect(links.slice(-SCRUB_ITEMS_MAX)).toEqual(about);
  });

  it("is still read by the production RSS reader: the same dates, the invented DOIs, the invented addresses", async () => {
    const body = out.replaceAll("https://www.nature.com/ut-sample/", "https://www.nature.com/ut-sample/");
    const ctx = feedCtx(tempDir("ut-captures-"), { fetch: (async () => answer(body, { contentType: "application/rss+xml" })) as typeof fetchFeed });
    const r = await readFeed(feedEntry("journal-nature"), ctx, fixtureRun());
    expect(r.ok).toBe(true);
    const items = [...r.data!.items, ...r.data!.lookback];
    expect(items.length).toBe(SCRUB_ITEMS_MAX);
    expect(items.every((i) => i.url.startsWith("https://www.nature.com/ut-sample/"))).toBe(true);
    expect(items.map((i) => i.doi!).sort(byCodeUnit)).toEqual(["10.1000/ut-sample-0001", "10.1000/ut-sample-0002", "10.1000/ut-sample-0003", "10.1000/ut-sample-0004", "10.1000/ut-sample-0005", "10.1000/ut-sample-0006"]);
  });

  it("changes nothing when it is run on its own output (every kind but the gzip, which holds the same)", () => {
    expect(scrub("rss", out)).toBe(out);
    for (const [kind, body] of [["atom", ATOM], ["json", CROSSREF], ["csv", CSV], ["html", HTML]] as const) {
      const once = scrub(kind, body);
      expect(scrub(kind, once), kind).toBe(once);
    }
  });
});

// ── what real feeds carry that a hand-made one may not ───────────────────────────────────────────

describe("scrubbing the other places a real feed puts a title, a name or an identifier", () => {
  // K1c: 18 of the registry's feeds repeat the title as `dc:title`, and the journals' feeds carry `dc:rights` (a name), `dc:publisher` and `dc:source` (a journal).
  const DUBLIN = `<?xml version="1.0"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <item rdf:about="https://www.nature.com/articles/s41586-026-90001-1">
    <title>Jane Placeholder finds a machine learning thing</title>
    <dc:title>Jane Placeholder finds a machine learning thing</dc:title>
    <dc:rights>(c) 2026 Jane Placeholder and Invented Press</dc:rights>
    <dc:publisher>Invented Press</dc:publisher>
    <dc:source>Nature</dc:source>
    <media:title>Jane Placeholder at work</media:title>
    <media:description>A talk by Jane Placeholder</media:description>
    <media:credit>Jane Placeholder</media:credit>
    <itunes:summary>Jane Placeholder explains</itunes:summary>
    <itunes:subtitle>Jane Placeholder again</itunes:subtitle>
  </item>
</rdf:RDF>
`;
  const PUBMED = `<?xml version="1.0"?>
<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">31000001</PMID><Article><Journal><Title>Journal of Invented Things</Title></Journal>
<ArticleTitle>Jane Placeholder studies a deep learning thing</ArticleTitle><VernacularTitle>Jane Placeholder studiert etwas</VernacularTitle>
<Abstract><AbstractText>A neural network is trained by Jane Placeholder.</AbstractText><CopyrightInformation>(c) Jane Placeholder</CopyrightInformation></Abstract>
<AuthorList><Author><LastName>Placeholder</LastName><ForeName>Jane</ForeName><Identifier Source="ORCID">0000-0002-1825-0097</Identifier><AffiliationInfo><Affiliation>Invented University</Affiliation></AffiliationInfo></Author></AuthorList>
<GeneralNote Owner="NLM">A note about Jane Placeholder</GeneralNote><CoiStatement>Jane Placeholder holds shares.</CoiStatement></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>
`;

  it("replaces a Dublin Core, Media RSS or iTunes title, summary, credit and rights, keeping the publisher and the journal", () => {
    const out = scrub("rss", DUBLIN);
    expect(out).not.toContain("Placeholder");
    expect(out).not.toContain("machine learning thing");
    expect(out).toMatch(/<dc:title>SAMPLE title \d+ machine learning<\/dc:title>/);
    expect(out).toMatch(/<dc:rights>SAMPLE text \d+<\/dc:rights>/);
    expect(out).toContain("<media:credit>SAMPLE Author</media:credit>");
    expect(out).toMatch(/<media:title>SAMPLE title \d+<\/media:title>/);
    expect(out).toMatch(/<media:description>SAMPLE text \d+<\/media:description>/);
    expect(out).toMatch(/<itunes:summary>SAMPLE text \d+<\/itunes:summary>/);
    expect(out).toMatch(/<itunes:subtitle>SAMPLE text \d+<\/itunes:subtitle>/);
    expect(out).toContain("<dc:publisher>Invented Press</dc:publisher>");
    expect(out).toContain("<dc:source>Nature</dc:source>");
    expect(scrub("rss", out)).toBe(out);
  });

  it("replaces a PubMed record's vernacular title, copyright line, notes and conflict statement, and an author's ORCID iD whatever the tag", () => {
    const out = scrub("rss", PUBMED);
    expect(out).not.toContain("Placeholder");
    expect(out).not.toContain("Jane");
    expect(out).not.toContain("1825-0097");
    expect(out).not.toContain("studiert");
    expect(out).toContain('<Identifier Source="ORCID">0000-0000-0000-0000</Identifier>');
    expect(out).toContain("<PMID Version=\"1\">99000001</PMID>");
    for (const tag of ["VernacularTitle", "CopyrightInformation", "GeneralNote", "CoiStatement"]) expect(out, tag).toMatch(new RegExp(`<${tag}[^>]*>SAMPLE (?:title|text) \\d+</${tag}>`));
    expect(scrub("rss", out)).toBe(out);
  });

  it("writes an ORCID iD in prose, in an attribute and in a JSON string as the empty one, and leaves a number that only looks like one", () => {
    const o = new IdMap();
    expect(o.text("see 0000-0002-1825-0097 and 0000-0001-5109-3700 and 0000-0002-1694-233X.")).toBe("see 0000-0000-0000-0000 and 0000-0000-0000-0000 and 0000-0000-0000-0000.");
    expect(o.text("2026-10-2026-1021 and 0000-0002-1825-009 and 12345678-1234-1234-1234")).toBe("2026-10-2026-1021 and 0000-0002-1825-009 and 12345678-1234-1234-1234");
    const j = JSON.parse(scrub("json", JSON.stringify({ items: [{ note: "0000-0002-1825-0097", ids: ["0000-0001-5109-3700"] }] }))) as { items: { note: string; ids: string[] }[] };
    expect(j.items[0]).toEqual({ note: "0000-0000-0000-0000", ids: ["0000-0000-0000-0000"] });
  });

  it("keeps a journal's or publisher's name and an article type as written in JSON though they hold spaces, and still invents a title", () => {
    const body = JSON.stringify({
      items: [{
        "container-title": ["Journal of Invented Things"], publisher: "Invented Press Ltd", pubtype: ["Journal Article", "Review"], fulljournalname: "Journal of Invented Things",
        title: ["A real title with several words"], note: "Free text with several words", language: "en", source: "Invented Index",
      }],
    });
    const item = (JSON.parse(scrub("json", body)) as { items: Record<string, unknown>[] }).items[0]!;
    expect(item["container-title"]).toEqual(["Journal of Invented Things"]);
    expect([item.publisher, item.pubtype, item.fulljournalname, item.language, item.source]).toEqual(["Invented Press Ltd", ["Journal Article", "Review"], "Journal of Invented Things", "en", "Invented Index"]);
    expect(item.title).toEqual(["SAMPLE title 1"]);
    expect(item.note).toBe("SAMPLE note 2");
  });

  it("does not keep a name that stands under a person's key, whatever its words", () => {
    const body = JSON.stringify({ author: { publisher: "Jane Placeholder", name: "Jane Placeholder" } });
    expect(scrub("json", body)).not.toContain("Placeholder");
  });
});

// ── atom (the arXiv API's shape) ─────────────────────────────────────────────────────────────────

describe("scrubbing an atom feed", () => {
  const out = scrub("atom", ATOM);

  it("moves each arXiv number into the invented block of its month, the same in the id, the links and the DOI-less text, and keeps the version", () => {
    expect(out).toContain("<id>https://arxiv.org/abs/2610.99001v2</id>");
    expect(out).toContain('href="https://arxiv.org/abs/2610.99001v2"');
    expect(out).toContain("<id>https://arxiv.org/abs/2610.99002v1</id>");
    // A pdf address becomes the abstract address of the same invented number (a pdf address is no page the run reads).
    expect(out).not.toContain("/pdf/");
    expect(out.match(/https:\/\/arxiv\.org\/abs\/2610\.99001v2/g)).toHaveLength(3);
    expect(out).not.toContain("01234");
    expect(out).not.toContain("05678");
  });

  it("keeps the categories (the field mapping reads them), replaces the other attributes' text and removes the authors and affiliations", () => {
    expect(out).toContain('<arxiv:primary_category term="math.AG"');
    expect(out).toContain('<category term="cs.LG"');
    expect(out).toContain('<link title="SAMPLE"');
    expect(out).not.toContain("Jane");
    expect(out).not.toContain("Invented University");
    expect(out).toContain("<name>SAMPLE Author</name>");
    expect(out).toContain("<arxiv:affiliation>SAMPLE Institute</arxiv:affiliation>");
  });

  it("is still read by the production arXiv parser: two entries, the invented ids, the categories, the dates", () => {
    const page = parseArxivEntries(Buffer.from(out));
    expect(page.entries.map((e) => [e.id, e.version, e.categories])).toEqual([["2610.99001", 2, ["math.AG", "cs.LG"]], ["2610.99002", 1, ["cs.LG"]]]);
    expect(page.entries.map((e) => e.submitted_at)).toEqual(["2026-10-12T15:00:00.000Z", "2026-10-13T15:00:00.000Z"]);
    expect(page.entries[0]!.doi).toBe("10.1000/ut-sample-0001");
    expect(page.entries.map((e) => e.url)).toEqual(["https://arxiv.org/abs/2610.99001", "https://arxiv.org/abs/2610.99002"]);
  });
});

// ── json ─────────────────────────────────────────────────────────────────────────────────────────

describe("scrubbing a json answer", () => {
  const out = scrub("json", CROSSREF);
  const parsed = JSON.parse(out) as { message: { items: Record<string, unknown>[] } };

  it("caps arrays at 6, keeps the numbers, dates and codes, and replaces the abstract and the title with invented text", () => {
    expect(parsed.message.items).toHaveLength(SCRUB_ITEMS_MAX);
    expect(parsed.message.items[0]!.issued).toEqual({ "date-parts": [[2026, 10, 10]] });
    expect(parsed.message.items[0]!.type).toBe("journal-article");
    expect(parsed.message.items[0]!["container-title"]).toEqual(["Nature"]);
    expect(String((parsed.message.items[0]!.title as string[])[0])).toBe("SAMPLE title 1 machine learning");
    expect(String(parsed.message.items[0]!.abstract)).toMatch(/^SAMPLE abstract \d+$/);
  });

  it("removes the author, the ORCID address and the affiliation", () => {
    expect(out).not.toContain("Placeholder");
    expect(out).not.toContain("orcid.org");
    expect(out).not.toContain("Invented University");
    expect(parsed.message.items[0]!.author).toEqual([{ given: "SAMPLE Author", family: "SAMPLE Author", ORCID: "SAMPLE Author", affiliation: [{ name: "SAMPLE Institute" }] }]);
  });

  it("writes one invented DOI for a DOI however it was cased or addressed", () => {
    const first = parsed.message.items[0]!;
    expect(first.DOI).toBe("10.1000/ut-sample-0001");
    expect(first.URL).toBe("https://doi.org/10.1000/ut-sample-0001");
    expect(out).not.toContain("s41586");
  });

  it("is still read by the production Crossref reader", () => {
    const r = parseCrossrefWorks(Buffer.from(out));
    expect(r.works).toHaveLength(SCRUB_ITEMS_MAX);
    expect(r.works.map((w) => [w.doi, w.day, w.container])).toEqual(Array.from({ length: 6 }, (_, i) => [`10.1000/ut-sample-${String(i + 1).padStart(4, "0")}`, `2026-10-${10 + i}`, "Nature"]));
  });

  it("maps a PubMed number everywhere it stands (a key, a list, a field) to the invented block, and leaves the other numbers", () => {
    const body = JSON.stringify({ esearchresult: { count: "2", idlist: ["31000001", "31000002"] }, result: { uids: ["31000001", "31000002"], "31000001": { uid: "31000001", pubdate: "2026 Oct 1", title: "x y z w" }, "31000002": { uid: "31000002", pubdate: "2026 Oct 2" } } });
    const o = scrub("json", body);
    expect(o).not.toContain("3100000");
    const v = JSON.parse(o) as { esearchresult: { count: string; idlist: string[] }; result: Record<string, unknown> };
    expect(v.esearchresult.count).toBe("2");
    expect(v.esearchresult.idlist).toEqual(["99000001", "99000002"]);
    expect(Object.keys(v.result).sort()).toEqual(["99000001", "99000002", "uids"]);
  });
});

// ── csv ──────────────────────────────────────────────────────────────────────────────────────────

describe("scrubbing the Retraction Watch file", () => {
  const out = scrub("csv", CSV);
  const rows = parseCsv(out);

  it("keeps the header, with its trailing comma, and at most 6 rows", () => {
    expect(out.split("\n")[0]).toBe(RETRACTION_HEADER);
    expect(rows).toHaveLength(1 + SCRUB_ITEMS_MAX);
    expect(rows.every((r) => r.length === rows[0]!.length)).toBe(true);
  });

  it("replaces the title, the institution, the authors and the notes, and drops the addresses", () => {
    expect(out).not.toContain("Placeholder");
    expect(out).not.toContain("Invented University");
    expect(out).not.toContain("example.org");
    const col = (name: string): string[] => rows.slice(1).map((r) => r[rows[0]!.indexOf(name)]!);
    expect(col("Title")[0]).toBe("SAMPLE title 1");
    expect(new Set(col("Author"))).toEqual(new Set(["SAMPLE Author"]));
    expect(new Set(col("Institution"))).toEqual(new Set(["SAMPLE Institute"]));
    expect(new Set(col("URLS"))).toEqual(new Set([""]));
    expect(new Set(col("Notes"))).toEqual(new Set([""]));
    expect(new Set(col("OriginalPaperPubMedID"))).toEqual(new Set(["0"]));
  });

  it("keeps the dates, the nature and the reasons, and gives a repeated paper DOI the same invented DOI each time", () => {
    const col = (name: string): string[] => rows.slice(1).map((r) => r[rows[0]!.indexOf(name)]!);
    expect(col("RetractionNature")).toEqual(Array(6).fill("Retraction"));
    expect(col("Reason")[0]).toBe("+Computer-Aided Content or Computer-Generated Content;+Concerns/Issues About Data;");
    expect(col("RetractionDate")[0]).toBe("10/1/2026 0:00");
    // The original DOIs repeat every third row; their invented DOIs do too, and the retraction notices' differ.
    const original = col("OriginalPaperDOI");
    expect(original[0]).toBe(original[3]);
    expect(original[1]).toBe(original[4]);
    expect(new Set(original).size).toBe(3);
    expect(original.every((d) => d.startsWith("10.1000/ut-sample-rw-"))).toBe(true);
  });

  it("is still read by the production Retraction Watch reader", () => {
    const data = parseRetractionWatch(Buffer.from(out), "2026-11-28");
    expect(data.total).toBe(SCRUB_ITEMS_MAX);
    expect(data.rows.map((r) => r.nature)).toEqual(Array(6).fill("Retraction"));
    expect(data.rows[0]!.reasons).toEqual(["Computer-Aided Content or Computer-Generated Content", "Concerns/Issues About Data"]);
    expect(data.rows[0]!.original_doi).toMatch(/^10\.1000\/ut-sample-rw-\d{4}$/);
  });

  it("splits quoted fields with commas, quotes and line breaks as a CSV reader does", () => {
    expect(parseCsv('a,"b, c","d ""e"" f","g\nh"\n1,2,3,4\n')).toEqual([["a", "b, c", 'd "e" f', "g\nh"], ["1", "2", "3", "4"]]);
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    // A blank line is a row of one empty field; a last row that ends in an empty field keeps it.
    expect(parseCsv("a,b\n\n1,2")).toEqual([["a", "b"], [""], ["1", "2"]]);
    expect(parseCsv("a,b\n1,")).toEqual([["a", "b"], ["1", ""]]);
    expect(parseCsv("a,b\r\n\r\n1,2\r\n")).toEqual([["a", "b"], [""], ["1", "2"]]);
  });

  it("scrubs a one-column file, drops its blank lines, and names an invented title and any other free text by its column", () => {
    const opts = scrubOptionsFor(realConfig());
    expect(scrubCsv("Title\nReal words\n\n", opts)).toBe("Title\nSAMPLE title 1\n");
    expect(scrubCsv("Title,Foo\nReal words about machine learning,x y\n", opts)).toBe("Title,Foo\nSAMPLE title 1 machine learning,SAMPLE foo 2\n");
    expect(scrubCsv("", opts)).toBe("");
  });
});

// ── html ─────────────────────────────────────────────────────────────────────────────────────────

describe("scrubbing a saved page", () => {
  const out = scrub("html", HTML);

  it("empties scripts and styles, drops comments, and reduces the text to SAMPLE, a date and any AI phrase", () => {
    expect(out).not.toContain("secret");
    expect(out).not.toContain("tracker.example.net");
    expect(out).not.toContain("a comment");
    expect(out).not.toContain("Jane");
    expect(out).toMatch(/<h3>SAMPLE \d+ machine learning<\/h3>/);
    expect(out).toMatch(/<time datetime="2026-10-20">SAMPLE \d+ Oct 20, 2026<\/time>/);
  });

  it("empties each script and style block to its bare tag, whatever follows it", () => {
    const page = "<html><script>var secret = 1;</script><style>p { color: red }</style><script type=\"x\">other()</script><p>Hello</p></html>";
    expect(scrubHtml(page, options)).toBe('<html><script></script><style></style><script type="x"></script><p>SAMPLE 1</p></html>');
  });

  it("rewrites a site's own paths to an invented page that keeps the first folder, so a reader that follows /research/ still finds them", () => {
    expect(out).toMatch(/href="\/ut-sample-item-\d+"><span>/);
    expect(out.match(/href="\/research\/ut-sample-item-\d+"/g)).toHaveLength(2);
    expect(out).not.toContain("jane-placeholder-finds");
    expect(out).not.toContain("another-real-looking-slug");
  });

  it("sends a press address and a social address to the example host, never keeping their host", () => {
    expect(out).not.toContain("nytimes.com");
    expect(out).not.toContain("twitter.com");
    expect(urlsIn(out).every((u) => new URL(u).hostname === SAMPLE_LINK_HOST)).toBe(true);
    expect(unsafeUrls(out, options)).toEqual([]);
  });

  it("is read as before by the production page reader for the lab's research page", async () => {
    const lab = scrub("html", HTML.replace("https://www.nytimes.com", "https://example.com"));
    const ctx = feedCtx(tempDir("ut-captures-"), { fetch: (async () => answer(lab, { contentType: "text/html" })) as typeof fetchFeed });
    const r = await readFeed(feedEntry("lab-anthropic"), ctx, fixtureRun({ date: "2026-10-21" }));
    expect(r.ok).toBe(true);
    expect([...r.data!.items, ...r.data!.lookback].map((i) => i.published_at?.slice(0, 10))).toContain("2026-10-20");
  });
});

// ── gz ───────────────────────────────────────────────────────────────────────────────────────────

describe("scrubbing a gzip", () => {
  it("scrubs the JSON inside and gzips it again", () => {
    const body = zlib.gzipSync(Buffer.from(JSON.stringify([{ identifier: "ZZZZ", name: "Jane Placeholder", title: "A long free text with several words in it", doi: "10.1038/S41586-026-5555-1" }])));
    const gz = scrubFeed("gz", body, options);
    expect(gz[0]).toBe(0x1f);
    const inner = JSON.parse(zlib.gunzipSync(gz).toString("utf8")) as Record<string, string>[];
    expect(inner).toEqual([{ identifier: "ZZZZ", name: "SAMPLE Author", title: "SAMPLE title 1", doi: "10.1000/ut-sample-0001" }]);
  });

  it("scrubs a CSV inside", () => {
    const gz = scrubFeed("gz", zlib.gzipSync(Buffer.from(CSV)), options);
    expect(zlib.gunzipSync(gz).toString("utf8")).toBe(scrub("csv", CSV));
  });

  it("refuses text that is not gzip", () => {
    expect(() => scrubFeed("gz", Buffer.from("plain text"), options)).toThrow();
  });
});

// ── The refusals ─────────────────────────────────────────────────────────────────────────────────

describe("what the scrubber refuses", () => {
  const rssWith = (extra: string): string => `<?xml version="1.0"?><rss version="2.0" ${extra}><channel><title>t</title><item><title>x</title><link>https://www.nature.com/articles/x1</link></item></channel></rss>`;

  it("refuses an XML namespace that is not on the list, naming it, and a look-alike host of one that is", () => {
    expect(refusal("rss", rssWith('xmlns:evil="http://evil.example.org/ns"'))).toEqual(["http://evil.example.org/ns"]);
    expect(refusal("rss", rssWith('xmlns:dc="http://purl.org.example.biz/dc"'))).toEqual(["http://purl.org.example.biz/dc"]);
    expect(refusal("rss", rssWith('xmlns:dc="http://purl.org/dc/elements/1.1/"'))).toBeNull();
  });

  it("refuses a link in another scheme that survives (ftp, file, javascript, data)", () => {
    for (const bad of ["ftp://files.example.org/a", "file:///etc/hosts", "javascript:alert(1)"]) {
      const found = refusal("html", `<html><body><a href="${bad}">x</a></body></html>`);
      expect(found, bad).not.toBeNull();
      expect(found!.some((u) => u.startsWith(bad.slice(0, 5))), bad).toBe(true);
    }
    expect(refusal("json", JSON.stringify({ link: "ftp://files.example.org/a" }))).toEqual(["ftp://files.example.org/a"]);
  });

  it("rewrites an http link of a host the run reads to https, and a blocked host to the example host, without refusing", () => {
    const out = scrub("rss", rssWith("").replace("https://www.nature.com/articles/x1", "http://www.nature.com/articles/x1").replace("<title>t</title>", "<title>t</title><link>https://bit.ly/abc</link>"));
    expect(urlsIn(out)).toEqual([`https://${SAMPLE_LINK_HOST}/ut-sample/item-1`, "https://www.nature.com/ut-sample/item-2"]);
  });

  it("finds the unsafe address in any text: an http page, a blocked host, a real page that may exist", () => {
    expect(unsafeUrls("see http://www.nature.com/ut-sample/a and https://bit.ly/x and https://www.nature.com/articles/real-one and https://www.nature.com/ut-sample/ok", options))
      .toEqual(["http://www.nature.com/ut-sample/a", "https://bit.ly/x", "https://www.nature.com/articles/real-one"]);
    expect(unsafeUrls("https://www.example.com/anything and https://doi.org/10.1000/ut-sample-0001 and https://arxiv.org/abs/2610.99001v2", options)).toEqual([]);
  });

  it("keeps a blocked address out of its own output even when the original was one the run reads", () => {
    for (const u of urlsIn(scrub("rss", RSS))) expect(blockedEntry(u)).toBeNull();
  });
});

// ── The pieces ───────────────────────────────────────────────────────────────────────────────────

describe("the id map and the link rewriter", () => {
  it("numbers the invented ids in the order the file names the originals, and gives a repeat the same one", () => {
    const ids = new IdMap();
    expect(ids.doi("10.1038/A")).toBe("10.1000/ut-sample-0001");
    expect(ids.doi("10.1038/B")).toBe("10.1000/ut-sample-0002");
    expect(ids.doi("10.1038/a.")).toBe("10.1000/ut-sample-0001");
    expect(ids.arxivId("2610", "01234")).toBe("2610.99001");
    expect(ids.arxivId("2610", "01234")).toBe("2610.99001");
    expect(ids.arxivId("2611", "00001")).toBe("2611.99002");
    expect(ids.trial("NCT05123456")).toBe("NCT09990001");
    expect(ids.pmid("31234567")).toBe("99000001");
  });

  it("leaves an invented PubMed number as it is, and not a nine-digit one that begins 100", () => {
    const ids = new IdMap();
    expect(ids.pmid("99000007")).toBe("99000007");
    expect(ids.pmid("100000007")).not.toBe("100000007");
  });

  it("keeps an invented address on a host with digits in its name", () => {
    const links = new LinkRewriter(() => true, new IdMap());
    expect(links.rewrite("https://cdn29.example.org/ut-sample/already")).toBe("https://cdn29.example.org/ut-sample/already");
  });

  it("rewrites the ids that stand in prose (a DOI, an arXiv: number, a trial number)", () => {
    const ids = new IdMap();
    expect(ids.text("See 10.1038/s41586-026-12345-6, arXiv:2610.01234v2 and NCT05123456.")).toBe("See 10.1000/ut-sample-0001, arXiv:2610.99001v2 and NCT09990001.");
  });

  it("does not mistake a real page whose number begins 99 for an invented one, and reads ctgov and PubMed addresses into their invented ids", () => {
    const links = new LinkRewriter(() => true, new IdMap());
    expect(links.rewrite("https://www.nature.com/articles/s41586-026-99012-3")).toBe("https://www.nature.com/ut-sample/item-1");
    expect(links.rewrite("https://clinicaltrials.gov/study/NCT05123456")).toBe("https://clinicaltrials.gov/study/NCT09990001");
    expect(links.rewrite("https://clinicaltrials.gov/study/NCT09990001")).toBe("https://clinicaltrials.gov/study/NCT09990001");
    expect(links.rewrite("https://pubmed.ncbi.nlm.nih.gov/31234567/")).toBe("https://pubmed.ncbi.nlm.nih.gov/99000001/");
    expect(links.rewrite("https://arxiv.org/pdf/2610.01234v2.pdf")).toBe("https://arxiv.org/abs/2610.99001v2");
    expect(links.rewrite("https://doi.org/10.1038/S41586-026-12345-6")).toBe("https://doi.org/10.1000/ut-sample-0001");
    expect(unsafeUrls("https://www.nature.com/articles/s41586-026-99012-3", options)).toEqual(["https://www.nature.com/articles/s41586-026-99012-3"]);
  });

  it("keeps an invented address as it is, and writes a registry host's page as /ut-sample/item-N", () => {
    const links = new LinkRewriter((_c, host) => host === "www.nature.com", new IdMap());
    expect(links.rewrite("https://www.nature.com/ut-sample/already")).toBe("https://www.nature.com/ut-sample/already");
    expect(links.rewrite("https://www.nature.com/articles/real")).toBe("https://www.nature.com/ut-sample/item-1");
    expect(links.rewrite("https://www.nature.com/articles/real?utm=1")).toBe("https://www.nature.com/ut-sample/item-2");
    expect(links.rewrite("https://www.nature.com/articles/real")).toBe("https://www.nature.com/ut-sample/item-1");
    expect(links.rewrite("https://elsewhere.org/x")).toBe(`https://${SAMPLE_LINK_HOST}/ut-sample/item-3`);
    expect(links.relative("/research/real-slug")).toBe("/research/ut-sample-item-4");
    expect(links.relative("/research/real-slug")).toBe("/research/ut-sample-item-4");
    expect(links.relative("/about")).toBe("/ut-sample-item-5");
    expect(links.relative("//cdn.example.org/x")).toBe("//cdn.example.org/x");
  });
});

// ── The command line ─────────────────────────────────────────────────────────────────────────────

describe("the command line", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  };

  it("exits 2 with the usage for a wrong kind, a wrong count of arguments or a missing file", () => {
    for (const argv of [[], ["rss"], ["xml", "a", "b"], ["rss", "a", "b", "c"], ["rss", "/nonexistent/ut-capture", "/tmp/x"]]) {
      const t = io();
      expect(scrubMain(argv, t.io, ROOT), argv.join(" ")).toBe(2);
      expect(t.err.join("\n")).toContain("Usage:");
    }
  });

  it("writes the scrubbed file, creating its folder, and exits 0", () => {
    const dir = tempDir("ut-scrub-main-");
    const from = path.join(dir, "in.xml");
    const to = path.join(dir, "deep", "er", "out.xml");
    fs.writeFileSync(from, RSS);
    const t = io();
    expect(scrubMain(["rss", from, to], t.io, ROOT)).toBe(0);
    expect(fs.readFileSync(to, "utf8")).toBe(scrub("rss", RSS));
    expect(t.out[0]).toContain("Read it in full before committing it.");
  });

  it("exits 1 and writes nothing for a refused body, listing the address and not opening it", () => {
    const dir = tempDir("ut-scrub-main-");
    const from = path.join(dir, "in.xml");
    const to = path.join(dir, "out.xml");
    fs.writeFileSync(from, rssBad());
    const t = io();
    expect(scrubMain(["rss", from, to], t.io, ROOT)).toBe(1);
    expect(fs.existsSync(to)).toBe(false);
    expect(t.err.join("\n")).toContain("http://evil.example.org/ns");
    expect(t.err.join("\n")).toContain("nothing written");
  });

  it("exits 1 for a body it cannot read", () => {
    const dir = tempDir("ut-scrub-main-");
    const from = path.join(dir, "in.json");
    fs.writeFileSync(from, "{ not json");
    const t = io();
    expect(scrubMain(["json", from, path.join(dir, "out.json")], t.io, ROOT)).toBe(1);
    expect(t.err.join("\n")).toContain("scrub-feed:");
  });
});

// ── The edges of each rule ───────────────────────────────────────────────────────────────────────

describe("the edges of the scrubber's rules", () => {
  it("knows an invented address by its marker or by an invented id, and no real-looking one", () => {
    expect(isInvented("www.example.com", "/ut-sample/item-1")).toBe(true);
    expect(isInvented("arxiv.org", "/abs/2610.99001")).toBe(true);
    expect(isInvented("arxiv.org", "/abs/2610.99001v2")).toBe(true);
    expect(isInvented("arxiv.org", "/abs/2610.98001")).toBe(false);
    expect(isInvented("arxiv.org", "/abs/2610.990011")).toBe(false);
    expect(isInvented("other.org", "/abs/2610.99001")).toBe(false);
    expect(isInvented("clinicaltrials.gov", "/study/NCT09990101")).toBe(true);
    expect(isInvented("clinicaltrials.gov", "/study/NCT09890101")).toBe(false);
    expect(isInvented("clinicaltrials.gov", "/study/NCT099901011")).toBe(false);
    expect(isInvented("clinicaltrials.gov", "/study/NCT0999010")).toBe(false);
    expect(isInvented("other.org", "/study/NCT09990101")).toBe(false);
    expect(isInvented("pubmed.ncbi.nlm.nih.gov", "/99123456/")).toBe(true);
    expect(isInvented("pubmed.ncbi.nlm.nih.gov", "/98123456/")).toBe(false);
    expect(isInvented("pubmed.ncbi.nlm.nih.gov", "/991234567/")).toBe(false);
    expect(isInvented("other.org", "/99123456/")).toBe(false);
  });

  it("keeps an id it wrote and invents one for any other, whatever its length", () => {
    const ids = new IdMap();
    expect(ids.doi("10.1000/ut-sample-0001")).toBe("10.1000/ut-sample-0001");
    expect(ids.doi("10.1000/ut-sample-rw-0002")).toBe("10.1000/ut-sample-rw-0002");
    expect(ids.doi("10.1000/ut-sample-00001")).toBe("10.1000/ut-sample-0001");
    expect(ids.doi("10.1000/ut-sample-001")).toBe("10.1000/ut-sample-0002");
    expect(ids.arxivId("2610", "99001")).toBe("2610.99001");
    expect(ids.arxivId("2610", "990011")).toBe("2610.99001");
    expect(ids.arxivId("2610", "9901")).toBe("2610.99002");
    expect(ids.trial("NCT09990101")).toBe("NCT09990101");
    expect(ids.trial("NCT099901011")).toBe("NCT09990001");
    expect(ids.pmid("99123456")).toBe("99123456");
    expect(ids.pmid("991234567")).toBe("99000001");
    expect(ids.pmid("98123456")).toBe("99000002");
  });

  it("reads old four-digit arXiv numbers as well as five-digit ones, in text and in an address", () => {
    const ids = new IdMap();
    expect(ids.text("see arXiv:1412.1234v2 and arXiv:2501.12345")).toBe("see arXiv:1412.99001v2 and arXiv:2501.99002");
    const links = new LinkRewriter(() => true, ids);
    expect(links.rewrite("https://arxiv.org/abs/1311.4321v3")).toBe("https://arxiv.org/abs/1311.99003v3");
    expect(links.rewrite("https://arxiv.org/pdf/1311.4321v3.pdf")).toBe("https://arxiv.org/abs/1311.99003v3");
  });

  it("rewrites a DOI address only on the DOI host with a DOI path, a PubMed address only on PubMed with a number, and anything else to a slug", () => {
    const ids = new IdMap();
    const links = new LinkRewriter(() => true, ids);
    expect(links.rewrite("https://doi.org/10.1234/real.thing")).toBe("https://doi.org/10.1000/ut-sample-0001");
    expect(links.rewrite("https://dx.doi.org/10.12345678/real.other")).toBe("https://doi.org/10.1000/ut-sample-0002");
    expect(links.rewrite("https://doi.org/not-a-doi")).toMatch(/^https:\/\/doi\.org\/ut-sample\/item-\d+$/);
    expect(links.rewrite("https://publisher.org/10.1234/real.thing")).toMatch(/^https:\/\/publisher\.org\/ut-sample\/item-\d+$/);
    expect(links.rewrite("https://pubmed.ncbi.nlm.nih.gov/12345678/")).toBe("https://pubmed.ncbi.nlm.nih.gov/99000001/");
    expect(links.rewrite("https://publisher.org/12345678/")).toMatch(/^https:\/\/publisher\.org\/ut-sample\/item-\d+$/);
    expect(links.rewrite("https://pubmed.ncbi.nlm.nih.gov/about/")).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/ut-sample\/item-\d+$/);
    expect(links.rewrite("https://clinicaltrials.gov/study/NCT01234567")).toBe("https://clinicaltrials.gov/study/NCT09990001");
    expect(links.rewrite("https://clinicaltrials.gov/about-studies")).toMatch(/^https:\/\/clinicaltrials\.gov\/ut-sample\/item-\d+$/);
  });

  it("keeps the first folder of a relative address when it is a plain name of up to 30 characters, digits included", () => {
    const links = new LinkRewriter(() => true, new IdMap());
    expect(links.relative("/blog2024/real-title")).toBe("/blog2024/ut-sample-item-1");
    expect(links.relative("/news0/real-title")).toBe("/news0/ut-sample-item-2");
    expect(links.relative(`/${"a".repeat(30)}/real-title`)).toBe(`/${"a".repeat(30)}/ut-sample-item-3`);
    expect(links.relative(`/${"a".repeat(31)}/real-title`)).toBe("/ut-sample-item-4");
    expect(links.relative("/real-title")).toBe("/ut-sample-item-5");
    expect(links.relative("/a_b/real-title")).toBe("/ut-sample-item-6");
  });

  it("scrubs an e-mail address with digits in it or a two-letter ending, and a plain string that is one", () => {
    const o = options;
    expect(scrubJson({ note: "write to jl2.chen7@lab.example.tw today" }, o)).toEqual({ note: expect.not.stringContaining("jl2") });
    expect(JSON.stringify(scrubJson({ note: "write to a.b@lab.tw today", mail: "a.b@lab.tw", other: "mailto:c9@lab.org" }, o))).not.toMatch(/a\.b@lab|c9@lab/);
    const out = scrubJson({ contact: "x9@lab.org" }, o) as { contact: string };
    expect(out.contact).toMatch(/^\S+@\S+$/);
    expect(out.contact).not.toContain("x9");
  });

  it("holds a vocabulary-shaped string of up to 120 characters and invents any longer one, and keeps a blank name as it is", () => {
    const keep = "a".repeat(120);
    const out = scrubJson({ kind: keep, other: "a".repeat(121), author: " ", institution: "  " }, options) as Record<string, string>;
    expect(out.kind).toBe(keep);
    expect(out.other).toMatch(/^SAMPLE other \d+$/);
    expect([out.author, out.institution]).toEqual([" ", "  "]);
  });

  it("keeps at most three of the AI phrases a replaced text held, and all of one or two", () => {
    const phrases = ["alpha phrase", "bravo phrase", "charlie phrase", "delta phrase"];
    const o = { ...options, phrases };
    const four = scrubJson({ summary: "This has alpha phrase, bravo phrase, charlie phrase and delta phrase in it, in a long sentence of real words." }, o) as { summary: string };
    expect(four.summary).toBe("SAMPLE summary 1 alpha phrase bravo phrase charlie phrase");
    const one = scrubJson({ summary: "Real words and bravo phrase appear in a long sentence." }, o) as { summary: string };
    expect(one.summary).toBe("SAMPLE summary 1 bravo phrase");
    const none = scrubJson({ summary: "Real words in a long sentence." }, { ...options, phrases: [] }) as { summary: string };
    expect(none.summary).toBe("SAMPLE summary 1");
  });

  it("scrubs an e-mail address outside the text too, with digits in its name or a two-letter ending", () => {
    const out = scrub("html", '<html><body><p data-contact="jl2.chen7@lab.tw" data-other="mailto:a9@lab.org">Hello world 2026</p></body></html>');
    expect(out).not.toMatch(/jl2|chen7|a9@|lab\.tw|lab\.org/);
    expect(out).toContain("sample@example.com");
    expect(scrub("html", '<html><body><p data-contact="jl@lab29.univ3.org">Hello 2026</p></body></html>')).not.toMatch(/jl@|lab29|univ3/);
  });

  it("keeps an AI phrase in a page text when there is exactly one phrase to keep, and when there are two", () => {
    const html = "<html><body><p>Hello world 2026 neural network and other thing</p></body></html>";
    expect(scrubHtml(html, { ...options, phrases: ["neural network"] })).toContain("SAMPLE 1 2026 neural network<");
    expect(scrubHtml(html, { ...options, phrases: ["neural network", "other thing"] })).toContain("SAMPLE 1 2026 neural network other thing<");
    expect(scrubHtml(html, { ...options, phrases: [] })).toContain(">SAMPLE 1 2026<");
  });

  it("replaces a category term that is not an arXiv category, and keeps one that is", () => {
    const out = scrub("atom", '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>t</title><category term="Real Topic Words" scheme="x"/><category term="cs.LG"/></entry></feed>');
    expect(out).toContain('<category term="SAMPLE" scheme="x"/>');
    expect(out).toContain('<category term="cs.LG"/>');
  });

  it("rewrites a PubMed address of seven to nine digits and no other length", () => {
    const links = new LinkRewriter(() => true, new IdMap());
    for (const n of ["1234567", "12345678", "123456789"]) expect(links.rewrite(`https://pubmed.ncbi.nlm.nih.gov/${n}/`), n).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/99\d{6}\/$/);
    for (const n of ["123456", "1234567890"]) expect(links.rewrite(`https://pubmed.ncbi.nlm.nih.gov/${n}/`), n).toMatch(/ut-sample\/item-\d+$/);
  });

  it("labels an invented text with 'text' when its key is empty, and keeps a one-letter first folder of a relative address", () => {
    expect(scrubJson("write to x@lab.org about real things", options)).toBe("SAMPLE text 1");
    const links = new LinkRewriter(() => true, new IdMap());
    expect(links.relative("/a/real-title")).toBe("/a/ut-sample-item-1");
  });

  it("runs as a script from the shell: no arguments exit 2 with the usage on stderr", () => {
    const cli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const r = spawnSync(process.execPath, [cli, path.join(ROOT, "fixtures", "src", "scrub-feed.ts")], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Usage:/);
  });

  it("refuses one unknown namespace as well as several, and names each once", () => {
    expect(refusal("rss", rssBad())).toEqual(["http://evil.example.org/ns"]);
  });

  it("treats the sample host and an example.* host as safe, and any other as not", () => {
    const o = { keepHost: () => true };
    expect(unsafeUrls(`https://${SAMPLE_LINK_HOST}/x https://lab.example.org/x https://example.com/y`, o)).toEqual([]);
    expect(unsafeUrls("https://real-lab.org/x https://notexample.org/x", o)).toEqual(["https://notexample.org/x", "https://real-lab.org/x"]);
  });

  it("exits 2 for a wrong number of arguments or an unknown kind, with the usage", () => {
    const err: string[] = [];
    const io = { out: () => {}, err: (s: string) => err.push(s) };
    expect(scrubMain(["json", "a"], io, ROOT)).toBe(2);
    expect(scrubMain(["bogus", "a", "b"], io, ROOT)).toBe(2);
    expect(scrubMain(["json", "a", "b", "c"], io, ROOT)).toBe(2);
    expect(err.every((e) => e.startsWith("Usage:"))).toBe(true);
  });
});

function rssBad(): string {
  return '<?xml version="1.0"?><rss version="2.0" xmlns:evil="http://evil.example.org/ns"><channel><title>t</title></channel></rss>';
}

// ── The live captures, when there are some ───────────────────────────────────────────────────────

describe("the live captures Kobol commits (fixtures/feeds/live/)", () => {
  const dir = path.join(FEEDS_DIR, "live");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort(byCodeUnit) : [];

  it("holds only files named after a registry id, when the folder exists (there are none before Kobol's K1e)", () => {
    const ids = new Set(realConfig().sources.feeds.map((f) => f.id));
    for (const f of files) expect(ids.has(f.replace(/\.[A-Za-z0-9.]+$/, "")), f).toBe(true);
  });

  it.each(files.filter((f) => /\.(?:xml|json|html)$/.test(f)))("%s is read by its feed's reader: ok, with at least one item or none of its own fault", async (file) => {
    const entry = feedEntry(file.replace(/\.[A-Za-z0-9.]+$/, ""));
    const body = fs.readFileSync(path.join(dir, file));
    const ctx = feedCtx(tempDir("ut-captures-"), { fetch: (async () => answer(body, { contentType: "text/plain" })) as typeof fetchFeed });
    const r = await readFeed(entry, ctx, fixtureRun());
    expect(r.ok, `${file}: ${r.error}`).toBe(true);
  });
});
