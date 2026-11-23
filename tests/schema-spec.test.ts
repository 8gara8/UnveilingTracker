// lib/schema against SPEC §4 (AGENTS.md rule 6: the spec governs). Reads every `interface` and object `type` block of
// SPEC.md and checks the exported schema of the same name: its keys and their order (the on-disk key order, lib/json.ts),
// which of them may be null, the string-literal unions, and each inline object nested in it. Then checks that every
// object in every exported schema is strict (§4.1: an unknown key is an error). The other schema tests build values;
// this one reads the spec, so a key dropped, added or swapped in a schema fails here whichever file it is in.
// New for this project; the comparison is the project's own.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as schemas from "@/lib/schema";

const spec = fs.readFileSync(path.join(__dirname, "..", "SPEC.md"), "utf8");

// ── Reading the spec's type blocks ───────────────────────────────────────────────────────────────

interface SpecBlock { name: string; body: string; line: number }
interface Member { key: string; type: string }

/** Every `interface X { ... }` and `type X = { ... }` of the spec, with the text between its braces. */
function specBlocks(): SpecBlock[] {
  const out: SpecBlock[] = [];
  const head = /(?:^|\n)(?:interface (\w+)(?: extends [\w, ]+)? \{|type (\w+) = \{)/g;
  for (let m = head.exec(spec); m; m = head.exec(spec)) {
    let i = m.index + m[0].length;
    const start = i;
    for (let depth = 1; i < spec.length && depth > 0; i++) {
      if (spec[i] === "{") depth++;
      else if (spec[i] === "}") depth--;
    }
    out.push({ name: (m[1] ?? m[2])!, body: spec.slice(start, i - 1), line: spec.slice(0, m.index).split("\n").length + 1 });
  }
  return out;
}

/** The text with each `//` comment removed (a `//` inside a quoted string stays). */
function withoutComments(text: string): string {
  return text.split("\n").map((line) => {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "/" && line[i + 1] === "/") return line.slice(0, i);
    }
    return line;
  }).join("\n");
}

/** Moves `depth` over the brackets of a type text; `<` and `>` count only as generics, never as `=>`. */
function depthAfter(text: string, i: number, depth: number): number {
  const c = text[i]!;
  if (c === "{" || c === "(" || c === "[") return depth + 1;
  if (c === "}" || c === ")" || c === "]") return depth - 1;
  if (c === "<" && /\w/.test(text[i - 1] ?? "")) return depth + 1;
  if (c === ">" && text[i - 1] !== "=" && depth > 0) return depth - 1;
  return depth;
}

/** The members of an object type's body: each top-level key, in order, with its type text. */
function membersOf(body: string): Member[] {
  const text = withoutComments(body);
  const out: Member[] = [];
  let current: Member | null = null;
  let typeStart = 0;
  let depth = 0;
  let atStart = true;
  const close = (end: number) => {
    if (current) out.push({ key: current.key, type: text.slice(typeStart, end) });
    current = null;
  };
  for (let i = 0; i < text.length; ) {
    if (depth === 0 && atStart) {
      const key = /^\s*(\w+)\??\s*:/.exec(text.slice(i));
      if (key) {
        close(i);
        current = { key: key[1]!, type: "" };
        atStart = false;
        i += key[0].length;
        typeStart = i;
        continue;
      }
      if (/\S/.test(text[i]!)) atStart = false;
    }
    depth = depthAfter(text, i, depth);
    if (depth === 0 && (text[i] === ";" || text[i] === ",")) { close(i); atStart = true; }
    if (depth === 0 && text[i] === "\n" && [";", ",", ""].includes(text.slice(0, i).trimEnd().slice(-1))) { close(i); atStart = true; }
    i++;
  }
  close(text.length);
  return out;
}

/** The body of the first `{ ... }` group in a type text, or null when it has none. */
function firstObject(type: string): string | null {
  const open = type.indexOf("{");
  if (open < 0) return null;
  for (let i = open, depth = 0; i < type.length; i++) {
    if (type[i] === "{") depth++;
    else if (type[i] === "}" && --depth === 0) return type.slice(open + 1, i);
  }
  return null;
}

/** True when `null` is one member of the type's top-level union (`PublishedAt` is the spec's alias for one, §4.3). */
function specNullable(type: string): boolean {
  if (type.trim() === "PublishedAt") return true;
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < type.trim().length; i++) {
    const t = type.trim();
    depth = depthAfter(t, i, depth);
    if (t[i] === "|" && depth === 0) { parts.push(current.trim()); current = ""; } else current += t[i];
  }
  parts.push(current.trim());
  return parts.includes("null");
}

/** The quoted values of a type that is only a union of string literals (and perhaps `null`), else null. */
function specLiterals(type: string): string[] | null {
  const flat = type.replace(/\s+/g, " ").trim();
  if (!/^(?:"[^"]*"|null)(?: \| (?:"[^"]*"|null))*$/.test(flat)) return null;
  const values = [...flat.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  return values.length > 0 ? values : null;
}

// ── Reading a Zod schema ─────────────────────────────────────────────────────────────────────────

type Schema = z.ZodType;
const kind = (s: Schema): string => (s as unknown as { def: { type: string } }).def.type;
const defOf = (s: Schema): any => (s as unknown as { def: unknown }).def;
const isSchema = (v: unknown): v is Schema =>
  typeof v === "object" && v !== null && "def" in v && typeof (v as { safeParse?: unknown }).safeParse === "function";

/** The schemas directly inside a wrapper, array, record, tuple, union or intersection (none for a leaf or an object). */
function children(s: Schema): { schema: Schema; step: string }[] {
  const def = defOf(s);
  const same = (list: Schema[]) => list.map((schema) => ({ schema, step: "" }));
  switch (kind(s)) {
    case "nullable": case "optional": case "readonly": case "default": case "prefault": case "catch": case "nonoptional":
      return same([def.innerType]);
    case "array": return [{ schema: def.element, step: "[]" }];
    case "record": return [{ schema: def.valueType, step: "{}" }];
    case "tuple": return [...def.items, ...(def.rest ? [def.rest] : [])].map((schema: Schema) => ({ schema, step: "[]" }));
    case "union": return same([...def.options]);
    case "intersection": return same([def.left, def.right]);
    case "pipe": return same([def.in]);
    case "lazy": return same([def.getter()]);
    default: return [];
  }
}

/** The first object schema inside `s`, through wrappers, arrays, records and unions; null when there is none. */
function innerObject(s: Schema, depth = 12): (Schema & { shape: Record<string, Schema> }) | null {
  if (depth < 0) return null;
  if (kind(s) === "object") return s as Schema & { shape: Record<string, Schema> };
  for (const child of children(s)) {
    const found = innerObject(child.schema, depth - 1);
    if (found) return found;
  }
  return null;
}

/** The values an enum or a literal accepts, in order; null for any other schema. */
function literalsOf(s: Schema): string[] | null {
  let inner = s;
  while (kind(inner) === "nullable" || kind(inner) === "optional") inner = defOf(inner).innerType;
  if (kind(inner) === "enum") return Object.values(defOf(inner).entries) as string[];
  if (kind(inner) === "literal") return [...defOf(inner).values] as string[];
  return null;
}

// ── The comparison ───────────────────────────────────────────────────────────────────────────────

/** What differs between an object type's body in the spec and the object schema of the same name; [] when nothing. */
function differences(where: string, body: string, schema: Schema): string[] {
  const object = innerObject(schema);
  const members = membersOf(body);
  if (!object) return [`${where}: the spec has an object [${members.map((m) => m.key).join(", ")}] but the schema has none`];
  const out: string[] = [];
  const want = members.map((m) => m.key);
  const got = Object.keys(object.shape);
  if (JSON.stringify(want) !== JSON.stringify(got)) out.push(`${where}: the spec has keys [${want.join(", ")}], the schema [${got.join(", ")}]`);
  for (const m of members) {
    const field = object.shape[m.key];
    if (!field) continue;
    const text = m.type.replace(/\s+/g, " ").trim();
    if (specNullable(m.type) !== field.safeParse(null).success) {
      out.push(`${where}.${m.key}: the spec says ${specNullable(m.type) ? "null is allowed" : "null is not allowed"} (${text.slice(0, 60)})`);
    }
    const literals = specLiterals(m.type);
    if (literals) {
      const values = literalsOf(field);
      if (!values) out.push(`${where}.${m.key}: the spec lists [${literals.join(", ")}] but the schema is not an enum`);
      else if (JSON.stringify(values) !== JSON.stringify(literals)) {
        out.push(`${where}.${m.key}: the spec lists [${literals.join(", ")}], the schema [${values.join(", ")}]`);
      }
    }
    // `Omit<Figure, "alt"> & { alt: string }` changes one value of another type: only its keys are compared above.
    const nested = /Omit<|&/.test(text) ? null : firstObject(m.type);
    if (nested !== null) out.push(...differences(`${where}.${m.key}`, nested, field));
  }
  return out;
}

const all = schemas as unknown as Record<string, unknown>;
const blocks = specBlocks();

describe("SPEC §4 type blocks and lib/schema", () => {
  it("reads the spec's blocks", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(30);
    for (const name of ["L10n", "Source", "RungEntry", "AiInfo", "Finding", "Brief", "WeekReview", "DraftBrief", "DraftCorrection", "ZhContext",
      "DraftZh", "MetricsFile", "PaceCell", "CounterReading", "GlossaryFile", "Term", "Correction", "Report"]) {
      expect(blocks.map((b) => b.name), name).toContain(name);
    }
  });

  it("every block has the schema of its name", () => {
    expect(blocks.filter((b) => !isSchema(all[b.name])).map((b) => `${b.name} (SPEC line ${b.line})`)).toEqual([]);
  });

  it.each(blocks.map((b) => [`${b.name} (SPEC line ${b.line})`, b] as const))(
    "%s: the keys and their order, the null values, the literal unions and each nested object",
    (_label, block) => {
      expect(differences(block.name, block.body, all[block.name] as Schema)).toEqual([]);
    },
  );

  it("compares many object levels, nested ones included", () => {
    const count = (body: string, schema: Schema): number => {
      const object = innerObject(schema);
      if (!object) return 0;
      let n = 1;
      for (const m of membersOf(body)) {
        const nested = /Omit<|&/.test(m.type) ? null : firstObject(m.type);
        if (nested !== null && object.shape[m.key]) n += count(nested, object.shape[m.key]!);
      }
      return n;
    };
    const levels = blocks.reduce((sum, b) => sum + count(b.body, all[b.name] as Schema), 0);
    expect(levels).toBeGreaterThanOrEqual(75);
  });

  it("catches a swapped key, a dropped key, a changed null and a changed union (the comparison is not vacuous)", () => {
    const body = "a: string; b: string | null; c: \"x\" | \"y\"; d: { e: number; f: number }[];";
    const ok = z.strictObject({ a: z.string(), b: z.string().nullable(), c: z.enum(["x", "y"]), d: z.array(z.strictObject({ e: z.number(), f: z.number() })) });
    expect(differences("T", body, ok)).toEqual([]);
    const swapped = z.strictObject({ b: z.string().nullable(), a: z.string(), c: z.enum(["x", "y"]), d: ok.shape.d });
    expect(differences("T", body, swapped).join()).toContain("keys [a, b, c, d]");
    const dropped = z.strictObject({ a: z.string(), b: z.string().nullable(), c: z.enum(["x", "y"]) });
    expect(differences("T", body, dropped).join()).toContain("keys [a, b, c, d]");
    const notNull = z.strictObject({ a: z.string(), b: z.string(), c: z.enum(["x", "y"]), d: ok.shape.d });
    expect(differences("T", body, notNull).join()).toContain("T.b");
    const nowNull = z.strictObject({ a: z.string().nullable(), b: z.string().nullable(), c: z.enum(["x", "y"]), d: ok.shape.d });
    expect(differences("T", body, nowNull).join()).toContain("T.a");
    const union = z.strictObject({ a: z.string(), b: z.string().nullable(), c: z.enum(["y", "x"]), d: ok.shape.d });
    expect(differences("T", body, union).join()).toContain("T.c");
    const inner = z.strictObject({ a: z.string(), b: z.string().nullable(), c: z.enum(["x", "y"]), d: z.array(z.strictObject({ f: z.number(), e: z.number() })) });
    expect(differences("T", body, inner).join()).toContain("T.d");
  });
});

// ── Strictness ───────────────────────────────────────────────────────────────────────────────────

/** Every object schema reachable from `s`, once each, with the path it was first reached by. */
function objectsIn(s: Schema, where: string, seen: Set<Schema>, out: { where: string; schema: Schema }[]): void {
  if (seen.has(s)) return;
  seen.add(s);
  if (kind(s) === "object") {
    out.push({ where, schema: s });
    for (const [key, field] of Object.entries((s as unknown as { shape: Record<string, Schema> }).shape)) objectsIn(field, `${where}.${key}`, seen, out);
    return;
  }
  for (const child of children(s)) objectsIn(child.schema, `${where}${child.step}`, seen, out);
}

const isStrict = (s: Schema): boolean => kind(defOf(s).catchall ?? z.unknown()) === "never";

describe("strict objects (SPEC §4.1)", () => {
  const found: { where: string; schema: Schema }[] = [];
  const seen = new Set<Schema>();
  for (const [name, value] of Object.entries(all)) if (isSchema(value)) objectsIn(value, name, seen, found);

  it("reaches the objects of every exported schema", () => {
    expect(found.length).toBeGreaterThanOrEqual(150);
  });

  it("lets no unknown key through any object of lib/schema", () => {
    expect(found.filter((o) => !isStrict(o.schema)).map((o) => o.where)).toEqual([]);
  });

  it("tells a strict object from a loose one (the check is not vacuous)", () => {
    expect(isStrict(z.strictObject({ a: z.string() }))).toBe(true);
    expect(isStrict(z.object({ a: z.string() }))).toBe(false);
    expect(isStrict(z.looseObject({ a: z.string() }))).toBe(false);
    const nested: { where: string; schema: Schema }[] = [];
    objectsIn(z.strictObject({ list: z.array(z.object({ a: z.string() })).nullable() }), "T", new Set(), nested);
    expect(nested.filter((o) => !isStrict(o.schema)).map((o) => o.where)).toEqual(["T.list[]"]);
  });
});
