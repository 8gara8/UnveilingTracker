// The config files of SPEC §4.11 (seeds in Appendix B): one strict schema for each of run.json, fields.json,
// journals.json, ai-terms.json, source-tiers.json, labs.json, checkers.json, ai-drugs.json, counters.json, markers.json,
// standing-stories.json, terms-zh.json, jargon.json, hype-words.json and dual-use.json. sources.yaml is `SourcesFile`
// (registry.ts). Every object is strict and every key is written out (§4.1), in the order the file prints, so
// `jsonText(value, schema)` (lib/json.ts) reproduces a file byte for byte.
//
// Each schema holds what its own file can say: forms and ranges, unique ids, the order of a list, and the facts of §4.11
// that stay inside one file (the order of the schedule, how a publisher's `type_field` and `types` go together, a
// counter's kind, the Taiwan-usage lists of terms-zh.json). A fact that needs two files, or a list that lives in code
// (BLOCKED_HOSTS), is a check of lib/config.ts. A refinement runs only on a value of the right types and never throws,
// so a malformed value gives an issue and nothing else.
//
// Cyber's lib/schema/config.ts at the fork commit 3ced1fb, adapted: its files (vendors, finders, regions, ...) are not
// this project's; the idiom is (one strict schema for each file, each `...File` last, types inferred under the same
// names). The values the seed files hold are unverified until P2 (SPEC Appendix B); the schemas judge their shape only.

import { z } from "zod";
import { wordRe } from "../text";
import { COUNTED_RUNGS, FIELDS } from "../vocab";
import { ConfigId, Count, CounterId, FieldId, FindingId, HttpsUrl, ID_PATTERNS, IsoDate, SourceKind, SubfieldId } from "./common";
import { ZhHypeName } from "./draft-zh";
import { CounterKind } from "./metrics";

// ── Building blocks ──────────────────────────────────────────────────────────────────────────────

type PathPart = string | number;

const Version = z.int().min(1).describe("Increments on every change; metrics record the versions they used (§4.11)");
const Positive = z.int().min(1);
/** A name or a label: not empty, with no space at either end. */
const Text = z.string().min(1).refine((s) => s === s.trim(), { error: "Expected no space at the start or the end" });
/** A string in both languages, neither of them null (`L10n`'s `zh` may be null in published text; a config label never is). */
const BothLanguages = z.strictObject({ en: Text, zh: Text });

/** Adds an issue at each entry whose key an earlier entry already has. */
function noRepeats<T>(
  ctx: z.RefinementCtx, items: readonly T[], key: (item: T) => string | number, what: (item: T) => string, path: (index: number) => PathPart[],
): void {
  const first = new Map<string | number, number>();
  items.forEach((item, i) => {
    const k = key(item);
    const j = first.get(k);
    if (j === undefined) first.set(k, i);
    else ctx.addIssue({ code: "custom", message: `${what(item)} is already used at index ${j}`, path: path(i) });
  });
}

/** An array of strings or numbers that may not repeat a value (an issue at each repeat). */
function distinct<T extends z.ZodType<string | number>>(item: T, what: string, min = 0) {
  return z.array(item).min(min).superRefine((values, ctx) => {
    noRepeats(ctx, values, (v) => v, (v) => `${what} ${JSON.stringify(v)}`, (i) => [i]);
  });
}

/** The key two list entries share when they differ only in case, spacing or a hyphen, as the word matching (`wordRe`) reads them. */
const foldWords = (s: string): string => s.toLowerCase().replace(/[\s-]+/g, " ");

const pad = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

// ── Hosts, paths, times and the other small forms ────────────────────────────────────────────────

const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
const PATH_RE = /^\/[^\s?#]*$/;
const SUFFIX_RE = new RegExp(`^\\.${LABEL}(?:\\.${LABEL})*$`);
const CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** A bare lower-case host: at least two labels, no scheme, port, path or space. Matching is the host or any subdomain (§4.11). */
export const HostName = z.string().regex(HOST_RE, {
  error: "Expected a bare lower-case host such as www.nature.com (no scheme, port or path, and at least two labels)",
});
/** A URL path prefix: it starts with "/" and has no space, query or fragment. `/` alone means any path (§4.11). */
export const PathPrefix = z.string().regex(PATH_RE, { error: "Expected a URL path prefix: it starts with / and has no space, ? or #" });
/** A time of day as HH:MM on a 24-hour clock (Taipei time). */
export const ClockTime = z.string().regex(CLOCK_RE, { error: "Expected a time as HH:MM on a 24-hour clock", abort: true });

const minutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** An https origin with no path, query or trailing slash. */
const Origin = HttpsUrl.refine((u) => {
  try {
    return new URL(u).origin === u;
  } catch {
    return false;
  }
}, { error: "Expected an origin: https and the host only, with no path, query or trailing slash" });

const hostList = distinct(HostName, "Host", 1);
const pathList = (min: number) => distinct(PathPrefix, "Path", min);
const kindList = distinct(SourceKind, "Kind", 1);

/**
 * How a source-tiers `type_field` reads (§4.11): a CSS selector (read with cheerio) when it starts with "." or "#" or
 * holds whitespace, ">" or "[", else the name of a `<meta>` tag.
 */
export function typeFieldKind(typeField: string): "selector" | "meta" {
  return /^[.#]|[\s>[]/.test(typeField) ? "selector" : "meta";
}

const META_NAME_RE = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const TypeField = z.string().refine(
  (s) => (typeFieldKind(s) === "meta" ? META_NAME_RE.test(s) : s.trim() === s && s.length > 1),
  { error: "Expected a <meta> tag name such as citation_article_type, or a CSS selector such as .article-type" },
);

/** The three forms of a `statement_suffixes` entry (§4.11): a suffix (".edu"), a host ("mpg.de": the host and its subdomains) or a host with a path prefix ("cell.com/newsroom"). */
export function statementForm(entry: string): "suffix" | "host" | "path" {
  if (entry.startsWith(".")) return "suffix";
  return entry.includes("/") ? "path" : "host";
}

function statementFits(entry: string): boolean {
  switch (statementForm(entry)) {
    case "suffix": return SUFFIX_RE.test(entry);
    case "host": return HOST_RE.test(entry);
    case "path": {
      const slash = entry.indexOf("/");
      return HOST_RE.test(entry.slice(0, slash)) && PATH_RE.test(entry.slice(slash));
    }
  }
}

const StatementEntry = z.string().refine(statementFits, {
  error: "Expected a suffix (.edu), a host (mpg.de) or a host with a path prefix (cell.com/newsroom), all lower case",
});

// ── run.json ─────────────────────────────────────────────────────────────────────────────────────

const RelativeDir = z.string().regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/, {
  error: "Expected a folder inside the repo: lower case, no leading slash, no .. and no backslash",
});

const RunSchedule = z.strictObject({
  timezone: z.literal("Asia/Taipei"),
  start: ClockTime,
  data_only_target: ClockTime,
  full_target: ClockTime,
  retry_cutoff: ClockTime,
  zh_start_by: ClockTime,
  hard_stop: ClockTime,
  stale_after: ClockTime,
  publish_until: ClockTime,
});

const RunBudgets = z.strictObject({
  agent_minutes: Positive,
  zh_minutes: Positive,
  zh_reserve_minutes: Positive,
  web_fetches: Count,
  zh_fetches: Count,
  repair_rounds: Count,
  zh_repair_rounds: Count,
  attempts_max: Positive,
  candidates_max: Positive,
  deep_read_max: Positive,
  findings_max: Positive,
  typical_findings: z.tuple([Positive, Positive]).describe("[fewest, most] findings on a normal morning"),
  words_target: Positive,
  words_max: Positive,
  zh_factor: z.number().positive().describe("Chinese characters allowed for each English word (§4.6)"),
  reading_grade_soft: z.number().positive(),
  reading_grade_max: z.number().positive(),
  reports_max: Count,
  zh_backlog_max: Count,
  rung_watch_max: Positive,
  publish_reserve_minutes: Count,
  deploy_wait_minutes: Count,
});

/** config/run.json (SPEC §4.11): the site, the repo, the schedule, the budgets, the pack window, the Pace settings, the paths, the user agent and the task name. */
export const RunFile = z.strictObject({
  schema_version: z.literal(1),
  site: z.strictObject({ name: Text, tagline: BothLanguages, url: Origin }),
  repos: z.strictObject({
    repo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/, { error: "Expected owner/name, as on GitHub" }),
    branch: Text,
  }),
  siblings: z.strictObject({ me: Origin, europe: Origin, cyber: Origin }),
  schedule: RunSchedule,
  budgets: RunBudgets,
  pack: z.strictObject({ window_end: ClockTime, window_hours: Positive, lookback_hours: Positive }),
  pace: z.strictObject({
    window_weeks: Positive,
    provisional_weeks: Positive,
    min_cases: Positive,
    min_ratio: z.number().min(1),
    hold_after_days: Positive,
  }),
  paths: z.strictObject({
    content_dir: RelativeDir, cache: RelativeDir, packs: RelativeDir, drafts: RelativeDir, logs: RelativeDir, needs_review: RelativeDir,
  }),
  user_agent: Text.describe("Names the repo's URL, never an e-mail address (§4.11)"),
  task_name: Text,
}).superRefine((r, ctx) => {
  const s = r.schedule;
  // The clock rules of §8.2: the run starts, may retry until retry_cutoff, starts the Chinese pass by zh_start_by and is
  // over by hard_stop; an edition after stale_after is late and nothing is published after publish_until. The two targets
  // are not enforced there, so each is only ordered against the start and the hard stop.
  const chain: [keyof typeof s, keyof typeof s][] = [
    ["start", "retry_cutoff"], ["retry_cutoff", "zh_start_by"], ["zh_start_by", "hard_stop"], ["hard_stop", "stale_after"],
    ["stale_after", "publish_until"], ["start", "data_only_target"], ["data_only_target", "full_target"], ["full_target", "hard_stop"],
  ];
  for (const [before, after] of chain) {
    if (before === "timezone" || after === "timezone") continue;
    if (minutes(s[before]) >= minutes(s[after])) {
      ctx.addIssue({ code: "custom", message: `schedule.${before} (${s[before]}) must be earlier than schedule.${after} (${s[after]})`, path: ["schedule", after] });
    }
  }
  const b = r.budgets;
  if (b.typical_findings[0] > b.typical_findings[1] || b.typical_findings[1] > b.findings_max) {
    ctx.addIssue({ code: "custom", message: "typical_findings must be [fewest, most] with fewest <= most <= findings_max", path: ["budgets", "typical_findings"] });
  }
  if (b.words_target > b.words_max) ctx.addIssue({ code: "custom", message: "words_target must not be more than words_max", path: ["budgets", "words_target"] });
  if (b.reading_grade_soft > b.reading_grade_max) {
    ctx.addIssue({ code: "custom", message: "reading_grade_soft must not be more than reading_grade_max", path: ["budgets", "reading_grade_soft"] });
  }
  if (r.pack.window_hours > r.pack.lookback_hours) {
    ctx.addIssue({ code: "custom", message: "The lookback holds the window, so lookback_hours must be at least window_hours", path: ["pack", "lookback_hours"] });
  }
  if (r.user_agent.includes("@")) ctx.addIssue({ code: "custom", message: "The user agent has no e-mail address; it names the repo's URL (§4.11)", path: ["user_agent"] });
  else if (!r.user_agent.includes(`https://github.com/${r.repos.repo}`)) {
    ctx.addIssue({ code: "custom", message: `The user agent must name the repo's URL, https://github.com/${r.repos.repo}`, path: ["user_agent"] });
  }
  const dirs = Object.entries(r.paths);
  noRepeats(ctx, dirs, ([, dir]) => dir, ([name, dir]) => `${name} ${JSON.stringify(dir)}`, (i) => ["paths", dirs[i]![0]]);
});

// ── fields.json ──────────────────────────────────────────────────────────────────────────────────

/** OpenAlex numbers its 26 fields 11 to 36 (§4.11). */
export const OPENALEX_FIELD_MIN = 11;
export const OPENALEX_FIELD_MAX = 36;
const OpenAlexFieldId = z.int().min(OPENALEX_FIELD_MIN).max(OPENALEX_FIELD_MAX);

export const Subfield = z.strictObject({ id: SubfieldId, en: Text, zh: Text });

export const FieldEntry = z.strictObject({
  id: FieldId,
  openalex_fields: distinct(OpenAlexFieldId, "OpenAlex field", 1).describe("The OpenAlex field ids that map to this field"),
  subfields: z.array(Subfield).min(3).max(8),
});

/** config/fields.json (SPEC §4.11, Appendix B): the seven fields in `FIELDS` order, their subfields (ids unique in the file) and the OpenAlex mapping, which names every OpenAlex field once, under a field or in `excluded`. */
export const FieldsFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  fields: z.array(FieldEntry),
  excluded: distinct(OpenAlexFieldId, "OpenAlex field").describe("OpenAlex fields that are out: AI research itself (§4.11)"),
}).superRefine((f, ctx) => {
  if (f.fields.length !== FIELDS.length || f.fields.some((e, i) => e.id !== FIELDS[i])) {
    ctx.addIssue({ code: "custom", message: `fields must list the seven fields in this order: ${FIELDS.join(", ")}`, path: ["fields"] });
  }
  const where = new Map<string, string>();
  f.fields.forEach((e, i) => e.subfields.forEach((s, j) => {
    const first = where.get(s.id);
    if (first === undefined) where.set(s.id, e.id);
    else ctx.addIssue({ code: "custom", message: `Subfield id ${JSON.stringify(s.id)} is already used under ${first}`, path: ["fields", i, "subfields", j, "id"] });
  }));
  const owner = new Map<number, string>();
  const claim = (id: number, who: string, path: PathPart[]) => {
    const first = owner.get(id);
    if (first === undefined) owner.set(id, who);
    else ctx.addIssue({ code: "custom", message: `OpenAlex field ${id} is already listed under ${first}`, path });
  };
  f.fields.forEach((e, i) => e.openalex_fields.forEach((id, j) => claim(id, e.id, ["fields", i, "openalex_fields", j])));
  f.excluded.forEach((id, j) => claim(id, "excluded", ["excluded", j]));
  for (let id = OPENALEX_FIELD_MIN; id <= OPENALEX_FIELD_MAX; id++) {
    if (!owner.has(id)) {
      ctx.addIssue({ code: "custom", message: `OpenAlex field ${id} is listed under no field and not in excluded; its works would be dropped without a decision`, path: [] });
    }
  }
});

// ── journals.json and ai-terms.json ──────────────────────────────────────────────────────────────

/** True when `issn` (NNNN-NNNC) has the right check digit (ISO 3297: weights 8 to 2, modulus 11, X for 10). */
function issnCheckDigitFits(issn: string): boolean {
  const digits = issn.replace("-", "");
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += (8 - i) * Number(digits[i]);
  const check = (11 - (sum % 11)) % 11;
  return digits[7] === (check === 10 ? "X" : String(check));
}

const Issn = z.string()
  .regex(/^\d{4}-\d{3}[\dX]$/, { error: "Expected an ISSN as NNNN-NNNN (the last character may be X)", abort: true })
  .refine(issnCheckDigitFits, { error: "The ISSN's check digit is wrong" });

export const JournalEntry = z.strictObject({
  id: ConfigId,
  name: Text,
  openalex_source: z.string().regex(/^S\d+$/, { error: "Expected an OpenAlex source id such as S137773608" }),
  issn: Issn,
  fields: distinct(FieldId, "Field", 1).describe("The fields it publishes in; Nature, Science and PNAS list all seven"),
  in_pace: z.boolean().describe("True when it counts in Pace A (§4.11)"),
});

/** config/journals.json (SPEC §4.11): the leading journals for Pace A, with unique ids, names, OpenAlex sources and ISSNs, and at least one in the Pace. */
export const JournalsFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  journals: z.array(JournalEntry).min(1),
}).superRefine((f, ctx) => {
  noRepeats(ctx, f.journals, (j) => j.id, (j) => `Journal id ${JSON.stringify(j.id)}`, (i) => ["journals", i, "id"]);
  noRepeats(ctx, f.journals, (j) => foldWords(j.name), (j) => `Journal name ${JSON.stringify(j.name)}`, (i) => ["journals", i, "name"]);
  noRepeats(ctx, f.journals, (j) => j.openalex_source, (j) => `OpenAlex source ${j.openalex_source}`, (i) => ["journals", i, "openalex_source"]);
  noRepeats(ctx, f.journals, (j) => j.issn, (j) => `ISSN ${j.issn}`, (i) => ["journals", i, "issn"]);
  if (!f.journals.some((j) => j.in_pace)) ctx.addIssue({ code: "custom", message: "At least one journal must count in the Pace (in_pace true)", path: ["journals"] });
});

/** A phrase goes into an OpenAlex search in double quotes (§5.1): words of letters and digits, joined by single spaces or hyphens. */
const PHRASE_RE = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u;

export const AiTermEntry = z.strictObject({
  phrase: z.string().regex(PHRASE_RE, { error: "Expected words joined by single spaces or hyphens, with no quote or other punctuation: the phrase goes into a quoted search" }),
  in_pace: z.boolean().describe("True when the Pace counts it; candidate matching uses every phrase (§4.11)"),
});

/** config/ai-terms.json (SPEC §4.11): the phrases that name AI methods, each once (case aside), at least one counted by the Pace. */
export const AiTermsFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  phrases: z.array(AiTermEntry).min(1),
}).superRefine((f, ctx) => {
  noRepeats(ctx, f.phrases, (p) => foldWords(p.phrase), (p) => `Phrase ${JSON.stringify(p.phrase)}`, (i) => ["phrases", i, "phrase"]);
  if (!f.phrases.some((p) => p.in_pace)) ctx.addIssue({ code: "custom", message: "At least one phrase must count in the Pace (in_pace true)", path: ["phrases"] });
});

// ── source-tiers.json ────────────────────────────────────────────────────────────────────────────

/** Types no kind accepts (§4.11): a page of one of these is never primary. */
const TYPES_FOR_NO_KIND = ["news", "editorial", "feature", "interview"];
/** Commentary types fit `reaction` only (§4.11). */
const COMMENTARY_TYPES = ["news & views", "news and views", "perspective", "comment", "commentary", "preview", "viewpoint"];
/** Notice types (retraction, correction and expression-of-concern notes) fit `notice` only (§4.11). */
const NOTICE_TYPE_RE = /retraction|correction|erratum|corrigendum|expression of concern/i;

const Types = z.partialRecord(SourceKind, distinct(Text, "Type", 1))
  .describe("For each kind the publisher's URLs can pass for, the page types that fit it (compared without case)");

export const Publisher = z.strictObject({
  id: ConfigId,
  name: Text,
  hosts: hostList,
  kinds: kindList,
  paths: pathList(1).describe("URL path prefixes of its papers; / means any path"),
  deny_paths: pathList(0),
  reaction_paths: pathList(0).describe("Paths that pass for kind reaction only, such as Nature's News & Views"),
  type_field: TypeField.nullable().describe("Where a page gives its article type; null when it shows none"),
  types: Types,
}).superRefine((p, ctx) => {
  const reaches = new Set<SourceKind>(p.kinds);
  if (p.reaction_paths.length > 0) reaches.add("reaction");
  if (p.type_field === null) {
    // No type on the page: judged by the URL test alone, so no types and no reaction (§4.11).
    if (Object.keys(p.types).length > 0) ctx.addIssue({ code: "custom", message: "A publisher with no type_field lists no types: it is judged by the URL test alone (§4.11)", path: ["types"] });
    if (p.kinds.includes("reaction")) ctx.addIssue({ code: "custom", message: "A publisher with no type_field does not list reaction: only a typed page can be told from a news item (§4.11)", path: ["kinds"] });
    if (p.reaction_paths.length > 0) ctx.addIssue({ code: "custom", message: "A publisher with no type_field has no reaction_paths (§4.11)", path: ["reaction_paths"] });
  } else {
    for (const kind of reaches) {
      if (!p.types[kind]?.length) {
        ctx.addIssue({ code: "custom", message: `types has no list for kind ${kind}, which this publisher's URLs can pass for`, path: ["types"] });
      }
    }
    for (const kind of Object.keys(p.types) as SourceKind[]) {
      if (!reaches.has(kind)) {
        ctx.addIssue({ code: "custom", message: `types lists kind ${kind}, which this publisher's URLs cannot pass for (see kinds and reaction_paths)`, path: ["types", kind] });
      }
    }
  }
  const underKind = new Map<string, SourceKind>();
  for (const kind of Object.keys(p.types) as SourceKind[]) {
    (p.types[kind] ?? []).forEach((type, j) => {
      const at: PathPart[] = ["types", kind, j];
      const low = type.toLowerCase();
      if (TYPES_FOR_NO_KIND.includes(low)) {
        ctx.addIssue({ code: "custom", message: `${JSON.stringify(type)} fits no kind: a news, editorial, feature or interview page is never primary (§4.11)`, path: at });
      } else if (kind !== "reaction" && COMMENTARY_TYPES.includes(low)) {
        ctx.addIssue({ code: "custom", message: `${JSON.stringify(type)} is a commentary type, which fits kind reaction only (§4.11)`, path: at });
      } else if (kind !== "notice" && NOTICE_TYPE_RE.test(type)) {
        ctx.addIssue({ code: "custom", message: `${JSON.stringify(type)} is a notice type, which fits kind notice only (§4.11)`, path: at });
      }
      const first = underKind.get(low);
      if (first === undefined) underKind.set(low, kind);
      else if (first !== kind) ctx.addIssue({ code: "custom", message: `${JSON.stringify(type)} is also listed under kind ${first}; a type fits one kind`, path: at });
    });
  }
});

export const Resolver = z.strictObject({
  id: ConfigId,
  name: Text,
  hosts: hostList,
  kinds: kindList,
  paths: pathList(1),
  type_field: TypeField.nullable(),
  refused_pubtypes: distinct(Text, "Publication type").describe("Types that fail for every kind, such as PubMed's News"),
}).superRefine((r, ctx) => {
  // A PubMed or PMC record never passes for reaction: a reaction cites the publisher's own page (§4.11). A DOI lands on that page.
  // Every host of the entry must be a DOI host, or a record page listed beside one would pass for reaction too.
  if (r.kinds.includes("reaction") && !r.hosts.every((h) => h === "doi.org" || h.endsWith(".doi.org"))) {
    ctx.addIssue({ code: "custom", message: "Only the DOI resolver may list reaction: a record page never passes for it (§4.11)", path: ["kinds"] });
  }
});

export const RegistryEntry = z.strictObject({ id: ConfigId, name: Text, hosts: hostList, kinds: kindList, paths: pathList(1) });

export const ReactionSource = z.strictObject({ id: ConfigId, name: Text, hosts: hostList, paths: pathList(1) });

/** A DOI prefix of a news-only publication: lower case, as it is compared (§4.11). */
const DoiPrefix = z.string().regex(/^10\.\d{4,9}\/\S*$/, { error: "Expected the start of a DOI, such as 10.1021/cen-" })
  .refine((s) => s === s.toLowerCase(), { error: "A DOI prefix is lower case" });

/** The DOI prefix Nature's News & Views share with its news: no entry may deny it (§4.11). */
const NATURE_NEWS_AND_VIEWS_DOI = "10.1038/d41586-";

/**
 * config/source-tiers.json (SPEC §4.11): the primary-source allowlist `isPrimary(url, kind)` reads and the press deny
 * list. The key names are this project's reading of the spec: `deny_doi_prefixes` is a top-level list, `resolvers`
 * and `registries` have the shapes above, and `statement_suffixes` is one flat list in three forms (`statementForm`).
 */
export const SourceTiersFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  publishers: z.array(Publisher).min(1),
  resolvers: z.array(Resolver).min(1),
  deny_doi_prefixes: distinct(DoiPrefix, "DOI prefix"),
  registries: z.array(RegistryEntry),
  statement_suffixes: distinct(StatementEntry, "Statement entry", 1),
  reaction_sources: z.array(ReactionSource),
  press_hosts: distinct(HostName, "Press host", 1),
  figure_hosts: distinct(HostName, "Figure host", 1),
}).superRefine((t, ctx) => {
  for (const key of ["publishers", "resolvers", "registries", "reaction_sources"] as const) {
    noRepeats(ctx, t[key], (e) => e.id, (e) => `Id ${JSON.stringify(e.id)}`, (i) => [key, i, "id"]);
  }
  t.deny_doi_prefixes.forEach((prefix, i) => {
    if (NATURE_NEWS_AND_VIEWS_DOI.startsWith(prefix)) {
      ctx.addIssue({ code: "custom", message: `${prefix} would deny Nature's News & Views (${NATURE_NEWS_AND_VIEWS_DOI}), which share the prefix with its news and pass as reactions (§4.11)`, path: ["deny_doi_prefixes", i] });
    }
  });
});

// ── labs.json and checkers.json ──────────────────────────────────────────────────────────────────

export const Lab = z.strictObject({ id: ConfigId, name: Text, hosts: hostList, paths: pathList(1) });

/** config/labs.json (SPEC §4.11): each lab's own domains, whose posts are kind `lab_post`. */
export const LabsFile = z.strictObject({
  schema_version: z.literal(1),
  labs: z.array(Lab).min(1),
}).superRefine((f, ctx) => {
  noRepeats(ctx, f.labs, (l) => l.id, (l) => `Lab id ${JSON.stringify(l.id)}`, (i) => ["labs", i, "id"]);
});

/** The rungs a checker can give: the counted ones (§4.2). */
const CheckerRung = z.enum(COUNTED_RUNGS);

export const Checker = z.strictObject({
  id: ConfigId,
  name: Text,
  hosts: hostList,
  paths: pathList(1),
  rungs: distinct(CheckerRung, "Rung", 1).describe("The rungs this checker's records can show"),
});

/** config/checkers.json (SPEC §4.11): recognised checkers, with the counted rungs each can give. */
export const CheckersFile = z.strictObject({
  schema_version: z.literal(1),
  checkers: z.array(Checker).min(1),
}).superRefine((f, ctx) => {
  noRepeats(ctx, f.checkers, (c) => c.id, (c) => `Checker id ${JSON.stringify(c.id)}`, (i) => ["checkers", i, "id"]);
});

// ── ai-drugs.json ────────────────────────────────────────────────────────────────────────────────

export const DrugApproval = z.strictObject({
  regulator: ConfigId.describe("A checkers.json id with the rung applied"),
  date: IsoDate,
  source_url: HttpsUrl.describe("The regulator's own record of the approval"),
});

export const Drug = z.strictObject({
  id: ConfigId,
  name: Text,
  developer: Text,
  ai_basis: Text.describe("The developer's or a paper's own statement that AI found or designed it"),
  source_url: HttpsUrl,
  trials: distinct(z.string().regex(ID_PATTERNS.trial, { error: "Expected an NCT number such as NCT05938920" }), "Trial"),
  approved: DrugApproval.nullable().describe("The earliest approval, or null"),
});

/** config/ai-drugs.json (SPEC §4.11): AI-found drugs for the counter; a PR adds entries. */
export const AiDrugsFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  drugs: z.array(Drug),
}).superRefine((f, ctx) => {
  noRepeats(ctx, f.drugs, (d) => d.id, (d) => `Drug id ${JSON.stringify(d.id)}`, (i) => ["drugs", i, "id"]);
});

// ── counters.json ────────────────────────────────────────────────────────────────────────────────

/** The counters of §5.7, in the order the file lists them. */
export const COUNTER_IDS = ["erdos_ai", "mathlib_theorems", "ai_drugs", "pdb_structures", "ai_retractions", "full_bibles", "ancient_texts_ai"] as const;

/** The kinds each counter may have (§5.7): `erdos_ai` reads an API, else a manual figure. */
const COUNTER_KINDS_OF: Record<(typeof COUNTER_IDS)[number], readonly CounterKind[]> = {
  erdos_ai: ["api", "manual"],
  mathlib_theorems: ["api"],
  ai_drugs: ["api"],
  pdb_structures: ["api"],
  ai_retractions: ["api"],
  full_bibles: ["manual"],
  ancient_texts_ai: ["ledger"],
};

/** One annual figure of the `full_bibles` counter: the Wycliffe Global Alliance's total of languages with a full Bible. */
export const CounterFigure = z.strictObject({ as_of: IsoDate, total: Count, source_url: HttpsUrl });

export const Counter = z.strictObject({
  id: CounterId,
  label: BothLanguages,
  unit: BothLanguages,
  kind: CounterKind,
  source: Text.describe("Where the value comes from, in words"),
  value: Count.nullable().describe("Only a manual counter other than full_bibles holds one, set by PR with a source"),
  as_of: IsoDate.nullable().describe("The date of `value`; null exactly when value is"),
  source_url: HttpsUrl,
  figures: z.array(CounterFigure).describe("full_bibles only: the annual totals, oldest first; [] on every other counter"),
});

/** config/counters.json (SPEC §4.11, §5.7): the seven counters in order, each with a kind its id allows, its manual value and date, and the figures of `full_bibles`. */
export const CountersFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  counters: z.array(Counter),
}).superRefine((f, ctx) => {
  const ids = f.counters.map((c) => c.id);
  if (ids.length !== COUNTER_IDS.length || ids.some((id, i) => id !== COUNTER_IDS[i])) {
    ctx.addIssue({ code: "custom", message: `counters must be exactly ${COUNTER_IDS.join(", ")}, in this order (§5.7)`, path: ["counters"] });
  }
  f.counters.forEach((c, i) => {
    const kinds: readonly CounterKind[] | undefined = (COUNTER_KINDS_OF as Record<string, readonly CounterKind[] | undefined>)[c.id];
    if (kinds && !kinds.includes(c.kind)) {
      ctx.addIssue({ code: "custom", message: `${c.id} has kind ${kinds.join(" or ")} (§5.7), not ${c.kind}`, path: ["counters", i, "kind"] });
    }
    const holdsValue = c.kind === "manual" && c.id !== "full_bibles";
    if (!holdsValue && (c.value !== null || c.as_of !== null)) {
      ctx.addIssue({ code: "custom", message: "value and as_of are null: only a manual counter other than full_bibles holds them (§4.11)", path: ["counters", i, c.value !== null ? "value" : "as_of"] });
    }
    if ((c.value === null) !== (c.as_of === null)) {
      ctx.addIssue({ code: "custom", message: "value and as_of come together: a value has its date", path: ["counters", i, c.value === null ? "value" : "as_of"] });
    }
    if (c.id !== "full_bibles" && c.figures.length > 0) {
      ctx.addIssue({ code: "custom", message: "figures belong to full_bibles only; every other counter has []", path: ["counters", i, "figures"] });
    }
    c.figures.forEach((figure, j) => {
      const previous = c.figures[j - 1];
      if (previous && previous.as_of >= figure.as_of) {
        ctx.addIssue({ code: "custom", message: `figures run oldest first with one figure for each date; ${figure.as_of} does not come after ${previous.as_of}`, path: ["counters", i, "figures", j, "as_of"] });
      }
    });
  });
});

// ── markers.json and standing-stories.json ───────────────────────────────────────────────────────

export const Marker = z.strictObject({
  date: IsoDate,
  label: BothLanguages,
  source_url: HttpsUrl.describe("The event's own primary source"),
});

/** config/markers.json (SPEC §4.11): the dated chart markers, oldest first, each event once. */
export const MarkersFile = z.strictObject({
  schema_version: z.literal(1),
  markers: z.array(Marker),
}).superRefine((f, ctx) => {
  f.markers.forEach((m, i) => {
    const previous = f.markers[i - 1];
    if (previous && previous.date > m.date) {
      ctx.addIssue({ code: "custom", message: `Markers run oldest first; ${m.date} comes before ${previous.date}`, path: ["markers", i, "date"] });
    }
  });
  noRepeats(ctx, f.markers, (m) => `${m.date} ${m.label.en}`, (m) => `Marker ${JSON.stringify(m.label.en)} on ${m.date}`, (i) => ["markers", i, "label", "en"]);
});

export const StandingStory = z.strictObject({
  id: ConfigId,
  finding_ids: distinct(FindingId, "Finding id", 1),
  rule: Text.describe("When the story may return: only on new facts"),
});

/** config/standing-stories.json (SPEC §4.11): long-running stories that return only on new facts. */
export const StandingStoriesFile = z.strictObject({
  schema_version: z.literal(1),
  stories: z.array(StandingStory),
}).superRefine((f, ctx) => {
  noRepeats(ctx, f.stories, (s) => s.id, (s) => `Story id ${JSON.stringify(s.id)}`, (i) => ["stories", i, "id"]);
});

// ── terms-zh.json ────────────────────────────────────────────────────────────────────────────────

export const FixedTerm = z.strictObject({
  en: Text.describe("Matches whole words in any case, a hyphen counting as a space, with a regular plural; an en in capitals only in capitals"),
  zh: Text.describe("The Taiwan term every string the entry applies to must hold"),
  fields: distinct(FieldId, "Field").describe("Limits the entry to findings in these fields; [] sets no limit"),
  except: distinct(Text, "Phrase").describe("English phrases where the entry does not apply; each holds `en`"),
});

export const AvoidTerm = z.strictObject({
  term: Text.describe("A mainland or Hong Kong term that Taiwan does not write"),
  taiwan: Text.describe("Its Taiwan form"),
  allow_in: distinct(Text, "Taiwan string").describe("Taiwan strings that hold `term`: ZH_AVOID masks them before it looks for the term"),
});

/**
 * A list of characters, each once, in code point order, all Han: the two character lists of terms-zh.json are one string
 * each (`simplified_only` holds characters outside the Basic Multilingual Plane, so it is read by code point).
 */
const HanChars = z.string().min(1).superRefine((chars, ctx) => {
  let previous = -1;
  let reported = 0;
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    let problem: string | null = null;
    if (!/^\p{Script=Han}$/u.test(ch)) problem = `${JSON.stringify(ch)} (${pad(cp)}) is not a Han character`;
    else if (cp === previous) problem = `${ch} (${pad(cp)}) is listed twice`;
    else if (cp < previous) problem = `${ch} (${pad(cp)}) is out of code point order`;
    if (problem !== null && reported < 5) {
      ctx.addIssue({ code: "custom", message: problem, path: [] });
      reported += 1;
    }
    if (cp > previous) previous = cp;
  }
});

/** config/terms-zh.json (SPEC §4.11): the Taiwan-usage lists. Key order follows the file: japanese_only comes before simplified_only, which the P1 tool writes last. */
export const TermsZhFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  fixed: z.array(FixedTerm).min(1),
  avoid: z.array(AvoidTerm).min(1),
  japanese_only: HanChars.describe("Japanese forms that have no kTraditionalVariant and that Taiwan writes otherwise"),
  simplified_only: HanChars.describe("Every character with a Unihan kTraditionalVariant, except the Ministry of Education's common characters and the Taiwan extras"),
}).superRefine((t, ctx) => {
  const simplified = new Set([...t.simplified_only]);
  const japanese = new Set([...t.japanese_only]);
  const foreign = (text: string): string[] => [...new Set([...text].filter((ch) => simplified.has(ch) || japanese.has(ch)))];
  noRepeats(ctx, t.fixed, (e) => foldWords(e.en), (e) => `Fixed term ${JSON.stringify(e.en)}`, (i) => ["fixed", i, "en"]);
  t.fixed.forEach((e, i) => {
    const re = wordRe(e.en, { plurals: true });
    e.except.forEach((phrase, j) => {
      if (!re.test(phrase)) {
        ctx.addIssue({ code: "custom", message: `The exception ${JSON.stringify(phrase)} does not hold ${JSON.stringify(e.en)}, so it is not an exception to it`, path: ["fixed", i, "except", j] });
      }
    });
    const bad = foreign(e.zh);
    if (bad.length > 0) ctx.addIssue({ code: "custom", message: `zh holds ${bad.join(" ")}, which Taiwan does not write (simplified_only or japanese_only)`, path: ["fixed", i, "zh"] });
  });
  noRepeats(ctx, t.avoid, (a) => a.term, (a) => `Avoided term ${JSON.stringify(a.term)}`, (i) => ["avoid", i, "term"]);
  t.avoid.forEach((a, i) => {
    const bad = foreign(a.taiwan);
    if (bad.length > 0) ctx.addIssue({ code: "custom", message: `taiwan holds ${bad.join(" ")}, which Taiwan does not write (simplified_only or japanese_only)`, path: ["avoid", i, "taiwan"] });
    a.allow_in.forEach((s, j) => {
      if (!s.includes(a.term)) ctx.addIssue({ code: "custom", message: `${JSON.stringify(s)} does not hold ${JSON.stringify(a.term)}, so it cannot be allowed in for it`, path: ["avoid", i, "allow_in", j] });
      const wrong = foreign(s);
      if (wrong.length > 0) ctx.addIssue({ code: "custom", message: `allow_in holds ${wrong.join(" ")}, which Taiwan does not write (simplified_only or japanese_only)`, path: ["avoid", i, "allow_in", j] });
    });
  });
  const both = [...japanese].filter((ch) => simplified.has(ch));
  if (both.length > 0) ctx.addIssue({ code: "custom", message: `${both.join(" ")} is in both japanese_only and simplified_only; a character is in one`, path: ["japanese_only"] });
});

// ── jargon.json, hype-words.json and dual-use.json ───────────────────────────────────────────────

export const JargonWord = z.strictObject({
  en: z.string().regex(/^\S+(?: \S+)*$/, { error: "Expected a word or phrase with single spaces and none at either end" }),
  fields: distinct(FieldId, "Field").describe("The fields it belongs to; [] for a word of any field"),
});

/** config/jargon.json (SPEC §4.11): about 400 technical words that must be defined (TERM_DEFINED), each once. */
export const JargonFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  words: z.array(JargonWord).min(1),
}).superRefine((f, ctx) => {
  noRepeats(ctx, f.words, (w) => foldWords(w.en), (w) => `Word ${JSON.stringify(w.en)}`, (i) => ["words", i, "en"]);
});

/** config/hype-words.json (SPEC §4.11): the words HYPE_WORDS and ZH_HYPE refuse, and the names that hold one and are masked first. */
export const HypeWordsFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  en: distinct(Text, "English hype word", 1),
  zh: distinct(Text, "Chinese hype word", 1),
  names: z.array(ZhHypeName).describe("Proper names that hold a hype word: the Chinese form, or null for a name kept in English"),
}).superRefine((f, ctx) => {
  noRepeats(ctx, f.names, (n) => n.en, (n) => `Name ${JSON.stringify(n.en)}`, (i) => ["names", i, "en"]);
  f.names.forEach((n, i) => {
    if (!f.en.some((word) => wordRe(word).test(n.en))) {
      ctx.addIssue({ code: "custom", message: `${JSON.stringify(n.en)} holds no word of en, so there is nothing to mask`, path: ["names", i, "en"] });
    }
    const zh = n.zh;
    if (zh !== null && !f.zh.some((word) => zh.includes(word))) {
      ctx.addIssue({ code: "custom", message: `${JSON.stringify(zh)} holds no word of zh, so there is nothing to mask`, path: ["names", i, "zh"] });
    }
  });
});

export const DualUseEntry = z.strictObject({
  en: distinct(Text, "English form", 1),
  zh: distinct(Text, "Chinese form").describe("Its Chinese forms in Taiwan usage; [] when it has none"),
});

const DualUseList = z.array(DualUseEntry).min(1);

const DUAL_USE_LISTS = ["agents", "procedures", "units"] as const;

/**
 * config/dual-use.json (SPEC §4.11): DUAL_USE's word lists. The sequence and step patterns are code (§4.12). A form is
 * listed once: a form under two entries is a copy slip, and one that stands as an agent and as a procedure would make
 * a lone word a hit. English forms compare as the word matching reads them (`foldWords`), Chinese forms as written.
 */
export const DualUseFile = z.strictObject({
  schema_version: z.literal(1),
  version: Version,
  agents: DualUseList.describe("Pathogen, toxin and chemical weapon terms"),
  procedures: DualUseList.describe("Words that mark a method"),
  units: DualUseList.describe("The units that make a quantity"),
}).superRefine((f, ctx) => {
  const first = new Map<string, string>();
  for (const list of DUAL_USE_LISTS) {
    f[list].forEach((entry, i) => {
      const here = `${list}[${i}]`;
      for (const language of ["en", "zh"] as const) {
        entry[language].forEach((form, j) => {
          const key = `${language}:${language === "en" ? foldWords(form) : form}`;
          const where = first.get(key);
          if (where === undefined) first.set(key, here);
          else if (where !== here) {
            ctx.addIssue({ code: "custom", message: `The ${language === "en" ? "English" : "Chinese"} form ${JSON.stringify(form)} is already listed at ${where}`, path: [list, i, language, j] });
          }
        });
      }
    });
  }
});

// ── Types ────────────────────────────────────────────────────────────────────────────────────────

export type ClockTime = z.infer<typeof ClockTime>;
export type HostName = z.infer<typeof HostName>;
export type PathPrefix = z.infer<typeof PathPrefix>;
export type RunFile = z.infer<typeof RunFile>;
export type Subfield = z.infer<typeof Subfield>;
export type FieldEntry = z.infer<typeof FieldEntry>;
export type FieldsFile = z.infer<typeof FieldsFile>;
export type JournalEntry = z.infer<typeof JournalEntry>;
export type JournalsFile = z.infer<typeof JournalsFile>;
export type AiTermEntry = z.infer<typeof AiTermEntry>;
export type AiTermsFile = z.infer<typeof AiTermsFile>;
export type Publisher = z.infer<typeof Publisher>;
export type Resolver = z.infer<typeof Resolver>;
export type RegistryEntry = z.infer<typeof RegistryEntry>;
export type ReactionSource = z.infer<typeof ReactionSource>;
export type SourceTiersFile = z.infer<typeof SourceTiersFile>;
export type Lab = z.infer<typeof Lab>;
export type LabsFile = z.infer<typeof LabsFile>;
export type Checker = z.infer<typeof Checker>;
export type CheckersFile = z.infer<typeof CheckersFile>;
export type DrugApproval = z.infer<typeof DrugApproval>;
export type Drug = z.infer<typeof Drug>;
export type AiDrugsFile = z.infer<typeof AiDrugsFile>;
export type CounterFigure = z.infer<typeof CounterFigure>;
export type Counter = z.infer<typeof Counter>;
export type CountersFile = z.infer<typeof CountersFile>;
export type Marker = z.infer<typeof Marker>;
export type MarkersFile = z.infer<typeof MarkersFile>;
export type StandingStory = z.infer<typeof StandingStory>;
export type StandingStoriesFile = z.infer<typeof StandingStoriesFile>;
export type FixedTerm = z.infer<typeof FixedTerm>;
export type AvoidTerm = z.infer<typeof AvoidTerm>;
export type TermsZhFile = z.infer<typeof TermsZhFile>;
export type JargonWord = z.infer<typeof JargonWord>;
export type JargonFile = z.infer<typeof JargonFile>;
export type HypeWordsFile = z.infer<typeof HypeWordsFile>;
export type DualUseEntry = z.infer<typeof DualUseEntry>;
export type DualUseFile = z.infer<typeof DualUseFile>;
