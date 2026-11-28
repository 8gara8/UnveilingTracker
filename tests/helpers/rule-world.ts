// A small hand-built world for the validator frame's tests (SPEC §4.12): an English draft and the inputs it is validated
// against (context, evidence, metrics, pack, config), and the stored records of a published edition (brief, findings, glossary,
// corrections, reports). Every value is parsed through its schema, so a builder that drifts from the schema fails at once, and
// every call returns a fresh copy, so a test may change it. The numbers and sources are made up: no real paper, lab or result.
// The fixtures world of fixtures/src/ is not used, so these tests stand on the frame alone.
//
// The Tuesday 2026-11-24 edition: a story (`new-1`, biology, Major, AI role, Checked) and two items (`new-2`, a finding with no AI
// role, and the stored `math-2026-0002`, returning with a new Checked entry), a rung change on `phys-2026-0003`, an idea, an
// Also noted line, and corrections that refile `math-2026-0002` (Major, as the story is, so no item outranks it) and `phys-2026-0003` (field and
// subfield). Every id the draft names is one that the contexts list, and every subfield one that config/fields.json lists. The stored
// edition holds the same findings as records.
//
// New for this project; Cyber's tests built their drafts inline in each test file.

import { loadConfig, type LoadedConfig } from "../../lib/config";
import { addDays } from "../../lib/dates";
import { FIELDS, REMOVED_TEXT } from "../../lib/vocab";
import { Brief } from "../../lib/schema/brief";
import { AgentContext } from "../../lib/schema/context";
import { DraftBrief } from "../../lib/schema/draft";
import { Finding } from "../../lib/schema/finding";
import { Term } from "../../lib/schema/glossary";
import { MetricsFile } from "../../lib/schema/metrics";
import { Correction, Evidence, Report } from "../../lib/schema/misc";
import { Pack } from "../../lib/schema/pack";
import { normalizeUrl } from "../../lib/urls";

export const D = "2026-11-24";
export const MONDAY = "2026-11-23";
export const SUNDAY = "2026-11-22";
/** The finding the Monday's week lists as a setback: its entry there is a setback too. */
const SETBACK = "chem-2026-0004";

export type Json = Record<string, any>;

export const l = (en: string): { en: string; zh: null } => ({ en, zh: null });
export const lz = (en: string, zh: string): { en: string; zh: string } => ({ en, zh });

/** A deep copy: the worlds are built fresh on every call, this is for a test that wants a second copy of a part. */
export const clone = <T>(value: T): T => structuredClone(value);

/** Freezes a value and everything inside it, so a function that changes its input throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) deepFreeze(inner);
  }
  return value;
}

let cachedConfig: LoadedConfig | null = null;
/** The repo's config/, loaded once (every test reads it, none changes it). */
export function config(): LoadedConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

// ── Sources, artefacts ───────────────────────────────────────────────────────────────────────────

const draftSource = (n: number, extra: Json = {}): Json => ({
  id: `s${n}`, kind: "paper", title: `A made-up paper ${n}`, publisher: "Example Journal", url: `https://example.org/paper/${n}`,
  doi: n === 1 ? "10.1234/example.1" : null, published_at: "2026-11-20", ...extra,
});

const briefSource = (n: number): Json => ({
  id: `b${n}`, kind: "statement", title: `A made-up statement ${n}`, publisher: "Example Institute", url: `https://example.org/statement/${n}`,
  doi: null, published_at: "2026-11-23",
});

const artefacts = (doi: string[] = []): Json => ({ doi, arxiv: [], lean: [], trial: [], pdb: [] });

// ── The draft ────────────────────────────────────────────────────────────────────────────────────

const newFinding = (ref: string, over: Json = {}): Json => ({
  ref,
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
  rung_history: [{ rung: "checked", date: "2026-11-20", source_id: "s1", note: null }],
  sources: [draftSource(1), draftSource(2)],
  reactions: [{ source_id: "s2", who: "A. Reviewer", affiliation: "Example University", quote: "a careful result" }],
  artefacts: artefacts(["10.1234/example.1"]),
  figure: null,
  who: [{ name: "Example Lab", ror: null }],
  terms: [{ new: true, term: "protein folding", definition: "How a chain of amino acids curls into a shape." }, { new: false, id: "enzyme" }],
  related: ["math-2026-0002"],
  first_published: "2026-11-20",
  ...over,
});

const noRoleFinding = (ref: string): Json => {
  const f = newFinding(ref, {
    field: "earth", subfield: "ecology", kind: "check", title: "A sample soil check", significance: "notable",
    ai: { role: "none", confidence: null, systems: [], evidence: [] },
    go_deeper: ["s1"], rung_history: [{ rung: "checked", date: "2026-11-19", source_id: "s1", note: "Posted by Example Journal." }],
    sources: [draftSource(1, { url: "https://example.org/paper/7", doi: null })], reactions: [], artefacts: artefacts(), terms: [],
    related: [], first_published: "2026-11-19",
  });
  f.explainer.ai_helped = null;
  return f;
};

/** The Tuesday draft described in the header. */
export function weekdayDraft(): DraftBrief {
  return DraftBrief.parse({
    schema_version: 1,
    date: D,
    generated_at: "2026-11-24T04:10:00+08:00",
    lead: [
      { text: "A sample protein result leads today.", refs: ["new-1", "new-2"] },
      { text: "A proof is now published.", refs: ["math-2026-0002"] },
    ],
    story: "new-1",
    items: ["new-2", "math-2026-0002"],
    new_findings: [newFinding("new-1"), noRoleFinding("new-2")],
    returning: [{
      finding_id: "math-2026-0002", update: "A journal published the proof.", source_ids: ["b1"],
      rung: { rung: "checked", date: "2026-11-23", source_id: "b1", note: "Published by Example Journal." },
    }],
    rung_changes: [{ finding_id: "phys-2026-0003", rung: { rung: "disputed", date: "2026-11-23", source_id: "b2", note: "The lab posted a notice." } }],
    ideas: [{ text: "A made-up argument about method.", who: "A. Example", source_id: "b2" }],
    also: [{ title: "A made-up soil study", field: "earth", source_id: "b3" }],
    deep_dive: null,
    review: null,
    corrections: [
      { finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "correction", path: "significance", after: "major",
        reason: "The result is Major.", source_url: null, report_id: "R-0002" },
      { finding_id: "phys-2026-0003", edition_date: null, term_id: null, type: "correction", path: "field", after: "chemistry",
        reason: "The field was wrong.", source_url: null, report_id: null },
      { finding_id: "phys-2026-0003", edition_date: null, term_id: null, type: "correction", path: "subfield", after: "catalysis",
        reason: "The subfield was wrong.", source_url: null, report_id: null },
    ],
    report_decisions: [
      { report_id: "R-0001", outcome: "rejected", reason: "The source says this.", correction: null },
      { report_id: "R-0002", outcome: "upheld", reason: "The rating was too low.", correction: 0 },
    ],
    sources: [briefSource(1), briefSource(2), briefSource(3)],
  });
}

/**
 * The Tuesday draft with its significance correction raised to Landmark, which `math-2026-0002` is then on D: its returning update,
 * its rung note and its corrected text are a Landmark's. The story is Major, so a draft filed so fails STORY_PICK: a test that runs the
 * structure rules starts from `weekdayDraft()`.
 */
export function landmarkDraft(): DraftBrief {
  const draft = structuredClone(weekdayDraft()) as Json;
  draft.corrections[0].after = "landmark";
  draft.corrections[0].reason = "The result is a Landmark.";
  return DraftBrief.parse(draft);
}

// ── The context ──────────────────────────────────────────────────────────────────────────────────

const storedForContext = (id: string, over: Json = {}): Json => ({
  id,
  title: "A made-up proof",
  field: "mathematics",
  kind: "result",
  significance: "notable",
  explainer: {
    found: "A made-up system found a proof.",
    matters: "It shows what the method can do.",
    ai_helped: "The system searched for the proof.",
    how_sure: "Checked by a proof assistant.",
    background: "A made-up background.",
    could_lead: "Other proofs may follow.",
  },
  ai: {
    role: "ai_solved",
    confidence: "confirmed",
    systems: [{ name: "Example Prover", maker: "Example Lab" }],
    evidence: [{ source_id: "s1", quote: "The system found the proof.", from_claimant: false }],
  },
  rung_history: [{ rung: "preprint", date: "2026-10-01", recorded: "2026-10-02", source_id: "s1", by: "agent", note: null }],
  since_then: [{ date: "2026-10-20", text: "A journal accepted the paper.", source_ids: ["s1"] }],
  sources: [{
    id: "s1", kind: "preprint", title: "A made-up proof", publisher: "arXiv", url: "https://example.org/preprint/1", doi: null,
    published_at: "2026-10-01", seen_as: "pack", added: "2026-10-02",
  }],
  first_published: "2026-10-02",
  ...over,
});

const recent = (id: string, field: string, rung: string, significance: string): Json => ({
  id, title: `A made-up result of ${id}`, field, rung, significance, artefacts: artefacts(),
});

const contextBase = (): Json => ({
  date: D,
  format: "daily",
  window: { start: "2026-11-23T04:00:00+08:00", end: "2026-11-24T03:00:00+08:00" },
  deadline: "2026-11-24T04:15:00+08:00",
  budgets: {
    web_fetches: 12, findings_max: 5, typical_findings: [3, 5], deep_read_max: 5, words_target: 1000, words_max: 1300,
    reading_grade_soft: 12, reading_grade_max: 14,
  },
  candidates: [],
  pace: { sentence: "The Pace: 8.4% of papers named AI methods.", quotable: { "pace.leading.pooled.window": "8.4%" } },
  recent_findings: [
    recent("math-2026-0002", "mathematics", "preprint", "notable"),
    recent("phys-2026-0003", "physics", "preprint", "major"),
    recent("chem-2026-0004", "chemistry", "checked", "major"),
    recent("bio-2026-0001", "biology", "checked", "major"),
  ],
  ledger_for_sunday: [],
  week: null,
  rung_proposals: [{
    finding_id: "phys-2026-0003", kind: "journal_version", to: "confirmed", date: "2026-11-20", url: "https://example.org/journal/1",
    note: "A journal version of the paper was found.",
  }],
  corrections: { flagged: [{ finding_id: "chem-2026-0004", edition_date: null, term_id: null, path: "explainer.found", code: "DUAL_USE" }] },
  reports: [
    { id: "R-0001", status: "open", finding_id: "bio-2026-0001", kind: "fact", evidence_url: null, finding: storedForContext("bio-2026-0001", { field: "biology", significance: "major" }) },
    { id: "R-0002", status: "upheld", finding_id: "math-2026-0002", kind: "fact", evidence_url: null, finding: storedForContext("math-2026-0002") },
  ],
  standing_stories: [{ id: "erdos-problems", finding_ids: ["math-2026-0002", "hum-2026-0005"], rule: "Return only on a newly solved problem." }],
  pack: { md: "packs/2026-11-24.md", json: "packs/2026-11-24.json", degraded: false, failed_feeds: [] },
  config: {
    hype_words: ["breakthrough"],
    jargon: ["transformer"],
    field_cap: 2,
    fields: [
      { id: "biology", subfields: [{ id: "proteins", name: "Proteins" }, { id: "genomics", name: "Genomics" }] },
      { id: "earth", subfields: [{ id: "ecology", name: "Ecology" }] },
      { id: "chemistry", subfields: [{ id: "catalysis", name: "Catalysis" }] },
    ],
    source_kinds: [{ id: "paper", label: "Paper", means: "a peer-reviewed paper" }],
    allowlist: [{ id: "arxiv", name: "arXiv", hosts: ["arxiv.org"], kinds: ["preprint"] }],
  },
});

/** The Tuesday's context: no week, no Sunday candidates. */
export function weekdayContext(): AgentContext {
  return AgentContext.parse(contextBase());
}

/** A Monday's context with `n` findings in its week (a week of fewer than 3 is a short one). */
export function mondayContext(n = 3): AgentContext {
  const findings = ["math-2026-0002", "phys-2026-0003", "chem-2026-0004", "bio-2026-0001"].slice(0, n).map((id) => ({
    id, title: `A made-up result of ${id}`, field: "mathematics", kind: id === SETBACK ? "setback" : "result", significance: id === SETBACK ? "major" : "notable",
    rung: "checked",
  }));
  return AgentContext.parse({
    ...contextBase(),
    date: MONDAY,
    format: "monday_review",
    week: {
      findings,
      rung_changes: [{ finding_id: "phys-2026-0003", from: "preprint", to: "disputed", date: "2026-11-20", by: "agent" }],
      setbacks: [SETBACK],
      field_counts: FIELDS.map((field) => ({ field, reported: 1, counted: 1 })),
    },
  });
}

/** A Sunday's context with two Ledger candidates for the deep dive. */
export function sundayContext(): AgentContext {
  return AgentContext.parse({
    ...contextBase(),
    date: SUNDAY,
    format: "sunday_deep_dive",
    ledger_for_sunday: [
      { ...storedForContext("bio-2024-0007", { field: "biology", significance: "landmark" }), reasons: ["anniversary", "rotation"] },
      { ...storedForContext("math-2025-0009"), reasons: ["rotation"] },
    ],
  });
}

// ── Evidence, pack, metrics ──────────────────────────────────────────────────────────────────────

/** The run's evidence: the pages of the draft's sources, as the pack and the snapshots gave them. */
export function evidence(): Evidence {
  const urls = [1, 2, 7].map((n) => `https://example.org/paper/${n}`).concat([1, 2, 3].map((n) => `https://example.org/statement/${n}`));
  const texts: Record<string, string> = {};
  for (const url of urls) texts[normalizeUrl(url)] = `Page text of ${url}. the system solved it.`;
  return Evidence.parse({
    urls, fetched: urls.slice(0, 3), texts,
    seen_as: Object.fromEntries(urls.map((u) => [normalizeUrl(u), "pack"])), types: {}, resolved: {},
  });
}

export function pack(): Pack {
  return Pack.parse({
    schema_version: 1,
    date: D,
    window: { start: "2026-11-23T04:00:00+08:00", end: "2026-11-24T03:00:00+08:00" },
    generated_at: "2026-11-24T03:16:00+08:00",
    arxiv_announcement: null,
    degraded: false,
    feeds: [{ id: "nature", kind: "api", ok: true, stale: false, newest: "2026-11-23T20:00:00+08:00", items_total: 40, items_kept: 1, error: null, sha256: "a".repeat(64) }],
    candidates: [{
      id: "cand-01", source_id: "nature", title: "A made-up paper 1", abstract: "A made-up abstract.", url: "https://example.org/paper/1",
      doi: "10.1234/example.1", arxiv: null, trial: [], published_at: "2026-11-23T09:00:00+08:00", journal: "Example Journal", fields: ["biology"],
      ai_terms_matched: ["machine learning"], journal_leading: true, types: ["research-article"], stored_finding: null, flags: [], score: 7.5, deep_read: true,
    }],
    injection_flags: 0,
  });
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

const share = (k: number, n: number): Json => {
  const value = round4(k / n);
  return { k, n, share: value, ci80: [round4(Math.max(0, value - 0.01)), round4(Math.min(1, value + 0.01))] };
};

const paceCell = (): Json => ({ window: share(84, 1000), baseline: share(20, 1000), year_ago: share(50, 1000), vs_baseline: "higher", vs_year_ago: "up" });

export function metrics(): MetricsFile {
  const to = "2026-11-15";
  const from = addDays(to, -90);
  return MetricsFile.parse({
    schema_version: 1,
    date: D,
    computed_at: "2026-11-24T03:20:00+08:00",
    data_cutoff: SUNDAY,
    versions: { ai_terms: 1, journals: 1, fields: 1, counters: 1 },
    status: "ok",
    pace: {
      window: { from, to },
      provisional_from: addDays(to, 1),
      baseline: { from: "2015-01-05", to: "2019-12-29" },
      year_ago: { from: addDays(from, -364), to: addDays(to, -364) },
      leading: { pooled: paceCell(), by_field: Object.fromEntries(FIELDS.map((f) => [f, paceCell()])) },
      all: { pooled: paceCell(), by_field: Object.fromEntries(FIELDS.map((f) => [f, paceCell()])) },
      sentence: l("The Pace: 8.4% of papers named AI methods."),
      quotable: { "pace.leading.pooled.window": "8.4%" },
    },
    landmarks: { by_year: [], baseline: { ai: 0, all: 0 } },
    hold: { cases: 0, held: 0, fell: 0, open: 0, too_few: true },
    counters: [],
  });
}

/** Everything `validateDraft()` takes besides the draft, for the Tuesday. */
export function draftInputs(): { context: AgentContext; evidence: Evidence; metrics: MetricsFile; pack: Pack; config: LoadedConfig } {
  return { context: weekdayContext(), evidence: evidence(), metrics: metrics(), pack: pack(), config: config() };
}

// ── The stored edition ───────────────────────────────────────────────────────────────────────────

const storedSources = (): Json[] => [
  { id: "s1", kind: "paper", title: "A made-up paper", publisher: "Example Journal", url: "https://example.org/paper/1", doi: "10.1234/example.1", published_at: "2026-11-20", seen_as: "pack", added: "2026-11-24" },
  { id: "s2", kind: "preprint", title: "A made-up preprint", publisher: "arXiv", url: "https://example.org/preprint/1", doi: null, published_at: "2026-10-01", seen_as: "search", added: "2026-11-24" },
];

/** A stored finding: `bio-2026-0001` is the Tuesday's story, a biology result in both languages. */
export function storedFinding(id = "bio-2026-0001", over: Json = {}): Finding {
  const field = id.startsWith("math") ? "mathematics" : id.startsWith("phys") ? "physics" : id.startsWith("chem") ? "chemistry" : "biology";
  return Finding.parse({
    schema_version: 1,
    id,
    field,
    subfield: field === "mathematics" ? "formal-proof" : field === "physics" ? "atoms-optics" : field === "chemistry" ? "catalysis" : "proteins",
    kind: "result",
    title: lz("A sample protein result", "範例蛋白質成果"),
    depth: "story",
    explainer: {
      found: lz("Sample found text.", "範例發現。"),
      matters: lz("Sample matters text.", "範例意義。"),
      ai_helped: lz("Sample System 3, from Example Lab, did the work.", "範例系統三號完成了這項工作。"),
      how_sure: lz("Checked by Example Journal.", "範例期刊已查核。"),
      background: lz("Sample background text.", "範例背景。"),
      could_lead: lz("It could lead to sample uses.", "它可能帶來範例用途。"),
    },
    go_deeper: ["s1"],
    ai: {
      role: "ai_solved", confidence: "confirmed", systems: [{ name: "Sample System 3", maker: "Example Lab" }],
      evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: false }],
    },
    significance: "major",
    rung: "checked",
    rung_history: [
      { rung: "preprint", date: "2026-10-01", recorded: "2026-10-05", source_id: "s2", by: "agent", note: null },
      { rung: "checked", date: "2026-11-20", recorded: D, source_id: "s1", by: "agent", note: lz("Published in Example Journal.", "已刊登於範例期刊。") },
    ],
    since_then: [{ date: "2026-11-23", text: lz("A later sample fact.", "後續範例事實。"), source_ids: ["s1"] }],
    sources: storedSources(),
    reactions: [{ source_id: "s2", who: "A. Reviewer", affiliation: "Example University", quote: "a careful result" }],
    artefacts: artefacts(["10.1234/example.1"]),
    figure: null,
    who: [{ name: "Example Lab", ror: null }],
    terms: ["protein-folding"],
    related: ["bio-2026-0002"],
    first_published: "2026-10-01",
    first_brief: D,
    briefs: [D],
    history: false,
    disclosure: false,
    applications: [],
    updated: D,
    ...over,
  });
}

export function storedTerm(): Term {
  return Term.parse({
    id: "protein-folding",
    en: { term: "protein folding", definition: "How a chain of amino acids curls into a shape." },
    zh: { term: "蛋白質摺疊", definition: "一串胺基酸捲成立體形狀的過程。", official: null, official_url: null },
    fields: ["biology"],
    first_finding: "bio-2026-0001",
    first_date: D,
  });
}

/** Stored corrections: an older one that made `math-2026-0002` Major, and one dated D that refiles `phys-2026-0003`'s field. */
export function storedCorrections(): Correction[] {
  const make = (id: string, date: string, finding: string, path: string, after: string): Correction => Correction.parse({
    id, date, finding_id: finding, edition_date: null, term_id: null, type: "correction", path,
    before: l("before"), after: l(after), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
  });
  return [
    make("C-0001", "2026-11-10", "math-2026-0002", "significance", "major"),
    make("C-0002", D, "phys-2026-0003", "field", "chemistry"),
  ];
}

/**
 * Writes REMOVED_TEXT where each stored `removed` correction of a world names, in the record it names, as publishing leaves it (SPEC §4.12
 * "Removed text"): an `L10n` in both languages, a plain string in English, a term's `definition` in both languages (its Chinese too while
 * the term has any). A rule skips a string only where the record holds the marker, so a test that files a `removed` correction calls this
 * over the same world. A correction that names no record of the world, or a path the record has no value at, is left alone. Mutates `world`.
 */
export function holdRemoved(world: { brief?: Brief | null; findings: Finding[]; terms: Term[]; corrections: readonly Correction[] }): void {
  for (const c of world.corrections) {
    if (c.type !== "removed") continue;
    if (c.term_id !== null) {
      const term = world.terms.find((t) => t.id === c.term_id);
      if (term === undefined || c.path !== "definition") continue;
      term.en.definition = REMOVED_TEXT.en;
      if (term.zh !== null) term.zh.definition = REMOVED_TEXT.zh;
      continue;
    }
    const record: unknown = c.finding_id !== null ? world.findings.find((f) => f.id === c.finding_id)
      : world.brief != null && world.brief.date === c.edition_date ? world.brief : undefined;
    if (record === undefined) continue;
    const segments = c.path.split(".");
    const last = segments.pop()!;
    let at: any = record;
    for (const key of segments) at = at === null || typeof at !== "object" ? undefined : at[key];
    if (at === null || typeof at !== "object" || !(last in at) || at[last] === null) continue;
    const value = at[last];
    at[last] = typeof value === "object" && Object.keys(value).join(",") === "en,zh" ? { ...REMOVED_TEXT } : REMOVED_TEXT.en;
  }
}

export function storedReports(): Report[] {
  return [Report.parse({
    id: "R-0001", received: "2026-11-23T10:00:00+08:00", issue_number: 12, finding_id: "bio-2026-0001", kind: "fact", evidence_url: null,
    status: "rejected", decided_by: "claude", resolved_on: D, reason: l("The source says this."), correction_id: null,
  })];
}

/** The stored Tuesday: a full edition in both languages with the story, one new item and one returning item. */
export function storedBrief(): Brief {
  return Brief.parse({
    schema_version: 1,
    date: D,
    edition: "full",
    format: "daily",
    languages: { en: true, zh: true },
    published_at: "2026-11-24T04:12:30+08:00",
    late: false,
    pace: { sentence: lz("The Pace: 8.4% of papers named AI methods.", "進度：8.4% 的論文提到 AI 方法。"), status: "ok", metrics_file: `metrics/${D}.json` },
    lead: [{ text: lz("A sample protein result leads today.", "今天的重點是一項範例蛋白質成果。"), finding_ids: ["bio-2026-0001"] }],
    story: { finding_id: "bio-2026-0001", new: true, update: null },
    items: [
      { finding_id: "math-2026-0002", new: true, update: null },
      { finding_id: "phys-2026-0003", new: false, update: lz("A journal published the paper.", "期刊刊出了這篇論文。") },
    ],
    rung_changes: [{ finding_id: "phys-2026-0003", from: "preprint", to: "checked", date: "2026-11-23", by: "script" }],
    ideas: [{ text: lz("A made-up argument about method.", "一項關於方法的範例論點。"), who: "A. Example", source_id: "b1" }],
    also: [{ title: lz("A made-up soil study", "一項範例土壤研究"), field: "earth", source_id: "b2" }],
    deep_dive: null,
    review: null,
    corrections: [{ id: "C-0002", finding_id: "phys-2026-0003", edition_date: null, term_id: null, type: "correction", reason: lz("The field was wrong.", "領域有誤。") }],
    reports: [{ id: "R-0001", finding_id: "bio-2026-0001", status: "rejected" }],
    sources: [
      { id: "b1", kind: "statement", title: "A made-up statement", publisher: "Example Institute", url: "https://example.org/statement/1", doi: null, published_at: "2026-11-23", seen_as: "pack", added: D },
      { id: "b2", kind: "statement", title: "A made-up statement", publisher: "Example Institute", url: "https://example.org/statement/2", doi: null, published_at: "2026-11-23", seen_as: "pack", added: D },
    ],
    disclosure: [],
    status_note: null,
    computed: { word_count: 812, zh_chars: 1304, finding_count: 3, source_count: 2 },
    provenance: { run_id: "20261124-031500", code_commit: "a".repeat(40), data_cutoff: SUNDAY },
  });
}

/** The stored records of the Tuesday: three findings (a biology story, a new maths item, a returning physics item), the glossary term, the corrections and the report. */
export function storedWorld(): { brief: Brief; findings: Finding[]; terms: Term[]; corrections: Correction[]; reports: Report[]; config: LoadedConfig } {
  const math = storedFinding("math-2026-0002", { depth: "item", title: l("A made-up proof"), first_brief: D, briefs: [D], terms: [] });
  // Last changed the day before D, so the Tuesday adds no text to it: a stored finding that is not being published (a finding whose
  // `updated` is D and that holds an entry dated D is, F-17; a test of a returning finding sets `updated: D`).
  const phys = storedFinding("phys-2026-0003", { depth: "item", first_brief: "2026-11-10", briefs: ["2026-11-10", D], updated: "2026-11-23" });
  return {
    brief: storedBrief(),
    findings: [storedFinding("bio-2026-0001"), math, phys],
    terms: [storedTerm()],
    corrections: storedCorrections(),
    reports: storedReports(),
    config: config(),
  };
}
