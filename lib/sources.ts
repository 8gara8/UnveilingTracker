// Source kinds and publishers (SPEC §3 `lib/sources.ts`): what a cited source's `kind` and `publisher` mean
// beside the vocabulary of lib/vocab.ts. §4.12's GO_DEEPER rule says which kinds a finding may point a reader
// to, §7's Go deeper line prints a source's kind and publisher, and §5.8's script-added sources take their
// `title` and `publisher` from a Crossref record through the sanitiser. Pure.
// Not here: the allowlist itself (which `config/source-tiers.json`, `labs.json` or `checkers.json` entry lists a
// URL, `isPrimary()` and `articleTypeFits()`, §4.11) is lib/primary.ts's, and the kinds a rung's entry may cite
// (§4.12 RUNG_EVIDENCE) are lib/rungs.ts's.
// Cyber's lib/sources.ts at the fork commit 3ced1fb, adapted: its tier and publisher lookup (`publisherFor()`,
// the tiers and state labels, the github.com paths, `blockedReason()`, `urlOnDomain()`) is dropped. This
// project has no tiers, a source's publisher is written by the agent or taken from a Crossref record rather
// than looked up from its URL, and its URL tests are lib/primary.ts's and `blockedEntry()` in lib/urls.ts.

import type { Lang } from "./i18n";
import { sanitize } from "./sanitize";
import { SOURCE_KIND_INFO, type FindingKind, type SourceKind } from "./vocab";

/** The kinds of source a finding's `go_deeper` ids may have (§4.12 GO_DEEPER), in the rule's order. */
export const GO_DEEPER_KINDS: readonly SourceKind[] = ["paper", "preprint", "proof", "dataset", "registry", "checker", "statement", "lab_post"];

/** A setback's `go_deeper` may also point to a notice: the retraction, correction or concern it reports (§4.12 GO_DEEPER). */
export const SETBACK_GO_DEEPER_KINDS: readonly SourceKind[] = [...GO_DEEPER_KINDS, "notice"];

/** The kinds a finding of this kind may cite in `go_deeper` (§4.12 GO_DEEPER). */
export function goDeeperKinds(kind: FindingKind): readonly SourceKind[] {
  return kind === "setback" ? SETBACK_GO_DEEPER_KINDS : GO_DEEPER_KINDS;
}

/** A source's `title` holds at most this many characters (§4.3; lib/schema/common.ts' `Source` holds the same bound). */
export const SOURCE_TITLE_MAX = 200;

/** A source's `publisher` holds at most this many characters (§4.3; lib/schema/common.ts' `Source` holds the same bound). */
export const SOURCE_PUBLISHER_MAX = 80;

/**
 * A source's `title` from text that came from outside, such as a Crossref record's first `title` entry
 * (§5.8): through `sanitize()` and cut to SOURCE_TITLE_MAX, with a cut ending in "…".
 */
export function sourceTitle(raw: string): string {
  return sanitize(raw, { max: SOURCE_TITLE_MAX });
}

/**
 * A source's `publisher` from text that came from outside, such as a Crossref record's first
 * `container-title` or its `publisher` (§5.8): through `sanitize()` and cut to SOURCE_PUBLISHER_MAX, then each
 * dash (`\p{Pd}`: the en and em dashes, the wave dash, the full-width hyphen-minus and the rest) made a
 * hyphen-minus, since a journal's name can hold an en dash that the notes which print it may not carry
 * (NO_EM_DASH, ZH_NO_DASH, §4.12).
 */
export function sourcePublisher(raw: string): string {
  return sanitize(raw, { max: SOURCE_PUBLISHER_MAX }).replace(/\p{Pd}/gu, "-");
}

/**
 * A source as Go deeper prints it (§7): its kind's label and its publisher, "Paper, Nature" or "Proof, Lean
 * mathlib", in the page's language (a Chinese page reads 「論文，Nature」), the publisher as it was written.
 */
export function sourceLine(kind: SourceKind, publisher: string, lang: Lang): string {
  const label = SOURCE_KIND_INFO[kind][lang];
  return lang === "zh" ? `${label}，${publisher}` : `${label}, ${publisher}`;
}
