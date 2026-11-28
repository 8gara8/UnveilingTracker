// lib/schema/draft-zh.ts (SPEC §4.6): the Chinese pass's context, `ZhContext`, and its one file, `DraftZh`, and the JSON
// Schema generated from the second. Each has a valid value and a failing one for each constraint; inline data. The rules
// that compare the draft with its context (ZH_KEYS, ZH_CHARS, ZH_PARITY and the rest) are lib/rules's, not these.

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { jsonText } from "@/lib/json";
import {
  DraftZh, DraftZhTerm, ZH_STRING_KINDS, ZhContext, ZhFixed, ZhGroup, ZhHypeName, ZhString, ZhStringKind, ZhTerm,
  type DraftZh as DraftZhType, type ZhContext as ZhContextType,
} from "@/lib/schema/draft-zh";
import { expectIssue, expectMutationFails, expectOnlyIssue, expectValid, issuesOf } from "./helpers/zod-issues";

const CONTEXT_KEYS = ["schema_version", "date", "deadline", "strings", "terms", "fixed", "hype", "hype_names", "avoid", "labels"];
const DRAFT_KEYS = ["schema_version", "date", "generated_at", "strings", "terms"];

/** The context stage 8 builds for a day with one new finding, a Lead, a returning update, an idea and the deep dive of a Sunday, and two terms. */
const context = () => ({
  schema_version: 1,
  date: "2026-11-24",
  deadline: "2026-11-24T04:20:00+08:00",
  strings: [
    { key: "lead.0", en: "A sample protein result leads today.", kind: "lead", cap_chars: 108, group: { id: "lead", cap_chars: 108 } },
    { key: "new.new-1.title", en: "A sample protein result", kind: "title", cap_chars: 22, group: null },
    { key: "new.new-1.explainer.found", en: "Sample found text.", kind: "part", cap_chars: 99, group: { id: "new.new-1.explainer", cap_chars: 504 } },
    { key: "new.new-1.figure.alt", en: "A sample chart", kind: "alt", cap_chars: 72, group: null },
    { key: "returning.math-2026-0002.update", en: "A journal published the proof.", kind: "note", cap_chars: 108, group: null },
    { key: "ideas.0", en: "A made-up argument about method.", kind: "line", cap_chars: 72, group: null },
    { key: "deep_dive", en: "A made-up deep dive.", kind: "long", cap_chars: 990, group: null },
  ],
  terms: [
    { id: "protein-folding", en: "protein folding", definition: "How a chain of amino acids curls into a shape.", zh: null, official: null, cap_chars: 72 },
    { id: "enzyme", en: "enzyme", definition: "A protein that speeds up a reaction.", zh: "酵素", official: "酶", cap_chars: 72 },
  ],
  fixed: [{ en: "algorithm", zh: "演算法", keys: ["new.new-1.explainer.found", "terms.protein-folding"] }],
  hype: ["劃時代"],
  hype_names: [{ en: "Breakthrough Prize", zh: "突破獎" }, { en: "Holy Grail", zh: null }],
  avoid: { "視頻": "影片" },
  labels: { Checked: "已查核", Mathematics: "數學", Major: "重大" },
});

/** The pass's answer: a string for each key of the context, and the Chinese of its one null-zh term. */
const draft = () => ({
  schema_version: 1,
  date: "2026-11-24",
  generated_at: "2026-11-24T04:18:00+08:00",
  strings: {
    "lead.0": "今天的重點是一項範例蛋白質成果。",
    "new.new-1.title": "範例蛋白質成果",
    "new.new-1.explainer.found": "範例發現的內容。",
    "new.new-1.figure.alt": "範例圖表",
    "returning.math-2026-0002.update": "期刊刊出了這篇論文。",
    "ideas.0": "一項關於方法的範例論點。",
    deep_dive: "一篇範例深入報導。",
  },
  terms: {
    "protein-folding": {
      zh: "蛋白質摺疊", definition: "胺基酸鏈捲曲成立體形狀的過程。", official: "蛋白質摺疊", official_url: "https://terms.naer.edu.tw/detail/1234567/",
    },
  },
});

describe("ZhContext: the pass's input", () => {
  it("accepts a context, and one for a day with nothing to translate", () => {
    expectValid(ZhContext, context());
    expectValid(ZhContext, { ...context(), strings: [], terms: [], fixed: [], hype: [], hype_names: [], avoid: {}, labels: {} });
  });

  it("keeps the keys in the spec's order", () => {
    expect(Object.keys(ZhContext.shape)).toEqual(CONTEXT_KEYS);
    expect(Object.keys(ZhString.shape)).toEqual(["key", "en", "kind", "cap_chars", "group"]);
    expect(Object.keys(ZhTerm.shape)).toEqual(["id", "en", "definition", "zh", "official", "cap_chars"]);
    const shuffled = Object.fromEntries(Object.entries(context()).reverse());
    expect(Object.keys(ZhContext.parse(shuffled))).toEqual(CONTEXT_KEYS);
    expect(JSON.parse(jsonText(shuffled, ZhContext)).date).toBe("2026-11-24");
  });

  it("has the types the spec gives", () => {
    expectTypeOf<ZhContextType["strings"][number]["kind"]>().toEqualTypeOf<"title" | "part" | "lead" | "note" | "line" | "long" | "alt">();
    expectTypeOf<ZhContextType["strings"][number]["group"]>().toEqualTypeOf<{ id: string; cap_chars: number } | null>();
    expectTypeOf<ZhContextType["terms"][number]["zh"]>().toEqualTypeOf<string | null>();
    expectTypeOf<ZhContextType["terms"][number]["official"]>().toEqualTypeOf<string | null>();
    expectTypeOf<ZhContextType["fixed"][number]>().toEqualTypeOf<{ en: string; zh: string; keys: string[] }>();
    expectTypeOf<ZhContextType["hype"]>().toEqualTypeOf<string[]>();
    expectTypeOf<ZhContextType["hype_names"][number]>().toEqualTypeOf<{ en: string; zh: string | null }>();
    expectTypeOf<ZhContextType["avoid"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<ZhContextType["labels"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<z.infer<typeof ZhStringKind>>().toEqualTypeOf<(typeof ZH_STRING_KINDS)[number]>();
  });

  it("needs every key and refuses null where the spec has none", () => {
    for (const key of CONTEXT_KEYS) expectMutationFails(ZhContext, context(), (c) => delete c[key], key);
    for (const key of CONTEXT_KEYS) expectMutationFails(ZhContext, context(), (c) => { c[key] = null; }, key);
    expectMutationFails(ZhContext, context(), (c) => { c.strings[0].en = null; }, "strings.0.en");
    expectMutationFails(ZhContext, context(), (c) => { c.strings[0].group = undefined; }, "strings.0.group");
    expectMutationFails(ZhContext, context(), (c) => { c.terms[0].official = undefined; }, "terms.0.official");
    expectMutationFails(ZhContext, context(), (c) => { c.fixed[0].zh = null; }, "fixed.0.zh");
    expectMutationFails(ZhContext, context(), (c) => { c.hype_names[0].en = null; }, "hype_names.0.en");
    expectValid(ZhContext, { ...context(), hype_names: [{ en: "Holy Grail", zh: null }] });
  });

  it("refuses an unknown key at every level", () => {
    const places: [(c: any) => void, string][] = [
      [(c) => { c.extra = 1; }, ""],
      [(c) => { c.strings[0].extra = 1; }, "strings.0"],
      [(c) => { c.strings[0].group.extra = 1; }, "strings.0.group"],
      [(c) => { c.terms[0].extra = 1; }, "terms.0"],
      [(c) => { c.fixed[0].extra = 1; }, "fixed.0"],
      [(c) => { c.hype_names[0].extra = 1; }, "hype_names.0"],
    ];
    for (const [mutate, path] of places) expectMutationFails(ZhContext, context(), mutate, path, "Unrecognized key");
  });
});

describe("ZhContext: the strings, the terms and the lists", () => {
  it("takes one of the seven kinds of string", () => {
    expect([...ZH_STRING_KINDS]).toEqual(["title", "part", "lead", "note", "line", "long", "alt"]);
    for (const kind of ZH_STRING_KINDS) expectValid(ZhString, { ...context().strings[1], kind });
    expectOnlyIssue(ZhString, { ...context().strings[1], kind: "caption" }, "kind");
  });

  it("gives each string a key, its English and a cap of at least one Chinese character", () => {
    expectOnlyIssue(ZhString, { ...context().strings[1], key: "" }, "key");
    expectOnlyIssue(ZhString, { ...context().strings[1], en: "" }, "en");
    expectOnlyIssue(ZhString, { ...context().strings[1], cap_chars: 0 }, "cap_chars");
    expectOnlyIssue(ZhString, { ...context().strings[1], cap_chars: 22.5 }, "cap_chars");
    expectOnlyIssue(ZhString, { ...context().strings[1], cap_chars: "22" }, "cap_chars");
    expectValid(ZhString, { ...context().strings[1], cap_chars: 1 });
    expectValid(ZhString, { ...context().strings[1], key: "x", en: "X" });
  });

  it("gives a group an id and a cap, or no group", () => {
    expectValid(ZhGroup, { id: "lead", cap_chars: 108 });
    expectValid(ZhGroup, { id: "x", cap_chars: 1 });
    expectOnlyIssue(ZhGroup, { id: "", cap_chars: 108 }, "id");
    expectOnlyIssue(ZhGroup, { id: "lead", cap_chars: -1 }, "cap_chars");
    expectMutationFails(ZhContext, context(), (c) => { c.strings[0].group.cap_chars = 0; }, "strings.0.group.cap_chars");
    expectValid(ZhContext, { ...context(), strings: [{ ...context().strings[0], group: null }] });
  });

  it("gives a term its id, its English, its definition, its Chinese or null, its official name or null, and a cap", () => {
    expectValid(ZhTerm, context().terms[0]);
    expectValid(ZhTerm, context().terms[1]);
    expectOnlyIssue(ZhTerm, { ...context().terms[0], id: "Protein Folding" }, "id");
    expectOnlyIssue(ZhTerm, { ...context().terms[0], id: "t".repeat(61) }, "id");
    expectOnlyIssue(ZhTerm, { ...context().terms[0], en: "" }, "en");
    expectOnlyIssue(ZhTerm, { ...context().terms[0], definition: "" }, "definition");
    expectOnlyIssue(ZhTerm, { ...context().terms[0], zh: "" }, "zh");
    expectOnlyIssue(ZhTerm, { ...context().terms[1], official: "" }, "official");
    expectOnlyIssue(ZhTerm, { ...context().terms[0], cap_chars: 0 }, "cap_chars");
    expectValid(ZhTerm, { ...context().terms[0], en: "x", definition: "x", zh: "甲", official: "乙", cap_chars: 1 });
  });

  it("gives a fixed entry its English, its Chinese and the keys it applies to", () => {
    expectValid(ZhFixed, context().fixed[0]);
    expectValid(ZhFixed, { ...context().fixed[0], keys: [] });
    expectOnlyIssue(ZhFixed, { ...context().fixed[0], zh: "" }, "zh");
    expectOnlyIssue(ZhFixed, { ...context().fixed[0], keys: [""] }, "keys.0");
    expectOnlyIssue(ZhFixed, { ...context().fixed[0], keys: "lead.0" }, "keys");
  });

  it("gives a hype name its English and its Chinese or null", () => {
    expectValid(ZhHypeName, { en: "Breakthrough Prize", zh: "突破獎" });
    expectValid(ZhHypeName, { en: "Holy Grail", zh: null });
    expectOnlyIssue(ZhHypeName, { en: "", zh: null }, "en");
    expectOnlyIssue(ZhHypeName, { en: "Holy Grail", zh: "" }, "zh");
  });

  it("takes the hype words, the avoid list and the labels as plain strings", () => {
    expectMutationFails(ZhContext, context(), (c) => { c.hype = [""]; }, "hype.0");
    expectMutationFails(ZhContext, context(), (c) => { c.hype = "劃時代"; }, "hype");
    expectMutationFails(ZhContext, context(), (c) => { c.avoid = { "視頻": "" }; }, "avoid.視頻");
    expectMutationFails(ZhContext, context(), (c) => { c.avoid = { "視頻": 1 }; }, "avoid.視頻");
    expectMutationFails(ZhContext, context(), (c) => { c.labels = { Checked: null }; }, "labels.Checked");
    expectMutationFails(ZhContext, context(), (c) => { c.labels = []; }, "labels");
  });

  it("takes a real date and a deadline with an offset", () => {
    expectMutationFails(ZhContext, context(), (c) => { c.date = "2026-02-30"; }, "date");
    expectMutationFails(ZhContext, context(), (c) => { c.deadline = "2026-11-24T04:20:00"; }, "deadline");
    expectMutationFails(ZhContext, context(), (c) => { c.schema_version = 2; }, "schema_version");
  });

  it("lists each key and each term once", () => {
    expectMutationFails(ZhContext, context(), (c) => { c.strings.push({ ...c.strings[1] }); }, "strings.7.key", "appears twice");
    expectMutationFails(ZhContext, context(), (c) => { c.terms.push({ ...c.terms[0] }); }, "terms.2.id", "appears twice");
    const issues = issuesOf(ZhContext, { ...context(), strings: [context().strings[1], context().strings[1], context().strings[1]] });
    expect(issues.map((i) => i.path)).toEqual(["strings.1.key", "strings.2.key"]);
  });
});

describe("DraftZh: the pass's one file", () => {
  it("accepts a draft, and one with nothing translated", () => {
    expectValid(DraftZh, draft());
    expectValid(DraftZh, { ...draft(), strings: {}, terms: {} });
  });

  it("keeps the keys in the spec's order and holds no structure of its own", () => {
    expect(Object.keys(DraftZh.shape)).toEqual(DRAFT_KEYS);
    expect(Object.keys(DraftZhTerm.shape)).toEqual(["zh", "definition", "official", "official_url"]);
    const shuffled = Object.fromEntries(Object.entries(draft()).reverse());
    expect(Object.keys(DraftZh.parse(shuffled))).toEqual(DRAFT_KEYS);
    expect(JSON.parse(jsonText(shuffled, DraftZh)).date).toBe("2026-11-24");
    for (const key of ["findings", "ids", "numbers", "links", "sources", "new_findings", "deadline"]) {
      expectMutationFails(DraftZh, draft(), (d) => { d[key] = []; }, "", "Unrecognized key");
    }
  });

  it("has the types the spec gives", () => {
    expectTypeOf<DraftZhType["strings"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<DraftZhType["terms"]>().toEqualTypeOf<
      Record<string, { zh: string; definition: string; official: string | null; official_url: string | null }>
    >();
    expectTypeOf<DraftZhType["generated_at"]>().toEqualTypeOf<string>();
  });

  it("needs every key and refuses null where the spec has none", () => {
    for (const key of DRAFT_KEYS) expectMutationFails(DraftZh, draft(), (d) => delete d[key], key);
    for (const key of DRAFT_KEYS) expectMutationFails(DraftZh, draft(), (d) => { d[key] = null; }, key);
    for (const key of ["zh", "definition", "official", "official_url"]) {
      expectMutationFails(DraftZh, draft(), (d) => delete d.terms["protein-folding"][key], `terms.protein-folding.${key}`);
    }
    for (const key of ["zh", "definition"]) expectMutationFails(DraftZh, draft(), (d) => { d.terms["protein-folding"][key] = null; }, `terms.protein-folding.${key}`);
    expectValid(DraftZh, { ...draft(), terms: { "protein-folding": { zh: "蛋白質摺疊", definition: "一個定義。", official: null, official_url: null } } });
  });

  it("refuses an unknown key at the top and in a term", () => {
    expectMutationFails(DraftZh, draft(), (d) => { d.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(DraftZh, draft(), (d) => { d.terms["protein-folding"].extra = 1; }, "terms.protein-folding", "Unrecognized key");
  });

  it("takes a Chinese string for each key, never empty", () => {
    expectMutationFails(DraftZh, draft(), (d) => { d.strings["lead.0"] = ""; }, "strings.lead.0");
    expectMutationFails(DraftZh, draft(), (d) => { d.strings["lead.0"] = 1; }, "strings.lead.0");
    expectMutationFails(DraftZh, draft(), (d) => { d.strings["lead.0"] = { en: "x", zh: "y" }; }, "strings.lead.0");
    expectMutationFails(DraftZh, draft(), (d) => { d.strings[""] = "一句話。"; }, "strings.", "Invalid key");
    expectMutationFails(DraftZh, draft(), (d) => { d.strings = []; }, "strings");
  });

  it("keys the terms by term id", () => {
    expectValid(DraftZh, { ...draft(), terms: { enzyme: draft().terms["protein-folding"] } });
    expectMutationFails(DraftZh, draft(), (d) => { d.terms["Protein Folding"] = d.terms["protein-folding"]; }, "terms.Protein Folding", "Invalid key");
    expectMutationFails(DraftZh, draft(), (d) => { d.terms[`${"t".repeat(61)}`] = d.terms["protein-folding"]; }, `terms.${"t".repeat(61)}`, "Invalid key");
    expectMutationFails(DraftZh, draft(), (d) => { d.terms = []; }, "terms");
  });

  it("takes a term's Chinese name and definition, and its official name and page or null", () => {
    expectValid(DraftZhTerm, draft().terms["protein-folding"]);
    expectOnlyIssue(DraftZhTerm, { ...draft().terms["protein-folding"], zh: "" }, "zh");
    expectOnlyIssue(DraftZhTerm, { ...draft().terms["protein-folding"], definition: "" }, "definition");
    expectOnlyIssue(DraftZhTerm, { ...draft().terms["protein-folding"], official: "" }, "official");
    expectOnlyIssue(DraftZhTerm, { ...draft().terms["protein-folding"], official_url: "" }, "official_url");
  });

  it("leaves a non-null official without its page to ZH_OFFICIAL, which reads the page's own text", () => {
    expectValid(DraftZhTerm, { ...draft().terms["protein-folding"], official: "蛋白質摺疊", official_url: null });
    expectValid(DraftZhTerm, { ...draft().terms["protein-folding"], official: null, official_url: "https://terms.naer.edu.tw/detail/1/" });
  });

  it("takes a real date and a timestamp with an offset", () => {
    expectMutationFails(DraftZh, draft(), (d) => { d.date = "2026-11-31"; }, "date");
    expectMutationFails(DraftZh, draft(), (d) => { d.generated_at = "04:18"; }, "generated_at");
    expectMutationFails(DraftZh, draft(), (d) => { d.schema_version = 0; }, "schema_version");
    expectIssue(DraftZh, { ...draft(), generated_at: "2026-11-24T04:18:00" }, "generated_at");
  });
});

describe("DraftZh: the JSON Schema the Chinese pass reads", () => {
  const json = () => z.toJSONSchema(DraftZh, { target: "draft-2020-12", unrepresentable: "throw" }) as any;

  it("generates without a transform or any type JSON Schema cannot show", () => {
    expect(() => json()).not.toThrow();
  });

  it("requires every key, refuses any other, and shows the strings as a map", () => {
    const schema = json();
    expect(schema.required).toEqual(DRAFT_KEYS);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.strings.type).toBe("object");
    expect(schema.properties.strings.additionalProperties).toEqual({ type: "string", minLength: 1 });
  });

  it("shows the terms as a map keyed by term id, each a strict object of four keys", () => {
    const terms = json().properties.terms;
    expect(terms.propertyNames.pattern).toBe("^[a-z0-9]+(?:-[a-z0-9]+)*$");
    expect(terms.propertyNames.maxLength).toBe(60);
    expect(terms.additionalProperties.required).toEqual(["zh", "definition", "official", "official_url"]);
    expect(terms.additionalProperties.additionalProperties).toBe(false);
  });

  it("keeps every description short enough for the compact printer, whose lines stay under 1,000 characters", () => {
    const long: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          if (key === "description" && typeof value === "string" && value.length >= 400) long.push(value);
          else walk(value);
        }
      }
    };
    walk(json());
    expect(long).toEqual([]);
  });
});
