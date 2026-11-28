// Tests added by the independent review of the grounding rules (SPEC §4.12; lib/rules/grounding.ts). tests/rules-grounding.test.ts holds the
// author's tests of each sentence of the three rows; this file holds what the review found and what the author's file does not run:
//   the fixtures of the group    each F and T case of fixtures/src/invalid/grounding.ts, run through the whole validator and through the
//                                group's own rules, with the clause each one is meant to reach (the same code has a form clause and
//                                an appearance clause, so the exact code set alone cannot tell which one a case reached)
//   two findings, one ref        REF_UNKNOWN reports it, and the quote, artefact and number tests must still judge each finding against its
//                                own sources and not throw (a Map by ref held only the later finding)
//   thirteen new findings        a string of the eleventh finding is held to the eleventh finding's own sources, not to the second's
//   a message that quotes a long value
//                                the schema bounds no artefact, address or number, so a message cuts what it prints, by whole characters
//   an arXiv id in its paper's DOI, and a full-width year on a page
//                                two forms of a page that the rules read as the same id and the same number
// The worlds are the sample editions of fixtures/src (the weekday, Sunday and Monday drafts with their own inputs and pages), and each test
// runs the group's own rules unless it says the whole validator, so another group's rules cannot change a result. Everything a test writes
// is invented. Dashes in text are built from code points, so that none is typed in this file.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITION_NAMES, REPO_ROOT, type EditionName } from "../fixtures/src/world";
import { invalidDraft, invalidOutputs } from "../fixtures/src/build";
import { groundingCases, groundingNamed, groundingSoft } from "../fixtures/src/invalid/grounding";
import { editionDraft } from "../fixtures/src/drafts";
import { draftInputs } from "../fixtures/src/inputs";
import { RULE_CODE_TABLE, codesOfGroup } from "../lib/rules/index";
import { groundingRules, quoteWords } from "../lib/rules/grounding";
import { buildDraftInput, buildPublishedInput, runRules, type DraftInputs } from "../lib/rules/run";
import type { ValidationIssue } from "../lib/rules/types";
import { DraftBrief } from "../lib/schema/draft";
import { Correction, Evidence } from "../lib/schema/misc";
import { normalizeUrl } from "../lib/urls";
import { validateDraft } from "../lib/validate";
import { REMOVED_TEXT } from "../lib/vocab";
import { D, deepFreeze, l, lz, storedCorrections, storedFinding, storedWorld, type Json } from "./helpers/rule-world";

// ── The sample world ─────────────────────────────────────────────────────────────────────────────

const NATURE = "https://www.nature.com/articles/nature-ut-sample-0001"; // new-1's s1: the scroll paper
const CUT = 117; // a message prints at most 120 characters of one value: its first 117 and "..."

/** The valid draft of an edition as plain JSON. */
const plain = (edition: EditionName): Json => JSON.parse(JSON.stringify(editionDraft(edition))) as Json;

/** The text the sample run saw at a URL. */
function pageOf(url: string, edition: EditionName = "weekday"): string {
  const text = draftInputs(edition).evidence?.texts[normalizeUrl(url)];
  if (text === undefined) throw new Error(`The ${edition} run saw no page at ${url}`);
  return text;
}

/** The run's evidence with `pages` set by URL, `null` taking a page away; null when the run has none. */
function withPages(evidence: Evidence | null | undefined, pages: Record<string, string | null>): Evidence | null {
  if (evidence === null || evidence === undefined) return null;
  const json = JSON.parse(JSON.stringify(evidence)) as Json;
  for (const [url, text] of Object.entries(pages)) {
    const key = normalizeUrl(url);
    if (text === null) {
      delete json.texts[key];
      json.urls = json.urls.filter((u: string) => normalizeUrl(u) !== key);
    } else {
      json.texts[key] = text;
      if (!json.urls.some((u: string) => normalizeUrl(u) === key)) json.urls.push(url);
    }
  }
  return Evidence.parse(json);
}

interface Scene {
  /** Pages by URL over the weekday run's own pages; null takes one away. */
  pages?: Record<string, string | null>;
}

/** The group's own rules on a mutated weekday draft; a rule that threw is a RULE_ERROR in the result, which a test then sees. */
function run(edit: (d: Json) => void, scene: Scene = {}): ValidationIssue[] {
  const json = plain("weekday");
  edit(json);
  const base = draftInputs("weekday");
  const inputs: DraftInputs = { ...base, evidence: withPages(base.evidence, scene.pages ?? {}) };
  return runRules(buildDraftInput(DraftBrief.parse(json), inputs), groundingRules);
}

const ofCode = (issues: readonly ValidationIssue[], code: string): ValidationIssue[] => issues.filter((i) => i.code === code);
const tell = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.code}`);
const codesOf = (issues: readonly ValidationIssue[], severity: string): string[] =>
  [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();

/** The one issue of `code` a run holds, with no RULE_ERROR beside it. */
function theOne(issues: readonly ValidationIssue[], code: string): ValidationIssue {
  expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
  const found = ofCode(issues, code);
  expect(found.map((i) => i.path), JSON.stringify(found.map((i) => i.message))).toHaveLength(1);
  return found[0]!;
}

// ── The fixtures of the group ────────────────────────────────────────────────────────────────────

describe("the fixtures of the grounding group", () => {
  const MINE = codesOfGroup("grounding");
  /** The issue paths an F case may fail at, one pattern for each code. */
  const WHERE: Record<string, RegExp> = {
    ARTEFACT_FORMAT: /^new_findings\[\d+\]\.artefacts\.(?:doi|arxiv|lean|trial|pdb)\[\d+\]$/,
    QUOTE_VERBATIM: /^new_findings\[\d+\]\.(?:ai\.evidence\[\d+\]\.quote|reactions\[\d+\]\.quote|figure\.licence_quote)$/,
    NUMBER_SOURCED: /^new_findings\[\d+\]\.explainer\.found$/,
  };
  /** A fragment of the message of the clause an F case is meant to reach. */
  const F_CLAUSE: Record<string, string> = {
    ARTEFACT_FORMAT: "is not in the stored form",
    QUOTE_VERBATIM: "is not in the fetched text of s1",
    NUMBER_SOURCED: "This text holds 1,900, which the fetched text of no cited source",
  };
  /** The clause a T case is meant to reach, by its name: the form of an artefact, its appearance, the quote's page, its length, a number. */
  const T_CLAUSE: [RegExp, string][] = [
    [/^ARTEFACT_FORMAT: .*that no cited source holds/, "appears in the URL or fetched text of none of this finding's sources"],
    [/^ARTEFACT_FORMAT: /, "is not in the stored form"],
    [/^QUOTE_VERBATIM: .* of 26 words/, "The quote has 26 words; the limit is 25."],
    [/^QUOTE_VERBATIM: /, "is not in the fetched text of"],
    [/^NUMBER_SOURCED: /, "which the fetched text of no cited source"],
  ];

  /** A case's draft: a fresh copy of its edition's valid draft, mutated. */
  const mutated = (c: { edition?: EditionName; mutate: (draft: ReturnType<typeof editionDraft>) => unknown }): unknown => {
    const draft = editionDraft(c.edition ?? "weekday");
    const out = c.mutate(draft);
    return out === undefined ? draft : out;
  };
  const own = (draft: unknown, edition: EditionName): ValidationIssue[] =>
    runRules(buildDraftInput(DraftBrief.parse(draft), draftInputs(edition)), groundingRules);
  const whole = (draft: unknown, edition: EditionName): ValidationIssue[] => validateDraft(draft, draftInputs(edition)).issues;

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

  it("has one F case for each code of the group, in the table's order, each filed as invalid--CODE.json", () => {
    expect(groundingCases.map((c) => c.code)).toEqual(MINE);
    for (const c of groundingCases) expect(c.file, c.code).toBe(`invalid--${c.code}.json`);
    expect(new Set(groundingCases.map((c) => c.file)).size).toBe(groundingCases.length);
  });

  it("has no S case, because every code of the group is hard and the table lists only an F fixture for it", () => {
    expect(groundingSoft).toEqual([]);
    for (const code of MINE) {
      const info = RULE_CODE_TABLE.find((r) => r.code === code)!;
      expect(info.severity, code).toBe("H");
      expect(info.tests, code).toEqual(["F"]);
    }
  });

  it.each(groundingCases.map((c) => [c.code, c] as const))("F %s: fails validateDraft() with exactly its code, at the place it names, by a small change", (code, c) => {
    const edition = c.edition ?? "weekday";
    const draft = invalidDraft(c);
    const issues = whole(draft, edition);
    expect(tell(issues)).toEqual([`error ${code}`]);
    expect(issues[0]!.path).toMatch(WHERE[code]!);
    expect(issues[0]!.message).toContain(F_CLAUSE[code]!);
    expect(tell(own(draft, edition))).toEqual([`error ${code}`]);
    expect(changedPaths(editionDraft(edition), draft).length).toBeLessThanOrEqual(3);
  });

  it.each(groundingCases.map((c) => [c.code, c] as const))("F %s: its file in fixtures/drafts/ is the builder's output and fails the same way", (code, c) => {
    const { path, text } = invalidOutputs([c])[0]!;
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    expect(tell(whole(JSON.parse(text), c.edition ?? "weekday"))).toEqual([`error ${code}`]);
  });

  it("has named cases with unique names, each starting with the code it is about, which one of its results holds", () => {
    expect(new Set(groundingNamed.map((c) => c.name)).size).toBe(groundingNamed.length);
    for (const c of groundingNamed) {
      expect(c.name.startsWith(`${c.code}: `), c.name).toBe(true);
      expect(MINE, c.name).toContain(c.code);
      expect([...c.expect.errors, ...c.expect.warnings], c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toEqual([...c.expect.errors].sort());
      expect([...c.expect.warnings], c.name).toEqual([...c.expect.warnings].sort());
      expect(EDITION_NAMES, c.name).toContain(c.edition);
    }
  });

  it("covers each code of the group, and the Sunday and the Monday, whose prose only those editions carry", () => {
    for (const code of MINE) expect(groundingNamed.some((c) => c.code === code), code).toBe(true);
    for (const edition of ["weekday", "sunday", "monday"]) expect(groundingNamed.some((c) => c.edition === edition), edition).toBe(true);
  });

  it("holds, for each of the five artefact kinds, a case of its form and a case of its appearance", () => {
    const KINDS: [string, RegExp][] = [
      ["DOI", /^ARTEFACT_FORMAT: a (?:second )?DOI/], ["arXiv id", /^ARTEFACT_FORMAT: an arXiv id/], ["trial number", /^ARTEFACT_FORMAT: a trial number/],
      ["structure id", /^ARTEFACT_FORMAT: a structure id/], ["Lean file", /^ARTEFACT_FORMAT: a Lean/],
    ];
    for (const [kind, pattern] of KINDS) {
      const names = groundingNamed.filter((c) => pattern.test(c.name)).map((c) => c.name);
      expect(names.some((n) => n.includes("no cited source holds")), `${kind}: an appearance case`).toBe(true);
      expect(names.some((n) => !n.includes("no cited source holds")), `${kind}: a form case`).toBe(true);
    }
  });

  it("holds, for each of the three kinds of quote, a case of the page and a case of the 25-word limit", () => {
    const KINDS: [string, RegExp][] = [["evidence", /evidence|another source/], ["reaction", /reaction/], ["licence", /licence/]];
    for (const [kind, pattern] of KINDS) {
      const names = groundingNamed.filter((c) => c.code === "QUOTE_VERBATIM" && pattern.test(c.name)).map((c) => c.name);
      expect(names.some((n) => n.includes("of 26 words")), `${kind}: a length case`).toBe(true);
      expect(names.some((n) => !n.includes("of 26 words")), `${kind}: a page case`).toBe(true);
    }
    expect(groundingCases.some((c) => c.code === "QUOTE_VERBATIM")).toBe(true); // the evidence quote's page case is the F case
  });

  it.each(groundingNamed.map((c) => [c.name, c] as const))("T %s", (_name, c) => {
    const draft = mutated(c);
    const issues = whole(draft, c.edition);
    expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }).toEqual({ errors: [...c.expect.errors], warnings: [...c.expect.warnings] });
    // The group's own rules say the part that is theirs: the codes of the group among the expected errors, and nothing else
    const mine = own(draft, c.edition);
    expect(codesOf(mine, "error")).toEqual(c.expect.errors.filter((code) => MINE.includes(code)));
    expect(codesOf(mine, "warning")).toEqual([]);
    // One fault, one issue, and it is the clause the case is named for
    const found = ofCode(mine, c.code);
    expect(found.map((i) => `${i.path}: ${i.message}`)).toHaveLength(1);
    const clause = T_CLAUSE.find(([pattern]) => pattern.test(c.name))![1];
    expect(found[0]!.message).toContain(clause);
  });

  it("puts the second of two DOIs at index 1, and judges only that one", () => {
    const c = groundingNamed.find((n) => n.name.includes("a second DOI that no cited source holds"))!;
    const found = ofCode(own(mutated(c), c.edition), "ARTEFACT_FORMAT");
    expect(found.map((i) => i.path)).toEqual(["new_findings[0].artefacts.doi[1]"]);
  });

  it("adds only invented artefacts, in the number ranges the sample world keeps for its pages", () => {
    // Unanchored, since a case may write a world's own value wrongly (a prefix, capitals, a missing digit)
    const INVENTED = [/ut-sample/i, /10\.9999\//, /2610\.99\d+/, /NCT09999\d+/i, /pdb_0{3,4}9/i, /marlow-labs-sample/];
    const valuesOf = (draft: Json): string[] =>
      (draft.new_findings as Json[]).flatMap((f) => (["doi", "arxiv", "lean", "trial", "pdb"] as const).flatMap((k) => f.artefacts[k] as string[]));
    const added = new Set<string>();
    const cases = [
      ...groundingCases.map((c) => ({ edition: c.edition ?? "weekday", draft: invalidDraft(c) as Json })),
      ...groundingNamed.map((c) => ({ edition: c.edition, draft: mutated(c) as Json })),
    ];
    for (const { edition, draft } of cases) {
      const before = new Set(valuesOf(plain(edition)));
      for (const value of valuesOf(draft)) if (!before.has(value)) added.add(value);
    }
    expect(added.size).toBeGreaterThan(15);
    for (const value of added) expect(INVENTED.some((p) => p.test(value)), value).toBe(true);
  });
});

// ── Two new findings that share a ref ────────────────────────────────────────────────────────────

describe("two new findings that share a ref", () => {
  // REF_UNKNOWN reports it; the grounding rules must go on judging each finding against its own sources and must not throw.
  const share = (d: Json): void => { d.new_findings[1].ref = "new-1"; };
  const SCROLL = "new_findings[0]";
  const PROTEIN = "new_findings[1]";

  it("throws nothing and passes the world's own quotes and artefacts", () => {
    const issues = run(share);
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    expect(issues.filter((i) => i.code === "ARTEFACT_FORMAT" || i.code === "QUOTE_VERBATIM")).toEqual([]);
  });

  it("holds the later finding's quote to its own sources, at its own place", () => {
    const issues = run((d) => { share(d); d.new_findings[1].ai.evidence[0].quote = "words that no page of this finding holds"; });
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    expect(ofCode(issues, "QUOTE_VERBATIM").map((i) => i.path)).toEqual([`${PROTEIN}.ai.evidence[0].quote`]);
  });

  it("holds the earlier finding's quote to its own sources, at its own place, and names its own source", () => {
    // The protein page's words, cited as the scroll's s3: the scroll's s3 page does not hold them, and the protein's s1 is not the scroll's.
    const quote = "Halden Fold predicted the structure of the complex before any measurement";
    const issues = run((d) => { share(d); d.new_findings[0].ai.evidence[1].quote = quote; });
    const issue = theOne(issues, "QUOTE_VERBATIM");
    expect(issue.path).toBe(`${SCROLL}.ai.evidence[1].quote`);
    expect(issue.message).toContain("is not in the fetched text of s3 (https://www.sciencemediacentre.org/");
  });

  it("holds each finding's artefacts to its own sources", () => {
    const issues = run((d) => {
      share(d);
      d.new_findings[0].artefacts.doi = ["10.1073/ut-sample.0003"]; // the protein finding's DOI, in the scroll finding's record
      d.new_findings[1].artefacts.doi.push("10.1038/nature-ut-sample-0001"); // the scroll finding's DOI, in the protein finding's record
    });
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    expect(ofCode(issues, "ARTEFACT_FORMAT").map((i) => i.path)).toEqual([`${SCROLL}.artefacts.doi[0]`, `${PROTEIN}.artefacts.doi[2]`]);
  });

  it("holds a licence quote and a reaction to their own finding's sources too", () => {
    const issues = run((d) => {
      share(d);
      d.new_findings[0].figure.licence_quote = "This article is licensed under a Creative Commons Attribution 4.0 licence";
      d.new_findings[0].reactions[1].quote = "The readings are careful and the Greek is wrong";
    });
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    expect(ofCode(issues, "QUOTE_VERBATIM").map((i) => i.path)).toEqual([`${SCROLL}.figure.licence_quote`, `${SCROLL}.reactions[1].quote`]);
  });

  it("holds the 25-word limit of each finding's quotes, whatever the other finding is", () => {
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ");
    const issues = run((d) => { share(d); d.new_findings[1].ai.evidence[0].quote = long; d.new_findings[0].reactions[0].quote = long; });
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    const limits = ofCode(issues, "QUOTE_VERBATIM").filter((i) => i.message.includes("the limit is 25"));
    expect(limits.map((i) => i.path)).toEqual([`${SCROLL}.reactions[0].quote`, `${PROTEIN}.ai.evidence[0].quote`]);
  });

  describe("the numbers of their prose", () => {
    // The scroll paper's page shows 4,812 and the protein preprint's page shows 9,431, so each number belongs to one finding's sources.
    const PREPRINT = "https://www.biorxiv.org/content/10.1101/2026.09.02.990011v1";
    const scene = (): Scene => ({
      pages: { [NATURE]: `${pageOf(NATURE)}\nThe team read 4,812 marks.`, [PREPRINT]: `${pageOf(PREPRINT)}\nThe lab counted 9,431 residues.` },
    });
    const found = (scroll: string, protein: string) => (d: Json): void => {
      share(d);
      d.new_findings[0].explainer.found = scroll;
      d.new_findings[1].explainer.found = protein;
    };
    const lead = (text: string) => (d: Json): void => { share(d); d.lead[0].text = text; };

    it("gives no number issue for the world's own prose, next to the ref that REF_UNKNOWN reports", () => {
      const issues = run(share);
      expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
      expect(ofCode(issues, "NUMBER_SOURCED")).toEqual([]);
    });

    it("judges each finding's prose by its own sources: the later finding's sources do not stand for the earlier one's", () => {
      const issues = run(found("The team read 4,812 marks in the scroll.", "The lab counted 9,431 residues in the complex."), scene());
      expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
      expect(ofCode(issues, "NUMBER_SOURCED")).toEqual([]);
    });

    it("finds a number that only the other finding's sources show, in each of the two, at the finding's own place", () => {
      const issues = run(found("The team read 9,431 marks in the scroll.", "The lab counted 4,812 residues in the complex."), scene());
      expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
      const found2 = ofCode(issues, "NUMBER_SOURCED");
      expect(found2.map((i) => i.path)).toEqual([`${SCROLL}.explainer.found`, `${PROTEIN}.explainer.found`]);
      expect(found2[0]!.message).toBe("This text holds 9,431, which the fetched text of no cited source (s1, s2, s3, s4) shows and no quotable figure gives.");
      expect(found2[1]!.message).toBe("This text holds 4,812, which the fetched text of no cited source (s1, s2, s3, s4) shows and no quotable figure gives.");
    });

    it("lets a Lead line about the shared ref draw on the sources of either finding, and holds a number that neither shows", () => {
      expect(ofCode(run(lead("Scholars read 4,812 marks."), scene()), "NUMBER_SOURCED")).toEqual([]);
      expect(ofCode(run(lead("Scholars read 9,431 marks."), scene()), "NUMBER_SOURCED")).toEqual([]);
      const issues = ofCode(run(lead("Scholars read 7,777 marks."), scene()), "NUMBER_SOURCED");
      expect(issues.map((i) => i.path)).toEqual(["lead[0].text"]);
      expect(issues[0]!.message).toContain("This text holds 7,777, which the fetched text of no cited source (b1");
      expect(issues[0]!.message).toContain("new-1 s1");
    });
  });
});

// ── Thirteen new findings ────────────────────────────────────────────────────────────────────────

describe("thirteen new findings", () => {
  // A string of the eleventh finding is at `new_findings[10].explainer.found`, and the place of the second, `new_findings[1]`, is not the
  // start of it, because the closing bracket ends the index: the finding that owns a string is found by its whole place, past the first
  // digit. The scroll paper's page shows 4,812 and the protein preprint's page shows 9,431, each in its own finding's sources.
  const PREPRINT = "https://www.biorxiv.org/content/10.1101/2026.09.02.990011v1";
  const scene = (): Scene => ({
    pages: { [NATURE]: `${pageOf(NATURE)}\nThe team read 4,812 marks.`, [PREPRINT]: `${pageOf(PREPRINT)}\nThe lab counted 9,431 residues.` },
  });
  /** Nine more findings after the world's four, each a copy of the scroll finding with a ref of its own: thirteen in all, the eleventh at index 10, with `found` as its prose. */
  const thirteen = (found: string) => (d: Json): void => {
    for (let n = 5; n <= 13; n++) d.new_findings.push({ ...structuredClone(d.new_findings[0]), ref: `new-${n}` });
    d.new_findings[10].explainer.found = found;
  };

  it("passes the eleventh finding's prose when its own sources show the number, and the second finding's do not", () => {
    const issues = run(thirteen("The team read 4,812 marks in the scroll."), scene());
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    expect(ofCode(issues, "NUMBER_SOURCED")).toEqual([]);
  });

  it("holds the eleventh finding to its own sources, not to the second finding's: a number that only the second shows is found there", () => {
    const issues = run(thirteen("The lab counted 9,431 residues in the complex."), scene());
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    const found = ofCode(issues, "NUMBER_SOURCED");
    expect(found.map((i) => i.path)).toEqual(["new_findings[10].explainer.found"]);
    expect(found[0]!.message).toContain("This text holds 9,431, which the fetched text of no cited source (s1, s2, s3, s4) shows");
  });
});

// ── A message that quotes a long value ───────────────────────────────────────────────────────────

describe("a message that quotes a long value", () => {
  const trial = (value: string) => (d: Json): void => { d.new_findings[1].artefacts.trial = [value]; };

  it("prints an artefact of 120 characters whole and cuts one of 121 after its first 117", () => {
    const whole120 = "n".repeat(120);
    expect(theOne(run(trial(whole120)), "ARTEFACT_FORMAT").message).toContain(`The NCT number "${whole120}" is not in the stored form`);
    const cut = theOne(run(trial("n".repeat(121))), "ARTEFACT_FORMAT").message;
    expect(cut).toContain(`The NCT number "${"n".repeat(CUT)}..." is not in the stored form`);
    expect(cut).not.toContain("n".repeat(CUT + 1));
  });

  it("cuts an artefact of the wrong form, and cuts the form that it suggests in the same way", () => {
    const value = `10.1234/${"A".repeat(5_000)}`;
    const fix = value.toLowerCase();
    const issue = theOne(run((d) => { d.new_findings[1].artefacts.doi = [value]; }), "ARTEFACT_FORMAT");
    expect(issue.message).toContain(`The DOI "${value.slice(0, CUT)}..." is not in the stored form`);
    expect(issue.message.endsWith(`Write it as ${fix.slice(0, CUT)}....`)).toBe(true);
    expect(issue.message.length).toBeLessThan(400);
  });

  it("cuts an artefact of the right form that no source shows", () => {
    const value = `10.1234/${"a".repeat(5_000)}`;
    const issue = theOne(run((d) => { d.new_findings[1].artefacts.doi = [value]; }), "ARTEFACT_FORMAT");
    expect(issue.message).toContain(`The DOI "${value.slice(0, CUT)}..." appears in the URL or fetched text of none`);
    expect(issue.message.length).toBeLessThan(500);
  });

  it("cuts at whole characters: no half of a surrogate pair ends a message", () => {
    const smile = String.fromCodePoint(0x1f600);
    const { message } = theOne(run(trial(smile.repeat(150))), "ARTEFACT_FORMAT");
    expect(message).toContain(`The NCT number "${smile.repeat(CUT)}..."`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(message)).toBe(false);
  });

  it("counts a character outside the Basic Multilingual Plane as one: 61 to 120 of them are printed whole, 121 are cut after 117", () => {
    const smile = String.fromCodePoint(0x1f600);
    for (const n of [61, 100, CUT, 120]) {
      const { message } = theOne(run(trial(smile.repeat(n))), "ARTEFACT_FORMAT");
      expect(message, `${n} characters`).toContain(`The NCT number "${smile.repeat(n)}" is not in the stored form`);
    }
    const cut = theOne(run(trial(smile.repeat(121))), "ARTEFACT_FORMAT").message;
    expect(cut).toContain(`The NCT number "${smile.repeat(CUT)}..." is not in the stored form`);
  });

  describe("the address of the source a quote cites", () => {
    const LONG = `https://www.nature.com/articles/nature-ut-sample-0001?${"a".repeat(5_000)}`;
    const quote = (text: string) => (d: Json): void => { d.new_findings[0].sources[0].url = LONG; d.new_findings[0].ai.evidence[0].quote = text; };
    const at = "new_findings[0].ai.evidence[0].quote";

    it("is cut where the quote is not in the page", () => {
      const issues = run(quote("words that the page does not hold"), { pages: { [LONG]: "SAMPLE: a page with other words." } });
      const issue = ofCode(issues, "QUOTE_VERBATIM").find((i) => i.path === at)!;
      expect(issue.message).toContain(`The quote is not in the fetched text of s1 (${LONG.slice(0, CUT)}...). Copy it word for word`);
      expect(issue.message.length).toBeLessThan(600);
    });

    it("is cut where the page has no fetched text", () => {
      const issues = run(quote("words that the page does not hold"), { pages: { [LONG]: "" } });
      const issue = ofCode(issues, "QUOTE_VERBATIM").find((i) => i.path === at)!;
      expect(issue.message).toContain(`The quote cites s1 (${LONG.slice(0, CUT)}...), whose page has no fetched text`);
      expect(issue.message.length).toBeLessThan(600);
    });
  });

  it("cuts a number as it is written, and keeps the others of the list whole", () => {
    const digits = "7".repeat(5_000);
    const issue = theOne(run((d) => { d.new_findings[0].explainer.found = `The team read ${digits} letters and 4,321 lines.`; }), "NUMBER_SOURCED");
    expect(issue.message).toContain(`This text holds ${"7".repeat(CUT)}..., 4,321, which the fetched text`);
    expect(issue.message.length).toBeLessThan(500);
  });

  it("never prints the words of a quote that is too long or not in its page", () => {
    const words = Array.from({ length: 5_000 }, (_, i) => `qq${i}`).join(" ");
    const issues = run((d) => { d.new_findings[0].ai.evidence[0].quote = words; });
    expect(ofCode(issues, "QUOTE_VERBATIM")).toHaveLength(2);
    for (const i of issues) {
      expect(i.message).not.toContain("qq100");
      expect(i.message.length).toBeLessThan(400);
    }
  });
});

// ── An arXiv id in its paper's DOI ───────────────────────────────────────────────────────────────

describe("an arXiv id that a page shows in its paper's DOI", () => {
  // SPEC §5.9 reads 10.48550/arXiv.<id> as a carrier of the id. The id's own dot before it is no part of a longer number.
  const OTHER = "https://arxiv.org/abs/2610.99777"; // new-4's s1, moved to an address that holds no id
  const moved = (d: Json): void => { d.new_findings[3].sources[0].url = OTHER; };
  const inText = (text: string): ValidationIssue[] => run(moved, { pages: { [OTHER]: text } });
  const arxiv = (issues: readonly ValidationIssue[]): ValidationIssue[] => ofCode(issues, "ARTEFACT_FORMAT");

  it("is the id in a page's text when the DOI form carries it", () => {
    for (const text of [
      "SAMPLE: A proof. See doi:10.48550/arXiv.2610.99001 for the record.",
      "SAMPLE: A proof. https://doi.org/10.48550/arXiv.2610.99001v2 is the record.",
      "SAMPLE: A proof. 10.48550/ARXIV.2610.99001.",
    ]) expect(arxiv(inText(text)), text).toEqual([]);
  });

  it("is the id in a source's address when the address is the DOI form", () => {
    const url = "https://doi.org/10.48550/arXiv.2610.99001";
    const issues = run((d) => { d.new_findings[3].sources[0].url = url; }, { pages: { [url]: "SAMPLE: no number here." } });
    expect(arxiv(issues)).toEqual([]);
  });

  it("is not the id of another registrant's DOI, nor of another number it runs on from", () => {
    for (const text of [
      "SAMPLE: A proof. See doi:10.1234/arXiv.2610.99001 for the record.",
      "SAMPLE: A proof. See 10.48550/arXiv.2610.990012 for the record.",
      "SAMPLE: A proof. See 10.48550/arXiv.2610.99001.5 for the record.",
      "SAMPLE: A proof. Build 12.2610.99001 is not an id.",
      "SAMPLE: A proof. See 10.48550/arXiv.12610.99001 for the record.",
    ]) {
      const found = arxiv(inText(text));
      expect(found.map((i) => i.path), text).toEqual(["new_findings[3].artefacts.arxiv[0]"]);
    }
  });
});

// ── A year on a page in full-width digits ────────────────────────────────────────────────────────

describe("a number that a page writes as a bare year", () => {
  const FULL_WIDTH_2000 = String.fromCharCode(0xff12, 0xff10, 0xff10, 0xff10);
  const FULL_WIDTH_2026 = String.fromCharCode(0xff12, 0xff10, 0xff12, 0xff16);
  const found = (text: string) => (d: Json): void => { d.new_findings[0].explainer.found = text; };
  const withPage = (extra: string): Scene => ({ pages: { [NATURE]: `${pageOf(NATURE)} ${extra}` } });

  it("shows our 2,000 when the page writes 2000 in ASCII or in full-width digits", () => {
    for (const extra of ["It had 2000 letters.", `It had ${FULL_WIDTH_2000} letters.`]) {
      expect(ofCode(run(found("The scan read 2,000 letters."), withPage(extra)), "NUMBER_SOURCED"), extra).toEqual([]);
    }
  });

  it("does not show our 2,000 when the page has no 2000, and prints the number it could not find", () => {
    const issue = theOne(run(found("The scan read 2,000 letters."), withPage("It had 1999 letters.")), "NUMBER_SOURCED");
    expect(issue.message).toContain("This text holds 2,000, which the fetched text");
  });

  it("does not show a rounded 2,000 by a year of the page's own, full-width or not", () => {
    // The Example Press statement holds 84 and nine, and nothing near 2,000; the year it is given is a date line's, which shows 2026 alone.
    const PRESS = "https://www.eurekalert.org/news-releases/ut-sample-ai-retractions";
    const edit = (d: Json): void => { d.new_findings[2].explainer.found = "The group pulled about 2,000 papers."; };
    for (const year of ["2026", FULL_WIDTH_2026]) {
      const issues = run(edit, { pages: { [PRESS]: `${pageOf(PRESS)} Filed on ${year}.` } });
      const issue = ofCode(issues, "NUMBER_SOURCED").filter((i) => i.path === "new_findings[2].explainer.found");
      expect(issue.map((i) => i.message), year).toEqual([expect.stringContaining("This text holds 2,000, which")]);
    }
  });
});

// ── An artefact that only a page's text shows ────────────────────────────────────────────────────

describe("an artefact that only a page's text shows", () => {
  // Every address of the finding is moved off the artefact, so that its first page's text is the only place it can be found.
  const NEUTRAL = (i: number): string => `https://www.nature.com/articles/neutral-${i}`;
  const ACUTE_E = String.fromCharCode(0xe9); // a letter that is no ASCII letter
  const CJK = String.fromCharCode(0x4e2d); // a letter of another script
  const FULL_WIDTH_9 = String.fromCharCode(0xff19); // a digit that is no ASCII digit

  const LEAN = "https://github.com/marlow-labs-sample/sumsets-proof/blob/main/SumSets.lean";
  /** The kind, the finding that holds it, the value, and the value as a page writes it. */
  const KINDS: [string, number, string, string][] = [
    ["doi", 0, "10.1234/example.1", "10.1234/example.1"],
    ["arxiv", 3, "2610.99001", "2610.99001"],
    ["trial", 1, "NCT09999002", "NCT09999002"],
    ["pdb", 1, "pdb_00009zz1", "pdb_00009zz1"],
    ["lean", 3, LEAN, "github.com/marlow-labs-sample/sumsets-proof/blob/main/SumSets.lean"],
  ];

  /** The ARTEFACT_FORMAT issues of a finding whose only artefact is `value` of `kind` and whose first page's text is `text`. */
  function inText(kind: string, at: number, value: string, text: string): ValidationIssue[] {
    const pages: Record<string, string | null> = {};
    const issues = run((d) => {
      const f = d.new_findings[at];
      f.sources.forEach((s: Json, i: number) => { s.url = NEUTRAL(i); pages[NEUTRAL(i)] = i === 0 ? text : ""; });
      f.artefacts = { doi: [], arxiv: [], lean: [], trial: [], pdb: [], [kind]: [value] };
    }, { pages });
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    return ofCode(issues, "ARTEFACT_FORMAT");
  }

  it.each(KINDS)("shows the %s between spaces and between brackets", (kind, at, value, written) => {
    expect(inText(kind, at, value, `See ${written} here.`)).toEqual([]);
    expect(inText(kind, at, value, `The record (${written}), checked.`)).toEqual([]);
    expect(inText(kind, at, value, `See ${written}.`)).toEqual([]);
  });

  it.each(KINDS)("shows the %s in any case of the page's letters", (kind, at, value, written) => {
    expect(inText(kind, at, value, `See ${written.toUpperCase()} here.`)).toEqual([]);
  });

  it.each(KINDS.flatMap((k) => [ACUTE_E, CJK, FULL_WIDTH_9].map((glue) => [...k, glue] as const)))(
    "does not show the %s when a letter or digit of any script touches it (%#)", (kind, at, value, written, glue) => {
      const before = inText(kind, at, value, `See ${glue}${written} here.`);
      const after = inText(kind, at, value, `See ${written}${glue} here.`);
      expect(before.map((i) => i.path), `${glue} before`).toHaveLength(1);
      expect(after.map((i) => i.path), `${glue} after`).toHaveLength(1);
    },
  );

  it("shows a DOI that a resolver's address writes with percent escapes, and not one that its escapes make another", () => {
    const value = "10.1016/s0140-6736(20)30183-5";
    const found = (url: string): ValidationIssue[] => {
      const issues = run((d) => {
        const f = d.new_findings[0];
        f.sources.forEach((s: Json, i: number) => { s.url = NEUTRAL(i); });
        f.sources[0].url = url;
        f.artefacts = { doi: [value], arxiv: [], lean: [], trial: [], pdb: [] };
      }, { pages: { [url]: "SAMPLE: a page with no identifier.", [NEUTRAL(1)]: "", [NEUTRAL(2)]: "", [NEUTRAL(3)]: "" } });
      return ofCode(issues, "ARTEFACT_FORMAT");
    };
    expect(found("https://doi.org/10.1016%2Fs0140-6736%2820%2930183-5")).toEqual([]);
    expect(found("https://doi.org/10.1016%2Fs0140-6736%2820%2930183-6")).toHaveLength(1);
  });
});

// ── The text of a removal, where no stored correction removed anything ───────────────────────────

describe("REMOVED_TEXT written where no stored correction rewrote it", () => {
  // SPEC §4.12 "Removed text": the skip is keyed on the stored correction, so the text itself is judged as any other text.
  it("is judged as a quote: it is in no page", () => {
    const issue = theOne(run((d) => { d.new_findings[0].ai.evidence[0].quote = REMOVED_TEXT.en; }), "QUOTE_VERBATIM");
    expect(issue.path).toBe("new_findings[0].ai.evidence[0].quote");
    expect(issue.message).toContain("is not in the fetched text of s1");
  });

  it("is judged as an artefact: it is no DOI", () => {
    const issue = theOne(run((d) => { d.new_findings[0].artefacts.doi = [REMOVED_TEXT.en]; }), "ARTEFACT_FORMAT");
    expect(issue.path).toBe("new_findings[0].artefacts.doi[0]");
    expect(issue.message).toContain("is not in the stored form");
  });
});

// ── The correction checks and the quote count under pressure ─────────────────────────────────────

describe("the correction checks and the quote count under pressure", () => {
  const HAN = String.fromCodePoint(0x597d);
  /** A correction of a stored finding's text at `path`, as a draft writes it. */
  const rewriting = (finding: string, path: string, after: string, type = "correction"): Json => ({
    finding_id: finding, edition_date: null, term_id: null, type, path, after, reason: "The record was wrong.", source_url: null, report_id: null,
  });
  const THIRTY_WORDS = Array.from({ length: 30 }, (_, i) => `w${i + 1}`).join(" ");
  /** The issue paths of one code. */
  const pathsOf = (issues: readonly ValidationIssue[], code: string): string[] => ofCode(issues, code).map((i) => i.path);
  /** A stored correction of `bio-2026-0001`'s text at `path`: the third of the file, after the world's two. */
  const storedRewrite = (id: string, path: string, after: string, type = "correction"): Correction => Correction.parse({
    id, date: D, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type, path, before: l("the text before"),
    after: type === "removed" ? lz(after, after) : l(after), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
  });
  /** The grounding rules on the stored world with `extra` corrections added to its file, the finding being published. */
  const published = (extra: Correction[], freeze = false): ValidationIssue[] => {
    const w = storedWorld();
    const content = { findings: [storedFinding("bio-2026-0001")], terms: w.terms, corrections: [...storedCorrections(), ...extra], reports: w.reports };
    const input = buildPublishedInput(w.brief, content, { config: w.config, publishing: D });
    return runRules(freeze ? deepFreeze(input) : input, groundingRules);
  };

  describe("a draft whose corrections rewrite artefacts and quotes", () => {
    const edit = (d: Json): void => {
      d.corrections.push(
        rewriting("math-2026-0140", "artefacts.doi.0", "https://doi.org/10.9999/ut-sample.0001"),
        rewriting("math-2026-0140", "artefacts.trial.2", "NCT09999777"),
        rewriting("earth-2026-0141", "reactions.0.quote", THIRTY_WORDS, "update"),
        rewriting("earth-2026-0141", "ai.evidence.0.quote", `${HAN.repeat(51)}`, "clarification"),
        rewriting("earth-2026-0141", "figure.licence_quote", "A short licence line.", "correction"),
        rewriting("earth-2026-0141", "reactions.1.quote", `${HAN.repeat(50)}`),
      );
    };

    it("is judged as it is on a deeply frozen input, the same twice, with no rule error, and nothing in it changes", () => {
      const json = plain("weekday");
      edit(json);
      const frozen = deepFreeze(buildDraftInput(DraftBrief.parse(json), draftInputs("weekday")));
      const first = runRules(frozen, groundingRules);
      expect(ofCode(first, "RULE_ERROR")).toEqual([]);
      expect(runRules(frozen, groundingRules)).toEqual(first);
      const plainRun = runRules(buildDraftInput(DraftBrief.parse(json), draftInputs("weekday")), groundingRules);
      expect(first).toEqual(plainRun);
      const n = plain("weekday").corrections.length;
      expect(pathsOf(first, "ARTEFACT_FORMAT")).toEqual([`corrections[${n}].after`]);
      expect(pathsOf(first, "QUOTE_VERBATIM")).toEqual([`corrections[${n + 2}].after`, `corrections[${n + 3}].after`]);
    });

    it("names each at the correction's own index however many corrections precede it", () => {
      const issues = run((d) => {
        for (let i = 0; i < 12; i++) d.corrections.push(rewriting("math-2026-0140", "title", `A new title ${i}`));
        edit(d);
      });
      const n = plain("weekday").corrections.length + 12;
      expect(pathsOf(issues, "ARTEFACT_FORMAT")).toEqual([`corrections[${n}].after`]);
      expect(pathsOf(issues, "QUOTE_VERBATIM")).toEqual([`corrections[${n + 2}].after`, `corrections[${n + 3}].after`]);
    });
  });

  describe("a stored file whose corrections rewrite artefacts and quotes", () => {
    const extra = (): Correction[] => [
      storedRewrite("C-0003", "artefacts.doi.0", "https://doi.org/10.9999/ut-sample.0001"),
      storedRewrite("C-0004", "reactions.0.quote", THIRTY_WORDS),
      storedRewrite("C-0005", "ai.evidence.0.quote", HAN.repeat(51)),
      storedRewrite("C-0006", "figure.licence_quote", HAN.repeat(50)),
      storedRewrite("C-0007", "artefacts.pdb.0", "pdb_00001abc"),
      storedRewrite("C-0008", "artefacts.doi.1", "10.9999/ut-sample.0002", "removed"),
    ];

    it("is judged as it is on a deeply frozen input, the same twice, with no rule error", () => {
      const first = published(extra(), true);
      expect(ofCode(first, "RULE_ERROR")).toEqual([]);
      expect(published(extra(), true)).toEqual(first);
      expect(published(extra())).toEqual(first);
      expect(pathsOf(first, "ARTEFACT_FORMAT")).toEqual(["corrections.json: corrections[2].after.en"]);
      expect(pathsOf(first, "QUOTE_VERBATIM")).toEqual(["corrections.json: corrections[3].after.en", "corrections.json: corrections[4].after.en"]);
    });

    it("prints a bounded message for a value of 100,000 characters, with its first 117 characters and the dots", () => {
      const doi = `10.1234/${"A".repeat(100_000)}`;
      const issues = published([storedRewrite("C-0003", "artefacts.doi.0", doi)]);
      const issue = theOne(issues, "ARTEFACT_FORMAT");
      expect(issue.message).toContain(`The DOI "${doi.slice(0, CUT)}..." is not in the stored form`);
      expect(issue.message.endsWith(`Write it as ${doi.toLowerCase().slice(0, CUT)}....`)).toBe(true);
      expect(issue.message.length).toBeLessThan(500);
      expect(issue.hint!.length).toBeLessThan(500);
      const quote = theOne(published([storedRewrite("C-0003", "reactions.0.quote", `${HAN.repeat(100_000)}`)]), "QUOTE_VERBATIM");
      expect(quote.message).toBe("The quote has 50000 words; the limit is 25. Quote a shorter passage, still word for word.");
    });
  });

  describe("quoteWords() stays linear", () => {
    const BIG = 100_000;
    const THIRD = Math.floor(BIG / 3);
    const texts: [string, string, number][] = [
      ["Han", HAN.repeat(BIG), BIG / 2],
      ["Latin words", "ab ".repeat(THIRD), THIRD],
      ["Latin words with a Han character after each", `a${HAN} `.repeat(THIRD), THIRD + Math.ceil(THIRD / 2)],
      ["punctuation of the scripts", String.fromCodePoint(0x3002).repeat(BIG), 0],
      ["zero-width spaces", String.fromCodePoint(0x200b).repeat(BIG), 0],
      ["one link", `https://example.org/${"x".repeat(BIG)}`, 0],
      ["many links", "http://a.example ".repeat(Math.floor(BIG / 17)), 0],
      ["characters beyond the Basic plane", String.fromCodePoint(0x20000).repeat(BIG), BIG / 2],
      ["white space", " \n\t".repeat(THIRD), 0],
    ];
    it.each(texts)("reads 100,000 characters of %s in well under a second", (_name, text, expected) => {
      const start = performance.now();
      const words = quoteWords(text);
      const ms = performance.now() - start;
      expect(words).toBe(expected);
      expect(ms).toBeLessThan(1_000);
    });

    it("is judged by the rule in the same time when a quote of 100,000 characters stands in a finding", () => {
      const start = performance.now();
      const issues = run((d) => { d.new_findings[0].reactions[0].quote = `${"word ".repeat(20_000)}`; });
      const ms = performance.now() - start;
      expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
      const long = ofCode(issues, "QUOTE_VERBATIM").filter((i) => i.message.includes("the limit is 25"));
      expect(long.map((i) => i.message)).toEqual(["The quote has 20000 words; the limit is 25. Quote a shorter passage, still word for word."]);
      expect(ms).toBeLessThan(5_000);
    });
  });
});
