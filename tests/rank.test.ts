// Ranking (SPEC §5.9, lib/rank.ts): the 30-day drop, the merge, the score, the sort, the caps, the deep read and the reaction rule, on invented candidates
// whose addresses are the fixture world's (an invented marker in each). Pure: no clock, file or network. New for this project; the shape of the cases follows
// Cyber's tests/rank.test.ts at the fork commit 3ced1fb, adapted to this project's score and its caps.
import { describe, expect, it } from "vitest";
import {
  ABSTRACT_TERM_BONUS, DEEP_FIELD_MAX, FIELD_MAX, MERGE_JACCARD, REACTION_BONUS, TITLE_TERM_BONUS, USED_DAYS, arxivIdOf, baseScore, firstFindingId, instantOf, kindScore,
  noUsedSources, rankCandidates, reactionCovers, usedSources, type RankDraft, type RankInput, type UsedContent, type UsedSources,
} from "@/lib/rank";
import { Candidate } from "@/lib/schema/pack";
import { normalizeUrl } from "@/lib/urls";
import { FIELDS, type FieldId } from "@/lib/vocab";
import { realConfig } from "./helpers/feed-bodies";

const config = realConfig();
const PHRASES = config.index.aiPhrases;
const LIMITS = { candidates_max: 40, deep_read_max: 15 };

let seq = 0;
/** A draft: a paper by default, in mathematics, with no AI term, published in the window. The address and the title are unique unless given. */
function draft(over: Partial<RankDraft> = {}): RankDraft {
  seq += 1;
  const n = String(seq).padStart(3, "0");
  return {
    source_id: "arxiv-math", title: `Invented study t${n}a t${n}b t${n}c t${n}d`, abstract: "", url: `https://arxiv.org/abs/2610.99${n}`, doi: null, arxiv: `2610.99${n}`,
    trial: [], published_at: "2026-10-21T08:00:00+08:00", journal: null, fields: ["mathematics"], ai_terms_matched: [], journal_leading: false, types: [], stored_finding: null,
    flags: [], reaction: false, ...over,
  };
}

/** A DOI-addressed paper in a leading journal (an `10.1038/ut-sample-` address is a paper worth 5). */
function paper(n: number, over: Partial<RankDraft> = {}): RankDraft {
  const doi = `10.1038/ut-sample-${String(n).padStart(4, "0")}`;
  return draft({ source_id: "journal-nature", url: `https://doi.org/${doi}`, doi, arxiv: null, journal: "Nature", journal_leading: true, ...over });
}

const rank = (drafts: RankDraft[], over: Partial<RankInput> = {}) => rankCandidates({ drafts, used: noUsedSources(), config, aiPhrases: PHRASES, limits: LIMITS, ...over });
const used = (over: Partial<{ dois: string[]; arxiv: string[]; urls: string[] }> = {}): UsedSources => ({ dois: new Set(over.dois ?? []), arxiv: new Set(over.arxiv ?? []), urls: new Set(over.urls ?? []) });

describe("the base score of a kind", () => {
  it("scores each kind as §5.9 step 3 lists: a leading paper 5, a paper 3, a checker 4, a lab post 3, a preprint 2, a statement 2, the rest 0", () => {
    expect(kindScore("paper", true)).toBe(5);
    expect(kindScore("paper", false)).toBe(3);
    expect(kindScore("checker", false)).toBe(4);
    expect(kindScore("lab_post", false)).toBe(3);
    expect(kindScore("preprint", false)).toBe(2);
    expect(kindScore("statement", false)).toBe(2);
    for (const k of ["registry", "reaction", "notice", "dataset", "proof"] as const) expect(kindScore(k, true), k).toBe(0);
  });

  it("takes the best kind an address passes for, and 0 for a reaction or an address no kind lists", () => {
    expect(baseScore("https://arxiv.org/abs/2610.99001", false, config)).toBe(2);
    expect(baseScore("https://doi.org/10.1038/ut-sample-0001", true, config)).toBe(5);
    expect(baseScore("https://doi.org/10.1038/ut-sample-0001", false, config)).toBe(3);
    expect(baseScore("https://clinicaltrials.gov/study/NCT09990101", false, config)).toBe(4);
    expect(baseScore("https://www.lila.ai/news/ut-sample-launch", false, config)).toBe(3);
    expect(baseScore("https://www.eurekalert.org/news-releases/9990001", false, config)).toBe(2);
    expect(baseScore("https://doi.org/10.1038/ut-sample-0001", true, config, true)).toBe(0);
    expect(baseScore("https://example.com/a", true, config)).toBe(0);
  });

  it("holds the constants §5.9 names", () => {
    expect([MERGE_JACCARD, USED_DAYS, FIELD_MAX, DEEP_FIELD_MAX, TITLE_TERM_BONUS, ABSTRACT_TERM_BONUS, REACTION_BONUS]).toEqual([0.6, 30, 10, 3, 2, 1, 2]);
  });
});

describe("identifiers", () => {
  it("reads an arXiv id, with no version, from an abs or pdf address or an arXiv DOI, and nothing else", () => {
    for (const t of [
      "https://arxiv.org/abs/2610.99001", "https://arxiv.org/abs/2610.99001v3", "http://arxiv.org/abs/2610.99001", "https://export.arxiv.org/abs/2610.99001v2", "https://www.arxiv.org/pdf/2610.99001v1.pdf",
      "https://arxiv.org/pdf/2610.99001", "https://arxiv.org/abs/2610.99001/", "10.48550/arXiv.2610.99001", "https://doi.org/10.48550/arxiv.2610.99001v2",
    ]) expect(arxivIdOf(t), t).toBe("2610.99001");
    for (const [t, id] of [["https://arxiv.org/abs/1412.1234v2", "1412.1234"], ["10.48550/arxiv.1412.1234", "1412.1234"], ["https://arxiv.org/abs/2610.12345", "2610.12345"]] as const) expect(arxivIdOf(t), t).toBe(id);
    for (const t of ["https://arxiv.org/abs/2610.123456", "https://arxiv.org/abs/2610.123", "https://arxiv.org/abs/26100.12345", "https://arxiv.org/abs/261.12345", "10.48550/arxiv.2610.123456", "10.48550/arxiv.2610.123", "10.48550/arxiv.26100.12345"]) expect(arxivIdOf(t), t).toBeNull();
    for (const t of ["https://arxiv.org/list/math/new", "https://example.org/abs/2610.99001", "10.1038/ut-sample-0001", "", "https://arxiv.org/abs/hep-th/9901001"]) expect(arxivIdOf(t), t).toBeNull();
  });

  it("reads the instant of a published_at, a bare date being the start of that day in Taipei", () => {
    expect(instantOf("2026-10-21")).toBe(Date.parse("2026-10-20T16:00:00Z"));
    expect(instantOf("2026-10-21T08:00:00+08:00")).toBe(Date.parse("2026-10-21T00:00:00Z"));
    expect(instantOf("not a date")).toBe(Number.NEGATIVE_INFINITY);
  });

  it("picks the smallest finding id in the project's order", () => {
    expect(firstFindingId(["math-2026-0010", "phys-2026-0002", "bio-2026-0033", "hum-2025-0099"])).toBe("hum-2025-0099");
    expect(firstFindingId(["phys-2026-0002", "bio-2026-0002", "math-2026-0010"])).toBe("bio-2026-0002");
    expect(firstFindingId([])).toBeNull();
  });
});

describe("what the last 30 days used (step 1)", () => {
  const src = (url: string, doi: string | null = null) => ({ url, doi });
  const content: UsedContent = {
    briefs: [
      { date: "2026-10-21", story: { finding_id: "math-2026-0001" }, items: [{ finding_id: "math-2026-0002" }], sources: [src("https://arxiv.org/abs/2610.99001v2"), src("https://doi.org/10.1038/ut-sample-0001", "10.1038/UT-sample-0001")] },
      { date: "2026-09-22", story: null, items: [], sources: [src("https://arxiv.org/abs/2609.99002")] },
      { date: "2026-09-21", story: null, items: [], sources: [src("https://arxiv.org/abs/2609.99003")] },
      { date: "2026-10-22", story: null, items: [], sources: [src("https://arxiv.org/abs/2610.99004")] },
    ],
    findings: [
      { id: "math-2026-0001", sources: [{ ...src("https://www.lila.ai/news/ut-sample-launch"), added: "2026-01-02" }] },
      { id: "math-2026-0002", sources: [{ ...src("https://doi.org/10.1038/ut-sample-0002", "10.1038/ut-sample-0002"), added: "2026-01-03" }] },
      { id: "math-2026-0003", sources: [{ ...src("https://arxiv.org/abs/2610.99005"), added: "2026-10-10" }, { ...src("https://arxiv.org/abs/2610.99006"), added: "2026-09-01" }] },
      { id: "math-2026-0004", sources: [{ ...src("https://arxiv.org/abs/2610.99007"), added: "2026-10-22" }] },
      { id: "math-2026-0005", sources: [{ ...src("https://arxiv.org/abs/2609.99008"), added: "2026-09-22" }, { ...src("https://arxiv.org/abs/2609.99009"), added: "2026-09-21" }] },
    ],
  };
  const u = usedSources(content, "2026-10-22");

  it("counts the sources of the briefs dated from 30 days before to the day before, in every form (DOI, arXiv id without its version, normalised address)", () => {
    expect(u.arxiv.has("2610.99001")).toBe(true);
    expect(u.dois.has("10.1038/ut-sample-0001")).toBe(true);
    expect(u.urls.has(normalizeUrl("https://arxiv.org/abs/2609.99002"))).toBe(true);
  });

  it("does not count a brief 31 days back, a brief of the day itself or later, or a finding source added that day", () => {
    expect(u.urls.has(normalizeUrl("https://arxiv.org/abs/2609.99003"))).toBe(false);
    expect(u.urls.has(normalizeUrl("https://arxiv.org/abs/2610.99004"))).toBe(false);
    expect(u.arxiv.has("2610.99007")).toBe(false);
  });

  it("counts every source of a finding a counted brief shows, however old, and the sources added in the window of any finding", () => {
    expect(u.urls.has(normalizeUrl("https://www.lila.ai/news/ut-sample-launch"))).toBe(true);
    expect(u.dois.has("10.1038/ut-sample-0002")).toBe(true);
    expect(u.arxiv.has("2610.99005")).toBe(true);
    expect(u.arxiv.has("2610.99006")).toBe(false);
  });

  it("counts a finding source added on the first day of the window (30 days back) and not one added the day before", () => {
    expect(u.arxiv.has("2609.99008")).toBe(true);
    expect(u.arxiv.has("2609.99009")).toBe(false);
  });

  it("reads another day's window for a past date, so a rerun sees what that morning saw", () => {
    expect(usedSources(content, "2026-10-21").arxiv.has("2610.99001")).toBe(false);
    expect(usedSources(content, "2026-10-23").arxiv.has("2610.99004")).toBe(true);
    expect(usedSources(content, "2026-10-22", 1).urls.has(normalizeUrl("https://arxiv.org/abs/2609.99002"))).toBe(false);
  });
});

describe("the drops (step 1)", () => {
  it("drops a draft whose DOI, arXiv id (with or without a version, or as an arXiv DOI) or address a brief used, saying which", () => {
    const byDoi = paper(1);
    const byArxiv = draft();
    const byArxivDoi = draft({ url: "https://arxiv.org/abs/2610.99777v3", arxiv: "2610.99777" });
    const byUrl = draft({ url: "https://www.lila.ai/news/ut-sample-launch?utm_source=x#top", source_id: "lab-lila-sciences", arxiv: null });
    const keep = draft();
    const r = rank([byDoi, byArxiv, byArxivDoi, byUrl, keep], {
      used: used({ dois: [byDoi.doi!], arxiv: [byArxiv.arxiv!, "2610.99777"], urls: [normalizeUrl("https://www.lila.ai/news/ut-sample-launch")] }),
    });
    expect(r.kept.map((c) => c.url)).toEqual([keep.url]);
    expect(r.dropped.map((d) => [d.url, d.reason]).sort()).toEqual([
      [byArxiv.url, "used_arxiv"], [byArxivDoi.url, "used_arxiv"], [byDoi.url, "used_doi"], [byUrl.url, "used_url"],
    ].sort());
  });

  it("finds a used arXiv id in an address when the draft carries no arxiv field", () => {
    const d = draft({ arxiv: null, url: "https://arxiv.org/abs/2610.99888v2" });
    expect(rank([d], { used: used({ arxiv: ["2610.99888"] }) }).dropped.map((x) => x.reason)).toEqual(["used_arxiv"]);
  });

  it("finds a used arXiv id in a draft's arXiv DOI when it carries neither an arxiv field nor an arXiv address", () => {
    const d = draft({ arxiv: null, url: "https://doi.org/10.48550/arxiv.2610.99889v2", doi: "10.48550/arxiv.2610.99889v2" });
    expect(rank([d], { used: used({ arxiv: ["2610.99889"] }) }).dropped.map((x) => x.reason)).toEqual(["used_arxiv"]);
    expect(rank([d], { used: used({ arxiv: ["2610.99890"] }) }).dropped).toEqual([]);
  });

  it("finds a used arXiv id in an arXiv DOI even when the address is another primary page", () => {
    const d = draft({ arxiv: null, source_id: "lab-lila-sciences", url: "https://www.lila.ai/news/ut-sample-launch-b", doi: "10.48550/arxiv.2610.99891v1" });
    expect(rank([d], { used: used({ arxiv: ["2610.99891"] }) }).dropped.map((x) => x.reason)).toEqual(["used_arxiv"]);
    expect(rank([d], { used: used({ arxiv: ["2610.99892"] }) }).dropped).toEqual([]);
  });

  it("drops an address that is not primary, with its reason", () => {
    const press = draft({ url: "https://www.nytimes.com/ut-sample/x", arxiv: null });
    const unlisted = draft({ url: "https://example.com/ut-sample/x", arxiv: null });
    const r = rank([press, unlisted]);
    expect(r.kept).toEqual([]);
    expect(r.dropped.map((d) => d.reason).sort()).toEqual(["not_primary:press_host", "not_primary:unlisted"]);
  });

  it("keeps a draft that shares only a trial number with a stored finding, with its stored_finding as given", () => {
    const d = draft({ url: "https://clinicaltrials.gov/study/NCT09990101", arxiv: null, trial: ["NCT09990101"], stored_finding: "math-2026-0007", source_id: "ctgov" });
    const r = rank([d], { used: used({ urls: [], dois: [], arxiv: [] }) });
    expect(r.dropped).toEqual([]);
    expect(r.kept[0]!.stored_finding).toBe("math-2026-0007");
    expect(r.kept[0]!.trial).toEqual(["NCT09990101"]);
  });

  it("sorts the dropped list by address then feed, whatever the input order", () => {
    const a = draft({ url: "https://www.nytimes.com/ut-sample/b", arxiv: null, source_id: "x-b" });
    const b = draft({ url: "https://www.nytimes.com/ut-sample/a", arxiv: null, source_id: "x-z" });
    const c = draft({ url: "https://www.nytimes.com/ut-sample/a", arxiv: null, source_id: "x-a" });
    expect(rank([a, b, c]).dropped.map((d) => `${d.url} ${d.source_id}`)).toEqual([
      "https://www.nytimes.com/ut-sample/a x-a", "https://www.nytimes.com/ut-sample/a x-z", "https://www.nytimes.com/ut-sample/b x-b",
    ]);
  });
});

describe("the merge (step 2)", () => {
  it("joins two drafts with one DOI, keeping the best base score as the survivor and recording the copy's address", () => {
    const journal = paper(5, { title: "An invented study of learned lattices" });
    const preprint = draft({ source_id: "biorxiv", doi: journal.doi, arxiv: null, url: "https://www.biorxiv.org/content/10.1101/2026.10.20.99001v1", title: "Quite another title altogether" });
    const r = rank([preprint, journal]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.url).toBe(journal.url);
    expect(r.merged).toEqual([{
      into: "cand-01", into_url: journal.url, source_id: "biorxiv", url: preprint.url, title: preprint.title, doi: journal.doi, arxiv: null,
      published_at: preprint.published_at, types: [], reason: "doi",
    }]);
  });

  it("joins a draft to a group by the DOI of an earlier copy, not only the survivor's", () => {
    const a = paper(80, { title: "wording one two three four five" });
    const b = draft({ title: "wording one two three four five", doi: "10.1000/ut-sample-0801", arxiv: null, url: "https://www.biorxiv.org/content/10.1101/2026.10.20.99801v1", source_id: "biorxiv" });
    const c = draft({ title: "wholly other words appear in this one", doi: "10.1000/ut-sample-0801", arxiv: null, url: "https://www.biorxiv.org/content/10.1101/2026.10.20.99802v1", source_id: "biorxiv" });
    const r = rank([a, b, c]);
    expect(r.kept).toHaveLength(1);
    expect(r.merged.map((m) => [m.url, m.reason]).sort()).toEqual([[b.url, "title"], [c.url, "doi"]].sort());
  });

  it("lists the merged copies by the address they joined, then their own address, whatever order the drafts came in", () => {
    const a = paper(81, { title: "alpha one two three four" });
    const b = paper(82, { title: "bravo five six seven eight" });
    // The feed ids run against the address order, so a sort by feed id ahead of the address would show.
    const copies = (of: RankDraft, ids: string[]) => ids.map((id, i) => draft({ title: of.title, arxiv: null, source_id: i === 0 ? "arxiv-math" : "arxiv-physics", url: `https://arxiv.org/abs/${id}` }));
    // The copies of the later survivor have the lower addresses, so a sort by address alone would put them first.
    const ac = copies(a, ["2610.99922", "2610.99921"]); const bc = copies(b, ["2610.99912", "2610.99911"]);
    for (const drafts of [[a, b, ...ac, ...bc], [...bc.slice().reverse(), ...ac.slice().reverse(), b, a]]) {
      const r = rank(drafts);
      expect(r.merged.map((m) => [m.into_url, m.url])).toEqual([
        [a.url, ac[1]!.url], [a.url, ac[0]!.url], [b.url, bc[1]!.url], [b.url, bc[0]!.url],
      ]);
    }
  });

  it("joins two drafts with one arXiv id (an arXiv paper and a feed's copy of it)", () => {
    const a = draft({ arxiv: "2610.99500", url: "https://arxiv.org/abs/2610.99500", title: "First wording of an invented title" });
    const b = draft({ arxiv: "2610.99500", url: "https://arxiv.org/abs/2610.99500v2", source_id: "arxiv-physics", title: "Entirely different words here" });
    const r = rank([a, b]);
    expect(r.kept).toHaveLength(1);
    expect(r.merged.map((m) => m.reason)).toEqual(["arxiv"]);
  });

  it("joins titles at a Jaccard of 0.6 or more (exactly 0.6 joins) and keeps two that share less", () => {
    const small = draft({ title: "alpha beta gamma" });
    // Three of five words shared: exactly 0.6, joined.
    const edge = draft({ title: "alpha beta gamma delta epsilon", url: "https://arxiv.org/abs/2610.99601", arxiv: "2610.99601" });
    // Four of seven shared (0.57): kept apart, from the survivor and from the edge copy alike.
    const far = draft({ title: "alpha beta gamma delta zeta eta theta", url: "https://arxiv.org/abs/2610.99602", arxiv: "2610.99602" });
    const r = rank([small, edge, far]);
    expect(r.merged.map((m) => [m.title, m.reason])).toEqual([[edge.title, "title"]]);
    expect(r.kept.map((c) => c.title).sort()).toEqual([small.title, far.title].sort());
  });

  it("prefers a copy with a DOI, then the newest, when the base scores tie", () => {
    const noDoi = draft({ title: "same words in a title of an invented paper", published_at: "2026-10-21T09:00:00+08:00" });
    const withDoi = draft({ title: "same words in a title of an invented paper", doi: "10.1000/ut-sample-0001", url: "https://arxiv.org/abs/2610.99701", arxiv: "2610.99701", published_at: "2026-10-21T03:00:00+08:00" });
    expect(rank([noDoi, withDoi]).kept[0]!.doi).toBe("10.1000/ut-sample-0001");
    const old = draft({ title: "another wording that matches fully here", published_at: "2026-10-20T03:00:00+08:00" });
    const fresh = draft({ title: "another wording that matches fully here", published_at: "2026-10-21T03:00:00+08:00" });
    expect(rank([old, fresh]).kept[0]!.url).toBe(fresh.url);
  });

  it("gives the survivor what its copy knows: fields, terms, types, flags, the leading mark, DOI, abstract and stored finding", () => {
    const pre = draft({ title: "a learned model of invented proteins", fields: ["biology"], ai_terms_matched: ["learned model"], types: ["preprint"], abstract: "An abstract from the copy.", stored_finding: "math-2026-0009" });
    const journal = paper(8, { title: "a learned model of invented proteins", fields: ["chemistry"], journal_leading: true, flags: ["injection_like"], doi: null, arxiv: null });
    const r = rank([pre, journal]);
    const c = r.kept[0]!;
    expect(c.url).toBe(journal.url);
    expect(c.fields).toEqual(["chemistry", "biology"]);
    expect(c.ai_terms_matched).toEqual(["learned model"]);
    expect(c.types).toEqual(["preprint"]);
    expect(c.flags).toEqual(["injection_like"]);
    expect(c.abstract).toBe("An abstract from the copy.");
    expect(c.stored_finding).toBe("math-2026-0009");
    expect(c.journal_leading).toBe(true);
  });

  it("merges a copy into a survivor by any arXiv id the group has gathered from an earlier copy", () => {
    const a = paper(60, { title: "first wording of sixty here" });
    const b = draft({ doi: a.doi, arxiv: "2610.99860", url: "https://arxiv.org/abs/2610.99860", title: "second wording unlike gamma delta" });
    const c = draft({ doi: null, arxiv: "2610.99860", url: "https://www.biorxiv.org/content/10.1101/2026.10.20.99860v1", title: "third wording unlike epsilon zeta", source_id: "biorxiv" });
    const r = rank([a, b, c]);
    expect(r.kept).toHaveLength(1);
    expect(r.merged.map((m) => m.reason).sort()).toEqual(["arxiv", "doi"]);
  });

  it("merges a copy into a survivor by any DOI the group has gathered, and records into null when the survivor is cut", () => {
    const a = paper(10, { title: "first wording of the study here" });
    const b = draft({ doi: "10.1000/ut-sample-0010", arxiv: "2610.99810", url: "https://arxiv.org/abs/2610.99810", title: "second wording of the study there", source_id: "arxiv-math" });
    const c = draft({ doi: "10.1000/ut-sample-0010", arxiv: null, url: "https://www.biorxiv.org/content/10.1101/2026.10.20.99810v1", title: "third wording differs", source_id: "biorxiv" });
    const joined = rank([a, b, c]);
    expect(joined.kept).toHaveLength(2);
    const cut = rank([paper(11), a, b, c], { limits: { candidates_max: 1, deep_read_max: 15 } });
    expect(cut.kept.map((x) => x.url)).toEqual([a.url]);
    expect(cut.cut.map((x) => x.reason)).toContain("below_cap");
    // The survivor kept, so the copies point at it; cut it and they point at nothing.
    const lone = rank([paper(12), draft({ doi: "10.1038/ut-sample-0012", title: "sample copy of twelve", source_id: "biorxiv", url: "https://www.biorxiv.org/content/10.1101/2026.10.20.99812v1", arxiv: null })], { limits: { candidates_max: 0, deep_read_max: 15 } });
    expect(lone.kept).toEqual([]);
    expect(lone.merged.map((m) => m.into)).toEqual([null]);
  });
});

describe("the score and the order (steps 3 and 4)", () => {
  it("adds 2 for an AI phrase in the title and 1 for one in the abstract (a phrase in both counts both)", () => {
    const none = draft();
    const title = draft({ title: "A machine learning surrogate for invented plasma" });
    const abstract = draft({ abstract: "We train a neural network on invented data." });
    const both = draft({ title: "A deep learning study of sample spectra", abstract: "A neural network is trained." });
    const scores = new Map(rank([none, title, abstract, both]).kept.map((c) => [c.url, c.score]));
    expect(scores.get(none.url)).toBe(2);
    expect(scores.get(title.url)).toBe(4);
    expect(scores.get(abstract.url)).toBe(3);
    expect(scores.get(both.url)).toBe(5);
  });

  it("sorts by score, then the newest, then the address, then the feed, and numbers the ids cand-01 on", () => {
    const hi = paper(20);
    const newer = draft({ published_at: "2026-10-21T10:00:00+08:00" });
    const older = draft({ published_at: "2026-10-21T01:00:00+08:00", url: "https://arxiv.org/abs/2610.99950", arxiv: "2610.99950" });
    const same = draft({ published_at: "2026-10-21T01:00:00+08:00", url: "https://arxiv.org/abs/2610.99900", arxiv: "2610.99900" });
    // Two feeds' drafts of one address (no shared DOI or arXiv id, other titles) tie on everything but the feed.
    const x = draft({ source_id: "feed-y", arxiv: null, url: "https://arxiv.org/abs/2610.99800", published_at: "2026-10-21T01:00:00+08:00" });
    const y = draft({ source_id: "feed-x", arxiv: null, url: "https://arxiv.org/abs/2610.99800", published_at: "2026-10-21T01:00:00+08:00" });
    const r = rank([older, x, same, newer, y, hi]);
    expect(r.kept.map((c) => c.id)).toEqual(["cand-01", "cand-02", "cand-03", "cand-04", "cand-05", "cand-06"]);
    expect(r.kept.map((c) => [c.url, c.source_id])).toEqual([
      [hi.url, "journal-nature"], [newer.url, "arxiv-math"], ["https://arxiv.org/abs/2610.99800", "feed-x"], ["https://arxiv.org/abs/2610.99800", "feed-y"],
      ["https://arxiv.org/abs/2610.99900", "arxiv-math"], ["https://arxiv.org/abs/2610.99950", "arxiv-math"],
    ]);
    expect(r.kept[0]!.score).toBe(5);
  });

  it("returns the same result whatever order the drafts come in", () => {
    const drafts = [paper(30), draft(), draft({ title: "machine learning invented" }), draft(), paper(31, { title: "deep learning of invented lattices" })];
    const forward = rank(drafts);
    const reversed = rank([...drafts].reverse());
    expect(reversed).toEqual(forward);
  });

  it("produces candidates the pack's schema accepts", () => {
    const r = rank([paper(40), draft({ title: "machine learning in sample plasma" })]);
    for (const c of r.kept) expect(Candidate.safeParse(c).success, c.id).toBe(true);
  });
});

describe("the caps (steps 4 and 5)", () => {
  /** n drafts in one field, each with its own address and words (so none merges), the dates falling by the hour so the order is the index. */
  const inField = (n: number, field: FieldId, source = "arxiv-physics", over: (i: number) => Partial<RankDraft> = () => ({})): RankDraft[] =>
    Array.from({ length: n }, (_, i) => draft({ source_id: source, fields: [field], published_at: `2026-10-21T${String(23 - (i % 24)).padStart(2, "0")}:00:00+08:00`, ...over(i) }));

  it("keeps at most 10 candidates for a field and cuts the rest as field_full, naming the field and logging it once", () => {
    const r = rank(inField(13, "physics"));
    expect(r.kept).toHaveLength(10);
    expect(r.cut).toHaveLength(3);
    expect(r.cut.every((c) => c.reason === "field_full" && c.field === "physics")).toBe(true);
    expect(r.log).toEqual([{ code: "FIELD_FULL", detail: expect.stringContaining("physics") }]);
  });

  it("counts a candidate in every field it carries, and cuts it when any of them is full", () => {
    // Ten physics papers fill the field; an eleventh that is also chemistry is cut for it, though chemistry is empty, and chemistry stays empty.
    const both = draft({ fields: ["physics", "chemistry"], published_at: "2026-10-20T01:00:00+08:00" });
    const r = rank([...inField(10, "physics"), both]);
    expect(r.kept).toHaveLength(10);
    expect(r.kept.some((c) => c.fields.includes("chemistry"))).toBe(false);
    expect(r.cut).toEqual([expect.objectContaining({ url: both.url, reason: "field_full", field: "physics" })]);
  });

  it("keeps at most candidates_max in all, cutting the rest as below_cap with a CAP_REACHED line", () => {
    const drafts = FIELDS.flatMap((f, i) => inField(7, f, `feed-${i}`));
    const r = rank(drafts);
    expect(r.kept).toHaveLength(40);
    expect(r.cut.filter((c) => c.reason === "below_cap")).toHaveLength(49 - 40);
    expect(r.log.some((l) => l.code === "CAP_REACHED")).toBe(true);
    const small = rank(drafts, { limits: { candidates_max: 5, deep_read_max: 15 } });
    expect(small.kept).toHaveLength(5);
  });

  it("marks the first 15 candidates, at most 3 for each field, for a deep read", () => {
    const drafts = FIELDS.flatMap((f, i) => inField(5, f, `feed-${i}`));
    const r = rank(drafts);
    const deep = r.kept.filter((c) => c.deep_read);
    expect(deep.length).toBeLessThanOrEqual(15);
    for (const f of FIELDS) expect(deep.filter((c) => c.fields.includes(f)).length, f).toBeLessThanOrEqual(3);
    expect(deep).toHaveLength(15);
    // A candidate is passed over, not stopped at, when its field has its 3.
    const oneField = rank(inField(6, "physics"));
    expect(oneField.kept.filter((c) => c.deep_read)).toHaveLength(3);
    const few = rank(drafts, { limits: { candidates_max: 40, deep_read_max: 2 } });
    expect(few.kept.filter((c) => c.deep_read)).toHaveLength(2);
  });

  it("skips a candidate of a multi-field kind from the deep read when any of its fields is at 3", () => {
    const three = inField(3, "physics");
    const two = draft({ fields: ["physics", "chemistry"], published_at: "2026-10-20T01:00:00+08:00" });
    const r = rank([...three, two]);
    expect(r.kept.find((c) => c.url === two.url)!.deep_read).toBe(false);
  });
});

describe("a scientist's reaction (§5.9, §4.14)", () => {
  const reaction = (over: Partial<RankDraft> = {}): RankDraft => draft({
    source_id: "smc-reactions", reaction: true, fields: [], arxiv: null, url: "https://www.sciencemediacentre.org/expert-reaction-to-ut-sample/", types: [], ...over,
  });

  it("covers a candidate whose DOI, arXiv id or trial number its text holds", () => {
    const ids = { dois: ["10.1038/ut-sample-0001"], arxiv: ["2610.99001"], trial: ["NCT09990101"] };
    expect(reactionCovers({ title: "t", abstract: "see 10.1038/UT-SAMPLE-0001 for the paper", trial: [] }, ids)).toBe(true);
    expect(reactionCovers({ title: "arXiv:2610.99001v2 is the preprint", abstract: "", trial: [] }, ids)).toBe(true);
    expect(reactionCovers({ title: "t", abstract: "", trial: ["NCT09990101"] }, ids)).toBe(true);
    // A DOI as an address, at the end of a sentence, in brackets and before a comma is a mention.
    for (const text of ["https://doi.org/10.1038/ut-sample-0001", "the paper (10.1038/ut-sample-0001), then", "paper 10.1038/ut-sample-0001.", "doi:10.1038/ut-sample-0001\nnext"]) {
      expect(reactionCovers({ title: text, abstract: "", trial: [] }, ids), text).toBe(true);
    }
    // A DOI that is the start or the tail of another one is no mention.
    for (const text of ["10.1038/ut-sample-00012", "10.1038/ut-sample-0001-b", "10.1038/ut-sample-0001/v2", "10.1038/ut-sample-0001.v2", "x10.1038/ut-sample-0001", "10.1038/ut-sample-0001_x"]) {
      expect(reactionCovers({ title: text, abstract: "", trial: [] }, ids), text).toBe(false);
    }
    // An id that is the tail of a longer number is no mention.
    expect(reactionCovers({ title: "12610.99001 and 2610.990012", abstract: "", trial: [] }, ids)).toBe(false);
    expect(reactionCovers({ title: "nothing", abstract: "", trial: ["NCT09990102"] }, ids)).toBe(false);
  });

  it("gives a reaction the fields of the candidates it covers, and those candidates 2 more points", () => {
    const p = paper(50, { fields: ["biology"] });
    const q = draft({ fields: ["chemistry"], doi: "10.1000/ut-sample-0051", arxiv: null, url: "https://doi.org/10.1000/ut-sample-0051", title: "a distinct paper about invented enzymes" });
    const r = reaction({ title: "Expert reaction to a paper", abstract: `The study ${p.doi} and ${q.doi} are covered.` });
    const out = rank([p, q, r]);
    const rc = out.kept.find((c) => c.source_id === "smc-reactions")!;
    expect(rc.fields.sort()).toEqual(["biology", "chemistry"]);
    expect(out.kept.find((c) => c.url === p.url)!.score).toBe(5 + REACTION_BONUS);
    expect(rc.score).toBe(0);
  });

  it("scores a covering reaction by the AI terms in its own title (2) and abstract (1)", () => {
    const phrase = PHRASES[0]!;
    const p = paper(70);
    const run = (over: Partial<RankDraft>) => rank([p, reaction({ title: "Expert reaction to a paper", abstract: `About ${p.doi}.`, ...over })]).kept.find((c) => c.source_id === "smc-reactions")!.score;
    expect(run({})).toBe(0);
    expect(run({ title: `Expert reaction to ${phrase} work` })).toBe(TITLE_TERM_BONUS);
    expect(run({ abstract: `About ${p.doi}, using ${phrase}.` })).toBe(ABSTRACT_TERM_BONUS);
    expect(run({ title: `Expert reaction to ${phrase} work`, abstract: `About ${p.doi}, using ${phrase}.` })).toBe(TITLE_TERM_BONUS + ABSTRACT_TERM_BONUS);
  });

  it("drops a reaction that covers nothing, as reaction_alone", () => {
    const out = rank([paper(60), reaction({ title: "A reaction to something else", abstract: "no identifiers here" })]);
    expect(out.kept).toHaveLength(1);
    expect(out.dropped.map((d) => d.reason)).toEqual(["reaction_alone"]);
  });

  it("drops a reaction whose covered candidate was itself dropped (it covers only what is ranked)", () => {
    const p = paper(70);
    const out = rank([p, reaction({ abstract: `About ${p.doi}.` })], { used: used({ dois: [p.doi!] }) });
    expect(out.kept).toEqual([]);
    expect(out.dropped.map((d) => d.reason).sort()).toEqual(["reaction_alone", "used_doi"]);
  });
});
