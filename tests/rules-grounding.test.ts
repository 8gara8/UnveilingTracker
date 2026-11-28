// Tests of the grounding rules (SPEC §4.12): ARTEFACT_FORMAT, QUOTE_VERBATIM and NUMBER_SOURCED. Each sentence of each row and of
// "Stored records" and "Removed text" is a test that fails if the rule is wrong, assigned to the modes the spec gives it:
//   draft mode             every test, with the run's evidence: the match and the appearance tests, the fixed limits and formats
//   published, being published   only the fixed limits and formats (a quote of at most 25 words, the artefact forms), on the records
//                          that the brief of the date names as first published on it
//   published, other records     the same tests on every other stored record, which stay errors (none of the codes reads `config/`
//                          and none is in ARCHIVE_WARNING_CODES)
// The evidence tests (the artefact appearing in a cited source, the quote matching, NUMBER_SOURCED) never run in published mode, which
// has no evidence, and a stored string that a `removed` correction rewrote is skipped. A correction that rewrites an artefact or a
// quote puts the new text in its `after`, which the two fixed tests judge too (its form, its 25 words) in every mode and on every
// stored correction, and never against a page; a `removed` correction's own `after` is no text to judge. A quote counts a Chinese,
// Japanese or Korean character as half a word (`quoteWords()`). The world is hand-built (tests/helpers/
// rule-world.ts for the Tuesday's draft, context, metrics and stored records) with its own evidence, because the helper's pages
// hold neither its DOI nor its quotes' neighbours. The numbers, sources, pages and quotes are made up.

import { describe, expect, it } from "vitest";
import { codeInfo, codesOfGroup } from "../lib/rules/index";
import { groundingRules, quoteWords } from "../lib/rules/grounding";
import { buildDraftInput, buildPublishedInput, runRules, type DraftInputs } from "../lib/rules/run";
import type { Rule, StoredRecords, ValidationIssue } from "../lib/rules/types";
import { DraftBrief } from "../lib/schema/draft";
import type { Brief } from "../lib/schema/brief";
import { AgentContext } from "../lib/schema/context";
import type { Finding } from "../lib/schema/finding";
import { Correction, Evidence } from "../lib/schema/misc";
import { countWords } from "../lib/text";
import { normalizeUrl } from "../lib/urls";
import { REMOVED_TEXT } from "../lib/vocab";
import {
  D, clone, config, deepFreeze, l, lz, metrics, mondayContext, pack, storedCorrections, storedFinding, storedWorld, sundayContext,
  weekdayContext, weekdayDraft, type Json,
} from "./helpers/rule-world";

// Characters built from their code points, so that no source line holds a dash or a quotation mark of its own.
const ch = (n: number): string => String.fromCharCode(n);
const EM = ch(0x2014);
const EN = ch(0x2013);
const HY = ch(0x2010);
const NBH = ch(0x2011);
const MINUS = ch(0x2212);
const LDQ = ch(0x201c);
const RDQ = ch(0x201d);
const RSQ = ch(0x2019);
const NBSP = ch(0xa0);
const ZWSP = ch(0x200b);
const SHY = ch(0xad);
const [FULL_T, FULL_H, FULL_E] = [ch(0xff54), ch(0xff48), ch(0xff45)];

const CODES = ["ARTEFACT_FORMAT", "QUOTE_VERBATIM", "NUMBER_SOURCED"];
const only = (issues: readonly ValidationIssue[], code: string): ValidationIssue[] => issues.filter((i) => i.code === code);
const rule = (code: string): Rule => groundingRules.find((r) => r.codes[0] === code)!;
/** `n` distinct words: w1 w2 ... wn. */
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");
/** The first code point of each script that a quote counts by character: Han, Hiragana, Katakana and Hangul syllables. */
const SCRIPT_START = { han: 0x4e00, hiragana: 0x3042, katakana: 0x30a2, hangul: 0xac00 } as const;
type Script = keyof typeof SCRIPT_START;
const SCRIPTS = Object.keys(SCRIPT_START) as Script[];
/** `n` characters of a script, consecutive from its first, built from code points so that no line of this file holds one. */
const script = (name: Script, n: number): string => Array.from({ length: n }, (_, i) => String.fromCodePoint(SCRIPT_START[name] + i)).join("");
/** The characters of `codes` as a string. */
const chars = (...codes: number[]): string => String.fromCodePoint(...codes);

// ── The draft world ──────────────────────────────────────────────────────────────────────────────

const P1 = "https://example.org/paper/1"; // new-1's s1
const P2 = "https://example.org/paper/2"; // new-1's s2
const P7 = "https://example.org/paper/7"; // new-2's s1
const B1 = "https://example.org/statement/1";
const B2 = "https://example.org/statement/2";
const B3 = "https://example.org/statement/3";
const PRE1 = "https://example.org/preprint/1"; // the one source of a stored finding that the context shows in full
const J9 = "https://example.org/journal/9";
const LEAN = "https://github.com/example-lab/proofs/blob/main/Sums.lean";
const LEAN_KEY = "github.com/example-lab/proofs/blob/main/Sums.lean";

/** What the run saw at each URL: every quote, artefact and figure licence of `baseDraft()` is in a page of its own source. */
const baseTexts = (): Record<string, string | null> => ({
  [P1]: "Paper one. The system solved it. DOI 10.1234/example.1 and NCT01234567; deposited as PDB 1ABC. The figure is released under CC BY 4.0.",
  [P2]: `Paper two. The reviewer wrote a careful result. arXiv:2610.99001v1 appeared first. Code: ${LEAN_KEY}`,
  [P7]: "Paper seven.",
  [B1]: "Statement one.",
  [B2]: "Statement two.",
  [B3]: "Statement three.",
  [PRE1]: "Preprint one.",
  [J9]: "Journal nine.",
});

/**
 * The Tuesday's draft with every artefact kind and a figure on its first new finding, and no number in any of its prose (the
 * helper's system is named "Sample System 3", whose digit a source would have to show, so the name loses it here).
 */
function baseDraft(): Json {
  const d = clone(weekdayDraft()) as unknown as Json;
  const f = d.new_findings[0];
  f.ai.systems[0].name = "Sample System";
  f.explainer.ai_helped = "Sample System, from Example Lab, did the work.";
  f.artefacts = { doi: ["10.1234/example.1"], arxiv: ["2610.99001v2"], lean: [LEAN], trial: ["NCT01234567"], pdb: ["1abc"] };
  f.figure = {
    source_id: "s1", image_url: "https://example.org/fig/1.png", licence: "CC-BY-4.0", licence_quote: "released under CC BY 4.0",
    credit: "Figure 1 from a made-up paper", alt: "A made-up chart.",
  };
  return d;
}

const mkEvidence = (texts: Record<string, string | null>): Evidence => {
  const present = Object.entries(texts).filter((e): e is [string, string] => e[1] !== null);
  return Evidence.parse({
    urls: present.map(([u]) => u), fetched: [], texts: Object.fromEntries(present.map(([u, t]) => [normalizeUrl(u), t])),
    seen_as: {}, types: {}, resolved: {},
  });
};

interface Scene {
  /** Changes the plain draft before it is parsed. */
  edit?: (d: Json) => void;
  /** Pages by URL, over the base pages; null takes a page away. */
  texts?: Record<string, string | null>;
  /** False: the run has no evidence. */
  evidence?: false;
  context?: AgentContext;
  /** False: the run has no metrics file; else the file. */
  metrics?: false | ReturnType<typeof metrics>;
  stored?: StoredRecords;
}

function draftInputs(scene: Scene): DraftInputs {
  return {
    context: scene.context ?? weekdayContext(),
    evidence: scene.evidence === false ? null : mkEvidence({ ...baseTexts(), ...scene.texts }),
    metrics: scene.metrics === false ? null : scene.metrics ?? metrics(),
    pack: pack(),
    stored: scene.stored ?? null,
    config: config(),
  };
}

function draftRun(scene: Scene = {}): { issues: ValidationIssue[]; draft: DraftBrief } {
  const json = baseDraft();
  scene.edit?.(json);
  const draft = DraftBrief.parse(json);
  return { issues: runRules(buildDraftInput(draft, draftInputs(scene)), groundingRules), draft };
}

const draftIssues = (scene: Scene = {}): ValidationIssue[] => draftRun(scene).issues;

/** A draft correction of the stored finding `math-2026-0002`, which the context shows; `over` changes a field. */
const correction = (path: string, after: string, over: Json = {}): Json => ({
  finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "correction", path, after,
  reason: "The record was wrong.", source_url: null, report_id: null, ...over,
});

/** Puts `list` in place of the base draft's corrections, and drops its report decisions, which name a correction's report. */
const correcting = (...list: Json[]) => (d: Json): void => {
  d.corrections = list;
  d.report_decisions = [];
};

/** The draft's issues when `raw` corrections, put in its list after it is parsed, are its only ones: ones that the schema refuses, such as a removed correction at an artefact path. */
function rawIssues(raw: Json[], scene: Scene = {}): ValidationIssue[] {
  const json = baseDraft();
  scene.edit?.(json);
  json.corrections = [];
  json.report_decisions = [];
  const draft = DraftBrief.parse(json);
  draft.corrections.push(...(raw as DraftBrief["corrections"]));
  return runRules(buildDraftInput(draft, draftInputs(scene)), groundingRules);
}

/** One issue, with the code and path and every fragment in its message. */
function expectIssue(issues: readonly ValidationIssue[], code: string, path: string, fragments: readonly string[] = []): ValidationIssue {
  const found = issues.filter((i) => i.code === code && i.path === path);
  expect(found, `${code} at ${path} in ${JSON.stringify(issues.map((i) => `${i.code} ${i.path}`))}`).toHaveLength(1);
  const issue = found[0]!;
  expect(issue.severity).toBe("error");
  for (const fragment of fragments) expect(issue.message).toContain(fragment);
  expect(issue.hint).not.toBeNull();
  return issue;
}

// ── The stored world ─────────────────────────────────────────────────────────────────────────────

const EARLIER = "2026-11-10";

/** The stored biology finding as it is published on D (`being`), or as an older record the brief of D only names. */
function stored(over: Json = {}, being = true): Finding {
  return storedFinding("bio-2026-0001", {
    ...(being ? {} : { first_brief: EARLIER, briefs: [EARLIER, D] }), ...over,
  });
}

function publishedIssues(
  findings: Finding[], opts: { publishing?: string | null; corrections?: Correction[]; brief?: Brief | null } = {},
): ValidationIssue[] {
  const w = storedWorld();
  const content = { findings, terms: w.terms, corrections: opts.corrections ?? w.corrections, reports: w.reports };
  const publishing = opts.publishing === undefined ? D : opts.publishing;
  const input = opts.brief === null
    ? buildPublishedInput(null, content, { config: w.config, date: D, publishing })
    : buildPublishedInput(opts.brief ?? w.brief, content, { config: w.config, publishing });
  return runRules(input, groundingRules);
}

/** The stored finding's artefacts, with `kind` holding `values` and the rest empty. */
const artefactsOf = (kind: string, values: string[]): Json => ({ doi: [], arxiv: [], lean: [], trial: [], pdb: [], [kind]: values });

/** A removed correction of a finding's text at `path`, as publish stores it. */
const removal = (id: string, path: string): Correction => Correction.parse({
  id, date: D, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "removed", path,
  before: l("the text before"), after: lz(REMOVED_TEXT.en, REMOVED_TEXT.zh), reason: l("A safety check flagged the text."), source_url: null,
  trigger: "recheck", report_id: null,
});

/** A stored correction of a finding's text at `path`, to a text of any length; `over` changes a field (its date, its type, its `after`). */
const rewrite = (id: string, path: string, before: string, after: string, over: Json = {}): Correction => Correction.parse({
  id, date: D, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path,
  before: l(before), after: l(after), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null, ...over,
});

/** The corrections file with one more stored correction of `bio-2026-0001`: dated D when `being` (it is being published), else earlier. */
const withRewrite = (being: boolean, path: string, after: string, over: Json = {}): Correction[] =>
  [...storedCorrections(), rewrite("C-0003", path, "the text before", after, { date: being ? D : EARLIER, ...over })];

/** Where that correction's text is, as an issue path: the third correction of the file, whose first two are the world's. */
const STORED_AFTER = "corrections.json: corrections[2].after.en";

// ── The rules as the registry sees them ──────────────────────────────────────────────────────────

describe("the grounding rules", () => {
  it("are three, one for each code of the group, in the table's order", () => {
    expect(codesOfGroup("grounding")).toEqual(CODES);
    expect(groundingRules.map((r) => r.codes)).toEqual(CODES.map((c) => [c]));
  });

  it("are hard rules that run in the modes the table gives and never in the Chinese pass", () => {
    for (const r of groundingRules) {
      const info = codeInfo(r.codes[0])!;
      expect(info.severity).toBe("H");
      expect(r.severity).toBe("error");
      expect(r.scope).toEqual(info.scopes);
      expect(r.scope).not.toContain("zh");
    }
    expect(rule("ARTEFACT_FORMAT").scope).toEqual(["draft", "published"]);
    expect(rule("QUOTE_VERBATIM").scope).toEqual(["draft", "published"]);
    expect(rule("NUMBER_SOURCED").scope).toEqual(["draft"]);
  });

  it("name the run inputs they read: the two with a fixed part use the evidence, the number test needs it", () => {
    expect(rule("ARTEFACT_FORMAT").needs).toEqual([]);
    expect(rule("ARTEFACT_FORMAT").uses).toEqual(["evidence"]);
    expect(rule("QUOTE_VERBATIM").needs).toEqual([]);
    expect(rule("QUOTE_VERBATIM").uses).toEqual(["evidence"]);
    expect(rule("NUMBER_SOURCED").needs).toEqual(["evidence"]);
    expect(rule("NUMBER_SOURCED").uses).toEqual([]);
  });

  it("pass the made-up Tuesday, and report only their own codes on a draft that breaks all three", () => {
    expect(draftIssues()).toEqual([]);
    const issues = draftIssues({
      edit: (d) => {
        const f = d.new_findings[0];
        f.artefacts.doi = ["10.1234/absent.1", "not a doi"];
        f.ai.evidence[0].quote = "words that no page holds";
        f.explainer.found = "It had 4,812 parts.";
      },
    });
    expect(new Set(issues.map((i) => i.code))).toEqual(new Set(CODES));
    expect(issues.map((i) => i.code).filter((c) => !CODES.includes(c))).toEqual([]);
  });

  it("leave a stored finding that the draft names to the stored records: its artefacts, quotes and numbers are not judged", () => {
    const bad = storedFinding("math-2026-0002", {
      artefacts: artefactsOf("pdb", ["BAD"]),
      reactions: [{ source_id: "s2", who: "A. Reviewer", affiliation: "Example University", quote: words(40) }],
      explainer: { ...storedFinding("math-2026-0002").explainer, found: lz("It had 4,812 parts.", "共有 4,812 個部分。") },
    });
    const issues = draftIssues({ stored: { findings: [bad], corrections: [], terms: [] } });
    expect(issues.filter((i) => CODES.includes(i.code) || i.code === "RULE_ERROR")).toEqual([]);
  });

  it("are pure: a deeply frozen input gives the same issues twice", () => {
    const json = baseDraft();
    json.new_findings[0].explainer.found = "It had 4,812 parts.";
    json.new_findings[0].artefacts.pdb = ["zzz"];
    json.new_findings[0].ai.evidence[0].quote = "no such words";
    const input = deepFreeze(buildDraftInput(DraftBrief.parse(json), draftInputs({})));
    const first = runRules(input, groundingRules);
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(runRules(input, groundingRules)).toEqual(first);
    expect(first.map((i) => i.code)).not.toContain("RULE_ERROR");
  });
});

// ── ARTEFACT_FORMAT ──────────────────────────────────────────────────────────────────────────────

/** A finding whose only artefacts are `values` of `kind`, with a source added for each of `urls`. */
const withArtefacts = (kind: string, values: string[], urls: string[] = []) => (d: Json): void => {
  const f = d.new_findings[0];
  f.artefacts = artefactsOf(kind, values);
  urls.forEach((url, i) => {
    f.sources.push({ id: `s${3 + i}`, kind: "registry", title: "A made-up record", publisher: "Example Registry", url, doi: null, published_at: "2026-11-20" });
  });
};

const ART = (kind: string, i = 0): string => `new_findings[0].artefacts.${kind}[${i}]`;

describe("ARTEFACT_FORMAT, draft mode", () => {
  describe("the forms of SPEC §4.3", () => {
    // Each value is in the stored form, and the page of the finding's first source holds it.
    const GOOD: [string, string][] = [
      ["doi", "10.1234/example.1"], ["doi", "10.123456789/x"], ["doi", "10.1016/s0140-6736(20)30183-5"],
      ["arxiv", "2610.9900"], ["arxiv", "2610.99001"], ["arxiv", "2610.99001v10"],
      ["trial", "NCT01234567"],
      ["pdb", "1abc"], ["pdb", "9zz1"], ["pdb", "1234"], ["pdb", "pdb_00009zz1"],
      ["lean", LEAN], ["lean", "https://www.github.com/example-lab/proofs/blob/main/Sums.lean"],
      ["lean", `${LEAN}?plain=1#L10`], ["lean", "https://GitHub.com/example-lab/proofs/blob/main/Sums.lean"],
    ];
    it.each(GOOD)("passes the %s %s", (kind, value) => {
      const issues = draftIssues({ edit: withArtefacts(kind, [value]), texts: { [P1]: `Page. ${value} is here.`, [P2]: null } });
      expect(only(issues, "ARTEFACT_FORMAT")).toEqual([]);
    });

    // Each value breaks its form; the issue names the value and says how to write it, and the value is not looked for in the pages.
    const BAD: [string, string, string][] = [
      ["doi", "https://doi.org/10.1234/example.1", "Write it as 10.1234/example.1."],
      ["doi", "doi:10.1234/example.1", "Write it as 10.1234/example.1."],
      ["doi", "10.1234/Example.1", "Write it as 10.1234/example.1."],
      ["doi", "10.123/x", "Correct it, or take it out."],
      ["doi", "10.1234567890/x", "Correct it, or take it out."],
      ["doi", "10.1234/", "Correct it, or take it out."],
      ["doi", "10.1234/a b", "Correct it, or take it out."],
      ["doi", "11.1234/x", "Correct it, or take it out."],
      ["arxiv", "arXiv:2610.99001", "Write it as 2610.99001."],
      ["arxiv", "https://arxiv.org/abs/2610.99001v2", "Write it as 2610.99001v2."],
      ["arxiv", "https://arxiv.org/pdf/2610.99001.pdf", "Write it as 2610.99001."],
      ["arxiv", "261.99001", "Correct it, or take it out."],
      ["arxiv", "2610.990", "Correct it, or take it out."],
      ["arxiv", "2610.990012", "Correct it, or take it out."],
      ["arxiv", "2610.99001v", "Correct it, or take it out."],
      ["arxiv", "hep-th/9901001", "Correct it, or take it out."],
      ["trial", "nct01234567", "Write it as NCT01234567."],
      ["trial", "NCT1234567", "Correct it, or take it out."],
      ["trial", "NCT012345678", "Correct it, or take it out."],
      ["trial", "NCT 01234567", "Correct it, or take it out."],
      ["pdb", "1ABC", "Write it as 1abc."],
      ["pdb", "PDB_00009ZZ1", "Write it as pdb_00009zz1."],
      ["pdb", "abcd", "Correct it, or take it out."],
      ["pdb", "1ab", "Correct it, or take it out."],
      ["pdb", "1abcd", "Correct it, or take it out."],
      ["pdb", "pdb_0009zz1", "Correct it, or take it out."],
      ["lean", "http://github.com/example-lab/proofs/blob/main/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://gitlab.com/example-lab/proofs/blob/main/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://raw.githubusercontent.com/example-lab/proofs/main/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://gist.github.com/example-lab/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://github.com/example-lab/proofs/blob/main/Sums.txt", "Correct it, or take it out."],
      ["lean", "https://github.com/example-lab/proofs/blob/main/Sums.lean.md", "Correct it, or take it out."],
      ["lean", "github.com/example-lab/proofs/blob/main/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://user@github.com/example-lab/proofs/blob/main/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://user:pw@github.com/example-lab/proofs/blob/main/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://:pw@github.com/example-lab/proofs/blob/main/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://github.com:8443/example-lab/proofs/blob/main/Sums.lean", "Correct it, or take it out."],
      ["lean", "https://github.com/example-lab/proofs/blob/main/Sums.lean extra", "Correct it, or take it out."],
      ["lean", "not a url", "Correct it, or take it out."],
      ["lean", ` ${LEAN}`, "Correct it, or take it out."],
      ["lean", `${LEAN} `, "Correct it, or take it out."],
      ["doi", " 10.1234/example.1", "Write it as 10.1234/example.1."],
      ["doi", "HTTPS://DOI.ORG/10.1234/Example.1", "Write it as 10.1234/example.1."],
      ["arxiv", " arXiv:2610.99001 ", "Write it as 2610.99001."],
      ["arxiv", "ARXIV:2610.99001", "Write it as 2610.99001."],
      ["arxiv", "arxiv: 2610.99001v2", "Write it as 2610.99001v2."],
      ["arxiv", "http://www.arxiv.org/abs/2610.99001v1", "Write it as 2610.99001v1."],
      ["arxiv", "https://arxiv.org/pdf/2610.99001v3", "Write it as 2610.99001v3."],
      ["arxiv", "https://arxiv.org/abs/hep-th/9901001", "Correct it, or take it out."],
      ["arxiv", "https://example.org/abs/2610.99001", "Correct it, or take it out."],
      ["trial", " NCT01234567", "Write it as NCT01234567."],
      ["trial", "nct01234567 ", "Write it as NCT01234567."],
      ["pdb", " 1abc", "Write it as 1abc."],
      ["pdb", "1Abc ", "Write it as 1abc."],
      // A known other way of writing it that is still not a stored form is no edit to offer: the message asks for a correction.
      ["trial", "nct123", "Correct it, or take it out."],
      ["pdb", "1ABCD", "Correct it, or take it out."],
      ["doi", "https://doi.org/10.12/ABC", "Correct it, or take it out."],
    ];
    const LABEL: Record<string, string> = { doi: "DOI", arxiv: "arXiv id", trial: "NCT number", pdb: "PDB id", lean: "Lean file URL" };
    it.each(BAD)("fails the %s %s with one issue that tells the edit", (kind, value, edit) => {
      const issues = draftIssues({ edit: withArtefacts(kind, [value]), texts: { [P1]: `Page. ${value} is here.` } });
      expect(only(issues, "ARTEFACT_FORMAT")).toHaveLength(1);
      expectIssue(issues, "ARTEFACT_FORMAT", ART(kind), [`The ${LABEL[kind]} "${value}" is not in the stored form`, edit]);
    });

    it("names the form each kind takes, and points at SPEC §4.3 in the hint", () => {
      const forms: Record<string, string> = {
        doi: "10.NNNN/suffix in lower case, without https://doi.org/", arxiv: "four digits, a dot and four or five digits",
        trial: "NCT and eight digits", pdb: "a digit and three lower-case letters or digits", lean: "the https URL of a .lean file on github.com",
      };
      for (const [kind, value] of [["doi", "bad"], ["arxiv", "bad"], ["trial", "bad"], ["pdb", "bad"], ["lean", "bad"]] as const) {
        const issue = draftIssues({ edit: withArtefacts(kind, [value]) }).find((i) => i.code === "ARTEFACT_FORMAT")!;
        expect(issue.message).toContain(forms[kind]!);
        expect(issue.hint).toContain("SPEC §4.3");
      }
    });

    it("judges each value of a list, and the second of two is at index 1", () => {
      const issues = draftIssues({ edit: withArtefacts("doi", ["10.1234/example.1", "oops"]) });
      expect(only(issues, "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([ART("doi", 1)]);
    });

    it("judges every kind of a finding in one run, and every new finding", () => {
      const issues = draftIssues({
        edit: (d) => {
          d.new_findings[0].artefacts = { doi: ["x"], arxiv: ["x"], lean: ["x"], trial: ["x"], pdb: ["x"] };
          d.new_findings[1].artefacts = { doi: [], arxiv: [], lean: [], trial: ["y"], pdb: [] };
        },
      });
      expect(only(issues, "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([
        ART("arxiv"), ART("doi"), ART("lean"), ART("pdb"), ART("trial"), "new_findings[1].artefacts.trial[0]",
      ]);
    });
  });

  describe("each artefact appears in a source's URL or fetched text", () => {
    // [kind, value, extra source URLs, the first page's text, expected to appear]
    const CASES: [string, string, string[], string, boolean][] = [
      ["doi", "10.1234/example.1", [], "A page that shows 10.1234/example.1 in its text.", true],
      ["doi", "10.1234/example.1", [], "Cited as (10.1234/example.1).", true],
      ["doi", "10.1234/example.1", [], "The paper, 10.1234/example.1.", true],
      ["doi", "10.1234/example.1", [], "Given as doi:10.1234/example.1v2 online.", true],
      ["doi", "10.1234/example.1", [], "In capitals: 10.1234/EXAMPLE.1 here.", true],
      ["doi", "10.5555/abc.def", ["https://doi.org/10.5555/abc.def"], "no doi here", true],
      ["doi", "10.1002/anie.202011111", ["https://onlinelibrary.example.org/doi/10.1002%2Fanie.202011111"], "no doi here", true],
      ["doi", "10.1101/2026.09.02.990011", ["https://www.biorxiv.org/content/10.1101/2026.09.02.990011v1"], "no doi here", true],
      ["doi", "10.1234/example.1", [], "Only 10.1234/example.12 is on this page.", false],
      ["doi", "10.1234/example.1", [], "Only 10.1234/example.1.2 is on this page.", false],
      ["doi", "10.1234/example.1", [], "Only 10.1234/example.1/part is on this page.", false],
      ["doi", "10.1234/example.1", [], "Only 10.1234/example.1-b is on this page.", false],
      ["doi", "10.1234/example.1", [], "Only 10.1234/example.1x is on this page.", false],
      ["doi", "10.1234/example.1", [], "Only 10.1234/example.1_x is on this page.", false],
      ["doi", "10.1234/example.1", [], "Cited at 10.1234/example.1/ and elsewhere.", true],
      ["doi", "10.1234/example.1", [], "Cited as 10.1234/example.1- and elsewhere.", true],
      ["doi", "10.1234/example.1", [], "Cited as 10.1234/example.1; and elsewhere.", true],
      ["doi", "10.1234/example.1", [], "Only x10.1234/example.1 is on this page.", false],
      ["doi", "10.1234/example.1", [], "Only 110.1234/example.1 is on this page.", false],
      ["doi", "10.1234/example.1", [], "A page with no doi at all.", false],
      ["arxiv", "2610.99001v2", [], "Posted as arXiv:2610.99001v1 first.", true],
      ["arxiv", "2610.99001", [], "Posted as arXiv:2610.99001v3 later.", true],
      ["arxiv", "2610.99001", [], "Posted as 2610.99001.", true],
      ["arxiv", "2610.99001", ["https://arxiv.org/abs/2610.99001"], "no id here", true],
      ["arxiv", "2610.99001v2", ["https://arxiv.org/pdf/2610.99001v1.pdf"], "no id here", true],
      ["arxiv", "2610.99001", [], "Posted as 2610.990012.", false],
      ["arxiv", "2610.99001", [], "Posted as 12610.99001.", false],
      ["arxiv", "2610.99001", [], "Posted as 2610.99001.5 later.", false],
      ["arxiv", "2610.99001", [], "Posted as x2610.99001.", false],
      ["arxiv", "2610.99001", [], "Posted as 1.2610.99001 later.", false],
      ["arxiv", "2610.99001", [], "Posted as 2610.99001, then withdrawn.", true],
      ["arxiv", "2610.99001", [], "Posted as 2610.99001v2.", true],
      ["arxiv", "2610.99001", [], "Posted as 2610.99001V2.", true],
      ["arxiv", "2610.99001v2", [], "Posted as arxiv:2610.99001.", true],
      ["arxiv", "2610.9900", [], "Posted as 2610.99001.", false],
      ["arxiv", "2610.99001", [], "Posted as 2610.99002.", false],
      ["trial", "NCT01234567", [], "Registered as NCT01234567.", true],
      ["trial", "NCT01234567", [], "Registered as nct01234567.", true],
      ["trial", "NCT01234567", ["https://clinicaltrials.gov/study/NCT01234567"], "no id here", true],
      ["trial", "NCT01234567", [], "Registered as NCT012345678.", false],
      ["trial", "NCT01234567", [], "Registered as xNCT01234567.", false],
      ["trial", "NCT01234567", [], "Registered as 9NCT01234567.", false],
      ["trial", "NCT01234567", [], "Registered as NCT01234568.", false],
      ["pdb", "1abc", [], "Deposited as PDB 1ABC.", true],
      ["pdb", "1abc", [], "Deposited as 1abc, released.", true],
      ["pdb", "1abc", ["https://www.rcsb.org/structure/1ABC"], "no id here", true],
      ["pdb", "pdb_00009zz1", [], "Deposited as pdb_00009zz1.", true],
      ["pdb", "1abc", [], "Deposited as 21abc.", false],
      ["pdb", "1abc", [], "Deposited as 1abcd.", false],
      ["pdb", "1abc", [], "Deposited as 1abc_x.", false],
      ["pdb", "1abc", [], "Deposited as x_1abc.", false],
      ["pdb", "1abc", [], "Deposited as 1abd.", false],
      ["lean", LEAN, [LEAN], "no code here", true],
      ["lean", LEAN, ["https://www.github.com/example-lab/proofs/blob/main/Sums.lean#L10"], "no code here", true],
      ["lean", LEAN, ["HTTPS://GitHub.com/example-lab/proofs/blob/main/Sums.lean"], "no code here", true],
      ["lean", LEAN, ["https://github.com/Example-Lab/Proofs/blob/main/Sums.lean"], "no code here", true],
      ["lean", LEAN, ["https://github.com/example-lab/proofs/blob/main/sums.lean"], "no code here", true],
      ["lean", LEAN, [], `The proof is at ${LEAN} in full.`, true],
      ["lean", LEAN, [], `The proof is at ${LEAN_KEY.toLowerCase()} in full.`, true],
      ["lean", LEAN, [], `The proof is at ${LEAN_KEY}.`, true],
      ["lean", LEAN, [], `The proof is at ${LEAN_KEY}4 in full.`, false],
      ["lean", LEAN, [], `The proof is at x${LEAN_KEY} in full.`, false],
      ["lean", LEAN, [], `The proof is at 9${LEAN_KEY} in full.`, false],
      ["lean", LEAN, [], "The proof is at github.com/example-lab/proofs in full.", false],
      ["lean", LEAN, ["https://github.com/example-lab/proofs"], "no code here", false],
      ["lean", LEAN, ["https://github.com/example-lab/proofs/blob/main/Sums.lean?plain=1"], "no code here", false],
      ["lean", LEAN, ["https://github.com/example-lab/proofs/blob/main/Other.lean"], "no code here", false],
    ];
    it.each(CASES)("the %s %s with sources %j and the page %j: appears %s", (kind, value, urls, text, appears) => {
      const issues = draftIssues({ edit: withArtefacts(kind, [value], urls), texts: { [P1]: text, [P2]: "Paper two." } });
      const found = only(issues, "ARTEFACT_FORMAT");
      if (appears) {
        expect(found).toEqual([]);
      } else {
        expect(found).toHaveLength(1);
        expectIssue(issues, "ARTEFACT_FORMAT", ART(kind), ["appears in the URL or fetched text of none of this finding's sources"]);
      }
    });

    it("reads a URL with a malformed percent escape as it is, without failing", () => {
      const url = "https://example.org/record%E0%A4%A?doi=10.5555/abc.def";
      const found = draftIssues({ edit: withArtefacts("doi", ["10.5555/abc.def"], [url]) });
      expect(only(found, "ARTEFACT_FORMAT")).toEqual([]);
      const absent = draftIssues({ edit: withArtefacts("doi", ["10.5555/other.one"], [url]) });
      expect(only(absent, "ARTEFACT_FORMAT")).toHaveLength(1);
      expect(absent.map((i) => i.code)).not.toContain("RULE_ERROR");
    });

    it("looks for the artefact in each of the finding's own sources, the second page too", () => {
      const issues = draftIssues({ edit: withArtefacts("trial", ["NCT07654321"]), texts: { [P2]: "Registered as NCT07654321." } });
      expect(only(issues, "ARTEFACT_FORMAT")).toEqual([]);
    });

    it("names the finding's sources in the message, and says when none of them has fetched text", () => {
      const missing = draftIssues({ edit: withArtefacts("trial", ["NCT07654321"]) });
      const a = expectIssue(missing, "ARTEFACT_FORMAT", ART("trial"), ['The NCT number "NCT07654321"', "(s1, s2)"]);
      expect(a.message).not.toContain("none of them has fetched text");
      expect(a.hint).toContain("never write one from memory");
      const blind = draftIssues({ edit: withArtefacts("trial", ["NCT07654321"]), texts: { [P1]: null, [P2]: null } });
      expectIssue(blind, "ARTEFACT_FORMAT", ART("trial"), ["(s1, s2), and none of them has fetched text."]);
      const blank = draftIssues({ edit: withArtefacts("trial", ["NCT07654321"]), texts: { [P1]: "  \n", [P2]: "" } });
      expectIssue(blank, "ARTEFACT_FORMAT", ART("trial"), ["and none of them has fetched text."]);
      // One page read and one not: the artefact is missing from a page that was read, which is not the same as nothing to read.
      const mixed = draftIssues({ edit: withArtefacts("trial", ["NCT07654321"]), texts: { [P1]: "  \n", [P2]: "Paper two." } });
      const half = expectIssue(mixed, "ARTEFACT_FORMAT", ART("trial"), ["(s1, s2)."]);
      expect(half.message).not.toContain("none of them has fetched text");
    });

    it("counts only the finding's own sources: not the brief's, not another finding's", () => {
      const inBrief = draftIssues({ edit: withArtefacts("trial", ["NCT07654321"]), texts: { [B1]: "Registered as NCT07654321." } });
      expectIssue(inBrief, "ARTEFACT_FORMAT", ART("trial"));
      const inOther = draftIssues({ edit: withArtefacts("trial", ["NCT07654321"]), texts: { [P7]: "Registered as NCT07654321." } });
      expectIssue(inOther, "ARTEFACT_FORMAT", ART("trial"));
      const ownUrl = draftIssues({
        edit: (d) => {
          withArtefacts("trial", ["NCT07654321"])(d);
          d.sources[0].url = "https://clinicaltrials.gov/study/NCT07654321";
        },
      });
      expectIssue(ownUrl, "ARTEFACT_FORMAT", ART("trial"));
    });

    it("does not take a source's own `doi` field for the DOI appearing", () => {
      const issues = draftIssues({
        edit: (d) => {
          withArtefacts("doi", ["10.9999/only.field"])(d);
          d.new_findings[0].sources[0].doi = "10.9999/only.field";
        },
      });
      expectIssue(issues, "ARTEFACT_FORMAT", ART("doi"));
    });

    it("finds a page by its normalised URL, so a tracking parameter or a www host does not hide it", () => {
      const issues = draftIssues({
        edit: (d) => {
          withArtefacts("trial", ["NCT07654321"])(d);
          d.new_findings[0].sources[0].url = "https://www.example.org/paper/1?utm_source=x";
        },
        texts: { [P1]: "Registered as NCT07654321." },
      });
      expect(only(issues, "ARTEFACT_FORMAT")).toEqual([]);
    });

    it("judges a finding with no source: its artefact appears nowhere", () => {
      const issues = draftIssues({
        edit: (d) => {
          withArtefacts("trial", ["NCT07654321"])(d);
          d.new_findings[0].sources = [];
          d.new_findings[0].go_deeper = [];
        },
      });
      const issue = expectIssue(issues, "ARTEFACT_FORMAT", ART("trial"), ["(none)"]);
      expect(issue.message).not.toContain("none of them has fetched text");
    });
  });

  describe("the run's evidence", () => {
    it("leaves the forms to be judged and the appearance unjudged when the run has none, and says so once", () => {
      const issues = draftIssues({
        evidence: false,
        edit: (d) => {
          d.new_findings[0].artefacts = { doi: ["10.9999/absent.1", "bad"], arxiv: [], lean: [], trial: [], pdb: [] };
        },
      });
      expect(only(issues, "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([ART("doi", 1)]);
      const missing = issues.filter((i) => i.code === "INPUT_MISSING");
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("warning");
      expect(missing[0]!.message).toContain("ran without it: ARTEFACT_FORMAT, QUOTE_VERBATIM");
    });

    it("runs the appearance test as soon as the run has evidence, even with no page for a source", () => {
      const issues = draftIssues({ edit: withArtefacts("trial", ["NCT07654321"]), texts: { [P1]: null, [P2]: null } });
      expect(only(issues, "ARTEFACT_FORMAT")).toHaveLength(1);
    });
  });

  describe("a stored finding the draft names", () => {
    it("is not judged: its artefacts are the stored record's, read through the context or the stored records", () => {
      const bad = storedFinding("math-2026-0002", { artefacts: artefactsOf("doi", ["https://doi.org/10.1/x", "NOT"]) });
      const records: StoredRecords = { findings: [bad], corrections: [], terms: [] };
      const issues = draftIssues({ stored: records });
      expect(only(issues, "ARTEFACT_FORMAT")).toEqual([]);
    });
  });

  describe("a correction's text at an artefact path", () => {
    // A correction of `artefacts.doi.0` puts its `after` in the finding's record, so the text must be in the stored form. Which page would
    // show it is not asked: the correction names none for it.
    const LABEL: Record<string, string> = { doi: "DOI", arxiv: "arXiv id", trial: "NCT number", pdb: "PDB id", lean: "Lean file URL" };
    const AT = (i = 0): string => `corrections[${i}].after`;
    // [kind, the correction's path, its text, the edit the message tells]
    const BAD_AFTER: [string, string, string, string][] = [
      ["doi", "artefacts.doi.0", "https://doi.org/10.1234/example.1", "Write it as 10.1234/example.1."],
      ["doi", "artefacts.doi.3", "10.1234/Example.1", "Write it as 10.1234/example.1."],
      ["doi", "artefacts.doi.10", "10.123/x", "Correct it, or take it out."],
      ["arxiv", "artefacts.arxiv.0", "arXiv:2610.99001", "Write it as 2610.99001."],
      ["trial", "artefacts.trial.1", "nct01234567", "Write it as NCT01234567."],
      ["pdb", "artefacts.pdb.0", "1ABC", "Write it as 1abc."],
      ["lean", "artefacts.lean.0", "http://github.com/example-lab/proofs/blob/main/Sums.lean", "Correct it, or take it out."],
    ];
    const GOOD_AFTER: [string, string][] = [
      ["artefacts.doi.0", "10.9999/never.shown.1"], ["artefacts.arxiv.2", "2610.99777v3"], ["artefacts.trial.0", "NCT09999777"],
      ["artefacts.pdb.0", "pdb_00009zz9"], ["artefacts.lean.1", "https://github.com/example-lab/proofs/blob/main/Other.lean"],
    ];

    it.each(BAD_AFTER)("fails a correction of the %s at %s whose text is %j, at the correction's own `after`", (kind, path, after, edit) => {
      const issues = draftIssues({ edit: correcting(correction(path, after)) });
      expect(issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
      expect(only(issues, "ARTEFACT_FORMAT")).toHaveLength(1);
      expectIssue(issues, "ARTEFACT_FORMAT", AT(), [`The ${LABEL[kind]} "${after}" is not in the stored form`, edit]);
    });

    it("says what it says of a new finding's artefact with the same text, with the same hint", () => {
      for (const [kind, path, after] of BAD_AFTER) {
        const onFinding = only(draftIssues({ edit: withArtefacts(kind, [after]) }), "ARTEFACT_FORMAT");
        const onCorrection = only(draftIssues({ edit: correcting(correction(path, after)) }), "ARTEFACT_FORMAT");
        expect(onFinding, kind).toHaveLength(1);
        expect(onCorrection.map((i) => [i.message, i.hint, i.severity])).toEqual(onFinding.map((i) => [i.message, i.hint, i.severity]));
      }
    });

    it.each(GOOD_AFTER)("passes a correction of %s to %j, which no page of the run shows", (path, after) => {
      const issues = draftIssues({ edit: correcting(correction(path, after)) });
      expect(issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
      expect(only(issues, "ARTEFACT_FORMAT")).toEqual([]);
    });

    it("judges each correction at its own place in the list, and a finding's own artefacts as before", () => {
      const issues = draftIssues({
        edit: (d) => {
          withArtefacts("trial", ["nope"])(d);
          correcting(
            correction("explainer.how_sure", "Fine."), correction("artefacts.doi.0", "oops"), correction("artefacts.trial.0", "NCT01234567"),
            correction("artefacts.pdb.0", "oops too"),
          )(d);
        },
      });
      expect(only(issues, "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([AT(1), AT(3), ART("trial")]);
    });

    it("reads the `after` and nothing else of a correction", () => {
      const edit = correcting(correction("artefacts.doi.0", "10.9999/ut.1", { reason: "It was https://doi.org/10.9999/ut.1 before.", source_url: "https://doi.org/10.9999/ut.1" }));
      expect(only(draftIssues({ edit }), "ARTEFACT_FORMAT")).toEqual([]);
    });

    it("leaves a correction at any other path to the rules that read that path", () => {
      for (const path of ["explainer.how_sure", "title", "sources.0.url", "ai.evidence.0.quote", "reactions.0.quote", "figure.licence_quote", "go_deeper.0"]) {
        const issues = draftIssues({ edit: correcting(correction(path, "https://doi.org/10.1234/Example.1 and nct01234567")) });
        expect(only(issues, "ARTEFACT_FORMAT"), path).toEqual([]);
      }
    });

    it("reads a path as an artefact's only when it is exactly artefacts, a kind and an index without leading zeros", () => {
      const near = [
        "artefacts.doi.00", "artefacts.doi.01", "artefacts.doi.-1", "artefacts.doi.1.0", "artefacts.doi.0.x", "xartefacts.doi.0", "artefacts.other.0",
        "artefacts.doi", "artefacts.DOI.0", "artefacts..0", "artefacts.doi.0 ", "artefacts.doi.0\n", "artefacts.doi.a",
      ];
      const issues = rawIssues(near.map((path) => correction(path, "oops")));
      expect(issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
      expect(only(issues, "ARTEFACT_FORMAT")).toEqual([]);
    });

    it("skips a removed correction whose text is REMOVED_TEXT, and no other type and no other text", () => {
      const at = "artefacts.doi.0";
      const link = "https://doi.org/10.1234/example.1";
      expect(only(rawIssues([correction(at, REMOVED_TEXT.en, { type: "removed" })]), "ARTEFACT_FORMAT")).toEqual([]);
      // the type alone skips nothing: a removed correction that holds other text is judged like any other
      expect(only(rawIssues([correction(at, link, { type: "removed" })]), "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([AT()]);
      expect(only(rawIssues([correction(at, `${REMOVED_TEXT.en} `, { type: "removed" })]), "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([AT()]);
      expect(only(rawIssues([correction(at, REMOVED_TEXT.zh, { type: "removed" })]), "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([AT()]);
      for (const type of ["correction", "clarification", "update"]) {
        expect(only(rawIssues([correction(at, link, { type })]), "ARTEFACT_FORMAT").map((i) => i.path), type).toEqual([AT()]);
      }
      // REMOVED_TEXT is skipped for the correction that is a removal, and for no other: written as another correction's text it is no DOI
      expect(only(rawIssues([correction(at, REMOVED_TEXT.en)]), "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([AT()]);
    });

    it("is a fixed test: judged with no evidence too, which the engine reports once", () => {
      const issues = draftIssues({ evidence: false, edit: correcting(correction("artefacts.doi.0", "oops")) });
      expect(only(issues, "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([AT()]);
      expect(issues.filter((i) => i.code === "INPUT_MISSING")).toHaveLength(1);
    });

    it("is judged for a correction of any finding the draft names, stored or not in the run's records", () => {
      const edit = correcting(correction("artefacts.doi.0", "oops", { finding_id: "phys-2026-0003" }));
      expect(only(draftIssues({ edit }), "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([AT()]);
    });
  });
});

describe("ARTEFACT_FORMAT, published mode", () => {
  const BADS: [string, string][] = [
    ["doi", "https://doi.org/10.1234/example.1"], ["arxiv", "arXiv:2610.99001"], ["trial", "nct01234567"], ["pdb", "1ABC"],
    ["lean", "http://github.com/example-lab/proofs/blob/main/Sums.lean"],
  ];
  const at = (kind: string): string => `findings/bio-2026-0001.json: artefacts.${kind}[0]`;

  describe.each([["the records being published", true], ["other records", false]] as const)("on %s", (_name, being) => {
    it.each(BADS)("fails the %s %s, as an error", (kind, value) => {
      const issues = publishedIssues([stored({ artefacts: artefactsOf(kind, [value]) }, being)]);
      expect(issues).toHaveLength(1);
      expectIssue(issues, "ARTEFACT_FORMAT", at(kind), [`"${value}" is not in the stored form`]);
    });

    it("passes every form at its limits, and does not look for any artefact in a page", () => {
      const artefacts = {
        doi: ["10.1234/never.shown", "10.123456789/x"], arxiv: ["2610.99001v2"], lean: [LEAN], trial: ["NCT01234567"], pdb: ["1abc", "pdb_00009zz1"],
      };
      expect(publishedIssues([stored({ artefacts }, being)])).toEqual([]);
    });

    it("judges each value of each kind, with the file in the path", () => {
      const artefacts = { doi: ["10.1234/a", "bad"], arxiv: [], lean: ["bad"], trial: [], pdb: ["bad"] };
      const issues = publishedIssues([stored({ artefacts }, being)]);
      expect(issues.map((i) => i.path)).toEqual([
        "findings/bio-2026-0001.json: artefacts.doi[1]", "findings/bio-2026-0001.json: artefacts.lean[0]", "findings/bio-2026-0001.json: artefacts.pdb[0]",
      ]);
    });

    describe("a stored correction's text at an artefact path", () => {
      it.each(BADS)("fails the %s %s, as an error, at the correction's own place in the file", (kind, value) => {
        const issues = publishedIssues([stored({}, being)], { corrections: withRewrite(being, `artefacts.${kind}.0`, value) });
        expect(issues).toHaveLength(1);
        expectIssue(issues, "ARTEFACT_FORMAT", STORED_AFTER, [`"${value}" is not in the stored form`]);
      });

      it("passes every form, and does not look for the artefact in a page", () => {
        const forms: [string, string][] = [["doi", "10.1234/never.shown"], ["arxiv", "2610.99001v2"], ["lean", LEAN], ["trial", "NCT01234567"], ["pdb", "pdb_00009zz1"]];
        for (const [kind, value] of forms) {
          expect(publishedIssues([stored({}, being)], { corrections: withRewrite(being, `artefacts.${kind}.0`, value) }), kind).toEqual([]);
        }
      });

      it("judges it beside the finding's own artefacts, and each correction at its own place", () => {
        const corrections = [
          ...withRewrite(being, "artefacts.doi.0", "oops"), rewrite("C-0004", "explainer.how_sure", "before", "Fine."), rewrite("C-0005", "artefacts.pdb.1", "before", "oops too"),
        ];
        const issues = publishedIssues([stored({ artefacts: artefactsOf("trial", ["bad"]) }, being)], { corrections });
        expect(issues.map((i) => i.path)).toEqual([STORED_AFTER, "corrections.json: corrections[4].after.en", "findings/bio-2026-0001.json: artefacts.trial[0]"]);
      });

      it("reads the English text of `after`, and leaves its Chinese side to the Chinese rules", () => {
        const good = Correction.parse({ ...rewrite("C-0003", "artefacts.doi.0", "before", "10.1234/a"), after: lz("10.1234/a", "oops") });
        expect(publishedIssues([stored({}, being)], { corrections: [...storedCorrections(), good] })).toEqual([]);
        const bad = Correction.parse({ ...rewrite("C-0003", "artefacts.doi.0", "before", "10.1234/a"), after: lz("oops", "10.1234/a") });
        expect(publishedIssues([stored({}, being)], { corrections: [...storedCorrections(), bad] }).map((i) => i.path)).toEqual([STORED_AFTER]);
      });

      it("skips a removed correction whose text is REMOVED_TEXT in both languages, and no other type and no other text", () => {
        const link = "https://doi.org/10.1234/example.1";
        const run = (type: string, after: string, zh: string | null = REMOVED_TEXT.zh): string[] =>
          publishedIssues([stored({}, being)], { corrections: withRewrite(being, "artefacts.doi.0", after, { type, after: { en: after, zh } }) }).map((i) => i.path);
        expect(run("removed", REMOVED_TEXT.en)).toEqual([]);
        // the type alone skips nothing: other text, and a text removed in one language only, are judged like any other
        expect(run("removed", link)).toEqual([STORED_AFTER]);
        expect(run("removed", REMOVED_TEXT.en, null)).toEqual([STORED_AFTER]);
        expect(run("removed", REMOVED_TEXT.en, "別的文字。")).toEqual([STORED_AFTER]);
        for (const type of ["correction", "clarification", "update"]) expect(run(type, link), type).toEqual([STORED_AFTER]);
        expect(run("correction", REMOVED_TEXT.en)).toEqual([STORED_AFTER]);
      });

      it("leaves a correction at any other path to the rules that read that path", () => {
        for (const path of ["explainer.how_sure", "title", "sources.0.url", "reactions.0.quote", "figure.licence_quote"]) {
          expect(publishedIssues([stored({}, being)], { corrections: withRewrite(being, path, "https://doi.org/10.1234/Example.1 and nct01234567") }).filter((i) => i.code === "ARTEFACT_FORMAT"), path).toEqual([]);
        }
      });

      it("reads a path as an artefact's only when it is exactly artefacts, a kind and an index without leading zeros", () => {
        for (const path of ["artefacts.doi.00", "artefacts.doi.01", "artefacts.doi.1.0", "artefacts.doi.0.x", "artefacts.doi.0x", "xartefacts.doi.0", "artefacts.other.0", "artefacts.doi"]) {
          expect(publishedIssues([stored({}, being)], { corrections: withRewrite(being, path, "oops") }).filter((i) => i.code === "ARTEFACT_FORMAT"), path).toEqual([]);
        }
      });
    });
  });

  it("judges a stored finding that the brief does not name, and the records of a run with no brief", () => {
    const loose = storedFinding("math-2026-0009", { artefacts: artefactsOf("pdb", ["BAD"]), first_brief: EARLIER, briefs: [EARLIER] });
    const withBrief = publishedIssues([stored(), loose]);
    expect(withBrief.map((i) => `${i.code} ${i.path}`)).toEqual(["ARTEFACT_FORMAT findings/math-2026-0009.json: artefacts.pdb[0]"]);
    const noBrief = publishedIssues([loose], { brief: null });
    expect(noBrief.map((i) => `${i.code} ${i.path}`)).toEqual(["ARTEFACT_FORMAT findings/math-2026-0009.json: artefacts.pdb[0]"]);
  });

  it("is an error whether or not a date is being published, never an archive warning", () => {
    for (const publishing of [D, null, "2026-12-01"]) {
      const issues = publishedIssues([stored({ artefacts: artefactsOf("pdb", ["BAD"]) })], { publishing });
      expect(issues.map((i) => i.severity)).toEqual(["error"]);
    }
  });

  it("reads no evidence and asks for none: no INPUT_MISSING, and the appearance of an artefact is not judged", () => {
    const issues = publishedIssues([stored({ artefacts: artefactsOf("trial", ["NCT07654321"]) })]);
    expect(issues).toEqual([]);
  });

  it("skips an artefact that a removed correction rewrote, and only that place", () => {
    const artefacts = { doi: ["10.1234/a", REMOVED_TEXT.en], arxiv: [], lean: [REMOVED_TEXT.en], trial: [], pdb: [] };
    const without = publishedIssues([stored({ artefacts })]);
    expect(without.map((i) => i.path)).toEqual([at("doi").replace("doi[0]", "doi[1]"), at("lean")]);
    const one = publishedIssues([stored({ artefacts })], { corrections: [...storedCorrections(), removal("C-0003", "artefacts.lean.0")] });
    expect(one.map((i) => i.path)).toEqual([at("doi").replace("doi[0]", "doi[1]")]);
    const both = publishedIssues([stored({ artefacts })], {
      corrections: [...storedCorrections(), removal("C-0003", "artefacts.lean.0"), removal("C-0004", "artefacts.doi.1")],
    });
    expect(both).toEqual([]);
  });

  it("takes a removal of another finding, or of another place, for no skip", () => {
    const artefacts = { doi: [REMOVED_TEXT.en], arxiv: [], lean: [], trial: [], pdb: [] };
    const other = Correction.parse({ ...removal("C-0003", "artefacts.doi.0"), finding_id: "math-2026-0002" });
    expect(publishedIssues([stored({ artefacts })], { corrections: [...storedCorrections(), other] })).toHaveLength(1);
    expect(publishedIssues([stored({ artefacts })], { corrections: [...storedCorrections(), removal("C-0003", "artefacts.doi.1")] })).toHaveLength(1);
    expect(publishedIssues([stored({ artefacts })], { corrections: [...storedCorrections(), removal("C-0003", "artefacts.lean.0")] })).toHaveLength(1);
  });
});

// ── QUOTE_VERBATIM ───────────────────────────────────────────────────────────────────────────────

/** Where each kind of quote sits in the base draft, which source it cites and the page of that source. */
const PLACES = {
  evidence: { path: "new_findings[0].ai.evidence[0].quote", source: "s1", page: P1, set: (d: Json, q: string) => { d.new_findings[0].ai.evidence[0].quote = q; } },
  reaction: { path: "new_findings[0].reactions[0].quote", source: "s2", page: P2, set: (d: Json, q: string) => { d.new_findings[0].reactions[0].quote = q; } },
  figure: { path: "new_findings[0].figure.licence_quote", source: "s1", page: P1, set: (d: Json, q: string) => { d.new_findings[0].figure.licence_quote = q; } },
} as const;
type Place = keyof typeof PLACES;
const PLACE_NAMES = Object.keys(PLACES) as Place[];

/** A base page with `more` after its text, so that the other quotes and artefacts that cite the page still stand. */
const plus = (url: string, more: string): string => `${baseTexts()[url]}\n${more}`;

/** A draft whose quote at `place` is `quote` and whose cited page holds `page` besides what the base page holds. */
const quoting = (place: Place, quote: string, page: string): Scene => ({
  edit: (d) => PLACES[place].set(d, quote),
  texts: { [PLACES[place].page]: plus(PLACES[place].page, page) },
});

describe("QUOTE_VERBATIM, draft mode", () => {
  describe.each(PLACE_NAMES)("the %s quote", (place) => {
    const spot = PLACES[place];

    it("passes when its source's page holds it, with other words around it", () => {
      expect(only(draftIssues(quoting(place, "exact words here", "Before. The exact words here, said she.")), "QUOTE_VERBATIM")).toEqual([]);
    });

    it("fails when its source's page does not hold it, naming the source and its address", () => {
      const issues = draftIssues(quoting(place, "words that are not there", "A page about something else."));
      const issue = expectIssue(issues, "QUOTE_VERBATIM", spot.path, [`not in the fetched text of ${spot.source} (${spot.page})`, "word for word"]);
      expect(only(issues, "QUOTE_VERBATIM")).toHaveLength(1);
      expect(issue.message).not.toContain("it is in the text of");
    });

    it("fails a quote that is in another source of the finding, and names that source", () => {
      const other = spot.page === P1 ? P2 : P1;
      const issues = draftIssues({ edit: (d) => spot.set(d, "words from the other page"), texts: { [other]: plus(other, "Here: words from the other page.") } });
      expect(only(issues, "QUOTE_VERBATIM")).toHaveLength(1);
      const issue = expectIssue(issues, "QUOTE_VERBATIM", spot.path, [`not in the fetched text of ${spot.source}`]);
      expect(issue.message).toContain(`; it is in the text of ${other === P1 ? "s1" : "s2"}.`);
    });

    it("says when the source's page has no fetched text, which is not the same as a page without the quote", () => {
      const issues = draftIssues({ edit: (d) => spot.set(d, "any words"), texts: { [spot.page]: null } });
      const issue = expectIssue(issues, "QUOTE_VERBATIM", spot.path, [`cites ${spot.source} (${spot.page}), whose page has no fetched text`]);
      expect(issue.message).not.toContain("not in the fetched text");
      const blank = draftIssues({ edit: (d) => spot.set(d, "any words"), texts: { [spot.page]: " \n " } });
      expectIssue(blank, "QUOTE_VERBATIM", spot.path, ["whose page has no fetched text"]);
    });

    it("fails a quote that is nothing but quotation marks and spaces, in one issue of its own", () => {
      const issues = draftIssues(quoting(place, `${LDQ} ${RDQ} "`, "A page."));
      expect(only(issues, "QUOTE_VERBATIM")).toHaveLength(1);
      expectIssue(issues, "QUOTE_VERBATIM", spot.path, ["has no words once spaces, quotation marks and invisible characters are set aside"]);
    });

    it("passes a quote of 25 words and fails one of 26 for its length alone, in both modes of the match", () => {
      const ok = draftIssues(quoting(place, words(25), `Page: ${words(25)}.`));
      expect(only(ok, "QUOTE_VERBATIM")).toEqual([]);
      const long = draftIssues(quoting(place, words(26), `Page: ${words(26)}.`));
      expect(only(long, "QUOTE_VERBATIM")).toHaveLength(1);
      expectIssue(long, "QUOTE_VERBATIM", spot.path, ["The quote has 26 words; the limit is 25.", "Quote a shorter passage"]);
      const noEvidence = draftIssues({ ...quoting(place, words(26), ""), evidence: false });
      expectIssue(noEvidence, "QUOTE_VERBATIM", spot.path, ["The quote has 26 words"]);
    });

    it("reports both problems of a quote that is too long and not in the page", () => {
      const issues = only(draftIssues(quoting(place, words(30), "A page.")), "QUOTE_VERBATIM");
      expect(issues.map((i) => i.message.slice(0, 20))).toEqual(["The quote has 30 wor", "The quote is not in "]);
      expect(new Set(issues.map((i) => i.path))).toEqual(new Set([spot.path]));
    });

    it("counts a number or a hyphenated word as one word, and a link as none", () => {
      const quote = `${words(23)} state-of-the-art 1,500`;
      expect(only(draftIssues(quoting(place, quote, `Page: ${quote}.`)), "QUOTE_VERBATIM")).toEqual([]);
      const withLink = `${words(25)} https://example.org/a/b?c=d`;
      expect(only(draftIssues(quoting(place, withLink, `Page: ${withLink}.`)), "QUOTE_VERBATIM")).toEqual([]);
    });

    it("counts a Han, Hiragana, Katakana or Hangul character as half a word: 50 of them pass and 51 fail, as the page holds them", () => {
      for (const name of SCRIPTS) {
        const ok = script(name, 50);
        expect(only(draftIssues(quoting(place, ok, `Page: ${ok}.`)), "QUOTE_VERBATIM"), name).toEqual([]);
        const long = script(name, 51);
        const issues = draftIssues(quoting(place, long, `Page: ${long}.`));
        expect(only(issues, "QUOTE_VERBATIM"), name).toHaveLength(1);
        const issue = expectIssue(issues, "QUOTE_VERBATIM", spot.path, ["The quote has 26 words; the limit is 25."]);
        expect(issue.hint).toContain("a Chinese, Japanese or Korean character counts as half a word");
      }
    });

    it("adds the characters to the words beside them in one count", () => {
      const ok = `${words(10)} ${script("han", 30)}`;
      expect(only(draftIssues(quoting(place, ok, `Page: ${ok}.`)), "QUOTE_VERBATIM")).toEqual([]);
      const long = `${words(10)} ${script("han", 31)}`;
      const issues = draftIssues(quoting(place, long, `Page: ${long}.`));
      expectIssue(issues, "QUOTE_VERBATIM", spot.path, ["The quote has 26 words; the limit is 25."]);
    });
  });

  describe("after the normalisation of lib/text.ts", () => {
    // [the quote, the page's words, matches]
    const FOLDS: [string, string, string, boolean][] = [
      ["case", "The System Solved It", "the system solved it", true],
      ["straight quotation marks", '"the system solved it"', "the system solved it", true],
      ["curly quotation marks", `${LDQ}the system solved it${RDQ}`, "the system solved it", true],
      ["quotation marks inside the page's words", "the system solved it", `${LDQ}the system${RDQ} solved it`, true],
      ["an apostrophe, straight or curly", `it${RSQ}s done`, "it's done", true],
      ["a hyphen against a dash or a minus sign", "state-of-the-art", `state${EN}of${EM}the${HY}art`, true],
      ["a dash against a hyphen", `state${EM}of${NBH}the${MINUS}art`, "state-of-the-art", true],
      ["runs of spaces and line breaks", "the  system\n\nsolved\t it", "the system solved it", true],
      ["a no-break space", `the${NBSP}system solved it`, "the system solved it", true],
      ["full-width letters, by NFKC", `${FULL_T}${FULL_H}${FULL_E} system solved it`, "the system solved it", true],
      ["a zero-width space or a soft hyphen in the page", "the system solved it", `the sys${ZWSP}tem sol${SHY}ved it`, true],
      ["a zero-width space in the quote", `the sys${ZWSP}tem solved it`, "the system solved it", true],
      ["one word changed", "the system solves it", "the system solved it", false],
      ["a word added inside", "the system quickly solved it", "the system solved it", false],
      ["words reordered", "solved it the system", "the system solved it", false],
      ["a word missing", "the system solved", "the system solved it", true],
      ["a bracketed insertion", "the [AI] system solved it", "the system solved it", false],
      ["an ellipsis for words left out", "the system ... solved it", "the system solved it", false],
      ["a longer quote than the page's words", "the system solved it quickly", "the system solved it", false],
    ];
    it.each(FOLDS)("%s: quote %j against page %j", (_name, quote, page, matches) => {
      const issues = only(draftIssues(quoting("evidence", quote, `A page. ${page} The end.`)), "QUOTE_VERBATIM");
      if (matches) expect(issues).toEqual([]);
      else expect(issues).toHaveLength(1);
    });

    it("builds its dashes from code points, so that none is typed in this file", () => {
      expect([EM, EN, HY, NBH, MINUS].map((c) => c.charCodeAt(0))).toEqual([0x2014, 0x2013, 0x2010, 0x2011, 0x2212]);
    });
  });

  describe("the source a quote is held to", () => {
    it("is the source the quote cites, found by its id among the finding's own sources", () => {
      // The quote is on the page of s1 and not on that of s2, which it cites.
      const issues = draftIssues({ edit: (d) => { d.new_findings[0].ai.evidence[0].source_id = "s2"; } });
      expect(only(issues, "QUOTE_VERBATIM")).toHaveLength(1);
      expectIssue(issues, "QUOTE_VERBATIM", PLACES.evidence.path, ["not in the fetched text of s2", "it is in the text of s1"]);
    });

    it("is the page of the quote's own source when two sources share the quote", () => {
      const issues = draftIssues({
        edit: (d) => { d.new_findings[0].ai.evidence[0].source_id = "s2"; },
        texts: { [P2]: plus(P2, "The system solved it, they said.") },
      });
      expect(only(issues, "QUOTE_VERBATIM")).toEqual([]);
    });

    it("is found by its normalised URL", () => {
      const issues = draftIssues({ edit: (d) => { d.new_findings[0].sources[0].url = "https://www.example.org/paper/1/?utm_medium=x"; } });
      expect(only(issues, "QUOTE_VERBATIM")).toEqual([]);
    });

    it("is the finding's own, so that the quotes of two findings are held to their own pages", () => {
      const second = (d: Json): void => {
        const g = d.new_findings[1];
        g.ai = { role: "ai_tool", confidence: "claimed", systems: [{ name: "Sample System Two", maker: "Example Lab" }], evidence: [{ source_id: "s1", quote: "the second finding says so", from_claimant: true }] };
        g.explainer.ai_helped = "Sample System Two, from Example Lab, did the work.";
      };
      // The second finding's s1 is the page at P7; the quote is there, and the first finding's page at P1 does not hold it.
      const own = draftIssues({ edit: second, texts: { [P7]: plus(P7, "The second finding says so.") } });
      expect(only(own, "QUOTE_VERBATIM")).toEqual([]);
      // The quote is on the first finding's page, which is not the second finding's source.
      const apart = draftIssues({ edit: second, texts: { [P1]: plus(P1, "The second finding says so.") } });
      expect(only(apart, "QUOTE_VERBATIM")).toHaveLength(1);
      expectIssue(apart, "QUOTE_VERBATIM", "new_findings[1].ai.evidence[0].quote", ["not in the fetched text of s1 (https://example.org/paper/7)"]);
    });

    it("leaves a quote whose id names no source to SOURCE_IDS, with no issue of its own", () => {
      const issues = draftIssues({
        edit: (d) => {
          d.new_findings[0].ai.evidence[0].source_id = "s9";
          d.new_findings[0].reactions[0].source_id = "s8";
          d.new_findings[0].figure.source_id = "s7";
        },
        texts: { [P1]: "Nothing.", [P2]: "Nothing." },
      });
      expect(only(issues, "QUOTE_VERBATIM")).toEqual([]);
    });
  });

  describe("the quotes it reads", () => {
    it("reads the three kinds of quote of every new finding, and no other string", () => {
      const issues = only(draftIssues({
        edit: (d) => {
          const f = d.new_findings[0];
          f.ai.evidence[0].quote = "evidence words that are absent";
          f.reactions[0].quote = "reaction words that are absent";
          f.figure.licence_quote = "licence words that are absent";
          f.title = "A title that no page holds";
          f.explainer.found = "Found text that no page holds.";
          f.reactions[0].who = "A name that no page holds";
          f.sources[0].title = "A source title that no page holds";
          d.ideas[0].text = "An idea that no page holds.";
        },
      }), "QUOTE_VERBATIM");
      expect(issues.map((i) => i.path)).toEqual([PLACES.evidence.path, PLACES.figure.path, PLACES.reaction.path]);
    });

  });

  describe("a correction's text at a quote path", () => {
    // A correction of `reactions.0.quote` puts its `after` in the finding's record, so it is held to the 25 words too. No page is asked
    // about it: the correction names no source whose page should hold the new quote.
    const QUOTE_PATHS = ["ai.evidence.0.quote", "reactions.0.quote", "figure.licence_quote"];
    const AT = (i = 0): string => `corrections[${i}].after`;

    it.each(QUOTE_PATHS)("holds a correction of %s to 25 words: 25 pass, 26 fail at the correction's own `after`", (path) => {
      const ok = draftIssues({ edit: correcting(correction(path, words(25))) });
      expect(ok.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
      expect(only(ok, "QUOTE_VERBATIM")).toEqual([]);
      const long = draftIssues({ edit: correcting(correction(path, words(26))) });
      expect(only(long, "QUOTE_VERBATIM")).toHaveLength(1);
      const issue = expectIssue(long, "QUOTE_VERBATIM", AT(), ["The quote has 26 words; the limit is 25.", "Quote a shorter passage, still word for word."]);
      expect(issue.hint).toContain("at most 25 words (SPEC §4.3)");
    });

    it("says what it says of a finding's quote of the same length, with the same hint", () => {
      const onFinding = only(draftIssues({ ...quoting("evidence", words(40), `Page: ${words(40)}.`) }), "QUOTE_VERBATIM");
      const onCorrection = only(draftIssues({ edit: correcting(correction("ai.evidence.0.quote", words(40))) }), "QUOTE_VERBATIM");
      expect(onFinding).toHaveLength(1);
      expect(onCorrection.map((i) => [i.message, i.hint, i.severity])).toEqual(onFinding.map((i) => [i.message, i.hint, i.severity]));
    });

    it("does not look for the new quote in a page: it is judged for its length alone", () => {
      const issues = draftIssues({ edit: correcting(correction("reactions.0.quote", "words that no page of the run holds")) });
      expect(only(issues, "QUOTE_VERBATIM")).toEqual([]);
      expect(issues.filter((i) => i.code === "INPUT_MISSING")).toEqual([]);
    });

    it("judges each correction at its own place in the list, beside the finding's own quotes", () => {
      const issues = draftIssues({
        edit: (d) => {
          PLACES.reaction.set(d, words(26));
          correcting(
            correction("explainer.how_sure", words(40)), correction("figure.licence_quote", words(30)), correction("reactions.0.quote", words(25)),
            correction("ai.evidence.0.quote", words(27)),
          )(d);
        },
        texts: { [P2]: plus(P2, words(26)) },
      });
      expect(only(issues, "QUOTE_VERBATIM").map((i) => `${i.path}: ${i.message.slice(0, 20)}`)).toEqual([
        `${AT(1)}: The quote has 30 wor`, `${AT(3)}: The quote has 27 wor`, `${PLACES.reaction.path}: The quote has 26 wor`,
      ]);
    });

    it("reads the `after` and nothing else of a correction", () => {
      const edit = correcting(correction("reactions.0.quote", "short words", { reason: words(30), source_url: `https://example.org/${words(40)}` }));
      expect(only(draftIssues({ edit }), "QUOTE_VERBATIM")).toEqual([]);
    });

    it("leaves a correction at any other path to the rules that read that path", () => {
      for (const path of ["explainer.how_sure", "title", "sources.0.url", "reactions.0.who", "reactions.0.affiliation", "artefacts.doi.0", "figure.credit", "figure.alt", "since_then.0.text", "rung_history.0.note"]) {
        const issues = draftIssues({ edit: correcting(correction(path, words(40))) });
        expect(only(issues, "QUOTE_VERBATIM"), path).toEqual([]);
      }
    });

    it("reads a path as a quote's only when it is exactly one of the three places, with an index without leading zeros", () => {
      const near = [
        "reactions.00.quote", "reactions.01.quote", "reactions.-1.quote", "reactions.0.quote.x", "xreactions.0.quote", "reactions.0.quotes", "reactions.0",
        "reactions.a.quote", "reactions..quote", "reactions.0.quote ", "ai.evidence.00.quote", "ai.evidence.0.quote.x", "xai.evidence.0.quote", "ai.evidence.0",
        "ai.evidence.0.source_id", "xfigure.licence_quote", "figure.licence_quote.x", "figure.licence", "figure.licence_quote ", "figure.licence_quote\n",
      ];
      const issues = rawIssues(near.map((path) => correction(path, words(40))));
      expect(issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
      expect(only(issues, "QUOTE_VERBATIM")).toEqual([]);
    });

    it("skips a removed correction whose text is REMOVED_TEXT, and no other type and no other text", () => {
      for (const path of QUOTE_PATHS) {
        expect(only(rawIssues([correction(path, REMOVED_TEXT.en, { type: "removed" })]), "QUOTE_VERBATIM"), path).toEqual([]);
        // the type alone skips nothing: a removed correction that holds other text is judged like any other
        expect(only(rawIssues([correction(path, words(40), { type: "removed" })]), "QUOTE_VERBATIM").map((i) => i.path), path).toEqual([AT()]);
        for (const type of ["correction", "clarification", "update"]) {
          expect(only(rawIssues([correction(path, words(40), { type })]), "QUOTE_VERBATIM").map((i) => i.path), `${path} ${type}`).toEqual([AT()]);
        }
      }
    });

    it("is a fixed test: judged with no evidence too, which the engine reports once", () => {
      const issues = draftIssues({ evidence: false, edit: correcting(correction("reactions.0.quote", words(26))) });
      expect(only(issues, "QUOTE_VERBATIM").map((i) => i.path)).toEqual([AT()]);
      expect(issues.filter((i) => i.code === "INPUT_MISSING")).toHaveLength(1);
    });
  });

  describe("the run's evidence", () => {
    it("is not needed for the limit of 25 words, and the match is left unjudged, with one INPUT_MISSING warning", () => {
      const issues = draftIssues({
        evidence: false,
        edit: (d) => {
          PLACES.evidence.set(d, "words that no page holds");
          PLACES.reaction.set(d, words(26));
        },
      });
      expect(only(issues, "QUOTE_VERBATIM").map((i) => i.path)).toEqual([PLACES.reaction.path]);
      expect(issues.filter((i) => i.code === "INPUT_MISSING")).toHaveLength(1);
    });

    it("holds a quote from the part of a page beyond the pack's abstract, where the evidence text is the pack's then the snapshot's", () => {
      const pack = "A made-up abstract of 1,000 characters at most.";
      const snapshot = "Methods. Results. The reviewer wrote that this is exactly the words that only the page itself holds.";
      const issues = draftIssues(quoting("reaction", "exactly the words that only the page itself holds", `${pack}\n${snapshot}`));
      expect(only(issues, "QUOTE_VERBATIM")).toEqual([]);
    });
  });
});

describe("QUOTE_VERBATIM, published mode", () => {
  const QUOTES: [string, string, (q: string) => Json][] = [
    ["evidence", "findings/bio-2026-0001.json: ai.evidence[0].quote", (q) => ({ ai: { role: "ai_solved", confidence: "confirmed", systems: [{ name: "Sample System 3", maker: "Example Lab" }], evidence: [{ source_id: "s1", quote: q, from_claimant: false }] } })],
    ["reaction", "findings/bio-2026-0001.json: reactions[0].quote", (q) => ({ reactions: [{ source_id: "s2", who: "A. Reviewer", affiliation: "Example University", quote: q }] })],
    ["figure", "findings/bio-2026-0001.json: figure.licence_quote", (q) => ({
      figure: {
        source_id: "s1", image_url: "https://example.org/fig/1.png", licence: "CC-BY-4.0", licence_quote: q, credit: "Figure 1",
        alt: lz("A made-up chart.", "範例圖表。"),
      },
    })],
  ];

  describe.each([["the records being published", true], ["other records", false]] as const)("on %s", (_name, being) => {
    describe.each(QUOTES)("the %s quote", (_kind, path, over) => {
      it("passes at 25 words and fails at 26, as an error, with no page to match it against", () => {
        expect(publishedIssues([stored(over(words(25)), being)])).toEqual([]);
        const issues = publishedIssues([stored(over(words(26)), being)]);
        expect(issues).toHaveLength(1);
        expectIssue(issues, "QUOTE_VERBATIM", path, ["The quote has 26 words; the limit is 25."]);
      });

      it("is not matched against a page, so a quote that no page holds passes and no input is missing", () => {
        expect(publishedIssues([stored(over("words that no page ever held"), being)])).toEqual([]);
      });

      it("is judged as usual when a removed correction names its place but the record still holds other text there, and passes holding REMOVED_TEXT", () => {
        const at = path.split(": ")[1]!.replace(/\[(\d+)\]/g, ".$1");
        const finding = stored(over(words(40)), being);
        expect(publishedIssues([finding])).toHaveLength(1);
        expect(publishedIssues([finding], { corrections: [...storedCorrections(), removal("C-0003", at)] })).toHaveLength(1);
        expect(publishedIssues([stored(over(REMOVED_TEXT.en), being)], { corrections: [...storedCorrections(), removal("C-0003", at)] })).toEqual([]);
      });

      it("counts a Han, Hiragana, Katakana or Hangul character as half a word: 50 of them pass and 51 fail", () => {
        for (const name of SCRIPTS) {
          expect(publishedIssues([stored(over(script(name, 50)), being)]), name).toEqual([]);
          const issues = publishedIssues([stored(over(script(name, 51)), being)]);
          expect(issues, name).toHaveLength(1);
          expectIssue(issues, "QUOTE_VERBATIM", path, ["The quote has 26 words; the limit is 25."]);
        }
      });

      describe("a stored correction's text at its path", () => {
        const at = path.split(": ")[1]!.replace(/\[(\d+)\]/g, ".$1");

        it("is held to the same 25 words: 25 pass, 26 fail at the correction's own place in the file", () => {
          const finding = stored(over("short words"), being);
          expect(publishedIssues([finding], { corrections: withRewrite(being, at, words(25)) })).toEqual([]);
          const issues = publishedIssues([finding], { corrections: withRewrite(being, at, words(26)) });
          expect(issues).toHaveLength(1);
          expectIssue(issues, "QUOTE_VERBATIM", STORED_AFTER, ["The quote has 26 words; the limit is 25.", "Quote a shorter passage"]);
        });

        it("counts a Han character as half a word there too", () => {
          const finding = stored(over("short words"), being);
          expect(publishedIssues([finding], { corrections: withRewrite(being, at, script("han", 50)) })).toEqual([]);
          expectIssue(publishedIssues([finding], { corrections: withRewrite(being, at, script("han", 51)) }), "QUOTE_VERBATIM", STORED_AFTER, ["The quote has 26 words"]);
        });

        it("is not looked for in a page, and its English text is the one read", () => {
          const finding = stored(over("short words"), being);
          expect(publishedIssues([finding], { corrections: withRewrite(being, at, "words that no page ever held") })).toEqual([]);
          const shortEn = Correction.parse({ ...rewrite("C-0003", at, "before", "short"), after: lz("short", words(40)) });
          expect(publishedIssues([finding], { corrections: [...storedCorrections(), shortEn] })).toEqual([]);
          const longEn = Correction.parse({ ...rewrite("C-0003", at, "before", "short"), after: lz(words(40), "short") });
          expectIssue(publishedIssues([finding], { corrections: [...storedCorrections(), longEn] }), "QUOTE_VERBATIM", STORED_AFTER, ["The quote has 40 words"]);
        });

        it("is judged beside the finding's own quote, and each correction at its own place", () => {
          const corrections = [...withRewrite(being, at, words(30)), rewrite("C-0004", "explainer.how_sure", "before", words(40)), rewrite("C-0005", at, "before", words(27))];
          const issues = publishedIssues([stored(over(words(26)), being)], { corrections });
          expect(issues.map((i) => i.path)).toEqual([STORED_AFTER, "corrections.json: corrections[4].after.en", path]);
        });

        it("is skipped when the correction is a removed one whose text is REMOVED_TEXT in both languages, and for no other type and no other text", () => {
          const finding = stored(over("short words"), being);
          const run = (type: string, after: string, zh: string | null = REMOVED_TEXT.zh): string[] =>
            publishedIssues([finding], { corrections: withRewrite(being, at, after, { type, after: { en: after, zh } }) }).map((i) => i.path);
          expect(run("removed", REMOVED_TEXT.en)).toEqual([]);
          // the type alone skips nothing: a long text is judged like any other, whatever its Chinese side holds
          expect(run("removed", words(40))).toEqual([STORED_AFTER]);
          expect(run("removed", words(40), null)).toEqual([STORED_AFTER]);
          expect(run("removed", words(40), "別的文字。")).toEqual([STORED_AFTER]);
          for (const type of ["correction", "clarification", "update"]) expect(run(type, words(40)), type).toEqual([STORED_AFTER]);
        });

        it("is read at that path alone: another path, and a path that only looks like it, are not quotes", () => {
          const finding = stored(over("short words"), being);
          for (const other of ["explainer.how_sure", "title", "artefacts.doi.0", "sources.0.url", "since_then.0.text", "rung_history.0.note", "figure.credit", "reactions.0.who", `${at}.x`, `x${at}`, `${at}x`]) {
            expect(publishedIssues([finding], { corrections: withRewrite(being, other, words(40)) }).filter((i) => i.code === "QUOTE_VERBATIM"), other).toEqual([]);
          }
        });
      });
    });
  });

  it("counts words as the draft does: a number or a hyphenated word is one, a link none", () => {
    const issues = publishedIssues([stored({ reactions: [{ source_id: "s2", who: "A. Reviewer", affiliation: "Example University", quote: `${words(23)} state-of-the-art 1,500` }] })]);
    expect(issues).toEqual([]);
  });

  it("is an error whether or not a date is being published, never an archive warning", () => {
    for (const publishing of [D, null]) {
      const issues = publishedIssues([stored({ reactions: [{ source_id: "s2", who: "A. Reviewer", affiliation: "Example University", quote: words(26) }] })], { publishing });
      expect(issues.map((i) => i.severity)).toEqual(["error"]);
    }
  });

  it("judges a stored finding that the brief does not name", () => {
    const loose = storedFinding("math-2026-0009", { reactions: [{ source_id: "s2", who: "A. Reviewer", affiliation: "Example University", quote: words(26) }], first_brief: EARLIER, briefs: [EARLIER] });
    expect(publishedIssues([stored(), loose]).map((i) => i.path)).toEqual(["findings/math-2026-0009.json: reactions[0].quote"]);
    expect(publishedIssues([loose], { brief: null }).map((i) => i.path)).toEqual(["findings/math-2026-0009.json: reactions[0].quote"]);
  });
});

// ── The words of a quote ─────────────────────────────────────────────────────────────────────────

describe("quoteWords(): the words of a quote", () => {
  it("is countWords() of a text with no Han, Hiragana, Katakana or Hangul letter or number", () => {
    const thai = chars(0x0e01, 0x0e02, 0x0e03).repeat(10);
    const texts = [
      "", " ", "one", "one two", "state-of-the-art 1,500", "a b  c\nd\te", words(25), `${words(25)} https://example.org/a/b?c=d`, "https://example.org/only a link",
      `- ${EM} ${EN} ..`, `col${chars(0xb7)}legi`, `Vi${chars(0x1ec7)}t Nam`, `Vie${chars(0x323, 0x302)}t Nam`, `a${chars(0x305)}b`,
      `${chars(0xff12, 0xff10, 0xff12, 0xff16)} years`, thai, chars(0x3105, 0x3106, 0x3107).repeat(10),
    ];
    for (const text of texts) expect(quoteWords(text), JSON.stringify(text)).toBe(countWords(text));
    expect(quoteWords(thai)).toBe(1);
  });

  it("counts a Han character as half a word, rounded up", () => {
    const expected: [number, number][] = [[1, 1], [2, 1], [3, 2], [4, 2], [49, 25], [50, 25], [51, 26], [52, 26], [100, 50], [101, 51]];
    for (const [n, count] of expected) expect(quoteWords(script("han", n)), `${n} characters`).toBe(count);
  });

  it("counts a Hiragana, Katakana or Hangul character the same way", () => {
    for (const name of ["hiragana", "katakana", "hangul"] as const) {
      const expected: [number, number][] = [[1, 1], [2, 1], [3, 2], [24, 12], [50, 25], [51, 26]];
      for (const [n, count] of expected) expect(quoteWords(script(name, n)), `${name} ${n}`).toBe(count);
    }
  });

  it("counts the characters of the four scripts together, and in a run however it is spaced", () => {
    expect(quoteWords(script("han", 1) + script("hiragana", 1) + script("katakana", 1))).toBe(2);
    expect(quoteWords(script("han", 1) + script("hiragana", 1) + script("katakana", 1) + script("hangul", 1))).toBe(2);
    expect(quoteWords(script("han", 1) + script("hiragana", 1) + script("katakana", 1) + script("hangul", 2))).toBe(3);
    const four = script("han", 4);
    expect(quoteWords(four)).toBe(2);
    expect(quoteWords(Array.from(four).join(" "))).toBe(2);
    expect(quoteWords(Array.from(four).join("  \n"))).toBe(2);
    expect(quoteWords(`${four.slice(0, 2)} ${four.slice(2)}`)).toBe(2);
  });

  it("adds the words around the characters, set apart or glued to them, and a Latin word beside a character is a word of its own", () => {
    expect(quoteWords(`AI ${script("han", 4)}`)).toBe(3);
    expect(quoteWords(`AI${script("han", 4)}`)).toBe(3);
    expect(quoteWords(`${script("han", 2)}AI${script("han", 2)}`)).toBe(3);
    expect(quoteWords(`word${script("han", 1)}word`)).toBe(3);
    expect(quoteWords(`${words(24)} ${script("han", 2)}`)).toBe(25);
    expect(quoteWords(`${words(24)} ${script("han", 3)}`)).toBe(26);
  });

  it("counts the punctuation of these scripts as nothing", () => {
    const stops = chars(0x3001, 0x3002, 0xff0c, 0xff01, 0xff1f, 0xff1a, 0xff1b, 0x300c, 0x300d, 0x300e, 0x300f, 0xff08, 0xff09, 0x3010, 0x3011, 0x30fb, 0x2026, 0xb7, 0x3003);
    expect(quoteWords(stops)).toBe(0);
    expect(quoteWords(`${script("han", 2)}${chars(0x3002)}`)).toBe(1);
    expect(quoteWords(`${chars(0x300c)}${script("han", 2)}${chars(0x3002, 0x300d)}`)).toBe(1);
    expect(quoteWords(Array.from(script("han", 6)).join(chars(0x3001)))).toBe(3);
  });

  it("counts the prolonged sound mark, the iteration mark and the ideographic zero with the script they belong to", () => {
    expect(quoteWords(chars(0x30fc).repeat(3))).toBe(2);
    expect(quoteWords(chars(0x3005).repeat(3))).toBe(2);
    expect(quoteWords(chars(0x3007).repeat(3))).toBe(2);
    expect(quoteWords(`${script("katakana", 1)}${chars(0x30fc)}`)).toBe(1);
  });

  it("counts the ideographic numerals and marks that are Han only by script extensions, one character each", () => {
    // Common by script, Han by script extensions: the closing mark, the parenthesized and circled ideograph numbers, the Kanbun
    // annotation numbers and the counting rod numerals. Read by script alone they would count nothing, though they show as Han text.
    for (const code of [0x3006, 0x3192, 0x3195, 0x3220, 0x3229, 0x3280, 0x3289, 0x1d360, 0x1d371]) {
      expect(quoteWords(chars(code).repeat(3)), code.toString(16)).toBe(2);
      expect(quoteWords(chars(code).repeat(50)), code.toString(16)).toBe(25);
      expect(quoteWords(chars(code).repeat(51)), code.toString(16)).toBe(26);
    }
  });

  it("counts the marks of Hiragana and Katakana by their script extensions, each from both scripts' lists", () => {
    // The vertical kana repeat marks, the masu mark, the prolonged sound mark and its half-width form.
    for (const code of [0x3031, 0x3035, 0x303c, 0x30fc, 0xff70]) expect(quoteWords(chars(code).repeat(3)), code.toString(16)).toBe(2);
  });

  describe("reads the text in NFKC, the form a quote is compared in", () => {
    it("counts a squared or enclosed compatibility character as the letters it stands for", () => {
      // U+3314 is the katakana word kiro in one box, U+337F four Han characters, U+3231 a Han character in brackets.
      expect(quoteWords(chars(0x3314).repeat(25))).toBe(25);
      expect(quoteWords(chars(0x3314).repeat(26))).toBe(26);
      expect(quoteWords(chars(0x337f).repeat(12))).toBe(24);
      expect(quoteWords(chars(0x337f).repeat(13))).toBe(26);
      expect(quoteWords(chars(0x3231).repeat(50))).toBe(25);
      expect(quoteWords(chars(0x3231).repeat(51))).toBe(26);
      // The era name Reiwa in one box stands for two Han characters.
      expect(quoteWords(chars(0x32ff).repeat(25))).toBe(25);
      expect(quoteWords(chars(0x32ff).repeat(26))).toBe(26);
    });

    it("counts a Kangxi radical, a CJK radical and a circled ideograph as the Han character each stands for", () => {
      // These are symbols by category, so they would count nothing, though each shows as, and folds to, one Han character.
      for (const code of [0x2f00, 0x2e9f, 0x2ef3, 0x3299]) {
        expect(quoteWords(chars(code).repeat(50)), code.toString(16)).toBe(25);
        expect(quoteWords(chars(code).repeat(51)), code.toString(16)).toBe(26);
      }
    });

    it("counts a unit sign or a circled letter as the Latin word it stands for", () => {
      const kilo = chars(0x338f); // the kilogram sign
      expect(quoteWords(`${kilo} `.repeat(25))).toBe(25);
      expect(quoteWords(`${kilo} `.repeat(26))).toBe(26);
      expect(quoteWords(`${chars(0x24b6)}${chars(0x24b7)} `.repeat(26))).toBe(26);
    });

    it("counts a half-width kana with its voiced mark, and a decomposed Hangul syllable, as the one character each makes", () => {
      const ga = chars(0xff76, 0xff9e); // half-width ka and the half-width voiced mark: one character, ga
      expect(quoteWords(ga.repeat(50))).toBe(25);
      expect(quoteWords(ga.repeat(51))).toBe(26);
      const hangul = script("hangul", 3).normalize("NFD");
      expect(Array.from(hangul).length).toBeGreaterThan(3);
      expect(quoteWords(hangul)).toBe(2);
      for (const [n, count] of [[50, 25], [51, 26]] as const) expect(quoteWords(script("hangul", n).normalize("NFD")), `${n} syllables`).toBe(count);
    });

    it("counts a full-width Latin letter or digit as it does the ASCII one", () => {
      expect(quoteWords(`${chars(0xff21, 0xff29)} ${chars(0xff4d, 0xff4f, 0xff44, 0xff45, 0xff4c)} ${chars(0xff12, 0xff10, 0xff12, 0xff16)}`)).toBe(3);
      expect(quoteWords(`${chars(0xff21, 0xff29)}${script("han", 4)}`)).toBe(3);
    });

    it("reads a full-width address as the link it is", () => {
      const full = "https://example.org/a".replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
      expect(quoteWords(full)).toBe(0);
      expect(quoteWords(`${full} one two`)).toBe(2);
      // A link takes the Han characters that touch it, written in full-width letters as in ASCII (the same as the ASCII case below).
      expect(quoteWords(`${full}${script("han", 10)}`)).toBe(0);
      expect(quoteWords(`${script("han", 2)} ${full}${script("han", 10)} ${script("han", 2)}`)).toBe(2);
    });
  });

  it("counts a half-width Katakana letter, a Hangul compatibility letter, a conjoining Jamo and a character beyond the Basic plane as one character each", () => {
    for (const first of [0xff71, 0x3131, 0x1100, 0x20000, 0xf900]) expect(quoteWords(chars(first, first + 1, first + 2)), first.toString(16)).toBe(2);
  });

  it("leaves a link out, as countWords() does", () => {
    expect(quoteWords(`https://example.org/${script("han", 10)}`)).toBe(0);
    expect(quoteWords(`${script("han", 2)} https://example.org/${script("han", 10)} ${script("han", 2)}`)).toBe(2);
  });

  it("does not throw on a half of a surrogate pair or a noncharacter, which count nothing, and counts the words beside them", () => {
    for (const odd of [chars(0xd800), chars(0xdc00), chars(0xfffe), chars(0xffff), chars(0xd800, 0x20)]) {
      expect(quoteWords(odd), odd.charCodeAt(0).toString(16)).toBe(0);
      expect(quoteWords(`one ${odd}${script("han", 2)} two`), odd.charCodeAt(0).toString(16)).toBe(3);
    }
  });

  it("is the same on a second call: it keeps no state between texts", () => {
    const text = `${words(3)} ${script("han", 5)}`;
    expect([quoteWords(text), quoteWords(text), quoteWords("plain words here")]).toEqual([6, 6, 3]);
  });
});

// ── NUMBER_SOURCED ───────────────────────────────────────────────────────────────────────────────

const FOUND = "new_findings[0].explainer.found";

/** The NUMBER_SOURCED issues of a draft whose first finding's `found` is `prose`, with `pages` over the base pages. */
const numbersIn1 = (prose: string, pages: Record<string, string | null> = {}, scene: Scene = {}): ValidationIssue[] =>
  only(draftIssues({ ...scene, edit: (d) => { d.new_findings[0].explainer.found = prose; scene.edit?.(d); }, texts: { ...scene.texts, ...pages } }), "NUMBER_SOURCED");

/** The numbers that the issue at `FOUND` says are missing, in order; [] when there is none. */
function missingAt(issues: readonly ValidationIssue[], path = FOUND): string[] {
  const found = issues.filter((i) => i.path === path);
  if (found.length === 0) return [];
  expect(found).toHaveLength(1);
  const m = /^This text holds (.+?), (?:which|but) /.exec(found[0]!.message);
  expect(m, found[0]!.message).not.toBeNull();
  return m![1]!.split(", ");
}

describe("NUMBER_SOURCED, draft mode", () => {
  describe("the matching rule: Cyber's, by lib/text.ts", () => {
    // [the prose, the page, the numbers of the prose that no page shows]
    const MATCHES: [string, string, string[]][] = [
      ["We measured 2,000 samples.", "Our run took 2000 samples in all.", []],
      ["We measured 2000 samples.", "Our run took 2,000 samples in all.", []],
      ["We measured 2,000 samples.", "Our run took 2,001 samples in all.", ["2,000"]],
      ["About 5% of them failed.", "Of the units, 5 per cent failed.", []],
      ["About 5 per cent of them failed.", "Of the units, 5% failed.", []],
      ["About 5 percent of them failed.", "Of the units, 5 per cent failed.", []],
      ["5% of them failed.", "5 of them failed.", ["5%"]],
      ["5 of them failed.", "5% of them failed.", ["5"]],
      ["Seven labs took part.", "No numbers here.", []],
      ["Ten labs took part.", "No numbers here.", []],
      ["Five per cent of labs left.", "No numbers here.", []],
      ["Eleven labs took part.", "No numbers here.", ["11"]],
      ["Twenty-one labs took part.", "No numbers here.", ["21"]],
      ["Two hundred labs took part.", "No numbers here.", ["2 hundred"]],
      ["One million labs took part.", "No numbers here.", ["1 million"]],
      ["7 labs took part.", "No numbers here.", ["7"]],
      ["12 labs took part.", "Twelve labs took part.", []],
      ["11 labs took part.", "eleven labs took part.", []],
      ["It had about 1,400 parts.", "It had 1,393 parts.", []],
      ["It had about 1,500 parts.", "It had 1,393 parts.", ["1,500"]],
      ["It had 1,400 parts.", "It had 1,393 parts.", ["1,400"]],
      ["It had 1,393 parts.", "It had 1,393 parts.", []],
      ["It cost about 1.4 million.", "It cost 1,393,000 in all.", []],
      ["It cost 4.5 million.", "It cost 4,500,000 in all.", []],
      ["The ratio was 3.14.", "The ratio was 3.14159.", []],
      ["The ratio was 3.2.", "The ratio was 3.14159.", ["3.2"]],
      ["Some 37% failed.", "Some 36.8% failed.", []],
      ["It was 5% and 5% again, and 5% once more.", "No numbers here.", ["5%"]],
      ["It was about 5% or 5%.", "No numbers here.", ["5%", "5%"]],
      ["It had 4,812 parts, 9% failed and 77 passed.", "Page: 9% and 77 were seen.", ["4,812"]],
      ["It had 4,812 parts, 9% failed and 77 passed.", "Page: nothing at all.", ["4,812", "9%", "77"]],
      ["It was found on 24 November 2026 at 10:30 in version v2.1.", "No numbers here.", []],
      ["It ran from 13 to 14 Oct, in the 2023-24 season.", "No numbers here.", []],
      ["It dates from 1859.", "No numbers here.", ["1859"]],
      ["It dates from 1859.", "Written in 1859.", []],
      ["The CRISPR-Cas9 and COVID-19 work.", "No numbers here.", []],
      ["A 12-mer was made.", "No numbers here.", ["12"]],
    ];
    it.each(MATCHES)("%j against %j: missing %j", (prose, page, missing) => {
      const issues = numbersIn1(prose, { [P1]: page, [P2]: "Paper two." });
      expect(missingAt(issues)).toEqual(missing);
      expect(issues.length).toBe(missing.length === 0 ? 0 : 1);
    });

    it("reads a number in the page of any of the finding's own sources", () => {
      expect(numbersIn1("It had 4,812 parts.", { [P1]: "Paper one.", [P2]: "It had 4,812 parts." })).toEqual([]);
    });

    it("matches a percentage only with a percentage, and a plain number only with a plain number", () => {
      expect(missingAt(numbersIn1("It was 12% and 40 more.", { [P1]: "It was 12 and 40% more." }))).toEqual(["12%", "40"]);
    });

    it("lists a number once however often the prose writes it, and each written form of it", () => {
      expect(missingAt(numbersIn1("It had 4,812 parts, 4,812 again, and about 4,812.", {}))).toEqual(["4,812", "4,812"]);
    });

    it("reads a number in the whole of a long text, and every sentence of it", () => {
      const prose = "First came 4,801 parts. Then came 4,802 more. Last came 4,803.";
      expect(missingAt(numbersIn1(prose, { [P1]: "Page: 4,802." }))).toEqual(["4,801", "4,803"]);
    });

    it("does not read the address inside a link, whose digits are no number", () => {
      expect(numbersIn1("See https://example.org/paper/12345 for the details.", {})).toEqual([]);
      expect(missingAt(numbersIn1("See https://example.org/paper/12345 for 4,812 details.", {}))).toEqual(["4,812"]);
    });

    it("does not take a number that a page holds only inside a link for a number it states", () => {
      const prose = "It had 4,812 parts.";
      expect(missingAt(numbersIn1(prose, { [P1]: "See https://example.org/files/4,812 for the list." }))).toEqual(["4,812"]);
      expect(missingAt(numbersIn1(prose, { [P1]: "See https://example.org/files/ for the list: 4,812 parts." }))).toEqual([]);
    });

    describe("a count in the years that numbersIn() skips", () => {
      // 1990 to 2099 is a year to numbersIn(), so a page's bare "2000" is no number there; our "2,000" is a count, never a bare year.
      it("is shown by the page's bare digits, both ways round, as §4.12's pair says", () => {
        expect(numbersIn1("We measured 2,000 samples.", { [P1]: "Our run took 2000 samples in all." })).toEqual([]);
        expect(numbersIn1("We measured 2000 samples.", { [P1]: "Our run took 2,000 samples in all." })).toEqual([]);
        expect(numbersIn1("We measured 1,990 samples.", { [P1]: "Our run took 1990 samples." })).toEqual([]);
        expect(numbersIn1("We measured 2,099 samples.", { [P1]: "Our run took 2099 samples." })).toEqual([]);
      });
      it("is shown for any other way of writing the same count: in words, with a multiplier, after about", () => {
        for (const prose of ["We measured 2 thousand samples.", "We measured two thousand samples.", "We measured about 2,000 samples.", "We measured 2.0 thousand samples."]) {
          expect(numbersIn1(prose, { [P1]: "Our run took 2000 samples in all." }), prose).toEqual([]);
        }
        expect(numbersIn1("We measured 1.99 thousand samples.", { [P1]: "Our run took 1990 samples." })).toEqual([]);
      });
      it("needs the same digits on the page: another year, a longer number, a longer run of digits or a decimal does not show it", () => {
        for (const page of [
          "Our run took 2001 samples.", "Our run took 12000 samples.", "Our run took 20000 samples.", "Our run took 2000x samples.",
          "Our run took 2000.5 samples.", "Our run took 2000,5 samples.", "The ratio was 1.2000 overall.", "The ratio was 7,2000 overall.",
          "Our run took x2000 samples.",
        ]) {
          expect(missingAt(numbersIn1("We measured 2,000 samples.", { [P1]: page })), page).toEqual(["2,000"]);
        }
      });
      it("never lets a page's year show a rounded figure: a year in a date line is no count of about 2,000", () => {
        expect(missingAt(numbersIn1("We measured about 2,000 samples.", { [P1]: "Published in 2026, against the 1990 baseline." }))).toEqual(["2,000"]);
        expect(missingAt(numbersIn1("We measured about 2,100 samples.", { [P1]: "Our run took 2099 samples." }))).toEqual(["2,100"]);
      });
      it("keeps a percentage apart: a page's 2000% or 2000 per cent shows no plain count, and its plain 2000 shows no 2,000%", () => {
        for (const page of ["Our run took 2000% more samples.", "Our run took 2000 per cent more samples.", "Our run took 2000 percent more samples.", "Our run took 2000 % more samples."]) {
          expect(missingAt(numbersIn1("We measured 2,000 samples.", { [P1]: page })), page).toEqual(["2,000"]);
        }
        for (const page of ["Our run took 2000% more samples.", "Our run took 2000 samples."]) {
          expect(missingAt(numbersIn1("We measured 2,000% more samples.", { [P1]: page })), page).toEqual(["2,000%"]);
        }
        // "percentile" and "percentage" are no unit of a percentage, so the count they follow is still a count.
        expect(numbersIn1("We measured 2,000 scores.", { [P1]: "We ranked 2000 percentile scores." })).toEqual([]);
        expect(numbersIn1("We measured 2,000 scores.", { [P1]: "We gave 2000 percentage scores." })).toEqual([]);
      });
      it("does not stretch to a fraction or a figure above the years, which the page's year does not show", () => {
        expect(missingAt(numbersIn1("We measured 2,000.5 samples.", { [P1]: "Our run took 2000 samples." }))).toEqual(["2,000.5"]);
        expect(missingAt(numbersIn1("We measured 2,000,000 samples.", { [P1]: "Our run took 2000 samples." }))).toEqual(["2,000,000"]);
        expect(missingAt(numbersIn1("We measured 2,000 million samples.", { [P1]: "Our run took 2000 samples." }))).toEqual(["2,000 million"]);
      });
      it("leaves a count outside the years to numbersIn(), which reads the page's 2100 and 1989 as numbers", () => {
        expect(missingAt(numbersIn1("We measured 2,100 samples.", { [P1]: "Our run took 2100 samples." }))).toEqual([]);
        expect(missingAt(numbersIn1("We measured 1,989 samples.", { [P1]: "Our run took 1989 samples." }))).toEqual([]);
      });
      it("is shown by a year on a page of another finding's source no more than any other number", () => {
        expect(missingAt(numbersIn1("We measured 2,000 samples.", { [P7]: "Our run took 2000 samples." }))).toEqual(["2,000"]);
      });
      it("leaves a year in our own prose unchecked, as a year, however the page writes it", () => {
        expect(numbersIn1("It was published in 2026 and again in 2000.", { [P1]: "No numbers here." })).toEqual([]);
      });
    });
  });

  describe("the quotable figures", () => {
    it("count for a number of any string, with the context's value matched exactly and by its unit", () => {
      expect(numbersIn1("About 8.4% of papers named AI methods.", {})).toEqual([]);
      expect(numbersIn1("It was 8.4 per cent of papers.", {})).toEqual([]);
      expect(numbersIn1("It was 8.40% of papers.", {})).toEqual([]);
      expect(missingAt(numbersIn1("It was 8.5% of papers.", {}))).toEqual(["8.5%"]);
      expect(missingAt(numbersIn1("It was 8.4 papers.", {}))).toEqual(["8.4"]);
      expect(missingAt(numbersIn1("It was about 8% of papers.", {}))).toEqual(["8%"]);
      expect(missingAt(numbersIn1("It was 84% of papers.", {}))).toEqual(["84%"]);
    });

    it("are read as our own prose is, so a figure written in words shows the number", () => {
      const file = clone(metrics());
      file.pace.quotable["papers.count"] = "twelve papers";
      expect(numbersIn1("It was 12 papers.", {}, { metrics: file })).toEqual([]);
      expect(missingAt(numbersIn1("It was 13 papers.", {}, { metrics: file }))).toEqual(["13"]);
    });

    it("count in a brief-level string too", () => {
      const issues = only(draftIssues({ edit: (d) => { d.lead[0].text = "8.4% of papers named AI methods."; d.ideas[0].text = "It is 8.4% of papers."; } }), "NUMBER_SOURCED");
      expect(issues).toEqual([]);
    });

    it("include the figures of the metrics file, which the context may not list", () => {
      const file = clone(metrics());
      file.pace.quotable["landmarks.this_year"] = "5 of 9";
      expect(numbersIn1("It was 5 of 9 Landmarks.", {}, { metrics: file })).toEqual([]);
      expect(missingAt(numbersIn1("It was 5 of 9 Landmarks.", {}))).toEqual(["5", "9"]);
      expect(missingAt(numbersIn1("It was 5 of 9 Landmarks.", {}, { metrics: false }))).toEqual(["5", "9"]);
    });

    it("include the figures of the context when the run has no metrics file, which the rule does not need", () => {
      const issues = draftIssues({ metrics: false, edit: (d) => { d.new_findings[0].explainer.found = "About 8.4% of papers."; } });
      expect(only(issues, "NUMBER_SOURCED")).toEqual([]);
      expect(issues.filter((i) => i.code === "INPUT_MISSING")).toEqual([]);
    });

    it("include the context's own figures, whatever the metrics file holds", () => {
      const context = weekdayContext();
      const richer = AgentContext.parse({ ...context, pace: { ...context.pace, quotable: { ...context.pace.quotable, "hold": "15 of 23" } } });
      expect(numbersIn1("It was 15 of 23 cases.", {}, { context: richer })).toEqual([]);
      expect(missingAt(numbersIn1("It was 15 of 23 cases.", {}))).toEqual(["15", "23"]);
    });
  });

  describe("the model's prose, and only that", () => {
    it("reads every English prose string: titles, the six parts, notes, terms, alt text, the Lead, updates, ideas, Also noted lines, reasons", () => {
      const prose = "It had 4,812 parts.";
      const issues = only(draftIssues({
        edit: (d) => {
          const f = d.new_findings[0];
          f.title = "A result of 4,812 parts";
          f.explainer.matters = prose;
          f.explainer.ai_helped = "Sample System 3, from Example Lab, did the work on 4,812 parts.";
          f.explainer.how_sure = "Checked by Example Journal on 4,812 parts.";
          f.explainer.background = prose;
          f.explainer.could_lead = "It could lead to 4,812 uses.";
          f.rung_history[0].note = prose;
          f.terms = [{ new: true, term: "protein folding", definition: prose }];
          f.figure.alt = prose;
          d.lead[0].text = prose;
          d.returning[0].update = prose;
          d.returning[0].rung.note = prose;
          d.rung_changes[0].rung.note = prose;
          d.ideas[0].text = prose;
          d.also[0].title = prose;
          d.corrections[0].reason = prose;
          d.report_decisions[0].reason = prose;
        },
      }), "NUMBER_SOURCED");
      expect(issues.map((i) => i.path)).toEqual([
        "also[0].title", "corrections[0].reason", "ideas[0].text", "lead[0].text", "new_findings[0].explainer.ai_helped",
        "new_findings[0].explainer.background", "new_findings[0].explainer.could_lead", "new_findings[0].explainer.how_sure",
        "new_findings[0].explainer.matters", "new_findings[0].figure.alt", "new_findings[0].rung_history[0].note", "new_findings[0].terms[0].definition",
        "new_findings[0].title", "report_decisions[0].reason", "returning[0].rung.note", "returning[0].update", "rung_changes[0].rung.note",
      ]);
    });

    it("never reads a quote, a title or a name, a source's address, a publisher, a credit or an artefact", () => {
      const issues = only(draftIssues({
        edit: (d) => {
          const f = d.new_findings[0];
          f.ai.evidence[0].quote = "the system solved it in 9,999 steps";
          f.ai.systems[0].name = "System 99,999";
          f.ai.systems[0].maker = "Maker 88,888";
          f.reactions[0].who = "A. Reviewer 77,777";
          f.reactions[0].affiliation = "University 66,666";
          f.reactions[0].quote = "a careful result of 55,555";
          f.figure.credit = "Figure 44,444 from a made-up paper";
          f.figure.licence_quote = "released under CC BY 4.0 on 33,333";
          f.sources[0].title = "A paper of 22,222 words";
          f.sources[0].publisher = "Journal 11,111";
          f.who[0].name = "Lab 12,121";
          d.ideas[0].who = "A. Example 13,131";
          d.also[0].field = "earth";
          d.deep_dive = null;
        },
        texts: {
          [P1]: "The system solved it in 9,999 steps. DOI 10.1234/example.1 and NCT01234567; deposited as PDB 1ABC. released under CC BY 4.0 on 33,333.",
          [P2]: "a careful result of 55,555. arXiv:2610.99001v1.",
        },
      }), "NUMBER_SOURCED");
      expect(issues).toEqual([]);
    });

    it("reads neither a correction's `before` nor a correction's text at a path of a different kind", () => {
      const issues = only(draftIssues({
        edit: (d) => {
          d.corrections = [{
            finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "correction", path: "significance", after: "landmark",
            reason: "A reason.", source_url: null, report_id: null,
          }, {
            finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "correction", path: "artefacts.pdb.0", after: "9999",
            reason: "A reason.", source_url: null, report_id: null,
          }];
          d.report_decisions = [];
        },
      }), "NUMBER_SOURCED");
      expect(issues).toEqual([]);
    });

    it("leaves the Chinese side alone: a draft is English, and the rule reads English prose only", () => {
      const input = buildDraftInput(DraftBrief.parse(baseDraft()), draftInputs({}));
      expect(input.inventory.entries.every((e) => e.lang === "en" || e.kind !== "prose")).toBe(true);
    });
  });

  describe("which sources a string may draw on", () => {
    const num = "It had 4,812 parts.";
    const say = (path: string, edit: (d: Json) => void, pages: Record<string, string | null>, scene: Scene = {}): string[] =>
      missingAt(only(draftIssues({ ...scene, edit: (d) => { edit(d); scene.edit?.(d); }, texts: { ...scene.texts, ...pages } }), "NUMBER_SOURCED"), path);

    describe("a finding's own string", () => {
      it("draws on that finding's own sources, and on no other source", () => {
        const found = (pages: Record<string, string | null>) => say(FOUND, (d) => { d.new_findings[0].explainer.found = num; }, pages);
        expect(found({ [P1]: num })).toEqual([]);
        expect(found({ [P2]: num })).toEqual([]);
        expect(found({ [P7]: num })).toEqual(["4,812"]);
        expect(found({ [B1]: num })).toEqual(["4,812"]);
        expect(found({ [B2]: num, [B3]: num })).toEqual(["4,812"]);
        expect(found({ [PRE1]: num })).toEqual(["4,812"]);
      });

      it("draws on the other finding's sources for the other finding", () => {
        const second = (pages: Record<string, string | null>) => say("new_findings[1].explainer.found", (d) => { d.new_findings[1].explainer.found = num; }, pages);
        expect(second({ [P7]: num })).toEqual([]);
        expect(second({ [P1]: num })).toEqual(["4,812"]);
        expect(second({ [B1]: num })).toEqual(["4,812"]);
      });

      it("has no page to draw on in a finding with no source, and says so", () => {
        const issues = only(draftIssues({ edit: (d) => { d.new_findings[1].explainer.found = num; d.new_findings[1].sources = []; d.new_findings[1].go_deeper = []; } }), "NUMBER_SOURCED");
        expect(issues).toHaveLength(1);
        expect(issues[0]!.message).toBe("This text holds 4,812, but it has no cited source whose fetched text could show that number.");
        const two = only(draftIssues({ edit: (d) => { d.new_findings[1].explainer.found = "It had 4,812 parts and 9% fell."; d.new_findings[1].sources = []; d.new_findings[1].go_deeper = []; } }), "NUMBER_SOURCED");
        expect(two[0]!.message).toBe("This text holds 4,812, 9%, but it has no cited source whose fetched text could show those numbers.");
      });
    });

    describe("a Lead line", () => {
      const lead = (pages: Record<string, string | null>, line = 0) => say(`lead[${line}].text`, (d) => { d.lead[line].text = num; }, pages);
      it("draws on the brief's sources and on those of the findings it cites", () => {
        expect(lead({ [B1]: num })).toEqual([]);
        expect(lead({ [B3]: num })).toEqual([]);
        expect(lead({ [P1]: num })).toEqual([]);
        expect(lead({ [P7]: num })).toEqual([]);
        expect(lead({ [P2]: num })).toEqual([]);
        expect(lead({ [PRE1]: num })).toEqual(["4,812"]);
        expect(lead({ [J9]: num })).toEqual(["4,812"]);
      });
      it("does not draw on the sources of a finding that its line does not cite", () => {
        expect(lead({ [PRE1]: num }, 1)).toEqual([]);
        expect(lead({ [P1]: num }, 1)).toEqual(["4,812"]);
        expect(lead({ [P7]: num }, 1)).toEqual(["4,812"]);
        expect(lead({ [B2]: num }, 1)).toEqual([]);
      });
      it("passes over a ref that names no finding and one whose sources the run does not hold", () => {
        // phys-2026-0003 is in the context's recent findings only, so its sources are unknown; bio-2026-9999 is nowhere.
        const set = (d: Json) => { d.lead[0].text = num; d.lead[0].refs = ["new-1", "phys-2026-0003", "bio-2026-9999"]; };
        expect(say("lead[0].text", set, { [P1]: num })).toEqual([]);
        expect(say("lead[0].text", set, { [PRE1]: num })).toEqual(["4,812"]);
        const issues = only(draftIssues({ edit: set }), "NUMBER_SOURCED").filter((i) => i.path === "lead[0].text");
        expect(issues).toHaveLength(1);
      });
      it("names the brief's sources first, then each cited finding's, a page once", () => {
        const issues = only(draftIssues({ edit: (d) => { d.lead[0].text = num; } }), "NUMBER_SOURCED").filter((i) => i.path === "lead[0].text");
        expect(issues.map((i) => i.message)).toEqual([
          "This text holds 4,812, which the fetched text of no cited source (b1, b2, b3, new-1 s1, new-1 s2, new-2 s1) shows and no quotable figure gives.",
        ]);
        const twice = only(draftIssues({ edit: (d) => { d.lead[0].text = num; d.lead[0].refs = ["new-1", "new-1"]; } }), "NUMBER_SOURCED")
          .filter((i) => i.path === "lead[0].text");
        expect(twice[0]!.message).toContain("(b1, b2, b3, new-1 s1, new-1 s2)");
      });
      it("counts two spellings of one address as one page, under the name it had first", () => {
        // b1's address is new-1's s1 with a www host and a tracking parameter.
        const issues = only(draftIssues({ edit: (d) => { d.lead[0].text = num; d.sources[0].url = "https://www.example.org/paper/1?utm_source=x"; } }), "NUMBER_SOURCED")
          .filter((i) => i.path === "lead[0].text");
        expect(issues.map((i) => i.message)).toEqual([
          "This text holds 4,812, which the fetched text of no cited source (b1, b2, b3, new-1 s2, new-2 s1) shows and no quotable figure gives.",
        ]);
      });
    });

    describe("a returning update and its rung note", () => {
      it("draws on the brief's sources and on the sources of the stored finding it is about", () => {
        for (const [path, set] of [
          ["returning[0].update", (d: Json) => { d.returning[0].update = num; }],
          ["returning[0].rung.note", (d: Json) => { d.returning[0].rung.note = num; }],
        ] as const) {
          expect(say(path, set, { [B1]: num })).toEqual([]);
          expect(say(path, set, { [B3]: num })).toEqual([]);
          expect(say(path, set, { [PRE1]: num })).toEqual([]);
          expect(say(path, set, { [P1]: num })).toEqual(["4,812"]);
          expect(say(path, set, { [J9]: num })).toEqual(["4,812"]);
        }
      });
    });

    describe("a rung change's note", () => {
      it("draws on the brief's sources, and on the finding's own when the run knows none, on none", () => {
        const set = (d: Json) => { d.rung_changes[0].rung.note = num; };
        expect(say("rung_changes[0].rung.note", set, { [B2]: num })).toEqual([]);
        expect(say("rung_changes[0].rung.note", set, { [PRE1]: num })).toEqual(["4,812"]);
        expect(say("rung_changes[0].rung.note", set, { [P1]: num })).toEqual(["4,812"]);
      });
    });

    describe("an idea, an Also noted title and a report decision's reason", () => {
      it("draw on the brief's sources only", () => {
        for (const [path, set] of [
          ["ideas[0].text", (d: Json) => { d.ideas[0].text = num; }],
          ["also[0].title", (d: Json) => { d.also[0].title = num; }],
          ["report_decisions[0].reason", (d: Json) => { d.report_decisions[0].reason = num; }],
        ] as const) {
          expect(say(path, set, { [B1]: num })).toEqual([]);
          expect(say(path, set, { [B3]: num })).toEqual([]);
          expect(say(path, set, { [P1]: num })).toEqual(["4,812"]);
          expect(say(path, set, { [PRE1]: num })).toEqual(["4,812"]);
        }
      });
    });

    describe("a correction's text", () => {
      const fix = (over: Json = {}) => (d: Json): void => {
        d.corrections = [{
          finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "clarification", path: "explainer.how_sure", after: num,
          reason: "A reason.", source_url: J9, report_id: null, ...over,
        }];
        d.report_decisions = [];
      };
      it("draws on the page of its own source_url, the brief's sources and the corrected finding's sources", () => {
        for (const path of ["corrections[0].after", "corrections[0].reason"]) {
          const set = (d: Json) => { fix(path.endsWith("after") ? {} : { reason: num })(d); };
          expect(say(path, set, { [J9]: num })).toEqual([]);
          expect(say(path, set, { [B1]: num })).toEqual([]);
          expect(say(path, set, { [PRE1]: num })).toEqual([]);
          expect(say(path, set, { [P1]: num })).toEqual(["4,812"]);
        }
      });
      it("draws each of several corrections on its own source_url, by its place in the list", () => {
        const base = { finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "clarification", after: num, reason: "A reason.", report_id: null };
        const listed = (first: string | null, second: string | null) => (d: Json): void => {
          d.corrections = [{ ...base, path: "explainer.how_sure", source_url: first }, { ...base, path: "explainer.could_lead", source_url: second }];
          d.report_decisions = [];
        };
        expect(say("corrections[0].after", listed(J9, null), { [J9]: num })).toEqual([]);
        expect(say("corrections[1].after", listed(J9, null), { [J9]: num })).toEqual(["4,812"]);
        expect(say("corrections[0].after", listed(null, J9), { [J9]: num })).toEqual(["4,812"]);
        expect(say("corrections[1].after", listed(null, J9), { [J9]: num })).toEqual([]);
        expect(say("corrections[1].reason", (d: Json) => { listed(null, J9)(d); d.corrections[1].after = "Fine."; d.corrections[1].reason = num; }, { [J9]: num })).toEqual([]);
      });
      it("has no page of its own when it gives no source_url", () => {
        const set = fix({ source_url: null });
        expect(say("corrections[0].after", set, { [J9]: num })).toEqual(["4,812"]);
        expect(say("corrections[0].after", set, { [B1]: num })).toEqual([]);
      });
      it("counts the same page once when the correction's address is also a source", () => {
        const set = (d: Json) => { fix({ source_url: B1 })(d); };
        expect(say("corrections[0].after", set, { [B1]: num })).toEqual([]);
        expect(say("corrections[0].after", set, { [B1]: "Statement one." })).toEqual(["4,812"]);
      });
      it("names the brief's sources, the corrected finding's once, then the correction's own address, as the pages it read", () => {
        const messageOf = (over: Json): string => only(draftIssues({ edit: fix(over) }), "NUMBER_SOURCED").find((i) => i.path === "corrections[0].after")!.message;
        expect(messageOf({})).toBe(
          "This text holds 4,812, which the fetched text of no cited source (b1, b2, b3, math-2026-0002 s1, the correction's source_url) shows and no quotable figure gives.",
        );
        expect(messageOf({ source_url: B1 })).toBe(
          "This text holds 4,812, which the fetched text of no cited source (b1, b2, b3, math-2026-0002 s1) shows and no quotable figure gives.",
        );
        expect(messageOf({ source_url: null })).toContain("(b1, b2, b3, math-2026-0002 s1) shows");
      });
    });

    describe("the Sunday deep dive", () => {
      const sunday = (pages: Record<string, string | null>) => say("deep_dive.text", (d) => {
        d.deep_dive = { finding_id: "bio-2024-0007", text: num, source_ids: ["b1"], why_today: "anniversary" };
      }, pages, { context: sundayContext() });
      it("draws on the brief's sources and the sources of the finding it is about, as the context shows them", () => {
        expect(sunday({ [B1]: num })).toEqual([]);
        expect(sunday({ [PRE1]: num })).toEqual([]);
        expect(sunday({ [P1]: num })).toEqual(["4,812"]);
      });
    });

    describe("the Monday review", () => {
      const review = (set: (d: Json) => void, pages: Record<string, string | null>, path: string) => say(path, (d) => {
        d.review = {
          big_picture: "A quiet week.", remarkable: { finding_id: "math-2026-0002", note: "A note." },
          strongest_against: { text: "Some evidence against.", finding_ids: ["chem-2026-0004"], source_ids: ["b1"] },
        };
        set(d);
      }, pages, { context: mondayContext(3) });
      it("draws the big picture from the brief's sources alone", () => {
        const set = (d: Json) => { d.review.big_picture = num; };
        expect(review(set, { [B1]: num }, "review.big_picture")).toEqual([]);
        expect(review(set, { [PRE1]: num }, "review.big_picture")).toEqual(["4,812"]);
        expect(review(set, { [P1]: num }, "review.big_picture")).toEqual(["4,812"]);
      });
      it("draws the remarkable note from the brief's sources and the remarkable finding's", () => {
        const set = (d: Json) => { d.review.remarkable.note = num; };
        expect(review(set, { [B1]: num }, "review.remarkable.note")).toEqual([]);
        expect(review(set, { [PRE1]: num }, "review.remarkable.note")).toEqual([]);
        expect(review(set, { [P1]: num }, "review.remarkable.note")).toEqual(["4,812"]);
      });
      it("draws the strongest evidence against from the brief's sources, not from the findings it names", () => {
        const set = (d: Json) => { d.review.strongest_against.text = num; };
        expect(review(set, { [B1]: num }, "review.strongest_against.text")).toEqual([]);
        expect(review(set, { [PRE1]: num }, "review.strongest_against.text")).toEqual(["4,812"]);
        expect(review(set, { [P1]: num }, "review.strongest_against.text")).toEqual(["4,812"]);
      });
    });

    describe("a stored finding's sources, when the run was given its record", () => {
      it("are known in full and count for an update about it", () => {
        const record = storedFinding("math-2026-0002", {
          sources: [{ id: "s1", kind: "paper", title: "A made-up paper", publisher: "Example Journal", url: "https://example.org/stored/1", doi: null, published_at: "2026-10-01", seen_as: "pack", added: "2026-10-02" }],
          go_deeper: ["s1"],
        });
        const records: StoredRecords = { findings: [record], corrections: [], terms: [] };
        const set = (d: Json) => { d.returning[0].update = num; };
        expect(say("returning[0].update", set, { "https://example.org/stored/1": num }, { stored: records })).toEqual([]);
        expect(say("returning[0].update", set, { [PRE1]: num }, { stored: records })).toEqual(["4,812"]);
      });
    });
  });

  describe("a page that the run could not read", () => {
    it("is told apart from a page without the number: every source is empty, so no number can be checked", () => {
      const issues = numbersIn1("It had 4,812 parts and 9% fell.", { [P1]: null, [P2]: " " });
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toBe("This text holds 4,812, 9%, but the fetched text of its cited sources (s1, s2) is empty, so they cannot be checked.");
      const one = numbersIn1("It had 4,812 parts.", { [P1]: null, [P2]: null });
      expect(one[0]!.message).toContain("so it cannot be checked.");
    });

    it("leaves the sources that were read to count", () => {
      expect(numbersIn1("It had 4,812 parts.", { [P1]: null, [P2]: "It had 4,812 parts." })).toEqual([]);
      const issues = numbersIn1("It had 4,812 parts.", { [P1]: null, [P2]: "Other words." });
      expect(issues[0]!.message).toContain("which the fetched text of no cited source (s1, s2) shows and no quotable figure gives.");
    });

    it("says what to do, and never to compute", () => {
      const issue = numbersIn1("It had 4,812 parts.", {})[0]!;
      expect(issue.severity).toBe("error");
      expect(issue.hint).toContain("2,000 and 2000, 5% and 5 per cent are the same");
      expect(issue.hint).toContain("write a number up to ten as a word");
      expect(issue.hint).toContain("Never add, subtract or compare numbers");
    });
  });

  describe("the run's evidence", () => {
    it("is needed: with none, the rule does not run and the engine says so once", () => {
      const issues = draftIssues({ evidence: false, edit: (d) => { d.new_findings[0].explainer.found = "It had 4,812 parts."; } });
      expect(only(issues, "NUMBER_SOURCED")).toEqual([]);
      const missing = issues.filter((i) => i.code === "INPUT_MISSING");
      expect(missing).toHaveLength(1);
      expect(missing[0]!.message).toContain("1 check did not run: NUMBER_SOURCED");
    });
  });
});

describe("NUMBER_SOURCED, published mode", () => {
  it("does not run: a stored finding's numbers are not looked for, and no input is missing", () => {
    expect(rule("NUMBER_SOURCED").scope).not.toContain("published");
    const finding = stored({ explainer: { found: lz("It had 4,812 parts.", "共有 4,812 個部分。"), matters: lz("m", "意"), ai_helped: lz("a", "助"), how_sure: lz("h", "穩"), background: lz("b", "背"), could_lead: lz("c", "可") } });
    for (const publishing of [D, null]) {
      expect(publishedIssues([finding], { publishing })).toEqual([]);
    }
  });

  it("gives nothing when asked of a stored input directly, and does not read a run input it does not have", () => {
    const w = storedWorld();
    const input = buildPublishedInput(w.brief, { findings: w.findings, terms: w.terms, corrections: w.corrections, reports: w.reports }, { config: w.config, publishing: D });
    expect(rule("NUMBER_SOURCED").check(input)).toEqual([]);
    expect(rule("ARTEFACT_FORMAT").check(input)).toEqual([]);
    expect(rule("QUOTE_VERBATIM").check(input)).toEqual([]);
  });
});

// ── The four valid drafts of the sample world ────────────────────────────────────────────────────

describe("the sample world's valid drafts", () => {
  it("pass all three rules with their own inputs, and without evidence keep only the fixed tests", async () => {
    const { EDITION_NAMES } = await import("../fixtures/src/world");
    const { draftInputs: sampleInputs } = await import("../fixtures/src/inputs");
    const { editionDraft } = await import("../fixtures/src/drafts");
    for (const name of EDITION_NAMES) {
      const draft = editionDraft(name);
      const inputs = sampleInputs(name);
      expect(runRules(buildDraftInput(draft, inputs), groundingRules), name).toEqual([]);
      const without = runRules(buildDraftInput(draft, { ...inputs, evidence: null }), groundingRules);
      expect(without.map((i) => `${i.severity} ${i.code}`), name).toEqual(["warning INPUT_MISSING"]);
    }
  });
});
