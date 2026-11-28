// The agents' JSON Schema files (SPEC §4.1, §4.5, §4.6, §8.1, §9.5, §10 P1 item 4): routine/schema/draft-brief.schema.json and
// draft-zh.schema.json are current (this is `schema:check`), compact (every line under 1,000 characters), closed (an unknown
// key fails), hold every `.describe()` text of the Zod schemas at the node it describes, accept what Zod accepts, reject
// what breaks the structure (a sweep that breaks every node of a full draft) and say nothing of the Zod-only
// refinements, which a draft can still break. No JSON Schema library is installed, so `check` below implements exactly the
// keywords the files use and throws on any other, so a new keyword can never be skipped silently. `check` has tests of its
// own. Cyber's tests/json-schema.test.ts at the fork commit 3ced1fb, adapted: both files, the description walk, the sweep,
// the refinement examples, the stats and the script's usage, missing-file and long-line cases are new (docs/PROVENANCE.md).
//
// The drafts these tests build by hand are valid for Zod, which they assert; the valid fixture drafts of fixtures/drafts/ (and
// of fixtures/drafts-zh/ once it exists) are checked against the files too, in "the valid fixture drafts" below.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DRAFT_SCHEMA_PATH, DRAFT_ZH_SCHEMA_PATH, SCHEMA_FILES, SCHEMA_LINE_LIMIT, draftSchema, draftZhSchema, printJson,
  renderDraftSchema, renderDraftZhSchema, schemaFileStats,
} from "@/lib/json-schema";
import { FIGURE_LICENCES, ID_PATTERNS, TERM_ID_MAX } from "@/lib/schema/common";
import { WHY_TODAY } from "@/lib/schema/brief";
import { DraftBrief } from "@/lib/schema/draft";
import { DraftZh } from "@/lib/schema/draft-zh";
import { CORRECTION_TYPES, DECIDED_REPORT_STATUS } from "@/lib/schema/misc";
import { AI_CONFIDENCE, AI_ROLES, ALL_RUNGS, FIELDS, FIELD_CODES, FINDING_KINDS, SIGNIFICANCE, SOURCE_KINDS } from "@/lib/vocab";
import { modelRe } from "./helpers/model-names";

const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// ── A small JSON Schema checker, for exactly the keywords the files use ──────────────────────────

type Schema = Record<string, unknown>;

/** Every keyword the checker evaluates (the first five only annotate). */
const KNOWN = new Set([
  "$schema", "title", "description", "type", "properties", "required", "additionalProperties", "propertyNames", "items", "anyOf",
  "oneOf", "const", "enum", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "pattern",
]);
const ANNOTATIONS = new Set(["$schema", "title", "description"]);

function typeOk(v: unknown, t: string): boolean {
  switch (t) {
    case "null": return v === null;
    case "boolean": return typeof v === "boolean";
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return Number.isInteger(v);
    case "array": return Array.isArray(v);
    case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
    default: throw new Error(`unknown type ${t}`);
  }
}

const isSchema = (x: unknown): x is Schema => x !== null && typeof x === "object" && !Array.isArray(x);

/** JSON Schema 2020-12 for the keywords above; returns "path: message" strings, [] when valid. */
function check(schema: Schema, v: unknown, at = "$"): string[] {
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`keyword ${k} at ${at} is not handled by this test`);
  const errs: string[] = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => typeOk(v, t))) return [`${at}: expected ${types.join(" or ")}`];
  }
  if ("const" in schema && JSON.stringify(v) !== JSON.stringify(schema.const)) errs.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !(schema.enum as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(v))) errs.push(`${at}: not in enum`);
  if (schema.anyOf && !(schema.anyOf as Schema[]).some((s) => check(s, v, at).length === 0)) errs.push(`${at}: matches no anyOf branch`);
  if (schema.oneOf) {
    const n = (schema.oneOf as Schema[]).filter((s) => check(s, v, at).length === 0).length;
    if (n !== 1) errs.push(`${at}: matches ${n} oneOf branches, not 1`);
  }
  if (typeof v === "string") {
    const n = [...v].length;
    if (typeof schema.minLength === "number" && n < schema.minLength) errs.push(`${at}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && n > schema.maxLength) errs.push(`${at}: longer than ${schema.maxLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(v)) errs.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof v === "number") {
    if (typeof schema.minimum === "number" && v < schema.minimum) errs.push(`${at}: below ${schema.minimum}`);
    if (typeof schema.maximum === "number" && v > schema.maximum) errs.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(v)) {
    if (typeof schema.minItems === "number" && v.length < schema.minItems) errs.push(`${at}: fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) errs.push(`${at}: more than ${schema.maxItems} items`);
    if (isSchema(schema.items)) v.forEach((x, i) => errs.push(...check(schema.items as Schema, x, `${at}[${i}]`)));
  }
  if (typeOk(v, "object")) {
    const o = v as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const r of (schema.required ?? []) as string[]) if (!(r in o)) errs.push(`${at}: missing ${r}`);
    for (const [k, x] of Object.entries(o)) {
      if (isSchema(schema.propertyNames)) errs.push(...check(schema.propertyNames, k, `${at}.<${k}>`));
      if (props[k]) errs.push(...check(props[k], x, `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}: unknown key ${k}`);
      else if (isSchema(schema.additionalProperties)) errs.push(...check(schema.additionalProperties, x, `${at}.${k}`));
    }
  }
  return errs;
}

/** Every schema node of a JSON Schema (never a property name or an enum value), with its JSON path. */
function schemaNodes(s: Schema, at = "$", out: { at: string; s: Schema }[] = []): { at: string; s: Schema }[] {
  out.push({ at, s });
  for (const [k, x] of Object.entries((s.properties ?? {}) as Record<string, Schema>)) schemaNodes(x, `${at}.${k}`, out);
  if (isSchema(s.items)) schemaNodes(s.items, `${at}[]`, out);
  if (isSchema(s.additionalProperties)) schemaNodes(s.additionalProperties, `${at}<value>`, out);
  if (isSchema(s.propertyNames)) schemaNodes(s.propertyNames, `${at}<key>`, out);
  for (const word of ["anyOf", "oneOf"] as const) {
    ((s[word] ?? []) as Schema[]).forEach((x, i) => schemaNodes(x, `${at}|${i}`, out));
  }
  return out;
}

/** The node at a dotted path of keys, such as "properties.sources.items". */
function nodeAt(s: unknown, dotted: string): any {
  return dotted.split(".").reduce((node: any, key) => node[key], s);
}

// ── Valid drafts, built by hand and valid for Zod (asserted below) ───────────────────────────────

const draftSource = (id: string, n: number, published: string | null) => ({
  id, kind: "paper", title: "A made-up paper", publisher: "Example Journal", url: `https://example.org/paper/${n}`,
  doi: n === 1 ? "10.1234/example.1" : null, published_at: published,
});

/** A new finding with an AI role, a figure, a reaction and both kinds of term: every key holds a value. */
const aiFinding = (): any => ({
  ref: "new-1",
  field: "biology",
  subfield: "proteins",
  kind: "result",
  title: "A sample protein result",
  explainer: {
    found: "Sample found text.",
    matters: "Sample matters text.",
    ai_helped: "Sample System 3, from Example Lab, did the work.",
    how_sure: "Checked by Example Journal.",
    background: "Sample background text.",
    could_lead: "It could lead to sample uses.",
  },
  go_deeper: ["s1"],
  ai: {
    role: "ai_solved",
    confidence: "confirmed",
    systems: [{ name: "Sample System 3", maker: "Example Lab" }],
    evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: false }],
  },
  significance: "major",
  rung_history: [
    { rung: "preprint", date: "2026-11-10", source_id: "s2", note: "Posted as a preprint." },
    { rung: "checked", date: "2026-11-20", source_id: "s1", note: null },
  ],
  sources: [draftSource("s1", 1, "2026-11-20T09:30:00+08:00"), draftSource("s2", 2, "2026-11-10")],
  reactions: [{ source_id: "s2", who: "A. Example", affiliation: "Example University", quote: "a made-up reaction" }],
  artefacts: { doi: ["10.1234/example.1"], arxiv: ["2501.01234"], lean: [], trial: [], pdb: ["1abc"] },
  figure: {
    source_id: "s1", image_url: "https://example.org/figure-1.png", licence: "CC-BY-4.0", licence_quote: "Licensed under CC BY 4.0",
    credit: "Figure 1 from Example et al. (2026), CC BY 4.0", alt: "A made-up chart of a made-up result",
  },
  who: [{ name: "Example Lab", ror: "05gq02987" }, { name: "A. Example", ror: null }],
  terms: [{ new: true, term: "protein folding", definition: "How a chain of amino acids curls into a shape." }, { new: false, id: "enzyme" }],
  related: ["bio-2026-0002"],
  first_published: "2026-11-10",
});

/** A new finding with no AI role: no confidence, system, evidence or How AI helped, and no figure, reaction or term. */
const plainFinding = (): any => {
  const f = aiFinding();
  f.ref = "new-2";
  f.field = "mathematics";
  f.subfield = "number-theory";
  f.kind = "check";
  f.explainer.ai_helped = null;
  f.ai = { role: "none", confidence: null, systems: [], evidence: [] };
  f.figure = null;
  f.reactions = [];
  f.terms = [];
  f.related = [];
  return f;
};

const briefSource = (n: number) => draftSource(`b${n}`, 10 + n, n === 3 ? null : "2026-11-23");

const correction = (over: Record<string, unknown>): any => ({
  finding_id: null, edition_date: null, term_id: null, type: "correction", path: "title", after: "A better title.",
  reason: "The title was unclear.", source_url: null, report_id: null, ...over,
});

/** Every part of the draft in use at once (a Monday review and a Sunday deep dive both): a kitchen sink, not a real edition. */
const fullDraft = (): any => ({
  schema_version: 1,
  date: "2026-11-24",
  generated_at: "2026-11-24T04:10:00+08:00",
  lead: [
    { text: "A sample protein result leads today.", refs: ["new-1", "new-2"] },
    { text: "A proof is now published.", refs: ["math-2026-0002"] },
  ],
  story: "new-1",
  items: ["new-2", "math-2026-0002"],
  new_findings: [aiFinding(), plainFinding()],
  returning: [
    { finding_id: "math-2026-0002", update: "A journal published the proof.", source_ids: ["b1"], rung: { rung: "checked", date: "2026-11-23", source_id: "b1", note: null } },
    { finding_id: "phys-2026-0003", update: "A lab posted a notice.", source_ids: ["b2", "s1"], rung: null },
  ],
  rung_changes: [{ finding_id: "earth-2026-0004", rung: { rung: "disputed", date: "2026-11-23", source_id: "b2", note: "The lab posted a notice." } }],
  ideas: [{ text: "A made-up argument about method.", who: "A. Example", source_id: "b2" }],
  also: [{ title: "A made-up soil study", field: "earth", source_id: "b3" }],
  deep_dive: { finding_id: "bio-2026-0002", text: "A made-up deep dive.", source_ids: ["b1", "b2"], why_today: "rotation" },
  review: {
    big_picture: "A made-up week in review.",
    remarkable: { finding_id: "bio-2026-0002", note: "A made-up note." },
    strongest_against: { text: "A made-up counterpoint.", finding_ids: ["phys-2026-0003"], source_ids: ["b2"] },
  },
  corrections: [
    correction({ finding_id: "chem-2026-0004", path: "explainer.how_sure", after: "Checked by Example Journal.", source_url: "https://example.org/notice/1", report_id: "R-0002" }),
    correction({ edition_date: "2026-11-23", type: "clarification", path: "lead.0.text", after: "A clearer sentence." }),
    correction({ term_id: "enzyme", type: "update", path: "definition", after: "A protein that speeds up a reaction." }),
  ],
  report_decisions: [
    { report_id: "R-0001", outcome: "rejected", reason: "The source says this.", correction: null },
    { report_id: "R-0002", outcome: "upheld", reason: "The wording was unclear.", correction: 0 },
  ],
  sources: [briefSource(1), briefSource(2), briefSource(3)],
});

/** A quiet day: no finding, every list empty, every nullable null. */
const quietDraft = (): any => ({
  schema_version: 1,
  date: "2026-11-24",
  generated_at: "2026-11-24T04:10:00Z",
  lead: [{ text: "A quiet day: no finding met the bar.", refs: [] }],
  story: null,
  items: [],
  new_findings: [],
  returning: [],
  rung_changes: [],
  ideas: [],
  also: [],
  deep_dive: null,
  review: null,
  corrections: [],
  report_decisions: [],
  sources: [],
});

const fullZh = (): any => ({
  schema_version: 1,
  date: "2026-11-24",
  generated_at: "2026-11-24T04:18:00+08:00",
  strings: { "lead.0": "範例：今天的主要成果。", "new.new-1.title": "範例標題", "new.new-1.explainer.found": "範例內容。" },
  terms: {
    "protein-folding": { zh: "蛋白質摺疊", definition: "範例定義。", official: "蛋白質摺疊", official_url: "https://terms.naer.edu.tw/detail/1234567/" },
    enzyme: { zh: "酵素", definition: "範例定義。", official: null, official_url: null },
  },
});

const emptyZh = (): any => ({ schema_version: 1, date: "2026-11-24", generated_at: "2026-11-24T04:18:00+08:00", strings: {}, terms: {} });

// ── Breaking a valid value everywhere ────────────────────────────────────────────────────────────

const WRONG = { __wrong__: 1 };
type Step = string | number;

const pathText = (p: Step[]) => `$${p.map((k) => (typeof k === "number" ? `[${k}]` : `.${k}`)).join("")}`;

/** A deep copy of `value` with the node at `p` replaced, or removed when `replacement` is undefined. */
function changeAt(value: unknown, p: Step[], replacement: unknown): unknown {
  if (p.length === 0) return structuredClone(replacement);
  const copy: any = structuredClone(value);
  const parent = p.slice(0, -1).reduce((node: any, key) => node[key], copy);
  const last = p[p.length - 1]!;
  if (replacement === undefined) delete parent[last];
  else parent[last] = structuredClone(replacement);
  return copy;
}

/**
 * Every structural breakage of a valid value: each node replaced by an object of no known shape (and a string by a number,
 * a number or a boolean by a string), each object given an unknown key, and each key of each object removed (not of a map,
 * whose keys may be few: `maps` lists their paths). No result is valid anywhere in these schemas.
 */
function breakages(valid: unknown, maps: readonly string[] = []): { label: string; value: unknown }[] {
  const out: { label: string; value: unknown }[] = [];
  const visit = (node: unknown, p: Step[]) => {
    const here = pathText(p);
    out.push({ label: `${here} replaced by an object of no known shape`, value: changeAt(valid, p, WRONG) });
    if (typeof node === "string") out.push({ label: `${here} (a string) replaced by a number`, value: changeAt(valid, p, 42) });
    if (typeof node === "number" || typeof node === "boolean") out.push({ label: `${here} (a ${typeof node}) replaced by a string`, value: changeAt(valid, p, "42") });
    if (Array.isArray(node)) {
      node.forEach((x, i) => visit(x, [...p, i]));
    } else if (node !== null && typeof node === "object") {
      out.push({ label: `${here} given an unknown key`, value: changeAt(valid, [...p, "__extra__"], 1) });
      for (const [k, x] of Object.entries(node)) {
        if (!maps.includes(here)) out.push({ label: `${here}.${k} removed`, value: changeAt(valid, [...p, k], undefined) });
        visit(x, [...p, k]);
      }
    }
  };
  visit(valid, []);
  return out;
}

// ── The two files, in one table ──────────────────────────────────────────────────────────────────

const FILES = [
  {
    name: "draft-brief", path: DRAFT_SCHEMA_PATH, render: renderDraftSchema, object: draftSchema, zod: DraftBrief as z.ZodType,
    title: "Unveiling Tracker DraftBrief",
    says: [
      "drafts/YYYY-MM-DD.json (SPEC.md §4.5)", "Generated from lib/schema/draft.ts by", "no other key is allowed, and each value has the type, enum, id pattern, length or item count shown",
      "are enforced by the validator (SPEC.md §4.12)", "such as a real calendar date and ai_helped agreeing with ai.role",
    ],
  },
  {
    name: "draft-zh", path: DRAFT_ZH_SCHEMA_PATH, render: renderDraftZhSchema, object: draftZhSchema, zod: DraftZh as z.ZodType,
    title: "Unveiling Tracker DraftZh",
    says: [
      "drafts/YYYY-MM-DD.zh.json (SPEC.md §4.6)", "Generated from lib/schema/draft-zh.ts by", "no other key is allowed, except in the maps strings and terms, whose keys come from the context file",
      "The validator enforces the rest: that strings has exactly the context's keys and terms exactly its terms with no Chinese yet, each string's character cap,",
      "that you add no number, name or link the English lacks, Taiwan usage", "such as a real calendar date",
    ],
  },
] as const;

/** What every file's header description must say; each file's own list (`says`) adds what is true of it alone. */
const HEADER_SAYS = [
  "do not edit by hand",
  "`npm run schema:gen`",
  "This file shows structure only: every key of an object is required",
  "together with checks no JSON Schema keyword can state",
  "A draft that satisfies this file can still fail validation.",
];

// The Zod schema and the JSON Schema, node by node: the same shape, and the same description at each node.

function align(s: z.ZodType, j: Schema, here: string, found: { nodes: number; described: number; problems: string[] }, root = false): void {
  found.nodes += 1;
  const description = s.description;
  if (description !== undefined) found.described += 1;
  // The file's own header takes the root's description.
  if (!root && j.description !== description) found.problems.push(`${here}: Zod says ${JSON.stringify(description)}, the file ${JSON.stringify(j.description)}`);
  if (s instanceof z.ZodObject) {
    const keys = Object.keys(s.shape);
    if (j.type !== "object") found.problems.push(`${here}: a Zod object, but the file says ${String(j.type)}`);
    if (JSON.stringify(Object.keys((j.properties ?? {}) as object)) !== JSON.stringify(keys)) found.problems.push(`${here}: the keys differ or are out of order`);
    if (JSON.stringify(j.required) !== JSON.stringify(keys)) found.problems.push(`${here}: required is not every key in order`);
    if (j.additionalProperties !== false) found.problems.push(`${here}: not closed`);
    for (const k of keys) align(s.shape[k] as z.ZodType, (j.properties as Record<string, Schema>)[k] ?? {}, `${here}.${k}`, found);
  } else if (s instanceof z.ZodArray) {
    if (j.type !== "array") found.problems.push(`${here}: a Zod array, but the file says ${String(j.type)}`);
    align(s.element as z.ZodType, (j.items ?? {}) as Schema, `${here}[]`, found);
  } else if (s instanceof z.ZodNullable) {
    const branches = (j.anyOf ?? []) as Schema[];
    if (branches.length !== 2 || JSON.stringify(branches[1]) !== '{"type":"null"}') found.problems.push(`${here}: a nullable should be anyOf [value, null]`);
    else align(s.unwrap() as z.ZodType, branches[0]!, `${here}?`, found);
  } else if (s instanceof z.ZodUnion) {
    const discriminated = (s as unknown as { def: { discriminator?: string } }).def.discriminator !== undefined;
    const branches = (discriminated ? j.oneOf : j.anyOf) as Schema[] | undefined;
    if (!branches || branches.length !== s.options.length) found.problems.push(`${here}: the union's branches are not the file's`);
    else s.options.forEach((o, i) => align(o as z.ZodType, branches[i]!, `${here}|${i}`, found));
  } else if (s instanceof z.ZodRecord) {
    if (j.type !== "object") found.problems.push(`${here}: a Zod record, but the file says ${String(j.type)}`);
    align(s.keyType as z.ZodType, (j.propertyNames ?? {}) as Schema, `${here}<key>`, found);
    align(s.valueType as z.ZodType, (j.additionalProperties ?? {}) as Schema, `${here}<value>`, found);
  } else if (![z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodLiteral, z.ZodEnum].some((leaf) => s instanceof leaf)) {
    found.problems.push(`${here}: the walk does not know this kind of schema (${(s as unknown as { def: { type: string } }).def.type}): add it`);
  }
}

describe.each(FILES)("$path", (f) => {
  const text = f.render();
  const committed = read(f.path);
  const parsed = JSON.parse(committed) as Schema;

  it("is current: the committed file is exactly what the generator renders (schema:check)", () => {
    expect(committed).toBe(text);
  });

  it("renders the same bytes every time, from a fresh object each time", () => {
    expect(f.render()).toBe(text);
    expect(JSON.stringify(f.object())).toBe(JSON.stringify(f.object()));
    const object = f.object();
    object.title = "changed";
    expect(f.object().title).toBe(f.title);
  });

  it("is the schema object printed: parsing the file gives the object, and printing that gives the file", () => {
    expect(parsed).toEqual(f.object());
    expect(`${printJson(parsed)}\n`).toBe(committed);
  });

  it("ends in one newline, uses LF only and holds no tab, no trailing space and no blank line", () => {
    expect(committed.endsWith("}\n")).toBe(true);
    expect(committed).not.toMatch(/\n\n/);
    expect(committed).not.toContain("\r");
    expect(committed).not.toContain("\t");
    expect(committed).not.toMatch(/ \n/);
  });

  it("keeps every line under 1,000 characters, and the whole file within one read", () => {
    const stats = schemaFileStats(committed);
    const long = committed.split("\n").map((l, i) => [i + 1, l.length] as const).filter(([, n]) => n >= SCHEMA_LINE_LIMIT);
    expect(long).toEqual([]);
    expect(stats.longestLine).toBeLessThan(SCHEMA_LINE_LIMIT);
    // The Read tool shows 2,000 lines at most (the rest would be missing without a word) and refuses a file past its token
    // budget, so the files stay well inside both (about 4 characters a token).
    expect(stats.lines).toBeLessThan(2000);
    expect(stats.bytes).toBeLessThan(80_000);
  });

  it("reports its size for the PR, and the size is the file's", () => {
    const stats = schemaFileStats(committed);
    console.log(`${f.path}: ${stats.bytes} bytes, ${stats.lines} lines, longest line ${stats.longestLine} characters (line ${stats.longestLineNo})`);
    expect(stats.bytes).toBe(fs.statSync(path.join(root, f.path)).size);
    expect(stats.lines).toBe(committed.split("\n").length - 1);
    expect(committed.split("\n")[stats.longestLineNo - 1]!.length).toBe(stats.longestLine);
  });

  it("is draft 2020-12, titled, with its header first and the schema after it", () => {
    expect(Object.keys(parsed).slice(0, 5)).toEqual(["$schema", "title", "description", "type", "properties"]);
    expect(Object.keys(parsed)).toEqual(["$schema", "title", "description", "type", "properties", "required", "additionalProperties"]);
    expect(parsed.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(parsed.title).toBe(f.title);
    expect(parsed.type).toBe("object");
  });

  it("says what it is, and that it shows structure only and a draft that satisfies it can still fail", () => {
    const description = parsed.description as string;
    for (const part of [...HEADER_SAYS, ...f.says]) expect(description.includes(part), part).toBe(true);
    expect(description.length).toBeLessThan(900);
  });

  it("holds no em dash, no en dash outside a digit range, no tab and no model identifier", () => {
    expect(committed).not.toContain(EM);
    expect(committed).not.toMatch(new RegExp(`(?<!\\d)${EN}|${EN}(?!\\d)`));
    expect(committed).not.toMatch(modelRe("i"));
  });

  it("uses only keywords that assert or annotate: no format, no comment, no reference, nothing this checker skips", () => {
    const used = new Set(schemaNodes(parsed).flatMap(({ s }) => Object.keys(s)));
    expect([...used].filter((k) => !KNOWN.has(k))).toEqual([]);
    for (const k of ["format", "$comment", "$ref", "$defs", "default", "examples", "deprecated", "readOnly", "contentMediaType"]) expect(used.has(k), k).toBe(false);
    // Every keyword but the annotations is one a validator enforces, and the file uses most of them.
    expect([...used].filter((k) => !ANNOTATIONS.has(k)).length).toBeGreaterThanOrEqual(8);
  });

  it("closes every object and requires every key, or is a map with a key pattern and a value schema", () => {
    const objects = schemaNodes(parsed).filter(({ s }) => s.type === "object");
    expect(objects.length).toBeGreaterThanOrEqual(2);
    const maps: string[] = [];
    for (const { at: here, s } of objects) {
      if (s.properties !== undefined) {
        expect(s.additionalProperties, here).toBe(false);
        expect(s.required, here).toEqual(Object.keys(s.properties as object));
        expect(s.propertyNames, here).toBeUndefined();
      } else {
        maps.push(here);
        expect(isSchema(s.propertyNames), here).toBe(true);
        expect(isSchema(s.additionalProperties), here).toBe(true);
        expect(s.required, here).toBeUndefined();
      }
    }
    // Only the Chinese pass's strings and terms are maps: their keys come from its context file.
    expect(maps).toEqual(f.name === "draft-zh" ? ["$.strings", "$.terms"] : []);
  });

  it("holds every .describe() text of the Zod schema at the node it describes, and no other text", () => {
    const found = { nodes: 0, described: 0, problems: [] as string[] };
    align(f.zod, parsed, "$", found, true);
    expect(found.problems).toEqual([]);
    // The walk reached the whole tree, and the header is the only description the schema does not have.
    const texts = schemaNodes(parsed).filter(({ s }) => s.description !== undefined);
    expect(texts.length).toBe(found.described + 1);
    expect(found.described).toBeGreaterThanOrEqual(f.name === "draft-zh" ? 8 : 80);
    expect(found.nodes).toBeGreaterThanOrEqual(f.name === "draft-zh" ? 15 : 180);
  });
});

describe("the English file shows what the agent must produce", () => {
  const parsed = JSON.parse(read(DRAFT_SCHEMA_PATH)) as Schema;
  const finding = nodeAt(parsed, "properties.new_findings.items");

  it("states the budgets and rules the validator enforces, so the agent sees them", () => {
    const text = JSON.stringify(parsed);
    for (const part of [
      "At most 12 words", "Story at most 55 words", "Story at most 60 words", "230 to 280 words", "70 to 100 words", "450 to 550 words", "270 to 330 words",
      "at most 120 in a week of fewer than 3 findings", "At most 25 words", "At most 40 words", "0 to 2", "0 to 5", "At most 4", "At most 5 existing findings",
      "1 to 3 ids of this finding's primary sources", "1 to 3 sentences, at most 60 words in all", "null exactly when ai.role is none",
      "Non-null exactly on Mondays", "Sundays only", "Never press, an archive or a redirect wrapper",
    ]) expect(text.includes(part), part).toBe(true);
  });

  it("lists the vocabularies the agent must use, in their order", () => {
    expect(finding.properties.field.enum).toEqual([...FIELDS]);
    expect(nodeAt(parsed, "properties.also.items.properties.field.enum")).toEqual([...FIELDS]);
    expect(finding.properties.kind.enum).toEqual([...FINDING_KINDS]);
    expect(finding.properties.kind.enum).not.toContain("idea");
    expect(finding.properties.significance.enum).toEqual([...SIGNIFICANCE]);
    expect(finding.properties.ai.properties.role.enum).toEqual([...AI_ROLES]);
    expect(finding.properties.ai.properties.confidence.anyOf[0].enum).toEqual([...AI_CONFIDENCE]);
    expect(finding.properties.rung_history.items.properties.rung.enum).toEqual([...ALL_RUNGS]);
    expect(finding.properties.sources.items.properties.kind.enum).toEqual([...SOURCE_KINDS]);
    expect(finding.properties.figure.anyOf[0].properties.licence.enum).toEqual([...FIGURE_LICENCES]);
    expect(nodeAt(parsed, "properties.corrections.items.properties.type.enum")).toEqual([...CORRECTION_TYPES]);
    expect(nodeAt(parsed, "properties.deep_dive.anyOf.0.properties.why_today.enum")).toEqual([...WHY_TODAY]);
    expect(nodeAt(parsed, "properties.report_decisions.items.properties.outcome.enum")).toEqual([...DECIDED_REPORT_STATUS]);
  });

  it("gives each id its format: finding ids with the field codes, refs, sources, terms, reports and dates", () => {
    expect(finding.properties.related.items.pattern).toBe(ID_PATTERNS.finding.source);
    expect(ID_PATTERNS.finding.source).toContain(`(?:${FIELD_CODES.join("|")})`);
    expect(nodeAt(parsed, "properties.returning.items.properties.finding_id.pattern")).toBe(ID_PATTERNS.finding.source);
    expect(nodeAt(parsed, "properties.items.items.pattern")).toBe(`^(?:${ID_PATTERNS.newRef.source.slice(1, -1)}|${ID_PATTERNS.finding.source.slice(1, -1)})$`);
    expect(finding.properties.ref.pattern).toBe(ID_PATTERNS.newRef.source);
    expect(finding.properties.go_deeper.items.pattern).toBe(ID_PATTERNS.findingSource.source);
    expect(nodeAt(parsed, "properties.sources.items.properties.id.pattern")).toBe(ID_PATTERNS.briefSource.source);
    expect(nodeAt(parsed, "properties.ideas.items.properties.source_id.pattern")).toBe(ID_PATTERNS.briefSource.source);
    expect(finding.properties.rung_history.items.properties.source_id.pattern).toBe(ID_PATTERNS.findingSource.source);
    expect(nodeAt(parsed, "properties.returning.items.properties.source_ids.items.pattern")).toBe(ID_PATTERNS.source.source);
    expect(finding.properties.terms.items.oneOf[1].properties.id.pattern).toBe(ID_PATTERNS.term.source);
    expect(finding.properties.terms.items.oneOf[1].properties.id.maxLength).toBe(TERM_ID_MAX);
    expect(nodeAt(parsed, "properties.report_decisions.items.properties.report_id.pattern")).toBe(ID_PATTERNS.report.source);
    expect(nodeAt(parsed, "properties.date.pattern")).toBe("^\\d{4}-\\d{2}-\\d{2}$");
    expect(finding.properties.first_published.pattern).toBe("^\\d{4}-\\d{2}-\\d{2}$");
    expect(nodeAt(parsed, "properties.generated_at.pattern")).toContain("T\\d{2}:\\d{2}");
  });

  it("keeps the explainer's six parts in order, every one required, and the draft's sixteen keys in the spec's order", () => {
    expect(Object.keys(finding.properties.explainer.properties)).toEqual(["found", "matters", "ai_helped", "how_sure", "background", "could_lead"]);
    expect(parsed.required).toEqual([
      "schema_version", "date", "generated_at", "lead", "story", "items", "new_findings", "returning", "rung_changes", "ideas", "also",
      "deep_dive", "review", "corrections", "report_decisions", "sources",
    ]);
    expect(finding.required).toEqual([
      "ref", "field", "subfield", "kind", "title", "explainer", "go_deeper", "ai", "significance", "rung_history", "sources", "reactions",
      "artefacts", "figure", "who", "terms", "related", "first_published",
    ]);
  });

  it("holds no key for a field a script or the config fills (a draft that writes one fails)", () => {
    const top = Object.keys(parsed.properties as object);
    for (const k of ["format", "languages", "published_at", "late", "pace", "computed", "provenance", "status_note", "reports", "disclosure"]) expect(top, k).not.toContain(k);
    for (const k of ["id", "depth", "first_brief", "briefs", "since_then", "updated", "rung", "seen_as", "added"]) {
      expect(Object.keys(finding.properties), k).not.toContain(k);
    }
    expect(Object.keys(finding.properties.sources.items.properties)).toEqual(["id", "kind", "title", "publisher", "url", "doi", "published_at"]);
  });

  it("shows the caps that are plain lengths and counts, and the one-or-more lists", () => {
    expect(finding.properties.rung_history.minItems).toBe(1);
    expect(finding.properties.who.minItems).toBe(1);
    expect(finding.properties.who.maxItems).toBe(8);
    expect(finding.properties.sources.items.properties.title.maxLength).toBe(200);
    expect(finding.properties.sources.items.properties.publisher.maxLength).toBe(80);
    expect(finding.properties.ai.properties.systems.items.properties.name.maxLength).toBe(60);
    expect(finding.properties.figure.anyOf[0].properties.credit.maxLength).toBe(120);
    expect(nodeAt(parsed, "properties.corrections.items.properties.after.maxLength")).toBe(300);
    expect(nodeAt(parsed, "properties.corrections.items.properties.path.maxLength")).toBe(60);
  });
});

describe("the Chinese file shows what the pass must produce", () => {
  const parsed = JSON.parse(read(DRAFT_ZH_SCHEMA_PATH)) as Schema;

  it("has the five keys of the spec in order", () => {
    expect(parsed.required).toEqual(["schema_version", "date", "generated_at", "strings", "terms"]);
    expect(Object.keys(parsed.properties as object)).toEqual(["schema_version", "date", "generated_at", "strings", "terms"]);
    expect(nodeAt(parsed, "properties.schema_version")).toEqual({ type: "number", const: 1 });
  });

  it("shows strings as a map of non-empty strings and terms as a map keyed by term id", () => {
    expect(nodeAt(parsed, "properties.strings.propertyNames")).toEqual({ type: "string", minLength: 1 });
    expect(nodeAt(parsed, "properties.strings.additionalProperties")).toEqual({ type: "string", minLength: 1 });
    const terms = nodeAt(parsed, "properties.terms");
    expect(terms.propertyNames).toEqual({ type: "string", maxLength: TERM_ID_MAX, pattern: ID_PATTERNS.term.source });
    expect(terms.additionalProperties.required).toEqual(["zh", "definition", "official", "official_url"]);
    expect(terms.additionalProperties.additionalProperties).toBe(false);
  });

  it("tells the pass what its strings and terms are, in the descriptions", () => {
    const text = JSON.stringify(parsed);
    for (const part of [
      "Exactly the context's keys, each with its Chinese string", "Exactly the context's terms whose zh is null, by term id",
      "The Chinese term, in everyday Taiwan usage", "within the context term's cap_chars", "a non-null official comes with one",
      "before the context's deadline",
    ]) expect(text.includes(part), part).toBe(true);
  });
});

// ── What the files accept and refuse ─────────────────────────────────────────────────────────────

describe("the drafts these tests use are valid for Zod, so that what the files accept is what the validator accepts", () => {
  it("the full draft uses every part of the draft", () => {
    expect(DraftBrief.safeParse(fullDraft()).error?.issues ?? []).toEqual([]);
    const d = fullDraft();
    expect(d.story).not.toBeNull();
    expect(d.deep_dive).not.toBeNull();
    expect(d.review.remarkable).not.toBeNull();
    expect(d.new_findings[0].figure).not.toBeNull();
    expect(d.new_findings[0].terms.map((t: { new: boolean }) => t.new)).toEqual([true, false]);
    expect(d.new_findings[1].ai.role).toBe("none");
    expect(d.returning.map((r: { rung: unknown }) => r.rung === null)).toEqual([false, true]);
    expect(d.corrections.map((c: any) => [c.finding_id !== null, c.edition_date !== null, c.term_id !== null])).toEqual([[true, false, false], [false, true, false], [false, false, true]]);
    expect(d.sources.map((s: { published_at: string | null }) => s.published_at === null)).toEqual([false, false, true]);
  });

  it("the quiet draft has every list empty and every nullable null", () => {
    expect(DraftBrief.safeParse(quietDraft()).error?.issues ?? []).toEqual([]);
  });

  it("the Chinese drafts hold terms with and without an official term, and none at all", () => {
    expect(DraftZh.safeParse(fullZh()).error?.issues ?? []).toEqual([]);
    expect(DraftZh.safeParse(emptyZh()).error?.issues ?? []).toEqual([]);
  });

  it("the Chinese sample holds no character the Taiwan usage list calls simplified", () => {
    const list = (JSON.parse(read("config/terms-zh.json")) as { simplified_only: string | string[] }).simplified_only;
    const simplified = new Set(typeof list === "string" ? [...list] : list);
    const han = JSON.stringify(fullZh()).match(/\p{Script=Han}/gu) ?? [];
    expect(han.length).toBeGreaterThan(20);
    expect(han.filter((ch) => simplified.has(ch))).toEqual([]);
  });
});

describe("the English file against drafts", () => {
  const schema = JSON.parse(read(DRAFT_SCHEMA_PATH)) as Schema;

  it("accepts the full draft, the quiet draft and a draft with each optional part in turn, as Zod does", () => {
    expect(check(schema, fullDraft())).toEqual([]);
    expect(check(schema, quietDraft())).toEqual([]);
    for (const [label, change] of [
      ["no story", (d: any) => { d.story = null; }],
      ["no deep dive", (d: any) => { d.deep_dive = null; }],
      ["no review", (d: any) => { d.review = null; }],
      ["a review with no remarkable finding", (d: any) => { d.review.remarkable = null; }],
      ["no figure", (d: any) => { d.new_findings[0].figure = null; }],
      ["no rung entry note", (d: any) => { d.new_findings[0].rung_history[0].note = null; }],
      ["a source with no date", (d: any) => { d.new_findings[0].sources[0].published_at = null; }],
      ["a source with no DOI", (d: any) => { d.new_findings[0].sources[0].doi = null; }],
      ["the largest counts: 8 who entries", (d: any) => { d.new_findings[0].who = Array.from({ length: 8 }, (_, i) => ({ name: `Person ${i}`, ror: null })); }],
      ["a returning finding with a rung of a brief source", (d: any) => { d.returning[1].rung = d.returning[0].rung; }],
    ] as const) {
      const d = fullDraft();
      change(d);
      expect(DraftBrief.safeParse(d).success, label).toBe(true);
      expect(check(schema, d), label).toEqual([]);
    }
  });

  it("accepts every value of each vocabulary the agent may write", () => {
    for (const [label, apply, values] of [
      ["field", (d: any, v: string) => { d.new_findings[0].field = v; }, FIELDS],
      ["kind", (d: any, v: string) => { d.new_findings[0].kind = v; }, FINDING_KINDS],
      ["significance", (d: any, v: string) => { d.new_findings[0].significance = v; }, SIGNIFICANCE],
      ["rung", (d: any, v: string) => { d.new_findings[0].rung_history[0].rung = v; }, ALL_RUNGS],
      ["source kind", (d: any, v: string) => { d.new_findings[0].sources[0].kind = v; }, SOURCE_KINDS],
      ["licence", (d: any, v: string) => { d.new_findings[0].figure.licence = v; }, FIGURE_LICENCES],
      ["correction type", (d: any, v: string) => { d.corrections[0].type = v; }, CORRECTION_TYPES],
      ["why today", (d: any, v: string) => { d.deep_dive.why_today = v; }, WHY_TODAY],
      ["outcome", (d: any, v: string) => { d.report_decisions[0].outcome = v; }, DECIDED_REPORT_STATUS],
      ["AI confidence", (d: any, v: string) => { d.new_findings[0].ai.confidence = v; }, AI_CONFIDENCE],
    ] as const) {
      for (const value of values) {
        const d = fullDraft();
        apply(d, value);
        expect(check(schema, d), `${label} ${value}`).toEqual([]);
      }
    }
    for (const role of AI_ROLES) {
      const d = fullDraft();
      d.new_findings[0].ai.role = role;
      expect(check(schema, d), role).toEqual([]);
    }
  });

  it("rejects a missing key, an unknown key, a wrong type, a wrong enum value and a bad id, each with its own message", () => {
    const run = (change: (d: any) => void) => {
      const d = fullDraft();
      change(d);
      expect(DraftBrief.safeParse(d).success).toBe(false);
      return check(schema, d);
    };
    expect(run((d) => { delete d.review; })).toEqual(["$: missing review"]);
    expect(run((d) => { d.gap = { quoted: [] }; })).toEqual(["$: unknown key gap"]);
    expect(run((d) => { d.new_findings[0].cves = []; })).toEqual(["$.new_findings[0]: unknown key cves"]);
    expect(run((d) => { d.sources[0].tier = 1; })).toEqual(["$.sources[0]: unknown key tier"]);
    expect(run((d) => { d.date = 20261124; })).toEqual(["$.date: expected string"]);
    expect(run((d) => { d.items = "new-2"; })).toEqual(["$.items: expected array"]);
    expect(run((d) => { d.new_findings[0].ai.evidence[0].from_claimant = "no"; })).toEqual(["$.new_findings[0].ai.evidence[0].from_claimant: expected boolean"]);
    expect(run((d) => { d.new_findings[0].field = "biologyx"; })).toEqual(["$.new_findings[0].field: not in enum"]);
    expect(run((d) => { d.new_findings[0].kind = "idea"; })).toEqual(["$.new_findings[0].kind: not in enum"]);
    expect(run((d) => { d.deep_dive.why_today = "weekly"; })).toEqual(["$.deep_dive: matches no anyOf branch"]);
    expect(run((d) => { d.items = ["BAD"]; })[0]).toBe(`$.items[0]: does not match ${nodeAt(schema, "properties.items.items.pattern")}`);
    expect(run((d) => { d.new_findings[0].ref = "new-0"; })).toEqual([`$.new_findings[0].ref: does not match ${ID_PATTERNS.newRef.source}`]);
    expect(run((d) => { d.sources[0].id = "s1"; })).toEqual([`$.sources[0].id: does not match ${ID_PATTERNS.briefSource.source}`]);
    expect(run((d) => { d.new_findings[0].sources[0].id = "b1"; })).toEqual([`$.new_findings[0].sources[0].id: does not match ${ID_PATTERNS.findingSource.source}`]);
    expect(run((d) => { d.report_decisions[0].report_id = "R-1"; })).toEqual([`$.report_decisions[0].report_id: does not match ${ID_PATTERNS.report.source}`]);
    expect(run((d) => { d.date = "24 Nov 2026"; })).toEqual(["$.date: does not match ^\\d{4}-\\d{2}-\\d{2}$"]);
    expect(run((d) => { d.schema_version = 2; })).toEqual(["$.schema_version: expected 1"]);
    expect(run((d) => { d.new_findings[0].terms[0].new = "yes"; })).toEqual(["$.new_findings[0].terms[0]: matches 0 oneOf branches, not 1"]);
    expect(run((d) => { d.new_findings[0].terms[1].term = "enzyme"; })).toEqual(["$.new_findings[0].terms[1]: matches 0 oneOf branches, not 1"]);
  });

  it("rejects text that is empty or too long, and lists that are too short or too long", () => {
    const run = (change: (d: any) => void) => {
      const d = fullDraft();
      change(d);
      expect(DraftBrief.safeParse(d).success).toBe(false);
      return check(schema, d);
    };
    expect(run((d) => { d.new_findings[0].title = ""; })).toEqual(["$.new_findings[0].title: shorter than 1"]);
    expect(run((d) => { d.new_findings[0].sources[0].title = "x".repeat(201); })).toEqual(["$.new_findings[0].sources[0].title: longer than 200"]);
    expect(run((d) => { d.new_findings[0].ai.systems[0].name = "x".repeat(61); })).toEqual(["$.new_findings[0].ai.systems[0].name: longer than 60"]);
    expect(run((d) => { d.corrections[0].after = "x".repeat(301); })).toEqual(["$.corrections[0].after: longer than 300"]);
    expect(run((d) => { d.corrections[0].path = "x".repeat(61); })).toEqual(["$.corrections[0].path: longer than 60"]);
    expect(run((d) => { d.new_findings[0].rung_history = []; })).toEqual(["$.new_findings[0].rung_history: fewer than 1 items"]);
    expect(run((d) => { d.new_findings[0].who = []; })).toEqual(["$.new_findings[0].who: fewer than 1 items"]);
    expect(run((d) => { d.new_findings[0].who = Array.from({ length: 9 }, (_, i) => ({ name: `Person ${i}`, ror: null })); })).toEqual(["$.new_findings[0].who: more than 8 items"]);
    expect(run((d) => { d.report_decisions[1].correction = -1; })).toEqual(["$.report_decisions[1].correction: matches no anyOf branch"]);
    expect(run((d) => { d.report_decisions[1].correction = 1.5; })).toEqual(["$.report_decisions[1].correction: matches no anyOf branch"]);
  });

  it("rejects every structural breakage of a valid draft, and Zod rejects each too", () => {
    for (const valid of [fullDraft(), quietDraft()]) {
      const ms = breakages(valid);
      const surprises: string[] = [];
      for (const { label, value } of ms) {
        if (DraftBrief.safeParse(value).success) surprises.push(`Zod accepts: ${label}`);
        if (check(schema, value).length === 0) surprises.push(`the file accepts: ${label}`);
      }
      expect(surprises).toEqual([]);
    }
    // The full draft has many nodes: the sweep is not a handful of cases.
    expect(breakages(fullDraft()).length).toBeGreaterThan(700);
    expect(breakages(quietDraft()).length).toBeGreaterThan(30);
  });

  it("says nothing of the refinements Zod adds: a draft Zod refuses for them satisfies the file", () => {
    const cases: [string, (d: any) => void][] = [
      ["a date that is no real day", (d) => { d.date = "2026-02-30"; }],
      ["a timestamp that is no real instant", (d) => { d.generated_at = "2026-11-24T25:00:00+08:00"; }],
      ["a DOI in capitals", (d) => { d.new_findings[0].sources[0].doi = "10.1234/EXAMPLE.1"; }],
      ["How AI helped on a finding with no AI role", (d) => { d.new_findings[1].explainer.ai_helped = "An AI helped."; }],
      ["no How AI helped on a finding with an AI role", (d) => { d.new_findings[0].explainer.ai_helped = null; }],
      ["an AI role with no evidence entry", (d) => { d.new_findings[0].ai.evidence = []; }],
      ["a correction that names two records", (d) => { d.corrections[0].term_id = "enzyme"; }],
      ["a correction that names no record", (d) => { d.corrections[0].finding_id = null; }],
      ["a correction whose path is no value of its record", (d) => { d.corrections[0].path = "no_such_key"; }],
      ["a removed correction whose after is not the removed text", (d) => { d.corrections[0].type = "removed"; d.corrections[0].path = "title"; }],
    ];
    for (const [label, change] of cases) {
      const d = fullDraft();
      change(d);
      expect(DraftBrief.safeParse(d).success, `Zod refuses ${label}`).toBe(false);
      expect(check(schema, d), `the file accepts ${label}`).toEqual([]);
    }
  });
});

describe("the Chinese file against drafts", () => {
  const schema = JSON.parse(read(DRAFT_ZH_SCHEMA_PATH)) as Schema;

  it("accepts a draft with strings and terms, and one with none, as Zod does", () => {
    expect(check(schema, fullZh())).toEqual([]);
    expect(check(schema, emptyZh())).toEqual([]);
    const d = fullZh();
    d.generated_at = "2026-11-24T04:18:00Z";
    d.strings["a.key.with.dots-and spaces"] = "範例";
    d.terms["a".repeat(TERM_ID_MAX)] = d.terms.enzyme;
    expect(DraftZh.safeParse(d).success).toBe(true);
    expect(check(schema, d)).toEqual([]);
  });

  it("rejects a missing key, an unknown key, a wrong type and a bad key or value, each with its own message", () => {
    const run = (change: (d: any) => void) => {
      const d = fullZh();
      change(d);
      expect(DraftZh.safeParse(d).success).toBe(false);
      return check(schema, d);
    };
    expect(run((d) => { delete d.terms; })).toEqual(["$: missing terms"]);
    expect(run((d) => { d.items = []; })).toEqual(["$: unknown key items"]);
    expect(run((d) => { d.schema_version = 2; })).toEqual(["$.schema_version: expected 1"]);
    expect(run((d) => { d.generated_at = "04:18"; })).toEqual([`$.generated_at: does not match ${nodeAt(schema, "properties.generated_at.pattern")}`]);
    expect(run((d) => { d.strings = ["範例"]; })).toEqual(["$.strings: expected object"]);
    expect(run((d) => { d.strings["lead.0"] = 42; })).toEqual(["$.strings.lead.0: expected string"]);
    expect(run((d) => { d.strings["lead.0"] = ""; })).toEqual(["$.strings.lead.0: shorter than 1"]);
    expect(run((d) => { d.strings[""] = "範例"; })).toEqual(["$.strings.<>: shorter than 1"]);
    expect(run((d) => { d.terms.Enzyme = d.terms.enzyme; })).toEqual([`$.terms.<Enzyme>: does not match ${ID_PATTERNS.term.source}`]);
    expect(run((d) => { d.terms.enzyme_two = d.terms.enzyme; })).toEqual([`$.terms.<enzyme_two>: does not match ${ID_PATTERNS.term.source}`]);
    expect(run((d) => { d.terms["a".repeat(TERM_ID_MAX + 1)] = d.terms.enzyme; })).toEqual([`$.terms.<${"a".repeat(TERM_ID_MAX + 1)}>: longer than ${TERM_ID_MAX}`]);
    expect(run((d) => { delete d.terms.enzyme.official_url; })).toEqual(["$.terms.enzyme: missing official_url"]);
    expect(run((d) => { d.terms.enzyme.extra = 1; })).toEqual(["$.terms.enzyme: unknown key extra"]);
    expect(run((d) => { d.terms.enzyme.official = ""; })).toEqual(["$.terms.enzyme.official: matches no anyOf branch"]);
    expect(run((d) => { d.terms.enzyme.zh = null; })).toEqual(["$.terms.enzyme.zh: expected string"]);
  });

  it("rejects every structural breakage of a valid draft, and Zod rejects each too", () => {
    for (const valid of [fullZh(), emptyZh()]) {
      const surprises: string[] = [];
      for (const { label, value } of breakages(valid, ["$.strings", "$.terms"])) {
        if (DraftZh.safeParse(value).success) surprises.push(`Zod accepts: ${label}`);
        if (check(schema, value).length === 0) surprises.push(`the file accepts: ${label}`);
      }
      expect(surprises).toEqual([]);
    }
    expect(breakages(fullZh(), ["$.strings", "$.terms"]).length).toBeGreaterThan(40);
  });

  it("says nothing of the refinements Zod adds: a date that is no real day satisfies the file", () => {
    for (const change of [(d: any) => { d.date = "2026-02-30"; }, (d: any) => { d.generated_at = "2026-11-24T25:00:00+08:00"; }]) {
      const d = fullZh();
      change(d);
      expect(DraftZh.safeParse(d).success).toBe(false);
      expect(check(schema, d)).toEqual([]);
    }
  });
});

// ── The valid drafts the fixtures build: the files must accept them ──────────────────────────────

describe("the valid fixture drafts (SPEC §4.12, Fixtures)", () => {
  /** The valid drafts of a fixture folder: `valid-<day>` and the suffix, and no input file that shares the folder. */
  const validDrafts = (dir: string, suffix: string): string[] => {
    const abs = path.join(root, dir);
    const pattern = new RegExp(`^valid-[a-z]+(?:-[a-z]+)*${suffix.replace(/\./g, "\\.")}$`);
    return fs.existsSync(abs) ? fs.readdirSync(abs).filter((n) => pattern.test(n)).sort() : [];
  };

  it("the English ones satisfy draft-brief.schema.json, as they satisfy Zod, and the file refuses a changed copy of each", () => {
    const schema = JSON.parse(read(DRAFT_SCHEMA_PATH)) as Schema;
    const names = validDrafts("fixtures/drafts", ".json");
    expect(names).toEqual(expect.arrayContaining(["valid-weekday.json", "valid-sunday.json", "valid-monday.json", "valid-monday-short.json"]));
    for (const name of names) {
      const draft = JSON.parse(read(`fixtures/drafts/${name}`));
      expect(check(schema, draft), name).toEqual([]);
      expect(DraftBrief.safeParse(draft).success, name).toBe(true);
      // The check is not vacuous: an extra key, a missing key and a wrong type each fail it.
      expect(check(schema, { ...draft, extra: 1 }), name).toEqual(["$: unknown key extra"]);
      const without = { ...draft };
      delete without.story;
      expect(check(schema, without), name).toEqual(["$: missing story"]);
      expect(check(schema, { ...draft, items: "none" }), name).toEqual(["$.items: expected array"]);
    }
  });

  it("the Chinese ones, once fixtures/drafts-zh/ exists, satisfy draft-zh.schema.json, as they satisfy Zod", () => {
    const schema = JSON.parse(read(DRAFT_ZH_SCHEMA_PATH)) as Schema;
    const names = validDrafts("fixtures/drafts-zh", ".zh.json");
    console.log(`valid Chinese fixture drafts checked against ${DRAFT_ZH_SCHEMA_PATH}: ${names.length}`);
    // The folder comes with the Chinese fixtures: a valid draft for each valid English one (SPEC §4.12).
    if (fs.existsSync(path.join(root, "fixtures/drafts-zh"))) {
      expect(names).toEqual(expect.arrayContaining(["valid-weekday.zh.json", "valid-sunday.zh.json", "valid-monday.zh.json", "valid-monday-short.zh.json"]));
    }
    for (const name of names) {
      const draft = JSON.parse(read(`fixtures/drafts-zh/${name}`));
      expect(check(schema, draft), name).toEqual([]);
      expect(DraftZh.safeParse(draft).success, name).toBe(true);
      expect(check(schema, { ...draft, extra: 1 }), name).toEqual(["$: unknown key extra"]);
      const without = { ...draft };
      delete without.terms;
      expect(check(schema, without), name).toEqual(["$: missing terms"]);
    }
  });
});

// ── The checker itself: a wrong one would pass or fail everything above ──────────────────────────

describe("the checker these tests use", () => {
  const ok = (schema: Schema, value: unknown) => expect(check(schema, value), JSON.stringify(value)).toEqual([]);
  const bad = (schema: Schema, value: unknown, message: string) => expect(check(schema, value), JSON.stringify(value)).toEqual([message]);

  it("checks types, one or several", () => {
    ok({ type: "string" }, "a");
    bad({ type: "string" }, 1, "$: expected string");
    ok({ type: "number" }, 1.5);
    bad({ type: "number" }, "1", "$: expected number");
    ok({ type: "integer" }, 2);
    bad({ type: "integer" }, 2.5, "$: expected integer");
    ok({ type: "boolean" }, false);
    bad({ type: "boolean" }, 0, "$: expected boolean");
    ok({ type: "null" }, null);
    bad({ type: "null" }, 0, "$: expected null");
    ok({ type: "array" }, []);
    bad({ type: "array" }, {}, "$: expected array");
    ok({ type: "object" }, {});
    bad({ type: "object" }, [], "$: expected object");
    bad({ type: "object" }, null, "$: expected object");
    ok({ type: ["string", "null"] }, null);
    bad({ type: ["string", "null"] }, 1, "$: expected string or null");
    expect(() => check({ type: "date" }, "x")).toThrow("unknown type date");
  });

  it("checks const, enum, anyOf and oneOf", () => {
    ok({ const: 1 }, 1);
    bad({ const: 1 }, 2, "$: expected 1");
    bad({ const: true }, "true", "$: expected true");
    ok({ enum: ["a", "b"] }, "b");
    bad({ enum: ["a", "b"] }, "c", "$: not in enum");
    ok({ anyOf: [{ type: "string" }, { type: "null" }] }, null);
    bad({ anyOf: [{ type: "string" }, { type: "null" }] }, 1, "$: matches no anyOf branch");
    ok({ oneOf: [{ type: "string" }, { type: "null" }] }, "a");
    bad({ oneOf: [{ type: "string" }, { type: "string", minLength: 1 }] }, "a", "$: matches 2 oneOf branches, not 1");
    bad({ oneOf: [{ type: "string" }, { type: "null" }] }, 1, "$: matches 0 oneOf branches, not 1");
  });

  it("checks string lengths by characters, and patterns as Unicode patterns", () => {
    ok({ minLength: 2, maxLength: 3 }, "ab");
    ok({ minLength: 2, maxLength: 3 }, "abc");
    bad({ minLength: 2 }, "a", "$: shorter than 2");
    bad({ maxLength: 3 }, "abcd", "$: longer than 3");
    ok({ maxLength: 1 }, "😀");
    ok({ pattern: "^a+$" }, "aaa");
    bad({ pattern: "^a+$" }, "ab", "$: does not match ^a+$");
    ok({ pattern: "a" }, "bab");
    ok({ pattern: "^\\p{Script=Han}+$" }, "範例");
    expect(() => check({ pattern: "[" }, "a")).toThrow();
    ok({ minLength: 5, pattern: "^a$" }, 7);
  });

  it("checks numbers, and array lengths and items", () => {
    ok({ minimum: 0, maximum: 9 }, 0);
    ok({ minimum: 0, maximum: 9 }, 9);
    bad({ minimum: 0 }, -1, "$: below 0");
    bad({ maximum: 9 }, 10, "$: above 9");
    ok({ minItems: 1, maxItems: 2 }, [1]);
    ok({ minItems: 1, maxItems: 2 }, [1, 2]);
    bad({ minItems: 1 }, [], "$: fewer than 1 items");
    bad({ maxItems: 2 }, [1, 2, 3], "$: more than 2 items");
    ok({ items: { type: "number" } }, [1, 2]);
    expect(check({ items: { type: "number" } }, [1, "2", 3, "4"])).toEqual(["$[1]: expected number", "$[3]: expected number"]);
  });

  it("checks required keys, unknown keys, property schemas, map values and key names", () => {
    const obj = { type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"], additionalProperties: false };
    ok(obj, { a: "x" });
    ok(obj, { a: "x", b: 1 });
    bad(obj, { b: 1 }, "$: missing a");
    bad(obj, { a: "x", c: 1 }, "$: unknown key c");
    bad(obj, { a: 1 }, "$.a: expected string");
    ok({ properties: { a: { type: "string" } } }, { a: "x", extra: 1 });
    const map = { type: "object", propertyNames: { pattern: "^[a-z]+$" }, additionalProperties: { type: "number" } };
    ok(map, {});
    ok(map, { ab: 1 });
    bad(map, { ab: "x" }, "$.ab: expected number");
    bad(map, { A: 1 }, "$.<A>: does not match ^[a-z]+$");
    ok({ properties: { A: { type: "number" } }, additionalProperties: { type: "string" } }, { A: 1, b: "x" });
    bad({ properties: { A: { type: "number" } }, additionalProperties: { type: "string" } }, { A: 1, b: 2 }, "$.b: expected string");
  });

  it("throws on a keyword it does not evaluate, so that a new one cannot pass unchecked", () => {
    expect(() => check({ type: "string", format: "date" }, "x")).toThrow("keyword format at $ is not handled by this test");
    expect(() => check({ properties: { a: { uniqueItems: true } } }, { a: [] })).toThrow("keyword uniqueItems at $.a");
    expect(() => check({ anyOf: [{ $ref: "#/x" }] }, 1)).toThrow("keyword $ref");
  });

  it("walks schema nodes and not property names, and finds keys in a path", () => {
    const s: Schema = { type: "object", properties: { type: { type: "string" }, list: { type: "array", items: { enum: ["a"] } } }, required: ["type"] };
    expect(schemaNodes(s).map((n) => n.at)).toEqual(["$", "$.type", "$.list", "$.list[]"]);
    expect(schemaNodes({ oneOf: [{ type: "null" }], propertyNames: { type: "string" }, additionalProperties: { type: "number" } }).map((n) => n.at))
      .toEqual(["$", "$<value>", "$<key>", "$|0"]);
    expect(nodeAt({ a: { b: [1, { c: 2 }] } }, "a.b.1.c")).toBe(2);
  });

  it("breaks a value in every way, and no way leaves it valid", () => {
    const valid = { a: "x", n: 1, list: [true], map: { k: "v" }, nothing: null };
    const ms = breakages(valid, ["$.map"]);
    const labels = ms.map((m) => m.label);
    expect(labels).toContain("$ replaced by an object of no known shape");
    expect(labels).toContain("$ given an unknown key");
    expect(labels).toContain("$.a removed");
    expect(labels).toContain("$.a (a string) replaced by a number");
    expect(labels).toContain("$.n (a number) replaced by a string");
    expect(labels).toContain("$.list[0] (a boolean) replaced by a string");
    expect(labels).toContain("$.list[0] replaced by an object of no known shape");
    expect(labels).toContain("$.nothing removed");
    expect(labels).toContain("$.map given an unknown key");
    expect(labels).not.toContain("$.map.k removed");
    expect(labels).toContain("$.map.k (a string) replaced by a number");
    expect(ms).toHaveLength(19);
    expect(ms.find((m) => m.label === "$.a removed")!.value).toEqual({ n: 1, list: [true], map: { k: "v" }, nothing: null });
    expect(ms.find((m) => m.label === "$.list[0] (a boolean) replaced by a string")!.value).toEqual({ ...valid, list: ["42"] });
    expect(ms.find((m) => m.label === "$ replaced by an object of no known shape")!.value).toEqual(WRONG);
    expect(valid).toEqual({ a: "x", n: 1, list: [true], map: { k: "v" }, nothing: null });
  });
});

// ── The printer and the size facts ───────────────────────────────────────────────────────────────

describe("printJson", () => {
  it("keeps short values on one line, with no spaces, and prints scalars as JSON", () => {
    expect(printJson({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
    expect(printJson(null)).toBe("null");
    expect(printJson("a\"b\n")).toBe('"a\\"b\\n"');
    expect(printJson(5)).toBe("5");
    expect(printJson(true)).toBe("true");
    expect(printJson([])).toBe("[]");
    expect(printJson({})).toBe("{}");
    // A scalar has nothing to break: it stays whole at any width and indent, null too.
    expect(printJson(null, "", 2)).toBe("null");
    expect(printJson(null, "      ", 0)).toBe("null");
    expect(printJson(12345, "", 2)).toBe("12345");
    expect(printJson(true, "    ", 1)).toBe("true");
    expect(printJson("abcdef", "", 2)).toBe('"abcdef"');
  });

  it("breaks a value whose flat form is longer than the width, and not one of exactly the width", () => {
    const flat110 = ["a".repeat(106)];
    expect(JSON.stringify(flat110)).toHaveLength(110);
    expect(printJson(flat110)).toBe(JSON.stringify(flat110));
    const flat111 = ["a".repeat(107)];
    expect(printJson(flat111)).toBe(`[\n  "${"a".repeat(107)}"\n]`);
    // The indent counts: at an indent of 2 the width is 108 for the value itself.
    expect(printJson(flat110, "  ")).toBe(`[\n    "${"a".repeat(106)}"\n  ]`);
    expect(printJson(["a".repeat(104)], "  ")).toBe(`["${"a".repeat(104)}"]`);
    // The object's flat form is 19 characters, and its array's 7 (plus the 2 of indent it is printed at).
    const small = { a: 1, b: [1, 2, 3] };
    expect(printJson(small, "", 19)).toBe('{"a":1,"b":[1,2,3]}');
    expect(printJson(small, "", 18)).toBe('{\n  "a": 1,\n  "b": [1,2,3]\n}');
    expect(printJson(small, "", 9)).toBe('{\n  "a": 1,\n  "b": [1,2,3]\n}');
    expect(printJson(small, "", 8)).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    3\n  ]\n}');
  });

  it("breaks a long array one entry to a line and a long object one key to a line, nested to two spaces a level", () => {
    const big = { list: Array.from({ length: 40 }, (_, i) => `value-${i}`), nested: { k: "v".repeat(120), short: [1, 2] }, n: null };
    const out = printJson(big);
    expect(JSON.parse(out)).toEqual(big);
    expect(out.split("\n").filter((l) => /^ {4}"value-\d+",?$/.test(l))).toHaveLength(40);
    expect(out).toContain('{\n  "list": [\n    "value-0",\n    "value-1",');
    expect(out).toContain('    "value-39"\n  ],\n  "nested": {\n    "k": "' + "v".repeat(120) + '",\n    "short": [1,2]\n  },\n  "n": null\n}');
    expect(out.startsWith("{\n")).toBe(true);
    expect(out.endsWith("\n}")).toBe(true);
  });

  it("passes the width and the indent down to the entries of an array, as it does to the values of an object", () => {
    const pair = [[1, 2], [3, 4]];
    // Flat the pair is 13 characters and each entry 5 (and 2 more for the indent it is printed at).
    expect(printJson(pair, "", 13)).toBe("[[1,2],[3,4]]");
    expect(printJson(pair, "", 12)).toBe("[\n  [1,2],\n  [3,4]\n]");
    expect(printJson(pair, "", 7)).toBe("[\n  [1,2],\n  [3,4]\n]");
    expect(printJson(pair, "", 6)).toBe("[\n  [\n    1,\n    2\n  ],\n  [\n    3,\n    4\n  ]\n]");
    expect(printJson([[1, 2, 3, 4, 5]], "", 10)).toBe("[\n  [\n    1,\n    2,\n    3,\n    4,\n    5\n  ]\n]");
    // An object in an array in an object, three levels down, and the closing brackets at their own indents.
    expect(printJson({ a: [{ b: 1 }] }, "", 8)).toBe('{\n  "a": [\n    {\n      "b": 1\n    }\n  ]\n}');
  });

  it("starts from the indent it is given, in the closing bracket too", () => {
    const value = { k: "v".repeat(120) };
    expect(printJson(value, "    ")).toBe(`{\n      "k": "${"v".repeat(120)}"\n    }`);
  });

  it("keeps the order of the keys, never splits or escapes a string beyond JSON's rules, and leaves Chinese as it is", () => {
    expect(printJson({ b: 1, a: 2 })).toBe('{"b":1,"a":2}');
    expect(printJson({ z: 1, a: ["x".repeat(120)], m: 2 })).toBe(`{\n  "z": 1,\n  "a": [\n    "${"x".repeat(120)}"\n  ],\n  "m": 2\n}`);
    const text = `${"樂詞網 ".repeat(40)}"quoted" \\ end`;
    const out = printJson({ text });
    expect(out).toBe(`{\n  "text": ${JSON.stringify(text)}\n}`);
    expect(out).toContain("樂詞網");
    expect(printJson({ z: ["樂"] })).toBe('{"z":["樂"]}');
  });

  it("round-trips: parsing what it prints gives the value", () => {
    for (const v of [
      { a: [{ b: [] }, {}, null, "x".repeat(200), 1.5, true], c: { d: { e: ["y".repeat(120), ["z".repeat(120)]] } } },
      [[[]], [[1, 2, 3]], "s"],
      draftSchema(),
      draftZhSchema(),
    ]) expect(JSON.parse(printJson(v))).toEqual(JSON.parse(JSON.stringify(v)));
  });
});

describe("schemaFileStats", () => {
  it("counts bytes as UTF-8, and lines with or without the final newline", () => {
    expect(schemaFileStats("樂\n")).toEqual({ bytes: 4, lines: 1, longestLine: 1, longestLineNo: 1 });
    expect(schemaFileStats("a\nb\n").lines).toBe(2);
    expect(schemaFileStats("a\nb").lines).toBe(2);
    expect(schemaFileStats("a\n\n").lines).toBe(2);
    expect(schemaFileStats("\n").lines).toBe(1);
    expect(schemaFileStats("a").lines).toBe(1);
    expect(schemaFileStats("")).toEqual({ bytes: 0, lines: 0, longestLine: 0, longestLineNo: 0 });
  });

  it("finds the longest line and its number, the first of equals, and counts UTF-16 units as the reader does", () => {
    expect(schemaFileStats("ab\nabcd\nabc\n")).toMatchObject({ longestLine: 4, longestLineNo: 2 });
    expect(schemaFileStats("abc\nxyz\nab\n")).toMatchObject({ longestLine: 3, longestLineNo: 1 });
    expect(schemaFileStats("ab\nabc\nxyz")).toMatchObject({ longestLine: 3, longestLineNo: 2 });
    expect(schemaFileStats("a\n😀\n")).toMatchObject({ longestLine: 2, longestLineNo: 2, bytes: 7 });
    expect(schemaFileStats("a\n\n\nb")).toMatchObject({ longestLine: 1, longestLineNo: 1, lines: 4 });
  });
});

describe("the module's exports", () => {
  it("names the two files as the spec does, and lists both for the script", () => {
    expect([DRAFT_SCHEMA_PATH, DRAFT_ZH_SCHEMA_PATH]).toEqual(["routine/schema/draft-brief.schema.json", "routine/schema/draft-zh.schema.json"]);
    expect(SCHEMA_LINE_LIMIT).toBe(1000);
    expect(SCHEMA_FILES.map((s) => s.path)).toEqual([DRAFT_SCHEMA_PATH, DRAFT_ZH_SCHEMA_PATH]);
    expect(SCHEMA_FILES[0]!.render()).toBe(renderDraftSchema());
    expect(SCHEMA_FILES[1]!.render()).toBe(renderDraftZhSchema());
    expect(renderDraftSchema()).not.toBe(renderDraftZhSchema());
  });

  it("builds each file from its own schema", () => {
    expect(draftSchema().title).toBe("Unveiling Tracker DraftBrief");
    expect(draftZhSchema().title).toBe("Unveiling Tracker DraftZh");
    expect(Object.keys((draftSchema().properties as object))).toEqual(Object.keys(DraftBrief.shape));
    expect(Object.keys((draftZhSchema().properties as object))).toEqual(Object.keys(DraftZh.shape));
    expect(renderDraftSchema()).toBe(`${printJson(draftSchema())}\n`);
    expect(renderDraftZhSchema()).toBe(`${printJson(draftZhSchema())}\n`);
  });

  it("describes each file for the agent that reads it: the draft's name and place, and its spec section", () => {
    const en = draftSchema().description as string;
    const zh = draftZhSchema().description as string;
    expect(en.startsWith("The English drafting agent's one output file, drafts/YYYY-MM-DD.json (SPEC.md §4.5). ")).toBe(true);
    expect(zh.startsWith("The Chinese pass's one output file, drafts/YYYY-MM-DD.zh.json (SPEC.md §4.6). ")).toBe(true);
    expect(en).toContain("Generated from lib/schema/draft.ts by `npm run schema:gen`");
    expect(zh).toContain("Generated from lib/schema/draft-zh.ts by `npm run schema:gen`");
    expect(en).toContain("The word budgets, counts, cross-references and other rules in the descriptions are enforced by the validator (SPEC.md §4.12)");
    expect(en).toContain("such as a real calendar date and ai_helped agreeing with ai.role");
    expect(zh).toContain("except in the maps strings and terms, whose keys come from the context file");
    expect(zh).toContain("that strings has exactly the context's keys and terms exactly its terms with no Chinese yet");
    expect(zh).toContain("that you add no number, name or link the English lacks");
    expect(zh).toContain("such as a real calendar date");
  });
});

// ── What the spec says of them ───────────────────────────────────────────────────────────────────

describe("the spec", () => {
  const spec = read("SPEC.md");

  it("lists both files in the tree, and has the Chinese pass read the second (§9.5)", () => {
    expect(spec).toContain("schema/draft-brief.schema.json, draft-zh.schema.json  # Generated from Zod; CI checks they are current");
    expect(spec).toContain(`"Read(${DRAFT_ZH_SCHEMA_PATH})"`);
    expect(spec).toContain("`routine/schema/draft-brief.schema.json`");
  });

  it("gives the two scripts this CLI serves (§8.1), and the check CI runs gains the second (§10 P1 item 8)", () => {
    const from = spec.indexOf("### 8.1 package.json scripts");
    const fence = spec.indexOf("```json\n", from) + "```json\n".length;
    const scripts = (JSON.parse(spec.slice(fence, spec.indexOf("\n```", fence))) as { scripts: Record<string, string> }).scripts;
    expect(scripts["schema:gen"]).toBe("tsx scripts/gen-json-schema.ts");
    expect(scripts["schema:check"]).toBe("tsx scripts/gen-json-schema.ts --check");
    expect(scripts.check).toContain("npm run schema:check");
  });
});

// ── The script ───────────────────────────────────────────────────────────────────────────────────

describe("scripts/gen-json-schema.ts", () => {
  const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
  const script = path.join(root, "scripts/gen-json-schema.ts");
  const files = SCHEMA_FILES.map((s) => ({ path: s.path, text: s.render() }));
  const facts = (text: string) => {
    const s = schemaFileStats(text);
    return `${s.bytes} bytes, ${s.lines} lines, longest line ${s.longestLine} characters`;
  };

  /** Runs the script (or a copy of it) with `cwd` as its working directory. */
  const run = (cwd: string, args: string[] = [], file = script, env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [tsx, file, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const withDir = <T>(body: (dir: string) => T): T => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-schema-"));
    try {
      return body(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const exists = (dir: string, rel: string) => fs.existsSync(path.join(dir, rel));
  const slurp = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

  it("writes both files, prints their facts, and writes the same bytes again", () => {
    withDir((dir) => {
      const first = run(dir);
      expect(first).toMatchObject({ code: 0, err: "" });
      expect(first.out).toBe(files.map((f) => `Wrote ${f.path} (${facts(f.text)}).\n`).join(""));
      for (const f of files) expect(slurp(dir, f.path)).toBe(f.text);
      expect(run(dir).out).toBe(first.out);
      for (const f of files) expect(slurp(dir, f.path)).toBe(f.text);
    });
  }, 60_000);

  it("replaces a stale file, whole", () => {
    withDir((dir) => {
      expect(run(dir).code).toBe(0);
      fs.writeFileSync(path.join(dir, files[1]!.path), "{}\n");
      expect(run(dir).code).toBe(0);
      expect(slurp(dir, files[1]!.path)).toBe(files[1]!.text);
    });
  }, 60_000);

  it("--check names every missing file and writes nothing", () => {
    withDir((dir) => {
      const r = run(dir, ["--check"]);
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toBe(files.map((f) => `${f.path} is missing; run npm run schema:gen and commit the result.\n`).join(""));
      expect(exists(dir, "routine")).toBe(false);
    });
  }, 60_000);

  it("--check passes on current files and prints their facts", () => {
    withDir((dir) => {
      expect(run(dir).code).toBe(0);
      const r = run(dir, ["--check"]);
      expect(r).toMatchObject({ code: 0, err: "" });
      expect(r.out).toBe(files.map((f) => `${f.path} is current (${facts(f.text)}).\n`).join(""));
    });
  }, 60_000);

  it("--check names the stale file and not the current one, and never rewrites a file", () => {
    withDir((dir) => {
      expect(run(dir).code).toBe(0);
      fs.appendFileSync(path.join(dir, files[1]!.path), " ");
      const r = run(dir, ["--check"]);
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toBe(`${files[1]!.path} is stale; run npm run schema:gen and commit the result.\n`);
      expect(slurp(dir, files[1]!.path)).toBe(`${files[1]!.text} `);
      expect(slurp(dir, files[0]!.path)).toBe(files[0]!.text);

      fs.rmSync(path.join(dir, files[0]!.path));
      fs.appendFileSync(path.join(dir, files[1]!.path), "\n");
      const both = run(dir, ["--check"]);
      expect(both.code).toBe(1);
      expect(both.err).toBe(
        `${files[0]!.path} is missing; run npm run schema:gen and commit the result.\n${files[1]!.path} is stale; run npm run schema:gen and commit the result.\n`,
      );
      expect(exists(dir, files[0]!.path)).toBe(false);
      expect(slurp(dir, files[1]!.path)).toBe(`${files[1]!.text} \n`);
    });
  }, 60_000);

  it("refuses an argument it does not know, writes nothing, and says what it takes", () => {
    withDir((dir) => {
      for (const args of [["--chek"], ["--check", "--fix"], ["check"], ["--write"], ["--chek", "--fix"], ["--fix", "--check", "--chek"]]) {
        const r = run(dir, args);
        expect(r.code, args.join(" ")).toBe(2);
        expect(r.out).toBe("");
        expect(r.err).toBe(`Unknown argument ${args.find((a) => a !== "--check")}. Usage: tsx scripts/gen-json-schema.ts [--check]\n`);
      }
      expect(exists(dir, "routine")).toBe(false);
    });
  }, 60_000);

  it("fails on a line the agents' reader would cut, in either mode, and then writes nothing at all", () => {
    withDir((dir) => {
      // A copy of the script beside a stand-in for the library whose second file has a line of the length asked for.
      fs.mkdirSync(path.join(dir, "scripts"));
      fs.mkdirSync(path.join(dir, "lib"));
      fs.copyFileSync(script, path.join(dir, "scripts/gen-json-schema.ts"));
      fs.writeFileSync(path.join(dir, "lib/json-schema.ts"), [
        `export * from ${JSON.stringify(path.join(root, "lib/json-schema.ts"))};`,
        'export const SCHEMA_FILES = [',
        '  { path: "routine/schema/short.json", render: () => "short\\n" },',
        '  { path: "routine/schema/long.json", render: () => `ok\\n${"x".repeat(Number(process.env.LINE))}\\n` },',
        '];',
        "",
      ].join("\n"));
      const copy = path.join(dir, "scripts/gen-json-schema.ts");

      const long = run(dir, [], copy, { LINE: String(SCHEMA_LINE_LIMIT) });
      expect(long.code).toBe(1);
      expect(long.out).toBe("");
      expect(long.err).toBe(`Line 2 of routine/schema/long.json has ${SCHEMA_LINE_LIMIT} characters; the limit is under ${SCHEMA_LINE_LIMIT}.\n`);
      expect(exists(dir, "routine")).toBe(false);
      const checked = run(dir, ["--check"], copy, { LINE: String(SCHEMA_LINE_LIMIT) });
      expect(checked.code).toBe(1);
      expect(checked.err).toBe(long.err);

      const fits = run(dir, [], copy, { LINE: String(SCHEMA_LINE_LIMIT - 1) });
      expect(fits).toMatchObject({ code: 0, err: "" });
      expect(fits.out).toBe(
        "Wrote routine/schema/short.json (6 bytes, 1 lines, longest line 5 characters).\n"
        + `Wrote routine/schema/long.json (${3 + SCHEMA_LINE_LIMIT} bytes, 2 lines, longest line ${SCHEMA_LINE_LIMIT - 1} characters).\n`,
      );
      expect(run(dir, ["--check"], copy, { LINE: String(SCHEMA_LINE_LIMIT - 1) }).code).toBe(0);
    });
  }, 60_000);

  it("names every file with a line the reader would cut, in the order of the list", () => {
    withDir((dir) => {
      fs.mkdirSync(path.join(dir, "scripts"));
      fs.mkdirSync(path.join(dir, "lib"));
      fs.copyFileSync(script, path.join(dir, "scripts/gen-json-schema.ts"));
      fs.writeFileSync(path.join(dir, "lib/json-schema.ts"), [
        `export * from ${JSON.stringify(path.join(root, "lib/json-schema.ts"))};`,
        'export const SCHEMA_FILES = [',
        '  { path: "routine/schema/first.json", render: () => `${"x".repeat(1500)}\\n` },',
        '  { path: "routine/schema/fine.json", render: () => "fine\\n" },',
        '  { path: "routine/schema/last.json", render: () => `a\\nb\\n${"y".repeat(1000)}\\n` },',
        '];',
        "",
      ].join("\n"));
      const copy = path.join(dir, "scripts/gen-json-schema.ts");
      for (const args of [[], ["--check"]]) {
        const r = run(dir, args, copy);
        expect(r.code, args.join(" ")).toBe(1);
        expect(r.out).toBe("");
        expect(r.err).toBe(
          "Line 1 of routine/schema/first.json has 1500 characters; the limit is under 1000.\n"
          + "Line 3 of routine/schema/last.json has 1000 characters; the limit is under 1000.\n",
        );
      }
      expect(exists(dir, "routine")).toBe(false);
    });
  }, 60_000);
});

// ── These files ──────────────────────────────────────────────────────────────────────────────────

describe("the files of this change", () => {
  it("hold no em dash and no en dash outside a digit range", () => {
    for (const rel of ["lib/json-schema.ts", "scripts/gen-json-schema.ts", "tests/json-schema.test.ts", DRAFT_SCHEMA_PATH, DRAFT_ZH_SCHEMA_PATH]) {
      const body = read(rel);
      expect(body, rel).not.toContain(EM);
      expect(body, rel).not.toMatch(new RegExp(`(?<!\\d)${EN}|${EN}(?!\\d)`));
      expect(body, rel).not.toMatch(modelRe("i"));
    }
  });
});
