// The English draft's entry point (SPEC §4.12, §8.6): `validateDraft()` parses the draft with the DraftBrief schema, returns
// SCHEMA issues alone when it fails, and otherwise runs every registered rule in draft mode on the input `buildDraftInput()`
// makes; `schemaIssues()` turns Zod's issues into SCHEMA issues; `toResult()` splits them by severity. The rules here are stubs
// written in the tests, so the engine is judged and no rule group is.
//
// Cyber's tests/validate.test.ts at the fork commit 3ced1fb, adapted: its "Unknown key" and "Missing key" cases are kept; a
// schema failure now runs no rule, and the inputs and the rules a run is given are this project's.

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DraftBrief } from "@/lib/schema/draft";
import { RULES } from "@/lib/rules";
import { formatPath as formatPathOfTypes } from "@/lib/rules/types";
import {
  ARCHIVE_WARNING_CODES, ENGINE_CODES, formatPath, schemaIssues, toResult, validateDraft, type Rule, type RuleInput, type ValidationIssue,
} from "@/lib/validate";
import { ARCHIVE_WARNING_CODES as RUN_ARCHIVE, ENGINE_CODES as RUN_ENGINE } from "@/lib/rules/run";
import { defineRule, error, warning } from "@/lib/rules/types";
import { D, draftInputs, weekdayDraft, type Json } from "./helpers/rule-world";

const watcher = () => {
  const seen: RuleInput[] = [];
  const rule: Rule = defineRule({ code: "COUNTS", scope: "draft", check: (input) => { seen.push(input); return []; } });
  return { seen, rule };
};

const codesOf = (issues: readonly ValidationIssue[]) => issues.map((i) => i.code);

describe("validateDraft(): a draft that parses", () => {
  it("runs the rules it is given on the draft as parsed, and returns the draft", () => {
    const { seen, rule } = watcher();
    const result = validateDraft(weekdayDraft(), { ...draftInputs(), rules: [rule] });
    expect(result).toMatchObject({ ok: true, errors: [], warnings: [], issues: [] });
    expect(result.draft).toEqual(DraftBrief.parse(weekdayDraft()));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.mode).toBe("draft");
    expect(seen[0]!.date).toBe(D);
    expect(seen[0]!.edition).toBe("weekday");
    expect(seen[0]!.mode === "draft" && seen[0]!.draft.brief).toBe(result.draft);
  });

  it("returns the rules' issues in the engine's order, with ok false only for an error", () => {
    const rule = defineRule({
      code: ["COUNTS", "WORDS"], scope: "draft",
      check: () => [warning("WORDS", "title", "Long."), error("COUNTS", "items", "Too many."), warning("WORDS", "date", "Odd.")],
    });
    const result = validateDraft(weekdayDraft(), { ...draftInputs(), rules: [rule] });
    expect(result.issues.map((i) => i.path)).toEqual(["date", "items", "title"]);
    expect(result.ok).toBe(false);
    expect(codesOf(result.errors)).toEqual(["COUNTS"]);
    expect(codesOf(result.warnings)).toEqual(["WORDS", "WORDS"]);
    const soft = defineRule({ code: "WORDS", scope: "draft", severity: "warning", check: () => [warning("WORDS", "title", "Long.")] });
    expect(validateDraft(weekdayDraft(), { ...draftInputs(), rules: [soft] }).ok).toBe(true);
  });

  it("runs no rule outside draft mode", () => {
    const check = vi.fn(() => [] as ValidationIssue[]);
    const rules = [defineRule({ code: "XREF", scope: "published", check }), defineRule({ code: "ZH_KEYS", scope: "zh", check })];
    expect(validateDraft(weekdayDraft(), { ...draftInputs(), rules }).issues).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  it("warns once for each missing input, skips the checks that need it, and still passes", () => {
    const check = vi.fn(() => [] as ValidationIssue[]);
    const rules = [defineRule({ code: "SOURCE_SEEN", scope: "draft", needs: ["evidence"], check }), defineRule({ code: "NUMBER_SOURCED", scope: "draft", needs: ["evidence", "metrics", "pack"], check })];
    const { context, config } = draftInputs();
    const result = validateDraft(weekdayDraft(), { context, config, rules });
    expect(check).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["INPUT_MISSING", "warning", "(evidence)"], ["INPUT_MISSING", "warning", "(metrics)"], ["INPUT_MISSING", "warning", "(pack)"],
    ]);
    expect(result.warnings).toEqual(result.issues);
    expect(result.draft).not.toBeNull();
  });

  it("runs the registry's rules by default", () => {
    const inputs = draftInputs();
    expect(validateDraft(weekdayDraft(), inputs)).toEqual(validateDraft(weekdayDraft(), { ...inputs, rules: RULES }));
  });

  it("turns inputs it cannot read into one RULE_ERROR on the engine, never a throw", () => {
    const { rule, seen } = watcher();
    const inputs = { ...draftInputs(), context: null as unknown as ReturnType<typeof draftInputs>["context"], rules: [rule] };
    const result = validateDraft(weekdayDraft(), inputs);
    expect(seen).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: "RULE_ERROR", severity: "error", path: "(engine)" });
    expect(result.issues[0]!.message).toMatch(/^The validator could not read its inputs \(.+\)\.$/);
    expect(result.issues[0]!.hint).toContain("not in the draft");
    expect(result.draft).not.toBeNull();
  });

  it("gives the fault's own words, cut to 200 characters", () => {
    const failing = (why: string) => new Proxy({}, { get: () => { throw new Error(why); } }) as ReturnType<typeof draftInputs>["context"];
    const at = (why: string) => validateDraft(weekdayDraft(), { ...draftInputs(), context: failing(why) }).issues[0]!.message;
    expect(at("boom")).toBe("The validator could not read its inputs (boom).");
    expect(at("y".repeat(250))).toBe(`The validator could not read its inputs (${"y".repeat(200)}).`);
  });

  it("changes neither the draft nor its inputs", () => {
    const draft = weekdayDraft();
    const inputs = draftInputs();
    const before = JSON.stringify([draft, inputs.context, inputs.evidence, inputs.metrics, inputs.pack]);
    validateDraft(draft, inputs);
    expect(JSON.stringify([draft, inputs.context, inputs.evidence, inputs.metrics, inputs.pack])).toBe(before);
  });
});

describe("validateDraft(): a draft that does not parse", () => {
  const run = (draft: unknown) => {
    const { seen, rule } = watcher();
    const result = validateDraft(draft, { ...draftInputs(), rules: [rule] });
    expect(seen, "no rule runs on a malformed draft").toEqual([]);
    expect(result.draft).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(result.issues);
    expect(result.warnings).toEqual([]);
    expect(new Set(codesOf(result.issues))).toEqual(new Set(["SCHEMA"]));
    return result.issues;
  };
  const edit = (change: (d: Json) => void): unknown => {
    const d = weekdayDraft() as unknown as Json;
    change(d);
    return d;
  };

  it("names an unknown key at the root or deeper, one issue a key, in path order", () => {
    const issues = run(edit((d) => { d.zeta = 1; d.alpha = 2; (d.new_findings as Json[])[0]!.extra = true; }));
    expect(issues.map((i) => [i.path, i.message])).toEqual([
      ["alpha", 'Unknown key "alpha"; remove it.'], ["new_findings[0].extra", 'Unknown key "extra"; remove it.'], ["zeta", 'Unknown key "zeta"; remove it.'],
    ]);
    expect(issues[0]!.hint).toContain("Only keys the schema defines");
  });

  it("tells a missing key from a value of the wrong type", () => {
    const missing = run(edit((d) => { delete d.deep_dive; }));
    expect(missing.map((i) => i.path)).toEqual(["deep_dive"]);
    expect(missing[0]!.message).toMatch(/^Missing key \(expected .+\)\.$/);
    expect(missing[0]!.hint).toBe("Every key is required; use null or [] when there is nothing to report.");
    const wrong = run(edit((d) => { d.deep_dive = 5; }));
    expect(wrong.map((i) => i.path)).toEqual(["deep_dive"]);
    expect(wrong[0]!.message).not.toMatch(/^Missing key/);
    expect(wrong[0]!.hint).toContain("Change the value");
  });

  it("gives the message of a draft correction's own checks, at the key it names", () => {
    const issues = run(edit((d) => { (d.corrections as Json[])[0]!.type = "removed"; }));
    expect(issues.map((i) => i.path)).toContain("corrections[0].path");
    const onPath = issues.find((i) => i.path === "corrections[0].path")!;
    expect(onPath.message).toMatch(/^A removed correction rewrites one text/);
    expect(onPath.hint).toBe("One of the schema's own checks on the value; change it as the message says.");
  });

  it("gives the message of the AI role's check, which needs an evidence entry", () => {
    const issues = run(edit((d) => { (((d.new_findings as Json[])[0]!.ai as Json).evidence as unknown[]).length = 0; }));
    expect(issues.map((i) => [i.path, i.message])).toContainEqual(["new_findings[0].ai.evidence", "An AI role needs at least one evidence entry"]);
  });

  it("reports a value that is no draft at all at the root", () => {
    for (const value of [null, undefined, 5, "draft", []]) {
      const issues = run(value);
      expect(issues.map((i) => i.path), String(value)).toEqual(["(root)"]);
    }
  });

  it("orders the issues as the engine does, whatever order Zod finds them in", () => {
    const issues = run(edit((d) => { d.deep_dive = 5; d.date = 7; (d.new_findings as Json[])[1]!.title = 3; }));
    expect(issues.map((i) => i.path)).toEqual(["date", "deep_dive", "new_findings[1].title"]);
  });
});

describe("schemaIssues()", () => {
  const Shape = z.strictObject({
    name: z.string(),
    count: z.number(),
    level: z.enum(["low", "high"]),
    form: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("a"), a: z.string() }), z.strictObject({ kind: z.literal("b") })]),
    even: z.number().refine((n) => n % 2 === 0, "count must be even"),
  });
  const good = { name: "n", count: 1, level: "low", form: { kind: "b" }, even: 2 };
  const issuesOf = (value: unknown, pass = true) => {
    const parsed = Shape.safeParse(value);
    if (parsed.success) throw new Error("expected a failure");
    return schemaIssues(parsed.error, pass ? value : undefined);
  };

  it("writes a missing key with what was expected, with the input or without it", () => {
    const { name: _name, level: _level, ...rest } = good;
    for (const pass of [true, false]) {
      const byPath = Object.fromEntries(issuesOf(rest, pass).map((i) => [i.path, i.message]));
      expect(byPath.name, String(pass)).toBe("Missing key (expected string).");
      if (pass) expect(byPath.level).toBe('Missing key (expected "low" or "high").');
    }
  });

  it("reads a value of the wrong type as no missing key, with the input or without it", () => {
    for (const pass of [true, false]) {
      const [wrong] = issuesOf({ ...good, count: "1" }, pass);
      expect(wrong!.message, String(pass)).toBe("Invalid input: expected number, received string");
    }
  });

  it("writes a union no form of which matches, naming the discriminator's values", () => {
    const [issue] = issuesOf({ ...good, form: { kind: "c" } });
    expect(issue).toEqual({
      code: "SCHEMA", severity: "error", path: "form.kind", message: 'Does not match any allowed form for this field ("kind" must be "a" or "b").',
      hint: "Check the field's description in the draft schema for the allowed forms.",
    });
    const [nested] = issuesOf({ ...good, form: "x" });
    expect(nested).toMatchObject({ path: "form", message: "Invalid input: expected object, received string" });
  });

  it("writes a refinement's own message with the check's hint, and any other issue with Zod's message", () => {
    const [odd] = issuesOf({ ...good, even: 3 });
    expect(odd).toEqual({ code: "SCHEMA", severity: "error", path: "even", message: "count must be even", hint: "One of the schema's own checks on the value; change it as the message says." });
    const [wrong] = issuesOf({ ...good, count: "1" });
    expect(wrong!.path).toBe("count");
    expect(wrong!.message).not.toMatch(/Missing key/);
    expect(wrong!.hint).toBe("Change the value to one the schema allows; the field's description in the draft schema says which.");
  });

  it("writes one issue for each unknown key, and none for an object that parses", () => {
    expect(issuesOf({ ...good, b: 1, a: 2 }).map((i) => i.path)).toEqual(["b", "a"]);
    expect(Shape.safeParse(good).success).toBe(true);
  });

  it("reads a key under a value that is no object as a wrong value, not a missing key", () => {
    const err = new z.ZodError([{ code: "invalid_type", expected: "string", path: ["a", "b"], message: "Expected a string." } as z.core.$ZodIssue]);
    for (const input of [{ a: 5 }, { a: null }, { a: "text" }]) expect(schemaIssues(err, input)[0]!.message, JSON.stringify(input)).toBe("Expected a string.");
    expect(schemaIssues(err, { a: {} })[0]!.message).toBe("Missing key (expected string).");
    expect(schemaIssues(err, { a: { b: 1 } })[0]!.message).toBe("Expected a string.");
    const deep = new z.ZodError([{ code: "invalid_type", expected: "string", path: ["a", "b", "c"], message: "Expected a string." } as z.core.$ZodIssue]);
    for (const input of [{ a: 5 }, { a: null }, {}]) expect(schemaIssues(deep, input)[0]!.message, JSON.stringify(input)).toBe("Expected a string.");
    expect(schemaIssues(deep, { a: { b: {} } })[0]!.message).toBe("Missing key (expected string).");
  });

  it("reads a union with no discriminator as matching no form", () => {
    const Either = z.union([z.string(), z.number()]);
    const parsed = Either.safeParse(true);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(schemaIssues(parsed.error, true)).toEqual([{
      code: "SCHEMA", severity: "error", path: "(root)", message: "Does not match any allowed form for this field.",
      hint: "Check the field's description in the draft schema for the allowed forms.",
    }]);
  });
});

describe("toResult() and the names validate.ts passes on", () => {
  it("splits issues by severity into new lists, ok while there is no error", () => {
    const issues = [warning("WORDS", "a", "w"), error("COUNTS", "b", "e")];
    const result = toResult(issues);
    expect(result).toEqual({ ok: false, errors: [issues[1]], warnings: [issues[0]], issues });
    expect(result.issues).not.toBe(issues);
    expect(toResult([issues[0]!]).ok).toBe(true);
    expect(toResult([])).toEqual({ ok: true, errors: [], warnings: [], issues: [] });
  });

  it("passes on the engine's names unchanged", () => {
    expect(formatPath).toBe(formatPathOfTypes);
    expect(ARCHIVE_WARNING_CODES).toBe(RUN_ARCHIVE);
    expect(ENGINE_CODES).toBe(RUN_ENGINE);
  });
});
