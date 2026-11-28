// lib/vocab.ts against SPEC §4.2 (AGENTS.md rule 6: the spec governs). Reads the vocabulary table and the fixed strings of
// §4.2 and checks the values and their order, each English and Chinese label, the glosses and pips the table shows, the
// field codes and glyphs, and the fixed strings, so a value or a label changed in one place and not the other fails here.
// The other vocabulary tests state the expected values themselves; this one reads the spec. New for this project.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as vocab from "@/lib/vocab";

const spec = fs.readFileSync(path.join(__dirname, "..", "SPEC.md"), "utf8");
const section = spec.slice(spec.indexOf("### 4.2 Vocabularies"), spec.indexOf("### 4.3 Shared types"));
const flat = section.replace(/\s+/g, " ");

/** The values cell of each row of the vocabulary table, by the vocabulary's name. */
const cells = new Map<string, string>();
for (const line of section.split("\n")) {
  const row = /^\| `(\w+)`[^|]*\| (.+) \|$/.exec(line);
  if (row) cells.set(row[1]!, row[2]!);
}

interface Entry { id: string; en: string; zh: string; gloss: string | null }

/** The entries of a values cell, "`id` English · 中文 (gloss) · `id` ...": a ";" ends the last one, what follows is about another label. */
function entries(cell: string): Entry[] {
  const parts = cell.split(/(?:^|\s·\s)`(\w+)`\s/).slice(1);
  const out: Entry[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    let rest = parts[i + 1]!.split(";")[0]!.trim();
    let gloss: string | null = null;
    const withGloss = /^(.*?)\s+\(([^()]*)\)$/.exec(rest);
    if (withGloss) { rest = withGloss[1]!; gloss = withGloss[2]!; }
    const [en, zh] = rest.split(" · ");
    out.push({ id: parts[i]!, en: en!, zh: zh!, gloss });
  }
  return out;
}

const cell = (name: string): string => {
  const found = cells.get(name);
  if (found === undefined) throw new Error(`SPEC §4.2's table has no row for ${name}`);
  return found;
};

interface Vocabulary { name: string; ids: readonly string[]; info: Record<string, { en: string; zh: string }> }

const vocabularies: Vocabulary[] = [
  { name: "FIELDS", ids: vocab.FIELDS, info: vocab.FIELD_INFO },
  { name: "KINDS", ids: vocab.KINDS, info: vocab.KIND_INFO },
  { name: "RUNGS", ids: vocab.RUNGS, info: vocab.RUNG_INFO },
  { name: "FELL_RUNGS", ids: vocab.FELL_RUNGS, info: vocab.RUNG_INFO },
  { name: "AI_ROLES", ids: vocab.AI_ROLES, info: vocab.AI_ROLE_INFO },
  { name: "AI_CONFIDENCE", ids: vocab.AI_CONFIDENCE, info: vocab.AI_CONFIDENCE_INFO },
  { name: "SIGNIFICANCE", ids: vocab.SIGNIFICANCE, info: vocab.SIGNIFICANCE_INFO },
  { name: "SOURCE_KINDS", ids: vocab.SOURCE_KINDS, info: vocab.SOURCE_KIND_INFO },
  { name: "EDITIONS", ids: vocab.EDITIONS, info: vocab.EDITION_INFO },
  { name: "FORMATS", ids: vocab.FORMATS, info: vocab.FORMAT_INFO },
  { name: "REPORT_KINDS", ids: vocab.REPORT_KINDS, info: vocab.REPORT_KIND_INFO },
  { name: "EXPLAINER_PARTS", ids: vocab.EXPLAINER_PARTS, info: vocab.EXPLAINER_PART_INFO },
];

describe("SPEC §4.2's table and lib/vocab", () => {
  it("reads the table's rows and its twelve labelled vocabularies", () => {
    expect([...cells.keys()]).toEqual([
      "FIELDS", "FIELD_CODES", "KINDS", "RUNGS", "FELL_RUNGS", "COUNTED_RUNGS", "AI_ROLES", "AI_CONFIDENCE", "SIGNIFICANCE",
      "SOURCE_KINDS", "EDITIONS", "FORMATS", "REPORT_KINDS", "EXPLAINER_PARTS",
    ]);
    expect(vocabularies).toHaveLength(12);
    expect(entries(cell("FIELDS")).map((e) => e.id)).toEqual(["mathematics", "physics", "chemistry", "biology", "earth", "social", "humanities"]);
  });

  it.each(vocabularies.map((v) => [v.name, v] as const))("%s: the same values in the same order, each with the spec's English and Chinese labels", (name, v) => {
    const spec = entries(cell(name));
    expect(spec.map((e) => e.id)).toEqual([...v.ids]);
    for (const e of spec) {
      const label = e.en.replace(/^[●○]+ /, "");
      expect(v.info[e.id], `${name}.${e.id}`).toMatchObject({ en: label, zh: e.zh });
    }
  });

  it("keeps each _INFO record to the ids of its tuple, and the rung labels to the ladder and the two that fell", () => {
    for (const v of vocabularies.filter((x) => x.name !== "RUNGS" && x.name !== "FELL_RUNGS")) {
      expect(Object.keys(v.info).sort(), v.name).toEqual([...v.ids].sort());
    }
    expect(Object.keys(vocab.RUNG_INFO)).toEqual([...vocab.RUNGS, ...vocab.FELL_RUNGS]);
    expect([...vocab.ALL_RUNGS]).toEqual([...vocab.RUNGS, ...vocab.FELL_RUNGS]);
  });

  it("shows each significance with its pips, four for Landmark down to one for Watch", () => {
    const spec = entries(cell("SIGNIFICANCE"));
    spec.forEach((e, i) => {
      const pips = /^([●○]+) /.exec(e.en)![1]!;
      expect(vocab.SIGNIFICANCE_INFO[e.id as vocab.Significance], e.id).toMatchObject({ pips, rank: spec.length - i });
      expect(pips, e.id).toHaveLength(4);
      expect([...pips].filter((c) => c === "●"), e.id).toHaveLength(spec.length - i);
    });
  });

  it("glosses each source kind as the table does, where the table gives one", () => {
    const spec = entries(cell("SOURCE_KINDS"));
    expect(spec.filter((e) => e.gloss !== null).map((e) => e.id)).toEqual(["paper", "preprint", "proof", "dataset", "registry", "statement", "lab_post", "checker", "reaction", "notice"]);
    for (const e of spec) {
      const means = vocab.SOURCE_KIND_INFO[e.id as vocab.SourceKind].means;
      // the table's reference to §4.11 after "checker" is a pointer, not part of the gloss
      if (e.gloss !== null) expect(means, e.id).toBe(e.gloss.replace(/, §[\d.]+$/, ""));
      expect(means, e.id).toMatch(/^[a-z]/);
      expect(means, e.id).not.toMatch(/\.$/);
    }
  });

  it("gives Monday's format Mondays and Sunday's Sundays, and the daily one no day", () => {
    const weekday = { Mondays: 1, Sundays: 0 } as const;
    for (const e of entries(cell("FORMATS"))) {
      const expected = e.gloss === null ? null : weekday[e.gloss.replace(/^\(|\)$/g, "") as keyof typeof weekday];
      expect(vocab.FORMAT_INFO[e.id as vocab.Format].weekday, e.id).toBe(expected);
    }
    expect(entries(cell("FORMATS")).map((e) => e.gloss)).toEqual([null, "Mondays", "Sundays"]);
  });

  it("lists the report kinds as the form's options, `en · zh` in the table's order", () => {
    const spec = entries(cell("REPORT_KINDS"));
    expect(vocab.REPORT_FORM_OPTIONS).toEqual(spec.map((e) => `${e.en} · ${e.zh}`));
    expect(spec.map((e) => vocab.reportFormOption(e.id as vocab.ReportKind))).toEqual([...vocab.REPORT_FORM_OPTIONS]);
  });

  it("gives the field codes of the finding ids and their glyphs in capitals, the Chinese label on a Chinese page", () => {
    const row = cell("FIELD_CODES");
    expect([...row.split("(")[0]!.matchAll(/`(\w+)`/g)].map((m) => m[1])).toEqual([...vocab.FIELD_CODES]);
    const glyphs = /\(([A-Z, ]+);/.exec(row)![1]!.split(", ");
    expect(glyphs).toEqual(vocab.FIELD_CODES.map((c) => c.toUpperCase()));
    vocab.FIELDS.forEach((field, i) => {
      expect(vocab.FIELD_CODE_OF[field], field).toBe(vocab.FIELD_CODES[i]);
      expect(vocab.FIELD_OF_CODE[vocab.FIELD_CODES[i]!], field).toBe(field);
      expect(vocab.fieldGlyph(field, "en"), field).toBe(glyphs[i]);
      expect(vocab.fieldGlyph(field, "zh"), field).toBe(vocab.FIELD_INFO[field].zh);
    });
    expect(row).toContain("on Chinese pages the zh label");
  });

  it("counts only the rungs the table names", () => {
    expect([...cell("COUNTED_RUNGS").split(":")[0]!.matchAll(/`(\w+)`/g)].map((m) => m[1])).toEqual([...vocab.COUNTED_RUNGS]);
  });

  it("labels the English-only edition and the Go deeper line as the table's notes do", () => {
    const editions = cell("EDITIONS");
    const [en, zh] = /also labelled (.+?) · (.+)$/.exec(editions)!.slice(1, 3);
    expect(vocab.ENGLISH_ONLY_LABEL).toEqual({ en, zh });
    const [goEn, goZh] = /then (.+?) · (.+)$/.exec(cell("EXPLAINER_PARTS"))!.slice(1, 3);
    expect(vocab.GO_DEEPER_LABEL).toEqual({ en: goEn, zh: goZh });
  });
});

describe("SPEC §4.2's fixed strings and lib/vocab", () => {
  /** `NAME` ("English" · 「中文」), with the name set in bold in one place. */
  const fixed = (name: string): { en: string; zh: string } => {
    const found = new RegExp(`\`${name}\`(?:\\*\\*)? \\(\\"([^\\"]+)\\" · 「([^」]+)」\\)`).exec(flat);
    if (!found) throw new Error(`SPEC §4.2 gives no words for ${name}`);
    return { en: found[1]!, zh: found[2]! };
  };

  it.each([
    ["NONE_FOUND", vocab.NONE_FOUND],
    ["NO_AI_PART", vocab.NO_AI_PART],
    ["DISCLOSURE", vocab.DISCLOSURE],
    ["END_LINE", vocab.END_LINE],
    ["REMOVED_TEXT", vocab.REMOVED_TEXT],
    ["REMOVED_BEFORE", vocab.REMOVED_BEFORE],
  ] as const)("%s has the words the spec gives, in both languages", (name, value) => {
    expect(value).toEqual(fixed(name));
  });

  it("holds the fixed strings the spec leaves unworded as this project's own, in both languages", () => {
    for (const notice of [vocab.DATA_ONLY_NOTICE, vocab.ENGLISH_ONLY_NOTICE, vocab.partialNotice(["Example feed"])]) {
      expect(notice.en.length).toBeGreaterThan(20);
      expect(notice.zh.length).toBeGreaterThan(10);
      expect(notice.en).not.toMatch(/[一-鿿]/);
    }
  });
});

describe("SPEC §4.2's BLOCKED_HOSTS and lib/vocab", () => {
  // the paragraph that lists the shadow libraries' hosts "exactly", and the labels that catch their mirrors
  const paragraph = flat.slice(flat.indexOf("**`BLOCKED_HOSTS`**"), flat.indexOf("**`REMOVED_TEXT`**"));
  const hosts = [...(/at writing (.+?) \(\*\*Verify in P3/.exec(paragraph)![1]!).matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const labels = [...(/a pattern with no dot \((.+?)\) that/.exec(paragraph)![1]!).matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

  it("reads the hosts and the labels the spec names", () => {
    expect(hosts).toEqual([
      "sci-hub.se", "sci-hub.st", "sci-hub.ru", "libgen.is", "libgen.rs", "libgen.li", "z-lib.org", "z-library.sk", "annas-archive.org",
      "annas-archive.se", "annas-archive.li",
    ]);
    expect(labels).toEqual(["sci-hub", "libgen", "z-lib", "z-library", "annas-archive"]);
  });

  it("blocks each of them as a shadow library, a host as a host and a label as a label (P3 may add more, never fewer)", () => {
    const reasonOf = new Map(vocab.BLOCKED_HOSTS.map((b) => [b.pattern, b.reason]));
    for (const pattern of [...hosts, ...labels]) expect(reasonOf.get(pattern), pattern).toBe("shadow_library");
    for (const host of hosts) expect(vocab.blockedForm(host), host).toBe("host");
    for (const label of labels) expect(vocab.blockedForm(label), label).toBe("label");
    for (const host of hosts) expect(vocab.blockedHostEntries(), host).toContain(host);
    for (const label of labels) expect(vocab.blockedHostEntries(), label).not.toContain(label);
  });

  it("drops the exploit reason and the code hosts of the fork base, and adds the shadow libraries as a reason", () => {
    expect([...vocab.BLOCK_REASONS]).not.toContain("exploit_code");
    expect([...vocab.BLOCK_REASONS]).toContain("shadow_library");
    expect(new Set(vocab.BLOCKED_HOSTS.map((b) => b.reason))).toEqual(new Set(vocab.BLOCK_REASONS));
    for (const host of ["gitlab.com", "bitbucket.org", "codeberg.org", "sourceforge.net", "huggingface.co"]) {
      expect(vocab.BLOCKED_HOSTS.some((b) => b.pattern === host), host).toBe(false);
    }
  });
});
