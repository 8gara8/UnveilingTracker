// lib/vocab.ts (SPEC §4.2; §4.1 and §4.4 for the lists the rules read; §9.5 for BLOCKED_HOSTS): every vocabulary
// with its labels in both languages, the fixed strings and notices, the blocked list and the canary. The labels,
// the fixed strings and the lists are read back from the spec's own text, so the spec and the code cannot drift
// apart (AGENTS.md rule 6). New for this project; Cyber's blocked-host cases (tests/lib.test.ts at the fork commit)
// return with `blockedEntry()` in lib/urls.ts, and Cyber's vocabularies are not this project's (docs/PROVENANCE.md).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { weekday } from "@/lib/dates";
import type { Bilingual, L10n } from "@/lib/i18n";
import {
  ABBREVIATIONS, AI_CONFIDENCE, AI_CONFIDENCE_INFO, AI_ROLES, AI_ROLE_INFO, ALL_RUNGS, ANTHROPIC_PHRASES, BLOCKED_HOSTS, BLOCK_REASONS,
  CANARY_TOKEN, CANARY_URL_MARK, CANARY_URL_PREFIX, CLAUDE_PEOPLE, COUNTED_RUNGS, DATA_ONLY_NOTICE, DISCLOSURE, EDITIONS, EDITION_INFO,
  END_LINE, ENGLISH_ONLY_LABEL, ENGLISH_ONLY_NOTICE, EXPLAINER_PARTS, EXPLAINER_PART_INFO, FELL_RUNGS, FIELDS, FIELD_CODES, FIELD_CODE_OF,
  FIELD_INFO, FIELD_OF_CODE, FINDING_KINDS, FORMATS, FORMAT_INFO, GO_DEEPER_LABEL, ID_PATHS, ITEM_PARTS, KINDS, KIND_INFO, NONE_FOUND, NO_AI_PART,
  REMOVED_BEFORE, REMOVED_TEXT, REPORT_FORM_OPTIONS, REPORT_KINDS, REPORT_KIND_INFO, RUNGS, RUNG_INFO, SIGNIFICANCE, SIGNIFICANCE_INFO,
  SOURCE_KINDS, SOURCE_KIND_INFO, blockedForm, blockedHostEntries, fieldGlyph, formatForWeekday, idLabel, partialNotice, reportFormOption, statusNote,
  type AiConfidence, type AiRole, type BlockReason, type BlockedForm, type BlockedHost, type CountedRung, type Edition, type ExplainerPart,
  type FellRung, type FieldCode, type FieldId, type FindingKind, type Format, type IdPath, type Kind, type LadderRung, type ReportKind, type Rung,
  type Significance, type SourceKind,
} from "@/lib/vocab";

const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

// ── The spec's own text ──────────────────────────────────────────────────────────────────────────

const spec = read("SPEC.md");
/** §4.2 alone, so a table elsewhere in the spec cannot be taken for one of its rows. */
const section = spec.slice(spec.indexOf("### 4.2 Vocabularies"), spec.indexOf("### 4.3 Shared types"));
/** The same text on one line, so a sentence the spec wraps reads as it would unwrapped. */
const flat = (text: string) => text.replace(/\s+/g, " ");

/** The values cell of §4.2's table row for `name`. */
function specCell(name: string): string {
  const line = section.split("\n").find((l) => l.startsWith(`| \`${name}\``));
  if (!line) throw new Error(`SPEC §4.2 has no table row for ${name}`);
  return line.split("|")[2]!.trim();
}

interface SpecItem { id: string; pips: string | null; en: string; zh: string }

/** The items of a row written as "`id` English · 中文", with the pips of SIGNIFICANCE when there are any. */
function specItems(name: string): SpecItem[] {
  const item = /`([a-z_]+)` (?:([●○]+) )?(.+?) · (.+?)(?= \(|; | · `|$)/g;
  return [...specCell(name).matchAll(item)].map((m) => ({ id: m[1]!, pips: m[2] ?? null, en: m[3]!, zh: m[4]! }));
}

/** A row's ids and labels must be the tuple's values, in the tuple's order, and the `_INFO` record's labels. */
function expectRow(name: string, ids: readonly string[], info: Record<string, Bilingual>) {
  const items = specItems(name);
  expect(items.map((i) => i.id), `${name} ids`).toEqual([...ids]);
  expect(items.map((i) => [i.en, i.zh]), `${name} labels`).toEqual(ids.map((id) => [info[id]!.en, info[id]!.zh]));
  expect(Object.keys(info), `${name} record keys`).toEqual([...ids]);
}

/** The labels of just some ids of a record, as a record: RUNGS and FELL_RUNGS share RUNG_INFO. */
function pick<K extends string>(info: Record<string, Bilingual>, ids: readonly K[]): Record<K, Bilingual> {
  return Object.fromEntries(ids.map((id) => [id, info[id]!])) as Record<K, Bilingual>;
}

/** The text of the spec from the heading that starts with `from` to the one that starts with `to`. */
function specSection(from: string, to: string): string {
  return spec.slice(spec.indexOf(from), spec.indexOf(to));
}

/** The quoted values of one of §4.3's `type X = "a" | "b";` lines. */
function specUnion(name: string): string[] {
  const line = new RegExp(`type ${name} = ([^;]+);`).exec(spec);
  if (!line) throw new Error(`SPEC.md has no type ${name}`);
  return [...line[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

// ── Label hygiene, over every fixed string in both languages ─────────────────────────────────────

const HAN = /\p{Script=Han}/u;
/** The punctuation Chinese text uses, full-width; none belongs in an English label. */
const CHINESE_PUNCTUATION = /[，。、：；？！（）「」『』〔〕]/;
const termsZh = JSON.parse(read("config/terms-zh.json")) as { simplified_only: string; japanese_only?: string | string[] };
const simplifiedOnly = new Set([...termsZh.simplified_only]);
/** ZH_TRADITIONAL (SPEC §4.12) also refuses a `japanese_only` character, once the file lists any. */
const japaneseOnly = new Set([...(termsZh.japanese_only ?? "")]);

// Dashes are written by code point, never out: this file may hold none itself (NO_EM_DASH).
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
/** The dashes ZH_NO_DASH lets through besides an en dash between digits (SPEC §4.12): U+002D, U+2010 and U+2011. */
const ALLOWED_ZH_DASHES = [0x2d, 0x2010, 0x2011].map((c) => String.fromCharCode(c));
/** The box-drawing lines it also refuses: U+2500 and U+2501. */
const BOX_LINES = [0x2500, 0x2501].map((c) => String.fromCharCode(c));

/** Whether Chinese text breaks ZH_NO_DASH, read as written. */
function hasZhDash(text: string): boolean {
  const rest = ALLOWED_ZH_DASHES.reduce((s, d) => s.split(d).join(""), text).replace(new RegExp(`(?<=\\d)${EN_DASH}(?=\\d)`, "g"), "");
  return /\p{Pd}/u.test(rest) || BOX_LINES.some((b) => rest.includes(b));
}

type Strings = Record<string, Bilingual>;
const RECORDS: Record<string, Strings> = {
  FIELD_INFO, KIND_INFO, RUNG_INFO, AI_ROLE_INFO, AI_CONFIDENCE_INFO, SIGNIFICANCE_INFO, SOURCE_KIND_INFO, EDITION_INFO, FORMAT_INFO,
  REPORT_KIND_INFO, EXPLAINER_PART_INFO,
};
const SINGLES: Strings = {
  ENGLISH_ONLY_LABEL, GO_DEEPER_LABEL, NONE_FOUND, NO_AI_PART, DISCLOSURE, REMOVED_TEXT, REMOVED_BEFORE, END_LINE, DATA_ONLY_NOTICE,
  ENGLISH_ONLY_NOTICE,
  "partialNotice([])": partialNotice([]),
  "partialNotice(one feed)": partialNotice(["Nature"]),
  "partialNotice(three feeds)": partialNotice(["Nature", "arXiv", "OpenAlex"]),
};
/** Every label and fixed string, named as `RECORD.id` or by its own name. */
const ALL: { name: string; text: Bilingual }[] = [
  ...Object.entries(RECORDS).flatMap(([record, labels]) => Object.entries(labels).map(([id, text]) => ({ name: `${record}.${id}`, text }))),
  ...Object.entries(SINGLES).map(([name, text]) => ({ name, text })),
];

describe("the spec's §4.2", () => {
  it("is found, with a table row for every vocabulary the tests read", () => {
    expect(section.length).toBeGreaterThan(1000);
    for (const row of ["FIELDS", "FIELD_CODES", "KINDS", "RUNGS", "FELL_RUNGS", "COUNTED_RUNGS", "AI_ROLES", "AI_CONFIDENCE", "SIGNIFICANCE",
      "SOURCE_KINDS", "EDITIONS", "FORMATS", "REPORT_KINDS", "EXPLAINER_PARTS"]) {
      expect(specCell(row).length, row).toBeGreaterThan(10);
    }
  });
});

describe("every label and fixed string", () => {
  it("is covered: eleven records, ten constants and three partial notices make 73 in all", () => {
    expect(Object.keys(RECORDS)).toHaveLength(11);
    expect(Object.keys(SINGLES)).toHaveLength(13);
    expect(ALL).toHaveLength(60 + 13);
    expect(new Set(ALL.map((a) => a.name)).size).toBe(ALL.length);
  });

  it("has English with no Han character, no full-width punctuation and no stray space", () => {
    for (const { name, text } of ALL) {
      expect(text.en, name).toMatch(/\S/);
      expect(text.en, name).toBe(text.en.trim());
      expect(text.en, name).not.toMatch(HAN);
      expect(text.en, name).not.toMatch(CHINESE_PUNCTUATION);
    }
  });

  it("has Chinese with Han characters, no stray space and full-width punctuation", () => {
    for (const { name, text } of ALL) {
      expect(text.zh, name).toMatch(HAN);
      expect(text.zh, name).toBe(text.zh.trim());
      expect(text.zh, name).not.toMatch(/[,;:?!()]/);
    }
  });

  it("tells a dash that ZH_NO_DASH refuses from one it allows", () => {
    expect(hasZhDash(`2015${EN_DASH}2019`)).toBe(false);
    expect(hasZhDash(`AI${ALLOWED_ZH_DASHES.join("")}提出`)).toBe(false);
    expect(hasZhDash(`甲${EN_DASH}乙`)).toBe(true);
    expect(hasZhDash(`甲${EM_DASH}乙`)).toBe(true);
    expect(hasZhDash(`甲${EM_DASH}${EM_DASH}乙`)).toBe(true);
    expect(hasZhDash(`甲${String.fromCharCode(0x2500)}乙`)).toBe(true);
    expect(hasZhDash(`甲${String.fromCharCode(0xff0d)}乙`)).toBe(true);
    expect(hasZhDash("甲、乙")).toBe(false);
  });

  it("holds no em-dash, and no dash in Chinese that ZH_NO_DASH refuses", () => {
    for (const { name, text } of ALL) {
      expect(text.en, name).not.toContain(EM_DASH);
      expect(text.zh, name).not.toContain(EM_DASH);
      expect(text.en, name).not.toContain(EN_DASH);
      expect(hasZhDash(text.zh), name).toBe(false);
    }
  });

  it("holds no character that only simplified or only Japanese writing uses (ZH_TRADITIONAL, config/terms-zh.json)", () => {
    expect(simplifiedOnly.size).toBeGreaterThan(1000);
    for (const { name, text } of ALL) {
      expect([...text.zh].filter((c) => simplifiedOnly.has(c) || japaneseOnly.has(c)), name).toEqual([]);
    }
  });

  it("separates each Latin word from a Han character with a space, as the spec's own labels do", () => {
    for (const { name, text } of ALL) {
      expect(text.zh, name).not.toMatch(/[A-Za-z0-9][\p{Script=Han}]|[\p{Script=Han}][A-Za-z0-9]/u);
    }
    expect(AI_ROLE_INFO.ai_proposed.zh).toBe("AI 提出");
  });

  it("differs in the two languages, and between the values of one vocabulary", () => {
    for (const { name, text } of ALL) expect(text.en, name).not.toBe(text.zh);
    for (const [record, labels] of Object.entries(RECORDS)) {
      const values = Object.values(labels);
      expect(new Set(values.map((v) => v.en)).size, `${record} en`).toBe(values.length);
      expect(new Set(values.map((v) => v.zh)).size, `${record} zh`).toBe(values.length);
    }
  });

  it("is assignable to an L10n, so a brief's status_note and a page can hold it", () => {
    const asL10n: L10n = NONE_FOUND;
    expect(asL10n.zh).toBe("本週沒有發現。");
    expectTypeOf<Bilingual>().toExtend<L10n>();
    expectTypeOf(FIELD_INFO.physics).toExtend<L10n>();
  });
});

// ── Fields ───────────────────────────────────────────────────────────────────────────────────────

describe("FIELDS and FIELD_CODES", () => {
  it("are the seven fields of the spec, in order, with its labels", () => {
    expect([...FIELDS]).toEqual(["mathematics", "physics", "chemistry", "biology", "earth", "social", "humanities"]);
    expect(specUnion("FieldId")).toEqual([...FIELDS]);
    expectRow("FIELDS", FIELDS, FIELD_INFO);
    expect(FIELD_INFO.chemistry).toEqual({ en: "Chemistry and materials", zh: "化學與材料" });
    expect(FIELD_INFO.humanities).toEqual({ en: "Theology and humanities", zh: "神學與人文" });
    expectTypeOf<FieldId>().toEqualTypeOf<"mathematics" | "physics" | "chemistry" | "biology" | "earth" | "social" | "humanities">();
  });

  it("have the codes of finding ids, in FIELDS order, as the id format of §4.3 lists them", () => {
    expect([...FIELD_CODES]).toEqual(["math", "phys", "chem", "bio", "earth", "soc", "hum"]);
    const codes = [...specCell("FIELD_CODES").matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
    expect(codes).toEqual([...FIELD_CODES]);
    const idFormat = /Finding\*\* `\^\(([a-z|]+)\)-/.exec(spec)![1];
    expect(FIELD_CODES.join("|")).toBe(idFormat);
    expectTypeOf<FieldCode>().toEqualTypeOf<"math" | "phys" | "chem" | "bio" | "earth" | "soc" | "hum">();
  });

  it("map to each other both ways, one code to a field", () => {
    expect(FIELDS.map((f) => FIELD_CODE_OF[f])).toEqual([...FIELD_CODES]);
    expect(FIELD_CODES.map((c) => FIELD_OF_CODE[c])).toEqual([...FIELDS]);
    for (const f of FIELDS) expect(FIELD_OF_CODE[FIELD_CODE_OF[f]]).toBe(f);
    expect(Object.keys(FIELD_CODE_OF)).toEqual([...FIELDS]);
    expect(Object.keys(FIELD_OF_CODE)).toEqual([...FIELD_CODES]);
  });

  it("give the glyph the spec describes: the code in capitals, or on a Chinese page the Chinese label", () => {
    const capitals = [...specCell("FIELD_CODES").match(/\(([A-Z, ]+);/)![1]!.split(", ")];
    expect(capitals).toEqual(["MATH", "PHYS", "CHEM", "BIO", "EARTH", "SOC", "HUM"]);
    expect(FIELDS.map((f) => fieldGlyph(f, "en"))).toEqual(capitals);
    expect(FIELDS.map((f) => fieldGlyph(f, "zh"))).toEqual(FIELDS.map((f) => FIELD_INFO[f].zh));
    expect(fieldGlyph("humanities", "en")).toBe("HUM");
    expect(fieldGlyph("humanities", "zh")).toBe("神學與人文");
  });
});

// ── Kinds ────────────────────────────────────────────────────────────────────────────────────────

describe("KINDS and FINDING_KINDS", () => {
  it("are the seven kinds of the spec, in order, with its labels", () => {
    expect([...KINDS]).toEqual(["result", "capability", "check", "setback", "infrastructure", "policy_people", "idea"]);
    expectRow("KINDS", KINDS, KIND_INFO);
    expect(KIND_INFO.capability.zh).toBe("能力進展");
    expectTypeOf<Kind>().toEqualTypeOf<"result" | "capability" | "check" | "setback" | "infrastructure" | "policy_people" | "idea">();
  });

  it("leave out the idea for a finding: ideas are only Ideas and debate lines (SPEC §4.2, §4.4)", () => {
    expect([...FINDING_KINDS]).toEqual(KINDS.filter((k) => k !== "idea"));
    expect(FINDING_KINDS).not.toContain("idea");
    expect(specCell("KINDS")).toContain("ideas appear only as Ideas and debate lines, never as findings");
    expectTypeOf<FindingKind>().toEqualTypeOf<Exclude<Kind, "idea">>();
  });
});

// ── The Verification Ladder ──────────────────────────────────────────────────────────────────────

describe("RUNGS, FELL_RUNGS, ALL_RUNGS and COUNTED_RUNGS", () => {
  it("are the ladder's five rungs in ladder order, with the spec's labels", () => {
    expect([...RUNGS]).toEqual(["claimed", "preprint", "checked", "confirmed", "applied"]);
    expectRow("RUNGS", RUNGS, pick(RUNG_INFO, RUNGS));
    expectTypeOf<LadderRung>().toEqualTypeOf<"claimed" | "preprint" | "checked" | "confirmed" | "applied">();
  });

  it("have the two rungs a finding falls to, with the spec's labels", () => {
    expect([...FELL_RUNGS]).toEqual(["disputed", "retracted"]);
    expectRow("FELL_RUNGS", FELL_RUNGS, pick(RUNG_INFO, FELL_RUNGS));
    expect(RUNG_INFO.retracted.zh).toBe("已撤稿");
    expectTypeOf<FellRung>().toEqualTypeOf<"disputed" | "retracted">();
  });

  it("make every rung of §4.3's Rung type, each labelled once", () => {
    expect([...ALL_RUNGS]).toEqual([...RUNGS, ...FELL_RUNGS]);
    expect(Object.keys(RUNG_INFO)).toEqual([...ALL_RUNGS]);
    expectTypeOf<Rung>().toEqualTypeOf<"claimed" | "preprint" | "checked" | "confirmed" | "applied" | "disputed" | "retracted">();
    expect(specUnion("Rung")).toEqual([...ALL_RUNGS]);
  });

  it("count only checked, confirmed and applied, the top three rungs of the ladder", () => {
    expect([...COUNTED_RUNGS]).toEqual(["checked", "confirmed", "applied"]);
    expect([...specCell("COUNTED_RUNGS").matchAll(/`([a-z]+)`/g)].map((m) => m[1])).toEqual([...COUNTED_RUNGS]);
    expect([...COUNTED_RUNGS]).toEqual(RUNGS.slice(2));
    for (const r of FELL_RUNGS) expect(COUNTED_RUNGS as readonly string[]).not.toContain(r);
    expectTypeOf<CountedRung>().toEqualTypeOf<"checked" | "confirmed" | "applied">();
  });
});

// ── The AI role and its confidence ───────────────────────────────────────────────────────────────

describe("AI_ROLES and AI_CONFIDENCE", () => {
  it("are the six roles of the spec, in order, with its labels", () => {
    expect([...AI_ROLES]).toEqual(["ai_proposed", "ai_solved", "ai_ran", "ai_tool", "ai_checked", "none"]);
    expectRow("AI_ROLES", AI_ROLES, AI_ROLE_INFO);
    expect(AI_ROLE_INFO.none).toEqual({ en: "No AI role", zh: "無 AI 角色" });
    expectTypeOf<AiRole>().toEqualTypeOf<"ai_proposed" | "ai_solved" | "ai_ran" | "ai_tool" | "ai_checked" | "none">();
  });

  it("have the two confidences, in order, with the spec's labels", () => {
    expect([...AI_CONFIDENCE]).toEqual(["confirmed", "claimed"]);
    expectRow("AI_CONFIDENCE", AI_CONFIDENCE, AI_CONFIDENCE_INFO);
    expect(AI_CONFIDENCE_INFO.claimed).toEqual({ en: "Claimed by the lab", zh: "實驗室自稱" });
    expectTypeOf<AiConfidence>().toEqualTypeOf<"confirmed" | "claimed">();
  });
});

// ── Significance ─────────────────────────────────────────────────────────────────────────────────

describe("SIGNIFICANCE", () => {
  it("is Landmark, Major, Notable, Watch, highest first, with the spec's labels and pips", () => {
    expect([...SIGNIFICANCE]).toEqual(["landmark", "major", "notable", "watch"]);
    expectRow("SIGNIFICANCE", SIGNIFICANCE, SIGNIFICANCE_INFO);
    expect(specItems("SIGNIFICANCE").map((i) => i.pips)).toEqual(SIGNIFICANCE.map((s) => SIGNIFICANCE_INFO[s].pips));
    expectTypeOf<Significance>().toEqualTypeOf<"landmark" | "major" | "notable" | "watch">();
  });

  it("shows four pips, as many filled as the rank, and ranks 4 down to 1", () => {
    expect(SIGNIFICANCE.map((s) => SIGNIFICANCE_INFO[s].pips)).toEqual(["●●●●", "●●●○", "●●○○", "●○○○"]);
    expect(SIGNIFICANCE.map((s) => SIGNIFICANCE_INFO[s].rank)).toEqual([4, 3, 2, 1]);
    for (const s of SIGNIFICANCE) {
      const { pips, rank } = SIGNIFICANCE_INFO[s];
      expect([...pips]).toHaveLength(4);
      expect([...pips].filter((p) => p === "●")).toHaveLength(rank);
      expect([...pips].filter((p) => p === "○")).toHaveLength(4 - rank);
    }
  });
});

// ── Sources ──────────────────────────────────────────────────────────────────────────────────────

describe("SOURCE_KINDS", () => {
  it("are the ten kinds of the spec, in order, with its labels", () => {
    expect([...SOURCE_KINDS]).toEqual(["paper", "preprint", "proof", "dataset", "registry", "statement", "lab_post", "checker", "reaction", "notice"]);
    expectRow("SOURCE_KINDS", SOURCE_KINDS, SOURCE_KIND_INFO);
    expect(SOURCE_KIND_INFO.notice).toMatchObject({ en: "Notice", zh: "撤稿、更正或關注聲明" });
    expect(SOURCE_KIND_INFO.checker.en).toBe("Checker's record");
    expectTypeOf<SourceKind>().toEqualTypeOf<"paper" | "preprint" | "proof" | "dataset" | "registry" | "statement" | "lab_post" | "checker" | "reaction" | "notice">();
  });

  it("explain each kind in the spec's own words where it gives them, and in its style where it does not", () => {
    const glosses = [...specCell("SOURCE_KINDS").matchAll(/`([a-z_]+)` ([^·]+?) · ([^(·`]+?) \(([^)]+)\)/g)];
    expect(glosses.map((m) => m[1])).toEqual(["paper", "proof", "registry", "statement", "lab_post", "checker", "reaction", "notice"]);
    for (const m of glosses) {
      expect(SOURCE_KIND_INFO[m[1] as SourceKind].means, m[1]).toBe(m[4]!.replace(/, §[\d.]+$/, ""));
    }
    for (const kind of SOURCE_KINDS) {
      const { means } = SOURCE_KIND_INFO[kind];
      expect(means, kind).toMatch(/^[a-z][a-z' ,-]+[a-z]$/);
    }
  });
});

// ── Editions and formats ─────────────────────────────────────────────────────────────────────────

describe("EDITIONS", () => {
  it("are full, partial and data-only, with the spec's labels, and the English-only edition has its own", () => {
    expect([...EDITIONS]).toEqual(["full", "partial", "data_only"]);
    expectRow("EDITIONS", EDITIONS, EDITION_INFO);
    const label = /labelled (.+?) · (\S+)$/.exec(specCell("EDITIONS"))!;
    expect(ENGLISH_ONLY_LABEL).toEqual({ en: label[1], zh: label[2] });
    expect(ENGLISH_ONLY_LABEL).toEqual({ en: "English-only", zh: "僅英文版" });
    expect(EDITIONS as readonly string[]).not.toContain("english_only");
    expectTypeOf<Edition>().toEqualTypeOf<"full" | "partial" | "data_only">();
  });
});

describe("FORMATS and formatForWeekday()", () => {
  it("are the daily brief, the Monday review and the Sunday deep dive, with the spec's labels", () => {
    expect([...FORMATS]).toEqual(["daily", "monday_review", "sunday_deep_dive"]);
    expectRow("FORMATS", FORMATS, FORMAT_INFO);
    expect(specCell("FORMATS")).toContain("`monday_review` Week in review · 一週回顧 (Mondays)");
    expect(specCell("FORMATS")).toContain("`sunday_deep_dive` Sunday deep dive · 週日深度報導 (Sundays)");
    expectTypeOf<Format>().toEqualTypeOf<"daily" | "monday_review" | "sunday_deep_dive">();
  });

  it("belong to a weekday as lib/dates numbers them: Monday 1, Sunday 0, no other day", () => {
    expect(FORMATS.map((f) => FORMAT_INFO[f].weekday)).toEqual([null, 1, 0]);
  });

  it("give the format of each weekday, 0 for Sunday to 6 for Saturday", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(formatForWeekday)).toEqual([
      "sunday_deep_dive", "monday_review", "daily", "daily", "daily", "daily", "daily",
    ]);
  });

  it("give the format of an edition date through weekday() of lib/dates", () => {
    const week: [string, Format][] = [
      ["2026-11-22", "sunday_deep_dive"], ["2026-11-23", "monday_review"], ["2026-11-24", "daily"], ["2026-11-25", "daily"],
      ["2026-11-26", "daily"], ["2026-11-27", "daily"], ["2026-11-28", "daily"], ["2026-11-29", "sunday_deep_dive"],
    ];
    for (const [date, format] of week) expect(formatForWeekday(weekday(date)), date).toBe(format);
  });

  it("refuse a number that is not a weekday", () => {
    for (const bad of [-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatForWeekday(bad), String(bad)).toThrow(RangeError);
    }
  });
});

// ── Reader reports ───────────────────────────────────────────────────────────────────────────────

describe("REPORT_KINDS", () => {
  it("are the five kinds of the spec, in order, with its labels", () => {
    expect([...REPORT_KINDS]).toEqual(["fact", "source", "rung", "link", "dangerous"]);
    expectRow("REPORT_KINDS", REPORT_KINDS, REPORT_KIND_INFO);
    expectTypeOf<ReportKind>().toEqualTypeOf<"fact" | "source" | "rung" | "link" | "dangerous">();
  });

  it("show each option of the form as English · Chinese", () => {
    expect(reportFormOption("fact")).toBe("A fact or number is wrong · 事實或數字有誤");
    expect(reportFormOption("dangerous")).toBe("It gives detail that could help cause harm · 內容提供了可能被用來造成危害的細節");
    expect(REPORT_FORM_OPTIONS).toEqual(REPORT_KINDS.map((k) => `${REPORT_KIND_INFO[k].en} · ${REPORT_KIND_INFO[k].zh}`));
    expect(new Set(REPORT_FORM_OPTIONS).size).toBe(REPORT_KINDS.length);
    for (const option of REPORT_FORM_OPTIONS) expect(option.split(" · ")).toHaveLength(2);
  });

  it("are the options of the issue form, exactly, so a report can be read back by its English part (SPEC §9.2)", () => {
    const form = parse(read(".github/ISSUE_TEMPLATE/error-report.yml")) as { body: { id: string; attributes: { options?: string[] } }[] };
    const dropdown = form.body.find((b) => b.id === "report_kind")!;
    expect(dropdown.attributes.options).toEqual([...REPORT_FORM_OPTIONS]);
  });
});

// ── The explainer ────────────────────────────────────────────────────────────────────────────────

describe("EXPLAINER_PARTS", () => {
  it("are the six parts in the spec's order, with its labels, and Go deeper after them", () => {
    expect([...EXPLAINER_PARTS]).toEqual(["found", "matters", "ai_helped", "how_sure", "background", "could_lead"]);
    expectRow("EXPLAINER_PARTS", EXPLAINER_PARTS, EXPLAINER_PART_INFO);
    const deeper = /; then (.+?) · (.+)$/.exec(specCell("EXPLAINER_PARTS"))!;
    expect(GO_DEEPER_LABEL).toEqual({ en: deeper[1], zh: deeper[2] });
    expect(GO_DEEPER_LABEL).toEqual({ en: "Go deeper", zh: "延伸閱讀" });
    expectTypeOf<ExplainerPart>().toEqualTypeOf<"found" | "matters" | "ai_helped" | "how_sure" | "background" | "could_lead">();
  });

  it("give an item the first four parts: the story shows all six", () => {
    expect([...ITEM_PARTS]).toEqual(EXPLAINER_PARTS.slice(0, 4));
    expect([...ITEM_PARTS]).toEqual(["found", "matters", "ai_helped", "how_sure"]);
  });
});

// ── The finding paths that hold an id ────────────────────────────────────────────────────────────

describe("ID_PATHS and idLabel() (SPEC §4.5, §4.6, §4.10)", () => {
  it("name the finding paths that hold one id of a vocabulary, as §4.6 lists them but for the subfield", () => {
    const listed = /vocabulary its `path` holds \(([^)]+)\)/.exec(flat(specSection("### 4.6 ", "### 4.7 ")))![1]!;
    const paths = [...listed.matchAll(/`([a-z.]+)`/g)].map((m) => m[1]);
    expect(paths).toEqual(["field", "subfield", "kind", "significance", "ai.role", "ai.confidence"]);
    expect(Object.keys(ID_PATHS)).toEqual(paths.filter((p) => p !== "subfield"));
    expect(Object.keys(ID_PATHS)).not.toContain("rung");
    expectTypeOf<IdPath>().toEqualTypeOf<"field" | "kind" | "significance" | "ai.role" | "ai.confidence">();
  });

  it("pair each path with its vocabulary, and a finding's kind is never an idea", () => {
    expect(ID_PATHS.field).toBe(FIELDS);
    expect(ID_PATHS.kind).toBe(FINDING_KINDS);
    expect(ID_PATHS.significance).toBe(SIGNIFICANCE);
    expect(ID_PATHS["ai.role"]).toBe(AI_ROLES);
    expect(ID_PATHS["ai.confidence"]).toBe(AI_CONFIDENCE);
    expect(ID_PATHS.kind as readonly string[]).not.toContain("idea");
  });

  it("give an id's fixed label in both languages: ai_solved reads AI-solved, AI 解出 in Chinese (SPEC §7, site tests)", () => {
    expect(idLabel("ai.role", "ai_solved")).toEqual({ en: "AI-solved", zh: "AI 解出" });
    expect(idLabel("field", "earth")).toEqual({ en: "Earth and climate", zh: "地球與氣候" });
    expect(idLabel("kind", "policy_people")).toEqual({ en: "Policy and people", zh: "政策與人物" });
    expect(idLabel("significance", "major")).toEqual({ en: "Major", zh: "重大" });
    expect(idLabel("ai.confidence", "claimed")).toEqual({ en: "Claimed by the lab", zh: "實驗室自稱" });
  });

  it("label every id of every path with the label its vocabulary's record holds", () => {
    const records: Record<keyof typeof ID_PATHS, Strings> = {
      field: FIELD_INFO, kind: KIND_INFO, significance: SIGNIFICANCE_INFO, "ai.role": AI_ROLE_INFO, "ai.confidence": AI_CONFIDENCE_INFO,
    };
    for (const [path, ids] of Object.entries(ID_PATHS) as [IdPath, readonly string[]][]) {
      for (const id of ids) expect(idLabel(path, id), `${path} ${id}`).toEqual({ en: records[path][id]!.en, zh: records[path][id]!.zh });
    }
  });

  it("give null for an id the path does not take", () => {
    expect(idLabel("kind", "idea")).toBeNull();
    expect(idLabel("field", "math")).toBeNull();
    expect(idLabel("ai.role", "checked")).toBeNull();
    expect(idLabel("ai.confidence", "none")).toBeNull();
    expect(idLabel("significance", "")).toBeNull();
    expect(idLabel("field", "constructor")).toBeNull();
  });

  it("hand out a new object holding the two languages only", () => {
    const label = idLabel("significance", "landmark")!;
    expect(Object.keys(label)).toEqual(["en", "zh"]);
    expect(label).not.toBe(SIGNIFICANCE_INFO.landmark);
    expectTypeOf(idLabel).returns.toEqualTypeOf<Bilingual | null>();
  });
});

// ── Fixed strings ────────────────────────────────────────────────────────────────────────────────

describe("the fixed strings", () => {
  const named: Record<string, Bilingual> = { NONE_FOUND, NO_AI_PART, DISCLOSURE, END_LINE, REMOVED_TEXT, REMOVED_BEFORE };
  const quoted = new Map(
    [...flat(section).matchAll(/`([A-Z_]+)`\*{0,2} \("([^"]+)" · 「([^」]+)」\)/g)].map((m) => [m[1]!, { en: m[2]!, zh: m[3]! }]),
  );

  it("are the spec's, word for word in both languages", () => {
    expect([...quoted.keys()].sort()).toEqual(Object.keys(named).sort());
    for (const [name, text] of Object.entries(named)) expect(text, name).toEqual(quoted.get(name));
  });

  it("say what the spec's examples say", () => {
    expect(NONE_FOUND).toEqual({ en: "None found this week.", zh: "本週沒有發現。" });
    expect(NO_AI_PART).toEqual({ en: "No AI role. It is here because it changes its field.", zh: "無 AI 角色。列入是因為它改變了這個領域。" });
    expect(DISCLOSURE).toEqual({ en: "This tracker is written by Claude, made by Anthropic.", zh: "Unveiling Tracker 由 Anthropic 開發的 Claude 撰寫。" });
    expect(REMOVED_TEXT).toEqual({ en: "This text was removed.", zh: "此處文字已移除。" });
    expect(REMOVED_BEFORE).toEqual({ en: "[removed text]", zh: "〔已移除的文字〕" });
    expect(END_LINE).toEqual({ en: "That's today's brief.", zh: "今天的簡報到此結束。" });
  });

  it("name Claude and Anthropic in both languages, as the spec's sentence does", () => {
    expect(DISCLOSURE.en).toMatch(/\bClaude\b/);
    expect(DISCLOSURE.en).toMatch(/\bAnthropic\b/);
    expect(DISCLOSURE.zh).toMatch(/Anthropic/);
    expect(DISCLOSURE.zh).toMatch(/Claude/);
  });
});

describe("the notices", () => {
  it("say, in both languages, that a data-only edition has no new findings", () => {
    expect(DATA_ONLY_NOTICE).toEqual({
      en: "Data-only edition. It has no new findings today. It shows the Pace and any earlier findings whose rung changed.",
      zh: "僅數據版。今天沒有新的發現，這一版顯示進度，以及層級有變動的先前發現。",
    });
    expect(DATA_ONLY_NOTICE.en.startsWith(`${EDITION_INFO.data_only.en} edition.`)).toBe(true);
    expect(DATA_ONLY_NOTICE.zh.startsWith(`${EDITION_INFO.data_only.zh}。`)).toBe(true);
  });

  it("say, in both languages, that an English-only edition stays in English", () => {
    expect(ENGLISH_ONLY_NOTICE).toEqual({
      en: "English-only edition. The Chinese text was not ready this morning, so this edition stays in English. Its findings will be translated later.",
      zh: "僅英文版。今天早上中文內容尚未完成，因此本期簡報維持英文。其中的發現之後會補上中文。",
    });
    expect(ENGLISH_ONLY_NOTICE.en.startsWith(`${ENGLISH_ONLY_LABEL.en} edition.`)).toBe(true);
    expect(ENGLISH_ONLY_NOTICE.zh.startsWith(`${ENGLISH_ONLY_LABEL.zh}。`)).toBe(true);
  });

  it("name the feeds that failed, in the order given, in a partial edition's notice", () => {
    expect(partialNotice(["Nature", "arXiv"])).toEqual({
      en: "Partial edition. Some feeds could not be read this morning (Nature, arXiv), so findings from them may be missing.",
      zh: "不完整版。今天早上有些資料來源無法讀取（Nature、arXiv），來自這些來源的發現可能有缺漏。",
    });
    expect(partialNotice(["OpenAlex"]).en).toContain("(OpenAlex)");
    expect(partialNotice(["OpenAlex"]).zh).toContain("（OpenAlex）");
    expect(partialNotice(["Nature"]).en.startsWith(`${EDITION_INFO.partial.en} edition.`)).toBe(true);
    expect(partialNotice(["Nature"]).zh.startsWith(`${EDITION_INFO.partial.zh}。`)).toBe(true);
  });

  it("leave the list out of a partial notice when no feed is named", () => {
    expect(partialNotice([])).toEqual({
      en: "Partial edition. Some feeds could not be read this morning, so findings from them may be missing.",
      zh: "不完整版。今天早上有些資料來源無法讀取，來自這些來源的發現可能有缺漏。",
    });
  });

  it("make a brief's status_note from the edition: null for a full edition with its Chinese", () => {
    expect(statusNote({ edition: "full", englishOnly: false, feeds: [] })).toBeNull();
    expect(statusNote({ edition: "full", englishOnly: false, feeds: ["Nature"] })).toBeNull();
  });

  it("make the English-only template for an English-only edition", () => {
    expect(statusNote({ edition: "full", englishOnly: true, feeds: [] })).toEqual(ENGLISH_ONLY_NOTICE);
    expect(statusNote({ edition: "full", englishOnly: true, feeds: ["Nature"] })).toEqual(ENGLISH_ONLY_NOTICE);
  });

  it("make the partial template naming the feeds for a partial edition", () => {
    expect(statusNote({ edition: "partial", englishOnly: false, feeds: ["Nature", "arXiv"] })).toEqual(partialNotice(["Nature", "arXiv"]));
  });

  it("put the English-only template after the partial one when the edition is both (SPEC §4.5)", () => {
    const both = statusNote({ edition: "partial", englishOnly: true, feeds: ["Nature"] })!;
    const partial = partialNotice(["Nature"]);
    expect(both).toEqual({ en: `${partial.en} ${ENGLISH_ONLY_NOTICE.en}`, zh: `${partial.zh}${ENGLISH_ONLY_NOTICE.zh}` });
    expect(both.en.indexOf("Partial edition.")).toBeLessThan(both.en.indexOf("English-only edition."));
    expect(both.zh.indexOf("不完整版。")).toBeLessThan(both.zh.indexOf("僅英文版。"));
  });

  it("make the data-only template for a data-only edition, whatever its languages and feeds", () => {
    for (const englishOnly of [false, true]) {
      for (const feeds of [[], ["Nature"]]) {
        expect(statusNote({ edition: "data_only", englishOnly, feeds })).toEqual(DATA_ONLY_NOTICE);
      }
    }
  });

  it("hand out a copy, so a caller cannot change a fixed string", () => {
    const note = statusNote({ edition: "data_only", englishOnly: false, feeds: [] })!;
    expect(note).not.toBe(DATA_ONLY_NOTICE);
    const asL10n: L10n | null = statusNote({ edition: "partial", englishOnly: false, feeds: [] });
    expect(asL10n?.zh).not.toBeNull();
    expectTypeOf(statusNote).returns.toEqualTypeOf<Bilingual | null>();
    expectTypeOf(partialNotice).returns.toEqualTypeOf<Bilingual>();
  });
});

// ── The lists the rules read ─────────────────────────────────────────────────────────────────────

describe("ABBREVIATIONS, CLAUDE_PEOPLE and ANTHROPIC_PHRASES", () => {
  const unwrapped = flat(spec);

  it("hold the abbreviations splitSentences() skips, as SPEC §4.1 lists them", () => {
    const listed = /`ABBREVIATIONS` in `lib\/vocab\.ts`: ([^)]+)\)/.exec(unwrapped)![1]!;
    expect([...ABBREVIATIONS]).toEqual([...listed.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    expect([...ABBREVIATIONS]).toEqual(["e.g.", "i.e.", "et al.", "Dr.", "St.", "No.", "vs.", "U.S.", "U.K.", "Prof.", "Fig.", "Eq.", "cf.", "approx.", "Jr."]);
    for (const a of ABBREVIATIONS) expect(a.endsWith("."), a).toBe(true);
    expect(new Set(ABBREVIATIONS).size).toBe(ABBREVIATIONS.length);
  });

  it("hold the people named Claude, as SPEC §4.4 lists them", () => {
    const listed = /`CLAUDE_PEOPLE` \(([^)]+)\)/.exec(unwrapped)![1]!;
    expect([...CLAUDE_PEOPLE]).toEqual(listed.split(", "));
    expect([...CLAUDE_PEOPLE]).toEqual(["Claude Shannon", "Claude Lévi-Strauss", "Claude Monet", "Claude Debussy", "Claude Bernard"]);
    for (const p of CLAUDE_PEOPLE) {
      expect(p.startsWith("Claude "), p).toBe(true);
      expect(p, p).toBe(p.normalize("NFC"));
    }
  });

  it("hold the phrases of cosmology and philosophy that say anthropic, as SPEC §4.4 lists them", () => {
    const listed = /`ANTHROPIC_PHRASES` \(([^:)]+):/.exec(unwrapped)![1]!;
    expect([...ANTHROPIC_PHRASES]).toEqual(listed.split(", "));
    expect([...ANTHROPIC_PHRASES]).toEqual(["anthropic principle", "anthropic reasoning", "anthropic bias", "anthropic selection"]);
    for (const p of ANTHROPIC_PHRASES) expect(p, p).toBe(p.toLowerCase());
  });
});

// ── The blocked list ─────────────────────────────────────────────────────────────────────────────

describe("BLOCK_REASONS", () => {
  it("are Cyber's without the exploit code reason, and with the shadow libraries (SPEC §4.2)", () => {
    expect([...BLOCK_REASONS]).toEqual(["paste", "messaging", "shortener", "redirect", "archive", "leak_site", "scan_query", "shadow_library"]);
    expect(BLOCK_REASONS as readonly string[]).not.toContain("exploit_code");
    expect(flat(section)).toContain("`BLOCK_REASONS` drops `exploit_code` and its entries, and adds `shadow_library`");
    expectTypeOf<BlockReason>().toEqualTypeOf<"paste" | "messaging" | "shortener" | "redirect" | "archive" | "leak_site" | "scan_query" | "shadow_library">();
  });
});

describe("blockedForm()", () => {
  it("tells a host from a host/path, a suffix and a label", () => {
    expect(blockedForm("pastebin.com")).toBe("host");
    expect(blockedForm("search.censys.io")).toBe("host");
    expect(blockedForm("google.com/url")).toBe("path");
    expect(blockedForm("shodan.io/search")).toBe("path");
    expect(blockedForm(".onion")).toBe("suffix");
    expect(blockedForm(".i2p")).toBe("suffix");
    expect(blockedForm("sci-hub")).toBe("label");
    expect(blockedForm("annas-archive")).toBe("label");
    expectTypeOf(blockedForm).returns.toEqualTypeOf<BlockedForm>();
  });

  it("reads a suffix before a path, and a path before a label", () => {
    expect(blockedForm(".onion/x")).toBe("suffix");
    expect(blockedForm("sci-hub/x")).toBe("path");
  });
});

describe("BLOCKED_HOSTS", () => {
  const byReason = (reason: BlockReason) => BLOCKED_HOSTS.filter((b) => b.reason === reason).map((b) => b.pattern);

  it("keeps every entry well formed, lower case and unique", () => {
    const patterns = BLOCKED_HOSTS.map((b) => b.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const b of BLOCKED_HOSTS) {
      expect(BLOCK_REASONS, b.pattern).toContain(b.reason);
      expect(b.pattern, b.pattern).toBe(b.pattern.toLowerCase());
      expect(b.pattern, b.pattern).toMatch(/^[a-z0-9./-]+$/);
      expect(b.pattern, b.pattern).not.toMatch(/\.\.|\/\/|^\/|\.$|-$/);
    }
    expectTypeOf(BLOCKED_HOSTS).toEqualTypeOf<readonly BlockedHost[]>();
  });

  it("has entries for every reason", () => {
    for (const reason of BLOCK_REASONS) expect(byReason(reason).length, reason).toBeGreaterThan(0);
  });

  it("is Cyber's list without its exploit archives and code hosts, group by group and in order", () => {
    expect(BLOCKED_HOSTS.map((b) => b.reason)).toEqual(BLOCKED_HOSTS.map((b) => b.reason).sort((a, b) => BLOCK_REASONS.indexOf(a) - BLOCK_REASONS.indexOf(b)));
    expect(byReason("paste")).toEqual([
      "pastebin.com", "paste.ee", "pastes.io", "hastebin.com", "justpaste.it", "privatebin.net", "controlc.com", "rentry.co",
      "gist.github.com", "gist.githubusercontent.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "codeload.github.com", "api.github.com",
    ]);
    expect(byReason("messaging")).toEqual(["t.me", "telegram.me", "telegram.org", "discord.gg"]);
    expect(byReason("shortener")).toEqual([
      "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "tiny.cc", "s.id", "lnkd.in",
    ]);
    expect(byReason("redirect")).toEqual(["news.google.com", "google.com/url", "l.facebook.com", "out.reddit.com", "href.li"]);
    expect(byReason("archive")).toEqual([
      "archive.org", "archive.ph", "archive.today", "archive.is", "archive.li", "archive.md", "archive.vn", "archive.fo", "ghostarchive.org",
    ]);
    expect(byReason("leak_site")).toEqual(["ransomware.live", "ransomlook.io", ".onion", ".i2p"]);
    expect(byReason("scan_query")).toEqual(["shodan.io/search", "search.censys.io", "fofa.info", "zoomeye.org"]);
  });

  it("does not block a code host or a preprint server, where a finding's own record may be (SPEC §4.3 artefacts)", () => {
    const hosts = BLOCKED_HOSTS.map((b) => b.pattern);
    for (const open of ["github.com", "gitlab.com", "arxiv.org", "doi.org", "zenodo.org", "openalex.org", "pubmed.ncbi.nlm.nih.gov"]) {
      expect(hosts, open).not.toContain(open);
    }
  });

  it("lists each shadow library's hosts exactly, then its labels, as SPEC §4.2 gives them", () => {
    const unwrapped = flat(section);
    const hosts = [...(/at writing (.+?) \(\*\*Verify in P3/.exec(unwrapped)![1]!).matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    const labels = [...(/a pattern with no dot \((.+?)\) that/.exec(unwrapped)![1]!).matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    expect(hosts).toHaveLength(11);
    expect(labels).toHaveLength(5);
    expect(byReason("shadow_library")).toEqual([...hosts, ...labels]);
    expect(byReason("shadow_library").filter((p) => blockedForm(p) === "host")).toEqual([
      "sci-hub.se", "sci-hub.st", "sci-hub.ru", "libgen.is", "libgen.rs", "libgen.li", "z-lib.org", "z-library.sk", "annas-archive.org", "annas-archive.se",
      "annas-archive.li",
    ]);
    expect(byReason("shadow_library").filter((p) => blockedForm(p) === "label")).toEqual(["sci-hub", "libgen", "z-lib", "z-library", "annas-archive"]);
  });

  it("has a label entry only for a library whose hosts it also lists, as that host's first label", () => {
    const hosts = BLOCKED_HOSTS.filter((b) => b.reason === "shadow_library" && blockedForm(b.pattern) === "host").map((b) => b.pattern);
    const labels = BLOCKED_HOSTS.filter((b) => blockedForm(b.pattern) === "label").map((b) => b.pattern);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(hosts.some((h) => h.split(".")[0] === label), label).toBe(true);
    for (const h of hosts) expect(labels, h).toContain(h.split(".")[0]);
  });

  it("gives its path, suffix and label entries only the reasons that use them", () => {
    const forms = (form: BlockedForm) => BLOCKED_HOSTS.filter((b) => blockedForm(b.pattern) === form).map((b) => [b.pattern, b.reason]);
    expect(forms("path")).toEqual([["google.com/url", "redirect"], ["shodan.io/search", "scan_query"]]);
    expect(forms("suffix")).toEqual([[".onion", "leak_site"], [".i2p", "leak_site"]]);
    expect(forms("label").map(([, reason]) => reason)).toEqual(Array(5).fill("shadow_library"));
  });
});

describe("blockedHostEntries()", () => {
  it("holds the plain hosts only, in list order: the entries that get a WebFetch deny rule (SPEC §9.5)", () => {
    const hosts = blockedHostEntries();
    expect(hosts).toEqual(BLOCKED_HOSTS.map((b) => b.pattern).filter((p) => blockedForm(p) === "host"));
    expect(hosts[0]).toBe("pastebin.com");
    for (const h of hosts) expect(h).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
  });

  it("skips the path entries, the suffix entries and the labels", () => {
    const hosts = blockedHostEntries();
    for (const skipped of ["google.com/url", "shodan.io/search", ".onion", ".i2p", "sci-hub", "libgen", "z-lib", "z-library", "annas-archive"]) {
      expect(hosts, skipped).not.toContain(skipped);
    }
  });

  it("holds each shadow library's exact hosts", () => {
    const hosts = blockedHostEntries();
    for (const h of ["sci-hub.se", "sci-hub.st", "sci-hub.ru", "libgen.is", "libgen.rs", "libgen.li", "z-lib.org", "z-library.sk", "annas-archive.org",
      "annas-archive.se", "annas-archive.li"]) {
      expect(hosts, h).toContain(h);
    }
  });

  it("hands out a new array each time", () => {
    const first = blockedHostEntries();
    first.length = 0;
    expect(blockedHostEntries().length).toBeGreaterThan(0);
    expect(blockedHostEntries()).not.toBe(blockedHostEntries());
  });
});

// ── The canary ───────────────────────────────────────────────────────────────────────────────────

describe("the canary", () => {
  it("is harmless and recognisable, and this project's own", () => {
    expect(CANARY_TOKEN).toMatch(/^UT-CANARY-[0-9A-F]{8}-[A-Z]+-[A-Z]+$/);
    expect(CANARY_URL_PREFIX.startsWith("https://example.org/")).toBe(true);
    expect(CANARY_URL_PREFIX.endsWith(CANARY_URL_MARK)).toBe(true);
    expect(CANARY_URL_PREFIX).toBe(`https://${CANARY_URL_MARK}`);
    expect(CANARY_URL_MARK).toBe(CANARY_URL_MARK.toLowerCase());
    expect(CANARY_URL_MARK).toBe("example.org/ut-canary/");
  });

  it("plants an https URL on a domain reserved for examples, and the token is in no label", () => {
    expect(new URL(CANARY_URL_PREFIX).protocol).toBe("https:");
    expect(new URL(CANARY_URL_PREFIX).hostname).toBe("example.org");
    for (const { name, text } of ALL) {
      expect(text.en, name).not.toContain(CANARY_TOKEN);
      expect(text.zh, name).not.toContain(CANARY_TOKEN);
    }
  });
});

// ── The schemas' use of the tuples ───────────────────────────────────────────────────────────────

describe("the tuples as z.enum sources (SPEC §4.1: Zod is the single source of truth)", () => {
  const enums = {
    fields: z.enum(FIELDS), fieldCodes: z.enum(FIELD_CODES), kinds: z.enum(KINDS), findingKinds: z.enum(FINDING_KINDS),
    rungs: z.enum(ALL_RUNGS), ladder: z.enum(RUNGS), fell: z.enum(FELL_RUNGS), counted: z.enum(COUNTED_RUNGS), roles: z.enum(AI_ROLES),
    confidence: z.enum(AI_CONFIDENCE), significance: z.enum(SIGNIFICANCE), sourceKinds: z.enum(SOURCE_KINDS), editions: z.enum(EDITIONS),
    formats: z.enum(FORMATS), reportKinds: z.enum(REPORT_KINDS), parts: z.enum(EXPLAINER_PARTS), reasons: z.enum(BLOCK_REASONS),
  };
  const tuples: Record<keyof typeof enums, readonly string[]> = {
    fields: FIELDS, fieldCodes: FIELD_CODES, kinds: KINDS, findingKinds: FINDING_KINDS, rungs: ALL_RUNGS, ladder: RUNGS, fell: FELL_RUNGS,
    counted: COUNTED_RUNGS, roles: AI_ROLES, confidence: AI_CONFIDENCE, significance: SIGNIFICANCE, sourceKinds: SOURCE_KINDS,
    editions: EDITIONS, formats: FORMATS, reportKinds: REPORT_KINDS, parts: EXPLAINER_PARTS, reasons: BLOCK_REASONS,
  };

  it("accept exactly their values, in order", () => {
    for (const [name, schema] of Object.entries(enums)) {
      const values = tuples[name as keyof typeof enums];
      expect(schema.options, name).toEqual([...values]);
      for (const v of values) expect(schema.safeParse(v).success, `${name} ${v}`).toBe(true);
      for (const bad of ["", "nonsense", values[0]!.toUpperCase(), ` ${values[0]}`]) expect(schema.safeParse(bad).success, `${name} ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("infer the types the module exports", () => {
    expectTypeOf<z.infer<typeof enums.fields>>().toEqualTypeOf<FieldId>();
    expectTypeOf<z.infer<typeof enums.fieldCodes>>().toEqualTypeOf<FieldCode>();
    expectTypeOf<z.infer<typeof enums.kinds>>().toEqualTypeOf<Kind>();
    expectTypeOf<z.infer<typeof enums.findingKinds>>().toEqualTypeOf<FindingKind>();
    expectTypeOf<z.infer<typeof enums.rungs>>().toEqualTypeOf<Rung>();
    expectTypeOf<z.infer<typeof enums.ladder>>().toEqualTypeOf<LadderRung>();
    expectTypeOf<z.infer<typeof enums.fell>>().toEqualTypeOf<FellRung>();
    expectTypeOf<z.infer<typeof enums.counted>>().toEqualTypeOf<CountedRung>();
    expectTypeOf<z.infer<typeof enums.roles>>().toEqualTypeOf<AiRole>();
    expectTypeOf<z.infer<typeof enums.confidence>>().toEqualTypeOf<AiConfidence>();
    expectTypeOf<z.infer<typeof enums.significance>>().toEqualTypeOf<Significance>();
    expectTypeOf<z.infer<typeof enums.sourceKinds>>().toEqualTypeOf<SourceKind>();
    expectTypeOf<z.infer<typeof enums.editions>>().toEqualTypeOf<Edition>();
    expectTypeOf<z.infer<typeof enums.formats>>().toEqualTypeOf<Format>();
    expectTypeOf<z.infer<typeof enums.reportKinds>>().toEqualTypeOf<ReportKind>();
    expectTypeOf<z.infer<typeof enums.parts>>().toEqualTypeOf<ExplainerPart>();
    expectTypeOf<z.infer<typeof enums.reasons>>().toEqualTypeOf<BlockReason>();
  });

  it("build a finding id pattern from the field codes, as §4.3 writes it", () => {
    const id = new RegExp(`^(${FIELD_CODES.join("|")})-\\d{4}-\\d{4}$`);
    expect(id.test("math-2026-0142")).toBe(true);
    expect(id.test("hum-2015-0001")).toBe(true);
    expect(id.test("physics-2026-0142")).toBe(false);
    expect(id.test("math-26-0142")).toBe(false);
  });
});

// ── The file itself ──────────────────────────────────────────────────────────────────────────────

describe("the module itself", () => {
  const source = read("lib/vocab.ts");

  it("imports only types, so it loads in a browser and in a script alike", () => {
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type\b/);
  });

  it("holds no em-dash and no en dash outside a digit range, in the code or in these tests", () => {
    const digitRange = new RegExp(`(?<=\\d)${EN_DASH}(?=\\d)`, "g");
    for (const file of ["lib/vocab.ts", "tests/vocab.test.ts", "lib/i18n.ts", "tests/i18n.test.ts"]) {
      const text = file === "lib/vocab.ts" ? source : read(file);
      expect(text, file).not.toContain(EM_DASH);
      expect(text.replace(digitRange, ""), file).not.toContain(EN_DASH);
    }
  });
});
