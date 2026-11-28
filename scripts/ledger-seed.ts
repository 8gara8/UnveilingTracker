// npm run ledger:seed -- --in seed/ledger [--verify] [--out DIR] [--json]: P2's tool for the Landmark history (SPEC §8.13, §10 P2 step 4).
// It reads every file of `seed/ledger/` (a `SeedFinding`, lib/schema/seed.ts), checks the file names, gives each finding its id by
// `first_published` then file name (§4.1: the counter runs across all fields within the year), applies every stored `removed`
// correction of the content folder to the findings and terms the files make (§4.10, so a rerun keeps a removal), validates each file
// with the finding rules and the Chinese rules, and, with `--out DIR`, writes `findings/<id>.json` (`history: true`, `first_brief: null`),
// the terms into `glossary.json` and an entry for each source URL into `archive-index.json`, keeping the other entries. A rerun on the
// same files and snapshots is byte-identical: every date comes from the file's `seeded`.
//
//   tsx scripts/ledger-seed.ts --in DIR [--verify] [--out DIR] [--json]
//
// `--verify` (run on Kobol) reads the page of each source URL and of each term's `official_url` (one already in cache/snapshots/ is read,
// the others are taken in rounds until each has been started: scripts/lib/snapshot.ts); `buildEvidence()` from the snapshots alone is
// the evidence the page-text checks read (QUOTE_VERBATIM, NUMBER_SOURCED, ARTEFACT_FORMAT's artefact test, PRIMARY_ONLY's type check and
// ZH_OFFICIAL's page text), and SEED_SOURCES takes the place of SOURCE_SEEN: every source URL has a page snapshot. Without it no page is
// read, and those checks are skipped with one warning. A seed with a source that has no snapshot gets SEED_SOURCES for it, and its
// page-text checks are skipped (a quote cannot be found in a page nobody read; SEED_SOURCES is the one error for it). A source whose
// address a stored `removed` correction rewrote (`sources.<n>.url` is `REMOVED_TEXT`) has no page to read: it is requested by no GET, is
// no SEED_SOURCES failure and has no archive-index entry, and its seed's page-text checks are skipped with one warning.
//
// The rule engine has draft, published and Chinese modes and no seed mode. Each seed is judged as the finding it will be: the English
// draft rules on a one-finding draft (an item on a weekday of the seed's date), the Chinese rules on a one-finding Chinese draft built
// from the file's own Chinese, and, called directly as §4.12 says, `subfieldIssue()` (SUBFIELD_UNKNOWN, at `seeds[<i>].subfield`, `i`
// the file's place in the order that gives the ids), `rungLabelProblem()` (ZH_RUNG_LABEL, on each `explainer.how_sure`) and
// `invisibleIssues()` (the door that turns back a string with an invisible character, as validateDraft() does). ZH_OFFICIAL's host test
// (`officialUrlProblem()`) and page check run in the Chinese pass. The rules that judge a brief or a run (the counts of a day, the story,
// the dates of an edition, DUPLICATE, RETURN_NEW_FACT, the report rules) judge no single seed and do not run.
//
// Exit 0 written (or valid, without `--out`), 1 invalid, 2 usage or an input that cannot be read. Nothing is written when any file is invalid.
//
// Cyber has no Ledger; the `Io` seam, `UsageError`, strict `parseArgs`, the `startedAsScript()` guard and the EPIPE handling are
// scripts/validate.ts's (Cyber's pattern). `snapshotUrls()` and `readSnapshot()` are Cyber's (scripts/lib/snapshot.ts), `buildEvidence()`
// Cyber's (scripts/lib/evidence.ts), as SPEC §8.13 says.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { ConfigError, loadConfig, type LoadedConfig } from "../lib/config";
import { addDays, weekday } from "../lib/dates";
import { byCodeUnit, compareFindingIds, termIdOf } from "../lib/ids";
import { jsonText } from "../lib/json";
import { fixedApplies } from "../lib/zh";
import { RULES } from "../lib/rules";
import { subfieldIssue } from "../lib/rules/history";
import { officialUrlProblem, rungLabelProblem } from "../lib/rules/zh";
import { error, warning, type Rule, type ValidationIssue } from "../lib/rules/types";
import { TermId } from "../lib/schema/common";
import { AgentContext } from "../lib/schema/context";
import { DraftBrief, isRemovablePath } from "../lib/schema/draft";
import { DraftZh, ZhContext, type ZhString, type ZhTerm } from "../lib/schema/draft-zh";
import { Finding } from "../lib/schema/finding";
import { GlossaryFile, type Term } from "../lib/schema/glossary";
import { ArchiveIndex, CorrectionsFile, type Correction } from "../lib/schema/misc";
import { SEED_FILE_RE, SeedFinding } from "../lib/schema/seed";
import { contentDir } from "../lib/site";
import { mentionsAnthropicText } from "../lib/text";
import { hostMatches, hostOf, normalizeUrl } from "../lib/urls";
import { doorIssues, invisibleIssues, schemaIssues, validateDraft, validateZh } from "../lib/validate";
import {
  AI_ROLES, AI_ROLE_INFO, ALL_RUNGS, FIELDS, FIELD_CODE_OF, FIELD_INFO, REMOVED_TEXT, RUNG_INFO, SIGNIFICANCE, SIGNIFICANCE_INFO,
  SOURCE_KIND_INFO, formatForWeekday, type FieldId,
} from "../lib/vocab";
import { buildEvidence } from "./lib/evidence";
import { SNAPSHOT_LIMITS, readSnapshot, snapshotHashes, snapshotUrls, type Snapshot } from "./lib/snapshot";
import type { Clock } from "./lib/clock";
import type { fetchFeed } from "../lib/feeds/http";

export const USAGE = "Usage: npm run ledger:seed -- --in DIR [--verify] [--out DIR] [--json]";

/** A mistake in the command line: exit 2 with the message and the usage text on standard error. */
export class UsageError extends Error {}

/** An input the run cannot use (an unreadable folder): exit 2 with the message alone. */
export class InputError extends Error {}

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  /** The repository root `config/`, `cache/snapshots/` and a relative `--in` or `--out` are read from; default the working directory. */
  root?: string;
  /** Tests: the GET (default fetchFeed(), which reads `UT_FIXTURE_FEEDS` when it is set) and the clock for a snapshot's `fetched_at`. */
  fetch?: typeof fetchFeed;
  now?: Clock;
}

const DEFAULT_IO: Io = { out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`) };

// ── Reading the files ────────────────────────────────────────────────────────────────────────────

/** One seed file that loaded: its name in the folder and its parsed record. */
export interface LoadedSeed {
  name: string;
  seed: SeedFinding;
}

/** A loaded seed with the id the script gives it. */
export interface IdentifiedSeed extends LoadedSeed {
  id: string;
}

/** A file's issue: the path names the file first (`2019-05-01-01.json: explainer.found.zh`), the way validateAll() names a stored file. */
function inFile(name: string, issue: ValidationIssue): ValidationIssue {
  return { ...issue, path: issue.path === "(root)" ? name : `${name}: ${issue.path}` };
}

/**
 * Reads the folder: every entry that does not start with "." must be a regular file named `<first_published>-<nn>.json` (§3), with that date
 * the seed's own `first_published`; each is parsed as a `SeedFinding`, a string with an invisible character being a SCHEMA issue at its path
 * (§4.1, the same door as a draft's: `invisibleIssues()`). The files that load are returned in code-unit order of their names.
 */
export function readSeedFiles(dir: string): { files: LoadedSeed[]; issues: ValidationIssue[] } {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new InputError(`Cannot read the seed folder ${dir}.`);
  }
  const files: LoadedSeed[] = [];
  const issues: ValidationIssue[] = [];
  for (const entry of entries.sort((a, b) => byCodeUnit(a.name, b.name))) {
    const name = entry.name;
    if (name.startsWith(".")) continue;
    const match = SEED_FILE_RE.exec(name);
    if (!entry.isFile() || match === null) {
      issues.push(error("SCHEMA", name, `${name} is not a seed file: a seed file is a regular file named <first_published>-<nn>.json, such as 2019-05-01-01.json (SPEC §3).`,
        "Rename the file, or move it out of seed/ledger/."));
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      issues.push(error("SCHEMA", name, `${name} is not valid JSON.`, "A seed file is one JSON object."));
      continue;
    }
    const parsed = SeedFinding.safeParse(raw);
    const invisible = invisibleIssues(raw);
    if (!parsed.success || invisible.listed.length > 0) {
      for (const issue of doorIssues(parsed.success ? [] : schemaIssues(parsed.error, raw), invisible)) issues.push(inFile(name, issue));
      continue;
    }
    if (parsed.data.first_published !== match[1]) {
      issues.push(error("SCHEMA", `${name}: first_published`, `The file ${name} is named for ${match[1]} but its first_published is ${parsed.data.first_published}.`,
        "A seed file is named <first_published>-<nn>.json (SPEC §3): ids follow the file names, which never change after P2."));
      continue;
    }
    files.push({ name, seed: parsed.data });
  }
  return { files, issues };
}

/** The seeds in the order that gives ids: `first_published`, then file name (§8.13). */
export function orderSeeds(files: readonly LoadedSeed[]): LoadedSeed[] {
  return [...files].sort((a, b) => byCodeUnit(a.seed.first_published, b.seed.first_published) || byCodeUnit(a.name, b.name));
}

/** Gives each seed its id: its field's code, the year of `first_published` and a counter across all fields within that year (§4.1), from 1. */
export function identifySeeds(files: readonly LoadedSeed[]): IdentifiedSeed[] {
  const counters = new Map<string, number>();
  return orderSeeds(files).map(({ name, seed }) => {
    const year = seed.first_published.slice(0, 4);
    const n = (counters.get(year) ?? 0) + 1;
    counters.set(year, n);
    return { name, seed, id: `${FIELD_CODE_OF[seed.field]}-${year}-${String(n).padStart(4, "0")}` };
  });
}

// ── Removed text ─────────────────────────────────────────────────────────────────────────────────

const isL10n = (v: unknown): v is { en: string; zh: string } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).sort(byCodeUnit).join(",") === "en,zh"
  && typeof (v as { en: unknown }).en === "string" && typeof (v as { zh: unknown }).zh === "string";

/** The container and key of `dotted` in `root` (a list index is a number segment), or null when the path leads nowhere. */
export function slot(root: unknown, dotted: string): { holder: Record<string, unknown>; key: string } | null {
  const segments = dotted.split(".");
  let cur: unknown = root;
  for (const seg of segments.slice(0, -1)) {
    if (typeof cur !== "object" || cur === null || !Object.hasOwn(cur, seg)) return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  const key = segments.at(-1)!;
  if (typeof cur !== "object" || cur === null || !Object.hasOwn(cur, key)) return null;
  return { holder: cur as Record<string, unknown>, key };
}

/** What a seed file holds at a correction's path: `absent` (no such path, or no text there), `removed` (`REMOVED_TEXT`, in both languages of an L10n) or `holds` (other text). */
type Holding = "absent" | "removed" | "holds";

function holdingAt(root: unknown, dotted: string): Holding {
  const at = slot(root, dotted);
  if (at === null) return "absent";
  const value = at.holder[at.key];
  if (typeof value === "string") return value === REMOVED_TEXT.en ? "removed" : "holds";
  if (isL10n(value)) return value.en === REMOVED_TEXT.en && value.zh === REMOVED_TEXT.zh ? "removed" : "holds";
  return "absent";
}

/** Writes `REMOVED_TEXT` at the path: the English into a plain string, both languages into an L10n. A path with no text is left as it is. */
function rewriteAt(root: unknown, dotted: string): void {
  const at = slot(root, dotted);
  if (at === null) return;
  const value = at.holder[at.key];
  if (typeof value === "string") at.holder[at.key] = REMOVED_TEXT.en;
  else if (isL10n(value)) at.holder[at.key] = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh };
}

/** Whether a source's address is the one a stored `removed` correction left (`sources.<n>.url`, §4.10): there is no page to read or to cite. */
const isRemovedUrl = (url: string): boolean => url === REMOVED_TEXT.en;

/** The `removed` corrections that name a finding or a term: the only ones that rewrite stored text (§4.10). */
const removedOnes = (corrections: readonly Correction[]): Correction[] =>
  corrections.filter((c) => c.type === "removed" && (c.finding_id !== null ? isRemovablePath("finding", c.path) : c.term_id !== null && isRemovablePath("term", c.path)));

/**
 * The glossary id of a term a seed defines (`termIdOf()`, §4.3), or null when it has no valid one: a term with no letter a to z or digit (`光`)
 * has an empty id, and one whose id passes `TERM_ID_MAX` (60) characters has none that fits. TERM_DEFINED refuses both (§4.3), so the run leaves such a term
 * out of the glossary and the Chinese run and reports that one error, instead of failing on an id no schema accepts.
 */
export function newTermId(term: string): string | null {
  const id = termIdOf(term);
  return TermId.safeParse(id).success ? id : null;
}

/** The seed's new terms whose id is `termId`, with the place of each in `seed.terms`. */
function termsAdded(seed: SeedFinding, termId: string): Extract<SeedFinding["terms"][number], { new: true }>[] {
  return seed.terms.flatMap((t) => (t.new && termIdOf(t.term) === termId ? [t] : []));
}

/**
 * The seed with every stored `removed` correction applied (§8.13): those on its finding id rewrite the path they name, those on a term it
 * adds rewrite that term's definition in both languages. A correction on a path the file does not hold, or that holds no text, changes
 * nothing. Returns a copy.
 */
export function applyRemovals(seed: SeedFinding, id: string, corrections: readonly Correction[]): SeedFinding {
  const out = structuredClone(seed);
  for (const c of removedOnes(corrections)) {
    if (c.finding_id === id) rewriteAt(out, c.path);
    else if (c.term_id !== null) {
      for (const t of termsAdded(out, c.term_id)) {
        t.definition = REMOVED_TEXT.en;
        t.zh.definition = REMOVED_TEXT.zh;
      }
    }
  }
  return out;
}

/** Whether the seed file still holds text that a stored `removed` correction removed, on its finding or on a term it adds (§8.13). */
function stillHolds(seed: SeedFinding, id: string, corrections: readonly Correction[]): boolean {
  return removedOnes(corrections).some((c) => {
    if (c.finding_id === id) return holdingAt(seed, c.path) === "holds";
    if (c.term_id === null) return false;
    return termsAdded(seed, c.term_id).some((t) => t.definition !== REMOVED_TEXT.en || t.zh.definition !== REMOVED_TEXT.zh);
  });
}

/** The content folder's corrections: [] when there is no file; a file that does not parse is an issue and reads as none. */
function readCorrections(dir: string): { corrections: Correction[]; issues: ValidationIssue[] } {
  const file = path.join(dir, "corrections.json");
  if (!fs.existsSync(file)) return { corrections: [], issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { corrections: [], issues: [error("SCHEMA", "corrections.json", "corrections.json is not valid JSON, so no removed correction could be applied.")] };
  }
  const parsed = CorrectionsFile.safeParse(raw);
  if (!parsed.success) return { corrections: [], issues: schemaIssues(parsed.error, raw).map((i) => inFile("corrections.json", i)) };
  return { corrections: parsed.data.corrections, issues: [] };
}

/**
 * The seed files that still hold text a stored `removed` correction removed (§8.13): those that hold anything but `REMOVED_TEXT` at the
 * path of such a correction on their finding (matched by the id the script gives it) or on a term they add (an L10n counts as removed
 * only when both its languages hold it). A correction on a path the file does not hold is neither applied nor listed. The names are in
 * code-unit order; the morning's finish adds a Notes entry for each (§8.8).
 */
export function unremovedSeeds(o: { seedDir?: string; contentDir?: string; root?: string } = {}): string[] {
  const root = path.resolve(o.root ?? process.cwd());
  const seedDir = path.resolve(root, o.seedDir ?? "seed/ledger");
  const folder = path.resolve(root, o.contentDir ?? contentDir());
  const { corrections } = readCorrections(folder);
  if (corrections.length === 0) return [];
  const { files } = readSeedFiles(seedDir);
  return identifySeeds(files).filter((s) => stillHolds(s.seed, s.id, corrections)).map((s) => s.name).sort(byCodeUnit);
}

// ── The records the script writes ────────────────────────────────────────────────────────────────

/** The English strings of a finding: every string outside the Chinese half of an L10n, as `mentionsAnthropic()` reads them (§4.4). */
function englishStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) englishStrings(v, out);
  else if (isL10n(value)) out.push(value.en);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) englishStrings(v, out);
  return out;
}

/**
 * `disclosure` of a finding (§4.4): Anthropic or Claude as whole words in any English string of it (its sources' titles and URLs included, a
 * maker of `ai.systems` too), or a cited source on a host of `labs.json`'s `anthropic` entry.
 */
export function disclosureOf(finding: Pick<Finding, "sources"> & object, config: Pick<LoadedConfig, "labs">): boolean {
  if (englishStrings(finding).some((s) => mentionsAnthropicText(s))) return true;
  const hosts = config.labs.labs.find((l) => l.id === "anthropic")?.hosts ?? [];
  return finding.sources.some((s) => {
    const host = hostOf(s.url);
    return host !== null && hosts.some((h) => hostMatches(host, h));
  });
}

/** The stored finding of a seed (§4.4): `depth` item, `history` true, no brief, every date the file's `seeded`. */
export function findingOf(item: IdentifiedSeed, config: Pick<LoadedConfig, "labs">): Finding {
  const { seed } = item;
  const record = {
    schema_version: 1 as const,
    id: item.id,
    field: seed.field,
    subfield: seed.subfield,
    kind: seed.kind,
    title: seed.title,
    depth: "item" as const,
    explainer: seed.explainer,
    go_deeper: seed.go_deeper,
    ai: seed.ai,
    significance: seed.significance,
    rung: seed.rung_history.at(-1)!.rung,
    rung_history: seed.rung_history.map((r) => ({ rung: r.rung, date: r.date, recorded: seed.seeded, source_id: r.source_id, by: r.by, note: r.note })),
    since_then: [],
    sources: seed.sources.map((s) => ({ ...s, seen_as: "seed" as const, added: seed.seeded })),
    reactions: seed.reactions,
    artefacts: seed.artefacts,
    figure: seed.figure,
    who: seed.who,
    terms: seed.terms.flatMap((t) => (t.new ? (newTermId(t.term) ?? []) : [t.id])),
    related: seed.related,
    first_published: seed.first_published,
    first_brief: null,
    briefs: [],
    history: true,
    applications: [] as [],
    updated: seed.seeded,
  };
  return Finding.parse({ ...record, disclosure: disclosureOf(record as unknown as Finding, config) });
}

/** One term the seeds define, with the files that add it. */
interface TermEntry {
  id: string;
  term: string;
  definition: string;
  zh: NonNullable<Term["zh"]>;
  /** The files that define it (`new: true`), in the order that gives ids. */
  definedIn: string[];
}

/**
 * The glossary terms of the seeds in the order that gives ids: a term defined (`new: true`) in several files must be defined alike, and a
 * term listed with `new: false` must be defined by some seed or already be in `existing` with its Chinese (a seed has both languages). Terms a seed defines replace a stored term of
 * the same id. The issues name `seeds[<i>].terms[<j>]`.
 */
function termTable(items: readonly IdentifiedSeed[], existing: ReadonlyMap<string, Term>): { table: Map<string, TermEntry>; issues: ValidationIssue[] } {
  const table = new Map<string, TermEntry>();
  const issues: ValidationIssue[] = [];
  items.forEach((item, i) => {
    item.seed.terms.forEach((t, j) => {
      if (!t.new) return;
      const id = newTermId(t.term);
      if (id === null) return;
      const entry: TermEntry = { id, term: t.term, definition: t.definition, zh: t.zh, definedIn: [item.name] };
      const have = table.get(id);
      if (have === undefined) {
        table.set(id, entry);
      } else if (have.term !== entry.term || have.definition !== entry.definition || JSON.stringify(have.zh) !== JSON.stringify(entry.zh)) {
        issues.push(error("SCHEMA", `seeds[${i}].terms[${j}]`, `${item.name} defines the term "${t.term}" differently from ${have.definedIn[0]}: a term has one English term, one definition and one Chinese, wherever it is listed.`,
          "Copy the term as it is in the first file that defines it, or list it there with new: false."));
      } else {
        have.definedIn.push(item.name);
      }
    });
  });
  items.forEach((item, i) => {
    item.seed.terms.forEach((t, j) => {
      if (t.new || table.has(t.id)) return;
      const have = existing.get(t.id);
      if (have !== undefined && have.zh !== null) return;
      issues.push(error("SCHEMA", `seeds[${i}].terms[${j}].id`,
        have === undefined
          ? `${item.name} lists the term "${t.id}" as existing, but no seed defines it and the glossary does not hold it.`
          : `${item.name} lists the term "${t.id}" as existing, but the glossary holds it with no Chinese yet, and a seed has both languages.`,
        "Define the term (new: true, with its definition and its Chinese) in the first file that uses it."));
    });
  });
  return { table, issues };
}

/** The glossary terms the seeds add: `first_finding` the first finding by `first_published` then file name that lists the term, `first_date` that file's `seeded`. */
function termsOf(items: readonly IdentifiedSeed[], table: ReadonlyMap<string, TermEntry>): Term[] {
  const fields = new Map<string, Set<FieldId>>();
  const first = new Map<string, IdentifiedSeed>();
  for (const item of items) {
    for (const t of item.seed.terms) {
      const id = t.new ? newTermId(t.term) : t.id;
      if (id === null || !table.has(id)) continue;
      if (!first.has(id)) first.set(id, item);
      (fields.get(id) ?? fields.set(id, new Set()).get(id)!).add(item.seed.field);
    }
  }
  return [...table.values()].map((e) => ({
    id: e.id,
    en: { term: e.term, definition: e.definition },
    zh: { term: e.zh.term, definition: e.zh.definition, official: e.zh.official, official_url: e.zh.official_url },
    fields: FIELDS.filter((f) => fields.get(e.id)!.has(f)),
    first_finding: first.get(e.id)!.id,
    first_date: first.get(e.id)!.seed.seeded,
  }));
}

/** The archive-index entry of each source URL the seeds cite (§8.13), keyed by `normalizeUrl()`, in code-unit order of the key. */
function archiveUrls(items: readonly IdentifiedSeed[], hashes: ReturnType<typeof snapshotHashes>): ArchiveIndex["urls"] {
  const cited = new Map<string, { dates: string[]; refs: string[] }>();
  for (const item of items) {
    for (const s of item.seed.sources) {
      if (isRemovedUrl(s.url)) continue;
      const key = normalizeUrl(s.url);
      const entry = cited.get(key) ?? { dates: [], refs: [] };
      entry.dates.push(item.seed.seeded);
      if (!entry.refs.includes(item.id)) entry.refs.push(item.id);
      cited.set(key, entry);
    }
  }
  const out: ArchiveIndex["urls"] = {};
  for (const key of [...cited.keys()].sort(byCodeUnit)) {
    const { dates, refs } = cited.get(key)!;
    const hash = Object.hasOwn(hashes, key) ? hashes[key]! : null;
    out[key] = {
      first_cited: [...dates].sort(byCodeUnit)[0]!,
      refs: refs.sort(compareFindingIds).slice(0, 20),
      sha256: hash?.sha256 ?? null,
      hashed_at: hash?.fetched_at ?? null,
      last_check: null,
    };
  }
  return out;
}

// ── Judging a seed ───────────────────────────────────────────────────────────────────────────────

/** The codes of the English draft rules that judge one finding (§4.12); SOURCE_SEEN is SEED_SOURCES here, SUBFIELD_UNKNOWN is called directly. */
const ENGLISH_CODES: ReadonlySet<string> = new Set([
  "COUNTS", "SOURCE_IDS", "RUNG_EVIDENCE", "RUNG_ORDER", "CLAIMED_CAP", "LANDMARK_BASIS", "NON_AI_LANDMARK_ONLY", "SETBACK_MAJOR",
  "AI_CONFIDENCE", "AI_SYSTEM_NAMED", "WHO_SAYS", "POSSIBILITY", "PRIMARY_ONLY", "SOURCE_URL", "GO_DEEPER", "FIGURE_LICENCE", "ARTEFACT_FORMAT",
  "QUOTE_VERBATIM", "NUMBER_SOURCED", "WORDS", "SENTENCE_LENGTH", "HYPE_WORDS", "TERM_DEFINED", "READING_LEVEL", "NO_EM_DASH", "DUAL_USE",
  "SECRET_LIKE", "CANARY", "BLOCKED_HOST",
]);

/** The codes of the Chinese rules: ZH_RUNG_LABEL is called directly (`rungLabelProblem()`), the rest run on the Chinese draft. */
const CHINESE_CODES: ReadonlySet<string> = new Set([
  "ZH_KEYS", "ZH_PARITY", "ZH_TRADITIONAL", "ZH_AVOID", "ZH_TERMS", "ZH_ENGLISH_ONCE", "ZH_CHARS", "ZH_OFFICIAL", "ZH_NO_DASH", "ZH_HYPE",
  "DUAL_USE", "SECRET_LIKE", "CANARY", "BLOCKED_HOST",
]);

const rulesFor = (mode: "draft" | "zh", codes: ReadonlySet<string>): Rule[] => RULES.filter((r) => r.scope.includes(mode) && r.codes.some((c) => codes.has(c)));

/** The seed's own date moved to the next weekday from Tuesday to Saturday: the edition date the frame of a judging run needs (no Monday week, no Sunday deep dive). */
export function frameDate(seeded: string): string {
  const day = weekday(seeded);
  return day === 0 ? addDays(seeded, 2) : day === 1 ? addDays(seeded, 1) : seeded;
}

/** The agent context of a judging run: the day's budgets and the config's lists, with no pack, no findings and no reports (nothing else is read by the finding rules). */
function contextFor(config: LoadedConfig, date: string): AgentContext {
  const b = config.run.budgets;
  return AgentContext.parse({
    date,
    format: formatForWeekday(weekday(date)),
    window: { start: `${addDays(date, -1)}T03:00:00+08:00`, end: `${date}T03:00:00+08:00` },
    deadline: `${date}T04:15:00+08:00`,
    budgets: {
      web_fetches: b.web_fetches, findings_max: b.findings_max, typical_findings: [...b.typical_findings], deep_read_max: b.deep_read_max,
      words_target: b.words_target, words_max: b.words_max, reading_grade_soft: b.reading_grade_soft, reading_grade_max: b.reading_grade_max,
    },
    candidates: [],
    pace: { sentence: "A ledger seed is being checked.", quotable: {} },
    recent_findings: [],
    ledger_for_sunday: [],
    week: null,
    rung_proposals: [],
    corrections: { flagged: [] },
    reports: [],
    standing_stories: [],
    pack: { md: "packs/seed.md", json: "packs/seed.json", degraded: false, failed_feeds: [] },
    config: {
      hype_words: [...config.hypeWords.en],
      jargon: config.jargon.words.map((w) => w.en),
      field_cap: 2,
      fields: FIELDS.map((id) => ({ id, subfields: config.index.subfields[id].map((s) => ({ id: s.id, name: s.en })) })),
      source_kinds: (Object.keys(SOURCE_KIND_INFO) as (keyof typeof SOURCE_KIND_INFO)[]).map((id) => ({ id, label: SOURCE_KIND_INFO[id].en, means: SOURCE_KIND_INFO[id].means })),
      allowlist: [],
    },
  });
}

/** The English draft of one seed: its finding as `new-1`, an item, with the English side of every string. */
function englishDraftOf(seed: SeedFinding, date: string): DraftBrief {
  const f = seed;
  return DraftBrief.parse({
    schema_version: 1,
    date,
    generated_at: `${date}T04:00:00+08:00`,
    lead: [],
    story: null,
    items: ["new-1"],
    new_findings: [{
      ref: "new-1",
      field: f.field,
      subfield: f.subfield,
      kind: f.kind,
      title: f.title.en,
      explainer: {
        found: f.explainer.found.en, matters: f.explainer.matters.en, ai_helped: f.explainer.ai_helped?.en ?? null,
        how_sure: f.explainer.how_sure.en, background: f.explainer.background.en, could_lead: f.explainer.could_lead.en,
      },
      go_deeper: f.go_deeper,
      ai: f.ai,
      significance: f.significance,
      rung_history: f.rung_history.map((r) => ({ rung: r.rung, date: r.date, source_id: r.source_id, note: r.note?.en ?? null })),
      sources: f.sources,
      reactions: f.reactions,
      artefacts: f.artefacts,
      figure: f.figure === null ? null : { ...f.figure, alt: f.figure.alt.en },
      who: f.who,
      terms: f.terms.map((t) => (t.new ? { new: true, term: t.term, definition: t.definition } : { new: false, id: t.id })),
      related: f.related,
      first_published: f.first_published,
    }],
    returning: [],
    rung_changes: [],
    ideas: [],
    also: [],
    deep_dive: null,
    review: null,
    corrections: [],
    report_decisions: [],
    sources: [],
  });
}

/** The characters a Chinese string of `words` English words may have (§4.6: ceil(words x zh_factor), the product rounded first as the context does). */
const charsOf = (config: LoadedConfig, words: number): number => Math.ceil(Math.round(words * config.run.budgets.zh_factor * 1e6) / 1e6);

/** The Chinese context and draft of one seed, by §4.6's key grammar (`new.new-1.*`); a string that is `REMOVED_TEXT` has no key, as `buildZhContext()` leaves it out. */
export function chineseOf(
  seed: SeedFinding, config: LoadedConfig, date: string, known: ReadonlyMap<string, TermEntry>,
): { context: ZhContext; draft: DraftZh } {
  const strings: ZhString[] = [];
  const zh: Record<string, string> = {};
  const add = (key: string, en: string, chinese: string, kind: ZhString["kind"], cap: number, group: ZhString["group"]): void => {
    if (en === REMOVED_TEXT.en) return;
    strings.push({ key, en, kind, cap_chars: cap, group });
    zh[key] = chinese;
  };
  const prefix = "new.new-1";
  add(`${prefix}.title`, seed.title.en, seed.title.zh, "title", charsOf(config, 12), null);
  const group = { id: `${prefix}.explainer`, cap_chars: charsOf(config, 100) };
  const e = seed.explainer;
  add(`${prefix}.explainer.found`, e.found.en, e.found.zh, "part", group.cap_chars, group);
  add(`${prefix}.explainer.matters`, e.matters.en, e.matters.zh, "part", group.cap_chars, group);
  if (e.ai_helped !== null) add(`${prefix}.explainer.ai_helped`, e.ai_helped.en, e.ai_helped.zh, "part", group.cap_chars, group);
  add(`${prefix}.explainer.how_sure`, e.how_sure.en, e.how_sure.zh, "part", group.cap_chars, group);
  add(`${prefix}.explainer.background`, e.background.en, e.background.zh, "part", charsOf(config, 40), null);
  add(`${prefix}.explainer.could_lead`, e.could_lead.en, e.could_lead.zh, "part", charsOf(config, 40), null);
  seed.rung_history.forEach((r, i) => {
    if (r.note !== null) add(`${prefix}.rung.${i}`, r.note.en, r.note.zh, "note", charsOf(config, 25), null);
  });
  if (seed.figure !== null) add(`${prefix}.figure.alt`, seed.figure.alt.en, seed.figure.alt.zh, "alt", charsOf(config, 40), null);

  const termCap = charsOf(config, 40);
  const terms: ZhTerm[] = [];
  const draftTerms: DraftZh["terms"] = {};
  for (const t of seed.terms) {
    if (t.new) {
      const id = newTermId(t.term);
      if (id === null || terms.some((x) => x.id === id)) continue;
      terms.push({ id, en: t.term, definition: t.definition, zh: null, official: null, cap_chars: termCap });
      draftTerms[id] = { zh: t.zh.term, definition: t.zh.definition, official: t.zh.official, official_url: t.zh.official_url };
    } else if (!terms.some((x) => x.id === t.id)) {
      const entry = known.get(t.id);
      terms.push({ id: t.id, en: entry?.term ?? t.id, definition: entry?.definition ?? t.id, zh: entry?.zh.term ?? null, official: entry?.zh.official ?? null, cap_chars: termCap });
      if (entry === undefined) draftTerms[t.id] = { zh: t.id, definition: t.id, official: null, official_url: null };
    }
  }
  const field: FieldId = seed.field;
  const fixed = config.termsZh.fixed.flatMap((entry) => {
    const keys = [
      ...strings.filter((s) => fixedApplies(entry, s.en, field)).map((s) => s.key),
      ...terms.filter((t) => t.zh === null && (fixedApplies(entry, t.en, null) || fixedApplies(entry, t.definition, null))).map((t) => `terms.${t.id}`),
    ];
    return keys.length > 0 ? [{ en: entry.en, zh: entry.zh, keys }] : [];
  });
  const labelled = [...FIELDS.map((f) => FIELD_INFO[f]), ...ALL_RUNGS.map((r) => RUNG_INFO[r]), ...AI_ROLES.map((r) => AI_ROLE_INFO[r]), ...SIGNIFICANCE.map((s) => SIGNIFICANCE_INFO[s])];
  const context = ZhContext.parse({
    schema_version: 1,
    date,
    deadline: `${date}T04:27:00+08:00`,
    strings,
    terms,
    fixed,
    hype: [...config.hypeWords.zh],
    hype_names: config.hypeWords.names.map((n) => ({ en: n.en, zh: n.zh })),
    avoid: Object.fromEntries(config.termsZh.avoid.map((a) => [a.term, a.taiwan])),
    labels: Object.fromEntries(labelled.map((l) => [l.en, l.zh])),
  });
  return { context, draft: DraftZh.parse({ schema_version: 1, date, generated_at: `${date}T04:27:00+08:00`, strings: zh, terms: draftTerms }) };
}

/**
 * What a removed explainer part lifts (§4.12 "Removed text"): in a finding with one, TERM_DEFINED no longer needs each listed term to appear in
 * the explainer, and ZH_ENGLISH_ONCE neither needs each term to appear in the Chinese nor the first remaining use to carry the English. The
 * engine reads the removal off the stored corrections it is given, which a draft run has none of, so the seeder lifts these three messages.
 */
const LIFTED_TERM_UNUSED = "but the explainer never uses it.";
const LIFTED_ONCE = ["The Chinese explainer never uses the term", "The first use of "] as const;

/** `ai.evidence.0.quote` as `ai.evidence[0].quote`, after `prefix`. */
export const bracketed = (prefix: string, dotted: string): string => dotted.split(".").reduce((p, seg) => (/^(?:0|[1-9]\d*)$/.test(seg) ? `${p}[${seg}]` : `${p}.${seg}`), prefix);

/** The draft's place of the seed: the English run judges each seed as the one finding of a draft. */
const DRAFT_SEED = "new_findings[0]";

/** An issue of the English run, moved from the draft's `new_findings[0]` to the seed: `seeds[<i>]`, in its path and wherever its message names one. */
const seedIssue = (issue: ValidationIssue, i: number): ValidationIssue => ({
  ...issue,
  path: issue.path.startsWith(DRAFT_SEED) ? `seeds[${i}]${issue.path.slice(DRAFT_SEED.length)}` : issue.path,
  message: issue.message.replaceAll(DRAFT_SEED, `seeds[${i}]`),
});

/** An issue of the Chinese run, named by the key it is about: `seeds[<i>] <key>`. */
const zhPath = (path: string, i: number): string => `seeds[${i}] (Chinese) ${path}`;

/** What `judgeSeed()` is given besides the seed: the evidence of its pages when they were read, and the config. */
interface Judging {
  config: LoadedConfig;
  /** The evidence of the seed's own sources, or null when no page was read (no `--verify`, or a source with no snapshot). */
  evidence: ReturnType<typeof buildEvidence> | null;
  /** The evidence of its terms' 樂詞網 pages, or null when no page was read. */
  zhEvidence: ReturnType<typeof buildEvidence> | null;
  known: ReadonlyMap<string, TermEntry>;
  /** The paths of the seed (after the removed rewrites) that a stored `removed` correction rewrote, in the form of a correction's `path`. */
  removed: readonly string[];
}

/** The issues of one seed, at `seeds[<i>]` paths, from the English rules, the Chinese rules and the three direct checks. */
export function judgeSeed(item: IdentifiedSeed, i: number, j: Judging): ValidationIssue[] {
  const { seed, name } = item;
  const out: ValidationIssue[] = [];
  const date = frameDate(seed.seeded);

  const subfield = subfieldIssue(j.config, seed.field, seed.subfield, `seeds[${i}].subfield`, `of ${name}`);
  if (subfield !== null) out.push(subfield);

  const problem = rungLabelProblem(seed.explainer.how_sure.en, seed.explainer.how_sure.zh);
  if (problem !== null) {
    out.push(error("ZH_RUNG_LABEL", `seeds[${i}].explainer.how_sure.zh`,
      `The English starts with the rung label "${problem.english}", so the Chinese must start with ${problem.label}, the site's word for it, not a fresh translation.`,
      "lib/vocab.ts gives the site's word for each rung; then the rest of the sentence follows."));
  }

  const english = validateDraft(englishDraftOf(seed, date), {
    context: contextFor(j.config, date), evidence: j.evidence, config: j.config, rules: rulesFor("draft", ENGLISH_CODES),
  });
  const removedHere = j.removed.map((p) => bracketed(DRAFT_SEED, p));
  const explainerRemoved = j.removed.some((p) => p.startsWith("explainer."));
  for (const issue of english.issues) {
    if (issue.code === "INPUT_MISSING") continue;
    // The frame's own parts (the Lead, the lists of the day) judge no seed; SCHEMA and RULE_ERROR are never the frame's.
    if (!issue.path.startsWith(DRAFT_SEED) && issue.code !== "SCHEMA" && issue.code !== "RULE_ERROR") continue;
    if (removedHere.some((p) => issue.path === p || issue.path.startsWith(`${p}.`) || issue.path.startsWith(`${p}[`))) continue;
    // WORDS counts a removed string as no words and drops the lower bound of the budget it counts in (§4.12 "Removed text").
    if (explainerRemoved && issue.code === "WORDS" && issue.path.startsWith(`${DRAFT_SEED}.explainer`)) continue;
    if (explainerRemoved && issue.code === "TERM_DEFINED" && issue.message.includes(LIFTED_TERM_UNUSED)) continue;
    out.push(seedIssue(issue, i));
  }

  const { context, draft } = chineseOf(seed, j.config, date, j.known);
  const chinese = validateZh(draft, english.draft ?? englishDraftOf(seed, date), { context, evidence: j.zhEvidence, config: j.config }, { rules: rulesFor("zh", CHINESE_CODES) });
  for (const issue of chinese.issues) {
    if (issue.code === "INPUT_MISSING") continue;
    if (explainerRemoved && issue.code === "ZH_ENGLISH_ONCE" && LIFTED_ONCE.some((m) => issue.message.startsWith(m))) continue;
    out.push({ ...issue, path: zhPath(issue.path, i) });
  }
  return out;
}

// ── The run ──────────────────────────────────────────────────────────────────────────────────────

export interface SeedOptions {
  /** The seed folder (`--in`). */
  inDir: string;
  /** Read each source's and term page (`--verify`). */
  verify: boolean;
  /** The content folder to write (`--out`); absent: nothing is written, and the stored corrections are read from run.json's content folder. */
  outDir: string | null;
  root: string;
  fetch?: typeof fetchFeed;
  now?: Clock;
  log?: (line: string) => void;
}

export interface SeedResult {
  ok: boolean;
  /** Errors first-found order: every issue, errors and warnings. */
  issues: ValidationIssue[];
  /** Each seed in the order that gives ids. */
  seeds: { id: string; file: string }[];
  /** The files written, relative to the content folder. */
  written: string[];
}

/** Writes `text` to `file` unless it already holds exactly that; atomically. Returns whether it wrote. */
function writeIfChanged(file: string, text: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return true;
}

/** The glossary file of the content folder: [] when there is none; a file that does not parse is an issue and reads as none. */
function readGlossary(dir: string): { terms: Term[]; issues: ValidationIssue[] } {
  const file = path.join(dir, "glossary.json");
  if (!fs.existsSync(file)) return { terms: [], issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { terms: [], issues: [error("SCHEMA", "glossary.json", "glossary.json is not valid JSON.")] };
  }
  const parsed = GlossaryFile.safeParse(raw);
  if (!parsed.success) return { terms: [], issues: schemaIssues(parsed.error, raw).map((x) => inFile("glossary.json", x)) };
  return { terms: parsed.data.terms, issues: [] };
}

/** The archive index of the content folder: an empty one when there is none; a file that does not parse is an issue. */
function readArchive(dir: string): { index: ArchiveIndex; issues: ValidationIssue[] } {
  const empty: ArchiveIndex = { schema_version: 1, editions: [], urls: {} };
  const file = path.join(dir, "archive-index.json");
  if (!fs.existsSync(file)) return { index: empty, issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { index: empty, issues: [error("SCHEMA", "archive-index.json", "archive-index.json is not valid JSON.")] };
  }
  const parsed = ArchiveIndex.safeParse(raw);
  if (!parsed.success) return { index: empty, issues: schemaIssues(parsed.error, raw).map((x) => inFile("archive-index.json", x)) };
  return { index: parsed.data, issues: [] };
}

/** The pages `--verify` reads: each seed's source URLs and each term's `official_url` that has an `official` and passes the host test (a stray address is never fetched). */
function pagesOf(items: readonly IdentifiedSeed[]): { sources: string[]; official: string[] } {
  const sources: string[] = [];
  const official: string[] = [];
  const seen = new Set<string>();
  const take = (list: string[], url: string): void => {
    const key = normalizeUrl(url);
    if (seen.has(key)) return;
    seen.add(key);
    list.push(url);
  };
  for (const item of items) {
    for (const s of item.seed.sources) if (!isRemovedUrl(s.url)) take(sources, s.url);
    for (const t of item.seed.terms) {
      if (t.new && t.zh.official !== null && t.zh.official_url !== null && officialUrlProblem(t.zh.official_url) === null) take(official, t.zh.official_url);
    }
  }
  return { sources, official };
}

/**
 * Reads, judges and, with `outDir`, writes the Ledger (§8.13). Throws `InputError` for an unreadable seed folder. Writes nothing when any issue is
 * an error.
 */
export async function ledgerSeed(o: SeedOptions): Promise<SeedResult> {
  const config = loadConfig(path.join(o.root, "config"));
  const log = o.log ?? (() => {});
  const inDir = path.resolve(o.root, o.inDir);
  const folder = path.resolve(o.root, o.outDir ?? config.run.paths.content_dir);
  const issues: ValidationIssue[] = [];

  const loaded = readSeedFiles(inDir);
  issues.push(...loaded.issues);
  const { corrections, issues: correctionIssues } = readCorrections(folder);
  const stored = readGlossary(folder);
  issues.push(...correctionIssues, ...stored.issues);
  const archive = readArchive(folder);
  issues.push(...archive.issues);
  // A file that did not load is missing from the order that gives ids, so the places `seeds[<i>]` and the ids of every later seed of its year
  // would be wrong, and so would each check that reads another file (a term listed as existing, a related finding). Its own issue is the
  // one to fix first: nothing else is judged until every file loads.
  if (loaded.issues.length > 0) return { ok: false, issues, seeds: [], written: [] };
  const existing = new Map(stored.terms.map((t) => [t.id, t]));

  const ids = identifySeeds(loaded.files);
  const items: IdentifiedSeed[] = ids.map((s) => ({ ...s, seed: applyRemovals(s.seed, s.id, corrections) }));
  const idSet = new Set(items.map((s) => s.id));
  const removedPaths = (s: IdentifiedSeed): string[] =>
    removedOnes(corrections).filter((c) => c.finding_id === s.id && holdingAt(s.seed, c.path) === "removed").map((c) => c.path);

  // The glossary the seeds make, then the files' references to it and to each other.
  const { table, issues: termIssues } = termTable(items, existing);
  issues.push(...termIssues);
  items.forEach((item, i) => {
    item.seed.related.forEach((id, k) => {
      if (id === item.id) issues.push(error("SCHEMA", `seeds[${i}].related[${k}]`, `${item.name} lists its own id ${id} as related.`, "A finding is never related to itself."));
      else if (!idSet.has(id)) issues.push(error("SCHEMA", `seeds[${i}].related[${k}]`, `${item.name} lists the finding ${id} as related, which no seed has (ids follow the order of first_published, then file name).`, "Run the script with --json to see the id of each file."));
    });
  });
  const known = new Map<string, TermEntry>(table);
  for (const t of stored.terms) {
    if (!known.has(t.id) && t.zh !== null) known.set(t.id, { id: t.id, term: t.en.term, definition: t.en.definition, zh: t.zh, definedIn: [] });
  }

  // The pages (§8.13): a snapshot in cache/snapshots/ is read, the rest are taken in rounds until each has been started.
  const pages = pagesOf(items);
  const snapshots = new Map<string, Snapshot>();
  const resolved: Record<string, string> = {};
  if (o.verify) {
    const missing: string[] = [];
    for (const url of [...pages.sources, ...pages.official]) {
      const snap = readSnapshot(o.root, url);
      if (snap !== null) snapshots.set(normalizeUrl(url), snap);
      else missing.push(url);
    }
    if (missing.length > 0) {
      const taken = await snapshotUrls({
        root: o.root, urls: missing, deadline: Number.POSITIVE_INFINITY, roundMs: SNAPSHOT_LIMITS.roundMs, config, fetch: o.fetch, now: o.now, log,
      });
      for (const s of taken.taken) snapshots.set(normalizeUrl(s.url), s);
      Object.assign(resolved, taken.resolved);
    }
  } else {
    issues.push(warning("INPUT_MISSING", "(verify)",
      "Without --verify no page is read, so SEED_SOURCES and the checks that read a page (QUOTE_VERBATIM, NUMBER_SOURCED, ARTEFACT_FORMAT's artefact test, PRIMARY_ONLY's type check and ZH_OFFICIAL's page text) were skipped.",
      "Run it with --verify on Kobol before the Ledger is written to content/."));
  }

  const snapshotOf = (url: string): Snapshot | undefined => snapshots.get(normalizeUrl(url));
  const zhEvidence = o.verify ? buildEvidence({ snapshots: pages.official.flatMap((u) => snapshotOf(u) ?? []) }) : null;
  items.forEach((item, i) => {
    // A source whose address a stored `removed` correction removed has no page to read and is no SEED_SOURCES failure; the page-text checks
    // are skipped for that seed, as for one with an unread source (its quotes and numbers were checked when the seed was first written).
    const unread = item.seed.sources.flatMap((s, k) => (isRemovedUrl(s.url) || snapshotOf(s.url) !== undefined ? [] : [{ s, k }]));
    const removedUrls = item.seed.sources.filter((s) => isRemovedUrl(s.url)).length;
    let evidence: Judging["evidence"] = null;
    if (o.verify) {
      for (const { s, k } of unread) {
        issues.push(error("SEED_SOURCES", `seeds[${i}].sources[${k}].url`,
          `${item.name}: the source ${s.id} (${s.url}) has no page snapshot: the page did not answer 2xx with HTML (a PDF fails too).`,
          "Cite the record's landing page, or the same record on a page that answers, such as its PubMed or PMC record where that passes PRIMARY_ONLY and holds the quotes; if no source answers, the seed stays out of seed/ledger/ (SPEC §4.12 SEED_SOURCES)."));
      }
      if (unread.length === 0 && removedUrls === 0) evidence = buildEvidence({ snapshots: item.seed.sources.flatMap((s) => snapshotOf(s.url) ?? []), resolved });
      else if (unread.length > 0) issues.push(warning("INPUT_MISSING", `seeds[${i}]`, `${item.name}: the page-text checks were skipped, since ${unread.length === 1 ? "a source has" : "some sources have"} no snapshot.`));
      else issues.push(warning("INPUT_MISSING", `seeds[${i}]`, `${item.name}: the page-text checks were skipped, since the address of ${removedUrls === 1 ? "a source was" : "some sources were"} removed (SPEC §4.10).`));
    }
    issues.push(...judgeSeed(item, i, { config, evidence, zhEvidence, known, removed: removedPaths(item) }));
  });

  // The records, parsed as the stored schemas (the same as validate:all will read).
  const findings: Finding[] = [];
  items.forEach((item, i) => {
    // A seed an earlier check already blamed is not built: its error stops the run, and the stored schema's view of the same fault
    // (`related` listing the seed's own id) would only name it a second time.
    if (issues.some((x) => x.severity === "error" && x.path.startsWith(`seeds[${i}]`))) return;
    try {
      findings.push(findingOf(item, config));
    } catch (e) {
      if (!(e instanceof ZodError)) throw e;
      // Every issue of the finding's schema names a path (even its refinements do), so none is at the root.
      for (const issue of schemaIssues(e)) {
        issues.push({ ...issue, path: `seeds[${i}].${issue.path}`, message: `${item.name} does not make a finding: ${issue.message}` });
      }
    }
  });

  const errors = issues.filter((x) => x.severity === "error");
  const seeds = items.map((s) => ({ id: s.id, file: s.name }));
  const written: string[] = [];
  if (errors.length === 0 && o.outDir !== null) {
    for (const f of findings) if (writeIfChanged(path.join(folder, "findings", `${f.id}.json`), jsonText(f, Finding))) written.push(`findings/${f.id}.json`);
    const mine = new Map(termsOf(items, table).map((t) => [t.id, t]));
    const merged = [...stored.terms.filter((t) => !mine.has(t.id)), ...mine.values()].sort((a, b) => byCodeUnit(a.id, b.id));
    if (writeIfChanged(path.join(folder, "glossary.json"), jsonText({ schema_version: 1, terms: merged }, GlossaryFile))) written.push("glossary.json");
    const hashes = snapshotHashes(items.flatMap((s) => s.seed.sources.flatMap((x) => snapshotOf(x.url) ?? [])));
    const mineUrls = archiveUrls(items, hashes);
    const urls: ArchiveIndex["urls"] = {};
    for (const key of [...Object.keys(archive.index.urls), ...Object.keys(mineUrls)].sort(byCodeUnit)) {
      urls[key] = Object.hasOwn(mineUrls, key) ? mineUrls[key]! : archive.index.urls[key]!;
    }
    if (writeIfChanged(path.join(folder, "archive-index.json"), jsonText({ ...archive.index, urls }, ArchiveIndex))) written.push("archive-index.json");
  }
  return { ok: errors.length === 0, issues, seeds, written };
}

// ── The command ──────────────────────────────────────────────────────────────────────────────────

const OPTIONS = {
  in: { type: "string" },
  verify: { type: "boolean" },
  out: { type: "string" },
  json: { type: "boolean" },
} as const;

interface Parsed {
  inDir: string;
  verify: boolean;
  outDir: string | null;
  json: boolean;
}

function parse(argv: string[]): Parsed {
  const { values, positionals, tokens } = parseArgs({ args: argv, allowPositionals: true, strict: true, tokens: true, options: OPTIONS });
  const seen = new Set<string>();
  for (const token of tokens ?? []) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new UsageError(`--${token.name} is given twice.`);
    seen.add(token.name);
    if (token.name !== "verify" && token.name !== "json" && token.value === "") throw new UsageError(`--${token.name} needs a value.`);
  }
  if (positionals.length > 0) throw new UsageError(`Unexpected argument ${JSON.stringify(positionals[0])}.`);
  if (values.in === undefined) throw new UsageError("--in DIR is required.");
  return { inDir: values.in, verify: values.verify === true, outDir: values.out ?? null, json: values.json === true };
}

function line(issue: ValidationIssue): string {
  return `${issue.severity === "error" ? "ERROR" : "warning"} ${issue.code} ${issue.path}: ${issue.message}${issue.hint ? ` (${issue.hint})` : ""}`;
}

/** The command. Returns the exit code and never exits: 0 written, 1 invalid, 2 usage or a seed folder that cannot be read. */
export async function main(argv: string[] = process.argv.slice(2), io: Io = DEFAULT_IO): Promise<number> {
  try {
    const args = parse(argv);
    const result = await ledgerSeed({ ...args, root: path.resolve(io.root ?? process.cwd()), fetch: io.fetch, now: io.now, log: io.err });
    if (args.json) {
      io.out(JSON.stringify({
        ok: result.ok, seeds: result.seeds, written: result.written,
        errors: result.issues.filter((x) => x.severity === "error"), warnings: result.issues.filter((x) => x.severity === "warning"),
      }, null, 2));
    } else {
      for (const issue of result.issues) io.out(line(issue));
      const errors = result.issues.filter((x) => x.severity === "error").length;
      io.out(result.ok
        ? `${result.seeds.length} seed${result.seeds.length === 1 ? "" : "s"} valid${args.outDir === null ? "" : `; wrote ${result.written.length} file${result.written.length === 1 ? "" : "s"}`}.`
        : `${errors} error${errors === 1 ? "" : "s"}: nothing was written.`);
    }
    return result.ok ? 0 : 1;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (e instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS"))) io.err(`${(e as Error).message}\n${USAGE}`);
    else if (e instanceof InputError) io.err(e.message);
    else if (e instanceof ConfigError) io.err(e.message);
    else io.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 2;
  }
}

/** The extensions `tsx` and Node add to a started name that has none: `tsx scripts/ledger-seed` runs `scripts/ledger-seed.ts`. */
const OMITTED_EXTENSIONS = ["", ".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs"] as const;

function realPathOrNull(file: string): string | null {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

/** True when this file is the script that was started, not one that imported it (compared by real names, as scripts/validate.ts does). */
function startedAsScript(): boolean {
  const started = process.argv[1];
  if (started === undefined) return false;
  const self = realPathOrNull(fileURLToPath(import.meta.url));
  for (const ext of OMITTED_EXTENSIONS) {
    const real = realPathOrNull(started + ext);
    if (real !== null) return real === self;
  }
  return false;
}

/** The one line to tell the reader about a write error on standard output or standard error, or null when it is no failure of the run (a reader that has gone away). */
export function writeFailure(err: NodeJS.ErrnoException): string | null {
  return err.code === "EPIPE" ? null : `Cannot write the output (${err.code ?? "an error"}).`;
}

/**
 * Watches the output streams: a write error that is a failure of the run (not a reader that has gone away, `writeFailure()`) calls
 * `fail()` each time, and `tell()` with its one line the first time only.
 */
export function watchWriteErrors(streams: readonly NodeJS.EventEmitter[], fail: () => void, tell: (text: string) => void): void {
  let told = false;
  for (const stream of streams) {
    stream.on("error", (err: NodeJS.ErrnoException) => {
      const failure = writeFailure(err);
      if (failure === null) return;
      fail();
      if (told) return;
      told = true;
      tell(failure);
    });
  }
}

/** Ends the run with `code`, unless a write error has already set a larger one: a report that cannot be written is exit 2 whatever the verdict was. */
export function exitWith(code: number): void {
  process.exitCode = Math.max(Number(process.exitCode ?? 0), code);
}

if (startedAsScript()) {
  watchWriteErrors([process.stdout, process.stderr], () => { process.exitCode = 2; }, (text) => { process.stderr.write(`${text}\n`); });
  main().then(exitWith);
}
