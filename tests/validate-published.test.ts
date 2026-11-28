// `validatePublished()`, the entry point for one stored brief and the records it names (SPEC §4.12 "Stored records", §8.6): what it
// parses, what it hands the engine, what it judges and what it never judges for want of a folder, and how it fails. The three published
// rules have their own cases in tests/rules-published.test.ts; here the engine's inputs are read through probe rules, and a few cases run
// the whole registry on the hand-built world of tests/helpers/stored-world.ts (those few are the only ones that depend on other groups'
// rules, and they say so).
//
// New for this project; Cyber's tests/validate.test.ts at the fork commit 3ced1fb, adapted: its "validatePublished" cases (a brief that
// parses is judged by every rule, one that fails the schema by its SCHEMA issues alone, a rule that throws is one RULE_ERROR) are
// Cyber's pattern; the record sets, the probe rules, the archive downgrade through the entry point and the engine fault are this
// project's.

import { describe, expect, it, vi } from "vitest";
import { RULES } from "@/lib/rules";
import { publishedRules } from "@/lib/rules/published";
import { defineRule, error, type PublishedInput, type Rule, type ValidationIssue } from "@/lib/rules/types";
import { validateAll, validatePublished, type StoredInputs } from "@/lib/validate";
import * as storedModule from "@/lib/validate-stored";
import { Correction } from "@/lib/schema/misc";
import {
  BILINGUAL, DATA_ONLY, EN_ONLY, LIGHT, MONDAY, PROOF, PROTEIN, SUNDAY, addMonday, addRemoval, addSunday, briefOn, clone, config, contentOf, deepFreeze,
  findingOf, lz, removedHowSure, storedWorld, type Json, type StoredWorld,
} from "./helpers/stored-world";

// A few cases run the whole registry on the world, which takes seconds on a busy machine; vitest's 5 s default must not turn them red.
vi.setConfig({ testTimeout: 30_000 });

const MISSING = "bio-2026-0099";

const inputsOf =(world: StoredWorld, over: Partial<StoredInputs> = {}): StoredInputs => ({ ...contentOf(world), config: config(), ...over });

/** A rule that records each input it is given and reports nothing. */
function probe(code = "XREF"): { rule: Rule; seen: PublishedInput[] } {
  const seen: PublishedInput[] = [];
  const rule = defineRule({
    code,
    scope: "published",
    check: (input) => {
      if (input.mode === "published") seen.push(input);
      return [];
    },
  });
  return { rule, seen };
}

/** A rule that reports each code at each path, as an error. */
const reporting = (codes: [string, ...string[]], paths: readonly string[]): Rule =>
  defineRule({ code: codes, scope: "published", check: () => paths.flatMap((path) => codes.map((code) => error(code, path, `${code} at ${path}`))) });

const triples = (issues: readonly ValidationIssue[]): string[][] => issues.map((i) => [i.code, i.path, i.message]);
const pathsOf = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => i.path);

// ── The entry point ──────────────────────────────────────────────────────────────────────────────

describe("validatePublished(): what it returns", () => {
  it("is the function lib/validate.ts re-exports, with its types", () => {
    expect(validatePublished).toBe(storedModule.validatePublished);
    expect(validateAll).toBe(storedModule.validateAll);
  });

  it("returns the engine's result with the parsed brief: ok, errors, warnings and issues, the brief as a copy", () => {
    const world = storedWorld();
    const input = briefOn(world, BILINGUAL);
    const result = validatePublished(input, inputsOf(world, { rules: publishedRules }));
    expect(result).toEqual({ ok: true, errors: [], warnings: [], issues: [], brief: input });
    expect(result.brief).not.toBe(input);
    expect(Object.keys(result).sort()).toEqual(["brief", "errors", "issues", "ok", "warnings"]);
  });

  it("splits what the rules report by severity and keeps all of it, in the engine's order, in `issues`", () => {
    const world = storedWorld();
    const rule = defineRule({
      code: ["DUAL_USE", "XREF"],
      scope: "published",
      check: () => [
        error("XREF", "briefs/2026-11-19.json: story.finding_id", "second"),
        error("DUAL_USE", "briefs/2026-11-19.json: lead[0].text.en", "first"),
        error("XREF", "briefs/2026-11-19.json: items[0].finding_id", "third"),
      ],
    });
    const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule], publishing: BILINGUAL }));
    expect(result.ok).toBe(false);
    expect(pathsOf(result.issues)).toEqual([
      "briefs/2026-11-19.json: items[0].finding_id", "briefs/2026-11-19.json: lead[0].text.en", "briefs/2026-11-19.json: story.finding_id",
    ]);
    expect(result.errors).toEqual(result.issues);
    expect(result.warnings).toEqual([]);
    const archived = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule] }));
    expect(archived.ok).toBe(false);
    expect(archived.warnings.map((i) => i.code)).toEqual(["DUAL_USE"]);
    expect(archived.errors.map((i) => i.code)).toEqual(["XREF", "XREF"]);
    expect(archived.issues).toHaveLength(3);
  });

  it("is ok when the issues are warnings only", () => {
    const world = storedWorld();
    const rule = reporting(["BLOCKED_HOST"], ["briefs/2026-11-19.json: pace.sentence.en"]);
    const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule] }));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(triples(result.warnings)).toEqual([["BLOCKED_HOST", "briefs/2026-11-19.json: pace.sentence.en", "BLOCKED_HOST at briefs/2026-11-19.json: pace.sentence.en"]]);
  });

  it("runs every registered rule when it is given no `rules`, and none when it is given []", () => {
    expect(RULES).toContain(publishedRules[0]);
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    brief.story!.finding_id = MISSING;
    const byDefault = validatePublished(brief, inputsOf(world));
    expect(byDefault.errors.map((i) => [i.code, i.path])).toContainEqual(["XREF", `briefs/${BILINGUAL}.json: story.finding_id`]);
    const none = validatePublished(brief, inputsOf(world, { rules: [] }));
    expect(none).toEqual({ ok: true, errors: [], warnings: [], issues: [], brief });
  });

  it("runs only the rules it is given: a probe sees one run, and a rule of another mode is skipped", () => {
    const world = storedWorld();
    const { rule, seen } = probe();
    const draftOnly = defineRule({ code: "COUNTS", scope: "draft", check: () => [error("COUNTS", "x", "never")] });
    const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule, draftOnly] }));
    expect(seen).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });
});

describe("validatePublished(): a brief that fails the schema", () => {
  const broken = (edit: (b: Json) => void): Json => {
    const brief = clone(briefOn(storedWorld(), BILINGUAL)) as Json;
    edit(brief);
    return brief;
  };

  it("is judged by its SCHEMA issues alone, paths relative to the brief, with a null brief, and no rule runs", () => {
    const world = storedWorld();
    const { rule, seen } = probe();
    const input = broken((b) => {
      delete b.pace;
      b.extra = 1;
      b.story = 5;
    });
    const result = validatePublished(input, inputsOf(world, { rules: [rule, ...publishedRules] }));
    expect(seen).toEqual([]);
    expect(result.brief).toBeNull();
    expect(result.ok).toBe(false);
    expect(triples(result.issues)).toEqual([
      ["SCHEMA", "extra", 'Unknown key "extra"; remove it.'],
      ["SCHEMA", "pace", "Missing key (expected object)."],
      ["SCHEMA", "story", "Invalid input: expected object, received number"],
    ]);
    expect(result.errors).toEqual(result.issues);
    expect(result.warnings).toEqual([]);
  });

  it("gives each unknown key its own issue, a missing key its own, and a wrong value its own, with the hints that say what to change", () => {
    const world = storedWorld();
    const result = validatePublished(broken((b) => {
      delete b.items;
      b.lead = "x";
      b.unknown1 = 1;
      b.unknown2 = 2;
    }), inputsOf(world));
    expect(triples(result.issues)).toEqual([
      ["SCHEMA", "items", "Missing key (expected array)."],
      ["SCHEMA", "lead", "Invalid input: expected array, received string"],
      ["SCHEMA", "unknown1", 'Unknown key "unknown1"; remove it.'],
      ["SCHEMA", "unknown2", 'Unknown key "unknown2"; remove it.'],
    ]);
    expect(result.issues.map((i) => i.hint)).toEqual([
      "Every key is required; use null or [] when there is nothing to report.",
      "Change the value to one the schema allows; the field's description in the draft schema says which.",
      "Only keys the schema defines are allowed; scripts add the computed fields at publish.",
      "Only keys the schema defines are allowed; scripts add the computed fields at publish.",
    ]);
  });

  it("never reads the records it was given: a record it could not read does not matter to a brief that fails", () => {
    const world = storedWorld();
    const result = validatePublished(broken((b) => {
      b.extra = 1;
    }), inputsOf(world, { findings: [null as never, null as never] }));
    expect(triples(result.issues)).toEqual([["SCHEMA", "extra", 'Unknown key "extra"; remove it.']]);
  });

  it("reports a date that is not a real calendar date, and the metrics file that no longer matches it, as the schema says", () => {
    const result = validatePublished(broken((b) => {
      b.date = "2026-13-45";
    }), inputsOf(storedWorld()));
    expect(triples(result.issues)).toEqual([
      ["SCHEMA", "date", "Not a real calendar date"],
      ["SCHEMA", "pace.metrics_file", "metrics_file is the file of this edition's date: metrics/2026-13-45.json"],
    ]);
  });

  it("takes a missing brief as one SCHEMA issue at (root) that says the key is missing", () => {
    const result = validatePublished(undefined, inputsOf(storedWorld()));
    expect(result.brief).toBeNull();
    expect(triples(result.issues)).toEqual([["SCHEMA", "(root)", "Missing key (expected object)."]]);
  });

  it.each([[null, "null"], ["a string", "string"], [[], "array"], [7, "number"]])("takes %j that is no object as one SCHEMA issue at (root)", (input, received) => {
    const result = validatePublished(input, inputsOf(storedWorld()));
    expect(result.brief).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe("SCHEMA");
    expect(result.issues[0]!.path).toBe("(root)");
    expect(result.issues[0]!.message).toBe(`Invalid input: expected object, received ${received}`);
  });

  it("names every missing key of an empty object, in the engine's order", () => {
    const result = validatePublished({}, inputsOf(storedWorld()));
    expect(result.issues.every((i) => i.code === "SCHEMA" && i.message.startsWith("Missing key"))).toBe(true);
    expect(pathsOf(result.issues)).toEqual([...pathsOf(result.issues)].sort());
    expect(pathsOf(result.issues)).toEqual(expect.arrayContaining(["also", "computed", "corrections", "date", "deep_dive", "disclosure", "edition", "format"]));
    expect(result.issues).toHaveLength(23);
  });
});

// ── The records it hands the engine ──────────────────────────────────────────────────────────────

describe("validatePublished(): the run's input", () => {
  it("is built for the brief: its date, edition and format, the brief itself, and no folder", () => {
    const world = storedWorld();
    for (const date of [EN_ONLY, BILINGUAL, DATA_ONLY]) {
      const { rule, seen } = probe();
      const brief = briefOn(world, date);
      validatePublished(brief, inputsOf(world, { rules: [rule] }));
      expect(seen).toHaveLength(1);
      const input = seen[0]!;
      expect(input.date).toBe(date);
      expect(input.format).toBe(brief.format);
      expect(input.edition).toBe(date === DATA_ONLY ? "data-only" : "weekday");
      expect(input.published.brief).toEqual(brief);
      expect(input.published.folder).toBeUndefined();
    }
    const extra = addMonday(addSunday(storedWorld()));
    for (const [date, kind] of [[SUNDAY, "sunday"], [MONDAY, "monday"]] as const) {
      const { rule, seen } = probe();
      validatePublished(briefOn(extra, date), inputsOf(extra, { rules: [rule] }));
      expect([seen[0]!.date, seen[0]!.edition]).toEqual([date, kind]);
    }
  });

  it("passes the config, the file date and the publishing date, each as given, and null for the two it is not given", () => {
    const world = storedWorld();
    const cfg = config();
    const given = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [given.rule], config: cfg, fileDate: "2026-11-19", publishing: BILINGUAL }));
    expect(given.seen[0]!.config).toBe(cfg);
    expect(given.seen[0]!.fileDate).toBe("2026-11-19");
    expect(given.seen[0]!.published.publishing).toBe(true);
    const absent = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [absent.rule] }));
    expect(absent.seen[0]!.fileDate).toBeNull();
    expect(absent.seen[0]!.published.publishing).toBe(false);
    const nulls = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [nulls.rule], fileDate: null, publishing: null }));
    expect(nulls.seen[0]!.fileDate).toBeNull();
    expect(nulls.seen[0]!.published.publishing).toBe(false);
  });

  it("hands the date in the file's name on, so the engine's DATE_MISMATCH rule can read it", () => {
    const world = storedWorld();
    const { rule, seen } = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule], fileDate: "2026-11-30" }));
    expect(seen[0]!.fileDate).toBe("2026-11-30");
    const mismatch = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { fileDate: "2026-11-30" }));
    expect(mismatch.errors.map((i) => i.code)).toContain("DATE_MISMATCH");
    const same = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { fileDate: BILINGUAL }));
    expect(same.errors.map((i) => i.code)).not.toContain("DATE_MISMATCH");
  });

  it("hands on each record list as given, and an empty list for each it is not given", () => {
    const world = storedWorld();
    const { rule, seen } = probe();
    validatePublished(briefOn(world, BILINGUAL), { config: config(), rules: [rule] });
    expect(seen[0]!.published.findings).toEqual([]);
    expect(seen[0]!.published.terms).toEqual([]);
    expect(seen[0]!.published.corrections).toEqual([]);
    expect(seen[0]!.published.reports).toEqual([]);
    const full = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [full.rule] }));
    expect(full.seen[0]!.published.corrections).toEqual(world.corrections);
    expect(full.seen[0]!.published.reports).toEqual(world.reports);
    expect(full.seen[0]!.published.findings).toHaveLength(3);
    expect(full.seen[0]!.published.terms).toHaveLength(3);
  });

  it("puts the findings in the id order and the terms in code-unit order, whatever order they come in, without sorting the caller's lists", () => {
    const world = storedWorld();
    const findings = [...world.findings].reverse();
    const terms = [...world.terms].reverse();
    const before = { findings: findings.map((f) => f.id), terms: terms.map((t) => t.id) };
    const { rule, seen } = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule], findings, terms }));
    expect(seen[0]!.published.findings.map((f) => f.id)).toEqual([PROTEIN, PROOF, LIGHT]);
    expect(seen[0]!.published.terms.map((t) => t.id)).toEqual(["lattice", "proof-assistant", "protein-folding"]);
    expect(findings.map((f) => f.id)).toEqual(before.findings);
    expect(terms.map((t) => t.id)).toEqual(before.terms);
  });

  it("keeps the corrections and the reports in the order given: the caller's list is oldest first", () => {
    const world = storedWorld();
    world.corrections.push(Correction.parse({ ...world.corrections[0]!, id: "C-0002", date: EN_ONLY }));
    const { rule, seen } = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule], reports: [...world.reports].reverse() }));
    expect(seen[0]!.published.corrections.map((c) => c.id)).toEqual(["C-0001", "C-0002"]);
    expect(seen[0]!.published.reports.map((r) => r.id)).toEqual(["R-0002", "R-0001"]);
  });

  it("takes the findings as a list or as a map by id, and judges both alike", () => {
    const world = storedWorld();
    findingOf(world, PROTEIN).related = [MISSING];
    const asList = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: publishedRules }));
    const asMap = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: publishedRules, findings: new Map(world.findings.map((f) => [f.id, f])) }));
    expect(asMap).toEqual(asList);
    expect(triples(asList.issues)).toEqual([["XREF", `findings/${PROTEIN}.json: related[0]`, `Names ${MISSING} as related, but findings/${MISSING}.json does not exist.`]]);
    const { rule, seen } = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule], findings: new Map(world.findings.map((f) => [f.id, f])) }));
    expect(seen[0]!.published.findings.map((f) => f.id)).toEqual([PROTEIN, PROOF, LIGHT]);
  });

  it("judges every finding it is given, the ones the brief does not name too", () => {
    const world = storedWorld();
    findingOf(world, PROOF).related = [MISSING];
    findingOf(world, PROOF).briefs = [EN_ONLY];
    const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: publishedRules }));
    expect(pathsOf(result.issues)).toEqual([`findings/${PROOF}.json: related[0]`]);
  });

  it("does not change what it is given: frozen records and a frozen brief go through, and the result is the same twice", () => {
    const world = storedWorld();
    findingOf(world, PROTEIN).related = [MISSING];
    const brief = deepFreeze(clone(briefOn(world, BILINGUAL)));
    const inputs = inputsOf(world, {
      rules: publishedRules,
      findings: deepFreeze(clone(world.findings)), terms: deepFreeze(clone(world.terms)),
      corrections: deepFreeze(clone(world.corrections)), reports: deepFreeze(clone(world.reports)),
    });
    const first = validatePublished(brief, inputs);
    const second = validatePublished(brief, inputs);
    expect(second).toEqual(first);
    expect(first.issues).toHaveLength(1);
    expect(first.brief).toEqual(brief);
  });

  it("returns the issues in the engine's order, whatever order the rules report them in or the records come in", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    brief.story!.finding_id = MISSING;
    brief.items[0]!.finding_id = MISSING;
    findingOf(world, PROTEIN).related = [MISSING];
    const forward = validatePublished(brief, inputsOf(world, { rules: publishedRules }));
    const backward = validatePublished(brief, inputsOf(world, { rules: [...publishedRules].reverse(), findings: [...world.findings].reverse() }));
    expect(backward.issues).toEqual(forward.issues);
    expect(pathsOf(forward.issues)).toEqual([
      `briefs/${BILINGUAL}.json: items[0].finding_id`, `briefs/${BILINGUAL}.json: story.finding_id`, `findings/${PROTEIN}.json: related[0]`,
    ]);
  });
});

// ── Which records are being published ────────────────────────────────────────────────────────────

describe("validatePublished(): the records being published", () => {
  const beingOf = (world: StoredWorld, date: string, publishing: string | null | undefined): PublishedInput["published"]["being"] & { publishing: boolean } => {
    const { rule, seen } = probe();
    validatePublished(briefOn(world, date), inputsOf(world, { rules: [rule], ...(publishing === undefined ? {} : { publishing }) }));
    return { ...seen[0]!.published.being, publishing: seen[0]!.published.publishing };
  };
  const sets = (b: ReturnType<typeof beingOf>): Json => ({
    brief: b.brief, publishing: b.publishing, findings: [...b.findings].sort(), terms: [...b.terms].sort(), corrections: [...b.corrections].sort(), reports: [...b.reports].sort(),
  });

  it("are none when no date is being published, whatever the brief", () => {
    const world = storedWorld();
    for (const publishing of [undefined, null]) {
      for (const date of [EN_ONLY, BILINGUAL, DATA_ONLY]) {
        expect(sets(beingOf(world, date, publishing)), `${date} ${String(publishing)}`).toEqual({ brief: false, publishing: false, findings: [], terms: [], corrections: [], reports: [] });
      }
    }
  });

  it("are the brief of that date, the findings first briefed on it or given text by it, the terms first used on it, the corrections dated on it and the reports decided on it", () => {
    const world = storedWorld();
    expect(sets(beingOf(world, EN_ONLY, EN_ONLY))).toEqual({
      brief: true, publishing: true, findings: [PROTEIN, PROOF], terms: ["proof-assistant", "protein-folding"], corrections: [], reports: [],
    });
    // PROTEIN returns on BILINGUAL with a note of that date (F-17), and LIGHT is first briefed on it
    expect(sets(beingOf(world, BILINGUAL, BILINGUAL))).toEqual({
      brief: true, publishing: true, findings: [PROTEIN, LIGHT], terms: ["lattice"], corrections: ["C-0001"], reports: ["R-0001"],
    });
    // the script's rung change on LIGHT (an entry, a source and the file's `updated` of DATA_ONLY) is text of that edition
    expect(sets(beingOf(world, DATA_ONLY, DATA_ONLY))).toEqual({ brief: true, publishing: true, findings: [LIGHT], terms: [], corrections: [], reports: [] });
  });

  it("give a finding first briefed on the date no parts, so it is judged whole, and a returning finding the entries the date gave it alone (F-55)", () => {
    const world = storedWorld();
    const parts = (date: string): Json => Object.fromEntries([...beingOf(world, date, date).parts].map(([id, p]) => [id, { rung_history: [...p.rung_history], since_then: [...p.since_then], sources: [...p.sources] }]));
    expect(parts(EN_ONLY)).toEqual({});
    // PROTEIN's note of BILINGUAL; LIGHT, first briefed on BILINGUAL, is whole
    expect(parts(BILINGUAL)).toEqual({ [PROTEIN]: { rung_history: [], since_then: [0], sources: [] } });
    // LIGHT's script rung entry and source of DATA_ONLY
    expect(parts(DATA_ONLY)).toEqual({ [LIGHT]: { rung_history: [1], since_then: [], sources: [1] } });
    expect([...beingOf(world, BILINGUAL, null).parts]).toEqual([]);
  });

  it("give a Ledger seed first briefed on the date the entries the date gave it alone, never the whole (F-75)", () => {
    const parts = (edit: (world: StoredWorld) => void): Json => {
      const world = storedWorld();
      edit(world);
      return Object.fromEntries([...beingOf(world, BILINGUAL, BILINGUAL).parts].map(([id, p]) => [id, { rung_history: [...p.rung_history], since_then: [...p.since_then], sources: [...p.sources] }]));
    };
    // LIGHT is first briefed on BILINGUAL; as a seed it is judged in its rung entry and its source of that date, and as no seed it is whole
    const seed = (world: StoredWorld): void => { findingOf(world, LIGHT).history = true; findingOf(world, LIGHT).updated = BILINGUAL; };
    expect(parts(() => {})).toEqual({ [PROTEIN]: { rung_history: [], since_then: [0], sources: [] } });
    expect(parts(seed)).toEqual({ [PROTEIN]: { rung_history: [], since_then: [0], sources: [] }, [LIGHT]: { rung_history: [0], since_then: [], sources: [0] } });
    // the script's change of DATA_ONLY moved its `updated` on, so the seed is no record of BILINGUAL
    expect(parts((world) => { findingOf(world, LIGHT).history = true; })).toEqual({ [PROTEIN]: { rung_history: [], since_then: [0], sources: [] } });
  });

  it("are the records of the date even when the brief given is another edition's: the brief is being published only on its own date", () => {
    const world = storedWorld();
    expect(sets(beingOf(world, EN_ONLY, BILINGUAL))).toEqual({
      brief: false, publishing: false, findings: [PROTEIN, LIGHT], terms: ["lattice"], corrections: ["C-0001"], reports: ["R-0001"],
    });
    expect(sets(beingOf(world, DATA_ONLY, "2026-12-31"))).toEqual({ brief: false, publishing: false, findings: [], terms: [], corrections: [], reports: [] });
  });

  it("read each record's own date: a finding's first brief or the date it was changed, not a date it lists; a term's first date, not its first finding's", () => {
    const world = storedWorld();
    // PROTEIN lists BILINGUAL among its briefs and holds a note of that date, but was first briefed on EN_ONLY: it is being published on
    // BILINGUAL only because that edition changed it (F-17). Once it was last changed earlier, listing BILINGUAL no longer counts.
    expect(findingOf(world, PROTEIN).briefs).toContain(BILINGUAL);
    expect(beingOf(world, BILINGUAL, BILINGUAL).findings.has(PROTEIN)).toBe(true);
    findingOf(world, PROTEIN).updated = EN_ONLY;
    expect(beingOf(world, BILINGUAL, BILINGUAL).findings.has(PROTEIN)).toBe(false);
    findingOf(world, PROTEIN).updated = BILINGUAL;
    // The glossary term of PROTEIN is first used on EN_ONLY; the term of LIGHT, on BILINGUAL.
    expect(beingOf(world, BILINGUAL, BILINGUAL).terms.has("protein-folding")).toBe(false);
    world.reports[1]!.resolved_on = null;
    expect(beingOf(world, BILINGUAL, BILINGUAL).reports.has("R-0002")).toBe(false);
  });

  it("make the safety codes errors where they point at a record being published and warnings where they point at any other", () => {
    const world = storedWorld();
    const rule = reporting(["DUAL_USE", "BLOCKED_HOST", "SOURCE_URL"], [
      `briefs/${BILINGUAL}.json: pace.sentence.en`,
      `findings/${LIGHT}.json: title.en`, `findings/${PROTEIN}.json: title.en`, `findings/${PROTEIN}.json: since_then[0].text.en`, `findings/${PROOF}.json: title.en`,
      "glossary.json: terms[0].en.definition", "glossary.json: terms[1].en.definition",
      "corrections.json: corrections[0].after.en",
      "reports.json: reports[0].reason.en", "reports.json: reports[1].reason.en",
    ]);
    const severities = (publishing: string | undefined): Record<string, string[]> => {
      const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule], ...(publishing === undefined ? {} : { publishing }) }));
      const out: Record<string, string[]> = {};
      for (const issue of result.issues) (out[issue.path] ??= []).push(issue.severity);
      return out;
    };
    const all = (severity: string): string[] => [severity, severity, severity];
    expect(severities(BILINGUAL)).toEqual({
      [`briefs/${BILINGUAL}.json: pace.sentence.en`]: all("error"),
      [`findings/${LIGHT}.json: title.en`]: all("error"),
      // PROTEIN returns on BILINGUAL with a note of that date: the note is being published, the rest of the finding is not (F-55)
      [`findings/${PROTEIN}.json: title.en`]: all("warning"),
      [`findings/${PROTEIN}.json: since_then[0].text.en`]: all("error"),
      [`findings/${PROOF}.json: title.en`]: all("warning"),
      "glossary.json: terms[0].en.definition": all("error"),
      "glossary.json: terms[1].en.definition": all("warning"),
      "corrections.json: corrections[0].after.en": all("error"),
      "reports.json: reports[0].reason.en": all("error"),
      "reports.json: reports[1].reason.en": all("warning"),
    });
    for (const [path, list] of Object.entries(severities(undefined))) expect(list, path).toEqual(all("warning"));
    expect(severities(EN_ONLY)[`briefs/${BILINGUAL}.json: pace.sentence.en`]).toEqual(all("warning"));
    expect(severities(EN_ONLY)[`findings/${PROTEIN}.json: title.en`]).toEqual(all("error"));
    expect(severities(EN_ONLY)[`findings/${PROTEIN}.json: since_then[0].text.en`]).toEqual(all("error"));
    expect(severities(EN_ONLY)[`findings/${PROOF}.json: title.en`]).toEqual(all("error"));
    expect(severities(EN_ONLY)[`findings/${LIGHT}.json: title.en`]).toEqual(all("warning"));
  });

  it("judge the new note of a returning finding with the whole registry and leave its frozen text alone, as the PROTEIN example says (F-55)", () => {
    // PROTEIN was first briefed on EN_ONLY; BILINGUAL adds a note to it. A hype word the file already held is archived text; the same
    // word in the note BILINGUAL added is that edition's.
    const hype = "An unprecedented result.";
    const run = (edit: (world: StoredWorld) => void, publishing = BILINGUAL): string[] => {
      const world = storedWorld();
      edit(world);
      const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { publishing }));
      return result.issues.filter((i) => i.code === "HYPE_WORDS").map((i) => `${i.severity} ${i.path}`);
    };
    expect(run(() => {})).toEqual([]);
    expect(run((w) => { findingOf(w, PROTEIN).explainer.found.en = hype; })).toEqual([]);
    expect(run((w) => { findingOf(w, PROTEIN).since_then[0]!.text.en = hype; })).toEqual([`error findings/${PROTEIN}.json: since_then[0].text.en`]);
    // on its own first date the whole finding is the edition's, as it always was
    expect(run((w) => { findingOf(w, PROTEIN).explainer.found.en = hype; }, EN_ONLY)).toEqual([`error findings/${PROTEIN}.json: explainer.found.en`]);
  });

  it("judge the new note of a Ledger seed first briefed on the date and leave its seeded text alone, where a finding that is no seed is judged whole (F-75)", () => {
    // LIGHT is first briefed on BILINGUAL. As a seed, its frozen explainer was judged when it was seeded; its rung entry of BILINGUAL is that edition's.
    const hype = "An unprecedented result.";
    const run = (seed: boolean, edit: (world: StoredWorld) => void): string[] => {
      const world = storedWorld();
      if (seed) { findingOf(world, LIGHT).history = true; findingOf(world, LIGHT).updated = BILINGUAL; }
      edit(world);
      const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { publishing: BILINGUAL }));
      return result.issues.filter((i) => i.code === "HYPE_WORDS").map((i) => `${i.severity} ${i.path}`);
    };
    const frozen = (world: StoredWorld): void => { findingOf(world, LIGHT).explainer.found.en = hype; };
    const added = (world: StoredWorld): void => { findingOf(world, LIGHT).rung_history[0]!.note = lz(hype, "一項成果。"); };
    expect(run(true, () => {})).toEqual([]);
    expect(run(true, frozen)).toEqual([]);
    expect(run(true, added)).toEqual([`error findings/${LIGHT}.json: rung_history[0].note.en`]);
    expect(run(false, frozen)).toEqual([`error findings/${LIGHT}.json: explainer.found.en`]);
    expect(run(false, added)).toEqual([`error findings/${LIGHT}.json: rung_history[0].note.en`]);
  });

  it("demote a safety error on a string exactly when the inventory says the string is not being published, on every string of every record (F-55)", () => {
    // Two mechanisms say the same thing: the engine turns an error into a warning by the path it points at (`isPublishingPath()`), and the
    // inventory flags each string (`StringEntry.publishing`) for the rules that read `config/`. A rule that reports at the path of every
    // string, with the string's flag in its message, shows any string where they differ: a finding returning on any date, seeded or not.
    const flagged = defineRule({
      code: "DUAL_USE",
      scope: "published",
      check: (input) => (input.mode === "published" ? input.inventory.entries.map((e) => error("DUAL_USE", e.path, `flag=${e.publishing}`)) : []),
    });
    const seen = { error: 0, warning: 0, mixed: 0 };
    for (const seeded of [false, true]) {
      for (const returning of [EN_ONLY, BILINGUAL, DATA_ONLY]) {
        for (const id of [PROTEIN, PROOF, LIGHT]) {
          const world = storedWorld();
          const finding = findingOf(world, id);
          finding.updated = returning;
          if (seeded) Object.assign(finding, { first_brief: null, briefs: [], history: true });
          for (const publishing of [EN_ONLY, BILINGUAL, DATA_ONLY, undefined]) {
            const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [flagged], ...(publishing === undefined ? {} : { publishing }) }));
            const flags = new Set<string>();
            for (const issue of result.issues) {
              expect(issue.severity === "error", `${issue.path} (${id} updated ${returning}, publishing ${String(publishing)}, seeded ${seeded})`).toBe(issue.message === "flag=true");
              seen[issue.severity === "error" ? "error" : "warning"] += 1;
              if (issue.path.startsWith(`findings/${id}.json`)) flags.add(issue.message);
            }
            if (flags.size === 2) seen.mixed += 1;
          }
        }
      }
    }
    // not vacuous: both severities were seen, and some returning finding was judged in part (some strings being published, the rest not)
    expect(seen.error).toBeGreaterThan(100);
    expect(seen.warning).toBeGreaterThan(100);
    expect(seen.mixed).toBeGreaterThan(5);
  });

  it("stays fast through the whole registry on 100,000 characters in the new note of a returning finding and in its frozen explainer (F-55)", () => {
    const long = "The light is bright. ".repeat(5_000);
    for (const edit of [
      (w: StoredWorld) => { findingOf(w, PROTEIN).since_then[0]!.text.en = long; },
      (w: StoredWorld) => { findingOf(w, PROTEIN).explainer.found.en = long; },
    ]) {
      const world = storedWorld();
      edit(world);
      const started = performance.now();
      const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { publishing: BILINGUAL }));
      expect(performance.now() - started).toBeLessThan(3_000);
      expect(result.issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
    }
  });

  it("never turn SECRET_LIKE or CANARY into warnings: they read no list", () => {
    const world = storedWorld();
    const rule = reporting(["SECRET_LIKE", "CANARY"], [`briefs/${BILINGUAL}.json: pace.sentence.en`, `findings/${PROTEIN}.json: title.en`, "glossary.json: terms[2].en.definition"]);
    const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule] }));
    expect(result.issues).toHaveLength(6);
    expect(new Set(result.issues.map((i) => i.severity))).toEqual(new Set(["error"]));
  });

  it("run a test that reads config/ on the records being published only (HYPE_WORDS here, as the registry has it)", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    brief.pace.sentence.en += " A revolutionary week.";
    const archived = validatePublished(brief, inputsOf(world));
    expect(archived.issues).toEqual([]);
    const published = validatePublished(brief, inputsOf(world, { publishing: BILINGUAL }));
    expect(published.errors.map((i) => [i.code, i.path])).toEqual([["HYPE_WORDS", `briefs/${BILINGUAL}.json: pace.sentence.en`]]);
    const other = validatePublished(brief, inputsOf(world, { publishing: EN_ONLY }));
    expect(other.issues).toEqual([]);
  });
});

// ── A stored finding refiled by a correction ─────────────────────────────────────────────────────

describe("validatePublished(): the stored corrections refile the findings (SPEC §4.10)", () => {
  /** Adds a correction that files PROTEIN as `after` at `path`, dated `date`. */
  const refile = (world: StoredWorld, path: string, after: string, date: string): void => {
    world.corrections.push(Correction.parse({
      id: `C-${String(world.corrections.length + 1).padStart(4, "0")}`, date, finding_id: PROTEIN, edition_date: null, term_id: null, type: "correction", path,
      before: lz("The old value.", "舊的值。"), after: lz(after, "新的值。"), reason: lz("It was filed wrongly.", "歸類有誤。"), source_url: null, trigger: "editor", report_id: null,
    }));
  };
  const seenFacts = (world: StoredWorld, date: string): { published: unknown; latest: unknown; current: unknown } => {
    const { rule, seen } = probe();
    validatePublished(briefOn(world, date), inputsOf(world, { rules: [rule] }));
    const view = seen[0]!.views.findings.find((v) => v.id === PROTEIN)!;
    const pick = (f: { significance: string | null; field: string | null }): unknown => [f.significance, f.field];
    return { published: pick(view.published), latest: pick(view.latest), current: pick(view.current) };
  };

  it("reads a finding as the corrections file it on the brief's date, and as published, and as filed now", () => {
    const world = storedWorld();
    refile(world, "significance", "notable", BILINGUAL);
    refile(world, "field", "chemistry", DATA_ONLY);
    expect(seenFacts(world, EN_ONLY)).toEqual({
      published: ["major", "biology"], latest: ["major", "biology"], current: ["notable", "chemistry"],
    });
    expect(seenFacts(world, BILINGUAL)).toEqual({
      published: ["major", "biology"], latest: ["notable", "biology"], current: ["notable", "chemistry"],
    });
    expect(seenFacts(world, DATA_ONLY)).toEqual({
      published: ["major", "biology"], latest: ["notable", "chemistry"], current: ["notable", "chemistry"],
    });
  });

  it("does not refile a finding for a correction whose text path is none of the six, or for a removed one", () => {
    const world = storedWorld();
    expect(seenFacts(world, DATA_ONLY)).toEqual({ published: ["major", "biology"], latest: ["major", "biology"], current: ["major", "biology"] });
    const removed = removedHowSure(storedWorld());
    expect(seenFacts(removed, DATA_ONLY)).toEqual({ published: ["major", "biology"], latest: ["major", "biology"], current: ["major", "biology"] });
  });

  it("files nothing with no corrections given: the same brief is read as published", () => {
    const world = storedWorld();
    refile(world, "significance", "notable", EN_ONLY);
    const { rule, seen } = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [rule], corrections: [] }));
    const view = seen[0]!.views.findings.find((v) => v.id === PROTEIN)!;
    expect(view.latest.significance).toBe("major");
    const given = probe();
    validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: [given.rule] }));
    expect(given.seen[0]!.views.findings.find((v) => v.id === PROTEIN)!.latest.significance).toBe("notable");
  });
});

// ── What the one-brief run does not know ─────────────────────────────────────────────────────────

describe("validatePublished(): XREF, LANG_PARITY and FILE_LAYOUT judge what they are given", () => {
  it("passes each brief of the base world, English-only, bilingual and data-only alike, with every record given", () => {
    const world = storedWorld();
    for (const brief of world.briefs) {
      const result = validatePublished(brief, inputsOf(world, { rules: publishedRules }));
      expect(result.issues, brief.date).toEqual([]);
    }
  });

  it("reports a finding the brief names that no record given holds, at each place the brief names it", () => {
    const world = storedWorld();
    const result = validatePublished(briefOn(world, BILINGUAL), inputsOf(world, { rules: publishedRules, findings: world.findings.filter((f) => f.id !== LIGHT) }));
    expect(pathsOf(result.issues)).toEqual([
      `briefs/${BILINGUAL}.json: lead[0].finding_ids[0]`, `briefs/${BILINGUAL}.json: story.finding_id`, "glossary.json: terms[0].first_finding",
    ]);
    expect(result.issues[0]!.message).toBe(`${LIGHT} is named here, but findings/${LIGHT}.json does not exist.`);
    expect(result.issues[2]!.message).toBe(`Names ${LIGHT} as the finding that first used it, but findings/${LIGHT}.json does not exist.`);
  });

  it("does not know an edition other than the brief's, the archive index or the files of the folder, which only validateAll() reads", () => {
    const world = storedWorld();
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, finding_id: null, edition_date: "2026-11-30" });
    const brief = briefOn(world, BILINGUAL);
    brief.corrections[0] = { ...brief.corrections[0]!, finding_id: null, edition_date: "2026-11-30" };
    const result = validatePublished(brief, inputsOf(world, { rules: publishedRules }));
    expect(result.issues).toEqual([]);
    const strays = validatePublished(brief, inputsOf(world, { rules: publishedRules, publishing: BILINGUAL }));
    expect(strays.issues).toEqual([]);
  });

  it("holds an English-only edition to no Chinese string and a bilingual one to each", () => {
    const world = storedWorld();
    const english = briefOn(world, EN_ONLY);
    english.pace.sentence.zh = null;
    expect(validatePublished(english, inputsOf(world, { rules: publishedRules })).issues).toEqual([]);
    const both = briefOn(world, BILINGUAL);
    both.pace.sentence.zh = null;
    expect(pathsOf(validatePublished(both, inputsOf(world, { rules: publishedRules })).issues)).toEqual([`briefs/${BILINGUAL}.json: pace.sentence.zh`]);
  });

  it("holds a stored removed correction to its record: the finding it names is the one given", () => {
    const world = removedHowSure(storedWorld());
    const brief = briefOn(world, BILINGUAL);
    expect(validatePublished(brief, inputsOf(world, { rules: publishedRules })).issues).toEqual([]);
    findingOf(world, PROTEIN).explainer.how_sure = lz("Other text.", "別的文字。");
    expect(pathsOf(validatePublished(brief, inputsOf(world, { rules: publishedRules })).issues)).toEqual(["corrections.json: corrections[1].path"]);
    const edition = storedWorld();
    briefOn(edition, BILINGUAL).deep_dive = null;
    addRemoval(edition, { edition_date: BILINGUAL }, "deep_dive.text");
    expect(pathsOf(validatePublished(briefOn(edition, BILINGUAL), inputsOf(edition, { rules: publishedRules })).issues)).toEqual(["corrections.json: corrections[1].path"]);
  });
});

// ── Faults ───────────────────────────────────────────────────────────────────────────────────────

describe("validatePublished(): a rule that throws, and inputs it cannot read", () => {
  it("turns a rule that throws into one RULE_ERROR at (rule CODE) and still runs the others", () => {
    const world = storedWorld();
    const thrower = defineRule({ code: "XREF", scope: "published", check: () => { throw new Error("boom"); } });
    const brief = briefOn(world, BILINGUAL);
    brief.pace.sentence.zh = null;
    const langParity = publishedRules.filter((r) => r.codes[0] === "LANG_PARITY");
    const result = validatePublished(brief, inputsOf(world, { rules: [thrower, ...langParity] }));
    expect(result.ok).toBe(false);
    expect(triples(result.issues)).toEqual([
      ["LANG_PARITY", `briefs/${BILINGUAL}.json: pace.sentence.zh`, expect.stringContaining("needs a Chinese string")],
      ["RULE_ERROR", "(rule XREF)", "The check XREF stopped with an error (boom) and did not finish."],
    ].sort((a, b) => (String(a[1]) < String(b[1]) ? -1 : 1)));
    expect(result.brief).toEqual(brief);
  });

  it("turns inputs it cannot read into one RULE_ERROR at (engine) and still returns the brief, never throwing", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    const result = validatePublished(brief, inputsOf(world, { findings: [null as never, null as never], rules: publishedRules }));
    expect(result.ok).toBe(false);
    expect(result.brief).toEqual(brief);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "RULE_ERROR", path: "(engine)", severity: "error",
      hint: "This is a fault in the validator or its inputs, not in the content: report it.",
    });
    expect(result.issues[0]!.message).toMatch(/^The validator could not read its inputs \(.+\)\.$/);
    const single = validatePublished(brief, inputsOf(world, { findings: [null as never], rules: publishedRules }));
    expect(single.issues.map((i) => [i.code, i.path])).toEqual([["RULE_ERROR", "(engine)"]]);
  });

  it("turns a brief it cannot even read (a getter that throws) into one RULE_ERROR at (engine) with a null brief, never throwing, and runs no rule", () => {
    const world = storedWorld();
    const hostile = (thrown: unknown): unknown => {
      const copy = { ...briefOn(world, BILINGUAL) };
      Object.defineProperty(copy, "pace", { enumerable: true, get: () => { throw thrown; } });
      return copy;
    };
    const { rule, seen } = probe();
    const fromError = validatePublished(hostile(new Error("no pace for you")), inputsOf(world, { rules: [rule] }));
    expect(fromError.ok).toBe(false);
    expect(fromError.brief).toBeNull();
    expect(fromError.issues).toEqual([
      error("RULE_ERROR", "(engine)", "The validator could not read its inputs (no pace for you).",
        "This is a fault in the validator or its inputs, not in the content: report it."),
    ]);
    const fromText = validatePublished(hostile("a plain text"), inputsOf(world, { rules: [rule] }));
    expect(fromText.issues.map((i) => [i.code, i.path, i.message])).toEqual([["RULE_ERROR", "(engine)", "The validator could not read its inputs (a plain text)."]]);
    expect(fromText.brief).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("names what was thrown, an error's message or a plain value, and cuts a long message to 200 characters", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    const throwing = (value: unknown): ReadonlyMap<string, never> => {
      const map = new Map<string, never>([["x", null as never]]);
      map.values = () => { throw value; };
      return map;
    };
    const plain = validatePublished(brief, inputsOf(world, { findings: throwing("a plain text") }));
    expect(plain.issues[0]!.message).toBe("The validator could not read its inputs (a plain text).");
    const error = validatePublished(brief, inputsOf(world, { findings: throwing(new Error("an error message")) }));
    expect(error.issues[0]!.message).toBe("The validator could not read its inputs (an error message).");
    const long = validatePublished(brief, inputsOf(world, { findings: throwing(new Error("x".repeat(300))) }));
    expect(long.issues[0]!.message).toBe(`The validator could not read its inputs (${"x".repeat(200)}).`);
  });
});

// ── The whole registry ───────────────────────────────────────────────────────────────────────────

describe("validatePublished(): the whole registry on the hand-built world (these depend on the other groups' rules)", () => {
  it("passes each stored brief with every record given, archived and being published", () => {
    const world = storedWorld();
    for (const brief of world.briefs) {
      for (const publishing of [undefined, EN_ONLY, BILINGUAL, DATA_ONLY]) {
        const result = validatePublished(brief, inputsOf(world, { ...(publishing === undefined ? {} : { publishing }), fileDate: brief.date }));
        expect(result.issues, `${brief.date} publishing ${String(publishing)}`).toEqual([]);
      }
    }
  });

  it("fails a stored finding whose how_sure was rewritten with no removed correction beside it: REMOVED_TEXT written anywhere else is judged as any other text", () => {
    const world = removedHowSure(storedWorld());
    const brief = briefOn(world, BILINGUAL);
    expect(validatePublished(brief, inputsOf(world)).issues).toEqual([]);
    const without = validatePublished(brief, inputsOf(world, { corrections: world.corrections.filter((c) => c.type !== "removed") }));
    expect(without.errors.map((i) => [i.code, i.path])).toContainEqual(["WHO_SAYS", `findings/${PROTEIN}.json: explainer.how_sure.en`]);
  });
});
