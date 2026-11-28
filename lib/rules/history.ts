// The history rule group (SPEC §4.12): what a draft says about the stored record. SUBFIELD_UNKNOWN (a finding's subfield is
// one that its field lists in config/fields.json), DUPLICATE (a new finding that a stored finding already covers must be a
// returning entry), RETURN_NEW_FACT (a returning entry brings a new fact), REPORT_DECISION and REPORT_UPHELD (each reader report
// gets its answer). One rule for each code; every rule is a pure function of the frame's `RuleInput`.
//
// Where each one runs (SPEC §4.12 "Stored records" and "Removed text"):
//   SUBFIELD_UNKNOWN   Draft: each new finding, and each draft correction on a field or a subfield. Published: only the records
//                      being published (a finding first briefed on the publishing date, a correction dated on it), because it
//                      reads config/; every other stored record is left alone, and so is every record when nothing is being
//                      published. Seeds (SPEC §8.13, P2) call `subfieldIssue()` themselves. It reads ids, which no `removed`
//                      correction can rewrite, so there is no text to skip.
//   DUPLICATE          Draft only (it reads the context and the pack). Its title test skips a stored title that a stored
//                      `removed` correction rewrote, which a run given the stored records (`DraftInputs.stored`) knows. Its message
//                      asks for the edit that REF_UNKNOWN then passes: the stored id in place of the new-N and a returning entry;
//                      only the new-N's deletion when story or items already show the stored finding, or when the context does
//                      not list it (a finding of days 31 to 90 that only a title matches), since no draft may name that one.
//   RETURN_NEW_FACT    Draft only (it reads the pack and the context's window). Without the pack it still asks for a source added
//                      this run and for a standing story's new fact, and says in INPUT_MISSING that it ran without the dates.
//   REPORT_DECISION    Draft only (it reads the context's reports).
//   REPORT_UPHELD      Draft only; a warning (S), never a repair round of its own.
//
// What a draft run can see of the stored record decides DUPLICATE: the context's `recent_findings` (the last 30 days, with their
// artefacts), the findings of its `week`, every finding given as a stored record (dated by the editions that reported it, so the
// 90 days of the row are exact for those; read straight from `DraftInputs.stored`, so a record that the draft names nowhere and
// the context does not list is compared too, though it has no view), and the pack's `stored_finding` for ids at any age. The
// context lists 30 days (SPEC §4.15), so days 31 to 90 are covered through the stored records alone: `scripts/validate.ts` gives
// the English run every finding that a brief carried in the 90 days up to D, and the older findings that the context lists or the
// draft names, and the Chinese run the findings its English draft names and the backlog findings its context lists; DUPLICATE judges
// the English draft, so only the English form's records reach it. A run given no stored records compares only what the context lists
// and the pack's ids.
//
// Cyber's lib/rules/items.ts (STANDING_STORY_NEW_FACT and its `sourceDate()`) and lib/rules/ids.ts (ID_DUPLICATE) at the fork
// commit 3ced1fb are the pattern for the dated-source test and the message style; this group's rules are new for this project.

import type { ConfigIndex } from "../config";
import { addDays, isValidDate, taipeiDateOf, taipeiTime } from "../dates";
import type { FilingCorrection } from "../items";
import { roundTo } from "../metrics/stats";
import type { Artefacts, FieldId, IsoDate } from "../schema/common";
import type { Finding } from "../schema/finding";
import type { Candidate } from "../schema/pack";
import { wordSet } from "../text";
import { normalizeDoi, normalizeUrl } from "../urls";
import { FIELDS } from "../vocab";
import { contextFindingIds, extendPath, isDraft, lacksInput, newFindings, packDatesOf, publishingFindings, shown, shownItems } from "./shared";
import { removedPaths } from "./strings";
import { defineRule, error, list, plural, warning, type DraftInput, type Rule, type RuleInput, type ValidationIssue } from "./types";
import { filedFacts, type CorrectionView, type FindingView } from "./views";

// ── SUBFIELD_UNKNOWN ─────────────────────────────────────────────────────────────────────────────

/** What the subfield check reads of the config: the loaded config fits, and so does the part of it a seed run has. */
export interface SubfieldConfig {
  readonly index: Pick<ConfigIndex, "subfields" | "fieldOfSubfield">;
}

/** The ids `field` lists in config/fields.json, in file order; [] for a value that is none of the seven fields. */
export function subfieldIdsOf(config: SubfieldConfig, field: string | null): readonly string[] {
  if (field === null || !Object.hasOwn(config.index.subfields, field)) return [];
  return config.index.subfields[field as FieldId].map((s) => s.id);
}

/**
 * The SUBFIELD_UNKNOWN issue for a subfield that `field` does not list, else null. The check a draft, a stored record and a
 * seed share (SPEC §4.12: "each new finding in a draft, each seed (§8.13) and, in published mode, each finding being
 * published"); the seed validator of P2 calls it with its own `path` (`seeds[3].subfield`). `of` says whose subfield it is
 * ("of new-2", "of this correction of bio-2026-0143") and the message lists the ids it accepts. The subfield is the draft's own text
 * and a message quotes it through `shown()`.
 */
export function subfieldIssue(config: SubfieldConfig, field: string, subfield: string, path: string, of: string): ValidationIssue | null {
  const accepted = subfieldIdsOf(config, field);
  if (accepted.includes(subfield)) return null;
  if (accepted.length === 0) {
    return error("SUBFIELD_UNKNOWN", path, `Subfield "${shown(subfield)}" ${of} cannot be checked: "${shown(field)}" is not one of the fields (${list(FIELDS)}).`,
      "Fix the field first; then the subfield is one of its ids in config/fields.json.");
  }
  const owner = config.index.fieldOfSubfield.get(subfield); // never `field` itself: `accepted` holds all of its ids; and an id of the config, so short
  const elsewhere = owner === undefined ? "" : ` "${subfield}" is a ${owner} subfield.`;
  return error("SUBFIELD_UNKNOWN", path,
    `Subfield "${shown(subfield)}" ${of} is not one of ${field}'s subfields: ${list(accepted)}.${elsewhere} Use one of ${field}'s ids exactly as written.`,
    "config/fields.json lists each field's subfield ids, and each id is under one field (SPEC Appendix B).");
}

const afterPath = (c: CorrectionView): string => extendPath(c.where, "after", ...(c.draft ? [] : ["en"]));

function checkSubfields(input: RuleInput): ValidationIssue[] {
  const { config, views } = input;
  const out: ValidationIssue[] = [];

  // The findings judged against config/: a draft's new findings, a stored finding being published.
  for (const f of publishingFindings(views)) {
    const { field, subfield } = f.published;
    if (field === null || subfield === null) continue; // a view's facts may be unknown (the type allows it): nothing to judge then
    const issue = subfieldIssue(config, field, subfield, f.where("subfield"), `of ${f.key}`);
    if (issue !== null) out.push(issue);
  }

  // The corrections judged against config/: a draft's own, the stored ones dated on the publishing date.
  for (const c of views.corrections) {
    if (!c.publishing || c.type === "removed" || c.finding_id === null) continue;
    if (c.path === "subfield") {
      // The field as filed on the correction's date with the corrections in force: the new field when this batch also corrects it.
      const field = views.find(c.finding_id)?.filedOn(c.date).field ?? null;
      if (field === null) continue;
      const issue = subfieldIssue(config, field, c.after.en, afterPath(c), `of this correction of ${c.finding_id} (its field as filed is ${field})`);
      if (issue !== null) out.push(issue);
    } else if (c.path === "field") {
      const accepted = subfieldIdsOf(config, c.after.en);
      if (accepted.length === 0) continue; // filedAs() ignores a value that is no field, so nothing is refiled (only a stored record can hold one: SCHEMA turns a draft's away)
      const paired = views.corrections.some((x) => x.finding_id === c.finding_id && x.path === "subfield" && x.type !== "removed" && x.date === c.date);
      if (paired) continue;
      out.push(error("SUBFIELD_UNKNOWN", afterPath(c),
        `${c.draft ? "This draft" : `The corrections dated ${c.date}`} correct${c.draft ? "s" : ""} the field of ${c.finding_id} to "${c.after.en}" without correcting its subfield, and each subfield id is under one field, so the old subfield cannot stay. Add a correction of "subfield" on ${c.finding_id} to one of ${c.after.en}'s subfields: ${list(accepted)}.`,
        "A correction of a field comes with a correction of its subfield made with it (SPEC §4.12 SUBFIELD_UNKNOWN, Appendix B)."));
    }
  }
  return out;
}

// ── DUPLICATE ────────────────────────────────────────────────────────────────────────────────────

/** From this Jaccard similarity, two titles in one field are one story (SPEC §4.12 DUPLICATE). */
const TITLE_SIMILARITY = 0.6;
/** How far back DUPLICATE compares titles, in days (SPEC §4.12 DUPLICATE). */
const TITLE_DAYS = 90;

/** One artefact id in a comparable form: `key` is the same for the same id however it is written, `rel` is where the finding holds it. */
interface IdEntry {
  readonly key: string;
  readonly label: string;
  readonly rel: string;
}

const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/;
const arxivBase = (id: string): string => id.trim().toLowerCase().replace(/v\d+$/, "");

/**
 * The DOIs, arXiv ids and trial ids of an artefacts record, each in one form to compare: a DOI as §4.1 stores it, an arXiv id
 * without its version (SPEC §4.3), a trial id in capitals. An arXiv paper's own `10.48550/arxiv.` DOI is its arXiv id, as it is
 * in §5.9's matching, so a paper given as a DOI on one side and as an arXiv id on the other is the same paper.
 */
function idEntries(a: Pick<Artefacts, "doi" | "arxiv" | "trial">): IdEntry[] {
  const out: IdEntry[] = [];
  a.doi.forEach((raw, i) => {
    const doi = normalizeDoi(raw);
    if (doi === null) return;
    const arxiv = ARXIV_DOI.exec(doi)?.[1];
    if (arxiv === undefined) out.push({ key: `doi ${doi}`, label: `DOI ${doi}`, rel: `artefacts.doi.${i}` });
    else out.push({ key: `arxiv ${arxivBase(arxiv)}`, label: `arXiv id ${arxivBase(arxiv)}`, rel: `artefacts.doi.${i}` });
  });
  a.arxiv.forEach((raw, i) => out.push({ key: `arxiv ${arxivBase(raw)}`, label: `arXiv id ${arxivBase(raw)}`, rel: `artefacts.arxiv.${i}` }));
  a.trial.forEach((raw, i) => out.push({ key: `trial ${raw.trim().toUpperCase()}`, label: `trial ${raw.trim().toUpperCase()}`, rel: `artefacts.trial.${i}` }));
  return out;
}

/** The entries of `mine` that `theirs` also has, each id once. */
function sharedIds(mine: readonly IdEntry[], theirs: readonly IdEntry[]): IdEntry[] {
  const keys = new Set(theirs.map((e) => e.key));
  const seen = new Set<string>();
  return mine.filter((e) => keys.has(e.key) && !seen.has(e.key) && seen.add(e.key));
}

/** The ids a pack candidate carries, as an artefacts record. */
const candidateIds = (c: Pick<Candidate, "doi" | "arxiv" | "trial">): IdEntry[] =>
  idEntries({ doi: c.doi === null ? [] : [c.doi], arxiv: c.arxiv === null ? [] : [c.arxiv], trial: c.trial });

/** True when one of a stored finding's briefs is in DUPLICATE's window: 90 days before D up to D itself (a brief after D, from a dry run of a past date, is no part of D's last 90 days). */
const briefedIn = (briefs: readonly IsoDate[] | null, date: IsoDate): boolean => {
  const from = addDays(date, -TITLE_DAYS);
  return briefs?.some((d) => d >= from && d <= date) ?? false;
};

/**
 * One stored finding as DUPLICATE compares it, whether the run holds it as a view or only as a record it was given
 * (`DraftInputs.stored`) that the draft names nowhere and the context does not list, which has no view (SPEC §4.12 "Stored records").
 */
interface Prior {
  readonly id: string;
  /** The DOIs, arXiv ids and trial ids it holds, each in one form to compare (`idEntries()`), read once; empty when the run does not know its artefacts. */
  readonly ids: readonly IdEntry[];
  /** The English title; null when the run does not know it, or when a stored `removed` correction rewrote it (that text is neither compared nor quoted). */
  readonly title: string | null;
  /** The field as filed on D (SPEC §4.10); null when the run does not know it. */
  readonly field: FieldId | null;
  /** True when the run can tell the finding was in a brief within DUPLICATE's window: the context lists it (its last 30 days), or the record it was given says so. */
  readonly briefed: boolean;
}

const priorOfView = (g: FindingView, date: IsoDate): Prior => ({
  id: g.key,
  ids: g.artefacts === null ? [] : idEntries(g.artefacts),
  title: g.title === null || g.removed.has("title") ? null : g.title.en,
  field: g.latest.field,
  briefed: g.roles.includes("recent") || g.roles.includes("week") || briefedIn(g.briefs, date),
});

/** A record the run was given, read as a view reads it: its field filed with the corrections in force, its title unless a stored `removed` correction rewrote it. */
const priorOfRecord = (f: Finding, removed: ReadonlyMap<string, ReadonlySet<string>>, filing: readonly FilingCorrection[], date: IsoDate): Prior => ({
  id: f.id,
  ids: idEntries(f.artefacts),
  title: removed.get(`finding:${f.id}`)?.has("title") === true ? null : f.title.en,
  field: filedFacts({ field: f.field, subfield: null, kind: null, significance: null, role: null, confidence: null }, f.id, filing, date).field,
  briefed: briefedIn(f.briefs, date),
});

/**
 * Every stored finding the run can compare, by id: the stored views, then every record given to the run that no view holds (a view
 * already stands for its record, so the record is not read a second time). Not widening the roster is deliberate: another rule would
 * then scan every stored finding of a draft run, and a record read here is only compared, never judged.
 */
function priorsOf(input: DraftInput): ReadonlyMap<string, Prior> {
  const out = new Map<string, Prior>();
  for (const g of input.views.findings) if (g.origin === "stored") out.set(g.key, priorOfView(g, input.date));
  const given = input.draft.stored;
  if (given === null) return out;
  const removed = removedPaths(given.corrections, { findings: given.findings, briefs: [], terms: given.terms });
  for (const f of given.findings) if (!out.has(f.id)) out.set(f.id, priorOfRecord(f, removed, input.filing, input.date));
  return out;
}

/**
 * The Jaccard similarity of two word sets (`wordSet()`, Cyber's `jaccard()` of the titles they come from; two empty sets score 1). It walks
 * the smaller set, so a very long title costs no more than its own words, whatever the number of stored findings it is compared with.
 */
export function jaccardOfSets(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const w of small) if (large.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** The word set of a title, read once per distinct title of the run: a new title is compared with every stored finding, each stored one with every new finding. */
function wordSetsOf(): (title: string) => ReadonlySet<string> {
  const seen = new Map<string, ReadonlySet<string>>();
  return (title) => {
    let words = seen.get(title);
    if (words === undefined) {
      words = wordSet(title);
      seen.set(title, words);
    }
    return words;
  };
}

/** The Jaccard similarity of a new finding's title to a stored finding's, when the row counts it: same field as filed (SPEC §4.10), in the window, at least 0.6; else null. */
function titleSimilarity(f: FindingView, g: Prior, wordsOf: (title: string) => ReadonlySet<string>): number | null {
  if (f.title === null || g.title === null) return null;
  const field = f.published.field;
  if (field === null || g.field !== field || !g.briefed) return null;
  const similarity = jaccardOfSets(wordsOf(f.title.en), wordsOf(g.title));
  return similarity >= TITLE_SIMILARITY ? similarity : null;
}

/** What one new finding has in common with one stored finding. */
interface Match {
  readonly ids: Map<string, IdEntry>;
  similarity: number | null;
  readonly packed: Set<string>;
}

/**
 * Where a stored finding stands in the draft being judged, which decides what DUPLICATE can tell the agent to do (REF_UNKNOWN holds
 * every draft to it): a finding the context lists may be named, one that story or items show has its returning entry already.
 */
interface Standing {
  readonly listed: boolean;
  readonly shown: boolean;
}

/** The edit a DUPLICATE message asks for, in the three states of the stored finding: usual, already shown, and not listed by the context. */
function duplicateFix(key: string, storedId: string, standing: Standing): string {
  if (!standing.listed) {
    return `A finding that is already stored comes back only as a returning entry, but the context does not list ${storedId}, so a draft cannot name it. Take ${key} out of story, items, the Lead's refs and new_findings.`;
  }
  if (standing.shown) {
    return `A finding that is already stored comes back only as a returning entry, and ${storedId} is already in story or items. Delete ${key} from story or items, from the Lead's refs and from new_findings, and put the new facts in the returning entry of ${storedId} (add one if it has none): its update (at most 60 words) and the sources that show them.`;
  }
  return `A finding that is already stored comes back only as a returning entry. Replace ${key} with ${storedId} in story or items and in the Lead's refs, delete ${key} from new_findings, and add an entry to returning for ${storedId}: its update (at most 60 words) and the sources that show the new facts. If there are no new facts, take ${key} out of story, items, the Lead's refs and new_findings instead.`;
}

function duplicateIssue(f: FindingView, storedId: string, m: Match, stored: Prior | undefined, standing: Standing): ValidationIssue {
  const shared = [...m.ids.values()];
  const reasons: string[] = [];
  if (shared.length > 0) {
    const ids = [...m.packed].sort();
    const via = ids.length > 0 ? ` (the pack's ${ids.length === 1 ? "candidate" : "candidates"} ${list(ids)} matched it)` : "";
    reasons.push(`they share ${list(shared.map((e) => e.label))}${via}`);
  }
  if (m.similarity !== null) {
    reasons.push(`their titles have a Jaccard similarity of ${roundTo(m.similarity, 2)} (from ${TITLE_SIMILARITY} counts) in the same field, ${f.published.field}`);
  }
  // A title that a stored `removed` correction rewrote is the removed text: the message does not quote it (its Prior has no title).
  const storedTitle = stored?.title ?? null;
  const title = storedTitle === null ? "" : ` ("${shown(storedTitle)}")`;
  const path = shared.length > 0 ? f.where(shared[0]!.rel) : f.where("title");
  return error("DUPLICATE", path,
    `${f.key} duplicates the stored finding ${storedId}${title}: ${reasons.join(", and ")}. ${duplicateFix(f.key, storedId, standing)}`,
    "A new finding is for a result the record does not hold; a finding already on record is shown by its own id in story or items, with an entry in returning for what is new (SPEC §4.12 DUPLICATE, REF_UNKNOWN, STYLE.md).");
}

function checkDuplicate(input: RuleInput): ValidationIssue[] {
  if (!isDraft(input)) return [];
  const { views } = input;
  const pack = lacksInput(input, "pack") ? null : input.draft.pack;
  const priors = priorsOf(input);
  const wordsOf = wordSetsOf();
  const listed = contextFindingIds(input.draft.context);
  const shownIds = new Set(shownItems(views).map((item) => item.key));
  const out: ValidationIssue[] = [];
  for (const f of newFindings(views)) {
    const mine = f.artefacts === null ? [] : idEntries(f.artefacts);
    const matches = new Map<string, Match>();
    const matchOf = (id: string): Match => {
      const found = matches.get(id) ?? { ids: new Map<string, IdEntry>(), similarity: null, packed: new Set<string>() };
      matches.set(id, found);
      return found;
    };
    for (const g of priors.values()) {
      const shared = sharedIds(mine, g.ids);
      const similarity = titleSimilarity(f, g, wordsOf);
      if (shared.length === 0 && similarity === null) continue;
      const m = matchOf(g.id);
      for (const e of shared) m.ids.set(e.key, e);
      m.similarity = similarity;
    }
    for (const c of pack?.candidates ?? []) {
      if (c.stored_finding === null) continue;
      const shared = sharedIds(mine, candidateIds(c));
      if (shared.length === 0) continue;
      const m = matchOf(c.stored_finding);
      for (const e of shared) m.ids.set(e.key, e);
      m.packed.add(c.id);
    }
    for (const [id, m] of matches) out.push(duplicateIssue(f, id, m, priors.get(id), { listed: listed.has(id), shown: shownIds.has(id) }));
  }
  return out;
}

// ── RETURN_NEW_FACT ──────────────────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const taipeiStamp = (ms: number): string => {
  const iso = new Date(ms).toISOString();
  return `${taipeiDateOf(iso)} ${taipeiTime(iso)}`;
};

/**
 * True when a source date falls in the span (both ends inclusive): a timestamp exactly, a bare date when its Taipei calendar day
 * overlaps the span, since a date alone says no time (SPEC §4.3 `PublishedAt`).
 */
function datedWithin(when: string, from: number, to: number): boolean {
  if (isValidDate(when)) return when >= taipeiDateOf(new Date(from).toISOString()) && when <= taipeiDateOf(new Date(to).toISOString());
  const t = Date.parse(when);
  return t >= from && t <= to;
}

/** A source that shows a trial's record (SPEC §4.12 names "a new source of kind `trial`", which SOURCE_KINDS lacks): a `registry` entry whose URL holds an NCT number. */
const isTrialRecord = (s: { kind: string; url: string }): boolean => s.kind === "registry" && /NCT\d{8}/i.test(s.url);

function checkReturnNewFact(input: RuleInput): ValidationIssue[] {
  if (!isDraft(input)) return [];
  const { views, config } = input;
  const { context } = input.draft;
  const pack = lacksInput(input, "pack") ? null : input.draft.pack;
  const packDates = pack === null ? null : packDatesOf(pack);
  const lookback = config.run.pack.lookback_hours;
  const from = Date.parse(context.window.start) - lookback * HOUR_MS;
  const to = Date.parse(context.window.end);
  const span = `${taipeiStamp(from)} to ${taipeiStamp(to)} Taipei (the pack window and ${plural(lookback, "hour")} of lookback)`;

  // The findings that a standing story lists: config/standing-stories.json, and the copy the context shows the agent.
  const stories = new Map<string, string>();
  for (const s of [...config.standingStories.stories, ...context.standing_stories]) {
    for (const id of s.finding_ids) if (!stories.has(id)) stories.set(id, s.id);
  }

  const out: ValidationIssue[] = [];
  for (const r of views.brief.returning) {
    // Each cited id once (a source listed twice is one source), and only a brief-level source of this draft was added this run: a
    // finding's own `s` source is part of its record, however recent its date.
    const cited = [...new Set(r.source_ids)];
    const added = cited.flatMap((id) => {
      const source = views.brief.sources.find((x) => x.id === id);
      return source === undefined ? [] : [source];
    });
    const where = `returning[${r.index}] (${r.finding_id})`;

    if (added.length === 0) {
      const ids = cited.length === 0 ? "its source_ids is empty" : `its source_ids holds ${list(cited)}, none of them a brief-level source of this draft`;
      out.push(error("RETURN_NEW_FACT", extendPath(r.where, "source_ids"),
        `${where} cites no source added this run: ${ids}. A finding comes back only with a new fact that a new source shows. Add that source to the brief's sources (b1, b2, ...) and list its id in source_ids, or delete the returning entry.`,
        "A returning entry cites at least one source added this run, dated within the pack window and its lookback (SPEC §4.12 RETURN_NEW_FACT)."));
    } else if (packDates !== null) {
      const dated = added.map((s) => {
        const fromPack = packDates.get(normalizeUrl(s.url));
        const when = fromPack ?? s.published_at;
        return { s, when, how: fromPack === undefined ? "its own published_at" : "the pack's date" };
      });
      if (!dated.some((d) => d.when !== null && datedWithin(d.when, from, to))) {
        const found = dated.map((d) => (d.when === null ? `${d.s.id} has no date` : `${d.s.id} is dated ${d.when} by ${d.how}`));
        out.push(error("RETURN_NEW_FACT", extendPath(r.where, "source_ids"),
          `${where} cites ${plural(added.length, "source")} added this run, but none is dated from ${span}: ${found.join("; ")}. Cite the source that shows the new fact, with its own date, or delete the returning entry.`,
          "A source in the pack is dated by its candidate's published_at (an arXiv paper by its announcement), any other by its own published_at (SPEC §4.12 RETURN_NEW_FACT)."));
      }
    }

    const story = stories.get(r.finding_id);
    if (story === undefined) continue;
    // A rung change for a finding that the brief shows is the returning entry's own `rung`: a `rung_changes` entry for it is no new
    // fact here, since REF_UNKNOWN fails every draft that has one (SPEC §4.5, §4.12), so it cannot count.
    const newFact = r.rung !== null || added.some(isTrialRecord) || views.corrections.some((c) => c.finding_id === r.finding_id);
    if (!newFact) {
      out.push(error("RETURN_NEW_FACT", r.where,
        `${where} brings back a finding of the standing story "${story}" without one of the three new facts a standing story needs: a rung change for it (this entry's own rung), a new source that is a trial record (kind registry, an NCT number in its URL), or a correction of it in this draft. Add one of them, or delete the returning entry.`,
        "A standing story returns only on new facts: a rung change, a trial result or a correction of record (STYLE.md, Standing stories)."));
    }
  }
  return out;
}

// ── REPORT_DECISION and REPORT_UPHELD ────────────────────────────────────────────────────────────

const targetOf = (c: CorrectionView): string => c.finding_id ?? (c.edition_date !== null ? `the ${c.edition_date} edition` : `the term ${c.term_id}`);

function checkReportDecision(input: RuleInput): ValidationIssue[] {
  if (!isDraft(input)) return [];
  const { views } = input;
  const reports = new Map(input.draft.context.reports.map((r) => [r.id, r] as const));
  const open = input.draft.context.reports.filter((r) => r.status === "open");
  const upheld = input.draft.context.reports.filter((r) => r.status === "upheld");
  const decisions = views.brief.report_decisions;
  const corrections = views.corrections;
  const out: ValidationIssue[] = [];
  const code = "REPORT_DECISION";

  // Every open report gets exactly one decision.
  for (const report of open) {
    const mine = decisions.filter((d) => d.report_id === report.id);
    if (mine.length === 0) {
      out.push(error(code, views.brief.where("report_decisions"),
        `The context lists report ${report.id} (${report.kind}, about ${report.finding_id}) as open, and the draft has no decision for it. Add an entry to report_decisions: report_id "${report.id}", outcome "upheld" (with correction, the index in corrections of the correction on ${report.finding_id} that answers it) or "rejected" (with correction null), and a reason of at most 40 words.`,
        "Every open report in the context gets exactly one decision (SPEC §4.12 REPORT_DECISION)."));
    }
    for (const extra of mine.slice(1)) {
      out.push(error(code, extendPath(extra.where, "report_id"),
        `Report ${report.id} has ${mine.length} decisions, at ${list(mine.map((d) => d.where))}. Each open report gets exactly one decision; delete the extra ones.`,
        "Every open report in the context gets exactly one decision (SPEC §4.12 REPORT_DECISION)."));
    }
  }

  // No other report gets one, and a decision's outcome and correction agree.
  const answered: { report: string; correction: number; where: string }[] = [];
  for (const d of decisions) {
    const report = reports.get(d.report_id);
    if (report === undefined) {
      out.push(error(code, extendPath(d.where, "report_id"),
        `${d.where} answers "${d.report_id}", which is not a report in the context. Only an open report gets a decision (the open ones: ${open.length === 0 ? "none" : list(open.map((r) => r.id))}). Delete this decision.`));
      continue;
    }
    if (report.status !== "open") {
      out.push(error(code, extendPath(d.where, "report_id"),
        `${d.where} answers ${report.id}, which JL already upheld: it is not open, so it gets no decision. Delete this decision, and give the correction that answers it report_id "${report.id}" (REPORT_UPHELD asks for it).`));
      continue;
    }
    if (d.outcome === "rejected") {
      if (d.correction !== null) {
        out.push(error(code, extendPath(d.where, "correction"),
          `${d.where} rejects ${report.id} but names correction ${d.correction}. A rejected decision has correction null: set it to null, or change the outcome to upheld.`));
      }
      continue;
    }
    if (d.correction === null) {
      out.push(error(code, extendPath(d.where, "correction"),
        `${d.where} upholds ${report.id} but points to no correction. Set correction to the index, counting from 0, of the correction on ${report.finding_id} in corrections that answers it (write that correction if it is not there), or change the outcome to rejected if the sources do not bear the report out.`));
      continue;
    }
    const target = corrections[d.correction];
    if (target === undefined) {
      out.push(error(code, extendPath(d.where, "correction"),
        `${d.where} points to correction ${d.correction}, but the draft has ${corrections.length === 0 ? "no corrections" : `${plural(corrections.length, "correction")} (indices 0 to ${corrections.length - 1})`}. Point it at the correction on ${report.finding_id} that answers ${report.id}, and write that correction if it is not there.`));
      continue;
    }
    answered.push({ report: report.id, correction: d.correction, where: extendPath(d.where, "correction") });
    if (target.finding_id !== report.finding_id) {
      out.push(error(code, extendPath(d.where, "correction"),
        `${d.where} points to correction ${d.correction}, which is on ${targetOf(target)}, but ${report.id} is about ${report.finding_id}. Point it at a correction on ${report.finding_id}, and write one if there is none.`));
    }
  }

  // A correction's report_id names a report JL upheld, on that report's finding.
  for (const c of corrections) {
    if (c.report_id === null) continue;
    const report = reports.get(c.report_id);
    const at = extendPath(c.where, "report_id");
    if (report === undefined) {
      out.push(error(code, at,
        `${c.where} has report_id "${c.report_id}", which is not a report in the context. report_id is set only on the correction for a report that JL upheld (${upheld.length === 0 ? "the context has none" : `the context's: ${list(upheld.map((r) => r.id))}`}); set it to null.`));
    } else if (report.status === "open") {
      out.push(error(code, at,
        `${c.where} has report_id "${report.id}", but ${report.id} is an open report: its decision (upheld, with correction ${c.index}) links the two, and report_id stays null. Set report_id to null.`));
    } else if (c.finding_id !== report.finding_id) {
      out.push(error(code, at,
        `${c.where} has report_id "${report.id}", a report about ${report.finding_id}, but the correction is on ${targetOf(c)}. Put report_id on the correction on ${report.finding_id}, or set it to null.`));
    }
    answered.push({ report: c.report_id, correction: c.index, where: at });
  }

  // No correction answers two reports, and no report has two corrections.
  const byCorrection = new Map<number, Map<string, string>>();
  const byReport = new Map<string, Map<number, string>>();
  for (const a of answered) {
    byCorrection.set(a.correction, (byCorrection.get(a.correction) ?? new Map<string, string>()).set(a.report, a.where));
    byReport.set(a.report, (byReport.get(a.report) ?? new Map<number, string>()).set(a.correction, a.where));
  }
  for (const [index, reportsOf] of byCorrection) {
    if (reportsOf.size < 2) continue;
    out.push(error(code, corrections[index]!.where,
      `Correction ${index} answers ${reportsOf.size} reports: ${list([...reportsOf].map(([id, where]) => `${id} (through ${where})`))}. A correction answers one report: write a separate correction for each.`));
  }
  for (const [id, correctionsOf] of byReport) {
    if (correctionsOf.size < 2) continue;
    out.push(error(code, [...correctionsOf.values()][1]!,
      `Report ${id} has ${correctionsOf.size} corrections: ${list([...correctionsOf].map(([index, where]) => `${index} (through ${where})`))}. A report has one correction: keep one and fold what the other adds into it.`));
  }
  return out;
}

function checkReportUpheld(input: RuleInput): ValidationIssue[] {
  if (!isDraft(input)) return [];
  const { views } = input;
  return input.draft.context.reports.flatMap((report) => {
    if (report.status !== "upheld" || views.corrections.some((c) => c.report_id === report.id)) return [];
    const head = `Report ${report.id} (${report.kind}, about ${report.finding_id}), which JL upheld, has no correction with report_id "${report.id}".`;
    const ask = report.kind === "dangerous"
      ? `If STYLE.md §9 rules the detail out, add a removed correction on ${report.finding_id} with report_id "${report.id}" for the text it names.`
      : `If the finding's sources${report.evidence_url === null ? "" : " or the reader's evidence link"} show the error, add a correction on ${report.finding_id} with report_id "${report.id}" that puts it right, citing a primary source.`;
    return [warning("REPORT_UPHELD", views.brief.where("corrections"),
      `${head} ${ask} If not, add nothing: never invent a correction. The report comes back tomorrow.`,
      "A report that JL upheld is answered by a correction only when the record bears it out (SPEC §4.12 REPORT_UPHELD).")];
  });
}

// ── The rules ────────────────────────────────────────────────────────────────────────────────────

export const historyRules: Rule[] = [
  defineRule({ code: "SUBFIELD_UNKNOWN", scope: ["draft", "published"], check: checkSubfields }),
  defineRule({ code: "DUPLICATE", scope: "draft", uses: ["pack"], check: checkDuplicate }),
  defineRule({ code: "RETURN_NEW_FACT", scope: "draft", uses: ["pack"], check: checkReturnNewFact }),
  defineRule({ code: "REPORT_DECISION", scope: "draft", check: checkReportDecision }),
  defineRule({ code: "REPORT_UPHELD", severity: "warning", scope: "draft", check: checkReportUpheld }),
];
