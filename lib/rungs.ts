// The Verification Ladder as code (SPEC §3, §4.3, §4.4, §4.12 RUNG_EVIDENCE and RUNG_ORDER, §5.8): the rung order and the
// counted rungs, a finding's rung from its `rung_history` (now, and as the record stood on a date), the table of what may
// cite a rung (RUNG_EVIDENCE) with its extra conditions as plain-value facts, and the pure parts of the rung watch: the
// order findings are checked in, the fixed notes of a script change in both languages, and the decision between a script
// change and a proposal to the agent. Pure: no file, no network, no clock; every date, setting and fact is an argument.
// Never here: fetching a Crossref record, reading `checkers.json` or matching a URL against it (the caller does, and passes
// what it found), the RUNG_EVIDENCE, RUNG_ORDER and WHO_SAYS rules themselves (lib/rules/), and the files the watch writes.
// New for this project: the ladder, the evidence table and the rung watch have no counterpart in Cyber's lib/.

import { addDays } from "./dates";
import { shortDate, zhDate } from "./format";
import type { L10n } from "./i18n";
import { byCodeUnit, compareFindingIds } from "./ids";
import { normalizeDoi, normalizeUrl } from "./urls";
import type { RungChange } from "./schema/brief";
import type { IsoDate, RungEntry } from "./schema/common";
import type { RungProposal } from "./schema/context";
import {
  COUNTED_RUNGS, FELL_RUNGS, RUNGS, type CountedRung, type FellRung, type LadderRung, type Rung, type SourceKind,
} from "./vocab";

// ── The ladder ───────────────────────────────────────────────────────────────────────────────────

/** Where a rung sits on the ladder, 0 for Claimed to 4 for Applied; null for Disputed and Retracted, which are off it. */
export function ladderIndex(rung: Rung): number | null {
  const i = (RUNGS as readonly string[]).indexOf(rung);
  return i < 0 ? null : i;
}

/** True for Checked, Confirmed and Applied: only these count in any number (SPEC §4.4). */
export function isCountedRung(rung: Rung): rung is CountedRung {
  return (COUNTED_RUNGS as readonly string[]).includes(rung);
}

/** True for Disputed and Retracted: the rungs a finding falls to (What didn't hold up). */
export function isFellRung(rung: Rung): rung is FellRung {
  return (FELL_RUNGS as readonly string[]).includes(rung);
}

/** True for Claimed and Preprint: the rungs that cap a finding at Notable (CLAIMED_CAP) and that D's cases start from. */
export function isClaimedRung(rung: Rung): rung is Extract<LadderRung, "claimed" | "preprint"> {
  return rung === "claimed" || rung === "preprint";
}

/** How a finding's rung moved: `fell` to Disputed or Retracted, `recovered` from one of them back onto the ladder, else up or down the ladder. */
export type RungMove = "climbed" | "lowered" | "fell" | "recovered" | "same";

/** The kind of move from one rung to another; `same` when they are the same rung. */
export function rungMove(from: Rung, to: Rung): RungMove {
  if (from === to) return "same";
  const a = ladderIndex(from);
  const b = ladderIndex(to);
  if (b === null) return "fell";
  if (a === null) return "recovered";
  return b > a ? "climbed" : "lowered";
}

/** A finding's `rung`: the last entry of its `rung_history` (§4.4). Throws on an empty history, which no finding has. */
export function rungOf(history: readonly Pick<RungEntry, "rung">[]): Rung {
  const last = history[history.length - 1];
  if (last === undefined) throw new RangeError("A finding has at least one rung entry");
  return last.rung;
}

/** The date of the last entry of `rung_history`: the date a new entry may not precede (RUNG_ORDER). Throws on an empty history. */
export function lastRungDate(history: readonly Pick<RungEntry, "date">[]): IsoDate {
  const last = history[history.length - 1];
  if (last === undefined) throw new RangeError("A finding has at least one rung entry");
  return last.date;
}

/**
 * The rung the record showed on `date`: the last entry of `rung_history` whose `recorded` is on or before it (SPEC §5.6),
 * so a rung climbed later does not count, however early the event happened. Null when no entry was recorded by then.
 */
export function rungAt(history: readonly Pick<RungEntry, "rung" | "recorded">[], date: IsoDate): Rung | null {
  let found: Rung | null = null;
  for (const entry of history) if (entry.recorded <= date) found = entry.rung;
  return found;
}

/** Why an entry dated `date` breaks RUNG_ORDER: after today, or before the entry that came before it; null when it does not. */
export type RungDateProblem = "after_today" | "before_last";

/** The date problem of an entry dated `date` that follows an entry dated `lastDate`, on the edition dated `today`. */
export function rungDateProblem(lastDate: IsoDate, date: IsoDate, today: IsoDate): RungDateProblem | null {
  if (date > today) return "after_today";
  if (date < lastDate) return "before_last";
  return null;
}

/** The first entry that breaks RUNG_ORDER's date test: its index and the problem, or null when the dates run in order and none is after `today`. */
export function rungOrderProblem(
  history: readonly Pick<RungEntry, "date">[], today: IsoDate,
): { index: number; problem: RungDateProblem } | null {
  let last: IsoDate | null = null;
  for (const [index, entry] of history.entries()) {
    // The first entry has none before it, so only `today` can break its date.
    const problem = rungDateProblem(last ?? entry.date, entry.date, today);
    if (problem !== null) return { index, problem };
    last = entry.date;
  }
  return null;
}

// ── What may cite a rung (RUNG_EVIDENCE) ─────────────────────────────────────────────────────────

/**
 * What a route needs besides the source's kind: `setback` (the finding is filed as one), `lists_rung` (the source is on a
 * `checkers.json` entry that lists the rung), `independent` (the source is from a team other than the original's: a paper's publisher differs from the finding's `who`
 * names and the paper is not an original source; another kind's publisher differs from the original sources' publishers and the `who` names), `trial` (the finding names a trial, so its paper or statement may report the endpoint met).
 */
export type EvidenceNeed = "setback" | "lists_rung" | "independent" | "trial";

/** One way to support a rung: a source of this kind, with every need met. */
export interface EvidenceRoute {
  readonly kind: SourceKind;
  readonly needs: readonly EvidenceNeed[];
}

const route = (kind: SourceKind, ...needs: EvidenceNeed[]): EvidenceRoute => ({ kind, needs });

/**
 * §4.12 RUNG_EVIDENCE as data: the routes that support each rung, the rule's row in its own order. A new rung entry cites a
 * source that fits one route. Only the source's kind and these facts are checked, never what the source says (STYLE.md §3
 * has the agent cite only the publisher's own statement for a setback, and a paper or statement that reports the endpoint).
 */
export const RUNG_EVIDENCE: Readonly<Record<Rung, readonly EvidenceRoute[]>> = {
  claimed: [route("statement"), route("lab_post")],
  preprint: [route("preprint")],
  checked: [route("paper"), route("proof"), route("checker", "lists_rung"), route("notice", "setback"), route("statement", "setback")],
  confirmed: [
    route("paper", "independent"), route("statement", "independent"), route("checker", "independent"),
    route("paper", "trial"), route("statement", "trial"),
  ],
  applied: [route("checker", "lists_rung"), route("statement", "independent")],
  disputed: [route("notice"), route("paper"), route("statement")],
  retracted: [route("notice")],
};

/** The facts about a cited source and its finding that a route may need; the caller reads them from the record and `checkers.json`. */
export interface EvidenceFacts {
  /** The finding is filed as a setback (`filedAs()`, §4.10). */
  readonly setback: boolean;
  /** The rungs of the `checkers.json` entry that lists the source's URL; null when no entry does. */
  readonly checkerRungs: readonly Rung[] | null;
  /** The source is from a team other than the original's (`isIndependent()`). */
  readonly independent: boolean;
  /** The finding names a trial in `artefacts.trial`. */
  readonly trial: boolean;
}

function needMet(need: EvidenceNeed, rung: Rung, facts: EvidenceFacts): boolean {
  switch (need) {
    case "setback":
      return facts.setback;
    case "lists_rung":
      return facts.checkerRungs !== null && facts.checkerRungs.includes(rung);
    case "independent":
      return facts.independent;
    case "trial":
      return facts.trial;
  }
}

/** True when a source of `kind` supports `rung` for a finding with these facts: some route of RUNG_EVIDENCE has that kind and every need met. */
export function evidenceFits(rung: Rung, kind: SourceKind, facts: EvidenceFacts): boolean {
  return RUNG_EVIDENCE[rung].some((r) => r.kind === kind && r.needs.every((need) => needMet(need, rung, facts)));
}

/** Every kind some route of `rung` takes, in table order and without repeats, for a rule's message. */
export function evidenceKinds(rung: Rung): SourceKind[] {
  return [...new Set(RUNG_EVIDENCE[rung].map((r) => r.kind))];
}

/** One source of the original claim's record, as the same-paper test reads it. */
export interface OriginalSource {
  readonly id: string;
  readonly url: string;
  /** The source's `doi`, as §4.1 stores it, or null. */
  readonly doi: string | null;
}

/** What the original claim's record names: the publishers of its sources, its sources' addresses and the `who` names of the finding. */
export interface OriginalRecord {
  readonly publishers: readonly string[];
  readonly who: readonly string[];
  /** The original's sources, for the same-paper test of a confirming paper; left out, a paper is never the same paper as another source. */
  readonly sources?: readonly OriginalSource[];
}

/** The address of the confirming source, for the same-paper test of a paper. */
export interface ConfirmingPaper {
  readonly url: string;
  readonly doi: string | null;
}

/** Why a confirming source is not from a team other than the original's: what it clashes with. */
export type IndependenceClash =
  | { readonly by: "publisher"; readonly name: string }
  | { readonly by: "who"; readonly name: string }
  | { readonly by: "same_paper"; readonly id: string };

/** A name as compared: Unicode compatibility form, lower case, runs of space collapsed. */
function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The addresses a paper is known by: its normal URL and its DOI (given, or read from a doi.org URL). */
function paperKeys(url: string, doi: string | null): string[] {
  const keys = [`url:${normalizeUrl(url)}`];
  const read = (doi === null ? null : normalizeDoi(doi)) ?? normalizeDoi(url);
  if (read !== null) keys.push(`doi:${read}`);
  return keys;
}

/**
 * What a confirming source clashes with, or null when it is from a team other than the original's (§4.12 RUNG_EVIDENCE). A source
 * carries no authors, so the test reads what the record shows, names compared after `nameKey()`:
 * - a `paper`'s publisher is a journal, which does not identify a team, so it is compared with the finding's `who` names only
 *   (an institution or team named there is the original's own), and a paper whose URL or DOI is an original source's is the same
 *   paper (`confirming`, with `original.sources`). That two papers in one journal are by different teams is the drafting agent's
 *   and the seed writers' check of the author lists (STYLE.md §3); the validator cannot see authors;
 * - any other kind's publisher is an institution, compared with the original sources' publishers and the `who` names.
 */
export function independenceClash(
  publisher: string, kind: SourceKind, original: OriginalRecord, confirming?: ConfirmingPaper,
): IndependenceClash | null {
  const key = nameKey(publisher);
  const who = original.who.find((name) => nameKey(name) === key);
  if (kind === "paper") {
    if (who !== undefined) return { by: "who", name: who };
    if (confirming !== undefined && original.sources !== undefined) {
      const mine = new Set(paperKeys(confirming.url, confirming.doi));
      const same = original.sources.find((s) => paperKeys(s.url, s.doi).some((k) => mine.has(k)));
      if (same !== undefined) return { by: "same_paper", id: same.id };
    }
    return null;
  }
  const named = original.publishers.find((name) => nameKey(name) === key);
  if (named !== undefined) return { by: "publisher", name: named };
  return who === undefined ? null : { by: "who", name: who };
}

/** True when `independenceClash()` finds none: the confirming source comes from a team other than the original's. */
export function isIndependent(
  publisher: string, kind: SourceKind, original: OriginalRecord, confirming?: ConfirmingPaper,
): boolean {
  return independenceClash(publisher, kind, original, confirming) === null;
}

// ── The rung watch: which findings, in what order (§5.8) ─────────────────────────────────────────

/** The rung watch follows every finding but a retracted one, history entries included. */
export function isFollowed(rung: Rung): boolean {
  return rung !== "retracted";
}

/** What the order reads of a stored finding. */
export interface WatchCandidate {
  readonly id: string;
  readonly rung: Rung;
  readonly first_brief: IsoDate | null;
}

/**
 * The ids to check this morning, at most `max` (`rung_watch_max`): the followed findings first briefed on D - 14 to D - 1,
 * newest first (ties by id); then the others by their last check, least recent first, a finding never checked before any
 * other (ties by id). `checked` is `cache/rung-watch.json`'s `checked`: a finding not in it was never checked.
 */
export function rungWatchOrder(
  findings: readonly WatchCandidate[], checked: Readonly<Record<string, IsoDate>>, date: IsoDate, max: number,
): string[] {
  if (!Number.isInteger(max) || max < 0) throw new RangeError(`rung_watch_max must be a non-negative integer, got ${max}`);
  const from = addDays(date, -14);
  const to = addDays(date, -1);
  const followed = findings.filter((f) => isFollowed(f.rung));
  const isRecent = (f: WatchCandidate): f is WatchCandidate & { readonly first_brief: IsoDate } =>
    f.first_brief !== null && f.first_brief >= from && f.first_brief <= to;
  const recent = followed.filter(isRecent).sort((a, b) => byCodeUnit(b.first_brief, a.first_brief) || compareFindingIds(a.id, b.id));
  // A finding never checked has the empty string, which sorts before every date. Own properties only: `checked["constructor"]` is not a date.
  const lastCheck = (f: WatchCandidate): string => (Object.hasOwn(checked, f.id) ? checked[f.id] : "");
  const others = followed
    .filter((f) => !isRecent(f))
    .sort((a, b) => byCodeUnit(lastCheck(a), lastCheck(b)) || compareFindingIds(a.id, b.id));
  return [...recent, ...others].slice(0, max).map((f) => f.id);
}

// ── The rung watch: script changes and proposals (§5.8) ──────────────────────────────────────────

/** What a record found for a finding would change: a retraction notice, an expression of concern, or a journal version of a preprint. */
export type ChangeKind = "retraction" | "expression_of_concern" | "journal_version";

/** The order a finding's candidates are tried in: its one script change a morning is the first that applies. */
export const CHANGE_ORDER: readonly ChangeKind[] = ["retraction", "expression_of_concern", "journal_version"];

/** The rung each kind of change moves a finding to. */
export const CHANGE_RUNG: Readonly<Record<ChangeKind, Rung>> = {
  retraction: "retracted",
  expression_of_concern: "disputed",
  journal_version: "checked",
};

/** What the decision reads of a followed finding; DOIs as §4.1 stores them (lower case, without `https://doi.org/`). */
export interface WatchedFinding {
  readonly id: string;
  readonly rung: Rung;
  /** The date of the finding's last `rung_history` entry. */
  readonly lastRungDate: IsoDate;
  /** The DOIs of the sources the finding already cites. */
  readonly sourceDois: readonly string[];
  /** `artefacts.doi`: the finding's own records, never the DOIs of papers it only cites. */
  readonly ownDois: readonly string[];
}

interface WatchRecordBase {
  /** The notice's DOI, or the published paper's. */
  readonly doi: string;
  /** False when the record has no Crossref record of its own (the Retraction Watch row, an `updated-by` entry without a record). */
  readonly hasRecord: boolean;
  /** The Crossref record's first `title`, null when it has none. */
  readonly title: string | null;
  /** The publisher or journal the note names (§5.8), null when the record has none. */
  readonly publisher: string | null;
  /** The record's `published` date when it is a full date; null for a year alone, a year and a month, or none. */
  readonly date: IsoDate | null;
  /** The notice, paper or page to fetch and cite, or null when there is none. */
  readonly url: string | null;
}

/** A retraction notice or an expression of concern. */
export interface NoticeRecord extends WatchRecordBase {
  readonly kind: "retraction" | "expression_of_concern";
}

/** A published journal version of a preprint. */
export interface JournalRecord extends WatchRecordBase {
  readonly kind: "journal_version";
  /** Its Crossref type is `journal-article` and its URL passes `isPrimary(url, "paper")`. */
  readonly primary: boolean;
  /** Another stored finding already holds its DOI in `artefacts.doi`. */
  readonly heldByOther: boolean;
}

export type WatchRecord = NoticeRecord | JournalRecord;

/** A script change (§5.8): certain from the record itself. The caller adds the source (`doi`, `title`, `publisher`, `date`) and writes the rung entry. */
export interface ScriptChange {
  readonly finding_id: string;
  readonly kind: ChangeKind;
  readonly from: Rung;
  readonly to: Rung;
  /** The notice's or the paper's own date: the date of the rung entry. */
  readonly date: IsoDate;
  readonly doi: string;
  readonly title: string;
  readonly publisher: string;
  readonly note: L10n;
}

/** Why a change goes to the agent as a proposal (§5.8's three cases, no record of its own, and a DOI another finding holds). */
export type ProposalReason = "no_record" | "own_doi" | "doi_held" | "incomplete_record" | "date_order";

export type RungDecision =
  | { readonly action: "none" }
  | { readonly action: "change"; readonly change: ScriptChange }
  | { readonly action: "proposal"; readonly proposal: RungProposal };

const FOUND: Readonly<Record<ChangeKind, string>> = {
  retraction: "A retraction notice was found for this finding.",
  expression_of_concern: "An expression of concern was found for this finding.",
  journal_version: "A journal version of this finding's preprint was found.",
};

const WHY: Readonly<Record<ProposalReason, string>> = {
  no_record: "It has no Crossref record of its own, so the script could not add it as a source.",
  own_doi: "Its DOI is one of the finding's own, so the publisher marked the paper itself.",
  doi_held: "Another stored finding already holds its DOI.",
  incomplete_record: "Its Crossref record lacks a title, a publisher or a full date.",
  date_order: "Its date is after today or before the finding's last rung entry.",
};

/** The proposal's note: a fixed template of what was found and why the script left it to the agent, never text from the record. */
export function proposalNote(kind: ChangeKind, reason: ProposalReason): string {
  return `${FOUND[kind]} ${WHY[reason]} The script left the rung to you.`;
}

/** `Retracted by <publisher> on <d Mon YYYY>.` and its Chinese form (§5.8); `date` is the notice's `published_at`. */
export function retractionNote(publisher: string, date: IsoDate): L10n {
  return { en: `Retracted by ${publisher} on ${shortDate(date)}.`, zh: `${publisher} 於 ${zhDate(date)}撤稿。` };
}

/** `<publisher> issued an expression of concern on <d Mon YYYY>.` and its Chinese form (§5.8). */
export function concernNote(publisher: string, date: IsoDate): L10n {
  return {
    en: `${publisher} issued an expression of concern on ${shortDate(date)}.`,
    zh: `${publisher} 於 ${zhDate(date)}發布關注聲明。`,
  };
}

/** `Published in <journal> after peer review.` and its Chinese form (§5.8); `journal` is the paper source's `publisher`. */
export function climbNote(journal: string): L10n {
  return { en: `Published in ${journal} after peer review.`, zh: `經同儕審查後發表於《${journal}》。` };
}

function noteFor(kind: ChangeKind, publisher: string, date: IsoDate): L10n {
  if (kind === "retraction") return retractionNote(publisher, date);
  if (kind === "expression_of_concern") return concernNote(publisher, date);
  return climbNote(publisher);
}

/** Whether a record can change this finding at all: by the finding's rung, and not when its DOI is already among the finding's sources (a notice changes a rung once). */
function applies(finding: WatchedFinding, record: WatchRecord): boolean {
  if (finding.sourceDois.some((doi) => doi.toLowerCase() === record.doi.toLowerCase())) return false;
  switch (record.kind) {
    case "retraction":
      return isFollowed(finding.rung);
    case "expression_of_concern":
      return finding.rung !== "retracted" && finding.rung !== "disputed";
    case "journal_version":
      return isClaimedRung(finding.rung) && record.primary;
  }
}

/** The first reason the record cannot be a script change, in the order §5.8 lists them; null when it can. */
function proposalReason(finding: WatchedFinding, record: WatchRecord, today: IsoDate): ProposalReason | null {
  if (!record.hasRecord) return "no_record";
  if (record.kind === "journal_version") {
    if (record.heldByOther) return "doi_held";
  } else if (finding.ownDois.some((doi) => doi.toLowerCase() === record.doi.toLowerCase())) {
    return "own_doi";
  }
  if (!record.title?.trim() || !record.publisher?.trim() || record.date === null) return "incomplete_record";
  if (rungDateProblem(finding.lastRungDate, record.date, today) !== null) return "date_order";
  return null;
}

/**
 * What this morning's records do to one finding (§5.8): the first record that applies decides, tried in CHANGE_ORDER (a
 * retraction, then an expression of concern, then a climb; within a kind, in the order given). A finding takes at most one
 * script change a morning, and when the first record that applies must go to the agent the finding takes none. A disputed
 * finding takes only a retraction, a climb applies only to a claimed or preprint finding, and a record whose DOI the finding
 * already cites changes nothing. `none` when no record applies.
 */
export function decideRungChange(finding: WatchedFinding, records: readonly WatchRecord[], today: IsoDate): RungDecision {
  const ordered = CHANGE_ORDER.flatMap((kind) => records.filter((r) => r.kind === kind));
  for (const record of ordered) {
    if (!applies(finding, record)) continue;
    const reason = proposalReason(finding, record, today);
    const to = CHANGE_RUNG[record.kind];
    if (reason !== null) {
      return {
        action: "proposal",
        proposal: {
          finding_id: finding.id, kind: record.kind, to, date: record.date, url: record.url,
          note: proposalNote(record.kind, reason),
        },
      };
    }
    const publisher = record.publisher!;
    const date = record.date!;
    return {
      action: "change",
      change: {
        finding_id: finding.id, kind: record.kind, from: finding.rung, to, date, doi: record.doi,
        title: record.title!, publisher, note: noteFor(record.kind, publisher, date),
      },
    };
  }
  return { action: "none" };
}

/** The rung entry a script change writes into `rung_history`: dated by the record, recorded by the edition, citing the source the change added. */
export function scriptRungEntry(change: ScriptChange, sourceId: string, recorded: IsoDate): RungEntry {
  return { rung: change.to, date: change.date, recorded, source_id: sourceId, by: "script", note: change.note };
}

/** The brief's `rung_changes` entry for a script change (§4.5). */
export function scriptRungChange(change: ScriptChange): RungChange {
  return { finding_id: change.finding_id, from: change.from, to: change.to, date: change.date, by: "script" };
}
