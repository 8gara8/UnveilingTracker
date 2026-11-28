// Sources (SPEC §4.12): PRIMARY_ONLY, SOURCE_SEEN, SOURCE_URL, GO_DEEPER and FIGURE_LICENCE. Each rule reads the sources the views
// list, a finding's own (`s1`...) and the brief's (`b1`...), in a draft and in a stored record alike (shared.ts
// `sourceContainers()`); a stored finding that a draft only names is not judged, and a URL or quote that a stored `removed`
// correction rewrote is skipped (SPEC §4.12 "Removed text"). PRIMARY_ONLY, SOURCE_SEEN and SOURCE_URL also judge the `source_url` of
// each correction the views list (a draft's own, or every stored one), which the correction banner shows as the source that shows
// the correction is right: a `null` one names no page and is never an issue, and a correction is judged as a source is, with no kind.
//
//   PRIMARY_ONLY    draft + published   the URL test (`primaryProblem()`, §4.11) on the sources being published (a returning finding's new ones only), since it reads `config/`; in draft mode also the
//                                       type check (`articleTypeFits()`), which reads the evidence: the rule `uses` it, so the engine says when it ran without.
//                                       A correction's `source_url` names no kind, so it passes when it does for some kind (`primaryKindsFor()`)
//   SOURCE_SEEN     draft               each source URL and each correction's `source_url` is in the run's evidence (pack, search result or fetch); the engine
//                                       skips it with no evidence
//   SOURCE_URL      draft + published   https, no user info, no redirect or archive entry of BLOCKED_HOSTS, unique in its list (a correction's `source_url`
//                                       is judged on the first three; two corrections may cite one page); every record, and the engine
//                                       makes its errors warnings on a stored record that is not being published (ARCHIVE_WARNING_CODES)
//   GO_DEEPER       draft + published   1 to 3 ids, each a source of a kind Go deeper takes (a setback's may be a notice); every record
//   FIGURE_LICENCE  draft + published   the host in `figure_hosts` on a finding judged whole, the `licence_quote` naming its licence on every record;
//                                       publish's HEAD of `image_url` is publish's (P3): no rule reads the network
//
// A URL that SOURCE_URL fails, or that any BLOCKED_HOSTS entry matches (BLOCKED_HOST's), is skipped by PRIMARY_ONLY, SOURCE_SEEN and
// FIGURE_LICENCE's host test, so one problem gets one code (SPEC §4.12 BLOCKED_HOST); a source's `url` and a correction's `source_url`
// are alike in this (a redirect or archive entry is SOURCE_URL's on both, every other entry BLOCKED_HOST's). A duplicate is not such a
// failure: it is the second source's own problem, and each source's URL is still judged. Nothing is read from a file, the clock or the network. A message
// that quotes an address, a landing or a licence quote prints its first 120 characters at most, since the schema puts no limit on a URL.
//
// Cyber's lib/rules/sources.ts at the fork commit 3ced1fb, adapted: `sourceUrlProblem()` is Cyber's (its redirect and archive
// entries, user info and https checks, with the same messages), SOURCE_URL adds Cyber's SOURCE_DUP (the uniqueness test, on
// `normalizeUrl()`, within one list), and SOURCE_SEEN is Cyber's SOURCE_UNSEEN on the evidence set. PRIMARY_ONLY, GO_DEEPER and
// FIGURE_LICENCE are new: Cyber's tier tests have no counterpart, and the allowlist is lib/primary.ts's.

import { FIGURE_LICENCES, type FindingKind } from "../schema/common";
import type { SourceKind } from "../vocab";
import { articleTypeFits, primaryKindsFor, primaryProblem } from "../primary";
import { goDeeperKinds } from "../sources";
import { blockedEntry, hostOf, isHttpsUrl, normalizeUrl } from "../urls";
import { extendPath, inEvidence, isDraft, resolveSource, shown, sourceContainers, type SourceContainer } from "./shared";
import { defineRule, error, list, type Rule, type RuleInput, type ValidationIssue } from "./types";
import type { CorrectionView, SourceView } from "./views";

// ── The sources the rules judge ──────────────────────────────────────────────────────────────────

/** One source a rule judges, with the list it is in and the issue path of its URL. */
interface Cited {
  readonly source: SourceView;
  readonly container: SourceContainer;
  readonly path: string;
}

/**
 * Every source of every list the run judges, in the views' order, each with the path of its `url`. With `onlyPublishing` the
 * sources being published alone: a draft's, and in published mode those of the brief being published, of a finding first briefed on
 * the date being published and the ones the date added to a returning finding (the tests that read `config/`, SPEC §4.12 "Stored
 * records"). A source whose `url` a stored `removed` correction rewrote is left out.
 */
function citedSources(input: RuleInput, onlyPublishing = false): Cited[] {
  const out: Cited[] = [];
  for (const container of sourceContainers(input.views)) {
    if (container.sources === null) continue;
    const removed = container.owner === null ? input.views.brief.removed : container.owner.removed;
    for (const source of container.sources) {
      if ((onlyPublishing && !source.publishing) || removed.has(`sources.${source.index}.url`)) continue;
      out.push({ source, container, path: extendPath(source.where, "url") });
    }
  }
  return out;
}

/** One correction's `source_url` a rule judges, with the issue path of it. */
interface CitedCorrection {
  readonly correction: CorrectionView;
  readonly url: string;
  readonly path: string;
}

/**
 * The `source_url` of every correction the run judges, in the views' order: the draft's own corrections, or in published mode every
 * stored one (the views' `corrections`), each with the path of its `source_url`. A `null` one names no page and is left out. With
 * `onlyPublishing` the corrections being published alone (a draft's own, and the stored ones the run is publishing: the tests that
 * read `config/`, SPEC §4.12 "Stored records"). No stored `removed` correction rewrites a correction's `source_url`, so none is skipped.
 */
function citedCorrections(input: RuleInput, onlyPublishing = false): CitedCorrection[] {
  const out: CitedCorrection[] = [];
  for (const correction of input.views.corrections) {
    if (correction.source_url === null || (onlyPublishing && !correction.publishing)) continue;
    out.push({ correction, url: correction.source_url, path: extendPath(correction.where, "source_url") });
  }
  return out;
}

/** What a message calls a correction: its id once it is stored (`C-0001`), else its place in the draft (`corrections[0]`). */
const labelOf = (correction: CorrectionView): string => correction.id ?? `corrections[${correction.index}]`;

// ── SOURCE_URL ───────────────────────────────────────────────────────────────────────────────────

/** True when a URL parses with a user name or password (`https://name:pass@host/`), which can hide the real host. */
function hasUserInfo(url: string): boolean {
  try {
    const u = new URL(url);
    return u.username !== "" || u.password !== "";
  } catch {
    return false;
  }
}

/**
 * SOURCE_URL's finding for a URL, or null: on a BLOCKED_HOSTS entry of reason `redirect` or `archive` (read on the URL as written,
 * since `normalizeUrl()` would strip a Wayback prefix), carrying user info (`name:pass@`), not https or not a whole address.
 * Every other BLOCKED_HOSTS entry is BLOCKED_HOST's. The text continues "<id>'s URL ...". "A whole https address" is what `isHttpsUrl()`
 * (Cyber's, lib/urls.ts) reads: `new URL()` with a dotted host, so spaces around an address, tabs and line breaks inside it, a missing
 * `//` or backslashes still name the page that `normalizeUrl()` compares them as; the spec asks no more of an address than that.
 */
export function sourceUrlProblem(url: string): string | null {
  const entry = blockedEntry(url);
  if (entry?.reason === "redirect") return `is a redirect link (${entry.pattern}); open the original page and cite its own URL`;
  if (entry?.reason === "archive") return `is an archive copy (${hostOf(url) ?? entry.pattern}); cite the original page`;
  if (hasUserInfo(url)) return "carries a user name or password before the host (user:password@); cite the plain https address of the page";
  if (isHttpsUrl(url)) return null;
  if (/^http:\/\//i.test(url) && isHttpsUrl(url.replace(/^http:/i, "https:"))) return "uses http; cite the https address of the same page";
  return "is not a valid absolute https URL; copy the page's full address";
}

/** True when SOURCE_URL or BLOCKED_HOST judges the URL, so the other tests of a source's URL leave it out (one code per problem). */
const judgedElsewhere = (url: string): boolean => sourceUrlProblem(url) !== null || blockedEntry(url) !== null;

/**
 * SOURCE_URL: each source URL is an https address with no user info that is no redirect or archive link, and no list cites one page twice;
 * a correction's `source_url` is judged on the first three (two corrections may cite the page that shows both are right).
 */
const sourceUrl = defineRule({
  code: "SOURCE_URL",
  scope: ["draft", "published"],
  check: (input) => {
    const out: ValidationIssue[] = [];
    const firstOf = new Map<SourceContainer, Map<string, SourceView>>();
    for (const { source, container, path } of citedSources(input)) {
      const problem = sourceUrlProblem(source.url);
      if (problem !== null) out.push(error("SOURCE_URL", path, `${source.id}'s URL ${problem}. Found: ${shown(source.url)}`));
      const seen = firstOf.get(container) ?? new Map<string, SourceView>();
      firstOf.set(container, seen);
      const key = normalizeUrl(source.url);
      const earlier = seen.get(key);
      if (earlier === undefined) {
        seen.set(key, source);
      } else {
        out.push(error("SOURCE_URL", path,
          `${source.id} has the same URL as ${earlier.id} (${shown(key)}). Cite ${earlier.id} wherever ${source.id} is cited, remove ${source.id} and renumber the later ids.`));
      }
    }
    for (const { correction, url, path } of citedCorrections(input)) {
      const problem = sourceUrlProblem(url);
      if (problem !== null) out.push(error("SOURCE_URL", path, `${labelOf(correction)}'s source URL ${problem}. Found: ${shown(url)}`));
    }
    return out;
  },
});

// ── PRIMARY_ONLY ─────────────────────────────────────────────────────────────────────────────────

const PRIMARY_HINT = "Cite a page that the allowlist in your context lists for the source's kind (a paper's page on its publisher, a preprint server, a registry, the lab's or institution's own site), never press.";

/**
 * PRIMARY_ONLY's finding for one URL, or null: it passes `isPrimary(url, kind)` (§4.11's URL test) and, in draft mode, its article type
 * fits (`articleTypeFits()`, §4.11's type check), once the URL test has passed. A source has a `kind`. A correction's `source_url` has
 * none (`kind` null): it passes the URL test when it does for some kind (`primaryKindsFor()`), and the type check when its type fits
 * some kind that admitted it; a page that no kind admits is refused for the same reason whichever kind is asked, so the message is that
 * of `"paper"`. The type check reads the evidence, so with none it is `skipped`, which is no failure: the engine reports that the rule
 * ran without it (`uses`).
 */
function primaryIssue(url: string, kind: SourceKind | null, label: string, path: string, input: RuleInput): ValidationIssue | null {
  const evidence = isDraft(input) ? input.draft.evidence : null;
  const kinds = kind === null ? primaryKindsFor(url, input.config) : [kind];
  const problem = kind === null && kinds.length > 0 ? null : primaryProblem(url, kind ?? "paper", input.config);
  if (problem !== null) return error("PRIMARY_ONLY", path, `${label}: ${problem.message}`, PRIMARY_HINT);
  const failures = kinds.flatMap((k) => {
    const check = articleTypeFits(url, k, evidence, input.config);
    return check.status === "fail" ? [check] : [];
  });
  if (failures.length < kinds.length) return null;
  const check = failures[0]!; // `kinds` is never empty here: a source has its kind, and a correction's page passed the URL test for some kind
  const landing = check.landing === null ? "" : ` It lands on ${shown(check.landing)}.`;
  return error("PRIMARY_ONLY", path, `${label}: ${check.message}${landing}`, PRIMARY_HINT);
}

/**
 * PRIMARY_ONLY: each source URL and each correction's `source_url` passes the URL test and, in draft mode, the type check
 * (`primaryIssue()`); both are judged on the records being published, since they read `config/`.
 */
const primaryOnly = defineRule({
  code: "PRIMARY_ONLY",
  scope: ["draft", "published"],
  uses: ["evidence"],
  check: (input) => {
    const out: ValidationIssue[] = [];
    for (const { source, path } of citedSources(input, true)) {
      const found = judgedElsewhere(source.url) ? null : primaryIssue(source.url, source.kind, `${source.id} (kind "${source.kind}")`, path, input);
      if (found !== null) out.push(found);
    }
    for (const { correction, url, path } of citedCorrections(input, true)) {
      const found = judgedElsewhere(url) ? null : primaryIssue(url, null, `${labelOf(correction)} (a correction's source)`, path, input);
      if (found !== null) out.push(found);
    }
    return out;
  },
});

// ── SOURCE_SEEN ──────────────────────────────────────────────────────────────────────────────────

const SEEN_HINT = "Copy the URL exactly as the pack, the fetch or the search result gave it, or open the page first.";

/**
 * SOURCE_SEEN: each source URL and each draft correction's `source_url` was in the pack, a search result or a fetch of this run
 * (`evidence.urls`, by `normalizeUrl()`). The rule runs on a draft alone, so the corrections it reads are the draft's own.
 */
const sourceSeen = defineRule({
  code: "SOURCE_SEEN",
  scope: "draft",
  needs: ["evidence"],
  check: (input) => [
    ...citedSources(input)
      .filter(({ source }) => !judgedElsewhere(source.url) && !inEvidence(input, source.url))
      .map(({ source, path }) => error("SOURCE_SEEN", path,
        `${source.id}'s URL ${shown(source.url)} is not in the source pack, a page you fetched or a search result you saw. Cite only URLs you actually saw, or remove ${source.id}.`,
        SEEN_HINT)),
    ...citedCorrections(input)
      .filter(({ url }) => !judgedElsewhere(url) && !inEvidence(input, url))
      .map(({ correction, url, path }) => error("SOURCE_SEEN", path,
        `${labelOf(correction)}'s source URL ${shown(url)} is not in the source pack, a page you fetched or a search result you saw. Cite only URLs you actually saw, or set source_url to null.`,
        SEEN_HINT)),
  ],
});

// ── GO_DEEPER ────────────────────────────────────────────────────────────────────────────────────

/** The most ids a finding's Go deeper lists (SPEC §4.4: 1 to 3). */
const GO_DEEPER_MAX = 3;

/**
 * GO_DEEPER: a finding lists 1 to 3 ids, each a source of its own list whose kind Go deeper takes (`goDeeperKinds()`: a setback's
 * may also be a notice). The finding's own record, as published, is judged on every record; an id that names no source is SOURCE_IDS's.
 */
const goDeeper = defineRule({
  code: "GO_DEEPER",
  scope: ["draft", "published"],
  check: (input) => {
    const out: ValidationIssue[] = [];
    for (const f of input.views.findings) {
      if (f.basis === "context" || f.go_deeper === null) continue;
      const ids = f.go_deeper;
      if (ids.length < 1 || ids.length > GO_DEEPER_MAX) {
        out.push(error("GO_DEEPER", f.where("go_deeper"),
          ids.length === 0
            ? "Go deeper lists no sources; a finding lists 1 to 3. List the ids of the finding's best sources to read more."
            : `Go deeper lists ${ids.length} ids; a finding lists 1 to 3. Remove ${ids.length - GO_DEEPER_MAX}, keeping the best places to read more.`));
      }
      const allowed = goDeeperKinds(f.published.kind as FindingKind);
      ids.forEach((id, i) => {
        const { source } = resolveSource(input.views, f, id);
        if (source === null || allowed.includes(source.kind)) return;
        const why = source.kind === "notice" ? " A notice is a Go deeper source only for a setback." : "";
        out.push(error("GO_DEEPER", f.where(`go_deeper.${i}`),
          `Go deeper lists ${id}, a source of kind "${source.kind}", which it does not take: it takes ${list(allowed)}.${why} List one of this finding's sources of those kinds instead.`));
      });
    }
    return out;
  },
});

// ── FIGURE_LICENCE ───────────────────────────────────────────────────────────────────────────────

type FigureLicence = (typeof FIGURE_LICENCES)[number];

/**
 * How each licence is named, as patterns over `squash()`ed text: the licence and its version (a figure's licence is the licence of
 * that version, so "Creative Commons Attribution License" alone names none), by its short name, its long name or the path of its
 * address on creativecommons.org. CC BY 4.0, CC BY-SA 4.0 and CC0 are told apart by the words between and after "cc by".
 */
const LICENCE_NAMES: Readonly<Record<FigureLicence, readonly RegExp[]>> = {
  "CC-BY-4.0": [/\bcc by(?: license)? 4\b/, /\bcreative commons attribution(?: license)? 4\b/, /\blicenses by 4\b/],
  "CC-BY-SA-4.0": [/\bcc by sa(?: license)? 4\b/, /\bcreative commons attribution share ?alike(?: license)? 4\b/, /\blicenses by sa 4\b/],
  "CC0-1.0": [/\bcc0\b/, /\bcreative commons zero\b/, /\bzero 1 0\b/],
  "public-domain": [/\bpublic domain\b/],
};

const LICENCE_PATTERNS: ReadonlyMap<string, readonly RegExp[]> = new Map(Object.entries(LICENCE_NAMES));

/** What to quote for each licence, for the message. */
const LICENCE_EXAMPLES: Readonly<Record<FigureLicence, string>> = {
  "CC-BY-4.0": '"CC BY 4.0" or "Creative Commons Attribution 4.0"',
  "CC-BY-SA-4.0": '"CC BY-SA 4.0" or "Creative Commons Attribution-ShareAlike 4.0"',
  "CC0-1.0": '"CC0" or "Creative Commons Zero"',
  "public-domain": '"public domain"',
};

/** Lower case, "licence" spelt "license", and every run of other characters one space, so "CC-BY 4.0" and "cc by 4 0" compare equal. */
const squash = (text: string): string => text.toLowerCase().replace(/licence/g, "license").replace(/[^a-z0-9]+/g, " ");

/** True when `quote` names `licence`, a value of `FIGURE_LICENCES`, with its version; false for any other licence value. */
export function namesLicence(licence: string, quote: string): boolean {
  const text = squash(quote);
  return (LICENCE_PATTERNS.get(licence) ?? []).some((pattern) => pattern.test(text));
}

/**
 * Why a figure's `image_url` is not an address the page may show an image from, or null: it is an https address with no user name or
 * password and no port, on a host that `figure_hosts` lists exactly (the content security policy's `img-src` names each host as
 * written, so a subdomain of a listed host does not load).
 */
function imageUrlProblem(url: string, hosts: ReadonlySet<string>): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "is not a whole address";
  }
  if (u.protocol !== "https:") return "is not an https address";
  if (u.username !== "" || u.password !== "") return "carries a user name or password";
  if (u.port !== "") return "names a port";
  return hosts.has(u.hostname) ? null : `is on ${shown(u.hostname)}, which is not a figure host (${list([...hosts])})`;
}

/**
 * FIGURE_LICENCE: a figure's host is in `figure_hosts` (judged on a finding first briefed on the date being published, never on the
 * figure of a returning finding, whose figure is an archived record, since the test reads `config/`) and its
 * `licence_quote` names its licence (every record). Publish's HEAD of `image_url`, which must answer `image/*`, is publish's (P3).
 */
const figureLicence = defineRule({
  code: "FIGURE_LICENCE",
  scope: ["draft", "published"],
  check: (input) => {
    const out: ValidationIssue[] = [];
    for (const f of input.views.findings) {
      if (f.basis === "context" || f.figure === null) continue;
      const figure = f.figure;
      if (!f.removed.has("figure.licence_quote") && !namesLicence(figure.licence, figure.licence_quote)) {
        out.push(error("FIGURE_LICENCE", extendPath(figure.where, "licence_quote"),
          `The figure's licence_quote does not name its licence ${figure.licence}. Quote the sentence on the source page that names it, such as ${LICENCE_EXAMPLES[figure.licence as FigureLicence] ?? "its name and version"}. Found: "${shown(figure.licence_quote)}"`));
      }
      if (!f.publishing || f.removed.has("figure.image_url") || blockedEntry(figure.image_url) !== null) continue;
      const problem = imageUrlProblem(figure.image_url, input.config.index.figureHosts);
      if (problem !== null) {
        out.push(error("FIGURE_LICENCE", extendPath(figure.where, "image_url"), `The figure's image URL ${problem}. Found: ${shown(figure.image_url)}`,
          "A figure may come only from a host in figure_hosts (config/source-tiers.json), the hosts the site's content security policy lets images load from; otherwise set the figure to null."));
      }
    }
    return out;
  },
});

export const sourcesRules: Rule[] = [primaryOnly, sourceSeen, sourceUrl, goDeeper, figureLicence];
