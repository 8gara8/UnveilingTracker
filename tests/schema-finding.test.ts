// lib/schema/finding.ts (SPEC §4.4) and lib/schema/glossary.ts (§4.9): the stored finding and the glossary file. Each
// schema has a valid value and a failing one for each constraint; inline data.

import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { FIELD_CODE_OF, FIELDS, type Kind } from "@/lib/vocab";
import { jsonText } from "@/lib/json";
import { DEPTHS, Depth, Explainer, Finding, FindingBase, SinceThen, type Finding as FindingType } from "@/lib/schema/finding";
import { GlossaryFile, Term, TermEn, TermZh } from "@/lib/schema/glossary";
import { expectMutationFails, expectOnlyIssue, expectValid } from "./helpers/zod-issues";

const l = (en: string) => ({ en, zh: null });

const finding = () => ({
  schema_version: 1,
  id: "bio-2026-0001",
  field: "biology",
  subfield: "proteins",
  kind: "result",
  title: { en: "A sample protein result", zh: "範例蛋白質成果" },
  depth: "story",
  explainer: {
    found: l("Sample found text."),
    matters: l("Sample matters text."),
    ai_helped: l("Sample System 3, from Example Lab, did the work."),
    how_sure: l("Checked by Example Journal."),
    background: l("Sample background text."),
    could_lead: l("It could lead to sample uses."),
  },
  go_deeper: ["s1"],
  ai: {
    role: "ai_solved",
    confidence: "confirmed",
    systems: [{ name: "Sample System 3", maker: "Example Lab" }],
    evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: false }],
  },
  significance: "major",
  rung: "checked",
  rung_history: [
    { rung: "preprint", date: "2026-10-01", recorded: "2026-10-05", source_id: "s2", by: "agent", note: null },
    { rung: "checked", date: "2026-11-20", recorded: "2026-11-23", source_id: "s1", by: "agent", note: l("Published in Example Journal.") },
  ],
  since_then: [{ date: "2026-11-23", text: l("A later sample fact."), source_ids: ["s1"] }],
  sources: [
    { id: "s1", kind: "paper", title: "A made-up paper", publisher: "Example Journal", url: "https://example.org/paper/1", doi: "10.1234/example.1", published_at: "2026-11-20", seen_as: "pack", added: "2026-11-23" },
    { id: "s2", kind: "preprint", title: "A made-up preprint", publisher: "arXiv", url: "https://example.org/preprint/1", doi: null, published_at: "2026-10-01", seen_as: "search", added: "2026-11-23" },
  ],
  reactions: [],
  artefacts: { doi: ["10.1234/example.1"], arxiv: [], lean: [], trial: [], pdb: [] },
  figure: null,
  who: [{ name: "Example Lab", ror: null }],
  terms: ["protein-folding"],
  related: ["bio-2026-0002"],
  first_published: "2026-10-01",
  first_brief: "2026-11-23",
  briefs: ["2026-11-23"],
  history: false,
  disclosure: false,
  applications: [],
  updated: "2026-11-23",
});

/** A finding with no AI role: no confidence, no system, no evidence and no How AI helped. */
const noRole = () => {
  const f = finding();
  f.ai = { role: "none", confidence: null, systems: [], evidence: [] } as never;
  f.explainer.ai_helped = null as never;
  return f;
};

/** A history entry of the Ledger: seeded, in no brief yet, its id carrying the year of its first publication. */
const historyEntry = () => ({
  ...finding(), id: "bio-2020-0001", first_published: "2020-03-01", first_brief: null, briefs: [], history: true,
  rung: "preprint", rung_history: [{ rung: "preprint", date: "2020-03-01", recorded: "2026-11-22", source_id: "s2", by: "seed", note: null }],
});

describe("Finding: the valid record", () => {
  it("accepts a finding as publish writes it", () => {
    expectValid(Finding, finding());
    expectValid(FindingBase, finding());
  });

  it("keeps the keys in the spec's order, so a file printed through the schema is stable", () => {
    const keys = [
      "schema_version", "id", "field", "subfield", "kind", "title", "depth", "explainer", "go_deeper", "ai", "significance", "rung",
      "rung_history", "since_then", "sources", "reactions", "artefacts", "figure", "who", "terms", "related", "first_published",
      "first_brief", "briefs", "history", "disclosure", "applications", "updated",
    ];
    expect(Object.keys(Finding.shape)).toEqual(keys);
    const shuffled = Object.fromEntries(Object.entries(finding()).reverse());
    expect(Object.keys(Finding.parse(shuffled))).toEqual(keys);
    expect(JSON.parse(jsonText(shuffled, Finding)).id).toBe("bio-2026-0001");
  });

  it("accepts a finding with no AI role, a history entry and a finding with a figure", () => {
    expectValid(Finding, noRole());
    expectValid(Finding, historyEntry());
    expectValid(Finding, {
      ...finding(),
      figure: {
        source_id: "s1", image_url: "https://example.org/fig.png", licence: "CC-BY-4.0", licence_quote: "licensed under CC BY 4.0",
        credit: "Figure 1 from a made-up paper, CC BY 4.0", alt: l("A sample chart"),
      },
    });
  });

  it("has the types the spec gives", () => {
    expectTypeOf<FindingType["kind"]>().toEqualTypeOf<Exclude<Kind, "idea">>();
    expectTypeOf<FindingType["applications"]>().toEqualTypeOf<[]>();
    expectTypeOf<FindingType["depth"]>().toEqualTypeOf<"story" | "item">();
    expectTypeOf<FindingType["first_brief"]>().toEqualTypeOf<string | null>();
    expectTypeOf<FindingType["explainer"]["ai_helped"]>().toEqualTypeOf<{ en: string; zh: string | null } | null>();
    expectTypeOf<z.infer<typeof Depth>>().toEqualTypeOf<"story" | "item">();
  });
});

describe("Finding: keys, nulls and unknown keys", () => {
  it("needs every key", () => {
    for (const key of Object.keys(finding())) expectMutationFails(Finding, finding(), (f) => delete f[key], key);
  });

  it("refuses null where the spec has no null", () => {
    const nullable = new Set(["figure", "first_brief"]);
    for (const key of Object.keys(finding()).filter((k) => !nullable.has(k))) {
      expectMutationFails(Finding, finding(), (f) => { f[key] = null; }, key);
    }
    expectMutationFails(Finding, finding(), (f) => { f.title.en = null; }, "title.en");
    expectMutationFails(Finding, finding(), (f) => { f.explainer.found = null; }, "explainer.found");
    expectMutationFails(Finding, finding(), (f) => { f.rung_history[0].source_id = null; }, "rung_history.0.source_id");
    expectMutationFails(Finding, finding(), (f) => { f.ai.systems = null; }, "ai.systems");
    expectValid(Finding, { ...finding(), figure: null });
  });

  it("refuses an unknown key at every level", () => {
    const places: [(f: any) => void, string][] = [
      [(f) => { f.extra = 1; }, ""],
      [(f) => { f.explainer.extra = 1; }, "explainer"],
      [(f) => { f.title.extra = 1; }, "title"],
      [(f) => { f.ai.extra = 1; }, "ai"],
      [(f) => { f.sources[0].extra = 1; }, "sources.0"],
      [(f) => { f.rung_history[0].extra = 1; }, "rung_history.0"],
      [(f) => { f.since_then[0].extra = 1; }, "since_then.0"],
      [(f) => { f.artefacts.extra = 1; }, "artefacts"],
      [(f) => { f.who[0].extra = 1; }, "who.0"],
    ];
    for (const [mutate, path] of places) expectMutationFails(Finding, finding(), mutate, path, "Unrecognized key");
  });

  it("is at schema version 1", () => {
    expectMutationFails(Finding, finding(), (f) => { f.schema_version = 2; }, "schema_version");
    expectMutationFails(Finding, finding(), (f) => { f.schema_version = "1"; }, "schema_version");
  });
});

describe("Finding: ids, vocabularies and formats", () => {
  it("refuses a malformed id, and an id that does not match its field or its year", () => {
    expectMutationFails(Finding, finding(), (f) => { f.id = "bio-2026-1"; }, "id");
    expectMutationFails(Finding, finding(), (f) => { f.id = "BIO-2026-0001"; }, "id");
    expectMutationFails(Finding, finding(), (f) => { f.id = "math-2026-0001"; }, "id", "starts with bio-");
    expectMutationFails(Finding, finding(), (f) => { f.id = "bio-2025-0001"; }, "id", "year of the first brief");
    expectMutationFails(Finding, historyEntry(), (f) => { f.id = "bio-2026-0001"; }, "id", "first_published");
    for (const field of FIELDS) {
      const code = FIELD_CODE_OF[field];
      expectValid(Finding, { ...finding(), field, id: `${code}-2026-0001` });
    }
  });

  it("keeps the id of a finding a correction refiled: the stored field never changes", () => {
    expectOnlyIssue(Finding, { ...finding(), field: "physics" }, "id", "phys-");
  });

  it("dates the id of a published finding by its first brief, and of a history entry by its first publication", () => {
    // A paper from December 2025 first briefed in November 2026 keeps the year of the brief.
    expectValid(Finding, { ...finding(), first_published: "2025-12-15" });
    expectValid(Finding, { ...historyEntry(), first_published: "2020-12-31" });
    expectOnlyIssue(Finding, { ...historyEntry(), first_published: "2021-01-01" }, "id", "A history entry's id carries the year of first_published");
    expectOnlyIssue(Finding, { ...finding(), first_brief: "2027-01-02", briefs: ["2027-01-02"] }, "id", "The id carries the year of the first brief");
  });

  it("refuses a field, kind, significance, rung or depth outside its vocabulary", () => {
    expectMutationFails(Finding, finding(), (f) => { f.field = "astronomy"; }, "field");
    expectMutationFails(Finding, finding(), (f) => { f.kind = "idea"; }, "kind");
    expectMutationFails(Finding, finding(), (f) => { f.kind = "Result"; }, "kind");
    expectMutationFails(Finding, finding(), (f) => { f.significance = "huge"; }, "significance");
    expectMutationFails(Finding, finding(), (f) => { f.rung = "verified"; }, "rung");
    expectMutationFails(Finding, finding(), (f) => { f.depth = "main"; }, "depth");
    expect([...DEPTHS]).toEqual(["story", "item"]);
    for (const rung of ["claimed", "preprint", "checked", "confirmed", "applied", "disputed", "retracted"]) {
      expectValid(Finding, { ...finding(), rung });
    }
  });

  it("checks the shape of a subfield and leaves its membership to SUBFIELD_UNKNOWN", () => {
    expectMutationFails(Finding, finding(), (f) => { f.subfield = "Proteins"; }, "subfield");
    expectMutationFails(Finding, finding(), (f) => { f.subfield = ""; }, "subfield");
    expectValid(Finding, { ...finding(), subfield: "protein" });
  });

  it("refuses bad dates", () => {
    for (const key of ["first_published", "first_brief", "updated"]) {
      expectMutationFails(Finding, finding(), (f) => { f[key] = "2026-02-30"; }, key);
    }
    expectMutationFails(Finding, finding(), (f) => { f.briefs = ["2026-13-01"]; }, "briefs.0");
    expectMutationFails(Finding, finding(), (f) => { f.since_then[0].date = "soon"; }, "since_then.0.date");
  });

  it("types the lists of ids", () => {
    expectMutationFails(Finding, finding(), (f) => { f.go_deeper = ["b1"]; }, "go_deeper.0");
    expectMutationFails(Finding, finding(), (f) => { f.terms = ["Protein Folding"]; }, "terms.0");
    expectMutationFails(Finding, finding(), (f) => { f.related = ["bio-2026-2"]; }, "related.0");
    expectMutationFails(Finding, finding(), (f) => { f.since_then[0].source_ids = ["b1"]; }, "since_then.0.source_ids.0");
    expectMutationFails(Finding, finding(), (f) => { f.sources[0].id = "b1"; }, "sources.0.id");
  });
});

describe("Finding: text and the AI part", () => {
  it("holds its title and each explainer part as L10n", () => {
    expectMutationFails(Finding, finding(), (f) => { f.title = "A plain title"; }, "title");
    expectMutationFails(Finding, finding(), (f) => { f.title = { en: "A title" }; }, "title.zh");
    expectMutationFails(Finding, finding(), (f) => { f.title.en = ""; }, "title.en");
    for (const part of ["found", "matters", "how_sure", "background", "could_lead"]) {
      expectMutationFails(Finding, finding(), (f) => { delete f.explainer[part]; }, `explainer.${part}`);
      expectMutationFails(Finding, finding(), (f) => { f.explainer[part] = "plain"; }, `explainer.${part}`);
    }
  });

  it("has ai_helped exactly when the role is an AI role", () => {
    expectMutationFails(Finding, finding(), (f) => { f.explainer.ai_helped = null; }, "explainer.ai_helped", "set when ai.role is an AI role");
    expectMutationFails(Finding, noRole(), (f) => { f.explainer.ai_helped = l("No AI role here."); }, "explainer.ai_helped", "null when ai.role is none");
    expectMutationFails(Finding, finding(), (f) => { delete f.explainer.ai_helped; }, "explainer.ai_helped");
  });

  it("holds the AI part's own rules", () => {
    expectMutationFails(Finding, finding(), (f) => { f.ai.evidence = []; }, "ai.evidence");
    expectMutationFails(Finding, finding(), (f) => { f.ai.role = "ai_robot"; }, "ai.role");
    expectMutationFails(Finding, finding(), (f) => { f.ai.evidence[0].source_id = "b1"; }, "ai.evidence.0.source_id");
  });

  it("leaves every rule that §4.12 names to the validator", () => {
    expectValid(Finding, { ...finding(), go_deeper: [] });
    expectValid(Finding, { ...finding(), go_deeper: ["s1", "s2", "s3", "s4"] });
    expectValid(Finding, { ...finding(), reactions: Array(5).fill({ source_id: "s2", who: "A. Scientist", affiliation: "Example University", quote: "a quote" }) });
    expectValid(Finding, { ...finding(), related: Array.from({ length: 6 }, (_, i) => `bio-2026-${String(i + 10).padStart(4, "0")}`) });
    expectValid(Finding, { ...finding(), rung: "applied" });
    expectValid(Finding, { ...finding(), title: l("A title with many many many many many many many many many many many many words") });
    expectValid(Finding, { ...finding(), ai: { ...finding().ai, confidence: null, systems: [] } });
    expectValid(Finding, { ...finding(), significance: "landmark" });
  });
});

describe("Finding: history, lists and the record's own consistency", () => {
  it("needs at least one rung entry and one to eight who entries", () => {
    expectMutationFails(Finding, finding(), (f) => { f.rung_history = []; }, "rung_history", "at least one rung entry");
    expectMutationFails(Finding, finding(), (f) => { f.who = []; }, "who", "at least one");
    expectValid(Finding, { ...finding(), who: Array.from({ length: 8 }, (_, i) => ({ name: `Group ${i + 1}`, ror: null })) });
    expectMutationFails(Finding, finding(), (f) => { f.who = Array.from({ length: 9 }, (_, i) => ({ name: `Group ${i + 1}`, ror: null })); }, "who", "at most 8");
    expectMutationFails(Finding, finding(), (f) => { f.who[0].ror = "not-a-ror"; }, "who.0.ror");
    expectMutationFails(Finding, finding(), (f) => { f.who[0].name = "n".repeat(101); }, "who.0.name");
  });

  it("is never related to itself", () => {
    expectMutationFails(Finding, finding(), (f) => { f.related = ["bio-2026-0001"]; }, "related", "itself");
    expectValid(Finding, { ...finding(), related: [] });
  });

  it("lists its briefs oldest first, and first_brief is the first of them", () => {
    const three = { ...finding(), briefs: ["2026-11-23", "2026-11-25", "2026-12-01"] };
    expectValid(Finding, three);
    expectMutationFails(Finding, three, (f) => { f.briefs = ["2026-11-23", "2026-12-01", "2026-11-25"]; }, "briefs.2");
    expectMutationFails(Finding, three, (f) => { f.briefs = ["2026-11-23", "2026-11-23", "2026-12-01"]; }, "briefs.1");
    expectMutationFails(Finding, finding(), (f) => { f.first_brief = "2026-11-24"; }, "first_brief", "first of briefs");
    expectMutationFails(Finding, finding(), (f) => { f.briefs = []; }, "first_brief", "first of briefs");
  });

  it("lets only a history entry be in no brief yet", () => {
    expectMutationFails(Finding, finding(), (f) => { f.first_brief = null; f.briefs = []; }, "first_brief", "history entry");
    expectValid(Finding, historyEntry());
    expectValid(Finding, { ...historyEntry(), first_brief: "2026-11-23", briefs: ["2026-11-23"] });
  });

  it("keeps applications empty in this version", () => {
    expectMutationFails(Finding, finding(), (f) => { f.applications = [{ name: "x" }]; }, "applications");
    expectMutationFails(Finding, finding(), (f) => { f.applications = null; }, "applications");
    expectValid(Finding, { ...finding(), applications: [] });
  });

  it("takes the text a removed correction leaves in a plain string", () => {
    expectValid(Finding, { ...finding(), sources: finding().sources.map((s) => ({ ...s, title: "This text was removed.", url: "This text was removed." })) });
  });
});

describe("Finding: Explainer and SinceThen on their own", () => {
  it("Explainer has the six parts in the order of EXPLAINER_PARTS", () => {
    expect(Object.keys(Explainer.shape)).toEqual(["found", "matters", "ai_helped", "how_sure", "background", "could_lead"]);
    expectValid(Explainer, finding().explainer);
  });

  it("SinceThen is a dated text with the sources that show it", () => {
    expectValid(SinceThen, finding().since_then[0]);
    expectValid(SinceThen, { date: "2026-11-23", text: l("A sample."), source_ids: [] });
    expectMutationFails(SinceThen, finding().since_then[0], (s) => { delete s.text; }, "text");
    expectMutationFails(SinceThen, finding().since_then[0], (s) => { s.source_ids = "s1"; }, "source_ids");
  });

  it("the unrefined base keeps .pick() for a draft schema to reuse, the refined Finding does not", () => {
    const Picked = FindingBase.pick({ field: true, subfield: true, kind: true, title: true });
    expectValid(Picked, { field: "biology", subfield: "proteins", kind: "result", title: l("A title") });
    expect(() => (Finding as unknown as z.ZodObject<z.ZodRawShape>).pick({ field: true })).toThrow();
  });
});

// ── The glossary ─────────────────────────────────────────────────────────────────────────────────

const term = () => ({
  id: "protein-folding",
  en: { term: "protein folding", definition: "How a chain of amino acids curls into its working shape." },
  zh: { term: "蛋白質摺疊", definition: "胺基酸長鏈捲成有功能形狀的過程。", official: "蛋白質摺疊", official_url: "https://terms.naer.edu.tw/detail/1/" },
  fields: ["biology"],
  first_finding: "bio-2026-0001",
  first_date: "2026-11-23",
});

describe("Term", () => {
  it("accepts a term in both languages, one still waiting for its Chinese, and one with no official term", () => {
    expectValid(Term, term());
    expectValid(Term, { ...term(), zh: null });
    expectValid(Term, { ...term(), zh: { ...term().zh, official: null, official_url: null } });
    expect(Object.keys(Term.shape)).toEqual(["id", "en", "zh", "fields", "first_finding", "first_date"]);
    expect(Object.keys(TermEn.shape)).toEqual(["term", "definition"]);
    expect(Object.keys(TermZh.shape)).toEqual(["term", "definition", "official", "official_url"]);
  });

  it("needs every key, and refuses null where the spec has none", () => {
    for (const key of Object.keys(term())) expectMutationFails(Term, term(), (t) => delete t[key], key);
    for (const key of ["id", "en", "fields", "first_finding", "first_date"]) expectMutationFails(Term, term(), (t) => { t[key] = null; }, key);
    for (const key of ["term", "definition"]) {
      expectMutationFails(Term, term(), (t) => { t.en[key] = null; }, `en.${key}`);
      expectMutationFails(Term, term(), (t) => { t.zh[key] = null; }, `zh.${key}`);
    }
    for (const key of ["official", "official_url"]) expectMutationFails(Term, term(), (t) => { delete t.zh[key]; }, `zh.${key}`);
  });

  it("refuses an unknown key at both levels and in the language objects", () => {
    expectMutationFails(Term, term(), (t) => { t.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(Term, term(), (t) => { t.en.extra = 1; }, "en", "Unrecognized key");
    expectMutationFails(Term, term(), (t) => { t.zh.extra = 1; }, "zh", "Unrecognized key");
  });

  it("holds the id format, its length cap and the finding id", () => {
    expectMutationFails(Term, term(), (t) => { t.id = "Protein Folding"; }, "id");
    expectMutationFails(Term, term(), (t) => { t.id = "protein_folding"; }, "id");
    expectMutationFails(Term, term(), (t) => { t.id = "a".repeat(61); }, "id", "at most 60");
    expectValid(Term, { ...term(), id: "a".repeat(60) });
    expectMutationFails(Term, term(), (t) => { t.first_finding = "bio-2026-1"; }, "first_finding");
    expectMutationFails(Term, term(), (t) => { t.first_date = "2026-02-30"; }, "first_date");
  });

  it("needs at least one field, each a known field, none twice", () => {
    expectMutationFails(Term, term(), (t) => { t.fields = []; }, "fields", "at least one field");
    expectMutationFails(Term, term(), (t) => { t.fields = ["astronomy"]; }, "fields.0");
    expectMutationFails(Term, term(), (t) => { t.fields = ["biology", "biology"]; }, "fields", "must not repeat");
    expectValid(Term, { ...term(), fields: ["biology", "chemistry"] });
  });

  it("leaves the 40-word budget and the official term's page to WORDS and ZH_OFFICIAL", () => {
    expectValid(Term, { ...term(), en: { term: "protein folding", definition: Array(60).fill("word").join(" ") } });
    expectValid(Term, { ...term(), zh: { ...term().zh, official: "蛋白質摺疊", official_url: null } });
    // An absent value is null, never an empty string, in every string of both languages.
    for (const key of ["term", "definition"]) expectMutationFails(Term, term(), (t) => { t.en[key] = ""; }, `en.${key}`);
    for (const key of ["term", "definition", "official", "official_url"]) expectMutationFails(Term, term(), (t) => { t.zh[key] = ""; }, `zh.${key}`);
    // One Chinese character is a whole term (熵, entropy), so no minimum length above 1 applies.
    expectValid(Term, { ...term(), id: "entropy", en: { term: "entropy", definition: "A measure of disorder." }, zh: { ...term().zh, term: "熵", official: "熵" } });
    expectValid(Term, { ...term(), en: { term: "protein folding", definition: "This text was removed." } });
  });
});

describe("GlossaryFile", () => {
  const file = () => ({ schema_version: 1, terms: [{ ...term(), id: "alpha" }, { ...term(), id: "beta" }, { ...term(), id: "gamma" }] });

  it("holds the terms sorted by id", () => {
    expectValid(GlossaryFile, file());
    expectValid(GlossaryFile, { schema_version: 1, terms: [] });
    expect(Object.keys(GlossaryFile.shape)).toEqual(["schema_version", "terms"]);
  });

  it("refuses terms out of order or with an id twice", () => {
    expectMutationFails(GlossaryFile, file(), (g) => { g.terms.reverse(); }, "terms.1.id", "sorted by id");
    expectMutationFails(GlossaryFile, file(), (g) => { g.terms[1].id = "alpha"; }, "terms.1.id");
    expectMutationFails(GlossaryFile, file(), (g) => { g.terms[2].id = "beta"; }, "terms.2.id");
  });

  it("sorts in code-unit order: a hyphen comes before a letter and a digit after it", () => {
    const sorted = { schema_version: 1, terms: ["a-b", "a1", "ab"].map((id) => ({ ...term(), id })) };
    expectValid(GlossaryFile, sorted);
    expectMutationFails(GlossaryFile, sorted, (g) => { g.terms.reverse(); }, "terms.1.id");
  });

  it("is at schema version 1, with no other key", () => {
    expectMutationFails(GlossaryFile, file(), (g) => { g.schema_version = 2; }, "schema_version");
    expectMutationFails(GlossaryFile, file(), (g) => { delete g.terms; }, "terms");
    expectMutationFails(GlossaryFile, file(), (g) => { g.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(GlossaryFile, file(), (g) => { g.terms[0].extra = 1; }, "terms.0", "Unrecognized key");
    expectMutationFails(GlossaryFile, file(), (g) => { g.terms = null; }, "terms");
  });
});
