// lib/schema/common.ts (SPEC §4.1, §4.3): the id formats, dates, numbers, `L10n`, the vocabulary enums and the objects
// findings and briefs share. Each schema has a valid value and one failing value for each constraint; inline data.

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { L10n as I18nL10n } from "@/lib/i18n";
import * as vocab from "@/lib/vocab";
import {
  AiConfidence, AiInfo, AiInfoBase, AiRole, Artefacts, BriefSource, BriefSourceId, CommitSha, ConfigId, CorrectionId, CorrectionPath,
  CounterId, Count, DATA_STATUS, DataStatus, Doi, DraftBriefSource, DraftFindingSource, DraftSource, Edition, ErrorCode,
  FIGURE_LICENCES, FieldId, Figure, FigureLicence, FindingId, FindingKind, FindingSource, FindingSourceId, Format, Fraction,
  FractionInterval, HttpsUrl, ID_PATTERNS, Interval, IsoDate, IsoTimestamp, L10n, MetricPath, NewRef, PATH_MAX, PublishedAt,
  Reaction, ReportId, ReportKind, RorId, RUNG_BY, Rung, RungBy, RungEntry, RuleCode, RunId, SEEN_AS, SeenAs, Sha256,
  Significance, Source, SourceId, SourceKind, SubfieldId, TERM_ID_MAX, TermId, Who, realDates, refs, uniqueArray, words,
} from "@/lib/schema/common";
import type { Figure as FigureType, RungEntry as RungEntryType, Source as SourceType } from "@/lib/schema/common";
import { copy, expectIssue, expectMutationFails, expectOnlyIssue, expectValid, issuesOf } from "./helpers/zod-issues";

const sha = "a".repeat(64);
const commit = "0123456789abcdef0123456789abcdef01234567";

describe("id and code formats", () => {
  const cases: [string, z.ZodType, string[], string[]][] = [
    ["FindingId", FindingId, ["math-2026-0142", "hum-2015-0001", "earth-2030-9999"],
      ["math-2026-142", "MATH-2026-0142", "history-2026-0001", "phys-26-0001", "bio-2026-00001", " bio-2026-0001", "bio-2026-0001\n"]],
    ["NewRef", NewRef, ["new-1", "new-12"], ["new-0", "new-", "new-01", "New-1", "new-1a"]],
    ["TermId", TermId, ["virtual-unwrapping", "crispr", "x2", "a".repeat(TERM_ID_MAX)],
      ["Virtual-Unwrapping", "virtual--unwrapping", "-x", "x-", "virtual_unwrapping", "a".repeat(TERM_ID_MAX + 1), ""]],
    ["CorrectionId", CorrectionId, ["C-0001", "C-9999"], ["C-001", "c-0001", "C-00001", "R-0001"]],
    ["ReportId", ReportId, ["R-0001", "R-0420"], ["R-1", "D-0001", "r-0001"]],
    ["SourceId", SourceId, ["s1", "b12", "s10"], ["s0", "s01", "x1", "S1", "s", "1s"]],
    ["FindingSourceId", FindingSourceId, ["s1", "s23"], ["b1", "s0", "s"]],
    ["BriefSourceId", BriefSourceId, ["b1", "b23"], ["s1", "b0", "b"]],
    ["ConfigId", ConfigId, ["nature", "ancient-texts", "a1", "0x"], ["-a", "A", "a_b", "a b", ""]],
    ["SubfieldId", SubfieldId, ["proteins", "ancient-texts"], ["Proteins", "ancient texts", "_x"]],
    ["CounterId", CounterId, ["erdos_ai", "pdb_structures", "a"], ["Erdos", "1abc", "erdos-ai", "_a", ""]],
    ["Doi", Doi, ["10.1126/science.adk1234", "10.1038/s41586-026-00001-0", "10.12345678/x"],
      ["https://doi.org/10.1126/x", "10.126/x", "10.1126/", "doi:10.1126/x", "10.1126/Science.ADK1234", "10.1126/a b"]],
    ["RorId", RorId, ["05gq02987", "0abcdefg1"], ["15gq02987", "05gq0298", "05GQ02987", "05gq029870"]],
    ["RunId", RunId, ["20261123-031512"], ["2026-11-23", "20261123", "20261123-03151"]],
    ["ErrorCode", ErrorCode, ["E_AUTH", "E_ZH", "E_METRICS"], ["e_auth", "E-AUTH", "AUTH", "E_"]],
    ["RuleCode", RuleCode, ["WORDS", "DUAL_USE", "ZH_NO_DASH", "A1"], ["words", "_X", "1A", ""]],
    ["CommitSha", CommitSha, [commit], [commit.slice(1), commit.toUpperCase(), `${commit}0`]],
    ["Sha256", Sha256, [sha], [sha.slice(1), sha.toUpperCase(), `${sha}0`, "g".repeat(64)]],
    ["CorrectionPath", CorrectionPath, ["title", "explainer.how_sure", "lead.1.text", "sources.0.url", "ai.role", "a".repeat(PATH_MAX)],
      ["Title", "explainer..x", ".title", "explainer.", "lead.1.Text", "a".repeat(PATH_MAX + 1), "1.title", ""]],
    ["MetricPath", MetricPath, ["pace.leading.pooled.window", "hold", "landmarks.this_year"], ["Pace", "pace..x", "pace.", ""]],
  ];
  it.each(cases)("%s accepts its format and nothing else", (_name, schema, good, bad) => {
    for (const value of good) expectValid(schema, value);
    for (const value of bad) expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse(7).success).toBe(false);
  });

  it("names the expected shape in the message", () => {
    expectIssue(FindingId, "math-2026-142", "", "math-2026-0142");
    expectIssue(CorrectionId, "C-1", "", "C-0001");
    expectIssue(Doi, "10.1126/ABC", "", "lower case");
    expectIssue(TermId, "a".repeat(TERM_ID_MAX + 1), "", "at most 60");
  });

  it("holds the artefact formats as patterns that the ARTEFACT_FORMAT rule reads", () => {
    const patterns: [RegExp, string[], string[]][] = [
      [ID_PATTERNS.arxiv, ["2501.01234", "2501.01234v2", "0704.0001"], ["250.01234", "2501.123", "2501.01234v", "arXiv:2501.01234"]],
      [ID_PATTERNS.trial, ["NCT01234567"], ["NCT0123456", "nct01234567", "NCT012345678"]],
      [ID_PATTERNS.pdb, ["1abc", "7xyz", "pdb_00001abc"], ["abc1", "1ab", "1abcd", "pdb_1abc", "PDB_00001ABC"]],
      [ID_PATTERNS.doi, ["10.1126/science.adk1234"], ["https://doi.org/10.1126/x", "10.1126"]],
    ];
    for (const [re, good, bad] of patterns) {
      for (const value of good) expect(re.test(value), value).toBe(true);
      for (const value of bad) expect(re.test(value), value).toBe(false);
    }
  });

  it("builds the finding id and archive ref patterns from the field codes", () => {
    for (const code of vocab.FIELD_CODES) expect(ID_PATTERNS.finding.test(`${code}-2026-0001`)).toBe(true);
    expect(ID_PATTERNS.finding.test("xyz-2026-0001")).toBe(false);
    expect(ID_PATTERNS.archiveRef.test("bio-2026-0001")).toBe(true);
    expect(ID_PATTERNS.archiveRef.test("2026-11-23/brief")).toBe(true);
    expect(ID_PATTERNS.archiveRef.test("2026-11-23/item")).toBe(false);
  });
});

describe("dates and timestamps", () => {
  it("IsoDate accepts real calendar dates only", () => {
    for (const d of ["2026-11-23", "2024-02-29", "2015-01-05"]) expectValid(IsoDate, d);
    for (const d of ["2026-02-30", "2026-13-01", "2026-1-1", "20261123", "2026-11-23T00:00:00Z", "", "2025-02-29"]) {
      expect(IsoDate.safeParse(d).success, d).toBe(false);
    }
    expectIssue(IsoDate, "2026-02-30", "", "real calendar date");
    expectIssue(IsoDate, "23 Nov 2026", "", "YYYY-MM-DD");
    // the shape is anchored at both ends: text around a date is a shape error, with that one issue and no other
    for (const d of ["x2026-11-23", "2026-11-23x", " 2026-11-23", "2026-11-23 ", "2026-11-23\n"]) expectOnlyIssue(IsoDate, d, "", "YYYY-MM-DD");
    expect(IsoDate.safeParse(20261123).success).toBe(false);
    expect(IsoDate.safeParse(null).success).toBe(false);
  });

  it("IsoTimestamp needs a real instant with an offset", () => {
    const good = ["2026-11-23T03:15:12+08:00", "2026-11-23T03:15+08:00", "2026-11-22T19:15:12Z", "2026-11-23T03:15:12.123456789-05:00"];
    for (const t of good) expectValid(IsoTimestamp, t);
    const bad = [
      "2026-11-23", "2026-11-23T03:15:12", "2026-02-30T00:00:00Z", "2026-11-23T24:00:00Z", "2026-11-23T03:60:00Z",
      "2026-11-23T03:15:60Z", "2026-11-23T03:15:12+15:00", "2026-11-23 03:15:12+08:00", "2026-11-23T03:15:12+08:60",
    ];
    for (const t of bad) expect(IsoTimestamp.safeParse(t).success, t).toBe(false);
    expectIssue(IsoTimestamp, "2026-11-23T03:15:12", "", "offset");
    expectIssue(IsoTimestamp, "2026-02-30T00:00:00Z", "", "real timestamp");
  });

  it("IsoTimestamp takes the last instant of a day and the offsets of the world, and no more", () => {
    // The newest hour, minute and second, the oldest, and the offsets from -12:00 to +14:00 (Kiribati's, the greatest).
    for (const t of [
      "2026-11-23T23:59:59+08:00", "2026-11-23T00:00:00Z", "2026-11-23T00:00+08:00", "2026-11-23T23:59:59.999Z",
      "2026-11-23T10:30:00+14:00", "2026-11-23T10:30:00-14:00", "2026-11-23T10:30:00-12:00", "2026-11-23T10:30:00+05:45",
      "2026-11-23T10:30:00+00:59", "2026-11-23T10:30:00-00:59",
      "2024-02-29T12:00:00Z",
    ]) expectValid(IsoTimestamp, t);
    // One step past each limit: an offset beyond 14:00 names no zone, and 24:00 is not part of the day.
    for (const t of [
      "2026-11-23T10:30:00+14:01", "2026-11-23T10:30:00-14:01", "2026-11-23T10:30:00+14:30", "2026-11-23T10:30:00+23:59",
      "2026-11-23T24:00:00+08:00", "2026-11-23T24:00:00Z", "2026-11-23T10:30:00+08:00 ", " 2026-11-23T10:30:00+08:00",
      "2026-11-23T10:30:00+8:00", "2026-11-23T10:30:00+0800", "2026-11-23t10:30:00z", "2025-02-29T12:00:00Z", "2026-11-31T12:00:00Z",
    ]) expect(IsoTimestamp.safeParse(t).success, t).toBe(false);
    expect(IsoTimestamp.safeParse(1795000000).success).toBe(false);
    expect(IsoTimestamp.safeParse(null).success).toBe(false);
  });

  it("PublishedAt is a timestamp, a bare date or null, never anything else", () => {
    for (const v of ["2026-11-23T03:15:12+08:00", "2026-10-01", null]) expectValid(PublishedAt, v);
    for (const v of ["yesterday", "2026", "2026-10-32", 20261001, undefined]) expect(PublishedAt.safeParse(v).success, String(v)).toBe(false);
  });

  it("realDates tells a refinement whether date arithmetic is safe", () => {
    expect(realDates("2026-11-23", "2024-02-29")).toBe(true);
    expect(realDates("2026-11-23", "2026-02-30")).toBe(false);
    expect(realDates("not a date")).toBe(false);
    expect(realDates()).toBe(true);
  });
});

describe("numbers and helpers", () => {
  it("Count is a non-negative integer", () => {
    for (const v of [0, 1, 5000]) expectValid(Count, v);
    for (const v of [-1, 1.5, "1", null, Number.NaN, Infinity]) expect(Count.safeParse(v).success, String(v)).toBe(false);
  });

  it("Fraction is in [0, 1] to at most 4 decimal places", () => {
    for (const v of [0, 1, 0.0841, 0.5, 0.0001, 0.9999]) expectValid(Fraction, v);
    for (const v of [-0.1, 1.0001, "0.5", null]) expect(Fraction.safeParse(v).success, String(v)).toBe(false);
    expectIssue(Fraction, 0.08412, "", "4 decimal places");
    expectIssue(Fraction, 0.00001, "", "4 decimal places");
  });

  it("Interval is [lo, hi] with lo <= hi", () => {
    for (const v of [[1, 2], [2, 2], [-1, 0.5]]) expectValid(Interval, v);
    for (const v of [[2, 1], [1], [1, 2, 3], ["a", "b"]]) expect(Interval.safeParse(v).success, JSON.stringify(v)).toBe(false);
    expectIssue(Interval, [2, 1], "", "lo <= hi");
  });

  it("FractionInterval holds fractions in order", () => {
    for (const v of [[0, 1], [0.0841, 0.0958], [0.5, 0.5]]) expectValid(FractionInterval, v);
    for (const v of [[0.9, 0.1], [0, 1.5], [0.00001, 0.5], [-0.1, 0.5]]) expect(FractionInterval.safeParse(v).success, JSON.stringify(v)).toBe(false);
  });

  it("uniqueArray refuses a repeat", () => {
    const schema = uniqueArray(z.string(), "names");
    expectValid(schema, ["a", "b"]);
    expectValid(schema, []);
    expectIssue(schema, ["a", "b", "a"], "", "names must not repeat");
  });

  it("words and refs carry their help for the JSON Schema the agent reads", () => {
    expect(words("At most 25 words").description).toBe("At most 25 words");
    expectValid(words("x"), "any text");
    expect(words("x").safeParse("").success).toBe(false);
    expect(refs("source ids").description).toBe("source ids");
    expectValid(refs("x"), ["s1", "s2"]);
    expect(refs("x").safeParse([1]).success).toBe(false);
  });

  it("HttpsUrl needs the https scheme", () => {
    expectValid(HttpsUrl, "https://example.org/a?b=1");
    for (const v of ["http://example.org", "example.org", "ftp://example.org", "", "https://"]) {
      expect(HttpsUrl.safeParse(v).success, v).toBe(false);
    }
    expectIssue(HttpsUrl, "http://example.org", "", "https URL");
    // Only a bad format gets that message: a number is told what a string is, not what an https URL is.
    expect(issuesOf(HttpsUrl, 5)[0]?.message).not.toContain("https URL");
    expect(issuesOf(HttpsUrl, null)[0]?.message).not.toContain("https URL");
  });
});

describe("vocabulary enums", () => {
  it("each enum lists exactly its vocabulary", () => {
    const pairs: [string, readonly string[], readonly string[]][] = [
      ["FieldId", FieldId.options, vocab.FIELDS],
      ["FindingKind", FindingKind.options, vocab.FINDING_KINDS],
      ["Rung", Rung.options, vocab.ALL_RUNGS],
      ["AiRole", AiRole.options, vocab.AI_ROLES],
      ["AiConfidence", AiConfidence.options, vocab.AI_CONFIDENCE],
      ["Significance", Significance.options, vocab.SIGNIFICANCE],
      ["SourceKind", SourceKind.options, vocab.SOURCE_KINDS],
      ["Edition", Edition.options, vocab.EDITIONS],
      ["Format", Format.options, vocab.FORMATS],
      ["ReportKind", ReportKind.options, vocab.REPORT_KINDS],
      ["SeenAs", SeenAs.options, SEEN_AS],
      ["RungBy", RungBy.options, RUNG_BY],
      ["FigureLicence", FigureLicence.options, FIGURE_LICENCES],
      ["DataStatus", DataStatus.options, DATA_STATUS],
    ];
    for (const [name, options, tuple] of pairs) expect([...options], name).toEqual([...tuple]);
  });

  it("a finding's kind is never idea, and a rung may be one that fell", () => {
    expect(FindingKind.safeParse("idea").success).toBe(false);
    expect(FindingKind.safeParse("setback").success).toBe(true);
    for (const r of ["claimed", "preprint", "checked", "confirmed", "applied", "disputed", "retracted"]) expectValid(Rung, r);
    expect(Rung.safeParse("verified").success).toBe(false);
    expect(Rung.safeParse("Checked").success).toBe(false);
  });

  it("the run vocabularies of this file are fixed", () => {
    expect([...SEEN_AS]).toEqual(["pack", "fetched", "search", "seed"]);
    expect([...RUNG_BY]).toEqual(["agent", "script", "seed"]);
    expect([...FIGURE_LICENCES]).toEqual(["CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0", "public-domain"]);
    expect([...DATA_STATUS]).toEqual(["ok", "stale", "missing"]);
  });

  it("the inferred types are the vocabulary's own", () => {
    expectTypeOf<z.infer<typeof FieldId>>().toEqualTypeOf<vocab.FieldId>();
    expectTypeOf<z.infer<typeof FindingKind>>().toEqualTypeOf<vocab.FindingKind>();
    expectTypeOf<z.infer<typeof Rung>>().toEqualTypeOf<vocab.Rung>();
    expectTypeOf<z.infer<typeof AiRole>>().toEqualTypeOf<vocab.AiRole>();
    expectTypeOf<z.infer<typeof AiConfidence>>().toEqualTypeOf<vocab.AiConfidence>();
    expectTypeOf<z.infer<typeof Significance>>().toEqualTypeOf<vocab.Significance>();
    expectTypeOf<z.infer<typeof SourceKind>>().toEqualTypeOf<vocab.SourceKind>();
    expectTypeOf<z.infer<typeof Edition>>().toEqualTypeOf<vocab.Edition>();
    expectTypeOf<z.infer<typeof Format>>().toEqualTypeOf<vocab.Format>();
    expectTypeOf<z.infer<typeof ReportKind>>().toEqualTypeOf<vocab.ReportKind>();
    expectTypeOf<RungEntryType["by"]>().toEqualTypeOf<"agent" | "script" | "seed">();
    expectTypeOf<SourceType["seen_as"]>().toEqualTypeOf<"pack" | "fetched" | "search" | "seed">();
    expectTypeOf<FigureType["licence"]>().toEqualTypeOf<"CC-BY-4.0" | "CC-BY-SA-4.0" | "CC0-1.0" | "public-domain">();
  });
});

describe("L10n", () => {
  it("holds English and Chinese, with zh null only where no Chinese exists", () => {
    expectValid(L10n, { en: "A sample", zh: "範例" });
    expectValid(L10n, { en: "A sample", zh: null });
  });

  it("refuses every other shape", () => {
    const bad: unknown[] = [
      { en: "A sample" }, { en: "A sample", zh: undefined }, { en: "", zh: "範例" }, { en: "A sample", zh: "" }, { en: null, zh: null },
      { en: "A sample", zh: "範例", extra: 1 }, "A sample", null, { zh: "範例" }, { en: 1, zh: null },
    ];
    for (const v of bad) expect(L10n.safeParse(v).success, JSON.stringify(v)).toBe(false);
    expectIssue(L10n, { en: "A sample", zh: "範例", extra: 1 }, "", "Unrecognized key");
    expectIssue(L10n, { en: "A sample" }, "zh");
    expectIssue(L10n, { en: "", zh: null }, "en");
  });

  it("agrees with the L10n type of lib/i18n.ts", () => {
    expectTypeOf<z.infer<typeof L10n>>().toEqualTypeOf<I18nL10n>();
  });

  it("takes the fixed strings, which are Bilingual and so L10n", () => {
    for (const fixed of [vocab.NONE_FOUND, vocab.NO_AI_PART, vocab.DISCLOSURE, vocab.REMOVED_TEXT, vocab.REMOVED_BEFORE, vocab.END_LINE]) {
      expectValid(L10n, fixed);
    }
  });
});

describe("sources", () => {
  const source = () => ({
    id: "s1", kind: "paper", title: "A made-up paper", publisher: "Example Journal", url: "https://example.org/paper/1",
    doi: "10.1234/example.1", published_at: "2026-10-01", seen_as: "pack", added: "2026-11-23",
  });
  const draftSource = () => {
    const { seen_as: _a, added: _b, ...rest } = source();
    return rest;
  };

  it("Source holds the agent's fields and the two that publish adds", () => {
    expectValid(Source, source());
    expectValid(DraftSource, draftSource());
    expect(Object.keys(Source.shape)).toEqual(["id", "kind", "title", "publisher", "url", "doi", "published_at", "seen_as", "added"]);
  });

  it("a draft source has no seen_as and no added, a stored one needs both", () => {
    expectIssue(DraftSource, source(), "", "Unrecognized key");
    expectMutationFails(Source, source(), (s) => delete s.seen_as, "seen_as");
    expectMutationFails(Source, source(), (s) => delete s.added, "added");
    expectMutationFails(Source, source(), (s) => { s.seen_as = "guess"; }, "seen_as");
    expectMutationFails(Source, source(), (s) => { s.added = "2026-02-30"; }, "added");
  });

  it("every key is required, null where the spec gives null", () => {
    for (const key of Object.keys(source())) expectMutationFails(Source, source(), (s) => delete s[key], key);
    expectValid(Source, { ...source(), doi: null, published_at: null });
    for (const key of ["id", "kind", "title", "publisher", "url", "seen_as", "added"]) {
      expectMutationFails(Source, source(), (s) => { s[key] = null; }, key);
    }
  });

  it("holds the caps and formats the spec lists", () => {
    expectMutationFails(Source, source(), (s) => { s.title = "t".repeat(201); }, "title");
    expectValid(Source, { ...source(), title: "t".repeat(200) });
    expectMutationFails(Source, source(), (s) => { s.title = ""; }, "title");
    expectMutationFails(Source, source(), (s) => { s.publisher = "p".repeat(81); }, "publisher");
    expectValid(Source, { ...source(), publisher: "p".repeat(80) });
    expectMutationFails(Source, source(), (s) => { s.publisher = ""; }, "publisher");
    expectMutationFails(Source, source(), (s) => { s.url = ""; }, "url");
    expectMutationFails(Source, source(), (s) => { s.kind = "blog"; }, "kind");
    expectMutationFails(Source, source(), (s) => { s.id = "x1"; }, "id");
    expectMutationFails(Source, source(), (s) => { s.id = "s0"; }, "id");
    expectMutationFails(Source, source(), (s) => { s.doi = "10.1234/EXAMPLE.1"; }, "doi", "lower case");
    expectMutationFails(Source, source(), (s) => { s.doi = "https://doi.org/10.1234/example.1"; }, "doi");
    expectMutationFails(Source, source(), (s) => { s.published_at = "last week"; }, "published_at");
    expectMutationFails(Source, source(), (s) => { s.extra = true; }, "", "Unrecognized key");
  });

  it("every source kind and every way of seeing a URL is accepted", () => {
    for (const kind of vocab.SOURCE_KINDS) expectValid(Source, { ...source(), kind });
    for (const seen_as of SEEN_AS) expectValid(Source, { ...source(), seen_as });
  });

  it("a finding's sources carry s ids and a brief's b ids", () => {
    expectValid(FindingSource, source());
    expectValid(BriefSource, { ...source(), id: "b1" });
    expectMutationFails(FindingSource, source(), (s) => { s.id = "b1"; }, "id");
    expectIssue(BriefSource, { ...source(), id: "s1" }, "id");
    expectValid(DraftFindingSource, draftSource());
    expectValid(DraftBriefSource, { ...draftSource(), id: "b2" });
    expectMutationFails(DraftFindingSource, draftSource(), (s) => { s.id = "b1"; }, "id");
    expectIssue(DraftBriefSource, { ...draftSource(), id: "s1" }, "id");
    expect(Object.keys(FindingSource.shape)[0]).toBe("id");
  });

  it("takes the text a removed correction leaves, so a stored record never fails on it", () => {
    expectValid(Source, { ...source(), title: vocab.REMOVED_TEXT.en, url: vocab.REMOVED_TEXT.en });
  });
});

describe("rung entries", () => {
  const entry = () => ({ rung: "checked", date: "2026-11-20", recorded: "2026-11-23", source_id: "s1", by: "agent", note: { en: "A sample note", zh: null } });

  it("holds the event's date, the recording edition, the source and who wrote it", () => {
    expectValid(RungEntry, entry());
    expectValid(RungEntry, { ...entry(), note: null });
    expect(Object.keys(RungEntry.shape)).toEqual(["rung", "date", "recorded", "source_id", "by", "note"]);
  });

  it("refuses a bad rung, date, source id, author or note", () => {
    for (const rung of vocab.ALL_RUNGS) expectValid(RungEntry, { ...entry(), rung });
    for (const by of RUNG_BY) expectValid(RungEntry, { ...entry(), by });
    expectMutationFails(RungEntry, entry(), (e) => { e.rung = "verified"; }, "rung");
    expectMutationFails(RungEntry, entry(), (e) => { e.by = "model"; }, "by");
    expectMutationFails(RungEntry, entry(), (e) => { e.source_id = "b1"; }, "source_id");
    expectMutationFails(RungEntry, entry(), (e) => { e.date = "2026-11-31"; }, "date");
    expectMutationFails(RungEntry, entry(), (e) => { e.recorded = "yesterday"; }, "recorded");
    expectMutationFails(RungEntry, entry(), (e) => { e.note = "plain text"; }, "note");
    expectMutationFails(RungEntry, entry(), (e) => { e.note = { en: "x" }; }, "note.zh");
    expectMutationFails(RungEntry, entry(), (e) => { delete e.note; }, "note");
    expectMutationFails(RungEntry, entry(), (e) => { e.extra = 1; }, "", "Unrecognized key");
  });
});

describe("the AI role", () => {
  const ai = () => ({
    role: "ai_solved", confidence: "confirmed",
    systems: [{ name: "Sample System 3", maker: "Example Lab" }],
    evidence: [{ source_id: "s1", quote: "the system solved the problem", from_claimant: false }],
  });
  const none = () => ({ role: "none", confidence: null, systems: [], evidence: [] });

  it("holds the role, its confidence, the systems and the evidence", () => {
    expectValid(AiInfo, ai());
    expectValid(AiInfo, none());
    expect(Object.keys(AiInfoBase.shape)).toEqual(["role", "confidence", "systems", "evidence"]);
  });

  it("needs an evidence entry with any AI role, and never asks for one without", () => {
    for (const role of vocab.AI_ROLES.filter((r) => r !== "none")) {
      expectMutationFails(AiInfo, ai(), (a) => { a.role = role; a.evidence = []; }, "evidence", "evidence entry");
      expectValid(AiInfo, { ...ai(), role });
    }
    expectValid(AiInfo, { ...none(), evidence: [] });
  });

  it("leaves AI_CONFIDENCE and AI_SYSTEM_NAMED to the rules", () => {
    expectValid(AiInfo, { ...ai(), confidence: null });
    expectValid(AiInfo, { ...ai(), systems: [] });
    expectValid(AiInfo, { ...none(), confidence: "claimed" });
  });

  it("refuses a bad role, confidence, system, evidence entry or key", () => {
    expectMutationFails(AiInfo, ai(), (a) => { a.role = "ai_magic"; }, "role");
    expectMutationFails(AiInfo, ai(), (a) => { a.confidence = "maybe"; }, "confidence");
    expectMutationFails(AiInfo, ai(), (a) => { a.systems[0].name = "n".repeat(61); }, "systems.0.name");
    expectValid(AiInfo, { ...ai(), systems: [{ name: "n".repeat(60), maker: "m".repeat(60) }] });
    expectMutationFails(AiInfo, ai(), (a) => { a.systems[0].maker = ""; }, "systems.0.maker");
    expectMutationFails(AiInfo, ai(), (a) => { a.systems[0].maker = "m".repeat(61); }, "systems.0.maker");
    expectMutationFails(AiInfo, ai(), (a) => { a.systems[0].extra = 1; }, "systems.0", "Unrecognized key");
    expectMutationFails(AiInfo, ai(), (a) => { a.evidence[0].source_id = "b1"; }, "evidence.0.source_id");
    expectMutationFails(AiInfo, ai(), (a) => { delete a.evidence[0].quote; }, "evidence.0.quote");
    expectMutationFails(AiInfo, ai(), (a) => { a.evidence[0].quote = ""; }, "evidence.0.quote");
    expectMutationFails(AiInfo, ai(), (a) => { a.evidence[0].from_claimant = "no"; }, "evidence.0.from_claimant");
    expectMutationFails(AiInfo, ai(), (a) => { a.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(AiInfo, ai(), (a) => { delete a.systems; }, "systems");
    expectMutationFails(AiInfo, ai(), (a) => { a.systems = null; }, "systems");
  });

  it("leaves the 25-word cap of a quote to QUOTE_VERBATIM", () => {
    expectValid(AiInfo, { ...ai(), evidence: [{ source_id: "s1", quote: Array(40).fill("word").join(" "), from_claimant: true }] });
  });

  it("the unrefined base keeps .pick() and .shape for a draft schema to reuse", () => {
    expect(() => AiInfoBase.pick({ role: true })).not.toThrow();
    expect(() => (AiInfo as unknown as z.ZodObject<z.ZodRawShape>).pick({ role: true })).toThrow();
  });
});

describe("reactions, artefacts, figures and people", () => {
  const reaction = () => ({ source_id: "s2", who: "A. Scientist", affiliation: "Example University", quote: "a careful result" });
  const artefacts = () => ({ doi: ["10.1234/example.1"], arxiv: ["2501.01234"], lean: [], trial: ["NCT01234567"], pdb: ["1abc"] });
  const figure = () => ({
    source_id: "s1", image_url: "https://example.org/fig2.png", licence: "CC-BY-4.0",
    licence_quote: "This article is licensed under a Creative Commons Attribution 4.0 licence",
    credit: "Figure 2 from Sample et al., Example Journal (2026), CC BY 4.0", alt: { en: "A sample chart", zh: null },
  });

  it("Reaction caps who and affiliation and leaves the quote to QUOTE_VERBATIM", () => {
    expectValid(Reaction, reaction());
    expectMutationFails(Reaction, reaction(), (r) => { r.who = "w".repeat(81); }, "who");
    expectValid(Reaction, { ...reaction(), who: "w".repeat(80), affiliation: "a".repeat(100) });
    expectMutationFails(Reaction, reaction(), (r) => { r.affiliation = "a".repeat(101); }, "affiliation");
    expectMutationFails(Reaction, reaction(), (r) => { r.who = ""; }, "who");
    expectMutationFails(Reaction, reaction(), (r) => { r.source_id = "b3"; }, "source_id");
    expectMutationFails(Reaction, reaction(), (r) => { delete r.quote; }, "quote");
    expectMutationFails(Reaction, reaction(), (r) => { r.extra = 1; }, "", "Unrecognized key");
    expectValid(Reaction, { ...reaction(), quote: Array(40).fill("word").join(" ") });
  });

  it("Artefacts has five lists, each required, and leaves their formats to ARTEFACT_FORMAT", () => {
    expectValid(Artefacts, artefacts());
    expectValid(Artefacts, { doi: [], arxiv: [], lean: [], trial: [], pdb: [] });
    expect(Object.keys(Artefacts.shape)).toEqual(["doi", "arxiv", "lean", "trial", "pdb"]);
    for (const key of Object.keys(artefacts())) expectMutationFails(Artefacts, artefacts(), (a) => delete a[key], key);
    expectMutationFails(Artefacts, artefacts(), (a) => { a.doi = null; }, "doi");
    expectMutationFails(Artefacts, artefacts(), (a) => { a.pdb = ["1abc", ""]; }, "pdb.1");
    expectMutationFails(Artefacts, artefacts(), (a) => { a.extra = []; }, "", "Unrecognized key");
    expectValid(Artefacts, { ...artefacts(), doi: ["https://doi.org/10.1234/not-the-format"] });
  });

  it("Figure holds the licence, the credit cap and a bilingual alt", () => {
    expectValid(Figure, figure());
    for (const licence of FIGURE_LICENCES) expectValid(Figure, { ...figure(), licence });
    expectMutationFails(Figure, figure(), (f) => { f.licence = "CC-BY-NC-4.0"; }, "licence");
    expectMutationFails(Figure, figure(), (f) => { f.credit = "c".repeat(121); }, "credit");
    expectValid(Figure, { ...figure(), credit: "c".repeat(120) });
    expectMutationFails(Figure, figure(), (f) => { f.credit = ""; }, "credit");
    expectMutationFails(Figure, figure(), (f) => { f.alt = "plain text"; }, "alt");
    expectMutationFails(Figure, figure(), (f) => { f.source_id = "b1"; }, "source_id");
    expectMutationFails(Figure, figure(), (f) => { f.image_url = ""; }, "image_url");
    expectMutationFails(Figure, figure(), (f) => { delete f.licence_quote; }, "licence_quote");
    expectMutationFails(Figure, figure(), (f) => { f.extra = 1; }, "", "Unrecognized key");
    expectValid(Figure, { ...figure(), image_url: vocab.REMOVED_TEXT.en, credit: vocab.REMOVED_TEXT.en });
  });

  it("Figure has no refinement, so a draft can swap its alt for a plain string", () => {
    const Draft = Figure.omit({ alt: true }).extend({ alt: z.string() });
    const { alt: _alt, ...rest } = figure();
    expectValid(Draft, { ...rest, alt: "A sample chart" });
    expectIssue(Draft, { ...rest, alt: { en: "x", zh: null } }, "alt");
    expectIssue(Draft, { ...rest, alt: "x", extra: 1 }, "", "Unrecognized key");
  });

  it("Who holds a name and a ROR id or null", () => {
    expectValid(Who, { name: "Example Lab", ror: null });
    expectValid(Who, { name: "Example Lab", ror: "05gq02987" });
    expectMutationFails(Who, { name: "Example Lab", ror: null }, (w) => { w.name = "n".repeat(101); }, "name");
    expectValid(Who, { name: "n".repeat(100), ror: null });
    expectMutationFails(Who, { name: "Example Lab", ror: null }, (w) => { w.name = ""; }, "name");
    expectMutationFails(Who, { name: "Example Lab", ror: null }, (w) => { w.ror = "https://ror.org/05gq02987"; }, "ror");
    expectMutationFails(Who, { name: "Example Lab", ror: null }, (w) => { delete w.ror; }, "ror");
    expectMutationFails(Who, { name: "Example Lab", ror: null }, (w) => { w.extra = 1; }, "", "Unrecognized key");
  });
});

describe("the JSON Schema the agent reads", () => {
  it("converts the shared draft-visible schemas with every key required and no extra keys", () => {
    for (const schema of [DraftSource, DraftFindingSource, DraftBriefSource, AiInfo, Reaction, Artefacts, Figure, Who, RungEntry]) {
      const json = z.toJSONSchema(schema) as { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> };
      expect(json.additionalProperties).toBe(false);
      expect(json.required.sort()).toEqual(Object.keys(json.properties).sort());
    }
  });

  it("carries the help text of the fields the agent writes", () => {
    const json = z.toJSONSchema(DraftSource) as { properties: Record<string, { description?: string }> };
    expect(json.properties.title!.description).toContain("200");
    expect(json.properties.publisher!.description).toContain("80");
    expect(json.properties.url!.description).toContain("primary");
    expect(json.properties.doi!.description).toContain("Lower case");
  });
});

describe("the test helpers", () => {
  it("issuesOf joins a path with dots and reports nothing for a valid value", () => {
    expect(issuesOf(Who, { name: "Example Lab", ror: null })).toEqual([]);
    expect(issuesOf(Who, { name: "", ror: "x" }).map((i) => i.path)).toEqual(["name", "ror"]);
    expectOnlyIssue(Who, { name: "", ror: null }, "name");
  });

  it("copy is deep, so a changed copy leaves the original alone", () => {
    const original = { a: { b: [1, 2] } };
    const changed = copy(original);
    changed.a.b.push(3);
    expect(original.a.b).toEqual([1, 2]);
  });
});
