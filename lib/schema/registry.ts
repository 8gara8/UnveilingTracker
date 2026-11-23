// The source registry, `config/sources.yaml` (SPEC §4.13). Every key is written out on every feed, never optional
// (§4.1): a feed with no fallback has `fallback_url: null`, one with no dated items `fresh_days: null`, one whose times
// carry their own zone `date_zone: null`. The registry holds no tiers: a URL's tier, publisher and kind come from
// `isPrimary()` and config/source-tiers.json. The counts and the coverage the registry must reach (every field has a
// feed, the files exist) are tests/config.test.ts's requirements, not schema facts.
//
// Cyber's lib/schema/registry.ts at the fork commit 3ced1fb, adapted as §4.13 says: Cyber's `language`, `region` and
// `coverage` are dropped; `kind` is `api`, `rss`, `page` or `file`; `fields`, `parser` and `budget` are added, in that
// order after `date_zone`; the file has `arxiv_skipped` between `schema_version` and `feeds` and no `keywords`; the
// search entries and the per-kind feed parsers are not this project's. The https and offset formats are Cyber's.

import { z } from "zod";
import { Count, ConfigId, FieldId, HttpsUrl, IsoDate, uniqueArray } from "./common";

/** How a feed is reached (SPEC §4.13). */
export const FEED_KINDS = ["api", "rss", "page", "file"] as const;
/** How collect reads it; `none` is never read by collect (the Chinese pass's own host). */
export const FEED_PARSERS = ["atom", "json", "rss", "html", "csv", "none"] as const;

export const FeedKind = z.enum(FEED_KINDS);
export const FeedParser = z.enum(FEED_PARSERS);

/** A UTC offset as "+08:00" or "-05:00" (never "Z": null stands for UTC). */
const UtcOffset = z.string().regex(/^[+-](?:0\d|1[0-4]):[0-5]\d$/, "Expected an offset like +08:00");

export const FeedEntry = z.strictObject({
  id: ConfigId,
  name: z.string().min(1),
  kind: FeedKind,
  url: HttpsUrl,
  fallback_url: HttpsUrl.nullable().describe("Read when url fails, or null"),
  priority: z.literal([1, 2, 3]).describe("1: the morning needs it; 2: wanted; 3: counters and extras"),
  fresh_days: z.int().min(1).nullable().describe("The newest item must be younger; null for a feed with no dated items to judge"),
  must_match: z.boolean().describe("true keeps only items whose title or abstract matches config/ai-terms.json"),
  date_zone: UtcOffset.nullable().describe("The zone of the feed's zone-less dates when its channel gives no offset; null reads them as UTC"),
  fields: uniqueArray(FieldId, "fields").describe("The fields its items belong to; [] when each item is mapped on its own"),
  parser: FeedParser,
  budget: Count.describe("The most requests the feed may make in one morning"),
});

/** config/sources.yaml. `arxiv_skipped` lists the US dates of the arXiv announcements that arXiv skips for holidays (SPEC §4.13). */
export const SourcesFile = z.strictObject({
  schema_version: z.literal(1),
  arxiv_skipped: uniqueArray(IsoDate, "arxiv_skipped"),
  feeds: z.array(FeedEntry),
}).superRefine((r, ctx) => {
  r.feeds.forEach((f, i) => {
    if (r.feeds.findIndex((o) => o.id === f.id) !== i) {
      ctx.addIssue({ code: "custom", message: `Feed id ${f.id} is used twice`, path: ["feeds", i, "id"] });
    }
  });
});

export type FeedKind = z.infer<typeof FeedKind>;
export type FeedParser = z.infer<typeof FeedParser>;
export type FeedEntry = z.infer<typeof FeedEntry>;
export type SourcesFile = z.infer<typeof SourcesFile>;
