// The base of the fixtures (SPEC §4.12 "Fixtures and tests", §8.1): the shared world (the editions and their times, the invented
// sources and findings, the stored views, the reports and corrections), the four valid English drafts built from it, and the
// builder that writes them (`fixtures/src/build.ts`: one registry of generators, write and `--check` modes). It checks what a
// later stage relies on: that the editions fall on the days the formats need, that every address is a primary source of its kind,
// that every quote and number a finding prints is in a source it cites, that each draft holds the shapes the rules read and the
// word, sentence, grade and dash limits of §4.12, and that `fixtures:gen` and `fixtures:check` agree byte for byte. The rules
// themselves are lib/rules' to judge; these checks are a first line of defence that needs no rule engine.
// The drafts' inputs (`fixtures/src/inputs.ts`: each edition's context, evidence, metrics and pack, and the weekday's flags) are
// checked as committed: that each draft agrees with its own inputs (refs, quotes, numbers, cited addresses, reports, the Sunday's
// candidate and the Monday's week), that every input is dated by its edition, that the packs rank as §5.9 says, and that every
// cited address passes the type check on the run's evidence.
// New for this project; Cyber's tests/fixtures-base.test.ts counted the same kinds of things for its own world.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { addDays, dataCutoffFor, isValidDate, lastSunday, weekday } from "@/lib/dates";
import { compareFindingIds } from "@/lib/ids";
import { breaksNonAiLandmarkOnly, breaksSetbackMajor, exceedsClaimedCap, isBriefable, significanceAtLeast } from "@/lib/items";
import { evidenceFits, isIndependent, rungOrderProblem, type EvidenceFacts } from "@/lib/rungs";
import { articleTypeFits, candidateRefusal, isPrimary } from "@/lib/primary";
import { contextFindingIds } from "@/lib/rules/views";
import { wrapUntrusted } from "@/lib/sanitize";
import { DraftFindingSource } from "@/lib/schema/common";
import { AgentContext } from "@/lib/schema/context";
import { DraftBrief } from "@/lib/schema/draft";
import { MetricsFile, PaceWeeklyFile } from "@/lib/schema/metrics";
import { Evidence } from "@/lib/schema/misc";
import { Pack } from "@/lib/schema/pack";
import { countWords, jaccard, quoteInText, splitSentences } from "@/lib/text";
import { blockedEntry, hostOf, normalizeDoi, normalizeUrl } from "@/lib/urls";
import {
  AI_ROLES, ALL_RUNGS, CANARY_TOKEN, FIELDS, FIELD_CODE_OF, FINDING_KINDS, NONE_FOUND, RUNG_INFO, SIGNIFICANCE, SOURCE_KIND_INFO, formatForWeekday,
  type SourceKind,
} from "@/lib/vocab";
import {
  FIGURE_HOSTS, allowedFor, agentProblems, budgetProblems, dashProblems, gradeProblems, hypeProblems, jargonIn, missingNumbers,
  numberProblems, pageWords, proseOf, quoteProblems, sentenceProblems, termProblems, urlProblems,
} from "./helpers/draft-facts";
import {
  FIXTURE_DIRS, FLAGS_PATH, GENERATORS, INPUT_FOLDERS, INVALID_CASES, ZH_INVALID_CASES, allOutputs, compareOutputs, inputPath, invalidDraft,
  invalidOutputs, jsonText, main, validDraftPath, validDraftProblems, validOutputs, writeJson, writeOutputs, type InputFolder, type InvalidCase,
  type Output,
} from "../fixtures/src/build";
import {
  MONDAY_ITEMS, PLANS, SUNDAY_ITEMS, WEEKDAY_ITEMS, WEEKDAY_REPORTS, briefSourceId, briefSourceIds, editionDraft, mondayDraft,
  mondayShortDraft, newFindingOf, refOf, sundayDraft, weekdayDraft,
} from "../fixtures/src/drafts";
import {
  DECOYS, EVIDENCE_EXTRAS, FIELD_CAP, PACK_FEEDS, WEEKDAY_PROPOSAL, citedKeys, contextConfig, draftInputs, editionContext, editionEvidence,
  editionMetrics, editionPack, fixtureConfig, metricsFor, paceState, paceWeeks, seenOn, toStoredFinding,
} from "../fixtures/src/inputs";
import {
  EDITIONS, EDITION_NAMES, FINDING_KEYS, FINDING_SPECS, REPO_ROOT, SOURCE_KEYS, SOURCE_TABLE, WEEKDAY_CORRECTIONS, WEEKDAY_DECISION,
  draftFinding, draftSources, findingId, findingKeyOfId, firstBrief, keysFirstShownOn, keysStoredBefore, reportsAfterWeekday,
  reportsBeforeWeekday, returningFact, rungEntryOf, seenText, seenTextOfUrl, sourceIds, sourceKeyOfUrl, sourceSpec, storedFinding, storedFindingsBefore,
  storedGlossary, storedWeekdayCorrections, termId, type EditionName, type FindingKey, type SourceKey,
} from "../fixtures/src/world";

const EM = String.fromCharCode(0x2014);
const spec = (k: FindingKey) => FINDING_SPECS[k];
const ms = (t: string): number => Date.parse(t);
const HOUR = 3_600_000;
const run = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config/run.json"), "utf8"));
const fieldsConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config/fields.json"), "utf8")) as {
  fields: { id: string; subfields: { id: string }[] }[];
};

/** A one-finding draft of a world finding as its first brief carried it, so the draft-level checks can read any finding. */
function soloDraft(key: FindingKey): DraftBrief {
  const date = firstBrief(key);
  const story = spec(key).depth === "story";
  return DraftBrief.parse({
    schema_version: 1, date, generated_at: `${date}T03:41:00+08:00`,
    lead: [{ text: "A sample sentence.", refs: ["new-1"] }], story: story ? "new-1" : null, items: story ? [] : ["new-1"],
    new_findings: [draftFinding(key, "new-1")], returning: [], rung_changes: [], ideas: [], also: [], deep_dive: null, review: null,
    corrections: [], report_decisions: [], sources: [],
  });
}

const publishedDate = (key: SourceKey): string => SOURCE_TABLE[key].published_at.slice(0, 10);

// ── The editions ─────────────────────────────────────────────────────────────────────────────────

describe("the editions", () => {
  it("are the four the fixtures name, in order", () => {
    expect(EDITION_NAMES).toEqual(["weekday", "sunday", "monday", "monday-short"]);
    expect(Object.keys(EDITIONS)).toEqual([...EDITION_NAMES]);
  });

  it.each(EDITION_NAMES)("%s: a Taipei date in the second half of 2026 with the times of one morning", (name) => {
    const e = EDITIONS[name];
    expect(isValidDate(e.date)).toBe(true);
    expect(e.date >= "2026-07-01" && e.date <= "2026-12-31").toBe(true);
    expect(e.format).toBe(formatForWeekday(weekday(e.date)));
    // The window is 24 hours ending at the run's window end on the date (config/run.json).
    expect(e.window.end).toBe(`${e.date}T${run.pack.window_end}:00+08:00`);
    expect(ms(e.window.end) - ms(e.window.start)).toBe(run.pack.window_hours * HOUR);
    // The run collects, builds the context, drafts and finishes before the deadline.
    expect(ms(e.packAt)).toBeGreaterThan(ms(e.window.end));
    expect(ms(e.contextAt)).toBeGreaterThan(ms(e.packAt));
    expect(ms(e.generatedAt)).toBeGreaterThan(ms(e.contextAt));
    expect(ms(e.generatedAt)).toBeLessThanOrEqual(ms(e.deadline));
    expect(ms(e.deadline) - ms(e.contextAt)).toBe(30 * 60_000);
    for (const t of [e.window.start, e.window.end, e.packAt, e.contextAt, e.generatedAt, e.deadline]) expect(t).toMatch(/\+08:00$/);
    // The data cutoff is the last Sunday on or before the date minus two days (SPEC §4.1).
    expect(e.cutoff).toBe(lastSunday(dataCutoffFor(e.date)));
    expect(weekday(e.cutoff)).toBe(0);
    expect(e.cutoff <= addDays(e.date, -2)).toBe(true);
    expect(e.cutoff > addDays(e.date, -9)).toBe(true);
    if (e.arxivAnnouncement !== null) {
      expect(ms(e.arxivAnnouncement)).toBeGreaterThanOrEqual(ms(e.window.start));
      expect(ms(e.arxivAnnouncement)).toBeLessThanOrEqual(ms(e.window.end));
    }
  });

  it("fall on the days their formats need: a Wednesday, a Sunday and two Mondays", () => {
    expect(weekday(EDITIONS.weekday.date)).toBe(3);
    expect(weekday(EDITIONS.sunday.date)).toBe(0);
    expect(weekday(EDITIONS.monday.date)).toBe(1);
    expect(weekday(EDITIONS["monday-short"].date)).toBe(1);
    expect(EDITION_NAMES.map((n) => EDITIONS[n].format)).toEqual(["daily", "sunday_deep_dive", "monday_review", "monday_review"]);
  });

  it("give a Monday the week it reviews, Monday to Sunday, and no other edition one", () => {
    for (const name of EDITION_NAMES) {
      const e = EDITIONS[name];
      if (e.format !== "monday_review") {
        expect(e.week).toBeNull();
        continue;
      }
      expect(e.week).toEqual({ start: addDays(e.date, -7), end: addDays(e.date, -1) });
      expect(weekday(e.week!.start)).toBe(1);
      expect(weekday(e.week!.end)).toBe(0);
    }
  });
});

// ── The sources ──────────────────────────────────────────────────────────────────────────────────

describe("the sources of the world", () => {
  it("hold forty or more invented pages with one address each", () => {
    expect(SOURCE_KEYS.length).toBeGreaterThanOrEqual(40);
    const urls = SOURCE_KEYS.map((k) => normalizeUrl(SOURCE_TABLE[k].url));
    expect(new Set(urls).size).toBe(urls.length);
    for (const k of SOURCE_KEYS) expect(sourceKeyOfUrl(SOURCE_TABLE[k].url)).toBe(k);
    expect(sourceKeyOfUrl("https://www.nature.com/articles/never-seen")).toBeUndefined();
    expect(seenTextOfUrl("https://www.nature.com/articles/never-seen")).toBeUndefined();
  });

  it.each(SOURCE_KEYS)("%s: a primary address of its kind, an invented and marked page", (key) => {
    const s = SOURCE_TABLE[key];
    expect(s.url).toMatch(/^https:\/\//);
    expect(blockedEntry(s.url)).toBeNull();
    expect(allowedFor(s.url, s.kind), `${s.url} is not a primary address for ${s.kind}`).toBe(true);
    expect(s.title.startsWith("SAMPLE")).toBe(true);
    expect(s.text.startsWith("SAMPLE page")).toBe(true);
    expect(s.text.length).toBeLessThanOrEqual(1000);
    expect(`${s.title} ${s.text} ${s.publisher}`).not.toContain(EM);
    expect(`${s.title}\n${s.text}`).toBe(seenText(key));
    // It is a source a draft could carry: its fields fit DraftSource.
    expect(DraftFindingSource.safeParse(draftSources([key], "s")[0]).success).toBe(true);
    if (s.doi !== null) {
      expect(normalizeDoi(s.doi)).toBe(s.doi);
      expect(`${s.url} ${s.text}`).toContain(s.doi);
    }
    if (s.seen === "pack") expect(s.feed, "a page seen in the pack names its feed").toBeTruthy();
  });

  it("number a draft's sources in order, s for a finding and b for the brief", () => {
    const keys: SourceKey[] = ["scroll-paper", "scroll-nv", "scroll-smc"];
    expect(draftSources(keys, "s").map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(draftSources(keys, "b").map((s) => s.id)).toEqual(["b1", "b2", "b3"]);
    expect(sourceIds(keys, "b")).toEqual({ "scroll-paper": "b1", "scroll-nv": "b2", "scroll-smc": "b3" });
  });
});

// ── The findings of the world ─────────────────────────────────────────────────────────────────────

describe("the findings of the world, taken together", () => {
  it("hold fifteen findings across all seven fields, every rung, every AI role, every kind and every significance", () => {
    expect(FINDING_KEYS).toHaveLength(15);
    const all = FINDING_KEYS.map(spec);
    expect(new Set(all.map((f) => f.field))).toEqual(new Set(FIELDS));
    expect(new Set(all.flatMap((f) => f.rung_history.map((r) => r.rung)))).toEqual(new Set(ALL_RUNGS));
    expect(new Set(all.map((f) => f.ai.role))).toEqual(new Set(AI_ROLES));
    expect(new Set(all.map((f) => f.kind))).toEqual(new Set(FINDING_KINDS));
    expect(new Set(all.map((f) => f.significance))).toEqual(new Set(SIGNIFICANCE));
    expect(new Set(all.map((f) => f.ai.confidence))).toEqual(new Set(["confirmed", "claimed", null]));
  });

  it("have unique ids that map back to their handles", () => {
    const ids = FINDING_KEYS.map(findingId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of FINDING_KEYS) expect(findingKeyOfId(findingId(k))).toBe(k);
    expect(findingKeyOfId("math-2026-9999")).toBeUndefined();
  });

  it("number what an edition shows first as publish would: the next counters after the highest stored before it, in display order (SPEC §4.3)", () => {
    const counter = (id: string): number => Number(id.slice(-4));
    for (const name of EDITION_NAMES) {
      const plan = PLANS[name];
      const stored = keysStoredBefore(EDITIONS[name].date).map((k) => counter(findingId(k)));
      const highest = stored.length > 0 ? Math.max(...stored) : 0;
      const display = [...(plan.story === null ? [] : [plan.story]), ...plan.items].filter((k) => plan.newFindings.includes(k));
      expect(display, `${name}: the refs follow the display order`).toEqual([...plan.newFindings]);
      expect(display.map((k) => counter(findingId(k))), name).toEqual(display.map((_, i) => highest + i + 1));
    }
  });

  it("share no DOI, arXiv id, trial id, PDB id or Lean file, which DUPLICATE would read as one finding", () => {
    for (const kind of ["doi", "arxiv", "trial", "pdb", "lean"] as const) {
      const values = FINDING_KEYS.flatMap((k) => spec(k).artefacts[kind].map((v) => (kind === "doi" ? normalizeDoi(v) : v)));
      expect(new Set(values).size, `a ${kind} repeats`).toBe(values.length);
    }
  });

  it("give no two findings of one field titles that are alike (DUPLICATE reads Jaccard 0.6 and more)", () => {
    for (const a of FINDING_KEYS) {
      for (const b of FINDING_KEYS) {
        if (a >= b || spec(a).field !== spec(b).field) continue;
        expect(jaccard(spec(a).title, spec(b).title), `${a} and ${b}`).toBeLessThan(0.6);
      }
    }
  });

  it("define each glossary term once, in a finding that uses it, and store the terms sorted by id", () => {
    const terms = FINDING_KEYS.flatMap((k) => spec(k).terms.map((t) => ({ key: k, id: termId(t.term), term: t.term })));
    expect(new Set(terms.map((t) => t.id)).size).toBe(terms.length);
    const glossary = storedGlossary();
    expect(glossary.terms.map((t) => t.id)).toEqual(terms.map((t) => t.id).sort());
    for (const t of glossary.terms) expect(findingKeyOfId(t.first_finding)).toBeDefined();
    // What the glossary held before an edition is what its earlier findings defined.
    expect(storedGlossary(EDITIONS.weekday.date).terms.map((t) => t.id)).toEqual(["antimicrobial-resistance", "numerical-weather-prediction", "plasma"]);
    expect(storedGlossary("2026-09-01").terms).toEqual([]);
  });

  it("keep every related finding stored before the one that names it, and never itself", () => {
    for (const k of FINDING_KEYS) {
      for (const r of spec(k).related) {
        expect(r).not.toBe(k);
        expect(firstBrief(r) < firstBrief(k), `${k} names ${r}, which is not stored before it`).toBe(true);
      }
      expect(spec(k).related.length).toBeLessThanOrEqual(5);
      expect(spec(k).reactions.length).toBeLessThanOrEqual(4);
    }
  });

  it("know which findings each edition stored before it and first showed", () => {
    expect(keysStoredBefore(EDITIONS.monday.date)).toEqual(["disputedOld", "fellW0", "tilings", "weather", "catalyst", "antibiotic", "retractW0", "policy", "survey"]);
    expect(keysStoredBefore(EDITIONS.weekday.date)).toEqual([...keysStoredBefore(EDITIONS.monday.date), "plasma"]);
    expect(keysStoredBefore(EDITIONS.sunday.date)).toEqual([...keysStoredBefore(EDITIONS.weekday.date), "scroll", "protein", "retractWD", "erdos"]);
    expect(keysStoredBefore(EDITIONS["monday-short"].date)).toEqual([...FINDING_KEYS]);
    expect(keysFirstShownOn(EDITIONS.weekday.date)).toEqual(["scroll", "protein", "retractWD", "erdos"]);
    expect(keysFirstShownOn(EDITIONS.sunday.date)).toEqual(["translation"]);
    expect(keysFirstShownOn(EDITIONS.monday.date)).toEqual(["plasma"]);
    expect(keysFirstShownOn(EDITIONS["monday-short"].date)).toEqual([]);
    expect(storedFindingsBefore(EDITIONS.weekday.date).map((f) => f.id)).toEqual(keysStoredBefore(EDITIONS.weekday.date).map(findingId));
  });
});

describe.each([...FINDING_KEYS])("the world's finding %s", (key) => {
  const s = spec(key);
  const keys = s.sources.map((x) => x.key);
  const first = firstBrief(key);
  const addedOn = (src: SourceKey): string => s.sources.find((x) => x.key === src)!.added;
  const atFirst = s.rung_history.filter((r) => r.recorded <= first);
  const current = atFirst[atFirst.length - 1]!;

  it("has an id of its field, numbered in publication order", () => {
    expect(s.id).toMatch(/^(math|phys|chem|bio|earth|soc|hum)-2026-\d{4}$/);
    expect(s.id.startsWith(`${FIELD_CODE_OF[s.field]}-`)).toBe(true);
    const i = FINDING_KEYS.indexOf(key);
    if (i > 0) expect(compareFindingIds(findingId(FINDING_KEYS[i - 1]!), s.id)).toBeLessThan(0);
    const subfields = fieldsConfig.fields.find((f) => f.id === s.field)!.subfields.map((x) => x.id);
    expect(subfields).toContain(s.subfield);
  });

  it("lists its editions oldest first, none before the result was public", () => {
    expect(s.briefs.length).toBeGreaterThanOrEqual(1);
    for (const [i, d] of s.briefs.entries()) {
      expect(isValidDate(d)).toBe(true);
      if (i > 0) expect(d > s.briefs[i - 1]!).toBe(true);
    }
    expect(s.first_published <= first).toBe(true);
  });

  it("is stored as a valid record, and is not stored before its first brief", () => {
    const stored = storedFinding(key);
    expect(stored.id).toBe(s.id);
    expect(stored.first_brief).toBe(first);
    expect(stored.briefs).toEqual(s.briefs);
    expect(stored.rung).toBe(s.rung_history[s.rung_history.length - 1]!.rung);
    expect(() => storedFinding(key, first)).toThrow();
    const afterFirst = storedFinding(key, addDays(first, 1));
    expect(afterFirst.briefs).toEqual([first]);
    expect(afterFirst.rung).toBe(current.rung);
    expect(afterFirst.sources.every((x) => x.added <= first)).toBe(true);
  });

  it("cites only its own sources, each added no earlier than it was published", () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const x of s.sources) {
      expect(x.added >= publishedDate(x.key), `${x.key} is added before it is published`).toBe(true);
      expect(x.added >= first, `${x.key} is added before the first brief`).toBe(true);
    }
    const used = [
      ...s.go_deeper, ...s.ai.evidence.map((e) => e.source), ...s.reactions.map((r) => r.source),
      ...(s.figure === null ? [] : [s.figure.source]), ...s.rung_history.map((r) => r.source), ...s.since_then.flatMap((t) => t.sources),
    ];
    for (const u of used) expect(keys, `${u} is not one of the finding's sources`).toContain(u);
    // What a reader of the first brief sees is built from sources that were there on that day.
    for (const u of [...s.go_deeper, ...s.ai.evidence.map((e) => e.source), ...s.reactions.map((r) => r.source)]) {
      expect(addedOn(u) <= first, `${u} is used on the first brief but added later`).toBe(true);
    }
    for (const r of s.rung_history) expect(addedOn(r.source) <= r.recorded).toBe(true);
    for (const t of s.since_then) for (const u of t.sources) expect(addedOn(u) <= t.date).toBe(true);
  });

  it("lists one to three primary sources under go deeper, of the kinds GO_DEEPER takes", () => {
    expect(s.go_deeper.length).toBeGreaterThanOrEqual(1);
    expect(s.go_deeper.length).toBeLessThanOrEqual(3);
    const allowed = ["paper", "preprint", "proof", "dataset", "registry", "checker", "statement", "lab_post", ...(s.kind === "setback" ? ["notice"] : [])];
    for (const u of s.go_deeper) expect(allowed).toContain(SOURCE_TABLE[u].kind);
  });

  it("fits RUNG_EVIDENCE on each rung entry, with dates in order and none after its own edition", () => {
    const first = SOURCE_TABLE[s.rung_history[0]!.source];
    const original = {
      publishers: [first.publisher], who: s.who.map((w) => w.name),
      sources: [{ id: s.rung_history[0]!.source, url: first.url, doi: first.doi }],
    };
    for (const [i, r] of s.rung_history.entries()) {
      const src = SOURCE_TABLE[r.source];
      const facts: EvidenceFacts = {
        setback: s.kind === "setback", checkerRungs: null, trial: s.artefacts.trial.length > 0,
        independent: i > 0 && isIndependent(src.publisher, src.kind, original, { url: src.url, doi: src.doi }),
      };
      expect(evidenceFits(r.rung, src.kind, facts), `${r.rung} cites a ${src.kind} from ${src.publisher}`).toBe(true);
      expect(r.date <= r.recorded).toBe(true);
      if (i > 0) expect(r.recorded >= s.rung_history[i - 1]!.recorded).toBe(true);
      const note = typeof r.note === "string" || r.note === null ? r.note : r.note.en;
      expect(countWords(note)).toBeLessThanOrEqual(25);
    }
    expect(rungOrderProblem(s.rung_history, s.rung_history[s.rung_history.length - 1]!.recorded)).toBeNull();
  });

  it("holds to the significance rules as first published", () => {
    const f = { kind: s.kind, significance: s.significance, ai: s.ai };
    expect(exceedsClaimedCap(current.rung, s.significance)).toBe(false);
    expect(breaksNonAiLandmarkOnly(f)).toBe(false);
    expect(breaksSetbackMajor(f)).toBe(false);
    expect(isBriefable(f)).toBe(true);
    if (s.significance === "landmark") {
      const affiliations = new Set(s.reactions.map((r) => r.affiliation));
      const whoNames = s.who.map((w) => w.name.toLowerCase());
      const own = s.reactions.some((r) => whoNames.some((w) => w.includes(r.affiliation.toLowerCase()) || r.affiliation.toLowerCase().includes(w)));
      expect(affiliations.size >= 2 && !own, "a Landmark rests on two reactions from other affiliations").toBe(true);
    }
  });

  it("says who says so: the rung's label first, the publisher of its source, the maker when the AI role is claimed", () => {
    const label = RUNG_INFO[current.rung].en;
    const howSure = s.explainer.how_sure;
    expect(howSure.startsWith(label)).toBe(true);
    expect(howSure.toLowerCase()).toContain(SOURCE_TABLE[current.source].publisher.toLowerCase());
    if (s.ai.confidence === "claimed") {
      for (const sys of s.ai.systems) expect(howSure.toLowerCase()).toContain(sys.maker.toLowerCase());
    }
    expect(/\b(could|might|may|if|possibility|possible)\b/i.test(s.explainer.could_lead)).toBe(true);
    expect(/will (cure|solve)/i.test(s.explainer.could_lead)).toBe(false);
  });

  it("names its AI role consistently: a system and its maker in ai_helped, evidence a source holds, a confirmation from outside the claimant", () => {
    const none = s.ai.role === "none";
    expect(s.explainer.ai_helped === null).toBe(none);
    expect(s.ai.confidence === null).toBe(none);
    expect(s.ai.evidence.length === 0).toBe(none);
    if (!none) {
      if (s.ai.systems.length === 0) expect(["setback", "infrastructure", "policy_people"]).toContain(s.kind);
      for (const sys of s.ai.systems) {
        expect(s.explainer.ai_helped!.toLowerCase()).toContain(sys.name.toLowerCase());
        expect(s.explainer.ai_helped!.toLowerCase()).toContain(sys.maker.toLowerCase());
      }
      if (s.ai.confidence === "confirmed") expect(s.ai.evidence.some((e) => !e.from_claimant)).toBe(true);
    }
    expect(s.ai.systems.length === 0 || !none).toBe(true);
  });

  it("quotes its sources word for word and briefly", () => {
    const quotes = [
      ...s.ai.evidence.map((e) => ({ source: e.source, quote: e.quote })),
      ...s.reactions.map((r) => ({ source: r.source, quote: r.quote })),
      ...(s.figure === null ? [] : [{ source: s.figure.source, quote: s.figure.licence_quote }]),
    ];
    for (const q of quotes) {
      expect(countWords(q.quote)).toBeLessThanOrEqual(25);
      expect(quoteInText(q.quote, seenText(q.source)), `"${q.quote}" is not in ${q.source}`).toBe(true);
    }
    for (const r of s.reactions) expect(SOURCE_TABLE[r.source].kind).toBe("reaction");
  });

  it("keeps each artefact in the address or the text of a source it cites, in its own format", () => {
    const pool = keys.map((k) => `${SOURCE_TABLE[k].url}\n${seenText(k)}`).join("\n").toLowerCase();
    for (const d of s.artefacts.doi) {
      expect(d).toMatch(/^10\.\d{4,9}\/\S+$/);
      expect(pool).toContain(d.toLowerCase());
    }
    for (const a of s.artefacts.arxiv) {
      expect(a).toMatch(/^\d{4}\.\d{4,5}$/);
      expect(pool).toContain(a);
    }
    for (const t of s.artefacts.trial) {
      expect(t).toMatch(/^NCT\d{8}$/);
      expect(pool).toContain(t.toLowerCase());
    }
    for (const p of s.artefacts.pdb) {
      expect(p).toMatch(/^(?:[0-9][a-z0-9]{3}|pdb_[0-9a-z]{8})$/);
      expect(pool).toContain(p);
    }
    for (const l of s.artefacts.lean) {
      expect(l).toMatch(/^https:\/\/github\.com\/.+\.lean$/);
      expect(keys.map((k) => normalizeUrl(SOURCE_TABLE[k].url))).toContain(normalizeUrl(l));
    }
    // A setback's artefacts hold only the records of its own report, never the papers it reports as retracted.
    if (s.kind === "setback") expect(Object.values(s.artefacts).flat()).toEqual([]);
  });

  it("passes every prose check as its first brief carried it", () => {
    const d = soloDraft(key);
    const landmark = s.significance === "landmark" ? ["new_findings.0"] : [];
    const problems = [
      ...budgetProblems(d), ...sentenceProblems(d), ...gradeProblems(d), ...termProblems(d), ...hypeProblems(d, landmark),
      ...dashProblems(d), ...agentProblems(d), ...numberProblems(d, seenTextOfUrl), ...quoteProblems(d, seenTextOfUrl), ...urlProblems(d),
    ];
    expect(problems).toEqual([]);
  });

  it("holds its later notes to the same limits, with their numbers in the sources that show them", () => {
    for (const t of s.since_then) {
      expect(countWords(t.text)).toBeLessThanOrEqual(60);
      for (const sentence of splitSentences(t.text)) expect(countWords(sentence)).toBeLessThanOrEqual(24);
      expect(missingNumbers(t.text, t.sources.map(seenText))).toEqual([]);
      expect(t.text).not.toContain(EM);
      expect(t.date >= first).toBe(true);
    }
  });

  it("marks every invented person and title as sample text", () => {
    expect(s.title.startsWith("SAMPLE")).toBe(true);
    for (const w of s.who) expect(w.name).toContain("SAMPLE");
    for (const r of s.reactions) expect(r.who.endsWith("(SAMPLE)")).toBe(true);
    if (s.figure !== null) expect(s.figure.credit).toContain("SAMPLE");
  });
});

// ── The stored views, the reports and the corrections ────────────────────────────────────────────

describe("the stored records of the world", () => {
  it("show a finding as it stood before an edition: later rung entries, notes and sources are left out", () => {
    const antibioticBefore = storedFinding("antibiotic", "2026-10-16");
    expect(antibioticBefore.rung).toBe("checked");
    expect(antibioticBefore.since_then).toEqual([]);
    expect(antibioticBefore.sources.map((x) => x.id)).toEqual(["s1", "s2", "s3"]);
    const antibioticNow = storedFinding("antibiotic", "2026-10-17");
    expect(antibioticNow.rung).toBe("confirmed");
    expect(antibioticNow.since_then).toHaveLength(1);
    expect(antibioticNow.sources.map((x) => x.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(antibioticNow.briefs).toEqual(["2026-10-08", "2026-10-16"]);
    expect(antibioticNow.updated).toBe("2026-10-16");
    const fell = storedFinding("fellW0");
    expect(fell.rung).toBe("retracted");
    expect(fell.rung_history.map((r) => r.by)).toEqual(["agent", "script"]);
    expect(storedFinding("fellW0", "2026-10-09").rung).toBe("checked");
  });

  it("give the weather and tilings findings the first texts the two corrections correct", () => {
    const corrections = storedWeekdayCorrections();
    expect(corrections.map((c) => c.id)).toEqual(["C-0001", "C-0002"]);
    for (const [i, c] of corrections.entries()) {
      const source = WEEKDAY_CORRECTIONS[i]!;
      expect(c.finding_id).toBe(findingId(source.finding));
      expect(c.date).toBe(EDITIONS.weekday.date);
      expect(c.trigger).toBe("reader_report");
      expect(c.report_id).toBe(source.answers);
      expect(c.before.en).not.toBe(c.after.en);
      expect(c.source_url).toBe(SOURCE_TABLE[source.source].url);
      // The corrected text keeps the whole replaced text but the fact it puts right: it is no shorter than a part.
      expect(c.after.en.length).toBeLessThanOrEqual(300);
    }
  });

  it("hold the two reports of the weekday: one JL upheld, one open, and after the run both answered", () => {
    const before = reportsBeforeWeekday();
    expect(before.map((r) => [r.id, r.status, r.decided_by, r.correction_id])).toEqual([["R-0001", "upheld", "jl", null], ["R-0002", "open", null, null]]);
    const after = reportsAfterWeekday();
    expect(after.map((r) => [r.id, r.status, r.decided_by, r.correction_id])).toEqual([
      ["R-0001", "upheld", "jl", "C-0002"], ["R-0002", "upheld", "claude", "C-0001"],
    ]);
    expect(after[1]!.resolved_on).toBe(EDITIONS.weekday.date);
    expect(before.map((r) => r.finding_id)).toEqual([findingId("weather"), findingId("tilings")]);
    expect(before.every((r) => r.received < EDITIONS.weekday.contextAt)).toBe(true);
    expect(before[0]!.resolved_on! >= before[0]!.received.slice(0, 10)).toBe(true);
    expect(before.every((r) => r.evidence_url !== null && sourceKeyOfUrl(r.evidence_url) !== undefined)).toBe(true);
  });
});

// ── The valid drafts: files and builders ─────────────────────────────────────────────────────────

describe("the valid drafts", () => {
  it.each(EDITION_NAMES)("%s: its file parses as a DraftBrief and is what the builder makes, byte for byte", (name) => {
    const file = path.join(REPO_ROOT, validDraftPath(name));
    expect(path.basename(file)).toBe(`valid-${name}.json`);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toBe(jsonText(editionDraft(name), DraftBrief));
    expect(text.endsWith("}\n")).toBe(true);
    expect(DraftBrief.parse(JSON.parse(text))).toEqual(editionDraft(name));
  });

  it("come as deep copies: a caller may change one without changing the next", () => {
    for (const name of EDITION_NAMES) {
      const a = editionDraft(name);
      const b = editionDraft(name);
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
      a.lead.length = 0;
      a.sources.push(a.sources[0] ?? ({} as never));
      a.corrections = [];
      if (a.new_findings[0]) a.new_findings[0].title = "changed";
      expect(editionDraft(name)).toEqual(b);
    }
    expect(weekdayDraft()).toEqual(editionDraft("weekday"));
    expect(sundayDraft()).toEqual(editionDraft("sunday"));
    expect(mondayDraft()).toEqual(editionDraft("monday"));
    expect(mondayShortDraft()).toEqual(editionDraft("monday-short"));
  });

  it("carry the date, the time and the format of their edition", () => {
    for (const name of EDITION_NAMES) {
      const d = editionDraft(name);
      expect(d.date).toBe(EDITIONS[name].date);
      expect(d.generated_at).toBe(EDITIONS[name].generatedAt);
      expect(d.schema_version).toBe(1);
      expect(d.deep_dive !== null).toBe(EDITIONS[name].format === "sunday_deep_dive");
      expect(d.review !== null).toBe(EDITIONS[name].format === "monday_review");
    }
  });

  it("list in their plans what they hold: new findings, story, items, returning, rung changes, deep dive, review and brief sources", () => {
    for (const name of EDITION_NAMES) {
      const d = editionDraft(name);
      const plan = PLANS[name];
      expect(d.new_findings.map((f) => f.ref)).toEqual(plan.newFindings.map((_, i) => `new-${i + 1}`));
      for (const [i, key] of plan.newFindings.entries()) {
        expect(firstBrief(key)).toBe(EDITIONS[name].date);
        expect(d.new_findings[i]).toEqual(draftFinding(key, `new-${i + 1}`));
      }
      expect(d.story).toBe(plan.story === null ? null : refOf(name, plan.story));
      expect(d.items).toEqual(plan.items.map((k) => refOf(name, k)));
      expect(d.returning.map((r) => r.finding_id)).toEqual(plan.returning.map(findingId));
      expect(d.rung_changes.map((r) => r.finding_id)).toEqual(plan.rungChanges.map(findingId));
      expect(d.deep_dive?.finding_id ?? null).toBe(plan.deepDive === null ? null : findingId(plan.deepDive));
      expect(d.review?.remarkable?.finding_id ?? null).toBe(plan.remarkable === null ? null : findingId(plan.remarkable));
      expect(d.review?.strongest_against.finding_ids ?? []).toEqual(plan.against.map(findingId).sort(compareFindingIds));
      expect(d.sources).toEqual(draftSources(plan.briefSources, "b"));
      expect(briefSourceIds(name)).toEqual(sourceIds(plan.briefSources, "b"));
      for (const key of plan.returning) expect(firstBrief(key) < EDITIONS[name].date).toBe(true);
    }
    expect(() => briefSourceId("weekday", "plasma-paper")).toThrow();
    expect(briefSourceId("weekday", "policy-final")).toBe("b1");
  });

  it("resolve every ref, use each new finding once, and cite every brief-level source", () => {
    for (const name of EDITION_NAMES) {
      const d = editionDraft(name);
      const known = new Set([...d.new_findings.map((f) => f.ref), ...FINDING_KEYS.map(findingId)]);
      for (const ref of [...d.lead.flatMap((l) => l.refs), ...(d.story === null ? [] : [d.story]), ...d.items]) expect(known.has(ref), ref).toBe(true);
      const placed = [...(d.story === null ? [] : [d.story]), ...d.items];
      for (const f of d.new_findings) expect(placed.filter((r) => r === f.ref)).toHaveLength(1);
      expect(new Set(placed).size).toBe(placed.length);
      // Every brief-level source is cited by something, and everything cited exists.
      const cited = new Set([
        ...d.returning.flatMap((r) => r.source_ids), ...d.rung_changes.map((r) => r.rung.source_id), ...d.ideas.map((i) => i.source_id),
        ...d.also.map((a) => a.source_id), ...(d.deep_dive?.source_ids ?? []), ...(d.review?.strongest_against.source_ids ?? []),
        ...d.returning.flatMap((r) => (r.rung ? [r.rung.source_id] : [])),
      ].filter((id) => id.startsWith("b")));
      expect([...cited].sort()).toEqual(d.sources.map((s) => s.id).sort());
      for (const [i, s] of d.sources.entries()) expect(s.id).toBe(`b${i + 1}`);
    }
  });

  it("hold their findings within the counts: at most five, two to a field, two ideas, five also-noted lines", () => {
    for (const name of EDITION_NAMES) {
      const d = editionDraft(name);
      const placed = [...(d.story === null ? [] : [d.story]), ...d.items];
      expect(placed.length).toBeLessThanOrEqual(run.budgets.findings_max);
      expect(d.ideas.length).toBeLessThanOrEqual(2);
      expect(d.also.length).toBeLessThanOrEqual(5);
      const fieldOf = (ref: string): string => {
        const fresh = d.new_findings.find((f) => f.ref === ref);
        return fresh !== undefined ? fresh.field : spec(findingKeyOfId(ref)!).field;
      };
      for (const field of FIELDS) expect(placed.filter((r) => fieldOf(r) === field).length).toBeLessThanOrEqual(2);
      if (EDITIONS[name].format !== "daily") expect(placed.length).toBeLessThanOrEqual(2);
      // The story's significance is at least every item's (STORY_PICK).
      const sig = (ref: string) => (d.new_findings.find((f) => f.ref === ref)?.significance ?? spec(findingKeyOfId(ref)!).significance);
      if (d.story !== null) for (const i of d.items) expect(significanceAtLeast(sig(d.story), sig(i))).toBe(true);
      if (d.story !== null && EDITIONS[name].format !== "daily") expect(significanceAtLeast(sig(d.story), "major")).toBe(true);
    }
  });
});

describe("the weekday draft", () => {
  const d = weekdayDraft();

  it("is a Wednesday of four or five findings with a story, mixed in kind, significance, rung and AI role", () => {
    expect(weekday(d.date)).toBe(3);
    const placed = [d.story!, ...d.items];
    expect(placed.length).toBeGreaterThanOrEqual(4);
    expect(placed.length).toBeLessThanOrEqual(5);
    expect(d.new_findings.length).toBeGreaterThanOrEqual(3);
    expect(new Set(d.new_findings.map((f) => f.kind))).toEqual(new Set(["result", "setback"]));
    expect(new Set(d.new_findings.map((f) => f.significance))).toEqual(new Set(["landmark", "major", "notable"]));
    const rungs = new Set(d.new_findings.flatMap((f) => f.rung_history.map((r) => r.rung)));
    for (const r of ["preprint", "checked", "confirmed"] as const) expect(rungs.has(r)).toBe(true);
    expect(new Set(d.new_findings.map((f) => f.ai.role)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(d.new_findings.map((f) => f.ai.confidence))).toEqual(new Set(["confirmed", "claimed"]));
  });

  it("has a Lead of one to three sentences that cite findings", () => {
    expect(d.lead.length).toBeGreaterThanOrEqual(1);
    expect(d.lead.length).toBeLessThanOrEqual(3);
    for (const l of d.lead) {
      expect(l.refs.length).toBeGreaterThanOrEqual(1);
      expect(splitSentences(l.text)).toHaveLength(1);
    }
    expect(d.lead.reduce((n, l) => n + countWords(l.text), 0)).toBeLessThanOrEqual(60);
  });

  it("holds the story: a Landmark with a figure, two reactions from other affiliations, a confirmed AI role and two new terms", () => {
    const f = newFindingOf(d, WEEKDAY_ITEMS.story);
    expect(d.story).toBe(WEEKDAY_ITEMS.story);
    expect(WEEKDAY_ITEMS.landmark).toBe(WEEKDAY_ITEMS.story);
    expect(WEEKDAY_ITEMS.figure).toBe(WEEKDAY_ITEMS.story);
    expect(f.significance).toBe("landmark");
    expect(f.reactions.length).toBeGreaterThanOrEqual(2);
    expect(new Set(f.reactions.map((r) => r.affiliation)).size).toBeGreaterThanOrEqual(2);
    for (const r of f.reactions) expect(f.who.map((w) => w.name).join(" ")).not.toContain(r.affiliation);
    expect(f.figure).not.toBeNull();
    expect(FIGURE_HOSTS).toContain(hostOf(f.figure!.image_url));
    expect(f.figure!.licence).toBe("CC-BY-4.0");
    expect(f.figure!.licence_quote).toContain("Creative Commons Attribution 4.0");
    expect(f.figure!.source_id).toMatch(/^s\d+$/);
    expect(f.ai.confidence).toBe("confirmed");
    expect(f.ai.evidence.some((e) => !e.from_claimant)).toBe(true);
    expect(f.terms.filter((t) => t.new)).toHaveLength(2);
    expect(f.artefacts.doi).toHaveLength(1);
  });

  it("holds a Major result confirmed by an independent paper, with a DOI, a PDB entry and a trial id", () => {
    const f = newFindingOf(d, WEEKDAY_ITEMS.result);
    expect(f.kind).toBe("result");
    expect(f.significance).toBe("major");
    expect(f.rung_history.map((r) => r.rung)).toEqual(["preprint", "confirmed"]);
    expect(f.artefacts.doi.length).toBeGreaterThanOrEqual(1);
    expect(f.artefacts.pdb).toHaveLength(1);
    expect(f.artefacts.trial).toHaveLength(1);
    expect(f.explainer.how_sure.startsWith("Confirmed")).toBe(true);
    expect(f.related).toEqual([findingId("antibiotic")]);
  });

  it("holds a Major setback built from the publisher's statement and its retraction notices, with no system named", () => {
    const f = newFindingOf(d, WEEKDAY_ITEMS.setback);
    expect(f.kind).toBe("setback");
    expect(f.significance).toBe("major");
    expect(f.ai.role).not.toBe("none");
    expect(f.ai.systems).toEqual([]);
    const kinds = f.sources.map((s) => s.kind);
    expect(kinds).toContain("statement");
    expect(kinds.filter((k) => k === "notice").length).toBeGreaterThanOrEqual(2);
    expect(f.rung_history).toHaveLength(1);
    expect(f.rung_history[0]!.rung).toBe("checked");
    expect(f.artefacts).toEqual({ doi: [], arxiv: [], lean: [], trial: [], pdb: [] });
  });

  it("holds a claimed finding that names its maker in how_sure, with an arXiv id and a Lean file", () => {
    const f = newFindingOf(d, WEEKDAY_ITEMS.claimed);
    expect(f.ai.confidence).toBe("claimed");
    expect(f.ai.systems.length).toBeGreaterThanOrEqual(1);
    for (const sys of f.ai.systems) expect(f.explainer.how_sure).toContain(sys.maker);
    expect(f.rung_history.map((r) => r.rung)).toEqual(["preprint"]);
    expect(f.artefacts.arxiv).toHaveLength(1);
    expect(f.artefacts.lean).toHaveLength(1);
    expect(f.significance).toBe("notable");
  });

  it("holds DOIs, an arXiv id, a trial id, a PDB id and a Lean file among its artefacts", () => {
    const all = (kind: "doi" | "arxiv" | "trial" | "pdb" | "lean") => d.new_findings.flatMap((f) => f.artefacts[kind]);
    for (const kind of ["doi", "arxiv", "trial", "pdb", "lean"] as const) expect(all(kind).length, kind).toBeGreaterThanOrEqual(1);
  });

  it("holds a returning finding with its new fact and a rung change on a finding that is not shown", () => {
    expect(d.returning).toHaveLength(1);
    const r = d.returning[0]!;
    expect(r.finding_id).toBe(WEEKDAY_ITEMS.returning);
    expect(d.items).toContain(WEEKDAY_ITEMS.returning);
    expect(r.update).toBe(returningFact("policy", d.date).text);
    expect(r.source_ids.every((id) => id.startsWith("b"))).toBe(true);
    expect(r.rung).toBeNull();
    expect(d.rung_changes).toHaveLength(1);
    const c = d.rung_changes[0]!;
    expect(c.finding_id).toBe(WEEKDAY_ITEMS.rungChange);
    expect([d.story, ...d.items]).not.toContain(c.finding_id);
    const entry = rungEntryOf("catalyst", "confirmed", d.date);
    expect(c.rung).toEqual({ rung: "confirmed", date: entry.date, source_id: briefSourceId("weekday", entry.source), note: entry.note });
    expect(c.rung.date <= d.date).toBe(true);
  });

  it("holds ideas, also-noted lines and new glossary terms that its findings use", () => {
    expect(d.ideas).toHaveLength(2);
    expect(d.also).toHaveLength(2);
    for (const i of d.ideas) {
      expect(i.who).toContain("(SAMPLE)");
      expect(d.sources.find((s) => s.id === i.source_id)!.kind).toBe("reaction");
    }
    const terms = d.new_findings.flatMap((f) => f.terms);
    expect(terms.length).toBeGreaterThanOrEqual(3);
    expect(terms.every((t) => t.new)).toBe(true);
    expect(termProblems(d)).toEqual([]);
  });

  it("answers its two reports: the correction for the one JL upheld is the last, another is of another type, and one decision answers the open report", () => {
    expect(d.corrections.length).toBeGreaterThanOrEqual(2);
    const last = d.corrections[d.corrections.length - 1]!;
    expect(last.report_id).toBe(WEEKDAY_REPORTS.upheld);
    expect(WEEKDAY_REPORTS.upheldCorrection).toBe(d.corrections.length - 1);
    expect(d.corrections.slice(0, -1).some((c) => c.type !== last.type)).toBe(true);
    expect(d.corrections.slice(0, -1).every((c) => c.report_id === null)).toBe(true);
    expect(d.report_decisions).toEqual([WEEKDAY_DECISION]);
    expect(d.report_decisions[0]!.report_id).toBe(WEEKDAY_REPORTS.open);
    expect(d.report_decisions[0]!.correction).toBe(WEEKDAY_REPORTS.openCorrection);
    const answered = d.corrections[WEEKDAY_REPORTS.openCorrection]!;
    expect(answered.finding_id).toBe(WEEKDAY_ITEMS.tilings);
    expect(last.finding_id).toBe(WEEKDAY_ITEMS.weather);
    for (const c of d.corrections) {
      expect(c.after.length).toBeLessThanOrEqual(300);
      expect(c.source_url !== null && sourceKeyOfUrl(c.source_url) !== undefined).toBe(true);
      expect(c.edition_date).toBeNull();
      expect(c.term_id).toBeNull();
    }
    // The text a correction puts right keeps the rest of the replaced part: the corrected how_sure starts with its rung's label.
    expect(last.path).toBe("explainer.how_sure");
    expect(last.after.startsWith(RUNG_INFO.applied.en)).toBe(true);
  });

  it("leaves headroom under the page-total ceiling, so a soft mutation can pass the target and stay under the limit", () => {
    expect(pageWords(d)).toBeGreaterThanOrEqual(600);
    expect(pageWords(d)).toBeLessThanOrEqual(900);
  });
});

describe("the Sunday draft", () => {
  const d = sundayDraft();

  it("is a Sunday with one new finding, no story, and a deep dive on the biology finding, for news", () => {
    expect(weekday(d.date)).toBe(0);
    expect(d.story).toBeNull();
    expect(d.items).toEqual([SUNDAY_ITEMS.item]);
    expect(d.new_findings).toHaveLength(1);
    expect(d.returning).toEqual([]);
    expect(d.review).toBeNull();
    const dive = d.deep_dive!;
    expect(dive.finding_id).toBe(SUNDAY_ITEMS.deepDive);
    expect(spec(findingKeyOfId(dive.finding_id)!).field).toBe("biology");
    expect(dive.why_today).toBe("news");
    expect(dive.source_ids).toEqual(d.sources.map((s) => s.id));
  });

  it("makes the deep dive a candidate of the Ledger: stored before D - 6, with a record, note or source of the last week", () => {
    const key = findingKeyOfId(SUNDAY_ITEMS.deepDive)!;
    const s = spec(key);
    expect(firstBrief(key) < addDays(d.date, -6)).toBe(true);
    const from = addDays(d.date, -6);
    const news = [
      ...s.rung_history.map((r) => r.recorded), ...s.since_then.map((t) => t.date), ...s.sources.map((x) => x.added),
    ].some((x) => x >= from && x <= d.date);
    expect(news).toBe(true);
    expect(isBriefable({ kind: s.kind, significance: s.significance, ai: s.ai })).toBe(true);
    // Every source the deep dive cites is one of the finding's own, and the page's numbers come from them.
    const own = s.sources.map((x) => normalizeUrl(SOURCE_TABLE[x.key].url));
    for (const src of d.sources) expect(own).toContain(normalizeUrl(src.url));
  });

  it("tells the deep dive in 450 to 550 words of short paragraphs, with no numbered steps, no web address and no hype", () => {
    const text = d.deep_dive!.text;
    expect(countWords(text)).toBeGreaterThanOrEqual(450);
    expect(countWords(text)).toBeLessThanOrEqual(550);
    const paragraphs = text.split("\n\n");
    expect(paragraphs.length).toBeGreaterThanOrEqual(6);
    for (const p of paragraphs) {
      expect(p.trim()).toBe(p);
      expect(p.length).toBeGreaterThan(0);
      expect(countWords(p)).toBeLessThanOrEqual(80);
      expect(/^\s*(?:\d+[.)]|\(\d+\)|Step \d)/m.test(p)).toBe(false);
    }
    expect(text).not.toMatch(/https?:\/\/|www\./);
    expect(text).not.toMatch(/\n[-*•] /);
    // The one jargon word it uses is defined where it first appears.
    expect(jargonIn(text).map((w) => w.toLowerCase())).toEqual(["antimicrobial resistance"]);
    expect(text.indexOf("stopped responding")).toBeLessThan(text.indexOf("antimicrobial resistance"));
    expect(missingNumbers(text, d.sources.map((s) => seenTextOfUrl(s.url)!))).toEqual([]);
  });
});

describe("the Monday draft", () => {
  const d = mondayDraft();
  const week = EDITIONS.monday.week!;
  const inWeek = (date: string): boolean => date >= week.start && date <= week.end;
  const weekKeys = FINDING_KEYS.filter((k) => spec(k).briefs.some(inWeek));
  const fellKeys = FINDING_KEYS.filter((k) => spec(k).rung_history.some((r) => (r.rung === "disputed" || r.rung === "retracted") && inWeek(r.recorded)));
  const setbackKeys = weekKeys.filter((k) => spec(k).kind === "setback");

  it("is a Monday with one new finding and the review of a week of at least three findings", () => {
    expect(weekday(d.date)).toBe(1);
    expect(d.deep_dive).toBeNull();
    expect(d.story).toBeNull();
    expect(d.items).toEqual([MONDAY_ITEMS.item]);
    expect(d.new_findings).toHaveLength(1);
    expect(weekKeys.length).toBeGreaterThanOrEqual(3);
    expect(weekKeys).toEqual(["tilings", "weather", "catalyst", "antibiotic", "retractW0", "policy", "survey"]);
  });

  it("sets remarkable on a finding of the week and names the setback and the finding that fell", () => {
    const review = d.review!;
    expect(review.remarkable).not.toBeNull();
    expect(weekKeys.map(findingId)).toContain(review.remarkable!.finding_id);
    expect(review.remarkable!.finding_id).toBe(MONDAY_ITEMS.remarkable);
    expect(countWords(review.remarkable!.note)).toBeLessThanOrEqual(30);
    expect(setbackKeys.map(findingId)).toEqual([MONDAY_ITEMS.setback]);
    expect(fellKeys.map(findingId)).toEqual([MONDAY_ITEMS.fell]);
    const against = review.strongest_against;
    expect(against.text).not.toBe(NONE_FOUND.en);
    expect(countWords(against.text)).toBeLessThanOrEqual(50);
    expect(against.finding_ids).toEqual([MONDAY_ITEMS.fell, MONDAY_ITEMS.setback].sort(compareFindingIds));
    expect(against.source_ids).toEqual(d.sources.map((s) => s.id));
    // The finding that fell is not one of the week's findings: only the script's rung change names it.
    expect(weekKeys).not.toContain("fellW0");
    expect(spec("fellW0").rung_history.at(-1)!.by).toBe("script");
  });

  it("writes the big picture in 270 to 330 words of paragraphs, with no numbered list and no digit", () => {
    const text = d.review!.big_picture;
    expect(countWords(text)).toBeGreaterThanOrEqual(270);
    expect(countWords(text)).toBeLessThanOrEqual(330);
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(4);
    expect(text).not.toMatch(/\d/);
    expect(/^\s*(?:\d+[.)]|\(\d+\)|Step \d)/m.test(text)).toBe(false);
    expect(jargonIn(text)).toEqual([]);
  });
});

describe("the short Monday draft", () => {
  const d = mondayShortDraft();
  const week = EDITIONS["monday-short"].week!;

  it("reviews a week with no finding: nothing in it was shown, and nothing fell", () => {
    expect(weekday(d.date)).toBe(1);
    const inWeek = (date: string): boolean => date >= week.start && date <= week.end;
    expect(FINDING_KEYS.filter((k) => spec(k).briefs.some(inWeek))).toEqual([]);
    expect(FINDING_KEYS.filter((k) => spec(k).rung_history.some((r) => inWeek(r.recorded)))).toEqual([]);
  });

  it("has the short big picture, no remarkable finding, and exactly NONE_FOUND with both lists empty", () => {
    const review = d.review!;
    expect(countWords(review.big_picture)).toBeLessThanOrEqual(120);
    expect(review.remarkable).toBeNull();
    expect(review.strongest_against).toEqual({ text: NONE_FOUND.en, finding_ids: [], source_ids: [] });
  });

  it("cites no finding and holds nothing else new", () => {
    expect(d.lead).toHaveLength(1);
    expect(d.lead[0]!.refs).toEqual([]);
    expect(d.story).toBeNull();
    expect(d.items).toEqual([]);
    for (const key of ["new_findings", "returning", "rung_changes", "ideas", "also", "corrections", "report_decisions", "sources"] as const) {
      expect(d[key], key).toEqual([]);
    }
    expect(d.deep_dive).toBeNull();
  });
});

// ── Limits and cleanliness, over every valid draft ───────────────────────────────────────────────

describe.each(EDITION_NAMES)("the %s draft: limits and cleanliness", (name) => {
  const d = editionDraft(name);
  const landmarks = d.new_findings.flatMap((f, i) => (f.significance === "landmark" ? [`new_findings.${i}`] : []));

  it("holds to the word budgets, with the page under its 1,000-word target", () => {
    expect(budgetProblems(d)).toEqual([]);
    expect(pageWords(d)).toBeLessThanOrEqual(run.budgets.words_target);
  });

  it("keeps every sentence to 24 words and every explainer, Lead, deep dive and big picture to grade 12", () => {
    expect(sentenceProblems(d)).toEqual([]);
    expect(gradeProblems(d, run.budgets.reading_grade_soft)).toEqual([]);
  });

  it("uses no em dash, no en dash outside digits, no hype word and no agent term", () => {
    expect(dashProblems(d)).toEqual([]);
    expect(hypeProblems(d, landmarks)).toEqual([]);
    expect(agentProblems(d)).toEqual([]);
    expect(JSON.stringify(d)).not.toContain(CANARY_TOKEN);
    for (const p of proseOf(d)) expect(p.text, p.path).not.toMatch(/https?:\/\/|www\./);
  });

  it("defines each jargon word it uses as a listed term, and lists none that its explainer lacks", () => {
    expect(termProblems(d)).toEqual([]);
  });

  it("holds every quote verbatim in a cited source and every number in a source it cites", () => {
    expect(quoteProblems(d, seenTextOfUrl)).toEqual([]);
    expect(numberProblems(d, seenTextOfUrl)).toEqual([]);
  });

  it("cites only primary sources at addresses the world holds, and marks every invented page as sample text", () => {
    expect(urlProblems(d)).toEqual([]);
    const urls = [
      ...d.sources.map((s) => s.url), ...d.new_findings.flatMap((f) => f.sources.map((s) => s.url)),
      ...d.corrections.flatMap((c) => (c.source_url === null ? [] : [c.source_url])),
      ...d.new_findings.flatMap((f) => f.artefacts.lean),
    ];
    for (const u of urls) expect(sourceKeyOfUrl(u), u).toBeDefined();
    for (const s of [...d.sources, ...d.new_findings.flatMap((f) => f.sources)]) expect(s.title.startsWith("SAMPLE")).toBe(true);
    for (const f of d.new_findings) {
      expect(f.title.startsWith("SAMPLE")).toBe(true);
      for (const r of f.reactions) expect(r.who.endsWith("(SAMPLE)")).toBe(true);
    }
    for (const i of d.ideas) expect(i.who.endsWith("(SAMPLE)")).toBe(true);
  });

  it("never lets a source be cited as the same address twice in one list", () => {
    for (const list of [d.sources, ...d.new_findings.map((f) => f.sources)]) {
      const keys = list.map((s) => normalizeUrl(s.url));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

// ── The drafts' inputs ───────────────────────────────────────────────────────────────────────────

/** An input as committed: the consistency checks below read the files, and the first test ties each file to its builder. */
const INPUT_SCHEMAS = { context: AgentContext, evidence: Evidence, metrics: MetricsFile, packs: Pack } as const;
function committed<F extends InputFolder>(folder: F, name: EditionName): z.infer<(typeof INPUT_SCHEMAS)[F]> {
  return INPUT_SCHEMAS[folder].parse(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, inputPath(folder, name)), "utf8"))) as never;
}
const committedDraft = (name: EditionName): DraftBrief =>
  DraftBrief.parse(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, validDraftPath(name)), "utf8")));

interface EditionFiles {
  draft: DraftBrief;
  context: AgentContext;
  evidence: Evidence;
  metrics: MetricsFile;
  pack: Pack;
}
const filesOf = (name: EditionName): EditionFiles => ({
  draft: committedDraft(name), context: committed("context", name), evidence: committed("evidence", name),
  metrics: committed("metrics", name), pack: committed("packs", name),
});

const config = fixtureConfig();
const lookbackMs = run.pack.lookback_hours * HOUR;

/** The text the run saw at a URL, from the evidence alone (the rules' `seenText()`). */
const evidenceSeen = (evidence: Evidence) => (url: string): string | undefined => evidence.texts[normalizeUrl(url)];

/** Every address a draft cites, with the kind it cites it as. */
function citedUrls(d: DraftBrief): { url: string; kind: SourceKind }[] {
  return [
    ...d.new_findings.flatMap((f) => f.sources.map((s) => ({ url: s.url, kind: s.kind }))),
    ...d.sources.map((s) => ({ url: s.url, kind: s.kind })),
    ...d.corrections.flatMap((c) => (c.source_url === null ? [] : [{ url: c.source_url, kind: SOURCE_TABLE[sourceKeyOfUrl(c.source_url)!].kind }])),
  ];
}

/** Every finding ref a draft uses outside its new findings' own records. */
function refsOf(d: DraftBrief): string[] {
  return [
    ...d.lead.flatMap((l) => l.refs), ...(d.story === null ? [] : [d.story]), ...d.items,
    ...d.returning.map((r) => r.finding_id), ...d.rung_changes.map((r) => r.finding_id),
    ...(d.deep_dive === null ? [] : [d.deep_dive.finding_id]),
    ...(d.review === null ? [] : [...(d.review.remarkable === null ? [] : [d.review.remarkable.finding_id]), ...d.review.strongest_against.finding_ids]),
    ...d.corrections.flatMap((c) => (c.finding_id === null ? [] : [c.finding_id])),
    ...d.new_findings.flatMap((f) => f.related),
  ];
}

/** Each way a draft can disagree with its own inputs, as problems (empty when it agrees). */
function consistencyProblems(f: EditionFiles): string[] {
  const { draft: d, context, evidence, pack } = f;
  const problems: string[] = [];
  const known = contextFindingIds(context);
  const newRefs = new Set(d.new_findings.map((x) => x.ref));
  for (const ref of refsOf(d)) if (!newRefs.has(ref) && !known.has(ref)) problems.push(`ref ${ref} is neither new nor in the context`);
  const seen = evidenceSeen(evidence);
  problems.push(...quoteProblems(d, seen));
  const quotable = Object.values(context.pace.quotable);
  problems.push(...numberProblems(d, seen, () => quotable));
  const listed = new Set([...evidence.urls, ...pack.candidates.map((c) => c.url)].map(normalizeUrl));
  for (const { url } of citedUrls(d)) if (!listed.has(normalizeUrl(url))) problems.push(`${url} is in neither the pack nor the evidence`);
  const reports = new Map(context.reports.map((r) => [r.id, r]));
  for (const r of d.report_decisions) if (reports.get(r.report_id)?.status !== "open") problems.push(`decision on ${r.report_id}, not an open report`);
  for (const c of d.corrections) {
    if (c.report_id !== null && reports.get(c.report_id)?.status !== "upheld") problems.push(`correction for ${c.report_id}, not an upheld report`);
  }
  if (d.deep_dive !== null) {
    const cand = context.ledger_for_sunday.find((x) => x.id === d.deep_dive!.finding_id);
    if (cand === undefined || !cand.reasons.includes(d.deep_dive.why_today)) problems.push(`deep dive ${d.deep_dive.finding_id} is not a candidate for ${d.deep_dive.why_today}`);
  }
  if (d.review !== null && context.week !== null) {
    const fell = context.week.rung_changes.filter((r) => r.to === "disputed" || r.to === "retracted").map((r) => r.finding_id);
    for (const id of d.review.strongest_against.finding_ids) {
      if (!context.week.setbacks.includes(id) && !fell.includes(id)) problems.push(`${id} is neither a setback nor a fall of the week`);
    }
  }
  return problems;
}

describe("the drafts' inputs", () => {
  it("each parses with its schema, equals its builder and is the file the builder writes", () => {
    const builders = { context: editionContext, evidence: editionEvidence, metrics: editionMetrics, packs: editionPack } as const;
    for (const name of EDITION_NAMES) {
      for (const folder of INPUT_FOLDERS) {
        const built = builders[folder](name);
        expect(INPUT_SCHEMAS[folder].safeParse(built).success, `${folder}/${name}`).toBe(true);
        expect(committed(folder, name), `${folder}/${name}`).toEqual(built);
        expect(fs.readFileSync(path.join(REPO_ROOT, inputPath(folder, name)), "utf8")).toBe(jsonText(built, INPUT_SCHEMAS[folder]));
      }
    }
  });

  it("hands out deep copies and builds the same bytes every time", () => {
    for (const name of EDITION_NAMES) {
      const a = editionContext(name);
      a.recent_findings.length = 0;
      a.config.jargon.push("not a term");
      expect(editionContext(name)).not.toEqual(a);
      const p = editionPack(name);
      p.candidates.length = 0;
      expect(editionPack(name).candidates.length).toBeGreaterThan(0);
      const e = editionEvidence(name);
      e.urls.length = 0;
      expect(editionEvidence(name).urls.length).toBeGreaterThan(0);
      const m = editionMetrics(name);
      m.counters.length = 0;
      expect(editionMetrics(name).counters.length).toBe(7);
      expect(jsonText(editionContext(name), AgentContext)).toBe(jsonText(editionContext(name), AgentContext));
      expect(jsonText(editionPack(name), Pack)).toBe(jsonText(editionPack(name), Pack));
    }
    const inputs = draftInputs("weekday");
    expect(inputs.fileDate).toBeNull();
    expect(inputs.config).toBe(fixtureConfig());
    expect(inputs.context).toEqual(editionContext("weekday"));
    expect(inputs.context).not.toBe(draftInputs("weekday").context);
    expect(fixtureConfig().dir).toBe(path.join(REPO_ROOT, "config"));
  });

  it.each(EDITION_NAMES.map((n) => [n]))("%s: the draft agrees with its own inputs", (name) => {
    expect(consistencyProblems(filesOf(name))).toEqual([]);
  });

  it("finds every disagreement the consistency check looks for", () => {
    const base = filesOf("weekday");
    const broken = (change: (f: EditionFiles) => void): string[] => {
      const f = structuredClone(base);
      change(f);
      return consistencyProblems(f);
    };
    expect(broken((f) => { f.context.recent_findings = f.context.recent_findings.filter((r) => r.id !== WEEKDAY_ITEMS.returning); }))
      .toContain(`ref ${WEEKDAY_ITEMS.returning} is neither new nor in the context`);
    const story = newFindingOf(base.draft, WEEKDAY_ITEMS.story);
    const paper = story.sources.find((s) => s.kind === "paper")!;
    expect(broken((f) => { delete f.evidence.texts[normalizeUrl(paper.url)]; }).some((p) => p.includes("not verbatim"))).toBe(true);
    expect(broken((f) => { f.context.pace.quotable = {}; f.draft.lead[0]!.text = `${f.draft.lead[0]!.text} It is 6.6% of them.`; }).join("\n"))
      .toMatch(/numbers not in the sources: 6\.6%/);
    const search = SOURCE_TABLE["policy-final"].url;
    expect(broken((f) => { f.evidence.urls = f.evidence.urls.filter((u) => u !== search); })).toContain(`${search} is in neither the pack nor the evidence`);
    expect(broken((f) => { f.context.reports[1]!.status = "upheld"; })).toContain(`decision on ${WEEKDAY_REPORTS.open}, not an open report`);
    expect(broken((f) => { f.context.reports[0]!.status = "open"; })).toContain(`correction for ${WEEKDAY_REPORTS.upheld}, not an upheld report`);
    const sunday = filesOf("sunday");
    sunday.context.ledger_for_sunday[0]!.reasons = ["rotation"];
    expect(consistencyProblems(sunday)).toContain(`deep dive ${SUNDAY_ITEMS.deepDive} is not a candidate for news`);
    const monday = filesOf("monday");
    monday.context.week!.rung_changes = [];
    expect(consistencyProblems(monday)).toContain(`${MONDAY_ITEMS.fell} is neither a setback nor a fall of the week`);
  });

  it("dates every input by its edition: the date, the window, the cutoff, the deadline and the times in order", () => {
    for (const name of EDITION_NAMES) {
      const e = EDITIONS[name];
      const { draft, context, metrics, pack } = filesOf(name);
      expect([context.date, pack.date, metrics.date, draft.date]).toEqual([e.date, e.date, e.date, e.date]);
      expect(context.format).toBe(e.format);
      expect(context.window).toEqual(e.window);
      expect(pack.window).toEqual(e.window);
      expect(context.deadline).toBe(e.deadline);
      expect(metrics.data_cutoff).toBe(e.cutoff);
      expect(metrics.data_cutoff).toBe(lastSunday(dataCutoffFor(e.date)));
      expect(metrics.pace.provisional_from).toBe(addDays(metrics.data_cutoff, -7 * run.pace.provisional_weeks + 1));
      expect(metrics.pace.window.to).toBe(addDays(metrics.pace.provisional_from, -1));
      expect(ms(pack.window.end)).toBe(ms(pack.window.start) + run.pack.window_hours * HOUR);
      expect(ms(pack.generated_at)).toBeGreaterThan(ms(pack.window.end));
      expect(ms(metrics.computed_at)).toBeGreaterThan(ms(pack.generated_at));
      expect(ms(e.contextAt)).toBeGreaterThan(ms(metrics.computed_at));
      expect(ms(context.deadline)).toBe(ms(e.contextAt) + 30 * 60_000);
      expect(ms(draft.generated_at)).toBeGreaterThan(ms(e.contextAt));
      expect(ms(draft.generated_at)).toBeLessThanOrEqual(ms(context.deadline));
      expect(pack.arxiv_announcement).toBe(e.arxivAnnouncement);
      if (pack.arxiv_announcement !== null) {
        expect(ms(pack.arxiv_announcement)).toBeGreaterThan(ms(pack.window.start));
        expect(ms(pack.arxiv_announcement)).toBeLessThan(ms(pack.window.end));
      }
      for (const a of pack.candidates.filter((c) => c.arxiv !== null)) expect(a.published_at).toBe(pack.arxiv_announcement);
    }
    expect(EDITIONS.weekday.arxivAnnouncement).not.toBeNull();
  });

  it("writes the weekday's validator flags as one line naming its four inputs", () => {
    const flags = validOutputs().find((o) => o.path === FLAGS_PATH)!;
    expect(FLAGS_PATH).toBe("fixtures/drafts/flags.txt");
    expect(flags.text).toBe(
      "--context fixtures/context/weekday.json --evidence fixtures/evidence/weekday.json --metrics fixtures/metrics/weekday.json --pack fixtures/packs/weekday.json\n",
    );
    expect(fs.readFileSync(path.join(REPO_ROOT, FLAGS_PATH), "utf8")).toBe(flags.text);
    const words = flags.text.trimEnd().split(" ");
    for (let i = 1; i < words.length; i += 2) expect(fs.existsSync(path.join(REPO_ROOT, words[i]!)), words[i]).toBe(true);
    expect(flags.text.split("\n")).toHaveLength(2);
  });
});

describe("the metrics of the editions", () => {
  it("prints the Pace of the calibrated weekly state, the same verdicts for every edition", () => {
    expect(committed("metrics", "weekday").pace.sentence.en).toBe(
      "The Pace: 6.6% of papers in leading journals named AI methods in the 13 weeks to 16 Aug. That is up from 1.1% in 2015 to 2019, and up from 4.8% a year earlier. Clearly above the pre-AI level in 5 of 7 fields. Too few cases to judge in 1.",
    );
    for (const name of EDITION_NAMES) {
      const m = committed("metrics", name);
      expect(m.status).toBe("ok");
      expect(m.versions).toEqual(config.versions);
      expect(m.pace.leading.pooled.vs_baseline).toBe("higher");
      expect(m.pace.leading.pooled.vs_year_ago).toBe("up");
      expect(m.pace.leading.by_field.social!.vs_baseline).toBe("no_clear_change");
      expect(m.pace.leading.by_field.humanities!.vs_baseline).toBe("too_few");
      for (const f of ["mathematics", "physics", "chemistry", "biology", "earth"] as const) expect(m.pace.leading.by_field[f]!.vs_baseline, f).toBe("higher");
      expect(m.pace.leading.pooled.baseline.share).toBeGreaterThan(0);
      expect(m.pace.sentence.en).toMatch(/^The Pace: \d+\.\d% of papers in leading journals/);
      expect(m.pace.quotable["pace.leading.pooled.window"]).toBe(`${(m.pace.leading.pooled.window.share * 100).toFixed(1)}%`);
    }
  });

  it("builds every week from 2015 with counts that depend on the week alone, the newest weeks provisional", () => {
    const short = paceWeeks(EDITIONS.monday.cutoff, EDITIONS.monday.date);
    const long = paceWeeks(EDITIONS["monday-short"].cutoff, EDITIONS["monday-short"].date);
    expect(short[0]!.week_start).toBe("2015-01-05");
    expect(long.at(-1)!.week_start).toBe(addDays(EDITIONS["monday-short"].cutoff, -6));
    expect(long.filter((w) => w.provisional)).toHaveLength(run.pace.provisional_weeks);
    for (const w of short) {
      const twin = long.find((x) => x.week_start === w.week_start)!;
      if (!w.provisional && !twin.provisional) expect(twin).toEqual(w);
    }
    const state = paceState(EDITIONS.weekday.cutoff, EDITIONS.weekday.date);
    expect(PaceWeeklyFile.safeParse(state).success).toBe(true);
    expect(state.updated).toBe(EDITIONS.weekday.date);
    expect(state.weeks.filter((w) => w.provisional).every((w) => w.fetched === EDITIONS.weekday.date)).toBe(true);
  });

  it("counts C, D and the counters from the findings stored before each edition", () => {
    const thisYear = (name: EditionName) => committed("metrics", name).landmarks.by_year.find((y) => y.year === 2026);
    expect(thisYear("weekday")).toEqual({ year: 2026, ai: 0, all: 1 });
    expect(thisYear("monday")).toEqual({ year: 2026, ai: 0, all: 1 });
    expect(thisYear("sunday")).toEqual({ year: 2026, ai: 1, all: 2 });
    expect(thisYear("monday-short")).toEqual({ year: 2026, ai: 1, all: 2 });
    expect(committed("metrics", "weekday").pace.quotable["landmarks.this_year"]).toBe("0 of 1");
    expect(committed("metrics", "sunday").pace.quotable["landmarks.this_year"]).toBe("1 of 2");
    const ancient = (name: EditionName) => committed("metrics", name).counters.find((c) => c.id === "ancient_texts_ai")!;
    expect([ancient("weekday").value, ancient("monday").value, ancient("sunday").value, ancient("monday-short").value]).toEqual([0, 0, 1, 1]);
    for (const name of EDITION_NAMES) {
      const m = committed("metrics", name);
      expect(m.hold).toEqual({ cases: 0, held: 0, fell: 0, open: 0, too_few: true });
      expect(m.pace.quotable.hold).toBeUndefined();
      expect(m.counters.map((c) => c.id)).toEqual(config.counters.counters.map((c) => c.id));
      for (const c of m.counters) expect(c.source_url).toBe(config.counters.counters.find((x) => x.id === c.id)!.source_url);
      const bibles = m.counters.find((c) => c.id === "full_bibles")!;
      expect(bibles).toMatchObject({ value: null, as_of: null, status: "missing", breakdown: [] });
      const monday = addDays(EDITIONS[name].date, -((weekday(EDITIONS[name].date) + 6) % 7));
      for (const c of m.counters.filter((x) => x.kind === "api")) expect(c.as_of, c.id).toBe(monday);
      const drugs = m.counters.find((c) => c.id === "ai_drugs")!;
      expect(drugs.breakdown.map((r) => r.key)).toEqual(["1", "2", "3", "approved"]);
      expect(drugs.breakdown.reduce((n, r) => n + r.value, 0)).toBe(drugs.value);
    }
    expect(metricsFor(EDITIONS.sunday.date)).toEqual(committed("metrics", "sunday"));
  });
});

describe("the packs of the editions", () => {
  const feeds = new Map(config.sources.feeds.map((f) => [f.id, f]));

  it.each(EDITION_NAMES.map((n) => [n]))("%s: ranks, keeps and marks its candidates as §5.9 says", (name) => {
    const pack = committed("packs", name);
    const c = pack.candidates;
    expect(c.map((x) => x.id)).toEqual(c.map((_, i) => `cand-${String(i + 1).padStart(2, "0")}`));
    for (let i = 1; i < c.length; i += 1) expect(c[i]!.score).toBeLessThanOrEqual(c[i - 1]!.score);
    expect(c.length).toBeLessThanOrEqual(run.budgets.candidates_max);
    expect(c.filter((x) => x.deep_read).length).toBeLessThanOrEqual(run.budgets.deep_read_max);
    for (const f of FIELDS) {
      expect(c.filter((x) => x.fields.includes(f)).length).toBeLessThanOrEqual(10);
      expect(c.filter((x) => x.deep_read && x.fields.includes(f)).length, f).toBeLessThanOrEqual(3);
    }
    const leading = new Set(config.journals.journals.map((j) => j.name));
    for (const x of c) {
      const feed = feeds.get(x.source_id)!;
      expect(feed, x.source_id).toBeDefined();
      expect(x.title.startsWith("SAMPLE"), x.url).toBe(true);
      expect(x.journal_leading).toBe(x.journal !== null && leading.has(x.journal));
      if (feed.must_match) expect(x.ai_terms_matched.length, x.url).toBeGreaterThan(0);
      if (feed.fields.length > 0) expect(x.fields).toEqual(feed.fields);
      expect(candidateRefusal({ url: x.url, types: x.types, reaction: x.source_id === "smc-reactions" }, config), x.url).toBeNull();
      expect(blockedEntry(x.url), x.url).toBeNull();
      expect(x.types).toEqual(x.source_id === "pubmed" ? ["Journal Article"] : []);
      expect(x.flags).toEqual([]);
      const at = ms(x.published_at.length === 10 ? `${x.published_at}T00:00:00+08:00` : x.published_at);
      expect(at, x.url).toBeLessThanOrEqual(ms(pack.window.end));
      expect(at, x.url).toBeGreaterThanOrEqual(ms(pack.window.end) - lookbackMs);
      expect(x.trial).toEqual([...new Set(`${x.title}\n${x.abstract}`.match(/NCT\d{8}/g) ?? [])]);
    }
    const dois = c.flatMap((x) => (x.doi === null ? [] : [normalizeDoi(x.doi)]));
    expect(new Set(dois).size).toBe(dois.length);
    for (let i = 0; i < c.length; i += 1) for (let j = i + 1; j < c.length; j += 1) expect(jaccard(c[i]!.title, c[j]!.title)).toBeLessThan(0.6);
    expect(pack.feeds.map((f) => f.id)).toEqual([...PACK_FEEDS]);
    for (const f of pack.feeds) {
      expect(f.kind).toBe(feeds.get(f.id)!.kind);
      expect(f.items_kept).toBe(c.filter((x) => x.source_id === f.id).length);
      expect(f.items_total).toBeGreaterThan(f.items_kept);
      expect([f.ok, f.stale, f.error]).toEqual([true, false, null]);
    }
    expect([pack.degraded, pack.injection_flags]).toEqual([false, 0]);
    const draftKeys = citedKeys(committedDraft(name)).filter((k) => seenOn(k, EDITIONS[name].date) === "pack");
    expect(new Set(c.map((x) => normalizeUrl(x.url)))).toEqual(new Set([
      ...draftKeys.map((k) => normalizeUrl(SOURCE_TABLE[k].url)), ...DECOYS[name].map((x) => normalizeUrl(x.url)),
    ]));
  });

  it("reads every cited page of the weekday closely, among exactly 15, and keeps the fourth physics candidate unread", () => {
    const c = committed("packs", "weekday").candidates;
    const cited = new Set(citedKeys(weekdayDraft()).filter((k) => seenOn(k, EDITIONS.weekday.date) === "pack").map((k) => normalizeUrl(SOURCE_TABLE[k].url)));
    expect(cited.size).toBe(10);
    expect(c.filter((x) => x.deep_read)).toHaveLength(15);
    for (const x of c) if (cited.has(normalizeUrl(x.url))) expect(x.deep_read, x.url).toBe(true);
    const telescope = c.find((x) => x.url === "https://www.eurekalert.org/news-releases/ut-sample-0035")!;
    expect(telescope.deep_read).toBe(false);
    expect(c.filter((x) => x.fields.includes("physics") && c.indexOf(x) < c.indexOf(telescope))).toHaveLength(3);
    const scroll = c.find((x) => x.url === SOURCE_TABLE["scroll-paper"].url)!;
    expect([scroll.id, scroll.score, scroll.journal, scroll.journal_leading]).toEqual(["cand-01", 10, "Nature", true]);
    const protocol = c.find((x) => x.stored_finding !== null)!;
    expect(protocol.stored_finding).toBe(findingId("antibiotic"));
    expect(protocol.trial).toEqual(["NCT09999001"]);
    expect(c.filter((x) => x.stored_finding !== null)).toHaveLength(1);
    expect(c.filter((x) => x.arxiv !== null).map((x) => x.arxiv)).toEqual(["2610.99004", "2610.99005", "2610.99001", "2610.99002"]);
  });

  it("gives a paper whose reaction is in the pack two more points", () => {
    const glacier = committed("packs", "sunday").candidates.find((x) => x.url === DECOYS.sunday[0]!.url)!;
    expect([glacier.score, glacier.id]).toEqual([10, "cand-01"]);
    const plasma = committed("packs", "monday").candidates.find((x) => x.url === SOURCE_TABLE["plasma-paper"].url)!;
    expect(plasma.score).toBe(4);
    expect(committed("packs", "monday-short").candidates.at(-1)!.score).toBe(0);
  });
});

describe("the evidence of the editions", () => {
  it.each(EDITION_NAMES.map((n) => [n]))("%s: lists the pack, then the fetched pages, then the search results, each with its text", (name) => {
    const { draft, evidence, pack } = filesOf(name);
    const keys = evidence.urls.map(normalizeUrl);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(evidence.texts).sort()).toEqual([...keys].sort());
    expect(Object.keys(evidence.seen_as).sort()).toEqual([...keys].sort());
    const order: Record<string, number> = { pack: 0, fetched: 1, search: 2 };
    const ranks = keys.map((k) => order[evidence.seen_as[k]!]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(evidence.urls.slice(0, pack.candidates.length)).toEqual(pack.candidates.map((x) => x.url));
    expect(evidence.fetched).toEqual(evidence.urls.filter((u) => evidence.seen_as[normalizeUrl(u)] === "fetched"));
    for (const k of [...Object.keys(evidence.types), ...Object.keys(evidence.resolved)]) expect(keys).toContain(k);
    const cited = new Map(citedKeys(draft).map((k) => [normalizeUrl(SOURCE_TABLE[k].url), k]));
    for (const x of pack.candidates) {
      const text = evidence.texts[normalizeUrl(x.url)]!;
      const key = cited.get(normalizeUrl(x.url));
      expect(text).toBe(key === undefined ? `${x.title}\n${x.abstract}` : `${x.title}\n${x.abstract}\n${seenText(key)}`);
    }
    for (const [url, key] of cited) {
      expect(evidence.seen_as[url], key).toBe(seenOn(key, EDITIONS[name].date));
      if (evidence.seen_as[url] !== "pack") expect(evidence.texts[url]).toBe(seenText(key));
      const shown = sourceSpec(key).types;
      if (shown !== undefined) expect(evidence.types[url]).toEqual(shown);
    }
  });

  it("re-reads with a fetch the sources a stored finding already held, and sees the rest as the world says", () => {
    const fetchedKeys = (name: EditionName) => committed("evidence", name).fetched.map((u) => sourceKeyOfUrl(u));
    expect(fetchedKeys("weekday")).toEqual(["scroll-nv", "erdos-lean", "tilings-paper", "weather-statement"]);
    expect(fetchedKeys("sunday")).toEqual(["antibiotic-paper", "antibiotic-trial", "antibiotic-release", "antibiotic-second"]);
    expect(fetchedKeys("monday")).toEqual(["reviewer-statement", "fell-notice"]);
    expect(fetchedKeys("monday-short")).toEqual([]);
    expect(committed("evidence", "monday").resolved).toEqual({ [normalizeUrl(SOURCE_TABLE["fell-notice"].url)]: "https://link.springer.com/article/10.1007/ut-sample-0017" });
  });

  it.each(EDITION_NAMES.map((n) => [n]))("%s: every cited address passes the type check on the run's evidence", (name) => {
    const { draft, evidence } = filesOf(name);
    for (const { url, kind } of citedUrls(draft)) {
      expect(isPrimary(url, kind, config), url).toBe(true);
      expect(articleTypeFits(url, kind, evidence, config).status, url).toBe("pass");
    }
  });

  it("holds on the weekday two uncited pages the type check refuses, for the invalid cases", () => {
    const evidence = committed("evidence", "weekday");
    expect(EVIDENCE_EXTRAS.map((x) => x.refusal)).toEqual(["no_types", "no_landing"]);
    for (const x of EVIDENCE_EXTRAS) {
      expect(evidence.texts[normalizeUrl(x.url)]).toBe(x.text);
      expect(evidence.seen_as[normalizeUrl(x.url)]).toBe("search");
      expect(isPrimary(x.url, "paper", config)).toBe(true);
      const check = articleTypeFits(x.url, "paper", evidence, config);
      expect(check.status === "fail" ? check.reason : check.status).toBe(x.refusal);
      expect(x.text.startsWith("SAMPLE")).toBe(true);
    }
    for (const name of ["sunday", "monday", "monday-short"] as const) {
      for (const x of EVIDENCE_EXTRAS) expect(committed("evidence", name).texts[normalizeUrl(x.url)]).toBeUndefined();
    }
  });
});

describe("the contexts of the editions", () => {
  it.each(EDITION_NAMES.map((n) => [n]))("%s: copies the pack, the Pace, the budgets and the config", (name) => {
    const { context, metrics, pack } = filesOf(name);
    expect(context.candidates).toEqual(pack.candidates.map((x) => ({
      ...x, title: wrapUntrusted(x.source_id, x.title), abstract: wrapUntrusted(x.source_id, x.abstract),
    })));
    expect(context.pace).toEqual({ sentence: metrics.pace.sentence.en, quotable: metrics.pace.quotable });
    for (const [k, v] of Object.entries(context.budgets)) expect(v, k).toEqual(run.budgets[k]);
    expect(context.pack).toEqual({ md: `packs/${EDITIONS[name].date}.md`, json: `packs/${EDITIONS[name].date}.json`, degraded: false, failed_feeds: [] });
    expect(context.config.field_cap).toBe(FIELD_CAP);
    expect(context.config.hype_words).toEqual(config.hypeWords.en);
    expect(context.config.jargon).toEqual(config.jargon.words.map((w) => w.en));
    expect(context.config.fields.map((f) => [f.id, f.subfields.map((s) => s.id)])).toEqual(fieldsConfig.fields.map((f) => [f.id, f.subfields.map((s) => s.id)]));
    expect(context.config.source_kinds.map((k) => k.id)).toEqual(Object.keys(SOURCE_KIND_INFO));
    expect(context.config).toEqual(contextConfig());
    // Each cited address sits on a host the summary lists for its kind: a suffix, a host, or a host with a path.
    const hostFits = (url: string, h: string): boolean => {
      const host = hostOf(url)!;
      if (h.includes("/")) return url.includes(h);
      return h.startsWith(".") ? host.endsWith(h) : host === h || host.endsWith(`.${h}`);
    };
    for (const { url, kind } of citedUrls(committedDraft(name))) {
      expect(context.config.allowlist.some((a) => a.kinds.includes(kind) && a.hosts.some((h) => hostFits(url, h))), `${kind} ${url}`).toBe(true);
    }
    expect(context.corrections.flagged).toEqual([]);
    expect(context.standing_stories).toEqual([]);
  });

  it("lists the findings briefed in the last 30 days, in id order, as stored before the edition", () => {
    const recent = (name: EditionName) => committed("context", name).recent_findings;
    expect(EDITION_NAMES.map((n) => recent(n).length)).toEqual([10, 13, 9, 13]);
    expect(recent("sunday").map((r) => r.id)).not.toContain(findingId("disputedOld"));
    expect(recent("monday-short").map((r) => r.id)).not.toContain(findingId("fellW0"));
    for (const name of EDITION_NAMES) {
      const ids = recent(name).map((r) => r.id);
      expect(ids).toEqual([...ids].sort(compareFindingIds));
      for (const r of recent(name)) {
        const s = storedFinding(findingKeyOfId(r.id)!, EDITIONS[name].date);
        expect(r).toEqual({ id: s.id, title: s.title.en, field: s.field, rung: s.rung, significance: s.significance, artefacts: s.artefacts });
      }
    }
  });

  it("gives the weekday its two reports and its one rung proposal, and no other edition any", () => {
    const c = committed("context", "weekday");
    expect(c.reports.map((r) => [r.id, r.status, r.finding_id])).toEqual([
      [WEEKDAY_REPORTS.upheld, "upheld", WEEKDAY_ITEMS.weather], [WEEKDAY_REPORTS.open, "open", WEEKDAY_ITEMS.tilings],
    ]);
    for (const r of c.reports) {
      expect(r.finding).toEqual(toStoredFinding(storedFinding(findingKeyOfId(r.finding_id)!, EDITIONS.weekday.date), EDITIONS.weekday.date));
      expect(r.evidence_url).toBe(normalizeUrl(reportsBeforeWeekday().find((x) => x.id === r.id)!.evidence_url!));
    }
    expect(c.rung_proposals).toEqual([WEEKDAY_PROPOSAL]);
    expect(WEEKDAY_PROPOSAL.note.endsWith("The script left the rung to you.")).toBe(true);
    expect(WEEKDAY_PROPOSAL.url).toBe(SOURCE_TABLE["antibiotic-trial"].url);
    for (const name of ["sunday", "monday", "monday-short"] as const) {
      expect(committed("context", name).reports).toEqual([]);
      expect(committed("context", name).rung_proposals).toEqual([]);
    }
  });

  it("gives the Sunday its deep dive candidates, the antibiotic finding first for news", () => {
    const ledger = committed("context", "sunday").ledger_for_sunday;
    expect(ledger.map((l) => findingKeyOfId(l.id))).toEqual([
      "antibiotic", "policy", "catalyst", "tilings", "retractW0", "weather", "fellW0", "disputedOld", "survey",
    ]);
    expect(ledger[0]!.id).toBe(SUNDAY_ITEMS.deepDive);
    expect(ledger.slice(0, 3).every((l) => l.reasons.join() === "news,rotation")).toBe(true);
    expect(ledger.slice(3).every((l) => l.reasons.join() === "rotation")).toBe(true);
    expect(ledger[0]).toMatchObject({ field: "biology", rung_history: [{ rung: "checked" }, { rung: "confirmed" }] });
    for (const name of ["weekday", "monday", "monday-short"] as const) expect(committed("context", name).ledger_for_sunday).toEqual([]);
  });

  it("gives the Monday its week, with the setback and the finding that fell, and the short Monday an empty one", () => {
    const week = committed("context", "monday").week!;
    expect(week.findings.map((f) => findingKeyOfId(f.id))).toEqual(["tilings", "weather", "catalyst", "antibiotic", "retractW0", "policy", "survey"]);
    expect(week.setbacks).toEqual([MONDAY_ITEMS.setback]);
    expect(week.rung_changes).toEqual([{ finding_id: MONDAY_ITEMS.fell, from: "checked", to: "retracted", date: "2026-10-08", by: "script" }]);
    expect(week.findings.map((f) => f.id)).toContain(MONDAY_ITEMS.remarkable);
    expect(week.field_counts.map((f) => [f.field, f.reported, f.counted])).toEqual([
      ["mathematics", 1, 1], ["physics", 0, 0], ["chemistry", 1, 1], ["biology", 1, 1], ["earth", 1, 1], ["social", 3, 0], ["humanities", 0, 0],
    ]);
    const short = committed("context", "monday-short").week!;
    expect(short).toEqual({ findings: [], rung_changes: [], setbacks: [], field_counts: FIELDS.map((field) => ({ field, reported: 0, counted: 0 })) });
    expect(committed("context", "weekday").week).toBeNull();
    expect(committed("context", "sunday").week).toBeNull();
  });
});

// ── The builder ──────────────────────────────────────────────────────────────────────────────────

describe("the builder", () => {
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "ut-fixtures-"));
  const quiet = (): { lines: string[]; log: (s: string) => void } => {
    const lines: string[] = [];
    return { lines, log: (s: string) => lines.push(s) };
  };

  it("lists the valid drafts with their inputs and flags, and the invalid cases, with the Chinese cases kept apart", () => {
    expect(validOutputs().map((o) => o.path)).toEqual([
      ...EDITION_NAMES.map(validDraftPath),
      ...EDITION_NAMES.flatMap((name) => INPUT_FOLDERS.map((folder) => inputPath(folder, name))),
      FLAGS_PATH,
    ]);
    expect(INPUT_FOLDERS).toEqual(["context", "evidence", "metrics", "packs"]);
    expect(validDraftPath("weekday")).toBe("fixtures/drafts/valid-weekday.json");
    expect(inputPath("context", "sunday")).toBe("fixtures/context/sunday.json");
    expect(inputPath("evidence", "monday")).toBe("fixtures/evidence/monday.json");
    expect(inputPath("metrics", "monday-short")).toBe("fixtures/metrics/monday-short.json");
    expect(inputPath("packs", "weekday")).toBe("fixtures/packs/weekday.json");
    const files = INVALID_CASES.map((c) => c.file);
    expect(new Set(files).size).toBe(files.length);
    for (const c of INVALID_CASES) expect(c.file).toBe(`invalid--${c.code}.json`);
    for (const c of ZH_INVALID_CASES) expect(c.file).toBe(`invalid--${c.code}.zh.json`);
    expect(GENERATORS.length).toBeGreaterThanOrEqual(2);
  });

  it("makes the same files every time, with no timestamp and no machine path in them", () => {
    const a = allOutputs();
    const b = allOutputs();
    expect(a).toEqual(b);
    for (const o of a) {
      expect(o.text.endsWith("\n")).toBe(true);
      expect(o.text).not.toContain(REPO_ROOT);
      expect(FIXTURE_DIRS.some((dir) => o.path.startsWith(`${dir}/`)), o.path).toBe(true);
    }
  });

  it("agrees with the committed valid drafts, inputs and flags byte for byte, and its own check passes on the repo", () => {
    const out = quiet();
    expect(main(["--check"], out.log, REPO_ROOT)).toBe(0);
    expect(out.lines).toEqual([`All ${allOutputs().length} fixture files are up to date.`]);
    const { missing, stale } = compareOutputs(validOutputs());
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  it("writes every file, reports and removes any other file in the folders it owns, and passes its own check", () => {
    const root = tmp();
    try {
      const first = quiet();
      expect(main([], first.log, root)).toBe(0);
      expect(first.lines[0]).toBe(`Wrote ${allOutputs().length} fixture files.`);
      const check = quiet();
      expect(main(["--check"], check.log, root)).toBe(0);
      expect(check.lines).toEqual([`All ${allOutputs().length} fixture files are up to date.`]);

      // A changed file is stale, a deleted one missing, a file no generator writes added; --check writes nothing.
      const weekdayFile = path.join(root, validDraftPath("weekday"));
      const stale = fs.readFileSync(weekdayFile, "utf8").replace("SAMPLE", "SAMPL");
      fs.writeFileSync(weekdayFile, stale);
      fs.rmSync(path.join(root, validDraftPath("sunday")));
      fs.writeFileSync(path.join(root, "fixtures/drafts/extra.json"), "{}\n");
      const bad = quiet();
      expect(main(["--check"], bad.log, root)).toBe(1);
      expect(bad.lines).toContain(`stale: ${validDraftPath("weekday")}`);
      expect(bad.lines).toContain(`missing: ${validDraftPath("sunday")}`);
      expect(bad.lines).toContain("added: fixtures/drafts/extra.json (no generator writes it)");
      expect(fs.readFileSync(weekdayFile, "utf8")).toBe(stale);
      expect(fs.existsSync(path.join(root, "fixtures/drafts/extra.json"))).toBe(true);
      expect(fs.existsSync(path.join(root, validDraftPath("sunday")))).toBe(false);

      const fix = quiet();
      expect(main([], fix.log, root)).toBe(0);
      expect(fix.lines).toContain("removed: fixtures/drafts/extra.json (no generator writes it)");
      expect(main(["--check"], quiet().log, root)).toBe(0);
      expect(compareOutputs(allOutputs(), root)).toEqual({ missing: [], stale: [], added: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an unknown argument with exit 2 and writes nothing", () => {
    const root = tmp();
    try {
      const out = quiet();
      expect(main(["--fix"], out.log, root)).toBe(2);
      expect(out.lines[0]).toContain("Unknown argument: --fix");
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses two generators that write one path, and one that writes outside the folders it owns", () => {
    const one = (p: string): (() => Output[]) => () => [{ path: p, text: "{}\n" }];
    expect(() => allOutputs([one("fixtures/drafts/a.json"), one("fixtures/drafts/a.json")])).toThrow(/Two generators write fixtures\/drafts\/a\.json/);
    expect(() => allOutputs([one("fixtures/elsewhere/a.json")])).toThrow(/outside the folders the builder owns/);
    expect(allOutputs([one("fixtures/drafts/a.json"), one("fixtures/context/a.json")])).toHaveLength(2);
  });

  it("writes an invalid case as a mutation of a fresh copy, as it is when it fails the schema, and refuses a wrong file name", () => {
    const before = editionDraft("weekday");
    const cases: InvalidCase[] = [
      { code: "REF_UNKNOWN", file: "invalid--REF_UNKNOWN.json", mutate: (d) => { d.items.push("new-9"); } },
      { code: "SCHEMA", file: "invalid--SCHEMA.json", edition: "sunday", mutate: () => ({ not: "a draft" }) },
    ];
    const outputs = invalidOutputs(cases);
    expect(outputs.map((o) => o.path)).toEqual(["fixtures/drafts/invalid--REF_UNKNOWN.json", "fixtures/drafts/invalid--SCHEMA.json"]);
    expect(JSON.parse(outputs[0]!.text).items).toEqual([...before.items, "new-9"]);
    expect(JSON.parse(outputs[1]!.text)).toEqual({ not: "a draft" });
    expect(invalidDraft(cases[0]!)).not.toBe(before);
    expect(editionDraft("weekday")).toEqual(before);
    expect(() => invalidOutputs([{ code: "SCHEMA", file: "oops.json", mutate: () => undefined }])).toThrow(/invalid--SCHEMA\.json/);
  });

  it("validates the valid drafts and their inputs in one place and names each issue as a line", () => {
    expect(validDraftProblems()).toEqual([]);
    const broken = validDraftProblems((name) => (name === "monday" ? { ...editionDraft(name), story: "not a ref" } : editionDraft(name)));
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatch(/^valid-monday\.json: ERROR SCHEMA story: /);
    const badInput = validDraftProblems(editionDraft, (folder, name) => {
      const value = { context: editionContext, evidence: editionEvidence, metrics: editionMetrics, packs: editionPack }[folder](name) as Record<string, unknown>;
      return folder === "packs" && name === "sunday" ? { ...value, injection_flags: -1 } : value;
    });
    expect(badInput).toHaveLength(1);
    expect(badInput[0]).toMatch(/^packs\/sunday\.json: ERROR SCHEMA injection_flags: /);
  });

  it("writes JSON the way the content files are written: schema order, two-space indent, a closing newline", () => {
    const root = tmp();
    try {
      const file = path.join(root, "x", "y.json");
      writeJson(file, { b: 1, a: [2] });
      expect(fs.readFileSync(file, "utf8")).toBe('{\n  "b": 1,\n  "a": [\n    2\n  ]\n}\n');
      const written = writeOutputs([{ path: "fixtures/drafts/z.json", text: "{}\n" }], root);
      expect(written).toEqual([]);
      expect(fs.readFileSync(path.join(root, "fixtures/drafts/z.json"), "utf8")).toBe("{}\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
