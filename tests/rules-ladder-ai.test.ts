// The ladder and AI rules (SPEC §4.12; lib/rules/ladder-ai.ts): RUNG_EVIDENCE, RUNG_ORDER, CLAIMED_CAP, LANDMARK_BASIS,
// NON_AI_LANDMARK_ONLY, SETBACK_MAJOR, AI_CONFIDENCE, AI_SYSTEM_NAMED, WHO_SAYS and POSSIBILITY, each in draft mode, in published
// mode on the records being published and in published mode on every other record, as the rule table and "Stored records" say
// which part of a row runs where. The worlds are the frame's (tests/helpers/rule-world.ts) with the few changes that make them pass
// the whole group, so a rule fails only for what a test changes; every test runs the group's own rules, never the registry, so
// another group's rules cannot change a result. RUNG_EVIDENCE's table is checked cell by cell against a function written from the
// spec row, not from lib/rungs.ts.
// New for this project; Cyber's tests/validate.test.ts exercised its flaw rules through the whole validator.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { editionDraft } from "@/fixtures/src/drafts";
import { draftInputs as sampleInputs } from "@/fixtures/src/inputs";
import { EDITION_NAMES } from "@/fixtures/src/world";
import { checkerRungsFor } from "@/lib/primary";
import { RULE_CODE_TABLE, codesOfGroup } from "@/lib/rules";
import { POSSIBILITY_WORDS, PROMISES, ladderAiRules, rungLabelAtStart, startsWithRungLabel } from "@/lib/rules/ladder-ai";
import { buildDraftInput, buildPublishedInput, runRules, type DraftInputs } from "@/lib/rules/run";
import type { Rule, StoredRecords, ValidationIssue } from "@/lib/rules/types";
import { Brief } from "@/lib/schema/brief";
import { AgentContext } from "@/lib/schema/context";
import { DraftBrief } from "@/lib/schema/draft";
import { Finding } from "@/lib/schema/finding";
import { Correction } from "@/lib/schema/misc";
import {
  AI_ROLES, ALL_RUNGS, FINDING_KINDS, REMOVED_BEFORE, REMOVED_TEXT, RUNG_INFO, SIGNIFICANCE, SOURCE_KINDS, type FindingKind, type Rung, type Significance,
  type SourceKind,
} from "@/lib/vocab";
import {
  D, MONDAY, SUNDAY, config, deepFreeze, draftInputs, holdRemoved, l, storedFinding, storedWorld, sundayContext, weekdayContext, weekdayDraft, type Json,
} from "./helpers/rule-world";

const ROOT = path.join(__dirname, "..");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

const GROUP_CODES = [
  "RUNG_EVIDENCE", "RUNG_ORDER", "CLAIMED_CAP", "LANDMARK_BASIS", "NON_AI_LANDMARK_ONLY", "SETBACK_MAJOR", "AI_CONFIDENCE", "AI_SYSTEM_NAMED",
  "WHO_SAYS", "POSSIBILITY",
];

const rule = (code: string): Rule => ladderAiRules.find((r) => r.codes[0] === code)!;

// ── The draft world ──────────────────────────────────────────────────────────────────────────────

/** A source of a new finding or of the brief. */
const src = (id: string, kind: string, publisher: string, over: Json = {}): Json => ({
  id, kind, title: `A made-up ${kind} ${id}`, publisher, url: `https://example.org/${kind}/${id}`, doi: null, published_at: "2026-11-20", ...over,
});

/**
 * The frame's Tuesday draft, changed so that every rule of the group passes it: the returning entry (a stored finding's new Checked
 * entry) cites a paper, the corrections are gone, and `new-2` (no AI role) is a Landmark with two reactions from two affiliations.
 * `new-1` is a Major biology result: AI-solved, confirmed, one Checked entry on a paper of "Example Journal".
 */
function baseDraft(): Json {
  const d = structuredClone(weekdayDraft()) as Json;
  d.sources[0].kind = "paper";
  d.corrections = [];
  d.report_decisions = [];
  const n2 = d.new_findings[1];
  n2.significance = "landmark";
  n2.sources = [src("s1", "paper", "Example Journal", { url: "https://example.org/paper/7" }), src("s2", "reaction", "First University"), src("s3", "reaction", "Second University")];
  n2.reactions = [
    { source_id: "s2", who: "R. One", affiliation: "First University", quote: "a careful check" },
    { source_id: "s3", who: "R. Two", affiliation: "Second University", quote: "a clean result" },
  ];
  return d;
}

type Edit = (d: Json) => void;

/** The group's issues for the base draft after `edit`, with `over` replacing run inputs. */
function draftRun(edit: Edit = () => {}, over: Partial<DraftInputs> = {}, rules: readonly Rule[] = ladderAiRules): ValidationIssue[] {
  const d = baseDraft();
  edit(d);
  return runRules(buildDraftInput(DraftBrief.parse(d), { ...draftInputs(), ...over }), rules);
}

/**
 * The issues of one code from that code's own rule. A rule that throws is not a rule that found nothing: `runRules` turns the throw
 * into a RULE_ERROR issue, which this stops on, so no "passes" test can pass over a crashed rule.
 */
function ownIssues(code: string, issues: readonly ValidationIssue[]): ValidationIssue[] {
  const other = issues.filter((i) => i.code !== code);
  if (other.length > 0) throw new Error(`the rule ${code} gave an issue of another code: ${other.map((i) => `${i.code} ${i.message}`).join(" | ")}`);
  return [...issues];
}

/** The issues of one code, from that code's own rule. */
const draftOf = (code: string, edit: Edit = () => {}, over: Partial<DraftInputs> = {}): ValidationIssue[] =>
  ownIssues(code, draftRun(edit, over, [rule(code)]));

const codesOf = (issues: readonly ValidationIssue[]): string[] => [...new Set(issues.map((i) => i.code))];
const pathsOf = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => i.path);

/** The stored records a draft run may be given (`DraftInputs.stored`). */
const stored = (findings: Finding[] = [], corrections: Correction[] = []): StoredRecords => ({ findings, corrections, terms: [] });

/** A stored correction as `corrections.json` holds it; a `removed` one's REMOVED_TEXT holds both languages, as publish stores it (SPEC §4.6, §4.10). */
const correctionJson = (id: string, date: string, findingId: string, path: string, after: string, type = "correction"): Json => ({
  id, date, finding_id: findingId, edition_date: null, term_id: null, type, path, before: l("before"),
  after: type === "removed" && after === REMOVED_TEXT.en ? { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh } : l(after),
  reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
});

/** A correction as the draft writes it. */
const draftCorrection = (findingId: string, path: string, after: string, type = "correction"): Json => ({
  finding_id: findingId, edition_date: null, term_id: null, type, path, after, reason: "The record was wrong.", source_url: null, report_id: null,
});

/** The context with `edit` applied to its JSON. */
function contextWith(edit: (c: Json) => void): AgentContext {
  const c = structuredClone(weekdayContext()) as Json;
  edit(c);
  return AgentContext.parse(c);
}

// ── The published world ──────────────────────────────────────────────────────────────────────────

interface WorldJson {
  brief: Json;
  findings: Json[];
  corrections: Json[];
}

/**
 * The frame's stored Tuesday after `edit`, run through the group's rules (or `rules`). `bio-2026-0001` and `math-2026-0002` were first
 * briefed on D, so `publishing: D` makes them (and the brief) the records being published; `phys-2026-0003` was first briefed earlier.
 */
function pubRun(edit: (w: WorldJson) => void = () => {}, publishing: string | null = D, rules: readonly Rule[] = ladderAiRules): ValidationIssue[] {
  const w = storedWorld();
  const j: WorldJson = {
    brief: structuredClone(w.brief) as Json, findings: w.findings.map((f) => structuredClone(f) as Json), corrections: w.corrections.map((c) => structuredClone(c) as Json),
  };
  edit(j);
  const content = {
    findings: j.findings.map((f) => Finding.parse(f)), terms: w.terms, corrections: j.corrections.map((c) => Correction.parse(c)), reports: w.reports,
  };
  return runRules(buildPublishedInput(Brief.parse(j.brief), content, { config: config(), publishing }), rules);
}

const pubOf = (code: string, edit: (w: WorldJson) => void = () => {}, publishing: string | null = D): ValidationIssue[] =>
  ownIssues(code, pubRun(edit, publishing, [rule(code)]));

const findingJson = (w: WorldJson, id: string): Json => w.findings.find((f) => f.id === id)!;

/** Writes REMOVED_TEXT where the world's stored `removed` corrections name, as publishing leaves the records (SPEC §4.12 "Removed text"). */
const holdMarkers = (w: WorldJson): void => holdRemoved({ brief: w.brief as never, findings: w.findings as never, terms: [], corrections: w.corrections as never });

const BIO = "bio-2026-0001";
const MATH = "math-2026-0002";
const PHYS = "phys-2026-0003";

// ── The group ────────────────────────────────────────────────────────────────────────────────────

describe("the group", () => {
  it("holds the ten rules of the table's ladder-ai group, one code each, errors in draft and published mode, reading no run input", () => {
    expect(ladderAiRules.map((r) => r.codes)).toEqual(GROUP_CODES.map((c) => [c]));
    expect([...codesOfGroup("ladder-ai")].sort()).toEqual([...GROUP_CODES].sort());
    for (const r of ladderAiRules) {
      expect(r.severity, r.codes[0]).toBe("error");
      expect(r.scope, r.codes[0]).toEqual(["draft", "published"]);
      expect(r.needs, r.codes[0]).toEqual([]);
      expect(r.uses, r.codes[0]).toEqual([]);
    }
    for (const row of RULE_CODE_TABLE.filter((r) => r.group === "ladder-ai")) {
      expect(row, row.code).toMatchObject({ severity: "H", scopes: ["draft", "published"], tests: ["F"] });
    }
  });

  it("passes the frame's Tuesday made clean, the frame's stored Tuesday and the four valid sample drafts, with no error and no warning", () => {
    expect(draftRun()).toEqual([]);
    expect(pubRun()).toEqual([]);
    expect(pubRun(() => {}, null)).toEqual([]);
    for (const name of EDITION_NAMES) {
      expect(runRules(buildDraftInput(editionDraft(name), sampleInputs(name)), ladderAiRules), name).toEqual([]);
    }
  });

  it("is a pure function of its input: the same issues twice, and a frozen input is never changed", () => {
    const input = buildDraftInput(DraftBrief.parse(baseDraft()), draftInputs());
    const once = runRules(input, ladderAiRules);
    deepFreeze(input);
    expect(runRules(input, ladderAiRules)).toEqual(once);
    const w = storedWorld();
    const published = buildPublishedInput(w.brief, w, { config: config(), publishing: D });
    deepFreeze(published);
    expect(runRules(published, ladderAiRules)).toEqual([]);
  });

  it("holds no em dash and no en dash outside a number range, in the rules or in this file", () => {
    const rangeless = new RegExp(`(?<!\\d)${EN}|${EN}(?!\\d)`);
    for (const file of ["lib/rules/ladder-ai.ts", "tests/rules-ladder-ai.test.ts"]) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(text.includes(EM), `${file} holds an em dash`).toBe(false);
      expect(rangeless.test(text), `${file} holds an en dash outside a range`).toBe(false);
    }
  });
});

describe("the label a how_sure starts with", () => {
  it("reads each rung's label as RUNG_INFO spells it, then the end of the text or a character that is no letter or digit", () => {
    for (const rung of ALL_RUNGS) {
      const label = RUNG_INFO[rung].en;
      for (const rest of ["", ".", ": a paper says so", " by Example Journal", ", then", "!"]) {
        expect(rungLabelAtStart(`${label}${rest}`), `${label}${rest}`).toBe(rung);
        expect(startsWithRungLabel(`${label}${rest}`, rung), `${label}${rest}`).toBe(true);
      }
    }
  });

  it("refuses a label that is lower case, led by a space, glued to a letter or digit, or not at the start", () => {
    for (const rung of ALL_RUNGS) {
      const label = RUNG_INFO[rung].en;
      for (const text of [`${label.toLowerCase()}.`, ` ${label}.`, `${label}ly.`, `${label}s.`, `${label}9.`, `${label}é.`, `Mostly ${label}.`, `The ${label} rung.`, ""]) {
        expect(rungLabelAtStart(text), text).not.toBe(rung);
        expect(startsWithRungLabel(text, rung), text).toBe(false);
      }
    }
    expect(rungLabelAtStart("Mostly fine.")).toBeNull();
    expect(rungLabelAtStart("")).toBeNull();
    // A label starts one rung only: no label is the start of another.
    for (const a of ALL_RUNGS) for (const b of ALL_RUNGS) if (a !== b) expect(startsWithRungLabel(`${RUNG_INFO[a].en}.`, b)).toBe(false);
  });
});

// ── RUNG_EVIDENCE ────────────────────────────────────────────────────────────────────────────────

type Listed = "none" | "other" | "this";

/** The facts a route may need: the finding is a setback, a checker lists the rung (or another rung, or none), the source is independent, a trial is named. */
interface Cell {
  setback: boolean;
  listed: Listed;
  independent: boolean;
  trial: boolean;
}

/**
 * What the RUNG_EVIDENCE row says, written from the row and not from lib/rungs.ts: whether a source of `kind` shows `rung`.
 * claimed: statement, lab_post; preprint: preprint; checked: paper, proof, or a checker listing the rung, and for a setback also a
 * notice or a statement; confirmed: a paper, statement or checker from a team other than the authors, or a trial endpoint met in a
 * paper or statement; applied: a regulator in checkers.json or a statement of use outside the lab; disputed: notice, paper or
 * statement; retracted: notice.
 */
function rowFits(rung: Rung, kind: SourceKind, f: Cell): boolean {
  const listed = f.listed === "this";
  switch (rung) {
    case "claimed":
      return kind === "statement" || kind === "lab_post";
    case "preprint":
      return kind === "preprint";
    case "checked":
      return kind === "paper" || kind === "proof" || (kind === "checker" && listed) || (f.setback && (kind === "notice" || kind === "statement"));
    case "confirmed":
      return ((kind === "paper" || kind === "statement" || kind === "checker") && f.independent) || ((kind === "paper" || kind === "statement") && f.trial);
    case "applied":
      return (kind === "checker" && listed) || (kind === "statement" && f.independent);
    case "disputed":
      return kind === "notice" || kind === "paper" || kind === "statement";
    case "retracted":
      return kind === "notice";
  }
}

const NOBEL = "https://www.nobelprize.org/prizes/mathematics/2026/summary/";
const TRIALS = "https://clinicaltrials.gov/study/NCT00000001";
const FDA = "https://www.fda.gov/drugs/news-events/example";
const UNLISTED = "https://example.org/checker/1";
const LISTING: Partial<Record<Rung, string>> = { checked: NOBEL, confirmed: TRIALS, applied: FDA };

function listedUrl(rung: Rung, listed: Listed): string {
  if (listed === "none") return UNLISTED;
  if (listed === "this") return LISTING[rung]!;
  return rung === "checked" ? FDA : NOBEL;
}

/** Whether RUNG_EVIDENCE fails a new finding whose only rung entry is `rung`, citing a source of `kind` with these facts. */
function entryFails(rung: Rung, kind: SourceKind, f: Cell): boolean {
  const d = baseDraft();
  const n = d.new_findings[0];
  n.kind = f.setback ? "setback" : "result";
  n.rung_history = [{ rung, date: "2026-11-20", source_id: "s1", note: null }];
  // A paper's publisher is a journal, which names no team: it clashes only through a who name. Any other kind clashes through another source's publisher.
  const clash = !f.independent;
  n.sources = [src("s1", kind, clash && kind !== "paper" ? "Example Journal" : "Confirming Journal", { url: listedUrl(rung, f.listed) }), src("s2", "paper", "Example Journal")];
  if (clash && kind === "paper") n.who = [{ name: "Confirming Journal", ror: null }];
  n.artefacts.trial = f.trial ? ["NCT00000001"] : [];
  return runRules(buildDraftInput(d as DraftBrief, draftInputs()), [rule("RUNG_EVIDENCE")]).some((i) => i.code === "RUNG_EVIDENCE");
}

const BOOLS = [false, true] as const;

describe("RUNG_EVIDENCE in draft mode", () => {
  it("knows the checkers the tests list: Nobel for Checked, ClinicalTrials.gov for Confirmed, the FDA for Applied, an unknown address for none", () => {
    const c = config();
    expect(checkerRungsFor(NOBEL, c)).toEqual(["checked"]);
    expect(checkerRungsFor(TRIALS, c)).toEqual(["confirmed"]);
    expect(checkerRungsFor(FDA, c)).toEqual(["applied"]);
    expect(checkerRungsFor(UNLISTED, c)).toBeNull();
  });

  for (const rung of ALL_RUNGS) {
    it(`fits ${rung} to the source kinds the row names, over every setback, checker, independence and trial combination`, () => {
      const listings: Listed[] = LISTING[rung] === undefined ? ["none", "other"] : ["none", "other", "this"];
      let cells = 0;
      for (const kind of SOURCE_KINDS) {
        for (const setback of BOOLS) for (const independent of BOOLS) for (const trial of BOOLS) for (const listed of listings) {
          const f: Cell = { setback, listed, independent, trial };
          expect(entryFails(rung, kind, f), `${rung} by ${kind} ${JSON.stringify(f)}`).toBe(!rowFits(rung, kind, f));
          cells += 1;
        }
      }
      expect(cells).toBe(SOURCE_KINDS.length * 8 * listings.length);
    }, 60_000);
  }

  it("passes a Major setback built from retraction notices and the publisher's statement, and fails a result whose Checked entry cites only a notice", () => {
    const setback = (d: Json): void => {
      const n = d.new_findings[0];
      n.kind = "setback";
      n.ai.systems = [];
      n.explainer.ai_helped = "An AI system was used to screen the papers.";
      n.sources = [src("s1", "notice", "Example Journal"), src("s2", "statement", "Example Journal")];
      n.rung_history = [{ rung: "checked", date: "2026-11-20", source_id: "s1", note: null }, { rung: "checked", date: "2026-11-21", source_id: "s2", note: null }];
    };
    expect(draftRun(setback)).toEqual([]);
    const result = draftOf("RUNG_EVIDENCE", (d) => {
      setback(d);
      d.new_findings[0].kind = "result";
    });
    expect(result.map((i) => i.path)).toEqual(["new_findings[0].rung_history[0].source_id", "new_findings[0].rung_history[1].source_id"]);
    expect(result[0]!.message).toBe(
      'The Checked entry cites s1, a notice from "Example Journal". A notice shows Checked only as a notice for a setback, and here the finding is filed as a result, not a setback.',
    );
    expect(result[0]!.hint).toBe("Cite a source of a kind that fits (paper, proof, checker's record, notice or statement), or give the entry the rung its source shows.");
  });

  it("reads the checker list for a source whose address a checkers.json entry lists, and the rung that entry gives", () => {
    const checked = (url: string) => draftOf("RUNG_EVIDENCE", (d) => {
      d.new_findings[0].sources[0] = src("s1", "checker", "The Committee", { url });
      d.new_findings[0].rung_history[0].source_id = "s1";
    });
    expect(checked(NOBEL)).toEqual([]);
    expect(checked(FDA)).toHaveLength(1);
    expect(checked(UNLISTED)).toHaveLength(1);
    expect(checked(UNLISTED)[0]!.message).toBe(
      `The Checked entry cites s1, a checker's record from "The Committee". A checker's record shows Checked only as a checker's record that config/checkers.json lists for that rung, and here no config/checkers.json entry lists ${UNLISTED} for Checked.`,
    );
  });

  it("asks a paper for a team other than the original's: a journal names no team, so only a who name of the finding is the original's own, whatever the case or spacing", () => {
    const confirmed = (publisher: string, edit: Edit = () => {}) => draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", "paper", publisher), src("s2", "paper", "Example Journal"), src("s3", "reaction", "Reacting Society")];
      n.rung_history = [{ rung: "confirmed", date: "2026-11-20", source_id: "s1", note: null }];
      n.who = [{ name: "Example Lab", ror: null }, { name: "A. Author", ror: null }];
      edit(d);
    });
    expect(confirmed("Confirming Journal")).toEqual([]);
    // Two papers in the same journal, by different teams, confirm each other (the validator sees no authors: STYLE.md §3 has the agent check them).
    expect(confirmed("Example Journal")).toEqual([]);
    expect(confirmed("  EXAMPLE   journal ")).toEqual([]);
    expect(confirmed("Example Lab")).toHaveLength(1);
    expect(confirmed("example lab")).toHaveLength(1);
    expect(confirmed("  A.   AUTHOR ")).toHaveLength(1);
    expect(confirmed("Reacting Society")).toEqual([]);
    expect(confirmed("Example Lab")[0]!.message).toBe(
      'The Confirmed entry cites s1, a paper from "Example Lab". A paper shows Confirmed only as a paper from a team other than the authors: a journal names no team, so its publisher need only differ from the finding\'s who, and the paper must not be one the original rests on or a paper that reports a trial endpoint met, on a finding that names a trial in artefacts.trial, and here "Example Lab" is a who name of the finding, or the finding names no trial in artefacts.trial.',
    );
  });

  it("takes a paper with the URL or the DOI of another source of the finding for the same paper, not a confirmation", () => {
    const confirmed = (over: Json) => draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", "paper", "Confirming Journal", over), src("s2", "paper", "Example Journal", { url: "https://example.org/paper/2", doi: "10.1000/orig.2" })];
      n.rung_history = [{ rung: "confirmed", date: "2026-11-20", source_id: "s1", note: null }];
      n.who = [{ name: "Example Lab", ror: null }];
    });
    expect(confirmed({ url: "https://example.org/paper/9", doi: "10.1000/other.9" })).toEqual([]);
    expect(pathsOf(confirmed({ url: "https://doi.org/10.1000/orig.2", doi: null }))).toEqual(["new_findings[0].rung_history[0].source_id"]);
    const sameUrl = confirmed({ url: "https://www.example.org/paper/2/" });
    expect(pathsOf(sameUrl)).toEqual(["new_findings[0].rung_history[0].source_id"]);
    expect(sameUrl[0]!.message).toContain("and here s1 is the same paper as s2, a source the finding already has, so it is the original's own");
    expect(pathsOf(confirmed({ url: "https://example.org/paper/9", doi: "10.1000/orig.2" }))).toEqual(["new_findings[0].rung_history[0].source_id"]);
    // A reaction's page is no paper of the original's.
    expect(draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", "paper", "Confirming Journal", { url: "https://example.org/paper/5" }), src("s2", "reaction", "First University", { url: "https://example.org/paper/5" })];
      n.rung_history = [{ rung: "confirmed", date: "2026-11-20", source_id: "s1", note: null }];
    })).toEqual([]);
  });

  it("keeps the old test for every other kind: a statement or checker from the publisher of another source or a who name is the original's own", () => {
    const run = (kind: string, publisher: string) => draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", kind, publisher, kind === "checker" ? { url: UNLISTED } : {}), src("s2", "paper", "Example Journal")];
      n.rung_history = [{ rung: "confirmed", date: "2026-11-20", source_id: "s1", note: null }];
      n.who = [{ name: "Example Lab", ror: null }];
      n.artefacts.trial = [];
    });
    for (const kind of ["statement", "checker"]) {
      expect(run(kind, "Example Journal"), kind).toHaveLength(1);
      expect(run(kind, " example   JOURNAL"), kind).toHaveLength(1);
      expect(run(kind, "Example Lab"), kind).toHaveLength(1);
      expect(run(kind, "Confirming Journal"), kind).toEqual([]);
    }
    expect(run("statement", "Example Journal")[0]!.message).toContain('and here "Example Journal" is the publisher of another source or a who name of the finding');
  });

  it("takes the source an earlier entry below Confirmed cites for the original's own: citing it again for Confirmed or Applied fails, whoever else the finding lists", () => {
    const run = (entries: [Rung, string][], kinds: [string, string] = ["paper", "paper"]) => draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", kinds[0], "Example Journal"), src("s2", kinds[1], "Confirming Journal")];
      n.who = [{ name: "Example Lab", ror: null }];
      n.rung_history = entries.map(([rung, source_id], i) => ({ rung, date: `2026-11-${18 + i}`, source_id, note: null }));
    });
    // The paper that showed Checked is the original's own, though no other source shares its publisher and a second paper is from another team.
    const again = run([["checked", "s1"], ["confirmed", "s1"]]);
    expect(pathsOf(again)).toEqual(["new_findings[0].rung_history[1].source_id"]);
    expect(again[0]!.message).toBe(
      'The Confirmed entry cites s1, a paper from "Example Journal". A paper shows Confirmed only as a paper from a team other than the authors: a journal names no team, so its publisher need only differ from the finding\'s who, and the paper must not be one the original rests on or a paper that reports a trial endpoint met, on a finding that names a trial in artefacts.trial, and here s1 is also the source of the earlier Checked entry, so it is the original\'s own, or the finding names no trial in artefacts.trial.',
    );
    expect(run([["checked", "s1"], ["confirmed", "s2"]])).toEqual([]);
    // Only an entry below Confirmed makes its source the original's: a source that already showed Confirmed may show it again.
    expect(run([["checked", "s1"], ["confirmed", "s2"], ["confirmed", "s2"]])).toEqual([]);
    // Only an earlier entry counts: a Checked entry that comes after the Confirmed one makes nothing of its source.
    expect(run([["confirmed", "s1"], ["checked", "s1"]])).toEqual([]);
    // The same holds for Applied, which a statement from outside the lab shows, and for a Claimed entry's statement.
    const applied = run([["claimed", "s1"], ["applied", "s1"]], ["statement", "statement"]);
    expect(pathsOf(applied)).toEqual(["new_findings[0].rung_history[1].source_id"]);
    expect(applied[0]!.message).toContain("s1 is also the source of the earlier Claimed entry, so it is the original's own");
    expect(run([["claimed", "s1"], ["applied", "s2"]], ["statement", "statement"])).toEqual([]);
    // A checker is no exception, though it is a third party: the record that showed Checked is the evidence Confirmed goes beyond
    // (docs/DESIGN.md: reproduced or verified by a team other than the authors), so a prize or a registry page cannot show both.
    const prize = (second: string) => draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", "checker", "The Committee", { url: NOBEL }), src("s2", "checker", "Another Committee", { url: TRIALS })];
      n.rung_history = [{ rung: "checked", date: "2026-11-18", source_id: "s1", note: null }, { rung: "confirmed", date: "2026-11-19", source_id: second, note: null }];
    });
    expect(pathsOf(prize("s1"))).toEqual(["new_findings[0].rung_history[1].source_id"]);
    expect(prize("s1")[0]!.message).toContain("s1 is also the source of the earlier Checked entry, so it is the original's own");
    expect(prize("s2")).toEqual([]);
    // A Preprint entry's source is the original's own whatever its kind, and each entry is judged by itself: the entry that cites a
    // statement for Preprint fails, and so does the Confirmed entry that cites the same statement again.
    const preprinted = run([["preprint", "s1"], ["confirmed", "s1"]], ["statement", "paper"]);
    expect(pathsOf(preprinted)).toEqual(["new_findings[0].rung_history[0].source_id", "new_findings[0].rung_history[1].source_id"]);
    expect(preprinted[0]!.message).toContain("A statement cannot show Preprint.");
    expect(preprinted[1]!.message).toContain("s1 is also the source of the earlier Preprint entry, so it is the original's own");
    // A source of the wrong kind is told by its kind, as before.
    expect(run([["preprint", "s1"], ["confirmed", "s1"]], ["preprint", "paper"])[0]!.message).toContain("A preprint cannot show Confirmed.");
    // A trial endpoint is its own route: the finding that names a trial may confirm with the paper it was checked on.
    expect(draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", "paper", "Example Journal")];
      n.rung_history = [{ rung: "checked", date: "2026-11-18", source_id: "s1", note: null }, { rung: "confirmed", date: "2026-11-19", source_id: "s1", note: null }];
      n.artefacts.trial = ["NCT00000007"];
    })).toEqual([]);
  });

  describe("on a stored finding the draft moves", () => {
    const sources = (): Json[] => [src("b1", "paper", "Confirming Journal"), src("b2", "paper", "Another Journal"), src("b3", "statement", "Example Institute")];
    const given = stored([storedFinding(MATH, { title: l("A made-up proof"), depth: "item" })]);
    const both = (first: [Rung, string], second: [Rung, string], over: Partial<DraftInputs> = {}) => draftOf("RUNG_EVIDENCE", (d) => {
      d.sources = sources();
      d.returning[0].rung = { rung: first[0], date: "2026-11-23", source_id: first[1], note: null };
      d.rung_changes = [{ finding_id: MATH, rung: { rung: second[0], date: "2026-11-23", source_id: second[1], note: null } }];
    }, over);

    it("takes the source the draft's earlier entry below Confirmed cites for the original's own, the returning entry's first and then the rung changes'", () => {
      const issues = both(["checked", "b2"], ["confirmed", "b2"]);
      expect(pathsOf(issues)).toEqual(["rung_changes[0].rung.source_id"]);
      expect(issues[0]!.message).toContain("b2 is also the source of the earlier Checked entry, so it is the original's own");
      expect(both(["checked", "b2"], ["confirmed", "b1"])).toEqual([]);
      // The entry that comes later in the draft is no earlier entry.
      expect(both(["confirmed", "b2"], ["checked", "b2"])).toEqual([]);
    });

    it("takes the source the stored record's own Checked entry cites for the original's own, when the run is given the record", () => {
      const confirm = (sid: string, over: Partial<DraftInputs> = { stored: given }) => draftOf("RUNG_EVIDENCE", (d) => {
        d.sources = sources();
        d.returning[0].rung = { rung: "confirmed", date: "2026-11-23", source_id: sid, note: null };
      }, over);
      // The stored math finding holds [Preprint s2, Checked s1]: its paper s1 showed Checked, its preprint s2 cannot show Confirmed.
      const issues = confirm("s1");
      expect(pathsOf(issues)).toEqual(["returning[0].rung.source_id"]);
      expect(issues[0]!.message).toContain("s1 is also the source of the earlier Checked entry, so it is the original's own");
      expect(confirm("b1")).toEqual([]);
      // Without the record the run knows no earlier entry of the finding, so a brief source that no draft entry cites before is the original's own to no one.
      expect(confirm("b1", {})).toEqual([]);
    });
  });

  it("accepts a trial endpoint met in a paper or a statement when the finding names a trial, with the same publisher as the original", () => {
    const run = (kind: string, trial: string[]) => draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", kind, "Example Journal"), src("s2", "paper", "Example Journal")];
      n.rung_history = [{ rung: "confirmed", date: "2026-11-20", source_id: "s1", note: null }];
      n.artefacts.trial = trial;
      // A paper's journal clashes only as a who name, so the original's team is named for the paper to need the trial route.
      n.who = [{ name: "Example Journal", ror: null }];
    });
    expect(run("paper", ["NCT00000007"])).toEqual([]);
    expect(run("statement", ["NCT00000007"])).toEqual([]);
    expect(run("paper", [])).toHaveLength(1);
    expect(run("statement", [])).toHaveLength(1);
    expect(run("preprint", ["NCT00000007"])).toHaveLength(1);
  });

  it("judges every entry of a new finding, each at its own index", () => {
    const issues = draftOf("RUNG_EVIDENCE", (d) => {
      const n = d.new_findings[0];
      n.sources = [src("s1", "preprint", "arXiv"), src("s2", "paper", "Example Journal"), src("s3", "preprint", "arXiv")];
      n.rung_history = [
        { rung: "preprint", date: "2026-11-18", source_id: "s1", note: null },
        { rung: "checked", date: "2026-11-19", source_id: "s3", note: null },
        { rung: "checked", date: "2026-11-20", source_id: "s2", note: null },
        { rung: "claimed", date: "2026-11-21", source_id: "s2", note: null },
      ];
    });
    expect(pathsOf(issues)).toEqual(["new_findings[0].rung_history[1].source_id", "new_findings[0].rung_history[3].source_id"]);
  });

  it("judges the entries a draft adds to a stored finding, the returning entry's and each rung change's, and never the entries it already holds", () => {
    const bad = (d: Json): void => {
      d.sources = [src("b1", "preprint", "arXiv"), src("b2", "paper", "Example Journal"), src("b3", "statement", "Example Institute")];
      d.returning[0].rung = { rung: "checked", date: "2026-11-23", source_id: "b1", note: null };
      d.rung_changes = [
        { finding_id: PHYS, rung: { rung: "disputed", date: "2026-11-23", source_id: "b2", note: null } },
        { finding_id: "chem-2026-0004", rung: { rung: "retracted", date: "2026-11-23", source_id: "b3", note: null } },
      ];
    };
    const issues = draftOf("RUNG_EVIDENCE", bad);
    expect(pathsOf(issues)).toEqual(["returning[0].rung.source_id", "rung_changes[1].rung.source_id"]);
    expect(issues[0]!.message).toContain("The Checked entry cites b1, a preprint from \"arXiv\"");
    expect(issues[1]!.message).toContain("A statement cannot show Retracted. Retracted is shown by a notice.");
    // The stored math finding holds a Preprint entry of its own; a draft that adds a fitting one is judged on that alone.
    const ok = draftOf("RUNG_EVIDENCE", (d) => {
      bad(d);
      d.returning[0].rung.source_id = "b2";
      d.rung_changes[1].rung.rung = "disputed";
    });
    expect(ok).toEqual([]);
  });

  it("cites the brief's source for a stored finding's entry by the b id and the finding's own by the s id", () => {
    const given = stored([storedFinding(MATH, { title: l("A made-up proof"), depth: "item" })]);
    const own = (sid: string) => draftOf("RUNG_EVIDENCE", (d) => {
      d.returning[0].rung = { rung: "checked", date: "2026-11-23", source_id: sid, note: null };
    }, { stored: given });
    expect(own("s1")).toEqual([]); // the stored math finding's s1 is a paper
    expect(own("s2")).toHaveLength(1); // its s2 is a preprint
    expect(own("b1")).toEqual([]); // the brief's b1 is a paper in the base world
  });

  it("leaves an id its container does not hold, and a container the context does not show, to SOURCE_IDS", () => {
    expect(draftOf("RUNG_EVIDENCE", (d) => { d.new_findings[0].rung_history[0].source_id = "s9"; })).toEqual([]);
    expect(draftOf("RUNG_EVIDENCE", (d) => { d.returning[0].rung.source_id = "b9"; })).toEqual([]);
    // The stored finding's s id with no stored record and no ledger entry for it: the context does not show its sources.
    expect(draftOf("RUNG_EVIDENCE", (d) => {
      d.rung_changes[0].rung.source_id = "s1";
      d.rung_changes[0].rung.rung = "retracted";
    })).toEqual([]);
  });

  it("files the finding as a setback by its stored kind and the draft's own kind correction, and reads an unknown kind as met", () => {
    const math = storedFinding(MATH, { title: l("A made-up proof"), depth: "item", kind: "result" });
    const statement = (d: Json): void => {
      d.sources[0].kind = "statement";
    };
    expect(draftOf("RUNG_EVIDENCE", statement, { stored: stored([math]) })).toHaveLength(1);
    expect(draftOf("RUNG_EVIDENCE", (d) => {
      statement(d);
      d.corrections = [draftCorrection(MATH, "kind", "setback")];
    }, { stored: stored([math]) })).toEqual([]);
    // A stored correction that refiled it earlier counts too.
    const refiled = Correction.parse(correctionJson("C-0001", "2026-11-01", MATH, "kind", "setback"));
    expect(draftOf("RUNG_EVIDENCE", statement, { stored: stored([math], [refiled]) })).toEqual([]);
    // Neither the context nor a stored record gives the kind of phys-2026-0003: the setback need is met.
    expect(draftOf("RUNG_EVIDENCE", (d) => { d.rung_changes[0].rung = { rung: "checked", date: "2026-11-23", source_id: "b3", note: null }; d.sources[2].kind = "statement"; })).toEqual([]);
  });

  it("takes the trial route as missing where the run shows artefacts that name no trial, and as met where it shows no artefacts", () => {
    // b1 is a statement of arXiv, the publisher of the stored math finding's own preprint, so only a trial endpoint could confirm it.
    const sameLab = (d: Json): void => {
      d.sources[0].kind = "statement";
      d.sources[0].publisher = "arXiv";
      d.returning[0].rung = { rung: "confirmed", date: "2026-11-23", source_id: "b1", note: null };
    };
    expect(draftOf("RUNG_EVIDENCE", sameLab)).toHaveLength(1);
    // Out of the context's list of recent findings, math-2026-0002 is seen through its report alone, which holds its sources and no artefacts.
    const reportOnly = contextWith((c) => { c.recent_findings = c.recent_findings.filter((f: Json) => f.id !== MATH); });
    expect(draftOf("RUNG_EVIDENCE", sameLab, { context: reportOnly })).toEqual([]);
  });

  it("reads the checker list for a draft whatever the record, so a stored finding's new entry is judged against it", () => {
    const checker = (d: Json, url: string): void => {
      d.sources[0] = src("b1", "checker", "The Committee", { url });
    };
    expect(draftOf("RUNG_EVIDENCE", (d) => checker(d, NOBEL))).toEqual([]);
    expect(draftOf("RUNG_EVIDENCE", (d) => checker(d, UNLISTED))).toHaveLength(1);
  });

  it("takes a removal in a stored finding's own source list for that list's, never for a brief source of the same index", () => {
    const math = storedFinding(MATH, { title: l("A made-up proof"), depth: "item" });
    const removed = Correction.parse(correctionJson("C-0001", "2026-11-12", MATH, "sources.0.url", REMOVED_TEXT.en, "removed"));
    const checker = (d: Json): void => { d.sources[0] = src("b1", "checker", "The Committee", { url: UNLISTED }); };
    expect(draftOf("RUNG_EVIDENCE", checker, { stored: stored([math]) })).toHaveLength(1);
    expect(draftOf("RUNG_EVIDENCE", checker, { stored: stored([math], [removed]) })).toHaveLength(1);
  });

  it("skips an unknown finding, and reports its path as the entry's source_id", () => {
    const issues = draftOf("RUNG_EVIDENCE", (d) => { d.new_findings[0].sources[0].kind = "dataset"; });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "RUNG_EVIDENCE", severity: "error", path: "new_findings[0].rung_history[0].source_id" });
    expect(issues[0]!.message).toContain("A dataset cannot show Checked. Checked is shown by a paper; a proof; a checker's record (that config/checkers.json lists for that rung); a notice (for a setback); a statement (for a setback).");
    // new-3 is a ref the draft never defines: REF_UNKNOWN's, not a finding to judge.
    expect(draftOf("RUNG_EVIDENCE", (d) => { d.rung_changes[0].finding_id = "bio-2099-0001"; d.rung_changes[0].rung.source_id = "b1"; d.rung_changes[0].rung.rung = "retracted"; })).toEqual([]);
  });
});

describe("RUNG_EVIDENCE: what each unmet need says", () => {
  const entry = (rung: Rung, kind: SourceKind, publisher: string, over: Json = {}, kindOfFinding: string = "result") => (d: Json): void => {
    const n = d.new_findings[0];
    n.kind = kindOfFinding;
    n.sources[0] = src("s1", kind, publisher, over);
    n.rung_history = [{ rung, date: "2026-11-20", source_id: "s1", note: null }];
  };
  const say = (edit: Edit): string[] => draftOf("RUNG_EVIDENCE", edit).map((i) => i.message);

  it("says which checkers.json entry lists the address for another rung only: the address and the rung asked", () => {
    expect(say(entry("checked", "checker", "The Committee", { url: FDA }))).toEqual([
      `The Checked entry cites s1, a checker's record from "The Committee". A checker's record shows Checked only as a checker's record that config/checkers.json lists for that rung, and here no config/checkers.json entry lists ${FDA} for Checked.`,
    ]);
  });

  it("names the kind the finding is filed as when a notice or a statement is cited for a result, in words", () => {
    expect(say(entry("checked", "notice", "Example Journal", {}, "policy_people"))).toEqual([
      'The Checked entry cites s1, a notice from "Example Journal". A notice shows Checked only as a notice for a setback, and here the finding is filed as a policy people, not a setback.',
    ]);
  });

  it("says that the publisher is a who name (a paper) or another source's publisher or a who name (any other kind), and that the finding names no trial, for a Confirmed entry that has neither", () => {
    const whoLab = (d: Json): void => { d.new_findings[0].who = [{ name: "Example Journal", ror: null }]; };
    expect(say((d) => { entry("confirmed", "paper", "Example Journal")(d); whoLab(d); })).toEqual([
      'The Confirmed entry cites s1, a paper from "Example Journal". A paper shows Confirmed only as a paper from a team other than the authors: a journal names no team, so its publisher need only differ from the finding\'s who, and the paper must not be one the original rests on or a paper that reports a trial endpoint met, on a finding that names a trial in artefacts.trial, and here "Example Journal" is a who name of the finding, or the finding names no trial in artefacts.trial.',
    ]);
    // A checker's record has the one route, from another team; a statement for Applied the same.
    expect(say(entry("confirmed", "checker", "Example Journal", { url: UNLISTED }))).toEqual([
      'The Confirmed entry cites s1, a checker\'s record from "Example Journal". A checker\'s record shows Confirmed only as a checker\'s record from a team other than the authors: its publisher and the finding\'s who differ from the original\'s, and here "Example Journal" is the publisher of another source or a who name of the finding.',
    ]);
    expect(say(entry("applied", "statement", "Example Journal"))).toEqual([
      'The Applied entry cites s1, a statement from "Example Journal". A statement shows Applied only as a statement from a team other than the authors: its publisher and the finding\'s who differ from the original\'s, and here "Example Journal" is the publisher of another source or a who name of the finding.',
    ]);
  });

  it("lists every route of a rung when the kind of the source cannot show it", () => {
    expect(say(entry("applied", "paper", "Example Journal"))).toEqual([
      'The Applied entry cites s1, a paper from "Example Journal". A paper cannot show Applied. Applied is shown by a checker\'s record (that config/checkers.json lists for that rung); a statement (from a team other than the authors: its publisher and the finding\'s who differ from the original\'s).',
    ]);
  });
});

describe("RUNG_EVIDENCE in published mode", () => {
  const rungPath = (id: string, i: number): string => `findings/${id}.json: rung_history[${i}].source_id`;
  const checker = (id: string, url = UNLISTED) => (w: WorldJson): void => {
    const f = findingJson(w, id);
    f.sources[0] = { ...f.sources[0], kind: "checker", url };
  };

  it("judges every entry of every record on the kind of its source, the records being published and the others", () => {
    expect(pubOf("RUNG_EVIDENCE")).toEqual([]);
    expect(pathsOf(pubOf("RUNG_EVIDENCE", (w) => { findingJson(w, BIO).rung_history[0].source_id = "s1"; }))).toEqual([rungPath(BIO, 0)]);
    expect(pathsOf(pubOf("RUNG_EVIDENCE", (w) => { findingJson(w, PHYS).rung_history[0].source_id = "s1"; }))).toEqual([rungPath(PHYS, 0)]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { findingJson(w, PHYS).rung_history[0].source_id = "s1"; }, null)).toHaveLength(1);
  });

  it("reads checkers.json for the records being published alone, and takes its list as met for every other record", () => {
    expect(pathsOf(pubOf("RUNG_EVIDENCE", checker(BIO)))).toEqual([rungPath(BIO, 1)]);
    expect(pubOf("RUNG_EVIDENCE", checker(BIO, NOBEL))).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", checker(BIO, FDA))).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", checker(PHYS))).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", checker(BIO), null)).toEqual([]);
    // Publishing the day phys-2026-0003 was first briefed makes it, and no longer bio-2026-0001, a record being published.
    expect(pathsOf(pubOf("RUNG_EVIDENCE", checker(PHYS), "2026-11-10"))).toEqual([rungPath(PHYS, 1)]);
    expect(pubOf("RUNG_EVIDENCE", checker(BIO), "2026-11-10")).toEqual([]);
  });

  describe("a returning finding (F-55)", () => {
    // phys-2026-0003 was first briefed earlier. Filed with `updated: D` it is a returning finding: its Checked entry (recorded D) is the
    // Tuesday's, its Preprint entry (recorded 2026-10-05) is older. The checkers list is read for the new entry alone.
    const returning = (w: WorldJson): void => { findingJson(w, PHYS).updated = D; };
    const withChecker = (w: WorldJson): void => { returning(w); checker(PHYS)(w); };

    it("reads checkers.json for an entry recorded on D and takes the list as met for an older entry of the same finding", () => {
      expect(pathsOf(pubOf("RUNG_EVIDENCE", withChecker))).toEqual([rungPath(PHYS, 1)]);
      // the Checked entry's source is the same checker, but the entry was recorded before D: an archived record
      const older = (w: WorldJson): void => {
        withChecker(w);
        findingJson(w, PHYS).rung_history[1].recorded = "2026-11-10";
      };
      expect(pubOf("RUNG_EVIDENCE", older)).toEqual([]);
      // the checker is on the list: the new entry passes
      expect(pubOf("RUNG_EVIDENCE", (w) => { returning(w); checker(PHYS, NOBEL)(w); })).toEqual([]);
      // and the same unlisted checker on a finding first briefed on D is judged whole
      expect(pathsOf(pubOf("RUNG_EVIDENCE", checker(BIO)))).toEqual([rungPath(BIO, 1)]);
    });

    it("gives a new entry the facts of the finding it needs: its kind as filed on the day it was recorded, and the entries ahead of it", () => {
      const notice = (w: WorldJson): void => { returning(w); findingJson(w, PHYS).sources[0].kind = "notice"; };
      // a notice shows a rung only on a setback
      expect(pathsOf(pubOf("RUNG_EVIDENCE", notice))).toEqual([rungPath(PHYS, 1)]);
      expect(pubOf("RUNG_EVIDENCE", (w) => { notice(w); findingJson(w, PHYS).kind = "setback"; })).toEqual([]);
      // a Confirmed entry on a paper the Preprint entry ahead of it did not cite, whose publisher the finding's who does not name
      const confirm = (publisher: string) => (w: WorldJson): void => {
        returning(w);
        const f = findingJson(w, PHYS);
        f.sources.push({ id: "s3", kind: "paper", title: "A made-up confirmation", publisher, url: "https://example.org/paper/3", doi: null, published_at: "2026-11-21", seen_as: "pack", added: D });
        f.rung_history.push({ rung: "confirmed", date: "2026-11-21", recorded: D, source_id: "s3", by: "agent", note: null });
        f.rung = "confirmed";
      };
      // A paper's journal names no team, so only a who name of the finding is the original's own.
      expect(pathsOf(pubOf("RUNG_EVIDENCE", confirm("Example Lab")))).toEqual([rungPath(PHYS, 2)]);
      expect(pubOf("RUNG_EVIDENCE", confirm("Confirming Journal"))).toEqual([]);
      expect(pubOf("RUNG_EVIDENCE", confirm("Example Journal"))).toEqual([]);
    });

    it("judges an older entry on its source's kind all the same, as it does for every record", () => {
      expect(pathsOf(pubOf("RUNG_EVIDENCE", (w) => { returning(w); findingJson(w, PHYS).rung_history[0].source_id = "s1"; }))).toEqual([rungPath(PHYS, 0)]);
    });
  });

  it("files the finding as a setback on the day the entry was recorded: a correction filed by then counts, a later one never does", () => {
    const notice = (w: WorldJson): void => { findingJson(w, BIO).sources[0].kind = "notice"; };
    expect(pubOf("RUNG_EVIDENCE", notice)).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", (w) => { notice(w); w.corrections.push(correctionJson("C-0003", D, BIO, "kind", "setback")); })).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { notice(w); w.corrections.push(correctionJson("C-0003", "2026-11-23", BIO, "kind", "setback")); })).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { notice(w); w.corrections.push(correctionJson("C-0003", "2026-11-25", BIO, "kind", "setback")); })).toHaveLength(1);
    // Published as a setback, a later correction to result never fails the entry it was recorded as.
    const setback = (w: WorldJson): void => { notice(w); findingJson(w, BIO).kind = "setback"; };
    expect(pubOf("RUNG_EVIDENCE", setback)).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { setback(w); w.corrections.push(correctionJson("C-0003", "2026-11-25", BIO, "kind", "result")); })).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { setback(w); w.corrections.push(correctionJson("C-0003", D, BIO, "kind", "result")); })).toHaveLength(1);
    // The day is the entry's own recorded date, not the brief's: an entry recorded on 2026-11-21 sees a correction filed that day, never a later one.
    const recordedOn = (recorded: string, filed: string) => (w: WorldJson): void => {
      notice(w);
      findingJson(w, BIO).rung_history[1].recorded = recorded;
      w.corrections.push(correctionJson("C-0003", filed, BIO, "kind", "setback"));
    };
    expect(pubOf("RUNG_EVIDENCE", recordedOn("2026-11-21", "2026-11-21"))).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", recordedOn("2026-11-21", "2026-11-22"))).toHaveLength(1);
  });

  it("compares a confirming source with the sources the record held when the entry was recorded, a reaction aside", () => {
    const confirm = (publisher: string, added: string, kind = "statement", over: Json = {}) => (w: WorldJson): void => {
      const f = findingJson(w, BIO);
      f.sources.push({ id: "s3", kind, title: "A made-up confirmation", publisher, url: "https://example.org/paper/3", doi: null, published_at: "2026-11-21", seen_as: "pack", added });
      f.rung_history.push({ rung: "confirmed", date: "2026-11-21", recorded: D, source_id: "s3", by: "agent", note: null });
      f.rung = "confirmed";
      Object.assign(f, over);
    };
    expect(pathsOf(pubOf("RUNG_EVIDENCE", confirm("Example Journal", D)))).toEqual([rungPath(BIO, 2)]);
    expect(pubOf("RUNG_EVIDENCE", confirm("Confirming Journal", D))).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", confirm("Example Lab", D))).toHaveLength(1);
    // A paper is compared with the who names alone: the journal of s1 is no clash, a who name is.
    expect(pubOf("RUNG_EVIDENCE", confirm("Example Journal", D, "paper"))).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", confirm("Example Lab", D, "paper"))).toHaveLength(1);
    // s1 was added after the entry was recorded: it was not the original then.
    expect(pubOf("RUNG_EVIDENCE", (w) => { confirm("Example Journal", D)(w); findingJson(w, BIO).sources[0].added = "2026-11-25"; })).toEqual([]);
    // A trial named in artefacts.trial is another route.
    expect(pubOf("RUNG_EVIDENCE", (w) => { confirm("Example Journal", D)(w); findingJson(w, BIO).artefacts.trial = ["NCT00000001"]; })).toEqual([]);
    // s2 is a preprint of "arXiv": its publisher is the original's. A reaction's publisher is not: it is another scientist's own words.
    expect(pubOf("RUNG_EVIDENCE", (w) => { confirm("arXiv", D)(w); })).toHaveLength(1);
    const reacting = (kind: string) => (w: WorldJson): void => {
      confirm("Reacting Society", D)(w);
      findingJson(w, BIO).sources.push({ id: "s4", kind, title: "A made-up reaction", publisher: "Reacting Society", url: "https://example.org/reaction/4", doi: null, published_at: "2026-11-21", seen_as: "pack", added: D });
    };
    expect(pubOf("RUNG_EVIDENCE", reacting("reaction"))).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", reacting("paper"))).toHaveLength(1);
    // The same paper, by its address: s1's page cited again as a later paper is no confirmation, whatever its journal.
    const samePaper = (same: boolean) => (w: WorldJson): void => {
      confirm("Confirming Journal", D, "paper")(w);
      const sources = findingJson(w, BIO).sources;
      if (same) sources.find((x: Json) => x.id === "s3")!.url = sources.find((x: Json) => x.id === "s1")!.url;
    };
    expect(pubOf("RUNG_EVIDENCE", samePaper(false))).toEqual([]);
    expect(pathsOf(pubOf("RUNG_EVIDENCE", samePaper(true)))).toEqual([rungPath(BIO, 2)]);
  });

  it("takes the source an earlier entry below Confirmed cites for the original's own, in every record, whoever else the record lists", () => {
    // bio-2026-0001 holds [Preprint s2, Checked s1]: s1 is its paper from "Example Journal", s3 a paper from another team that confirms it.
    const confirm = (id: string, sid: string) => (w: WorldJson): void => {
      const f = findingJson(w, id);
      f.sources.push({ id: "s3", kind: "paper", title: "A made-up confirmation", publisher: "Confirming Journal", url: "https://example.org/paper/3", doi: null, published_at: "2026-11-21", seen_as: "pack", added: D });
      f.rung_history.push({ rung: "confirmed", date: "2026-11-21", recorded: D, source_id: sid, by: "agent", note: null });
      f.rung = "confirmed";
    };
    expect(pubOf("RUNG_EVIDENCE", confirm(BIO, "s3"))).toEqual([]);
    const issues = pubOf("RUNG_EVIDENCE", confirm(BIO, "s1"));
    expect(pathsOf(issues)).toEqual([rungPath(BIO, 2)]);
    expect(issues[0]!.message).toContain("s1 is also the source of the earlier Checked entry, so it is the original's own");
    // Judged on the records being published and on every other record, as an error in both.
    expect(pubOf("RUNG_EVIDENCE", confirm(BIO, "s1"), null)).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", confirm(PHYS, "s1"))).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", confirm(PHYS, "s3"))).toEqual([]);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
    // Only the entries ahead of it count: the Preprint entry's source, a preprint, is no source for Confirmed whatever its place.
    expect(pubOf("RUNG_EVIDENCE", confirm(BIO, "s2"))).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", confirm(BIO, "s2"))[0]!.message).toContain("A preprint cannot show Confirmed.");
    // A Confirmed entry that comes before the Checked entry citing the same paper is not judged by it.
    expect(pubOf("RUNG_EVIDENCE", (w) => {
      const f = findingJson(w, BIO);
      f.rung_history = [
        { rung: "confirmed", date: "2026-10-01", recorded: "2026-10-05", source_id: "s1", by: "agent", note: null },
        { rung: "checked", date: "2026-11-20", recorded: D, source_id: "s1", by: "agent", note: null },
      ];
    })).toEqual([]);
  });

  it("leaves out a URL or a publisher a stored removed correction rewrote, and counts the need it served as met", () => {
    const gone = (path: string, id = "C-0003") => (w: WorldJson): void => {
      w.corrections.push(correctionJson(id, D, BIO, path, REMOVED_TEXT.en, "removed"));
      holdMarkers(w);
    };
    const urlRemoved = (w: WorldJson): void => {
      checker(BIO, REMOVED_TEXT.en)(w);
    };
    expect(pubOf("RUNG_EVIDENCE", (w) => urlRemoved(w))).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", (w) => { urlRemoved(w); gone("sources.0.url")(w); })).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { urlRemoved(w); gone("sources.1.url")(w); })).toHaveLength(1);
    const same = (w: WorldJson): void => {
      const f = findingJson(w, BIO);
      f.sources.push({ id: "s3", kind: "statement", title: "A made-up confirmation", publisher: REMOVED_TEXT.en, url: "https://example.org/paper/3", doi: null, published_at: "2026-11-21", seen_as: "pack", added: D });
      f.sources[0].publisher = REMOVED_TEXT.en;
      f.rung_history.push({ rung: "confirmed", date: "2026-11-21", recorded: D, source_id: "s3", by: "agent", note: null });
      f.rung = "confirmed";
    };
    expect(pubOf("RUNG_EVIDENCE", same)).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", (w) => { same(w); gone("sources.2.publisher")(w); })).toEqual([]);
    // Only the original's publisher removed: it is left out of the comparison, so the new one is independent of what is left.
    expect(pubOf("RUNG_EVIDENCE", (w) => { same(w); gone("sources.0.publisher")(w); })).toEqual([]);
    // A who name removed is left out as well.
    const whoSame = (w: WorldJson): void => {
      same(w);
      const f = findingJson(w, BIO);
      f.sources[0].publisher = "Example Journal";
      f.sources[2].publisher = "Example Lab";
    };
    expect(pubOf("RUNG_EVIDENCE", whoSame)).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", (w) => { whoSame(w); gone("who.0.name")(w); })).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { whoSame(w); gone("who.1.name")(w); })).toHaveLength(1);
    // A paper at the address of an original source is the same paper, unless a stored correction removed that address (or its own).
    const sameAddress = (w: WorldJson): void => {
      const f = findingJson(w, BIO);
      f.sources.push({ id: "s3", kind: "paper", title: "A made-up confirmation", publisher: "Confirming Journal", url: f.sources[0].url, doi: null, published_at: "2026-11-21", seen_as: "pack", added: D });
      f.rung_history.push({ rung: "confirmed", date: "2026-11-21", recorded: D, source_id: "s3", by: "agent", note: null });
      f.rung = "confirmed";
    };
    expect(pubOf("RUNG_EVIDENCE", sameAddress)).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", (w) => { sameAddress(w); gone("sources.0.url")(w); })).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { sameAddress(w); gone("sources.2.url")(w); })).toEqual([]);
    // The same DOI at two different URLs is the same paper too; a removed URL of either source leaves that source out whole, DOI included.
    const sameDoi = (w: WorldJson): void => {
      sameAddress(w);
      const f = findingJson(w, BIO);
      f.sources[0].doi = "10.1000/original.1";
      const s3 = f.sources.find((x: Json) => x.id === "s3")!;
      s3.url = "https://example.org/paper/other-address";
      s3.doi = "10.1000/original.1";
    };
    expect(pubOf("RUNG_EVIDENCE", sameDoi)).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", (w) => { sameDoi(w); gone("sources.0.url")(w); })).toEqual([]);
    expect(pubOf("RUNG_EVIDENCE", (w) => { sameDoi(w); gone("sources.2.url")(w); })).toEqual([]);
    // A correction alone leaves out nothing: the record still holds the original's publisher, so the new source is judged against it.
    const filedOnly = (path: string) => (w: WorldJson): void => { w.corrections.push(correctionJson("C-0003", D, BIO, path, REMOVED_TEXT.en, "removed")); };
    expect(pubOf("RUNG_EVIDENCE", (w) => { whoSame(w); filedOnly("who.0.name")(w); })).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", (w) => { checker(BIO)(w); filedOnly("sources.0.url")(w); })).toHaveLength(1);
    expect(pubOf("RUNG_EVIDENCE", (w) => { urlRemoved(w); filedOnly("sources.0.url")(w); })).toEqual([]);
  });
});

// ── RUNG_ORDER ───────────────────────────────────────────────────────────────────────────────────

describe("RUNG_ORDER in draft mode", () => {
  const history = (entries: [Rung, string][]) => (d: Json): void => {
    d.new_findings[0].rung_history = entries.map(([rung, date]) => ({ rung, date, source_id: "s1", note: null }));
  };
  const mathGiven = (): StoredRecords => stored([storedFinding(MATH, { title: l("A made-up proof"), depth: "item" })]);
  const returningOn = (date: string) => (d: Json): void => {
    d.returning[0].rung = { rung: "checked", date, source_id: "b1", note: null };
  };

  it("passes a new finding's entries in date order, an entry dated D and two entries on one date", () => {
    expect(draftOf("RUNG_ORDER", history([["preprint", "2026-11-18"], ["checked", "2026-11-20"], ["confirmed", D]]))).toEqual([]);
    expect(draftOf("RUNG_ORDER", history([["preprint", "2026-11-20"], ["checked", "2026-11-20"]]))).toEqual([]);
    expect(draftOf("RUNG_ORDER", history([["checked", D]]))).toEqual([]);
  });

  it("fails an entry dated after D, with the date and the edition's date in the message", () => {
    const issues = draftOf("RUNG_ORDER", history([["preprint", "2026-11-18"], ["checked", "2026-11-25"]]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "RUNG_ORDER", severity: "error", path: "new_findings[0].rung_history[1].date" });
    expect(issues[0]!.message).toBe("The Checked entry is dated 2026-11-25, after 2026-11-24, the edition's date.");
    expect(issues[0]!.hint).toBe("Date the entry with the event's own date, never one after the edition's.");
  });

  it("fails an entry dated before the one ahead of it, and reports each entry that breaks the order", () => {
    const issues = draftOf("RUNG_ORDER", history([["preprint", "2026-11-20"], ["checked", "2026-11-19"], ["confirmed", "2026-11-18"]]));
    expect(pathsOf(issues)).toEqual(["new_findings[0].rung_history[1].date", "new_findings[0].rung_history[2].date"]);
    expect(issues[0]!.message).toBe("The Checked entry is dated 2026-11-19, before the entry ahead of it, dated 2026-11-20. Rung entries run oldest first.");
    expect(issues[1]!.message).toBe("The Confirmed entry is dated 2026-11-18, before the entry ahead of it, dated 2026-11-19. Rung entries run oldest first.");
  });

  it("names an entry after D as after D, even where it is also out of order, and each later entry on its own", () => {
    const issues = draftOf("RUNG_ORDER", history([["preprint", "2026-11-26"], ["checked", "2026-11-25"], ["confirmed", "2026-11-24"]]));
    expect(issues.map((i) => i.message)).toEqual([
      "The Preprint entry is dated 2026-11-26, after 2026-11-24, the edition's date.",
      "The Checked entry is dated 2026-11-25, after 2026-11-24, the edition's date.",
      "The Confirmed entry is dated 2026-11-24, before the entry ahead of it, dated 2026-11-25. Rung entries run oldest first.",
    ]);
  });

  it("judges the entries a draft adds to a stored finding against D and the last entry the record holds", () => {
    // The stored math finding's last entry is dated 2026-11-20.
    for (const [date, fails] of [["2026-11-19", true], ["2026-11-20", false], ["2026-11-23", false], [D, false], ["2026-11-25", true]] as const) {
      expect(draftOf("RUNG_ORDER", returningOn(date), { stored: mathGiven() }), date).toHaveLength(fails ? 1 : 0);
    }
    const early = draftOf("RUNG_ORDER", returningOn("2026-11-19"), { stored: mathGiven() });
    expect(early[0]).toMatchObject({ path: "returning[0].rung.date" });
    expect(early[0]!.message).toBe("The Checked entry is dated 2026-11-19, before the entry ahead of it, dated 2026-11-20. Rung entries run oldest first.");
    // The ledger's full record of the stored finding (a report the context lists) gives the last entry as well: 2026-10-01.
    expect(draftOf("RUNG_ORDER", returningOn("2026-09-30"))).toHaveLength(1);
    expect(draftOf("RUNG_ORDER", returningOn("2026-10-01"))).toEqual([]);
  });

  it("judges a stored finding's returning entry and rung changes in the order the draft writes them", () => {
    const both = (returning: string, change: string) => (d: Json): void => {
      d.returning[0].rung = { rung: "checked", date: returning, source_id: "b1", note: null };
      d.rung_changes = [{ finding_id: MATH, rung: { rung: "confirmed", date: change, source_id: "b1", note: null } }];
    };
    expect(draftOf("RUNG_ORDER", both("2026-11-21", "2026-11-22"), { stored: mathGiven() })).toEqual([]);
    expect(pathsOf(draftOf("RUNG_ORDER", both("2026-11-22", "2026-11-21"), { stored: mathGiven() }))).toEqual(["rung_changes[0].rung.date"]);
  });

  it("knows no earlier entry of a finding it does not see, so only D bounds its dates", () => {
    const phys = (date: string) => (d: Json): void => { d.rung_changes[0].rung.date = date; };
    expect(draftOf("RUNG_ORDER", phys("2000-01-01"))).toEqual([]);
    expect(draftOf("RUNG_ORDER", phys(D))).toEqual([]);
    expect(draftOf("RUNG_ORDER", phys("2026-11-25"))).toHaveLength(1);
  });

  it("does not check that rung is the last entry's, which a draft never writes", () => {
    expect(draftOf("RUNG_ORDER", history([["checked", "2026-11-19"], ["disputed", "2026-11-20"]]))).toEqual([]);
  });
});

describe("RUNG_ORDER in published mode", () => {
  const datePath = (id: string, i: number): string => `findings/${id}.json: rung_history[${i}].date`;

  it("passes the stored world, whatever is being published", () => {
    expect(pubOf("RUNG_ORDER")).toEqual([]);
    expect(pubOf("RUNG_ORDER", () => {}, null)).toEqual([]);
  });

  it("fails entries out of date order in any record, each breaking entry once", () => {
    const swap = (id: string) => (w: WorldJson): void => {
      const f = findingJson(w, id);
      f.rung_history[0].date = "2026-11-21";
    };
    for (const id of [BIO, PHYS]) {
      const issues = pubOf("RUNG_ORDER", swap(id));
      expect(pathsOf(issues), id).toEqual([datePath(id, 1)]);
      expect(issues[0]!.message).toBe("The Checked entry is dated 2026-11-20, before the entry ahead of it, dated 2026-11-21. Rung entries run oldest first.");
    }
    expect(pubOf("RUNG_ORDER", (w) => { findingJson(w, BIO).rung_history[1].date = "2026-10-01"; })).toEqual([]);
  });

  it("takes the finding's updated as D: an entry may be dated on it, never after it", () => {
    const updated = (date: string) => (w: WorldJson): void => { findingJson(w, BIO).updated = date; };
    expect(pubOf("RUNG_ORDER", updated("2026-11-20"))).toEqual([]);
    const issues = pubOf("RUNG_ORDER", updated("2026-11-19"));
    expect(pathsOf(issues)).toEqual([datePath(BIO, 1)]);
    expect(issues[0]!.message).toBe("The Checked entry is dated 2026-11-20, after 2026-11-19, the date the finding was last updated.");
    expect(issues[0]!.hint).toBe("Date the entry with the event's own date, never one after the finding's last update.");
    expect(pubOf("RUNG_ORDER", updated("2026-09-01"))).toHaveLength(2);
  });

  it("fails a rung that is not the last entry's, at the finding's rung", () => {
    const issues = pubOf("RUNG_ORDER", (w) => { findingJson(w, BIO).rung = "preprint"; });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: `findings/${BIO}.json: rung`, severity: "error" });
    expect(issues[0]!.message).toBe(`${BIO} has rung Preprint but its last rung entry is Checked.`);
    expect(issues[0]!.hint).toBe("The rung is always the last rung entry's: set rung to that entry's rung, or add the entry that moved it.");
    expect(pubOf("RUNG_ORDER", (w) => { findingJson(w, PHYS).rung = "applied"; })).toHaveLength(1);
    expect(pubOf("RUNG_ORDER", (w) => {
      const f = findingJson(w, BIO);
      f.rung_history.push({ rung: "disputed", date: "2026-11-22", recorded: D, source_id: "s1", by: "agent", note: null });
    })).toHaveLength(1);
  });

  it("fails a stored brief's rung change dated after the brief", () => {
    const change = (date: string) => (w: WorldJson): void => { w.brief.rung_changes[0].date = date; };
    expect(pubOf("RUNG_ORDER", change(D))).toEqual([]);
    expect(pubOf("RUNG_ORDER", change("2026-11-01"))).toEqual([]);
    const issues = pubOf("RUNG_ORDER", change("2026-11-25"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: `briefs/${D}.json: rung_changes[0].date`, severity: "error" });
    expect(issues[0]!.message).toBe(`The rung change of ${PHYS} is dated 2026-11-25, after the brief's date ${D}.`);
  });
});

// ── CLAIMED_CAP ──────────────────────────────────────────────────────────────────────────────────

describe("CLAIMED_CAP in draft mode", () => {
  const sigPath = "new_findings[0].significance";
  const finding = (rung: Rung, significance: Significance, extra: [Rung, string][] = []) => (d: Json): void => {
    const n = d.new_findings[0];
    n.rung_history = [...extra, [rung, "2026-11-20"] as [Rung, string]].map(([r, date]) => ({ rung: r, date, source_id: "s1", note: null }));
    n.significance = significance;
  };

  it("caps a new finding at Claimed or Preprint at Notable, and no other rung at anything", () => {
    for (const rung of ALL_RUNGS) {
      for (const significance of SIGNIFICANCE) {
        const capped = (rung === "claimed" || rung === "preprint") && (significance === "landmark" || significance === "major");
        expect(draftOf("CLAIMED_CAP", finding(rung, significance)).length, `${rung} ${significance}`).toBe(capped ? 1 : 0);
      }
    }
  });

  it("names the finding, its significance and its rung, and says what to change", () => {
    const issues = draftOf("CLAIMED_CAP", finding("preprint", "major"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "CLAIMED_CAP", severity: "error", path: sigPath });
    expect(issues[0]!.message).toBe("new-1 is Major but its rung is Preprint. A finding at Claimed or Preprint is at most Notable.");
    expect(issues[0]!.hint).toBe("Set significance to notable or watch, or cite the record that shows a higher rung.");
  });

  it("reads a new finding's rung as its last entry's", () => {
    expect(draftOf("CLAIMED_CAP", finding("checked", "major", [["preprint", "2026-11-18"]]))).toEqual([]);
    expect(draftOf("CLAIMED_CAP", finding("preprint", "major", [["checked", "2026-11-18"]]))).toHaveLength(1);
    expect(draftOf("CLAIMED_CAP", finding("claimed", "landmark", [["claimed", "2026-11-18"], ["preprint", "2026-11-19"]]))).toHaveLength(1);
  });

  describe("a stored finding the draft corrects or moves", () => {
    // The context lists math-2026-0002 as a Notable preprint (and in a report in full) and phys-2026-0003 as a Major preprint.
    const noRung = (d: Json): void => { d.returning[0].rung = null; };

    it("fails a draft correction that raises a preprint finding to Major, and passes one to Notable or Watch", () => {
      for (const [after, fails] of [["landmark", true], ["major", true], ["notable", false], ["watch", false]] as const) {
        const issues = draftOf("CLAIMED_CAP", (d) => { noRung(d); d.corrections = [draftCorrection(MATH, "significance", after)]; });
        expect(issues, after).toHaveLength(fails ? 1 : 0);
      }
      const issues = draftOf("CLAIMED_CAP", (d) => { noRung(d); d.corrections = [draftCorrection(MATH, "significance", "major")]; });
      expect(issues[0]).toMatchObject({ path: "corrections[0].after" });
      expect(issues[0]!.message).toBe(`${MATH} is Major but its rung is Preprint. A finding at Claimed or Preprint is at most Notable.`);
      expect(issues[0]!.hint).toBe("Add a correction of significance to notable or watch, or drop the rung entry that moves it to Claimed or Preprint.");
    });

    it("counts a correction of any type but removed, and reads the one that files last", () => {
      for (const type of ["correction", "clarification", "update"]) {
        expect(draftOf("CLAIMED_CAP", (d) => { noRung(d); d.corrections = [draftCorrection(MATH, "significance", "major", type)]; }), type).toHaveLength(1);
      }
      expect(draftOf("CLAIMED_CAP", (d) => {
        noRung(d);
        d.corrections = [draftCorrection(MATH, "significance", "major"), draftCorrection(MATH, "significance", "watch")];
      })).toEqual([]);
      // The issue stands at the correction that files last, the one that raised the finding.
      const late = draftOf("CLAIMED_CAP", (d) => {
        noRung(d);
        d.corrections = [draftCorrection(MATH, "significance", "watch"), draftCorrection(MATH, "significance", "major")];
      });
      expect(pathsOf(late)).toEqual(["corrections[1].after"]);
    });

    it("judges a finding whose rung the same draft moves above Preprint by its new rung", () => {
      expect(draftOf("CLAIMED_CAP", (d) => { d.corrections = [draftCorrection(MATH, "significance", "major")]; })).toEqual([]);
      expect(draftOf("CLAIMED_CAP", (d) => {
        d.returning[0].rung = { rung: "preprint", date: "2026-11-23", source_id: "b1", note: null };
        d.corrections = [draftCorrection(MATH, "significance", "major")];
      })).toHaveLength(1);
    });

    it("judges a draft rung entry that moves a Major finding to Claimed or Preprint, and not one that moves it elsewhere", () => {
      const move = (rung: Rung) => (d: Json): void => { d.rung_changes[0].rung.rung = rung; };
      for (const rung of ALL_RUNGS) {
        const issues = draftOf("CLAIMED_CAP", move(rung));
        expect(issues, rung).toHaveLength(rung === "claimed" || rung === "preprint" ? 1 : 0);
      }
      const issues = draftOf("CLAIMED_CAP", move("preprint"));
      expect(issues[0]).toMatchObject({ path: "rung_changes[0].rung.rung" });
      expect(issues[0]!.message).toBe(`${PHYS} is Major but its rung is Preprint. A finding at Claimed or Preprint is at most Notable.`);
      expect(issues[0]!.hint).toBe("Add a correction of significance to notable or watch, or drop the rung entry that moves it to Claimed or Preprint.");
    });

    it("puts a wrong rung right with a rung entry and a correction that lowers the finding, and fails the entry alone", () => {
      const down = (d: Json): void => { d.rung_changes[0].rung.rung = "preprint"; };
      expect(draftOf("CLAIMED_CAP", down)).toHaveLength(1);
      expect(draftOf("CLAIMED_CAP", (d) => { down(d); d.corrections = [draftCorrection(PHYS, "significance", "notable")]; })).toEqual([]);
      // The entry the correction would excuse and a later entry back above Preprint: the last entry gives the rung.
      expect(draftOf("CLAIMED_CAP", (d) => {
        down(d);
        d.returning[0].rung = null;
        d.rung_changes.push({ finding_id: PHYS, rung: { rung: "checked", date: D, source_id: "b1", note: null } });
      })).toEqual([]);
    });

    it("leaves a stored finding the draft does not touch, whatever its rung and significance", () => {
      expect(draftOf("CLAIMED_CAP", (d) => { d.rung_changes = []; })).toEqual([]);
      expect(draftOf("CLAIMED_CAP", (d) => { d.rung_changes = []; d.corrections = [draftCorrection(PHYS, "field", "chemistry"), draftCorrection(PHYS, "subfield", "catalysis")]; })).toEqual([]);
    });

    it("cannot judge a finding whose significance the run does not know: a rung entry that moves it to Preprint leaves it alone, and never crashes the rule", () => {
      // phys-2026-0003 stays known through the rung proposals, but with no entry in the recent findings the context gives no significance.
      const quiet = contextWith((c) => { c.recent_findings = c.recent_findings.filter((f: Json) => f.id !== PHYS); });
      const down = (rung: Rung) => (d: Json): void => { d.rung_changes[0].rung.rung = rung; };
      expect(draftOf("CLAIMED_CAP", down("preprint"), { context: quiet })).toEqual([]);
      expect(draftOf("CLAIMED_CAP", down("claimed"), { context: quiet })).toEqual([]);
      // The same entry on the finding the context does give a significance for fails, so the quiet run left out a failure it could not see.
      expect(draftOf("CLAIMED_CAP", down("preprint"))).toHaveLength(1);
    });

    it("files a stored finding with the stored corrections too, when the run is given them", () => {
      const math = storedFinding(MATH, { title: l("A made-up proof"), depth: "item", significance: "notable", rung: "preprint", rung_history: [
        { rung: "preprint", date: "2026-10-01", recorded: "2026-10-02", source_id: "s2", by: "agent", note: null },
      ] });
      const raised = Correction.parse(correctionJson("C-0001", "2026-11-10", MATH, "significance", "major"));
      const down = (d: Json): void => { d.returning[0].rung = { rung: "preprint", date: "2026-11-23", source_id: "b1", note: null }; };
      expect(draftOf("CLAIMED_CAP", down, { stored: stored([math]) })).toEqual([]);
      expect(draftOf("CLAIMED_CAP", down, { stored: stored([math], [raised]) })).toHaveLength(1);
    });
  });
});

describe("CLAIMED_CAP in published mode", () => {
  const history = (rungs: Rung[], significance: Significance) => (w: WorldJson): void => {
    const f = findingJson(w, BIO);
    f.rung_history = rungs.map((rung, i) => ({ rung, date: `2026-11-${10 + i}`, recorded: D, source_id: "s1", by: "agent", note: null }));
    f.rung = rungs[rungs.length - 1];
    f.significance = significance;
  };

  it("caps a record whose history never passed Preprint at Notable, and lets any entry above Preprint end the cap", () => {
    for (const [rungs, significance, fails] of [
      [["preprint"], "major", true], [["claimed"], "landmark", true], [["claimed", "preprint"], "major", true],
      [["preprint"], "notable", false], [["claimed"], "watch", false],
      [["preprint", "checked"], "major", false], [["claimed", "checked", "preprint"], "landmark", false],
      [["preprint", "disputed"], "major", false], [["claimed", "retracted"], "landmark", false],
      [["checked"], "landmark", false], [["confirmed"], "major", false], [["applied"], "landmark", false],
    ] as [Rung[], Significance, boolean][]) {
      const issues = pubOf("CLAIMED_CAP", history(rungs, significance));
      expect(issues, `${rungs.join(">")} ${significance}`).toHaveLength(fails ? 1 : 0);
    }
  });

  it("names the record and the rung it ends on, and judges every record, the ones being published and the others", () => {
    const issues = pubOf("CLAIMED_CAP", history(["claimed", "preprint"], "major"));
    expect(issues[0]).toMatchObject({ path: `findings/${BIO}.json: significance`, severity: "error" });
    expect(issues[0]!.message).toBe(`${BIO} is Major but its rung is Preprint. A finding at Claimed or Preprint is at most Notable.`);
    expect(issues[0]!.hint).toBe("Lower significance to notable or watch with a correction; a finding that never passed Preprint is at most Notable.");
    expect(pubOf("CLAIMED_CAP", (w) => {
      const f = findingJson(w, PHYS);
      f.rung_history = [f.rung_history[0]];
      f.rung = "preprint";
    })).toHaveLength(1);
    expect(pubOf("CLAIMED_CAP", history(["preprint"], "major"), null)).toHaveLength(1);
  });

  it("reads significance as filed on the brief's date with the stored corrections, and no later one", () => {
    const raised = (date: string) => (w: WorldJson): void => {
      history(["preprint"], "notable")(w);
      w.corrections.push(correctionJson("C-0003", date, BIO, "significance", "major"));
    };
    expect(pubOf("CLAIMED_CAP", raised(D))).toHaveLength(1);
    expect(pubOf("CLAIMED_CAP", raised("2026-11-20"))).toHaveLength(1);
    expect(pubOf("CLAIMED_CAP", raised("2026-11-25"))).toEqual([]);
    // A correction that lowers a finding published above the cap puts it right.
    expect(pubOf("CLAIMED_CAP", (w) => {
      history(["preprint"], "major")(w);
      w.corrections.push(correctionJson("C-0003", "2026-11-20", BIO, "significance", "notable"));
    })).toEqual([]);
  });
});

// ── LANDMARK_BASIS ───────────────────────────────────────────────────────────────────────────────

const reaction = (sid: string, who: string, affiliation: string): Json => ({ source_id: sid, who, affiliation, quote: "a careful result" });

describe("LANDMARK_BASIS in draft mode", () => {
  const landmark = (reactions: Json[], rungs: Rung[] = ["checked"], who: string[] = ["Example Lab"]) => (d: Json): void => {
    const n = d.new_findings[1];
    n.reactions = reactions;
    n.rung_history = rungs.map((rung, i) => ({ rung, date: `2026-11-${10 + i}`, source_id: "s1", note: null }));
    n.who = who.map((name) => ({ name, ror: null }));
  };
  const two = [reaction("s2", "R. One", "First University"), reaction("s3", "R. Two", "Second University")];
  const sigPath = "new_findings[1].significance";

  it("passes a new Landmark with two reactions from two affiliations, none of them its own people", () => {
    expect(draftOf("LANDMARK_BASIS", landmark(two))).toEqual([]);
    expect(draftOf("LANDMARK_BASIS", landmark([...two, reaction("s2", "R. Three", "Third University")]))).toEqual([]);
  });

  it("fails one reaction, none, and two from one affiliation, whatever its case and spacing, with what the finding has in the message", () => {
    for (const reactions of [
      [], [two[0]!], [reaction("s2", "R. One", "First University"), reaction("s3", "R. Two", "First University")],
      [reaction("s2", "R. One", "First University"), reaction("s3", "R. Two", " first   UNIVERSITY ")],
      [reaction("s2", "R. One", "First University"), reaction("s3", "R. Two", `${String.fromCharCode(0xff26)}irst University`)],
    ]) {
      expect(draftOf("LANDMARK_BASIS", landmark(reactions)), JSON.stringify(reactions)).toHaveLength(1);
    }
    const one = draftOf("LANDMARK_BASIS", landmark([two[0]!]));
    expect(one[0]).toMatchObject({ code: "LANDMARK_BASIS", severity: "error", path: sigPath });
    expect(one[0]!.message).toBe("new-2 is a Landmark with rung Checked, which is not Confirmed or Applied, and its reactions come from 1 affiliation outside its who list (2 or more are needed).");
    expect(one[0]!.hint).toBe("Lower significance to major, or add reactions from 2 different affiliations, or cite the record that shows Confirmed or Applied.");
    expect(draftOf("LANDMARK_BASIS", landmark([]))[0]!.message).toContain("its reactions come from 0 affiliations outside its who list");
  });

  it("leaves out a reaction by one of the finding's own people or from their own affiliation, by who or by affiliation", () => {
    expect(draftOf("LANDMARK_BASIS", landmark([reaction("s2", "Example Lab", "First University"), two[1]!]))).toHaveLength(1);
    expect(draftOf("LANDMARK_BASIS", landmark([reaction("s2", "R. One", "Example Lab"), two[1]!]))).toHaveLength(1);
    expect(draftOf("LANDMARK_BASIS", landmark([reaction("s2", "R. One", "example  LAB"), two[1]!]))).toHaveLength(1);
    expect(draftOf("LANDMARK_BASIS", landmark([reaction("s2", "R. One", "First University"), reaction("s3", "A. Author", "Second University")], ["checked"], ["Example Lab", "A. Author"]))).toHaveLength(1);
    expect(draftOf("LANDMARK_BASIS", landmark(two, ["checked"], ["Example Lab", "Second University"]))).toHaveLength(1);
    // Only a name of the who list counts: a person who shares a surname does not.
    expect(draftOf("LANDMARK_BASIS", landmark([reaction("s2", "R. One", "First University"), reaction("s3", "Example", "Second University")]))).toEqual([]);
  });

  it("is held up by a rung of Confirmed or Applied, read as the last entry's, and by no other rung", () => {
    for (const rung of ALL_RUNGS) {
      const held = rung === "confirmed" || rung === "applied";
      expect(draftOf("LANDMARK_BASIS", landmark([], [rung])), rung).toHaveLength(held ? 0 : 1);
    }
    expect(draftOf("LANDMARK_BASIS", landmark([], ["confirmed", "disputed"]))).toHaveLength(1);
    expect(draftOf("LANDMARK_BASIS", landmark([], ["checked", "applied"]))).toEqual([]);
    expect(draftOf("LANDMARK_BASIS", landmark([], ["confirmed", "checked"]))).toHaveLength(1);
    expect(draftOf("LANDMARK_BASIS", landmark([], ["confirmed"]))[0]).toBeUndefined();
    expect(draftOf("LANDMARK_BASIS", landmark([], ["claimed"]))[0]!.message).toContain("rung Claimed");
  });

  it("judges a Landmark alone: a Major finding with no reaction passes", () => {
    for (const significance of SIGNIFICANCE) {
      const issues = draftOf("LANDMARK_BASIS", (d) => { landmark([])(d); d.new_findings[1].significance = significance; });
      expect(issues, significance).toHaveLength(significance === "landmark" ? 1 : 0);
    }
  });

  describe("a stored finding the draft refiles as a Landmark or moves down the ladder", () => {
    // Reactions and who are the record's: the run reads them from the stored records it is given.
    const record = (over: Json = {}): Finding => storedFinding(MATH, {
      title: l("A made-up proof"), depth: "item", significance: "major", rung: "checked", reactions: [two[0]!], who: [{ name: "Example Lab", ror: null }], ...over,
    });
    const noRung = (d: Json): void => { d.returning[0].rung = null; };
    const raise = (d: Json): void => { noRung(d); d.corrections = [draftCorrection(MATH, "significance", "landmark")]; };

    it("fails a correction that raises a finding with one reaction to a Landmark, at the correction's after", () => {
      const issues = draftOf("LANDMARK_BASIS", raise, { stored: stored([record()]) });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "LANDMARK_BASIS", path: "corrections[0].after" });
      expect(issues[0]!.message).toBe(`${MATH} is a Landmark with rung Checked, which is not Confirmed or Applied, and its reactions come from 1 affiliation outside its who list (2 or more are needed).`);
      expect(issues[0]!.hint).toBe("Add a correction of significance to major, or drop the rung entry that moves it to Checked.");
    });

    it("passes the correction when the finding has two affiliations behind it, or a rung of Confirmed or Applied", () => {
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([record({ reactions: two })]) })).toEqual([]);
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([record({ rung: "confirmed", rung_history: [
        { rung: "checked", date: "2026-11-10", recorded: "2026-11-10", source_id: "s1", by: "agent", note: null },
        { rung: "confirmed", date: "2026-11-12", recorded: "2026-11-12", source_id: "s1", by: "agent", note: null },
      ] })]) })).toEqual([]);
    });

    it("counts a correction of any type but removed, and files the finding as the last one does", () => {
      for (const type of ["clarification", "update"]) {
        expect(draftOf("LANDMARK_BASIS", (d) => { noRung(d); d.corrections = [draftCorrection(MATH, "significance", "landmark", type)]; }, { stored: stored([record()]) }), type).toHaveLength(1);
      }
      expect(draftOf("LANDMARK_BASIS", (d) => {
        noRung(d);
        d.corrections = [draftCorrection(MATH, "significance", "landmark"), draftCorrection(MATH, "significance", "major")];
      }, { stored: stored([record()]) })).toEqual([]);
      // The issue stands at the correction that files last, the one that made the finding a Landmark.
      const late = draftOf("LANDMARK_BASIS", (d) => {
        noRung(d);
        d.corrections = [draftCorrection(MATH, "significance", "major"), draftCorrection(MATH, "significance", "landmark")];
      }, { stored: stored([record()]) });
      expect(pathsOf(late)).toEqual(["corrections[1].after"]);
    });

    it("files the stored corrections as well: a Landmark made so by a stored correction is judged when the draft touches it", () => {
      const made = Correction.parse(correctionJson("C-0001", "2026-11-10", MATH, "significance", "landmark"));
      expect(draftOf("LANDMARK_BASIS", (d) => { noRung(d); d.corrections = [draftCorrection(MATH, "significance", "landmark")]; }, { stored: stored([record({ significance: "notable" })], [made]) })).toHaveLength(1);
      // Untouched by the draft, it is not judged again.
      expect(draftOf("LANDMARK_BASIS", noRung, { stored: stored([record({ significance: "notable" })], [made]) })).toEqual([]);
    });

    it("passes a clarification of the how_sure of a disputed Landmark with one reaction, which refiles nothing and moves nothing", () => {
      const disputed = record({
        significance: "landmark", rung: "disputed",
        rung_history: [
          { rung: "checked", date: "2026-11-10", recorded: "2026-11-10", source_id: "s1", by: "agent", note: null },
          { rung: "disputed", date: "2026-11-15", recorded: "2026-11-15", source_id: "s1", by: "agent", note: null },
        ],
      });
      expect(draftOf("LANDMARK_BASIS", (d) => {
        noRung(d);
        d.corrections = [draftCorrection(MATH, "explainer.how_sure", "Disputed. Example Journal posted a notice.", "clarification")];
      }, { stored: stored([disputed]) })).toEqual([]);
      // The same finding with a correction that refiles it as a Landmark is judged: the correction names it.
      expect(draftOf("LANDMARK_BASIS", (d) => {
        noRung(d);
        d.corrections = [draftCorrection(MATH, "significance", "landmark")];
      }, { stored: stored([disputed]) })).toHaveLength(1);
    });

    describe("a rung entry that moves it from Confirmed or Applied to Checked", () => {
      const held = (rung: Rung, over: Json = {}): Finding => record({
        significance: "landmark", rung,
        rung_history: [
          { rung: "checked", date: "2026-11-10", recorded: "2026-11-10", source_id: "s1", by: "agent", note: null },
          { rung, date: "2026-11-12", recorded: "2026-11-12", source_id: "s1", by: "agent", note: null },
        ],
        ...over,
      });
      const move = (rung: Rung, date = "2026-11-23") => (d: Json): void => { d.returning[0].rung = { rung, date, source_id: "b1", note: null }; };

      it("fails a Landmark with one reaction that falls to Checked, from Confirmed and from Applied, at the entry's rung", () => {
        for (const from of ["confirmed", "applied"] as const) {
          const issues = draftOf("LANDMARK_BASIS", move("checked"), { stored: stored([held(from)]) });
          expect(issues, from).toHaveLength(1);
          expect(issues[0]).toMatchObject({ code: "LANDMARK_BASIS", path: "returning[0].rung.rung" });
          expect(issues[0]!.message).toBe(`${MATH} is a Landmark with rung Checked, which is not Confirmed or Applied, and its reactions come from 1 affiliation outside its who list (2 or more are needed).`);
        }
      });

      it("passes it with a significance correction that lowers it, or with two reactions behind it", () => {
        expect(draftOf("LANDMARK_BASIS", (d) => { move("checked")(d); d.corrections = [draftCorrection(MATH, "significance", "major")]; }, { stored: stored([held("confirmed")]) })).toEqual([]);
        expect(draftOf("LANDMARK_BASIS", move("checked"), { stored: stored([held("confirmed", { reactions: two })]) })).toEqual([]);
      });

      it("judges nothing but a move to Checked from a rung that held it up", () => {
        for (const to of ALL_RUNGS) {
          expect(draftOf("LANDMARK_BASIS", move(to), { stored: stored([held("confirmed")]) }), to).toHaveLength(to === "checked" ? 1 : 0);
        }
        // A Landmark at Checked already, moved again to Checked, was not held up before.
        expect(draftOf("LANDMARK_BASIS", move("checked"), { stored: stored([record({ significance: "landmark" })]) })).toEqual([]);
      });

      it("reads the rung the draft's last entry leaves, over the stored one", () => {
        expect(draftOf("LANDMARK_BASIS", (d) => {
          move("checked")(d);
          d.rung_changes = [{ finding_id: MATH, rung: { rung: "confirmed", date: D, source_id: "b1", note: null } }];
        }, { stored: stored([held("confirmed")]) })).toEqual([]);
      });
    });

    it("judges what it cannot see no further: a stored finding without its reactions in the run is not judged", () => {
      expect(draftOf("LANDMARK_BASIS", (d) => { d.rung_changes[0].rung.rung = "retracted"; d.corrections = [draftCorrection(PHYS, "significance", "landmark")]; })).toEqual([]);
      expect(draftOf("LANDMARK_BASIS", raise)).toEqual([]);
    });

    it("leaves out reactions and who names a stored removed correction rewrote, counting a removed affiliation as one of its own", () => {
      const aff = (id: string, index = 0) => Correction.parse(correctionJson(id, "2026-11-12", MATH, `reactions.${index}.affiliation`, REMOVED_TEXT.en, "removed"));
      const dual = record({ reactions: [reaction("s1", "R. One", REMOVED_TEXT.en)] });
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([dual]) })).toHaveLength(1);
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([record({ reactions: [reaction("s1", "R. One", REMOVED_TEXT.en), two[1]!] })], [aff("C-0001")]) })).toEqual([]);
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([dual], [aff("C-0001")]) })).toHaveLength(1);
      // Two removals leave two affiliations that cannot be compared, each its own: a record that passed with two reactions still passes.
      const both = record({ reactions: [reaction("s1", "R. One", REMOVED_TEXT.en), reaction("s2", "R. Two", REMOVED_TEXT.en)] });
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([both], [aff("C-0001"), aff("C-0004", 1)]) })).toEqual([]);
      // A who name removed no longer counts someone's own: the reaction is then another team's.
      const own = record({ reactions: [reaction("s1", "R. One", "Example Lab"), two[1]!] });
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([own]) })).toHaveLength(1);
      const whoGone = Correction.parse(correctionJson("C-0002", "2026-11-12", MATH, "who.0.name", REMOVED_TEXT.en, "removed"));
      const ownRemoved = record({ reactions: [reaction("s1", "R. One", "Example Lab"), two[1]!], who: [{ name: REMOVED_TEXT.en, ror: null }] });
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([ownRemoved], [whoGone]) })).toEqual([]);
      // The correction alone leaves the name in: the record still holds "Example Lab" there, so the reaction is still its own team's.
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([own], [whoGone]) })).toHaveLength(1);
      // A reaction's who a removal rewrote is not compared with the who list, even where a name there reads the same.
      const alike = record({ who: [{ name: REMOVED_TEXT.en, ror: null }], reactions: [reaction("s1", REMOVED_TEXT.en, "First University"), two[1]!] });
      const whoRewritten = Correction.parse(correctionJson("C-0003", "2026-11-12", MATH, "reactions.0.who", REMOVED_TEXT.en, "removed"));
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([alike]) })).toHaveLength(1);
      expect(draftOf("LANDMARK_BASIS", raise, { stored: stored([alike], [whoRewritten]) })).toEqual([]);
    });
  });
});

describe("LANDMARK_BASIS in published mode", () => {
  const landmark = (reactions: Json[], rungs: Rung[], id = BIO) => (w: WorldJson): void => {
    const f = findingJson(w, id);
    f.significance = "landmark";
    f.reactions = reactions;
    f.rung_history = rungs.map((rung, i) => ({ rung, date: `2026-11-${10 + i}`, recorded: D, source_id: "s1", by: "agent", note: null }));
    f.rung = rungs[rungs.length - 1];
  };
  const two = [reaction("s2", "R. One", "First University"), reaction("s2", "R. Two", "Second University")];

  it("passes a Landmark with two affiliations behind it or a Confirmed or Applied entry in its history, and fails one with neither", () => {
    expect(pubOf("LANDMARK_BASIS", landmark(two, ["checked"]))).toEqual([]);
    expect(pubOf("LANDMARK_BASIS", landmark([two[0]!], ["checked"]))).toHaveLength(1);
    expect(pubOf("LANDMARK_BASIS", landmark([], ["checked"]))).toHaveLength(1);
    expect(pubOf("LANDMARK_BASIS", landmark([], ["checked", "confirmed"]))).toEqual([]);
    expect(pubOf("LANDMARK_BASIS", landmark([], ["applied", "checked"]))).toEqual([]);
    expect(pubOf("LANDMARK_BASIS", landmark([], ["checked", "applied"]))).toEqual([]);
    expect(pubOf("LANDMARK_BASIS", landmark([], ["claimed", "preprint", "checked", "disputed"]))).toHaveLength(1);
  });

  it("takes a history entry of Confirmed or Applied as holding a Landmark up after the rung has fallen", () => {
    expect(pubOf("LANDMARK_BASIS", landmark([], ["checked", "confirmed", "disputed"]))).toEqual([]);
    expect(pubOf("LANDMARK_BASIS", landmark([], ["checked", "confirmed", "retracted"]))).toEqual([]);
  });

  it("names the record, its last entry's rung and the affiliations it counted", () => {
    const issues = pubOf("LANDMARK_BASIS", landmark([two[0]!], ["checked", "disputed"]));
    expect(issues[0]).toMatchObject({ code: "LANDMARK_BASIS", severity: "error", path: `findings/${BIO}.json: significance` });
    expect(issues[0]!.message).toBe(`${BIO} is a Landmark with rung Disputed, which is not Confirmed or Applied, and its reactions come from 1 affiliation outside its who list (2 or more are needed).`);
    expect(issues[0]!.hint).toBe("Lower significance to major with a correction, or add the reactions or the record that holds it up.");
  });

  it("judges every record, the ones being published and the others, and counts reactions outside the who list alone", () => {
    expect(pubOf("LANDMARK_BASIS", landmark([two[0]!], ["checked"], PHYS))).toHaveLength(1);
    expect(pubOf("LANDMARK_BASIS", landmark([two[0]!], ["checked"]), null)).toHaveLength(1);
    expect(pubOf("LANDMARK_BASIS", (w) => { landmark(two, ["checked"])(w); findingJson(w, BIO).reactions[0].who = "Example Lab"; })).toHaveLength(1);
    expect(pubOf("LANDMARK_BASIS", (w) => { landmark(two, ["checked"])(w); findingJson(w, BIO).who.push({ name: "second university", ror: null }); })).toHaveLength(1);
  });

  it("reads significance as filed on the brief's date: a correction filed by then counts, a later one does not", () => {
    const filed = (date: string, after: string) => (w: WorldJson): void => {
      findingJson(w, BIO).reactions = [two[0]!];
      w.corrections.push(correctionJson("C-0003", date, BIO, "significance", after));
    };
    expect(pubOf("LANDMARK_BASIS", filed(D, "landmark"))).toHaveLength(1);
    expect(pubOf("LANDMARK_BASIS", filed("2026-11-20", "landmark"))).toHaveLength(1);
    expect(pubOf("LANDMARK_BASIS", filed("2026-11-25", "landmark"))).toEqual([]);
    // A correction that lowers a Landmark published without a basis puts it right.
    expect(pubOf("LANDMARK_BASIS", (w) => { landmark([two[0]!], ["checked"])(w); w.corrections.push(correctionJson("C-0003", "2026-11-20", BIO, "significance", "major")); })).toEqual([]);
  });

  it("judges a Major record never, whatever its reactions and rung", () => {
    expect(pubOf("LANDMARK_BASIS", (w) => { landmark([], ["claimed"])(w); findingJson(w, BIO).significance = "major"; })).toEqual([]);
  });
});

// ── NON_AI_LANDMARK_ONLY and SETBACK_MAJOR ───────────────────────────────────────────────────────

/** The `ai` block and the ai_helped text of a finding with this role: none has neither a confidence nor a system. */
function aiFor(role: string): { ai: Json; helped: string | null } {
  if (role === "none") return { ai: { role, confidence: null, systems: [], evidence: [] }, helped: null };
  return {
    ai: { role, confidence: "claimed", systems: [{ name: "Sample System 3", maker: "Example Lab" }], evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: true }] },
    helped: "Sample System 3, from Example Lab, did the work.",
  };
}

/** Sets a new finding's role, kind and significance. */
const setNew = (index: number, over: { role?: string; kind?: string; significance?: string }) => (d: Json): void => {
  const n = d.new_findings[index];
  if (over.role !== undefined) {
    const { ai, helped } = aiFor(over.role);
    n.ai = ai;
    n.explainer.ai_helped = helped;
  }
  if (over.kind !== undefined) n.kind = over.kind;
  if (over.significance !== undefined) n.significance = over.significance;
};

describe("NON_AI_LANDMARK_ONLY in draft mode", () => {
  it("fails a new finding with no AI role below Landmark, and passes every other role and significance", () => {
    for (const role of AI_ROLES) {
      for (const significance of SIGNIFICANCE) {
        const issues = draftOf("NON_AI_LANDMARK_ONLY", setNew(1, { role, significance }));
        expect(issues, `${role} ${significance}`).toHaveLength(role === "none" && significance !== "landmark" ? 1 : 0);
      }
    }
  });

  it("names the finding and its significance at the role, and says what to do", () => {
    const issues = draftOf("NON_AI_LANDMARK_ONLY", setNew(1, { significance: "notable" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "NON_AI_LANDMARK_ONLY", severity: "error", path: "new_findings[1].ai.role" });
    expect(issues[0]!.message).toBe("new-2 has ai.role none but is Notable. A finding with no AI role is only a Landmark.");
    expect(issues[0]!.hint).toBe("Give it the AI role its sources show, or file it as a Landmark if it changes its field; otherwise leave it out.");
  });

  describe("a stored finding in the story, an item or the deep dive, as filed on the edition's date", () => {
    const record = (over: Json = {}): Finding => storedFinding(MATH, { title: l("A made-up proof"), depth: "item", significance: "notable", ...over });
    const noRole = (id = MATH) => draftCorrection(id, "ai.role", "none");
    const brief = (d: Json): void => { d.returning[0].rung = null; };

    it("fails an item the draft's own correction files with no AI role below Landmark, and passes the correction without the item", () => {
      const issues = draftOf("NON_AI_LANDMARK_ONLY", (d) => { brief(d); d.corrections = [noRole()]; }, { stored: stored([record()]) });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "NON_AI_LANDMARK_ONLY", severity: "error", path: "items[1]" });
      expect(issues[0]!.message).toBe(`${MATH}, in an item, is filed on ${D} with no AI role and as Notable. A finding with no AI role is only a Landmark, so the brief may not show it.`);
      expect(issues[0]!.hint).toBe("Take it out of the story, the items and the deep dive.");
      // The spec's pair: the correction alone passes, the finding's own record being as published.
      const dropped = (d: Json): void => { d.items = ["new-2"]; d.returning = []; d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }]; d.corrections = [noRole()]; };
      expect(draftOf("NON_AI_LANDMARK_ONLY", dropped, { stored: stored([record()]) })).toEqual([]);
    });

    it("fails a later draft's returning item on the finding a stored correction refiled with no AI role", () => {
      const refiled = Correction.parse(correctionJson("C-0001", "2026-11-10", MATH, "ai.role", "none"));
      expect(draftOf("NON_AI_LANDMARK_ONLY", brief, { stored: stored([record()], [refiled]) })).toHaveLength(1);
      expect(draftOf("NON_AI_LANDMARK_ONLY", brief, { stored: stored([record()]) })).toEqual([]);
      expect(draftOf("NON_AI_LANDMARK_ONLY", brief, { stored: stored([record({ significance: "landmark" })], [refiled]) })).toEqual([]);
      // A stored correction dated after the edition does not file it yet.
      const later = Correction.parse(correctionJson("C-0001", "2026-11-25", MATH, "ai.role", "none"));
      expect(draftOf("NON_AI_LANDMARK_ONLY", brief, { stored: stored([record()], [later]) })).toEqual([]);
    });

    it("files significance with the draft's corrections too: a Landmark made one by the draft may be briefed with no AI role", () => {
      expect(draftOf("NON_AI_LANDMARK_ONLY", (d) => { brief(d); d.corrections = [noRole(), draftCorrection(MATH, "significance", "landmark")]; }, { stored: stored([record()]) })).toEqual([]);
      expect(draftOf("NON_AI_LANDMARK_ONLY", (d) => { brief(d); d.corrections = [noRole(), draftCorrection(MATH, "significance", "major")]; }, { stored: stored([record({ significance: "landmark" })]) })).toHaveLength(1);
    });

    it("judges the story and the deep dive as it does an item", () => {
      const asStory = (d: Json): void => { brief(d); d.story = MATH; d.items = ["new-1", "new-2"]; d.corrections = [noRole()]; };
      const story = draftOf("NON_AI_LANDMARK_ONLY", asStory, { stored: stored([record()]) });
      expect(pathsOf(story)).toEqual(["story"]);
      expect(story[0]!.message).toContain(`${MATH}, in the story, is filed on`);
      const dive = (d: Json): void => {
        brief(d);
        d.items = ["new-2"];
        d.returning = [];
        d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }];
        d.deep_dive = { finding_id: MATH, text: "A made-up deep dive.", source_ids: ["b1"], why_today: "rotation" };
        d.corrections = [noRole()];
      };
      const deep = draftOf("NON_AI_LANDMARK_ONLY", dive, { stored: stored([record()]) });
      expect(pathsOf(deep)).toEqual(["deep_dive"]);
      expect(deep[0]!.message).toContain(`${MATH}, in the deep dive, is filed on ${D} with no AI role and as Notable.`);
    });

    it("files a finding the context shows in part by what the draft's correction says, and skips one whose role it cannot know", () => {
      // phys-2026-0003: the context lists its significance (Major) and no role.
      const phys = (corrections: Json[]) => (d: Json): void => {
        d.items = ["new-2", PHYS];
        d.returning = [{ finding_id: PHYS, update: "A journal published the paper.", source_ids: ["b1"], rung: null }];
        d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }];
        d.corrections = corrections;
      };
      expect(draftOf("NON_AI_LANDMARK_ONLY", phys([]))).toEqual([]);
      const issues = draftOf("NON_AI_LANDMARK_ONLY", phys([noRole(PHYS)]));
      expect(pathsOf(issues)).toEqual(["items[1]"]);
      expect(issues[0]!.message).toContain("filed on 2026-11-24 with no AI role and as Major");
    });

    it("fails a stored finding published with no AI role below Landmark that the draft briefs, though no correction of the draft touches it", () => {
      const issues = draftOf("NON_AI_LANDMARK_ONLY", brief, { stored: stored([storedNoAi(MATH, { significance: "notable" })]) });
      expect(pathsOf(issues)).toEqual(["items[1]"]);
      expect(issues[0]!.message).toBe(`${MATH}, in an item, is filed on ${D} with no AI role and as Notable. A finding with no AI role is only a Landmark, so the brief may not show it.`);
      expect(draftOf("NON_AI_LANDMARK_ONLY", brief, { stored: stored([storedNoAi(MATH)]) })).toEqual([]);
    });

    it("judges what the run knows alone: a finding it shows no significance of is not told for its role", () => {
      // hum-2026-0005 is named by a standing story alone: the run knows neither its role nor its significance until the draft files them.
      const humans = (corrections: Json[]) => (d: Json): void => {
        d.items = ["new-2", "hum-2026-0005"];
        d.returning = [{ finding_id: "hum-2026-0005", update: "A journal published the paper.", source_ids: ["b1"], rung: null }];
        d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }];
        d.corrections = corrections;
      };
      expect(draftOf("NON_AI_LANDMARK_ONLY", humans([noRole("hum-2026-0005")]))).toEqual([]);
      expect(pathsOf(draftOf("NON_AI_LANDMARK_ONLY", humans([noRole("hum-2026-0005"), draftCorrection("hum-2026-0005", "significance", "notable")])))).toEqual(["items[1]"]);
    });

    it("leaves a finding the context does not list to REF_UNKNOWN", () => {
      expect(draftOf("NON_AI_LANDMARK_ONLY", (d) => {
        d.items = ["new-2", "bio-2099-0001"];
        d.returning = [{ finding_id: "bio-2099-0001", update: "A journal published the paper.", source_ids: ["b1"], rung: null }];
        d.corrections = [noRole("bio-2099-0001")];
      })).toEqual([]);
    });

    it("never reports the same finding twice for its own record and its place in the brief", () => {
      const issues = draftOf("NON_AI_LANDMARK_ONLY", (d) => { setNew(1, { significance: "notable" })(d); brief(d); });
      expect(pathsOf(issues)).toEqual(["new_findings[1].ai.role"]);
    });
  });
});

describe("NON_AI_LANDMARK_ONLY in published mode", () => {
  const noRole = (id: string, significance: string) => (w: WorldJson): void => {
    const f = findingJson(w, id);
    f.ai = { role: "none", confidence: null, systems: [], evidence: [] };
    f.explainer.ai_helped = null;
    f.significance = significance;
  };

  it("fails a record published with no AI role below Landmark, the ones being published and the others, and passes a Landmark", () => {
    for (const [id, significance, fails] of [[BIO, "major", true], [BIO, "watch", true], [BIO, "landmark", false], [PHYS, "notable", true], [PHYS, "landmark", false]] as const) {
      expect(pubOf("NON_AI_LANDMARK_ONLY", noRole(id, significance)), `${id} ${significance}`).toHaveLength(fails ? 1 : 0);
    }
    const issues = pubOf("NON_AI_LANDMARK_ONLY", noRole(PHYS, "notable"), null);
    expect(issues[0]).toMatchObject({ path: `findings/${PHYS}.json: ai.role`, severity: "error" });
    expect(issues[0]!.message).toBe(`${PHYS} has ai.role none but is Notable. A finding with no AI role is only a Landmark.`);
  });

  it("judges each stored finding of the brief's story, items and deep dive as filed on the brief's date, by the stored corrections", () => {
    // The record says `significance`; a stored correction files the AI role none from `date`. The stored world's older correction that
    // raises math-2026-0002 to Major is dropped so that the record's own significance is the one filed.
    const filed = (id: string, date: string, significance = "notable") => (w: WorldJson): void => {
      w.corrections = w.corrections.filter((c) => !(c.finding_id === id && c.path === "significance"));
      findingJson(w, id).significance = significance;
      w.corrections.push(correctionJson("C-0003", date, id, "ai.role", "none"));
    };
    const issues = pubOf("NON_AI_LANDMARK_ONLY", filed(MATH, D));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: `briefs/${D}.json: items[0]`, severity: "error" });
    expect(issues[0]!.message).toBe(`${MATH}, in an item, is filed on ${D} with no AI role and as Notable. A finding with no AI role is only a Landmark, so the brief may not show it.`);
    expect(pubOf("NON_AI_LANDMARK_ONLY", filed(MATH, "2026-11-20"))).toHaveLength(1);
    expect(pubOf("NON_AI_LANDMARK_ONLY", filed(MATH, "2026-11-25"))).toEqual([]);
    expect(pubOf("NON_AI_LANDMARK_ONLY", filed(MATH, D, "landmark"))).toEqual([]);
    expect(pathsOf(pubOf("NON_AI_LANDMARK_ONLY", filed(BIO, D, "major")))).toEqual([`briefs/${D}.json: story`]);
    expect(pubOf("NON_AI_LANDMARK_ONLY", filed(MATH, D), null)).toHaveLength(1);
    // A finding no item, story or deep dive of the brief shows is judged on its own record alone.
    expect(pubOf("NON_AI_LANDMARK_ONLY", (w) => { filed(MATH, D)(w); w.brief.items = [w.brief.items[1]]; })).toEqual([]);
    const dive = pubOf("NON_AI_LANDMARK_ONLY", (w) => {
      filed(MATH, D)(w);
      w.brief.items = [w.brief.items[1]];
      w.brief.deep_dive = { finding_id: MATH, text: l("A made-up deep dive."), source_ids: ["b1"], why_today: "rotation" };
    });
    expect(pathsOf(dive)).toEqual([`briefs/${D}.json: deep_dive`]);
  });

  it("reports a record that breaks the rule as published once, and not again for its place in the brief", () => {
    const issues = pubOf("NON_AI_LANDMARK_ONLY", noRole(MATH, "notable"));
    expect(pathsOf(issues)).toEqual([`findings/${MATH}.json: ai.role`]);
  });
});

describe("SETBACK_MAJOR in draft mode", () => {
  const setup = (kind: FindingKind, role: string, significance: Significance) => setNew(0, { kind, role, significance });

  it("fails a new setback with no AI role or below Major, and nothing else, over every kind, role and significance", () => {
    for (const kind of FINDING_KINDS) {
      for (const role of ["none", "ai_tool"]) {
        for (const significance of SIGNIFICANCE) {
          const fails = kind === "setback" && (role === "none" || significance === "notable" || significance === "watch");
          expect(draftOf("SETBACK_MAJOR", setup(kind, role, significance)), `${kind} ${role} ${significance}`).toHaveLength(fails ? 1 : 0);
        }
      }
    }
  });

  it("names the reasons in one issue, at the role when it is none and at the significance otherwise", () => {
    const both = draftOf("SETBACK_MAJOR", setup("setback", "none", "notable"));
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ code: "SETBACK_MAJOR", severity: "error", path: "new_findings[0].ai.role" });
    expect(both[0]!.message).toBe("new-1 is a setback that has no AI role and is Notable, below Major. A setback has an AI role and is Major or Landmark.");
    expect(both[0]!.hint).toBe("Give it the AI role its sources show and raise its significance, or file it as another kind.");
    expect(draftOf("SETBACK_MAJOR", setup("setback", "none", "major"))[0]!.message).toBe("new-1 is a setback that has no AI role. A setback has an AI role and is Major or Landmark.");
    const low = draftOf("SETBACK_MAJOR", setup("setback", "ai_tool", "watch"));
    expect(low[0]).toMatchObject({ path: "new_findings[0].significance" });
    expect(low[0]!.message).toBe("new-1 is a setback that is Watch, below Major. A setback has an AI role and is Major or Landmark.");
  });

  describe("a stored finding in the story, an item or the deep dive, as filed on the edition's date", () => {
    const record = (over: Json = {}): Finding => storedFinding(MATH, { title: l("A made-up proof"), depth: "item", significance: "major", ...over });
    const brief = (d: Json): void => { d.returning[0].rung = null; };

    it("fails an item the draft's own corrections file as a setback below Major, or with no AI role", () => {
      const issues = draftOf("SETBACK_MAJOR", (d) => { brief(d); d.corrections = [draftCorrection(MATH, "kind", "setback"), draftCorrection(MATH, "significance", "notable")]; }, { stored: stored([record()]) });
      expect(pathsOf(issues)).toEqual(["items[1]"]);
      expect(issues[0]!.message).toBe(`${MATH}, in an item, is filed on ${D} as a setback that is Notable, below Major. A setback has an AI role and is Major or Landmark, so the brief may not show it.`);
      expect(issues[0]!.hint).toBe("Take it out of the story, the items and the deep dive.");
      const bare = draftOf("SETBACK_MAJOR", (d) => { brief(d); d.corrections = [draftCorrection(MATH, "kind", "setback"), draftCorrection(MATH, "ai.role", "none")]; }, { stored: stored([record()]) });
      expect(bare[0]!.message).toContain("as a setback that has no AI role.");
      const both = draftOf("SETBACK_MAJOR", (d) => { brief(d); d.corrections = [draftCorrection(MATH, "kind", "setback"), draftCorrection(MATH, "ai.role", "none"), draftCorrection(MATH, "significance", "watch")]; }, { stored: stored([record()]) });
      expect(both[0]!.message).toContain("as a setback that has no AI role and is Watch, below Major.");
    });

    it("passes a stored setback at Major with an AI role, a correction that is not briefed, and a finding filed as another kind", () => {
      const setback = (d: Json): void => { brief(d); d.corrections = [draftCorrection(MATH, "kind", "setback")]; };
      expect(draftOf("SETBACK_MAJOR", setback, { stored: stored([record()]) })).toEqual([]);
      expect(draftOf("SETBACK_MAJOR", (d) => { setback(d); d.corrections.push(draftCorrection(MATH, "significance", "landmark")); }, { stored: stored([record()]) })).toEqual([]);
      const dropped = (d: Json): void => { d.items = ["new-2"]; d.returning = []; d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }]; d.corrections = [draftCorrection(MATH, "kind", "setback"), draftCorrection(MATH, "significance", "notable")]; };
      expect(draftOf("SETBACK_MAJOR", dropped, { stored: stored([record()]) })).toEqual([]);
      expect(draftOf("SETBACK_MAJOR", (d) => { brief(d); d.corrections = [draftCorrection(MATH, "significance", "notable")]; }, { stored: stored([record()]) })).toEqual([]);
    });

    it("files the stored corrections as well, and reads the kind of a finding the context shows in part from the draft's correction alone", () => {
      const made = Correction.parse(correctionJson("C-0001", "2026-11-10", MATH, "kind", "setback"));
      expect(draftOf("SETBACK_MAJOR", (d) => { brief(d); d.corrections = [draftCorrection(MATH, "significance", "notable")]; }, { stored: stored([record()], [made]) })).toHaveLength(1);
      expect(draftOf("SETBACK_MAJOR", brief, { stored: stored([record()], [made]) })).toEqual([]);
      // phys-2026-0003: Major and no role in the context. Refiled as a setback and Notable, it is below Major whatever its role.
      const phys = (corrections: Json[]) => (d: Json): void => {
        d.items = ["new-2", PHYS];
        d.returning = [{ finding_id: PHYS, update: "A journal published the paper.", source_ids: ["b1"], rung: null }];
        d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }];
        d.corrections = corrections;
      };
      expect(draftOf("SETBACK_MAJOR", phys([draftCorrection(PHYS, "kind", "setback")]))).toEqual([]);
      expect(pathsOf(draftOf("SETBACK_MAJOR", phys([draftCorrection(PHYS, "kind", "setback"), draftCorrection(PHYS, "significance", "notable")])))).toEqual(["items[1]"]);
      expect(pathsOf(draftOf("SETBACK_MAJOR", phys([draftCorrection(PHYS, "kind", "setback"), draftCorrection(PHYS, "ai.role", "none")])))).toEqual(["items[1]"]);
    });

    it("judges the story and the deep dive as it does an item", () => {
      const corrections = [draftCorrection(MATH, "kind", "setback"), draftCorrection(MATH, "significance", "notable")];
      const story = draftOf("SETBACK_MAJOR", (d) => { brief(d); d.story = MATH; d.items = ["new-1", "new-2"]; d.corrections = corrections; }, { stored: stored([record()]) });
      expect(pathsOf(story)).toEqual(["story"]);
      expect(story[0]!.message).toContain(`${MATH}, in the story, is filed on`);
      const deep = draftOf("SETBACK_MAJOR", (d) => {
        brief(d);
        d.items = ["new-2"];
        d.returning = [];
        d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }];
        d.deep_dive = { finding_id: MATH, text: "A made-up deep dive.", source_ids: ["b1"], why_today: "rotation" };
        d.corrections = corrections;
      }, { stored: stored([record()]) });
      expect(pathsOf(deep)).toEqual(["deep_dive"]);
      expect(deep[0]!.message).toContain(`${MATH}, in the deep dive, is filed on`);
    });

    it("fails a stored setback published below Major or with no AI role that the draft briefs, though no correction of the draft touches it", () => {
      const issues = draftOf("SETBACK_MAJOR", brief, { stored: stored([record({ kind: "setback", significance: "notable" })]) });
      expect(pathsOf(issues)).toEqual(["items[1]"]);
      expect(issues[0]!.message).toBe(`${MATH}, in an item, is filed on ${D} as a setback that is Notable, below Major. A setback has an AI role and is Major or Landmark, so the brief may not show it.`);
      expect(draftOf("SETBACK_MAJOR", brief, { stored: stored([record({ kind: "setback", significance: "major" })]) })).toEqual([]);
    });

    it("judges what the run knows alone: a finding it shows no significance of is told for its role and not for its significance", () => {
      // hum-2026-0005 is named by a standing story alone: the run knows nothing of it until the draft files a kind, a role or a significance.
      const humans = (corrections: Json[]) => (d: Json): void => {
        d.items = ["new-2", "hum-2026-0005"];
        d.returning = [{ finding_id: "hum-2026-0005", update: "A journal published the paper.", source_ids: ["b1"], rung: null }];
        d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }];
        d.corrections = corrections;
      };
      const setback = draftCorrection("hum-2026-0005", "kind", "setback");
      expect(draftOf("SETBACK_MAJOR", humans([setback]))).toEqual([]);
      const issues = draftOf("SETBACK_MAJOR", humans([setback, draftCorrection("hum-2026-0005", "ai.role", "none")]));
      expect(pathsOf(issues)).toEqual(["items[1]"]);
      expect(issues[0]!.message).toBe(`hum-2026-0005, in an item, is filed on ${D} as a setback that has no AI role. A setback has an AI role and is Major or Landmark, so the brief may not show it.`);
    });

    it("never reports a new setback twice", () => {
      expect(pathsOf(draftOf("SETBACK_MAJOR", (d) => { setup("setback", "none", "watch")(d); brief(d); }))).toEqual(["new_findings[0].ai.role"]);
    });
  });
});

describe("SETBACK_MAJOR in published mode", () => {
  const setback = (id: string, role: string, significance: string) => (w: WorldJson): void => {
    const f = findingJson(w, id);
    f.kind = "setback";
    f.significance = significance;
    if (role === "none") {
      f.ai = { role: "none", confidence: null, systems: [], evidence: [] };
      f.explainer.ai_helped = null;
    }
  };

  it("fails a record published as a setback with no AI role or below Major, the ones being published and the others", () => {
    for (const [id, role, significance, fails] of [
      [BIO, "ai_solved", "major", false], [BIO, "ai_solved", "landmark", false], [BIO, "ai_solved", "notable", true], [BIO, "none", "major", true],
      [PHYS, "ai_solved", "watch", true], [PHYS, "none", "landmark", true], [PHYS, "ai_solved", "major", false],
    ] as const) {
      expect(pubOf("SETBACK_MAJOR", setback(id, role, significance)), `${id} ${role} ${significance}`).toHaveLength(fails ? 1 : 0);
    }
    const issues = pubOf("SETBACK_MAJOR", setback(PHYS, "none", "notable"), null);
    expect(issues[0]).toMatchObject({ path: `findings/${PHYS}.json: ai.role`, severity: "error" });
    expect(issues[0]!.message).toBe(`${PHYS} is a setback that has no AI role and is Notable, below Major. A setback has an AI role and is Major or Landmark.`);
  });

  it("judges each stored finding of the brief as filed on the brief's date, by the stored corrections", () => {
    // The record says Notable; a stored correction files it as a setback from `date`. The stored world's older correction that raises
    // math-2026-0002 to Major is dropped so that the record's own significance is the one filed.
    const filed = (date: string) => (w: WorldJson): void => {
      w.corrections = w.corrections.filter((c) => !(c.finding_id === MATH && c.path === "significance"));
      findingJson(w, MATH).significance = "notable";
      w.corrections.push(correctionJson("C-0003", date, MATH, "kind", "setback"));
    };
    const issues = pubOf("SETBACK_MAJOR", filed(D));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: `briefs/${D}.json: items[0]`, severity: "error" });
    expect(issues[0]!.message).toBe(`${MATH}, in an item, is filed on ${D} as a setback that is Notable, below Major. A setback has an AI role and is Major or Landmark, so the brief may not show it.`);
    expect(pubOf("SETBACK_MAJOR", filed("2026-11-25"))).toEqual([]);
    expect(pubOf("SETBACK_MAJOR", (w) => { filed(D)(w); w.corrections.push(correctionJson("C-0004", D, MATH, "significance", "major")); })).toEqual([]);
  });

  it("reports a record that breaks the rule as published once", () => {
    expect(pathsOf(pubOf("SETBACK_MAJOR", setback(MATH, "ai_solved", "watch")))).toEqual([`findings/${MATH}.json: significance`]);
  });
});

// ── AI_CONFIDENCE ────────────────────────────────────────────────────────────────────────────────

/** A new finding's `ai` block and ai_helped for `role` with this confidence and one evidence entry per flag (`from_claimant`). */
const withAi = (index: number, role: string, confidence: string | null, flags: boolean[] = [false]) => (d: Json): void => {
  const n = d.new_findings[index];
  const { ai, helped } = aiFor(role);
  n.ai = { ...ai, confidence };
  if (role !== "none") n.ai.evidence = flags.map((from_claimant, i) => ({ source_id: "s1", quote: `the system solved it ${i}`, from_claimant }));
  n.explainer.ai_helped = helped;
};

/** An edit of a new finding's explainer. */
const explainer = (index: number, over: Json) => (d: Json): void => { Object.assign(d.new_findings[index].explainer, over); };

/** The `ai` block of a finding published with no AI role. */
const NO_AI: Json = { role: "none", confidence: null, systems: [], evidence: [] };

/** A stored finding published with no AI role (so no ai_helped): a Landmark unless `over` says otherwise. */
function storedNoAi(id = MATH, over: Json = {}): Finding {
  const base = storedFinding(id);
  return storedFinding(id, {
    title: l("A made-up proof"), depth: "item", significance: "landmark", ai: structuredClone(NO_AI), explainer: { ...base.explainer, ai_helped: null }, ...over,
  });
}

/**
 * `draftOf` for a draft the schema would refuse (a `removed` correction on a vocabulary path, which `DraftBrief` stops before any rule runs):
 * what is tested is the rule's own guard, as the spec words it ("a correction of any type but `removed`").
 */
function rawOf(code: string, edit: Edit, over: Partial<DraftInputs> = {}): ValidationIssue[] {
  const d = baseDraft();
  edit(d);
  return ownIssues(code, runRules(buildDraftInput(d as DraftBrief, { ...draftInputs(), ...over }), [rule(code)]));
}

/** A draft whose only corrections are `list`, with the returning entry's rung taken out (it is not what these tests judge). */
const onlyCorrections = (...list: Json[]) => (d: Json): void => { d.returning[0].rung = null; d.corrections = list; };

describe("AI_CONFIDENCE in draft mode", () => {
  const confidencePath = "new_findings[0].ai.confidence";

  it("needs a null confidence for none and a confidence for every other role, over every role and confidence", () => {
    for (const role of AI_ROLES) {
      for (const confidence of [null, "claimed", "confirmed"]) {
        // A role of none with Confirmed breaks both sentences of the row: its confidence is not null and it has no evidence from someone else.
        const expected = role === "none" ? (confidence === null ? 0 : confidence === "claimed" ? 1 : 2) : confidence === null ? 1 : 0;
        expect(draftOf("AI_CONFIDENCE", withAi(0, role, confidence)), `${role} ${confidence}`).toHaveLength(expected);
      }
    }
  });

  it("names the finding and the pair it found, at the confidence, and says what to set", () => {
    const none = draftOf("AI_CONFIDENCE", withAi(0, "none", "claimed"));
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ code: "AI_CONFIDENCE", severity: "error", path: confidencePath });
    expect(none[0]!.message).toBe("new-1 has ai.role none but ai.confidence claimed. With no AI role the confidence is null.");
    expect(none[0]!.hint).toBe("Set ai.confidence to null, or give the AI role the sources show.");
    const bare = draftOf("AI_CONFIDENCE", withAi(0, "ai_solved", null));
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatchObject({ path: confidencePath });
    expect(bare[0]!.message).toBe("new-1 has ai.role ai_solved but ai.confidence null. Only no AI role has a null confidence.");
    expect(bare[0]!.hint).toBe("Set ai.confidence to claimed, or to confirmed when a source from someone other than the claimant backs it.");
    const both = draftOf("AI_CONFIDENCE", withAi(0, "none", "confirmed"));
    expect(both.map((i) => i.message).sort()).toEqual([
      "new-1 has ai.confidence confirmed but no ai.evidence entry from a source other than the claimant (from_claimant false).",
      "new-1 has ai.role none but ai.confidence confirmed. With no AI role the confidence is null.",
    ]);
  });

  it("makes Confirmed need an evidence entry from someone other than the claimant, and Claimed need none", () => {
    for (const [flags, fails] of [[[true], true], [[true, true], true], [[false], false], [[true, false], false], [[false, true], false]] as [boolean[], boolean][]) {
      expect(draftOf("AI_CONFIDENCE", withAi(0, "ai_solved", "confirmed", flags)), `confirmed ${JSON.stringify(flags)}`).toHaveLength(fails ? 1 : 0);
      expect(draftOf("AI_CONFIDENCE", withAi(0, "ai_solved", "claimed", flags)), `claimed ${JSON.stringify(flags)}`).toEqual([]);
    }
    const issue = draftOf("AI_CONFIDENCE", withAi(0, "ai_solved", "confirmed", [true]));
    expect(issue[0]).toMatchObject({ code: "AI_CONFIDENCE", severity: "error", path: confidencePath });
    expect(issue[0]!.message).toBe("new-1 has ai.confidence confirmed but no ai.evidence entry from a source other than the claimant (from_claimant false).");
    expect(issue[0]!.hint).toBe("Add an evidence quote from a source by someone other than the maker or the lab, or set ai.confidence to claimed.");
  });

  it("judges a new finding's own pair alone: a stored finding the draft names, as the run shows it, is not judged again", () => {
    const broken = storedFinding(MATH, { title: l("A made-up proof"), depth: "item", ai: { role: "ai_solved", confidence: "confirmed", systems: [{ name: "Sample System 3", maker: "Example Lab" }], evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: true }] } });
    expect(draftOf("AI_CONFIDENCE", () => {}, { stored: stored([broken]) })).toEqual([]);
  });

  describe("a correction on ai.role or ai.confidence", () => {
    const roleTo = (role: string, type = "correction") => onlyCorrections(draftCorrection(MATH, "ai.role", role, type));

    it("fails a correction that gives a finding published with no AI role an AI role, for every role but none and every type but removed", () => {
      for (const role of AI_ROLES) {
        for (const type of ["correction", "clarification", "update"]) {
          const issues = draftOf("AI_CONFIDENCE", roleTo(role, type), { stored: stored([storedNoAi()]) });
          expect(issues, `${role} ${type}`).toHaveLength(role === "none" ? 0 : 1);
        }
      }
      const issues = draftOf("AI_CONFIDENCE", roleTo("ai_tool"), { stored: stored([storedNoAi()]) });
      expect(issues[0]).toMatchObject({ code: "AI_CONFIDENCE", severity: "error", path: "corrections[0].after" });
      expect(issues[0]!.message).toBe(`The correction gives ${MATH} the AI role ai_tool, but it was published with ai.role none, which has no evidence, system or ai_helped to be filed with.`);
      expect(issues[0]!.hint).toBe("Do not correct the role. Tell the later finding in a clarification of its explainer.found.");
    });

    it("skips a removed correction, which refiles nothing", () => {
      expect(rawOf("AI_CONFIDENCE", roleTo("ai_tool", "removed"), { stored: stored([storedNoAi()]) })).toEqual([]);
      expect(rawOf("AI_CONFIDENCE", roleTo("ai_tool"), { stored: stored([storedNoAi()]) })).toHaveLength(1);
    });

    it("reads the role the finding was published with from the context when the run was not given the stored record", () => {
      const none = contextWith((c) => {
        const f = c.reports.find((r: Json) => r.finding_id === MATH).finding;
        f.ai = structuredClone(NO_AI);
        f.explainer.ai_helped = null;
      });
      expect(draftOf("AI_CONFIDENCE", roleTo("ai_tool"), { context: none })).toHaveLength(1);
      expect(draftOf("AI_CONFIDENCE", roleTo("none"), { context: none })).toEqual([]);
      expect(draftOf("AI_CONFIDENCE", roleTo("ai_tool"))).toEqual([]);
    });

    it("passes the same correction on a finding published with an AI role, one the context shows no role of, and a finding the context does not list", () => {
      expect(draftOf("AI_CONFIDENCE", roleTo("ai_tool"), { stored: stored([storedFinding(MATH, { title: l("A made-up proof"), depth: "item" })]) })).toEqual([]);
      expect(draftOf("AI_CONFIDENCE", onlyCorrections(draftCorrection(PHYS, "ai.role", "ai_tool")))).toEqual([]);
      expect(draftOf("AI_CONFIDENCE", onlyCorrections(draftCorrection("bio-2099-0001", "ai.role", "ai_tool")))).toEqual([]);
    });

    it("tells an AI role found later in a clarification of explainer.found, which it passes, and judges no other path", () => {
      for (const path of ["explainer.found", "explainer.how_sure", "significance", "field", "kind"]) {
        const after = path === "significance" ? "major" : path === "field" ? "chemistry" : path === "kind" ? "capability" : "A later fact about the system.";
        expect(draftOf("AI_CONFIDENCE", onlyCorrections(draftCorrection(MATH, path, after, "clarification")), { stored: stored([storedNoAi()]) }), path).toEqual([]);
      }
    });

    describe("on ai.confidence", () => {
      const confidenceTo = (after: string, type = "correction") => draftCorrection(MATH, "ai.confidence", after, type);
      const published = (): Finding => storedFinding(MATH, { title: l("A made-up proof"), depth: "item" });
      const refiled = (date: string): Correction => Correction.parse(correctionJson("C-0001", date, MATH, "ai.role", "none"));

      it("fails a finding published with no AI role, for either confidence and every type but removed", () => {
        for (const after of ["claimed", "confirmed"]) {
          for (const type of ["correction", "clarification", "update"]) {
            expect(draftOf("AI_CONFIDENCE", onlyCorrections(confidenceTo(after, type)), { stored: stored([storedNoAi()]) }), `${after} ${type}`).toHaveLength(1);
          }
        }
        expect(rawOf("AI_CONFIDENCE", onlyCorrections(confidenceTo("claimed", "removed")), { stored: stored([storedNoAi()]) })).toEqual([]);
        const issues = draftOf("AI_CONFIDENCE", onlyCorrections(confidenceTo("confirmed")), { stored: stored([storedNoAi()]) });
        expect(issues[0]).toMatchObject({ code: "AI_CONFIDENCE", severity: "error", path: "corrections[0].after" });
        expect(issues[0]!.message).toBe(`The correction sets ai.confidence of ${MATH} to confirmed, but the finding is filed with ai.role none, so its confidence is null.`);
        expect(issues[0]!.hint).toBe("Drop the correction of ai.confidence: a finding with no AI role has none.");
      });

      it("fails a finding a stored correction refiled with none, from the day it was dated, and passes one that no correction refiled or that one dated later refiles", () => {
        expect(draftOf("AI_CONFIDENCE", onlyCorrections(confidenceTo("claimed")), { stored: stored([published()], [refiled("2026-11-10")]) })).toHaveLength(1);
        expect(draftOf("AI_CONFIDENCE", onlyCorrections(confidenceTo("claimed")), { stored: stored([published()], [refiled(D)]) })).toHaveLength(1);
        expect(draftOf("AI_CONFIDENCE", onlyCorrections(confidenceTo("claimed")), { stored: stored([published()], [refiled("2026-11-25")]) })).toEqual([]);
        expect(draftOf("AI_CONFIDENCE", onlyCorrections(confidenceTo("claimed")), { stored: stored([published()]) })).toEqual([]);
      });

      it("does not take a finding published with an AI role and refiled with none for one published with none, whatever correction gives the role back", () => {
        expect(draftOf("AI_CONFIDENCE", roleTo("ai_tool"), { stored: stored([published()], [refiled("2026-11-10")]) })).toEqual([]);
      });

      it("fails a finding the draft's own correction refiles with none, at the correction of the confidence alone", () => {

        const issues = draftOf("AI_CONFIDENCE", onlyCorrections(draftCorrection(MATH, "ai.role", "none"), confidenceTo("claimed")), { stored: stored([published()]) });
        expect(pathsOf(issues)).toEqual(["corrections[1].after"]);
        // Given the AI role back by the same draft, a finding that was published with one is not refiled.
        expect(draftOf("AI_CONFIDENCE", onlyCorrections(draftCorrection(MATH, "ai.role", "ai_tool"), confidenceTo("claimed")), { stored: stored([published()]) })).toEqual([]);
      });

      it("reads a finding the context shows no role of as having one, and a role given by a draft correction to a finding published with none first", () => {
        expect(draftOf("AI_CONFIDENCE", onlyCorrections(draftCorrection(PHYS, "ai.confidence", "claimed")))).toEqual([]);
        const both = draftOf("AI_CONFIDENCE", onlyCorrections(draftCorrection(MATH, "ai.role", "ai_tool"), confidenceTo("claimed")), { stored: stored([storedNoAi()]) });
        expect(pathsOf(both)).toEqual(["corrections[0].after"]);
      });
    });
  });
});

describe("AI_CONFIDENCE in published mode", () => {
  const record = (id: string, over: Json) => (w: WorldJson): void => { Object.assign(findingJson(w, id).ai, over); };
  const noAi = (id: string, over: Json = {}) => (w: WorldJson): void => {
    const f = findingJson(w, id);
    f.ai = { ...structuredClone(NO_AI), ...over };
    f.explainer.ai_helped = null;
  };

  it("judges the pair and the evidence of every record, the ones being published and the others", () => {
    expect(pubOf("AI_CONFIDENCE")).toEqual([]);
    for (const id of [BIO, PHYS]) {
      expect(pathsOf(pubOf("AI_CONFIDENCE", record(id, { confidence: null })))).toEqual([`findings/${id}.json: ai.confidence`]);
      expect(pubOf("AI_CONFIDENCE", noAi(id, { confidence: "claimed" })), id).toHaveLength(1);
      expect(pubOf("AI_CONFIDENCE", noAi(id))).toEqual([]);
      expect(pubOf("AI_CONFIDENCE", (w) => { findingJson(w, id).ai.evidence[0].from_claimant = true; })).toHaveLength(1);
      expect(pubOf("AI_CONFIDENCE", (w) => { findingJson(w, id).ai.confidence = "claimed"; findingJson(w, id).ai.evidence[0].from_claimant = true; })).toEqual([]);
    }
    expect(pubOf("AI_CONFIDENCE", record(PHYS, { confidence: null }), null)).toHaveLength(1);
    const issues = pubOf("AI_CONFIDENCE", record(BIO, { confidence: null }));
    expect(issues[0]).toMatchObject({ code: "AI_CONFIDENCE", severity: "error" });
    expect(issues[0]!.message).toBe(`${BIO} has ai.role ai_solved but ai.confidence null. Only no AI role has a null confidence.`);
  });

  it("judges a record as published, so a stored correction that files it with none does not excuse its own pair", () => {
    expect(pubOf("AI_CONFIDENCE", (w) => {
      record(BIO, { confidence: null })(w);
      w.corrections.push(correctionJson("C-0003", "2026-11-12", BIO, "ai.role", "none"));
    })).toHaveLength(1);
  });

  describe("a stored correction on ai.role or ai.confidence, judged on its own date", () => {
    const correctionPath = (i: number): string => `corrections.json: corrections[${i}].after.en`;
    // The stored world holds two corrections (index 0 and 1); a third is index 2.
    const roleTo = (id: string, role: string, date = "2026-11-20", type = "correction") => (w: WorldJson): void => {
      w.corrections.push(correctionJson("C-0003", date, id, "ai.role", role, type));
    };

    it("fails a correction that gives a record published with no AI role an AI role, and passes none, a record published with a role and a removed correction", () => {
      expect(pubOf("AI_CONFIDENCE", (w) => { noAi(PHYS)(w); roleTo(PHYS, "ai_tool")(w); })).toHaveLength(1);
      const issues = pubOf("AI_CONFIDENCE", (w) => { noAi(PHYS)(w); roleTo(PHYS, "ai_tool")(w); });
      expect(issues[0]).toMatchObject({ code: "AI_CONFIDENCE", severity: "error", path: correctionPath(2) });
      expect(issues[0]!.message).toBe(`The correction gives ${PHYS} the AI role ai_tool, but it was published with ai.role none, which has no evidence, system or ai_helped to be filed with.`);
      expect(issues[0]!.hint).toBe("Do not correct the role. Tell the later finding in a clarification of its explainer.found.");
      expect(pubOf("AI_CONFIDENCE", (w) => { noAi(PHYS)(w); roleTo(PHYS, "none")(w); })).toEqual([]);
      expect(pubOf("AI_CONFIDENCE", roleTo(PHYS, "ai_tool"))).toEqual([]);
      expect(pubOf("AI_CONFIDENCE", (w) => { noAi(PHYS)(w); roleTo(PHYS, "ai_tool", "2026-11-20", "removed")(w); })).toEqual([]);
      // Neither the record's being published nor the correction's decides it.
      expect(pubOf("AI_CONFIDENCE", (w) => { noAi(PHYS)(w); roleTo(PHYS, "ai_tool")(w); }, null)).toHaveLength(1);
    });

    it("fails a correction of the confidence of a record an earlier or same-day stored correction refiled with none, and passes one refiled later", () => {
      const confidence = (refiled: string, date = "2026-11-20") => (w: WorldJson): void => {
        w.corrections.push(correctionJson("C-0003", refiled, PHYS, "ai.role", "none"));
        w.corrections.push(correctionJson("C-0004", date, PHYS, "ai.confidence", "claimed"));
      };
      const issues = pubOf("AI_CONFIDENCE", confidence("2026-11-15"));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "AI_CONFIDENCE", severity: "error", path: correctionPath(3) });
      expect(issues[0]!.message).toBe(`The correction sets ai.confidence of ${PHYS} to claimed, but the finding is filed with ai.role none, so its confidence is null.`);
      expect(issues[0]!.hint).toBe("Drop the correction of ai.confidence: a finding with no AI role has none.");
      expect(pubOf("AI_CONFIDENCE", confidence("2026-11-20"))).toHaveLength(1);
      // Judged on its own date, which no later correction changes: a refile dated after it does not fail it.
      expect(pubOf("AI_CONFIDENCE", confidence("2026-11-22"))).toEqual([]);
      expect(pubOf("AI_CONFIDENCE", (w) => { noAi(PHYS)(w); w.corrections.push(correctionJson("C-0003", "2026-11-20", PHYS, "ai.confidence", "claimed")); })).toHaveLength(1);
      expect(pubOf("AI_CONFIDENCE", (w) => { w.corrections.push(correctionJson("C-0003", "2026-11-20", PHYS, "ai.confidence", "claimed")); })).toEqual([]);
      expect(pubOf("AI_CONFIDENCE", confidence("2026-11-15"), null)).toHaveLength(1);
    });
  });
});

// ── AI_SYSTEM_NAMED ──────────────────────────────────────────────────────────────────────────────

describe("AI_SYSTEM_NAMED in draft mode", () => {
  const systemsPath = "new_findings[0].ai.systems";
  const helpedPath = "new_findings[0].explainer.ai_helped";
  const systems = (...list: [string, string][]) => (d: Json): void => { d.new_findings[0].ai.systems = list.map(([name, maker]) => ({ name, maker })); };
  const helped = (text: string, ...list: [string, string][]) => (d: Json): void => {
    if (list.length > 0) systems(...list)(d);
    d.new_findings[0].explainer.ai_helped = text;
  };

  it("passes the base finding, and a finding with no AI role whatever its systems list holds", () => {
    expect(draftOf("AI_SYSTEM_NAMED")).toEqual([]);
    expect(draftOf("AI_SYSTEM_NAMED", withAi(0, "none", null))).toEqual([]);
  });

  it("needs ai.systems to hold a system for every AI role and every kind but a setback, infrastructure and policy_people", () => {
    for (const role of AI_ROLES) {
      for (const kind of FINDING_KINDS) {
        const edit = (d: Json): void => {
          withAi(0, role, role === "none" ? null : "claimed")(d);
          d.new_findings[0].ai.systems = [];
          d.new_findings[0].kind = kind;
        };
        const free = kind === "setback" || kind === "infrastructure" || kind === "policy_people";
        expect(draftOf("AI_SYSTEM_NAMED", edit), `${role} ${kind}`).toHaveLength(role === "none" || free ? 0 : 1);
      }
    }
    const issues = draftOf("AI_SYSTEM_NAMED", systems());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "AI_SYSTEM_NAMED", severity: "error", path: systemsPath });
    expect(issues[0]!.message).toBe("new-1 has ai.role ai_solved and no ai.systems. Only a setback, infrastructure or policy_people finding may list none.");
    expect(issues[0]!.hint).toBe("List each AI system a cited source names, with its maker, in the source's own words.");
  });

  it("lets a setback, infrastructure or policy_people finding with no system say what the AI did without naming one, and holds one that lists a system to name it", () => {
    for (const kind of ["setback", "infrastructure", "policy_people"]) {
      const none = (d: Json): void => { d.new_findings[0].kind = kind; systems()(d); d.new_findings[0].explainer.ai_helped = "An AI system was used to screen the papers."; };
      expect(draftOf("AI_SYSTEM_NAMED", none), kind).toEqual([]);
      const listed = (d: Json): void => { d.new_findings[0].kind = kind; d.new_findings[0].explainer.ai_helped = "An AI system was used to screen the papers."; };
      expect(draftOf("AI_SYSTEM_NAMED", listed), kind).toHaveLength(1);
    }
  });

  it("needs ai_helped to name a system and its maker, each as whole words in any case", () => {
    const named: [string, boolean][] = [
      ["Sample System 3, from Example Lab, did the work.", true],
      ["sample system 3 from EXAMPLE LAB did the work.", true],
      ["Example Lab's Sample System 3 did the work.", true],
      ["Sample System 3 did the work.", false],
      ["Example Lab did the work.", false],
      ["A program did the work.", false],
      ["Sample System 33, from Example Lab, did the work.", false],
      ["Sample System 3, from Example Labs, did the work.", false],
      ["Sample System 3, from Example Laboratory, did the work.", false],
    ];
    for (const [text, ok] of named) expect(draftOf("AI_SYSTEM_NAMED", helped(text)), text).toHaveLength(ok ? 0 : 1);
    const issues = draftOf("AI_SYSTEM_NAMED", helped("A program did the work."));
    expect(issues[0]).toMatchObject({ code: "AI_SYSTEM_NAMED", severity: "error", path: helpedPath });
    expect(issues[0]!.message).toBe("ai_helped of new-1 names none of its AI systems with their maker (Sample System 3 by Example Lab).");
    expect(issues[0]!.hint).toBe("Say what the AI did, naming a system and its maker as ai.systems lists them.");
  });

  it("never takes a blank system name or maker as named", () => {
    const text = "Sample System 3, from Example Lab, did the work.";
    expect(draftOf("AI_SYSTEM_NAMED", helped(text, ["Sample System 3", " "]))).toHaveLength(1);
    expect(draftOf("AI_SYSTEM_NAMED", helped(text, [" ", "Example Lab"]))).toHaveLength(1);
  });

  it("reads a name's words as the word lists do: a hyphen and a space are one gap", () => {
    expect(draftOf("AI_SYSTEM_NAMED", helped("GPT 4, from Example Lab, did the work.", ["GPT-4", "Example Lab"]))).toEqual([]);
    expect(draftOf("AI_SYSTEM_NAMED", helped("GPT-4, from Example-Lab, did the work.", ["GPT 4", "Example Lab"]))).toEqual([]);
  });

  it("wants one system named with its own maker when there are several, and lists them all when none is", () => {
    const two: [string, string][] = [["Alpha Prover", "First Lab"], ["Beta Prover", "Second Lab"]];
    for (const [text, ok] of [
      ["Alpha Prover, from First Lab, did the work.", true],
      ["Beta Prover, from Second Lab, did the work.", true],
      ["Alpha Prover and Beta Prover did the work.", false],
      ["First Lab and Second Lab did the work.", false],
      ["Alpha Prover, from Second Lab, did the work.", false],
      ["Beta Prover, from First Lab, did the work.", false],
    ] as [string, boolean][]) {
      expect(draftOf("AI_SYSTEM_NAMED", helped(text, ...two)), text).toHaveLength(ok ? 0 : 1);
    }
    expect(draftOf("AI_SYSTEM_NAMED", helped("A program did the work.", ...two))[0]!.message).toBe(
      "ai_helped of new-1 names none of its AI systems with their maker (Alpha Prover by First Lab, Beta Prover by Second Lab).",
    );
  });

  it("judges a new finding alone: a stored finding the draft names is not judged again", () => {
    const broken = storedFinding(MATH, { title: l("A made-up proof"), depth: "item", ai: { role: "ai_solved", confidence: "claimed", systems: [], evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: true }] } });
    expect(draftOf("AI_SYSTEM_NAMED", () => {}, { stored: stored([broken]) })).toEqual([]);
  });
});

describe("AI_SYSTEM_NAMED in published mode", () => {
  const helpedPath = (id: string): string => `findings/${id}.json: explainer.ai_helped.en`;
  const helped = (id: string, text: string) => (w: WorldJson): void => { findingJson(w, id).explainer.ai_helped.en = text; };
  /** Files a removed correction and leaves REMOVED_TEXT where it names, as publishing does. */
  const removal = (id: string, path: string, cid = "C-0003") => (w: WorldJson): void => {
    w.corrections.push(correctionJson(cid, D, id, path, REMOVED_TEXT.en, "removed"));
    holdMarkers(w);
  };
  /** Files a removed correction and leaves the record's text as it is. */
  const filed = (id: string, path: string, cid = "C-0003") => (w: WorldJson): void => {
    w.corrections.push(correctionJson(cid, D, id, path, REMOVED_TEXT.en, "removed"));
  };

  it("judges the systems list and ai_helped of every record, the ones being published and the others, in English alone", () => {
    expect(pubOf("AI_SYSTEM_NAMED")).toEqual([]);
    for (const id of [BIO, PHYS]) {
      const issues = pubOf("AI_SYSTEM_NAMED", helped(id, "A program did the work."));
      expect(issues, id).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "AI_SYSTEM_NAMED", severity: "error", path: helpedPath(id) });
      expect(issues[0]!.message).toBe(`ai_helped of ${id} names none of its AI systems with their maker (Sample System 3 by Example Lab).`);
      expect(pubOf("AI_SYSTEM_NAMED", (w) => { findingJson(w, id).explainer.ai_helped.zh = "一個程式完成了這項工作。"; })).toEqual([]);
      expect(pathsOf(pubOf("AI_SYSTEM_NAMED", (w) => { findingJson(w, id).ai.systems = []; }))).toEqual([`findings/${id}.json: ai.systems`]);
      expect(pubOf("AI_SYSTEM_NAMED", (w) => { findingJson(w, id).ai.systems = []; findingJson(w, id).kind = "infrastructure"; })).toEqual([]);
    }
    expect(pubOf("AI_SYSTEM_NAMED", helped(PHYS, "A program did the work."), null)).toHaveLength(1);
    expect(pubOf("AI_SYSTEM_NAMED", (w) => {
      const f = findingJson(w, BIO);
      f.ai = { role: "none", confidence: null, systems: [], evidence: [] };
      f.explainer.ai_helped = null;
    })).toEqual([]);
  });

  it("judges a record as published, so a stored correction that files it with no AI role does not excuse it", () => {
    expect(pubOf("AI_SYSTEM_NAMED", (w) => {
      helped(BIO, "A program did the work.")(w);
      w.corrections.push(correctionJson("C-0003", "2026-11-12", BIO, "ai.role", "none"));
    })).toHaveLength(1);
  });

  it("skips an ai_helped a stored removed correction rewrote, and fails the text it left out of the record", () => {
    const rewritten = (w: WorldJson): void => {
      findingJson(w, BIO).explainer.ai_helped = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh };
    };
    expect(pubOf("AI_SYSTEM_NAMED", rewritten)).toHaveLength(1);
    expect(pubOf("AI_SYSTEM_NAMED", (w) => { rewritten(w); removal(BIO, "explainer.ai_helped")(w); })).toEqual([]);
    // A correction for another string, or another finding, leaves the text judged.
    expect(pubOf("AI_SYSTEM_NAMED", (w) => { rewritten(w); removal(BIO, "explainer.how_sure")(w); })).toHaveLength(1);
    expect(pubOf("AI_SYSTEM_NAMED", (w) => { rewritten(w); removal(PHYS, "explainer.ai_helped")(w); })).toHaveLength(1);
    // The correction alone skips nothing: where the record holds other text, or the marker in one language only, the text is judged.
    expect(pubOf("AI_SYSTEM_NAMED", (w) => { helped(BIO, "A program did the work.")(w); filed(BIO, "explainer.ai_helped")(w); })).toHaveLength(1);
    expect(pubOf("AI_SYSTEM_NAMED", (w) => {
      findingJson(w, BIO).explainer.ai_helped = { en: REMOVED_TEXT.en, zh: "別的文字。" };
      filed(BIO, "explainer.ai_helped")(w);
    })).toHaveLength(1);
  });

  it("leaves out a system whose name or maker a stored removed correction rewrote, and has nothing to judge when none is left", () => {
    const rewritten = (field: "name" | "maker") => (w: WorldJson): void => { findingJson(w, BIO).ai.systems[0][field] = REMOVED_TEXT.en; };
    for (const field of ["name", "maker"] as const) {
      expect(pubOf("AI_SYSTEM_NAMED", rewritten(field)), field).toHaveLength(1);
      expect(pubOf("AI_SYSTEM_NAMED", (w) => { rewritten(field)(w); removal(BIO, `ai.systems.0.${field}`)(w); }), field).toEqual([]);
      // The correction alone skips nothing: a system whose record still holds its name is judged.
      expect(pubOf("AI_SYSTEM_NAMED", (w) => { filed(BIO, `ai.systems.0.${field}`)(w); helped(BIO, "A program did the work.")(w); }), field).toHaveLength(1);
    }
    // The second system is the one left to name, and the message lists it alone.
    const two = (w: WorldJson): void => {
      findingJson(w, BIO).ai.systems.push({ name: "Other Prover", maker: "Other Lab" });
      findingJson(w, BIO).ai.systems[0].name = REMOVED_TEXT.en;
      findingJson(w, BIO).explainer.ai_helped.en = "A program did the work.";
    };
    expect(pubOf("AI_SYSTEM_NAMED", (w) => { two(w); removal(BIO, "ai.systems.0.name")(w); })[0]!.message).toBe(
      `ai_helped of ${BIO} names none of its AI systems with their maker (Other Prover by Other Lab).`,
    );
    expect(pubOf("AI_SYSTEM_NAMED", (w) => { two(w); removal(BIO, "ai.systems.1.name")(w); })[0]!.message).toBe(
      `ai_helped of ${BIO} names none of its AI systems with their maker (${REMOVED_TEXT.en} by Example Lab).`,
    );
  });
});

// ── WHO_SAYS ─────────────────────────────────────────────────────────────────────────────────────

describe("WHO_SAYS in draft mode", () => {
  const path = "new_findings[0].explainer.how_sure";
  const sure = (text: string) => explainer(0, { how_sure: text });
  const last = (rung: Rung, source = "s1") => (d: Json): void => { d.new_findings[0].rung_history = [{ rung, date: "2026-11-20", source_id: source, note: null }]; };
  const both = (...edits: ((d: Json) => void)[]) => (d: Json): void => { for (const e of edits) e(d); };
  const claimed = (...makers: [string, string][]) => (d: Json): void => {
    d.new_findings[0].ai.confidence = "claimed";
    if (makers.length > 0) d.new_findings[0].ai.systems = makers.map(([name, maker]) => ({ name, maker }));
  };

  it("passes the base finding, and starts how_sure with the label of the rung it stands on, over every rung and label", () => {
    expect(draftOf("WHO_SAYS")).toEqual([]);
    for (const rung of ALL_RUNGS) {
      for (const label of ALL_RUNGS) {
        const edit = both(last(rung), sure(`${RUNG_INFO[label].en} by Example Journal.`));
        expect(draftOf("WHO_SAYS", edit), `${rung} ${label}`).toHaveLength(rung === label ? 0 : 1);
      }
    }
  });

  it("names the start it found, the label it wants and the edit, at the how_sure, and cuts a long start at 40 characters", () => {
    const issues = draftOf("WHO_SAYS", sure("Mostly fine."));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "WHO_SAYS", severity: "error", path });
    expect(issues[0]!.message).toBe('how_sure starts with "Mostly fine.". It must start with the label of the rung: "Checked".');
    expect(issues[0]!.hint).toBe('Begin how_sure with "Checked.", then name who says so.');
    expect(draftOf("WHO_SAYS", sure("Probably fine, said everyone we asked about it today, so far."))[0]!.message).toBe(
      'how_sure starts with "Probably fine, said everyone we asked ab". It must start with the label of the rung: "Checked".',
    );
  });

  it("reads the label as a whole word at the very start, in the case the vocabulary spells it", () => {
    for (const [text, labelFails] of [
      ["Checked.", false], ["Checked: by Example Journal.", false], ["Checked by Example Journal.", false],
      ["Checkedby Example Journal.", true], ["Checked2 by Example Journal.", true], ["checked by Example Journal.", true],
      [" Checked by Example Journal.", true], ["Not Checked by Example Journal.", true], ["Check by Example Journal.", true],
    ] as [string, boolean][]) {
      const labelIssues = draftOf("WHO_SAYS", sure(text)).filter((i) => i.message.startsWith("how_sure starts with"));
      expect(labelIssues, text).toHaveLength(labelFails ? 1 : 0);
    }
  });

  it("names the publisher of the rung's source as a whole word in any case, whatever else the text names", () => {
    for (const [text, fails] of [
      ["Checked by Example Journal.", false], ["Checked by example journal.", false], ["Checked. Example Journal says so.", false],
      ["Checked, the Example Journal's editors say.", false], ["Checked by somebody.", true], ["Checked by Example Journals.", true],
      ["Checked by the Journal of Examples.", true], ["Checked.", true],
    ] as [string, boolean][]) {
      expect(draftOf("WHO_SAYS", sure(text)), text).toHaveLength(fails ? 1 : 0);
    }
    const issue = draftOf("WHO_SAYS", sure("Checked by somebody."));
    expect(issue[0]).toMatchObject({ code: "WHO_SAYS", severity: "error", path });
    expect(issue[0]!.message).toBe("how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (Example Journal).");
    expect(issue[0]!.hint).toBe("Say which publisher or checker shows the rung, in its own name.");
  });

  it("reads a name and the text in NFKC, so a publisher with a combining accent or in full-width letters is the one the text names", () => {
    const publisher = (name: string) => (d: Json): void => { d.new_findings[0].sources[0] = src("s1", "paper", name); };
    const precomposed = `Caf${String.fromCharCode(0xe9)} Press`;
    const decomposed = `Cafe${String.fromCharCode(0x301)} Press`;
    expect(precomposed).not.toBe(decomposed);
    expect(draftOf("WHO_SAYS", both(publisher(precomposed), sure(`Checked by ${decomposed}.`)))).toEqual([]);
    expect(draftOf("WHO_SAYS", both(publisher(decomposed), sure(`Checked by ${precomposed}.`)))).toEqual([]);
    const wide = String.fromCharCode(0xff30, 0xff2e, 0xff21, 0xff33);
    expect(draftOf("WHO_SAYS", both(publisher("PNAS"), sure(`Checked by ${wide}.`)))).toEqual([]);
    expect(draftOf("WHO_SAYS", both(publisher(wide), sure("Checked by PNAS.")))).toEqual([]);
    // A different name is still a different name, and the accent is part of it
    expect(draftOf("WHO_SAYS", both(publisher(precomposed), sure("Checked by Cafe Press.")))).toHaveLength(1);
  });

  it("wants the publisher of the source the last rung entry cites, not another source's and not another entry's", () => {
    const sources = (d: Json): void => { d.new_findings[0].sources = [src("s1", "paper", "Example Journal"), src("s2", "paper", "Other Press")]; };
    expect(draftOf("WHO_SAYS", both(sources, sure("Checked by Other Press.")))).toHaveLength(1);
    expect(draftOf("WHO_SAYS", both(sources, last("checked", "s2"), sure("Checked by Other Press.")))).toEqual([]);
    expect(draftOf("WHO_SAYS", both(sources, last("checked", "s2"), sure("Checked by Example Journal.")))).toHaveLength(1);
    // The last entry of two is the one that counts: its label and its source's publisher.
    const climbed = (d: Json): void => {
      sources(d);
      d.new_findings[0].rung_history = [{ rung: "checked", date: "2026-11-20", source_id: "s1", note: null }, { rung: "confirmed", date: "2026-11-21", source_id: "s2", note: null }];
    };
    expect(draftOf("WHO_SAYS", both(climbed, sure("Confirmed by Other Press.")))).toEqual([]);
    expect(draftOf("WHO_SAYS", both(climbed, sure("Confirmed by Example Journal.")))).toHaveLength(1);
    expect(draftOf("WHO_SAYS", both(climbed, sure("Checked by Example Journal.")))).toHaveLength(1);
    expect(draftOf("WHO_SAYS", both(climbed, sure("Checked by Other Press."))).map((i) => i.message)).toEqual([
      'how_sure starts with "Checked by Other Press.". It must start with the label of the rung: "Confirmed".',
    ]);
  });

  it("takes the checker's name instead of the publisher's for a checker's record that checkers.json lists", () => {
    const checker = (url: string, kind = "checker") => (d: Json): void => { d.new_findings[0].sources[0] = src("s1", kind, "The Committee", { url }); };
    expect(draftOf("WHO_SAYS", both(checker(NOBEL), sure("Checked by The Committee.")))).toEqual([]);
    expect(draftOf("WHO_SAYS", both(checker(NOBEL), sure("Checked by the Nobel Prize committee.")))).toEqual([]);
    expect(draftOf("WHO_SAYS", both(checker(NOBEL), sure("Checked by the nobel prize.")))).toEqual([]);
    const none = draftOf("WHO_SAYS", both(checker(NOBEL), sure("Checked by somebody.")));
    expect(none).toHaveLength(1);
    expect(none[0]!.message).toBe("how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (The Committee), or the checker: Nobel Prize.");
    // The address no entry lists, an entry of another host, and a source that is not a checker's record have no checker to name.
    expect(draftOf("WHO_SAYS", both(checker(UNLISTED), sure("Checked by the Nobel Prize committee.")))).toHaveLength(1);
    expect(draftOf("WHO_SAYS", both(checker(FDA), sure("Checked by the Nobel Prize committee.")))).toHaveLength(1);
    expect(draftOf("WHO_SAYS", both(checker(NOBEL, "paper"), sure("Checked by the Nobel Prize committee.")))).toHaveLength(1);
    expect(draftOf("WHO_SAYS", both(checker(UNLISTED), sure("Checked by somebody.")))[0]!.message).toBe(
      "how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (The Committee).",
    );
    // A paper that sits at a listed address is no checker's record: the message offers no checker, as the check accepts none.
    expect(draftOf("WHO_SAYS", both(checker(NOBEL, "paper"), sure("Checked by somebody.")))[0]!.message).toBe(
      "how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (The Committee).",
    );
    expect(draftOf("WHO_SAYS", both(checker(FDA), last("applied"), sure("Applied by the US Food and Drug Administration.")))).toEqual([]);
  });

  it("leaves what it cannot read to the rule that can: a rung entry citing a source the finding lacks has no publisher to name", () => {
    expect(draftOf("WHO_SAYS", both(last("checked", "s9"), sure("Checked by nobody in particular.")))).toEqual([]);
    expect(draftOf("WHO_SAYS", both(last("checked", "s9"), sure("Mostly fine.")))).toHaveLength(1);
  });

  describe("the maker clause", () => {
    it("names the maker of the AI system when the confidence is claimed, and only then", () => {
      const issues = draftOf("WHO_SAYS", claimed());
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "WHO_SAYS", severity: "error", path });
      expect(issues[0]!.message).toBe('The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "Example Lab".');
      expect(issues[0]!.hint).toBe("Say that Example Lab makes the claim, or give the AI role a confirming source from someone else.");
      for (const [text, fails] of [
        ["Checked by Example Journal, as Example Lab says.", false], ["Checked by Example Journal, as example lab says.", false],
        ["Checked by Example Journal, as Example Labs say.", true], ["Checked by Example Journal.", true],
      ] as [string, boolean][]) {
        expect(draftOf("WHO_SAYS", both(claimed(), sure(text))), text).toHaveLength(fails ? 1 : 0);
      }
      expect(draftOf("WHO_SAYS", (d) => { d.new_findings[0].ai.confidence = "confirmed"; })).toEqual([]);
    });

    it("has no maker to name when ai.systems lists none", () => {
      expect(draftOf("WHO_SAYS", (d) => { claimed()(d); d.new_findings[0].ai.systems = []; })).toEqual([]);
    });

    it("names each distinct maker once, listing the ones the text leaves out", () => {
      const two: [string, string][] = [["Alpha Prover", "First Lab"], ["Beta Prover", "Second Lab"]];
      expect(draftOf("WHO_SAYS", both(claimed(...two), sure("Checked by Example Journal, as First Lab and Second Lab say.")))).toEqual([]);
      expect(draftOf("WHO_SAYS", both(claimed(...two), sure("Checked by Example Journal, as First Lab says.")))[0]!.message).toBe(
        'The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "Second Lab".',
      );
      expect(draftOf("WHO_SAYS", both(claimed(...two), sure("Checked by Example Journal.")))[0]!.message).toBe(
        'The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "First Lab" or "Second Lab".',
      );
      expect(draftOf("WHO_SAYS", both(claimed(["Alpha Prover", "First Lab"], ["Beta Prover", "first lab"]), sure("Checked by Example Journal.")))[0]!.message).toBe(
        'The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "First Lab".',
      );
    });

    it("reports the label, the publisher and the maker as separate issues of the one string", () => {
      expect(draftOf("WHO_SAYS", both(claimed(), sure("Mostly fine."))).map((i) => i.message)).toEqual([
        'The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "Example Lab".',
        'how_sure starts with "Mostly fine.". It must start with the label of the rung: "Checked".',
      ]);
      expect(draftOf("WHO_SAYS", both(claimed(), sure("Checked by somebody."))).map((i) => i.message)).toEqual([
        'The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "Example Lab".',
        "how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (Example Journal).",
      ]);
    });
  });

  describe("a correction of explainer.how_sure", () => {
    const how = (after: string, type = "clarification", id = MATH) => draftCorrection(id, "explainer.how_sure", after, type);
    const disputed = (): Finding => storedFinding(MATH, {
      title: l("A made-up proof"), depth: "item", rung: "disputed",
      rung_history: [
        { rung: "checked", date: "2026-11-10", recorded: "2026-11-10", source_id: "s1", by: "agent", note: null },
        { rung: "disputed", date: "2026-11-15", recorded: "2026-11-15", source_id: "s1", by: "agent", note: null },
      ],
    });

    it("starts with the label of the rung the draft leaves the finding at, and names the publisher of that entry's source", () => {
      // The returning entry of the base draft moves math-2026-0002 to Checked on b1, a paper of "Example Institute".
      expect(draftOf("WHO_SAYS", (d) => { d.corrections = [how("Checked by Example Institute.")]; })).toEqual([]);
      const label = draftOf("WHO_SAYS", (d) => { d.corrections = [how("Mostly fine.")]; });
      expect(label).toHaveLength(1);
      expect(label[0]).toMatchObject({ code: "WHO_SAYS", severity: "error", path: "corrections[0].after" });
      expect(label[0]!.message).toBe('how_sure starts with "Mostly fine.". It must start with the label of the rung: "Checked".');
      const who = draftOf("WHO_SAYS", (d) => { d.corrections = [how("Checked by nobody.")]; });
      expect(who[0]!.message).toBe("how_sure does not say who says so. It must name the publisher of the source that shows the rung: b1 (Example Institute).");
      // A later rung change of the same draft is the one that counts.
      expect(draftOf("WHO_SAYS", (d) => {
        d.rung_changes = [{ finding_id: MATH, rung: { rung: "disputed", date: D, source_id: "b2", note: null } }];
        d.corrections = [how("Disputed by Example Institute.")];
      })).toEqual([]);
    });

    it("reads the rung a stored record ends on when the draft moves none, the last entry alone", () => {
      const stored1 = { stored: stored([storedFinding(MATH, { title: l("A made-up proof"), depth: "item" })]) };
      const run = (after: string, over: Partial<DraftInputs> = stored1) => draftOf("WHO_SAYS", onlyCorrections(how(after)), over);
      expect(run("Checked by Example Journal.")).toEqual([]);
      expect(run("Checked by arXiv.")[0]!.message).toBe("how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (Example Journal).");
      expect(run("Preprint by arXiv.")[0]!.message).toBe('how_sure starts with "Preprint by arXiv.". It must start with the label of the rung: "Checked".');
      const dispute = { stored: stored([disputed()]) };
      expect(run("Disputed by Example Journal.", dispute)).toEqual([]);
      expect(run("Checked by Example Journal.", dispute)).toHaveLength(1);
    });

    it("reads the rung a context report shows, or the context's list, when the run has no stored record", () => {
      // The report of math-2026-0002 holds its record: a preprint of arXiv.
      expect(draftOf("WHO_SAYS", onlyCorrections(how("Preprint by arXiv.")))).toEqual([]);
      expect(draftOf("WHO_SAYS", onlyCorrections(how("Preprint.")))[0]!.message).toBe(
        "how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (arXiv).",
      );
      // phys-2026-0003 is only in the context's list, as a preprint: the label is read, no publisher is known.
      const phys = (after: string) => draftOf("WHO_SAYS", (d) => { d.rung_changes = []; d.corrections = [how(after, "clarification", PHYS)]; });
      expect(phys("Preprint. Whoever says so.")).toEqual([]);
      expect(phys("Checked by Example Journal.")[0]!.message).toBe('how_sure starts with "Checked by Example Journal.". It must start with the label of the rung: "Preprint".');
    });

    it("has no label to ask for when the run shows no rung of the finding", () => {
      // chem-2026-0004 is named by a flag alone: the context's list of recent findings does not hold it.
      const flagged = contextWith((c) => { c.recent_findings = c.recent_findings.filter((f: Json) => f.id !== "chem-2026-0004"); });
      expect(draftOf("WHO_SAYS", onlyCorrections(how("Anything at all.", "clarification", "chem-2026-0004")), { context: flagged })).toEqual([]);
    });

    it("names the maker of a claimed finding as the draft files its confidence", () => {
      const claimedRecord = (): Finding => storedFinding(MATH, {
        title: l("A made-up proof"), depth: "item",
        ai: { role: "ai_solved", confidence: "claimed", systems: [{ name: "Sample System 3", maker: "Example Lab" }], evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: true }] },
      });
      const run = (after: string, extra: Json[] = [], over: Partial<DraftInputs> = { stored: stored([claimedRecord()]) }) =>
        draftOf("WHO_SAYS", onlyCorrections(how(after), ...extra), over);
      expect(run("Checked by Example Journal.")[0]!.message).toBe('The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "Example Lab".');
      expect(run("Checked by Example Journal, as Example Lab says.")).toEqual([]);
      // Confirmed by a correction of the same draft, or by a stored one dated by then, the maker is not asked for; a later one files nothing yet.
      expect(run("Checked by Example Journal.", [draftCorrection(MATH, "ai.confidence", "confirmed")])).toEqual([]);
      const earlier = Correction.parse(correctionJson("C-0001", "2026-11-10", MATH, "ai.confidence", "confirmed"));
      const later = Correction.parse(correctionJson("C-0001", "2026-11-25", MATH, "ai.confidence", "confirmed"));
      expect(run("Checked by Example Journal.", [], { stored: stored([claimedRecord()], [earlier]) })).toEqual([]);
      expect(run("Checked by Example Journal.", [], { stored: stored([claimedRecord()], [later]) })).toHaveLength(1);
    });

    it("judges no other path, no removed correction, a correction of no finding and a finding the context does not list", () => {
      expect(draftOf("WHO_SAYS", onlyCorrections(draftCorrection(MATH, "explainer.found", "Mostly fine.", "clarification")))).toEqual([]);
      expect(draftOf("WHO_SAYS", onlyCorrections(draftCorrection(MATH, "explainer.how_sure", REMOVED_TEXT.en, "removed")))).toEqual([]);
      expect(draftOf("WHO_SAYS", onlyCorrections(how("Mostly fine.", "clarification", "bio-2099-0001")))).toEqual([]);
    });
  });
});

describe("WHO_SAYS in published mode", () => {
  const path = (id: string): string => `findings/${id}.json: explainer.how_sure.en`;
  const sure = (id: string, text: string) => (w: WorldJson): void => { findingJson(w, id).explainer.how_sure.en = text; };
  const issueOf = (text: string) => pubOf("WHO_SAYS", sure(BIO, text));
  const removal = (id: string, p: string, cid = "C-0003") => (w: WorldJson): void => {
    w.corrections.push(correctionJson(cid, D, id, p, REMOVED_TEXT.en, "removed"));
  };

  it("passes the stored world, and takes the label and the source of any rung in a record's history, as a pair", () => {
    expect(pubOf("WHO_SAYS")).toEqual([]);
    // bio-2026-0001's history: Preprint on s2 (arXiv), then Checked on s1 (Example Journal).
    for (const [text, fails] of [
      ["Checked by Example Journal.", false], ["Preprint by arXiv.", false], ["Checked by arXiv.", true], ["Preprint by Example Journal.", true],
      ["Mostly fine.", true], ["Confirmed by Example Journal.", true],
    ] as [string, boolean][]) {
      expect(issueOf(text), text).toHaveLength(fails ? 1 : 0);
    }
  });

  it("names the source of the entry whose label starts the text, or lists the labels of the history, each once", () => {
    expect(issueOf("Checked by arXiv.")[0]!.message).toBe("how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (Example Journal).");
    expect(issueOf("Preprint by Example Journal.")[0]!.message).toBe("how_sure does not say who says so. It must name the publisher of the source that shows the rung: s2 (arXiv).");
    const issues = issueOf("Mostly fine.");
    expect(issues[0]).toMatchObject({ code: "WHO_SAYS", severity: "error", path: path(BIO) });
    expect(issues[0]!.message).toBe('how_sure starts with "Mostly fine.". It must start with the label of the rung: "Preprint" or "Checked".');
    expect(issues[0]!.hint).toBe('Begin how_sure with "Preprint.", then name who says so.');
    const twice = pubOf("WHO_SAYS", (w) => {
      sure(BIO, "Mostly fine.")(w);
      const f = findingJson(w, BIO);
      f.rung_history.push({ rung: "checked", date: "2026-11-22", recorded: D, source_id: "s1", by: "agent", note: null });
    });
    expect(twice[0]!.message).toBe('how_sure starts with "Mostly fine.". It must start with the label of the rung: "Preprint" or "Checked".');
  });

  it("judges every record, the ones being published and the others", () => {
    expect(pathsOf(pubOf("WHO_SAYS", sure(PHYS, "Mostly fine.")))).toEqual([path(PHYS)]);
    expect(pubOf("WHO_SAYS", sure(PHYS, "Mostly fine."), null)).toHaveLength(1);
    expect(pubOf("WHO_SAYS", sure(BIO, "Mostly fine."), null)).toHaveLength(1);
    expect(pubOf("WHO_SAYS", (w) => { findingJson(w, BIO).explainer.how_sure.zh = "大致可靠。"; })).toEqual([]);
  });

  it("reads checkers.json for the records being published alone", () => {
    const checker = (url: string) => (w: WorldJson): void => { findingJson(w, BIO).sources[0] = { ...findingJson(w, BIO).sources[0], kind: "checker", url }; };
    const run = (text: string, url: string, publishing: string | null = D) => pubOf("WHO_SAYS", (w) => { checker(url)(w); sure(BIO, text)(w); }, publishing);
    expect(run("Checked by the Nobel Prize committee.", NOBEL)).toEqual([]);
    expect(run("Checked by somebody.", NOBEL)).toHaveLength(1);
    expect(run("Checked by somebody.", NOBEL)[0]!.message).toBe(
      "how_sure does not say who says so. It must name the publisher of the source that shows the rung: s1 (Example Journal), or the checker: Nobel Prize.",
    );
    expect(run("Checked by the Nobel Prize committee.", UNLISTED)).toHaveLength(1);
    // Not a record being published: the list is not read, so a text that names neither the publisher nor a checker is not failed.
    expect(run("Checked by somebody.", NOBEL, null)).toEqual([]);
    expect(run("Checked by somebody.", NOBEL, "2026-11-10")).toEqual([]);
    expect(run("Checked by somebody.", UNLISTED, null)).toEqual([]);
    // A source that is not a checker's record is judged on its publisher wherever it stands.
    expect(issueOf("Checked by somebody.")).toHaveLength(1);
    expect(pubOf("WHO_SAYS", sure(BIO, "Checked by somebody."), null)).toHaveLength(1);
  });

  it("reads checkers.json against how_sure on a finding first briefed on D and not on a returning one, whose explainer is frozen (F-55)", () => {
    const checker = (id: string, returning: boolean) => (w: WorldJson): void => {
      const f = findingJson(w, id);
      f.sources[0] = { ...f.sources[0], kind: "checker", url: NOBEL };
      f.explainer.how_sure.en = "Checked by somebody.";
      if (returning) f.updated = D;
    };
    // first briefed on D: the Nobel committee must be named
    expect(pubOf("WHO_SAYS", checker(BIO, false))).toHaveLength(1);
    // returning on D: the same text is an archived record, and its checker source is taken as met
    expect(pubOf("WHO_SAYS", checker(PHYS, true))).toEqual([]);
    // the publisher is still named in the text of a returning finding when the source is no checker's record
    expect(pubOf("WHO_SAYS", (w) => { const f = findingJson(w, PHYS); f.updated = D; f.explainer.how_sure.en = "Checked by somebody."; })).toHaveLength(1);
  });

  it("names the maker of a claimed record, and each one of several", () => {
    const claimed = (w: WorldJson): void => {
      const f = findingJson(w, BIO);
      f.ai.confidence = "claimed";
      f.ai.systems = [{ name: "Sample System 3", maker: "Example Lab" }, { name: "Other Prover", maker: "Other Lab" }];
    };
    const run = (text: string) => pubOf("WHO_SAYS", (w) => { claimed(w); sure(BIO, text)(w); });
    expect(run("Checked by Example Journal.")[0]!.message).toBe('The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "Example Lab" or "Other Lab".');
    expect(run("Checked by Example Journal, as Example Lab says.")[0]!.message).toBe('The confidence is claimed, so how_sure must name the maker of each AI system. It does not name "Other Lab".');
    expect(run("Checked by Example Journal, as Example Lab and Other Lab say.")).toEqual([]);
  });

  it("skips a how_sure a stored removed correction rewrote, and fails the text it left out of the record", () => {
    const rewritten = (w: WorldJson): void => { findingJson(w, BIO).explainer.how_sure = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh }; };
    expect(pubOf("WHO_SAYS", rewritten)).toHaveLength(1);
    expect(pubOf("WHO_SAYS", (w) => { rewritten(w); removal(BIO, "explainer.how_sure")(w); })).toEqual([]);
    expect(pubOf("WHO_SAYS", (w) => { rewritten(w); removal(BIO, "explainer.could_lead")(w); })).toHaveLength(1);
  });

  it("leaves out a publisher, a URL or a maker a stored removed correction rewrote", () => {
    const publisher = (w: WorldJson): void => { findingJson(w, BIO).sources[0].publisher = REMOVED_TEXT.en; sure(BIO, "Checked by somebody.")(w); };
    expect(pubOf("WHO_SAYS", publisher)).toHaveLength(1);
    expect(pubOf("WHO_SAYS", (w) => { publisher(w); removal(BIO, "sources.0.publisher")(w); })).toEqual([]);
    expect(pubOf("WHO_SAYS", (w) => { publisher(w); removal(BIO, "sources.1.publisher")(w); })).toHaveLength(1);
    const url = (w: WorldJson): void => {
      findingJson(w, BIO).sources[0] = { ...findingJson(w, BIO).sources[0], kind: "checker", url: REMOVED_TEXT.en };
      sure(BIO, "Checked by somebody.")(w);
    };
    expect(pubOf("WHO_SAYS", url)).toHaveLength(1);
    expect(pubOf("WHO_SAYS", (w) => { url(w); removal(BIO, "sources.0.url")(w); })).toEqual([]);
    const maker = (w: WorldJson): void => { findingJson(w, BIO).ai.confidence = "claimed"; findingJson(w, BIO).ai.systems[0].maker = REMOVED_TEXT.en; };
    expect(pubOf("WHO_SAYS", maker)).toHaveLength(1);
    expect(pubOf("WHO_SAYS", (w) => { maker(w); removal(BIO, "ai.systems.0.maker")(w); })).toEqual([]);
  });

  describe("a stored correction of explainer.how_sure", () => {
    const how = (after: string, date = "2026-11-22", type = "clarification", id = BIO, cid = "C-0003") => (w: WorldJson): void => {
      w.corrections.push(correctionJson(cid, date, id, "explainer.how_sure", after, type));
    };
    const correctionPath = "corrections.json: corrections[2].after.en";

    it("takes the label and source of any rung of the history, as a record's own text does", () => {
      for (const [text, fails] of [["Checked by Example Journal.", false], ["Preprint by arXiv.", false], ["Mostly fine.", true], ["Checked by arXiv.", true]] as [string, boolean][]) {
        expect(pubOf("WHO_SAYS", how(text)), text).toHaveLength(fails ? 1 : 0);
      }
      const issues = pubOf("WHO_SAYS", how("Mostly fine."));
      expect(issues[0]).toMatchObject({ code: "WHO_SAYS", severity: "error", path: correctionPath });
      expect(issues[0]!.message).toBe('how_sure starts with "Mostly fine.". It must start with the label of the rung: "Preprint" or "Checked".');
      expect(pubOf("WHO_SAYS", how("Mostly fine."), null)).toHaveLength(1);
    });

    it("reads the confidence as filed on the correction's own date for the maker clause", () => {
      // The record's own how_sure names the maker, so that only the correction is judged.
      const claimed = (w: WorldJson): void => {
        findingJson(w, BIO).ai.confidence = "claimed";
        sure(BIO, "Checked by Example Journal, as Example Lab says.")(w);
      };
      const confirm = (date: string) => (w: WorldJson): void => { w.corrections.push(correctionJson("C-0004", date, BIO, "ai.confidence", "confirmed")); };
      const run = (...edits: ((w: WorldJson) => void)[]) => pubOf("WHO_SAYS", (w) => { claimed(w); for (const e of edits) e(w); });
      expect(run(how("Checked by Example Journal."))).toHaveLength(1);
      expect(run(how("Checked by Example Journal, as Example Lab says."))).toEqual([]);
      expect(run(how("Checked by Example Journal."), confirm("2026-11-20"))).toEqual([]);
      expect(run(how("Checked by Example Journal."), confirm("2026-11-22"))).toEqual([]);
      expect(run(how("Checked by Example Journal."), confirm("2026-11-23"))).toHaveLength(1);
    });

    it("reads checkers.json for a correction dated on the date being published alone", () => {
      const checker = (w: WorldJson): void => { findingJson(w, BIO).sources[0] = { ...findingJson(w, BIO).sources[0], kind: "checker", url: NOBEL }; };
      // C-0003 is dated D here, so it is one of the records being published; a correction of an earlier date is not.
      expect(pubOf("WHO_SAYS", (w) => { checker(w); how("Checked by somebody.")(w); })).toEqual([]);
      expect(pubOf("WHO_SAYS", (w) => { checker(w); how("Checked by somebody.", D)(w); })).toHaveLength(1);
      expect(pubOf("WHO_SAYS", (w) => { checker(w); how("Checked by the Nobel Prize committee.", D)(w); })).toEqual([]);
      expect(pubOf("WHO_SAYS", (w) => { checker(w); how("Checked by somebody.", D)(w); }, null)).toEqual([]);
    });

    it("skips a removed correction and any other path", () => {
      expect(pubOf("WHO_SAYS", how(REMOVED_TEXT.en, "2026-11-22", "removed"))).toEqual([]);
      expect(pubOf("WHO_SAYS", (w) => { w.corrections.push(correctionJson("C-0003", "2026-11-22", BIO, "explainer.found", "Mostly fine.", "clarification")); })).toEqual([]);
    });
  });
});

// ── POSSIBILITY ──────────────────────────────────────────────────────────────────────────────────

describe("POSSIBILITY in draft mode", () => {
  const path = "new_findings[0].explainer.could_lead";
  const lead = (text: string) => explainer(0, { could_lead: text });
  const NO_WORD = "It leads to sample uses.";

  it("passes the base finding, and each possibility word of the row as a whole word in any case", () => {
    expect(draftOf("POSSIBILITY")).toEqual([]);
    const texts: Record<string, string> = {
      could: "It could lead to sample uses.", might: "It might lead to sample uses.", may: "It may lead to sample uses.",
      if: "If it holds, it leads to sample uses.", possibility: "There is a possibility of sample uses.", possible: "Sample uses are possible.",
    };
    expect(Object.keys(texts)).toEqual([...POSSIBILITY_WORDS]);
    for (const word of POSSIBILITY_WORDS) {
      expect(draftOf("POSSIBILITY", lead(texts[word]!)), word).toEqual([]);
      expect(draftOf("POSSIBILITY", lead(texts[word]!.toUpperCase())), `${word} upper`).toEqual([]);
    }
  });

  it("fails a could_lead with no possibility word, and a word that only sits inside another", () => {
    for (const text of [NO_WORD, "The mayor leads to sample uses.", "A gift leads to sample uses.", "It mightily leads to sample uses."]) {
      expect(draftOf("POSSIBILITY", lead(text)), text).toHaveLength(1);
    }
    const issues = draftOf("POSSIBILITY", lead(NO_WORD));
    expect(issues[0]).toMatchObject({ code: "POSSIBILITY", severity: "error", path });
    expect(issues[0]!.message).toBe("could_lead has none of the possibility words (could, might, may, if, possibility, possible). What it could lead to is always a possibility.");
    expect(issues[0]!.hint).toBe('Say what the result could lead to, as a possibility: "could", "might" or "if".');
    // The word "may" is read as a word whatever it means: a month's name counts.
    expect(draftOf("POSSIBILITY", lead("In May it leads to sample uses."))).toEqual([]);
  });

  it("fails each promise, will cure and will solve, in any case and with any gap, beside the possibility word", () => {
    expect(PROMISES).toEqual(["will cure", "will solve"]);
    const promised = draftOf("POSSIBILITY", lead("It could help, but it will cure sample diseases."));
    expect(promised).toHaveLength(1);
    expect(promised[0]).toMatchObject({ code: "POSSIBILITY", severity: "error", path });
    expect(promised[0]!.message).toBe('could_lead promises "will cure". A result never promises a use or a cure.');
    expect(promised[0]!.hint).toBe("Say it could or might happen, never that it will.");
    expect(draftOf("POSSIBILITY", lead("It could help, and it will solve sample problems."))[0]!.message).toBe('could_lead promises "will solve". A result never promises a use or a cure.');
    expect(draftOf("POSSIBILITY", lead("It could help, and it will cure one and will solve another."))).toHaveLength(2);
    expect(draftOf("POSSIBILITY", lead("It could help, but it WILL CURE sample diseases."))).toHaveLength(1);
    expect(draftOf("POSSIBILITY", lead("It could help, but it will  cure sample diseases."))).toHaveLength(1);
    expect(draftOf("POSSIBILITY", lead("It could help, but it will-solve sample problems."))).toHaveLength(1);
    expect(draftOf("POSSIBILITY", lead("It could help, but it will not cure sample diseases."))).toEqual([]);
  });

  it("reads the text in NFKC, so a word typed in full-width letters is the word it looks like, for a possibility word and for a promise", () => {
    const wide = (text: string): string => [...text].map((ch) => (ch > " " && ch <= "~" ? String.fromCharCode(ch.charCodeAt(0) + 0xfee0) : ch)).join("");
    expect(wide("will")).not.toBe("will");
    expect(draftOf("POSSIBILITY", lead(`It ${wide("could")} lead to sample uses.`))).toEqual([]);
    expect(draftOf("POSSIBILITY", lead(`It could help, but it ${wide("will cure")} sample diseases.`))).toHaveLength(1);
    expect(draftOf("POSSIBILITY", lead(`It ${wide("leads")} to sample uses.`))).toHaveLength(1);
  });

  it("reports a missing word and each promise as separate issues", () => {
    const issues = draftOf("POSSIBILITY", lead("It will cure sample diseases and will solve sample problems."));
    expect(issues.map((i) => i.message)).toEqual([
      "could_lead has none of the possibility words (could, might, may, if, possibility, possible). What it could lead to is always a possibility.",
      'could_lead promises "will cure". A result never promises a use or a cure.',
      'could_lead promises "will solve". A result never promises a use or a cure.',
    ]);
  });

  describe("a correction of explainer.could_lead", () => {
    const lead1 = (after: string, type = "clarification", id = MATH) => draftCorrection(id, "explainer.could_lead", after, type);

    it("judges the correction's after as it does a could_lead, at the after", () => {
      expect(draftOf("POSSIBILITY", onlyCorrections(lead1("It could lead to other uses.")))).toEqual([]);
      const issues = draftOf("POSSIBILITY", onlyCorrections(lead1(NO_WORD)));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "POSSIBILITY", severity: "error", path: "corrections[0].after" });
      expect(draftOf("POSSIBILITY", onlyCorrections(lead1("It could help, but it will cure sample diseases.")))).toHaveLength(1);
      for (const type of ["correction", "clarification", "update"]) expect(draftOf("POSSIBILITY", onlyCorrections(lead1(NO_WORD, type))), type).toHaveLength(1);
    });

    it("judges the text of a correction of a finding the context does not list too, and skips a removed correction and any other path", () => {
      expect(draftOf("POSSIBILITY", onlyCorrections(lead1(NO_WORD, "clarification", "bio-2099-0001")))).toHaveLength(1);
      expect(draftOf("POSSIBILITY", onlyCorrections(lead1(REMOVED_TEXT.en, "removed")))).toEqual([]);
      expect(draftOf("POSSIBILITY", onlyCorrections(draftCorrection(MATH, "explainer.found", NO_WORD, "clarification")))).toEqual([]);
    });
  });
});

describe("POSSIBILITY in published mode", () => {
  const path = (id: string): string => `findings/${id}.json: explainer.could_lead.en`;
  const lead = (id: string, text: string) => (w: WorldJson): void => { findingJson(w, id).explainer.could_lead.en = text; };

  it("judges the English could_lead of every record, the ones being published and the others", () => {
    expect(pubOf("POSSIBILITY")).toEqual([]);
    for (const id of [BIO, PHYS]) {
      const issues = pubOf("POSSIBILITY", lead(id, "It leads to sample uses."));
      expect(issues, id).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "POSSIBILITY", severity: "error", path: path(id) });
      expect(pubOf("POSSIBILITY", lead(id, "It could help, but it will cure sample diseases."))).toHaveLength(1);
      expect(pubOf("POSSIBILITY", (w) => { findingJson(w, id).explainer.could_lead.zh = "它會帶來範例用途。"; })).toEqual([]);
    }
    expect(pubOf("POSSIBILITY", lead(PHYS, "It leads to sample uses."), null)).toHaveLength(1);
  });

  it("skips a could_lead a stored removed correction rewrote, and fails the text it left out of the record", () => {
    const rewritten = (w: WorldJson): void => { findingJson(w, BIO).explainer.could_lead = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh }; };
    const removal = (p: string) => (w: WorldJson): void => { w.corrections.push(correctionJson("C-0003", D, BIO, p, REMOVED_TEXT.en, "removed")); };
    expect(pubOf("POSSIBILITY", rewritten)).toHaveLength(1);
    expect(pubOf("POSSIBILITY", (w) => { rewritten(w); removal("explainer.could_lead")(w); })).toEqual([]);
    expect(pubOf("POSSIBILITY", (w) => { rewritten(w); removal("explainer.found")(w); })).toHaveLength(1);
  });

  it("judges a stored correction's after, at its place in corrections.json, and skips a removed one", () => {
    const correct = (after: string, type = "clarification") => (w: WorldJson): void => {
      w.corrections.push(correctionJson("C-0003", "2026-11-22", BIO, "explainer.could_lead", after, type));
    };
    expect(pubOf("POSSIBILITY", correct("It could lead to other uses."))).toEqual([]);
    const issues = pubOf("POSSIBILITY", correct("It leads to other uses."));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "POSSIBILITY", severity: "error", path: "corrections.json: corrections[2].after.en" });
    expect(pubOf("POSSIBILITY", correct("It could lead to other uses, and it will cure."))).toHaveLength(1);
    expect(pubOf("POSSIBILITY", correct(REMOVED_TEXT.en, "removed"))).toEqual([]);
    expect(pubOf("POSSIBILITY", correct("It leads to other uses."), null)).toHaveLength(1);
  });
});

// ── What the draft schema never lets through ─────────────────────────────────────────────────────

describe("a removed correction on a vocabulary path, which the draft schema refuses before any rule runs", () => {
  it("refiles nothing: CLAIMED_CAP and LANDMARK_BASIS judge a stored finding for a correction of any type but removed", () => {
    const onSignificance = (after: string, type: string) => onlyCorrections(draftCorrection(MATH, "significance", after, type));
    const preprint = storedFinding(MATH, {
      title: l("A made-up proof"), depth: "item", significance: "major", rung: "preprint",
      rung_history: [{ rung: "preprint", date: "2026-10-01", recorded: "2026-10-02", source_id: "s2", by: "agent", note: null }],
    });
    expect(rawOf("CLAIMED_CAP", onSignificance("major", "removed"), { stored: stored([preprint]) })).toEqual([]);
    expect(rawOf("CLAIMED_CAP", onSignificance("major", "correction"), { stored: stored([preprint]) })).toHaveLength(1);
    const landmark = storedFinding(MATH, { title: l("A made-up proof"), depth: "item", significance: "landmark" });
    expect(rawOf("LANDMARK_BASIS", onSignificance("landmark", "removed"), { stored: stored([landmark]) })).toEqual([]);
    expect(rawOf("LANDMARK_BASIS", onSignificance("landmark", "correction"), { stored: stored([landmark]) })).toHaveLength(1);
  });
});

// ── A stored finding the context does not list ───────────────────────────────────────────────────

/**
 * The weekday context without `ids` in any list that names a finding: the run does not know them (REF_UNKNOWN's), whatever record
 * `DraftInputs.stored` holds for them.
 */
function unlisted(...ids: string[]): AgentContext {
  const keep = (id: string | null): boolean => id === null || !ids.includes(id);
  return contextWith((c) => {
    c.recent_findings = c.recent_findings.filter((f: Json) => keep(f.id));
    c.reports = c.reports.filter((r: Json) => keep(r.finding_id));
    c.rung_proposals = c.rung_proposals.filter((p: Json) => keep(p.finding_id));
    for (const s of c.standing_stories) s.finding_ids = s.finding_ids.filter(keep);
    c.corrections.flagged = c.corrections.flagged.filter((f: Json) => keep(f.finding_id));
  });
}

describe("a stored finding the context does not list, whose record the run holds", () => {
  // REF_UNKNOWN reports the id, so no rule of the group judges the finding as well. Each test runs a draft that fails the rule for a
  // listed finding, then the same draft with the finding out of the context's lists: [issues when listed, issues when not].
  const math = (over: Json = {}): Finding => storedFinding(MATH, { title: l("A made-up proof"), depth: "item", ...over });
  const lists = (code: string, edit: Edit, records: StoredRecords): [number, number] => [
    draftOf(code, edit, { stored: records }).length,
    draftOf(code, edit, { stored: records, context: unlisted(MATH) }).length,
  ];
  const asStory = (edit: Edit): Edit => (d) => { edit(d); d.story = MATH; d.items = ["new-1", "new-2"]; };
  const asDeepDive = (edit: Edit): Edit => (d) => {
    edit(d);
    d.items = ["new-2"];
    d.returning = [];
    d.lead = [{ text: "A sample protein result leads today.", refs: ["new-1", "new-2"] }];
    d.deep_dive = { finding_id: MATH, text: "A made-up deep dive.", source_ids: ["b1"], why_today: "rotation" };
  };

  it("leaves the rung entries a draft adds to it alone: RUNG_EVIDENCE and RUNG_ORDER", () => {
    const entry = (rung: string, date: string) => (d: Json): void => { d.returning[0].rung = { rung, date, source_id: "b1", note: null }; };
    // b1 is a paper, which cannot show Retracted; the stored record's last entry is dated 2026-11-20.
    expect(lists("RUNG_EVIDENCE", entry("retracted", "2026-11-23"), stored([math()]))).toEqual([1, 0]);
    expect(lists("RUNG_ORDER", entry("checked", "2026-11-19"), stored([math()]))).toEqual([1, 0]);
  });

  it("leaves a correction of its significance alone: CLAIMED_CAP and LANDMARK_BASIS", () => {
    const raise = (after: string) => onlyCorrections(draftCorrection(MATH, "significance", after));
    const preprint = math({
      significance: "notable", rung: "preprint",
      rung_history: [{ rung: "preprint", date: "2026-10-01", recorded: "2026-10-02", source_id: "s2", by: "agent", note: null }],
    });
    expect(lists("CLAIMED_CAP", raise("major"), stored([preprint]))).toEqual([1, 0]);
    const oneReaction = math({ significance: "major", reactions: [reaction("s2", "R. One", "First University")], who: [{ name: "Example Lab", ror: null }] });
    expect(lists("LANDMARK_BASIS", raise("landmark"), stored([oneReaction]))).toEqual([1, 0]);
  });

  it("leaves its place in the story, the items and the deep dive alone: NON_AI_LANDMARK_ONLY and SETBACK_MAJOR", () => {
    const cases: [string, Json[], StoredRecords][] = [
      ["NON_AI_LANDMARK_ONLY", [draftCorrection(MATH, "ai.role", "none")], stored([math({ significance: "notable" })])],
      ["SETBACK_MAJOR", [draftCorrection(MATH, "kind", "setback"), draftCorrection(MATH, "significance", "notable")], stored([math({ significance: "major" })])],
    ];
    for (const [code, corrections, records] of cases) {
      const item = onlyCorrections(...corrections);
      expect(lists(code, item, records), `${code} item`).toEqual([1, 0]);
      expect(lists(code, asStory(item), records), `${code} story`).toEqual([1, 0]);
      expect(lists(code, asDeepDive(item), records), `${code} deep dive`).toEqual([1, 0]);
    }
  });

  it("leaves a correction of its AI role or its how_sure alone: AI_CONFIDENCE and WHO_SAYS", () => {
    expect(lists("AI_CONFIDENCE", onlyCorrections(draftCorrection(MATH, "ai.role", "ai_tool")), stored([storedNoAi()]))).toEqual([1, 0]);
    expect(lists("WHO_SAYS", onlyCorrections(draftCorrection(MATH, "explainer.how_sure", "Mostly fine.", "clarification")), stored([math()]))).toEqual([1, 0]);
  });
});

// ── A correction typed removed is skipped only where its after IS REMOVED_TEXT (F-43, F-71) ───────

describe("a correction typed removed, in WHO_SAYS and POSSIBILITY", () => {
  const ZH_OTHER = "別的文字。";
  const draftRemoved = (path: string, after: string) => onlyCorrections(draftCorrection(MATH, path, after, "removed"));
  /** A stored correction typed `removed` with `after` as the record holds it, whatever that is. */
  const storedRemoved = (path: string, after: Json) => (w: WorldJson): void => {
    w.corrections.push({ ...correctionJson("C-0003", "2026-11-22", BIO, path, "x", "removed"), after });
  };
  const AFTERS: [string, Json, boolean][] = [
    ["REMOVED_TEXT in both languages", { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh }, true],
    ["REMOVED_TEXT in English alone", { en: REMOVED_TEXT.en, zh: null }, false],
    ["REMOVED_TEXT in English and other Chinese", { en: REMOVED_TEXT.en, zh: ZH_OTHER }, false],
    ["REMOVED_TEXT in Chinese and other English", { en: "Mostly fine.", zh: REMOVED_TEXT.zh }, false],
    ["other text in English alone", { en: "Mostly fine.", zh: null }, false],
  ];
  /** Texts that look like REMOVED_TEXT and are not it: the marker is compared as written, never trimmed, folded or normalised. */
  const fullWidth = [...REMOVED_TEXT.en].map((ch) => (ch === " " ? ch : String.fromCharCode(ch.charCodeAt(0) + 0xfee0))).join("");
  const NEAR_MISSES: [string, string][] = [
    ["a trailing space", `${REMOVED_TEXT.en} `],
    ["a leading space", ` ${REMOVED_TEXT.en}`],
    ["a no-break space for the first space", REMOVED_TEXT.en.replace(" ", String.fromCharCode(0xa0))],
    ["a zero-width space inside a word", REMOVED_TEXT.en.replace("text", `te${String.fromCharCode(0x200b)}xt`)],
    ["full-width letters, which NFKC would make the marker", fullWidth],
    ["lower case", REMOVED_TEXT.en.toLowerCase()],
    ["no final stop", REMOVED_TEXT.en.slice(0, -1)],
    ["an astral character after it", `${REMOVED_TEXT.en}${String.fromCodePoint(0x1f600)}`],
    ["a lone surrogate after it", `${REMOVED_TEXT.en}${String.fromCharCode(0xd800)}`],
  ];

  describe("in a draft, which the schema never lets through, so the rule's own guard is tested", () => {
    it("WHO_SAYS skips the marker and judges any other text, at the after", () => {
      expect(rawOf("WHO_SAYS", draftRemoved("explainer.how_sure", REMOVED_TEXT.en))).toEqual([]);
      const issues = rawOf("WHO_SAYS", draftRemoved("explainer.how_sure", "Mostly fine."));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "WHO_SAYS", severity: "error", path: "corrections[0].after" });
      expect(issues[0]!.message).toBe('how_sure starts with "Mostly fine.". It must start with the label of the rung: "Preprint".');
      // The marker is a text like any other when the correction is of another type, and so is text that only begins with it.
      for (const type of ["correction", "clarification", "update"]) {
        expect(rawOf("WHO_SAYS", onlyCorrections(draftCorrection(MATH, "explainer.how_sure", REMOVED_TEXT.en, type))), type).toHaveLength(1);
      }
      expect(rawOf("WHO_SAYS", draftRemoved("explainer.how_sure", `${REMOVED_TEXT.en} Preprint by arXiv.`))).toHaveLength(1);
      expect(rawOf("WHO_SAYS", draftRemoved("explainer.how_sure", "Preprint by arXiv."))).toEqual([]);
    });

    it("POSSIBILITY skips the marker and judges any other text, a promise included, at the after", () => {
      expect(rawOf("POSSIBILITY", draftRemoved("explainer.could_lead", REMOVED_TEXT.en))).toEqual([]);
      const issues = rawOf("POSSIBILITY", draftRemoved("explainer.could_lead", "It leads to sample uses."));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "POSSIBILITY", severity: "error", path: "corrections[0].after" });
      expect(rawOf("POSSIBILITY", draftRemoved("explainer.could_lead", "It could help, but it will cure sample diseases."))).toHaveLength(1);
      for (const type of ["correction", "clarification", "update"]) {
        expect(rawOf("POSSIBILITY", onlyCorrections(draftCorrection(MATH, "explainer.could_lead", REMOVED_TEXT.en, type))), type).toHaveLength(1);
      }
      expect(rawOf("POSSIBILITY", draftRemoved("explainer.could_lead", `${REMOVED_TEXT.en} It could help.`))).toEqual([]);
      expect(rawOf("POSSIBILITY", draftRemoved("explainer.could_lead", `${REMOVED_TEXT.en} It will solve sample problems.`))).toHaveLength(2);
    });

    it("goes on to the corrections after a skipped one, and reports each at its own place", () => {
      const both = (path: string, bad: string) => onlyCorrections(draftCorrection(MATH, path, REMOVED_TEXT.en, "removed"), draftCorrection(MATH, path, bad, "clarification"));
      const how = rawOf("WHO_SAYS", both("explainer.how_sure", "Mostly fine."));
      expect(how.map((i) => i.path)).toEqual(["corrections[1].after"]);
      const lead = rawOf("POSSIBILITY", both("explainer.could_lead", "It leads to sample uses."));
      expect(lead.map((i) => i.path)).toEqual(["corrections[1].after"]);
    });

    it("still reads no other path and no finding the run does not know, whatever the text", () => {
      expect(rawOf("WHO_SAYS", draftRemoved("explainer.found", "Mostly fine."))).toEqual([]);
      expect(rawOf("POSSIBILITY", draftRemoved("explainer.found", "It leads to sample uses."))).toEqual([]);
      expect(rawOf("WHO_SAYS", onlyCorrections(draftCorrection("bio-2099-0001", "explainer.how_sure", "Mostly fine.", "removed")))).toEqual([]);
      // A correction of an edition or a term is no correction of a finding's explainer, whatever its path says.
      for (const target of [{ edition_date: D }, { term_id: "lattice" }]) {
        const other = (path: string, after: string): Json => ({ ...draftCorrection(MATH, path, after, "removed"), finding_id: null, ...target });
        expect(rawOf("WHO_SAYS", onlyCorrections(other("explainer.how_sure", "Mostly fine."))), JSON.stringify(target)).toEqual([]);
        expect(rawOf("POSSIBILITY", onlyCorrections(other("explainer.could_lead", "It leads to sample uses."))), JSON.stringify(target)).toEqual([]);
      }
    });

    it("reads the path exactly: a path that only starts with, ends with or holds the two paths is no correction of them", () => {
      for (const path of ["explainer.how_sure.en", "explainer.how_surely", "x.explainer.how_sure", "ai.how_sure", "explainer.could_lead", "explainer.found"]) {
        expect(rawOf("WHO_SAYS", draftRemoved(path, "Mostly fine.")), path).toEqual([]);
      }
      for (const path of ["explainer.could_lead.en", "explainer.could_leads", "x.explainer.could_lead", "ai.could_lead", "explainer.how_sure", "explainer.found"]) {
        expect(rawOf("POSSIBILITY", draftRemoved(path, "It leads to sample uses.")), path).toEqual([]);
      }
    });

    it("reads the after exactly: a near miss of REMOVED_TEXT is a text like any other, judged once by each rule", () => {
      for (const [name, after] of NEAR_MISSES) {
        expect(rawOf("WHO_SAYS", draftRemoved("explainer.how_sure", after)), name).toHaveLength(1);
        expect(rawOf("POSSIBILITY", draftRemoved("explainer.could_lead", after)), name).toHaveLength(1);
      }
      expect(rawOf("WHO_SAYS", draftRemoved("explainer.how_sure", "")), "empty").toHaveLength(1);
      expect(rawOf("POSSIBILITY", draftRemoved("explainer.could_lead", "")), "empty").toHaveLength(1);
    });
  });

  describe("in a stored correction, whose REMOVED_TEXT holds both languages", () => {
    it("WHO_SAYS skips a correction that holds REMOVED_TEXT in both languages and judges one that holds anything else", () => {
      for (const [name, after, skipped] of AFTERS) {
        expect(pubOf("WHO_SAYS", storedRemoved("explainer.how_sure", after)), name).toHaveLength(skipped ? 0 : 1);
      }
      const issues = pubOf("WHO_SAYS", storedRemoved("explainer.how_sure", { en: "Mostly fine.", zh: null }));
      expect(issues[0]).toMatchObject({ code: "WHO_SAYS", severity: "error", path: "corrections.json: corrections[2].after.en" });
      expect(issues[0]!.message).toBe('how_sure starts with "Mostly fine.". It must start with the label of the rung: "Preprint" or "Checked".');
      expect(pubOf("WHO_SAYS", storedRemoved("explainer.how_sure", { en: "Checked by Example Journal.", zh: null }))).toEqual([]);
    });

    it("POSSIBILITY skips a correction that holds REMOVED_TEXT in both languages and judges one that holds anything else", () => {
      const lead = (after: Json) => pubOf("POSSIBILITY", storedRemoved("explainer.could_lead", after));
      for (const [name, after, skipped] of AFTERS) expect(lead(after), name).toHaveLength(skipped ? 0 : 1);
      const issues = lead({ en: "It leads to other uses.", zh: null });
      expect(issues[0]).toMatchObject({ code: "POSSIBILITY", severity: "error", path: "corrections.json: corrections[2].after.en" });
      expect(lead({ en: "It could lead to other uses.", zh: null })).toEqual([]);
      expect(lead({ en: "It could help, and it will cure.", zh: REMOVED_TEXT.zh })).toHaveLength(1);
    });

    it("goes on to the corrections after a skipped one, and reports each at its own place", () => {
      const both = (path: string, bad: string) => (w: WorldJson): void => {
        storedRemoved(path, { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh })(w);
        w.corrections.push(correctionJson("C-0004", "2026-11-22", BIO, path, bad, "clarification"));
      };
      expect(pathsOf(pubOf("WHO_SAYS", both("explainer.how_sure", "Mostly fine.")))).toEqual(["corrections.json: corrections[3].after.en"]);
      expect(pathsOf(pubOf("POSSIBILITY", both("explainer.could_lead", "It leads to other uses.")))).toEqual(["corrections.json: corrections[3].after.en"]);
    });

    it("judges REMOVED_TEXT in both languages when the correction is of another type", () => {
      const other = (path: string, type: string) => (w: WorldJson): void => {
        w.corrections.push({ ...correctionJson("C-0003", "2026-11-22", BIO, path, "x", type), after: { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh } });
      };
      for (const type of ["correction", "clarification", "update"]) {
        expect(pubOf("WHO_SAYS", other("explainer.how_sure", type)), type).toHaveLength(1);
        expect(pubOf("POSSIBILITY", other("explainer.could_lead", type)), type).toHaveLength(1);
      }
    });

    it("reads the after exactly, in each language: a near miss of REMOVED_TEXT is a text like any other", () => {
      for (const [name, en] of NEAR_MISSES) {
        for (const zh of [REMOVED_TEXT.zh, null]) {
          expect(pubOf("WHO_SAYS", storedRemoved("explainer.how_sure", { en, zh })), `${name}, zh ${String(zh)}`).toHaveLength(1);
          expect(pubOf("POSSIBILITY", storedRemoved("explainer.could_lead", { en, zh })), `${name}, zh ${String(zh)}`).toHaveLength(1);
        }
      }
      // the Chinese is compared as written too
      for (const [name, zh] of [["a trailing space", `${REMOVED_TEXT.zh} `], ["a zero-width space", `${REMOVED_TEXT.zh}${String.fromCharCode(0x200b)}`]] as const) {
        expect(pubOf("WHO_SAYS", storedRemoved("explainer.how_sure", { en: REMOVED_TEXT.en, zh })), name).toHaveLength(1);
        expect(pubOf("POSSIBILITY", storedRemoved("explainer.could_lead", { en: REMOVED_TEXT.en, zh })), name).toHaveLength(1);
      }
    });

    it("reads both languages of a correction that the date being published dated, as it does an older one", () => {
      const onD = (path: string, after: Json) => (w: WorldJson): void => {
        w.corrections.push({ ...correctionJson("C-0003", D, BIO, path, "x", "removed"), after });
      };
      for (const [name, after, skipped] of AFTERS) {
        expect(pubOf("WHO_SAYS", onD("explainer.how_sure", after)), name).toHaveLength(skipped ? 0 : 1);
        expect(pubOf("POSSIBILITY", onD("explainer.could_lead", after)), name).toHaveLength(skipped ? 0 : 1);
      }
    });

    it("reads the path exactly: a path that only starts with, ends with or holds the two paths is no correction of them", () => {
      const text = { en: "Mostly fine.", zh: null };
      for (const path of ["explainer.how_sure.en", "explainer.how_surely", "x.explainer.how_sure", "ai.how_sure", "explainer.could_lead", "explainer.found"]) {
        expect(pubOf("WHO_SAYS", storedRemoved(path, text)), path).toEqual([]);
      }
      for (const path of ["explainer.could_lead.en", "explainer.could_leads", "x.explainer.could_lead", "ai.could_lead", "explainer.how_sure", "explainer.found"]) {
        expect(pubOf("POSSIBILITY", storedRemoved(path, { en: "It leads to other uses.", zh: null })), path).toEqual([]);
      }
    });

    it("keeps AI_CONFIDENCE's skip by type, since a removed correction refiles nothing whatever its after", () => {
      const noAi = (w: WorldJson): void => { findingJson(w, PHYS).ai = structuredClone(NO_AI); findingJson(w, PHYS).explainer.ai_helped = null; };
      const role = (type: string) => (w: WorldJson): void => {
        noAi(w);
        w.corrections.push({ ...correctionJson("C-0003", "2026-11-20", PHYS, "ai.role", "ai_tool", type), after: l("ai_tool") });
      };
      expect(pubOf("AI_CONFIDENCE", role("correction"))).toHaveLength(1);
      expect(pubOf("AI_CONFIDENCE", role("removed"))).toEqual([]);
    });
  });
});
