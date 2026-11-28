// The shortest and the longest value of each free string and each bounded number of lib/schema, field by field: a free
// text field is never empty and takes a single character (SPEC §4.1 "every key required"; the budgets of §4.3 to §4.10
// are in characters where the spec gives one). Each row probes the field's own schema, so a minimum or a maximum moved
// by one, or dropped, fails here wherever the field sits. The other schema tests build whole values; this one does not.
// New for this project.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as S from "@/lib/schema";

/** The schema of the value at `path`, `*` standing for an array's element or a record's value; nullable wrappers are looked through. */
function at(schema: z.ZodType, path: string): z.ZodType {
  const bare = (s: any): any => {
    let field = s;
    while (field instanceof z.ZodNullable || field instanceof z.ZodOptional) field = field.def.innerType;
    return field;
  };
  let field: any = bare(schema);
  for (const key of path.split(".")) {
    if (key === "*") field = field instanceof z.ZodArray ? field.def.element : field.def.valueType;
    else field = field.shape?.[key];
    if (field === undefined) throw new Error(`No ${key} at ${path}`);
    field = bare(field);
  }
  return field;
}

interface Row { name: string; schema: z.ZodType; path: string; min: number; max?: number }

const row = (name: string, schema: z.ZodType, path: string, min: number, max?: number): Row => ({ name, schema, path, min, max });

/** Free text: a string of `min` characters or more, at most `max` where the spec gives a cap. */
const strings: Row[] = [
  // SPEC §4.3
  row("AiSystem", S.AiSystem, "name", 1, 60), row("AiSystem", S.AiSystem, "maker", 1, 60),
  row("Artefacts", S.Artefacts, "doi.*", 1), row("Artefacts", S.Artefacts, "arxiv.*", 1), row("Artefacts", S.Artefacts, "lean.*", 1),
  row("Artefacts", S.Artefacts, "trial.*", 1), row("Artefacts", S.Artefacts, "pdb.*", 1),
  row("DraftSource", S.DraftSource, "title", 1, 200), row("DraftSource", S.DraftSource, "publisher", 1, 80), row("DraftSource", S.DraftSource, "url", 1),
  row("Figure", S.Figure, "image_url", 1), row("Figure", S.Figure, "credit", 1, 120),
  row("L10n", S.L10n, "en", 1), row("L10n", S.L10n, "zh", 1),
  row("Reaction", S.Reaction, "who", 1, 80), row("Reaction", S.Reaction, "affiliation", 1, 100),
  row("Who", S.Who, "name", 1, 100),
  // SPEC §4.4 to §4.5
  row("IdeaLine", S.IdeaLine, "who", 1),
  row("DraftTermNew", S.DraftTermNew, "term", 1, 60),
  row("DraftIdea", S.DraftIdea, "who", 1),
  row("DraftCorrectionBase", S.DraftCorrectionBase, "after", 1, 300), row("DraftCorrectionBase", S.DraftCorrectionBase, "source_url", 1),
  // SPEC §4.6
  row("ZhString", S.ZhString, "key", 1), row("ZhString", S.ZhString, "en", 1), row("ZhGroup", S.ZhGroup, "id", 1),
  row("ZhTerm", S.ZhTerm, "en", 1), row("ZhTerm", S.ZhTerm, "definition", 1), row("ZhTerm", S.ZhTerm, "zh", 1), row("ZhTerm", S.ZhTerm, "official", 1),
  row("ZhFixed", S.ZhFixed, "en", 1), row("ZhFixed", S.ZhFixed, "zh", 1), row("ZhFixed", S.ZhFixed, "keys.*", 1),
  row("ZhHypeName", S.ZhHypeName, "en", 1), row("ZhHypeName", S.ZhHypeName, "zh", 1), row("ZhContext", S.ZhContext, "hype.*", 1),
  row("DraftZhTerm", S.DraftZhTerm, "zh", 1), row("DraftZhTerm", S.DraftZhTerm, "definition", 1),
  row("DraftZhTerm", S.DraftZhTerm, "official", 1), row("DraftZhTerm", S.DraftZhTerm, "official_url", 1),
  // SPEC §4.7 to §4.10
  row("CounterReadingBase", S.CounterReadingBase, "source_url", 1), row("RequestRecord", S.RequestRecord, "url", 1),
  row("TermEn", S.TermEn, "term", 1), row("TermEn", S.TermEn, "definition", 1),
  row("TermZh", S.TermZh, "term", 1), row("TermZh", S.TermZh, "definition", 1), row("TermZh", S.TermZh, "official", 1), row("TermZh", S.TermZh, "official_url", 1),
  row("CorrectionBase", S.CorrectionBase, "source_url", 1), row("ReportBase", S.ReportBase, "evidence_url", 1, 500),
  // SPEC §4.8, §4.13
  row("StageRecord", S.StageRecord, "note", 1, 200), row("FeedRecord", S.FeedRecord, "note", 1, 200),
  row("LinkCheck", S.LinkCheck, "broken.*.url", 1), row("RunRecord", S.RunRecord, "budgets.usage.window", 1),
  row("FeedEntry", S.FeedEntry, "name", 1),
];

/** Whole numbers with a lower bound, and an upper one where there is one. */
const numbers: Row[] = [
  row("ReportBase", S.ReportBase, "issue_number", 1),
  row("ArchiveLastCheck", S.ArchiveLastCheck, "http", 100, 599),
  row("LinkCheck", S.LinkCheck, "broken.*.http", 100, 599),
];

describe("free text fields", () => {
  it.each(strings.map((r) => [`${r.name}.${r.path}`, r] as const))("%s is never empty and takes a single character", (_, r) => {
    const field = at(r.schema, r.path);
    expect(field.safeParse("x".repeat(r.min - 1)).success, "one character short").toBe(false);
    expect(field.safeParse("x".repeat(r.min)).success, "the shortest").toBe(true);
    expect(field.safeParse(5).success, "a number").toBe(false);
  });

  it.each(strings.filter((r) => r.max !== undefined).map((r) => [`${r.name}.${r.path}`, r] as const))("%s holds at most its cap in characters", (_, r) => {
    const field = at(r.schema, r.path);
    expect(field.safeParse("x".repeat(r.max!)).success, "the longest").toBe(true);
    expect(field.safeParse("x".repeat(r.max! + 1)).success, "one character over").toBe(false);
  });

  it("probes more than fifty fields, a dozen of them with a cap", () => {
    expect(strings.length).toBeGreaterThan(50);
    expect(strings.filter((r) => r.max !== undefined).length).toBeGreaterThan(12);
  });

  it("is a probe that can fail: a field with another minimum or cap is told apart", () => {
    const row2 = (field: z.ZodType, r: Row) => field.safeParse("x".repeat(r.min - 1)).success === false && field.safeParse("x".repeat(r.min)).success;
    expect(row2(z.string().min(1), { name: "t", schema: z.string(), path: "", min: 1 })).toBe(true);
    expect(row2(z.string().min(2), { name: "t", schema: z.string(), path: "", min: 1 })).toBe(false);
    expect(row2(z.string(), { name: "t", schema: z.string(), path: "", min: 1 })).toBe(false);
    expect(() => at(S.AiSystem, "nope")).toThrow("No nope");
  });
});

describe("bounded whole numbers", () => {
  it.each(numbers.map((r) => [`${r.name}.${r.path}`, r] as const))("%s runs from its minimum to its maximum, and is a whole number", (_, r) => {
    const field = at(r.schema, r.path);
    expect(field.safeParse(r.min - 1).success, "one below").toBe(false);
    expect(field.safeParse(r.min).success, "the minimum").toBe(true);
    if (r.max !== undefined) {
      expect(field.safeParse(r.max).success, "the maximum").toBe(true);
      expect(field.safeParse(r.max + 1).success, "one above").toBe(false);
    }
    expect(field.safeParse(r.min + 0.5).success, "a fraction").toBe(false);
    expect(field.safeParse(String(r.min)).success, "a string").toBe(false);
  });
});

describe("maps of text", () => {
  const url = { first_cited: "2026-11-20", refs: [], sha256: null, hashed_at: null, last_check: null };
  it.each([
    ["ZhContext.avoid", S.ZhContext, "avoid", "y"],
    ["ZhContext.labels", S.ZhContext, "labels", "y"],
    ["DraftZh.strings", S.DraftZh, "strings", "y"],
  ] as const)("%s has no empty key and no empty value", (_, schema, path, value) => {
    const field = at(schema, path);
    expect(field.safeParse({ x: value }).success).toBe(true);
    expect(field.safeParse({ "": value }).success, "an empty key").toBe(false);
    expect(field.safeParse({ x: "" }).success, "an empty value").toBe(false);
  });

  it("ArchiveIndex.urls has no empty key", () => {
    const field = at(S.ArchiveIndex, "urls");
    expect(field.safeParse({ x: url }).success).toBe(true);
    expect(field.safeParse({ "": url }).success).toBe(false);
  });
});
