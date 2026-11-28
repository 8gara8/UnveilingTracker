// lib/primary.ts (SPEC §4.11 "The URL test", "The type check", "Where the types come from" and its Tests paragraph; §4.12
// PRIMARY_ONLY and RUNG_EVIDENCE's checker rungs; §4.14 a candidate's `types`; §4.2 BLOCKED_HOSTS). Part one reads the seed
// files of config/: the spec's Tests paragraph, the allowlist's examples, the four decisions on the URL test (BLOCKED_HOSTS
// first; a resolver's or registry's host gives that entry's kinds only; a statement entry's three forms; an address that is
// not plain https fails), every entry of every list passing for its own kinds, every press host and every blocked entry
// failing for every kind. Part two runs the edge cases (hosts, paths, the press list's exceptions, the deny lists, the type
// check's branches and the helpers that collect and the rules call) on copies of the seed changed inline and parsed by their
// schemas; the cross-file checks of lib/config.ts are not run on them, so a copy may name a host the loader would refuse.
// New for this project.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import {
  articleTypeFits, candidateRefusal, checkerRungsFor, checkersFor, isPrimary, primaryKindsFor, primaryProblem, primaryTest, publishersFor,
  refusedPubtype, typeFieldFor, typePlanFor,
} from "@/lib/primary";
import type { PrimaryConfig, PrimaryTest } from "@/lib/primary";
import { CheckersFile, LabsFile, SourceTiersFile } from "@/lib/schema/config";
import { Evidence } from "@/lib/schema/misc";
import { blockedEntry, hostMatches, normalizeUrl } from "@/lib/urls";
import { BLOCKED_HOSTS, blockedForm, COUNTED_RUNGS, SOURCE_KINDS } from "@/lib/vocab";
import type { SourceKind } from "@/lib/vocab";

const configDir = path.join(__dirname, "..", "config");
/** The loaded seed, read only. */
const SEED = loadConfig(configDir);
const readJson = (file: string): any => JSON.parse(fs.readFileSync(path.join(configDir, file), "utf8"));
const RAW = { tiers: readJson("source-tiers.json"), labs: readJson("labs.json"), checkers: readJson("checkers.json") };

/** The two dashes the spec bans (NO_EM_DASH): built from their code points, so no source line holds one. */
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

interface Edit {
  tiers?: (t: any) => void;
  labs?: (l: any) => void;
  checkers?: (c: any) => void;
}

/** A copy of the seed's three files, changed by `edit` and parsed by their schemas. */
function variant(edit: Edit = {}): PrimaryConfig {
  const t = structuredClone(RAW.tiers);
  const l = structuredClone(RAW.labs);
  const c = structuredClone(RAW.checkers);
  edit.tiers?.(t);
  edit.labs?.(l);
  edit.checkers?.(c);
  return { sourceTiers: SourceTiersFile.parse(t), labs: LabsFile.parse(l), checkers: CheckersFile.parse(c) };
}

const kinds = (url: string, config: PrimaryConfig = SEED): SourceKind[] => primaryKindsFor(url, config);

/** An evidence file with these `types` and `resolved`, each keyed by `normalizeUrl()` as the run's evidence is. */
function evidence(types: Record<string, string[]> = {}, resolved: Record<string, string> = {}): Evidence {
  const keyed = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [normalizeUrl(k), v]));
  return Evidence.parse({ urls: [], fetched: [], texts: {}, seen_as: {}, types: keyed(types), resolved: keyed(resolved) });
}
const NO_TYPES = evidence();

/** The kinds a source passes PRIMARY_ONLY for in draft mode: the URL test, then the type check. */
const passesFor = (url: string, ev: Evidence | null, config: PrimaryConfig = SEED): SourceKind[] =>
  SOURCE_KINDS.filter((k) => isPrimary(url, k, config) && articleTypeFits(url, k, ev, config).status === "pass");

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const SMC = "https://www.sciencemediacentre.org/expert-reaction-to-a-protein-design-result/";
const NATURE_NV = "https://www.nature.com/articles/d41586-024-01234-5";
const NATURE_PAPER = "https://www.nature.com/articles/s41586-024-07487-w";
const SCIENCE = "https://www.science.org/doi/10.1126/science.adk1234";
const SCIENCE_NEWS = "https://www.science.org/content/article/some-news-story";
const PUBMED = "https://pubmed.ncbi.nlm.nih.gov/38000001/";
const PMC = "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/";
const PMC_LEGACY = "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/";
const SPRINGER = "https://link.springer.com/article/10.1007/s00222-024-01234-5";
const ARXIV = "https://arxiv.org/abs/2401.00001";
const TAO = "https://terrytao.wordpress.com/2025/03/14/a-post/";
const MATHLIB = "https://github.com/leanprover-community/mathlib4";
const TRIAL = "https://clinicaltrials.gov/study/NCT05938920";
const QUANTA = "https://www.quantamagazine.org/a-story-20250101/";

// ── Part one: the seed ───────────────────────────────────────────────────────────────────────────

describe("the spec's Tests paragraph (§4.11)", () => {
  it("an SMC expert-reaction page passes for reaction and fails for paper", () => {
    expect(isPrimary(SMC, "reaction", SEED)).toBe(true);
    expect(isPrimary(SMC, "paper", SEED)).toBe(false);
    expect(kinds(SMC)).toEqual(["reaction"]);
    expect(passesFor(SMC, null)).toEqual(["reaction"]);
    expect(passesFor(SMC, NO_TYPES)).toEqual(["reaction"]);
  });

  it("a Nature d41586- URL passes the URL test for reaction only, and the type check only when typed News & Views", () => {
    expect(kinds(NATURE_NV)).toEqual(["reaction"]);
    expect(passesFor(NATURE_NV, evidence({ [NATURE_NV]: ["News & Views"] }))).toEqual(["reaction"]);
    expect(passesFor(NATURE_NV, evidence({ [NATURE_NV]: ["news and views"] }))).toEqual(["reaction"]);
    for (const type of ["News", "Editorial", "Career Feature", "Article", "Retraction Note"]) {
      expect(passesFor(NATURE_NV, evidence({ [NATURE_NV]: [type] })), type).toEqual([]);
    }
    expect(passesFor(NATURE_NV, NO_TYPES)).toEqual([]);
  });

  it("a Science URL typed as research passes for paper only, as a retraction note for notice only, and as news for no kind", () => {
    expect(kinds(SCIENCE)).toEqual(["paper", "reaction", "notice"]);
    expect(passesFor(SCIENCE, evidence({ [SCIENCE]: ["Research Article"] }))).toEqual(["paper"]);
    expect(passesFor(SCIENCE, evidence({ [SCIENCE]: ["Retraction"] }))).toEqual(["notice"]);
    expect(passesFor(SCIENCE, evidence({ [SCIENCE]: ["Perspective"] }))).toEqual(["reaction"]);
    expect(passesFor(SCIENCE, evidence({ [SCIENCE]: ["News"] }))).toEqual([]);
    expect(passesFor(SCIENCE, NO_TYPES)).toEqual([]);
    expect(passesFor(NATURE_PAPER, evidence({ [NATURE_PAPER]: ["Retraction Note"] }))).toEqual(["notice"]);
    expect(passesFor(NATURE_PAPER, evidence({ [NATURE_PAPER]: ["Article"] }))).toEqual(["paper"]);
  });

  it("a doi.org URL passes only through a landing that passes, an error landing included when its publisher's type_field is null", () => {
    const springerDoi = "https://doi.org/10.1007/s00222-024-01234-5";
    // the GET ended on Springer's page with an error: the landing is known, the page gave no types
    expect(passesFor(springerDoi, evidence({}, { [springerDoi]: SPRINGER }))).toEqual(["paper", "notice"]);
    expect(passesFor(springerDoi, NO_TYPES)).toEqual([]);
    const nvDoi = "https://doi.org/10.1038/d41586-024-01234-5";
    expect(passesFor(nvDoi, evidence({ [nvDoi]: ["News & Views"] }, { [nvDoi]: NATURE_NV }))).toEqual(["reaction"]);
    // an error landing on a publisher that shows its types has none to show
    expect(passesFor(nvDoi, evidence({}, { [nvDoi]: NATURE_NV }))).toEqual([]);
    const pressDoi = "https://doi.org/10.5555/a-story";
    expect(passesFor(pressDoi, evidence({}, { [pressDoi]: QUANTA }))).toEqual([]);
  });

  it("a PubMed record typed News fails, and no PubMed record passes for reaction", () => {
    expect(passesFor(PUBMED, evidence({ [PUBMED]: ["News"] }))).toEqual([]);
    expect(passesFor(PUBMED, evidence({ [PUBMED]: ["Journal Article", "News"] }))).toEqual([]);
    expect(passesFor(PUBMED, evidence({ [PUBMED]: ["Journal Article"] }))).toEqual(["paper", "notice"]);
    for (const url of [PUBMED, "https://pubmed.ncbi.nlm.nih.gov/", "https://pubmed.ncbi.nlm.nih.gov/?term=protein", PMC, PMC_LEGACY]) {
      expect(isPrimary(url, "reaction", SEED), url).toBe(false);
      expect(passesFor(url, evidence({ [url]: ["Comment"] })), url).toEqual([]);
    }
  });

  it("a reaction_sources entry on a press host passes, and a press URL fails for every kind", () => {
    expect(kinds(TAO)).toEqual(["reaction"]);
    expect(primaryTest("https://someone.wordpress.com/2025/03/14/a-post/", SEED)).toEqual({ kinds: [], refusal: "press_host", by: "wordpress.com" });
    for (const url of [QUANTA, "https://www.newscientist.com/article/x/", "https://www.scientificamerican.com/article/x/", "https://phys.org/news/x.html"]) {
      expect(kinds(url), url).toEqual([]);
      for (const k of SOURCE_KINDS) expect(primaryProblem(url, k, SEED)?.code, `${url} ${k}`).toBe("press_host");
    }
  });
});

describe("the allowlist's examples", () => {
  const EXAMPLES: [string, SourceKind[]][] = [
    ["https://www.sciencemediacentre.org/expert-reaction-to-an-ai-result/", ["reaction"]],
    [NATURE_NV, ["reaction"]],
    [NATURE_PAPER, ["paper", "notice"]],
    ["https://www.nature.com/articles/nature14539", ["paper", "notice"]],
    [SCIENCE, ["paper", "reaction", "notice"]],
    [SCIENCE_NEWS, []],
    ["https://www.cell.com/cell/fulltext/S0092-8674(24)00123-4", ["paper", "reaction", "notice"]],
    ["https://www.pnas.org/doi/10.1073/pnas.2400000121", ["paper", "reaction", "notice"]],
    ["https://doi.org/10.1038/s41586-024-07487-w", ["paper", "preprint", "dataset", "registry", "reaction", "notice"]],
    ["https://doi.org/10.1038/d41586-024-00001-1", ["paper", "preprint", "dataset", "registry", "reaction", "notice"]],
    ["https://doi.org/10.1038/scientificamerican0924-30", []],
    ["https://pubmed.ncbi.nlm.nih.gov/12345678/", ["paper", "notice"]],
    [PMC, ["paper", "notice"]],
    [PMC_LEGACY, ["paper", "notice"]],
    ["https://terrytao.wordpress.com/2025/01/01/a-post/", ["reaction"]],
    ["https://example.wordpress.com/2025/01/01/a-post/", []],
    ["https://scrollprize.substack.com/p/an-update", ["statement", "checker"]],
    ["https://other.substack.com/p/an-update", []],
    ["https://www.quantamagazine.org/a-story/", []],
    ["https://www.newscientist.com/article/x/", []],
    ["https://www.scientificamerican.com/article/x/", []],
    ["https://www.nytimes.com/2025/x.html", []],
    ["https://phys.org/news/x.html", []],
    ["https://www.sciencenews.org/article/x", []],
    [ARXIV, ["preprint"]],
    ["https://www.biorxiv.org/content/10.1101/2024.01.01.123456v1", ["preprint"]],
    ["https://www.nobelprize.org/prizes/chemistry/2024/press-release/", ["statement", "checker"]],
    [TRIAL, ["registry", "checker"]],
    ["https://www.rcsb.org/structure/1ABC", ["registry"]],
    ["https://zenodo.org/records/123456", ["dataset"]],
    [MATHLIB, ["proof", "dataset", "checker"]],
    ["https://huggingface.co/datasets/x/y", ["dataset"]],
    ["https://www.anthropic.com/research/x", ["lab_post"]],
    ["https://deepmind.google/blog/x/", ["lab_post"]],
    ["https://www.eurekalert.org/news-releases/12345", ["statement"]],
    ["https://www.eurekalert.org/multimedia/12345", []],
    ["https://www.cell.com/newsroom/x", ["statement"]],
    ["https://physics.aps.org/articles/v17/1", []],
    ["https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.134.010001", ["paper", "notice"]],
    ["https://elifesciences.org/articles/12345", ["paper", "notice"]],
    ["https://elifesciences.org/for-the-press/x", ["statement"]],
    ["https://www.fda.gov/drugs/news-events-human-drugs/x", ["statement", "checker"]],
    ["https://www.ema.europa.eu/en/medicines/human/x", ["statement", "checker"]],
    ["https://www.mpg.de/12345/x", ["statement"]],
    ["https://news.mit.edu/2025/x", ["statement"]],
    ["https://www.vatican.va/content/x.html", ["statement"]],
    ["https://leanprover-community.github.io/mathlib4_docs/Mathlib/Order/Basic.html", ["proof", "checker"]],
    ["https://leanprover-community.github.io/mathlib_stats.html", ["checker"]],
    ["https://www.ebi.ac.uk/interpro/entry/x", ["dataset", "registry"]],
    ["https://alphafold.ebi.ac.uk/entry/P12345", ["dataset", "registry"]],
    ["https://www.erdosproblems.com/123", ["checker"]],
    ["https://annals.math.princeton.edu/2025/201-1/p01", ["paper", "statement", "notice"]],
  ];

  it.each(EXAMPLES)("%s passes for %j", (url, expected) => {
    expect(kinds(url)).toEqual(expected);
    for (const k of SOURCE_KINDS) expect(isPrimary(url, k, SEED), k).toBe(expected.includes(k));
  });
});

describe("decision 1: BLOCKED_HOSTS is read before any allowlist", () => {
  it("gist, api and codeload under github.com fail for every kind, though github.com is a registry host", () => {
    for (const url of [
      "https://gist.github.com/someone/abc123",
      "https://api.github.com/repos/leanprover-community/mathlib4",
      "https://codeload.github.com/leanprover-community/mathlib4/zip/refs/heads/master",
      "https://raw.githubusercontent.com/leanprover-community/mathlib4/master/Mathlib/Order/Basic.lean",
    ]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "blocked_host", by: blockedEntry(url)!.pattern });
      expect(primaryProblem(url, "dataset", SEED)?.code).toBe("blocked_host");
    }
    expect(kinds(MATHLIB)).toEqual(["proof", "dataset", "checker"]);
    expect(kinds("https://github.com/someone/abc123")).toEqual(["proof", "dataset"]);
  });

  /** A URL each entry blocks, by the entry's form. */
  function blockedSample(pattern: string): string {
    switch (blockedForm(pattern)) {
      case "host":
        return `https://www.${pattern}/x`;
      case "path": {
        const slash = pattern.indexOf("/");
        return `https://www.${pattern.slice(0, slash)}${pattern.slice(slash)}`;
      }
      case "suffix":
        return `https://abcdefghijklmnop${pattern}/x`;
      case "label":
        return `https://${pattern}.example/x`;
    }
  }

  it("every entry fails for every kind, even when a lab, a checker and a publisher name the host for every path", () => {
    for (const entry of BLOCKED_HOSTS) {
      const url = blockedSample(entry.pattern);
      const host = new URL(url).hostname;
      const config = variant({
        labs: (l) => l.labs.push({ id: "listed-lab", name: "A lab", hosts: [host], paths: ["/"] }),
        checkers: (c) => c.checkers.push({ id: "listed-checker", name: "A checker", hosts: [host], paths: ["/"], rungs: ["checked"] }),
        tiers: (t) => t.publishers.push({
          id: "listed-publisher", name: "A publisher", hosts: [host], kinds: ["paper"], paths: ["/"], deny_paths: [], reaction_paths: [],
          type_field: null, types: {},
        }),
      });
      expect(primaryTest(url, config), url).toEqual({ kinds: [], refusal: "blocked_host", by: blockedEntry(url)!.pattern });
      expect(checkerRungsFor(url, config), url).toBeNull();
      // the same lists pass the twin host that no entry blocks
      const twin = url.replace(host, `unblocked-${host.replaceAll(".", "-")}.example.org`);
      const twinConfig = variant({ labs: (l) => l.labs.push({ id: "twin-lab", name: "A lab", hosts: [new URL(twin).hostname], paths: ["/"] }) });
      expect(kinds(twin, twinConfig), twin).toEqual(["lab_post"]);
    }
  });

  it("a path entry blocks its prefix only: the rest of the host passes for the lab that lists it", () => {
    const config = variant({ labs: (l) => l.labs.push({ id: "google-research", name: "Google Research", hosts: ["google.com"], paths: ["/"] }) });
    expect(primaryTest("https://www.google.com/url", config)).toEqual({ kinds: [], refusal: "blocked_host", by: "google.com/url" });
    expect(kinds("https://www.google.com/research/x", config)).toEqual(["lab_post"]);
    expect(primaryTest("https://news.google.com/articles/x", config)).toEqual({ kinds: [], refusal: "blocked_host", by: "news.google.com" });
  });
});

describe("decision 2: a host a resolver or registry names passes for that entry's kinds only", () => {
  it("the .gov suffix never makes a PubMed or PMC record or a ClinicalTrials.gov page a statement", () => {
    for (const url of [PUBMED, "https://pubmed.ncbi.nlm.nih.gov/", PMC, PMC_LEGACY, TRIAL]) {
      expect(isPrimary(url, "statement", SEED), url).toBe(false);
      expect(primaryProblem(url, "statement", SEED)?.code, url).toBe("wrong_kind");
    }
    expect(kinds(TRIAL)).toEqual(["registry", "checker"]);
  });

  it("nor any other page of such a host: off the entry's paths it is unlisted", () => {
    for (const url of ["https://www.ncbi.nlm.nih.gov/gene/7157", "https://ncbi.nlm.nih.gov/books/x", "https://clinicaltrials.gov/about-site/about-ctg",
      "https://pmc.ncbi.nlm.nih.gov/about/intro/"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "unlisted", by: null });
    }
    // EMBL-EBI under .ac.uk lists every path, for its two kinds only
    expect(kinds("https://www.ebi.ac.uk/about/news/x")).toEqual(["dataset", "registry"]);
  });

  it("a .gov host that no resolver or registry names is still a statement", () => {
    expect(kinds("https://www.nih.gov/news-events/news-releases/x")).toEqual(["statement"]);
    expect(kinds("https://www.nlm.nih.gov/news/x.html")).toEqual(["statement"]);
  });

  it("a checker or lab entry may name such a host for checker or lab_post", () => {
    expect(kinds(MATHLIB)).toEqual(["proof", "dataset", "checker"]);
    const config = variant({ labs: (l) => l.labs.push({ id: "deepmind-code", name: "Google DeepMind code", hosts: ["github.com"], paths: ["/google-deepmind/"] }) });
    expect(kinds("https://github.com/google-deepmind/alphafold3", config)).toEqual(["proof", "dataset", "lab_post"]);
    expect(kinds("https://github.com/someone/alphafold3", config)).toEqual(["proof", "dataset"]);
  });

  it("a statement entry naming a registry's host gives it no statement either", () => {
    const config = variant({ tiers: (t) => t.statement_suffixes.push("zenodo.org", "rcsb.org/news") });
    expect(kinds("https://zenodo.org/records/1", config)).toEqual(["dataset"]);
    expect(primaryTest("https://zenodo.org/communities/x", config)).toEqual({ kinds: [], refusal: "unlisted", by: null });
    expect(kinds("https://www.rcsb.org/news/x", config)).toEqual([]);
    // a host no resolver or registry names takes the same entries
    const free = variant({ tiers: (t) => t.statement_suffixes.push("zenodo-news.org") });
    expect(kinds("https://zenodo-news.org/x", free)).toEqual(["statement"]);
  });
});

describe("decision 3: statement_suffixes in their three forms, for kind statement only", () => {
  it("a suffix (it starts with a dot) matches any host that ends with it", () => {
    for (const url of ["https://news.mit.edu/2025/x", "https://www.ox.ac.uk/news/x", "https://www.nasa.gov/x", "https://www.who.int/news/item/x",
      "https://commission.europa.eu/x", "https://www.go.jp/x"]) {
      expect(kinds(url), url).toEqual(["statement"]);
    }
    for (const url of ["https://www.ntu.edu.tw/x", "https://mit.edu.example.com/x", "https://example.com/news.mit.edu", "https://www.notgov/x"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "unlisted", by: null });
    }
  });

  it("a host matches the host and its subdomains, never a look-alike", () => {
    for (const url of ["https://mpg.de/x", "https://www.mpg.de/x", "https://www.biochem.mpg.de/x", "https://www.sinica.edu.tw/x"]) {
      expect(kinds(url), url).toEqual(["statement"]);
    }
    for (const url of ["https://notmpg.de/x", "https://mpg.de.example.com/x", "https://www.mpg.dev/x", "https://example.com/mpg.de"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "unlisted", by: null });
    }
  });

  it("a host with a path prefix matches that host and its subdomains under the plain prefix", () => {
    for (const url of ["https://www.cell.com/newsroom/x", "https://cell.com/newsroom", "https://www.cell.com/newsroomx", "https://www.eurekalert.org/news-releases/1012345",
      "https://www.cell.com/NewsRoom/x", "https://www.cell.com//newsroom/x"]) {
      expect(kinds(url), url).toEqual(["statement"]);
    }
    for (const url of ["https://www.cell.com/news/x", "https://www.eurekalert.org/news-releases", "https://www.eurekalert.org/multimedia/1",
      "https://example.org/cell.com/newsroom", "https://notcell.com/newsroom/x", "https://www.cell.com/x?go=/newsroom/"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "unlisted", by: null });
    }
  });

  it("gives kind statement and no other", () => {
    for (const url of ["https://news.mit.edu/2025/x", "https://www.mpg.de/x", "https://www.cell.com/newsroom/x"]) {
      for (const k of SOURCE_KINDS) expect(isPrimary(url, k, SEED), `${url} ${k}`).toBe(k === "statement");
    }
  });
});

describe("decision 4: an address that is not https, or has user info, fails for every kind", () => {
  it("http, another scheme or text that is no URL fails as not_https", () => {
    for (const url of ["http://www.nature.com/articles/s41586-024-07487-w", "ftp://arxiv.org/abs/2401.00001", "//www.nature.com/articles/s41586",
      "www.nature.com/articles/s41586", "", "not a url", "mailto:x@example.org", "data:text/html,x", "javascript:void(0)"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "not_https", by: null });
      for (const k of SOURCE_KINDS) expect(primaryProblem(url, k, SEED)?.code, url).toBe("not_https");
    }
  });

  it("a user name or a password fails as user_info", () => {
    for (const url of ["https://user@www.nature.com/articles/s41586", "https://user:secret@www.nature.com/articles/s41586", "https://:secret@www.nature.com/articles/s41586"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "user_info", by: null });
    }
  });

  it("an upper-case scheme is still https", () => {
    expect(kinds("HTTPS://www.nature.com/articles/s41586-024-07487-w")).toEqual(["paper", "notice"]);
  });

  it("every helper reads such an address as listing nothing", () => {
    for (const url of ["http://www.nature.com/articles/s41586", "https://user@www.fda.gov/x", "http://pubmed.ncbi.nlm.nih.gov/1/", "http://doi.org/10.1038/x"]) {
      expect(publishersFor(url, SEED), url).toEqual([]);
      expect(checkersFor(url, SEED), url).toEqual([]);
      expect(checkerRungsFor(url, SEED), url).toBeNull();
      expect(typePlanFor(url, SEED), url).toEqual({ branch: "none" });
      expect(typeFieldFor(url, SEED), url).toBeNull();
    }
    expect(candidateRefusal({ url: "http://arxiv.org/abs/2401.00001", types: [] }, SEED)).toBe("not_https");
    expect(candidateRefusal({ url: "https://user@arxiv.org/abs/2401.00001", types: [] }, SEED)).toBe("user_info");
  });
});

describe("every seed entry passes for its own kinds", () => {
  const T = SEED.sourceTiers;
  const sample = (host: string, prefix: string): string => `https://${host}${prefix}x`;

  it("each publisher host and path for each of its kinds, each reaction path for reaction", () => {
    for (const p of T.publishers) {
      for (const h of p.hosts) {
        for (const pre of p.paths) expect(kinds(sample(h, pre)), `${p.id} ${h}${pre}`).toEqual(expect.arrayContaining(p.kinds));
        for (const pre of p.reaction_paths) expect(kinds(sample(h, pre)), `${p.id} ${h}${pre}`).toContain("reaction");
      }
    }
    expect(kinds("https://nature.com/articles/d41586-x")).toEqual(["reaction"]);
  });

  it("each resolver and registry host and path for each of its kinds, never for statement", () => {
    for (const r of [...T.resolvers, ...T.registries]) {
      for (const h of r.hosts) {
        for (const pre of r.paths) {
          const got = kinds(sample(h, pre));
          expect(got, `${r.id} ${h}${pre}`).toEqual(expect.arrayContaining(r.kinds));
          expect(got, `${r.id} ${h}${pre}`).not.toContain("statement");
        }
      }
    }
  });

  it("each reaction source for reaction, each lab for lab_post, each checker for checker", () => {
    const lists: [readonly { id: string; hosts: readonly string[]; paths: readonly string[] }[], SourceKind][] = [
      [T.reaction_sources, "reaction"], [SEED.labs.labs, "lab_post"], [SEED.checkers.checkers, "checker"],
    ];
    for (const [entries, kind] of lists) {
      for (const e of entries) for (const h of e.hosts) for (const pre of e.paths) expect(kinds(sample(h, pre)), `${e.id} ${h}${pre}`).toContain(kind);
    }
  });

  it("each statement entry for statement, in its form", () => {
    for (const entry of T.statement_suffixes) {
      if (entry.startsWith(".")) {
        expect(kinds(`https://www.sample${entry}/x`), entry).toEqual(["statement"]);
      } else if (entry.includes("/")) {
        const slash = entry.indexOf("/");
        for (const host of [entry.slice(0, slash), `www.${entry.slice(0, slash)}`]) expect(kinds(sample(host, entry.slice(slash))), entry).toContain("statement");
      } else {
        for (const host of [entry, `www.${entry}`]) expect(kinds(`https://${host}/x`), entry).toContain("statement");
      }
    }
  });

  it("every press host, and every subdomain of one, fails for every kind", () => {
    for (const press of T.press_hosts) {
      for (const host of [press, `www.${press}`]) {
        const t = primaryTest(`https://${host}/x`, SEED);
        expect(t.kinds, host).toEqual([]);
        expect(t.refusal, host).toBe("press_host");
        expect(hostMatches(host, t.by!), host).toBe(true);
        expect(T.press_hosts).toContain(t.by);
      }
    }
  });
});

// ── Part two: the edge cases ─────────────────────────────────────────────────────────────────────

describe("host matching", () => {
  it("a listed host matches itself and its subdomains, never a look-alike", () => {
    for (const url of ["https://nature.com/articles/s41586", "https://www.nature.com/articles/s41586", "https://sub.www.nature.com/articles/s41586",
      "https://idp.nature.com/articles/s41586"]) {
      expect(kinds(url), url).toEqual(["paper", "notice"]);
    }
    for (const url of ["https://www.nature.com.example.com/articles/s41586", "https://evilnature.com/articles/s41586", "https://www-nature.com/articles/s41586",
      "https://nature.co/articles/s41586", "https://nature.com.au/articles/s41586", "https://example.org/www.nature.com/articles/s41586"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "unlisted", by: null });
    }
  });

  it("a trailing dot and upper case name the same host; two trailing dots name none", () => {
    for (const url of ["https://www.nature.com./articles/s41586", "https://WWW.NATURE.COM/articles/s41586", "https://Www.Nature.Com./articles/s41586"]) {
      expect(kinds(url), url).toEqual(["paper", "notice"]);
    }
    expect(primaryTest("https://www.nature.com../articles/s41586", SEED).refusal).toBe("unlisted");
    expect(primaryTest("https://PHYS.ORG./news/x", SEED)).toEqual({ kinds: [], refusal: "press_host", by: "phys.org" });
    expect(primaryTest("https://notphys.org/news/x", SEED).refusal).toBe("unlisted");
  });

  it("the default port names the same host; any other port fails for every kind", () => {
    expect(kinds("https://www.nature.com:443/articles/s41586")).toEqual(["paper", "notice"]);
    for (const url of ["https://www.nature.com:8443/articles/s41586", "https://www.nature.com:80/articles/s41586", "https://arxiv.org:1/abs/2401.00001"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "port", by: null });
      expect(primaryProblem(url, "paper", SEED)?.code).toBe("port");
    }
  });
});

describe("path prefixes", () => {
  it("are plain string prefixes: /articles/s admits /articles/sx, on purpose", () => {
    for (const url of ["https://www.nature.com/articles/sx", "https://www.nature.com/articles/s", "https://www.nature.com/articles/scientific-reports"]) {
      expect(kinds(url), url).toEqual(["paper", "notice"]);
    }
    for (const url of ["https://www.nature.com/articles/", "https://www.nature.com/articles", "https://www.nature.com/news/x", "https://www.nature.com/",
      "https://www.nature.com", "https://www.nature.com/x/articles/s41586"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "unlisted", by: null });
    }
  });

  it("/ admits any path, the root included", () => {
    for (const url of ["https://journals.plos.org", "https://journals.plos.org/", "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001"]) {
      expect(kinds(url), url).toEqual(["paper", "notice"]);
    }
  });

  it("are compared in matchPath() form: case, unreserved escapes and repeated slashes do not matter, a reserved escape does", () => {
    for (const url of ["https://www.nature.com/ARTICLES/S41586-024-07487-W", "https://www.nature.com/articles/%7341586-024", "https://www.nature.com//articles//s41586",
      "https://www.nature.com/%61rticles/s41586"]) {
      expect(kinds(url), url).toEqual(["paper", "notice"]);
    }
    expect(primaryTest("https://www.nature.com/articles%2Fs41586", SEED).refusal).toBe("unlisted");
  });

  it("never read the query or the fragment", () => {
    expect(kinds("https://arxiv.org/abs/2401.00001?context=cs#S2")).toEqual(["preprint"]);
    expect(primaryTest("https://arxiv.org/list?path=/abs/2401.00001", SEED).refusal).toBe("unlisted");
    expect(primaryTest("https://arxiv.org/#/abs/2401.00001", SEED).refusal).toBe("unlisted");
  });

  it("put a config prefix in the same form", () => {
    const config = variant({
      tiers: (t) => {
        t.publishers.find((p: any) => p.id === "nature").paths = ["/ARTICLES/S", "/%61rticles/nature"];
        t.publishers.find((p: any) => p.id === "science").deny_paths = ["/Content/Article/"];
        t.reaction_sources.find((r: any) => r.id === "smc").paths = ["/Expert-Reaction-"];
        t.statement_suffixes.push("example-institute.org/Press/");
      },
    });
    expect(kinds("https://www.nature.com/articles/s41586", config)).toEqual(["paper", "notice"]);
    expect(kinds("https://www.nature.com/articles/nature14539", config)).toEqual(["paper", "notice"]);
    expect(primaryTest("https://www.science.org/content/article/x", config).refusal).toBe("denied_path");
    expect(kinds(SMC, config)).toEqual(["reaction"]);
    expect(kinds("https://example-institute.org/press/x", config)).toEqual(["statement"]);
  });
});

describe("the deny lists", () => {
  it("a publisher's deny_paths fail its hosts for every kind, in any case or escape", () => {
    for (const url of [SCIENCE_NEWS, "https://science.org/content/article/x", "https://www.science.org/Content/%61rticle/x", "https://www.science.org//content/article/x"]) {
      expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "denied_path", by: "/content/article/" });
    }
    expect(primaryTest("https://www.science.org/content/articles", SEED).refusal).toBe("unlisted");
    // another host's page under the same path is not denied
    expect(primaryTest("https://www.cell.com/content/article/x", SEED).refusal).toBe("unlisted");
  });

  it("every publisher's deny paths hold, the first publisher's included", () => {
    const config = variant({ tiers: (t) => { t.publishers[0].deny_paths = ["/articles/d41586-"]; } });
    expect(SEED.sourceTiers.publishers[0]!.id).toBe("nature");
    expect(primaryTest(NATURE_NV, config)).toEqual({ kinds: [], refusal: "denied_path", by: "/articles/d41586-" });
    expect(kinds(NATURE_PAPER, config)).toEqual(["paper", "notice"]);
    expect(primaryTest(SCIENCE_NEWS, config).refusal).toBe("denied_path");
  });

  it("a deny path is read before every allowlist, a statement entry and a lab included", () => {
    const config = variant({
      tiers: (t) => t.statement_suffixes.push("science.org"),
      labs: (l) => l.labs.push({ id: "aaas-lab", name: "A lab", hosts: ["science.org"], paths: ["/content/"] }),
    });
    expect(primaryTest(SCIENCE_NEWS, config)).toEqual({ kinds: [], refusal: "denied_path", by: "/content/article/" });
    expect(kinds("https://www.science.org/content/page/about-us", config)).toEqual(["statement", "lab_post"]);
    expect(kinds(SCIENCE, config)).toEqual(["paper", "statement", "reaction", "notice"]);
  });

  it("deny_doi_prefixes fail a doi.org address for every kind, in any case, escape or resolver host", () => {
    const cases: [string, string][] = [
      ["https://doi.org/10.1038/scientificamerican0924-30", "10.1038/scientificamerican"],
      ["https://doi.org/10.1038/ScientificAmerican0924-30", "10.1038/scientificamerican"],
      ["https://doi.org/10.1038%2Fscientificamerican0924-30", "10.1038/scientificamerican"],
      ["https://dx.doi.org/10.1021/cen-10201-cover", "10.1021/cen-"],
      ["https://doi.org//10.1063/pt.5.1234", "10.1063/pt."],
      ["https://doi.org/10.1063//pt.5.1234", "10.1063/pt."],
      ["https://doi.org/10.1056/NEJM-JW.NA12345", "10.1056/nejm-jw."],
    ];
    for (const [url, prefix] of cases) expect(primaryTest(url, SEED), url).toEqual({ kinds: [], refusal: "denied_doi_prefix", by: prefix });
    // a denied prefix later in the DOI is no prefix
    expect(kinds("https://doi.org/10.5555/10.1021/cen-1")).toEqual(["paper", "preprint", "dataset", "registry", "reaction", "notice"]);
  });

  it("an escape that does not decode is compared as written", () => {
    expect(primaryTest("https://doi.org/10.1063/pt.%E0%A4%A", SEED)).toEqual({ kinds: [], refusal: "denied_doi_prefix", by: "10.1063/pt." });
    expect(kinds("https://doi.org/10.5555/x%E0%A4%A")).toEqual(["paper", "preprint", "dataset", "registry", "reaction", "notice"]);
  });

  it("Nature's News & Views prefix is never denied, and a DOI prefix is read on doi.org only", () => {
    expect(kinds("https://doi.org/10.1038/d41586-024-00001-1")).toContain("reaction");
    // a page whose path happens to start with a denied DOI is judged by its own entry
    expect(kinds("https://journals.plos.org/10.1063/pt.5.1234")).toEqual(["paper", "notice"]);
    expect(kinds("https://journals.plos.org//10.1063/pt.5.1234")).toEqual(["paper", "notice"]);
  });
});

describe("the press list and the entries that win over it", () => {
  it("a reaction source on a press host passes for reaction only", () => {
    expect(kinds(TAO)).toEqual(["reaction"]);
    for (const k of SOURCE_KINDS) expect(primaryProblem(TAO, k, SEED)?.code ?? null, k).toBe(k === "reaction" ? null : "wrong_kind");
  });

  it("a reaction source's pages are kind reaction and no other, whatever else lists them", () => {
    const config = variant({
      tiers: (t) => t.reaction_sources.push(
        { id: "a-scientist", name: "A scientist's page", hosts: ["www.math.example.edu"], paths: ["/~someone/"] },
        { id: "a-lab-scientist", name: "A lab scientist's notes", hosts: ["deepmind.google"], paths: ["/notes/"] },
      ),
    });
    expect(kinds("https://www.math.example.edu/~someone/blog/x", config)).toEqual(["reaction"]);
    expect(kinds("https://www.math.example.edu/news/x", config)).toEqual(["statement"]);
    expect(kinds("https://deepmind.google/notes/x", config)).toEqual(["reaction"]);
    expect(kinds("https://deepmind.google/blog/x", config)).toEqual(["lab_post"]);
  });

  it("a checker on a press host lifts the refusal for the whole URL, so its statement entry counts too", () => {
    expect(kinds("https://scrollprize.substack.com/p/an-update")).toEqual(["statement", "checker"]);
    expect(primaryTest("https://other.substack.com/p/an-update", SEED)).toEqual({ kinds: [], refusal: "press_host", by: "substack.com" });
  });

  it("a lab on a press host passes", () => {
    const config = variant({ labs: (l) => l.labs.push({ id: "lab-notes", name: "Lab notes", hosts: ["labnotes.substack.com"], paths: ["/"] }) });
    expect(kinds("https://labnotes.substack.com/p/x", config)).toEqual(["lab_post"]);
    expect(primaryTest("https://other.substack.com/p/x", config).refusal).toBe("press_host");
  });

  it("the entry must name the path as well as the host", () => {
    const config = variant({
      tiers: (t) => t.reaction_sources.push({ id: "someone", name: "A scientist's reactions", hosts: ["someone.wordpress.com"], paths: ["/reactions/"] }),
      checkers: (c) => c.checkers.push({ id: "a-prize", name: "A prize", hosts: ["aprize.substack.com"], paths: ["/p/winners"], rungs: ["checked"] }),
    });
    expect(kinds("https://someone.wordpress.com/reactions/x", config)).toEqual(["reaction"]);
    expect(primaryTest("https://someone.wordpress.com/2025/x", config)).toEqual({ kinds: [], refusal: "press_host", by: "wordpress.com" });
    expect(kinds("https://aprize.substack.com/p/winners-2025", config)).toEqual(["checker"]);
    expect(primaryTest("https://aprize.substack.com/p/other", config).refusal).toBe("press_host");
  });

  it("the press list is read after BLOCKED_HOSTS and before the deny lists", () => {
    const config = variant({ tiers: (t) => t.press_hosts.push("science.org", "gist.github.com") });
    expect(primaryTest(SCIENCE_NEWS, config)).toEqual({ kinds: [], refusal: "press_host", by: "science.org" });
    expect(primaryTest("https://gist.github.com/x", config).refusal).toBe("blocked_host");
  });

  it("names the first press entry the host is or sits under", () => {
    expect(primaryTest("https://asia.nikkei.com/x", SEED).by).toBe("nikkei.com");
    expect(primaryTest("https://abcnews.go.com/x", SEED).by).toBe("abcnews.go.com");
    expect(primaryTest("https://www.go.com/x", SEED).refusal).toBe("unlisted");
  });
});

describe("the result of the URL test", () => {
  const corpus = [
    SMC, NATURE_NV, NATURE_PAPER, SCIENCE, SCIENCE_NEWS, PUBMED, PMC, PMC_LEGACY, SPRINGER, ARXIV, TAO, MATHLIB, TRIAL, QUANTA,
    "https://doi.org/10.1038/s41586-024-07487-w", "https://doi.org/10.1038/scientificamerican0924-30", "https://gist.github.com/x",
    "http://www.nature.com/articles/s41586", "https://user@www.nature.com/articles/s41586", "https://www.nature.com:8443/articles/s41586",
    "https://www.eurekalert.org/multimedia/1", "https://scrollprize.substack.com/p/x", "https://www.fda.gov/x", "not a url",
  ];

  it("lists kinds in SOURCE_KINDS order, each once, and a refusal exactly when it lists none", () => {
    const BY_REFUSALS = ["blocked_host", "press_host", "denied_path", "denied_doi_prefix"];
    for (const url of corpus) {
      const t: PrimaryTest = primaryTest(url, SEED);
      expect(t.kinds, url).toEqual(SOURCE_KINDS.filter((k) => t.kinds.includes(k)));
      expect(t.refusal === null, url).toBe(t.kinds.length > 0);
      expect(t.by !== null, url).toBe(t.refusal !== null && BY_REFUSALS.includes(t.refusal));
      expect(primaryKindsFor(url, SEED)).toEqual(t.kinds);
      for (const k of SOURCE_KINDS) {
        expect(isPrimary(url, k, SEED), `${url} ${k}`).toBe(t.kinds.includes(k));
        const problem = primaryProblem(url, k, SEED);
        expect(problem === null, `${url} ${k}`).toBe(t.kinds.includes(k));
        if (problem !== null) expect(problem.code).toBe(t.refusal ?? "wrong_kind");
      }
    }
  });

  it("never changes its config or evidence, and gives the same answer every time", () => {
    const config = deepFreeze(variant());
    const doi = "https://doi.org/10.1038/d41586-024-01234-5";
    const ev = deepFreeze(evidence({ [doi]: ["News & Views"], [PUBMED]: ["News"] }, { [doi]: NATURE_NV }));
    const run = () => corpus.concat(doi).flatMap((url) => [
      primaryTest(url, config), publishersFor(url, config).map((p) => p.id), checkerRungsFor(url, config), typePlanFor(url, config).branch,
      typeFieldFor(url, config), candidateRefusal({ url, types: ["News"] }, config),
      ...SOURCE_KINDS.map((k) => [primaryProblem(url, k, config), articleTypeFits(url, k, ev, config), articleTypeFits(url, k, null, config)]),
    ]);
    const first = run();
    expect(run()).toEqual(first);
    expect(variant()).toEqual(config);
  });
});

describe("primaryProblem", () => {
  it("is null when the URL passes for the kind", () => {
    expect(primaryProblem(NATURE_PAPER, "paper", SEED)).toBeNull();
    expect(primaryProblem(TAO, "reaction", SEED)).toBeNull();
  });

  it("names the refusal, what refused it, and what to cite", () => {
    expect(primaryProblem("http://arxiv.org/abs/1", "preprint", SEED)).toEqual({
      code: "not_https", message: "The address is not an https address. Cite the source's own https page.",
    });
    expect(primaryProblem("https://u:p@arxiv.org/abs/1", "preprint", SEED)).toEqual({
      code: "user_info", message: "The address has a user name or password in it. Cite the plain address.",
    });
    expect(primaryProblem("https://arxiv.org:8080/abs/1", "preprint", SEED)).toEqual({
      code: "port", message: "The address names a port other than the default one. Cite the record's regular https address.",
    });
    expect(primaryProblem("https://gist.github.com/x", "dataset", SEED)).toEqual({
      code: "blocked_host",
      message: "gist.github.com is on the blocked list: a link shortener, redirect, web archive, paste site, messaging link, leak site, scan query or shadow library is never a source. Cite the record's own page.",
    });
    expect(primaryProblem(QUANTA, "paper", SEED)).toEqual({
      code: "press_host",
      message: "quantamagazine.org is a news, magazine, blog or aggregator site, never a source. Cite the primary record it reports: the paper, the preprint, the lab's own post or the institution's own release.",
    });
    expect(primaryProblem(SCIENCE_NEWS, "paper", SEED)).toEqual({
      code: "denied_path", message: "Pages under /content/article/ on this site are news and features, not papers. Cite the paper's own page.",
    });
    expect(primaryProblem("https://doi.org/10.1021/cen-10201-cover", "paper", SEED)).toEqual({
      code: "denied_doi_prefix", message: "DOIs that start with 10.1021/cen- name a news publication's items, not papers. Cite the primary record.",
    });
    expect(primaryProblem("https://www.eurekalert.org/multimedia/1", "statement", SEED)).toEqual({
      code: "unlisted",
      message: "No source list names this page. Cite the paper's page on its publisher, a preprint server, a registry, the lab's own site or the institution's own release.",
    });
  });

  it("lists the kinds a URL of the wrong kind passes for", () => {
    expect(primaryProblem(SMC, "paper", SEED)).toEqual({
      code: "wrong_kind", message: 'This page can be cited as "reaction", not as "paper". Give the source that kind, or cite a page of kind "paper".',
    });
    expect(primaryProblem(NATURE_PAPER, "reaction", SEED)?.message).toBe(
      'This page can be cited as "paper" or "notice", not as "reaction". Give the source one of those kinds, or cite a page of kind "reaction".',
    );
    expect(primaryProblem(SCIENCE, "preprint", SEED)?.message).toBe(
      'This page can be cited as "paper", "reaction" or "notice", not as "preprint". Give the source one of those kinds, or cite a page of kind "preprint".',
    );
  });

  it("holds no em or en dash and never repeats the URL", () => {
    const urls = [SMC, NATURE_PAPER, SCIENCE_NEWS, QUANTA, "https://gist.github.com/x", "http://arxiv.org/abs/1", "https://u@arxiv.org/abs/1",
      "https://arxiv.org:8080/abs/1", "https://doi.org/10.1021/cen-1", "https://www.eurekalert.org/multimedia/1"];
    for (const url of urls) {
      for (const k of SOURCE_KINDS) {
        const message = primaryProblem(url, k, SEED)?.message ?? "";
        expect(message.includes(EM) || message.includes(EN), message).toBe(false);
        expect(message.includes(url), message).toBe(false);
      }
    }
  });
});

describe("publishersFor", () => {
  it("lists the publisher entries whose host and paths or reaction paths list the URL, but not under their deny paths", () => {
    const ids = (url: string, config: PrimaryConfig = SEED): string[] => publishersFor(url, config).map((p) => p.id);
    expect(ids(NATURE_PAPER)).toEqual(["nature"]);
    expect(ids(NATURE_NV)).toEqual(["nature"]);
    expect(ids(SPRINGER)).toEqual(["springer"]);
    expect(ids(ARXIV)).toEqual(["arxiv"]);
    expect(ids("https://www.nature.com/news/x")).toEqual([]);
    expect(ids(SCIENCE_NEWS)).toEqual([]);
    expect(ids("https://doi.org/10.1038/x")).toEqual([]);
    expect(ids(PUBMED)).toEqual([]);
    // a second entry on the same host, in file order; one whose deny path covers the URL is left out
    const config = variant({
      tiers: (t) => t.publishers.push({
        id: "nature-archive", name: "Nature archive", hosts: ["nature.com"], kinds: ["paper"], paths: ["/articles/"], deny_paths: ["/articles/d"],
        reaction_paths: [], type_field: null, types: {},
      }),
    });
    expect(ids(NATURE_PAPER, config)).toEqual(["nature", "nature-archive"]);
    expect(ids(NATURE_NV, config)).toEqual(["nature"]);
  });
});

describe("checkersFor and checkerRungsFor (RUNG_EVIDENCE's checker rungs)", () => {
  it("give the checkers.json entries that list a URL and the rungs they can give", () => {
    expect(checkersFor("https://www.fda.gov/drugs/x", SEED).map((c) => c.id)).toEqual(["fda"]);
    expect(checkerRungsFor("https://www.fda.gov/drugs/x", SEED)).toEqual(["applied"]);
    expect(checkerRungsFor(TRIAL, SEED)).toEqual(["confirmed"]);
    expect(checkerRungsFor(`${MATHLIB}/blob/master/Mathlib/Order/Basic.lean`, SEED)).toEqual(["checked"]);
    expect(checkerRungsFor("https://www.nobelprize.org/prizes/chemistry/2024/summary/", SEED)).toEqual(["checked"]);
  });

  it("give none for a URL no checker lists", () => {
    for (const url of ["https://github.com/someone/repo", NATURE_PAPER, "https://clinicaltrials.gov/about-site/x", "https://www.fda.gov.example.com/x"]) {
      expect(checkersFor(url, SEED), url).toEqual([]);
      expect(checkerRungsFor(url, SEED), url).toBeNull();
    }
  });

  it("join the rungs of every entry that lists the URL, in COUNTED_RUNGS order", () => {
    const config = variant({
      checkers: (c) => c.checkers.push({ id: "trial-checks", name: "Trial checks", hosts: ["clinicaltrials.gov"], paths: ["/study/NCT0"], rungs: ["checked"] }),
    });
    expect(checkersFor(TRIAL, config).map((c) => c.id)).toEqual(["clinicaltrials-gov-results", "trial-checks"]);
    expect(checkerRungsFor(TRIAL, config)).toEqual(["checked", "confirmed"]);
    expect(checkerRungsFor("https://clinicaltrials.gov/study/NCT1", config)).toEqual(["confirmed"]);
    expect(COUNTED_RUNGS).toEqual(["checked", "confirmed", "applied"]);
  });

  it("give none for a URL that fails the URL test, though a checker lists it", () => {
    const config = variant({
      checkers: (c) => c.checkers.push({ id: "paste-checker", name: "A checker", hosts: ["pastebin.com", "checks.example.org"], paths: ["/"], rungs: ["checked"] }),
    });
    expect(checkerRungsFor("https://pastebin.com/abc", config)).toBeNull();
    expect(checkerRungsFor("https://checks.example.org:8443/abc", config)).toBeNull();
    expect(checkerRungsFor("https://checks.example.org/abc", config)).toEqual(["checked"]);
  });
});

describe("refusedPubtype", () => {
  it("gives the first type a resolver refuses, as written, comparing without case or padding", () => {
    expect(refusedPubtype([], SEED)).toBeNull();
    expect(refusedPubtype(["Journal Article", "Review"], SEED)).toBeNull();
    expect(refusedPubtype(["Journal Article", "Comment", "News"], SEED)).toBe("Comment");
    expect(refusedPubtype(["  NEWSPAPER   article "], SEED)).toBe("  NEWSPAPER   article ");
    expect(refusedPubtype(["editorial"], SEED)).toBe("editorial");
  });

  it("reads every resolver's list: PubMed's names and PMC's", () => {
    expect(refusedPubtype(["article-commentary"], SEED)).toBe("article-commentary");
    expect(refusedPubtype(["Interview"], SEED)).toBe("Interview");
    const config = variant({ tiers: (t) => { for (const r of t.resolvers) r.refused_pubtypes = r.id === "pmc-legacy" ? ["letter"] : []; } });
    expect(refusedPubtype(["News"], config)).toBeNull();
    expect(refusedPubtype(["Letter"], config)).toBe("Letter");
  });
});

describe("candidateRefusal (collect and ranking)", () => {
  it("keeps a candidate that passes for some kind but reaction, and drops one that passes for reaction only", () => {
    expect(candidateRefusal({ url: NATURE_PAPER, types: [] }, SEED)).toBeNull();
    expect(candidateRefusal({ url: SCIENCE, types: [] }, SEED)).toBeNull();
    expect(candidateRefusal({ url: ARXIV, types: [] }, SEED)).toBeNull();
    expect(candidateRefusal({ url: NATURE_NV, types: [] }, SEED)).toBe("wrong_kind");
    expect(candidateRefusal({ url: SMC, types: [], reaction: false }, SEED)).toBe("wrong_kind");
    expect(candidateRefusal({ url: TAO, types: [] }, SEED)).toBe("wrong_kind");
  });

  it("from a feed that yields reactions, keeps a candidate that passes for reaction", () => {
    expect(candidateRefusal({ url: SMC, types: [], reaction: true }, SEED)).toBeNull();
    expect(candidateRefusal({ url: NATURE_NV, types: [], reaction: true }, SEED)).toBeNull();
    expect(candidateRefusal({ url: SCIENCE, types: [], reaction: true }, SEED)).toBeNull();
    expect(candidateRefusal({ url: ARXIV, types: [], reaction: true }, SEED)).toBe("wrong_kind");
  });

  it("drops one whose types hold a refused publication type, and one the URL test refuses", () => {
    expect(candidateRefusal({ url: PUBMED, types: ["News"] }, SEED)).toBe("refused_pubtype");
    expect(candidateRefusal({ url: PUBMED, types: ["Journal Article", "newspaper article"] }, SEED)).toBe("refused_pubtype");
    expect(candidateRefusal({ url: PUBMED, types: ["Journal Article", "Review"] }, SEED)).toBeNull();
    expect(candidateRefusal({ url: SMC, types: ["Editorial"], reaction: true }, SEED)).toBe("refused_pubtype");
    expect(candidateRefusal({ url: SCIENCE_NEWS, types: [] }, SEED)).toBe("denied_path");
    expect(candidateRefusal({ url: QUANTA, types: [] }, SEED)).toBe("press_host");
    expect(candidateRefusal({ url: "https://gist.github.com/x", types: [] }, SEED)).toBe("blocked_host");
    expect(candidateRefusal({ url: "https://www.eurekalert.org/multimedia/1", types: [] }, SEED)).toBe("unlisted");
  });
});

describe("typePlanFor and typeFieldFor (what the type check and the snapshot step read)", () => {
  const plan = (url: string, config: PrimaryConfig = SEED) => {
    const p = typePlanFor(url, config);
    return p.branch === "record" || p.branch === "publisher" ? { branch: p.branch, ids: p.entries.map((e) => e.id) } : { branch: p.branch };
  };

  it("judges a doi.org URL through its landing, a PubMed or PMC page as a record, a typed publisher's page by its types", () => {
    expect(plan("https://doi.org/10.1038/x")).toEqual({ branch: "doi" });
    expect(plan("https://dx.doi.org/10.1038/x")).toEqual({ branch: "doi" });
    expect(plan(PUBMED)).toEqual({ branch: "record", ids: ["pubmed"] });
    expect(plan(PMC)).toEqual({ branch: "record", ids: ["pmc"] });
    expect(plan(PMC_LEGACY)).toEqual({ branch: "record", ids: ["pmc-legacy"] });
    expect(plan(NATURE_PAPER)).toEqual({ branch: "publisher", ids: ["nature"] });
    expect(plan(NATURE_NV)).toEqual({ branch: "publisher", ids: ["nature"] });
    expect(plan(SCIENCE)).toEqual({ branch: "publisher", ids: ["science"] });
    expect(plan("https://www.cell.com/cell/fulltext/S0092-8674(24)00123-4")).toEqual({ branch: "publisher", ids: ["cell-press"] });
    expect(plan("https://www.pnas.org/doi/10.1073/pnas.2400000121")).toEqual({ branch: "publisher", ids: ["pnas"] });
  });

  it("judges every other URL by the URL test alone", () => {
    for (const url of [SPRINGER, ARXIV, SMC, TAO, QUANTA, SCIENCE_NEWS, "https://doi.org/", "https://doi.org/abc", "https://www.nature.com/news/x",
      "https://pubmed.ncbi.nlm.nih.gov.example.com/1/", "https://www.ncbi.nlm.nih.gov/gene/1"]) {
      expect(plan(url), url).toEqual({ branch: "none" });
    }
  });

  it("names the type_field of the entry a final URL is on", () => {
    expect(typeFieldFor(NATURE_PAPER, SEED)).toBe("citation_article_type");
    expect(typeFieldFor(NATURE_NV, SEED)).toBe("citation_article_type");
    expect(typeFieldFor(SCIENCE, SEED)).toBe("dc.type");
    for (const url of [PUBMED, PMC, "https://doi.org/10.1038/x", SPRINGER, ARXIV]) expect(typeFieldFor(url, SEED), url).toBeNull();
    const config = variant({ tiers: (t) => { t.resolvers.find((r: any) => r.id === "pmc").type_field = ".publication-type"; } });
    expect(typeFieldFor(PMC, config)).toBe(".publication-type");
    expect(typeFieldFor(PUBMED, config)).toBeNull();
    // with two resolvers on the page, the first one that names a field
    const two = variant({
      tiers: (t) => t.resolvers.push({ id: "pmc-typed", name: "PMC, typed", hosts: ["pmc.ncbi.nlm.nih.gov"], kinds: ["paper"], paths: ["/articles/"],
        type_field: "citation_article_type", refused_pubtypes: [] }),
    });
    expect(typeFieldFor(PMC, two)).toBe("citation_article_type");
    expect(typePlanFor(PMC, two)).toMatchObject({ branch: "record", entries: [{ id: "pmc" }, { id: "pmc-typed" }] });
  });
});

describe("articleTypeFits", () => {
  it("is skipped with no evidence file where a check applies, and passes where none does", () => {
    expect(articleTypeFits(NATURE_PAPER, "paper", null, SEED)).toEqual({ status: "skipped", branch: "publisher" });
    expect(articleTypeFits(PUBMED, "paper", null, SEED)).toEqual({ status: "skipped", branch: "record" });
    expect(articleTypeFits("https://doi.org/10.1038/x", "paper", null, SEED)).toEqual({ status: "skipped", branch: "doi" });
    for (const url of [ARXIV, SPRINGER, SMC, QUANTA]) expect(articleTypeFits(url, "paper", null, SEED), url).toEqual({ status: "pass", branch: "none" });
  });

  it("on a typed publisher's page, passes when a type the evidence shows fits the kind, compared without case or padding", () => {
    expect(articleTypeFits(NATURE_PAPER, "paper", evidence({ [NATURE_PAPER]: ["Article"] }), SEED)).toEqual({ status: "pass", branch: "publisher" });
    expect(articleTypeFits(NATURE_NV, "reaction", evidence({ [NATURE_NV]: [" news  &  VIEWS "] }), SEED).status).toBe("pass");
    expect(articleTypeFits(NATURE_PAPER, "paper", evidence({ [NATURE_PAPER]: ["News", "ARTICLE"] }), SEED).status).toBe("pass");
  });

  it("fails when the evidence shows no type, or none that fits, and says which kinds the types fit", () => {
    expect(articleTypeFits(NATURE_PAPER, "paper", NO_TYPES, SEED)).toEqual({
      status: "fail", branch: "publisher", reason: "no_types", types: [], landing: null,
      message: "The run found no article type on this page, so it cannot be told from a news item. Cite another primary record of the work, such as its preprint or its PubMed record, or leave it out.",
    });
    expect(articleTypeFits(NATURE_PAPER, "notice", evidence({ [NATURE_PAPER]: ["Article"] }), SEED)).toEqual({
      status: "fail", branch: "publisher", reason: "type_no_fit", types: ["Article"], landing: null,
      message: 'This page is typed "Article", which fits "paper", not "notice". Give the source that kind, or cite a page of the right type.',
    });
    expect(articleTypeFits(NATURE_PAPER, "reaction", evidence({ [NATURE_PAPER]: ["Article", "Retraction Note"] }), SEED)).toMatchObject({
      reason: "type_no_fit", types: ["Article", "Retraction Note"],
      message: 'This page is typed "Article", "Retraction Note", which fits "paper" or "notice", not "reaction". Give the source one of those kinds, or cite a page of the right type.',
    });
    expect(articleTypeFits(NATURE_PAPER, "paper", evidence({ [NATURE_PAPER]: ["News", "Editorial"] }), SEED)).toMatchObject({
      reason: "type_no_fit",
      message: 'This page is typed "News", "Editorial", which is no primary kind: news, editorial, feature and interview pages never are. Cite the paper\'s own page instead.',
    });
  });

  it("reads the evidence under the URL's normalised form only", () => {
    const tagged = `${NATURE_NV}/?utm_source=feed#main`;
    expect(articleTypeFits(tagged, "reaction", evidence({ [NATURE_NV]: ["News & Views"] }), SEED).status).toBe("pass");
    const raw = Evidence.parse({ urls: [], fetched: [], texts: {}, seen_as: {}, types: { [NATURE_NV]: ["News & Views"] }, resolved: {} });
    expect(articleTypeFits(NATURE_NV, "reaction", raw, SEED)).toMatchObject({ status: "fail", reason: "no_types" });
  });

  it("joins the types of every typed publisher that lists the page", () => {
    const config = variant({
      tiers: (t) => t.publishers.push({
        id: "nature-comment", name: "Nature comment", hosts: ["www.nature.com"], kinds: ["reaction"], paths: ["/articles/d41586-"], deny_paths: [],
        reaction_paths: [], type_field: ".c-article-identifiers__type", types: { reaction: ["Comment"] },
      }),
    });
    expect(articleTypeFits(NATURE_NV, "reaction", evidence({ [NATURE_NV]: ["Comment"] }), config)).toEqual({ status: "pass", branch: "publisher" });
    expect(articleTypeFits(NATURE_NV, "reaction", evidence({ [NATURE_NV]: ["News & Views"] }), config).status).toBe("pass");
    expect(typeFieldFor(NATURE_NV, config)).toBe("citation_article_type");
    expect(typeFieldFor("https://www.nature.com/articles/s41586", config)).toBe("citation_article_type");
  });

  it("on a PubMed or PMC record, passes only when the evidence shows types and none is refused", () => {
    expect(articleTypeFits(PUBMED, "paper", evidence({ [PUBMED]: ["Journal Article"] }), SEED)).toEqual({ status: "pass", branch: "record" });
    expect(articleTypeFits(PUBMED, "notice", evidence({ [PUBMED]: ["Retraction of Publication"] }), SEED).status).toBe("pass");
    expect(articleTypeFits(PUBMED, "paper", NO_TYPES, SEED)).toEqual({
      status: "fail", branch: "record", reason: "no_types", types: [], landing: null,
      message: "The run shows no publication type for this record, so it cannot be told from a news item or a comment. Cite another primary record of the work, or leave it out.",
    });
    expect(articleTypeFits(PUBMED, "paper", evidence({ [PUBMED]: ["Journal Article", "News"] }), SEED)).toEqual({
      status: "fail", branch: "record", reason: "refused_pubtype", types: ["Journal Article", "News"], landing: null,
      message: 'This record is typed "News". News, editorials, comments and interviews are never sources. Cite the paper or the primary record it discusses.',
    });
    expect(articleTypeFits(PMC, "paper", evidence({ [PMC]: ["article-commentary"] }), SEED)).toMatchObject({ status: "fail", reason: "refused_pubtype" });
    expect(articleTypeFits(PMC_LEGACY, "paper", evidence({ [PMC_LEGACY]: ["research-article"] }), SEED).status).toBe("pass");
  });

  describe("a doi.org URL", () => {
    const DOI = "https://doi.org/10.1038/d41586-024-01234-5";

    it("fails when the evidence lacks its landing", () => {
      expect(articleTypeFits(DOI, "reaction", evidence({ [DOI]: ["News & Views"] }), SEED)).toEqual({
        status: "fail", branch: "doi", reason: "no_landing", types: [], landing: null,
        message: "The run has not seen where this DOI lands, so the type of its page is unknown. Cite the paper's own page after opening it, or leave it out.",
      });
    });

    it("reads its landing under the DOI's normalised form", () => {
      expect(articleTypeFits(`${DOI}/?utm_source=feed`, "reaction", evidence({ [DOI]: ["News & Views"] }, { [DOI]: NATURE_NV }), SEED).status).toBe("pass");
    });

    it("passes on the types under the DOI's key or under its landing's", () => {
      expect(articleTypeFits(DOI, "reaction", evidence({ [DOI]: ["News & Views"] }, { [DOI]: NATURE_NV }), SEED)).toEqual({ status: "pass", branch: "doi" });
      expect(articleTypeFits(DOI, "reaction", evidence({ [NATURE_NV]: ["News & Views"] }, { [DOI]: NATURE_NV }), SEED).status).toBe("pass");
      expect(articleTypeFits("https://dx.doi.org/10.1038/d41586-024-01234-5", "reaction", evidence({ [NATURE_NV]: ["News & Views"] },
        { "https://dx.doi.org/10.1038/d41586-024-01234-5": NATURE_NV }), SEED).status).toBe("pass");
    });

    it("fails when the landing's types do not fit, listing the types under the DOI's key, then under its landing's, once each", () => {
      expect(articleTypeFits(DOI, "reaction", evidence({ [DOI]: ["Editorial"], [NATURE_NV]: ["News", "Editorial"] }, { [DOI]: NATURE_NV }), SEED)).toEqual({
        status: "fail", branch: "doi", reason: "type_no_fit", types: ["Editorial", "News"], landing: NATURE_NV,
        message: 'This DOI lands on a page that fails the type check. This page is typed "Editorial", "News", which is no primary kind: news, editorial, feature and interview pages never are. Cite the paper\'s own page instead.',
      });
      expect(articleTypeFits(DOI, "reaction", evidence({}, { [DOI]: NATURE_NV }), SEED)).toMatchObject({ reason: "no_types", landing: NATURE_NV });
    });

    it("fails when the landing fails the URL test for the kind", () => {
      const paperDoi = "https://doi.org/10.1038/s41586-024-07487-w";
      expect(articleTypeFits(paperDoi, "reaction", evidence({ [paperDoi]: ["Article"] }, { [paperDoi]: NATURE_PAPER }), SEED)).toEqual({
        status: "fail", branch: "doi", reason: "landing_not_primary", types: [], landing: NATURE_PAPER,
        message: 'This DOI lands on a page that is not a primary source for kind "reaction". This page can be cited as "paper" or "notice", not as "reaction". Give the source one of those kinds, or cite a page of kind "reaction".',
      });
      expect(articleTypeFits(paperDoi, "paper", evidence({ [paperDoi]: ["Article"] }, { [paperDoi]: NATURE_PAPER }), SEED).status).toBe("pass");
      for (const landing of [QUANTA, "https://idp.nature.com/authorize?client_id=x", "http://www.nature.com/articles/s41586-024-07487-w", "https://gist.github.com/x"]) {
        expect(articleTypeFits(paperDoi, "paper", evidence({}, { [paperDoi]: landing }), SEED), landing).toMatchObject({ reason: "landing_not_primary", landing });
      }
    });

    it("fails when the landing is another DOI", () => {
      const other = "https://dx.doi.org/10.1038/s41586-024-07487-w";
      expect(articleTypeFits(DOI, "paper", evidence({}, { [DOI]: other }), SEED)).toEqual({
        status: "fail", branch: "doi", reason: "landing_is_doi", types: [], landing: other,
        message: "This DOI lands on another DOI address, not on a publisher's page. Cite the paper's own page.",
      });
    });

    it("judges a landing on a record as a record", () => {
      const doi = "https://doi.org/10.5555/record";
      expect(articleTypeFits(doi, "paper", evidence({ [PUBMED]: ["News"] }, { [doi]: PUBMED }), SEED)).toMatchObject({ reason: "refused_pubtype", landing: PUBMED });
      expect(articleTypeFits(doi, "paper", evidence({ [PUBMED]: ["Journal Article"] }, { [doi]: PUBMED }), SEED).status).toBe("pass");
      expect(articleTypeFits(doi, "paper", evidence({}, { [doi]: PUBMED }), SEED)).toMatchObject({ reason: "no_types", landing: PUBMED });
    });
  });

  it("holds no em or en dash in any message", () => {
    const DOI = "https://doi.org/10.1038/d41586-024-01234-5";
    const evs = [NO_TYPES, evidence({ [NATURE_PAPER]: ["News"], [PUBMED]: ["News"], [DOI]: ["Article"] }, { [DOI]: QUANTA })];
    for (const ev of evs) {
      for (const url of [NATURE_PAPER, PUBMED, DOI]) {
        for (const k of SOURCE_KINDS) {
          const r = articleTypeFits(url, k, ev, SEED);
          const message = r.status === "fail" ? r.message : "";
          expect(message.includes(EM) || message.includes(EN), message).toBe(false);
        }
      }
    }
  });
});
