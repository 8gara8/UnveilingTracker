// Loads and checks config/ (SPEC §4.11, §4.13, Appendix B). loadConfig() reads every file, parses each with its schema
// (lib/schema/config.ts and registry.ts), runs the checks that need two files or a list in code (validateConfig()) and
// returns every file under its name, the versions the metrics file records and the lookups several modules share
// (`index`). It throws a ConfigError listing every problem it finds; configIssues() returns the same list without
// throwing. The morning's preflight, `npm run check` and the fixtures read the config through it.
//
// The values the seed files hold are unverified until P2 (Appendix B: OpenAlex ids, hosts and paths are "Verify in P2"),
// so the checks judge shape and consistency, never that a host or an id is the real one.
//
// Cyber's lib/config.ts at the fork commit 3ced1fb, adapted: the file map, the schema map, ConfigError, the Zod-to-issue
// conversion, loadConfig() and configVersions() are Cyber's idiom. This project's files differ, so its checks differ: no
// regexes live in the config, the folder is an argument instead of a repo root, a read is cached only while every file's
// bytes are unchanged, and the cross-file checks are the ones this project's files need (BLOCKED_HOSTS, the press list,
// the regulators of ai-drugs.json, the entries other modules look up by id).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import {
  AiDrugsFile, AiTermsFile, CheckersFile, CountersFile, DualUseFile, FieldsFile, HypeWordsFile, JargonFile, JournalsFile, LabsFile,
  MarkersFile, RunFile, SourceTiersFile, StandingStoriesFile, statementForm, TermsZhFile, type JournalEntry, type Subfield,
} from "./schema/config";
import type { ConfigVersions } from "./schema/metrics";
import { SourcesFile } from "./schema/registry";
import { maskPhrases, wordsIn } from "./text";
import { blockedEntry, hostMatches, hostOf, matchPath } from "./urls";
import { FIELDS, type FieldId } from "./vocab";

// ── Files ────────────────────────────────────────────────────────────────────────────────────────

/** Every config file, by the key LoadedConfig and `overrides` use. */
export const CONFIG_FILES = {
  run: "run.json",
  sources: "sources.yaml",
  fields: "fields.json",
  journals: "journals.json",
  aiTerms: "ai-terms.json",
  sourceTiers: "source-tiers.json",
  labs: "labs.json",
  checkers: "checkers.json",
  aiDrugs: "ai-drugs.json",
  counters: "counters.json",
  markers: "markers.json",
  standingStories: "standing-stories.json",
  termsZh: "terms-zh.json",
  jargon: "jargon.json",
  hypeWords: "hype-words.json",
  dualUse: "dual-use.json",
} as const;
export type ConfigKey = keyof typeof CONFIG_FILES;
export const CONFIG_KEYS = Object.keys(CONFIG_FILES) as ConfigKey[];

/** Each file's schema. */
export const CONFIG_SCHEMAS = {
  run: RunFile,
  sources: SourcesFile,
  fields: FieldsFile,
  journals: JournalsFile,
  aiTerms: AiTermsFile,
  sourceTiers: SourceTiersFile,
  labs: LabsFile,
  checkers: CheckersFile,
  aiDrugs: AiDrugsFile,
  counters: CountersFile,
  markers: MarkersFile,
  standingStories: StandingStoriesFile,
  termsZh: TermsZhFile,
  jargon: JargonFile,
  hypeWords: HypeWordsFile,
  dualUse: DualUseFile,
} as const satisfies Record<ConfigKey, z.ZodType>;

/** The folder every config file lives in, relative to the repo root; issues name each file `config/<file>`. */
export const CONFIG_DIR = "config";

/** Each file's parsed contents. */
export type ConfigFiles = { [K in ConfigKey]: z.output<(typeof CONFIG_SCHEMAS)[K]> };

// ── Issues ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The codes of the checks below. CONFIG_FILE: a file is missing or does not parse. CONFIG_SCHEMA: a file breaks its
 * schema (its shape, its forms, a fact inside the file). CONFIG_REF: an entry another file or the code looks up is
 * missing or wrong (a regulator that is not an `applied` checker, a required id). CONFIG_BLOCKED: a host or URL is on
 * BLOCKED_HOSTS. CONFIG_CONFLICT: two lists contradict each other (an allowed host on the press list).
 */
export const CONFIG_CODES = ["CONFIG_FILE", "CONFIG_SCHEMA", "CONFIG_REF", "CONFIG_BLOCKED", "CONFIG_CONFLICT"] as const;
export type ConfigCode = (typeof CONFIG_CODES)[number];

/** The validator's issue shape (lib/rules/types.ts ValidationIssue, SPEC §4.12): config issues join its reports. `path` is `config/<file>: <path inside the file>`. */
export interface ConfigIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
  hint: string | null;
}

function issue(code: ConfigCode, where: string, message: string, hint: string | null = null): ConfigIssue {
  return { code, severity: "error", path: where, message, hint };
}

/** Thrown by loadConfig() when a file is missing, does not parse or fails a check. */
export class ConfigError extends Error {
  readonly issues: ConfigIssue[];
  constructor(issues: ConfigIssue[]) {
    const head = issues.slice(0, 5).map((i) => `${i.code} ${i.path}: ${i.message}`);
    const more = issues.length > 5 ? [`and ${issues.length - 5} more`] : [];
    super([`config: ${issues.length} problem${issues.length === 1 ? "" : "s"}`, ...head, ...more].join("\n"));
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** A Zod path as `journals[3].issn`. */
function formatPath(p: readonly PropertyKey[]): string {
  let out = "";
  for (const k of p) out += typeof k === "number" ? `[${k}]` : out ? `.${String(k)}` : String(k);
  return out;
}

const labelOf = (key: ConfigKey): string => `${CONFIG_DIR}/${CONFIG_FILES[key]}`;
const at = (key: ConfigKey, where: string): string => (where ? `${labelOf(key)}: ${where}` : labelOf(key));

function schemaIssues(key: ConfigKey, err: z.ZodError): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  for (const i of err.issues) {
    const base = formatPath(i.path);
    if (i.code === "unrecognized_keys") {
      for (const name of i.keys) out.push(issue("CONFIG_SCHEMA", at(key, base ? `${base}.${name}` : name), `Unknown key "${name}"; remove it.`));
      continue;
    }
    const missing = i.code === "invalid_type" && /received undefined/.test(i.message);
    out.push(issue("CONFIG_SCHEMA", at(key, base), missing ? `Missing key (expected ${i.expected}).` : i.message,
      missing ? "Every key is written out; use null or [] when there is nothing to say (§4.1)." : null));
  }
  return out;
}

// ── Lookups ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The entry of `hosts` that `host` is or sits under (a listed domain matches its subdomains, as `hostMatches()` reads
 * it): the most specific one, or null. `host` is lower case, as `hostOf()` gives it.
 */
export function hostListed(host: string, hosts: ReadonlySet<string>): string | null {
  let h = host.toLowerCase().replace(/\.$/, "");
  for (;;) {
    if (hosts.has(h)) return h;
    const dot = h.indexOf(".");
    if (dot < 0) return null;
    h = h.slice(dot + 1);
  }
}

/** What several modules read from the files, worked out once at load. Everything is read-only and in file order. */
export interface ConfigIndex {
  /** Each field's subfields (`fields.json`), in file order. */
  subfields: Record<FieldId, Subfield[]>;
  /** A subfield id to its field. */
  fieldOfSubfield: ReadonlyMap<string, FieldId>;
  /** An OpenAlex field id to our field, or to null for an excluded one; an id in neither is unmapped (§5.1). */
  openalexFields: ReadonlyMap<number, FieldId | null>;
  /** The journals that count in Pace A (`in_pace` true), in file order (§5.1). */
  paceJournals: JournalEntry[];
  /** The journals that list each field; a journal of several fields is under each. */
  journalsByField: Record<FieldId, JournalEntry[]>;
  /** The phrases the Pace counts (`in_pace` true), in file order (§5.1). */
  pacePhrases: string[];
  /** Every phrase: what candidate matching reads (`must_match`, the arXiv filter, the PubMed query, §4.11). */
  aiPhrases: string[];
  /** Every host a publisher, resolver, registry, reaction source, lab or checker lists, and the hosts of the statement entries that name one. */
  allowedHosts: ReadonlySet<string>;
  /** `press_hosts`: matching the domain and its subdomains (`hostListed()`). */
  pressHosts: ReadonlySet<string>;
  /** `figure_hosts`: the hosts the site may show figures from (§4.11). */
  figureHosts: ReadonlySet<string>;
  /** `statement_suffixes` by form (`statementForm()`): suffixes (".edu"), hosts ("mpg.de") and host with path ("cell.com", "/newsroom"). */
  statement: { suffixes: string[]; hosts: string[]; paths: { host: string; path: string }[] };
  /** The names HYPE_WORDS and ZH_HYPE mask first: each `en`, and each `zh` that is not null (§4.11). */
  hypeNames: { en: string[]; zh: string[] };
  /** The characters of `simplified_only` and `japanese_only`, one set each (ZH_TRADITIONAL, §4.12). */
  simplifiedOnly: ReadonlySet<string>;
  japaneseOnly: ReadonlySet<string>;
}

function buildIndex(c: ConfigFiles): ConfigIndex {
  const subfields = Object.fromEntries(FIELDS.map((id) => [id, [] as Subfield[]])) as Record<FieldId, Subfield[]>;
  const fieldOfSubfield = new Map<string, FieldId>();
  const openalexFields = new Map<number, FieldId | null>();
  for (const f of c.fields.fields) {
    subfields[f.id] = [...f.subfields];
    for (const s of f.subfields) fieldOfSubfield.set(s.id, f.id);
    for (const id of f.openalex_fields) openalexFields.set(id, f.id);
  }
  for (const id of c.fields.excluded) openalexFields.set(id, null);

  const journalsByField = Object.fromEntries(FIELDS.map((id) => [id, [] as JournalEntry[]])) as Record<FieldId, JournalEntry[]>;
  for (const j of c.journals.journals) for (const f of j.fields) journalsByField[f].push(j);

  const statement: ConfigIndex["statement"] = { suffixes: [], hosts: [], paths: [] };
  for (const entry of c.sourceTiers.statement_suffixes) {
    const form = statementForm(entry);
    if (form === "suffix") statement.suffixes.push(entry);
    else if (form === "host") statement.hosts.push(entry);
    else {
      const slash = entry.indexOf("/");
      statement.paths.push({ host: entry.slice(0, slash), path: entry.slice(slash) });
    }
  }

  const t = c.sourceTiers;
  const allowedHosts = new Set<string>([
    ...[...t.publishers, ...t.resolvers, ...t.registries, ...t.reaction_sources, ...c.labs.labs, ...c.checkers.checkers].flatMap((e) => e.hosts),
    ...statement.hosts,
    ...statement.paths.map((p) => p.host),
  ]);

  return {
    subfields,
    fieldOfSubfield,
    openalexFields,
    paceJournals: c.journals.journals.filter((j) => j.in_pace),
    journalsByField,
    pacePhrases: c.aiTerms.phrases.filter((p) => p.in_pace).map((p) => p.phrase),
    aiPhrases: c.aiTerms.phrases.map((p) => p.phrase),
    allowedHosts,
    pressHosts: new Set(t.press_hosts),
    figureHosts: new Set(t.figure_hosts),
    statement,
    hypeNames: { en: c.hypeWords.names.map((n) => n.en), zh: c.hypeWords.names.flatMap((n) => (n.zh === null ? [] : [n.zh])) },
    simplifiedOnly: new Set([...c.termsZh.simplified_only]),
    japaneseOnly: new Set([...c.termsZh.japanese_only]),
  };
}

/** The versions the metrics file records (§4.7 `versions`). */
export function configVersions(c: Pick<ConfigFiles, "aiTerms" | "journals" | "fields" | "counters">): ConfigVersions {
  return { ai_terms: c.aiTerms.version, journals: c.journals.version, fields: c.fields.version, counters: c.counters.version };
}

// ── Load ─────────────────────────────────────────────────────────────────────────────────────────

export interface LoadedConfig extends ConfigFiles {
  /** The folder the files were read from, absolute. */
  dir: string;
  /** SHA-256 of each file's bytes as read; for an override, of its JSON printed as the files are (two-space indent, a newline). */
  sha256: Record<ConfigKey, string>;
  /** The versions the metrics file records. */
  versions: ConfigVersions;
  /** The lookups worked out once from the files. */
  index: ConfigIndex;
}

export interface LoadConfigOptions {
  /**
   * Replaces files' contents explicitly, for tests and the fixtures builder, e.g. `{ counters: <parsed counters.json> }`.
   * Each value is parsed with its file's schema, so raw JSON works. A load with overrides is never cached.
   */
  overrides?: Partial<Record<ConfigKey, unknown>>;
}

const cache = new Map<string, { key: string; config: LoadedConfig }>();

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/**
 * Reads, parses and checks every config file in `dir` (default: `config/` under the working directory, which is the
 * repo root for the scripts, the tests and the site build). Throws ConfigError listing every problem found: a missing
 * or unreadable file (CONFIG_FILE), a file that breaks its schema (CONFIG_SCHEMA), and, when every file parses, the
 * cross-file checks of validateConfig(). The result is cached per folder while every file's bytes stay the same,
 * unless `overrides` are given; treat it as read-only.
 */
export function loadConfig(dir?: string, opts: LoadConfigOptions = {}): LoadedConfig {
  // turbopackIgnore: the site build reads config/ at build time; nothing here is a file to bundle (SPEC §6).
  const root = path.resolve(/*turbopackIgnore: true*/ dir ?? path.join(process.cwd(), CONFIG_DIR));
  const overrides = opts.overrides ?? {};
  for (const k of Object.keys(overrides)) {
    if (!Object.hasOwn(CONFIG_FILES, k)) throw new Error(`loadConfig: unknown override ${JSON.stringify(k)}`);
  }

  const issues: ConfigIssue[] = [];
  const bytes: Partial<Record<ConfigKey, Buffer>> = {};
  const hashes = {} as Record<ConfigKey, string>;
  for (const k of CONFIG_KEYS) {
    if (k in overrides) {
      hashes[k] = sha256(`${JSON.stringify(overrides[k], null, 2)}\n`);
      continue;
    }
    const file = path.join(/*turbopackIgnore: true*/ root, CONFIG_FILES[k]);
    if (!fs.existsSync(file)) {
      issues.push(issue("CONFIG_FILE", labelOf(k), "File is missing.", `Every config file is required; see SPEC §4.11 for ${CONFIG_FILES[k]}.`));
      continue;
    }
    try {
      bytes[k] = fs.readFileSync(file);
    } catch (e) {
      // the code only (EISDIR, EACCES, ...): a message from Node names the whole path
      issues.push(issue("CONFIG_FILE", labelOf(k), `Cannot be read: ${(e as NodeJS.ErrnoException).code ?? "error"}.`, `${CONFIG_FILES[k]} must be a plain file the run may read.`));
      continue;
    }
    hashes[k] = sha256(bytes[k]!);
  }

  // The stamp holds every file's hash, so a folder with a missing or unreadable file never matches the stamp of a good load.
  const cacheable = Object.keys(overrides).length === 0;
  const stamp = CONFIG_KEYS.map((k) => hashes[k]).join("");
  const hit = cacheable ? cache.get(root) : undefined;
  if (hit && hit.key === stamp) return hit.config;

  const raws: Partial<Record<ConfigKey, unknown>> = {};
  for (const k of CONFIG_KEYS) {
    if (k in overrides) {
      raws[k] = overrides[k];
    } else if (bytes[k]) {
      try {
        const text = bytes[k]!.toString("utf8");
        raws[k] = CONFIG_FILES[k].endsWith(".yaml") ? parseYaml(text) : JSON.parse(text);
      } catch (e) {
        issues.push(issue("CONFIG_FILE", labelOf(k), `Does not parse: ${(e as Error).message}`));
      }
    }
  }

  const files: Partial<ConfigFiles> = {};
  for (const k of CONFIG_KEYS) {
    if (!(k in raws)) continue;
    const r = CONFIG_SCHEMAS[k].safeParse(raws[k]);
    if (r.success) (files as Record<ConfigKey, unknown>)[k] = r.data;
    else issues.push(...schemaIssues(k, r.error));
  }
  if (issues.length > 0) throw new ConfigError(issues);

  const parsed = files as ConfigFiles;
  const crossFile = validateConfig(parsed);
  if (crossFile.length > 0) throw new ConfigError(crossFile);

  const config: LoadedConfig = { ...parsed, dir: root, sha256: hashes, versions: configVersions(parsed), index: buildIndex(parsed) };
  if (cacheable) cache.set(root, { key: stamp, config });
  return config;
}

/** The problems loadConfig() finds, or [] when the config is good. Throws only on a call that is wrong (an unknown override). */
export function configIssues(dir?: string, opts: LoadConfigOptions = {}): ConfigIssue[] {
  try {
    loadConfig(dir, opts);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.issues;
    throw e;
  }
}

// ── Cross-file checks ────────────────────────────────────────────────────────────────────────────

/** True when `url` is on a host of `entry` and under one of its path prefixes (`/` is any path; §4.11). */
function onEntry(url: string, entry: { hosts: readonly string[]; paths: readonly string[] }): boolean {
  const host = hostOf(url);
  if (host === null || !entry.hosts.some((h) => hostMatches(host, h))) return false;
  const pathname = matchPath(new URL(url).pathname);
  return entry.paths.some((p) => pathname.startsWith(p.toLowerCase()));
}

/**
 * The checks that need two files or a list in code, on files that each parsed. Returns every issue; [] means the config
 * is consistent. CONFIG_REF: what other modules look up is there (§4.4, §4.11, §5.7) and what a file names exists.
 * CONFIG_BLOCKED: nothing names a BLOCKED_HOSTS host (§9.5). CONFIG_CONFLICT: no allowed host or source is on the press list.
 */
export function validateConfig(c: ConfigFiles): ConfigIssue[] {
  return [...refIssues(c), ...blockedIssues(c), ...conflictIssues(c)];
}

const quote = (s: string): string => JSON.stringify(s);

function refIssues(c: ConfigFiles): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const ref = (key: ConfigKey, where: string, message: string, hint: string | null = null) => out.push(issue("CONFIG_REF", at(key, where), message, hint));

  // The counter ancient_texts_ai counts findings in the humanities' subfield ancient-texts (§5.7).
  const humanities = c.fields.fields.findIndex((f) => f.id === "humanities");
  if (!c.fields.fields[humanities]?.subfields.some((s) => s.id === "ancient-texts")) {
    ref("fields", humanities < 0 ? "fields" : `fields[${humanities}].subfields`, "The humanities need the subfield ancient-texts: the counter ancient_texts_ai counts its findings (§5.7).");
  }

  // An approval is a regulator's own record of it (§4.11).
  const checkers = new Map(c.checkers.checkers.map((k) => [k.id, k] as const));
  c.aiDrugs.drugs.forEach((d, i) => {
    const a = d.approved;
    if (a === null) return;
    const where = (p: string) => `drugs[${i}].approved.${p}`;
    const checker = checkers.get(a.regulator);
    if (!checker) {
      ref("aiDrugs", where("regulator"), `${quote(a.regulator)} is not a checker id in ${labelOf("checkers")}.`, "A regulator is a checkers.json entry with the rung applied.");
      return;
    }
    if (!checker.rungs.includes("applied")) ref("aiDrugs", where("regulator"), `${quote(checker.id)} cannot give the rung applied; a regulator can (§4.11).`);
    if (!onEntry(a.source_url, checker)) {
      ref("aiDrugs", where("source_url"), `The record is not on ${checker.name}'s hosts and paths.`, "The source is that regulator's own record of the approval (§4.11).");
    }
  });

  // Entries other modules look up by id.
  if (!c.labs.labs.some((l) => l.id === "anthropic")) {
    ref("labs", "labs", 'Add an entry with id "anthropic": mentionsAnthropic() reads its hosts (§4.4).');
  }
  const prize = checkers.get("breakthrough-prize");
  if (!prize) ref("checkers", "checkers", 'Add an entry with id "breakthrough-prize" (§4.11).');
  else if (prize.name !== "Breakthrough Prize") {
    ref("checkers", `checkers[${c.checkers.checkers.indexOf(prize)}].name`, `The name is ${quote(prize.name)}; it must be exactly "Breakthrough Prize", the name hype-words.json masks (§4.12).`);
  }
  const vesuvius = checkers.get("vesuvius-challenge");
  if (!vesuvius) ref("checkers", "checkers", 'Add an entry with id "vesuvius-challenge" (§4.11).');
  else if (!["scrollprize.org", "scrollprize.substack.com"].every((h) => vesuvius.hosts.includes(h))) {
    ref("checkers", `checkers[${c.checkers.checkers.indexOf(vesuvius)}].hosts`, "The Vesuvius Challenge lists scrollprize.org and its announcements at scrollprize.substack.com (§4.11).");
  }

  // A checker's or lab's name is written into findings (WHO_SAYS), so a hype word in it must be one HYPE_WORDS masks first.
  const names = c.hypeWords.names.map((n) => n.en);
  const named: [ConfigKey, string, string][] = [
    ...c.checkers.checkers.map((k, i) => ["checkers", `checkers[${i}].name`, k.name] as [ConfigKey, string, string]),
    ...c.labs.labs.map((l, i) => ["labs", `labs[${i}].name`, l.name] as [ConfigKey, string, string]),
  ];
  for (const [key, where, name] of named) {
    const left = wordsIn(maskPhrases(name, names), c.hypeWords.en);
    if (left.length > 0) {
      ref(key, where, `${quote(name)} holds ${left.map(quote).join(", ")}; add the name to ${labelOf("hypeWords")} names so HYPE_WORDS masks it (§4.12).`);
    }
  }

  // The expert-reactions feed yields kind reaction, which only a reaction source passes for (§4.13).
  const smc = c.sources.feeds.findIndex((f) => f.id === "smc-reactions");
  const smcHost = smc < 0 ? null : hostOf(c.sources.feeds[smc]!.url);
  if (smc >= 0 && !(smcHost !== null && c.sourceTiers.reaction_sources.some((r) => r.hosts.some((h) => hostMatches(smcHost, h))))) {
    ref("sources", `feeds[${smc}].url`, "The feed smc-reactions yields reactions, so its host must be a host of a reaction_sources entry in source-tiers.json (§4.13).");
  }
  return out;
}

/** A URL or host the config names, with where it sits. `host` is set for a host an entry allows (and for a figure host), null for a source's own URL. */
interface Named {
  key: ConfigKey;
  where: string;
  url: string;
  host: string | null;
}

/** Every host the allowlist, the labs, the checkers and the figure list name, as the URL a visitor of its paths would use. */
function namedHosts(c: ConfigFiles): Named[] {
  const out: Named[] = [];
  const host = (key: ConfigKey, where: string, h: string, p = "/") => out.push({ key, where, url: `https://${h}${p}`, host: h });
  const entries = (key: ConfigKey, list: string, rows: readonly { hosts: readonly string[]; paths: readonly string[] }[]) =>
    rows.forEach((row, i) => row.hosts.forEach((h, j) => row.paths.forEach((p) => host(key, `${list}[${i}].hosts[${j}]`, h, p))));

  const t = c.sourceTiers;
  entries("sourceTiers", "publishers", t.publishers);
  entries("sourceTiers", "resolvers", t.resolvers);
  entries("sourceTiers", "registries", t.registries);
  entries("sourceTiers", "reaction_sources", t.reaction_sources);
  entries("labs", "labs", c.labs.labs);
  entries("checkers", "checkers", c.checkers.checkers);
  t.figure_hosts.forEach((h, i) => host("sourceTiers", `figure_hosts[${i}]`, h));
  t.statement_suffixes.forEach((entry, i) => {
    const form = statementForm(entry);
    const where = `statement_suffixes[${i}]`;
    if (form === "suffix") out.push({ key: "sourceTiers", where, url: `https://x${entry}/`, host: null });
    else if (form === "host") host("sourceTiers", where, entry);
    else host("sourceTiers", where, entry.slice(0, entry.indexOf("/")), entry.slice(entry.indexOf("/")));
  });
  return out;
}

/** The URLs a config file gives as the record of a fact: a source, never an allowed host. */
function sourceUrls(c: ConfigFiles): Named[] {
  const out: Named[] = [];
  const url = (key: ConfigKey, where: string, u: string) => out.push({ key, where, url: u, host: null });
  c.counters.counters.forEach((k, i) => {
    url("counters", `counters[${i}].source_url`, k.source_url);
    k.figures.forEach((f, j) => url("counters", `counters[${i}].figures[${j}].source_url`, f.source_url));
  });
  c.markers.markers.forEach((m, i) => url("markers", `markers[${i}].source_url`, m.source_url));
  c.aiDrugs.drugs.forEach((d, i) => {
    url("aiDrugs", `drugs[${i}].source_url`, d.source_url);
    if (d.approved) url("aiDrugs", `drugs[${i}].approved.source_url`, d.approved.source_url);
  });
  return out;
}

function blockedIssues(c: ConfigFiles): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const own: Named[] = [
    { key: "run", where: "site.url", url: c.run.site.url, host: null },
    ...(["me", "europe", "cyber"] as const).map((k) => ({ key: "run" as const, where: `siblings.${k}`, url: c.run.siblings[k], host: null })),
  ];
  c.sources.feeds.forEach((f, i) => {
    own.push({ key: "sources", where: `feeds[${i}].url`, url: f.url, host: null });
    if (f.fallback_url !== null) own.push({ key: "sources", where: `feeds[${i}].fallback_url`, url: f.fallback_url, host: null });
  });
  const reported = new Set<string>();
  for (const n of [...own, ...namedHosts(c), ...sourceUrls(c)]) {
    const hit = blockedEntry(n.url);
    const place = at(n.key, n.where);
    if (!hit || reported.has(place)) continue;
    reported.add(place);
    out.push(issue("CONFIG_BLOCKED", place, `${n.url} is on BLOCKED_HOSTS (${hit.pattern}, ${hit.reason}); no config entry may name it (§9.5).`,
      "Remove the entry, or name the record's own page instead."));
  }
  return out;
}

function conflictIssues(c: ConfigFiles): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const t = c.sourceTiers;
  const press = new Set(t.press_hosts);
  // A reaction source, a lab or a checker that names a host wins over the press list (§4.11).
  const winners = [...t.reaction_sources, ...c.labs.labs, ...c.checkers.checkers].flatMap((e) => e.hosts);
  const onPress = (host: string): string | null => (winners.some((w) => hostMatches(host, w)) ? null : hostListed(host, press));

  const reported = new Set<string>();
  for (const n of namedHosts(c)) {
    // a suffix entry names no host; a lab's or checker's own host is a winner, so it is never one that conflicts
    if (n.host === null) continue;
    const p = onPress(n.host);
    const place = at(n.key, n.where);
    if (p === null || reported.has(place)) continue;
    reported.add(place);
    const what = n.where.startsWith("figure_hosts") ? "a figure host" : "an allowed host";
    out.push(issue("CONFIG_CONFLICT", place, `${n.host} is ${what} and sits under the press host ${p}, so no URL on it can be primary.`,
      "Remove one of the two, or name the host in reaction_sources, labs.json or checkers.json, which win over the press list (§4.11)."));
  }
  for (const n of sourceUrls(c)) {
    const host = hostOf(n.url);
    const p = host === null ? null : onPress(host);
    if (p !== null) {
      out.push(issue("CONFIG_CONFLICT", at(n.key, n.where), `${n.url} is on the press host ${p}; a source is a primary record, never press (§4.11).`,
        "Cite the record's own page."));
    }
  }
  return out;
}
