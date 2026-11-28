// The fixtures of the structure group (SPEC §4.12 "Fixtures and tests"; fixtures/src/invalid/structure.ts): DATE_MISMATCH, REF_UNKNOWN,
// FORMAT_SECTIONS, WEEK_AGAINST, COUNTS, FIELD_CAP, STORY_PICK and SOURCE_IDS. It checks that the F cases are the ones the rule table
// lists, each filed as invalid--CODE.json, fail the whole validator with exactly their code at the part they are about, change a few
// parts of the weekday draft and match the files in fixtures/drafts/ byte for byte; that the S list is empty because every code of
// the group is hard; that each T case gives its exact set of error and warning codes with its edition's own inputs, from the whole
// validator and from the group's rules alone, and covers the cases the spec names (a Sunday's null deep dive, one on no candidate and
// one with a `why_today` its candidate lacks; a Monday's null `remarkable` in the full week and a set one in the empty week;
// WEEK_AGAINST's `NONE_FOUND` and a `finding_ids` without the setback in the full week); that each REF_UNKNOWN case gives its one
// fault at the part it is about; that each boundary a case names has a passing neighbour, so the case fails for that boundary and no
// other; that the four valid editions pass; and that the cases add nothing but
// invented, SAMPLE-marked text and ids, with no link and no dash of the wrong kind. Published-mode cases (a stored brief judged against
// its own review) work on a copy of the sample content and are not here. New for this project; Cyber's tests/validate.test.ts ran its
// F cases through its whole validator.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITION_NAMES, REPO_ROOT, type EditionName } from "@/fixtures/src/world";
import { invalidDraft, invalidOutputs } from "@/fixtures/src/build";
import { editionDraft, newFindingOf, WEEKDAY_ITEMS } from "@/fixtures/src/drafts";
import { draftInputs } from "@/fixtures/src/inputs";
import { returned, returnedOnMonday, structureCases, structureNamed, structureSoft } from "@/fixtures/src/invalid/structure";
import { RULE_CODE_TABLE, codesOfGroup } from "@/lib/rules";
import { buildDraftInput, runRules } from "@/lib/rules/run";
import { structureRules } from "@/lib/rules/structure";
import type { ValidationIssue } from "@/lib/rules/types";
import { DraftBrief } from "@/lib/schema/draft";
import { validateDraft } from "@/lib/validate";
import { NONE_FOUND } from "@/lib/vocab";

type Json = Record<string, unknown>;

const MINE = codesOfGroup("structure");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const I = WEEKDAY_ITEMS;

/**
 * Where each F case fails: the one issue path pattern its code is reported at. REF_UNKNOWN's case puts an unknown id in the last
 * item, the returning finding's place, so its returning entry is left with no finding to show: the second place it is reported.
 */
const WHERE: Readonly<Record<string, RegExp>> = {
  DATE_MISMATCH: /^date$/,
  REF_UNKNOWN: /^(items\[\d+\]|returning\[0\]\.finding_id)$/,
  FORMAT_SECTIONS: /^story$/,
  COUNTS: /^ideas$/,
  FIELD_CAP: /^items\[\d+\]$/,
  STORY_PICK: /^items\[\d+\]$/,
  SOURCE_IDS: /^also\[\d+\]\.source_id$/,
};

/** The top-level parts of the draft that each F case changes, and no others: a small change, obviously about one rule. */
const TOUCHES: Readonly<Record<string, readonly string[]>> = {
  DATE_MISMATCH: ["date"],
  REF_UNKNOWN: ["items"],
  FORMAT_SECTIONS: ["lead", "new_findings", "story"],
  COUNTS: ["ideas"],
  FIELD_CAP: ["new_findings"],
  STORY_PICK: ["new_findings"],
  SOURCE_IDS: ["also"],
};

/**
 * The part each REF_UNKNOWN T case is about: the path of its one issue. The rest of the case's draft passes, so a second issue
 * would mean that the case shows two faults.
 */
const REF_AT: Readonly<Record<string, string>> = {
  "REF_UNKNOWN: a new finding that neither the story nor the items name": "new_findings[3].ref",
  "REF_UNKNOWN: a new finding named twice (a second item names new-2)": "items[3]",
  "REF_UNKNOWN: an item new-9 that the draft's new_findings do not define": "items[3]",
  "REF_UNKNOWN: a Lead sentence that cites a finding id the context lists nowhere": "lead[2].refs[1]",
  "REF_UNKNOWN: a returning entry for a finding id the context lists nowhere": "returning[0].finding_id",
  "REF_UNKNOWN: a rung change for a finding id the context lists nowhere": "rung_changes[0].finding_id",
  "REF_UNKNOWN: a correction of a finding id the context lists nowhere": "corrections[2].finding_id",
  "REF_UNKNOWN: a new finding's related finding that the context lists nowhere": "new_findings[1].related[0]",
  "REF_UNKNOWN: a finding id that the context lists nowhere among the strongest evidence against (a Monday)": "review.strongest_against.finding_ids[2]",
  "REF_UNKNOWN: a returning entry for an existing finding that neither the story nor the items show": "returning[0].finding_id",
  "REF_UNKNOWN: a returning entry for an existing finding that a Sunday's story and items do not show": "returning[0].finding_id",
  "REF_UNKNOWN: two returning entries for one finding": "returning[1].finding_id",
  "REF_UNKNOWN: a rung change for a finding that the items show (its place is the returning entry's rung)": "rung_changes[0].finding_id",
  "REF_UNKNOWN: an existing finding in the items with no returning entry": "items[3]",
  "REF_UNKNOWN: an existing finding in a Sunday's items with no returning entry": "items[1]",
  "REF_UNKNOWN: an existing finding in a Monday's items with no returning entry": "items[1]",
  "REF_UNKNOWN: an existing finding in a short Monday's items with no returning entry": "items[0]",
  "REF_UNKNOWN: an existing finding named twice in the items": "items[3]",
};

/**
 * The most top-level parts a T case may change: the STORY_PICK case takes the scroll out (its Lead line, its new finding and the
 * story), puts a stored finding in its place with the returning entry that it needs, and refiles it by a correction.
 */
const T_TOUCHES_MAX = 5;

type Mutating = { edition?: EditionName; mutate: (draft: DraftBrief) => unknown };

/** A case's draft: a fresh copy of its edition's valid draft, mutated (as the builder's `invalidDraft()` does for an F case). */
const mutated = (c: Mutating): unknown => {
  const draft = editionDraft(c.edition ?? "weekday");
  const out = c.mutate(draft);
  return out === undefined ? draft : out;
};

/** The group's own rules on a draft with its edition's inputs, and the whole validator on it. */
const own = (draft: unknown, edition: EditionName): ValidationIssue[] =>
  runRules(buildDraftInput(DraftBrief.parse(draft), draftInputs(edition)), structureRules);
const whole = (draft: unknown, edition: EditionName): ValidationIssue[] => validateDraft(draft, draftInputs(edition)).issues;
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

// ── The F cases ──────────────────────────────────────────────────────────────────────────────────

describe("the structure group's F cases", () => {
  it("has one F case for each code that the rule table lists an F fixture for, in the table's order, each filed as invalid--CODE.json", () => {
    const listed = RULE_CODE_TABLE.filter((r) => r.group === "structure" && r.tests.includes("F")).map((r) => r.code);
    expect(listed).toEqual(["DATE_MISMATCH", "REF_UNKNOWN", "FORMAT_SECTIONS", "COUNTS", "FIELD_CAP", "STORY_PICK", "SOURCE_IDS"]);
    expect(structureCases.map((c) => c.code)).toEqual(listed);
    for (const c of structureCases) expect(c.file, c.code).toBe(`invalid--${c.code}.json`);
    expect(new Set(structureCases.map((c) => c.file)).size).toBe(structureCases.length);
  });

  it("makes each case from the weekday draft, the draft the spec says an F case mutates", () => {
    for (const c of structureCases) expect(c.edition ?? "weekday", c.code).toBe("weekday");
  });

  it.each(structureCases.map((c) => [c.code, c] as const))(
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
      expect(touched(editionDraft("weekday"), draft), code).toEqual(TOUCHES[code]);
    },
  );

  it.each(structureCases.map((c) => [c.code, c] as const))("F %s: its file in fixtures/drafts/ is the builder's output and fails the same way", (code, c) => {
    const { path, text } = invalidOutputs([c])[0]!;
    expect(path).toBe(`fixtures/drafts/invalid--${code}.json`);
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    expect([...new Set(tell(whole(JSON.parse(text), "weekday")))]).toEqual([`error ${code}`]);
  });

  it("F REF_UNKNOWN: reports the unknown item and then the returning entry that its place leaves with no finding to show", () => {
    const c = structureCases.find((x) => x.code === "REF_UNKNOWN")!;
    expect(whole(invalidDraft(c), "weekday").map((i) => i.path)).toEqual(["items[3]", "returning[0].finding_id"]);
  });
});

describe("the structure group's S list", () => {
  it("is empty, because every code of the group is hard and the table lists no S fixture for any", () => {
    expect(structureSoft).toEqual([]);
    expect(MINE).toEqual(["DATE_MISMATCH", "REF_UNKNOWN", "FORMAT_SECTIONS", "WEEK_AGAINST", "COUNTS", "FIELD_CAP", "STORY_PICK", "SOURCE_IDS"]);
    for (const code of MINE) {
      const info = RULE_CODE_TABLE.find((r) => r.code === code)!;
      expect(info.severity, code).toBe("H");
      expect(info.tests, code).not.toContain("S");
    }
  });

  it("gives the group's rules no warning on any case, so no code of the group is a soft gate", () => {
    for (const c of structureNamed) expect(codesOf(own(mutated(c), c.edition), "warning"), c.name).toEqual([]);
  });
});

// ── The T cases ──────────────────────────────────────────────────────────────────────────────────

describe("the structure group's T cases", () => {
  it("has named cases with unique names, each starting with the code it is about, which one of its errors is", () => {
    expect(new Set(structureNamed.map((c) => c.name)).size).toBe(structureNamed.length);
    for (const c of structureNamed) {
      expect(c.name.startsWith(`${c.code}: `), c.name).toBe(true);
      expect(MINE, c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toEqual([...c.expect.errors].sort());
      expect([...c.expect.warnings], c.name).toEqual([...c.expect.warnings].sort());
      expect(EDITION_NAMES, c.name).toContain(c.edition);
    }
  });

  it("covers each code of the group in an F or a T case, each kind of case the table lists, and every edition", () => {
    for (const code of MINE) {
      expect(structureCases.some((c) => c.code === code) || structureNamed.some((c) => c.code === code), code).toBe(true);
    }
    for (const row of RULE_CODE_TABLE.filter((r) => r.group === "structure")) {
      if (row.tests.includes("F")) expect(structureCases.some((c) => c.code === row.code), `F ${row.code}`).toBe(true);
      if (row.tests.includes("T")) expect(structureNamed.some((c) => c.code === row.code), `T ${row.code}`).toBe(true);
    }
    for (const edition of EDITION_NAMES) expect(structureNamed.some((c) => c.edition === edition), edition).toBe(true);
  });

  it.each(structureNamed.map((c) => [c.name, c] as const))("T %s", (_name, c) => {
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

  it("gives each REF_UNKNOWN case one issue, at the part the case is about", () => {
    const cases = structureNamed.filter((c) => c.code === "REF_UNKNOWN");
    expect(cases.map((c) => c.name).sort()).toEqual(Object.keys(REF_AT).sort());
    for (const c of cases) {
      const found = whole(mutated(c), c.edition).filter((i) => i.code === "REF_UNKNOWN");
      expect(found.map((i) => i.path), c.name).toEqual([REF_AT[c.name]]);
    }
  });
});

describe("the cases the spec names", () => {
  const sunday = draftInputs("sunday").context;
  const monday = draftInputs("monday").context;
  const short = draftInputs("monday-short").context;
  /** The drafts of the cases about one code on one edition. */
  const drafts = (code: string, edition: EditionName): DraftBrief[] =>
    structureNamed.filter((c) => c.code === code && c.edition === edition).map((c) => DraftBrief.parse(mutated(c)));

  it("has a Sunday case for a null deep dive in a ledger that has candidates, one on no candidate and one with a why_today its candidate lacks", () => {
    expect(sunday.ledger_for_sunday.length).toBeGreaterThan(0);
    const dives = drafts("FORMAT_SECTIONS", "sunday");
    const ids = sunday.ledger_for_sunday.map((c) => c.id);
    expect(dives.some((d) => d.deep_dive === null)).toBe(true);
    expect(dives.some((d) => d.deep_dive !== null && !ids.includes(d.deep_dive.finding_id))).toBe(true);
    expect(dives.some((d) => {
      const candidate = sunday.ledger_for_sunday.find((c) => c.id === d.deep_dive?.finding_id);
      return candidate !== undefined && !candidate.reasons.includes(d.deep_dive!.why_today);
    })).toBe(true);
  });

  it("has a Monday case for a null remarkable finding in a week that has findings, and one for a set one in the empty week", () => {
    expect(monday.week!.findings.length).toBeGreaterThanOrEqual(3);
    expect(short.week!.findings).toEqual([]);
    expect(drafts("FORMAT_SECTIONS", "monday").some((d) => d.review !== null && d.review.remarkable === null)).toBe(true);
    expect(drafts("FORMAT_SECTIONS", "monday-short").some((d) => d.review !== null && d.review.remarkable !== null)).toBe(true);
  });

  it("has WEEK_AGAINST cases for NONE_FOUND and for finding_ids without the setback, in a week that has a setback and a fall", () => {
    const week = monday.week!;
    expect(week.setbacks.length).toBeGreaterThan(0);
    expect(week.rung_changes.some((r) => r.to === "retracted" || r.to === "disputed")).toBe(true);
    const against = drafts("WEEK_AGAINST", "monday").map((d) => d.review!.strongest_against);
    expect(against.some((a) => a.text === NONE_FOUND.en)).toBe(true);
    expect(against.some((a) => a.text !== NONE_FOUND.en && week.setbacks.some((id) => !a.finding_ids.includes(id)))).toBe(true);
  });
});

// ── The boundary of each case ────────────────────────────────────────────────────────────────────

describe("the boundary of each case", () => {
  /** A draft that undoes a case's fault by the smallest change its own words name, and passes with no error and no warning. */
  const NEIGHBOURS: readonly { of: string; name: string; edition: EditionName; mutate: (d: DraftBrief) => void }[] = [
    {
      of: "DATE_MISMATCH: generated_at one second after the deadline (03:49:00)", name: "generated_at at the deadline, 03:49:00", edition: "weekday",
      mutate: (d) => { d.generated_at = "2026-10-14T03:49:00+08:00"; },
    },
    {
      of: "DATE_MISMATCH: generated_at one second after the deadline (03:49:00)", name: "generated_at at the deadline, written in UTC", edition: "weekday",
      mutate: (d) => { d.generated_at = "2026-10-13T19:49:00Z"; },
    },
    {
      of: "DATE_MISMATCH: generated_at one second before the window's end (03:15:00)", name: "generated_at at the window's end, 03:15:00", edition: "weekday",
      mutate: (d) => { d.generated_at = "2026-10-14T03:15:00+08:00"; },
    },
    {
      of: "DATE_MISMATCH: generated_at one second before the window's end (03:15:00)", name: "generated_at at the window's end, in another offset", edition: "weekday",
      mutate: (d) => { d.generated_at = "2026-10-13T20:15:00+01:00"; },
    },
    {
      of: "REF_UNKNOWN: a new finding's related finding that the context lists nowhere", name: "a related finding that the context lists", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.result).related = ["math-2026-0140"]; },
    },
    {
      of: "REF_UNKNOWN: a finding id that the context lists nowhere among the strongest evidence against (a Monday)", name: "a further finding id that the context lists", edition: "monday",
      mutate: (d) => { d.review!.strongest_against.finding_ids = [...d.review!.strongest_against.finding_ids, "math-2026-0140"]; },
    },
    {
      of: "REF_UNKNOWN: a returning entry for an existing finding that neither the story nor the items show", name: "the entry deleted with the finding's place", edition: "weekday",
      mutate: (d) => { d.items = d.items.filter((k) => k !== I.returning); d.returning = []; },
    },
    {
      of: "REF_UNKNOWN: a returning entry for an existing finding that a Sunday's story and items do not show", name: "the finding in the items beside its entry", edition: "sunday",
      mutate: (d) => { d.items = [...d.items, "soc-2026-0145"]; returned(d, "soc-2026-0145", "b4"); },
    },
    {
      of: "REF_UNKNOWN: two returning entries for one finding", name: "one returning entry for the finding (the valid draft)", edition: "weekday",
      mutate: () => {},
    },
    {
      of: "REF_UNKNOWN: a rung change for a finding that the items show (its place is the returning entry's rung)", name: "the rung change moved into the returning entry's rung", edition: "weekday",
      mutate: (d) => {
        d.items = d.items.map((k) => (k === I.returning ? I.rungChange : k));
        const entry = d.returning[0]!;
        entry.finding_id = I.rungChange;
        entry.rung = d.rung_changes[0]!.rung;
        d.rung_changes = [];
      },
    },
    {
      of: "REF_UNKNOWN: an existing finding in the items with no returning entry", name: "the returning entry given (the valid draft)", edition: "weekday",
      mutate: () => {},
    },
    {
      of: "REF_UNKNOWN: an existing finding in the items with no returning entry", name: "the finding taken out of the items, with no entry", edition: "weekday",
      mutate: (d) => { d.items = d.items.filter((k) => k !== I.returning); d.returning = []; },
    },
    {
      of: "REF_UNKNOWN: an existing finding in a Sunday's items with no returning entry", name: "the returning entry given", edition: "sunday",
      mutate: (d) => { d.items = [...d.items, "soc-2026-0145"]; returned(d, "soc-2026-0145", "b4"); },
    },
    {
      of: "REF_UNKNOWN: an existing finding in a Monday's items with no returning entry", name: "the returning entry given", edition: "monday",
      mutate: (d) => { d.items = [...d.items, "soc-2026-0145"]; returnedOnMonday(d, "soc-2026-0145"); },
    },
    {
      of: "REF_UNKNOWN: an existing finding in a short Monday's items with no returning entry", name: "no existing finding in the items (the valid draft)", edition: "monday-short",
      mutate: () => {},
    },
    {
      of: "REF_UNKNOWN: an existing finding named twice in the items", name: "the finding named once", edition: "weekday",
      mutate: (d) => {
        d.new_findings = d.new_findings.filter((f) => f.ref !== I.claimed);
        d.items = d.items.filter((k) => k !== I.claimed);
      },
    },
    {
      of: "FORMAT_SECTIONS: a Sunday deep dive whose why_today (anniversary) its candidate lacks (news and rotation)", name: "a why_today the candidate has (rotation)", edition: "sunday",
      mutate: (d) => { d.deep_dive!.why_today = "rotation"; },
    },
    {
      of: "FORMAT_SECTIONS: a Sunday story that is Major in its record and filed Notable by the draft's own correction", name: "the same Major story, unrefiled", edition: "sunday",
      mutate: (d) => { d.story = "earth-2026-0141"; returned(d, "earth-2026-0141", "b4"); },
    },
    {
      of: "FORMAT_SECTIONS: three findings on a Sunday (at most 2)", name: "two findings on a Sunday", edition: "sunday",
      mutate: (d) => { d.items = [...d.items, "soc-2026-0145"]; returned(d, "soc-2026-0145", "b4"); },
    },
    {
      of: "FORMAT_SECTIONS: three findings on a Monday (at most 2)", name: "two findings on a Monday", edition: "monday",
      mutate: (d) => { d.items = [...d.items, "soc-2026-0145"]; returnedOnMonday(d, "soc-2026-0145"); },
    },
    {
      of: "FORMAT_SECTIONS: a Monday remarkable finding from before the week (math-2026-0131)", name: "a remarkable finding from the week", edition: "monday",
      mutate: (d) => { d.review!.remarkable!.finding_id = "math-2026-0140"; },
    },
    {
      of: "WEEK_AGAINST: finding_ids without the setback (soc-2026-0144)", name: "finding_ids with both and one finding more", edition: "monday",
      mutate: (d) => { d.review!.strongest_against.finding_ids = [...d.review!.strongest_against.finding_ids, "math-2026-0140"]; },
    },
    {
      of: "COUNTS: six related findings on a new finding (at most 5)", name: "five related findings", edition: "weekday",
      mutate: (d) => { newFindingOf(d, I.claimed).related = ["math-2026-0140", "math-2026-0131", "phys-2026-0134", "earth-2026-0141", "chem-2026-0142"]; },
    },
    {
      of: "COUNTS: five reactions on a new finding (at most 4)", name: "four reactions", edition: "weekday",
      mutate: (d) => {
        const f = newFindingOf(d, I.story);
        f.reactions = [...f.reactions, ...structuredClone(f.reactions)].slice(0, 4);
      },
    },
    {
      of: "COUNTS: six Also noted lines (at most 5)", name: "five Also noted lines", edition: "weekday",
      mutate: (d) => {
        const titles = ["SAMPLE: A third line about a model that reads old maps", "SAMPLE: A fourth line about a tool that sorts fossils", "SAMPLE: A fifth line about a model of ocean tides"];
        titles.forEach((title, i) => d.also.push({ title, field: "earth", source_id: i % 2 === 0 ? "b5" : "b6" }));
      },
    },
    {
      of: "COUNTS: six findings in the story and items (findings_max is 5)", name: "five findings in the story and items (the valid draft)", edition: "weekday",
      mutate: () => {},
    },
    {
      of: "STORY_PICK: a stored Major story that the draft's own correction files as Notable, beside two Major items", name: "the same Major story, unrefiled", edition: "weekday",
      mutate: (d) => {
        d.new_findings = d.new_findings.filter((f) => f.ref !== I.story);
        d.lead = d.lead.filter((l) => !l.refs.includes(I.story));
        d.story = I.weather;
        returned(d, I.weather, "b1");
      },
    },
  ];

  it("names, for each neighbour, a case that exists", () => {
    const names = new Set(structureNamed.map((c) => c.name));
    for (const n of NEIGHBOURS) expect(names.has(n.of), n.of).toBe(true);
  });

  it.each(NEIGHBOURS.map((n) => [`${n.name} (beside ${n.of})`, n] as const))("passes with no issue at all: %s", (_label, n) => {
    const draft = editionDraft(n.edition);
    n.mutate(draft);
    expect(whole(draft, n.edition)).toEqual([]);
    expect(own(draft, n.edition)).toEqual([]);
  });

  it.each(EDITION_NAMES.map((e) => [e] as const))("the valid %s draft passes the group's rules and every rule", (edition) => {
    const draft = editionDraft(edition);
    expect(own(draft, edition)).toEqual([]);
    expect(whole(draft, edition)).toEqual([]);
  });
});

// ── What the cases add ───────────────────────────────────────────────────────────────────────────

describe("what the structure cases add to a valid draft", () => {
  const all = [
    ...structureCases.map((c) => ({ label: `F ${c.code}`, edition: c.edition ?? "weekday", draft: invalidDraft(c) })),
    ...structureNamed.map((c) => ({ label: `T ${c.name}`, edition: c.edition, draft: mutated(c) })),
  ];

  it("is invented text and ids only: free text marked SAMPLE (or the NONE_FOUND sentence), no link, nothing long", () => {
    let count = 0;
    for (const { label, edition, draft } of all) {
      for (const s of added(editionDraft(edition), draft)) {
        count += 1;
        expect(s.length, `${label}: ${s}`).toBeLessThanOrEqual(160);
        expect(s, label).not.toMatch(/https?:|www\./i);
        if (/\s/.test(s)) expect(s === NONE_FOUND.en || /SAMPLE/.test(s), `${label}: ${s}`).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(40);
  });

  it("holds no em-dash and no en-dash, in the cases' drafts or in the fixture source", () => {
    for (const { label, draft } of all) {
      const text = JSON.stringify(draft);
      expect(text.includes(EM), label).toBe(false);
      expect(text.includes(EN), label).toBe(false);
    }
    const source = readFileSync(join(REPO_ROOT, "fixtures/src/invalid/structure.ts"), "utf8");
    expect(source.includes(EM)).toBe(false);
    // An en-dash only between digits (a range)
    expect(source.replace(new RegExp(`(?<=\\d)${EN}(?=\\d)`, "g"), "").includes(EN)).toBe(false);
  });

  it("gives the same draft each time, and leaves each edition's valid draft as it was", () => {
    const before = EDITION_NAMES.map((e) => JSON.stringify(editionDraft(e)));
    for (const c of structureCases) expect(JSON.stringify(invalidDraft(c)), c.code).toBe(JSON.stringify(invalidDraft(c)));
    for (const c of structureNamed) expect(JSON.stringify(mutated(c)), c.name).toBe(JSON.stringify(mutated(c)));
    expect(EDITION_NAMES.map((e) => JSON.stringify(editionDraft(e)))).toEqual(before);
  });
});
