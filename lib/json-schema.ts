// The JSON Schema files the two drafting agents read (SPEC §4.1, §4.5, §4.6, §8.1, §9.5, §10 P1 item 4):
// `routine/schema/draft-brief.schema.json` from `DraftBrief` (the English agent's drafts/D.json) and
// `routine/schema/draft-zh.schema.json` from `DraftZh` (the Chinese pass's drafts/D.zh.json). `npm run schema:gen`
// (scripts/gen-json-schema.ts) writes both; `npm run schema:check` fails when either is stale (CI runs it).
//
// A JSON Schema can state structure only: the keys of every object (all required, none extra), types, null-ability,
// enums, id patterns, lengths and item counts. Zod's refinements (a real calendar date, `ai_helped` null exactly
// when `ai.role` is none, an AI role with an evidence entry, a correction's path and `after`) and every rule of
// SPEC §4.12 (word budgets, counts, cross-references) are not in it, and `z.toJSONSchema` ignores them. So each file's
// own description says that a draft which satisfies the file can still fail the validator, and the `.describe()` texts
// of the schemas, which carry the budgets and rules the agent must obey, reach the file unchanged.
//
// The agents read each file with the Read tool inside their sandbox (§9.5), which cuts a long line, so the compact
// printer keeps short objects and arrays on one line and no line may reach `SCHEMA_LINE_LIMIT` characters.
// `printJson()` is also the printer of the agents' context files (P3).
//
// Cyber's lib/json-schema.ts at the fork commit 3ced1fb, adapted: `printJson()`, the line limit, `renderDraftSchema()`
// and `schemaFileStats()` are Cyber's in their roles (`schemaFileStats()` counts an empty text as no lines); the
// Chinese pass's file, `SCHEMA_FILES` (both files in one list, so the script and the tests loop over it) and the
// two files' headers are new.

import { z } from "zod";
import { DraftBrief } from "./schema/draft";
import { DraftZh } from "./schema/draft-zh";

export const DRAFT_SCHEMA_PATH = "routine/schema/draft-brief.schema.json";
export const DRAFT_ZH_SCHEMA_PATH = "routine/schema/draft-zh.schema.json";

/** No line of a schema file may reach this many characters, so the agent's file reader never cuts one. */
export const SCHEMA_LINE_LIMIT = 1000;

/**
 * JSON with short objects and arrays kept on one line. About a quarter smaller than 2-space
 * pretty-printing, and no line is long enough for the agent's file reader to truncate: a long string is
 * never split, so a line is as long as its longest string. Keys keep the order they are given in.
 */
export function printJson(value: unknown, indent = "", width = 110): string {
  const flat = JSON.stringify(value);
  if (value === null || typeof value !== "object" || flat.length + indent.length <= width) return flat;
  const next = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => next + printJson(v, next, width)).join(",\n")}\n${indent}]`;
  const entries = Object.entries(value as Record<string, unknown>);
  return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${printJson(v, next, width)}`).join(",\n")}\n${indent}}`;
}

/** A schema's JSON Schema (draft 2020-12) as a plain object, with a title and a note on what the file is and is not. */
function schemaObject(schema: z.ZodType, title: string, description: string): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "throw" }) as Record<string, unknown>;
  return { $schema, title, description, ...rest };
}

/** The DraftBrief JSON Schema: the English agent's output, drafts/YYYY-MM-DD.json (SPEC §4.5). */
export function draftSchema(): Record<string, unknown> {
  return schemaObject(
    DraftBrief,
    "Unveiling Tracker DraftBrief",
    "The English drafting agent's one output file, drafts/YYYY-MM-DD.json (SPEC.md §4.5). "
      + "Generated from lib/schema/draft.ts by `npm run schema:gen`; do not edit by hand. "
      + "This file shows structure only: every key of an object is required, no other key is allowed, and each value has the type, enum, id pattern, length or item count shown. "
      + "The word budgets, counts, cross-references and other rules in the descriptions are enforced by the validator (SPEC.md §4.12), "
      + "together with checks no JSON Schema keyword can state, such as a real calendar date and ai_helped agreeing with ai.role. "
      + "A draft that satisfies this file can still fail validation.",
  );
}

/** The DraftZh JSON Schema: the Chinese pass's output, drafts/YYYY-MM-DD.zh.json (SPEC §4.6). */
export function draftZhSchema(): Record<string, unknown> {
  return schemaObject(
    DraftZh,
    "Unveiling Tracker DraftZh",
    "The Chinese pass's one output file, drafts/YYYY-MM-DD.zh.json (SPEC.md §4.6). "
      + "Generated from lib/schema/draft-zh.ts by `npm run schema:gen`; do not edit by hand. "
      + "This file shows structure only: every key of an object is required and no other key is allowed, except in the maps strings and terms, whose keys come from the context file. "
      + "The validator enforces the rest: that strings has exactly the context's keys and terms exactly its terms with no Chinese yet, each string's character cap, "
      + "that you add no number, name or link the English lacks, Taiwan usage and the other rules the descriptions state, "
      + "together with checks no JSON Schema keyword can state, such as a real calendar date. "
      + "A draft that satisfies this file can still fail validation.",
  );
}

/** The English file's exact text: the compact-printed schema and a final newline. */
export function renderDraftSchema(): string {
  return `${printJson(draftSchema())}\n`;
}

/** The Chinese file's exact text: the compact-printed schema and a final newline. */
export function renderDraftZhSchema(): string {
  return `${printJson(draftZhSchema())}\n`;
}

export interface SchemaFile {
  /** Where the file lives, relative to the repository root. */
  path: string;
  /** Its exact text. */
  render: () => string;
}

/** Both files, so that the script and the tests treat them alike. */
export const SCHEMA_FILES: readonly SchemaFile[] = [
  { path: DRAFT_SCHEMA_PATH, render: renderDraftSchema },
  { path: DRAFT_ZH_SCHEMA_PATH, render: renderDraftZhSchema },
];

/** Size facts for the PR description and the tests: bytes, lines and the longest line (in UTF-16 units, as a reader counts). */
export function schemaFileStats(text: string): { bytes: number; lines: number; longestLine: number; longestLineNo: number } {
  const lines = text === "" ? [] : text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  let longestLine = 0;
  let longestLineNo = 0;
  lines.forEach((line, i) => {
    if (line.length > longestLine) {
      longestLine = line.length;
      longestLineNo = i + 1;
    }
  });
  return { bytes: Buffer.byteLength(text, "utf8"), lines: lines.length, longestLine, longestLineNo };
}
