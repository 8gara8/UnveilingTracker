// Small helpers for the schema tests: the issues a Zod schema finds in a value, with each path joined by dots
// (an empty string is the root), and assertions that name the path and, when it matters, the message. New for this
// project.

import { expect } from "vitest";
import type { z } from "zod";

export interface FoundIssue {
  path: string;
  message: string;
  code: string;
}

/** The issues `schema` finds in `value`; none when the value is valid. */
export function issuesOf(schema: z.ZodType, value: unknown): FoundIssue[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message, code: i.code }));
}

/** A deep copy, so a test changes its own data and never the shared valid object. */
export function copy<T>(value: T): T {
  return structuredClone(value);
}

export function expectValid(schema: z.ZodType, value: unknown): void {
  const found = issuesOf(schema, value);
  expect(found, `expected a valid value, got ${JSON.stringify(found)}`).toEqual([]);
}

/** The value fails with an issue at `path`, and, when `part` is given, one whose message holds it. */
export function expectIssue(schema: z.ZodType, value: unknown, path: string, part?: string): void {
  const found = issuesOf(schema, value);
  const hit = found.find((i) => i.path === path && (part === undefined || i.message.includes(part)));
  expect(hit, `expected an issue at "${path}"${part === undefined ? "" : ` about "${part}"`}, got ${JSON.stringify(found)}`).toBeDefined();
}

/** The value fails with exactly one issue, at `path`. */
export function expectOnlyIssue(schema: z.ZodType, value: unknown, path: string, part?: string): void {
  const found = issuesOf(schema, value);
  expect(found.map((i) => i.path), `expected only one issue, at "${path}", got ${JSON.stringify(found)}`).toEqual([path]);
  if (part !== undefined) expect(found[0]!.message).toContain(part);
}

/** `mutate` changes a copy of `value`; the copy then fails at `path` (and, with `part`, with a message that holds it). */
export function expectMutationFails(
  schema: z.ZodType, value: unknown, mutate: (v: any) => void, path: string, part?: string,
): void {
  const changed = copy(value);
  mutate(changed);
  expectIssue(schema, changed, path, part);
}
