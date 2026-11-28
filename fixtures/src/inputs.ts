// The inputs each valid draft is validated against (SPEC §4.12 "Fixtures and tests"): for every edition of the fixture world, the
// day's metrics file (§4.7), its source pack (§4.14), the run's evidence (§4.12, §4.11 "The type check") and the agent's context
// (§4.15), each built from the one world (`world.ts`) and the edition's draft plan (`drafts.ts`), so a quote, a number, a date or an
// id a draft uses is the one its inputs hold. The weekly Pace state the metrics read is generated here too (§4.7, §5.2 to §5.4).
//
//   metrics   the Pace from a calibrated weekly state (A clearly above the 2015 to 2019 level in 5 of 7 fields, too few cases in
//             humanities), C and D from the findings stored before D (§5.5, §5.6), and the seven counters (§5.7)
//   pack      the 22 feeds and the ranked candidates (§5.9): the world's pages the draft cites that the run saw in the pack,
//             plus invented decoys that rank around them, scored, kept and marked deep_read by §5.9 step 3 and 4
//   evidence  every URL the draft cites, each pack URL's text as the pack's followed by its page (§4.12), the article types and
//             the doi.org landing the type check reads, and on the weekday two pages the type check refuses (for invalid cases)
//   context   the budgets, the candidates with their text wrapped, the Pace line and `quotable`, the recent findings, a Sunday's
//             deep dive candidates, a Monday's week, the weekday's rung proposal and two reports, the pack block and the config
//
// Every page and decoy is invented, marked SAMPLE and on a host the config allows for its kind; none is press. Each builder is
// cached and returns a deep copy, as the drafts' builders do.
//
// Cyber's fixtures/src/build.ts and fixtures/src/world.ts at the fork commit 3ced1fb, adapted: Cyber's builders of a context, an
// evidence file, a pack and a metrics file for each edition (one cached value per edition, a deep copy per caller, the evidence's
// pack-then-fetched-then-search order and its pack text followed by the snapshot) are the pattern; Cyber's domain parts (its flaw
// records, its region levels and its metrics) give way to this project's Pace, Landmark counts, Hold rate, counters, candidates,
// Sunday candidates, week, proposals and reports.

import path from "node:path";
import { loadConfig, type LoadedConfig } from "../../lib/config";
import { addDays, daysBetween, isoWeekStart } from "../../lib/dates";
import { byCodeUnit, compareFindingIds } from "../../lib/ids";
import { compareSignificance, filedAs, isBriefable, type FilingCorrection } from "../../lib/items";
import { sha256Hex } from "../../lib/json";
import { holdRate, landmarkCounts, ledgerQuotable } from "../../lib/metrics/ledger-stats";
import { buildPace, dataCutoff, paceRanges, type PaceSettings } from "../../lib/metrics/pace";
import { isCountedRung } from "../../lib/rungs";
import { sanitize, wrapUntrusted } from "../../lib/sanitize";
import { wordsIn } from "../../lib/text";
import { normalizeUrl } from "../../lib/urls";
import { FIELDS, SOURCE_KIND_INFO, type FieldId, type SourceKind } from "../../lib/vocab";
import type { RungChange } from "../../lib/schema/brief";
import {
  AgentContext, type ContextConfig, type ContextPublisher, type ContextReport, type LedgerCandidate, type RecentFinding, type RungProposal,
  type StoredFinding, type WeekContext,
} from "../../lib/schema/context";
import type { DraftBrief } from "../../lib/schema/draft";
import type { Finding } from "../../lib/schema/finding";
import { MetricsFile, PaceWeeklyFile, type CounterReading, type PaceWeek } from "../../lib/schema/metrics";
import { Evidence } from "../../lib/schema/misc";
import { Pack, type Candidate, type PackFeed } from "../../lib/schema/pack";
import type { DraftInputs } from "../../lib/rules/run";
import { editionDraft } from "./drafts";
import {
  EDITIONS, FINDING_KEYS, FINDING_TABLE, REPO_ROOT, SOURCE_TABLE, findingId, firstBrief, keysStoredBefore,
  reportsBeforeWeekday, seenText, sourceKeyOfUrl, sourceSpec, storedFinding, storedFindingsBefore, storedWeekdayCorrections, type EditionName,
  type FindingKey, type SourceKey,
} from "./world";

// ── The config ───────────────────────────────────────────────────────────────────────────────────

let CONFIG: LoadedConfig | undefined;

/** The repo's config/, loaded once: what the inputs copy (budgets, Pace settings, the allowlist) and the validator reads. */
export function fixtureConfig(): LoadedConfig {
  CONFIG ??= loadConfig(path.join(REPO_ROOT, "config"));
  return CONFIG;
}

/** FIELD_CAP: at most this many findings of one field in the story and items (SPEC §4.12); no config file holds it. */
export const FIELD_CAP = 2;

const paceSettings = (): PaceSettings => {
  const p = fixtureConfig().run.pace;
  return { window_weeks: p.window_weeks, provisional_weeks: p.provisional_weeks, min_cases: p.min_cases, min_ratio: p.min_ratio };
};

/** The corrections stored before an edition: the weekday's two, from the day after it on. */
const correctionsBefore = (date: string): FilingCorrection[] => (date > EDITIONS.weekday.date ? storedWeekdayCorrections() : []);

// ── The weekly Pace state (§4.7, §5.4) ───────────────────────────────────────────────────────────

/** A field's weekly paper count and its share of AI-method papers in basis points before 2020 (`base`) and by October 2026 (`now`). */
interface PaceRow {
  readonly n: number;
  readonly base: number;
  readonly now: number;
}

/** A: the leading journals. Social science barely moves, and humanities has too few papers for a verdict. */
const LEADING_ROWS: Readonly<Record<FieldId, PaceRow>> = {
  mathematics: { n: 64, base: 60, now: 470 },
  physics: { n: 260, base: 90, now: 700 },
  chemistry: { n: 220, base: 100, now: 820 },
  biology: { n: 420, base: 120, now: 900 },
  earth: { n: 120, base: 80, now: 760 },
  social: { n: 150, base: 190, now: 230 },
  humanities: { n: 14, base: 50, now: 400 },
};

/** B: all papers. */
const ALL_ROWS: Readonly<Record<FieldId, PaceRow>> = {
  mathematics: { n: 900, base: 25, now: 160 },
  physics: { n: 5200, base: 40, now: 330 },
  chemistry: { n: 3600, base: 45, now: 380 },
  biology: { n: 9800, base: 55, now: 420 },
  earth: { n: 2600, base: 30, now: 300 },
  social: { n: 3400, base: 70, now: 95 },
  humanities: { n: 1500, base: 12, now: 140 },
};

const PACE_START = "2015-01-05";
const RAMP_FROM = "2020-01-06";
/** The Monday the growth curve is anchored to, so a week's counts never depend on the cutoff it is read at. */
const RAMP_REFERENCE = "2026-10-11";

/** 0 before 2020, then rising as a power of time: 1 at RAMP_REFERENCE, a little more after it. */
const growth = (monday: string): number =>
  monday < RAMP_FROM ? 0 : Math.pow(daysBetween(RAMP_FROM, monday) / daysBetween(RAMP_FROM, RAMP_REFERENCE), 2.4);

/**
 * Every week from 2015-01-05 to `cutoff` (SPEC §4.7), oldest first: each field's paper count wobbles a little from week to week,
 * its share follows the growth curve with a small jitter, and the AI-method count is rounded with the remainder carried to the
 * next week, so a long span adds up to its share and no baseline rounds to nothing. The newest `provisional_weeks` weeks are
 * provisional, with a tenth fewer papers (OpenAlex still adds to them) and fetched on `fetchedOn`; a firm week was fetched 63 days
 * after its Monday. A week's counts depend only on its Monday, so two cutoffs agree on every week they share.
 */
export function paceWeeks(cutoff: string, fetchedOn: string): PaceWeek[] {
  const ranges = paceRanges(cutoff, paceSettings());
  const carry = new Map<string, number>();
  const out: PaceWeek[] = [];
  let i = 0;
  for (let monday = PACE_START; monday <= cutoff; monday = addDays(monday, 7), i += 1) {
    const provisional = monday >= ranges.provisional.from;
    const set = (rows: Readonly<Record<FieldId, PaceRow>>, setIdx: number): Record<FieldId, [number, number]> => {
      const counts = {} as Record<FieldId, [number, number]>;
      FIELDS.forEach((field, fi) => {
        const row = rows[field];
        const wobble = ((i * 37 + fi * 11 + setIdx * 5) % 13) - 6;
        const firm = Math.max(1, Math.round(row.n * (1 + wobble / 80)));
        const n = provisional ? Math.round(firm * 0.9) : firm;
        const jitter = ((i * 17 + fi * 7 + setIdx * 3) % 9) - 4;
        const bp = row.base + (row.now - row.base) * growth(monday) + jitter;
        const key = `${setIdx}-${field}`;
        const owed = (carry.get(key) ?? 0) + (n * bp) / 10000;
        const k = Math.min(n, Math.max(0, Math.round(owed)));
        carry.set(key, owed - k);
        counts[field] = [k, n];
      });
      return counts;
    };
    out.push({
      week_start: monday,
      fetched: provisional ? fetchedOn : addDays(monday, 63),
      provisional,
      leading: set(LEADING_ROWS, 0),
      all: set(ALL_ROWS, 1),
    });
  }
  return out;
}

/** content/state/pace-weekly.json as the run of `date` leaves it (SPEC §4.7): every week to `cutoff`. */
export function paceState(cutoff: string, date: string): PaceWeeklyFile {
  const c = fixtureConfig();
  return PaceWeeklyFile.parse({
    schema_version: 1,
    versions: { ai_terms: c.aiTerms.version, journals: c.journals.version, fields: c.fields.version },
    updated: date,
    weeks: paceWeeks(cutoff, date),
  });
}

// ── Metrics (§4.7) ───────────────────────────────────────────────────────────────────────────────

/** A counter read on Mondays (SPEC §5.7): its value and breakdown on the Monday `monday`, from the weeks since 2026-01-05. */
function mondayReading(id: string, monday: string): { value: number; breakdown: { key: string; value: number }[] } {
  const w = daysBetween("2026-01-05", monday) / 7;
  switch (id) {
    case "erdos_ai":
      return { value: 40 + Math.floor(w / 3), breakdown: [] };
    case "mathlib_theorems":
      return { value: 102_000 + 180 * w, breakdown: [] };
    case "ai_drugs": {
      const breakdown = [{ key: "1", value: 14 }, { key: "2", value: 7 }, { key: "3", value: 2 }, { key: "approved", value: 0 }];
      return { value: breakdown.reduce((n, r) => n + r.value, 0), breakdown };
    }
    case "pdb_structures": {
      const now = 330 * w;
      return { value: now, breakdown: [{ key: "2025", value: 17_400 }, { key: "2026", value: now }] };
    }
    case "ai_retractions": {
      const now = 300 + 12 * w;
      return { value: now, breakdown: [{ key: "2025", value: 610 }, { key: "2026", value: now }] };
    }
    default:
      throw new Error(`No Monday reading for ${id}`);
  }
}

/**
 * The seven counters of `date` (SPEC §5.7), in counters.json order: the five fetched on Mondays carry the reading of the Monday
 * on or before `date` with its `as_of`; `full_bibles` has fewer than two figures, so it is missing; `ancient_texts_ai` counts the
 * stored humanities results in ancient texts with an AI role and a counted rung, as filed on `date` - 1.
 */
function counters(date: string, findings: readonly Finding[], corrections: readonly FilingCorrection[]): CounterReading[] {
  const monday = isoWeekStart(date);
  const asOf = addDays(date, -1);
  return fixtureConfig().counters.counters.map((c): CounterReading => {
    const base = { id: c.id, kind: c.kind, source_url: c.source_url };
    if (c.id === "full_bibles") return { ...base, value: null, as_of: null, breakdown: [], status: "missing" };
    if (c.id === "ancient_texts_ai") {
      const value = findings.map((f) => filedAs(f, corrections, asOf)).filter((f) =>
        f.field === "humanities" && f.subfield === "ancient-texts" && f.kind === "result" && f.ai.role !== "none" && isCountedRung(f.rung)).length;
      return { ...base, value, as_of: asOf, breakdown: [], status: "ok" };
    }
    const r = mondayReading(c.id, monday);
    return { ...base, value: r.value, as_of: monday, breakdown: r.breakdown, status: "ok" };
  });
}

/**
 * The metrics file of `date` (SPEC §4.7), computed at 03:17:30 Taipei, status ok, from the stored findings before `date`: the world's
 * own, or `stored` when the sample content (`site.ts`) brings the findings and corrections it holds before `date`.
 */
export function metricsFor(date: string, stored?: { readonly findings: readonly Finding[]; readonly corrections: readonly FilingCorrection[] }): MetricsFile {
  const c = fixtureConfig();
  const cutoff = dataCutoff(date);
  const findings = stored?.findings ?? storedFindingsBefore(date);
  const corrections = stored?.corrections ?? correctionsBefore(date);
  const hold = c.run.pace;
  const { landmarks } = landmarkCounts(findings, corrections, date);
  const d = holdRate(findings, corrections, date, { min_cases: hold.min_cases, hold_after_days: hold.hold_after_days }).hold;
  return MetricsFile.parse({
    schema_version: 1,
    date,
    computed_at: `${date}T03:17:30+08:00`,
    data_cutoff: cutoff,
    versions: c.versions,
    status: "ok",
    pace: buildPace({ weeks: paceWeeks(cutoff, date), cutoff, settings: paceSettings(), extraQuotable: ledgerQuotable(landmarks, d, date) }),
    landmarks,
    hold: d,
    counters: counters(date, findings, corrections),
  });
}

// ── What a draft cites ───────────────────────────────────────────────────────────────────────────

/** Every world source a draft cites (its findings' sources, its brief-level sources and its corrections' `source_url`), each once, in table order. */
export function citedKeys(draft: DraftBrief): SourceKey[] {
  const urls = [
    ...draft.new_findings.flatMap((f) => f.sources.map((s) => s.url)),
    ...draft.sources.map((s) => s.url),
    ...draft.corrections.flatMap((c) => (c.source_url === null ? [] : [c.source_url])),
  ];
  const keys = new Set<SourceKey>();
  for (const url of urls) {
    const key = sourceKeyOfUrl(url);
    if (key === undefined) throw new Error(`${draft.date}: the world holds no source at ${url}`);
    keys.add(key);
  }
  return (Object.keys(SOURCE_TABLE) as SourceKey[]).filter((k) => keys.has(k));
}

/** True when a stored finding already held the source before `date`: the run re-read it with a fetch of its own. */
const storedBefore = (key: SourceKey, date: string): boolean =>
  FINDING_KEYS.some((k) => FINDING_TABLE[k].sources.some((s) => s.key === key && s.added < date));

/** How the run of `date` saw a cited source: re-read sources were fetched, new ones as the world says. */
export function seenOn(key: SourceKey, date: string): "pack" | "fetched" | "search" {
  return storedBefore(key, date) ? "fetched" : SOURCE_TABLE[key].seen;
}

// ── The pack (§4.14, §5.9) ───────────────────────────────────────────────────────────────────────

/** One candidate before ranking: a world page or a decoy, with what the feed gave. */
interface CandidateSpec {
  readonly url: string;
  readonly feed: string;
  readonly kind: SourceKind;
  readonly title: string;
  readonly text: string;
  readonly doi: string | null;
  readonly published_at: string;
  readonly journal: string | null;
  /** The field when its feed lists none (§8.3's mapping by topic). */
  readonly topic: FieldId;
  /** The article types its page shows (the evidence's `types`); a PubMed record's also reach the pack. */
  readonly types: readonly string[];
  /** The paper a reaction in the pack is about (§5.9: plus 2 for that paper). */
  readonly reactsTo: string | null;
  readonly storedFinding: FindingKey | null;
}

/** An invented candidate the draft does not cite, so the ranking has neighbours to place the cited pages among. */
type Decoy = Omit<CandidateSpec, "reactsTo" | "storedFinding"> & { reactsTo?: string; storedFinding?: FindingKey };

const SAMPLE_PAGE = "SAMPLE page, invented for tests and never fetched.";
const decoyText = (...sentences: string[]): string => [SAMPLE_PAGE, ...sentences].join(" ");

/**
 * The decoys of each edition's pack. On the weekday they make exactly 15 deep reads with every cited candidate among them: the
 * telescope release is the fourth physics candidate, so it is kept but not read closely, and the trial protocol shares only a
 * trial number with the antibiotic finding, so it stays with its `stored_finding` (§5.9 step 1).
 */
export const DECOYS: Readonly<Record<EditionName, readonly Decoy[]>> = {
  weekday: [
    {
      url: "https://www.medrxiv.org/content/10.1101/2026.10.12.990021v1", feed: "medrxiv", kind: "preprint",
      title: "SAMPLE: Protocol for a first safety trial of an AI-proposed antibiotic",
      text: decoyText("This protocol describes trial NCT09999001.", "The compound was ranked by a deep learning model.", "The trial tests safety in healthy volunteers."),
      doi: "10.1101/2026.10.12.990021", published_at: "2026-10-13", journal: null, topic: "biology", types: [], storedFinding: "antibiotic",
    },
    {
      url: "https://arxiv.org/abs/2610.99004", feed: "arxiv-physics", kind: "preprint",
      title: "SAMPLE: A neural network that flags faint particle tracks in a detector",
      text: decoyText("We trained a neural network on simulated detector data.", "It flags faint tracks that the standard method misses."),
      doi: null, published_at: "2026-10-13T08:00:00+08:00", journal: null, topic: "physics", types: [],
    },
    {
      url: "https://arxiv.org/abs/2610.99005", feed: "arxiv-quant-ph", kind: "preprint",
      title: "SAMPLE: Tuning quantum dots with machine learning",
      text: decoyText("A machine learning method tuned the voltages of a quantum dot array.", "It took less time than tuning by hand."),
      doi: null, published_at: "2026-10-13T08:00:00+08:00", journal: null, topic: "physics", types: [],
    },
    {
      url: "https://www.science.org/doi/10.1126/ut-sample.0031", feed: "journal-science", kind: "paper",
      title: "SAMPLE: Ocean heat mapped with a deep learning model",
      text: decoyText("A deep learning model filled gaps in ocean temperature records.", "It was tested on records held back from training."),
      doi: "10.1126/ut-sample.0031", published_at: "2026-10-14T02:00:00+08:00", journal: "Science", topic: "earth", types: ["Research Article"],
    },
    {
      url: "https://www.cambridge.org/core/journals/ut-sample-household-economics-review/article/ut-sample-0034", feed: "crossref-journals",
      kind: "paper", title: "SAMPLE: What households spend on food in hard years",
      text: decoyText("We studied household spending in 12 regions.", "A random forest sorted households by how their spending changed."),
      doi: "10.1017/ut-sample-0034", published_at: "2026-10-13T15:00:00+08:00", journal: "Eastvale Household Economics Review", topic: "social", types: [],
    },
    {
      url: "https://www.eurekalert.org/news-releases/ut-sample-0035", feed: "eurekalert", kind: "statement",
      title: "SAMPLE: Telescope team schedules its nights with software",
      text: decoyText("The observatory says it now plans each night with Bayesian optimization.", "More of each night goes to observing."),
      doi: null, published_at: "2026-10-13T05:00:00+08:00", journal: null, topic: "physics", types: [],
    },
  ],
  sunday: [
    {
      url: "https://www.nature.com/articles/s41586-026-ut-sample-0041", feed: "journal-nature", kind: "paper",
      title: "SAMPLE: Glacier retreat mapped with a deep learning model",
      text: decoyText("A deep learning model mapped the edges of mountain glaciers in satellite images.", "People checked the maps against field surveys."),
      doi: "10.1038/s41586-026-ut-sample-0041", published_at: "2026-10-17T23:00:00+08:00", journal: "Nature", topic: "earth", types: ["Article"],
    },
    {
      url: "https://www.sciencemediacentre.org/expert-reaction-to-ut-sample-glacier-retreat-maps/", feed: "smc-reactions", kind: "reaction",
      title: "SAMPLE: Expert reaction to glacier maps drawn by a model",
      text: decoyText("Ana Example (SAMPLE), Ravenhurst University, said: The deep learning maps agree well with the field surveys."),
      doi: null, published_at: "2026-10-17T22:00:00+08:00", journal: null, topic: "earth", types: [],
      reactsTo: "https://www.nature.com/articles/s41586-026-ut-sample-0041",
    },
    {
      url: "https://pubmed.ncbi.nlm.nih.gov/99990041/", feed: "pubmed", kind: "paper",
      title: "SAMPLE: Machine learning to spot sepsis early in hospital wards",
      text: decoyText("A machine learning score read routine ward records.", "It flagged sepsis earlier than the usual checks in one hospital."),
      doi: "10.5555/ut-sample-0042", published_at: "2026-10-17", journal: "Eastvale Journal of Critical Care", topic: "biology", types: ["Journal Article"],
    },
    {
      url: "https://www.biorxiv.org/content/10.1101/2026.10.16.990042v1", feed: "biorxiv", kind: "preprint",
      title: "SAMPLE: A neural network that tracks dividing cells",
      text: decoyText("A neural network followed dividing cells in microscope films.", "It agreed with hand counts on most films."),
      doi: "10.1101/2026.10.16.990042", published_at: "2026-10-17T09:00:00+08:00", journal: null, topic: "biology", types: [],
    },
    {
      url: "https://link.springer.com/article/10.1007/ut-sample-0043", feed: "crossref-journals", kind: "paper",
      title: "SAMPLE: Reading court rulings with a large language model",
      text: decoyText("A large language model sorted court rulings by their outcome.", "Lawyers checked a sample of its sorting."),
      doi: "10.1007/ut-sample-0043", published_at: "2026-10-17T10:00:00+08:00", journal: "Eastvale Law and Society Review", topic: "social", types: [],
    },
    {
      url: "https://www.eurekalert.org/news-releases/ut-sample-0044", feed: "eurekalert", kind: "statement",
      title: "SAMPLE: Museum releases photographs of worn inscriptions",
      text: decoyText("The museum says a convolutional neural network helped sharpen the photographs.", "Scholars read the inscriptions themselves."),
      doi: null, published_at: "2026-10-17T06:00:00+08:00", journal: null, topic: "humanities", types: [],
    },
    {
      url: "https://onlinelibrary.wiley.com/doi/10.1002/ut-sample-0045", feed: "crossref-journals", kind: "paper",
      title: "SAMPLE: Tougher plastics found by Bayesian optimization",
      text: decoyText("Bayesian optimization chose which polymer blends to make next.", "The team made and tested 60 blends."),
      doi: "10.1002/ut-sample-0045", published_at: "2026-10-17T12:00:00+08:00", journal: "Eastvale Polymer Letters", topic: "chemistry", types: [],
    },
  ],
  monday: [
    {
      url: "https://www.science.org/doi/10.1126/ut-sample.0051", feed: "journal-science", kind: "paper",
      title: "SAMPLE: Small earthquakes found with machine learning",
      text: decoyText("A machine learning method found small earthquakes in old seismic records.", "Seismologists checked a sample by hand."),
      doi: "10.1126/ut-sample.0051", published_at: "2026-10-11T22:00:00+08:00", journal: "Science", topic: "earth", types: ["Research Article"],
    },
    {
      url: "https://pubs.acs.org/doi/10.1021/ut-sample-0052", feed: "crossref-journals", kind: "paper",
      title: "SAMPLE: An autonomous laboratory makes brighter dyes",
      text: decoyText("An autonomous laboratory planned and ran its own dye experiments.", "Chemists checked the best dyes."),
      doi: "10.1021/ut-sample-0052", published_at: "2026-10-11T09:00:00+08:00", journal: "Eastvale Dye Chemistry", topic: "chemistry", types: [],
    },
    {
      url: "https://www.tandfonline.com/doi/10.1080/ut-sample-0053", feed: "crossref-journals", kind: "paper",
      title: "SAMPLE: A random forest reads answers to an open survey question",
      text: decoyText("A random forest sorted answers to an open survey question.", "Two coders checked its sorting."),
      doi: "10.1080/ut-sample-0053", published_at: "2026-10-11T08:00:00+08:00", journal: "Eastvale Survey Methods", topic: "social", types: [],
    },
  ],
  "monday-short": [
    {
      url: "https://www.pnas.org/doi/10.1073/ut-sample.0061", feed: "journal-pnas", kind: "paper",
      title: "SAMPLE: Counting trees from the air with deep learning",
      text: decoyText("A deep learning model counted trees in aerial photographs.", "Foresters counted some plots on foot to check it."),
      doi: "10.1073/ut-sample.0061", published_at: "2026-11-01T05:00:00+08:00", journal: "Proceedings of the National Academy of Sciences",
      topic: "earth", types: ["Research Article"],
    },
    {
      url: "https://www.biorxiv.org/content/10.1101/2026.10.31.990062v1", feed: "biorxiv", kind: "preprint",
      title: "SAMPLE: A graph neural network for gene networks",
      text: decoyText("A graph neural network guessed links between genes.", "Some guesses were tested in yeast."),
      doi: "10.1101/2026.10.31.990062", published_at: "2026-11-01T09:00:00+08:00", journal: null, topic: "biology", types: [],
    },
    {
      url: "https://www.cambridge.org/core/journals/ut-sample-census-history-review/article/ut-sample-0063", feed: "crossref-journals",
      kind: "paper", title: "SAMPLE: Old census pages read with machine learning",
      text: decoyText("Machine learning read handwritten census pages.", "Historians checked a sample of pages."),
      doi: "10.1017/ut-sample-0063", published_at: "2026-11-01T10:00:00+08:00", journal: "Eastvale Census History Review", topic: "social", types: [],
    },
    {
      url: "https://link.springer.com/article/10.1007/ut-sample-0064", feed: "crossref-updates", kind: "notice",
      title: "SAMPLE: Correction to a paper on cement strength",
      text: decoyText("A figure label in the paper was wrong and has been corrected."),
      doi: "10.1007/ut-sample-0064", published_at: "2026-11-01T16:00:00+08:00", journal: null, topic: "chemistry", types: [],
    },
  ],
};

/** The journal a cited paper in the pack came from (its feed's journal name); a paper's publisher, with PNAS spelt out. */
const JOURNAL_OF: Partial<Record<SourceKey, string>> = { "protein-paper": "Proceedings of the National Academy of Sciences" };

/** The paper a world reaction in the pack is about. */
const REACTS_TO: Partial<Record<SourceKey, SourceKey>> = { "scroll-smc": "scroll-paper" };

/** The finding a world source belongs to, by its first listing. */
const ownerOf = (key: SourceKey): FindingKey | undefined => FINDING_KEYS.find((k) => FINDING_TABLE[k].sources.some((s) => s.key === key));

function worldCandidate(key: SourceKey): CandidateSpec {
  const s = sourceSpec(key);
  if (s.feed === undefined) throw new Error(`${key} is seen in the pack but names no feed`);
  const owner = ownerOf(key);
  const feedFields = fixtureConfig().sources.feeds.find((f) => f.id === s.feed)?.fields ?? [];
  const topic = owner !== undefined ? FINDING_TABLE[owner].field : feedFields[0];
  if (topic === undefined) throw new Error(`${key} has no field: no finding and no feed field`);
  const reacted = REACTS_TO[key];
  return {
    url: s.url, feed: s.feed, kind: s.kind, title: s.title, text: s.text, doi: s.doi, published_at: s.published_at,
    journal: s.kind === "paper" ? (JOURNAL_OF[key] ?? s.publisher) : null, topic, types: s.types ?? [],
    reactsTo: reacted === undefined ? null : SOURCE_TABLE[reacted].url, storedFinding: null,
  };
}

/** The instant a `published_at` names; a bare date is its Taipei midnight (§5.9's tie-break). */
const instant = (at: string): number => Date.parse(at.length === 10 ? `${at}T00:00:00+08:00` : at);

/** §5.9 step 3's base: a leading-journal paper 5, another paper 3, a checker 4, a lab post 3, a preprint or a release 2, else 0. */
function baseScore(kind: SourceKind, leading: boolean): number {
  switch (kind) {
    case "paper": return leading ? 5 : 3;
    case "checker": return 4;
    case "lab_post": return 3;
    case "preprint":
    case "statement": return 2;
    default: return 0;
  }
}

/** The pack text of a candidate as the evidence and the context hold it: the sanitised title, a newline, the sanitised abstract. */
const packText = (c: Pick<Candidate, "title" | "abstract">): string => `${c.title}\n${c.abstract}`;

/**
 * The ranked candidates of `date` (SPEC §4.14, §5.9): scored, ordered by score, then the newest `published_at`, then URL; the top
 * `candidates_max` kept with at most 10 a field; the top `deep_read_max` of those marked deep_read with at most 3 a field, every
 * field a candidate lists counting.
 */
function rankCandidates(specs: readonly CandidateSpec[]): Candidate[] {
  const c = fixtureConfig();
  const leadingNames = new Set(c.journals.journals.map((j) => j.name));
  const feedOf = (id: string) => {
    const feed = c.sources.feeds.find((f) => f.id === id);
    if (feed === undefined) throw new Error(`No feed ${id}`);
    return feed;
  };
  const reacted = new Set(specs.flatMap((s) => (s.reactsTo === null ? [] : [normalizeUrl(s.reactsTo)])));
  const scored = specs.map((s) => {
    const title = sanitize(s.title, { max: 200 });
    const abstract = sanitize(s.text, { max: 1000 });
    const journal_leading = s.journal !== null && leadingNames.has(s.journal);
    const phrases = c.index.aiPhrases;
    const score = baseScore(s.kind, journal_leading)
      + (wordsIn(title, phrases).length > 0 ? 2 : 0)
      + (wordsIn(abstract, phrases).length > 0 ? 1 : 0)
      + (s.kind === "paper" && reacted.has(normalizeUrl(s.url)) ? 2 : 0);
    const feedFields = feedOf(s.feed).fields;
    const arxiv = /^https:\/\/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/.exec(s.url)?.[1] ?? null;
    return {
      spec: s,
      candidate: {
        id: "", source_id: s.feed, title, abstract, url: s.url, doi: s.doi, arxiv,
        trial: [...new Set(`${title}\n${abstract}`.match(/NCT\d{8}/g) ?? [])],
        published_at: s.published_at, journal: s.journal,
        fields: feedFields.length > 0 ? [...feedFields] : [s.topic],
        ai_terms_matched: wordsIn(`${title}\n${abstract}`, phrases),
        journal_leading,
        types: s.feed === "pubmed" ? [...s.types] : [],
        stored_finding: s.storedFinding === null ? null : findingId(s.storedFinding),
        flags: [], score, deep_read: false,
      } satisfies Candidate,
    };
  });
  scored.sort((a, b) => b.candidate.score - a.candidate.score
    || instant(b.candidate.published_at) - instant(a.candidate.published_at)
    || byCodeUnit(a.candidate.url, b.candidate.url));
  const kept: Candidate[] = [];
  const perField = new Map<FieldId, number>();
  for (const { candidate } of scored) {
    if (kept.length >= c.run.budgets.candidates_max) break;
    if (candidate.fields.some((f) => (perField.get(f) ?? 0) >= 10)) continue;
    for (const f of candidate.fields) perField.set(f, (perField.get(f) ?? 0) + 1);
    kept.push(candidate);
  }
  const read = new Map<FieldId, number>();
  let deep = 0;
  for (const candidate of kept) {
    if (deep >= c.run.budgets.deep_read_max) break;
    if (candidate.fields.some((f) => (read.get(f) ?? 0) >= 3)) continue;
    for (const f of candidate.fields) read.set(f, (read.get(f) ?? 0) + 1);
    candidate.deep_read = true;
    deep += 1;
  }
  return kept.map((candidate, i) => ({ ...candidate, id: `cand-${String(i + 1).padStart(2, "0")}` }));
}

/** The 22 feeds whose state each pack records, in registry order (the counter-only and Pace feeds are read elsewhere). */
export const PACK_FEEDS: readonly string[] = [
  "arxiv-math", "arxiv-physics", "arxiv-astro-ph", "arxiv-cond-mat", "arxiv-quant-ph", "arxiv-q-bio", "arxiv-physics-chem-ph",
  "arxiv-stat-ml", "biorxiv", "medrxiv", "pubmed", "crossref-journals", "journal-nature", "journal-science", "journal-pnas",
  "eurekalert", "lab-deepmind", "smc-reactions", "crossref-updates", "ctgov", "rcsb", "scrollprize",
];

function packFeeds(date: string, candidates: readonly Candidate[]): PackFeed[] {
  const registry = fixtureConfig().sources.feeds;
  return PACK_FEEDS.map((id, i): PackFeed => {
    const feed = registry.find((f) => f.id === id);
    if (feed === undefined) throw new Error(`No feed ${id}`);
    const mine = candidates.filter((c) => c.source_id === id);
    const newest = mine.length === 0 ? addDays(date, -2)
      : mine.map((c) => c.published_at).sort((a, b) => instant(b) - instant(a))[0]!;
    return {
      id, kind: feed.kind, ok: true, stale: false, newest, items_total: mine.length + 4 + ((i * 3) % 7), items_kept: mine.length,
      error: null, sha256: sha256Hex(`${id}\n${date}`),
    };
  });
}

/** The cited world pages of `name` that its run saw in the pack, as candidates. */
const citedPackKeys = (name: EditionName): SourceKey[] =>
  citedKeys(editionDraft(name)).filter((k) => seenOn(k, EDITIONS[name].date) === "pack");

function buildPack(name: EditionName): Pack {
  const e = EDITIONS[name];
  const specs: CandidateSpec[] = [
    ...citedPackKeys(name).map(worldCandidate),
    ...DECOYS[name].map((d): CandidateSpec => ({ ...d, reactsTo: d.reactsTo ?? null, storedFinding: d.storedFinding ?? null })),
  ];
  const candidates = rankCandidates(specs);
  return Pack.parse({
    schema_version: 1, date: e.date, window: { ...e.window }, generated_at: e.packAt, arxiv_announcement: e.arxivAnnouncement,
    degraded: false, feeds: packFeeds(e.date, candidates), candidates, injection_flags: 0,
  });
}

// ── Evidence (§4.12) ─────────────────────────────────────────────────────────────────────────────

/** A page the run saw that no draft cites, kept in the evidence for the invalid cases that cite it. */
export interface EvidenceExtra {
  readonly url: string;
  readonly text: string;
  /** Why the type check refuses it when a draft cites it as a paper. */
  readonly refusal: "no_types" | "no_landing";
}

/** The weekday's extra pages: a Nature page with no article type the run could read, and a DOI whose landing the run never saw. */
export const EVIDENCE_EXTRAS: readonly EvidenceExtra[] = [
  {
    url: "https://www.nature.com/articles/nature-ut-sample-0090",
    text: `SAMPLE: A model that sorts deep-sea sediment cores\n${SAMPLE_PAGE} A deep learning model sorted 4,000 sediment cores by age.`,
    refusal: "no_types",
  },
  {
    url: "https://doi.org/10.1038/nature-ut-sample-0091",
    text: `SAMPLE: Coral reefs mapped from satellite images\n${SAMPLE_PAGE} A neural network mapped coral reefs from satellite images.`,
    refusal: "no_landing",
  },
];

/** Where a cited doi.org source lands, as the run's GET of it ended (`resolved`). */
const LANDINGS: Partial<Record<SourceKey, string>> = {
  "fell-notice": "https://link.springer.com/article/10.1007/ut-sample-0017",
};

function buildEvidence(name: EditionName): Evidence {
  const date = EDITIONS[name].date;
  const pack = editionPack(name);
  const cited = citedKeys(editionDraft(name));
  const citedByUrl = new Map(cited.map((k) => [normalizeUrl(SOURCE_TABLE[k].url), k]));
  const urls: string[] = [];
  const fetched: string[] = [];
  const texts: Record<string, string> = {};
  const seenAs: Record<string, "pack" | "fetched" | "search"> = {};
  const types: Record<string, string[]> = {};
  const resolved: Record<string, string> = {};
  const add = (url: string, how: "pack" | "fetched" | "search", text: string, shown: readonly string[]) => {
    const key = normalizeUrl(url);
    urls.push(url);
    if (how === "fetched") fetched.push(url);
    texts[key] = text;
    seenAs[key] = how;
    if (shown.length > 0) types[key] = [...shown];
  };
  const decoyTypes = new Map(DECOYS[name].map((d) => [normalizeUrl(d.url), d.types]));
  for (const c of pack.candidates) {
    const key = citedByUrl.get(normalizeUrl(c.url));
    if (key === undefined) add(c.url, "pack", packText(c), decoyTypes.get(normalizeUrl(c.url)) ?? []);
    else add(c.url, "pack", `${packText(c)}\n${seenText(key)}`, sourceSpec(key).types ?? []);
  }
  for (const how of ["fetched", "search"] as const) {
    for (const key of cited) {
      if (seenOn(key, date) !== how) continue;
      add(SOURCE_TABLE[key].url, how, seenText(key), sourceSpec(key).types ?? []);
      const landing = LANDINGS[key];
      if (landing !== undefined) resolved[normalizeUrl(SOURCE_TABLE[key].url)] = landing;
    }
    if (how === "search" && name === "weekday") for (const x of EVIDENCE_EXTRAS) add(x.url, "search", x.text, []);
  }
  return Evidence.parse({ urls, fetched, texts, seen_as: seenAs, types, resolved });
}

// ── The context (§4.15) ──────────────────────────────────────────────────────────────────────────

/** A stored finding as the context carries it (§4.15): its English record, filed on `date`. */
export function toStoredFinding(f: Finding, date: string): StoredFinding {
  const filed = filedAs(f, correctionsBefore(date), date);
  const e = f.explainer;
  return {
    id: f.id, title: f.title.en, field: filed.field, kind: filed.kind, significance: filed.significance,
    explainer: {
      found: e.found.en, matters: e.matters.en, ai_helped: e.ai_helped === null ? null : e.ai_helped.en, how_sure: e.how_sure.en,
      background: e.background.en, could_lead: e.could_lead.en,
    },
    ai: structuredClone(filed.ai),
    rung_history: f.rung_history.map((r) => ({ ...r, note: r.note === null ? null : r.note.en })),
    since_then: f.since_then.map((s) => ({ date: s.date, text: s.text.en, source_ids: [...s.source_ids] })),
    sources: structuredClone(f.sources),
    first_published: f.first_published,
  };
}

/** The stored findings with a brief in [D - 30, D - 1], in id order, filed on D (§4.15). */
function recentFindings(date: string): RecentFinding[] {
  const from = addDays(date, -30);
  return storedFindingsBefore(date)
    .filter((f) => f.briefs.some((b) => b >= from && b < date))
    .sort((a, b) => compareFindingIds(a.id, b.id))
    .map((f) => {
      const filed = filedAs(f, correctionsBefore(date), date);
      return { id: f.id, title: f.title.en, field: filed.field, rung: f.rung, significance: filed.significance, artefacts: structuredClone(f.artefacts) };
    });
}

const LEDGER_MAX = 10;

/**
 * A Sunday's deep dive candidates (§4.15): the stored findings first briefed before D - 6 (or history entries) that a brief may
 * still carry, none with a deep dive in the last 26 Sundays (the world has none), each with its reasons: news when an entry was
 * recorded, a later fact dated or a source added in [D - 6, D]; rotation for every field, since no field has had a deep dive.
 * The world has no anniversary. Ranked news, then anniversary, then rotation, then significance, then the newest
 * `first_published`, then id; at most 10.
 */
function ledgerForSunday(date: string): LedgerCandidate[] {
  const from = addDays(date, -6);
  const inWeek = (d: string): boolean => d >= from && d <= date;
  const rows = storedFindingsBefore(date)
    .filter((f) => f.history || (f.first_brief !== null && f.first_brief < from))
    .filter((f) => isBriefable(filedAs(f, correctionsBefore(date), date)))
    .map((f) => {
      const news = f.rung_history.some((r) => inWeek(r.recorded)) || f.since_then.some((s) => inWeek(s.date)) || f.sources.some((s) => inWeek(s.added));
      const reasons: LedgerCandidate["reasons"] = news ? ["news", "rotation"] : ["rotation"];
      return { ...toStoredFinding(f, date), reasons };
    });
  const has = (r: LedgerCandidate, why: "news" | "anniversary" | "rotation"): number => (r.reasons.includes(why) ? 0 : 1);
  rows.sort((a, b) => has(a, "news") - has(b, "news") || has(a, "anniversary") - has(b, "anniversary") || has(a, "rotation") - has(b, "rotation")
    || compareSignificance(a.significance, b.significance) || byCodeUnit(b.first_published, a.first_published) || compareFindingIds(a.id, b.id));
  return rows.slice(0, LEDGER_MAX);
}

/**
 * A Monday's week (§4.5, §4.15): the findings with a brief in [D - 7, D - 1] in world order, the rung entries any stored finding
 * had recorded in those days after its first brief (a finding that fell need not be in the story or items), the setbacks first briefed in them, and for each field the findings first briefed in them
 * (`reported`) and those of them that are not setbacks and whose rung counts now (`counted`).
 */
function weekOf(date: string): WeekContext {
  const from = addDays(date, -7);
  const inWeek = (d: string): boolean => d >= from && d < date;
  const keys = keysStoredBefore(date).filter((k) => FINDING_TABLE[k].briefs.some(inWeek));
  const stored = keys.map((k) => ({ key: k, f: storedFinding(k, date) }));
  const filed = (f: Finding) => filedAs(f, correctionsBefore(date), date);
  const firstInWeek = stored.filter(({ key }) => inWeek(firstBrief(key)));
  const rungChanges: RungChange[] = [];
  for (const f of storedFindingsBefore(date)) {
    f.rung_history.forEach((r, i) => {
      if (i === 0 || !inWeek(r.recorded) || r.recorded === f.first_brief) return;
      rungChanges.push({ finding_id: f.id, from: f.rung_history[i - 1]!.rung, to: r.rung, date: r.date, by: r.by === "script" ? "script" : "agent" });
    });
  }
  return {
    findings: stored.map(({ f }) => {
      const x = filed(f);
      return { id: f.id, title: f.title.en, field: x.field, kind: x.kind, significance: x.significance, rung: f.rung };
    }),
    rung_changes: rungChanges,
    setbacks: firstInWeek.filter(({ f }) => filed(f).kind === "setback").map(({ f }) => f.id),
    field_counts: FIELDS.map((field) => {
      const mine = firstInWeek.filter(({ f }) => filed(f).field === field);
      return { field, reported: mine.length, counted: mine.filter(({ f }) => filed(f).kind !== "setback" && isCountedRung(f.rung)).length };
    }),
  };
}

/** The weekday's one rung proposal (§5.8): a change to the antibiotic finding's trial record, which no script settles. */
export const WEEKDAY_PROPOSAL: RungProposal = {
  finding_id: findingId("antibiotic"),
  kind: "trial_change",
  to: null,
  date: "2026-10-13",
  url: "https://clinicaltrials.gov/study/NCT09999001",
  note: "A change to this finding's trial was found on ClinicalTrials.gov. A rung change needs a paper or a statement. The script left the rung to you.",
};

/** The weekday's reports as the context holds them (§8.9): R-0001 upheld by JL with no correction yet, R-0002 open. */
function weekdayReports(date: string): ContextReport[] {
  return reportsBeforeWeekday().map((r) => {
    const key = FINDING_KEYS.find((k) => findingId(k) === r.finding_id);
    if (key === undefined) throw new Error(`${r.id} names no world finding`);
    if (r.status !== "open" && r.status !== "upheld") throw new Error(`${r.id} is neither open nor upheld`);
    return {
      id: r.id, status: r.status, finding_id: r.finding_id, kind: r.kind,
      evidence_url: r.evidence_url === null ? null : normalizeUrl(r.evidence_url),
      finding: toStoredFinding(storedFinding(key, date), date),
    };
  });
}

/** The config the context copies (§4.15): the word lists, FIELD_CAP, the fields and subfields, the source kinds and a summary of the allowlist. */
export function contextConfig(): ContextConfig {
  const c = fixtureConfig();
  const t = c.sourceTiers;
  const entry = (id: string, name: string, hosts: readonly string[], kinds: readonly SourceKind[]): ContextPublisher =>
    ({ id, name, hosts: [...hosts], kinds: [...kinds] });
  const allowlist: ContextPublisher[] = [
    ...t.publishers.map((p) => entry(p.id, p.name, p.hosts, p.reaction_paths.length > 0 && !p.kinds.includes("reaction") ? [...p.kinds, "reaction"] : p.kinds)),
    ...t.resolvers.map((r) => entry(r.id, r.name, r.hosts, r.kinds)),
    ...t.registries.map((r) => entry(r.id, r.name, r.hosts, r.kinds)),
    ...t.reaction_sources.map((r) => entry(r.id, r.name, r.hosts, ["reaction"])),
    ...c.labs.labs.map((l) => entry(l.id, l.name, l.hosts, ["lab_post"])),
    ...c.checkers.checkers.map((k) => entry(k.id, k.name, k.hosts, ["checker"])),
    entry("institutions", "Universities, government bodies, institutes and publishers' press offices", t.statement_suffixes, ["statement"]),
  ];
  return {
    hype_words: [...c.hypeWords.en],
    jargon: c.jargon.words.map((w) => w.en),
    field_cap: FIELD_CAP,
    fields: FIELDS.map((id) => ({ id, subfields: c.index.subfields[id].map((s) => ({ id: s.id, name: s.en })) })),
    source_kinds: (Object.keys(SOURCE_KIND_INFO) as SourceKind[]).map((id) => ({ id, label: SOURCE_KIND_INFO[id].en, means: SOURCE_KIND_INFO[id].means })),
    allowlist,
  };
}

function buildContext(name: EditionName): AgentContext {
  const e = EDITIONS[name];
  const c = fixtureConfig();
  const b = c.run.budgets;
  const metrics = editionMetrics(name);
  const pack = editionPack(name);
  return AgentContext.parse({
    date: e.date,
    format: e.format,
    window: { ...e.window },
    deadline: e.deadline,
    budgets: {
      web_fetches: b.web_fetches, findings_max: b.findings_max, typical_findings: [...b.typical_findings], deep_read_max: b.deep_read_max,
      words_target: b.words_target, words_max: b.words_max, reading_grade_soft: b.reading_grade_soft, reading_grade_max: b.reading_grade_max,
    },
    candidates: pack.candidates.map((cand) => ({
      ...cand, title: wrapUntrusted(cand.source_id, cand.title), abstract: wrapUntrusted(cand.source_id, cand.abstract),
    })),
    pace: { sentence: metrics.pace.sentence.en, quotable: { ...metrics.pace.quotable } },
    recent_findings: recentFindings(e.date),
    ledger_for_sunday: e.format === "sunday_deep_dive" ? ledgerForSunday(e.date) : [],
    week: e.format === "monday_review" ? weekOf(e.date) : null,
    rung_proposals: name === "weekday" ? [structuredClone(WEEKDAY_PROPOSAL)] : [],
    corrections: { flagged: [] },
    reports: name === "weekday" ? weekdayReports(e.date) : [],
    standing_stories: c.standingStories.stories.map((s) => ({ id: s.id, finding_ids: [...s.finding_ids], rule: s.rule })),
    pack: { md: `${c.run.paths.packs}/${e.date}.md`, json: `${c.run.paths.packs}/${e.date}.json`, degraded: pack.degraded, failed_feeds: [] },
    config: contextConfig(),
  });
}

// ── The cached builders ──────────────────────────────────────────────────────────────────────────

function cached<T>(build: (name: EditionName) => T): (name: EditionName) => T {
  const cache = new Map<EditionName, T>();
  return (name) => {
    let value = cache.get(name);
    if (value === undefined) {
      value = build(name);
      cache.set(name, value);
    }
    return structuredClone(value);
  };
}

/** A fresh copy of an edition's metrics file (`fixtures/metrics/<name>.json`). */
export const editionMetrics: (name: EditionName) => MetricsFile = cached((name) => metricsFor(EDITIONS[name].date));

/** A fresh copy of an edition's pack (`fixtures/packs/<name>.json`). */
export const editionPack: (name: EditionName) => Pack = cached(buildPack);

/** A fresh copy of an edition's evidence (`fixtures/evidence/<name>.json`). */
export const editionEvidence: (name: EditionName) => Evidence = cached(buildEvidence);

/** A fresh copy of an edition's context (`fixtures/context/<name>.json`). */
export const editionContext: (name: EditionName) => AgentContext = cached(buildContext);

/** Everything `validateDraft()` reads besides an edition's draft, as fresh copies, with the repo's config and no file name. */
export function draftInputs(name: EditionName): DraftInputs {
  return {
    context: editionContext(name), evidence: editionEvidence(name), metrics: editionMetrics(name), pack: editionPack(name),
    config: fixtureConfig(), fileDate: null,
  };
}

/** The weekday's validator flags (`fixtures/drafts/flags.txt`, SPEC §8.6): one line, as scripts/validate.ts takes them. */
export const FLAGS_LINE = `--context fixtures/context/weekday.json --evidence fixtures/evidence/weekday.json --metrics fixtures/metrics/weekday.json --pack fixtures/packs/weekday.json`;

