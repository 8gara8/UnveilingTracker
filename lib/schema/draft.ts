// The English agent's one file, `drafts/D.json` (SPEC §4.5 "DraftBrief"), and the schema from which a later stage
// generates `routine/schema/draft-brief.schema.json` (`schema:gen`, Cyber's compact printer over `z.toJSONSchema`).
//
// Only M fields, English strings only. The draft has a key for no S or C field, so a draft that writes one fails
// `SCHEMA` ("Unknown key") and the repair prompt says to remove it. Against `Brief` (brief.ts) it differs exactly here: a
// ref (`new-1`, or an existing finding id) where the brief has a finding id, plain strings where it has `L10n`, and
// the draft-only keys `generated_at`, `new_findings`, `returning`, `rung_changes` (the agent's own entries) and
// `report_decisions`, with none of `format`, `languages`, `published_at`, `late`, `pace`, the S counts and notes.
//
// Shape only, as common.ts explains: word budgets (`WORDS`), `COUNTS`, `REF_UNKNOWN`, `SOURCE_IDS`, `GO_DEEPER`,
// `REPORT_DECISION` and the rest of §4.12 are rules in lib/rules, so each rule's fixture fails with exactly its own
// code; the budgets appear in `.describe()` text for the agent. What a draft says about itself and no rule owns is
// checked here: the AI part, and a correction's path and `after` (SCHEMA's own checks, §4.5).
//
// Refinements are Zod-only. `z.toJSONSchema` ignores them, so the generated JSON Schema shows the structure, and the
// agent meets a refinement only as a SCHEMA message in the repair prompt. There are three: `AiInfo` (common.ts: an AI
// role needs an evidence entry), `DraftFinding` (`ai_helped` is null exactly when `ai.role` is none, as `Finding` says)
// and `DraftCorrection` (below). A schema with a refinement cannot be `.pick()`ed or `.omit()`ed, so `DraftFindingBase`
// and `DraftCorrectionBase` hold the unrefined objects.
//
// Where a ref may be either: `lead.refs`, `story` and `items` take `new-N` or an existing finding id (`FindingRef`);
// every other finding reference of a draft is an existing finding id, since `related` and the rest are written into
// stored findings that cannot name a draft's `new-N`. A source id in a returning entry or a rung entry may be one of the
// finding's own (`s1`) or one of the brief-level sources of this draft (`b1`), which publish copies into the finding
// (§8.7); everywhere else the container fixes the form (`s` in a finding, `b` at brief level).
//
// Cyber's lib/schema/draft-brief.ts at the fork commit 3ced1fb, adapted: its Lead sentences, angles, region raises,
// regional blocks, scored predictions and week in review give way to this project's refs, new and returning findings,
// rung changes, ideas, also-noted lines, deep dive and week review; the corrections carry their record (a finding, an
// edition or a glossary term), a path checked against its schema and a report id, and the report decisions are new.
// Cyber's idiom (`words()` and `refs()` for budgets and ids that other rules resolve, strict objects, `describe()` for the
// agent) stays.

import { z } from "zod";
import { ID_PATHS, NONE_FOUND, REMOVED_TEXT, type IdPath } from "../vocab";
import {
  AiInfo, Artefacts, BriefSourceId, Count, CorrectionPath, DraftBriefSource, DraftFindingSource, FieldId, Figure, FindingId,
  FindingKind, FindingSourceId, ID_PATTERNS, IsoDate, IsoTimestamp, NewRef, Reaction, ReportId, Rung, Significance, SourceId,
  SubfieldId, TERM_ID_MAX, TermId, Who, words,
} from "./common";
import { Brief, WhyToday } from "./brief";
import { Finding } from "./finding";
import { CorrectionTarget, CorrectionType, DecidedReportStatus, hasOneTarget } from "./misc";

const ONE_TARGET = "Exactly one of finding_id, edition_date and term_id is set";

// ── Refs ─────────────────────────────────────────────────────────────────────────────────────────

const REF_SOURCE = `(?:${ID_PATTERNS.newRef.source.slice(1, -1)}|${ID_PATTERNS.finding.source.slice(1, -1)})`;

/** A finding named in the Lead, the story or the items: `new-N` for a finding of this draft, or an existing finding id. */
export const FindingRef = z.string().regex(new RegExp(`^${REF_SOURCE}$`), {
  error: "Expected a ref: new-N for a new finding, or the id of an existing finding such as math-2026-0142",
});

// ── Rungs and terms ──────────────────────────────────────────────────────────────────────────────

/** A rung entry as the agent writes it; publish adds `recorded` and `by`. The source is a finding's `s` id or a brief-level `b` id. */
export const DraftRung = z.strictObject({
  rung: Rung,
  date: IsoDate.describe("The event's own date, or the edition's date when the entry puts a wrong rung right"),
  source_id: SourceId.describe("The source that shows the rung: one of the finding's own (s1) or one of this draft's brief-level sources (b1)"),
  note: words("At most 25 words").nullable(),
});

/** A new finding's own rung entry: its source is one of its own (`s` ids). */
export const DraftFindingRung = DraftRung.extend({
  source_id: FindingSourceId.describe("One of this finding's sources (s1, s2, ...)"),
});

export const DraftTermNew = z.strictObject({
  new: z.literal(true),
  term: z.string().min(1).max(TERM_ID_MAX).describe(`The English term, at most ${TERM_ID_MAX} characters; its id is its kebab-case form`),
  definition: words("At most 40 words, plain, using no other undefined jargon"),
});

export const DraftTermKnown = z.strictObject({
  new: z.literal(false),
  id: TermId.describe("The id of a term already in the glossary"),
});

/** A glossary term a finding's explainer uses: a new one with its definition, or an existing one by id. */
export const DraftTerm = z.discriminatedUnion("new", [DraftTermNew, DraftTermKnown]);

// ── A new finding ────────────────────────────────────────────────────────────────────────────────

export const DraftExplainer = z.strictObject({
  found: words("What was found. Story at most 55 words"),
  matters: words("Why it matters. Story at most 50 words"),
  ai_helped: words("How AI helped, naming the system and its maker. Story at most 60 words. null exactly when ai.role is none").nullable(),
  how_sure: words("Starts with the rung's label and names who says so. Story at most 60 words"),
  background: words("Story at most 35 words; any other finding at most 40"),
  could_lead: words("A possibility, never a promise. Story at most 35 words; any other finding at most 40"),
}).describe("The story of the day: all six parts together 230 to 280 words. Any other finding: the first four parts together 70 to 100 words");

/** The paper's own figure: `Figure` with its alt text in English only. */
export const DraftFigure = Figure.extend({
  alt: words("At most 40 words: what the figure shows, plainly"),
});

export const DraftFindingBase = z.strictObject({
  ref: NewRef.describe("new-1, new-2, ... in order"),
  field: FieldId,
  subfield: SubfieldId.describe("An id under the field, from the context's config.fields"),
  kind: FindingKind,
  title: words("At most 12 words, plain, no hype word"),
  explainer: DraftExplainer,
  go_deeper: z.array(FindingSourceId).describe("1 to 3 ids of this finding's primary sources"),
  ai: AiInfo,
  significance: Significance,
  rung_history: z.array(DraftFindingRung).min(1, { error: "A finding has at least one rung entry" })
    .describe("Oldest first: your view of the record so far"),
  sources: z.array(DraftFindingSource).describe("s1 to sN, in order, no gaps"),
  reactions: z.array(Reaction).describe("At most 4"),
  artefacts: Artefacts,
  figure: DraftFigure.nullable(),
  who: z.array(Who).min(1, { error: "A finding has at least one who entry" }).max(8, { error: "A finding has at most 8 who entries" }),
  terms: z.array(DraftTerm),
  related: z.array(FindingId).describe("At most 5 existing findings"),
  first_published: IsoDate.describe("The result's own first public date, from its earliest source"),
});

export const DraftFinding = DraftFindingBase.superRefine((f, ctx) => {
  const none = f.ai.role === "none";
  if (none !== (f.explainer.ai_helped === null)) {
    ctx.addIssue({
      code: "custom",
      message: none ? "ai_helped is null when ai.role is none" : "ai_helped is set when ai.role is an AI role",
      path: ["explainer", "ai_helped"],
    });
  }
});

// ── The rest of the draft ────────────────────────────────────────────────────────────────────────

/** One sentence of the Lead and the findings it draws on. */
export const DraftLeadLine = z.strictObject({
  text: words("One sentence"),
  refs: z.array(FindingRef).describe("At least 1 finding in this brief, except on a day with none"),
});

/** An existing finding that has new facts, shown in the story or the items. */
export const DraftReturning = z.strictObject({
  finding_id: FindingId.describe("An existing finding with new facts; it appears in story or items"),
  update: words("At most 60 words: the new facts"),
  source_ids: z.array(SourceId).describe("The sources that show the new facts, at least one added this run"),
  rung: DraftRung.nullable().describe("A new dated rung entry, or null"),
});

/** The agent's own rung change on a finding that is not in the story or the items. */
export const DraftRungChange = z.strictObject({
  finding_id: FindingId.describe("An existing finding that is not in story or items"),
  rung: DraftRung,
});

export const DraftIdea = z.strictObject({
  text: words("At most 40 words"),
  who: z.string().min(1).describe("The person whose own published argument it is"),
  source_id: BriefSourceId,
});

export const DraftAlso = z.strictObject({
  title: words("At most 20 words"),
  field: FieldId,
  source_id: BriefSourceId,
});

/** Sundays only. */
export const DraftDeepDive = z.strictObject({
  finding_id: FindingId.describe("A candidate of the context's ledger_for_sunday"),
  text: words("450 to 550 words"),
  source_ids: z.array(BriefSourceId),
  why_today: WhyToday.describe("One of the candidate's reasons"),
});

/** Mondays only. */
export const DraftReview = z.strictObject({
  big_picture: words("270 to 330 words, or at most 120 in a week of fewer than 3 findings"),
  remarkable: z.strictObject({
    finding_id: FindingId.describe("A finding of the context's week"),
    note: words("At most 30 words"),
  }).nullable().describe("null exactly when the week has no finding"),
  strongest_against: z.strictObject({
    text: words(`At most 50 words, or exactly "${NONE_FOUND.en}"`),
    finding_ids: z.array(FindingId).describe("Every setback and every finding that fell this week; [] only with the exact words"),
    source_ids: z.array(BriefSourceId),
  }),
});

export const DraftReportDecision = z.strictObject({
  report_id: ReportId.describe("An open report of the context"),
  outcome: DecidedReportStatus,
  reason: words("At most 40 words"),
  correction: Count.nullable().describe("When upheld, the index of the correction in corrections that answers it; else null"),
});

// ── A correction ─────────────────────────────────────────────────────────────────────────────────

/** The records a correction can name: a finding, an edition's brief-level text, or a glossary term (§4.10). */
export type CorrectionRecord = "finding" | "edition" | "term";

const RECORD_LABEL: Record<CorrectionRecord, string> = { finding: "a finding", edition: "an edition's brief", term: "a glossary term" };

/**
 * The paths a `removed` correction may rewrite, by record, each array index written `*` (§4.10): an `L10n`, a plain
 * string of free text, a source's `url` or a figure's `image_url`, never a vocabulary value or an id; on a term only
 * `definition`. Every `L10n` of a finding and of a brief is here (tests/schema-draft.test.ts checks it against the
 * schemas), so the re-check can send a flagged string at any of them.
 */
export const REMOVABLE_PATHS: Record<CorrectionRecord, readonly string[]> = {
  finding: [
    "title",
    "explainer.found", "explainer.matters", "explainer.ai_helped", "explainer.how_sure", "explainer.background", "explainer.could_lead",
    "ai.systems.*.name", "ai.systems.*.maker", "ai.evidence.*.quote",
    "rung_history.*.note", "since_then.*.text",
    "sources.*.title", "sources.*.publisher", "sources.*.url",
    "reactions.*.who", "reactions.*.affiliation", "reactions.*.quote",
    "figure.image_url", "figure.licence_quote", "figure.credit", "figure.alt",
    "who.*.name",
  ],
  edition: [
    "pace.sentence", "lead.*.text", "story.update", "items.*.update", "ideas.*.text", "ideas.*.who", "also.*.title", "deep_dive.text",
    "review.big_picture", "review.remarkable.note", "review.strongest_against.text", "corrections.*.reason", "status_note",
    "sources.*.title", "sources.*.publisher", "sources.*.url",
  ],
  term: ["definition"],
};

const INDEX = /^(?:0|[1-9][0-9]*)$/;

/** `sources.0.url` as `sources.*.url`. */
function genericPath(path: string): string {
  return path.split(".").map((seg) => (INDEX.test(seg) ? "*" : seg)).join(".");
}

/** Whether a `removed` correction may rewrite `path` in a record of this kind. */
export function isRemovablePath(record: CorrectionRecord, path: string): boolean {
  return REMOVABLE_PATHS[record].includes(genericPath(path));
}

/** Which record a correction names, or null unless exactly one of its three target keys is set. */
export function correctionRecord(c: { finding_id: unknown; edition_date: unknown; term_id: unknown }): CorrectionRecord | null {
  if (!hasOneTarget(c)) return null;
  return c.finding_id !== null ? "finding" : c.edition_date !== null ? "edition" : "term";
}

const unwrap = (schema: z.ZodType): z.ZodType => {
  let s = schema;
  while (s instanceof z.ZodNullable || s instanceof z.ZodOptional) s = s.unwrap() as z.ZodType;
  return s;
};

/** An `L10n`: an object of exactly `en` and `zh`, a string and a nullable string (a brief's `languages` has the same keys). A correction names it whole, never one language of it. */
const isL10n = (schema: z.ZodType): boolean =>
  schema instanceof z.ZodObject && Object.keys(schema.shape).join(",") === "en,zh"
  && schema.shape.en instanceof z.ZodString && schema.shape.zh instanceof z.ZodNullable;

/**
 * Why `path` names no single value of `root`'s record, or null when it does: each segment is a key of an object
 * or an index (from 0) of a list, an `L10n` is a value of its own, and a path may not stop at a group of values.
 */
function valueProblem(root: z.ZodType, path: string, record: CorrectionRecord): string | null {
  let at = unwrap(root);
  let walked = "";
  for (const seg of path.split(".")) {
    const here = walked === "" ? RECORD_LABEL[record] : `"${walked}"`;
    if (isL10n(at)) return `${here} is a text in both languages: name it as a whole, not one language of it ("${seg}")`;
    if (at instanceof z.ZodObject) {
      if (!Object.hasOwn(at.shape, seg)) return `${here} has no key "${seg}" (its keys: ${Object.keys(at.shape).join(", ")})`;
      at = unwrap(at.shape[seg] as z.ZodType);
    } else if (at instanceof z.ZodArray) {
      if (!INDEX.test(seg)) return `${here} is a list: name an entry by its index from 0, not "${seg}"`;
      at = unwrap(at.element as z.ZodType);
    } else {
      return `${here} holds one value and has no "${seg}"`;
    }
    walked = walked === "" ? seg : `${walked}.${seg}`;
  }
  if (!isL10n(at) && (at instanceof z.ZodObject || at instanceof z.ZodArray)) {
    return `"${path}" names a group of values: name one text or value inside it`;
  }
  return null;
}

/** The record schema a correction's path is walked against; a term's paths are `term` and `definition` only. */
const RECORD_SCHEMA = { finding: Finding, edition: Brief } as const;

export interface CorrectionProblem {
  /** Relative to the correction: [] for the whole, ["path"] or ["after"] for a key. */
  path: string[];
  message: string;
}

/**
 * SCHEMA's checks of a draft correction beyond its shape (SPEC §4.5). Its `path` must name a value of its record's type
 * (a finding of §4.4, the brief-level text and sources of §4.5's brief, or a term's `term` or `definition`); a
 * `removed` one must name a path §4.10 lets it rewrite and have exactly `REMOVED_TEXT` as its `after`; none may name a
 * rung (`rung`, or a rung entry's `rung`), which changes only through a new dated rung entry (§5.8); one on `field`,
 * `kind`, `significance`, `ai.role` or `ai.confidence` has an id of that vocabulary as its `after` (§4.2; never `idea`
 * for a kind). Whether the stored record has the path (an index past the end, a figure that is null) is `XREF`'s at publish.
 */
export function correctionProblems(
  c: { finding_id: unknown; edition_date: unknown; term_id: unknown; type: string; path: string; after: string },
): CorrectionProblem[] {
  const record = correctionRecord(c);
  if (record === null) return [{ path: [], message: ONE_TARGET }];
  if (!ID_PATTERNS.dottedPath.test(c.path)) return []; // the path's own format issue stands alone

  if (record === "term") {
    if (c.path !== "term" && c.path !== "definition") {
      return [{ path: ["path"], message: 'On a glossary term a correction names "term" or "definition"' }];
    }
  } else {
    const problem = valueProblem(RECORD_SCHEMA[record], c.path, record);
    if (problem !== null) return [{ path: ["path"], message: problem }];
  }

  const generic = genericPath(c.path);
  if (record === "finding" && (generic === "rung" || generic === "rung_history.*.rung")) {
    return [{
      path: ["path"],
      message: "A rung changes only through a new dated rung entry (rung_changes, or a returning entry's rung), never through a correction",
    }];
  }

  const problems: CorrectionProblem[] = [];
  if (c.type === "removed") {
    if (!isRemovablePath(record, c.path)) {
      problems.push({
        path: ["path"],
        message: `A removed correction rewrites one text (an L10n, a plain string of free text, a source url or a figure image_url, never a vocabulary value or an id; on a term only definition); "${c.path}" is none`,
      });
    }
    if (c.after !== REMOVED_TEXT.en) problems.push({ path: ["after"], message: `A removed correction's after is exactly "${REMOVED_TEXT.en}"` });
  } else if (record === "finding" && Object.hasOwn(ID_PATHS, generic)) {
    const ids: readonly string[] = ID_PATHS[generic as IdPath];
    if (!ids.includes(c.after)) problems.push({ path: ["after"], message: `A correction on "${c.path}" has one of ${ids.join(", ")} as its after` });
  }
  return problems;
}

export const DraftCorrectionBase = z.strictObject({
  ...CorrectionTarget,
  type: CorrectionType,
  path: CorrectionPath.describe('Dotted, indices from 0: "explainer.how_sure", "title", "lead.1.text"; on a term "term" or "definition"'),
  after: z.string().min(1).max(300).describe("At most 300 characters: the corrected text or value; for removed, exactly the removed-text string"),
  reason: words("At most 40 words"),
  source_url: z.string().min(1).nullable().describe("The primary source that shows the correction is right, or null"),
  report_id: ReportId.nullable().describe("Set only on the correction for a report JL upheld, else null"),
}).describe(`${ONE_TARGET}: a finding, an edition's brief-level text, or a glossary term`);

export const DraftCorrection = DraftCorrectionBase.superRefine((c, ctx) => {
  for (const problem of correctionProblems(c)) ctx.addIssue({ code: "custom", message: problem.message, path: problem.path });
});

// ── The draft ────────────────────────────────────────────────────────────────────────────────────

export const DraftBrief = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate.describe("The edition date from the context"),
  generated_at: IsoTimestamp.describe("When you finished: between the context's window end and its deadline"),
  lead: z.array(DraftLeadLine).describe("1 to 3 sentences, at most 60 words in all; write it last. A quiet day says so"),
  story: FindingRef.nullable().describe("The story of the day, or null when there is no finding; on a Monday or a Sunday only a Major or Landmark finding"),
  items: z.array(FindingRef).describe("In display order; story plus items at most the context's budgets.findings_max, at most 2 on a Monday or a Sunday"),
  new_findings: z.array(DraftFinding).describe("One for each new-N ref, in order"),
  returning: z.array(DraftReturning),
  rung_changes: z.array(DraftRungChange),
  ideas: z.array(DraftIdea).describe("0 to 2"),
  also: z.array(DraftAlso).describe("0 to 5"),
  deep_dive: DraftDeepDive.nullable().describe("Sundays only; null on every other day"),
  review: DraftReview.nullable().describe("Non-null exactly on Mondays"),
  corrections: z.array(DraftCorrection),
  report_decisions: z.array(DraftReportDecision).describe("One for each open report of the context"),
  sources: z.array(DraftBriefSource).describe("b1 to bN, in order, no gaps: what the brief-level text cites"),
});

export type FindingRef = z.infer<typeof FindingRef>;
export type DraftRung = z.infer<typeof DraftRung>;
export type DraftFindingRung = z.infer<typeof DraftFindingRung>;
export type DraftTerm = z.infer<typeof DraftTerm>;
export type DraftExplainer = z.infer<typeof DraftExplainer>;
export type DraftFigure = z.infer<typeof DraftFigure>;
export type DraftFinding = z.infer<typeof DraftFinding>;
export type DraftLeadLine = z.infer<typeof DraftLeadLine>;
export type DraftReturning = z.infer<typeof DraftReturning>;
export type DraftRungChange = z.infer<typeof DraftRungChange>;
export type DraftIdea = z.infer<typeof DraftIdea>;
export type DraftAlso = z.infer<typeof DraftAlso>;
export type DraftDeepDive = z.infer<typeof DraftDeepDive>;
export type DraftReview = z.infer<typeof DraftReview>;
export type DraftReportDecision = z.infer<typeof DraftReportDecision>;
export type DraftCorrection = z.infer<typeof DraftCorrection>;
export type DraftBrief = z.infer<typeof DraftBrief>;
