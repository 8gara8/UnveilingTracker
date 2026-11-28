// lib/schema/registry.ts (SPEC §4.13): one feed of config/sources.yaml and the whole file. Each schema has a valid value
// and a failing one for each constraint; inline data. The last block reads the Foundation's seed files, read only, to
// check that the id formats of lib/schema/common.ts accept what the seed configs hold.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { parse } from "yaml";
import { ConfigId, CounterId, FieldId, SubfieldId } from "@/lib/schema/common";
import { FEED_KINDS, FEED_PARSERS, FeedEntry, FeedKind, FeedParser, SourcesFile } from "@/lib/schema/registry";
import type { FeedEntry as FeedEntryType, SourcesFile as SourcesFileType } from "@/lib/schema/registry";
import { expectIssue, expectMutationFails, expectValid } from "./helpers/zod-issues";

const feed = () => ({
  id: "arxiv-math",
  name: "arXiv API, mathematics (each announcement's new submissions)",
  kind: "api",
  url: "https://export.arxiv.org/api/query",
  fallback_url: null,
  priority: 1,
  fresh_days: 7,
  must_match: true,
  date_zone: null,
  fields: ["mathematics"],
  parser: "atom",
  budget: 2,
});

const file = () => ({
  schema_version: 1,
  arxiv_skipped: ["2026-11-11", "2026-12-25"],
  feeds: [feed(), { ...feed(), id: "biorxiv", name: "bioRxiv", url: "https://api.biorxiv.org/details/biorxiv", parser: "json", fields: ["biology"], budget: 3 }],
});

describe("FeedEntry", () => {
  it("accepts a feed, and keeps the keys in the order of SPEC section 4.13", () => {
    expectValid(FeedEntry, feed());
    expect(Object.keys(FeedEntry.shape)).toEqual([
      "id", "name", "kind", "url", "fallback_url", "priority", "fresh_days", "must_match", "date_zone", "fields", "parser", "budget",
    ]);
    expect(Object.keys(FeedEntry.parse(Object.fromEntries(Object.entries(feed()).reverse())))).toEqual(Object.keys(FeedEntry.shape));
  });

  it("accepts a feed that has everything optional left null or empty, and one that has everything set", () => {
    expectValid(FeedEntry, { ...feed(), fallback_url: null, fresh_days: null, date_zone: null, fields: [] });
    expectValid(FeedEntry, {
      ...feed(), fallback_url: "https://rss.arxiv.org/atom/math", fresh_days: 30, date_zone: "-05:00", fields: ["mathematics", "physics"],
    });
  });

  it("needs every key, so a feed with nothing to say still says it", () => {
    for (const key of Object.keys(feed())) expectMutationFails(FeedEntry, feed(), (f) => delete f[key], key);
  });

  it("refuses an unknown key, such as one of Cyber's dropped keys", () => {
    for (const key of ["language", "region", "coverage", "tier", "extra"]) {
      expectMutationFails(FeedEntry, feed(), (f) => { f[key] = "x"; }, "", "Unrecognized key");
    }
  });

  it("refuses null where the spec has none", () => {
    for (const key of ["id", "name", "kind", "url", "priority", "must_match", "fields", "parser", "budget"]) {
      expectMutationFails(FeedEntry, feed(), (f) => { f[key] = null; }, key);
    }
  });

  it("holds the id to the config id format", () => {
    for (const id of ["arxiv-math", "journal-nature", "openalex", "a1"]) expectValid(FeedEntry, { ...feed(), id });
    for (const id of ["", "ArXiv", "arxiv_math", "-arxiv", "arxiv math"]) expectMutationFails(FeedEntry, feed(), (f) => { f.id = id; }, "id");
  });

  it("needs a name, and an https URL for the feed and for its fallback", () => {
    expectMutationFails(FeedEntry, feed(), (f) => { f.name = ""; }, "name");
    for (const key of ["url", "fallback_url"]) {
      for (const bad of ["http://export.arxiv.org/api/query", "ftp://export.arxiv.org/x", "export.arxiv.org/api/query", "", "not a url"]) {
        expectMutationFails(FeedEntry, { ...feed(), fallback_url: "https://rss.arxiv.org/atom/math" }, (f) => { f[key] = bad; }, key);
      }
      expectValid(FeedEntry, { ...feed(), [key]: "https://example.org/feed.xml" });
    }
    expectIssue(FeedEntry, { ...feed(), url: "http://example.org/x" }, "url", "https URL");
  });

  it("takes a priority of 1, 2 or 3 and nothing else", () => {
    for (const priority of [1, 2, 3]) expectValid(FeedEntry, { ...feed(), priority });
    for (const bad of [0, 4, -1, 1.5, "1", "high", true]) expectMutationFails(FeedEntry, feed(), (f) => { f.priority = bad; }, "priority");
  });

  it("takes fresh_days as a whole number of days from 1, or null", () => {
    for (const fresh_days of [1, 7, 365, null]) expectValid(FeedEntry, { ...feed(), fresh_days });
    for (const bad of [0, -1, 1.5, "7"]) expectMutationFails(FeedEntry, feed(), (f) => { f.fresh_days = bad; }, "fresh_days");
    expectMutationFails(FeedEntry, feed(), (f) => { delete f.fresh_days; }, "fresh_days");
  });

  it("takes must_match as a boolean", () => {
    for (const must_match of [true, false]) expectValid(FeedEntry, { ...feed(), must_match });
    for (const bad of ["true", 1, 0]) expectMutationFails(FeedEntry, feed(), (f) => { f.must_match = bad; }, "must_match");
  });

  it("takes date_zone as a UTC offset such as +08:00, or null for UTC, never Z", () => {
    for (const date_zone of ["+08:00", "-05:00", "+00:00", "+05:30", "+14:00", "-12:00", null]) expectValid(FeedEntry, { ...feed(), date_zone });
    // Nothing may come before or after the offset: the whole string is the offset.
    for (const bad of ["Z", "08:00", "+8:00", "+0800", "+15:00", "+08:60", "UTC", "+08", "", "x+08:00", "+08:00x", "+08:00 ", " +08:00", "+08:00\n"]) {
      expectMutationFails(FeedEntry, feed(), (f) => { f.date_zone = bad; }, "date_zone");
    }
  });

  it("takes fields as known field ids, each once, or an empty list", () => {
    expectValid(FeedEntry, { ...feed(), fields: [] });
    expectValid(FeedEntry, { ...feed(), fields: ["mathematics", "physics", "chemistry", "biology", "earth", "social", "humanities"] });
    expectMutationFails(FeedEntry, feed(), (f) => { f.fields = ["astronomy"]; }, "fields.0");
    expectMutationFails(FeedEntry, feed(), (f) => { f.fields = ["Physics"]; }, "fields.0");
    expectMutationFails(FeedEntry, feed(), (f) => { f.fields = ["physics", "physics"]; }, "fields", "must not repeat");
    expectMutationFails(FeedEntry, feed(), (f) => { f.fields = "physics"; }, "fields");
  });

  it("takes only the kinds and parsers of the spec", () => {
    expect([...FEED_KINDS]).toEqual(["api", "rss", "page", "file"]);
    expect([...FEED_PARSERS]).toEqual(["atom", "json", "rss", "html", "csv", "none"]);
    for (const kind of FEED_KINDS) expectValid(FeedEntry, { ...feed(), kind });
    for (const parser of FEED_PARSERS) expectValid(FeedEntry, { ...feed(), parser });
    for (const bad of ["atom", "Api", "feed", ""]) expectMutationFails(FeedEntry, feed(), (f) => { f.kind = bad; }, "kind");
    for (const bad of ["cheerio", "xml", "JSON", ""]) expectMutationFails(FeedEntry, feed(), (f) => { f.parser = bad; }, "parser");
    for (const [schema, values] of [[FeedKind, FEED_KINDS], [FeedParser, FEED_PARSERS]] as const) {
      for (const v of values) expectValid(schema, v);
      expect(schema.safeParse("not-a-value").success).toBe(false);
    }
  });

  it("takes a budget of whole requests from 0", () => {
    for (const budget of [0, 1, 100]) expectValid(FeedEntry, { ...feed(), budget });
    for (const bad of [-1, 1.5, "2", null]) expectMutationFails(FeedEntry, feed(), (f) => { f.budget = bad; }, "budget");
  });

  it("has the types the spec gives", () => {
    expectTypeOf<FeedEntryType["priority"]>().toEqualTypeOf<1 | 2 | 3>();
    expectTypeOf<FeedEntryType["kind"]>().toEqualTypeOf<"api" | "rss" | "page" | "file">();
    expectTypeOf<FeedEntryType["parser"]>().toEqualTypeOf<"atom" | "json" | "rss" | "html" | "csv" | "none">();
    expectTypeOf<FeedEntryType["fresh_days"]>().toEqualTypeOf<number | null>();
    expectTypeOf<FeedEntryType["fallback_url"]>().toEqualTypeOf<string | null>();
    expectTypeOf<SourcesFileType["schema_version"]>().toEqualTypeOf<1>();
  });
});

describe("SourcesFile", () => {
  it("holds the skipped arXiv dates and the feeds, in that order", () => {
    expectValid(SourcesFile, file());
    expectValid(SourcesFile, { schema_version: 1, arxiv_skipped: [], feeds: [] });
    expect(Object.keys(SourcesFile.shape)).toEqual(["schema_version", "arxiv_skipped", "feeds"]);
  });

  it("needs every key, and is at schema version 1 with no other key", () => {
    for (const key of Object.keys(file())) expectMutationFails(SourcesFile, file(), (f) => delete f[key], key);
    expectMutationFails(SourcesFile, file(), (f) => { f.schema_version = 2; }, "schema_version");
    expectMutationFails(SourcesFile, file(), (f) => { f.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(SourcesFile, file(), (f) => { f.keywords = []; }, "", "Unrecognized key");
    expectMutationFails(SourcesFile, file(), (f) => { f.feeds = null; }, "feeds");
    expectMutationFails(SourcesFile, file(), (f) => { f.arxiv_skipped = null; }, "arxiv_skipped");
  });

  it("refuses a feed id used twice, naming the second", () => {
    expectMutationFails(SourcesFile, file(), (f) => { f.feeds[1].id = "arxiv-math"; }, "feeds.1.id", "used twice");
    expectIssue(SourcesFile, { ...file(), feeds: [...file().feeds, { ...feed(), id: "biorxiv" }] }, "feeds.2.id", "biorxiv is used twice");
  });

  it("judges each feed by the feed schema, naming its place", () => {
    expectMutationFails(SourcesFile, file(), (f) => { f.feeds[1].priority = 4; }, "feeds.1.priority");
    expectMutationFails(SourcesFile, file(), (f) => { delete f.feeds[0].budget; }, "feeds.0.budget");
    expectMutationFails(SourcesFile, file(), (f) => { f.feeds[0].url = "http://example.org/"; }, "feeds.0.url");
    expectMutationFails(SourcesFile, file(), (f) => { f.feeds[1].extra = 1; }, "feeds.1", "Unrecognized key");
  });

  it("holds the skipped dates as real dates, each once", () => {
    expectValid(SourcesFile, { ...file(), arxiv_skipped: ["2026-07-03"] });
    expectMutationFails(SourcesFile, file(), (f) => { f.arxiv_skipped = ["2026-02-30"]; }, "arxiv_skipped.0");
    expectMutationFails(SourcesFile, file(), (f) => { f.arxiv_skipped = ["11/11/2026"]; }, "arxiv_skipped.0");
    expectMutationFails(SourcesFile, file(), (f) => { f.arxiv_skipped = ["2026-11-11", "2026-11-11"]; }, "arxiv_skipped", "must not repeat");
  });
});

describe("the Foundation's seed files", () => {
  const root = path.join(__dirname, "..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("config/sources.yaml parses as a registry, every feed with every key", () => {
    const parsed = SourcesFile.safeParse(parse(read("config/sources.yaml")));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    if (parsed.success) {
      expect(parsed.data.feeds.length).toBeGreaterThan(20);
      expect(new Set(parsed.data.feeds.map((f) => f.id)).size).toBe(parsed.data.feeds.length);
    }
  });

  it("config/fields.json: each field is a field id and each subfield id a subfield id", () => {
    const fields = JSON.parse(read("config/fields.json")).fields as { id: string; subfields: { id: string }[] }[];
    expect(fields).toHaveLength(7);
    for (const f of fields) {
      expectValid(FieldId, f.id);
      expect(f.subfields.length).toBeGreaterThan(0);
      for (const s of f.subfields) expectValid(SubfieldId, s.id);
    }
  });

  it("config/counters.json and config/journals.json: the ids fit the counter and config id formats", () => {
    for (const c of JSON.parse(read("config/counters.json")).counters as { id: string }[]) expectValid(CounterId, c.id);
    for (const j of JSON.parse(read("config/journals.json")).journals as { id: string }[]) expectValid(ConfigId, j.id);
  });
});
