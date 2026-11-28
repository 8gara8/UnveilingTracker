// The validator's own tests (SPEC section 4.12 "Fixtures and tests"): the fixture loops run in process, the code table is held to the
// fixtures and cases that cover it, and the T cases of the published-mode codes run on temporary copies of fixtures/site-content/.
//
//   the table      every row of RULE_CODE_TABLE has, for each kind of test it lists (F, S, T, Z), a case that runs and passes; the one
//                  exempt row is pinned, and the failure message lists every code that has none
//   the fixtures   the valid drafts are clean; each F, S and Z fixture on disk fails the whole validator with exactly its code (so no rule
//                  reads another rule's fault); each named case gives exactly its sets of error and warning codes; none of them ever
//                  holds RULE_ERROR or INPUT_MISSING unless the case says so
//   published      one damaged copy of the sample for each case: XREF, LANG_PARITY and FILE_LAYOUT, the structure, history, ladder, sources,
//                  grounding, words and safety rules on stored records, the record sets of a publishing date, removed text, returning
//                  findings and seeds, and the files that cannot be read. Each fails with exactly the issues listed, at the right file and path
//   the sample     the sample content is clean for every date it could be published on, and the empty and missing folders pass
//
// A published-mode case lists every issue its copy gets: "E" for an error or "W" for a warning, the code, and the path with its file in
// front. Nothing else may appear, so a case that fails with a second code is a failing case.
//
// Cyber's tests/validate.test.ts at the fork commit 3ced1fb, adapted: the idea (the fixture loops in one file, the sample copied and damaged
// for the cross-file cases) is Cyber's; the table of codes, the cases and the helpers of tests/helpers/sample-copy.ts are this project's.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INVALID_CASES, NAMED_CASES, SOFT_CASES, ZH_INVALID_CASES, ZH_NAMED_CASES, ZH_SOFT_CASES, allOutputs, compareOutputs, invalidOutputs,
  softOutputs, validOutputs, zhInvalidOutputs, zhSoftOutputs,
} from "@/fixtures/src/build";
import { editionDraft } from "@/fixtures/src/drafts";
import { draftInputs } from "@/fixtures/src/inputs";
import { sampleSecret } from "@/fixtures/src/invalid/safety";
import { zhInputs } from "@/fixtures/src/zh-inputs";
import { zhDraft } from "@/fixtures/src/zh-drafts";
import { EDITIONS, EDITION_NAMES, storedFindingsBefore, storedGlossary, type EditionName } from "@/fixtures/src/world";
import type { LoadedConfig } from "@/lib/config";
import { SITE_BLOCKING_CODES } from "@/lib/content";
import { RULE_CODE_TABLE, RULES, ruleCodes, uncoveredCodes, type RuleCodeInfo } from "@/lib/rules/index";
import { ARCHIVE_WARNING_CODES } from "@/lib/rules/run";
import { jsonText } from "@/lib/json";
import { GlossaryFile, Term } from "@/lib/schema/glossary";
import { validateAll, validateDraft, validateZh, type AllResult, type ValidationIssue } from "@/lib/validate";
import { CANARY_TOKEN, REMOVED_TEXT } from "@/lib/vocab";
import { EMPTY_DIR, SAMPLE_DIR, SampleCopy, fixtureCounts, sampleConfig, withSampleCopy } from "./helpers/sample-copy";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));

// ── The published-mode cases ─────────────────────────────────────────────────────────────────────

/** A change to a copy of the sample content. */
type Edit = (copy: SampleCopy) => void;

/** The edit of a case whose point is a setting (`publishing`, `config`) or the sample as it is: the one edit that may leave the copy unchanged. */
const NO_EDIT: Edit = () => undefined;

/**
 * One published-mode T case: a copy of the sample content, damaged by `edit`, then judged by `validateAll()` (with `publishing`
 * when the case needs a record being published). `expect` is every issue of the result, "E" for an error and "W" for a warning,
 * then the code, then the path with its file in front, and nothing else: a case fails with exactly its code at the right place.
 */
interface PubCase {
  name: string;
  publishing?: string;
  /** The config the run judges against, from the repo's own; default the repo's. */
  config?: (base: LoadedConfig) => LoadedConfig;
  edit: Edit;
  expect: readonly string[];
}


const B = (date: string): string => `briefs/${date}.json`;
const F = (id: string): string => `findings/${id}.json`;
const ARCHIVE = "archive-index.json";

/** A stored correction of the sample's shape, with the fields a case changes. */
const correction = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "C-0003", date: "2026-10-14", finding_id: null, edition_date: null, term_id: null, type: "correction", path: "explainer.found",
  before: { en: "Before text.", zh: null }, after: { en: "After text.", zh: null }, reason: { en: "A made-up reason.", zh: null },
  source_url: null, trigger: "editor", report_id: null, ...over,
});

/** Sets the Chinese string of every `L10n` inside `value` to null, in place (a record as an English-only edition would hold it). */
function nullZh(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) nullZh(item);
  } else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 2 && keys.includes("en") && keys.includes("zh") && typeof record.en === "string") {
      record.zh = null;
      return;
    }
    for (const key of keys) nullZh(record[key]);
  }
}


/** XREF (SPEC 4.12): every name a stored record gives to another record, and the files each stored brief points at. */
const XREF_CASES: PubCase[] = [
  // A brief's finding ids, one case for each place a brief names a finding.
  { name: "XREF: the finding folder lacks a finding that a brief, the archive index and the glossary name", edit: (c) => c.remove(F("phys-2026-0147")), expect: [
      "E XREF archive-index.json: urls[\"https://fernhill-sample.edu/news/ut-sample-plasma-controller\"].refs[0]",
      "E XREF archive-index.json: urls[\"https://link.springer.com/article/10.1007/ut-sample-0020\"].refs[0]",
      "E XREF briefs/2026-10-12.json: items[0].finding_id",
      "E XREF briefs/2026-10-12.json: lead[1].finding_ids[0]",
      "E XREF glossary.json: terms[4].first_finding",
    ] },
  { name: "XREF: the story names a finding that is not stored", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.story.finding_id = "hum-2026-0199"; }), expect: [
      "E XREF briefs/2026-10-14.json: story.finding_id",
    ] },
  { name: "XREF: a Lead line names a finding that is not stored", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.lead[1].finding_ids = ["bio-2026-0199"]; }), expect: [
      "E XREF briefs/2026-10-14.json: lead[1].finding_ids[0]",
    ] },
  { name: "XREF: a rung change names a finding that is not stored", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.rung_changes[0].finding_id = "chem-2026-0199"; }), expect: [
      "E XREF briefs/2026-10-14.json: rung_changes[0].finding_id",
    ] },
  { name: "XREF: the deep dive names a finding that is not stored", edit: (c) => c.editJson(B("2026-10-18"), (b) => { b.deep_dive.finding_id = "bio-2026-0199"; }), expect: [
      "E XREF briefs/2026-10-18.json: deep_dive.finding_id",
    ] },
  {
    name: "XREF: the review names findings that are not stored (fell, setbacks, strongest against)",
    edit: (c) => c.editJson(B("2026-10-12"), (b) => {
      b.review.setbacks = ["soc-2026-0199"];
      b.review.fell = ["phys-2026-0198"];
      b.review.strongest_against = { text: { en: "A made-up note about the setback and the fall.", zh: "關於這個挫折和這次失敗的虛構說明。" }, finding_ids: ["soc-2026-0199", "phys-2026-0198"], source_ids: [] };
    }),
    expect: [
      "E XREF briefs/2026-10-12.json: review.fell[0]",
      "E XREF briefs/2026-10-12.json: review.setbacks[0]",
      "E XREF briefs/2026-10-12.json: review.strongest_against.finding_ids[0]",
      "E XREF briefs/2026-10-12.json: review.strongest_against.finding_ids[1]",
    ],
  },
  { name: "XREF: a correction line names a finding that is not stored", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.corrections[0].finding_id = "math-2026-0199"; }), expect: [
      "E XREF briefs/2026-10-14.json: corrections[0].finding_id",
      "E XREF briefs/2026-10-14.json: corrections[0].id",
    ] },
  { name: "XREF: a report line names a finding that is not stored", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.reports[0].finding_id = "math-2026-0199"; }), expect: [
      "E XREF briefs/2026-10-14.json: reports[0].finding_id",
      "E XREF briefs/2026-10-14.json: reports[0].id",
    ] },

  // A finding's references.
  { name: "XREF: a brief shows a finding whose briefs list omits it (the listed brief names it only in a report line)", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.briefs = ["2026-10-13"]; f.first_brief = "2026-10-13"; }), expect: [
      "E XREF findings/earth-2026-0141.json: briefs",
    ] },
  { name: "XREF: a finding lists a brief that does not name it", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.briefs = ["2026-10-12", "2026-10-16"]; }), expect: [
      "E XREF findings/earth-2026-0141.json: briefs[1]",
    ] },
  { name: "XREF: a finding lists a brief that is not stored", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.briefs = ["2026-10-12", "2026-10-30"]; }), expect: [
      "E XREF findings/earth-2026-0141.json: briefs[1]",
    ] },
  { name: "XREF: a finding lists a term that the glossary lacks", edit: (c) => c.editJson("glossary.json", (g) => { g.terms = g.terms.filter((t: { id: string }) => t.id !== "plasma"); }), expect: [
      "E XREF findings/phys-2026-0147.json: terms[0]",
    ] },
  { name: "XREF: a finding relates to a finding that is not stored", edit: (c) => c.editJson(F("phys-2026-0147"), (f) => { f.related = ["phys-2026-0199"]; }), expect: [
      "E XREF findings/phys-2026-0147.json: related[0]",
    ] },
  { name: "XREF: a glossary term's first finding is not stored", edit: (c) => c.editJson("glossary.json", (g) => { g.terms[0].first_finding = "bio-2026-0199"; }), expect: [
      "E XREF glossary.json: terms[0].first_finding",
    ] },

  // Stored corrections and reports.
  { name: "XREF: a stored correction names a finding that is not stored", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[0].finding_id = "math-2026-0199"; }), expect: [
      "E XREF briefs/2026-10-14.json: corrections[0].id",
      "E XREF corrections.json: corrections[0].finding_id",
    ] },
  { name: "XREF: a stored correction names an edition that is not stored", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections.push(correction({ id: "C-0003", edition_date: "2026-10-30", path: "lead.0.text" })); }), expect: [
      "E XREF corrections.json: corrections[2].edition_date",
    ] },
  { name: "XREF: a stored correction names a term that is not stored", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections.push(correction({ id: "C-0003", term_id: "no-such-term", path: "definition" })); }), expect: [
      "E XREF corrections.json: corrections[2].term_id",
    ] },
  { name: "XREF: a stored correction answers a report that is not stored", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[1].report_id = "R-0009"; }), expect: [
      "E XREF corrections.json: corrections[1].report_id",
    ] },
  { name: "XREF: a stored report names a finding that is not stored", edit: (c) => c.editJson("reports.json", (g) => { g.reports[0].finding_id = "earth-2026-0199"; }), expect: [
      "E XREF briefs/2026-10-13.json: reports[0].id",
      "E XREF reports.json: reports[0].finding_id",
    ] },
  { name: "XREF: a stored report names a correction that is not stored", edit: (c) => c.editJson("reports.json", (g) => { g.reports[0].correction_id = "C-0009"; }), expect: [
      "E XREF reports.json: reports[0].correction_id",
    ] },
  { name: "XREF: a brief's correction line has no stored correction", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections = g.corrections.slice(0, 1); }), expect: [
      "E XREF briefs/2026-10-14.json: corrections[1].id",
      "E XREF reports.json: reports[0].correction_id",
    ] },
  { name: "XREF: a brief's report line has no stored report", edit: (c) => c.editJson("reports.json", (g) => { g.reports = g.reports.slice(0, 1); }), expect: [
      "E XREF briefs/2026-10-14.json: reports[0].id",
      "E XREF corrections.json: corrections[0].report_id",
    ] },
  { name: "XREF: two stored corrections swap their ids", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections.reverse(); }), expect: [
      "E XREF corrections.json: corrections[0].id",
    ] },
  { name: "XREF: a correction id is used twice", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[1].id = "C-0001"; }), expect: [
      "E XREF briefs/2026-10-14.json: corrections[0].id",
      "E XREF briefs/2026-10-14.json: corrections[1].id",
      "E XREF corrections.json: corrections[1].id",
      "E XREF reports.json: reports[0].correction_id",
    ] },
  { name: "XREF: report ids skip a number", edit: (c) => c.editJson("reports.json", (g) => { g.reports[1].id = "R-0003"; }), expect: [
      "E XREF briefs/2026-10-14.json: reports[0].id",
      "E XREF corrections.json: corrections[0].report_id",
      "E XREF reports.json: reports[1].id",
    ] },

  // The files a stored brief points at.
  { name: "XREF: a brief's metrics file is missing", edit: (c) => c.remove("metrics/2026-10-16.json"), expect: [
      "E XREF briefs/2026-10-16.json: pace.metrics_file",
    ] },
  { name: "XREF: a Pace whose status is missing has no metrics file to point at", edit: (c) => { c.editJson("briefs/2026-10-16.json", (b) => { b.pace.status = "missing"; }); c.remove("metrics/2026-10-16.json"); }, expect: [] },
  { name: "XREF: a stale Pace still points at its metrics file", edit: (c) => { c.editJson("briefs/2026-10-16.json", (b) => { b.pace.status = "stale"; }); c.remove("metrics/2026-10-16.json"); }, expect: [
      "E XREF briefs/2026-10-16.json: pace.metrics_file",
    ] },
  { name: "XREF: a brief's status file is missing", edit: (c) => c.remove("status/2026-10-16.json"), expect: [
      "E XREF briefs/2026-10-16.json: (status)",
    ] },

  // The archive index lists exactly the stored briefs, and its refs name records that exist.
  { name: "XREF: the archive index is missing", edit: (c) => c.remove(ARCHIVE), expect: [
      "E XREF archive-index.json: (file)",
    ] },
  { name: "XREF: the archive index lists an edition that is not stored", edit: (c) => c.editJson(ARCHIVE, (a) => { a.editions.unshift({ date: "2026-10-30", edition: "full", published_at: "2026-10-30T03:55:26+08:00", finding_count: 0, corrected: false }); }), expect: [
      "E XREF archive-index.json: editions[0].date",
    ] },
  { name: "XREF: the archive index leaves out a stored brief", edit: (c) => c.editJson(ARCHIVE, (a) => { a.editions = a.editions.filter((e: { date: string }) => e.date !== "2026-10-17"); }), expect: [
      "E XREF archive-index.json: editions",
    ] },
  { name: "XREF: the archive index gives an edition the wrong kind", edit: (c) => c.editJson(ARCHIVE, (a) => { a.editions.find((e: { date: string }) => e.date === "2026-10-15").edition = "full"; }), expect: [
      "E XREF archive-index.json: editions[3].edition",
    ] },
  { name: "XREF: the archive index gives an edition the wrong publish time", edit: (c) => c.editJson(ARCHIVE, (a) => { a.editions.find((e: { date: string }) => e.date === "2026-10-17").published_at = "2026-10-17T04:00:00+08:00"; }), expect: [
      "E XREF archive-index.json: editions[1].published_at",
    ] },
  { name: "XREF: the archive index cites a finding that is not stored", edit: (c) => c.editJson(ARCHIVE, (a) => { a.urls["https://aldgate-council-sample.gov/ut-sample/ai-disclosure-draft-rule"].refs = ["soc-2026-0199"]; }), expect: [
      "E XREF archive-index.json: urls[\"https://aldgate-council-sample.gov/ut-sample/ai-disclosure-draft-rule\"].refs[0]",
    ] },
  { name: "XREF: the archive index cites the brief-level text of an edition that is not stored", edit: (c) => c.editJson(ARCHIVE, (a) => { a.urls["https://arxiv.org/abs/2610.99002"].refs = ["2026-10-30/brief"]; }), expect: [
      "E XREF archive-index.json: urls[\"https://arxiv.org/abs/2610.99002\"].refs[0]",
    ] },
  { name: "XREF: a publishing date with no stored brief is one XREF at (publishing)", publishing: "2026-10-30", edit: NO_EDIT, expect: [
      "E XREF (publishing)",
    ] },
];


/**
 * LANG_PARITY (SPEC 4.12): in a brief with languages.zh true, a Chinese string on each L10n of the brief's own, on the after of each
 * correction it lists, on the title of each finding it names, on the explainer, figure alt and terms of each finding it first
 * published, and on each rung note recorded on its date. An English-only brief owes none of them.
 */
const LANG_CASES: PubCase[] = [
  // Each L10n of the brief's own.
  { name: "LANG_PARITY: the Pace sentence has no Chinese", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.pace.sentence.zh = null; }), expect: [
      "E LANG_PARITY briefs/2026-10-14.json: pace.sentence.zh",
    ] },
  { name: "LANG_PARITY: a Lead line has no Chinese", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.lead[0].text.zh = null; }), expect: [
      "E LANG_PARITY briefs/2026-10-14.json: lead[0].text.zh",
    ] },
  { name: "LANG_PARITY: an Also noted title has no Chinese", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.also[0].title.zh = null; }), expect: [
      "E LANG_PARITY briefs/2026-10-14.json: also[0].title.zh",
    ] },
  { name: "LANG_PARITY: an idea has no Chinese", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.ideas[0].text.zh = null; }), expect: [
      "E LANG_PARITY briefs/2026-10-14.json: ideas[0].text.zh",
    ] },
  { name: "LANG_PARITY: the status note has no Chinese", edit: (c) => c.editJson(B("2026-10-15"), (b) => { b.status_note.zh = null; }), expect: [
      "E LANG_PARITY briefs/2026-10-15.json: status_note.zh",
    ] },
  { name: "LANG_PARITY: the week in review has no Chinese", edit: (c) => c.editJson(B("2026-10-12"), (b) => { b.review.big_picture.zh = null; }), expect: [
      "E LANG_PARITY briefs/2026-10-12.json: review.big_picture.zh",
    ] },
  { name: "LANG_PARITY: the deep dive has no Chinese", edit: (c) => c.editJson(B("2026-10-18"), (b) => { b.deep_dive.text.zh = null; }), expect: [
      "E LANG_PARITY briefs/2026-10-18.json: deep_dive.text.zh",
    ] },

  // The after of each correction the brief lists.
  { name: "LANG_PARITY: a listed correction's after has no Chinese", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[0].after.zh = null; }), expect: [
      "E LANG_PARITY corrections.json: corrections[0].after.zh",
    ] },

  // The title of each finding the brief names, and each rung note recorded on its date.
  { name: "LANG_PARITY: a finding's title has no Chinese: one issue for each bilingual brief that names it (the 12th and the 14th; the English-only 13th names it too and owes none)", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.title.zh = null; }), expect: [
      "E LANG_PARITY findings/earth-2026-0141.json: title.zh",
      "E LANG_PARITY findings/earth-2026-0141.json: title.zh",
    ] },
  { name: "LANG_PARITY: a rung note recorded on the brief's date has no Chinese", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => { f.rung_history[1].note.zh = null; }), expect: [
      "E LANG_PARITY findings/chem-2026-0142.json: rung_history[1].note.zh",
    ] },
  { name: "LANG_PARITY: a rung note has no Chinese, and only the brief of the day it was recorded fails, not the later brief that also names the finding", edit: (c) => c.editJson(F("bio-2026-0143"), (f) => { f.rung_history[1].note.zh = null; }), expect: [
      "E LANG_PARITY findings/bio-2026-0143.json: rung_history[1].note.zh",
    ] },
  { name: "LANG_PARITY: a seed that no brief names owes no Chinese", edit: (c) => c.editJson(F("math-2026-0131"), (f) => { f.title.zh = null; f.rung_history[1].note.zh = null; }), expect: [] },

  // The explainer, figure alt text and terms of each finding the brief first published.
  { name: "LANG_PARITY: two explainer parts of a first-published finding have no Chinese", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.found.zh = null; f.explainer.background.zh = null; }), expect: [
      "E LANG_PARITY findings/earth-2026-0141.json: explainer.background.zh",
      "E LANG_PARITY findings/earth-2026-0141.json: explainer.found.zh",
    ] },
  { name: "LANG_PARITY: a figure's alt text has no Chinese", edit: (c) => c.editJson(F("hum-2026-0148"), (f) => { f.figure.alt.zh = null; }), expect: [
      "E LANG_PARITY findings/hum-2026-0148.json: figure.alt.zh",
    ] },
  { name: "LANG_PARITY: a term of a first-published finding has no Chinese form", edit: (c) => c.editJson("glossary.json", (g) => { g.terms.find((t: { id: string }) => t.id === "plasma").zh = null; }), expect: [
      "E LANG_PARITY glossary.json: terms[4].zh",
    ] },

  // An English-only edition owes none of it, and an older brief is not failed by a later one.
  { name: "LANG_PARITY: the English-only edition of the sample owes no Chinese for its Pace sentence", edit: (c) => c.editJson(B("2026-10-13"), (b) => { b.pace.sentence.zh = null; }), expect: [] },
  {
    name: "LANG_PARITY: an English-only brief and the finding it first published need no Chinese",
    edit: (c) => {
      c.editJson(B("2026-10-18"), (b) => { b.languages.zh = false; nullZh(b); });
      c.editJson(F("hum-2026-0152"), (f) => { nullZh(f.title); nullZh(f.explainer); nullZh(f.rung_history); });
    },
    expect: [],
  },
];


/**
 * FILE_LAYOUT (SPEC 4.12, section 3): only the paths of SPEC section 3 under the content folder; a stray path, a dated file without a
 * real date in its name, a finding file not named by its id, and a link or folder that is not a regular file are one issue each. The
 * root README.md and a .DS_Store anywhere are never listed.
 */
const LAYOUT_CASES: PubCase[] = [
  { name: "FILE_LAYOUT: a stray file in the root", edit: (c) => c.writeRaw("notes.txt", "A made-up note.\n"), expect: [
      "E FILE_LAYOUT notes.txt: (file)",
    ] },
  { name: "FILE_LAYOUT: a stray file in state/", edit: (c) => c.writeRaw("state/old.json", "{}\n"), expect: [
      "E FILE_LAYOUT state/old.json: (file)",
    ] },
  { name: "FILE_LAYOUT: a stray file deeper than metrics/inputs/", edit: (c) => c.writeRaw("metrics/inputs/extra/2026-10-12.json", "{}\n"), expect: [
      "E FILE_LAYOUT metrics/inputs/extra/2026-10-12.json: (file)",
    ] },
  { name: "FILE_LAYOUT: a README.md in a subfolder", edit: (c) => c.writeRaw("briefs/README.md", "A made-up note.\n"), expect: [
      "E FILE_LAYOUT briefs/README.md: (file)",
    ] },
  { name: "FILE_LAYOUT: a brief named for a date that does not exist", edit: (c) => c.writeRaw("briefs/2026-13-45.json", "{}\n"), expect: [
      "E FILE_LAYOUT briefs/2026-13-45.json: (file)",
    ] },
  { name: "FILE_LAYOUT: a status file not named by a date", edit: (c) => c.writeRaw("status/latest.json", "{}\n"), expect: [
      "E FILE_LAYOUT status/latest.json: (file)",
    ] },
  { name: "FILE_LAYOUT: a finding file not named by an id", edit: (c) => c.writeRaw("findings/notes.json", "{}\n"), expect: [
      "E FILE_LAYOUT findings/notes.json: (file)",
    ] },
  { name: "FILE_LAYOUT: a copy of a finding file named by another id than the one it holds", edit: (c) => c.writeRaw(F("phys-2026-0999"), c.text(F("phys-2026-0147"))), expect: [
      "E FILE_LAYOUT findings/phys-2026-0999.json: id",
    ] },
  { name: "FILE_LAYOUT with XREF: a finding file renamed by another id leaves its id without a file", edit: (c) => c.rename(F("phys-2026-0147"), F("phys-2026-0999")), expect: [
      "E FILE_LAYOUT findings/phys-2026-0999.json: id",
      "E XREF archive-index.json: urls[\"https://fernhill-sample.edu/news/ut-sample-plasma-controller\"].refs[0]",
      "E XREF archive-index.json: urls[\"https://link.springer.com/article/10.1007/ut-sample-0020\"].refs[0]",
      "E XREF briefs/2026-10-12.json: items[0].finding_id",
      "E XREF briefs/2026-10-12.json: lead[1].finding_ids[0]",
      "E XREF glossary.json: terms[4].first_finding",
    ] },
  { name: "FILE_LAYOUT: a link in place of a brief", edit: (c) => c.link(B("2026-10-30"), "2026-10-12.json"), expect: [
      "E FILE_LAYOUT briefs/2026-10-30.json: (file)",
    ] },
  { name: "FILE_LAYOUT: a folder with a file in it in place of a brief", edit: (c) => c.writeRaw("briefs/2026-10-31.json/x.json", "{}\n"), expect: [
      "E FILE_LAYOUT briefs/2026-10-31.json/x.json: (file)",
    ] },
  { name: "FILE_LAYOUT: an empty folder is never listed (git keeps none)", edit: (c) => { c.writeRaw("briefs/2026-10-31.json/x", ""); c.remove("briefs/2026-10-31.json/x"); }, expect: [] },
  { name: "FILE_LAYOUT: the root README.md that keeps an empty folder in git is never listed", edit: (c) => c.writeRaw("README.md", "A made-up placeholder.\n"), expect: [] },
  { name: "FILE_LAYOUT: a .DS_Store in the root and in a subfolder is never listed", edit: (c) => { c.writeRaw(".DS_Store", "x"); c.writeRaw("findings/.DS_Store", "x"); }, expect: [] },
];

/** A file that cannot be read as JSON is one SCHEMA issue at (file), never a crash and never a second issue for the same fault. */
const UNREADABLE_CASES: PubCase[] = [
  { name: "unreadable: a finding that is not JSON is one issue", edit: (c) => c.writeRaw(F("phys-2026-0147"), "{ not json"), expect: [
      "E SCHEMA findings/phys-2026-0147.json: (file)",
    ] },
  { name: "unreadable: an empty brief is one issue", edit: (c) => c.writeRaw(B("2026-10-16"), ""), expect: [
      "E SCHEMA briefs/2026-10-16.json: (file)",
    ] },
  { name: "unreadable: a glossary that starts with a byte order mark is one issue", edit: (c) => c.writeRaw("glossary.json", `﻿${c.text("glossary.json")}`), expect: [
      "E SCHEMA glossary.json: (file)",
    ] },
  { name: "unreadable: a status file that is not UTF-8 is one issue", edit: (c) => c.writeRaw("status/2026-10-12.json", new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])), expect: [
      "E SCHEMA status/2026-10-12.json: (file)",
    ] },
  { name: "unreadable: corrections that are not JSON are one issue, and the briefs that list a correction raise none of their own", edit: (c) => c.writeRaw("corrections.json", "[1, 2"), expect: [
      "E SCHEMA corrections.json: (file)",
    ] },
  { name: "unreadable: reports that are not JSON are one issue", edit: (c) => c.writeRaw("reports.json", "nope"), expect: [
      "E SCHEMA reports.json: (file)",
    ] },
  { name: "unreadable: an archive index that is not JSON is one issue", edit: (c) => c.writeRaw("archive-index.json", "{"), expect: [
      "E SCHEMA archive-index.json: (file)",
    ] },
];


const budget = (findingsMax: number) => (base: LoadedConfig): LoadedConfig =>
  ({ ...base, run: { ...base.run, budgets: { ...base.run.budgets, findings_max: findingsMax } } });

/** A stored correction that refiles a finding's significance (SPEC 4.10: a correction of a vocabulary value carries its id as `after`). */
const refileSignificance = (id: string, from: string, to: string, date: string): Record<string, unknown> => correction({
  id: "C-0003", date, finding_id: id, type: "correction", path: "significance",
  before: { en: from, zh: null }, after: { en: to, zh: null }, reason: { en: "A made-up reason.", zh: null },
});

/** The structure rules on stored records (SPEC 4.12 "Stored records"): what a stored brief and finding are judged on, and what only the brief being published is. */
const STRUCT_CASES: PubCase[] = [
  // DATE_MISMATCH: a stored brief's date is its file's name; the window and the deadline are the run's own inputs, never checked.
  { name: "DATE_MISMATCH: a stored brief holds another date than its file's name", edit: (c) => c.editJson(B("2026-10-16"), (b) => { b.date = "2026-10-17"; b.pace.metrics_file = "metrics/2026-10-17.json"; }), expect: [
      "E DATE_MISMATCH briefs/2026-10-16.json: date",
    ] },
  { name: "DATE_MISMATCH: a publish time long after the day is not checked (only the archive index's copy of it is)", edit: (c) => c.editJson(B("2026-10-16"), (b) => { b.published_at = "2026-10-16T21:00:00+08:00"; }), expect: [
      "E XREF archive-index.json: editions[2].published_at",
    ] },

  // WEEK_AGAINST: a stored Monday's review against its own setbacks and falls.
  { name: "WEEK_AGAINST: a Monday review lists a setback beside NONE_FOUND", edit: (c) => c.editJson(B("2026-10-12"), (b) => { b.review.setbacks = ["phys-2026-0134"]; }), expect: [
      "E WEEK_AGAINST briefs/2026-10-12.json: review.strongest_against.text.en",
    ] },
  { name: "WEEK_AGAINST: a Monday review lists a fall beside NONE_FOUND", edit: (c) => c.editJson(B("2026-10-12"), (b) => { b.review.fell = ["phys-2026-0134"]; }), expect: [
      "E WEEK_AGAINST briefs/2026-10-12.json: review.strongest_against.text.en",
    ] },
  {
    name: "WEEK_AGAINST: a fall that strongest_against does not cite fails when its text is not NONE_FOUND",
    edit: (c) => c.editJson(B("2026-10-12"), (b) => {
      b.review.fell = ["phys-2026-0134"];
      b.review.strongest_against = { text: { en: "A made-up note about the fall.", zh: "關於這次失敗的虛構說明。" }, finding_ids: [], source_ids: [] };
    }),
    expect: [
      "E WEEK_AGAINST briefs/2026-10-12.json: review.strongest_against.finding_ids",
    ],
  },
  {
    name: "WEEK_AGAINST: a setback and a fall that strongest_against cites, with an extra id, pass",
    edit: (c) => c.editJson(B("2026-10-12"), (b) => {
      b.review.fell = ["phys-2026-0134"];
      b.review.setbacks = ["chem-2026-0150"];
      b.review.strongest_against = { text: { en: "A made-up note about the fall and the setback.", zh: "關於這次失敗和這個挫折的虛構說明。" }, finding_ids: ["phys-2026-0134", "chem-2026-0150", "math-2026-0131"], source_ids: [] };
    }),
    expect: [],
  },

  // FORMAT_SECTIONS: the sections a stored brief's format has; the context's halves are not checked.
  { name: "FORMAT_SECTIONS: a weekday brief has a deep dive", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.deep_dive = { ...c.read(B("2026-10-18")).deep_dive, finding_id: "bio-2026-0149" }; }), expect: [
      "E FORMAT_SECTIONS briefs/2026-10-14.json: deep_dive",
    ] },
  { name: "FORMAT_SECTIONS: a Monday brief has no review", edit: (c) => c.editJson(B("2026-10-12"), (b) => { b.review = null; b.disclosure = b.disclosure.filter((path: string) => path !== "review"); }), expect: [
      "E FORMAT_SECTIONS briefs/2026-10-12.json: review",
    ] },
  { name: "FORMAT_SECTIONS: a weekday brief has an item and no story", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.story = null; }), expect: [
      "E FORMAT_SECTIONS briefs/2026-10-14.json: story",
    ] },
  { name: "FORMAT_SECTIONS: a Sunday brief with no deep dive is not judged against the Ledger (the context's half)", edit: (c) => c.editJson(B("2026-10-18"), (b) => { b.deep_dive = null; }), expect: [] },
  {
    name: "FORMAT_SECTIONS: a Sunday brief shows three findings (the others' own briefs lists then lack the date)",
    edit: (c) => c.editJson(B("2026-10-18"), (b) => {
      const update = { en: "A made-up update.", zh: "虛構的更新。" };
      b.items.push({ finding_id: "bio-2026-0149", new: false, update }, { finding_id: "chem-2026-0150", new: false, update });
    }),
    expect: [
      "E FORMAT_SECTIONS briefs/2026-10-18.json: items",
      "E XREF findings/bio-2026-0149.json: briefs",
      "E XREF findings/chem-2026-0150.json: briefs",
    ],
  },

  // COUNTS: the fixed counts on every stored record; the run's budget only on the brief being published.
  { name: "COUNTS: a stored brief has three ideas", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.ideas.push({ ...b.ideas[0] }); }), expect: [
      "E COUNTS briefs/2026-10-14.json: ideas",
    ] },
  { name: "COUNTS: a stored brief has six Also noted lines", edit: (c) => c.editJson(B("2026-10-14"), (b) => { while (b.also.length < 6) b.also.push({ ...b.also[0] }); }), expect: [
      "E COUNTS briefs/2026-10-14.json: also",
    ] },
  {
    name: "COUNTS: a stored finding has six related findings",
    edit: (c) => c.editJson(F("math-2026-0151"), (f) => { f.related = ["math-2026-0140", "math-2026-0131", "phys-2026-0134", "phys-2026-0147", "soc-2026-0144", "soc-2026-0146"]; }),
    expect: [
      "E COUNTS findings/math-2026-0151.json: related",
    ],
  },
  { name: "COUNTS: a stored finding has five reactions", edit: (c) => c.editJson(F("hum-2026-0148"), (f) => { while (f.reactions.length < 5) f.reactions.push({ ...f.reactions[0] }); }), expect: [
      "E COUNTS findings/hum-2026-0148.json: reactions",
    ] },
  { name: "COUNTS: findings_max binds the brief being published", publishing: "2026-10-14", config: budget(4), edit: NO_EDIT, expect: [
      "E COUNTS briefs/2026-10-14.json: items",
    ] },
  { name: "COUNTS: findings_max does not bind a brief published before", publishing: "2026-10-18", config: budget(4), edit: NO_EDIT, expect: [] },
  { name: "COUNTS: findings_max does not bind a stored brief when none is being published", config: budget(4), edit: NO_EDIT, expect: [] },

  // FIELD_CAP and STORY_PICK, as filed.
  {
    name: "FIELD_CAP: a stored brief shows three social science findings (the third one's briefs list then lacks the date)",
    edit: (c) => c.editJson(B("2026-10-13"), (b) => { b.items.push({ finding_id: "soc-2026-0145", new: false, update: { en: "A made-up update.", zh: "虛構的更新。" } }); }),
    expect: [
      "E FIELD_CAP briefs/2026-10-13.json: items[3]",
      "E XREF findings/soc-2026-0145.json: briefs",
    ],
  },
  {
    name: "STORY_PICK: a stored correction dated on the brief's day lowers the story, so a higher-ranked finding is not the story",
    edit: (c) => c.editJson("corrections.json", (g) => { g.corrections.push(refileSignificance("hum-2026-0148", "landmark", "watch", "2026-10-14")); }),
    expect: [
      "E STORY_PICK briefs/2026-10-14.json: items[0]",
      "E STORY_PICK briefs/2026-10-14.json: items[1]",
      "E STORY_PICK briefs/2026-10-14.json: items[2]",
      "E STORY_PICK briefs/2026-10-14.json: items[3]",
    ],
  },
  {
    name: "STORY_PICK: a stored correction dated after the brief's day changes nothing",
    edit: (c) => c.editJson("corrections.json", (g) => { g.corrections.push(refileSignificance("hum-2026-0148", "landmark", "watch", "2026-10-15")); }),
    expect: [],
  },

  // SOURCE_IDS: how the sources of a stored record are numbered and cited.
  { name: "SOURCE_IDS: a stored finding's sources skip an id", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[1].id = "s3"; }), expect: [
      "E SOURCE_IDS findings/earth-2026-0141.json: ai.evidence[1].source_id",
      "E SOURCE_IDS findings/earth-2026-0141.json: go_deeper[1]",
      "E SOURCE_IDS findings/earth-2026-0141.json: rung_history[1].source_id",
      "E SOURCE_IDS findings/earth-2026-0141.json: sources[1].id",
    ] },
  { name: "SOURCE_IDS: a stored brief cites a source it does not hold", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.also[0].source_id = "b9"; }), expect: [
      "E SOURCE_IDS briefs/2026-10-14.json: also[0].source_id",
    ] },
  { name: "SOURCE_IDS: a stored finding's go_deeper cites a source it does not hold", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.go_deeper = ["s1", "s9"]; }), expect: [
      "E SOURCE_IDS findings/earth-2026-0141.json: go_deeper[1]",
    ] },
];


/** A stored correction that refiles one of a finding's own values (a vocabulary id as its `after`, SPEC 4.10). */
const refile = (id: string, finding: string, date: string, path: string, from: string, to: string): Record<string, unknown> => correction({
  id, date, finding_id: finding, type: "correction", path, before: { en: from, zh: null }, after: { en: to, zh: null },
});
const push = (...items: Record<string, unknown>[]) => (c: { editJson: (rel: string, edit: (g: { corrections: unknown[] }) => unknown) => void }): void =>
  c.editJson("corrections.json", (g) => { g.corrections.push(...items); });

/**
 * SUBFIELD_UNKNOWN in published mode (SPEC 4.12 "Stored records"): the config reads only the records being published, which are the
 * findings first briefed on the publishing date, the corrections dated on it and the brief itself.
 */
const SUBFIELD_CASES: PubCase[] = [
  { name: "SUBFIELD_UNKNOWN: a finding being published has a subfield its field lacks", publishing: "2026-10-14", edit: (c) => c.editJson(F("bio-2026-0149"), (f) => { f.subfield = "protein"; }), expect: [
      "E SUBFIELD_UNKNOWN findings/bio-2026-0149.json: subfield",
    ] },
  { name: "SUBFIELD_UNKNOWN: a biology finding being published has a humanities subfield", publishing: "2026-10-14", edit: (c) => c.editJson(F("bio-2026-0149"), (f) => { f.subfield = "ancient-texts"; }), expect: [
      "E SUBFIELD_UNKNOWN findings/bio-2026-0149.json: subfield",
    ] },
  { name: "SUBFIELD_UNKNOWN: the same bad subfield on a finding first briefed earlier is not judged", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.subfield = "protein"; }), expect: [] },
  { name: "SUBFIELD_UNKNOWN: the same bad subfield with no edition being published is not judged", edit: (c) => c.editJson(F("bio-2026-0149"), (f) => { f.subfield = "protein"; }), expect: [] },
  {
    name: "SUBFIELD_UNKNOWN: a subfield correction dated on the publishing day names a subfield outside the field the finding has that day",
    publishing: "2026-10-14",
    edit: push(refile("C-0003", "bio-2026-0149", "2026-10-14", "field", "biology", "chemistry"), refile("C-0004", "bio-2026-0149", "2026-10-14", "subfield", "proteins", "genomics")),
    expect: [
      "E SUBFIELD_UNKNOWN corrections.json: corrections[3].after.en",
    ],
  },
  {
    name: "SUBFIELD_UNKNOWN: a field correction dated on the publishing day with no subfield correction of that finding and day",
    publishing: "2026-10-14",
    edit: push(refile("C-0003", "bio-2026-0149", "2026-10-14", "field", "biology", "chemistry")),
    expect: [
      "E SUBFIELD_UNKNOWN corrections.json: corrections[2].after.en",
    ],
  },
  {
    name: "SUBFIELD_UNKNOWN: a field and a subfield correction of the same day that agree pass",
    publishing: "2026-10-14",
    edit: push(refile("C-0003", "bio-2026-0149", "2026-10-14", "field", "biology", "chemistry"), refile("C-0004", "bio-2026-0149", "2026-10-14", "subfield", "proteins", "catalysis")),
    expect: [],
  },
  {
    name: "SUBFIELD_UNKNOWN: a field correction dated on an earlier day is not judged on the publishing day",
    publishing: "2026-10-14",
    edit: push(refile("C-0003", "bio-2026-0149", "2026-10-13", "field", "biology", "chemistry")),
    expect: [],
  },
  {
    name: "SUBFIELD_UNKNOWN: a subfield correction of another finding does not pair with a field correction",
    publishing: "2026-10-14",
    edit: push(refile("C-0003", "bio-2026-0149", "2026-10-14", "field", "biology", "chemistry"), refile("C-0004", "chem-2026-0150", "2026-10-14", "subfield", "materials", "catalysis")),
    expect: [
      "E SUBFIELD_UNKNOWN corrections.json: corrections[2].after.en",
    ],
  },
];

/** The ladder and AI rules on stored records: each judges every stored record the same way, a record being published or not. */
const LADDER_CASES: PubCase[] = [
  { name: "RUNG_ORDER: a stored finding's rung history is out of date order", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.rung_history[0].date = "2026-10-07"; }), expect: [
      "E RUNG_ORDER findings/earth-2026-0141.json: rung_history[1].date",
    ] },
  { name: "RUNG_ORDER: a stored finding's rung is not its last entry's", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.rung = "checked"; }), expect: [
      "E RUNG_ORDER findings/earth-2026-0141.json: rung",
    ] },
  { name: "RUNG_ORDER: a stored brief's rung change is dated after the brief", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.rung_changes[0].date = "2026-10-20"; }), expect: [
      "E RUNG_ORDER briefs/2026-10-14.json: rung_changes[0].date",
    ] },
  { name: "RUNG_EVIDENCE: a Confirmed entry whose source is a notice (WHO_SAYS also reads the Confirmed record's how_sure)", edit: (c) => c.editJson(F("chem-2026-0150"), (f) => { f.rung = "confirmed"; f.rung_history[0].rung = "confirmed"; f.rung_history[0].source_id = "s2"; }), expect: [
      "E RUNG_EVIDENCE findings/chem-2026-0150.json: rung_history[0].source_id",
      "E WHO_SAYS findings/chem-2026-0150.json: explainer.how_sure.en",
    ] },
  { name: "CLAIMED_CAP: a stored finding at Claimed is above Notable", edit: (c) => c.editJson(F("soc-2026-0145"), (f) => { f.significance = "major"; }), expect: [
      "E CLAIMED_CAP findings/soc-2026-0145.json: significance",
    ] },
  { name: "CLAIMED_CAP: a stored significance correction lifts a Preprint finding above Notable; the finding is judged as filed now, and the brief of the earlier day is not judged by it", edit: push(refile("C-0003", "math-2026-0151", "2026-10-20", "significance", "notable", "major")), expect: [
      "E CLAIMED_CAP findings/math-2026-0151.json: significance",
    ] },
  { name: "LANDMARK_BASIS: a Landmark at Checked with one reaction", edit: (c) => c.editJson(F("hum-2026-0148"), (f) => { f.reactions = f.reactions.slice(0, 1); }), expect: [
      "E LANDMARK_BASIS findings/hum-2026-0148.json: significance",
    ] },
  { name: "SETBACK_MAJOR: a stored setback below Major", edit: (c) => c.editJson(F("chem-2026-0150"), (f) => { f.significance = "notable"; }), expect: [
      "E SETBACK_MAJOR findings/chem-2026-0150.json: significance",
    ] },
  { name: "AI_SYSTEM_NAMED: a stored result that names no system", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.ai.systems = []; }), expect: [
      "E AI_SYSTEM_NAMED findings/earth-2026-0141.json: ai.systems",
    ] },
  {
    name: "WHO_SAYS: a stored claimed finding whose how_sure does not say who claims it",
    edit: (c) => c.editJson(F("soc-2026-0145"), (f) => {
      f.explainer.how_sure = {
        en: "Claimed. The draft is a proposal, not yet a rule, and it may change after the comment period closes. No other source we read says how it will be handled. Treat the details as open until the final text is out.",
        zh: "宣稱。這份草案只是提議，還不是正式規定，意見徵詢期結束後可能修改。我們讀過的其他來源，都沒有說明會怎麼處理，所以在最終文字公布之前，讀者應該把細節視為尚未確定。",
      };
    }),
    expect: [
      "E WHO_SAYS findings/soc-2026-0145.json: explainer.how_sure.en",
    ],
  },
  {
    name: "POSSIBILITY: a stored could_lead without a word of possibility",
    edit: (c) => c.editJson(F("earth-2026-0141"), (f) => {
      f.explainer.could_lead = {
        en: "Forecasters then trust longer forecasts and warn people earlier when the gain holds in other seasons and other places. Outside teams then test the model next, on live forecasts and in other regions.",
        zh: "當這個改善在其他季節和地方也成立時，預報員便信任更長期的預報，並更早發出警示。接下來，外部團隊便用即時預報和其他地區測試這個模型。",
      };
    }),
    expect: [
      "E POSSIBILITY findings/earth-2026-0141.json: explainer.could_lead.en",
    ],
  },
];

/** SOURCE_URL, PRIMARY_ONLY, GO_DEEPER and FIGURE_LICENCE: which of them read config (the records being published only) and which are never demoted. */
const SOURCES_CASES: PubCase[] = [
  { name: "PRIMARY_ONLY: a press host as the source of a finding being published", publishing: "2026-10-12", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[0].url = "https://www.nytimes.com/2026/10/10/science/ut-sample.html"; }), expect: [
      "E PRIMARY_ONLY findings/earth-2026-0141.json: sources[0].url",
    ] },
  { name: "PRIMARY_ONLY: the same press host on a finding not being published passes (the config may have changed since)", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[0].url = "https://www.nytimes.com/2026/10/10/science/ut-sample.html"; }), expect: [] },
  { name: "SOURCE_URL: an http source of a finding being published is an error", publishing: "2026-10-12", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[0].url = "http://www.science.org/doi/10.1126/ut-sample.0012"; }), expect: [
      "E SOURCE_URL findings/earth-2026-0141.json: sources[0].url",
    ] },
  { name: "SOURCE_URL: the same http source on a finding not being published is a warning", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[0].url = "http://www.science.org/doi/10.1126/ut-sample.0012"; }), expect: [
      "W SOURCE_URL findings/earth-2026-0141.json: sources[0].url",
    ] },
  { name: "SOURCE_URL: the same http source with no edition being published is a warning", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[0].url = "http://www.science.org/doi/10.1126/ut-sample.0012"; }), expect: [
      "W SOURCE_URL findings/earth-2026-0141.json: sources[0].url",
    ] },
  { name: "SOURCE_URL: one page twice in a finding's source list", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[1].url = f.sources[0].url; }), expect: [
      "W SOURCE_URL findings/earth-2026-0141.json: sources[1].url",
    ] },
  { name: "GO_DEEPER: a stored finding with no go_deeper id is an error even when it is not being published", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.go_deeper = []; }), expect: [
      "E GO_DEEPER findings/earth-2026-0141.json: go_deeper",
    ] },
  { name: "GO_DEEPER: a stored finding with four go_deeper ids", edit: (c) => c.editJson(F("chem-2026-0150"), (f) => { f.go_deeper = ["s1", "s2", "s3", "s3"]; }), expect: [
      "E GO_DEEPER findings/chem-2026-0150.json: go_deeper",
    ] },
  { name: "FIGURE_LICENCE: a licence quote that names another licence than the figure's, on a finding not being published", publishing: "2026-10-12", edit: (c) => c.editJson(F("hum-2026-0148"), (f) => { f.figure.licence_quote = "This figure is released under the terms of the CC0 public domain dedication."; }), expect: [
      "E FIGURE_LICENCE findings/hum-2026-0148.json: figure.licence_quote",
    ] },
  { name: "FIGURE_LICENCE: a figure host outside figure_hosts is judged only on a finding being published", publishing: "2026-10-14", edit: (c) => c.editJson(F("hum-2026-0148"), (f) => { f.figure.image_url = "https://images.example.org/ut-sample/scroll.png"; }), expect: [
      "E FIGURE_LICENCE findings/hum-2026-0148.json: figure.image_url",
    ] },
  { name: "FIGURE_LICENCE: the same figure host on a finding not being published passes", publishing: "2026-10-12", edit: (c) => c.editJson(F("hum-2026-0148"), (f) => { f.figure.image_url = "https://images.example.org/ut-sample/scroll.png"; }), expect: [] },
];


/** A made-up run of nucleotide letters (a repeated "ACGT"), long enough to be a sequence and meaning nothing. */
const RUN = "ACGT".repeat(5);
const EM_DASH = String.fromCharCode(0x2014);

const budgets = (over: { words_target?: number; words_max?: number }) => (base: LoadedConfig): LoadedConfig =>
  ({ ...base, run: { ...base.run, budgets: { ...base.run.budgets, ...over } } });

/** A made-up text of exactly `n` plain words, in sentences of twelve words or fewer. */
const plain = (n: number): string => {
  const unit = ["The", "week", "was", "calm", "and", "the", "labs", "kept", "working", "on", "their", "plans."];
  const out: string[] = [];
  while (out.length < n) out.push(unit[out.length % unit.length]!);
  return out.join(" ");
};

/** The safety codes: warnings on a record not being published (the archive downgrade), errors on one that is; SECRET_LIKE and CANARY are errors everywhere. */
const SAFETY_CASES: PubCase[] = [
  { name: "DUAL_USE: a nucleotide run in a stored brief's Lead is an error on the brief being published", publishing: "2026-10-14", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.lead[0].text.en = b.lead[0].text.en.replace("without opening it", RUN); }), expect: [
      "E DUAL_USE briefs/2026-10-14.json: lead[0].text.en",
    ] },
  { name: "DUAL_USE: the same run in the brief of another day is a warning", publishing: "2026-10-12", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.lead[0].text.en = b.lead[0].text.en.replace("without opening it", RUN); }), expect: [
      "W DUAL_USE briefs/2026-10-14.json: lead[0].text.en",
    ] },
  { name: "DUAL_USE: the same run with no edition being published is a warning", edit: (c) => c.editJson(B("2026-10-14"), (b) => { b.lead[0].text.en = b.lead[0].text.en.replace("without opening it", RUN); }), expect: [
      "W DUAL_USE briefs/2026-10-14.json: lead[0].text.en",
    ] },
  { name: "BLOCKED_HOST: a shortener in a finding's prose is an error on a finding being published", publishing: "2026-10-12", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.found.en += " Read more at https://tinyurl.com/ut-sample."; }), expect: [
      "E BLOCKED_HOST findings/earth-2026-0141.json: explainer.found.en",
    ] },
  { name: "BLOCKED_HOST: the same shortener in a finding published before is a warning", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.found.en += " Read more at https://tinyurl.com/ut-sample."; }), expect: [
      "W BLOCKED_HOST findings/earth-2026-0141.json: explainer.found.en",
    ] },
  { name: "BLOCKED_HOST: a shortener as a source address of a finding being published", publishing: "2026-10-12", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[0].url = "https://tinyurl.com/ut-sample-0012"; }), expect: [
      "E BLOCKED_HOST findings/earth-2026-0141.json: sources[0].url",
    ] },
  { name: "BLOCKED_HOST: an archive address as a source stays silent for BLOCKED_HOST (SOURCE_URL's)", publishing: "2026-10-12", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[0].url = "https://archive.org/details/ut-sample-0012"; }), expect: [
      "E SOURCE_URL findings/earth-2026-0141.json: sources[0].url",
    ] },
  { name: "SECRET_LIKE: a key-shaped string in a stored term's definition is an error on every record", edit: (c) => c.editJson("glossary.json", (g) => { g.terms[0].en.definition += ` ${sampleSecret()}`; }), expect: [
      "E SECRET_LIKE glossary.json: terms[0].en.definition",
    ] },
  { name: "CANARY: the canary in a stored report's reason is an error on every record", edit: (c) => c.editJson("reports.json", (g) => { g.reports[1].reason.en += ` ${CANARY_TOKEN}`; }), expect: [
      "E CANARY reports.json: reports[1].reason.en",
    ] },
  { name: "SECRET_LIKE: a key-shaped string in a stored finding, with a different edition being published", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.matters.en += ` ${sampleSecret()}`; }), expect: [
      "E SECRET_LIKE findings/earth-2026-0141.json: explainer.matters.en",
    ] },
];

/** ARTEFACT_FORMAT and QUOTE_VERBATIM read only the record; the evidence tests of the group run on a draft alone. */
const GROUNDING_CASES: PubCase[] = [
  { name: "ARTEFACT_FORMAT: a DOI written in capitals on a finding being published", publishing: "2026-10-14", edit: (c) => c.editJson(F("bio-2026-0149"), (f) => { f.artefacts.doi = ["10.1038/ABC.1"]; }), expect: [
      "E ARTEFACT_FORMAT findings/bio-2026-0149.json: artefacts.doi[0]",
    ] },
  { name: "ARTEFACT_FORMAT: the same DOI on a finding published before is still an error, never a warning", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.artefacts.doi = ["10.1038/ABC.1"]; }), expect: [
      "E ARTEFACT_FORMAT findings/earth-2026-0141.json: artefacts.doi[0]",
    ] },
  { name: "QUOTE_VERBATIM: a reaction quote of 26 words, on a finding not being published", publishing: "2026-10-12", edit: (c) => c.editJson(F("hum-2026-0148"), (f) => { f.reactions[0].quote = plain(26); }), expect: [
      "E QUOTE_VERBATIM findings/hum-2026-0148.json: reactions[0].quote",
    ] },
  { name: "grounding: an invented number and a quote no page holds raise nothing on a stored finding (the evidence tests are a draft's)", publishing: "2026-10-12", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.found.en = f.explainer.found.en.replace("about 12 per cent", "about 14 per cent"); f.ai.evidence[0].quote = "a quote that no page holds"; }), expect: [] },
];

/** The words rules: budgets and the judgements of one string on every record, hype words and page totals only on a record being published. */
const WORDS_CASES: PubCase[] = [
  { name: "WORDS: the big picture of an empty week at 120 words passes", edit: (c) => c.editJson(B("2026-10-12"), (b) => { b.review.big_picture.en = plain(120); }), expect: [] },
  { name: "WORDS: the big picture of an empty week at 121 words fails", edit: (c) => c.editJson(B("2026-10-12"), (b) => { b.review.big_picture.en = plain(121); }), expect: [
      "E WORDS briefs/2026-10-12.json: review.big_picture.en",
    ] },
  { name: "HYPE_WORDS: a hype word in a finding being published", publishing: "2026-10-14", edit: (c) => c.editJson(F("bio-2026-0149"), (f) => { f.explainer.found.en += " This result is groundbreaking."; }), expect: [
      "E HYPE_WORDS findings/bio-2026-0149.json: explainer.found.en",
    ] },
  { name: "HYPE_WORDS: the same hype word in a finding published before is not judged", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.matters.en += " This result is groundbreaking."; }), expect: [] },
  { name: "NO_EM_DASH: an em dash in a finding not being published is an error all the same", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.matters.en += ` The result${EM_DASH}in short${EM_DASH}holds.`; }), expect: [
      "E NO_EM_DASH findings/earth-2026-0141.json: explainer.matters.en",
    ] },
  { name: "TERM_DEFINED: a listed term the explainer never uses fails on a record not being published (and the Chinese text then owes the English term, ZH_ENGLISH_ONCE)", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.terms.push("proof-assistant"); }), expect: [
      "E TERM_DEFINED findings/earth-2026-0141.json: terms[1]",
      "E ZH_ENGLISH_ONCE findings/earth-2026-0141.json: explainer.found.zh",
    ] },
  { name: "WORDS: a page total over words_target is a warning on the brief being published", publishing: "2026-10-14", config: budgets({ words_target: 200 }), edit: NO_EDIT, expect: [
      "W WORDS briefs/2026-10-14.json: (root)",
    ] },
  { name: "WORDS: a page total over words_max is an error on the brief being published (the Chinese size limit follows words_max, ZH_CHARS)", publishing: "2026-10-14", config: budgets({ words_target: 100, words_max: 200 }), edit: NO_EDIT, expect: [
      "E WORDS briefs/2026-10-14.json: (root)",
      "E ZH_CHARS briefs/2026-10-14.json: computed.zh_chars",
    ] },
  { name: "WORDS: the same totals with no edition being published are not judged", config: budgets({ words_target: 100, words_max: 200 }), edit: NO_EDIT, expect: [] },
];

/** Removed text (SPEC 4.12 "Removed text", F-43): a string a stored `removed` correction rewrote is skipped by every rule, only while it is REMOVED_TEXT. */
const removal = (over: Record<string, unknown>): Record<string, unknown> => correction({
  id: "C-0003", date: "2026-10-14", finding_id: "earth-2026-0141", type: "removed", path: "explainer.could_lead",
  before: { en: "[removed text]", zh: "〔已移除的文字〕" }, after: { ...REMOVED_TEXT }, reason: { en: "A made-up reason.", zh: "虛構的原因。" }, ...over,
});

const REMOVED_CASES: PubCase[] = [
  {
    name: "removed text: a part holding REMOVED_TEXT under its removal correction is skipped by every rule",
    edit: (c) => {
      c.editJson(F("earth-2026-0141"), (f) => { f.explainer.could_lead = { ...REMOVED_TEXT }; });
      c.editJson("corrections.json", (g) => { g.corrections.push(removal({})); });
    },
    expect: [],
  },
  {
    name: "removed text: the same REMOVED_TEXT with no removal correction is judged as any text (too short, no word of possibility)",
    edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.could_lead = { ...REMOVED_TEXT }; }),
    expect: [
      "E POSSIBILITY findings/earth-2026-0141.json: explainer.could_lead.en",
      "E WORDS findings/earth-2026-0141.json: explainer",
    ],
  },
  {
    name: "removed text: a removal whose path still holds other text is an XREF issue, and the text is judged as usual",
    edit: (c) => c.editJson("corrections.json", (g) => { g.corrections.push(removal({})); }),
    expect: [
      "E XREF corrections.json: corrections[2].path",
    ],
  },
  {
    name: "removed text: a removal whose path holds no value is an XREF issue",
    edit: (c) => c.editJson("corrections.json", (g) => { g.corrections.push(removal({ path: "figure.alt" })); }),
    expect: [
      "E XREF corrections.json: corrections[2].path",
    ],
  },
  {
    name: "removed text: a string that a removal rewrote is not read, and its sibling string still is (DUAL_USE)",
    publishing: "2026-10-12",
    edit: (c) => {
      c.editJson(F("earth-2026-0141"), (f) => { f.explainer.could_lead = { ...REMOVED_TEXT }; f.explainer.matters.en += ` ${RUN}`; });
      c.editJson("corrections.json", (g) => { g.corrections.push(removal({ date: "2026-10-12" })); });
    },
    expect: [
      "E DUAL_USE findings/earth-2026-0141.json: explainer.matters.en",
    ],
  },
];

/** Findings that a later edition only touches (F-55) and seeds (F-75): the frozen text is archived, only what an edition wrote is judged as being published. */
const RETURNING_CASES: PubCase[] = [
  { name: "returning finding: a hype word in the frozen text of a finding that a correction of the day touched is not judged", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.matters.en += " This result is groundbreaking."; }), expect: [] },
  { name: "returning finding: a nucleotide run in the frozen text is an archive warning, not an error", publishing: "2026-10-14", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.explainer.matters.en += ` ${RUN}`; }), expect: [
      "W DUAL_USE findings/earth-2026-0141.json: explainer.matters.en",
    ] },
  {
    name: "returning finding: a hype word in the text the day's correction wrote is judged as being published",
    publishing: "2026-10-14",
    edit: (c) => {
      c.editJson("corrections.json", (g) => { g.corrections[1].after.en += " This result is groundbreaking."; });
      c.editJson(F("earth-2026-0141"), (f) => { f.explainer.how_sure.en += " This result is groundbreaking."; });
    },
    expect: [
      "E HYPE_WORDS corrections.json: corrections[1].after.en",
    ],
  },
  { name: "seed: a hype word in a seed's text is never judged whole", publishing: "2026-10-14", edit: (c) => c.editJson(F("math-2026-0131"), (f) => { f.explainer.found.en += " This result is groundbreaking."; }), expect: [] },
  { name: "seed: a bad subfield in a seed is not judged in published mode", publishing: "2026-10-14", edit: (c) => c.editJson(F("math-2026-0131"), (f) => { f.subfield = "protein"; }), expect: [] },
  { name: "seed: a nucleotide run in a seed's text is an archive warning", publishing: "2026-10-14", edit: (c) => c.editJson(F("math-2026-0131"), (f) => { f.explainer.found.en += ` ${RUN}`; }), expect: [
      "W DUAL_USE findings/math-2026-0131.json: explainer.found.en",
    ] },
];

/** Which stored records an edition is publishing (SPEC 4.12 "Stored records"): the terms first used on its date, the corrections dated on it, the reports decided on it and the text it recorded in a returning finding. */
const RECORD_SET_CASES: PubCase[] = [
  { name: "record set: a term first used on the publishing date is judged as being published", publishing: "2026-10-14", edit: (c) => c.editJson("glossary.json", (g) => { g.terms[1].en.definition += ` ${RUN}`; }), expect: [
      "E DUAL_USE glossary.json: terms[1].en.definition",
    ] },
  { name: "record set: the same term on another publishing date is an archived record", publishing: "2026-10-12", edit: (c) => c.editJson("glossary.json", (g) => { g.terms[1].en.definition += ` ${RUN}`; }), expect: [
      "W DUAL_USE glossary.json: terms[1].en.definition",
    ] },
  { name: "record set: a correction dated on the publishing date is judged as being published", publishing: "2026-10-14", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[1].after.en += ` ${RUN}`; }), expect: [
      "E DUAL_USE corrections.json: corrections[1].after.en",
    ] },
  { name: "record set: the same correction on another publishing date is an archived record", publishing: "2026-10-13", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[1].after.en += ` ${RUN}`; }), expect: [
      "W DUAL_USE corrections.json: corrections[1].after.en",
    ] },
  { name: "record set: a report decided on the publishing date is judged as being published", publishing: "2026-10-14", edit: (c) => c.editJson("reports.json", (g) => { g.reports[1].reason.en += ` ${RUN}`; }), expect: [
      "E DUAL_USE reports.json: reports[1].reason.en",
    ] },
  { name: "record set: the same report on another publishing date is an archived record", publishing: "2026-10-13", edit: (c) => c.editJson("reports.json", (g) => { g.reports[1].reason.en += ` ${RUN}`; }), expect: [
      "W DUAL_USE reports.json: reports[1].reason.en",
    ] },
  { name: "record set: a rung note a returning finding recorded on the publishing date is judged as being published", publishing: "2026-10-14", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => { f.rung_history[1].note.en += ` ${RUN}`; }), expect: [
      "E DUAL_USE findings/chem-2026-0142.json: rung_history[1].note.en",
    ] },
  { name: "record set: the frozen text of the same returning finding is an archived record", publishing: "2026-10-14", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => { f.explainer.matters.en += ` ${RUN}`; }), expect: [
      "W DUAL_USE findings/chem-2026-0142.json: explainer.matters.en",
    ] },
  { name: "record set: a seed first briefed on the publishing date is not judged whole, only the since_then note the edition wrote", publishing: "2026-10-14", edit: (c) => c.editJson(F("soc-2026-0145"), (f) => { f.since_then[0].text.en += ` ${RUN}`; f.explainer.matters.en += ` ${RUN}`; }), expect: [
      "E DUAL_USE findings/soc-2026-0145.json: since_then[0].text.en",
      "W DUAL_USE findings/soc-2026-0145.json: explainer.matters.en",
    ] },
];


/** More stored-record cases of the ladder, sources and grounding groups, each judged on every stored record. */
const MORE_CASES: PubCase[] = [
  { name: "GO_DEEPER: a notice among the go_deeper ids of a result (RUNG_EVIDENCE also reads the rung entries that cite it)", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.sources[0].kind = "notice"; }), expect: [
      "E GO_DEEPER findings/earth-2026-0141.json: go_deeper[0]",
      "E RUNG_EVIDENCE findings/earth-2026-0141.json: rung_history[0].source_id",
    ] },
  { name: "GO_DEEPER: a notice among the go_deeper ids of a setback passes", edit: (c) => c.editJson(F("chem-2026-0150"), (f) => { f.go_deeper = ["s2", "s3"]; }), expect: [] },
  {
    name: "NON_AI_LANDMARK_ONLY: a stored finding below Landmark with no AI role",
    edit: (c) => c.editJson(F("chem-2026-0150"), (f) => { f.ai = { role: "none", confidence: null, systems: [], evidence: [] }; f.explainer.ai_helped = null; }),
    expect: [
      "E NON_AI_LANDMARK_ONLY findings/chem-2026-0150.json: ai.role",
      "E SETBACK_MAJOR findings/chem-2026-0150.json: ai.role",
      "E WORDS findings/chem-2026-0150.json: explainer",
    ],
  },
  { name: "ARTEFACT_FORMAT: the removed-text string is judged as any text when no removal correction names it", edit: (c) => c.editJson(F("earth-2026-0141"), (f) => { f.artefacts.doi = ["This text was removed."]; }), expect: [
      "E ARTEFACT_FORMAT findings/earth-2026-0141.json: artefacts.doi[0]",
    ] },
];


// ── The stored-record cases, second pass (the independent review) ───────────────────────────────

/** Adds a stored `removed` correction (`removal()`'s defaults: the earth finding's `explainer.could_lead`, dated 2026-10-14) with the fields a case changes. */
const withRemoval = (over: Record<string, unknown>): Edit => (c) => c.editJson("corrections.json", (g) => { g.corrections.push(removal(over)); });
/** Runs each edit on the copy in turn. */
const all = (...edits: Edit[]): Edit => (c) => { for (const edit of edits) edit(c); };
/** A removal on an edition's brief-level text (SPEC 4.10: `edition_date` names the brief, `finding_id` is null). */
const brief = (date: string, path: string): Record<string, unknown> => ({ finding_id: null, edition_date: date, date, path });
const setPart = (id: string, part: string, value: unknown): Edit => (c) => c.editJson(F(id), (f) => { f.explainer[part] = value; });
const EARTH = F("earth-2026-0141");

/** A glossary term of no finding, placed where its id sorts (between `proof-assistant` and `virtual-unwrapping`): the Chinese form `zh` or null, and its English definition. */
const seedTerm = (definition: string, zh: Record<string, unknown> | null): Edit => (c) => c.editJson("glossary.json", (g) => {
  g.terms.splice(6, 0, { id: "seed-term", en: { term: "seed term", definition }, zh, fields: ["mathematics"], first_finding: "math-2026-0131", first_date: "2026-10-09" });
});
const termRemoval = withRemoval({ finding_id: null, term_id: "seed-term", path: "definition", date: "2026-10-09" });
const zhTerm = (definition: string) => ({ term: "種子詞", definition, official: null, official_url: null });

/**
 * Removed text, every kind of string (SPEC 4.12 "Removed text"): each rule skips a string a stored `removed` correction rewrote, only
 * while the string IS the marker; a part, a brief-level text, a plain string and a term's definition each have a case that passes with the
 * correction and, where a rule can tell, one that fails without it. The lower bounds of the budgets are dropped for a removed part only.
 */
const REMOVED_MORE_CASES: PubCase[] = [
  // The spec's passing and failing fixtures: a stored finding whose how_sure a removal rewrote, and the finding with the correction left out.
  { name: "removed text: a how_sure that a removal rewrote is skipped (WHO_SAYS)", edit: all(setPart("earth-2026-0141", "how_sure", { ...REMOVED_TEXT }), withRemoval({ path: "explainer.how_sure" })), expect: [] },
  { name: "removed text: the same finding with the removal left out fails WHO_SAYS (and the story's lower bound, which only a removal drops)", edit: setPart("earth-2026-0141", "how_sure", { ...REMOVED_TEXT }), expect: [
      "E WHO_SAYS findings/earth-2026-0141.json: explainer.how_sure.en",
      "E WORDS findings/earth-2026-0141.json: explainer",
    ] },
  { name: "removed text: an ai_helped that a removal rewrote is skipped (AI_SYSTEM_NAMED)", edit: all(setPart("earth-2026-0141", "ai_helped", { ...REMOVED_TEXT }), withRemoval({ path: "explainer.ai_helped" })), expect: [] },
  { name: "removed text: the same ai_helped with the removal left out fails AI_SYSTEM_NAMED", edit: setPart("earth-2026-0141", "ai_helped", { ...REMOVED_TEXT }), expect: [
      "E AI_SYSTEM_NAMED findings/earth-2026-0141.json: explainer.ai_helped.en",
      "E WORDS findings/earth-2026-0141.json: explainer",
    ] },
  { name: "removed text: a could_lead that holds other text is judged though a removal names it (F-43: only the marker is skipped), and the removal is an XREF issue", edit: all(setPart("earth-2026-0141", "could_lead", {
      en: "Forecasters trust longer forecasts and warn people earlier when the gain holds in other seasons and other places. Outside teams test the model next.",
      zh: "預報員信任更長期的預報，並更早發出警示，接下來外部團隊便測試這個模型。",
    }), withRemoval({})), expect: [
      "E POSSIBILITY findings/earth-2026-0141.json: explainer.could_lead.en",
      "E XREF corrections.json: corrections[2].path",
    ] },

  // The spec's other passing fixture: a brief whose deep_dive.text a removal rewrote.
  { name: "removed text: a deep dive that a removal rewrote passes, the deep dive's lower bound dropped", edit: all(
      (c) => c.editJson(B("2026-10-18"), (b) => { b.deep_dive.text = { ...REMOVED_TEXT }; }), withRemoval(brief("2026-10-18", "deep_dive.text"))), expect: [] },
  { name: "removed text: the same deep dive with the removal left out fails WORDS' lower bound", edit: (c) => c.editJson(B("2026-10-18"), (b) => { b.deep_dive.text = { ...REMOVED_TEXT }; }), expect: [
      "E WORDS briefs/2026-10-18.json: deep_dive.text.en",
    ] },
  { name: "removed text: a brief's removal whose text is still there is an XREF issue", edit: withRemoval(brief("2026-10-18", "deep_dive.text")), expect: [
      "E XREF corrections.json: corrections[2].path",
    ] },
  { name: "removed text: a Lead line that a removal rewrote passes", edit: all(
      (c) => c.editJson(B("2026-10-14"), (b) => { b.lead[0].text = { ...REMOVED_TEXT }; }), withRemoval(brief("2026-10-14", "lead.0.text"))), expect: [] },
  { name: "removed text: a removal that names another Lead line than the one holding the marker is an XREF issue", edit: all(
      (c) => c.editJson(B("2026-10-14"), (b) => { b.lead[0].text = { ...REMOVED_TEXT }; }), withRemoval(brief("2026-10-14", "lead.1.text"))), expect: [
      "E XREF corrections.json: corrections[2].path",
    ] },

  // A plain string is its English: a source's address and an evidence quote.
  { name: "removed text: a source address that a removal rewrote is skipped (a plain string is its English)", edit: all(
      (c) => c.editJson(EARTH, (f) => { f.sources[1].url = REMOVED_TEXT.en; }), withRemoval({ path: "sources.1.url" })), expect: [] },
  { name: "removed text: the same address with the removal left out is judged as any address (SOURCE_URL, a warning on a record not being published)", edit: (c) => c.editJson(EARTH, (f) => { f.sources[1].url = REMOVED_TEXT.en; }), expect: [
      "W SOURCE_URL findings/earth-2026-0141.json: sources[1].url",
    ] },
  { name: "removed text: the same address on a finding being published is an error", publishing: "2026-10-12", edit: (c) => c.editJson(EARTH, (f) => { f.sources[1].url = REMOVED_TEXT.en; }), expect: [
      "E SOURCE_URL findings/earth-2026-0141.json: sources[1].url",
    ] },
  { name: "removed text: an evidence quote that a removal rewrote passes", edit: all(
      (c) => c.editJson(EARTH, (f) => { f.ai.evidence[0].quote = REMOVED_TEXT.en; }), withRemoval({ path: "ai.evidence.0.quote" })), expect: [] },
  { name: "removed text: a removal whose evidence quote is still other text is an XREF issue", edit: all(
      (c) => c.editJson(EARTH, (f) => { f.ai.evidence[0].quote = "a quote that no page holds"; }), withRemoval({ path: "ai.evidence.0.quote" })), expect: [
      "E XREF corrections.json: corrections[2].path",
    ] },

  // A term's definition: in English while its zh is null, in both languages otherwise.
  { name: "removed text: a definition that a removal rewrote passes, in English while the term's zh is null", edit: all(seedTerm(REMOVED_TEXT.en, null), termRemoval), expect: [] },
  { name: "removed text: a term whose zh is null and whose definition is other text is an XREF issue", edit: all(seedTerm("A made-up definition.", null), termRemoval), expect: [
      "E XREF corrections.json: corrections[2].path",
    ] },
  { name: "removed text: a definition removed in both languages passes", edit: all(seedTerm(REMOVED_TEXT.en, zhTerm(REMOVED_TEXT.zh)), termRemoval), expect: [] },
  { name: "removed text: a definition removed in English only, with a Chinese one, is an XREF issue", edit: all(seedTerm(REMOVED_TEXT.en, zhTerm("虛構的定義。")), termRemoval), expect: [
      "E XREF corrections.json: corrections[2].path",
    ] },

  // The lower bounds of the budgets and the terms that no longer need to appear, for a part that a removal rewrote.
  { name: "removed text: a story part that a removal rewrote drops the story's lower bound (230) and the first Chinese use's brackets", edit: all(
      setPart("hum-2026-0148", "found", { ...REMOVED_TEXT }), withRemoval({ finding_id: "hum-2026-0148", path: "explainer.found" })), expect: [] },
  { name: "removed text: the same part as other short text fails the lower bound and the English term in brackets (ZH_ENGLISH_ONCE)", edit: setPart("hum-2026-0148", "found", { en: "A short text.", zh: "簡短的文字。" }), expect: [
      "E WORDS findings/hum-2026-0148.json: explainer",
      "E ZH_ENGLISH_ONCE findings/hum-2026-0148.json: explainer.background.zh",
    ] },
  { name: "removed text: an item's part that a removal rewrote drops the lower bound of the first four parts (70)", edit: all(
      setPart("bio-2026-0149", "found", { ...REMOVED_TEXT }), withRemoval({ finding_id: "bio-2026-0149", path: "explainer.found" })), expect: [] },
  { name: "removed text: the same part as other short text fails the lower bound of the first four parts", edit: setPart("bio-2026-0149", "found", { en: "A short text.", zh: "簡短的文字。" }), expect: [
      "E WORDS findings/bio-2026-0149.json: explainer",
    ] },
  { name: "removed text: the only part that uses a listed term, rewritten by a removal, no longer needs the term to appear (TERM_DEFINED, ZH_ENGLISH_ONCE)", edit: all(
      setPart("earth-2026-0141", "found", { ...REMOVED_TEXT }), withRemoval({ path: "explainer.found" })), expect: [] },
  { name: "removed text: the same part as other text without the term fails TERM_DEFINED and ZH_ENGLISH_ONCE", edit: setPart("earth-2026-0141", "found", { en: "A short text.", zh: "簡短的文字。" }), expect: [
      "E TERM_DEFINED findings/earth-2026-0141.json: terms[0]",
      "E WORDS findings/earth-2026-0141.json: explainer",
      "E ZH_ENGLISH_ONCE findings/earth-2026-0141.json: explainer.found.zh",
    ] },
];

// ── Config and the list a stored record was published under ──

/** The config with the Nobel Prize's checker entry taken out (a list that changed after a rung was filed on it). */
const noNobel = (base: LoadedConfig): LoadedConfig =>
  ({ ...base, checkers: { ...base.checkers, checkers: base.checkers.checkers.filter((entry) => entry.id !== "nobel-prize") } });
/** The earth finding's first source, as a checker's page: the entry that RUNG_EVIDENCE reads against `checkers.json`. */
const asChecker: Edit = (c) => c.editJson(EARTH, (f) => {
  Object.assign(f.sources[0], { kind: "checker", url: "https://www.nobelprize.org/prizes/ut-sample/earth/", publisher: "Nobel Prize", doi: null });
});
/** A Chinese phrase of the earth finding's `matters` replaced by one of its own length or less, so only the rule under test is tripped. */
const swapZh = (from: string, to: string): Edit => (c) => c.editJson(EARTH, (f) => {
  if (!f.explainer.matters.zh.includes(from)) throw new Error(`the phrase ${from} is not in the sample`);
  f.explainer.matters.zh = f.explainer.matters.zh.replace(from, to);
});
const JARGON: Edit = (c) => c.editJson(EARTH, (f) => { f.explainer.matters.en = f.explainer.matters.en.replace("Weather agencies", "A transformer helps. Weather agencies"); });
/** The retraction finding's explainer in heavy words, grade over 14 and no fixed Chinese term in it (as the words group's own fixture has it). */
const HEAVY: Edit = (c) => c.editJson(F("chem-2026-0150"), (f) => {
  f.explainer.found.en = "Example Press formally retracted numerous publications across nine journals because undisclosed generated content had produced their illustrations.";
  f.explainer.matters.en = "Researchers throughout the discipline may already have cited these publications, so the consequences could propagate considerably beyond the affected journals.";
  f.explainer.ai_helped.en = "Unidentified systems produced the text and illustrations, and the publisher's notices deliberately decline to identify the particular tool involved.";
  f.explainer.background.en = "A retraction notice informs readers that a publication should no longer be considered reliable evidence.";
  f.explainer.could_lead.en = "Publishers could systematically examine submissions for undisclosed generated content before accepting publication.";
});

/** One Chinese rule that reads `config/`: a phrase it rejects, the finding being published (2026-10-12) and the same finding published before (2026-10-14). */
const ZH_GATES: readonly { code: string; edit: Edit }[] = [
  { code: "ZH_AVOID", edit: swapZh("準確度小幅提升", "算法小幅提升") },
  { code: "ZH_TRADITIONAL", edit: swapZh("準確度小幅提升", "准确度小幅提升") },
  { code: "ZH_HYPE", edit: swapZh("準確度小幅提升", "驚人的小幅提升") },
  { code: "ZH_TERMS", edit: (c) => c.editJson(EARTH, (f) => { f.explainer.matters.en += " The algorithm matters."; }) },
];

/**
 * The tests that read `config/` or a `run.json` budget run on the records being published alone (SPEC 4.12 "Stored records"): the same
 * defect on a record published before is not judged, and a correction's `before` is read by none of them. The fixed limits are not here:
 * they run on every record.
 */
const CONFIG_GATE_CASES: PubCase[] = [
  { name: "RUNG_EVIDENCE: a rung entry that cites a checker the list names passes on a finding being published", publishing: "2026-10-12", edit: asChecker, expect: [] },
  { name: "RUNG_EVIDENCE: the same entry fails once the list lacks the checker, on a finding being published", publishing: "2026-10-12", config: noNobel, edit: asChecker, expect: [
      "E PRIMARY_ONLY findings/earth-2026-0141.json: sources[0].url",
      "E RUNG_EVIDENCE findings/earth-2026-0141.json: rung_history[0].source_id",
    ] },
  { name: "RUNG_EVIDENCE: the same finding published before takes the list as met", publishing: "2026-10-14", config: noNobel, edit: asChecker, expect: [] },
  { name: "RUNG_EVIDENCE: the same finding with no edition being published takes the list as met", config: noNobel, edit: asChecker, expect: [] },
  { name: "TERM_DEFINED: a jargon word that is no listed term fails on a finding being published", publishing: "2026-10-12", edit: JARGON, expect: [
      "E TERM_DEFINED findings/earth-2026-0141.json: explainer.matters.en",
    ] },
  { name: "TERM_DEFINED: the same jargon word on a finding published before is not judged", publishing: "2026-10-14", edit: JARGON, expect: [] },
  { name: "TERM_DEFINED: the same jargon word with no edition being published is not judged", edit: JARGON, expect: [] },
  { name: "READING_LEVEL: an explainer above the hard grade fails on a finding being published", publishing: "2026-10-14", edit: HEAVY, expect: [
      "E READING_LEVEL findings/chem-2026-0150.json: explainer",
    ] },
  { name: "READING_LEVEL: the same explainer on a finding published before is not graded", publishing: "2026-10-12", edit: HEAVY, expect: [] },
  { name: "READING_LEVEL: the same explainer with no edition being published is not graded", edit: HEAVY, expect: [] },
  ...ZH_GATES.flatMap(({ code, edit }): PubCase[] => [
    { name: `${code}: a Chinese phrase the list rejects fails on a finding being published`, publishing: "2026-10-12", edit, expect: [`E ${code} findings/earth-2026-0141.json: explainer.matters.zh`] },
    { name: `${code}: the same phrase on a finding published before is not judged`, publishing: "2026-10-14", edit, expect: [] },
    { name: `${code}: the same phrase with no edition being published is not judged`, edit, expect: [] },
  ]),
  { name: "ZH_NO_DASH: a Chinese dash fails on every record, a finding published before included (a fixed limit, no list)", publishing: "2026-10-14", edit: swapZh("準確度小幅提升", `準確度${EM_DASH}${EM_DASH}小幅提升`), expect: [
      "E ZH_NO_DASH findings/earth-2026-0141.json: explainer.matters.zh",
    ] },
  {
    name: "a correction's before is read by no test that reads config/ (HYPE_WORDS, ZH_AVOID, ZH_HYPE, ZH_TRADITIONAL), a correction being published included",
    publishing: "2026-10-14",
    edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[0].before.en += " This groundbreaking text is old."; g.corrections[0].before.zh += "这个算法是重大突破。"; }),
    expect: [],
  },
  { name: "a correction's before is read by the safety codes, which read the lists everywhere: a nucleotide run in it is an error on a correction being published", publishing: "2026-10-14",
    edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[0].before.en += ` ${RUN}`; }), expect: [
      "E DUAL_USE corrections.json: corrections[0].before.en",
    ] },
];

/** A stored finding's rung changes after publication (SPEC 4.12 "Stored records"): the checks that read its history read every entry of it, and RUNG_ORDER's D is `updated`. */
const RUNG_STORED_CASES: PubCase[] = [
  { name: "WHO_SAYS: a how_sure that starts with the label of an earlier rung of the history passes (a record whose rung moved on)", edit: (c) => c.editJson(EARTH, (f) => {
      f.explainer.how_sure.en = f.explainer.how_sure.en.replace("Applied.", "Checked.");
      f.explainer.how_sure.zh = f.explainer.how_sure.zh.replace("已應用", "已查核");
    }), expect: [] },
  { name: "WHO_SAYS: a how_sure that starts with a label no entry of the history has fails", edit: (c) => c.editJson(EARTH, (f) => {
      f.explainer.how_sure.en = f.explainer.how_sure.en.replace("Applied.", "Confirmed.");
      f.explainer.how_sure.zh = f.explainer.how_sure.zh.replace("已應用", "已證實");
    }), expect: [
      "E WHO_SAYS findings/earth-2026-0141.json: explainer.how_sure.en",
    ] },
  { name: "LANDMARK_BASIS: a Landmark with no reaction whose history holds a Confirmed entry passes though its rung has since moved to Disputed", edit: (c) => c.editJson(F("bio-2026-0149"), (f) => {
      f.significance = "landmark";
      f.rung = "disputed";
      f.rung_history.push({ rung: "disputed", date: "2026-10-14", recorded: "2026-10-14", source_id: "s2", by: "agent", note: { en: "A made-up note.", zh: "虛構的註記。" } });
    }), expect: [] },
  { name: "LANDMARK_BASIS: the same Landmark whose history has no Confirmed or Applied entry fails (and its how_sure, which starts with Confirmed, has no such rung to name)", edit: (c) => c.editJson(F("bio-2026-0149"), (f) => {
      f.significance = "landmark";
      f.rung = "disputed";
      f.rung_history[1].rung = "disputed";
    }), expect: [
      "E LANDMARK_BASIS findings/bio-2026-0149.json: significance",
      "E WHO_SAYS findings/bio-2026-0149.json: explainer.how_sure.en",
    ] },
  { name: "CLAIMED_CAP: a Major finding at Preprint whose history holds a Checked entry passes (any entry but Claimed or Preprint)", edit: (c) => c.editJson(F("math-2026-0151"), (f) => {
      f.significance = "major";
      f.rung_history.unshift({ rung: "checked", date: "2026-10-12", recorded: "2026-10-14", source_id: "s2", by: "agent", note: null });
    }), expect: [] },
  { name: "CLAIMED_CAP: the same finding whose history is Preprint alone fails", edit: (c) => c.editJson(F("math-2026-0151"), (f) => { f.significance = "major"; }), expect: [
      "E CLAIMED_CAP findings/math-2026-0151.json: significance",
    ] },
  { name: "RUNG_ORDER: an entry dated after the finding's updated fails (D is `updated` on a stored finding)", edit: (c) => c.editJson(F("math-2026-0151"), (f) => { f.rung_history[0].date = "2026-10-15"; }), expect: [
      "E RUNG_ORDER findings/math-2026-0151.json: rung_history[0].date",
    ] },
  { name: "RUNG_ORDER: an entry dated on the finding's updated passes", edit: (c) => c.editJson(F("math-2026-0151"), (f) => { f.rung_history[0].date = "2026-10-14"; }), expect: [] },
];

/** The safety codes on stored records, second pass: numbered steps by the field as filed, the term hidden for its own name, and the URL fields. */
const STEPS = "The steps are: 1. Load the log. 2. Read the tracks. 3. Compare the shapes.";
const stepsInPhysics: Edit = (c) => c.editJson(F("phys-2026-0147"), (f) => { f.explainer.background.en = STEPS; });
const refiledAsBiology = (date: string): Edit => push(
  refile("C-0003", "phys-2026-0147", date, "field", "physics", "biology"), refile("C-0004", "phys-2026-0147", date, "subfield", "plasma-fusion", "genomics"));
/** The plasma term renamed to `name` in the glossary and in the one explainer part that uses it, with no Chinese: a term whose own name the safety lists reject. */
const termNamed = (name: string): Edit => all(
  (c) => c.editJson("glossary.json", (g) => { const t = g.terms.find((x: { id: string }) => x.id === "plasma"); t.en.term = name; t.zh = null; }),
  (c) => c.editJson(F("phys-2026-0147"), (f) => { f.explainer.found.en = f.explainer.found.en.replace(/plasma/gi, name); }),
);

const SAFETY_MORE_CASES: PubCase[] = [
  { name: "DUAL_USE: numbered steps in a physics finding pass", publishing: "2026-10-12", edit: stepsInPhysics, expect: [] },
  { name: "DUAL_USE: the same steps fail once a stored correction refiles the finding as biology, on a finding being published", publishing: "2026-10-12", edit: all(stepsInPhysics, refiledAsBiology("2026-10-12")), expect: [
      "E DUAL_USE findings/phys-2026-0147.json: explainer.background.en",
    ] },
  { name: "DUAL_USE: the same refiled finding is an archived record, a warning, when another edition is being published (the field as filed on the date of the check)", publishing: "2026-10-14", edit: all(stepsInPhysics, refiledAsBiology("2026-10-13")), expect: [
      "W DUAL_USE findings/phys-2026-0147.json: explainer.background.en",
    ] },
  { name: "LANG_PARITY: a term whose own name fails DUAL_USE is hidden and owes no Chinese (SPEC 8.9); the control has a harmless name", edit: termNamed(RUN), expect: [
      "W DUAL_USE findings/phys-2026-0147.json: explainer.found.en",
      "W DUAL_USE glossary.json: terms[4].en.term",
    ] },
  { name: "LANG_PARITY: a term whose own name is a blocked host is hidden too, on a finding being published an error", publishing: "2026-10-12", edit: termNamed("tinyurl.com/ut-sample"), expect: [
      "E BLOCKED_HOST findings/phys-2026-0147.json: explainer.found.en",
      "E BLOCKED_HOST glossary.json: terms[4].en.term",
    ] },
  { name: "LANG_PARITY: the same term with a harmless name and no Chinese is not hidden", edit: (c) => c.editJson("glossary.json", (g) => { g.terms.find((t: { id: string }) => t.id === "plasma").zh = null; }), expect: [
      "E LANG_PARITY glossary.json: terms[4].zh",
    ] },
  { name: "BLOCKED_HOST: a shortener in a correction's source_url is an error on a correction being published", publishing: "2026-10-14", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[1].source_url = "https://tinyurl.com/ut-sample"; }), expect: [
      "E BLOCKED_HOST corrections.json: corrections[1].source_url",
    ] },
  { name: "BLOCKED_HOST: the same source_url on a correction published before is a warning", publishing: "2026-10-12", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[1].source_url = "https://tinyurl.com/ut-sample"; }), expect: [
      "W BLOCKED_HOST corrections.json: corrections[1].source_url",
    ] },
  { name: "BLOCKED_HOST: a shortener as a figure's image_url on a finding being published is an error", publishing: "2026-10-14", edit: (c) => c.editJson(F("hum-2026-0148"), (f) => { f.figure.image_url = "https://tinyurl.com/ut-sample.png"; }), expect: [
      "E BLOCKED_HOST findings/hum-2026-0148.json: figure.image_url",
    ] },
];

/** Returning findings (F-55): the entries an edition wrote are judged as being published, the frozen rest of the finding is not. */
const RETURNING_MORE_CASES: PubCase[] = [
  { name: "returning finding: a hype word in the rung note the edition recorded is an error", publishing: "2026-10-14", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => { f.rung_history[1].note.en += " This is groundbreaking work."; }), expect: [
      "E HYPE_WORDS findings/chem-2026-0142.json: rung_history[1].note.en",
    ] },
  { name: "returning finding: the same word in an older rung note is not judged", publishing: "2026-10-14", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => { f.rung_history[0].note = { en: "A made-up note, groundbreaking in tone.", zh: "虛構的註記。" }; }), expect: [] },
  { name: "returning finding: a press host in the source the edition added is an error", publishing: "2026-10-14", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => { f.sources[1].url = "https://www.nytimes.com/2026/10/10/science/ut-sample.html"; }), expect: [
      "E PRIMARY_ONLY findings/chem-2026-0142.json: sources[1].url",
    ] },
  { name: "returning finding: the same host in an older source is not judged", publishing: "2026-10-14", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => { f.sources[0].url = "https://www.nytimes.com/2026/10/10/science/ut-sample.html"; }), expect: [] },
  { name: "returning finding: a hype word in the since_then note the edition wrote is an error", publishing: "2026-10-14", edit: (c) => c.editJson(F("soc-2026-0145"), (f) => { f.since_then[0].text.en += " This is groundbreaking."; }), expect: [
      "E HYPE_WORDS findings/soc-2026-0145.json: since_then[0].text.en",
    ] },
];

/** Rules that read the run's inputs or the whole history are silent on stored records, and what a Chinese string owes is as the spec lists it, no more. */
const IGNORED_CASES: PubCase[] = [
  { name: "DUPLICATE is a draft's: two stored findings that share a DOI raise nothing", edit: (c) => {
      for (const id of ["math-2026-0140", "math-2026-0151"]) c.editJson(F(id), (f) => { f.artefacts.doi = ["10.1038/ut-sample.1"]; });
    }, expect: [] },
  { name: "DUPLICATE is a draft's: two stored findings that share a title raise nothing", edit: (c) => { const title = c.read(F("math-2026-0140")).title; c.editJson(F("math-2026-0151"), (f) => { f.title = title; }); }, expect: [] },
  { name: "REPORT_DECISION and REPORT_UPHELD are a draft's: an upheld stored report that names no correction raises nothing", edit: (c) => c.editJson("reports.json", (g) => { g.reports[0].correction_id = null; }), expect: [] },
  { name: "LANG_PARITY: a correction's before and reason owe no Chinese (only its after does)", edit: (c) => c.editJson("corrections.json", (g) => { g.corrections[0].before.zh = null; g.corrections[0].reason.zh = null; }), expect: [] },
  { name: "LANG_PARITY: a returning finding's since_then note owes no Chinese", edit: (c) => c.editJson(F("soc-2026-0145"), (f) => { f.since_then[0].text.zh = null; }), expect: [] },
  { name: "LANG_PARITY: the explainer of a finding that an English-only edition first published owes no Chinese, though a later bilingual brief names it", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => {
      for (const part of Object.keys(f.explainer)) if (f.explainer[part] !== null) f.explainer[part].zh = null;
    }), expect: [] },
  { name: "LANG_PARITY: a rung note recorded on an English-only edition's date owes no Chinese", edit: (c) => c.editJson(F("chem-2026-0142"), (f) => { f.rung_history[0].note = { en: "A made-up note.", zh: null }; }), expect: [] },
  { name: "an archived record's defect that is only a warning leaves the result ok (SOURCE_URL on a finding published before)", publishing: "2026-10-14", edit: (c) => c.editJson(EARTH, (f) => { f.sources[0].url = "http://www.science.org/doi/10.1126/ut-sample.0012"; }), expect: [
      "W SOURCE_URL findings/earth-2026-0141.json: sources[0].url",
    ] },
];

/**
 * The tests that need the run's evidence or inputs run in draft mode only (SPEC 4.12 "Stored records"): a stored finding that a draft would fail
 * on them raises nothing, a finding being published included. Each edit below is a defect of that kind, and the case holds the copy otherwise clean.
 */
const DRAFT_ONLY_CASES: PubCase[] = [
  ...[undefined, "2026-10-12"].flatMap((publishing): PubCase[] => {
    const where = publishing === undefined ? "with no edition being published" : "on a finding being published";
    const at = publishing === undefined ? {} : { publishing };
    return [
      { name: `NUMBER_SOURCED is a draft's: a number that no source holds raises nothing ${where}`, ...at, edit: (c) => c.editJson(EARTH, (f) => {
          f.explainer.found.en = f.explainer.found.en.replace("12 per cent", "47 per cent");
          f.explainer.found.zh = f.explainer.found.zh.replace("12%", "47%");
        }), expect: [] },
      { name: `SOURCE_SEEN is a draft's: an address that no pack or fetch of the run holds raises nothing ${where}`, ...at, edit: (c) => c.editJson(EARTH, (f) => {
          f.sources[0].url = "https://www.science.org/doi/10.1126/ut-sample.0013";
        }), expect: [] },
      { name: `RETURN_NEW_FACT is a draft's: a returning entry dated before the pack window raises nothing ${where}`, ...at, edit: (c) => c.editJson(F("soc-2026-0145"), (f) => { f.since_then[0].date = "2026-09-01"; }), expect: [] },
      { name: `ZH_RUNG_LABEL is for drafts and seeds: a how_sure whose Chinese label is not the rung's raises nothing ${where}`, ...at, edit: (c) => c.editJson(EARTH, (f) => {
          f.explainer.how_sure.zh = f.explainer.how_sure.zh.replace("已應用", "已證實");
        }), expect: [] },
    ];
  }),
];

/** The fixed limits and a finding's own record run on every stored record, whether it is being published or not. */
const FIXED_LIMIT_CASES: PubCase[] = [
  ...[undefined, "2026-10-12", "2026-10-14"].flatMap((publishing): PubCase[] => {
    const where = publishing === undefined ? "with no edition being published" : `with ${publishing} being published`;
    const at = publishing === undefined ? {} : { publishing };
    return [
      { name: `SENTENCE_LENGTH: a sentence of 25 words in a stored finding is an error ${where}`, ...at, edit: (c) => c.editJson(EARTH, (f) => {
          f.explainer.how_sure.en = f.explainer.how_sure.en.replace("daily forecasts. Science", "daily forecasts, and Science");
        }), expect: ["E SENTENCE_LENGTH findings/earth-2026-0141.json: explainer.how_sure.en"] },
      { name: `AI_CONFIDENCE: a null confidence on a finding with an AI role is an error ${where}`, ...at, edit: (c) => c.editJson(EARTH, (f) => { f.ai.confidence = null; }), expect: [
          "E AI_CONFIDENCE findings/earth-2026-0141.json: ai.confidence",
        ] },
      { name: `AI_CONFIDENCE: Confirmed with evidence from the claimant alone is an error ${where}`, ...at, edit: (c) => c.editJson(EARTH, (f) => { for (const e of f.ai.evidence) e.from_claimant = true; }), expect: [
          "E AI_CONFIDENCE findings/earth-2026-0141.json: ai.confidence",
        ] },
    ];
  }),
];

/**
 * The word budgets of SPEC 4.12's table are fixed limits: they run on every record, a record being published or not. Each budget at its
 * limit passes and one word more fails, with one issue at the string's own path.
 */
const BUDGETS: readonly { what: string; limit: number; path: string; set: (c: SampleCopy, text: string) => void }[] = [
  { what: "a finding's title", limit: 12, path: "findings/earth-2026-0141.json: title.en", set: (c, t) => c.editJson(EARTH, (f) => { f.title.en = t; }) },
  { what: "a rung note", limit: 25, path: "findings/chem-2026-0142.json: rung_history[1].note.en", set: (c, t) => c.editJson(F("chem-2026-0142"), (f) => { f.rung_history[1].note.en = t; }) },
  { what: "an idea line", limit: 40, path: "briefs/2026-10-14.json: ideas[0].text.en", set: (c, t) => c.editJson(B("2026-10-14"), (b) => { b.ideas[0].text.en = t; }) },
  { what: "an Also noted title", limit: 20, path: "briefs/2026-10-14.json: also[0].title.en", set: (c, t) => c.editJson(B("2026-10-14"), (b) => { b.also[0].title.en = t; }) },
  { what: "a returning update, since_then", limit: 60, path: "findings/soc-2026-0145.json: since_then[0].text.en", set: (c, t) => c.editJson(F("soc-2026-0145"), (f) => { f.since_then[0].text.en = t; }) },
  { what: "a term definition", limit: 40, path: "glossary.json: terms[1].en.definition", set: (c, t) => c.editJson("glossary.json", (g) => { g.terms[1].en.definition = t; }) },
  { what: "a figure's alt text", limit: 40, path: "findings/hum-2026-0148.json: figure.alt.en", set: (c, t) => c.editJson(F("hum-2026-0148"), (f) => { f.figure.alt.en = t; }) },
  { what: "a correction's reason", limit: 40, path: "corrections.json: corrections[1].reason.en", set: (c, t) => c.editJson("corrections.json", (g) => { g.corrections[1].reason.en = t; }) },
  { what: "a report's reason", limit: 40, path: "reports.json: reports[1].reason.en", set: (c, t) => c.editJson("reports.json", (g) => { g.reports[1].reason.en = t; }) },
  { what: "the strongest evidence against", limit: 50, path: "briefs/2026-10-12.json: review.strongest_against.text.en", set: (c, t) => c.editJson(B("2026-10-12"), (b) => { b.review.strongest_against.text.en = t; }) },
  { what: "the story's found part", limit: 55, path: "findings/hum-2026-0148.json: explainer.found.en", set: (c, t) => c.editJson(F("hum-2026-0148"), (f) => { f.explainer.found.en = t; }) },
];
/** A made-up text of exactly `n` words in sentences of ten words or fewer. */
const sentences = (n: number): string => {
  const out: string[] = [];
  for (let left = n; left > 0; left -= 10) out.push(`${plain(Math.min(10, left)).replace(/\.$/, "")}.`);
  return out.join(" ");
};
const BUDGET_CASES: PubCase[] = BUDGETS.flatMap((b): PubCase[] => [
  { name: `WORDS: ${b.what} at its limit of ${b.limit} words passes on a stored record`, edit: (c) => b.set(c, sentences(b.limit)), expect: [] },
  { name: `WORDS: ${b.what} of ${b.limit + 1} words fails on a stored record not being published`, edit: (c) => b.set(c, sentences(b.limit + 1)), expect: [`E WORDS ${b.path}`] },
]);

/** Every published-mode case, in the order of the families above. */
const PUBLISHED: readonly PubCase[] = [
  ...XREF_CASES, ...LANG_CASES, ...LAYOUT_CASES, ...UNREADABLE_CASES, ...STRUCT_CASES, ...SUBFIELD_CASES, ...LADDER_CASES, ...SOURCES_CASES,
  ...SAFETY_CASES, ...GROUNDING_CASES, ...WORDS_CASES, ...REMOVED_CASES, ...RETURNING_CASES, ...RECORD_SET_CASES, ...MORE_CASES,
  ...REMOVED_MORE_CASES, ...CONFIG_GATE_CASES, ...RUNG_STORED_CASES, ...SAFETY_MORE_CASES, ...RETURNING_MORE_CASES, ...IGNORED_CASES, ...DRAFT_ONLY_CASES, ...FIXED_LIMIT_CASES, ...BUDGET_CASES,
];

// ── Running a case ───────────────────────────────────────────────────────────────────────────────

/** What one run gave: the sorted codes of its errors and of its warnings, and every issue as "E CODE path" or "W CODE path". */
interface Outcome {
  errors: string[];
  warnings: string[];
  issues: string[];
}

const label = (i: ValidationIssue): string => `${i.severity === "error" ? "E" : "W"} ${i.code} ${i.path}`;
const codesOf = (issues: readonly ValidationIssue[], severity: "error" | "warning"): string[] =>
  [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();
const outcomeOf = (issues: readonly ValidationIssue[]): Outcome =>
  ({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning"), issues: issues.map(label).sort() });

/** The faults of the engine itself, never expected of a case unless it says so: a rule that threw, and a run that lacked an input. */
const ENGINE_FAULTS = ["RULE_ERROR", "INPUT_MISSING"] as const;
const faultsOf = (o: Outcome, allowed: readonly string[] = []): string[] =>
  ENGINE_FAULTS.filter((code) => !allowed.includes(code) && (o.errors.includes(code) || o.warnings.includes(code)));

/** Each run is made once: the tests of a case and the code table read the same outcome. */
const memo = new Map<string, Outcome>();
function once(key: string, run: () => Outcome): Outcome {
  let found = memo.get(key);
  if (found === undefined) {
    found = run();
    memo.set(key, found);
  }
  return found;
}

const english = (draft: unknown, edition: EditionName): Outcome => outcomeOf(validateDraft(draft, draftInputs(edition)).issues);
const chinese = (draft: unknown, edition: EditionName): Outcome => {
  const inputs = zhInputs(edition);
  return outcomeOf(validateZh(draft, inputs.english, inputs, { fileDate: inputs.fileDate }).issues);
};

/** An English fixture as it lies on disk, not as the builder would write it (a stale file fails here). */
const onDisk = (folder: "fixtures/drafts" | "fixtures/drafts-zh", file: string): unknown => readJson(`${folder}/${file}`);

const runF = (c: (typeof INVALID_CASES)[number]): Outcome => once(`F:${c.file}`, () => english(onDisk("fixtures/drafts", c.file), c.edition ?? "weekday"));
const runS = (c: (typeof SOFT_CASES)[number]): Outcome => once(`S:${c.file}`, () => english(onDisk("fixtures/drafts", c.file), c.edition ?? "weekday"));
const runZ = (c: (typeof ZH_INVALID_CASES)[number]): Outcome => once(`Z:${c.file}`, () => chinese(onDisk("fixtures/drafts-zh", c.file), c.edition ?? "weekday"));
const runT = (c: (typeof NAMED_CASES)[number]): Outcome => once(`T:${c.edition}:${c.name}`, () => {
  const draft = editionDraft(c.edition);
  const out = c.mutate(draft);
  return english(out === undefined ? draft : out, c.edition);
});
const runZT = (c: (typeof ZH_NAMED_CASES)[number]): Outcome => once(`ZT:${c.edition}:${c.name}`, () => {
  const draft = zhDraft(c.edition);
  const out = c.mutate(draft);
  return chinese(out === undefined ? draft : out, c.edition);
});

/** What a published-mode case gave: its outcome, and the whole result (each file's own issues too). */
interface PublishedRun {
  outcome: Outcome;
  result: AllResult;
  /** Whether the case's edit changed the copy at all (a case that edits nothing proves nothing about an edit). */
  changed: boolean;
  /** The regular files of the copy as the case's edit left them, by their path in the copy. */
  present: string[];
}
const publishedRuns = new Map<string, PublishedRun>();

/** A published-mode case on its own copy of the sample, run once: the tests of the case and the code table read the same run. */
function runPublishedFull(c: PubCase): PublishedRun {
  let found = publishedRuns.get(c.name);
  if (found === undefined) {
    let changed = false;
    let present: string[] = [];
    const result = withSampleCopy((copy) => {
      const before = copy.fingerprint();
      c.edit(copy);
      changed = copy.fingerprint() !== before;
      present = copy.list().filter((rel) => fs.statSync(copy.abs(rel)).isFile());
      return copy.validate({
        ...(c.publishing === undefined ? {} : { publishing: c.publishing }),
        ...(c.config === undefined ? {} : { config: c.config(sampleConfig()) }),
      });
    });
    found = { outcome: outcomeOf(result.issues), result, changed, present };
    publishedRuns.set(c.name, found);
  }
  return found;
}
const runPublished = (c: PubCase): Outcome => runPublishedFull(c).outcome;

// ── The table of codes ───────────────────────────────────────────────────────────────────────────

type Kind = "F" | "S" | "T" | "Z";

/**
 * The rows the table lists a kind of test for that nothing in P1 can run: SEED_SOURCES is reported by the Landmark Ledger seeder (SPEC 8.13),
 * which P2 writes, and its T cases are that seeder's. Any other row without its case is a missing case, and the test below lists it.
 */
const EXEMPT: readonly string[] = ["T:SEED_SOURCES"];

/** The codes that every case of one kind and code passes, from running them: `kind:CODE` for each code with at least one case and no failing one. */
function codesCovered(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (kind: Kind, code: string, why: string | null): void => {
    const key = `${kind}:${code}`;
    out.set(key, [...(out.get(key) ?? []), ...(why === null ? [] : [why])]);
  };
  for (const c of INVALID_CASES) {
    const o = runF(c);
    add("F", c.code, o.errors.join() === c.code && o.warnings.length === 0 ? null : `${c.file} gives ${o.errors.join() || "no error"}`);
  }
  for (const c of SOFT_CASES) {
    const o = runS(c);
    add("S", c.code, o.errors.length === 0 && o.warnings.join() === c.code ? null : `${c.file} gives ${o.warnings.join() || "no warning"}`);
  }
  for (const c of ZH_INVALID_CASES) {
    const o = runZ(c);
    add("Z", c.code, o.errors.join() === c.code && o.warnings.length === 0 ? null : `${c.file} gives ${o.errors.join() || "no error"}`);
  }
  for (const c of [...NAMED_CASES.map((n) => ({ n, o: runT(n) })), ...ZH_NAMED_CASES.map((n) => ({ n, o: runZT(n) }))]) {
    const ok = c.o.errors.join() === [...c.n.expect.errors].sort().join() && c.o.warnings.join() === [...c.n.expect.warnings].sort().join();
    add("T", c.n.code, ok ? null : `named case "${c.n.name}" is not as expected`);
  }
  for (const c of PUBLISHED) {
    const o = runPublished(c);
    const ok = JSON.stringify(o.issues) === JSON.stringify([...c.expect].sort());
    for (const code of new Set(o.issues.map((l) => l.split(" ")[1]!))) add("T", code, ok ? null : `published case "${c.name}" is not as expected`);
  }
  return out;
}

describe("the code table is covered by cases that run", () => {
  it("lists the 57 codes of SPEC 4.12, each once", () => {
    expect(RULE_CODE_TABLE).toHaveLength(57);
    expect(new Set(RULE_CODE_TABLE.map((r) => r.code)).size).toBe(57);
  });

  it("gives each code, for each kind of test it lists, a case that runs and passes (the exempt row aside)", () => {
    const covered = codesCovered();
    const missing: string[] = [];
    const failing: string[] = [];
    for (const row of RULE_CODE_TABLE) {
      for (const kind of row.tests) {
        const key = `${kind}:${row.code}`;
        if (EXEMPT.includes(key)) continue;
        const found = covered.get(key);
        if (found === undefined) missing.push(key);
        else if (found.length > 0) failing.push(`${key}: ${found.join("; ")}`);
      }
    }
    expect(missing, `codes the table lists a kind of test for that has no case (kind:CODE): ${missing.join(", ")}`).toEqual([]);
    expect(failing, `cases that do not pass: ${failing.join(" | ")}`).toEqual([]);
  }, 120_000);

  it("pins the exempt rows: the Ledger seeder's code, which only the seeder reports", () => {
    expect(EXEMPT).toEqual(["T:SEED_SOURCES"]);
    const row = RULE_CODE_TABLE.find((r) => r.code === "SEED_SOURCES")!;
    expect(row.group).toBe("seed");
    expect(row.scopes).toEqual(["seed"]);
    expect(row.tests).toEqual(["T"]);
    expect(ruleCodes(RULES)).not.toContain("SEED_SOURCES");
  });

  it("pins the code lists the published mode rests on (SPEC 4.12 \"Stored records\")", () => {
    // The codes the site leaves out a record on, at either severity, and the codes whose errors are warnings on a record not being published.
    expect([...SITE_BLOCKING_CODES].sort()).toEqual(["BLOCKED_HOST", "CANARY", "DATE_MISMATCH", "DUAL_USE", "FILE_LAYOUT", "SCHEMA", "SECRET_LIKE"]);
    expect([...ARCHIVE_WARNING_CODES].sort()).toEqual(["BLOCKED_HOST", "DUAL_USE", "SOURCE_URL"]);
    // Both lists name codes of the table, so a renamed code cannot leave a list pointing at nothing.
    const inTable = RULE_CODE_TABLE.map((r) => r.code);
    for (const code of [...SITE_BLOCKING_CODES, ...ARCHIVE_WARNING_CODES]) expect(inTable, code).toContain(code);
  });

  it("pins the budgets the cases rest on: a page of 1,000 words is the target and 1,300 the limit (SPEC 4.5)", () => {
    const { words_target: target, words_max: max } = sampleConfig().run.budgets;
    expect({ target, max }).toEqual({ target: 1000, max: 1300 });
  });

  it("has no loop that could run over nothing: each kind of fixture and case has at least the cases the table lists it for", () => {
    // Floors, not exact counts: the builder may add cases. The F floor is the table's 40 F rows (the engine's SCHEMA among them,
    // fixtures/src/invalid/engine.ts), and each case of a kind is one test of its loop.
    expect(INVALID_CASES.length).toBeGreaterThanOrEqual(40);
    expect(SOFT_CASES.length).toBeGreaterThanOrEqual(2);
    expect(ZH_INVALID_CASES.length).toBeGreaterThanOrEqual(17);
    expect(NAMED_CASES.length).toBeGreaterThanOrEqual(300);
    expect(ZH_NAMED_CASES.length).toBeGreaterThanOrEqual(90);
    expect(PUBLISHED.length).toBeGreaterThanOrEqual(250);
    // Every F, S and Z fixture is one case of its code with no second file, and a mutation of the weekday draft (SPEC 4.12 "Fixtures").
    for (const [kind, cases] of [["F", INVALID_CASES], ["S", SOFT_CASES], ["Z", ZH_INVALID_CASES]] as const) {
      const codes = cases.map((c: { code: string }) => c.code);
      expect(codes.filter((code, i) => codes.indexOf(code) !== i), `${kind} fixtures of one code`).toEqual([]);
      expect(cases.filter((c: { edition?: string }) => (c.edition ?? "weekday") !== "weekday").map((c: { file: string }) => c.file), `${kind} fixtures of another edition`).toEqual([]);
    }
  });

  it("has no fixture of a kind the table does not list for its code", () => {
    const listed = (code: string): readonly string[] => RULE_CODE_TABLE.find((r) => r.code === code)?.tests ?? [];
    const stray = [
      ...INVALID_CASES.filter((c) => !listed(c.code).includes("F")).map((c) => `F ${c.code}`),
      ...SOFT_CASES.filter((c) => !listed(c.code).includes("S")).map((c) => `S ${c.code}`),
      ...ZH_INVALID_CASES.filter((c) => !listed(c.code).includes("Z")).map((c) => `Z ${c.code}`),
      ...ZH_SOFT_CASES.filter((c) => !listed(c.code).includes("S")).map((c) => `S ${c.code}`),
      ...NAMED_CASES.filter((c) => !RULE_CODE_TABLE.some((r) => r.code === c.code)).map((c) => `T ${c.code} (not in the table)`),
      ...ZH_NAMED_CASES.filter((c) => !RULE_CODE_TABLE.some((r) => r.code === c.code)).map((c) => `ZT ${c.code} (not in the table)`),
    ];
    expect(stray).toEqual([]);
  });

  it("has a file on disk for each F, S and Z fixture, named for its code", () => {
    const missing: string[] = [];
    for (const c of INVALID_CASES) if (!fs.existsSync(path.join(REPO_ROOT, "fixtures/drafts", c.file)) || c.file !== `invalid--${c.code}.json`) missing.push(c.file);
    for (const c of SOFT_CASES) if (!fs.existsSync(path.join(REPO_ROOT, "fixtures/drafts", c.file)) || c.file !== `soft--${c.code}.json`) missing.push(c.file);
    for (const c of ZH_INVALID_CASES) if (!fs.existsSync(path.join(REPO_ROOT, "fixtures/drafts-zh", c.file)) || c.file !== `invalid--${c.code}.zh.json`) missing.push(c.file);
    expect(missing).toEqual([]);
  });

  it("has an F file for every code the table lists an F for, and no code without a rule (the table and the rules agree)", () => {
    expect(uncoveredCodes()).toEqual([]);
    const inTable = new Set(RULE_CODE_TABLE.map((r) => r.code));
    expect(ruleCodes(RULES).filter((code) => !inTable.has(code))).toEqual([]);
  });

  it("fires every code that a rule reports on at least one fixture or case", () => {
    const seen = new Set<string>();
    for (const c of INVALID_CASES) for (const l of runF(c).issues) seen.add(l.split(" ")[1]!);
    for (const c of SOFT_CASES) for (const l of runS(c).issues) seen.add(l.split(" ")[1]!);
    for (const c of ZH_INVALID_CASES) for (const l of runZ(c).issues) seen.add(l.split(" ")[1]!);
    for (const c of NAMED_CASES) for (const l of runT(c).issues) seen.add(l.split(" ")[1]!);
    for (const c of PUBLISHED) for (const l of runPublished(c).issues) seen.add(l.split(" ")[1]!);
    expect(ruleCodes(RULES).filter((code) => !seen.has(code))).toEqual([]);
  }, 120_000);
});

// ── The fixture loops ────────────────────────────────────────────────────────────────────────────

describe("the valid drafts", () => {
  it.each(EDITION_NAMES)("the valid English draft of the %s edition is clean", (name) => {
    const o = english(onDisk("fixtures/drafts", `valid-${name}.json`), name);
    expect(o.issues).toEqual([]);
  });

  it.each(EDITION_NAMES)("the valid Chinese draft of the %s edition is clean", (name) => {
    const o = chinese(onDisk("fixtures/drafts-zh", `valid-${name}.zh.json`), name);
    expect(o.issues).toEqual([]);
  });

  it("are four English and four Chinese, one for each edition", () => {
    expect([...EDITION_NAMES]).toEqual(["weekday", "sunday", "monday", "monday-short"]);
    expect(fixtureCounts().files).toMatchObject({ validEnglish: 4, validChinese: 4 });
  });
});

describe("F fixtures: each fails the whole validator with exactly its code and nothing else", () => {
  for (const c of INVALID_CASES) {
    it(`${c.file} (${c.edition ?? "weekday"})`, () => {
      const o = runF(c);
      expect(o.errors, o.issues.join("\n")).toEqual([c.code]);
      expect(o.warnings).toEqual([]);
      expect(faultsOf(o)).toEqual([]);
    });
  }
});

describe("S fixtures: each passes the whole validator with exactly its one warning", () => {
  for (const c of SOFT_CASES) {
    it(`${c.file} (${c.edition ?? "weekday"})`, () => {
      const o = runS(c);
      expect(o.errors, o.issues.join("\n")).toEqual([]);
      expect(o.warnings).toEqual([c.code]);
      expect(faultsOf(o)).toEqual([]);
    });
  }
});

describe("Z fixtures: each fails the Chinese validator with exactly its code and nothing else", () => {
  for (const c of ZH_INVALID_CASES) {
    it(`${c.file} (${c.edition ?? "weekday"})`, () => {
      const o = runZ(c);
      expect(o.errors, o.issues.join("\n")).toEqual([c.code]);
      expect(o.warnings).toEqual([]);
      expect(faultsOf(o)).toEqual([]);
    });
  }

  it("has no Chinese soft fixture, since every ZH_ code is hard", () => {
    expect(ZH_SOFT_CASES).toEqual([]);
  });
});

describe("T cases of the builder: each gives exactly its sets of error and warning codes", () => {
  for (const c of NAMED_CASES) {
    it(`${c.edition}: ${c.name}`, () => {
      const o = runT(c);
      expect({ errors: o.errors, warnings: o.warnings }, o.issues.join("\n")).toEqual({ errors: [...c.expect.errors].sort(), warnings: [...c.expect.warnings].sort() });
      expect(faultsOf(o, [...c.expect.errors, ...c.expect.warnings])).toEqual([]);
      expect([...c.expect.errors, ...c.expect.warnings], "the case is about a code it gives").toContain(c.code);
    });
  }
  for (const c of ZH_NAMED_CASES) {
    it(`Chinese, ${c.edition}: ${c.name}`, () => {
      const o = runZT(c);
      expect({ errors: o.errors, warnings: o.warnings }, o.issues.join("\n")).toEqual({ errors: [...c.expect.errors].sort(), warnings: [...c.expect.warnings].sort() });
      expect(faultsOf(o, [...c.expect.errors, ...c.expect.warnings])).toEqual([]);
      // A case that expects an issue is about a code it gives; a case that expects none is a passing case of its code (a boundary the rule must allow).
      const given = [...c.expect.errors, ...c.expect.warnings];
      if (given.length > 0) expect(given, "the case is about a code it gives").toContain(c.code);
    });
  }

  it("have unique names within an edition", () => {
    const keys = [...NAMED_CASES.map((c) => `${c.edition}:${c.name}`), ...ZH_NAMED_CASES.map((c) => `zh:${c.edition}:${c.name}`)];
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});

describe("the fixtures on disk are what the builder writes", () => {
  it("has no missing, stale or added file (what npm run fixtures:check reports)", () => {
    const outputs = allOutputs();
    expect(outputs.length, "the builder writes the fixtures of every kind").toBeGreaterThanOrEqual(100);
    expect(compareOutputs(outputs)).toEqual({ missing: [], stale: [], added: [] });
  }, 60_000);

  it("holds the F, S and Z drafts as the builder writes them", () => {
    const drafts = [...validOutputs(), ...invalidOutputs(), ...softOutputs(), ...zhInvalidOutputs(), ...zhSoftOutputs()];
    expect(drafts.length, "the drafts of every kind").toBeGreaterThanOrEqual(60);
    const { missing, stale } = compareOutputs(drafts);
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });
});

// ── Draft cases that need the stored records ─────────────────────────────────────────────────────

/** The sample world's stored records as the stage that validates a morning's draft passes them (SPEC 8.5), with the glossary's terms as given. */
const storedFor = (edition: EditionName, terms: ReturnType<typeof storedGlossary>["terms"]) =>
  ({ findings: storedFindingsBefore(EDITIONS[edition].date), corrections: [], terms });
const baseTerms = (): ReturnType<typeof storedGlossary>["terms"] => storedGlossary(EDITIONS.weekday.date).terms;
const storedTerm = (id: string, name: string, definition: string, firstDate: string) =>
  Term.parse({ id, en: { term: name, definition }, zh: null, fields: ["biology"], first_finding: "bio-2026-0143", first_date: firstDate });

/** The weekday draft, changed, with the weekday's inputs and, when `terms` is given, the stored records (a run without them skips what needs them). */
function weekday(mutate: (draft: any) => void, terms: ReturnType<typeof storedGlossary>["terms"] | null): string[] {
  const draft: any = editionDraft("weekday");
  mutate(draft);
  const inputs = draftInputs("weekday");
  const result = validateDraft(draft, terms === null ? inputs : { ...inputs, stored: storedFor("weekday", terms) });
  return result.issues.map(label).sort();
}
const finding = (draft: any, ref: string): any => draft.new_findings.find((f: { ref: string }) => f.ref === ref);

describe("TERM_DEFINED against the stored glossary (a run given the stored records)", () => {
  it("passes the weekday draft with the sample world's glossary", () => {
    expect(weekday(() => undefined, baseTerms())).toEqual([]);
  });

  it("fails a listed glossary id that is no term of the glossary, and only a run holding the glossary can tell", () => {
    const list = (d: unknown): void => { finding(d, "new-3").terms = [{ new: false, id: "no-such-term" }]; };
    const withGlossary = weekday(list, baseTerms());
    const without = weekday(list, null);
    // The unused listed term is the same fault in both runs; the unknown id is the one more issue that only the glossary shows.
    expect(withGlossary).toEqual(["E TERM_DEFINED new_findings[2].terms[0]", "E TERM_DEFINED new_findings[2].terms[0]"]);
    expect(without).toEqual(["E TERM_DEFINED new_findings[2].terms[0]"]);
  });

  it("fails a new term whose id the glossary already holds, unless that entry was first defined on the edition's own date (a rerun)", () => {
    const held = (firstDate: string) => [...baseTerms(), storedTerm("cryo-electron-microscopy", "cryo-electron microscopy", "A way to see molecules.", firstDate)];
    expect(weekday(() => undefined, held("2026-10-01"))).toEqual(["E TERM_DEFINED new_findings[1].terms[0]"]);
    expect(weekday(() => undefined, held(EDITIONS.weekday.date))).toEqual([]);
  });

  it("reads a definition against the glossary as it will stand after publication: a stored term's name is defined, an unlisted one is not", () => {
    const useWord = (d: unknown): void => { finding(d, "new-2").terms[0].definition = "A way to see the shape of a molecule, much as a transformer reads patterns."; };
    const glossary = [...baseTerms(), storedTerm("transformer", "transformer", "A kind of model.", "2026-10-01")];
    expect(weekday(useWord, glossary)).toEqual([]);
    expect(weekday(useWord, null)).toEqual(["E TERM_DEFINED new_findings[1].terms[0].definition"]);
  });

  it("reads a definition against every new term of the whole draft", () => {
    const useOther = (d: unknown): void => { finding(d, "new-2").terms[0].definition = "A way to see the shape of a molecule, checked like a proof assistant checks a proof."; };
    expect(weekday(useOther, null)).toEqual([]);
  });
});

// ── Published-mode cases, each on a copy of the sample ───────────────────────────────────────────

describe("published-mode T cases", () => {
  it("has unique names and a case for each family of the spec's list", () => {
    const names = PUBLISHED.map((c) => c.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    const codes = new Set(PUBLISHED.flatMap((c) => c.expect.map((l) => l.split(" ")[1]!)));
    for (const code of ["XREF", "LANG_PARITY", "FILE_LAYOUT", "DATE_MISMATCH", "WEEK_AGAINST", "FORMAT_SECTIONS", "COUNTS", "FIELD_CAP", "STORY_PICK", "SOURCE_IDS", "SUBFIELD_UNKNOWN"]) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  for (const c of PUBLISHED) {
    it(c.name, () => {
      const { outcome: actual, result, changed, present } = runPublishedFull(c);
      expect(actual.issues).toEqual([...c.expect].sort());
      expect(result.ok).toBe(actual.errors.length === 0);
      expect(faultsOf(actual, c.expect.map((l) => l.split(" ")[1]!))).toEqual([]);
      // An edit that changes nothing is only for a case that is about a setting (`publishing`, `config`) or the sample as it is.
      expect(changed || c.edit === NO_EDIT, "the edit changes the copy").toBe(true);
      // Each issue that names a file of the copy is also the issue of that file, with the file taken off the path: a path that names
      // a file the result does not list is a failure, not a skip.
      expect(result.files.length, "the run lists the files of the copy").toBeGreaterThan(0);
      for (const issue of result.issues) {
        const m = /^([^:]+): (.*)$/.exec(issue.path);
        if (m === null || !present.includes(m[1]!)) continue;
        const file = result.files.find((f) => f.file === m[1]);
        expect(file, `${issue.path} names a file the run lists`).toBeDefined();
        expect(file!.issues.some((i) => i.code === issue.code && i.severity === issue.severity && i.path === m[2]), `${issue.path} is the issue of ${m[1]}`).toBe(true);
      }
    });
  }
});

// ── The sample itself ────────────────────────────────────────────────────────────────────────────

describe("the sample content (fixtures/site-content)", () => {
  const SAMPLE_DATES = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];

  it("is clean as a whole and file by file", () => {
    const result = validateAll(SAMPLE_DIR, { perFile: true, config: sampleConfig() });
    expect(result.issues.map(label)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(fixtureCounts().sample.files);
    expect(result.files.flatMap((f) => f.issues)).toEqual([]);
  });

  it("holds seven editions, one for each day of a week, in the formats of the calendar", () => {
    const counts = fixtureCounts().sample;
    expect(counts).toMatchObject({ briefs: 7, findings: 15, metrics: 7, inputs: 7, status: 7, fixed: 5 });
    const formats = SAMPLE_DATES.map((d) => (readJson(`fixtures/site-content/briefs/${d}.json`) as { format: string; edition: string }));
    expect(formats.map((b) => b.format)).toEqual(["monday_review", "daily", "daily", "daily", "daily", "daily", "sunday_deep_dive"]);
    expect(formats.map((b) => b.edition)).toEqual(["full", "full", "full", "data_only", "full", "full", "full"]);
  });

  it.each(SAMPLE_DATES)("is clean when %s is the edition being published", (date) => {
    const result = validateAll(SAMPLE_DIR, { publishing: date, config: sampleConfig() });
    expect(result.issues.map(label)).toEqual([]);
  });

  it("gives one XREF at (publishing) for a date with no stored brief, and nothing else", () => {
    const result = validateAll(SAMPLE_DIR, { publishing: "2026-10-19", config: sampleConfig() });
    expect(result.issues.map(label)).toEqual(["E XREF (publishing)"]);
  });

  it("never holds an issue that blocks the site, whichever date is published", () => {
    for (const date of [undefined, ...SAMPLE_DATES, "2026-10-19"]) {
      const result = validateAll(SAMPLE_DIR, { config: sampleConfig(), ...(date === undefined ? {} : { publishing: date }) });
      const blocking = result.issues.filter((i) => (SITE_BLOCKING_CODES as readonly string[]).includes(i.code) && i.path !== "(publishing)");
      expect(blocking.map(label), String(date)).toEqual([]);
    }
  });

  it("is the same files the builder writes (a copy changes nothing: validating a copy gives the same result)", () => {
    const direct = validateAll(SAMPLE_DIR, { config: sampleConfig() });
    const copied = withSampleCopy((copy) => copy.validate());
    expect(copied.issues.map(label)).toEqual(direct.issues.map(label));
  });

  it("holds the empty sample, which passes with nothing in it but its placeholder", () => {
    expect(fs.readdirSync(EMPTY_DIR)).toEqual(["README.md"]);
    const result = validateAll(EMPTY_DIR, { perFile: true, config: sampleConfig() });
    expect({ ok: result.ok, issues: result.issues, files: result.files }).toEqual({ ok: true, issues: [], files: [] });
  });

  it("passes for a folder that does not exist, and for an empty one", () => {
    const missing = path.join(os.tmpdir(), `ut-no-such-folder-${process.pid}-${Date.now()}`);
    expect(validateAll(missing, { config: sampleConfig() }).issues).toEqual([]);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ut-empty-folder-"));
    try {
      expect(validateAll(empty, { config: sampleConfig() }).issues).toEqual([]);
      expect(validateAll(empty, { publishing: "2026-10-12", config: sampleConfig() }).issues.map(label)).toEqual(["E XREF (publishing)"]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ── The helper that makes the copies ─────────────────────────────────────────────────────────────

describe("the sample copy helper (tests/helpers/sample-copy.ts)", () => {
  it("copies the sample into a folder of its own and never touches the sample", () => {
    const glossary = path.join(SAMPLE_DIR, "glossary.json");
    const before = fs.readFileSync(glossary, "utf8");
    let dir = "";
    withSampleCopy((copy) => {
      dir = copy.dir;
      expect(copy.dir.startsWith(os.tmpdir())).toBe(true);
      expect(path.basename(copy.dir).startsWith("ut-sample-copy-")).toBe(true);
      expect(copy.dir).not.toBe(SAMPLE_DIR);
      expect(copy.list()).toContain("glossary.json");
      expect(copy.exists("briefs/2026-10-12.json")).toBe(true);
      copy.writeRaw("glossary.json", "{}");
      copy.remove("reports.json");
      expect(copy.text("glossary.json")).toBe("{}");
      expect(copy.exists("reports.json")).toBe(false);
    });
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readFileSync(glossary, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(SAMPLE_DIR, "reports.json"))).toBe(true);
  });

  it("gives each copy a folder of its own", () => {
    const a = new SampleCopy();
    const b = new SampleCopy();
    try {
      expect(a.dir).not.toBe(b.dir);
      a.remove("reports.json");
      expect(b.exists("reports.json")).toBe(true);
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  it("refuses a path that leaves the copy, so a case can never write outside it", () => {
    withSampleCopy((copy) => {
      expect(() => copy.abs("../outside.json")).toThrow(/leaves the sample copy/);
      expect(() => copy.abs("briefs/../../outside.json")).toThrow(/leaves the sample copy/);
      expect(() => copy.writeRaw("../outside.json", "x")).toThrow(/leaves the sample copy/);
      expect(() => copy.remove("../")).toThrow(/leaves the sample copy/);
      expect(() => copy.abs(`../${path.basename(copy.dir)}-next/x.json`)).toThrow(/leaves the sample copy/);
      expect(copy.abs(".")).toBe(copy.dir);
      expect(copy.abs("briefs/2026-10-12.json")).toBe(path.join(copy.dir, "briefs", "2026-10-12.json"));
    });
  });

  it("removes the copy when the function throws, and disposing twice is safe", () => {
    let dir = "";
    expect(() => withSampleCopy((copy) => { dir = copy.dir; throw new Error("a case failed"); })).toThrow("a case failed");
    expect(fs.existsSync(dir)).toBe(false);
    const copy = new SampleCopy();
    copy.dispose();
    expect(fs.existsSync(copy.dir)).toBe(false);
    expect(() => copy.dispose()).not.toThrow();
  });

  it("reads and edits a file as raw JSON, or through its schema in the schema's key order", () => {
    withSampleCopy((copy) => {
      const terms = (copy.read("glossary.json") as { terms: unknown[] }).terms.length;
      copy.editJson("glossary.json", (g) => { g.terms.pop(); });
      expect((copy.read("glossary.json") as { terms: unknown[] }).terms).toHaveLength(terms - 1);
      expect(copy.text("glossary.json").endsWith("\n")).toBe(true);
      copy.editParsed("glossary.json", GlossaryFile, (g) => { g.terms.pop(); });
      const parsed = copy.readParsed("glossary.json", GlossaryFile);
      expect(parsed.terms).toHaveLength(terms - 2);
      expect(copy.text("glossary.json")).toBe(jsonText(parsed, GlossaryFile));
      expect(() => copy.editParsed("glossary.json", GlossaryFile, () => ({ terms: "not a list" }))).toThrow();
      copy.editJson("glossary.json", () => ({ replaced: true }));
      expect(copy.read("glossary.json")).toEqual({ replaced: true });
      expect(() => copy.remove("no-such-file.json")).toThrow();
    });
  });

  it("renames, links and lists, folders and files together, sorted", () => {
    withSampleCopy((copy) => {
      copy.rename("reports.json", "moved/reports.json");
      expect(copy.exists("reports.json")).toBe(false);
      expect(copy.exists("moved/reports.json")).toBe(true);
      copy.link("alias.json", "glossary.json");
      const listed = copy.list();
      expect(listed).toContain("moved");
      expect(listed).toContain("moved/reports.json");
      expect(listed).toContain("alias.json");
      expect(listed).toEqual([...listed].sort());
      copy.writeRaw("zz/x.json", "{}");
      copy.writeRaw("zz-b.json", "{}");
      copy.writeRaw("zz-a/y.json", "{}");
      expect(copy.list().slice(-5)).toEqual(["zz", "zz-a", "zz-a/y.json", "zz-b.json", "zz/x.json"]);
      expect(fs.lstatSync(copy.abs("alias.json")).isSymbolicLink()).toBe(true);
    });
  });

  it("fingerprints the copy: equal until a file, a folder or a link changes, and never the sample's own", () => {
    withSampleCopy((copy) => {
      const start = copy.fingerprint();
      expect(copy.fingerprint()).toBe(start);
      copy.editJson("glossary.json", () => undefined);
      expect(copy.fingerprint(), "an edit that returns nothing and changes nothing").toBe(start);
      copy.editJson("glossary.json", (g) => { g.terms[0].en.definition += " "; });
      const edited = copy.fingerprint();
      expect(edited).not.toBe(start);
      copy.editJson("glossary.json", (g) => { g.terms[0].en.definition = g.terms[0].en.definition.trimEnd(); });
      expect(copy.fingerprint(), "the same bytes again give the same fingerprint").toBe(start);
      copy.writeRaw("zz/new.json", "{}");
      const added = copy.fingerprint();
      expect(added).not.toBe(start);
      copy.remove("zz/new.json");
      expect(copy.fingerprint(), "an empty folder is part of the copy").not.toBe(start);
      copy.rename("reports.json", "moved-reports.json");
      expect(copy.fingerprint()).not.toBe(added);
      copy.rename("moved-reports.json", "reports.json");
      copy.link("alias.json", "glossary.json");
      const linked = copy.fingerprint();
      expect(linked).toContain("alias.json\tlink\t");
      copy.remove("alias.json");
      copy.link("alias.json", "reports.json");
      expect(copy.fingerprint(), "a link to another target").not.toBe(linked);
    });
  });

  it("validates with each file's own issues and the repo's config, and passes the options on", () => {
    withSampleCopy((copy) => {
      const clean = copy.validate();
      expect(clean.issues).toEqual([]);
      expect(clean.files).toHaveLength(fixtureCounts().sample.files);
      copy.remove("reports.json");
      const damaged = copy.validate();
      expect(damaged.files.find((f) => f.file === "briefs/2026-10-13.json")?.issues.length).toBeGreaterThan(0);
      expect(copy.validate({ publishing: "2026-10-30" }).issues.map(label)).toContain("E XREF (publishing)");
    });
  });
});

// ── The numbers the PR reports ───────────────────────────────────────────────────────────────────

describe("fixtureCounts()", () => {
  it("counts the codes of the table by severity and by group", () => {
    const counts = fixtureCounts();
    expect(counts.codes.total).toBe(57);
    const severities = counts.codes.bySeverity;
    expect(severities.H + severities.S + severities["H/S"]).toBe(severities.total);
    expect(severities.total).toBe(57);
    for (const kind of ["H", "S", "H/S"] as const) expect(severities[kind]).toBe(RULE_CODE_TABLE.filter((r: RuleCodeInfo) => r.severity === kind).length);
    let sum = 0;
    for (const [group, count] of Object.entries(counts.codes.byGroup)) {
      expect(count.total, group).toBe(RULE_CODE_TABLE.filter((r) => r.group === group).length);
      sum += count.total;
    }
    expect(sum).toBe(57);
  });

  it("counts the kinds of test the table lists, the fixtures on disk and the cases of the builder", () => {
    const counts = fixtureCounts();
    for (const kind of ["F", "S", "T", "Z"] as const) expect(counts.tableTests[kind], kind).toBe(RULE_CODE_TABLE.filter((r) => r.tests.includes(kind)).length);
    expect(counts.files.invalidEnglish).toBe(counts.cases.invalidEnglish);
    expect(counts.files.softEnglish).toBe(counts.cases.softEnglish);
    expect(counts.files.invalidChinese).toBe(counts.cases.invalidChinese);
    expect(counts.files.softChinese).toBe(counts.cases.softChinese);
    expect(counts.cases.namedEnglish).toBe(NAMED_CASES.length);
    expect(Object.values(counts.cases.namedByEdition).reduce((a, b) => a + b, 0)).toBe(NAMED_CASES.length);
    expect(Object.values(counts.cases.namedChineseByEdition).reduce((a, b) => a + b, 0)).toBe(ZH_NAMED_CASES.length);
    for (const key of ["contexts", "evidence", "metrics", "packs", "chineseContexts", "chineseEvidence"] as const) expect(counts.files[key], key).toBe(EDITION_NAMES.length);
  });
});
