// The English draft's entry point (SPEC §4.12, §8.6): `validateDraft()` parses the draft with the DraftBrief schema, returns
// SCHEMA issues alone when it fails, and otherwise runs every registered rule in draft mode on the input `buildDraftInput()`
// makes; `schemaIssues()` turns Zod's issues into SCHEMA issues; `toResult()` splits them by severity. The rules here are stubs
// written in the tests, so the engine is judged and no rule group is.
//
// Cyber's tests/validate.test.ts at the fork commit 3ced1fb, adapted: its "Unknown key" and "Missing key" cases are kept; a
// schema failure now runs no rule, and the inputs and the rules a run is given are this project's.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DraftBrief } from "@/lib/schema/draft";
import { RULES } from "@/lib/rules";
import { formatPath as formatPathOfTypes } from "@/lib/rules/types";
import {
  ARCHIVE_WARNING_CODES, ENGINE_CODES, INVISIBLE_LISTED_MAX, doorIssues, formatPath, invisibleIssues, schemaIssues, toResult, validateDraft,
  type Rule, type RuleInput, type ValidationIssue,
} from "@/lib/validate";
import { ARCHIVE_WARNING_CODES as RUN_ARCHIVE, ENGINE_CODES as RUN_ENGINE, sortIssues } from "@/lib/rules/run";
import { defineRule, error, warning } from "@/lib/rules/types";
import { D, deepFreeze, draftInputs, weekdayDraft, type Json } from "./helpers/rule-world";

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

// ── Invisible characters (F-32) ──────────────────────────────────────────────────────────────────

/** The character of a code point, built here so that no invisible character is typed into this file. */
const cp = (n: number): string => String.fromCodePoint(n);
const ZWSP = cp(0x200b);
const MESSAGE = (code: string, at: number): string => `Has an invisible character, U+${code}, at character ${at} (counting from 1).`;
const HINT = "Delete the character and use plain spaces and ordinary punctuation. Invisible characters hide words from the word counts and the word lists.";
const MORE = (n: number): string => `${n} more string${n === 1 ? " holds" : "s hold"} an invisible character; only the first 50 strings are listed.`;
const MORE_HINT = "Delete every invisible character and use plain spaces and ordinary punctuation, then validate again: the strings not listed are listed once these are fixed.";

/** Every kind the rule names: a code point, what it is, and its code as the message writes it. */
const INVISIBLE_KINDS: readonly [string, number, string][] = [
  ["a zero-width space", 0x200b, "200B"], ["a zero-width non-joiner", 0x200c, "200C"], ["a zero-width joiner", 0x200d, "200D"],
  ["a left-to-right mark", 0x200e, "200E"], ["a word joiner", 0x2060, "2060"], ["an invisible times", 0x2062, "2062"], ["a soft hyphen", 0xad, "00AD"],
  ["a byte order mark", 0xfeff, "FEFF"], ["a bidi override", 0x202e, "202E"], ["a bidi isolate", 0x2066, "2066"], ["a variation selector", 0xfe0f, "FE0F"],
  ["the Hangul filler", 0x3164, "3164"], ["the Mongolian vowel separator", 0x180e, "180E"], ["a combining grapheme joiner", 0x34f, "034F"],
  ["a null", 0x00, "0000"], ["a C0 control", 0x01, "0001"], ["a bell", 0x07, "0007"], ["the control before tab", 0x08, "0008"],
  ["a vertical tab", 0x0b, "000B"], ["a form feed", 0x0c, "000C"], ["the control after carriage return", 0x0e, "000E"], ["an escape", 0x1b, "001B"],
  ["the last C0 control", 0x1f, "001F"], ["a delete", 0x7f, "007F"], ["the first C1 control", 0x80, "0080"], ["a next line", 0x85, "0085"],
  ["the last C1 control", 0x9f, "009F"], ["a tag character", 0xe0041, "E0041"], ["the last tag character", 0xe007f, "E007F"],
  ["an ideographic variation selector", 0xe0100, "E0100"],
  // the characters outside the default-ignorable property that INVISIBLE holds too (F-61): a Braille blank, an object replacement character and format characters
  ["a Braille blank", 0x2800, "2800"], ["an object replacement character", 0xfffc, "FFFC"], ["an Arabic number sign", 0x0600, "0600"],
  ["a Syriac abbreviation mark", 0x070f, "070F"], ["an interlinear annotation anchor", 0xfff9, "FFF9"], ["a hieroglyph format control", 0x13430, "13430"],
  ["a Kaithi number sign", 0x110bd, "110BD"],
];

/** Characters that stay allowed: tab, line feed, carriage return, and every other white space or ordinary character. */
const VISIBLE_CHARACTERS: readonly [string, string][] = [
  ["a tab", cp(0x09)], ["a line feed", cp(0x0a)], ["a carriage return", cp(0x0d)], ["a space", " "], ["a no-break space", cp(0xa0)],
  ["a thin space", cp(0x2009)], ["a line separator", cp(0x2028)], ["a paragraph separator", cp(0x2029)], ["an ideographic space", cp(0x3000)],
  ["the first character after the C0 controls", cp(0x20)], ["the last ASCII character", cp(0x7e)], ["the first character after the C1 controls", cp(0xa0)],
  ["a replacement character", cp(0xfffd)], ["Han characters", "蛋白質"], ["an accented letter", "é"], ["an emoji", cp(0x1f600)],
  ["a Braille pattern that is not blank", cp(0x2801)], ["a private-use character", cp(0xe000)], ["a plane 15 private-use character", cp(0xf0000)],
];

describe("validateDraft(): a string with an invisible character is turned back as SCHEMA (F-32)", () => {
  const edit = (change: (d: Json) => void): Json => {
    const d = weekdayDraft() as unknown as Json;
    change(d);
    return d;
  };
  const inTitle = (text: string): Json => edit((d) => { d.new_findings[0].title = text; });
  const run = (draft: unknown) => {
    const { seen, rule } = watcher();
    const result = validateDraft(draft, { ...draftInputs(), rules: [rule] });
    return { result, ran: seen.length };
  };

  it("names each kind by its code point and its place, with the one hint, runs no rule and returns no draft", () => {
    for (const [name, code, hex] of INVISIBLE_KINDS) {
      const { result, ran } = run(inTitle(`A${cp(code)}B title`));
      expect(result.issues.map((i) => [i.code, i.severity, i.path, i.message, i.hint]), name).toEqual([
        ["SCHEMA", "error", "new_findings[0].title", MESSAGE(hex, 2), HINT],
      ]);
      expect(result.ok, name).toBe(false);
      expect(result.draft, name).toBeNull();
      expect(result.errors, name).toEqual(result.issues);
      expect(ran, `${name}: no rule runs`).toBe(0);
    }
  });

  it("keeps a tab, a line feed, a carriage return and every other visible or white-space character: the draft passes and its rules run", () => {
    for (const [name, text] of VISIBLE_CHARACTERS) {
      const { result, ran } = run(inTitle(`A${text}B title`));
      expect(result.issues, name).toEqual([]);
      expect(result.draft, name).not.toBeNull();
      expect(ran, name).toBe(1);
    }
  });

  it("is a draft that parses but is still turned back: one invisible character in an otherwise valid draft is the only issue", () => {
    expect(DraftBrief.safeParse(inTitle(`A${ZWSP}B title`)).success).toBe(true);
    expect(validateDraft(inTitle(`A${ZWSP}B title`), draftInputs()).issues).toHaveLength(1);
    expect(validateDraft(weekdayDraft(), { ...draftInputs(), rules: [] }).issues).toEqual([]);
  });

  it("counts the place in characters from 1, an astral character as one, and names only the first invisible character of a string", () => {
    const at = (text: string): string => run(inTitle(text)).result.issues[0]!.message;
    expect(at(`${ZWSP}A title`)).toBe(MESSAGE("200B", 1));
    expect(at(`${cp(0x1f600)}${cp(0x1f600)}A${ZWSP}title`)).toBe(MESSAGE("200B", 4));
    expect(at(`蛋白質${ZWSP}A title`)).toBe(MESSAGE("200B", 4));
    // the edge of the astral planes: U+FFFF is the last character that takes one UTF-16 unit, U+10000 the first that takes two
    expect(at(`${cp(0xffff)}A${ZWSP}title`)).toBe(MESSAGE("200B", 3));
    expect(at(`${cp(0x10000)}A${ZWSP}title`)).toBe(MESSAGE("200B", 3));
    expect(at(`${cp(0x10000)}${ZWSP}title`)).toBe(MESSAGE("200B", 2));
    expect(at(`A title${cp(0x2060)}${ZWSP}${cp(0xfeff)}`)).toBe(MESSAGE("2060", 8));
    expect(run(inTitle(`A${ZWSP}${ZWSP}${ZWSP}B`)).result.issues).toHaveLength(1);
  });

  it("reads the string wherever it stands: each field of a record, an array element, a nested record, the Lead and the draft's own corrections", () => {
    const paths: [string, (d: Json) => void][] = [
      ["lead[1].text", (d) => { d.lead[1].text += ZWSP; }],
      ["new_findings[1].explainer.how_sure", (d) => { d.new_findings[1].explainer.how_sure += ZWSP; }],
      ["new_findings[0].reactions[0].quote", (d) => { d.new_findings[0].reactions[0].quote += ZWSP; }],
      ["new_findings[0].sources[1].title", (d) => { d.new_findings[0].sources[1].title += ZWSP; }],
      ["new_findings[0].terms[0].definition", (d) => { d.new_findings[0].terms[0].definition += ZWSP; }],
      ["new_findings[0].ai.evidence[0].quote", (d) => { d.new_findings[0].ai.evidence[0].quote += ZWSP; }],
      ["returning[0].rung.note", (d) => { d.returning[0].rung.note += ZWSP; }],
      ["corrections[1].reason", (d) => { d.corrections[1].reason += ZWSP; }],
      ["report_decisions[0].reason", (d) => { d.report_decisions[0].reason += ZWSP; }],
      ["also[0].title", (d) => { d.also[0].title += ZWSP; }],
      ["story", (d) => { d.story += ZWSP; }],
    ];
    for (const [path, change] of paths) {
      const { result } = run(edit(change));
      const found = result.issues.filter((i) => i.message.includes("invisible character"));
      expect(found.map((i) => i.path), path).toEqual([path]);
    }
  });

  it("gives one issue for each string that holds one, in the engine's path order, and none for the strings that hold none", () => {
    const { result } = run(edit((d) => { d.new_findings[1].title += ZWSP; d.new_findings[0].title += cp(0xad); d.lead[0].text += cp(0x2060); }));
    expect(result.issues.map((i) => [i.path, i.message])).toEqual([
      ["lead[0].text", MESSAGE("2060", 37)], ["new_findings[0].title", MESSAGE("00AD", 24)], ["new_findings[1].title", MESSAGE("200B", 20)],
    ]);
    expect(result.issues).toEqual(sortIssues(result.issues));
  });

  it("gives both kinds of SCHEMA issue in one round, whether or not the schema passed, in the engine's order", () => {
    const draft = edit((d) => { d.deep_dive = 5; d.new_findings[0].title += ZWSP; d.zeta = "x"; });
    const { result, ran } = run(draft);
    expect(result.issues.map((i) => [i.path, i.message])).toEqual([
      ["deep_dive", expect.stringContaining("expected object")], ["new_findings[0].title", MESSAGE("200B", 24)], ["zeta", 'Unknown key "zeta"; remove it.'],
    ]);
    expect(result.issues.every((i) => i.code === "SCHEMA" && i.severity === "error")).toBe(true);
    expect(result.draft).toBeNull();
    expect(ran).toBe(0);
    // a string the schema refuses by its own check is read too
    const refused = run(edit((d) => { d.new_findings[0].go_deeper = [`s1${ZWSP}`]; }));
    expect(refused.result.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["new_findings[0].go_deeper[0]"]));
    expect(refused.result.issues.filter((i) => i.path === "new_findings[0].go_deeper[0]").map((i) => i.message)).toContain(MESSAGE("200B", 3));
  });

  it("does not read an object key: a key with an invisible character is an unknown key, and only its value's own characters are reported", () => {
    const keyed = run(edit((d) => { d[`extra${ZWSP}`] = "plain"; }));
    expect(keyed.result.issues.map((i) => [i.path, i.message])).toEqual([[`["extra${ZWSP}"]`, `Unknown key "extra${ZWSP}"; remove it.`]]);
    const both = run(edit((d) => { d[`extra${ZWSP}`] = `a${ZWSP}b`; }));
    // one path, so the engine's order falls to the message
    expect(both.result.issues.map((i) => i.message)).toEqual([MESSAGE("200B", 2), `Unknown key "extra${ZWSP}"; remove it.`]);
  });

  it("reads a draft that is only a string, and never throws on a value that is no draft", () => {
    for (const value of [null, undefined, 5, true, [], {}, "draft", [ZWSP], { a: [{ b: null }] }]) expect(() => validateDraft(value, draftInputs()), String(value)).not.toThrow();
    expect(run(`a${ZWSP}b`).result.issues.map((i) => [i.path, i.message])).toContainEqual(["(root)", MESSAGE("200B", 2)]);
    expect(run([`x`, `a${ZWSP}`]).result.issues.map((i) => i.path)).toContain("[1]");
  });

  it("reads the draft alone: the evidence, the metrics and the pack may hold such characters and are not walked", () => {
    const inputs = draftInputs();
    const url = Object.keys(inputs.evidence.texts)[0]!;
    inputs.evidence.texts[url] += ZWSP;
    inputs.metrics.pace.sentence.en += ZWSP;
    inputs.pack.candidates[0]!.title += ZWSP;
    const { rule, seen } = watcher();
    const result = validateDraft(weekdayDraft(), { ...inputs, rules: [rule] });
    expect(result.issues).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("is pure and deterministic: the same issues twice, and a frozen draft is not changed", () => {
    const draft = deepFreeze(edit((d) => { d.new_findings[0].title += ZWSP; d.lead[0].text += cp(0xfeff); }));
    const first = validateDraft(draft, draftInputs());
    expect(validateDraft(draft, draftInputs())).toEqual(first);
    expect(first.issues).toHaveLength(2);
  });

  it("lists at most 50 strings and counts the rest in one summary issue that stands last, whatever its path would sort to", () => {
    const many = (n: number): Json => edit((d) => { d.new_findings[0].go_deeper = Array.from({ length: n }, (_, i) => `s${i}${ZWSP}`); });
    const at50 = validateDraft(many(50), draftInputs());
    expect(at50.issues.filter((i) => i.message.includes("invisible character"))).toHaveLength(50);
    expect(at50.issues.some((i) => i.message.includes("more string"))).toBe(false);
    const at51 = validateDraft(many(51), draftInputs());
    expect(at51.issues.at(-1)).toEqual({ code: "SCHEMA", severity: "error", path: "(root)", message: MORE(1), hint: MORE_HINT });
    expect(at51.issues.filter((i) => i.message.includes("invisible character, U+"))).toHaveLength(50);
    const at120 = validateDraft(many(120), draftInputs());
    expect(at120.issues.at(-1)).toEqual({ code: "SCHEMA", severity: "error", path: "(root)", message: MORE(70), hint: MORE_HINT });
    const listed = at120.issues.filter((i) => i.message.includes("invisible character, U+"));
    expect(listed.map((i) => i.path)).toEqual(Array.from({ length: 50 }, (_, i) => `new_findings[0].go_deeper[${i}]`));
    expect(at120.draft).toBeNull();
    expect(at120.issues.slice(0, -1)).toEqual(sortIssues(at120.issues.slice(0, -1)));
  });

  it("reads the draft as it was written, not as the schema returns it: past 50 strings, the first 50 in the file's own key order are listed", () => {
    // every free-text string of the weekday draft that stays valid with one more character: more than 50 of them, so a draft that still parses is cut
    const base = weekdayDraft() as unknown as Json;
    const marked = (path: readonly (string | number)[]): Json => {
      const copy = JSON.parse(JSON.stringify(base)) as Json;
      let at: any = copy;
      for (const key of path.slice(0, -1)) at = at[key];
      at[path.at(-1)!] += ZWSP;
      return copy;
    };
    const leaves: (string | number)[][] = [];
    const collect = (value: unknown, path: (string | number)[]): void => {
      if (typeof value === "string") leaves.push(path);
      else if (typeof value === "object" && value !== null) for (const [key, child] of Object.entries(value)) collect(child, [...path, Array.isArray(value) ? Number(key) : key]);
    };
    collect(base, []);
    const safe = leaves.filter((path) => DraftBrief.safeParse(marked(path)).success);
    expect(safe.length).toBeGreaterThan(INVISIBLE_LISTED_MAX + 5);
    const all = JSON.parse(JSON.stringify(base)) as Json;
    for (const path of safe) {
      let at: any = all;
      for (const key of path.slice(0, -1)) at = at[key];
      at[path.at(-1)!] += ZWSP;
    }
    expect(DraftBrief.safeParse(all).success).toBe(true);
    // the same draft with its top-level keys in the opposite order: the schema returns them in its own order, the file lists them in this one
    const written = Object.fromEntries(Object.entries(all).reverse());
    const listed = invisibleIssues(written).listed.map((i) => i.path).sort();
    expect(listed).toHaveLength(INVISIBLE_LISTED_MAX);
    const result = validateDraft(written, draftInputs());
    expect(result.draft).toBeNull();
    expect(result.issues.filter((i) => i.path !== "(root)").map((i) => i.path).sort()).toEqual(listed);
    expect(result.issues.at(-1)!.message).toBe(MORE(safe.length - INVISIBLE_LISTED_MAX));
  });

  it("ends a draft of 100,000 invisible strings with 51 invisible-character issues at most, fast", () => {
    const started = performance.now();
    const scan = invisibleIssues({ strings: Array.from({ length: 100_000 }, (_, i) => `t${i}${ZWSP}`) });
    expect(scan.listed).toHaveLength(50);
    expect(scan.summary).toEqual({ code: "SCHEMA", severity: "error", path: "(root)", message: MORE(99_950), hint: MORE_HINT });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(doorIssues([], scan)).toHaveLength(51);
  });
});

describe("invisibleIssues(): the walk over a parsed draft (F-32)", () => {
  const walk = (value: unknown) => invisibleIssues(value);
  const paths = (value: unknown): string[] => walk(value).listed.map((i) => i.path);

  it("lists the limit it holds, and returns nothing for a value with no string that holds one", () => {
    expect(INVISIBLE_LISTED_MAX).toBe(50);
    for (const value of [null, undefined, 0, 7.5, true, false, "plain", "", [], {}, [[], {}, ["a", { b: "c" }]], { a: 1, b: null, c: ["d"] }]) {
      expect(walk(value), JSON.stringify(value)).toEqual({ listed: [], summary: null });
    }
  });

  it("writes each path as the engine's other SCHEMA issues do: a root string, an index, a key, a key that needs brackets", () => {
    expect(paths(`a${ZWSP}`)).toEqual(["(root)"]);
    expect(paths([`a${ZWSP}`, "b", [`c${ZWSP}`]])).toEqual(["[0]", "[2][0]"]);
    expect(paths({ a: { b: [`x${ZWSP}`] }, "rung.phys-1": `y${ZWSP}`, 'q"uote': `z${ZWSP}` })).toEqual(["a.b[0]", '["rung.phys-1"]', '["q\\"uote"]']);
  });

  it("walks in document order, arrays by index and objects by key order, and lists the first strings when it must cut", () => {
    const value = { b: `1${ZWSP}`, a: [`2${ZWSP}`, { z: `3${ZWSP}`, y: `4${ZWSP}` }], c: `5${ZWSP}` };
    expect(paths(value)).toEqual(["b", "a[0]", "a[1].z", "a[1].y", "c"]);
  });

  it("does not read a key, a number or a flag, and reads an inherited-free own value only", () => {
    expect(paths({ [`k${ZWSP}`]: "plain" })).toEqual([]);
    expect(paths({ n: 5, t: true, f: false, z: null, u: undefined })).toEqual([]);
    const proto = Object.create({ inherited: `x${ZWSP}` }) as Record<string, unknown>;
    proto.own = "plain";
    expect(paths(proto)).toEqual([]);
  });

  it("is linear and total: a string of a million characters, a nest 100,000 deep and a structure that holds itself", () => {
    const started = performance.now();
    expect(walk("a".repeat(1_000_000))).toEqual({ listed: [], summary: null });
    const long = `${"a".repeat(999_999)}${ZWSP}`;
    expect(walk(long).listed.map((i) => i.message)).toEqual([MESSAGE("200B", 1_000_000)]);
    expect(walk(ZWSP.repeat(1_000_000)).listed).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(2000);
    let deep: unknown = `x${ZWSP}`;
    for (let i = 0; i < 100_000; i++) deep = [deep];
    const found = walk(deep).listed;
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe("[0]".repeat(100_000));
    const cyclic: Record<string, unknown> = { s: `a${ZWSP}` };
    cyclic.self = cyclic;
    cyclic.list = [cyclic, `b${ZWSP}`];
    expect(paths(cyclic)).toEqual(["s", "list[1]"]);
  });

  it("lists an own value once, whatever its key is called: a key named undefined or __proto__ is read like any other", () => {
    expect(paths({ undefined: `a${ZWSP}` })).toEqual(["undefined"]);
    expect(paths({ undefined: `a${ZWSP}`, other: `b${ZWSP}` })).toEqual(["undefined", "other"]);
    expect(paths({ list: [`a${ZWSP}`], null: `b${ZWSP}` })).toEqual(["list[0]", "null"]);
    // JSON.parse makes `__proto__` an own data property, which the walk reads and the prototype does not hide
    expect(paths(JSON.parse(`{"__proto__": "a\\u200Bb", "x": {"__proto__": ["\\u200B"]}}`) as unknown)).toEqual(["__proto__", "x.__proto__[0]"]);
  });

  it("names a character outside the Basic Multilingual Plane by its whole code point, in four to six capital hex digits", () => {
    expect(walk(`a${cp(0xe0041)}`).listed[0]!.message).toBe(MESSAGE("E0041", 2));
    expect(walk(cp(0x0)).listed[0]!.message).toBe(MESSAGE("0000", 1));
    expect(walk(`${cp(0x1f600)}${cp(0x1f600)}${cp(0xe0100)}`).listed[0]!.message).toBe(MESSAGE("E0100", 3));
  });

  it("puts the summary after the listed strings in doorIssues(), after the schema's own issues sorted among them", () => {
    const scan = walk({ list: Array.from({ length: 52 }, () => `a${ZWSP}`) });
    const schema = [{ code: "SCHEMA", severity: "error" as const, path: "zeta", message: "Unknown key.", hint: null }, { code: "SCHEMA", severity: "error" as const, path: "(root)", message: "Wrong.", hint: null }];
    const issues = doorIssues(schema, scan);
    expect(issues).toHaveLength(53);
    expect(issues.at(-1)).toEqual(scan.summary);
    expect(issues.slice(0, 51).map((i) => i.path)).toEqual(["(root)", ...Array.from({ length: 50 }, (_, i) => `list[${i}]`)]);
    expect(issues.at(-2)!.path).toBe("zeta");
    expect(doorIssues([], { listed: [], summary: null })).toEqual([]);
  });
});

describe("the fixture drafts hold no invisible character (F-32)", () => {
  const files = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...files(full));
      else if (entry.name.endsWith(".json")) out.push(full);
    }
    return out;
  };

  it("holds no string with an invisible character in any fixture draft, English or Chinese, nor in its context, evidence, metrics or pack, so no fixture gains a SCHEMA issue", () => {
    const root = path.join(__dirname, "..", "fixtures");
    const all = ["drafts", "drafts-zh", "injection", "context", "evidence", "metrics", "packs"].flatMap((d) => files(path.join(root, d)));
    expect(all.length).toBeGreaterThan(60);
    for (const file of all) {
      const scan = invisibleIssues(JSON.parse(fs.readFileSync(file, "utf8")));
      expect([path.relative(root, file), scan.listed.map((i) => i.path)]).toEqual([path.relative(root, file), []]);
    }
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
