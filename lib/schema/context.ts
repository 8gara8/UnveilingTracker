// The English agent's context, `drafts/context.json` (SPEC §4.15), which `buildContext()` (lib/context.ts, P3) builds in
// memory for each attempt and writes for the agent to read. The validator uses only the copy in memory (or the one the
// stage keeps in `logs/`), never the file the agent can write. Untrusted strings carry the pack's `<untrusted>` wrapper.
//
// The agent cannot read `content/` (§9.5), so everything it needs from the stored record is here, in English: the last 30
// days' findings, up to 10 Sunday candidates and the open reports, each with its stored text, and on a Monday the week.
// Every field, subfield, kind and significance is the value `filedAs()` gives on D (§4.10), which the schemas cannot
// check and the builder's tests do. The Chinese pass has its own context, `ZhContext` (draft-zh.ts).
//
// Shape only, as common.ts explains: which candidates a Sunday keeps and in what order, which reports the agent sees
// (§8.9) and which proposals the rung watch makes (§5.8) are the builder's logic, tested in `tests/context.test.ts`; the
// rules that read the context (`REF_UNKNOWN`, `FORMAT_SECTIONS`, `WEEK_AGAINST`, `REPORT_DECISION`, `RETURN_NEW_FACT`)
// are in lib/rules. What a context says about itself is checked here: its format is its date's, only a Monday has a
// week, only a Sunday has candidates, and a report's text is its finding's. The config values (§4.11) a context copies
// are shown only as they are used (`budgets` and `config`); §4.15 names them without fixing the shape, so each key is the
// simplest object that carries what the agent and the rules read.
//
// Cyber's lib/schema/context.ts at the fork commit 3ced1fb, adapted: its metrics, regions preview, watch windows,
// recent items, yesterday, claims and tier config give way to this project's Pace values, recent findings, Sunday
// candidates, week, rung proposals, reports and config; `corrections.flagged` and the `pack` block are Cyber's in
// shape, `standing_stories` is Cyber's with this project's `{ id, finding_ids, rule }`; the candidate is the pack's
// (pack.ts) with its text wrapped.

import { z } from "zod";
import { weekday } from "../dates";
import { formatForWeekday } from "../vocab";
import {
  AiInfo, Artefacts, ConfigId, Count, FieldId, FindingId, FindingKind, FindingSource, Format, IsoDate, IsoTimestamp, MetricPath,
  ReportId, ReportKind, Rung, RungEntry, Significance, SourceKind, SubfieldId, realDates,
} from "./common";
import { FieldCounts, RungChange, WhyToday } from "./brief";
import { SinceThen } from "./finding";
import { FlaggedRecord } from "./misc";
import { Candidate, TimeWindow } from "./pack";

/** A Sunday's context holds at most this many candidates for the deep dive (§4.15). */
export const LEDGER_CANDIDATES_MAX = 10;

const Text = z.string().min(1);

// ── Budgets and the Pace ─────────────────────────────────────────────────────────────────────────

/** The limits of `run.json`'s `budgets` that the agent and the rules read (§4.11), under their `run.json` names. */
export const ContextBudgets = z.strictObject({
  web_fetches: Count.describe("The most pages you may fetch"),
  findings_max: Count.describe("Story plus items, at most"),
  typical_findings: z.tuple([Count, Count]).refine(([lo, hi]) => lo <= hi, { error: "typical_findings is [from, to] with from <= to" })
    .describe("A normal day's story plus items, from and to"),
  deep_read_max: Count.describe("The candidates marked deep_read, at most"),
  words_target: Count,
  words_max: Count,
  reading_grade_soft: z.number().min(0),
  reading_grade_max: z.number().min(0),
});

/** A pack candidate as the agent sees it: its title and abstract carry the `<untrusted>` wrapper, so the pack's character cap does not apply. */
export const ContextCandidate = Candidate.extend({
  title: Text.describe("Untrusted, wrapped"),
  abstract: z.string().describe("Untrusted, wrapped"),
});

/** The Pace line and the figures prose may quote, from the day's metrics (§5.2). */
export const ContextPace = z.strictObject({
  sentence: Text.describe("The Pace sentence in English, verbatim: never rewrite it"),
  quotable: z.record(MetricPath, Text).describe("The only metric numbers prose may use, by path; quote them verbatim"),
});

// ── Stored findings ──────────────────────────────────────────────────────────────────────────────

/** A finding in the last 30 days, as filed on D (§4.15). */
export const RecentFinding = z.strictObject({
  id: FindingId,
  title: Text,
  field: FieldId,
  rung: Rung,
  significance: Significance,
  artefacts: Artefacts,
});

const StoredExplainer = z.strictObject({
  found: Text,
  matters: Text,
  ai_helped: Text.nullable(),
  how_sure: Text,
  background: Text,
  could_lead: Text,
});

/**
 * A stored finding's record in English (§4.15): what a Sunday candidate and an open or upheld report carry, since the agent
 * cannot read `content/`. Its field, kind and significance are as `filedAs()` files it on D. `ai` is here beyond §4.15's
 * list because a report of kind `rung` is about the rung or the AI role, and a deep dive explains the AI part.
 */
export const StoredFinding = z.strictObject({
  id: FindingId,
  title: Text,
  field: FieldId,
  kind: FindingKind,
  significance: Significance,
  explainer: StoredExplainer,
  ai: AiInfo,
  rung_history: z.array(RungEntry.extend({ note: Text.nullable() })).min(1, { error: "A finding has at least one rung entry" }),
  since_then: z.array(SinceThen.extend({ text: Text })),
  sources: z.array(FindingSource),
  first_published: IsoDate,
});

/** A Sunday candidate for the deep dive: a stored finding and the reasons it is a candidate (§4.15). */
export const LedgerCandidate = StoredFinding.extend({
  reasons: z.array(WhyToday).min(1, { error: "A candidate has at least one reason" })
    .refine((a) => new Set(a).size === a.length, { error: "reasons must not repeat" })
    .describe("news, anniversary or rotation: the deep dive's why_today is one of them"),
});

/** An open report, or one JL upheld that has no correction yet, with the finding's stored text (§8.9). */
export const ContextReport = z.strictObject({
  id: ReportId,
  status: z.enum(["open", "upheld"]),
  finding_id: FindingId,
  kind: ReportKind,
  evidence_url: z.string().min(1).max(500).nullable().describe("A primary link the reader gave, normalised, or null; fetch it if you need it"),
  finding: StoredFinding,
}).superRefine((r, ctx) => {
  if (r.finding.id !== r.finding_id) {
    ctx.addIssue({ code: "custom", message: "finding is the report's finding", path: ["finding", "id"] });
  }
});

// ── The week ─────────────────────────────────────────────────────────────────────────────────────

/** A finding in the story or items of the seven editions D - 7 to D - 1, each counted once, as filed on D (§4.5). */
export const WeekFinding = z.strictObject({
  id: FindingId,
  title: Text,
  field: FieldId,
  kind: FindingKind,
  significance: Significance,
  rung: Rung,
});

/**
 * A Monday's week (§4.5, §4.15). Its falls are the rung changes to disputed or retracted, and its setbacks are the findings
 * filed as setbacks that were first briefed in those seven days. The big picture's cap is the long one with 3 or more
 * findings and the short one with fewer.
 */
export const WeekContext = z.strictObject({
  findings: z.array(WeekFinding),
  rung_changes: z.array(RungChange).describe("The seven editions' rung changes; those to disputed or retracted are the week's falls"),
  setbacks: z.array(FindingId).describe("The week's findings filed as setbacks"),
  field_counts: FieldCounts,
});

// ── Proposals, standing stories and the config ───────────────────────────────────────────────────

/** What a rung-watch check found that no script change settles (§5.8): the agent decides, and cites a source. */
export const PROPOSAL_KINDS = [
  "retraction", "expression_of_concern", "journal_version", "correction", "trial_change", "source_missing", "source_changed",
] as const;
export const ProposalKind = z.enum(PROPOSAL_KINDS);

export const RungProposal = z.strictObject({
  finding_id: FindingId,
  kind: ProposalKind,
  to: Rung.nullable().describe("The rung the record would move the finding to, or null when it shows none"),
  date: IsoDate.nullable().describe("The notice's, paper's or record's own date, or null when it has no full date"),
  url: Text.nullable().describe("The notice, paper, record or page that shows it, to fetch and cite, or null when there is none"),
  note: Text.max(300).describe("A fixed template saying what was found and why the script left it to you, never raw text from the record"),
});

/** A long-running story that returns only on new facts (`config/standing-stories.json`, §4.11). */
export const ContextStory = z.strictObject({
  id: ConfigId,
  finding_ids: z.array(FindingId),
  rule: Text,
});

export const ContextField = z.strictObject({
  id: FieldId,
  subfields: z.array(z.strictObject({ id: SubfieldId, name: Text })).describe("The ids a finding's subfield may take under this field, with their names"),
});

export const ContextSourceKind = z.strictObject({
  id: SourceKind,
  label: Text,
  means: Text,
});

/** A publisher, resolver or registry whose pages pass `isPrimary()` for these source kinds (`config/source-tiers.json`). */
export const ContextPublisher = z.strictObject({
  id: ConfigId,
  name: Text,
  hosts: z.array(Text).min(1, { error: "A publisher has at least one host" }),
  kinds: z.array(SourceKind).min(1, { error: "A publisher has at least one source kind" }),
});

/** The config the rules read and the agent follows (§4.15). */
export const ContextConfig = z.strictObject({
  hype_words: z.array(Text).describe("English words that may not appear (HYPE_WORDS)"),
  jargon: z.array(Text).describe("Technical words that must be defined where a finding uses them (TERM_DEFINED)"),
  field_cap: Count.describe("An informational copy of FIELD_CAP, the most findings of one field in story and items; the rule reads its own constant, not this value"),
  fields: z.array(ContextField),
  source_kinds: z.array(ContextSourceKind),
  allowlist: z.array(ContextPublisher).describe("A summary of the primary-source allowlist: where a source of each kind may be"),
});

/** The pack's paths and state: Cyber's block. */
export const ContextPack = z.strictObject({
  md: Text.describe("Path"),
  json: Text.describe("Path"),
  degraded: z.boolean(),
  failed_feeds: z.array(ConfigId),
});

// ── The context ──────────────────────────────────────────────────────────────────────────────────

/** `drafts/context.json`. */
export const AgentContext = z.strictObject({
  date: IsoDate.describe("Taipei edition date"),
  format: Format,
  window: TimeWindow.describe("As the pack's"),
  deadline: IsoTimestamp.describe("By which the draft must be written"),
  budgets: ContextBudgets,
  candidates: z.array(ContextCandidate).describe("Ranked; the best have deep_read true"),
  pace: ContextPace,
  recent_findings: z.array(RecentFinding).describe("The last 30 days, as filed on D"),
  ledger_for_sunday: z.array(LedgerCandidate).max(LEDGER_CANDIDATES_MAX, { error: `At most ${LEDGER_CANDIDATES_MAX} candidates` })
    .describe("Sundays only: the candidates for the deep dive, ranked; [] on any other day"),
  week: WeekContext.nullable().describe("Mondays only: the seven editions' findings, rung changes, setbacks and field counts; null on any other day"),
  rung_proposals: z.array(RungProposal),
  corrections: z.strictObject({
    flagged: z.array(FlaggedRecord).describe("From the safety check of stored records (§8.9): write a removed correction on each"),
  }),
  reports: z.array(ContextReport),
  standing_stories: z.array(ContextStory),
  pack: ContextPack,
  config: ContextConfig,
}).superRefine((c, ctx) => {
  if (realDates(c.date)) {
    const format = formatForWeekday(weekday(c.date));
    if (c.format !== format) ctx.addIssue({ code: "custom", message: `The format of ${c.date} is ${format}`, path: ["format"] });
  }
  if ((c.week !== null) !== (c.format === "monday_review")) {
    ctx.addIssue({
      code: "custom",
      message: c.format === "monday_review" ? "A Monday's context has its week" : "Only a Monday's context has a week",
      path: ["week"],
    });
  }
  if (c.ledger_for_sunday.length > 0 && c.format !== "sunday_deep_dive") {
    ctx.addIssue({ code: "custom", message: "Only a Sunday's context has deep dive candidates", path: ["ledger_for_sunday"] });
  }
  c.candidates.forEach((cand, i) => {
    if (c.candidates.findIndex((o) => o.id === cand.id) !== i) {
      ctx.addIssue({ code: "custom", message: `Candidate ${cand.id} appears twice`, path: ["candidates", i, "id"] });
    }
  });
});

export type ContextBudgets = z.infer<typeof ContextBudgets>;
export type ContextCandidate = z.infer<typeof ContextCandidate>;
export type ContextPace = z.infer<typeof ContextPace>;
export type RecentFinding = z.infer<typeof RecentFinding>;
export type StoredFinding = z.infer<typeof StoredFinding>;
export type LedgerCandidate = z.infer<typeof LedgerCandidate>;
export type ContextReport = z.infer<typeof ContextReport>;
export type WeekFinding = z.infer<typeof WeekFinding>;
export type WeekContext = z.infer<typeof WeekContext>;
export type ProposalKind = z.infer<typeof ProposalKind>;
export type RungProposal = z.infer<typeof RungProposal>;
export type ContextStory = z.infer<typeof ContextStory>;
export type ContextField = z.infer<typeof ContextField>;
export type ContextSourceKind = z.infer<typeof ContextSourceKind>;
export type ContextPublisher = z.infer<typeof ContextPublisher>;
export type ContextConfig = z.infer<typeof ContextConfig>;
export type ContextPack = z.infer<typeof ContextPack>;
export type AgentContext = z.infer<typeof AgentContext>;
