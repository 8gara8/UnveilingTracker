// The published-mode rules that read stored records against each other (SPEC §4.12): XREF, LANG_PARITY and FILE_LAYOUT. Every
// other rule judges one string, one finding or one brief. These three judge how the records name each other, which strings of
// a bilingual edition have Chinese, and where the files lie, so each reads everything a published-mode run was given: the
// brief, the findings, the glossary, the corrections and the reports and, in `validateAll()`'s run over a whole folder, the
// folder's own facts (`PublishedFolder`, types.ts: every file found, every brief, the archive index, the terms hidden for their
// name). A run for one brief (`validatePublished()`) has no folder: the rules then judge what they were given alone and skip what
// needs the rest (an edition other than the brief's, the file list, the archive index).
//
// XREF covers these references. A brief's finding ids (lead, story, items, rung changes, deep dive, review, the finding of a
// correction line, the finding of a report line) name a finding that exists; a brief's correction and report lines name stored
// records that exist, for the same target; a correction line's edition and term exist. Each finding's `briefs` lists every
// brief that shows it (its story, items or deep dive) and only editions that name it (SPEC §4.6); its `related` ids and its
// `terms` exist. A glossary term's `first_finding` exists. A stored correction names a finding, edition or term that exists and,
// when it answers a report, a report that exists; a report names a finding that exists and, when decided with a correction, a
// correction that exists; correction ids and report ids run C-0001, C-0002 and R-0001, R-0002 in file order. The path of each
// `removed` correction holds REMOVED_TEXT in the record it names (SPEC §4.12 "Removed text"; `removalProblem()`, lib/rules/strings.ts, the one
// definition of a removed string, which every other rule's skip reads too). The archive index lists exactly the
// stored briefs, each with its edition and publish time, and each ref in it names a finding or an edition that exists. On a run
// over the whole folder each stored brief also has the files it points at: its metrics file (`pace.metrics_file`, unless its Pace
// status is "missing") and its day's status file. XREF does not check that a term's `first_date`, a correction's `date` or a
// report's `resolved_on` is a stored edition, that a correction's `report_id` and the report's `correction_id` name each other, or
// the archive index's `finding_count` and `corrected`.
//
// LANG_PARITY follows its row word for word: in a brief with `languages.zh` true, a non-null `zh` on each `L10n` of the brief's
// own, on the `after` of each correction it lists, on the title of each finding it names, on the explainer, figure alt and terms
// of each finding it first published (a term hidden for its own name, SPEC §8.9, excepted), and on each rung note recorded on
// its date in a finding it names. Every one is fixed once published, so an English-only edition later never fails an older brief.
//
// FILE_LAYOUT allows only the paths of SPEC §3 under the content folder: a stray path, a dated file without a real date in its
// name, a finding file not named by its id, a link or a folder that could not be read as a file.
//
// Cyber's lib/validate.ts at the fork commit 3ced1fb, adapted: its `FILE_UNEXPECTED` layout check and its cross-file reference
// checks (the briefs' item ids, the archive index, the sequential correction ids) are the pattern; the references, the
// bilingual check and the removed-text check are this project's. Every function here is pure.

import { isValidDate } from "../dates";
import type { Brief } from "../schema/brief";
import { ID_PATTERNS } from "../schema/common";
import type { Finding } from "../schema/finding";
import type { Term } from "../schema/glossary";
import { REMOVED_TEXT } from "../vocab";
import { isPublished } from "./shared";
import { files, removalProblem } from "./strings";
import { defineRule, error, formatPath, plural, type PublishedInput, type Rule, type ValidationIssue } from "./types";

// ── The paths of SPEC §3 ─────────────────────────────────────────────────────────────────────────

export type ContentKind =
  | "brief" | "finding" | "metrics" | "inputs" | "status" | "pace" | "glossary" | "corrections" | "reports" | "archive";

/** What a path under the content folder is: the kind of file, and the date or finding id in its name (null for a file of one fixed name). */
export interface ContentPath {
  readonly kind: ContentKind;
  readonly key: string | null;
}

export const ARCHIVE_FILE = "archive-index.json";

const FIXED_FILES: Readonly<Record<string, ContentKind>> = {
  "state/pace-weekly.json": "pace",
  [files.glossary]: "glossary",
  [files.corrections]: "corrections",
  [files.reports]: "reports",
  [ARCHIVE_FILE]: "archive",
};

/** The folders whose files are named by a date; `metrics/inputs/` comes before `metrics/`, which it lies under. */
const DATED_DIRS: readonly { readonly prefix: string; readonly kind: ContentKind }[] = [
  { prefix: "metrics/inputs/", kind: "inputs" },
  { prefix: "briefs/", kind: "brief" },
  { prefix: "metrics/", kind: "metrics" },
  { prefix: "status/", kind: "status" },
];

const DATED_NAME = /^(\d{4}-\d{2}-\d{2})\.json$/;
const FINDINGS_DIR = "findings/";

/** The kind and key of a path of SPEC §3 (`briefs/2026-11-24.json`, `findings/math-2026-0142.json`, `glossary.json`), else null. */
export function classifyPath(rel: string): ContentPath | null {
  if (Object.hasOwn(FIXED_FILES, rel)) return { kind: FIXED_FILES[rel]!, key: null };
  for (const dir of DATED_DIRS) {
    if (!rel.startsWith(dir.prefix)) continue;
    const m = DATED_NAME.exec(rel.slice(dir.prefix.length));
    return m !== null && isValidDate(m[1]!) ? { kind: dir.kind, key: m[1]! } : null;
  }
  if (rel.startsWith(FINDINGS_DIR)) {
    const m = /^([^/]+)\.json$/.exec(rel.slice(FINDINGS_DIR.length));
    return m !== null && ID_PATTERNS.finding.test(m[1]!) ? { kind: "finding", key: m[1]! } : null;
  }
  return null;
}

const LAYOUT_LIST = "briefs/, findings/, metrics/, metrics/inputs/, status/, state/pace-weekly.json, glossary.json, corrections.json, reports.json and archive-index.json";

/** Why a path that `classifyPath()` refuses is refused, and what to do. */
function layoutProblem(rel: string): { message: string; hint: string } {
  const dated = DATED_DIRS.find((d) => rel.startsWith(d.prefix) && !rel.slice(d.prefix.length).includes("/"));
  if (dated !== undefined) {
    return { message: `${rel} must be named YYYY-MM-DD.json with a real calendar date.`, hint: "Rename it to the date of its edition, or delete it." };
  }
  if (rel.startsWith(FINDINGS_DIR) && !rel.slice(FINDINGS_DIR.length).includes("/")) {
    return { message: `${rel} must be named by the finding's id, such as math-2026-0142.json.`, hint: "Rename it to the id the finding holds, or delete it." };
  }
  return {
    message: `${rel} is outside content/'s layout (${LAYOUT_LIST}).`,
    hint: "Delete it or move it out of the content folder; publish never stages it.",
  };
}

// ── What a brief names and shows ─────────────────────────────────────────────────────────────────

/** One finding id in a brief, with its path inside the brief (`lead[0].finding_ids[1]`, `story.finding_id`). */
export interface BriefRef {
  readonly id: string;
  readonly path: string;
}

/**
 * Every finding id a brief holds, in the order of SPEC §4.6's list of what a brief names: its lead, story, items, rung changes,
 * deep dive, review (the remarkable finding, the strongest-against findings, the fallen and the setbacks), the findings of its
 * correction lines and of its report lines.
 */
export function findingRefs(brief: Brief): BriefRef[] {
  const out: BriefRef[] = [];
  const add = (id: string, ...segments: (string | number)[]): void => {
    out.push({ id, path: formatPath(segments) });
  };
  brief.lead.forEach((line, i) => line.finding_ids.forEach((id, j) => add(id, "lead", i, "finding_ids", j)));
  if (brief.story !== null) add(brief.story.finding_id, "story", "finding_id");
  brief.items.forEach((item, i) => add(item.finding_id, "items", i, "finding_id"));
  brief.rung_changes.forEach((change, i) => add(change.finding_id, "rung_changes", i, "finding_id"));
  if (brief.deep_dive !== null) add(brief.deep_dive.finding_id, "deep_dive", "finding_id");
  const review = brief.review;
  if (review !== null) {
    if (review.remarkable !== null) add(review.remarkable.finding_id, "review", "remarkable", "finding_id");
    review.strongest_against.finding_ids.forEach((id, i) => add(id, "review", "strongest_against", "finding_ids", i));
    review.fell.forEach((id, i) => add(id, "review", "fell", i));
    review.setbacks.forEach((id, i) => add(id, "review", "setbacks", i));
  }
  brief.corrections.forEach((line, i) => {
    if (line.finding_id !== null) add(line.finding_id, "corrections", i, "finding_id");
  });
  brief.reports.forEach((line, i) => add(line.finding_id, "reports", i, "finding_id"));
  return out;
}

/** The findings a brief names (SPEC §4.6), each once, in the order `findingRefs()` meets them. */
export function namedFindingIds(brief: Brief): string[] {
  return [...new Set(findingRefs(brief).map((ref) => ref.id))];
}

/**
 * The findings a brief shows as entries, each once with the first part that shows it: its story, its items and its deep dive. A
 * lead line, a rung change, the review, a correction line or a report line only points at a finding, so a finding listed in
 * `briefs` only because of those is not asked of XREF.
 */
export function shownFindingParts(brief: Brief): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const add = (id: string, part: string): void => {
    if (!out.has(id)) out.set(id, part);
  };
  if (brief.story !== null) add(brief.story.finding_id, "its story");
  for (const item of brief.items) add(item.finding_id, "its items");
  if (brief.deep_dive !== null) add(brief.deep_dive.finding_id, "its deep dive");
  return out;
}

// ── The shape of an L10n ─────────────────────────────────────────────────────────────────────────

interface L10nShape {
  readonly en: string;
  readonly zh: string | null;
}

/** True for an `L10n` as stored: an object with exactly the keys `en` (text) and `zh` (text or null). Total: any value at all, null and undefined included, gives true or false. */
export function isL10nShape(value: unknown): value is L10nShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const o = value as Record<string, unknown>;
  return keys.length === 2 && keys.includes("en") && keys.includes("zh") && typeof o.en === "string" && (o.zh === null || typeof o.zh === "string");
}

// ── XREF ─────────────────────────────────────────────────────────────────────────────────────────

const sequenceId = (prefix: "C" | "R", n: number): string => `${prefix}-${String(n).padStart(4, "0")}`;

const describeTarget = (t: { finding_id: string | null; edition_date: string | null; term_id: string | null }): string =>
  t.finding_id !== null ? `the finding ${t.finding_id}` : t.edition_date !== null ? `the edition ${t.edition_date}` : `the term ${t.term_id}`;

const sameTarget = (
  a: { finding_id: string | null; edition_date: string | null; term_id: string | null },
  b: { finding_id: string | null; edition_date: string | null; term_id: string | null },
): boolean => a.finding_id === b.finding_id && a.edition_date === b.edition_date && a.term_id === b.term_id;

/**
 * The files a stored brief points at beside the records it names, on a run over the whole folder (SPEC §3, §4.5, §8.7): the metrics
 * file of its Pace (`pace.metrics_file`) and the status file of its day. Publish commits the status file before any edition and the
 * metrics with the data-only edition, so every stored brief has both, a data-only one included. The one exception is a Pace whose
 * status is "missing", which has no metrics to point at (a version mismatch, `E_METRICS`, SPEC §8.2). A file that is there but does
 * not parse is the SCHEMA issue of its own file, as for any other record, and is not reported again here.
 */
function fileIssues(brief: Brief, hasFile: (path: string) => boolean): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const metrics = brief.pace.metrics_file;
  if (brief.pace.status !== "missing" && !hasFile(metrics)) {
    out.push(error("XREF", `${files.brief(brief.date)}: ${formatPath(["pace", "metrics_file"])}`,
      `${metrics} holds this edition's Pace numbers (status ${brief.pace.status}), but it does not exist.`,
      `Publish commits the day's metrics with the data-only edition. Restore ${metrics} from git history.`));
  }
  const status = `status/${brief.date}.json`;
  if (!hasFile(status)) {
    out.push(error("XREF", `${files.brief(brief.date)}: (status)`, `${status} is the status file of this edition's run, but it does not exist.`,
      `Publish writes the day's status file before any edition. Restore ${status} from git history.`));
  }
  return out;
}

function xrefIssues(input: PublishedInput): ValidationIssue[] {
  const { folder, findings, terms, corrections, reports } = input.published;
  const briefs = folder !== undefined ? folder.briefs : input.published.brief === null ? [] : [input.published.brief];
  const findingBy = new Map(findings.map((f) => [f.id, f]));
  const termBy = new Map(terms.map((t) => [t.id, t]));
  const correctionBy = new Map(corrections.map((c) => [c.id, c]));
  const reportBy = new Map(reports.map((r) => [r.id, r]));
  const briefBy = new Map(briefs.map((b) => [b.date, b]));
  const fileBy = new Map((folder?.files ?? []).map((f) => [f.path, f]));
  const namedBy = new Map(briefs.map((b) => [b.date, new Set(namedFindingIds(b))]));

  // What is known to be missing. A file that exists but did not parse holds records the run cannot see: its ids count as present,
  // and a whole file that did not parse (the glossary, the corrections, the reports) makes the checks that read it skip.
  const hasFile = (path: string): boolean => fileBy.get(path)?.regular === true;
  const unreadable = (path: string): boolean => fileBy.get(path)?.parsed === false;
  const findingMissing = (id: string): boolean => !findingBy.has(id) && !hasFile(files.finding(id));
  const termMissing = (id: string): boolean => !unreadable(files.glossary) && !termBy.has(id);
  const correctionMissing = (id: string): boolean => !unreadable(files.corrections) && !correctionBy.has(id);
  const reportMissing = (id: string): boolean => !unreadable(files.reports) && !reportBy.has(id);
  const editionMissing = (date: string): boolean => folder !== undefined && !briefBy.has(date) && !hasFile(files.brief(date));

  const out: ValidationIssue[] = [];
  const add = (path: string, message: string, hint: string | null = null): void => {
    out.push(error("XREF", path, message, hint));
  };

  // A brief's references.
  for (const brief of briefs) {
    const at = (...segments: (string | number)[]): string => `${files.brief(brief.date)}: ${formatPath(segments)}`;
    if (folder !== undefined) out.push(...fileIssues(brief, hasFile));
    for (const ref of findingRefs(brief)) {
      if (findingMissing(ref.id)) {
        add(`${files.brief(brief.date)}: ${ref.path}`, `${ref.id} is named here, but findings/${ref.id}.json does not exist.`,
          "Publish writes a finding's file in the same commit as the brief that names it. Restore the file, or take the id out of the brief.");
      }
    }
    brief.corrections.forEach((line, i) => {
      if (line.edition_date !== null && editionMissing(line.edition_date)) {
        add(at("corrections", i, "edition_date"), `${line.id} names the edition ${line.edition_date}, but briefs/${line.edition_date}.json does not exist.`);
      }
      if (line.term_id !== null && termMissing(line.term_id)) {
        add(at("corrections", i, "term_id"), `${line.id} names the term ${line.term_id}, but glossary.json has no such term.`);
      }
      const stored = correctionBy.get(line.id);
      if (stored === undefined) {
        if (correctionMissing(line.id)) {
          add(at("corrections", i, "id"), `${line.id} is listed here, but corrections.json has no such correction.`,
            "Publish files each correction in corrections.json as it lists it in the brief.");
        }
      } else if (!sameTarget(line, stored)) {
        add(at("corrections", i, "id"), `${line.id} is listed here for ${describeTarget(line)}, but corrections.json files it on ${describeTarget(stored)}.`);
      }
    });
    brief.reports.forEach((line, i) => {
      const stored = reportBy.get(line.id);
      if (stored === undefined) {
        if (reportMissing(line.id)) add(at("reports", i, "id"), `${line.id} is listed here, but reports.json has no such report.`);
      } else if (stored.finding_id !== line.finding_id) {
        add(at("reports", i, "id"), `${line.id} is listed here for ${line.finding_id}, but reports.json has it on ${stored.finding_id}.`);
      }
    });
    // Each finding the brief shows lists the brief.
    for (const [id, part] of shownFindingParts(brief)) {
      const finding = findingBy.get(id);
      if (finding !== undefined && !finding.briefs.includes(brief.date)) {
        add(`${files.finding(id)}: briefs`, `Its briefs list does not have ${brief.date}, but briefs/${brief.date}.json shows this finding in ${part}.`,
          "A finding lists every edition that reported it, oldest first (SPEC §4.4).");
      }
    }
  }

  // A finding's references.
  for (const finding of findings) {
    const at = (...segments: (string | number)[]): string => `${files.finding(finding.id)}: ${formatPath(segments)}`;
    finding.related.forEach((id, i) => {
      if (findingMissing(id)) add(at("related", i), `Names ${id} as related, but findings/${id}.json does not exist.`);
    });
    finding.terms.forEach((id, i) => {
      if (termMissing(id)) add(at("terms", i), `Lists the term ${id}, but glossary.json has no such term.`);
    });
    finding.briefs.forEach((date, i) => {
      const brief = briefBy.get(date);
      if (brief === undefined) {
        if (editionMissing(date)) add(at("briefs", i), `Lists ${date}, but briefs/${date}.json does not exist.`);
      } else if (!namedBy.get(date)!.has(finding.id)) {
        add(at("briefs", i), `Lists ${date}, but briefs/${date}.json does not name this finding.`,
          "A finding lists only the editions that reported it (SPEC §4.4, §4.6).");
      }
    });
  }

  // A glossary term's first finding.
  terms.forEach((term, i) => {
    if (findingMissing(term.first_finding)) {
      add(`${files.glossary}: ${formatPath(["terms", i, "first_finding"])}`, `Names ${term.first_finding} as the finding that first used it, but findings/${term.first_finding}.json does not exist.`);
    }
  });

  // Stored corrections.
  corrections.forEach((c, i) => {
    const at = (...segments: (string | number)[]): string => `${files.corrections}: ${formatPath(["corrections", i, ...segments])}`;
    if (c.finding_id !== null && findingMissing(c.finding_id)) add(at("finding_id"), `${c.id} names ${c.finding_id}, but findings/${c.finding_id}.json does not exist.`);
    if (c.edition_date !== null && editionMissing(c.edition_date)) add(at("edition_date"), `${c.id} names the edition ${c.edition_date}, but briefs/${c.edition_date}.json does not exist.`);
    if (c.term_id !== null && termMissing(c.term_id)) add(at("term_id"), `${c.id} names the term ${c.term_id}, but glossary.json has no such term.`);
    if (c.report_id !== null && reportMissing(c.report_id)) add(at("report_id"), `${c.id} answers ${c.report_id}, but reports.json has no such report.`);
    if (c.type === "removed") {
      const record: Finding | Brief | Term | undefined = c.finding_id !== null ? findingBy.get(c.finding_id)
        : c.edition_date !== null ? briefBy.get(c.edition_date) : c.term_id !== null ? termBy.get(c.term_id) : undefined;
      const problem = record === undefined ? null : removalProblem(record, c.path);
      if (problem !== null) {
        const where = c.finding_id !== null ? files.finding(c.finding_id) : c.edition_date !== null ? files.brief(c.edition_date) : `the term ${c.term_id}`;
        add(at("path"), problem === "missing"
          ? `${c.id} removes ${c.path} in ${where}, but the record has no value at that path.`
          : `${c.id} removes ${c.path} in ${where}, but the record still holds other text there; a removal rewrites the text with "${REMOVED_TEXT.en}".`,
        "Apply the removal to the record, or correct the path; the removed text is never copied into a message.");
      }
    }
  });
  out.push(...sequenceIssues(corrections, files.corrections, "corrections", "C"));

  // Stored reports.
  reports.forEach((r, i) => {
    const at = (...segments: (string | number)[]): string => `${files.reports}: ${formatPath(["reports", i, ...segments])}`;
    if (findingMissing(r.finding_id)) add(at("finding_id"), `${r.id} is about ${r.finding_id}, but findings/${r.finding_id}.json does not exist.`);
    if (r.correction_id !== null && correctionMissing(r.correction_id)) add(at("correction_id"), `${r.id} names ${r.correction_id}, but corrections.json has no such correction.`);
  });
  out.push(...sequenceIssues(reports, files.reports, "reports", "R"));

  if (folder !== undefined) out.push(...archiveIssues(input, briefBy, findingMissing, editionMissing));
  return out;
}

/** Correction ids and report ids run C-0001, C-0002 and R-0001, R-0002 in file order: a repeat is reported where it recurs, a gap or a reordering once. */
function sequenceIssues(
  items: readonly { readonly id: string }[], file: string, key: "corrections" | "reports", prefix: "C" | "R",
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const first = new Map<string, number>();
  let outOfOrder = false;
  items.forEach((item, i) => {
    const path = `${file}: ${formatPath([key, i, "id"])}`;
    const earlier = first.get(item.id);
    if (earlier !== undefined) {
      out.push(error("XREF", path, `${item.id} is used twice (also at ${key}[${earlier}]); ids are unique.`));
      return;
    }
    first.set(item.id, i);
    const expected = sequenceId(prefix, i + 1);
    if (item.id !== expected && !outOfOrder) {
      outOfOrder = true;
      out.push(error("XREF", path, `${item.id} stands where ${expected} is due; ids run ${sequenceId(prefix, 1)}, ${sequenceId(prefix, 2)} and on in file order, with no gap and no repeat.`));
    }
  });
  return out;
}

const BRIEF_REF = /^(\d{4}-\d{2}-\d{2})\/brief$/;

/** The archive index against the briefs: its editions are the stored briefs, newest first, and its refs name findings and editions that exist. */
function archiveIssues(
  input: PublishedInput, briefBy: ReadonlyMap<string, Brief>, findingMissing: (id: string) => boolean, editionMissing: (date: string) => boolean,
): ValidationIssue[] {
  const folder = input.published.folder!;
  const out: ValidationIssue[] = [];
  const add = (path: string, message: string, hint: string | null = null): void => {
    out.push(error("XREF", `${ARCHIVE_FILE}: ${path}`, message, hint));
  };
  const archive = folder.archive;
  if (archive === null) {
    if (!folder.files.some((f) => f.path === ARCHIVE_FILE) && folder.briefs.length > 0) {
      add("(file)", `${ARCHIVE_FILE} is missing but ${plural(folder.briefs.length, "brief")} ${folder.briefs.length === 1 ? "exists" : "exist"}.`,
        "Publish writes archive-index.json with every edition.");
    }
    return out;
  }
  const listed = new Set<string>();
  archive.editions.forEach((edition, i) => {
    listed.add(edition.date);
    const brief = briefBy.get(edition.date);
    if (brief === undefined) {
      if (editionMissing(edition.date)) add(formatPath(["editions", i, "date"]), `${edition.date} is listed, but briefs/${edition.date}.json does not exist.`);
      return;
    }
    if (edition.edition !== brief.edition) {
      add(formatPath(["editions", i, "edition"]), `${edition.date} is listed as ${edition.edition}, but briefs/${edition.date}.json is a ${brief.edition} edition.`);
    }
    if (Date.parse(edition.published_at) !== Date.parse(brief.published_at)) {
      add(formatPath(["editions", i, "published_at"]), `${edition.date} is listed as published at ${edition.published_at}, but briefs/${edition.date}.json says ${brief.published_at}.`);
    }
  });
  for (const brief of folder.briefs) {
    if (!listed.has(brief.date)) {
      add("editions", `briefs/${brief.date}.json is not listed.`, "Publish adds every edition to archive-index.json.");
    }
  }
  for (const [url, entry] of Object.entries(archive.urls)) {
    entry.refs.forEach((ref, i) => {
      const path = formatPath(["urls", url, "refs", i]);
      const edition = BRIEF_REF.exec(ref);
      if (edition !== null) {
        if (editionMissing(edition[1]!)) add(path, `${ref} names the brief-level text of ${edition[1]}, but briefs/${edition[1]}.json does not exist.`);
      } else if (findingMissing(ref)) {
        add(path, `${ref} is cited here, but findings/${ref}.json does not exist.`);
      }
    });
  }
  return out;
}

// ── LANG_PARITY ──────────────────────────────────────────────────────────────────────────────────

/** The path (with the language) of each `L10n` inside `value` whose `zh` is null, in document order. */
function nullZhPaths(value: unknown, segments: readonly (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((item, i) => nullZhPaths(item, [...segments, i]));
  if (typeof value !== "object" || value === null) return [];
  if (isL10nShape(value)) return value.zh === null ? [[...segments, "zh"]] : [];
  return Object.entries(value).flatMap(([key, inner]) => nullZhPaths(inner, [...segments, key]));
}

function langParityIssues(input: PublishedInput): ValidationIssue[] {
  const { folder, findings, terms, corrections } = input.published;
  const briefs = folder !== undefined ? folder.briefs : input.published.brief === null ? [] : [input.published.brief];
  const hidden = folder?.hiddenTerms ?? new Set<string>();
  const findingBy = new Map(findings.map((f) => [f.id, f]));
  const termIndex = new Map(terms.map((t, i) => [t.id, i]));
  const correctionIndex = new Map(corrections.map((c, i) => [c.id, i]));
  const out: ValidationIssue[] = [];

  for (const brief of briefs) {
    if (!brief.languages.zh) continue;
    const date = brief.date;
    const both = `briefs/${date}.json is in both languages (languages.zh is true), so `;
    const hint = "An edition in both languages has Chinese for each of these strings; the Chinese pass writes it before publish (SPEC §4.6). Without it the edition is published English-only, with languages.zh false.";
    const add = (path: string, message: string): void => {
      out.push(error("LANG_PARITY", path, message, hint));
    };

    // Each `L10n` of the brief's own.
    for (const segments of nullZhPaths(brief)) {
      add(`${files.brief(date)}: ${formatPath(segments)}`, `${both}${formatPath(segments.slice(0, -1))} needs a Chinese string.`);
    }
    // The `after` of each correction it lists.
    for (const line of brief.corrections) {
      const i = correctionIndex.get(line.id);
      if (i !== undefined && corrections[i]!.after.zh === null) {
        add(`${files.corrections}: ${formatPath(["corrections", i, "after", "zh"])}`, `${both}the after text of ${line.id}, which it lists, needs a Chinese string.`);
      }
    }
    // The title of each finding it names, and each rung note recorded on its date.
    for (const id of namedFindingIds(brief)) {
      const finding = findingBy.get(id);
      if (finding === undefined) continue;
      if (finding.title.zh === null) add(`${files.finding(id)}: ${formatPath(["title", "zh"])}`, `${both}the title of ${id}, which it names, needs a Chinese string.`);
      finding.rung_history.forEach((entry, i) => {
        if (entry.recorded === date && entry.note !== null && entry.note.zh === null) {
          add(`${files.finding(id)}: ${formatPath(["rung_history", i, "note", "zh"])}`, `${both}the rung note of ${id} recorded on ${date} needs a Chinese string.`);
        }
      });
    }
    // The explainer, figure alt text and terms of each finding it first published.
    for (const finding of findings) {
      if (finding.first_brief !== date) continue;
      const own = (segments: readonly (string | number)[], what: string): void =>
        add(`${files.finding(finding.id)}: ${formatPath(segments)}`, `${both}${what} of ${finding.id}, which it first published, needs a Chinese string.`);
      for (const segments of nullZhPaths(finding.explainer, ["explainer"])) own(segments, `the explainer part ${String(segments[1])}`);
      for (const segments of nullZhPaths(finding.figure?.alt ?? null, ["figure", "alt"])) own(segments, "the figure's alt text");
      for (const id of finding.terms) {
        const i = termIndex.get(id);
        if (i !== undefined && terms[i]!.zh === null && !hidden.has(id)) {
          add(`${files.glossary}: ${formatPath(["terms", i, "zh"])}`, `${both}the term ${id}, which ${finding.id} lists and it first published, needs a Chinese form.`);
        }
      }
    }
  }
  return out;
}

// ── FILE_LAYOUT ──────────────────────────────────────────────────────────────────────────────────

function fileLayoutIssues(input: PublishedInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const file of input.published.folder?.files ?? []) {
    const at = (rest: string): string => `${file.path}: ${rest}`;
    if (!file.regular) {
      out.push(error("FILE_LAYOUT", at("(file)"), `${file.path} is a link, a special file or a folder that could not be read, not a file of content/.`,
        "Delete it; content/ holds regular files only."));
      continue;
    }
    const kind = classifyPath(file.path);
    if (kind === null) {
      const problem = layoutProblem(file.path);
      out.push(error("FILE_LAYOUT", at("(file)"), problem.message, problem.hint));
    } else if (kind.kind === "finding" && file.id !== null && file.id !== kind.key) {
      out.push(error("FILE_LAYOUT", at("id"), `${file.path} holds the finding ${file.id}, so it must be named ${file.id}.json.`,
        "A finding's file is named by the id it holds."));
    }
  }
  return out;
}

// ── Terms hidden for their own name ──────────────────────────────────────────────────────────────

const TERM_NAME_PATH = /^glossary\.json: terms\[(0|[1-9][0-9]*)\]\.(?:id|en\.term|zh\.term|zh\.official|zh\.official_url)$/;

/**
 * The ids of the glossary terms that fail DUAL_USE or BLOCKED_HOST in their own name (SPEC §8.9): the term's `id`, its `term` in
 * either language, its `official` or its `official_url`. Read from the issues of those two codes, at either severity, on
 * `glossary.json`'s `terms[i]` name paths; the safety rules say what fails, this only maps it back to the term.
 */
export function hiddenTermIds(issues: readonly ValidationIssue[], terms: readonly Pick<Term, "id">[]): Set<string> {
  const out = new Set<string>();
  for (const issue of issues) {
    if (issue.code !== "DUAL_USE" && issue.code !== "BLOCKED_HOST") continue;
    const m = TERM_NAME_PATH.exec(issue.path);
    const term = m === null ? undefined : terms[Number(m[1])];
    if (term !== undefined) out.add(term.id);
  }
  return out;
}

// ── The rules ────────────────────────────────────────────────────────────────────────────────────

const xref = defineRule({
  code: "XREF",
  scope: "published",
  check: (input) => (isPublished(input) ? xrefIssues(input) : []),
});

const langParity = defineRule({
  code: "LANG_PARITY",
  scope: "published",
  check: (input) => (isPublished(input) ? langParityIssues(input) : []),
});

const fileLayout = defineRule({
  code: "FILE_LAYOUT",
  scope: "published",
  check: (input) => (isPublished(input) ? fileLayoutIssues(input) : []),
});

/** The published group, in the code table's order: XREF, LANG_PARITY, FILE_LAYOUT. */
export const publishedRules: Rule[] = [xref, langParity, fileLayout];
