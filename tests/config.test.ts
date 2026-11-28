// lib/schema/config.ts and lib/config.ts (SPEC §4.11, §4.13, Appendix B). Part one reads the real files of config/: each
// parses with its schema, prints canonically, agrees with the spec's seeds and holds Chinese in Taiwan usage, and the
// committed `simplified_only` passes the lists of fixtures/src/tools/simplified.ts. Part two gives each schema a valid value
// and a failing one for each constraint, with inline data. Part three runs the cross-file checks on parsed copies of the
// seed and loadConfig() over temporary folders (under the system's temp folder, never inside the repo): each kind of config
// error, the cache, the overrides and the lookups of `index`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterAll, describe, expect, expectTypeOf, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { z } from "zod";
import { checkLists } from "@/fixtures/src/tools/simplified";
import {
  CONFIG_CODES, CONFIG_DIR, CONFIG_FILES, CONFIG_KEYS, CONFIG_SCHEMAS, ConfigError, configIssues, configVersions, hostListed, loadConfig,
  validateConfig,
} from "@/lib/config";
import type { ConfigCode, ConfigFiles, ConfigIndex, ConfigIssue, ConfigKey, LoadedConfig } from "@/lib/config";
import { byCodeUnit } from "@/lib/ids";
import { jsonText, sha256Hex } from "@/lib/json";
import { isPrimary, pressHostFor, primaryTest } from "@/lib/primary";
import {
  AiDrugsFile, AiTermsFile, CheckersFile, ClockTime, COUNTER_IDS, CountersFile, DualUseFile, FieldsFile, HostName, HypeWordsFile, JargonFile,
  JournalsFile, LabsFile, MarkersFile, OPENALEX_FIELD_MAX, OPENALEX_FIELD_MIN, PathPrefix, Publisher, ReactionSource, RegistryEntry, Resolver,
  RunFile, SourceTiersFile, StandingStoriesFile, statementForm, TermsZhFile, typeFieldKind,
} from "@/lib/schema/config";
import type { Checker, Counter, Drug, FixedTerm, Marker, StandingStory } from "@/lib/schema/config";
import { ConfigVersions } from "@/lib/schema/metrics";
import { SourcesFile } from "@/lib/schema/registry";
import { blockedEntry } from "@/lib/urls";
import { BLOCKED_HOSTS, COUNTED_RUNGS, FIELDS } from "@/lib/vocab";
import type { FieldId } from "@/lib/vocab";
import { wordRe, wordsIn } from "@/lib/text";
import { expectIssue, expectMutationFails, expectOnlyIssue, expectValid, issuesOf } from "./helpers/zod-issues";

const root = path.join(__dirname, "..");
const configDir = path.join(root, CONFIG_DIR);
/** The two dashes the spec bans (NO_EM_DASH): built from their code points, so no source line holds one. */
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// ── The seed files, as read from disk ────────────────────────────────────────────────────────────

const textOf = (key: ConfigKey): string => fs.readFileSync(path.join(configDir, CONFIG_FILES[key]), "utf8");
const RAW = Object.fromEntries(CONFIG_KEYS.map((k) => [k, k === "sources" ? parseYaml(textOf(k)) : JSON.parse(textOf(k))])) as Record<ConfigKey, any>;
/** A fresh copy of a file's parsed JSON (or YAML), to change. */
const raw = (key: ConfigKey): any => structuredClone(RAW[key]);
/** A fresh copy of every file, parsed by its schema: what the cross-file checks read. */
const parsedSeed = (): ConfigFiles => Object.fromEntries(CONFIG_KEYS.map((k) => [k, CONFIG_SCHEMAS[k].parse(raw(k))])) as ConfigFiles;
/** The loaded seed, read only (the cache hands the same object to every caller). */
const SEED: LoadedConfig = loadConfig(configDir);

type Step = string | number;
const getAt = (value: any, where: readonly Step[]): any => where.reduce((v, step) => v[step], value);

/** Where an object sits in `value`: the root, and the first entry of each list, so a big seed stays quick. */
function objectPaths(value: unknown, prefix: Step[] = []): Step[][] {
  if (Array.isArray(value)) return value.length > 0 && value[0] !== null && typeof value[0] === "object" ? objectPaths(value[0], [...prefix, 0]) : [];
  if (value === null || typeof value !== "object") return [];
  return [prefix, ...Object.entries(value).flatMap(([k, v]) => objectPaths(v, [...prefix, k]))];
}

/** The value is valid; each object in it refuses a key it does not know and each key it has is needed. */
function expectStrictAndComplete(schema: z.ZodType, base: unknown): void {
  expectValid(schema, base);
  for (const where of objectPaths(base)) {
    expectMutationFails(schema, base, (v) => { getAt(v, where).unexpected_key = 1; }, where.join("."), "Unrecognized key");
    // `types` is a partial record (a publisher need not list every kind), so no key of it is needed
    if (where.at(-1) === "types") continue;
    for (const key of Object.keys(getAt(base, where))) {
      expectMutationFails(schema, base, (v) => { delete getAt(v, where)[key]; }, [...where, key].join("."));
    }
  }
}

/** Every string of a parsed file, keys included, with where it sits. */
function allStrings(value: unknown, where = ""): [string, string][] {
  if (typeof value === "string") return [[where, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => allStrings(v, `${where}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [[`${where}{${k}}`, k] as [string, string], ...allStrings(v, `${where}.${k}`)]);
  }
  return [];
}

/** ZH_NO_DASH (SPEC §4.12): each dash a Chinese string may not hold: any `\p{Pd}` but the hyphen-minus, U+2010, U+2011 and an en dash between digits, and the box-drawing lines. */
function dashesIn(text: string): string[] {
  const chars = [...text];
  return chars.filter((ch, i) => {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x2500 || cp === 0x2501) return true;
    if (!/^\p{Pd}$/u.test(ch) || ch === "-" || cp === 0x2010 || cp === 0x2011) return false;
    return !(cp === 0x2013 && /\d/.test(chars[i - 1] ?? "") && /\d/.test(chars[i + 1] ?? ""));
  });
}

/** The characters of `text` that Taiwan does not write: in `simplified_only` or `japanese_only` (ZH_TRADITIONAL). */
const foreignChars = (text: string): string[] => [...new Set([...text].filter((ch) => SEED.index.simplifiedOnly.has(ch) || SEED.index.japaneseOnly.has(ch)))];

// ── Temporary config folders ─────────────────────────────────────────────────────────────────────

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

interface TempOptions {
  /** Changes the parsed files before they are written. */
  edit?: (files: Record<ConfigKey, any>) => void;
  /** Replaces a file's text, after `edit`. */
  text?: Partial<Record<ConfigKey, string>>;
  /** Files that are not written. */
  missing?: ConfigKey[];
}

/** A folder under the system's temp folder with a copy of the seed config, edited as `opts` says. */
function tempConfig(opts: TempOptions = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-config-test-"));
  temps.push(dir);
  const files = Object.fromEntries(CONFIG_KEYS.map((k) => [k, raw(k)])) as Record<ConfigKey, any>;
  opts.edit?.(files);
  for (const k of CONFIG_KEYS) {
    if (opts.missing?.includes(k)) continue;
    // a file left as it was keeps its bytes (sources.yaml has comments, which a re-print would lose)
    const body = opts.text?.[k] ?? (isDeepStrictEqual(files[k], RAW[k]) ? textOf(k) : k === "sources" ? stringifyYaml(files[k]) : `${JSON.stringify(files[k], null, 2)}\n`);
    fs.writeFileSync(path.join(dir, CONFIG_FILES[k]), body);
  }
  return dir;
}

const issuesFrom = (opts: TempOptions): ConfigIssue[] => configIssues(tempConfig(opts));
/** An issue's `path`: `config/<file>`, then `: <where inside the file>`. */
const here = (key: ConfigKey, inside = ""): string => `${CONFIG_DIR}/${CONFIG_FILES[key]}${inside ? `: ${inside}` : ""}`;

function expectFound(issues: ConfigIssue[], code: ConfigCode, where: string, part?: string): ConfigIssue {
  const hit = issues.find((i) => i.code === code && i.path === where && (part === undefined || i.message.includes(part)));
  expect(hit, `expected ${code} at ${where}${part === undefined ? "" : ` about "${part}"`}, got ${JSON.stringify(issues.map((i) => [i.code, i.path, i.message]))}`).toBeDefined();
  return hit!;
}

/** The cross-file checks on a parsed copy of the seed, changed by `edit`. */
function crossFile(edit: (c: ConfigFiles) => void): ConfigIssue[] {
  const c = parsedSeed();
  edit(c);
  return validateConfig(c);
}

// ═══ Part one: the real files ════════════════════════════════════════════════════════════════════

describe("the files of config/", () => {
  it("are the sixteen files the loader names, and no file that no schema covers", () => {
    expect(CONFIG_KEYS).toHaveLength(16);
    expect(Object.keys(CONFIG_SCHEMAS)).toEqual(CONFIG_KEYS);
    expect(fs.readdirSync(configDir).sort(byCodeUnit)).toEqual(Object.values(CONFIG_FILES).sort(byCodeUnit));
    // a key is the camel-case of its kebab-case file name
    for (const [key, file] of Object.entries(CONFIG_FILES)) {
      expect(file, key).toBe(`${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}.${key === "sources" ? "yaml" : "json"}`);
    }
  });

  it("each JSON file parses with its schema, prints as the schema orders its keys, and is canonical", () => {
    for (const key of CONFIG_KEYS) {
      if (key === "sources") continue;
      const text = textOf(key);
      expect(text.charCodeAt(0), `${key}: no byte order mark`).not.toBe(0xfeff);
      expect(text.includes(String.fromCharCode(13)), `${key}: no CR`).toBe(false);
      expect(text.endsWith("\n") && !text.endsWith("\n\n"), `${key}: one final newline`).toBe(true);
      const parsed = JSON.parse(text);
      expect(`${JSON.stringify(parsed, null, 2)}\n`, `${key}: JSON.stringify(x, null, 2) and a newline`).toBe(text);
      expectValid(CONFIG_SCHEMAS[key], parsed);
      expect(jsonText(parsed, CONFIG_SCHEMAS[key]), `${key}: the schema's key order is the file's`).toBe(text);
    }
  });

  it("sources.yaml parses as the registry of section 4.13", () => {
    expectValid(SourcesFile, RAW.sources);
    expect(SEED.sources.feeds.length).toBeGreaterThan(20);
  });

  it("every file is at schema_version 1 and has a version where the spec gives one", () => {
    const versioned: ConfigKey[] = ["fields", "journals", "aiTerms", "sourceTiers", "aiDrugs", "counters", "termsZh", "jargon", "hypeWords", "dualUse"];
    for (const key of CONFIG_KEYS) {
      expect(RAW[key].schema_version, key).toBe(1);
      expect("version" in RAW[key], `${key} has a version`).toBe(versioned.includes(key));
      if (versioned.includes(key)) expect(Object.keys(RAW[key]).slice(0, 2), key).toEqual(["schema_version", "version"]);
    }
  });

  it("hold no control character, odd space, leading or trailing space, double space or un-normalised text in any string or key", () => {
    let count = 0;
    for (const key of CONFIG_KEYS) {
      for (const [where, s] of allStrings(RAW[key])) {
        count += 1;
        const label = `${key} ${where}`;
        expect(s, label).toBe(s.normalize("NFC"));
        expect(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(s), `${label}: a control or format character`).toBe(false);
        expect(/\p{Zs}/u.test(s.replaceAll(" ", "")), `${label}: a space that is not U+0020`).toBe(false);
        expect(s === s.trim() && !s.includes("  "), `${label}: spaces`).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(6000);
  });

  it("hold no em dash, and an en dash only between digits, in any string or key (NO_EM_DASH)", () => {
    for (const key of CONFIG_KEYS) {
      for (const [where, s] of allStrings(RAW[key])) {
        expect(s.includes(EM), `${key} ${where}`).toBe(false);
        const chars = [...s];
        chars.forEach((ch, i) => {
          if (ch === EN) expect(/\d/.test(chars[i - 1] ?? "") && /\d/.test(chars[i + 1] ?? ""), `${key} ${where}: an en dash`).toBe(true);
        });
      }
    }
  });

  it("the dash check reads the rule of ZH_NO_DASH: every dash but a hyphen, and an en dash between digits", () => {
    expect(dashesIn(`a${EM}b`)).toEqual([EM]);
    expect(dashesIn(`${EM}${EM}`)).toEqual([EM, EM]);
    expect(dashesIn(`2024${EN}25`)).toEqual([]);
    expect(dashesIn(`a${EN}b`)).toEqual([EN]);
    expect(dashesIn(`1${EN}a`)).toEqual([EN]);
    expect(dashesIn(`COVID-19`)).toEqual([]);
    expect(dashesIn(`a${String.fromCharCode(0x2010)}b${String.fromCharCode(0x2011)}c`)).toEqual([]);
    for (const cp of [0x2015, 0x2e3a, 0xfe58, 0xff0d, 0x2500, 0x2501]) expect(dashesIn(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toHaveLength(1);
    expect(dashesIn(`a${String.fromCodePoint(0x2212)}b`), "U+2212 is a minus sign, not a dash by category").toEqual([]);
  });
});

describe("loadConfig() on the seed", () => {
  it("loads config/ with no issue and hands back every file as its schema parses it", () => {
    expect(configIssues(configDir)).toEqual([]);
    const c = loadConfig(configDir);
    expect(c.dir).toBe(configDir);
    for (const key of CONFIG_KEYS) expect(c[key], key).toEqual(CONFIG_SCHEMAS[key].parse(RAW[key]));
    expect(Object.keys(c).sort(byCodeUnit)).toEqual([...CONFIG_KEYS, "dir", "index", "sha256", "versions"].sort(byCodeUnit));
  });

  it("without a folder reads config/ under the working directory", () => {
    expect(loadConfig().dir).toBe(path.resolve(process.cwd(), CONFIG_DIR));
    expect(loadConfig("config").dir).toBe(path.resolve("config"));
  });

  it("records each file's SHA-256, and the four versions the metrics file records", () => {
    for (const key of CONFIG_KEYS) expect(SEED.sha256[key], key).toBe(sha256Hex(fs.readFileSync(path.join(configDir, CONFIG_FILES[key]))));
    expect(SEED.versions).toEqual({ ai_terms: SEED.aiTerms.version, journals: SEED.journals.version, fields: SEED.fields.version, counters: SEED.counters.version });
    expect(Object.keys(SEED.versions)).toEqual(["ai_terms", "journals", "fields", "counters"]);
    expectValid(ConfigVersions, SEED.versions);
    expect(configVersions({ aiTerms: { version: 3 }, journals: { version: 4 }, fields: { version: 5 }, counters: { version: 6 } } as ConfigFiles))
      .toEqual({ ai_terms: 3, journals: 4, fields: 5, counters: 6 });
  });

  it("passes the cross-file checks as a pure function too", () => {
    expect(validateConfig(SEED)).toEqual([]);
    expect(validateConfig(parsedSeed())).toEqual([]);
  });
});

// ── The seeds of Appendix B and section 4.11 ─────────────────────────────────────────────────────

describe("config/run.json", () => {
  it("is the block of SPEC section 4.11", () => {
    const { siblings, ...rest } = raw("run");
    expect(rest).toEqual({
      schema_version: 1,
      site: {
        name: "Unveiling Tracker",
        tagline: { en: "What AI is helping us discover, explained", zh: "AI 正在幫我們發現什麼，說清楚、講明白" },
        url: "https://unveilingtracker.vercel.app",
      },
      repos: { repo: "8gara8/UnveilingTracker", branch: "main" },
      schedule: {
        timezone: "Asia/Taipei", start: "03:15", data_only_target: "03:35", full_target: "04:15", retry_cutoff: "03:50", zh_start_by: "04:05",
        hard_stop: "04:25", stale_after: "08:00", publish_until: "11:00",
      },
      budgets: {
        agent_minutes: 30, zh_minutes: 12, zh_reserve_minutes: 14, web_fetches: 40, zh_fetches: 10, repair_rounds: 2, zh_repair_rounds: 1,
        attempts_max: 2, candidates_max: 40, deep_read_max: 15, findings_max: 5, typical_findings: [3, 5], words_target: 1000, words_max: 1300,
        zh_factor: 1.8, reading_grade_soft: 12, reading_grade_max: 14, reports_max: 5, zh_backlog_max: 5, rung_watch_max: 300,
        publish_reserve_minutes: 4, deploy_wait_minutes: 8,
      },
      pack: { window_end: "03:15", window_hours: 24, lookback_hours: 48 },
      pace: { window_weeks: 13, provisional_weeks: 8, min_cases: 30, min_ratio: 1.25, hold_after_days: 182 },
      paths: { content_dir: "content", cache: "cache", packs: "packs", drafts: "drafts", logs: "logs", needs_review: "needs-review" },
      user_agent: "UnveilingTracker/1.0 (+https://github.com/8gara8/UnveilingTracker)",
      task_name: "Unveiling morning",
    });
    expect(Object.keys(siblings)).toEqual(["me", "europe", "cyber"]);
    expect(siblings.me).toBe("https://metracker.vercel.app");
    expect(siblings.europe).toBe("https://europetracker.vercel.app");
    expect(siblings.cyber).toMatch(/^https:\/\/[a-z0-9-]+\.vercel\.app$/);
  });
});

describe("config/fields.json", () => {
  /** Appendix B: each field's subfields as `[id, en, zh]`. */
  const APPENDIX_B: Record<string, [string, string, string][]> = {
    mathematics: [
      ["number-theory", "Number theory", "數論"], ["combinatorics", "Combinatorics", "組合學"], ["geometry-topology", "Geometry and topology", "幾何與拓樸"],
      ["algebra", "Algebra", "代數"], ["analysis-probability", "Analysis and probability", "分析與機率"], ["formal-proof", "Formal proof", "形式化證明"],
    ],
    physics: [
      ["particles-nuclei", "Particles and nuclei", "粒子與原子核"], ["astronomy", "Astronomy and cosmology", "天文與宇宙學"],
      ["condensed-matter", "Condensed matter", "凝態物理"], ["quantum", "Quantum physics and computing", "量子物理與量子計算"],
      ["plasma-fusion", "Plasma and fusion", "電漿與核融合"], ["atoms-optics", "Atomic and optical physics", "原子與光學物理"],
    ],
    chemistry: [
      ["materials", "Materials", "材料"], ["catalysis", "Catalysis", "催化"], ["energy-materials", "Batteries and energy materials", "電池與能源材料"],
      ["synthesis", "Synthesis and new molecules", "合成與新分子"], ["automated-labs", "Automated labs", "自動化實驗室"],
    ],
    biology: [
      ["proteins", "Proteins and structure", "蛋白質與結構"], ["drugs", "Drugs and trials", "藥物與臨床試驗"], ["genomics", "Genes and genomes", "基因與基因體"],
      ["cells", "Cells and molecular biology", "細胞與分子生物學"], ["neuroscience", "Neuroscience", "神經科學"],
      ["diagnosis", "Diagnosis and imaging", "診斷與醫學影像"], ["infection-immunity", "Infection and immunity", "感染與免疫"],
    ],
    earth: [
      ["weather", "Weather forecasting", "天氣預報"], ["climate", "Climate", "氣候"], ["geology", "Geology and earthquakes", "地質與地震"],
      ["ecology", "Ecology and biodiversity", "生態與生物多樣性"], ["oceans-polar", "Oceans and polar regions", "海洋與極地"],
      ["planetary", "Planetary science", "行星科學"],
    ],
    social: [
      ["replication", "Replication and methods", "重複驗證與研究方法"], ["economics", "Economics", "經濟學"], ["psychology", "Psychology and behaviour", "心理與行為"],
      ["politics-society", "Politics and society", "政治與社會"], ["history-at-scale", "History at scale", "大規模歷史研究"],
      ["surveys-experiments", "Surveys and experiments", "問卷調查與實驗"],
    ],
    humanities: [
      ["ancient-texts", "Ancient texts", "古代文獻"], ["scripture-translation", "Scripture translation", "經文翻譯"],
      ["theology", "Theology and religious studies", "神學與宗教研究"], ["archaeology", "Archaeology and heritage", "考古與文化資產"],
      ["languages", "Languages and linguistics", "語言與語言學"], ["literature-arts", "Literature and the arts", "文學與藝術"], ["philosophy", "Philosophy", "哲學"],
    ],
  };

  it("lists the seven fields in order, each with the subfields of Appendix B", () => {
    expect(SEED.fields.fields.map((f) => f.id)).toEqual([...FIELDS]);
    expect(Object.keys(APPENDIX_B)).toEqual([...FIELDS]);
    let total = 0;
    for (const f of SEED.fields.fields) {
      const ours = f.subfields.filter((s) => APPENDIX_B[f.id]!.some(([id]) => id === s.id));
      expect(ours.map((s) => [s.id, s.en, s.zh]), f.id).toEqual(APPENDIX_B[f.id]);
      expect(f.subfields.length, `${f.id}: 3 to 8 subfields`).toBeGreaterThanOrEqual(3);
      expect(f.subfields.length).toBeLessThanOrEqual(8);
      total += f.subfields.length;
    }
    expect(total).toBeGreaterThanOrEqual(43);
  });

  it("maps the OpenAlex fields as section 4.11 gives them", () => {
    const byField = Object.fromEntries(SEED.fields.fields.map((f) => [f.id, f.openalex_fields]));
    expect(byField).toEqual({
      mathematics: [26], physics: [31], chemistry: [16, 25, 15], biology: [13, 27, 24, 28, 30, 11, 29, 36, 35, 34], earth: [19, 23],
      social: [33, 20, 32, 14, 18], humanities: [12],
    });
    expect(SEED.fields.excluded).toEqual([17, 22, 21]);
    const all = [...Object.values(byField).flat(), ...SEED.fields.excluded].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: OPENALEX_FIELD_MAX - OPENALEX_FIELD_MIN + 1 }, (_, i) => OPENALEX_FIELD_MIN + i));
  });
});

describe("config/journals.json and config/ai-terms.json", () => {
  it("names the journals of section 4.11, and Nature Human Behaviour is out of the Pace", () => {
    const names = SEED.journals.journals.map((j) => j.name);
    for (const name of [
      "Nature", "Science", "Cell", "Proceedings of the National Academy of Sciences", "Physical Review Letters", "Annals of Mathematics", "Nature Physics",
      "Nature Chemistry", "Nature Materials", "Journal of the American Chemical Society", "Nature Medicine", "The New England Journal of Medicine",
      "The Lancet", "Nature Biotechnology", "Nature Geoscience", "Nature Climate Change", "American Economic Review", "American Political Science Review",
      "Nature Human Behaviour", "Inventiones Mathematicae", "Journal of the American Mathematical Society", "Acta Mathematica",
    ]) expect(names, name).toContain(name);
    expect(SEED.journals.journals.find((j) => j.id === "nature-human-behaviour")?.in_pace).toBe(false);
    expect(SEED.index.paceJournals.length).toBeGreaterThan(0);
  });

  it("lists the twenty phrases of section 4.11", () => {
    const phrases = SEED.aiTerms.phrases.map((p) => p.phrase);
    for (const phrase of [
      "machine learning", "deep learning", "neural network", "artificial intelligence", "large language model", "language model", "transformer model",
      "reinforcement learning", "generative model", "diffusion model", "graph neural network", "foundation model", "AlphaFold", "convolutional neural",
      "random forest", "support vector machine", "Bayesian optimization", "active learning", "autonomous laboratory", "self-driving laboratory",
    ]) expect(phrases, phrase).toContain(phrase);
  });
});

describe("config/source-tiers.json, labs.json and checkers.json", () => {
  it("lists the publishers, resolvers and registries of section 4.11", () => {
    const t = SEED.sourceTiers;
    for (const id of [
      "nature", "science", "cell-press", "pnas", "aps", "annals-of-mathematics", "springer", "sciencedirect", "wiley", "ams", "plos", "elife", "nejm", "lancet",
      "cambridge-core", "oxford-academic", "taylor-francis", "de-gruyter", "brill", "sage", "project-muse", "jstor", "arxiv", "biorxiv", "medrxiv", "ssrn",
      "osf-preprints", "chemrxiv",
    ]) expect(t.publishers.map((p) => p.id), id).toContain(id);
    expect(t.publishers.filter((p) => ["arxiv", "biorxiv", "medrxiv", "ssrn", "osf-preprints", "chemrxiv"].includes(p.id)).every((p) => p.kinds.join() === "preprint" && p.type_field === null))
      .toBe(true);
    expect(t.resolvers.map((r) => r.id)).toEqual(expect.arrayContaining(["doi", "pubmed"]));
    expect(t.registries.map((r) => r.id)).toEqual(expect.arrayContaining(["clinicaltrials-gov", "rcsb", "ebi", "zenodo", "github", "huggingface"]));
    expect(t.registries.find((r) => r.id === "github")?.kinds).toEqual(["dataset", "proof"]);
    expect(t.registries.find((r) => r.id === "huggingface")?.kinds).toEqual(["dataset"]);
    expect(t.reaction_sources.map((r) => r.id)).toEqual(expect.arrayContaining(["smc", "terence-tao"]));
    expect(t.statement_suffixes).toEqual(expect.arrayContaining([".edu", ".gov", ".int", ".europa.eu", "mpg.de", "cnrs.fr", "riken.jp", "sinica.edu.tw", "wycliffe.net",
      "unitedbiblesocieties.org", "sil.org", "vatican.va", "eurekalert.org/news-releases/"]));
    expect(t.figure_hosts).toEqual(expect.arrayContaining(["media.springernature.com", "www.science.org", "www.cell.com", "www.pnas.org", "arxiv.org", "www.ncbi.nlm.nih.gov"]));
  });

  it("treats Nature, Science, Cell Press and PNAS as section 4.11 says", () => {
    const by = (id: string) => SEED.sourceTiers.publishers.find((p) => p.id === id)!;
    // P2 adds the paths it finds (section 4.11), so the lists are held to hold the spec's, not to be them
    expect(by("nature").kinds).toEqual(["paper", "notice"]);
    expect(by("nature").paths).toEqual(expect.arrayContaining(["/articles/s", "/articles/nature"]));
    expect(by("nature").reaction_paths).toEqual(expect.arrayContaining(["/articles/d41586-"]));
    expect(by("nature").hosts).toEqual(expect.arrayContaining(["nature.com"]));
    expect(by("science").kinds).toEqual(["paper", "notice", "reaction"]);
    expect(by("science").deny_paths).toEqual(expect.arrayContaining(["/content/article/"]));
    expect(by("science").paths).toEqual(expect.arrayContaining(["/doi/10.1126/"]));
    for (const id of ["cell-press", "pnas"]) expect(by(id).kinds, id).toEqual(["paper", "notice", "reaction"]);
    expect(SEED.sourceTiers.deny_doi_prefixes.some((p) => "10.1038/d41586-".startsWith(p))).toBe(false);
    expect(SEED.sourceTiers.resolvers.find((r) => r.id === "doi")?.kinds).toContain("reaction");
    for (const r of SEED.sourceTiers.resolvers.filter((x) => x.id !== "doi")) expect(r.kinds, r.id).not.toContain("reaction");
  });

  it("keeps the two live exceptions to the press list by name", () => {
    const wins = [...SEED.sourceTiers.reaction_sources, ...SEED.labs.labs, ...SEED.checkers.checkers].flatMap((e) => e.hosts);
    expect(SEED.index.pressHosts.has("wordpress.com") && SEED.index.pressHosts.has("substack.com")).toBe(true);
    expect(wins).toEqual(expect.arrayContaining(["terrytao.wordpress.com", "scrollprize.substack.com"]));
  });

  it("lists the labs and checkers of section 4.11, with the rung each can give", () => {
    expect(SEED.labs.labs.map((l) => l.name)).toEqual(expect.arrayContaining([
      "Google DeepMind", "OpenAI", "Anthropic", "Meta FAIR", "Microsoft Research AI for Science", "FutureHouse", "Periodic Labs", "Isomorphic Labs",
      "Lila Sciences", "Sakana AI", "Arc Institute", "Allen Institute for AI",
    ]));
    const rungs = Object.fromEntries(SEED.checkers.checkers.map((c) => [c.id, c.rungs.join()]));
    expect(rungs).toMatchObject({
      erdosproblems: "checked", "lean-mathlib-repo": "checked", "lean-mathlib-docs": "checked", "nobel-prize": "checked", "breakthrough-prize": "checked",
      "fields-medal": "checked", "abel-prize": "checked", "wolf-prize": "checked", "kavli-prize": "checked", "lasker-awards": "checked",
      "vesuvius-challenge": "checked", casp: "checked", fda: "applied", ema: "applied", "taiwan-fda": "applied", pmda: "applied",
      "clinicaltrials-gov-results": "confirmed",
    });
  });
});

describe("config/counters.json, markers.json, ai-drugs.json and standing-stories.json", () => {
  it("has the seven counters of section 5.7, in order, with the kinds the spec gives", () => {
    const kinds = Object.fromEntries(SEED.counters.counters.map((c) => [c.id, c.kind]));
    expect(Object.keys(kinds)).toEqual([...COUNTER_IDS]);
    expect(kinds).toMatchObject({ mathlib_theorems: "api", ai_drugs: "api", pdb_structures: "api", ai_retractions: "api", full_bibles: "manual", ancient_texts_ai: "ledger" });
    // "api, else manual": P2 settles which on Kobol (section 5.7)
    expect(["api", "manual"]).toContain(kinds.erdos_ai);
    // the Wycliffe totals and the manual figures come with P2 and by PR, so the seed is not held to a count of them
    for (const c of SEED.counters.counters.filter((k) => k.kind !== "manual")) expect([c.id, c.value, c.as_of], c.id).toEqual([c.id, null, null]);
  });

  it("has the four markers of Appendix B, oldest first, each with a primary source", () => {
    // others are added by PR (section 4.11), so the seed is held to hold these four
    expect(SEED.markers.markers.map((m) => [m.date, m.label.en])).toEqual(expect.arrayContaining([
      ["2020-11-30", "AlphaFold 2 at CASP14"], ["2022-11-30", "ChatGPT released"], ["2024-02-05", "Vesuvius Challenge grand prize"],
      ["2024-10-09", "Nobel Prize in Chemistry for protein design and structure prediction"],
    ]));
  });

  it("holds no ai-drugs entry or standing story that this phase would have to vouch for (the lists grow by PR)", () => {
    expect(SEED.aiDrugs.drugs).toBeInstanceOf(Array);
    expect(SEED.standingStories.stories).toBeInstanceOf(Array);
  });
});

describe("config/terms-zh.json", () => {
  /** Appendix B's `fixed` entries: `[en, zh, fields, except]` (fields and except compared as sets). */
  const APPENDIX_B_FIXED: [string, string, string[], string[]][] = [
    ["artificial intelligence", "人工智慧", [], []], ["AI", "AI", [], []], ["machine learning", "機器學習", [], []], ["deep learning", "深度學習", [], []],
    ["neural network", "神經網路", [], []], ["large language model", "大型語言模型", [], []], ["algorithm", "演算法", [], []],
    ["model", "模型", [], ["model organism", "business model", "role model", "to model"]], ["dataset", "資料集", [], []], ["preprint", "預印本", [], []],
    ["peer review", "同儕審查", [], []], ["journal", "期刊", [], []], ["protein", "蛋白質", [], []], ["protein structure", "蛋白質結構", [], []],
    ["protein folding", "蛋白質摺疊", [], []], ["enzyme", "酵素", [], []], ["antibody", "抗體", [], []], ["genome", "基因體", [], []],
    ["clinical trial", "臨床試驗", [], []], ["drug candidate", "候選藥物", [], []],
    ["material", "材料", ["chemistry", "physics"], ["raw material", "supplementary material"]], ["catalyst", "催化劑", [], []],
    ["battery", "電池", [], ["battery of", "test battery"]], ["superconductor", "超導體", [], []], ["qubit", "量子位元", [], []],
    ["plasma", "電漿", ["physics", "chemistry", "earth"], ["blood plasma", "plasma cell"]], ["laser", "雷射", [], []], ["nanometre", "奈米", [], []],
    ["silicon", "矽", [], []], ["theorem", "定理", [], []], ["proof", "證明", ["mathematics"], ["proof of concept", "proof of principle"]],
    ["conjecture", "猜想", [], []], ["formal verification", "形式驗證", [], []], ["climate model", "氣候模型", [], []],
    ["weather forecast", "天氣預報", [], []], ["papyrus", "莎草紙", [], []], ["scroll", "卷軸", [], ["Dead Sea Scroll"]], ["Bible", "聖經", [], []],
    ["retraction", "撤稿", [], []], ["paper mill", "論文工廠", [], []],
  ];
  /** Section 4.11's `avoid` entries: `[term, taiwan, allow_in]`. */
  const SPEC_AVOID: [string, string, string[]][] = [
    ["人工智能", "人工智慧", []], ["算法", "演算法", ["演算法", "運算法則", "計算法", "估算法", "推算法", "預算法"]], ["軟件", "軟體", []],
    ["視頻", "影片", ["電視頻道"]], ["芯片", "晶片", []], ["數據庫", "資料庫", []], ["服務器", "伺服器", []], ["激光", "雷射", ["刺激光"]],
    ["納米", "奈米", ["納米比亞"]], ["硅", "矽", []], ["等離子體", "電漿", []], ["量子比特", "量子位元", []], ["博客", "部落格", []],
  ];
  const T = SEED.termsZh;
  const sorted = (xs: readonly string[]) => [...xs].sort(byCodeUnit);

  it("has every fixed entry of Appendix B, with its fields and exceptions", () => {
    for (const [en, zh, fields, except] of APPENDIX_B_FIXED) {
      const entry = T.fixed.find((e) => e.en === en);
      expect(entry, en).toBeDefined();
      expect(entry!.zh, en).toBe(zh);
      expect(sorted(entry!.fields), en).toEqual(sorted(fields));
      // the exceptions and the allowed strings are grown by PR (section 4.11): the seed holds at least the spec's
      expect(entry!.except, en).toEqual(expect.arrayContaining(except));
    }
  });

  it("has every avoid pair of section 4.11, with its allow_in list, and none of the terms it must never hold", () => {
    for (const [term, taiwan, allowIn] of SPEC_AVOID) {
      const entry = T.avoid.find((a) => a.term === term);
      expect(entry, term).toBeDefined();
      expect(entry!.taiwan, term).toBe(taiwan);
      expect(entry!.allow_in, term).toEqual(expect.arrayContaining(allowIn));
    }
    for (const never of ["質量", "程序", "網絡", "優化", "基因組"]) expect(T.avoid.map((a) => a.term), never).not.toContain(never);
  });

  it("keeps each except phrase holding its entry's English, each allow_in holding its term, and no Taiwan string holding a foreign character", () => {
    for (const e of T.fixed) {
      for (const phrase of e.except) expect(wordRe(e.en, { plurals: true }).test(phrase), `${e.en}: ${phrase}`).toBe(true);
      expect(foreignChars(e.zh), `fixed ${e.en}`).toEqual([]);
      expect(/\d/.test(e.zh), `${e.en}: a digit would add a number the English lacks (ZH_PARITY)`).toBe(false);
    }
    for (const a of T.avoid) {
      expect(foreignChars(a.taiwan), `avoid ${a.term}`).toEqual([]);
      for (const s of a.allow_in) {
        expect(s.includes(a.term), `${a.term}: ${s}`).toBe(true);
        expect(foreignChars(s), `allow_in ${s}`).toEqual([]);
      }
    }
  });

  it("gives each fixed English once, in fields that exist, and overlapping entries that can both be met", () => {
    const folded = T.fixed.map((e) => e.en.toLowerCase().replace(/[\s-]+/g, " "));
    expect(new Set(folded).size).toBe(folded.length);
    for (const e of T.fixed) for (const f of e.fields) expect(FIELDS as readonly string[], `${e.en}: ${f}`).toContain(f);
    // A string with "climate model" needs 模型 (model) and 氣候模型: the shorter zh must sit inside the longer, unless an exception or the fields part them.
    for (const a of T.fixed) {
      for (const b of T.fixed) {
        if (a === b || !wordRe(a.en, { plurals: true }).test(b.en)) continue;
        const apart = a.fields.length > 0 && b.fields.length > 0 && !a.fields.some((f) => b.fields.includes(f));
        const excepted = a.except.some((phrase) => wordRe(phrase).test(b.en));
        expect(b.zh.includes(a.zh) || apart || excepted, `"${b.en}" (${b.zh}) holds "${a.en}" (${a.zh})`).toBe(true);
      }
    }
  });

  it("holds the 17 Japanese-only characters of section 4.11, in code point order, each once, none of them in simplified_only", () => {
    const jp = [...T.japanese_only];
    for (const ch of [..."広図駅気売読価様歩戦険験剤渋黒鉄薬"]) expect(jp, ch).toContain(ch);
    expect(jp).toEqual([...jp].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!));
    expect(new Set(jp).size).toBe(jp.length);
    expect(jp.filter((ch) => SEED.index.simplifiedOnly.has(ch))).toEqual([]);
    expect(T.japanese_only).toBe(T.japanese_only.normalize("NFC"));
  });

  it("holds simplified_only as the tool builds it: 6,741 characters with Unihan 18.0, sorted by code point, each once, and the two 50-character checks", () => {
    const chars = [...T.simplified_only];
    expect(chars).toHaveLength(6741);
    expect(checkLists(T.simplified_only)).toEqual([]);
    const cps = chars.map((ch) => ch.codePointAt(0)!);
    expect(cps).toEqual([...cps].sort((a, b) => a - b));
    expect(new Set(cps).size).toBe(cps.length);
    expect(chars.every((ch) => /^\p{Script=Han}$/u.test(ch))).toBe(true);
    // 4,205 of them are rare characters outside the main and compatibility blocks (SPEC section 4.11).
    expect(cps.filter((cp) => !(cp >= 0x4e00 && cp <= 0x9fff) && !(cp >= 0xf900 && cp <= 0xfaff))).toHaveLength(4205);
    for (const ch of [..."们这个说为发现学问题简体极"]) expect(chars, ch).toContain(ch);
  });

  it("has the loader's two sets read the same characters", () => {
    expect(SEED.index.simplifiedOnly.size).toBe(6741);
    expect(SEED.index.japaneseOnly.size).toBe([...T.japanese_only].length);
    expect(SEED.index.simplifiedOnly.has("个")).toBe(true);
    expect(SEED.index.simplifiedOnly.has("台")).toBe(false);
    expect(SEED.index.japaneseOnly.has("広")).toBe(true);
  });
});

describe("config/jargon.json, hype-words.json and dual-use.json", () => {
  it("names the technical words of section 4.11, each once (hyphen and case aside), at least 400 in all, every field represented", () => {
    const words = SEED.jargon.words;
    expect(words.length).toBeGreaterThanOrEqual(400);
    const have = new Set(words.map((w) => w.en.toLowerCase().replace(/[\s-]+/g, " ")));
    for (const word of [
      "conjecture", "lemma", "manifold", "eigenvalue", "isotope", "plasma", "qubit", "superconductor", "catalyst", "polymer", "crystal structure", "enzyme",
      "antibody", "genome", "protein folding", "CRISPR", "phase 2 trial", "aerosol", "isotope dating", "regression", "randomised controlled trial", "papyrus",
      "codex", "exegesis",
    ]) expect(have, word).toContain(word.toLowerCase());
    expect(have.size).toBe(words.length);
    for (const f of FIELDS) expect(words.some((w) => w.fields.includes(f)), f).toBe(true);
  });

  // The plurals, spellings and derived forms that follow the nine seed words in `en`, as a writer is likely to type them (F-38).
  const HYPE_FORMS = [
    "revolutionise", "revolutionises", "revolutionised", "revolutionising", "revolutionize", "revolutionizes", "revolutionized", "revolutionizing",
    "gamechanging", "game-changer", "game-changers", "gamechanger", "gamechangers", "ground-breaking", "paradigm shifts", "paradigm-shifting",
    "unprecedentedly", "stunningly", "mindblowing", "breakthroughs",
  ];

  it("holds the hype words of section 4.11 exactly, with the Landmark-only word last of the seed in each list, and in `en` their forms after the seed", () => {
    const h = SEED.hypeWords;
    expect(h.en.slice(0, 9)).toEqual(["revolutionary", "game-changing", "groundbreaking", "paradigm shift", "unprecedented", "stunning", "mind-blowing", "changes everything", "breakthrough"]);
    expect(h.en.slice(9)).toEqual(HYPE_FORMS);
    expect(h.zh).toEqual(["革命性", "顛覆性", "劃時代", "前所未有", "史無前例", "驚人", "震撼", "神奇", "典範轉移", "改變一切", "突破"]);
    for (const out of ["miracle", "magic", "holy grail", "奇蹟", "聖杯"]) expect([...h.en, ...h.zh], out).not.toContain(out);
  });

  it("lists the forms of the hype words that HYPE_WORDS would miss as they stand (it matches whole words in the form listed), each caught on its own", () => {
    const seed = SEED.hypeWords.en.slice(0, 9);
    for (const form of HYPE_FORMS) {
      // Each is a new form: none is caught by the seed words alone, and a whole word beside it does not hide it.
      expect(wordsIn(`It was a ${form} for us.`, seed), `${form} is not caught by the seed`).toEqual([]);
      expect(wordsIn(`It was a ${form} for us.`, SEED.hypeWords.en), form).toEqual([form]);
      expect(wordsIn(`It was a ${form.toUpperCase()}, then ${form[0]!.toUpperCase()}${form.slice(1)}.`, SEED.hypeWords.en), `${form} in capitals`).toEqual([form]);
      expect(wordsIn(`It was a x${form} or ${form}x for us.`, SEED.hypeWords.en), `${form} inside a longer word`).toEqual([]);
    }
    // A hyphen and a space read alike, so the hyphenated entries also catch the spaced form.
    for (const spaced of ["game changer", "game changers", "ground breaking", "paradigm shifting", "mind blowing", "Game-Changers"]) {
      expect(wordsIn(`It was a ${spaced} for us.`, SEED.hypeWords.en).length, spaced).toBeGreaterThan(0);
    }
  });

  it("adds no form that is also a legitimate technical word: none is a jargon word, a fixed term, a dual-use form or a field or subfield name, and the legitimate neighbours stay unlisted", () => {
    const fold = (w: string): string => w.toLowerCase().replace(/[\s-]+/g, " ");
    const used = new Set<string>([
      ...SEED.jargon.words.map((w) => fold(w.en)),
      ...SEED.termsZh.fixed.map((t) => fold(t.en)),
      ...[...SEED.dualUse.agents, ...SEED.dualUse.procedures, ...SEED.dualUse.units].flatMap((e) => e.en.map(fold)),
      ...SEED.fields.fields.flatMap((f) => [fold(f.id), ...f.subfields.map((x) => fold(x.en))]),
    ]);
    for (const form of HYPE_FORMS) expect(used.has(fold(form)), form).toBe(false);
    // Words that name a subject, kept off the list on purpose: a revolution is an event of history, and to break through is an action.
    for (const keep of ["revolution", "revolutions", "revolutionaries", "break through", "game", "shift", "paradigm", "stunned", "ground"]) {
      expect(wordsIn(`the ${keep} of it`, SEED.hypeWords.en), keep).toEqual([]);
    }
  });

  it("masks the names of section 4.11: the Breakthrough Prize in Chinese, the others kept in English", () => {
    const names = Object.fromEntries(SEED.hypeWords.names.map((n) => [n.en, n.zh]));
    // grown by PR (section 4.11), so the seed is held to hold these
    expect(names).toMatchObject({
      "Breakthrough Prize": "突破獎", "Breakthrough of the Year": null, "Breakthrough Listen": null, "Breakthrough Starshot": null, "Breakthrough T1D": null,
      "Breakthrough Energy": null, "Breakthrough Therapy": null, "Breakthrough Devices Program": null, "Breakthrough Device": null,
    });
    expect(SEED.index.hypeNames).toEqual({ en: SEED.hypeWords.names.map((n) => n.en), zh: SEED.hypeWords.names.flatMap((n) => (n.zh === null ? [] : [n.zh])) });
    expect(SEED.index.hypeNames.zh).toContain("突破獎");
  });

  it("lists dual-use forms in three lists, each form once across the lists, with the Chinese forms in Taiwan usage", () => {
    const d = SEED.dualUse;
    const forms = (list: "agents" | "procedures" | "units", language: "en" | "zh") => d[list].flatMap((e) => e[language]);
    for (const form of ["anthrax", "ricin", "sarin", "VX", "Novichok", "nerve agent", "bioweapon"]) expect(forms("agents", "en"), form).toContain(form);
    for (const form of ["synthesis route", "culture conditions", "transmissibility enhancement", "gain of function", "aerosolisation"]) expect(forms("procedures", "en"), form).toContain(form);
    for (const form of ["mg", "mL", "°C", "ppm"]) expect(forms("units", "en"), form).toContain(form);
    for (const form of ["毫克", "毫升"]) expect(forms("units", "zh"), form).toContain(form);
    const en = (["agents", "procedures", "units"] as const).flatMap((l) => forms(l, "en").map((f) => f.toLowerCase().replace(/[\s-]+/g, " ")));
    expect(new Set(en).size).toBe(en.length);
    const zh = (["agents", "procedures", "units"] as const).flatMap((l) => forms(l, "zh"));
    expect(new Set(zh).size).toBe(zh.length);
  });
});

describe("the Chinese strings of config/", () => {
  type Zh = { where: string; text: string; kind: "display" | "match" | "mainland" };
  /** Every Chinese string the config holds: those shown on the site, those matched against drafts, and the mainland terms avoid names. */
  function chineseStrings(c: ConfigFiles): Zh[] {
    const out: Zh[] = [];
    const add = (where: string, text: string, kind: Zh["kind"]) => out.push({ where, text, kind });
    add("run site.tagline.zh", c.run.site.tagline.zh, "display");
    for (const f of c.fields.fields) for (const s of f.subfields) add(`fields ${s.id}`, s.zh, "display");
    for (const k of c.counters.counters) {
      add(`counters ${k.id} label`, k.label.zh, "display");
      add(`counters ${k.id} unit`, k.unit.zh, "display");
    }
    for (const m of c.markers.markers) add(`markers ${m.date}`, m.label.zh, "display");
    for (const e of c.termsZh.fixed) add(`terms-zh fixed ${e.en}`, e.zh, "match");
    for (const a of c.termsZh.avoid) {
      add(`terms-zh avoid ${a.term} term`, a.term, "mainland");
      add(`terms-zh avoid ${a.term} taiwan`, a.taiwan, "match");
      for (const s of a.allow_in) add(`terms-zh avoid ${a.term} allow_in`, s, "match");
    }
    for (const w of c.hypeWords.zh) add(`hype-words zh ${w}`, w, "match");
    for (const n of c.hypeWords.names) if (n.zh !== null) add(`hype-words names ${n.en}`, n.zh, "match");
    for (const list of ["agents", "procedures", "units"] as const) c.dualUse[list].forEach((e, i) => e.zh.forEach((s) => add(`dual-use ${list}[${i}]`, s, "match")));
    return out;
  }
  const ALL = chineseStrings(SEED);

  it("are all found: the labels, the fixed and avoid lists, the hype and dual-use forms", () => {
    expect(ALL.length).toBeGreaterThan(450);
    for (const kind of ["display", "match", "mainland"] as const) expect(ALL.some((z) => z.kind === kind), kind).toBe(true);
  });

  it("hold no simplified-only or Japanese-only character (ZH_TRADITIONAL), the mainland terms of avoid included", () => {
    for (const z of ALL) expect(foreignChars(z.text), `${z.where}: ${z.text}`).toEqual([]);
  });

  it("hold no dash of any kind (ZH_NO_DASH)", () => {
    for (const z of ALL) expect(dashesIn(z.text), `${z.where}: ${z.text}`).toEqual([]);
  });

  it("are Han characters, with a Latin or digit run set off by one space from Han (STYLE-ZH), and full-width marks", () => {
    for (const z of ALL.filter((s) => s.kind === "display")) {
      expect(/\p{Script=Han}/u.test(z.text), `${z.where}: Chinese`).toBe(true);
      expect(/[A-Za-z0-9]\p{Script=Han}|\p{Script=Han}[A-Za-z0-9]/u.test(z.text), `${z.where}: no space between Latin or digits and Han: ${z.text}`).toBe(false);
      expect(/[，。：；？！（）、「」『』] | [，。：；？！）、」』]|[（「『] /u.test(z.text), `${z.where}: a space beside a full-width mark`).toBe(false);
      expect(/[,;:?!]/.test(z.text.replace(/\d[,.]\d/g, "")), `${z.where}: a half-width mark`).toBe(false);
    }
    for (const z of ALL.filter((s) => s.kind === "mainland")) expect(/^\p{Script=Han}+$/u.test(z.text), `${z.where}: ${z.text}`).toBe(true);
  });
});

// ═══ Part two: the schemas ═══════════════════════════════════════════════════════════════════════

/** A value passes the schema or fails it, for each of a list of values. */
function expectAccepts(schema: z.ZodType, values: unknown[]): void {
  for (const v of values) expect(schema.safeParse(v).success, `accepts ${JSON.stringify(v)}`).toBe(true);
}
function expectRefuses(schema: z.ZodType, values: unknown[]): void {
  for (const v of values) expect(schema.safeParse(v).success, `refuses ${JSON.stringify(v)}`).toBe(false);
}

describe("the small forms", () => {
  it("HostName is a bare lower-case host of at least two labels", () => {
    expectAccepts(HostName, ["nature.com", "www.nature.com", "a.b", "a1.b2.c3", "xn--bcher-kva.example", "a-b.c-d.org", "bbc.co.uk", "10.126.org"]);
    expectRefuses(HostName, [
      "", "nature", "Nature.com", "https://nature.com", "nature.com/", "nature.com/x", "nature.com:443", "na ture.com", ".nature.com", "nature.com.", "nature..com",
      "-a.com", "a-.com", "a_b.com", "*.nature.com", "nature.com?x", "user@nature.com", 5, null,
    ]);
    expect(issuesOf(HostName, "Nature.com")[0]!.message).toContain("bare lower-case host");
  });

  it("PathPrefix starts with / and holds no space, query or fragment; / alone is any path", () => {
    expectAccepts(PathPrefix, ["/", "/articles/s", "/doi/10.1126/", "/a-b_c.d~e%20", "/expert-reaction-", "/mathlib4_docs/", "/news-releases/"]);
    expectRefuses(PathPrefix, ["", "articles", "a/b", "/a b", "/a?b", "/a#b", `/a${String.fromCharCode(9)}b`, `/a${String.fromCharCode(10)}b`, "https://x.org/a", 5]);
    expect(issuesOf(PathPrefix, "x")[0]!.message).toContain("path prefix");
  });

  it("ClockTime is HH:MM on a 24-hour clock, and a bad one gives one issue", () => {
    expectAccepts(ClockTime, ["00:00", "03:15", "09:05", "19:59", "23:59"]);
    expectRefuses(ClockTime, ["24:00", "3:15", "03:5", "03:60", "0315", "03:15:00", "", "aa:bb", "03-15", " 03:15", "03:15 ", "29:00", "-1:00", 315, null]);
    expect(issuesOf(ClockTime, "3:15")).toHaveLength(1);
  });

  it("typeFieldKind reads a selector when the text starts with . or # or holds whitespace, > or [, else a meta name", () => {
    for (const s of [".article-type", "#type", "a b", "a>b", "a[b]", "meta[name=x]", "span > b", ".a"]) expect(typeFieldKind(s), s).toBe("selector");
    // a dot inside is part of a meta name such as dc.type, so only a leading dot makes a selector
    for (const s of ["citation_article_type", "dc.type", "og:type", "DC.type", "x", "div.type"]) expect(typeFieldKind(s), s).toBe("meta");
  });

  it("statementForm tells a suffix (leading dot), a host and a host with a path apart", () => {
    for (const [entry, form] of [
      [".edu", "suffix"], [".ac.uk", "suffix"], [".europa.eu", "suffix"], ["mpg.de", "host"], ["scrollprize.substack.com", "host"], ["cell.com/newsroom", "path"],
      ["eurekalert.org/news-releases/", "path"], ["group.springernature.com/gp/group/media/press-releases", "path"],
    ] as const) expect(statementForm(entry), entry).toBe(form);
  });

  it("hostListed gives the most specific listed domain a host is or sits under, else null", () => {
    const set = new Set(["example.com", "b.example.com", "x.org"]);
    expect(hostListed("example.com", set)).toBe("example.com");
    expect(hostListed("www.example.com", set)).toBe("example.com");
    expect(hostListed("a.b.example.com", set)).toBe("b.example.com");
    expect(hostListed("b.example.com", set)).toBe("b.example.com");
    expect(hostListed("A.B.Example.COM", set)).toBe("b.example.com");
    expect(hostListed("example.com.", set)).toBe("example.com");
    expect(hostListed("notexample.com", set)).toBeNull();
    expect(hostListed("example.org", set)).toBeNull();
    expect(hostListed("com", set)).toBeNull();
    expect(hostListed("", set)).toBeNull();
    expect(hostListed("x.org", new Set())).toBeNull();
  });
});

describe("RunFile", () => {
  const run = (): any => raw("run");

  it("takes the seed, with its keys in the order of SPEC section 4.11", () => {
    expectValid(RunFile, run());
    expect(Object.keys(RunFile.shape)).toEqual(["schema_version", "site", "repos", "siblings", "schedule", "budgets", "pack", "pace", "paths", "user_agent", "task_name"]);
    expect(Object.keys(RunFile.shape.schedule.shape)).toEqual([
      "timezone", "start", "data_only_target", "full_target", "retry_cutoff", "zh_start_by", "hard_stop", "stale_after", "publish_until",
    ]);
    expect(Object.keys(RunFile.shape.budgets.shape)).toEqual([
      "agent_minutes", "zh_minutes", "zh_reserve_minutes", "web_fetches", "zh_fetches", "repair_rounds", "zh_repair_rounds", "attempts_max", "candidates_max",
      "deep_read_max", "findings_max", "typical_findings", "words_target", "words_max", "zh_factor", "reading_grade_soft", "reading_grade_max", "reports_max",
      "zh_backlog_max", "rung_watch_max", "publish_reserve_minutes", "deploy_wait_minutes",
    ]);
    expect(Object.keys(RunFile.parse(Object.fromEntries(Object.entries(run()).reverse())))).toEqual(Object.keys(RunFile.shape));
  });

  it("needs every key, in every object, and refuses a key it does not know", () => {
    expectStrictAndComplete(RunFile, run());
  });

  it("is Taipei time and schema version 1", () => {
    expectMutationFails(RunFile, run(), (r) => { r.schedule.timezone = "UTC"; }, "schedule.timezone");
    expectMutationFails(RunFile, run(), (r) => { r.schedule.timezone = "Europe/Paris"; }, "schedule.timezone");
    expectMutationFails(RunFile, run(), (r) => { r.schema_version = 2; }, "schema_version");
  });

  it("holds each clock time as HH:MM, and a bad time gives that one issue and no ordering noise", () => {
    for (const key of ["start", "data_only_target", "full_target", "retry_cutoff", "zh_start_by", "hard_stop", "stale_after", "publish_until"]) {
      const bad = run();
      bad.schedule[key] = "3:15";
      expectOnlyIssue(RunFile, bad, `schedule.${key}`, "HH:MM");
    }
    const late = run();
    late.pack.window_end = "25:00";
    expectOnlyIssue(RunFile, late, "pack.window_end");
    // a time that is out of range but would read as later than the rest does not add an ordering issue as well
    for (const key of ["start", "retry_cutoff", "hard_stop"]) {
      const over = run();
      over.schedule[key] = "24:00";
      expectOnlyIssue(RunFile, over, `schedule.${key}`, "HH:MM");
    }
  });

  it("puts the clock in order: start, retry_cutoff, zh_start_by, hard_stop, stale_after, publish_until", () => {
    const chain = ["start", "retry_cutoff", "zh_start_by", "hard_stop", "stale_after", "publish_until"];
    for (let i = 1; i < chain.length; i++) {
      const [before, after] = [chain[i - 1]!, chain[i]!];
      for (const when of ["equal", "earlier"]) {
        const bad = run();
        bad.schedule[after] = when === "equal" ? bad.schedule[before] : "00:00";
        expectIssue(RunFile, bad, `schedule.${after}`, `schedule.${before} (${bad.schedule[before]}) must be earlier than schedule.${after}`);
      }
    }
  });

  it("puts the targets between the start and the hard stop: start, data_only_target, full_target, hard_stop", () => {
    const pairs = [["start", "data_only_target"], ["data_only_target", "full_target"], ["full_target", "hard_stop"]] as const;
    for (const [before, after] of pairs) {
      const bad = run();
      bad.schedule[after] = bad.schedule[before];
      expectIssue(RunFile, bad, `schedule.${after}`, `schedule.${before}`);
    }
    const early = run();
    early.schedule.data_only_target = "03:00";
    expectIssue(RunFile, early, "schedule.data_only_target", "schedule.start (03:15)");
    // the spec does not enforce a target against the other limits: full_target may sit before the Chinese pass must start, data_only_target after a retry
    const before = run();
    before.schedule.full_target = "03:55";
    expectValid(RunFile, before);
    const after = run();
    after.schedule.data_only_target = "03:55";
    expectValid(RunFile, after);
  });

  it("holds typical_findings as [fewest, most], with the most no more than findings_max", () => {
    for (const ok of [[3, 5], [1, 1], [5, 5], [1, 5]]) {
      const r = run();
      r.budgets.typical_findings = ok;
      expectValid(RunFile, r);
    }
    for (const [bad, where] of [
      [[5, 3], ""], [[3, 6], ""], [[3], ""], [[3, 4, 5], ""], [[0, 5], ".0"], [[3, 0], ".1"], [[3.5, 4], ".0"], [["3", "5"], ".0"], [[3, null], ".1"],
    ] as const) {
      expectMutationFails(RunFile, run(), (r) => { r.budgets.typical_findings = bad; }, `budgets.typical_findings${where}`);
    }
    expectMutationFails(RunFile, run(), (r) => { r.budgets.typical_findings = [5, 3]; }, "budgets.typical_findings", "fewest <= most <= findings_max");
    const wide = run();
    wide.budgets.findings_max = 8;
    wide.budgets.typical_findings = [3, 8];
    expectValid(RunFile, wide);
  });

  it("holds words_target and the reading grades at or under their maximums, and the lookback over the window", () => {
    const equal = run();
    equal.budgets.words_target = equal.budgets.words_max;
    equal.budgets.reading_grade_soft = equal.budgets.reading_grade_max;
    equal.pack.window_hours = equal.pack.lookback_hours;
    expectValid(RunFile, equal);
    expectMutationFails(RunFile, run(), (r) => { r.budgets.words_target = r.budgets.words_max + 1; }, "budgets.words_target");
    expectMutationFails(RunFile, run(), (r) => { r.budgets.reading_grade_soft = r.budgets.reading_grade_max + 0.5; }, "budgets.reading_grade_soft");
    expectMutationFails(RunFile, run(), (r) => { r.pack.window_hours = r.pack.lookback_hours + 1; }, "pack.lookback_hours", "at least window_hours");
  });

  it("takes whole minutes, rounds and counts from 1 where the spec has a floor, and from 0 where none is needed", () => {
    const positive = [
      ["budgets", "agent_minutes"], ["budgets", "zh_minutes"], ["budgets", "zh_reserve_minutes"], ["budgets", "attempts_max"], ["budgets", "candidates_max"],
      ["budgets", "deep_read_max"], ["budgets", "findings_max"], ["budgets", "words_target"], ["budgets", "words_max"], ["budgets", "rung_watch_max"],
      ["pack", "window_hours"], ["pack", "lookback_hours"], ["pace", "window_weeks"], ["pace", "provisional_weeks"], ["pace", "min_cases"], ["pace", "hold_after_days"],
    ] as const;
    for (const [group, key] of positive) {
      for (const bad of [0, -1, 1.5, "3", null]) expectMutationFails(RunFile, run(), (r) => { r[group][key] = bad; }, `${group}.${key}`);
    }
    const counts = ["web_fetches", "zh_fetches", "repair_rounds", "zh_repair_rounds", "reports_max", "zh_backlog_max", "publish_reserve_minutes", "deploy_wait_minutes"];
    for (const key of counts) {
      const zero = run();
      zero.budgets[key] = 0;
      expectValid(RunFile, zero);
      for (const bad of [-1, 1.5, "3", null]) expectMutationFails(RunFile, run(), (r) => { r.budgets[key] = bad; }, `budgets.${key}`);
    }
  });

  it("takes zh_factor and the reading grades as positive numbers, and min_ratio as at least 1", () => {
    for (const key of ["zh_factor", "reading_grade_soft", "reading_grade_max"]) {
      for (const bad of [0, -1, "1.8", null]) expectMutationFails(RunFile, run(), (r) => { r.budgets[key] = bad; }, `budgets.${key}`);
    }
    const odd = run();
    odd.budgets.zh_factor = 2;
    odd.budgets.reading_grade_soft = 11.5;
    expectValid(RunFile, odd);
    for (const ok of [1, 1.25, 3]) {
      const r = run();
      r.pace.min_ratio = ok;
      expectValid(RunFile, r);
    }
    for (const bad of [0.99, 0, -1, "1.25", null]) expectMutationFails(RunFile, run(), (r) => { r.pace.min_ratio = bad; }, "pace.min_ratio");
  });

  it("holds the site's and the siblings' addresses to an origin: https, the host and nothing after it", () => {
    const places: [string, (r: any, v: string) => void][] = [
      ["site.url", (r, v) => { r.site.url = v; }], ["siblings.me", (r, v) => { r.siblings.me = v; }], ["siblings.europe", (r, v) => { r.siblings.europe = v; }],
      ["siblings.cyber", (r, v) => { r.siblings.cyber = v; }],
    ];
    for (const [place, set] of places) {
      for (const ok of ["https://example.org", "https://a.b.example.org", "https://example.org:8443"]) {
        const r = run();
        set(r, ok);
        expectValid(RunFile, r);
      }
      for (const bad of ["https://example.org/", "https://example.org/x", "https://example.org?x=1", "https://example.org#x", "http://example.org", "example.org", "https://EXAMPLE.org", "https://user@example.org", ""]) {
        expectMutationFails(RunFile, run(), (r) => set(r, bad), place);
      }
    }
  });

  it("takes owner/name as the repo, and the user agent must name that repo's URL and no e-mail address", () => {
    for (const ok of ["8gara8/UnveilingTracker", "a/b", "A-b/c.d_e"]) {
      const r = run();
      r.repos.repo = ok;
      r.user_agent = `UnveilingTracker/1.0 (+https://github.com/${ok})`;
      expectValid(RunFile, r);
    }
    for (const bad of ["UnveilingTracker", "a/b/c", "/b", "a/", "-a/b", "a b/c", ""]) expectMutationFails(RunFile, run(), (r) => { r.repos.repo = bad; }, "repos.repo");
    expectMutationFails(RunFile, run(), (r) => { r.repos.repo = "someone/other"; }, "user_agent", "must name the repo's URL, https://github.com/someone/other");
    expectMutationFails(RunFile, run(), (r) => { r.user_agent = "UnveilingTracker/1.0"; }, "user_agent", "must name the repo's URL");
    for (const agent of ["UnveilingTracker/1.0 (+github.com/8gara8/UnveilingTracker)", "UnveilingTracker/1.0 (+http://github.com/8gara8/UnveilingTracker)", "UnveilingTracker/1.0 (+https://github.com/8gara8)"]) {
      expectMutationFails(RunFile, run(), (r) => { r.user_agent = agent; }, "user_agent", "must name the repo's URL");
    }
    expectMutationFails(RunFile, run(), (r) => { r.user_agent = "UnveilingTracker/1.0 (jl@example.org; +https://github.com/8gara8/UnveilingTracker)"; }, "user_agent", "no e-mail address");
    expectMutationFails(RunFile, run(), (r) => { r.user_agent = ""; }, "user_agent");
    expectMutationFails(RunFile, run(), (r) => { r.repos.branch = ""; }, "repos.branch");
  });

  it("holds the six folders to lower-case relative names inside the repo, each used once", () => {
    for (const ok of ["needs-review2", "a/b", "a/b/c", "a/b/c/d", "logs2", "cache.d", "a_b", "x", "0a"]) {
      const r = run();
      r.paths.cache = ok;
      expectValid(RunFile, r);
    }
    for (const bad of ["/abs", "../up", "a/../b", "A", "a b", "a\\b", "", "a/", "./a", ".hidden", "a//b"]) {
      expectMutationFails(RunFile, run(), (r) => { r.paths.logs = bad; }, "paths.logs");
    }
    expectMutationFails(RunFile, run(), (r) => { r.paths.cache = "content"; }, "paths.cache", "already used");
    expectMutationFails(RunFile, run(), (r) => { r.paths.needs_review = r.paths.drafts; }, "paths.needs_review", `"drafts"`);
  });

  it("needs a site name, a tagline in both languages, and a task name", () => {
    expectMutationFails(RunFile, run(), (r) => { r.site.name = ""; }, "site.name");
    expectMutationFails(RunFile, run(), (r) => { r.site.name = " Unveiling Tracker"; }, "site.name", "no space");
    expectMutationFails(RunFile, run(), (r) => { r.site.tagline.zh = ""; }, "site.tagline.zh");
    expectMutationFails(RunFile, run(), (r) => { r.site.tagline.en = null; }, "site.tagline.en");
    expectMutationFails(RunFile, run(), (r) => { r.task_name = ""; }, "task_name");
  });
});

describe("FieldsFile", () => {
  const fields = (): any => raw("fields");

  it("takes the seed, with the keys in file order", () => {
    expectValid(FieldsFile, fields());
    expect(Object.keys(FieldsFile.shape)).toEqual(["schema_version", "version", "fields", "excluded"]);
    expect(Object.keys(FieldsFile.shape.fields.element.shape)).toEqual(["id", "openalex_fields", "subfields"]);
    expect(Object.keys(FieldsFile.shape.fields.element.shape.subfields.element.shape)).toEqual(["id", "en", "zh"]);
    expectStrictAndComplete(FieldsFile, fields());
  });

  it("lists the seven fields in the order of FIELDS", () => {
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields.pop(); }, "fields", "seven fields");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields.reverse(); }, "fields", "in this order");
    expectMutationFails(FieldsFile, fields(), (f) => { [f.fields[0], f.fields[1]] = [f.fields[1], f.fields[0]]; }, "fields");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields.push(structuredClone(f.fields[0])); }, "fields");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[0].id = "astronomy"; }, "fields.0.id");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields = []; }, "fields");
  });

  it("keeps each subfield id unique in the file and in the config id format", () => {
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[1].subfields[0].id = f.fields[0].subfields[0].id; }, "fields.1.subfields.0.id", "already used under mathematics");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[0].subfields[1].id = f.fields[0].subfields[0].id; }, "fields.0.subfields.1.id", "already used under mathematics");
    for (const bad of ["Number_Theory", "", "number theory", "-x"]) expectMutationFails(FieldsFile, fields(), (f) => { f.fields[0].subfields[0].id = bad; }, "fields.0.subfields.0.id");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[0].subfields[0].en = ""; }, "fields.0.subfields.0.en");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[0].subfields[0].zh = null; }, "fields.0.subfields.0.zh");
  });

  it("gives each field 3 to 8 subfields", () => {
    const two = fields();
    two.fields[2].subfields = two.fields[2].subfields.slice(0, 2);
    expectIssue(FieldsFile, two, "fields.2.subfields");
    const three = fields();
    three.fields[2].subfields = three.fields[2].subfields.slice(0, 3);
    expectValid(FieldsFile, three);
    const eight = fields();
    for (let i = eight.fields[2].subfields.length; i < 8; i++) eight.fields[2].subfields.push({ id: `extra-${i}`, en: `Extra ${i}`, zh: `額外${i}` });
    expectValid(FieldsFile, eight);
    eight.fields[2].subfields.push({ id: "extra-9", en: "Extra 9", zh: "額外九" });
    expectIssue(FieldsFile, eight, "fields.2.subfields");
  });

  it("names each OpenAlex field once, under a field or in excluded, within 11 to 36", () => {
    expect([OPENALEX_FIELD_MIN, OPENALEX_FIELD_MAX]).toEqual([11, 36]);
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[3].openalex_fields = f.fields[3].openalex_fields.filter((id: number) => id !== 36); }, "", "OpenAlex field 36 is listed under no field");
    expectMutationFails(FieldsFile, fields(), (f) => { f.excluded = []; }, "", "OpenAlex field 17 is listed under no field");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[1].openalex_fields.push(26); }, "fields.1.openalex_fields.1", "OpenAlex field 26 is already listed under mathematics");
    expectMutationFails(FieldsFile, fields(), (f) => { f.excluded.push(26); }, "excluded.3", "already listed under mathematics");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[1].openalex_fields.push(17); }, "excluded.0", "already listed under physics");
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[2].openalex_fields.push(16); }, "fields.2.openalex_fields.3", "already");
    for (const bad of [10, 37, 0, 26.5, "26"]) {
      expectMutationFails(FieldsFile, fields(), (f) => { f.fields[0].openalex_fields = [bad]; }, "fields.0.openalex_fields.0");
      expectMutationFails(FieldsFile, fields(), (f) => { f.excluded[0] = bad; }, "excluded.0");
    }
    expectMutationFails(FieldsFile, fields(), (f) => { f.fields[0].openalex_fields = []; }, "fields.0.openalex_fields");
    // each of the 26 ids is needed: a mapping without one names it
    for (let id = OPENALEX_FIELD_MIN; id <= OPENALEX_FIELD_MAX; id++) {
      expectMutationFails(FieldsFile, fields(), (f) => {
        for (const e of f.fields) e.openalex_fields = e.openalex_fields.filter((x: number) => x !== id);
        f.excluded = f.excluded.filter((x: number) => x !== id);
      }, "", `OpenAlex field ${id} is listed under no field`);
    }
    // ids that are not excluded may all sit under fields
    const none = fields();
    none.fields[0].openalex_fields.push(...none.excluded);
    none.excluded = [];
    expectValid(FieldsFile, none);
  });

  it("holds a version of 1 or more and schema_version 1", () => {
    for (const bad of [0, -1, 1.5, "1", null]) expectMutationFails(FieldsFile, fields(), (f) => { f.version = bad; }, "version");
    const v2 = fields();
    v2.version = 2;
    expectValid(FieldsFile, v2);
    expectMutationFails(FieldsFile, fields(), (f) => { f.schema_version = 2; }, "schema_version");
  });
});

describe("JournalsFile and AiTermsFile", () => {
  const journals = (): any => raw("journals");
  const aiTerms = (): any => raw("aiTerms");

  it("JournalsFile takes the seed, with the keys in file order", () => {
    expectStrictAndComplete(JournalsFile, journals());
    expect(Object.keys(JournalsFile.shape.journals.element.shape)).toEqual(["id", "name", "openalex_source", "issn", "fields", "in_pace"]);
  });

  it("JournalsFile keeps each journal's id, name, OpenAlex source and ISSN unique", () => {
    expectMutationFails(JournalsFile, journals(), (f) => { f.journals[1].id = f.journals[0].id; }, "journals.1.id", "already used at index 0");
    expectMutationFails(JournalsFile, journals(), (f) => { f.journals[1].name = "nature"; }, "journals.1.name", "already used at index 0");
    expectMutationFails(JournalsFile, journals(), (f) => { f.journals[1].name = "NATURE"; }, "journals.1.name");
    expectMutationFails(JournalsFile, journals(), (f) => { f.journals[1].openalex_source = f.journals[0].openalex_source; }, "journals.1.openalex_source", "already used at index 0");
    expectMutationFails(JournalsFile, journals(), (f) => { f.journals[1].issn = f.journals[0].issn; }, "journals.1.issn", "already used at index 0");
  });

  it("JournalsFile needs at least one journal and one that counts in the Pace", () => {
    expectMutationFails(JournalsFile, journals(), (f) => { f.journals = []; }, "journals", "expected array to have >=1 items");
    expectMutationFails(JournalsFile, journals(), (f) => { f.journals = []; }, "journals", "count in the Pace");
    expectMutationFails(JournalsFile, journals(), (f) => { for (const j of f.journals) j.in_pace = false; }, "journals", "count in the Pace");
    const one = journals();
    one.journals = [{ ...one.journals[0], in_pace: true }];
    expectValid(JournalsFile, one);
  });

  it("JournalsFile holds an ISSN with the right check digit (ISO 3297: weights 8 to 2, modulus 11, X for 10)", () => {
    const one = (issn: string) => {
      const f = journals();
      f.journals = [{ ...f.journals[0], issn }];
      return f;
    };
    for (const ok of ["0028-0836", "2434-561X", "0000-0000", "0036-8075", "1749-4885"]) expectValid(JournalsFile, one(ok));
    for (const bad of ["0028-0837", "2434-5610", "0028-0830", "1749-4886", "0028-083X", "0000-000X", "2434-5619"]) {
      expectOnlyIssue(JournalsFile, one(bad), "journals.0.issn", "check digit");
    }
    for (const bad of ["2434-561x", "00280836", "0028-083", "0028-08366", "ABCD-1234", "", "0028 0836", "0028-0836 "]) expectOnlyIssue(JournalsFile, one(bad), "journals.0.issn", "NNNN-NNNN");
  });

  it("JournalsFile holds an OpenAlex source id, at least one field of the seven, each once, and a boolean in_pace", () => {
    for (const ok of ["S137773608", "S1", "S9999999950"]) {
      const f = journals();
      f.journals[0].openalex_source = ok;
      expectValid(JournalsFile, f);
    }
    for (const bad of ["s1", "S", "S12a", "W123", "", "137773608", "S 1", "xS1", "SS1", "S1S2", " S1", "S1 ", "S1\n", null]) {
      expectMutationFails(JournalsFile, journals(), (f) => { f.journals[0].openalex_source = bad; }, "journals.0.openalex_source");
    }
    for (const [bad, where] of [[[], ""], [["astronomy"], ".0"], [["physics", "physics"], ".1"], ["physics", ""], [null, ""]] as const) {
      expectMutationFails(JournalsFile, journals(), (f) => { f.journals[0].fields = bad; }, `journals.0.fields${where}`);
    }
    for (const bad of ["true", 1, null]) expectMutationFails(JournalsFile, journals(), (f) => { f.journals[0].in_pace = bad; }, "journals.0.in_pace");
    for (const bad of ["Nature", "", "-nature", "a_b"]) expectMutationFails(JournalsFile, journals(), (f) => { f.journals[0].id = bad; }, "journals.0.id");
    expectMutationFails(JournalsFile, journals(), (f) => { f.journals[0].name = ""; }, "journals.0.name");
  });

  it("AiTermsFile takes the seed, with the keys in file order", () => {
    expectStrictAndComplete(AiTermsFile, aiTerms());
    expect(Object.keys(AiTermsFile.shape.phrases.element.shape)).toEqual(["phrase", "in_pace"]);
  });

  it("AiTermsFile takes words of letters and digits joined by one space or hyphen, since a phrase goes into a quoted search", () => {
    for (const ok of ["machine learning", "AlphaFold 2", "AlphaFold2", "cellular-automata", "naïve Bayes", "k-means", "GPT-4", "Bayesian"]) {
      const f = aiTerms();
      f.phrases[0].phrase = ok;
      expectValid(AiTermsFile, f);
    }
    for (const bad of ['"quoted"', "machine  learning", " machine", "machine learning ", "deep_learning", "AI/ML", "neural-", "-neural", "a - b", "", "a.b", "it's", "a\tb"]) {
      expectMutationFails(AiTermsFile, aiTerms(), (f) => { f.phrases[0].phrase = bad; }, "phrases.0.phrase");
    }
  });

  it("AiTermsFile gives each phrase once (case, spaces and hyphens aside) and needs one that counts in the Pace", () => {
    expectMutationFails(AiTermsFile, aiTerms(), (f) => { f.phrases[1].phrase = "Machine Learning"; }, "phrases.1.phrase", "already used at index 0");
    expectMutationFails(AiTermsFile, aiTerms(), (f) => { f.phrases[1].phrase = "machine-learning"; }, "phrases.1.phrase", "already used at index 0");
    expectMutationFails(AiTermsFile, aiTerms(), (f) => { f.phrases = []; }, "phrases", "expected array to have >=1 items");
    expectMutationFails(AiTermsFile, aiTerms(), (f) => { f.phrases = []; }, "phrases", "count in the Pace");
    expectMutationFails(AiTermsFile, aiTerms(), (f) => { for (const p of f.phrases) p.in_pace = false; }, "phrases", "count in the Pace");
    const one = aiTerms();
    for (const p of one.phrases.slice(1)) p.in_pace = false;
    expectValid(AiTermsFile, one);
    expectMutationFails(AiTermsFile, aiTerms(), (f) => { f.phrases[0].in_pace = "yes"; }, "phrases.0.in_pace");
  });
});

describe("Publisher", () => {
  const publisher = (): any => ({
    id: "nature",
    name: "Nature",
    hosts: ["www.nature.com", "nature.com"],
    kinds: ["paper", "notice"],
    paths: ["/articles/s", "/articles/nature"],
    deny_paths: [],
    reaction_paths: ["/articles/d41586-"],
    type_field: "citation_article_type",
    types: { paper: ["Article", "Review"], notice: ["Retraction Note", "Correction"], reaction: ["News & Views"] },
  });
  /** A publisher whose pages show no type: judged by the URL test alone. */
  const untyped = (): any => ({ ...publisher(), id: "springer", kinds: ["paper", "notice"], reaction_paths: [], type_field: null, types: {} });

  it("takes a typed publisher and an untyped one, with the keys in the order of SPEC section 4.11", () => {
    expectValid(Publisher, publisher());
    expectValid(Publisher, untyped());
    expect(Object.keys(Publisher.shape)).toEqual(["id", "name", "hosts", "kinds", "paths", "deny_paths", "reaction_paths", "type_field", "types"]);
    expectStrictAndComplete(Publisher, publisher());
    expectMutationFails(Publisher, publisher(), (p) => { delete p.types; }, "types");
  });

  it("takes bare hosts, path prefixes and kinds, each list without a repeat", () => {
    for (const bad of ["Nature.com", "https://nature.com", "nature.com/x", "nature", ""]) expectMutationFails(Publisher, publisher(), (p) => { p.hosts[0] = bad; }, "hosts.0");
    expectMutationFails(Publisher, publisher(), (p) => { p.hosts = []; }, "hosts");
    expectMutationFails(Publisher, publisher(), (p) => { p.hosts[1] = p.hosts[0]; }, "hosts.1", "already used at index 0");
    for (const bad of ["articles", "/a b", "/a?b", ""]) {
      expectMutationFails(Publisher, publisher(), (p) => { p.paths[0] = bad; }, "paths.0");
      expectMutationFails(Publisher, publisher(), (p) => { p.deny_paths = [bad]; }, "deny_paths.0");
      expectMutationFails(Publisher, publisher(), (p) => { p.reaction_paths = [bad]; }, "reaction_paths.0");
    }
    expectMutationFails(Publisher, publisher(), (p) => { p.paths = []; }, "paths");
    expectMutationFails(Publisher, publisher(), (p) => { p.paths[1] = p.paths[0]; }, "paths.1", "already used at index 0");
    expectMutationFails(Publisher, publisher(), (p) => { p.deny_paths = ["/x", "/x"]; }, "deny_paths.1");
    expectMutationFails(Publisher, publisher(), (p) => { p.reaction_paths = ["/x", "/x"]; }, "reaction_paths.1");
    expectValid(Publisher, { ...publisher(), paths: ["/"], deny_paths: ["/content/article/"] });
    expectMutationFails(Publisher, publisher(), (p) => { p.kinds = []; }, "kinds");
    expectMutationFails(Publisher, publisher(), (p) => { p.kinds = ["paper", "paper"]; }, "kinds.1", "already used at index 0");
    expectMutationFails(Publisher, publisher(), (p) => { p.kinds[0] = "article"; }, "kinds.0");
    expectMutationFails(Publisher, publisher(), (p) => { p.id = "Nature"; }, "id");
    expectMutationFails(Publisher, publisher(), (p) => { p.name = ""; }, "name");
  });

  it("takes a type_field that is a meta tag's name or a CSS selector, and null when a page shows no type", () => {
    for (const ok of ["citation_article_type", "dc.type", "og:type", ".article-type", "#type", "div.type", "meta[name=x]", "span > b"]) {
      expectValid(Publisher, { ...publisher(), type_field: ok });
    }
    for (const ok of [".a", "#x", ".a.b", "a b"]) expectValid(Publisher, { ...publisher(), type_field: ok });
    expect(untyped().type_field).toBeNull();
    expectValid(Publisher, untyped());
    for (const bad of ["", "1type", "type!", "a b ", " .x", "-x", ".", "#"]) {
      expectMutationFails(Publisher, publisher(), (p) => { p.type_field = bad; }, "type_field");
    }
    expectMutationFails(Publisher, publisher(), (p) => { p.type_field = 5; }, "type_field");
  });

  it("with no type_field lists no types, no reaction kind and no reaction_paths: the URL test alone judges it", () => {
    expectMutationFails(Publisher, untyped(), (p) => { p.types = { paper: ["Article"] }; }, "types", "judged by the URL test alone");
    expectMutationFails(Publisher, untyped(), (p) => { p.kinds = ["paper", "reaction"]; }, "kinds", "does not list reaction");
    expectMutationFails(Publisher, untyped(), (p) => { p.reaction_paths = ["/news-and-views/"]; }, "reaction_paths", "no reaction_paths");
    expectValid(Publisher, { ...untyped(), kinds: ["preprint"] });
  });

  it("with a type_field lists the types of each kind its URLs can pass for, and no other kind", () => {
    expectMutationFails(Publisher, publisher(), (p) => { delete p.types.paper; }, "types", "no list for kind paper");
    expectMutationFails(Publisher, publisher(), (p) => { delete p.types.notice; }, "types", "no list for kind notice");
    expectMutationFails(Publisher, publisher(), (p) => { delete p.types.reaction; }, "types", "no list for kind reaction");
    expectMutationFails(Publisher, publisher(), (p) => { p.types.paper = []; }, "types.paper");
    expectMutationFails(Publisher, publisher(), (p) => { p.types.paper = []; }, "types", "no list for kind paper");
    // reaction_paths make reaction a kind it can pass for; without them (and without reaction in kinds) a list for reaction has no URL to serve
    expectMutationFails(Publisher, publisher(), (p) => { p.reaction_paths = []; }, "types.reaction", "cannot pass for");
    expectMutationFails(Publisher, publisher(), (p) => { p.types.preprint = ["Preprint"]; }, "types.preprint", "cannot pass for");
    const science = { ...publisher(), kinds: ["paper", "notice", "reaction"], reaction_paths: [], types: { ...publisher().types } };
    expectValid(Publisher, science);
    expectMutationFails(Publisher, science, (p) => { delete p.types.reaction; }, "types", "no list for kind reaction");
    expectMutationFails(Publisher, publisher(), (p) => { p.types.paper = ["Article", "Article"]; }, "types.paper.1", "already used at index 0");
    expectMutationFails(Publisher, publisher(), (p) => { p.types.paper = [""]; }, "types.paper.0");
    expectMutationFails(Publisher, publisher(), (p) => { p.types.unknown = ["x"]; }, "types", "Unrecognized key");
  });

  it("a type of news, editorial, feature or interview fits no kind, whatever the case", () => {
    for (const type of ["News", "editorial", "FEATURE", "Interview"]) {
      for (const kind of ["paper", "notice", "reaction"]) {
        expectMutationFails(Publisher, publisher(), (p) => { p.types[kind].push(type); }, `types.${kind}.${p0(kind)}`, "fits no kind");
      }
    }
  });

  it("a commentary type fits reaction only; a notice type fits notice only; a type fits one kind", () => {
    for (const type of ["News & Views", "News and Views", "Perspective", "Comment", "Commentary", "Preview", "Viewpoint", "PERSPECTIVE"]) {
      expectMutationFails(Publisher, publisher(), (p) => { p.types.paper.push(type); }, "types.paper.2", "commentary type");
      expectMutationFails(Publisher, publisher(), (p) => { p.types.notice.push(type); }, "types.notice.2", "commentary type");
      const ok = publisher();
      ok.types.reaction = [type];
      expectValid(Publisher, ok);
    }
    for (const type of ["Retraction", "Correction", "Erratum", "Corrigendum", "Expression of Concern", "Publisher Correction", "Retraction Note", "ERRATUM", "Editorial Expression of Concern"]) {
      expectMutationFails(Publisher, publisher(), (p) => { p.types.paper.push(type); }, "types.paper.2", "notice type");
      expectMutationFails(Publisher, publisher(), (p) => { p.types.reaction.push(type); }, "types.reaction.1", "notice type");
      const ok = publisher();
      ok.types.notice = [type];
      expectValid(Publisher, ok);
    }
    expectMutationFails(Publisher, publisher(), (p) => { p.types.notice.push("Article"); }, "types.notice.2", "also listed under kind paper");
    expectMutationFails(Publisher, publisher(), (p) => { p.types.notice.push("article"); }, "types.notice.2", "also listed under kind paper");
    expectMutationFails(Publisher, publisher(), (p) => { p.types.reaction.push("Review"); }, "types.reaction.1", "also listed under kind paper");
    expectValid(Publisher, { ...publisher(), types: { ...publisher().types, paper: ["Article", "Research Article", "Letter"] } });
  });
});

/** The index a type pushed on a list ends at: the list's length before the push. */
function p0(kind: string): number {
  return { paper: 2, notice: 2, reaction: 1 }[kind]!;
}

describe("Resolver, RegistryEntry and ReactionSource", () => {
  const doi = (): any => ({
    id: "doi", name: "DOI resolver", hosts: ["doi.org", "dx.doi.org"], kinds: ["paper", "preprint", "dataset", "registry", "notice", "reaction"], paths: ["/10."], type_field: null, refused_pubtypes: [],
  });
  const pubmed = (): any => ({
    id: "pubmed", name: "PubMed", hosts: ["pubmed.ncbi.nlm.nih.gov"], kinds: ["paper", "notice"], paths: ["/"], type_field: null, refused_pubtypes: ["News", "Editorial"],
  });

  it("Resolver takes the DOI resolver and PubMed, with the keys in file order", () => {
    expectValid(Resolver, doi());
    expectValid(Resolver, pubmed());
    expect(Object.keys(Resolver.shape)).toEqual(["id", "name", "hosts", "kinds", "paths", "type_field", "refused_pubtypes"]);
    expectStrictAndComplete(Resolver, pubmed());
  });

  it("Resolver lists reaction only on the DOI resolver: a record page never passes for a reaction", () => {
    expectMutationFails(Resolver, pubmed(), (r) => { r.kinds.push("reaction"); }, "kinds", "Only the DOI resolver");
    expectMutationFails(Resolver, pubmed(), (r) => { r.hosts = ["pmc.ncbi.nlm.nih.gov"]; r.kinds = ["reaction"]; }, "kinds");
    expectMutationFails(Resolver, pubmed(), (r) => { r.hosts = ["notdoi.org"]; r.kinds = ["reaction"]; }, "kinds");
    expectMutationFails(Resolver, pubmed(), (r) => { r.hosts = ["evil-doi.org"]; r.kinds = ["reaction"]; }, "kinds");
    for (const host of ["doi.org", "dx.doi.org", "www.doi.org"]) expectValid(Resolver, { ...pubmed(), hosts: [host], kinds: ["paper", "reaction"] });
    // every host of the entry is a DOI host: a record page listed beside doi.org would pass for reaction too
    expectValid(Resolver, { ...doi(), hosts: ["doi.org", "dx.doi.org", "www.doi.org"] });
    expectMutationFails(Resolver, doi(), (r) => { r.hosts = ["doi.org", "pubmed.ncbi.nlm.nih.gov"]; }, "kinds", "Only the DOI resolver");
    expectMutationFails(Resolver, doi(), (r) => { r.hosts = ["pubmed.ncbi.nlm.nih.gov", "doi.org"]; }, "kinds", "Only the DOI resolver");
  });

  it("Resolver takes a type_field or null, and publication types each once", () => {
    expectValid(Resolver, { ...pubmed(), type_field: "citation_pubtype" });
    expectValid(Resolver, { ...pubmed(), type_field: ".publication-type" });
    expectMutationFails(Resolver, pubmed(), (r) => { r.type_field = "1x"; }, "type_field");
    expectMutationFails(Resolver, pubmed(), (r) => { r.refused_pubtypes = ["News", "News"]; }, "refused_pubtypes.1", "already used at index 0");
    expectMutationFails(Resolver, pubmed(), (r) => { r.refused_pubtypes = [""]; }, "refused_pubtypes.0");
    expectMutationFails(Resolver, pubmed(), (r) => { r.paths = []; }, "paths");
    expectMutationFails(Resolver, pubmed(), (r) => { r.kinds = []; }, "kinds");
  });

  it("RegistryEntry and ReactionSource take an id, a name, hosts and paths (and kinds, for a registry)", () => {
    const registry = { id: "zenodo", name: "Zenodo", hosts: ["zenodo.org"], kinds: ["dataset"], paths: ["/records/"] };
    const reaction = { id: "smc", name: "Science Media Centre expert reactions", hosts: ["sciencemediacentre.org"], paths: ["/expert-reaction-"] };
    expectValid(RegistryEntry, registry);
    expectValid(ReactionSource, reaction);
    expect(Object.keys(RegistryEntry.shape)).toEqual(["id", "name", "hosts", "kinds", "paths"]);
    expect(Object.keys(ReactionSource.shape)).toEqual(["id", "name", "hosts", "paths"]);
    expectStrictAndComplete(RegistryEntry, registry);
    expectStrictAndComplete(ReactionSource, reaction);
    expectMutationFails(RegistryEntry, registry, (r) => { r.kinds = []; }, "kinds");
    expectMutationFails(RegistryEntry, registry, (r) => { r.paths = []; }, "paths");
    expectMutationFails(RegistryEntry, registry, (r) => { r.hosts = []; }, "hosts");
    expectMutationFails(RegistryEntry, registry, (r) => { r.paths = ["records"]; }, "paths.0");
    expectMutationFails(ReactionSource, reaction, (r) => { r.hosts = ["https://sciencemediacentre.org"]; }, "hosts.0");
    expectMutationFails(ReactionSource, reaction, (r) => { r.paths = []; }, "paths");
    expectMutationFails(ReactionSource, reaction, (r) => { r.kind = "reaction"; }, "", "Unrecognized key");
  });
});

describe("SourceTiersFile", () => {
  const tiers = (): any => raw("sourceTiers");

  it("takes the seed, with the keys in file order", () => {
    expect(Object.keys(SourceTiersFile.shape)).toEqual([
      "schema_version", "version", "publishers", "resolvers", "deny_doi_prefixes", "registries", "statement_suffixes", "reaction_sources", "press_hosts", "figure_hosts",
    ]);
    expectStrictAndComplete(SourceTiersFile, tiers());
  });

  it("keeps each id unique within its own list, and an id may stand in two lists", () => {
    for (const key of ["publishers", "resolvers", "registries", "reaction_sources"]) {
      expectMutationFails(SourceTiersFile, tiers(), (t) => { t[key][1].id = t[key][0].id; }, `${key}.1.id`, "already used at index 0");
    }
    const twice = tiers();
    twice.registries[0].id = twice.publishers[0].id;
    expectValid(SourceTiersFile, twice);
  });

  it("needs publishers, resolvers, statement entries, press hosts and figure hosts; registries, reaction sources and DOI prefixes may be empty", () => {
    for (const key of ["publishers", "resolvers", "statement_suffixes", "press_hosts", "figure_hosts"]) expectMutationFails(SourceTiersFile, tiers(), (t) => { t[key] = []; }, key);
    for (const key of ["registries", "reaction_sources", "deny_doi_prefixes"]) {
      const empty = tiers();
      empty[key] = [];
      expectValid(SourceTiersFile, empty);
    }
  });

  it("takes DOI prefixes in lower case from the start of a DOI, and never one that would deny Nature's News & Views", () => {
    for (const ok of ["10.1021/cen-", "10.1063/pt.", "10.1038/scientificamerican", "10.12345/x", "10.123456789/x", "10.1038/d41586-x", "10.1038/s"]) {
      const t = tiers();
      t.deny_doi_prefixes = [ok];
      expectValid(SourceTiersFile, t);
    }
    for (const bad of ["10.1021/CEN-", "10.123/x", "10.1234567890/x", "cen-", "doi:10.1021/cen-", "", "10.1021", "10.1021/ x"]) expectMutationFails(SourceTiersFile, tiers(), (t) => { t.deny_doi_prefixes = [bad]; }, "deny_doi_prefixes.0");
    for (const bad of ["10.1038/", "10.1038/d", "10.1038/d41586", "10.1038/d41586-"]) {
      expectMutationFails(SourceTiersFile, tiers(), (t) => { t.deny_doi_prefixes = [bad]; }, "deny_doi_prefixes.0", "would deny Nature's News & Views");
    }
    expectMutationFails(SourceTiersFile, tiers(), (t) => { t.deny_doi_prefixes = ["10.1021/cen-", "10.1021/cen-"]; }, "deny_doi_prefixes.1", "already used at index 0");
  });

  it("takes statement entries in three forms (.suffix, host, host with a path prefix), lower case, each once", () => {
    for (const ok of [".edu", ".ac.uk", ".e", "mpg.de", "sinica.edu.tw", "cell.com/newsroom", "eurekalert.org/news-releases/", "a.b/c", "x.org/"]) {
      const t = tiers();
      t.statement_suffixes = [ok];
      expectValid(SourceTiersFile, t);
    }
    for (const bad of [".EDU", "EDU", "edu", "mpg", ".", "..edu", ".edu.", "http://cell.com/x", "cell.com/new sroom", "cell.com/newsroom?x", "Cell.com/newsroom", "/newsroom", "", ".a b", "cell.com:80/x"]) {
      expectMutationFails(SourceTiersFile, tiers(), (t) => { t.statement_suffixes = [bad]; }, "statement_suffixes.0");
    }
    expectMutationFails(SourceTiersFile, tiers(), (t) => { t.statement_suffixes = [".edu", ".edu"]; }, "statement_suffixes.1", "already used at index 0");
  });

  it("says what a statement entry may be: a suffix and a host in lower case, a path from / on with no space, ? or #, and not that the whole entry is lower case, for a path may hold capitals", () => {
    const message = "Expected a suffix (.edu), a host (mpg.de) or a host with a path prefix (cell.com/newsroom): a suffix and a host are lower case, and a path starts with / and has no space, ? or #";
    for (const bad of [".EDU", "Cell.com/newsroom", "cell.com/new sroom", "cell.com/newsroom?x", "cell.com/newsroom#top"]) {
      const t = tiers();
      t.statement_suffixes = [bad];
      expect(issuesOf(SourceTiersFile, t).find((i) => i.path === "statement_suffixes.0")?.message, bad).toBe(message);
    }
    for (const ok of ["cell.com/NewsRoom", "cell.com/News-Room/2026", "eurekalert.org/News-Releases/"]) {
      const t = tiers();
      t.statement_suffixes = [ok];
      expectValid(SourceTiersFile, t);
    }
  });

  it("takes press hosts and figure hosts as bare hosts, each once", () => {
    for (const key of ["press_hosts", "figure_hosts"]) {
      for (const bad of ["Phys.org", "https://phys.org", "phys.org/news", "phys", "", ".phys.org"]) expectMutationFails(SourceTiersFile, tiers(), (t) => { t[key] = [bad]; }, `${key}.0`);
      expectMutationFails(SourceTiersFile, tiers(), (t) => { t[key] = ["phys.org", "phys.org"]; }, `${key}.1`, "already used at index 0");
    }
  });
});

describe("LabsFile and CheckersFile", () => {
  const labs = (): any => raw("labs");
  const checkers = (): any => raw("checkers");

  it("LabsFile takes the seed, with the keys in file order, and each id once", () => {
    expectStrictAndComplete(LabsFile, labs());
    expect(Object.keys(LabsFile.shape)).toEqual(["schema_version", "labs"]);
    expect(Object.keys(LabsFile.shape.labs.element.shape)).toEqual(["id", "name", "hosts", "paths"]);
    expectMutationFails(LabsFile, labs(), (f) => { f.labs[1].id = f.labs[0].id; }, "labs.1.id", "already used at index 0");
    expectMutationFails(LabsFile, labs(), (f) => { f.labs = []; }, "labs");
    expectMutationFails(LabsFile, labs(), (f) => { f.labs[0].hosts = []; }, "labs.0.hosts");
    expectMutationFails(LabsFile, labs(), (f) => { f.labs[0].paths = []; }, "labs.0.paths");
    expectMutationFails(LabsFile, labs(), (f) => { f.labs[0].hosts = ["DeepMind.google"]; }, "labs.0.hosts.0");
    expectMutationFails(LabsFile, labs(), (f) => { f.version = 1; }, "", "Unrecognized key");
  });

  it("CheckersFile takes the seed, with the keys in file order, and each id once", () => {
    expectStrictAndComplete(CheckersFile, checkers());
    expect(Object.keys(CheckersFile.shape)).toEqual(["schema_version", "checkers"]);
    expect(Object.keys(CheckersFile.shape.checkers.element.shape)).toEqual(["id", "name", "hosts", "paths", "rungs"]);
    expectMutationFails(CheckersFile, checkers(), (f) => { f.checkers[1].id = f.checkers[0].id; }, "checkers.1.id", "already used at index 0");
    expectMutationFails(CheckersFile, checkers(), (f) => { f.checkers = []; }, "checkers");
    expectMutationFails(CheckersFile, checkers(), (f) => { f.checkers[0].hosts = []; }, "checkers.0.hosts");
    expectMutationFails(CheckersFile, checkers(), (f) => { f.checkers[0].paths = []; }, "checkers.0.paths");
  });

  it("CheckersFile gives a checker only the counted rungs, at least one, each once", () => {
    expect([...COUNTED_RUNGS]).toEqual(["checked", "confirmed", "applied"]);
    for (const rungs of [["checked"], ["confirmed"], ["applied"], ["checked", "confirmed"], ["checked", "confirmed", "applied"]]) {
      const f = checkers();
      f.checkers[0].rungs = rungs;
      expectValid(CheckersFile, f);
    }
    for (const [bad, where] of [
      [[], ""], ["checked", ""], [["claimed"], ".0"], [["preprint"], ".0"], [["disputed"], ".0"], [["retracted"], ".0"], [["Checked"], ".0"], [["checked", "claimed"], ".1"],
    ] as const) {
      expectMutationFails(CheckersFile, checkers(), (f) => { f.checkers[0].rungs = bad; }, `checkers.0.rungs${where}`);
    }
    expectMutationFails(CheckersFile, checkers(), (f) => { f.checkers[0].rungs = ["checked", "checked"]; }, "checkers.0.rungs.1", "already used at index 0");
  });
});

describe("AiDrugsFile", () => {
  const drug = (): any => ({
    id: "sample-drug",
    name: "Sample drug",
    developer: "Sample Pharma",
    ai_basis: "The developer says an AI system proposed the molecule.",
    source_url: "https://example.org/sample-drug",
    trials: ["NCT05938920"],
    approved: { regulator: "fda", date: "2026-01-15", source_url: "https://www.fda.gov/drugs/sample" },
  });
  const file = (): any => ({ schema_version: 1, version: 1, drugs: [drug()] });

  it("takes an empty list and a list of drugs, with the keys in the order of SPEC section 4.11", () => {
    expectValid(AiDrugsFile, SEED.aiDrugs);
    expectValid(AiDrugsFile, file());
    expect(Object.keys(AiDrugsFile.shape)).toEqual(["schema_version", "version", "drugs"]);
    expect(Object.keys(AiDrugsFile.shape.drugs.element.shape)).toEqual(["id", "name", "developer", "ai_basis", "source_url", "trials", "approved"]);
    expectStrictAndComplete(AiDrugsFile, file());
    expectStrictAndComplete(AiDrugsFile, { ...file(), drugs: [{ ...drug(), approved: null }] });
  });

  it("gives each drug an id once, and needs its name, developer, the AI basis and an https source", () => {
    expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs.push(drug()); }, "drugs.1.id", "already used at index 0");
    for (const key of ["name", "developer", "ai_basis"]) expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0][key] = ""; }, `drugs.0.${key}`);
    for (const bad of ["http://example.org/x", "example.org/x", "", "not a url"]) expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].source_url = bad; }, "drugs.0.source_url");
    expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].id = "Sample Drug"; }, "drugs.0.id");
  });

  it("takes trials as NCT numbers, each once, and none at all", () => {
    expectValid(AiDrugsFile, { ...file(), drugs: [{ ...drug(), trials: [] }] });
    expectValid(AiDrugsFile, { ...file(), drugs: [{ ...drug(), trials: ["NCT05938920", "NCT00000001"] }] });
    for (const bad of ["NCT1234567", "NCT123456789", "nct05938920", "05938920", "NCT0593892a", ""]) expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].trials = [bad]; }, "drugs.0.trials.0");
    expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].trials = ["NCT05938920", "NCT05938920"]; }, "drugs.0.trials.1", "already used at index 0");
  });

  it("takes the approval as null or a regulator, a real date and an https record", () => {
    expectValid(AiDrugsFile, { ...file(), drugs: [{ ...drug(), approved: null }] });
    for (const bad of ["Fda", "", "f da"]) expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].approved.regulator = bad; }, "drugs.0.approved.regulator");
    for (const bad of ["2026-02-30", "15/01/2026", "2026-1-15", "", null]) expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].approved.date = bad; }, "drugs.0.approved.date");
    for (const bad of ["http://www.fda.gov/x", "", "fda.gov"]) expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].approved.source_url = bad; }, "drugs.0.approved.source_url");
    expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].approved = {}; }, "drugs.0.approved.regulator");
    expectMutationFails(AiDrugsFile, file(), (f) => { f.drugs[0].approved.extra = 1; }, "drugs.0.approved", "Unrecognized key");
    expectMutationFails(AiDrugsFile, file(), (f) => { f.version = 0; }, "version");
  });
});

describe("CountersFile", () => {
  const counters = (): any => raw("counters");
  const at = (id: string): number => (COUNTER_IDS as readonly string[]).indexOf(id);
  const figure = (as_of: string): any => ({ as_of, total: 756, source_url: "https://www.wycliffe.net/resources/statistics/" });

  it("takes the seed, with the keys in the order of SPEC section 4.11", () => {
    expectStrictAndComplete(CountersFile, counters());
    expect(Object.keys(CountersFile.shape)).toEqual(["schema_version", "version", "counters"]);
    expect(Object.keys(CountersFile.shape.counters.element.shape)).toEqual(["id", "label", "unit", "kind", "source", "value", "as_of", "source_url", "figures"]);
    expect([...COUNTER_IDS]).toEqual(["erdos_ai", "mathlib_theorems", "ai_drugs", "pdb_structures", "ai_retractions", "full_bibles", "ancient_texts_ai"]);
  });

  it("lists exactly the seven counters of section 5.7, in order", () => {
    expectMutationFails(CountersFile, counters(), (f) => { f.counters.reverse(); }, "counters", "in this order");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters.pop(); }, "counters");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters.push(structuredClone(f.counters[0])); }, "counters");
    expectMutationFails(CountersFile, counters(), (f) => { [f.counters[0], f.counters[1]] = [f.counters[1], f.counters[0]]; }, "counters");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[0].id = "other_counter"; }, "counters");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters = []; }, "counters");
    for (const bad of ["Erdos", "erdos-ai", "1erdos", ""]) expectMutationFails(CountersFile, counters(), (f) => { f.counters[0].id = bad; }, "counters.0.id");
  });

  it("gives each counter the kinds its id allows: erdos_ai api or manual, full_bibles manual, ancient_texts_ai ledger, the rest api", () => {
    const wrong: [string, string][] = [
      ["mathlib_theorems", "manual"], ["mathlib_theorems", "ledger"], ["ai_drugs", "manual"], ["ai_drugs", "ledger"], ["pdb_structures", "manual"], ["pdb_structures", "ledger"],
      ["ai_retractions", "manual"], ["ai_retractions", "ledger"], ["full_bibles", "api"], ["full_bibles", "ledger"], ["ancient_texts_ai", "api"], ["ancient_texts_ai", "manual"],
      ["erdos_ai", "ledger"],
    ];
    for (const [id, kind] of wrong) expectMutationFails(CountersFile, counters(), (f) => { f.counters[at(id)].kind = kind; }, `counters.${at(id)}.kind`, "(§5.7)");
    // seven ids by three kinds: each pair is in the list above or is accepted
    for (const id of COUNTER_IDS) {
      for (const kind of ["api", "manual", "ledger"]) {
        if (wrong.some(([w, k]) => w === id && k === kind)) continue;
        const ok = counters();
        ok.counters[at(id)].kind = kind;
        expectValid(CountersFile, ok);
      }
    }
    const manual = counters();
    manual.counters[0].kind = "manual";
    expectValid(CountersFile, manual);
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[0].kind = "fetch"; }, "counters.0.kind");
  });

  it("lets only a manual counter other than full_bibles hold a value and its date, together", () => {
    const manual = counters();
    manual.counters[0].kind = "manual";
    manual.counters[0].value = 12;
    manual.counters[0].as_of = "2026-11-20";
    expectValid(CountersFile, manual);
    manual.counters[0].value = 0;
    expectValid(CountersFile, manual);
    expectMutationFails(CountersFile, manual, (f) => { f.counters[0].as_of = null; }, "counters.0.as_of", "come together");
    expectMutationFails(CountersFile, manual, (f) => { f.counters[0].value = null; }, "counters.0.value", "come together");
    expectMutationFails(CountersFile, manual, (f) => { f.counters[0].value = -1; }, "counters.0.value");
    expectMutationFails(CountersFile, manual, (f) => { f.counters[0].value = 1.5; }, "counters.0.value");
    expectMutationFails(CountersFile, manual, (f) => { f.counters[0].as_of = "2026-02-30"; }, "counters.0.as_of");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[0].value = 12; f.counters[0].as_of = "2026-11-20"; }, "counters.0.value", "only a manual counter");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[0].as_of = "2026-11-20"; }, "counters.0.as_of", "only a manual counter");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[at("full_bibles")].value = 5; f.counters[at("full_bibles")].as_of = "2026-11-20"; }, `counters.${at("full_bibles")}.value`, "only a manual counter");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[at("ancient_texts_ai")].value = 5; }, `counters.${at("ancient_texts_ai")}.value`);
  });

  it("holds full_bibles' annual figures oldest first, one for each date, and no figures on any other counter", () => {
    const i = at("full_bibles");
    const withFigures = (...dates: string[]) => {
      const f = counters();
      f.counters[i].figures = dates.map(figure);
      return f;
    };
    expectValid(CountersFile, withFigures());
    expectValid(CountersFile, withFigures("2024-12-31"));
    expectValid(CountersFile, withFigures("2023-12-31", "2024-12-31"));
    expectValid(CountersFile, withFigures("2023-12-31", "2024-12-31", "2025-12-31"));
    // a figure a year: the list is not capped
    expectValid(CountersFile, withFigures("2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31", "2026-12-31"));
    expectIssue(CountersFile, withFigures("2024-12-31", "2024-12-31"), `counters.${i}.figures.1.as_of`, "one figure for each date");
    expectIssue(CountersFile, withFigures("2024-12-31", "2023-12-31"), `counters.${i}.figures.1.as_of`, "does not come after");
    expectIssue(CountersFile, withFigures("2023-12-31", "2025-12-31", "2024-12-31"), `counters.${i}.figures.2.as_of`);
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[0].figures = [figure("2024-12-31")]; }, "counters.0.figures", "full_bibles only");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[at("ancient_texts_ai")].figures = [figure("2024-12-31")]; }, `counters.${at("ancient_texts_ai")}.figures`);
  });

  it("holds each figure to a real date, a whole total and an https source, and no other key", () => {
    const i = at("full_bibles");
    const one = (change: (fig: any) => void) => (f: any) => { f.counters[i].figures = [figure("2024-12-31")]; change(f.counters[i].figures[0]); };
    expectMutationFails(CountersFile, counters(), one((x) => { x.as_of = "2024-02-30"; }), `counters.${i}.figures.0.as_of`);
    expectMutationFails(CountersFile, counters(), one((x) => { x.total = -1; }), `counters.${i}.figures.0.total`);
    expectMutationFails(CountersFile, counters(), one((x) => { x.total = 756.5; }), `counters.${i}.figures.0.total`);
    expectMutationFails(CountersFile, counters(), one((x) => { x.source_url = "http://www.wycliffe.net/x"; }), `counters.${i}.figures.0.source_url`);
    expectMutationFails(CountersFile, counters(), one((x) => { delete x.total; }), `counters.${i}.figures.0.total`);
    expectMutationFails(CountersFile, counters(), one((x) => { x.note = "x"; }), `counters.${i}.figures.0`, "Unrecognized key");
    const zero = counters();
    zero.counters[i].figures = [{ ...figure("2024-12-31"), total: 0 }];
    expectValid(CountersFile, zero);
  });

  it("needs a label and a unit in both languages, a source in words and an https source_url", () => {
    for (const key of ["label", "unit"]) {
      for (const lang of ["en", "zh"]) {
        expectMutationFails(CountersFile, counters(), (f) => { f.counters[0][key][lang] = ""; }, `counters.0.${key}.${lang}`);
        expectMutationFails(CountersFile, counters(), (f) => { f.counters[0][key][lang] = null; }, `counters.0.${key}.${lang}`);
        expectMutationFails(CountersFile, counters(), (f) => { f.counters[0][key][lang] = ` ${f.counters[0][key][lang]}`; }, `counters.0.${key}.${lang}`, "no space");
      }
    }
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[0].source = ""; }, "counters.0.source");
    expectMutationFails(CountersFile, counters(), (f) => { f.counters[0].source_url = "http://www.erdosproblems.com/"; }, "counters.0.source_url");
    expectMutationFails(CountersFile, counters(), (f) => { f.version = 0; }, "version");
  });
});

describe("MarkersFile and StandingStoriesFile", () => {
  const markers = (): any => raw("markers");
  const marker = (date: string, en: string): any => ({ date, label: { en, zh: `標記 ${en}` }, source_url: "https://example.org/event" });
  const story = (): any => ({ id: "sample-story", finding_ids: ["bio-2026-0001", "bio-2026-0002"], rule: "Returns only when a trial reports new results." });
  const stories = (): any => ({ schema_version: 1, stories: [story()] });

  it("MarkersFile takes the seed and an empty list, with the keys in the order of SPEC section 4.11", () => {
    expectStrictAndComplete(MarkersFile, markers());
    expectValid(MarkersFile, { schema_version: 1, markers: [] });
    expect(Object.keys(MarkersFile.shape)).toEqual(["schema_version", "markers"]);
    expect(Object.keys(MarkersFile.shape.markers.element.shape)).toEqual(["date", "label", "source_url"]);
  });

  it("MarkersFile runs oldest first, and a date may repeat with another label", () => {
    expectValid(MarkersFile, { schema_version: 1, markers: [marker("2024-01-01", "A"), marker("2024-01-01", "B"), marker("2024-06-01", "C")] });
    expectMutationFails(MarkersFile, markers(), (f) => { f.markers.reverse(); }, "markers.1.date", "oldest first");
    expectMutationFails(MarkersFile, markers(), (f) => { [f.markers[1], f.markers[2]] = [f.markers[2], f.markers[1]]; }, "markers.2.date", "before");
    expectIssue(MarkersFile, { schema_version: 1, markers: [marker("2024-06-01", "A"), marker("2024-01-01", "B")] }, "markers.1.date", "2024-01-01 comes before 2024-06-01");
    expectMutationFails(MarkersFile, { schema_version: 1, markers: [marker("2024-01-01", "A"), marker("2024-06-01", "B")] }, (f) => { f.markers[1].date = "2023-12-31"; }, "markers.1.date", "oldest first");
  });

  it("MarkersFile gives each event once: the same date and English label may not return", () => {
    expectIssue(MarkersFile, { schema_version: 1, markers: [marker("2024-01-01", "A"), marker("2024-01-01", "A")] }, "markers.1.label.en", "already used at index 0");
    expectMutationFails(MarkersFile, { schema_version: 1, markers: [marker("2024-01-01", "A"), marker("2024-01-01", "B")] }, (f) => { f.markers[1].label.en = "A"; }, "markers.1.label.en", "Marker \"A\" on 2024-01-01");
    expectValid(MarkersFile, { schema_version: 1, markers: [marker("2024-01-01", "A"), marker("2024-01-02", "A")] });
    expectValid(MarkersFile, { schema_version: 1, markers: [marker("2024-01-01", "A"), marker("2024-01-01", "B")] });
  });

  it("MarkersFile needs a real date, a label in both languages and an https source", () => {
    for (const bad of ["2024-02-30", "2024-1-1", "", null]) expectMutationFails(MarkersFile, markers(), (f) => { f.markers[0].date = bad; }, "markers.0.date");
    for (const lang of ["en", "zh"]) {
      expectMutationFails(MarkersFile, markers(), (f) => { f.markers[0].label[lang] = ""; }, `markers.0.label.${lang}`);
      expectMutationFails(MarkersFile, markers(), (f) => { f.markers[0].label[lang] = null; }, `markers.0.label.${lang}`);
    }
    for (const bad of ["http://example.org/x", "", "example.org"]) expectMutationFails(MarkersFile, markers(), (f) => { f.markers[0].source_url = bad; }, "markers.0.source_url");
  });

  it("StandingStoriesFile takes an empty list and a story, with the keys in order", () => {
    expectValid(StandingStoriesFile, SEED.standingStories);
    expectValid(StandingStoriesFile, { schema_version: 1, stories: [] });
    expectStrictAndComplete(StandingStoriesFile, stories());
    expect(Object.keys(StandingStoriesFile.shape)).toEqual(["schema_version", "stories"]);
    expect(Object.keys(StandingStoriesFile.shape.stories.element.shape)).toEqual(["id", "finding_ids", "rule"]);
  });

  it("StandingStoriesFile gives each story an id once, finding ids of the format of section 4.3, each once, and a rule", () => {
    expectMutationFails(StandingStoriesFile, stories(), (f) => { f.stories.push(story()); }, "stories.1.id", "already used at index 0");
    expectValid(StandingStoriesFile, { schema_version: 1, stories: [story(), { ...story(), id: "other-story" }] });
    for (const ok of ["math-2026-0142", "phys-2025-0001", "chem-2024-1234", "bio-2026-0001", "earth-2026-0001", "soc-2026-0001", "hum-2026-0001"]) {
      const f = stories();
      f.stories[0].finding_ids = [ok];
      expectValid(StandingStoriesFile, f);
    }
    for (const bad of ["math-26-0142", "MATH-2026-0142", "astro-2026-0142", "math-2026-142", "math-2026-01420", "", "new-1"]) {
      expectMutationFails(StandingStoriesFile, stories(), (f) => { f.stories[0].finding_ids = [bad]; }, "stories.0.finding_ids.0");
    }
    expectMutationFails(StandingStoriesFile, stories(), (f) => { f.stories[0].finding_ids = []; }, "stories.0.finding_ids");
    expectMutationFails(StandingStoriesFile, stories(), (f) => { f.stories[0].finding_ids = ["bio-2026-0001", "bio-2026-0001"]; }, "stories.0.finding_ids.1", "already used at index 0");
    expectMutationFails(StandingStoriesFile, stories(), (f) => { f.stories[0].rule = ""; }, "stories.0.rule");
    expectMutationFails(StandingStoriesFile, stories(), (f) => { f.stories[0].id = "Sample Story"; }, "stories.0.id");
  });
});

describe("TermsZhFile", () => {
  const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
  const terms = (): any => ({
    schema_version: 1,
    version: 1,
    fixed: [
      { en: "algorithm", zh: "演算法", fields: [], except: [] },
      { en: "plasma", zh: "電漿", fields: ["physics", "chemistry", "earth"], except: ["blood plasma", "plasma cell"] },
    ],
    avoid: [
      { term: "算法", taiwan: "演算法", allow_in: ["演算法", "運算法則"] },
      { term: "硅", taiwan: "矽", allow_in: [] },
    ],
    japanese_only: "図広",
    simplified_only: "个这",
  });

  it("takes a small file, with the keys in the order the file prints them (the character lists last)", () => {
    expectValid(TermsZhFile, terms());
    expect(Object.keys(TermsZhFile.shape)).toEqual(["schema_version", "version", "fixed", "avoid", "japanese_only", "simplified_only"]);
    expect(Object.keys(TermsZhFile.shape.fixed.element.shape)).toEqual(["en", "zh", "fields", "except"]);
    expect(Object.keys(TermsZhFile.shape.avoid.element.shape)).toEqual(["term", "taiwan", "allow_in"]);
    expectStrictAndComplete(TermsZhFile, terms());
    expect(Object.keys(TermsZhFile.parse(Object.fromEntries(Object.entries(terms()).reverse())))).toEqual(Object.keys(TermsZhFile.shape));
  });

  it("needs a fixed entry and an avoid entry, and a version of 1 or more", () => {
    expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed = []; }, "fixed");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid = []; }, "avoid");
    for (const bad of [0, 1.5, "1", null]) expectMutationFails(TermsZhFile, terms(), (f) => { f.version = bad; }, "version");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.schema_version = 2; }, "schema_version");
  });

  it("gives each fixed English once, whatever its case, spacing or hyphens", () => {
    for (const en of ["algorithm", "Algorithm", "ALGORITHM"]) {
      expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[1].en = en; f.fixed[1].except = []; }, "fixed.1.en", "already used at index 0");
    }
    const hyphen = terms();
    hyphen.fixed = [{ en: "machine learning", zh: "機器學習", fields: [], except: [] }, { en: "Machine-Learning", zh: "機器學習", fields: [], except: [] }];
    expectIssue(TermsZhFile, hyphen, "fixed.1.en", "already used at index 0");
    hyphen.fixed[1].en = "Machine  Learning";
    expectIssue(TermsZhFile, hyphen, "fixed.1.en", "already used at index 0");
    hyphen.fixed[1].en = "deep learning";
    expectValid(TermsZhFile, hyphen);
  });

  it("holds each except phrase to the entry's English as whole words (a regular plural counts), in any case", () => {
    expectValid(TermsZhFile, terms());
    expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[1].except = ["blood cell"]; }, "fixed.1.except.0", "does not hold");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[1].except = ["blood plasma", "plasmatic cell"]; }, "fixed.1.except.1", "does not hold");
    expectValid(TermsZhFile, { ...terms(), fixed: [terms().fixed[0], { ...terms().fixed[1], except: ["blood plasma", "plasmas cell and plasmatic"] }] });
    expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[1].except = ["superplasma"]; }, "fixed.1.except.0");
    for (const phrase of ["Blood Plasma", "blood plasmas", "blood-plasma", "plasma"]) {
      const f = terms();
      f.fixed[1].except = [phrase];
      expectValid(TermsZhFile, f);
    }
    const y = terms();
    y.fixed[0] = { en: "battery", zh: "電池", fields: [], except: ["test batteries"] };
    expectValid(TermsZhFile, y);
    expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[1].except = ["blood plasma", "blood plasma"]; }, "fixed.1.except.1", "already used at index 0");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[1].except = [""]; }, "fixed.1.except.0");
  });

  it("takes fields as known field ids, each once, or none", () => {
    for (const [bad, where] of [[["astronomy"], ".0"], [["physics", "physics"], ".1"], [["Physics"], ".0"], ["physics", ""], [null, ""]] as const) {
      expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[1].fields = bad; }, `fixed.1.fields${where}`);
    }
    for (const f of FIELDS) {
      const t = terms();
      t.fixed[0].fields = [f];
      expectValid(TermsZhFile, t);
    }
  });

  it("keeps simplified-only and Japanese-only characters out of fixed zh, avoid taiwan and allow_in", () => {
    expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[0].zh = "演算法个"; }, "fixed.0.zh", "个");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.fixed[0].zh = "演算図"; }, "fixed.0.zh", "図");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].taiwan = "演这法"; }, "avoid.0.taiwan", "这");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].taiwan = "演広法"; }, "avoid.0.taiwan", "広");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].allow_in = ["演算法个"]; }, "avoid.0.allow_in.0", "个");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].allow_in = ["算法広"]; }, "avoid.0.allow_in.0", "広");
    // two bad characters are named, each once
    const two = terms();
    two.fixed[0].zh = "个这个";
    expectIssue(TermsZhFile, two, "fixed.0.zh", "zh holds 个 这, which Taiwan does not write");
    two.avoid[0].taiwan = "这个这";
    expectIssue(TermsZhFile, two, "avoid.0.taiwan", "taiwan holds 这 个, which Taiwan does not write");
    two.avoid[0].allow_in = ["算法个个"];
    expectIssue(TermsZhFile, two, "avoid.0.allow_in.0", "allow_in holds 个, which Taiwan does not write");
  });

  it("reads the character lists by code point: a character outside the Basic Multilingual Plane is found in a Chinese string", () => {
    const outside = cp(0x20000);
    for (const field of ["simplified_only", "japanese_only"] as const) {
      const f = terms();
      f[field] = cp(0x20000);
      f.fixed[0].zh = `演算法${outside}`;
      f.avoid[0].taiwan = `${outside}演算法`;
      f.avoid[0].allow_in = [`算法${outside}`];
      expectIssue(TermsZhFile, f, "fixed.0.zh", `zh holds ${outside},`);
      expectIssue(TermsZhFile, f, "avoid.0.taiwan", `taiwan holds ${outside},`);
      expectIssue(TermsZhFile, f, "avoid.0.allow_in.0", `allow_in holds ${outside},`);
      // a half of the pair is no character of the list
      f.fixed[0].zh = "演算法";
      f.avoid[0].taiwan = "演算法";
      f.avoid[0].allow_in = ["算法"];
      expectValid(TermsZhFile, f);
    }
    // a character of both lists is named whole
    const both = terms();
    both.japanese_only = cp(0x20000);
    both.simplified_only = cp(0x20000);
    expectIssue(TermsZhFile, both, "japanese_only", `${outside} is in both japanese_only and simplified_only`);
  });

  it("lets an avoid term hold any character: it is the mainland form that Taiwan does not write", () => {
    const f = terms();
    f.avoid[0].term = "算个";
    f.avoid[0].allow_in = [];
    expectValid(TermsZhFile, f);
  });

  it("gives each avoid term once, and takes each allow_in string only if it holds the term, each once", () => {
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[1].term = "算法"; }, "avoid.1.term", "already used at index 0");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].allow_in = ["演算法", "雷射"]; }, "avoid.0.allow_in.1", "cannot be allowed in");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].allow_in = ["演算法", "演算法"]; }, "avoid.0.allow_in.1", "already used at index 0");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].allow_in = [""]; }, "avoid.0.allow_in.0");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].term = ""; }, "avoid.0.term");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.avoid[0].taiwan = ""; }, "avoid.0.taiwan");
    const exact = terms();
    exact.avoid[0].allow_in = ["算法"];
    expectValid(TermsZhFile, exact);
  });

  it("holds each character list as Han characters in code point order, each once, and the lists apart", () => {
    for (const field of ["japanese_only", "simplified_only"] as const) {
      const set = (chars: string) => { const f = terms(); f[field] = chars; return f; };
      for (const ok of [cp(0x4e00), cp(0x4e00, 0x4e09, 0x4e8c), cp(0x4e00, 0x20000), cp(0xf900, 0x20000), cp(0x3400, 0x4e00, 0xf900, 0x20000, 0x2a700)]) expectValid(TermsZhFile, set(ok));
      expectMutationFails(TermsZhFile, terms(), (f) => { f[field] = ""; }, field);
      for (const bad of ["a", "1", " ", "，", "あ", "ゼ", "한", `${cp(0x4e00)}a`]) expectIssue(TermsZhFile, set(bad), field, "not a Han character");
      expectIssue(TermsZhFile, set(cp(0x4e00, 0x4e00)), field, "is listed twice");
      expectIssue(TermsZhFile, set(cp(0x4e8c, 0x4e00)), field, "out of code point order");
      expectIssue(TermsZhFile, set(cp(0x20000, 0xf900)), field, "out of code point order");
      expectIssue(TermsZhFile, set(cp(0x4e00, 0x20000, 0x20000)), field, "is listed twice");
      expectIssue(TermsZhFile, set(cp(0x20000, 0x4e00)), field, "out of code point order");
      // a character is judged against the largest so far, not the one before it: 丙 (U+4E19) after 乙 (U+4E59) and 一 (U+4E00) is still out of order
      const late = issuesOf(TermsZhFile, set(cp(0x4e59, 0x4e00, 0x4e19))).filter((i) => i.path === field);
      expect(late.map((i) => i.message)).toEqual(["一 (U+4E00) is out of code point order", "丙 (U+4E19) is out of code point order"]);
      // a repeat of the previous character is a repeat, and one message
      expect(issuesOf(TermsZhFile, set(cp(0x4e00, 0x4e00))).filter((i) => i.path === field).map((i) => i.message)).toEqual(["一 (U+4E00) is listed twice"]);
      expect(issuesOf(TermsZhFile, set(cp(0x4e59, 0x4e00, 0x4e00))).filter((i) => i.path === field).map((i) => i.message)).toEqual([
        "一 (U+4E00) is out of code point order", "一 (U+4E00) is out of code point order",
      ]);
      expectMutationFails(TermsZhFile, terms(), (f) => { f[field] = 5; }, field);
    }
  });

  it("reports at most five problems of one character list, and U+ numbers a character", () => {
    const f = terms();
    f.simplified_only = "abcdefghij";
    expect(issuesOf(TermsZhFile, f).filter((i) => i.path === "simplified_only")).toHaveLength(5);
    expectIssue(TermsZhFile, { ...terms(), simplified_only: "a" }, "simplified_only", "U+0061");
    expectIssue(TermsZhFile, { ...terms(), simplified_only: cp(0x4e8c, 0x4e00) }, "simplified_only", "U+4E00");
    expectIssue(TermsZhFile, { ...terms(), simplified_only: cp(0x4e00, 0x4e00) }, "simplified_only", "U+4E00");
    expectIssue(TermsZhFile, { ...terms(), simplified_only: cp(0x4e00, 0x1f600) }, "simplified_only", "U+1F600");
  });

  it("keeps a character in one list only", () => {
    expectMutationFails(TermsZhFile, terms(), (f) => { f.japanese_only = cp(0x4e2a, 0x56f3); }, "japanese_only", "个 is in both japanese_only and simplified_only");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.simplified_only = "図"; }, "japanese_only", "図");
    expectMutationFails(TermsZhFile, terms(), (f) => { f.simplified_only = cp(0x56f3, 0x5e7f); }, "japanese_only", "図");
  });
});

describe("JargonFile", () => {
  const jargon = (): any => ({
    schema_version: 1,
    version: 1,
    words: [{ en: "lemma", fields: ["mathematics"] }, { en: "CRISPR", fields: ["biology"] }, { en: "regression", fields: [] }, { en: "crystal structure", fields: ["chemistry", "physics"] }],
  });

  it("takes a list of words, each with its fields, in the order of the file", () => {
    expectValid(JargonFile, jargon());
    expectStrictAndComplete(JargonFile, jargon());
    expect(Object.keys(JargonFile.shape)).toEqual(["schema_version", "version", "words"]);
    expect(Object.keys(JargonFile.shape.words.element.shape)).toEqual(["en", "fields"]);
    expectMutationFails(JargonFile, jargon(), (f) => { f.words = []; }, "words");
  });

  it("takes a word or phrase with single spaces and none at either end", () => {
    for (const ok of ["lemma", "protein folding", "phase 2 trial", "X-ray crystallography", "Higgs boson", "Cas9"]) {
      const f = jargon();
      f.words[0].en = ok;
      expectValid(JargonFile, f);
    }
    for (const bad of ["", " lemma", "lemma ", "crystal  structure", `crystal${String.fromCharCode(9)}structure`, `crystal${String.fromCharCode(10)}structure`, " "]) {
      expectMutationFails(JargonFile, jargon(), (f) => { f.words[0].en = bad; }, "words.0.en");
    }
  });

  it("takes fields as known field ids, each once, or none (a word of any field)", () => {
    for (const [bad, where] of [[["astronomy"], ".0"], [["physics", "physics"], ".1"], [["Physics"], ".0"], ["physics", ""], [null, ""]] as const) {
      expectMutationFails(JargonFile, jargon(), (f) => { f.words[0].fields = bad; }, `words.0.fields${where}`);
    }
    const all = jargon();
    all.words[0].fields = [...FIELDS];
    expectValid(JargonFile, all);
  });

  it("gives each word once, whatever its case, spacing or hyphens", () => {
    for (const en of ["Lemma", "LEMMA", "lemma"]) expectMutationFails(JargonFile, jargon(), (f) => { f.words[1].en = en; }, "words.1.en", "already used at index 0");
    for (const en of ["crystal-structure", "Crystal Structure", "CRYSTAL-STRUCTURE"]) {
      expectMutationFails(JargonFile, jargon(), (f) => { f.words.push({ en, fields: [] }); }, "words.4.en", "already used at index 3");
    }
  });
});

describe("HypeWordsFile", () => {
  const hype = (): any => ({
    schema_version: 1,
    version: 1,
    en: ["revolutionary", "game-changing", "breakthrough"],
    zh: ["革命性", "突破"],
    names: [{ en: "Breakthrough Prize", zh: "突破獎" }, { en: "Breakthrough Listen", zh: null }],
  });

  it("takes the words and the names, with the keys in file order", () => {
    expectValid(HypeWordsFile, hype());
    expectStrictAndComplete(HypeWordsFile, hype());
    expect(Object.keys(HypeWordsFile.shape)).toEqual(["schema_version", "version", "en", "zh", "names"]);
    expect(Object.keys(HypeWordsFile.shape.names.element.shape)).toEqual(["en", "zh"]);
    expectValid(HypeWordsFile, { ...hype(), names: [] });
  });

  it("needs at least one English and one Chinese word, each once", () => {
    for (const key of ["en", "zh"]) {
      expectMutationFails(HypeWordsFile, hype(), (f) => { f[key] = []; }, key);
      expectMutationFails(HypeWordsFile, hype(), (f) => { f[key] = [f[key][0], f[key][0]]; }, `${key}.1`, "already used at index 0");
      expectMutationFails(HypeWordsFile, hype(), (f) => { f[key][0] = ""; }, `${key}.0`);
    }
  });

  it("gives each name once, and each name must hold a hype word, so there is something to mask", () => {
    expectMutationFails(HypeWordsFile, hype(), (f) => { f.names[1].en = "Breakthrough Prize"; }, "names.1.en", "already used at index 0");
    expectMutationFails(HypeWordsFile, hype(), (f) => { f.names.push({ en: "Nobel Prize", zh: null }); }, "names.2.en", "holds no word of en");
    expectMutationFails(HypeWordsFile, hype(), (f) => { f.names[0].en = "Breakthroughs Prize"; }, "names.0.en", "holds no word of en");
    for (const en of ["Breakthrough Prize", "the breakthrough award", "BREAKTHROUGH Starshot", "Game-Changing Awards", "Game changing Awards", "revolutionary labs"]) {
      const f = hype();
      f.names = [{ en, zh: null }];
      expectValid(HypeWordsFile, f);
    }
    expectMutationFails(HypeWordsFile, hype(), (f) => { f.names[0].en = ""; }, "names.0.en");
  });

  it("holds a Chinese name's form only if it holds a Chinese hype word, and null is a name kept in English", () => {
    expectMutationFails(HypeWordsFile, hype(), (f) => { f.names[0].zh = "諾貝爾獎"; }, "names.0.zh", "holds no word of zh");
    expectMutationFails(HypeWordsFile, hype(), (f) => { f.names[1].zh = "星際"; }, "names.1.zh", "holds no word of zh");
    expectMutationFails(HypeWordsFile, hype(), (f) => { f.names[0].zh = ""; }, "names.0.zh");
    expectValid(HypeWordsFile, { ...hype(), names: [{ en: "Breakthrough Prize", zh: "革命性獎" }] });
    expectValid(HypeWordsFile, { ...hype(), names: [{ en: "Breakthrough Prize", zh: null }] });
  });
});

describe("DualUseFile", () => {
  const entry = (en: string[], zh: string[]) => ({ en, zh });
  const dual = (): any => ({
    schema_version: 1,
    version: 1,
    agents: [entry(["anthrax", "Bacillus anthracis"], ["炭疽"]), entry(["abrin"], [])],
    procedures: [entry(["synthesis route", "synthetic route"], ["合成路徑"]), entry(["gain of function"], ["功能增益"])],
    units: [entry(["mg", "milligram", "milligrams"], ["毫克", "mg"]), entry(["mL", "millilitre"], ["毫升"])],
  });

  it("takes three lists of entries, with the keys in file order", () => {
    expectValid(DualUseFile, dual());
    expectStrictAndComplete(DualUseFile, dual());
    expect(Object.keys(DualUseFile.shape)).toEqual(["schema_version", "version", "agents", "procedures", "units"]);
    expect(Object.keys(DualUseFile.shape.agents.element.shape)).toEqual(["en", "zh"]);
  });

  it("needs an entry in each list, an English form in each entry, and lets the Chinese forms be none", () => {
    for (const list of ["agents", "procedures", "units"]) {
      expectMutationFails(DualUseFile, dual(), (f) => { f[list] = []; }, list);
      expectMutationFails(DualUseFile, dual(), (f) => { f[list][0].en = []; }, `${list}.0.en`);
      expectMutationFails(DualUseFile, dual(), (f) => { f[list][0].en = [""]; }, `${list}.0.en.0`);
      expectMutationFails(DualUseFile, dual(), (f) => { f[list][0].zh = [""]; }, `${list}.0.zh.0`);
      const noZh = dual();
      noZh[list][0].zh = [];
      expectValid(DualUseFile, noZh);
    }
  });

  it("gives each form once inside an entry", () => {
    expectMutationFails(DualUseFile, dual(), (f) => { f.agents[0].en = ["anthrax", "anthrax"]; }, "agents.0.en.1", "already used at index 0");
    expectMutationFails(DualUseFile, dual(), (f) => { f.agents[0].zh = ["炭疽", "炭疽"]; }, "agents.0.zh.1", "already used at index 0");
  });

  it("gives each form once across the entries and the three lists: a form under two entries is a slip, and one that is an agent and a procedure would make a lone word a hit", () => {
    expectMutationFails(DualUseFile, dual(), (f) => { f.agents[1].en = ["anthrax"]; }, "agents.1.en.0", "English form \"anthrax\" is already listed at agents[0]");
    expectMutationFails(DualUseFile, dual(), (f) => { f.agents[1].en = ["ANTHRAX"]; }, "agents.1.en.0", "already listed at agents[0]");
    expectMutationFails(DualUseFile, dual(), (f) => { f.procedures[1].en.push("Synthesis-Route"); }, "procedures.1.en.1", "already listed at procedures[0]");
    expectMutationFails(DualUseFile, dual(), (f) => { f.procedures[1].en = ["abrin"]; }, "procedures.1.en.0", "already listed at agents[1]");
    expectMutationFails(DualUseFile, dual(), (f) => { f.units[1].en.push("milligram"); }, "units.1.en.2", "already listed at units[0]");
    expectMutationFails(DualUseFile, dual(), (f) => { f.procedures[1].zh = ["炭疽"]; }, "procedures.1.zh.0", "Chinese form \"炭疽\" is already listed at agents[0]");
    expectMutationFails(DualUseFile, dual(), (f) => { f.units[1].zh.push("毫克"); }, "units.1.zh.1", "already listed at units[0]");
    // the Latin symbols repeated in zh are Chinese forms of their own: the same symbol in two entries is a repeat, as an English form is
    expectMutationFails(DualUseFile, dual(), (f) => { f.units[1].zh.push("mg"); }, "units.1.zh.1", "already listed at units[0]");
    // an English form and a Chinese form that read alike are two forms, in one entry or in two
    expectValid(DualUseFile, { ...dual(), units: [entry(["mg"], ["mg"]), entry(["mL"], ["mL"])] });
    expectValid(DualUseFile, { ...dual(), units: [entry(["mg"], []), entry(["mL"], ["mg"])] });
    expectValid(DualUseFile, { ...dual(), units: [entry(["mL"], ["mg"]), entry(["mg"], [])] });
  });

  it("lets one entry hold a form in another case (it is one term), and reports an exact repeat once", () => {
    const one = dual();
    one.agents[0].en = ["anthrax", "Anthrax", "ANTHRAX"];
    expectValid(DualUseFile, one);
    const repeat = dual();
    repeat.agents[0].en = ["anthrax", "anthrax"];
    expect(issuesOf(DualUseFile, repeat).map((i) => i.path)).toEqual(["agents.0.en.1"]);
    repeat.agents[0].zh = ["炭疽", "炭疽"];
    expect(issuesOf(DualUseFile, repeat).map((i) => i.path)).toEqual(["agents.0.en.1", "agents.0.zh.1"]);
  });
});

// ═══ Part three: the cross-file checks and the loader ════════════════════════════════════════════

describe("the cross-file checks of validateConfig()", () => {
  /** Two drugs, the first clean, so a path in an issue names the second as drugs[1]. */
  const drugWith = (approved: unknown) => AiDrugsFile.parse({
    schema_version: 1,
    version: 1,
    drugs: [
      { id: "first-drug", name: "First drug", developer: "Sample Pharma", ai_basis: "The developer says an AI system proposed the molecule.", source_url: "https://example.org/first-drug", trials: [], approved: null },
      { id: "sample-drug", name: "Sample drug", developer: "Sample Pharma", ai_basis: "The developer says an AI system proposed the molecule.", source_url: "https://example.org/sample-drug", trials: [], approved },
    ],
  });
  const approval = (regulator: string, source_url: string) => ({ regulator, date: "2026-01-15", source_url });
  const checkerIndex = (c: ConfigFiles, id: string): number => c.checkers.checkers.findIndex((k) => k.id === id);

  it("find nothing in the seed, and name their problems by the five codes of CONFIG_CODES", () => {
    expect(crossFile(() => {})).toEqual([]);
    expect([...CONFIG_CODES]).toEqual(["CONFIG_FILE", "CONFIG_SCHEMA", "CONFIG_REF", "CONFIG_BLOCKED", "CONFIG_CONFLICT"]);
  });

  describe("CONFIG_REF: what other modules look up is there", () => {
    it("needs the subfield ancient-texts under the humanities, where the counter ancient_texts_ai counts it", () => {
      const renamed = crossFile((c) => { c.fields.fields[6]!.subfields.find((s) => s.id === "ancient-texts")!.id = "ancient-writings"; });
      const hit = expectFound(renamed, "CONFIG_REF", here("fields", "fields[6].subfields"), "ancient-texts");
      expect(hit).toMatchObject({ severity: "error", hint: null });
      expect(renamed).toHaveLength(1);
      expectFound(crossFile((c) => { c.fields.fields.pop(); }), "CONFIG_REF", here("fields", "fields"), "ancient-texts");
      // under another field it does not count
      expectFound(crossFile((c) => {
        const h = c.fields.fields[6]!;
        const s = h.subfields.find((x) => x.id === "ancient-texts")!;
        h.subfields = h.subfields.filter((x) => x !== s);
        c.fields.fields[0]!.subfields.push(s);
      }), "CONFIG_REF", here("fields", "fields[6].subfields"));
    });

    it("takes an approval only from a regulator that is a checker with the rung applied", () => {
      const ok = (regulator: string, url: string) => crossFile((c) => { c.aiDrugs = drugWith(approval(regulator, url)); });
      expect(ok("fda", "https://www.fda.gov/drugs/sample")).toEqual([]);
      expect(ok("fda", "https://www.accessdata.fda.gov/scripts/cder/daf/")).toEqual([]);
      expect(ok("fda", "https://sub.fda.gov/x?y=1#z")).toEqual([]);
      expect(ok("ema", "https://www.ema.europa.eu/en/medicines/human/EPAR/sample")).toEqual([]);
      expect(ok("taiwan-fda", "https://www.fda.gov.tw/x")).toEqual([]);
      expect(ok("pmda", "https://www.pmda.go.jp/x")).toEqual([]);
      expect(crossFile((c) => { c.aiDrugs = drugWith(null); })).toEqual([]);

      const at = (inside: string) => here("aiDrugs", `drugs[1].approved.${inside}`);
      expectFound(ok("nobody", "https://www.fda.gov/x"), "CONFIG_REF", at("regulator"), `"nobody" is not a checker id`);
      expect(ok("nobody", "https://example.org/x")).toHaveLength(1);
      expectFound(ok("nobel-prize", "https://www.nobelprize.org/x"), "CONFIG_REF", at("regulator"), "cannot give the rung applied");
      expectFound(ok("clinicaltrials-gov-results", "https://clinicaltrials.gov/study/NCT05938920"), "CONFIG_REF", at("regulator"), "clinicaltrials-gov-results");
      expectFound(ok("fda", "https://example.org/approval"), "CONFIG_REF", at("source_url"), "not on US Food and Drug Administration's hosts");
      expectFound(ok("fda", "https://notfda.gov/x"), "CONFIG_REF", at("source_url"));
      expectFound(ok("fda", "https://www.fda.gov.tw/x"), "CONFIG_REF", at("source_url"));
      // a regulator that cannot give applied and a record off its hosts: both are said
      const both = ok("nobel-prize", "https://example.org/x");
      expectFound(both, "CONFIG_REF", at("regulator"));
      expectFound(both, "CONFIG_REF", at("source_url"));
    });

    it("reads an approval's record against the checker's paths, ignoring case", () => {
      const withPaths = (url: string, paths = ["/drugs/"]) => crossFile((c) => {
        c.checkers.checkers[checkerIndex(c, "fda")]!.paths = paths;
        c.aiDrugs = drugWith(approval("fda", url));
      });
      expect(withPaths("https://www.fda.gov/drugs/sample")).toEqual([]);
      expect(withPaths("https://www.fda.gov/DRUGS/sample")).toEqual([]);
      expect(withPaths("https://www.fda.gov//drugs/sample")).toEqual([]);
      expect(withPaths("https://www.fda.gov/%64rugs/sample")).toEqual([]);
      expectFound(withPaths("https://www.fda.gov/devices/sample"), "CONFIG_REF", here("aiDrugs", "drugs[1].approved.source_url"));
      expectFound(withPaths("https://www.fda.gov/"), "CONFIG_REF", here("aiDrugs", "drugs[1].approved.source_url"));
      // the entry's own paths are read in lower case too, and any one of them will do
      expect(withPaths("https://www.fda.gov/drugs/sample", ["/Drugs/"])).toEqual([]);
      expect(withPaths("https://www.fda.gov/Drugs/sample", ["/DRUGS/"])).toEqual([]);
      expect(withPaths("https://www.fda.gov/drugs/sample", ["/devices/", "/drugs/"])).toEqual([]);
      expect(withPaths("https://www.fda.gov/drugs/sample", ["/drugs/", "/devices/"])).toEqual([]);
      expect(withPaths("https://www.fda.gov/devices/sample", ["/drugs/", "/devices/"])).toEqual([]);
      expectFound(withPaths("https://www.fda.gov/biologics/sample", ["/drugs/", "/devices/"]), "CONFIG_REF", here("aiDrugs", "drugs[1].approved.source_url"));
    });

    it("needs the lab anthropic, which mentionsAnthropic() reads", () => {
      const found = crossFile((c) => { c.labs.labs = c.labs.labs.filter((l) => l.id !== "anthropic"); });
      expectFound(found, "CONFIG_REF", here("labs", "labs"), `id "anthropic"`);
      expect(found).toHaveLength(1);
    });

    it("needs the checker breakthrough-prize, named exactly Breakthrough Prize, and the checker vesuvius-challenge with both its hosts", () => {
      expectFound(crossFile((c) => { c.checkers.checkers = c.checkers.checkers.filter((k) => k.id !== "breakthrough-prize"); }), "CONFIG_REF", here("checkers", "checkers"), "breakthrough-prize");
      for (const name of ["Breakthrough Prize Foundation", "Breakthrough prize", "The Breakthrough Prize", "Breakthrough Prize "]) {
        const found = crossFile((c) => { c.checkers.checkers[checkerIndex(c, "breakthrough-prize")]!.name = name; });
        expectFound(found, "CONFIG_REF", here("checkers", `checkers[${4}].name`), `must be exactly "Breakthrough Prize"`);
      }
      expectFound(crossFile((c) => { c.checkers.checkers = c.checkers.checkers.filter((k) => k.id !== "vesuvius-challenge"); }), "CONFIG_REF", here("checkers", "checkers"), "vesuvius-challenge");
      for (const keep of [["scrollprize.org"], ["scrollprize.substack.com"], ["www.scrollprize.org"]]) {
        const found = crossFile((c) => { c.checkers.checkers[checkerIndex(c, "vesuvius-challenge")]!.hosts = keep; });
        expectFound(found, "CONFIG_REF", here("checkers", `checkers[${checkerIndex(parsedSeed(), "vesuvius-challenge")}].hosts`), "scrollprize.org and its announcements");
      }
      expect(crossFile((c) => { c.checkers.checkers[checkerIndex(c, "vesuvius-challenge")]!.hosts = ["scrollprize.substack.com", "scrollprize.org"]; }).filter((i) => i.code === "CONFIG_REF")).toEqual([]);
    });

    it("needs a checker's or lab's name that holds a hype word to be one HYPE_WORDS masks first (listed names, case included)", () => {
      const checker = (name: string) => crossFile((c) => {
        c.checkers.checkers.push({ id: "sample-awards", name, hosts: ["example.org"], paths: ["/"], rungs: ["checked"] });
      });
      const lab = (name: string) => crossFile((c) => { c.labs.labs.push({ id: "sample-lab", name, hosts: ["example.org"], paths: ["/"] }); });
      const checkerAt = here("checkers", `checkers[${parsedSeed().checkers.checkers.length}].name`);
      const labAt = here("labs", `labs[${parsedSeed().labs.labs.length}].name`);
      expectFound(checker("Revolutionary Awards"), "CONFIG_REF", checkerAt, `"revolutionary"`);
      expectFound(checker("The Game-Changing Prize"), "CONFIG_REF", checkerAt, `"game-changing"`);
      expectFound(lab("Unprecedented Labs"), "CONFIG_REF", labAt, `"unprecedented"`);
      // the words are named in the order hype-words.json lists them
      expectFound(lab("Stunning and Revolutionary Labs"), "CONFIG_REF", labAt, `holds "revolutionary", "stunning"`);
      // a masked name passes, in the case it is listed: Breakthrough Listen is on the names list
      expect(lab("Breakthrough Listen Institute")).toEqual([]);
      expect(checker("Breakthrough Prize Foundation")).toEqual([]);
      expectFound(lab("breakthrough listen institute"), "CONFIG_REF", labAt, `"breakthrough"`);
      expect(lab("Allen Institute")).toEqual([]);
      // adding the name to hype-words.json is the fix
      expect(crossFile((c) => {
        c.hypeWords.names.push({ en: "Revolutionary Awards", zh: null });
        c.checkers.checkers.push({ id: "sample-awards", name: "Revolutionary Awards", hosts: ["example.org"], paths: ["/"], rungs: ["checked"] });
      })).toEqual([]);
    });

    it("needs the expert-reactions feed's host to be a reaction source's host, when the feed is there", () => {
      const smc = (c: ConfigFiles) => c.sources.feeds.findIndex((f) => f.id === "smc-reactions");
      const found = crossFile((c) => { c.sources.feeds[smc(c)]!.url = "https://example.org/"; });
      expectFound(found, "CONFIG_REF", here("sources", `feeds[${smc(parsedSeed())}].url`), "reaction_sources");
      expectFound(crossFile((c) => { c.sourceTiers.reaction_sources = c.sourceTiers.reaction_sources.filter((r) => r.id !== "smc"); }), "CONFIG_REF", here("sources", `feeds[${smc(parsedSeed())}].url`));
      expect(crossFile((c) => { c.sources.feeds[smc(c)]!.url = "https://news.sciencemediacentre.org/x"; })).toEqual([]);
      expect(crossFile((c) => { c.sources.feeds[smc(c)]!.url = "https://sciencemediacentre.org/"; })).toEqual([]);
      expect(crossFile((c) => { c.sources.feeds = c.sources.feeds.filter((f) => f.id !== "smc-reactions"); })).toEqual([]);
    });
  });

  describe("CONFIG_BLOCKED: no entry names a BLOCKED_HOSTS host or path", () => {
    type Edit = (c: ConfigFiles) => string;
    const rows: [string, ConfigKey, Edit][] = [
      ["the site address", "run", (c) => { c.run.site.url = "https://bit.ly"; return "site.url"; }],
      ["the address of ME tracker", "run", (c) => { c.run.siblings.me = "https://pastebin.com"; return "siblings.me"; }],
      ["the address of Europe's tracker", "run", (c) => { c.run.siblings.europe = "https://t.me"; return "siblings.europe"; }],
      ["the address of the Cyber tracker", "run", (c) => { c.run.siblings.cyber = "https://tinyurl.com"; return "siblings.cyber"; }],
      ["a feed's address", "sources", (c) => { c.sources.feeds[4]!.url = "https://pastebin.com/raw/abc"; return "feeds[4].url"; }],
      ["a feed's fallback address", "sources", (c) => { c.sources.feeds[7]!.fallback_url = "https://archive.org/web/x"; return "feeds[7].fallback_url"; }],
      ["a publisher host", "sourceTiers", (c) => { c.sourceTiers.publishers[0]!.hosts[1] = "t.me"; return "publishers[0].hosts[1]"; }],
      ["a resolver host", "sourceTiers", (c) => { c.sourceTiers.resolvers[1]!.hosts[0] = "discord.gg"; return "resolvers[1].hosts[0]"; }],
      ["a registry host", "sourceTiers", (c) => { c.sourceTiers.registries[0]!.hosts[0] = "tinyurl.com"; return "registries[0].hosts[0]"; }],
      ["a reaction source host", "sourceTiers", (c) => { c.sourceTiers.reaction_sources[1]!.hosts[0] = "href.li"; return "reaction_sources[1].hosts[0]"; }],
      ["a lab host", "labs", (c) => { c.labs.labs[0]!.hosts[0] = "bit.ly"; return "labs[0].hosts[0]"; }],
      ["a checker host", "checkers", (c) => { c.checkers.checkers[0]!.hosts[0] = "bit.ly"; return "checkers[0].hosts[0]"; }],
      ["a figure host", "sourceTiers", (c) => { c.sourceTiers.figure_hosts[0] = "annas-archive.org"; return "figure_hosts[0]"; }],
      ["a statement suffix", "sourceTiers", (c) => { c.sourceTiers.statement_suffixes.push(".onion"); return `statement_suffixes[${c.sourceTiers.statement_suffixes.length - 1}]`; }],
      ["a statement host", "sourceTiers", (c) => { c.sourceTiers.statement_suffixes.push("libgen.is"); return `statement_suffixes[${c.sourceTiers.statement_suffixes.length - 1}]`; }],
      ["a statement host with a path", "sourceTiers", (c) => { c.sourceTiers.statement_suffixes.push("google.com/url"); return `statement_suffixes[${c.sourceTiers.statement_suffixes.length - 1}]`; }],
      ["a counter's source", "counters", (c) => { c.counters.counters[3]!.source_url = "https://archive.org/details/x"; return "counters[3].source_url"; }],
      ["a figure's source", "counters", (c) => {
        c.counters.counters[5]!.figures = [
          { as_of: "2023-12-31", total: 1, source_url: "https://example.org/a" }, { as_of: "2024-12-31", total: 1, source_url: "https://sci-hub.se/x" },
        ];
        return "counters[5].figures[1].source_url";
      }],
      ["a marker's source", "markers", (c) => { c.markers.markers[1]!.source_url = "https://bit.ly/x"; return "markers[1].source_url"; }],
      ["a drug's source", "aiDrugs", (c) => {
        c.aiDrugs = drugWithSource("https://rentry.co/x", null);
        return "drugs[1].source_url";
      }],
      ["an approval's source", "aiDrugs", (c) => {
        c.aiDrugs = drugWithSource("https://example.org/x", { regulator: "fda", date: "2026-01-15", source_url: "https://ransomware.live/x" });
        return "drugs[1].approved.source_url";
      }],
    ];
    /** Two drugs, the first clean, so a path in an issue names the second as drugs[1]. */
    function drugWithSource(source_url: string, approved: { regulator: string; date: string; source_url: string } | null) {
      return AiDrugsFile.parse({
        schema_version: 1, version: 1,
        drugs: [
          { id: "first-drug", name: "First drug", developer: "Sample Pharma", ai_basis: "The developer says an AI system proposed the molecule.", source_url: "https://example.org/first-drug", trials: [], approved: null },
          { id: "sample-drug", name: "Sample drug", developer: "Sample Pharma", ai_basis: "The developer says an AI system proposed the molecule.", source_url, trials: [], approved },
        ],
      });
    }

    it.each(rows)("finds %s", (_label, key, edit) => {
      let inside = "";
      const found = crossFile((c) => { inside = edit(c); }).filter((i) => i.code === "CONFIG_BLOCKED");
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ code: "CONFIG_BLOCKED", severity: "error", path: here(key, inside) });
      expect(found[0]!.message).toContain("is on BLOCKED_HOSTS (");
      expect(found[0]!.hint).toContain("Remove the entry");
    });

    it("names the entry and its reason, and the URL it read", () => {
      const found = crossFile((c) => { c.run.site.url = "https://bit.ly"; });
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toBe("https://bit.ly is on BLOCKED_HOSTS (bit.ly, shortener); no config entry may name it (§9.5).");
      // a host an entry lists is read as the URL of its path, so the message names that URL
      const host = crossFile((c) => { c.labs.labs[0]!.hosts = ["bit.ly"]; c.labs.labs[0]!.paths = ["/x"]; });
      expect(host).toHaveLength(1);
      expect(host[0]!.message).toBe("https://bit.ly/x is on BLOCKED_HOSTS (bit.ly, shortener); no config entry may name it (§9.5).");
      expect(blockedEntry("https://bit.ly/")).toMatchObject({ pattern: "bit.ly", reason: "shortener" });
    });

    it("names the URL a statement entry stands for: a suffix as a host under it, a host as its home page, a host with a path as that path", () => {
      const named = (entry: string) => crossFile((c) => { c.sourceTiers.statement_suffixes.push(entry); }).filter((i) => i.code === "CONFIG_BLOCKED");
      const expected = (url: string) => {
        const hit = blockedEntry(url)!;
        return `${url} is on BLOCKED_HOSTS (${hit.pattern}, ${hit.reason}); no config entry may name it (§9.5).`;
      };
      expect(named(".onion").map((i) => i.message)).toEqual([expected("https://x.onion/")]);
      expect(named("libgen.is").map((i) => i.message)).toEqual([expected("https://libgen.is/")]);
      expect(named("google.com/url").map((i) => i.message)).toEqual([expected("https://google.com/url")]);
    });

    it("reads a host with each of its paths, so a blocked path entry stops only its own path", () => {
      const lab = (paths: string[]) => crossFile((c) => { c.labs.labs[0]!.hosts = ["google.com"]; c.labs.labs[0]!.paths = paths; }).filter((i) => i.code === "CONFIG_BLOCKED");
      expect(lab(["/search"])).toEqual([]);
      expect(lab(["/url"])).toHaveLength(1);
      expect(lab(["/url/x"])).toHaveLength(1);
      expect(lab(["/", "/url"])).toHaveLength(1);
      expect(lab(["/URL"])).toHaveLength(1);
    });

    it("reads a host label and a suffix as BLOCKED_HOSTS does, and not a host that only looks like one", () => {
      const lab = (host: string) => crossFile((c) => { c.labs.labs[0]!.hosts = [host]; }).filter((i) => i.code === "CONFIG_BLOCKED");
      expect(lab("sci-hub.tw")).toHaveLength(1);
      expect(lab("www.sci-hub.co.uk")).toHaveLength(1);
      expect(lab("my-sci-hub.org")).toEqual([]);
      expect(lab("scihub.org")).toEqual([]);
      expect(lab("sub.pastebin.com")).toHaveLength(1);
      expect(lab("notpastebin.com")).toEqual([]);
      expect(lab("x.onion")).toHaveLength(1);
    });

    it("reports a location once, however many paths its host has, and each location it finds", () => {
      const found = crossFile((c) => {
        c.sourceTiers.publishers[0]!.hosts = ["t.me"];
        c.sourceTiers.publishers[0]!.paths = ["/a", "/b", "/c"];
        c.sourceTiers.publishers[1]!.hosts = ["bit.ly", "tinyurl.com"];
      }).filter((i) => i.code === "CONFIG_BLOCKED");
      expect(found.map((i) => i.path)).toEqual([
        here("sourceTiers", "publishers[0].hosts[0]"), here("sourceTiers", "publishers[1].hosts[0]"), here("sourceTiers", "publishers[1].hosts[1]"),
      ]);
    });

    it("every pattern of BLOCKED_HOSTS the lists name is caught wherever it is written", () => {
      for (const b of BLOCKED_HOSTS.filter((e) => !e.pattern.startsWith(".") && !e.pattern.includes("/") && e.pattern.includes("."))) {
        const found = crossFile((c) => { c.labs.labs[0]!.hosts = [b.pattern]; }).filter((i) => i.code === "CONFIG_BLOCKED");
        expect(found, b.pattern).toHaveLength(1);
      }
    });
  });

  describe("CONFIG_CONFLICT: no allowed host or source is a press host", () => {
    type Edit = (c: ConfigFiles) => string;
    const last = (xs: readonly unknown[]): number => xs.length - 1;
    const rows: [string, string, Edit][] = [
      ["a publisher host on the press list", "an allowed host", (c) => { const p = c.sourceTiers.publishers[0]!; p.hosts.push("quantamagazine.org"); return `publishers[0].hosts[${last(p.hosts)}]`; }],
      ["a publisher host under a press host", "an allowed host", (c) => { const p = c.sourceTiers.publishers[0]!; p.hosts.push("blog.quantamagazine.org"); return `publishers[0].hosts[${last(p.hosts)}]`; }],
      ["a resolver host", "an allowed host", (c) => { const r = c.sourceTiers.resolvers[0]!; r.hosts.push("phys.org"); return `resolvers[0].hosts[${last(r.hosts)}]`; }],
      ["a registry host", "an allowed host", (c) => { const r = c.sourceTiers.registries[0]!; r.hosts.push("medicalxpress.com"); return `registries[0].hosts[${last(r.hosts)}]`; }],
      ["a figure host", "a figure host", (c) => { c.sourceTiers.figure_hosts.push("techxplore.com"); return `figure_hosts[${last(c.sourceTiers.figure_hosts)}]`; }],
      ["a statement host", "an allowed host", (c) => { c.sourceTiers.statement_suffixes.push("newscientist.com"); return `statement_suffixes[${last(c.sourceTiers.statement_suffixes)}]`; }],
      ["a statement host with a path", "an allowed host", (c) => { c.sourceTiers.statement_suffixes.push("phys.org/news"); return `statement_suffixes[${last(c.sourceTiers.statement_suffixes)}]`; }],
      ["a counter's source", "a source", (c) => { c.counters.counters[3]!.source_url = "https://phys.org/x"; return "counters[3].source_url"; }],
      ["a figure's source", "a source", (c) => {
        c.counters.counters[5]!.figures = [
          { as_of: "2023-12-31", total: 1, source_url: "https://example.org/a" }, { as_of: "2024-12-31", total: 1, source_url: "https://www.sciencedaily.com/x" },
        ];
        return "counters[5].figures[1].source_url";
      }],
      ["a marker's source", "a source", (c) => { c.markers.markers[0]!.source_url = "https://news.livescience.com/x"; return "markers[0].source_url"; }],
    ];
    const conflict = (edit: Edit): { found: ConfigIssue[]; inside: string } => {
      let inside = "";
      const found = crossFile((c) => { inside = edit(c); }).filter((i) => i.code === "CONFIG_CONFLICT");
      return { found, inside };
    };
    const key = (label: string): ConfigKey => (label.includes("counter") || label.includes("figure's") ? "counters" : label.includes("marker") ? "markers" : "sourceTiers");

    it.each(rows)("finds %s", (label, what, edit) => {
      const { found, inside } = conflict(edit);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ code: "CONFIG_CONFLICT", severity: "error", path: here(key(label), inside) });
      if (what === "a source") expect(found[0]!.message).toContain("is on the press host");
      else expect(found[0]!.message).toContain(`is ${what} and sits under the press host`);
      expect(found[0]!.hint).not.toBeNull();
    });

    it("says what it found and what to do, in full", () => {
      const host = conflict((c) => { c.sourceTiers.publishers[0]!.hosts.push("blog.quantamagazine.org"); return ""; }).found;
      expect(host.map((i) => [i.message, i.hint])).toEqual([[
        "blog.quantamagazine.org is an allowed host and sits under the press host quantamagazine.org, so no URL on it can be primary.",
        "Remove one of the two, or name the host and its paths in reaction_sources, labs.json or checkers.json, which win over the press list for the paths they name (§4.11).",
      ]]);
      const figure = conflict((c) => { c.sourceTiers.figure_hosts.push("phys.org"); return ""; }).found;
      expect(figure.map((i) => i.message)).toEqual(["phys.org is a figure host and sits under the press host phys.org, so no URL on it can be primary."]);
      const source = conflict((c) => { c.counters.counters[3]!.source_url = "https://phys.org/x"; return ""; }).found;
      expect(source.map((i) => [i.message, i.hint])).toEqual([["https://phys.org/x is on the press host phys.org; a source is a primary record, never press (§4.11).", "Cite the record's own page."]]);
    });

    it("finds a drug's source and an approval's source on a press host", () => {
      const drug = (source_url: string, approved: unknown) => crossFile((c) => {
        c.aiDrugs = AiDrugsFile.parse({
          schema_version: 1, version: 1,
          drugs: [
            { id: "first-drug", name: "First drug", developer: "Sample Pharma", ai_basis: "The developer says an AI system proposed the molecule.", source_url: "https://example.org/first-drug", trials: [], approved: null },
            { id: "sample-drug", name: "Sample drug", developer: "Sample Pharma", ai_basis: "The developer says an AI system proposed the molecule.", source_url, trials: [], approved },
          ],
        });
      }).filter((i) => i.code === "CONFIG_CONFLICT");
      expect(drug("https://www.statnews.com/x", null).map((i) => i.path)).toEqual([here("aiDrugs", "drugs[1].source_url")]);
      expect(drug("https://example.org/x", { regulator: "fda", date: "2026-01-15", source_url: "https://www.medscape.com/x" }).map((i) => i.path)).toEqual([here("aiDrugs", "drugs[1].approved.source_url")]);
    });

    it("lets a reaction source, a lab or a checker that names a host win over the press list", () => {
      expect(crossFile((c) => { c.sourceTiers.reaction_sources[0]!.hosts.push("sciencedaily.com"); })).toEqual([]);
      expect(crossFile((c) => { c.labs.labs[0]!.hosts.push("phys.org"); })).toEqual([]);
      expect(crossFile((c) => { c.checkers.checkers[0]!.hosts.push("quantamagazine.org"); })).toEqual([]);
      // each kind of winner frees the press host another list names, and not without it (a winner frees the paths it lists: here every path)
      const freed = (winner: (c: ConfigFiles) => void) => crossFile((c) => { c.sourceTiers.publishers[0]!.hosts.push("quantamagazine.org"); winner(c); });
      expect(crossFile((c) => { c.sourceTiers.publishers[0]!.hosts.push("quantamagazine.org"); }).map((i) => i.code)).toEqual(["CONFIG_CONFLICT"]);
      expect(freed((c) => { const r = c.sourceTiers.reaction_sources[0]!; r.hosts.push("quantamagazine.org"); r.paths = ["/"]; })).toEqual([]);
      expect(freed((c) => { c.labs.labs[0]!.hosts.push("quantamagazine.org"); })).toEqual([]);
      expect(freed((c) => { c.checkers.checkers[0]!.hosts.push("quantamagazine.org"); })).toEqual([]);
      expect(crossFile((c) => { c.markers.markers[0]!.source_url = "https://quantamagazine.org/x"; c.labs.labs[0]!.hosts.push("quantamagazine.org"); })).toEqual([]);
      expect(crossFile((c) => { c.markers.markers[0]!.source_url = "https://quantamagazine.org/x"; c.checkers.checkers[0]!.hosts.push("quantamagazine.org"); })).toEqual([]);
      // so a publisher or a source on a host a winner names passes too
      expect(crossFile((c) => { c.sourceTiers.publishers[0]!.hosts.push("terrytao.wordpress.com"); })).toEqual([]);
      expect(crossFile((c) => { c.markers.markers[0]!.source_url = "https://scrollprize.substack.com/p/x"; })).toEqual([]);
      expect(crossFile((c) => { c.markers.markers[0]!.source_url = "https://sub.terrytao.wordpress.com/p/x"; })).toEqual([]);
      // a winner's host does not free its parent
      const parent = crossFile((c) => { c.sourceTiers.publishers[0]!.hosts.push("wordpress.com"); }).filter((i) => i.code === "CONFIG_CONFLICT");
      expect(parent).toHaveLength(1);
    });

    describe("a winner frees only the hosts and paths it lists, as isPrimary() reads them (F-49)", () => {
      // A lab that names medium.com (on the press list) under /lab-notes only: its own entry wins, and so does a source under that path.
      const labOnPath = (c: ConfigFiles): void => { const l = c.labs.labs[0]!; l.hosts = ["medium.com"]; l.paths = ["/lab-notes"]; };
      const sourceAt = (url: string, winner: (c: ConfigFiles) => void = labOnPath): ConfigIssue[] =>
        crossFile((c) => { winner(c); c.markers.markers[0]!.source_url = url; }).filter((i) => i.code === "CONFIG_CONFLICT");

      it("passes a source under the winner's path and finds one on the same host outside it, which isPrimary() refuses too", () => {
        expect(sourceAt("https://medium.com/lab-notes/post")).toEqual([]);
        expect(sourceAt("https://medium.com/LAB-NOTES/post")).toEqual([]);
        expect(sourceAt("https://www.medium.com/lab-notes")).toEqual([]);
        const outside = sourceAt("https://medium.com/other/post");
        expect(outside.map((i) => [i.path, i.message])).toEqual([[here("markers", "markers[0].source_url"), "https://medium.com/other/post is on the press host medium.com; a source is a primary record, never press (§4.11)."]]);
        expect(sourceAt("https://medium.com/lab-note")).toHaveLength(1);
        expect(sourceAt("https://medium.com/")).toHaveLength(1);
        // the URL test agrees: the same URLs, tried against the same files
        const c = parsedSeed();
        labOnPath(c);
        expect(isPrimary("https://medium.com/lab-notes/post", "lab_post", c)).toBe(true);
        expect(primaryTest("https://medium.com/other/post", c)).toMatchObject({ kinds: [], refusal: "press_host", by: "medium.com" });
      });

      it("finds a source under the host of a winner that lists no path of it, in the three files that name sources", () => {
        const counters = crossFile((c) => { labOnPath(c); c.counters.counters[3]!.source_url = "https://medium.com/other"; }).filter((i) => i.code === "CONFIG_CONFLICT");
        expect(counters.map((i) => i.path)).toEqual([here("counters", "counters[3].source_url")]);
        const drug = crossFile((c) => {
          labOnPath(c);
          c.aiDrugs = AiDrugsFile.parse({
            schema_version: 1, version: 1,
            drugs: [{ id: "sample-drug", name: "Sample drug", developer: "Sample Pharma", ai_basis: "The developer says an AI system proposed the molecule.", source_url: "https://medium.com/lab-notes/drug", trials: [], approved: { regulator: "fda", date: "2026-01-15", source_url: "https://medium.com/elsewhere/approval" } }],
          });
        }).filter((i) => i.code === "CONFIG_CONFLICT");
        expect(drug.map((i) => i.path)).toEqual([here("aiDrugs", "drugs[0].approved.source_url")]);
      });

      it("finds an allowed host that a winner names only for some paths: the host's other paths cannot be primary", () => {
        const publisher = (path: string) => crossFile((c) => {
          labOnPath(c);
          const p = c.sourceTiers.publishers[0]!;
          p.hosts.push("medium.com");
          p.paths = [path];
        }).filter((i) => i.code === "CONFIG_CONFLICT");
        expect(publisher("/lab-notes/articles")).toEqual([]);
        const outside = publisher("/other");
        expect(outside.map((i) => [i.path, i.message])).toEqual([[here("sourceTiers", `publishers[0].hosts[${parsedSeed().sourceTiers.publishers[0]!.hosts.length}]`), "medium.com is an allowed host and sits under the press host medium.com, so no URL on it can be primary."]]);
        const figure = crossFile((c) => { labOnPath(c); c.sourceTiers.figure_hosts.push("medium.com"); }).filter((i) => i.code === "CONFIG_CONFLICT");
        expect(figure.map((i) => i.message)).toEqual(["medium.com is a figure host and sits under the press host medium.com, so no URL on it can be primary."]);
      });

      it("reads a winner's path as isPrimary() does: lower case, escapes decoded, a plain prefix, and `/` for any path", () => {
        const withPath = (path: string) => (c: ConfigFiles): void => { const l = c.labs.labs[0]!; l.hosts = ["medium.com"]; l.paths = [path]; };
        expect(sourceAt("https://medium.com/Lab%2Dnotes/x", labOnPath)).toEqual([]);
        expect(sourceAt("https://medium.com//lab-notes/x", labOnPath)).toEqual([]);
        expect(sourceAt("https://medium.com/lab-notes-2026/x", labOnPath)).toEqual([]);
        expect(sourceAt("https://medium.com/anything/at/all", withPath("/"))).toEqual([]);
        expect(sourceAt("https://medium.com/lab-notes/x", withPath("/Lab-Notes"))).toEqual([]);
        expect(sourceAt("https://medium.com/lab%20notes/x", withPath("/lab-notes"))).toHaveLength(1);
      });

      it("leaves a host that is not on the press list to no conflict, and finds a source that names a port or a user name on one, which no winner frees (isPrimary() refuses the shape)", () => {
        expect(sourceAt("https://example.org/x")).toEqual([]);
        expect(sourceAt("https://example.org:8443/x")).toEqual([]);
        for (const url of ["https://medium.com:8443/other", "https://medium.com:8443/lab-notes/x", "https://user@medium.com/other", "https://user@medium.com/lab-notes/x"]) {
          expect(sourceAt(url).map((i) => i.path), url).toEqual([here("markers", "markers[0].source_url")]);
        }
        const c = parsedSeed();
        labOnPath(c);
        expect(primaryTest("https://medium.com:8443/lab-notes/x", c)).toMatchObject({ kinds: [], refusal: "port" });
      });

      it("keeps a blocked host that is also on the press list a conflict as well as a blocked entry", () => {
        const both = crossFile((c) => { c.sourceTiers.press_hosts.push("bit.ly"); c.sourceTiers.figure_hosts.push("bit.ly"); });
        expect(both.map((i) => i.code).sort(byCodeUnit)).toEqual(["CONFIG_BLOCKED", "CONFIG_CONFLICT"]);
      });
    });

    it("names the most specific press entry that a host or a source sits under, whichever of two nested entries the list gives first", () => {
      const nested = (c: ConfigFiles): void => { c.sourceTiers.press_hosts.push("press-sample.org", "blog.press-sample.org"); };
      const host = crossFile((c) => { nested(c); c.sourceTiers.publishers[0]!.hosts.push("x.blog.press-sample.org"); }).filter((i) => i.code === "CONFIG_CONFLICT");
      expect(host.map((i) => i.message)).toEqual(["x.blog.press-sample.org is an allowed host and sits under the press host blog.press-sample.org, so no URL on it can be primary."]);
      const source = crossFile((c) => { nested(c); c.markers.markers[0]!.source_url = "https://x.blog.press-sample.org/a"; }).filter((i) => i.code === "CONFIG_CONFLICT");
      expect(source.map((i) => i.message)).toEqual(["https://x.blog.press-sample.org/a is on the press host blog.press-sample.org; a source is a primary record, never press (§4.11)."]);
    });

    describe("pressHostFor(), the test the config check and isPrimary() share", () => {
      const cfg = (): ConfigFiles => parsedSeed();
      it("names the first press entry the host is or sits under, for an https address with no user name and no port but 443", () => {
        const c = cfg();
        expect(pressHostFor("https://phys.org/news/x", c)).toBe("phys.org");
        expect(pressHostFor("https://www.phys.org/news/x", c)).toBe("phys.org");
        expect(pressHostFor("https://PHYS.ORG./news/x", c)).toBe("phys.org");
        expect(pressHostFor("https://phys.org:443/news/x", c)).toBe("phys.org");
        expect(pressHostFor("https://asia.nikkei.com/x", c)).toBe("nikkei.com");
        expect(pressHostFor("https://notphys.org/x", c)).toBeNull();
        expect(pressHostFor("https://nature.com/articles/x", c)).toBeNull();
        expect(pressHostFor("not a url", c)).toBeNull();
        expect(pressHostFor("", c)).toBeNull();
      });

      it("keeps the press host of an address that is not https, has a user name or names a port: no entry lists such an address, so none wins", () => {
        const c = cfg();
        for (const bad of ["http://phys.org/x", "https://user@phys.org/x", "https://user:pw@www.phys.org/x", "https://phys.org:8443/x", "ftp://phys.org/x"]) expect(pressHostFor(bad, c), bad).toBe("phys.org");
        expect(pressHostFor("https://notphys.org:8443/x", c)).toBeNull();
        expect(pressHostFor("http://nature.com/x", c)).toBeNull();
        // a winner that lists the host and the path frees an https address there, and not one of those shapes: isPrimary() refuses the shape anyway
        c.labs.labs[0]!.hosts = ["techxplore.com"];
        c.labs.labs[0]!.paths = ["/x"];
        expect(pressHostFor("https://techxplore.com/x/1", c)).toBeNull();
        expect(pressHostFor("https://techxplore.com:8443/x/1", c)).toBe("techxplore.com");
        expect(pressHostFor("https://u@techxplore.com/x/1", c)).toBe("techxplore.com");
        expect(primaryTest("https://techxplore.com:8443/x/1", c)).toMatchObject({ kinds: [], refusal: "port" });
      });

      it("lets a reaction source, a lab and a checker that list the host and the path win, and only there", () => {
        const c = cfg();
        c.sourceTiers.reaction_sources[0]!.hosts = ["phys.org"];
        c.sourceTiers.reaction_sources[0]!.paths = ["/news/a"];
        expect(pressHostFor("https://phys.org/news/a1", c)).toBeNull();
        expect(pressHostFor("https://phys.org/news/b1", c)).toBe("phys.org");
        c.labs.labs[0]!.hosts = ["techxplore.com"];
        c.labs.labs[0]!.paths = ["/x"];
        expect(pressHostFor("https://techxplore.com/x/1", c)).toBeNull();
        expect(pressHostFor("https://techxplore.com/y", c)).toBe("techxplore.com");
        c.checkers.checkers[0]!.hosts = ["space.com"];
        c.checkers.checkers[0]!.paths = ["/"];
        expect(pressHostFor("https://space.com/anything", c)).toBeNull();
        expect(pressHostFor("https://www.space.com/anything", c)).toBeNull();
      });

      it("is what primaryTest() refuses a URL for, after the shape and BLOCKED_HOSTS tests", () => {
        const c = cfg();
        for (const url of ["https://phys.org/news/x", "https://www.sciencedaily.com/a", "https://nature.com/articles/x", "https://terrytao.wordpress.com/2026/x", "https://scrollprize.substack.com/p/x", "https://other.substack.com/p/x"]) {
          const refused = primaryTest(url, c).refusal === "press_host";
          expect(pressHostFor(url, c) !== null, url).toBe(refused);
        }
        expect(primaryTest("https://other.substack.com/p/x", c)).toMatchObject({ refusal: "press_host", by: "substack.com" });
        expect(pressHostFor("https://scrollprize.substack.com/p/x", c)).toBeNull();
      });
    });

    it("sees the two live exceptions rest on their names: take the name away and the host conflicts", () => {
      const taoGone = crossFile((c) => {
        c.sourceTiers.reaction_sources = c.sourceTiers.reaction_sources.filter((r) => r.id !== "terence-tao");
        c.sourceTiers.publishers[0]!.hosts.push("terrytao.wordpress.com");
      }).filter((i) => i.code === "CONFIG_CONFLICT");
      expect(taoGone).toHaveLength(1);
      expect(taoGone[0]!.message).toContain("terrytao.wordpress.com is an allowed host and sits under the press host wordpress.com");
      const vesuvius = crossFile((c) => {
        c.checkers.checkers[checkerIndex(c, "vesuvius-challenge")]!.hosts = ["scrollprize.org", "www.scrollprize.org"];
      });
      const at = here("sourceTiers", `statement_suffixes[${parsedSeed().sourceTiers.statement_suffixes.indexOf("scrollprize.substack.com")}]`);
      expectFound(vesuvius, "CONFIG_CONFLICT", at, "substack.com");
      expectFound(vesuvius, "CONFIG_REF", here("checkers", `checkers[${checkerIndex(parsedSeed(), "vesuvius-challenge")}].hosts`));
    });

    it("leaves a suffix entry alone: it names no host", () => {
      expect(crossFile((c) => { c.sourceTiers.statement_suffixes.push(".quantamagazine.org"); })).toEqual([]);
    });

    it("reports a location once and every location it finds", () => {
      const found = crossFile((c) => {
        c.sourceTiers.publishers[0]!.hosts = ["phys.org"];
        c.sourceTiers.publishers[0]!.paths = ["/a", "/b"];
        c.sourceTiers.resolvers[0]!.hosts = ["phys.org", "medicalxpress.com"];
      }).filter((i) => i.code === "CONFIG_CONFLICT");
      expect(found.map((i) => i.path)).toEqual([
        here("sourceTiers", "publishers[0].hosts[0]"), here("sourceTiers", "resolvers[0].hosts[0]"), here("sourceTiers", "resolvers[0].hosts[1]"),
      ]);
    });

    it("lists the problems of one load in the order REF, BLOCKED, CONFLICT, each kind in the order of its walk", () => {
      const found = crossFile((c) => {
        c.labs.labs = c.labs.labs.filter((l) => l.id !== "anthropic");
        c.run.site.url = "https://bit.ly";
        c.sourceTiers.publishers[0]!.hosts.push("quantamagazine.org");
      });
      expect(found.map((i) => i.code)).toEqual(["CONFIG_REF", "CONFIG_BLOCKED", "CONFIG_CONFLICT"]);
    });

    it("gives the rest of its checks no noise: a blocked host that is also on the press list is one issue of each kind", () => {
      const both = crossFile((c) => { c.sourceTiers.figure_hosts.push("bit.ly", "phys.org"); });
      expect(both.map((i) => i.code).sort(byCodeUnit)).toEqual(["CONFIG_BLOCKED", "CONFIG_CONFLICT"]);
    });
  });
});

describe("loadConfig() over folders", () => {
  it("makes its folders under the system's temp folder, never inside the repo", () => {
    const dir = tempConfig();
    expect(path.relative(os.tmpdir(), dir).startsWith("..")).toBe(false);
    expect(path.relative(root, dir).startsWith("..")).toBe(true);
    expect(fs.readdirSync(dir).sort(byCodeUnit)).toEqual(Object.values(CONFIG_FILES).sort(byCodeUnit));
  });

  it("loads a copy of the seed as the seed, with its own folder, and the same hashes", () => {
    const dir = tempConfig();
    const copy = loadConfig(dir);
    expect(copy.dir).toBe(dir);
    expect(copy.sha256).toEqual(SEED.sha256);
    for (const key of CONFIG_KEYS) expect(copy[key], key).toEqual(SEED[key]);
    expect(copy).not.toBe(SEED);
  });

  describe("a file that is missing or does not parse is CONFIG_FILE", () => {
    it("names the missing file and the spec section to read", () => {
      const found = issuesFrom({ missing: ["labs"] });
      expect(found).toEqual([{
        code: "CONFIG_FILE", severity: "error", path: here("labs"), message: "File is missing.", hint: "Every config file is required; see SPEC §4.11 for labs.json.",
      }]);
      expect(issuesFrom({ missing: ["sources"] })[0]!.path).toBe("config/sources.yaml");
    });

    it("reports every missing file of an empty folder, in the loader's order", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-config-test-"));
      temps.push(dir);
      const found = configIssues(dir);
      expect(found.map((i) => i.path)).toEqual(CONFIG_KEYS.map((k) => here(k)));
      expect(found.every((i) => i.code === "CONFIG_FILE" && i.severity === "error")).toBe(true);
      expect(() => loadConfig(dir)).toThrow(ConfigError);
    });

    it("reports a file that does not parse, JSON or YAML, even an empty one", () => {
      const found = issuesFrom({ text: { run: "{ not json", journals: "", sources: "feeds: [unclosed", counters: "{\"a\": 1,}" } });
      expect(found.map((i) => [i.code, i.path])).toEqual([
        ["CONFIG_FILE", here("run")], ["CONFIG_FILE", here("sources")], ["CONFIG_FILE", here("journals")], ["CONFIG_FILE", here("counters")],
      ]);
      for (const i of found) expect(i.message).toMatch(/^Does not parse: /);
      // the error's message alone: no class name in front of it
      for (const i of found) expect(i.message).not.toMatch(/^Does not parse: \w*Error\b/);
      expect(found[2]!.message).toBe("Does not parse: Unexpected end of JSON input");
    });

    it("reports a file it cannot read by the error code, never by a path, and goes on with the others", () => {
      const dir = tempConfig({ missing: ["labs", "markers"] });
      fs.mkdirSync(path.join(dir, CONFIG_FILES.labs));
      const found = configIssues(dir);
      expect(found).toEqual([
        {
          code: "CONFIG_FILE", severity: "error", path: here("labs"), message: "Cannot be read: EISDIR.", hint: "labs.json must be a plain file the run may read.",
        },
        {
          code: "CONFIG_FILE", severity: "error", path: here("markers"), message: "File is missing.", hint: "Every config file is required; see SPEC §4.11 for markers.json.",
        },
      ]);
      expect(JSON.stringify(found)).not.toContain(dir);
      expect(() => loadConfig(dir)).toThrow(ConfigError);
    });

    it("reports a file that parses to something that is not an object as a schema break, not a parse failure", () => {
      for (const [text, part] of [["null", "received null"], ["[]", "received array"], ["\"x\"", "received string"], ["5", "received number"]] as const) {
        const found = issuesFrom({ text: { run: text } });
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ code: "CONFIG_SCHEMA", path: here("run") });
        expect(found[0]!.message).toContain(part);
      }
      const yamlNull = issuesFrom({ text: { sources: "" } });
      expect(yamlNull[0]).toMatchObject({ code: "CONFIG_SCHEMA", path: here("sources") });
    });
  });

  describe("a file that breaks its schema is CONFIG_SCHEMA, with its place in the file", () => {
    const one = (edit: (f: Record<ConfigKey, any>) => void): ConfigIssue[] => issuesFrom({ edit });

    it("names an unknown key at the root or inside, and says to remove it", () => {
      expect(one((f) => { f.run.site.extra = 1; })).toEqual([{ code: "CONFIG_SCHEMA", severity: "error", path: here("run", "site.extra"), message: 'Unknown key "extra"; remove it.', hint: null }]);
      expect(one((f) => { f.labs.extra = 1; })).toEqual([{ code: "CONFIG_SCHEMA", severity: "error", path: here("labs", "extra"), message: 'Unknown key "extra"; remove it.', hint: null }]);
      const two = one((f) => { f.labs.extra = 1; f.labs.other = 2; });
      expect(two.map((i) => i.path)).toEqual([here("labs", "extra"), here("labs", "other")]);
      expect(one((f) => { f.journals.journals[3].note = "x"; })[0]!.path).toBe(here("journals", "journals[3].note"));
    });

    it("names a missing key with the type it wants, and says every key is written out", () => {
      const found = one((f) => { delete f.run.site.name; });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ code: "CONFIG_SCHEMA", severity: "error", path: here("run", "site.name"), message: "Missing key (expected string)." });
      expect(found[0]!.hint).toContain("Every key is written out");
      expect(one((f) => { delete f.markers.markers; })[0]).toMatchObject({ path: here("markers", "markers"), message: "Missing key (expected array)." });
    });

    it("gives a wrong type or a refused value as Zod words it, with the place in the file", () => {
      const type = one((f) => { f.run.budgets.agent_minutes = "30"; });
      expect(type).toHaveLength(1);
      expect(type[0]).toMatchObject({ code: "CONFIG_SCHEMA", path: here("run", "budgets.agent_minutes"), hint: null });
      expect(type[0]!.message).toContain("expected number");
      expect(type[0]!.message).not.toContain("Missing key");
      expect(one((f) => { f.journals.journals[3].issn = "0028-0837"; })).toEqual([{
        code: "CONFIG_SCHEMA", severity: "error", path: here("journals", "journals[3].issn"), message: "The ISSN's check digit is wrong", hint: null,
      }]);
      expect(one((f) => { f.sources.feeds[2].priority = 4; })[0]!.path).toBe(here("sources", "feeds[2].priority"));
      expect(one((f) => { f.counters.counters.reverse(); })[0]).toMatchObject({ path: here("counters", "counters"), code: "CONFIG_SCHEMA" });
    });

    it("names an issue at the root of a file by the file alone", () => {
      const found = one((f) => { f.fields.fields[3].openalex_fields = f.fields.fields[3].openalex_fields.filter((id: number) => id !== 36); });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ code: "CONFIG_SCHEMA", path: here("fields") });
      expect(found[0]!.message).toContain("OpenAlex field 36");
    });

    it("reports every broken file in the loader's order, then stops before any cross-file check", () => {
      const found = issuesFrom({
        edit: (f) => {
          f.run.site.extra = 1;
          f.labs.labs = f.labs.labs.filter((l: any) => l.id !== "anthropic");
          f.markers.markers[0].date = "bad";
          f.hypeWords.version = 0;
        },
      });
      expect(found.map((i) => [i.code, i.path])).toEqual([
        ["CONFIG_SCHEMA", here("run", "site.extra")], ["CONFIG_SCHEMA", here("markers", "markers[0].date")], ["CONFIG_SCHEMA", here("hypeWords", "version")],
      ]);
    });

    it("mixes a missing file, a parse failure and a schema break, each by its own code: missing files first, then files that do not parse, then schema breaks", () => {
      const found = issuesFrom({ missing: ["checkers"], text: { aiTerms: "[" }, edit: (f) => { delete f.run.task_name; } });
      expect(found.map((i) => [i.code, i.path])).toEqual([
        ["CONFIG_FILE", here("checkers")], ["CONFIG_FILE", here("aiTerms")], ["CONFIG_SCHEMA", here("run", "task_name")],
      ]);
      expect(found.map((i) => i.message)).toEqual(["File is missing.", expect.stringMatching(/^Does not parse: /), "Missing key (expected string)."]);
    });
  });

  describe("once every file parses, the cross-file checks run, and loadConfig() throws them as one ConfigError", () => {
    it("throws CONFIG_REF for a lab list without anthropic, and configIssues() returns the same", () => {
      const dir = tempConfig({ edit: (f) => { f.labs.labs = f.labs.labs.filter((l: any) => l.id !== "anthropic"); } });
      let error: unknown;
      try {
        loadConfig(dir);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toBeInstanceOf(Error);
      const e = error as ConfigError;
      expect(e.name).toBe("ConfigError");
      expect(e.issues).toHaveLength(1);
      expect(e.issues[0]).toMatchObject({ code: "CONFIG_REF", severity: "error", path: here("labs", "labs") });
      expect(e.message).toBe(`config: 1 problem\nCONFIG_REF ${here("labs", "labs")}: ${e.issues[0]!.message}`);
      expect(configIssues(dir)).toEqual(e.issues);
    });

    it("reads the files it was given, so a blocked host in one folder is found there and not in the seed", () => {
      const found = issuesFrom({ edit: (f) => { f.run.site.url = "https://bit.ly"; f.sourceTiers.press_hosts.push("example.org"); } });
      expect(found.map((i) => i.code)).toEqual(["CONFIG_BLOCKED"]);
      expect(configIssues(configDir)).toEqual([]);
    });

    it("carries the first five problems in the message, and how many more there are", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-config-test-"));
      temps.push(dir);
      let error: ConfigError | undefined;
      try {
        loadConfig(dir);
      } catch (e) {
        error = e as ConfigError;
      }
      expect(error).toBeInstanceOf(ConfigError);
      const lines = error!.message.split("\n");
      expect(lines[0]).toBe("config: 16 problems");
      expect(lines).toHaveLength(7);
      expect(lines[1]).toBe(`CONFIG_FILE ${here("run")}: File is missing.`);
      expect(lines[5]).toBe(`CONFIG_FILE ${here("aiTerms")}: File is missing.`);
      expect(lines[6]).toBe("and 11 more");
      expect(error!.issues).toHaveLength(16);
      expect(new ConfigError(error!.issues.slice(0, 5)).message.split("\n")).toHaveLength(6);
      expect(new ConfigError(error!.issues.slice(0, 6)).message.split("\n").slice(-1)).toEqual(["and 1 more"]);
      expect(new ConfigError(error!.issues.slice(0, 1)).message.split("\n")[0]).toBe("config: 1 problem");
      expect(new ConfigError([]).message).toBe("config: 0 problems");
    });

    it("gives every issue the five keys of the validator's issue, code, severity, path, message and hint", () => {
      const found = issuesFrom({ missing: ["run"], text: { labs: "{" }, edit: (f) => { f.markers.extra = 1; } });
      for (const i of found) {
        expect(Object.keys(i)).toEqual(["code", "severity", "path", "message", "hint"]);
        expect(CONFIG_CODES as readonly string[]).toContain(i.code);
        expect(i.severity).toBe("error");
        expect(typeof i.message).toBe("string");
        expect(i.hint === null || typeof i.hint === "string").toBe(true);
      }
    });
  });

  describe("the cache keeps a folder's result while every file's bytes stay the same", () => {
    it("hands back the same object for the same folder, however the folder is written", () => {
      const dir = tempConfig();
      const first = loadConfig(dir);
      expect(loadConfig(dir)).toBe(first);
      expect(loadConfig(`${dir}${path.sep}`)).toBe(first);
      expect(loadConfig(path.relative(process.cwd(), dir))).toBe(first);
      expect(loadConfig(configDir)).toBe(SEED);
      expect(loadConfig()).toBe(loadConfig());
      expect(configIssues(dir)).toEqual([]);
    });

    it("reads again when a file changes, and the earlier result keeps its values", () => {
      const dir = tempConfig();
      const first = loadConfig(dir);
      const file = path.join(dir, "fields.json");
      const fields = JSON.parse(fs.readFileSync(file, "utf8"));
      fields.version = 2;
      fs.writeFileSync(file, `${JSON.stringify(fields, null, 2)}\n`);
      const second = loadConfig(dir);
      expect(second).not.toBe(first);
      expect(second.versions.fields).toBe(2);
      expect(second.fields.version).toBe(2);
      expect(second.sha256.fields).not.toBe(first.sha256.fields);
      expect(second.sha256.run).toBe(first.sha256.run);
      expect(first.versions.fields).toBe(1);
      expect(loadConfig(dir)).toBe(second);
      // a change that leaves the data alone (a space) is a change of the bytes, so it is read again
      fs.writeFileSync(file, `${JSON.stringify(fields)}\n`);
      const third = loadConfig(dir);
      expect(third).not.toBe(second);
      expect(third.fields).toEqual(second.fields);
    });

    it("reads again when any one of the files changes: the stamp holds every file", () => {
      for (const key of CONFIG_KEYS) {
        const dir = tempConfig();
        const first = loadConfig(dir);
        // a trailing newline: the same data in other bytes
        fs.appendFileSync(path.join(dir, CONFIG_FILES[key]), "\n");
        const second = loadConfig(dir);
        expect(second, key).not.toBe(first);
        expect(second.sha256[key], key).not.toBe(first.sha256[key]);
        for (const other of CONFIG_KEYS.filter((k) => k !== key)) expect(second.sha256[other], `${key}, ${other}`).toBe(first.sha256[other]);
        expect(loadConfig(dir), key).toBe(second);
      }
    });

    it("reads again when a file is changed to a broken one, and a failure is not kept", () => {
      const dir = tempConfig();
      const first = loadConfig(dir);
      const file = path.join(dir, "labs.json");
      const good = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, "{");
      expect(() => loadConfig(dir)).toThrow(ConfigError);
      expect(() => loadConfig(dir)).toThrow(ConfigError);
      fs.writeFileSync(file, good);
      const again = loadConfig(dir);
      expect(again.labs).toEqual(first.labs);
      fs.rmSync(file);
      expect(configIssues(dir).map((i) => i.code)).toEqual(["CONFIG_FILE"]);
      fs.writeFileSync(file, good);
      expect(loadConfig(dir).labs).toEqual(first.labs);
    });

    it("keeps one result for each folder: two folders with the same files are two results", () => {
      const a = tempConfig();
      const b = tempConfig();
      const [ra, rb] = [loadConfig(a), loadConfig(b)];
      expect(ra).not.toBe(rb);
      expect(ra.dir).toBe(a);
      expect(rb.dir).toBe(b);
      expect(loadConfig(a)).toBe(ra);
      expect(loadConfig(b)).toBe(rb);
    });
  });

  describe("overrides replace a file's contents for one load, parsed by its schema, and are never cached", () => {
    it("loads with a file replaced, and records the SHA-256 of its JSON as the files are printed", () => {
      const counters = raw("counters");
      counters.version = 7;
      const c = loadConfig(configDir, { overrides: { counters } });
      expect(c.counters.version).toBe(7);
      expect(c.versions.counters).toBe(7);
      expect(c.sha256.counters).toBe(sha256Hex(`${JSON.stringify(counters, null, 2)}\n`));
      expect(c.sha256.counters).not.toBe(SEED.sha256.counters);
      for (const key of CONFIG_KEYS.filter((k) => k !== "counters")) expect(c.sha256[key], key).toBe(SEED.sha256[key]);
      // an override equal to the file prints as the file does, so it hashes alike
      expect(loadConfig(configDir, { overrides: { run: raw("run") } }).sha256.run).toBe(SEED.sha256.run);
    });

    it("reads an override as raw JSON, never trusting it: the schema judges it, and the cross-file checks too", () => {
      const bad = raw("counters");
      bad.counters.reverse();
      let error: ConfigError | undefined;
      try {
        loadConfig(configDir, { overrides: { counters: bad } });
      } catch (e) {
        error = e as ConfigError;
      }
      expect(error).toBeInstanceOf(ConfigError);
      expect(error!.issues.map((i) => [i.code, i.path])).toEqual([["CONFIG_SCHEMA", here("counters", "counters")]]);
      const noAnthropic = raw("labs");
      noAnthropic.labs = noAnthropic.labs.filter((l: any) => l.id !== "anthropic");
      expect(configIssues(configDir, { overrides: { labs: noAnthropic } }).map((i) => i.code)).toEqual(["CONFIG_REF"]);
      const yamlFile = raw("sources");
      yamlFile.feeds[0].priority = 9;
      expect(configIssues(configDir, { overrides: { sources: yamlFile } }).map((i) => i.path)).toEqual([here("sources", "feeds[0].priority")]);
    });

    it("never caches a load with overrides, and leaves the folder's cached result alone", () => {
      const overrides = { counters: { ...raw("counters"), version: 3 } };
      const a = loadConfig(configDir, { overrides });
      const b = loadConfig(configDir, { overrides });
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
      expect(loadConfig(configDir)).toBe(SEED);
      expect(loadConfig(configDir, { overrides: {} })).toBe(SEED);
      expect(SEED.counters.version).toBe(RAW.counters.version);
    });

    it("never serves a load with overrides from the cache, even when an override prints as the file does", () => {
      const same = loadConfig(configDir, { overrides: { counters: raw("counters") } });
      expect(same).not.toBe(SEED);
      expect(same).toEqual(SEED);
      expect(same.sha256).toEqual(SEED.sha256);
      expect(loadConfig(configDir)).toBe(SEED);
    });

    it("hands back each file parsed by its schema, in the schema's key order, never the caller's own object", () => {
      const given = Object.fromEntries(Object.entries(raw("counters")).reverse());
      expect(Object.keys(given)).toEqual(["counters", "version", "schema_version"]);
      const c = loadConfig(configDir, { overrides: { counters: given } });
      expect(c.counters).not.toBe(given);
      expect(Object.keys(c.counters)).toEqual(["schema_version", "version", "counters"]);
      expect(c.counters).toEqual(SEED.counters);
      // the same for a file on disk written in another key order
      const dir = tempConfig({ text: { counters: `${JSON.stringify(given, null, 2)}\n` } });
      expect(Object.keys(loadConfig(dir).counters)).toEqual(["schema_version", "version", "counters"]);
    });

    it("lets an override stand in for a missing file", () => {
      const dir = tempConfig({ missing: ["labs", "markers"] });
      expect(configIssues(dir).map((i) => i.path)).toEqual([here("labs"), here("markers")]);
      const c = loadConfig(dir, { overrides: { labs: raw("labs"), markers: raw("markers") } });
      expect(c.labs).toEqual(SEED.labs);
      expect(c.markers).toEqual(SEED.markers);
      expect(c.sha256.labs).toBe(SEED.sha256.labs);
    });

    it("refuses a key it does not know with a plain Error, which configIssues() does not swallow", () => {
      let error: unknown;
      try {
        loadConfig(configDir, { overrides: { nope: {} } as never });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ConfigError);
      expect((error as Error).message).toBe('loadConfig: unknown override "nope"');
      expect(() => configIssues(configDir, { overrides: { nope: {} } as never })).toThrow('loadConfig: unknown override "nope"');
      expect(() => loadConfig(configDir, { overrides: { toString: 1 } as never })).toThrow("unknown override");
    });
  });
});

describe("the lookups of loadConfig().index", () => {
  const idx: ConfigIndex = SEED.index;

  it("lists each field's subfields in file order, and the field of each subfield id", () => {
    expect(Object.keys(idx.subfields)).toEqual([...FIELDS]);
    for (const f of SEED.fields.fields) expect(idx.subfields[f.id], f.id).toEqual(f.subfields);
    expect(idx.fieldOfSubfield.get("number-theory")).toBe("mathematics");
    expect(idx.fieldOfSubfield.get("ancient-texts")).toBe("humanities");
    expect(idx.fieldOfSubfield.get("proteins")).toBe("biology");
    expect(idx.fieldOfSubfield.get("protein")).toBeUndefined();
    expect(idx.fieldOfSubfield.size).toBe(SEED.fields.fields.flatMap((f) => f.subfields).length);
  });

  it("maps each OpenAlex field id to our field, an excluded one to null, and leaves an id in neither out", () => {
    expect(idx.openalexFields.size).toBe(OPENALEX_FIELD_MAX - OPENALEX_FIELD_MIN + 1);
    expect(idx.openalexFields.get(26)).toBe("mathematics");
    expect(idx.openalexFields.get(31)).toBe("physics");
    expect(idx.openalexFields.get(25)).toBe("chemistry");
    expect(idx.openalexFields.get(36)).toBe("biology");
    expect(idx.openalexFields.get(23)).toBe("earth");
    expect(idx.openalexFields.get(14)).toBe("social");
    expect(idx.openalexFields.get(12)).toBe("humanities");
    for (const id of [17, 22, 21]) expect(idx.openalexFields.get(id), String(id)).toBeNull();
    expect(idx.openalexFields.has(17)).toBe(true);
    for (const id of [10, 37, 0]) expect(idx.openalexFields.has(id), String(id)).toBe(false);
  });

  it("lists the journals that count in the Pace, and each field's journals (a journal of several fields is under each)", () => {
    expect(idx.paceJournals).toEqual(SEED.journals.journals.filter((j) => j.in_pace));
    expect(idx.paceJournals.map((j) => j.id)).not.toContain("nature-human-behaviour");
    for (const f of FIELDS) expect(idx.journalsByField[f], f).toEqual(SEED.journals.journals.filter((j) => j.fields.includes(f)));
    for (const f of FIELDS) expect(idx.journalsByField[f].map((j) => j.id), f).toContain("nature");
    expect(idx.journalsByField.mathematics.map((j) => j.id)).toContain("annals-of-mathematics");
    expect(idx.journalsByField.physics.map((j) => j.id)).not.toContain("annals-of-mathematics");
  });

  it("lists the phrases the Pace counts and all of them, as an override with a phrase left out of the Pace shows", () => {
    expect(idx.aiPhrases).toEqual(SEED.aiTerms.phrases.map((p) => p.phrase));
    expect(idx.pacePhrases).toEqual(SEED.aiTerms.phrases.filter((p) => p.in_pace).map((p) => p.phrase));
    const aiTerms = raw("aiTerms");
    aiTerms.phrases[0].in_pace = false;
    const journals = raw("journals");
    journals.journals[0].in_pace = false;
    const c = loadConfig(configDir, { overrides: { aiTerms, journals } });
    expect(c.index.pacePhrases).toEqual(aiTerms.phrases.slice(1).map((p: any) => p.phrase));
    expect(c.index.aiPhrases).toHaveLength(aiTerms.phrases.length);
    expect(c.index.aiPhrases[0]).toBe("machine learning");
    expect(c.index.paceJournals.map((j) => j.id)).not.toContain("nature");
    expect(c.index.journalsByField.physics.map((j) => j.id)).toContain("nature");
  });

  it("lists every host a source entry allows, the hosts of the statement entries that name one, and no suffix, press or figure host", () => {
    for (const host of [
      "www.nature.com", "doi.org", "dx.doi.org", "pubmed.ncbi.nlm.nih.gov", "clinicaltrials.gov", "www.sciencemediacentre.org", "terrytao.wordpress.com", "deepmind.google",
      "www.erdosproblems.com", "scrollprize.substack.com", "www.fda.gov", "arxiv.org", "mpg.de", "cell.com", "eurekalert.org", "group.springernature.com", "elsevier.com",
    ]) expect(idx.allowedHosts.has(host), host).toBe(true);
    for (const not of [".edu", "edu", "phys.org", "media.springernature.com", "cdn.rcsb.org", "wordpress.com", "substack.com"]) expect(idx.allowedHosts.has(not), not).toBe(false);
    // every host the six lists name, and the statement entries' hosts, and nothing else
    const t = SEED.sourceTiers;
    const named = [...t.publishers, ...t.resolvers, ...t.registries, ...t.reaction_sources, ...SEED.labs.labs, ...SEED.checkers.checkers].flatMap((e) => e.hosts);
    const statementHosts = t.statement_suffixes.filter((e) => !e.startsWith(".")).map((e) => (e.includes("/") ? e.slice(0, e.indexOf("/")) : e));
    expect([...idx.allowedHosts].sort(byCodeUnit)).toEqual([...new Set([...named, ...statementHosts])].sort(byCodeUnit));
    // a host only a registry lists is allowed too
    const onlyRegistry = t.registries.flatMap((r) => r.hosts).filter((h) => ![...t.publishers, ...t.resolvers, ...t.reaction_sources, ...SEED.labs.labs, ...SEED.checkers.checkers].some((e) => e.hosts.includes(h)));
    expect(onlyRegistry.length).toBeGreaterThan(0);
    for (const h of onlyRegistry) expect(idx.allowedHosts.has(h), h).toBe(true);
    for (const host of idx.allowedHosts) expect(HostName.safeParse(host).success, host).toBe(true);
  });

  it("holds the press hosts and the figure hosts as the files list them", () => {
    expect([...idx.pressHosts]).toEqual(SEED.sourceTiers.press_hosts);
    expect([...idx.figureHosts]).toEqual(SEED.sourceTiers.figure_hosts);
    expect(idx.pressHosts.has("phys.org")).toBe(true);
    expect(idx.figureHosts.has("media.springernature.com")).toBe(true);
  });

  it("splits the statement entries by form, each entry once, a path entry into its host and its path", () => {
    const s = idx.statement;
    expect(s.suffixes.length + s.hosts.length + s.paths.length).toBe(SEED.sourceTiers.statement_suffixes.length);
    expect(s.suffixes).toEqual(SEED.sourceTiers.statement_suffixes.filter((e) => statementForm(e) === "suffix"));
    expect(s.hosts).toEqual(SEED.sourceTiers.statement_suffixes.filter((e) => statementForm(e) === "host"));
    expect(s.suffixes).toEqual(expect.arrayContaining([".edu", ".gov", ".europa.eu", ".ac.uk"]));
    expect(s.hosts).toEqual(expect.arrayContaining(["mpg.de", "sinica.edu.tw", "scrollprize.substack.com", "vatican.va"]));
    expect(s.paths).toEqual(expect.arrayContaining([
      { host: "cell.com", path: "/newsroom" }, { host: "eurekalert.org", path: "/news-releases/" },
      { host: "group.springernature.com", path: "/gp/group/media/press-releases" },
    ]));
    expect(s.paths.map((p) => `${p.host}${p.path}`)).toEqual(SEED.sourceTiers.statement_suffixes.filter((e) => statementForm(e) === "path"));
    for (const p of s.paths) expect(PathPrefix.safeParse(p.path).success, p.path).toBe(true);
  });

  it("gives the names HYPE_WORDS and ZH_HYPE mask, the Chinese ones only where a name has one", () => {
    expect(idx.hypeNames.en).toEqual(SEED.hypeWords.names.map((n) => n.en));
    expect(idx.hypeNames.zh).toEqual(["突破獎"]);
    const hype = raw("hypeWords");
    hype.names.push({ en: "Breakthrough Awards", zh: "突破獎項" });
    const c = loadConfig(configDir, { overrides: { hypeWords: hype } });
    expect(c.index.hypeNames.zh).toEqual(["突破獎", "突破獎項"]);
    expect(c.index.hypeNames.en.at(-1)).toBe("Breakthrough Awards");
  });

  it("gives the characters of the two lists as sets, one character each", () => {
    expect(idx.simplifiedOnly.size).toBe([...SEED.termsZh.simplified_only].length);
    expect(idx.japaneseOnly.size).toBe([...SEED.termsZh.japanese_only].length);
    for (const ch of [...SEED.termsZh.simplified_only]) expect(idx.simplifiedOnly.has(ch)).toBe(true);
    for (const ch of [...SEED.termsZh.japanese_only]) expect(idx.japaneseOnly.has(ch)).toBe(true);
    const astral = [...SEED.termsZh.simplified_only].find((ch) => ch.codePointAt(0)! > 0xffff)!;
    expect(astral.length).toBe(2);
    expect(idx.simplifiedOnly.has(astral)).toBe(true);
    expect(idx.simplifiedOnly.has(astral[0]!)).toBe(false);
  });
});

describe("the exported types", () => {
  it("are inferred under the spec names", () => {
    expectTypeOf<RunFile["schedule"]["timezone"]>().toEqualTypeOf<"Asia/Taipei">();
    expectTypeOf<RunFile["budgets"]["typical_findings"]>().toEqualTypeOf<[number, number]>();
    expectTypeOf<Counter["kind"]>().toEqualTypeOf<"api" | "ledger" | "manual">();
    expectTypeOf<Counter["value"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Checker["rungs"]>().toEqualTypeOf<("checked" | "confirmed" | "applied")[]>();
    expectTypeOf<Publisher["type_field"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Drug["approved"]>().toEqualTypeOf<{ regulator: string; date: string; source_url: string } | null>();
    expectTypeOf<FixedTerm["fields"]>().toEqualTypeOf<FieldId[]>();
    expectTypeOf<ConfigIssue["severity"]>().toEqualTypeOf<"error" | "warning">();
    expectTypeOf<ConfigIssue["hint"]>().toEqualTypeOf<string | null>();
    expectTypeOf<LoadedConfig["versions"]>().toEqualTypeOf<z.infer<typeof ConfigVersions>>();
    expectTypeOf<LoadedConfig["index"]>().toEqualTypeOf<ConfigIndex>();
    expectTypeOf<ConfigFiles["sources"]>().toEqualTypeOf<z.infer<typeof SourcesFile>>();
    expectTypeOf<ConfigFiles["run"]>().toEqualTypeOf<RunFile>();
    expectTypeOf<ConfigKey>().toEqualTypeOf<keyof typeof CONFIG_FILES>();
  });
});
