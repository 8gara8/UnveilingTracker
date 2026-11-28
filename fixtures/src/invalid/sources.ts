// F and T fixtures for the sources rule group (SPEC §4.12 "Fixtures and tests"): PRIMARY_ONLY, SOURCE_SEEN, SOURCE_URL, GO_DEEPER and
// FIGURE_LICENCE. Every code of the group is hard (H), so `sourcesSoft` is empty: no code of the group has a soft gate, and the
// warning PRIMARY_ONLY's type check raises when a run has no evidence file is the engine's INPUT_MISSING, not a code of the group.
//
//   F (`sourcesCases`)  one mutation of the weekday draft per code, written to fixtures/drafts/invalid--<CODE>.json. Each fails
//                       `validateDraft()` with the weekday's inputs on exactly that code, and no other error and no warning. A
//                       mutation can change the draft only, never the weekday's evidence, so it either uses a URL the evidence
//                       already holds (PRIMARY_ONLY, SOURCE_URL) or adds a source no quote, number or rung entry depends on
//                       (SOURCE_SEEN), so that no other rule has a reason to fire.
//   T (`sourcesNamed`)  the sub-conditions of each row that one F case cannot show, and the checks the weekday draft cannot reach:
//                       a brief's own sources (the Sunday's deep dive and the Monday's review), the `source_url` of a draft correction
//                       (judged by PRIMARY_ONLY, SOURCE_SEEN and SOURCE_URL as a source's `url` is), a `doi.org` landing, an article
//                       type that fits another kind. Each states the exact set of errors and warnings, so it also shows which
//                       rule leaves a URL to which (SPEC §4.12 BLOCKED_HOST: a URL that SOURCE_URL or BLOCKED_HOST fails is
//                       skipped by PRIMARY_ONLY, SOURCE_SEEN and FIGURE_LICENCE's host test, so each problem is told once).
//
// A published-mode case (a stored record being published or not, a `removed` correction that rewrote a URL, a licence quote) works on
// a copy of the sample content and is not here (SPEC §4.12 "Stored records" and "Removed text").
//
// Every URL here is invented and marked SAMPLE in its path, and none leads to a real page: the URLs a case adds or changes sit on
// the hosts the sample world and `config/` already use (a press host or an unlisted one only where a row needs it, with an invented
// path), and no case cites an exploit, paste or leak page. A case that adds a source gives it the next id, so SOURCE_IDS stays quiet.
//
// Cyber's fixtures/src/invalid/words-sources.ts at the fork commit 3ced1fb, adapted: the file's role, a list of mutations of the
// weekday draft with a one-line reason for each, and its helper that finds a source by id (and throws when the draft's shape
// changes, so a case never mutates the wrong source) are the same; its cases are this project's.

import type { DraftBrief, DraftFinding } from "../../../lib/schema/draft";
import type { DraftSource } from "../../../lib/schema/common";
import type { InvalidCase, NamedCase, SoftCase } from "../build";
import { WEEKDAY_ITEMS, newFindingOf } from "../drafts";

const I = WEEKDAY_ITEMS;

/** A source of a finding or of the brief by its id; throws when the draft's shape changes, so a case never mutates the wrong source. */
function sourceIn(sources: DraftSource[], id: string): DraftSource {
  const s = sources.find((x) => x.id === id);
  if (s === undefined) throw new Error(`The draft has no source ${id}`);
  return s;
}

/** Appends a source with the next id of its list (`s5` after `s4`, `b7` after `b6`) and returns its id. */
function addSource(sources: DraftSource[], prefix: "s" | "b", s: Omit<DraftSource, "id">): string {
  const id = `${prefix}${sources.length + 1}`;
  sources.push({ id, ...s });
  return id;
}

/** An invented SAMPLE source of `kind` at `url`, for a case that adds one; published the day before the weekday's edition. */
const sample = (kind: DraftSource["kind"], url: string, publisher: string): Omit<DraftSource, "id"> => ({
  kind, title: `SAMPLE: a page for the ${publisher} case`, publisher, url, doi: null, published_at: "2026-10-13T08:00:00+08:00",
});

/** Adds a source to a new finding and puts its id in the finding's Go deeper, so that no source stands unused. */
function addCited(f: DraftFinding, s: Omit<DraftSource, "id">): string {
  const id = addSource(f.sources, "s", s);
  f.go_deeper = [...f.go_deeper, id];
  return id;
}

const story = (d: DraftBrief): DraftFinding => newFindingOf(d, I.story);
const result = (d: DraftBrief): DraftFinding => newFindingOf(d, I.result);
const setback = (d: DraftBrief): DraftFinding => newFindingOf(d, I.setback);
const claimed = (d: DraftBrief): DraftFinding => newFindingOf(d, I.claimed);

/** A draft correction by its place in the draft; throws when the draft's shape changes, so a case never mutates the wrong one. */
function correctionIn(d: DraftBrief, index: number): DraftBrief["corrections"][number] {
  const c = d.corrections[index];
  if (c === undefined) throw new Error(`The draft has no correction at ${index}`);
  return c;
}

/** The page the weekday's first correction cites (a paper's page, in the pack), without its scheme. */
const TILING_PAGE = "www.cambridge.org/core/journals/ut-sample-journal-of-tiling-theory/article/ut-sample-0013";

/** The story's university release on eurekalert.org (kind `statement`, in the pack, cited only by its Go deeper). */
const release = (d: DraftBrief): DraftSource => sourceIn(story(d).sources, "s4");

export const sourcesCases: readonly InvalidCase[] = [
  {
    // The university's release on eurekalert.org typed as a paper: the URL passes for `statement` only (an institution's own release).
    code: "PRIMARY_ONLY", file: "invalid--PRIMARY_ONLY.json",
    mutate: (d) => {
      release(d).kind = "paper";
    },
  },
  {
    // A preprint the run never opened: an arXiv page (a listed host, no article type to check) that is in no pack, search or fetch.
    // It is added to the claimed finding as a Go deeper, so that no quote, number or rung entry rests on a page the run lacks.
    code: "SOURCE_SEEN", file: "invalid--SOURCE_SEEN.json",
    mutate: (d) => {
      addCited(claimed(d), sample("preprint", "https://arxiv.org/abs/2610.99777", "arXiv"));
    },
  },
  {
    // The university's release cited over http: the same page, which the evidence holds as https, so only the scheme is wrong.
    code: "SOURCE_URL", file: "invalid--SOURCE_URL.json",
    mutate: (d) => {
      release(d).url = "http://www.eurekalert.org/news-releases/ut-sample-0003";
    },
  },
  {
    // The story's Go deeper names a reaction (the Science Media Centre's expert reaction, s3), which is no kind a reader is sent to.
    code: "GO_DEEPER", file: "invalid--GO_DEEPER.json",
    mutate: (d) => {
      story(d).go_deeper = ["s1", "s3"];
    },
  },
  {
    // The figure's image on a host that is not in `figure_hosts` (the licence quote is untouched, so only the host is wrong).
    code: "FIGURE_LICENCE", file: "invalid--FIGURE_LICENCE.json",
    mutate: (d) => {
      story(d).figure!.image_url = "https://example.org/ut-sample/scroll-figure-2.png";
    },
  },
];

export const sourcesSoft: readonly SoftCase[] = [];

/** The set of codes a case must give: one error code, and no other error and no warning. */
const only = (code: string) => ({ errors: [code], warnings: [] as string[] });

export const sourcesNamed: readonly NamedCase[] = [
  // ── SOURCE_URL: each clause of the row ──
  {
    name: "SOURCE_URL: a source URL with user info",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      release(d).url = "https://reader@www.eurekalert.org/news-releases/ut-sample-0003";
    },
  },
  {
    name: "SOURCE_URL: a redirect wrapper (the entry is SOURCE_URL's, not BLOCKED_HOST's)",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      addCited(story(d), sample("statement", "https://news.google.com/rss/articles/ut-sample-0003", "Eastvale University"));
    },
  },
  {
    name: "SOURCE_URL: an archive copy of a page the run saw (the entry is SOURCE_URL's, and SOURCE_SEEN leaves it alone)",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      release(d).url = "https://web.archive.org/web/20261013120000/https://www.eurekalert.org/news-releases/ut-sample-0003";
    },
  },
  {
    name: "SOURCE_URL: two sources of one finding with one page after normalizeUrl()",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      addCited(story(d), sample("statement", "https://eurekalert.org/news-releases/ut-sample-0003/?utm_source=sample", "Eastvale University"));
    },
  },
  {
    name: "SOURCE_URL: two brief sources with one page after normalizeUrl()",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      addSource(d.sources, "b", sample("dataset", "https://zenodo.org/records/99900003/", "Zenodo"));
    },
  },

  // ── SOURCE_URL, PRIMARY_ONLY and SOURCE_SEEN on a correction's source_url, which a correction judges as a source's url ──
  {
    name: "SOURCE_URL: a correction's source_url over http (the same page the evidence holds)",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      correctionIn(d, 0).source_url = `http://${TILING_PAGE}`;
    },
  },
  {
    name: "SOURCE_URL: a correction's source_url with user info",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      correctionIn(d, 0).source_url = `https://reader@${TILING_PAGE}`;
    },
  },
  {
    name: "SOURCE_URL: a correction's source_url on a redirect wrapper (the entry is SOURCE_URL's, not BLOCKED_HOST's)",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      correctionIn(d, 1).source_url = "https://news.google.com/rss/articles/ut-sample-0013";
    },
  },
  {
    name: "SOURCE_URL: a correction's source_url that is an archive copy of a page the run saw (SOURCE_URL's, and the other codes leave it alone)",
    code: "SOURCE_URL", edition: "weekday", expect: only("SOURCE_URL"),
    mutate: (d) => {
      correctionIn(d, 0).source_url = `https://web.archive.org/web/20261013120000/https://${TILING_PAGE}`;
    },
  },
  {
    name: "PRIMARY_ONLY: a correction's source_url on a news site (and a page the run never saw)",
    code: "PRIMARY_ONLY", edition: "weekday", expect: { errors: ["PRIMARY_ONLY", "SOURCE_SEEN"], warnings: [] },
    mutate: (d) => {
      correctionIn(d, 1).source_url = "https://phys.org/news/ut-sample-correction.html";
    },
  },
  {
    name: "PRIMARY_ONLY: a correction's source_url on a Nature article whose page shows no article type",
    code: "PRIMARY_ONLY", edition: "weekday", expect: only("PRIMARY_ONLY"),
    mutate: (d) => {
      correctionIn(d, 0).source_url = "https://www.nature.com/articles/nature-ut-sample-0090";
    },
  },
  {
    name: "SOURCE_SEEN: a correction's source_url on a preprint page the run never saw",
    code: "SOURCE_SEEN", edition: "weekday", expect: only("SOURCE_SEEN"),
    mutate: (d) => {
      correctionIn(d, 1).source_url = "https://arxiv.org/abs/2610.99778";
    },
  },

  // ── GO_DEEPER: the count and the kinds ──
  {
    name: "GO_DEEPER: no id",
    code: "GO_DEEPER", edition: "weekday", expect: only("GO_DEEPER"),
    mutate: (d) => {
      story(d).go_deeper = [];
    },
  },
  {
    name: "GO_DEEPER: four ids, each of an allowed kind",
    code: "GO_DEEPER", edition: "weekday", expect: only("GO_DEEPER"),
    mutate: (d) => {
      result(d).go_deeper = ["s1", "s2", "s3", "s4"];
    },
  },
  {
    name: "GO_DEEPER: a notice on a result (only a setback's Go deeper may list notices)",
    code: "GO_DEEPER", edition: "weekday", expect: only("GO_DEEPER"),
    mutate: (d) => {
      // The setback's own retraction notice, a page the run saw, cited by the claimed result as well (one URL may stand in two findings).
      addCited(claimed(d), sample("notice", "https://link.springer.com/article/10.1007/ut-sample-0005", "Example Press"));
    },
  },

  // ── PRIMARY_ONLY: the URL test (these pages are in no pack, search or fetch, so SOURCE_SEEN says so too) ──
  {
    name: "PRIMARY_ONLY: a news site's page (and a page the run never saw)",
    code: "PRIMARY_ONLY", edition: "weekday", expect: { errors: ["PRIMARY_ONLY", "SOURCE_SEEN"], warnings: [] },
    mutate: (d) => {
      addCited(story(d), sample("statement", "https://phys.org/news/ut-sample-scroll.html", "phys.org"));
    },
  },
  {
    name: "PRIMARY_ONLY: a page on a denied path of a listed host",
    code: "PRIMARY_ONLY", edition: "weekday", expect: { errors: ["PRIMARY_ONLY", "SOURCE_SEEN"], warnings: [] },
    mutate: (d) => {
      addCited(story(d), sample("paper", "https://www.science.org/content/article/ut-sample-scroll", "Science"));
    },
  },
  {
    name: "PRIMARY_ONLY: a DOI with a denied prefix",
    code: "PRIMARY_ONLY", edition: "weekday", expect: { errors: ["PRIMARY_ONLY", "SOURCE_SEEN"], warnings: [] },
    mutate: (d) => {
      addCited(story(d), sample("paper", "https://doi.org/10.1038/scientificamerican-ut-sample", "Scientific American"));
    },
  },
  {
    name: "PRIMARY_ONLY: a host on no list",
    code: "PRIMARY_ONLY", edition: "weekday", expect: { errors: ["PRIMARY_ONLY", "SOURCE_SEEN"], warnings: [] },
    mutate: (d) => {
      addCited(story(d), sample("statement", "https://news.example.org/ut-sample/statement", "Example News"));
    },
  },
  {
    name: "SOURCE_SEEN: a checker's own page on a press platform passes PRIMARY_ONLY's URL test (the exception), so only SOURCE_SEEN says anything",
    code: "SOURCE_SEEN", edition: "weekday", expect: only("SOURCE_SEEN"),
    mutate: (d) => {
      addCited(story(d), sample("checker", "https://scrollprize.substack.com/p/ut-sample-announcement", "Vesuvius Challenge"));
    },
  },
  {
    name: "PRIMARY_ONLY: a platform page that no entry names stays refused (and is a page the run never saw)",
    code: "PRIMARY_ONLY", edition: "weekday", expect: { errors: ["PRIMARY_ONLY", "SOURCE_SEEN"], warnings: [] },
    mutate: (d) => {
      addCited(story(d), sample("statement", "https://ut-sample-blog.substack.com/p/ut-sample-announcement", "A blog"));
    },
  },
  {
    name: "PRIMARY_ONLY: a brief source's kind the page cannot be (an expert reaction typed as a paper)",
    code: "PRIMARY_ONLY", edition: "weekday", expect: only("PRIMARY_ONLY"),
    mutate: (d) => {
      sourceIn(d.sources, "b3").kind = "paper";
    },
  },

  // ── PRIMARY_ONLY: the article type check, in draft mode, on the evidence's types and landings ──
  {
    name: "PRIMARY_ONLY: a Nature article whose page shows no article type",
    code: "PRIMARY_ONLY", edition: "weekday", expect: only("PRIMARY_ONLY"),
    mutate: (d) => {
      addCited(claimed(d), sample("paper", "https://www.nature.com/articles/nature-ut-sample-0090", "Nature"));
    },
  },
  {
    name: "PRIMARY_ONLY: a doi.org address whose landing the run never got",
    code: "PRIMARY_ONLY", edition: "weekday", expect: only("PRIMARY_ONLY"),
    mutate: (d) => {
      addCited(claimed(d), sample("paper", "https://doi.org/10.1038/nature-ut-sample-0091", "Nature"));
    },
  },
  {
    name: "PRIMARY_ONLY: a Nature article typed Article, cited as a notice",
    code: "PRIMARY_ONLY", edition: "weekday", expect: only("PRIMARY_ONLY"),
    mutate: (d) => {
      // Not in Go deeper, which a notice on a result would fail: the one clause under test is the article type.
      addSource(claimed(d).sources, "s", sample("notice", "https://www.nature.com/articles/nature-ut-sample-0001", "Nature"));
    },
  },
  {
    name: "PRIMARY_ONLY: the Sunday deep dive's Cell article, cited as a reaction",
    code: "PRIMARY_ONLY", edition: "sunday", expect: only("PRIMARY_ONLY"),
    mutate: (d) => {
      // Cell Press pages answer 403 to a plain GET, so no type separates a Preview from a research article and the entry has no
      // `reaction` kind (§4.11, K1b): the URL test refuses the kind.
      sourceIn(d.sources, "b1").kind = "reaction";
    },
  },
  {
    name: "PRIMARY_ONLY: the Monday review's notice, a doi.org address that lands on a journal that is no dataset host",
    code: "PRIMARY_ONLY", edition: "monday", expect: only("PRIMARY_ONLY"),
    mutate: (d) => {
      sourceIn(d.sources, "b2").kind = "dataset";
    },
  },

  // ── SOURCE_SEEN: a brief's own sources in the other editions ──
  {
    name: "SOURCE_SEEN: the Sunday deep dive cites a release the run never saw",
    code: "SOURCE_SEEN", edition: "sunday", expect: only("SOURCE_SEEN"),
    mutate: (d) => {
      sourceIn(d.sources, "b3").url = "https://www.coldwater-sample.edu/news/ut-sample-unseen-release";
    },
  },
  {
    name: "SOURCE_SEEN: the Monday review cites a statement the run never saw",
    code: "SOURCE_SEEN", edition: "monday", expect: only("SOURCE_SEEN"),
    mutate: (d) => {
      sourceIn(d.sources, "b1").url = "https://www.eurekalert.org/news-releases/ut-sample-unseen-statement";
    },
  },
  {
    name: "SOURCE_SEEN: an idea cites an expert reaction the run never saw",
    code: "SOURCE_SEEN", edition: "weekday", expect: only("SOURCE_SEEN"),
    mutate: (d) => {
      sourceIn(d.sources, "b3").url = "https://www.sciencemediacentre.org/expert-reaction-to-ut-sample-unseen-reaction/";
    },
  },

  // ── FIGURE_LICENCE: the licence, the host as listed and the scheme ──
  {
    name: "FIGURE_LICENCE: the quote names CC BY 4.0, the figure says CC0",
    code: "FIGURE_LICENCE", edition: "weekday", expect: only("FIGURE_LICENCE"),
    mutate: (d) => {
      story(d).figure!.licence = "CC0-1.0";
    },
  },
  {
    name: "FIGURE_LICENCE: a subdomain of a listed figure host is not a listed host",
    code: "FIGURE_LICENCE", edition: "weekday", expect: only("FIGURE_LICENCE"),
    mutate: (d) => {
      story(d).figure!.image_url = "https://static.media.springernature.com/ut-sample/scroll-figure-2.png";
    },
  },
  {
    name: "FIGURE_LICENCE: an image over http",
    code: "FIGURE_LICENCE", edition: "weekday", expect: only("FIGURE_LICENCE"),
    mutate: (d) => {
      story(d).figure!.image_url = "http://media.springernature.com/ut-sample/scroll-figure-2.png";
    },
  },

  // ── One code per problem: a URL that BLOCKED_HOST fails is skipped by PRIMARY_ONLY, SOURCE_SEEN and FIGURE_LICENCE's host test ──
  {
    name: "BLOCKED_HOST: a source on a URL shortener is told once (PRIMARY_ONLY and SOURCE_SEEN skip it)",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      addCited(story(d), sample("statement", "https://t.co/ut-sample-0003", "Eastvale University"));
    },
  },
  {
    name: "BLOCKED_HOST: a figure image on an archive host is told once (FIGURE_LICENCE's host test skips it)",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      story(d).figure!.image_url = "https://archive.org/ut-sample/scroll-figure-2.png";
    },
  },
];
