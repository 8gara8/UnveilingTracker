// The four valid Chinese drafts (SPEC §4.6 "DraftZh and the Chinese edition", §4.12 "Fixtures and tests"): one for each edition of
// the fixture world, each the Chinese pass's one file (`drafts/D.zh.json`, a `DraftZh`) for the context `zh-inputs.ts` builds, and
// each passing every Chinese rule with no error and no warning. The weekday's, `valid-weekday.zh.json`, is the base of every
// `invalid--<CODE>.zh.json` mutation and ZH_CHARS's passing fixture: a full-length edition (a story, three items, a returning
// finding, a rung change, ideas, Also noted titles, two corrections and a report decision) with nine backlog findings, all its
// strings together well over 2,340 characters while the page total stays within them.
//   weekday       the story and three items, a returning update, a rung change, ideas, Also noted, corrections, a report decision,
//                 and 9 backlog findings (4 the edition names, 5 others)
//   sunday        one item, the deep dive on the antibiotic finding, and 6 backlog findings
//   monday        one item, the review of the week, and 8 backlog findings
//   monday-short  the review of a week with no finding (its big picture is the short one), and 5 backlog findings
//
// Nothing is written here: each Chinese string is the table's Chinese (`world-zh.ts`) of the English the context holds for its key,
// and each term's Chinese is the table's. So a draft is exactly the context's keys and exactly the context's terms whose `zh` is
// null (ZH_KEYS), and the same English is the same Chinese everywhere. The files of fixtures/drafts-zh/ this builder writes:
//   valid-<edition>.zh.json         the Chinese draft
//   <edition>.zh-context.json       the context it translates (`zh-inputs.ts`)
//   <edition>.zh-evidence.json      the evidence of the 樂詞網 pages its terms cite (`zh-inputs.ts`)
//   flags.txt                       the weekday's validator flags, on one line, as scripts/validate.ts takes them (SPEC §8.6)
// The Chinese invalid drafts (`invalid--<CODE>.zh.json`) are another generator's and live in the same folder.
//
// Cyber's fixtures/src/drafts.ts at the fork commit 3ced1fb, adapted: its cached builders (one cached draft for each edition, a deep
// copy for each caller) are the pattern; Cyber has no Chinese pass, so the draft itself is new.

import { jsonText } from "../../lib/json";
import { DraftZh, ZhContext } from "../../lib/schema/draft-zh";
import { Evidence } from "../../lib/schema/misc";
import type { Output } from "./build";
import { ZH_CLOCK, zhContext, zhEvidence } from "./zh-inputs";
import { EDITION_NAMES, type EditionName } from "./world";
import { ZH_TERM_TABLE, zhText } from "./world-zh";

// ── Paths ────────────────────────────────────────────────────────────────────────────────────────

/** The folder of the Chinese fixtures (one of the builder's owned folders). */
export const ZH_DIR = "fixtures/drafts-zh";

/** The path of an edition's valid Chinese draft. */
export const zhDraftPath = (name: EditionName): string => `${ZH_DIR}/valid-${name}.zh.json`;
/** The path of an edition's Chinese context. */
export const zhContextPath = (name: EditionName): string => `${ZH_DIR}/${name}.zh-context.json`;
/** The path of an edition's Chinese evidence. */
export const zhEvidencePath = (name: EditionName): string => `${ZH_DIR}/${name}.zh-evidence.json`;
/** The path of the weekday's Chinese validator flags: one line naming its context and its evidence (SPEC §8.6). */
export const ZH_FLAGS_PATH = `${ZH_DIR}/flags.txt`;
/** The weekday's Chinese flags (`--zh-context` and `--zh-evidence`, scripts/validate.ts's Chinese form). */
export const ZH_FLAGS_LINE = `--zh-context ${zhContextPath("weekday")} --zh-evidence ${zhEvidencePath("weekday")}`;

// ── The drafts ───────────────────────────────────────────────────────────────────────────────────

/**
 * The Chinese draft for a context: each key's string is the table's Chinese of the English the context holds for it, each term
 * whose `zh` is null has the table's Chinese name, the Chinese of its definition and its 樂詞網 entry (or null and null), and
 * `generated_at` is the time given. Throws for an English string or a term the table lacks.
 */
export function zhDraftOf(context: ZhContext, generatedAt: string): DraftZh {
  const strings = Object.fromEntries(context.strings.map((s) => [s.key, zhText(s.en)]));
  const terms = Object.fromEntries(context.terms.filter((t) => t.zh === null).map((t) => {
    const record = ZH_TERM_TABLE[t.id];
    if (record === undefined) throw new Error(`world-zh.ts has no Chinese for the glossary term ${t.id}`);
    return [t.id, { zh: record.zh, definition: zhText(t.definition), official: record.official, official_url: record.official_url }];
  }));
  return DraftZh.parse({ schema_version: 1, date: context.date, generated_at: generatedAt, strings, terms });
}

const CACHE = new Map<EditionName, DraftZh>();

/** A fresh deep copy of an edition's valid Chinese draft; callers may change it freely. */
export function zhDraft(name: EditionName): DraftZh {
  let draft = CACHE.get(name);
  if (draft === undefined) {
    draft = zhDraftOf(zhContext(name), ZH_CLOCK[name].generatedAt);
    CACHE.set(name, draft);
  }
  return structuredClone(draft);
}

/** The Chinese of a context key of an edition, as publish joins it to the English string by key (SPEC §4.6); throws for a key the context lacks. */
export function zhStringOf(name: EditionName, key: string): string {
  const zh = zhDraft(name).strings[key];
  if (zh === undefined) throw new Error(`The context of the ${name} edition has no key ${key}`);
  return zh;
}

// ── The generator ────────────────────────────────────────────────────────────────────────────────

/**
 * Every file this part of the fixtures writes (the registry's generator), the same on every call: for each edition its valid Chinese
 * draft, its context and its evidence, then the weekday's `flags.txt`. Each JSON file is `jsonText(value, schema)` (SPEC §4.1), so
 * the output holds no timestamp and no machine path beyond the clock constants of `zh-inputs.ts`.
 */
export function zhOutputs(): Output[] {
  return [
    ...EDITION_NAMES.flatMap((name): Output[] => [
      { path: zhDraftPath(name), text: jsonText(zhDraft(name), DraftZh) },
      { path: zhContextPath(name), text: jsonText(zhContext(name), ZhContext) },
      { path: zhEvidencePath(name), text: jsonText(zhEvidence(name), Evidence) },
    ]),
    { path: ZH_FLAGS_PATH, text: `${ZH_FLAGS_LINE}\n` },
  ];
}
