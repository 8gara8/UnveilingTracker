// The invalid fixtures of the Chinese group (SPEC §4.12 "Fixtures and tests"; fixtures/src/invalid/zh.ts, written to
// fixtures/drafts-zh/). It checks that the F cases are the codes the rule table lists a Z fixture for (SCHEMA, DATE_MISMATCH, the four safety
// codes that also read the Chinese draft, and the eleven ZH_ codes), in the table's order, each filed as invalid--CODE.zh.json; that each is one
// small change of the valid weekday Chinese draft (one string or one term, named here) and fails the whole `validateZh()` with exactly its
// code, once, at the part it is about, with no other error and no warning, and fails the group's own rules alone the same way; that each
// file on disk is the builder's output byte for byte and fails the same way read back; that the S list is empty because every code is
// hard; that each T case gives its exact set of error and warning codes with its edition's own inputs and the stored records that stage 8
// reads for the pass (the sample world's findings, glossary and corrections), changes the draft and adds only invented text; that every
// case gives the same codes with no stored records but the two ZH_HYPE cases that put 突破 in a stored finding's text, which need that
// finding's record to fail and give no error without it, since a rule skips what it cannot know; that every cap of §4.12's ZH_CHARS row (a string, a group, a Sunday deep dive and both big pictures) passes at its limit
// and fails one character over, with that code alone; that the four valid editions still pass; and that no dash is typed in the source or
// held as a character in a generated file, the canary token and the secret-shaped string stand only in their own fixture, and no link goes
// anywhere but to an invented example host or the term bank's own host. The page total's own limit is not reachable from a fixture: no
// edition's strings can pass their own caps and still total over ceil(words_max x zh_factor), so tests/rules-zh.test.ts holds that case,
// on a context of its own. New for this project; Cyber has no Chinese pass.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATORS, ZH_INVALID_CASES, ZH_NAMED_CASES, ZH_SOFT_CASES, dashEscaped, zhInvalidDraft, zhInvalidOutputs, zhSoftOutputs,
} from "@/fixtures/src/build";
import { zhCases, zhNamed, zhSoft, type ZhInvalidCase, type ZhNamedCase, type ZhSoftCase } from "@/fixtures/src/invalid/zh";
import { EDITIONS, EDITION_NAMES, REPO_ROOT, storedFindingsBefore, storedGlossary, storedWeekdayCorrections, type EditionName } from "@/fixtures/src/world";
import { zhDraft } from "@/fixtures/src/zh-drafts";
import { ZH_CLOCK, zhInputs } from "@/fixtures/src/zh-inputs";
import { RULE_CODE_TABLE, codesOfGroup } from "@/lib/rules";
import { zhRules } from "@/lib/rules/zh";
import type { StoredRecords, ValidationIssue } from "@/lib/rules/types";
import { DraftZh } from "@/lib/schema/draft-zh";
import { validateZh } from "@/lib/validate-zh";
import { CANARY_TOKEN } from "@/lib/vocab";
import { countZhChars } from "@/lib/zh";

const MINE = codesOfGroup("zh");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const DRAFTS_ZH = join(REPO_ROOT, "fixtures/drafts-zh");

/** The codes the table lists a Z fixture for, in the table's order. */
const Z_CODES = RULE_CODE_TABLE.filter((r) => r.tests.includes("Z")).map((r) => r.code);

/** The issue path of each F case: the one place its code is reported at. */
const WHERE: Readonly<Record<string, string>> = {
  SCHEMA: 'strings["also.1"]',
  DATE_MISMATCH: "date",
  DUAL_USE: 'strings["corrections.0.after"]',
  SECRET_LIKE: 'terms["numerical-weather-prediction"].official_url',
  CANARY: 'terms["antimicrobial-resistance"].official_url',
  BLOCKED_HOST: 'terms["numerical-weather-prediction"].official_url',
  ZH_KEYS: 'strings["also.1"]',
  ZH_PARITY: 'strings["new.new-1.explainer.found"]',
  ZH_TRADITIONAL: 'strings["ideas.0"]',
  ZH_AVOID: 'strings["ideas.1"]',
  ZH_TERMS: 'strings["also.1"]',
  ZH_RUNG_LABEL: 'strings["new.new-3.explainer.how_sure"]',
  ZH_ENGLISH_ONCE: 'strings["new.new-1.explainer.found"]',
  ZH_CHARS: 'strings["new.new-1.title"]',
  ZH_OFFICIAL: 'terms["numerical-weather-prediction"].official',
  ZH_NO_DASH: 'strings["also.0"]',
  ZH_HYPE: 'strings["new.new-2.explainer.how_sure"]',
};

/** What each F case changes in the valid weekday draft, and nothing else: one string or one term, so the case is about one thing. */
const CHANGES: Readonly<Record<string, readonly string[]>> = {
  SCHEMA: ["strings.also.1"],
  DATE_MISMATCH: ["top.date"],
  DUAL_USE: ["strings.corrections.0.after"],
  SECRET_LIKE: ["terms.numerical-weather-prediction"],
  CANARY: ["terms.antimicrobial-resistance"],
  BLOCKED_HOST: ["terms.numerical-weather-prediction"],
  ZH_KEYS: ["strings.also.1"],
  ZH_PARITY: ["strings.new.new-1.explainer.found"],
  ZH_TRADITIONAL: ["strings.ideas.0"],
  ZH_AVOID: ["strings.ideas.1"],
  ZH_TERMS: ["strings.also.1"],
  ZH_RUNG_LABEL: ["strings.new.new-3.explainer.how_sure"],
  ZH_ENGLISH_ONCE: ["strings.new.new-1.explainer.found"],
  ZH_CHARS: ["strings.new.new-1.title"],
  ZH_OFFICIAL: ["terms.numerical-weather-prediction"],
  ZH_NO_DASH: ["strings.also.0"],
  ZH_HYPE: ["strings.new.new-2.explainer.how_sure"],
};

/** The most strings and terms a T case may change. */
const T_CHANGES_MAX = 2;

type Mutating = { edition?: EditionName; mutate: (draft: DraftZh) => unknown };
type Json = Record<string, unknown>;

/** A case's draft: a fresh copy of its edition's valid Chinese draft, mutated (as the builder's `zhInvalidDraft()` does). */
const mutated = (c: Mutating): unknown => zhInvalidDraft({ code: "X", file: "x", edition: c.edition, mutate: c.mutate });

/**
 * The sample world's stored records before an edition published: what the morning's stage 8 reads from `content/` for the Chinese
 * pass, every stored finding with the glossary and the corrections stored by then (the weekday's two, from the day after it on). The
 * backlog's findings are among them, so a rule reads a Landmark's text and a field as it does in the morning.
 */
const storedOf = (edition: EditionName): StoredRecords => {
  const date = EDITIONS[edition].date;
  return { findings: storedFindingsBefore(date), corrections: date > EDITIONS.weekday.date ? storedWeekdayCorrections() : [], terms: storedGlossary(date).terms };
};

/**
 * The whole validator on a Chinese draft with its edition's inputs, or the group's own rules alone. The run is given the stored
 * records, as stage 8 gives them; `records` false runs it without, to show what a rule does where it cannot read a finding.
 */
function whole(draft: unknown, edition: EditionName, ownOnly = false, records = true): ValidationIssue[] {
  const i = zhInputs(edition);
  return validateZh(draft, i.english, { ...i, stored: records ? storedOf(edition) : null }, { fileDate: i.fileDate, ...(ownOnly ? { rules: zhRules } : {}) }).issues;
}

const tell = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.code}`);
const codesOf = (issues: readonly ValidationIssue[], severity: string): string[] =>
  [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();

/** The strings (`strings.<key>`), terms (`terms.<id>`) and other top-level parts (`top.<name>`) in which two Chinese drafts differ, a key one lacks included. */
function changed(before: unknown, after: unknown): string[] {
  const out: string[] = [];
  const a0 = before as Json;
  const b0 = after as Json;
  for (const key of new Set([...Object.keys(a0), ...Object.keys(b0)])) {
    if (key === "strings" || key === "terms") continue;
    if (JSON.stringify(a0[key]) !== JSON.stringify(b0[key])) out.push(`top.${key}`);
  }
  for (const part of ["strings", "terms"] as const) {
    const a = (a0[part] ?? {}) as Json;
    const raw = b0[part];
    // A part that is no longer a record (a list, say) is one change, not one for each key it had
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      out.push(`top.${part}`);
      continue;
    }
    const b = raw as Json;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(`${part}.${key}`);
    }
  }
  return out.sort();
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

const fileText = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

// ── The F cases ──────────────────────────────────────────────────────────────────────────────────

describe("the Chinese group's F cases", () => {
  it("has one F case for each code that the rule table lists a Z fixture for, in the table's order, each filed as invalid--CODE.zh.json", () => {
    expect(Z_CODES).toEqual(["SCHEMA", "DATE_MISMATCH", "DUAL_USE", "SECRET_LIKE", "CANARY", "BLOCKED_HOST", ...MINE]);
    expect(MINE).toHaveLength(11);
    expect(zhCases.map((c) => c.code)).toEqual(Z_CODES);
    expect(ZH_INVALID_CASES).toBe(zhCases);
    for (const c of zhCases) expect(c.file, c.code).toBe(`invalid--${c.code}.zh.json`);
    expect(new Set(zhCases.map((c) => c.file)).size).toBe(zhCases.length);
    expect(Object.keys(WHERE)).toEqual(Z_CODES);
    expect(Object.keys(CHANGES)).toEqual(Z_CODES);
  });

  it("makes each case from the weekday draft, the draft the spec says an F case mutates", () => {
    for (const c of zhCases) expect(c.edition ?? "weekday", c.code).toBe("weekday");
  });

  it.each(zhCases.map((c) => [c.code, c] as const))("F %s: fails validateZh() with exactly its code, once, at the part it is about, by a small change", (code, c) => {
    const draft = zhInvalidDraft(c);
    const issues = whole(draft, "weekday");
    expect(tell(issues), code).toEqual([`error ${code}`]);
    expect(issues[0]!.path, code).toBe(WHERE[code]);
    expect(changed(zhDraft("weekday"), draft), code).toEqual(CHANGES[code]);
  });

  it.each(zhCases.map((c) => [c.code, c] as const))("F %s: gives the same single error when the run is given no stored records, so no case needs one", (code, c) => {
    const issues = whole(zhInvalidDraft(c), "weekday", false, false);
    expect(tell(issues), code).toEqual([`error ${code}`]);
    expect(issues[0]!.path, code).toBe(WHERE[code]);
  });

  it.each(zhCases.filter((c) => MINE.includes(c.code)).map((c) => [c.code, c] as const))(
    "F %s: the group's own rules alone say the same, so no other rule is needed to make the case fail", (code, c) => {
      const mine = whole(zhInvalidDraft(c), "weekday", true);
      expect(tell(mine), code).toEqual([`error ${code}`]);
      expect(mine[0]!.path, code).toBe(WHERE[code]);
    },
  );

  it.each(zhCases.map((c) => [c.code, c] as const))("F %s: its file in fixtures/drafts-zh/ is the builder's output and fails the same way", (code, c) => {
    const { path, text } = zhInvalidOutputs([c])[0]!;
    expect(path).toBe(`fixtures/drafts-zh/invalid--${code}.zh.json`);
    expect(fileText(path)).toBe(text);
    const back = JSON.parse(text) as unknown;
    expect(back).toEqual(JSON.parse(JSON.stringify(zhInvalidDraft(c))));
    expect(tell(whole(back, "weekday")), code).toEqual([`error ${code}`]);
  });

  it("registers the Chinese generators, so fixtures:gen writes these files and fixtures:check compares them", () => {
    expect(GENERATORS).toContain(zhInvalidOutputs);
    expect(GENERATORS).toContain(zhSoftOutputs);
    expect(zhInvalidOutputs().map((o) => o.path)).toEqual(zhCases.map((c) => `fixtures/drafts-zh/${c.file}`));
  });

  it("has no file in fixtures/drafts-zh/ that a case does not write: every invalid--*.zh.json is a case's, and no soft--*.zh.json exists", () => {
    const files = readdirSync(DRAFTS_ZH).filter((f) => f.startsWith("invalid--") || f.startsWith("soft--")).sort();
    expect(files).toEqual(zhCases.map((c) => c.file).sort());
  });
});

describe("the Chinese group's S list", () => {
  it("is empty, because every code of the group is hard and the table lists no S fixture for any code a Chinese draft is judged for", () => {
    expect(zhSoft).toEqual([]);
    expect(ZH_SOFT_CASES).toBe(zhSoft);
    expect(zhSoftOutputs()).toEqual([]);
    for (const code of Z_CODES) {
      const info = RULE_CODE_TABLE.find((r) => r.code === code)!;
      expect(info.severity, code).toBe("H");
      expect(info.tests, code).not.toContain("S");
    }
  });

  it("gives the group's own rules no warning on any case, so no code of the group is a soft gate", () => {
    for (const c of zhNamed) expect(codesOf(whole(mutated(c), c.edition, true), "warning"), c.name).toEqual([]);
    for (const c of zhCases) expect(codesOf(whole(zhInvalidDraft(c), "weekday", true), "warning"), c.code).toEqual([]);
  });
});

// ── The T cases ──────────────────────────────────────────────────────────────────────────────────

describe("the Chinese group's T cases", () => {
  it("has named cases with unique names, each starting with the code it is about, which one of its errors is unless the case passes", () => {
    expect(ZH_NAMED_CASES).toBe(zhNamed);
    expect(new Set(zhNamed.map((c) => c.name)).size).toBe(zhNamed.length);
    for (const c of zhNamed) {
      expect(c.name.startsWith(`${c.code}: `), c.name).toBe(true);
      expect(Z_CODES, c.name).toContain(c.code);
      if (c.expect.errors.length > 0) expect([...c.expect.errors], c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toEqual([...c.expect.errors].sort());
      expect([...c.expect.warnings], c.name).toEqual([...c.expect.warnings].sort());
      expect(c.expect.warnings, c.name).toEqual([]);
      expect(EDITION_NAMES, c.name).toContain(c.edition);
    }
  });

  it("covers each code of the group and each of SCHEMA, DUAL_USE and CANARY in a T case, a failing and a passing one where the row has both, and every edition", () => {
    for (const code of [...MINE, "SCHEMA", "DATE_MISMATCH", "DUAL_USE", "CANARY", "BLOCKED_HOST"]) expect(zhNamed.some((c) => c.code === code), code).toBe(true);
    for (const code of MINE) expect(zhNamed.some((c) => c.code === code && c.expect.errors.includes(code)), `a failing case of ${code}`).toBe(true);
    for (const code of ["DATE_MISMATCH", "BLOCKED_HOST", "ZH_PARITY", "ZH_TRADITIONAL", "ZH_AVOID", "ZH_TERMS", "ZH_CHARS", "ZH_NO_DASH", "ZH_HYPE"]) {
      expect(zhNamed.some((c) => c.code === code && c.expect.errors.length === 0), `a passing case of ${code}`).toBe(true);
    }
    for (const edition of EDITION_NAMES) expect(zhNamed.some((c) => c.edition === edition), edition).toBe(true);
  });

  /**
   * The T cases that put 突破 in a stored finding's text where the finding is no part of the draft (a Sunday's deep dive, a Monday's
   * remarkable note): the rule fails them by the record of the Major finding that stage 8 gives the run. Without it the run cannot
   * tell what the finding is, so it does not judge 突破 there and gives no ZH_HYPE: a rule skips what it cannot know.
   */
  const NEEDS_THE_RECORD: ReadonlySet<string> = new Set([
    "ZH_HYPE: 突破 in a Sunday's deep dive on a Major finding",
    "ZH_HYPE: 突破 in a Monday's remarkable note on a Major finding",
  ]);

  it("names the T cases that need a stored record, and each is a failing ZH_HYPE case", () => {
    const names = zhNamed.map((c) => c.name);
    for (const name of NEEDS_THE_RECORD) expect(names, name).toContain(name);
    for (const name of NEEDS_THE_RECORD) expect([...zhNamed.find((c) => c.name === name)!.expect.errors], name).toEqual(["ZH_HYPE"]);
  });

  it.each(zhNamed.map((c) => [c.name, c] as const))("T %s: gives the same errors with no stored records, but where it needs the finding's record and then gives none", (name, c) => {
    const issues = whole(mutated(c), c.edition, false, false);
    expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }).toEqual({
      errors: NEEDS_THE_RECORD.has(name) ? [] : [...c.expect.errors],
      warnings: [...c.expect.warnings],
    });
  });

  it.each(zhNamed.map((c) => [c.name, c] as const))("T %s", (_name, c) => {
    const draft = mutated(c);
    const issues = whole(draft, c.edition);
    expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }).toEqual({ errors: [...c.expect.errors], warnings: [...c.expect.warnings] });
    // The group's own rules say the part that is theirs: the codes of the group among the expected errors (and the engine's SCHEMA, which a schema failure gives alone), and nothing else
    const mine = whole(draft, c.edition, true);
    expect(codesOf(mine, "error")).toEqual(c.expect.errors.filter((code) => MINE.includes(code) || code === "SCHEMA"));
    expect(codesOf(mine, "warning")).toEqual([]);
    // A small change of its edition's valid draft, and a real one: a case that changed nothing would pass whatever the rules do
    const edits = changed(zhDraft(c.edition), draft);
    expect(edits.length).toBeGreaterThanOrEqual(1);
    expect(edits.length).toBeLessThanOrEqual(T_CHANGES_MAX);
  });
});

// ── The boundary of each cap ─────────────────────────────────────────────────────────────────────

describe("the boundary of each cap of ZH_CHARS", () => {
  /** One Han character that adds one to a string's length and nothing else a rule reads. */
  const FILL = String.fromCodePoint(0x5b57);

  /** Each limit: the strings it reads, the limit, the edition it is read in, and the key that is padded. `ownCaps` is true where each of the strings has a cap of its own that the padding must keep. */
  const LIMITS: readonly { name: string; edition: EditionName; keys: readonly string[]; limit: number; fill: string; ownCaps?: boolean }[] = [
    { name: "a title (12 words)", edition: "weekday", keys: ["new.new-1.title"], limit: 22, fill: "new.new-1.title" },
    { name: "an idea line (40 words)", edition: "weekday", keys: ["ideas.0"], limit: 72, fill: "ideas.0" },
    { name: "an Also noted line (20 words)", edition: "weekday", keys: ["also.0"], limit: 36, fill: "also.0" },
    { name: "a correction's reason (40 words)", edition: "weekday", keys: ["corrections.0.reason"], limit: 72, fill: "corrections.0.reason" },
    { name: "a correction's after (flat 300)", edition: "weekday", keys: ["corrections.0.after"], limit: 300, fill: "corrections.0.after" },
    { name: "a story part's own cap (background, 35 words)", edition: "weekday", keys: ["new.new-1.explainer.background"], limit: 63, fill: "new.new-1.explainer.background" },
    {
      name: "the Lead's sentences together (60 words)", edition: "weekday", keys: ["lead.0", "lead.1", "lead.2"], limit: 108, fill: "lead.0",
    },
    {
      name: "a story's six parts together (280 words)", edition: "weekday", ownCaps: true,
      keys: ["found", "matters", "ai_helped", "how_sure", "background", "could_lead"].map((p) => `new.new-1.explainer.${p}`), limit: 504,
      fill: "new.new-1.explainer.found",
    },
    {
      name: "an item's first four parts together (100 words)", edition: "weekday",
      keys: ["found", "matters", "ai_helped", "how_sure"].map((p) => `new.new-2.explainer.${p}`), limit: 180, fill: "new.new-2.explainer.found",
    },
    {
      name: "a backlog finding's four parts together (100 words)", edition: "weekday",
      keys: ["found", "matters", "ai_helped", "how_sure"].map((p) => `backlog.soc-2026-0144.explainer.${p}`), limit: 180,
      fill: "backlog.soc-2026-0144.explainer.found",
    },
    { name: "a Sunday deep dive (550 words)", edition: "sunday", keys: ["deep_dive"], limit: 990, fill: "deep_dive" },
    { name: "a Monday's big picture (330 words)", edition: "monday", keys: ["review.big_picture"], limit: 594, fill: "review.big_picture" },
    { name: "a short Monday's big picture (120 words)", edition: "monday-short", keys: ["review.big_picture"], limit: 216, fill: "review.big_picture" },
    { name: "a Monday's remarkable note (30 words)", edition: "monday", keys: ["review.remarkable"], limit: 54, fill: "review.remarkable" },
    { name: "a Monday's strongest evidence against (50 words)", edition: "monday", keys: ["review.strongest_against"], limit: 90, fill: "review.strongest_against" },
  ];

  /**
   * The draft of an edition with the strings of `l.keys` padded so that together they are exactly `total` characters long: the one
   * string `l.fill`, or, where each string has a cap of its own (`ownCaps`), each string in turn up to its own cap.
   */
  function padded(l: (typeof LIMITS)[number], total: number): DraftZh {
    const d = zhDraft(l.edition);
    const context = zhInputs(l.edition).context;
    let have = l.keys.reduce((n, k) => n + countZhChars(d.strings[k]!), 0);
    if (have > total) throw new Error(`${l.name}: the valid draft already has ${have} characters, more than ${total}`);
    for (const key of l.ownCaps === true ? l.keys : [l.fill]) {
      const room = l.ownCaps === true ? Math.max(0, context.strings.find((s) => s.key === key)!.cap_chars - countZhChars(d.strings[key]!)) : total - have;
      const add = Math.min(room, total - have);
      d.strings[key] += FILL.repeat(add);
      have += add;
    }
    if (have !== total) throw new Error(`${l.name}: the strings' own caps leave no room for ${total} characters`);
    return d;
  }

  it.each(LIMITS.map((l) => [l.name, l] as const))("%s passes at exactly its limit and fails one character over, with ZH_CHARS alone", (_name, l) => {
    const at = padded(l, l.limit);
    expect(l.keys.reduce((n, k) => n + countZhChars(at.strings[k]!), 0)).toBe(l.limit);
    expect(whole(at, l.edition), "at the limit").toEqual([]);
    const over = padded(l, l.limit + 1);
    expect(l.keys.reduce((n, k) => n + countZhChars(over.strings[k]!), 0)).toBe(l.limit + 1);
    const issues = whole(over, l.edition);
    expect(tell(issues), "one over").toEqual(["error ZH_CHARS"]);
    expect(issues[0]!.message, "it says by how much").toContain("Cut at least 1.");
  });

  it("reads a term's definition against the context term's cap (40 words, 72 characters)", () => {
    const fill = (n: number): DraftZh => {
      const d = zhDraft("weekday");
      const t = d.terms.papyrus!;
      t.definition += FILL.repeat(n - countZhChars(t.definition));
      return d;
    };
    expect(whole(fill(72), "weekday")).toEqual([]);
    const issues = whole(fill(73), "weekday");
    expect(tell(issues)).toEqual(["error ZH_CHARS"]);
    expect(issues[0]!.path).toBe("terms.papyrus.definition");
  });

  it("holds each limit as the spec words it: ceil(words x zh_factor) at the seed 1.8", () => {
    expect(LIMITS.map((l) => l.limit)).toEqual([22, 72, 36, 72, 300, 63, 108, 504, 180, 180, 990, 594, 216, 54, 90]);
    for (const [words, chars] of [[12, 22], [40, 72], [20, 36], [35, 63], [60, 108], [280, 504], [100, 180], [550, 990], [330, 594], [120, 216], [30, 54], [50, 90]] as const) {
      expect(Math.ceil(Math.round(words * 1.8 * 1e6) / 1e6), `${words} words`).toBe(chars);
    }
  });
});

// ── The boundary of the other clauses ────────────────────────────────────────────────────────────

describe("the passing neighbour of each other case", () => {
  /** A draft that undoes a case's fault by the smallest change its own words name, and passes with no error and no warning. */
  const NEIGHBOURS: readonly { of: string; name: string; edition: EditionName; mutate: (d: DraftZh) => void }[] = [
    {
      of: "ZH_NO_DASH: a single em dash (U+2014) in a string", name: "the same sentence with a comma", edition: "weekday",
      mutate: (d) => { d.strings["also.1"] = d.strings["also.1"]!.replace("古代銘文", "古代，銘文"); },
    },
    {
      of: "ZH_NO_DASH: an en dash between Han characters (U+2013) in a string", name: "an en dash between two digits", edition: "weekday",
      mutate: (d) => { d.strings["backlog.bio-2026-0143.explainer.found"] += `（8${EN}10）`; },
    },
    {
      of: "ZH_HYPE: 突破 in the Lead, which is no finding's text", name: "the Lead without it", edition: "weekday",
      mutate: () => {},
    },
    {
      of: "ZH_KEYS: an extra string key", name: "the key left out", edition: "weekday",
      mutate: () => {},
    },
    {
      of: "ZH_OFFICIAL: an official without an official_url", name: "an official with its page", edition: "weekday",
      mutate: () => {},
    },
    {
      of: "ZH_OFFICIAL: a lookalike host that starts with terms.naer.edu.tw", name: "the host itself, with a fragment (which normalizeUrl() drops)", edition: "weekday",
      mutate: (d) => { d.terms["antimicrobial-resistance"]!.official_url += "#section"; },
    },
    {
      of: "ZH_TRADITIONAL: a Japanese-only character", name: "the Taiwan form of the same word", edition: "weekday",
      mutate: () => {},
    },
    {
      of: "ZH_TERMS: a fixed entry that holds in one field only (proof, mathematics) applies in a mathematics finding", name: "the fixed word in place",
      edition: "weekday", mutate: () => {},
    },
  ];

  it("names, for each neighbour, a case that exists", () => {
    const names = new Set(zhNamed.map((c) => c.name));
    for (const n of NEIGHBOURS) expect(names.has(n.of), n.of).toBe(true);
  });

  it.each(NEIGHBOURS.map((n) => [`${n.name} (beside ${n.of})`, n] as const))("passes with no issue at all: %s", (_label, n) => {
    const d = zhDraft(n.edition);
    n.mutate(d);
    expect(whole(d, n.edition)).toEqual([]);
    expect(whole(d, n.edition, true)).toEqual([]);
  });

  it.each(EDITION_NAMES.map((e) => [e] as const))("the valid %s Chinese draft passes the group's rules and every rule", (edition) => {
    const draft = zhDraft(edition);
    expect(whole(draft, edition, true)).toEqual([]);
    expect(whole(draft, edition)).toEqual([]);
  });
});

// ── The builder's helpers ────────────────────────────────────────────────────────────────────────

describe("dashEscaped() and the Chinese outputs", () => {
  const chr = (cp: number): string => String.fromCodePoint(cp);
  const readBack = (text: string): string => JSON.parse(`"${text}"`) as string;

  it("keeps the hyphen-minus and writes every other dash, and the two box-drawing lines, as an escape that JSON reads back as the same character", () => {
    expect(dashEscaped("a-b")).toBe("a-b");
    for (const cp of [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2e3a, 0x2e3b, 0xfe58, 0xfe63, 0xff0d, 0x301c, 0x2500, 0x2501]) {
      const out = dashEscaped(`x${chr(cp)}y`);
      expect(out, `U+${cp.toString(16)}`).toBe(`x\\u${cp.toString(16).padStart(4, "0")}y`);
      expect(readBack(out)).toBe(`x${chr(cp)}y`);
    }
  });

  it("writes a dash outside the Basic Multilingual Plane as two escapes of its surrogate pair, which JSON reads back as that one character", () => {
    const yezidi = chr(0x10ead);
    expect(yezidi).toHaveLength(2);
    const out = dashEscaped(`x${yezidi}y`);
    expect(out).toBe("x\\ud803\\udeady");
    expect(readBack(out)).toBe(`x${yezidi}y`);
  });

  it("leaves every other character alone: Han, the Latin letters, digits, the full-width punctuation and the other box-drawing lines", () => {
    const text = `範例：人工智慧（AI）8 月 31 日，約 1,800 個。${chr(0x2502)}${chr(0x2503)}`;
    expect(dashEscaped(text)).toBe(text);
  });

  it("writes an F draft with its dashes escaped and no other change, so a file never holds a dash as a character", () => {
    const c: ZhInvalidCase = { code: "ZH_NO_DASH", file: "invalid--ZH_NO_DASH.zh.json", mutate: (d) => { d.strings["also.0"] += `${EM}${EM}`; } };
    const { text } = zhInvalidOutputs([c])[0]!;
    expect(text).toContain("\\u2014\\u2014");
    expect(text.includes(EM)).toBe(false);
    expect((JSON.parse(text) as { strings: Record<string, string> }).strings["also.0"]!.endsWith(`${EM}${EM}`)).toBe(true);
  });

  it("writes a draft that fails its schema as it is, and a draft that passes through the schema's own key order", () => {
    const bad = zhInvalidOutputs([{ code: "SCHEMA", file: "invalid--SCHEMA.zh.json", mutate: () => ({ not: "a draft" }) }])[0]!;
    expect(JSON.parse(bad.text)).toEqual({ not: "a draft" });
    const good = zhInvalidOutputs([{ code: "ZH_KEYS", file: "invalid--ZH_KEYS.zh.json", mutate: () => undefined }])[0]!;
    expect(Object.keys(JSON.parse(good.text) as object)).toEqual(["schema_version", "date", "generated_at", "strings", "terms"]);
    expect(good.text).toBe(fileText("fixtures/drafts-zh/valid-weekday.zh.json"));
  });

  it("refuses a file name that is not the code's, in the invalid and the soft builder", () => {
    expect(() => zhInvalidOutputs([{ code: "ZH_KEYS", file: "oops.zh.json", mutate: () => undefined }])).toThrow(/invalid--ZH_KEYS\.zh\.json/);
    expect(() => zhInvalidOutputs([{ code: "ZH_KEYS", file: "invalid--ZH_KEYS.json", mutate: () => undefined }])).toThrow(/invalid--ZH_KEYS\.zh\.json/);
    expect(() => zhSoftOutputs([{ code: "ZH_KEYS", file: "invalid--ZH_KEYS.zh.json", mutate: () => undefined }])).toThrow(/soft--ZH_KEYS\.zh\.json/);
  });

  it("builds a soft case's file under fixtures/drafts-zh/ from its edition's valid draft", () => {
    const soft: ZhSoftCase = { code: "ZH_KEYS", file: "soft--ZH_KEYS.zh.json", edition: "sunday", mutate: (d) => { d.strings.deep_dive += "。"; } };
    const out = zhSoftOutputs([soft]);
    expect(out.map((o) => o.path)).toEqual(["fixtures/drafts-zh/soft--ZH_KEYS.zh.json"]);
    expect((JSON.parse(out[0]!.text) as { strings: Record<string, string> }).strings.deep_dive).toBe(`${zhDraft("sunday").strings.deep_dive}。`);
  });

  it("gives the same draft each time, and leaves each edition's valid Chinese draft as it was", () => {
    const before = EDITION_NAMES.map((e) => JSON.stringify(zhDraft(e)));
    for (const c of zhCases) expect(JSON.stringify(zhInvalidDraft(c)), c.code).toBe(JSON.stringify(zhInvalidDraft(c)));
    for (const c of zhNamed) expect(JSON.stringify(mutated(c)), c.name).toBe(JSON.stringify(mutated(c)));
    expect(EDITION_NAMES.map((e) => JSON.stringify(zhDraft(e)))).toEqual(before);
    for (const e of EDITION_NAMES) expect(DraftZh.safeParse(zhDraft(e)).success, e).toBe(true);
  });
});

// ── What the cases add ───────────────────────────────────────────────────────────────────────────

describe("what the Chinese cases add to a valid draft", () => {
  const all: { label: string; edition: EditionName; draft: unknown; case: ZhInvalidCase | ZhNamedCase }[] = [
    ...zhCases.map((c) => ({ label: `F ${c.code}`, edition: c.edition ?? "weekday", draft: zhInvalidDraft(c), case: c })),
    ...zhNamed.map((c) => ({ label: `T ${c.name}`, edition: c.edition, draft: mutated(c), case: c })),
  ];
  /**
   * The hosts a case may name: an invented example host, the term bank's own host with the lookalike that ZH_OFFICIAL must refuse, and
   * the link shortener t.co that the BLOCKED_HOST cases write as a blocked address (the English case names it too, with an invented path).
   */
  const HOSTS = new Set(["example.org", "terms.naer.edu.tw", "terms.naer.edu.tw.example.org", "t.co"]);

  it("is invented text only: no more than a few hundred characters added, no link to a real host, and a sentence a reader could take for real says it is an example", () => {
    let count = 0;
    for (const { label, edition, draft } of all) {
      const before = zhDraft(edition);
      const after = draft as { strings?: Record<string, string> };
      for (const edit of changed(before, draft).filter((e) => e.startsWith("strings."))) {
        const key = edit.slice("strings.".length);
        const grew = (after.strings?.[key] ?? "").length - (before.strings[key] ?? "").length;
        expect(grew, `${label}: ${key}`).toBeLessThanOrEqual(400);
      }
      for (const s of added(before, draft)) {
        count += 1;
        for (const url of s.match(/https?:\/\/[^\s/）]+/g) ?? []) expect(HOSTS.has(url.replace(/^https?:\/\//, "")), `${label}: ${url}`).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(70);
    // The sample sentence that names a made-up agent and a procedure says that it is an example
    const dual = JSON.stringify(zhInvalidDraft(zhCases.find((c) => c.code === "DUAL_USE")!));
    expect(dual).toContain("範例");
  });

  it("holds no em dash and no lonely en dash in the source, and no dash as a character in any file the cases write", () => {
    const source = fileText("fixtures/src/invalid/zh.ts");
    expect(source.includes(EM)).toBe(false);
    expect(source.replace(new RegExp(`(?<=\\d)${EN}(?=\\d)`, "g"), "").includes(EN)).toBe(false);
    const test = fileText("tests/fixtures-zh-invalid.test.ts");
    expect(test.includes(EM)).toBe(false);
    expect(test.replace(new RegExp(`(?<=\\d)${EN}(?=\\d)`, "g"), "").includes(EN)).toBe(false);
    for (const c of zhCases) {
      const text = fileText(`fixtures/drafts-zh/${c.file}`);
      expect(/[\p{Pd}─━]/u.test(text.replaceAll("-", "")), c.file).toBe(false);
    }
  });

  it("keeps the canary token only in the CANARY fixture and the secret-shaped string only in the SECRET_LIKE one, and neither as a literal in the source", () => {
    for (const c of zhCases) {
      const text = fileText(`fixtures/drafts-zh/${c.file}`);
      expect(text.includes(CANARY_TOKEN), `${c.file} canary`).toBe(c.code === "CANARY");
      expect(/sk-[A-Za-z0-9]{20,}/.test(text), `${c.file} secret`).toBe(c.code === "SECRET_LIKE");
    }
    for (const c of zhCases) expect(fileText(`fixtures/drafts-zh/${c.file}`).includes("https://t.co/"), `${c.file} blocked address`).toBe(c.code === "BLOCKED_HOST");
    expect(fileText("fixtures/src/invalid/zh.ts")).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(fileText("fixtures/src/invalid/zh.ts")).not.toContain(CANARY_TOKEN);
  });

  it("puts each safety text where ZH_PARITY does not read, so the case fails for its own code alone (a term's official_url, or a sentence in Chinese characters only)", () => {
    for (const code of ["CANARY", "SECRET_LIKE", "BLOCKED_HOST"]) {
      const c = zhCases.find((x) => x.code === code)!;
      const d = zhInvalidDraft(c) as DraftZh;
      const [id] = changed(zhDraft("weekday"), d).map((p) => p.replace("terms.", ""));
      expect(d.terms[id!]!.official_url, code).toMatch(/#/);
    }
    const dual = zhInvalidDraft(zhCases.find((x) => x.code === "DUAL_USE")!) as DraftZh;
    expect(/[A-Za-z0-9]/.test(dual.strings["corrections.0.after"]!.slice(zhDraft("weekday").strings["corrections.0.after"]!.length))).toBe(false);
  });

  it("makes the DATE_MISMATCH fixture the day before the context's date and the BLOCKED_HOST fixture one blocked address after a page of the term bank", () => {
    const date = zhInvalidDraft(zhCases.find((x) => x.code === "DATE_MISMATCH")!) as DraftZh;
    expect(zhDraft("weekday").date).toBe("2026-10-14");
    expect(date.date).toBe("2026-10-13");
    expect(date.generated_at).toBe(zhDraft("weekday").generated_at);
    const blocked = zhInvalidDraft(zhCases.find((x) => x.code === "BLOCKED_HOST")!) as DraftZh;
    const was = zhDraft("weekday").terms["numerical-weather-prediction"]!.official_url!;
    expect(blocked.terms["numerical-weather-prediction"]!.official_url).toBe(`${was}#https://t.co/ut-sample-idea`);
  });

  it("puts the DATE_MISMATCH named cases on the boundaries to the second, in every edition: a second before the English draft's time, at it, at the deadline, a second after it, and the day after", () => {
    const iso = (text: string, seconds: number): string => new Date(Date.parse(text) + seconds * 1000).toISOString();
    for (const edition of EDITION_NAMES) {
      const english = EDITIONS[edition].generatedAt;
      const { deadline } = ZH_CLOCK[edition];
      const named = zhNamed.filter((c) => c.name.startsWith(`DATE_MISMATCH: ${edition}: `));
      expect(named.map((c) => c.name.slice(`DATE_MISMATCH: ${edition}: `.length)), edition).toEqual([
        "a generated_at one second before the English draft's", "a generated_at exactly the English draft's",
        "a generated_at exactly the deadline", "a generated_at one second after the deadline", "a date the day after the context's",
      ]);
      const draftAt = named.map((c) => (mutated(c) as DraftZh).generated_at);
      expect(draftAt.slice(0, 4).map((t) => new Date(t).toISOString()), edition).toEqual([iso(english, -1), iso(english, 0), iso(deadline, 0), iso(deadline, 1)]);
      expect(draftAt[4], edition).toBe(zhDraft(edition).generated_at);
      const next = new Date(Date.parse(`${zhDraft(edition).date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      expect((mutated(named[4]!) as DraftZh).date, edition).toBe(next);
    }
  });

  it("makes every named case change the draft it names, so no case passes by changing nothing", () => {
    for (const c of zhNamed) expect(changed(zhDraft(c.edition), mutated(c)).length, c.name).toBeGreaterThanOrEqual(1);
    for (const c of zhCases) expect(existsSync(join(REPO_ROOT, "fixtures/drafts-zh", c.file)), c.file).toBe(true);
  });
});
