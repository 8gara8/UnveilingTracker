// Shared building blocks (SPEC §4.1, §4.3): the id and code formats, dates, counts and fractions, `L10n`, the
// vocabulary enums and the objects that findings and briefs share (Source, RungEntry, AiInfo, Reaction,
// Artefacts, Figure, Who). Every object is strict: an unknown key is an error, and an absent value is null or
// [], never a missing key (§4.1).
//
// What lives here is shape: types, enums, id formats, character caps and fixed formats. A check that §4.12
// gives its own rule code (word budgets, `COUNTS`, `GO_DEEPER`, `ARTEFACT_FORMAT`, `AI_CONFIDENCE`,
// `AI_SYSTEM_NAMED`, `QUOTE_VERBATIM`, `SOURCE_IDS`, `PRIMARY_ONLY` and the rest) stays in lib/rules, so the
// agent gets that rule's message; the regexes such a rule needs are in `ID_PATTERNS`. A stored record may be
// older than a list or a fixed string (a label, `REMOVED_TEXT`), so nothing here compares a string with one.
//
// A schema with a refinement cannot be `.pick()`ed or `.omit()`ed (Zod refuses); `.shape` and `.extend()`
// still work. Each such object therefore also has an unrefined `<Name>Base`.
//
// Cyber's lib/schema/common.ts at the fork commit 3ced1fb, adapted: `IsoDate`, `IsoTimestamp`, `PublishedAt`,
// `Interval`, `Count`, `uniqueArray`, `words` and `refs` are Cyber's; `Fraction` also holds the 4-decimal
// format of SPEC §4.1; the id formats, the vocabulary enums, `Source` and the rest are this project's
// (Cyber's items, regions, actors and CVE ids are dropped); `L10n` is new and agrees with lib/i18n.ts.

import { z } from "zod";
import { isValidDate } from "../dates";
import {
  AI_CONFIDENCE, AI_ROLES, ALL_RUNGS, EDITIONS, FIELDS, FIELD_CODES, FINDING_KINDS, FORMATS, REPORT_KINDS, SIGNIFICANCE,
  SOURCE_KINDS,
} from "../vocab";

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const FINDING_ID_SOURCE = `(?:${FIELD_CODES.join("|")})-\\d{4}-\\d{4}`;

/** Every id and code format of SPEC §4.3 and the files of §4.7 to §4.13, for the schemas below, the rules and the loaders. */
export const ID_PATTERNS = {
  /** `math-2026-0142`: the field's code, the year, a counter within the year (§4.3). */
  finding: new RegExp(`^${FINDING_ID_SOURCE}$`),
  /** A new finding in a draft: `new-1`, `new-2`, ... */
  newRef: /^new-[1-9][0-9]*$/,
  /** The English term in kebab case, and at most `TERM_ID_MAX` characters. */
  term: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  correction: /^C-\d{4}$/,
  report: /^R-\d{4}$/,
  /** A source id in a finding (`s1`) or in a brief (`b1`). */
  source: /^[sb][1-9][0-9]*$/,
  findingSource: /^s[1-9][0-9]*$/,
  briefSource: /^b[1-9][0-9]*$/,
  /** config/ ids, unique per file; a subfield id too. */
  config: /^[a-z0-9][a-z0-9-]*$/,
  /** A counter id in config/counters.json: `erdos_ai`. */
  counter: /^[a-z][a-z0-9_]*$/,
  /** Lower case, without `https://doi.org/` (§4.1); the lower-case check is in `Doi`. */
  doi: /^10\.\d{4,9}\/\S+$/,
  /** An arXiv id, matched without its version (§4.3). */
  arxiv: /^\d{4}\.\d{4,5}(?:v\d+)?$/,
  trial: /^NCT\d{8}$/,
  pdb: /^(?:[0-9][a-z0-9]{3}|pdb_[0-9a-z]{8})$/,
  ror: /^0[a-z0-9]{8}$/,
  /** An archive-index ref: a finding id, or `YYYY-MM-DD/brief` for the brief-level text of an edition (§4.10). */
  archiveRef: new RegExp(`^(?:${FINDING_ID_SOURCE}|\\d{4}-\\d{2}-\\d{2}/brief)$`),
  runId: /^\d{8}-\d{6}$/,
  errorCode: /^E_[A-Z_]+$/,
  /** A rule code (`WORDS`, `DUAL_USE`). */
  ruleCode: /^[A-Z][A-Z0-9_]*$/,
  commit: /^[0-9a-f]{40}$/,
  sha256: /^[0-9a-f]{64}$/,
  /** A dotted path: a correction's `path` (`explainer.how_sure`, `lead.1.text`) or a `quotable` key (`pace.leading.pooled.window`). */
  dottedPath: /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/,
} as const;

export const TERM_ID_MAX = 60;
/** A correction's `path` is at most this many characters (§4.5, §4.10). */
export const PATH_MAX = 60;

const pattern = (re: RegExp, example: string) =>
  z.string().regex(re, { error: `Expected a value like ${example} (pattern ${re.source})` });

// ── Dates and timestamps ─────────────────────────────────────────────────────────────────────────

export const IsoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Expected a date as YYYY-MM-DD", abort: true })
  .refine(isValidDate, { error: "Not a real calendar date" });

/**
 * A timestamp TIMESTAMP_RE accepts that names a real instant: a real calendar date, hour at most 23, minute and
 * second at most 59, and an offset within 14:00. Date.parse alone rolls 2026-02-30 and 24:00 over instead.
 */
function isRealTimestamp(s: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(s);
  if (!m || !isValidDate(m[1]!)) return false;
  const [h, min, sec, oh, om] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? "0")) as [number, number, number, number, number];
  return h <= 23 && min <= 59 && sec <= 59 && om <= 59 && oh * 60 + om <= 14 * 60 && !Number.isNaN(Date.parse(s));
}

export const IsoTimestamp = z.string()
  .regex(TIMESTAMP_RE, { error: "Expected an ISO 8601 timestamp with an offset, e.g. 2026-11-23T03:15:12+08:00", abort: true })
  .refine(isRealTimestamp, { error: "Not a real timestamp" });

/** A source's date: a timestamp when the source gives a time, a bare date when it gives only the day, else null. */
export const PublishedAt = z.union([IsoTimestamp, IsoDate]).nullable()
  .describe("ISO 8601 timestamp with offset when the source gives a time, YYYY-MM-DD when it gives only the day, else null. Never invent a time");

/** True when every string is a real calendar date, so a refinement may do date arithmetic on them without throwing. */
export function realDates(...dates: string[]): boolean {
  return dates.every((d) => typeof d === "string" && isValidDate(d));
}

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────

/** A count: a non-negative integer (§4.1). */
export const Count = z.int().min(0);

/** A share or an interval bound: a fraction in [0, 1] to at most 4 decimal places (§4.1). */
export const Fraction = z.number().min(0).max(1)
  .refine((x) => Math.round(x * 10_000) / 10_000 === x, { error: "A fraction has at most 4 decimal places" });

/** [lo, hi] with lo <= hi. */
export const Interval = z.tuple([z.number(), z.number()])
  .refine(([lo, hi]) => lo <= hi, { error: "An interval is [lo, hi] with lo <= hi" });

/** An interval whose bounds are fractions (a Wilson interval of a share, §5.2). */
export const FractionInterval = z.tuple([Fraction, Fraction])
  .refine(([lo, hi]) => lo <= hi, { error: "An interval is [lo, hi] with lo <= hi" });

/** A string array with no repeats. */
export const uniqueArray = <T extends z.ZodType>(item: T, what: string) =>
  z.array(item).refine((a) => new Set(a).size === a.length, { error: `${what} must not repeat` });

/** A free-text field, never empty, whose budget is in words: the rules enforce it (`WORDS`, `QUOTE_VERBATIM`). */
export const words = (budget: string) => z.string().min(1).describe(budget);
/** Ids that other rules resolve (`REF_UNKNOWN`, `SOURCE_IDS`, `XREF` and the like). */
export const refs = (help: string) => z.array(z.string()).describe(help);

// ── Ids and codes ────────────────────────────────────────────────────────────────────────────────

export const FindingId = pattern(ID_PATTERNS.finding, "math-2026-0142");
export const NewRef = pattern(ID_PATTERNS.newRef, "new-1");
export const TermId = pattern(ID_PATTERNS.term, "virtual-unwrapping")
  .max(TERM_ID_MAX, { error: `A term id is at most ${TERM_ID_MAX} characters` });
export const CorrectionId = pattern(ID_PATTERNS.correction, "C-0001");
export const ReportId = pattern(ID_PATTERNS.report, "R-0001");
export const SourceId = pattern(ID_PATTERNS.source, "s1 in a finding or b1 in a brief");
export const FindingSourceId = pattern(ID_PATTERNS.findingSource, "s1");
export const BriefSourceId = pattern(ID_PATTERNS.briefSource, "b1");
export const ConfigId = pattern(ID_PATTERNS.config, "nature or ancient-texts (lower-case letters, digits, hyphens)");
export const SubfieldId = pattern(ID_PATTERNS.config, "proteins or ancient-texts (an id under the field in config/fields.json)");
export const CounterId = pattern(ID_PATTERNS.counter, "erdos_ai");
export const Doi = pattern(ID_PATTERNS.doi, "10.1126/science.adk1234 (lower case, without https://doi.org/)")
  .refine((s) => s === s.toLowerCase(), { error: "A DOI is stored in lower case" });
export const RorId = pattern(ID_PATTERNS.ror, "05gq02987");
export const RunId = pattern(ID_PATTERNS.runId, '"YYYYMMDD-HHMMSS", the Taipei start time');
export const ErrorCode = pattern(ID_PATTERNS.errorCode, "E_AUTH");
export const RuleCode = pattern(ID_PATTERNS.ruleCode, "WORDS");
export const CommitSha = pattern(ID_PATTERNS.commit, "a 40-character lower-case hex SHA");
export const Sha256 = pattern(ID_PATTERNS.sha256, "a 64-character lower-case hex SHA-256");
/** A dotted path of at most `PATH_MAX` characters (a correction's `path`). */
export const CorrectionPath = pattern(ID_PATTERNS.dottedPath, "explainer.how_sure or lead.1.text")
  .max(PATH_MAX, { error: `A path is at most ${PATH_MAX} characters` });
/** A dotted key into the metrics file (`quotable`'s keys). */
export const MetricPath = pattern(ID_PATTERNS.dottedPath, "pace.leading.pooled.window");
/** An https URL (the registry's, config's and the metrics inputs' addresses); the scheme is the whole check. */
export const HttpsUrl = z.url({
  protocol: /^https$/,
  error: (iss) => (iss.code === "invalid_format" ? "Expected an https URL" : undefined),
});

// ── Vocabulary enums (SPEC §4.2) ─────────────────────────────────────────────────────────────────

/** How the run saw a cited URL; `seed` is for the Ledger history (§4.3). */
export const SEEN_AS = ["pack", "fetched", "search", "seed"] as const;
/** Who wrote a rung entry (§4.3). */
export const RUNG_BY = ["agent", "script", "seed"] as const;
/** The licences a figure may carry (§4.3, `FIGURE_LICENCE`). */
export const FIGURE_LICENCES = ["CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0", "public-domain"] as const;
/** The state of a computed value: the metrics file, a counter, the Pace in a brief and in a run record (§4.5, §4.7). */
export const DATA_STATUS = ["ok", "stale", "missing"] as const;

export const FieldId = z.enum(FIELDS);
/** A finding's kind: every kind but `idea` (§4.4). */
export const FindingKind = z.enum(FINDING_KINDS);
export const Rung = z.enum(ALL_RUNGS);
export const AiRole = z.enum(AI_ROLES);
export const AiConfidence = z.enum(AI_CONFIDENCE);
export const Significance = z.enum(SIGNIFICANCE);
export const SourceKind = z.enum(SOURCE_KINDS);
export const Edition = z.enum(EDITIONS);
export const Format = z.enum(FORMATS);
export const ReportKind = z.enum(REPORT_KINDS);
export const SeenAs = z.enum(SEEN_AS);
export const RungBy = z.enum(RUNG_BY);
export const FigureLicence = z.enum(FIGURE_LICENCES);
export const DataStatus = z.enum(DATA_STATUS);

// ── L10n (SPEC §4.1) ─────────────────────────────────────────────────────────────────────────────

/**
 * A reader-facing string in both languages. The English agent writes `en` and the Chinese pass writes `zh`;
 * `zh` is null only in text an English-only edition wrote and in a correction's `before` copied from it.
 * Agrees with the `L10n` type of lib/i18n.ts.
 */
export const L10n = z.strictObject({
  en: z.string().min(1),
  zh: z.string().min(1).nullable(),
});

// ── Sources (SPEC §4.3) ──────────────────────────────────────────────────────────────────────────

const idHelp = "s1, s2, ... in a finding and b1, b2, ... in a brief, in array order, no gaps";

/** M: one per URL a finding or a brief cites, as the agent writes it. */
export const DraftSource = z.strictObject({
  id: SourceId.describe(idHelp),
  kind: SourceKind,
  title: z.string().min(1).max(200).describe("As published, at most 200 characters, in any language"),
  publisher: z.string().min(1).max(80).describe('At most 80 characters, e.g. "Nature", "arXiv", "ClinicalTrials.gov"'),
  url: z.string().min(1).describe("An https URL of a primary record, from the pack, a page you fetched or a search result. Never press, an archive or a redirect wrapper"),
  doi: Doi.nullable().describe("Lower case, without https://doi.org/; null when the source has none"),
  published_at: PublishedAt,
});

/** S: publish adds how the run saw the URL and the edition that added it. */
export const Source = DraftSource.extend({
  seen_as: SeenAs,
  added: IsoDate.describe("The edition, or the seed file's `seeded` date, that added the source"),
});

/** A finding's sources carry `s` ids, a brief's `b` ids; `SOURCE_IDS` checks the order and the gaps. */
export const DraftFindingSource = DraftSource.extend({ id: FindingSourceId.describe(idHelp) });
export const DraftBriefSource = DraftSource.extend({ id: BriefSourceId.describe(idHelp) });
export const FindingSource = Source.extend({ id: FindingSourceId });
export const BriefSource = Source.extend({ id: BriefSourceId });

// ── Rungs (SPEC §4.3) ────────────────────────────────────────────────────────────────────────────

export const RungEntry = z.strictObject({
  rung: Rung,
  date: IsoDate.describe("The event's own date (preprint posted, paper published, notice issued), or the edition's date for an entry that puts a wrong rung right"),
  recorded: IsoDate.describe("The edition that recorded the entry"),
  source_id: FindingSourceId.describe("The source that shows the rung (RUNG_EVIDENCE)"),
  by: RungBy,
  note: L10n.nullable().describe("At most 25 words; script entries use templates"),
});

// ── The AI role (SPEC §4.3) ──────────────────────────────────────────────────────────────────────

export const AiSystem = z.strictObject({
  name: z.string().min(1).max(60).describe("At most 60 characters, e.g. AlphaFold 3"),
  maker: z.string().min(1).max(60).describe("At most 60 characters, e.g. Google DeepMind"),
});

export const AiEvidence = z.strictObject({
  source_id: FindingSourceId.describe("A source of this finding"),
  quote: words("At most 25 words, verbatim from that source"),
  from_claimant: z.boolean().describe("true when the source is the maker or a lab that benefits"),
});

/**
 * `confidence` is null exactly when `role` is none (`AI_CONFIDENCE`); `systems` is non-empty with an AI role
 * (`AI_SYSTEM_NAMED`); `evidence` has an entry unless the role is none (checked here).
 */
export const AiInfoBase = z.strictObject({
  role: AiRole.describe("One primary role"),
  confidence: AiConfidence.nullable().describe("null exactly when role is none"),
  systems: z.array(AiSystem).describe("At least one with an AI role, except on a setback, infrastructure or policy_people finding whose sources name no system"),
  evidence: z.array(AiEvidence).describe("At least one unless role is none"),
});

export const AiInfo = AiInfoBase.superRefine((ai, ctx) => {
  if (ai.role !== "none" && ai.evidence.length === 0) {
    ctx.addIssue({ code: "custom", message: "An AI role needs at least one evidence entry", path: ["evidence"] });
  }
});

// ── Reactions, artefacts, figures and people (SPEC §4.3) ─────────────────────────────────────────

/** A named scientist's own published reaction (source kind reaction), not an author. */
export const Reaction = z.strictObject({
  source_id: FindingSourceId,
  who: z.string().min(1).max(80),
  affiliation: z.string().min(1).max(100),
  quote: words("At most 25 words, verbatim"),
});

/**
 * The finding's own records, never those it only cites. The formats (`ID_PATTERNS.doi`, `arxiv`, `trial`, `pdb`
 * and a Lean file's https URL on github.com) belong to `ARTEFACT_FORMAT`, which also checks that each appears in a
 * cited source.
 */
export const Artefacts = z.strictObject({
  doi: z.array(z.string().min(1)),
  arxiv: z.array(z.string().min(1)).describe("arXiv ids such as 2501.01234, matched without the version"),
  lean: z.array(z.string().min(1)).describe("https URLs of Lean files on github.com"),
  trial: z.array(z.string().min(1)).describe("NCT numbers"),
  pdb: z.array(z.string().min(1)).describe("Protein Data Bank ids"),
});

/** The paper's own figure, shown on the site only. */
export const Figure = z.strictObject({
  source_id: FindingSourceId.describe("The paper or dataset the figure comes from"),
  image_url: z.string().min(1).describe("https, on a host in config/source-tiers.json figure_hosts (FIGURE_LICENCE)"),
  licence: FigureLicence,
  licence_quote: words("At most 25 words, verbatim from the source page, stating the licence"),
  credit: z.string().min(1).max(120).describe('At most 120 characters, e.g. "Figure 2 from Parker et al., Science (2025), CC BY 4.0"'),
  alt: L10n.describe("At most 40 words: what the figure shows, plainly"),
});

/** A person or group behind the finding, for the application layer; never shown as a regional angle. */
export const Who = z.strictObject({
  name: z.string().min(1).max(100),
  ror: RorId.nullable().describe("The ROR id when a feed gives it, else null"),
});

// ── Types ────────────────────────────────────────────────────────────────────────────────────────

export type IsoDate = z.infer<typeof IsoDate>;
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;
export type PublishedAt = z.infer<typeof PublishedAt>;
export type Count = z.infer<typeof Count>;
export type Fraction = z.infer<typeof Fraction>;
export type Interval = z.infer<typeof Interval>;
export type FractionInterval = z.infer<typeof FractionInterval>;
export type L10n = z.infer<typeof L10n>;
// The vocabulary enums' types, the same as lib/vocab.ts's, so one import from lib/schema serves as both.
export type FieldId = z.infer<typeof FieldId>;
export type FindingKind = z.infer<typeof FindingKind>;
export type Rung = z.infer<typeof Rung>;
export type AiRole = z.infer<typeof AiRole>;
export type AiConfidence = z.infer<typeof AiConfidence>;
export type Significance = z.infer<typeof Significance>;
export type SourceKind = z.infer<typeof SourceKind>;
export type Edition = z.infer<typeof Edition>;
export type Format = z.infer<typeof Format>;
export type ReportKind = z.infer<typeof ReportKind>;
export type SeenAs = z.infer<typeof SeenAs>;
export type RungBy = z.infer<typeof RungBy>;
export type FigureLicence = z.infer<typeof FigureLicence>;
export type DataStatus = z.infer<typeof DataStatus>;
export type DraftSource = z.infer<typeof DraftSource>;
export type Source = z.infer<typeof Source>;
export type DraftFindingSource = z.infer<typeof DraftFindingSource>;
export type DraftBriefSource = z.infer<typeof DraftBriefSource>;
export type FindingSource = z.infer<typeof FindingSource>;
export type BriefSource = z.infer<typeof BriefSource>;
export type RungEntry = z.infer<typeof RungEntry>;
export type AiSystem = z.infer<typeof AiSystem>;
export type AiEvidence = z.infer<typeof AiEvidence>;
export type AiInfo = z.infer<typeof AiInfo>;
export type Reaction = z.infer<typeof Reaction>;
export type Artefacts = z.infer<typeof Artefacts>;
export type Figure = z.infer<typeof Figure>;
export type Who = z.infer<typeof Who>;
