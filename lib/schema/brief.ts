// The published brief, `content/briefs/D.json` (SPEC §4.5), written only by publish: the draft's M fields as `L10n`
// strings plus every S field (format, languages, Pace line, rung changes, disclosure, status note, computed counts,
// provenance), in the spec's key order. That is the whole difference from the draft (draft.ts): a brief has no
// refs (`new-1`), no draft-only keys (`generated_at`, `new_findings`, `returning`, `report_decisions`), every
// reader-facing string is an `L10n`, and a finding is named by its id.
//
// Shape and what a brief says about itself, as common.ts explains: the word budgets, `COUNTS`, `XREF` (that a
// finding, source, correction or report exists), `LANG_PARITY`, `WEEK_AGAINST` and the rest of §4.12 are rules in
// lib/rules. Checked here, since no rule owns them: the format against the weekday of the date, the metrics file
// against the date, an item's update against `new`, the order of the rung changes, the seven field counts, the paths
// `disclosure` lists, the one target of a correction line, a data-only edition holding nothing a script did not
// compose, and the data cutoff being a Sunday (the newest the date allows when the Pace is ok, as the metrics file
// has it, else no later than that). What the spec leaves open stays open:
// `computed`'s counts, and `languages.zh` against the `zh` strings, are not compared with anything.
//
// A schema with a refinement cannot be `.pick()`ed or `.omit()`ed (Zod refuses); `.shape` and `.extend()` still work.
// Each such object therefore also has an unrefined `<Name>Base`.
//
// Cyber's lib/schema/brief.ts at the fork commit 3ced1fb, adapted: Cyber's regions, Gap reference, actors and week
// table give way to this project's Pace reference, rung changes, ideas, also-noted lines, deep dive and week review;
// `Computed` and the small strict objects follow Cyber's idiom, and the refinements use its `superRefine` with `path`.

import { z } from "zod";
import { dataCutoffFor, lastSunday, weekday } from "../dates";
import { FIELDS, formatForWeekday } from "../vocab";
import {
  BriefSource, BriefSourceId, CommitSha, CorrectionId, Count, DataStatus, Edition, FieldId, FindingId, Format, IsoDate, IsoTimestamp,
  L10n, ReportId, Rung, RunId, realDates, uniqueArray,
} from "./common";
import { CorrectionTarget, CorrectionType, DecidedReportStatus, hasOneTarget } from "./misc";

/** Why the Sunday deep dive's finding is chosen: news this week, an anniversary, or the field's turn (SPEC §4.5, §4.15). */
export const WHY_TODAY = ["news", "anniversary", "rotation"] as const;
/** Who made a rung change: the re-check script (§5.8) or the agent (§4.5). */
export const RUNG_CHANGE_BY = ["script", "agent"] as const;

export const WhyToday = z.enum(WHY_TODAY);
export const RungChangeBy = z.enum(RUNG_CHANGE_BY);

// ── The parts of a brief ─────────────────────────────────────────────────────────────────────────

/** `new` is true on the finding's first brief; a returning finding carries its `update` (SPEC §4.5). */
export const BriefItemBase = z.strictObject({
  finding_id: FindingId,
  new: z.boolean(),
  update: L10n.nullable().describe("A returning finding's update, at most 60 words; null on a new finding"),
});

export const BriefItem = BriefItemBase.superRefine((item, ctx) => {
  if (item.new !== (item.update === null)) {
    ctx.addIssue({
      code: "custom",
      message: item.new ? "A new finding has no update" : "A returning finding has an update",
      path: ["update"],
    });
  }
});

/** A script-detected (§5.8) or agent-written rung change shown in the brief's Climbed or fell lines. */
export const RungChange = z.strictObject({
  finding_id: FindingId,
  from: Rung,
  to: Rung,
  date: IsoDate,
  by: RungChangeBy,
});

/** One sentence of the Lead, with the findings it cites (§4.5: each cites at least one, except on a day with none). */
export const LeadLine = z.strictObject({
  text: L10n,
  finding_ids: z.array(FindingId),
});

/** An unscored line: a named person's own published argument, with the brief-level source that shows it. */
export const IdeaLine = z.strictObject({
  text: L10n,
  who: z.string().min(1),
  source_id: BriefSourceId,
});

/** An Also noted line: a one-line link to a primary record. */
export const AlsoLine = z.strictObject({
  title: L10n,
  field: FieldId,
  source_id: BriefSourceId,
});

/** The Sunday deep dive, on one finding of the Ledger (§4.5, §4.15). */
export const BriefDeepDive = z.strictObject({
  finding_id: FindingId,
  text: L10n,
  source_ids: z.array(BriefSourceId),
  why_today: WhyToday,
});

/** The Pace as the brief points at it: the sentence the pages print, the metrics file's status and the file (§4.7, §5.2). */
export const BriefPace = z.strictObject({
  sentence: L10n,
  status: DataStatus,
  metrics_file: z.string().regex(/^metrics\/\d{4}-\d{2}-\d{2}\.json$/, { error: 'Expected "metrics/YYYY-MM-DD.json"' }),
});

/** A correction as the brief lists it: the stored correction without its path, before, after, source and trigger (§4.10). */
export const BriefCorrectionBase = z.strictObject({
  id: CorrectionId,
  ...CorrectionTarget,
  type: CorrectionType,
  reason: L10n,
});

export const BriefCorrection = BriefCorrectionBase.superRefine((c, ctx) => {
  if (!hasOneTarget(c)) ctx.addIssue({ code: "custom", message: "Exactly one of finding_id, edition_date and term_id is set", path: [] });
});

/** A reader report decided today, as the brief lists it. */
export const BriefReport = z.strictObject({
  id: ReportId,
  finding_id: FindingId,
  status: DecidedReportStatus,
});

/** Computed by scripts. What `finding_count` and `source_count` count, and `zh_chars` on a data-only edition, §4.5 leaves to the code that writes them. */
export const BriefComputed = z.strictObject({
  word_count: Count,
  zh_chars: Count.nullable().describe("null on an English-only edition"),
  finding_count: Count,
  source_count: Count,
});

export const BriefProvenance = z.strictObject({
  run_id: RunId,
  code_commit: CommitSha,
  data_cutoff: IsoDate.describe("The Sunday ending the newest Pace week (SPEC §4.1)"),
});

/** `zh` false is an English-only edition, or a data-only one that names a finding whose `title.zh` is null (§4.5). */
export const BriefLanguages = z.strictObject({
  en: z.literal(true),
  zh: z.boolean(),
});

// ── The Monday review ────────────────────────────────────────────────────────────────────────────

/**
 * One field's count over the seven editions before the review: `reported`, the findings (not history entries) first
 * briefed in them; `counted`, those of them not filed as setbacks whose rung is now counted (§4.4, §4.5).
 */
export const FieldCountBase = z.strictObject({
  field: FieldId,
  reported: Count,
  counted: Count,
});

export const FieldCount = FieldCountBase.refine((c) => c.counted <= c.reported, { error: "counted is at most reported", path: ["counted"] });

/** One row for each field, in `FIELDS` order. */
export const FieldCounts = z.array(FieldCount).refine(
  (rows) => rows.length === FIELDS.length && rows.every((r, i) => r.field === FIELDS[i]),
  { error: `field_counts must be exactly ${FIELDS.join(", ")}, in that order` },
);

export const RemarkableFinding = z.strictObject({
  finding_id: FindingId,
  note: L10n.describe("At most 30 words"),
});

/** The week's setbacks, falls and counter-evidence: at most 50 words, or exactly NONE_FOUND with both lists [] (WEEK_AGAINST). */
export const StrongestAgainst = z.strictObject({
  text: L10n,
  finding_ids: z.array(FindingId),
  source_ids: z.array(BriefSourceId),
});

/** Mondays only (§4.5). `fell` and `setbacks` are S: computed from the week's rung changes and the findings as filed. */
export const WeekReview = z.strictObject({
  big_picture: L10n.describe("270 to 330 words, or at most 120 in a week of fewer than 3 findings; a stored brief may have either"),
  remarkable: RemarkableFinding.nullable().describe("null exactly when the week has no finding"),
  strongest_against: StrongestAgainst,
  field_counts: FieldCounts,
  fell: uniqueArray(FindingId, "fell").describe("Findings that moved to disputed or retracted in the seven days"),
  setbacks: uniqueArray(FindingId, "setbacks").describe("Findings filed as setbacks first briefed in the seven days"),
});

// ── The brief ────────────────────────────────────────────────────────────────────────────────────

/**
 * The brief-level paths `mentionsAnthropic()` matched (§4.4): `ideas.<i>`, `also.<i>`, `deep_dive` and `review`. A path
 * must name a line this brief has (checked on `Brief`).
 */
const DISCLOSURE_PATH = /^(?:(ideas|also)\.(0|[1-9][0-9]*)|(deep_dive)|(review))$/;
const DisclosurePath = z.string().regex(DISCLOSURE_PATH, { error: "Expected ideas.<i>, also.<i>, deep_dive or review" });

export const BriefBase = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate,
  edition: Edition,
  format: Format.describe("S, from the weekday of the date"),
  languages: BriefLanguages,
  published_at: IsoTimestamp,
  late: z.boolean().describe("Published after schedule.stale_after"),
  pace: BriefPace,
  lead: z.array(LeadLine),
  story: BriefItem.nullable(),
  items: z.array(BriefItem),
  rung_changes: z.array(RungChange).describe("Script-detected and the agent's, newest first"),
  ideas: z.array(IdeaLine),
  also: z.array(AlsoLine),
  deep_dive: BriefDeepDive.nullable(),
  review: WeekReview.nullable(),
  corrections: z.array(BriefCorrection),
  reports: z.array(BriefReport),
  sources: z.array(BriefSource).describe("b1 to bN: what the brief-level text cites"),
  disclosure: uniqueArray(DisclosurePath, "disclosure"),
  status_note: L10n.nullable().describe("A fixed template: partial, English-only or data-only"),
  computed: BriefComputed,
  provenance: BriefProvenance,
});

/** What a data-only edition leaves empty: everything a script did not compose (§4.5). */
const DATA_ONLY_EMPTY = ["lead", "story", "items", "ideas", "also", "deep_dive", "review", "corrections", "sources", "disclosure"] as const;

export const Brief = BriefBase.superRefine((b, ctx) => {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });

  if (realDates(b.date)) {
    const format = formatForWeekday(weekday(b.date));
    if (b.format !== format) issue(`The format of an edition on this weekday is ${format}`, ["format"]);
  }
  if (b.pace.metrics_file !== `metrics/${b.date}.json`) {
    issue(`metrics_file is the file of this edition's date: metrics/${b.date}.json`, ["pace", "metrics_file"]);
  }

  b.rung_changes.forEach((change, i) => {
    if (i > 0 && change.date > b.rung_changes[i - 1]!.date) {
      issue("rung_changes run newest first", ["rung_changes", i, "date"]);
    }
  });

  b.disclosure.forEach((path, i) => {
    const m = DISCLOSURE_PATH.exec(path);
    if (m === null) return; // its format has its own issue
    const list = m[1];
    const named = list === "ideas" || list === "also"
      ? Number(m[2]) < b[list].length
      : m[3] !== undefined ? b.deep_dive !== null : b.review !== null;
    if (!named) issue(`disclosure names ${path}, which this brief does not have`, ["disclosure", i]);
  });

  if (b.edition === "data_only") {
    for (const key of DATA_ONLY_EMPTY) {
      const value = b[key];
      if (Array.isArray(value) ? value.length > 0 : value !== null) issue(`A data-only edition has no ${key}`, [key]);
    }
  }

  const cutoff = b.provenance.data_cutoff;
  if (realDates(b.date, cutoff)) {
    const newest = lastSunday(dataCutoffFor(b.date));
    if (weekday(cutoff) !== 0) {
      issue("data_cutoff is a Sunday", ["provenance", "data_cutoff"]);
    } else if (b.pace.status === "ok" ? cutoff !== newest : cutoff > newest) {
      issue(
        b.pace.status === "ok"
          ? `data_cutoff is the newest Sunday on or before the date minus 2 days (${newest})`
          : `data_cutoff is no later than the newest Sunday on or before the date minus 2 days (${newest})`,
        ["provenance", "data_cutoff"],
      );
    }
  }
});

export type WhyToday = z.infer<typeof WhyToday>;
export type RungChangeBy = z.infer<typeof RungChangeBy>;
export type BriefItem = z.infer<typeof BriefItem>;
export type RungChange = z.infer<typeof RungChange>;
export type LeadLine = z.infer<typeof LeadLine>;
export type IdeaLine = z.infer<typeof IdeaLine>;
export type AlsoLine = z.infer<typeof AlsoLine>;
export type BriefDeepDive = z.infer<typeof BriefDeepDive>;
export type BriefPace = z.infer<typeof BriefPace>;
export type BriefCorrection = z.infer<typeof BriefCorrection>;
export type BriefReport = z.infer<typeof BriefReport>;
export type BriefComputed = z.infer<typeof BriefComputed>;
export type BriefProvenance = z.infer<typeof BriefProvenance>;
export type BriefLanguages = z.infer<typeof BriefLanguages>;
export type FieldCount = z.infer<typeof FieldCount>;
export type RemarkableFinding = z.infer<typeof RemarkableFinding>;
export type StrongestAgainst = z.infer<typeof StrongestAgainst>;
export type WeekReview = z.infer<typeof WeekReview>;
export type Brief = z.infer<typeof Brief>;
