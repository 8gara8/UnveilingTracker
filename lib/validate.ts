// The validator's entry points (SPEC §4.12, §8.6): `validateDraft()` for the agent's English draft and the pieces every entry
// point shares (`schemaIssues()`, `toResult()`, `ValidationResult`, and the engine's names re-exported from lib/rules/run.ts).
// A draft is parsed with the DraftBrief schema first; a draft that fails is judged by its SCHEMA issues alone and no rule
// runs, so the repair prompt never mixes a malformed record's schema errors with rule errors that read it. The draft's own
// strings are read at the same door (`invisibleIssues()`): one that holds an invisible character is one more SCHEMA issue,
// whether or not the schema passed, since such a character defeats the word counts and the word lists that the rules read.
// A draft that parses and holds none gets the input of lib/rules/run.ts `buildDraftInput()` (views and the string inventory
// built once) and every registered rule that runs in draft mode. The published, Chinese and content-folder entry points are written beside it
// on the same frame (SPEC §4.12: `validatePublished()`, `validateZh()`, `validateAll()`).
//
// Cyber's lib/validate.ts at the fork commit 3ced1fb, adapted: `ValidationResult`, `schemaIssues()` (its "Unknown key" and
// "Missing key" messages), `toResult()` and `validateDraft()` are Cyber's idea; `formatPath()` (Cyber's was here) lives in
// lib/rules/types.ts and is re-exported; Cyber's best-effort rules on a schema failure and its published and content-folder
// engines (the Gap, the manifest, the cross-file references) belong to Cyber's domain parts or to the engines written later.

import type { ZodError } from "zod";
import { buildDraftInput, runRules, sortIssues, type DraftInputs } from "./rules/run";
import { RULES } from "./rules/index";
import { error, formatPath, plural, type ValidationIssue } from "./rules/types";
import { shown, shownTo } from "./rules/shared";
import { INVISIBLE } from "./sanitize";
import { DraftBrief } from "./schema/draft";

export { formatPath } from "./rules/types";
export type { Rule, RuleInput, StoredRecords, ValidationIssue } from "./rules/types";
export {
  ARCHIVE_WARNING_CODES, ENGINE_CODES, beingPublishedOf, buildDraftInput, buildPublishedInput, comparePaths, runRules, sortIssues,
  type DraftInputs, type PublishedContent, type PublishedOptions,
} from "./rules/run";
export { validateAll, validatePublished, type AllOptions, type AllResult, type FileResult, type StoredInputs } from "./validate-stored";
export { buildZhInput, validateZh, zhBacklogIds, type ZhInputs, type ZhOptions, type ZhResult } from "./validate-zh";

/** What every entry point returns: `issues` is all of them in the engine's order, `errors` and `warnings` the same split by severity. */
export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  issues: ValidationIssue[];
}

/**
 * The most characters of an issue's place and of its message and hint that any result holds. The draft is untrusted: a key it
 * invents is part of an issue's path (`strings["..."]`), and a rule may quote a value in its message, so a draft with a 5 MB key
 * would give a 5 MB line. Each rule and the SCHEMA builder shorten what they quote (`shown()`), and this is the net under them for
 * a place no rule thought of. The longest message of any rule is about 700 characters, a path 60.
 */
export const RESULT_PATH_MAX = 400;
export const RESULT_MESSAGE_MAX = 1000;

/** An issue with its path, message and hint within the result's limits, else the issue itself. */
function bounded(issue: ValidationIssue): ValidationIssue {
  const path = shownTo(issue.path, RESULT_PATH_MAX);
  const message = shownTo(issue.message, RESULT_MESSAGE_MAX);
  const hint = issue.hint === null ? null : shownTo(issue.hint, RESULT_MESSAGE_MAX);
  return path === issue.path && message === issue.message && hint === issue.hint ? issue : { ...issue, path, message, hint };
}

export function toResult(issues: readonly ValidationIssue[]): ValidationResult {
  const all = issues.map(bounded);
  const errors = all.filter((i) => i.severity === "error");
  return { ok: errors.length === 0, errors, warnings: all.filter((i) => i.severity === "warning"), issues: all };
}

// ── Schema issues ────────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when the key at `p` is absent from its parent object in `input`. */
function keyAbsent(input: unknown, p: readonly PropertyKey[]): boolean {
  if (p.length === 0) return false;
  let cur: unknown = input;
  for (const k of p.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return false;
    cur = (cur as Record<PropertyKey, unknown>)[k];
  }
  return isRecord(cur) && !(String(p[p.length - 1]) in cur);
}

const UNKNOWN_HINT = "Only keys the schema defines are allowed; scripts add the computed fields at publish.";
const MISSING_HINT = "Every key is required; use null or [] when there is nothing to report.";
const CHECK_HINT = "One of the schema's own checks on the value; change it as the message says.";

/**
 * The most characters of a refinement's own message that a SCHEMA issue prints. A refinement may quote a value of the draft in its message
 * (a correction's path), and no value of a draft is limited; no message of the schemas is near this length. Every other message of a
 * schema is its own wording, or the schema's own values, and is short.
 */
export const SCHEMA_MESSAGE_MAX = 400;

/**
 * SCHEMA issues (SPEC §4.12): one per Zod issue, with the message and a hint that says what to change. An unknown key is
 * one "Unknown key" issue per key, telling the writer to remove it; an absent key is "Missing key" (every key is required,
 * §4.1). The draft's own refinements (a correction's `path` and `after`, an AI role without evidence, `ai_helped` against
 * the role) come through as the schema's own messages. Pass the parsed `input` so an absent key is told apart from a wrong value.
 */
export function schemaIssues(err: ZodError, input?: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const issue of err.issues) {
    const path = formatPath(issue.path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) out.push(error("SCHEMA", formatPath([...issue.path, key]), `Unknown key "${shown(key)}"; remove it.`, UNKNOWN_HINT));
      continue;
    }
    const missing = input === undefined
      ? issue.code === "invalid_type" && /received undefined/.test(issue.message)
      : keyAbsent(input, issue.path);
    if (missing) {
      const expected = issue.code === "invalid_type" ? ` (expected ${issue.expected})`
        : issue.code === "invalid_value" ? ` (expected ${issue.values.map((v) => JSON.stringify(v)).join(" or ")})` : "";
      out.push(error("SCHEMA", path, `Missing key${expected}.`, MISSING_HINT));
    } else if (issue.code === "invalid_union") {
      const forms = issue.discriminator !== undefined && "options" in issue && issue.options !== undefined
        ? ` ("${issue.discriminator}" must be ${issue.options.map((o) => JSON.stringify(o)).join(" or ")})` : "";
      out.push(error("SCHEMA", path, `Does not match any allowed form for this field${forms}.`, "Check the field's description in the draft schema for the allowed forms."));
    } else if (issue.code === "custom") {
      out.push(error("SCHEMA", path, shownTo(issue.message, SCHEMA_MESSAGE_MAX), CHECK_HINT));
    } else {
      out.push(error("SCHEMA", path, issue.message, "Change the value to one the schema allows; the field's description in the draft schema says which."));
    }
  }
  return out;
}

// ── Invisible characters ─────────────────────────────────────────────────────────────────────────

/** The most strings `invisibleIssues()` lists one by one; every string beyond them is counted in one summary issue. */
export const INVISIBLE_LISTED_MAX = 50;

const INVISIBLE_HINT = "Delete the character and use plain spaces and ordinary punctuation. Invisible characters hide words from the word counts and the word lists.";
const MORE_HINT = "Delete every invisible character and use plain spaces and ordinary punctuation, then validate again: the strings not listed are listed once these are fixed.";

/** What `invisibleIssues()` found: the strings it lists, in document order, and one summary issue when more strings held one than it lists. */
export interface InvisibleScan {
  listed: ValidationIssue[];
  summary: ValidationIssue | null;
}

/** One step of the path to a value: the key or index it sits at, and the step before it. */
interface PathNode {
  readonly parent: PathNode | null;
  readonly key: string | number;
}

/** A container being walked: its keys (null for an array, which is walked by index) and how many it has given so far. */
interface Frame {
  readonly value: unknown;
  readonly keys: readonly string[] | null;
  next: number;
  readonly node: PathNode | null;
}

/** The 1-based number of the character that starts at the UTF-16 index `at` of `text` (a character outside the Basic Multilingual Plane counts once). */
function characterNumber(text: string, at: number): number {
  let n = 1;
  for (let i = 0; i < at; i += text.codePointAt(i)! > 0xffff ? 2 : 1) n++;
  return n;
}

/**
 * The strings of a draft as parsed JSON that hold an invisible character (SPEC §4.12 SCHEMA): a C0 or C1 control other than tab, line
 * feed and carriage return, a Default_Ignorable_Code_Point such as a zero-width space, the soft hyphen, a bidi override, the byte
 * order mark or a tag character, any other format character (general category Cf), the Braille blank or the object replacement
 * character (`INVISIBLE`, lib/sanitize.ts). Such a character joins the words of a string into one for the word counts
 * and splits a banned word that a list would match, so a draft that holds one is turned back at the door, whatever else the schema says.
 * One SCHEMA error per string, at its path in `formatPath()`'s form, naming the first such code point and its place. Object keys are not
 * read: the schema fixes every key of a draft but the Chinese draft's `strings` keys, which ZH_KEYS holds to the context's. Reads the raw
 * value (never the parsed one), so a draft the schema refuses is read too; walks it once, in document order, linearly and without
 * recursion, and never visits an object twice. Lists at most `INVISIBLE_LISTED_MAX` strings: the others are only counted, in one summary issue.
 */
export function invisibleIssues(raw: unknown): InvisibleScan {
  const listed: ValidationIssue[] = [];
  let skipped = 0;
  const seen = new WeakSet<object>();
  const stack: Frame[] = [];
  const pathOf = (node: PathNode | null): (string | number)[] => {
    const out: (string | number)[] = [];
    for (let n = node; n !== null; n = n.parent) out.push(n.key);
    return out.reverse();
  };
  const visit = (value: unknown, node: PathNode | null): void => {
    if (typeof value === "string") {
      const at = value.search(INVISIBLE);
      if (at < 0) return;
      if (listed.length >= INVISIBLE_LISTED_MAX) {
        skipped++;
        return;
      }
      const code = value.codePointAt(at)!.toString(16).toUpperCase().padStart(4, "0");
      listed.push(error("SCHEMA", formatPath(pathOf(node)), `Has an invisible character, U+${code}, at character ${characterNumber(value, at)} (counting from 1).`, INVISIBLE_HINT));
    } else if (typeof value === "object" && value !== null && !seen.has(value)) {
      seen.add(value);
      stack.push({ value, keys: Array.isArray(value) ? null : Object.keys(value), next: 0, node });
    }
  };
  visit(raw, null);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const size = frame.keys === null ? (frame.value as unknown[]).length : frame.keys.length;
    if (frame.next >= size) {
      stack.pop();
      continue;
    }
    const key: string | number = frame.keys === null ? frame.next : frame.keys[frame.next]!;
    frame.next++;
    visit((frame.value as Record<string | number, unknown>)[key], { parent: frame.node, key });
  }
  const summary = skipped === 0 ? null
    : error("SCHEMA", "(root)", `${plural(skipped, "more string")} ${skipped === 1 ? "holds" : "hold"} an invisible character; only the first ${INVISIBLE_LISTED_MAX} strings are listed.`, MORE_HINT);
  return { listed, summary };
}

/** The SCHEMA issues of a draft turned back at the door: `schema` and the strings `scan` listed, in the engine's order, then the scan's summary, which is no finding at a path and so stands last. */
export function doorIssues(schema: readonly ValidationIssue[], scan: InvisibleScan): ValidationIssue[] {
  const issues = sortIssues([...schema, ...scan.listed]);
  return scan.summary === null ? issues : [...issues, scan.summary];
}

// ── The English draft ────────────────────────────────────────────────────────────────────────────

/**
 * Validates the agent's English draft: SCHEMA (the DraftBrief schema, unknown keys and the draft corrections' checks
 * included, and a string that holds an invisible character, `invisibleIssues()`), then, for a draft that passes, every
 * registered rule that runs in draft mode. A draft that fails SCHEMA either way returns its SCHEMA issues alone, both
 * kinds together, in the engine's order, and `draft` null. A run input that is missing gives one INPUT_MISSING warning
 * and skips the checks that need it; a rule that throws gives one RULE_ERROR issue (SPEC §4.12 "Fixtures and tests").
 */
export function validateDraft(input: unknown, inputs: DraftInputs): ValidationResult & { draft: DraftBrief | null } {
  const parsed = DraftBrief.safeParse(input);
  const invisible = invisibleIssues(input);
  if (!parsed.success || invisible.listed.length > 0) {
    return { ...toResult(doorIssues(parsed.success ? [] : schemaIssues(parsed.error, input), invisible)), draft: null };
  }
  let issues: ValidationIssue[];
  try {
    issues = runRules(buildDraftInput(parsed.data, inputs), inputs.rules ?? RULES);
  } catch (err) {
    const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    issues = [error("RULE_ERROR", "(engine)", `The validator could not read its inputs (${why}).`, "This is a fault in the validator or its inputs, not in the draft: report it.")];
  }
  return { ...toResult(issues), draft: parsed.data };
}
