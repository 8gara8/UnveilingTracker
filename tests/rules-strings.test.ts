// The string inventory (lib/rules/strings.ts, SPEC §4.12): every string of every record is classified once, through the one
// table of path patterns per record type, and the table matches the schemas exactly; a stored `removed` correction marks
// the strings it rewrote and no other; and each selector holds exactly the strings its §4.12 row names. The records are made
// from the schemas themselves (every key filled, every list two long, every string different), so a key added to a schema
// without a table row fails here, as does a row that names no key. The hand-written GOLDEN table is a second copy of the
// classification, written from the spec's rows, so a wrong kind in the code is not copied into the test.
//
// New for this project; Cyber's field walkers (`proseFields()` and the like) were one hand-written list per rule set and
// had no counterpart to test.

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Lang } from "@/lib/i18n";
import { byCodeUnit } from "@/lib/ids";
import { BriefBase, type Brief } from "@/lib/schema/brief";
import { DraftBrief, REMOVABLE_PATHS, type CorrectionRecord } from "@/lib/schema/draft";
import { DraftZh, ZhContext } from "@/lib/schema/draft-zh";
import { FindingBase, type Finding } from "@/lib/schema/finding";
import { Term } from "@/lib/schema/glossary";
import { CorrectionBase, ReportBase, type Correction, type Report } from "@/lib/schema/misc";
import { REMOVED_TEXT } from "@/lib/vocab";
import {
  EXPLAINER_FIELDS, PATH_TABLES, blockedHostStrings, dashStrings, definitionStrings, draftInventory, dualUseStrings, everyString,
  explainerStrings, files, hypeStrings, modelProse, pageProse, parseZhKey, publishedInventory, quoteStrings, readingStrings,
  removedPaths, removedProse, urlStrings, zhAll, zhInventory, zhKeyed, zhText,
  type Inventory, type NameKind, type ProseField, type RecordRef, type RecordType, type StringEntry, type StringKind, type UrlKind,
} from "@/lib/rules/strings";
import { formatPath, type BeingPublished } from "@/lib/rules/types";
import { D, deepFreeze, storedWorld, weekdayDraft } from "./helpers/rule-world";

// ── Records made from the schemas ────────────────────────────────────────────────────────────────

type Segment = string | number;

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  entries?: Record<string, string>;
  values?: unknown[];
  in?: z.ZodType;
  items?: z.ZodType[];
}

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** An `L10n`: an object of exactly `en` and `zh`, a string and a nullable string (a brief's `languages` has the same keys and is not one). */
const isL10nDef = (def: Def): boolean =>
  Object.keys(def.shape ?? {}).join(",") === "en,zh" && defOf(def.shape!.en!).type === "string" && defOf(def.shape!.zh!).type === "nullable";

/** One string of a made-up record: where it sits, which side of an `L10n` it is (else null), and its text. */
interface Leaf {
  segments: Segment[];
  side: "en" | "zh" | null;
  text: string;
}

interface Made<T> {
  value: T;
  leaves: Leaf[];
}

/**
 * A maker of records from schemas: every key is filled (a nullable by its value, a union by its `pick`th form), every list
 * is two long, every string is different from every other the maker has made (an enum takes its first value).
 */
function makeSynth(): <T>(schema: z.ZodType, pick?: number) => Made<T> {
  let n = 0;
  return <T>(schema: z.ZodType, pick = 0): Made<T> => {
    const leaves: Leaf[] = [];
    const fresh = (): string => `x${++n}`;
    const walk = (s: z.ZodType, at: Segment[]): unknown => {
      const def = defOf(s);
      switch (def.type) {
        case "object": {
          if (isL10nDef(def)) {
            const value = { en: fresh(), zh: fresh() };
            leaves.push({ segments: at, side: "en", text: value.en }, { segments: at, side: "zh", text: value.zh });
            return value;
          }
          return Object.fromEntries(Object.entries(def.shape!).map(([key, child]) => [key, walk(child, [...at, key])]));
        }
        case "array": return [0, 1].map((i) => walk(def.element!, [...at, i]));
        case "tuple": return def.items!.map((child, i) => walk(child, [...at, i]));
        case "nullable":
        case "optional": return walk(def.innerType!, at);
        case "union": return walk(def.options![pick % def.options!.length]!, at);
        case "pipe": return walk(def.in!, at);
        case "enum": {
          const value = Object.values(def.entries!)[0]!;
          leaves.push({ segments: at, side: null, text: value });
          return value;
        }
        case "literal": {
          const value = def.values![0];
          if (typeof value === "string") leaves.push({ segments: at, side: null, text: value });
          return value;
        }
        case "string": {
          const value = fresh();
          leaves.push({ segments: at, side: null, text: value });
          return value;
        }
        case "number": return 1;
        case "boolean": return true;
        default: throw new Error(`The schema walk met a ${def.type} at ${formatPath(at)}`);
      }
    };
    return { value: walk(schema, []) as T, leaves };
  };
}

const synth = makeSynth();
const draftA = synth<DraftBrief>(DraftBrief, 0);
const draftB = synth<DraftBrief>(DraftBrief, 1);
const briefM = synth<Brief>(BriefBase);
const findingM = synth<Finding>(FindingBase);
const termM = synth<Term>(Term);
const correctionM = synth<Correction>(CorrectionBase);
const reportM = synth<Report>(ReportBase);

const genericOf = (segments: readonly Segment[]): string => segments.map((s) => (typeof s === "number" ? "*" : s)).join(".");
const dotted = (segments: readonly Segment[]): string => segments.join(".");
const sideOf = (leaf: Leaf): string => (leaf.side === null ? "" : `.${leaf.side}`);

/** What the inventory should say about one made-up string. */
interface Expected {
  path: string;
  at: string;
  /** The path as the table writes it, from the root of its record (a new finding's, not the draft's). */
  generic: string;
  text: string;
  lang: Lang;
  record: RecordRef;
  finding: string | null;
}

function draftExpected(made: Made<DraftBrief>): Expected[] {
  const draft = made.value;
  const edition: Expected[] = [];
  const findings: Expected[] = [];
  for (const leaf of made.leaves) {
    const path = formatPath(leaf.segments) + sideOf(leaf);
    const lang: Lang = leaf.side === "zh" ? "zh" : "en";
    if (leaf.segments[0] === "new_findings") {
      const ref = draft.new_findings[leaf.segments[1] as number]!.ref;
      const relative = leaf.segments.slice(2);
      findings.push({ path, at: dotted(relative), generic: genericOf(relative), text: leaf.text, lang, record: { type: "new_finding", id: ref }, finding: ref });
    } else {
      edition.push({ path, at: dotted(leaf.segments), generic: genericOf(leaf.segments), text: leaf.text, lang, record: { type: "draft", id: draft.date }, finding: null });
    }
  }
  return [...edition, ...findings];
}

type StoredType = "brief" | "finding" | "term" | "correction" | "report";

function storedExpected(type: StoredType, made: Made<any>, index = 0): Expected[] {
  const v = made.value;
  const id: string = type === "brief" ? v.date : v.id;
  const file = type === "brief" ? files.brief(v.date) : type === "finding" ? files.finding(v.id)
    : type === "term" ? files.glossary : type === "correction" ? files.corrections : files.reports;
  const prefix: Segment[] = type === "term" ? ["terms", index] : type === "correction" ? ["corrections", index] : type === "report" ? ["reports", index] : [];
  return made.leaves.map((leaf) => {
    const inTerm = type === "term" && (leaf.segments[0] === "en" || leaf.segments[0] === "zh");
    return {
      path: `${file}: ${formatPath([...prefix, ...leaf.segments])}${sideOf(leaf)}`,
      at: dotted(inTerm ? leaf.segments.slice(1) : leaf.segments),
      generic: genericOf(leaf.segments),
      text: leaf.text,
      lang: leaf.side === "zh" || (type === "term" && leaf.segments[0] === "zh") ? "zh" : "en",
      record: { type, id },
      finding: type === "finding" ? id : null,
    };
  });
}

const beingAll = (w: { findings: Finding[]; terms: Term[]; corrections: Correction[]; reports: Report[] }): BeingPublished => ({
  brief: true,
  findings: new Set(w.findings.map((f) => f.id)),
  terms: new Set(w.terms.map((t) => t.id)),
  corrections: new Set(w.corrections.map((c) => c.id)),
  reports: new Set(w.reports.map((r) => r.id)),
});
const NOBODY: BeingPublished = { brief: false, findings: new Set(), terms: new Set(), corrections: new Set(), reports: new Set() };

const made = {
  brief: briefM.value, findings: [findingM.value], terms: [termM.value], corrections: [correctionM.value], reports: [reportM.value],
};
const storedLeaves: Expected[] = [
  ...storedExpected("brief", briefM), ...storedExpected("finding", findingM), ...storedExpected("term", termM),
  ...storedExpected("correction", correctionM), ...storedExpected("report", reportM),
];

// ── The golden table ─────────────────────────────────────────────────────────────────────────────

interface Facts {
  kind: StringKind;
  field?: string;
  name?: NameKind;
  url?: UrlKind;
}
const prose = (field: string): Facts => ({ kind: "prose", field });
const text = (field: string): Facts => ({ kind: "text", field });
const name = (n: NameKind): Facts => ({ kind: "name", name: n });
const url = (u: UrlKind): Facts => ({ kind: "url", url: u });

/**
 * What each path of a record is, from the spec's rows (§4.12 WORDS, NO_EM_DASH, HYPE_WORDS, QUOTE_VERBATIM, BLOCKED_HOST):
 * keyed by the path from the root of its record, an array index written `*`. A path not here is an id, a date or a
 * vocabulary value (kind `value`). A correction's `before` and `after` take the kind of the path they name (below).
 */
const GOLDEN: Record<string, Facts> = {
  title: prose("title"),
  "explainer.found": prose("found"), "explainer.matters": prose("matters"), "explainer.ai_helped": prose("ai_helped"),
  "explainer.how_sure": prose("how_sure"), "explainer.background": prose("background"), "explainer.could_lead": prose("could_lead"),
  "lead.*.text": prose("lead"),
  "returning.*.update": prose("update"), "story.update": prose("update"), "items.*.update": prose("update"),
  "since_then.*.text": prose("since_then"),
  "rung_history.*.note": prose("note"), "returning.*.rung.note": prose("note"), "rung_changes.*.rung.note": prose("note"),
  "ideas.*.text": prose("idea"), "also.*.title": prose("also"), "deep_dive.text": prose("deep_dive"),
  "review.big_picture": prose("big_picture"), "review.remarkable.note": prose("remarkable"), "review.strongest_against.text": prose("against"),
  "terms.*.definition": prose("definition"), "en.definition": prose("definition"), "zh.definition": prose("definition"),
  "figure.alt": prose("alt"),
  "corrections.*.reason": prose("reason"), "report_decisions.*.reason": prose("reason"), reason: prose("reason"),
  "ai.evidence.*.quote": { kind: "quote" }, "reactions.*.quote": { kind: "quote" }, "figure.licence_quote": { kind: "quote" },
  "sources.*.title": { kind: "title" },
  "sources.*.publisher": name("publisher"), "ai.systems.*.name": name("system"), "ai.systems.*.maker": name("maker"),
  "reactions.*.who": name("reaction_who"), "reactions.*.affiliation": name("affiliation"), "who.*.name": name("who"),
  "figure.credit": text("credit"), "terms.*.term": text("term"), "en.term": text("term"), "zh.term": text("term"),
  status_note: text("status_note"), "pace.sentence": text("pace_sentence"), "ideas.*.who": text("idea_who"),
  "sources.*.url": url("source"), "figure.image_url": url("image"), "corrections.*.source_url": url("correction_source"),
  source_url: url("correction_source"), evidence_url: url("evidence"), "artefacts.lean.*": url("lean"), "zh.official_url": url("official"),
  "sources.*.doi": { kind: "artefact" }, "artefacts.doi.*": { kind: "artefact" }, "artefacts.arxiv.*": { kind: "artefact" },
  "artefacts.trial.*": { kind: "artefact" }, "artefacts.pdb.*": { kind: "artefact" },
  "zh.official": { kind: "official" },
};

/** The paths whose strings take their kind from the path a correction names, so the golden table has no row for them. */
const BY_CORRECTION_PATH: ReadonlySet<string> = new Set(["corrections.*.after", "before", "after"]);

const factsOf = (generic: string): { kind: StringKind; field: string | null; name: NameKind | null; url: UrlKind | null } => {
  const g: Facts = GOLDEN[generic] ?? { kind: "value" };
  return { kind: g.kind, field: g.field ?? null, name: g.name ?? null, url: g.url ?? null };
};

// ── Checking an inventory against what was made ──────────────────────────────────────────────────

function expectInventory(inv: Inventory, expected: Expected[], publishing: boolean): void {
  expect(inv.unclassified).toEqual([]);
  expect(inv.entries.map((e) => e.path).sort(byCodeUnit)).toEqual(expected.map((x) => x.path).sort(byCodeUnit));
  const byPath = new Map(inv.entries.map((e) => [e.path, e]));
  for (const x of expected) {
    const e = byPath.get(x.path)!;
    expect(e, x.path).toBeDefined();
    expect(
      { text: e.text, at: e.at, lang: e.lang, record: e.record, finding: e.finding, publishing: e.publishing, removed: e.removed, zh: e.zh },
      x.path,
    ).toEqual({ text: x.text, at: x.at, lang: x.lang, record: x.record, finding: x.finding, publishing, removed: false, zh: null });
    if (BY_CORRECTION_PATH.has(x.generic)) continue;
    const want = factsOf(x.generic);
    expect({ kind: e.kind, field: e.field, name: e.nameKind, url: e.urlKind }, `${x.path} (${x.generic})`).toEqual(want);
  }
}

const entryAt = (inv: Inventory, path: string): StringEntry => {
  const hit = inv.entries.find((e) => e.path === path);
  if (hit === undefined) throw new Error(`No entry at ${path}. Entries: ${inv.entries.map((e) => e.path).join(" | ")}`);
  return hit;
};

const merge = (...invs: Inventory[]): Inventory => ({ entries: invs.flatMap((i) => i.entries), unclassified: invs.flatMap((i) => i.unclassified) });

// ── Every string is classified ───────────────────────────────────────────────────────────────────

describe("the inventory classifies every string of every record", () => {
  it.each([["the first form of every union", draftA], ["the second form of every union", draftB]] as const)(
    "gives each string of a draft built with %s its place, text, record and kind",
    (_label, draft) => {
      expectInventory(draftInventory(draft.value), draftExpected(draft), true);
    },
  );

  it("does the same for a stored brief, finding, glossary term, correction and report, whether or not they are being published", () => {
    for (const being of [beingAll(made), NOBODY]) {
      const inv = publishedInventory({ ...made, being });
      expectInventory(inv, storedLeaves, being.brief);
    }
  });

  it("makes a draft with both forms of a new finding's term and every list two long", () => {
    const terms = (d: Made<DraftBrief>) => d.value.new_findings.map((f) => f.terms.map((t) => t.new));
    expect(terms(draftA)).toEqual([[true, true], [true, true]]);
    expect(terms(draftB)).toEqual([[false, false], [false, false]]);
    for (const d of [draftA, draftB]) {
      expect(d.value.new_findings).toHaveLength(2);
      expect(d.value.lead).toHaveLength(2);
      expect(d.value.corrections).toHaveLength(2);
    }
  });

  it("has a table row for each key of each schema, and no row for any other", () => {
    const keys = (table: ReadonlyMap<string, unknown>): string[] => [...table.keys()].sort(byCodeUnit);
    const generics = (list: Expected[], skip: ReadonlySet<string> = new Set()): string[] =>
      [...new Set(list.filter((x) => !skip.has(x.generic)).map((x) => x.generic))].sort(byCodeUnit);
    const drafts = [...draftExpected(draftA), ...draftExpected(draftB)];
    expect(keys(PATH_TABLES.draft)).toEqual(generics(drafts.filter((x) => x.record.type === "draft"), BY_CORRECTION_PATH));
    expect(keys(PATH_TABLES.new_finding)).toEqual(generics(drafts.filter((x) => x.record.type === "new_finding")));
    expect(keys(PATH_TABLES.brief)).toEqual(generics(storedExpected("brief", briefM)));
    expect(keys(PATH_TABLES.finding)).toEqual(generics(storedExpected("finding", findingM)));
    expect(keys(PATH_TABLES.term)).toEqual(generics(storedExpected("term", termM)));
    expect(keys(PATH_TABLES.correction)).toEqual(generics(storedExpected("correction", correctionM), BY_CORRECTION_PATH));
    expect(keys(PATH_TABLES.report)).toEqual(generics(storedExpected("report", reportM)));
  });

  it("has a golden row for no path that no schema has", () => {
    const seen = new Set([...draftExpected(draftA), ...draftExpected(draftB), ...storedLeaves].map((x) => x.generic));
    expect(Object.keys(GOLDEN).filter((g) => !seen.has(g))).toEqual([]);
  });

  it("classifies a valid draft of each edition and a stored edition with nothing left over", () => {
    const monday = weekdayDraft();
    monday.review = {
      big_picture: "This week the record moved on three fronts.", remarkable: { finding_id: "bio-2026-0001", note: "A made-up note." },
      strongest_against: { text: "One finding fell this week.", finding_ids: ["phys-2026-0003"], source_ids: ["b2"] },
    };
    const sunday = weekdayDraft();
    sunday.deep_dive = { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "anniversary" };
    for (const draft of [weekdayDraft(), monday, sunday]) expect(draftInventory(deepFreeze(draft)).unclassified).toEqual([]);
    const world = storedWorld();
    expect(publishedInventory({ ...deepFreeze(world), being: beingAll(world) }).unclassified).toEqual([]);
    expect(publishedInventory({ ...deepFreeze(world), brief: null, being: NOBODY }).entries.some((e) => e.record.type === "brief")).toBe(false);
  });

  it("lists a leaf no pattern matches, and reads it as free text", () => {
    const draft = weekdayDraft();
    (draft as unknown as Record<string, unknown>).surprise = { inner: "a new key" };
    const inv = draftInventory(draft);
    expect(inv.unclassified).toEqual(["surprise.inner"]);
    expect(entryAt(inv, "surprise.inner")).toMatchObject({ kind: "text", field: null, lang: "en", text: "a new key" });
    const finding = storedWorld().findings[0]!;
    (finding as unknown as Record<string, unknown>).surprise = ["a new key"];
    const stored = publishedInventory({ ...storedWorld(), findings: [finding], being: NOBODY });
    expect(stored.unclassified).toEqual([`findings/bio-2026-0001.json: surprise[0]`]);
  });
});

// ── A correction's before and after ──────────────────────────────────────────────────────────────

interface SideCase {
  target: "finding" | "brief" | "term";
  path: string;
  kind: StringKind;
  /** The field of a non-prose string; a prose one has `before` or `after`. */
  field?: string;
  name?: NameKind;
  url?: UrlKind;
  /** The prose field the path names, for the rules that ask what a correction's text is (HYPE_WORDS, ZH_RUNG_LABEL). */
  pathField?: ProseField;
}

const SIDE_CASES: SideCase[] = [
  { target: "finding", path: "explainer.how_sure", kind: "prose", pathField: "how_sure" },
  { target: "finding", path: "explainer.could_lead", kind: "prose", pathField: "could_lead" },
  { target: "finding", path: "title", kind: "prose", pathField: "title" },
  { target: "finding", path: "rung_history.1.note", kind: "prose", pathField: "note" },
  { target: "finding", path: "rung_history.10.note", kind: "prose", pathField: "note" },
  { target: "finding", path: "ai.evidence.20.quote", kind: "quote" },
  { target: "finding", path: "since_then.0.text", kind: "prose", pathField: "since_then" },
  { target: "finding", path: "figure.alt", kind: "prose", pathField: "alt" },
  { target: "finding", path: "figure.credit", kind: "text", field: "credit" },
  { target: "finding", path: "ai.evidence.0.quote", kind: "quote" },
  { target: "finding", path: "reactions.1.quote", kind: "quote" },
  { target: "finding", path: "figure.licence_quote", kind: "quote" },
  { target: "finding", path: "sources.0.title", kind: "title" },
  { target: "finding", path: "sources.0.publisher", kind: "name", name: "publisher" },
  { target: "finding", path: "ai.systems.0.name", kind: "name", name: "system" },
  { target: "finding", path: "ai.systems.1.maker", kind: "name", name: "maker" },
  { target: "finding", path: "reactions.0.who", kind: "name", name: "reaction_who" },
  { target: "finding", path: "reactions.0.affiliation", kind: "name", name: "affiliation" },
  { target: "finding", path: "who.0.name", kind: "name", name: "who" },
  { target: "finding", path: "sources.0.url", kind: "url", url: "source" },
  { target: "finding", path: "figure.image_url", kind: "url", url: "image" },
  { target: "finding", path: "artefacts.lean.0", kind: "url", url: "lean" },
  { target: "finding", path: "sources.0.doi", kind: "artefact" },
  { target: "finding", path: "artefacts.arxiv.1", kind: "artefact" },
  { target: "finding", path: "significance", kind: "value" },
  { target: "finding", path: "explainer.nope", kind: "text" },
  { target: "brief", path: "lead.0.text", kind: "prose" },
  { target: "brief", path: "story.update", kind: "prose" },
  { target: "brief", path: "pace.sentence", kind: "text", field: "pace_sentence" },
  { target: "brief", path: "status_note", kind: "text", field: "status_note" },
  { target: "brief", path: "ideas.0.who", kind: "text", field: "idea_who" },
  { target: "brief", path: "sources.1.title", kind: "title" },
  { target: "brief", path: "sources.1.url", kind: "url", url: "source" },
  { target: "term", path: "definition", kind: "prose", pathField: "definition" },
  { target: "term", path: "term", kind: "text", field: "term" },
  { target: "term", path: "nothing", kind: "text" },
];

const targetOf = (c: SideCase, ids: { finding: string; brief: string; term: string }) => ({
  finding_id: c.target === "finding" ? ids.finding : null,
  edition_date: c.target === "brief" ? ids.brief : null,
  term_id: c.target === "term" ? ids.term : null,
});

describe("a correction's before and after take the kind of the path they name", () => {
  const ids = { finding: "bio-2026-0001", brief: D, term: "protein-folding" };

  it("does so for a stored correction, in each language and each side", () => {
    const corrections = SIDE_CASES.map((c, i): Correction => ({
      ...correctionM.value, id: `C-${String(i + 1).padStart(4, "0")}`, date: "2026-11-10", ...targetOf(c, ids), type: "correction", path: c.path,
      before: { en: `before ${i}`, zh: `前${i}` }, after: { en: `after ${i}`, zh: `後${i}` },
    }));
    const inv = publishedInventory({ brief: null, findings: [], terms: [], corrections, reports: [], being: NOBODY });
    expect(inv.unclassified).toEqual([]);
    SIDE_CASES.forEach((c, i) => {
      for (const side of ["before", "after"] as const) {
        for (const lang of ["en", "zh"] as const) {
          const e = entryAt(inv, `corrections.json: corrections[${i}].${side}.${lang}`);
          expect({ kind: e.kind, field: e.field, name: e.nameKind, url: e.urlKind, pathField: e.pathField }, `${c.target} ${c.path} ${side} ${lang}`).toEqual({
            kind: c.kind, field: c.kind === "prose" ? side : c.field ?? null, name: c.name ?? null, url: c.url ?? null, pathField: c.pathField ?? null,
          });
          expect({ correction: e.correction, lang: e.lang, about: e.about, filedOn: e.filedOn, record: e.record, at: e.at }).toEqual({
            correction: side, lang, about: side === "after" && c.target === "finding" ? ids.finding : null, filedOn: "2026-11-10",
            record: { type: "correction", id: `C-${String(i + 1).padStart(4, "0")}` }, at: side,
          });
        }
      }
    });
  });

  it("does so for a draft's correction, whose after is plain English", () => {
    const draft = structuredClone(draftA.value);
    draft.corrections = SIDE_CASES.map((c, i) => ({
      ...targetOf(c, ids), type: "correction" as const, path: c.path, after: `after ${i}`, reason: `reason ${i}`, source_url: null, report_id: null,
    }));
    const inv = draftInventory(draft);
    expect(inv.unclassified).toEqual([]);
    SIDE_CASES.forEach((c, i) => {
      const e = entryAt(inv, `corrections[${i}].after`);
      expect({ kind: e.kind, field: e.field, name: e.nameKind, url: e.urlKind, pathField: e.pathField, correction: e.correction }, `${c.target} ${c.path}`).toEqual({
        kind: c.kind, field: c.kind === "prose" ? "after" : c.field ?? null, name: c.name ?? null, url: c.url ?? null, pathField: c.pathField ?? null, correction: "after",
      });
      expect({ about: e.about, filedOn: e.filedOn, lang: e.lang }).toEqual({ about: c.target === "finding" ? ids.finding : null, filedOn: draft.date, lang: "en" });
      const reason = entryAt(inv, `corrections[${i}].reason`);
      expect({ kind: reason.kind, field: reason.field, correction: reason.correction, about: reason.about }).toEqual({ kind: "prose", field: "reason", correction: null, about: null });
    });
  });
});

// ── What an entry says about its string ──────────────────────────────────────────────────────────

describe("the facts an entry carries", () => {
  it("says, for a draft, which record each string is in and what it is about", () => {
    const draft = weekdayDraft();
    draft.review = {
      big_picture: "This week the record moved on three fronts.", remarkable: { finding_id: "bio-2026-0001", note: "A made-up note." },
      strongest_against: { text: "One finding fell this week.", finding_ids: ["phys-2026-0003"], source_ids: ["b2"] },
    };
    draft.deep_dive = { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "anniversary" };
    const inv = draftInventory(draft);
    const edition: RecordRef = { type: "draft", id: D };
    const facts = (path: string) => {
      const e = entryAt(inv, path);
      return { record: e.record, finding: e.finding, about: e.about, filedOn: e.filedOn, at: e.at, publishing: e.publishing, removed: e.removed, correction: e.correction, zh: e.zh };
    };
    const same = { publishing: true, removed: false, correction: null, zh: null };

    expect(facts("lead[0].text")).toEqual({ record: edition, finding: null, about: null, filedOn: D, at: "lead.0.text", ...same });
    expect(facts("returning[0].update")).toEqual({ record: edition, finding: null, about: "math-2026-0002", filedOn: D, at: "returning.0.update", ...same });
    expect(facts("returning[0].rung.note")).toEqual({ record: edition, finding: null, about: "math-2026-0002", filedOn: D, at: "returning.0.rung.note", ...same });
    expect(facts("rung_changes[0].rung.note")).toEqual({ record: edition, finding: null, about: "phys-2026-0003", filedOn: D, at: "rung_changes.0.rung.note", ...same });
    expect(facts("ideas[0].text")).toEqual({ record: edition, finding: null, about: null, filedOn: D, at: "ideas.0.text", ...same });
    expect(facts("deep_dive.text")).toEqual({ record: edition, finding: null, about: "bio-2024-0007", filedOn: D, at: "deep_dive.text", ...same });
    expect(facts("review.big_picture")).toEqual({ record: edition, finding: null, about: null, filedOn: D, at: "review.big_picture", ...same });
    expect(facts("review.remarkable.note")).toEqual({ record: edition, finding: null, about: "bio-2026-0001", filedOn: D, at: "review.remarkable.note", ...same });
    expect(facts("report_decisions[0].reason")).toEqual({ record: edition, finding: null, about: null, filedOn: D, at: "report_decisions.0.reason", ...same });
    // a new finding's text is as first published, and a rung note is dated by its own date
    expect(facts("new_findings[0].explainer.how_sure")).toEqual({ record: { type: "new_finding", id: "new-1" }, finding: "new-1", about: null, filedOn: null, at: "explainer.how_sure", ...same });
    expect(facts("new_findings[1].title")).toEqual({ record: { type: "new_finding", id: "new-2" }, finding: "new-2", about: null, filedOn: null, at: "title", ...same });
    expect(facts("new_findings[1].rung_history[0].note")).toEqual({ record: { type: "new_finding", id: "new-2" }, finding: "new-2", about: null, filedOn: D, at: "rung_history.0.note", ...same });
    expect(facts("new_findings[0].sources[1].title").filedOn).toBeNull();
    // a correction's text is about its finding and dated on the edition
    expect(facts("corrections[0].after")).toMatchObject({ about: "math-2026-0002", filedOn: D, at: "corrections.0.after", correction: "after" });
    expect(facts("corrections[0].reason")).toMatchObject({ about: null, filedOn: D, correction: null });
    expect(entryAt(inv, "new_findings[0].terms[0].definition")).toMatchObject({ kind: "prose", field: "definition", finding: "new-1" });
    expect(entryAt(inv, "new_findings[0].terms[0].term")).toMatchObject({ kind: "text", field: "term" });
    expect(entryAt(inv, "new_findings[0].terms[1].id")).toMatchObject({ kind: "value" });
    expect(entryAt(inv, "new_findings[0].sources[0].url")).toMatchObject({ kind: "url", urlKind: "source", lang: "en" });
    expect(entryAt(inv, "new_findings[0].ai.systems[0].maker")).toMatchObject({ kind: "name", nameKind: "maker" });
    expect(entryAt(inv, "ideas[0].who")).toMatchObject({ kind: "text", field: "idea_who", nameKind: null });
    expect(inv.entries.every((e) => e.publishing && !e.removed && e.zh === null && e.lang === "en")).toBe(true);
    expect(inv.entries.some((e) => e.record.type === "new_finding" && e.record.id === "new-2")).toBe(true);
  });

  it("says a string is about a finding only where the spec names one, on records with every key filled", () => {
    const aboutsOf = (inv: Inventory) => Object.fromEntries(inv.entries.filter((e) => e.about !== null).map((e) => [e.path, e.about]));
    for (const d of [draftA.value, draftB.value]) {
      const expected: Record<string, string> = {};
      d.returning.forEach((r, i) => {
        expected[`returning[${i}].update`] = r.finding_id;
        for (const k of ["rung", "date", "source_id", "note"]) expected[`returning[${i}].rung.${k}`] = r.finding_id;
      });
      d.rung_changes.forEach((c, i) => {
        expected[`rung_changes[${i}].finding_id`] = c.finding_id;
        for (const k of ["rung", "date", "source_id", "note"]) expected[`rung_changes[${i}].rung.${k}`] = c.finding_id;
      });
      expected["deep_dive.text"] = d.deep_dive!.finding_id;
      expected["review.remarkable.note"] = d.review!.remarkable!.finding_id;
      d.corrections.forEach((c, i) => { if (c.finding_id !== null) expected[`corrections[${i}].after`] = c.finding_id; });
      expect(aboutsOf(draftInventory(d))).toEqual(expected);
    }
    const b = briefM.value;
    const file = `briefs/${b.date}.json`;
    const expected: Record<string, string> = {
      [`${file}: story.update.en`]: b.story!.finding_id, [`${file}: story.update.zh`]: b.story!.finding_id,
      [`${file}: deep_dive.text.en`]: b.deep_dive!.finding_id, [`${file}: deep_dive.text.zh`]: b.deep_dive!.finding_id,
      [`${file}: review.remarkable.note.en`]: b.review!.remarkable!.finding_id, [`${file}: review.remarkable.note.zh`]: b.review!.remarkable!.finding_id,
    };
    b.items.forEach((it, i) => { for (const lang of ["en", "zh"]) expected[`${file}: items[${i}].update.${lang}`] = it.finding_id; });
    const stored = aboutsOf(publishedInventory({ ...made, being: NOBODY }));
    expect(Object.fromEntries(Object.entries(stored).filter(([k]) => k.startsWith("briefs/")))).toEqual(expected);
    expect(Object.keys(stored).some((k) => k.startsWith("findings/") || k.startsWith("glossary.json"))).toBe(false);
  });

  it("says, for a stored edition, which records are being published, which date to file a string on and what it is about", () => {
    const world = storedWorld();
    const being: BeingPublished = {
      brief: true, findings: new Set(["bio-2026-0001", "math-2026-0002"]), terms: new Set(["protein-folding"]),
      corrections: new Set(["C-0002"]), reports: new Set(),
    };
    const inv = publishedInventory({ ...world, being });
    const brief = `briefs/${D}.json`;
    const facts = (path: string) => {
      const e = entryAt(inv, path);
      return { record: e.record, finding: e.finding, about: e.about, filedOn: e.filedOn, at: e.at, lang: e.lang, publishing: e.publishing };
    };

    expect(facts(`${brief}: lead[0].text.en`)).toEqual({ record: { type: "brief", id: D }, finding: null, about: null, filedOn: D, at: "lead.0.text", lang: "en", publishing: true });
    expect(facts(`${brief}: lead[0].text.zh`)).toMatchObject({ at: "lead.0.text", lang: "zh" });
    expect(facts(`${brief}: items[1].update.en`)).toMatchObject({ about: "phys-2026-0003", filedOn: D, at: "items.1.update" });
    expect(facts(`${brief}: ideas[0].who`)).toMatchObject({ lang: "en", at: "ideas.0.who" });
    expect(entryAt(inv, `${brief}: ideas[0].who`)).toMatchObject({ kind: "text", field: "idea_who" });
    expect(entryAt(inv, `${brief}: pace.sentence.zh`)).toMatchObject({ kind: "text", field: "pace_sentence", lang: "zh" });
    // a null is no string
    expect(inv.entries.some((e) => e.path.startsWith(`${brief}: story.update`))).toBe(false);

    const bio = "findings/bio-2026-0001.json";
    expect(facts(`${bio}: explainer.how_sure.en`)).toEqual({ record: { type: "finding", id: "bio-2026-0001" }, finding: "bio-2026-0001", about: null, filedOn: null, at: "explainer.how_sure", lang: "en", publishing: true });
    // a rung note is dated by its `recorded`, a later fact by its own date
    expect(facts(`${bio}: rung_history[1].note.en`)).toMatchObject({ filedOn: D, at: "rung_history.1.note" });
    // the rest of a rung entry is as first published
    for (const k of ["rung", "date", "recorded", "source_id", "by"]) expect(facts(`${bio}: rung_history[1].${k}`).filedOn, k).toBeNull();
    expect(inv.entries.some((e) => e.path.startsWith(`${bio}: rung_history[0].note`))).toBe(false);
    expect(facts(`${bio}: since_then[0].text.en`)).toMatchObject({ filedOn: "2026-11-23", at: "since_then.0.text" });
    expect(facts("findings/phys-2026-0003.json: explainer.found.en")).toMatchObject({ finding: "phys-2026-0003", publishing: false });

    expect(facts("glossary.json: terms[0].en.definition")).toEqual({ record: { type: "term", id: "protein-folding" }, finding: null, about: null, filedOn: null, at: "definition", lang: "en", publishing: true });
    expect(facts("glossary.json: terms[0].zh.definition")).toMatchObject({ at: "definition", lang: "zh" });
    expect(entryAt(inv, "glossary.json: terms[0].zh.term")).toMatchObject({ kind: "text", field: "term", lang: "zh", at: "term" });

    expect(facts("corrections.json: corrections[0].after.en")).toMatchObject({ about: "math-2026-0002", filedOn: "2026-11-10", publishing: false });
    expect(facts("corrections.json: corrections[1].after.en")).toMatchObject({ about: "phys-2026-0003", filedOn: D, publishing: true });
    expect(entryAt(inv, "corrections.json: corrections[1].reason.en")).toMatchObject({ kind: "prose", field: "reason", correction: null });
    // only a correction's `after` is about its finding (as in a draft); a report's reason is the reader's, about no finding's text
    for (const k of ["id", "date", "finding_id", "type", "path", "before.en", "reason.en", "trigger"]) expect(facts(`corrections.json: corrections[1].${k}`).about, k).toBeNull();
    expect(facts("reports.json: reports[0].reason.en")).toMatchObject({ about: null, publishing: false, filedOn: null });
    expect(inv.entries.every((e) => !e.removed && e.zh === null)).toBe(true);
  });

  it("says, for a Chinese draft, which context key, English string, cap and group each string has", () => {
    const { draft, context } = zhWorld();
    const inv = zhInventory(draft, context);
    expect(inv.unclassified).toEqual(['strings["mystery.key"]']);
    const base = { lang: "zh", record: { type: "zh", id: null }, publishing: true, removed: false, correction: null, filedOn: null, about: null, nameKind: null, urlKind: null, pathField: null } as const;
    const lead = entryAt(inv, 'strings["lead.0"]');
    expect(lead).toMatchObject({ ...base, at: "lead.0", text: "引言一。", kind: "prose", field: "lead", finding: null });
    expect(lead.zh).toEqual({ key: "lead.0", en: "The lead.", zhKind: "lead", cap_chars: 60, group: { id: "lead", cap_chars: 108 }, term: null });
    const found = entryAt(inv, 'strings["new.new-1.explainer.found"]');
    expect(found).toMatchObject({ kind: "prose", field: "found", finding: "new-1" });
    expect(found.zh).toMatchObject({ zhKind: "part", cap_chars: 84, group: { id: "new.new-1.explainer", cap_chars: 504 } });
    expect(entryAt(inv, 'strings["returning.math-2026-0002.update"]')).toMatchObject({ field: "update", finding: "math-2026-0002" });
    expect(entryAt(inv, 'strings["backlog.bio-2024-0007.since.1"]')).toMatchObject({ field: "since_then", finding: "bio-2024-0007" });
    // a key the context lacks is still a string, with no English and no cap
    const stray = entryAt(inv, 'strings["lead.5"]');
    expect(stray.zh).toEqual({ key: "lead.5", en: null, zhKind: null, cap_chars: null, group: null, term: null });
    expect(stray).toMatchObject({ kind: "prose", field: "lead" });
    expect(entryAt(inv, 'strings["mystery.key"]')).toMatchObject({ kind: "text", field: null, finding: null });

    const name = entryAt(inv, 'terms["protein-folding"].zh');
    expect(name).toMatchObject({ ...base, kind: "text", field: "term", at: "zh", text: "蛋白質摺疊", finding: null, record: { type: "zh", id: "protein-folding" } });
    expect(name.zh).toEqual({ key: "terms.protein-folding.zh", en: "protein folding", zhKind: null, cap_chars: null, group: null, term: "protein-folding" });
    const definition = entryAt(inv, 'terms["protein-folding"].definition');
    expect(definition).toMatchObject({ kind: "prose", field: "definition", at: "definition" });
    expect(definition.zh).toEqual({ key: "terms.protein-folding.definition", en: "How a chain of amino acids curls into a shape.", zhKind: null, cap_chars: 72, group: null, term: "protein-folding" });
    expect(inv.entries.some((e) => e.path === 'terms["protein-folding"].official')).toBe(false);
    expect(inv.entries.some((e) => e.path === 'terms["protein-folding"].official_url')).toBe(false);
    expect(entryAt(inv, 'terms.enzyme.official')).toMatchObject({ kind: "official", field: null, text: "酶" });
    expect(entryAt(inv, 'terms.enzyme.official_url')).toMatchObject({ kind: "url", urlKind: "official", lang: "zh" });
    // a term the context does not list has no English
    expect(entryAt(inv, 'terms.extra.zh').zh).toMatchObject({ en: null, term: "extra" });
    expect(entryAt(inv, 'terms.extra.definition').zh).toMatchObject({ en: null, cap_chars: null });
  });
});

// ── Removed text ─────────────────────────────────────────────────────────────────────────────────

describe("removed text", () => {
  const removal = (over: Partial<Correction>): Correction => ({
    ...correctionM.value, id: "C-0001", date: D, finding_id: null, edition_date: null, term_id: null, type: "removed", ...over,
  });

  it("lists, by record, the strings the stored removed corrections rewrote", () => {
    const found = removedPaths([
      removal({ finding_id: "bio-2026-0001", path: "explainer.how_sure" }),
      removal({ finding_id: "bio-2026-0001", path: "title" }),
      removal({ finding_id: "math-2026-0002", path: "sources.0.url" }),
      removal({ edition_date: D, path: "lead.0.text" }),
      removal({ term_id: "protein-folding", path: "definition" }),
      removal({ finding_id: "bio-2026-0001", type: "update", path: "explainer.found" }),
      removal({ finding_id: "bio-2026-0001", type: "correction", path: "explainer.matters" }),
      removal({ finding_id: "bio-2026-0001", type: "clarification", path: "explainer.background" }),
      removal({ path: "explainer.could_lead" }),
    ]);
    expect([...found.keys()].sort(byCodeUnit)).toEqual([`brief:${D}`, "finding:bio-2026-0001", "finding:math-2026-0002", "term:protein-folding"]);
    expect([...found.get("finding:bio-2026-0001")!].sort(byCodeUnit)).toEqual(["explainer.how_sure", "title"]);
    expect([...found.get("finding:math-2026-0002")!]).toEqual(["sources.0.url"]);
    expect([...found.get(`brief:${D}`)!]).toEqual(["lead.0.text"]);
    expect([...found.get("term:protein-folding")!]).toEqual(["definition"]);
    expect(removedPaths([]).size).toBe(0);
  });

  function withRemoval(record: CorrectionRecord, generic: string): { inv: Inventory; target: RecordType; id: string; path: string } {
    const path = generic.replaceAll("*", "0");
    const key = record === "finding" ? { finding_id: made.findings[0]!.id } : record === "edition" ? { edition_date: made.brief.date } : { term_id: made.terms[0]!.id };
    const inv = publishedInventory({ ...made, corrections: [removal({ ...key, path })], being: beingAll(made) });
    const target: RecordType = record === "finding" ? "finding" : record === "edition" ? "brief" : "term";
    const id = record === "finding" ? made.findings[0]!.id : record === "edition" ? made.brief.date : made.terms[0]!.id;
    return { inv, target, id, path };
  }

  const ALL_PATHS = (Object.entries(REMOVABLE_PATHS) as [CorrectionRecord, readonly string[]][]).flatMap(([record, paths]) => paths.map((p) => [record, p] as const));

  it.each(ALL_PATHS)("marks exactly the strings a removed correction at the %s path %s rewrote, in both languages", (record, generic) => {
    const { inv, target, id, path } = withRemoval(record, generic);
    const marked = inv.entries.filter((e) => e.removed);
    expect(marked.length).toBeGreaterThan(0);
    for (const e of inv.entries) {
      const inTarget = e.record.type === target && e.record.id === id;
      expect(e.removed, `${e.path}`).toBe(inTarget && e.at === path);
    }
    // a language side of an L10n is marked with its other side; a plain string alone
    const sides = new Set(marked.map((e) => e.lang));
    expect(sides.size).toBe(marked.length > 1 ? 2 : 1);
  });

  it("is keyed on the stored correction alone", () => {
    const world = storedWorld();
    world.findings[0]!.explainer.how_sure = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh };
    // the same text with no correction is judged like any other text
    expect(publishedInventory({ ...world, being: NOBODY }).entries.some((e) => e.removed)).toBe(false);
    // a correction of another type at the same path marks nothing
    const update = removal({ finding_id: "bio-2026-0001", type: "update", path: "explainer.how_sure" });
    expect(publishedInventory({ ...world, corrections: [update], being: NOBODY }).entries.some((e) => e.removed)).toBe(false);
    // a removed correction of one finding marks that finding's string and no other finding's at the same path
    const real = removal({ finding_id: "bio-2026-0001", path: "explainer.how_sure" });
    const inv = publishedInventory({ ...world, corrections: [real], being: NOBODY });
    expect(inv.entries.filter((e) => e.removed).map((e) => e.path)).toEqual([
      "findings/bio-2026-0001.json: explainer.how_sure.en", "findings/bio-2026-0001.json: explainer.how_sure.zh",
    ]);
    // the brief of another date is not marked either
    const other = removal({ edition_date: "2026-11-01", path: "lead.0.text" });
    expect(publishedInventory({ ...world, corrections: [other], being: NOBODY }).entries.some((e) => e.removed)).toBe(false);
  });

  it("keeps a removed string out of every selector but removedProse, which returns the model prose among them", () => {
    const world = storedWorld();
    const corrections = [
      removal({ finding_id: "bio-2026-0001", path: "explainer.how_sure" }),
      removal({ finding_id: "bio-2026-0001", path: "ai.evidence.0.quote", id: "C-0002" }),
      removal({ edition_date: D, path: "lead.0.text", id: "C-0003" }),
    ];
    const inv = publishedInventory({ ...world, corrections, being: beingAll(world) });
    const removed = inv.entries.filter((e) => e.removed).map((e) => e.path);
    expect(removed).toEqual([
      `briefs/${D}.json: lead[0].text.en`, `briefs/${D}.json: lead[0].text.zh`,
      "findings/bio-2026-0001.json: explainer.how_sure.en", "findings/bio-2026-0001.json: explainer.how_sure.zh",
      "findings/bio-2026-0001.json: ai.evidence[0].quote",
    ]);
    const selectors = { modelProse, dashStrings, hypeStrings, dualUseStrings, everyString, blockedHostStrings, urlStrings, explainerStrings, readingStrings, definitionStrings, quoteStrings, zhAll, zhText, pageProse: (i: Inventory) => pageProse(i, () => "story") };
    for (const [label, select] of Object.entries(selectors)) {
      expect(select(inv).filter((e) => e.removed), label).toEqual([]);
    }
    expect(removedProse(inv).map((e) => e.path)).toEqual([`briefs/${D}.json: lead[0].text.en`, "findings/bio-2026-0001.json: explainer.how_sure.en"]);
    expect(modelProse(inv).some((e) => e.path === "findings/bio-2026-0001.json: explainer.found.en")).toBe(true);
  });
});

// ── The selectors ────────────────────────────────────────────────────────────────────────────────

/** The census: a made-up edition and every kind of correction and removal, and a Chinese draft, so that every kind of string is in it in every language and every side. */
const CENSUS: Inventory = (() => {
  const finding = findingM.value;
  const brief = made.brief;
  const stored = (i: number, c: SideCase, extra: Partial<Correction> = {}): Correction => ({
    ...correctionM.value, id: `C-${String(i + 10).padStart(4, "0")}`, date: "2026-11-10", ...targetOf(c, { finding: finding.id, brief: brief.date, term: made.terms[0]!.id }),
    type: "correction", path: c.path, before: { en: `before ${i}`, zh: `前${i}` }, after: { en: `after ${i}`, zh: `後${i}` }, ...extra,
  });
  const removals: SideCase[] = [
    { target: "finding", path: "explainer.how_sure", kind: "prose" }, { target: "finding", path: "title", kind: "prose" },
    { target: "finding", path: "ai.evidence.0.quote", kind: "quote" }, { target: "finding", path: "sources.0.title", kind: "title" },
    { target: "finding", path: "sources.0.publisher", kind: "name" }, { target: "finding", path: "figure.credit", kind: "text" },
    { target: "finding", path: "sources.0.url", kind: "url" }, { target: "brief", path: "lead.0.text", kind: "prose" },
    { target: "brief", path: "status_note", kind: "text" }, { target: "term", path: "definition", kind: "prose" },
  ];
  const corrections = [
    correctionM.value,
    ...SIDE_CASES.map((c, i) => stored(i, c)),
    ...removals.map((c, i) => stored(SIDE_CASES.length + i, c, { type: "removed" })),
  ];
  const published = publishedInventory({ ...made, corrections, being: beingAll({ ...made, corrections }) });
  const { draft, context } = zhWorld();
  return merge(draftInventory(draftA.value), draftInventory(draftB.value), published, zhInventory(draft, context));
})();

type Side = StringEntry["correction"];

interface Members {
  kinds: readonly StringKind[];
  langs: readonly Lang[];
  sides: readonly Side[];
  /** For the selectors that read one prose field or a few. */
  fields?: readonly (string | null)[];
}
const KINDS: readonly StringKind[] = ["prose", "quote", "title", "name", "text", "url", "artefact", "official", "value"];
const READABLE = KINDS.filter((k) => k !== "value");
const BOTH: readonly Lang[] = ["en", "zh"];
const ANY: readonly Side[] = [null, "before", "after"];
const NOT_BEFORE: readonly Side[] = [null, "after"];

/** Each selector's membership in the terms of its §4.12 row: the kinds of string, the languages and the sides of a correction it holds. */
const MEMBERS: Record<string, { select: (inv: Inventory) => StringEntry[]; members: Members }> = {
  // WORDS, SENTENCE_LENGTH, NUMBER_SOURCED: English model prose, a correction's after but never its before
  modelProse: { select: modelProse, members: { kinds: ["prose"], langs: ["en"], sides: NOT_BEFORE } },
  // NO_EM_DASH: the English text but a quote, a title and a correction's text at their paths (their kinds), no id or vocabulary value
  dashStrings: { select: dashStrings, members: { kinds: ["prose", "name", "text", "url", "artefact"], langs: ["en"], sides: ANY } },
  // HYPE_WORDS: those without an address, an identifier, a name, or a before
  hypeStrings: { select: hypeStrings, members: { kinds: ["prose", "text"], langs: ["en"], sides: NOT_BEFORE } },
  // DUAL_USE: every string of either draft but the values
  dualUseStrings: { select: dualUseStrings, members: { kinds: READABLE, langs: BOTH, sides: ANY } },
  // SECRET_LIKE, CANARY: every string there is
  everyString: { select: everyString, members: { kinds: KINDS, langs: BOTH, sides: ANY } },
  // BLOCKED_HOST: English, no values
  blockedHostStrings: { select: blockedHostStrings, members: { kinds: READABLE, langs: ["en"], sides: ANY } },
  urlStrings: { select: urlStrings, members: { kinds: ["url"], langs: BOTH, sides: ANY } },
  // TERM_DEFINED and READING_LEVEL: the explainer parts, with the Lead, the deep dive and the big picture for the second
  explainerStrings: { select: explainerStrings, members: { kinds: ["prose"], langs: ["en"], sides: [null], fields: EXPLAINER_FIELDS } },
  readingStrings: { select: readingStrings, members: { kinds: ["prose"], langs: ["en"], sides: [null], fields: [...EXPLAINER_FIELDS, "lead", "deep_dive", "big_picture"] } },
  definitionStrings: { select: definitionStrings, members: { kinds: ["prose"], langs: ["en"], sides: [null], fields: ["definition"] } },
  // QUOTE_VERBATIM: the quotes, never a correction's text at a quote's path
  quoteStrings: { select: quoteStrings, members: { kinds: ["quote"], langs: BOTH, sides: [null] } },
  // ZH_TRADITIONAL: every Chinese string a term's official included; ZH_NO_DASH, ZH_AVOID, ZH_HYPE: its prose and names
  zhAll: { select: zhAll, members: { kinds: READABLE.filter((k) => k !== "url"), langs: ["zh"], sides: NOT_BEFORE } },
  zhText: { select: zhText, members: { kinds: ["prose", "text"], langs: ["zh"], sides: NOT_BEFORE } },
};

describe("the selectors", () => {
  it("has strings of every kind, in each language and on each side of a correction, in the census", () => {
    const present = new Set(CENSUS.entries.filter((e) => !e.removed).map((e) => `${e.kind}/${e.lang}/${e.correction}`));
    const expected: string[] = [];
    for (const kind of KINDS) {
      for (const lang of BOTH) {
        if (kind === "official" && lang === "en") continue;
        // an id, a quote, a title, a name, a plain identifier or an address is plain English; only an L10n or the Chinese draft has Chinese
        const chinese = kind === "prose" || kind === "text" || kind === "official" || kind === "url";
        if (lang === "zh" && !chinese) continue;
        expected.push(`${kind}/${lang}/null`);
      }
      if (kind !== "official") for (const lang of BOTH) for (const side of ["before", "after"]) expected.push(`${kind}/${lang}/${side}`);
    }
    expect(expected.filter((x) => !present.has(x))).toEqual([]);
    expect(CENSUS.entries.some((e) => e.removed)).toBe(true);
    for (const kind of KINDS) expect(CENSUS.entries.some((e) => e.removed && e.kind === kind), `a removed ${kind}`).toBe(kind !== "official" && kind !== "artefact" && kind !== "value");
  });

  it.each(Object.entries(MEMBERS))("%s holds exactly the strings its row names", (_label, { select, members }) => {
    const expected = CENSUS.entries.filter((e) =>
      !e.removed && members.kinds.includes(e.kind) && members.langs.includes(e.lang) && members.sides.includes(e.correction)
      && (members.fields === undefined || members.fields.includes(e.field)));
    expect(select(CENSUS)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(CENSUS.entries.length);
  });

  it("holds, by name, the strings the §4.12 rows say it does", () => {
    const inv = draftInventory(weekdayDraft());
    const paths = (select: (i: Inventory) => StringEntry[]): string[] => select(inv).map((e) => e.path);
    const IN = {
      found: "new_findings[0].explainer.found", how_sure: "new_findings[0].explainer.how_sure", lead: "lead[0].text", title: "new_findings[0].title",
      update: "returning[0].update", after: "corrections[0].after", reason: "corrections[0].reason", idea: "ideas[0].text", also: "also[0].title",
      quote: "new_findings[0].ai.evidence[0].quote", reactionQuote: "new_findings[0].reactions[0].quote", source: "new_findings[0].sources[0].title",
      publisher: "new_findings[0].sources[0].publisher", url: "new_findings[0].sources[0].url", doi: "new_findings[0].sources[0].doi",
      system: "new_findings[0].ai.systems[0].name", who: "new_findings[0].who[0].name", person: "ideas[0].who", term: "new_findings[0].terms[0].term",
      definition: "new_findings[0].terms[0].definition", ref: "new_findings[0].ref", date: "date",
    };
    const holds = (select: (i: Inventory) => StringEntry[], want: string[], not: string[]) => {
      const got = new Set(paths(select));
      for (const key of want) expect(got.has(key), `in: ${key}`).toBe(true);
      for (const key of not) expect(got.has(key), `out: ${key}`).toBe(false);
    };
    const model = [IN.found, IN.how_sure, IN.lead, IN.title, IN.update, IN.idea, IN.also, IN.reason, IN.definition];
    holds(modelProse, model, [IN.quote, IN.source, IN.publisher, IN.url, IN.system, IN.person, IN.term, IN.date, IN.ref, IN.after]);
    holds(dashStrings, [...model, IN.publisher, IN.url, IN.doi, IN.system, IN.who, IN.person, IN.term], [IN.quote, IN.reactionQuote, IN.source, IN.ref, IN.date]);
    holds(hypeStrings, [...model, IN.person, IN.term], [IN.quote, IN.source, IN.publisher, IN.url, IN.doi, IN.system, IN.who, IN.ref, IN.date]);
    holds(dualUseStrings, [...model, IN.quote, IN.source, IN.publisher, IN.url, IN.system, IN.who], [IN.ref, IN.date]);
    holds(everyString, [...model, IN.quote, IN.url, IN.ref, IN.date], []);
    holds(blockedHostStrings, [...model, IN.quote, IN.source, IN.url, IN.doi], [IN.ref, IN.date]);
    holds(quoteStrings, [IN.quote, IN.reactionQuote], [IN.found, IN.source, IN.after]);
    holds(explainerStrings, [IN.found, IN.how_sure], [IN.title, IN.lead, IN.update]);
    holds(readingStrings, [IN.found, IN.lead], [IN.title, IN.update, IN.idea, IN.also, IN.reason]);
    holds(definitionStrings, [IN.definition], [IN.found, IN.term]);
    holds(urlStrings, [IN.url], [IN.doi, IN.source]);
  });

  it("holds each explainer part of each finding, and the Chinese selectors each language's strings", () => {
    const world = storedWorld();
    const inv = publishedInventory({ ...world, being: beingAll(world) });
    const parts = explainerStrings(inv).filter((e) => e.finding === "bio-2026-0001").map((e) => e.field);
    expect(parts).toEqual([...EXPLAINER_FIELDS]);
    expect(explainerStrings(inv).every((e) => e.lang === "en")).toBe(true);
    const chinese = zhAll(inv).map((e) => e.path);
    expect(chinese).toContain("findings/bio-2026-0001.json: explainer.found.zh");
    expect(chinese).toContain("glossary.json: terms[0].zh.term");
    expect(chinese).not.toContain("findings/bio-2026-0001.json: explainer.found.en");
    expect(zhKeyed(inv)).toEqual([]);
  });

  it("selects the Chinese draft's strings, each term's Chinese and definition, and its official, as the rows say", () => {
    const { draft, context } = zhWorld();
    const inv = zhInventory(draft, context);
    const text = zhText(inv).map((e) => e.path);
    const all = zhAll(inv).map((e) => e.path);
    expect(text).toContain('strings["lead.0"]');
    expect(text).toContain('terms["protein-folding"].zh');
    expect(text).toContain('terms["protein-folding"].definition');
    expect(text).not.toContain('terms.enzyme.official');
    expect(text).not.toContain('terms.enzyme.official_url');
    expect(all).toContain('terms.enzyme.official');
    expect(all).not.toContain('terms.enzyme.official_url');
    expect(zhKeyed(inv)).toEqual(inv.entries);
    expect(dashStrings(inv)).toEqual([]);
    expect(modelProse(inv)).toEqual([]);
    expect(everyString(inv)).toEqual(inv.entries);
    expect(dualUseStrings(inv).map((e) => e.path)).toContain('terms.enzyme.official_url');
  });
});

describe("pageProse(): the model prose a brief's page shows", () => {
  it("holds the brief's own text and, of a finding new in the edition, its title and first four parts, with the story's other two", () => {
    const inv = draftInventory(weekdayDraft());
    const depth = (id: string) => (id === "new-1" ? "story" : id === "new-2" ? "item" : null);
    expect(pageProse(inv, depth).map((e) => e.path)).toEqual([
      "lead[0].text", "lead[1].text", "returning[0].update", "ideas[0].text", "also[0].title",
      "new_findings[0].title", "new_findings[0].explainer.found", "new_findings[0].explainer.matters", "new_findings[0].explainer.ai_helped",
      "new_findings[0].explainer.how_sure", "new_findings[0].explainer.background", "new_findings[0].explainer.could_lead",
      "new_findings[1].title", "new_findings[1].explainer.found", "new_findings[1].explainer.matters", "new_findings[1].explainer.how_sure",
    ]);
  });

  it("leaves out a finding the page does not show, and the brief-level strings that are not page text", () => {
    const inv = draftInventory(weekdayDraft());
    expect(pageProse(inv, () => null).map((e) => e.path)).toEqual(["lead[0].text", "lead[1].text", "returning[0].update", "ideas[0].text", "also[0].title"]);
    const none = pageProse(inv, () => "item").map((e) => e.path);
    expect(none).not.toContain("new_findings[0].explainer.background");
    expect(none).not.toContain("new_findings[0].explainer.could_lead");
    for (const hidden of ["corrections[0].reason", "report_decisions[0].reason", "returning[0].rung.note", "rung_changes[0].rung.note", "new_findings[1].rung_history[0].note", "new_findings[0].terms[0].definition"]) {
      expect(none, hidden).not.toContain(hidden);
    }
  });

  it("reads a stored edition the same way, by the finding's id and the language English", () => {
    const world = storedWorld();
    const inv = publishedInventory({ ...world, being: beingAll(world) });
    const depth = (id: string) => (id === "bio-2026-0001" ? "story" : id === "math-2026-0002" ? "item" : null);
    const got = pageProse(inv, depth).map((e) => e.path);
    expect(got).toContain(`briefs/${D}.json: lead[0].text.en`);
    expect(got).toContain(`briefs/${D}.json: items[1].update.en`);
    expect(got).toContain(`briefs/${D}.json: ideas[0].text.en`);
    expect(got).toContain(`briefs/${D}.json: also[0].title.en`);
    expect(got).toContain("findings/bio-2026-0001.json: explainer.could_lead.en");
    expect(got).toContain("findings/math-2026-0002.json: explainer.how_sure.en");
    expect(got).not.toContain("findings/math-2026-0002.json: explainer.could_lead.en");
    expect(got.some((p) => p.startsWith("findings/phys-2026-0003.json"))).toBe(false);
    expect(got.some((p) => p.endsWith(".zh"))).toBe(false);
    for (const hidden of [`briefs/${D}.json: pace.sentence.en`, "findings/bio-2026-0001.json: rung_history[1].note.en", "findings/bio-2026-0001.json: since_then[0].text.en", "glossary.json: terms[0].en.definition", "corrections.json: corrections[1].reason.en"]) {
      expect(got, hidden).not.toContain(hidden);
    }
  });

  it("counts a brief-level string whatever its finding, the Monday review's and the Sunday deep dive's included", () => {
    const draft = weekdayDraft();
    draft.review = {
      big_picture: "This week the record moved on three fronts.", remarkable: { finding_id: "bio-2026-0001", note: "A made-up note." },
      strongest_against: { text: "One finding fell this week.", finding_ids: ["phys-2026-0003"], source_ids: ["b2"] },
    };
    draft.deep_dive = { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "anniversary" };
    const got = pageProse(draftInventory(draft), () => null).map((e) => e.path);
    for (const path of ["review.big_picture", "review.remarkable.note", "review.strongest_against.text", "deep_dive.text"]) expect(got).toContain(path);
  });
});

// ── The Chinese draft ────────────────────────────────────────────────────────────────────────────

function zhWorld() {
  const string = (key: string, en: string, kind: "title" | "part" | "lead" | "note" | "line" | "long" | "alt", cap: number, group: { id: string; cap_chars: number } | null = null) =>
    ({ key, en, kind, cap_chars: cap, group });
  const context = ZhContext.parse({
    schema_version: 1,
    date: D,
    deadline: "2026-11-24T04:15:00+08:00",
    strings: [
      string("lead.0", "The lead.", "lead", 60, { id: "lead", cap_chars: 108 }),
      string("new.new-1.explainer.found", "It found a thing.", "part", 84, { id: "new.new-1.explainer", cap_chars: 504 }),
      string("returning.math-2026-0002.update", "A journal published it.", "line", 50),
      string("backlog.bio-2024-0007.since.1", "A later fact.", "line", 50),
    ],
    terms: [{ id: "protein-folding", en: "protein folding", definition: "How a chain of amino acids curls into a shape.", zh: null, official: null, cap_chars: 72 }],
    fixed: [],
    hype: [],
    hype_names: [],
    avoid: {},
    labels: {},
  });
  const draft = DraftZh.parse({
    schema_version: 1,
    date: D,
    generated_at: "2026-11-24T04:00:00+08:00",
    strings: {
      "lead.0": "引言一。",
      "lead.5": "多出來的一句。",
      "new.new-1.explainer.found": "它發現了一件事。",
      "returning.math-2026-0002.update": "期刊刊出了。",
      "backlog.bio-2024-0007.since.1": "後來的事實。",
      "mystery.key": "不明的鍵。",
    },
    terms: {
      "protein-folding": { zh: "蛋白質摺疊", definition: "一串胺基酸捲成立體形狀的過程。", official: null, official_url: null },
      enzyme: { zh: "酵素", definition: "加速反應的蛋白質。", official: "酶", official_url: "https://terms.naer.edu.tw/detail/1" },
      extra: { zh: "額外", definition: "多出來的詞。", official: null, official_url: null },
    },
  });
  return { context, draft };
}

describe("parseZhKey(): the keys of the Chinese context (SPEC §4.6)", () => {
  const info = (key: string, section: string, finding: string | null, field: string, index: number | null = null) => ({ key, section, finding, field, index });
  const VALID: [string, ReturnType<typeof info>][] = [
    ["lead.0", info("lead.0", "lead", null, "lead", 0)],
    ["lead.12", info("lead.12", "lead", null, "lead", 12)],
    ["ideas.1", info("ideas.1", "ideas", null, "idea", 1)],
    ["also.2", info("also.2", "also", null, "also", 2)],
    ["deep_dive", info("deep_dive", "deep_dive", null, "deep_dive")],
    ["review.big_picture", info("review.big_picture", "review", null, "big_picture")],
    ["review.remarkable", info("review.remarkable", "review", null, "remarkable")],
    ["review.strongest_against", info("review.strongest_against", "review", null, "against")],
    ["corrections.3.after", info("corrections.3.after", "corrections", null, "after", 3)],
    ["corrections.0.reason", info("corrections.0.reason", "corrections", null, "reason", 0)],
    ["reports.R-0002.reason", info("reports.R-0002.reason", "reports", "R-0002", "reason")],
    ["rung.phys-2026-0003", info("rung.phys-2026-0003", "rung", "phys-2026-0003", "note")],
    ["returning.math-2026-0002.update", info("returning.math-2026-0002.update", "returning", "math-2026-0002", "update")],
    ["returning.math-2026-0002.rung", info("returning.math-2026-0002.rung", "returning", "math-2026-0002", "note")],
    ["new.new-1.title", info("new.new-1.title", "new", "new-1", "title")],
    ["new.new-2.figure.alt", info("new.new-2.figure.alt", "new", "new-2", "alt")],
    ["new.new-1.rung.0", info("new.new-1.rung.0", "new", "new-1", "note", 0)],
    ["backlog.bio-2024-0007.title", info("backlog.bio-2024-0007.title", "backlog", "bio-2024-0007", "title")],
    ["backlog.bio-2024-0007.figure.alt", info("backlog.bio-2024-0007.figure.alt", "backlog", "bio-2024-0007", "alt")],
    ["backlog.bio-2024-0007.rung.1", info("backlog.bio-2024-0007.rung.1", "backlog", "bio-2024-0007", "note", 1)],
    ["backlog.bio-2024-0007.since.2", info("backlog.bio-2024-0007.since.2", "backlog", "bio-2024-0007", "since_then", 2)],
    ...EXPLAINER_FIELDS.flatMap((part): [string, ReturnType<typeof info>][] => [
      [`new.new-1.explainer.${part}`, info(`new.new-1.explainer.${part}`, "new", "new-1", part)],
      [`backlog.math-2026-0002.explainer.${part}`, info(`backlog.math-2026-0002.explainer.${part}`, "backlog", "math-2026-0002", part)],
    ]),
  ];

  it.each(VALID)("reads %s", (key, expected) => {
    expect(parseZhKey(key)).toEqual(expected);
  });

  it.each([
    "", "lead", "lead.x", "lead.01", "lead.-1", "lead.0.text", "lead.1.0", "ideas", "also", "also.x", "corrections", "corrections.0", "corrections.x.after",
    "corrections.0.before", "corrections.0.after.en", "reports", "reports.R-0001", "reports.R-0001.after", "rung", "rung.x.y", "returning", "returning.x",
    "returning.x.after", "returning.x.update.en", "new", "new.new-1", "new.new-1.explainer", "new.new-1.explainer.nope", "new.new-1.figure",
    "new.new-1.figure.caption", "new.new-1.since.0", "new.new-1.rung", "new.new-1.rung.x", "new.new-1.rung.01", "new.new-1.title.en", "backlog",
    "backlog.x.since", "backlog.x.since.x", "backlog.x.nope", "review", "review.other", "review.big_picture.en", "deep_dive.text", "terms.protein-folding.zh",
    "unknown.key", "new_findings.0.title",
  ])("reads %j as no key", (key) => {
    expect(parseZhKey(key)).toBeNull();
  });

  it("reads each part of a story's explainer as the prose field of that name", () => {
    expect(EXPLAINER_FIELDS).toEqual(["found", "matters", "ai_helped", "how_sure", "background", "could_lead"]);
    for (const part of EXPLAINER_FIELDS) expect(parseZhKey(`new.new-1.explainer.${part}`)?.field).toBe(part);
  });
});
