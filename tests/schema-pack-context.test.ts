// lib/schema/pack.ts, lib/schema/context.ts and lib/schema/index.ts (SPEC §4.14, §4.15, §5.8): the daily pack and its
// candidates, the rung watch's state file, the English agent's context, and the barrel over every schema file. Each has a
// valid value and a failing one for each constraint; inline data. Which candidates a pack keeps, which reports, proposals
// and Sunday candidates a context shows, and what its numbers are, belong to the builders (P2, P3) and their tests.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { jsonText } from "@/lib/json";
import { FIELDS } from "@/lib/vocab";
import * as schemaIndex from "@/lib/schema";
import type { Rung } from "@/lib/schema/common";
import {
  AgentContext, ContextBudgets, ContextCandidate, ContextConfig, ContextField, ContextPace, ContextPack, ContextPublisher,
  ContextReport, ContextSourceKind, ContextStory, LEDGER_CANDIDATES_MAX, LedgerCandidate, PROPOSAL_KINDS, RecentFinding,
  RungProposal, StoredFinding, WeekContext, WeekFinding,
  type AgentContext as AgentContextType, type ContextBudgets as ContextBudgetsType, type ContextReport as ContextReportType,
  type LedgerCandidate as LedgerCandidateType, type ProposalKind, type RungProposal as RungProposalType,
  type StoredFinding as StoredFindingType, type WeekContext as WeekContextType,
} from "@/lib/schema/context";
import {
  Candidate, Pack, PackFeed, PackFlag, RungWatchFile, TimeWindow,
  type Candidate as CandidateType, type Pack as PackType, type PackFeed as PackFeedType,
  type RungWatchFile as RungWatchFileType, type TimeWindow as TimeWindowType,
} from "@/lib/schema/pack";
import { expectIssue, expectMutationFails, expectOnlyIssue, expectValid, issuesOf } from "./helpers/zod-issues";

const CANDIDATE_KEYS = [
  "id", "source_id", "title", "abstract", "url", "doi", "arxiv", "trial", "published_at", "journal", "fields", "ai_terms_matched",
  "journal_leading", "types", "stored_finding", "flags", "score", "deep_read",
];
const FEED_KEYS = ["id", "kind", "ok", "stale", "newest", "items_total", "items_kept", "error", "sha256"];
const PACK_KEYS = [
  "schema_version", "date", "window", "generated_at", "arxiv_announcement", "degraded", "feeds", "candidates", "injection_flags",
];
const CONTEXT_KEYS = [
  "date", "format", "window", "deadline", "budgets", "candidates", "pace", "recent_findings", "ledger_for_sunday", "week",
  "rung_proposals", "corrections", "reports", "standing_stories", "pack", "config",
];
const STORED_KEYS = [
  "id", "title", "field", "kind", "significance", "explainer", "ai", "rung_history", "since_then", "sources", "first_published",
];

// ── The pack ─────────────────────────────────────────────────────────────────────────────────────

const feed = () => ({
  id: "nature", kind: "api", ok: true, stale: false, newest: "2026-11-23T20:00:00+08:00", items_total: 40, items_kept: 6,
  error: null, sha256: "a".repeat(64),
});

/** A journal paper that matched an AI phrase, with its DOI. */
const candidate = (n = 1) => ({
  id: `cand-${String(n).padStart(2, "0")}`,
  source_id: "nature",
  title: "A made-up protein result",
  abstract: "A made-up abstract about a protein structure.",
  url: `https://example.org/papers/${n}`,
  doi: `10.1000/made-up.${n}`,
  arxiv: null as string | null,
  trial: [] as string[],
  published_at: "2026-11-23T09:00:00+08:00",
  journal: "Example Journal" as string | null,
  fields: ["biology"],
  ai_terms_matched: ["machine learning"],
  journal_leading: true,
  types: ["research-article"],
  stored_finding: null as string | null,
  flags: [] as string[],
  score: 7.5,
  deep_read: true,
});

/** A preprint with no DOI that names a trial and matches a stored finding, and carries a flag. */
const preprint = () => ({
  ...candidate(2),
  source_id: "arxiv",
  doi: null,
  arxiv: "2511.01234v2",
  trial: ["NCT01234567"],
  published_at: "2026-11-23",
  journal: null,
  fields: ["biology", "social"],
  ai_terms_matched: [] as string[],
  journal_leading: false,
  types: [] as string[],
  stored_finding: "bio-2026-0001",
  flags: ["injection_like"],
  score: -1.25,
  deep_read: false,
});

const pack = () => ({
  schema_version: 1,
  date: "2026-11-24",
  window: { start: "2026-11-23T04:00:00+08:00", end: "2026-11-24T03:00:00+08:00" },
  generated_at: "2026-11-24T03:16:00+08:00",
  arxiv_announcement: "2026-11-23T20:00:00Z" as string | null,
  degraded: false,
  feeds: [feed()],
  candidates: [candidate(1), preprint()],
  injection_flags: 1,
});

const rungWatch = () => ({
  schema_version: 1,
  checked: { "bio-2026-0001": "2026-11-20", "math-2026-0002": "2026-11-21", "phys-2026-0003": "2026-11-21" } as Record<string, string>,
});

describe("TimeWindow", () => {
  const window = () => ({ start: "2026-11-23T04:00:00+08:00", end: "2026-11-24T03:00:00+08:00" });

  it("accepts a window that ends after it starts", () => {
    expectValid(TimeWindow, window());
    expect(Object.keys(TimeWindow.shape)).toEqual(["start", "end"]);
    expectTypeOf<TimeWindowType>().toEqualTypeOf<{ start: string; end: string }>();
  });

  it("refuses a window that ends when it starts or before", () => {
    expectMutationFails(TimeWindow, window(), (w) => { w.end = w.start; }, "end", "ends after it starts");
    expectMutationFails(TimeWindow, window(), (w) => { w.end = "2026-11-22T00:00:00+08:00"; }, "end", "ends after it starts");
  });

  it("compares the instants, so an offset counts", () => {
    expectValid(TimeWindow, { start: "2026-11-23T04:00:00+08:00", end: "2026-11-22T21:00:00Z" });
    expectIssue(TimeWindow, { start: "2026-11-23T04:00:00+08:00", end: "2026-11-22T19:00:00Z" }, "end", "ends after it starts");
  });

  it("leaves a malformed or unreal timestamp to the timestamp check alone", () => {
    expectOnlyIssue(TimeWindow, { ...window(), start: "yesterday" }, "start");
    expectOnlyIssue(TimeWindow, { ...window(), end: "2026-02-30T00:00:00+08:00" }, "end", "real timestamp");
    expectOnlyIssue(TimeWindow, { ...window(), end: "2026-11-24T03:00:00" }, "end");
  });

  it("needs both keys and refuses any other", () => {
    expectMutationFails(TimeWindow, window(), (w) => delete w.start, "start");
    expectMutationFails(TimeWindow, window(), (w) => delete w.end, "end");
    expectMutationFails(TimeWindow, window(), (w) => { w.end = null; }, "end");
    expectMutationFails(TimeWindow, window(), (w) => { w.extra = 1; }, "", "Unrecognized key");
  });
});

describe("PackFeed", () => {
  it("accepts a feed that answered, and one that failed", () => {
    expectValid(PackFeed, feed());
    expectValid(PackFeed, { ...feed(), ok: false, stale: true, newest: null, items_total: 0, items_kept: 0, error: "The feed did not answer", sha256: null });
  });

  it("keeps the keys in the spec's order", () => {
    expect(Object.keys(PackFeed.shape)).toEqual(FEED_KEYS);
    const shuffled = Object.fromEntries(Object.entries(feed()).reverse());
    expect(Object.keys(PackFeed.parse(shuffled))).toEqual(FEED_KEYS);
  });

  it("has the types the spec gives", () => {
    expectTypeOf<PackFeedType["kind"]>().toEqualTypeOf<"api" | "rss" | "page" | "file">();
    expectTypeOf<PackFeedType["newest"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PackFeedType["error"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PackFeedType["sha256"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PackFeedType["items_kept"]>().toEqualTypeOf<number>();
  });

  it("needs every key, and allows null only for newest, error and sha256", () => {
    for (const key of FEED_KEYS) expectMutationFails(PackFeed, feed(), (f) => delete f[key], key);
    for (const key of FEED_KEYS.filter((k) => !["newest", "error", "sha256"].includes(k))) {
      expectMutationFails(PackFeed, feed(), (f) => { f[key] = null; }, key);
    }
    expectMutationFails(PackFeed, feed(), (f) => { f.extra = 1; }, "", "Unrecognized key");
  });

  it("takes the registry's four kinds and its id format", () => {
    for (const kind of ["api", "rss", "page", "file"]) expectValid(PackFeed, { ...feed(), kind });
    expectOnlyIssue(PackFeed, { ...feed(), kind: "atom" }, "kind");
    expectOnlyIssue(PackFeed, { ...feed(), id: "Nature" }, "id");
    expectOnlyIssue(PackFeed, { ...feed(), id: "" }, "id");
  });

  it("dates the newest item as the feed gave it: a timestamp, a date or null", () => {
    expectValid(PackFeed, { ...feed(), newest: "2026-11-23" });
    expectOnlyIssue(PackFeed, { ...feed(), newest: "yesterday" }, "newest");
    expectOnlyIssue(PackFeed, { ...feed(), newest: "2026-11-23T20:00:00" }, "newest");
  });

  it("counts with whole numbers from zero", () => {
    expectOnlyIssue(PackFeed, { ...feed(), items_total: -1 }, "items_total");
    expectOnlyIssue(PackFeed, { ...feed(), items_kept: 1.5 }, "items_kept");
    expectOnlyIssue(PackFeed, { ...feed(), items_total: "40" }, "items_total");
  });

  it("holds a fixed error text or null, and a lower-case SHA-256 or null", () => {
    expectOnlyIssue(PackFeed, { ...feed(), error: "" }, "error");
    expectValid(PackFeed, { ...feed(), error: "x" });
    expectOnlyIssue(PackFeed, { ...feed(), sha256: "A".repeat(64) }, "sha256");
    expectOnlyIssue(PackFeed, { ...feed(), sha256: "a".repeat(63) }, "sha256");
    expectOnlyIssue(PackFeed, { ...feed(), ok: "yes" }, "ok");
  });
});

describe("Candidate", () => {
  it("accepts a journal paper and a preprint", () => {
    expectValid(Candidate, candidate(1));
    expectValid(Candidate, preprint());
  });

  it("keeps the keys in the spec's order", () => {
    expect(Object.keys(Candidate.shape)).toEqual(CANDIDATE_KEYS);
    const shuffled = Object.fromEntries(Object.entries(candidate()).reverse());
    expect(Object.keys(Candidate.parse(shuffled))).toEqual(CANDIDATE_KEYS);
  });

  it("has the types the spec gives", () => {
    expectTypeOf<CandidateType["doi"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CandidateType["arxiv"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CandidateType["trial"]>().toEqualTypeOf<string[]>();
    expectTypeOf<CandidateType["published_at"]>().toEqualTypeOf<string>();
    expectTypeOf<CandidateType["journal"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CandidateType["fields"]>().toEqualTypeOf<(typeof FIELDS)[number][]>();
    expectTypeOf<CandidateType["flags"]>().toEqualTypeOf<"injection_like"[]>();
    expectTypeOf<CandidateType["stored_finding"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CandidateType["score"]>().toEqualTypeOf<number>();
  });

  it("needs every key, and allows null only for doi, arxiv, journal and stored_finding", () => {
    const nullable = ["doi", "arxiv", "journal", "stored_finding"];
    for (const key of CANDIDATE_KEYS) {
      expectMutationFails(Candidate, candidate(), (c) => delete c[key], key);
      if (!nullable.includes(key)) expectMutationFails(Candidate, candidate(), (c) => { c[key] = null; }, key);
    }
    for (const key of nullable) expectValid(Candidate, { ...candidate(), [key]: null });
    expectMutationFails(Candidate, candidate(), (c) => { c.extra = 1; }, "", "Unrecognized key");
  });

  it("numbers a candidate cand-NN with at least two digits", () => {
    for (const id of ["cand-01", "cand-99", "cand-100"]) expectValid(Candidate, { ...candidate(), id });
    for (const id of ["cand-1", "cand-", "Cand-01", "cand-0a", "01", "", "xcand-01", "cand-01x", " cand-01", "cand-01 ", "cand-01\n", "cand--01"]) {
      expectOnlyIssue(Candidate, { ...candidate(), id }, "id");
    }
  });

  it("names the registry feed it came from", () => {
    expectValid(Candidate, { ...candidate(), source_id: "arxiv-math" });
    for (const source_id of ["Nature", "-nature", "nature feed", ""]) expectOnlyIssue(Candidate, { ...candidate(), source_id }, "source_id");
  });

  it("needs a title, and holds an abstract of at most 1,000 characters, which may be empty", () => {
    expectOnlyIssue(Candidate, { ...candidate(), title: "" }, "title");
    expectValid(Candidate, { ...candidate(), title: "X" });
    expectValid(Candidate, { ...candidate(), abstract: "" });
    expectValid(Candidate, { ...candidate(), abstract: "x".repeat(1000) });
    expectOnlyIssue(Candidate, { ...candidate(), abstract: "x".repeat(1001) }, "abstract");
  });

  it("links to the record over https only", () => {
    expectOnlyIssue(Candidate, { ...candidate(), url: "http://example.org/papers/1" }, "url", "https");
    expectOnlyIssue(Candidate, { ...candidate(), url: "example.org/papers/1" }, "url", "https");
    expectOnlyIssue(Candidate, { ...candidate(), url: "" }, "url");
  });

  it("gives a DOI in lower case without its resolver, or null", () => {
    expectOnlyIssue(Candidate, { ...candidate(), doi: "10.1000/MADE-UP.1" }, "doi", "lower case");
    expectIssue(Candidate, { ...candidate(), doi: "https://doi.org/10.1000/made-up.1" }, "doi");
    expectOnlyIssue(Candidate, { ...candidate(), doi: "10.1000" }, "doi");
    expectOnlyIssue(Candidate, { ...candidate(), doi: "10.1000/made up" }, "doi");
  });

  it("gives an arXiv id, with or without its version, or null", () => {
    for (const arxiv of ["2511.01234", "2511.01234v2", "2511.0123"]) expectValid(Candidate, { ...candidate(), arxiv });
    for (const arxiv of ["arXiv:2511.01234", "2511.123", "math/0601001", ""]) expectOnlyIssue(Candidate, { ...candidate(), arxiv }, "arxiv");
  });

  it("lists NCT numbers, each NCT and eight digits", () => {
    expectValid(Candidate, { ...candidate(), trial: ["NCT01234567", "NCT76543210"] });
    expectMutationFails(Candidate, candidate(), (c) => { c.trial = ["NCT0123456"]; }, "trial.0", "NCT");
    expectMutationFails(Candidate, candidate(), (c) => { c.trial = ["nct01234567"]; }, "trial.0");
    expectMutationFails(Candidate, candidate(), (c) => { c.trial = "NCT01234567"; }, "trial");
  });

  it("dates it with a timestamp or a date, never null", () => {
    expectValid(Candidate, { ...candidate(), published_at: "2026-11-23" });
    expectOnlyIssue(Candidate, { ...candidate(), published_at: "2026-11-23T09:00:00" }, "published_at");
    expectOnlyIssue(Candidate, { ...candidate(), published_at: "2026-02-30" }, "published_at");
    expectOnlyIssue(Candidate, { ...candidate(), published_at: null }, "published_at");
  });

  it("names its journal or null", () => {
    expectOnlyIssue(Candidate, { ...candidate(), journal: "" }, "journal");
    expectValid(Candidate, { ...candidate(), journal: "X" });
  });

  it("lists at least one field, each once, from the seven", () => {
    expectValid(Candidate, { ...candidate(), fields: [...FIELDS] });
    expectMutationFails(Candidate, candidate(), (c) => { c.fields = []; }, "fields", "at least one field");
    expectMutationFails(Candidate, candidate(), (c) => { c.fields = ["biology", "biology"]; }, "fields", "must not repeat");
    expectMutationFails(Candidate, candidate(), (c) => { c.fields = ["biology_and_medicine"]; }, "fields.0");
  });

  it("lists the matched phrases and the article types as non-empty strings", () => {
    expectMutationFails(Candidate, candidate(), (c) => { c.ai_terms_matched = [""]; }, "ai_terms_matched.0");
    expectMutationFails(Candidate, candidate(), (c) => { c.types = [""]; }, "types.0");
    expectMutationFails(Candidate, candidate(), (c) => { c.types = "research-article"; }, "types");
    expectValid(Candidate, { ...candidate(), ai_terms_matched: [], types: [] });
    expectValid(Candidate, { ...candidate(), ai_terms_matched: ["x"], types: ["x"] });
  });

  it("holds the leading-journal flag, the deep-read flag and the score", () => {
    expectOnlyIssue(Candidate, { ...candidate(), journal_leading: "yes" }, "journal_leading");
    expectOnlyIssue(Candidate, { ...candidate(), deep_read: 1 }, "deep_read");
    expectOnlyIssue(Candidate, { ...candidate(), score: "7.5" }, "score");
    expectValid(Candidate, { ...candidate(), score: 0 });
  });

  it("matches a stored finding by its id, or null", () => {
    expectOnlyIssue(Candidate, { ...candidate(), stored_finding: "bio-26-1" }, "stored_finding");
    expectOnlyIssue(Candidate, { ...candidate(), stored_finding: "new-1" }, "stored_finding");
  });

  it("flags only what the injection check names", () => {
    expect(PackFlag.options).toEqual(["injection_like"]);
    expectMutationFails(Candidate, candidate(), (c) => { c.flags = ["other"]; }, "flags.0");
    expectValid(Candidate, { ...candidate(), flags: ["injection_like", "injection_like"] });
  });
});

describe("Pack", () => {
  it("accepts a pack, one with nothing in it and one with no arXiv announcement", () => {
    expectValid(Pack, pack());
    expectValid(Pack, { ...pack(), feeds: [], candidates: [], injection_flags: 0, degraded: true });
    expectValid(Pack, { ...pack(), arxiv_announcement: null });
  });

  it("keeps the keys in the spec's order", () => {
    expect(Object.keys(Pack.shape)).toEqual(PACK_KEYS);
    const shuffled = Object.fromEntries(Object.entries(pack()).reverse());
    expect(Object.keys(Pack.parse(shuffled))).toEqual(PACK_KEYS);
    expect(JSON.parse(jsonText(shuffled, Pack)).date).toBe("2026-11-24");
  });

  it("has the types the spec gives", () => {
    expectTypeOf<PackType["schema_version"]>().toEqualTypeOf<1>();
    expectTypeOf<PackType["window"]>().toEqualTypeOf<TimeWindowType>();
    expectTypeOf<PackType["arxiv_announcement"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PackType["feeds"]>().toEqualTypeOf<PackFeedType[]>();
    expectTypeOf<PackType["candidates"]>().toEqualTypeOf<CandidateType[]>();
    expectTypeOf<PackType["injection_flags"]>().toEqualTypeOf<number>();
  });

  it("needs every key, and allows null only for arxiv_announcement", () => {
    for (const key of PACK_KEYS) expectMutationFails(Pack, pack(), (p) => delete p[key], key);
    for (const key of PACK_KEYS.filter((k) => k !== "arxiv_announcement")) expectMutationFails(Pack, pack(), (p) => { p[key] = null; }, key);
    expectMutationFails(Pack, pack(), (p) => { p.extra = 1; }, "", "Unrecognized key");
    for (const dropped of ["data_cutoff_utc", "rung_proposals", "reports", "items"]) {
      expectMutationFails(Pack, pack(), (p) => { p[dropped] = []; }, "", "Unrecognized key");
    }
  });

  it("takes version 1, a real date and a timestamp with an offset", () => {
    expectMutationFails(Pack, pack(), (p) => { p.schema_version = 2; }, "schema_version");
    expectMutationFails(Pack, pack(), (p) => { p.date = "2026-02-30"; }, "date");
    expectMutationFails(Pack, pack(), (p) => { p.generated_at = "2026-11-24T03:16:00"; }, "generated_at");
    expectMutationFails(Pack, pack(), (p) => { p.arxiv_announcement = "2026-11-23"; }, "arxiv_announcement");
  });

  it("holds a window that ends after it starts", () => {
    expectMutationFails(Pack, pack(), (p) => { p.window.end = p.window.start; }, "window.end", "ends after it starts");
  });

  it("reports a problem inside a feed or a candidate at its own path", () => {
    expectMutationFails(Pack, pack(), (p) => { p.feeds[0].kind = "atom"; }, "feeds.0.kind");
    expectMutationFails(Pack, pack(), (p) => { p.candidates[1].id = "cand-2"; }, "candidates.1.id");
    expectMutationFails(Pack, pack(), (p) => { p.candidates[0].fields = []; }, "candidates.0.fields");
  });

  it("counts the flagged candidates with a whole number, which collect checks against the candidates", () => {
    expectMutationFails(Pack, pack(), (p) => { p.injection_flags = -1; }, "injection_flags");
    expectMutationFails(Pack, pack(), (p) => { p.injection_flags = 0.5; }, "injection_flags");
    expectValid(Pack, { ...pack(), injection_flags: 7, degraded: true });
  });
});

describe("RungWatchFile (SPEC §5.8)", () => {
  it("accepts a file of several findings, and an empty one", () => {
    expectValid(RungWatchFile, rungWatch());
    expectValid(RungWatchFile, { schema_version: 1, checked: {} });
  });

  it("keeps the keys in the spec's order and has the types the spec gives", () => {
    expect(Object.keys(RungWatchFile.shape)).toEqual(["schema_version", "checked"]);
    const shuffled = Object.fromEntries(Object.entries(rungWatch()).reverse());
    expect(Object.keys(RungWatchFile.parse(shuffled))).toEqual(["schema_version", "checked"]);
    expectTypeOf<RungWatchFileType["checked"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<RungWatchFileType["schema_version"]>().toEqualTypeOf<1>();
  });

  it("needs both keys and refuses any other", () => {
    expectMutationFails(RungWatchFile, rungWatch(), (f) => delete f.checked, "checked");
    expectMutationFails(RungWatchFile, rungWatch(), (f) => delete f.schema_version, "schema_version");
    expectMutationFails(RungWatchFile, rungWatch(), (f) => { f.checked = null; }, "checked");
    expectMutationFails(RungWatchFile, rungWatch(), (f) => { f.schema_version = 2; }, "schema_version");
    expectMutationFails(RungWatchFile, rungWatch(), (f) => { f.extra = 1; }, "", "Unrecognized key");
  });

  it("keys the dates by finding id", () => {
    expectMutationFails(RungWatchFile, rungWatch(), (f) => { f.checked["math-26-2"] = "2026-11-21"; }, "checked.math-26-2", "Invalid key");
    expectMutationFails(RungWatchFile, rungWatch(), (f) => { f.checked["new-1"] = "2026-11-21"; }, "checked.new-1", "Invalid key");
  });

  it("holds a real date for each finding", () => {
    expectMutationFails(RungWatchFile, rungWatch(), (f) => { f.checked["bio-2026-0001"] = "2026-11-31"; }, "checked.bio-2026-0001");
    expectMutationFails(RungWatchFile, rungWatch(), (f) => { f.checked["bio-2026-0001"] = null; }, "checked.bio-2026-0001");
    expectMutationFails(RungWatchFile, rungWatch(), (f) => { f.checked["bio-2026-0001"] = "2026-11-20T03:00:00+08:00"; }, "checked.bio-2026-0001");
  });

  it("lists the findings in id order, which sorts the field code first, then the year and the counter", () => {
    expectValid(RungWatchFile, { schema_version: 1, checked: { "bio-2026-0009": "2026-11-20", "bio-2027-0001": "2026-11-20", "hum-2026-0001": "2026-11-20" } });
    expectIssue(
      RungWatchFile,
      { schema_version: 1, checked: { "math-2026-0002": "2026-11-21", "bio-2026-0001": "2026-11-20" } },
      "checked.bio-2026-0001", "id order",
    );
    expectIssue(
      RungWatchFile,
      { schema_version: 1, checked: { "bio-2027-0001": "2026-11-20", "bio-2026-0009": "2026-11-20" } },
      "checked.bio-2026-0009", "id order",
    );
  });
});

// ── The context ──────────────────────────────────────────────────────────────────────────────────

const artefacts = () => ({ doi: [] as string[], arxiv: [] as string[], lean: [] as string[], trial: [] as string[], pdb: [] as string[] });

/** A finding as the agent reads it: English only, with the stored sources. */
const stored = () => ({
  id: "math-2026-0002",
  title: "A made-up proof",
  field: "mathematics",
  kind: "result",
  significance: "notable",
  explainer: {
    found: "A made-up system found a proof.",
    matters: "It shows what the method can do.",
    ai_helped: "The system searched for the proof." as string | null,
    how_sure: "Checked by a proof assistant.",
    background: "A made-up background.",
    could_lead: "Other proofs may follow.",
  },
  ai: {
    role: "ai_solved",
    confidence: "confirmed" as string | null,
    systems: [{ name: "Example Prover", maker: "Example Lab" }],
    evidence: [{ source_id: "s1", quote: "The system found the proof.", from_claimant: false }],
  },
  rung_history: [{ rung: "preprint", date: "2026-10-01", recorded: "2026-10-02", source_id: "s1", by: "agent", note: null as string | null }],
  since_then: [{ date: "2026-10-20", text: "A journal accepted the paper.", source_ids: ["s1"] }],
  sources: [{
    id: "s1", kind: "preprint", title: "A made-up proof", publisher: "arXiv", url: "https://example.org/preprint/1", doi: null,
    published_at: "2026-10-01", seen_as: "pack", added: "2026-10-02",
  }],
  first_published: "2026-10-02",
});

const ledger = (n = 2) => ({ ...stored(), id: `math-2026-${String(n).padStart(4, "0")}`, reasons: ["rotation"] });

const report = () => ({
  id: "R-0001", status: "open", finding_id: "math-2026-0002", kind: "fact", evidence_url: null as string | null, finding: stored(),
});

const recent = () => ({
  id: "bio-2026-0001", title: "A made-up protein result", field: "biology", rung: "checked", significance: "major", artefacts: artefacts(),
});

const budgets = () => ({
  web_fetches: 12, findings_max: 8, typical_findings: [4, 6], deep_read_max: 5, words_target: 1100, words_max: 1500,
  reading_grade_soft: 10, reading_grade_max: 12.5,
});

const wrappedCandidate = (n = 1) => ({
  ...candidate(n),
  title: "<untrusted>A made-up protein result</untrusted>",
  abstract: "<untrusted>A made-up abstract about a protein structure.</untrusted>",
});

const fieldCounts = () => FIELDS.map((field) => ({ field, reported: 1, counted: 1 }));

const week = () => ({
  findings: [{ id: "math-2026-0002", title: "A made-up proof", field: "mathematics", kind: "result", significance: "notable", rung: "checked" }],
  rung_changes: [{ finding_id: "phys-2026-0003", from: "preprint", to: "disputed", date: "2026-11-20", by: "agent" }],
  setbacks: ["chem-2026-0004"],
  field_counts: fieldCounts(),
});

const proposal = () => ({
  finding_id: "math-2026-0002", kind: "journal_version", to: "confirmed" as string | null, date: "2026-11-20" as string | null,
  url: "https://example.org/journal/1" as string | null, note: "A journal version of the paper was found.",
});

const contextConfig = () => ({
  hype_words: ["breakthrough"],
  jargon: ["transformer"],
  field_cap: 2,
  fields: [{ id: "mathematics", subfields: [{ id: "proofs", name: "Proofs" }] }],
  source_kinds: [{ id: "paper", label: "Paper", means: "a peer-reviewed paper" }],
  allowlist: [{ id: "arxiv", name: "arXiv", hosts: ["arxiv.org"], kinds: ["preprint"] }],
});

const flagged = () => ({ finding_id: "math-2026-0002", edition_date: null, term_id: null, path: "explainer.found", code: "DUAL_USE" });

/** A Tuesday's context: no week, no Sunday candidates. */
const context = () => ({
  date: "2026-11-24",
  format: "daily",
  window: { start: "2026-11-23T04:00:00+08:00", end: "2026-11-24T03:00:00+08:00" },
  deadline: "2026-11-24T04:15:00+08:00",
  budgets: budgets(),
  candidates: [wrappedCandidate(1), wrappedCandidate(2)],
  pace: { sentence: "The Pace: 8.4% of papers named AI methods.", quotable: { "pace.leading.pooled.window": "8.4%" } },
  recent_findings: [recent()],
  ledger_for_sunday: [] as ReturnType<typeof ledger>[],
  week: null as ReturnType<typeof week> | null,
  rung_proposals: [proposal()],
  corrections: { flagged: [flagged()] },
  reports: [report()],
  standing_stories: [{ id: "erdos-problems", finding_ids: ["math-2026-0002"], rule: "Return only on a newly solved problem." }],
  pack: { md: "packs/2026-11-24.md", json: "packs/2026-11-24.json", degraded: false, failed_feeds: [] as string[] },
  config: contextConfig(),
});

/** A Monday's context: the week of the seven editions before it. */
const mondayContext = () => ({ ...context(), date: "2026-11-23", format: "monday_review", week: week() });

/** A Sunday's context: up to ten candidates for the deep dive. */
const sundayContext = () => ({ ...context(), date: "2026-11-22", format: "sunday_deep_dive", ledger_for_sunday: [ledger(2), ledger(3)] });

describe("ContextBudgets", () => {
  it("accepts the limits the agent reads", () => {
    expectValid(ContextBudgets, budgets());
    expect(Object.keys(ContextBudgets.shape)).toEqual([
      "web_fetches", "findings_max", "typical_findings", "deep_read_max", "words_target", "words_max", "reading_grade_soft",
      "reading_grade_max",
    ]);
    expectTypeOf<ContextBudgetsType["typical_findings"]>().toEqualTypeOf<[number, number]>();
    expectTypeOf<ContextBudgetsType["reading_grade_max"]>().toEqualTypeOf<number>();
  });

  it("needs every key, with no null, and refuses any other", () => {
    for (const key of Object.keys(budgets())) {
      expectMutationFails(ContextBudgets, budgets(), (b) => delete b[key], key);
      expectMutationFails(ContextBudgets, budgets(), (b) => { b[key] = null; }, key);
    }
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.extra = 1; }, "", "Unrecognized key");
  });

  it("counts with whole numbers from zero, and the reading grades from zero", () => {
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.web_fetches = -1; }, "web_fetches");
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.words_max = 1500.5; }, "words_max");
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.findings_max = "8"; }, "findings_max");
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.reading_grade_soft = -0.5; }, "reading_grade_soft");
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.reading_grade_max = -0.5; }, "reading_grade_max");
    expectValid(ContextBudgets, { ...budgets(), reading_grade_soft: 9.5, web_fetches: 0 });
    expectValid(ContextBudgets, { ...budgets(), reading_grade_soft: 0, reading_grade_max: 0 });
  });

  it("gives a normal day's findings as [from, to] with from at most to", () => {
    expectValid(ContextBudgets, { ...budgets(), typical_findings: [5, 5] });
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.typical_findings = [6, 4]; }, "typical_findings", "from <= to");
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.typical_findings = [4]; }, "typical_findings");
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.typical_findings = [4, 5, 6]; }, "typical_findings");
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.typical_findings = [-1, 4]; }, "typical_findings.0");
    expectMutationFails(ContextBudgets, budgets(), (b) => { b.typical_findings = [1.5, 4]; }, "typical_findings.0");
  });
});

describe("ContextCandidate", () => {
  it("takes the pack's candidate with its text wrapped, beyond the pack's character cap", () => {
    expectValid(ContextCandidate, wrappedCandidate());
    const long = { ...wrappedCandidate(), abstract: `<untrusted>${"x".repeat(1100)}</untrusted>` };
    expectValid(ContextCandidate, long);
    expectOnlyIssue(Candidate, long, "abstract");
    expectValid(ContextCandidate, { ...wrappedCandidate(), abstract: "" });
  });

  it("keeps the pack candidate's keys in its order and its other constraints", () => {
    expect(Object.keys(ContextCandidate.shape)).toEqual(CANDIDATE_KEYS);
    expectMutationFails(ContextCandidate, wrappedCandidate(), (c) => { c.id = "cand-1"; }, "id");
    expectMutationFails(ContextCandidate, wrappedCandidate(), (c) => { c.url = "http://example.org"; }, "url");
    expectMutationFails(ContextCandidate, wrappedCandidate(), (c) => { c.fields = []; }, "fields");
    expectMutationFails(ContextCandidate, wrappedCandidate(), (c) => { c.title = ""; }, "title");
    expectMutationFails(ContextCandidate, wrappedCandidate(), (c) => { c.abstract = null; }, "abstract");
    expectMutationFails(ContextCandidate, wrappedCandidate(), (c) => { c.extra = 1; }, "", "Unrecognized key");
  });
});

describe("ContextPace", () => {
  const pace = () => context().pace;

  it("takes the sentence and the figures prose may quote", () => {
    expectValid(ContextPace, pace());
    expectValid(ContextPace, { ...pace(), quotable: {} });
    expect(Object.keys(ContextPace.shape)).toEqual(["sentence", "quotable"]);
  });

  it("needs a sentence and non-empty figures keyed by metric path", () => {
    expectMutationFails(ContextPace, pace(), (p) => { p.sentence = ""; }, "sentence");
    expectValid(ContextPace, { sentence: "x", quotable: { "pace.leading": "x" } });
    expectMutationFails(ContextPace, pace(), (p) => { p.quotable = { "pace.leading.pooled.window": "" }; }, "quotable.pace.leading.pooled.window");
    expectMutationFails(ContextPace, pace(), (p) => { p.quotable = { "Pace Leading": "8.4%" }; }, "quotable.Pace Leading", "Invalid key");
    expectMutationFails(ContextPace, pace(), (p) => { p.quotable = { "pace.leading": 8.4 }; }, "quotable.pace.leading");
    expectMutationFails(ContextPace, pace(), (p) => { p.quotable = []; }, "quotable");
    expectMutationFails(ContextPace, pace(), (p) => { p.extra = 1; }, "", "Unrecognized key");
  });
});

describe("RecentFinding", () => {
  it("accepts a finding of the last 30 days, at any rung", () => {
    expectValid(RecentFinding, recent());
    for (const rung of ["claimed", "preprint", "checked", "confirmed", "applied", "disputed", "retracted"]) {
      expectValid(RecentFinding, { ...recent(), rung });
    }
    expect(Object.keys(RecentFinding.shape)).toEqual(["id", "title", "field", "rung", "significance", "artefacts"]);
  });

  it("needs every key, and the five artefact lists", () => {
    for (const key of Object.keys(recent())) expectMutationFails(RecentFinding, recent(), (r) => delete r[key], key);
    for (const key of ["doi", "arxiv", "lean", "trial", "pdb"]) {
      expectMutationFails(RecentFinding, recent(), (r) => delete r.artefacts[key], `artefacts.${key}`);
    }
    expectMutationFails(RecentFinding, recent(), (r) => { r.artefacts.extra = []; }, "artefacts", "Unrecognized key");
    expectMutationFails(RecentFinding, recent(), (r) => { r.extra = 1; }, "", "Unrecognized key");
  });

  it("takes the vocabulary and the id format", () => {
    expectMutationFails(RecentFinding, recent(), (r) => { r.field = "biology_and_medicine"; }, "field");
    expectMutationFails(RecentFinding, recent(), (r) => { r.rung = "proven"; }, "rung");
    expectMutationFails(RecentFinding, recent(), (r) => { r.significance = "huge"; }, "significance");
    expectMutationFails(RecentFinding, recent(), (r) => { r.id = "new-1"; }, "id");
    expectMutationFails(RecentFinding, recent(), (r) => { r.title = ""; }, "title");
  });
});

describe("StoredFinding", () => {
  it("accepts a finding with an AI role, and one with none", () => {
    expectValid(StoredFinding, stored());
    const noRole = stored();
    noRole.explainer.ai_helped = null;
    noRole.ai = { role: "none", confidence: null, systems: [], evidence: [] };
    expectValid(StoredFinding, noRole);
  });

  it("keeps the keys in the spec's order", () => {
    expect(Object.keys(StoredFinding.shape)).toEqual(STORED_KEYS);
    expect(Object.keys(StoredFinding.shape.explainer.shape)).toEqual(["found", "matters", "ai_helped", "how_sure", "background", "could_lead"]);
    const shuffled = Object.fromEntries(Object.entries(stored()).reverse());
    expect(Object.keys(StoredFinding.parse(shuffled))).toEqual(STORED_KEYS);
  });

  it("holds English strings, not both languages", () => {
    expectTypeOf<StoredFindingType["title"]>().toEqualTypeOf<string>();
    expectTypeOf<StoredFindingType["explainer"]["found"]>().toEqualTypeOf<string>();
    expectTypeOf<StoredFindingType["explainer"]["ai_helped"]>().toEqualTypeOf<string | null>();
    expectTypeOf<StoredFindingType["since_then"][number]["text"]>().toEqualTypeOf<string>();
    expectTypeOf<StoredFindingType["rung_history"][number]["note"]>().toEqualTypeOf<string | null>();
    expectTypeOf<StoredFindingType["first_published"]>().toEqualTypeOf<string>();
    expectMutationFails(StoredFinding, stored(), (s) => { s.title = { en: "A made-up proof", zh: null }; }, "title");
    expectMutationFails(StoredFinding, stored(), (s) => { s.since_then[0].text = { en: "x", zh: null }; }, "since_then.0.text");
    expectMutationFails(StoredFinding, stored(), (s) => { s.rung_history[0].note = { en: "x", zh: null }; }, "rung_history.0.note");
    expectValid(StoredFinding, { ...stored(), rung_history: [{ ...stored().rung_history[0], note: "Posted as a preprint." }] });
  });

  it("needs every key, and allows null only for ai_helped, confidence and a rung note", () => {
    for (const key of STORED_KEYS) {
      expectMutationFails(StoredFinding, stored(), (s) => delete s[key], key);
      expectMutationFails(StoredFinding, stored(), (s) => { s[key] = null; }, key);
    }
    for (const key of ["found", "matters", "how_sure", "background", "could_lead"]) {
      expectMutationFails(StoredFinding, stored(), (s) => { s.explainer[key] = null; }, `explainer.${key}`);
    }
    expectMutationFails(StoredFinding, stored(), (s) => delete s.explainer.ai_helped, "explainer.ai_helped");
    expectMutationFails(StoredFinding, stored(), (s) => { s.explainer.found = ""; }, "explainer.found");
  });

  it("refuses an unknown key at every level", () => {
    const places: [(s: any) => void, string][] = [
      [(s) => { s.extra = 1; }, ""],
      [(s) => { s.explainer.extra = "x"; }, "explainer"],
      [(s) => { s.ai.extra = 1; }, "ai"],
      [(s) => { s.rung_history[0].extra = 1; }, "rung_history.0"],
      [(s) => { s.since_then[0].extra = 1; }, "since_then.0"],
      [(s) => { s.sources[0].extra = 1; }, "sources.0"],
    ];
    for (const [mutate, path] of places) expectMutationFails(StoredFinding, stored(), mutate, path, "Unrecognized key");
  });

  it("has at least one rung entry, which may be of any rung", () => {
    expectMutationFails(StoredFinding, stored(), (s) => { s.rung_history = []; }, "rung_history", "at least one rung entry");
    expectMutationFails(StoredFinding, stored(), (s) => { s.rung_history[0].rung = "proven"; }, "rung_history.0.rung");
    expectMutationFails(StoredFinding, stored(), (s) => { s.rung_history[0].by = "editor"; }, "rung_history.0.by");
    expectMutationFails(StoredFinding, stored(), (s) => { s.rung_history[0].source_id = "b1"; }, "rung_history.0.source_id");
    expectMutationFails(StoredFinding, stored(), (s) => { s.rung_history[0].date = "2026-10-32"; }, "rung_history.0.date");
  });

  it("dates a later fact and names its sources with finding source ids", () => {
    expectValid(StoredFinding, { ...stored(), since_then: [] });
    expectMutationFails(StoredFinding, stored(), (s) => { s.since_then[0].date = "2026-02-30"; }, "since_then.0.date");
    expectMutationFails(StoredFinding, stored(), (s) => { s.since_then[0].source_ids = ["b1"]; }, "since_then.0.source_ids.0");
    expectMutationFails(StoredFinding, stored(), (s) => { s.since_then[0].text = ""; }, "since_then.0.text");
  });

  it("holds the stored sources and the AI part as the stored finding does", () => {
    expectMutationFails(StoredFinding, stored(), (s) => { s.sources[0].id = "b1"; }, "sources.0.id");
    expectMutationFails(StoredFinding, stored(), (s) => { s.sources[0].url = ""; }, "sources.0.url");
    expectMutationFails(StoredFinding, stored(), (s) => { s.sources[0].seen_as = "dream"; }, "sources.0.seen_as");
    expectMutationFails(StoredFinding, stored(), (s) => { s.ai.evidence = []; }, "ai.evidence", "evidence entry");
    expectMutationFails(StoredFinding, stored(), (s) => { s.ai.role = "magic"; }, "ai.role");
  });

  it("takes the id, the vocabulary and the first publication date", () => {
    expectMutationFails(StoredFinding, stored(), (s) => { s.id = "math-26-2"; }, "id");
    expectMutationFails(StoredFinding, stored(), (s) => { s.field = "maths"; }, "field");
    expectMutationFails(StoredFinding, stored(), (s) => { s.kind = "idea"; }, "kind");
    expectMutationFails(StoredFinding, stored(), (s) => { s.significance = "huge"; }, "significance");
    expectMutationFails(StoredFinding, stored(), (s) => { s.first_published = "2026-13-01"; }, "first_published");
  });
});

describe("LedgerCandidate", () => {
  it("accepts a stored finding with one to three reasons", () => {
    expectValid(LedgerCandidate, ledger());
    expectValid(LedgerCandidate, { ...ledger(), reasons: ["news", "anniversary", "rotation"] });
    expect(Object.keys(LedgerCandidate.shape)).toEqual([...STORED_KEYS, "reasons"]);
    expectTypeOf<LedgerCandidateType["reasons"]>().toEqualTypeOf<("news" | "anniversary" | "rotation")[]>();
  });

  it("needs at least one reason, each once and from the three", () => {
    expectMutationFails(LedgerCandidate, ledger(), (c) => { c.reasons = []; }, "reasons", "at least one reason");
    expectMutationFails(LedgerCandidate, ledger(), (c) => { c.reasons = ["news", "news"]; }, "reasons", "must not repeat");
    expectMutationFails(LedgerCandidate, ledger(), (c) => { c.reasons = ["popular"]; }, "reasons.0");
    expectMutationFails(LedgerCandidate, ledger(), (c) => delete c.reasons, "reasons");
  });

  it("keeps every constraint of the stored finding", () => {
    expectMutationFails(LedgerCandidate, ledger(), (c) => { c.title = ""; }, "title");
    expectMutationFails(LedgerCandidate, ledger(), (c) => { c.rung_history = []; }, "rung_history");
    expectMutationFails(LedgerCandidate, ledger(), (c) => { c.extra = 1; }, "", "Unrecognized key");
  });
});

describe("ContextReport", () => {
  it("accepts an open report and an upheld one", () => {
    expectValid(ContextReport, report());
    expectValid(ContextReport, { ...report(), status: "upheld", kind: "rung", evidence_url: "https://example.org/notice/1" });
    expect(Object.keys(ContextReport.shape)).toEqual(["id", "status", "finding_id", "kind", "evidence_url", "finding"]);
    expect(ContextReport.shape.status.options).toEqual(["open", "upheld"]);
    expectTypeOf<ContextReportType["status"]>().toEqualTypeOf<"open" | "upheld">();
    expectTypeOf<ContextReportType["evidence_url"]>().toEqualTypeOf<string | null>();
  });

  it("is about a report still to decide, never one decided against", () => {
    expectMutationFails(ContextReport, report(), (r) => { r.status = "rejected"; }, "status");
    expectMutationFails(ContextReport, report(), (r) => { r.status = "decided"; }, "status");
  });

  it("carries the text of its finding", () => {
    expectMutationFails(ContextReport, report(), (r) => { r.finding_id = "bio-2026-0001"; }, "finding.id", "report's finding");
    expectMutationFails(ContextReport, report(), (r) => { r.finding.id = "bio-2026-0001"; }, "finding.id", "report's finding");
    expectMutationFails(ContextReport, report(), (r) => { r.finding.title = ""; }, "finding.title");
    expectMutationFails(ContextReport, report(), (r) => delete r.finding, "finding");
  });

  it("takes the report id and kind of the reader form", () => {
    for (const kind of ["fact", "source", "rung", "link", "dangerous"]) expectValid(ContextReport, { ...report(), kind });
    expectMutationFails(ContextReport, report(), (r) => { r.kind = "typo"; }, "kind");
    expectMutationFails(ContextReport, report(), (r) => { r.id = "R-1"; }, "id");
    expectMutationFails(ContextReport, report(), (r) => { r.id = "C-0001"; }, "id");
  });

  it("gives the reader's link of at most 500 characters, or null", () => {
    expectValid(ContextReport, { ...report(), evidence_url: `https://example.org/${"x".repeat(480)}` });
    expectMutationFails(ContextReport, report(), (r) => { r.evidence_url = `https://example.org/${"x".repeat(481)}`; }, "evidence_url");
    expectMutationFails(ContextReport, report(), (r) => { r.evidence_url = ""; }, "evidence_url");
    expectValid(ContextReport, { ...report(), evidence_url: "x" });
    expectMutationFails(ContextReport, report(), (r) => delete r.evidence_url, "evidence_url");
  });

  it("needs every key and refuses any other", () => {
    for (const key of Object.keys(report())) expectMutationFails(ContextReport, report(), (r) => delete r[key], key);
    expectMutationFails(ContextReport, report(), (r) => { r.extra = 1; }, "", "Unrecognized key");
  });
});

describe("WeekContext", () => {
  it("accepts a week with findings, and a week with none", () => {
    expectValid(WeekContext, week());
    expectValid(WeekContext, { findings: [], rung_changes: [], setbacks: [], field_counts: fieldCounts() });
    expect(Object.keys(WeekContext.shape)).toEqual(["findings", "rung_changes", "setbacks", "field_counts"]);
    expect(Object.keys(WeekFinding.shape)).toEqual(["id", "title", "field", "kind", "significance", "rung"]);
    expectTypeOf<WeekContextType["setbacks"]>().toEqualTypeOf<string[]>();
    expectTypeOf<WeekContextType["rung_changes"][number]["to"]>().toEqualTypeOf<Rung>();
  });

  it("needs every key, with no null, and refuses any other", () => {
    for (const key of ["findings", "rung_changes", "setbacks", "field_counts"]) {
      expectMutationFails(WeekContext, week(), (w) => delete w[key], key);
      expectMutationFails(WeekContext, week(), (w) => { w[key] = null; }, key);
    }
    expectMutationFails(WeekContext, week(), (w) => { w.extra = 1; }, "", "Unrecognized key");
  });

  it("lists each finding with its field, kind, significance and rung", () => {
    for (const key of ["id", "title", "field", "kind", "significance", "rung"]) {
      expectMutationFails(WeekContext, week(), (w) => delete w.findings[0][key], `findings.0.${key}`);
    }
    expectMutationFails(WeekContext, week(), (w) => { w.findings[0].kind = "idea"; }, "findings.0.kind");
    expectMutationFails(WeekContext, week(), (w) => { w.findings[0].rung = "proven"; }, "findings.0.rung");
    expectMutationFails(WeekContext, week(), (w) => { w.findings[0].extra = 1; }, "findings.0", "Unrecognized key");
  });

  it("shows the rung changes as a brief does, and the setbacks as finding ids", () => {
    expectMutationFails(WeekContext, week(), (w) => { w.rung_changes[0].by = "editor"; }, "rung_changes.0.by");
    expectMutationFails(WeekContext, week(), (w) => { w.rung_changes[0].to = "proven"; }, "rung_changes.0.to");
    expectMutationFails(WeekContext, week(), (w) => { w.rung_changes[0].date = "2026-11-31"; }, "rung_changes.0.date");
    expectMutationFails(WeekContext, week(), (w) => { w.setbacks = ["chem-26-4"]; }, "setbacks.0");
  });

  it("has one count row for each field, in the order of the fields", () => {
    expectMutationFails(WeekContext, week(), (w) => { w.field_counts.pop(); }, "field_counts", "exactly");
    expectMutationFails(WeekContext, week(), (w) => { w.field_counts.reverse(); }, "field_counts", "in that order");
    expectMutationFails(WeekContext, week(), (w) => { w.field_counts[0].counted = 2; }, "field_counts.0.counted", "at most reported");
  });
});

describe("RungProposal", () => {
  it("accepts a proposal with every value, and one with none of the optional ones", () => {
    expectValid(RungProposal, proposal());
    expectValid(RungProposal, { ...proposal(), to: null, date: null, url: null });
    expect(Object.keys(RungProposal.shape)).toEqual(["finding_id", "kind", "to", "date", "url", "note"]);
    expectTypeOf<RungProposalType["kind"]>().toEqualTypeOf<ProposalKind>();
    expectTypeOf<RungProposalType["to"]>().toEqualTypeOf<Rung | null>();
    expectTypeOf<RungProposalType["date"]>().toEqualTypeOf<string | null>();
    expectTypeOf<RungProposalType["url"]>().toEqualTypeOf<string | null>();
  });

  it("names one of the seven things a check can find", () => {
    expect([...PROPOSAL_KINDS]).toEqual([
      "retraction", "expression_of_concern", "journal_version", "correction", "trial_change", "source_missing", "source_changed",
    ]);
    for (const kind of PROPOSAL_KINDS) expectValid(RungProposal, { ...proposal(), kind });
    expectMutationFails(RungProposal, proposal(), (p) => { p.kind = "withdrawal"; }, "kind");
  });

  it("needs every key, and allows null only for to, date and url", () => {
    for (const key of Object.keys(proposal())) {
      expectMutationFails(RungProposal, proposal(), (p) => delete p[key], key);
      if (!["to", "date", "url"].includes(key)) expectMutationFails(RungProposal, proposal(), (p) => { p[key] = null; }, key);
    }
    expectMutationFails(RungProposal, proposal(), (p) => { p.extra = 1; }, "", "Unrecognized key");
  });

  it("takes a rung, a full date and a non-empty address", () => {
    expectMutationFails(RungProposal, proposal(), (p) => { p.to = "proven"; }, "to");
    expectMutationFails(RungProposal, proposal(), (p) => { p.date = "2026-11"; }, "date");
    expectMutationFails(RungProposal, proposal(), (p) => { p.date = "2026-02-30"; }, "date");
    expectMutationFails(RungProposal, proposal(), (p) => { p.url = ""; }, "url");
    expectMutationFails(RungProposal, proposal(), (p) => { p.finding_id = "new-1"; }, "finding_id");
  });

  it("holds a note of at most 300 characters", () => {
    expectValid(RungProposal, { ...proposal(), note: "n".repeat(300) });
    expectMutationFails(RungProposal, proposal(), (p) => { p.note = "n".repeat(301); }, "note");
    expectMutationFails(RungProposal, proposal(), (p) => { p.note = ""; }, "note");
  });
});

describe("The config a context copies", () => {
  it("accepts a standing story, with no finding or with several", () => {
    const story = context().standing_stories[0]!;
    expectValid(ContextStory, story);
    expectValid(ContextStory, { ...story, finding_ids: [] });
    expect(Object.keys(ContextStory.shape)).toEqual(["id", "finding_ids", "rule"]);
    expectOnlyIssue(ContextStory, { ...story, id: "Erdos Problems" }, "id");
    expectOnlyIssue(ContextStory, { ...story, rule: "" }, "rule");
    expectOnlyIssue(ContextStory, { ...story, finding_ids: ["new-1"] }, "finding_ids.0");
    expectOnlyIssue(ContextStory, { ...story, extra: 1 }, "", "Unrecognized key");
  });

  it("accepts a field with its subfields, none or several", () => {
    const field = contextConfig().fields[0]!;
    expectValid(ContextField, field);
    expectValid(ContextField, { ...field, subfields: [] });
    expect(Object.keys(ContextField.shape)).toEqual(["id", "subfields"]);
    expect(Object.keys(ContextField.shape.subfields.element.shape)).toEqual(["id", "name"]);
    expectOnlyIssue(ContextField, { ...field, id: "maths" }, "id");
    expectOnlyIssue(ContextField, { ...field, subfields: [{ id: "Proofs", name: "Proofs" }] }, "subfields.0.id");
    expectOnlyIssue(ContextField, { ...field, subfields: [{ id: "proofs", name: "" }] }, "subfields.0.name");
    expectOnlyIssue(ContextField, { ...field, subfields: [{ id: "proofs", name: "Proofs", extra: 1 }] }, "subfields.0", "Unrecognized key");
  });

  it("accepts a source kind with its label and its meaning", () => {
    const kind = contextConfig().source_kinds[0]!;
    expectValid(ContextSourceKind, kind);
    expect(Object.keys(ContextSourceKind.shape)).toEqual(["id", "label", "means"]);
    expectOnlyIssue(ContextSourceKind, { ...kind, id: "article" }, "id");
    expectOnlyIssue(ContextSourceKind, { ...kind, label: "" }, "label");
    expectOnlyIssue(ContextSourceKind, { ...kind, means: "" }, "means");
  });

  it("accepts a publisher with at least one host and one source kind", () => {
    const publisher = contextConfig().allowlist[0]!;
    expectValid(ContextPublisher, publisher);
    expect(Object.keys(ContextPublisher.shape)).toEqual(["id", "name", "hosts", "kinds"]);
    expectOnlyIssue(ContextPublisher, { ...publisher, hosts: [] }, "hosts", "at least one host");
    expectOnlyIssue(ContextPublisher, { ...publisher, kinds: [] }, "kinds", "at least one source kind");
    expectOnlyIssue(ContextPublisher, { ...publisher, kinds: ["article"] }, "kinds.0");
    expectOnlyIssue(ContextPublisher, { ...publisher, hosts: [""] }, "hosts.0");
    expectOnlyIssue(ContextPublisher, { ...publisher, id: "arXiv" }, "id");
  });

  it("accepts the whole config, with every list possibly empty", () => {
    expectValid(ContextConfig, contextConfig());
    expectValid(ContextConfig, { hype_words: [], jargon: [], field_cap: 0, fields: [], source_kinds: [], allowlist: [] });
    expect(Object.keys(ContextConfig.shape)).toEqual(["hype_words", "jargon", "field_cap", "fields", "source_kinds", "allowlist"]);
  });

  it("needs every key of the config, with no null, and refuses any other", () => {
    for (const key of Object.keys(contextConfig())) {
      expectMutationFails(ContextConfig, contextConfig(), (c) => delete c[key], key);
      expectMutationFails(ContextConfig, contextConfig(), (c) => { c[key] = null; }, key);
    }
    expectMutationFails(ContextConfig, contextConfig(), (c) => { c.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(ContextConfig, contextConfig(), (c) => { c.hype_words = [""]; }, "hype_words.0");
    expectMutationFails(ContextConfig, contextConfig(), (c) => { c.field_cap = -1; }, "field_cap");
    expectMutationFails(ContextConfig, contextConfig(), (c) => { c.allowlist[0].hosts = []; }, "allowlist.0.hosts");
  });

  it("accepts the pack's paths and state", () => {
    const state = context().pack;
    expectValid(ContextPack, state);
    expectValid(ContextPack, { ...state, degraded: true, failed_feeds: ["nature", "arxiv"] });
    expect(Object.keys(ContextPack.shape)).toEqual(["md", "json", "degraded", "failed_feeds"]);
    expectOnlyIssue(ContextPack, { ...state, md: "" }, "md");
    expectOnlyIssue(ContextPack, { ...state, failed_feeds: ["Nature"] }, "failed_feeds.0");
    expectOnlyIssue(ContextPack, { ...state, degraded: "no" }, "degraded");
    expectOnlyIssue(ContextPack, { ...state, extra: 1 }, "", "Unrecognized key");
  });
});

describe("AgentContext", () => {
  it("accepts a weekday context, a Monday's with its week and a Sunday's with its candidates", () => {
    expectValid(AgentContext, context());
    expectValid(AgentContext, mondayContext());
    expectValid(AgentContext, sundayContext());
  });

  it("accepts a context for a quiet day, with every list empty", () => {
    expectValid(AgentContext, {
      ...context(), candidates: [], recent_findings: [], rung_proposals: [], corrections: { flagged: [] }, reports: [],
      standing_stories: [], pace: { ...context().pace, quotable: {} },
      config: { hype_words: [], jargon: [], field_cap: 2, fields: [], source_kinds: [], allowlist: [] },
    });
  });

  it("keeps the keys in the spec's order", () => {
    expect(Object.keys(AgentContext.shape)).toEqual(CONTEXT_KEYS);
    const shuffled = Object.fromEntries(Object.entries(context()).reverse());
    expect(Object.keys(AgentContext.parse(shuffled))).toEqual(CONTEXT_KEYS);
    expect(JSON.parse(jsonText(shuffled, AgentContext)).date).toBe("2026-11-24");
  });

  it("has the types the spec gives", () => {
    expectTypeOf<AgentContextType["format"]>().toEqualTypeOf<"daily" | "monday_review" | "sunday_deep_dive">();
    expectTypeOf<AgentContextType["week"]>().toEqualTypeOf<WeekContextType | null>();
    expectTypeOf<AgentContextType["ledger_for_sunday"]>().toEqualTypeOf<LedgerCandidateType[]>();
    expectTypeOf<AgentContextType["reports"]>().toEqualTypeOf<ContextReportType[]>();
    expectTypeOf<AgentContextType["rung_proposals"]>().toEqualTypeOf<RungProposalType[]>();
    expectTypeOf<AgentContextType["budgets"]>().toEqualTypeOf<ContextBudgetsType>();
    expectTypeOf<AgentContextType["corrections"]["flagged"][number]["code"]>().toEqualTypeOf<"DUAL_USE" | "BLOCKED_HOST">();
    expectTypeOf<AgentContextType["pace"]["quotable"]>().toEqualTypeOf<Record<string, string>>();
  });

  it("needs every key, and allows null only for the week", () => {
    for (const key of CONTEXT_KEYS) expectMutationFails(AgentContext, context(), (c) => delete c[key], key);
    for (const key of CONTEXT_KEYS.filter((k) => k !== "week")) {
      expectMutationFails(AgentContext, context(), (c) => { c[key] = null; }, key);
    }
    expectMutationFails(AgentContext, context(), (c) => { c.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(AgentContext, context(), (c) => { c.schema_version = 1; }, "", "Unrecognized key");
  });

  it("refuses an unknown key inside it", () => {
    const places: [(c: any) => void, string][] = [
      [(c) => { c.window.extra = 1; }, "window"],
      [(c) => { c.budgets.extra = 1; }, "budgets"],
      [(c) => { c.candidates[0].extra = 1; }, "candidates.0"],
      [(c) => { c.pace.extra = 1; }, "pace"],
      [(c) => { c.recent_findings[0].extra = 1; }, "recent_findings.0"],
      [(c) => { c.rung_proposals[0].extra = 1; }, "rung_proposals.0"],
      [(c) => { c.corrections.extra = []; }, "corrections"],
      [(c) => { c.reports[0].extra = 1; }, "reports.0"],
      [(c) => { c.standing_stories[0].extra = 1; }, "standing_stories.0"],
      [(c) => { c.pack.extra = 1; }, "pack"],
      [(c) => { c.config.extra = 1; }, "config"],
    ];
    for (const [mutate, path] of places) expectMutationFails(AgentContext, context(), mutate, path, "Unrecognized key");
  });

  it("takes a real date, a window and a deadline with an offset", () => {
    expectMutationFails(AgentContext, context(), (c) => { c.date = "2026-02-30"; }, "date");
    expectMutationFails(AgentContext, context(), (c) => { c.deadline = "2026-11-24T04:15:00"; }, "deadline");
    expectMutationFails(AgentContext, context(), (c) => { c.window.end = c.window.start; }, "window.end", "ends after it starts");
  });

  it("has the format of its date's weekday", () => {
    expectMutationFails(AgentContext, context(), (c) => { c.format = "monday_review"; }, "format", "The format of 2026-11-24 is daily");
    expectMutationFails(AgentContext, context(), (c) => { c.format = "sunday_deep_dive"; }, "format", "is daily");
    expectMutationFails(AgentContext, mondayContext(), (c) => { c.format = "daily"; }, "format", "The format of 2026-11-23 is monday_review");
    expectMutationFails(AgentContext, sundayContext(), (c) => { c.format = "daily"; }, "format", "The format of 2026-11-22 is sunday_deep_dive");
    expectMutationFails(AgentContext, context(), (c) => { c.format = "weekly"; }, "format");
  });

  it("has a week exactly on a Monday", () => {
    expectMutationFails(AgentContext, mondayContext(), (c) => { c.week = null; }, "week", "A Monday's context has its week");
    expectMutationFails(AgentContext, context(), (c) => { c.week = week(); }, "week", "Only a Monday's context has a week");
    expectMutationFails(AgentContext, sundayContext(), (c) => { c.week = week(); }, "week", "Only a Monday's context has a week");
    expectMutationFails(AgentContext, mondayContext(), (c) => { c.week.field_counts.pop(); }, "week.field_counts", "exactly");
  });

  it("has candidates for the deep dive only on a Sunday, and at most ten", () => {
    expectMutationFails(AgentContext, context(), (c) => { c.ledger_for_sunday = [ledger()]; }, "ledger_for_sunday", "Only a Sunday's context");
    expectMutationFails(AgentContext, mondayContext(), (c) => { c.ledger_for_sunday = [ledger()]; }, "ledger_for_sunday", "Only a Sunday's context");
    expectValid(AgentContext, { ...sundayContext(), ledger_for_sunday: [] });
    const many = (n: number) => Array.from({ length: n }, (_, i) => ledger(i + 1));
    expect(LEDGER_CANDIDATES_MAX).toBe(10);
    expectValid(AgentContext, { ...sundayContext(), ledger_for_sunday: many(10) });
    expectMutationFails(AgentContext, sundayContext(), (c) => { c.ledger_for_sunday = many(11); }, "ledger_for_sunday", "At most 10 candidates");
    expectMutationFails(AgentContext, sundayContext(), (c) => { c.ledger_for_sunday[0].reasons = []; }, "ledger_for_sunday.0.reasons");
  });

  it("lists each candidate once", () => {
    expectMutationFails(AgentContext, context(), (c) => { c.candidates[1] = c.candidates[0]; }, "candidates.1.id", "appears twice");
    const issues = issuesOf(AgentContext, { ...context(), candidates: [wrappedCandidate(1), wrappedCandidate(1), wrappedCandidate(1)] });
    expect(issues.map((i) => i.path)).toEqual(["candidates.1.id", "candidates.2.id"]);
  });

  it("reports a problem inside a part at that part's path", () => {
    expectMutationFails(AgentContext, context(), (c) => { c.budgets.typical_findings = [6, 4]; }, "budgets.typical_findings");
    expectMutationFails(AgentContext, context(), (c) => { c.candidates[0].fields = []; }, "candidates.0.fields");
    expectMutationFails(AgentContext, context(), (c) => { c.pace.sentence = ""; }, "pace.sentence");
    expectMutationFails(AgentContext, context(), (c) => { c.recent_findings[0].rung = "proven"; }, "recent_findings.0.rung");
    expectMutationFails(AgentContext, context(), (c) => { c.rung_proposals[0].kind = "withdrawal"; }, "rung_proposals.0.kind");
    expectMutationFails(AgentContext, context(), (c) => { c.reports[0].finding_id = "bio-2026-0001"; }, "reports.0.finding.id");
    expectMutationFails(AgentContext, context(), (c) => { c.standing_stories[0].rule = ""; }, "standing_stories.0.rule");
    expectMutationFails(AgentContext, context(), (c) => { c.pack.failed_feeds = ["Nature"]; }, "pack.failed_feeds.0");
    expectMutationFails(AgentContext, context(), (c) => { c.config.field_cap = -1; }, "config.field_cap");
  });

  it("names the record a flagged correction is about, exactly one", () => {
    expectMutationFails(AgentContext, context(), (c) => { c.corrections.flagged[0].edition_date = "2026-11-20"; }, "corrections.flagged.0", "Exactly one");
    expectMutationFails(
      AgentContext, context(), (c) => { c.corrections.flagged[0].finding_id = null; }, "corrections.flagged.0", "Exactly one",
    );
    expectMutationFails(AgentContext, context(), (c) => { c.corrections.flagged[0].code = "WORDS"; }, "corrections.flagged.0.code");
    expectValid(AgentContext, {
      ...context(), corrections: { flagged: [{ finding_id: null, edition_date: null, term_id: "virtual-unwrapping", path: "definition", code: "BLOCKED_HOST" }] },
    });
  });
});

describe("The pack, the rung watch file and the context as JSON Schema", () => {
  it("generate without a transform or any type JSON Schema cannot show", () => {
    for (const schema of [Pack, RungWatchFile, AgentContext]) {
      expect(() => z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "throw" })).not.toThrow();
    }
  });

  it("require every key of the pack and refuse any other", () => {
    const schema = z.toJSONSchema(Pack, { target: "draft-2020-12", unrepresentable: "throw" }) as any;
    expect(schema.required).toEqual(PACK_KEYS);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.candidates.items.required).toEqual(CANDIDATE_KEYS);
  });
});

describe("lib/schema/index.ts, the barrel over every schema file", () => {
  const dir = fileURLToPath(new URL("../lib/schema/", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts").sort();
  const barrel = schemaIndex as Record<string, unknown>;

  it("finds the schema files, so a file added later is checked too", () => {
    for (const name of ["common", "finding", "draft", "brief", "draft-zh", "metrics", "status", "glossary", "misc", "registry", "pack", "context"]) {
      expect(files, name).toContain(`${name}.ts`);
    }
  });

  for (const file of files) {
    it(`re-exports everything ${file} exports, as the same value`, async () => {
      const exports: Record<string, unknown> = await import(/* @vite-ignore */ `${dir}${file}`);
      const names = Object.keys(exports);
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => barrel[n] !== exports[n])).toEqual([]);
    });
  }

  it("holds the schemas the validator and the loaders import by name", () => {
    for (const name of ["L10n", "Finding", "Brief", "DraftBrief", "DraftZh", "ZhContext", "Pack", "AgentContext", "MetricsFile", "StatusFile", "CorrectionsFile"]) {
      expect(schemaIndex, name).toHaveProperty(name);
    }
  });
});
