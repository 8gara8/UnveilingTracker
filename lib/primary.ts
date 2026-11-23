// The primary-source allowlist (SPEC §4.11: the URL test `isPrimary()` and the type check `articleTypeFits()` over
// source-tiers.json, labs.json and checkers.json; §4.12 PRIMARY_ONLY, and the checkers that RUNG_EVIDENCE and WHO_SAYS
// read; §4.14 a candidate's `types`; §4.2 BLOCKED_HOSTS). Pure: the config and the run's evidence come in as arguments,
// and nothing is read, cached or changed. The values the seed files hold are unverified until P2 (Appendix B), so this
// file judges by the lists it is given.
//
// The URL test, in this order. (1) The address is https, has no user name or password and names no port but 443; else
// it fails for every kind. (2) A BLOCKED_HOSTS entry (`blockedEntry()`) fails it for every kind, before any allowlist
// is read, so gist.github.com, api.github.com and codeload.github.com fail although github.com is a registry host.
// (3) A `press_hosts` entry fails it for every kind, unless a `reaction_sources`, `labs.json` or `checkers.json` entry
// names its host and path, which wins. (4) A `deny_paths` prefix of a publisher on its host, or a `deny_doi_prefixes`
// prefix on a doi.org address, fails it for every kind. (5) Then each entry that lists the host and a path prefix adds
// its kinds: a publisher its `kinds` (and `reaction` through its `reaction_paths`), a resolver or registry its `kinds`,
// a lab `lab_post`, a checker `checker`, and the `statement_suffixes` `statement`; a `reaction_sources` entry makes it
// `reaction` and no other kind. A URL passes for the kinds so collected; for none it is refused as unlisted.
//
// Conventions every list of the three files shares. A host entry matches the host and every subdomain, after the URL's
// host is lower-cased and loses a trailing dot (`hostMatches()`, `hostOf()`). A path entry is a plain string prefix of
// the URL's path in `matchPath()` form (lower case, unreserved escapes decoded, slashes collapsed; the entry is put in
// that form too), so `/articles/s` also admits `/articles/sx`, on purpose; `/` admits any path; the query and the
// fragment are never read. `statement_suffixes` has three forms and gives kind `statement` only: a suffix when it starts
// with a dot (`.edu`), a host and its subdomains (`mpg.de`), a host with a path prefix (`cell.com/newsroom`). A host
// that a `resolvers` or `registries` entry names is left out of them, so the `.gov` suffix never lets a PubMed or PMC
// record, a ClinicalTrials.gov page or an EMBL-EBI page pass as a statement; a checker or lab entry may still name such
// a host for kind `checker` or `lab_post`. Types are compared without case, trimmed, one space between words.
//
// The type check (draft mode only, §4.12) reads the evidence's `types` and `resolved`, both keyed by `normalizeUrl()`.
//
// Cyber's lib/sources.ts at the fork commit 3ced1fb, adapted: its `publisherFor()`, `urlOnDomain()` and `pathUnder()`
// are the pattern for matching a host and a path against a list. Here there are no tiers and no cache, a path prefix is
// a plain string prefix in `matchPath()` form, each entry lists the kinds it gives, a blocked host fails first, and the
// type check, the publisher lookup for it and the helpers for collect and the rules are new.

import type { ConfigFiles } from "./config";
import { statementForm, type Checker, type Publisher, type Resolver } from "./schema/config";
import type { Evidence } from "./schema/misc";
import { blockedEntry, hostMatches, matchPath, normalizeUrl } from "./urls";
import { COUNTED_RUNGS, SOURCE_KINDS, type CountedRung, type SourceKind } from "./vocab";

/** The three parsed files the allowlist reads: a `LoadedConfig`, or any object that holds them. */
export type PrimaryConfig = Pick<ConfigFiles, "sourceTiers" | "labs" | "checkers">;

// ── What the lists compare ───────────────────────────────────────────────────────────────────────

/** The parts of an https address that the lists compare. */
interface Address {
  /** Lower case and without a trailing dot, as `hostOf()` reads it (lib/urls.ts). */
  host: string;
  /** `matchPath()` of the URL's path (lower case, unreserved escapes decoded, one slash at a time): what every prefix is compared with. */
  path: string;
}

type ShapeRefusal = "not_https" | "user_info" | "port";

/** The address of an https URL with no user info and no port but 443, else the way it fails. */
function addressOf(url: string): Address | ShapeRefusal {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "not_https";
  }
  if (u.protocol !== "https:") return "not_https";
  if (u.username !== "" || u.password !== "") return "user_info";
  // an https URL's default port is dropped by the parser, so any port left is another service
  if (u.port !== "") return "port";
  // the parser lower-cases an https host; one trailing dot names the same host
  return { host: u.hostname.replace(/\.$/, ""), path: matchPath(u.pathname) };
}

/** What an entry lists: its hosts (each with its subdomains) and its path prefixes. */
interface Listing {
  hosts: readonly string[];
  paths: readonly string[];
}

const onHost = (host: string, hosts: readonly string[]): boolean => hosts.some((h) => hostMatches(host, h));
const underPath = (path: string, prefixes: readonly string[]): boolean => prefixes.some((p) => path.startsWith(matchPath(p)));
const names = (a: Address, entry: Listing): boolean => onHost(a.host, entry.hosts) && underPath(a.path, entry.paths);

/** True when a `statement_suffixes` entry, in any of its three forms, lists the address. */
function isStatement(a: Address, entries: readonly string[]): boolean {
  return entries.some((entry) => {
    switch (statementForm(entry)) {
      case "suffix":
        return a.host.endsWith(entry);
      case "host":
        return hostMatches(a.host, entry);
      case "path": {
        const slash = entry.indexOf("/");
        return hostMatches(a.host, entry.slice(0, slash)) && a.path.startsWith(matchPath(entry.slice(slash)));
      }
    }
  });
}

/**
 * The DOI a doi.org address holds: its path after the one leading slash, escapes decoded, or as written when an escape does not
 * decode. The path is already lower case (a DOI is case-insensitive) with no run of slashes, so `//10.1063/pt.` reads as `10.1063/pt.`.
 */
function doiOf(path: string): string {
  try {
    return decodeURIComponent(path.slice(1));
  } catch {
    return path.slice(1);
  }
}

/** True for doi.org, dx.doi.org and any other host under doi.org. */
const isDoiHost = (host: string): boolean => hostMatches(host, "doi.org");

/** The text of a type as the lists compare it: no case, no padding, one space between words. */
const fold = (type: string): string => type.trim().replace(/\s+/g, " ").toLowerCase();

// ── The URL test ─────────────────────────────────────────────────────────────────────────────────

/** Why the URL test fails for every kind: the address, a list that refuses it, or no entry that lists it. */
export type UrlRefusal = ShapeRefusal | "blocked_host" | "press_host" | "denied_path" | "denied_doi_prefix" | "unlisted";

/** `UrlRefusal`, or `wrong_kind` for a URL that passes for other kinds than the one asked for. */
export type PrimaryRefusal = UrlRefusal | "wrong_kind";

export interface PrimaryTest {
  /** Every kind the URL passes for, in `SOURCE_KINDS` order; [] when `refusal` is set. */
  kinds: SourceKind[];
  /** Why no kind passes; null exactly when `kinds` is not empty. */
  refusal: UrlRefusal | null;
  /**
   * What refused it: the BLOCKED_HOSTS pattern, the first press entry the host is or sits under, the denied path prefix or the denied
   * DOI prefix, as the lists write them; null for the other refusals.
   */
  by: string | null;
}

const refused = (refusal: UrlRefusal, by: string | null): PrimaryTest => ({ kinds: [], refusal, by });

/** The first path prefix some publisher on the address's host denies, else null. */
function deniedPath(a: Address, publishers: readonly Publisher[]): string | null {
  for (const p of publishers) {
    if (!onHost(a.host, p.hosts)) continue;
    const prefix = p.deny_paths.find((d) => a.path.startsWith(matchPath(d)));
    if (prefix !== undefined) return prefix;
  }
  return null;
}

/** The first DOI prefix (lower case, as the schema keeps them) that the DOI of a doi.org address starts with, else null (also for any other host). */
function deniedDoiPrefix(a: Address, prefixes: readonly string[]): string | null {
  if (!isDoiHost(a.host)) return null;
  const doi = doiOf(a.path);
  return prefixes.find((p) => doi.startsWith(p)) ?? null;
}

/** The kinds the entries that list the address give it, in `SOURCE_KINDS` order. */
function kindsOf(a: Address, config: PrimaryConfig): SourceKind[] {
  const t = config.sourceTiers;
  // a reaction source's pages are kind reaction and no other (§4.11), so a scientist's page under .edu is never a statement
  if (t.reaction_sources.some((r) => names(a, r))) return ["reaction"];
  const kinds = new Set<SourceKind>();
  for (const p of t.publishers) {
    if (!onHost(a.host, p.hosts)) continue;
    if (underPath(a.path, p.paths)) for (const k of p.kinds) kinds.add(k);
    if (underPath(a.path, p.reaction_paths)) kinds.add("reaction");
  }
  const records = [...t.resolvers, ...t.registries];
  for (const r of records) if (names(a, r)) for (const k of r.kinds) kinds.add(k);
  if (!records.some((r) => onHost(a.host, r.hosts)) && isStatement(a, t.statement_suffixes)) kinds.add("statement");
  if (config.labs.labs.some((l) => names(a, l))) kinds.add("lab_post");
  if (config.checkers.checkers.some((c) => names(a, c))) kinds.add("checker");
  return SOURCE_KINDS.filter((k) => kinds.has(k));
}

/**
 * The URL test of §4.11 for every kind at once: the kinds `url` passes for, or why it passes for none. `isPrimary()` and
 * `primaryKindsFor()` read the kinds; `primaryProblem()` and `candidateRefusal()` read the reason.
 */
export function primaryTest(url: string, config: PrimaryConfig): PrimaryTest {
  const a = addressOf(url);
  if (typeof a === "string") return refused(a, null);
  const blocked = blockedEntry(url);
  if (blocked !== null) return refused("blocked_host", blocked.pattern);

  const t = config.sourceTiers;
  // a reaction source, a lab or a checker that lists the host and the path wins over the press list (§4.11)
  const wins = [...t.reaction_sources, ...config.labs.labs, ...config.checkers.checkers].some((e) => names(a, e));
  const press = t.press_hosts.find((h) => hostMatches(a.host, h));
  if (press !== undefined && !wins) return refused("press_host", press);
  const path = deniedPath(a, t.publishers);
  if (path !== null) return refused("denied_path", path);
  const doi = deniedDoiPrefix(a, t.deny_doi_prefixes);
  if (doi !== null) return refused("denied_doi_prefix", doi);

  const kinds = kindsOf(a, config);
  return kinds.length === 0 ? refused("unlisted", null) : { kinds, refusal: null, by: null };
}

/**
 * `isPrimary(url, kind)` (§4.11, "The URL test"): true when an entry lists the URL's host and path for `kind` and nothing
 * refuses the URL (see the file's header for the order). Every caller uses it: PRIMARY_ONLY in both modes, report intake (for
 * some kind: `primaryKindsFor(url, config).length > 0`), the rung watch (for `paper`) and collect and ranking.
 */
export function isPrimary(url: string, kind: SourceKind, config: PrimaryConfig): boolean {
  return primaryTest(url, config).kinds.includes(kind);
}

/** Every kind `url` passes the URL test for, in `SOURCE_KINDS` order; [] when it is refused or no entry lists it. */
export function primaryKindsFor(url: string, config: PrimaryConfig): SourceKind[] {
  return primaryTest(url, config).kinds;
}

export interface PrimaryProblem {
  code: PrimaryRefusal;
  /** What is wrong and what to cite instead, in plain English. It does not repeat the URL: the rule that reports it adds the path. */
  message: string;
}

/** `"a"`, `"a" or "b"`, `"a", "b" or "c"`: quoted words for a message. */
function orList(items: readonly string[]): string {
  const quotedItems = items.map((item) => `"${item}"`);
  return quotedItems.length < 2 ? quotedItems.join("") : `${quotedItems.slice(0, -1).join(", ")} or ${quotedItems.at(-1)}`;
}

/**
 * Why `isPrimary(url, kind, config)` is false, as a code and a message that says how to fix it (PRIMARY_ONLY's message);
 * null when it is true.
 */
export function primaryProblem(url: string, kind: SourceKind, config: PrimaryConfig): PrimaryProblem | null {
  const t = primaryTest(url, config);
  if (t.kinds.includes(kind)) return null;
  const code: PrimaryRefusal = t.refusal ?? "wrong_kind";
  switch (code) {
    case "not_https":
      return { code, message: "The address is not an https address. Cite the source's own https page." };
    case "user_info":
      return { code, message: "The address has a user name or password in it. Cite the plain address." };
    case "port":
      return { code, message: "The address names a port other than the default one. Cite the record's regular https address." };
    case "blocked_host":
      return {
        code,
        message: `${t.by} is on the blocked list: a link shortener, redirect, web archive, paste site, messaging link, leak site, scan query or shadow library is never a source. Cite the record's own page.`,
      };
    case "press_host":
      return {
        code,
        message: `${t.by} is a news, magazine, blog or aggregator site, never a source. Cite the primary record it reports: the paper, the preprint, the lab's own post or the institution's own release.`,
      };
    case "denied_path":
      return { code, message: `Pages under ${t.by} on this site are news and features, not papers. Cite the paper's own page.` };
    case "denied_doi_prefix":
      return { code, message: `DOIs that start with ${t.by} name a news publication's items, not papers. Cite the primary record.` };
    case "unlisted":
      return {
        code,
        message: "No source list names this page. Cite the paper's page on its publisher, a preprint server, a registry, the lab's own site or the institution's own release.",
      };
    case "wrong_kind":
      return {
        code,
        message: `This page can be cited as ${orList(t.kinds)}, not as "${kind}". Give the source ${t.kinds.length === 1 ? "that kind" : "one of those kinds"}, or cite a page of kind "${kind}".`,
      };
  }
}

// ── Lookups the callers share ────────────────────────────────────────────────────────────────────

/**
 * The publisher entries that list the URL: its host, and a path under `paths` or `reaction_paths` that the entry's own
 * `deny_paths` do not cover, in file order. The type check reads the ones with a `type_field`.
 */
export function publishersFor(url: string, config: Pick<PrimaryConfig, "sourceTiers">): Publisher[] {
  const a = addressOf(url);
  if (typeof a === "string") return [];
  return config.sourceTiers.publishers.filter(
    (p) => onHost(a.host, p.hosts) && !underPath(a.path, p.deny_paths) && (underPath(a.path, p.paths) || underPath(a.path, p.reaction_paths)),
  );
}

/** The `checkers.json` entries that list the URL, in file order; [] when the URL fails the URL test for kind `checker` (WHO_SAYS names the checker). */
export function checkersFor(url: string, config: PrimaryConfig): Checker[] {
  const a = addressOf(url);
  if (typeof a === "string" || !primaryTest(url, config).kinds.includes("checker")) return [];
  return config.checkers.checkers.filter((c) => names(a, c));
}

/**
 * The rungs the `checkers.json` entries that list the URL can give, in `COUNTED_RUNGS` order; null when no entry lists it.
 * This is RUNG_EVIDENCE's `checkerRungs` (lib/rungs.ts `EvidenceFacts`).
 */
export function checkerRungsFor(url: string, config: PrimaryConfig): CountedRung[] | null {
  const found = checkersFor(url, config);
  if (found.length === 0) return null;
  return COUNTED_RUNGS.filter((r) => found.some((c) => c.rungs.includes(r)));
}

/**
 * The first of `types` that a resolver's `refused_pubtypes` holds (compared without case), as written in `types`; null when none
 * does. It reads every resolver's list: PubMed's names and PMC's differ, and a record's types can come from either (§4.14).
 * Collect and ranking drop a candidate with one, so PubMed's news records are never candidates (§4.11).
 */
export function refusedPubtype(types: readonly string[], config: Pick<PrimaryConfig, "sourceTiers">): string | null {
  const refusedTypes = new Set(config.sourceTiers.resolvers.flatMap((r) => r.refused_pubtypes.map(fold)));
  return types.find((type) => refusedTypes.has(fold(type))) ?? null;
}

/** Why collect or ranking drops a candidate: the URL test's reason, `wrong_kind`, or `refused_pubtype`. */
export type CandidateRefusal = PrimaryRefusal | "refused_pubtype";

/**
 * Collect's and ranking's test of a candidate (§4.11, §5.9): null (keep it) when its URL passes for some kind but `reaction`,
 * or, with `reaction` true (it comes from a feed that yields reactions, `smc-reactions`), for `reaction`, and none of its
 * `types` is refused (`refusedPubtype()`). Nature's news, which share a path with its News & Views, pass for `reaction` only, so
 * no other feed keeps them; PubMed's news records fail on their types.
 */
export function candidateRefusal(
  candidate: { url: string; types: readonly string[]; reaction?: boolean },
  config: PrimaryConfig,
): CandidateRefusal | null {
  const t = primaryTest(candidate.url, config);
  if (t.refusal !== null) return t.refusal;
  const wanted = candidate.reaction === true ? t.kinds.includes("reaction") : t.kinds.some((k) => k !== "reaction");
  if (!wanted) return "wrong_kind";
  return refusedPubtype(candidate.types, config) === null ? null : "refused_pubtype";
}

// ── The type check ───────────────────────────────────────────────────────────────────────────────

/**
 * How the type check judges a URL (§4.11 "The type check"). `publisher`: a URL on a publisher whose `type_field` is set (the
 * entries). `record`: a PubMed or PMC page, any resolver other than doi.org (the entries). `doi`: a doi.org URL, judged through
 * its landing. `none`: every other URL, judged by the URL test alone. The snapshot step takes the URLs whose plan is not `none`
 * and whose types, or landing for a DOI, the evidence lacks.
 */
export type TypePlan =
  | { branch: "none" }
  | { branch: "doi" }
  | { branch: "record"; entries: Resolver[] }
  | { branch: "publisher"; entries: Publisher[] };

export type TypeBranch = TypePlan["branch"];

/** The type check's plan for `url`: a doi.org address listed by a resolver, then another resolver's page, then a typed publisher's, else `none`. */
export function typePlanFor(url: string, config: Pick<PrimaryConfig, "sourceTiers">): TypePlan {
  const a = addressOf(url);
  if (typeof a === "string") return { branch: "none" };
  const resolvers = config.sourceTiers.resolvers.filter((r) => names(a, r));
  if (resolvers.length > 0) return isDoiHost(a.host) ? { branch: "doi" } : { branch: "record", entries: resolvers };
  const typed = publishersFor(url, config).filter((p) => p.type_field !== null);
  return typed.length > 0 ? { branch: "publisher", entries: typed } : { branch: "none" };
}

/**
 * The `type_field` of the entry the URL is on: what the snapshot step reads out of the HTML into `article_types` (§4.11), for the
 * snapshot's `final_url`. A `<meta>` tag's name or a CSS selector (`typeFieldKind()`); null when the URL is on no entry with one.
 */
export function typeFieldFor(url: string, config: Pick<PrimaryConfig, "sourceTiers">): string | null {
  const plan = typePlanFor(url, config);
  if (plan.branch !== "record" && plan.branch !== "publisher") return null;
  for (const entry of plan.entries) if (entry.type_field !== null) return entry.type_field;
  return null;
}

/** Why the type check fails. */
export type TypeFailure =
  /** The evidence shows no type for the page (a typed publisher's page, or a PubMed or PMC record). */
  | "no_types"
  /** A typed publisher's page has types, and none fits the kind. */
  | "type_no_fit"
  /** A PubMed or PMC record has a type in `refused_pubtypes`. */
  | "refused_pubtype"
  /** A doi.org URL whose landing the evidence lacks. */
  | "no_landing"
  /** A doi.org URL whose landing is another doi.org URL. */
  | "landing_is_doi"
  /** A doi.org URL whose landing fails the URL test for the kind. */
  | "landing_not_primary";

/**
 * The result of the type check. `pass`: the types fit, or no check applies (`branch` `none`). `skipped`: a check applies and the run has
 * no evidence file (PRIMARY_ONLY then warns, §4.11, and the URL test still judges the URL). `fail`: `reason`, a `message` that says how to fix it, the types the
 * evidence showed for the page judged (for a DOI, those under the DOI and under its landing; [] when it failed before they were read)
 * and the landing URL (a DOI's, when the evidence holds it; else null).
 */
export type TypeCheck =
  | { status: "pass"; branch: TypeBranch }
  | { status: "skipped"; branch: Exclude<TypeBranch, "none"> }
  | { status: "fail"; branch: Exclude<TypeBranch, "none">; reason: TypeFailure; message: string; types: string[]; landing: string | null };

// Both lookups below take https URLs only (a plan other than `none` needs one), so a key always starts with https:// and never
// names a property that every object has, such as `constructor`.

/** The types the evidence shows for each URL (`types`, keyed by `normalizeUrl()`: the pack's, then the snapshot's, §4.11), each once. */
function shownTypes(evidence: Evidence, ...urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) for (const type of evidence.types[normalizeUrl(u)] ?? []) if (!out.includes(type)) out.push(type);
  return out;
}

/** The final URL of a URL's GET in the evidence (`resolved`, keyed by `normalizeUrl()`); null when there is none. */
const landingOf = (evidence: Evidence, url: string): string | null => evidence.resolved[normalizeUrl(url)] ?? null;

/** The kinds that at least one of the typed publishers lists one of `types` for. */
function kindsFitted(types: readonly string[], publishers: readonly Publisher[]): SourceKind[] {
  const shown = new Set(types.map(fold));
  return SOURCE_KINDS.filter((k) => publishers.some((p) => (p.types[k] ?? []).some((type) => shown.has(fold(type)))));
}

const quoted = (types: readonly string[]): string => types.map((type) => `"${type}"`).join(", ");

/** Judges a page's types by its plan (never `doi`); null when they fit. */
function judge(
  plan: Exclude<TypePlan, { branch: "doi" }>,
  kind: SourceKind,
  types: readonly string[],
  config: Pick<PrimaryConfig, "sourceTiers">,
): { reason: TypeFailure; message: string } | null {
  switch (plan.branch) {
    case "none":
      return null;
    case "record": {
      if (types.length === 0) {
        return {
          reason: "no_types",
          message: "The run shows no publication type for this record, so it cannot be told from a news item or a comment. Cite another primary record of the work, or leave it out.",
        };
      }
      const refusedType = refusedPubtype(types, config);
      if (refusedType === null) return null;
      return {
        reason: "refused_pubtype",
        message: `This record is typed "${refusedType}". News, editorials, comments and interviews are never sources. Cite the paper or the primary record it discusses.`,
      };
    }
    case "publisher": {
      if (types.length === 0) {
        return {
          reason: "no_types",
          message: "The run found no article type on this page, so it cannot be told from a news item. Cite another primary record of the work, such as its preprint or its PubMed record, or leave it out.",
        };
      }
      const fitted = kindsFitted(types, plan.entries);
      if (fitted.includes(kind)) return null;
      return {
        reason: "type_no_fit",
        message:
          fitted.length > 0
            ? `This page is typed ${quoted(types)}, which fits ${orList(fitted)}, not "${kind}". Give the source ${fitted.length === 1 ? "that kind" : "one of those kinds"}, or cite a page of the right type.`
            : `This page is typed ${quoted(types)}, which is no primary kind: news, editorial, feature and interview pages never are. Cite the paper's own page instead.`,
      };
    }
  }
}

/** A doi.org URL: passes only through a landing in the evidence that passes the URL test and the type check for the kind. */
function checkLanding(url: string, kind: SourceKind, evidence: Evidence, config: PrimaryConfig): TypeCheck {
  const fail = (reason: TypeFailure, message: string, types: string[], landing: string | null): TypeCheck => ({
    status: "fail",
    branch: "doi",
    reason,
    message,
    types,
    landing,
  });
  const landing = landingOf(evidence, url);
  if (landing === null) {
    return fail("no_landing", "The run has not seen where this DOI lands, so the type of its page is unknown. Cite the paper's own page after opening it, or leave it out.", [], null);
  }
  const plan = typePlanFor(landing, config);
  if (plan.branch === "doi") return fail("landing_is_doi", "This DOI lands on another DOI address, not on a publisher's page. Cite the paper's own page.", [], landing);
  const problem = primaryProblem(landing, kind, config);
  if (problem !== null) {
    return fail("landing_not_primary", `This DOI lands on a page that is not a primary source for kind "${kind}". ${problem.message}`, [], landing);
  }
  const types = shownTypes(evidence, url, landing);
  const bad = judge(plan, kind, types, config);
  return bad === null ? { status: "pass", branch: "doi" } : fail(bad.reason, `This DOI lands on a page that fails the type check. ${bad.message}`, types, landing);
}

/**
 * `articleTypeFits(url, kind, evidence)` (§4.11, "The type check"): PRIMARY_ONLY's second test, in draft mode only. With no evidence
 * file a check that applies is `skipped`; one that does not apply passes. A URL on a publisher whose `type_field` is set passes when a
 * type the evidence shows for it is in that publisher's `types` for `kind` (compared without case), and fails when the evidence shows
 * none. A doi.org URL passes only when the evidence holds its landing URL (`resolved`, even when the landing answered an error) and
 * the landing passes the URL test and this check for `kind`, on the types of the DOI's snapshot (read under the DOI's key and the
 * landing's). A PubMed or PMC URL passes only when the evidence shows its types and none is in `refused_pubtypes`. Every other URL is
 * judged by the URL test alone, which is `isPrimary()`'s: this function judges the type only.
 */
export function articleTypeFits(url: string, kind: SourceKind, evidence: Evidence | null, config: PrimaryConfig): TypeCheck {
  const plan = typePlanFor(url, config);
  if (plan.branch === "none") return { status: "pass", branch: "none" };
  if (evidence === null) return { status: "skipped", branch: plan.branch };
  if (plan.branch === "doi") return checkLanding(url, kind, evidence, config);
  const types = shownTypes(evidence, url);
  const bad = judge(plan, kind, types, config);
  return bad === null ? { status: "pass", branch: plan.branch } : { status: "fail", branch: plan.branch, ...bad, types, landing: null };
}
