// The Chinese pass (SPEC §4.6): its context, `drafts/D.zh-context.json`, which stage 8 builds from the validated English
// draft (`ZhContext`), and its one file, `drafts/D.zh.json` (`DraftZh`), from which a later stage generates
// `routine/schema/draft-zh.schema.json` (Cyber's compact printer over `z.toJSONSchema`).
//
// The pass translates strings, never structure: `DraftZh.strings` maps each key of the context to its Chinese, and
// `DraftZh.terms` gives the Chinese of each glossary term whose `zh` is null. Publish joins each `en` string with its
// `zh` by key into `L10n` values (§4.6), so the keys carry the whole structure and the file holds no id, number or link
// of its own.
//
// Shape only, as common.ts explains. `ZH_KEYS` (strings has exactly the context's keys, terms exactly its null-zh term
// ids), `ZH_CHARS` (each string and group within its `cap_chars`), `ZH_PARITY`, `ZH_TERMS`, `ZH_AVOID`, `ZH_HYPE`,
// `ZH_OFFICIAL` (a non-null `official` comes with an `official_url` on terms.naer.edu.tw that appears in the page),
// `ZH_NO_DASH` and `ZH_TRADITIONAL` are rules in lib/rules, so each rule's fixture fails with exactly its own code;
// their limits appear in `.describe()` text for the pass. Nothing in `DraftZh` is a refinement, so the generated JSON
// Schema shows every constraint the Zod schema has. `ZhContext` is read by the pass as a file and by the rules as an
// object, never shown as a JSON Schema; its one refinement (each key and each term id once) is Zod-only.
//
// New for this project; Cyber has no Chinese pass.

import { z } from "zod";
import { IsoDate, IsoTimestamp, TermId } from "./common";

/** What a context string is, for the pass and for `cap_chars` (§4.6): a title, an explainer part, a Lead sentence, a note, a one-line text, a long text or a figure's alt text. */
export const ZH_STRING_KINDS = ["title", "part", "lead", "note", "line", "long", "alt"] as const;
export const ZhStringKind = z.enum(ZH_STRING_KINDS);

const Cap = z.int().min(1);

/** A combined budget that several strings share: the Lead's sentences, a story's six parts or an item's first four. */
export const ZhGroup = z.strictObject({
  id: z.string().min(1).describe("lead, new.<ref>.explainer or backlog.<id>.explainer"),
  cap_chars: Cap.describe("The characters all the group's strings may have together"),
});

export const ZhString = z.strictObject({
  key: z.string().min(1).describe("Its stable path, e.g. lead.0, new.new-1.title, new.new-1.explainer.found, deep_dive, backlog.math-2026-0142.title"),
  en: z.string().min(1).describe("The English string to translate"),
  kind: ZhStringKind,
  cap_chars: Cap.describe("At most this many Chinese characters: ceil(the English cap in words x zh_factor), or the group's where the English has only a combined budget"),
  group: ZhGroup.nullable().describe("The combined budget it shares, or null"),
});

/** A glossary term the edition uses; `zh` is null for a term whose Chinese the pass writes. */
export const ZhTerm = z.strictObject({
  id: TermId,
  en: z.string().min(1).describe("The English term"),
  definition: z.string().min(1).describe("The English definition"),
  zh: z.string().min(1).nullable().describe("The Chinese term the glossary already holds, or null: then give its Chinese in the draft's terms"),
  official: z.string().min(1).nullable().describe("The term as 樂詞網 shows it, when the glossary already holds it"),
  cap_chars: Cap.describe("The Chinese definition's cap: ceil(40 x zh_factor)"),
});

/** A `config/terms-zh.json` entry that applies, with the keys it applies to (`terms.<id>` for a null-zh term). */
export const ZhFixed = z.strictObject({
  en: z.string().min(1),
  zh: z.string().min(1).describe("The Chinese every key it applies to must contain"),
  keys: z.array(z.string().min(1)),
});

/** A hype name (`config/hype-words.json`) and its Chinese, or null when it stays in English. */
export const ZhHypeName = z.strictObject({
  en: z.string().min(1),
  zh: z.string().min(1).nullable(),
});

/** `drafts/D.zh-context.json`. */
export const ZhContext = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate.describe("The edition date"),
  deadline: IsoTimestamp.describe("By which the draft must be written"),
  strings: z.array(ZhString).describe("Every English string the edition shows, and the backlog's, each once"),
  terms: z.array(ZhTerm).describe("The glossary terms the edition's findings and the backlog's use, each once"),
  fixed: z.array(ZhFixed).describe("The fixed translations that apply, and the keys each applies to"),
  hype: z.array(z.string().min(1)).describe("Chinese words that may not appear (ZH_HYPE)"),
  hype_names: z.array(ZhHypeName).describe("Names that contain a hype word: use the zh, or keep the English when it is null"),
  avoid: z.record(z.string().min(1), z.string().min(1)).describe("A term of mainland usage to its Taiwan term"),
  labels: z.record(z.string().min(1), z.string().min(1)).describe("The site's words for fields, rungs, AI roles and significance, English to Chinese"),
}).superRefine((c, ctx) => {
  const seen = (what: string, key: "strings" | "terms", ids: string[]) => {
    const first = new Map<string, number>();
    ids.forEach((id, i) => {
      if (first.has(id)) ctx.addIssue({ code: "custom", message: `${what} ${JSON.stringify(id)} appears twice`, path: [key, i, key === "strings" ? "key" : "id"] });
      else first.set(id, i);
    });
  };
  seen("The key", "strings", c.strings.map((s) => s.key));
  seen("The term id", "terms", c.terms.map((t) => t.id));
});

/** One term's Chinese, as the pass writes it. */
export const DraftZhTerm = z.strictObject({
  zh: z.string().min(1).describe("The Chinese term, in everyday Taiwan usage"),
  definition: z.string().min(1).describe("The Chinese definition, within the context term's cap_chars"),
  official: z.string().min(1).nullable().describe("The term as 樂詞網 (terms.naer.edu.tw) shows it, only when its page shows it; else null"),
  official_url: z.string().min(1).nullable().describe("The 樂詞網 page you fetched that shows it; a non-null official comes with one"),
});

/** `drafts/D.zh.json`, the Chinese pass's one file. */
export const DraftZh = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate.describe("The edition date from the context"),
  generated_at: IsoTimestamp.describe("When you finished: before the context's deadline"),
  strings: z.record(z.string().min(1), z.string().min(1)).describe("Exactly the context's keys, each with its Chinese string"),
  terms: z.record(TermId, DraftZhTerm).describe("Exactly the context's terms whose zh is null, by term id"),
});

export type ZhStringKind = z.infer<typeof ZhStringKind>;
export type ZhGroup = z.infer<typeof ZhGroup>;
export type ZhString = z.infer<typeof ZhString>;
export type ZhTerm = z.infer<typeof ZhTerm>;
export type ZhFixed = z.infer<typeof ZhFixed>;
export type ZhHypeName = z.infer<typeof ZhHypeName>;
export type ZhContext = z.infer<typeof ZhContext>;
export type DraftZhTerm = z.infer<typeof DraftZhTerm>;
export type DraftZh = z.infer<typeof DraftZh>;
