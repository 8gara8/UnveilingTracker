// Small local checks on an English draft, for the fixture tests (SPEC §4.12 "Fixtures and tests"): the word budgets,
// the sentence length, the reading grade, the dashes, the hype and jargon words, the numbers and quotes, and the
// address of each source, each read from the draft and the files of config/. They are a first line of defence for
// the fixtures: the validator's rules (lib/rules) are the real judge, and `lib/primary.ts` replaces `allowedFor()`
// once it lands. Each check returns a list of problems, empty when the draft passes, so a test can name what failed.
// Pure: no clock and no network; the config is read once from the repo.
//
// New for this project; Cyber's tests/fixtures-base.test.ts counted words and sentences in the same spirit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readingGrade } from "../../lib/readability";
import type { DraftBrief, DraftFinding } from "../../lib/schema/draft";
import {
  countWords, maskPhrases, numberMatches, numbersIn, quoteInText, splitSentences, wordsIn,
} from "../../lib/text";
import { blockedEntry, hostMatches, hostOf, normalizeUrl } from "../../lib/urls";
import { NONE_FOUND, type SourceKind } from "../../lib/vocab";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (name: string): any => JSON.parse(fs.readFileSync(path.join(ROOT, "config", name), "utf8"));

const TIERS = readJson("source-tiers.json");
const LABS = readJson("labs.json");
const CHECKERS = readJson("checkers.json");
const JARGON: string[] = readJson("jargon.json").words.map((w: { en: string }) => w.en);
const HYPE: string[] = readJson("hype-words.json").en;
const HYPE_NAMES: string[] = readJson("hype-words.json").names.map((n: { en: string }) => n.en);
const AGENTS: string[] = readJson("dual-use.json").agents.flatMap((a: { en: string[] }) => a.en);

export const EN_DASH = String.fromCharCode(0x2013);
export const EM_DASH = String.fromCharCode(0x2014);

// ── The model prose of a draft ───────────────────────────────────────────────────────────────────

export type ProseKind =
  | "title" | "found" | "matters" | "ai_helped" | "how_sure" | "background" | "could_lead" | "lead" | "update" | "idea" | "also"
  | "deep_dive" | "big_picture" | "remarkable" | "against" | "definition" | "alt" | "note" | "reason" | "after";

export interface Prose {
  /** A dotted path into the draft: `new_findings.0.explainer.found`. */
  path: string;
  kind: ProseKind;
  text: string;
}

const PARTS = ["found", "matters", "ai_helped", "how_sure", "background", "could_lead"] as const;
export type Part = (typeof PARTS)[number];
export const STORY_PARTS: readonly Part[] = PARTS;
export const ITEM_PARTS: readonly Part[] = ["found", "matters", "ai_helped", "how_sure"];

/** Every string of model prose a draft carries, with its path, in the order the draft lists them. */
export function proseOf(d: DraftBrief): Prose[] {
  const out: Prose[] = [];
  const add = (p: string, kind: ProseKind, text: string | null | undefined) => {
    if (text !== null && text !== undefined) out.push({ path: p, kind, text });
  };
  d.lead.forEach((l, i) => add(`lead.${i}.text`, "lead", l.text));
  d.new_findings.forEach((f, i) => {
    const at = `new_findings.${i}`;
    add(`${at}.title`, "title", f.title);
    for (const part of PARTS) add(`${at}.explainer.${part}`, part, f.explainer[part]);
    f.rung_history.forEach((r, j) => add(`${at}.rung_history.${j}.note`, "note", r.note));
    if (f.figure) add(`${at}.figure.alt`, "alt", f.figure.alt);
    f.terms.forEach((t, j) => { if (t.new) add(`${at}.terms.${j}.definition`, "definition", t.definition); });
  });
  d.returning.forEach((r, i) => {
    add(`returning.${i}.update`, "update", r.update);
    if (r.rung) add(`returning.${i}.rung.note`, "note", r.rung.note);
  });
  d.rung_changes.forEach((r, i) => add(`rung_changes.${i}.rung.note`, "note", r.rung.note));
  d.ideas.forEach((x, i) => add(`ideas.${i}.text`, "idea", x.text));
  d.also.forEach((x, i) => add(`also.${i}.title`, "also", x.title));
  if (d.deep_dive) add("deep_dive.text", "deep_dive", d.deep_dive.text);
  if (d.review) {
    add("review.big_picture", "big_picture", d.review.big_picture);
    if (d.review.remarkable) add("review.remarkable.note", "remarkable", d.review.remarkable.note);
    add("review.strongest_against.text", "against", d.review.strongest_against.text);
  }
  d.corrections.forEach((c, i) => {
    add(`corrections.${i}.after`, "after", c.after);
    add(`corrections.${i}.reason`, "reason", c.reason);
  });
  d.report_decisions.forEach((r, i) => add(`report_decisions.${i}.reason`, "reason", r.reason));
  return out;
}

/** The explainer's parts joined by a space, as the readers and the word lists see them (a null part is left out). */
export function explainerText(f: Pick<DraftFinding, "explainer">, parts: readonly Part[] = STORY_PARTS): string {
  return parts.map((p) => f.explainer[p]).filter((x): x is string => x !== null).join(" ");
}

/** The new finding a ref names, or undefined for an existing finding's id. */
export const newFinding = (d: DraftBrief, ref: string | null): DraftFinding | undefined =>
  ref === null ? undefined : d.new_findings.find((f) => f.ref === ref);

// ── Word budgets (SPEC §4.12 table) ──────────────────────────────────────────────────────────────

const words = (t: string | null | undefined) => countWords(t);
const PART_MAX = { story: { found: 55, matters: 50, ai_helped: 60, how_sure: 60, background: 35, could_lead: 35 }, item: { background: 40, could_lead: 40 } } as const;

/**
 * Every word budget of §4.12 the draft is held to, as problems; `weekShort` says which big picture cap applies (a week
 * of fewer than 3 findings), read from `remarkable` being null when not given. The page total is `pageWords()`.
 */
export function budgetProblems(d: DraftBrief, opts: { weekShort?: boolean } = {}): string[] {
  const problems: string[] = [];
  const within = (what: string, n: number, lo: number, hi: number) => {
    if (n < lo || n > hi) problems.push(`${what}: ${n} words, budget ${lo === 0 ? "" : `${lo} to `}${hi}`);
  };
  within("lead", d.lead.reduce((n, l) => n + words(l.text), 0), 0, 60);
  if (d.lead.length < 1 || d.lead.length > 3) problems.push(`lead: ${d.lead.length} sentences, budget 1 to 3`);
  d.new_findings.forEach((f, i) => {
    const at = `new_findings.${i}`;
    within(`${at}.title`, words(f.title), 1, 12);
    const isStory = d.story === f.ref;
    if (isStory) {
      within(`${at} story`, STORY_PARTS.reduce((n, p) => n + words(f.explainer[p]), 0), 230, 280);
      for (const p of STORY_PARTS) if (f.explainer[p] !== null) within(`${at}.explainer.${p}`, words(f.explainer[p]), 1, PART_MAX.story[p]);
    } else {
      within(`${at} item`, ITEM_PARTS.reduce((n, p) => n + words(f.explainer[p]), 0), 70, 100);
      within(`${at}.explainer.background`, words(f.explainer.background), 1, PART_MAX.item.background);
      within(`${at}.explainer.could_lead`, words(f.explainer.could_lead), 1, PART_MAX.item.could_lead);
    }
    f.rung_history.forEach((r, j) => within(`${at}.rung_history.${j}.note`, words(r.note), 0, 25));
    if (f.figure) within(`${at}.figure.alt`, words(f.figure.alt), 1, 40);
    f.terms.forEach((t, j) => { if (t.new) within(`${at}.terms.${j}.definition`, words(t.definition), 1, 40); });
  });
  d.returning.forEach((r, i) => {
    within(`returning.${i}.update`, words(r.update), 1, 60);
    if (r.rung) within(`returning.${i}.rung.note`, words(r.rung.note), 0, 25);
  });
  d.rung_changes.forEach((r, i) => within(`rung_changes.${i}.rung.note`, words(r.rung.note), 0, 25));
  d.ideas.forEach((x, i) => within(`ideas.${i}.text`, words(x.text), 1, 40));
  d.also.forEach((x, i) => within(`also.${i}.title`, words(x.title), 1, 20));
  if (d.deep_dive) within("deep_dive.text", words(d.deep_dive.text), 450, 550);
  if (d.review) {
    const short = opts.weekShort ?? d.review.remarkable === null;
    within("review.big_picture", words(d.review.big_picture), short ? 1 : 270, short ? 120 : 330);
    if (d.review.remarkable) within("review.remarkable.note", words(d.review.remarkable.note), 1, 30);
    const against = d.review.strongest_against.text;
    if (against !== NONE_FOUND.en) within("review.strongest_against.text", words(against), 1, 50);
  }
  d.corrections.forEach((c, i) => within(`corrections.${i}.reason`, words(c.reason), 1, 40));
  d.report_decisions.forEach((r, i) => within(`report_decisions.${i}.reason`, words(r.reason), 1, 40));
  const total = pageWords(d);
  if (total > 1300) problems.push(`page total: ${total} words, at most 1300`);
  return problems;
}

/**
 * The widest reading of the page total: every string of model prose the brief's page shows, whatever the key counts:
 * the Lead, each new finding's title and its parts as the page shows them (six for the story, four for an item),
 * rung notes and figure text, the updates, ideas, also-noted titles, the deep dive, the review, and the corrections
 * and decisions. The validator's total (`WORDS`) is at most this, so a draft under 1,000 here is under it there.
 */
export function pageWords(d: DraftBrief): number {
  let n = d.lead.reduce((s, l) => s + words(l.text), 0);
  for (const f of d.new_findings) {
    n += words(f.title);
    n += (d.story === f.ref ? STORY_PARTS : ITEM_PARTS).reduce((s, p) => s + words(f.explainer[p]), 0);
    n += f.rung_history.reduce((s, r) => s + words(r.note), 0) + words(f.figure?.alt ?? null);
  }
  for (const r of d.returning) n += words(r.update) + words(r.rung?.note ?? null);
  n += d.rung_changes.reduce((s, r) => s + words(r.rung.note), 0);
  n += d.ideas.reduce((s, x) => s + words(x.text), 0) + d.also.reduce((s, x) => s + words(x.title), 0);
  n += words(d.deep_dive?.text ?? null);
  if (d.review) n += words(d.review.big_picture) + words(d.review.remarkable?.note ?? null) + words(d.review.strongest_against.text);
  n += d.corrections.reduce((s, c) => s + words(c.after) + words(c.reason), 0);
  n += d.report_decisions.reduce((s, r) => s + words(r.reason), 0);
  return n;
}

// ── Sentences, reading level, dashes, hype and jargon ────────────────────────────────────────────

/** The prose a sentence-length check reads: every string of `proseOf()` but the definitions' own form (they are sentences too). */
export function sentenceProblems(d: DraftBrief): string[] {
  const problems: string[] = [];
  for (const p of proseOf(d)) {
    for (const s of splitSentences(p.text)) {
      const n = words(s);
      if (n > 24) problems.push(`${p.path}: a sentence of ${n} words: ${s.slice(0, 60)}`);
    }
  }
  return problems;
}

/** The terms of a new finding, as English strings, for `readingGrade()`. */
export const termsOf = (f: DraftFinding): string[] => f.terms.flatMap((t) => (t.new ? [t.term] : []));

/** The reading grade of each explainer, the Lead, the deep dive and the big picture; those above `max` (default 12) are problems. */
export function gradeProblems(d: DraftBrief, max = 12): string[] {
  const problems: string[] = [];
  const check = (what: string, text: string, terms: string[] = []) => {
    const g = readingGrade(text, { terms });
    if (g > max) problems.push(`${what}: grade ${g.toFixed(1)}, at most ${max}`);
  };
  check("lead", d.lead.map((l) => l.text).join(" "));
  d.new_findings.forEach((f, i) => check(`new_findings.${i}.explainer`, explainerText(f), termsOf(f)));
  if (d.deep_dive) check("deep_dive", d.deep_dive.text);
  if (d.review) check("review.big_picture", d.review.big_picture);
  return problems;
}

/** The grades themselves, for the tests that want the number. */
export function gradeOf(text: string, terms: string[] = []): number {
  return readingGrade(text, { terms });
}

/** Every string of the draft, with its path, whatever its key. */
export function allStrings(value: unknown, at = ""): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path: at, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => allStrings(v, at === "" ? String(i) : `${at}.${i}`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => allStrings(v, at === "" ? k : `${at}.${k}`));
  }
  return [];
}

/** NO_EM_DASH, read over every string of the draft (stricter than the rule, which leaves quotes and source titles as published). */
export function dashProblems(value: unknown): string[] {
  const problems: string[] = [];
  for (const { path: p, text } of allStrings(value)) {
    if (text.includes(EM_DASH)) problems.push(`${p}: an em dash`);
    const bad = [...text.matchAll(new RegExp(EN_DASH, "g"))].filter((m) => {
      const before = text.charAt((m.index ?? 0) - 1);
      const after = text.charAt((m.index ?? 0) + 1);
      return !(/\d/.test(before) && /\d/.test(after));
    });
    if (bad.length > 0) problems.push(`${p}: an en dash outside digits`);
  }
  return problems;
}

/** HYPE_WORDS over the model prose: the names that hold a hype word are masked first; `landmarkRefs` may use "breakthrough". */
export function hypeProblems(d: DraftBrief, landmarkPaths: readonly string[] = []): string[] {
  const problems: string[] = [];
  for (const p of proseOf(d)) {
    const hits = wordsIn(maskPhrases(p.text, HYPE_NAMES), HYPE).filter((w) => !(w === "breakthrough" && landmarkPaths.some((l) => p.path.startsWith(l))));
    if (hits.length > 0) problems.push(`${p.path}: ${hits.join(", ")}`);
  }
  return problems;
}

/** TERM_DEFINED for each new finding: its jargon words are its listed terms, and each listed term appears in its explainer. */
export function termProblems(d: DraftBrief): string[] {
  const problems: string[] = [];
  d.new_findings.forEach((f, i) => {
    const listed = f.terms.map((t) => (t.new ? t.term : t.id.replaceAll("-", " ")).toLowerCase());
    const text = explainerText(f);
    for (const hit of wordsIn(text, JARGON, { plurals: true })) {
      if (!listed.includes(hit.toLowerCase())) problems.push(`new_findings.${i}: jargon word "${hit}" is not a listed term`);
    }
    for (const t of f.terms) {
      const name = t.new ? t.term : t.id.replaceAll("-", " ");
      if (wordsIn(text, [name], { plurals: true }).length === 0) problems.push(`new_findings.${i}: listed term "${name}" is not in the explainer`);
      if (t.new) {
        for (const hit of wordsIn(t.definition, JARGON, { plurals: true })) {
          if (!listed.includes(hit.toLowerCase())) problems.push(`new_findings.${i}: the definition of "${t.term}" uses "${hit}"`);
        }
      }
    }
  });
  return problems;
}

/** The words of `jargon.json` that `text` uses (plural forms included), as written in the text. */
export const jargonIn = (text: string): string[] => wordsIn(text, JARGON, { plurals: true });

/** DUAL_USE's agent terms: the fixtures name none at all (stricter than the rule, which needs a procedure word or a quantity beside one). */
export function agentProblems(value: unknown): string[] {
  return allStrings(value).flatMap(({ path: p, text }) => wordsIn(text, AGENTS).map((a) => `${p}: agent term "${a}"`));
}

// ── Numbers and quotes ───────────────────────────────────────────────────────────────────────────

/** The text the run saw at a URL, or undefined. */
export type SeenText = (url: string) => string | undefined;

/** The numbers of `text` that none of the `seen` texts holds (number words up to ten are exempt), as written in `text`. */
export function missingNumbers(text: string, seen: readonly string[]): string[] {
  const theirs = seen.flatMap((s) => numbersIn(s, { words: true }));
  return numbersIn(text, { words: true })
    .filter((n) => !(n.word && n.value <= 10))
    .filter((n) => !theirs.some((t) => t.percent === n.percent && numberMatches(n, t.value)))
    .map((n) => n.raw);
}

/**
 * NUMBER_SOURCED over the model prose: each number is in the seen text of a source the finding cites (its own
 * sources, and for the corrections, updates and brief-level text the draft's brief-level sources and the finding's).
 * `extra` adds sources for a path prefix; the rule's own pool is the cited sources, so this is a fair first check.
 */
export function numberProblems(d: DraftBrief, seen: SeenText, extra: (p: string) => readonly string[] = () => []): string[] {
  const problems: string[] = [];
  const briefSeen = d.sources.map((s) => seen(s.url)).filter((t): t is string => t !== undefined);
  const prose = proseOf(d);
  d.new_findings.forEach((f, i) => {
    const own = f.sources.map((s) => seen(s.url)).filter((t): t is string => t !== undefined);
    for (const p of prose.filter((x) => x.path.startsWith(`new_findings.${i}.`))) {
      const miss = missingNumbers(p.text, [...own, ...extra(p.path)]);
      if (miss.length > 0) problems.push(`${p.path}: numbers not in the sources: ${miss.join(", ")}`);
    }
  });
  for (const p of prose.filter((x) => !x.path.startsWith("new_findings."))) {
    const miss = missingNumbers(p.text, [...briefSeen, ...extra(p.path)]);
    if (miss.length > 0) problems.push(`${p.path}: numbers not in the sources: ${miss.join(", ")}`);
  }
  return problems;
}

/** QUOTE_VERBATIM: each evidence quote, reaction quote and licence quote is at most 25 words and in a cited source's seen text. */
export function quoteProblems(d: DraftBrief, seen: SeenText): string[] {
  const problems: string[] = [];
  d.new_findings.forEach((f, i) => {
    const byId = new Map(f.sources.map((s) => [s.id, seen(s.url) ?? ""]));
    const check = (what: string, id: string, quote: string) => {
      if (words(quote) > 25) problems.push(`${what}: ${words(quote)} words, at most 25`);
      if (!quoteInText(quote, byId.get(id) ?? "")) problems.push(`${what}: not verbatim in ${id}`);
    };
    f.ai.evidence.forEach((e, j) => check(`new_findings.${i}.ai.evidence.${j}`, e.source_id, e.quote));
    f.reactions.forEach((r, j) => check(`new_findings.${i}.reactions.${j}`, r.source_id, r.quote));
    if (f.figure) check(`new_findings.${i}.figure.licence_quote`, f.figure.source_id, f.figure.licence_quote);
  });
  return problems;
}

// ── Addresses ────────────────────────────────────────────────────────────────────────────────────

const pathOf = (url: string): string => new URL(url).pathname.toLowerCase();
const startsWithAny = (p: string, prefixes: readonly string[]): boolean => prefixes.some((x) => x === "/" || p.startsWith(x.toLowerCase()));
const hostIn = (host: string, hosts: readonly string[]): boolean => hosts.some((h) => hostMatches(host, h));

const publisherEntries = (host: string, p: string, kind: SourceKind): boolean =>
  (TIERS.publishers as any[]).some((e) => {
    if (!hostIn(host, e.hosts) || (e.deny_paths as string[]).some((x) => p.startsWith(x))) return false;
    if (kind === "reaction" && (e.reaction_paths as string[]).some((x) => p.startsWith(x))) return true;
    return (e.kinds as string[]).includes(kind) && startsWithAny(p, e.paths);
  });

const resolverEntries = (host: string, p: string, kind: SourceKind): boolean =>
  (TIERS.resolvers as any[]).some((e) => (e.kinds as string[]).includes(kind) && hostIn(host, e.hosts) && startsWithAny(p, e.paths))
  && kind !== "reaction";

const registryEntries = (host: string, p: string, kind: SourceKind): boolean =>
  (TIERS.registries as any[]).some((e) => (e.kinds as string[]).includes(kind) && hostIn(host, e.hosts) && startsWithAny(p, e.paths)
    // a registry's refusal lists (K1b): the denied subdomains and path prefixes hold no records
    && !hostIn(host, e.deny_hosts) && !(e.deny_paths as string[]).some((x) => p.startsWith(x)));

const statementEntries = (host: string, p: string): boolean =>
  (TIERS.statement_suffixes as string[]).some((entry) => {
    if (entry.startsWith(".")) return host.endsWith(entry);
    const slash = entry.indexOf("/");
    if (slash < 0) return hostMatches(host, entry);
    return hostMatches(host, entry.slice(0, slash)) && p.startsWith(entry.slice(slash));
  });

const listedEntries = (host: string, p: string, entries: any[]): boolean =>
  entries.some((e) => hostIn(host, e.hosts) && startsWithAny(p, e.paths));

/**
 * A small local reading of `isPrimary(url, kind)` (SPEC §4.11's URL test): an entry of config/source-tiers.json,
 * labs.json or checkers.json lists the host and the path for the kind, and the host is not blocked. The type check
 * (article types) is the validator's. Press hosts never pass but through the reaction, lab and checker entries.
 */
export function allowedFor(url: string, kind: SourceKind): boolean {
  const host = hostOf(url);
  if (host === null || blockedEntry(url) !== null) return false;
  const p = pathOf(url);
  const wins = listedEntries(host, p, TIERS.reaction_sources) && kind === "reaction"
    || listedEntries(host, p, LABS.labs) && kind === "lab_post"
    || listedEntries(host, p, CHECKERS.checkers) && kind === "checker";
  if (wins) return true;
  if ((TIERS.press_hosts as string[]).some((h) => hostMatches(host, h))) return false;
  switch (kind) {
    case "paper":
    case "notice":
      return publisherEntries(host, p, kind) || resolverEntries(host, p, kind);
    case "preprint":
      return publisherEntries(host, p, kind) || resolverEntries(host, p, kind);
    case "reaction":
      return publisherEntries(host, p, kind);
    case "proof":
    case "dataset":
    case "registry":
      return registryEntries(host, p, kind) || resolverEntries(host, p, kind);
    case "statement":
      return statementEntries(host, p);
    default:
      return false;
  }
}

/** The hosts a figure may come from (`figure_hosts`). */
export const FIGURE_HOSTS: readonly string[] = TIERS.figure_hosts;

/** SOURCE_URL, BLOCKED_HOST and PRIMARY_ONLY's URL test over every source of a draft, and the other URLs it holds. */
export function urlProblems(d: DraftBrief): string[] {
  const problems: string[] = [];
  const containers: { at: string; sources: DraftBrief["sources"] }[] = [
    { at: "sources", sources: d.sources },
    ...d.new_findings.map((f, i) => ({ at: `new_findings.${i}.sources`, sources: f.sources })),
  ];
  for (const { at, sources } of containers) {
    const seen = new Set<string>();
    sources.forEach((s, j) => {
      const here = `${at}.${j}`;
      if (!/^https:\/\//.test(s.url)) problems.push(`${here}: not https`);
      if (/\/\/[^/]*@/.test(s.url)) problems.push(`${here}: user info`);
      if (blockedEntry(s.url) !== null) problems.push(`${here}: blocked host`);
      if (!allowedFor(s.url, s.kind)) problems.push(`${here}: ${s.url} is not a primary address for kind ${s.kind}`);
      const key = normalizeUrl(s.url);
      if (seen.has(key)) problems.push(`${here}: repeats an address`);
      seen.add(key);
    });
  }
  d.new_findings.forEach((f, i) => {
    if (f.figure) {
      const host = hostOf(f.figure.image_url);
      if (host === null || !FIGURE_HOSTS.includes(host)) problems.push(`new_findings.${i}.figure.image_url: host is not a figure host`);
      if (blockedEntry(f.figure.image_url) !== null) problems.push(`new_findings.${i}.figure.image_url: blocked host`);
    }
    for (const lean of f.artefacts.lean) if (blockedEntry(lean) !== null || !/^https:\/\/github\.com\/.+\.lean$/.test(lean)) problems.push(`new_findings.${i}.artefacts.lean: ${lean}`);
  });
  d.corrections.forEach((c, i) => {
    if (c.source_url !== null && blockedEntry(c.source_url) !== null) problems.push(`corrections.${i}.source_url: blocked host`);
  });
  return problems;
}
