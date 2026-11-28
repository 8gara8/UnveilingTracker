// The safety rules (SPEC §4.12; lib/rules/safety.ts): DUAL_USE, SECRET_LIKE, CANARY and BLOCKED_HOST. Each is judged in draft mode, in
// published mode on the records being published, in published mode on every other record and, for the three that run there, in
// Chinese mode, as the rule table, "DUAL_USE's strings and patterns", "Stored records" and "Removed text" say. The worlds are the frame's
// (tests/helpers/rule-world.ts); each test runs the group's own rules, never the registry, so another group's rules cannot change a
// result. Every sequence is made up (the letters of the alphabet in order, repeats of a short motif), never a real organism's, and
// every secret is joined from pieces, so no secret-shaped literal sits in this file (a test below reads it to prove so).
// Cyber's tests/rules-naming-safety-computed.test.ts at the fork commit 3ced1fb, adapted: its SECRET_LIKE samples and its checks that a
// message names the path and the pattern and never the match. The rest is new, since DUAL_USE, BLOCKED_HOST and the Chinese reading of
// the three codes are new here; Cyber's exploit-link and indicator tests went with those rules (SPEC §2).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { editionDraft } from "@/fixtures/src/drafts";
import { draftInputs as sampleInputs } from "@/fixtures/src/inputs";
import { EDITION_NAMES, REPO_ROOT } from "@/fixtures/src/world";
import { loadConfig, type LoadedConfig } from "@/lib/config";
import { RULE_CODE_TABLE, RULE_GROUPS, codesOfGroup } from "@/lib/rules";
import { ARCHIVE_WARNING_CODES, buildDraftInput, buildPublishedInput, runRules, type DraftInputs } from "@/lib/rules/run";
import {
  SECRET_PATTERNS, STEPS_MIN, blockedHostHits, blockedUrlsIn, compileDualUse, dualUseForms, holdsCanary, pairsIn, quantityIn,
  safetyRules, secretsIn, sequencesIn, stepMarkersIn,
} from "@/lib/rules/safety";
import { formatPath, type Rule, type RuleInput, type StoredRecords, type ValidationIssue, type ZhInput } from "@/lib/rules/types";
import { Brief } from "@/lib/schema/brief";
import { INVISIBLE } from "@/lib/sanitize";
import { DualUseFile } from "@/lib/schema/config";
import { AgentContext, ContextConfig } from "@/lib/schema/context";
import { DraftBrief } from "@/lib/schema/draft";
import { DraftZh, ZhContext, type DraftZhTerm } from "@/lib/schema/draft-zh";
import { Finding } from "@/lib/schema/finding";
import { Term } from "@/lib/schema/glossary";
import { Correction, Report } from "@/lib/schema/misc";
import { buildZhInput } from "@/lib/validate-zh";
import { CANARY_TOKEN, CANARY_URL_PREFIX, FIELDS, REMOVED_BEFORE, REMOVED_TEXT } from "@/lib/vocab";
import {
  D, SUNDAY, config, deepFreeze, draftInputs, l, lz, mondayContext, storedFinding, storedWorld, sundayContext, weekdayDraft, type Json,
} from "./helpers/rule-world";

// ── Made-up material ─────────────────────────────────────────────────────────────────────────────

const join = (...parts: string[]): string => parts.join("");

/** Text from code points, so that no invisible or unusual character is typed into this file. */
const chars = (...codes: number[]): string => String.fromCharCode(...codes);
const NO_BREAK_SPACE = chars(0xa0);
const LINE_SEPARATOR = chars(0x2028);
const ZERO_WIDTH_SPACE = chars(0x200b);
const BULLET_CHAR = chars(0x2022);
/** A character as `U+00A0`, for a failure's label. */
const hex = (c: string): string => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
/** Every character a class matches, one string each (a lone surrogate is no character). */
function charactersOf(re: RegExp): string[] {
  const out: string[] = [];
  for (let code = 0; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const c = String.fromCodePoint(code);
    if (re.test(c)) out.push(c);
  }
  return out;
}
/** The characters that Unicode counts as white space, and the invisible ones the sanitiser strips from page text but that are no white space. */
const WHITE_SPACE_CHARS = charactersOf(/^\p{White_Space}$/u);
const INVISIBLE_CHARS = charactersOf(INVISIBLE).filter((c) => !/^\p{White_Space}$/u.test(c));

/** 20 letters of ACGT: the shortest nucleotide run that fails. */
const NUC = "ACGT".repeat(5);
/** The twenty one-letter amino-acid codes in alphabetical order: 20 letters, and no organism's protein. */
const AMINO = "ACDEFGHIKLMNPQRSTVWY";
/** Two numbered steps: one text for every test of the steps. */
const STEPS = "1. Mix the parts. 2. Heat the mix.";
/** An agent and a procedure word in one string, which works as a sentence, a name and a slug. */
const PAIR = "ricin-purification";
/** A planted address of each reason of BLOCKED_HOSTS. */
const BLOCKED: readonly [reason: string, url: string, pattern: string][] = [
  ["paste", "https://pastebin.com/abc123", "pastebin.com"],
  ["messaging", "https://t.me/somechannel", "t.me"],
  ["shortener", "https://bit.ly/abc123", "bit.ly"],
  ["redirect", "https://news.google.com/rss/articles/abc123", "news.google.com"],
  ["archive", "https://web.archive.org/web/2020/https://example.org/paper", "archive.org"],
  ["leak_site", "http://example.onion/leak", ".onion"],
  ["scan_query", "https://shodan.io/search?query=example", "shodan.io/search"],
  ["shadow_library", "https://sci-hub.se/10.1234/example", "sci-hub.se"],
];
/** The reasons of BLOCKED_HOSTS whose source URLs and correction source URLs belong to SOURCE_URL (SPEC §4.12). */
const SOURCE_URL_REASONS = ["redirect", "archive"];

/** Each secret pattern's name and a sample joined from pieces. */
const SECRETS: readonly [name: string, sample: string][] = [
  ["an AWS access key id", join("AK", "IA", "UTSAMPLE", "00000000")],
  ["an AWS access key id", join("AS", "IA", "UTSAMPLE", "00000000")],
  ["a GitHub token", join("gh", "p_", "UTSAMPLE".repeat(5))],
  ["a GitHub fine-grained token", join("github", "_pat_", "UTSAMPLE".repeat(3))],
  ["a Slack token", join("xo", "xb-", "UTSAMPLE-0000")],
  ["a Google API key", join("AI", "za", "UTSAMPLE".repeat(4), "000")],
  ["an sk- secret key", join("sk", "-", "UTSAMPLE".repeat(3))],
  ["a prefixed sk- secret key", join("sk-", "ant-", "api03-", "UTSAMPLE-".repeat(3))],
  ["a prefixed sk- secret key", join("sk-", "proj-", "UTSAMPLE_".repeat(3))],
  ["a Stripe live key", join("sk", "_live_", "UTSAMPLE".repeat(3))],
  ["a private key block", join("-----BEGIN ", "PRIVATE", " KEY-----")],
];
const SECRET = SECRETS[0]![1];

// ── The rules, the draft world and the places a string can sit ───────────────────────────────────

const rule = (code: string): Rule => safetyRules.find((r) => r.codes[0] === code)!;
/** The issue at `path`, whatever the order of the run's issues. */
const at = (issues: readonly ValidationIssue[], path_: string): ValidationIssue => {
  const found = issues.filter((i) => i.path === path_);
  if (found.length !== 1) throw new Error(`${found.length} issues at ${path_}`);
  return found[0]!;
};
// The engine's order of issues is the frame's business (tests/rules-frame.test.ts); these two read a run's issues in code-unit order.
const paths = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => i.path).sort();
const where = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.path}`).sort();

type Edit = (d: Json) => void;

/** The Tuesday draft with `edit` applied to its JSON, judged by `rules` (the whole group unless given). */
function draftIssues(edit: Edit = () => {}, over: Partial<DraftInputs> = {}, rules: readonly Rule[] = safetyRules): ValidationIssue[] {
  const d = structuredClone(weekdayDraft()) as Json;
  edit(d);
  return runRules(buildDraftInput(DraftBrief.parse(d), { ...draftInputs(), ...over }), rules);
}

/** The draft's issues of one code, from that code's own rule. */
const draftOf = (code: string, edit: Edit = () => {}, over: Partial<DraftInputs> = {}): ValidationIssue[] =>
  draftIssues(edit, over, [rule(code)]).filter((i) => i.code === code);

/** The Tuesday input as built, for a test that changes its inventory by hand (an id cannot hold text through the schemas). */
const baseInput = (): RuleInput => buildDraftInput(weekdayDraft(), draftInputs());

/** `input` with the text of the entry at `path` replaced. */
function withText(input: RuleInput, path_: string, text: string): RuleInput {
  if (!input.inventory.entries.some((e) => e.path === path_)) throw new Error(`no entry at ${path_}`);
  const entries = input.inventory.entries.map((e) => (e.path === path_ ? { ...e, text } : e));
  return { ...input, inventory: { ...input.inventory, entries } } as RuleInput;
}

const FIGURE = { source_id: "s1", image_url: "https://example.org/figure.png", licence: "CC-BY-4.0", licence_quote: "Licensed under CC BY 4.0.", credit: "Figure 1 from a made-up paper", alt: "A made-up chart." };
const f0 = (d: Json): Json => d.new_findings[0];
const figure = (d: Json): Json => (f0(d).figure ??= structuredClone(FIGURE));
const dive = (d: Json): Json => (d.deep_dive ??= { finding_id: "math-2026-0002", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "rotation" });
const review = (d: Json): Json => (d.review ??= {
  big_picture: "A made-up big picture.", remarkable: { finding_id: "math-2026-0002", note: "A made-up note." },
  strongest_against: { text: "None found this week.", finding_ids: [], source_ids: [] },
});

/** A string of the draft: what it is, its issue path, whether it holds text, an address or a DOI, and how to write into it. */
interface Place {
  readonly name: string;
  readonly path: string;
  readonly kind: "text" | "url" | "doi";
  /** True for a string of the first new finding, a biology finding. */
  readonly finding: boolean;
  readonly set: (d: Json, text: string) => void;
}

const place = (name: string, path_: string, set: (d: Json, text: string) => void, kind: Place["kind"] = "text"): Place =>
  ({ name, path: path_, kind, finding: path_.startsWith("new_findings[0]."), set });

/** What a place can hold: an address holds `https://example.org/` and the text, a DOI the prefix and the text in lower case. */
const planted = (p: Place, text: string): string => (p.kind === "url" ? `https://example.org/${text}` : p.kind === "doi" ? `10.1234/${text.toLowerCase()}` : text);

const PLACES: readonly Place[] = [
  place("the Lead", "lead[0].text", (d, t) => { d.lead[0].text = t; }),
  place("a returning update", "returning[0].update", (d, t) => { d.returning[0].update = t; }),
  place("a returning rung note", "returning[0].rung.note", (d, t) => { d.returning[0].rung.note = t; }),
  place("a rung change note", "rung_changes[0].rung.note", (d, t) => { d.rung_changes[0].rung.note = t; }),
  place("an idea", "ideas[0].text", (d, t) => { d.ideas[0].text = t; }),
  place("an idea's author", "ideas[0].who", (d, t) => { d.ideas[0].who = t; }),
  place("an Also noted title", "also[0].title", (d, t) => { d.also[0].title = t; }),
  place("the deep dive", "deep_dive.text", (d, t) => { dive(d).text = t; }),
  place("the big picture", "review.big_picture", (d, t) => { review(d).big_picture = t; }),
  place("the remarkable note", "review.remarkable.note", (d, t) => { review(d).remarkable.note = t; }),
  place("the strongest evidence against", "review.strongest_against.text", (d, t) => { review(d).strongest_against.text = t; }),
  place("a correction's reason", "corrections[0].reason", (d, t) => { d.corrections[0].reason = t; }),
  place("a correction's after", "corrections[3].after", (d, t) => {
    d.corrections[3] = { finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "clarification", path: "explainer.found", after: t, reason: "The text was unclear.", source_url: null, report_id: null };
  }),
  place("a correction's source", "corrections[0].source_url", (d, t) => { d.corrections[0].source_url = t; }, "url"),
  place("a report decision's reason", "report_decisions[0].reason", (d, t) => { d.report_decisions[0].reason = t; }),
  place("a brief source's title", "sources[0].title", (d, t) => { d.sources[0].title = t; }),
  place("a brief source's publisher", "sources[0].publisher", (d, t) => { d.sources[0].publisher = t; }),
  place("a brief source's address", "sources[0].url", (d, t) => { d.sources[0].url = t; }, "url"),
  place("a finding's title", "new_findings[0].title", (d, t) => { f0(d).title = t; }),
  place("a finding's found", "new_findings[0].explainer.found", (d, t) => { f0(d).explainer.found = t; }),
  place("a finding's matters", "new_findings[0].explainer.matters", (d, t) => { f0(d).explainer.matters = t; }),
  place("a finding's ai_helped", "new_findings[0].explainer.ai_helped", (d, t) => { f0(d).explainer.ai_helped = t; }),
  place("a finding's how_sure", "new_findings[0].explainer.how_sure", (d, t) => { f0(d).explainer.how_sure = t; }),
  place("a finding's background", "new_findings[0].explainer.background", (d, t) => { f0(d).explainer.background = t; }),
  place("a finding's could_lead", "new_findings[0].explainer.could_lead", (d, t) => { f0(d).explainer.could_lead = t; }),
  place("an AI system's name", "new_findings[0].ai.systems[0].name", (d, t) => { f0(d).ai.systems[0].name = t; }),
  place("an AI system's maker", "new_findings[0].ai.systems[0].maker", (d, t) => { f0(d).ai.systems[0].maker = t; }),
  place("an evidence quote", "new_findings[0].ai.evidence[0].quote", (d, t) => { f0(d).ai.evidence[0].quote = t; }),
  place("a finding's rung note", "new_findings[0].rung_history[0].note", (d, t) => { f0(d).rung_history[0].note = t; }),
  place("a finding source's title", "new_findings[0].sources[0].title", (d, t) => { f0(d).sources[0].title = t; }),
  place("a finding source's publisher", "new_findings[0].sources[0].publisher", (d, t) => { f0(d).sources[0].publisher = t; }),
  place("a finding source's address", "new_findings[0].sources[0].url", (d, t) => { f0(d).sources[0].url = t; }, "url"),
  place("a finding source's DOI", "new_findings[0].sources[0].doi", (d, t) => { f0(d).sources[0].doi = t; }, "doi"),
  place("a reaction's name", "new_findings[0].reactions[0].who", (d, t) => { f0(d).reactions[0].who = t; }),
  place("a reaction's affiliation", "new_findings[0].reactions[0].affiliation", (d, t) => { f0(d).reactions[0].affiliation = t; }),
  place("a reaction's quote", "new_findings[0].reactions[0].quote", (d, t) => { f0(d).reactions[0].quote = t; }),
  place("a DOI artefact", "new_findings[0].artefacts.doi[0]", (d, t) => { f0(d).artefacts.doi[0] = t; }, "doi"),
  place("a Lean artefact", "new_findings[0].artefacts.lean[0]", (d, t) => { f0(d).artefacts.lean[0] = t; }, "url"),
  place("a figure's alt text", "new_findings[0].figure.alt", (d, t) => { figure(d).alt = t; }),
  place("a figure's credit", "new_findings[0].figure.credit", (d, t) => { figure(d).credit = t; }),
  place("a figure's licence quote", "new_findings[0].figure.licence_quote", (d, t) => { figure(d).licence_quote = t; }),
  place("a figure's address", "new_findings[0].figure.image_url", (d, t) => { figure(d).image_url = t; }, "url"),
  place("a who entry's name", "new_findings[0].who[0].name", (d, t) => { f0(d).who[0].name = t; }),
  place("a new term's name", "new_findings[0].terms[0].term", (d, t) => { f0(d).terms[0].term = t; }),
  place("a new term's definition", "new_findings[0].terms[0].definition", (d, t) => { f0(d).terms[0].definition = t; }),
];

/** The places that hold text, not an address or a DOI. */
const TEXT_PLACES = PLACES.filter((p) => p.kind === "text");
const FINDING_PLACES = TEXT_PLACES.filter((p) => p.finding);

// ── The registry ─────────────────────────────────────────────────────────────────────────────────

describe("the safety group", () => {
  it("is four rules, one for each code of the group, in the table's order, each an error", () => {
    expect(safetyRules.map((r) => r.codes)).toEqual([["DUAL_USE"], ["SECRET_LIKE"], ["CANARY"], ["BLOCKED_HOST"]]);
    expect(safetyRules.map((r) => r.codes[0])).toEqual(codesOfGroup("safety"));
    for (const r of safetyRules) expect(r.severity, r.codes[0]).toBe("error");
  });

  it("is the group the registry holds for the safety rules", () => {
    expect(RULE_GROUPS.find((g) => g.group === "safety")!.rules).toBe(safetyRules);
  });

  it("runs each rule in the modes of its code in the rule table: all four in every mode, the Chinese draft's included", () => {
    for (const r of safetyRules) {
      const info = RULE_CODE_TABLE.find((row) => row.code === r.codes[0])!;
      expect([...r.scope].sort(), r.codes[0]).toEqual([...info.scopes].sort());
    }
    expect(Object.fromEntries(safetyRules.map((r) => [r.codes[0], r.scope]))).toEqual({
      DUAL_USE: ["draft", "published", "zh"], SECRET_LIKE: ["draft", "published", "zh"], CANARY: ["draft", "published", "zh"], BLOCKED_HOST: ["draft", "published", "zh"],
    });
  });

  it("reads no run input: no rule needs or uses one, and a draft run with no evidence, metrics or pack reports no INPUT_MISSING", () => {
    for (const r of safetyRules) expect([r.needs, r.uses], r.codes[0]).toEqual([[], []]);
    const bare = buildDraftInput(weekdayDraft(), { context: draftInputs().context, config: config() });
    expect(runRules(bare, safetyRules)).toEqual([]);
  });

  it("finds nothing in the frame's Tuesday draft or its stored edition", () => {
    expect(draftIssues()).toEqual([]);
    const w = storedWorld();
    expect(runRules(buildPublishedInput(w.brief, w, { config: w.config, publishing: D }), safetyRules)).toEqual([]);
  });

  it.each(EDITION_NAMES.map((name) => [name]))("finds nothing in the %s sample draft", (name) => {
    const draft = DraftBrief.parse(editionDraft(name));
    expect(runRules(buildDraftInput(draft, sampleInputs(name)), safetyRules)).toEqual([]);
  });

  it("is a pure function of its input: a frozen input is read without a write, and a second run gives the same issues", () => {
    const planted_ = draftIssues((d) => { d.lead[0].text = `${NUC} ${SECRET} ${CANARY_TOKEN} ${BLOCKED[0]![1]}`; });
    expect(planted_.map((i) => i.code).sort()).toEqual(["BLOCKED_HOST", "CANARY", "DUAL_USE", "SECRET_LIKE"]);
    const d = structuredClone(weekdayDraft()) as Json;
    d.lead[0].text = `${NUC} ${SECRET} ${CANARY_TOKEN} ${BLOCKED[0]![1]}`;
    const { config: cfg, ...rest } = buildDraftInput(DraftBrief.parse(d), draftInputs());
    deepFreeze(rest);
    const frozen = { ...rest, config: cfg } as RuleInput;
    expect(runRules(frozen, safetyRules)).toEqual(planted_);
    expect(runRules(frozen, safetyRules)).toEqual(planted_);
  });

  it("holds no secret-shaped literal in its own source or in this test's", () => {
    for (const file of ["lib/rules/safety.ts", "tests/rules-safety.test.ts"]) {
      expect(secretsIn(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")), file).toEqual([]);
    }
  });
});

// ── SECRET_LIKE ──────────────────────────────────────────────────────────────────────────────────

describe("SECRET_LIKE", () => {
  it("has a sample for each of its nine patterns, and each sample is named by its own pattern alone", () => {
    expect(SECRET_PATTERNS).toHaveLength(9);
    expect(new Set(SECRETS.map(([name]) => name))).toEqual(new Set(SECRET_PATTERNS.map((p) => p.name)));
    for (const [name, sample] of SECRETS) expect(secretsIn(`SAMPLE text ${sample} here`), name).toEqual([name]);
  });

  it("passes ordinary text, a slug that starts with sk- and a near miss of each pattern", () => {
    expect(secretsIn("ask-me-anything and AKIA are words; risk-based triage")).toEqual([]);
    expect(secretsIn("inc-sk-telecom-usim-breach-2026-10 and sk-telecom-says-customers-were-notified")).toEqual([]);
    const near = [
      join("AK", "IA", "UTSAMPLE", "0000000"), // 15 after the prefix, one short
      join("gh", "p_", "UTSAMPLE".repeat(4), "000"), // 35, one short
      join("gh", "x_", "UTSAMPLE".repeat(5)), // not one of p, o, u, s, r
      join("github", "_pat_", "UTSAMPLE".repeat(2), "000"), // 19, one short
      join("xo", "xb-", "UTSAMPLE", "0"), // 9, one short
      join("xo", "xc-", "UTSAMPLE", "00"), // not one of a, b, p, r, s
      join("AI", "za", "UTSAMPLE".repeat(4), "00"), // 34, one short
      join("sk", "-", "UTSAMPLE".repeat(2), "000"), // 19, one short
      join("sk-", "ant-", "UTSAMPLE".repeat(2), "000"), // 19 after the prefix, one short
      join("sk-", "other-", "UTSAMPLE".repeat(3)), // not one of the four prefixes
      join("sk", "_live_", "UTSAMPLE".repeat(2), "000"), // 19, one short
      join("-----BEGIN ", "PRIVATE", " KEY"), // no closing dashes
      join("-----BEGIN ", "PUBLIC", " KEY-----"), // a public key
      join("ask", "-", "UTSAMPLE".repeat(3)), // a letter before sk-
      join("ask", "_live_", "UTSAMPLE".repeat(3)), // a letter before sk_live_
      join("pk", "_live_", "UTSAMPLE".repeat(3)), // not an rk or sk key
    ];
    for (const text of near) expect(secretsIn(text), text).toEqual([]);
  });

  it("matches the shortest key of each length rule and every letter of each character class", () => {
    expect(secretsIn(join("AK", "IA", "UTSAMPLE", "00000000"))).toEqual(["an AWS access key id"]);
    expect(secretsIn(join("gh", "p_", "UTSAMPLE".repeat(4), "0000"))).toEqual(["a GitHub token"]);
    for (const c of "pousr") expect(secretsIn(join("gh", `${c}_`, "UTSAMPLE".repeat(5))), c).toEqual(["a GitHub token"]);
    expect(secretsIn(join("github", "_pat_", "UTSAMPLE".repeat(2), "0000"))).toEqual(["a GitHub fine-grained token"]);
    expect(secretsIn(join("xo", "xs-", "UTSAMPLE", "00"))).toEqual(["a Slack token"]);
    for (const c of "abprs") expect(secretsIn(join("xo", `x${c}-`, "UTSAMPLE", "00")), c).toEqual(["a Slack token"]);
    expect(secretsIn(join("sk", "-", "UTSAMPLE".repeat(2), "0000"))).toEqual(["an sk- secret key"]);
    for (const prefix of ["ant", "proj", "svcacct", "admin"]) {
      expect(secretsIn(join("sk-", `${prefix}-`, "UTSAMPLE".repeat(2), "0000")), prefix).toEqual(["a prefixed sk- secret key"]);
    }
    for (const c of "rs") expect(secretsIn(join(`${c}k`, "_live_", "UTSAMPLE".repeat(2), "0000")), c).toEqual(["a Stripe live key"]);
  });

  /** Each pattern's body class: the shortest body, the marks that class holds besides digits and letters, and a mark that it does not. */
  const CLASSES: readonly { name: string; make: (body: string) => string; length: number; ok: string; bad: string }[] = [
    { name: "an AWS access key id", make: (b) => join("AK", "IA", b), length: 16, ok: "09AZ", bad: "az_-" },
    { name: "a GitHub token", make: (b) => join("gh", "p_", b), length: 36, ok: "09AZaz", bad: "_-" },
    { name: "a GitHub fine-grained token", make: (b) => join("github", "_pat_", b), length: 20, ok: "09AZaz_", bad: "-" },
    { name: "a Slack token", make: (b) => join("xo", "xb-", b), length: 10, ok: "09AZaz-", bad: "_" },
    { name: "a Google API key", make: (b) => join("AI", "za", b), length: 35, ok: "09AZaz_-", bad: "." },
    { name: "an sk- secret key", make: (b) => join("sk", "-", b), length: 20, ok: "09AZaz", bad: "_-" },
    { name: "a prefixed sk- secret key", make: (b) => join("sk-", "ant-", b), length: 20, ok: "09AZaz_-", bad: "." },
    { name: "a Stripe live key", make: (b) => join("sk", "_live_", b), length: 20, ok: "09AZaz", bad: "_" },
  ];

  it.each(CLASSES.map((c) => [c.name, c] as const))("reads a body of the ends of every class of %s, and not one of a mark the class lacks", (name, c) => {
    for (const mark of c.ok) expect(secretsIn(c.make(mark.repeat(c.length))), `${name} with ${mark}`).toEqual([name]);
    for (const mark of c.bad) expect(secretsIn(c.make(mark.repeat(c.length))), `${name} with ${mark}`).toEqual([]);
  });

  it.each(CLASSES.filter((c) => ["an sk- secret key", "a prefixed sk- secret key", "a Stripe live key"].includes(c.name)).map((c) => [c.name, c] as const))(
    "reads %s after a mark, and not after a digit or a letter, whose ends are tried",
    (name, c) => {
      const key = c.make("UTSAMPLE".repeat(3));
      for (const before of "09AZaz") expect(secretsIn(`${before}${key}`), `${name} after ${before}`).toEqual([]);
      for (const before of "_-. :/(") expect(secretsIn(`${before}${key}`), `${name} after ${before}`).toEqual([name]);
    },
  );

  it.each(SECRETS)("fails %s in a string, names the path and the pattern and never shows the match", (name, sample) => {
    const found = draftOf("SECRET_LIKE", (d) => { d.lead[0].text = `A made-up sentence with ${sample} in it.`; });
    expect(where(found)).toEqual(["error lead[0].text"]);
    const [issue] = found;
    expect(issue!.message).toContain(name);
    expect(issue!.message).toContain("lead[0].text");
    expect(issue!.message).not.toContain(sample);
    expect(issue!.hint ?? "").not.toBe("");
  });

  it("names every pattern a string matches, once, in the order of the list", () => {
    const text = `${SECRETS[2]![1]} and ${SECRETS[0]![1]} and ${SECRETS[10]![1]}`;
    const [issue] = draftOf("SECRET_LIKE", (d) => { d.lead[0].text = text; });
    expect(issue!.message).toContain("an AWS access key id, a GitHub token, a private key block");
  });

  it.each(PLACES.filter((p) => p.kind !== "doi").map((p) => [p.name, p] as const))("reads %s", (_name, p) => {
    expect(where(draftOf("SECRET_LIKE", (d) => p.set(d, planted(p, SECRET))))).toEqual([`error ${p.path}`]);
  });

  it("reads the ids and vocabulary values too, which no schema lets a draft fill with text", () => {
    const hit = withText(baseInput(), "date", SECRET);
    expect(where(runRules(hit, [rule("SECRET_LIKE")]))).toEqual(["error date"]);
    expect(runRules(withText(baseInput(), "lead[0].refs[0]", SECRET), [rule("SECRET_LIKE")])).toHaveLength(1);
  });

  it("is one issue for each string, whatever the strings hold", () => {
    const found = draftOf("SECRET_LIKE", (d) => { d.lead[0].text = SECRET; d.lead[1].text = SECRETS[2]![1]; d.also[0].title = `${SECRET} ${SECRET}`; });
    expect(paths(found)).toEqual(["also[0].title", "lead[0].text", "lead[1].text"]);
  });

  it("is an error in every mode: on the records being published and on every other record too", () => {
    expect(ARCHIVE_WARNING_CODES).toEqual(expect.arrayContaining(["DUAL_USE", "BLOCKED_HOST"]));
    expect(ARCHIVE_WARNING_CODES).not.toContain("SECRET_LIKE");
    expect(ARCHIVE_WARNING_CODES).not.toContain("CANARY");
  });
});

// ── CANARY ───────────────────────────────────────────────────────────────────────────────────────

describe("CANARY", () => {
  it("holds the planted token in any case, anywhere in a string", () => {
    for (const text of [CANARY_TOKEN, CANARY_TOKEN.toLowerCase(), CANARY_TOKEN.toUpperCase(), `before ${CANARY_TOKEN} after`, `x${CANARY_TOKEN}x`]) {
      expect(holdsCanary(text), text).toBe(true);
    }
    expect(CANARY_TOKEN).toBe(CANARY_TOKEN.toUpperCase());
  });

  it("passes near misses, the empty string and the canary's address alone", () => {
    for (const text of [
      "", "UT-CANARY", CANARY_TOKEN.slice(0, -1), CANARY_TOKEN.slice(1), CANARY_TOKEN.replace("AMBER", "AMBRE"), CANARY_TOKEN.replace("5B1E8D40", "5B1E8D41"),
      `${CANARY_URL_PREFIX}abc`, `${CANARY_URL_PREFIX}${CANARY_TOKEN.slice(0, 10)}`,
    ]) {
      expect(holdsCanary(text), text).toBe(false);
    }
  });

  it.each(PLACES.map((p) => [p.name, p] as const))("fails the token in %s, naming the path", (_name, p) => {
    const found = draftOf("CANARY", (d) => p.set(d, planted(p, CANARY_TOKEN)));
    expect(where(found)).toEqual([`error ${p.path}`]);
    expect(found[0]!.message).toContain(p.path);
    expect(found[0]!.message.toLowerCase()).toContain("canary");
    expect(found[0]!.message).not.toContain(CANARY_TOKEN);
    expect(found[0]!.hint ?? "").not.toBe("");
  });

  it("fails the token in lower case, and passes a draft that holds only the canary's address", () => {
    expect(where(draftOf("CANARY", (d) => { d.lead[0].text = `see ${CANARY_TOKEN.toLowerCase()}`; }))).toEqual(["error lead[0].text"]);
    expect(draftOf("CANARY", (d) => { d.lead[0].text = `see ${CANARY_URL_PREFIX}page`; })).toEqual([]);
  });

  it("reads the ids and vocabulary values too", () => {
    expect(where(runRules(withText(baseInput(), "date", CANARY_TOKEN), [rule("CANARY")]))).toEqual(["error date"]);
  });

  it("is one issue for each string that holds it", () => {
    const found = draftOf("CANARY", (d) => { d.lead[0].text = `${CANARY_TOKEN} ${CANARY_TOKEN}`; d.also[0].title = CANARY_TOKEN; });
    expect(paths(found)).toEqual(["also[0].title", "lead[0].text"]);
  });
});

// ── DUAL_USE: sequences ──────────────────────────────────────────────────────────────────────────

describe("DUAL_USE: nucleotide and amino-acid sequences", () => {
  const nuc = (letters: number) => ({ kind: "nucleotide", letters });
  const amino = (letters: number) => ({ kind: "amino-acid", letters });
  const GENPEPT = "        1 acdefghikl mnpqrstvwy acdefghikl";

  const FAIL: readonly [label: string, text: string, hits: object[]][] = [
    ["20 upper-case letters of ACGT", NUC, [nuc(20)]],
    ["20 lower-case letters", NUC.toLowerCase(), [nuc(20)]],
    ["20 letters in mixed case", "AcGt".repeat(5), [nuc(20)]],
    ["20 letters split by single spaces", [...NUC].join(" "), [nuc(20)]],
    ["five blocks of four", "ACGT ACGT ACGT ACGT ACGT", [nuc(20)]],
    ["U and N, which count as nucleotides", `${"ACGU".repeat(3)}NNNNNNNN`, [nuc(20)]],
    ["a run inside a longer word", `word${NUC}word`, [nuc(20)]],
    ["a run split by a line break", "ACGTACGTAC\nGTACGTACGT", [nuc(20)]],
    ["GenBank's layout: position numbers and indentation, lower case", "        1 acgtacgtac\n       11 gtacgtacgt", [nuc(20)]],
    ["GenBank's layout over three lines of blocks", "        1 acgtacgtac gtacgtacgt\n       21 acgtacgtac gtacgtacgt\n       41 acgtacgtac", [nuc(50)]],
    ["GenBank's layout with Windows line breaks", "   1 acgtacgtac\r\n  11 gtacgtacgt", [nuc(20)]],
    // a line of three blocks of ten that both kinds of pattern read: the letters are all of ACGTN, in any case, so the nucleotide hit stands for it
    ["GenBank's layout: a position number and three lower-case blocks, one nucleotide hit", "1 acgtacgtac gtacgtacgt acgtacgtac", [nuc(30)]],
    ["GenBank's layout: a position number and three blocks of mixed case, one nucleotide hit", "1 acgtacgtac GTACGTACGT acgtacgtac", [nuc(30)]],
    ["a run split by a lone carriage return, an old Mac line break", "ACGTACGTAC\rGTACGTACGT", [nuc(20)]],
    ["position numbers of one to four digits", "1 acgtacgtac\n999 gtacgtacgt\n1000 acgtac", [nuc(26)]],
    ["a line break and indentation without a number", "acgtacgtac\n   gtacgtacgt", [nuc(20)]],
    ["20 upper-case amino-acid codes in a row", AMINO, [amino(20)]],
    ["21 codes in a row", `${AMINO}Q`, [amino(21)]],
    ["40 codes in a row, once", AMINO + AMINO, [amino(40)]],
    ["a run of codes inside a longer word", `x${AMINO}x`, [amino(20)]],
    ["UniProt's blocks: two blocks of ten", "ACDEFGHIKL MNPQRSTVWY", [amino(20)]],
    ["UniProt's blocks: three blocks of ten", "ACDEFGHIKL MNPQRSTVWY ACDEFGHIKL", [amino(30)]],
    ["UniProt's blocks over a line break and indentation", "ACDEFGHIKL\n     MNPQRSTVWY", [amino(20)]],
    ["blocks over a line break without indentation", "ACDEFGHIKL\nMNPQRSTVWY", [amino(20)]],
    ["blocks over a Windows line break", "ACDEFGHIKL\r\nMNPQRSTVWY", [amino(20)]],
    ["blocks over a Windows line break and indentation", "ACDEFGHIKL\r\n     MNPQRSTVWY", [amino(20)]],
    ["blocks over an old Mac line break", "ACDEFGHIKL\rMNPQRSTVWY", [amino(20)]],
    ["GenPept's layout: a position number and three lower-case blocks", GENPEPT, [amino(30)]],
    ["GenPept's layout: four blocks and a line that holds one", "        1 acdefghikl mnpqrstvwy acdefghikl mnpqrstvwy\n       41 acdefghikl", [amino(40)]],
    ["GenPept's layout in upper case, which the two patterns read as one run", "1 ACDEFGHIKL MNPQRSTVWY ACDEFGHIKL", [amino(30)]],
    // The next eight rows were pins of the first reading, in which a double space, a tab or a blank line broke a run and blocks were of
    // exactly ten letters. STYLE.md section 9 forbids a sequence "in any case or layout", so the reading changed on purpose:
    // a run of white space is one separator, and blocks may be of any one width.
    ["a database line of the letters ACGTN whose blocks are split by two spaces: one run of 30 letters, as the nucleotide pattern reads it", "1 ACGTACGTAC  GTACGTACGT  ACGTACGTAC", [nuc(30)]],
    ["a database line of the letters ACGTN whose blocks are split by tabs: one run of 30 letters", "1\tACGTACGTAC\tGTACGTACGT\tACGTACGTAC", [nuc(30)]],
    ["a database line of the letters ACGTN with one space and then two: one run of 30 letters", "1 ACGTACGTAC GTACGTACGT  ACGTACGTAC", [nuc(30)]],
    ["a run that a double space no longer breaks", "ACGTACGTAC  GTACGTACGT", [nuc(20)]],
    ["a run that a tab no longer breaks", "ACGTACGTAC\tGTACGTACGT", [nuc(20)]],
    ["a run that a blank line no longer breaks", "ACGTACGTAC\n\nGTACGTACGT", [nuc(20)]],
    ["two blocks of eleven letters: blocks may be of any one width", "ACDEFGHIKLM NPQRSTVWYAC", [amino(22)]],
    ["two blocks of ten split by a double space", "ACDEFGHIKL  MNPQRSTVWY", [amino(20)]],
    ["a nucleotide run and an amino-acid run in one string, the nucleotide first", `${AMINO} and ${NUC}`, [nuc(20), amino(20)]],
    ["a nucleotide run beside an amino-acid run that is longer by one", `Hello ${AMINO}Q world ${NUC}AAAA`, [nuc(24), amino(21)]],
    ["a nucleotide run that goes on in letters of the amino-acid pattern alone: both hits, since only a run of ACGTN is the nucleotide hit", `${NUC}KLMPQ`, [nuc(20), amino(25)]],
  ];

  const PASS: readonly [label: string, text: string][] = [
    ["19 letters of ACGT", NUC.slice(0, 19)],
    ["19 letters split by single spaces", [...NUC.slice(0, 19)].join(" ")],
    ["19 amino-acid codes", AMINO.slice(0, 19)],
    ["a run that a number in the middle of a line breaks", "ACGTACGTAC 11 GTACGTACGT"],
    ["a block of nine and a block of ten", "ACDEFGHIK MNPQRSTVWY"],
    ["a block of eleven and a wider block of twelve: blocks of two widths are no run", "ACDEFGHIKLM NPQRSTVWYACD"],
    ["blocks with a letter glued before the first", "xACDEFGHIKL MNPQRSTVWY"],
    ["blocks with a letter glued after the last", "ACDEFGHIKL MNPQRSTVWYx"],
    ["two lower-case blocks, which are no database layout", "acdefghikl mnpqrstvwy"],
    ["three lower-case blocks with no position number", "acdefghikl mnpqrstvwy acdefghikl"],
    ["GenPept's layout with two blocks", "        1 acdefghikl mnpqrstvwy"],
    ["GenPept's layout with a block of nine", "1 acdefghikl mnpqrstvwy acdefghik"],
    ["GenPept's layout with the position number glued to the first block", "1acdefghikl mnpqrstvwy acdefghikl"],
    ["a position number that does not start the line", "x 1 acdefghikl mnpqrstvwy acdefghikl"],
    ["twenty letters of ordinary words across spaces, lower case", "this is a shift in the field"],
    ["the same words in sentence case", "This is a shift in the field"],
    ["one long German word", "Gesellschaftswissenschaften"],
    ["a sentence of short words", "a cat can act on a tuna"],
    ["a long sentence of ordinary prose", "An AI model found that the protein folds into a stable shape in cells."],
  ];

  it.each(FAIL)("finds %s", (_label, text, hits) => {
    expect(sequencesIn(text)).toEqual(hits);
  });

  it.each(PASS)("passes %s", (_label, text) => {
    expect(sequencesIn(text)).toEqual([]);
  });

  it("reports a run of ACGTUN letters as a nucleotide sequence alone, never also as an amino-acid one", () => {
    expect(sequencesIn("ACGTN".repeat(4))).toEqual([nuc(20)]);
    expect(sequencesIn("ACGTACGTAC GTACGTACGT")).toEqual([nuc(20)]);
  });

  it("fails a sequence in each place a string can sit, naming the place, the kind and the length and never the letters", () => {
    for (const p of PLACES) {
      const found = draftOf("DUAL_USE", (d) => p.set(d, planted(p, NUC)));
      expect(where(found), p.name).toEqual([`error ${p.path}`]);
      expect(found[0]!.message, p.name).toContain("a nucleotide sequence of 20 letters");
      expect(found[0]!.message, p.name).toContain(p.path);
      expect(found[0]!.message, p.name).not.toMatch(/ACGT/i);
      expect(found[0]!.hint ?? "", p.name).toContain("STYLE.md section 9");
    }
  });

  it("names an amino-acid sequence, and both when a string holds both, in one issue", () => {
    const one = draftOf("DUAL_USE", (d) => { d.lead[0].text = AMINO; });
    expect(one.map((i) => i.message)).toEqual([expect.stringContaining("an amino-acid sequence of 20 letters")]);
    const both = draftOf("DUAL_USE", (d) => { d.lead[0].text = `${NUC} / ${AMINO}`; });
    expect(both).toHaveLength(1);
    expect(both[0]!.message).toContain("a nucleotide sequence of 20 letters, an amino-acid sequence of 20 letters");
  });

  it("names the first four hits of a string and counts the rest, so a string of hundreds of runs still gives a short message", () => {
    const named = (runs: number): string => draftOf("DUAL_USE", (d) => { d.lead[0].text = Array(runs).fill(NUC).join(" / "); })[0]!.message;
    const one = "a nucleotide sequence of 20 letters";
    expect(named(4)).toContain(`holds ${one}, ${one}, ${one}, ${one}. Describe`);
    expect(named(5)).toContain(`holds ${one}, ${one}, ${one}, ${one}, and 1 more. Describe`);
    expect(named(7)).toContain(`holds ${one}, ${one}, ${one}, ${one}, and 3 more. Describe`);
    expect(named(500).length).toBeLessThan(600);
  });

  it("passes a draft whose strings hold only ordinary words that spell twenty such letters", () => {
    const found = draftOf("DUAL_USE", (d) => {
      d.lead[0].text = "This is a shift in the field.";
      d.also[0].title = "Gesellschaftswissenschaften";
      f0(d).explainer.found = "A cat can act on a tuna.";
    });
    expect(found).toEqual([]);
  });

  it("reads strings, not ids or vocabulary values", () => {
    expect(runRules(withText(baseInput(), "date", NUC), [rule("DUAL_USE")])).toEqual([]);
    expect(where(runRules(withText(baseInput(), "lead[0].text", NUC), [rule("DUAL_USE")]))).toEqual(["error lead[0].text"]);
  });

  // ── A sequence in any layout ──
  // STYLE.md section 9 forbids a run "in any case or layout". Page text never holds an odd layout: the sanitiser (lib/sanitize.ts) makes each run
  // of white space one space and strips the invisible characters. Only a model's own output can, so these are the layouts a draft can hold. Each
  // character is built from its code point, so that none is typed in this file.
  describe("in any layout", () => {
    const head = NUC.slice(0, 10);
    const tail = NUC.slice(10);
    const aminoHead = AMINO.slice(0, 10);
    const aminoTail = AMINO.slice(10);

    /** The blanks inside one line that a layout can hold. */
    const LINE_BLANKS: readonly [name: string, text: string][] = [
      ["a double space", "  "], ["a tab", "\t"], ["two tabs and a space", "\t \t"],
      ["a no-break space", NO_BREAK_SPACE], ["an ogham space mark", chars(0x1680)], ["an en quad", chars(0x2000)], ["a thin space", chars(0x2009)],
      ["a hair space", chars(0x200a)], ["a narrow no-break space", chars(0x202f)], ["a medium mathematical space", chars(0x205f)],
      ["an ideographic space", chars(0x3000)], ["a mix of blanks", ` \t${NO_BREAK_SPACE} ${chars(0x3000)}\t`],
    ];
    /** Each kind of line break, and runs of them. */
    const LINE_BREAKS: readonly [name: string, text: string][] = [
      ["a line feed", "\n"], ["a carriage return", "\r"], ["a Windows line break", "\r\n"], ["a vertical tab", "\v"], ["a form feed", "\f"],
      ["a next-line control", chars(0x85)], ["a line separator", LINE_SEPARATOR], ["a paragraph separator", chars(0x2029)],
      ["a blank line", "\n\n"], ["a blank line of Windows breaks", "\r\n\r\n"], ["a line break and an indentation", `\n${NO_BREAK_SPACE}  \t`],
    ];
    /** Characters that a reader does not see, and that the sanitiser strips from page text. */
    const INVISIBLES: readonly [name: string, text: string][] = [
      ["a zero-width space", ZERO_WIDTH_SPACE], ["a zero-width non-joiner", chars(0x200c)], ["a zero-width joiner", chars(0x200d)],
      ["a word joiner", chars(0x2060)], ["a byte order mark", chars(0xfeff)], ["a soft hyphen", chars(0xad)],
      ["a left-to-right mark", chars(0x200e)], ["a right-to-left mark", chars(0x200f)], ["a Mongolian vowel separator", chars(0x180e)],
      ["a control", chars(0x1)], ["a null", chars(0)], ["a delete", chars(0x7f)], ["a variation selector", chars(0xfe0f)],
      // the characters outside the default-ignorable property that the sanitiser strips too (F-61)
      ["a Braille blank", chars(0x2800)], ["an object replacement character", chars(0xfffc)], ["an Arabic number sign", chars(0x600)],
      ["an interlinear annotation anchor", chars(0xfff9)], ["a hieroglyph format control", String.fromCodePoint(0x13430)],
    ];
    const SEPARATORS = [...LINE_BLANKS, ...LINE_BREAKS, ...INVISIBLES];

    it.each(SEPARATORS)("reads a nucleotide run across %s, one or several, as one run", (_name, blank) => {
      expect(sequencesIn(`${head}${blank}${tail}`)).toEqual([nuc(20)]);
      expect(sequencesIn(`${head}${blank.repeat(3)}${tail}`)).toEqual([nuc(20)]);
      const low = (text: string): string => text.toLowerCase();
      expect(sequencesIn(`${low(head)}${blank}${low(tail)}${blank}${low(head)}`)).toEqual([nuc(30)]);
    });

    it.each(SEPARATORS)("reads two blocks of ten amino-acid capitals across %s", (_name, blank) => {
      expect(sequencesIn(`${aminoHead}${blank}${aminoTail}`)).toEqual([amino(20)]);
      expect(sequencesIn(`${aminoHead}${blank.repeat(3)}${aminoTail}`)).toEqual([amino(20)]);
    });

    it("reads every character of Unicode's White_Space property as a separator and every character the sanitiser strips as none", () => {
      // the two classes are real: 25 spaces, and a few thousand invisible characters (the tag characters and variation selectors among them)
      expect(WHITE_SPACE_CHARS.length).toBeGreaterThanOrEqual(25);
      expect(INVISIBLE_CHARS.length).toBeGreaterThan(1000);
      for (const c of [...WHITE_SPACE_CHARS, ...INVISIBLE_CHARS]) {
        expect(sequencesIn(`${head}${c}${tail}`), hex(c)).toEqual([nuc(20)]);
        expect(sequencesIn(`${aminoHead}${c}${aminoTail}`), hex(c)).toEqual([amino(20)]);
      }
    });

    it("reads invisible characters inside a block, between the letters of a row and around a run, as no character", () => {
      expect(sequencesIn([...NUC].join(ZERO_WIDTH_SPACE))).toEqual([nuc(20)]);
      expect(sequencesIn([...AMINO].join(ZERO_WIDTH_SPACE))).toEqual([amino(20)]);
      expect(sequencesIn(`${ZERO_WIDTH_SPACE}${NUC}${ZERO_WIDTH_SPACE}`)).toEqual([nuc(20)]);
      // an invisible character next to a blank is part of that one separator, and does not make a second
      expect(sequencesIn(`${head} ${ZERO_WIDTH_SPACE} ${tail}`)).toEqual([nuc(20)]);
      expect(sequencesIn(`${head.slice(0, 5)}${ZERO_WIDTH_SPACE}${NO_BREAK_SPACE}${head.slice(5)}\t${tail}`)).toEqual([nuc(20)]);
      // an invisible character is not a space: it splits no row into blocks, whatever the widths of the pieces it leaves
      expect(sequencesIn(`${AMINO.slice(0, 4)}${ZERO_WIDTH_SPACE}${AMINO.slice(4)}`)).toEqual([amino(20)]);
      expect(sequencesIn(`${AMINO.slice(0, 1)}${ZERO_WIDTH_SPACE}${AMINO.slice(1)}`)).toEqual([amino(20)]);
    });

    it.each(LINE_BLANKS)("reads a GenBank layout whose indentation and position numbers are split from the letters by %s", (_name, blank) => {
      const lines = [`${blank}1${blank}acgtacgtac`, `${blank}11${blank}gtacgtacgt`];
      expect(sequencesIn(lines.join("\n"))).toEqual([nuc(20)]);
      expect(sequencesIn(lines.join("\r\n"))).toEqual([nuc(20)]);
      expect(sequencesIn(lines.join(LINE_SEPARATOR))).toEqual([nuc(20)]);
    });

    it("reads a position number of any length, in any script's digits", () => {
      for (const number of ["1", "1234", "123456789", chars(0xff11, 0xff12), chars(0x661, 0x662)]) {
        expect(sequencesIn(`${number} acgtacgtac\n${number} gtacgtacgt`), number).toEqual([nuc(20)]);
        expect(sequencesIn(`${number} acdefghikl mnpqrstvwy acdefghikl`), number).toEqual([amino(30)]);
      }
    });

    it.each(LINE_BLANKS)("reads a run across lines that end in %s", (_name, blank) => {
      expect(sequencesIn(`acgtacgtac${blank}\ngtacgtacgt`)).toEqual([nuc(20)]);
      expect(sequencesIn(`acgtacgtac${blank}\r\ngtacgtacgt${blank}`)).toEqual([nuc(20)]);
    });

    const BULLETS: readonly [name: string, mark: string][] = [
      ["a hyphen", "-"], ["an asterisk", "*"], ["a plus sign", "+"], ["a middle dot", chars(0xb7)], ["a hyphen character", chars(0x2010)],
      ["a non-breaking hyphen", chars(0x2011)], ["a figure dash", chars(0x2012)], ["an en dash", chars(0x2013)], ["an em dash", chars(0x2014)],
      ["a horizontal bar", chars(0x2015)], ["a bullet", BULLET_CHAR], ["a triangular bullet", chars(0x2023)], ["a small black square", chars(0x25aa)],
      ["a white bullet", chars(0x25e6)],
    ];

    it.each(BULLETS)("reads a sequence over lines that start with %s, with or without a position number", (_name, mark) => {
      expect(sequencesIn(`${mark} acgtacgtac\n${mark} gtacgtacgt`)).toEqual([nuc(20)]);
      expect(sequencesIn(`${mark} 1 acgtacgtac\n${mark} 11 gtacgtacgt`)).toEqual([nuc(20)]);
      expect(sequencesIn(`  ${mark}  1  acdefghikl mnpqrstvwy acdefghikl`)).toEqual([amino(30)]);
      expect(sequencesIn(`${mark} ACDEFGHIKL\n${mark} MNPQRSTVWY`)).toEqual([amino(20)]);
    });

    it("reads a bullet or a position number only at the start of a line, and a hyphen with no blank after it is no bullet", () => {
      expect(sequencesIn("acgtacgtac - gtacgtacgt")).toEqual([]);
      expect(sequencesIn("acgtacgtac\n-gtacgtacgt")).toEqual([]);
      expect(sequencesIn("acgtacgtac\n1gtacgtacgt")).toEqual([]);
      expect(sequencesIn("acgtacgtac 11 gtacgtacgt")).toEqual([]);
      expect(sequencesIn("acgtacgtac\n- 11 - gtacgtacgt")).toEqual([]);
    });

    it.each(LINE_BLANKS)("reads a database line whose blocks are split by %s, and still needs three blocks of exactly ten letters", (_name, blank) => {
      const line = (...blocks: string[]): string => `1${blank}${blocks.join(blank)}`;
      expect(sequencesIn(line("acdefghikl", "mnpqrstvwy", "acdefghikl"))).toEqual([amino(30)]);
      expect(sequencesIn(line("acdefghikl", "mnpqrstvwy", "acdefghikl", "acd"))).toEqual([amino(30)]);
      expect(sequencesIn(line("acdefghikl", "mnpqrstvwy"))).toEqual([]);
      expect(sequencesIn(line("acdefghikl", "mnpqrstvwy", "acdefghik"))).toEqual([]);
      expect(sequencesIn(line("acdefghikl", "mnpqrstvwy", "acdefghiklm"))).toEqual([]);
      expect(sequencesIn(`x${line("acdefghikl", "mnpqrstvwy", "acdefghikl")}`)).toEqual([]);
    });

    it("reads a database line only when the line starts with its position number: after an indentation, a bullet or both", () => {
      expect(sequencesIn(`${NO_BREAK_SPACE}${NO_BREAK_SPACE}1 acdefghikl mnpqrstvwy acdefghikl`)).toEqual([amino(30)]);
      expect(sequencesIn(`${BULLET_CHAR} 1 acdefghikl mnpqrstvwy acdefghikl`)).toEqual([amino(30)]);
      expect(sequencesIn("acdefghikl mnpqrstvwy acdefghikl")).toEqual([]);
      // the three blocks are the first thing after the position number: a word before them makes the line no database line
      expect(sequencesIn("1 note acdefghikl mnpqrstvwy acdefghikl")).toEqual([]);
      expect(sequencesIn("1 acdefghikl mnpqrstvwy acdefghikl")).toEqual([amino(30)]);
      // the blocks of a line that a line break splits are two lines, and only the first starts with a number
      expect(sequencesIn("1 acdefghikl mnpqrstvwy\nacdefghikl")).toEqual([]);
    });

    it("reads a database line after other lines, and a row that starts right after a database line's blocks as a hit of its own", () => {
      expect(sequencesIn("SAMPLE: a note\n        1 acdefghikl mnpqrstvwy acdefghikl")).toEqual([amino(30)]);
      expect(sequencesIn("note\nmore note\n1 acdefghikl mnpqrstvwy acdefghikl")).toEqual([amino(30)]);
      expect(sequencesIn("ends in letters acgt\n1 acdefghikl mnpqrstvwy acdefghikl")).toEqual([amino(30)]);
      expect(sequencesIn("1 acdefghikl mnpqrstvwy acdefghikl\n31 acdefghikl mnpqrstvwy acdefghikl")).toEqual([amino(30), amino(30)]);
      expect(sequencesIn(`1 acdefghikl mnpqrstvwy acdefghikl ${AMINO}`)).toEqual([amino(30), amino(20)]);
    });

    // A run of capital words that are all of one width, the last perhaps shorter, with 20 letters or more in all: any width at all.
    const lettersOf = (count: number): string => AMINO.repeat(Math.ceil(count / AMINO.length)).slice(0, count);
    const blocksOf = (width: number, count: number): string => lettersOf(count).match(new RegExp(`.{1,${width}}`, "gu"))!.join(" ");

    it.each(Array.from({ length: 25 }, (_, i) => [i + 1] as const))("reads capital blocks of %i letters as a run from twenty letters, and not before", (width) => {
      expect(sequencesIn(blocksOf(width, 20))).toEqual([amino(20)]);
      expect(sequencesIn(blocksOf(width, 41))).toEqual([amino(41)]);
      expect(sequencesIn(blocksOf(width, 19))).toEqual([]);
      expect(sequencesIn(blocksOf(width, 20).replace(/ /g, "\n"))).toEqual([amino(20)]);
      expect(sequencesIn(blocksOf(width, 20).replace(/ /g, NO_BREAK_SPACE))).toEqual([amino(20)]);
      expect(sequencesIn(blocksOf(width, 20).replace(/ /g, ZERO_WIDTH_SPACE + " "))).toEqual([amino(20)]);
    });

    it("reads capital blocks of one width after a position number, an indentation and a bullet", () => {
      expect(sequencesIn("        1 ACDEF GHIKL MNPQR STVWY")).toEqual([amino(20)]);
      expect(sequencesIn("       21 ACDEF GHIKL\n       31 MNPQR STVWY")).toEqual([amino(20)]);
      expect(sequencesIn(`${BULLET_CHAR} ACDEF GHIKL\n${BULLET_CHAR} MNPQR STVWY`)).toEqual([amino(20)]);
    });

    it("lets the last block be shorter and no other: a shorter block in the middle ends the run, and so does a wider one", () => {
      expect(sequencesIn("ACDEFGHIKL MNPQRSTVWY ACDE")).toEqual([amino(24)]);
      expect(sequencesIn("ACDEFGHIKL MNPQRSTVWY A")).toEqual([amino(21)]);
      expect(sequencesIn("ACDEFGHIKL MNPQ RSTVWYACDE")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL MNPQRSTVWY ACDEFGHIKLM")).toEqual([amino(20)]);
      expect(sequencesIn("ACDEFGHIKLM NPQRSTVWYACD")).toEqual([]);
      expect(sequencesIn("AC DEF GHIK LMNPQ RSTVWY")).toEqual([]);
      expect(sequencesIn("RSTVWY LMNPQ GHIK DEF AC")).toEqual([]);
    });

    it("ends a run of blocks at a word that is not of the alphabet, a letter case that is not capitals, or a mark that is not one space", () => {
      expect(sequencesIn("ACDEFGHIKL MNPQRSTVWB ACDEFGHIKL")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL BMNPQRSTVW")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL bMNPQRSTVW")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL MNPQRSTVWb")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL Mnpqrstvwy ACDEFGHIKL")).toEqual([]);
      expect(sequencesIn("acdefghikl mnpqrstvwy")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL, MNPQRSTVWY")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL-MNPQRSTVWY")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL1MNPQRSTVWY")).toEqual([]);
      expect(sequencesIn("ACDEFGHIKL. MNPQRSTVWY")).toEqual([]);
      // two blocks that start a run, a break in it, and a second run that is long enough on its own
      expect(sequencesIn("ACDEFGHIKL MNPQRSTVWY, ACDEFGHIKL MNPQRSTVWY")).toEqual([amino(20), amino(20)]);
      // a run is one hit, whatever words follow it
      expect(sequencesIn(`${AMINO} of the cat`)).toEqual([amino(20)]);
      expect(sequencesIn("ACDEFGHIKL MNPQRSTVWY of the cat ACDE")).toEqual([amino(20)]);
    });

    it("reads the twenty codes written one by one as a sequence, the Latin alphabet and nineteen codes as none", () => {
      expect(sequencesIn([...AMINO].join(" "))).toEqual([amino(20)]);
      expect(sequencesIn([...AMINO].join("\n"))).toEqual([amino(20)]);
      expect(sequencesIn([...AMINO].join(NO_BREAK_SPACE))).toEqual([amino(20)]);
      expect(sequencesIn([...AMINO.slice(0, 19)].join(" "))).toEqual([]);
      // B, J, O, U, X and Z are no codes of the alphabet: each ends a run, so the Latin alphabet is no sequence
      expect(sequencesIn([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].join(" "))).toEqual([]);
      expect(sequencesIn("A C D E F G H I K L Z M N P Q R S T V W Y")).toEqual([]);
      expect(sequencesIn("a c d e f g h i k l m n p q r s t v w y")).toEqual([]);
      // the letters of DNA written one by one are the nucleotide pattern's, as ever
      expect(sequencesIn([...NUC].join(" "))).toEqual([nuc(20)]);
    });

    it("passes a sentence in capitals, which blocks of any width would read as a sequence, whose words are all of the alphabet's letters", () => {
      for (const text of [
        "THIS IS A SHIFT IN THE FIELD",
        "SHIFT THE FIELD IN THIS AIM AND SEE THE LIGHT",
        "THE LICENCE IS GIVEN AS IS WITH NO WARRANTY OF ANY KIND",
        "A CAT CAN ACT ON A TUNA",
      ]) {
        expect(sequencesIn(text), text).toEqual([]);
      }
    });

    // A limit of the reading, written down: capital words of one width cannot be told from blocks. Five of four letters are twenty.
    it("reads five capital words of four letters each, all of the alphabet's letters, as a run: the one cost of blocks of any width", () => {
      expect(sequencesIn("THAT WITH HAVE THEM THIS")).toEqual([amino(20)]);
      expect(sequencesIn("THAT WITH HAVE THEM")).toEqual([]);
      expect(sequencesIn("THAT WITH HAVE THEM THE")).toEqual([]);
    });

    it("fails a sequence in any layout in each place a string can sit, naming the place and the kind", () => {
      const nucleotide = `${head}${NO_BREAK_SPACE}\t${tail}`;
      const protein = `ACDEF${ZERO_WIDTH_SPACE} GHIKL${LINE_SEPARATOR}MNPQR  STVWY`;
      for (const p of TEXT_PLACES) {
        for (const [text, what] of [[nucleotide, "a nucleotide sequence of 20 letters"], [protein, "an amino-acid sequence of 20 letters"]] as const) {
          const found = draftOf("DUAL_USE", (d) => p.set(d, planted(p, text)));
          expect(where(found), `${p.name}: ${what}`).toEqual([`error ${p.path}`]);
          expect(found[0]!.message, `${p.name}: ${what}`).toContain(what);
        }
      }
    });
  });
});

// ── DUAL_USE: numbered steps ─────────────────────────────────────────────────────────────────────

describe("DUAL_USE: numbered steps", () => {
  const COUNT: readonly [label: string, text: string, markers: string[]][] = [
    ["1. and 2. in one line", "1. Mix the parts. 2. Heat them.", ["1.", "2."]],
    ["1. and 2. on two lines", "1. Mix the parts.\n2. Heat them.", ["1.", "2."]],
    ["1) and 2)", "1) Mix\n2) Heat", ["1)", "2)"]],
    ["(1) and (2)", "(1) Mix\n(2) Heat", ["(1)", "(2)"]],
    ["Step 1 and Step 2 in sentences", "Step 1 mix. Step 2 heat.", ["Step 1", "Step 2"]],
    ["step 1: and step 2: on lines, in lower case", "step 1: mix\nstep 2: heat", ["step 1", "step 2"]],
    ["STEP 1. and STEP 2. in upper case", "STEP 1. Mix. STEP 2. Heat.", ["STEP 1", "STEP 2"]],
    ["Step 12 and Step 13", "Step 12\nStep 13", ["Step 12", "Step 13"]],
    ["markers of two digits", "10. Ten\n11. Eleven", ["10.", "11."]],
    ["indented lines", "  1. Indented\n  2. Items", ["1.", "2."]],
    ["a blank line between items", "1. First\n\n2. Second", ["1.", "2."]],
    ["Windows line breaks", "1. First\r\n2. Second", ["1.", "2."]],
    ["Chinese steps with a numeral", "步驟一：混合。步驟二：加熱。", ["步驟一", "步驟二"]],
    ["Chinese steps with a digit and a space", "步驟 1：混合。步驟 2：加熱。", ["步驟 1", "步驟 2"]],
    ["Chinese steps with a digit", "步驟1：混合\n步驟2：加熱", ["步驟1", "步驟2"]],
    ["1、 and 2、 on two lines", "1、混合\n2、加熱", ["1、", "2、"]],
    ["（1） and （2） on two lines", "（1）混合\n（2）加熱", ["（1）", "（2）"]],
    ["only the items that start a line or a sentence, among other text", "He said 1. Then he left. 2. Then he came back.", ["2."]],
    ["a lone item, which is one marker and so no steps", "1. Only one item.", ["1."]],
    ["markers of three digits", "100. Hundred\n101. Next", ["100.", "101."]],
    ["(100) and (101), three digits in brackets", "(100) A\n(101) B", ["(100)", "(101)"]],
    ["Step 100 and Step 101", "Step 100\nStep 101", ["Step 100", "Step 101"]],
    ["100、 and 101、", "100、甲\n101、乙", ["100、", "101、"]],
    ["（100） and （101）", "（100）甲\n（101）乙", ["（100）", "（101）"]],
    ["步驟100 and 步驟101", "步驟100：甲\n步驟101：乙", ["步驟100", "步驟101"]],
    ["Chinese numerals of several characters", "步驟十二：甲\n步驟一百零三：乙", ["步驟十二", "步驟一百零三"]],
    ["the forms mixed in one text", "1. A\n(2) B\nStep 3\n4、C\n（5）D\n步驟六", ["1.", "(2)", "Step 3", "4、", "（5）", "步驟六"]],
    ["blanks inside a marker, read as one space", "Step   1\nStep\t2", ["Step 1", "Step 2"]],
    ["a long run of blanks inside a marker, which no window cuts", `Step${" ".repeat(40)}1\n步驟${" ".repeat(40)}2`, ["Step 1", "步驟 2"]],
    ["a leading line break", "\n1. Mix\n2. Heat", ["1.", "2."]],
    ["a leading blank line and indentation", "\n\n   1. Mix\n   2. Heat", ["1.", "2."]],
    ["a sentence that comes back later, each read where it stands", "Mix it. 1. Heat it. 2. Cool it. Mix it.", ["1.", "2."]],
    ["the same sentence twice at the start", "Go. Go. 1. Heat it. 2. Cool it.", ["1.", "2."]],
    ["a numbered sentence that comes back in one line, each read where it stands", "1. Mix it. 1. Mix it.", ["1.", "1."]],
    ["a numbered line that comes back", "1. Mix it.\n2. Heat it.\n1. Mix it.", ["1.", "2.", "1."]],
    // The layouts of the rows below were not read at first: each kind of line break, a list bullet before a marker, and the blanks and
    // the invisible characters of a model's own output (page text never holds them: the sanitiser makes each run of white space one space
    // and strips the invisible characters). An invisible character is read both ways, as a blank (so that "Step", it and a number are a
    // marker) and as no character (so that a word or a number it cuts in two is whole): the reading with more markers is kept.
    ["a lone carriage return between the items", "1. Mix\r2. Heat", ["1.", "2."]],
    ["a vertical tab between the items", "1. Mix\v2. Heat", ["1.", "2."]],
    ["a form feed between the items", "1. Mix\f2. Heat", ["1.", "2."]],
    ["a next-line control between the items", `1. Mix${chars(0x85)}2. Heat`, ["1.", "2."]],
    ["a line separator between the items", `1. Mix${LINE_SEPARATOR}2. Heat`, ["1.", "2."]],
    ["a paragraph separator between the items", `1. Mix${chars(0x2029)}2. Heat`, ["1.", "2."]],
    ["a line break and a mix of blanks before an item", `1. Mix\n${NO_BREAK_SPACE} \t${chars(0x3000)}2. Heat`, ["1.", "2."]],
    ["list bullets before the markers", `${BULLET_CHAR} 1. Mix\n${BULLET_CHAR} 2. Heat`, ["1.", "2."]],
    ["a hyphen as the bullet, on the first line too", "- (1) Mix\n- (2) Heat", ["(1)", "(2)"]],
    ["an indented asterisk as the bullet", "  * Step 1: Mix\n  * Step 2: Heat", ["Step 1", "Step 2"]],
    ["a bullet and a Chinese marker, after a line separator", `${BULLET_CHAR} 1、混合${LINE_SEPARATOR}${BULLET_CHAR} 2、加熱`, ["1、", "2、"]],
    ["a bullet with a blank of another kind after it", `${BULLET_CHAR}${NO_BREAK_SPACE}1. Mix\n${BULLET_CHAR}\t2. Heat`, ["1.", "2."]],
    ["no-break spaces after the markers", `1.${NO_BREAK_SPACE}Mix\n2.${NO_BREAK_SPACE}Heat`, ["1.", "2."]],
    ["ideographic spaces after the markers", `1.${chars(0x3000)}Mix\n2.${chars(0x3000)}Heat`, ["1.", "2."]],
    ["a zero-width space beside each marker", `${ZERO_WIDTH_SPACE}1.${ZERO_WIDTH_SPACE}Mix\n${ZERO_WIDTH_SPACE}2.${ZERO_WIDTH_SPACE}Heat`, ["1.", "2."]],
    ["a zero-width space between Step and its number", `Step${ZERO_WIDTH_SPACE}1\nStep${ZERO_WIDTH_SPACE}2`, ["Step 1", "Step 2"]],
    ["a no-break space between Step and its number", `Step${NO_BREAK_SPACE}1\nStep${NO_BREAK_SPACE}2`, ["Step 1", "Step 2"]],
    // The reading of an invisible character changed on purpose: it is read both ways, as a blank and as no character, and the reading with
    // more markers is kept. A number that one cuts in two used to read as a number and a blank (no marker); it is the number it looks like.
    ["a number that an invisible character cuts in two, read as the number it looks like", `1${ZERO_WIDTH_SPACE}0. Mix\n1${ZERO_WIDTH_SPACE}1. Heat`, ["10.", "11."]],
    ["the word Step cut in two by an invisible character", `St${ZERO_WIDTH_SPACE}ep 4 mix\nSt${ZERO_WIDTH_SPACE}ep 5 heat`, ["Step 4", "Step 5"]],
    ["a stop that an invisible character cuts off its number", `1${ZERO_WIDTH_SPACE}. Mix\n2${ZERO_WIDTH_SPACE}. Heat`, ["1.", "2."]],
  ];

  const NOT_ITEMS: readonly [label: string, text: string][] = [
    ["numbers in brackets inside a sentence", "The result in (3) was good and (4) too."],
    ["years that end a sentence", "In 2026. The group met. In 2027. They met."],
    ["a version number and a decimal", "Version 2.0 and 3.5 mg were used."],
    ["markers with no space after them", "1.Mix\n2.Heat"],
    ["markers of four digits", "1000. A\n1001. B"],
    ["the word Steps and numbers", "Steps 1 and 2"],
    ["numbers inside a sentence", "see 1. then 2. then 3."],
    ["no numbers", "Mix the parts, then heat them."],
    ["(1000) of four digits", "(1000) A\n(1001) B"],
    ["Step 1000 of four digits", "Step 1000\nStep 1001"],
    ["1000、 of four digits", "1000、甲\n1001、乙"],
    ["（1000） of four digits", "（1000）甲\n（1001）乙"],
    ["步驟1000 of four digits", "步驟1000：甲\n步驟1001：乙"],
    ["a stop with no number", ". A\n. B"],
    ["a bracket with no number", ") A\n) B"],
    ["empty brackets", "() A\n() B"],
    ["Step with no number", "Step A\nStep B"],
    ["a list stop with no number", "、甲\n、乙"],
    ["empty full-width brackets", "（）甲\n（）乙"],
    ["步驟 with no number", "步驟：甲\n步驟：乙"],
    ["the word step in the middle of a line", "Do this step 1 and that step 2"],
    ["numbers in brackets that start no line", "Do (1) this and (2) that"],
    ["a year after a bullet", "- 2024 saw a rise.\n- 2025 saw a fall."],
    ["a decimal after a bullet", "- 1.5 million\n- 2.5 million"],
    ["bullets with no marker after them", "- Mix the parts\n- Heat the mix"],
    ["a bullet in the middle of a line", "Mix - 1. then heat - 2. then cool"],
    ["a hyphen with no blank after it, which is no bullet", "-1. Mix\n-2. Heat"],
    ["letters before a marker, which is no bullet", "x 1. Mix\ny 2. Heat"],
  ];

  it("counts two items as steps, and says so in STEPS_MIN", () => {
    expect(STEPS_MIN).toBe(2);
  });

  it.each(COUNT)("reads the markers of %s", (_label, text, markers) => {
    expect(stepMarkersIn(text)).toEqual(markers);
  });

  it.each(NOT_ITEMS)("reads no marker in %s", (_label, text) => {
    expect(stepMarkersIn(text)).toEqual([]);
  });

  it("reads each Chinese numeral from zero to ten and a hundred after 步驟 as its number", () => {
    for (const numeral of [..."零〇一二三四五六七八九十百"]) {
      expect(stepMarkersIn(`步驟${numeral}：甲\n步驟${numeral}：乙`), numeral).toEqual([`步驟${numeral}`, `步驟${numeral}`]);
    }
  });

  it("reads every character of Unicode's White_Space property and every invisible character as the blank between a marker and its words, or Step and its number", () => {
    for (const c of [...WHITE_SPACE_CHARS, ...INVISIBLE_CHARS]) {
      expect(stepMarkersIn(`Step${c}4\nStep${c}5`), hex(c)).toEqual(["Step 4", "Step 5"]);
      expect(stepMarkersIn(`1.${c}Mix\n2.${c}Heat`), hex(c)).toEqual(["1.", "2."]);
    }
  });

  it("reads each kind of line break, and a bullet and a blank after it, as the start of the next item", () => {
    const breaks = ["\n", "\r", "\r\n", "\v", "\f", chars(0x85), LINE_SEPARATOR, chars(0x2029), "\n\n", `\n${NO_BREAK_SPACE}  \t`];
    const bullets = ["", "- ", "* ", "+ ", `${BULLET_CHAR} `, `${chars(0x2013)} `, `${chars(0x2014)} `, `${chars(0xb7)} `];
    for (const lineBreak of breaks) {
      for (const bullet of bullets) {
        const text = `${bullet}1. Mix the parts${lineBreak}${bullet}2. Heat the mix${lineBreak}${bullet}3. Cool it`;
        expect(stepMarkersIn(text), JSON.stringify(text)).toEqual(["1.", "2.", "3."]);
      }
    }
  });

  it("fails numbered steps in any layout in each string of a biology finding, and in the big picture", () => {
    const laidOut = `${BULLET_CHAR} 1. Mix the parts${LINE_SEPARATOR}${BULLET_CHAR} 2. Heat the mix`;
    const invisible = `Step${ZERO_WIDTH_SPACE}1: Mix the parts\rStep${ZERO_WIDTH_SPACE}2: Heat the mix`;
    for (const [text, markers] of [[laidOut, "1., 2."], [invisible, "Step 1, Step 2"]] as const) {
      for (const p of FINDING_PLACES) {
        const found = draftOf("DUAL_USE", (d) => p.set(d, text));
        expect(where(found), p.name).toEqual([`error ${p.path}`]);
        expect(found[0]!.message, p.name).toContain(`2 numbered steps (${markers})`);
        expect(draftOf("DUAL_USE", (d) => { f0(d).field = "physics"; p.set(d, text); }), p.name).toEqual([]);
      }
      expect(where(draftOf("DUAL_USE", (d) => { review(d).big_picture = text; }, { context: mondayContext() }))).toEqual(["error review.big_picture"]);
    }
  });

  it("fails numbered steps in a biology or chemistry finding's string, and in no other field's", () => {
    for (const field of FIELDS) {
      const found = draftOf("DUAL_USE", (d) => { f0(d).field = field; f0(d).explainer.found = STEPS; });
      expect(where(found), field).toEqual(field === "biology" || field === "chemistry" ? ["error new_findings[0].explainer.found"] : []);
    }
  });

  it("names the markers and the place, and says what to write instead", () => {
    const [issue] = draftOf("DUAL_USE", (d) => { f0(d).explainer.found = STEPS; });
    expect(issue!.message).toContain("2 numbered steps (1., 2.), which a biology or chemistry finding may not hold");
    expect(issue!.message).toContain("sentences");
    expect(issue!.hint ?? "").toContain("STYLE.md section 9");
    const [many] = draftOf("DUAL_USE", (d) => { f0(d).explainer.found = "1. a. 2. b. 3. c. 4. d. 5. e. 6. f."; });
    expect(many!.message).toContain("6 numbered steps (1., 2., 3., 4.), which");
  });

  it("passes one numbered item, and the same text in a finding of another field", () => {
    expect(draftOf("DUAL_USE", (d) => { f0(d).explainer.found = "1. Mix everything."; })).toEqual([]);
    expect(draftOf("DUAL_USE", (d) => { f0(d).field = "physics"; f0(d).explainer.found = STEPS; })).toEqual([]);
  });

  it.each(FINDING_PLACES.map((p) => [p.name, p] as const))("reads %s of a biology finding, not of a physics one", (_name, p) => {
    expect(where(draftOf("DUAL_USE", (d) => p.set(d, STEPS)))).toEqual([`error ${p.path}`]);
    expect(draftOf("DUAL_USE", (d) => { f0(d).field = "physics"; p.set(d, STEPS); })).toEqual([]);
  });

  it("reads the big picture whatever the week, and no other brief-level text that is about no finding", () => {
    expect(where(draftOf("DUAL_USE", (d) => { review(d).big_picture = STEPS; }, { context: mondayContext() }))).toEqual(["error review.big_picture"]);
    expect(draftOf("DUAL_USE", (d) => { review(d).big_picture = STEPS; }, { context: mondayContext(0) })).toHaveLength(1);
    const [issue] = draftOf("DUAL_USE", (d) => { review(d).big_picture = STEPS; });
    expect(issue!.message).toContain("which the big picture may not hold");
    const quiet = [
      "the Lead", "an idea", "an idea's author", "an Also noted title", "a correction's reason", "a report decision's reason",
      "a brief source's title", "a brief source's publisher", "the strongest evidence against",
    ];
    for (const p of PLACES.filter((q) => quiet.includes(q.name))) expect(draftOf("DUAL_USE", (d) => p.set(d, STEPS)), p.name).toEqual([]);
  });

  it("reads text about a finding by the finding's field: an update on a biology finding fails, on a mathematics one passes", () => {
    const about: readonly [name: string, finding: (d: Json, id: string) => void][] = [
      ["a returning update", (d, id) => { d.returning[0].finding_id = id; }],
      ["a returning rung note", (d, id) => { d.returning[0].finding_id = id; }],
      ["the remarkable note", (d, id) => { review(d).remarkable.finding_id = id; }],
      ["a correction's after", (d, id) => { d.corrections[3].finding_id = id; }],
    ];
    for (const [name, aboutFinding] of about) {
      const p = PLACES.find((q) => q.name === name)!;
      expect(draftOf("DUAL_USE", (d) => p.set(d, STEPS)), name).toEqual([]);
      const found = draftOf("DUAL_USE", (d) => { p.set(d, STEPS); aboutFinding(d, "bio-2026-0001"); });
      expect(where(found), name).toEqual([`error ${p.path}`]);
      expect(found[0]!.message, name).toContain("text about a biology or chemistry finding");
    }
  });

  it("reads the field as first published and as filed now: a physics finding that a draft correction refiles as chemistry fails, and so does a biology finding refiled as earth", () => {
    const refiled = draftOf("DUAL_USE", (d) => { d.rung_changes[0].rung.note = STEPS; });
    expect(where(refiled)).toEqual(["error rung_changes[0].rung.note"]);
    // the same text passes once the draft's corrections no longer refile phys-2026-0003 as chemistry
    expect(draftOf("DUAL_USE", (d) => { d.rung_changes[0].rung.note = STEPS; d.corrections.splice(1, 2); })).toEqual([]);
    const away = (d: Json): void => {
      d.returning[0].finding_id = "bio-2026-0001";
      d.returning[0].update = STEPS;
    };
    expect(where(draftOf("DUAL_USE", away))).toEqual(["error returning[0].update"]);
    const moved = draftOf("DUAL_USE", (d) => {
      away(d);
      d.corrections.push(
        { finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "field", after: "earth", reason: "The field was wrong.", source_url: null, report_id: null },
        { finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "subfield", after: "soils", reason: "The subfield was wrong.", source_url: null, report_id: null },
      );
    });
    expect(where(moved)).toEqual(["error returning[0].update"]);
  });

  it("reads the deep dive by its finding: on a biology candidate of a Sunday it fails, on a mathematics one it passes", () => {
    const onSunday = (finding: string): ValidationIssue[] => draftOf("DUAL_USE", (d) => {
      d.date = SUNDAY;
      Object.assign(dive(d), { finding_id: finding, text: STEPS, why_today: "anniversary" });
    }, { context: sundayContext() });
    const found = onSunday("bio-2024-0007");
    expect(where(found)).toEqual(["error deep_dive.text"]);
    expect(found[0]!.message).toContain("which the deep dive on a biology or chemistry finding may not hold");
    expect(onSunday("math-2025-0009")).toEqual([]);
  });

  it("does not read a finding whose field the run cannot know", () => {
    expect(draftOf("DUAL_USE", (d) => { d.returning[0].finding_id = "bio-2099-9999"; d.returning[0].update = STEPS; })).toEqual([]);
  });

  it("is one issue for each kind of hit in a string: steps, a sequence and a pair are three", () => {
    const found = draftOf("DUAL_USE", (d) => { f0(d).explainer.found = `${STEPS} ${NUC} ${PAIR}`; });
    expect(paths(found)).toEqual(Array(3).fill("new_findings[0].explainer.found"));
    const kinds = found.map((i) => /nucleotide sequence|numbered steps|pair a hazardous agent/.exec(i.message)![0]);
    expect(kinds.sort()).toEqual(["nucleotide sequence", "numbered steps", "pair a hazardous agent"]);
  });
});

// ── DUAL_USE: the sentence test ──────────────────────────────────────────────────────────────────

describe("DUAL_USE: an agent with a procedure word or a quantity in one sentence", () => {
  const seed = dualUseForms(config().dualUse);
  const hit = (index: number, agent: string, method: string | null, quantity: string | null) => ({ index, agent, method, quantity });

  const FAIL: readonly [label: string, text: string, hits: object[]][] = [
    ["an agent and a method word", "Researchers purified ricin in the lab.", [hit(1, "ricin", "purified", null)]],
    ["the longer form of a method, not the shorter one inside it", "The group reports a synthesis route for sarin.", [hit(1, "sarin", "synthesis route", null)]],
    ["an agent and a quantity", "5 mg of ricin was used.", [hit(1, "ricin", null, "5 mg")]],
    ["an agent, a method word and a quantity", "5 mg of ricin was purified.", [hit(1, "ricin", "purified", "5 mg")]],
    ["an agent in any case", "RICIN was purified.", [hit(1, "RICIN", "purified", null)]],
    ["a symbol agent in lower case", "vx was dosed at 5 mg", [hit(1, "vx", null, "5 mg")]],
    ["a symbol agent in mixed case", "h5n1 was kept at 37 degrees Celsius.", [hit(1, "h5n1", null, "37 degrees Celsius")]],
    ["a unit in lower case that the list writes with a capital", "5 ml of ricin was used.", [hit(1, "ricin", null, "5 ml")]],
    ["a unit in capitals that the list writes in lower case", "sarin at 5 MG", [hit(1, "sarin", null, "5 MG")]],
    ["a one-letter unit in capitals", "ricin 5 G", [hit(1, "ricin", null, "5 G")]],
    ["a one-letter unit in lower case", "ricin 5 l", [hit(1, "ricin", null, "5 l")]],
    ["a procedure symbol in lower case", "ld50 of ricin", [hit(1, "ricin", "ld50", null)]],
    ["a symbol agent as written and a temperature", "VX was kept at 37°C.", [hit(1, "VX", null, "37 °C")]],
    ["a symbol agent and a volume", "The H5N1 1 L culture.", [hit(1, "H5N1", null, "1 L")]],
    ["a phrase with a hyphen read as a space", "Lassa-fever recipe", [hit(1, "Lassa-fever", "recipe", null)]],
    ["a phrase with two spaces read as one", "lassa  fever recipe", [hit(1, "lassa  fever", "recipe", null)]],
    ["a hyphenated method read as spaced words", "Step by step recipe for sarin", [hit(1, "sarin", "Step by step", null)]],
    ["a method that is a hyphenated word", "Step-by-step recipe for sarin", [hit(1, "sarin", "Step-by-step", null)]],
    ["a phrase whose hyphen is written as a space", "Crimean Congo haemorrhagic fever gain of function", [hit(1, "Crimean Congo haemorrhagic fever", "gain of function", null)]],
    ["a phrase with a one-letter word", "q fever synthesis", [hit(1, "q fever", "synthesis", null)]],
    ["the second sentence only", "It is anthrax. It was purified. Also ricin at 5 mg.", [hit(3, "ricin", null, "5 mg")]],
    ["two sentences, each counted by its place", "Ricin was purified. It was fine. Sarin at 5 mg.", [hit(1, "Ricin", "purified", null), hit(3, "Sarin", null, "5 mg")]],
    ["a Chinese agent and a Chinese method", "研究團隊純化了蓖麻毒素。", [hit(1, "蓖麻毒素", "純化", null)]],
    ["a Chinese agent and a Chinese quantity", "五克的蓖麻毒素。", [hit(1, "蓖麻毒素", null, "五克")]],
    ["a Chinese agent and a temperature in degrees", "蓖麻毒素在 37 度下培養。", [hit(1, "蓖麻毒素", "培養", "37度")]],
    ["an English agent beside Chinese text", "H5N1是一種病毒，需要5毫克。", [hit(1, "H5N1", null, "5毫克")]],
    ["a Chinese agent in an English sentence", "The 蓖麻毒素 was purified.", [hit(1, "蓖麻毒素", "purified", null)]],
    ["an English agent in a Chinese sentence", "實驗室純化了ricin。", [hit(1, "ricin", "純化", null)]],
    ["a Chinese form that holds a Latin letter, as written", "Q熱的合成", [hit(1, "Q熱", "合成", null)]],
    ["the longer Chinese form of a method, not the shorter one inside it", "炭疽桿菌的培養基", [hit(1, "炭疽", "培養基", null)]],
  ];

  const PASS: readonly [label: string, text: string][] = [
    ["the allowed example of STYLE.md section 9", "An AI model designed a protein that blocks anthrax toxin in cell tests."],
    ["an agent and a method in separate sentences", "A mixture of anthrax and plague. Purification took place. The anthrax is old."],
    ["a symbol agent and a quantity in separate sentences", "The H5N1 strain spread. It needs 5 mg."],
    ["a Chinese agent with a word that has 度 in it", "Ebola 疫情一度失控。"],
    ["a Chinese agent with a number word before 度", "蓖麻毒素在三度下。"],
    ["a Chinese agent with a number word before 度, glued to the words around it", "蓖麻毒素需要三度。"],
    ["a number before a word that starts with a unit", "ricin 2 genes"],
    ["a unit with no number", "ricin ppm"],
    ["a number with no unit", "ricin 5"],
    ["a word that starts with an agent", "Ricinus plants were weighed at 5 mg each."],
    ["a word that ends with an agent", "xricin was dosed at 5 mg."],
    ["a disease name and a count of places", "A Lassa fever outbreak in 2019 reached 5 provinces."],
    ["a number glued to a letter that is part of the symbol", "ricin H5 mg"],
    ["a number glued to a letter before it", "ricin x5 mg"],
    ["a number that ends a sentence before the unit begins one", "ricin 5. mg"],
    ["a lone Latin letter between the parts of a Chinese form", "Q 熱的合成"],
    ["a symbol agent that is the start of a longer word", "VXY was dosed at 5 mg"],
    ["a symbol agent that ends a longer word", "xvx was dosed at 5 mg"],
    ["a unit that is the start of a longer word in capitals", "ricin 5 MGS"],
    ["no agent at all", "A protein was purified at 5 mg after a synthesis route."],
  ];

  it.each(FAIL)("finds %s", (_label, text, hits) => {
    expect(pairsIn(text, seed)).toEqual(hits);
  });

  it.each(PASS)("passes %s", (_label, text) => {
    expect(pairsIn(text, seed)).toEqual([]);
  });

  describe("a quantity is a number and then a unit", () => {
    const units = seed.units;
    const QUANTITY: readonly [label: string, text: string, quantity: string | null][] = [
      ["digits and a symbol", "5 mg", "5 mg"],
      ["digits glued to the unit", "5mg", "5 mg"],
      ["digits and a hyphen before the unit", "5-mg", "5 mg"],
      ["digits and a figure dash before the unit", `5${String.fromCharCode(0x2012)}mg`, "5 mg"],
      ["digits and an en dash before the unit", `5${String.fromCharCode(0x2013)}mg`, "5 mg"],
      ["digits and a hyphen character before the unit", `5${String.fromCharCode(0x2010)}mg`, "5 mg"],
      ["digits and a non-breaking hyphen before the unit", `5${String.fromCharCode(0x2011)}mg`, "5 mg"],
      ["a decimal", "2.5 mL", "2.5 mL"],
      ["thousands separators", "1,000 mg", "1,000 mg"],
      ["an exponent", "1e6 PFU", "1e6 PFU"],
      ["a power of ten, which is read by its last number", "10^6 CFU", "6 CFU"],
      ["a number word and a word unit", "five grams", "five grams"],
      ["a number word in capitals", "FIVE GRAMS", "FIVE GRAMS"],
      ["a unit that is a phrase", "5 parts per million", "5 parts per million"],
      ["a degree sign glued to its letter", "37°C", "37 °C"],
      ["a degree sign as one character", "37 ℃", "37 ℃"],
      ["a unit spelled in words", "37 degrees Celsius", "37 degrees Celsius"],
      ["a Chinese numeral and a Chinese unit", "五克", "五克"],
      ["a Chinese numeral for a half", "半公升", "半公升"],
      ["a digit and a Chinese unit", "5 毫克", "5毫克"],
      ["a digit and 度", "37度", "37度"],
      ["a digit glued to a Han character before it", "需要5毫克", "5毫克"],
      ["a Chinese numeral and 度, which is an ordinary word", "三度", null],
      ["a unit with no number", "weighed in mg", null],
      ["a number glued to a letter before it", "H5 mg", null],
      ["digits that continue a symbol such as LD50", "LD50 mg", null],
      ["a unit in capitals that the list writes in lower case", "5 MG", "5 MG"],
      ["a unit in lower case that the list writes with a capital", "5 ml", "5 ml"],
      ["a micro unit in lower case, with the micro sign or a Greek mu", `5 ${String.fromCharCode(0xb5)}l`, `5 ${String.fromCharCode(0xb5)}l`],
      ["a count of forming units in lower case", "2 cfu", "2 cfu"],
      ["a temperature unit in lower case", "37 °c", "37 °c"],
      ["a unit of one letter in lower case", "5 l", "5 l"],
      ["a unit inside a longer word", "5 genes", null],
      ["a unit inside a longer word in capitals", "5 GENES", null],
      ["a unit after a sentence end", "5. mg", null],
      ["the first unit without a number, then one with", "Dosed in mg, then 5 mg.", "5 mg"],
      ["the first 克 without a number, then one with", "克服了五克", "五克"],
    ];

    it.each(QUANTITY)("reads %s", (_label, text, quantity) => {
      expect(quantityIn(text, units)).toBe(quantity);
    });

    it("reads each of the 32 number words and each Chinese numeral as a number before a unit", () => {
      const words = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
        "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
        "ninety", "hundred", "thousand", "million", "billion",
      ];
      expect(words).toHaveLength(32);
      for (const word of words) expect(quantityIn(`${word} mg`, units), word).toBe(`${word} mg`);
      for (const numeral of [..."零〇一二三四五六七八九十百千萬億兩半"]) expect(quantityIn(`${numeral}克`, units), numeral).toBe(`${numeral}克`);
    });

    it("reads the number of a unit that stands near the start of a long text, where the window before it is cut by the text's start", () => {
      expect(quantityIn(`5 mg ${"x".repeat(100)}`, units)).toBe("5 mg");
      expect(quantityIn(`mg ${"x".repeat(100)}`, units)).toBeNull();
      expect(quantityIn(`${"x".repeat(100)} 5 mg`, units)).toBe("5 mg");
    });
  });

  describe("a Latin form is a whole word in any case", () => {
    const custom: Pick<DualUseFile, "agents" | "procedures" | "units"> = {
      agents: [{ en: ["Zorbax virus", "ZV", "KX9", "zorbaxin", "AbCd", "Qy"], zh: ["佐巴克斯"] }],
      procedures: [{ en: ["brewing"], zh: ["釀製"] }],
      units: [{ en: ["Mole", "mol"], zh: ["毫克"] }],
    };
    const forms = compileDualUse(custom);
    const found = (text: string): boolean => pairsIn(text, forms).length > 0;

    it("matches a word form in any case, a hyphen or any run of blanks as one space, and only as a whole word", () => {
      for (const text of ["zorbaxin brewing", "ZORBAXIN BREWING", "Zorbaxin Brewing", "zorbax-virus brewing", "ZORBAX  VIRUS brewing", "zorbax\nvirus brewing", "zorbax\tvirus brewing", `zorbax${String.fromCharCode(0x2010)}virus brewing`, `zorbax${String.fromCharCode(0x2011)}virus brewing`]) {
        expect(found(text), text).toBe(true);
      }
      for (const text of ["zorbaxins brewing", "xzorbaxin brewing", "5zorbaxin brewing", "zorbaxvirus brewing", "zorbax virus brewings", "zorbaxin rebrewing", "zorbaxin 5brewing"]) {
        expect(found(text), text).toBe(false);
      }
    });

    it("matches a short form, one with a digit and one with two capitals in any case too, and only as a whole word", () => {
      for (const symbol of ["ZV", "KX9", "AbCd", "Qy"]) {
        for (const written of [symbol, symbol.toLowerCase(), symbol.toUpperCase()]) {
          expect(found(`${written} brewing`), written).toBe(true);
          expect(found(`x${written} brewing`), `x${written}`).toBe(false);
          expect(found(`${written}x brewing`), `${written}x`).toBe(false);
          expect(found(`${written}9 brewing`), `${written}9`).toBe(false);
        }
      }
    });

    it("reads a unit in any case: its letters are a whole word like the rest, so a longer word that starts with them is not it", () => {
      for (const text of ["5 MOLE", "5 mole", "5 Mole", "5 mol", "5 MOL", "5 Mol"]) expect(quantityIn(text, forms.units), text).toBe(text);
      for (const text of ["5 moles", "5 MOLES", "5 molecules", "5 xmol", "mol 5"]) expect(quantityIn(text, forms.units), text).toBeNull();
    });

    // SPEC 4.11 and 4.12: every Latin form of dual-use.json matches as a whole word in any case, a unit's symbol included, so a symbol
    // that differs from another only in case is the same form. A unit whose capitals matter (mM, millimolar, against mm, millimetres) cannot be listed
    // as a symbol; the seed lists such units as words.
    it("reads a unit symbol in any case, so a list that holds mM reads mm, MM and Mm as a quantity too", () => {
      const molar = compileDualUse({
        agents: [{ en: ["ricin"], zh: [] }],
        procedures: [{ en: ["recipe"], zh: [] }],
        units: [{ en: ["mM"], zh: [] }],
      });
      for (const unit of ["mM", "mm", "MM", "Mm"]) expect(quantityIn(`5 ${unit}`, molar.units), unit).toBe(`5 ${unit}`);
      expect(pairsIn("A ricin sample 5 mm wide.", molar).map((h) => h.quantity)).toEqual(["5 mm"]);
      expect(quantityIn("5 mMol", molar.units)).toBeNull();
    });

    it("cannot hold mM and mm as two forms, since the schema of dual-use.json reads two forms that differ only in case as one", () => {
      const file = structuredClone(config().dualUse);
      expect(DualUseFile.safeParse(file).success).toBe(true);
      const before = file.units.length;
      const both = { ...file, units: [...file.units, { en: ["mM"], zh: [] }, { en: ["mm"], zh: [] }] };
      const parsed = DualUseFile.safeParse(both);
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([
        [`units.${before + 1}.en.0`, `The English form "mm" is already listed at units[${before}]`],
      ]);
      // a symbol that stands in two lists is refused the same way: one form is one word whatever its case
      const across = { ...file, agents: [...file.agents, { en: ["MM"], zh: [] }], units: [...file.units, { en: ["mM"], zh: [] }] };
      expect(DualUseFile.safeParse(across).success).toBe(false);
    });

    it("holds the molar concentrations of the seed as words, and the symbol of micromolar is read as the symbol of the micrometre", () => {
      const seed = compileDualUse(config().dualUse);
      for (const unit of ["millimolar", "Micromolar", "NANOMOLAR", `${chars(0xb5)}M`, `${chars(0xb5)}m`]) {
        expect(quantityIn(`5 ${unit}`, seed.units), unit).toBe(`5 ${unit}`);
      }
    });

    it("matches a Chinese form as a plain substring, next to Latin letters too", () => {
      expect(found("佐巴克斯的釀製")).toBe(true);
      expect(found("abc佐巴克斯xyz釀製")).toBe(true);
      expect(found("佐巴克斯")).toBe(false);
      expect(quantityIn("三毫克", forms.units)).toBe("三毫克");
    });

    it("reads a form with blanks around it as the form without them, and leaves out a form of blanks alone", () => {
      const padded = compileDualUse({
        agents: [{ en: ["  zorbaxin ", " ZV\t", " "], zh: [" 佐巴克斯 "] }],
        procedures: [{ en: [" brewing "], zh: [] }],
        units: [{ en: [" mol "], zh: [" 毫克 "] }],
      });
      expect(pairsIn("zorbaxin brewing", padded).map((h) => h.agent)).toEqual(["zorbaxin"]);
      expect(pairsIn("ZV brewing", padded).map((h) => h.agent)).toEqual(["ZV"]);
      expect(pairsIn("zv brewing", padded).map((h) => h.agent)).toEqual(["zv"]);
      expect(pairsIn("佐巴克斯的brewing", padded).map((h) => h.agent)).toEqual(["佐巴克斯"]);
      expect(quantityIn("5 mol", padded.units)).toBe("5 mol");
      expect(quantityIn("5毫克", padded.units)).toBe("5毫克");
      // a blank form would be an empty pattern that matches every string: it is left out, so a plain sentence has no agent
      expect(pairsIn("A plain sentence about brewing at 5 mol.", padded)).toEqual([]);
    });

    it("compiles once for each list it is given", () => {
      const file = config().dualUse;
      expect(dualUseForms(file)).toBe(dualUseForms(file));
      expect(dualUseForms(file)).toEqual(compileDualUse(file));
      expect(dualUseForms(structuredClone(file))).not.toBe(dualUseForms(file));
    });
  });

  describe("every form of config/dual-use.json is read", () => {
    const file = config().dualUse;
    const FORMS = (list: "agents" | "procedures" | "units"): string[] => [...new Set(file[list].flatMap((e) => [...e.en, ...e.zh]))];

    it("finds each agent form, as written, beside a method word", () => {
      for (const form of FORMS("agents")) {
        const hits = pairsIn(`A recipe for ${form}.`, seed);
        expect(hits.map((h) => h.agent), form).toEqual([form]);
      }
    });

    it("finds each procedure form, as written, beside an agent", () => {
      for (const form of FORMS("procedures")) {
        const hits = pairsIn(`Ricin and the ${form}.`, seed);
        expect(hits.map((h) => h.method), form).toEqual([form]);
      }
    });

    it("finds each unit form after a number, beside an agent", () => {
      for (const form of FORMS("units")) {
        const hits = pairsIn(`Ricin at 5 ${form}.`, seed);
        const han = /\p{Script=Han}/u.test(form);
        expect(hits.map((h) => h.quantity), form).toEqual([han ? `5${form}` : `5 ${form}`]);
      }
    });
  });

  it("fails an agent with a method word in each place a string can sit, naming the sentence, the agent and the method word", () => {
    for (const p of PLACES) {
      const found = draftOf("DUAL_USE", (d) => p.set(d, planted(p, PAIR)));
      expect(where(found), p.name).toEqual([`error ${p.path}`]);
      expect(found[0]!.message, p.name).toContain(`has 1 sentence that pair a hazardous agent with how to make or measure it: sentence 1 holds "ricin" with the method word "purification"`);
      expect(found[0]!.hint ?? "", p.name).toContain("STYLE.md section 9");
    }
  });

  it("names the quantity too, and every sentence of a string in one issue", () => {
    const found = draftOf("DUAL_USE", (d) => { d.lead[0].text = "Ricin was purified. It was fine. Sarin at 5 mg. Ricin 2 g was purified."; });
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("has 3 sentences that pair");
    expect(found[0]!.message).toContain('sentence 1 holds "Ricin" with the method word "purified"');
    expect(found[0]!.message).toContain('sentence 3 holds "Sarin" with the quantity "5 mg"');
    expect(found[0]!.message).toContain('sentence 4 holds "Ricin" with the method word "purified" and the quantity "2 g"');
  });

  it("names the first four sentences of a string and counts the rest", () => {
    const found = draftOf("DUAL_USE", (d) => { d.lead[0].text = Array(6).fill("Ricin was purified.").join(" "); });
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("has 6 sentences that pair");
    expect(found[0]!.message).toContain('sentence 4 holds "Ricin" with the method word "purified"; and 2 more.');
    expect(found[0]!.message).not.toContain("sentence 5");
    const many = draftOf("DUAL_USE", (d) => { d.lead[0].text = Array(400).fill("Ricin was purified.").join(" "); })[0]!.message;
    expect(many).toContain("has 400 sentences that pair");
    expect(many.length).toBeLessThan(600);
  });

  it("passes the sentence of the weekday draft that holds an agent but no method or quantity", () => {
    expect(draftOf("DUAL_USE", (d) => { d.lead[0].text = "An AI model designed a protein that blocks anthrax toxin in cell tests."; })).toEqual([]);
  });
});

// ── STYLE.md section 9 ───────────────────────────────────────────────────────────────────────────

// The writing rule these checks back up. tests/style.test.ts pins what the section says of sequences and steps; this checks that
// what it says of the list of agent words is true of the code: the rule reads config/dual-use.json, and the context does not carry it.
describe("routine/STYLE.md section 9 names the list the pairing check reads", () => {
  const style = fs.readFileSync(path.join(REPO_ROOT, "routine/STYLE.md"), "utf8");
  const start = style.indexOf("\n## 9. Dangerous detail\n");
  const section = style.slice(start, style.indexOf("\n## 10. ", start)).replace(/\s+/g, " ");

  it("finds the section", () => {
    expect(start).toBeGreaterThan(0);
    expect(section.length).toBeGreaterThan(500);
  });

  it("says that the check reads its own list, which is in config/, and that the context does not carry it", () => {
    expect(section).not.toContain("the context's list");
    expect(section).toContain("The check reads its own list of agent words, `dual-use.json` in `config/`. The context does not carry that list");
    expect(fs.existsSync(path.join(REPO_ROOT, "config", "dual-use.json"))).toBe(true);
    expect(config().dualUse.agents.length).toBeGreaterThan(0);
  });

  it("is right that the context carries no list of agent words, procedure words or units", () => {
    const keys = [...Object.keys(AgentContext.shape), ...Object.keys(ContextConfig.shape)];
    expect(keys.filter((key) => /dual|agent|hazard|procedure|unit/i.test(key))).toEqual([]);
  });
});

// ── BLOCKED_HOST ─────────────────────────────────────────────────────────────────────────────────

describe("BLOCKED_HOST", () => {
  const FOUND: readonly [label: string, text: string, urls: string[]][] = [
    ["an https URL", "see https://sci-hub.se/10.1000/x", ["https://sci-hub.se/10.1000/x"]],
    ["a host with no scheme", "see sci-hub.se/10.1000/x", ["sci-hub.se/10.1000/x"]],
    ["a host with a port and no scheme", "sci-hub.se:8080/x", ["sci-hub.se:8080/x"]],
    ["a host in capitals", "SCI-HUB.SE/x", ["SCI-HUB.SE/x"]],
    ["a mirror that only the label entry of the list names", "see www.sci-hub.tw/paper", ["www.sci-hub.tw/paper"]],
    ["a URL of another scheme", "see ftp://libgen.is/book", ["ftp://libgen.is/book"]],
    ["a defanged scheme", "see hxxps://sci-hub.se/x", ["hxxps://sci-hub.se/x"]],
    ["a URL with user information", "https://user:pw@sci-hub.se/x", ["https://user:pw@sci-hub.se/x"]],
    ["a URL inside a query of another", "see ?u=https://sci-hub.se/x here", ["https://sci-hub.se/x"]],
    ["an address in brackets", "(https://pastebin.com/abc)", ["https://pastebin.com/abc"]],
    ["an address at the end of a sentence", "https://pastebin.com/abc.", ["https://pastebin.com/abc"]],
    ["two addresses split by a comma", "https://t.co/abc,https://bit.ly/x", ["https://t.co/abc", "https://bit.ly/x"]],
    ["three mirrors in a list", "libgen.is, libgen.rs; libgen.li", ["libgen.is", "libgen.rs", "libgen.li"]],
    ["the same address twice, once", "see https://pastebin.com/abc and https://pastebin.com/abc again", ["https://pastebin.com/abc"]],
    ["two different addresses on one host", "see https://pastebin.com/abc and https://pastebin.com/def", ["https://pastebin.com/abc", "https://pastebin.com/def"]],
    ["a subdomain of a listed host", "see https://sub.annas-archive.li/x", ["https://sub.annas-archive.li/x"]],
    ["a host of a path entry", "https://shodan.io/search?query=x", ["https://shodan.io/search?query=x"]],
    ["a host of a suffix entry", "abc.onion", ["abc.onion"]],
    ["the domain of an e-mail address", "mail x@sci-hub.se now", ["sci-hub.se"]],
    ["a bare host with a path", "See gist.github.com/someone/abc123 now", ["gist.github.com/someone/abc123"]],
    ["a redirect link", "see https://news.google.com/rss/articles/x", ["https://news.google.com/rss/articles/x"]],
    ["a web archive link", "see archive.org/details/x.", ["archive.org/details/x"]],
    ["a subdomain with a digit in its label", "see mirror2.sci-hub.se/x", ["mirror2.sci-hub.se/x"]],
    ["subdomains whose labels begin and end with 0 and 9", "0a.9z.sci-hub.se/x", ["0a.9z.sci-hub.se/x"]],
    ["a subdomain with a hyphen inside its label", "see a-b.sci-hub.se/x", ["a-b.sci-hub.se/x"]],
    ["a host of one-character labels", "see s.id/abc", ["s.id/abc"]],
    ["a host after an underscore, which is no part of a host", "see my_sci-hub.se/x", ["sci-hub.se/x"]],
    ["a host after an underscore and then a scheme", "see my_https://sci-hub.se/x", ["https://sci-hub.se/x"]],
    ["a port of four digits", "sci-hub.se:8080/x", ["sci-hub.se:8080/x"]],
    ["a port of five digits", "sci-hub.se:65535/x", ["sci-hub.se:65535/x"]],
    ["a port of six digits, whose sixth digit is not a port's", "sci-hub.se:123456/x", ["sci-hub.se:12345"]],
    ["a scheme with a plus sign and a hyphen", "see git+ssh://sci-hub.se/x", ["git+ssh://sci-hub.se/x"]],
    ["a scheme with a dot and a digit", "see a0.b9://sci-hub.se/x", ["a0.b9://sci-hub.se/x"]],
    ["a scheme of 32 characters", `see ${"a".repeat(32)}://sci-hub.se/x`, [`${"a".repeat(32)}://sci-hub.se/x`]],
    ["a longer scheme, read from its last 32 characters", `see ${"a".repeat(40)}://sci-hub.se/x`, [`${"a".repeat(32)}://sci-hub.se/x`]],
    ["a host label of 63 characters, DNS's limit", `see ${"a".repeat(63)}.sci-hub.se/x`, [`${"a".repeat(63)}.sci-hub.se/x`]],
    ["a host label of 63 characters with hyphens inside", `see a${"-".repeat(61)}a.sci-hub.se/x`, [`a${"-".repeat(61)}a.sci-hub.se/x`]],
    ["a host after a label of 64 characters, which no host has", `see ${"a".repeat(64)}.sci-hub.se/x`, ["sci-hub.se/x"]],
    ["a host after a run of labels that end in a hyphen", `see ${"a-".repeat(100)}.sci-hub.se/x`, ["sci-hub.se/x"]],
    ["an address with a long run of marks inside and a letter after", `see https://pastebin.com/abc${"?!.".repeat(500)}x now`, [`https://pastebin.com/abc${"?!.".repeat(500)}x`]],
    ["an address with a long run of marks after it", `see https://pastebin.com/abc${"?!.".repeat(500)}`, ["https://pastebin.com/abc"]],
    ["a host with a long run of dots after it", `see pastebin.com${".".repeat(500)}`, ["pastebin.com"]],
    ["an address that a double quote ends", 'say "https://pastebin.com/abc" now', ["https://pastebin.com/abc"]],
    ["an address that a single quote ends", "say 'https://pastebin.com/abc' now", ["https://pastebin.com/abc"]],
    ["an address that a less-than sign ends", "<https://pastebin.com/abc>", ["https://pastebin.com/abc"]],
    ["an address that a greater-than sign ends", "see https://pastebin.com/abc>x", ["https://pastebin.com/abc"]],
    ["an address that a backslash ends", "see https://pastebin.com/abc\\x", ["https://pastebin.com/abc"]],
    ["an address that a round bracket ends", "see (https://pastebin.com/abc)x", ["https://pastebin.com/abc"]],
    ["an address that a square bracket ends", "see [https://pastebin.com/abc]x", ["https://pastebin.com/abc"]],
    ["an address that a curly bracket ends", "see {https://pastebin.com/abc}x", ["https://pastebin.com/abc"]],
    ["an address that a line break ends", "see https://pastebin.com/abc\nx", ["https://pastebin.com/abc"]],
    ["an address with a comma after it", "see https://pastebin.com/abc, and", ["https://pastebin.com/abc"]],
    ["an address with a semicolon after it", "see https://pastebin.com/abc; and", ["https://pastebin.com/abc"]],
    ["an address with a colon after it", "see https://pastebin.com/abc: and", ["https://pastebin.com/abc"]],
    ["an address with an exclamation mark after it", "see https://pastebin.com/abc! and", ["https://pastebin.com/abc"]],
    ["an address with a question mark after it", "see https://pastebin.com/abc? and", ["https://pastebin.com/abc"]],
    ["an address with several marks after it", "see https://pastebin.com/abc?!.", ["https://pastebin.com/abc"]],
    ["an address that holds a question mark inside", "see https://pastebin.com/abc?q=1 now", ["https://pastebin.com/abc?q=1"]],
    ["a bare host with no path", "see pastebin.com now", ["pastebin.com"]],
    ["a bare host that a slash and a path follow, in brackets", "(pastebin.com/abc)", ["pastebin.com/abc"]],
    // Chinese text puts no blank round an address, so an address ends at a Han character, a kana, a Hangul syllable, a full-width mark or a curly quote
    ["an address among Han characters", "見https://t.me/ch的說明", ["https://t.me/ch"]],
    ["a host that Han characters follow with no path", "見https://t.me的說明", ["https://t.me"]],
    ["a host that a Chinese full stop follows", "見https://t.me。", ["https://t.me"]],
    ["an address hidden after a Chinese comma", "見https://example.org，t.me/ch", ["t.me/ch"]],
    ["an address hidden after a Chinese full stop", "見https://example.org。另見t.me/ch", ["t.me/ch"]],
    ["an address in full-width brackets", "（https://t.me）", ["https://t.me"]],
    ["an address in Chinese quotation marks", "“https://t.me/ch”", ["https://t.me/ch"]],
    ["an address before kana", "見https://t.me/chです", ["https://t.me/ch"]],
    ["an address before Hangul", "https://t.me/ch입니다", ["https://t.me/ch"]],
    ["a bare host between Han characters", "見t.me/ch的說明", ["t.me/ch"]],
    ["a bare host in full-width brackets", "（t.me/ch）", ["t.me/ch"]],
    // A URL parser reads full-width letters, digits, the hyphen and the dot, and an ideographic full stop for a dot, as ASCII: such a host is the host it is
    ["a host written in full-width letters", "見https://ｔ．ｍｅ/ch的說明", ["https://t.me/ch"]],
    ["a host with a full-width dot", "https://t．me/ch", ["https://t.me/ch"]],
    ["a host with an ideographic full stop for its dot", "https://t。me/ch", ["https://t.me/ch"]],
    ["a host with a half-width ideographic full stop for its dot", "https://t｡me/ch", ["https://t.me/ch"]],
    ["a host of full-width letters with a full-width hyphen", "https://ｓｃｉ－ｈｕｂ．ｓｅ/x", ["https://sci-hub.se/x"]],
    ["a host with a full-width digit", "https://ｔ．ｍｅ/ｃｈ１", ["https://t.me/ch1"]],
    ["a host with a squared abbreviation for two of its letters", "見https://㎩stebin.com/x的說明", ["https://Pastebin.com/x"]],
    ["a bare host in full-width letters", "見ｔ．ｍｅ/ch的說明", ["t.me/ch"]],
    // The fold covers the whole block of squared and circled forms, U+3200 to U+33FF, and not only its Latin squares. The address as written ends at such a character
    // and its tail (t.co/x) is blocked anyway, so each row also names the address as folded, which only the fold finds
    ["a host with a limited liability sign (U+32CF) for three of its letters", "見https://a\u32CF.t.co/x的說明", ["t.co/x", "https://aLTD.t.co/x"]],
    ["a host with a circled number (U+3251) for two digits", "https://a\u3251.t.co/x", ["t.co/x", "https://a21.t.co/x"]],
    ["a host with the square gal (U+33FF), the last of the folded block, for three letters", "https://a\u33FF.t.co/x", ["t.co/x", "https://agal.t.co/x"]],
    ["a host in full-width letters inside full-width brackets, with a Chinese comma after", "（https://ｔ．ｍｅ），更多", ["https://t.me"]],
    ["a host in full-width letters that a Chinese full stop follows", "見https://ｔ．ｍｅ。", ["https://t.me"]],
    ["an address as written and again in full-width letters, reported once each", "https://t.me/a，https://ｔ．ｍｅ/b", ["https://t.me/a", "https://t.me/b"]],
  ];

  const NOT_FOUND: readonly [label: string, text: string][] = [
    ["the name of a library in words", "Sci-Hub is a site that many scholars use."],
    ["abbreviations and decimals", "e.g. this, i.e. that, 2.5 mg"],
    ["an ordinary address", "https://example.org/paper"],
    ["a host and an address that are not blocked", "example.org/x https://example.org/y"],
    ["a host of a path entry without the path", "https://shodan.io/about"],
    ["a search page of a host that only its redirect path is blocked on", "https://www.google.com/search?q=1"],
    ["an address of numbers", "https://1.2.3.4/x"],
    ["a host in full-width letters that is not blocked", "https://ｅｘａｍｐｌｅ．ｏｒｇ/ｘ 與 ｅ．ｇ．"],
    ["a squared abbreviation and an ideographic full stop in running text", "5㎏的樣本。見㎩。"],
    ["no address", "A protein was designed in cell tests."],
    ["an empty string", ""],
  ];

  it.each(FOUND)("finds %s", (_label, text, urls) => {
    expect(blockedUrlsIn(text).map((h) => h.url)).toEqual(urls);
  });

  it("ends an address at a character of exactly the ranges of CJK text, full-width forms and curly quotes, and at no character beside them", () => {
    const edges: readonly (readonly [inside: number, outside: number])[] = [
      [0x2018, 0x2017], [0x201f, 0x2020], [0x2026, 0x2025], [0x2e80, 0x2e7f], [0x9fff, 0xa000], [0xac00, 0xabff], [0xd7af, 0xd7b0],
      [0xf900, 0xf8ff], [0xfaff, 0xfb00], [0xff00, 0xfefe], [0xffef, 0xfff0],
    ];
    const found = (cp: number): string[] => blockedUrlsIn(`see https://pastebin.com/abc${String.fromCharCode(cp)}x now`).map((h) => h.url);
    for (const [inside, outside] of edges) {
      expect(found(inside), `U+${inside.toString(16)}`).toEqual(["https://pastebin.com/abc"]);
      expect(found(outside), `U+${outside.toString(16)}`).toEqual([`https://pastebin.com/abc${String.fromCharCode(outside)}x`]);
    }
  });

  it.each(NOT_FOUND)("finds nothing in %s", (_label, text) => {
    expect(blockedUrlsIn(text)).toEqual([]);
  });

  it.each(BLOCKED)("gives the entry of the list for a %s address", (reason, url, pattern) => {
    const [found] = blockedUrlsIn(`see ${url} here`);
    expect(found!.entry.reason).toBe(reason);
    expect(found!.entry.pattern).toBe(pattern);
  });

  // The URL fields: a whole string judged as an address (SPEC §4.12 BLOCKED_HOST row).
  const SOURCE_PLACES = PLACES.filter((p) => ["a brief source's address", "a finding source's address", "a correction's source"].includes(p.name));
  const OTHER_ADDRESS_PLACES = PLACES.filter((p) => ["a figure's address", "a Lean artefact"].includes(p.name));

  it.each(BLOCKED)("fails a %s address in a source's url or a correction's source_url unless the entry is SOURCE_URL's, and in a figure and a Lean artefact whatever the entry", (reason, url) => {
    for (const p of SOURCE_PLACES) {
      const found = draftOf("BLOCKED_HOST", (d) => p.set(d, url));
      expect(where(found), p.name).toEqual(SOURCE_URL_REASONS.includes(reason) ? [] : [`error ${p.path}`]);
    }
    for (const p of OTHER_ADDRESS_PLACES) expect(where(draftOf("BLOCKED_HOST", (d) => p.set(d, url))), p.name).toEqual([`error ${p.path}`]);
  });

  it.each(BLOCKED)("fails a %s address in the prose and the names of a draft, whatever the entry", (_reason, url) => {
    for (const p of TEXT_PLACES) {
      expect(where(draftOf("BLOCKED_HOST", (d) => p.set(d, url))), p.name).toEqual([`error ${p.path}`]);
    }
  });

  it("judges an address field as a whole: a host with no scheme is read as https:// and the host", () => {
    const p = SOURCE_PLACES[0]!;
    expect(where(draftOf("BLOCKED_HOST", (d) => p.set(d, "sci-hub.se/10.1234/x")))).toEqual([`error ${p.path}`]);
    expect(draftOf("BLOCKED_HOST", (d) => p.set(d, "example.org/10.1234/x"))).toEqual([]);
    expect(draftOf("BLOCKED_HOST", (d) => p.set(d, "https://example.org/sci-hub"))).toEqual([]);
  });

  it("judges an address field as written even with blanks around it, and names the address without them", () => {
    const blocked = runRules(withText(baseInput(), "sources[0].url", `  ${BLOCKED[0]![1]} \n`), [rule("BLOCKED_HOST")]);
    expect(where(blocked)).toEqual(["error sources[0].url"]);
    expect(blocked[0]!.message).toContain(`holds the address ${BLOCKED[0]![1]}, whose host`);
    expect(runRules(withText(baseInput(), "sources[0].url", "  https://example.org/x \n"), [rule("BLOCKED_HOST")])).toEqual([]);
    expect(runRules(withText(baseInput(), "sources[0].url", " sci-hub.se/x "), [rule("BLOCKED_HOST")])).toHaveLength(1);
  });

  it("names the address, the entry of the list that matched and what it is", () => {
    const [shadow] = draftOf("BLOCKED_HOST", (d) => { d.lead[0].text = "See https://sci-hub.se/10.1234/x now."; });
    expect(shadow!.message).toContain("lead[0].text holds the address https://sci-hub.se/10.1234/x");
    expect(shadow!.message).toContain("sci-hub.se: a shadow library of pirated papers and books");
    expect(shadow!.message).toContain("Remove it.");
    expect(shadow!.hint ?? "").toContain("primary source");
    const reasons = ["a paste or code-sharing site", "a messaging app", "a link shortener", "a redirect link", "a web archive", "a leak site", "a scanner search page", "a shadow library of pirated papers and books"];
    BLOCKED.forEach(([, url, pattern], i) => {
      const [found] = draftOf("BLOCKED_HOST", (d) => { d.lead[0].text = `See ${url} now.`; });
      expect(found!.message, pattern).toContain(`(${pattern}: ${reasons[i]})`);
    });
  });

  it("shortens an address of more than 120 characters in the message, as shared.ts shown() does", () => {
    const long = `https://pastebin.com/${"a".repeat(100)}`;
    expect(long).toHaveLength(121);
    const [found] = draftOf("BLOCKED_HOST", (d) => { d.lead[0].text = long; });
    expect(found!.message).toContain(`address ${long.slice(0, 117)}..., whose`);
    expect(found!.message).not.toContain(long);
    const edge = `https://pastebin.com/${"a".repeat(99)}`;
    expect(edge).toHaveLength(120);
    expect(draftOf("BLOCKED_HOST", (d) => { d.lead[0].text = edge; })[0]!.message).toContain(`address ${edge}, whose`);
  });

  it("counts the characters of an address in code points, so that a character outside the Basic Multilingual Plane is never cut in two", () => {
    const wide = String.fromCodePoint(0x1f600);
    const message = (count: number): string => draftOf("BLOCKED_HOST", (d) => { d.lead[0].text = `https://pastebin.com/${wide.repeat(count)}`; })[0]!.message;
    // 21 characters and 99 wide ones are 120 code points (and 219 UTF-16 units): printed whole
    expect(message(99)).toContain(`address https://pastebin.com/${wide.repeat(99)}, whose`);
    // one more is 121: the first 117 code points and "..."
    expect(message(100)).toContain(`address https://pastebin.com/${wide.repeat(96)}..., whose`);
    expect(message(100)).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });

  it("is one issue for each distinct address of a string, at the string's path", () => {
    const found = draftOf("BLOCKED_HOST", (d) => { d.lead[0].text = "https://pastebin.com/a, https://pastebin.com/b and https://pastebin.com/a, sci-hub.se/x"; });
    expect(paths(found)).toEqual(Array(3).fill("lead[0].text"));
    expect(found.map((i) => i.message).filter((m) => m.includes("https://pastebin.com/a"))).toHaveLength(1);
  });

  it("reads each string by its own address field: the address of a Lean artefact counts, a DOI is read as text", () => {
    const lean = PLACES.find((p) => p.name === "a Lean artefact")!;
    expect(where(draftOf("BLOCKED_HOST", (d) => lean.set(d, BLOCKED[0]![1])))).toEqual([`error ${lean.path}`]);
    const doi = PLACES.find((p) => p.name === "a DOI artefact")!;
    expect(draftOf("BLOCKED_HOST", (d) => doi.set(d, "10.1234/example.2"))).toEqual([]);
  });

  it("reads no id or vocabulary value", () => {
    expect(runRules(withText(baseInput(), "date", BLOCKED[0]![1]), [rule("BLOCKED_HOST")])).toEqual([]);
    expect(where(runRules(withText(baseInput(), "lead[0].text", BLOCKED[0]![1]), [rule("BLOCKED_HOST")]))).toEqual(["error lead[0].text"]);
  });

  it("tells a field that is itself an address from a string that holds one, for the site (SPEC §4.12 Stored records)", () => {
    const hits = (edit: Edit) => {
      const d = structuredClone(weekdayDraft()) as Json;
      edit(d);
      return blockedHostHits(buildDraftInput(DraftBrief.parse(d), draftInputs()).inventory).map((h) => [h.string.path, h.onUrlField, h.entry.reason, h.url]);
    };
    expect(hits((d) => { d.sources[0].url = BLOCKED[0]![1]; })).toEqual([["sources[0].url", true, "paste", BLOCKED[0]![1]]]);
    expect(hits((d) => { d.lead[0].text = `See ${BLOCKED[0]![1]}.`; })).toEqual([["lead[0].text", false, "paste", BLOCKED[0]![1]]]);
    expect(hits((d) => { d.sources[0].url = BLOCKED[3]![1]; })).toEqual([]);
    expect(hits((d) => { d.corrections[0].source_url = BLOCKED[3]![1]; })).toEqual([]);
    expect(hits((d) => { d.corrections[0].source_url = BLOCKED[4]![1]; })).toEqual([]);
    expect(hits((d) => { d.corrections[0].source_url = BLOCKED[2]![1]; })).toEqual([["corrections[0].source_url", true, "shortener", BLOCKED[2]![1]]]);
    for (const name of ["a figure's address", "a Lean artefact"]) {
      const p = PLACES.find((q) => q.name === name)!;
      expect(hits((d) => p.set(d, BLOCKED[0]![1])), name).toEqual([[p.path, true, "paste", BLOCKED[0]![1]]]);
    }
  });
});

// ── Long strings ─────────────────────────────────────────────────────────────────────────────────

// Each input below is a kind that made a first version of the patterns backtrack: its cost grew with the square or the cube of the
// length, so that a string of 40,000 characters took many seconds (an unbroken run of letters, a scheme with no host after it, a
// number with no end). The limit is generous: these take a few milliseconds to a few hundred, and a pattern that has gone back to
// backtracking takes several seconds for each.
describe("a long string is read in linear time", () => {
  const LIMIT_MS = 2_000;
  const within = <T>(read: () => T): T => {
    const start = performance.now();
    const result = read();
    expect(performance.now() - start).toBeLessThan(LIMIT_MS);
    return result;
  };
  const seed = dualUseForms(config().dualUse);
  const urls = (text: string): string[] => within(() => blockedUrlsIn(text)).map((h) => h.url);

  it("finds no host in a long run of letters, of letters and hyphens, or of labels", () => {
    expect(urls("a".repeat(40_000))).toEqual([]);
    expect(urls("a-".repeat(20_000))).toEqual([]);
    expect(urls("a.".repeat(20_000))).toEqual([]);
  });

  it("finds no address in a long run that only ends in a scheme, and reads one with an address after it from its last 32 characters", () => {
    expect(urls(`${"x".repeat(40_000)}://`)).toEqual([]);
    expect(urls(`${"x".repeat(40_000)}://sci-hub.se/x`)).toEqual([`${"x".repeat(32)}://sci-hub.se/x`]);
    expect(urls(`${"a".repeat(40_000)}.sci-hub.se/x`)).toEqual(["sci-hub.se/x"]);
  });

  it("takes the marks after an address off its end without going over them again and again", () => {
    const marks = `https://pastebin.com/abc${"?!.".repeat(13_000)}`;
    expect(urls(`${marks}x`)).toEqual([`${marks}x`]);
    expect(urls(marks)).toEqual(["https://pastebin.com/abc"]);
    const dots = `https://pastebin.com/abc${".".repeat(40_000)}`;
    expect(urls(`${dots}x`)).toEqual([`${dots}x`]);
    expect(urls(dots)).toEqual(["https://pastebin.com/abc"]);
  });

  it("reads a number before a unit in the 64 characters in front of it, so a long text is read in a pass", () => {
    expect(within(() => pairsIn(`ricin ${"1.".repeat(20_000)} mg`, seed))).toEqual([]);
    expect(within(() => pairsIn(`ricin ${"1,".repeat(20_000)} mg`, seed))).toEqual([]);
    expect(within(() => quantityIn(" mg".repeat(30_000), seed.units))).toBeNull();
    expect(within(() => quantityIn("毫克".repeat(10_000), seed.units))).toBeNull();
    expect(within(() => quantityIn(`${"x mg ".repeat(8_000)}5 mg`, seed.units))).toBe("5 mg");
    expect(within(() => quantityIn(`${"1".repeat(40_000)} mg`, seed.units))).toMatch(/^1+ mg$/);
  });

  it("reads a number up to 64 characters before its unit, blanks included, and no further", () => {
    const apart = (blanks: number): string | null => quantityIn(`1${" ".repeat(blanks)}mg`, seed.units);
    expect(apart(1)).toBe("1 mg");
    expect(apart(62)).toBe("1 mg");
    expect(apart(63)).toBe("1 mg");
    expect(apart(64)).toBeNull();
    expect(quantityIn(`${"1".repeat(63)} mg`, seed.units)).toBe(`${"1".repeat(63)} mg`);
    expect(quantityIn(`2${"1".repeat(80)} mg`, seed.units)).toBe(`${"1".repeat(63)} mg`);
  });

  it("reads a long run of letters, of single letters and of line starts for sequences in a pass", () => {
    expect(within(() => sequencesIn("A".repeat(40_000)))).toEqual([{ kind: "nucleotide", letters: 40_000 }]);
    expect(within(() => sequencesIn("A ".repeat(20_000)))).toEqual([{ kind: "nucleotide", letters: 20_000 }]);
    expect(within(() => sequencesIn(`${"ACGTACGTACGTACGTACG-".repeat(2_000)}`))).toEqual([]);
    expect(within(() => sequencesIn("\n1 ".repeat(20_000)))).toEqual([]);
    expect(within(() => sequencesIn(`${" ".repeat(40_000)}\n${" ".repeat(40_000)}x`))).toEqual([]);
  });

  // The layouts of a string: a run of white space, an invisible character, a line break, a bullet, a position number and a block each
  // make one pass over the text, however many of them a string holds.
  it("reads 100,000 characters of each layout for sequences in a pass", () => {
    const LONG = 100_000;
    const nucleotide = (letters: number) => [{ kind: "nucleotide", letters }];
    const aminoAcid = (letters: number) => [{ kind: "amino-acid", letters }];
    const LAYOUTS: readonly [name: string, text: string, hits: object[]][] = [
      ["a run of no-break spaces", `A${NO_BREAK_SPACE.repeat(LONG)}C`, []],
      ["letters and no-break spaces", `A${NO_BREAK_SPACE}`.repeat(LONG / 2), nucleotide(LONG / 2)],
      ["a run of tabs", "\t".repeat(LONG), []],
      ["blanks of every kind", ` \t${NO_BREAK_SPACE}\n`.repeat(LONG / 4), []],
      ["a run of zero-width spaces", ZERO_WIDTH_SPACE.repeat(LONG), []],
      ["letters and zero-width spaces", `A${ZERO_WIDTH_SPACE}`.repeat(LONG / 2), nucleotide(LONG / 2)],
      ["a run of line separators", LINE_SEPARATOR.repeat(LONG), []],
      ["letters and line separators", `A${LINE_SEPARATOR}`.repeat(LONG / 2), nucleotide(LONG / 2)],
      ["blank lines", "\n".repeat(LONG), []],
      ["blanks and line breaks in turn", " \n".repeat(LONG / 2), []],
      ["bullets", "- ".repeat(LONG / 2), []],
      ["lines that start with a bullet", "\n- ".repeat(LONG / 3), []],
      ["lines that start with a bullet and a number", "\n- 1 ".repeat(LONG / 5), []],
      ["position numbers", "1 ".repeat(LONG / 2), []],
      ["capital blocks of five", "ACDEF ".repeat(16_000), aminoAcid(80_000)],
      ["single capitals", "A D ".repeat(LONG / 4), aminoAcid(LONG / 2)],
      ["capital words of two widths in turn", "AC D ".repeat(LONG / 5), []],
      ["a sentence in capitals, again and again", "THIS IS A SHIFT IN THE FIELD ".repeat(3_400), []],
      ["lines that each start with a position number and three blocks", "1 acdefghikl mnpqrstvwy acdefghikl\n".repeat(2_800), Array(2_800).fill(aminoAcid(30)[0])],
      ["one line of a position number and 9,000 blocks", `1 ${"acdefghikl ".repeat(9_000)}`, aminoAcid(90_000)],
    ];
    for (const [name, text, hits] of LAYOUTS) expect(within(() => sequencesIn(text)), name).toEqual(hits);
  });

  it("reads 100,000 characters of each layout for numbered steps in a pass", () => {
    const LONG = 100_000;
    const LAYOUTS: readonly [name: string, text: string, markers: number][] = [
      ["numbered lines", "1. a\n".repeat(LONG / 5), LONG / 5],
      ["numbered lines behind bullets and line separators", `${BULLET_CHAR} 1. a${LINE_SEPARATOR}`.repeat(LONG / 8), LONG / 8],
      ["blank lines before one marker", `${"\n".repeat(LONG)}1. a`, 1],
      ["a run of line separators", LINE_SEPARATOR.repeat(LONG), 0],
      ["a run of zero-width spaces", ZERO_WIDTH_SPACE.repeat(LONG), 0],
      ["a run of no-break spaces", NO_BREAK_SPACE.repeat(LONG), 0],
      ["blanks of every kind", ` \t${NO_BREAK_SPACE}\n`.repeat(LONG / 4), 0],
      ["bullets", "- ".repeat(LONG / 2), 0],
      ["lines that start with a bullet", "\n- ".repeat(LONG / 3), 0],
      ["sentences", "Mix it. ".repeat(LONG / 8), 0],
    ];
    for (const [name, text, markers] of LAYOUTS) expect(within(() => stepMarkersIn(text)), name).toHaveLength(markers);
  });

  it("reads a long string of each draft place in a pass, a secret or a canary at its end included", () => {
    expect(within(() => secretsIn(`${"sk-".repeat(13_000)}`))).toEqual([]);
    expect(within(() => secretsIn(`${"-----BEGIN ".repeat(4_000)}`))).toEqual([]);
    expect(within(() => secretsIn(`${"a".repeat(40_000)} ${SECRET}`))).toHaveLength(1);
    expect(within(() => holdsCanary(`${"a".repeat(40_000)}${CANARY_TOKEN}`))).toBe(true);
  });
});

// ── The published world ──────────────────────────────────────────────────────────────────────────

const BRIEF_FILE = `briefs/${D}.json`;
const BIO_FILE = "findings/bio-2026-0001.json";
const PHYS_FILE = "findings/phys-2026-0003.json";

/** The Tuesday's stored records as JSON, to edit before they are parsed again. */
interface Stored { brief: Json; findings: Json[]; terms: Json[]; corrections: Json[]; reports: Json[] }

function storedJson(): Stored {
  const w = storedWorld();
  const copy = (v: unknown): Json => structuredClone(v) as Json;
  return { brief: copy(w.brief), findings: w.findings.map(copy), terms: w.terms.map(copy), corrections: w.corrections.map(copy), reports: w.reports.map(copy) };
}

const findingOf = (s: Stored, id: string): Json => s.findings.find((f) => f.id === id)!;

interface PublishedOptions { publishing?: string | null; config?: LoadedConfig; rules?: readonly Rule[] }

/** The published-mode input of the Tuesday's stored records after `edit`, with the records of `publishing` (D unless given) being published. */
function publishedInput(edit: (s: Stored) => void = () => {}, options: PublishedOptions = {}): RuleInput {
  const s = storedJson();
  edit(s);
  const content = {
    findings: s.findings.map((f) => Finding.parse(f)), terms: s.terms.map((t) => Term.parse(t)),
    corrections: s.corrections.map((c) => Correction.parse(c)), reports: s.reports.map((r) => Report.parse(r)),
  };
  const publishing = options.publishing === undefined ? D : options.publishing;
  return buildPublishedInput(Brief.parse(s.brief), content, { config: options.config ?? config(), publishing });
}

/** The Tuesday's stored records after `edit`, judged by `rules` (the group unless given) with the records of `publishing` (D unless given) being published. */
const publishedIssues = (edit: (s: Stored) => void = () => {}, options: PublishedOptions = {}): ValidationIssue[] =>
  runRules(publishedInput(edit, options), options.rules ?? safetyRules);

const publishedOf = (code: string, edit: (s: Stored) => void = () => {}, options: PublishedOptions = {}): ValidationIssue[] =>
  publishedIssues(edit, { ...options, rules: [rule(code)] }).filter((i) => i.code === code);

/** Writes `value` at a dotted path of a JSON record (`lead.0.text.en`). */
function put(record: Json, dotted: string, value: unknown): void {
  const keys = dotted.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  let at: Json = record;
  for (const k of keys.slice(0, -1)) at = at[k];
  at[keys[keys.length - 1]!] = value;
}

type Target = "brief" | "bio" | "phys" | "term" | "correction" | "report";

/** The records a test writes into: where each is in the stored JSON, its file in an issue path and the prefix of its place in a list. */
const TARGETS: Readonly<Record<Target, { file: string; prefix: string; get: (s: Stored) => Json }>> = {
  brief: { file: BRIEF_FILE, prefix: "", get: (s) => s.brief },
  bio: { file: BIO_FILE, prefix: "", get: (s) => findingOf(s, "bio-2026-0001") },
  phys: { file: PHYS_FILE, prefix: "", get: (s) => findingOf(s, "phys-2026-0003") },
  term: { file: "glossary.json", prefix: "terms[0].", get: (s) => s.terms[0]! },
  correction: { file: "corrections.json", prefix: "corrections[1].", get: (s) => s.corrections[1]! },
  report: { file: "reports.json", prefix: "reports[0].", get: (s) => s.reports[0]! },
};

/** A string of a stored record: where it is, its issue path and whether it is the Chinese side of an `L10n`. */
interface StoredPlace { readonly name: string; readonly path: string; readonly chinese: boolean; readonly set: (s: Stored, text: string) => void }

const stored = (name: string, target: Target, dotted: string): StoredPlace => {
  const t = TARGETS[target];
  return {
    name, chinese: dotted.endsWith(".zh") || dotted.startsWith("zh."), path: `${t.file}: ${t.prefix}${dotted.replace(/\.(\d+)/g, "[$1]")}`,
    set: (s, text) => put(t.get(s), dotted, text),
  };
};

const STORED_PLACES: readonly StoredPlace[] = [
  stored("the brief's Pace sentence", "brief", "pace.sentence.en"),
  stored("the Lead", "brief", "lead.0.text.en"),
  stored("the Lead in Chinese", "brief", "lead.0.text.zh"),
  stored("a returning update", "brief", "items.1.update.en"),
  stored("an idea's author", "brief", "ideas.0.who"),
  stored("an Also noted title", "brief", "also.0.title.en"),
  stored("a brief correction's reason", "brief", "corrections.0.reason.en"),
  stored("a brief source's title", "brief", "sources.0.title"),
  stored("a brief source's publisher", "brief", "sources.0.publisher"),
  stored("a brief source's address", "brief", "sources.0.url"),
  stored("a finding's title", "bio", "title.en"),
  stored("a finding's title in Chinese", "bio", "title.zh"),
  stored("a finding's found", "bio", "explainer.found.en"),
  stored("a finding's found in Chinese", "bio", "explainer.found.zh"),
  stored("a finding's how_sure", "bio", "explainer.how_sure.en"),
  stored("an evidence quote", "bio", "ai.evidence.0.quote"),
  stored("a reaction's quote", "bio", "reactions.0.quote"),
  stored("a reaction's name", "bio", "reactions.0.who"),
  stored("a rung note", "bio", "rung_history.1.note.en"),
  stored("a since-then text", "bio", "since_then.0.text.en"),
  stored("a finding source's title", "bio", "sources.0.title"),
  stored("a finding source's address", "bio", "sources.0.url"),
  stored("a who entry's name", "bio", "who.0.name"),
  stored("a term's name", "term", "en.term"),
  stored("a term's definition", "term", "en.definition"),
  stored("a term's Chinese name", "term", "zh.term"),
  stored("a term's Chinese definition", "term", "zh.definition"),
  stored("a term's official name", "term", "zh.official"),
  stored("a term's official address", "term", "zh.official_url"),
  stored("an AI system's name", "bio", "ai.systems.0.name"),
  stored("an AI system's maker", "bio", "ai.systems.0.maker"),
  stored("a reaction's affiliation", "bio", "reactions.0.affiliation"),
  stored("a correction's reason", "correction", "reason.en"),
  stored("a correction's source", "correction", "source_url"),
  stored("a report's reason", "report", "reason.en"),
  {
    // A correction's `before` is read like any other string when its path names a text field; at the `field` path it holds a value.
    name: "a correction's before at a text path", chinese: false, path: "corrections.json: corrections[1].before.en",
    set: (s, text) => { s.corrections[1]!.path = "explainer.found"; s.corrections[1]!.before.en = text; },
  },
];

/** A stored `removed` correction of one string of a finding, of the brief or of a glossary term, dated before D. */
function removal(id: string, target: { finding_id: string } | { edition_date: string } | { term_id: string }, path_: string, over: Json = {}): Json {
  return {
    id, date: "2026-11-20", finding_id: null, edition_date: null, term_id: null, ...target, type: "removed", path: path_,
    before: { en: REMOVED_BEFORE.en, zh: REMOVED_BEFORE.zh }, after: { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh }, reason: l("The text was removed."),
    source_url: null, trigger: "editor", report_id: null, ...over,
  };
}

/** A stored correction that refiles a finding's field. */
const refile = (id: string, finding: string, to: string, date = "2026-11-20"): Json => ({
  id, date, finding_id: finding, edition_date: null, term_id: null, type: "correction", path: "field", before: l("before"), after: l(to),
  reason: l("The field was wrong."), source_url: null, trigger: "editor", report_id: null,
});

/** The seed's dual-use.json with `edit` applied, as a config. */
function configWithDualUse(edit: (file: Json) => void): LoadedConfig {
  const file = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config/dual-use.json"), "utf8")) as Json;
  edit(file);
  return loadConfig(undefined, { overrides: { dualUse: file } });
}

// ── Stored records ───────────────────────────────────────────────────────────────────────────────

describe("stored records", () => {
  const PLANT: readonly [code: string, text: string, warns: boolean][] = [
    ["DUAL_USE", NUC, true],
    ["SECRET_LIKE", `sample ${SECRET}`, false],
    ["CANARY", `sample ${CANARY_TOKEN}`, false],
    ["BLOCKED_HOST", "https://t.me/ch", true],
  ];

  it.each(PLANT)("%s reads every string of the stored records: an error on the records being published, and a warning or an error on the others", (code, text, warns) => {
    for (const p of STORED_PLACES) {
      const edit = (s: Stored): void => p.set(s, text);
      expect(where(publishedOf(code, edit, { publishing: D })), p.name).toEqual([`error ${p.path}`]);
      expect(where(publishedOf(code, edit, { publishing: null })), p.name).toEqual([`${warns ? "warning" : "error"} ${p.path}`]);
    }
  });

  it.each(BLOCKED)("fails a %s address in a stored correction's source_url unless the entry is SOURCE_URL's: an error on a correction being published, a warning on one that is not", (reason, url) => {
    const edit = (s: Stored): void => put(s.corrections[1]!, "source_url", url);
    const at = "corrections.json: corrections[1].source_url";
    const own = SOURCE_URL_REASONS.includes(reason);
    expect(where(publishedOf("BLOCKED_HOST", edit, { publishing: D }))).toEqual(own ? [] : [`error ${at}`]);
    expect(where(publishedOf("BLOCKED_HOST", edit, { publishing: null }))).toEqual(own ? [] : [`warning ${at}`]);
  });

  it("keeps the same path and message for the error and the warning, and the hint of the rule", () => {
    const edit = (s: Stored): void => put(findingOf(s, "bio-2026-0001"), "explainer.found.en", NUC);
    const [error_] = publishedOf("DUAL_USE", edit, { publishing: D });
    const [warning_] = publishedOf("DUAL_USE", edit, { publishing: null });
    expect(warning_).toEqual({ ...error_, severity: "warning" });
    expect(error_!.hint ?? "").toContain("STYLE.md section 9");
  });

  it("judges a finding first briefed earlier as a stored record: a warning for DUAL_USE and BLOCKED_HOST, an error for the two that read no list", () => {
    const edit = (s: Stored): void => {
      const phys = findingOf(s, "phys-2026-0003");
      put(phys, "explainer.found.en", NUC);
      put(phys, "explainer.matters.en", "https://t.me/ch");
      put(phys, "explainer.background.en", SECRET);
      put(phys, "explainer.could_lead.en", CANARY_TOKEN);
    };
    expect(where(publishedIssues(edit, { publishing: D })).sort()).toEqual([
      `error ${PHYS_FILE}: explainer.background.en`, `error ${PHYS_FILE}: explainer.could_lead.en`,
      `warning ${PHYS_FILE}: explainer.found.en`, `warning ${PHYS_FILE}: explainer.matters.en`,
    ]);
  });

  it("judges the records being published in the same run as errors", () => {
    const edit = (s: Stored): void => {
      put(findingOf(s, "phys-2026-0003"), "explainer.found.en", NUC);
      put(findingOf(s, "bio-2026-0001"), "explainer.found.en", NUC);
    };
    expect(where(publishedOf("DUAL_USE", edit))).toEqual([`error ${BIO_FILE}: explainer.found.en`, `warning ${PHYS_FILE}: explainer.found.en`]);
    // the finding first briefed on the earlier date is the one being published when that date is
    expect(where(publishedOf("DUAL_USE", edit, { publishing: "2026-11-10" }))).toEqual([`error ${PHYS_FILE}: explainer.found.en`, `warning ${BIO_FILE}: explainer.found.en`]);
  });

  it("reads the Chinese side of an L10n for all four codes: an address among Chinese characters, a bare host against a Han character, and a term's official address", () => {
    const edit = (s: Stored): void => put(findingOf(s, "bio-2026-0001"), "explainer.found.zh", "實驗室發現 https://t.me/ch 這個連結");
    expect(where(publishedOf("BLOCKED_HOST", edit))).toEqual([`error ${BIO_FILE}: explainer.found.zh`]);
    expect(where(publishedOf("BLOCKED_HOST", edit, { publishing: null }))).toEqual([`warning ${BIO_FILE}: explainer.found.zh`]);
    // against a Han character a bare host is a host all the same (ZH_PARITY's URL scan, which wants a boundary, does not see it)
    expect(where(publishedOf("BLOCKED_HOST", (s) => put(findingOf(s, "bio-2026-0001"), "explainer.found.zh", "見t.me/ch的說明")))).toEqual([`error ${BIO_FILE}: explainer.found.zh`]);
    // a term's official address is no field of the list of whole addresses: it is read for the addresses it holds, a second one in its fragment included
    const official = (url: string) => (s: Stored): void => put(s.terms[0]!, "zh.official_url", url);
    expect(where(publishedOf("BLOCKED_HOST", official("https://terms.naer.edu.tw/detail/1/#https://t.me/ch")))).toEqual(["error glossary.json: terms[0].zh.official_url"]);
    expect(where(publishedOf("BLOCKED_HOST", official("https://t.me/ch")))).toEqual(["error glossary.json: terms[0].zh.official_url"]);
    expect(publishedOf("BLOCKED_HOST", official("https://terms.naer.edu.tw/detail/1/"))).toEqual([]);
    expect(where(publishedOf("DUAL_USE", (s) => put(findingOf(s, "bio-2026-0001"), "explainer.found.zh", "研究團隊純化了蓖麻毒素。")))).toEqual([`error ${BIO_FILE}: explainer.found.zh`]);
    expect(where(publishedOf("BLOCKED_HOST", (s) => put(findingOf(s, "bio-2026-0001"), "explainer.found.en", "https://t.me/ch")))).toEqual([`error ${BIO_FILE}: explainer.found.en`]);
  });

  it("reads the current lists on every record: a form added to dual-use.json fails a stored record, as an error where it is published and a warning elsewhere", () => {
    const current = configWithDualUse((file) => { file.agents.push({ en: ["zorbaxin"], zh: [] }); });
    const text = "Researchers purified zorbaxin.";
    const edit = (s: Stored): void => {
      put(findingOf(s, "bio-2026-0001"), "explainer.found.en", text);
      put(findingOf(s, "phys-2026-0003"), "explainer.found.en", text);
    };
    expect(publishedOf("DUAL_USE", edit)).toEqual([]);
    expect(where(publishedOf("DUAL_USE", edit, { config: current }))).toEqual([`error ${BIO_FILE}: explainer.found.en`, `warning ${PHYS_FILE}: explainer.found.en`]);
    expect(where(draftOf("DUAL_USE", (d) => { d.lead[0].text = text; }, { config: current }))).toEqual(["error lead[0].text"]);
  });

  it("reads numbered steps by a finding's field as filed now: a mathematics finding that a stored correction refiles as biology fails", () => {
    const steps = (s: Stored): void => put(findingOf(s, "math-2026-0002"), "explainer.found.en", STEPS);
    expect(publishedOf("DUAL_USE", steps)).toEqual([]);
    const found = publishedOf("DUAL_USE", (s) => { steps(s); s.corrections.push(refile("C-0003", "math-2026-0002", "biology")); });
    expect(where(found)).toEqual([`error findings/math-2026-0002.json: explainer.found.en`]);
    expect(found[0]!.message).toContain("which a biology or chemistry finding may not hold");
    const later = publishedOf("DUAL_USE", (s) => { steps(s); s.corrections.push(refile("C-0003", "math-2026-0002", "chemistry", "2026-12-05")); });
    expect(where(later)).toEqual([`error findings/math-2026-0002.json: explainer.found.en`]);
  });

  it("reads numbered steps by a finding's field as first published too: a biology finding that a stored correction refiles as earth still fails", () => {
    const steps = (s: Stored): void => put(findingOf(s, "bio-2026-0001"), "explainer.found.en", STEPS);
    expect(where(publishedOf("DUAL_USE", steps))).toEqual([`error ${BIO_FILE}: explainer.found.en`]);
    expect(where(publishedOf("DUAL_USE", (s) => { steps(s); s.corrections.push(refile("C-0003", "bio-2026-0001", "earth")); }))).toEqual([`error ${BIO_FILE}: explainer.found.en`]);
  });

  it("reads a finding's steps as filed now: the frame's stored correction that refiles phys-2026-0003 as chemistry fails it, as a warning on a finding first briefed earlier", () => {
    const found = publishedOf("DUAL_USE", (s) => put(findingOf(s, "phys-2026-0003"), "explainer.found.en", STEPS));
    expect(where(found)).toEqual([`warning ${PHYS_FILE}: explainer.found.en`]);
    const without = publishedOf("DUAL_USE", (s) => { put(findingOf(s, "phys-2026-0003"), "explainer.found.en", STEPS); s.corrections.splice(1, 1); });
    expect(without).toEqual([]);
  });

  it("reads text about a finding by its field: an update on a stored finding that is filed as biology", () => {
    const edit = (s: Stored): void => put(s.brief, "items.1.update.en", STEPS);
    expect(where(publishedOf("DUAL_USE", edit))).toEqual([`error ${BRIEF_FILE}: items[1].update.en`]);
    expect(publishedOf("DUAL_USE", (s) => { edit(s); s.corrections.splice(1, 1); })).toEqual([]);
  });

  it("reads the deep dive of a stored brief by its finding, in both languages", () => {
    const dived = (finding: string, text: string, chinese: string) => (s: Stored): void => {
      s.brief.deep_dive = { finding_id: finding, text: lz(text, chinese), source_ids: ["b1"], why_today: "rotation" };
    };
    const found = publishedOf("DUAL_USE", dived("bio-2026-0001", STEPS, "步驟一：混合。步驟二：加熱。"));
    expect(where(found)).toEqual([`error ${BRIEF_FILE}: deep_dive.text.en`, `error ${BRIEF_FILE}: deep_dive.text.zh`]);
    expect(found[0]!.message).toContain("the deep dive on a biology or chemistry finding");
    expect(publishedOf("DUAL_USE", dived("math-2026-0002", STEPS, "步驟一：混合。步驟二：加熱。"))).toEqual([]);
  });

  it("reads the big picture of a stored review whatever the week", () => {
    const edit = (s: Stored): void => {
      s.brief.review = {
        big_picture: lz(STEPS, "步驟一：混合。步驟二：加熱。"), remarkable: null,
        strongest_against: { text: lz("None found this week.", "本週沒有發現。"), finding_ids: [], source_ids: [] },
        field_counts: FIELDS.map((field) => ({ field, reported: 0, counted: 0 })), fell: [], setbacks: [],
      };
    };
    expect(where(publishedOf("DUAL_USE", edit))).toEqual([`error ${BRIEF_FILE}: review.big_picture.en`, `error ${BRIEF_FILE}: review.big_picture.zh`]);
  });

  it("reads a report's evidence address as a string that holds addresses, not as an address field, and for the other three codes too", () => {
    const at = "reports.json: reports[0].evidence_url";
    const evidence = (url: string) => (s: Stored): void => { s.reports[0]!.evidence_url = url; };
    expect(where(publishedOf("BLOCKED_HOST", evidence(BLOCKED[0]![1])))).toEqual([`error ${at}`]);
    expect(where(publishedOf("BLOCKED_HOST", evidence(BLOCKED[0]![1]), { publishing: null }))).toEqual([`warning ${at}`]);
    expect(where(publishedOf("BLOCKED_HOST", evidence(BLOCKED[3]![1])))).toEqual([`error ${at}`]);
    const hits = blockedHostHits(publishedInput(evidence(BLOCKED[3]![1])).inventory);
    expect(hits.map((h) => [h.string.path, h.onUrlField, h.entry.reason])).toEqual([[at, false, "redirect"]]);
    expect(where(publishedOf("DUAL_USE", evidence(`https://example.org/${NUC}`)))).toEqual([`error ${at}`]);
    expect(where(publishedOf("SECRET_LIKE", evidence(`https://example.org/${SECRET}`)))).toEqual([`error ${at}`]);
    expect(where(publishedOf("CANARY", evidence(`https://example.org/${CANARY_TOKEN}`)))).toEqual([`error ${at}`]);
    expect(publishedIssues(evidence("https://example.org/issue/12"))).toEqual([]);
  });

  it("runs with no record being published, and with no brief", () => {
    expect(publishedIssues(() => {}, { publishing: null })).toEqual([]);
    const w = storedWorld();
    const input = buildPublishedInput(null, w, { config: w.config, publishing: null, date: D });
    expect(runRules(input, safetyRules)).toEqual([]);
  });
});

// ── A returning finding ──────────────────────────────────────────────────────────────────────────

describe("a returning finding (F-55)", () => {
  // phys-2026-0003 was first briefed on 2026-11-10. Filed with `updated: D`, it is a returning finding of D: its second rung entry
  // (recorded D) and both its sources (added D) are the Tuesday's new text; its first rung entry and its since-then note (dated
  // 2026-11-23) are older, and so are its title, its explainer and its figure.
  const returning = (s: Stored): void => { findingOf(s, "phys-2026-0003").updated = D; };
  const planted = (...places: [string, unknown][]) => (s: Stored): void => {
    returning(s);
    for (const [at, text] of places) put(findingOf(s, "phys-2026-0003"), at, text);
  };

  it("judges the frozen explainer of a returning finding as a stored record and its new rung note as being published, for DUAL_USE and BLOCKED_HOST", () => {
    // the frozen hype of the PROTEIN example, in the codes of this group: the same text, frozen and new
    for (const [code, text] of [["DUAL_USE", NUC], ["BLOCKED_HOST", "https://t.me/ch"]] as const) {
      const frozen = publishedOf(code, planted(["explainer.found.en", text]));
      expect(where(frozen), code).toEqual([`warning ${PHYS_FILE}: explainer.found.en`]);
      const fresh = publishedOf(code, planted(["rung_history.1.note.en", text]));
      expect(where(fresh), code).toEqual([`error ${PHYS_FILE}: rung_history[1].note.en`]);
    }
  });

  it("judges an older rung entry and an older note as stored text, and a rung entry or a note recorded on D as being published", () => {
    const text = NUC;
    expect(where(publishedOf("DUAL_USE", planted(["rung_history.0.note", { en: text, zh: null }])))).toEqual([`warning ${PHYS_FILE}: rung_history[0].note.en`]);
    expect(where(publishedOf("DUAL_USE", planted(["since_then.0.text.en", text])))).toEqual([`warning ${PHYS_FILE}: since_then[0].text.en`]);
    // a note dated D is the Tuesday's
    const dated = (s: Stored): void => { planted(["since_then.0.text.en", text])(s); put(findingOf(s, "phys-2026-0003"), "since_then.0.date", D); };
    expect(where(publishedOf("DUAL_USE", dated))).toEqual([`error ${PHYS_FILE}: since_then[0].text.en`]);
  });

  it("follows the English entry into Chinese: the Chinese of a new rung note is judged as being published, the Chinese of the frozen explainer as a stored record", () => {
    expect(where(publishedOf("BLOCKED_HOST", planted(["rung_history.1.note.zh", "見 https://t.me/ch 的說明"])))).toEqual([`error ${PHYS_FILE}: rung_history[1].note.zh`]);
    expect(where(publishedOf("BLOCKED_HOST", planted(["explainer.found.zh", "見 https://t.me/ch 的說明"])))).toEqual([`warning ${PHYS_FILE}: explainer.found.zh`]);
    expect(where(publishedOf("BLOCKED_HOST", planted(["since_then.0.text.zh", "見 https://t.me/ch 的說明"])))).toEqual([`warning ${PHYS_FILE}: since_then[0].text.zh`]);
  });

  it("judges a source added on D as being published and an older source of the same finding as a stored record", () => {
    const older = (s: Stored): void => { put(findingOf(s, "phys-2026-0003"), "sources.1.added", "2026-11-10"); };
    const edit = (s: Stored): void => {
      planted(["sources.0.title", NUC], ["sources.1.title", NUC])(s);
      older(s);
    };
    expect(where(publishedOf("DUAL_USE", edit))).toEqual([`error ${PHYS_FILE}: sources[0].title`, `warning ${PHYS_FILE}: sources[1].title`]);
  });

  it("keeps SECRET_LIKE and CANARY errors on every part of a returning finding, new or frozen", () => {
    for (const [code, text] of [["SECRET_LIKE", `sample ${SECRET}`], ["CANARY", `sample ${CANARY_TOKEN}`]] as const) {
      for (const at of ["explainer.found.en", "title.en", "rung_history.0.note", "rung_history.1.note.en", "since_then.0.text.en", "sources.1.title"]) {
        const value = at === "rung_history.0.note" ? { en: text, zh: null } : text;
        const found = publishedOf(code, planted([at, value]));
        expect(found.map((i) => i.severity), `${code} at ${at}`).toEqual(["error"]);
      }
    }
  });

  it("judges a finding first briefed on D whole, whatever its parts", () => {
    const edit = (s: Stored): void => {
      const bio = findingOf(s, "bio-2026-0001");
      put(bio, "explainer.found.en", NUC);
      put(bio, "rung_history.0.note", { en: NUC, zh: null });
      put(bio, "since_then.0.text.en", NUC);
    };
    expect(where(publishedOf("DUAL_USE", edit))).toEqual([`error ${BIO_FILE}: explainer.found.en`, `error ${BIO_FILE}: rung_history[0].note.en`, `error ${BIO_FILE}: since_then[0].text.en`]);
  });

  it("judges nothing of a finding last updated before D as being published, even when it holds an entry recorded on D", () => {
    const edit = (s: Stored): void => { put(findingOf(s, "phys-2026-0003"), "rung_history.1.note.en", NUC); };
    expect(where(publishedOf("DUAL_USE", edit))).toEqual([`warning ${PHYS_FILE}: rung_history[1].note.en`]);
  });

  it("reads numbered steps in a new note by the finding's field as filed now, and in the frozen text as a stored record", () => {
    const found = publishedOf("DUAL_USE", planted(["rung_history.1.note.en", STEPS], ["explainer.found.en", STEPS]));
    expect(where(found)).toEqual([`error ${PHYS_FILE}: rung_history[1].note.en`, `warning ${PHYS_FILE}: explainer.found.en`]);
  });
});

// ── Removed text ─────────────────────────────────────────────────────────────────────────────────

describe("removed text", () => {
  const DANGER = `${NUC} ${SECRET} ${CANARY_TOKEN} https://t.me/ch`;
  const dangerIn = (record: Target, dotted: string) => (s: Stored): void => put(TARGETS[record].get(s), dotted, DANGER);
  const gone = (record: Target, dotted: string) => (s: Stored): void => put(TARGETS[record].get(s), dotted, { ...REMOVED_TEXT });
  const codes = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.code} ${i.path}`);

  it("skips a string that a removed correction rewrote to REMOVED_TEXT, for all four codes and both languages, and judges the same string where the record still holds the text", () => {
    const edit = (s: Stored): void => {
      dangerIn("bio", "explainer.found.en")(s);
      dangerIn("bio", "explainer.found.zh")(s);
    };
    const reported = [
      `BLOCKED_HOST ${BIO_FILE}: explainer.found.en`, `BLOCKED_HOST ${BIO_FILE}: explainer.found.zh`, `CANARY ${BIO_FILE}: explainer.found.en`, `CANARY ${BIO_FILE}: explainer.found.zh`,
      `DUAL_USE ${BIO_FILE}: explainer.found.en`, `DUAL_USE ${BIO_FILE}: explainer.found.zh`,
      `SECRET_LIKE ${BIO_FILE}: explainer.found.en`, `SECRET_LIKE ${BIO_FILE}: explainer.found.zh`,
    ].sort();
    expect(codes(publishedIssues(edit)).sort()).toEqual(reported);
    // the correction alone skips nothing: dangerous text at the path it names is judged by every rule, and XREF reports the mismatch
    const filed = publishedIssues((s) => { edit(s); s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "explainer.found")); });
    expect(codes(filed).sort()).toEqual(reported);
    // a text removed in one language only is no removal: the side that still holds the text is judged, in each of the four codes
    const half = publishedIssues((s) => {
      put(findingOf(s, "bio-2026-0001"), "explainer.found", { en: REMOVED_TEXT.en, zh: DANGER });
      s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "explainer.found"));
    });
    expect(codes(half).sort()).toEqual(reported.filter((c) => c.endsWith(".zh")));
    const halfEn = publishedIssues((s) => {
      put(findingOf(s, "bio-2026-0001"), "explainer.found", { en: DANGER, zh: REMOVED_TEXT.zh });
      s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "explainer.found"));
    });
    expect(codes(halfEn).sort()).toEqual(reported.filter((c) => c.endsWith(".en")));
    // the record that holds the marker in both languages has nothing left to judge
    const removed = publishedIssues((s) => { gone("bio", "explainer.found")(s); s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "explainer.found")); });
    expect(removed).toEqual([]);
  });

  it("judges a brief's deep dive and a source's address that a removed correction names while the record holds them, and nothing once they hold REMOVED_TEXT", () => {
    const edit = (s: Stored): void => {
      s.brief.deep_dive = { finding_id: "bio-2026-0001", text: lz(`${STEPS} ${DANGER}`, `${STEPS} ${DANGER}`), source_ids: ["b1"], why_today: "rotation" };
      put(findingOf(s, "bio-2026-0001"), "sources.0.url", "https://t.me/ch");
    };
    const all = publishedIssues(edit);
    expect(new Set(all.map((i) => i.code))).toEqual(new Set(["BLOCKED_HOST", "CANARY", "DUAL_USE", "SECRET_LIKE"]));
    expect(paths(all)).toEqual(expect.arrayContaining([`${BRIEF_FILE}: deep_dive.text.en`, `${BRIEF_FILE}: deep_dive.text.zh`, `${BIO_FILE}: sources[0].url`]));
    const names = (s: Stored): void => { s.corrections.push(removal("C-0003", { edition_date: D }, "deep_dive.text"), removal("C-0004", { finding_id: "bio-2026-0001" }, "sources.0.url")); };
    // the corrections alone skip nothing
    expect(codes(publishedIssues((s) => { edit(s); names(s); }))).toEqual(codes(all));
    const removed = publishedIssues((s) => {
      s.brief.deep_dive = { finding_id: "bio-2026-0001", text: lz(REMOVED_TEXT.en, REMOVED_TEXT.zh), source_ids: ["b1"], why_today: "rotation" };
      put(findingOf(s, "bio-2026-0001"), "sources.0.url", REMOVED_TEXT.en);
      names(s);
    });
    expect(removed).toEqual([]);
  });

  it("judges a glossary term's definition that a removed correction names unless both languages hold REMOVED_TEXT (or the term has no Chinese and its English does), and always reads the term's name", () => {
    const edit = (s: Stored): void => {
      for (const side of ["en", "zh"]) put(s.terms[0]!, `${side}.definition`, DANGER);
      put(s.terms[0]!, "en.term", SECRET);
    };
    const name = (s: Stored): void => { s.corrections.push(removal("C-0003", { term_id: "protein-folding" }, "definition")); };
    const all = publishedIssues(edit);
    expect(paths(all)).toEqual(expect.arrayContaining([
      "glossary.json: terms[0].en.definition", "glossary.json: terms[0].zh.definition", "glossary.json: terms[0].en.term",
    ]));
    // the correction alone skips nothing
    expect(codes(publishedIssues((s) => { edit(s); name(s); }))).toEqual(codes(all));
    const removed = publishedIssues((s) => {
      edit(s);
      put(s.terms[0]!, "en.definition", REMOVED_TEXT.en);
      put(s.terms[0]!, "zh.definition", REMOVED_TEXT.zh);
      name(s);
    });
    expect(codes(removed)).toEqual(["SECRET_LIKE glossary.json: terms[0].en.term"]);
    // only the English side removed: the Chinese definition is still read, in the three codes that run on it
    const halfRemoved = publishedIssues((s) => { edit(s); put(s.terms[0]!, "en.definition", REMOVED_TEXT.en); name(s); });
    expect(paths(halfRemoved)).toEqual(expect.arrayContaining(["glossary.json: terms[0].zh.definition", "glossary.json: terms[0].en.term"]));
    expect(paths(halfRemoved)).not.toContain("glossary.json: terms[0].en.definition");
    // a term with no Chinese has none to rewrite: its English alone makes the removal
    const noChinese = publishedIssues((s) => { edit(s); s.terms[0]!.zh = null; put(s.terms[0]!, "en.definition", REMOVED_TEXT.en); name(s); });
    expect(codes(noChinese)).toEqual(["SECRET_LIKE glossary.json: terms[0].en.term"]);
  });

  it("skips only the string the correction names: its sibling, the same path of another finding and a correction of another type are still read", () => {
    const edit = (s: Stored): void => {
      dangerIn("bio", "explainer.found.en")(s);
      dangerIn("bio", "explainer.matters.en")(s);
      dangerIn("phys", "explainer.found.en")(s);
    };
    const removed = publishedOf("CANARY", (s) => {
      edit(s);
      put(findingOf(s, "bio-2026-0001"), "explainer.found", { ...REMOVED_TEXT });
      s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "explainer.found"));
    });
    expect(paths(removed)).toEqual([`${BIO_FILE}: explainer.matters.en`, `${PHYS_FILE}: explainer.found.en`]);
    const otherType = publishedOf("CANARY", (s) => {
      edit(s);
      put(findingOf(s, "bio-2026-0001"), "explainer.found", { ...REMOVED_TEXT });
      s.corrections.push(removal("C-0003", { finding_id: "bio-2026-0001" }, "explainer.found", { type: "correction" }));
    });
    expect(paths(otherType)).toEqual([`${BIO_FILE}: explainer.matters.en`, `${PHYS_FILE}: explainer.found.en`]);
    // REMOVED_TEXT is no danger, and with no removed correction beside it it is judged like any text (and passes the four codes)
    expect(publishedOf("CANARY", (s) => { gone("bio", "explainer.found")(s); })).toEqual([]);
  });

  it("skips a removed string in draft mode never: a draft holds no stored text, so its own text is always read", () => {
    expect(where(draftOf("CANARY", (d) => { d.lead[0].text = CANARY_TOKEN; }))).toEqual(["error lead[0].text"]);
  });
});

// ── The Chinese draft ────────────────────────────────────────────────────────────────────────────

describe("the Chinese draft", () => {
  /**
   * The input of `buildZhInput()` for a Chinese draft of `strings` and `terms` over the English draft it translates. `stored` is what
   * the validating stage reads from `content/` (the stored findings the English draft names, and every stored correction).
   */
  function zhInput(strings: Record<string, string>, terms: Record<string, DraftZhTerm> = {}, over: { english?: DraftBrief; stored?: StoredRecords | null } = {}): ZhInput {
    const context = ZhContext.parse({
      schema_version: 1, date: D, deadline: "2026-11-24T04:15:00+08:00", strings: [], terms: [], fixed: [], hype: [], hype_names: [], avoid: {}, labels: {},
    });
    const draft = DraftZh.parse({ schema_version: 1, date: D, generated_at: "2026-11-24T04:00:00+08:00", strings, terms });
    return buildZhInput(draft, over.english ?? weekdayDraft(), { context, config: config(), stored: over.stored ?? null });
  }
  const zhOf = (code: string, strings: Record<string, string>, terms: Record<string, DraftZhTerm> = {}, over: { english?: DraftBrief; stored?: StoredRecords | null } = {}): ValidationIssue[] =>
    runRules(zhInput(strings, terms, over), [rule(code)]).filter((i) => i.code === code);
  const KEY = (key: string): string => formatPath(["strings", key]);

  const term = (over: Partial<DraftZhTerm> = {}): DraftZhTerm => ({ zh: "蛋白質摺疊", definition: "一串胺基酸捲成立體形狀的過程。", official: null, official_url: null, ...over });
  const records = (ids: readonly string[], corrections: Correction[] = []): StoredRecords => ({ findings: ids.map((id) => storedFinding(id)), corrections, terms: [] });
  const english = (edit: Edit): DraftBrief => {
    const d = structuredClone(weekdayDraft()) as Json;
    edit(d);
    return DraftBrief.parse(d);
  };
  const STEPS_ZH = "步驟一：混合。步驟二：加熱。";

  it("runs all four codes on the Chinese draft's strings, BLOCKED_HOST included", () => {
    const strings = { "lead.0": `${NUC} ${SECRET} ${CANARY_TOKEN} https://t.me/ch` };
    const found = runRules(zhInput(strings), safetyRules);
    expect(found.map((i) => `${i.severity} ${i.code} ${i.path}`).sort()).toEqual([
      `error BLOCKED_HOST ${KEY("lead.0")}`, `error CANARY ${KEY("lead.0")}`, `error DUAL_USE ${KEY("lead.0")}`, `error SECRET_LIKE ${KEY("lead.0")}`,
    ]);
  });

  it("finds a blocked address among Chinese characters, a bare host against a Han character and one in a bracket, and passes a host that is not blocked", () => {
    const hit = (text: string): string[] => where(zhOf("BLOCKED_HOST", { "lead.0": text }));
    expect(hit("實驗室發現 https://t.me/ch 這個連結。")).toEqual([`error ${KEY("lead.0")}`]);
    expect(hit("見t.me/ch的說明。")).toEqual([`error ${KEY("lead.0")}`]);
    expect(hit("（t.me/ch）")).toEqual([`error ${KEY("lead.0")}`]);
    expect(hit("今天的重點是一項範例蛋白質成果。")).toEqual([]);
    expect(hit("見example.org/ch的說明。")).toEqual([]);
    const found = zhOf("BLOCKED_HOST", { "lead.0": "見 https://t.me/ch。" });
    expect(found[0]!.message).toBe(`${KEY("lead.0")} holds the address https://t.me/ch, whose host is on the blocked list (${found[0]!.message.match(/\(([^:]+): /)![1]}: a messaging app). Remove it.`);
    // one hit for each address, in every string, and an error whatever the draft holds
    const two = zhOf("BLOCKED_HOST", { "lead.0": "見 https://t.me/a 和 https://t.me/b。", "lead.1": "見 https://t.me/a。" });
    expect(paths(two)).toEqual([KEY("lead.0"), KEY("lead.0"), KEY("lead.1")]);
    expect(two.every((i) => i.severity === "error")).toBe(true);
  });

  it("finds a blocked host that a Chinese string writes in full-width letters, or with an ideographic full stop for its dot, as the URL parser reads it", () => {
    const hit = (text: string): string[] => where(zhOf("BLOCKED_HOST", { "lead.0": text }));
    expect(hit("見https://ｔ．ｍｅ/ch的說明。")).toEqual([`error ${KEY("lead.0")}`]);
    expect(hit("見https://t。me/ch的說明。")).toEqual([`error ${KEY("lead.0")}`]);
    expect(hit("見https://㎩stebin.com/x的說明。")).toEqual([`error ${KEY("lead.0")}`]);
    expect(hit("見https://ｅｘａｍｐｌｅ．ｏｒｇ/ch的說明。")).toEqual([]);
    const found = zhOf("BLOCKED_HOST", { "lead.0": "見https://ｔ．ｍｅ/ch的說明。" });
    expect(found[0]!.message).toContain("holds the address https://t.me/ch,");
  });

  it("reads a Chinese term's name, definition and official name for a blocked host as it reads them for the other three codes", () => {
    const id = "protein-folding";
    const at = (part: string): string => formatPath(["terms", id, part]);
    const bad = zhOf("BLOCKED_HOST", {}, { [id]: term({ zh: "見t.me/ch", definition: "見 https://t.me/ch。", official: "見t.me/ch" }) });
    expect(paths(bad)).toEqual([at("definition"), at("official"), at("zh")]);
  });

  it("finds a sequence among Chinese characters, an agent with a Chinese method word and one with a Chinese quantity", () => {
    expect(where(zhOf("DUAL_USE", { "lead.0": `序列是${NUC}。` }))).toEqual([`error ${KEY("lead.0")}`]);
    const pair = zhOf("DUAL_USE", { "lead.0": "研究團隊純化了蓖麻毒素。", "lead.1": "需要5毫克的蓖麻毒素。", "lead.2": "蓖麻毒素在三度下。", "lead.3": "這項研究提到炭疽。" });
    expect(paths(pair)).toEqual([KEY("lead.0"), KEY("lead.1")]);
    expect(at(pair, KEY("lead.0")).message).toContain('sentence 1 holds "蓖麻毒素" with the method word "純化"');
    expect(at(pair, KEY("lead.1")).message).toContain('with the quantity "5毫克"');
  });

  it("reads Chinese numbered steps in the strings of a biology finding and in the big picture, and not in those of another field's or of the Lead", () => {
    const found = zhOf("DUAL_USE", {
      "new.new-1.explainer.found": STEPS_ZH, "new.new-2.explainer.found": STEPS_ZH, "review.big_picture": STEPS_ZH, "lead.0": STEPS_ZH,
      "new.new-1.title": "1、混合\n2、加熱",
    });
    expect(paths(found)).toEqual([KEY("new.new-1.explainer.found"), KEY("new.new-1.title"), KEY("review.big_picture")]);
    expect(at(found, KEY("new.new-1.explainer.found")).message).toContain("2 numbered steps (步驟一, 步驟二), which a biology or chemistry finding may not hold");
    expect(at(found, KEY("review.big_picture")).message).toContain("which the big picture may not hold");
  });

  it("reads the deep dive by the stored finding the English draft's deep dive is on: biology fails, mathematics passes, and a finding the run does not know is not read", () => {
    const on = (finding: string): DraftBrief => english((d) => { dive(d).finding_id = finding; });
    const steps = { deep_dive: STEPS_ZH };
    const found = zhOf("DUAL_USE", steps, {}, { english: on("bio-2026-0001"), stored: records(["bio-2026-0001"]) });
    expect(where(found)).toEqual([`error ${KEY("deep_dive")}`]);
    expect(found[0]!.message).toContain("the deep dive on a biology or chemistry finding");
    expect(zhOf("DUAL_USE", steps, {}, { english: on("math-2026-0002"), stored: records(["math-2026-0002"]) })).toEqual([]);
    expect(zhOf("DUAL_USE", steps, {}, { english: on("bio-2026-0001") })).toEqual([]);
  });

  it("reads a stored finding's strings by the field the corrections in force file it under: an update on a mathematics finding that a stored correction refiles as biology fails", () => {
    const update = { "returning.math-2026-0002.update": STEPS_ZH };
    expect(zhOf("DUAL_USE", update, {}, { stored: records(["math-2026-0002"]) })).toEqual([]);
    const refiled = records(["math-2026-0002"], [Correction.parse(refile("C-0003", "math-2026-0002", "biology"))]);
    const found = zhOf("DUAL_USE", update, {}, { stored: refiled });
    expect(where(found)).toEqual([`error ${KEY("returning.math-2026-0002.update")}`]);
    expect(found[0]!.message).toContain("a biology or chemistry finding");
  });

  it("reads a rung note of a finding that the English draft's own correction refiles as chemistry", () => {
    const note = { "rung.phys-2026-0003": STEPS_ZH };
    expect(where(zhOf("DUAL_USE", note, {}, { stored: records(["phys-2026-0003"]) }))).toEqual([`error ${KEY("rung.phys-2026-0003")}`]);
    const unrefiled = english((d) => { d.corrections = d.corrections.filter((c: Json) => c.finding_id !== "phys-2026-0003"); });
    expect(zhOf("DUAL_USE", note, {}, { english: unrefiled, stored: records(["phys-2026-0003"]) })).toEqual([]);
  });

  it("reads each term's Chinese name, definition and 樂詞網 name, and a secret or the canary in any of them", () => {
    const id = "protein-folding";
    const at = (part: string): string => formatPath(["terms", id, part]);
    const dual = zhOf("DUAL_USE", {}, { [id]: term({ zh: "蓖麻毒素純化", definition: "研究團隊純化了蓖麻毒素。", official: "蓖麻毒素純化" }) });
    expect(paths(dual)).toEqual([at("definition"), at("official"), at("zh")]);
    const secret = zhOf("SECRET_LIKE", {}, { [id]: term({ definition: `一段 ${SECRET}` }) });
    expect(where(secret)).toEqual([`error ${at("definition")}`]);
    const canary = zhOf("CANARY", {}, { [id]: term({ zh: CANARY_TOKEN }) });
    expect(where(canary)).toEqual([`error ${at("zh")}`]);
  });

  it("reads a term's 樂詞網 address for a sequence, a secret, the canary and a blocked host, which ZH_OFFICIAL's host check does not see inside a fragment", () => {
    const id = "protein-folding";
    const at = formatPath(["terms", id, "official_url"]);
    const url = (text: string): Record<string, DraftZhTerm> => ({ [id]: term({ official: "蛋白質摺疊", official_url: `https://terms.naer.edu.tw/detail/${text}/` }) });
    expect(where(zhOf("DUAL_USE", {}, url(NUC)))).toEqual([`error ${at}`]);
    expect(where(zhOf("SECRET_LIKE", {}, url(SECRET)))).toEqual([`error ${at}`]);
    expect(where(zhOf("CANARY", {}, url(CANARY_TOKEN)))).toEqual([`error ${at}`]);
    // the address itself is blocked, or a second address stands in its fragment (which ZH_OFFICIAL's page check drops)
    expect(where(zhOf("BLOCKED_HOST", {}, { [id]: term({ official: "蛋白質摺疊", official_url: "https://t.me/ch" }) }))).toEqual([`error ${at}`]);
    expect(where(zhOf("BLOCKED_HOST", {}, url("1#https://t.me/ch")))).toEqual([`error ${at}`]);
    expect(zhOf("BLOCKED_HOST", {}, url("1"))).toEqual([]);
  });

  it("is an error in the Chinese draft, never demoted", () => {
    expect(zhOf("DUAL_USE", { "lead.0": NUC }).map((i) => i.severity)).toEqual(["error"]);
    expect(zhOf("SECRET_LIKE", { "lead.0": SECRET }).map((i) => i.severity)).toEqual(["error"]);
  });

  it("finds nothing in ordinary Chinese text", () => {
    expect(runRules(zhInput({ "lead.0": "今天的重點是一項範例蛋白質成果。", "lead.1": "這項研究提到炭疽，但沒有細節。" }), safetyRules)).toEqual([]);
  });
});
