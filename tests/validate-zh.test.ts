// validateZh() (SPEC §4.12, §8.6): the Chinese pass's entry point of the validator. It parses the Chinese draft with DraftZh and the
// English draft with DraftBrief (a draft that fails is judged by its SCHEMA issues alone, the English one's with `en.` in front of
// the path), builds the zh-mode input and runs every registered rule that lists the zh mode: the group's own eleven codes, the
// safety group's four and DATE_MISMATCH. These tests check the engine around the rules: what is parsed, what is run, what is returned, what is read
// and what is never touched. The rules themselves are tests/rules-zh.test.ts.
//
// New for this project; Cyber has no Chinese pass. The shape is tests/validate-draft-engine.test.ts's (Cyber's idea).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RULES, codesOfGroup } from "@/lib/rules/index";
import { sortIssues } from "@/lib/rules/run";
import { defineRule, formatPath, type Rule, type RuleInput, type RuleMode, type ValidationIssue } from "@/lib/rules/types";
import { zhKeyed } from "@/lib/rules/strings";
import { DraftZh } from "@/lib/schema/draft-zh";
import { buildZhInput, validateZh } from "@/lib/validate-zh";
import { CANARY_TOKEN } from "@/lib/vocab";
import { D, MONDAY, SUNDAY, deepFreeze, storedFinding, storedWorld } from "./helpers/rule-world";
import { addString, dropKey, inputsOf, setEn, setZh, zhIssues, zhWorld, type ZhWorld } from "./helpers/zh-world";

const EM = String.fromCharCode(0x2014);
const KEY = (key: string): string => formatPath(["strings", key]);
const ZH_CODES = codesOfGroup("zh");

/** A rule of the given scope that records the input it was run with and returns no issue. */
function recorder(code: string, scope: RuleMode): { rule: Rule; seen: RuleInput[] } {
  const seen: RuleInput[] = [];
  const rule = defineRule({ code, scope, check: (input: RuleInput) => { seen.push(input); return []; } });
  return { rule, seen };
}

/** The result of the engine on a world, the world's own two drafts and inputs. */
const run = (w: ZhWorld, rules?: readonly Rule[]) => validateZh(w.draft, w.english, inputsOf(w), rules === undefined ? {} : { rules });

describe("validateZh(): a valid Chinese edition", () => {
  it("is ok with no issue of any group for each valid world, and returns the parsed draft", () => {
    for (const opts of [{}, { review: true }, { deepDive: true }, { review: true, deepDive: true }]) {
      const w = zhWorld(opts);
      const result = run(w);
      expect(result.issues, JSON.stringify(opts)).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.draft).toEqual(DraftZh.parse(w.draft));
    }
  });

  it("takes plain parsed JSON: the drafts after a round trip through text give the same result", () => {
    const w = zhWorld({ review: true });
    const result = validateZh(JSON.parse(JSON.stringify(w.draft)), JSON.parse(JSON.stringify(w.english)), inputsOf(w));
    expect(result.issues).toEqual([]);
    expect(result.draft).toEqual(w.draft);
  });

  it("returns the frame's result: ok, errors, warnings and issues, the last split by severity in the engine's order, and the draft", () => {
    const w = zhWorld();
    w.evidence = null;
    setZh(w, "ideas.0", `這${EM}`);
    delete w.draft.strings["lead.1"];
    const result = run(w);
    expect(Object.keys(result).sort()).toEqual(["draft", "errors", "issues", "ok", "warnings"]);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(sortIssues(result.issues));
    expect(result.errors).toEqual(result.issues.filter((i) => i.severity === "error"));
    expect(result.warnings).toEqual(result.issues.filter((i) => i.severity === "warning"));
    expect(result.warnings.map((i) => i.code)).toEqual(["INPUT_MISSING"]);
    expect(result.errors.map((i) => i.code)).toContain("ZH_NO_DASH");
    expect(result.errors.map((i) => i.code)).toContain("ZH_KEYS");
    expect(result.draft).not.toBeNull();
  });

  it("is still ok when the only issue is a warning: no evidence gives one INPUT_MISSING that names ZH_OFFICIAL", () => {
    const w = zhWorld();
    w.evidence = null;
    const result = run(w);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.code).toBe("INPUT_MISSING");
    expect(result.warnings[0]!.message).toContain("ZH_OFFICIAL");
    // the Chinese pass's own file, not the English run's (F-21)
    expect(result.warnings[0]!.message).toMatch(/^No Chinese evidence for \d{4}-\d{2}-\d{2}, so /);
    expect(result.warnings[0]!.hint).toContain("logs/D.zh-evidence.json");
    expect(result.warnings[0]!.hint).not.toContain("logs/D.evidence.json");
    const none = validateZh(w.draft, w.english, { context: w.context, config: w.config });
    expect(none.issues).toEqual(result.issues);
  });
});

describe("validateZh(): the schemas come first", () => {
  it("gives SCHEMA issues alone for a Chinese draft that fails DraftZh, runs no rule, and returns a null draft", () => {
    const w = zhWorld();
    const { rule, seen } = recorder("ZH_KEYS", "zh");
    const broken: [string, unknown][] = [
      ["an unknown key", { ...w.draft, extra: 1 }],
      ["a missing key", Object.fromEntries(Object.entries(w.draft).filter(([k]) => k !== "terms"))],
      ["a wrong type", { ...w.draft, strings: [] }],
      ["a wrong value", { ...w.draft, generated_at: 5 }],
      ["a bad string", { ...w.draft, strings: { ...w.draft.strings, "ideas.0": 7 } }],
    ];
    for (const [name, draft] of broken) {
      const result = validateZh(draft, w.english, inputsOf(w), { rules: [rule] });
      expect(result.draft, name).toBeNull();
      expect(result.ok, name).toBe(false);
      expect(result.issues.length, name).toBeGreaterThan(0);
      expect(result.issues.every((i) => i.code === "SCHEMA" && i.severity === "error"), name).toBe(true);
      expect(result.issues, name).toEqual(sortIssues(result.issues));
      const real = validateZh(draft, w.english, inputsOf(w));
      expect(real.issues, `${name} with every rule`).toEqual(result.issues);
    }
    expect(seen).toEqual([]);
  });

  it("names the key and the path of each schema fault of the Chinese draft", () => {
    const w = zhWorld();
    const extra = validateZh({ ...w.draft, extra: 1 }, w.english, inputsOf(w));
    expect(extra.issues.map((i) => [i.path, i.message])).toEqual([["extra", 'Unknown key "extra"; remove it.']]);
    const { terms: _terms, ...withoutTerms } = w.draft;
    const missing = validateZh(withoutTerms, w.english, inputsOf(w));
    expect(missing.issues.map((i) => i.path)).toEqual(["terms"]);
    expect(missing.issues[0]!.message).toContain("Missing key");
    const deep = validateZh({ ...w.draft, terms: { "protein-folding": { zh: "蛋白質摺疊", definition: "定義。", official: 3, official_url: null } } }, w.english, inputsOf(w));
    expect(deep.issues.map((i) => i.path)).toEqual(['terms["protein-folding"].official']);
  });

  it("tells a key that is absent from a value that is wrong, in the Chinese draft and in the English one, as the English validator does", () => {
    const w = zhWorld();
    const { schema_version: _zhVersion, ...zhWithout } = w.draft;
    const zhResult = validateZh(zhWithout, w.english, inputsOf(w));
    expect(zhResult.issues.map((i) => [i.path, i.message])).toEqual([["schema_version", "Missing key (expected 1)."]]);
    const wrong = validateZh({ ...w.draft, schema_version: 2 }, w.english, inputsOf(w));
    expect(wrong.issues.map((i) => i.path)).toEqual(["schema_version"]);
    expect(wrong.issues[0]!.message).not.toContain("Missing key");
    const { schema_version: _enVersion, ...enWithout } = w.english;
    const enResult = validateZh(w.draft, enWithout, inputsOf(w));
    expect(enResult.issues.map((i) => [i.path, i.message])).toEqual([["en.schema_version", "English draft: Missing key (expected 1)."]]);
  });

  it("gives SCHEMA issues for a Chinese draft that is not an object at all, and never throws", () => {
    const w = zhWorld();
    for (const value of [null, undefined, "text", 7, [], true, [w.draft]]) {
      const result = validateZh(value, w.english, inputsOf(w));
      expect(result.ok).toBe(false);
      expect(result.draft).toBeNull();
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.every((i) => i.code === "SCHEMA")).toBe(true);
    }
  });

  it("names the English draft in a SCHEMA issue of the English side: en in the path, the message and a hint to fix it first", () => {
    const w = zhWorld();
    const cases: [string, unknown, string][] = [
      ["an unknown key", { ...w.english, extra_key: 1 }, "en.extra_key"],
      ["a key that needs brackets", { ...w.english, "bad key": 1 }, 'en["bad key"]'],
      ["a wrong type", { ...w.english, lead: "x" }, "en.lead"],
      ["a bad nested value", { ...w.english, new_findings: [{ ...w.english.new_findings[0], ref: 3 }, w.english.new_findings[1]] }, "en.new_findings[0].ref"],
      ["null", null, "en"],
      ["an array", [], "en"],
    ];
    const { rule, seen } = recorder("ZH_KEYS", "zh");
    for (const [name, english, at] of cases) {
      const result = validateZh(w.draft, english, inputsOf(w), { rules: [rule] });
      expect(result.draft, name).toBeNull();
      expect(result.ok, name).toBe(false);
      expect(result.issues.map((i) => i.code), name).toEqual(result.issues.map(() => "SCHEMA"));
      expect(result.issues[0]!.path, name).toBe(at);
      for (const issue of result.issues) {
        expect(issue.message, name).toMatch(/^English draft: /);
        expect(issue.hint, name).toContain("fix the English draft first");
        expect(issue.path === "en" || issue.path.startsWith("en.") || issue.path.startsWith("en["), name).toBe(true);
      }
    }
    expect(seen).toEqual([]);
  });

  it("gives the issues of both drafts when both fail, in the engine's order, and reads no rule", () => {
    const w = zhWorld();
    const { rule, seen } = recorder("ZH_KEYS", "zh");
    const result = validateZh({ ...w.draft, extra: 1 }, { ...w.english, extra_key: 1 }, inputsOf(w), { rules: [rule] });
    expect(result.issues.map((i) => i.path)).toEqual(["en.extra_key", "extra"]);
    expect(result.issues[0]!.message).toMatch(/^English draft: /);
    expect(result.issues[1]!.message).not.toMatch(/^English draft: /);
    expect(result.issues).toEqual(sortIssues(result.issues));
    expect(result.draft).toBeNull();
    expect(seen).toEqual([]);
  });

  it("does not let a Chinese rule problem show when the English draft fails: the repair prompt never mixes them", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", `這${EM}`);
    const result = validateZh(w.draft, { ...w.english, extra_key: 1 }, inputsOf(w));
    expect(result.issues.map((i) => i.code)).toEqual(["SCHEMA"]);
  });
});

describe("validateZh(): a Chinese string with an invisible character is turned back as SCHEMA (F-32)", () => {
  // The code points are built here so that no invisible character is typed into this file.
  const cp = (n: number): string => String.fromCodePoint(n);
  const ZWSP = cp(0x200b);
  const MESSAGE = (code: string, at: number): string => `Has an invisible character, U+${code}, at character ${at} (counting from 1).`;
  const HINT = "Delete the character and use plain spaces and ordinary punctuation. Invisible characters hide words from the word counts and the word lists.";
  const MORE = (n: number): string => `${n} more string${n === 1 ? " holds" : "s hold"} an invisible character; only the first 50 strings are listed.`;
  const MORE_HINT = "Delete every invisible character and use plain spaces and ordinary punctuation, then validate again: the strings not listed are listed once these are fixed.";
  const TERM = "protein-folding";

  it("gives one SCHEMA issue for the string, with its place and the one hint, runs no rule and returns no draft", () => {
    const w = zhWorld();
    const { rule, seen } = recorder("ZH_KEYS", "zh");
    setZh(w, "ideas.0", `一項${ZWSP}關於方法的範例論點。`);
    const result = run(w, [rule]);
    expect(result.issues.map((i) => [i.code, i.severity, i.path, i.message, i.hint])).toEqual([["SCHEMA", "error", KEY("ideas.0"), MESSAGE("200B", 3), HINT]]);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(result.issues);
    expect(result.draft).toBeNull();
    expect(seen).toEqual([]);
    expect(run(w).issues).toEqual(result.issues);
    expect(DraftZh.safeParse(w.draft).success).toBe(true);
  });

  it("reads each string of the Chinese draft: a string key, a term's Chinese and its definition, one issue each in the engine's order", () => {
    const w = zhWorld();
    const term = w.draft.terms[TERM]!;
    setZh(w, "lead.1", `${w.draft.strings["lead.1"]}${cp(0x2060)}`);
    w.draft.terms[TERM] = { ...term, zh: `${ZWSP}${term.zh}`, definition: `${term.definition}${cp(0xfeff)}` };
    const result = run(w);
    expect(result.issues.map((i) => [i.path, i.message])).toEqual([
      [KEY("lead.1"), MESSAGE("2060", 10)],
      [`terms["${TERM}"].definition`, MESSAGE("FEFF", 16)],
      [`terms["${TERM}"].zh`, MESSAGE("200B", 1)],
    ]);
    expect(result.issues.every((i) => i.code === "SCHEMA" && i.severity === "error" && i.hint === HINT)).toBe(true);
    expect(result.issues).toEqual(sortIssues(result.issues));
  });

  it("gives the issues of both drafts and of the strings in one round when all three are at fault, and reads no rule", () => {
    const w = zhWorld();
    const { rule, seen } = recorder("ZH_KEYS", "zh");
    setZh(w, "ideas.0", `一項${ZWSP}範例。`);
    const result = validateZh({ ...w.draft, extra: 1 }, { ...w.english, extra_key: 1 }, inputsOf(w), { rules: [rule] });
    expect(result.issues.map((i) => [i.path, i.message.startsWith("English draft: ")])).toEqual([["en.extra_key", true], ["extra", false], [KEY("ideas.0"), false]]);
    expect(result.issues[2]!.message).toBe(MESSAGE("200B", 3));
    expect(result.issues).toEqual(sortIssues(result.issues));
    expect(result.draft).toBeNull();
    expect(seen).toEqual([]);
  });

  it("reads a Chinese draft that is only a string, and a string that the schema also refuses, once each", () => {
    const w = zhWorld();
    const bare = validateZh(`a${ZWSP}`, w.english, inputsOf(w));
    expect(bare.issues.every((i) => i.code === "SCHEMA" && i.path === "(root)")).toBe(true);
    expect(bare.issues.map((i) => i.message)).toContain(MESSAGE("200B", 2));
    const refused = validateZh({ ...w.draft, generated_at: `2026-11-24${ZWSP}` }, w.english, inputsOf(w));
    expect(refused.issues.filter((i) => i.path === "generated_at").map((i) => i.message)).toContain(MESSAGE("200B", 11));
    expect(refused.issues.filter((i) => i.message === MESSAGE("200B", 11))).toHaveLength(1);
  });

  it("does not read the English draft, the context or the evidence: an invisible character in them is no SCHEMA issue", () => {
    const w = zhWorld();
    const { rule, seen } = recorder("ZH_KEYS", "zh");
    w.english.new_findings[0]!.title += ZWSP;
    w.context.strings[0]!.en += ZWSP;
    const key = Object.keys(w.evidence!.texts)[0]!;
    w.evidence!.texts[key] += ZWSP;
    const result = run(w, [rule]);
    expect(result.issues).toEqual([]);
    expect(result.draft).not.toBeNull();
    expect(seen).toHaveLength(1);
  });

  it("keeps a tab, a line feed, a carriage return and every other visible or white-space character: the draft passes and its rules run", () => {
    const kept = [cp(0x09), cp(0x0a), cp(0x0d), " ", cp(0xa0), cp(0x2009), cp(0x2028), cp(0x3000), cp(0xfffd), "蛋白質", "，", cp(0x1f600)];
    for (const text of kept) {
      const w = zhWorld();
      const { rule, seen } = recorder("ZH_KEYS", "zh");
      setZh(w, "ideas.0", `一項${text}範例。`);
      const result = run(w, [rule]);
      expect(result.issues, JSON.stringify(text)).toEqual([]);
      expect(result.draft, JSON.stringify(text)).not.toBeNull();
      expect(seen, JSON.stringify(text)).toHaveLength(1);
    }
  });

  it("lists at most 50 strings and counts the rest in one summary issue at the end, so the repair prompt stays short", () => {
    const w = zhWorld();
    for (let i = 0; i < 60; i++) w.draft.strings[`z.${String(i).padStart(2, "0")}`] = `一${ZWSP}`;
    const result = validateZh(w.draft, w.english, inputsOf(w));
    expect(result.issues).toHaveLength(51);
    expect(result.issues.slice(0, 50).every((i) => i.code === "SCHEMA" && i.message === MESSAGE("200B", 2))).toBe(true);
    expect(result.issues.at(-1)).toEqual({ code: "SCHEMA", severity: "error", path: "(root)", message: MORE(10), hint: MORE_HINT });
    expect(result.draft).toBeNull();
  });

  it("gives the same result whatever order the draft's keys are in", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", `一項${ZWSP}範例。`);
    setZh(w, "lead.1", `一項${cp(0xad)}證明。`);
    const reversed = { ...w.draft, strings: Object.fromEntries(Object.entries(w.draft.strings).reverse()) };
    expect(validateZh(reversed, w.english, inputsOf(w)).issues).toEqual(validateZh(w.draft, w.english, inputsOf(w)).issues);
  });
});

describe("validateZh(): which rules run", () => {
  it("runs every rule of every group that lists the zh mode, and no rule that does not", () => {
    const w = zhWorld();
    const calls: string[] = [];
    const make = (code: string, scope: [RuleMode, ...RuleMode[]]): Rule =>
      defineRule({ code, scope, check: () => { calls.push(code); return []; } });
    const rules = [
      make("WORDS", ["draft", "published", "zh"]), make("COUNTS", ["draft"]), make("XREF", ["published"]), make("ZH_KEYS", ["zh"]),
      make("CANARY", ["draft", "zh"]), make("FILE_LAYOUT", ["published"]),
    ];
    const result = validateZh(w.draft, w.english, inputsOf(w), { rules });
    expect(result.issues).toEqual([]);
    expect(calls.sort()).toEqual(["CANARY", "WORDS", "ZH_KEYS"]);
  });

  it("runs the registered rules by default: the group's eleven codes, the safety group's four and DATE_MISMATCH, and no others", () => {
    const zhCodes = RULES.filter((r) => r.scope.includes("zh")).flatMap((r) => r.codes).sort();
    expect(ZH_CODES).toHaveLength(11);
    expect(zhCodes).toEqual([...ZH_CODES, "BLOCKED_HOST", "CANARY", "DATE_MISMATCH", "DUAL_USE", "SECRET_LIKE"].sort());
  });

  it("reports what another group's zh rule finds, with the group's own rules still run", () => {
    const w = zhWorld();
    const rule = defineRule({
      code: "WORDS", scope: ["zh"],
      check: (input: RuleInput) => (input.mode === "zh" ? [{ code: "WORDS", severity: "error" as const, path: "strings.x", message: "hand-made", hint: "none" }] : []),
    });
    setZh(w, "ideas.0", `這${EM}`);
    const result = validateZh(w.draft, w.english, inputsOf(w), { rules: [rule, ...RULES] });
    expect(result.issues.map((i) => i.code).sort()).toEqual(["WORDS", "ZH_NO_DASH"]);
  });

  it("runs the safety rules on the Chinese: the canary token and a made-up nucleotide string fail CANARY and DUAL_USE at their keys", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", `範例${CANARY_TOKEN}。`);
    setZh(w, "also.0", "範例 ACGTACGTACGTACGTACGTACGT 。");
    const result = run(w);
    expect(result.issues.filter((i) => i.code === "CANARY").map((i) => i.path)).toEqual([KEY("ideas.0")]);
    expect(result.issues.filter((i) => i.code === "DUAL_USE").map((i) => i.path)).toEqual([KEY("also.0")]);
    expect(result.ok).toBe(false);
  });

  it("runs the safety rules on a Chinese address: a blocked host in a string, in a term's text and in its address, each at its own place (F-44)", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", "範例 https://t.me/ch 。");
    w.draft.terms["protein-folding"] = { zh: "蛋白質摺疊 t.me/ch", definition: "見 https://t.co/ab 。", official: null, official_url: null };
    const result = run(w);
    expect(result.issues.filter((i) => i.code === "BLOCKED_HOST").map((i) => i.path)).toEqual([
      KEY("ideas.0"), formatPath(["terms", "protein-folding", "definition"]), formatPath(["terms", "protein-folding", "zh"]),
    ]);
    expect(result.ok).toBe(false);
  });

  it("holds the Chinese draft to the context's date and to a time between the English draft and the deadline, through the whole engine (F-22)", () => {
    const w = zhWorld();
    w.draft.date = "2026-11-23";
    w.draft.generated_at = "2026-11-24T04:30:00+08:00";
    const result = run(w);
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([["DATE_MISMATCH", "date"], ["DATE_MISMATCH", "generated_at"]]);
    expect(result.ok).toBe(false);
    expect(validateZh(w.draft, w.english, inputsOf(w), { fileDate: "2026-11-23" }).issues.map((i) => i.path)).toEqual(["date", "generated_at"]);
    const ok = zhWorld();
    expect(validateZh(ok.draft, ok.english, inputsOf(ok), { fileDate: D }).issues).toEqual([]);
    expect(validateZh(ok.draft, ok.english, inputsOf(ok), { fileDate: "2026-11-25" }).issues.map((i) => i.message)).toEqual([
      `date is ${D} but the file is named 2026-11-25.json; they must match.`,
    ]);
  });

  it("turns a rule that throws into one RULE_ERROR and still runs the others", () => {
    const w = zhWorld();
    const boom = defineRule({ code: "WORDS", scope: "zh", check: () => { throw new Error("a fault in a rule"); } });
    const { rule, seen } = recorder("ZH_KEYS", "zh");
    const result = validateZh(w.draft, w.english, inputsOf(w), { rules: [boom, rule] });
    expect(result.issues.map((i) => i.code)).toEqual(["RULE_ERROR"]);
    expect(result.issues[0]!.message).toContain("WORDS");
    expect(result.issues[0]!.message).toContain("a fault in a rule");
    expect(result.ok).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it("turns a fault in building the input into one RULE_ERROR at (engine) and still returns the parsed draft", () => {
    const w = zhWorld();
    const context = { ...w.context, date: "not-a-date" };
    const result = validateZh(w.draft, w.english, { ...inputsOf(w), context });
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([["RULE_ERROR", "(engine)"]]);
    expect(result.issues[0]!.message).toContain("could not read its inputs");
    expect(result.ok).toBe(false);
    expect(result.draft).toEqual(DraftZh.parse(w.draft));
  });

  it("says what the build fault was, cut at 200 characters, whether it threw an Error or something else, and says it is not the draft's", () => {
    const w = zhWorld();
    /** The result when reading the context's date throws `thrown`. */
    const failing = (thrown: unknown) => {
      const context = Object.defineProperty({ ...w.context }, "date", { enumerable: true, get(): string { throw thrown; } });
      return validateZh(w.draft, w.english, { ...inputsOf(w), context });
    };
    expect(failing(new Error("a fault in the input")).issues[0]!.message).toBe("The validator could not read its inputs (a fault in the input).");
    expect(failing("a plain string").issues[0]!.message).toBe("The validator could not read its inputs (a plain string).");
    expect(failing(new Error("x".repeat(200))).issues[0]!.message).toBe(`The validator could not read its inputs (${"x".repeat(200)}).`);
    expect(failing(new Error("x".repeat(201))).issues[0]!.message).toBe(`The validator could not read its inputs (${"x".repeat(200)}).`);
    const issue = failing(new Error("a fault")).issues[0]!;
    expect([issue.code, issue.path, issue.severity]).toEqual(["RULE_ERROR", "(engine)", "error"]);
    expect(issue.hint).toBe("This is a fault in the validator or its inputs, not in the draft: report it.");
  });
});

describe("validateZh(): what it builds for the rules, buildZhInput()", () => {
  const input = (w: ZhWorld, options: Parameters<typeof buildZhInput>[3] = {}) => buildZhInput(w.draft, w.english, inputsOf(w), options);

  it("makes a zh-mode input of the context's date, the weekday's format, the config, the evidence and the two drafts", () => {
    const w = zhWorld();
    const built = input(w);
    expect(built.mode).toBe("zh");
    expect(built.date).toBe(D);
    expect(built.fileDate).toBeNull();
    expect(built.format).toBe("daily");
    expect(built.edition).toBe("weekday");
    expect(built.config).toBe(w.config);
    expect(built.zh.draft).toBe(w.draft);
    expect(built.zh.context).toBe(w.context);
    expect(built.zh.english).toBe(w.english);
    expect(built.zh.evidence).toBe(w.evidence);
    expect(input({ ...w, evidence: null }).zh.evidence).toBeNull();
    expect(buildZhInput(w.draft, w.english, { context: w.context, config: w.config }).zh.evidence).toBeNull();
  });

  it("takes the format and the edition from the weekday of the context's date: Monday's review and Sunday's deep dive", () => {
    const w = zhWorld({ review: true });
    w.context.date = MONDAY;
    expect([input(w).format, input(w).edition]).toEqual(["monday_review", "monday"]);
    w.context.date = SUNDAY;
    expect([input(w).format, input(w).edition]).toEqual(["sunday_deep_dive", "sunday"]);
    w.context.date = "2026-11-25";
    expect([input(w).format, input(w).edition]).toEqual(["daily", "weekday"]);
    expect(input(w).date).toBe("2026-11-25");
  });

  it("passes the file date of the option, and null without one", () => {
    const w = zhWorld();
    expect(input(w, { fileDate: D }).fileDate).toBe(D);
    expect(input(w, { fileDate: null }).fileDate).toBeNull();
    expect(input(w, {}).fileDate).toBeNull();
    const { rule, seen } = recorder("ZH_KEYS", "zh");
    validateZh(w.draft, w.english, inputsOf(w), { rules: [rule], fileDate: D });
    expect(seen.map((i) => i.fileDate)).toEqual([D]);
  });

  it("files the corrections in force: the stored ones, then the English draft's own, numbered on from the highest stored id", () => {
    const w = zhWorld();
    expect(input(w).filing.map((c) => c.id)).toEqual(["C-0001", "C-0002", "C-0003", "C-0004"]);
    expect(input(w).filing.every((c) => c.date === D)).toBe(true);
    const stored = storedWorld();
    w.stored = { findings: stored.findings, corrections: stored.corrections, terms: stored.terms };
    expect(input(w).filing.map((c) => c.id)).toEqual(["C-0001", "C-0002", "C-0001", "C-0002", "C-0003", "C-0004"].map((id, i) => (i < 2 ? id : `C-000${i + 1}`)));
  });

  it("reads the English draft's new findings as the draft, and a stored finding it names in part until the run is given its record", () => {
    const w = zhWorld();
    expect(input(w).views.find("new-1")?.basis).toBe("draft");
    const part = input(w).views.find("math-2026-0002")!;
    expect([part.basis, part.detail, part.explainer]).toEqual(["context", "partial", null]);
    const stored = storedWorld();
    w.stored = { findings: [storedFinding("math-2026-0002")], corrections: stored.corrections, terms: stored.terms };
    const full = input(w).views.find("math-2026-0002")!;
    expect([full.basis, full.detail]).toEqual(["context", "full"]);
    expect(full.explainer?.found.en).toBe("Sample found text.");
  });

  it("builds the string inventory of the Chinese draft: each key with the context's facts, each term's parts", () => {
    const w = zhWorld();
    const entries = zhKeyed(input(w).inventory);
    expect(entries.some((e) => e.zh?.key === "ideas.0" && e.text === w.draft.strings["ideas.0"])).toBe(true);
    expect(entries.some((e) => e.zh?.term === "protein-folding" && e.at === "definition")).toBe(true);
    expect(entries.find((e) => e.zh?.key === "new.new-1.title")?.zh?.cap_chars).toBe(22);
  });

  it("carries the context's date, not either draft's own: a draft dated otherwise is still the context's edition", () => {
    const w = zhWorld();
    const draft = { ...w.draft, date: "2026-12-31" };
    expect(buildZhInput(draft, w.english, inputsOf(w)).date).toBe(D);
    const english = { ...w.english, date: "2026-12-30" };
    expect(buildZhInput(w.draft, english, inputsOf(w)).date).toBe(D);
    expect(buildZhInput(w.draft, english, inputsOf(w)).format).toBe("daily");
  });
});

describe("validateZh(): what a stored record changes", () => {
  const hype = (w: ZhWorld): string[] => run(w).issues.filter((i) => i.code === "ZH_HYPE").map((i) => i.path);

  it("lets ZH_HYPE know a stored finding is a Landmark when the stored record is given, and judges 突破 neither way when it is not", () => {
    const w = zhWorld();
    const key = "rung.phys-2026-0003";
    setZh(w, key, "一項突破。");
    // The run cannot read the finding's significance, so it does not judge 突破 (the other hype words it does)
    expect(hype(w)).toEqual([]);
    setZh(w, key, "一項革命性成果。");
    expect(hype(w)).toEqual([KEY(key)]);
    setZh(w, key, "一項突破。");
    w.stored = { findings: [storedFinding("phys-2026-0003", { significance: "major" })], corrections: [], terms: [] };
    expect(hype(w)).toEqual([KEY(key)]);
    w.stored = { findings: [storedFinding("phys-2026-0003", { significance: "landmark" })], corrections: [], terms: [] };
    expect(hype(w)).toEqual([]);
  });

  it("reads a backlog finding that only backlog keys name by its stored record, as it reads one the English draft names (R1 to R3 of tests/rules-zh-backlog.test.ts)", () => {
    const id = "bio-2026-0143";
    const key = `backlog.${id}.explainer.found`;
    const w = zhWorld();
    addString(w, { key, en: "A sample sentence.", zh: "這是一項突破。" });
    expect(hype(w)).toEqual([]);
    w.stored = { findings: [storedFinding(id, { significance: "major" })], corrections: [], terms: [] };
    expect(hype(w)).toEqual([KEY(key)]);
    w.stored = { findings: [storedFinding(id, { significance: "landmark" })], corrections: [], terms: [] };
    expect(hype(w)).toEqual([]);
    expect(run(w).issues).toEqual([]);
  });

  it("reads a backlog finding's numbered steps by the field of its stored record, and not at all without it (R4)", () => {
    const id = "bio-2026-0143";
    const key = `backlog.${id}.explainer.found`;
    const w = zhWorld();
    addString(w, { key, en: "A sample sentence.", zh: "步驟一：混合。步驟二：加熱。" });
    expect(run(w).issues).toEqual([]);
    w.stored = { findings: [storedFinding(id)], corrections: [], terms: [] };
    expect(run(w).issues.map((i) => `${i.code} ${i.path}`)).toEqual([`DUAL_USE ${KEY(key)}`]);
    w.stored = { findings: [storedFinding("phys-2026-0151")], corrections: [], terms: [] };
    expect(run(w).issues).toEqual([]);
  });

  it("gives no error for a backlog id that no record holds, and ZH_KEYS alone for a backlog key the context lacks (R5)", () => {
    const w = zhWorld();
    addString(w, { key: "backlog.bio-2026-0143.title", en: "A sample sentence.", zh: "這是一項突破。步驟一：混合。步驟二：加熱。" });
    w.stored = { findings: [storedFinding("bio-2026-0001")], corrections: [], terms: [] };
    expect(run(w).issues).toEqual([]);
    w.draft.strings["backlog.bio-2099-0001.title"] = "這是一項突破。";
    expect(run(w).issues.map((i) => `${i.code} ${i.path}`)).toEqual([`ZH_KEYS ${KEY("backlog.bio-2099-0001.title")}`]);
  });

  it("reads the record sets only through ZhInputs: a draft with no stored records still validates", () => {
    const w = zhWorld();
    expect(w.stored).toBeNull();
    expect(run(w).issues).toEqual([]);
    expect(validateZh(w.draft, w.english, { ...inputsOf(w), stored: null }).issues).toEqual([]);
  });
});

describe("validateZh(): robust on every shape a Chinese draft allows", () => {
  const WEIRD: [string, string][] = [
    ["punctuation only", "，。、；：！？「」（）"],
    ["mixed scripts", "中文 English 日本語 한국어 العربية Ελληνικά"],
    ["combining marks", "é́ ä กิ้ 中́文"],
    ["full-width digits", "２０２４年１２月３１日、１００％"],
    ["a lone high surrogate", "壞\ud800字"],
    ["a lone low surrogate", "壞\udc00字"],
    ["a very long run", "字".repeat(5000)],
    ["only spaces", "   　\t"],
    ["line breaks", "一行\n二行\r\n三行 四行"],
    // a zero-width joiner is no longer one of these shapes: the door refuses it as SCHEMA before any rule runs (F-32, `invisibleIssues()` of lib/validate.ts)
    ["two emoji", "成果 \u{1F9EC}\u{1F52C}"],
    ["a bare dash and a hyphen", `-${EM}-`],
    ["URL-like text", "見 https://example.org/a?b=1 與 www.example.org"],
    ["a canary look-alike", "UT-CANARY-0000"],
  ];

  it("raises no RULE_ERROR and does not throw for any of these in every kind of key", () => {
    const keys = ["lead.0", "new.new-1.title", "new.new-1.explainer.how_sure", "ideas.0", "also.0", "corrections.3.after", "reports.R-0001.reason", "returning.math-2026-0002.update"];
    for (const [name, text] of WEIRD) {
      const w = zhWorld();
      for (const key of keys) setZh(w, key, text);
      w.draft.terms["protein-folding"]!.zh = text;
      w.draft.terms["protein-folding"]!.definition = text;
      w.draft.terms["protein-folding"]!.official = text;
      w.draft.terms["protein-folding"]!.official_url = "https://terms.naer.edu.tw/detail/1/";
      let result: ReturnType<typeof run> | undefined;
      expect(() => { result = run(w); }, name).not.toThrow();
      expect(result!.issues.filter((i) => i.code === "RULE_ERROR"), name).toEqual([]);
      expect(result!.draft, name).not.toBeNull();
      for (const issue of result!.issues) {
        expect(issue.message.length, `${name}: ${issue.code}`).toBeGreaterThan(0);
        expect(issue.path.length, `${name}: ${issue.code}`).toBeGreaterThan(0);
      }
    }
  });

  it("raises no RULE_ERROR for an empty strings map, a draft with every key empty or a term list with no term", () => {
    const w = zhWorld();
    w.draft.strings = {};
    let result = run(w);
    expect(result.issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
    expect(result.issues.every((i) => i.code === "ZH_KEYS" || i.code === "INPUT_MISSING" || i.code === "ZH_ENGLISH_ONCE" || i.code === "ZH_TERMS")).toBe(true);
    const v = zhWorld();
    for (const key of Object.keys(v.draft.strings)) v.draft.strings[key] = "";
    v.draft.terms = {};
    result = run(v);
    expect(result.issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
    const u = zhWorld();
    u.context.strings = [];
    u.context.terms = [];
    u.context.fixed = [];
    result = run(u);
    expect(result.issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
  });

  it("leaves a key the draft lacks and a key the context lacks to ZH_KEYS, in every rule's reading", () => {
    const w = zhWorld();
    dropKey(w, "also.0");
    delete w.draft.strings["lead.1"];
    setZh(w, "added.key", "一個沒有人問的字串。");
    const result = run(w);
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["ZH_KEYS", KEY("added.key")], ["ZH_KEYS", KEY("lead.1")],
    ].sort((a, b) => (a[1]! < b[1]! ? -1 : 1)));
  });

  it("gives the same issues in the same order whatever order the draft's keys are in", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", `這${EM}`);
    setZh(w, "also.0", "驚人的成果");
    setZh(w, "lead.0", "今天有一項革命性成果，而且很長".repeat(20));
    const first = run(w);
    expect(first.issues.length).toBeGreaterThan(3);
    const reversed = { ...w, draft: { ...w.draft, strings: Object.fromEntries(Object.entries(w.draft.strings).reverse()) } };
    expect(run(reversed).issues).toEqual(first.issues);
    expect(run(w).issues).toEqual(first.issues);
  });
});

describe("validateZh(): reads nothing but its inputs and changes none of them", () => {
  it("changes no input: a deeply frozen draft, context, evidence and stored record give the same result as a copy", () => {
    const w = zhWorld({ review: true, deepDive: true });
    setZh(w, "ideas.0", `這${EM}驚人`);
    delete w.draft.strings["lead.1"];
    const stored = storedWorld();
    w.stored = { findings: stored.findings, corrections: stored.corrections, terms: stored.terms };
    const expected = run(w);
    const frozen = deepFreeze({
      draft: structuredClone(w.draft), english: structuredClone(w.english), context: structuredClone(w.context),
      evidence: structuredClone(w.evidence), stored: structuredClone(w.stored),
    });
    const result = validateZh(frozen.draft, frozen.english, { context: frozen.context, evidence: frozen.evidence, stored: frozen.stored, config: w.config });
    expect(result.issues).toEqual(expected.issues);
    expect(result.issues.length).toBeGreaterThan(2);
    const before = JSON.stringify({ d: w.draft, e: w.english, c: w.context, v: w.evidence, s: w.stored });
    run(w);
    expect(JSON.stringify({ d: w.draft, e: w.english, c: w.context, v: w.evidence, s: w.stored })).toBe(before);
  });

  it("reads no clock: the same result at any time of day", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", `這${EM}`);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const a = run(w);
      vi.setSystemTime(new Date("2031-06-15T23:59:59Z"));
      const b = run(w);
      expect(b.issues).toEqual(a.issues);
      expect(a.issues.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads no file, no network, no environment and no clock in its sources", () => {
    for (const file of ["lib/validate-zh.ts", "lib/rules/zh.ts"]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const word of ["Date.now(", "new Date(", "Math.random", "fetch(", "readFileSync", "writeFileSync", "process.env", "node:fs", "node:child_process", "execSync", "XMLHttpRequest"]) {
        expect(source.includes(word), `${file} holds ${word}`).toBe(false);
      }
    }
  });
});

describe("validateZh(): the modules load in either order", () => {
  it("gives the same validateZh from lib/validate and from lib/validate-zh, whichever is imported first", async () => {
    const w = zhWorld();
    vi.resetModules();
    const zhFirst = await import("@/lib/validate-zh");
    const validateAfter = await import("@/lib/validate");
    expect(validateAfter.validateZh).toBe(zhFirst.validateZh);
    expect(validateAfter.buildZhInput).toBe(zhFirst.buildZhInput);
    vi.resetModules();
    const validateFirst = await import("@/lib/validate");
    const zhAfter = await import("@/lib/validate-zh");
    expect(validateFirst.validateZh).toBe(zhAfter.validateZh);
    for (const mod of [zhFirst, validateAfter, validateFirst, zhAfter]) {
      const result = mod.validateZh(null, w.english, inputsOf(w));
      expect(result.ok).toBe(false);
      expect(result.issues.map((i: ValidationIssue) => i.code)).toEqual(["SCHEMA"]);
    }
  });
});

describe("validateZh(): the issues carry what a repair needs", () => {
  it("gives each rule issue a path, a message and a hint, in the engine's order, on a draft with many problems", () => {
    const w = zhWorld({ review: true, deepDive: true });
    setZh(w, "ideas.0", `這${EM}驚人`);
    setZh(w, "new.new-1.title", "字".repeat(30));
    setEn(w, "also.0", "A made-up soil study with 7 samples");
    setZh(w, "also.0", "一項範例土壤研究，有 8 個樣本");
    const result = run(w);
    expect(result.issues.length).toBeGreaterThan(4);
    for (const issue of result.issues) {
      expect(issue.message.length).toBeGreaterThan(20);
      expect((issue.hint ?? "").length).toBeGreaterThan(10);
      expect(issue.message).not.toContain("undefined");
      expect(issue.message).not.toContain("[object");
    }
    expect(result.issues).toEqual(sortIssues(result.issues));
    const codes = new Set(result.issues.map((i) => i.code));
    for (const code of ["ZH_NO_DASH", "ZH_HYPE", "ZH_CHARS", "ZH_PARITY"]) expect(codes.has(code), code).toBe(true);
    expect(zhIssues(w, "ZH_CHARS")).toHaveLength(1);
  });
});
