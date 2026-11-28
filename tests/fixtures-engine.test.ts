// The fixtures of the engine group (SPEC §4.12 "Fixtures and tests"; fixtures/src/invalid/engine.ts): SCHEMA, the one code of the rule
// table that the validator's engine reports and no rule group owns. It checks that the table's engine group is SCHEMA alone, listed
// for an F and a Z fixture and for no S or T case; that the group's F case is the one the table lists, filed as invalid--SCHEMA.json,
// made from the weekday draft by one change (the items written as one string), registered with the builder, written to
// fixtures/drafts/ byte for byte as the builder gives it, and fails the whole validator with exactly one error, SCHEMA, at `items`,
// with no warning and no rule run; that the schema itself refuses the changed draft and the draft with the change undone passes
// with no issue at all, so the change is the whole fault; and that the case adds nothing but ids to the draft and holds no dash of
// the wrong kind. It also checks the Chinese inputs of fixtures/src/zh-inputs.ts: `zhInputs()` hands `validateZh()` the sample
// world's stored records as stage 8 reads them, so the two ZH_HYPE named cases that put 突破 in a stored Major finding's text
// (a Sunday's deep dive, a Monday's remarkable note) fail as they should, and no other Chinese case changes by them.
// New for this project; Cyber's tests/validate.test.ts ran its F cases through its whole validator.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATORS, INVALID_CASES, allOutputs, invalidDraft, invalidOutputs, zhInvalidDraft, type InvalidCase,
} from "@/fixtures/src/build";
import { editionDraft } from "@/fixtures/src/drafts";
import { draftInputs } from "@/fixtures/src/inputs";
import * as engineModule from "@/fixtures/src/invalid/engine";
import { engineCases } from "@/fixtures/src/invalid/engine";
import { zhCases, zhNamed } from "@/fixtures/src/invalid/zh";
import { EDITIONS, EDITION_NAMES, REPO_ROOT, storedFindingsBefore, storedGlossary, type EditionName } from "@/fixtures/src/world";
import { zhInputs } from "@/fixtures/src/zh-inputs";
import { RULE_CODE_TABLE } from "@/lib/rules";
import { DraftBrief } from "@/lib/schema/draft";
import type { Finding } from "@/lib/schema/finding";
import type { Term } from "@/lib/schema/glossary";
import { validateDraft, validateZh } from "@/lib/validate";
import type { ValidationIssue } from "@/lib/rules/types";

type Json = Record<string, unknown>;

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

const tell = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.code}`);
const codesOf = (issues: readonly ValidationIssue[], severity: string): string[] =>
  [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();

/** The whole validator on a weekday draft with the weekday's inputs. */
const whole = (draft: unknown): ValidationIssue[] => validateDraft(draft, draftInputs("weekday")).issues;

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

const THE_CASE: InvalidCase = engineCases[0]!;

// ── The table ────────────────────────────────────────────────────────────────────────────────────

describe("the engine group in the rule table", () => {
  it("is SCHEMA alone, a hard code listed for an F and a Z fixture and for no S or T case", () => {
    const rows = RULE_CODE_TABLE.filter((r) => r.group === "engine");
    expect(rows.map((r) => ({ code: r.code, severity: r.severity, tests: [...r.tests] }))).toEqual([{ code: "SCHEMA", severity: "H", tests: ["F", "Z"] }]);
  });

  it("has a file that exports its F list and nothing else, since the table lists no S or T case for the group", () => {
    expect(Object.keys(engineModule)).toEqual(["engineCases"]);
  });
});

// ── The F case ───────────────────────────────────────────────────────────────────────────────────

describe("the engine group's F case", () => {
  it("is one case for the one code that the table lists an F fixture for in the group, filed as invalid--SCHEMA.json, made from the weekday draft", () => {
    const listed = RULE_CODE_TABLE.filter((r) => r.group === "engine" && r.tests.includes("F")).map((r) => r.code);
    expect(listed).toEqual(["SCHEMA"]);
    expect(engineCases.map((c) => c.code)).toEqual(listed);
    expect(engineCases).toHaveLength(1);
    expect(THE_CASE.file).toBe("invalid--SCHEMA.json");
    expect(THE_CASE.edition ?? "weekday").toBe("weekday");
  });

  it("is registered with the builder: INVALID_CASES holds it once, and the files the builder writes include its file", () => {
    expect(INVALID_CASES.filter((c) => c.code === "SCHEMA")).toEqual([THE_CASE]);
    expect(INVALID_CASES.find((c) => c.code === "SCHEMA")).toBe(THE_CASE);
    expect(GENERATORS).toContain(invalidOutputs);
    expect(invalidOutputs([THE_CASE]).map((o) => o.path)).toEqual(["fixtures/drafts/invalid--SCHEMA.json"]);
    expect(allOutputs().map((o) => o.path)).toContain("fixtures/drafts/invalid--SCHEMA.json");
  });

  it("completes the English F fixtures: the cases of every group are exactly the codes that the table lists an F fixture for", () => {
    const listed = RULE_CODE_TABLE.filter((r) => r.tests.includes("F")).map((r) => r.code).sort();
    expect(listed).toContain("SCHEMA");
    expect(INVALID_CASES.map((c) => c.code).sort()).toEqual(listed);
  });

  it("fails validateDraft() with exactly one error, SCHEMA at `items`, no warning, and no rule run (the parsed draft is null)", () => {
    const draft = invalidDraft(THE_CASE);
    const result = validateDraft(draft, draftInputs("weekday"));
    expect(tell(result.issues)).toEqual(["error SCHEMA"]);
    expect(result.issues.map((i) => i.path)).toEqual(["items"]);
    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.draft).toBeNull();
  });

  it("changes one part of the weekday draft: the items, written as the one string that joins them", () => {
    const valid = editionDraft("weekday");
    const draft = invalidDraft(THE_CASE) as Json;
    expect(touched(valid, draft)).toEqual(["items"]);
    expect(Object.keys(draft)).toEqual(Object.keys(valid));
    expect(valid.items.length).toBeGreaterThan(1);
    expect(draft.items).toBe(valid.items.join(", "));
  });

  it("is a fault of the schema itself, and the draft with that one change undone passes with no issue at all", () => {
    const draft = invalidDraft(THE_CASE) as Json;
    expect(DraftBrief.safeParse(draft).success).toBe(false);
    expect(DraftBrief.safeParse(editionDraft("weekday")).success).toBe(true);
    expect(whole({ ...draft, items: editionDraft("weekday").items })).toEqual([]);
    expect(whole(editionDraft("weekday"))).toEqual([]);
  });

  it("is not made by a mutation that the schema accepts: a list of one id is the valid shape, so it would not fail", () => {
    const valid = editionDraft("weekday");
    expect(DraftBrief.safeParse({ ...valid, items: [valid.items[0]] }).success).toBe(true);
    expect(DraftBrief.safeParse({ ...valid, items: valid.items.join(", ") }).success).toBe(false);
  });

  it("has its file in fixtures/drafts/ as the builder's output, and that file fails the same way", () => {
    const { path, text } = invalidOutputs([THE_CASE])[0]!;
    expect(path).toBe("fixtures/drafts/invalid--SCHEMA.json");
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    const issues = whole(JSON.parse(text));
    expect(tell(issues)).toEqual(["error SCHEMA"]);
    expect(issues.map((i) => i.path)).toEqual(["items"]);
  });

  it("gives the same draft each time, and leaves the valid weekday draft as it was", () => {
    const before = JSON.stringify(editionDraft("weekday"));
    expect(JSON.stringify(invalidDraft(THE_CASE))).toBe(JSON.stringify(invalidDraft(THE_CASE)));
    expect(JSON.stringify(editionDraft("weekday"))).toBe(before);
  });
});

describe("what the engine case adds to the valid weekday draft", () => {
  it("is ids only: one string made of the weekday's own items, no free text and no link", () => {
    const valid = editionDraft("weekday");
    const had = new Set(leaves(valid));
    const added = [...new Set(leaves(invalidDraft(THE_CASE)))].filter((s) => !had.has(s));
    expect(added).toEqual([valid.items.join(", ")]);
    for (const s of added) {
      expect(s).not.toMatch(/https?:|www\./i);
      for (const id of s.split(", ")) expect(valid.items, id).toContain(id);
    }
  });

  it("holds no em-dash and no en-dash, in the draft or in the fixture source", () => {
    const text = JSON.stringify(invalidDraft(THE_CASE));
    expect(text.includes(EM)).toBe(false);
    expect(text.includes(EN)).toBe(false);
    const source = readFileSync(join(REPO_ROOT, "fixtures/src/invalid/engine.ts"), "utf8");
    expect(source.includes(EM)).toBe(false);
    // An en-dash only between digits (a range)
    expect(source.replace(new RegExp(`(?<=\\d)${EN}(?=\\d)`, "g"), "").includes(EN)).toBe(false);
  });
});

// ── The Chinese inputs ───────────────────────────────────────────────────────────────────────────

describe("the Chinese inputs of the fixtures (zhInputs)", () => {
  const SUNDAY_DIVE = "ZH_HYPE: 突破 in a Sunday's deep dive on a Major finding";
  const MONDAY_NOTE = "ZH_HYPE: 突破 in a Monday's remarkable note on a Major finding";

  /** The result of `validateZh()` on a draft: the error codes and the warning codes, each once and sorted. */
  const run = (draft: unknown, edition: EditionName, records: boolean) => {
    const i = zhInputs(edition);
    const issues = validateZh(draft, i.english, records ? i : { ...i, stored: null }, { fileDate: i.fileDate }).issues;
    return { errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") };
  };

  it.each(EDITION_NAMES.map((name) => [name] as const))("%s: holds every finding stored before the edition's date and the glossary's terms, and no correction", (name) => {
    const date = EDITIONS[name].date;
    const { stored } = zhInputs(name);
    expect(stored.findings.length).toBeGreaterThan(5);
    expect(stored.terms.length).toBeGreaterThan(0);
    expect(stored.findings).toEqual(storedFindingsBefore(date));
    expect(stored.terms).toEqual(storedGlossary(date).terms);
    expect(stored.corrections).toEqual([]);
    expect(Object.keys(stored).sort()).toEqual(["corrections", "findings", "terms"]);
  });

  it("holds the Major finding that the Sunday's deep dive and the Monday's remarkable note are about, as the Chinese views read it", () => {
    for (const name of ["sunday", "monday"] as const) {
      const id = name === "sunday" ? zhInputs(name).english.deep_dive!.finding_id : zhInputs(name).english.review!.remarkable!.finding_id;
      expect(zhInputs(name).stored.findings.find((f) => f.id === id)?.significance, `${name} ${id}`).toBe("major");
    }
  });

  it("hands each caller fresh copies of the records, so a change never reaches the next call", () => {
    const a = zhInputs("weekday");
    (a.stored.findings as Finding[]).length = 0;
    (a.stored.terms as Term[]).length = 0;
    const b = zhInputs("weekday");
    expect(b.stored.findings.length).toBeGreaterThan(5);
    expect(b.stored.terms.length).toBeGreaterThan(0);
  });

  it("hands each caller fresh copies of each record too, so a change to a finding or a term never reaches the next call", () => {
    const before = JSON.stringify(zhInputs("sunday").stored);
    const a = zhInputs("sunday");
    (a.stored.findings[0] as unknown as { id: string }).id = "changed-0000";
    (a.stored.terms[0] as unknown as { id: string }).id = "changed";
    expect(JSON.stringify(a.stored)).not.toBe(before);
    expect(JSON.stringify(zhInputs("sunday").stored)).toBe(before);
  });

  it("is read without being changed: a run on deep-frozen inputs gives the same result for each case that the records decide", () => {
    const freeze = (v: unknown): unknown => {
      if (typeof v === "object" && v !== null && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) freeze((v as Json)[k]); }
      return v;
    };
    for (const name of [SUNDAY_DIVE, MONDAY_NOTE]) {
      const c = zhNamed.find((x) => x.name === name)!;
      const draft = zhInvalidDraft({ code: "X", file: "x", edition: c.edition, mutate: c.mutate });
      const i = zhInputs(c.edition);
      const kept = JSON.stringify({ stored: i.stored, context: i.context, evidence: i.evidence, english: i.english });
      freeze(draft); freeze(i.stored); freeze(i.context); freeze(i.evidence); freeze(i.english);
      const issues = validateZh(draft, i.english, i, { fileDate: i.fileDate }).issues;
      expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }, name).toEqual({ errors: ["ZH_HYPE"], warnings: [] });
      expect(JSON.stringify({ stored: i.stored, context: i.context, evidence: i.evidence, english: i.english }), name).toBe(kept);
    }
  });

  it("makes the two ZH_HYPE named cases about a Major finding fail with ZH_HYPE alone, and gives them no error without the records", () => {
    for (const name of [SUNDAY_DIVE, MONDAY_NOTE]) {
      const c = zhNamed.find((x) => x.name === name)!;
      expect(c, name).toBeDefined();
      expect([...c.expect.errors], name).toEqual(["ZH_HYPE"]);
      const draft = zhInvalidDraft({ code: "X", file: "x", edition: c.edition, mutate: c.mutate });
      expect(run(draft, c.edition, true), name).toEqual({ errors: ["ZH_HYPE"], warnings: [] });
      expect(run(draft, c.edition, false), name).toEqual({ errors: [], warnings: [] });
    }
  });

  it("gives every Chinese case the result it states, and the records change the result of those two cases and of no other", () => {
    let changed = 0;
    for (const c of zhCases) {
      const draft = zhInvalidDraft(c);
      const edition = c.edition ?? "weekday";
      expect(run(draft, edition, true), `F ${c.code}`).toEqual({ errors: [c.code], warnings: [] });
      expect(run(draft, edition, false), `F ${c.code} without records`).toEqual({ errors: [c.code], warnings: [] });
    }
    for (const c of zhNamed) {
      const draft = zhInvalidDraft({ code: "X", file: "x", edition: c.edition, mutate: c.mutate });
      const stated = { errors: [...c.expect.errors], warnings: [...c.expect.warnings] };
      expect(run(draft, c.edition, true), c.name).toEqual(stated);
      if (JSON.stringify(run(draft, c.edition, false)) !== JSON.stringify(stated)) {
        changed += 1;
        expect([SUNDAY_DIVE, MONDAY_NOTE], c.name).toContain(c.name);
      }
    }
    expect(changed).toBe(2);
  });
});
