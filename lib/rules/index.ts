// The rule registry (SPEC §4.12): every rule group in the rule table's order, the table of every code the spec names and
// the helpers that connect them. The engine (run.ts) runs RULES in this order and filters by mode, scope and the inputs a
// rule needs. A new group file gets a line in RULE_GROUPS; a new rule inside a group needs nothing here, but a code a group
// reports must be in RULE_CODE_TABLE, in that group, with the modes it runs in (tests/rules-frame.test.ts holds the registry
// to the spec's table and to the rules' own declarations).
//
// `SCHEMA` is the engine's, `SEED_SOURCES` is reported by the ledger seeder (SPEC §8.13, P2) and every other code belongs to
// one group. The nine group files are scaffolds until their authors write them.
//
// Cyber's lib/rules/index.ts at the fork commit 3ced1fb, adapted: `RuleGroup`, `RULE_GROUPS`, `RULES` and `ruleCodes()` are
// Cyber's with this project's nine groups; `RULE_CODE_TABLE` is new.

import { groundingRules } from "./grounding";
import { historyRules } from "./history";
import { ladderAiRules } from "./ladder-ai";
import { publishedRules } from "./published";
import { safetyRules } from "./safety";
import { sourcesRules } from "./sources";
import { structureRules } from "./structure";
import type { Rule } from "./types";
import { wordsRules } from "./words";
import { zhRules } from "./zh";

export const RULE_GROUP_NAMES = ["structure", "history", "ladder-ai", "sources", "grounding", "words", "safety", "zh", "published"] as const;
export type RuleGroupName = (typeof RULE_GROUP_NAMES)[number];

export interface RuleGroup {
  /** The group file under lib/rules/, without ".ts". */
  group: RuleGroupName;
  rules: readonly Rule[];
}

export const RULE_GROUPS: readonly RuleGroup[] = [
  { group: "structure", rules: structureRules }, // Dates, refs, sections, counts, caps, ids
  { group: "history", rules: historyRules }, // Subfields, duplicates, returning entries, reports
  { group: "ladder-ai", rules: ladderAiRules }, // The Verification Ladder and the AI role
  { group: "sources", rules: sourcesRules }, // Primary sources, URLs, the figure's licence
  { group: "grounding", rules: groundingRules }, // Artefacts, quotes, numbers
  { group: "words", rules: wordsRules }, // Budgets, sentences, reading level, dashes, jargon, hype
  { group: "safety", rules: safetyRules }, // Dual-use text, secrets, the canary, blocked hosts
  { group: "zh", rules: zhRules }, // The Chinese edition
  { group: "published", rules: publishedRules }, // Cross-references, language parity, the file layout
];

/** Every rule, in registry order. */
export const RULES: readonly Rule[] = RULE_GROUPS.flatMap((g) => g.rules);

/** Every code some rule of `rules` reports, in registry order (the engine's own codes are not included). */
export function ruleCodes(rules: readonly Rule[] = RULES): string[] {
  return [...new Set(rules.flatMap((r) => r.codes))];
}

// ── The table of codes ───────────────────────────────────────────────────────────────────────────

/** H fails the draft or the record; S goes to the repair prompt and is recorded but never blocks; H/S is S above one bound and H above another (READING_LEVEL). */
export type RuleSeverityKind = "H" | "S" | "H/S";
/** Where a code is reported: the three rule modes, and `seed` for the ledger seeds (SPEC §8.13), which ledger-seed.ts validates. */
export type RuleScope = "draft" | "published" | "zh" | "seed";
/** How the spec tests it (SPEC §4.12 "Fixtures"): F an `invalid--<CODE>.json` fixture, S a `soft--<CODE>.json` one, T named cases in tests/validate.test.ts, Z an `invalid--<CODE>.zh.json` Chinese fixture. */
export type RuleTestKind = "F" | "S" | "T" | "Z";

export interface RuleCodeInfo {
  readonly code: string;
  readonly severity: RuleSeverityKind;
  /** Every mode the code is reported in; a rule that reports it may run in these modes only. */
  readonly scopes: readonly RuleScope[];
  readonly tests: readonly RuleTestKind[];
  /** The group that reports it: `engine` for SCHEMA (the frame's), `seed` for SEED_SOURCES (ledger-seed.ts, P2). */
  readonly group: RuleGroupName | "engine" | "seed";
}

const row = (
  code: string, severity: RuleSeverityKind, scopes: readonly RuleScope[], tests: readonly RuleTestKind[], group: RuleCodeInfo["group"],
): RuleCodeInfo => ({ code, severity, scopes, tests, group });

const DP: readonly RuleScope[] = ["draft", "published"];
const DPZ: readonly RuleScope[] = ["draft", "published", "zh"];
const ZP: readonly RuleScope[] = ["zh", "published"];

/**
 * Every code of SPEC §4.12's table, in its order (a row that holds two codes, SECRET_LIKE and CANARY, is two entries). The
 * scopes are the spec's "Stored records" reading: a test on the run's own inputs (the context, evidence, pack or metrics) runs
 * in draft mode only, the rest on stored records too; the Chinese tests run on the Chinese draft, and on stored records those
 * of them that read no input. tests/rules-frame.test.ts compares this table with SPEC.md's.
 */
export const RULE_CODE_TABLE: readonly RuleCodeInfo[] = [
  row("SCHEMA", "H", DPZ, ["F", "Z"], "engine"),
  row("DATE_MISMATCH", "H", DP, ["F"], "structure"),
  row("REF_UNKNOWN", "H", ["draft"], ["F"], "structure"),
  row("FORMAT_SECTIONS", "H", DP, ["F", "T"], "structure"),
  row("WEEK_AGAINST", "H", DP, ["T"], "structure"),
  row("COUNTS", "H", DP, ["F"], "structure"),
  row("FIELD_CAP", "H", DP, ["F"], "structure"),
  row("SUBFIELD_UNKNOWN", "H", ["draft", "published", "seed"], ["F", "T"], "history"),
  row("STORY_PICK", "H", DP, ["F"], "structure"),
  row("DUPLICATE", "H", ["draft"], ["F"], "history"),
  row("RETURN_NEW_FACT", "H", ["draft"], ["F"], "history"),
  row("SOURCE_IDS", "H", DP, ["F"], "structure"),
  row("PRIMARY_ONLY", "H", DP, ["F"], "sources"),
  row("SOURCE_SEEN", "H", ["draft"], ["F"], "sources"),
  row("SOURCE_URL", "H", DP, ["F"], "sources"),
  row("GO_DEEPER", "H", DP, ["F"], "sources"),
  row("ARTEFACT_FORMAT", "H", DP, ["F"], "grounding"),
  row("RUNG_EVIDENCE", "H", DP, ["F"], "ladder-ai"),
  row("RUNG_ORDER", "H", DP, ["F"], "ladder-ai"),
  row("CLAIMED_CAP", "H", DP, ["F"], "ladder-ai"),
  row("LANDMARK_BASIS", "H", DP, ["F"], "ladder-ai"),
  row("NON_AI_LANDMARK_ONLY", "H", DP, ["F"], "ladder-ai"),
  row("SETBACK_MAJOR", "H", DP, ["F"], "ladder-ai"),
  row("AI_CONFIDENCE", "H", DP, ["F"], "ladder-ai"),
  row("AI_SYSTEM_NAMED", "H", DP, ["F"], "ladder-ai"),
  row("QUOTE_VERBATIM", "H", DP, ["F"], "grounding"),
  row("NUMBER_SOURCED", "H", ["draft"], ["F"], "grounding"),
  row("WHO_SAYS", "H", DP, ["F"], "ladder-ai"),
  row("POSSIBILITY", "H", DP, ["F"], "ladder-ai"),
  row("FIGURE_LICENCE", "H", DP, ["F"], "sources"),
  row("WORDS", "H", DP, ["F", "S", "T"], "words"),
  row("SENTENCE_LENGTH", "H", DP, ["F"], "words"),
  row("HYPE_WORDS", "H", DP, ["F"], "words"),
  row("TERM_DEFINED", "H", DP, ["F"], "words"),
  row("READING_LEVEL", "H/S", DP, ["F", "S"], "words"),
  row("NO_EM_DASH", "H", DP, ["F"], "words"),
  row("DUAL_USE", "H", DPZ, ["F", "T", "Z"], "safety"),
  row("SECRET_LIKE", "H", DPZ, ["F", "Z"], "safety"),
  row("CANARY", "H", DPZ, ["F", "Z"], "safety"),
  row("BLOCKED_HOST", "H", DP, ["F"], "safety"),
  row("REPORT_DECISION", "H", ["draft"], ["F"], "history"),
  row("REPORT_UPHELD", "S", ["draft"], ["S"], "history"),
  row("ZH_KEYS", "H", ["zh"], ["Z"], "zh"),
  row("ZH_PARITY", "H", ["zh"], ["Z"], "zh"),
  row("ZH_TRADITIONAL", "H", ZP, ["Z"], "zh"),
  row("ZH_AVOID", "H", ZP, ["Z"], "zh"),
  row("ZH_TERMS", "H", ZP, ["Z"], "zh"),
  row("ZH_RUNG_LABEL", "H", ["zh", "seed"], ["Z"], "zh"),
  row("ZH_ENGLISH_ONCE", "H", ZP, ["Z"], "zh"),
  row("ZH_CHARS", "H", ZP, ["Z"], "zh"),
  row("ZH_OFFICIAL", "H", ["zh"], ["Z"], "zh"),
  row("ZH_NO_DASH", "H", ZP, ["Z"], "zh"),
  row("ZH_HYPE", "H", ZP, ["Z"], "zh"),
  row("XREF", "H", ["published"], ["T"], "published"),
  row("LANG_PARITY", "H", ["published"], ["T"], "published"),
  row("FILE_LAYOUT", "H", ["published"], ["T"], "published"),
  row("SEED_SOURCES", "H", ["seed"], ["T"], "seed"),
];

/** The table's entry for a code, or undefined. */
export const codeInfo = (code: string): RuleCodeInfo | undefined => RULE_CODE_TABLE.find((r) => r.code === code);

/** The codes the table assigns to a group, in table order. */
export const codesOfGroup = (group: RuleGroupName): string[] => RULE_CODE_TABLE.filter((r) => r.group === group).map((r) => r.code);

/**
 * The codes of the rule groups (not SCHEMA, which is the engine's, nor SEED_SOURCES, which the seeder reports) that no rule
 * of `groups` reports: empty once every group is written. Takes the groups as an argument so a test can pass its own.
 */
export function uncoveredCodes(groups: readonly RuleGroup[] = RULE_GROUPS): string[] {
  const reported = new Set(groups.flatMap((g) => ruleCodes(g.rules)));
  return RULE_CODE_TABLE.filter((r) => r.group !== "engine" && r.group !== "seed" && !reported.has(r.code)).map((r) => r.code);
}
