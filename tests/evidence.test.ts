// The run's evidence (SPEC §4.11 "Where the types come from", §4.12 opening paragraph, §8.13): buildEvidence() from the pack's part and this
// run's snapshots, in scripts/lib/evidence.ts. A pack URL's text is the pack's followed by its snapshot's; `types` are the pack's then
// the snapshot's `article_types`, each once; `resolved` is each snapshot's final URL where it differs, plus the final URL of a GET that
// answered an error; `seen_as` is the pack's, else "fetched", else "search". The transcripts' part (what the agent fetched or searched)
// is P3's and is not built here. Cyber's tests/evidence.test.ts at the fork commit 3ced1fb, adapted: its CVE and transcript parts are
// gone, `types` and `resolved` are new. Offline: every input is built here.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { articleTypeFits, primaryProblem } from "@/lib/primary";
import { Evidence } from "@/lib/schema/misc";
import { normalizeUrl } from "@/lib/urls";
import { buildEvidence, type PackEvidence } from "@/scripts/lib/evidence";
import type { Snapshot } from "@/scripts/lib/snapshot";

const config = loadConfig(path.join(__dirname, "..", "config"));
const n = normalizeUrl;

const NATURE = "https://www.nature.com/articles/s41586-019-ut-sample-0001";
const NATURE_DOI = "https://doi.org/10.1038/s41586-019-ut-sample-0001";
const PUBMED = "https://pubmed.ncbi.nlm.nih.gov/9990001/";
const ARXIV = "https://arxiv.org/abs/2901.99003";
const OTHER = "https://example.org/ut-sample/other";

const snap = (url: string, text: string, over: Partial<Snapshot> = {}): Snapshot => ({
  url, final_url: url, status: 200, fetched_at: "2026-11-20T09:00:00+08:00", content_type: "text/html", text_sha256: "0".repeat(64),
  article_types: [], text, ...over,
});

const pack = (over: Partial<PackEvidence> = {}): PackEvidence => ({ urls: [], fetched: [], texts: {}, seen_as: {}, types: {}, ...over });

describe("buildEvidence from snapshots alone", () => {
  it("B1 every snapshot URL is a URL the run saw and read: urls, fetched, texts, seen_as `fetched`, no pack", () => {
    const ev = buildEvidence({ snapshots: [snap(`${NATURE}#frag`, "Nature text."), snap(ARXIV, "Arxiv text.")] });
    expect(ev).toEqual({
      urls: [n(NATURE), n(ARXIV)], fetched: [n(NATURE), n(ARXIV)],
      texts: { [n(NATURE)]: "Nature text.", [n(ARXIV)]: "Arxiv text." },
      seen_as: { [n(NATURE)]: "fetched", [n(ARXIV)]: "fetched" }, types: {}, resolved: {},
    });
    expect(Evidence.parse(ev)).toEqual(ev);
  });

  it("B2 nothing in gives an empty evidence that parses; the pack may be absent or null", () => {
    const empty = { urls: [], fetched: [], texts: {}, seen_as: {}, types: {}, resolved: {} };
    expect(buildEvidence({ snapshots: [] })).toEqual(empty);
    expect(buildEvidence({ snapshots: [], pack: null, resolved: null })).toEqual(empty);
    expect(buildEvidence({ snapshots: [], pack: pack(), resolved: {} })).toEqual(empty);
  });

  it("B3 an empty text is left out of `texts`, but the URL is still seen and read", () => {
    const ev = buildEvidence({ snapshots: [snap(ARXIV, "")] });
    expect(ev.urls).toEqual([n(ARXIV)]);
    expect(ev.fetched).toEqual([n(ARXIV)]);
    expect(Object.hasOwn(ev.texts, n(ARXIV))).toBe(false);
  });

  it("B4 `types` are each snapshot's article_types, keyed by the normalised URL; a URL with none is left out", () => {
    const ev = buildEvidence({
      snapshots: [snap(NATURE, "a", { article_types: ["Article", "Research Article"] }), snap(ARXIV, "b", { article_types: [] }), snap(PUBMED, "c", { article_types: ["Journal Article", "Journal Article"] })],
    });
    expect(ev.types).toEqual({ [n(NATURE)]: ["Article", "Research Article"], [n(PUBMED)]: ["Journal Article"] });
    expect(Object.keys(ev.types)).toEqual([n(NATURE), n(PUBMED)]);
  });

  it("B5 `resolved` is the final URL of a snapshot's GET where it differs from the URL once both are normalised", () => {
    const ev = buildEvidence({
      snapshots: [
        snap(NATURE_DOI, "landing", { final_url: NATURE }), snap(ARXIV, "same", { final_url: `${ARXIV}?utm_source=x#frag` }), snap(OTHER, "other", { final_url: "https://www.example.org/ut-sample/moved" }),
      ],
    });
    expect(ev.resolved).toEqual({ [n(NATURE_DOI)]: NATURE, [n(OTHER)]: "https://www.example.org/ut-sample/moved" });
  });

  it("B6 a later snapshot of a URL replaces an earlier one: its text, its types and its final URL", () => {
    const first = snap(NATURE_DOI, "first text", { final_url: NATURE, article_types: ["Article"] });
    const second = snap(`${NATURE_DOI}#again`, "second text", { final_url: NATURE_DOI, article_types: [] });
    const ev = buildEvidence({ snapshots: [first, second] });
    expect(ev.texts).toEqual({ [n(NATURE_DOI)]: "second text" });
    expect(ev.resolved).toEqual({});
    expect(ev.urls).toEqual([n(NATURE_DOI)]);
    // The same, the other way round: the replacement is the one that has the types and the redirect.
    const back = buildEvidence({ snapshots: [second, first] });
    expect(back.texts).toEqual({ [n(NATURE_DOI)]: "first text" });
    expect(back.resolved).toEqual({ [n(NATURE_DOI)]: NATURE });
    expect(back.types).toEqual({ [n(NATURE_DOI)]: ["Article"] });
    // A later snapshot with an empty text removes the earlier text too.
    const gone = buildEvidence({ snapshots: [first, snap(NATURE_DOI, "", { final_url: NATURE_DOI })] });
    expect(Object.hasOwn(gone.texts, n(NATURE_DOI))).toBe(false);
    expect(gone.types).toEqual({});
  });
});

describe("buildEvidence with the pack's part", () => {
  const p = pack({
    urls: [ARXIV, PUBMED, OTHER], fetched: [PUBMED],
    texts: { [ARXIV]: "The pack's arXiv abstract.", [PUBMED]: "The pack's PubMed abstract.", [OTHER]: "" },
    seen_as: { [ARXIV]: "pack", [PUBMED]: "pack", [OTHER]: "pack" },
    types: { [PUBMED]: ["Journal Article"], [ARXIV]: [] },
  });

  it("P1 the pack's URLs come first, in the pack's order, then the snapshots' that the pack lacks; every key is normalised", () => {
    const ev = buildEvidence({ snapshots: [snap(NATURE, "n"), snap(`${ARXIV}#frag`, "a")], pack: p });
    expect(ev.urls).toEqual([n(ARXIV), n(PUBMED), n(OTHER), n(NATURE)]);
    expect(ev.fetched).toEqual([n(PUBMED), n(NATURE), n(ARXIV)]);
    expect(new Set(ev.urls).size).toBe(ev.urls.length);
    expect(Object.keys(ev.seen_as).sort()).toEqual([...ev.urls].sort());
  });

  it("P2 a URL's text is the pack's followed by the snapshot's, a newline between; one alone is as it is; the pack's empty text adds nothing", () => {
    const ev = buildEvidence({ snapshots: [snap(ARXIV, "The page's own text."), snap(NATURE, "Only the page."), snap(OTHER, "Page of an empty-pack URL.")], pack: p });
    expect(ev.texts[n(ARXIV)]).toBe("The pack's arXiv abstract.\nThe page's own text.");
    expect(ev.texts[n(PUBMED)]).toBe("The pack's PubMed abstract.");
    expect(ev.texts[n(NATURE)]).toBe("Only the page.");
    expect(ev.texts[n(OTHER)]).toBe("Page of an empty-pack URL.");
    const noSnapshotText = buildEvidence({ snapshots: [snap(ARXIV, "")], pack: p });
    expect(noSnapshotText.texts[n(ARXIV)]).toBe("The pack's arXiv abstract.");
    expect(Object.hasOwn(buildEvidence({ snapshots: [], pack: p }).texts, n(OTHER))).toBe(false);
  });

  it("P3 `seen_as` is the pack's for a pack URL (even one a snapshot read), else `fetched` for a snapshot's, else `search`", () => {
    const ev = buildEvidence({ snapshots: [snap(ARXIV, "a"), snap(NATURE, "n")], pack: p, resolved: { [OTHER + "/gone"]: "https://example.org/ut-sample/elsewhere" } });
    expect(ev.seen_as[n(ARXIV)]).toBe("pack");
    expect(ev.seen_as[n(PUBMED)]).toBe("pack");
    expect(ev.seen_as[n(NATURE)]).toBe("fetched");
    expect(ev.seen_as[n(OTHER + "/gone")]).toBe("search");
    // The pack's own marks pass through, whatever they are.
    const marked = buildEvidence({ snapshots: [], pack: pack({ urls: [ARXIV], seen_as: { [ARXIV]: "search" } }) });
    expect(marked.seen_as[n(ARXIV)]).toBe("search");
    // A pack URL the pack has no mark for is `search`, or `fetched` when the pack fetched it or a snapshot read it.
    const unmarked = buildEvidence({ snapshots: [snap(OTHER, "o")], pack: pack({ urls: [ARXIV, PUBMED, OTHER], fetched: [PUBMED] }) });
    expect(unmarked.seen_as).toEqual({ [n(ARXIV)]: "search", [n(PUBMED)]: "fetched", [n(OTHER)]: "fetched" });
  });

  it("P4 `types` are the pack's followed by the snapshot's, each once, in that order", () => {
    const ev = buildEvidence({
      snapshots: [snap(PUBMED, "p", { article_types: ["Review", "Journal Article"] }), snap(ARXIV, "a", { article_types: ["Preprint"] }), snap(NATURE, "n", { article_types: ["Article"] })],
      pack: p,
    });
    expect(ev.types).toEqual({
      [n(PUBMED)]: ["Journal Article", "Review"],
      [n(ARXIV)]: ["Preprint"],
      [n(NATURE)]: ["Article"],
    });
    // The pack's own empty list is not a type; a URL with no types at all is left out.
    expect(Object.hasOwn(buildEvidence({ snapshots: [], pack: p }).types, n(ARXIV))).toBe(false);
  });

  it("P5 the pack's `fetched` are kept and a snapshot's URL joins them without repeating", () => {
    const ev = buildEvidence({ snapshots: [snap(PUBMED, "p"), snap(PUBMED, "p again")], pack: p });
    expect(ev.fetched).toEqual([n(PUBMED)]);
  });
});

describe("buildEvidence with `resolved` from the step", () => {
  it("R1 the final URL of a GET that answered an error is kept for a URL with no snapshot, and the URL is a URL the run tried (not read)", () => {
    const ev = buildEvidence({ snapshots: [], resolved: { [NATURE_DOI]: NATURE } });
    expect(ev.resolved).toEqual({ [n(NATURE_DOI)]: NATURE });
    expect(ev.urls).toEqual([n(NATURE_DOI)]);
    expect(ev.fetched).toEqual([]);
    expect(ev.seen_as).toEqual({ [n(NATURE_DOI)]: "search" });
    expect(ev.texts).toEqual({});
  });

  it("R2 a snapshot's own entry wins over the input's, and a URL with a snapshot takes none from the input", () => {
    const ev = buildEvidence({
      snapshots: [snap(NATURE_DOI, "landing", { final_url: NATURE }), snap(ARXIV, "same page", { final_url: ARXIV })],
      resolved: { [NATURE_DOI]: "https://example.org/ut-sample/stale", [ARXIV]: "https://example.org/ut-sample/stale-too", [OTHER]: "https://example.org/ut-sample/landing" },
    });
    expect(ev.resolved).toEqual({ [n(NATURE_DOI)]: NATURE, [n(OTHER)]: "https://example.org/ut-sample/landing" });
  });

  it("R3 the input is keyed by normalised URL and is never changed", () => {
    const input = Object.freeze({ [`${NATURE_DOI}#frag`]: NATURE });
    const ev = buildEvidence({ snapshots: [], resolved: input });
    expect(ev.resolved).toEqual({ [n(NATURE_DOI)]: NATURE });
  });
});

describe("the evidence feeds the type check (§4.11)", () => {
  const typed = (types: string[], extra: Partial<Snapshot> = {}) => buildEvidence({ snapshots: [snap(NATURE, "page text", { article_types: types, ...extra })] });

  it("X1 a publisher's page whose snapshot found a fitting type passes, one whose type is a news type fails, and none found fails", () => {
    expect(articleTypeFits(NATURE, "paper", typed(["OriginalPaper"]), config)).toMatchObject({ status: "pass", branch: "publisher" });
    expect(articleTypeFits(NATURE, "paper", typed(["News And Views"]), config)).toMatchObject({ status: "fail", branch: "publisher", reason: "type_no_fit" });
    expect(articleTypeFits(NATURE, "paper", typed([]), config)).toMatchObject({ status: "fail", branch: "publisher", reason: "no_types" });
    expect(articleTypeFits(NATURE, "paper", null, config)).toMatchObject({ status: "skipped" });
    expect(primaryProblem(NATURE, "paper", config)).toBeNull();
  });

  it("X2 a doi.org URL is judged through the landing the evidence holds: a snapshot's final URL, or the step's `resolved`", () => {
    const viaSnapshot = buildEvidence({ snapshots: [snap(NATURE_DOI, "page", { final_url: NATURE, article_types: ["OriginalPaper"] })] });
    // The type check reads the landing's types under the landing's own key: the snapshot above is under the DOI, so the types
    // the DOI's GET found are looked up under the DOI and its landing both.
    expect(articleTypeFits(NATURE_DOI, "paper", viaSnapshot, config)).toMatchObject({ status: "pass", branch: "doi" });
    const noLanding = buildEvidence({ snapshots: [] });
    expect(articleTypeFits(NATURE_DOI, "paper", noLanding, config)).toMatchObject({ status: "fail", reason: "no_landing" });
    const errorLanding = buildEvidence({ snapshots: [], resolved: { [NATURE_DOI]: NATURE } });
    expect(articleTypeFits(NATURE_DOI, "paper", errorLanding, config)).toMatchObject({ status: "fail", reason: "no_types", landing: NATURE });
  });

  it("X3 the pack's PubMed `pubtype` and the page's types both count for a record", () => {
    const ev = buildEvidence({ snapshots: [], pack: pack({ urls: [PUBMED], texts: { [PUBMED]: "abstract" }, seen_as: { [PUBMED]: "pack" }, types: { [PUBMED]: ["Journal Article"] } }) });
    expect(articleTypeFits(PUBMED, "paper", ev, config)).toMatchObject({ status: "pass", branch: "record" });
    const news = buildEvidence({ snapshots: [], pack: pack({ urls: [PUBMED], types: { [PUBMED]: ["Journal Article", "News"] } }) });
    expect(articleTypeFits(PUBMED, "paper", news, config)).toMatchObject({ status: "fail", reason: "refused_pubtype" });
  });
});
