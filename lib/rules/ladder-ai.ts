// The ladder and AI group (SPEC §4.12): the Verification Ladder and the AI role. Ten rules, one code each: RUNG_EVIDENCE,
// RUNG_ORDER, CLAIMED_CAP, LANDMARK_BASIS, NON_AI_LANDMARK_ONLY, SETBACK_MAJOR, AI_CONFIDENCE, AI_SYSTEM_NAMED, WHO_SAYS and
// POSSIBILITY. All are hard (H) and run in draft and published mode; none reads the run's evidence, metrics or pack.
//
// What each judges, and where (SPEC §4.10 "filedAs()", §4.12 "Stored records" and "Removed text"):
//   RUNG_EVIDENCE   each new rung entry (a draft's: a new finding's own, and those it adds to a stored finding; published mode:
//                   every entry of every record) against the table of lib/rungs.ts `RUNG_EVIDENCE`. The only config read, the
//                   `checkers.json` list a route may need, is read for a draft and for the entries being published: those of a
//                   finding first briefed on the date being published (a Ledger seed excepted, which is a returning finding from its
//                   first brief, `beingPublishedOf()`), and those the date recorded on a returning finding.
//   RUNG_ORDER      the entries in date order and none after D (a draft: the edition's date; a record: its `updated`), and in
//                   published mode a finding's `rung` is its last entry's.
//   CLAIMED_CAP     a Claimed or Preprint finding is at most Notable: a new finding, a stored finding a draft correction on
//                   `significance` refiles or a draft rung entry moves, and in published mode a record whose history has no
//                   entry above Preprint (the rung changes after publication, so the history is read).
//   LANDMARK_BASIS  a Landmark has 2 or more reactions from different affiliations, none in its `who`, or a rung of Confirmed or
//                   Applied: a new finding, a stored finding a draft correction refiles as one or a draft rung entry moves from
//                   Confirmed or Applied to Checked, and in published mode every record (any such entry in its history).
//   NON_AI_LANDMARK_ONLY, SETBACK_MAJOR
//                   a finding's own record as published (a new finding, or each record), and a stored finding in a brief's
//                   story, items or deep dive as filed on the brief's date.
//   AI_CONFIDENCE, AI_SYSTEM_NAMED
//                   a finding's own record as published; AI_CONFIDENCE also each correction on `ai.role` or `ai.confidence` (the
//                   draft's own; in published mode every stored one, on its own date).
//   WHO_SAYS, POSSIBILITY
//                   the English `how_sure` and `could_lead` of each own record, and a correction's `after` at those paths; a
//                   string a stored `removed` correction rewrote is skipped, as every rule skips it, and a correction typed
//                   `removed` is skipped only where its `after` IS REMOVED_TEXT (`isRemovedText()`, the one definition).
// A value the run does not show for a stored finding (its kind, AI role, reactions, `who`, sources: the context lists only part of
// a record, and `DraftInputs.stored` gives the rest, types.ts `StoredRecords`) is unknown, and a test that needs it is not run on
// that finding. A string a stored `removed` correction rewrote is left out of every comparison (`FindingView.removed`).
//
// Cyber's lib/rules/ai.ts at the fork commit 3ced1fb, adapted: its shape (one rule per code, a loop over the records, each
// issue naming the value found and the edit) is the pattern; every rule is this project's, written once for a draft and a
// stored record over the views (views.ts) and the string inventory (strings.ts).

import { breaksNonAiLandmarkOnly, exceedsClaimedCap, significanceAtLeast } from "../items";
import { checkerRungsFor, checkersFor } from "../primary";
import {
  evidenceFits, evidenceKinds, isClaimedRung, isIndependent, rungDateProblem, RUNG_EVIDENCE, type EvidenceFacts, type EvidenceNeed,
} from "../rungs";
import { ID_PATTERNS, type IsoDate } from "../schema/common";
import { wordRe } from "../text";
import {
  ALL_RUNGS, RUNG_INFO, SIGNIFICANCE_INFO, SOURCE_KIND_INFO, type AiRole, type FindingKind, type Rung, type Significance, type SourceKind,
} from "../vocab";
import { draftRungEntries, extendPath, resolveSource, shownItems } from "./shared";
import { isRemovedText, type Inventory, type StringEntry } from "./strings";
import { defineRule, error, list, plural, type Rule, type RuleInput, type ValidationIssue } from "./types";
import type { CorrectionView, Facts, FindingView, RungView, SourceView } from "./views";

// ── What the rules share ─────────────────────────────────────────────────────────────────────────

/** The kinds whose `ai.systems` may be [] when no cited source names a system (AI_SYSTEM_NAMED, STYLE.md §4). */
const SYSTEM_FREE_KINDS: readonly FindingKind[] = ["setback", "infrastructure", "policy_people"];

/** What `could_lead` may say it could do (POSSIBILITY): one of these words, as a whole word in any case. */
export const POSSIBILITY_WORDS: readonly string[] = ["could", "might", "may", "if", "possibility", "possible"];

/** What `could_lead` may never promise (POSSIBILITY): these phrases, as whole words in any case. */
export const PROMISES: readonly string[] = ["will cure", "will solve"];

const quote = (text: string): string => `"${text}"`;

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** A name as compared (the same normal form as lib/rungs.ts `isIndependent()`): NFKC, lower case, runs of space collapsed. */
const nameKey = (name: string): string => name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

/** True when `text` holds `name` as whole words in any case, both read in NFKC as `nameKey()` reads a name (an empty name is never held). */
const names = (text: string, name: string): boolean => name.trim() !== "" && wordRe(name.normalize("NFKC")).test(text.normalize("NFKC"));

const kindName = (kind: SourceKind): string => SOURCE_KIND_INFO[kind].en.toLowerCase();
const rungName = (rung: Rung): string => RUNG_INFO[rung].en;
const sigName = (significance: Significance): string => SIGNIFICANCE_INFO[significance].en;

/**
 * True when `text` starts with `label` as a whole word: the label itself, then the end of the text or a character that is not
 * a letter or a digit ("Checked." and "Checked: ..." start with Checked; "Checkedly" and " Checked" do not). Case counts: the
 * label is spelled as `RUNG_INFO` has it (STYLE.md §3).
 */
export function startsWithRungLabel(text: string, rung: Rung): boolean {
  const label = RUNG_INFO[rung].en;
  return text.startsWith(label) && !/^[\p{L}\p{N}]/u.test(text.slice(label.length));
}

/** The rung whose label starts `text` (`startsWithRungLabel()`), else null: the start WHO_SAYS and ZH_RUNG_LABEL both read. */
export function rungLabelAtStart(text: string): Rung | null {
  return ALL_RUNGS.find((rung) => startsWithRungLabel(text, rung)) ?? null;
}

/** The findings whose own record a run judges: a draft's new findings, a published run's stored records; never one only seen through the context. */
const ownRecords = (input: RuleInput): FindingView[] => input.views.findings.filter((f) => f.basis !== "context");

/** The stored findings a draft names (through the context) and may judge; a new finding is `ownRecords()`'s. */
const namedStored = (input: RuleInput): FindingView[] => input.views.findings.filter((f) => f.basis === "context" && f.known);

/** A draft's own correction at `path` for the finding, whatever its type but `removed` (which refiles nothing and has no text to judge); in draft mode `views.corrections` is the draft's own. */
const draftCorrections = (input: RuleInput, finding: FindingView, path: string): CorrectionView[] =>
  input.views.corrections.filter((c) => c.type !== "removed" && c.finding_id === finding.key && c.path === path);

/**
 * True for a correction that rewrote its path to REMOVED_TEXT: typed `removed` AND its `after` IS the marker (a stored one's in both
 * languages, a draft's in English; `isRemovedText()`, SPEC §4.12 "Removed text"). The type alone never skips a text: a `removed`
 * correction whose `after` holds other text is judged like any other, as `XREF` reports its mismatch with the record.
 */
const removesText = (c: CorrectionView): boolean => c.type === "removed" && isRemovedText(c.draft ? c.after.en : c.after);

/** Where a correction's `after` sits: `corrections[0].after` in a draft, `corrections.json: corrections[3].after.en` on a stored one. */
const afterPath = (c: CorrectionView): string => (c.draft ? extendPath(c.where, "after") : extendPath(c.where, "after", "en"));

type ExplainerPart = "how_sure" | "ai_helped" | "could_lead";
const PARTS: readonly ExplainerPart[] = ["how_sure", "ai_helped", "could_lead"];
const partIndex = new WeakMap<Inventory, Map<string, Map<ExplainerPart, StringEntry>>>();

/**
 * A finding's own English text of one explainer part, with its place and whether a stored `removed` correction rewrote it; null when
 * it has none. A correction's text is its `after` or `before`, never a part, so no correction's entry is read here.
 */
function explainerEntry(input: RuleInput, finding: FindingView, part: ExplainerPart): StringEntry | null {
  let index = partIndex.get(input.inventory);
  if (index === undefined) {
    index = new Map();
    for (const e of input.inventory.entries) {
      if (e.finding === null || e.lang !== "en") continue;
      const field = PARTS.find((p) => p === e.field);
      if (field === undefined) continue;
      const parts = index.get(e.finding) ?? new Map<ExplainerPart, StringEntry>();
      parts.set(field, e);
      index.set(e.finding, parts);
    }
    partIndex.set(input.inventory, index);
  }
  return index.get(finding.key)?.get(part) ?? null;
}

/** The finding's last rung entry (the one that gives its rung), or null. */
const lastEntry = (entries: readonly RungView[] | null): RungView | null => (entries === null ? null : entries[entries.length - 1] ?? null);

/**
 * True when a stored `removed` correction rewrote the string at `place` of the finding's record (a correction's dotted form,
 * `sources.0.url`): a rule that reads such a value from the view leaves it out (SPEC §4.12 "Removed text"), so a removal never
 * makes a stored finding fail a rule it passed.
 */
const gone = (finding: FindingView, place: string): boolean => finding.removed.has(place);

/** `gone()` for one field of a cited source: an `s` id sits in the finding's own list, a `b` id in the brief's (`resolveSource()`). */
function sourceGone(input: RuleInput, owner: FindingView, source: SourceView, field: "url" | "publisher"): boolean {
  const removed = ID_PATTERNS.briefSource.test(source.id) ? input.views.brief.removed : owner.removed;
  return removed.has(`sources.${source.index}.${field}`);
}

// ── RUNG_EVIDENCE ────────────────────────────────────────────────────────────────────────────────

/** What a route needs, worded for the message. */
const NEED_TEXT: Readonly<Record<EvidenceNeed, string>> = {
  setback: "for a setback",
  lists_rung: "that config/checkers.json lists for that rung",
  independent: "from a team other than the authors: its publisher and the finding's who differ from the original's",
  trial: "that reports a trial endpoint met, on a finding that names a trial in artefacts.trial",
};

/** The need a fact fails, worded for the message; "" when the need is met. The verdict is `evidenceFits()`'s, never this. */
function unmetReason(need: EvidenceNeed, rung: Rung, facts: EvidenceFacts, source: SourceView, kind: FindingKind | null, own: RungView | null): string {
  switch (need) {
    case "setback":
      return facts.setback ? "" : `the finding is filed as a ${kind === null ? "setback" : kind.replace("_", " ")}, not a setback`;
    case "lists_rung":
      return facts.checkerRungs !== null && facts.checkerRungs.includes(rung) ? "" : `no config/checkers.json entry lists ${source.url} for ${rungName(rung)}`;
    case "independent":
      if (facts.independent) return "";
      return own === null
        ? `${quote(source.publisher)} is the publisher of another source or a who name of the finding`
        : `${source.id} is also the source of the earlier ${rungName(own.rung)} entry, so it is the original's own`;
    case "trial":
      return facts.trial ? "" : "the finding names no trial in artefacts.trial";
  }
}

/** Every way a rung may be shown, as the table has it: "a paper; a proof; a notice (for a setback)". */
function routesText(rung: Rung): string {
  return RUNG_EVIDENCE[rung]
    .map((r) => `a ${kindName(r.kind)}${r.needs.length === 0 ? "" : ` (${r.needs.map((n) => NEED_TEXT[n]).join(", ")})`}`)
    .join("; ");
}

interface JudgedEntry {
  readonly finding: FindingView;
  readonly entry: RungView;
}

/**
 * The rung entries RUNG_EVIDENCE judges: in a draft, each entry of a new finding and each the draft adds to a stored one (the
 * returning entry's and the rung changes'); in published mode, every entry of every record, which was new once.
 */
function entriesJudged(input: RuleInput): JudgedEntry[] {
  const out: JudgedEntry[] = [];
  for (const finding of input.views.findings) {
    if (!finding.known) continue;
    const entries = input.mode === "draft" && finding.origin === "stored" ? draftRungEntries(input.views, finding.key) : finding.rung_history ?? [];
    for (const entry of entries) out.push({ finding, entry });
  }
  return out;
}

/** The rungs below Confirmed on the ladder: an entry at one of them cites the original claim's own evidence. */
const BELOW_CONFIRMED: readonly Rung[] = ["claimed", "preprint", "checked"];

/**
 * The entries of `finding` ahead of `entry`, oldest first: those before it in its own history, and for a stored finding in a draft
 * its stored history then the draft's earlier entries (`draftRungEntries()`).
 */
function entriesBefore(input: RuleInput, finding: FindingView, entry: RungView): RungView[] {
  if (input.mode === "draft" && finding.origin === "stored") {
    const added = draftRungEntries(input.views, finding.key);
    return [...(finding.rung_history ?? []), ...added.slice(0, Math.max(0, added.indexOf(entry)))];
  }
  return (finding.rung_history ?? []).filter((e) => e.index < entry.index);
}

/**
 * The earlier entry below Confirmed (Claimed, Preprint or Checked) that cites the same source as `entry`, or null. That source
 * is the original claim's own evidence, so citing it again is no confirmation from a team other than the authors, whoever else the
 * finding lists (SPEC §4.12 RUNG_EVIDENCE: the publisher and `who` "differ from the original's").
 */
function originalCitation(input: RuleInput, finding: FindingView, entry: RungView): RungView | null {
  return entriesBefore(input, finding, entry).find((e) => e.source_id === entry.source_id && BELOW_CONFIRMED.includes(e.rung)) ?? null;
}

/**
 * The facts a route may need, read for one entry. What the record does not show counts as met: a stored finding seen through the
 * context has no kind, trial, sources or `who` to read, so only the kind of its source is judged there (published mode judges
 * the whole record later). The `checkers.json` list is read for a draft and for an entry being published (`RungView.publishing`), and
 * assumed to list the rung for any other entry (SPEC §4.12 "Stored records"). The finding's facts it needs (its kind, sources, `who`
 * and trial) are read from the whole record, whichever entry is judged. The original's sources are the finding's others, a reaction aside (it is
 * another scientist's), as the record stood when the entry was recorded, and the source an earlier entry below Confirmed cites
 * (`originalCitation()`), which `own` returns.
 */
function evidenceFacts(
  input: RuleInput, finding: FindingView, entry: RungView, source: SourceView,
): { facts: EvidenceFacts; kind: FindingKind | null; own: RungView | null } {
  const recorded = entry.recorded ?? input.date;
  const kind = finding.filedOn(recorded).kind;
  const original = (finding.sources ?? []).filter((s) =>
    s.id !== source.id && s.kind !== "reaction" && (s.added === null || s.added <= recorded) && !gone(finding, `sources.${s.index}.publisher`));
  const who = (finding.who ?? []).filter((w) => !gone(finding, `who.${w.index}.name`)).map((w) => w.name);
  const own = originalCitation(input, finding, entry);
  const facts: EvidenceFacts = {
    setback: kind === null || kind === "setback",
    // A removed URL is not an address to look up, a removed publisher not a name to compare: the need counts as met.
    checkerRungs: entry.publishing && !sourceGone(input, finding, source, "url") ? checkerRungsFor(source.url, input.config) : [entry.rung],
    independent: sourceGone(input, finding, source, "publisher")
      || (own === null && isIndependent(source.publisher, { publishers: original.map((s) => s.publisher), who })),
    trial: finding.artefacts === null || finding.artefacts.trial.length > 0,
  };
  return { facts, kind, own };
}

function evidenceIssue(input: RuleInput, finding: FindingView, entry: RungView): ValidationIssue | null {
  // An id its container lacks is SOURCE_IDS's, and a container the context does not show cannot be read.
  const { source } = resolveSource(input.views, finding, entry.source_id);
  if (source === null) return null;
  const { facts, kind, own } = evidenceFacts(input, finding, entry, source);
  if (evidenceFits(entry.rung, source.kind, facts)) return null;
  const rung = rungName(entry.rung);
  const cited = `The ${rung} entry cites ${source.id}, a ${kindName(source.kind)} from ${quote(source.publisher)}`;
  const routes = RUNG_EVIDENCE[entry.rung].filter((r) => r.kind === source.kind);
  const why = routes.length === 0
    ? `A ${kindName(source.kind)} cannot show ${rung}. ${rung} is shown by ${routesText(entry.rung)}.`
    : `A ${kindName(source.kind)} shows ${rung} only as ${routes.map((r) => `a ${kindName(r.kind)}${r.needs.length === 0 ? "" : ` ${r.needs.map((n) => NEED_TEXT[n]).join(", ")}`}`).join(" or ")}, and here ${
      routes.map((r) => orList(r.needs.map((n) => unmetReason(n, entry.rung, facts, source, kind, own)).filter((t) => t !== ""))).join(", or ")}.`;
  return error(
    "RUNG_EVIDENCE", extendPath(entry.where, "source_id"), `${cited}. ${why}`,
    `Cite a source of a kind that fits (${orList(evidenceKinds(entry.rung).map(kindName))}), or give the entry the rung its source shows.`,
  );
}

const rungEvidence = defineRule({
  code: "RUNG_EVIDENCE",
  scope: ["draft", "published"],
  check: (input) => entriesJudged(input).flatMap(({ finding, entry }) => evidenceIssue(input, finding, entry) ?? []),
});

// ── RUNG_ORDER ───────────────────────────────────────────────────────────────────────────────────

/**
 * The date problems of `entries`, each against the one ahead of it (`previous` for the first, null when unknown, which leaves
 * the first only the test against `today`): dated after `today`, or before the entry ahead of it. As lib/rungs.ts
 * `rungOrderProblem()`, but every breaking entry is reported, not the first.
 */
function orderIssues(entries: readonly RungView[], previous: IsoDate | null, today: IsoDate, todayText: string, fix: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let last = previous;
  for (const entry of entries) {
    const problem = rungDateProblem(last ?? entry.date, entry.date, today);
    if (problem === "after_today") {
      issues.push(error("RUNG_ORDER", extendPath(entry.where, "date"), `The ${rungName(entry.rung)} entry is dated ${entry.date}, after ${todayText}.`, fix));
    } else if (problem === "before_last") {
      issues.push(error(
        "RUNG_ORDER", extendPath(entry.where, "date"),
        `The ${rungName(entry.rung)} entry is dated ${entry.date}, before the entry ahead of it, dated ${last}. Rung entries run oldest first.`,
        "Give each entry its event's own date in order; an entry that puts a wrong rung right is dated the edition's date (SPEC §8.9).",
      ));
    }
    last = entry.date;
  }
  return issues;
}

const rungOrder = defineRule({
  code: "RUNG_ORDER",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    if (input.mode === "draft") {
      for (const finding of input.views.findings) {
        if (!finding.known) continue;
        const stored = finding.origin === "stored";
        const entries = stored ? draftRungEntries(input.views, finding.key) : finding.rung_history ?? [];
        const previous = stored ? lastEntry(finding.rung_history)?.date ?? null : null;
        issues.push(...orderIssues(entries, previous, input.date, `${input.date}, the edition's date`, "Date the entry with the event's own date, never one after the edition's."));
      }
      return issues;
    }
    for (const finding of input.views.findings) {
      const history = finding.rung_history ?? [];
      const updated = finding.updated;
      if (updated !== null) {
        issues.push(...orderIssues(history, null, updated, `${updated}, the date the finding was last updated`, "Date the entry with the event's own date, never one after the finding's last update."));
      }
      const last = lastEntry(history);
      if (last !== null && finding.rung !== null && finding.rung !== last.rung) {
        issues.push(error(
          "RUNG_ORDER", finding.where("rung"),
          `${finding.key} has rung ${rungName(finding.rung)} but its last rung entry is ${rungName(last.rung)}.`,
          "The rung is always the last rung entry's: set rung to that entry's rung, or add the entry that moved it.",
        ));
      }
    }
    // A stored brief's rung change dated after the brief is no more possible than a rung entry dated after its edition.
    for (const change of input.views.brief.rung_changes) {
      if (change.date > input.date) {
        issues.push(error(
          "RUNG_ORDER", extendPath(change.where, "date"),
          `The rung change of ${change.finding_id} is dated ${change.date}, after the brief's date ${input.date}.`,
          "A rung change is dated the event's own date, never one after its edition.",
        ));
      }
    }
    return issues;
  },
});

// ── CLAIMED_CAP ──────────────────────────────────────────────────────────────────────────────────

function cappedIssue(path: string, finding: FindingView, rung: Rung, significance: Significance, fix: string): ValidationIssue {
  return error(
    "CLAIMED_CAP", path,
    `${finding.key} is ${sigName(significance)} but its rung is ${rungName(rung)}. A finding at Claimed or Preprint is at most Notable.`,
    fix,
  );
}

const claimedCap = defineRule({
  code: "CLAIMED_CAP",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    if (input.mode === "draft") {
      for (const finding of ownRecords(input)) {
        const significance = finding.published.significance;
        if (finding.rung !== null && significance !== null && exceedsClaimedCap(finding.rung, significance)) {
          issues.push(cappedIssue(finding.where("significance"), finding, finding.rung, significance, "Set significance to notable or watch, or cite the record that shows a higher rung."));
        }
      }
      // A stored finding is judged only where the draft touches the facts: a correction on significance, or a rung entry that may move it to Claimed or Preprint.
      for (const finding of namedStored(input)) {
        const entries = draftRungEntries(input.views, finding.key);
        const refiles = draftCorrections(input, finding, "significance");
        const moved = lastEntry(entries);
        if (moved === null && refiles.length === 0) continue;
        const rung = moved?.rung ?? finding.rung;
        const significance = finding.filedOn(input.date).significance;
        if (rung === null || significance === null || !exceedsClaimedCap(rung, significance)) continue;
        const at = refiles.length > 0 ? afterPath(refiles[refiles.length - 1]!) : extendPath(moved!.where, "rung");
        issues.push(cappedIssue(at, finding, rung, significance, "Add a correction of significance to notable or watch, or drop the rung entry that moves it to Claimed or Preprint."));
      }
      return issues;
    }
    // A record: its rung changes after publication (SPEC §5.8), so any entry above Preprint ends the cap.
    for (const finding of ownRecords(input)) {
      const history = finding.rung_history ?? [];
      const last = lastEntry(history);
      if (last === null || history.some((e) => !isClaimedRung(e.rung))) continue;
      const significance = finding.filedOn(input.date).significance;
      if (significance !== null && exceedsClaimedCap(last.rung, significance)) {
        issues.push(cappedIssue(finding.where("significance"), finding, last.rung, significance, "Lower significance to notable or watch with a correction; a finding that never passed Preprint is at most Notable."));
      }
    }
    return issues;
  },
});

// ── LANDMARK_BASIS ───────────────────────────────────────────────────────────────────────────────

/**
 * How many different affiliations stand behind the reactions that are not the finding's own people: a reaction whose `who` or
 * `affiliation` is a name of the finding's `who` list does not count, and one whose affiliation a removal rewrote counts as an
 * affiliation of its own, each by itself, since it cannot be compared (SPEC §4.12 "Removed text"). Null when the run cannot see
 * the reactions (a stored finding it was not given), which leaves the test unrun, as every rule leaves what it cannot know.
 */
function independentAffiliations(finding: FindingView): number | null {
  if (finding.reactions === null) return null;
  const team = (finding.who ?? []).filter((w) => !gone(finding, `who.${w.index}.name`)).map((w) => w.name);
  const found = new Set<string>();
  for (const r of finding.reactions) {
    if (gone(finding, `reactions.${r.index}.affiliation`)) {
      found.add(`removed:${r.index}`);
    } else if (!team.some((name) => (!gone(finding, `reactions.${r.index}.who`) && sameName(name, r.who)) || sameName(name, r.affiliation))) {
      found.add(nameKey(r.affiliation));
    }
  }
  return found.size;
}

const isHighRung = (rung: Rung): boolean => rung === "confirmed" || rung === "applied";

/**
 * The issue for a Landmark with no basis, or null when it has one: `high` says a rung of Confirmed or Applied holds it up. A rung the
 * run does not show, like the reactions it cannot see, leaves the test unrun.
 */
function landmarkIssue(finding: FindingView, rung: Rung | null, high: boolean, path: string, fix: string): ValidationIssue | null {
  const affiliations = independentAffiliations(finding);
  if (rung === null || high || affiliations === null || affiliations >= 2) return null;
  return error(
    "LANDMARK_BASIS", path,
    `${finding.key} is a Landmark with rung ${rungName(rung)}, which is not Confirmed or Applied, and its reactions come from ${plural(affiliations, "affiliation")} outside its who list (2 or more are needed).`,
    fix,
  );
}

const landmarkBasis = defineRule({
  code: "LANDMARK_BASIS",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    if (input.mode === "draft") {
      for (const finding of ownRecords(input)) {
        if (finding.published.significance !== "landmark") continue;
        const issue = landmarkIssue(finding, finding.rung, finding.rung !== null && isHighRung(finding.rung), finding.where("significance"), "Lower significance to major, or add reactions from 2 different affiliations, or cite the record that shows Confirmed or Applied.");
        if (issue !== null) issues.push(issue);
      }
      for (const finding of namedStored(input)) {
        if (finding.filedOn(input.date).significance !== "landmark") continue;
        const refiles = draftCorrections(input, finding, "significance");
        const moved = lastEntry(draftRungEntries(input.views, finding.key));
        const before = finding.rung;
        const after = moved?.rung ?? before;
        const fell = moved !== null && before !== null && isHighRung(before) && moved.rung === "checked";
        if (refiles.length === 0 && !fell) continue;
        const at = refiles.length > 0 ? afterPath(refiles[refiles.length - 1]!) : extendPath(moved!.where, "rung");
        const issue = landmarkIssue(finding, after, after !== null && isHighRung(after), at, "Add a correction of significance to major, or drop the rung entry that moves it to Checked.");
        if (issue !== null) issues.push(issue);
      }
      return issues;
    }
    // A record: its rung changes after publication (SPEC §5.8), so any entry of Confirmed or Applied in its history holds it up.
    for (const finding of ownRecords(input)) {
      if (finding.filedOn(input.date).significance !== "landmark") continue;
      const history = finding.rung_history ?? [];
      const issue = landmarkIssue(finding, finding.rung, history.some((e) => isHighRung(e.rung)), finding.where("significance"), "Lower significance to major with a correction, or add the reactions or the record that holds it up.");
      if (issue !== null) issues.push(issue);
    }
    return issues;
  },
});

// ── NON_AI_LANDMARK_ONLY and SETBACK_MAJOR ───────────────────────────────────────────────────────

/** A stored finding the brief shows: in the story, an item or the deep dive. */
interface Briefed {
  readonly finding: FindingView;
  readonly where: string;
  readonly slot: string;
}

/** The stored findings of the story, the items and the deep dive, which the edition files on its date; a new finding is judged on its own record. */
function briefedStored(input: RuleInput): Briefed[] {
  const out: Briefed[] = [];
  for (const item of shownItems(input.views)) {
    const finding = item.finding;
    if (finding !== null && finding.known && finding.origin === "stored") out.push({ finding, where: item.where, slot: item.slot === "story" ? "the story" : "an item" });
  }
  const dive = input.views.brief.deep_dive;
  const finding = dive === null ? null : input.views.find(dive.finding_id);
  if (dive !== null && finding !== null && finding.known) out.push({ finding, where: dive.where, slot: "the deep dive" });
  return out;
}

const noAiBelowLandmark = (facts: Facts): facts is Facts & { role: AiRole; significance: Significance } =>
  facts.role !== null && facts.significance !== null && breaksNonAiLandmarkOnly({ significance: facts.significance, ai: { role: facts.role } });

const nonAiLandmarkOnly = defineRule({
  code: "NON_AI_LANDMARK_ONLY",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    for (const finding of ownRecords(input)) {
      const facts = finding.published;
      if (!noAiBelowLandmark(facts)) continue;
      issues.push(error(
        "NON_AI_LANDMARK_ONLY", finding.where("ai.role"),
        `${finding.key} has ai.role none but is ${sigName(facts.significance)}. A finding with no AI role is only a Landmark.`,
        "Give it the AI role its sources show, or file it as a Landmark if it changes its field; otherwise leave it out.",
      ));
    }
    for (const { finding, where, slot } of briefedStored(input)) {
      // A record that breaks the rule as published was reported above; the edition's own filing is the case left.
      if (finding.basis === "record" && noAiBelowLandmark(finding.published)) continue;
      const facts = finding.filedOn(input.date);
      if (!noAiBelowLandmark(facts)) continue;
      issues.push(error(
        "NON_AI_LANDMARK_ONLY", where,
        `${finding.key}, in ${slot}, is filed on ${input.date} with no AI role and as ${sigName(facts.significance)}. A finding with no AI role is only a Landmark, so the brief may not show it.`,
        "Take it out of the story, the items and the deep dive.",
      ));
    }
    return issues;
  },
});

/** Why a setback breaks SETBACK_MAJOR, from the facts that are known; [] for another kind or a setback with both clauses met. */
function setbackReasons(facts: Facts): string[] {
  if (facts.kind !== "setback") return [];
  const reasons: string[] = [];
  if (facts.role === "none") reasons.push("has no AI role");
  if (facts.significance !== null && !significanceAtLeast(facts.significance, "major")) reasons.push(`is ${sigName(facts.significance)}, below Major`);
  return reasons;
}

const setbackMajor = defineRule({
  code: "SETBACK_MAJOR",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    for (const finding of ownRecords(input)) {
      const reasons = setbackReasons(finding.published);
      if (reasons.length === 0) continue;
      issues.push(error(
        "SETBACK_MAJOR", finding.where(finding.published.role === "none" ? "ai.role" : "significance"),
        `${finding.key} is a setback that ${reasons.join(" and ")}. A setback has an AI role and is Major or Landmark.`,
        "Give it the AI role its sources show and raise its significance, or file it as another kind.",
      ));
    }
    for (const { finding, where, slot } of briefedStored(input)) {
      if (finding.basis === "record" && setbackReasons(finding.published).length > 0) continue;
      const reasons = setbackReasons(finding.filedOn(input.date));
      if (reasons.length === 0) continue;
      issues.push(error(
        "SETBACK_MAJOR", where,
        `${finding.key}, in ${slot}, is filed on ${input.date} as a setback that ${reasons.join(" and ")}. A setback has an AI role and is Major or Landmark, so the brief may not show it.`,
        "Take it out of the story, the items and the deep dive.",
      ));
    }
    return issues;
  },
});

// ── AI_CONFIDENCE ────────────────────────────────────────────────────────────────────────────────

const aiConfidence = defineRule({
  code: "AI_CONFIDENCE",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    for (const finding of ownRecords(input)) {
      const ai = finding.ai;
      if (ai === null) continue;
      if (ai.role === "none" && ai.confidence !== null) {
        issues.push(error(
          "AI_CONFIDENCE", finding.where("ai.confidence"),
          `${finding.key} has ai.role none but ai.confidence ${ai.confidence}. With no AI role the confidence is null.`,
          "Set ai.confidence to null, or give the AI role the sources show.",
        ));
      } else if (ai.role !== "none" && ai.confidence === null) {
        issues.push(error(
          "AI_CONFIDENCE", finding.where("ai.confidence"),
          `${finding.key} has ai.role ${ai.role} but ai.confidence null. Only no AI role has a null confidence.`,
          "Set ai.confidence to claimed, or to confirmed when a source from someone other than the claimant backs it.",
        ));
      }
      if (ai.confidence === "confirmed" && !ai.evidence.some((e) => !e.from_claimant)) {
        issues.push(error(
          "AI_CONFIDENCE", finding.where("ai.confidence"),
          `${finding.key} has ai.confidence confirmed but no ai.evidence entry from a source other than the claimant (from_claimant false).`,
          "Add an evidence quote from a source by someone other than the maker or the lab, or set ai.confidence to claimed.",
        ));
      }
    }
    // The corrections on the AI role and its confidence (SPEC §4.10): the draft's own in draft mode, every stored one in published mode
    // (which is "judged the same way, on its own date, which no later correction changes", §4.12 "Stored records"), each against the
    // finding as the record and the filing show it on the correction's date (a draft's correction is dated the edition's).
    // A correction typed `removed` is skipped by its type here, not by its text: this asks whether the correction refiles the role or the
    // confidence, and none of that type does (`filedAs()`, items.ts; SPEC §4.10), whatever its `after`, which is read as a vocabulary id.
    for (const c of input.views.corrections) {
      if (c.type === "removed" || c.finding_id === null) continue;
      const finding = input.views.find(c.finding_id);
      if (finding === null || !finding.known) continue;
      if (c.path === "ai.role" && c.after.en !== "none" && finding.published.role === "none") {
        issues.push(error(
          "AI_CONFIDENCE", afterPath(c),
          `The correction gives ${c.finding_id} the AI role ${c.after.en}, but it was published with ai.role none, which has no evidence, system or ai_helped to be filed with.`,
          "Do not correct the role. Tell the later finding in a clarification of its explainer.found.",
        ));
      } else if (c.path === "ai.confidence" && finding.filedOn(c.date).role === "none") {
        issues.push(error(
          "AI_CONFIDENCE", afterPath(c),
          `The correction sets ai.confidence of ${c.finding_id} to ${c.after.en}, but the finding is filed with ai.role none, so its confidence is null.`,
          "Drop the correction of ai.confidence: a finding with no AI role has none.",
        ));
      }
    }
    return issues;
  },
});

// ── AI_SYSTEM_NAMED ──────────────────────────────────────────────────────────────────────────────

const aiSystemNamed = defineRule({
  code: "AI_SYSTEM_NAMED",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    for (const finding of ownRecords(input)) {
      const ai = finding.ai;
      if (ai === null || ai.role === "none") continue;
      const kind = finding.published.kind;
      if (ai.systems.length === 0) {
        if (kind === null || !SYSTEM_FREE_KINDS.includes(kind)) {
          issues.push(error(
            "AI_SYSTEM_NAMED", finding.where("ai.systems"),
            `${finding.key} has ai.role ${ai.role} and no ai.systems. Only a setback, infrastructure or policy_people finding may list none.`,
            "List each AI system a cited source names, with its maker, in the source's own words.",
          ));
        }
        continue;
      }
      const helped = explainerEntry(input, finding, "ai_helped");
      if (helped === null || helped.removed) continue;
      // A system whose name or maker a removal rewrote is not matched; with none left, the text cannot be judged.
      const systems = ai.systems.filter((s) => !gone(finding, `ai.systems.${s.index}.name`) && !gone(finding, `ai.systems.${s.index}.maker`));
      if (systems.length > 0 && !systems.some((s) => names(helped.text, s.name) && names(helped.text, s.maker))) {
        issues.push(error(
          "AI_SYSTEM_NAMED", helped.path,
          `ai_helped of ${finding.key} names none of its AI systems with their maker (${list(systems.map((s) => `${s.name} by ${s.maker}`))}).`,
          "Say what the AI did, naming a system and its maker as ai.systems lists them.",
        ));
      }
    }
    return issues;
  },
});

// ── WHO_SAYS ─────────────────────────────────────────────────────────────────────────────────────

/** A rung a `how_sure` may start with, and the source that shows it (null when the run cannot read it), with what a removal rewrote in it. */
interface Basis {
  readonly rung: Rung;
  readonly source: SourceView | null;
  readonly publisherGone: boolean;
  readonly urlGone: boolean;
}

const basisOf = (input: RuleInput, finding: FindingView, entry: RungView): Basis => {
  const { source } = resolveSource(input.views, finding, entry.source_id);
  return {
    rung: entry.rung, source,
    publisherGone: source !== null && sourceGone(input, finding, source, "publisher"),
    urlGone: source !== null && sourceGone(input, finding, source, "url"),
  };
};

/** Whether `text` names who says so for a basis: the source's publisher, or for a checker's record the checker; "unknown" where only config or a removed string could tell. */
function whoNamed(input: RuleInput, text: string, basis: Basis, readsConfig: boolean): "named" | "unnamed" | "unknown" {
  const source = basis.source;
  if (source === null || basis.publisherGone) return "unknown";
  if (names(text, source.publisher)) return "named";
  if (source.kind !== "checker") return "unnamed";
  if (!readsConfig || basis.urlGone) return "unknown";
  return checkersFor(source.url, input.config).some((c) => names(text, c.name)) ? "named" : "unnamed";
}

/**
 * The WHO_SAYS issues of one `how_sure` text: it starts with the label of one of `bases`' rungs, names who says so for such a
 * rung, and with confidence claimed names the maker of each AI system. `makers` is empty unless the confidence is claimed.
 */
function howSureIssues(input: RuleInput, text: string, path: string, bases: readonly Basis[], readsConfig: boolean, makers: readonly string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const labels = [...new Set(bases.map((b) => rungName(b.rung)))];
  const starting = bases.filter((b) => startsWithRungLabel(text, b.rung));
  if (bases.length > 0 && starting.length === 0) {
    issues.push(error(
      "WHO_SAYS", path,
      `how_sure starts with ${quote(text.slice(0, 40))}. It must start with the label of the rung: ${orList(labels.map(quote))}.`,
      `Begin how_sure with ${quote(`${labels[0]}.`)}, then name who says so.`,
    ));
  }
  if (starting.length > 0 && !starting.some((b) => whoNamed(input, text, b, readsConfig) !== "unnamed")) {
    const sources = starting.flatMap((b) => (b.source === null ? [] : [`${b.source.id} (${b.source.publisher})`]));
    const checkers = readsConfig ? [...new Set(starting.flatMap((b) => (b.source === null || b.urlGone || b.source.kind !== "checker" ? [] : checkersFor(b.source.url, input.config).map((c) => c.name))))] : [];
    issues.push(error(
      "WHO_SAYS", path,
      `how_sure does not say who says so. It must name the publisher of the source that shows the rung: ${list(sources)}${checkers.length === 0 ? "" : `, or the checker: ${list(checkers)}`}.`,
      "Say which publisher or checker shows the rung, in its own name.",
    ));
  }
  const missing = makers.filter((maker) => !names(text, maker));
  if (missing.length > 0) {
    issues.push(error(
      "WHO_SAYS", path,
      `The confidence is claimed, so how_sure must name the maker of each AI system. It does not name ${orList(missing.map(quote))}.`,
      `Say that ${missing[0]} makes the claim, or give the AI role a confirming source from someone else.`,
    ));
  }
  return issues;
}

/** The distinct makers of the finding's systems, each once and as first written, when the confidence is claimed (a maker a removal rewrote is left out). */
function makersToName(finding: FindingView, confidence: string | null): string[] {
  if (confidence !== "claimed" || finding.ai === null) return [];
  const makers = new Map<string, string>();
  for (const s of finding.ai.systems) {
    if (!gone(finding, `ai.systems.${s.index}.maker`) && !makers.has(nameKey(s.maker))) makers.set(nameKey(s.maker), s.maker);
  }
  return [...makers.values()];
}

/** The rungs a correction's `how_sure` may start with: in a draft, the finding's rung after the draft's entries; in published mode, any entry of its history. */
function correctionBases(input: RuleInput, finding: FindingView): Basis[] {
  if (input.mode !== "draft") return (finding.rung_history ?? []).map((e) => basisOf(input, finding, e));
  const entry = lastEntry(draftRungEntries(input.views, finding.key)) ?? lastEntry(finding.rung_history);
  if (entry !== null) return [basisOf(input, finding, entry)];
  return finding.rung === null ? [] : [{ rung: finding.rung, source: null, publisherGone: false, urlGone: false }];
}

const whoSays = defineRule({
  code: "WHO_SAYS",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    for (const finding of ownRecords(input)) {
      const entry = explainerEntry(input, finding, "how_sure");
      if (entry === null || entry.removed) continue;
      // A draft's finding shows its last rung; a record's rung changes after publication, so any entry of its history may be the one its text tells.
      const entries = input.mode === "draft" ? [lastEntry(finding.rung_history)] : finding.rung_history ?? [];
      const bases = entries.flatMap((e) => (e === null ? [] : [basisOf(input, finding, e)]));
      // The explainer is frozen text, so `checkers.json` is read against it only on a finding judged whole (`finding.publishing`), never on a returning one's.
      issues.push(...howSureIssues(input, entry.text, entry.path, bases, finding.publishing, makersToName(finding, finding.ai?.confidence ?? null)));
    }
    for (const c of input.views.corrections) {
      if (removesText(c) || c.finding_id === null || c.path !== "explainer.how_sure") continue;
      const finding = input.views.find(c.finding_id);
      if (finding === null || !finding.known) continue;
      issues.push(...howSureIssues(input, c.after.en, afterPath(c), correctionBases(input, finding), c.publishing, makersToName(finding, finding.filedOn(c.date).confidence)));
    }
    return issues;
  },
});

// ── POSSIBILITY ──────────────────────────────────────────────────────────────────────────────────

/** The POSSIBILITY issues of one `could_lead` text: no possibility word, and each promise. */
function possibilityIssues(written: string, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Read in NFKC, so a word typed in full-width letters is the word it looks like
  const text = written.normalize("NFKC");
  if (!POSSIBILITY_WORDS.some((word) => wordRe(word).test(text))) {
    issues.push(error(
      "POSSIBILITY", path,
      `could_lead has none of the possibility words (${list(POSSIBILITY_WORDS)}). What it could lead to is always a possibility.`,
      'Say what the result could lead to, as a possibility: "could", "might" or "if".',
    ));
  }
  for (const promise of PROMISES.filter((p) => wordRe(p).test(text))) {
    issues.push(error(
      "POSSIBILITY", path,
      `could_lead promises ${quote(promise)}. A result never promises a use or a cure.`,
      "Say it could or might happen, never that it will.",
    ));
  }
  return issues;
}

const possibility = defineRule({
  code: "POSSIBILITY",
  scope: ["draft", "published"],
  check: (input) => {
    const issues: ValidationIssue[] = [];
    for (const finding of ownRecords(input)) {
      const entry = explainerEntry(input, finding, "could_lead");
      if (entry !== null && !entry.removed) issues.push(...possibilityIssues(entry.text, entry.path));
    }
    for (const c of input.views.corrections) {
      if (removesText(c) || c.finding_id === null || c.path !== "explainer.could_lead") continue;
      issues.push(...possibilityIssues(c.after.en, afterPath(c)));
    }
    return issues;
  },
});

export const ladderAiRules: Rule[] = [
  rungEvidence, rungOrder, claimedCap, landmarkBasis, nonAiLandmarkOnly, setbackMajor, aiConfidence, aiSystemNamed, whoSays, possibility,
];
