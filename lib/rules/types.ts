// The validator's framework types (SPEC §4.12): the issue every rule reports, the `Rule` record each group file exports,
// and the `RuleInput` every rule is a pure function of. One engine serves every mode and each rule is written once: the
// views (views.ts) and the string inventory (strings.ts) hide what differs between a draft (English strings, `new-N`
// refs), a stored brief with its findings (`L10n` strings, ids) and the Chinese draft, so a rule reads one normal form.
//
// Three inputs, told apart by `mode`. `draft`: the agent's English draft with the run's context, evidence, metrics and
// pack. `published`: a stored brief (or none, for records no brief names) with the stored findings, glossary terms,
// corrections and reports it reads, and which of them are being published (SPEC §4.12 "Stored records"). `zh`: the
// Chinese draft with its context and the English draft it translates (the engine for it is validateZh(), written
// beside this frame). A rule lists the modes it runs in; it never reads a file, the clock or the network.
//
// Cyber's lib/rules/types.ts at the fork commit 3ced1fb, adapted: `ValidationIssue`, `error()`, `warning()`, `list()`,
// `plural()`, `defineRule()` and `formatPath()` (which was in Cyber's lib/validate.ts) are Cyber's; the scope is a list of
// modes, a rule names the optional run inputs it needs, and `RuleInput` is the union of the three modes' inputs with
// the corrections in force, the views and the inventory. Cyber's data-only flag has no counterpart: §4.12 marks no
// rule for data-only editions, so a rule that must skip one reads `input.edition`.

import type { LoadedConfig } from "../config";
import type { FilingCorrection } from "../items";
import type { Brief } from "../schema/brief";
import type { IsoDate } from "../schema/common";
import type { AgentContext } from "../schema/context";
import type { DraftBrief } from "../schema/draft";
import type { DraftZh, ZhContext } from "../schema/draft-zh";
import type { Finding } from "../schema/finding";
import type { Term } from "../schema/glossary";
import type { MetricsFile } from "../schema/metrics";
import type { ArchiveIndex, Correction, Evidence, Report } from "../schema/misc";
import type { Pack } from "../schema/pack";
import type { Format } from "../vocab";
import type { Inventory } from "./strings";
import type { Views } from "./views";

export type { Evidence } from "../schema/misc";

// ── Issues ───────────────────────────────────────────────────────────────────────────────────────

export type IssueSeverity = "error" | "warning";

/**
 * One finding of the validator. `path` is `formatPath()`'s form (`new_findings[0].explainer.found`, `lead[1].text`,
 * `(root)`, `(file)`), so a repair prompt and a re-check can point at the string; on a stored record it starts with the
 * file (`findings/math-2026-0142.json: explainer.how_sure`). Messages say how to fix the problem: the value found, the
 * rule and the edit ("title has 14 words; the limit is 12. Cut at least 2."). lib/config.ts's `ConfigIssue` has this shape.
 */
export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  path: string;
  message: string;
  hint: string | null;
}

export function error(code: string, path: string, message: string, hint: string | null = null): ValidationIssue {
  return { code, severity: "error", path, message, hint };
}

export function warning(code: string, path: string, message: string, hint: string | null = null): ValidationIssue {
  return { code, severity: "warning", path, message, hint };
}

/** "a, b, c" for messages. */
export function list(items: readonly string[]): string {
  return items.join(", ");
}

/** "1 word", "2 words". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * `items[3].summary` from ["items", 3, "summary"]; "(root)" for the empty path. A number is an index. A key that is not
 * an identifier (a glossary term id, a Chinese context key such as `new.new-1.title`) is written `["key"]`, so a path is
 * never ambiguous.
 */
export function formatPath(p: readonly PropertyKey[]): string {
  let out = "";
  for (const k of p) {
    if (typeof k === "number") {
      out += `[${k}]`;
      continue;
    }
    const key = String(k);
    out += IDENTIFIER.test(key) ? (out ? `.${key}` : key) : `[${JSON.stringify(key)}]`;
  }
  return out || "(root)";
}

// ── What a rule reads ────────────────────────────────────────────────────────────────────────────

/** Where a rule runs: the English draft, a stored record, or the Chinese draft. */
export type RuleMode = "draft" | "published" | "zh";

/**
 * What kind of edition the rules judge (shared.ts `editionKind()`): a weekday, a Sunday, a Monday or a short Monday (a
 * week of fewer than 3 findings: known only in draft mode, from the context's week; a stored brief's Monday may have either
 * length and is `monday`), a data-only edition, or `none` when no brief is judged (records no brief names).
 */
export type EditionKind = "weekday" | "sunday" | "monday" | "short-monday" | "data-only" | "none";

/** The run's own files a draft-mode rule may need beyond the draft and its context. */
export type RuleNeed = "evidence" | "metrics" | "pack";

/**
 * The stored records a draft run may read besides the context, which the drafting agent cannot read (SPEC §9.5) and whose
 * stored findings it shows only in part (§4.15: a recent finding has its title, field, rung, significance and artefacts; no
 * AI role, kind, reactions, `who` or sources). Several rows judge a stored finding by what only its record holds: NON_AI_LANDMARK_ONLY,
 * SETBACK_MAJOR and AI_CONFIDENCE its role and kind as published, LANDMARK_BASIS its reactions and `who`, RUNG_EVIDENCE and
 * RUNG_ORDER its rung history and sources. The validating stage (SPEC §8.2 stage 7, scripts/validate.ts) reads the stored
 * findings and every stored correction from `content/` and passes them as `DraftInputs.stored`: the English form every finding
 * that a brief carried in the 90 days up to D, and each older finding that the context lists or the draft names; the Chinese form
 * the findings its English draft names and the backlog findings its context lists. A finding it gives is then a full view (`basis`
 * stays `context`, `detail` is `full`), and the stored corrections file every finding as `filedAs()` reads them. Without it a
 * finding the context shows in part has a null fact wherever the context is silent, and a rule skips what it cannot know.
 */
export interface StoredRecords {
  /**
   * The stored findings the run was given: for the English form, every finding that a brief carried in the 90 days up to D and
   * each older one that the context lists or the draft names, though the draft names some of them nowhere and the context lists
   * some of them not (DUPLICATE compares those too); for the Chinese form, the findings its English draft names and the backlog
   * findings its context lists. A finding the run does not give stays as the context shows it.
   */
  readonly findings: readonly Finding[];
  /** Every stored correction (`content/corrections.json`), oldest first. */
  readonly corrections: readonly Correction[];
  /** Every glossary term, so a stored finding's term ids read as their English names. */
  readonly terms: readonly Term[];
}

/** The draft-mode side of a `RuleInput`. Every field is a plain parsed object, never a file. */
export interface DraftSide {
  /** The parsed draft. */
  brief: DraftBrief;
  /** The copy in memory, never `drafts/context.json` (SPEC §4.15). */
  context: AgentContext;
  /** `logs/D.evidence.json`; null when there is none, which skips the rules that `need` it. */
  evidence: Evidence | null;
  /** The metrics file for D, committed or staged; null skips the rules that `need` it. */
  metrics: MetricsFile | null;
  /** `packs/D.json`; null skips the rules that `need` it. */
  pack: Pack | null;
  /**
   * The stored records the run was given (`DraftInputs.stored`), as given; null when it was given none. A rule that must read
   * every stored record, not only the ones the views hold, reads them here (DUPLICATE, TERM_DEFINED); with null it skips that part.
   */
  stored: StoredRecords | null;
}

/**
 * The text that edition D gave a returning stored finding (SPEC §4.12 "Stored records"), as the indices of its entries: the
 * `rung_history` entries recorded on D, the `since_then` notes dated D and the `sources` added on D (§8.7, §5.8).
 */
export interface NewParts {
  readonly rung_history: ReadonlySet<number>;
  readonly since_then: ReadonlySet<number>;
  readonly sources: ReadonlySet<number>;
}

/**
 * Which records of a published-mode run are being published (SPEC §4.12 "Stored records"): the brief `validateAll()` names
 * as `publishing`, the findings it adds (first briefed on its date, or given text by it), the terms it adds, the corrections dated
 * on its date and the reports decided on it. Only those are judged against `config/`, and only on those do the safety codes stay
 * errors. A finding first briefed on the date is judged whole; a returning finding that the date gave text is judged only on that
 * text (`parts`), the rest of it staying an archived record.
 */
export interface BeingPublished {
  readonly brief: boolean;
  /** The findings first briefed on the date, and the returning findings the date gave text: those of `parts`. */
  readonly findings: ReadonlySet<string>;
  /** By finding id, for each finding of `findings` that was not first briefed on the date: the text the date gave it. */
  readonly parts: ReadonlyMap<string, NewParts>;
  readonly terms: ReadonlySet<string>;
  readonly corrections: ReadonlySet<string>;
  readonly reports: ReadonlySet<string>;
}

/** One path the content reader found under the content folder (`validateAll()`, lib/validate-stored.ts): what FILE_LAYOUT and XREF know of a file. */
export interface StoredFile {
  /** Relative to the content folder, "/"-separated: `briefs/2026-11-24.json`. */
  readonly path: string;
  /** False for a link, a device or any other path that is not a regular file, and for a folder the reader could not list. */
  readonly regular: boolean;
  /** True when the file was read and its record passed its schema; false for an unreadable file, bad JSON, a schema failure or a path of no layout. */
  readonly parsed: boolean;
  /** For a finding file that parsed: the `id` it holds (FILE_LAYOUT: the file is named by it); else null. */
  readonly id: string | null;
}

/**
 * What a run over a whole content folder knows besides the records it is given (SPEC §4.12 XREF, LANG_PARITY, FILE_LAYOUT).
 * `validateAll()` sets it on its one run over every stored record; a run for one brief (`validatePublished()`) has none, and
 * the rules then judge what they were given alone.
 */
export interface PublishedFolder {
  /** Every path under the folder, in code-unit order: files, and each link or folder the reader could not read as a file. */
  readonly files: readonly StoredFile[];
  /** Every stored brief that parsed, oldest first. */
  readonly briefs: readonly Brief[];
  /** `archive-index.json` when it parsed, else null. */
  readonly archive: ArchiveIndex | null;
  /** The glossary terms hidden for their own name (SPEC §8.9): LANG_PARITY asks no Chinese of them. */
  readonly hiddenTerms: ReadonlySet<string>;
}

/** The published-mode side: a stored brief and the stored records the run reads. */
export interface PublishedSide {
  /** The stored brief; null when the run judges records no brief names (a history finding, the glossary). */
  brief: Brief | null;
  /** The stored findings the run judges, in id order. */
  findings: readonly Finding[];
  /** Every glossary term, in id order. */
  terms: readonly Term[];
  /** Every stored correction, oldest first. */
  corrections: readonly Correction[];
  /** Every stored report. */
  reports: readonly Report[];
  /** True when the brief is the one being published. */
  publishing: boolean;
  being: BeingPublished;
  /** Set by `validateAll()` on its run over every stored record; absent for one brief. */
  folder?: PublishedFolder;
}

/** The Chinese-draft side: the pass's draft and context, and the English draft they translate. */
export interface ZhSide {
  draft: DraftZh;
  context: ZhContext;
  /** The validated English draft the Chinese one translates. */
  english: DraftBrief;
  /** The Chinese pass's evidence (the 樂詞網 pages it fetched); null when there is none. */
  evidence: Evidence | null;
}

interface InputBase {
  /** D: the context's date (draft, zh) or the brief's own (published); the date given in the options for a run with no brief. */
  date: IsoDate;
  /** The date in a `YYYY-MM-DD.json` file name, when a file is validated. */
  fileDate: string | null;
  edition: EditionKind;
  /** The format of D's weekday; null when no brief is judged. */
  format: Format | null;
  /** config/ as loaded and checked by lib/config.ts. Rules that read it run on the records being published (draft: all). */
  config: LoadedConfig;
  /**
   * The corrections in force as `filedAs()` reads them (SPEC §4.10): the stored corrections in published mode; in draft and
   * zh modes the draft's own, dated D, with the ids publish will give them, after the stored ones when the run was given them
   * (`DraftInputs.stored`; otherwise the stored ones are not visible to a draft, and the context's findings are already filed
   * on D by them). The draft's own corrections as the draft lists them are `views.corrections`.
   */
  filing: readonly FilingCorrection[];
  /** The findings and the brief-level text in one normal form, for every mode. */
  views: Views;
  /** Every string the run reads, classified once. */
  inventory: Inventory;
}

export interface DraftInput extends InputBase {
  mode: "draft";
  draft: DraftSide;
}

export interface PublishedInput extends InputBase {
  mode: "published";
  published: PublishedSide;
}

export interface ZhInput extends InputBase {
  mode: "zh";
  zh: ZhSide;
}

/** What `Rule.check()` takes. Narrow with `input.mode`, or with the guards of shared.ts. */
export type RuleInput = DraftInput | PublishedInput | ZhInput;

// ── Rules ────────────────────────────────────────────────────────────────────────────────────────

export interface Rule {
  /** Every code the rule reports; the first names it. */
  codes: readonly [string, ...string[]];
  /** Its usual severity (H or S in the rule table); a rule may report the other where its row says so. */
  severity: IssueSeverity;
  /** The modes it runs in (SPEC §4.12 "Stored records" says which tests run where). */
  scope: readonly RuleMode[];
  /** Draft mode only: the run inputs it cannot work without. The engine skips it and reports one `INPUT_MISSING` warning. */
  needs: readonly RuleNeed[];
  /**
   * Draft mode only: the run inputs only a part of its row reads, such as PRIMARY_ONLY's type check, which reads the pages the
   * run fetched. The engine always runs the rule; when the input is missing the rule skips that part itself (`lacksInput()`,
   * shared.ts) and the engine reports it in the same `INPUT_MISSING` warning as "ran without it". A code goes in one rule only,
   * so a row with an input-free part and an input-reading part is one rule with `uses`, never two. Absent means none;
   * `defineRule()` always sets it.
   */
  uses?: readonly RuleNeed[];
  check: (input: RuleInput) => ValidationIssue[];
}

export interface RuleSpec {
  code: string | readonly [string, ...string[]];
  severity?: IssueSeverity;
  scope: RuleMode | readonly [RuleMode, ...RuleMode[]];
  needs?: readonly RuleNeed[];
  uses?: readonly RuleNeed[];
  check: (input: RuleInput) => ValidationIssue[];
}

/** Builds a `Rule`: `defineRule({ code: "COUNTS", scope: ["draft", "published"], check })`. Defaults: an error, no needs, no uses. */
export function defineRule(spec: RuleSpec): Rule {
  const codes = (typeof spec.code === "string" ? [spec.code] : [...spec.code]) as [string, ...string[]];
  return {
    codes,
    severity: spec.severity ?? "error",
    scope: typeof spec.scope === "string" ? [spec.scope] : [...spec.scope],
    needs: [...(spec.needs ?? [])],
    uses: [...(spec.uses ?? [])],
    check: spec.check,
  };
}
