// The Chinese side of the fixtures (SPEC §4.6 "DraftZh and the Chinese edition", §4.12 "Fixtures and tests"; fixtures/src/world-zh.ts,
// zh-inputs.ts and zh-drafts.ts write fixtures/drafts-zh/). It checks that the thirteen files are the ones the generator writes, byte for
// byte, registered in the builder and valid for their schemas; that each edition's context holds exactly the keys, kinds, caps, groups,
// backlog, terms and fixed translations that §4.6 names, derived here from the English draft and the stored findings alone (the reference
// `zhContextOf()` is checked against that second implementation, and against changed inputs: a translated finding, a vocabulary id,
// NONE_FOUND, a smaller backlog, a short week); that each valid Chinese draft holds exactly the context's keys and terms and passes the
// text checks of lib/zh.ts on every string (numbers, URLs, Latin words, Taiwan usage, dashes, hype, fixed terms, the rung label, the
// English term once, caps, groups and the page total, and a term's name and definition judged together); that the 樂詞網 evidence backs
// each `official`; and that the translation table is one table (no English string translated twice, every sample string covered, none
// left over, the same sentence the same Chinese everywhere, each claim at its strength as STYLE-ZH §12 asks, and one Chinese wording for
// each phrase the world repeats). The checks of lib/zh.ts above need no rule engine; the last group runs each
// valid draft through `validateZh()` (lib/validate-zh.ts), which must give no error and no warning, and fails a draft that breaks one
// thing with that thing's code alone. tests/rules-zh.test.ts is where each code's own cases are judged.
// New for this project; Cyber has no Chinese pass.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { byCodeUnit, compareFindingIds } from "@/lib/ids";
import { jsonText } from "@/lib/json";
import type { L10n } from "@/lib/schema/common";
import type { DraftBrief } from "@/lib/schema/draft";
import { DraftZh, ZhContext, type ZhStringKind } from "@/lib/schema/draft-zh";
import { Finding } from "@/lib/schema/finding";
import { GlossaryFile } from "@/lib/schema/glossary";
import { Evidence } from "@/lib/schema/misc";
import { hostOf, normalizeUrl } from "@/lib/urls";
import { validateZh } from "@/lib/validate-zh";
import { AI_ROLES, ALL_RUNGS, EXPLAINER_PARTS, NONE_FOUND, REMOVED_TEXT, RUNG_INFO, type ExplainerPart, type FieldId } from "@/lib/vocab";
import {
  avoidHits, countZhChars, dashHits, englishOnceProblems, fixedApplies, fixedMissing, hypeHits, parityProblems, traditionalHits,
} from "@/lib/zh";
import { GENERATORS, allOutputs } from "../fixtures/src/build";
import { editionDraft } from "../fixtures/src/drafts";
import { editionContext, fixtureConfig } from "../fixtures/src/inputs";
import { EDITIONS, EDITION_NAMES, FINDING_KEYS, REPO_ROOT, storedFinding, storedFindingsBefore, storedGlossary, termId, type EditionName } from "../fixtures/src/world";
import {
  ZH_ENGLISH, ZH_TERM_TABLE, findingWithZh, glossaryWithZh, hasZhText, termWithZh, zhL10n, zhText,
} from "../fixtures/src/world-zh";
import {
  ZH_CLOCK, officialPageText, zhContext, zhContextInput, zhContextOf, zhEvidence, zhInputs,
} from "../fixtures/src/zh-inputs";
import {
  ZH_DIR, ZH_FLAGS_LINE, ZH_FLAGS_PATH, zhContextPath, zhDraft, zhDraftOf, zhDraftPath, zhEvidencePath, zhOutputs, zhStringOf,
} from "../fixtures/src/zh-drafts";

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
/** An en dash with no digit before it or none after it. */
const LONELY_EN_DASH = new RegExp(`(?<!\\d)${EN_DASH}|${EN_DASH}(?!\\d)`, "u");
/** A straight double quote or a curly one, either side. */
const QUOTE_MARKS = new RegExp(`["${String.fromCharCode(0x201c)}${String.fromCharCode(0x201d)}]`, "u");

const config = fixtureConfig();
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const fixedTerms = config.termsZh.fixed;
const avoidTerms = config.termsZh.avoid;
const MINUTE = 60_000;

// ── Taiwan usage and house style, as the text checks of lib/zh.ts and STYLE-ZH.md read a string ───

/** What lib/zh.ts finds in a Chinese text alone: characters Taiwan does not write, avoided terms, dashes and hype words. */
function usageProblems(zh: string): string[] {
  return [
    ...traditionalHits(zh, config.index).map((h) => `${h.list} character ${h.char}`),
    ...avoidHits(zh, { avoid: avoidTerms, fixed: fixedTerms }).map((h) => `avoided term ${h.term} (write ${h.taiwan})`),
    ...dashHits(zh).map((h) => `dash ${h.codePoint}`),
    ...hypeHits(zh, config.hypeWords, { landmark: false }).map((h) => `hype word ${h.word}`),
  ];
}

/**
 * The house style the table's header names: full-width punctuation, a space between Latin letters or digits and Han characters, no quote
 * marks, and the plain words of STYLE-ZH §10 (這個 for 該, 它的 for 其, 的 for 之, 是 for 乃, and the verb itself for 對X進行Y, 加以 and 予以).
 */
function styleProblems(zh: string): string[] {
  const out: string[] = [];
  const hit = (re: RegExp, what: string, text = zh): void => {
    const found = re.exec(text);
    if (found !== null) out.push(`${what}: ${found[0]}`);
  };
  hit(/[\p{Script=Han}][A-Za-z0-9]/u, "no space between a Han character and a Latin letter or digit");
  hit(/[A-Za-z0-9%][\p{Script=Han}]/u, "no space between a Latin letter, digit or % and a Han character");
  hit(/ [，。：；？！、）（「」]|[，。：；？！、）（「」] /u, "a space beside a full-width mark");
  hit(/[,;?!]/, "an ASCII mark that should be full-width", zh.replace(/\d,\d/g, ""));
  hit(/[.:]/, "an ASCII period or colon", zh.replace(/\d[.,]\d/g, ""));
  hit(QUOTE_MARKS, "a double quote mark");
  hit(/(?<!應)該/u, "該 where 這個 is plain");
  hit(/其(?![他中次實餘後間])/u, "其 where 它的 is plain");
  hit(/之(?![前後外間中上下一內])/u, "之 where 的 is plain");
  hit(/乃|加以|予以/u, "a formal word where a plain verb will do");
  hit(/對[^，。]{1,12}進行/u, "對X進行Y where the verb itself will do");
  return out;
}

const englishSentences = (text: string): string[] => text.split(/(?<=[.?!])\s+/).filter((s) => s.trim() !== "");
const chineseSentences = (text: string): string[] => text.split(/(?<=[。？！])/u).filter((s) => s.trim() !== "");

// ── The sample world, read here without the generators ───────────────────────────────────────────

/** Every `L10n` of a finding: the title, the explainer parts, the rung notes, the `since_then` texts and the figure's alt text. */
function l10nOf(f: Finding): L10n[] {
  const parts = EXPLAINER_PARTS.flatMap((p) => {
    const part = f.explainer[p];
    return part === null ? [] : [part];
  });
  const notes = f.rung_history.flatMap((r) => (r.note === null ? [] : [r.note]));
  const alt = f.figure === null ? [] : [f.figure.alt];
  return [f.title, ...parts, ...notes, ...f.since_then.map((s) => s.text), ...alt];
}

// ── §4.6, derived again from the English draft and the stored findings ───────────────────────────

/** Each cap is ceil(the English word cap x zh_factor 1.8) of SPEC §4.12, written out: a story's part, a group, a line, a text. */
const STORY_PART_CAP: Readonly<Record<ExplainerPart, number>> = { found: 99, matters: 90, ai_helped: 108, how_sure: 108, background: 63, could_lead: 63 };
const CAP = {
  title: 22, lead: 108, storyGroup: 504, itemGroup: 180, itemTail: 72, alt: 72, note: 45, update: 108, since: 108, idea: 72, also: 36,
  deepDive: 990, bigPicture: 594, bigPictureShort: 216, remarkable: 54, against: 90, after: 300, reason: 72, definition: 72,
} as const;
/** The page total of ZH_CHARS: 1,300 English words x 1.8. */
const PAGE_CAP = 2340;

interface Shape {
  key: string;
  en: string;
  kind: ZhStringKind;
  cap_chars: number;
  group: { id: string; cap_chars: number } | null;
}

interface Oracle {
  /** The strings of the context, in the order of §4.6's key grammar. */
  strings: Shape[];
  /** The stored findings the edition names, in the order of its parts. */
  named: string[];
  /** The backlog: the named findings, then the oldest others. */
  backlog: Finding[];
  /** The terms of the new findings and the backlog, sorted by id. */
  terms: { id: string; en: string; definition: string }[];
  /** The field a `fixed` entry is read against for a key; null when the key belongs to no finding. */
  fieldOf: (key: string) => FieldId | null;
}

const ORACLES = new Map<EditionName, Oracle>();

function oracleOf(name: EditionName): Oracle {
  const cached = ORACLES.get(name);
  if (cached !== undefined) return cached;
  const d = editionDraft(name);
  const english = editionContext(name);
  const date = EDITIONS[name].date;
  const stored = storedFindingsBefore(date);
  const storedBy = new Map(stored.map((f) => [f.id, f]));
  const glossary = new Map(storedGlossary(date).terms.map((t) => [t.id, t]));
  const fresh = new Set(d.new_findings.map((f) => f.ref));
  const storedField = (id: string): FieldId => storedBy.get(id)!.field;
  const shortWeek = english.week !== null && english.week.findings.length < 3;

  const strings: Shape[] = [];
  const add = (key: string, en: string, kind: ZhStringKind, cap: number, group: Shape["group"] = null): void => {
    // A string that is exactly NONE_FOUND or REMOVED_TEXT has its Chinese fixed (§4.6): the pass does not translate it.
    if (en === NONE_FOUND.en || en === REMOVED_TEXT.en) return;
    strings.push({ key, en, kind, cap_chars: cap, group });
  };
  const addParts = (prefix: string, parts: Readonly<Record<ExplainerPart, string | null>>, story: boolean): void => {
    for (const part of EXPLAINER_PARTS) {
      const en = parts[part];
      if (en === null) continue;
      const key = `${prefix}.explainer.${part}`;
      if (story) add(key, en, "part", STORY_PART_CAP[part], { id: `${prefix}.explainer`, cap_chars: CAP.storyGroup });
      else if (part === "background" || part === "could_lead") add(key, en, "part", CAP.itemTail);
      else add(key, en, "part", CAP.itemGroup, { id: `${prefix}.explainer`, cap_chars: CAP.itemGroup });
    }
  };

  d.lead.forEach((l, i) => add(`lead.${i}`, l.text, "lead", CAP.lead, { id: "lead", cap_chars: CAP.lead }));
  for (const f of d.new_findings) {
    const p = `new.${f.ref}`;
    add(`${p}.title`, f.title, "title", CAP.title);
    addParts(p, f.explainer, d.story === f.ref);
    if (f.figure !== null) add(`${p}.figure.alt`, f.figure.alt, "alt", CAP.alt);
    f.rung_history.forEach((r, i) => {
      if (r.note !== null) add(`${p}.rung.${i}`, r.note, "note", CAP.note);
    });
  }
  for (const r of d.returning) {
    add(`returning.${r.finding_id}.update`, r.update, "line", CAP.update);
    if (r.rung !== null && r.rung.note !== null) add(`returning.${r.finding_id}.rung`, r.rung.note, "note", CAP.note);
  }
  for (const c of d.rung_changes) {
    if (c.rung.note !== null) add(`rung.${c.finding_id}`, c.rung.note, "note", CAP.note);
  }
  d.ideas.forEach((idea, i) => add(`ideas.${i}`, idea.text, "line", CAP.idea));
  d.also.forEach((a, i) => add(`also.${i}`, a.title, "line", CAP.also));
  if (d.deep_dive !== null) add("deep_dive", d.deep_dive.text, "long", CAP.deepDive);
  if (d.review !== null) {
    add("review.big_picture", d.review.big_picture, "long", shortWeek ? CAP.bigPictureShort : CAP.bigPicture);
    if (d.review.remarkable !== null) add("review.remarkable", d.review.remarkable.note, "line", CAP.remarkable);
    add("review.strongest_against", d.review.strongest_against.text, "line", CAP.against);
  }
  d.corrections.forEach((c, i) => {
    add(`corrections.${i}.after`, c.after, "long", CAP.after);
    add(`corrections.${i}.reason`, c.reason, "line", CAP.reason);
  });
  for (const r of d.report_decisions) add(`reports.${r.report_id}.reason`, r.reason, "line", CAP.reason);

  // The stored findings the edition names, in the order of its parts (a new-N ref names a finding of the draft, not a stored one).
  const named: string[] = [];
  const name1 = (id: string): void => {
    if (!fresh.has(id) && !named.includes(id)) named.push(id);
  };
  d.lead.forEach((l) => l.refs.forEach(name1));
  if (d.story !== null) name1(d.story);
  d.items.forEach(name1);
  d.rung_changes.forEach((r) => name1(r.finding_id));
  if (d.deep_dive !== null) name1(d.deep_dive.finding_id);
  if (d.review !== null) {
    if (d.review.remarkable !== null) name1(d.review.remarkable.finding_id);
    d.review.strongest_against.finding_ids.forEach(name1);
  }
  d.corrections.forEach((c) => {
    if (c.finding_id !== null) name1(c.finding_id);
  });
  d.report_decisions.forEach((r) => name1(english.reports.find((x) => x.id === r.report_id)!.finding_id));
  const others = stored
    .filter((f) => !named.includes(f.id))
    .sort((a, b) => byCodeUnit(a.updated, b.updated) || compareFindingIds(a.id, b.id))
    .slice(0, config.run.budgets.zh_backlog_max);
  const backlog = [...named.map((id) => storedBy.get(id)!), ...others];

  // Each backlog finding writes only the strings whose Chinese is null.
  for (const f of backlog) {
    const p = `backlog.${f.id}`;
    if (f.title.zh === null) add(`${p}.title`, f.title.en, "title", CAP.title);
    addParts(p, {
      found: f.explainer.found.zh === null ? f.explainer.found.en : null,
      matters: f.explainer.matters.zh === null ? f.explainer.matters.en : null,
      ai_helped: f.explainer.ai_helped === null || f.explainer.ai_helped.zh !== null ? null : f.explainer.ai_helped.en,
      how_sure: f.explainer.how_sure.zh === null ? f.explainer.how_sure.en : null,
      background: f.explainer.background.zh === null ? f.explainer.background.en : null,
      could_lead: f.explainer.could_lead.zh === null ? f.explainer.could_lead.en : null,
    }, f.depth === "story");
    f.since_then.forEach((s, i) => {
      if (s.text.zh === null) add(`${p}.since.${i}`, s.text.en, "line", CAP.since);
    });
    if (f.figure !== null && f.figure.alt.zh === null) add(`${p}.figure.alt`, f.figure.alt.en, "alt", CAP.alt);
    f.rung_history.forEach((r, i) => {
      if (r.note !== null && r.note.zh === null) add(`${p}.rung.${i}`, r.note.en, "note", CAP.note);
    });
  }

  // The terms of the new findings and of the backlog, each once.
  const found = new Map<string, { id: string; en: string; definition: string }>();
  for (const f of d.new_findings) {
    for (const t of f.terms) {
      const id = t.new ? termId(t.term) : t.id;
      const known = glossary.get(id);
      if (!found.has(id)) {
        found.set(id, t.new ? { id, en: t.term, definition: t.definition } : { id, en: known!.en.term, definition: known!.en.definition });
      }
    }
  }
  for (const f of backlog) {
    for (const id of f.terms) {
      if (!found.has(id)) found.set(id, { id, en: glossary.get(id)!.en.term, definition: glossary.get(id)!.en.definition });
    }
  }
  const terms = [...found.values()].sort((a, b) => byCodeUnit(a.id, b.id));

  const fieldOf = (key: string): FieldId | null => {
    const part = key.split(".");
    const [a, b] = part;
    if (a === "new") return d.new_findings.find((f) => f.ref === b)!.field;
    if (a === "returning" || a === "rung" || a === "backlog") return storedField(b!);
    if (a === "reports") return storedField(english.reports.find((r) => r.id === b)!.finding_id);
    if (a === "also") return d.also[Number(b)]!.field;
    if (key === "deep_dive") return storedField(d.deep_dive!.finding_id);
    if (key === "review.remarkable") return storedField(d.review!.remarkable!.finding_id);
    if (a === "corrections") {
      const id = d.corrections[Number(b)]!.finding_id;
      return id === null ? null : storedField(id);
    }
    return null;
  };

  const oracle: Oracle = { strings, named, backlog, terms, fieldOf };
  ORACLES.set(name, oracle);
  return oracle;
}

/** The keys that count in the page total of ZH_CHARS: the strings WORDS counts for the page, never a backlog key, an item's tail, a note, a correction or a report. */
function countsForPage(key: string, story: string | null): boolean {
  if (/^(lead|ideas|also)\.\d+$/.test(key) || key === "deep_dive" || /^review\.(big_picture|remarkable|strongest_against)$/.test(key)) return true;
  if (/^returning\.[^.]+\.update$/.test(key)) return true;
  if (/^new\.new-\d+\.(title|explainer\.(found|matters|ai_helped|how_sure))$/.test(key)) return true;
  return story !== null && (key === `new.${story}.explainer.background` || key === `new.${story}.explainer.could_lead`);
}

/** How many stored findings each edition names, and how many others the backlog adds (SPEC §4.6: named, then up to `zh_backlog_max` more). */
const BACKLOG: Readonly<Record<EditionName, { named: number; others: number }>> = {
  weekday: { named: 4, others: 5 },
  sunday: { named: 1, others: 5 },
  monday: { named: 3, others: 5 },
  "monday-short": { named: 0, others: 5 },
};
/** How many glossary terms each edition's context lists: the new findings' and the backlog's. */
const TERM_COUNT: Readonly<Record<EditionName, number>> = { weekday: 6, sunday: 2, monday: 3, "monday-short": 1 };

// ── The files ────────────────────────────────────────────────────────────────────────────────────

describe("the files", () => {
  const PATHS = [
    ...EDITION_NAMES.flatMap((n) => [`fixtures/drafts-zh/valid-${n}.zh.json`, `fixtures/drafts-zh/${n}.zh-context.json`, `fixtures/drafts-zh/${n}.zh-evidence.json`]),
    "fixtures/drafts-zh/flags.txt",
  ];

  it("lists the thirteen files, each once, in the folder the builder owns", () => {
    expect(ZH_DIR).toBe("fixtures/drafts-zh");
    expect(zhOutputs().map((o) => o.path)).toEqual(PATHS);
    expect(new Set(PATHS).size).toBe(13);
    expect(EDITION_NAMES.map((n) => [zhDraftPath(n), zhContextPath(n), zhEvidencePath(n)])).toEqual(
      EDITION_NAMES.map((n) => [`fixtures/drafts-zh/valid-${n}.zh.json`, `fixtures/drafts-zh/${n}.zh-context.json`, `fixtures/drafts-zh/${n}.zh-evidence.json`]),
    );
  });

  it("is the same on every call and registered with the builder", () => {
    expect(zhOutputs()).toEqual(zhOutputs());
    expect(GENERATORS).toContain(zhOutputs);
    const all = allOutputs();
    for (const o of zhOutputs()) expect(all).toContainEqual(o);
  });

  it("is on disk, byte for byte what the generator writes", () => {
    for (const o of zhOutputs()) expect(read(o.path), o.path).toBe(o.text);
  });

  it("holds JSON that each parses with its schema and is exactly that schema's text of it", () => {
    for (const n of EDITION_NAMES) {
      const draft = read(zhDraftPath(n));
      expect(jsonText(DraftZh.parse(JSON.parse(draft)), DraftZh), `${n} draft`).toBe(draft);
      const context = read(zhContextPath(n));
      expect(jsonText(ZhContext.parse(JSON.parse(context)), ZhContext), `${n} context`).toBe(context);
      const evidence = read(zhEvidencePath(n));
      expect(jsonText(Evidence.parse(JSON.parse(evidence)), Evidence), `${n} evidence`).toBe(evidence);
    }
  });

  it("writes the weekday's flags on one line, naming its context and its evidence, both on disk", () => {
    expect(ZH_FLAGS_PATH).toBe("fixtures/drafts-zh/flags.txt");
    const text = read(ZH_FLAGS_PATH);
    expect(text).toBe("--zh-context fixtures/drafts-zh/weekday.zh-context.json --zh-evidence fixtures/drafts-zh/weekday.zh-evidence.json\n");
    expect(ZH_FLAGS_LINE).toBe(text.trimEnd());
    expect(text.trimEnd()).not.toContain("\n");
    for (const file of text.trim().split(" ").filter((w) => w.startsWith("fixtures/"))) expect(fs.existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
  });

  it("holds no em dash, and an en dash only between digits, in the sources, the test and the generated files", () => {
    const files = [
      "fixtures/src/world-zh.ts", "fixtures/src/zh-inputs.ts", "fixtures/src/zh-drafts.ts", "tests/fixtures-zh.test.ts", ...PATHS,
    ];
    for (const file of files) {
      const text = read(file);
      expect(text.includes(EM_DASH), `${file} has an em dash`).toBe(false);
      expect(LONELY_EN_DASH.test(text), `${file} has an en dash that is not between digits`).toBe(false);
    }
    // The pattern itself: an en dash between digits passes, any other does not.
    expect(LONELY_EN_DASH.test(`2015${EN_DASH}2019`)).toBe(false);
    expect(LONELY_EN_DASH.test(`2015 ${EN_DASH} 2019`)).toBe(true);
    expect(LONELY_EN_DASH.test(`a${EN_DASH}b`)).toBe(true);
  });
});

// ── The inputs and the clock ─────────────────────────────────────────────────────────────────────

describe("the inputs", () => {
  it("dates the Chinese pass from the English draft: the context 2 minutes later, the draft 9 after that, the deadline 12 after the context", () => {
    for (const n of EDITION_NAMES) {
      const english = Date.parse(editionDraft(n).generated_at);
      const clock = ZH_CLOCK[n];
      expect(Date.parse(clock.contextAt) - english, n).toBe(2 * MINUTE);
      expect(Date.parse(clock.generatedAt) - Date.parse(clock.contextAt), n).toBe(9 * MINUTE);
      expect(Date.parse(clock.deadline) - Date.parse(clock.contextAt), n).toBe(12 * MINUTE);
      expect(zhContext(n).deadline, n).toBe(clock.deadline);
      expect(zhDraft(n).generated_at, n).toBe(clock.generatedAt);
      expect(zhContext(n).date, n).toBe(EDITIONS[n].date);
      expect(zhDraft(n).date, n).toBe(EDITIONS[n].date);
      for (const stamp of [clock.contextAt, clock.generatedAt, clock.deadline]) expect(stamp, n).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    }
    expect(ZH_CLOCK.weekday).toEqual({ contextAt: "2026-10-14T03:43:18+08:00", generatedAt: "2026-10-14T03:52:18+08:00", deadline: "2026-10-14T03:55:18+08:00" });
  });

  it("hands each caller fresh copies, so a change never reaches the next call", () => {
    const a = zhInputs("weekday");
    a.context.strings.length = 0;
    a.evidence.urls.length = 0;
    a.english.lead.length = 0;
    const b = zhInputs("weekday");
    expect(b.context.strings.length).toBeGreaterThan(100);
    expect(b.evidence.urls.length).toBe(2);
    expect(b.english.lead.length).toBeGreaterThan(0);
    const d = zhDraft("weekday");
    delete d.strings["lead.0"];
    expect(zhDraft("weekday").strings["lead.0"]).toBeDefined();
    const e = zhEvidence("weekday");
    e.fetched.length = 0;
    expect(zhEvidence("weekday").fetched.length).toBe(2);
  });

  it("gives a Chinese validation the English draft, the context, the evidence and the repo's config, and no file name", () => {
    for (const n of EDITION_NAMES) {
      const inputs = zhInputs(n);
      expect(inputs.english).toEqual(editionDraft(n));
      expect(inputs.context).toEqual(zhContext(n));
      expect(inputs.evidence).toEqual(zhEvidence(n));
      expect(inputs.config.run.budgets.zh_factor).toBe(config.run.budgets.zh_factor);
      expect(inputs.fileDate).toBeNull();
    }
    expect(config.run.budgets.zh_factor).toBe(1.8);
    expect(config.run.budgets.zh_backlog_max).toBe(5);
    expect(config.run.budgets.zh_minutes).toBe(12);
    expect(config.run.budgets.words_max).toBe(1300);
  });

  it("builds on a sample world that is English-only apart from one bilingual rung note", () => {
    const withZh = FINDING_KEYS.flatMap((k) => l10nOf(storedFinding(k)).filter((v) => v.zh !== null).map((v) => v.en));
    expect(withZh).toHaveLength(1);
    expect(withZh[0]).toMatch(/^Retracted by Sample Physics Letters on /);
    for (const t of storedGlossary().terms) expect(t.zh, t.id).toBeNull();
    for (const n of EDITION_NAMES) for (const f of storedFindingsBefore(EDITIONS[n].date)) expect(f.title.zh, `${n} ${f.id}`).toBeNull();
  });
});

// ── The context of each edition ──────────────────────────────────────────────────────────────────

for (const name of EDITION_NAMES) {
  describe(`the ${name} context`, () => {
    const context = zhContext(name);
    const oracle = oracleOf(name);
    const draft = editionDraft(name);

    it("lists exactly the keys, English, kinds, caps and groups that §4.6 derives from the draft, in the order of its parts", () => {
      expect(context.strings).toEqual(oracle.strings);
      expect(context.strings.length).toBeGreaterThan(30);
      for (const s of context.strings) {
        expect(s.en, s.key).not.toBe(NONE_FOUND.en);
        expect(s.en, s.key).not.toBe(REMOVED_TEXT.en);
      }
    });

    it("names the stored findings it shows, then adds the oldest others, up to the backlog limit", () => {
      expect(oracle.named).toHaveLength(BACKLOG[name].named);
      expect(oracle.backlog).toHaveLength(BACKLOG[name].named + BACKLOG[name].others);
      const ids = [...new Set(context.strings.filter((s) => s.key.startsWith("backlog.")).map((s) => s.key.split(".")[1]!))];
      expect(ids).toEqual(oracle.backlog.map((f) => f.id));
      expect(ids.slice(0, BACKLOG[name].named)).toEqual(oracle.named);
      for (const r of draft.returning) expect(oracle.named, `returning ${r.finding_id}`).toContain(r.finding_id);
      for (const id of oracle.named) expect(draft.new_findings.some((f) => f.ref === id)).toBe(false);
    });

    it("lists each term once, sorted by id, with no Chinese yet and the definition cap", () => {
      expect(context.terms.map(({ id, en, definition }) => ({ id, en, definition }))).toEqual(oracle.terms);
      expect(context.terms).toHaveLength(TERM_COUNT[name]);
      for (const t of context.terms) {
        expect(t.zh, t.id).toBeNull();
        expect(t.official, t.id).toBeNull();
        expect(t.cap_chars, t.id).toBe(CAP.definition);
      }
    });

    it("lists the fixed translations that apply, each with exactly the keys it applies to", () => {
      const expected = fixedTerms.flatMap((entry) => {
        const keys = [
          ...oracle.strings.filter((s) => fixedApplies(entry, s.en, oracle.fieldOf(s.key))).map((s) => s.key),
          ...context.terms.filter((t) => fixedApplies(entry, t.en, null) || fixedApplies(entry, t.definition, null)).map((t) => `terms.${t.id}`),
        ];
        return keys.length > 0 ? [{ en: entry.en, zh: entry.zh, keys }] : [];
      });
      expect(context.fixed).toEqual(expected);
      // Every edition's text uses at least AI, model, preprint, peer review, journal, material and proof.
      expect(context.fixed.map((f) => f.en)).toEqual(expect.arrayContaining(["AI", "model", "preprint", "peer review", "journal", "material", "proof"]));
      const known = new Set([...context.strings.map((s) => s.key), ...context.terms.map((t) => `terms.${t.id}`)]);
      for (const f of context.fixed) for (const key of f.keys) expect(known.has(key), `${f.en}: ${key}`).toBe(true);
    });

    it("carries the hype words, the names that hold one, the avoid list and the site's labels from config and the vocabulary", () => {
      expect(context.hype).toEqual(config.hypeWords.zh);
      expect(context.hype_names).toEqual(config.hypeWords.names.map((n) => ({ en: n.en, zh: n.zh })));
      expect(context.avoid).toEqual(Object.fromEntries(avoidTerms.map((a) => [a.term, a.taiwan])));
      for (const rung of ALL_RUNGS) expect(context.labels[RUNG_INFO[rung].en], rung).toBe(RUNG_INFO[rung].zh);
      expect(Object.keys(context.labels).length).toBeGreaterThanOrEqual(20);
    });
  });
}

describe("the caps", () => {
  it("are the English word caps times 1.8 rounded up, as SPEC §4.12 lists them", () => {
    const pairs: [number, number][] = [
      [12, CAP.title], [60, CAP.lead], [280, CAP.storyGroup], [100, CAP.itemGroup], [40, CAP.itemTail], [40, CAP.alt], [25, CAP.note],
      [60, CAP.update], [40, CAP.idea], [20, CAP.also], [550, CAP.deepDive], [330, CAP.bigPicture], [120, CAP.bigPictureShort], [30, CAP.remarkable],
      [50, CAP.against], [40, CAP.reason], [40, CAP.definition], [1300, PAGE_CAP],
      ...Object.entries({ found: 55, matters: 50, ai_helped: 60, how_sure: 60, background: 35, could_lead: 35 }).map(([p, w]): [number, number] => [w, STORY_PART_CAP[p as ExplainerPart]]),
    ];
    for (const [words, cap] of pairs) expect(Math.ceil(Math.round(words * 1.8 * 1e6) / 1e6), `${words} words`).toBe(cap);
  });

  it("is the short big picture only for a week of fewer than three findings", () => {
    expect(zhContext("monday").strings.find((s) => s.key === "review.big_picture")!.cap_chars).toBe(594);
    expect(zhContext("monday-short").strings.find((s) => s.key === "review.big_picture")!.cap_chars).toBe(216);
    expect(editionContext("monday").week!.findings.length).toBeGreaterThanOrEqual(3);
    expect(editionContext("monday-short").week!.findings.length).toBeLessThan(3);
  });
});

// ── The valid drafts ─────────────────────────────────────────────────────────────────────────────

for (const name of EDITION_NAMES) {
  describe(`the ${name} Chinese draft`, () => {
    const context = zhContext(name);
    const draft = zhDraft(name);
    const oracle = oracleOf(name);
    const english = editionDraft(name);
    const byKey = new Map(context.strings.map((s) => [s.key, s]));

    it("holds exactly the context's keys, and the terms whose Chinese the glossary lacks", () => {
      expect(Object.keys(draft.strings)).toEqual(context.strings.map((s) => s.key));
      expect(Object.keys(draft.terms)).toEqual(context.terms.filter((t) => t.zh === null).map((t) => t.id));
      expect(DraftZh.parse(draft)).toEqual(draft);
      for (const [key, zh] of Object.entries(draft.strings)) expect(zh.trim(), key).not.toBe("");
    });

    it("translates each string with its numbers, no link and no Latin word the English lacks", () => {
      const problems = context.strings.flatMap((s) => {
        const p = parityProblems(s.en, draft.strings[s.key]!);
        return [
          ...p.missing.map((n) => `${s.key}: lacks the number ${n.key}`),
          ...p.extra.map((n) => `${s.key}: adds the number ${n.key}`),
          ...p.urls.map((u) => `${s.key}: holds the link ${u}`),
          ...p.latin.map((w) => `${s.key}: adds the Latin word ${w}`),
        ];
      });
      expect(problems).toEqual([]);
    });

    it("writes each string in Taiwan usage, with no dash, no hype word and the house style", () => {
      const problems = context.strings.flatMap((s) => [...usageProblems(draft.strings[s.key]!), ...styleProblems(draft.strings[s.key]!)].map((p) => `${s.key}: ${p}`));
      expect(problems).toEqual([]);
    });

    it("keeps every fixed translation on every key it applies to, except inside a name it keeps in English", () => {
      // Each key an entry lists holds the entry's Chinese, or holds its English only inside a name the Chinese keeps whole (Hartwell Materials Lab).
      const problems = context.fixed.flatMap((f) => f.keys.flatMap((key) => {
        const entry = fixedTerms.find((e) => e.en === f.en)!;
        const term = key.startsWith("terms.") ? context.terms.find((t) => `terms.${t.id}` === key)! : null;
        const left = term === null
          ? fixedMissing([entry], byKey.get(key)!.en, draft.strings[key]!, oracle.fieldOf(key))
          : fixedMissing([entry], [term.en, term.definition], [draft.terms[term.id]!.zh, draft.terms[term.id]!.definition], null);
        return left.map(() => `${key} lacks ${f.zh} for ${f.en}`);
      }));
      expect(problems).toEqual([]);
      // Read the other way: no entry that applies to a string is missing from it, listed or not.
      const missing = context.strings.flatMap((s) => fixedMissing(fixedTerms, s.en, draft.strings[s.key]!, oracle.fieldOf(s.key)).map((e) => `${s.key}: ${e.en}`));
      expect(missing).toEqual([]);
      // Most keys hold the Chinese outright: only a name that holds the word leaves it out.
      const plain = context.fixed.flatMap((f) => f.keys.filter((key) => !key.startsWith("terms.") && draft.strings[key]!.includes(f.zh)));
      const all = context.fixed.flatMap((f) => f.keys.filter((key) => !key.startsWith("terms.")));
      expect(plain.length / all.length).toBeGreaterThan(0.9);
    });

    it("starts a How sure we are, and a correction of one, with the label of its rung", () => {
      const checked = context.strings.filter((s) => /\.explainer\.how_sure$/.test(s.key) || (/^corrections\.\d+\.after$/.test(s.key) && english.corrections[Number(s.key.split(".")[1])]!.path === "explainer.how_sure"));
      // One How sure we are for each new finding and each backlog finding, and one for each correction of one.
      expect(checked).toHaveLength(english.new_findings.length + oracle.backlog.length + english.corrections.filter((c) => c.path === "explainer.how_sure").length);
      const problems = checked.flatMap((s) => {
        const rung = ALL_RUNGS.find((r) => s.en.startsWith(RUNG_INFO[r].en) && !/^[\p{L}\p{N}]/u.test(s.en.slice(RUNG_INFO[r].en.length)));
        if (rung === undefined) return [`${s.key}: the English starts with no rung label`];
        return draft.strings[s.key]!.startsWith(RUNG_INFO[rung].zh) ? [] : [`${s.key}: does not start with ${RUNG_INFO[rung].zh}`];
      });
      expect(problems).toEqual([]);
    });

    it("writes the English of a term once, in full-width brackets after its first use, in every explainer that has Chinese", () => {
      const termById = new Map(context.terms.map((t) => [t.id, t]));
      const findings = [
        ...english.new_findings.map((f) => ({ prefix: `new.${f.ref}`, terms: f.terms.map((t) => (t.new ? termId(t.term) : t.id)) })),
        ...oracle.backlog.map((f) => ({ prefix: `backlog.${f.id}`, terms: [...f.terms] })),
      ];
      let judged = 0;
      const problems = findings.flatMap(({ prefix, terms }) => {
        const parts = EXPLAINER_PARTS.map((p) => draft.strings[`${prefix}.explainer.${p}`] ?? "");
        const once = englishOnceProblems({
          parts,
          title: draft.strings[`${prefix}.title`]!,
          terms: terms.map((id) => ({ en: termById.get(id)!.en, zh: draft.terms[id]!.zh })),
        });
        judged += terms.length;
        return once.map((p) => `${prefix}: ${p.kind} ${p.term.en}`);
      });
      expect(judged).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });

    it("keeps each string within its cap and each group within its own", () => {
      const over = context.strings.filter((s) => countZhChars(draft.strings[s.key]!) > s.cap_chars).map((s) => s.key);
      expect(over).toEqual([]);
      const groups = new Map<string, { cap: number; total: number }>();
      for (const s of context.strings) {
        if (s.group === null) continue;
        const g = groups.get(s.group.id) ?? { cap: s.group.cap_chars, total: 0 };
        expect(g.cap, s.group.id).toBe(s.group.cap_chars);
        g.total += countZhChars(draft.strings[s.key]!);
        groups.set(s.group.id, g);
      }
      expect(groups.size).toBeGreaterThan(0);
      expect([...groups].filter(([, g]) => g.total > g.cap).map(([id]) => id)).toEqual([]);
      // Each string of an item's first four parts has the group's cap as its own; a story's parts have their own.
      for (const s of context.strings.filter((x) => x.group !== null && x.key.includes(".explainer.") && x.group.cap_chars === CAP.itemGroup)) {
        expect(s.cap_chars, s.key).toBe(CAP.itemGroup);
      }
      // The groups are the Lead's (one for all its sentences) and one for each finding the pass translates (new or backlog).
      expect([...groups.keys()].filter((id) => id !== "lead").every((id) => /^(new\.new-\d+|backlog\.[a-z]+-\d{4}-\d{4})\.explainer$/.test(id))).toBe(true);
    });

    it("keeps the page total within 2,340 characters, counting what WORDS counts and never the backlog", () => {
      const story = english.story;
      const page = context.strings.filter((s) => countsForPage(s.key, story)).reduce((n, s) => n + countZhChars(draft.strings[s.key]!), 0);
      const all = context.strings.reduce((n, s) => n + countZhChars(draft.strings[s.key]!), 0);
      const backlog = context.strings.filter((s) => s.key.startsWith("backlog.")).reduce((n, s) => n + countZhChars(draft.strings[s.key]!), 0);
      expect(page).toBeGreaterThan(0);
      expect(page).toBeLessThanOrEqual(PAGE_CAP);
      expect(backlog).toBeGreaterThan(0);
      if (name === "weekday") {
        // The weekday is the base of the ZH_CHARS fixtures: its strings together are far over the page cap, its page total is not.
        expect(all).toBeGreaterThan(PAGE_CAP);
        expect(all - backlog).toBeLessThan(PAGE_CAP);
      }
    });

    it("gives each term its Chinese name and definition, judged together as the rules judge them", () => {
      const problems = context.terms.filter((t) => t.zh === null).flatMap((t) => {
        const zh = draft.terms[t.id]!;
        const name_ = [t.en, t.definition];
        const text = [zh.zh, zh.definition];
        const p = parityProblems(name_, text);
        return [
          ...p.missing.map((n) => `${t.id}: lacks the number ${n.key}`),
          ...p.extra.map((n) => `${t.id}: adds the number ${n.key}`),
          ...p.urls.map((u) => `${t.id}: holds the link ${u}`),
          ...p.latin.map((w) => `${t.id}: adds the Latin word ${w}`),
          ...fixedMissing(fixedTerms, name_, text, null).map((e) => `${t.id}: lacks ${e.zh} for ${e.en}`),
          ...text.flatMap((x) => [...usageProblems(x), ...styleProblems(x)]).map((x) => `${t.id}: ${x}`),
          ...(countZhChars(zh.definition) > t.cap_chars ? [`${t.id}: the definition is over ${t.cap_chars}`] : []),
          ...(zh.zh.length === 0 ? [`${t.id}: no Chinese name`] : []),
        ];
      });
      expect(problems).toEqual([]);
    });

    it("gives a term an 樂詞網 entry on the National Academy's term bank, backed by a page the pass fetched, or none at all", () => {
      const evidence = zhEvidence(name);
      const wanted: string[] = [];
      for (const t of context.terms) {
        const zh = draft.terms[t.id]!;
        expect(zh.official === null, `${t.id}: official and official_url are both set or both null`).toBe(zh.official_url === null);
        if (zh.official === null || zh.official_url === null) continue;
        wanted.push(zh.official_url);
        expect(hostOf(zh.official_url), t.id).toBe("terms.naer.edu.tw");
        expect(zh.official_url, t.id).toMatch(/^https:\/\/terms\.naer\.edu\.tw\/detail\/ut-sample-\d{4}\/$/);
        expect(evidence.fetched, t.id).toContain(zh.official_url);
        expect(evidence.seen_as[normalizeUrl(zh.official_url)], t.id).toBe("fetched");
        expect(evidence.texts[normalizeUrl(zh.official_url)]!.normalize("NFKC"), t.id).toContain(zh.official.normalize("NFKC"));
        expect(evidence.texts[normalizeUrl(zh.official_url)], t.id).toBe(officialPageText(t.en, zh.official));
      }
      expect(evidence.urls).toEqual(wanted);
      expect(evidence.fetched).toEqual(wanted);
      expect(Object.keys(evidence.texts)).toEqual(wanted.map(normalizeUrl));
      expect(evidence.types).toEqual({});
      expect(evidence.resolved).toEqual({});
      expect(wanted.length).toBeLessThanOrEqual(context.terms.length);
      for (const text of Object.values(evidence.texts)) expect(text).toContain("SAMPLE page, invented for tests and never fetched.");
    });
  });
}

describe("the valid drafts through validateZh()", () => {
  for (const name of EDITION_NAMES) {
    it(`passes the ${name} draft with no error and no warning, and warns once, only about the evidence, when the evidence is missing`, () => {
      const inputs = zhInputs(name);
      const result = validateZh(zhDraft(name), inputs.english, inputs, { fileDate: inputs.fileDate });
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.draft).toEqual(zhDraft(name));
      const without = validateZh(zhDraft(name), inputs.english, { context: inputs.context, config: inputs.config });
      expect(without.errors).toEqual([]);
      expect(without.warnings.map((w) => w.code)).toEqual(["INPUT_MISSING"]);
    });
  }

  it("fails a draft that breaks one thing with that thing's code alone, so the inputs are the ones the rules read", () => {
    const codes = (mutate: (draft: DraftZh, inputs: ReturnType<typeof zhInputs>) => void): string[] => {
      const inputs = zhInputs("weekday");
      const draft = zhDraft("weekday");
      mutate(draft, inputs);
      return [...new Set(validateZh(draft, inputs.english, inputs).errors.map((e) => e.code))].sort();
    };
    const nwp = ZH_TERM_TABLE["numerical-weather-prediction"]!;
    expect(codes((d) => { delete d.strings["lead.0"]; })).toEqual(["ZH_KEYS"]);
    expect(codes((d) => { d.strings["new.new-1.explainer.found"] = d.strings["new.new-1.explainer.found"]!.replace(/\d+/, "7"); })).toEqual(["ZH_PARITY"]);
    expect(codes((d) => { d.strings["lead.0"] += "，使用了軟件"; })).toEqual(["ZH_AVOID"]);
    expect(codes((d) => { d.strings["lead.0"] += String.fromCharCode(0x2014); })).toEqual(["ZH_NO_DASH"]);
    expect(codes((d) => { d.terms["numerical-weather-prediction"]!.official_url = "https://example.org/x"; })).toEqual(["ZH_OFFICIAL"]);
    expect(codes((_, i) => { i.evidence.texts[normalizeUrl(nwp.official_url!)] = "A page without the term."; })).toEqual(["ZH_OFFICIAL"]);
    expect(codes((d) => { d.strings["lead.0"] = "字".repeat(CAP.lead + 1); })).toContain("ZH_CHARS");
    expect(codes((d) => { d.strings["new.new-1.explainer.how_sure"] = d.strings["new.new-1.explainer.how_sure"]!.replace(/^[^。]*。/, "好。"); })).toContain("ZH_RUNG_LABEL");
  });
});

describe("the draft's joined strings", () => {
  it("is the table's Chinese of the English the context holds, for any key", () => {
    for (const n of EDITION_NAMES) {
      for (const s of zhContext(n).strings) expect(zhStringOf(n, s.key), `${n} ${s.key}`).toBe(zhText(s.en));
    }
    expect(() => zhStringOf("weekday", "lead.99")).toThrow(/no key lead\.99/);
  });

  it("holds a text of several paragraphs paragraph by paragraph, with as many paragraphs in Chinese as in English", () => {
    for (const key of ["deep_dive"]) {
      const en = zhContext("sunday").strings.find((s) => s.key === key)!.en;
      expect(en.split("\n\n").length).toBeGreaterThan(1);
      expect(zhStringOf("sunday", key).split("\n\n")).toHaveLength(en.split("\n\n").length);
    }
    const big = zhContext("monday").strings.find((s) => s.key === "review.big_picture")!.en;
    expect(zhStringOf("monday", "review.big_picture").split("\n\n")).toHaveLength(big.split("\n\n").length);
    expect(big.split("\n\n").length).toBeGreaterThan(1);
  });
});

// ── The translation table ────────────────────────────────────────────────────────────────────────

describe("the translation table", () => {
  /** Every English string the sample needs in Chinese: each finding's with a null `zh`, each glossary definition, each context string, by paragraph. */
  const needed = new Set<string>();
  for (const k of FINDING_KEYS) for (const v of l10nOf(storedFinding(k))) if (v.zh === null) needed.add(v.en);
  for (const t of storedGlossary().terms) needed.add(t.en.definition);
  for (const n of EDITION_NAMES) for (const s of zhContext(n).strings) for (const p of s.en.split("\n\n")) needed.add(p);

  it("translates each English string once, and exactly the strings the sample shows", () => {
    expect(new Set(ZH_ENGLISH).size).toBe(ZH_ENGLISH.length);
    expect([...ZH_ENGLISH].sort(byCodeUnit)).toEqual([...needed].sort(byCodeUnit));
    for (const en of ZH_ENGLISH) expect(hasZhText(en), en).toBe(true);
    expect(hasZhText("A sentence the sample does not hold.")).toBe(false);
    expect(() => zhText("A sentence the sample does not hold.")).toThrow(/no Chinese for this sample string/);
    expect(() => zhText("First paragraph.\n\nA sentence the sample does not hold.")).toThrow(/no Chinese/);
    expect(zhL10n(ZH_ENGLISH[0]!)).toEqual({ en: ZH_ENGLISH[0], zh: zhText(ZH_ENGLISH[0]!) });
    // A text of several paragraphs is known when every paragraph is, and is joined by the same blank line.
    const [a, b] = [ZH_ENGLISH[0]!, ZH_ENGLISH[1]!];
    expect(hasZhText(`${a}\n\n${b}`)).toBe(true);
    expect(hasZhText(`${a}\n\nA sentence the sample does not hold.`)).toBe(false);
    expect(zhText(`${a}\n\n${b}`)).toBe(`${zhText(a)}\n\n${zhText(b)}`);
  });

  it("passes every Chinese string through the text checks, the house style and the cap of its kind", () => {
    const problems = ZH_ENGLISH.flatMap((en) => {
      const zh = zhText(en);
      const p = parityProblems(en, zh);
      return [
        ...p.missing.map((n) => `lacks the number ${n.key}`),
        ...p.extra.map((n) => `adds the number ${n.key}`),
        ...p.urls.map((u) => `holds the link ${u}`),
        ...p.latin.map((w) => `adds the Latin word ${w}`),
        ...usageProblems(zh),
        ...styleProblems(zh),
        ...(englishSentences(en).length === chineseSentences(zh).length ? [] : [`${englishSentences(en).length} English sentences, ${chineseSentences(zh).length} Chinese`]),
      ].map((x) => `${x}: ${en.slice(0, 50)}`);
    });
    expect(problems).toEqual([]);
  });

  it("gives the same English sentence the same Chinese wherever it stands", () => {
    const seen = new Map<string, { zh: string; from: string }>();
    const conflicts: string[] = [];
    for (const en of ZH_ENGLISH) {
      const e = englishSentences(en);
      const z = chineseSentences(zhText(en));
      if (e.length !== z.length) continue;
      e.forEach((sentence, i) => {
        const first = seen.get(sentence);
        if (first === undefined) seen.set(sentence, { zh: z[i]!, from: en.slice(0, 40) });
        else if (first.zh !== z[i]) conflicts.push(`${sentence.slice(0, 60)}: ${first.zh} / ${z[i]}`);
      });
    }
    expect(conflicts).toEqual([]);
    expect(seen.size).toBeGreaterThan(200);
  });

  it("keeps each claim at its strength (STYLE-ZH 12): who says it stays named, and a possibility stays a possibility and is never added", () => {
    /** The two English sentences where "may" or "could" is permission or ability, which Chinese writes 可以 or 能 and not as a possibility. */
    const NOT_A_POSSIBILITY = [/\bwhat they may share\b/, /\bwhat a second lab could check\b/];
    const EN_SAYS = /\b(says?|claims?|argues?|calls?)\b/i;
    const ZH_SAYS = /表示|宣稱|主張|稱|說/u;
    const EN_HEDGE = /\b(could|may|might)\b/i;
    const EN_ANY_HEDGE = /\b(could|may|might|would|if|likely|perhaps|possible|possibly)\b/i;
    const ZH_HEDGE = /可能|或許|有機會|不一定|也許/u;
    let says = 0;
    let hedges = 0;
    const problems: string[] = [];
    for (const en of ZH_ENGLISH) {
      const e = englishSentences(en);
      const z = chineseSentences(zhText(en));
      e.forEach((sentence, i) => {
        const zh = z[i]!;
        if (EN_SAYS.test(sentence)) {
          says += 1;
          if (!ZH_SAYS.test(zh)) problems.push(`drops who says it: ${sentence} / ${zh}`);
        }
        if (EN_HEDGE.test(sentence) && !NOT_A_POSSIBILITY.some((re) => re.test(sentence))) {
          hedges += 1;
          if (!ZH_HEDGE.test(zh)) problems.push(`turns a possibility into a fact: ${sentence} / ${zh}`);
        }
        if (ZH_HEDGE.test(zh) && !EN_ANY_HEDGE.test(sentence)) problems.push(`adds a possibility: ${sentence} / ${zh}`);
      });
    }
    expect(problems).toEqual([]);
    // The probe reads the whole table: dozens of attributed and of hedged sentences, so a table that lost its hedges would not pass by having none.
    expect(says).toBeGreaterThanOrEqual(30);
    expect(hedges).toBeGreaterThanOrEqual(30);
  });

  it("writes each phrase the world repeats the same way in Chinese", () => {
    const WORDING: readonly (readonly [RegExp, string])[] = [
      [/\bno tie\b/, "沒有關聯"],
      [/\bthe maker\b/, "開發者"],
      [/\bpublished the paper\b/, "發表了這篇論文"],
      [/\bsealed\b/i, "密封"],
      [/\brelies on\b/, "依靠"],
      [/\bsafety trial\b/, "安全性試驗"],
      [/\bmouse tests\b/, "小鼠實驗"],
      [/\bhas not been peer reviewed\b/, "尚未經過同儕審查"],
      [/\bhosts the paper\b/, "論文放在"],
    ];
    const seen = new Map<string, number>();
    const problems: string[] = [];
    for (const en of ZH_ENGLISH) {
      const e = englishSentences(en);
      const z = chineseSentences(zhText(en));
      e.forEach((sentence, i) => {
        for (const [phrase, zh] of WORDING) {
          if (!phrase.test(sentence)) continue;
          seen.set(String(phrase), (seen.get(String(phrase)) ?? 0) + 1);
          if (!z[i]!.includes(zh)) problems.push(`${phrase} is not ${zh}: ${sentence} / ${z[i]}`);
        }
      });
    }
    expect(problems).toEqual([]);
    for (const [phrase] of WORDING) expect(seen.get(String(phrase)) ?? 0, `${phrase} is read in the sample`).toBeGreaterThanOrEqual(1);
  });

  it("keeps a bilingual rung note as it is and fills every other null Chinese, leaving the English and the rest of the finding alone", () => {
    for (const k of FINDING_KEYS) {
      const f = storedFinding(k);
      const before = structuredClone(f);
      const filled = findingWithZh(f);
      expect(f, `${k} is not changed`).toEqual(before);
      expect(Finding.parse(filled), k).toEqual(filled);
      const [a, b] = [l10nOf(f), l10nOf(filled)];
      expect(b).toHaveLength(a.length);
      a.forEach((v, i) => {
        expect(b[i]!.en, k).toBe(v.en);
        expect(b[i]!.zh, `${k}: ${v.en.slice(0, 40)}`).toBe(v.zh === null ? zhText(v.en) : v.zh);
        expect(b[i]!.zh, k).not.toBeNull();
      });
      expect({ ...filled, title: f.title, explainer: f.explainer, rung_history: f.rung_history, since_then: f.since_then, figure: f.figure }).toEqual(f);
    }
    const once = findingWithZh(storedFinding(FINDING_KEYS[0]!));
    expect(findingWithZh(once)).toEqual(once);
  });

  it("fills a glossary with the seven terms' Chinese: a name, the definition's Chinese and the entry or none", () => {
    const glossary = storedGlossary();
    const filled = glossaryWithZh(glossary);
    expect(GlossaryFile.parse(filled)).toEqual(filled);
    expect(filled.terms.map((t) => t.id)).toEqual(glossary.terms.map((t) => t.id));
    expect(Object.keys(ZH_TERM_TABLE)).toEqual(glossary.terms.map((t) => t.id));
    for (const t of filled.terms) {
      const record = ZH_TERM_TABLE[t.id]!;
      expect(t.zh, t.id).toEqual({ term: record.zh, definition: zhText(t.en.definition), official: record.official, official_url: record.official_url });
      expect(record.official === null, t.id).toBe(record.official_url === null);
      if (record.official !== null) expect(record.official, t.id).toBe(record.zh);
      expect(termWithZh(t), t.id).toEqual(t);
    }
    const open = glossary.terms[0]!;
    expect(termWithZh({ ...open, zh: { term: "已有", definition: "已有的定義", official: null, official_url: null } }).zh!.term).toBe("已有");
    expect(() => termWithZh({ ...open, id: "no-such-term" })).toThrow(/no Chinese for the glossary term no-such-term/);
    const urls = Object.values(ZH_TERM_TABLE).flatMap((r) => (r.official_url === null ? [] : [r.official_url]));
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(3);
    for (const url of urls) expect(url).toMatch(/^https:\/\/terms\.naer\.edu\.tw\/detail\/ut-sample-\d{4}\/$/);
  });
});

// ── The builder, given other inputs ──────────────────────────────────────────────────────────────

describe("zhContextOf", () => {
  const base = (): ReturnType<typeof zhContextInput> => zhContextInput("weekday");

  it("builds the committed context from the weekday's inputs", () => {
    expect(zhContextOf(base())).toEqual(zhContext("weekday"));
  });

  it("drops a finding whose Chinese the store holds, with its strings and its terms, once its terms have Chinese too", () => {
    const input = base();
    const translated = zhContextOf({ ...input, stored: input.stored.map(findingWithZh), glossary: glossaryWithZh(input.glossary) });
    expect(translated.strings.filter((s) => s.key.startsWith("backlog."))).toEqual([]);
    expect(translated.strings).toEqual(zhContext("weekday").strings.filter((s) => !s.key.startsWith("backlog.")));
    // Only the new findings' terms are left, and the weekday's new findings define theirs: none has Chinese yet.
    expect(translated.terms.map((t) => t.id)).toEqual(oracleOf("weekday").terms.filter((t) => draftTermIds().includes(t.id)).map((t) => t.id));
    expect(translated.terms.length).toBeGreaterThan(0);
    expect(translated.terms.every((t) => t.zh === null)).toBe(true);
    const written = zhDraftOf(translated, ZH_CLOCK.weekday.generatedAt);
    expect(Object.keys(written.terms)).toEqual(translated.terms.map((t) => t.id));
    expect(Object.keys(written.strings)).toEqual(translated.strings.map((s) => s.key));
  });

  it("keeps a term whose Chinese the glossary holds in the context, with its Chinese and its entry, and leaves it out of the draft", () => {
    const input = base();
    const id = "numerical-weather-prediction";
    const glossary = { ...input.glossary, terms: input.glossary.terms.map((t) => (t.id === id ? termWithZh(t) : t)) };
    const ctx = zhContextOf({ ...input, glossary });
    const term = ctx.terms.find((t) => t.id === id)!;
    expect(term.zh).toBe(ZH_TERM_TABLE[id]!.zh);
    expect(term.official).toBe(ZH_TERM_TABLE[id]!.official);
    expect(term.official).not.toBeNull();
    expect(ctx.terms.map((t) => t.id)).toEqual(zhContext("weekday").terms.map((t) => t.id));
    expect(ctx.terms.filter((t) => t.id !== id).every((t) => t.zh === null)).toBe(true);
    const written = zhDraftOf(ctx, ZH_CLOCK.weekday.generatedAt);
    expect(Object.keys(written.terms)).toEqual(zhContext("weekday").terms.map((t) => t.id).filter((x) => x !== id));
    expect(ctx.strings).toEqual(zhContext("weekday").strings);
  });

  it("keeps a finding in the backlog while one of its terms has no Chinese, with no string of it left, and lists that term", () => {
    const input = base();
    const ctx = zhContextOf({ ...input, stored: input.stored.map(findingWithZh) });
    expect(ctx.strings.filter((s) => s.key.startsWith("backlog."))).toEqual([]);
    // The backlog is the findings with a term: the named ones, then the five oldest others.
    const named = oracleOf("weekday").named;
    const withTerms = input.stored.filter((f) => f.terms.length > 0);
    const others = withTerms.filter((f) => !named.includes(f.id)).sort((a, b) => byCodeUnit(a.updated, b.updated) || compareFindingIds(a.id, b.id)).slice(0, 5);
    const backlog = [...withTerms.filter((f) => named.includes(f.id)), ...others];
    const wanted = [...new Set([...draftTermIds(), ...backlog.flatMap((f) => f.terms)])].sort(byCodeUnit);
    expect(ctx.terms.map((t) => t.id)).toEqual(wanted);
    expect(wanted.length).toBeGreaterThan(draftTermIds().length);
  });

  it("leaves out a correction's `after` that is a vocabulary id, and a string that is exactly NONE_FOUND or REMOVED_TEXT", () => {
    const input = base();
    const draft = structuredClone(input.draft);
    draft.corrections[0] = { ...draft.corrections[0]!, path: "ai.role", after: AI_ROLES[1] };
    draft.corrections[1] = { ...draft.corrections[1]!, after: REMOVED_TEXT.en };
    draft.ideas[0] = { ...draft.ideas[0]!, text: NONE_FOUND.en };
    const keys = zhContextOf({ ...input, draft }).strings.map((s) => s.key);
    expect(keys).not.toContain("corrections.0.after");
    expect(keys).not.toContain("corrections.1.after");
    expect(keys).not.toContain("ideas.0");
    expect(keys).toContain("corrections.0.reason");
    expect(keys).toContain("corrections.1.reason");
    expect(keys).toContain("ideas.1");
    expect(keys).toHaveLength(zhContext("weekday").strings.length - 3);
    const monday = zhContextInput("monday");
    const review = structuredClone(monday.draft);
    review.review!.strongest_against = { ...review.review!.strongest_against, text: NONE_FOUND.en };
    expect(zhContextOf({ ...monday, draft: review }).strings.map((s) => s.key)).not.toContain("review.strongest_against");
  });

  it("puts a backlog finding's figure alt text and a story's six parts under its own keys, caps and group", () => {
    // No fixture edition has a backlog finding with a figure: the one finding that has one, a story, joins the Sunday's backlog once it is the oldest.
    const input = zhContextInput("sunday");
    const figured = input.stored.find((f) => f.figure !== null)!;
    expect(figured.depth).toBe("story");
    const stored = input.stored.map((f) => (f.id === figured.id ? { ...f, updated: "2000-01-01" } : f));
    const ctx = zhContextOf({ ...input, stored });
    const alt = ctx.strings.find((s) => s.key === `backlog.${figured.id}.figure.alt`)!;
    expect(alt).toEqual({ key: `backlog.${figured.id}.figure.alt`, en: figured.figure!.alt.en, kind: "alt", cap_chars: CAP.alt, group: null });
    const parts = ctx.strings.filter((s) => s.key.startsWith(`backlog.${figured.id}.explainer.`));
    expect(parts.map((s) => s.key.split(".").at(-1))).toEqual([...EXPLAINER_PARTS]);
    expect(parts.map((s) => s.cap_chars)).toEqual(EXPLAINER_PARTS.map((p) => STORY_PART_CAP[p]));
    for (const s of parts) expect(s.group).toEqual({ id: `backlog.${figured.id}.explainer`, cap_chars: CAP.storyGroup });
    const keys = ctx.strings.map((s) => s.key);
    expect(keys.indexOf(alt.key)).toBeGreaterThan(keys.indexOf(`backlog.${figured.id}.explainer.could_lead`));
    expect(zhDraftOf(ctx, ZH_CLOCK.sunday.generatedAt).strings[alt.key]).toBe(zhText(alt.en));
  });

  it("puts a returning finding's own rung note under its key, between its update and the rung changes", () => {
    const input = base();
    const draft = structuredClone(input.draft);
    const note = draft.rung_changes[0]!.rung;
    draft.returning[0] = { ...draft.returning[0]!, rung: structuredClone(note) };
    const keys = zhContextOf({ ...input, draft }).strings.map((s) => s.key);
    const id = draft.returning[0]!.finding_id;
    expect(keys.slice(keys.indexOf(`returning.${id}.update`), keys.indexOf(`returning.${id}.update`) + 2)).toEqual([`returning.${id}.update`, `returning.${id}.rung`]);
    expect(zhContextOf({ ...input, draft }).strings.find((s) => s.key === `returning.${id}.rung`)).toMatchObject({ kind: "note", cap_chars: CAP.note, en: note.note });
    expect(keys).toHaveLength(zhContext("weekday").strings.length + 1);
  });

  it("adds no more than `zh_backlog_max` other findings, the oldest by `updated` first, then by id, after every named one", () => {
    const input = base();
    const small = { ...input, config: { ...input.config, run: { ...input.config.run, budgets: { ...input.config.run.budgets, zh_backlog_max: 2 } } } };
    const ids = (ctx: ZhContext): string[] => [...new Set(ctx.strings.filter((s) => s.key.startsWith("backlog.")).map((s) => s.key.split(".")[1]!))];
    const full = ids(zhContext("weekday"));
    expect(ids(zhContextOf(small))).toEqual(full.slice(0, BACKLOG.weekday.named + 2));
    // The finding the limit left out becomes the first of the others once it is the oldest, and the newest of the others goes.
    const cut = input.stored.find((f) => !full.includes(f.id))!.id;
    const older = input.stored.map((f) => (f.id === cut ? { ...f, updated: "2000-01-01" } : f));
    const reordered = ids(zhContextOf({ ...input, stored: older }));
    expect(reordered.slice(BACKLOG.weekday.named)[0]).toBe(cut);
    expect(reordered).toHaveLength(full.length);
    expect(reordered).not.toContain(full.at(-1));
    // Two equally old findings come by id.
    const tied = input.stored.map((f) => ({ ...f, updated: "2026-01-01" }));
    const others = ids(zhContextOf({ ...input, stored: tied })).slice(BACKLOG.weekday.named);
    expect(others).toEqual(input.stored.filter((f) => !full.slice(0, BACKLOG.weekday.named).includes(f.id)).map((f) => f.id).sort(compareFindingIds).slice(0, 5));
  });

  /**
   * A fixed entry applies to a string by the field of the finding the string belongs to (§4.11): the Lead, the ideas, the big picture and
   * the strongest evidence against belong to none, so only an entry that holds in every field applies to them. Each probe puts one word
   * of a field-limited entry (proof: mathematics; sequencing: chemistry and biology; regression: mathematics and social) or of an
   * unlimited one (preprint) into the English of one key and asks whether the context lists that key under the entry.
   */
  const PROBES: { edition: EditionName; key: string; word: string; set: (d: DraftBrief) => void; applies: boolean }[] = [
    { edition: "weekday", key: "also.0", word: "sequencing", applies: true, set: (d) => { d.also[0] = { ...d.also[0]!, field: "biology", title: "A sequencing result." }; } },
    { edition: "weekday", key: "also.0", word: "sequencing", applies: false, set: (d) => { d.also[0] = { ...d.also[0]!, field: "physics", title: "A sequencing result." }; } },
    { edition: "weekday", key: "lead.0", word: "proof", applies: false, set: (d) => { d.lead[0] = { ...d.lead[0]!, text: "A proof result." }; } },
    { edition: "weekday", key: "lead.0", word: "preprint", applies: true, set: (d) => { d.lead[0] = { ...d.lead[0]!, text: "A preprint result." }; } },
    { edition: "weekday", key: "ideas.0", word: "proof", applies: false, set: (d) => { d.ideas[0] = { ...d.ideas[0]!, text: "A proof result." }; } },
    { edition: "weekday", key: "returning.soc-2026-0145.update", word: "regression", applies: true, set: (d) => { d.returning[0] = { ...d.returning[0]!, update: "A regression result." }; } },
    { edition: "weekday", key: "rung.chem-2026-0142", word: "sequencing", applies: true, set: (d) => { d.rung_changes[0]!.rung.note = "A sequencing result."; } },
    { edition: "weekday", key: "rung.chem-2026-0142", word: "proof", applies: false, set: (d) => { d.rung_changes[0]!.rung.note = "A proof result."; } },
    { edition: "weekday", key: "reports.R-0002.reason", word: "proof", applies: true, set: (d) => { d.report_decisions[0] = { ...d.report_decisions[0]!, reason: "A proof result." }; } },
    { edition: "weekday", key: "corrections.0.reason", word: "proof", applies: true, set: (d) => { d.corrections[0] = { ...d.corrections[0]!, reason: "A proof result." }; } },
    { edition: "sunday", key: "deep_dive", word: "sequencing", applies: true, set: (d) => { d.deep_dive = { ...d.deep_dive!, text: "A sequencing result." }; } },
    { edition: "sunday", key: "deep_dive", word: "proof", applies: false, set: (d) => { d.deep_dive = { ...d.deep_dive!, text: "A proof result." }; } },
    { edition: "monday", key: "review.remarkable", word: "sequencing", applies: true, set: (d) => { d.review!.remarkable = { ...d.review!.remarkable!, note: "A sequencing result." }; } },
    { edition: "monday", key: "review.big_picture", word: "proof", applies: false, set: (d) => { d.review!.big_picture = "A proof result."; } },
    { edition: "monday", key: "review.strongest_against", word: "proof", applies: false, set: (d) => { d.review!.strongest_against = { ...d.review!.strongest_against, text: "A proof result." }; } },
  ];
  for (const probe of PROBES) {
    it(`${probe.applies ? "lists" : "does not list"} ${probe.key} under "${probe.word}" when its English holds it (${probe.edition})`, () => {
      const input = zhContextInput(probe.edition);
      const draft = structuredClone(input.draft);
      probe.set(draft);
      const ctx = zhContextOf({ ...input, draft });
      expect(ctx.strings.some((s) => s.key === probe.key), "the key is in the context").toBe(true);
      expect(ctx.fixed.find((f) => f.en === probe.word)?.keys.includes(probe.key) ?? false).toBe(probe.applies);
    });
  }

  it("gives the big picture the short cap exactly when the week has fewer than three findings", () => {
    const monday = zhContextInput("monday");
    const cap = (weekFindings: number | null): number => zhContextOf({ ...monday, weekFindings }).strings.find((s) => s.key === "review.big_picture")!.cap_chars;
    expect(cap(2)).toBe(216);
    expect(cap(3)).toBe(594);
    expect(cap(null)).toBe(594);
  });

  it("fails loudly for an English string the table lacks, so a changed sentence cannot keep an old translation", () => {
    const input = base();
    const draft = structuredClone(input.draft);
    draft.lead[0] = { ...draft.lead[0]!, text: "A sentence the sample does not hold." };
    expect(() => zhDraftOf(zhContextOf({ ...input, draft }), ZH_CLOCK.weekday.generatedAt)).toThrow(/no Chinese for this sample string/);
  });

  /** The ids of the terms the weekday's new findings use (the terms a context lists once the backlog's findings have left). */
  function draftTermIds(): string[] {
    return editionDraft("weekday").new_findings.flatMap((f) => f.terms.map((t) => (t.new ? termId(t.term) : t.id)));
  }
});
