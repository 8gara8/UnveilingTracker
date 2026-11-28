// The sources rules (SPEC §4.12; lib/rules/sources.ts): PRIMARY_ONLY, SOURCE_SEEN, SOURCE_URL, GO_DEEPER and FIGURE_LICENCE, each in
// draft mode, in published mode on the records being published and in published mode on every other record, as the rule table and
// "Stored records" say which tests run where. The worlds are the frame's (tests/helpers/rule-world.ts) with every cited address moved
// onto the seed allowlist and into the run's evidence, so a rule fails only for what a test changes; each test runs the group's own
// rules, never the registry, so another group's rules cannot change a result. The two blocks at the end are the exception: "a message
// that quotes a long value" reads the messages, and "the fixtures of the sources group" runs the group's F, S and T cases, which the
// spec defines by the whole validator (fixtures/src/invalid/sources.ts), once with the group's rules and once with every rule.
// New for this project; Cyber's tests/validate.test.ts exercised SOURCE_URL and SOURCE_UNSEEN through its whole validator.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITION_NAMES, REPO_ROOT, type EditionName } from "@/fixtures/src/world";
import { invalidDraft, invalidOutputs } from "@/fixtures/src/build";
import { sourcesCases, sourcesNamed, sourcesSoft } from "@/fixtures/src/invalid/sources";
import { editionDraft } from "@/fixtures/src/drafts";
import { draftInputs as sampleInputs } from "@/fixtures/src/inputs";
import { loadConfig, type LoadedConfig } from "@/lib/config";
import { RULE_CODE_TABLE, codesOfGroup } from "@/lib/rules";
import { buildDraftInput, buildPublishedInput, runRules, type DraftInputs } from "@/lib/rules/run";
import { safetyRules } from "@/lib/rules/safety";
import { namesLicence, sourceUrlProblem, sourcesRules } from "@/lib/rules/sources";
import type { Rule, RuleInput, ValidationIssue } from "@/lib/rules/types";
import { Brief } from "@/lib/schema/brief";
import { DraftBrief } from "@/lib/schema/draft";
import { Finding } from "@/lib/schema/finding";
import { Correction, Evidence } from "@/lib/schema/misc";
import { blockedEntry, normalizeUrl } from "@/lib/urls";
import { REMOVED_BEFORE, REMOVED_TEXT } from "@/lib/vocab";
import { validateDraft } from "@/lib/validate";
import { D, config, deepFreeze, draftInputs, l, storedWorld, weekdayDraft, type Json } from "./helpers/rule-world";

// ── Addresses, on the seed allowlist ─────────────────────────────────────────────────────────────

const NATURE = "https://www.nature.com/articles/s41586-026-00001-1"; // a typed publisher: the type check reads the evidence
const NATURE_NEWS_VIEWS = "https://www.nature.com/articles/d41586-026-00009-9"; // the same publisher's reaction path
const APS = "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.136.000001"; // a publisher with no type field
const ARXIV = "https://arxiv.org/abs/2611.00002";
const EDU1 = "https://news.example.edu/statement/1";
const EDU2 = "https://news.example.edu/statement/2";
const EDU3 = "https://news.example.edu/statement/3";
const GITHUB_REPO = "https://github.com/example-lab/proof-files";
const PUBMED = "https://pubmed.ncbi.nlm.nih.gov/40000007/";
const PMC = "https://pmc.ncbi.nlm.nih.gov/articles/PMC9000007/";
const DOI = "https://doi.org/10.1038/s41586-026-00003-3";
const SMC = "https://www.sciencemediacentre.org/expert-reaction-to-a-protein-design-result/";
const UNLISTED = "https://example.org/paper/1";
const FIGURE = "https://media.springernature.com/ut-sample/figure-2.png";
const QUOTE_BY = "This article is licensed under a Creative Commons Attribution 4.0 International License";

const key = normalizeUrl;
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
/** A no-break space and an ideographic space: white space that `new URL()` does not strip from the ends of an address, so `trim()` would. */
const NBSP = String.fromCharCode(0xa0);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

const rule =(code: string): Rule => sourcesRules.find((r) => r.codes[0] === code)!;

// ── The draft world ──────────────────────────────────────────────────────────────────────────────

const src = (id: string, kind: string, url: string, over: Json = {}): Json => ({
  id, kind, title: `A made-up source ${id}`, publisher: "Example Publisher", url, doi: null, published_at: "2026-11-20", ...over,
});

/** The Tuesday draft with its sources on the allowlist: new-1 cites a paper and a preprint, new-2 a paper, the brief three statements. */
function draftJson(): Json {
  const d = structuredClone(weekdayDraft()) as Json;
  d.new_findings[0].sources = [src("s1", "paper", NATURE), src("s2", "preprint", ARXIV)];
  d.new_findings[1].sources = [src("s1", "paper", APS)];
  d.sources = [src("b1", "statement", EDU1), src("b2", "statement", EDU2), src("b3", "statement", EDU3)];
  return d;
}

/** The evidence of that draft: every cited address seen in the pack, and the one type the typed publisher's page shows. */
function evidenceJson(): Json {
  const urls = [NATURE, ARXIV, APS, EDU1, EDU2, EDU3];
  return {
    urls, fetched: [],
    texts: Object.fromEntries(urls.map((u) => [key(u), `Page text of ${u}.`])),
    seen_as: Object.fromEntries(urls.map((u) => [key(u), "pack"])),
    types: { [key(NATURE)]: ["OriginalPaper"] },
    resolved: {},
  };
}

/** Adds an address to the evidence as a search result, with the types its page shows and the landing its GET reached. */
function see(ev: Json, url: string, types?: string[], landing?: string): void {
  ev.urls.push(url);
  ev.texts[key(url)] = `Page text of ${url}.`;
  ev.seen_as[key(url)] = "search";
  if (types !== undefined) ev.types[key(url)] = types;
  if (landing !== undefined) ev.resolved[key(url)] = landing;
}

/** A source of the draft's first new finding, replaced in place. */
const first = (d: Json, index: number, patch: Json): void => {
  d.new_findings[0].sources[index] = { ...d.new_findings[0].sources[index], ...patch };
};

type Edit = (d: Json, ev: Json) => void;

/** Runs `rules` on the Tuesday draft after `edit` has changed its JSON and its evidence JSON. */
function draftIssues(edit: Edit = () => {}, over: Partial<DraftInputs> = {}, rules: readonly Rule[] = sourcesRules): ValidationIssue[] {
  const d = draftJson();
  const ev = evidenceJson();
  edit(d, ev);
  const inputs: DraftInputs = { ...draftInputs(), evidence: Evidence.parse(ev), ...over };
  return runRules(buildDraftInput(DraftBrief.parse(d), inputs), rules);
}

/** The issues of a run that must not hold a RULE_ERROR, which the engine reports for a rule that threw and a filter by code would hide. */
function threwNothing(issues: ValidationIssue[]): ValidationIssue[] {
  expect(issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
  return issues;
}

/** The draft's issues of one code, from that code's own rule. */
const draftOf = (code: string, edit: Edit = () => {}, over: Partial<DraftInputs> = {}): ValidationIssue[] =>
  threwNothing(draftIssues(edit, over, [rule(code)])).filter((i) => i.code === code);

const paths = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => i.path);
const where = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.path}`);

// ── The published world ──────────────────────────────────────────────────────────────────────────

const storedSources = (): Json[] => [
  src("s1", "paper", NATURE, { seen_as: "pack", added: D }),
  src("s2", "preprint", ARXIV, { seen_as: "search", added: D }),
];

interface Stored { findings: Json[]; brief: Json; corrections: Json[] }

/**
 * The Tuesday's stored records with their sources on the allowlist. `bio-2026-0001` and `math-2026-0002` were first briefed on D, so a
 * run that publishes D judges them and the brief against `config/`; `phys-2026-0003` was first briefed earlier and is not.
 */
function storedJson(): Stored {
  const w = storedWorld();
  const findings = w.findings.map((f) => structuredClone(f) as Json);
  for (const f of findings) f.sources = storedSources();
  const brief = structuredClone(w.brief) as Json;
  brief.sources = [
    src("b1", "statement", EDU1, { seen_as: "pack", added: D }),
    src("b2", "statement", EDU2, { seen_as: "pack", added: D }),
  ];
  return { findings, brief, corrections: w.corrections.map((c) => structuredClone(c) as Json) };
}

const storedFinding = (s: Stored, id: string): Json => s.findings.find((f) => f.id === id)!;

interface PublishedOptions { publishing?: string | null; config?: LoadedConfig; brief?: boolean }

function publishedIssues(edit: (s: Stored) => void = () => {}, options: PublishedOptions = {}, rules: readonly Rule[] = sourcesRules): ValidationIssue[] {
  const w = storedWorld();
  const s = storedJson();
  edit(s);
  const content = {
    findings: s.findings.map((f) => Finding.parse(f)), terms: w.terms, corrections: s.corrections.map((c) => Correction.parse(c)), reports: w.reports,
  };
  const publishing = options.publishing === undefined ? D : options.publishing;
  const brief = Brief.parse(s.brief);
  const input = options.brief === false
    ? buildPublishedInput(null, content, { config: options.config ?? w.config, publishing, date: D })
    : buildPublishedInput(brief, content, { config: options.config ?? w.config, publishing });
  return runRules(input, rules);
}

const publishedOf = (code: string, edit: (s: Stored) => void = () => {}, options: PublishedOptions = {}): ValidationIssue[] =>
  threwNothing(publishedIssues(edit, options, [rule(code)])).filter((i) => i.code === code);

const BIO = "findings/bio-2026-0001.json";
const MATH = "findings/math-2026-0002.json";
const PHYS = "findings/phys-2026-0003.json";
const BRIEF = `briefs/${D}.json`;

/** A stored `removed` correction of one string of a finding or of the brief, dated before D. */
function removal(id: string, target: { finding_id: string } | { edition_date: string }, path: string): Json {
  return {
    id, date: "2026-11-20", finding_id: null, edition_date: null, term_id: null, ...target, type: "removed", path,
    before: { en: REMOVED_BEFORE.en, zh: REMOVED_BEFORE.zh }, after: { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh }, reason: l("The text was removed."),
    source_url: null, trigger: "editor", report_id: null,
  };
}

/** A config with `edit` applied to a copy of the seed's source-tiers.json. */
function configWith(edit: (tiers: Json) => void): LoadedConfig {
  const tiers = JSON.parse(JSON.stringify(config().sourceTiers)) as Json;
  edit(tiers);
  return loadConfig(undefined, { overrides: { sourceTiers: tiers } });
}

// ── The group ────────────────────────────────────────────────────────────────────────────────────

describe("the sources group", () => {
  it("is five rules, one for each code of the group, in the table's order, each an error", () => {
    expect(sourcesRules.map((r) => r.codes)).toEqual([["PRIMARY_ONLY"], ["SOURCE_SEEN"], ["SOURCE_URL"], ["GO_DEEPER"], ["FIGURE_LICENCE"]]);
    expect(sourcesRules.map((r) => r.codes[0])).toEqual(codesOfGroup("sources"));
    for (const r of sourcesRules) expect(r.severity, r.codes[0]).toBe("error");
  });

  it("runs each rule in the modes of its code in the rule table", () => {
    for (const r of sourcesRules) {
      const info = RULE_CODE_TABLE.find((row) => row.code === r.codes[0])!;
      expect([...r.scope].sort(), r.codes[0]).toEqual([...info.scopes].sort());
    }
    expect(Object.fromEntries(sourcesRules.map((r) => [r.codes[0], r.scope]))).toEqual({
      PRIMARY_ONLY: ["draft", "published"], SOURCE_SEEN: ["draft"], SOURCE_URL: ["draft", "published"], GO_DEEPER: ["draft", "published"],
      FIGURE_LICENCE: ["draft", "published"],
    });
  });

  it("needs the evidence for SOURCE_SEEN alone, and only uses it for PRIMARY_ONLY's type check", () => {
    expect(Object.fromEntries(sourcesRules.map((r) => [r.codes[0], [r.needs, r.uses]]))).toEqual({
      PRIMARY_ONLY: [[], ["evidence"]], SOURCE_SEEN: [["evidence"], []], SOURCE_URL: [[], []], GO_DEEPER: [[], []], FIGURE_LICENCE: [[], []],
    });
  });

  it("finds nothing in the Tuesday draft with its sources on the allowlist, nor in the Tuesday's stored records", () => {
    expect(draftIssues()).toEqual([]);
    expect(publishedIssues()).toEqual([]);
    expect(publishedIssues(() => {}, { publishing: null })).toEqual([]);
  });

  it.each(EDITION_NAMES.map((name) => [name]))("finds nothing in the %s sample draft", (name) => {
    const draft = DraftBrief.parse(editionDraft(name));
    expect(runRules(buildDraftInput(draft, sampleInputs(name)), sourcesRules)).toEqual([]);
  });

  it("changes nothing it reads, reads no file and calls no network", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const d = draftJson();
    d.new_findings[0].figure = { source_id: "s1", image_url: FIGURE, licence: "CC-BY-4.0", licence_quote: QUOTE_BY, credit: "Figure 2 from a made-up paper", alt: "A made-up figure." };
    const draftInput = deepFreeze(buildDraftInput(DraftBrief.parse(d), { ...draftInputs(), evidence: Evidence.parse(evidenceJson()) }));
    const w = storedWorld();
    const content = { findings: w.findings, terms: w.terms, corrections: w.corrections, reports: w.reports };
    const publishedInput = deepFreeze(buildPublishedInput(w.brief, content, { config: w.config, publishing: D }));
    for (const r of sourcesRules) {
      expect(() => r.check(draftInput), `${r.codes[0]} in draft mode`).not.toThrow();
      if (r.scope.includes("published")) expect(() => r.check(publishedInput), `${r.codes[0]} in published mode`).not.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("runs inside validateDraft() when it is given these rules: a clean draft is ok, a fault in a source is its error", () => {
    const inputs = { ...draftInputs(), evidence: Evidence.parse(evidenceJson()), rules: sourcesRules };
    expect(validateDraft(draftJson(), inputs)).toMatchObject({ ok: true, errors: [], warnings: [] });
    const d = draftJson();
    first(d, 0, { url: "http://www.nature.com/articles/s41586-026-00001-1" });
    const result = validateDraft(d, inputs);
    expect(result.ok).toBe(false);
    expect(result.errors.map((i) => [i.code, i.path])).toEqual([["SOURCE_URL", "new_findings[0].sources[0].url"]]);
    expect(result.warnings).toEqual([]);
  });

  it("reports only the codes of its own rules, whatever is wrong with the draft and the stored records", () => {
    const mine = new Set(sourcesRules.flatMap((r) => r.codes));
    const faulty: Edit = (d, ev) => {
      first(d, 0, { url: "http://www.nature.com/articles/s41586-026-00001-1" });
      first(d, 1, { url: UNLISTED, kind: "reaction" });
      d.new_findings[0].go_deeper = [];
      d.new_findings[1].sources[0].url = "https://arxiv.org/abs/2611.00099";
      figure({ image_url: "https://example.org/a.png", licence_quote: "All rights reserved" })(d, ev);
    };
    const draft = draftIssues(faulty);
    expect(new Set(draft.map((i) => i.code))).toEqual(mine);
    const stored = publishedIssues((st) => {
      storedFinding(st, "bio-2026-0001").sources[0].url = "http://www.nature.com/x";
      storedFinding(st, "bio-2026-0001").sources[1].url = UNLISTED;
      storedFinding(st, "bio-2026-0001").go_deeper = [];
      storedFinding(st, "bio-2026-0001").figure = {
        source_id: "s1", image_url: "https://example.org/a.png", licence: "CC0-1.0", licence_quote: "None", credit: "A credit", alt: l("A figure."),
      };
    });
    expect(new Set(stored.map((i) => i.code))).toEqual(new Set(["SOURCE_URL", "PRIMARY_ONLY", "GO_DEEPER", "FIGURE_LICENCE"]));
  });

  it("writes no em dash and no en dash in a message or a hint", () => {
    const faulty: Edit = (d, ev) => {
      first(d, 0, { url: "http://www.nature.com/x" });
      first(d, 1, { url: UNLISTED, kind: "reaction" });
      d.new_findings[0].go_deeper = ["s1", "s2", "s1", "s2"];
      figure({ image_url: "http://example.org/y", licence_quote: "x" })(d, ev);
    };
    const text = draftIssues(faulty).map((i) => `${i.message} ${i.hint ?? ""}`).join(" ");
    expect(text.length).toBeGreaterThan(300);
    expect(text).not.toContain(EM);
    expect(text).not.toContain(EN);
  });
});

// ── A stored finding the draft only names ───────────────────────────────────────────────────────

describe("a stored finding that the draft only names", () => {
  /** The stored `math-2026-0002`, which the Tuesday draft returns to, with a fault for each of the five rules, as a draft run is given it. */
  const faulty = (): Partial<DraftInputs> => {
    const w = storedWorld();
    const record = Finding.parse({
      ...structuredClone(w.findings.find((f) => f.id === "math-2026-0002")!),
      sources: [
        src("s1", "reaction", "https://arxiv.org/abs/2611.00099", { seen_as: "pack", added: D }),
        src("s2", "paper", "http://www.nature.com/articles/s41586-026-00099-9", { seen_as: "pack", added: D }),
      ],
      go_deeper: ["s1"],
      figure: { source_id: "s1", image_url: "https://example.org/a.png", licence: "CC0-1.0", licence_quote: "All rights reserved", credit: "A credit", alt: l("A figure.") },
    });
    return { stored: { findings: [record], corrections: [], terms: [] } };
  };
  const inputOf = (over: Partial<DraftInputs>): RuleInput => buildDraftInput(DraftBrief.parse(draftJson()), { ...draftInputs(), evidence: Evidence.parse(evidenceJson()), ...over });
  const forMath = (issues: readonly ValidationIssue[]): ValidationIssue[] => issues.filter((i) => i.path.includes("math-2026-0002"));

  it("reaches the rules as a full view that is not the draft's own", () => {
    const view = inputOf(faulty()).views.findings.find((f) => f.key === "math-2026-0002")!;
    expect(view).toMatchObject({ basis: "context", detail: "full" });
    expect(view.sources).toHaveLength(2);
    expect(view.figure).not.toBeNull();
  });

  it.each(["PRIMARY_ONLY", "SOURCE_SEEN", "SOURCE_URL", "GO_DEEPER", "FIGURE_LICENCE"])("is judged by %s in publish, not in the draft", (code) => {
    const input = inputOf(faulty());
    expect(forMath(threwNothing(runRules(input, [rule(code)])).filter((i) => i.code === code))).toEqual([]);
    // as one of the draft's own findings it fails the rule, so the skip is the rule's and the fault is real
    const own = { ...input, views: { ...input.views, findings: input.views.findings.map((f) => (f.key === "math-2026-0002" ? { ...f, basis: "draft" as const } : f)) } } as RuleInput;
    expect(forMath(runRules(own, [rule(code)]).filter((i) => i.code === code)).length).toBeGreaterThan(0);
  });

  it("is no source container, whatever its sources hold", () => {
    expect(runRules(inputOf(faulty()), sourcesRules)).toEqual([]);
  });
});

// ── SOURCE_URL ───────────────────────────────────────────────────────────────────────────────────

describe("sourceUrlProblem()", () => {
  it.each([
    ["https://www.nature.com/articles/s41586-026-00001-1"],
    ["https://pastebin.com/abc123"],
    ["https://bit.ly/abc"],
    ["https://www.google.com/search?q=protein"],
    ["https://example.org:8443/page"],
    ["https://ARXIV.org/abs/2611.00002"],
  ])("accepts %s", (url) => {
    expect(sourceUrlProblem(url)).toBeNull();
  });

  it.each([
    ["http://www.nature.com/x", "uses http; cite the https address of the same page"],
    ["HTTP://www.nature.com/x", "uses http; cite the https address of the same page"],
    ["ftp://www.nature.com/x", "is not a valid absolute https URL; copy the page's full address"],
    ["javascript:alert(1)", "is not a valid absolute https URL; copy the page's full address"],
    ["not a url", "is not a valid absolute https URL; copy the page's full address"],
    ["", "is not a valid absolute https URL; copy the page's full address"],
    ["www.nature.com/articles/x", "is not a valid absolute https URL; copy the page's full address"],
    ["https://localhost/page", "is not a valid absolute https URL; copy the page's full address"],
    ["https://exa mple.com/x", "is not a valid absolute https URL; copy the page's full address"],
    ["https://", "is not a valid absolute https URL; copy the page's full address"],
    // an address is read as written: white space that a URL parser keeps in front of the scheme makes it no address, user info or not
    [`${NBSP}https://www.nature.com/x`, "is not a valid absolute https URL; copy the page's full address"],
    [`${NBSP}https://user:pw@www.nature.com/x`, "is not a valid absolute https URL; copy the page's full address"],
    [`${IDEOGRAPHIC_SPACE}https://user:pw@www.nature.com/x`, "is not a valid absolute https URL; copy the page's full address"],
    ["http://localhost/page", "is not a valid absolute https URL; copy the page's full address"],
    ["https://user:pw@www.nature.com/x", "carries a user name or password before the host (user:password@); cite the plain https address of the page"],
    ["https://user@www.nature.com/x", "carries a user name or password before the host (user:password@); cite the plain https address of the page"],
    ["https://:pw@www.nature.com/x", "carries a user name or password before the host (user:password@); cite the plain https address of the page"],
    ["http://user:pw@www.nature.com/x", "carries a user name or password before the host (user:password@); cite the plain https address of the page"],
    ["https://news.google.com/rss/articles/abc", "is a redirect link (news.google.com); open the original page and cite its own URL"],
    ["https://www.google.com/url?q=https://www.nature.com/x", "is a redirect link (google.com/url); open the original page and cite its own URL"],
    ["https://l.facebook.com/l.php?u=x", "is a redirect link (l.facebook.com); open the original page and cite its own URL"],
    ["http://news.google.com/rss/articles/abc", "is a redirect link (news.google.com); open the original page and cite its own URL"],
    ["https://user:pw@news.google.com/x", "is a redirect link (news.google.com); open the original page and cite its own URL"],
    ["https://web.archive.org/web/2026/https://www.nature.com/x", "is an archive copy (web.archive.org); cite the original page"],
    ["https://archive.ph/abc", "is an archive copy (archive.ph); cite the original page"],
    ["https://Archive.Today/abc", "is an archive copy (archive.today); cite the original page"],
    ["http://web.archive.org/web/2026/x", "is an archive copy (web.archive.org); cite the original page"],
  ])("tells %s: %s", (url, problem) => {
    expect(sourceUrlProblem(url)).toBe(problem);
  });
});

describe("SOURCE_URL in draft mode", () => {
  const bad = (url: string, edit: Edit = () => {}) => draftOf("SOURCE_URL", (d, ev) => { first(d, 0, { url }); edit(d, ev); });

  it("passes https addresses with no user info, however the other rules judge them", () => {
    expect(draftOf("SOURCE_URL")).toEqual([]);
    expect(bad("https://pastebin.com/abc123")).toEqual([]);
    expect(bad("https://example.org/unlisted")).toEqual([]);
  });

  it("fails an http address at its url, with the address found and how to fix it", () => {
    const issues = bad("http://www.nature.com/articles/s41586-026-00001-1");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "SOURCE_URL", severity: "error", path: "new_findings[0].sources[0].url",
      message: "s1's URL uses http; cite the https address of the same page. Found: http://www.nature.com/articles/s41586-026-00001-1",
    });
  });

  it("fails an address that is no whole https address", () => {
    expect(bad("www.nature.com/articles/x")[0]!.message).toBe("s1's URL is not a valid absolute https URL; copy the page's full address. Found: www.nature.com/articles/x");
    expect(bad("ftp://www.nature.com/x")).toHaveLength(1);
  });

  it("fails user info, a redirect link and an archive copy, each with its own words", () => {
    expect(bad("https://user:pw@www.nature.com/x")[0]!.message).toContain("s1's URL carries a user name or password before the host");
    expect(bad("https://news.google.com/rss/articles/abc")[0]!.message).toContain("s1's URL is a redirect link (news.google.com); open the original page");
    expect(bad("https://web.archive.org/web/2026/https://www.nature.com/x")[0]!.message).toContain("s1's URL is an archive copy (web.archive.org); cite the original page");
  });

  it("leaves every other blocked host to BLOCKED_HOST", () => {
    for (const url of ["https://pastebin.com/abc", "https://bit.ly/abc", "https://t.me/abc", "https://shodan.io/search?query=x", "https://sci-hub.se/10.1038/x", "https://x.onion/a"]) {
      expect(bad(url), url).toEqual([]);
    }
  });

  it("judges the brief's sources too, at their own paths", () => {
    const issues = draftOf("SOURCE_URL", (d) => { d.sources[1] = { ...d.sources[1], url: "http://news.example.edu/statement/2" }; });
    expect(where(issues)).toEqual(["error sources[1].url"]);
    expect(issues[0]!.message).toBe("b2's URL uses http; cite the https address of the same page. Found: http://news.example.edu/statement/2");
  });

  it("judges every source of every new finding", () => {
    const issues = draftOf("SOURCE_URL", (d) => {
      first(d, 1, { url: "http://arxiv.org/abs/2611.00002" });
      d.new_findings[1].sources[0].url = "https://web.archive.org/web/2026/https://journals.aps.org/prl/x";
      d.sources[2].url = "https://user:pw@news.example.edu/statement/3";
    });
    expect(paths(issues)).toEqual(["new_findings[0].sources[1].url", "new_findings[1].sources[0].url", "sources[2].url"]);
  });

  it("fails a source cited twice in one list, at the later one, naming the first", () => {
    const issues = draftOf("SOURCE_URL", (d) => { first(d, 1, { url: NATURE }); });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "SOURCE_URL", severity: "error", path: "new_findings[0].sources[1].url" });
    // the address in the message is the one the two were compared on, normalizeUrl()'s form of both
    expect(issues[0]!.message).toBe(`s2 has the same URL as s1 (${key(NATURE)}). Cite s1 wherever s2 is cited, remove s2 and renumber the later ids.`);
  });

  it("compares addresses as normalizeUrl() does: the host's www, a trailing slash, the fragment and tracking parameters do not make a new page", () => {
    const same = (url: string) => draftOf("SOURCE_URL", (d) => { first(d, 1, { url }); });
    expect(paths(same("https://nature.com/articles/s41586-026-00001-1/"))).toEqual(["new_findings[0].sources[1].url"]);
    expect(paths(same(`${NATURE}?utm_source=x&fbclid=y#abstract`))).toEqual(["new_findings[0].sources[1].url"]);
    expect(paths(same("HTTPS://WWW.NATURE.COM/articles/s41586-026-00001-1"))).toEqual(["new_findings[0].sources[1].url"]);
    expect(same("https://www.nature.com/articles/s41586-026-00001-2")).toEqual([]);
    expect(same(`${NATURE}?page=2`)).toEqual([]);
  });

  it("names the first of three copies in each later one", () => {
    const issues = draftOf("SOURCE_URL", (d) => {
      d.sources = [src("b1", "statement", EDU1), src("b2", "statement", EDU2), src("b3", "statement", EDU1)];
      d.sources.push(src("b4", "statement", EDU1));
    });
    expect(where(issues)).toEqual(["error sources[2].url", "error sources[3].url"]);
    expect(issues[0]!.message).toContain("b3 has the same URL as b1");
    expect(issues[1]!.message).toContain("b4 has the same URL as b1");
  });

  it("allows one address in different lists: two findings, a finding and the brief", () => {
    const issues = draftOf("SOURCE_URL", (d) => {
      d.new_findings[1].sources[0].url = NATURE;
      d.sources[0].url = NATURE;
      d.sources[1].url = ARXIV;
    });
    expect(issues).toEqual([]);
  });

  it("reports a copy of an address that is itself wrong as well as the wrong address", () => {
    const issues = draftOf("SOURCE_URL", (d) => {
      first(d, 0, { url: "http://www.nature.com/articles/s41586-026-00001-1" });
      first(d, 1, { url: "https://www.nature.com/articles/s41586-026-00001-1" });
    });
    expect(issues.map((i) => i.message.slice(0, 30))).toEqual(["s1's URL uses http; cite the h", "s2 has the same URL as s1 (htt"]);
  });

  it("skips a finding whose sources the run does not know, instead of failing", () => {
    const d = DraftBrief.parse(draftJson());
    const input = buildDraftInput(d, { ...draftInputs(), evidence: Evidence.parse(evidenceJson()) });
    const views = { ...input.views, findings: input.views.findings.map((f) => (f.key === "new-1" ? { ...f, sources: null } : f)) };
    expect(runRules({ ...input, views }, [rule("SOURCE_URL")])).toEqual([]);
  });
});

describe("SOURCE_URL in published mode", () => {
  const badSource = (id: string, index: number, url: string) => (s: Stored) => {
    storedFinding(s, id).sources[index].url = url;
  };

  it("fails a stored record that is being published, at the file and the source, as an error", () => {
    const issues = publishedOf("SOURCE_URL", badSource("bio-2026-0001", 0, "http://www.nature.com/articles/s41586-026-00001-1"));
    expect(where(issues)).toEqual([`error ${BIO}: sources[0].url`]);
    expect(issues[0]!.message).toBe("s1's URL uses http; cite the https address of the same page. Found: http://www.nature.com/articles/s41586-026-00001-1");
  });

  it("makes it a warning on a stored finding that is not being published, with the engine's hint", () => {
    const issues = publishedOf("SOURCE_URL", badSource("phys-2026-0003", 1, "https://news.google.com/rss/articles/abc"));
    expect(where(issues)).toEqual([`warning ${PHYS}: sources[1].url`]);
    expect(issues[0]!.hint).toContain("already published");
  });

  it("judges only the sources a returning finding gained on D as being published, and its older sources as stored records (F-55)", () => {
    // phys-2026-0003 was first briefed earlier; filed with `updated: D` it is a returning finding, whose sources here are both added on D
    const returning = (s: Stored): void => { storedFinding(s, "phys-2026-0003").updated = D; };
    const both = (s: Stored): void => { returning(s); badSource("phys-2026-0003", 0, "http://www.nature.com/x")(s); badSource("phys-2026-0003", 1, "http://www.nature.com/y")(s); };
    expect(where(publishedOf("SOURCE_URL", both))).toEqual([`error ${PHYS}: sources[0].url`, `error ${PHYS}: sources[1].url`]);
    const oneOlder = (s: Stored): void => { both(s); storedFinding(s, "phys-2026-0003").sources[1].added = "2026-11-10"; };
    expect(where(publishedOf("SOURCE_URL", oneOlder))).toEqual([`error ${PHYS}: sources[0].url`, `warning ${PHYS}: sources[1].url`]);
    // a finding last updated before D is not returning on D: both are stored records
    const notReturning = (s: Stored): void => { badSource("phys-2026-0003", 0, "http://www.nature.com/x")(s); };
    expect(where(publishedOf("SOURCE_URL", notReturning))).toEqual([`warning ${PHYS}: sources[0].url`]);
  });

  it("judges the brief being published as an error, and the brief of another date as a warning", () => {
    const edit = (s: Stored) => { s.brief.sources[1].url = "https://archive.ph/abc"; };
    expect(where(publishedOf("SOURCE_URL", edit))).toEqual([`error ${BRIEF}: sources[1].url`]);
    expect(where(publishedOf("SOURCE_URL", edit, { publishing: "2026-11-25" }))).toEqual([`warning ${BRIEF}: sources[1].url`]);
  });

  it("makes every error a warning when nothing is being published", () => {
    const issues = publishedOf("SOURCE_URL", (s) => {
      badSource("bio-2026-0001", 0, "http://www.nature.com/x")(s);
      s.brief.sources[0].url = "https://user:pw@news.example.edu/statement/1";
      storedFinding(s, "math-2026-0002").sources[1] = { ...storedFinding(s, "math-2026-0002").sources[1], url: NATURE };
      storedFinding(s, "math-2026-0002").sources[0].url = NATURE;
    }, { publishing: null });
    expect(where(issues)).toEqual([`warning ${BRIEF}: sources[0].url`, `warning ${BIO}: sources[0].url`, `warning ${MATH}: sources[1].url`]);
  });

  it("applies the uniqueness test to a stored list, a warning on a record that is not being published", () => {
    const edit = (s: Stored) => {
      storedFinding(s, "phys-2026-0003").sources[1].url = `${NATURE}?utm_medium=x`;
      storedFinding(s, "bio-2026-0001").sources[1].url = key(NATURE);
    };
    const issues = publishedOf("SOURCE_URL", edit);
    expect(where(issues)).toEqual([`error ${BIO}: sources[1].url`, `warning ${PHYS}: sources[1].url`]);
    expect(issues[0]!.message).toContain(`s2 has the same URL as s1 (${key(NATURE)})`);
  });

  it("allows one address in a finding's list and in the brief's", () => {
    expect(publishedOf("SOURCE_URL", (s) => { s.brief.sources[0].url = NATURE; })).toEqual([]);
  });

  it("skips a source whose url a stored removed correction rewrote, in the list's duplicate test too", () => {
    const bio = (s: Stored): Json => storedFinding(s, "bio-2026-0001");
    const removeFirst = (s: Stored) => {
      bio(s).sources[0].url = REMOVED_TEXT.en;
      s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "sources.0.url"));
    };
    expect(publishedOf("SOURCE_URL", removeFirst)).toEqual([]);
    // two removed urls hold the same text, which is no duplicate
    const removeBoth = (s: Stored) => {
      removeFirst(s);
      bio(s).sources[1].url = REMOVED_TEXT.en;
      s.corrections.push(removal("C-0004", { finding_id: "bio-2026-0001" }, "sources.1.url"));
    };
    expect(publishedOf("SOURCE_URL", removeBoth)).toEqual([]);
    // the same text where no correction removed it is judged as any other text, and is no copy of the removed one
    const oneLeft = publishedOf("SOURCE_URL", (s) => { removeFirst(s); bio(s).sources[1].url = REMOVED_TEXT.en; });
    expect(where(oneLeft)).toEqual([`error ${BIO}: sources[1].url`]);
    expect(oneLeft[0]!.message).toBe(`s2's URL is not a valid absolute https URL; copy the page's full address. Found: ${REMOVED_TEXT.en}`);
    const unremoved = publishedOf("SOURCE_URL", (s) => { bio(s).sources[1].url = REMOVED_TEXT.en; });
    expect(where(unremoved)).toEqual([`error ${BIO}: sources[1].url`]);
    // a removal of another finding's source, or of another place of this one, skips nothing here
    const otherFinding = publishedOf("SOURCE_URL", (s) => { removeFirst(s); s.corrections[2]!.finding_id = "math-2026-0002"; });
    expect(where(otherFinding)).toEqual([`error ${BIO}: sources[0].url`]);
    const otherPlace = publishedOf("SOURCE_URL", (s) => { removeFirst(s); s.corrections[2]!.path = "sources.1.url"; });
    expect(where(otherPlace)).toEqual([`error ${BIO}: sources[0].url`]);
  });

  it("skips a brief source whose url a stored removed correction rewrote", () => {
    const edit = (s: Stored) => {
      s.brief.sources[0].url = REMOVED_TEXT.en;
      s.corrections.push(removal("C-0003", { edition_date: D }, "sources.0.url"));
    };
    expect(publishedOf("SOURCE_URL", edit)).toEqual([]);
    // a removal for the brief of another date, or for another place of it, skips nothing here
    const otherDate = publishedOf("SOURCE_URL", (s) => { edit(s); s.corrections[2]!.edition_date = "2026-11-20"; });
    expect(where(otherDate)).toEqual([`error ${BRIEF}: sources[0].url`]);
    const otherPlace = publishedOf("SOURCE_URL", (s) => { edit(s); s.corrections[2]!.path = "sources.1.url"; });
    expect(where(otherPlace)).toEqual([`error ${BRIEF}: sources[0].url`]);
    // a removal of a finding's source skips no brief source
    const aFinding = publishedOf("SOURCE_URL", (s) => { edit(s); s.corrections[2]!.edition_date = null; s.corrections[2]!.finding_id = "bio-2026-0001"; });
    expect(where(aFinding)).toEqual([`error ${BRIEF}: sources[0].url`]);
  });

  it("judges a run that names no brief on the findings alone", () => {
    const issues = publishedOf("SOURCE_URL", badSource("bio-2026-0001", 0, "http://www.nature.com/x"), { brief: false });
    expect(where(issues)).toEqual([`error ${BIO}: sources[0].url`]);
  });
});

// ── PRIMARY_ONLY ─────────────────────────────────────────────────────────────────────────────────

describe("PRIMARY_ONLY's URL test in draft mode", () => {
  const cite = (kind: string, url: string, edit: Edit = () => {}) => draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { kind, url }); see(ev, url); edit(d, ev); });

  it("passes each kind on its own listed addresses", () => {
    expect(cite("paper", APS)).toEqual([]);
    expect(cite("preprint", ARXIV)).toEqual([]);
    expect(cite("statement", EDU1)).toEqual([]);
    expect(cite("proof", GITHUB_REPO)).toEqual([]);
    expect(cite("dataset", GITHUB_REPO)).toEqual([]);
    expect(cite("registry", "https://clinicaltrials.gov/study/NCT09999001")).toEqual([]);
    expect(cite("dataset", "https://zenodo.org/records/99900002")).toEqual([]);
    expect(cite("lab_post", "https://deepmind.google/discover/blog/a-made-up-post/")).toEqual([]);
    expect(cite("checker", "https://www.erdosproblems.com/1")).toEqual([]);
    expect(cite("reaction", SMC)).toEqual([]);
  });

  it("fails an address that no list names, at the source's url, in words that say what to cite", () => {
    const issues = cite("paper", UNLISTED);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "PRIMARY_ONLY", severity: "error", path: "new_findings[0].sources[1].url" });
    expect(issues[0]!.message).toBe(
      's2 (kind "paper"): No source list names this page. Cite the paper\'s page on its publisher, a preprint server, a registry, the lab\'s own site or the institution\'s own release.');
    expect(issues[0]!.hint).toBe(
      "Cite a page that the allowlist in your context lists for the source's kind (a paper's page on its publisher, a preprint server, a registry, the lab's or institution's own site), never press.");
  });

  it("fails a news, magazine or blog address whatever its kind", () => {
    for (const kind of ["paper", "statement", "lab_post"]) {
      const issues = cite(kind, "https://www.quantamagazine.org/a-made-up-story-20261120/");
      expect(issues, kind).toHaveLength(1);
      expect(issues[0]!.message, kind).toContain(`s2 (kind "${kind}"): quantamagazine.org is a news, magazine, blog or aggregator site, never a source.`);
    }
  });

  it("fails a denied path and a denied DOI prefix", () => {
    const path = cite("paper", "https://www.science.org/content/article/a-made-up-news-story");
    expect(path[0]!.message).toContain("Pages under /content/article/ on this site are news and features, not papers.");
    const doi = cite("paper", "https://doi.org/10.1021/cen-v100n001.p1");
    expect(doi[0]!.message).toContain("DOIs that start with 10.1021/cen- name a news publication's items, not papers.");
  });

  it("fails a kind the address does not pass for, and says which kinds it does", () => {
    const issues = cite("paper", GITHUB_REPO);
    expect(issues[0]!.message).toBe('s2 (kind "paper"): This page can be cited as "proof" or "dataset", not as "paper". Give the source one of those kinds, or cite a page of kind "paper".');
    expect(cite("reaction", ARXIV)[0]!.message).toContain('This page can be cited as "preprint", not as "reaction". Give the source that kind');
    expect(cite("statement", NATURE_NEWS_VIEWS)[0]!.message).toContain('"reaction"');
  });

  it("fails an address that names a port, and passes the default one", () => {
    expect(cite("paper", "https://journals.aps.org:8443/prl/abstract/10.1103/PhysRevLett.136.000002")[0]!.message).toContain("names a port other than the default one");
    expect(cite("paper", "https://journals.aps.org:443/prl/abstract/10.1103/PhysRevLett.136.000003")).toEqual([]);
  });

  it("lets a reaction source, a lab or a checker that names a press host win, as the list says", () => {
    const press = configWith((t) => { t.press_hosts.push("deepmind.google", "www.erdosproblems.com", "terrytao.wordpress.com"); });
    const run = (kind: string, url: string) => draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { kind, url }); see(ev, url); }, { config: press });
    expect(run("lab_post", "https://deepmind.google/discover/blog/a-made-up-post/")).toEqual([]);
    expect(run("checker", "https://www.erdosproblems.com/1")).toEqual([]);
    expect(run("reaction", "https://terrytao.wordpress.com/2026/11/20/a-made-up-post/")).toEqual([]);
    // the entry that wins admits its own kind only
    expect(run("paper", "https://deepmind.google/discover/blog/a-made-up-post/")[0]!.message).toContain('This page can be cited as "lab_post", not as "paper".');
    expect(run("statement", "https://www.erdosproblems.com/1")[0]!.message).toContain('This page can be cited as "checker", not as "statement".');
    // a press host that no entry names still fails every kind
    expect(run("paper", "https://www.quantamagazine.org/a-made-up-story/")[0]!.message).toContain("never a source");
  });

  it("reads the allowlist from the config it is given, not from the seed", () => {
    const strict = configWith((t) => { t.publishers = t.publishers.filter((p: Json) => p.id !== "aps"); });
    const issues = draftOf("PRIMARY_ONLY", () => {}, { config: strict });
    expect(paths(issues)).toEqual(["new_findings[1].sources[0].url"]);
    const wide = configWith((t) => { t.publishers.push({ ...t.publishers.find((p: Json) => p.id === "aps"), id: "example", name: "Example", hosts: ["example.org"], paths: ["/paper/"] }); });
    const issuesWide = draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 0, { url: UNLISTED }); see(ev, UNLISTED); }, { config: wide });
    expect(issuesWide).toEqual([]);
  });

  it("judges the brief's sources at their own paths", () => {
    const issues = draftOf("PRIMARY_ONLY", (d) => { d.sources[2] = { ...d.sources[2], url: UNLISTED }; d.sources[0] = { ...d.sources[0], kind: "paper", url: EDU1 }; });
    expect(where(issues)).toEqual(["error sources[0].url", "error sources[2].url"]);
    expect(issues[0]!.message).toContain('b1 (kind "paper")');
  });

  it("judges a source cited twice once for each copy", () => {
    const issues = draftOf("PRIMARY_ONLY", (d) => { d.sources[0].url = UNLISTED; d.sources[1].url = UNLISTED; });
    expect(paths(issues)).toEqual(["sources[0].url", "sources[1].url"]);
  });

  it("leaves a URL that SOURCE_URL fails, or any BLOCKED_HOSTS entry matches, to those codes", () => {
    for (const url of [
      "http://www.nature.com/articles/s41586-026-00001-1", "https://user:pw@www.nature.com/articles/s41586-026-00001-1", "www.nature.com/articles/x",
      "https://news.google.com/rss/articles/abc", "https://web.archive.org/web/2026/https://www.nature.com/x", "https://localhost/page",
      "https://pastebin.com/abc", "https://gist.github.com/example/abc", "https://bit.ly/abc", "https://sci-hub.se/10.1038/x", "https://t.me/abc",
      "https://shodan.io/search?query=x",
    ]) {
      expect(draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { url }); see(ev, url); }), url).toEqual([]);
    }
  });

  it("judges the address whether or not the run saw it, which is SOURCE_SEEN's test", () => {
    expect(draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { url: UNLISTED }); ev.urls = []; })).toHaveLength(1);
    expect(draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { url: UNLISTED }); see(ev, UNLISTED); })).toHaveLength(1);
  });
});

describe("PRIMARY_ONLY's type check in draft mode", () => {
  const typed = (kind: string, url: string, types?: string[], landing?: string, edit: Edit = () => {}) =>
    draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { kind, url }); see(ev, url, types, landing); edit(d, ev); });

  it("passes a typed publisher's page whose type fits the kind, and fails one with no type or the wrong one", () => {
    expect(draftOf("PRIMARY_ONLY")).toEqual([]);
    expect(typed("paper", "https://www.nature.com/articles/s41586-026-00005-5", ["BriefCommunication"])).toEqual([]);
    const none = typed("paper", "https://www.nature.com/articles/s41586-026-00005-5");
    expect(where(none)).toEqual(["error new_findings[0].sources[1].url"]);
    expect(none[0]!.message).toBe('s2 (kind "paper"): The run found no article type on this page, so it cannot be told from a news item. Cite another primary record of the work, such as its preprint or its PubMed record, or leave it out.');
    const wrong = typed("paper", "https://www.nature.com/articles/s41586-026-00005-5", ["News And Views"]);
    expect(wrong[0]!.message).toContain('This page is typed "News And Views", which fits "reaction", not "paper".');
    const news = typed("paper", "https://www.nature.com/articles/s41586-026-00005-5", ["News"]);
    expect(news[0]!.message).toContain("which is no primary kind");
  });

  it("gives a failed type check the hint of a failed URL test: what to cite, and never press", () => {
    const refused = draftOf("PRIMARY_ONLY", (d) => { first(d, 1, { kind: "paper", url: UNLISTED }); });
    expect(refused).toHaveLength(1);
    expect(refused[0]!.hint).toContain("allowlist in your context");
    const untyped = typed("paper", "https://www.nature.com/articles/s41586-026-00005-5");
    expect(untyped).toHaveLength(1);
    expect(untyped[0]!.hint).toBe(refused[0]!.hint);
    expect(typed("paper", DOI)[0]!.hint).toBe(refused[0]!.hint);
  });

  it("reads the evidence's types by normalised address, and the kind of the source", () => {
    const url = "https://www.nature.com/articles/s41586-026-00005-5";
    expect(typed("paper", url, undefined, undefined, (_d, ev) => { ev.types[key(`${url}/?utm_source=x#top`)] = ["OriginalPaper"]; })).toEqual([]);
    const retraction = ["Retraction Note"];
    expect(typed("notice", url, retraction)).toEqual([]);
    expect(typed("paper", url, retraction)[0]!.message).toContain('which fits "notice", not "paper"');
    expect(typed("paper", url, ["originalpaper"])).toEqual([]);
  });

  it("passes a doi.org address only through a landing that passes, and says where a failing landing is", () => {
    const landing = "https://www.nature.com/articles/s41586-026-00003-3";
    expect(typed("paper", DOI, undefined, landing, (_d, ev) => { see(ev, landing, ["OriginalPaper"]); })).toEqual([]);
    const lost = typed("paper", DOI);
    expect(lost[0]!.message).toBe('s2 (kind "paper"): The run has not seen where this DOI lands, so the type of its page is unknown. Cite the paper\'s own page after opening it, or leave it out.');
    const wrongType = typed("paper", DOI, undefined, landing, (_d, ev) => { see(ev, landing, ["News And Views"]); });
    expect(wrongType[0]!.message).toContain("This DOI lands on a page that fails the type check.");
    expect(wrongType[0]!.message.endsWith(` It lands on ${landing}.`)).toBe(true);
    const doiLanding = typed("paper", DOI, undefined, "https://doi.org/10.1038/other");
    expect(doiLanding[0]!.message).toContain("lands on another DOI address");
    expect(doiLanding[0]!.message.endsWith(" It lands on https://doi.org/10.1038/other.")).toBe(true);
    const unlisted = typed("paper", DOI, undefined, UNLISTED);
    expect(unlisted[0]!.message).toContain('This DOI lands on a page that is not a primary source for kind "paper". No source list names this page.');
    expect(unlisted[0]!.message.endsWith(` It lands on ${UNLISTED}.`)).toBe(true);
  });

  it("passes a PubMed or PMC record only when the evidence shows its types and none is a refused one", () => {
    expect(typed("paper", PUBMED, ["Journal Article"])).toEqual([]);
    expect(typed("paper", PMC, ["research-article"])).toEqual([]);
    const none = typed("paper", PUBMED);
    expect(none[0]!.message).toContain("The run shows no publication type for this record");
    const news = typed("paper", PUBMED, ["Journal Article", "News"]);
    expect(news[0]!.message).toBe('s2 (kind "paper"): This record is typed "News". News, editorials, comments and interviews are never sources. Cite the paper or the primary record it discusses.');
    expect(typed("paper", PMC, ["Editorial"])).toHaveLength(1);
  });

  it("judges an address by the URL test alone when its publisher has no type field", () => {
    expect(draftOf("PRIMARY_ONLY", (d, ev) => { ev.types = {}; first(d, 0, { url: APS }); first(d, 1, { kind: "preprint", url: ARXIV }); })).toEqual([]);
  });

  it("reports one issue for a source, the URL test's when it fails, so no source is told twice", () => {
    const issues = typed("paper", "https://www.quantamagazine.org/a-made-up-story/", ["News"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("never a source");
    // a DOI the URL test denies is also one whose landing the run has not seen, which the type check would fail again
    const denied = typed("paper", "https://doi.org/10.1021/cen-v100n001.p1");
    expect(denied).toHaveLength(1);
    expect(denied[0]!.message).toContain("DOIs that start with 10.1021/cen-");
  });

  it("judges the brief's sources too", () => {
    const issues = draftOf("PRIMARY_ONLY", (d) => { d.sources[0] = { ...d.sources[0], kind: "paper", url: "https://www.nature.com/articles/s41586-026-00006-6" }; });
    expect(where(issues)).toEqual(["error sources[0].url"]);
    expect(issues[0]!.message).toContain("The run found no article type on this page");
  });

  it("runs without the evidence: the URL test still judges, and the engine says the check ran without it", () => {
    const NO_TYPE = "https://www.nature.com/articles/s41586-026-00006-6"; // a typed publisher's page, whose type only the evidence shows
    const edit: Edit = (d) => { first(d, 1, { url: UNLISTED }); d.sources[0] = { ...d.sources[0], kind: "paper", url: NO_TYPE }; };
    const draft = draftJson();
    edit(draft, {});
    const input = buildDraftInput(DraftBrief.parse(draft), { ...draftInputs(), evidence: null });
    const issues = runRules(input, [rule("PRIMARY_ONLY")]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["INPUT_MISSING", "warning", "(evidence)"],
      ["PRIMARY_ONLY", "error", "new_findings[0].sources[1].url"],
    ]);
    expect(issues[0]!.message).toBe(`No evidence for ${D}, so 1 check ran without it: PRIMARY_ONLY.`);
    expect(issues[0]!.hint).toContain("evidence");
    // with the evidence the typed publisher's page fails its type check as well
    expect(paths(draftOf("PRIMARY_ONLY", edit))).toEqual(["new_findings[0].sources[1].url", "sources[0].url"]);
  });

  it("says one warning for the checks it did not run and the checks it ran without the evidence", () => {
    const input = buildDraftInput(DraftBrief.parse(draftJson()), { ...draftInputs(), evidence: null });
    const issues = runRules(input, sourcesRules);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe(`No evidence for ${D}, so 1 check did not run: SOURCE_SEEN, and 1 check ran without it: PRIMARY_ONLY.`);
  });
});

describe("PRIMARY_ONLY in published mode", () => {
  const unlisted = (id: string, index = 0, url = UNLISTED) => (s: Stored) => { storedFinding(s, id).sources[index].url = url; };

  it("judges a record that is being published, at the file, as an error", () => {
    const issues = publishedOf("PRIMARY_ONLY", unlisted("bio-2026-0001", 1));
    expect(where(issues)).toEqual([`error ${BIO}: sources[1].url`]);
    expect(issues[0]!.message).toContain('s2 (kind "preprint"): No source list names this page.');
  });

  it("does not judge a stored finding that is not being published, which would read a config that has changed", () => {
    expect(publishedOf("PRIMARY_ONLY", unlisted("phys-2026-0003"))).toEqual([]);
    expect(publishedOf("PRIMARY_ONLY", (s) => { for (const f of s.findings) f.sources[0].url = UNLISTED; })).toHaveLength(2);
  });

  it("judges a source a returning finding gained on D against the lists and an older source of it not at all (F-55)", () => {
    const returning = (s: Stored): void => { storedFinding(s, "phys-2026-0003").updated = D; };
    const edit = (s: Stored): void => { returning(s); unlisted("phys-2026-0003", 0)(s); unlisted("phys-2026-0003", 1)(s); };
    const issues = publishedOf("PRIMARY_ONLY", edit);
    expect(where(issues)).toEqual([`error ${PHYS}: sources[0].url`, `error ${PHYS}: sources[1].url`]);
    expect(issues[0]!.message).toContain('s1 (kind "paper"): No source list names this page.');
    // the second source was added on an earlier day: it is an archived record, and a list that changed since does not fail it
    const older = (s: Stored): void => { edit(s); storedFinding(s, "phys-2026-0003").sources[1].added = "2026-11-10"; };
    expect(where(publishedOf("PRIMARY_ONLY", older))).toEqual([`error ${PHYS}: sources[0].url`]);
    // a finding last updated before D is none of D's
    expect(publishedOf("PRIMARY_ONLY", unlisted("phys-2026-0003", 0))).toEqual([]);
  });

  it("judges a finding first briefed on D whole, its sources whatever their dates (F-55)", () => {
    const edit = (s: Stored): void => { unlisted("bio-2026-0001", 0)(s); unlisted("bio-2026-0001", 1)(s); storedFinding(s, "bio-2026-0001").sources[1].added = "2026-10-05"; };
    expect(where(publishedOf("PRIMARY_ONLY", edit))).toEqual([`error ${BIO}: sources[0].url`, `error ${BIO}: sources[1].url`]);
  });

  it("judges the brief only when it is the brief being published", () => {
    const edit = (s: Stored) => { s.brief.sources[0].url = UNLISTED; };
    expect(where(publishedOf("PRIMARY_ONLY", edit))).toEqual([`error ${BRIEF}: sources[0].url`]);
    expect(publishedOf("PRIMARY_ONLY", edit, { publishing: "2026-11-25" })).toEqual([]);
    expect(publishedOf("PRIMARY_ONLY", edit, { publishing: null })).toEqual([]);
  });

  it("judges nothing when nothing is being published", () => {
    expect(publishedOf("PRIMARY_ONLY", (s) => { for (const f of s.findings) f.sources[0].url = UNLISTED; s.brief.sources[0].url = UNLISTED; }, { publishing: null })).toEqual([]);
  });

  it("judges the findings first briefed on the date even when no brief is judged", () => {
    const issues = publishedOf("PRIMARY_ONLY", (s) => { for (const f of s.findings) f.sources[0].url = UNLISTED; }, { brief: false });
    expect(paths(issues)).toEqual([`${BIO}: sources[0].url`, `${MATH}: sources[0].url`]);
  });

  it("reads the config it is given: a host the allowlist later drops fails on a record being published, and on no other", () => {
    const strict = configWith((t) => { t.publishers = t.publishers.filter((p: Json) => p.id !== "arxiv"); });
    const issues = publishedOf("PRIMARY_ONLY", () => {}, { config: strict });
    expect(paths(issues)).toEqual([`${BIO}: sources[1].url`, `${MATH}: sources[1].url`]);
  });

  it("never runs the type check, which reads the run's evidence", () => {
    const issues = publishedOf("PRIMARY_ONLY", (s) => { storedFinding(s, "bio-2026-0001").sources[0].url = "https://www.nature.com/articles/s41586-026-00007-7"; });
    expect(issues).toEqual([]);
    const run = threwNothing(publishedIssues((s) => { storedFinding(s, "bio-2026-0001").sources[0].url = "https://www.nature.com/articles/s41586-026-00007-7"; }));
    expect(run.filter((i) => i.code === "INPUT_MISSING")).toEqual([]);
  });

  it("leaves a URL that SOURCE_URL or BLOCKED_HOST judges to them", () => {
    for (const url of ["http://www.nature.com/articles/s41586-026-00001-1", "https://news.google.com/rss/articles/abc", "https://pastebin.com/abc", "https://bit.ly/abc"]) {
      expect(publishedOf("PRIMARY_ONLY", unlisted("bio-2026-0001", 0, url)), url).toEqual([]);
    }
  });

  it("judges a source address that a stored removed correction names while the record still holds it, and has nothing to judge in REMOVED_TEXT", () => {
    // The marker is no address: SOURCE_URL judges it and PRIMARY_ONLY skips a URL that SOURCE_URL fails, removed or not. A removed
    // correction over an address the allowlist fails skips nothing (SPEC §4.12 "Removed text": only text that IS the marker is skipped).
    const marker = (s: Stored) => { storedFinding(s, "bio-2026-0001").sources[1].url = REMOVED_TEXT.en; };
    expect(publishedOf("PRIMARY_ONLY", marker)).toEqual([]);
    expect(publishedOf("PRIMARY_ONLY", (s) => { marker(s); s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "sources.1.url")); })).toEqual([]);
    expect(where(publishedOf("PRIMARY_ONLY", unlisted("bio-2026-0001", 1)))).toEqual([`error ${BIO}: sources[1].url`]);
    const edit = (s: Stored) => {
      unlisted("bio-2026-0001", 1)(s);
      s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "sources.1.url"));
    };
    expect(where(publishedOf("PRIMARY_ONLY", edit))).toEqual([`error ${BIO}: sources[1].url`]);
    // a removal of another finding's source, or of another place of this one, skips nothing either
    const otherFinding = publishedOf("PRIMARY_ONLY", (s) => { edit(s); s.corrections[2]!.finding_id = "math-2026-0002"; });
    expect(where(otherFinding)).toEqual([`error ${BIO}: sources[1].url`]);
    const otherPlace = publishedOf("PRIMARY_ONLY", (s) => { edit(s); s.corrections[2]!.path = "sources.0.url"; });
    expect(where(otherPlace)).toEqual([`error ${BIO}: sources[1].url`]);
  });

  it("judges a brief source address that a stored removed correction names while the record still holds it, and has nothing to judge in REMOVED_TEXT", () => {
    const marker = (s: Stored) => {
      s.brief.sources[1].url = REMOVED_TEXT.en;
      s.corrections.push(removal("C-0003", { edition_date: D }, "sources.1.url"));
    };
    expect(publishedOf("PRIMARY_ONLY", marker)).toEqual([]);
    const edit = (s: Stored) => {
      s.brief.sources[1].url = UNLISTED;
      s.corrections.push(removal("C-0003", { edition_date: D }, "sources.1.url"));
    };
    expect(where(publishedOf("PRIMARY_ONLY", edit))).toEqual([`error ${BRIEF}: sources[1].url`]);
    expect(where(publishedOf("PRIMARY_ONLY", (s) => { s.brief.sources[1].url = UNLISTED; })))
      .toEqual([`error ${BRIEF}: sources[1].url`]);
    const otherDate = publishedOf("PRIMARY_ONLY", (s) => { edit(s); s.corrections[2]!.edition_date = "2026-11-20"; });
    expect(where(otherDate)).toEqual([`error ${BRIEF}: sources[1].url`]);
    const otherPlace = publishedOf("PRIMARY_ONLY", (s) => { edit(s); s.corrections[2]!.path = "sources.0.url"; });
    expect(where(otherPlace)).toEqual([`error ${BRIEF}: sources[1].url`]);
  });
});

// ── SOURCE_SEEN ──────────────────────────────────────────────────────────────────────────────────

describe("SOURCE_SEEN", () => {
  const unseen = (edit: Edit = () => {}) => draftOf("SOURCE_SEEN", edit);

  it("passes every URL in the evidence, however the run saw it", () => {
    expect(unseen()).toEqual([]);
    const url = "https://example.org/a-page-seen-three-ways";
    for (const seen_as of ["pack", "fetched", "search"]) {
      expect(unseen((d, ev) => { first(d, 1, { url }); see(ev, url); ev.seen_as[key(url)] = seen_as; if (seen_as === "fetched") ev.fetched.push(url); }), seen_as).toEqual([]);
    }
  });

  it("fails a URL the run did not see, at its url, with the address found and what to do", () => {
    const issues = unseen((d) => { first(d, 1, { url: "https://arxiv.org/abs/2611.00099" }); });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "SOURCE_SEEN", severity: "error", path: "new_findings[0].sources[1].url" });
    expect(issues[0]!.message).toBe(
      "s2's URL https://arxiv.org/abs/2611.00099 is not in the source pack, a page you fetched or a search result you saw. Cite only URLs you actually saw, or remove s2.");
    expect(issues[0]!.hint).toBe("Copy the URL exactly as the pack, the fetch or the search result gave it, or open the page first.");
  });

  it("compares addresses as normalizeUrl() does, whichever side carries the difference", () => {
    expect(unseen((d, ev) => { first(d, 0, { url: `${NATURE}/?utm_source=x#abstract` }); ev.urls = ev.urls.filter((u: string) => u !== NATURE); ev.urls.push("https://nature.com/articles/s41586-026-00001-1"); })).toEqual([]);
    expect(unseen((d) => { first(d, 0, { url: "https://www.nature.com/articles/s41586-026-00001-1/" }); })).toEqual([]);
    expect(unseen((d) => { first(d, 0, { url: `${NATURE}?page=2` }); })).toHaveLength(1);
  });

  it("judges only the evidence's list of addresses, not the pages it holds text for", () => {
    const url = "https://arxiv.org/abs/2611.00099";
    expect(unseen((d, ev) => { first(d, 1, { url }); ev.texts[key(url)] = "Page text."; })).toHaveLength(1);
  });

  it("judges the brief's sources and every new finding's, each at its own path", () => {
    const issues = unseen((d) => {
      d.sources[1].url = "https://news.example.edu/statement/99";
      d.new_findings[1].sources[0].url = "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.136.999999";
      first(d, 0, { url: "https://www.nature.com/articles/s41586-026-99999-9" });
    });
    expect(paths(issues)).toEqual(["new_findings[0].sources[0].url", "new_findings[1].sources[0].url", "sources[1].url"]);
    expect(issues[2]!.message).toContain("b2's URL https://news.example.edu/statement/99");
  });

  it("judges an address whatever the allowlist says of it", () => {
    expect(unseen((d, ev) => { first(d, 1, { url: UNLISTED }); see(ev, UNLISTED); })).toEqual([]);
    expect(unseen((d) => { first(d, 1, { url: UNLISTED }); })).toHaveLength(1);
  });

  it("tells each copy of an unseen address", () => {
    expect(paths(unseen((d) => { first(d, 1, { url: "https://arxiv.org/abs/2611.00099" }); d.sources[0].url = "https://arxiv.org/abs/2611.00099"; d.sources[1].url = "https://arxiv.org/abs/2611.00099"; })))
      .toEqual(["new_findings[0].sources[1].url", "sources[0].url", "sources[1].url"]);
  });

  it("leaves a URL that SOURCE_URL fails, or any BLOCKED_HOSTS entry matches, to those codes", () => {
    for (const url of [
      "http://www.nature.com/articles/s41586-026-00099-9", "https://user:pw@www.nature.com/articles/x", "https://news.google.com/rss/articles/zzz",
      "https://web.archive.org/web/2026/https://www.nature.com/zzz", "https://pastebin.com/zzz", "https://bit.ly/zzz", "https://sci-hub.se/zzz", "not a url",
    ]) {
      expect(unseen((d) => { first(d, 1, { url }); }), url).toEqual([]);
    }
  });

  it("does not run in published mode, where the run's evidence is no input", () => {
    expect(rule("SOURCE_SEEN").scope).toEqual(["draft"]);
    const issues = threwNothing(publishedIssues((s) => { storedFinding(s, "bio-2026-0001").sources[0].url = "https://example.org/never-seen"; }));
    expect(issues.filter((i) => i.code === "SOURCE_SEEN" || i.code === "INPUT_MISSING")).toEqual([]);
  });

  it("is skipped with one warning when the run has no evidence, and no URL is judged", () => {
    const d = draftJson();
    first(d, 1, { url: "https://arxiv.org/abs/2611.00099" });
    const input = buildDraftInput(DraftBrief.parse(d), { ...draftInputs(), evidence: null });
    const issues = runRules(input, [rule("SOURCE_SEEN")]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([["INPUT_MISSING", "warning", "(evidence)"]]);
    expect(issues[0]!.message).toBe(`No evidence for ${D}, so 1 check did not run: SOURCE_SEEN.`);
  });

  it("judges every URL of the draft as unseen when the evidence lists no URL", () => {
    const issues = unseen((_d, ev) => { ev.urls = []; });
    expect(paths(issues)).toEqual([
      "new_findings[0].sources[0].url", "new_findings[0].sources[1].url", "new_findings[1].sources[0].url", "sources[0].url", "sources[1].url", "sources[2].url",
    ]);
  });
});

// ── GO_DEEPER ────────────────────────────────────────────────────────────────────────────────────

/** A new finding with six sources of the given kinds in order, and the given Go deeper. */
function goDeeperDraft(kinds: string[], ids: string[], kind = "result"): Edit {
  return (d) => {
    const f = d.new_findings[0];
    f.kind = kind;
    f.sources = kinds.map((k, i) => src(`s${i + 1}`, k, `https://example.org/source/${i + 1}`));
    f.go_deeper = ids;
  };
}

describe("GO_DEEPER in draft mode", () => {
  const run = (kinds: string[], ids: string[], kind = "result") => draftOf("GO_DEEPER", goDeeperDraft(kinds, ids, kind));
  const KINDS = ["paper", "preprint", "proof", "dataset", "registry", "checker", "statement", "lab_post"];

  it("passes one, two or three ids of the kinds Go deeper takes", () => {
    expect(draftOf("GO_DEEPER")).toEqual([]);
    expect(run(["paper", "preprint", "proof"], ["s1"])).toEqual([]);
    expect(run(["paper", "preprint", "proof"], ["s1", "s2"])).toEqual([]);
    expect(run(["paper", "preprint", "proof"], ["s3", "s1", "s2"])).toEqual([]);
  });

  it.each(KINDS.map((k) => [k]))("takes a source of kind %s", (kind) => {
    expect(run([kind], ["s1"])).toEqual([]);
    expect(run([kind], ["s1"], "setback")).toEqual([]);
  });

  it("fails no id, at the list, saying to list one", () => {
    const issues = run(["paper"], []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "GO_DEEPER", severity: "error", path: "new_findings[0].go_deeper" });
    expect(issues[0]!.message).toBe("Go deeper lists no sources; a finding lists 1 to 3. List the ids of the finding's best sources to read more.");
  });

  it("fails four or more ids, saying how many to remove", () => {
    const kinds = ["paper", "paper", "paper", "paper", "paper", "paper"];
    const four = run(kinds, ["s1", "s2", "s3", "s4"]);
    expect(four).toHaveLength(1);
    expect(four[0]).toMatchObject({ path: "new_findings[0].go_deeper" });
    expect(four[0]!.message).toBe("Go deeper lists 4 ids; a finding lists 1 to 3. Remove 1, keeping the best places to read more.");
    expect(run(kinds, ["s1", "s2", "s3", "s4", "s5", "s6"])[0]!.message).toBe("Go deeper lists 6 ids; a finding lists 1 to 3. Remove 3, keeping the best places to read more.");
  });

  it("counts the ids as written, a repeated id included", () => {
    expect(run(["paper", "paper"], ["s1", "s1", "s2"])).toEqual([]);
    expect(run(["paper", "paper"], ["s1", "s1", "s2", "s2"])).toHaveLength(1);
  });

  it("fails a reaction in any finding, at the id, naming the kinds it takes", () => {
    const issues = run(["paper", "reaction"], ["s1", "s2"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "GO_DEEPER", severity: "error", path: "new_findings[0].go_deeper[1]" });
    expect(issues[0]!.message).toBe(
      'Go deeper lists s2, a source of kind "reaction", which it does not take: it takes paper, preprint, proof, dataset, registry, checker, statement, lab_post. List one of this finding\'s sources of those kinds instead.');
    expect(run(["paper", "reaction"], ["s2"], "setback")).toHaveLength(1);
  });

  it("takes a notice for a setback only, and says so", () => {
    const issues = run(["notice", "paper"], ["s1", "s2"]);
    expect(where(issues)).toEqual(["error new_findings[0].go_deeper[0]"]);
    expect(issues[0]!.message).toContain('a source of kind "notice", which it does not take: it takes paper, preprint, proof, dataset, registry, checker, statement, lab_post. A notice is a Go deeper source only for a setback.');
    expect(run(["notice", "paper"], ["s1", "s2"], "setback")).toEqual([]);
    for (const kind of ["result", "capability", "check", "infrastructure", "policy_people"]) expect(run(["notice"], ["s1"], kind), kind).toHaveLength(1);
  });

  it("names a setback's kinds with the notice in its message", () => {
    const issues = run(["reaction"], ["s1"], "setback");
    expect(issues[0]!.message).toContain("it takes paper, preprint, proof, dataset, registry, checker, statement, lab_post, notice.");
    expect(issues[0]!.message).not.toContain("only for a setback");
  });

  it("reports the count and each kind in one finding, and in each finding", () => {
    const issues = draftOf("GO_DEEPER", (d, ev) => {
      goDeeperDraft(["reaction", "paper", "paper", "notice", "paper"], ["s1", "s2", "s3", "s4"])(d, ev);
      d.new_findings[1].go_deeper = [];
    });
    expect(paths(issues)).toEqual(["new_findings[0].go_deeper", "new_findings[0].go_deeper[0]", "new_findings[0].go_deeper[3]", "new_findings[1].go_deeper"]);
  });

  it("leaves an id that names no source to SOURCE_IDS", () => {
    expect(run(["paper"], ["s1", "s7"])).toEqual([]);
    expect(run(["paper"], ["s7", "s8", "s9"])).toEqual([]);
    expect(run(["paper"], ["s7"])).toEqual([]);
  });

  it("judges an id by the finding's own source of that id, never another list's", () => {
    const issues = draftOf("GO_DEEPER", (d) => { d.new_findings[1].go_deeper = ["s1"]; d.new_findings[1].sources = [src("s1", "reaction", SMC)]; });
    expect(where(issues)).toEqual(["error new_findings[1].go_deeper[0]"]);
  });

  it("skips a finding whose Go deeper the run does not know, instead of failing", () => {
    const input = buildDraftInput(DraftBrief.parse(draftJson()), { ...draftInputs(), evidence: Evidence.parse(evidenceJson()) });
    const views = { ...input.views, findings: input.views.findings.map((f) => ({ ...f, go_deeper: null })) };
    expect(runRules({ ...input, views }, [rule("GO_DEEPER")])).toEqual([]);
  });
});

describe("GO_DEEPER in published mode", () => {
  it("judges every stored record, at the file, and never makes the error a warning", () => {
    const edit = (s: Stored) => {
      storedFinding(s, "bio-2026-0001").go_deeper = [];
      storedFinding(s, "phys-2026-0003").go_deeper = ["s1", "s2", "s1", "s2"];
      storedFinding(s, "math-2026-0002").sources[1].kind = "reaction";
      storedFinding(s, "math-2026-0002").go_deeper = ["s1", "s2"];
    };
    for (const publishing of [D, null]) {
      const issues = publishedOf("GO_DEEPER", edit, { publishing });
      expect(where(issues), String(publishing)).toEqual([`error ${BIO}: go_deeper`, `error ${MATH}: go_deeper[1]`, `error ${PHYS}: go_deeper`]);
    }
    expect(publishedOf("GO_DEEPER", edit)[2]!.message).toBe("Go deeper lists 4 ids; a finding lists 1 to 3. Remove 1, keeping the best places to read more.");
  });

  it("takes a notice for a stored setback only, as the record was published", () => {
    const notice = (kind: string) => (s: Stored) => {
      const f = storedFinding(s, "bio-2026-0001");
      f.kind = kind;
      f.sources[1].kind = "notice";
      f.go_deeper = ["s1", "s2"];
    };
    expect(where(publishedOf("GO_DEEPER", notice("result")))).toEqual([`error ${BIO}: go_deeper[1]`]);
    expect(publishedOf("GO_DEEPER", notice("setback"))).toEqual([]);
  });

  it("reads the kind the record holds, whatever a stored correction refiled it as", () => {
    const refile = (kind: string, after: string) => (s: Stored) => {
      const f = storedFinding(s, "bio-2026-0001");
      f.kind = kind;
      f.sources[1].kind = "notice";
      f.go_deeper = ["s1", "s2"];
      s.corrections.push({
        id: "C-0003", date: "2026-11-20", finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "kind",
        before: l(kind), after: l(after), reason: l("The finding was refiled."), source_url: null, trigger: "editor", report_id: null,
      });
    };
    expect(publishedOf("GO_DEEPER", refile("result", "setback"))).toHaveLength(1);
    expect(publishedOf("GO_DEEPER", refile("setback", "result"))).toEqual([]);
  });

  it("judges a run that names no brief on its findings", () => {
    const issues = publishedOf("GO_DEEPER", (s) => { storedFinding(s, "bio-2026-0001").go_deeper = []; }, { brief: false });
    expect(where(issues)).toEqual([`error ${BIO}: go_deeper`]);
  });
});

// ── FIGURE_LICENCE ───────────────────────────────────────────────────────────────────────────────

describe("namesLicence()", () => {
  it.each([
    ["CC-BY-4.0", QUOTE_BY],
    ["CC-BY-4.0", "CC BY 4.0"],
    ["CC-BY-4.0", "cc by 4.0"],
    ["CC-BY-4.0", "CC-BY-4.0"],
    ["CC-BY-4.0", "CC-BY 4.0"],
    ["CC-BY-4.0", "Figure 2, (CC BY 4.0), first published in 2026"],
    ["CC-BY-4.0", "Attribution 4.0 International (CC BY 4.0)"],
    ["CC-BY-4.0", "Distributed under a Creative Commons Attribution License 4.0 (CC BY)"],
    ["CC-BY-4.0", "Creative Commons Attribution Licence 4.0"],
    ["CC-BY-4.0", "CC BY license 4.0"],
    ["CC-BY-4.0", "CC BY 4"],
    ["CC-BY-4.0", "Licence: Creative Commons Attribution Licence 4.0"],
    ["CC-BY-4.0", "Licensed under CC BY 4.0 2024 The Authors"],
    ["CC-BY-4.0", "Creative   Commons\nAttribution 4.0"],
    ["CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0/"],
    ["CC-BY-SA-4.0", "CC BY-SA 4.0"],
    ["CC-BY-SA-4.0", "CC-BY-SA-4.0"],
    ["CC-BY-SA-4.0", "cc by sa 4.0"],
    ["CC-BY-SA-4.0", "Creative Commons Attribution-ShareAlike 4.0 International"],
    ["CC-BY-SA-4.0", "Creative Commons Attribution Share Alike 4.0"],
    ["CC-BY-SA-4.0", "Creative Commons Attribution-ShareAlike License 4.0"],
    ["CC-BY-SA-4.0", "CC BY-SA license 4"],
    ["CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/4.0/"],
    ["CC0-1.0", "CC0"],
    ["CC0-1.0", "cc0 1.0 universal"],
    ["CC0-1.0", "CC0 1.0 Public Domain Dedication"],
    ["CC0-1.0", "Creative Commons Zero"],
    ["CC0-1.0", "(CC0)"],
    ["CC0-1.0", "https://creativecommons.org/publicdomain/zero/1.0/"],
    ["public-domain", "public domain"],
    ["public-domain", "This work is in the PUBLIC DOMAIN in the United States"],
    ["public-domain", "Public Domain Mark 1.0"],
    ["public-domain", "CC0 1.0 Universal Public Domain Dedication"],
  ])("accepts %s for %j", (licence, quote) => {
    expect(namesLicence(licence, quote)).toBe(true);
  });

  it.each([
    ["CC-BY-4.0", ""],
    ["CC-BY-4.0", "All rights reserved"],
    ["CC-BY-4.0", "Figure 2 shows the protein in its folded shape"],
    ["CC-BY-4.0", "CC BY 3.0"],
    ["CC-BY-4.0", "CC BY 40"],
    ["CC-BY-4.0", "Creative Commons Attribution License"],
    ["CC-BY-4.0", "Creative Commons Attribution 3.0 Unported"],
    ["CC-BY-4.0", "CC BY-NC 4.0"],
    ["CC-BY-4.0", "CC BY-ND 4.0"],
    ["CC-BY-4.0", "CC BY-SA 4.0"],
    ["CC-BY-4.0", "CC BY-NC-SA 4.0"],
    ["CC-BY-4.0", "Creative Commons Attribution-NonCommercial 4.0"],
    ["CC-BY-4.0", "Creative Commons Attribution-ShareAlike 4.0"],
    ["CC-BY-4.0", "CC 4.0"],
    ["CC-BY-4.0", "BY 4.0"],
    ["CC-BY-4.0", "https://creativecommons.org/licenses/by-sa/4.0/"],
    ["CC-BY-4.0", "CC0 1.0"],
    ["CC-BY-4.0", "ACC BY 4.0"],
    ["CC-BY-4.0", "Noncreative commons attribution 4.0"],
    ["CC-BY-4.0", "Creative Commons Attribution 40"],
    ["CC-BY-4.0", "https://creativecommons.org/sublicenses/by/4.0/"],
    ["CC-BY-4.0", "https://creativecommons.org/licenses/by/40/"],
    ["CC-BY-SA-4.0", "CC BY 4.0"],
    ["CC-BY-SA-4.0", "ACC BY SA 4.0"],
    ["CC-BY-SA-4.0", "CC BY-SA 40"],
    ["CC-BY-SA-4.0", "Creative Commons Attribution-ShareAlike 40"],
    ["CC-BY-SA-4.0", "Creative Commons Attribution-ShareAlike 3.0"],
    ["CC-BY-SA-4.0", "https://creativecommons.org/sublicenses/by-sa/4.0/"],
    ["CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/40/"],
    ["CC-BY-SA-4.0", "CC BY-SA 3.0"],
    ["CC-BY-SA-4.0", "CC BY-NC-SA 4.0"],
    ["CC-BY-SA-4.0", "Creative Commons Attribution 4.0"],
    ["CC-BY-SA-4.0", "ShareAlike 4.0"],
    ["CC-BY-SA-4.0", "https://creativecommons.org/licenses/by/4.0/"],
    ["CC0-1.0", "CC BY 4.0"],
    ["CC0-1.0", "No rights reserved"],
    ["CC0-1.0", "Zero rights"],
    ["CC0-1.0", "CC 1.0"],
    ["CC0-1.0", "Public Domain Mark"],
    ["CC0-1.0", "CC00 1.0"],
    ["CC0-1.0", "Creative Commons Zeroes"],
    ["CC0-1.0", "ABCC0"],
    ["CC0-1.0", "https://creativecommons.org/publicdomain/zero/1.00/"],
    ["CC0-1.0", "https://creativecommons.org/publicdomain/nonzero/1.0/"],
    ["public-domain", "CC BY 4.0"],
    ["public-domain", "The republic domain"],
    ["public-domain", "public domains"],
    ["public-domain", "Publicdomain"],
    ["public-domain", "the domain is public"],
  ])("refuses %s for %j", (licence, quote) => {
    expect(namesLicence(licence, quote)).toBe(false);
  });

  it("names no licence it does not know, and no property of an object", () => {
    for (const licence of ["", "MIT", "cc-by-4.0", "CC-BY-3.0", "constructor", "__proto__", "toString"]) {
      expect(namesLicence(licence, "CC BY 4.0 CC0 public domain"), licence).toBe(false);
    }
  });
});

/** The first new finding's figure, with its host, licence and quote. */
const figure = (over: Json = {}): Edit => (d) => {
  d.new_findings[0].figure = {
    source_id: "s1", image_url: FIGURE, licence: "CC-BY-4.0", licence_quote: QUOTE_BY, credit: "Figure 2 from a made-up paper, CC BY 4.0",
    alt: "A made-up figure of a folded protein.", ...over,
  };
};

describe("FIGURE_LICENCE in draft mode", () => {
  const run = (over: Json = {}, edit: Edit = () => {}, extra: Partial<DraftInputs> = {}) =>
    draftOf("FIGURE_LICENCE", (d, ev) => { figure(over)(d, ev); edit(d, ev); }, extra);

  it("passes a figure on a figure host whose quote names its licence, and a finding with no figure", () => {
    expect(draftOf("FIGURE_LICENCE")).toEqual([]);
    expect(run()).toEqual([]);
  });

  it("passes each of the seed's figure hosts, exactly as listed", () => {
    for (const host of config().index.figureHosts) expect(run({ image_url: `https://${host}/figures/one.png` }), host).toEqual([]);
  });

  it("fails a host that figure_hosts does not list, at the image_url, naming the hosts that it does", () => {
    const issues = run({ image_url: "https://example.org/figures/one.png" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "FIGURE_LICENCE", severity: "error", path: "new_findings[0].figure.image_url" });
    expect(issues[0]!.message).toBe(
      `The figure's image URL is on example.org, which is not a figure host (${[...config().index.figureHosts].join(", ")}). Found: https://example.org/figures/one.png`);
    expect(issues[0]!.hint).toBe(
      "A figure may come only from a host in figure_hosts (config/source-tiers.json), the hosts the site's content security policy lets images load from; otherwise set the figure to null.");
  });

  it("lists the hosts of the config it is given", () => {
    const cfg = configWith((t) => { t.figure_hosts = ["images.example.org", "arxiv.org"]; });
    expect(run({ image_url: "https://images.example.org/a.png" }, () => {}, { config: cfg })).toEqual([]);
    const issues = run({ image_url: FIGURE }, () => {}, { config: cfg });
    expect(issues[0]!.message).toContain("which is not a figure host (images.example.org, arxiv.org).");
  });

  it("matches the host exactly: a subdomain, a parent and a lookalike of a listed host fail", () => {
    for (const host of ["cdn.arxiv.org", "springernature.com", "evil-arxiv.org", "arxiv.org.evil.example", "www.arxiv.org", "export.arxiv.org"]) {
      expect(run({ image_url: `https://${host}/a.png` }), host).toHaveLength(1);
    }
    expect(run({ image_url: "https://ARXIV.ORG/a.png" })).toEqual([]);
  });

  it("fails an address that is not plain https on a listed host", () => {
    const why = (url: string) => run({ image_url: url })[0]?.message;
    expect(why("http://arxiv.org/a.png")).toBe("The figure's image URL is not an https address. Found: http://arxiv.org/a.png");
    expect(why("https://user:pw@arxiv.org/a.png")).toContain("image URL carries a user name or password.");
    expect(why("https://user@arxiv.org/a.png")).toContain("image URL carries a user name or password.");
    expect(why("https://:pw@arxiv.org/a.png")).toContain("image URL carries a user name or password.");
    expect(why("https://arxiv.org:8443/a.png")).toContain("image URL names a port.");
    expect(why("https://arxiv.org./a.png")).toContain("image URL is on arxiv.org., which is not a figure host");
    expect(why("//arxiv.org/a.png")).toContain("image URL is not a whole address.");
    expect(why("arxiv.org/a.png")).toContain("image URL is not a whole address.");
    expect(why("https://arxiv.org:443/a.png")).toBeUndefined();
    expect(why("https://arxiv.org/a.png?width=200#frag")).toBeUndefined();
  });

  it("leaves an address on a blocked host to BLOCKED_HOST, whatever its kind", () => {
    for (const url of ["https://pastebin.com/a.png", "https://bit.ly/a.png", "https://news.google.com/a.png", "https://web.archive.org/web/2026/https://arxiv.org/a.png", "https://x.onion/a.png"]) {
      expect(run({ image_url: url }), url).toEqual([]);
    }
  });

  it("fails a quote that names no licence, or another one, at the licence_quote", () => {
    const issues = run({ licence_quote: "All rights reserved." });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "FIGURE_LICENCE", severity: "error", path: "new_findings[0].figure.licence_quote" });
    expect(issues[0]!.message).toBe(
      'The figure\'s licence_quote does not name its licence CC-BY-4.0. Quote the sentence on the source page that names it, such as "CC BY 4.0" or "Creative Commons Attribution 4.0". Found: "All rights reserved."');
    expect(run({ licence_quote: "Creative Commons Attribution-NonCommercial 4.0 International" })).toHaveLength(1);
    expect(run({ licence: "CC-BY-SA-4.0" })[0]!.message).toContain('"CC BY-SA 4.0" or "Creative Commons Attribution-ShareAlike 4.0"');
    expect(run({ licence: "CC0-1.0" })[0]!.message).toContain('"CC0" or "Creative Commons Zero"');
    expect(run({ licence: "public-domain" })[0]!.message).toContain('such as "public domain".');
  });

  it("passes each licence with a quote that names it", () => {
    expect(run({ licence: "CC-BY-SA-4.0", licence_quote: "Licensed under CC BY-SA 4.0" })).toEqual([]);
    expect(run({ licence: "CC0-1.0", licence_quote: "Dedicated to the public domain under CC0 1.0" })).toEqual([]);
    expect(run({ licence: "public-domain", licence_quote: "This image is in the public domain" })).toEqual([]);
  });

  it("tells both problems of one figure, each at its own string", () => {
    const issues = run({ image_url: "https://example.org/a.png", licence_quote: "All rights reserved." });
    expect(paths(issues)).toEqual(["new_findings[0].figure.image_url", "new_findings[0].figure.licence_quote"]);
  });

  it("judges the figure of each finding", () => {
    const issues = draftOf("FIGURE_LICENCE", (d, ev) => {
      figure({ licence_quote: "No licence" })(d, ev);
      d.new_findings[1].figure = { ...d.new_findings[0].figure, image_url: "https://example.org/b.png", licence_quote: QUOTE_BY };
    });
    expect(paths(issues)).toEqual(["new_findings[0].figure.licence_quote", "new_findings[1].figure.image_url"]);
  });

  it("falls back to the licence's own name when it has no example, for a licence that is none of the four", () => {
    const input = buildDraftInput(DraftBrief.parse(draftJson()), { ...draftInputs(), evidence: Evidence.parse(evidenceJson()) });
    const withFigure = buildDraftInput(DraftBrief.parse((() => { const d = draftJson(); figure()(d, {}); return d; })()), { ...draftInputs(), evidence: Evidence.parse(evidenceJson()) });
    const views = { ...withFigure.views, findings: withFigure.views.findings.map((f) => (f.figure === null ? f : { ...f, figure: { ...f.figure, licence: "MIT" } })) };
    const issues = runRules({ ...withFigure, views }, [rule("FIGURE_LICENCE")]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("does not name its licence MIT. Quote the sentence on the source page that names it, such as its name and version.");
    expect(runRules(input, [rule("FIGURE_LICENCE")])).toEqual([]);
  });
});

describe("FIGURE_LICENCE in published mode", () => {
  const withFigure = (id: string, over: Json = {}) => (s: Stored) => {
    storedFinding(s, id).figure = {
      source_id: "s1", image_url: FIGURE, licence: "CC-BY-4.0", licence_quote: QUOTE_BY, credit: "Figure 2 from a made-up paper",
      alt: l("A made-up figure of a folded protein."), ...over,
    };
  };

  it("passes a stored figure on a figure host whose quote names its licence", () => {
    expect(publishedOf("FIGURE_LICENCE", withFigure("bio-2026-0001"))).toEqual([]);
  });

  it("judges the host of a figure that is being published, at the file, and not that of any other record", () => {
    const edit = (s: Stored) => {
      withFigure("bio-2026-0001", { image_url: "https://example.org/a.png" })(s);
      withFigure("phys-2026-0003", { image_url: "https://example.org/a.png" })(s);
    };
    const issues = publishedOf("FIGURE_LICENCE", edit);
    expect(where(issues)).toEqual([`error ${BIO}: figure.image_url`]);
    expect(publishedOf("FIGURE_LICENCE", edit, { publishing: null })).toEqual([]);
  });

  it("judges the host of a figure on a returning finding as a stored record, which is not judged, and that of a finding first briefed on D whole (F-55)", () => {
    const bad = { image_url: "https://example.org/a.png" };
    const edit = (s: Stored): void => { storedFinding(s, "phys-2026-0003").updated = D; withFigure("phys-2026-0003", bad)(s); withFigure("math-2026-0002", bad)(s); };
    expect(where(publishedOf("FIGURE_LICENCE", edit))).toEqual([`error ${MATH}: figure.image_url`]);
  });

  it("reads the figure hosts of the config it is given", () => {
    const cfg = configWith((t) => { t.figure_hosts = ["arxiv.org"]; });
    expect(where(publishedOf("FIGURE_LICENCE", withFigure("bio-2026-0001"), { config: cfg }))).toEqual([`error ${BIO}: figure.image_url`]);
  });

  it("judges the quote of every stored figure, a figure that is not being published included, and keeps it an error", () => {
    const edit = (s: Stored) => {
      withFigure("bio-2026-0001", { licence_quote: "All rights reserved" })(s);
      withFigure("phys-2026-0003", { licence_quote: "All rights reserved", licence: "CC0-1.0" })(s);
    };
    for (const publishing of [D, null]) {
      const issues = publishedOf("FIGURE_LICENCE", edit, { publishing });
      expect(where(issues), String(publishing)).toEqual([`error ${BIO}: figure.licence_quote`, `error ${PHYS}: figure.licence_quote`]);
    }
  });

  it("tells both problems of a figure that is being published", () => {
    const issues = publishedOf("FIGURE_LICENCE", withFigure("math-2026-0002", { image_url: "http://arxiv.org/a.png", licence_quote: "None" }));
    expect(where(issues)).toEqual([`error ${MATH}: figure.image_url`, `error ${MATH}: figure.licence_quote`]);
  });

  it("skips an image_url or a licence_quote that a stored removed correction rewrote", () => {
    const edit = (s: Stored) => {
      withFigure("bio-2026-0001", { image_url: REMOVED_TEXT.en, licence_quote: REMOVED_TEXT.en })(s);
      s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "figure.image_url"));
      s.corrections.push(removal("C-0004", { finding_id: "bio-2026-0001" }, "figure.licence_quote"));
    };
    expect(publishedOf("FIGURE_LICENCE", edit)).toEqual([]);
    const url = publishedOf("FIGURE_LICENCE", (s) => { edit(s); s.corrections.pop(); });
    expect(where(url)).toEqual([`error ${BIO}: figure.licence_quote`]);
    const quote = publishedOf("FIGURE_LICENCE", (s) => { edit(s); s.corrections.splice(2, 1); });
    expect(where(quote)).toEqual([`error ${BIO}: figure.image_url`]);
  });

  it("answers with a HEAD of the image only at publish: no rule reads the network", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    publishedOf("FIGURE_LICENCE", withFigure("bio-2026-0001"));
    draftOf("FIGURE_LICENCE", figure());
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});

// ── A correction's source_url ────────────────────────────────────────────────────────────────────

/**
 * Sets the `source_url` of the draft's correction `index` and, unless `seen` is false, adds it to the evidence as a search result. The
 * weekday draft has three corrections and every `source_url` null, so each test names the one it changes.
 */
const citing = (url: string | null, options: { index?: number; seen?: boolean } = {}, edit: Edit = () => {}): Edit => (d, ev) => {
  d.corrections[options.index ?? 0].source_url = url;
  if (url !== null && options.seen !== false) see(ev, url);
  edit(d, ev);
};
const CORRECTION = "corrections[0].source_url";
const CORRECTION_LABEL = "corrections[0] (a correction's source)";

describe("a correction's source_url in draft mode: SOURCE_URL", () => {
  it("is no issue when it is null, for any correction", () => {
    expect(draftOf("SOURCE_URL", (d) => { for (const c of d.corrections) c.source_url = null; })).toEqual([]);
    expect(draftOf("SOURCE_URL", citing(null, { index: 2 }))).toEqual([]);
  });

  it.each([APS, ARXIV, EDU1, GITHUB_REPO, SMC, UNLISTED])("passes the https address %s", (url) => {
    expect(draftOf("SOURCE_URL", citing(url))).toEqual([]);
  });

  it.each([
    ["http://arxiv.org/abs/2611.00002", "uses http; cite the https address of the same page"],
    ["https://user:pw@arxiv.org/abs/2611.00002", "carries a user name or password before the host (user:password@); cite the plain https address of the page"],
    ["https://news.google.com/rss/articles/abc", "is a redirect link (news.google.com); open the original page and cite its own URL"],
    ["https://web.archive.org/web/2026/https://arxiv.org/abs/2611.00002", "is an archive copy (web.archive.org); cite the original page"],
    ["not a url", "is not a valid absolute https URL; copy the page's full address"],
  ])("fails %s at the correction's source_url, with the words it has for a source", (url, problem) => {
    const issues = draftOf("SOURCE_URL", citing(url));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "SOURCE_URL", severity: "error", path: CORRECTION, message: `corrections[0]'s source URL ${problem}. Found: ${url}` });
    // the same problem in a source's url has the same words, with the source's id for the place
    const source = draftOf("SOURCE_URL", (d) => { first(d, 1, { url }); });
    expect(source[0]!.message).toBe(`s2's URL ${problem}. Found: ${url}`);
  });

  it("names the correction by its place in the draft, at the path of its own index", () => {
    const issues = draftOf("SOURCE_URL", citing("http://arxiv.org/abs/2611.00002", { index: 2 }));
    expect(where(issues)).toEqual(["error corrections[2].source_url"]);
    expect(issues[0]!.message.startsWith("corrections[2]'s source URL uses http;")).toBe(true);
  });

  it("tells each correction that fails, and a source that fails, each at its own path", () => {
    const bad = "http://arxiv.org/abs/2611.00002";
    const issues = draftOf("SOURCE_URL", (d, ev) => { citing(bad)(d, ev); citing(bad, { index: 1 })(d, ev); first(d, 1, { url: bad }); });
    expect(paths(issues)).toEqual(["corrections[0].source_url", "corrections[1].source_url", "new_findings[0].sources[1].url"]);
  });

  it("lets two corrections cite one page, which no list of sources does", () => {
    expect(draftOf("SOURCE_URL", (d, ev) => { citing(APS)(d, ev); citing(APS, { index: 1 })(d, ev); })).toEqual([]);
  });

  it("lets a source and a correction cite one page, which no rule counts as a duplicate", () => {
    expect(draftOf("SOURCE_URL", citing(NATURE))).toEqual([]);
  });

  it("judges the address as written, as for a source: white space that a URL parser keeps before the scheme makes it no address", () => {
    for (const url of [`${NBSP}${ARXIV}`, `${IDEOGRAPHIC_SPACE}https://user:pw@arxiv.org/abs/2611.00002`, `${NBSP}https://news.google.com/rss/articles/abc`]) {
      expect(draftOf("SOURCE_URL", citing(url)).map((i) => i.message), JSON.stringify(url)).toEqual([
        `corrections[0]'s source URL is not a valid absolute https URL; copy the page's full address. Found: ${url}`,
      ]);
    }
    // white space that a parser strips leaves the page it names, so the address passes
    expect(draftOf("SOURCE_URL", citing(` ${ARXIV}  `))).toEqual([]);
    expect(draftOf("SOURCE_URL", citing(`${ARXIV}${NBSP}`))).toEqual([]);
  });

  it("leaves a shortener and every other BLOCKED_HOSTS entry but a redirect or an archive to BLOCKED_HOST", () => {
    for (const url of ["https://bit.ly/abc", "https://pastebin.com/abc", "https://sci-hub.se/10.1038/x", "https://t.me/abc", "https://shodan.io/search?query=x", "http://bit.ly/abc"]) {
      expect(draftOf("SOURCE_URL", citing(url)).map((i) => i.message.includes("uses http")), url).toEqual(url.startsWith("http://") ? [true] : []);
    }
  });
});

describe("a correction's source_url in draft mode: PRIMARY_ONLY", () => {
  const cite = (url: string | null, options: { index?: number; seen?: boolean } = {}, edit: Edit = () => {}) => draftOf("PRIMARY_ONLY", citing(url, options, edit));

  it("is no issue when it is null, for any correction", () => {
    expect(cite(null)).toEqual([]);
    expect(cite(null, { index: 2 })).toEqual([]);
  });

  it("passes an address that passes for some kind, which a correction does not name", () => {
    for (const url of [APS, ARXIV, EDU1, GITHUB_REPO, SMC, "https://clinicaltrials.gov/study/NCT09999001", "https://zenodo.org/records/99900002"]) {
      expect(cite(url), url).toEqual([]);
    }
    // a page of two kinds (a proof and a dataset) is no page for a paper, so as a source of that kind it fails
    expect(draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { kind: "paper", url: GITHUB_REPO }); see(ev, GITHUB_REPO); })).toHaveLength(1);
  });

  it("fails an address that no list names, at the correction's source_url, in the words a source gets", () => {
    const issues = cite(UNLISTED);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "PRIMARY_ONLY", severity: "error", path: CORRECTION });
    expect(issues[0]!.message).toBe(
      `${CORRECTION_LABEL}: No source list names this page. Cite the paper's page on its publisher, a preprint server, a registry, the lab's own site or the institution's own release.`);
    expect(issues[0]!.hint).toBe(
      "Cite a page that the allowlist in your context lists for the source's kind (a paper's page on its publisher, a preprint server, a registry, the lab's or institution's own site), never press.");
    const source = draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { kind: "paper", url: UNLISTED }); see(ev, UNLISTED); });
    expect(source[0]!.message).toBe(`s2 (kind "paper"): ${issues[0]!.message.slice(CORRECTION_LABEL.length + 2)}`);
  });

  it("names the correction by its place in the draft, at the path of its own index", () => {
    const issues = cite(UNLISTED, { index: 1 });
    expect(where(issues)).toEqual(["error corrections[1].source_url"]);
    expect(issues[0]!.message.startsWith("corrections[1] (a correction's source): ")).toBe(true);
  });

  it("fails a news site, a denied path, a denied DOI prefix and a port, whatever a source's kind would be", () => {
    expect(cite("https://www.quantamagazine.org/a-made-up-story-20261120/")[0]!.message).toContain("quantamagazine.org is a news, magazine, blog or aggregator site, never a source.");
    expect(cite("https://www.science.org/content/article/a-made-up-news-story")[0]!.message).toContain("Pages under /content/article/ on this site are news and features, not papers.");
    expect(cite("https://doi.org/10.1021/cen-v100n001.p1")[0]!.message).toContain("DOIs that start with 10.1021/cen- name a news publication's items, not papers.");
    expect(cite("https://journals.aps.org:8443/prl/abstract/10.1103/PhysRevLett.136.000002")[0]!.message).toContain("names a port other than the default one");
    expect(cite("https://journals.aps.org:443/prl/abstract/10.1103/PhysRevLett.136.000003")).toEqual([]);
  });

  it("lets a lab or a checker that names a press host win, as for a source", () => {
    const press = configWith((t) => { t.press_hosts.push("deepmind.google", "www.erdosproblems.com"); });
    const run = (url: string) => draftOf("PRIMARY_ONLY", citing(url), { config: press });
    expect(run("https://deepmind.google/discover/blog/a-made-up-post/")).toEqual([]);
    expect(run("https://www.erdosproblems.com/1")).toEqual([]);
    expect(run("https://www.quantamagazine.org/a-made-up-story/")).toHaveLength(1);
  });

  it("reads the allowlist from the config it is given", () => {
    const strict = configWith((t) => { t.publishers = t.publishers.filter((p: Json) => p.id !== "aps"); });
    expect(paths(draftOf("PRIMARY_ONLY", citing(APS), { config: strict }))).toEqual(["corrections[0].source_url", "new_findings[1].sources[0].url"]);
  });

  it("judges the address whether or not the run saw it, which is SOURCE_SEEN's test", () => {
    expect(cite(UNLISTED, { seen: false })).toHaveLength(1);
    expect(cite(APS, { seen: false })).toEqual([]);
  });

  it("leaves a URL that SOURCE_URL fails, or any BLOCKED_HOSTS entry matches, to those codes", () => {
    for (const url of [
      "http://www.nature.com/articles/s41586-026-00001-1", "https://user:pw@www.nature.com/articles/x", "www.nature.com/articles/x",
      "https://news.google.com/rss/articles/abc", "https://web.archive.org/web/2026/https://www.nature.com/x", "https://localhost/page",
      "https://pastebin.com/abc", "https://gist.github.com/example/abc", "https://bit.ly/abc", "https://sci-hub.se/10.1038/x", "https://t.me/abc",
      "https://shodan.io/search?query=x",
    ]) {
      expect(cite(url), url).toEqual([]);
    }
  });

  it("tells a source and a correction that cite one bad page, each at its own path", () => {
    const issues = draftOf("PRIMARY_ONLY", (d, ev) => { citing(UNLISTED)(d, ev); first(d, 1, { url: UNLISTED }); });
    expect(paths(issues)).toEqual(["corrections[0].source_url", "new_findings[0].sources[1].url"]);
  });

  describe("the type check", () => {
    const LETTER = "https://www.nature.com/articles/s41586-026-00005-5";
    const typed = (url: string, types?: string[], landing?: string, edit: Edit = () => {}) =>
      draftOf("PRIMARY_ONLY", (d, ev) => { d.corrections[0].source_url = url; see(ev, url, types, landing); edit(d, ev); });

    it("passes a typed publisher's page whose type fits, and fails one with no type or a type no kind it passes for takes", () => {
      expect(typed(LETTER, ["BriefCommunication"])).toEqual([]);
      const none = typed(LETTER);
      expect(where(none)).toEqual([`error ${CORRECTION}`]);
      expect(none[0]!.message).toBe(
        `${CORRECTION_LABEL}: The run found no article type on this page, so it cannot be told from a news item. Cite another primary record of the work, such as its preprint or its PubMed record, or leave it out.`);
      expect(none[0]!.hint).toContain("allowlist in your context");
      expect(typed(LETTER, ["News And Views"])[0]!.message).toContain('This page is typed "News And Views", which fits "reaction", not "paper".');
      expect(typed(LETTER, ["News"])[0]!.message).toContain("which is no primary kind");
    });

    it("judges an address by the URL test alone when its publisher has no type field", () => {
      expect(draftOf("PRIMARY_ONLY", (d, ev) => { ev.types = {}; first(d, 0, { url: APS }); citing(APS)(d, ev); })).toEqual([]);
    });

    it("passes a doi.org address only through a landing that passes, and says where a failing landing is", () => {
      const landing = "https://www.nature.com/articles/s41586-026-00003-3";
      expect(typed(DOI, undefined, landing, (_d, ev) => { see(ev, landing, ["OriginalPaper"]); })).toEqual([]);
      expect(typed(DOI)[0]!.message).toBe(
        `${CORRECTION_LABEL}: The run has not seen where this DOI lands, so the type of its page is unknown. Cite the paper's own page after opening it, or leave it out.`);
      const wrong = typed(DOI, undefined, landing, (_d, ev) => { see(ev, landing, ["News And Views"]); });
      expect(wrong[0]!.message).toContain("This DOI lands on a page that fails the type check.");
      expect(wrong[0]!.message.endsWith(` It lands on ${landing}.`)).toBe(true);
    });

    it("passes a PubMed or PMC record only when the evidence shows its types and none is a refused one", () => {
      expect(typed(PUBMED, ["Journal Article"])).toEqual([]);
      expect(typed(PMC, ["research-article"])).toEqual([]);
      expect(typed(PUBMED)[0]!.message).toContain("The run shows no publication type for this record");
      expect(typed(PUBMED, ["Journal Article", "News"])[0]!.message).toContain('This record is typed "News".');
    });

    it("reports the URL test's finding alone, so a correction is not told twice", () => {
      const issues = typed("https://www.quantamagazine.org/a-made-up-story/", ["News"]);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("never a source");
    });

    it("cuts the landing that the type check names", () => {
      const landing = `https://example.org/${"z".repeat(5_000)}`;
      const issues = typed(DOI, undefined, landing);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message.endsWith(` It lands on ${landing.slice(0, 117)}....`)).toBe(true);
    });

    /** A publisher whose path takes a paper and a notice, with a type for each and one for a reaction, which that path does not take. */
    const twoKinds = configWith((t) => {
      t.publishers.push({
        id: "example-two", name: "Example Two", hosts: ["two.example.org"], kinds: ["paper", "notice"], paths: ["/articles/"], deny_paths: [], reaction_paths: ["/comment/"],
        type_field: "citation_article_type", types: { paper: ["Article"], notice: ["Retraction"], reaction: ["Commentary"] },
      });
    });
    const TWO = "https://two.example.org/articles/1";
    /** The page's issues when a correction (kind null) or a source of `kind` cites it and the run saw it typed `types`. */
    const two = (kind: "paper" | "notice" | null, types: string[]) => draftOf("PRIMARY_ONLY", (d, ev) => {
      if (kind === null) d.corrections[0].source_url = TWO; else first(d, 1, { kind, url: TWO });
      see(ev, TWO, types);
    }, { config: twoKinds });

    it("passes a page whose type fits any kind the URL test admits it for, where a source must fit its own kind", () => {
      expect(two(null, ["Article"])).toEqual([]);
      expect(two(null, ["Retraction"])).toEqual([]);
      expect(two("paper", ["Article"])).toEqual([]);
      expect(two("paper", ["Retraction"])).toHaveLength(1);
      expect(two("notice", ["Retraction"])).toEqual([]);
      expect(two("notice", ["Article"])).toHaveLength(1);
    });

    it("fails a page whose type fits none of those kinds, once, in the words of the first kind", () => {
      const issues = two(null, ["Commentary"]);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toBe(`${CORRECTION_LABEL}: This page is typed "Commentary", which fits "reaction", not "paper". Give the source that kind, or cite a page of the right type.`);
      expect(two("notice", ["Commentary"])[0]!.message).toContain('which fits "reaction", not "notice".');
      expect(two(null, ["Feature"])[0]!.message).toContain('typed "Feature", which is no primary kind');
      expect(two(null, [])[0]!.message).toContain("found no article type");
    });
  });

  it("runs without the evidence: the URL test still judges, and the engine says the check ran without it", () => {
    const NO_TYPE = "https://www.nature.com/articles/s41586-026-00006-6"; // a typed publisher's page, whose type only the evidence shows
    const edit: Edit = (d) => { d.corrections[0].source_url = NO_TYPE; d.corrections[1].source_url = UNLISTED; };
    const draft = draftJson();
    edit(draft, {});
    const input = buildDraftInput(DraftBrief.parse(draft), { ...draftInputs(), evidence: null });
    const issues = runRules(input, [rule("PRIMARY_ONLY")]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["INPUT_MISSING", "warning", "(evidence)"],
      ["PRIMARY_ONLY", "error", "corrections[1].source_url"],
    ]);
    // with the evidence the typed publisher's page fails its type check as well
    expect(paths(draftOf("PRIMARY_ONLY", edit))).toEqual(["corrections[0].source_url", "corrections[1].source_url"]);
  });
});

describe("a correction's source_url in draft mode: SOURCE_SEEN", () => {
  const unseen = (url: string | null, options: { index?: number; seen?: boolean } = {}, edit: Edit = () => {}) => draftOf("SOURCE_SEEN", citing(url, options, edit));
  const NEW = "https://arxiv.org/abs/2611.00099";

  it("is no issue when it is null, for any correction, even when the evidence lists no URL", () => {
    expect(unseen(null)).toEqual([]);
    expect(unseen(null, { index: 2 })).toEqual([]);
    const noUrls = draftOf("SOURCE_SEEN", (d, ev) => { for (const c of d.corrections) c.source_url = null; ev.urls = []; });
    expect(paths(noUrls)).not.toContain("corrections[0].source_url");
  });

  it("passes an address in the evidence, however the run saw it", () => {
    for (const seen_as of ["pack", "fetched", "search"]) {
      expect(unseen(NEW, {}, (_d, ev) => { ev.seen_as[key(NEW)] = seen_as; if (seen_as === "fetched") ev.fetched.push(NEW); }), seen_as).toEqual([]);
    }
  });

  it("fails an address the run did not see, at the correction's source_url, with the address found and what to do", () => {
    const issues = unseen(NEW, { seen: false });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "SOURCE_SEEN", severity: "error", path: CORRECTION });
    expect(issues[0]!.message).toBe(
      `corrections[0]'s source URL ${NEW} is not in the source pack, a page you fetched or a search result you saw. Cite only URLs you actually saw, or set source_url to null.`);
    expect(issues[0]!.hint).toBe("Copy the URL exactly as the pack, the fetch or the search result gave it, or open the page first.");
  });

  it("names the correction by its place in the draft, at the path of its own index", () => {
    const issues = unseen(NEW, { index: 2, seen: false });
    expect(where(issues)).toEqual(["error corrections[2].source_url"]);
    expect(issues[0]!.message.startsWith("corrections[2]'s source URL ")).toBe(true);
  });

  it("compares addresses as normalizeUrl() does, and reads the evidence's list of addresses only", () => {
    expect(unseen(`${NATURE}/?utm_source=x#abstract`, { seen: false })).toEqual([]);
    expect(unseen(`${NATURE}?page=2`, { seen: false })).toHaveLength(1);
    expect(unseen(NEW, { seen: false }, (_d, ev) => { ev.texts[key(NEW)] = "Page text."; })).toHaveLength(1);
  });

  it("judges an address whatever the allowlist says of it", () => {
    expect(unseen(UNLISTED)).toEqual([]);
    expect(unseen(UNLISTED, { seen: false })).toHaveLength(1);
  });

  it("tells a source and a correction that cite one address the run did not see, each at its own path", () => {
    const issues = draftOf("SOURCE_SEEN", (d, ev) => { citing(NEW, { seen: false })(d, ev); first(d, 1, { url: NEW }); d.sources[1].url = NEW; });
    expect(paths(issues)).toEqual(["corrections[0].source_url", "new_findings[0].sources[1].url", "sources[1].url"]);
  });

  it("leaves a URL that SOURCE_URL fails, or any BLOCKED_HOSTS entry matches, to those codes", () => {
    for (const url of [
      "http://www.nature.com/articles/s41586-026-00099-9", "https://user:pw@www.nature.com/articles/x", "https://news.google.com/rss/articles/zzz",
      "https://web.archive.org/web/2026/https://www.nature.com/zzz", "https://pastebin.com/zzz", "https://bit.ly/zzz", "https://sci-hub.se/zzz", "not a url",
    ]) {
      expect(unseen(url, { seen: false }), url).toEqual([]);
    }
  });

  it("is skipped with one warning when the run has no evidence, and no address is judged", () => {
    const d = draftJson();
    d.corrections[0].source_url = NEW;
    const input = buildDraftInput(DraftBrief.parse(d), { ...draftInputs(), evidence: null });
    const issues = runRules(input, [rule("SOURCE_SEEN")]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([["INPUT_MISSING", "warning", "(evidence)"]]);
  });

  it("cuts the address that it says the run did not see", () => {
    const url = `https://journals.aps.org/prl/abstract/${"y".repeat(5_000)}`;
    expect(unseen(url, { seen: false }).map((i) => i.message)).toEqual([
      `corrections[0]'s source URL ${url.slice(0, 117)}... is not in the source pack, a page you fetched or a search result you saw. Cite only URLs you actually saw, or set source_url to null.`,
    ]);
  });
});

describe("a correction's source_url in published mode", () => {
  // The stored Tuesday's corrections: C-0001 (dated 2026-11-10, an archived record) and C-0002 (dated D, which publishing D publishes)
  const OLD = "corrections.json: corrections[0].source_url";
  const NEW_ONE = "corrections.json: corrections[1].source_url";
  const cite = (index: number, url: string | null) => (s: Stored): void => { s.corrections[index]!.source_url = url; };
  const both = (url: string | null) => (s: Stored): void => { cite(0, url)(s); cite(1, url)(s); };
  const HTTP = "http://arxiv.org/abs/2611.00002";

  it("is no issue when it is null, or an https address on the allowlist", () => {
    for (const code of ["PRIMARY_ONLY", "SOURCE_URL"]) {
      expect(publishedOf(code, both(null)), code).toEqual([]);
      expect(publishedOf(code, both(APS)), code).toEqual([]);
    }
    expect(publishedOf("PRIMARY_ONLY", both(UNLISTED), { publishing: null })).toEqual([]);
  });

  it("fails SOURCE_URL as an error on a correction being published, and as a warning on one that is not, with the same words", () => {
    const issues = publishedOf("SOURCE_URL", both(HTTP));
    expect(where(issues)).toEqual([`warning ${OLD}`, `error ${NEW_ONE}`]);
    expect(issues.map((i) => i.message)).toEqual([
      `C-0001's source URL uses http; cite the https address of the same page. Found: ${HTTP}`,
      `C-0002's source URL uses http; cite the https address of the same page. Found: ${HTTP}`,
    ]);
    expect(issues[0]!.hint).toContain("already published");
    expect(where(publishedOf("SOURCE_URL", both(HTTP), { publishing: null }))).toEqual([`warning ${OLD}`, `warning ${NEW_ONE}`]);
  });

  it.each([
    ["a redirect link", "https://news.google.com/rss/articles/abc", "is a redirect link (news.google.com)"],
    ["an archive copy", "https://web.archive.org/web/2026/https://arxiv.org/abs/2611.00002", "is an archive copy (web.archive.org)"],
    ["an address with user info", "https://user:pw@arxiv.org/abs/2611.00002", "carries a user name or password"],
  ])("fails SOURCE_URL for %s in a stored correction", (_what, url, words) => {
    const issues = publishedOf("SOURCE_URL", cite(1, url));
    expect(where(issues)).toEqual([`error ${NEW_ONE}`]);
    expect(issues[0]!.message).toContain(`C-0002's source URL ${words}`);
  });

  it("judges a stored correction that no brief names, and one that is a `removed` correction", () => {
    expect(where(publishedOf("SOURCE_URL", cite(1, HTTP), { brief: false }))).toEqual([`error ${NEW_ONE}`]);
    const removed = (s: Stored): void => { s.corrections[1]!.type = "removed"; s.corrections[1]!.path = "explainer.found"; s.corrections[1]!.source_url = HTTP; };
    expect(where(publishedOf("SOURCE_URL", removed))).toEqual([`error ${NEW_ONE}`]);
  });

  it("fails PRIMARY_ONLY on a correction being published, and judges none that is not, since the URL test reads config/", () => {
    const issues = publishedOf("PRIMARY_ONLY", both(UNLISTED));
    expect(where(issues)).toEqual([`error ${NEW_ONE}`]);
    expect(issues[0]!.message).toBe(`C-0002 (a correction's source): No source list names this page. Cite the paper's page on its publisher, a preprint server, a registry, the lab's own site or the institution's own release.`);
    expect(publishedOf("PRIMARY_ONLY", cite(0, UNLISTED))).toEqual([]);
    expect(where(publishedOf("PRIMARY_ONLY", cite(1, "https://www.quantamagazine.org/a-made-up-story/")))).toEqual([`error ${NEW_ONE}`]);
  });

  it("reads the allowlist of the config it is given", () => {
    const strict = configWith((t) => { t.publishers = t.publishers.filter((p: Json) => p.id !== "aps"); });
    expect(where(publishedOf("PRIMARY_ONLY", cite(1, APS), { config: strict }))).toEqual([`error ${NEW_ONE}`]);
  });

  it("leaves a URL that SOURCE_URL fails or a BLOCKED_HOSTS entry matches to those codes, and judges the type check in draft mode only", () => {
    for (const url of [HTTP, "https://news.google.com/rss/articles/abc", "https://bit.ly/abc", "https://pastebin.com/abc"]) {
      expect(publishedOf("PRIMARY_ONLY", cite(1, url)), url).toEqual([]);
    }
    // a typed publisher's page, whose type only a draft's evidence shows, passes the URL test alone
    expect(publishedOf("PRIMARY_ONLY", cite(1, "https://www.nature.com/articles/s41586-026-00006-6"))).toEqual([]);
  });

  it("does not run SOURCE_SEEN, which is a draft's test", () => {
    expect(publishedOf("SOURCE_SEEN", cite(1, "https://example.org/never-seen"))).toEqual([]);
  });
});

describe("a correction's source_url: purity and bounds", () => {
  /** A draft whose two corrections cite `url` (the second with a query), which the run saw; a null `url` leaves both null. */
  const draftInput = (url: string | null) => {
    const d = draftJson();
    const ev = evidenceJson();
    citing(url)(d, ev);
    citing(url === null ? null : `${url}?b=2`, { index: 1 })(d, ev);
    return buildDraftInput(DraftBrief.parse(d), { ...draftInputs(), evidence: Evidence.parse(ev) });
  };
  /** The stored Tuesday whose corrections all cite `url`: C-0002 is being published when D is, C-0001 is not. */
  const publishedInput = (url: string | null, publishing: string | null) => {
    const w = storedWorld();
    const corrections = w.corrections.map((c) => Correction.parse({ ...structuredClone(c), source_url: url }));
    return buildPublishedInput(w.brief, { findings: w.findings, terms: w.terms, corrections, reports: w.reports }, { config: w.config, publishing });
  };
  const URLS = ["https://news.google.com/rss/articles/abc", "http://arxiv.org/abs/2611.00002", UNLISTED, "https://bit.ly/abc", "https://pastebin.com/abc", ARXIV, null];
  const group = [...sourcesRules, ...safetyRules];

  it("changes nothing it reads: a deeply frozen draft or stored input gives the same issues as a plain one, and no rule throws", () => {
    for (const url of URLS) {
      const plain = runRules(draftInput(url), group);
      expect(runRules(deepFreeze(draftInput(url)), group), `draft ${url}`).toEqual(plain);
      expect(plain.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
      for (const publishing of [D, null]) {
        const stored = runRules(publishedInput(url, publishing), group);
        expect(runRules(deepFreeze(publishedInput(url, publishing)), group), `published ${url} ${publishing}`).toEqual(stored);
        expect(stored.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
      }
    }
    // the faults above are found, so that the runs compare something
    expect(runRules(draftInput("http://arxiv.org/abs/2611.00002"), group).map((i) => i.code)).toContain("SOURCE_URL");
    expect(runRules(publishedInput(UNLISTED, D), group).map((i) => i.code)).toContain("PRIMARY_ONLY");
  });

  it("judges a stored correction with no brief and with none of its records being published", () => {
    const w = storedWorld();
    const corrections = w.corrections.map((c) => Correction.parse({ ...structuredClone(c), source_url: "http://arxiv.org/abs/2611.00002" }));
    const input = buildPublishedInput(null, { findings: [], terms: [], corrections, reports: [] }, { config: w.config, publishing: null, date: D });
    expect(where(runRules(input, group))).toEqual(["warning corrections.json: corrections[0].source_url", "warning corrections.json: corrections[1].source_url"]);
  });

  it("stays fast on an address of 100,000 characters, and prints no more than 120 of them in a message", () => {
    const run = (url: string, input: () => RuleInput): ValidationIssue[] => {
      const started = performance.now();
      const issues = runRules(input(), group);
      expect(performance.now() - started, url.slice(0, 40)).toBeLessThan(1_500);
      return issues;
    };
    const long = 100_000;
    const shapes = [
      `ftp://example.org/${"x".repeat(long)}`, `https://pastebin.com/${"x".repeat(long)}`, `https://news.google.com/${"x".repeat(long)}`,
      `https://${"a.".repeat(long / 2)}com/x`, `https://${"u:".repeat(long / 2)}@arxiv.org/abs/1`, `https://example.org/${String.fromCodePoint(0x1f600).repeat(long / 2)}`,
      `https://example.org/paper/${"%41".repeat(long / 3)}`, "https://".repeat(long / 8),
    ];
    for (const url of shapes) {
      const drafted = run(url, () => draftInput(url));
      const stored = run(url, () => publishedInput(url, D));
      for (const issue of [...drafted, ...stored]) {
        expect(issue.code, url.slice(0, 40)).not.toBe("RULE_ERROR");
        expect(issue.message.length, `${issue.code} ${url.slice(0, 40)}`).toBeLessThan(900);
      }
    }
  });

  it("writes no em dash and no en dash in a message or a hint about a correction's source_url", () => {
    const text = [
      ...[
        "http://arxiv.org/abs/2611.00002", "https://news.google.com/rss/articles/abc", "https://bit.ly/abc", UNLISTED, "https://www.quantamagazine.org/a-story/",
        "https://arxiv.org/abs/2611.00099",
      ].flatMap((url) => runRules(buildDraftInput(DraftBrief.parse(((d: Json) => { d.corrections[0].source_url = url; return d; })(draftJson())), { ...draftInputs(), evidence: Evidence.parse(evidenceJson()) }), group)),
      ...runRules(publishedInput(UNLISTED, D), group), ...runRules(publishedInput("http://arxiv.org/abs/2611.00002", null), group),
    ].filter((i) => /corrections.*source_url/.test(i.path)).map((i) => `${i.message} ${i.hint ?? ""}`).join(" ");
    expect(text.length).toBeGreaterThan(600);
    expect(text).not.toContain(EM);
    expect(text).not.toContain(EN);
  });
});

// ── The rules together ───────────────────────────────────────────────────────────────────────────

describe("one code for each problem", () => {
  const codesOf = (issues: readonly ValidationIssue[]): string[] => [...new Set(issues.map((i) => i.code))].sort();
  const withUrl = (url: string) => draftIssues((d, ev) => { first(d, 1, { url }); see(ev, url); });

  it.each([
    ["http://arxiv.org/abs/2611.00002", ["SOURCE_URL"]],
    ["https://user:pw@arxiv.org/abs/2611.00002", ["SOURCE_URL"]],
    ["https://news.google.com/rss/articles/abc", ["SOURCE_URL"]],
    ["https://web.archive.org/web/2026/https://arxiv.org/abs/2611.00002", ["SOURCE_URL"]],
    ["https://pastebin.com/abc", []],
    ["https://bit.ly/abc", []],
    ["https://example.org/paper/9", ["PRIMARY_ONLY"]],
    ["https://www.quantamagazine.org/a-story/", ["PRIMARY_ONLY"]],
  ])("tells %s once, as %j", (url, codes) => {
    expect(codesOf(withUrl(url))).toEqual(codes);
  });

  describe("a correction's source_url, told by the sources group and BLOCKED_HOST together", () => {
    /** The sources group and the safety group on the Tuesday draft whose first correction cites `url`, which the run saw unless `seen` is false. */
    const both = (url: string, seen = true): ValidationIssue[] => {
      const d = draftJson();
      const ev = evidenceJson();
      citing(url, { seen })(d, ev);
      return threwNothing(runRules(buildDraftInput(DraftBrief.parse(d), { ...draftInputs(), evidence: Evidence.parse(ev) }), [...sourcesRules, ...safetyRules]));
    };

    it.each([
      ["http://arxiv.org/abs/2611.00002", ["SOURCE_URL"]],
      ["https://user:pw@arxiv.org/abs/2611.00002", ["SOURCE_URL"]],
      ["https://news.google.com/rss/articles/abc", ["SOURCE_URL"]],
      ["https://web.archive.org/web/2026/https://arxiv.org/abs/2611.00002", ["SOURCE_URL"]],
      ["https://pastebin.com/abc", ["BLOCKED_HOST"]],
      ["https://bit.ly/abc", ["BLOCKED_HOST"]],
      ["https://sci-hub.se/10.1038/x", ["BLOCKED_HOST"]],
      ["https://example.org/paper/9", ["PRIMARY_ONLY"]],
      ["https://www.quantamagazine.org/a-story/", ["PRIMARY_ONLY"]],
      ["https://arxiv.org/abs/2611.00002", []],
    ])("tells %s once, as %j", (url, codes) => {
      expect(codesOf(both(url))).toEqual(codes);
    });

    // The host is read as a URL parser reads it, so that a spelling of a blocked host that names the same host is told as the plain one is
    const wide = (text: string): string => [...text].map((c) => (c === "." ? String.fromCharCode(0xff0e) : String.fromCharCode(c.charCodeAt(0) + 0xfee0))).join("");
    const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

    it.each([
      ["a redirect host in upper case", "HTTPS://NEWS.GOOGLE.COM/rss/articles/abc", ["SOURCE_URL"]],
      ["a redirect host with a trailing dot", "https://news.google.com./rss/articles/abc", ["SOURCE_URL"]],
      ["a redirect host in full-width letters", `https://${wide("news.google.com")}/rss/articles/abc`, ["SOURCE_URL"]],
      ["a redirect host with a zero-width space", `https://news${ZERO_WIDTH_SPACE}.google.com/rss/articles/abc`, ["SOURCE_URL"]],
      ["a redirect host written without a scheme", "news.google.com/rss/articles/abc", ["SOURCE_URL"]],
      ["an archive host in upper case", "https://WEB.ARCHIVE.ORG/web/2026/https://arxiv.org/abs/2611.00002", ["SOURCE_URL"]],
      ["a shortener in upper case", "HTTPS://BIT.LY/ABC", ["BLOCKED_HOST"]],
      ["a shortener with a trailing dot", "https://bit.ly./abc", ["BLOCKED_HOST"]],
      ["a shortener in full-width letters", `https://${wide("bit.ly")}/abc`, ["BLOCKED_HOST"]],
      ["a shortener written without a scheme, which is two problems", "bit.ly/abc", ["BLOCKED_HOST", "SOURCE_URL"]],
    ])("tells %s once for each problem, as for a source", (_what, url, expected) => {
      expect(codesOf(both(url)), url).toEqual(expected);
      const asSource = codesOf(draftIssues((d, ev) => { first(d, 1, { url }); see(ev, url); }, {}, [...sourcesRules, ...safetyRules]));
      expect(asSource, `${url} as a source's url`).toEqual(expected);
    });

    it("tells an address that no list names and the run did not see by both codes, each for its own problem", () => {
      expect(both("https://example.org/paper/9", false).map((i) => [i.code, i.path])).toEqual([["PRIMARY_ONLY", CORRECTION], ["SOURCE_SEEN", CORRECTION]]);
    });

    it("tells a redirect or an archive address as SOURCE_URL's and a shortener as BLOCKED_HOST's, at the correction's source_url", () => {
      for (const [url, code] of [["https://news.google.com/rss/articles/abc", "SOURCE_URL"], ["https://archive.ph/abc", "SOURCE_URL"], ["https://t.co/abc", "BLOCKED_HOST"]] as const) {
        expect(both(url).map((i) => [i.code, i.path]), url).toEqual([[code, CORRECTION]]);
      }
    });
  });

  it("tells an address that no list names and the run did not see by both codes, each for its own problem", () => {
    const issues = draftIssues((d) => { first(d, 1, { url: "https://example.org/paper/9" }); });
    expect(issues.map((i) => [i.code, i.path])).toEqual([["PRIMARY_ONLY", "new_findings[0].sources[1].url"], ["SOURCE_SEEN", "new_findings[0].sources[1].url"]]);
  });
});

// ── A message that quotes a long value ───────────────────────────────────────────────────────────

describe("a message that quotes a long value", () => {
  /** The first 117 characters, to which a cut value adds "...": no message prints more than 120 characters of one address or quote. */
  const CUT = 117;
  const APS_PAGE = "https://journals.aps.org/prl/abstract/";
  const hostList = (): string => [...config().index.figureHosts].join(", ");
  /** An address of exactly `n` characters that SOURCE_URL fails, whatever else the rules say of it. */
  const ftp = (n: number): string => `ftp://example.org/${"x".repeat(n - "ftp://example.org/".length)}`;
  const failed = (url: string): string[] => draftOf("SOURCE_URL", (d) => { first(d, 1, { url }); }).map((i) => i.message);

  it("cuts an address that SOURCE_URL fails after its first 117 characters, and keeps the rest of the message", () => {
    const url = `${ftp(120)}${"x".repeat(4_880)}`;
    expect(url).toHaveLength(5_000);
    expect(failed(url)).toEqual([`s2's URL is not a valid absolute https URL; copy the page's full address. Found: ${url.slice(0, CUT)}...`]);
  });

  it("prints an address of 120 characters whole and cuts one of 121", () => {
    expect(failed(ftp(120))).toEqual([`s2's URL is not a valid absolute https URL; copy the page's full address. Found: ${ftp(120)}`]);
    expect(failed(ftp(121))).toEqual([`s2's URL is not a valid absolute https URL; copy the page's full address. Found: ${ftp(121).slice(0, CUT)}...`]);
  });

  it("cuts at whole characters: no half of a surrogate pair ends a message", () => {
    const smile = String.fromCodePoint(0x1f600);
    const [message] = failed(`ftp://example.org/${smile.repeat(140)}`);
    expect(message).toBe(`s2's URL is not a valid absolute https URL; copy the page's full address. Found: ftp://example.org/${smile.repeat(99)}...`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(message!)).toBe(false);
  });

  it("cuts a correction's address that SOURCE_URL fails, keeping the rest of the message", () => {
    const url = `${ftp(120)}${"x".repeat(4_880)}`;
    expect(draftOf("SOURCE_URL", citing(url)).map((i) => i.message)).toEqual([
      `corrections[0]'s source URL is not a valid absolute https URL; copy the page's full address. Found: ${url.slice(0, CUT)}...`,
    ]);
    expect(draftOf("SOURCE_URL", citing(ftp(120))).map((i) => i.message)).toEqual([
      `corrections[0]'s source URL is not a valid absolute https URL; copy the page's full address. Found: ${ftp(120)}`,
    ]);
  });

  it("cuts the address that SOURCE_URL names in a duplicate", () => {
    const url = `${APS_PAGE}${"y".repeat(5_000)}`;
    const issues = draftOf("SOURCE_URL", (d) => { first(d, 0, { url }); first(d, 1, { url }); });
    expect(issues.map((i) => i.message)).toEqual([
      `s2 has the same URL as s1 (${key(url).slice(0, CUT)}...). Cite s1 wherever s2 is cited, remove s2 and renumber the later ids.`,
    ]);
  });

  it("cuts the address that SOURCE_SEEN says the run did not see", () => {
    const url = `${APS_PAGE}${"y".repeat(5_000)}`;
    const issues = draftOf("SOURCE_SEEN", (d) => { first(d, 1, { url }); });
    expect(issues.map((i) => i.message)).toEqual([
      `s2's URL ${url.slice(0, CUT)}... is not in the source pack, a page you fetched or a search result you saw. Cite only URLs you actually saw, or remove s2.`,
    ]);
  });

  it("cuts the landing that PRIMARY_ONLY's type check names", () => {
    const landing = `https://example.org/${"z".repeat(5_000)}`;
    const issues = draftOf("PRIMARY_ONLY", (d, ev) => { first(d, 1, { kind: "paper", url: DOI }); see(ev, DOI, undefined, landing); });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message.endsWith(` It lands on ${landing.slice(0, CUT)}....`)).toBe(true);
    expect(issues[0]!.message.length).toBeLessThan(600);
  });

  it("cuts a figure's address, its host and its licence quote", () => {
    const image = `https://example.org/${"p".repeat(5_000)}.png`;
    const [byAddress] = draftOf("FIGURE_LICENCE", figure({ image_url: image }));
    expect(byAddress!.message).toBe(`The figure's image URL is on example.org, which is not a figure host (${hostList()}). Found: ${image.slice(0, CUT)}...`);

    const host = `${"h".repeat(300)}.example.org`;
    const address = `https://${host}/a.png`;
    const [byHost] = draftOf("FIGURE_LICENCE", figure({ image_url: address }));
    expect(byHost!.message).toBe(
      `The figure's image URL is on ${host.slice(0, CUT)}..., which is not a figure host (${hostList()}). Found: ${address.slice(0, CUT)}...`);

    const [byQuote] = draftOf("FIGURE_LICENCE", figure({ licence_quote: "w".repeat(5_000) }));
    expect(byQuote!.message.endsWith(` Found: "${"w".repeat(CUT)}..."`)).toBe(true);
    for (const issue of [byAddress, byHost, byQuote]) expect(issue!.message.length).toBeLessThan(700);
  });

  it("prints a figure's data address in part, whatever its length", () => {
    const data = `data:image/png;base64,${"A".repeat(5_000)}`;
    const [issue] = draftOf("FIGURE_LICENCE", figure({ image_url: data }));
    expect(issue!.message).toBe(`The figure's image URL is not an https address. Found: ${data.slice(0, CUT)}...`);
  });
});

// ── The fixtures of the group ────────────────────────────────────────────────────────────────────

describe("the fixtures of the sources group", () => {
  const MINE = codesOfGroup("sources");
  /** The issue paths an F case may fail at, one pattern for each code. */
  const WHERE: Record<string, RegExp> = {
    PRIMARY_ONLY: /^new_findings\[\d+\]\.sources\[\d+\]\.url$/,
    SOURCE_SEEN: /^new_findings\[\d+\]\.sources\[\d+\]\.url$/,
    SOURCE_URL: /^new_findings\[\d+\]\.sources\[\d+\]\.url$/,
    GO_DEEPER: /^new_findings\[\d+\]\.go_deeper\[\d+\]$/,
    FIGURE_LICENCE: /^new_findings\[\d+\]\.figure\.image_url$/,
  };

  /** A case's draft: a fresh copy of its edition's valid draft, mutated. */
  const mutated = (c: { edition?: EditionName; mutate: (draft: ReturnType<typeof editionDraft>) => unknown }): unknown => {
    const draft = editionDraft(c.edition ?? "weekday");
    const out = c.mutate(draft);
    return out === undefined ? draft : out;
  };
  /** The group's own rules on a draft with its edition's inputs, and the whole validator on it. */
  const own = (draft: unknown, edition: EditionName): ValidationIssue[] =>
    threwNothing(runRules(buildDraftInput(DraftBrief.parse(draft), sampleInputs(edition)), sourcesRules));
  const whole = (draft: unknown, edition: EditionName): ValidationIssue[] => validateDraft(draft, sampleInputs(edition)).issues;
  const tell = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.code}`);
  const codesOf = (issues: readonly ValidationIssue[], severity: string): string[] =>
    [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();

  /** The paths at which two JSON values differ, as `a.b[0].c`; an array's missing element counts as a difference. */
  function changedPaths(a: unknown, b: unknown, path = ""): string[] {
    if (Array.isArray(a) && Array.isArray(b)) {
      return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => changedPaths(a[i], b[i], `${path}[${i}]`)).flat();
    }
    if (typeof a === "object" && a !== null && typeof b === "object" && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].flatMap((k) => changedPaths((a as Json)[k], (b as Json)[k], path === "" ? k : `${path}.${k}`));
    }
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
  }

  /** Every string under a `url`, `image_url` or `source_url` key of a draft. */
  function addressesIn(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(addressesIn);
    if (typeof value !== "object" || value === null) return [];
    return Object.entries(value).flatMap(([k, v]) => (["url", "image_url", "source_url"].includes(k) && typeof v === "string" ? [v] : addressesIn(v)));
  }

  it("has one F case for each code of the group, in the table's order, each filed as invalid--CODE.json", () => {
    expect(sourcesCases.map((c) => c.code)).toEqual(MINE);
    for (const c of sourcesCases) expect(c.file, c.code).toBe(`invalid--${c.code}.json`);
    expect(new Set(sourcesCases.map((c) => c.file)).size).toBe(sourcesCases.length);
  });

  it("has no S case, because every code of the group is hard and the table lists only an F fixture for it", () => {
    expect(sourcesSoft).toEqual([]);
    for (const code of MINE) {
      const info = RULE_CODE_TABLE.find((r) => r.code === code)!;
      expect(info.severity, code).toBe("H");
      expect(info.tests, code).toEqual(["F"]);
    }
  });

  it.each(sourcesCases.map((c) => [c.code, c] as const))("F %s: fails validateDraft() with exactly its code, at a source or figure, by a small change", (code, c) => {
    const edition = c.edition ?? "weekday";
    const draft = invalidDraft(c);
    const issues = whole(draft, edition);
    expect(tell(issues)).toEqual([`error ${code}`]);
    expect(issues[0]!.path).toMatch(WHERE[code]!);
    expect(tell(own(draft, edition))).toEqual([`error ${code}`]);
    expect(changedPaths(editionDraft(edition), draft).length).toBeLessThanOrEqual(3);
  });

  it.each(sourcesCases.map((c) => [c.code, c] as const))("F %s: its file in fixtures/drafts/ is the builder's output and fails the same way", (code, c) => {
    const { path, text } = invalidOutputs([c])[0]!;
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    expect(tell(whole(JSON.parse(text), c.edition ?? "weekday"))).toEqual([`error ${code}`]);
  });

  it("has named cases with unique names, each starting with the code it is about, which one of its results holds", () => {
    expect(new Set(sourcesNamed.map((c) => c.name)).size).toBe(sourcesNamed.length);
    for (const c of sourcesNamed) {
      expect(c.name.startsWith(`${c.code}: `), c.name).toBe(true);
      expect([...c.expect.errors, ...c.expect.warnings], c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toEqual([...c.expect.errors].sort());
      expect([...c.expect.warnings], c.name).toEqual([...c.expect.warnings].sort());
      expect(EDITION_NAMES, c.name).toContain(c.edition);
    }
  });

  it("covers each code of the group, a brief's own sources in the Sunday and the Monday, and the two skips BLOCKED_HOST asks for", () => {
    for (const code of MINE) expect(sourcesNamed.some((c) => c.code === code), code).toBe(true);
    for (const edition of ["weekday", "sunday", "monday"]) expect(sourcesNamed.some((c) => c.edition === edition), edition).toBe(true);
    expect(sourcesNamed.filter((c) => c.code === "BLOCKED_HOST").map((c) => c.expect.errors)).toEqual([["BLOCKED_HOST"], ["BLOCKED_HOST"]]);
  });

  it.each(sourcesNamed.map((c) => [c.name, c] as const))("T %s", (_name, c) => {
    const draft = mutated(c);
    const issues = whole(draft, c.edition);
    expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }).toEqual({ errors: [...c.expect.errors], warnings: [...c.expect.warnings] });
    // The group's own rules say the part that is theirs: the codes of the group among the expected errors, and nothing else
    const mine = own(draft, c.edition);
    expect(codesOf(mine, "error")).toEqual(c.expect.errors.filter((code) => MINE.includes(code)));
    expect(codesOf(mine, "warning")).toEqual([]);
  });

  it("has a case for each of PRIMARY_ONLY, SOURCE_SEEN and SOURCE_URL on a correction's source_url, which changes that string alone and is told at its path", () => {
    const cases = sourcesNamed.filter((c) => c.name.includes("a correction's source_url"));
    expect([...new Set(cases.map((c) => c.code))].sort()).toEqual(["PRIMARY_ONLY", "SOURCE_SEEN", "SOURCE_URL"]);
    for (const c of cases) {
      const draft = mutated(c);
      expect(changedPaths(editionDraft(c.edition), draft), c.name).toHaveLength(1);
      expect(changedPaths(editionDraft(c.edition), draft)[0], c.name).toMatch(/^corrections\[\d+\]\.source_url$/);
      const found = whole(draft, c.edition).filter((i) => MINE.includes(i.code));
      expect(found.length, c.name).toBeGreaterThan(0);
      for (const issue of found) expect(issue.path, c.name).toMatch(/^corrections\[\d+\]\.source_url$/);
    }
    // SOURCE_URL has one case for each clause it judges on a correction: http, user info, a redirect wrapper and an archive copy
    expect(cases.filter((c) => c.code === "SOURCE_URL")).toHaveLength(4);
  });

  it("adds only invented addresses, marked as samples, and none of a paste, leak, scan or shadow-library host", () => {
    const invented = (url: string): boolean =>
      /sample/i.test(url) || /^https:\/\/arxiv\.org\/abs\/\d{4}\.99\d{3}$/.test(url) || /^https:\/\/zenodo\.org\/records\/999\d+\/?$/.test(url);
    const cases = [
      ...sourcesCases.map((c) => ({ edition: c.edition ?? "weekday", draft: invalidDraft(c) })),
      ...sourcesNamed.map((c) => ({ edition: c.edition, draft: mutated(c) })),
    ];
    const added = new Set<string>();
    for (const { edition, draft } of cases) {
      const before = new Set(addressesIn(editionDraft(edition)));
      for (const url of addressesIn(draft)) if (!before.has(url)) added.add(url);
    }
    expect(added.size).toBeGreaterThan(15);
    for (const url of added) {
      expect(invented(url), url).toBe(true);
      expect(["paste", "leak_site", "scan_query", "shadow_library", "messaging"], url).not.toContain(blockedEntry(url)?.reason ?? "none");
    }
  });
});

// ── An address in the forms a page's own link may take ───────────────────────────────────────────

describe("an address in another form of the same page", () => {
  it.each([
    "HTTPS://NEWS.EXAMPLE.EDU/statement/1",
    "https://news.example.edu:443/statement/1",
    "https://news.example.edu./statement/1",
    "https://news.example.edu/statement/1#top",
    "https://news.example.edu/statement/1?utm_source=x&utm_medium=y",
    "https://news.example.edu/statement/1/",
    "https://www.news.example.edu/statement/1",
    "https://news.example.edu/statement/1?",
  ])("passes every rule of the group, as the page the run saw: %s", (url) => {
    expect(draftIssues((d) => { d.sources[0].url = url; })).toEqual([]);
  });
});
