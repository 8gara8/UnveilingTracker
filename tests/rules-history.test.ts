// The history rules (SPEC §4.12; lib/rules/history.ts): SUBFIELD_UNKNOWN, DUPLICATE, RETURN_NEW_FACT, REPORT_DECISION and REPORT_UPHELD.
//
// Every test says which mode it runs in, as the rule table and "Stored records" give them: DRAFT (the agent's English draft with the run's
// context, its pack and, where a test gives them, the stored records), PUBLISHED on the records being published (a finding first briefed on
// the publishing date, a correction dated on it) and PUBLISHED on every other record (a stored record that is not being published, or any
// record when nothing is). Only SUBFIELD_UNKNOWN reads config/ alone and so runs in published mode; the other four need the run's own inputs
// and are draft-only, which their published tests show with stored data that would fail them if they ran. "Removed text" is tested where a
// rule reads a string (DUPLICATE's stored title). Every sentence of the five rows, "Tests pass X and fail Y" included, is at least one test.
//
// The worlds are the frame's (tests/helpers/rule-world.ts) with one repair so that the group's rules pass on them (R-0002 is a report JL
// upheld, which gets a correction and no decision), so a rule fails only for what a test changes. Each test runs the group's own rules,
// never the registry, so another group's rules cannot change a result. The sample world (fixtures/src) is run through the group once for
// every edition, its soft fixture is built here, and the last block runs the group's own F, S and T fixtures (fixtures/src/invalid/history.ts
// and the files they write to fixtures/drafts/).
//
// New for this project; Cyber's tests/validate.test.ts exercised ID_DUPLICATE and STANDING_STORY_NEW_FACT through its whole validator.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editionDraft } from "@/fixtures/src/drafts";
import { draftInputs as sampleInputs } from "@/fixtures/src/inputs";
import { invalidDraft, invalidOutputs, softDraft, softOutputs } from "@/fixtures/src/build";
import { historyCases, historyNamed, historySoft } from "@/fixtures/src/invalid/history";
import { EDITION_NAMES, REPO_ROOT, type EditionName } from "@/fixtures/src/world";
import { addDays } from "@/lib/dates";
import { RULE_CODE_TABLE, RULE_GROUPS, codeInfo, codesOfGroup } from "@/lib/rules";
import { historyRules, jaccardOfSets, subfieldIdsOf, subfieldIssue, type SubfieldConfig } from "@/lib/rules/history";
import { structureRules } from "@/lib/rules/structure";
import { buildDraftInput, buildPublishedInput, runRules, type DraftInputs } from "@/lib/rules/run";
import type { Rule, RuleInput, StoredRecords, ValidationIssue } from "@/lib/rules/types";
import type { Facts, FindingView } from "@/lib/rules/views";
import { AgentContext } from "@/lib/schema/context";
import { DraftBrief } from "@/lib/schema/draft";
import type { Finding } from "@/lib/schema/finding";
import { Correction } from "@/lib/schema/misc";
import { Pack } from "@/lib/schema/pack";
import { jaccard, wordSet } from "@/lib/text";
import { validateDraft } from "@/lib/validate";
import { FIELDS, REMOVED_BEFORE, REMOVED_TEXT } from "@/lib/vocab";
import {
  D, MONDAY, SUNDAY, config, deepFreeze, draftInputs, l, mondayContext, pack, storedCorrections, storedFinding, storedWorld, sundayContext,
  weekdayContext, weekdayDraft, type Json,
} from "./helpers/rule-world";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// ── What config/fields.json lists, read from the loaded file (not from the code under test) ──────────

const idsOf = (field: string): string[] => config().fields.fields.find((f) => f.id === field)!.subfields.map((s) => s.id);
const ACCEPTED = (field: string): string => idsOf(field).join(", ");

// ── The rules ────────────────────────────────────────────────────────────────────────────────────

const rule = (code: string): Rule => {
  const found = historyRules.find((r) => r.codes[0] === code);
  if (found === undefined) throw new Error(`no history rule for ${code}`);
  return found;
};

// ── The draft world ──────────────────────────────────────────────────────────────────────────────

type Edit = (draft: Json, context: Json) => void;

/**
 * The frame's Tuesday, repaired for this group. `new-1` is a biology result (DOI 10.1234/example.1, proteins) and `new-2` an earth check
 * (`ecology`); `returning` brings math-2026-0002 back with b1 (dated 2026-11-23), its own rung and a correction of it; `phys-2026-0003`'s
 * field and subfield are corrected together (chemistry, catalysis). The context lists the findings math-2026-0002, phys-2026-0003,
 * chem-2026-0004 and bio-2026-0001 as recent, with no artefacts; R-0001 is open (bio-2026-0001, rejected) and R-0002 is upheld by JL
 * (math-2026-0002, answered by corrections[0], whose report_id it is). math-2026-0002 is in the standing story `erdos-problems`.
 */
function world(): { draft: Json; context: Json } {
  const draft = structuredClone(weekdayDraft()) as Json;
  const context = structuredClone(weekdayContext()) as Json;
  draft.report_decisions = draft.report_decisions.filter((r: Json) => r.report_id !== "R-0002");
  return { draft, context };
}

function draftInput(edit: Edit = () => {}, over: Partial<DraftInputs> = {}): RuleInput {
  const { draft, context } = world();
  edit(draft, context);
  return buildDraftInput(DraftBrief.parse(draft), { ...draftInputs(), context: AgentContext.parse(context), ...over });
}

/** DRAFT mode: every issue of the group's rules on the Tuesday after `edit`, the engine's INPUT_MISSING warning included. */
const draftRun = (edit?: Edit, over?: Partial<DraftInputs>): ValidationIssue[] => runRules(draftInput(edit, over), historyRules);

/** DRAFT mode: the issues of one code, from that code's own rule. */
const draftOf = (code: string, edit?: Edit, over?: Partial<DraftInputs>): ValidationIssue[] =>
  runRules(draftInput(edit, over), [rule(code)]).filter((i) => i.code === code);

/** DRAFT mode: the REF_UNKNOWN issues of the structure group's rule, which judges how the draft uses the findings it names (SPEC §4.5). */
const refUnknownOf = (edit?: Edit, over?: Partial<DraftInputs>): ValidationIssue[] =>
  runRules(draftInput(edit, over), structureRules).filter((i) => i.code === "REF_UNKNOWN");

const recentOf = (context: Json, id: string): Json => context.recent_findings.find((r: Json) => r.id === id);

const draftCorrection = (finding: string, path: string, after: string, over: Json = {}): Json => ({
  finding_id: finding, edition_date: null, term_id: null, type: "correction", path, after, reason: "The record was wrong.", source_url: null,
  report_id: null, ...over,
});

const packWith = (edit: (p: Json) => void): Pack => {
  const p = structuredClone(pack()) as Json;
  edit(p);
  return Pack.parse(p);
};

/** A pack the run was given, changed by `edit`. */
const fromPackWith = (edit: (p: Json) => void): Partial<DraftInputs> => ({ pack: packWith(edit) });

/** A pack whose candidate cand-01 (https://example.org/paper/1) is dated `published_at`. */
const fromOldPack = (published_at: string): Partial<DraftInputs> => fromPackWith((p) => { p.candidates[0].published_at = published_at; });

const records = (findings: readonly Finding[] = [], corrections: readonly Correction[] = []): StoredRecords => ({ findings, corrections, terms: [] });

const only = (issues: readonly ValidationIssue[]): ValidationIssue => {
  expect(issues.map((i) => `${i.severity} ${i.code} ${i.path}`)).toHaveLength(1);
  return issues[0]!;
};

const paths = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => i.path);

// ── The published world ──────────────────────────────────────────────────────────────────────────

const correction = (id: string, date: string, finding: string, path: string, after: string, over: Json = {}): Correction => Correction.parse({
  id, date, finding_id: finding, edition_date: null, term_id: null, type: "correction", path, before: l("before"), after: l(after),
  reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null, ...over,
});

interface Content { findings: Finding[]; corrections: Correction[] }

/**
 * The stored Tuesday. `bio-2026-0001` and `math-2026-0002` were first briefed on D, so a run that
 * publishes D judges them; `phys-2026-0003` was first briefed on 2026-11-10 and is not. C-0001 is older, C-0002 and C-0003 (dated D) refile
 * `phys-2026-0003` to chemistry and catalysis together.
 */
function content(): Content {
  return {
    findings: [
      storedFinding("bio-2026-0001"),
      storedFinding("math-2026-0002", { depth: "item", title: l("A made-up proof"), first_brief: D, briefs: [D], terms: [] }),
      // last changed the day before D, as the frame's world has it: the Tuesday adds no text to it (F-17)
      storedFinding("phys-2026-0003", { depth: "item", first_brief: "2026-11-10", briefs: ["2026-11-10", D], updated: "2026-11-23" }),
    ],
    corrections: [...storedCorrections(), correction("C-0003", D, "phys-2026-0003", "subfield", "catalysis")],
  };
}

/** PUBLISHED mode on the stored Tuesday; `publishing` is the date being published (null: no record is). */
function publishedInput(c: Content = content(), publishing: string | null = D): RuleInput {
  const w = storedWorld();
  return buildPublishedInput(w.brief, { findings: c.findings, terms: w.terms, corrections: c.corrections, reports: w.reports }, { config: config(), publishing });
}

const publishedOf = (code: string, c?: Content, publishing?: string | null): ValidationIssue[] =>
  runRules(publishedInput(c, publishing), [rule(code)]).filter((i) => i.code === code);

// ── The registry ─────────────────────────────────────────────────────────────────────────────────

describe("the history group", () => {
  it("is the group the registry holds, with one rule for each of its five codes", () => {
    expect(RULE_GROUPS.find((g) => g.group === "history")!.rules).toBe(historyRules);
    expect(historyRules.map((r) => r.codes)).toEqual([["SUBFIELD_UNKNOWN"], ["DUPLICATE"], ["RETURN_NEW_FACT"], ["REPORT_DECISION"], ["REPORT_UPHELD"]]);
    expect(codesOfGroup("history")).toEqual(historyRules.flatMap((r) => r.codes));
  });

  it("runs each code in the modes the rule table gives it, and in no other", () => {
    const modes = Object.fromEntries(historyRules.map((r) => [r.codes[0], r.scope]));
    expect(modes).toEqual({
      SUBFIELD_UNKNOWN: ["draft", "published"], DUPLICATE: ["draft"], RETURN_NEW_FACT: ["draft"], REPORT_DECISION: ["draft"], REPORT_UPHELD: ["draft"],
    });
    for (const r of historyRules) {
      const table = codeInfo(r.codes[0])!;
      for (const mode of r.scope) expect(table.scopes, `${r.codes[0]} in ${mode}`).toContain(mode);
    }
    // SUBFIELD_UNKNOWN also has the seed scope: the seed validator of P2 calls subfieldIssue() (tested below), not a rule.
    expect(codeInfo("SUBFIELD_UNKNOWN")!.scopes).toEqual(["draft", "published", "seed"]);
    expect(RULE_CODE_TABLE.filter((r) => r.group === "history").every((r) => r.scopes.includes("draft"))).toBe(true);
  });

  it("gives each rule its severity from the table: four hard checks and one soft", () => {
    expect(Object.fromEntries(historyRules.map((r) => [r.codes[0], r.severity]))).toEqual({
      SUBFIELD_UNKNOWN: "error", DUPLICATE: "error", RETURN_NEW_FACT: "error", REPORT_DECISION: "error", REPORT_UPHELD: "warning",
    });
    expect(historyRules.map((r) => codeInfo(r.codes[0])!.severity)).toEqual(["H", "H", "H", "H", "S"]);
  });

  it("needs no run input, and uses the pack for the two checks that compare with it", () => {
    for (const r of historyRules) expect(r.needs, r.codes[0]).toEqual([]);
    expect(Object.fromEntries(historyRules.map((r) => [r.codes[0], r.uses]))).toEqual({
      SUBFIELD_UNKNOWN: [], DUPLICATE: ["pack"], RETURN_NEW_FACT: ["pack"], REPORT_DECISION: [], REPORT_UPHELD: [],
    });
  });

  it("passes the frame's repaired Tuesday, and the stored one being published, with no issue at all", () => {
    expect(draftRun()).toEqual([]);
    expect(runRules(publishedInput(), historyRules)).toEqual([]);
  });
});

// ── SUBFIELD_UNKNOWN ─────────────────────────────────────────────────────────────────────────────

describe("SUBFIELD_UNKNOWN, in draft mode", () => {
  const CODE = "SUBFIELD_UNKNOWN";

  it("passes `proteins` and fails `protein` and `ancient-texts` as a new biology finding's subfield (DRAFT)", () => {
    expect(draftOf(CODE, (d) => { d.new_findings[0].subfield = "proteins"; })).toEqual([]);

    const typo = only(draftOf(CODE, (d) => { d.new_findings[0].subfield = "protein"; }));
    expect(typo.code).toBe(CODE);
    expect(typo.severity).toBe("error");
    expect(typo.path).toBe("new_findings[0].subfield");
    expect(typo.message).toBe(
      `Subfield "protein" of new-1 is not one of biology's subfields: ${ACCEPTED("biology")}. Use one of biology's ids exactly as written.`,
    );
    expect(typo.hint).toContain("config/fields.json");

    const wrongField = only(draftOf(CODE, (d) => { d.new_findings[0].subfield = "ancient-texts"; }));
    expect(wrongField.path).toBe("new_findings[0].subfield");
    expect(wrongField.message).toBe(
      `Subfield "ancient-texts" of new-1 is not one of biology's subfields: ${ACCEPTED("biology")}. "ancient-texts" is a humanities subfield. Use one of biology's ids exactly as written.`,
    );
  });

  it("lists the ids of the finding's own field, whichever it is, and says where a subfield of another field belongs (DRAFT)", () => {
    for (const field of FIELDS) {
      const issue = only(draftOf(CODE, (d) => { d.new_findings[0].field = field; d.new_findings[0].subfield = "not-a-subfield"; }));
      expect(issue.message, field).toContain(`one of ${field}'s subfields: ${ACCEPTED(field)}.`);
    }
    // proteins is a biology id: under mathematics it fails, and the message says whose it is.
    const issue = only(draftOf(CODE, (d) => { d.new_findings[0].field = "mathematics"; }));
    expect(issue.message).toContain(`not one of mathematics's subfields: ${ACCEPTED("mathematics")}. "proteins" is a biology subfield.`);
    // An id that no field lists says nothing about an owner.
    expect(only(draftOf(CODE, (d) => { d.new_findings[0].subfield = "no-such"; })).message).not.toContain("is a ");
  });

  it("judges each new finding, and reports the one at its own index (DRAFT)", () => {
    const issues = draftOf(CODE, (d) => { d.new_findings[0].subfield = "protein"; d.new_findings[1].subfield = "soils"; });
    expect(paths(issues)).toEqual(["new_findings[0].subfield", "new_findings[1].subfield"]);
    expect(issues[1]!.message).toContain(`Subfield "soils" of new-2 is not one of earth's subfields: ${ACCEPTED("earth")}.`);
    expect(paths(draftOf(CODE, (d) => { d.new_findings[1].subfield = "soils"; }))).toEqual(["new_findings[1].subfield"]);
  });

  it("passes a correction of a stored biology finding's subfield to `genomics` and fails one to `protein` or `ancient-texts` (DRAFT)", () => {
    const add = (after: string): Edit => (d) => { d.corrections.push(draftCorrection("bio-2026-0001", "subfield", after)); };
    expect(draftOf(CODE, add("genomics"))).toEqual([]);

    const typo = only(draftOf(CODE, add("protein")));
    expect(typo.path).toBe("corrections[3].after");
    expect(typo.message).toBe(
      `Subfield "protein" of this correction of bio-2026-0001 (its field as filed is biology) is not one of biology's subfields: ${ACCEPTED("biology")}. Use one of biology's ids exactly as written.`,
    );

    const wrongField = only(draftOf(CODE, add("ancient-texts")));
    expect(wrongField.path).toBe("corrections[3].after");
    expect(wrongField.message).toContain(`"ancient-texts" is a humanities subfield.`);
  });

  it("takes the field as the draft's own corrections file it: a subfield of the old field fails once the field is corrected (DRAFT)", () => {
    // phys-2026-0003's field is corrected to chemistry in the same draft (corrections[1]); `catalysis` is chemistry's, `optics` is physics'.
    const issue = only(draftOf(CODE, (d) => { d.corrections[2].after = "atoms-optics"; }));
    expect(issue.path).toBe("corrections[2].after");
    expect(issue.message).toContain("(its field as filed is chemistry)");
    expect(issue.message).toContain(`one of chemistry's subfields: ${ACCEPTED("chemistry")}.`);
    expect(issue.message).toContain(`"atoms-optics" is a physics subfield.`);
  });

  it("passes corrections of `field` to `chemistry` and of `subfield` to `catalysis` in one draft (DRAFT)", () => {
    // The frame's draft holds exactly this pair on phys-2026-0003, whose record is physics: catalysis passes only as chemistry's.
    expect(draftOf(CODE)).toEqual([]);
    const draft = world().draft;
    expect(draft.corrections.slice(1).map((c: Json) => [c.finding_id, c.path, c.after])).toEqual([
      ["phys-2026-0003", "field", "chemistry"], ["phys-2026-0003", "subfield", "catalysis"],
    ]);
  });

  it("fails a correction of `field` alone, and one with `subfield` `genomics`, in a draft (DRAFT)", () => {
    const alone = only(draftOf(CODE, (d) => { d.corrections.splice(2, 1); }));
    expect(alone.path).toBe("corrections[1].after");
    expect(alone.message).toBe(
      `This draft corrects the field of phys-2026-0003 to "chemistry" without correcting its subfield, and each subfield id is under one field, so the old subfield cannot stay. Add a correction of "subfield" on phys-2026-0003 to one of chemistry's subfields: ${ACCEPTED("chemistry")}.`,
    );
    expect(alone.hint).toBe("A correction of a field comes with a correction of its subfield made with it (SPEC §4.12 SUBFIELD_UNKNOWN, Appendix B).");

    // genomics is a biology id: the pair is complete, and the subfield correction fails against the new field.
    const wrong = only(draftOf(CODE, (d) => { d.corrections[2].after = "genomics"; }));
    expect(wrong.path).toBe("corrections[2].after");
    expect(wrong.message).toContain("(its field as filed is chemistry)");
    expect(wrong.message).toContain(`"genomics" is a biology subfield.`);
  });

  it("asks for a pair for each field correction, and a subfield correction of another finding does not pair (DRAFT)", () => {
    const edit: Edit = (d) => {
      d.corrections.splice(2, 1, draftCorrection("bio-2026-0001", "subfield", "genomics"));
      d.corrections.push(draftCorrection("chem-2026-0004", "field", "earth"));
    };
    const issues = draftOf(CODE, edit);
    expect(paths(issues)).toEqual(["corrections[1].after", "corrections[3].after"]);
    expect(issues[0]!.message).toContain("field of phys-2026-0003 to \"chemistry\"");
    expect(issues[1]!.message).toContain("field of chem-2026-0004 to \"earth\"");
    expect(issues[1]!.message).toContain(`one of earth's subfields: ${ACCEPTED("earth")}.`);
  });

  it("asks every field correction for its pair, in order: a pair that is there does not end the search (DRAFT)", () => {
    // The Tuesday's pair on phys-2026-0003 (corrections[1] and [2]) is complete; chem-2026-0004's field correction after it has none.
    const issues = draftOf(CODE, (d) => { d.corrections.push(draftCorrection("chem-2026-0004", "field", "earth")); });
    expect(paths(issues)).toEqual(["corrections[3].after"]);
    expect(issues[0]!.message).toContain("field of chem-2026-0004 to \"earth\"");
  });

  it("files a subfield correction under the field that the same draft's later corrections give (DRAFT)", () => {
    // Two field corrections: the later one wins, so `catalysis` (chemistry) fails once the field ends up earth.
    const edit: Edit = (d) => { d.corrections.push(draftCorrection("phys-2026-0003", "field", "earth")); };
    const issues = draftOf(CODE, edit);
    expect(paths(issues)).toEqual(["corrections[2].after"]);
    expect(issues[0]!.message).toContain("(its field as filed is earth)");
  });

  it("ignores a `removed` correction on `field` or `subfield`, which fails SCHEMA alone (DRAFT)", () => {
    const withRemoved = (path: string): Json => {
      const { draft } = world();
      draft.corrections.push(draftCorrection("bio-2026-0001", path, REMOVED_TEXT.en, { type: "removed" }));
      return draft;
    };
    for (const path of ["field", "subfield"]) {
      const draft = withRemoved(path);
      // SCHEMA alone: the draft does not parse, and the only codes reported are SCHEMA's.
      expect(DraftBrief.safeParse(draft).success, path).toBe(false);
      const result = validateDraft(draft, { ...draftInputs(), rules: historyRules });
      expect(result.ok, path).toBe(false);
      expect(new Set(result.issues.map((i) => i.code)), path).toEqual(new Set(["SCHEMA"]));
      expect(result.issues.some((i) => i.path === "corrections[3].path"), path).toBe(true);
      // Were it judged, the rule would fail it: `removed` is no subfield and no pair for a field. It is skipped.
      const input = buildDraftInput(draft as DraftBrief, { ...draftInputs(), context: AgentContext.parse(world().context) });
      expect(runRules(input, [rule(CODE)]), path).toEqual([]);
    }
  });

  it("skips a correction of a finding it cannot see, of an edition and of a term (DRAFT)", () => {
    const edit: Edit = (d) => {
      d.corrections.push(draftCorrection("soc-2026-0150", "subfield", "no-such"));
      d.corrections.push({ ...draftCorrection("x", "lead.0.text", "A new Lead line."), finding_id: null, edition_date: "2026-11-10" });
      d.corrections.push({ ...draftCorrection("x", "definition", "A new definition."), finding_id: null, term_id: "enzyme" });
    };
    expect(draftOf(CODE, edit)).toEqual([]);
    // What it skips does not end the search: a bad subfield correction after the three is still judged, at its own index.
    const after: Edit = (d, c) => { edit(d, c); d.corrections.push(draftCorrection("bio-2026-0001", "subfield", "protein")); };
    expect(paths(draftOf(CODE, after))).toEqual(["corrections[6].after"]);
    // Once the draft also files the unknown finding's field, its subfield is judged against that field.
    const filed: Edit = (d) => {
      d.corrections.push(draftCorrection("soc-2026-0150", "field", "social"), draftCorrection("soc-2026-0150", "subfield", "no-such"));
    };
    const issues = draftOf(CODE, filed);
    expect(paths(issues)).toEqual(["corrections[4].after"]);
    expect(issues[0]!.message).toContain(`one of social's subfields: ${ACCEPTED("social")}.`);
  });

  it("leaves alone a finding whose view lacks a field or a subfield, and still judges the next one (DRAFT)", () => {
    // A finding record always has both (the schema requires them), but a view's facts are typed as possibly unknown: with nothing to read
    // there is nothing to judge, and the rule moves on. The view of new-1 is changed in the input; new-2 keeps its own.
    const input = draftInput((d) => { d.new_findings[0].subfield = "protein"; d.new_findings[1].subfield = "soils"; });
    const without = (patch: Partial<Facts>): ValidationIssue[] => {
      const findings = input.views.findings.map((f) => (f.key === "new-1" ? { ...f, published: { ...f.published, ...patch } } : f));
      return runRules({ ...input, views: { ...input.views, findings } }, [rule(CODE)]);
    };
    expect(paths(without({}))).toEqual(["new_findings[0].subfield", "new_findings[1].subfield"]);
    for (const patch of [{ field: null }, { subfield: null }, { field: null, subfield: null }]) {
      expect(paths(without(patch)), JSON.stringify(patch)).toEqual(["new_findings[1].subfield"]);
    }
  });
});

describe("SUBFIELD_UNKNOWN, in published mode", () => {
  const CODE = "SUBFIELD_UNKNOWN";

  /** The stored Tuesday with one finding's record changed. */
  const refiled = (id: string, patch: Json): Content => {
    const c = content();
    c.findings = c.findings.map((f) => (f.id === id ? ({ ...f, ...patch } as Finding) : f));
    return c;
  };

  it("passes `proteins` and fails `protein` and `ancient-texts` on a finding being published (PUBLISHED, the records being published)", () => {
    expect(publishedOf(CODE, refiled("bio-2026-0001", { subfield: "proteins" }))).toEqual([]);

    const typo = only(publishedOf(CODE, refiled("bio-2026-0001", { subfield: "protein" })));
    expect(typo.severity).toBe("error");
    expect(typo.path).toBe("findings/bio-2026-0001.json: subfield");
    expect(typo.message).toBe(
      `Subfield "protein" of bio-2026-0001 is not one of biology's subfields: ${ACCEPTED("biology")}. Use one of biology's ids exactly as written.`,
    );

    const wrongField = only(publishedOf(CODE, refiled("bio-2026-0001", { subfield: "ancient-texts" })));
    expect(wrongField.message).toContain(`"ancient-texts" is a humanities subfield.`);
  });

  it("judges every finding first briefed on the publishing date, and no other (PUBLISHED, the records being published)", () => {
    const both = content();
    both.findings = both.findings.map((f) => ({ ...f, subfield: "no-such" }) as Finding);
    // bio-2026-0001 and math-2026-0002 were first briefed on D; phys-2026-0003 on 2026-11-10.
    expect(paths(publishedOf(CODE, both))).toEqual(["findings/bio-2026-0001.json: subfield", "findings/math-2026-0002.json: subfield"]);
    // Publishing 2026-11-10 judges phys-2026-0003 alone.
    expect(paths(publishedOf(CODE, both, "2026-11-10"))).toEqual(["findings/phys-2026-0003.json: subfield"]);
  });

  it("does not judge the subfield of a returning finding, which is an archived record: only a finding first briefed on the publishing date is judged (F-55)", () => {
    // phys-2026-0003 returns on D (`updated: D`, an entry recorded on D); its subfield is not text of the edition
    const returning = refiled("phys-2026-0003", { updated: D, subfield: "no-such" });
    expect(publishedOf(CODE, returning)).toEqual([]);
    // the same bad subfield on a finding first briefed on D is judged
    expect(paths(publishedOf(CODE, refiled("bio-2026-0001", { subfield: "no-such" })))).toEqual(["findings/bio-2026-0001.json: subfield"]);
    // and on the returning finding, once the date being published is the day it was first briefed
    expect(paths(publishedOf(CODE, returning, "2026-11-10"))).toEqual(["findings/phys-2026-0003.json: subfield"]);
  });

  it("judges a stored finding by its own field as first published, not by a later correction of the field (PUBLISHED, the records being published)", () => {
    // math-2026-0002 is mathematics; `formal-proof` is its id. A correction of its field (dated before D) does not move the record's own subfield.
    const c = content();
    c.corrections.push(correction("C-0004", "2026-11-12", "math-2026-0002", "field", "physics"));
    expect(publishedOf(CODE, c)).toEqual([]);
  });

  it("leaves every other stored record alone: not being published, or nothing being published (PUBLISHED, every other record)", () => {
    // phys-2026-0003 holds `atoms-optics`; make it the frame's `optics`, which no field lists, and the two others fail too.
    const bad = content();
    bad.findings = bad.findings.map((f) => ({ ...f, subfield: "optics" }) as Finding);
    expect(paths(publishedOf(CODE, bad))).not.toContain("findings/phys-2026-0003.json: subfield");
    // Another date being published judges none of them (none was first briefed on it).
    expect(publishedOf(CODE, bad, "2026-11-25")).toEqual([]);
    // Nothing being published (`publishing` null): no record is judged against config/.
    expect(publishedOf(CODE, bad, null)).toEqual([]);
    expect(runRules(publishedInput(bad, null), historyRules)).toEqual([]);
  });

  it("passes a correction dated on the publishing date to `genomics` and fails one to `protein` or `ancient-texts` (PUBLISHED, the records being published)", () => {
    const add = (after: string, date = D): Content => {
      const c = content();
      c.corrections.push(correction("C-0004", date, "bio-2026-0001", "subfield", after));
      return c;
    };
    expect(publishedOf(CODE, add("genomics"))).toEqual([]);

    const typo = only(publishedOf(CODE, add("protein")));
    expect(typo.path).toBe("corrections.json: corrections[3].after.en");
    expect(typo.message).toBe(
      `Subfield "protein" of this correction of bio-2026-0001 (its field as filed is biology) is not one of biology's subfields: ${ACCEPTED("biology")}. Use one of biology's ids exactly as written.`,
    );
    expect(only(publishedOf(CODE, add("ancient-texts"))).message).toContain(`"ancient-texts" is a humanities subfield.`);

    // The same correction dated before D, or with nothing being published, is another record: not judged.
    expect(publishedOf(CODE, add("protein", "2026-11-12"))).toEqual([]);
    expect(publishedOf(CODE, add("protein"), null)).toEqual([]);
    expect(publishedOf(CODE, add("protein"), "2026-11-25")).toEqual([]);
  });

  it("files a stored subfield correction under its field as of its own date, so a later field correction does not reach back (PUBLISHED, the records being published)", () => {
    // C-0002 refiles phys-2026-0003 to chemistry on D. A subfield correction dated D to `atoms-optics` (a physics id) fails: that day its field is chemistry.
    const c = content();
    c.corrections = c.corrections.map((x) => (x.id === "C-0003" ? ({ ...x, after: l("atoms-optics") } as Correction) : x));
    const issue = only(publishedOf(CODE, c));
    expect(issue.path).toBe("corrections.json: corrections[2].after.en");
    expect(issue.message).toContain("(its field as filed is chemistry)");
    // The same id dated 2026-11-10, before C-0002, is filed under physics and passes when that day is published.
    const earlier = content();
    earlier.corrections.push(correction("C-0004", "2026-11-10", "phys-2026-0003", "subfield", "atoms-optics"));
    expect(publishedOf(CODE, earlier, "2026-11-10")).toEqual([]);
    // While D is published it is another record, and is not judged at all.
    expect(publishedOf(CODE, earlier)).toEqual([]);
  });

  it("asks that a stored correction of `field` dated on the publishing date comes with one of `subfield` of that date (PUBLISHED, the records being published)", () => {
    const alone = content();
    alone.corrections = alone.corrections.filter((x) => x.id !== "C-0003");
    const issue = only(publishedOf(CODE, alone));
    expect(issue.path).toBe("corrections.json: corrections[1].after.en");
    expect(issue.message).toBe(
      `The corrections dated ${D} correct the field of phys-2026-0003 to "chemistry" without correcting its subfield, and each subfield id is under one field, so the old subfield cannot stay. Add a correction of "subfield" on phys-2026-0003 to one of chemistry's subfields: ${ACCEPTED("chemistry")}.`,
    );
    // A subfield correction of another day does not pair with it.
    const otherDay = content();
    otherDay.corrections = otherDay.corrections.map((x) => (x.id === "C-0003" ? ({ ...x, date: "2026-11-23" } as Correction) : x));
    expect(paths(publishedOf(CODE, otherDay))).toEqual(["corrections.json: corrections[1].after.en"]);
    // Nor does a subfield correction of another finding.
    const another = content();
    another.corrections = another.corrections.map((x) => (x.id === "C-0003" ? ({ ...x, finding_id: "bio-2026-0001", after: l("genomics") } as Correction) : x));
    expect(paths(publishedOf(CODE, another))).toEqual(["corrections.json: corrections[1].after.en"]);
    // A field correction of an earlier day, or with nothing being published, is another record: no pair is asked for.
    expect(publishedOf(CODE, alone, null)).toEqual([]);
    expect(publishedOf(CODE, alone, "2026-11-25")).toEqual([]);
    const old = content();
    old.corrections = old.corrections.filter((x) => x.id !== "C-0003").map((x) => (x.id === "C-0002" ? ({ ...x, date: "2026-11-12" } as Correction) : x));
    expect(publishedOf(CODE, old)).toEqual([]);
  });

  it("does not take a stored `removed` correction on `subfield` for the pair of a `field` correction of the same day (PUBLISHED, the records being published)", () => {
    // C-0002 refiles phys-2026-0003 to chemistry on D. A `removed` correction of its subfield, which no draft can hold, sets no subfield: the pair is still missing.
    const c = content();
    c.corrections = c.corrections.filter((x) => x.id !== "C-0003");
    c.corrections.push({
      ...correction("C-0004", D, "phys-2026-0003", "subfield", REMOVED_TEXT.en), type: "removed", before: REMOVED_BEFORE, after: REMOVED_TEXT,
    } as Correction);
    const issue = only(publishedOf(CODE, c));
    expect(issue.path).toBe("corrections.json: corrections[1].after.en");
    expect(issue.message).toContain(`correct the field of phys-2026-0003 to "chemistry" without correcting its subfield`);
  });

  it("does not read a stored `removed` correction on another path, and skips one on `field` or `subfield`, which SCHEMA rejects (PUBLISHED, the records being published)", () => {
    // Keyed on the stored correction alone: a removed how_sure of the finding changes nothing here (SPEC 4.12 "Removed text").
    const c = refiled("bio-2026-0001", { subfield: "protein" });
    c.corrections.push(correction("C-0004", D, "bio-2026-0001", "explainer.how_sure", REMOVED_TEXT.en, { type: "removed", before: REMOVED_BEFORE, after: REMOVED_TEXT }));
    expect(paths(publishedOf(CODE, c))).toEqual(["findings/bio-2026-0001.json: subfield"]);

    for (const path of ["field", "subfield"]) {
      const removed = content();
      removed.corrections.push({
        ...correction("C-0004", D, "bio-2026-0001", path, REMOVED_TEXT.en), type: "removed", before: REMOVED_BEFORE, after: REMOVED_TEXT,
      } as Correction);
      expect(publishedOf(CODE, removed), path).toEqual([]);
    }
  });

  it("skips a correction of a finding no record holds and of an edition or a term, but still asks a field correction for its pair (PUBLISHED, the records being published)", () => {
    const c = content();
    c.corrections.push(correction("C-0004", D, "soc-2026-0150", "subfield", "no-such")); // no record holds soc-2026-0150, so its field is unknown
    c.corrections.push({ ...correction("C-0005", D, "bio-2026-0001", "lead.0.text", "A new Lead line."), finding_id: null, edition_date: "2026-11-10" } as Correction);
    c.corrections.push({ ...correction("C-0006", D, "bio-2026-0001", "definition", "A new definition."), finding_id: null, term_id: "enzyme" } as Correction);
    expect(publishedOf(CODE, c)).toEqual([]);
    // The stored schema takes any path for an edition's or a term's correction, `field` and `subfield` too. It names no finding, so none is judged or paired.
    for (const [path, after] of [["field", "physics"], ["subfield", "no-such"]] as const) {
      for (const target of [{ edition_date: "2026-11-10" }, { term_id: "enzyme" }]) {
        const other = content();
        other.corrections.push({ ...correction("C-0004", D, "bio-2026-0001", path, after), finding_id: null, ...target } as Correction);
        expect(publishedOf(CODE, other), `${path} ${JSON.stringify(target)}`).toEqual([]);
      }
    }
    // A field correction asks for its pair whether or not a record holds the finding.
    c.corrections.push(correction("C-0007", D, "soc-2026-0151", "field", "social"));
    expect(paths(publishedOf(CODE, c))).toEqual([`corrections.json: corrections[${c.corrections.length - 1}].after.en`]);
  });

  it("leaves a stored correction of `field` to a value that is no field alone: nothing is refiled, so no pair is asked for (PUBLISHED, the records being published)", () => {
    // A stored record can hold what a draft cannot (SCHEMA turns a draft's field correction to a non-field away); here nothing is refiled.
    const c = content();
    c.corrections.push(correction("C-0004", D, "bio-2026-0001", "field", "astrology"));
    expect(publishedOf(CODE, c)).toEqual([]);
    // The records after it are still judged: a subfield correction goes by the field the finding keeps, and a real field correction asks for its pair.
    c.corrections.push(correction("C-0005", D, "bio-2026-0001", "subfield", "protein"));
    c.corrections.push(correction("C-0006", D, "math-2026-0002", "field", "physics"));
    const issues = publishedOf(CODE, c);
    expect(paths(issues)).toEqual([`corrections.json: corrections[${c.corrections.length - 2}].after.en`, `corrections.json: corrections[${c.corrections.length - 1}].after.en`]);
    expect(issues[0]!.message).toContain("(its field as filed is biology)");
    expect(issues[1]!.message).toContain("field of math-2026-0002 to \"physics\"");
  });

  it("judges the same subfield in both modes, with the path of the file in published mode only (DRAFT and PUBLISHED)", () => {
    const d = only(draftOf(CODE, (draft) => { draft.new_findings[0].subfield = "protein"; }));
    const p = only(publishedOf(CODE, refiled("bio-2026-0001", { subfield: "protein" })));
    expect(d.path).toBe("new_findings[0].subfield");
    expect(p.path).toBe("findings/bio-2026-0001.json: subfield");
    expect(d.message.replace("new-1", "X")).toBe(p.message.replace("bio-2026-0001", "X"));
  });

  it("reads the loaded config/fields.json, never the copy the context shows the agent (DRAFT)", () => {
    // The context lists only proteins and genomics under biology; config/fields.json also lists drugs, cells and the rest.
    expect(recentOf(world().context, "bio-2026-0001")).toBeDefined();
    expect(world().context.config.fields.find((f: Json) => f.id === "biology").subfields.map((s: Json) => s.id)).toEqual(["proteins", "genomics"]);
    expect(draftOf(CODE, (d) => { d.new_findings[0].subfield = "drugs"; })).toEqual([]);
    expect(draftOf(CODE, (d, c) => { d.new_findings[0].subfield = "neuroscience"; c.config.fields[0].subfields = []; })).toEqual([]);
  });
});

describe("subfieldIdsOf() and subfieldIssue(), which the seed validator of P2 calls", () => {
  it("lists a field's ids in file order, and nothing for a value that is none of the seven fields", () => {
    for (const field of FIELDS) {
      expect(subfieldIdsOf(config(), field), field).toEqual(idsOf(field));
      expect(idsOf(field).length, field).toBeGreaterThan(0);
    }
    expect(subfieldIdsOf(config(), "biology")).toContain("proteins");
    for (const bad of [null, "", "astrology", "Biology", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(subfieldIdsOf(config(), bad), String(bad)).toEqual([]);
    }
  });

  it("accepts each id of each field, and reports a seed's wrong subfield at the path and with the words the caller gives", () => {
    for (const field of FIELDS) for (const id of idsOf(field)) expect(subfieldIssue(config(), field, id, "seeds[0].subfield", "of seed 0"), `${field} ${id}`).toBeNull();

    const issue = subfieldIssue(config(), "biology", "protein", "seeds[3].subfield", "of seed 3");
    expect(issue).toEqual({
      code: "SUBFIELD_UNKNOWN", severity: "error", path: "seeds[3].subfield",
      message: `Subfield "protein" of seed 3 is not one of biology's subfields: ${ACCEPTED("biology")}. Use one of biology's ids exactly as written.`,
      hint: "config/fields.json lists each field's subfield ids, and each id is under one field (SPEC Appendix B).",
    });
    expect(subfieldIssue(config(), "chemistry", "proteins", "seeds[4].subfield", "of seed 4")!.message).toContain(`"proteins" is a biology subfield.`);
  });

  it("matches an id exactly as written: a capital letter, a space or part of an id is not the id", () => {
    // The draft and stored schemas hold subfields to `^[a-z0-9][a-z0-9-]*$`, so only a seed, which reaches this function as a string, can bring such a value.
    for (const bad of ["Proteins", "PROTEINS", "proteins ", " proteins", "protein", "prot", "proteins-", "proteins\n", ""]) {
      const issue = subfieldIssue(config(), "biology", bad, "seeds[0].subfield", "of seed 0");
      expect(issue, JSON.stringify(bad)).not.toBeNull();
      expect(issue!.code, JSON.stringify(bad)).toBe("SUBFIELD_UNKNOWN");
      expect(issue!.message, JSON.stringify(bad)).toContain(`not one of biology's subfields: ${ACCEPTED("biology")}.`);
    }
    expect(subfieldIssue(config(), "biology", "proteins", "seeds[0].subfield", "of seed 0")).toBeNull();
  });

  it("says that a subfield of a value that is no field cannot be checked, and names the fields", () => {
    const issue = subfieldIssue(config(), "astrology", "stars", "seeds[1].subfield", "of seed 1")!;
    expect(issue.code).toBe("SUBFIELD_UNKNOWN");
    expect(issue.severity).toBe("error");
    expect(issue.path).toBe("seeds[1].subfield");
    expect(issue.message).toBe(`Subfield "stars" of seed 1 cannot be checked: "astrology" is not one of the fields (${FIELDS.join(", ")}).`);
    expect(issue.hint).toBe("Fix the field first; then the subfield is one of its ids in config/fields.json.");
    expect(subfieldIssue(config(), "constructor", "x", "p", "of q")!.message).toContain("cannot be checked");
  });

  it("reads the index alone, so a seed run that has only the index can call it", () => {
    const narrow: SubfieldConfig = { index: { subfields: config().index.subfields, fieldOfSubfield: config().index.fieldOfSubfield } };
    expect(subfieldIssue(narrow, "biology", "genomics", "p", "of x")).toBeNull();
    expect(subfieldIssue(narrow, "biology", "ancient-texts", "p", "of x")!.message).toContain("is a humanities subfield");
    expect(subfieldIdsOf(narrow, "earth")).toEqual(idsOf("earth"));
  });
});

// ── DUPLICATE ────────────────────────────────────────────────────────────────────────────────────

describe("DUPLICATE, in draft mode", () => {
  const CODE = "DUPLICATE";
  const DOI = "10.1234/example.1"; // new-1's own DOI, and cand-01's in the pack
  const art = (over: Json = {}): Json => ({ doi: [], arxiv: [], lean: [], trial: [], pdb: [], ...over });
  /** new-1's artefacts, replaced. */
  const mine = (over: Json): Edit => (d) => { d.new_findings[0].artefacts = art(over); };
  /** A stored recent finding's artefacts, replaced. */
  const theirs = (id: string, over: Json): Edit => (_d, c) => { recentOf(c, id).artefacts = art(over); };
  const both = (...edits: Edit[]): Edit => (d, c) => { for (const e of edits) e(d, c); };
  /**
   * The title of new-1 and of a stored recent finding, replaced; the stored finding is filed under biology, new-1's field. The context
   * shows a finding with a report (bio-2026-0001, math-2026-0002) by the report's stored text first, so the title tests use one with none.
   */
  const titles = (own: string, stored: string, id = "chem-2026-0004"): Edit => (d, c) => {
    d.new_findings[0].title = own;
    Object.assign(recentOf(c, id), { title: stored, field: "biology" });
  };
  const foundIn = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => /stored finding (\S+)/.exec(i.message)![1]!);

  it("passes the Tuesday, whose pack lists new-1's DOI on a candidate that is not a stored finding (DRAFT)", () => {
    expect(draftOf(CODE)).toEqual([]);
    expect(pack().candidates[0]!.doi).toBe(DOI);
    expect(pack().candidates[0]!.stored_finding).toBeNull();
  });

  it("fails a new finding that shares a DOI with a stored finding, whatever the field and the title, and says how to fix it (DRAFT)", () => {
    const issue = only(draftOf(CODE, theirs("chem-2026-0004", { doi: [DOI] })));
    expect(issue.code).toBe(CODE);
    expect(issue.severity).toBe("error");
    expect(issue.path).toBe("new_findings[0].artefacts.doi[0]");
    expect(issue.message).toBe(
      `new-1 duplicates the stored finding chem-2026-0004 ("A made-up result of chem-2026-0004"): they share DOI ${DOI}. A finding that is already stored comes back only as a returning entry. Replace new-1 with chem-2026-0004 in story or items and in the Lead's refs, delete new-1 from new_findings, and add an entry to returning for chem-2026-0004: its update (at most 60 words) and the sources that show the new facts. If there are no new facts, take new-1 out of story, items, the Lead's refs and new_findings instead.`,
    );
    expect(issue.hint).toBe("A new finding is for a result the record does not hold; a finding already on record is shown by its own id in story or items, with an entry in returning for what is new (SPEC §4.12 DUPLICATE, REF_UNKNOWN, STYLE.md).");
  });

  it("tells the agent to put the stored id where the new-N stood and add a returning entry, and doing that passes DUPLICATE, REF_UNKNOWN and RETURN_NEW_FACT (DRAFT)", () => {
    // new-2 is an item that the Lead's first sentence cites; it now carries the DOI of the stored finding chem-2026-0004.
    const DOI_2 = "10.1234/example.7";
    const duplicate: Edit = both((d) => { d.new_findings[1].artefacts = art({ doi: [DOI_2] }); }, theirs("chem-2026-0004", { doi: [DOI_2] }));
    expect(refUnknownOf(duplicate)).toEqual([]);
    const issue = only(draftOf(CODE, duplicate));
    expect(issue.path).toBe("new_findings[1].artefacts.doi[0]");
    expect(issue.message).toContain(
      "Replace new-2 with chem-2026-0004 in story or items and in the Lead's refs, delete new-2 from new_findings, and add an entry to returning for chem-2026-0004:",
    );
    expect(issue.message).toContain("If there are no new facts, take new-2 out of story, items, the Lead's refs and new_findings instead.");
    expect(issue.message).not.toContain("Delete new-2");

    // What the message says, step by step: the id replaces new-2 in the items and in the Lead, new-2 leaves new_findings, an entry joins returning.
    const returning = (d: Json): void => { d.returning.push({ finding_id: "chem-2026-0004", update: "A journal published the paper.", source_ids: ["b1"], rung: null }); };
    const followed: Edit = both(duplicate, (d) => {
      d.items = d.items.map((ref: string) => (ref === "new-2" ? "chem-2026-0004" : ref));
      for (const line of d.lead) line.refs = line.refs.map((ref: string) => (ref === "new-2" ? "chem-2026-0004" : ref));
      d.new_findings = d.new_findings.filter((f: Json) => f.ref !== "new-2");
      returning(d);
    });
    expect(world().draft.items).toContain("new-2");
    expect(draftOf(CODE, followed)).toEqual([]);
    expect(refUnknownOf(followed)).toEqual([]);
    expect(draftOf("RETURN_NEW_FACT", followed)).toEqual([]);

    // The earlier wording said to delete new-2 from story or items: the returning entry then has no place and REF_UNKNOWN fails it.
    const deleted: Edit = both(duplicate, (d) => {
      d.items = d.items.filter((ref: string) => ref !== "new-2");
      for (const line of d.lead) line.refs = line.refs.filter((ref: string) => ref !== "new-2");
      d.new_findings = d.new_findings.filter((f: Json) => f.ref !== "new-2");
      returning(d);
    });
    expect(draftOf(CODE, deleted)).toEqual([]);
    const stranded = only(refUnknownOf(deleted));
    expect(stranded.path).toBe("returning[1].finding_id");
    expect(stranded.message).toContain("neither story nor items names that finding");
  });

  it("when story or items already show the stored finding, tells the agent to delete the new-N and use the entry it has: replacing it would show the finding twice (DRAFT)", () => {
    // new-2 is an item; math-2026-0002 is the other item, with its returning entry. new-2 now carries math-2026-0002's DOI.
    const DOI_2 = "10.1234/example.7";
    const duplicate: Edit = both((d) => { d.new_findings[1].artefacts = art({ doi: [DOI_2] }); }, theirs("math-2026-0002", { doi: [DOI_2] }));
    expect(refUnknownOf(duplicate)).toEqual([]);
    const issue = only(draftOf(CODE, duplicate));
    expect(issue.path).toBe("new_findings[1].artefacts.doi[0]");
    expect(issue.message).toContain(
      "A finding that is already stored comes back only as a returning entry, and math-2026-0002 is already in story or items. Delete new-2 from story or items, from the Lead's refs and from new_findings, and put the new facts in the returning entry of math-2026-0002 (add one if it has none): its update (at most 60 words) and the sources that show them.",
    );
    expect(issue.message).not.toContain("Replace new-2");

    // What the message says: new-2 leaves items, the Lead and new_findings, and the entry that math-2026-0002 has stays.
    const followed: Edit = both(duplicate, (d) => {
      d.items = d.items.filter((ref: string) => ref !== "new-2");
      for (const line of d.lead) line.refs = line.refs.filter((ref: string) => ref !== "new-2");
      d.new_findings = d.new_findings.filter((f: Json) => f.ref !== "new-2");
    });
    expect(draftOf(CODE, followed)).toEqual([]);
    expect(refUnknownOf(followed)).toEqual([]);
    expect(draftOf("RETURN_NEW_FACT", followed)).toEqual([]);

    // The usual wording would put math-2026-0002 in items twice and give it two entries: REF_UNKNOWN fails both.
    const replaced: Edit = both(duplicate, (d) => {
      d.items = d.items.map((ref: string) => (ref === "new-2" ? "math-2026-0002" : ref));
      for (const line of d.lead) line.refs = line.refs.map((ref: string) => (ref === "new-2" ? "math-2026-0002" : ref));
      d.new_findings = d.new_findings.filter((f: Json) => f.ref !== "new-2");
      d.returning.push({ finding_id: "math-2026-0002", update: "A journal published the proof.", source_ids: ["b1"], rung: null });
    });
    expect(refUnknownOf(replaced).map((i) => i.path).sort()).toEqual(["items[1]", "returning[1].finding_id"]);

    // The same when the stored finding is the story, and the new-N an item.
    const asStory: Edit = both((d) => { d.story = "math-2026-0002"; d.items = ["new-1", "new-2"]; }, theirs("math-2026-0002", { doi: [DOI] }));
    expect(refUnknownOf(asStory)).toEqual([]);
    const storyIssue = only(draftOf(CODE, asStory));
    expect(storyIssue.path).toBe("new_findings[0].artefacts.doi[0]");
    expect(storyIssue.message).toContain("math-2026-0002 is already in story or items. Delete new-1 from story or items, from the Lead's refs and from new_findings,");
    const storyFollowed: Edit = both(asStory, (d) => {
      d.items = ["new-2"];
      for (const line of d.lead) line.refs = line.refs.filter((ref: string) => ref !== "new-1");
      d.new_findings = d.new_findings.filter((f: Json) => f.ref !== "new-1");
    });
    expect(draftOf(CODE, storyFollowed)).toEqual([]);
    expect(refUnknownOf(storyFollowed)).toEqual([]);

    // A finding that only the Lead cites, or that only a returning entry names, is not shown by story or items: the usual wording stands.
    const lead: Edit = both(duplicate, (d) => { d.items = ["new-2"]; d.lead[1].refs = ["math-2026-0002"]; });
    expect(refUnknownOf(lead).map((i) => i.path)).toEqual(["returning[0].finding_id"]);
    expect(only(draftOf(CODE, lead)).message).toContain("Replace new-2 with math-2026-0002 in story or items");
    expect(only(draftOf(CODE, lead)).message).not.toContain("already in story or items");
  });

  it("when the context does not list the stored finding, says that no draft can name it and the new-N must go (DRAFT)", () => {
    // A finding briefed 60 days before D, which no list of the context holds (the context lists 30 days), has the title of new-1.
    const NAMED = "bio-2026-0070";
    const stored = records([storedFinding(NAMED, { title: l("alpha beta gamma delta epsilon"), artefacts: art(), first_brief: addDays(D, -60), briefs: [addDays(D, -60)] })]);
    const similar: Edit = (d) => { d.new_findings[0].title = "alpha beta gamma delta epsilon"; };
    const input = draftInput(similar, { stored });
    if (input.mode !== "draft") throw new Error("a draft input was expected");
    expect(input.draft.context.recent_findings.map((r) => r.id)).not.toContain(NAMED);
    const issue = only(draftOf(CODE, similar, { stored }));
    expect(issue.message).toContain(
      `new-1 duplicates the stored finding ${NAMED} ("alpha beta gamma delta epsilon"): their titles have a Jaccard similarity of 1 (from 0.6 counts) in the same field, biology. A finding that is already stored comes back only as a returning entry, but the context does not list ${NAMED}, so a draft cannot name it. Take new-1 out of story, items, the Lead's refs and new_findings.`,
    );
    expect(issue.message).not.toContain("Replace new-1");

    // What the message says: new-1 leaves story and the Lead and new_findings, and new-2 takes the story.
    const followed: Edit = both(similar, (d) => {
      d.story = "new-2";
      d.items = ["math-2026-0002"];
      for (const line of d.lead) line.refs = line.refs.filter((ref: string) => ref !== "new-1");
      d.new_findings = d.new_findings.filter((f: Json) => f.ref !== "new-1");
    });
    expect(draftOf(CODE, followed, { stored })).toEqual([]);
    expect(refUnknownOf(followed, { stored })).toEqual([]);

    // A finding that another list of the context shows (here a standing story's) may be named, whatever its age: the usual wording stands.
    const viaStory: Edit = both(similar, (_d, c) => { c.standing_stories.push({ id: "old-story", finding_ids: [NAMED], rule: "Return only on a newly solved problem." }); });
    const listedIssue = only(draftOf(CODE, viaStory, { stored }));
    expect(listedIssue.message).toContain(`Replace new-1 with ${NAMED} in story or items`);
    expect(listedIssue.message).not.toContain("does not list");
    // A draft that names the unlisted finding itself is judged by REF_UNKNOWN; DUPLICATE still says that the finding cannot come back.
    const named: Edit = both(similar, (d) => { d.items = ["new-2", NAMED]; });
    const namedIssue = only(draftOf(CODE, named, { stored }));
    expect(namedIssue.message).toContain(`the context does not list ${NAMED}, so a draft cannot name it. Take new-1 out of`);
    expect(namedIssue.message).not.toContain("already in story or items");

    // The usual wording names an id that REF_UNKNOWN refuses, in the story, the Lead and the entry.
    const replaced: Edit = both(similar, (d) => {
      d.story = NAMED;
      for (const line of d.lead) line.refs = line.refs.map((ref: string) => (ref === "new-1" ? NAMED : ref));
      d.new_findings = d.new_findings.filter((f: Json) => f.ref !== "new-1");
      d.returning.push({ finding_id: NAMED, update: "A new fact.", source_ids: ["b1"], rung: null });
    });
    const refused = refUnknownOf(replaced, { stored });
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((i) => i.message.includes("the context lists") || i.message.includes("the context does not list"))).toBe(true);
    expect(refused.map((i) => i.path)).toEqual(expect.arrayContaining(["story", "returning[1].finding_id"]));
  });

  it("reads a DOI as §4.1 stores it, whichever way each side writes it, and skips a string that is no DOI (DRAFT)", () => {
    const resolver = only(draftOf(CODE, both(mine({ doi: [DOI] }), theirs("chem-2026-0004", { doi: ["https://doi.org/10.1234/EXAMPLE.1"] }))));
    expect(resolver.message).toContain(`they share DOI ${DOI}.`);
    const labelled = only(draftOf(CODE, both(mine({ doi: ["DOI:10.1234/Example.1"] }), theirs("chem-2026-0004", { doi: [DOI] }))));
    expect(labelled.message).toContain(`they share DOI ${DOI}.`);
    // Two strings that are no DOI are no shared DOI, even when they are the same string.
    expect(draftOf(CODE, both(mine({ doi: ["not a doi"] }), theirs("chem-2026-0004", { doi: ["not a doi"] })))).toEqual([]);
    // A different DOI is a different paper.
    expect(draftOf(CODE, both(mine({ doi: [DOI] }), theirs("chem-2026-0004", { doi: ["10.1234/example.2"] })))).toEqual([]);
    expect(draftOf(CODE, both(mine({ doi: [DOI] }), theirs("chem-2026-0004", { doi: ["10.1235/example.1"] })))).toEqual([]);
  });

  it("points at the id it found, by its place in the finding's own list (DRAFT)", () => {
    const second = both(mine({ doi: ["10.9999/other", DOI] }), theirs("chem-2026-0004", { doi: [DOI] }));
    expect(only(draftOf(CODE, second)).path).toBe("new_findings[0].artefacts.doi[1]");
    const arxiv = both(mine({ arxiv: ["2611.00001", "2611.00002"] }), theirs("chem-2026-0004", { arxiv: ["2611.00002"] }));
    expect(only(draftOf(CODE, arxiv)).path).toBe("new_findings[0].artefacts.arxiv[1]");
    const trial = both(mine({ trial: ["NCT01234567", "NCT07654321"] }), theirs("chem-2026-0004", { trial: ["NCT07654321"] }));
    expect(only(draftOf(CODE, trial)).path).toBe("new_findings[0].artefacts.trial[1]");
    // The second new finding is judged at its own index.
    const other = both((d) => { d.new_findings[1].artefacts = art({ doi: [DOI] }); d.new_findings[0].artefacts = art(); }, theirs("chem-2026-0004", { doi: [DOI] }));
    expect(only(draftOf(CODE, other)).path).toBe("new_findings[1].artefacts.doi[0]");
    expect(only(draftOf(CODE, other)).message).toContain("new-2 duplicates the stored finding chem-2026-0004");
  });

  it("matches an arXiv id without its version, in any case, and an arXiv paper's own DOI as its arXiv id (DRAFT)", () => {
    const versions = only(draftOf(CODE, both(mine({ arxiv: ["2611.00002v3"] }), theirs("math-2026-0002", { arxiv: ["2611.00002v1"] }))));
    expect(versions.message).toContain("they share arXiv id 2611.00002.");
    expect(only(draftOf(CODE, both(mine({ arxiv: [" 2611.00002V2 "] }), theirs("math-2026-0002", { arxiv: ["2611.00002"] })))).message).toContain("arXiv id 2611.00002.");
    // A paper given as its 10.48550/arXiv DOI on one side and as an arXiv id on the other is one paper, at the place the new finding holds it.
    const doiSide = only(draftOf(CODE, both(mine({ doi: ["10.48550/arXiv.2611.00002"] }), theirs("math-2026-0002", { arxiv: ["2611.00002"] }))));
    expect(doiSide.path).toBe("new_findings[0].artefacts.doi[0]");
    expect(doiSide.message).toContain("they share arXiv id 2611.00002.");
    const idSide = only(draftOf(CODE, both(mine({ arxiv: ["2611.00002v2"] }), theirs("math-2026-0002", { doi: ["https://doi.org/10.48550/arxiv.2611.00002"] }))));
    expect(idSide.path).toBe("new_findings[0].artefacts.arxiv[0]");
    // Another paper, another version of nothing: no match.
    expect(draftOf(CODE, both(mine({ arxiv: ["2611.00020"] }), theirs("math-2026-0002", { arxiv: ["2611.00002"] })))).toEqual([]);
    expect(draftOf(CODE, both(mine({ doi: ["10.48550/arXiv.2611.00003"] }), theirs("math-2026-0002", { arxiv: ["2611.00002"] })))).toEqual([]);
    // A DOI that is no arXiv DOI is a DOI of its own, not an arXiv id.
    expect(draftOf(CODE, both(mine({ doi: ["10.4855/arxiv.2611.00002"] }), theirs("math-2026-0002", { arxiv: ["2611.00002"] })))).toEqual([]);
  });

  it("matches a trial id in any case and with spaces around it, and prints it once, trimmed and in capitals (DRAFT)", () => {
    const issue = only(draftOf(CODE, both(mine({ trial: ["nct09999001"] }), theirs("bio-2026-0001", { trial: ["NCT09999001"] }))));
    expect(issue.path).toBe("new_findings[0].artefacts.trial[0]");
    expect(issue.message).toContain("they share trial NCT09999001.");
    expect(draftOf(CODE, both(mine({ trial: ["NCT09999002"] }), theirs("bio-2026-0001", { trial: ["NCT09999001"] })))).toEqual([]);
    // Spaces on either side make no difference.
    const padded = only(draftOf(CODE, both(mine({ trial: ["  nct09999001 "] }), theirs("bio-2026-0001", { trial: ["NCT09999001"] }))));
    expect(padded.message).toContain("they share trial NCT09999001.");
    const theirSide = only(draftOf(CODE, both(mine({ trial: ["NCT09999001"] }), theirs("bio-2026-0001", { trial: [" nct09999001\t"] }))));
    expect(theirSide.message).toContain("they share trial NCT09999001.");
  });

  it("says each shared id once, in the order the new finding lists them, and reports one issue for one stored finding (DRAFT)", () => {
    const edit = both(
      mine({ doi: [DOI, `https://doi.org/${DOI.toUpperCase()}`], arxiv: ["2611.00002"], trial: ["NCT09999001"] }),
      theirs("bio-2026-0001", { doi: [DOI], arxiv: ["2611.00002v2"], trial: ["NCT09999001"] }),
    );
    const issue = only(draftOf(CODE, edit));
    expect(issue.path).toBe("new_findings[0].artefacts.doi[0]");
    expect(issue.message).toContain(`they share DOI ${DOI}, arXiv id 2611.00002, trial NCT09999001.`);
  });

  it("compares DOIs, arXiv ids and trial ids only, as the row lists them: a shared Lean file or PDB entry is no duplicate (DRAFT)", () => {
    const shared = { lean: ["https://example.org/lean/proof.lean"], pdb: ["1ABC"] };
    expect(draftOf(CODE, both(mine(shared), theirs("chem-2026-0004", shared)))).toEqual([]);
    // The same two together with a shared DOI: the DOI alone is what the message names.
    const withDoi = only(draftOf(CODE, both(mine({ ...shared, doi: [DOI] }), theirs("chem-2026-0004", { ...shared, doi: [DOI] }))));
    expect(withDoi.message).toContain(`they share DOI ${DOI}. `);
    expect(withDoi.message).not.toContain("pdb");
    expect(withDoi.message).not.toContain("lean");
  });

  it("leaves alone a view that lacks a title or its artefacts, and still judges the other findings (DRAFT)", () => {
    // new-1 shares its DOI with bio-2026-0001; new-2, an earth finding, shares its title with chem-2026-0004, filed under earth.
    const edit: Edit = (d, c) => {
      both(mine({ doi: [DOI] }), theirs("bio-2026-0001", { doi: [DOI] }))(d, c);
      d.new_findings[1].title = "alpha beta gamma";
      Object.assign(recentOf(c, "chem-2026-0004"), { title: "alpha beta gamma", field: "earth" });
    };
    const input = draftInput(edit);
    const patched = (key: string, patch: Partial<FindingView>): string[] => {
      const findings = input.views.findings.map((f) => (f.key === key ? ({ ...f, ...patch } as FindingView) : f));
      return paths(runRules({ ...input, views: { ...input.views, findings } }, [rule(CODE)]).filter((i) => i.code === CODE));
    };
    expect(patched("new-1", {})).toEqual(["new_findings[0].artefacts.doi[0]", "new_findings[1].title"]);
    // No artefacts to compare: new-1 is no duplicate by id, and new-2 is still judged by title.
    expect(patched("new-1", { artefacts: null })).toEqual(["new_findings[1].title"]);
    // No title to compare: new-2 is no duplicate by title, and new-1 is still judged by id.
    expect(patched("new-2", { title: null })).toEqual(["new_findings[0].artefacts.doi[0]"]);
    // A stored finding whose view has no title is not compared by title, and the one after it is.
    expect(patched("chem-2026-0004", { title: null })).toEqual(["new_findings[0].artefacts.doi[0]"]);
    expect(patched("bio-2026-0001", { artefacts: null })).toEqual(["new_findings[1].title"]);
  });

  it("reports one issue for each stored finding it duplicates, in the engine's order: by path, then message (DRAFT)", () => {
    const edit = both(theirs("chem-2026-0004", { doi: [DOI] }), theirs("bio-2026-0001", { doi: [DOI] }), theirs("math-2026-0002", { arxiv: ["2611.00002"] }), mine({ doi: [DOI], arxiv: ["2611.00002"] }));
    const issues = draftOf(CODE, edit);
    expect(paths(issues)).toEqual(["new_findings[0].artefacts.arxiv[0]", "new_findings[0].artefacts.doi[0]", "new_findings[0].artefacts.doi[0]"]);
    expect(foundIn(issues)).toEqual(["math-2026-0002", "bio-2026-0001", "chem-2026-0004"]);
  });

  it("fails a title with a Jaccard similarity of at least 0.6 in the same field, and passes one below it (DRAFT)", () => {
    // {alpha, beta, gamma} against five words: 3 / 5 = 0.6 exactly.
    const exact = only(draftOf(CODE, titles("alpha beta gamma", "alpha beta gamma delta epsilon")));
    expect(exact.path).toBe("new_findings[0].title");
    expect(exact.message).toBe(
      `new-1 duplicates the stored finding chem-2026-0004 ("alpha beta gamma delta epsilon"): their titles have a Jaccard similarity of 0.6 (from 0.6 counts) in the same field, biology. A finding that is already stored comes back only as a returning entry. Replace new-1 with chem-2026-0004 in story or items and in the Lead's refs, delete new-1 from new_findings, and add an entry to returning for chem-2026-0004: its update (at most 60 words) and the sources that show the new facts. If there are no new facts, take new-1 out of story, items, the Lead's refs and new_findings instead.`,
    );
    // 3 / 6 = 0.5.
    expect(draftOf(CODE, titles("alpha beta gamma", "alpha beta gamma delta epsilon zeta"))).toEqual([]);
    // 0.75, 4 / 6 (printed to two places) and identical titles (1).
    expect(only(draftOf(CODE, titles("alpha beta gamma", "alpha beta gamma delta"))).message).toContain("a Jaccard similarity of 0.75 (from 0.6 counts)");
    expect(only(draftOf(CODE, titles("alpha beta gamma delta", "alpha beta gamma delta epsilon zeta"))).message).toContain("a Jaccard similarity of 0.67 (");
    expect(only(draftOf(CODE, titles("alpha beta gamma", "Alpha, beta; gamma!"))).message).toContain("a Jaccard similarity of 1 (");
  });

  it("compares a title only within one field, as the stored finding is filed with the draft's own corrections (DRAFT)", () => {
    // phys-2026-0003 is physics in the context and the Tuesday files it under chemistry: neither is biology, new-1's field.
    const physics: Edit = (d, c) => { d.new_findings[0].title = "alpha beta gamma"; recentOf(c, "phys-2026-0003").title = "alpha beta gamma"; };
    expect(draftOf(CODE, physics)).toEqual([]);
    // chem-2026-0004 in its own field is not biology either.
    expect(draftOf(CODE, (d, c) => { d.new_findings[0].title = "alpha beta gamma"; recentOf(c, "chem-2026-0004").title = "alpha beta gamma"; })).toEqual([]);
    // A draft correction that files phys-2026-0003 under biology (the later correction wins) makes it the same field: now a duplicate.
    const toBiology: Edit = (d) => { d.corrections.push(draftCorrection("phys-2026-0003", "field", "biology")); };
    const issue = only(draftOf(CODE, both(physics, toBiology)));
    expect(issue.message).toContain("duplicates the stored finding phys-2026-0003");
    expect(issue.message).toContain("in the same field, biology.");
    // The other way: chem-2026-0004 filed under biology (as `titles` does) is a duplicate, and a correction that files it under physics takes it out of the field.
    expect(only(draftOf(CODE, titles("alpha beta gamma", "alpha beta gamma"))).message).toContain("duplicates the stored finding chem-2026-0004");
    const toPhysics: Edit = (d) => { d.corrections.push(draftCorrection("chem-2026-0004", "field", "physics")); };
    expect(draftOf(CODE, both(titles("alpha beta gamma", "alpha beta gamma"), toPhysics))).toEqual([]);
  });

  it("compares the titles of the week's findings and of every recent one, and of no other finding the context shows (DRAFT)", () => {
    // A Monday's week: a finding only in `week` counts, in the field the week gives it (the frame's week findings are all mathematics).
    const monday: Edit = (d, c) => {
      Object.assign(c, structuredClone(mondayContext(3)));
      c.recent_findings = c.recent_findings.filter((r: Json) => r.id !== "chem-2026-0004");
      c.week.findings[2].title = "alpha beta gamma delta";
      d.new_findings[0].field = "mathematics";
      d.new_findings[0].subfield = "formal-proof";
      d.new_findings[0].title = "alpha beta gamma";
    };
    const week = only(draftOf(CODE, monday));
    expect(week.message).toContain('duplicates the stored finding chem-2026-0004 ("alpha beta gamma delta")');
    expect(week.message).toContain("in the same field, mathematics.");

    // A Sunday's candidate comes from the whole Ledger: nothing says it was briefed in the last 90 days, so its title is not compared.
    const sunday: Edit = (d, c) => {
      Object.assign(c, structuredClone(sundayContext()));
      c.ledger_for_sunday[0].title = "alpha beta gamma";
      d.new_findings[0].title = "alpha beta gamma";
    };
    expect(draftOf(CODE, sunday)).toEqual([]);

    // A report's finding is no more known to be recent: only a finding that the context lists as recent or in the week is.
    const report: Edit = (d, c) => {
      c.recent_findings = c.recent_findings.filter((r: Json) => r.id !== "bio-2026-0001");
      c.reports[0].finding.title = "alpha beta gamma";
      d.new_findings[0].title = "alpha beta gamma";
    };
    expect(draftOf(CODE, report)).toEqual([]);
    // The same text on a recent finding is compared.
    expect(only(draftOf(CODE, titles("alpha beta gamma", "alpha beta gamma"))).path).toBe("new_findings[0].title");
  });

  it("compares no id of a finding the context shows without artefacts: a week, Ledger or report finding has none (DRAFT)", () => {
    const edit: Edit = (d, c) => {
      Object.assign(c, structuredClone(mondayContext(3)));
      c.recent_findings = [];
      d.new_findings[0].artefacts = art({ doi: [DOI] });
    };
    expect(draftOf(CODE, edit)).toEqual([]);
  });

  // ── The stored records a run was given (`DraftInputs.stored`) ──────────────────────────────────

  describe("with the stored records the run was given", () => {
    const NAMED = "bio-2026-0070"; // a stored biology finding that no context list shows: only a draft correction names it
    const namesOf = (id: string): Edit => (d) => { d.corrections.push(draftCorrection(id, "explainer.background", "A clearer background.", { type: "clarification" })); };
    const names = namesOf(NAMED);
    const record = (over: Json = {}, id = NAMED): Finding => {
      const briefs: string[] = over.briefs ?? [D];
      return storedFinding(id, { title: l("alpha beta gamma delta epsilon"), artefacts: art(), first_brief: briefs[0] ?? null, ...over });
    };
    const given = (...findings: Finding[]): Partial<DraftInputs> => ({ stored: records(findings) });
    const similar: Edit = (d) => { d.new_findings[0].title = "alpha beta gamma"; };

    it("compares the ids of a finding of any age, as its record gives them (DRAFT)", () => {
      const old = record({ briefs: ["2026-01-05"], artefacts: art({ doi: [DOI] }) });
      const issue = only(draftOf(CODE, names, given(old)));
      expect(issue.path).toBe("new_findings[0].artefacts.doi[0]");
      expect(issue.message).toContain(`new-1 duplicates the stored finding ${NAMED} ("alpha beta gamma delta epsilon"): they share DOI ${DOI}. `);
      // Without the record the run sees the finding only as a correction names it: no id, no title.
      expect(draftOf(CODE, names)).toEqual([]);
      // A record that does not hold the id is no duplicate.
      expect(draftOf(CODE, names, given(record({ briefs: ["2026-01-05"] })))).toEqual([]);
    });

    it("compares a title when the record says it was briefed within the last 90 days, counted from D, and not before (DRAFT)", () => {
      const edit = both(names, similar);
      const within = (...briefs: string[]): Partial<DraftInputs> => given(record({ briefs }));
      const exact = only(draftOf(CODE, edit, within(addDays(D, -90))));
      expect(exact.path).toBe("new_findings[0].title");
      expect(exact.message).toContain(`duplicates the stored finding ${NAMED}`);
      expect(draftOf(CODE, edit, within(addDays(D, -91)))).toEqual([]);
      expect(draftOf(CODE, edit, within(addDays(D, -200), addDays(D, -30)))).toHaveLength(1);
      expect(draftOf(CODE, edit, within(addDays(D, -200), addDays(D, -120)))).toEqual([]);
      expect(draftOf(CODE, edit, within(D))).toHaveLength(1);
      // A brief dated after D (a dry run of a past date, with later content on disk) is no part of D's last 90 days; an earlier one is.
      expect(draftOf(CODE, edit, within(addDays(D, 1)))).toEqual([]);
      expect(draftOf(CODE, edit, within(addDays(D, -200), addDays(D, 3)))).toEqual([]);
      expect(draftOf(CODE, edit, within(addDays(D, -5), addDays(D, 3)))).toHaveLength(1);
      // A record with no brief at all (briefs empty, first_brief null) was never briefed.
      expect(draftOf(CODE, edit, given(record({ briefs: [], first_brief: null, history: true })))).toEqual([]);
      // The 90 days are counted from the run's date: a Sunday's context is dated 2026-11-22.
      const sunday: Edit = (d, c) => { Object.assign(c, structuredClone(sundayContext())); similar(d, c); names(d, c); };
      expect(draftOf(CODE, sunday, within(addDays(SUNDAY, -90)))).toHaveLength(1);
      expect(draftOf(CODE, sunday, within(addDays(SUNDAY, -91)))).toEqual([]);
    });

    it("compares a title in the field the record is filed under with the draft's corrections (DRAFT)", () => {
      const edit = both(names, similar);
      expect(draftOf(CODE, edit, given(record()))).toHaveLength(1);
      // A correction that files the biology record under physics takes it out of new-1's field.
      expect(draftOf(CODE, both(edit, (d) => { d.corrections.push(draftCorrection(NAMED, "field", "physics")); }), given(record()))).toEqual([]);
      // A physics record is not compared, unless a correction files it under biology.
      const PHYS = "phys-2026-0070";
      const physics = given(record({}, PHYS));
      const both2 = both(namesOf(PHYS), similar);
      expect(draftOf(CODE, both2, physics)).toEqual([]);
      const refiled = both(both2, (d) => { d.corrections.push(draftCorrection(PHYS, "field", "biology")); });
      expect(only(draftOf(CODE, refiled, physics)).message).toContain(`duplicates the stored finding ${PHYS}`);
    });

    it("uses the record where the context also lists the finding, and merges what an id and a title find into one issue (DRAFT)", () => {
      // storedFinding() has new-1's title and DOI: bio-2026-0001 is recent in the context (with no artefacts), and the record is the fuller view.
      const issue = only(draftOf(CODE, undefined, given(storedFinding("bio-2026-0001"))));
      expect(issue.path).toBe("new_findings[0].artefacts.doi[0]");
      expect(issue.message).toContain(`duplicates the stored finding bio-2026-0001 ("A sample protein result"): they share DOI ${DOI}, and their titles have a Jaccard similarity of 1 (from 0.6 counts) in the same field, biology. `);
    });

    it("skips a title that a stored `removed` correction rewrote, and says nothing of it, but still compares the ids (DRAFT)", () => {
      const removed = (id: string): Correction => correction(id, "2026-11-01", NAMED, "title", REMOVED_TEXT.en, { type: "removed", before: REMOVED_BEFORE, after: REMOVED_TEXT });
      const edit = both(names, similar);
      const withRemoved = (r: Finding): Partial<DraftInputs> => ({ stored: records([r], [removed("C-0001")]) });
      const gone = { title: { ...REMOVED_TEXT } };
      expect(draftOf(CODE, edit, given(record()))).toHaveLength(1);
      expect(draftOf(CODE, edit, withRemoved(record(gone)))).toEqual([]);
      // The correction alone skips nothing: a title that still holds other text, or the marker in one language only, is compared as any other.
      expect(draftOf(CODE, edit, withRemoved(record()))).toHaveLength(1);
      expect(draftOf(CODE, edit, withRemoved(record({ title: { en: "alpha beta gamma delta epsilon", zh: REMOVED_TEXT.zh } })))).toHaveLength(1);
      // A removed correction of another finding, or of another path, is not this title's.
      const other = correction("C-0002", "2026-11-01", NAMED, "explainer.how_sure", REMOVED_TEXT.en, { type: "removed", before: REMOVED_BEFORE, after: REMOVED_TEXT });
      expect(draftOf(CODE, edit, { stored: records([record()], [other]) })).toHaveLength(1);
      const another = correction("C-0003", "2026-11-01", "bio-2026-0001", "title", REMOVED_TEXT.en, { type: "removed", before: REMOVED_BEFORE, after: REMOVED_TEXT });
      expect(draftOf(CODE, edit, { stored: records([record()], [another]) })).toHaveLength(1);
      // The ids are not text: the same DOI still makes a duplicate, and the removed title is not quoted.
      const byId = only(draftOf(CODE, edit, withRemoved(record({ ...gone, artefacts: art({ doi: [DOI] }) }))));
      expect(byId.message).toContain(`duplicates the stored finding ${NAMED}: they share DOI ${DOI}. `);
      expect(byId.message).not.toContain("(\"");
    });

    it("hands the rules the stored records as the run was given them, and null when it was given none (DRAFT)", () => {
      const stored = records([record()]);
      const withStored = draftInput(undefined, { stored });
      const without = draftInput();
      const nulled = draftInput(undefined, { stored: null });
      if (withStored.mode !== "draft" || without.mode !== "draft" || nulled.mode !== "draft") throw new Error("a draft input was expected");
      expect(withStored.draft.stored).toBe(stored);
      expect(without.draft.stored).toBeNull();
      expect(nulled.draft.stored).toBeNull();
    });

    // ── A record that the draft names nowhere and the context does not list: no view, compared all the same ──

    describe("a record that the draft names nowhere and the context does not list", () => {
      /** The record, briefed `days` days before D (and any other field of it replaced). */
      const aged = (days: number, over: Json = {}, id = NAMED): Partial<DraftInputs> => given(record({ briefs: [addDays(D, -days)], ...over }, id));
      const removedTitle = (id = NAMED, date = "2026-11-01"): Correction =>
        correction("C-0001", date, id, "title", REMOVED_TEXT.en, { type: "removed", before: REMOVED_BEFORE, after: REMOVED_TEXT });

      it("is compared by title when it was briefed within the last 90 days, though no list of the context holds it (DRAFT)", () => {
        const issue = only(draftOf(CODE, similar, aged(60)));
        expect(issue.path).toBe("new_findings[0].title");
        expect(issue.severity).toBe("error");
        expect(issue.message).toContain(
          `new-1 duplicates the stored finding ${NAMED} ("alpha beta gamma delta epsilon"): their titles have a Jaccard similarity of 0.6 (from 0.6 counts) in the same field, biology. `,
        );
        // Its text is no more than a title to compare: the record is read, not judged, and the roster has no view of it.
        const input = draftInput(similar, aged(60));
        expect(input.views.find(NAMED)).toBeNull();
        expect(input.views.findings.map((g) => g.key)).not.toContain(NAMED);
        // A run that was not given the record cannot see it: with the stored records absent, null or empty the draft passes.
        expect(draftOf(CODE, similar)).toEqual([]);
        expect(draftOf(CODE, similar, { stored: null })).toEqual([]);
        expect(draftOf(CODE, similar, { stored: records() })).toEqual([]);
      });

      it("is compared by id whatever its age, as a view of it would be (DRAFT)", () => {
        const issue = only(draftOf(CODE, undefined, aged(300, { artefacts: art({ doi: [DOI] }) })));
        expect(issue.path).toBe("new_findings[0].artefacts.doi[0]");
        expect(issue.message).toContain(`new-1 duplicates the stored finding ${NAMED} ("alpha beta gamma delta epsilon"): they share DOI ${DOI}. `);
        const arxiv = only(draftOf(CODE, (d) => { d.new_findings[0].artefacts = art({ arxiv: ["2611.00002v2"] }); }, aged(300, { artefacts: art({ arxiv: ["2611.00002"] }) })));
        expect(arxiv.path).toBe("new_findings[0].artefacts.arxiv[0]");
        expect(arxiv.message).toContain("they share arXiv id 2611.00002. ");
        // A record that does not hold the id is no duplicate, and nor is a title that is not alike.
        expect(draftOf(CODE, undefined, aged(300))).toEqual([]);
        expect(draftOf(CODE, undefined, aged(20))).toEqual([]);
      });

      it("counts the 90 days from D with both ends in, so that day 30, 31 and 90 compare and day 91 does not (DRAFT)", () => {
        for (const days of [0, 1, 29, 30, 31, 32, 60, 89, 90]) expect(draftOf(CODE, similar, aged(days)), `day ${days}`).toHaveLength(1);
        for (const days of [91, 92, 120, 300]) expect(draftOf(CODE, similar, aged(days)), `day ${days}`).toEqual([]);
        // A brief after D (a dry run of a past date, with later content on disk) is no part of D's last 90 days.
        expect(draftOf(CODE, similar, aged(-1))).toEqual([]);
        // The 90 days are counted from the run's own date, a Sunday's here.
        const sunday: Edit = (d, c) => { Object.assign(c, structuredClone(sundayContext())); similar(d, c); };
        const sundayAged = (days: number): Partial<DraftInputs> => given(record({ briefs: [addDays(SUNDAY, -days)] }));
        expect(draftOf(CODE, sunday, sundayAged(90))).toHaveLength(1);
        expect(draftOf(CODE, sunday, sundayAged(91))).toEqual([]);
      });

      it("is dated by every brief that carried it, not by its first alone, and a record never briefed is dated by none (DRAFT)", () => {
        const within = (...briefs: string[]): Partial<DraftInputs> => given(record({ briefs }));
        expect(draftOf(CODE, similar, within(addDays(D, -200), addDays(D, -45)))).toHaveLength(1);
        expect(draftOf(CODE, similar, within(addDays(D, -200), addDays(D, -120)))).toEqual([]);
        expect(draftOf(CODE, similar, within(addDays(D, -5), addDays(D, 3)))).toHaveLength(1);
        expect(draftOf(CODE, similar, within(addDays(D, -200), addDays(D, 3)))).toEqual([]);
        expect(draftOf(CODE, similar, given(record({ briefs: [], first_brief: null, history: true })))).toEqual([]);
      });

      it("is compared in the field it is filed under on D, with the stored corrections and the draft's own, and not in the field it was first filed under (DRAFT)", () => {
        const refile = (id: string, field: string, date: string): Correction => correction("C-0007", date, id, "field", field);
        // A stored correction before D files the biology record under physics, out of new-1's field.
        expect(draftOf(CODE, similar, { stored: records([record({ briefs: [addDays(D, -60)] })], [refile(NAMED, "physics", "2026-11-01")]) })).toEqual([]);
        // The same correction dated D files it too; one dated after D is not yet in force.
        expect(draftOf(CODE, similar, { stored: records([record({ briefs: [addDays(D, -60)] })], [refile(NAMED, "physics", D)]) })).toEqual([]);
        expect(draftOf(CODE, similar, { stored: records([record({ briefs: [addDays(D, -60)] })], [refile(NAMED, "physics", addDays(D, 1))]) })).toHaveLength(1);
        // A correction of another finding files nothing here.
        expect(draftOf(CODE, similar, { stored: records([record({ briefs: [addDays(D, -60)] })], [refile("bio-2026-0001", "physics", "2026-11-01")]) })).toHaveLength(1);
        // A physics record is out of new-1's field until a correction files it under biology.
        const PHYS = "phys-2026-0070";
        const physics = record({ briefs: [addDays(D, -60)] }, PHYS);
        expect(draftOf(CODE, similar, { stored: records([physics]) })).toEqual([]);
        const refiled = only(draftOf(CODE, similar, { stored: records([physics], [refile(PHYS, "biology", "2026-11-01")]) }));
        expect(refiled.message).toContain(`duplicates the stored finding ${PHYS} ("alpha beta gamma delta epsilon")`);
        expect(refiled.message).toContain("in the same field, biology.");
      });

      it("skips a title that a stored `removed` correction rewrote, and does not quote it, but still compares the ids (DRAFT)", () => {
        const withRemoved = (over: Json = {}, ...corrections: Correction[]): Partial<DraftInputs> =>
          ({ stored: records([record({ briefs: [addDays(D, -60)], ...over })], corrections) });
        const gone = { title: { ...REMOVED_TEXT } };
        expect(draftOf(CODE, similar, withRemoved())).toHaveLength(1);
        expect(draftOf(CODE, similar, withRemoved(gone, removedTitle()))).toEqual([]);
        // The correction alone skips nothing: a title that still holds other text is compared as any other.
        expect(draftOf(CODE, similar, withRemoved({}, removedTitle()))).toHaveLength(1);
        // A removed correction of another finding, or of another path of this one, is not this title's.
        expect(draftOf(CODE, similar, withRemoved({}, removedTitle("bio-2026-0001")))).toHaveLength(1);
        const sourceTitle = correction("C-0002", "2026-11-01", NAMED, "explainer.how_sure", REMOVED_TEXT.en, { type: "removed", before: REMOVED_BEFORE, after: REMOVED_TEXT });
        expect(draftOf(CODE, similar, withRemoved({}, sourceTitle))).toHaveLength(1);
        const byId = only(draftOf(CODE, similar, withRemoved({ ...gone, artefacts: art({ doi: [DOI] }) }, removedTitle())));
        expect(byId.message).toContain(`duplicates the stored finding ${NAMED}: they share DOI ${DOI}. `);
        expect(byId.message).not.toContain("(\"");
      });

      it("is compared once: when the draft also names it, when the context also lists it, and when the run was given it twice (DRAFT)", () => {
        const stored = record({ briefs: [addDays(D, -60)] });
        expect(only(draftOf(CODE, both(names, similar), given(stored))).message).toContain(`duplicates the stored finding ${NAMED}`);
        // bio-2026-0001 is a recent finding of the context: its record is its view, and the record given is not a second finding.
        const listed = storedFinding("bio-2026-0001", { title: l("alpha beta gamma delta epsilon"), artefacts: art() });
        expect(foundIn(draftOf(CODE, similar, given(listed)))).toEqual(["bio-2026-0001"]);
        expect(foundIn(draftOf(CODE, similar, { stored: records([stored, stored]) }))).toEqual([NAMED]);
        // The view stands for its record: the context lists bio-2026-0001 as recent, so its title is compared whatever the record's own briefs say.
        const contradicting = storedFinding("bio-2026-0001", {
          title: l("alpha beta gamma delta epsilon"), artefacts: art({ doi: [DOI] }), first_published: "2026-05-01", first_brief: "2026-05-08", briefs: ["2026-05-08"],
        });
        expect(only(draftOf(CODE, similar, given(contradicting))).message).toContain(`they share DOI ${DOI}, and their titles have a Jaccard similarity of 0.6 `);
        // A record given twice is read once, as it was first given.
        const stale = record({ briefs: [addDays(D, -200)] });
        expect(foundIn(draftOf(CODE, similar, { stored: records([stored, stale]) }))).toEqual([NAMED]);
        expect(draftOf(CODE, similar, { stored: records([stale, stored]) })).toEqual([]);
        // Two records are two findings, in the engine's order.
        const second = record({ briefs: [addDays(D, -61)] }, "bio-2026-0071");
        expect(foundIn(draftOf(CODE, similar, { stored: records([second, stored]) }))).toEqual([NAMED, "bio-2026-0071"]);
      });

      it("names the record's title for a stored finding that the pack matched, and joins the pack's reason to the title's (DRAFT)", () => {
        const matched = (p: Json): void => { p.candidates[0].stored_finding = NAMED; };
        const viaPack: Partial<DraftInputs> = { ...aged(60), pack: packWith(matched) };
        const issue = only(draftOf(CODE, undefined, viaPack));
        expect(issue.message).toContain(`new-1 duplicates the stored finding ${NAMED} ("alpha beta gamma delta epsilon"): they share DOI ${DOI} (the pack's candidate cand-01 matched it). `);
        const both2 = only(draftOf(CODE, similar, viaPack));
        expect(both2.message).toContain(`they share DOI ${DOI} (the pack's candidate cand-01 matched it), and their titles have a Jaccard similarity of 0.6 `);
        // Its title is not quoted where a stored `removed` correction rewrote it.
        const removed = only(draftOf(CODE, undefined, { ...viaPack, stored: records([record({ briefs: [addDays(D, -60)], title: { ...REMOVED_TEXT } })], [removedTitle()]) }));
        expect(removed.message).toContain(`duplicates the stored finding ${NAMED}: they share DOI ${DOI} (the pack's candidate cand-01 matched it). `);
      });

      it("reads each title's words once, so that a title of 100,000 characters costs no more than itself against 700 stored findings (DRAFT)", () => {
        const long = Array.from({ length: 20_000 }, (_, i) => `w${i}`).join(" ").slice(0, 100_000);
        const stored = Array.from({ length: 700 }, (_, i) => record({ briefs: [addDays(D, -30)], title: l(`t${i}a t${i}b t${i}c t${i}d`) }, `bio-2026-${String(100 + i).padStart(4, "0")}`));
        const started = performance.now();
        const issues = draftOf(CODE, (d) => { d.new_findings[0].title = long; }, { stored: records(stored) });
        expect(issues).toEqual([]);
        expect(performance.now() - started).toBeLessThan(2500);
        // The same stored findings still find a title that is like theirs, one of them.
        const found = draftOf(CODE, (d) => { d.new_findings[0].title = "t345a t345b t345c"; }, { stored: records(stored) });
        expect(only(found).message).toContain("duplicates the stored finding bio-2026-0445 (\"t345a t345b t345c t345d\"): their titles have a Jaccard similarity of 0.75 ");
      });

      it("prints at most 120 characters of the stored title it names, whole code points, so that the message stays short whatever the record holds (DRAFT)", () => {
        const sharing = (title: string): Partial<DraftInputs> => given(record({ briefs: [addDays(D, -60)], title: l(title), artefacts: art({ doi: [DOI] }) }));
        const quoted = (title: string): string => /duplicates the stored finding \S+ \("(.*)"\): they share/u.exec(only(draftOf(CODE, undefined, sharing(title))).message)![1]!;
        expect(quoted("a".repeat(120))).toBe("a".repeat(120));
        expect(quoted("a".repeat(121))).toBe(`${"a".repeat(117)}...`);
        const long = quoted("b".repeat(5000));
        expect(long).toBe(`${"b".repeat(117)}...`);
        expect(only(draftOf(CODE, undefined, sharing("b".repeat(5000)))).message.length).toBeLessThan(700);
        // A character outside the Basic Multilingual Plane counts as one and is never cut in two.
        const astral = "\u{1d4b3}";
        expect(quoted(astral.repeat(120))).toBe(astral.repeat(120));
        expect(quoted(astral.repeat(121))).toBe(`${astral.repeat(117)}...`);
      });

      it("is read by a draft run only: a published run, given the same records, never runs DUPLICATE (DRAFT; PUBLISHED, both record sets)", () => {
        const c = content();
        const unlisted = record({ briefs: [addDays(D, -60)], artefacts: art({ doi: [DOI] }) });
        c.findings.push(unlisted);
        expect(only(draftOf(CODE, similar, given(unlisted))).message).toContain(`duplicates the stored finding ${NAMED}`);
        for (const publishing of [D, null]) {
          const input = publishedInput(c, publishing);
          expect(runRules(input, historyRules).filter((i) => i.code === CODE), String(publishing)).toEqual([]);
          expect(rule(CODE).check(input), String(publishing)).toEqual([]);
        }
      });
    });
  });

  // ── The pack's `stored_finding` ───────────────────────────────────────────────────────────────

  describe("with the pack's candidates that are stored findings", () => {
    const fromPack = (edit: (p: Json) => void): Partial<DraftInputs> => ({ pack: packWith(edit) });
    const stored = (id: string): ((p: Json) => void) => (p) => { p.candidates[0].stored_finding = id; };

    it("fails a new finding that shares an id with a candidate the pack matched to a stored finding of any age (DRAFT)", () => {
      const issue = only(draftOf(CODE, undefined, fromPack(stored("bio-2026-0001"))));
      expect(issue.path).toBe("new_findings[0].artefacts.doi[0]");
      expect(issue.message).toContain(`new-1 duplicates the stored finding bio-2026-0001 ("`);
      expect(issue.message).toContain(`): they share DOI ${DOI} (the pack's candidate cand-01 matched it). `);
      // A stored finding that no list of the context shows is named by its id alone.
      const unseen = only(draftOf(CODE, undefined, fromPack(stored("soc-2026-0150"))));
      expect(unseen.message).toContain(`new-1 duplicates the stored finding soc-2026-0150: they share DOI ${DOI} (the pack's candidate cand-01 matched it). `);
    });

    it("reads the candidate's DOI, arXiv id and trial ids as it reads a finding's (DRAFT)", () => {
      const only1 = (over: Json): Partial<DraftInputs> => fromPack((p) => { Object.assign(p.candidates[0], { doi: null, arxiv: null, trial: [], stored_finding: "bio-2026-0001", ...over }); });
      const arxiv = only(draftOf(CODE, mine({ arxiv: ["2611.00002v4"] }), only1({ arxiv: "2611.00002" })));
      expect(arxiv.path).toBe("new_findings[0].artefacts.arxiv[0]");
      expect(arxiv.message).toContain("they share arXiv id 2611.00002 (the pack's candidate cand-01 matched it).");
      const trial = only(draftOf(CODE, mine({ trial: ["NCT09999001"] }), only1({ trial: ["NCT01234567", "NCT09999001"] })));
      expect(trial.path).toBe("new_findings[0].artefacts.trial[0]");
      expect(trial.message).toContain("they share trial NCT09999001 (the pack's");
      const arxivDoi = only(draftOf(CODE, mine({ doi: ["10.48550/arXiv.2611.00002"] }), only1({ arxiv: "2611.00002v1" })));
      expect(arxivDoi.message).toContain("they share arXiv id 2611.00002 (the pack's");
      expect(draftOf(CODE, mine({ doi: [DOI] }), only1({ doi: "10.1234/example.2" }))).toEqual([]);
      expect(draftOf(CODE, mine({ arxiv: ["2611.00002"] }), only1({ arxiv: "2611.00003" }))).toEqual([]);
    });

    it("counts a candidate that is no stored finding for nothing, and a stored one that shares no id for nothing (DRAFT)", () => {
      expect(draftOf(CODE)).toEqual([]);
      expect(draftOf(CODE, undefined, fromPack((p) => { p.candidates[0].stored_finding = "bio-2026-0001"; p.candidates[0].doi = "10.1234/example.2"; }))).toEqual([]);
    });

    it("looks at every candidate: one that is no stored finding, or shares no id, does not end the search (DRAFT)", () => {
      // cand-01 holds new-1's DOI and is no stored finding; cand-02 is a stored finding with another DOI; cand-03 is one with new-1's DOI.
      const extra = (p: Json): void => {
        p.candidates.push({ ...structuredClone(p.candidates[0]), id: "cand-02", url: "https://example.org/paper/8", doi: "10.1234/example.8", stored_finding: "chem-2026-0004" });
        p.candidates.push({ ...structuredClone(p.candidates[0]), id: "cand-03", url: "https://example.org/paper/9", doi: DOI, stored_finding: "bio-2026-0001" });
      };
      const issue = only(draftOf(CODE, undefined, fromPack(extra)));
      expect(issue.message).toContain("duplicates the stored finding bio-2026-0001");
      expect(issue.message).toContain(`they share DOI ${DOI} (the pack's candidate cand-03 matched it). `);
    });

    it("names every candidate that matched, once each, and joins the pack to what the context found for the same stored finding (DRAFT)", () => {
      const second = (p: Json): void => {
        p.candidates[0].stored_finding = "chem-2026-0004";
        p.candidates.push({ ...structuredClone(p.candidates[0]), id: "cand-02", url: "https://example.org/paper/9", doi: DOI });
      };
      const two = only(draftOf(CODE, undefined, fromPack(second)));
      expect(two.message).toContain("(the pack's candidates cand-01, cand-02 matched it)");
      // The same stored finding found through the context and the pack is one issue, with both reasons.
      const joined = only(draftOf(CODE, theirs("chem-2026-0004", { doi: [DOI] }), fromPack(second)));
      expect(joined.message).toContain(`they share DOI ${DOI} (the pack's candidates cand-01, cand-02 matched it). `);
    });

    it("names the candidates that matched in id order, whichever order the pack lists them (DRAFT)", () => {
      const reversed = (p: Json): void => {
        p.candidates[0].stored_finding = "chem-2026-0004";
        p.candidates.unshift({ ...structuredClone(p.candidates[0]), id: "cand-02", url: "https://example.org/paper/9", doi: DOI });
      };
      expect(only(draftOf(CODE, undefined, fromPack(reversed))).message).toContain("(the pack's candidates cand-01, cand-02 matched it)");
    });

    it("skips the pack without it, and the engine says that the check ran without it (DRAFT)", () => {
      // The context's own recent findings are still compared; the pack's stored findings are not.
      expect(draftOf(CODE, undefined, { pack: null })).toEqual([]);
      const found = draftRun(theirs("chem-2026-0004", { doi: [DOI] }), { pack: null });
      expect(found.map((i) => i.code).sort()).toEqual(["DUPLICATE", "INPUT_MISSING"]);
      const missing = found.find((i) => i.code === "INPUT_MISSING")!;
      expect(missing.severity).toBe("warning");
      expect(missing.path).toBe("(pack)");
      expect(missing.message).toBe(`No source pack for ${D}, so 2 checks ran without it: DUPLICATE, RETURN_NEW_FACT.`);
    });
  });

  // ── Modes ─────────────────────────────────────────────────────────────────────────────────────

  it("runs in draft mode only: stored findings that share a DOI and a title are no issue of a published run, being published or not (PUBLISHED, both record sets)", () => {
    const c = content();
    c.findings.push(storedFinding("bio-2026-0010", { title: l("A sample protein result"), first_brief: D, briefs: [D] })); // bio-2026-0001's DOI and title
    for (const publishing of [D, null, "2026-11-10"]) {
      const input = publishedInput(c, publishing);
      expect(runRules(input, historyRules).filter((i) => i.code === CODE), String(publishing)).toEqual([]);
      expect(rule(CODE).check(input), String(publishing)).toEqual([]);
    }
  });
});

// ── RETURN_NEW_FACT ──────────────────────────────────────────────────────────────────────────────

describe("RETURN_NEW_FACT, in draft mode", () => {
  const CODE = "RETURN_NEW_FACT";
  const FINDING = "math-2026-0002";
  const SPAN = "2026-11-21 04:00 to 2026-11-24 03:00 Taipei (the pack window and 48 hours of lookback)"; // the Tuesday's window and run.pack.lookback_hours
  const brief = (id: string, over: Json = {}): Json => ({
    id, kind: "statement", title: `A made-up statement ${id}`, publisher: "Example Institute", url: `https://example.org/statement/${id}`, doi: null,
    published_at: "2026-11-23", ...over,
  });
  /** Changes b1, the source the Tuesday's returning entry cites. */
  const b1 = (over: Json): Edit => (d) => { Object.assign(d.sources[0], over); };
  const dated = (published_at: string | null): Edit => b1({ published_at });
  const cites = (...ids: string[]): Edit => (d) => { d.returning[0].source_ids = ids; };
  const both = (...edits: Edit[]): Edit => (d, c) => { for (const e of edits) e(d, c); };
  /** The Tuesday's returning entry with none of a standing story's new facts: no rung of its own, and no correction of math-2026-0002. */
  const bare: Edit = (d) => {
    d.returning[0].rung = null;
    d.corrections = d.corrections.filter((x: Json) => x.finding_id !== FINDING);
  };
  const withConfig = (lookback: number): Partial<DraftInputs> => {
    const c = config();
    return { config: { ...c, run: { ...c.run, pack: { ...c.run.pack, lookback_hours: lookback } } } };
  };
  const dateIssue = (when: string | null, over?: Partial<DraftInputs>): ValidationIssue[] => draftOf(CODE, dated(when), over);

  it("passes the Tuesday: b1 is dated within the window, and the standing story math-2026-0002 has its rung and a correction (DRAFT)", () => {
    expect(draftOf(CODE)).toEqual([]);
    const draft = world().draft;
    expect(draft.returning[0].finding_id).toBe(FINDING);
    expect(world().context.standing_stories[0].finding_ids).toContain(FINDING);
  });

  it("fails a returning entry that cites no source added this run, and says what to add (DRAFT)", () => {
    const issue = only(draftOf(CODE, cites()));
    expect(issue.code).toBe(CODE);
    expect(issue.severity).toBe("error");
    expect(issue.path).toBe("returning[0].source_ids");
    expect(issue.message).toBe(
      `returning[0] (${FINDING}) cites no source added this run: its source_ids is empty. A finding comes back only with a new fact that a new source shows. Add that source to the brief's sources (b1, b2, ...) and list its id in source_ids, or delete the returning entry.`,
    );
    expect(issue.hint).toBe("A returning entry cites at least one source added this run, dated within the pack window and its lookback (SPEC §4.12 RETURN_NEW_FACT).");
  });

  it("counts only a brief-level source of this draft as added this run: an s id, or a b id the brief lacks, is not (DRAFT)", () => {
    const own = only(draftOf(CODE, cites("s1")));
    expect(own.message).toContain("its source_ids holds s1, none of them a brief-level source of this draft.");
    expect(only(draftOf(CODE, cites("b9"))).message).toContain("its source_ids holds b9, none of them");
    expect(only(draftOf(CODE, cites("s1", "b9"))).message).toContain("its source_ids holds s1, b9, none of them");
    // An id is matched whole: with the brief's third source renamed b30, b3 is the start of a source's id and no source of the brief.
    const renamed: Edit = (d) => { d.sources[2].id = "b30"; d.also[0].source_id = "b30"; };
    expect(only(draftOf(CODE, both(renamed, cites("b3")))).message).toContain("its source_ids holds b3, none of them");
    expect(draftOf(CODE, both(renamed, cites("b30")))).toEqual([]);
    // A stored finding's own source s1, which a run given its record can read, is a source of the record, not one added this run:
    // dated 2026-11-20 it lies within the span, and still does not count.
    const record = { stored: records([storedFinding(FINDING, { depth: "item", title: l("A made-up proof"), terms: [], subfield: "formal-proof" })]) };
    expect(storedFinding(FINDING).sources[0]!.published_at).toBe("2026-11-20");
    expect(only(draftOf(CODE, cites("s1"), record)).message).toContain("its source_ids holds s1, none of them");
    // One added source among the others is enough.
    expect(draftOf(CODE, cites("s1", "b9", "b1"))).toEqual([]);
  });

  it("counts each cited source once: a source listed twice is one source, and says so once (DRAFT)", () => {
    const issue = only(draftOf(CODE, both(dated("2026-11-20"), cites("b1", "b1"))));
    expect(issue.message).toContain("cites 1 source added this run, but none is dated from");
    expect(issue.message.match(/b1 is dated/g)).toHaveLength(1);
    // Listed twice with no source behind it, an id is named once.
    expect(only(draftOf(CODE, cites("s1", "s1", "b9", "b9"))).message).toContain("its source_ids holds s1, b9, none of them");
    expect(draftOf(CODE, cites("b1", "b1"))).toEqual([]);
  });

  it("dates a source within the pack window plus the lookback, both ends included, by its own timestamp (DRAFT)", () => {
    // From 2026-11-21 04:00 (the window start of 2026-11-23 04:00, less 48 hours) to 2026-11-24 03:00, Taipei.
    for (const inside of ["2026-11-21T04:00:00+08:00", "2026-11-20T20:00:00Z", "2026-11-22T12:00:00+08:00", "2026-11-24T03:00:00+08:00", "2026-11-23T19:00:00Z"]) {
      expect(dateIssue(inside), inside).toEqual([]);
    }
    for (const outside of ["2026-11-21T03:59:59+08:00", "2026-11-20T19:59:59Z", "2026-11-24T03:00:01+08:00", "2026-11-23T19:00:01Z", "2026-10-01T00:00:00+08:00"]) {
      expect(only(dateIssue(outside)).path, outside).toBe("returning[0].source_ids");
    }
  });

  it("dates a source that gives only a day by whether that Taipei day overlaps the span (DRAFT)", () => {
    for (const inside of ["2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]) expect(dateIssue(inside), inside).toEqual([]);
    for (const outside of ["2026-11-20", "2026-11-25", "2026-11-10"]) expect(only(dateIssue(outside)).path, outside).toBe("returning[0].source_ids");
  });

  it("says how each added source is dated, and what the span is (DRAFT)", () => {
    expect(only(dateIssue("2026-11-20")).message).toBe(
      `returning[0] (${FINDING}) cites 1 source added this run, but none is dated from ${SPAN}: b1 is dated 2026-11-20 by its own published_at. Cite the source that shows the new fact, with its own date, or delete the returning entry.`,
    );
    expect(only(dateIssue("2026-11-20")).hint).toBe(
      "A source in the pack is dated by its candidate's published_at (an arXiv paper by its announcement), any other by its own published_at (SPEC §4.12 RETURN_NEW_FACT).",
    );
    expect(only(dateIssue(null)).message).toContain(": b1 has no date. ");
    const two = both(dated("2026-11-19"), (d) => { d.sources[1].published_at = null; }, cites("b1", "b2"));
    expect(only(draftOf(CODE, two)).message).toContain("cites 2 sources added this run, but none is dated from");
    expect(only(draftOf(CODE, two)).message).toContain(": b1 is dated 2026-11-19 by its own published_at; b2 has no date. ");
  });

  it("is satisfied by any one source dated within the span (DRAFT)", () => {
    expect(draftOf(CODE, both(dated("2026-10-01"), cites("b1", "b2")))).toEqual([]);
    expect(draftOf(CODE, both(dated(null), cites("b1", "b2")))).toEqual([]);
    expect(only(draftOf(CODE, both(dated("2026-10-01"), (d) => { d.sources[1].published_at = "2026-11-01"; }, cites("b1", "b2")))).path).toBe("returning[0].source_ids");
  });

  it("takes the span from the context's window and from run.pack.lookback_hours (DRAFT)", () => {
    // A 24-hour lookback starts the span at 2026-11-22 04:00: the day 2026-11-21 no longer overlaps it.
    expect(dateIssue("2026-11-21")).toEqual([]);
    const short = only(dateIssue("2026-11-21", withConfig(24)));
    expect(short.message).toContain("none is dated from 2026-11-22 04:00 to 2026-11-24 03:00 Taipei (the pack window and 24 hours of lookback)");
    expect(dateIssue("2026-11-22", withConfig(24))).toEqual([]);
    expect(only(dateIssue("2026-11-20", withConfig(1))).message).toContain("(the pack window and 1 hour of lookback)");
    // A later window moves the span with it.
    const later: Edit = (d, c) => { c.window = { start: "2026-11-25T04:00:00+08:00", end: "2026-11-26T03:00:00+08:00" }; dated("2026-11-22")(d, c); };
    expect(only(draftOf(CODE, later)).message).toContain("none is dated from 2026-11-23 04:00 to 2026-11-26 03:00 Taipei");
    expect(draftOf(CODE, (d, c) => { later(d, c); dated("2026-11-23T04:00:00+08:00")(d, c); })).toEqual([]);
  });

  it("dates a URL that the pack lists by its candidate's published_at, whatever the source says of itself (DRAFT)", () => {
    // cand-01 is https://example.org/paper/1, announced 2026-11-23 09:00 Taipei.
    const inPack = (extra: Json = {}): Edit => b1({ url: "https://example.org/paper/1", ...extra });
    expect(draftOf(CODE, inPack({ published_at: "2026-10-01" }))).toEqual([]); // a paper submitted long ago, announced today
    expect(draftOf(CODE, inPack({ published_at: null }))).toEqual([]);
    // The pack's date is the older one: the source's own fresh date does not help.
    const old = fromOldPack("2026-10-01T09:00:00+08:00");
    const issue = only(draftOf(CODE, inPack({ published_at: "2026-11-23" }), old));
    expect(issue.message).toContain(": b1 is dated 2026-10-01T09:00:00+08:00 by the pack's date. ");
    // The pack's date is a day only, and the span is read the same way.
    expect(draftOf(CODE, inPack({ published_at: "2026-10-01" }), fromOldPack("2026-11-22"))).toEqual([]);
    expect(only(draftOf(CODE, inPack({ published_at: "2026-11-23" }), fromOldPack("2026-11-20"))).message).toContain("b1 is dated 2026-11-20 by the pack's date");
    // A URL is the same URL however it is written.
    expect(draftOf(CODE, inPack({ url: "https://EXAMPLE.org/paper/1/?utm_source=x#top", published_at: "2026-10-01" }))).toEqual([]);
    expect(only(draftOf(CODE, inPack({ url: "https://EXAMPLE.org/paper/1/?utm_source=x#top", published_at: "2026-11-23" }), old)).message).toContain("by the pack's date");
    // Another URL is dated by the source itself.
    expect(only(draftOf(CODE, inPack({ url: "https://example.org/paper/2", published_at: "2026-10-01" }))).message).toContain("b1 is dated 2026-10-01 by its own published_at");
  });

  it("dates an arXiv paper by its announcement: the pack's date, not the date the source gives (DRAFT)", () => {
    const arxiv = (published_at: string): Partial<DraftInputs> => fromPackWith((p) => {
      Object.assign(p.candidates[0], { url: "https://arxiv.org/abs/2611.00002", doi: null, arxiv: "2611.00002", published_at });
    });
    const edit = b1({ kind: "preprint", url: "https://arxiv.org/abs/2611.00002", published_at: "2026-09-30T12:00:00+08:00" });
    expect(draftOf(CODE, edit, arxiv("2026-11-23T08:00:00+08:00"))).toEqual([]);
    expect(only(draftOf(CODE, edit, arxiv("2026-11-19T08:00:00+08:00"))).message).toContain("b1 is dated 2026-11-19T08:00:00+08:00 by the pack's date");
  });

  it("does not run the dating test without the pack, and the engine says so (DRAFT)", () => {
    // Without the pack a source cannot be dated, so the old source passes; the demand for a source added this run stands.
    expect(draftOf(CODE, dated("2026-10-01"), { pack: null })).toEqual([]);
    expect(only(draftOf(CODE, cites(), { pack: null })).message).toContain("its source_ids is empty");
    expect(only(draftOf(CODE, bare, { pack: null })).message).toContain("standing story");
    const issues = draftRun(dated("2026-10-01"), { pack: null });
    expect(issues.map((i) => i.code)).toEqual(["INPUT_MISSING"]);
    expect(issues[0]!.message).toContain("2 checks ran without it: DUPLICATE, RETURN_NEW_FACT.");
    // With the pack the same draft fails.
    expect(only(draftOf(CODE, dated("2026-10-01"))).path).toBe("returning[0].source_ids");
  });

  it("judges each returning entry on its own, at its own index (DRAFT)", () => {
    const second: Edit = (d) => {
      d.returning.push({ finding_id: "phys-2026-0003", update: "A journal published the paper.", source_ids: ["b2"], rung: null });
      d.sources[1].published_at = "2026-09-01";
    };
    const issue = only(draftOf(CODE, second));
    expect(issue.path).toBe("returning[1].source_ids");
    expect(issue.message).toContain("returning[1] (phys-2026-0003) cites 1 source added this run, but none is dated");
    expect(issue.message).toContain("b2 is dated 2026-09-01");
    const none: Edit = (d) => { d.returning.unshift({ finding_id: "phys-2026-0003", update: "A journal published the paper.", source_ids: [], rung: null }); };
    expect(paths(draftOf(CODE, none))).toEqual(["returning[0].source_ids"]);
  });

  // ── A standing story ────────────────────────────────────────────────────────────────────────────

  describe("a standing story", () => {
    const ERDOS = `returning[0] (${FINDING}) brings back a finding of the standing story "erdos-problems" without one of the three new facts`;
    const rungChange: Edit = (d) => {
      d.rung_changes.push({ finding_id: FINDING, rung: { rung: "checked", date: "2026-11-23", source_id: "b2", note: "Published by Example Journal." } });
    };
    const ownRung: Edit = (d) => { d.returning[0].rung = { rung: "checked", date: "2026-11-23", source_id: "b1", note: "Published by Example Journal." }; };
    const trial = (over: Json = {}): Edit => (d) => { d.sources.push(brief("b4", { kind: "registry", url: "https://clinicaltrials.gov/study/NCT01234567", ...over })); d.returning[0].source_ids = ["b1", "b4"]; };
    const correctionOf = (finding: string): Edit => (d) => { d.corrections.push(draftCorrection(finding, "title", "A made-up proof, restated")); };

    it("fails a returning entry for a finding that a story lists, when the draft has none of the three new facts (DRAFT)", () => {
      const issue = only(draftOf(CODE, bare));
      expect(issue.path).toBe("returning[0]");
      expect(issue.message).toBe(
        `${ERDOS} a standing story needs: a rung change for it (this entry's own rung), a new source that is a trial record (kind registry, an NCT number in its URL), or a correction of it in this draft. Add one of them, or delete the returning entry.`,
      );
      expect(issue.hint).toBe("A standing story returns only on new facts: a rung change, a trial result or a correction of record (STYLE.md, Standing stories).");
    });

    it("passes with an entry rung of its own, a trial record or a correction of it (DRAFT)", () => {
      expect(draftOf(CODE, both(bare, ownRung))).toEqual([]);
      expect(draftOf(CODE, both(bare, trial()))).toEqual([]);
      expect(draftOf(CODE, both(bare, correctionOf(FINDING)))).toEqual([]);
      // Any correction counts, whatever its type and path.
      const clarification: Edit = (d) => { d.corrections.push(draftCorrection(FINDING, "explainer.background", "A clearer background.", { type: "clarification" })); };
      expect(draftOf(CODE, both(bare, clarification))).toEqual([]);
    });

    it("does not count an entry of rung_changes for the finding: its rung change is the entry's own rung, and the message does not name rung_changes (DRAFT)", () => {
      const issue = only(draftOf(CODE, both(bare, rungChange)));
      expect(issue.path).toBe("returning[0]");
      expect(issue.message).toContain("a rung change for it (this entry's own rung), a new source");
      expect(issue.message).not.toContain("rung_changes");
      // The same entry, once its rung is the entry's own, is the new fact.
      expect(draftOf(CODE, both(bare, ownRung))).toEqual([]);
    });

    it("never meets such an entry in a draft that REF_UNKNOWN passes: every draft with a rung_changes entry for a finding that has a returning entry fails REF_UNKNOWN (DRAFT)", () => {
      // The entry is for a finding the brief shows, or does not show, and the context lists it, or does not: four ways, and each fails.
      const shown: Edit = both(bare, rungChange);
      const unshown: Edit = both(shown, (d) => { d.items = d.items.filter((ref: string) => ref !== FINDING); });
      const unlisted = (edit: Edit): Edit => both(edit, (d, c) => {
        c.recent_findings = c.recent_findings.filter((r: Json) => r.id !== FINDING);
        c.reports = c.reports.filter((r: Json) => r.finding_id !== FINDING);
        c.standing_stories = [];
        for (const line of d.lead) line.refs = line.refs.filter((ref: string) => ref !== FINDING);
      });
      const story = { id: "config-story", finding_ids: [FINDING], rule: "Return only on a newly solved problem." };
      const fromConfig: Partial<DraftInputs> = { config: { ...config(), standingStories: { schema_version: 1, stories: [story] } } };
      const ways: [string, ReturnType<typeof refUnknownOf>][] = [
        ["shown and listed", refUnknownOf(shown)],
        ["not shown and listed", refUnknownOf(unshown)],
        ["shown and not listed", refUnknownOf(unlisted(shown), fromConfig)],
        ["not shown and not listed", refUnknownOf(unlisted(unshown), fromConfig)],
      ];
      for (const [way, issues] of ways) expect(issues.length, way).toBeGreaterThan(0);
      expect(ways[0]![1].map((i) => i.path)).toEqual(["rung_changes[1].finding_id"]);
      expect(ways[0]![1][0]!.message).toContain("rung_changes is for findings that story and items do not show");
      expect(ways[1]![1].map((i) => i.path)).toEqual(["returning[0].finding_id"]);
      expect(ways[1]![1][0]!.message).toContain("neither story nor items names that finding");
      expect(ways[2]![1].map((i) => i.path)).toContain("returning[0].finding_id");
      expect(ways[3]![1].map((i) => i.path)).toContain("returning[0].finding_id");
      for (const way of [2, 3]) expect(ways[way]![1].some((i) => i.message.includes("which the context does not list")), String(way)).toBe(true);
      // The draft that RETURN_NEW_FACT counts, an entry rung of its own with no rung_changes entry for the finding, passes REF_UNKNOWN.
      expect(refUnknownOf(both(bare, ownRung))).toEqual([]);
      expect(refUnknownOf()).toEqual([]);
    });

    it("counts only a new fact about this finding: another finding's rung change or correction is not one (DRAFT)", () => {
      // The Tuesday's rung change is phys-2026-0003's, and its corrections are phys-2026-0003's: neither helps math-2026-0002.
      expect(world().draft.rung_changes.map((c: Json) => c.finding_id)).toEqual(["phys-2026-0003"]);
      expect(only(draftOf(CODE, both(bare, correctionOf("bio-2026-0001")))).path).toBe("returning[0]");
      const other: Edit = (d) => { d.rung_changes.push({ finding_id: "bio-2026-0001", rung: { rung: "checked", date: "2026-11-23", source_id: "b2", note: "A note." } }); };
      expect(only(draftOf(CODE, both(bare, other))).path).toBe("returning[0]");
    });

    it("counts a trial record only when it is a registry source with an NCT number, cited by this entry (DRAFT)", () => {
      expect(only(draftOf(CODE, both(bare, trial({ url: "https://clinicaltrials.gov/study/NCT0123456" })))).path).toBe("returning[0]"); // seven digits
      expect(only(draftOf(CODE, both(bare, trial({ url: "https://clinicaltrials.gov/study/abc" })))).path).toBe("returning[0]");
      expect(only(draftOf(CODE, both(bare, trial({ kind: "statement" })))).path).toBe("returning[0]"); // an NCT number in a statement's address
      expect(only(draftOf(CODE, both(bare, trial({ kind: "paper" })))).path).toBe("returning[0]");
      expect(draftOf(CODE, both(bare, trial({ url: "https://clinicaltrials.gov/study/nct01234567" })))).toEqual([]);
      expect(draftOf(CODE, both(bare, trial({ url: "https://trialsearch.who.int/Trial2.aspx?TrialID=NCT01234567" })))).toEqual([]);
      // A trial record that the brief holds but this entry does not cite is not its new fact.
      const uncited: Edit = (d) => { trial()(d, {}); d.returning[0].source_ids = ["b1"]; };
      expect(only(draftOf(CODE, both(bare, uncited))).path).toBe("returning[0]");
    });

    it("applies to every finding a story lists, and to the story of the config file as well (DRAFT)", () => {
      // hum-2026-0005 is the story's second finding.
      const second: Edit = (d) => { d.returning.push({ finding_id: "hum-2026-0005", update: "A new proof of the problem.", source_ids: ["b1"], rung: null }); };
      const issue = only(draftOf(CODE, second));
      expect(issue.path).toBe("returning[1]");
      expect(issue.message).toContain(`returning[1] (hum-2026-0005) brings back a finding of the standing story "erdos-problems"`);
      // The story of config/standing-stories.json, when the context lists none.
      const story = { id: "config-story", finding_ids: [FINDING], rule: "Return only on a newly solved problem." };
      const fromConfig: Partial<DraftInputs> = { config: { ...config(), standingStories: { schema_version: 1, stories: [story] } } };
      const noStories: Edit = (_d, c) => { c.standing_stories = []; };
      const issue2 = only(draftOf(CODE, both(bare, noStories), fromConfig));
      expect(issue2.message).toContain(`of the standing story "config-story" without`);
      // With the config's story and the context's, the config's is the one it names.
      expect(only(draftOf(CODE, bare, fromConfig)).message).toContain(`"config-story"`);
      // A finding that no story lists comes back on a new source alone.
      expect(draftOf(CODE, both(bare, noStories))).toEqual([]);
    });

    it("judges every returning entry, so a story's finding is found after one that no story lists (DRAFT)", () => {
      // returning[0] is phys-2026-0003, listed by no story, with b1 as its new source; returning[1] is math-2026-0002 with no new fact.
      const ahead: Edit = (d) => { d.returning.unshift({ finding_id: "phys-2026-0003", update: "A journal published the paper.", source_ids: ["b1"], rung: null }); };
      const issue = only(draftOf(CODE, both(bare, ahead)));
      expect(issue.path).toBe("returning[1]");
      expect(issue.message).toContain(`returning[1] (${FINDING}) brings back a finding of the standing story "erdos-problems"`);
    });

    it("never reads the story's own rule text (DRAFT)", () => {
      const rule1: Edit = (_d, c) => { c.standing_stories[0].rule = "Return freely: this story needs no new fact."; };
      const rule2: Edit = (_d, c) => { c.standing_stories[0].rule = "Return only on a newly solved problem, a rung change, a trial result or a correction."; };
      expect(only(draftOf(CODE, both(bare, rule1))).message).toContain(ERDOS);
      expect(only(draftOf(CODE, both(bare, rule2))).message).toContain(ERDOS);
      expect(draftOf(CODE, rule1)).toEqual([]);
    });

    it("is judged on the new facts the entry names itself, so a source that is missing is its own problem first (DRAFT)", () => {
      // No source added this run and no new fact: both are reported, each at its own place.
      const issues = draftOf(CODE, both(bare, cites()));
      expect(paths(issues)).toEqual(["returning[0]", "returning[0].source_ids"]);
    });
  });

  // ── Modes ─────────────────────────────────────────────────────────────────────────────────────

  it("runs in draft mode only: a stored brief has no returning entries, and no published run judges them (PUBLISHED, both record sets)", () => {
    for (const publishing of [D, null]) {
      const input = publishedInput(content(), publishing);
      expect(runRules(input, historyRules).filter((i) => i.code === CODE), String(publishing)).toEqual([]);
      expect(rule(CODE).check(input), String(publishing)).toEqual([]);
    }
  });
});

// ── REPORT_DECISION ──────────────────────────────────────────────────────────────────────────────

/** A decision of the draft's `report_decisions`. */
const decision = (report_id: string, outcome: "upheld" | "rejected", correction: number | null): Json => ({
  report_id, outcome, reason: "The source says this.", correction,
});

/** Adds a copy of the context's open report R-0001 or of its upheld report R-0002 as another report. */
const addReport = (context: Json, id: string, status: "open" | "upheld", findingId: string, over: Json = {}): void => {
  const r = structuredClone(context.reports[status === "open" ? 0 : 1]) as Json;
  Object.assign(r, { id, status, finding_id: findingId, ...over });
  r.finding.id = findingId;
  context.reports.push(r);
};

describe("REPORT_DECISION, in draft mode", () => {
  const CODE = "REPORT_DECISION";
  const both = (...edits: Edit[]): Edit => (d, c) => { for (const e of edits) e(d, c); };
  /** A correction on bio-2026-0001 (index 3), the open report R-0001's finding. */
  const bioFix: Edit = (d) => { d.corrections.push(draftCorrection("bio-2026-0001", "explainer.how_sure", "Checked by Example Journal and a second lab.")); };
  const decide = (...decisions: Json[]): Edit => (d) => { d.report_decisions = decisions; };
  const HINT = "Every open report in the context gets exactly one decision (SPEC §4.12 REPORT_DECISION).";

  it("passes the Tuesday: R-0001 is open and rejected, R-0002 was upheld by JL and its correction names it (DRAFT)", () => {
    expect(draftOf(CODE)).toEqual([]);
    expect(world().draft.report_decisions).toEqual([decision("R-0001", "rejected", null)]);
    expect(world().draft.corrections[0].report_id).toBe("R-0002");
  });

  it("fails an open report with no decision, and says what to add (DRAFT)", () => {
    const issue = only(draftOf(CODE, decide()));
    expect(issue.code).toBe(CODE);
    expect(issue.severity).toBe("error");
    expect(issue.path).toBe("report_decisions");
    expect(issue.message).toBe(
      `The context lists report R-0001 (fact, about bio-2026-0001) as open, and the draft has no decision for it. Add an entry to report_decisions: report_id "R-0001", outcome "upheld" (with correction, the index in corrections of the correction on bio-2026-0001 that answers it) or "rejected" (with correction null), and a reason of at most 40 words.`,
    );
    expect(issue.hint).toBe(HINT);
  });

  it("asks for a decision for each open report, and one only (DRAFT)", () => {
    const three: Edit = (_d, c) => { addReport(c, "R-0003", "open", "phys-2026-0003", { kind: "source" }); };
    const issue = only(draftOf(CODE, three));
    expect(issue.message).toContain("report R-0003 (source, about phys-2026-0003) as open");
    expect(paths(draftOf(CODE, both(three, decide())))).toEqual(["report_decisions", "report_decisions"]);
    expect(draftOf(CODE, both(three, decide(decision("R-0001", "rejected", null), decision("R-0003", "rejected", null))))).toEqual([]);
  });

  it("fails an open report with two decisions at the extra one, and with three at each extra (DRAFT)", () => {
    const issue = only(draftOf(CODE, decide(decision("R-0001", "rejected", null), decision("R-0001", "rejected", null))));
    expect(issue.path).toBe("report_decisions[1].report_id");
    expect(issue.message).toBe("Report R-0001 has 2 decisions, at report_decisions[0], report_decisions[1]. Each open report gets exactly one decision; delete the extra ones.");
    expect(issue.hint).toBe(HINT);
    const three = draftOf(CODE, decide(decision("R-0001", "rejected", null), decision("R-0001", "rejected", null), decision("R-0001", "rejected", null)));
    expect(paths(three)).toEqual(["report_decisions[1].report_id", "report_decisions[2].report_id"]);
    expect(three[0]!.message).toContain("Report R-0001 has 3 decisions, at report_decisions[0], report_decisions[1], report_decisions[2].");
  });

  it("fails a decision for a report that is not in the context, naming the open ones (DRAFT)", () => {
    const issue = only(draftOf(CODE, decide(decision("R-0001", "rejected", null), decision("R-0099", "rejected", null))));
    expect(issue.path).toBe("report_decisions[1].report_id");
    expect(issue.message).toBe(
      `report_decisions[1] answers "R-0099", which is not a report in the context. Only an open report gets a decision (the open ones: R-0001). Delete this decision.`,
    );
    // With no open report the message says so, and the decision for R-0001 is then the unknown report's neighbour.
    const none: Edit = (d, c) => { c.reports[0].status = "upheld"; d.report_decisions = [decision("R-0099", "upheld", 0)]; d.corrections[0].report_id = "R-0002"; };
    const noOpen = draftOf(CODE, none);
    expect(paths(noOpen)).toContain("report_decisions[0].report_id");
    expect(noOpen.find((i) => i.path === "report_decisions[0].report_id")!.message).toContain("(the open ones: none)");
    const two: Edit = (d, c) => { addReport(c, "R-0003", "open", "phys-2026-0003"); d.report_decisions.push(decision("R-0003", "rejected", null), decision("R-0099", "rejected", null)); };
    expect(only(draftOf(CODE, two)).message).toContain("(the open ones: R-0001, R-0003)");
  });

  it("fails a decision for a report that JL already upheld, which an open report alone gets (DRAFT)", () => {
    const issue = only(draftOf(CODE, decide(decision("R-0001", "rejected", null), decision("R-0002", "upheld", 0))));
    expect(issue.path).toBe("report_decisions[1].report_id");
    expect(issue.message).toBe(
      `report_decisions[1] answers R-0002, which JL already upheld: it is not open, so it gets no decision. Delete this decision, and give the correction that answers it report_id "R-0002" (REPORT_UPHELD asks for it).`,
    );
    // The frame's own Tuesday had this decision, which is why the world here drops it.
    expect(only(draftOf(CODE, decide(decision("R-0001", "rejected", null), decision("R-0002", "rejected", null)))).message).toContain("which JL already upheld");
  });

  it("fails an upheld decision with no correction, and one that points past the corrections (DRAFT)", () => {
    const none = only(draftOf(CODE, decide(decision("R-0001", "upheld", null))));
    expect(none.path).toBe("report_decisions[0].correction");
    expect(none.message).toBe(
      `report_decisions[0] upholds R-0001 but points to no correction. Set correction to the index, counting from 0, of the correction on bio-2026-0001 in corrections that answers it (write that correction if it is not there), or change the outcome to rejected if the sources do not bear the report out.`,
    );
    const past = only(draftOf(CODE, decide(decision("R-0001", "upheld", 3))));
    expect(past.path).toBe("report_decisions[0].correction");
    expect(past.message).toBe(
      `report_decisions[0] points to correction 3, but the draft has 3 corrections (indices 0 to 2). Point it at the correction on bio-2026-0001 that answers R-0001, and write that correction if it is not there.`,
    );
    expect(draftOf(CODE, decide(decision("R-0001", "upheld", 2)))).toHaveLength(1); // 2 is phys-2026-0003's, in range but not R-0001's finding
    // Each decision is judged: a second open report whose upheld decision has no correction is reported too, at its own index.
    const second: Edit = (d, c) => {
      addReport(c, "R-0003", "open", "phys-2026-0003");
      d.report_decisions = [decision("R-0001", "upheld", null), decision("R-0003", "upheld", null)];
    };
    const issues = draftOf(CODE, second);
    expect(paths(issues)).toEqual(["report_decisions[0].correction", "report_decisions[1].correction"]);
    expect(issues[1]!.message).toContain("report_decisions[1] upholds R-0003 but points to no correction.");
    // With one correction the range is "indices 0 to 0"; with none the draft has no corrections.
    const one: Edit = (d) => { d.corrections = [d.corrections[0]]; d.report_decisions = [decision("R-0001", "upheld", 1)]; };
    expect(only(draftOf(CODE, one)).message).toContain("the draft has 1 correction (indices 0 to 0).");
    const zero: Edit = (d) => { d.corrections = []; d.report_decisions = [decision("R-0001", "upheld", 0)]; };
    expect(only(draftOf(CODE, zero)).message).toContain("but the draft has no corrections.");
  });

  it("fails an upheld decision that points to a correction on another finding, an edition or a term (DRAFT)", () => {
    // corrections[0] is on math-2026-0002 and answers R-0002; free it so that only the decision's target is in question.
    const free = (d: Json): void => { d.corrections[0].report_id = null; };
    const other = both((d) => { free(d); }, decide(decision("R-0001", "upheld", 0)));
    const issue = only(draftOf(CODE, other));
    expect(issue.path).toBe("report_decisions[0].correction");
    expect(issue.message).toBe(
      `report_decisions[0] points to correction 0, which is on math-2026-0002, but R-0001 is about bio-2026-0001. Point it at a correction on bio-2026-0001, and write one if there is none.`,
    );
    const edition: Edit = (d) => {
      d.corrections.push({ ...draftCorrection("x", "lead.0.text", "A new Lead line."), finding_id: null, edition_date: "2026-11-10" });
      d.report_decisions = [decision("R-0001", "upheld", 3)];
    };
    expect(only(draftOf(CODE, edition)).message).toContain("which is on the 2026-11-10 edition, but R-0001 is about bio-2026-0001");
    const term: Edit = (d) => {
      d.corrections.push({ ...draftCorrection("x", "definition", "A new definition."), finding_id: null, term_id: "enzyme" });
      d.report_decisions = [decision("R-0001", "upheld", 3)];
    };
    expect(only(draftOf(CODE, term)).message).toContain("which is on the term enzyme, but R-0001 is about bio-2026-0001");
  });

  it("judges every decision, so one that is refused does not end the search for the next (DRAFT)", () => {
    // R-0003 to R-0006 are open reports about phys-2026-0003, chem-2026-0004, bio-2026-0001 and chem-2026-0004. Each decision after the first fails in its own way,
    // and each of those ways stops the checks of that decision and no other.
    const edit: Edit = (d, c) => {
      addReport(c, "R-0003", "open", "phys-2026-0003");
      addReport(c, "R-0004", "open", "chem-2026-0004");
      addReport(c, "R-0005", "open", "bio-2026-0001");
      addReport(c, "R-0006", "open", "chem-2026-0004");
      d.report_decisions = [
        decision("R-0001", "rejected", null),
        decision("R-0099", "rejected", null), // a report the context lacks
        decision("R-0002", "rejected", null), // a report JL upheld
        decision("R-0003", "rejected", 0), // a rejection that names a correction
        decision("R-0004", "upheld", null), // an upheld decision with no correction
        decision("R-0005", "upheld", 9), // an upheld decision past the corrections
        decision("R-0006", "upheld", 1), // an upheld decision on a correction of another finding (corrections[1] is phys-2026-0003's)
      ];
    };
    const issues = draftOf(CODE, edit);
    expect(paths(issues)).toEqual([
      "report_decisions[1].report_id", "report_decisions[2].report_id", "report_decisions[3].correction", "report_decisions[4].correction",
      "report_decisions[5].correction", "report_decisions[6].correction",
    ]);
    const starts = [
      'report_decisions[1] answers "R-0099", which is not a report in the context.', "report_decisions[2] answers R-0002, which JL already upheld:",
      "report_decisions[3] rejects R-0003 but names correction 0.", "report_decisions[4] upholds R-0004 but points to no correction.",
      "report_decisions[5] points to correction 9, but the draft has 3 corrections", "report_decisions[6] points to correction 1, which is on phys-2026-0003, but R-0006 is about chem-2026-0004.",
    ];
    starts.forEach((start, i) => expect(issues[i]!.message, start).toContain(start));
  });

  it("passes an upheld decision that points to a correction on the report's finding, and a rejected one with none (DRAFT)", () => {
    expect(draftOf(CODE, both(bioFix, decide(decision("R-0001", "upheld", 3))))).toEqual([]);
    expect(draftOf(CODE, decide(decision("R-0001", "rejected", null)))).toEqual([]);
  });

  it("fails a rejected decision that names a correction (DRAFT)", () => {
    const issue = only(draftOf(CODE, both(bioFix, decide(decision("R-0001", "rejected", 3)))));
    expect(issue.path).toBe("report_decisions[0].correction");
    expect(issue.message).toBe(
      "report_decisions[0] rejects R-0001 but names correction 3. A rejected decision has correction null: set it to null, or change the outcome to upheld.",
    );
    // A rejected decision never answers a report, so the correction it names is no second answer.
    expect(draftOf(CODE, both(decide(decision("R-0001", "rejected", 0)), (d) => { d.corrections[0].report_id = "R-0002"; })).map((i) => i.path)).toEqual(["report_decisions[0].correction"]);
  });

  it("passes a correction's report_id that names a report JL upheld, on that report's finding (DRAFT)", () => {
    expect(world().context.reports.find((r: Json) => r.id === "R-0002").status).toBe("upheld");
    expect(draftOf(CODE)).toEqual([]);
  });

  it("fails a correction's report_id that no report of the context has, and lists the reports JL upheld (DRAFT)", () => {
    const issue = only(draftOf(CODE, (d) => { d.corrections[0].report_id = "R-0099"; }));
    expect(issue.path).toBe("corrections[0].report_id");
    expect(issue.message).toBe(
      `corrections[0] has report_id "R-0099", which is not a report in the context. report_id is set only on the correction for a report that JL upheld (the context's: R-0002); set it to null.`,
    );
    const some: Edit = (d, c) => { addReport(c, "R-0003", "upheld", "phys-2026-0003"); d.corrections[0].report_id = "R-0099"; };
    expect(only(draftOf(CODE, some)).message).toContain("(the context's: R-0002, R-0003)");
    const none: Edit = (d, c) => { c.reports = [c.reports[0]]; d.corrections[0].report_id = "R-0099"; };
    expect(only(draftOf(CODE, none)).message).toContain("(the context has none)");
  });

  it("fails a correction's report_id that names an open report, whose decision links them (DRAFT)", () => {
    const issue = only(draftOf(CODE, (d) => { d.corrections[0].report_id = "R-0001"; }));
    expect(issue.path).toBe("corrections[0].report_id");
    expect(issue.message).toBe(
      `corrections[0] has report_id "R-0001", but R-0001 is an open report: its decision (upheld, with correction 0) links the two, and report_id stays null. Set report_id to null.`,
    );
  });

  it("fails a correction's report_id on a finding other than the report's, and then the report has two corrections or none (DRAFT)", () => {
    // corrections[1] is phys-2026-0003's; R-0002 is about math-2026-0002.
    const issues = draftOf(CODE, (d) => { d.corrections[1].report_id = "R-0002"; });
    const wrong = issues.find((i) => i.path === "corrections[1].report_id" && i.message.includes("a report about"))!;
    expect(wrong.message).toBe(
      `corrections[1] has report_id "R-0002", a report about math-2026-0002, but the correction is on phys-2026-0003. Put report_id on the correction on math-2026-0002, or set it to null.`,
    );
    // An edition's correction names no finding: the message says what it is on.
    const edition: Edit = (d) => {
      d.corrections.push({ ...draftCorrection("x", "lead.0.text", "A new Lead line.", { report_id: "R-0002" }), finding_id: null, edition_date: "2026-11-10" });
    };
    expect(draftOf(CODE, edition).some((i) => i.message.includes("but the correction is on the 2026-11-10 edition."))).toBe(true);
  });

  it("fails a correction that answers two reports, at the correction (DRAFT)", () => {
    // R-0003 is another open report about math-2026-0002; its upheld decision points at corrections[0], which answers R-0002 by its report_id.
    const edit: Edit = (d, c) => {
      addReport(c, "R-0003", "open", "math-2026-0002");
      d.report_decisions.push(decision("R-0003", "upheld", 0));
    };
    const issue = only(draftOf(CODE, edit));
    expect(issue.path).toBe("corrections[0]");
    expect(issue.message).toBe(
      "Correction 0 answers 2 reports: R-0003 (through report_decisions[1].correction), R-0002 (through corrections[0].report_id). A correction answers one report: write a separate correction for each.",
    );
    // Two open reports of one finding, both upheld through one correction.
    const twoOpen: Edit = (d, c) => {
      addReport(c, "R-0003", "open", "bio-2026-0001");
      d.corrections.push(draftCorrection("bio-2026-0001", "explainer.how_sure", "Checked by Example Journal and a second lab."));
      d.report_decisions = [decision("R-0001", "upheld", 3), decision("R-0003", "upheld", 3)];
    };
    const two = only(draftOf(CODE, twoOpen));
    expect(two.path).toBe("corrections[3]");
    expect(two.message).toContain("Correction 3 answers 2 reports: R-0001 (through report_decisions[0].correction), R-0003 (through report_decisions[1].correction).");
    // The corrections are judged in order: one that answers a single report does not end the search for one that answers two.
    const later: Edit = (d, c) => {
      addReport(c, "R-0003", "open", "math-2026-0002");
      d.corrections.push(draftCorrection("bio-2026-0001", "explainer.how_sure", "Checked by Example Journal and a second lab."));
      d.report_decisions = [decision("R-0001", "upheld", 3), decision("R-0003", "upheld", 0)];
    };
    const found = only(draftOf(CODE, later));
    expect(found.path).toBe("corrections[0]");
    expect(found.message).toContain("Correction 0 answers 2 reports: R-0003 (through report_decisions[1].correction), R-0002 (through corrections[0].report_id).");
  });

  it("fails a report that has two corrections, at the second (DRAFT)", () => {
    const edit: Edit = (d) => { d.corrections.push(draftCorrection("math-2026-0002", "title", "A made-up proof, restated", { report_id: "R-0002" })); };
    const issue = only(draftOf(CODE, edit));
    expect(issue.path).toBe("corrections[3].report_id");
    expect(issue.message).toBe(
      "Report R-0002 has 2 corrections: 0 (through corrections[0].report_id), 3 (through corrections[3].report_id). A report has one correction: keep one and fold what the other adds into it.",
    );
    // One open report answered through its decision and again through a report_id on another correction.
    const open: Edit = (d) => {
      d.corrections.push(draftCorrection("bio-2026-0001", "explainer.how_sure", "Checked by Example Journal and a second lab."));
      d.corrections.push(draftCorrection("bio-2026-0001", "title", "A sample protein result, restated", { report_id: "R-0001" }));
      d.report_decisions = [decision("R-0001", "upheld", 3)];
    };
    const found = draftOf(CODE, open);
    expect(found.some((i) => i.message.startsWith("Report R-0001 has 2 corrections: 3 (through report_decisions[0].correction), 4 (through corrections[4].report_id)."))).toBe(true);
    // The same correction reached twice (its decision and its report_id) is one correction, not two.
    const same: Edit = (d) => {
      d.corrections.push(draftCorrection("bio-2026-0001", "explainer.how_sure", "Checked by Example Journal and a second lab.", { report_id: "R-0001" }));
      d.report_decisions = [decision("R-0001", "upheld", 3)];
    };
    expect(draftOf(CODE, same).map((i) => i.path)).toEqual(["corrections[3].report_id"]); // only: it is an open report's report_id
    // The reports are judged in order: a report with one correction does not end the search for one with two (R-0002 comes first here).
    const later: Edit = (d, c) => {
      addReport(c, "R-0003", "upheld", "phys-2026-0003");
      d.corrections.push(draftCorrection("phys-2026-0003", "title", "A made-up result, restated", { report_id: "R-0003" }));
      d.corrections.push(draftCorrection("phys-2026-0003", "explainer.background", "A clearer background.", { type: "clarification", report_id: "R-0003" }));
    };
    const second = only(draftOf(CODE, later));
    expect(second.path).toBe("corrections[4].report_id");
    expect(second.message).toBe(
      "Report R-0003 has 2 corrections: 3 (through corrections[3].report_id), 4 (through corrections[4].report_id). A report has one correction: keep one and fold what the other adds into it.",
    );
  });

  it("reports nothing that has no open report and no decision or report_id at all (DRAFT)", () => {
    const quiet: Edit = (d, c) => { c.reports = []; d.report_decisions = []; d.corrections = d.corrections.map((x: Json) => ({ ...x, report_id: null })); };
    expect(draftOf(CODE, quiet)).toEqual([]);
  });

  it("runs in draft mode only (PUBLISHED, both record sets)", () => {
    for (const publishing of [D, null]) {
      const input = publishedInput(content(), publishing);
      expect(runRules(input, historyRules).filter((i) => i.code === CODE), String(publishing)).toEqual([]);
      expect(rule(CODE).check(input), String(publishing)).toEqual([]);
    }
  });
});

// ── REPORT_UPHELD ────────────────────────────────────────────────────────────────────────────────

describe("REPORT_UPHELD, in draft mode", () => {
  const CODE = "REPORT_UPHELD";
  /** R-0002 has no correction that names it. */
  const unanswered: Edit = (d) => { d.corrections[0].report_id = null; };
  const both = (...edits: Edit[]): Edit => (d, c) => { for (const e of edits) e(d, c); };

  it("passes the Tuesday, whose upheld report R-0002 has a correction with its report_id, and an open report is not its business (DRAFT)", () => {
    expect(draftOf(CODE)).toEqual([]);
    // R-0001 is open and has no decision here: REPORT_DECISION's concern, no warning of this check.
    expect(draftOf(CODE, (d) => { d.report_decisions = []; })).toEqual([]);
  });

  it("warns, never errs, for a report JL upheld that has no correction with its report_id (DRAFT)", () => {
    expect(rule(CODE).severity).toBe("warning");
    const issue = only(draftOf(CODE, unanswered));
    expect(issue.code).toBe(CODE);
    expect(issue.severity).toBe("warning");
    expect(issue.path).toBe("corrections");
    expect(issue.message).toBe(
      `Report R-0002 (fact, about math-2026-0002), which JL upheld, has no correction with report_id "R-0002". If the finding's sources show the error, add a correction on math-2026-0002 with report_id "R-0002" that puts it right, citing a primary source. If not, add nothing: never invent a correction. The report comes back tomorrow.`,
    );
    expect(issue.hint).toBe("A report that JL upheld is answered by a correction only when the record bears it out (SPEC §4.12 REPORT_UPHELD).");
  });

  it("asks for a correction only where the finding's sources or the evidence link show the error, and for a removed one where the detail is dangerous (DRAFT)", () => {
    const withLink = only(draftOf(CODE, both(unanswered, (_d, c) => { c.reports[1].evidence_url = "https://example.org/evidence"; })));
    expect(withLink.message).toContain("If the finding's sources or the reader's evidence link show the error, add a correction on math-2026-0002");
    expect(only(draftOf(CODE, unanswered)).message).not.toContain("evidence link");

    const dangerous = only(draftOf(CODE, both(unanswered, (_d, c) => { c.reports[1].kind = "dangerous"; })));
    expect(dangerous.message).toBe(
      `Report R-0002 (dangerous, about math-2026-0002), which JL upheld, has no correction with report_id "R-0002". If STYLE.md §9 rules the detail out, add a removed correction on math-2026-0002 with report_id "R-0002" for the text it names. If not, add nothing: never invent a correction. The report comes back tomorrow.`,
    );
    // The evidence link does not change the dangerous wording.
    const linked = both(unanswered, (_d, c) => { c.reports[1].kind = "dangerous"; c.reports[1].evidence_url = "https://example.org/evidence"; });
    expect(only(draftOf(CODE, linked)).message).toBe(dangerous.message);
    for (const kind of ["source", "rung", "link"]) {
      expect(only(draftOf(CODE, both(unanswered, (_d, c) => { c.reports[1].kind = kind; }))).message, kind).toContain(`Report R-0002 (${kind}, about math-2026-0002)`);
    }
  });

  it("warns once for each such report, and any correction that names the report clears it, on whichever finding (DRAFT)", () => {
    const two: Edit = (d, c) => { unanswered(d, c); addReport(c, "R-0003", "upheld", "phys-2026-0003"); };
    const issues = draftOf(CODE, two);
    expect(issues.map((i) => i.message.slice(0, 22))).toEqual(["Report R-0002 (fact, a", "Report R-0003 (fact, a"]);
    expect(issues.every((i) => i.severity === "warning" && i.path === "corrections")).toBe(true);
    // corrections[1] is phys-2026-0003's: its report_id clears R-0003 (REPORT_DECISION judges the finding it is on).
    const cleared: Edit = (d, c) => { two(d, c); d.corrections[1].report_id = "R-0003"; };
    expect(draftOf(CODE, cleared).map((i) => i.message.slice(0, 16))).toEqual(["Report R-0002 (f"]);
    // A correction with another report's id does not clear it.
    expect(only(draftOf(CODE, (d) => { d.corrections[0].report_id = "R-0001"; })).message).toContain("Report R-0002");
    // The decisions of the draft are no answer: only a correction's report_id is.
    expect(only(draftOf(CODE, both(unanswered, (d) => { d.report_decisions.push(decision("R-0002", "upheld", 0)); }))).message).toContain("Report R-0002");
  });

  it("runs in draft mode only (PUBLISHED, both record sets)", () => {
    for (const publishing of [D, null]) {
      const input = publishedInput(content(), publishing);
      expect(runRules(input, historyRules).filter((i) => i.code === CODE), String(publishing)).toEqual([]);
      expect(rule(CODE).check(input), String(publishing)).toEqual([]);
    }
  });
});

// ── The sample world (fixtures/src) ──────────────────────────────────────────────────────────────

describe("the sample world", () => {
  const sampleDraft = (name: (typeof EDITION_NAMES)[number], edit: (d: Json) => void = () => {}): ValidationIssue[] => {
    const d = structuredClone(editionDraft(name)) as Json;
    edit(d);
    return runRules(buildDraftInput(DraftBrief.parse(d), sampleInputs(name)), historyRules);
  };

  it("passes the group on each of the four valid drafts with no error and no warning (DRAFT)", () => {
    expect(EDITION_NAMES.length).toBe(4);
    for (const name of EDITION_NAMES) {
      const input = buildDraftInput(editionDraft(name), sampleInputs(name));
      expect(runRules(input, historyRules), name).toEqual([]);
    }
  });

  it("builds the soft fixture of REPORT_UPHELD as its row says: the weekday's last correction dropped, no error and exactly this warning (DRAFT)", () => {
    const valid = editionDraft("weekday");
    const inputs = sampleInputs("weekday");
    // The weekday context holds one report JL upheld and one open report; the upheld report's correction is the last of the valid draft.
    expect(inputs.context.reports.map((r) => [r.id, r.status])).toEqual([["R-0001", "upheld"], ["R-0002", "open"]]);
    expect(valid.corrections.at(-1)!.report_id).toBe("R-0001");
    expect(valid.corrections.filter((c) => c.report_id !== null)).toHaveLength(1);
    expect(valid.report_decisions.map((r) => [r.report_id, r.outcome, r.correction])).toEqual([["R-0002", "upheld", 0]]);

    const soft = structuredClone(valid);
    soft.corrections.pop();
    // No report_decisions[].correction index shifts: the open report's decision still points at corrections[0].
    expect(soft.corrections).toHaveLength(valid.corrections.length - 1);
    expect(soft.report_decisions).toEqual(valid.report_decisions);
    expect(soft.corrections[0]).toEqual(valid.corrections[0]);

    const result = validateDraft(soft, { ...inputs, rules: historyRules });
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => `${i.severity} ${i.code} ${i.path}`)).toEqual(["warning REPORT_UPHELD corrections"]);
    expect(result.issues[0]!.message).toContain("Report R-0001 (fact, about earth-2026-0141), which JL upheld, has no correction with report_id \"R-0001\".");
    expect(validateDraft(valid, { ...inputs, rules: historyRules })).toMatchObject({ ok: true, issues: [] });
  });

  it("fails the sample draft's open report with no decision, and a decision that points at a correction of another finding (DRAFT)", () => {
    const none = sampleDraft("weekday", (d) => { d.report_decisions = []; });
    expect(none.map((i) => `${i.code} ${i.path}`)).toEqual(["REPORT_DECISION report_decisions"]);
    expect(none[0]!.message).toContain("report R-0002 (fact, about math-2026-0140) as open");
    // corrections[1] is earth-2026-0141's; R-0002 is about math-2026-0140.
    const wrong = sampleDraft("weekday", (d) => { d.report_decisions[0].correction = 1; });
    expect(wrong.some((i) => i.code === "REPORT_DECISION" && i.path === "report_decisions[0].correction" && i.message.includes("which is on earth-2026-0141"))).toBe(true);
  });

  it("fails the sample draft's returning entry when its source is older than the window plus lookback (DRAFT)", () => {
    const issues = sampleDraft("weekday", (d) => { d.sources[0].published_at = "2026-09-01T10:00:00+08:00"; });
    expect(issues.map((i) => `${i.code} ${i.path}`)).toEqual(["RETURN_NEW_FACT returning[0].source_ids"]);
    expect(issues[0]!.message).toContain("from 2026-10-11 03:15 to 2026-10-14 03:15 Taipei (the pack window and 48 hours of lookback)");
  });

  it("fails the sample draft's new finding that repeats a stored trial, as the context and the pack both show it (DRAFT)", () => {
    // bio-2026-0143 is recent with trial NCT09999001, and the pack's cand-12 is matched to it with the same trial.
    const issues = sampleDraft("weekday", (d) => { d.new_findings[1].artefacts.trial = ["NCT09999001"]; });
    expect(issues.map((i) => `${i.code} ${i.path}`)).toEqual(["DUPLICATE new_findings[1].artefacts.trial[0]"]);
    expect(issues[0]!.message).toContain("new-2 duplicates the stored finding bio-2026-0143");
    expect(issues[0]!.message).toContain("they share trial NCT09999001 (the pack's candidate cand-12 matched it).");
  });

  it("fails the sample draft's new finding with a subfield of another field (DRAFT)", () => {
    const issues = sampleDraft("weekday", (d) => { d.new_findings[0].subfield = "protein"; });
    expect(issues.map((i) => `${i.code} ${i.path}`)).toEqual(["SUBFIELD_UNKNOWN new_findings[0].subfield"]);
    expect(issues[0]!.message).toContain("one of humanities's subfields: ancient-texts, scripture-translation, theology, archaeology, languages, literature-arts, philosophy.");
  });
});

// ── Purity ───────────────────────────────────────────────────────────────────────────────────────

describe("jaccardOfSets(), the similarity of two word sets", () => {
  const TITLES = [
    "", "   ", "...", "!!!", "alpha", "Alpha", "alpha beta", "alpha beta gamma", "alpha beta gamma delta epsilon", "alpha, beta; gamma", "ALPHA BETA",
    "alpha alpha alpha beta", "protein folding with deep learning", "Protein-folding: deep learning", "caf\u00e9 au lait", "cafe\u0301 au lait",
    "\uff21\uff2c\uff30\uff28\uff21 beta", "\u91cf\u5b50\u8a08\u7b97\u7684\u9032\u5c55", "\u91cf\u5b50\u8a08\u7b97", "\u91cf", "\u91cf\u5b50", "a \u91cf\u5b50\u8a08\u7b97 b",
    "\ud835\udcb3 theory", "x theory", "one two three four five six seven eight nine ten eleven twelve",
  ];

  it("is jaccard() of the titles, for every pair of a list that has empty, punctuation-only, Han, full-width and repeated words", () => {
    for (const a of TITLES) {
      for (const b of TITLES) expect(jaccardOfSets(wordSet(a), wordSet(b)), JSON.stringify([a, b])).toBe(jaccard(a, b));
    }
  });

  it("walks the smaller of the two sets and never the larger, so that a long title costs what its own words cost", () => {
    /** A set that counts the entries it hands out when it is walked. */
    class Counting extends Set<string> {
      walked = 0;
      *[Symbol.iterator](): SetIterator<string> {
        for (const word of super[Symbol.iterator]()) {
          this.walked += 1;
          yield word;
        }
      }
    }
    const make = (n: number, prefix: string): Counting => new Counting(Array.from({ length: n }, (_, i) => `${prefix}${i}`));
    for (const swap of [false, true]) {
      const small = make(3, "x");
      const large = make(1000, "y");
      small.add("y1");
      large.add("x1");
      const score = swap ? jaccardOfSets(large, small) : jaccardOfSets(small, large);
      expect(score).toBe(2 / 1003);
      expect([small.walked, large.walked]).toEqual([4, 0]);
    }
    // Two sets of one size: either may be walked, and the score is the same.
    expect(jaccardOfSets(make(2, "z"), make(2, "z"))).toBe(1);
  });

  it("scores two empty sets 1, an empty and a full set 0, equal sets 1, and is the same either way round", () => {
    expect(jaccardOfSets(new Set(), new Set())).toBe(1);
    expect(jaccardOfSets(new Set(), new Set(["a"]))).toBe(0);
    expect(jaccardOfSets(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(1);
    expect(jaccardOfSets(new Set(["a", "b", "c"]), new Set(["c", "d"]))).toBe(jaccardOfSets(new Set(["c", "d"]), new Set(["a", "b", "c"])));
    expect(jaccardOfSets(new Set(["a", "b", "c"]), new Set(["c", "d"]))).toBe(1 / 4);
  });
});

describe("the history rules are pure functions of their input", () => {
  /** A draft that fails all five codes at once, so that every rule has something to compute. */
  const everything: Edit = (d, c) => {
    d.new_findings[0].subfield = "protein"; // SUBFIELD_UNKNOWN
    recentOf(c, "chem-2026-0004").artefacts = { doi: ["10.1234/example.1"], arxiv: [], lean: [], trial: [], pdb: [] }; // DUPLICATE
    d.returning[0].source_ids = ["b9"]; // RETURN_NEW_FACT
    d.report_decisions = []; // REPORT_DECISION: R-0001 is open
    d.corrections[0].report_id = null; // REPORT_UPHELD: R-0002 is not answered
  };
  const CODES = ["DUPLICATE", "REPORT_DECISION", "REPORT_UPHELD", "RETURN_NEW_FACT", "SUBFIELD_UNKNOWN"];

  it("reports all five codes on a draft that fails them, with only its own codes and no RULE_ERROR (DRAFT)", () => {
    const issues = draftRun(everything);
    expect([...new Set(issues.map((i) => i.code))].sort()).toEqual(CODES);
    expect(issues.filter((i) => i.severity === "warning").map((i) => i.code)).toEqual(["REPORT_UPHELD"]);
    expect(issues.filter((i) => i.severity === "error").map((i) => i.code).sort()).toEqual(["DUPLICATE", "REPORT_DECISION", "RETURN_NEW_FACT", "SUBFIELD_UNKNOWN"]);
  });

  it("writes plain messages: a full stop at the end, no dash, a hint for each, and the value found (DRAFT and PUBLISHED)", () => {
    const issues = [...draftRun(everything), ...runRules(publishedInput(refiledBio()), historyRules)];
    const stray = new RegExp(`[^0-9]${EN}|${EN}[^0-9]`); // an en dash is for a range of digits only
    expect(issues.length).toBeGreaterThanOrEqual(6);
    for (const i of issues) {
      expect(i.message.endsWith("."), i.message).toBe(true);
      expect(i.message.includes(EM) || i.hint?.includes(EM), i.message).toBeFalsy();
      expect(stray.test(i.message), i.message).toBe(false);
      expect(i.hint, i.message).not.toBeNull();
      expect(i.hint!.length, i.message).toBeGreaterThan(20);
      expect(i.message.length, i.message).toBeLessThan(900);
    }
  });

  function refiledBio(): Content {
    const c = content();
    c.findings = c.findings.map((f) => (f.id === "bio-2026-0001" ? ({ ...f, subfield: "protein" } as Finding) : f));
    return c;
  }

  it("changes nothing it reads and gives the same issues on frozen inputs and on a second run (DRAFT)", () => {
    const { draft, context } = world();
    everything(draft, context);
    const inputs = (): DraftInputs => ({
      ...draftInputs(), context: AgentContext.parse(context), pack: packWith((p) => { p.candidates[0].stored_finding = "bio-2026-0001"; }),
      stored: records([storedFinding("bio-2026-0001")], storedCorrections()),
    });
    const plain = runRules(buildDraftInput(DraftBrief.parse(draft), inputs()), historyRules);
    const frozen = inputs();
    const parsed = DraftBrief.parse(draft);
    for (const part of [parsed, frozen.context, frozen.evidence, frozen.metrics, frozen.pack, frozen.stored]) deepFreeze(part);
    const input = buildDraftInput(parsed, frozen);
    expect(runRules(input, historyRules)).toEqual(plain);
    expect(runRules(input, historyRules)).toEqual(plain);
    expect(plain.length).toBeGreaterThan(5);
    for (const r of historyRules) expect(r.check(input), r.codes[0]).toEqual(r.check(input));
  });

  it("changes nothing it reads and gives the same issues on frozen stored records (PUBLISHED)", () => {
    const w = storedWorld();
    const c = refiledBio();
    const frozen = deepFreeze({ findings: c.findings, terms: w.terms, corrections: c.corrections, reports: w.reports });
    const input = buildPublishedInput(deepFreeze(w.brief), frozen, { config: config(), publishing: D });
    const issues = runRules(input, historyRules);
    expect(issues.map((i) => i.code)).toEqual(["SUBFIELD_UNKNOWN"]);
    expect(runRules(input, historyRules)).toEqual(issues);
  });
});

// ── The fixtures of the group ────────────────────────────────────────────────────────────────────

describe("the fixtures of the history group", () => {
  const MINE = codesOfGroup("history");
  const tableTests = (code: string): readonly string[] => RULE_CODE_TABLE.find((r) => r.code === code)!.tests;
  /** The issue paths an F case may fail at, one pattern for each hard code of the group. */
  const WHERE: Record<string, RegExp> = {
    SUBFIELD_UNKNOWN: /^new_findings\[\d+\]\.subfield$/,
    DUPLICATE: /^new_findings\[\d+\]\.(title|artefacts\.(doi|arxiv|trial)\[\d+\])$/,
    RETURN_NEW_FACT: /^returning\[\d+\](\.source_ids)?$/,
    REPORT_DECISION: /^(report_decisions(\[\d+\]\.(report_id|correction))?|corrections\[\d+\](\.report_id)?)$/,
  };
  /** The whole validator, and the group's own rules, on a draft with its edition's inputs. */
  const whole = (draft: unknown, edition: EditionName): ValidationIssue[] => validateDraft(draft, sampleInputs(edition)).issues;
  const own = (draft: unknown, edition: EditionName): ValidationIssue[] => runRules(buildDraftInput(DraftBrief.parse(draft), sampleInputs(edition)), historyRules);
  const tell = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.code}`);
  const codesOf = (issues: readonly ValidationIssue[], severity: string): string[] =>
    [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();
  const mutated = (c: { edition?: EditionName; mutate: (draft: DraftBrief) => unknown }): unknown => {
    const draft = editionDraft(c.edition ?? "weekday");
    const out = c.mutate(draft);
    return out === undefined ? draft : out;
  };

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

  /** Every string under a key of a draft, with the path it is at. */
  function stringsIn(value: unknown, path = ""): [string, string][] {
    if (typeof value === "string") return [[path, value]];
    if (Array.isArray(value)) return value.flatMap((x, i) => stringsIn(x, `${path}[${i}]`));
    if (typeof value !== "object" || value === null) return [];
    return Object.entries(value).flatMap(([k, v]) => stringsIn(v, path === "" ? k : `${path}.${k}`));
  }

  it("has an F case for each hard code of the group and an S case for each soft one, in the table's order, each filed under its code", () => {
    const withTest = (test: string): string[] => MINE.filter((code) => tableTests(code).includes(test));
    expect(historyCases.map((c) => c.code)).toEqual(withTest("F"));
    expect(historyCases.map((c) => c.code)).toEqual(["SUBFIELD_UNKNOWN", "DUPLICATE", "RETURN_NEW_FACT", "REPORT_DECISION"]);
    expect(historySoft.map((c) => c.code)).toEqual(withTest("S"));
    expect(historySoft.map((c) => c.code)).toEqual(["REPORT_UPHELD"]);
    for (const c of historyCases) expect(c.file, c.code).toBe(`invalid--${c.code}.json`);
    for (const c of historySoft) expect(c.file, c.code).toBe(`soft--${c.code}.json`);
    // Every code of the group has an F or an S case, whichever its severity asks for, and a code the table gives a T test has a named case.
    for (const code of MINE) expect([...historyCases, ...historySoft].some((c) => c.code === code), code).toBe(true);
    for (const code of withTest("T")) expect(historyNamed.some((c) => c.code === code), code).toBe(true);
    for (const code of MINE) expect(codeInfo(code)!.severity === "S", code).toBe(historySoft.some((c) => c.code === code));
  });

  it.each(historyCases.map((c) => [c.code, c] as const))("F %s: fails validateDraft() with exactly its code, where the rule says, by a small change", (code, c) => {
    const edition = c.edition ?? "weekday";
    const draft = invalidDraft(c);
    const issues = whole(draft, edition);
    expect(tell(issues)).toEqual([`error ${code}`]);
    expect(issues[0]!.path).toMatch(WHERE[code]!);
    expect(tell(own(draft, edition))).toEqual([`error ${code}`]);
    expect(changedPaths(editionDraft(edition), draft).length).toBeLessThanOrEqual(3);
  });

  it.each(historyCases.map((c) => [c.code, c] as const))("F %s: its file in fixtures/drafts/ is the builder's output and fails the same way", (code, c) => {
    const { path, text } = invalidOutputs([c])[0]!;
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    expect(tell(whole(JSON.parse(text), c.edition ?? "weekday"))).toEqual([`error ${code}`]);
  });

  it.each(historySoft.map((c) => [c.code, c] as const))("S %s: passes with no error and exactly this warning, the valid draft less its last correction", (code, c) => {
    const edition = c.edition ?? "weekday";
    const draft = softDraft(c) as DraftBrief;
    const result = validateDraft(draft, sampleInputs(edition));
    expect(result.ok).toBe(true);
    expect(tell(result.issues)).toEqual([`warning ${code}`]);
    expect(tell(own(draft, edition))).toEqual([`warning ${code}`]);
    // The valid draft with its last correction dropped, and nothing else: no `report_decisions[].correction` index shifts.
    const expected = structuredClone(editionDraft(edition));
    expected.corrections.pop();
    expect(draft).toEqual(expected);
    const { path, text } = softOutputs([c])[0]!;
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    expect(tell(validateDraft(JSON.parse(text), sampleInputs(edition)).issues)).toEqual([`warning ${code}`]);
  });

  it("has named cases with unique names, each starting with the code it is about, which one of its results holds", () => {
    expect(historyNamed.length).toBeGreaterThan(20);
    expect(new Set(historyNamed.map((c) => c.name)).size).toBe(historyNamed.length);
    for (const c of historyNamed) {
      expect(c.name.startsWith(`${c.code}: `), c.name).toBe(true);
      expect([...c.expect.errors, ...c.expect.warnings], c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toEqual([...c.expect.errors].sort());
      expect([...c.expect.warnings], c.name).toEqual([...c.expect.warnings].sort());
      expect(EDITION_NAMES, c.name).toContain(c.edition);
    }
  });

  it("covers each code of the group, a draft's own SCHEMA failure on a `removed` correction, and the Sunday edition", () => {
    for (const code of MINE) expect(historyNamed.some((c) => c.code === code), code).toBe(true);
    expect(historyNamed.filter((c) => c.code === "SCHEMA").map((c) => c.expect.errors)).toEqual([["SCHEMA"], ["SCHEMA"]]);
    expect(historyNamed.some((c) => c.edition === "sunday")).toBe(true);
  });

  it.each(historyNamed.map((c) => [c.name, c] as const))("T %s", (_name, c) => {
    const draft = mutated(c);
    const issues = whole(draft, c.edition);
    expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }).toEqual({ errors: [...c.expect.errors], warnings: [...c.expect.warnings] });
    // The group's own rules say the part that is theirs, and nothing else (a draft that fails SCHEMA reaches no rule).
    if (!DraftBrief.safeParse(draft).success) {
      expect(c.expect.errors, c.name).toEqual(["SCHEMA"]);
      return;
    }
    const mine = own(draft, c.edition);
    expect(codesOf(mine, "error")).toEqual(c.expect.errors.filter((code) => MINE.includes(code)));
    expect(codesOf(mine, "warning")).toEqual(c.expect.warnings.filter((code) => MINE.includes(code)));
    for (const i of mine) expect(MINE, `${i.code} ${i.path}`).toContain(i.code);
  });

  it("adds only invented text marked SAMPLE, the vocabulary's removal text, and what the sample world already holds", () => {
    const cases = [
      ...historyCases.map((c) => ({ edition: c.edition ?? "weekday", draft: invalidDraft(c) })),
      ...historySoft.map((c) => ({ edition: c.edition ?? "weekday", draft: softDraft(c) })),
      ...historyNamed.map((c) => ({ edition: c.edition, draft: mutated(c) })),
    ];
    let texts = 0;
    for (const { edition, draft } of cases) {
      // What the sample world holds: the valid draft, the run's context and pack, and the pages of its evidence.
      const inputs = sampleInputs(edition);
      const world = new Set([...stringsIn(editionDraft(edition)), ...stringsIn(inputs.context), ...stringsIn(inputs.pack), ...(inputs.evidence?.urls ?? []).map((u) => ["", u] as [string, string])].map(([, v]) => v));
      for (const [path, value] of stringsIn(draft)) {
        if (world.has(value)) continue; // a value of the sample world (a copy of a decision, a correction or a source, or a source's own title)
        if (/^https?:\/\//.test(value)) {
          expect(world.has(value), `${path} ${value}`).toBe(true);
        } else if (/\s/.test(value)) {
          texts += 1;
          expect(value.startsWith("SAMPLE:") || value === REMOVED_TEXT.en, `${path}: ${value}`).toBe(true);
        } else {
          // An id, a date, a field or a path: one word, no free text.
          expect(value.length, `${path}: ${value}`).toBeLessThan(80);
        }
      }
    }
    expect(texts).toBeGreaterThan(5);
  });
});
