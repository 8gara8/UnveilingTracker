// Corrections, reader reports and the archive index (SPEC §4.10), written only by publish (the archive index also by
// `ledger-seed.ts` in P2); and the run's evidence file (§4.12, §8.12), which stays on Kobol and in fixtures/evidence/.
//
// Stored records are older than the fixed strings and labels they were written with, so a stored correction is not
// compared with the current `REMOVED_TEXT`, `REMOVED_BEFORE` or a vocabulary label here; `XREF` checks a `removed`
// correction's path against the stored record. What is checked here is what the record says about itself: which
// record a correction names (exactly one), the trigger against the report it answers, a report's life from open to
// decided, the order of the archive index.
//
// Cyber's lib/schema/misc.ts at the fork commit 3ced1fb, adapted: its corrections and disputes of items become
// corrections of a finding, an edition or a glossary term (each string an `L10n`) and the reader reports of §4.10;
// the archive index keeps Cyber's editions and URLs, with refs in place of item ids; the evidence file adds `types`
// and `resolved` (SPEC §4.11's type check).

import { z } from "zod";
import { isValidDate } from "../dates";
import {
  Count, CorrectionId, CorrectionPath, Edition, FindingId, ID_PATTERNS, IsoDate, IsoTimestamp, L10n, ReportId, ReportKind, SeenAs,
  Sha256, TermId, uniqueArray,
} from "./common";

export const CORRECTION_TYPES = ["correction", "clarification", "update", "removed"] as const;
export const CORRECTION_TRIGGERS = ["recheck", "reader_report", "editor"] as const;
export const REPORT_STATUS = ["open", "upheld", "rejected"] as const;
/** The two ways a report ends (a brief lists the reports decided that day, §4.5). */
export const DECIDED_REPORT_STATUS = ["upheld", "rejected"] as const;
/** `jl`: JL closed the issue, completed as upheld and not planned as rejected (§4.10, §8.9). */
export const REPORT_DECIDERS = ["claude", "jl"] as const;
/** The codes of re-check's safety flags (§8.9): only the safety codes read today's lists on stored records (§4.12). */
export const SAFETY_FLAG_CODES = ["DUAL_USE", "BLOCKED_HOST"] as const;
export const LINK_RESULTS = ["ok", "broken", "changed", "unknown"] as const;
/** At most this many refs on one archive-index URL (§4.10). */
export const ARCHIVE_REFS_MAX = 20;

export const CorrectionType = z.enum(CORRECTION_TYPES);
export const CorrectionTrigger = z.enum(CORRECTION_TRIGGERS);
export const ReportStatus = z.enum(REPORT_STATUS);
export const DecidedReportStatus = z.enum(DECIDED_REPORT_STATUS);
export const ReportDecider = z.enum(REPORT_DECIDERS);
export const SafetyFlagCode = z.enum(SAFETY_FLAG_CODES);
export const LinkResult = z.enum(LINK_RESULTS);

// ── Which record a correction names ──────────────────────────────────────────────────────────────

/**
 * The three keys that name the record a correction, or a re-check flag, is about: a finding, an edition's
 * brief-level text, or a glossary term (§4.10). Exactly one is set (`hasOneTarget()`); spread this into an object
 * and refine it with that function, as `Correction` and `FlaggedRecord` do.
 */
export const CorrectionTarget = {
  finding_id: FindingId.nullable(),
  edition_date: IsoDate.nullable(),
  term_id: TermId.nullable(),
} as const;

/** True when exactly one of the three target keys is non-null. */
export function hasOneTarget(v: { finding_id: unknown; edition_date: unknown; term_id: unknown }): boolean {
  return [v.finding_id, v.edition_date, v.term_id].filter((x) => x !== null).length === 1;
}

const ONE_TARGET = "Exactly one of finding_id, edition_date and term_id is set";

// ── Corrections ──────────────────────────────────────────────────────────────────────────────────

export const CorrectionBase = z.strictObject({
  id: CorrectionId,
  date: IsoDate.describe("The edition that lists it (the banner's date)"),
  ...CorrectionTarget,
  type: CorrectionType,
  path: CorrectionPath,
  before: L10n.describe("Copied by publish from the text just before; REMOVED_BEFORE for a removed one"),
  after: L10n,
  reason: L10n,
  source_url: z.string().min(1).nullable(),
  trigger: CorrectionTrigger,
  report_id: ReportId.nullable().describe("The report this correction answers, else null"),
});

export const Correction = CorrectionBase.superRefine((c, ctx) => {
  if (!hasOneTarget(c)) ctx.addIssue({ code: "custom", message: ONE_TARGET, path: [] });
  if ((c.trigger === "reader_report") !== (c.report_id !== null)) {
    ctx.addIssue({
      code: "custom",
      message: "A correction has a report_id exactly when its trigger is reader_report",
      path: ["report_id"],
    });
  }
});

/** content/corrections.json. */
export const CorrectionsFile = z.strictObject({
  schema_version: z.literal(1),
  corrections: z.array(Correction),
});

/**
 * One record that re-check's safety flags send to the next agent (§8.9, §4.15's `corrections.flagged`): the record as a
 * correction names it, the path in a correction's form, and the code, never the matched text.
 */
export const FlaggedRecordBase = z.strictObject({
  ...CorrectionTarget,
  path: CorrectionPath,
  code: SafetyFlagCode,
});

export const FlaggedRecord = FlaggedRecordBase.superRefine((f, ctx) => {
  if (!hasOneTarget(f)) ctx.addIssue({ code: "custom", message: ONE_TARGET, path: [] });
});

// ── Reader reports ───────────────────────────────────────────────────────────────────────────────

/** From the error-report issue form (§9.2); free text is never read or stored. */
export const ReportBase = z.strictObject({
  id: ReportId,
  received: IsoTimestamp,
  issue_number: z.int().min(1),
  finding_id: FindingId,
  kind: ReportKind,
  evidence_url: z.string().min(1).max(500).nullable(),
  status: ReportStatus,
  decided_by: ReportDecider.nullable(),
  resolved_on: IsoDate.nullable(),
  reason: L10n.nullable().describe("At most 40 words, shown on the finding page"),
  correction_id: CorrectionId.nullable(),
});

/**
 * An open report is undecided: it has no decider, date, reason or correction. A decided one has a decider and a
 * date; a rejected one has no correction; the agent gives its reason, and JL's close leaves none (§8.9).
 */
export const Report = ReportBase.superRefine((r, ctx) => {
  const issue = (message: string, key: "decided_by" | "resolved_on" | "reason" | "correction_id") =>
    ctx.addIssue({ code: "custom", message, path: [key] });
  if (r.status === "open") {
    if (r.decided_by !== null) issue("An open report has no decider", "decided_by");
    if (r.resolved_on !== null) issue("An open report has no resolved_on", "resolved_on");
    if (r.reason !== null) issue("An open report has no reason", "reason");
    if (r.correction_id !== null) issue("An open report has no correction", "correction_id");
    return;
  }
  if (r.decided_by === null) issue("A decided report says who decided it", "decided_by");
  if (r.resolved_on === null) issue("A decided report has the date it was decided", "resolved_on");
  if (r.status === "rejected" && r.correction_id !== null) issue("A rejected report has no correction", "correction_id");
  if (r.decided_by === "claude" && r.reason === null) issue("A decision by the agent has its reason", "reason");
  if (r.decided_by === "jl" && r.reason !== null) issue("A decision by JL, who closed the issue, has no reason", "reason");
});

/** content/reports.json. */
export const ReportsFile = z.strictObject({
  schema_version: z.literal(1),
  reports: z.array(Report),
});

// ── The archive index ────────────────────────────────────────────────────────────────────────────

/** A finding id, or `YYYY-MM-DD/brief` for the brief-level text of that edition. */
export const ArchiveRef = z.string()
  .regex(ID_PATTERNS.archiveRef, { error: 'Expected a finding id such as math-2026-0142 or "YYYY-MM-DD/brief"', abort: true })
  .refine((ref) => !ref.endsWith("/brief") || isValidDate(ref.slice(0, 10)), { error: "Not a real calendar date" });

export const ArchiveEdition = z.strictObject({
  date: IsoDate,
  edition: Edition,
  published_at: IsoTimestamp,
  finding_count: Count,
  corrected: z.boolean(),
});

export const ArchiveLastCheck = z.strictObject({
  date: IsoDate,
  result: LinkResult,
  http: z.int().min(100).max(599).nullable(),
});

export const ArchiveUrl = z.strictObject({
  first_cited: IsoDate,
  refs: uniqueArray(ArchiveRef, "refs").max(ARCHIVE_REFS_MAX, { error: `At most ${ARCHIVE_REFS_MAX} refs` }),
  sha256: Sha256.nullable().describe("Of the page text when first cited; the snapshot stays in cache/"),
  hashed_at: IsoTimestamp.nullable().describe("When the page was read for that hash"),
  last_check: ArchiveLastCheck.nullable(),
}).refine((u) => (u.sha256 === null) === (u.hashed_at === null), {
  error: "sha256 and hashed_at are both set or both null",
  path: ["hashed_at"],
});

/** content/archive-index.json: `editions` newest first, one per date; `urls` keyed by `normalizeUrl()` of every URL a record cites. */
export const ArchiveIndex = z.strictObject({
  schema_version: z.literal(1),
  editions: z.array(ArchiveEdition),
  urls: z.record(z.string().min(1), ArchiveUrl),
}).superRefine((a, ctx) => {
  a.editions.forEach((e, i) => {
    if (i > 0 && e.date >= a.editions[i - 1]!.date) {
      ctx.addIssue({ code: "custom", message: "editions run newest first, one per date", path: ["editions", i, "date"] });
    }
  });
});

// ── The run's evidence (SPEC §4.12, §4.11) ───────────────────────────────────────────────────────

/**
 * logs/D.evidence.json and fixtures/evidence/<name>.json: the URLs the run saw (`urls`) and fetched, the page text of
 * each, how it saw each, the article types the pack and the snapshots give each URL (`types`, for PRIMARY_ONLY's type
 * check) and the final URL of each GET that ended elsewhere (`resolved`, for a `doi.org` landing). Never committed to content/.
 */
export const Evidence = z.strictObject({
  urls: z.array(z.string()),
  fetched: z.array(z.string()),
  texts: z.record(z.string(), z.string()),
  seen_as: z.record(z.string(), SeenAs),
  types: z.record(z.string(), z.array(z.string())),
  resolved: z.record(z.string(), z.string()),
});

export type CorrectionType = z.infer<typeof CorrectionType>;
export type CorrectionTrigger = z.infer<typeof CorrectionTrigger>;
export type ReportStatus = z.infer<typeof ReportStatus>;
export type DecidedReportStatus = z.infer<typeof DecidedReportStatus>;
export type ReportDecider = z.infer<typeof ReportDecider>;
export type SafetyFlagCode = z.infer<typeof SafetyFlagCode>;
export type LinkResult = z.infer<typeof LinkResult>;
export type Correction = z.infer<typeof Correction>;
export type CorrectionsFile = z.infer<typeof CorrectionsFile>;
export type FlaggedRecord = z.infer<typeof FlaggedRecord>;
export type Report = z.infer<typeof Report>;
export type ReportsFile = z.infer<typeof ReportsFile>;
export type ArchiveRef = z.infer<typeof ArchiveRef>;
export type ArchiveEdition = z.infer<typeof ArchiveEdition>;
export type ArchiveLastCheck = z.infer<typeof ArchiveLastCheck>;
export type ArchiveUrl = z.infer<typeof ArchiveUrl>;
export type ArchiveIndex = z.infer<typeof ArchiveIndex>;
export type Evidence = z.infer<typeof Evidence>;
