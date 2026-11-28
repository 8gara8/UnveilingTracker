// The fixtures of the ladder and AI group (SPEC §4.12 "Fixtures and tests"; fixtures/src/invalid/ladder-ai.ts): RUNG_EVIDENCE,
// RUNG_ORDER, CLAIMED_CAP, LANDMARK_BASIS, NON_AI_LANDMARK_ONLY, SETBACK_MAJOR, AI_CONFIDENCE, AI_SYSTEM_NAMED, WHO_SAYS and
// POSSIBILITY. It checks that the F cases are the ones the rule table lists, each filed as invalid--CODE.json, fail the whole
// validator with exactly their code at the part they are about, change one part of the weekday draft and match the files in
// fixtures/drafts/ byte for byte; that the S list is empty because every code of the group is hard; that each T case gives its exact
// set of error and warning codes with its edition's own inputs, from the whole validator and from the group's rules alone, and
// gives the same set when the run is also given the stored records; that each boundary a case names has a passing neighbour, so the
// case fails for that boundary and no other; that the cases the spec names (the Major setback built from notices and the
// publisher's statement, the result whose Checked entry cites only a notice) behave as it says; that the clauses which need a
// stored finding in full (its role, kind, reactions and the stored corrections, which the fixtures' inputs do not give) fail only
// when the run is given the stored records; that the four valid editions pass; and that the cases add nothing but invented text and
// ids, with no link and no dash of the wrong kind. Published-mode cases (a stored brief judged on its own date, a record being
// published or not) work on a copy of the sample content and are not here. New for this project; Cyber's tests/validate.test.ts ran
// its F cases through its whole validator.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDITIONS, EDITION_NAMES, REPO_ROOT, storedFindingsBefore, storedGlossary, storedWeekdayCorrections, type EditionName,
} from "@/fixtures/src/world";
import { invalidDraft, invalidOutputs } from "@/fixtures/src/build";
import { MONDAY_ITEMS, SUNDAY_ITEMS, WEEKDAY_ITEMS, editionDraft, newFindingOf } from "@/fixtures/src/drafts";
import { draftInputs } from "@/fixtures/src/inputs";
import { ladderAiCases, ladderAiNamed, ladderAiSoft } from "@/fixtures/src/invalid/ladder-ai";
import { RULE_CODE_TABLE, codesOfGroup } from "@/lib/rules";
import { ladderAiRules } from "@/lib/rules/ladder-ai";
import { buildDraftInput, runRules, type DraftInputs } from "@/lib/rules/run";
import type { StoredRecords, ValidationIssue } from "@/lib/rules/types";
import { DraftBrief, type DraftCorrection } from "@/lib/schema/draft";
import { Correction } from "@/lib/schema/misc";
import { validateDraft } from "@/lib/validate";

type Json = Record<string, unknown>;

const MINE = codesOfGroup("ladder-ai");

/** A correction of a stored finding's own filing (SPEC §4.10), as the draft writes it. */
function refile(finding_id: string, path: string, after: string, type: DraftCorrection["type"] = "correction"): DraftCorrection {
  return {
    finding_id, edition_date: null, term_id: null, type, path, after, reason: `SAMPLE: the record was filed with the wrong ${path}.`, source_url: null,
    report_id: null,
  };
}
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const I = WEEKDAY_ITEMS;
const S = SUNDAY_ITEMS;
const M = MONDAY_ITEMS;

/** Where each F case fails: the one issue path pattern its code is reported at. */
const WHERE: Readonly<Record<string, RegExp>> = {
  RUNG_EVIDENCE: /^new_findings\[\d+\]\.rung_history\[\d+\]\.source_id$/,
  RUNG_ORDER: /^new_findings\[\d+\]\.rung_history\[\d+\]\.date$/,
  CLAIMED_CAP: /^new_findings\[\d+\]\.significance$/,
  LANDMARK_BASIS: /^new_findings\[\d+\]\.significance$/,
  NON_AI_LANDMARK_ONLY: /^new_findings\[\d+\]\.ai\.role$/,
  SETBACK_MAJOR: /^new_findings\[\d+\]\.significance$/,
  AI_CONFIDENCE: /^new_findings\[\d+\]\.ai\.confidence$/,
  AI_SYSTEM_NAMED: /^new_findings\[\d+\]\.ai\.systems$/,
  WHO_SAYS: /^new_findings\[\d+\]\.explainer\.how_sure$/,
  POSSIBILITY: /^new_findings\[\d+\]\.explainer\.could_lead$/,
};

/** The most top-level parts a T case may change. */
const T_TOUCHES_MAX = 4;

type Mutating = { edition?: EditionName; mutate: (draft: DraftBrief) => unknown };

/** A case's draft: a fresh copy of its edition's valid draft, mutated (as the builder's `invalidDraft()` does for an F case). */
const mutated = (c: Mutating): unknown => {
  const draft = editionDraft(c.edition ?? "weekday");
  const out = c.mutate(draft);
  return out === undefined ? draft : out;
};

/** The records a morning's validating stage reads from `content/` for an edition (SPEC §4.12 "Stored records"). */
function storedFor(edition: EditionName, extra: readonly unknown[] = []): StoredRecords {
  const date = EDITIONS[edition].date;
  return {
    findings: storedFindingsBefore(date),
    corrections: [...(date > EDITIONS.weekday.date ? storedWeekdayCorrections() : []), ...extra.map((c) => Correction.parse(c))],
    terms: storedGlossary(date).terms,
  };
}

const inputsOf = (edition: EditionName, stored?: StoredRecords): DraftInputs => ({ ...draftInputs(edition), ...(stored === undefined ? {} : { stored }) });

/** The group's own rules on a draft with its edition's inputs, and the whole validator on it; a rule that throws fails the test. */
const own = (draft: unknown, edition: EditionName, stored?: StoredRecords): ValidationIssue[] =>
  noCrash(runRules(buildDraftInput(DraftBrief.parse(draft), inputsOf(edition, stored)), ladderAiRules));
const whole = (draft: unknown, edition: EditionName, stored?: StoredRecords): ValidationIssue[] =>
  noCrash(validateDraft(draft, inputsOf(edition, stored)).issues);

/** `runRules()` turns a rule that throws into a RULE_ERROR issue, which a filter by code would hide: no case may give one. */
function noCrash(issues: ValidationIssue[]): ValidationIssue[] {
  const crashed = issues.filter((i) => i.code === "RULE_ERROR");
  if (crashed.length > 0) throw new Error(`a rule threw: ${crashed.map((i) => i.message).join(" | ")}`);
  return issues;
}

const tell = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.code}`);
const codesOf = (issues: readonly ValidationIssue[], severity: string): string[] =>
  [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();

/** The top-level parts in which two drafts differ. */
function touched(before: unknown, after: unknown): string[] {
  const a = before as Json;
  const b = after as Json;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

/** Every string in a JSON value. */
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) leaves(v, out);
  return out;
}

/** The strings of `after` that `before` does not hold. */
function added(before: unknown, after: unknown): string[] {
  const had = new Set(leaves(before));
  return [...new Set(leaves(after))].filter((s) => !had.has(s));
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** The share of `text`'s words that one string of `pool` also holds: 1 for text cut or reordered from it, near 1 for a few words swapped. */
function mostShared(text: string, pool: readonly string[]): number {
  const mine = words(text);
  if (mine.length === 0) return 1;
  let best = 0;
  for (const other of pool) {
    const counts = new Map<string, number>();
    for (const w of words(other)) counts.set(w, (counts.get(w) ?? 0) + 1);
    let shared = 0;
    for (const w of mine) {
      const n = counts.get(w) ?? 0;
      if (n > 0) {
        shared += 1;
        counts.set(w, n - 1);
      }
    }
    best = Math.max(best, shared / mine.length);
  }
  return best;
}

// ── The F cases ──────────────────────────────────────────────────────────────────────────────────

describe("the ladder and AI group's F cases", () => {
  it("has one F case for each code that the rule table lists an F fixture for, in the table's order, each filed as invalid--CODE.json", () => {
    const listed = RULE_CODE_TABLE.filter((r) => r.group === "ladder-ai" && r.tests.includes("F")).map((r) => r.code);
    expect(listed).toEqual([
      "RUNG_EVIDENCE", "RUNG_ORDER", "CLAIMED_CAP", "LANDMARK_BASIS", "NON_AI_LANDMARK_ONLY", "SETBACK_MAJOR", "AI_CONFIDENCE", "AI_SYSTEM_NAMED",
      "WHO_SAYS", "POSSIBILITY",
    ]);
    expect(ladderAiCases.map((c) => c.code)).toEqual(listed);
    for (const c of ladderAiCases) expect(c.file, c.code).toBe(`invalid--${c.code}.json`);
    expect(new Set(ladderAiCases.map((c) => c.file)).size).toBe(ladderAiCases.length);
  });

  it("makes each case from the weekday draft, the draft the spec says an F case mutates", () => {
    for (const c of ladderAiCases) expect(c.edition ?? "weekday", c.code).toBe("weekday");
  });

  it.each(ladderAiCases.map((c) => [c.code, c] as const))(
    "F %s: fails validateDraft() with exactly its code, at the part it is about, by a small change",
    (code, c) => {
      const draft = invalidDraft(c);
      const issues = whole(draft, "weekday");
      expect(issues.length, code).toBeGreaterThan(0);
      expect([...new Set(tell(issues))], code).toEqual([`error ${code}`]);
      for (const issue of issues) expect(issue.path, `${code} at ${issue.path}`).toMatch(WHERE[code]!);
      // The group's own rules say the same, on the same paths: no other rule is needed to make the case fail
      const mine = own(draft, "weekday");
      expect([...new Set(tell(mine))], code).toEqual([`error ${code}`]);
      expect(mine.map((i) => i.path), code).toEqual(issues.map((i) => i.path));
      // One new finding changes, and nothing else of the draft
      expect(touched(editionDraft("weekday"), draft), code).toEqual(["new_findings"]);
    },
  );

  it.each(ladderAiCases.map((c) => [c.code, c] as const))("F %s: its file in fixtures/drafts/ is the builder's output and fails the same way", (code, c) => {
    const { path, text } = invalidOutputs([c])[0]!;
    expect(path).toBe(`fixtures/drafts/invalid--${code}.json`);
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    expect([...new Set(tell(whole(JSON.parse(text), "weekday")))]).toEqual([`error ${code}`]);
  });

  it("gives each F case its own fault: the part it changes is the part its code reads, and no two cases change the same finding the same way", () => {
    const texts = ladderAiCases.map((c) => JSON.stringify(invalidDraft(c)));
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("the ladder and AI group's S list", () => {
  it("is empty, because every code of the group is hard and the table lists no S fixture for any", () => {
    expect(ladderAiSoft).toEqual([]);
    expect(MINE).toEqual([
      "RUNG_EVIDENCE", "RUNG_ORDER", "CLAIMED_CAP", "LANDMARK_BASIS", "NON_AI_LANDMARK_ONLY", "SETBACK_MAJOR", "AI_CONFIDENCE", "AI_SYSTEM_NAMED",
      "WHO_SAYS", "POSSIBILITY",
    ]);
    for (const code of MINE) {
      const info = RULE_CODE_TABLE.find((r) => r.code === code)!;
      expect(info.severity, code).toBe("H");
      expect(info.tests, code).not.toContain("S");
    }
  });

  it("gives the group's rules no warning on any case, so no code of the group is a soft gate", () => {
    for (const c of ladderAiNamed) expect(codesOf(own(mutated(c), c.edition), "warning"), c.name).toEqual([]);
    for (const c of ladderAiCases) expect(codesOf(own(invalidDraft(c), c.edition ?? "weekday"), "warning"), c.code).toEqual([]);
  });
});

// ── The T cases ──────────────────────────────────────────────────────────────────────────────────

describe("the ladder and AI group's T cases", () => {
  it("has named cases with unique names, each starting with the code it is about, which one of its errors is", () => {
    expect(new Set(ladderAiNamed.map((c) => c.name)).size).toBe(ladderAiNamed.length);
    for (const c of ladderAiNamed) {
      expect(c.name.startsWith(`${c.code}: `), c.name).toBe(true);
      expect(MINE, c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toEqual([...c.expect.errors].sort());
      expect([...c.expect.warnings], c.name).toEqual([...c.expect.warnings].sort());
      expect(EDITION_NAMES, c.name).toContain(c.edition);
    }
  });

  it("covers each code of the group in an F case and a T case, and the weekday, Sunday and Monday editions", () => {
    for (const code of MINE) {
      expect(ladderAiCases.some((c) => c.code === code), `F ${code}`).toBe(true);
      expect(ladderAiNamed.some((c) => c.code === code), `T ${code}`).toBe(true);
    }
    for (const edition of ["weekday", "sunday", "monday"] as const) expect(ladderAiNamed.some((c) => c.edition === edition), edition).toBe(true);
  });

  it.each(ladderAiNamed.map((c) => [c.name, c] as const))("T %s", (_name, c) => {
    const draft = mutated(c);
    const issues = whole(draft, c.edition);
    expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }).toEqual({ errors: [...c.expect.errors], warnings: [...c.expect.warnings] });
    // The group's own rules say the part that is theirs: the codes of the group among the expected errors, and nothing else
    const mine = own(draft, c.edition);
    expect(codesOf(mine, "error")).toEqual(c.expect.errors.filter((code) => MINE.includes(code)));
    expect(codesOf(mine, "warning")).toEqual([]);
    // A small change of its edition's valid draft
    expect(touched(editionDraft(c.edition), draft).length).toBeLessThanOrEqual(T_TOUCHES_MAX);
  });

  it("gives every F and T case the same issues when the run is also given the stored records, so no case depends on the part of a stored finding the context hides", () => {
    for (const c of ladderAiCases) {
      const edition = c.edition ?? "weekday";
      expect(tell(whole(invalidDraft(c), edition, storedFor(edition))), `F ${c.code}`).toEqual(tell(whole(invalidDraft(c), edition)));
    }
    for (const c of ladderAiNamed) {
      expect(tell(whole(mutated(c), c.edition, storedFor(c.edition))), `T ${c.name}`).toEqual(tell(whole(mutated(c), c.edition)));
    }
  }, 30_000);

  it("passes each valid edition, with the stored records or without", () => {
    for (const edition of EDITION_NAMES) {
      expect(whole(editionDraft(edition), edition), edition).toEqual([]);
      expect(whole(editionDraft(edition), edition, storedFor(edition)), `${edition} with the stored records`).toEqual([]);
      expect(own(editionDraft(edition), edition), `${edition}, the group's rules`).toEqual([]);
    }
  });
});

// ── The cases the spec names ─────────────────────────────────────────────────────────────────────

describe("the cases the spec names", () => {
  it("passes a Major setback built from notices and the publisher's statement with `ai.systems` [], the weekday's own new-3", () => {
    const f = newFindingOf(editionDraft("weekday"), I.setback);
    expect(f.kind).toBe("setback");
    expect(f.significance).toBe("major");
    expect(f.ai.systems).toEqual([]);
    expect(f.ai.role).not.toBe("none");
    const sourceKinds = f.sources.map((s) => s.kind);
    expect(sourceKinds).toContain("notice");
    expect(sourceKinds).toContain("statement");
    expect(f.rung_history.map((e) => e.rung)).toEqual(["checked"]);
    expect(whole(editionDraft("weekday"), "weekday")).toEqual([]);
  });

  it("passes a policy_people and an infrastructure finding with no system, and fails a result with none", () => {
    for (const kind of ["policy_people", "infrastructure"] as const) {
      const d = editionDraft("weekday");
      const f = newFindingOf(d, I.claimed);
      f.kind = kind;
      f.ai.systems = [];
      // The sentence that named the system goes, and a longer one keeps the first four parts of the explainer in budget
      f.explainer.ai_helped =
        "The lab says an AI system found the proof with no human step in the argument. The preprint has not been checked, so the claim stands on the lab's word alone for now.";
      expect(whole(d, "weekday"), kind).toEqual([]);
    }
    const result = ladderAiCases.find((c) => c.code === "AI_SYSTEM_NAMED")!;
    const d = DraftBrief.parse(invalidDraft(result));
    const failing = newFindingOf(d, I.result);
    expect(failing.kind).toBe("result");
    expect(failing.ai.systems).toEqual([]);
    expect(tell(whole(d, "weekday"))).toEqual(["error AI_SYSTEM_NAMED"]);
  });

  it("fails a result whose Checked entry cites only a notice, and passes the same finding as a Major setback", () => {
    const named = ladderAiNamed.find((c) => c.name === "RUNG_EVIDENCE: a result's Checked entry cites only a notice")!;
    const d = DraftBrief.parse(mutated(named));
    const f = newFindingOf(d, I.setback);
    expect(f.kind).toBe("result");
    expect(f.rung_history).toHaveLength(1);
    expect(f.sources.find((s) => s.id === f.rung_history[0]!.source_id)!.kind).toBe("notice");
    expect(tell(whole(d, "weekday"))).toEqual(["error RUNG_EVIDENCE"]);
    expect(whole(editionDraft("weekday"), "weekday")).toEqual([]);
  });

  it("covers Claimed, Preprint and a Major finding's fall to either, which CLAIMED_CAP reads from the last entry", () => {
    const names = ladderAiNamed.filter((c) => c.code === "CLAIMED_CAP").map((c) => c.name);
    expect(names.some((n) => /Claimed/.test(n))).toBe(true);
    expect(names.some((n) => /Preprint/.test(n))).toBe(true);
    expect(names.some((n) => /correction/.test(n))).toBe(true);
  });

  it("has a Sunday case for each deep dive rule and a Monday case for the item's own two parts", () => {
    const sunday = ladderAiNamed.filter((c) => c.edition === "sunday").map((c) => c.code);
    expect(sunday).toEqual(expect.arrayContaining(["RUNG_ORDER", "NON_AI_LANDMARK_ONLY", "SETBACK_MAJOR", "POSSIBILITY"]));
    const monday = ladderAiNamed.filter((c) => c.edition === "monday").map((c) => c.code);
    expect(monday).toEqual(expect.arrayContaining(["AI_SYSTEM_NAMED", "WHO_SAYS"]));
    // The Sunday's deep dive is a stored finding of the context, and the Monday's item a new finding of the draft
    expect(editionDraft("sunday").deep_dive?.finding_id).toBe(S.deepDive);
    expect(newFindingOf(editionDraft("sunday"), S.item).ref).toBe(S.item);
    expect(newFindingOf(editionDraft("monday"), M.item).ref).toBe(M.item);
  });
});

// ── The boundary of each case ────────────────────────────────────────────────────────────────────

describe("the boundary of each case", () => {
  const NO_AI_NOTE = "This SAMPLE note shows what is claimed and who made the claim. It also shows how far the checking of the claim has gone so far.";
  const LONGER_AI_HELPED =
    "The lab says an AI system found the proof with no human step in the argument. The preprint has not been checked, so the claim stands on the lab's word alone for now.";

  /** A draft that undoes a case's fault by the smallest change its own words name, and passes with no error and no warning. */
  const NEIGHBOURS: readonly { of: string; name: string; edition: EditionName; mutate: (d: DraftBrief) => void }[] = [
    {
      of: "RUNG_EVIDENCE: a Confirmed paper from a publisher the finding's who names", name: "a who name that is the paper's publisher, with a trial named in artefacts.trial", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).who[0]!.name = "PNAS"; },
    },
    {
      of: "RUNG_EVIDENCE: a Confirmed paper from a publisher the finding's who names", name: "a paper in the same journal as the original, which names no team", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).sources[0]!.publisher = "PNAS"; newFindingOf(d, I.result).artefacts.trial = []; },
    },
    {
      of: "RUNG_EVIDENCE: a Confirmed paper that is the same paper as the original's", name: "another paper's DOI, with a trial named in artefacts.trial", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).sources[0]!.doi = "10.1101/2026.09.02.990011"; },
    },
    {
      of: "RUNG_EVIDENCE: a Confirmed entry cites the paper of the story's own Checked entry", name: "a second Confirmed entry on the independent paper that showed Confirmed", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).rung_history.push({ rung: "confirmed", date: "2026-10-14", source_id: "s2", note: null }); },
    },
    {
      of: "RUNG_EVIDENCE: an Applied entry for a stored finding cites a paper", name: "an Applied entry that cites a statement", edition: "weekday",
      mutate: (d) => { d.rung_changes[0]!.rung = { rung: "applied", date: "2026-10-13", source_id: "b1", note: null }; },
    },
    {
      of: "RUNG_EVIDENCE: a Disputed entry cites a reaction", name: "a Disputed entry that cites a paper", edition: "weekday",
      mutate: (d) => { d.rung_changes[0]!.rung.rung = "disputed"; },
    },
    {
      of: "RUNG_EVIDENCE: a Retracted entry cites a paper", name: "a Retracted entry that cites a notice", edition: "weekday",
      mutate: (d) => {
        d.rung_changes[0]!.rung.rung = "retracted";
        d.sources[1]!.kind = "notice";
      },
    },
    {
      of: "RUNG_EVIDENCE: a returning entry's new rung cites a reaction", name: "a returning Disputed entry that cites a paper", edition: "weekday",
      mutate: (d) => { d.returning[0]!.rung = { rung: "disputed", date: "2026-10-13", source_id: "b2", note: null }; },
    },
    {
      of: "RUNG_ORDER: a second entry is dated before the first", name: "two entries on one date", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).rung_history[0]!.date = "2026-10-13"; },
    },
    {
      of: "F RUNG_ORDER", name: "an entry dated D", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.story).rung_history[0]!.date = "2026-10-14"; },
    },
    {
      of: "RUNG_ORDER: a rung change is dated the day after the edition", name: "a rung change dated D", edition: "weekday",
      mutate: (d) => { d.rung_changes[0]!.rung.date = "2026-10-14"; },
    },
    {
      of: "RUNG_ORDER: a returning entry's rung is dated the day after the edition", name: "a returning entry dated D", edition: "weekday",
      mutate: (d) => { d.returning[0]!.rung = { rung: "checked", date: "2026-10-14", source_id: "b2", note: null }; },
    },
    {
      of: "RUNG_ORDER: the Sunday's entry is dated the day after the Sunday", name: "the Sunday's entry dated the Sunday", edition: "sunday",
      mutate: (d) => { newFindingOf(d, S.item).rung_history[0]!.date = "2026-10-18"; },
    },
    {
      of: "CLAIMED_CAP: a correction raises a Claimed finding to Major", name: "a correction that raises it to Notable", edition: "weekday",
      mutate: (d) => { d.corrections.push(refile(I.returning, "significance", "notable")); },
    },
    {
      of: "CLAIMED_CAP: a rung entry moves a Major finding to Claimed", name: "a rung entry that moves it to Checked", edition: "weekday",
      mutate: (d) => { d.rung_changes.push({ finding_id: "bio-2026-0143", rung: { rung: "checked", date: "2026-10-13", source_id: "b2", note: null } }); },
    },
    {
      of: "CLAIMED_CAP: a new Preprint finding filed as a Landmark also lacks its basis", name: "a Major result raised to a Landmark on a Confirmed rung", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).significance = "landmark"; },
    },
    {
      of: "LANDMARK_BASIS: a Landmark with no reactions", name: "a Landmark with two reactions and a third", edition: "weekday",
      mutate: (d) => {
        const f = newFindingOf(d, I.story);
        f.reactions = f.reactions.slice(0, 2);
      },
    },
    {
      of: "NON_AI_LANDMARK_ONLY: a Major setback with no AI role also fails SETBACK_MAJOR", name: "a Landmark with no AI role", edition: "weekday",
      mutate: (d) => {
        const f = newFindingOf(d, I.result);
        f.significance = "landmark";
        f.ai = { role: "none", confidence: null, systems: [], evidence: [] };
        f.explainer.ai_helped = null;
        f.explainer.matters = `${f.explainer.matters} ${NO_AI_NOTE}`;
      },
    },
    {
      of: "NON_AI_LANDMARK_ONLY: a correction refiles a briefed finding with no AI role", name: "the same correction on a finding the brief does not show", edition: "weekday",
      mutate: (d) => { d.corrections.push(refile("phys-2026-0147", "ai.role", "none")); },
    },
    {
      of: "SETBACK_MAJOR: the Sunday deep dive is on a finding refiled as a Notable setback", name: "the deep dive filed as a setback and still Major", edition: "sunday",
      mutate: (d) => { d.corrections.push(refile(S.deepDive, "kind", "setback")); },
    },
    {
      of: "AI_CONFIDENCE: a correction gives a non-AI Landmark an AI role", name: "a clarification of explainer.found that tells an AI role found later", edition: "weekday",
      mutate: (d) => {
        d.corrections.push(
          refile(I.tilings, "explainer.found", "SAMPLE: A later paper says a model helped find the first tiling. The proof itself is the same.", "clarification"),
        );
      },
    },
    {
      of: "AI_SYSTEM_NAMED: a capability finding lists no AI system", name: "a capability finding that lists its system", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).kind = "capability"; },
    },
    {
      of: "AI_SYSTEM_NAMED: a check finding lists no AI system", name: "a check finding that lists its system", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).kind = "check"; },
    },
    {
      of: "F AI_SYSTEM_NAMED", name: "a policy_people finding that lists none", edition: "weekday",
      mutate: (d) => {
        const f = newFindingOf(d, I.claimed);
        f.kind = "policy_people";
        f.ai.systems = [];
        f.explainer.ai_helped = LONGER_AI_HELPED;
      },
    },
    {
      of: "F AI_SYSTEM_NAMED", name: "an infrastructure finding that lists none", edition: "weekday",
      mutate: (d) => {
        const f = newFindingOf(d, I.claimed);
        f.kind = "infrastructure";
        f.ai.systems = [];
        f.explainer.ai_helped = LONGER_AI_HELPED;
      },
    },
    {
      of: "WHO_SAYS: how_sure names no publisher", name: "the publisher named in capital letters", edition: "weekday",
      mutate: (d) => {
        const f = newFindingOf(d, I.story);
        f.explainer.how_sure = f.explainer.how_sure.replace("Nature published the paper", "NATURE published the paper");
      },
    },
    {
      of: "WHO_SAYS: a claimed AI role and how_sure does not name the maker", name: "the maker named in the last sentence", edition: "weekday",
      mutate: (d) => {
        const f = newFindingOf(d, I.claimed);
        f.explainer.how_sure = f.explainer.how_sure.replace("Marlow Labs is the source of the claim", "The source of the claim is Marlow Labs");
      },
    },
    {
      of: "WHO_SAYS: the label is in the text and not at its start", name: "the label first, then a comma and more words", edition: "weekday",
      mutate: (d) => {
        const f = newFindingOf(d, I.claimed);
        f.explainer.how_sure = f.explainer.how_sure.replace("Preprint.", "Preprint, which means it is not yet reviewed.");
      },
    },
    {
      of: "POSSIBILITY: a promise beside a possibility word", name: "might", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).explainer.could_lead = "SAMPLE: The search for new medicines might get faster."; },
    },
    {
      of: "POSSIBILITY: a promise in capital letters", name: "a possibility word in capital letters", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).explainer.could_lead = "SAMPLE: Could the search for new medicines get faster?"; },
    },
    {
      of: "POSSIBILITY: a word near a possibility word that the list does not hold", name: "the word possible", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).explainer.could_lead = "SAMPLE: Faster searches for new medicines are possible."; },
    },
    {
      of: "POSSIBILITY: a word that only holds a possibility word", name: "the word possibility", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).explainer.could_lead = "SAMPLE: That opens the possibility of faster searches for new medicines."; },
    },
    {
      of: "POSSIBILITY: a correction of could_lead with no possibility word", name: "a correction of could_lead with could", edition: "weekday",
      mutate: (d) => { d.corrections.push(refile("earth-2026-0141", "explainer.could_lead", "SAMPLE: Forecasters could use the model next year.")); },
    },
  ];

  it("names, for each neighbour, a case that exists", () => {
    const names = new Set([...ladderAiNamed.map((c) => c.name), ...ladderAiCases.map((c) => `F ${c.code}`)]);
    for (const n of NEIGHBOURS) expect(names.has(n.of), n.of).toBe(true);
  });

  it("has a neighbour for each code of the group", () => {
    const codes = new Set(NEIGHBOURS.map((n) => (n.of.startsWith("F ") ? n.of.slice(2) : n.of.slice(0, n.of.indexOf(":")))));
    for (const code of MINE) expect(codes.has(code), code).toBe(true);
  });

  it.each(NEIGHBOURS.map((n) => [`${n.name} (beside ${n.of})`, n] as const))("passes with no issue at all: %s", (_label, n) => {
    const draft = editionDraft(n.edition);
    n.mutate(draft);
    expect(whole(draft, n.edition)).toEqual([]);
    expect(own(draft, n.edition)).toEqual([]);
    expect(whole(draft, n.edition, storedFor(n.edition))).toEqual([]);
  });
});

// ── The clauses that need a stored finding in full ───────────────────────────────────────────────

describe("the clauses that need the stored records", () => {
  const l = (en: string): { en: string; zh: null } => ({ en, zh: null });
  /** A stored correction as `corrections.json` holds it. */
  const storedCorrection = (id: string, date: string, finding_id: string, path: string, after: string): Json => ({
    id, date, finding_id, edition_date: null, term_id: null, type: "correction", path, before: l("SAMPLE: before"), after: l(after),
    reason: l("SAMPLE: the record was wrong."), source_url: null, trigger: "editor", report_id: null,
  });

  it("fails a draft correction that raises a stored Notable finding with no reactions to a Landmark, only when the run holds that finding", () => {
    const d = editionDraft("weekday");
    d.corrections.push(refile("phys-2026-0147", "significance", "landmark"));
    const at = `corrections[${d.corrections.length - 1}].after`;
    expect(whole(d, "weekday")).toEqual([]);
    const issues = whole(d, "weekday", storedFor("weekday"));
    expect(tell(issues)).toEqual(["error LANDMARK_BASIS"]);
    expect(issues.map((i) => i.path)).toEqual([at]);
    expect(issues[0]!.message).toContain("phys-2026-0147");
  });

  it("fails an item a stored correction filed with no AI role below Landmark, from the day the correction is dated, and never one dated later", () => {
    const idx = editionDraft("weekday").items.indexOf(I.returning);
    expect(idx).toBeGreaterThanOrEqual(0);
    const withOne = (date: string) => storedFor("weekday", [storedCorrection("C-0100", date, I.returning, "ai.role", "none")]);
    expect(whole(editionDraft("weekday"), "weekday")).toEqual([]);
    for (const date of ["2026-10-13", "2026-10-14"]) {
      const issues = whole(editionDraft("weekday"), "weekday", withOne(date));
      expect(tell(issues), date).toEqual(["error NON_AI_LANDMARK_ONLY"]);
      expect(issues.map((i) => i.path), date).toEqual([`items[${idx}]`]);
    }
    expect(whole(editionDraft("weekday"), "weekday", withOne("2026-10-15"))).toEqual([]);
  });

  it("fails a draft correction of ai.confidence on a finding a stored correction refiled with none, and passes one the stored correction refiled with a role", () => {
    const draft = (): DraftBrief => {
      const d = editionDraft("weekday");
      d.corrections.push(refile("phys-2026-0147", "ai.confidence", "claimed"));
      return d;
    };
    const at = `corrections[${draft().corrections.length - 1}].after`;
    const given = (date: string, after: string) => storedFor("weekday", [storedCorrection("C-0100", date, "phys-2026-0147", "ai.role", after)]);
    expect(whole(draft(), "weekday")).toEqual([]);
    const issues = whole(draft(), "weekday", given("2026-10-13", "none"));
    expect(tell(issues)).toEqual(["error AI_CONFIDENCE"]);
    expect(issues.map((i) => i.path)).toEqual([at]);
    expect(issues[0]!.message).toContain("filed with ai.role none, so its confidence is null");
    // A role filed by the stored correction leaves a confidence to set, and a refiling dated after the edition is not yet filed
    expect(whole(draft(), "weekday", given("2026-10-13", "ai_tool"))).toEqual([]);
    expect(whole(draft(), "weekday", given("2026-10-15", "none"))).toEqual([]);
  });

  it("fails an item a stored correction filed as a setback below Major, and passes it when the run holds no such correction", () => {
    const idx = editionDraft("weekday").items.indexOf(I.returning);
    const given = storedFor("weekday", [storedCorrection("C-0100", "2026-10-13", I.returning, "kind", "setback")]);
    const issues = whole(editionDraft("weekday"), "weekday", given);
    expect(tell(issues)).toEqual(["error SETBACK_MAJOR"]);
    expect(issues.map((i) => i.path)).toEqual([`items[${idx}]`]);
    expect(whole(editionDraft("weekday"), "weekday")).toEqual([]);
    expect(whole(editionDraft("weekday"), "weekday", storedFor("weekday"))).toEqual([]);
  });
});

// ── What the cases add ───────────────────────────────────────────────────────────────────────────

describe("what the ladder and AI cases add to a valid draft", () => {
  const all = [
    ...ladderAiCases.map((c) => ({ label: `F ${c.code}`, edition: c.edition ?? "weekday", draft: invalidDraft(c) })),
    ...ladderAiNamed.map((c) => ({ label: `T ${c.name}`, edition: c.edition, draft: mutated(c) })),
  ];

  it("is invented text and ids only: a new sentence marked SAMPLE or the valid draft's own prose with a few words changed, no link, nothing long", () => {
    let count = 0;
    for (const { label, edition, draft } of all) {
      const valid = editionDraft(edition);
      const pool = leaves(valid);
      for (const s of added(valid, draft)) {
        count += 1;
        expect(s.length, `${label}: ${s}`).toBeLessThanOrEqual(700);
        expect(s, label).not.toMatch(/https?:|www\./i);
        // A name (a system, a maker) is not free text; a longer string is a SAMPLE sentence or the valid draft's own prose changed in a few words
        if (words(s).length > 4 && !/SAMPLE/.test(s)) expect(mostShared(s, pool), `${label}: ${s}`).toBeGreaterThanOrEqual(0.7);
      }
    }
    expect(count).toBeGreaterThan(60);
  });

  it("adds no word that could help make or enhance a weapon, a pathogen or a toxin", () => {
    for (const { label, edition, draft } of all) {
      for (const s of added(editionDraft(edition), draft)) {
        expect(s, `${label}: ${s}`).not.toMatch(/pathogen|toxin|nerve agent|synthesi[sz]|enhanc|weapon|explosive|exploit/i);
      }
    }
  });

  it("holds no em-dash and no en-dash, in the cases' drafts or in the fixture source", () => {
    for (const { label, draft } of all) {
      const text = JSON.stringify(draft);
      expect(text.includes(EM), label).toBe(false);
      expect(text.includes(EN), label).toBe(false);
    }
    for (const file of ["fixtures/src/invalid/ladder-ai.ts", "tests/fixtures-ladder-ai.test.ts"]) {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(source.includes(EM), file).toBe(false);
      // An en-dash only between digits (a range)
      expect(source.replace(new RegExp(`(?<=\\d)${EN}(?=\\d)`, "g"), "").includes(EN), file).toBe(false);
    }
  });

  it("gives the same draft each time, and leaves each edition's valid draft as it was", () => {
    const before = EDITION_NAMES.map((e) => JSON.stringify(editionDraft(e)));
    for (const c of ladderAiCases) expect(JSON.stringify(invalidDraft(c)), c.code).toBe(JSON.stringify(invalidDraft(c)));
    for (const c of ladderAiNamed) expect(JSON.stringify(mutated(c)), c.name).toBe(JSON.stringify(mutated(c)));
    expect(EDITION_NAMES.map((e) => JSON.stringify(editionDraft(e)))).toEqual(before);
  });

  it("marks the reason of each correction a case pushes as SAMPLE, so no case reads as a real correction", () => {
    for (const { label, edition, draft } of all) {
      const valid = editionDraft(edition) as unknown as { corrections: { reason: string }[] };
      const now = draft as { corrections?: { reason: string }[] };
      for (const c of (now.corrections ?? []).slice(valid.corrections.length)) expect(c.reason, label).toMatch(/SAMPLE/);
    }
  });
});
