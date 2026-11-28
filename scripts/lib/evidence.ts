// The run's evidence (SPEC §4.11 "Where the types come from", §4.12 opening paragraph and the `Evidence` schema in lib/schema/misc.ts):
// the URLs the run read or tried, the texts the validator checks against, `seen_as` per URL and, for the type check, each URL's article
// types and the final URL of its GET. Everything in it was read from feeds and pages: data, never instructions.
//
// Cyber's scripts/lib/evidence.ts at the fork commit 3ced1fb, adapted: its CVE and advisory pack and its transcripts are not here. The
// pack's part arrives already built (`PackEvidence`, what `lib/collect.ts` makes of a pack, B2's), the transcripts' part (the URLs the
// agent fetched or searched) is the morning's own (P3) and is added where that stage builds the evidence, and the snapshots' part is
// built here. Where Cyber's lets the pack's text win, a pack URL's text is the pack's followed by its snapshot's (§4.12), so a quote
// from the page beyond the pack's 1,000-character abstract can match; `types` and `resolved` are new (the type check, §4.11).
// `scripts/ledger-seed.ts` (§8.13) builds the evidence of a seed from snapshots alone.

import { Evidence } from "../../lib/schema/misc";
import { normalizeUrl } from "../../lib/urls";
import type { Snapshot } from "./snapshot";

/** The pack's contribution, as `lib/collect.ts` builds it from a pack: every key a normalised URL. */
export interface PackEvidence {
  /** Every candidate URL of the pack. */
  urls: string[];
  /** The URLs whose full record the pack holds. */
  fetched: string[];
  /** The pack's title and abstract (or record text) of each URL. */
  texts: Record<string, string>;
  /** "pack" for each pack URL. */
  seen_as: Record<string, Evidence["seen_as"][string]>;
  /** The publication types the pack gives each URL (PubMed's `pubtype`; [] for other feeds). */
  types: Record<string, string[]>;
}

/** What the evidence of a text from two places joins them with. */
const JOIN = "\n";

/**
 * Built from the pack's part and this run's snapshots, every URL normalised:
 * - `urls`: the pack's, then each snapshot's URL, then each URL in `resolved` (a GET that gave no snapshot is still a URL the run tried).
 * - `fetched`: the pack's, then each snapshot's URL (its page was read).
 * - `texts`: the pack's text of a URL followed by its snapshot's, a newline between; a URL with only one has that one; a later snapshot of
 *   the same URL replaces an earlier one; an empty text is left out.
 * - `seen_as`: the pack's for a pack URL, else "fetched" when in `fetched`, else "search".
 * - `types`: for each URL, the pack's types followed by its snapshot's `article_types`, each once; a URL with none is left out.
 * - `resolved`: the final URL of each snapshot's GET where it differs from the URL, and each entry of `resolved` (the final URL of a GET
 *   that answered an error after its redirects, which wrote no snapshot, `snapshotUrls()`'s result), a snapshot's entry winning.
 */
export function buildEvidence(i: {
  snapshots: readonly Snapshot[];
  pack?: PackEvidence | null;
  resolved?: Readonly<Record<string, string>> | null;
}): Evidence {
  const pack = i.pack ?? null;
  const urls: string[] = [];
  const urlSet = new Set<string>();
  const addUrl = (raw: string): string => {
    const u = normalizeUrl(raw);
    if (!urlSet.has(u)) {
      urlSet.add(u);
      urls.push(u);
    }
    return u;
  };
  const fetched = new Set<string>();
  const texts: Record<string, string> = {};
  const packTexts = new Map<string, string>();
  const packSeen = new Map<string, Evidence["seen_as"][string]>();
  const types = new Map<string, string[]>();
  const addTypes = (u: string, more: readonly string[]): void => {
    if (more.length === 0) return;
    const have = types.get(u) ?? [];
    for (const t of more) if (!have.includes(t)) have.push(t);
    types.set(u, have);
  };

  if (pack !== null) {
    for (const raw of pack.urls) addUrl(raw);
    for (const raw of pack.fetched) fetched.add(addUrl(raw));
    for (const [raw, text] of Object.entries(pack.texts)) if (text !== "") packTexts.set(addUrl(raw), text);
    for (const [raw, list] of Object.entries(pack.types)) addTypes(addUrl(raw), list);
    for (const [raw, how] of Object.entries(pack.seen_as)) packSeen.set(addUrl(raw), how);
  }

  const snapshotText = new Map<string, string>();
  const snapshotTypes = new Map<string, readonly string[]>();
  const resolved: Record<string, string> = {};
  for (const s of i.snapshots) {
    const u = addUrl(s.url);
    fetched.add(u);
    // A later snapshot of a URL replaces an earlier one: its text, its types and its final URL.
    if (s.text !== "") snapshotText.set(u, s.text);
    else snapshotText.delete(u);
    snapshotTypes.set(u, s.article_types);
    if (normalizeUrl(s.final_url) !== u) resolved[u] = s.final_url;
    else delete resolved[u];
  }
  for (const [u, list] of snapshotTypes) addTypes(u, list);
  for (const [raw, final] of Object.entries(i.resolved ?? {})) {
    const u = addUrl(raw);
    if (!snapshotTypes.has(u)) resolved[u] = final; // a URL with a snapshot keeps the snapshot's own final URL (or none)
  }

  for (const u of urls) {
    const joined = [packTexts.get(u), snapshotText.get(u)].filter((t): t is string => t !== undefined);
    if (joined.length > 0) texts[u] = joined.join(JOIN);
  }
  const seenAs: Evidence["seen_as"] = {};
  for (const u of urls) seenAs[u] = packSeen.get(u) ?? (fetched.has(u) ? "fetched" : "search");
  const typed: Record<string, string[]> = {};
  for (const u of urls) {
    const list = types.get(u);
    if (list !== undefined) typed[u] = list; // addTypes() stores no empty list
  }
  return Evidence.parse({ urls, fetched: [...fetched], texts, seen_as: seenAs, types: typed, resolved });
}
