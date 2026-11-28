// Finding helpers (SPEC §3 `lib/items.ts`): `filedAs()`, a finding as corrections refile it (§4.10); the display order of a
// brief's findings (§4.5); the two fields a finding's own record fixes (§4.4); and the predicates the rules, the metrics and
// the pages share: "a finding counts" (§4.4), the significance order (§4.2), STORY_PICK, CLAIMED_CAP, NON_AI_LANDMARK_ONLY and
// SETBACK_MAJOR (§4.12) and the ledger candidates' exclusions (§4.15). Pure: no file, no clock, no network, and a date is
// always an argument; the stored finding and the corrections are never changed.
// Cyber's lib/items.ts at the fork commit 3ced1fb, adapted: its severity rank, kind heads, ITEM_ORDER sort and the fields
// that only a Cyber item has go with Cyber's domain parts. A finding's significance rank (SIGNIFICANCE_INFO) takes the place
// of an item's severity rank, the display order is the draft's own (the story, then the items, §4.5), and `filedAs()` and the
// predicates beside it are new.

import { byCodeUnit } from "./ids";
import { isClaimedRung, isCountedRung, rungOf } from "./rungs";
import type { IsoDate } from "./schema/common";
import type { CorrectionType } from "./schema/misc";
import {
  ID_PATHS, SIGNIFICANCE_INFO, type AiConfidence, type AiRole, type FieldId, type FindingKind, type Rung, type Significance,
} from "./vocab";

// ── filedAs() (SPEC §4.10) ───────────────────────────────────────────────────────────────────────

/** The six finding paths a correction refiles, in §4.10's order. A correction at any other path changes no filing. */
export const FILING_PATHS = ["significance", "field", "subfield", "kind", "ai.role", "ai.confidence"] as const;
export type FilingPath = (typeof FILING_PATHS)[number];

/** True when `path` is one of the six FILING_PATHS. */
export function isFilingPath(path: string): path is FilingPath {
  return (FILING_PATHS as readonly string[]).includes(path);
}

/** What `filedAs()` reads and rewrites of a finding: its id and the six values a correction may refile. A stored `Finding` fits. */
export interface Filable {
  readonly id: string;
  readonly field: FieldId;
  readonly subfield: string;
  readonly kind: FindingKind;
  readonly significance: Significance;
  readonly ai: { readonly role: AiRole; readonly confidence: AiConfidence | null };
}

/**
 * What `filedAs()` reads of a correction. A stored `Correction` fits. A draft's own corrections go in as `draftFilings()`
 * makes them: dated D, with the ids publish will give them.
 */
export interface FilingCorrection {
  readonly id: string;
  readonly date: IsoDate;
  readonly finding_id: string | null;
  readonly type: CorrectionType;
  readonly path: string;
  readonly after: { readonly en: string };
}

/** True when `id` is a value `path` may be refiled to: one of its vocabulary's ids, or any text for a subfield (`SUBFIELD_UNKNOWN` checks it against `fields.json`). */
function isFilingValue(path: FilingPath, id: string): boolean {
  return path === "subfield" ? id.length > 0 : (ID_PATHS[path] as readonly string[]).includes(id);
}

/** The later of two corrections: by `date`, then by id. */
function compareFilings(a: FilingCorrection, b: FilingCorrection): number {
  return byCodeUnit(a.date, b.date) || byCodeUnit(a.id, b.id);
}

/** The latest valid correction at each filing path for this finding, dated on or before `date`. Exported for the rule views (lib/rules/views.ts), which file a finding whose record is partial. */
export function latestFilings(id: string, corrections: readonly FilingCorrection[], date: IsoDate): Map<FilingPath, string> {
  const latest = new Map<FilingPath, FilingCorrection>();
  for (const c of corrections) {
    if (c.finding_id !== id || c.type === "removed" || c.date > date) continue;
    if (!isFilingPath(c.path) || !isFilingValue(c.path, c.after.en)) continue;
    const held = latest.get(c.path);
    if (held === undefined || compareFilings(c, held) >= 0) latest.set(c.path, c);
  }
  return new Map([...latest].map(([path, c]) => [path, c.after.en]));
}

/**
 * The finding as corrections file it on `date` (SPEC §4.10): each of `significance`, `field`, `subfield`, `kind`, `ai.role` and
 * `ai.confidence` is the `after.en` of the latest correction at that path, by `date` then id, dated on or before `date`, else
 * the finding's own. A correction of type `removed` never refiles, and one whose `after.en` is not an id of the path's
 * vocabulary is ignored. A finding filed with `ai.role` `none` is filed with `ai.confidence` null, and keeps its published
 * `ai.systems` and `ai_helped`. Returns a new finding; the stored one and the corrections are not changed.
 */
export function filedAs<F extends Filable>(finding: F, corrections: readonly FilingCorrection[], date: IsoDate): F {
  const filed = latestFilings(finding.id, corrections, date);
  const role = (filed.get("ai.role") as AiRole | undefined) ?? finding.ai.role;
  const confidence = role === "none" ? null : ((filed.get("ai.confidence") as AiConfidence | undefined) ?? finding.ai.confidence);
  return {
    ...finding,
    field: (filed.get("field") as FieldId | undefined) ?? finding.field,
    subfield: filed.get("subfield") ?? finding.subfield,
    kind: (filed.get("kind") as FindingKind | undefined) ?? finding.kind,
    significance: (filed.get("significance") as Significance | undefined) ?? finding.significance,
    ai: { ...finding.ai, role, confidence },
  };
}

/** What `draftFilings()` reads of a draft's correction (`DraftCorrection`, SPEC §4.5). */
export interface DraftFiling {
  readonly finding_id: string | null;
  readonly type: CorrectionType;
  readonly path: string;
  readonly after: string;
}

/**
 * A draft's own corrections as `filedAs()` reads them (SPEC §4.10: the rules apply a draft's corrections too): dated `date`,
 * with the ids publish will give them, `C-` and four digits counted on from the highest id among `stored` and in the draft's
 * order, so a later draft correction beats an earlier one at the same path and every stored correction.
 */
export function draftFilings(draft: readonly DraftFiling[], stored: readonly { readonly id: string }[], date: IsoDate): FilingCorrection[] {
  let last = 0;
  for (const c of stored) {
    const m = /^C-(\d{4})$/.exec(c.id);
    if (m) last = Math.max(last, Number(m[1]));
  }
  return draft.map((c) => {
    last += 1;
    return { id: `C-${String(last).padStart(4, "0")}`, date, finding_id: c.finding_id, type: c.type, path: c.path, after: { en: c.after } };
  });
}

// ── Display order and the fields a finding's own record fixes ────────────────────────────────────

/**
 * The findings of a brief in display order (SPEC §4.5): the story first, then `items` as listed. Publish gives new
 * findings their ids in this order (§4.3), and the page, the chat edition and the feed print them in it.
 */
export function displayOrder<T>(story: T | null, items: readonly T[]): T[] {
  return story === null ? [...items] : [story, ...items];
}

/** A finding's two S fields that its own record fixes (SPEC §4.4): `rung` is the last `rung_history` entry's, `first_brief` the first of `briefs` (null when none). */
export function derivedFields(finding: {
  readonly rung_history: readonly { readonly rung: Rung }[];
  readonly briefs: readonly IsoDate[];
}): { rung: Rung; first_brief: IsoDate | null } {
  return { rung: rungOf(finding.rung_history), first_brief: finding.briefs[0] ?? null };
}

// ── Significance ─────────────────────────────────────────────────────────────────────────────────

/** 4 for Landmark to 1 for Watch (SIGNIFICANCE_INFO). */
export function significanceRank(significance: Significance): number {
  return SIGNIFICANCE_INFO[significance].rank;
}

/** An Array.sort comparator: the higher significance first, 0 for equal ones. */
export function compareSignificance(a: Significance, b: Significance): number {
  return significanceRank(b) - significanceRank(a);
}

/** True when `significance` is at least `min`: a story on a Monday or a Sunday is Major or Landmark (FORMAT_SECTIONS). */
export function significanceAtLeast(significance: Significance, min: Significance): boolean {
  return significanceRank(significance) >= significanceRank(min);
}

/** STORY_PICK: the index of the first item that outranks the story, or null when the story's significance is at least every item's (all as filed, §4.10). */
export function firstOutrankingStory(story: Significance, items: readonly Significance[]): number | null {
  const i = items.findIndex((item) => significanceRank(item) > significanceRank(story));
  return i < 0 ? null : i;
}

// ── Predicates on a filed finding ────────────────────────────────────────────────────────────────

/** True when the finding has an AI role: its `ai.role` is not `none`. */
export function hasAiRole(finding: { readonly ai: { readonly role: AiRole } }): boolean {
  return finding.ai.role !== "none";
}

/**
 * "A finding counts" (SPEC §4.4): its `rung` is counted (Checked, Confirmed or Applied) and it is not filed as a setback, which
 * reports harm to science and not a discovery. `kind` is the kind as filed (`filedAs()`); `rung` is the stored one.
 */
export function isCounted(finding: { readonly rung: Rung; readonly kind: FindingKind }): boolean {
  return isCountedRung(finding.rung) && finding.kind !== "setback";
}

/** CLAIMED_CAP: a finding whose rung is Claimed or Preprint is at most Notable; true when it is above that. */
export function exceedsClaimedCap(rung: Rung, significance: Significance): boolean {
  return isClaimedRung(rung) && significanceRank(significance) > significanceRank("notable");
}

/** NON_AI_LANDMARK_ONLY: `ai.role` `none` only on a Landmark; true when a finding with no AI role is below Landmark. */
export function breaksNonAiLandmarkOnly(finding: { readonly significance: Significance; readonly ai: { readonly role: AiRole } }): boolean {
  return !hasAiRole(finding) && finding.significance !== "landmark";
}

/** SETBACK_MAJOR: a setback has an AI role and is Major or Landmark; true when a setback has none or is below Major. */
export function breaksSetbackMajor(finding: {
  readonly kind: FindingKind;
  readonly significance: Significance;
  readonly ai: { readonly role: AiRole };
}): boolean {
  return finding.kind === "setback" && (!hasAiRole(finding) || !significanceAtLeast(finding.significance, "major"));
}

/**
 * True when a brief may still carry a stored finding as filed on its date (SPEC §4.10, §4.15): it is not filed with no AI role
 * below Landmark, and not filed as a setback with no AI role or below Major.
 */
export function isBriefable(finding: {
  readonly kind: FindingKind;
  readonly significance: Significance;
  readonly ai: { readonly role: AiRole };
}): boolean {
  return !breaksNonAiLandmarkOnly(finding) && !breaksSetbackMajor(finding);
}
