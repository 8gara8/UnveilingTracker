// The Chinese pass's entry point of the validator (SPEC §4.12, §8.2 stage 8, §8.6): `validateZh(zh, en, inputs, options?)` judges the
// Chinese draft (`drafts/D.zh.json`, `DraftZh`) against the English draft it translates, the Chinese context stage 8 built from it
// and the pass's evidence (the 樂詞網 pages it fetched), and returns the same `ValidationResult` as `validateDraft()`.
//
// Order. The Chinese draft is parsed with `DraftZh` and the English one with `DraftBrief`; a draft that fails is judged by its SCHEMA
// issues alone and no rule runs, so the repair prompt never mixes a malformed file's schema errors with rule errors that read it. The
// strings of the Chinese draft are read too (`invisibleIssues()`, lib/validate.ts): one that holds an invisible character is one more
// SCHEMA issue, whether or not either draft passed its schema; the English draft's strings are not read again here. The
// English draft's issues have `en.` in front of their paths and say that they are about the English draft, since a Chinese pass that
// reads them could take them for its own. A draft that parses gets the zh-mode input of `buildZhInput()` (the views of the English
// draft and of the findings the backlog translates, and the string inventory of the Chinese one, built once) and every registered
// rule that lists the `zh` mode: the ZH_ rules of lib/rules/zh.ts and the safety rules that read either draft. `validateZh()` fetches nothing, reads no file and no clock; the
// morning's stage 8 and scripts/validate.ts hand it parsed objects (`ZhInputs`).
//
// New for this project; Cyber has no Chinese pass. The shape (parse first, SCHEMA alone on a failure, then the registered rules,
// a rule that throws becomes one RULE_ERROR issue) is lib/validate.ts `validateDraft()`'s, which is Cyber's idea.

import type { LoadedConfig } from "./config";
import { weekday } from "./dates";
import { compareFindingIds } from "./ids";
import { draftFilings } from "./items";
import { RULES } from "./rules/index";
import { runRules } from "./rules/run";
import { editionKindOf } from "./rules/shared";
import { parseZhKey, zhInventory } from "./rules/strings";
import { error, type Rule, type StoredRecords, type ValidationIssue, type ZhInput } from "./rules/types";
import { buildViews } from "./rules/views";
import { ID_PATTERNS } from "./schema/common";
import { DraftBrief } from "./schema/draft";
import { DraftZh, type ZhContext } from "./schema/draft-zh";
import type { Evidence } from "./schema/misc";
import { formatForWeekday } from "./vocab";
import { doorIssues, invisibleIssues, schemaIssues, toResult, type ValidationResult } from "./validate";

/**
 * Everything `validateZh()` reads besides the two drafts. Each field is a parsed object, never a file; the callers fill it:
 * - `context`: the Chinese context of the edition (SPEC §4.6), the copy stage 8 holds in memory, or `logs/D.zh-context.json` for a
 *   file run (`--zh-context`); never the agent-writable `drafts/D.zh-context.json`, which scripts/validate.ts refuses (§8.6).
 * - `evidence`: `logs/D.zh-evidence.json` (`--zh-evidence`): the pass's transcript and stage 8's snapshots of the 樂詞網 pages it
 *   fetched, with an empty pack. Absent or null skips ZH_OFFICIAL's page checks, with one INPUT_MISSING warning that says so; the
 *   host check still runs. Each of the file's missing inputs is a usage error of the CLI, naming its flag; the engine itself only warns.
 * - `stored`: the stored findings the edition's Chinese is about, from `content/` as the English form reads them
 *   (`DraftInputs.stored`), with every stored correction and glossary term: the findings the English draft names and those of the
 *   backlog (`zhBacklogIds()` of the context's keys). It lets ZH_HYPE know that a finding's text is a Landmark's and DUAL_USE know
 *   a finding's field, as for the English draft. A finding it lacks is still in the views, as a partial one that knows no fact,
 *   and a rule skips what it cannot know: ZH_HYPE does not judge 突破 in its text (every other hype word still fails), DUAL_USE
 *   does not read its numbered steps. So a run given no `stored` raises no false error for a finding the views cannot resolve,
 *   and judges only what the drafts and the context hold.
 * - `config`: `config/` as loaded by lib/config.ts: the Traditional character lists, the avoid and fixed terms, the hype words and
 *   `run.json`'s budgets (the page total of ZH_CHARS is `words_max` times `zh_factor`).
 */
export interface ZhInputs {
  context: ZhContext;
  evidence?: Evidence | null;
  stored?: StoredRecords | null;
  config: LoadedConfig;
}

/** How a run is made, as opposed to what it reads. */
export interface ZhOptions {
  /** The date in a `YYYY-MM-DD.zh.json` file name, when a file is validated. */
  fileDate?: string | null;
  /** The rules to run; default every registered rule (tests pass their own). */
  rules?: readonly Rule[];
}

/** What `validateZh()` returns: the frame's `ValidationResult` and the parsed Chinese draft, null when it or the English draft failed its schema. */
export type ZhResult = ValidationResult & { draft: DraftZh | null };

/**
 * The ids of the findings whose own strings the keys name (SPEC §4.6: `backlog.<id>.title`, `.explainer.<part>`, `.since.<i>`,
 * `.figure.alt` and `.rung.<i>`): each id once, in `compareFindingIds` order. Every other key and a key whose id is no finding id are
 * left out, so the ids are safe to read records by. Pass the keys of a Chinese context (`context.strings`) to learn which stored
 * records a run needs for `ZhInputs.stored`, or those of a Chinese draft to learn which findings it translates.
 */
export function zhBacklogIds(keys: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const key of keys) {
    const info = parseZhKey(key);
    if (info?.section === "backlog" && ID_PATTERNS.finding.test(info.finding!)) ids.add(info.finding!);
  }
  return [...ids].sort(compareFindingIds);
}

/**
 * The zh-mode input of a rule for a parsed Chinese draft and the English draft it translates. D is the context's date. The edition
 * is the weekday's (a Monday counts as a full one: the Chinese pass has no week to tell a short one by). The views are those of the
 * English draft read without its context, so a finding the draft names is seen as the draft and `stored` show it, plus every
 * finding that a `backlog.<id>.*` key of the context or of the Chinese draft names (`zhBacklogIds()`), as a full view when `stored`
 * holds its record and else as a partial one; the corrections in force are the stored ones and then the English draft's own, dated
 * D, with the ids that publish will give them, as in draft mode.
 */
export function buildZhInput(draft: DraftZh, english: DraftBrief, inputs: ZhInputs, options: ZhOptions = {}): ZhInput {
  const { context } = inputs;
  const date = context.date;
  const stored = inputs.stored ?? null;
  const format = formatForWeekday(weekday(date));
  const filing = [...(stored?.corrections ?? []), ...draftFilings(english.corrections, stored?.corrections ?? [], date)];
  const keys = context.strings.map((s) => s.key);
  const listed = new Set(zhBacklogIds(keys));
  const backlog = zhBacklogIds([...keys, ...Object.keys(draft.strings)]).map((id) => ({ id, listed: listed.has(id) }));
  return {
    mode: "zh",
    date,
    fileDate: options.fileDate ?? null,
    edition: editionKindOf({ format }),
    format,
    config: inputs.config,
    filing,
    views: buildViews({ mode: "draft", date, draft: english, context: null, filing, stored, backlog }),
    inventory: zhInventory(draft, context),
    zh: { draft, context, english, evidence: inputs.evidence ?? null },
  };
}

const ENGLISH_HINT = "validateZh() judges a Chinese draft against a valid English draft: fix the English draft first (validate it on its own), then run the Chinese check again.";

/** The path of an English-draft schema issue as `validateZh()` reports it: `en.` in front, so it is never taken for a path of the Chinese draft. */
function englishPath(path: string): string {
  if (path === "(root)") return "en";
  return path.startsWith("[") ? `en${path}` : `en.${path}`;
}

/**
 * Validates the Chinese pass's draft: SCHEMA (`DraftZh` for `zh`, `DraftBrief` for `en`, and a string of `zh` that holds an invisible
 * character), then, when both parse and no string does, every registered rule that runs in zh mode. A draft that fails SCHEMA gives
 * its SCHEMA issues alone (the English draft's with `en.` in front of the path) and no rule runs; `draft` is then null. A missing
 * evidence gives one INPUT_MISSING warning and skips ZH_OFFICIAL's page checks; a rule that throws gives one RULE_ERROR issue and the
 * others still run.
 */
export function validateZh(zh: unknown, en: unknown, inputs: ZhInputs, options: ZhOptions = {}): ZhResult {
  const parsedZh = DraftZh.safeParse(zh);
  const parsedEn = DraftBrief.safeParse(en);
  const invisible = invisibleIssues(zh);
  if (!parsedZh.success || !parsedEn.success || invisible.listed.length > 0) {
    const issues: ValidationIssue[] = parsedZh.success ? [] : schemaIssues(parsedZh.error, zh);
    if (!parsedEn.success) {
      for (const issue of schemaIssues(parsedEn.error, en)) {
        issues.push({ ...issue, path: englishPath(issue.path), message: `English draft: ${issue.message}`, hint: ENGLISH_HINT });
      }
    }
    return { ...toResult(doorIssues(issues, invisible)), draft: null };
  }
  let issues: ValidationIssue[];
  try {
    issues = runRules(buildZhInput(parsedZh.data, parsedEn.data, inputs, options), options.rules ?? RULES);
  } catch (err) {
    const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    issues = [error("RULE_ERROR", "(engine)", `The validator could not read its inputs (${why}).`, "This is a fault in the validator or its inputs, not in the draft: report it.")];
  }
  return { ...toResult(issues), draft: parsedZh.data };
}
