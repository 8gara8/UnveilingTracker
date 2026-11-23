// The engine's core (SPEC §4.12): builds the input a rule reads (`buildDraftInput()`, `buildPublishedInput()`) and runs the
// registered rules on it (`runRules()`). One engine serves every mode: it filters the rules by mode and by the run inputs they
// need, turns a rule that throws into one issue instead of a crash, holds each rule to the codes it declares, demotes the
// safety codes on records that are not being published (ARCHIVE_WARNING_CODES), and returns the issues in one stable order,
// without duplicates. The English-draft entry point is lib/validate.ts `validateDraft()`; the published and Chinese engines
// (validatePublished(), validateAll(), validateZh()) build their inputs the same way and call `runRules()`.
//
// Cyber's lib/validate.ts at the fork commit 3ced1fb, adapted: `runRules()`, `ENGINE_CODES`, `ARCHIVE_WARNING_CODES`,
// `DraftInputs` and the scope filter are Cyber's idea, made to read a mode list and a rule's `needs`; Cyber's best-effort run
// on a schema failure, its metrics-missing warning and its data-only filter have no counterpart here (a draft that fails the
// schema is judged by SCHEMA alone, a missing run input gives one INPUT_MISSING warning per input, and a rule that must skip a
// data-only edition reads `input.edition`).

import type { LoadedConfig } from "../config";
import { draftFilings } from "../items";
import { byCodeUnit } from "../ids";
import type { Brief } from "../schema/brief";
import type { IsoDate } from "../schema/common";
import type { AgentContext } from "../schema/context";
import type { DraftBrief } from "../schema/draft";
import type { Finding } from "../schema/finding";
import type { Term } from "../schema/glossary";
import type { MetricsFile } from "../schema/metrics";
import type { Correction, Evidence, Report } from "../schema/misc";
import type { Pack } from "../schema/pack";
import { RULES } from "./index";
import { editionKindOf, lacksInput } from "./shared";
import { draftInventory, publishedInventory } from "./strings";
import {
  error, plural, warning, type BeingPublished, type DraftInput, type PublishedInput, type Rule, type RuleInput, type RuleNeed,
  type StoredRecords, type ValidationIssue,
} from "./types";
import { buildViews } from "./views";

/** Codes the engine itself reports; the rules' codes are in lib/rules/ (RULE_CODE_TABLE). */
export const ENGINE_CODES = ["SCHEMA", "INPUT_MISSING", "RULE_ERROR"] as const;

/**
 * The codes that read the current safety lists (SPEC §4.12 "Stored records"): `dual-use.json` and BLOCKED_HOSTS. On a record
 * that is not being published their errors are warnings, so a list change never turns a PR red or makes publish refuse an
 * edition; the site still skips the record (§6). SECRET_LIKE and CANARY read no list and stay errors everywhere.
 */
export const ARCHIVE_WARNING_CODES: readonly string[] = ["DUAL_USE", "BLOCKED_HOST", "SOURCE_URL"];

// ── The English draft's input ────────────────────────────────────────────────────────────────────

/** Everything `validateDraft()` reads besides the draft, from memory (SPEC §8.2 stage 7) or from files through scripts/validate.ts. */
export interface DraftInputs {
  /** The copy in memory, never `drafts/context.json` (SPEC §4.15). */
  context: AgentContext;
  /** `logs/D.evidence.json`; absent or null skips the rules that need it, with one INPUT_MISSING warning. */
  evidence?: Evidence | null;
  /** The metrics file for D, committed or staged; absent or null skips the rules that need it. */
  metrics?: MetricsFile | null;
  /** `packs/D.json`; absent or null skips the rules that need it. */
  pack?: Pack | null;
  /**
   * The stored findings the draft names and every stored correction and glossary term, which the stage reads from `content/`
   * (`StoredRecords`, types.ts). Absent or null: a stored finding is seen through the context alone, in part.
   */
  stored?: StoredRecords | null;
  config: LoadedConfig;
  /** The date in a `YYYY-MM-DD.json` file name, when a file is validated. */
  fileDate?: string | null;
  /** The rules to run; default RULES (tests pass their own). */
  rules?: readonly Rule[];
}

/**
 * The input of a rule for a parsed English draft. D is the context's date, and every finding is filed on it; the draft's own
 * corrections count as `filedAs()` reads them, dated D (SPEC §4.10), with ids that publish will give them. Given the stored
 * records, those are counted on from the highest stored id and the stored corrections file every finding too; without them
 * the ids count from C-0001 and the context's findings are already filed on D by the stored corrections.
 */
export function buildDraftInput(draft: DraftBrief, inputs: DraftInputs): DraftInput {
  const { context } = inputs;
  const date = context.date;
  const stored = inputs.stored ?? null;
  const filing = [...(stored?.corrections ?? []), ...draftFilings(draft.corrections, stored?.corrections ?? [], date)];
  return {
    mode: "draft",
    date,
    fileDate: inputs.fileDate ?? null,
    edition: editionKindOf({ format: context.format, weekFindings: context.week === null ? null : context.week.findings.length }),
    format: context.format,
    config: inputs.config,
    filing,
    views: buildViews({ mode: "draft", date, draft, context, filing, stored }),
    inventory: draftInventory(draft),
    draft: { brief: draft, context, evidence: inputs.evidence ?? null, metrics: inputs.metrics ?? null, pack: inputs.pack ?? null },
  };
}

// ── The published input ──────────────────────────────────────────────────────────────────────────

/** The stored records a published-mode run reads besides the brief: what the brief names and the files that name each other. */
export interface PublishedContent {
  readonly findings: readonly Finding[];
  readonly terms: readonly Term[];
  readonly corrections: readonly Correction[];
  readonly reports: readonly Report[];
}

export interface PublishedOptions {
  config: LoadedConfig;
  /** The date in a `YYYY-MM-DD.json` file name, when a file is validated. */
  fileDate?: string | null;
  /**
   * The date being published (`validateAll()`'s `publishing`): the brief of that date, the findings first briefed on it, the
   * terms first used on it, the corrections dated on it and the reports decided on it are being published and are judged
   * against `config/` (SPEC §4.12 "Stored records"). Absent or null: none is.
   */
  publishing?: IsoDate | null;
  /** D for a run with no brief: the date a stored record is filed on. Ignored when there is a brief, whose own date is D. */
  date?: IsoDate;
  /** The rules to run; default RULES (tests pass their own). */
  rules?: readonly Rule[];
}

/** Which stored records the run judges against `config/` (SPEC §4.12 "Stored records"), given the date being published. */
export function beingPublishedOf(brief: Brief | null, content: PublishedContent, publishing: IsoDate | null): BeingPublished {
  if (publishing === null) {
    return { brief: false, findings: new Set(), terms: new Set(), corrections: new Set(), reports: new Set() };
  }
  return {
    brief: brief !== null && brief.date === publishing,
    findings: new Set(content.findings.filter((f) => f.first_brief === publishing).map((f) => f.id)),
    terms: new Set(content.terms.filter((t) => t.first_date === publishing).map((t) => t.id)),
    corrections: new Set(content.corrections.filter((c) => c.date === publishing).map((c) => c.id)),
    reports: new Set(content.reports.filter((r) => r.resolved_on === publishing).map((r) => r.id)),
  };
}

/**
 * The input of a rule for a stored brief and the records it reads, or (with no brief, and `options.date`) for records no
 * brief names. The stored corrections file the findings (SPEC §4.10); a finding is read as filed on D, the brief's date.
 */
export function buildPublishedInput(brief: Brief, content: PublishedContent, options: PublishedOptions): PublishedInput;
export function buildPublishedInput(brief: null, content: PublishedContent, options: PublishedOptions & { date: IsoDate }): PublishedInput;
export function buildPublishedInput(brief: Brief | null, content: PublishedContent, options: PublishedOptions): PublishedInput {
  const date = brief === null ? options.date : brief.date;
  if (date === undefined) throw new Error("buildPublishedInput: records no brief names need `options.date`");
  const being = beingPublishedOf(brief, content, options.publishing ?? null);
  const strings = { brief, findings: content.findings, terms: content.terms, corrections: content.corrections, reports: content.reports, being };
  const filing = content.corrections;
  return {
    mode: "published",
    date,
    fileDate: options.fileDate ?? null,
    edition: editionKindOf({ format: brief === null ? null : brief.format, dataOnly: brief !== null && brief.edition === "data_only" }),
    format: brief === null ? null : brief.format,
    config: options.config,
    filing,
    views: buildViews({ mode: "published", date, filing, ...strings }),
    inventory: publishedInventory(strings),
    published: { ...strings, publishing: being.brief },
  };
}

// ── Running the rules ────────────────────────────────────────────────────────────────────────────

const NEED_LABEL: Readonly<Record<RuleNeed, { name: string; path: string; hint: string }>> = {
  evidence: { name: "evidence", path: "(evidence)", hint: "Give the run's evidence (logs/D.evidence.json: the URLs it saw and the pages it fetched) and validate again." },
  metrics: { name: "metrics file", path: "(metrics)", hint: "Give the metrics for the date (content/metrics/D.json, else the staged copy) and validate again." },
  pack: { name: "source pack", path: "(pack)", hint: "Give the pack for the date (packs/D.json) and validate again." },
};
const NEEDS: readonly RuleNeed[] = ["evidence", "metrics", "pack"];

const MESSAGE_MAX = 200;

function ruleError(rule: Rule, message: string): ValidationIssue {
  return error("RULE_ERROR", `(rule ${rule.codes[0]})`, message,
    "This is a fault in the validator, not in the draft: report it. The other checks ran.");
}

/** The record an issue's path points into, and whether it is being published; a path that names no record counts as being published. */
function isPublishingPath(input: PublishedInput, path: string): boolean {
  const { being, terms, corrections, reports } = input.published;
  const found = /^([A-Za-z0-9_./-]+\.json): (.*)$/s.exec(path);
  if (found === null) return true;
  const [, file, rest] = found;
  const index = (key: string): number | null => {
    const m = new RegExp(`^${key}\\[(0|[1-9][0-9]*)\\]`).exec(rest!);
    return m === null ? null : Number(m[1]);
  };
  if (/^briefs\/[^/]+\.json$/.test(file!)) return being.brief;
  const finding = /^findings\/([^/]+)\.json$/.exec(file!);
  if (finding !== null) return being.findings.has(finding[1]!);
  const records: Readonly<Record<string, { key: string; ids: readonly { id: string }[]; set: ReadonlySet<string> }>> = {
    "glossary.json": { key: "terms", ids: terms, set: being.terms },
    "corrections.json": { key: "corrections", ids: corrections, set: being.corrections },
    "reports.json": { key: "reports", ids: reports, set: being.reports },
  };
  const record = Object.hasOwn(records, file!) ? records[file!] : undefined;
  if (record === undefined) return true;
  const i = index(record.key);
  const id = i === null ? undefined : record.ids[i]?.id;
  return id === undefined ? true : record.set.has(id);
}

/** An error of ARCHIVE_WARNING_CODES on a stored record that is not being published is a warning (SPEC §4.12 "Stored records"). */
function demoted(input: RuleInput, issue: ValidationIssue): ValidationIssue {
  if (input.mode !== "published" || issue.severity !== "error" || !ARCHIVE_WARNING_CODES.includes(issue.code)) return issue;
  if (isPublishingPath(input, issue.path)) return issue;
  return { ...issue, severity: "warning", hint: issue.hint ?? "A record already published: the current lists flag it, so this is a warning, not an error." };
}

/** The INPUT_MISSING message for one missing input: the checks that did not run, and those that ran without it. */
function missingMessage(date: string, name: string, skipped: readonly string[], partial: readonly string[]): string {
  const parts: string[] = [];
  if (skipped.length > 0) parts.push(`${plural(skipped.length, "check")} did not run: ${skipped.join(", ")}`);
  if (partial.length > 0) parts.push(`${plural(partial.length, "check")} ran without it: ${partial.join(", ")}`);
  return `No ${name} for ${date}, so ${parts.join(", and ")}.`;
}

/**
 * Runs `rules` on one input. A rule runs when its scope lists the input's mode and the run inputs it needs are there (each
 * missing input gives one INPUT_MISSING warning naming the checks it skipped, and those of its `uses` that ran without it). A
 * rule that throws gives one RULE_ERROR issue and the others still run; so does a rule that reports a code it did not declare
 * (that code's issue is dropped). The result is sorted by path, then code, and holds no duplicate (same code, path and message).
 */
export function runRules(input: RuleInput, rules: readonly Rule[] = RULES): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const skipped = new Map<RuleNeed, string[]>();
  const partial = new Map<RuleNeed, string[]>();
  for (const rule of rules) {
    if (!rule.scope.includes(input.mode)) continue;
    const missing = rule.needs.filter((need) => lacksInput(input, need));
    if (missing.length > 0) {
      for (const need of missing) skipped.set(need, [...(skipped.get(need) ?? []), ...rule.codes]);
      continue;
    }
    for (const need of rule.uses ?? []) if (lacksInput(input, need)) partial.set(need, [...(partial.get(need) ?? []), ...rule.codes]);
    let found: ValidationIssue[];
    try {
      found = rule.check(input);
    } catch (err) {
      const why = (err instanceof Error ? err.message : String(err)).slice(0, MESSAGE_MAX);
      out.push(ruleError(rule, `The check ${rule.codes[0]} stopped with an error (${why}) and did not finish.`));
      continue;
    }
    for (const issue of found) {
      if (rule.codes.includes(issue.code)) out.push(demoted(input, issue));
      else out.push(ruleError(rule, `The check ${rule.codes[0]} reported ${issue.code}, a code it does not declare; the issue was dropped.`));
    }
  }
  for (const need of NEEDS) {
    const none = [...new Set(skipped.get(need) ?? [])];
    const some = [...new Set(partial.get(need) ?? [])].filter((code) => !none.includes(code));
    if (none.length === 0 && some.length === 0) continue;
    const label = NEED_LABEL[need];
    out.push(warning("INPUT_MISSING", label.path, missingMessage(input.date, label.name, none, some), label.hint));
  }
  return sortIssues(out);
}

// ── Order ────────────────────────────────────────────────────────────────────────────────────────

const TOKEN = /\[(0|[1-9][0-9]*)\]|\["((?:[^"\\]|\\.)*)"\]|\.?([A-Za-z_][A-Za-z0-9_]*)|([^])/gy;

/** `items[10].text` as ["items", 10, "text"]: an index is a number, so `items[2]` sorts before `items[10]`. */
function tokens(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(TOKEN)) out.push(m[1] !== undefined ? Number(m[1]) : (m[2] ?? m[3] ?? m[4])!);
  return out;
}

/** Orders two issue paths by their parts, indices numerically, a stored record's file name first. */
export function comparePaths(a: string, b: string): number {
  const split = (p: string): [string, string] => {
    const m = /^([A-Za-z0-9_./-]+\.json): (.*)$/s.exec(p);
    return m === null ? ["", p] : [m[1]!, m[2]!];
  };
  const [fa, ra] = split(a);
  const [fb, rb] = split(b);
  if (fa !== fb) return byCodeUnit(fa, fb);
  const ta = tokens(ra);
  const tb = tokens(rb);
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i]!;
    const y = tb[i]!;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return byCodeUnit(x, y);
  }
  return ta.length - tb.length;
}

/** The engine's order: by path, then code, then errors before warnings, then message; an issue repeating a code, path and message once is dropped. */
export function sortIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const sorted = [...issues].sort((x, y) =>
    comparePaths(x.path, y.path)
    || byCodeUnit(x.code, y.code)
    || (x.severity === y.severity ? 0 : x.severity === "error" ? -1 : 1)
    || byCodeUnit(x.message, y.message));
  const seen = new Set<string>();
  return sorted.filter((issue) => {
    const key = JSON.stringify([issue.code, issue.path, issue.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
