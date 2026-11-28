// The sample content (SPEC §3, §4.12 "Fixtures and tests", §10 P1): one week of stored records, 2026-10-12 to 2026-10-18, in the layout of
// `content/`, written to `fixtures/site-content/` (the folder the loader, the chat edition and the site read as a sample), plus the empty
// folder `fixtures/empty-content/`. Everything is derived from the shared world (`world.ts`) by the one function that does what publish does
// to a draft (`publishDraft()`, SPEC §8.7 `applyDraft()`), so a stored brief, a finding, a glossary term, a correction and a report are the
// ones the drafts and the Chinese pass would leave, and the validator's stored-record rules (`validateAll()`) find nothing in them.
//
// The week (every date is a Taipei date; `SAMPLE_EDITIONS` below is the same table as a typed constant). Each block lists the weekday, the
// kind, the languages, whether it is data-only, where each finding handle is shown (lead, story, items, returning, rung changes, deep dive,
// review), its corrections, reports, ideas and Also noted lines:
//
//   2026-10-12 Monday     kind monday_review; full; en+zh; not data-only
//                         lead weather | plasma; story weather (new); items plasma (new); returning none; rung changes none; deep dive none;
//                         review in SPEC §4.5's SHORT form (no earlier edition: remarkable null, strongest evidence against NONE_FOUND, zero
//                         counts, a short big picture that names Claude, so disclosure lists `review`); corrections none; reports none;
//                         ideas 0; also noted 0
//   2026-10-13 Tuesday    kind daily; full; ENGLISH-ONLY (the Chinese pass failed, E_ZH, `languages.zh` false, every `zh` null); not data-only
//                         lead tilings | catalyst | retractW0; story tilings (new); items catalyst, retractW0, survey (new, four findings in
//                         all, survey and retractW0 both in the social sciences); returning none; rung changes none; deep dive none; review
//                         none; corrections none; reports R-0001 (JL closed it as upheld: the intake of this run); ideas 0; also noted 0
//   2026-10-14 Wednesday  kind daily; full; en+zh; not data-only
//                         the world's weekday draft: lead scroll | protein | retractWD, policy; story scroll (new); items protein, retractWD,
//                         erdos (new) and policy (returning: "Back"); rung changes catalyst checked to confirmed (agent, not shown); deep dive
//                         none; review none; corrections C-0001 (tilings, answers R-0002) and C-0002 (weather, answers R-0001); reports R-0002
//                         (upheld by the agent); ideas 2; also noted 2; the Chinese pass also translates the backlog (tilings, catalyst,
//                         retractW0, survey: the four findings of Tuesday's English-only edition)
//   2026-10-15 Thursday   kind daily; DATA-ONLY (the full edition failed: E_VALIDATION); en+zh
//                         lead, story and items none; rung changes fellW0 checked to retracted (script, from a retraction notice); corrections
//                         none; reports none; ideas 0; also noted 0
//   2026-10-16 Friday     kind daily; full; en+zh; not data-only; NO FINDING: the Lead says so (it cites nothing), story null, items []
//                         rung changes antibiotic checked to confirmed (agent, "Climbed or fell"); returning none; deep dive none; review none;
//                         corrections none; reports none; ideas 0; also noted 0
//   2026-10-17 Saturday   kind daily; full; en+zh; not data-only; NO FINDING: the Lead says so (it cites nothing), story null, items []
//                         rung changes none; returning none; deep dive none; review none; corrections none; reports none; ideas 0;
//                         also noted 2 (also.0 names Claude, so disclosure lists `also.0`)
//   2026-10-18 Sunday     kind sunday_deep_dive; full; en+zh; not data-only
//                         the world's Sunday draft: lead translation | antibiotic; story null; items translation (new); returning none; rung
//                         changes none; deep dive antibiotic (why_today news); review none; corrections none; reports none; ideas 0; also noted 0
//
// Why Tuesday is the English-only day and Saturday a quiet one: SPEC §4.12's FORMAT_SECTIONS requires a story on any weekday edition that
// has a finding, so a day with one item and no story is invalid, and a day with no finding can still be a full bilingual edition.
//
// The old-findings problem: the world's findings were first briefed on dates before
// this week, and a stored finding must name briefs that exist. Resolved as follows. FOUR are seeds (history entries, SPEC §8.13): the
// Ledger's `ledger-seed.ts` wrote them on 2026-10-09 (`SEEDED`) with both languages, `history: true`, `first_brief: null`, rung entries by
// "seed" and sources seen as "seed": antibiotic, policy and fellW0 (so the week can return, climb, retract and deep-dive them) and
// disputedOld (kept at its world rung `disputed`, never briefed: What didn't hold up, and the Sunday candidates). The other ELEVEN are
// first briefed in the week from their world first-brief content (`draftFinding()`), so their `briefs`, `first_brief`, `added`,
// `recorded` and `updated` are this week's dates, while the dates of their events (a preprint, a paper, a notice) stay the world's.
// Finding ids are the world's, so the unchanged world drafts (weekday, Sunday) name them as they are; they are not in display order
// across the week (a counter assigned by publish would be), and no rule reads their order.
//
// Reader-visible strings are marked as the world marks them: every finding, source and Also noted title starts with SAMPLE, every `who`
// and idea person carries (SAMPLE), a figure's credit does too. The folder is a sample by where it lives, as Cyber's `isSampleData` reads it.
//
// Cyber's fixtures/src/site.ts at the fork commit 3ced1fb, adapted: its run-record helpers (the stage, feed and run builders), the
// archive-index builder and the one `siteOutputs()` generator are the pattern; its flaw, region and Gap records give way to this
// project's briefs, findings, glossary, corrections, reports, Pace and Chinese edition. `lib/apply.ts` of Cyber (`markCorrected`) is the
// pattern of the correction step.

import { addDays, dataCutoffFor, isoWeekStart, lastSunday, weekday } from "../../lib/dates";
import { byCodeUnit, compareFindingIds } from "../../lib/ids";
import { filedAs, isCounted } from "../../lib/items";
import { jsonText, sha256Hex } from "../../lib/json";
import { holdRate, landmarkCounts } from "../../lib/metrics/ledger-stats";
import { isCountedRung, isFellRung, retractionNote, scriptRungChange, scriptRungEntry, type ScriptChange } from "../../lib/rungs";
import { Brief, type RungChange } from "../../lib/schema/brief";
import { L10n as L10nSchema, type DraftSource, type Rung, type SeenAs } from "../../lib/schema/common";
import { DraftBrief, type DraftRung } from "../../lib/schema/draft";
import { DraftZh, ZhContext, type DraftZhTerm } from "../../lib/schema/draft-zh";
import { Finding } from "../../lib/schema/finding";
import { GlossaryFile, Term } from "../../lib/schema/glossary";
import { InputsManifest, MetricsFile, PaceWeeklyFile, type PaceWeek } from "../../lib/schema/metrics";
import { ArchiveIndex, Correction, Evidence, Report, ReportsFile, CorrectionsFile } from "../../lib/schema/misc";
import { StatusFile, type RunRecord } from "../../lib/schema/status";
import { countWords, mentionsAnthropicText } from "../../lib/text";
import { normalizeUrl } from "../../lib/urls";
import { FIELDS, NONE_FOUND, REMOVED_TEXT, formatForWeekday, statusNote, type FieldId, type Format } from "../../lib/vocab";
import { countZhChars } from "../../lib/zh";
import type { Output } from "./build";
import { editionDraft, PLANS, refOf } from "./drafts";
import { editionContext, fixtureConfig, metricsFor, paceState, paceWeeks } from "./inputs";
import {
  FRIDAY_LEAD, MONDAY_BIG_PICTURE, MONDAY_LEAD, SATURDAY_ALSO, SATURDAY_LEAD, SATURDAY_SOURCES, TUESDAY_LEAD, zhOf,
} from "./site-text";
import {
  EDITIONS, FINDING_KEYS, FINDING_TABLE, SOURCE_TABLE, draftFinding, draftSources, findingId, keysStoredBefore, rungEntryOf, reportsAfterWeekday,
  reportsBeforeWeekday, sourceKeyOfUrl, storedFinding, storedGlossary, storedWeekdayCorrections, termId, type EditionName, type FindingKey,
} from "./world";
import { morningLeavesIt } from "./state";
import { ZH_TERM_TABLE, findingWithZh, termWithZh } from "./world-zh";
import { officialPageText, zhContextOf } from "./zh-inputs";

// ── The folders and constants ────────────────────────────────────────────────────────────────────

/** The sample content folder and the empty one, relative to the repo root (SPEC §3; both are folders the builder owns). */
export const SITE_DIR = "fixtures/site-content";
export const EMPTY_DIR = "fixtures/empty-content";
export const STATE_FILE = "fixtures/state/pace-weekly.json";

/** The day the Ledger seeded its entries: before the first edition of the week. */
export const SEEDED = "2026-10-09";
/** The code commit every sample run names: 40 lower-case hex characters, belonging to no repository. */
export const SAMPLE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const EMPTY_README = "# Empty content\n\nAn empty content folder for the site's empty states and the end-to-end tests. It holds only this file.\n";

// ── The plan, as a typed constant ────────────────────────────────────────────────────────────────

/** The finding id of each world finding, by its handle (`world-findings.ts`): the ids the sample's files carry. */
export const SAMPLE_FINDINGS: Readonly<Record<FindingKey, string>> = Object.fromEntries(FINDING_KEYS.map((k) => [k, findingId(k)])) as Record<FindingKey, string>;
const id = (k: FindingKey): string => SAMPLE_FINDINGS[k];

export type EditionKind = "full" | "data_only";

/** What one edition of the sample week shows and where: the plan table of the header, as data (checked against the stored briefs by `tests/fixtures-site.test.ts`). */
export interface SampleEdition {
  readonly date: string;
  readonly weekday: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  readonly format: Format;
  readonly edition: EditionKind;
  /** `languages.zh`: false only on the English-only Tuesday. */
  readonly languages: { readonly en: true; readonly zh: boolean };
  readonly dataOnly: boolean;
  readonly englishOnly: boolean;
  /** The finding ids each Lead sentence cites, in order. */
  readonly lead: readonly (readonly string[])[];
  readonly story: string | null;
  readonly items: readonly string[];
  /** The findings first briefed on this edition (`new: true`), story and items. */
  readonly newFindings: readonly string[];
  /** Existing findings shown with an `update` ("Back:"). */
  readonly returning: readonly string[];
  /** The rung changes ("Climbed or fell"): finding, from, to, by. */
  readonly rungChanges: readonly { readonly finding: string; readonly from: Rung; readonly to: Rung; readonly by: "script" | "agent" }[];
  readonly deepDive: string | null;
  /** A Monday review: its remarkable finding and the findings of its strongest evidence against, or null on other days. */
  readonly review: { readonly remarkable: string | null; readonly against: readonly string[]; readonly short: boolean } | null;
  readonly corrections: readonly string[];
  /** The reports the brief lists (decided that day). */
  readonly reports: readonly string[];
  readonly ideas: number;
  readonly also: number;
  /** The brief-level paths `mentionsAnthropic()` matched. */
  readonly disclosure: readonly string[];
  /** The ids of the findings whose Chinese the pass added from the backlog that day. */
  readonly backlog: readonly string[];
}

export const SAMPLE_DATES = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"] as const;

const NO_REVIEW = null;

export const SAMPLE_EDITIONS: readonly SampleEdition[] = [
  {
    date: "2026-10-12", weekday: "Monday", format: "monday_review", edition: "full", languages: { en: true, zh: true }, dataOnly: false, englishOnly: false,
    lead: [[id("weather")], [id("plasma")]], story: id("weather"), items: [id("plasma")], newFindings: [id("weather"), id("plasma")], returning: [], rungChanges: [],
    deepDive: null, review: { remarkable: null, against: [], short: true }, corrections: [], reports: [], ideas: 0, also: 0, disclosure: ["review"], backlog: [],
  },
  {
    date: "2026-10-13", weekday: "Tuesday", format: "daily", edition: "full", languages: { en: true, zh: false }, dataOnly: false, englishOnly: true,
    lead: [[id("tilings")], [id("catalyst")], [id("retractW0")]], story: id("tilings"), items: [id("catalyst"), id("retractW0"), id("survey")],
    newFindings: [id("tilings"), id("catalyst"), id("retractW0"), id("survey")], returning: [], rungChanges: [], deepDive: null, review: NO_REVIEW,
    corrections: [], reports: ["R-0001"], ideas: 0, also: 0, disclosure: [], backlog: [],
  },
  {
    date: "2026-10-14", weekday: "Wednesday", format: "daily", edition: "full", languages: { en: true, zh: true }, dataOnly: false, englishOnly: false,
    lead: [[id("scroll")], [id("protein")], [id("retractWD"), id("policy")]], story: id("scroll"), items: [id("protein"), id("retractWD"), id("erdos"), id("policy")],
    newFindings: [id("scroll"), id("protein"), id("retractWD"), id("erdos")], returning: [id("policy")],
    rungChanges: [{ finding: id("catalyst"), from: "checked", to: "confirmed", by: "agent" }], deepDive: null, review: NO_REVIEW,
    corrections: ["C-0001", "C-0002"], reports: ["R-0002"], ideas: 2, also: 2, disclosure: [],
    backlog: [id("tilings"), id("catalyst"), id("retractW0"), id("survey")].sort(compareFindingIds),
  },
  {
    date: "2026-10-15", weekday: "Thursday", format: "daily", edition: "data_only", languages: { en: true, zh: true }, dataOnly: true, englishOnly: false,
    lead: [], story: null, items: [], newFindings: [], returning: [], rungChanges: [{ finding: id("fellW0"), from: "checked", to: "retracted", by: "script" }],
    deepDive: null, review: NO_REVIEW, corrections: [], reports: [], ideas: 0, also: 0, disclosure: [], backlog: [],
  },
  {
    date: "2026-10-16", weekday: "Friday", format: "daily", edition: "full", languages: { en: true, zh: true }, dataOnly: false, englishOnly: false,
    lead: [[]], story: null, items: [], newFindings: [], returning: [], rungChanges: [{ finding: id("antibiotic"), from: "checked", to: "confirmed", by: "agent" }],
    deepDive: null, review: NO_REVIEW, corrections: [], reports: [], ideas: 0, also: 0, disclosure: [], backlog: [],
  },
  {
    date: "2026-10-17", weekday: "Saturday", format: "daily", edition: "full", languages: { en: true, zh: true }, dataOnly: false, englishOnly: false,
    lead: [[]], story: null, items: [], newFindings: [], returning: [], rungChanges: [], deepDive: null, review: NO_REVIEW,
    corrections: [], reports: [], ideas: 0, also: 2, disclosure: ["also.0"], backlog: [],
  },
  {
    date: "2026-10-18", weekday: "Sunday", format: "sunday_deep_dive", edition: "full", languages: { en: true, zh: true }, dataOnly: false, englishOnly: false,
    lead: [[id("translation")], [id("antibiotic")]], story: null, items: [id("translation")], newFindings: [id("translation")], returning: [], rungChanges: [],
    deepDive: id("antibiotic"), review: NO_REVIEW, corrections: [], reports: [], ideas: 0, also: 0, disclosure: [], backlog: [],
  },
];

/**
 * Named handles into the week for the loader's, the chat edition's and the site's tests: each date by what it is the example of, the
 * week's bounds, and the report and correction ids. A test finds "the Monday" or "the Sunday" here instead of counting on a weekday.
 */
export const SAMPLE_WEEK = {
  from: "2026-10-12",
  to: "2026-10-18",
  dates: SAMPLE_DATES,
  /** The Monday review in SPEC §4.5's short form: remarkable null, strongest evidence against NONE_FOUND, zero field counts, disclosure `review`. */
  mondayShort: "2026-10-12",
  /** The Sunday deep dive on the antibiotic finding, `why_today` news. */
  sundayDeepDive: "2026-10-18",
  /** The busiest daily: story, items, a returning finding, a rung change, two corrections, one report, two ideas, two Also noted lines, the Chinese backlog. */
  busiestDaily: "2026-10-14",
  /** A daily whose only report line comes from intake (JL's close). */
  reportsFromIntake: "2026-10-13",
  /** The data-only edition, with a script rung change. */
  dataOnly: "2026-10-15",
  /** A full edition with no finding (the Lead says so) and one agent rung change ("Climbed or fell"). */
  noFindings: "2026-10-16",
  /** A full edition with no finding whose two Also noted lines are all it lists; the first names Claude, so its disclosure lists `also.0`. */
  alsoDisclosure: "2026-10-17",
  /** The English-only edition (`languages.zh` false): four findings, none translated until Wednesday's backlog. */
  englishOnly: "2026-10-13",
  /** The reports and corrections of the week, and the four seeds (history entries). */
  reports: ["R-0001", "R-0002"],
  corrections: ["C-0001", "C-0002"],
  seeds: [id("disputedOld"), id("fellW0"), id("antibiotic"), id("policy")],
} as const;

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`site.ts: ${what}`);
  return value;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const clock = (date: string, hms: string): string => `${date}T${hms}+08:00`;
/** The seconds since midnight of an `HH:MM:SS` time, and an `HH:MM:SS` time that many seconds after midnight (a run stays inside one Taipei morning). */
const secondsOf = (hms: string): number => {
  const [h, m, s] = hms.split(":").map(Number) as [number, number, number];
  return h * 3600 + m * 60 + s;
};
const hmsOf = (seconds: number): string =>
  `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
/** An `HH:MM:SS` time moved by `seconds`. */
const after = (hms: string, seconds: number): string => hmsOf(secondsOf(hms) + seconds);
const dateOnly = (timestamp: string): string => timestamp.slice(0, 10);
const clone = <T>(v: T): T => structuredClone(v);
const idNum = (prefix: "C" | "R", n: number): string => `${prefix}-${String(n).padStart(4, "0")}`;

type BriefType = Brief;
type L10n = L10nSchema;
type FindingSourceRow = Finding["sources"][number];
type BriefSourceRow = BriefType["sources"][number];

/** How the run saw a source: the world's table by URL, else the sample's own extra sources. */
const EXTRA_SEEN = new Map<string, SeenAs>(SATURDAY_SOURCES.map((s) => [normalizeUrl(s.url), s.seen]));
function seenOfUrl(url: string): SeenAs {
  const key = sourceKeyOfUrl(url);
  if (key !== undefined) return SOURCE_TABLE[key].seen;
  return must(EXTRA_SEEN.get(normalizeUrl(url)), `no way the run saw ${url}`);
}

const l10nOf = (value: string | L10n | null): L10n | null => (value === null ? null : typeof value === "string" ? { en: value, zh: null } : value);

// ── Disclosure (SPEC §4.4) ───────────────────────────────────────────────────────────────────────

const ANTHROPIC_HOSTS: readonly string[] = (fixtureConfig().labs.labs.find((l) => l.id === "anthropic")?.hosts ?? []).map((h) => h.toLowerCase());

/** True when a URL is on a host of `labs.json`'s `anthropic` entry. */
function onAnthropicHost(url: string): boolean {
  try {
    return ANTHROPIC_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** `mentionsAnthropic()` of a source line (SPEC §4.4): its title, publisher and URL name Anthropic or Claude, or it is on an Anthropic host. */
const sourceMentions = (s: { readonly title: string; readonly publisher: string; readonly url: string }): boolean =>
  mentionsAnthropicText(s.title) || mentionsAnthropicText(s.publisher) || mentionsAnthropicText(s.url) || onAnthropicHost(s.url);

/**
 * `mentionsAnthropic()` of a finding (SPEC §4.4): any English string of it, an `ai.systems` entry whose maker is Anthropic, or a source
 * on an Anthropic host or naming the company. The library has no finding-level function yet (`lib/text.ts` has the one-string
 * `mentionsAnthropicText()`, and publish, P3, will own the rest), so the sample builds its own from the strings SPEC §4.4 lists; when
 * publish has it, this one becomes an import, and `tests/fixtures-site.test.ts` checks it on edited copies of a finding.
 */
export function findingMentionsAnthropic(f: Finding): boolean {
  const e = f.explainer;
  const strings = [
    f.title.en, e.found.en, e.matters.en, e.ai_helped?.en, e.how_sure.en, e.background.en, e.could_lead.en,
    ...f.ai.systems.flatMap((s) => [s.name, s.maker]), ...f.ai.evidence.map((x) => x.quote), ...f.reactions.flatMap((r) => [r.who, r.affiliation, r.quote]),
    ...f.rung_history.map((r) => r.note?.en), ...f.since_then.map((s) => s.text.en), f.figure?.alt.en, f.figure?.credit, f.figure?.licence_quote,
    ...f.who.map((w) => w.name),
  ];
  return strings.some((s) => mentionsAnthropicText(s)) || f.ai.systems.some((s) => /^anthropic$/i.test(s.maker.trim())) || f.sources.some(sourceMentions);
}

// ── The state publish works on ───────────────────────────────────────────────────────────────────

/** Everything stored before an edition: the records `publishDraft()` reads and writes. */
export interface SampleState {
  findings: Finding[];
  glossary: Term[];
  corrections: Correction[];
  reports: Report[];
  briefs: BriefType[];
}

/** The Chinese pass's result an edition is joined with: the strings by context key and the terms by id (`DraftZh`). */
export interface ZhPass {
  readonly strings: Readonly<Record<string, string>>;
  readonly terms: Readonly<Record<string, DraftZhTerm>>;
}

/** A script rung change (SPEC §5.8) with the notice source it adds to its finding. */
export interface ScriptInput {
  readonly change: ScriptChange;
  readonly source: { readonly kind: DraftSource["kind"]; readonly title: string; readonly publisher: string; readonly url: string; readonly doi: string | null; readonly published_at: DraftSource["published_at"] };
}

export interface PublishInput {
  /** A valid draft (`DraftBrief`), as validated. */
  readonly draft: DraftBrief;
  /** The records stored before this edition, with the reports intake brought in (JL's closes, new reports). */
  readonly state: SampleState;
  /** The Chinese draft joined by key, or null for an English-only edition (`languages.zh` false, every `zh` null). */
  readonly zh: ZhPass | null;
  /** The id publish gives each `new-N` ref. */
  readonly ids: Readonly<Record<string, string>>;
  /** The metrics file's Pace sentence and status for this date. */
  readonly pace: { readonly sentence: L10n; readonly status: "ok" | "stale" | "missing" };
  readonly publishedAt: string;
  readonly runId: string;
  /** Script rung changes the re-check applied before the draft, listed in the brief with the agent's. */
  readonly script?: readonly ScriptInput[];
}

export interface Published {
  /** The stored brief of the draft. */
  readonly brief: BriefType;
  /** The findings this edition wrote (new, returning, rung-changed, deep-dived, and those the backlog translated), as stored after it, in id order. */
  readonly written: Finding[];
  /** Every record stored after the edition. */
  readonly state: SampleState;
  /** The ids of the findings whose Chinese the backlog added. */
  readonly backlog: string[];
}

/** The ids of the findings a Chinese draft translates as backlog (its keys `backlog.<id>.*`), in id order. */
export function backlogIds(strings: Readonly<Record<string, string>>): string[] {
  const out = new Set<string>();
  for (const key of Object.keys(strings)) {
    const m = /^backlog\.([a-z]+-\d{4}-\d{4})\./.exec(key);
    if (m !== null) out.add(m[1]!);
  }
  return [...out].sort(compareFindingIds);
}

/** Dotted-path lookup of an `L10n` in a finding, as a correction names it. */
function l10nAt(f: Finding, path: string): L10n {
  let v: unknown = f;
  for (const seg of path.split(".")) v = (v as Record<string, unknown> | null | undefined)?.[seg];
  const r = L10nSchema.safeParse(v);
  if (!r.success) throw new Error(`site.ts: ${f.id} has no text at ${path}`);
  return r.data;
}

/** The week a Monday reviews, from stored records: the seven editions D - 7 to D - 1 (SPEC §4.5). Reads the findings as filed on `date`. */
export function weekFacts(findings: readonly Finding[], corrections: readonly Correction[], date: string): { field_counts: { field: FieldId; reported: number; counted: number }[]; fell: string[]; setbacks: string[]; findings: number } {
  const from = addDays(date, -7);
  const inWeek = (d: string): boolean => d >= from && d < date;
  const first = findings.filter((f) => !f.history && f.first_brief !== null && inWeek(f.first_brief));
  const filed = (f: Finding): Finding => filedAs(f, corrections, date);
  const fell = new Set<string>();
  for (const f of findings) {
    f.rung_history.forEach((r, i) => {
      if (i === 0 || r.by === "seed" || !inWeek(r.recorded) || r.recorded === f.first_brief) return;
      if (isFellRung(r.rung)) fell.add(f.id);
    });
  }
  return {
    field_counts: FIELDS.map((field) => {
      const mine = first.filter((f) => filed(f).field === field);
      return { field, reported: mine.length, counted: mine.filter((f) => filed(f).kind !== "setback" && isCountedRung(f.rung)).length };
    }),
    fell: [...fell].sort(compareFindingIds),
    setbacks: first.filter((f) => filed(f).kind === "setback").map((f) => f.id).sort(compareFindingIds),
    findings: findings.filter((f) => f.briefs.some(inWeek)).length,
  };
}

/**
 * Publish's `applyDraft()` (SPEC §8.7) as a pure function: the stored brief a valid draft becomes, and the records it writes. New findings
 * get their id, `depth`, `first_brief`, `briefs`, `terms`, `seen_as` and `added`; a returning finding gets its `since_then` note, its new
 * sources (ids continuing its list) and rung entry; a rung change adds the entry and its source; the Chinese draft's strings and terms
 * join their English by key and the backlog's join their stored findings and the glossary; corrections get `C-NNNN` and their `before`;
 * report decisions set status, reason, `decided_by`, `resolved_on` and `correction_id`; every finding written gets its `disclosure`; the
 * brief gets its S fields (format, languages, Pace, rung changes, reports, disclosure, status note, computed counts, provenance).
 * It does not check the draft: the caller has validated it. It throws for a correction on an edition's brief or a term, and for a
 * `removed` one, which the sample does not hold.
 */
export function publishDraft(input: PublishInput): Published {
  const { draft, zh } = input;
  const date = draft.date;
  const state = clone(input.state);
  const findings = new Map(state.findings.map((f) => [f.id, f]));
  const glossary = new Map(state.glossary.map((t) => [t.id, t]));
  const touched = new Set<string>();
  const changes: RungChange[] = [];

  const lt = (key: string, en: string): L10n => {
    if (zh === null) return { en, zh: null };
    if (en === NONE_FOUND.en) return { ...NONE_FOUND };
    if (en === REMOVED_TEXT.en) return { ...REMOVED_TEXT };
    return { en, zh: must(zh.strings[key], `the Chinese draft has no string ${key}`) };
  };
  const idOf = (ref: string): string => (ref.startsWith("new-") ? must(input.ids[ref], `no id for ${ref}`) : ref);
  const get = (fid: string): Finding => must(findings.get(fid), `no stored finding ${fid}`);
  const briefSource = (sid: string): DraftBrief["sources"][number] => must(draft.sources.find((s) => s.id === sid), `the draft has no source ${sid}`);

  /** The id, in the finding, of a source the draft cites by an `s` id of the finding or a `b` id of the brief (a brief source joins the finding as its next source). */
  const ownSource = (f: Finding, sid: string): string => {
    if (sid.startsWith("s")) {
      must(f.sources.find((s) => s.id === sid), `${f.id} has no source ${sid}`);
      return sid;
    }
    const b = briefSource(sid);
    const held = f.sources.find((s) => normalizeUrl(s.url) === normalizeUrl(b.url));
    if (held !== undefined) return held.id;
    const row: FindingSourceRow = { ...b, id: `s${f.sources.length + 1}`, seen_as: seenOfUrl(b.url), added: date };
    f.sources.push(row);
    return row.id;
  };

  const addRung = (f: Finding, r: DraftRung, key: string): void => {
    const from = f.rung;
    f.rung_history.push({
      rung: r.rung, date: r.date, recorded: date, source_id: ownSource(f, r.source_id), by: "agent", note: r.note === null ? null : lt(key, r.note),
    });
    f.rung = r.rung;
    changes.push({ finding_id: f.id, from, to: r.rung, date: r.date, by: "agent" });
  };

  const setTermZh = (t: Term): void => {
    const z = zh?.terms[t.id];
    if (z !== undefined && t.zh === null) t.zh = { term: z.zh, definition: z.definition, official: z.official, official_url: z.official_url };
  };

  // 1. The re-check's script rung changes (SPEC §5.8): the notice joins the finding as its next source, the entry is the script's.
  for (const s of input.script ?? []) {
    const f = get(s.change.finding_id);
    const sid = `s${f.sources.length + 1}`;
    f.sources.push({ ...s.source, id: sid, seen_as: seenOfUrl(s.source.url), added: date });
    f.rung_history.push(scriptRungEntry(s.change, sid, date));
    f.rung = s.change.to;
    changes.push(scriptRungChange(s.change));
    touched.add(f.id);
  }

  // 2. New findings.
  for (const nf of draft.new_findings) {
    const fid = idOf(nf.ref);
    const key = `new.${nf.ref}`;
    const f = Finding.parse({
      schema_version: 1,
      id: fid,
      field: nf.field,
      subfield: nf.subfield,
      kind: nf.kind,
      title: lt(`${key}.title`, nf.title),
      depth: draft.story === nf.ref ? "story" : "item",
      explainer: {
        found: lt(`${key}.explainer.found`, nf.explainer.found),
        matters: lt(`${key}.explainer.matters`, nf.explainer.matters),
        ai_helped: nf.explainer.ai_helped === null ? null : lt(`${key}.explainer.ai_helped`, nf.explainer.ai_helped),
        how_sure: lt(`${key}.explainer.how_sure`, nf.explainer.how_sure),
        background: lt(`${key}.explainer.background`, nf.explainer.background),
        could_lead: lt(`${key}.explainer.could_lead`, nf.explainer.could_lead),
      },
      go_deeper: nf.go_deeper,
      ai: nf.ai,
      significance: nf.significance,
      rung: nf.rung_history.at(-1)!.rung,
      rung_history: nf.rung_history.map((r, i) => ({
        rung: r.rung, date: r.date, recorded: date, source_id: r.source_id, by: "agent", note: r.note === null ? null : lt(`${key}.rung.${i}`, r.note),
      })),
      since_then: [],
      sources: nf.sources.map((s) => ({ ...s, seen_as: seenOfUrl(s.url), added: date })),
      reactions: nf.reactions,
      artefacts: nf.artefacts,
      figure: nf.figure === null ? null : { ...nf.figure, alt: lt(`${key}.figure.alt`, nf.figure.alt) },
      who: nf.who,
      terms: nf.terms.map((t) => (t.new ? termId(t.term) : t.id)),
      related: nf.related,
      first_published: nf.first_published,
      first_brief: date,
      briefs: [date],
      history: false,
      disclosure: false,
      applications: [],
      updated: date,
    });
    findings.set(fid, f);
    touched.add(fid);
    for (const t of nf.terms) {
      if (!t.new || glossary.has(termId(t.term))) continue;
      const term: Term = Term.parse({
        id: termId(t.term), en: { term: t.term, definition: t.definition }, zh: null, fields: [nf.field], first_finding: fid, first_date: date,
      });
      glossary.set(term.id, term);
    }
  }

  // 3. Returning findings (a new dated fact, a rung entry, its new sources) and the agent's rung changes on findings not shown.
  for (const r of draft.returning) {
    const f = get(r.finding_id);
    if (r.rung !== null) addRung(f, r.rung, `returning.${f.id}.rung`);
    f.since_then.push({ date, text: lt(`returning.${f.id}.update`, r.update), source_ids: r.source_ids.map((sid) => ownSource(f, sid)) });
    touched.add(f.id);
  }
  for (const c of draft.rung_changes) {
    const f = get(c.finding_id);
    addRung(f, c.rung, `rung.${f.id}`);
    touched.add(f.id);
  }

  // 4. The findings the brief shows (the story, the items, the deep dive) have this edition among their briefs.
  const shown = [...(draft.story === null ? [] : [draft.story]), ...draft.items].map(idOf);
  if (draft.deep_dive !== null) shown.push(draft.deep_dive.finding_id);
  for (const fid of new Set(shown)) {
    const f = get(fid);
    if (!f.briefs.includes(date)) f.briefs.push(date);
    f.first_brief = f.briefs[0]!;
    touched.add(fid);
  }

  // 5. The Chinese backlog: each untranslated finding the pass translated gets its Chinese by key, and its terms theirs.
  const backlog = zh === null ? [] : backlogIds(zh.strings);
  for (const bid of backlog) {
    const f = get(bid);
    const p = `backlog.${bid}`;
    const fill = (v: L10n, key: string): L10n => (v.zh !== null ? v : { en: v.en, zh: zh!.strings[key] ?? null });
    f.title = fill(f.title, `${p}.title`);
    const e = f.explainer;
    f.explainer = {
      found: fill(e.found, `${p}.explainer.found`),
      matters: fill(e.matters, `${p}.explainer.matters`),
      ai_helped: e.ai_helped === null ? null : fill(e.ai_helped, `${p}.explainer.ai_helped`),
      how_sure: fill(e.how_sure, `${p}.explainer.how_sure`),
      background: fill(e.background, `${p}.explainer.background`),
      could_lead: fill(e.could_lead, `${p}.explainer.could_lead`),
    };
    f.since_then = f.since_then.map((s, i) => ({ ...s, text: fill(s.text, `${p}.since.${i}`) }));
    f.rung_history = f.rung_history.map((r, i) => ({ ...r, note: r.note === null ? null : fill(r.note, `${p}.rung.${i}`) }));
    if (f.figure !== null) f.figure = { ...f.figure, alt: fill(f.figure.alt, `${p}.figure.alt`) };
    touched.add(bid);
  }
  for (const t of glossary.values()) setTermZh(t);

  // 6. Corrections: ids continue the sequence, `before` is the text just before (the latest earlier correction's `after`, else the stored text).
  const decisions = draft.report_decisions;
  const correctionIds = draft.corrections.map((_, i) => idNum("C", state.corrections.length + i + 1));
  const corrections = [...state.corrections];
  draft.corrections.forEach((c, i) => {
    if (c.finding_id === null || c.type === "removed") throw new Error("site.ts: the sample holds only corrections of a finding that are not removals");
    const f = get(c.finding_id);
    const earlier = corrections.filter((x) => x.finding_id === f.id && x.path === c.path).sort((a, b) => byCodeUnit(a.date, b.date) || byCodeUnit(a.id, b.id)).at(-1);
    const answers = c.report_id ?? decisions.find((d) => d.correction === i && d.outcome === "upheld")?.report_id ?? null;
    corrections.push(Correction.parse({
      id: correctionIds[i], date, finding_id: f.id, edition_date: null, term_id: null, type: c.type, path: c.path,
      before: clone(earlier?.after ?? l10nAt(f, c.path)), after: lt(`corrections.${i}.after`, c.after), reason: lt(`corrections.${i}.reason`, c.reason),
      source_url: c.source_url, trigger: answers === null ? "editor" : "reader_report", report_id: answers,
    }));
  });

  // 7. Reports: the agent's decisions, and the correction JL's upheld reports now have.
  const reports = state.reports.map((r) => clone(r));
  for (const d of decisions) {
    const r = must(reports.find((x) => x.id === d.report_id), `no report ${d.report_id}`);
    r.status = d.outcome;
    r.decided_by = "claude";
    r.resolved_on = date;
    r.reason = lt(`reports.${r.id}.reason`, d.reason);
    r.correction_id = d.correction === null ? null : must(correctionIds[d.correction], `no correction ${d.correction}`);
  }
  draft.corrections.forEach((c, i) => {
    if (c.report_id === null) return;
    const r = must(reports.find((x) => x.id === c.report_id), `no report ${c.report_id}`);
    r.correction_id = correctionIds[i]!;
  });
  const parsedReports = reports.map((r) => Report.parse(r));

  // 8. Every finding written gets its `updated` and its `disclosure`.
  for (const fid of touched) {
    const f = get(fid);
    f.updated = date;
    f.disclosure = findingMentionsAnthropic(f);
    Finding.parse(f);
  }

  // 9. The brief.
  const item = (ref: string): BriefType["items"][number] => {
    const fid = idOf(ref);
    if (ref.startsWith("new-")) return { finding_id: fid, new: true, update: null };
    const r = must(draft.returning.find((x) => x.finding_id === fid), `${fid} is shown without a returning entry`);
    return { finding_id: fid, new: false, update: lt(`returning.${fid}.update`, r.update) };
  };
  const briefSources: BriefSourceRow[] = draft.sources.map((s) => ({ ...s, id: s.id, seen_as: seenOfUrl(s.url), added: date }));
  const src = (sid: string): BriefSourceRow => must(briefSources.find((s) => s.id === sid), `no brief source ${sid}`);

  const ideas = draft.ideas.map((x, i) => ({ text: lt(`ideas.${i}`, x.text), who: x.who, source_id: x.source_id }));
  const also = draft.also.map((x, i) => ({ title: lt(`also.${i}`, x.title), field: x.field, source_id: x.source_id }));
  const deepDive = draft.deep_dive === null ? null : {
    finding_id: draft.deep_dive.finding_id, text: lt("deep_dive", draft.deep_dive.text), source_ids: [...draft.deep_dive.source_ids], why_today: draft.deep_dive.why_today,
  };
  let review: BriefType["review"] = null;
  if (draft.review !== null) {
    const w = weekFacts([...findings.values()], corrections, date);
    const r = draft.review;
    review = {
      big_picture: lt("review.big_picture", r.big_picture),
      remarkable: r.remarkable === null ? null : { finding_id: r.remarkable.finding_id, note: lt("review.remarkable", r.remarkable.note) },
      strongest_against: { text: lt("review.strongest_against", r.strongest_against.text), finding_ids: [...r.strongest_against.finding_ids], source_ids: [...r.strongest_against.source_ids] },
      field_counts: w.field_counts,
      fell: w.fell,
      setbacks: w.setbacks,
    };
  }

  const disclosure: string[] = [];
  const sourcesOf = (ids: readonly string[]): boolean => ids.some((sid) => sourceMentions(src(sid)));
  ideas.forEach((x, i) => {
    if (mentionsAnthropicText(x.text.en) || mentionsAnthropicText(x.who) || sourcesOf([x.source_id])) disclosure.push(`ideas.${i}`);
  });
  also.forEach((x, i) => {
    if (mentionsAnthropicText(x.title.en) || sourcesOf([x.source_id])) disclosure.push(`also.${i}`);
  });
  if (deepDive !== null && (mentionsAnthropicText(deepDive.text.en) || sourcesOf(deepDive.source_ids) || get(deepDive.finding_id).disclosure)) disclosure.push("deep_dive");
  if (review !== null) {
    const remarkable = review.remarkable;
    const hit = mentionsAnthropicText(review.big_picture.en) || mentionsAnthropicText(review.strongest_against.text.en) || sourcesOf(review.strongest_against.source_ids)
      || (remarkable !== null && (mentionsAnthropicText(remarkable.note.en) || get(remarkable.finding_id).disclosure));
    if (hit) disclosure.push("review");
  }

  const rungChanges = [...changes].sort((a, b) => byCodeUnit(b.date, a.date));
  const story = draft.story === null ? null : item(draft.story);
  const items = draft.items.map(item);
  const lead = draft.lead.map((x, i) => ({ text: lt(`lead.${i}`, x.text), finding_ids: x.refs.map(idOf) }));

  // computed: the English words and Chinese characters of the page's model prose (SPEC §4.12 WORDS' page total), the findings shown, the sources cited.
  const proseParts = (): L10n[] => {
    const parts: L10n[] = [...lead.map((x) => x.text), ...[story, ...items].flatMap((x) => (x?.update ? [x.update] : [])), ...ideas.map((x) => x.text), ...also.map((x) => x.title)];
    if (deepDive !== null) parts.push(deepDive.text);
    if (review !== null) parts.push(review.big_picture, review.strongest_against.text, ...(review.remarkable === null ? [] : [review.remarkable.note]));
    for (const nf of draft.new_findings) {
      const f = get(idOf(nf.ref));
      const e = f.explainer;
      parts.push(f.title, e.found, e.matters, ...(e.ai_helped === null ? [] : [e.ai_helped]), e.how_sure);
      if (f.depth === "story") parts.push(e.background, e.could_lead);
    }
    return parts;
  };
  const wordTotal = proseParts().reduce((n, v) => n + countWords(v.en), 0);
  const charTotal = proseParts().reduce((n, v) => n + countZhChars(v.zh ?? ""), 0);
  const newSources = draft.new_findings.reduce((n, nf) => n + nf.sources.length, 0);
  const englishOnly = zh === null;
  const brief = Brief.parse({
    schema_version: 1,
    date,
    edition: "full",
    format: formatForWeekday(weekday(date)),
    languages: { en: true, zh: !englishOnly },
    published_at: input.publishedAt,
    late: false,
    pace: { sentence: input.pace.sentence, status: input.pace.status, metrics_file: `metrics/${date}.json` },
    lead,
    story,
    items,
    rung_changes: rungChanges,
    ideas,
    also,
    deep_dive: deepDive,
    review,
    corrections: draft.corrections.map((c, i) => {
      const stored = corrections.find((x) => x.id === correctionIds[i])!;
      return { id: stored.id, finding_id: stored.finding_id, edition_date: stored.edition_date, term_id: stored.term_id, type: stored.type, reason: stored.reason };
    }),
    reports: parsedReports.filter((r) => r.resolved_on === date).sort((a, b) => byCodeUnit(a.id, b.id)).map((r) => ({ id: r.id, finding_id: r.finding_id, status: r.status })),
    sources: briefSources,
    disclosure,
    status_note: statusNote({ edition: "full", englishOnly, feeds: [] }),
    computed: {
      word_count: wordTotal,
      zh_chars: englishOnly ? null : charTotal,
      finding_count: (story === null ? 0 : 1) + items.length,
      source_count: draft.sources.length + newSources,
    },
    provenance: { run_id: input.runId, code_commit: SAMPLE_COMMIT, data_cutoff: lastSunday(dataCutoffFor(date)) },
  });

  const after: SampleState = {
    findings: [...findings.values()].sort((a, b) => compareFindingIds(a.id, b.id)),
    glossary: [...glossary.values()].sort((a, b) => byCodeUnit(a.id, b.id)),
    corrections,
    reports: parsedReports,
    briefs: [...state.briefs, brief],
  };
  return { brief, written: [...touched].sort(compareFindingIds).map((fid) => must(findings.get(fid), fid)), state: after, backlog };
}

/** The stored brief of a valid draft, as `publishDraft()` writes it (the function the chat edition's and the site's tests call to build a brief of their own). */
export const storedBriefOfDraft = (input: PublishInput): BriefType => publishDraft(input).brief;

/**
 * The data-only edition the script composes (SPEC §8.2 stage 5): the Pace, the script's rung changes, the reports intake decided and the
 * data-only notice, with everything else empty. `languages.zh` is true unless a finding it names has a null `title.zh` (LANG_PARITY).
 */
export function publishDataOnly(input: Omit<PublishInput, "draft" | "ids" | "zh"> & { readonly date: string }): Published {
  const { date } = input;
  const state = clone(input.state);
  const findings = new Map(state.findings.map((f) => [f.id, f]));
  const changes: RungChange[] = [];
  const touched = new Set<string>();
  for (const s of input.script ?? []) {
    const f = must(findings.get(s.change.finding_id), `no stored finding ${s.change.finding_id}`);
    const sid = `s${f.sources.length + 1}`;
    f.sources.push({ ...s.source, id: sid, seen_as: seenOfUrl(s.source.url), added: date });
    f.rung_history.push(scriptRungEntry(s.change, sid, date));
    f.rung = s.change.to;
    f.updated = date;
    f.disclosure = findingMentionsAnthropic(f);
    Finding.parse(f);
    changes.push(scriptRungChange(s.change));
    touched.add(f.id);
  }
  const named = changes.map((c) => must(findings.get(c.finding_id), c.finding_id));
  const zhOk = named.every((f) => f.title.zh !== null);
  const brief = Brief.parse({
    schema_version: 1, date, edition: "data_only", format: formatForWeekday(weekday(date)), languages: { en: true, zh: zhOk },
    published_at: input.publishedAt, late: false,
    pace: { sentence: input.pace.sentence, status: input.pace.status, metrics_file: `metrics/${date}.json` },
    lead: [], story: null, items: [], rung_changes: [...changes].sort((a, b) => byCodeUnit(b.date, a.date)), ideas: [], also: [], deep_dive: null, review: null,
    corrections: [],
    reports: state.reports.filter((r) => r.resolved_on === date).sort((a, b) => byCodeUnit(a.id, b.id)).map((r) => ({ id: r.id, finding_id: r.finding_id, status: r.status })),
    sources: [], disclosure: [], status_note: statusNote({ edition: "data_only", englishOnly: false, feeds: [] }),
    computed: { word_count: 0, zh_chars: zhOk ? 0 : null, finding_count: 0, source_count: 0 },
    provenance: { run_id: input.runId, code_commit: SAMPLE_COMMIT, data_cutoff: lastSunday(dataCutoffFor(date)) },
  });
  return {
    brief,
    written: [...touched].sort(compareFindingIds).map((fid) => must(findings.get(fid), fid)),
    state: { ...state, findings: [...findings.values()].sort((a, b) => compareFindingIds(a.id, b.id)), briefs: [...state.briefs, brief] },
    backlog: [],
  };
}

// ── The Chinese pass (SPEC §4.6) ─────────────────────────────────────────────────────────────────

export interface ZhPassFiles {
  readonly context: ZhContext;
  readonly draft: DraftZh;
  readonly evidence: Evidence;
}

const stamp = (ms: number): string => `${new Date(ms + 8 * 3_600_000).toISOString().slice(0, 19)}+08:00`;

/**
 * The Chinese pass's clock, as the world's is (`ZH_CLOCK` in `zh-inputs.ts`), from the English draft's own `generated_at`: stage 8 builds the
 * context two minutes after it (the English draft has validated), the context's deadline is `zh_minutes` (12) after that, and the Chinese
 * draft is written nine minutes after the context. The run's stage times (`morningOf()`) are read from the same instants.
 */
export function zhClockOf(draft: DraftBrief): { readonly contextAt: number; readonly deadline: string; readonly generatedAt: string } {
  const contextAt = Date.parse(draft.generated_at) + 2 * 60_000;
  return { contextAt, deadline: stamp(contextAt + fixtureConfig().run.budgets.zh_minutes * 60_000), generatedAt: stamp(contextAt + 9 * 60_000) };
}

/**
 * The Chinese pass's context of an edition over the records stored before it (`zhContextOf()`, SPEC §4.6): every English string it shows,
 * the backlog's, the terms and the fixed translations, with the pass's clock (`zhClockOf()`).
 */
export function zhContextFor(draft: DraftBrief, state: SampleState): ZhContext {
  return zhContextOf({
    draft,
    stored: state.findings,
    glossary: { schema_version: 1, terms: state.glossary },
    reports: state.reports.map((r) => ({ id: r.id, finding_id: r.finding_id })),
    weekFindings: draft.review === null ? null : weekFacts(state.findings, state.corrections, draft.date).findings,
    config: fixtureConfig(),
    deadline: zhClockOf(draft).deadline,
  });
}

/**
 * The Chinese pass of an edition over the records stored before it: its context, its Chinese draft (each string the table of the world
 * and of `site-text.ts` gives, each new term its table entry) and its evidence (an invented 樂詞網 page for each term whose entry the
 * pass found). The draft is written nine minutes after the context (`zhClockOf()`).
 */
export function zhPassOf(draft: DraftBrief, state: SampleState): ZhPassFiles {
  const date = draft.date;
  const context = zhContextFor(draft, state);
  const strings = Object.fromEntries(context.strings.map((s) => [s.key, zhOf(s.en)]));
  const terms = Object.fromEntries(context.terms.filter((t) => t.zh === null).map((t) => {
    const record = must(ZH_TERM_TABLE[t.id], `no Chinese for the term ${t.id}`);
    return [t.id, { zh: record.zh, definition: zhOf(t.definition), official: record.official, official_url: record.official_url }];
  }));
  const zhDraft = DraftZh.parse({ schema_version: 1, date, generated_at: zhClockOf(draft).generatedAt, strings, terms });
  const urls: string[] = [];
  const texts: Record<string, string> = {};
  const seen: Record<string, "fetched"> = {};
  for (const t of context.terms) {
    if (t.zh !== null) continue;
    const record = ZH_TERM_TABLE[t.id];
    if (record === undefined || record.official === null || record.official_url === null) continue;
    const key = normalizeUrl(record.official_url);
    if (key in texts) continue;
    urls.push(record.official_url);
    texts[key] = officialPageText(t.en, record.official);
    seen[key] = "fetched";
  }
  const evidence = Evidence.parse({ urls, fetched: [...urls], texts, seen_as: seen, types: {}, resolved: {} });
  return { context, draft: zhDraft, evidence };
}

// ── The seeds ────────────────────────────────────────────────────────────────────────────────────

/**
 * A history entry as `ledger-seed.ts` writes it (SPEC §8.13): the world's finding as stored at the cut-off before its later events, with
 * its Chinese, no brief (`first_brief` null, `briefs` []), rung entries by "seed", sources seen as "seed", and `seeded` as every `added`,
 * `recorded` and `updated`.
 */
function seedOf(key: FindingKey, before?: string): Finding {
  const f = storedFinding(key, before);
  const seeded = Finding.parse({
    ...f,
    rung_history: f.rung_history.map((r) => ({ ...r, recorded: SEEDED, by: "seed" })),
    sources: f.sources.map((s) => ({ ...s, seen_as: "seed", added: SEEDED })),
    first_brief: null,
    briefs: [],
    history: true,
    updated: SEEDED,
  });
  return Finding.parse(findingWithZh(seeded));
}

/** The seeds of the sample: the world's findings as the Ledger would hold them on `SEEDED`, with the world's cut for each (what a later event is not yet in). */
export const SEED_KEYS = ["disputedOld", "fellW0", "antibiotic", "policy"] as const satisfies readonly FindingKey[];
const SEED_CUT: Readonly<Record<(typeof SEED_KEYS)[number], string | undefined>> = {
  disputedOld: undefined, fellW0: "2026-10-09", antibiotic: "2026-10-16", policy: "2026-10-14",
};

function seedState(): SampleState {
  const findings = SEED_KEYS.map((k) => seedOf(k, SEED_CUT[k]));
  const terms = SEED_KEYS.flatMap((k) => FINDING_TABLE[k].terms.map((t) => termWithZh(Term.parse({
    id: termId(t.term), en: { term: t.term, definition: t.definition }, zh: null, fields: [FINDING_TABLE[k].field], first_finding: id(k), first_date: SEEDED,
  }))));
  return { findings: findings.sort((a, b) => compareFindingIds(a.id, b.id)), glossary: terms.sort((a, b) => byCodeUnit(a.id, b.id)), corrections: [], reports: [], briefs: [] };
}

// ── The hand-built drafts (Monday, Tuesday, Friday, Saturday) ───────────────────────────────────

function baseDraft(date: string, generated: string) {
  return {
    schema_version: 1 as const, date, generated_at: clock(date, generated), lead: [], story: null, items: [], new_findings: [], returning: [], rung_changes: [],
    ideas: [], also: [], deep_dive: null, review: null, corrections: [], report_decisions: [], sources: [],
  };
}

function mondayDraft(): DraftBrief {
  return DraftBrief.parse({
    ...baseDraft("2026-10-12", "03:44:52"),
    lead: [{ text: MONDAY_LEAD[0], refs: ["new-1"] }, { text: MONDAY_LEAD[1], refs: ["new-2"] }],
    story: "new-1",
    items: ["new-2"],
    new_findings: [draftFinding("weather", "new-1"), draftFinding("plasma", "new-2")],
    review: { big_picture: MONDAY_BIG_PICTURE, remarkable: null, strongest_against: { text: NONE_FOUND.en, finding_ids: [], source_ids: [] } },
  });
}

function tuesdayDraft(): DraftBrief {
  return DraftBrief.parse({
    ...baseDraft("2026-10-13", "03:40:11"),
    lead: TUESDAY_LEAD.map((text, i) => ({ text, refs: [`new-${i + 1}`] })),
    story: "new-1",
    items: ["new-2", "new-3", "new-4"],
    new_findings: [draftFinding("tilings", "new-1"), draftFinding("catalyst", "new-2"), draftFinding("retractW0", "new-3"), draftFinding("survey", "new-4")],
  });
}

function fridayDraft(): DraftBrief {
  const entry = rungEntryOf("antibiotic", "confirmed", "2026-10-16");
  const note = typeof entry.note === "string" || entry.note === null ? entry.note : entry.note.en;
  return DraftBrief.parse({
    ...baseDraft("2026-10-16", "03:38:30"),
    lead: [{ text: FRIDAY_LEAD, refs: [] }],
    rung_changes: [{ finding_id: id("antibiotic"), rung: { rung: entry.rung, date: entry.date, source_id: "b1", note } }],
    sources: draftSources(["antibiotic-second"], "b"),
  });
}

function saturdayDraft(): DraftBrief {
  return DraftBrief.parse({
    ...baseDraft("2026-10-17", "03:39:05"),
    lead: [{ text: SATURDAY_LEAD, refs: [] }],
    also: SATURDAY_ALSO.map((a, i) => ({ title: a.title, field: a.field, source_id: `b${i + 1}` })),
    sources: SATURDAY_SOURCES.map((s, i) => ({ id: `b${i + 1}`, kind: s.kind, title: s.title, publisher: s.publisher, url: s.url, doi: s.doi, published_at: s.published_at })),
  });
}

// ── The metrics, the manifest and the Pace state ─────────────────────────────────────────────────

const OPENALEX = "https://api.openalex.org/works";

/** The group-by request URL for a week (SPEC §5.1), without a key or an e-mail address. */
function openAlexUrl(request: "leading_total" | "leading_ai" | "all_total" | "all_ai", monday: string): string {
  const c = fixtureConfig();
  const journals = c.journals.journals.filter((j) => j.in_pace).map((j) => j.openalex_source).join("|");
  const terms = c.aiTerms.phrases.filter((p) => p.in_pace).map((p) => `"${p.phrase}"`).join(" OR ");
  const parts = [`from_publication_date:${monday}`, `to_publication_date:${addDays(monday, 6)}`, "type:article", "has_abstract:true"];
  if (request.startsWith("leading")) parts.push(`primary_location.source.id:${journals}`);
  if (request.endsWith("_ai")) parts.push(`title_and_abstract.search:${encodeURIComponent(terms)}`);
  return `${OPENALEX}?filter=${parts.join(",")}&group_by=primary_topic.field.id`;
}

/**
 * The inputs manifest of a metrics file (SPEC §4.7): every OpenAlex request of the weeks the morning fetched (the provisional weeks and the
 * newest firm one), each with the group counts it gave for our fields, the counters' requests and values, and the ids C and D counted.
 */
function manifestOf(date: string, metrics: MetricsFile, state: SampleState): InputsManifest {
  const c = fixtureConfig();
  const weeks = paceWeeks(metrics.data_cutoff, date);
  const newestFirm = weeks.filter((w) => !w.provisional).at(-1);
  const fetched = weeks.filter((w) => w.provisional || w === newestFirm);
  // The metrics stage runs from 03:16:40 to 03:17:40 (`morningOf()`): one request a second from 03:16:42, the OpenAlex requests (36) first and then
  // the counters' (SPEC §5.7: fetched on Mondays only). On any other day a counter is carried from the Monday's reading with its own `as_of`, so
  // its request is the Monday's, at the Monday's time and with the Monday's hash: the manifest still names the answer the figure came from.
  const at = (day: string, n: number): string => clock(day, after("03:16:42", n));
  const monday = isoWeekStart(date);
  const openalex = fetched.flatMap((w: PaceWeek, wi) => (["leading_total", "leading_ai", "all_total", "all_ai"] as const).map((request, ri) => {
    const set = request.startsWith("leading") ? w.leading : w.all;
    const counts = Object.fromEntries(FIELDS.map((f) => [f, request.endsWith("_ai") ? set[f][0] : set[f][1]]));
    const url = openAlexUrl(request, w.week_start);
    return {
      request, week_start: w.week_start, url, fetched_at: at(date, wi * 4 + ri), sha256: sha256Hex(`${url}\n${JSON.stringify(counts)}`), counts,
      excluded_n: (wi + ri) % 3, unmapped_n: (wi * 2 + ri) % 4,
    };
  }));
  const corrections = state.corrections;
  const { ids } = landmarkCounts(state.findings, corrections, date);
  const hold = holdRate(state.findings, corrections, date, { min_cases: c.run.pace.min_cases, hold_after_days: c.run.pace.hold_after_days });
  return InputsManifest.parse({
    schema_version: 1,
    date,
    computed_at: metrics.computed_at,
    data_cutoff: metrics.data_cutoff,
    versions: metrics.versions,
    openalex,
    counters: metrics.counters.map((r, i) => ({
      id: r.id,
      requests: r.kind === "api" && r.status === "ok" ? [{ url: r.source_url, fetched_at: at(monday, openalex.length + i), sha256: sha256Hex(`${r.source_url}\n${r.value}`) }] : [],
      value: r.value,
    })),
    landmark_ids: ids,
    hold_case_ids: hold.case_ids,
  });
}

// ── The status of a run (SPEC §4.8) ──────────────────────────────────────────────────────────────

interface RunFacts {
  readonly index: number;
  readonly date: string;
  readonly brief: BriefType;
  /** The stage windows of the run (`morningOf()`). */
  readonly morning: Morning;
  /** The number of URLs first cited that day, for the link check. */
  readonly newUrls: number;
  readonly zhRecord: { attempted: boolean; repair_rounds: number; strings: number; backlog: number; outcome: "ok" | "failed" | "not_run" };
  readonly reportsNew: number;
  readonly scriptChanges: number;
  /** The rung proposals the re-check sent to the agent's context. */
  readonly proposals: number;
  readonly findingsChecked: number;
}

const STAGE_IDS = ["preflight", "collect", "metrics", "recheck", "data_only", "draft", "validate", "zh", "publish", "deploy", "links"] as const;
type StageId = (typeof STAGE_IDS)[number];

/** One stage's start and end, `HH:MM:SS` Taipei. */
type Window = readonly [string, string];

/** The clock of one run (SPEC §8.2): every stage's window (null when it did not run), the agent's seconds, and the run's end. */
export interface Morning {
  readonly started: string;
  readonly stages: Readonly<Record<StageId, Window | null>>;
  readonly finished: string;
  /** The English agent's seconds, its repair rounds included. */
  readonly agentSeconds: number;
  readonly zhAgentSeconds: number;
  /** The English repair rounds (the Chinese pass's repair is `zh.repair_rounds`). */
  readonly repairRounds: number;
}

/**
 * How a morning went: `full` (both languages), `english_only` (the Chinese pass ran to its deadline and failed, `E_ZH`, and the English
 * edition went out alone) or `failed_validation` (the draft failed `validateDraft()` after both repairs, `E_VALIDATION`: the data-only
 * edition stands, and nothing of the full one is published).
 */
export type MorningKind = "full" | "english_only" | "failed_validation";

/** The Taipei start time of the run of the `index`th edition of the week (the task starts within a minute of 03:15, SPEC §8.2). */
function startOf(index: number): string {
  return after("03:15:00", 2 + 3 * index);
}

/** The run id of the `index`th edition: `YYYYMMDD-HHMMSS`, the Taipei start time (SPEC §4.8), so it always agrees with the run record's `started_at`. */
function runIdOf(date: string, index: number): string {
  return `${date.replaceAll("-", "")}-${startOf(index).replaceAll(":", "")}`;
}

/**
 * The stage windows of a run, from the clock rules of SPEC §8.2 and, for a morning with a draft, the English draft's own `generated_at`
 * (`generated`, `HH:MM:SS`), so the run record, the Chinese pass's files (`zhClockOf()`) and the brief's `published_at` tell one story.
 * The early stages are the same every morning: preflight, collect, metrics (03:16:40 to 03:17:40, where `manifestOf()` puts its requests),
 * the re-check and the data-only edition at 03:19:50. Each later stage starts when the one before it ends.
 */
export function morningOf(index: number, kind: MorningKind, generated: string | null): Morning {
  const started = startOf(index);
  const early = {
    preflight: [started, "03:15:25"], collect: ["03:15:25", "03:16:40"], metrics: ["03:16:40", "03:17:40"], recheck: ["03:17:40", "03:19:05"],
    data_only: ["03:19:05", "03:19:50"],
  } as const satisfies Partial<Record<StageId, Window>>;
  const agentStarted = "03:19:52";
  if (kind === "failed_validation") {
    // Attempt 1 has min(30 min, zhStartBy - now - 2 x 6 min - 4 min) = 29 min 10 s from 03:19:50 and the agent uses 28 min 15 s of it. The first
    // check and its snapshot round take 1 min 40 s and each of the two repair rounds 5 min 20 s (5 min of the agent and a re-check). The retry
    // cutoff (03:50) has passed, so there is no second attempt: E_VALIDATION, the data-only edition stands, and the deploy wait and the link check
    // run on it (the Cyber sample's order).
    const draftEnd = "03:48:05";
    const validateEnd = after(draftEnd, 100 + 2 * 320);
    const deployEnd = after(validateEnd, 12);
    const linksEnd = after(deployEnd, 35);
    return {
      started,
      stages: { ...early, draft: ["03:19:50", draftEnd], validate: [draftEnd, validateEnd], zh: null, publish: null, deploy: [validateEnd, deployEnd], links: [deployEnd, linksEnd] },
      finished: after(linksEnd, 10),
      agentSeconds: secondsOf(draftEnd) - secondsOf(agentStarted) + 2 * 300,
      zhAgentSeconds: 0,
      repairRounds: 2,
    };
  }
  if (generated === null) throw new Error("site.ts: a morning with a draft needs the draft's time");
  const zhMinutes = fixtureConfig().run.budgets.zh_minutes;
  const draftEnd = after(generated, 4);
  const zhStart = after(generated, 120);
  const zhEnd = kind === "english_only" ? after(zhStart, zhMinutes * 60) : after(generated, 11 * 60 + 25);
  const publishEnd = after(zhEnd, 36 + 3 * index);
  const deployEnd = after(publishEnd, 120);
  const linksEnd = after(deployEnd, 140);
  return {
    started,
    stages: { ...early, draft: ["03:19:50", draftEnd], validate: [draftEnd, zhStart], zh: [zhStart, zhEnd], publish: [zhEnd, publishEnd], deploy: [publishEnd, deployEnd], links: [deployEnd, linksEnd] },
    finished: after(linksEnd, 10),
    agentSeconds: secondsOf(generated) - secondsOf(agentStarted),
    zhAgentSeconds: kind === "english_only" ? zhMinutes * 60 : 9 * 60,
    repairRounds: 0,
  };
}

function runOf(f: RunFacts): RunRecord {
  const { date, brief, index, morning } = f;
  const dataOnly = brief.edition === "data_only";
  const englishOnly = !brief.languages.zh && !dataOnly;
  const t = (hms: string): string => clock(date, hms);
  const status = (id: StageId): "ok" | "failed" | "skipped" => {
    if (morning.stages[id] === null) return "skipped";
    if (id === "validate" && dataOnly) return "failed";
    if (id === "zh" && englishOnly) return "failed";
    return "ok";
  };
  const feeds = fixtureConfig().sources.feeds.map((feed, i) => ({
    id: feed.id, status: "ok" as const, newest: clock(addDays(date, -1), `${String(20 + ((i + index) % 4)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00`),
    checked_at: t("03:15:40"), stale_since: null, records: ((i * 5 + index * 3) % 14) + 1, note: null,
  }));
  const deployEnd = t(must(morning.stages.deploy, "a run's deploy stage")[1]);
  const linksEnd = t(must(morning.stages.links, "a run's links stage")[1]);
  return {
    run_id: brief.provenance.run_id,
    trigger: "schedule",
    attempt: 1,
    started_at: t(morning.started),
    finished_at: t(morning.finished),
    outcome: dataOnly ? "published_data_only" : "published_full",
    edition: brief.edition,
    error_code: dataOnly ? "E_VALIDATION" : englishOnly ? "E_ZH" : null,
    code_commit: SAMPLE_COMMIT,
    pace_status: "ok",
    data_only_published_at: t("03:19:50"),
    full_published_at: dataOnly ? null : brief.published_at,
    late: false,
    stages: STAGE_IDS.map((sid) => {
      const w = morning.stages[sid];
      return { id: sid, status: status(sid), started_at: w === null ? null : t(w[0]), ended_at: w === null ? null : t(w[1]), note: null };
    }),
    feeds,
    budgets: {
      agent_seconds: morning.agentSeconds, zh_agent_seconds: morning.zhAgentSeconds, web_fetches: 22 + index, web_searches: 6 + (index % 3),
      repair_rounds: morning.repairRounds, tokens_in: null, tokens_out: null, usage: null, safety_stops: 0,
    },
    candidates: { ranked: 40, kept: 16 + index, deep_read: 8 + (index % 4) },
    validation: dataOnly ? { errors: 2, warnings: 0, codes: ["WORDS", "QUOTE_VERBATIM"] } : { errors: 0, warnings: 0, codes: [] },
    soft_gates: dataOnly ? null : { checked: 3, dropped: 0, by_code: {} },
    zh: f.zhRecord,
    deploy: { triggered: true, ready_at: deployEnd, shows_date: date, shows_edition: brief.edition },
    recheck: { findings_checked: f.findingsChecked, rung_changes: f.scriptChanges, proposals: f.proposals, reports_new: f.reportsNew, reports_decided: brief.reports.length, flagged: [] },
    links: { checked_at: linksEnd, checked: f.newUrls, ok: f.newUrls, unknown: 0, broken: [] },
  };
}

// ── The sample, built ────────────────────────────────────────────────────────────────────────────

/** One edition of the built sample: its stored records and the pass and run records that made them. */
export interface SampleDay {
  readonly date: string;
  readonly brief: BriefType;
  readonly metrics: MetricsFile;
  readonly inputs: InputsManifest;
  readonly status: StatusFile;
  /** The Chinese pass's files, or null for the data-only day and the English-only day (whose pass failed: its files are not kept). */
  readonly zh: ZhPassFiles | null;
  /** The ids of the findings written, in id order. */
  readonly written: readonly string[];
  /** The ids of the findings the backlog translated. */
  readonly backlog: readonly string[];
  /** The records stored just before the edition, with the day's report intake applied: what `zhContextFor()` and `publishDraft()` were given. */
  readonly before: SampleState;
  /** The id publish gave each `new-N` ref of the draft. */
  readonly ids: Readonly<Record<string, string>>;
  /** The script rung changes the re-check applied before the draft (the data-only day's, with its notice). */
  readonly script: readonly ScriptInput[];
}

export interface Sample {
  readonly days: readonly SampleDay[];
  /** Every record stored after the week. */
  readonly state: SampleState;
  readonly archive: ArchiveIndex;
  readonly pace: PaceWeeklyFile;
  /** The drafts the days were published from (the hand-built ones and the world's own), by date; null for the data-only day. */
  readonly drafts: Readonly<Record<string, DraftBrief | null>>;
}

/** The report intake brings in on each date: R-0001 (closed by JL as upheld at the intake of the 13th) and R-0002 (new on the 14th). */
function intakeOn(date: string): Report[] {
  const [one, two] = reportsBeforeWeekday() as [Report, Report];
  if (date === "2026-10-13") return [one];
  if (date === "2026-10-14") return [two];
  return [];
}

const WORLD_IDS = (name: EditionName): Record<string, string> => Object.fromEntries(PLANS[name].newFindings.map((k) => [refOf(name, k), id(k)]));

function ordered<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => byCodeUnit(a.id, b.id));
}

let SAMPLE: Sample | undefined;

/** The whole sample week, built once (a deep copy is not made: do not change it). */
export function buildSample(): Sample {
  if (SAMPLE !== undefined) return SAMPLE;
  let state = seedState();
  const days: SampleDay[] = [];
  const drafts: Record<string, DraftBrief | null> = {};
  const fellNotice = SOURCE_TABLE["fell-notice"];
  const fellChange: ScriptChange = {
    finding_id: id("fellW0"), kind: "retraction", from: "checked", to: "retracted", date: "2026-10-08", doi: must(fellNotice.doi, "fell-notice DOI"),
    title: fellNotice.title, publisher: fellNotice.publisher, note: retractionNote("Sample Physics Letters", "2026-10-08"),
  };
  const plans: { date: string; draft: (() => DraftBrief) | null; ids: Record<string, string>; zh: boolean }[] = [
    { date: "2026-10-12", draft: mondayDraft, ids: { "new-1": id("weather"), "new-2": id("plasma") }, zh: true },
    { date: "2026-10-13", draft: tuesdayDraft, ids: { "new-1": id("tilings"), "new-2": id("catalyst"), "new-3": id("retractW0"), "new-4": id("survey") }, zh: false },
    { date: "2026-10-14", draft: () => editionDraft("weekday"), ids: WORLD_IDS("weekday"), zh: true },
    { date: "2026-10-15", draft: null, ids: {}, zh: true },
    { date: "2026-10-16", draft: fridayDraft, ids: {}, zh: true },
    { date: "2026-10-17", draft: saturdayDraft, ids: {}, zh: true },
    { date: "2026-10-18", draft: () => editionDraft("sunday"), ids: WORLD_IDS("sunday"), zh: true },
  ];
  const seenUrls = new Set<string>();
  const urlsBefore = new Set<string>(state.findings.flatMap((f) => f.sources.map((s) => normalizeUrl(s.url))));
  urlsBefore.forEach((u) => seenUrls.add(u));

  plans.forEach((plan, index) => {
    const date = plan.date;
    const metrics = metricsFor(date, { findings: state.findings, corrections: state.corrections });
    const inputs = manifestOf(date, metrics, state);
    const intake = intakeOn(date);
    state = { ...state, reports: [...state.reports.filter((r) => !intake.some((i) => i.id === r.id)), ...clone(intake)].sort((a, b) => byCodeUnit(a.id, b.id)) };
    const before = clone(state);
    const pace = { sentence: metrics.pace.sentence, status: metrics.status };
    const runId = runIdOf(date, index);
    const script = date === "2026-10-15"
      ? [{ change: fellChange, source: { kind: fellNotice.kind, title: fellNotice.title, publisher: fellNotice.publisher, url: fellNotice.url, doi: fellNotice.doi, published_at: fellNotice.published_at } }]
      : [];

    let published: Published;
    let morning: Morning;
    let zhFiles: ZhPassFiles | null = null;
    let passStrings = 0;
    let draft: DraftBrief | null = null;
    if (plan.draft === null) {
      morning = morningOf(index, "failed_validation", null);
      published = publishDataOnly({ date, state, pace, publishedAt: clock(date, "03:19:50"), runId, script });
    } else {
      draft = plan.draft();
      morning = morningOf(index, plan.zh ? "full" : "english_only", draft.generated_at.slice(11, 19));
      if (plan.zh) zhFiles = zhPassOf(draft, state);
      else passStrings = zhContextFor(draft, state).strings.length;
      published = publishDraft({
        draft, state, zh: zhFiles === null ? null : { strings: zhFiles.draft.strings, terms: zhFiles.draft.terms }, ids: plan.ids, pace,
        publishedAt: clock(date, must(morning.stages.publish, "the publish stage")[1]), runId, script,
      });
    }
    drafts[date] = draft;
    const allUrls = new Set<string>();
    for (const f of published.state.findings) for (const s of f.sources) allUrls.add(normalizeUrl(s.url));
    for (const b of published.state.briefs) for (const s of b.sources) allUrls.add(normalizeUrl(s.url));
    const newUrls = [...allUrls].filter((u) => !seenUrls.has(u)).length;
    allUrls.forEach((u) => seenUrls.add(u));
    const zhRecord = plan.draft === null
      ? { attempted: false, repair_rounds: 0, strings: 0, backlog: 0, outcome: "not_run" as const }
      : plan.zh
        ? { attempted: true, repair_rounds: 0, strings: zhFiles!.context.strings.length, backlog: published.backlog.length, outcome: "ok" as const }
        : { attempted: true, repair_rounds: 1, strings: passStrings, backlog: 0, outcome: "failed" as const };
    const status = StatusFile.parse({
      schema_version: 1,
      date,
      runs: [runOf({
        index, date, brief: published.brief, morning, newUrls, zhRecord, reportsNew: intake.length, scriptChanges: script.length,
        proposals: date === EDITIONS.weekday.date ? editionContext("weekday").rung_proposals.length : 0, findingsChecked: state.findings.length,
      })],
    });
    days.push({
      date, brief: published.brief, metrics, inputs, status, zh: zhFiles, written: published.written.map((f) => f.id), backlog: published.backlog,
      before, ids: plan.ids, script,
    });
    state = published.state;
  });

  const lastDate = plans.at(-1)!.date;
  SAMPLE = {
    days,
    state: { ...state, findings: ordered(state.findings), glossary: ordered(state.glossary), corrections: ordered(state.corrections), reports: ordered(state.reports) },
    archive: archiveOf(state, days),
    pace: morningLeavesIt(paceState(lastSunday(dataCutoffFor(lastDate)), lastDate)),
    drafts,
  };
  return SAMPLE;
}

/**
 * The archive index of the sample (SPEC §4.10): its editions newest first, and each URL the findings and the briefs cite with the findings
 * and editions that cite it, `first_cited` the earliest `added`, refs in `compareFindingIds()` order (finding ids first, then each
 * `<date>/brief`). An edition is `corrected` when a correction names it by `edition_date` (Cyber's `markCorrected()`): the sample's
 * corrections name findings, so none is. A URL first cited on an edition of the week has its link check (ok, 200), the data-only edition's
 * included (its run's `links` stage checked the notice its script rung change added); the seeds' have none, since no run of the sample
 * first cited them, and no page has a snapshot hash (the snapshots stay in `cache/`).
 */
function archiveOf(state: SampleState, days: readonly SampleDay[]): ArchiveIndex {
  const urls = new Map<string, { first: string; refs: Set<string> }>();
  const cite = (url: string, added: string, ref: string): void => {
    const key = normalizeUrl(url);
    const e = urls.get(key) ?? { first: added, refs: new Set<string>() };
    if (added < e.first) e.first = added;
    e.refs.add(ref);
    urls.set(key, e);
  };
  for (const f of state.findings) for (const s of f.sources) cite(s.url, s.added, f.id);
  for (const b of state.briefs) for (const s of b.sources) cite(s.url, s.added, `${b.date}/brief`);
  const checked = new Set(days.map((d) => d.date));
  const corrected = new Set(state.corrections.map((c) => c.edition_date));
  return ArchiveIndex.parse({
    schema_version: 1,
    editions: [...state.briefs].sort((a, b) => byCodeUnit(b.date, a.date)).map((b) => ({
      date: b.date, edition: b.edition, published_at: b.published_at, finding_count: (b.story === null ? 0 : 1) + b.items.length, corrected: corrected.has(b.date),
    })),
    urls: Object.fromEntries([...urls].sort(([a], [b]) => byCodeUnit(a, b)).map(([url, e]) => [url, {
      first_cited: e.first,
      refs: [...e.refs].sort(compareFindingIds),
      sha256: null,
      hashed_at: null,
      last_check: checked.has(e.first) ? { date: e.first, result: "ok", http: 200 } : null,
    }])),
  });
}

// ── The world's own editions (for the chat edition's and the site's tests) ───────────────────────

/** The records stored before one of the world's four editions, as the world holds them (English-only: every `zh` is null). */
export function worldState(name: EditionName): SampleState {
  const date = EDITIONS[name].date;
  const afterWeekday = date > EDITIONS.weekday.date;
  return {
    findings: keysStoredBefore(date).map((k) => storedFinding(k, date)),
    glossary: storedGlossary(date).terms,
    corrections: afterWeekday ? storedWeekdayCorrections() : [],
    reports: date === EDITIONS.weekday.date ? reportsBeforeWeekday() : afterWeekday ? reportsAfterWeekday() : [],
    briefs: [],
  };
}

/**
 * One of the four valid drafts (`editionDraft(name)`) published over the records the world holds before it, English only, as
 * `publishDraft()` writes it: a Monday with `remarkable` (`name` "monday"), the weekday with its corrections, the Sunday deep dive, the short
 * Monday. The chat edition's tests call this to get a stored brief and the findings it names.
 */
export function worldPublished(name: EditionName): Published {
  const e = EDITIONS[name];
  const state = worldState(name);
  const metrics = metricsFor(e.date);
  return publishDraft({
    draft: editionDraft(name), state, zh: null, ids: WORLD_IDS(name), pace: { sentence: metrics.pace.sentence, status: metrics.status },
    publishedAt: clock(e.date, "03:53:12"), runId: runIdOf(e.date, 0),
  });
}

// ── The generator ────────────────────────────────────────────────────────────────────────────────

const SITE_FILES = {
  brief: (d: string) => `${SITE_DIR}/briefs/${d}.json`,
  finding: (fid: string) => `${SITE_DIR}/findings/${fid}.json`,
  metrics: (d: string) => `${SITE_DIR}/metrics/${d}.json`,
  inputs: (d: string) => `${SITE_DIR}/metrics/inputs/${d}.json`,
  status: (d: string) => `${SITE_DIR}/status/${d}.json`,
  glossary: `${SITE_DIR}/glossary.json`,
  corrections: `${SITE_DIR}/corrections.json`,
  reports: `${SITE_DIR}/reports.json`,
  archive: `${SITE_DIR}/archive-index.json`,
  pace: `${SITE_DIR}/state/pace-weekly.json`,
} as const;

/**
 * Every file of the sample content (the builder's generator, byte-stable): the stored records of the week in the layout of SPEC §3 under
 * `fixtures/site-content/`, and the one file of `fixtures/empty-content/`.
 */
export function siteOutputs(): Output[] {
  const s = buildSample();
  const out: Output[] = [];
  for (const d of s.days) {
    out.push({ path: SITE_FILES.brief(d.date), text: jsonText(d.brief, Brief) });
    out.push({ path: SITE_FILES.metrics(d.date), text: jsonText(d.metrics, MetricsFile) });
    out.push({ path: SITE_FILES.inputs(d.date), text: jsonText(d.inputs, InputsManifest) });
    out.push({ path: SITE_FILES.status(d.date), text: jsonText(d.status, StatusFile) });
  }
  for (const f of s.state.findings) out.push({ path: SITE_FILES.finding(f.id), text: jsonText(f, Finding) });
  out.push({ path: SITE_FILES.glossary, text: jsonText({ schema_version: 1, terms: s.state.glossary }, GlossaryFile) });
  out.push({ path: SITE_FILES.corrections, text: jsonText({ schema_version: 1, corrections: s.state.corrections }, CorrectionsFile) });
  out.push({ path: SITE_FILES.reports, text: jsonText({ schema_version: 1, reports: s.state.reports }, ReportsFile) });
  out.push({ path: SITE_FILES.archive, text: jsonText(s.archive, ArchiveIndex) });
  out.push({ path: SITE_FILES.pace, text: jsonText(s.pace, PaceWeeklyFile) });
  out.push({ path: `${EMPTY_DIR}/README.md`, text: EMPTY_README });
  return out;
}

/** The path of an edition's brief, a finding and the other files of the sample, relative to the repo root (for the tests that read them). */
export const sitePath = SITE_FILES;
/** The weekday of a date as a word (`SampleEdition.weekday`). */
export const weekdayName = (date: string): string => WEEKDAYS[weekday(date)]!;
