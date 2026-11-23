// The tool behind `simplified_only` in config/terms-zh.json (SPEC §4.11, §10 P1 item 1).
//
// `simplified_only` holds every character that has a Unihan `kTraditionalVariant`, except the
// characters of the Ministry of Education's 常用國字標準字體表 (Taiwan's 4,808 standard common
// characters) and TAIWAN_EXTRA, the characters Taiwan writes though that list lacks them. A
// `kTraditionalVariant` that lists the character itself takes nothing off. The result is one string,
// each character once, sorted by code point.
//
//   Offline:   tsx fixtures/src/tools/simplified.ts --unihan FILE --moe FILE [--write FILE | --check FILE]
//   Download:  tsx fixtures/src/tools/simplified.ts --fetch [--dir DIR] [--write FILE | --check FILE]
//
// --unihan takes Unihan.zip or the extracted Unihan_Variants.txt; --moe takes the Ministry list's
// common.json (MOE_PACKAGE). --fetch downloads both into DIR (default cache/simplified), checks the
// package's tarball against its pinned integrity hash and needs `tar` and `unzip`. --write sets the
// `simplified_only` key of FILE (a JSON object; created with `version` 1 if missing) and keeps its other
// keys. --check compares FILE's `simplified_only` with the rebuilt list. Either way the 50 + 50
// characters of MUST_HOLD and MUST_NOT_HOLD are checked.
//
// Exit 0: the list built and passed; 1: a check failed (with --write the file is still written, so the
// failing characters can be seen); 2: a usage or setup error.
//
// It downloads at build time only, never in a test (tests/setup/offline.ts); nothing it reads is
// committed except the list it builds. The Ministry list is a filter here and is not redistributed.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The machine-readable copy of the Ministry's list (MIT-licensed package; its data follows the Ministry's chart). */
export const MOE_PACKAGE = {
  name: "chart-of-standard-forms-of-national-characters",
  version: "0.0.0",
  tarball:
    "https://registry.npmjs.org/chart-of-standard-forms-of-national-characters/-/chart-of-standard-forms-of-national-characters-0.0.0.tgz",
  /** The registry's integrity value for that tarball; --fetch refuses anything else. */
  integrity: "sha512-Dwt8j29TE4SWoFBnnrnOVaSCHzqpOgkW3RbAeswxiyxRH0VNkL3jU4s0GNjJdYrQdh43OYzSThPLgx2f9GMUVQ==",
  entry: "package/common.json",
  /** The common list's size: a file of another size is not the list. */
  count: 4808,
} as const;

export const UNIHAN_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip";

/**
 * Characters that Taiwan writes though the Ministry's common list lacks them (胜肽, 筑波, 坂口, a
 * surname, 芸香科). Grown by PR when a morning meets another, then the list is rebuilt.
 */
export const TAIWAN_EXTRA: readonly string[] = ["胜", "筑", "坂", "涂", "芸"];

/** 50 common simplified characters that `simplified_only` must hold. */
export const MUST_HOLD: readonly string[] = [..."个这体极们说为发现学问题简与对时会国过还动经实种样业开关长书车东无见进应机从来门间际电话认让请谁读阅"];

/** 50 characters Taiwan writes, which `simplified_only` must not hold. */
export const MUST_NOT_HOLD: readonly string[] = [
  ..."台后里面干系只准制才了胜向周余云采范斗松咸志出划卜占谷蒙征御凶板表秋辟丑伙折卷奸岳几于厘胡沈筑坂涂芸",
];

export interface UnihanVariants {
  /** Each character with a kTraditionalVariant, to the code points that field lists, in file order. */
  traditional: Map<number, number[]>;
  /** The comment lines at the top of the file (the version and date). */
  header: string[];
}

export interface Built {
  /** The characters, each once, sorted by code point. */
  chars: string;
  count: number;
  /** How many lie outside the main block (U+4E00 to U+9FFF) and the compatibility block (U+F900 to U+FAFF). */
  extension: number;
}

function codePointOf(token: string): number {
  // Unihan may annotate a value, as in U+500B<kXYZ; only the code point counts here.
  const m = /^U\+([0-9A-F]{4,6})/.exec(token);
  if (!m) throw new Error(`not a Unihan code point: ${JSON.stringify(token)}`);
  return Number.parseInt(m[1]!, 16);
}

/** Reads Unihan_Variants.txt: the kTraditionalVariant lines and the file's leading comment block. */
export function parseUnihanVariants(text: string): UnihanVariants {
  const traditional = new Map<number, number[]>();
  const header: string[] = [];
  let inHeader = true;
  for (const line of text.split(/\r?\n/)) {
    if (line === "") continue;
    if (line.startsWith("#")) {
      if (inHeader) header.push(line);
      continue;
    }
    inHeader = false;
    const [code, field, value] = line.split("\t");
    if (field !== "kTraditionalVariant" || code === undefined || value === undefined) continue;
    const from = codePointOf(code);
    const to = value.split(" ").filter((t) => t !== "").map(codePointOf);
    traditional.set(from, [...(traditional.get(from) ?? []), ...to]);
  }
  return { traditional, header };
}

/** One character as a code point; throws for anything else, so a wrong file fails loudly. */
function single(c: string, where: string): number {
  const cps = [...c];
  if (cps.length !== 1) throw new Error(`${where}: ${JSON.stringify(c)} is not one character`);
  return cps[0]!.codePointAt(0)!;
}

/** The list's check of §4.11: the kTraditionalVariant characters minus the Ministry's list and TAIWAN_EXTRA. */
export function buildSimplifiedOnly(input: {
  variants: UnihanVariants;
  common: readonly string[];
  extra: readonly string[];
}): Built {
  const keep = new Set<number>();
  for (const c of input.common) keep.add(single(c, "the Ministry list"));
  for (const c of input.extra) keep.add(single(c, "TAIWAN_EXTRA"));
  // A kTraditionalVariant that lists the character itself takes nothing off: only `keep` does.
  const cps = [...input.variants.traditional.keys()].filter((cp) => !keep.has(cp)).sort((a, b) => a - b);
  const extension = cps.filter((cp) => !(cp >= 0x4e00 && cp <= 0x9fff) && !(cp >= 0xf900 && cp <= 0xfaff)).length;
  return { chars: cps.map((cp) => String.fromCodePoint(cp)).join(""), count: cps.length, extension };
}

/** Problems with a built list against MUST_HOLD and MUST_NOT_HOLD; empty when it passes. */
export function checkLists(chars: string): string[] {
  const held = new Set([...chars]);
  const problems: string[] = [];
  for (const c of MUST_HOLD) if (!held.has(c)) problems.push(`missing ${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase()})`);
  for (const c of MUST_NOT_HOLD) if (held.has(c)) problems.push(`holds ${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase()}), which Taiwan writes`);
  return problems;
}

/** Reads the Ministry list's common.json and checks it is 4,808 distinct single characters. */
export function parseMoeCommon(json: string): string[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data) || !data.every((c) => typeof c === "string")) throw new Error("the Ministry list is not an array of strings");
  const list = data as string[];
  for (const c of list) single(c, "the Ministry list");
  if (new Set(list).size !== MOE_PACKAGE.count || list.length !== MOE_PACKAGE.count) {
    throw new Error(`the Ministry list holds ${new Set(list).size} distinct characters (${list.length} entries), not ${MOE_PACKAGE.count}`);
  }
  return list;
}

/** Sets `simplified_only` in the JSON object at `file`, creating `{ version: 1 }` first when there is none. */
export function writeSimplified(file: string, chars: string): void {
  const config: Record<string, unknown> = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : { version: 1 };
  config["simplified_only"] = chars;
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
}

function readUnihan(file: string): string {
  if (file.endsWith(".zip")) return execFileSync("unzip", ["-p", file, "Unihan_Variants.txt"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
  return readFileSync(file, "utf8");
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Downloads Unihan.zip and the Ministry package's tarball into `dir`; returns the two files the build reads. */
async function fetchInputs(dir: string): Promise<{ unihan: string; moe: string }> {
  mkdirSync(dir, { recursive: true });
  const unihan = path.join(dir, "Unihan.zip");
  writeFileSync(unihan, await download(UNIHAN_URL));
  const tgz = await download(MOE_PACKAGE.tarball);
  const integrity = "sha512-" + createHash("sha512").update(tgz).digest("base64");
  if (integrity !== MOE_PACKAGE.integrity) throw new Error(`${MOE_PACKAGE.tarball} has integrity ${integrity}, not the pinned ${MOE_PACKAGE.integrity}`);
  const tarball = path.join(dir, `${MOE_PACKAGE.name}-${MOE_PACKAGE.version}.tgz`);
  writeFileSync(tarball, tgz);
  const moe = path.join(dir, "common.json");
  writeFileSync(moe, execFileSync("tar", ["-xzOf", tarball, MOE_PACKAGE.entry], { maxBuffer: 64 * 1024 * 1024 }));
  return { unihan, moe };
}

const USAGE =
  "usage: tsx fixtures/src/tools/simplified.ts (--fetch [--dir DIR] | --unihan FILE --moe FILE) [--write FILE | --check FILE]";

export async function main(argv: string[], out: (line: string) => void = console.log): Promise<number> {
  const opts: { fetch: boolean; dir: string; unihan?: string; moe?: string; write?: string; check?: string } = { fetch: false, dir: "cache/simplified" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--fetch") opts.fetch = true;
    else if (arg === "--dir") opts.dir = value();
    else if (arg === "--unihan") opts.unihan = value();
    else if (arg === "--moe") opts.moe = value();
    else if (arg === "--write") opts.write = value();
    else if (arg === "--check") opts.check = value();
    else throw new Error(`unknown option ${arg}`);
  }
  if (opts.write && opts.check) throw new Error("--write and --check exclude each other");
  if (opts.fetch === (opts.unihan !== undefined || opts.moe !== undefined)) throw new Error("give --fetch, or --unihan with --moe");
  if (!opts.fetch && (opts.unihan === undefined || opts.moe === undefined)) throw new Error("--unihan and --moe go together");

  const inputs = opts.fetch ? await fetchInputs(opts.dir) : { unihan: opts.unihan!, moe: opts.moe! };
  const variants = parseUnihanVariants(readUnihan(inputs.unihan));
  const common = parseMoeCommon(readFileSync(inputs.moe, "utf8"));
  const built = buildSimplifiedOnly({ variants, common, extra: TAIWAN_EXTRA });
  const problems = checkLists(built.chars);

  out(`Unihan: ${inputs.unihan}`);
  for (const line of variants.header.slice(0, 4)) out(`  ${line}`);
  out(`Ministry list: ${MOE_PACKAGE.name}@${MOE_PACKAGE.version}, ${common.length} characters (${inputs.moe})`);
  out(`kTraditionalVariant entries: ${variants.traditional.size}`);
  out(`simplified_only: ${built.count} characters, ${built.extension} of them in the extension blocks`);
  out(problems.length === 0 ? `lists: ${MUST_HOLD.length} held and ${MUST_NOT_HOLD.length} not held, as they should be` : `lists: ${problems.length} problem(s)`);
  for (const p of problems) out(`  ${p}`);

  let status = problems.length === 0 ? 0 : 1;
  if (opts.write) {
    writeSimplified(opts.write, built.chars);
    out(`wrote simplified_only to ${opts.write}`);
  } else if (opts.check) {
    const config = JSON.parse(readFileSync(opts.check, "utf8")) as { simplified_only?: unknown };
    const held = typeof config.simplified_only === "string" ? config.simplified_only : null;
    if (held === built.chars) out(`${opts.check} holds exactly this list`);
    else {
      status = 1;
      const a = new Set([...(held ?? "")]);
      const b = new Set([...built.chars]);
      const only = (x: Set<string>, y: Set<string>) => [...x].filter((c) => !y.has(c));
      out(`${opts.check} differs: ${only(b, a).length} in the rebuilt list only, ${only(a, b).length} in the file only`);
      out(`  rebuilt only (first 40): ${only(b, a).slice(0, 40).join("")}`);
      out(`  file only (first 40): ${only(a, b).slice(0, 40).join("")}`);
    }
  }
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
      process.exit(2);
    },
  );
}
