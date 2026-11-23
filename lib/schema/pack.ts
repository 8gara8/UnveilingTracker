// The daily source pack, `packs/D.json` (SPEC §4.14), which collect writes at stage 2 (§8.3) and the context and the
// rules read, and the rung watch's state file, `cache/rung-watch.json` (SPEC §5.8, which names this file as its home).
//
// A pack holds the ranked candidates (`Candidate`) and the state of every feed (`PackFeed`). It holds no rung-watch
// proposal and no report: stage 4 makes and updates those after collect, and the agent reads them in its context's
// `rung_proposals` and `reports` (§4.14, §4.15). Every string from outside the project has been through `sanitize()`
// (lib/sanitize.ts) before it lands here; the `<untrusted>` wrapper is added where the pack is shown to the agent (the
// Markdown, and the context's candidates), so a string here is plain text and its caps are the sanitised text's.
//
// Shape only, as common.ts explains: how many candidates a pack keeps (`candidates_max`, `deep_read_max`) and how many of
// a field are config values (§4.11), not facts of the schema; whether a feed is stale or failed, and so whether the pack
// is `degraded`, is collect's call (§4.13). The collect-side files of §8.3 (`cache/feeds/index.json`, the candidate cut
// list `logs/D.candidates.json`) belong to P2 with the code that writes them.
//
// Cyber's lib/schema/pack.ts at the fork commit 3ced1fb, adapted: Cyber's items and records (news and agency headlines,
// and structured records of its own domain) give way to this project's candidates, listed field by field in §4.14;
// `PackFeed` is Cyber's with `kind` from the registry's four kinds and `newest` a `PublishedAt`; `injection_flags` and
// the `injection_like` flag are Cyber's; `data_cutoff_utc` is dropped (the Pace has its own cutoff, §5.2) and
// `arxiv_announcement` is new (§4.14); `TimeWindow` is Cyber's from its common.ts, with the check that the window has a
// length; `RungWatchFile` is new.

import { z } from "zod";
import {
  ConfigId, Count, Doi, FieldId, FindingId, HttpsUrl, ID_PATTERNS, IsoDate, IsoTimestamp, PublishedAt, Sha256,
} from "./common";
import { FeedKind } from "./registry";

/** A window of time: the pack's, `[at(D, window_end) - window_hours, at(D, window_end)]` (SPEC §8.3). */
export const TimeWindow = z.strictObject({ start: IsoTimestamp, end: IsoTimestamp })
  .superRefine((w, ctx) => {
    // Only two real timestamps are compared: a malformed one has its own issue, and Date.parse rolls an unreal date over.
    if (!IsoTimestamp.safeParse(w.start).success || !IsoTimestamp.safeParse(w.end).success) return;
    if (Date.parse(w.start) >= Date.parse(w.end)) {
      ctx.addIssue({ code: "custom", message: "The window ends after it starts", path: ["end"] });
    }
  });

/** What `injectionLike()` (lib/sanitize.ts) found in a candidate's text: it reads like an instruction to the agent. */
export const PackFlag = z.enum(["injection_like"]);

/** One feed's outcome in the morning's collect (Cyber's shape; the registry's id and kind). */
export const PackFeed = z.strictObject({
  id: ConfigId,
  kind: FeedKind,
  ok: z.boolean(),
  stale: z.boolean(),
  newest: PublishedAt.describe("The newest item's date as the feed gave it, or null when no item has a readable date"),
  items_total: Count,
  items_kept: Count,
  error: z.string().min(1).nullable().describe("A fixed template, never raw error text"),
  sha256: Sha256.nullable().describe("Of the body read, or null when none was"),
});

/**
 * One ranked candidate (SPEC §4.14, §5.9). The key order is §4.14's, with `flags` before `score` as Cyber's format has
 * it (§4.14 does not list it). Strings are sanitised; `trial` holds the NCT numbers in the title and abstract.
 */
export const Candidate = z.strictObject({
  id: z.string().regex(/^cand-\d{2,}$/, { error: 'Expected a candidate id like "cand-01"' }),
  source_id: ConfigId.describe("The registry feed it came from"),
  title: z.string().min(1).describe("Sanitised, in the original language"),
  abstract: z.string().max(1000).describe("Sanitised, at most 1,000 characters; empty when the feed gives none"),
  url: HttpsUrl.describe("The record's own https link"),
  doi: Doi.nullable(),
  arxiv: z.string().regex(ID_PATTERNS.arxiv, { error: "Expected an arXiv id like 2501.01234" }).nullable(),
  trial: z.array(z.string().regex(ID_PATTERNS.trial, { error: "Expected an NCT number like NCT01234567" }))
    .describe("The NCT numbers in its title and abstract"),
  published_at: z.union([IsoTimestamp, IsoDate]).describe("An arXiv candidate's is the time of its announcement (§4.14)"),
  journal: z.string().min(1).nullable(),
  fields: z.array(FieldId).min(1, { error: "A candidate has at least one field" })
    .refine((a) => new Set(a).size === a.length, { error: "fields must not repeat" })
    .describe("By §8.3's field mapping"),
  ai_terms_matched: z.array(z.string().min(1)).describe("The phrases of config/ai-terms.json found in its title and abstract"),
  journal_leading: z.boolean().describe("Its journal is one of the leading journals of config/journals.json"),
  types: z.array(z.string().min(1)).describe("The article types its feed gives (§4.11); [] for a feed that gives none"),
  stored_finding: FindingId.nullable().describe("An existing finding it matches by DOI, arXiv id or trial number, for returning facts"),
  flags: z.array(PackFlag),
  score: z.number().describe("§5.9's score"),
  deep_read: z.boolean().describe("Among the ones to read closely"),
});

/** `packs/D.json` (gitignored). */
export const Pack = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate.describe("Taipei edition date"),
  window: TimeWindow.describe("The pack window: [at(D, window_end) - window_hours, at(D, window_end)]"),
  generated_at: IsoTimestamp,
  arxiv_announcement: IsoTimestamp.nullable()
    .describe("The time of the arXiv announcement in the window, or null when there is none or the arxiv feeds that answered found no entry"),
  degraded: z.boolean(),
  feeds: z.array(PackFeed),
  candidates: z.array(Candidate).describe("Ranked by score, best first"),
  injection_flags: Count.describe("How many candidates carry a flag"),
});

/**
 * `cache/rung-watch.json` (SPEC §5.8): the date of each followed finding's last complete check, in id order. A finding
 * not in it counts as never checked, and a missing file or one that fails this schema counts every finding so, which only
 * restarts the rotation. Only the `recheck` stage of a morning run writes it.
 */
export const RungWatchFile = z.strictObject({
  schema_version: z.literal(1),
  checked: z.record(FindingId, IsoDate),
}).superRefine((f, ctx) => {
  const ids = Object.keys(f.checked);
  ids.forEach((id, i) => {
    if (i > 0 && id <= ids[i - 1]!) {
      ctx.addIssue({ code: "custom", message: "checked is in id order, with no id twice", path: ["checked", id] });
    }
  });
});

export type TimeWindow = z.infer<typeof TimeWindow>;
export type PackFlag = z.infer<typeof PackFlag>;
export type PackFeed = z.infer<typeof PackFeed>;
export type Candidate = z.infer<typeof Candidate>;
export type Pack = z.infer<typeof Pack>;
export type RungWatchFile = z.infer<typeof RungWatchFile>;
