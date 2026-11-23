// The validator's entry points (SPEC §4.12, §8.6): `validateDraft()` for the agent's English draft and the pieces every entry
// point shares (`schemaIssues()`, `toResult()`, `ValidationResult`, and the engine's names re-exported from lib/rules/run.ts).
// A draft is parsed with the DraftBrief schema first; a draft that fails is judged by its SCHEMA issues alone and no rule
// runs, so the repair prompt never mixes a malformed record's schema errors with rule errors that read it. A draft that
// parses gets the input of lib/rules/run.ts `buildDraftInput()` (views and the string inventory built once) and every
// registered rule that runs in draft mode. The published, Chinese and content-folder entry points are written beside it
// on the same frame (SPEC §4.12: `validatePublished()`, `validateZh()`, `validateAll()`).
//
// Cyber's lib/validate.ts at the fork commit 3ced1fb, adapted: `ValidationResult`, `schemaIssues()` (its "Unknown key" and
// "Missing key" messages), `toResult()` and `validateDraft()` are Cyber's idea; `formatPath()` (Cyber's was here) lives in
// lib/rules/types.ts and is re-exported; Cyber's best-effort rules on a schema failure and its published and content-folder
// engines (the Gap, the manifest, the cross-file references) belong to Cyber's domain parts or to the engines written later.

import type { ZodError } from "zod";
import { buildDraftInput, runRules, sortIssues, type DraftInputs } from "./rules/run";
import { RULES } from "./rules/index";
import { error, formatPath, type ValidationIssue } from "./rules/types";
import { DraftBrief } from "./schema/draft";

export { formatPath } from "./rules/types";
export type { Rule, RuleInput, StoredRecords, ValidationIssue } from "./rules/types";
export {
  ARCHIVE_WARNING_CODES, ENGINE_CODES, beingPublishedOf, buildDraftInput, buildPublishedInput, comparePaths, runRules, sortIssues,
  type DraftInputs, type PublishedContent, type PublishedOptions,
} from "./rules/run";

/** What every entry point returns: `issues` is all of them in the engine's order, `errors` and `warnings` the same split by severity. */
export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  issues: ValidationIssue[];
}

export function toResult(issues: readonly ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === "error");
  return { ok: errors.length === 0, errors, warnings: issues.filter((i) => i.severity === "warning"), issues: [...issues] };
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
      for (const key of issue.keys) out.push(error("SCHEMA", formatPath([...issue.path, key]), `Unknown key "${key}"; remove it.`, UNKNOWN_HINT));
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
      out.push(error("SCHEMA", path, issue.message, CHECK_HINT));
    } else {
      out.push(error("SCHEMA", path, issue.message, "Change the value to one the schema allows; the field's description in the draft schema says which."));
    }
  }
  return out;
}

// ── The English draft ────────────────────────────────────────────────────────────────────────────

/**
 * Validates the agent's English draft: SCHEMA (the DraftBrief schema, unknown keys and the draft corrections' checks
 * included), then, for a draft that parses, every registered rule that runs in draft mode. A draft that fails the schema
 * returns its SCHEMA issues alone, in the engine's order, and `draft` null. A run input that is missing gives one
 * INPUT_MISSING warning and skips the checks that need it; a rule that throws gives one RULE_ERROR issue (SPEC §4.12
 * "Fixtures and tests").
 */
export function validateDraft(input: unknown, inputs: DraftInputs): ValidationResult & { draft: DraftBrief | null } {
  const parsed = DraftBrief.safeParse(input);
  if (!parsed.success) return { ...toResult(sortIssues(schemaIssues(parsed.error, input))), draft: null };
  let issues: ValidationIssue[];
  try {
    issues = runRules(buildDraftInput(parsed.data, inputs), inputs.rules ?? RULES);
  } catch (err) {
    const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    issues = [error("RULE_ERROR", "(engine)", `The validator could not read its inputs (${why}).`, "This is a fault in the validator or its inputs, not in the draft: report it.")];
  }
  return { ...toResult(issues), draft: parsed.data };
}
