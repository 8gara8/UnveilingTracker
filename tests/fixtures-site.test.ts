// The sample content (SPEC §3, §4.12 "Fixtures and tests", §10 P1 step 5): `fixtures/site-content/` (seven stored editions, 2026-10-12 to
// 2026-10-18), `fixtures/empty-content/` and `fixtures/state/`, written by fixtures/src/site.ts, state.ts and site-text.ts. It checks that
// the folders are the builder's output byte for byte and registered with it; that every file parses with its schema and round-trips through
// `jsonText()`; that the plan table (`SAMPLE_EDITIONS`, `SAMPLE_WEEK`) and the header comment of site.ts say what the stored briefs show,
// each fact derived here from the folder and not from the builder; that every element SPEC §10 P1 lists is present (a Monday review in
// §4.5's short form, a Sunday deep dive, an English-only day, a data-only day, about 15 findings over all seven fields, every rung, AI role,
// kind and significance, a figure with its licence, corrections, reports, a glossary with Chinese, the Herculaneum scroll as one finding);
// that every reference between the files resolves (briefs, findings, terms, corrections, reports, the archive index, the status records,
// the metrics) and that each finding's `briefs`, `first_brief` and `updated` agree with where the briefs show it; that every reader-visible
// name and title is marked SAMPLE; that C and D equal what lib/metrics/ledger-stats.ts computes from the findings as they stood before
// each edition, and A and B what lib/metrics/pace.ts computes from the stored weekly state (recounted by hand too), with each manifest
// holding the counts the state holds for the weeks it fetched; that `publishDraft()` and `publishDataOnly()` reproduce each stored day from
// its draft over the records stored before it, and give the same finding as the world (`storedFinding()`) for the findings that share its
// dates; that the Chinese strings use Taiwan usage, keep the English numbers and pass `validateZh()` pass by pass; that the folder feeds each
// chat format of SPEC §8.8; and that `validateAll()` finds no error and no warning. The rules' own cases are judged in the tests of their groups.
// New for this project; Cyber's tests have no sample of this kind.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { addDays, dataCutoffFor, daysBetween, lastSunday, weekday } from "@/lib/dates";
import { byCodeUnit, compareFindingIds } from "@/lib/ids";
import { jsonText } from "@/lib/json";
import { holdRate, landmarkCounts } from "@/lib/metrics/ledger-stats";
import { buildPace } from "@/lib/metrics/pace";
import { buildPublishedInput } from "@/lib/rules/run";
import { pageProseOf } from "@/lib/rules/shared";
import { Brief } from "@/lib/schema/brief";
import type { Rung } from "@/lib/schema/common";
import type { DraftBrief } from "@/lib/schema/draft";
import { Finding } from "@/lib/schema/finding";
import { GlossaryFile, type Term } from "@/lib/schema/glossary";
import { InputsManifest, MetricsFile, PaceWeeklyFile } from "@/lib/schema/metrics";
import { ArchiveIndex, CorrectionsFile, ReportsFile, type Correction, type Report } from "@/lib/schema/misc";
import { RUN_STAGES, StatusFile } from "@/lib/schema/status";
import { countWords } from "@/lib/text";
import { normalizeUrl } from "@/lib/urls";
import { validateAll } from "@/lib/validate";
import { validateZh } from "@/lib/validate-zh";
import { AI_ROLES, ALL_RUNGS, FIELDS, FINDING_KINDS, NONE_FOUND, SIGNIFICANCE } from "@/lib/vocab";
import { avoidHits, countZhChars, dashHits, parityProblems, traditionalHits } from "@/lib/zh";
import { GENERATORS, allOutputs, compareOutputs } from "@/fixtures/src/build";
import { PLANS, editionDraft, refOf } from "@/fixtures/src/drafts";
import { editionContext, fixtureConfig } from "@/fixtures/src/inputs";
import {
  SAMPLE_COMMIT, SAMPLE_DATES, SAMPLE_EDITIONS, SAMPLE_FINDINGS, SAMPLE_WEEK, SEEDED, SEED_KEYS, buildSample, findingMentionsAnthropic, publishDataOnly,
  morningOf, publishDraft, siteOutputs, storedBriefOfDraft, weekFacts, weekdayName, worldPublished, worldState, zhClockOf, zhPassOf,
} from "@/fixtures/src/site";
import { ZH_EXTRA_ENGLISH, zhOf } from "@/fixtures/src/site-text";
import { PACE_STATE_PATH, stateOutputs, weekdayPaceState } from "@/fixtures/src/state";
import { EDITIONS, EDITION_NAMES, FINDING_KEYS, REPO_ROOT, findingId, storedFinding, type FindingKey } from "@/fixtures/src/world";

// The builds read the whole world; a loaded machine can take a while.
vi.setConfig({ testTimeout: 60_000 });

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const LONELY_EN_DASH = new RegExp(`(?<!\\d)${EN_DASH}|${EN_DASH}(?!\\d)`, "u");

const config = fixtureConfig();
const SITE = "fixtures/site-content";
const EMPTY = "fixtures/empty-content";
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const nonNull = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;
const sorted = (xs: readonly string[]): string[] => [...xs].sort(byCodeUnit);

/** Every file under a folder of the repo, as paths relative to it with "/", sorted. */
function filesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel, dir), { withFileTypes: true })) {
      const p = dir === "" ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk("");
  return out.sort(byCodeUnit);
}

// ── The folder, read from disk with the schemas (never through the builder) ──────────────────────

const DATES = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"] as const;
const [MON, TUE, WED, THU, FRI, SAT, SUN] = DATES;

function load<S extends z.ZodType>(schema: S, file: string): z.output<S> {
  return schema.parse(JSON.parse(read(`${SITE}/${file}`)));
}

const FINDING_IDS = FINDING_KEYS.map((k) => findingId(k)).sort(compareFindingIds);
const F = {
  briefs: new Map<string, Brief>(DATES.map((d) => [d, load(Brief, `briefs/${d}.json`)])),
  metrics: new Map<string, MetricsFile>(DATES.map((d) => [d, load(MetricsFile, `metrics/${d}.json`)])),
  inputs: new Map<string, InputsManifest>(DATES.map((d) => [d, load(InputsManifest, `metrics/inputs/${d}.json`)])),
  status: new Map<string, StatusFile>(DATES.map((d) => [d, load(StatusFile, `status/${d}.json`)])),
  findings: new Map<string, Finding>(FINDING_IDS.map((id) => [id, load(Finding, `findings/${id}.json`)])),
  glossary: load(GlossaryFile, "glossary.json").terms as Term[],
  corrections: load(CorrectionsFile, "corrections.json").corrections as Correction[],
  reports: load(ReportsFile, "reports.json").reports as Report[],
  archive: load(ArchiveIndex, "archive-index.json"),
  pace: load(PaceWeeklyFile, "state/pace-weekly.json"),
};
const brief = (d: string): Brief => F.briefs.get(d)!;
const finding = (id: string): Finding => F.findings.get(id)!;
const findings = [...F.findings.values()];

/** The findings a brief shows as its story, its items or its deep dive, in that order. */
const shownIds = (b: Brief): string[] => [b.story?.finding_id, ...b.items.map((i) => i.finding_id), b.deep_dive?.finding_id].filter(nonNull);
/** What each stored finding is called in the plan table (the key of the world's table) and the reverse. */
const HANDLE: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(SAMPLE_FINDINGS).map(([k, v]) => [v, k]));
const ID = (key: string): string => SAMPLE_FINDINGS[key as keyof typeof SAMPLE_FINDINGS];

interface Pair {
  at: string;
  en: string;
  zh: string | null;
}

/** Every `L10n` ({ en, zh } with a string en) of a parsed record, with its path. */
function pairsOf(value: unknown, at = ""): Pair[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => pairsOf(v, `${at}[${i}]`));
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 2 && typeof o.en === "string" && "zh" in o && (o.zh === null || typeof o.zh === "string")) return [{ at, en: o.en, zh: o.zh as string | null }];
    return keys.flatMap((k) => pairsOf(o[k], at === "" ? k : `${at}.${k}`));
  }
  return [];
}

/** The findings as stored just before an edition of `date`: those briefed earlier and the seeds, each as it stood (later events rolled back). */
function storedBefore(date: string): Finding[] {
  return findings
    .filter((f) => f.history || (f.first_brief !== null && f.first_brief < date))
    .map((f) => {
      const entries = f.rung_history.filter((r) => r.recorded < date);
      const briefs = f.briefs.filter((b) => b < date);
      return { ...f, rung: entries.at(-1)!.rung, rung_history: entries, briefs, first_brief: briefs[0] ?? null };
    });
}
const correctionsBefore = (date: string): Correction[] => F.corrections.filter((c) => c.date < date);

// ── The builder and the folders ──────────────────────────────────────────────────────────────────

describe("the folders are the builder's output", () => {
  const mine = (p: string): boolean => [`${SITE}/`, `${EMPTY}/`, "fixtures/state/"].some((d) => p.startsWith(d));

  it("registers the two generators and writes no path twice or outside the owned folders", () => {
    expect(GENERATORS).toContain(siteOutputs);
    expect(GENERATORS).toContain(stateOutputs);
    const paths = allOutputs().map((o) => o.path);
    for (const o of [...siteOutputs(), ...stateOutputs()]) expect(paths, o.path).toContain(o.path);
    expect(siteOutputs().every((o) => mine(o.path))).toBe(true);
  });

  it("matches the files on disk byte for byte, with nothing missing, stale or added (what fixtures:check reads)", () => {
    const diff = compareOutputs([...siteOutputs(), ...stateOutputs()]);
    expect(diff.missing).toEqual([]);
    expect(diff.stale).toEqual([]);
    expect(diff.added.filter(mine)).toEqual([]);
  });

  it("holds exactly the files the plan calls for", () => {
    const expected = [
      ...DATES.flatMap((d) => [`briefs/${d}.json`, `metrics/${d}.json`, `metrics/inputs/${d}.json`, `status/${d}.json`]),
      ...FINDING_IDS.map((id) => `findings/${id}.json`),
      "glossary.json", "corrections.json", "reports.json", "archive-index.json", "state/pace-weekly.json",
    ];
    expect(filesUnder(SITE)).toEqual(sorted(expected));
    expect(filesUnder(EMPTY)).toEqual(["README.md"]);
    expect(filesUnder("fixtures/state")).toEqual(["pace-weekly.json"]);
    expect(siteOutputs().map((o) => o.path)).toHaveLength(expected.length + 1);
  });

  it("builds the same bytes from a fresh module graph", async () => {
    const first = [...siteOutputs(), ...stateOutputs()];
    vi.resetModules();
    const site = await import("@/fixtures/src/site");
    const state = await import("@/fixtures/src/state");
    const again = [...site.siteOutputs(), ...state.stateOutputs()];
    expect(again.map((o) => o.path)).toEqual(first.map((o) => o.path));
    again.forEach((o, i) => expect(o.text === first[i]!.text, o.path).toBe(true));
  });

  it("writes each JSON file as the schema prints it: key order, two-space indent, one trailing newline", () => {
    const schemas: readonly [RegExp, z.ZodType][] = [
      [/^briefs\//, Brief], [/^metrics\/inputs\//, InputsManifest], [/^metrics\//, MetricsFile], [/^status\//, StatusFile], [/^findings\//, Finding],
      [/^glossary\.json$/, GlossaryFile], [/^corrections\.json$/, CorrectionsFile], [/^reports\.json$/, ReportsFile], [/^archive-index\.json$/, ArchiveIndex],
      [/^state\/pace-weekly\.json$/, PaceWeeklyFile],
    ];
    for (const file of filesUnder(SITE)) {
      const schema = schemas.find(([re]) => re.test(file))?.[1];
      expect(schema, file).toBeDefined();
      const text = read(`${SITE}/${file}`);
      expect(text.endsWith("}\n") && !text.endsWith("\n\n") && !text.includes("\r"), file).toBe(true);
      expect(jsonText(schema!.parse(JSON.parse(text)), schema!), file).toBe(text);
    }
    expect(read(`${EMPTY}/README.md`)).toBe("# Empty content\n\nAn empty content folder for the site's empty states and the end-to-end tests. It holds only this file.\n");
  });

  it("names each file for what it holds: a brief by its date, a finding by its id, a status and a metrics file by their date", () => {
    for (const d of DATES) {
      expect(brief(d).date).toBe(d);
      expect(F.metrics.get(d)!.date).toBe(d);
      expect(F.inputs.get(d)!.date).toBe(d);
      expect(F.status.get(d)!.date).toBe(d);
    }
    for (const [id, f] of F.findings) expect(f.id).toBe(id);
  });

  it("keeps its sources free of em dashes, and of en dashes that do not sit between digits", () => {
    const files = ["fixtures/src/site.ts", "fixtures/src/site-text.ts", "fixtures/src/state.ts", "tests/fixtures-site.test.ts", `${EMPTY}/README.md`,
      ...filesUnder(SITE).map((f) => `${SITE}/${f}`), PACE_STATE_PATH];
    for (const f of files) {
      const text = read(f);
      expect(text.includes(EM_DASH), f).toBe(false);
      expect(LONELY_EN_DASH.test(text), f).toBe(false);
    }
  });
});

// ── The plan table, the header comment and the handles ───────────────────────────────────────────

describe("the plan table says what the stored briefs show", () => {
  it("lists the seven dates, Monday to Sunday, and the finding handles", () => {
    expect([...SAMPLE_DATES]).toEqual([...DATES]);
    expect(SAMPLE_EDITIONS.map((e) => e.date)).toEqual([...DATES]);
    expect(SAMPLE_EDITIONS.map((e) => e.weekday)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(DATES.map((d) => weekday(d))).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(DATES.map((d) => weekdayName(d))).toEqual(SAMPLE_EDITIONS.map((e) => e.weekday));
    expect(Object.keys(SAMPLE_FINDINGS)).toEqual([...FINDING_KEYS]);
    for (const k of FINDING_KEYS) expect(SAMPLE_FINDINGS[k]).toBe(findingId(k));
    expect(sorted(Object.values(SAMPLE_FINDINGS))).toEqual(sorted(FINDING_IDS));
  });

  it.each(SAMPLE_EDITIONS.map((e) => [e.date, e] as const))("%s matches its stored brief", (date, e) => {
    const b = brief(date);
    expect(b.format).toBe(e.format);
    expect(b.edition).toBe(e.edition);
    expect(b.languages).toEqual(e.languages);
    expect(e.dataOnly).toBe(b.edition === "data_only");
    expect(e.englishOnly).toBe(b.edition === "full" && !b.languages.zh);
    expect(b.lead.map((l) => l.finding_ids)).toEqual(e.lead.map((ids) => [...ids]));
    expect(b.story?.finding_id ?? null).toBe(e.story);
    expect(b.items.map((i) => i.finding_id)).toEqual([...e.items]);
    const shown = [b.story, ...b.items].filter(nonNull);
    expect(shown.filter((s) => s.new).map((s) => s.finding_id)).toEqual([...e.newFindings]);
    expect(shown.filter((s) => !s.new).map((s) => s.finding_id)).toEqual([...e.returning]);
    expect(b.rung_changes.map((c) => ({ finding: c.finding_id, from: c.from, to: c.to, by: c.by }))).toEqual(e.rungChanges.map((c) => ({ ...c })));
    expect(b.deep_dive?.finding_id ?? null).toBe(e.deepDive);
    expect(b.review === null ? null : {
      remarkable: b.review.remarkable?.finding_id ?? null, against: b.review.strongest_against.finding_ids, short: countWords(b.review.big_picture.en) <= 120,
    }).toEqual(e.review === null ? null : { remarkable: e.review.remarkable, against: [...e.review.against], short: e.review.short });
    expect(b.corrections.map((c) => c.id)).toEqual([...e.corrections]);
    expect(b.reports.map((r) => r.id)).toEqual([...e.reports]);
    expect(b.ideas).toHaveLength(e.ideas);
    expect(b.also).toHaveLength(e.also);
    expect(b.disclosure).toEqual([...e.disclosure]);
  });

  it("lists as the backlog the findings of the English-only edition, translated by the next full Chinese edition", () => {
    const englishOnly = DATES.filter((d) => brief(d).edition === "full" && !brief(d).languages.zh);
    expect(englishOnly).toEqual([TUE]);
    const next = DATES.find((d) => d > TUE && brief(d).edition === "full" && brief(d).languages.zh)!;
    const firstBriefedThen = sorted(findings.filter((f) => f.first_brief !== null && (englishOnly as readonly string[]).includes(f.first_brief)).map((f) => f.id));
    expect(firstBriefedThen).toHaveLength(4);
    for (const e of SAMPLE_EDITIONS) expect(sorted(e.backlog), e.date).toEqual(e.date === next ? firstBriefedThen : []);
    for (const id of firstBriefedThen) expect(finding(id).title.zh, id).not.toBeNull();
  });

  it("names the week's handles for the loader, the chat edition and the site", () => {
    expect([SAMPLE_WEEK.from, SAMPLE_WEEK.to]).toEqual([MON, SUN]);
    expect([...SAMPLE_WEEK.dates]).toEqual([...DATES]);
    const mon = brief(SAMPLE_WEEK.mondayShort);
    expect(mon.format).toBe("monday_review");
    expect(mon.review!.remarkable).toBeNull();
    expect(mon.review!.strongest_against.text.en).toBe(NONE_FOUND.en);
    const sun = brief(SAMPLE_WEEK.sundayDeepDive);
    expect(sun.format).toBe("sunday_deep_dive");
    expect(sun.deep_dive).not.toBeNull();
    const busy = brief(SAMPLE_WEEK.busiestDaily);
    expect(busy.format).toBe("daily");
    expect(busy.story).not.toBeNull();
    expect(busy.items.length).toBeGreaterThanOrEqual(4);
    expect(busy.items.some((i) => !i.new)).toBe(true);
    expect(busy.rung_changes.length).toBeGreaterThanOrEqual(1);
    expect(busy.corrections.length).toBeGreaterThanOrEqual(2);
    expect(busy.reports).toHaveLength(1);
    expect(busy.ideas.length).toBeGreaterThanOrEqual(2);
    expect(busy.also.length).toBeGreaterThanOrEqual(2);
    for (const d of DATES.filter((x) => brief(x).format === "daily" && brief(x).edition === "full" && x !== SAMPLE_WEEK.busiestDaily)) {
      const b = brief(d);
      expect(b.items.length + b.corrections.length + b.ideas.length + b.also.length, d).toBeLessThan(busy.items.length + busy.corrections.length + busy.ideas.length + busy.also.length);
    }
    const intake = brief(SAMPLE_WEEK.reportsFromIntake);
    expect(intake.reports).toHaveLength(1);
    expect(F.reports.find((r) => r.id === intake.reports[0]!.id)!.decided_by).toBe("jl");
    expect(intake.corrections).toEqual([]);
    const dataOnly = brief(SAMPLE_WEEK.dataOnly);
    expect(dataOnly.edition).toBe("data_only");
    expect(dataOnly.rung_changes.some((c) => c.by === "script")).toBe(true);
    for (const d of [SAMPLE_WEEK.noFindings, SAMPLE_WEEK.alsoDisclosure]) {
      const b = brief(d);
      expect(b.edition).toBe("full");
      expect(b.story).toBeNull();
      expect(b.items).toEqual([]);
      expect(b.lead).toHaveLength(1);
      expect(b.lead[0]!.finding_ids).toEqual([]);
    }
    expect(brief(SAMPLE_WEEK.noFindings).rung_changes).toHaveLength(1);
    const also = brief(SAMPLE_WEEK.alsoDisclosure);
    expect(also.also).toHaveLength(2);
    expect(also.disclosure).toEqual(["also.0"]);
    expect(/claude/i.test(also.also[0]!.title.en)).toBe(true);
    const english = brief(SAMPLE_WEEK.englishOnly);
    expect(english.edition).toBe("full");
    expect(english.languages).toEqual({ en: true, zh: false });
    expect(english.story).not.toBeNull();
    expect(sorted(SAMPLE_WEEK.reports)).toEqual(sorted(F.reports.map((r) => r.id)));
    expect(sorted(SAMPLE_WEEK.corrections)).toEqual(sorted(F.corrections.map((c) => c.id)));
    expect(sorted(SAMPLE_WEEK.seeds)).toEqual(sorted(findings.filter((f) => f.history).map((f) => f.id)));
    expect([...SEED_KEYS].map((k) => SAMPLE_FINDINGS[k])).toEqual([...SAMPLE_WEEK.seeds]);
  });

  it("begins with a header comment that lists, for each date, its weekday, kind, languages, handles, corrections, reports, ideas and Also noted lines", () => {
    const lines = read("fixtures/src/site.ts").split("\n");
    expect(lines[0]!.startsWith("// The sample content")).toBe(true);
    const code = lines.findIndex((l) => l.trim() !== "" && !l.startsWith("//"));
    const head = lines.slice(0, code);
    const dateLine = /^\/\/ {3}\d{4}-\d{2}-\d{2} /;
    for (const e of SAMPLE_EDITIONS) {
      const start = head.findIndex((l) => l.startsWith(`//   ${e.date} ${e.weekday}`));
      expect(start, e.date).toBeGreaterThan(-1);
      let end = start + 1;
      while (end < head.length && !dateLine.test(head[end]!) && head[end]!.trim() !== "//") end += 1;
      const block = head.slice(start, end).map((l) => l.replace(/^\/\/\s*/, "")).join(" ").replace(/\s+/g, " ");
      expect(block, e.date).toContain(`kind ${e.format}`);
      expect(block, e.date).toContain(e.dataOnly ? "DATA-ONLY" : "not data-only");
      expect(block, e.date).toContain(e.englishOnly ? "ENGLISH-ONLY" : "en+zh");
      const handles = [...e.lead.flat(), e.story, ...e.items, ...e.returning, ...e.rungChanges.map((c) => c.finding), e.deepDive].filter(nonNull);
      for (const id of handles) expect(block, `${e.date} ${id}`).toContain(HANDLE[id]!);
      // And each handle where the header says it is shown, not merely somewhere in the block.
      const h = (id: string): string => HANDLE[id]!;
      if (e.lead.some((g) => g.length > 0)) expect(block, `${e.date} lead`).toContain(`lead ${e.lead.map((g) => g.map(h).join(", ")).join(" | ")}`);
      else expect(block, `${e.date} lead`).toMatch(/cites nothing|lead, story and items none/);
      if (e.story !== null) expect(block, `${e.date} story`).toContain(`story ${h(e.story)}`);
      const newItems = e.items.filter((id) => !e.returning.includes(id));
      if (newItems.length > 0) expect(block, `${e.date} items`).toContain(`items ${newItems.map(h).join(", ")}`);
      for (const id of e.returning) expect(block, `${e.date} returning`).toContain(`${h(id)} (returning`);
      if (e.rungChanges.length === 0) expect(block, `${e.date} rung changes`).toContain("rung changes none");
      for (const c of e.rungChanges) expect(block, `${e.date} rung change`).toContain(`rung changes ${h(c.finding)} ${c.from} to ${c.to} (${c.by}`);
      if (e.deepDive !== null) expect(block, `${e.date} deep dive`).toContain(`deep dive ${h(e.deepDive)}`);
      for (const c of e.corrections) expect(block, e.date).toContain(c);
      for (const r of e.reports) expect(block, e.date).toContain(r);
      expect(block, e.date).toContain(`ideas ${e.ideas}`);
      expect(block, e.date).toMatch(new RegExp(`also (noted )?${e.also}\\b`));
      if (e.review !== null) expect(block, e.date).toContain(e.review.short ? "SHORT" : "review");
      if (e.disclosure.length > 0) for (const p of e.disclosure) expect(block, e.date).toContain(p);
    }
    const all = head.join("\n");
    for (const k of SEED_KEYS) expect(all, k).toContain(k);
    expect(all).toContain("old-findings problem");
  });
});

// ── What SPEC §10 P1 lists ───────────────────────────────────────────────────────────────────────

describe("the sample holds every element SPEC §10 P1 lists", () => {
  it("has seven editions from Monday to Sunday, a Monday review and a Sunday deep dive among them", () => {
    expect([...F.briefs.keys()]).toEqual([...DATES]);
    expect(DATES.map((d) => brief(d).format)).toEqual(["monday_review", "daily", "daily", "daily", "daily", "daily", "sunday_deep_dive"]);
    expect(brief(MON).review).not.toBeNull();
    expect(DATES.filter((d) => brief(d).review !== null)).toEqual([MON]);
    expect(DATES.filter((d) => brief(d).deep_dive !== null)).toEqual([SUN]);
  });

  it("has the Monday review in §4.5's short form, as no edition comes before it", () => {
    const b = brief(MON);
    const r = b.review!;
    expect(r.remarkable).toBeNull();
    expect(r.strongest_against).toEqual({ text: { ...NONE_FOUND }, finding_ids: [], source_ids: [] });
    expect(countWords(r.big_picture.en)).toBeLessThanOrEqual(120);
    expect(r.field_counts).toEqual(FIELDS.map((field) => ({ field, reported: 0, counted: 0 })));
    expect(r.fell).toEqual([]);
    expect(r.setbacks).toEqual([]);
    expect(b.disclosure).toEqual(["review"]);
    expect(r.big_picture.en).toContain("Claude");
    // The first edition: no brief is dated earlier, and nothing was briefed before it.
    expect(DATES[0]).toBe(MON);
    expect(findings.filter((f) => f.first_brief !== null && f.first_brief < MON)).toEqual([]);
    expect(findings.filter((f) => !f.history).every((f) => f.first_brief! >= MON)).toBe(true);
  });

  it("has the Sunday deep dive on a finding with news that week", () => {
    const d = brief(SUN).deep_dive!;
    expect(d.finding_id).toBe(ID("antibiotic"));
    expect(d.why_today).toBe("news");
    const f = finding(d.finding_id);
    const lo = addDays(SUN, -6);
    const news = f.rung_history.some((r) => r.by !== "seed" && r.recorded >= lo && r.recorded <= SUN)
      || f.since_then.some((s) => s.date >= lo && s.date <= SUN) || f.sources.some((s) => s.seen_as !== "seed" && s.added >= lo && s.added <= SUN);
    expect(news).toBe(true);
    expect(brief(SUN).sources.some((s) => d.source_ids.includes(s.id)) || d.source_ids.length === 0).toBe(true);
  });

  it("has an English-only day: no Chinese in its brief but the script's own lines, its findings translated by the next run", () => {
    const b = brief(TUE);
    expect(b.languages).toEqual({ en: true, zh: false });
    expect(b.edition).toBe("full");
    const withZh = pairsOf(b).filter((p) => p.zh !== null).map((p) => p.at);
    expect(withZh).toEqual(["pace.sentence", "status_note"]);
    expect(pairsOf(b).filter((p) => p.zh === null).length).toBeGreaterThan(0);
    const run = F.status.get(TUE)!.runs[0]!;
    expect(run.error_code).toBe("E_ZH");
    expect(run.zh!.outcome).toBe("failed");
    expect(run.outcome).toBe("published_full");
    expect(findings.filter((f) => f.first_brief === TUE).every((f) => f.title.zh !== null)).toBe(true);
    expect(DATES.filter((d) => d !== TUE && pairsOf(brief(d)).some((p) => p.zh === null))).toEqual([]);
  });

  it("has a data-only day: the Pace, a script rung change from a notice, and nothing else", () => {
    const b = brief(THU);
    expect(b.edition).toBe("data_only");
    expect([b.lead, b.items, b.ideas, b.also, b.sources, b.corrections]).toEqual([[], [], [], [], [], []]);
    expect([b.story, b.deep_dive, b.review]).toEqual([null, null, null]);
    expect(b.computed).toEqual({ word_count: 0, zh_chars: 0, finding_count: 0, source_count: 0 });
    expect(b.rung_changes).toHaveLength(1);
    const c = b.rung_changes[0]!;
    expect([c.finding_id, c.from, c.to, c.by]).toEqual([ID("fellW0"), "checked", "retracted", "script"]);
    const f = finding(c.finding_id);
    const entry = f.rung_history.at(-1)!;
    expect([entry.rung, entry.by, entry.recorded, entry.date]).toEqual(["retracted", "script", THU, c.date]);
    expect(f.sources.find((s) => s.id === entry.source_id)!.added).toBe(THU);
    const run = F.status.get(THU)!.runs[0]!;
    expect([run.outcome, run.error_code, run.edition]).toEqual(["published_data_only", "E_VALIDATION", "data_only"]);
    expect(b.pace.sentence.en.length).toBeGreaterThan(0);
  });

  it("has about 15 findings over all seven fields, every rung, AI role, kind and significance, and both depths", () => {
    expect(findings).toHaveLength(15);
    expect(sorted(findings.map((f) => f.field))).toEqual(sorted(findings.map((f) => f.field)));
    expect(new Set(findings.map((f) => f.field))).toEqual(new Set(FIELDS));
    expect(new Set(findings.map((f) => f.rung))).toEqual(new Set(ALL_RUNGS));
    expect(new Set(findings.map((f) => f.ai.role))).toEqual(new Set(AI_ROLES));
    expect(new Set(findings.map((f) => f.kind))).toEqual(new Set(FINDING_KINDS));
    expect(new Set(findings.map((f) => f.significance))).toEqual(new Set(SIGNIFICANCE));
    expect(new Set(findings.map((f) => f.depth))).toEqual(new Set(["story", "item"]));
    expect(new Set(findings.flatMap((f) => (f.ai.role === "none" ? [] : [f.ai.confidence])))).toEqual(new Set(["confirmed", "claimed"]));
    for (const field of FIELDS) expect(findings.filter((f) => f.field === field).length, field).toBeGreaterThanOrEqual(1);
  });

  it("has a figure with its licence, and no figure without one", () => {
    const figures = findings.filter((f) => f.figure !== null);
    expect(figures.map((f) => f.id)).toEqual([ID("scroll")]);
    const fig = figures[0]!.figure!;
    expect(fig.licence).toBe("CC-BY-4.0");
    expect(fig.licence_quote.length).toBeGreaterThan(0);
    expect(fig.credit).toContain("CC BY 4.0");
    expect(figures[0]!.sources.some((s) => s.id === fig.source_id)).toBe(true);
    expect(new URL(fig.image_url).protocol).toBe("https:");
  });

  it("has the Herculaneum scroll as one finding", () => {
    const scrolls = findings.filter((f) => /herculaneum|scroll/i.test(f.title.en) || /herculaneum/i.test(f.explainer.found.en));
    expect(scrolls.map((f) => f.id)).toEqual([ID("scroll")]);
    const f = scrolls[0]!;
    expect([f.field, f.subfield, f.kind, f.significance, f.depth]).toEqual(["humanities", "ancient-texts", "result", "landmark", "story"]);
    expect(f.terms).toContain("papyrus");
    expect(f.terms).toContain("virtual-unwrapping");
    expect(/herculaneum/i.test(JSON.stringify(f.explainer))).toBe(true);
    expect(f.title.en.startsWith("SAMPLE")).toBe(true);
    expect(brief(WED).story!.finding_id).toBe(f.id);
  });

  it("has corrections (one that answers a reader report) and two reports, and a glossary with Chinese", () => {
    expect(F.corrections.map((c) => c.id)).toEqual(["C-0001", "C-0002"]);
    expect(F.corrections.every((c) => c.type !== "removed" && c.finding_id !== null)).toBe(true);
    expect(F.corrections.filter((c) => c.trigger === "reader_report" && c.report_id !== null).length).toBeGreaterThanOrEqual(1);
    expect(F.reports.map((r) => r.id)).toEqual(["R-0001", "R-0002"]);
    expect(new Set(F.reports.map((r) => r.decided_by))).toEqual(new Set(["jl", "claude"]));
    expect(F.glossary.length).toBeGreaterThanOrEqual(5);
    for (const t of F.glossary) {
      expect(t.zh, t.id).not.toBeNull();
      expect(t.zh!.term.length, t.id).toBeGreaterThan(0);
      expect(t.zh!.definition.length, t.id).toBeGreaterThan(0);
    }
    expect(F.glossary.filter((t) => t.zh!.official !== null).length).toBeGreaterThanOrEqual(1);
    expect(F.glossary.filter((t) => t.zh!.official === null).length).toBeGreaterThanOrEqual(1);
  });

  it("has corrections of text the sample's two reports are about, which stays as published", () => {
    for (const c of F.corrections) {
      const f = finding(c.finding_id!);
      const at = c.path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], f) as { en: string; zh: string | null };
      expect(c.before).toEqual(at);
      expect(c.after.en).not.toBe(c.before.en);
      expect(c.date > f.first_brief!).toBe(true);
    }
  });
});

// ── References, dates and counts ─────────────────────────────────────────────────────────────────

describe("every reference between the files resolves", () => {
  it("makes each brief name only findings, corrections, reports and sources that exist and say the same", () => {
    for (const d of DATES) {
      const b = brief(d);
      const named = [
        ...b.lead.flatMap((l) => l.finding_ids), ...shownIds(b), ...b.rung_changes.map((c) => c.finding_id),
        ...(b.review === null ? [] : [b.review.remarkable?.finding_id, ...b.review.strongest_against.finding_ids, ...b.review.fell, ...b.review.setbacks].filter(nonNull)),
      ];
      for (const id of named) expect(F.findings.has(id), `${d} ${id}`).toBe(true);
      for (const c of b.corrections) {
        const stored = F.corrections.find((x) => x.id === c.id)!;
        expect(stored, `${d} ${c.id}`).toBeDefined();
        expect([stored.date, stored.finding_id, stored.edition_date, stored.term_id, stored.type, stored.reason]).toEqual([d, c.finding_id, c.edition_date, c.term_id, c.type, c.reason]);
      }
      expect(b.corrections.map((c) => c.id), d).toEqual(F.corrections.filter((c) => c.date === d).map((c) => c.id));
      for (const r of b.reports) {
        const stored = F.reports.find((x) => x.id === r.id)!;
        expect([stored.resolved_on, stored.finding_id, stored.status], `${d} ${r.id}`).toEqual([d, r.finding_id, r.status]);
      }
      expect(b.reports.map((r) => r.id), d).toEqual(F.reports.filter((r) => r.resolved_on === d).map((r) => r.id));
      const sourceIds = new Set(b.sources.map((s) => s.id));
      const cited = [
        ...b.ideas.map((i) => i.source_id), ...b.also.map((a) => a.source_id), ...(b.deep_dive?.source_ids ?? []), ...(b.review?.strongest_against.source_ids ?? []),
      ];
      for (const sid of cited) expect(sourceIds.has(sid), `${d} ${sid}`).toBe(true);
      expect(b.sources.map((s) => s.id), d).toEqual(b.sources.map((_, i) => `b${i + 1}`));
      // A brief source is cited by a line of the brief, or joined to the finding whose rung change it backs.
      for (const s of b.sources) {
        const joined = findings.some((f) => f.sources.some((x) => normalizeUrl(x.url) === normalizeUrl(s.url) && x.added === d));
        expect(cited.includes(s.id) || joined, `${d} ${s.id}`).toBe(true);
        expect([s.seen_as === "seed", s.added]).toEqual([false, d]);
      }
    }
  });

  it("makes each rung change the brief lists a rung entry of its finding, recorded that day by the same hand", () => {
    for (const d of DATES) {
      for (const c of brief(d).rung_changes) {
        const f = finding(c.finding_id);
        const i = f.rung_history.findIndex((r) => r.recorded === d && r.rung === c.to && r.date === c.date && r.by === c.by);
        expect(i, `${d} ${c.finding_id}`).toBeGreaterThan(0);
        expect(f.rung_history[i - 1]!.rung).toBe(c.from);
      }
      const entries = findings.flatMap((f) => f.rung_history.map((r, i) => ({ f, r, i }))).filter(({ r, i }) => i > 0 && r.recorded === d && r.by !== "seed");
      expect(entries.length, d).toBeGreaterThanOrEqual(brief(d).rung_changes.length);
    }
    // A rung entry that no brief lists is the rung of a finding the edition shows as new, as first briefed.
    for (const f of findings) {
      f.rung_history.forEach((r, i) => {
        if (i === 0 || r.by === "seed") return;
        const listed = brief(r.recorded).rung_changes.some((c) => c.finding_id === f.id && c.to === r.rung);
        const shownNew = f.first_brief === r.recorded;
        const returning = brief(r.recorded).items.some((x) => x.finding_id === f.id && !x.new);
        expect(listed || shownNew || returning, `${f.id} ${i}`).toBe(true);
      });
    }
  });

  it("makes each finding's rung, rung entries, sources, source ids and related findings agree", () => {
    for (const f of findings) {
      expect(f.rung, f.id).toBe(f.rung_history.at(-1)!.rung);
      expect(f.sources.map((s) => s.id), f.id).toEqual(f.sources.map((_, i) => `s${i + 1}`));
      const own = new Set(f.sources.map((s) => s.id));
      for (const r of f.rung_history) expect(own.has(r.source_id), `${f.id} ${r.source_id}`).toBe(true);
      for (const s of f.since_then) for (const sid of s.source_ids) expect(own.has(sid), `${f.id} ${sid}`).toBe(true);
      if (f.figure !== null) expect(own.has(f.figure.source_id), f.id).toBe(true);
      for (const id of f.related) expect(F.findings.has(id) && id !== f.id, `${f.id} ${id}`).toBe(true);
      const recorded = f.rung_history.map((r) => r.recorded);
      expect(recorded, f.id).toEqual([...recorded].sort(byCodeUnit));
      expect(f.disclosure, f.id).toBe(findingMentionsAnthropic(f));
      expect(f.applications, f.id).toEqual([]);
      expect(f.id.startsWith({ mathematics: "math", physics: "phys", chemistry: "chem", biology: "bio", earth: "earth", social: "soc", humanities: "hum" }[f.field]!)).toBe(true);
    }
  });

  it("makes each finding's briefs the editions that show it, `first_brief` the first, and the seeds the findings no edition showed when seeded", () => {
    for (const f of findings) {
      const shown = DATES.filter((d) => shownIds(brief(d)).includes(f.id));
      expect(f.briefs, f.id).toEqual(shown);
      expect(f.first_brief, f.id).toBe(shown[0] ?? null);
      if (f.history) {
        expect(f.rung_history[0]!.by, f.id).toBe("seed");
        expect(f.sources[0]!.seen_as, f.id).toBe("seed");
      } else {
        expect(f.first_brief, f.id).not.toBeNull();
        expect(f.rung_history[0]!.by, f.id).toBe("agent");
        expect(f.rung_history[0]!.recorded, f.id).toBe(f.first_brief);
        expect(f.sources.every((s) => s.seen_as !== "seed"), f.id).toBe(true);
        expect(f.sources[0]!.added, f.id).toBe(f.first_brief);
      }
    }
    expect(sorted(findings.filter((f) => f.history).map((f) => f.id))).toEqual(sorted(SAMPLE_WEEK.seeds));
    expect(findings.filter((f) => f.history && f.briefs.length === 0).map((f) => f.id).sort()).toEqual(sorted([ID("disputedOld"), ID("fellW0")]));
  });

  it("dates `updated` at the last edition that changed the file: shown, a rung entry, a note, a source or a Chinese backlog", () => {
    const translatedOn = (f: Finding): string | null => {
      const first = f.first_brief === null ? undefined : brief(f.first_brief);
      if (first === undefined || first.languages.zh) return null;
      return DATES.find((d) => d > f.first_brief! && brief(d).edition === "full" && brief(d).languages.zh) ?? null;
    };
    for (const f of findings) {
      const dates = [
        f.history ? SEEDED : f.first_brief, ...f.briefs, ...f.rung_history.filter((r) => r.by !== "seed").map((r) => r.recorded), ...f.since_then.map((s) => s.date),
        ...f.sources.filter((s) => s.seen_as !== "seed").map((s) => s.added), translatedOn(f),
      ].filter(nonNull);
      expect(f.updated, f.id).toBe(dates.sort(byCodeUnit).at(-1));
    }
  });

  it("makes each term used by a finding, listed once, first used by a finding that uses it, on the day that finding was written", () => {
    expect(F.glossary.map((t) => t.id)).toEqual(sorted(F.glossary.map((t) => t.id)));
    for (const f of findings) for (const id of f.terms) expect(F.glossary.some((t) => t.id === id), `${f.id} ${id}`).toBe(true);
    for (const t of F.glossary) {
      const first = finding(t.first_finding);
      expect(first.terms, t.id).toContain(t.id);
      expect(t.fields, t.id).toContain(first.field);
      expect(t.first_date, t.id).toBe(first.sources.map((s) => s.added).sort(byCodeUnit)[0]);
      expect(findings.some((f) => f.terms.includes(t.id)), t.id).toBe(true);
      const users = findings.filter((f) => f.terms.includes(t.id));
      expect(users.every((f) => (f.history ? SEEDED : f.first_brief!) >= t.first_date || f.id === t.first_finding), t.id).toBe(true);
    }
  });

  it("makes each correction restate the stored text as `before`, name a report both ways when it answers one, and file after the finding was briefed", () => {
    expect(F.corrections.map((c) => c.id)).toEqual(F.corrections.map((_, i) => `C-${String(i + 1).padStart(4, "0")}`));
    for (const c of F.corrections) {
      const f = finding(c.finding_id!);
      expect(c.edition_date).toBeNull();
      expect(c.term_id).toBeNull();
      expect(brief(c.date).corrections.map((x) => x.id)).toContain(c.id);
      expect(c.date > f.first_brief!).toBe(true);
      expect(c.trigger === "reader_report", c.id).toBe(c.report_id !== null);
      if (c.report_id !== null) {
        const r = F.reports.find((x) => x.id === c.report_id)!;
        expect([r.correction_id, r.finding_id, r.status], c.id).toEqual([c.id, c.finding_id, "upheld"]);
      }
      expect(pairsOf([c.before, c.after, c.reason]).every((p) => p.zh !== null), c.id).toBe(true);
    }
  });

  it("makes each report follow its finding's first edition, and agree with the correction and the brief that closed it", () => {
    expect(F.reports.map((r) => r.id)).toEqual(["R-0001", "R-0002"]);
    expect(new Set(F.reports.map((r) => r.issue_number)).size).toBe(F.reports.length);
    for (const r of F.reports) {
      const f = finding(r.finding_id);
      expect(r.received > brief(f.first_brief!).published_at, r.id).toBe(true);
      expect(r.status, r.id).toBe("upheld");
      expect(r.resolved_on! > r.received.slice(0, 10), r.id).toBe(true);
      expect(brief(r.resolved_on!).reports.map((x) => x.id), r.id).toContain(r.id);
      const c = F.corrections.find((x) => x.id === r.correction_id)!;
      expect([c.report_id, c.finding_id], r.id).toEqual([r.id, r.finding_id]);
      expect(c.date >= r.resolved_on!, r.id).toBe(true);
      if (r.decided_by === "jl") expect(r.reason).toBeNull();
      else expect(r.reason).not.toBeNull();
      expect(["fact", "source", "rung", "link", "dangerous"]).toContain(r.kind);
      expect(r.evidence_url === null || r.evidence_url.startsWith("https://"), r.id).toBe(true);
    }
  });

  it("indexes every cited URL once, with its refs, its first citation and its link check, and every edition newest first", () => {
    const expected = new Map<string, { first: string; refs: Set<string> }>();
    const cite = (url: string, added: string, ref: string): void => {
      const key = normalizeUrl(url);
      const e = expected.get(key) ?? { first: added, refs: new Set<string>() };
      if (added < e.first) e.first = added;
      e.refs.add(ref);
      expected.set(key, e);
    };
    for (const f of findings) for (const s of f.sources) cite(s.url, s.added, f.id);
    for (const d of DATES) for (const s of brief(d).sources) cite(s.url, s.added, `${d}/brief`);
    expect(Object.keys(F.archive.urls)).toEqual(sorted([...expected.keys()]));
    // Every run of the week checked the URLs it first cited, the data-only run's included; the seeds' URLs were first cited by no run of the week.
    const week = new Set<string>(DATES);
    for (const [url, e] of expected) {
      const u = F.archive.urls[url]!;
      expect(u.first_cited, url).toBe(e.first);
      // Finding ids first, in the order publish gave them, then each `D/brief` (SPEC §4.10; compareFindingIds() puts what is no finding id last).
      expect(u.refs, url).toEqual([...e.refs].sort(compareFindingIds));
      expect(u.refs, url).toEqual([...u.refs.filter((r) => !r.endsWith("/brief")), ...u.refs.filter((r) => r.endsWith("/brief"))]);
      expect([u.sha256, u.hashed_at], url).toEqual([null, null]);
      expect(u.last_check, url).toEqual(week.has(e.first) ? { date: e.first, result: "ok", http: 200 } : null);
    }
    expect(F.archive.editions.map((e) => e.date)).toEqual([...DATES].reverse());
    for (const e of F.archive.editions) {
      const b = brief(e.date);
      expect(e, e.date).toEqual({
        date: e.date, edition: b.edition, published_at: b.published_at, finding_count: (b.story === null ? 0 : 1) + b.items.length,
        corrected: F.corrections.some((c) => c.edition_date === e.date),
      });
    }
  });
});

describe("the briefs, the status records and the metrics agree with each other", () => {
  it("counts each brief's words, characters, findings and sources as the brief shows them", () => {
    for (const d of DATES.filter((x) => brief(x).edition === "full")) {
      const b = brief(d);
      expect(b.computed.finding_count, d).toBe((b.story === null ? 0 : 1) + b.items.length);
      expect(b.computed.zh_chars === null, d).toBe(!b.languages.zh);
      expect(b.computed.word_count > 0, d).toBe(b.story !== null || b.lead.length > 0);
      const newOnes = findings.filter((f) => f.first_brief === d && !f.history);
      expect(b.computed.source_count, d).toBe(b.sources.length + newOnes.reduce((n, f) => n + f.sources.filter((s) => s.added === d).length, 0));
      expect(b.provenance.code_commit, d).toBe(SAMPLE_COMMIT);
      expect(b.provenance.code_commit).toMatch(/^[0-9a-f]{40}$/);
      expect(b.provenance.data_cutoff, d).toBe(lastSunday(dataCutoffFor(d)));
      expect(b.provenance.run_id, d).toMatch(/^\d{8}-\d{6}$/);
      expect(b.late).toBe(false);
    }
  });

  it("counts each brief's page words and Chinese characters as the validator's own page total does (WORDS, ZH_CHARS)", () => {
    for (const d of DATES) {
      const b = brief(d);
      const input = buildPublishedInput(b, { findings, terms: F.glossary, corrections: F.corrections, reports: F.reports }, { config, publishing: d });
      const page = pageProseOf(input);
      expect(b.computed.word_count, d).toBe(page.reduce((n, e) => n + countWords(e.text), 0));
      // The Chinese twin of each page string is the same record and place in Chinese; an English-only edition counts none (its `zh_chars` is null).
      const place = (e: { readonly record: unknown; readonly at: string }): string => `${JSON.stringify(e.record)}|${e.at}`;
      const shown = new Set(page.map(place));
      const twins = input.inventory.entries.filter((e) => e.lang === "zh" && e.kind === "prose" && !e.removed && shown.has(place(e)));
      if (b.languages.zh) expect(b.computed.zh_chars, d).toBe(twins.reduce((n, e) => n + countZhChars(e.text), 0));
      else expect(b.computed.zh_chars, d).toBeNull();
    }
  });

  it("keeps the run's clock inside the spec's good-output window, the data-only edition first", () => {
    for (const d of DATES) {
      const b = brief(d);
      const run = F.status.get(d)!.runs[0]!;
      expect(b.published_at.startsWith(d), d).toBe(true);
      expect(b.published_at.endsWith("+08:00"), d).toBe(true);
      expect(run.data_only_published_at! <= `${d}T03:35:00+08:00`, d).toBe(true);
      expect(run.started_at >= `${d}T03:15:00+08:00`, d).toBe(true);
      expect(run.finished_at! <= `${d}T04:25:00+08:00`, d).toBe(true);
      if (b.edition === "full") {
        expect(b.published_at <= `${d}T04:15:00+08:00`, d).toBe(true);
        expect(b.published_at > run.data_only_published_at!, d).toBe(true);
        expect(run.full_published_at, d).toBe(b.published_at);
      } else {
        expect(b.published_at, d).toBe(run.data_only_published_at);
        expect(run.full_published_at, d).toBeNull();
      }
    }
  });

  it("names each run by its Taipei start time (SPEC §4.8: run_id is YYYYMMDD-HHMMSS), and starts the week's runs a few seconds apart", () => {
    const ids = new Set<string>();
    for (const d of DATES) {
      const run = F.status.get(d)!.runs[0]!;
      const started = run.started_at.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/)!;
      expect(started, d).not.toBeNull();
      expect(run.run_id, d).toBe(`${started[1]}${started[2]}${started[3]}-${started[4]}${started[5]}${started[6]}`);
      expect(run.run_id.slice(0, 8), d).toBe(d.replaceAll("-", ""));
      expect(brief(d).provenance.run_id, d).toBe(run.run_id);
      ids.add(run.run_id);
    }
    expect(ids.size).toBe(DATES.length);
    // The world's own valid drafts, published alone, start at the first morning's time.
    expect(worldPublished("weekday").brief.provenance.run_id).toBe("20261014-031502");
  });

  it("describes each run the way its brief and the rest of the folder say it went", () => {
    const firstCited = (d: string): number => Object.values(F.archive.urls).filter((u) => u.first_cited === d).length;
    for (const d of DATES) {
      const b = brief(d);
      const s = F.status.get(d)!;
      expect(s.runs, d).toHaveLength(1);
      const run = s.runs[0]!;
      const dataOnly = b.edition === "data_only";
      expect(run.run_id, d).toBe(b.provenance.run_id);
      expect(run.code_commit, d).toBe(b.provenance.code_commit);
      expect(run.edition, d).toBe(b.edition);
      // `late` is a brief published after `schedule.stale_after` (SPEC §4.4), the data-only edition's too, and the run record says the same.
      expect(b.late, d).toBe(b.published_at.slice(11, 16) > config.run.schedule.stale_after);
      expect(run.late, d).toBe(b.late);
      expect(b.late, d).toBe(false);
      expect(run.outcome, d).toBe(dataOnly ? "published_data_only" : "published_full");
      expect(run.error_code, d).toBe(({ [TUE]: "E_ZH", [THU]: "E_VALIDATION" } as Record<string, string>)[d] ?? null);
      expect(run.stages.map((x) => x.id), d).toEqual([...RUN_STAGES]);
      const stage = (id: string) => run.stages.find((x) => x.id === id)!;
      // E_VALIDATION fails the validate stage (SPEC §8.2 stage 7), after the agent has drafted; the data-only edition stands, so the Chinese pass and
      // the full publish never run, and the deploy wait and the link check still run on the data-only edition.
      expect(stage("draft").status, d).toBe("ok");
      expect(stage("validate").status, d).toBe(dataOnly ? "failed" : "ok");
      expect(stage("zh").status, d).toBe(dataOnly ? "skipped" : d === TUE ? "failed" : "ok");
      expect(stage("publish").status, d).toBe(dataOnly ? "skipped" : "ok");
      expect(stage("deploy").status, d).toBe("ok");
      expect(stage("links").status, d).toBe("ok");
      expect(run.feeds.map((f) => f.id), d).toEqual(config.sources.feeds.map((f) => f.id));
      expect(run.pace_status, d).toBe(F.metrics.get(d)!.status);
      expect(run.deploy, d).toMatchObject({ triggered: true, shows_date: d, shows_edition: b.edition });
      // The validation record counts the errors of the last check: a failed morning has some, each code is one of them, and a clean one has none.
      expect(run.validation!.codes, d).toEqual([...new Set(run.validation!.codes)]);
      expect(run.validation!.errors >= run.validation!.codes.length, d).toBe(true);
      expect(run.validation!.errors > 0, d).toBe(dataOnly);
      expect(run.soft_gates === null, d).toBe(dataOnly);
      expect(run.recheck!.rung_changes, d).toBe(b.rung_changes.filter((c) => c.by === "script").length);
      expect(run.recheck!.reports_decided, d).toBe(b.reports.length);
      expect(run.recheck!.reports_new, d).toBe(F.reports.filter((r) => r.received.slice(0, 10) === addDays(d, -1)).length);
      expect(run.recheck!.findings_checked, d).toBe(storedBefore(d).length);
      expect(run.links, d).not.toBeNull();
      expect([run.links!.checked, run.links!.ok, run.links!.unknown, run.links!.broken], d).toEqual([firstCited(d), firstCited(d), 0, []]);
      expect(run.zh!.outcome, d).toBe(dataOnly ? "not_run" : d === TUE ? "failed" : "ok");
      expect(run.zh!.backlog, d).toBe(SAMPLE_EDITIONS.find((e) => e.date === d)!.backlog.length);
    }
  });

  /** The seconds since midnight of a Taipei timestamp. */
  const secondsOfDay = (ts: string): number => {
    const [h, m, s] = ts.slice(11, 19).split(":").map(Number) as [number, number, number];
    return h * 3600 + m * 60 + s;
  };
  const hhmm = (v: string): number => {
    const [h, m] = v.split(":").map(Number) as [number, number];
    return h * 3600 + m * 60;
  };

  it("runs the stages one after the other, each starting where the one before ended, and puts every dated fact of the run on its stage", () => {
    for (const d of DATES) {
      const run = F.status.get(d)!.runs[0]!;
      const b = brief(d);
      const timed = run.stages.filter((x) => x.started_at !== null);
      expect(run.stages.every((x) => (x.started_at === null) === (x.ended_at === null) && (x.status === "skipped") === (x.started_at === null)), d).toBe(true);
      expect(run.started_at, d).toBe(run.stages[0]!.started_at);
      timed.forEach((x, k) => {
        expect(secondsOfDay(x.ended_at!) >= secondsOfDay(x.started_at!), `${d} ${x.id}`).toBe(true);
        if (k > 0) expect(x.started_at, `${d} ${x.id} starts when ${timed[k - 1]!.id} ended`).toBe(timed[k - 1]!.ended_at);
      });
      expect(run.finished_at! >= timed.at(-1)!.ended_at!, d).toBe(true);
      const stage = (id: string) => run.stages.find((x) => x.id === id)!;
      expect(run.data_only_published_at, d).toBe(stage("data_only").ended_at);
      if (b.edition === "full") expect(run.full_published_at, d).toBe(stage("publish").ended_at);
      expect(run.deploy.ready_at, d).toBe(stage("deploy").ended_at);
      expect(run.links!.checked_at, d).toBe(stage("links").ended_at);
      expect(run.feeds.every((f) => f.checked_at >= stage("collect").started_at! && f.checked_at <= stage("collect").ended_at!), d).toBe(true);
      const m = F.metrics.get(d)!;
      expect(m.computed_at >= stage("metrics").started_at! && m.computed_at <= stage("metrics").ended_at!, d).toBe(true);
    }
  });

  it("keeps every run inside SPEC §8.2's clock rules: the agent's attempt, the retry cutoff, the Chinese pass and the hard stop", () => {
    const clock = config.run.schedule;
    for (const d of DATES) {
      const run = F.status.get(d)!.runs[0]!;
      const stage = (id: string) => run.stages.find((x) => x.id === id)!;
      const draft = stage("draft");
      const draftSeconds = secondsOfDay(draft.ended_at!) - secondsOfDay(draft.started_at!);
      // Attempt 1 gets min(agent_minutes, zh_start_by - now - repair_rounds x 6 min - 4 min) from the moment the draft stage starts.
      const attempt1 = Math.min(config.run.budgets.agent_minutes * 60, hhmm(clock.zh_start_by) - secondsOfDay(draft.started_at!) - config.run.budgets.repair_rounds * 360 - 240);
      expect(draftSeconds <= attempt1, `${d} attempt 1`).toBe(true);
      expect(run.budgets.repair_rounds <= config.run.budgets.repair_rounds, d).toBe(true);
      expect(run.attempt, d).toBe(1);
      expect(secondsOfDay(run.finished_at!) <= hhmm(clock.hard_stop), d).toBe(true);
      const zh = stage("zh");
      if (zh.started_at !== null) {
        expect(secondsOfDay(zh.started_at) <= hhmm(clock.zh_start_by), d).toBe(true);
        expect(secondsOfDay(zh.ended_at!) - secondsOfDay(zh.started_at) <= config.run.budgets.zh_minutes * 60, d).toBe(true);
        expect(run.budgets.zh_agent_seconds <= secondsOfDay(zh.ended_at!) - secondsOfDay(zh.started_at), d).toBe(true);
      } else {
        expect(run.budgets.zh_agent_seconds, d).toBe(0);
      }
      // The agent's seconds fit in the draft stage and the validate stage's repairs; with no repair they fit in the draft stage alone.
      const validate = stage("validate");
      const room = draftSeconds + (run.budgets.repair_rounds > 0 ? secondsOfDay(validate.ended_at!) - secondsOfDay(validate.started_at!) : 0);
      expect(run.budgets.agent_seconds <= room, `${d} agent seconds`).toBe(true);
      expect(run.budgets.agent_seconds >= draftSeconds - 10, `${d} agent seconds`).toBe(true);
    }
    // The failed day: the retry cutoff had passed when validation failed, so there was no second attempt, and the run ended inside the hard stop.
    const failed = F.status.get(THU)!.runs[0]!;
    expect(secondsOfDay(failed.stages.find((x) => x.id === "validate")!.ended_at!) > hhmm(clock.retry_cutoff)).toBe(true);
    expect(failed.budgets.repair_rounds).toBe(config.run.budgets.repair_rounds);
  });

  it("makes the Chinese pass, the run record and the brief tell one story: the pass starts two minutes after the English draft and ends before publish", () => {
    const sample = buildSample();
    for (const day of sample.days) {
      const run = F.status.get(day.date)!.runs[0]!;
      const draft = sample.drafts[day.date];
      if (draft === null) continue;
      const clockOf = zhClockOf(draft);
      const stage = (id: string) => run.stages.find((x) => x.id === id)!;
      expect(Date.parse(stage("zh").started_at!), day.date).toBe(Date.parse(draft.generated_at) + 120_000);
      expect(Date.parse(stage("zh").started_at!), day.date).toBe(clockOf.contextAt);
      if (day.zh === null) {
        // The English-only day: the pass ran to its deadline and failed.
        expect(day.date).toBe(TUE);
        expect(stage("zh").ended_at, day.date).toBe(clockOf.deadline);
      } else {
        expect(day.zh.context.deadline, day.date).toBe(clockOf.deadline);
        expect(day.zh.draft.generated_at, day.date).toBe(clockOf.generatedAt);
        expect(Date.parse(day.zh.draft.generated_at) - Date.parse(stage("zh").started_at!), day.date).toBe(9 * 60_000);
        expect(Date.parse(stage("zh").ended_at!) >= Date.parse(day.zh.draft.generated_at), day.date).toBe(true);
        expect(run.budgets.zh_agent_seconds, day.date).toBe(9 * 60);
      }
      expect(day.brief.published_at > stage("zh").ended_at!, day.date).toBe(true);
      expect(Date.parse(stage("validate").started_at!), day.date).toBeGreaterThanOrEqual(Date.parse(draft.generated_at));
    }
  });

  it("carries the Monday's counter requests on the other days, and puts each request of the day inside the metrics stage, one after another", () => {
    for (const d of DATES) {
      const i = F.inputs.get(d)!;
      const m = F.metrics.get(d)!;
      const run = F.status.get(d)!.runs[0]!;
      const stage = run.stages.find((x) => x.id === "metrics")!;
      const times = i.openalex.map((o) => o.fetched_at);
      expect([...times].sort(), d).toEqual(times);
      expect(new Set(times).size, d).toBe(times.length);
      expect(times.every((t) => t >= stage.started_at! && t <= stage.ended_at!), d).toBe(true);
      const monday = addDays(d, -((weekday(d) + 6) % 7));
      for (const c of i.counters) {
        const reading = m.counters.find((x) => x.id === c.id)!;
        for (const r of c.requests) {
          // The reading was fetched on the Monday its `as_of` names, at a time inside that morning's metrics stage; the other days carry it.
          expect(r.fetched_at.slice(0, 10), `${d} ${c.id}`).toBe(monday);
          expect(r.fetched_at.slice(0, 10), `${d} ${c.id}`).toBe(reading.as_of);
          expect(secondsOfDay(r.fetched_at) > secondsOfDay(times.at(-1)!) || d !== monday, `${d} ${c.id}`).toBe(true);
          const mondayStage = F.status.get(monday)!.runs[0]!.stages.find((x) => x.id === "metrics")!;
          expect(r.fetched_at >= mondayStage.started_at! && r.fetched_at <= mondayStage.ended_at!, `${d} ${c.id}`).toBe(true);
          expect(r.url, `${d} ${c.id}`).toBe(reading.source_url);
          // The same request is in every day's manifest: one URL, one time, one hash for the week.
          expect(r, `${d} ${c.id}`).toEqual(F.inputs.get(monday)!.counters.find((x) => x.id === c.id)!.requests[0]);
        }
      }
    }
  });

  it("counts the rung proposals the re-check sent: the weekday's context holds one, no other day's is known", () => {
    for (const d of DATES) {
      expect(F.status.get(d)!.runs[0]!.recheck!.proposals, d).toBe(d === WED ? editionContext("weekday").rung_proposals.length : 0);
    }
    expect(editionContext("weekday").rung_proposals).toHaveLength(1);
  });

  it("puts the English repairs on the failed day only: the English-only day's repair was the Chinese pass's", () => {
    for (const d of DATES) {
      const run = F.status.get(d)!.runs[0]!;
      expect(run.budgets.repair_rounds, d).toBe(d === THU ? 2 : 0);
      expect(run.zh!.repair_rounds, d).toBe(d === TUE ? 1 : 0);
    }
  });

  it("dates each metrics file and manifest to its edition's data cutoff, with the versions of the config", () => {
    for (const d of DATES) {
      const m = F.metrics.get(d)!;
      const i = F.inputs.get(d)!;
      expect(m.data_cutoff, d).toBe(lastSunday(dataCutoffFor(d)));
      expect(m.status, d).toBe("ok");
      expect([i.data_cutoff, i.computed_at, i.versions], d).toEqual([m.data_cutoff, m.computed_at, m.versions]);
      expect(m.versions, d).toEqual(config.versions);
      expect(m.computed_at.startsWith(d), d).toBe(true);
      expect(brief(d).pace.metrics_file, d).toBe(`metrics/${d}.json`);
      expect(brief(d).pace.sentence, d).toEqual(m.pace.sentence);
      expect(brief(d).pace.status, d).toBe(m.status);
      expect(m.counters.map((c) => c.id), d).toEqual(i.counters.map((c) => c.id));
      // The manifest lists what the morning fetched: the newest 8 weeks (provisional) and the newest firm one, four group-by requests each.
      const newestMonday = addDays(m.data_cutoff, -6);
      const weeks = Array.from({ length: 9 }, (_, k) => addDays(newestMonday, -7 * (8 - k)));
      expect(i.openalex.map((o) => o.week_start), d).toEqual(weeks.flatMap((w) => [w, w, w, w]));
      expect(i.openalex.map((o) => o.request), d).toEqual(weeks.flatMap(() => ["leading_total", "leading_ai", "all_total", "all_ai"]));
      for (const o of i.openalex) {
        expect(o.sha256, d).toMatch(/^[0-9a-f]{64}$/);
        expect(Object.keys(o.counts), d).toEqual([...FIELDS]);
        expect(o.url.startsWith("https://api.openalex.org/works?"), d).toBe(true);
        expect(o.url, d).toContain(`from_publication_date:${o.week_start}`);
        expect(o.url, d).not.toMatch(/api_key|mailto/);
      }
      for (const c of i.counters) {
        const reading = m.counters.find((x) => x.id === c.id)!;
        expect(c.value, `${d} ${c.id}`).toBe(reading.value);
        expect(c.requests.length, `${d} ${c.id}`).toBe(reading.kind === "api" && reading.status === "ok" ? 1 : 0);
      }
    }
  });
});

describe("the Pace's C and D are what lib/metrics/ledger-stats.ts computes from the findings before each edition", () => {
  it.each(DATES.map((d) => [d] as const))("%s", (d) => {
    const before = storedBefore(d);
    const corrections = correctionsBefore(d);
    const m = F.metrics.get(d)!;
    const i = F.inputs.get(d)!;
    const c = landmarkCounts(before, corrections, d);
    expect(m.landmarks).toEqual(c.landmarks);
    expect(i.landmark_ids).toEqual(c.ids);
    const h = holdRate(before, corrections, d, { min_cases: config.run.pace.min_cases, hold_after_days: config.run.pace.hold_after_days });
    expect(m.hold).toEqual(h.hold);
    expect(i.hold_case_ids).toEqual(h.case_ids);
  });

  it("holds the numbers the week's own Landmarks give: the tiling proof from Wednesday, the scroll from Thursday, no Hold case yet", () => {
    const row = (d: string) => F.metrics.get(d)!.landmarks.by_year.find((y) => y.year === 2026)!;
    expect([MON, TUE].map((d) => row(d))).toEqual([{ year: 2026, ai: 0, all: 0 }, { year: 2026, ai: 0, all: 0 }]);
    expect(row(WED)).toEqual({ year: 2026, ai: 0, all: 1 });
    for (const d of [THU, FRI, SAT, SUN]) expect(row(d), d).toEqual({ year: 2026, ai: 1, all: 2 });
    expect(F.inputs.get(WED)!.landmark_ids).toEqual([ID("tilings")]);
    expect(F.inputs.get(THU)!.landmark_ids).toEqual([ID("tilings"), ID("scroll")].sort(compareFindingIds));
    for (const d of DATES) {
      const m = F.metrics.get(d)!;
      expect(m.landmarks.by_year.map((y) => y.year), d).toEqual(Array.from({ length: 12 }, (_, k) => 2015 + k));
      expect(m.hold, d).toEqual({ cases: 0, held: 0, fell: 0, open: 0, too_few: true });
      expect(F.inputs.get(d)!.hold_case_ids, d).toEqual([]);
    }
  });

  it("counts the ancient-texts counter from the scroll finding once it is stored", () => {
    const counter = (d: string) => F.metrics.get(d)!.counters.find((c) => c.id === "ancient_texts_ai")!;
    expect(counter(MON).kind).toBe("ledger");
    expect(counter(MON).value).toBe(0);
    expect(counter(SUN).value).toBe(1);
  });

  it("keeps the weekly Pace state of the folder and of fixtures/state to the same weeks, counts and versions, and differing only in their dates", () => {
    const state = PaceWeeklyFile.parse(JSON.parse(read(PACE_STATE_PATH)));
    expect(read(PACE_STATE_PATH)).toBe(jsonText(weekdayPaceState(), PaceWeeklyFile));
    expect(read(PACE_STATE_PATH)).not.toBe(read(`${SITE}/state/pace-weekly.json`));
    expect(state.updated).toBe(EDITIONS.weekday.date);
    expect(F.pace.updated).toBe(SUN);
    expect(state.versions).toEqual(F.pace.versions);
    const strip = (w: { fetched: string }) => ({ ...w, fetched: "" });
    expect(state.weeks.map(strip)).toEqual(F.pace.weeks.map(strip));
    // They differ in the weeks that morning refetched: the 8 provisional weeks and the newest firm one (36 requests, SPEC §5.4).
    const refetched = (s: PaceWeeklyFile) => s.weeks.slice(-9).map((w) => w.week_start);
    expect(refetched(state)).toEqual(refetched(F.pace));
    expect(state.weeks.filter((w, k) => w.fetched !== F.pace.weeks[k]!.fetched).map((w) => w.week_start)).toEqual(refetched(state));
    // One row a week from 2015-01-05 to the Monday of the cutoff's week, the newest 8 provisional, fetched the day the state was written.
    for (const [s, written] of [[state, EDITIONS.weekday.date], [F.pace, SUN]] as const) {
      expect(s.weeks[0]!.week_start).toBe("2015-01-05");
      s.weeks.forEach((w, k) => expect(w.week_start, `${k}`).toBe(addDays("2015-01-05", 7 * k)));
      expect(addDays(s.weeks.at(-1)!.week_start, 6)).toBe(lastSunday(dataCutoffFor(written)));
      expect(s.weeks.filter((w) => w.provisional).map((w) => w.week_start)).toEqual(s.weeks.slice(-8).map((w) => w.week_start));
      for (const w of s.weeks.filter((x) => x.provisional)) expect(w.fetched).toBe(written);
      // The newest firm week was refetched that morning too, and still has mornings left (its last is 64 days after its Sunday, 70 after its Monday).
      // Every older firm week carries that last morning, so none was fetched before it and none is owed a refetch (SPEC §5.4).
      const firm = s.weeks.filter((x) => !x.provisional);
      expect(firm.at(-1)!.fetched).toBe(written);
      expect(addDays(firm.at(-1)!.week_start, 70) >= written).toBe(true);
      for (const w of firm.slice(0, -1)) {
        expect(w.fetched, w.week_start).toBe(addDays(w.week_start, 70));
        expect(w.fetched <= written, w.week_start).toBe(true);
      }
    }
    const weekdayMetrics = JSON.parse(read("fixtures/metrics/weekday.json")) as { data_cutoff: string };
    expect(addDays(state.weeks.at(-1)!.week_start, 6)).toBe(weekdayMetrics.data_cutoff);
  });
});

describe("the Pace's A and B are what lib/metrics/pace.ts computes from the stored weekly state", () => {
  const paceSettings = {
    window_weeks: config.run.pace.window_weeks,
    provisional_weeks: config.run.pace.provisional_weeks,
    min_cases: config.run.pace.min_cases,
    min_ratio: config.run.pace.min_ratio,
  };

  it.each(DATES.map((d) => [d] as const))("%s: the whole block, and each tally and the headline recounted by hand from the weeks", (d) => {
    const m = F.metrics.get(d)!;
    // The block as the library builds it from the folder's own state. `quotable` also holds the Ledger's figures (C and D, checked above),
    // so it is compared on the library's own keys. The weeks after the cutoff (the next Sunday's) are not read, and `fetched` is not read.
    const built = buildPace({ weeks: F.pace.weeks, cutoff: m.data_cutoff, settings: paceSettings });
    const { quotable, ...block } = m.pace;
    const { quotable: builtQuotable, ...builtBlock } = built;
    expect(block).toEqual(builtBlock);
    expect(Object.fromEntries(Object.keys(builtQuotable).map((k) => [k, quotable[k]]))).toEqual(builtQuotable);

    // By hand: a tally is the sum of the [AI-method papers, papers] of the stored weeks that start inside its span, never past the cutoff.
    for (const set of ["leading", "all"] as const) {
      for (const span of ["window", "baseline", "year_ago"] as const) {
        const { from, to } = m.pace[span];
        expect(to <= m.data_cutoff, `${set} ${span}`).toBe(true);
        const weeks = F.pace.weeks.filter((w) => w.week_start >= from && w.week_start <= to);
        expect(weeks.length * 7, `${set} ${span}`).toBe(daysBetween(from, to) + 1);
        if (span !== "baseline") expect(weeks.length, `${set} ${span}`).toBe(config.run.pace.window_weeks);
        let k = 0;
        let n = 0;
        for (const f of FIELDS) {
          const fk = weeks.reduce((s, w) => s + w[set][f][0], 0);
          const fn = weeks.reduce((s, w) => s + w[set][f][1], 0);
          const cell = m.pace[set].by_field[f][span];
          expect([cell.k, cell.n], `${set} ${f} ${span}`).toEqual([fk, fn]);
          k += fk;
          n += fn;
        }
        const pooled = m.pace[set].pooled[span];
        expect([pooled.k, pooled.n], `${set} pooled ${span}`).toEqual([k, n]);
        expect(Math.abs(pooled.share - k / n), `${set} pooled ${span}`).toBeLessThan(0.00005);
      }
    }

    // The window ends the day before the provisional weeks begin, so the newest 8 weeks never reach the sentence (SPEC §5.3).
    expect(m.pace.provisional_from, d).toBe(addDays(m.pace.window.to, 1));
    expect(addDays(m.pace.provisional_from, 7 * config.run.pace.provisional_weeks - 1), d).toBe(m.data_cutoff);
    // The headline is A's pooled window share, to one decimal.
    const lead = m.pace.leading.pooled.window;
    expect(m.pace.sentence.en.startsWith(`The Pace: ${(100 * lead.k / lead.n).toFixed(1)}% of papers in leading journals named AI methods in the `), d).toBe(true);
    expect(m.pace.sentence.zh!.includes(`${(100 * lead.k / lead.n).toFixed(1)}%`), d).toBe(true);
  });

  it("is what each manifest records: the counts of the weeks it fetched are the counts the state holds for them", () => {
    // [set, index]: a week's `leading`/`all` entry per field is [AI-method papers, papers].
    const requests = { leading_total: ["leading", 1], leading_ai: ["leading", 0], all_total: ["all", 1], all_ai: ["all", 0] } as const;
    const byWeek = new Map(F.pace.weeks.map((w) => [w.week_start, w]));
    const stateEnd = addDays(F.pace.weeks.at(-1)!.week_start, 6);
    for (const d of DATES) {
      const i = F.inputs.get(d)!;
      // The newest firm week the morning refetched: the week before its 8 provisional ones.
      const newestFirm = addDays(i.data_cutoff, -6 - 7 * config.run.pace.provisional_weeks);
      expect(i.openalex[0]!.week_start, d).toBe(newestFirm);
      for (const o of i.openalex) {
        const week = byWeek.get(o.week_start);
        expect(week, `${d} ${o.week_start}`).toBeDefined();
        const [set, at] = requests[o.request];
        for (const f of FIELDS) {
          const label = `${d} ${o.week_start} ${o.request} ${f}`;
          const kept = week![set][f][at];
          // The state holds this morning's counts when it ends at the manifest's cutoff (Tuesday to Sunday, and the Monday's firm week); on the Monday
          // a week that was still provisional then holds no more papers than it does once the next week's run has refetched it as firm.
          if (i.data_cutoff === stateEnd || o.week_start <= newestFirm) expect(o.counts[f], label).toBe(kept);
          else if (at === 1) expect(o.counts[f], label).toBeLessThanOrEqual(kept);
        }
      }
    }
  });
});

// ── Marked as a sample ───────────────────────────────────────────────────────────────────────────

describe("every reader-visible name and title is marked SAMPLE", () => {
  it("marks each finding, source, Also noted line, name, reaction, idea and figure credit", () => {
    for (const f of findings) {
      expect(f.title.en.startsWith("SAMPLE"), f.id).toBe(true);
      expect(f.title.zh!.startsWith("SAMPLE"), f.id).toBe(true);
      for (const s of f.sources) expect(s.title.startsWith("SAMPLE"), `${f.id} ${s.id}`).toBe(true);
      for (const w of f.who) expect(w.name, f.id).toContain("SAMPLE");
      for (const r of f.reactions) expect(r.who.endsWith("(SAMPLE)"), `${f.id} ${r.who}`).toBe(true);
      if (f.figure !== null) expect(f.figure.credit, f.id).toContain("SAMPLE");
      for (const s of f.sources) expect(s.title.length + s.publisher.length, f.id).toBeGreaterThan(0);
    }
    for (const d of DATES) {
      const b = brief(d);
      for (const s of b.sources) expect(s.title.startsWith("SAMPLE"), `${d} ${s.id}`).toBe(true);
      for (const a of b.also) {
        expect(a.title.en.startsWith("SAMPLE"), d).toBe(true);
        expect(a.title.zh === null || a.title.zh.startsWith("SAMPLE"), d).toBe(true);
      }
      for (const i of b.ideas) expect(i.who.endsWith("(SAMPLE)"), d).toBe(true);
    }
  });

  it("lives where the loader reads a sample: a folder under fixtures/, never content/", () => {
    expect(SITE.startsWith("fixtures/")).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "content/briefs"))).toBe(false);
  });
});

// ── The Chinese ──────────────────────────────────────────────────────────────────────────────────

describe("the Chinese of the sample", () => {
  const all: { file: string; p: Pair }[] = filesUnder(SITE)
    .filter((f) => f.endsWith(".json") && !f.startsWith("state/") && !f.startsWith("metrics/inputs/"))
    .flatMap((f) => pairsOf(JSON.parse(read(`${SITE}/${f}`))).map((p) => ({ file: f, p })));

  it("holds Chinese for every string a bilingual edition and every finding wrote, and only the English-only brief is without", () => {
    const missing = all.filter(({ p }) => p.zh === null).map(({ file }) => file);
    expect(new Set(missing)).toEqual(new Set([`briefs/${TUE}.json`]));
    expect(all.length).toBeGreaterThan(100);
  });

  it("uses Taiwan's characters and terms, no dash, and no hype word, in every string", () => {
    for (const { file, p } of all.filter((x) => x.p.zh !== null)) {
      const zh = p.zh!;
      const problems = [
        ...traditionalHits(zh, config.index).map((h) => `character ${h.char}`),
        ...avoidHits(zh, { avoid: config.termsZh.avoid, fixed: config.termsZh.fixed }).map((h) => `term ${h.term}`),
        ...dashHits(zh).map((h) => `dash ${h.codePoint}`),
      ];
      expect(problems, `${file} ${p.at}: ${zh}`).toEqual([]);
    }
    for (const t of F.glossary) {
      for (const text of [t.zh!.term, t.zh!.definition, t.zh!.official ?? ""]) {
        expect(traditionalHits(text, config.index), t.id).toEqual([]);
        expect(avoidHits(text, { avoid: config.termsZh.avoid, fixed: config.termsZh.fixed }), t.id).toEqual([]);
      }
    }
  });

  it("keeps the English numbers, links and Latin words in each Chinese string (ZH_PARITY)", () => {
    for (const { file, p } of all.filter((x) => x.p.zh !== null)) {
      const gaps = parityProblems(p.en, p.zh!);
      expect({ file, at: p.at, ...gaps }, `${file} ${p.at}`).toEqual({ file, at: p.at, missing: [], extra: [], urls: [], latin: [] });
    }
  });

  it("keeps each spelled-out number of the sample's own English lines in their Chinese (ZH_PARITY reads digits, not words)", () => {
    const numeral: Readonly<Record<string, RegExp>> = {
      two: /[二兩]/u, three: /三/u, four: /四/u, five: /五/u, six: /六/u, seven: /七/u, eight: /八/u, nine: /九/u, ten: /十/u, first: /第一|首/u,
    };
    let seen = 0;
    for (const en of ZH_EXTRA_ENGLISH) {
      for (const word of en.toLowerCase().match(/[a-z]+/g) ?? []) {
        const re = numeral[word];
        if (re === undefined) continue;
        seen += 1;
        expect(zhOf(en), `"${word}" in "${en}"`).toMatch(re);
      }
    }
    expect(seen, "the lines the sample writes itself use at least three spelled-out numbers").toBeGreaterThanOrEqual(3);
  });

  it("passes validateZh() with no error and no warning for each pass the week ran, over the records stored before it", () => {
    const sample = buildSample();
    const withPass = sample.days.filter((day) => day.zh !== null);
    expect(withPass.map((day) => day.date)).toEqual([MON, WED, FRI, SAT, SUN]);
    for (const day of withPass) {
      const zh = day.zh!;
      const result = validateZh(zh.draft, sample.drafts[day.date], {
        context: zh.context, evidence: zh.evidence, config,
        stored: { findings: day.before.findings, corrections: day.before.corrections, terms: day.before.glossary },
      }, { fileDate: day.date });
      expect(result.errors, day.date).toEqual([]);
      expect(result.warnings, day.date).toEqual([]);
      expect(Object.keys(zh.draft.strings).sort(byCodeUnit), day.date).toEqual(zh.context.strings.map((s) => s.key).sort(byCodeUnit));
      expect(Object.keys(zh.draft.terms).sort(byCodeUnit), day.date).toEqual(zh.context.terms.filter((t) => t.zh === null).map((t) => t.id).sort(byCodeUnit));
    }
  });

  it("puts the Chinese backlog's strings in the findings the English-only day wrote", () => {
    const wed = buildSample().days.find((day) => day.date === WED)!;
    expect(wed.backlog).toEqual([...SAMPLE_EDITIONS[2]!.backlog].sort(compareFindingIds));
    expect(wed.zh!.context.strings.filter((s) => s.key.startsWith("backlog.")).length).toBeGreaterThan(20);
    for (const id of wed.backlog) {
      const f = finding(id);
      expect(pairsOf(f).every((p) => p.zh !== null), id).toBe(true);
    }
  });
});

// ── The engine: what publish does to a draft ─────────────────────────────────────────────────────

describe("publishDraft() and publishDataOnly()", () => {
  const sample = buildSample();

  it.each(DATES.map((d) => [d] as const))("reproduces %s from its draft over the records stored before it, without touching them", (d) => {
    const day = sample.days.find((x) => x.date === d)!;
    const draft = sample.drafts[d];
    const untouched = structuredClone(day.before);
    const input = {
      state: day.before, pace: { sentence: day.metrics.pace.sentence, status: day.metrics.status }, publishedAt: day.brief.published_at,
      runId: day.brief.provenance.run_id, script: day.script,
    };
    const out = draft === null
      ? publishDataOnly({ ...input, date: d })
      : publishDraft({ ...input, draft, ids: day.ids, zh: day.zh === null ? null : { strings: day.zh.draft.strings, terms: day.zh.draft.terms } });
    expect(out.brief).toEqual(day.brief);
    expect(day.before).toEqual(untouched);
    expect(out.written.map((f) => f.id)).toEqual([...day.written]);
    expect(out.backlog).toEqual([...day.backlog]);
    expect(out.written.every((f) => JSON.stringify(f) === JSON.stringify(finding(f.id)) || f.updated === d), d).toBe(true);
    // The records it leaves are the ones the next edition starts from (the report intake aside), and the last day's are the folder's.
    const next = sample.days.find((x) => x.date === addDays(d, 1));
    if (next !== undefined) {
      expect(out.state.findings).toEqual(next.before.findings);
      expect(out.state.glossary).toEqual(next.before.glossary);
      expect(out.state.corrections).toEqual(next.before.corrections);
      expect(out.state.briefs).toEqual(next.before.briefs);
    } else {
      expect(out.state.findings).toEqual(findings);
      expect(out.state.glossary).toEqual(F.glossary);
      expect(out.state.corrections).toEqual(F.corrections);
      expect(out.state.reports).toEqual(F.reports);
      expect(out.state.briefs).toEqual(DATES.map((x) => brief(x)));
    }
  });

  it("gives, for the findings that share the world's dates, the finding the world stores, and for the others the world's content", () => {
    const stripZh = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(stripZh);
      if (v !== null && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (Object.keys(o).length === 2 && typeof o.en === "string" && "zh" in o) return { en: o.en, zh: null };
        return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, stripZh(x)]));
      }
      return v;
    };
    const aligned = ["plasma", "scroll", "protein", "retractWD", "erdos", "translation"] as const;
    for (const k of aligned) expect(stripZh(finding(ID(k))), k).toEqual(stripZh(storedFinding(k)));
    /** What a finding says, without when: the dates the sample moves into its week are the only difference. */
    const content = (f: Finding) => stripZh({
      id: f.id, field: f.field, subfield: f.subfield, kind: f.kind, title: f.title, depth: f.depth, explainer: f.explainer, go_deeper: f.go_deeper, ai: f.ai,
      significance: f.significance, rung: f.rung, rungs: f.rung_history.map((r) => [r.rung, r.date, r.source_id, r.note]),
      sources: f.sources.map((s) => ({ id: s.id, kind: s.kind, title: s.title, publisher: s.publisher, url: s.url, doi: s.doi, published_at: s.published_at })),
      reactions: f.reactions, artefacts: f.artefacts, figure: f.figure, who: f.who, terms: f.terms, related: f.related, first_published: f.first_published,
    });
    for (const k of FINDING_KEYS) expect(content(finding(ID(k))), k).toEqual(content(storedFinding(k)));
  });

  it("derives a stored brief from each of the four valid drafts, English only, as the chat edition's tests need", () => {
    for (const name of EDITION_NAMES) {
      const e = EDITIONS[name];
      const p = worldPublished(name);
      expect(Brief.safeParse(p.brief).success, name).toBe(true);
      expect([p.brief.date, p.brief.format, p.brief.edition, p.brief.languages], name).toEqual([e.date, e.format, "full", { en: true, zh: false }]);
      expect(p.brief.computed.zh_chars, name).toBeNull();
      const draft = editionDraft(name);
      expect(p.brief.lead.map((l) => l.text.en), name).toEqual(draft.lead.map((l) => l.text));
      expect(p.brief.items.length + (p.brief.story === null ? 0 : 1), name).toBe(draft.items.length + (draft.story === null ? 0 : 1));
      expect(p.brief.corrections, name).toHaveLength(draft.corrections.length);
      for (const id of [...p.brief.lead.flatMap((l) => l.finding_ids), ...p.brief.items.map((i) => i.finding_id), p.brief.story?.finding_id].filter(nonNull)) {
        expect(p.state.findings.some((f) => f.id === id), `${name} ${id}`).toBe(true);
      }
      const ids = Object.fromEntries(PLANS[name].newFindings.map((k) => [refOf(name, k), findingId(k)]));
      expect(storedBriefOfDraft({
        draft, state: worldState(name), zh: null, ids, pace: { sentence: p.brief.pace.sentence, status: p.brief.pace.status },
        publishedAt: p.brief.published_at, runId: p.brief.provenance.run_id,
      }), name).toEqual(p.brief);
    }
  });

  it("gives the world's full Monday its remarkable finding, and a week the context's own counts, setbacks and falls", () => {
    const monday = worldPublished("monday");
    const review = monday.brief.review!;
    expect(review.remarkable).not.toBeNull();
    expect(monday.state.findings.some((f) => f.id === review.remarkable!.finding_id)).toBe(true);
    expect(monday.brief.disclosure).toEqual([]);
    const short = worldPublished("monday-short").brief.review!;
    expect([short.remarkable, short.strongest_against.text.en]).toEqual([null, NONE_FOUND.en]);
    for (const name of ["monday", "monday-short"] as const) {
      const s = worldState(name);
      const facts = weekFacts(s.findings, s.corrections, EDITIONS[name].date);
      const week = editionContext(name).week!;
      expect(facts.field_counts, name).toEqual(week.field_counts);
      expect(facts.setbacks, name).toEqual(week.setbacks);
      expect(facts.findings, name).toBe(week.findings.length);
      expect(facts.fell, name).toEqual(week.rung_changes.filter((c) => c.to === "disputed" || c.to === "retracted").map((c) => c.finding_id));
      const stored = worldPublished(name).brief.review!;
      expect([stored.field_counts, stored.fell, stored.setbacks], name).toEqual([facts.field_counts, facts.fell, facts.setbacks]);
    }
  });

  it("reads a week from the records alone: first listings count, history entries and seeds do not, and a fall counts only after the finding was shown", () => {
    // A Monday of its own, after the sample: 2026-11-02 reviews 2026-10-26 to 2026-11-01 (the day itself is outside, and so is the day before).
    const MONDAY = "2026-11-02";
    type Entry = readonly [rung: Rung, recorded: string, by: "agent" | "script" | "seed"];
    const made = (key: FindingKey, o: { history?: boolean; briefs: string[]; entries: Entry[] }): Finding => {
      const base = storedFinding(key);
      const rung_history = o.entries.map(([rung, recorded, by]) => ({ ...base.rung_history[0]!, rung, date: recorded, recorded, by, note: null }));
      return Finding.parse({ ...base, history: o.history ?? false, briefs: o.briefs, first_brief: o.briefs[0] ?? null, rung: rung_history.at(-1)!.rung, rung_history });
    };
    const records = [
      // First listed in the week, the first day of it; a preprint is not counted.
      made("erdos", { briefs: ["2026-10-26"], entries: [["preprint", "2026-10-26", "agent"]] }),
      // First listed in the week at Checked: reported and counted.
      made("protein", { briefs: ["2026-10-27"], entries: [["preprint", "2026-10-27", "agent"], ["checked", "2026-10-27", "agent"]] }),
      // First listed in the week and already retracted that day: reported, not counted, and not a fall after being shown.
      made("retractWD", { briefs: ["2026-10-28"], entries: [["checked", "2026-10-28", "agent"], ["retracted", "2026-10-28", "agent"]] }),
      // A setback at Checked: reported, never counted.
      made("retractW0", { briefs: ["2026-10-29"], entries: [["checked", "2026-10-29", "agent"]] }),
      // A history entry that returns in the week: shown in it, but not a first listing.
      made("policy", { history: true, briefs: ["2026-10-29"], entries: [["claimed", "2026-10-09", "seed"]] }),
      // Shown before the week and climbing in it: not a first listing, not a fall.
      made("antibiotic", { briefs: ["2026-10-20", "2026-10-30"], entries: [["checked", "2026-10-20", "agent"], ["confirmed", "2026-10-30", "agent"]] }),
      // Shown before the week and retracted in it: a fall.
      made("fellW0", { briefs: ["2026-10-20", "2026-10-31"], entries: [["checked", "2026-10-20", "agent"], ["retracted", "2026-10-31", "script"]] }),
      // A seed entry at a fell rung, never shown: no first listing, no fall, not in the week.
      made("disputedOld", { history: true, briefs: [], entries: [["disputed", "2026-10-27", "seed"]] }),
      // Listed the day before the week and on the day itself: both outside.
      made("tilings", { briefs: ["2026-10-25"], entries: [["checked", "2026-10-25", "agent"]] }),
      made("weather", { briefs: ["2026-11-02"], entries: [["checked", "2026-11-02", "agent"]] }),
    ];
    expect(records.map((f) => [f.field, f.kind])).toEqual([
      ["mathematics", "result"], ["biology", "result"], ["chemistry", "setback"], ["social", "setback"], ["social", "policy_people"],
      ["biology", "result"], ["physics", "result"], ["mathematics", "check"], ["mathematics", "result"], ["earth", "result"],
    ]);
    const reported: Readonly<Record<string, readonly [number, number]>> = { mathematics: [1, 0], biology: [1, 1], chemistry: [1, 0], social: [1, 0] };
    const expected = {
      field_counts: FIELDS.map((field) => ({ field, reported: reported[field]?.[0] ?? 0, counted: reported[field]?.[1] ?? 0 })),
      fell: [ID("fellW0")],
      setbacks: [ID("retractW0"), ID("retractWD")].sort(compareFindingIds),
      findings: 7,
    };
    expect(weekFacts(records, [], MONDAY)).toEqual(expected);
    expect(weekFacts([...records].reverse(), [], MONDAY), "the order of the records does not matter").toEqual(expected);
    // The same records a day later: the day itself is now inside the week (the weather, one more), and the first day of the old week has left it (the Erdos entry, one less).
    const later = weekFacts(records, [], "2026-11-03");
    expect(later.findings).toBe(7);
    expect(later.field_counts.find((c) => c.field === "mathematics")).toEqual({ field: "mathematics", reported: 0, counted: 0 });
    expect(later.field_counts.find((c) => c.field === "earth")).toEqual({ field: "earth", reported: 1, counted: 1 });
  });

  it("gives a returning finding that brings a rung its entry, its new rung, its source and a line in the brief's rung changes", () => {
    const name = "weekday";
    const date = EDITIONS[name].date;
    const eventDate = addDays(date, -2);
    const draft = structuredClone(editionDraft(name));
    const policy = findingId("policy");
    const back = draft.returning.find((r) => r.finding_id === policy)!;
    expect(back.rung, "the world's returning entry brings no rung").toBeNull();
    back.rung = { rung: "preprint", date: eventDate, source_id: back.source_ids[0]!, note: null };
    const before = worldState(name);
    const was = before.findings.find((f) => f.id === policy)!;
    expect(was.rung).not.toBe("preprint");
    const run = (d: DraftBrief) => publishDraft({
      draft: d, state: before, zh: null, ids: Object.fromEntries(PLANS[name].newFindings.map((k) => [refOf(name, k), findingId(k)])),
      pace: { sentence: { en: "Pace sentence.", zh: null }, status: "ok" }, publishedAt: `${date}T03:53:12+08:00`, runId: "20261014-031502",
    });
    const plain = run(editionDraft(name));
    const withRung = run(draft);
    const after = withRung.state.findings.find((f) => f.id === policy)!;
    expect(after.rung).toBe("preprint");
    expect(after.rung_history).toHaveLength(was.rung_history.length + 1);
    const entry = after.rung_history.at(-1)!;
    expect([entry.rung, entry.date, entry.recorded, entry.by, entry.note]).toEqual(["preprint", eventDate, date, "agent", null]);
    expect(after.sources.some((s) => s.id === entry.source_id), "the entry's source is one of the finding's own").toBe(true);
    expect(after.since_then.at(-1)!.date).toBe(date);
    const climb = { finding_id: policy, from: was.rung, to: "preprint", date: eventDate, by: "agent" };
    expect(withRung.brief.rung_changes).toContainEqual(climb);
    expect(plain.brief.rung_changes).not.toContainEqual(climb);
    expect(withRung.brief.rung_changes).toHaveLength(plain.brief.rung_changes.length + 1);
    const dates = withRung.brief.rung_changes.map((c) => c.date);
    expect(dates, "newest first").toEqual([...dates].sort(byCodeUnit).reverse());
    expect(new Set(dates).size, "the two changes differ in date, so the order shows").toBe(dates.length);
    // Nothing else changes: the same brief but for that line, and the same finding without the entry.
    expect({ ...withRung.brief, rung_changes: plain.brief.rung_changes }).toEqual(plain.brief);
    const unchanged = plain.state.findings.find((f) => f.id === policy)!;
    expect(unchanged.rung_history).toHaveLength(was.rung_history.length);
    expect({ ...after, rung: unchanged.rung, rung_history: unchanged.rung_history, sources: unchanged.sources }).toEqual(unchanged);
  });

  it("refuses a plan it cannot publish, naming what is missing, instead of writing a record with a hole", () => {
    const name = "weekday";
    const date = EDITIONS[name].date;
    const policy = findingId("policy");
    const ids = Object.fromEntries(PLANS[name].newFindings.map((k) => [refOf(name, k), findingId(k)]));
    const before = worldState(name);
    const run = (d: DraftBrief, over: Partial<Parameters<typeof publishDraft>[0]> = {}) => publishDraft({
      draft: d, state: before, zh: null, ids, pace: { sentence: { en: "Pace sentence.", zh: null }, status: "ok" },
      publishedAt: `${date}T03:53:12+08:00`, runId: "20261014-031502", ...over,
    });
    expect(() => run(editionDraft(name)), "the unchanged world draft publishes").not.toThrow();
    const rungOf = (source_id: string): DraftBrief => {
      const d = structuredClone(editionDraft(name));
      d.returning.find((r) => r.finding_id === policy)!.rung = { rung: "preprint", date: addDays(date, -2), source_id, note: null };
      return d;
    };
    expect(() => run(rungOf("s9")), "a source id the finding does not have").toThrow(`${policy} has no source s9`);
    expect(() => run(rungOf("b9")), "a brief source the draft does not have").toThrow("the draft has no source b9");
    const removal = structuredClone(editionDraft(name));
    removal.corrections[0]!.type = "removed";
    expect(() => run(removal)).toThrow("only corrections of a finding that are not removals");
    const noText = structuredClone(editionDraft(name));
    noText.corrections[0]!.path = "explainer.nothing_here";
    expect(() => run(noText)).toThrow(/has no text at explainer\.nothing_here/);
    expect(() => run(editionDraft(name), { ids: {} }), "a new finding with no id").toThrow(/no id for new-/);
    expect(() => run(editionDraft(name), { zh: { strings: {}, terms: {} } }), "a Chinese pass with no strings").toThrow(/the Chinese draft has no string /);
    const stray = structuredClone(editionDraft(name));
    stray.returning[0]!.finding_id = "math-2099-9999";
    expect(() => run(stray)).toThrow("no stored finding math-2099-9999");
    expect(() => morningOf(0, "full", null)).toThrow("needs the draft's time");
    expect(() => morningOf(0, "failed_validation", null), "a failed morning has no draft time").not.toThrow();
  });

  it("lists in the brief's disclosure each place SPEC §4.4 names that mentions Claude, one at a time: ideas, Also noted, the deep dive and the review", () => {
    const publishWith = (name: (typeof EDITION_NAMES)[number], edit: (d: DraftBrief, s: ReturnType<typeof worldState>) => void): string[] => {
      const draft = structuredClone(editionDraft(name));
      const state = structuredClone(worldState(name));
      edit(draft, state);
      const date = EDITIONS[name].date;
      return publishDraft({
        draft, state, zh: null, ids: Object.fromEntries(PLANS[name].newFindings.map((k) => [refOf(name, k), findingId(k)])),
        pace: { sentence: { en: "Pace sentence.", zh: null }, status: "ok" }, publishedAt: `${date}T03:53:12+08:00`, runId: "20261014-031502",
      }).brief.disclosure;
    };
    const mention = " Claude helped with this.";
    // A source line names Claude in its title (a URL must be one the run saw, so the title is the form this test can edit).
    const onAnthropic = (d: DraftBrief, sid: string): void => { d.sources.find((x) => x.id === sid)!.title += " (Claude)"; };
    const place = (name: (typeof EDITION_NAMES)[number], where: string, edit: (d: DraftBrief, s: ReturnType<typeof worldState>) => void): void => {
      expect(publishWith(name, () => {}), `${name}: nothing mentions Claude to begin with`).not.toContain(where);
      expect(publishWith(name, edit), `${name} ${where}`).toContain(where);
    };
    place("weekday", "ideas.0", (d) => { d.ideas[0]!.text += mention; });
    place("weekday", "ideas.0", (d) => { d.ideas[0]!.who += " (Claude)"; });
    place("weekday", "ideas.0", (d) => onAnthropic(d, d.ideas[0]!.source_id));
    place("weekday", "also.1", (d) => { d.also[1]!.title += mention; });
    place("weekday", "also.1", (d) => onAnthropic(d, d.also[1]!.source_id));
    place("sunday", "deep_dive", (d) => { d.deep_dive!.text += mention; });
    place("sunday", "deep_dive", (d) => onAnthropic(d, d.deep_dive!.source_ids[0]!));
    // The deep dive's finding is written that day (its flag is recomputed from its text), so only a text edit shows here; the review's remarkable
    // finding is an older one that is not written on a Monday, so its stored flag is what counts.
    place("monday", "review", (d) => { d.review!.big_picture += mention; });
    place("monday", "review", (d) => { d.review!.strongest_against.text += mention; });
    place("monday", "review", (d) => { d.review!.strongest_against.source_ids = [d.sources[0]!.id]; onAnthropic(d, d.sources[0]!.id); });
    place("monday", "review", (d) => { d.review!.remarkable!.note += mention; });
    place("monday", "review", (d, s) => { s.findings.find((f) => f.id === d.review!.remarkable!.finding_id)!.disclosure = true; });
  });

  it("chains a later correction of the same text to the earlier one's `after`, which publish copies as its `before`", () => {
    const name = "weekday";
    const date = EDITIONS[name].date;
    const draft = structuredClone(editionDraft(name));
    const first = draft.corrections[0]!;
    draft.corrections.push({ ...structuredClone(first), after: `${first.after} It does not cover curved surfaces.`, report_id: null });
    const before = worldState(name);
    const run = publishDraft({
      draft, state: before, zh: null, ids: Object.fromEntries(PLANS[name].newFindings.map((k) => [refOf(name, k), findingId(k)])),
      pace: { sentence: { en: "Pace sentence.", zh: null }, status: "ok" }, publishedAt: `${date}T03:53:12+08:00`, runId: "20261014-031502",
    });
    const [a, b, c] = run.state.corrections;
    expect([a!.id, b!.id, c!.id]).toEqual(["C-0001", "C-0002", "C-0003"]);
    expect([c!.finding_id, c!.path]).toEqual([a!.finding_id, a!.path]);
    expect(c!.before, "a second correction of a text starts from what the first said").toEqual(a!.after);
    expect(a!.before, "the first starts from the stored text").toEqual(before.findings.find((f) => f.id === first.finding_id)!.explainer.background);
    expect(b!.before, "a correction of another text starts from its own stored text").toEqual(before.findings.find((f) => f.id === b!.finding_id)!.explainer.how_sure);
  });

  it("gives a backlog finding the Chinese of its figure's alt text by key, and only what the pass translated", () => {
    const name = "sunday";
    const draft = editionDraft(name);
    const before = worldState(name);
    const scrollId = findingId("scroll");
    const scroll = before.findings.find((f) => f.id === scrollId)!;
    const figure = scroll.figure!;
    expect(figure.alt.zh, "the world's stored scroll is English only").toBeNull();
    const pass = zhPassOf(draft, before);
    const mine = `backlog.${scrollId}.`;
    const alt = zhOf(figure.alt.en);
    const strings = { ...Object.fromEntries(Object.entries(pass.draft.strings).filter(([k]) => !k.startsWith(mine))), [`${mine}figure.alt`]: alt };
    const out = publishDraft({
      draft, state: before, zh: { strings, terms: pass.draft.terms }, ids: Object.fromEntries(PLANS[name].newFindings.map((k) => [refOf(name, k), findingId(k)])),
      pace: { sentence: { en: "Pace sentence.", zh: "步調句。" }, status: "ok" }, publishedAt: `${EDITIONS[name].date}T03:53:12+08:00`, runId: "20261018-031502",
    });
    const after = out.state.findings.find((f) => f.id === scrollId)!;
    expect(out.backlog).toContain(scrollId);
    expect(out.written.map((f) => f.id)).toContain(scrollId);
    expect(after.figure!.alt).toEqual({ en: figure.alt.en, zh: alt });
    expect(after.title.zh, "the pass sent no title for it").toBeNull();
    expect({ ...after, figure: scroll.figure, updated: scroll.updated, disclosure: scroll.disclosure }).toEqual(scroll);
  });
});

// ── What the chat edition and the site read ─────────────────────────────────────────────────────

describe("the folder feeds every chat format of SPEC §8.8", () => {
  it("has a published daily with a story, More lines, a returning finding ('Back:'), 'Climbed or fell', corrections and reports", () => {
    const b = brief(WED);
    expect(b.format).toBe("daily");
    expect(b.story).not.toBeNull();
    expect(b.items.length).toBeGreaterThanOrEqual(2);
    const back = b.items.find((i) => !i.new)!;
    expect(back.update!.en.length).toBeGreaterThan(0);
    expect(finding(back.finding_id).since_then.at(-1)!.date).toBe(WED);
    expect(b.rung_changes.length).toBeGreaterThanOrEqual(1);
    expect(b.corrections.length).toBeGreaterThanOrEqual(1);
    expect(b.reports.length).toBeGreaterThanOrEqual(1);
    expect(b.ideas.length + b.also.length).toBeGreaterThan(0);
    expect(b.sources.length).toBeGreaterThan(0);
  });

  it("has the Monday without a remarkable finding (the folder's) and, from the engine, the Monday with one", () => {
    expect(brief(SAMPLE_WEEK.mondayShort).review!.remarkable).toBeNull();
    expect(worldPublished("monday").brief.review!.remarkable).not.toBeNull();
  });

  it("has the Sunday deep dive, the English-only day, the data-only day with its script rung change, and a day with no findings", () => {
    expect(brief(SAMPLE_WEEK.sundayDeepDive).deep_dive!.text.en.length).toBeGreaterThan(0);
    expect(brief(SAMPLE_WEEK.englishOnly).languages.zh).toBe(false);
    expect(brief(SAMPLE_WEEK.dataOnly).rung_changes.map((c) => c.by)).toEqual(["script"]);
    for (const d of [SAMPLE_WEEK.noFindings, SAMPLE_WEEK.alsoDisclosure]) {
      expect(shownIds(brief(d)), d).toEqual([]);
      expect(brief(d).lead[0]!.finding_ids, d).toEqual([]);
    }
  });

  it("has the disclosure of a Monday review that names Claude, of an Also noted line that does, and of no finding", () => {
    expect(brief(MON).disclosure).toEqual(["review"]);
    expect(brief(SAT).disclosure).toEqual(["also.0"]);
    expect(brief(SAT).sources[0]!.title).toContain("Claude");
    expect(findings.filter((f) => f.disclosure)).toEqual([]);
    expect(DATES.filter((d) => brief(d).disclosure.length > 0)).toEqual([MON, SAT]);
  });

  it("flags a finding as disclosing when its text, its system's maker or a source names Anthropic or Claude (no sample finding does, so a copy tests the builder's flag)", () => {
    const base = finding(ID("weather"));
    expect(findingMentionsAnthropic(base)).toBe(false);
    const edited = (change: (f: Finding) => void): Finding => {
      const copy = structuredClone(base);
      change(copy);
      return copy;
    };
    const anthropicHost = fixtureConfig().labs.labs.find((l) => l.id === "anthropic")!.hosts[0]!;
    expect(findingMentionsAnthropic(edited((f) => { f.explainer.how_sure.en += " A second check used Claude."; }))).toBe(true);
    expect(findingMentionsAnthropic(edited((f) => { f.ai.systems[0]!.maker = "Anthropic"; }))).toBe(true);
    expect(findingMentionsAnthropic(edited((f) => { f.reactions.push({ source_id: "s1", who: "Ines Fictional (SAMPLE)", affiliation: "Kestrel College", quote: "Claude read it well" }); }))).toBe(true);
    expect(findingMentionsAnthropic(edited((f) => { f.sources[0]!.url = `https://${anthropicHost}/ut-sample`; }))).toBe(true);
    expect(findingMentionsAnthropic(edited((f) => { f.sources[0]!.title = "SAMPLE: A note from Anthropic"; }))).toBe(true);
    expect(findingMentionsAnthropic(edited((f) => { f.title.zh = "只有中文的標題提到 Claude"; }))).toBe(false);
  });

  it("has what re-check reads from reports.json: each report's finding, kind, issue number, status and who closed it", () => {
    for (const r of F.reports) {
      expect(F.findings.has(r.finding_id)).toBe(true);
      expect(Number.isInteger(r.issue_number) && r.issue_number > 0).toBe(true);
      expect(r.received).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
      expect(["open", "upheld", "rejected"]).toContain(r.status);
      expect(r.decided_by === null).toBe(r.status === "open");
    }
    // R-0001 is JL's close, which only the Tuesday intake knew: it had no correction until Wednesday's run wrote C-0002.
    const r1 = F.reports.find((r) => r.id === "R-0001")!;
    expect([r1.decided_by, r1.resolved_on, r1.correction_id]).toEqual(["jl", TUE, "C-0002"]);
    expect(F.corrections.find((c) => c.id === "C-0002")!.date).toBe(WED);
  });
});

// ── The validators ───────────────────────────────────────────────────────────────────────────────

describe("validateAll() over the sample", () => {
  it("finds no error and no warning", () => {
    const result = validateAll(path.join(REPO_ROOT, SITE), { config });
    expect(result.errors.map((e) => `${e.code} ${e.path}: ${e.message}`)).toEqual([]);
    expect(result.warnings.map((e) => `${e.code} ${e.path}: ${e.message}`)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(DATES.map((d) => [d] as const))("finds no error and no warning when %s is judged as the edition being published", (d) => {
    const result = validateAll(path.join(REPO_ROOT, SITE), { config, publishing: d });
    expect(result.errors.map((e) => `${e.code} ${e.path}: ${e.message}`)).toEqual([]);
    expect(result.warnings.map((e) => `${e.code} ${e.path}: ${e.message}`)).toEqual([]);
  });

  it("reads each of the files of the folder, and finds each one clean", () => {
    const result = validateAll(path.join(REPO_ROOT, SITE), { config, perFile: true });
    expect(result.files.map((f) => f.file)).toEqual(filesUnder(SITE));
    for (const f of result.files) expect([f.file, f.ok, f.errors, f.warnings]).toEqual([f.file, true, [], []]);
  });

  it("finds nothing in the empty folder: its README.md is the placeholder git needs, which the validator leaves out, so there is no record to judge and no issue", () => {
    // SPEC §3 and §4.12 FILE_LAYOUT: a regular file named README.md at the folder's root is never listed.
    const result = validateAll(path.join(REPO_ROOT, EMPTY), { config, perFile: true });
    expect(result).toEqual({ ok: true, errors: [], warnings: [], issues: [], files: [] });
    expect(filesUnder(EMPTY)).toEqual(["README.md"]);
  });
});
