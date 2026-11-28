// F and T fixtures for the Chinese rule group (SPEC §4.6, §4.12 "Fixtures and tests"). A Chinese draft is a `DraftZh` (strings keyed by
// the Chinese context, and terms), not a `DraftBrief`, so these cases have types of their own and `fixtures/src/build.ts` keeps them
// apart from INVALID_CASES (ZH_INVALID_CASES, ZH_SOFT_CASES, ZH_NAMED_CASES).
//
//   F (`zhCases`)   one mutation of `valid-weekday.zh.json` for each hard code that `validateZh()` can report on a Chinese draft, in the
//                   rule table's order (the codes the table lists a Z fixture for): SCHEMA, DATE_MISMATCH (the draft's date is not the
//                   context's), the safety group's DUAL_USE, SECRET_LIKE, CANARY and BLOCKED_HOST, whose rules also read the Chinese
//                   draft, and the eleven ZH_ codes.
//                   Each is written to fixtures/drafts-zh/ as `invalid--<CODE>.zh.json` and fails `validateZh()` with the weekday's
//                   Chinese context and evidence on exactly that code, and no other error and no warning. Each changes one string (or
//                   one term) that no other rule has a reason to judge: a new number would break ZH_PARITY, a new Latin word too, a
//                   simplified character must leave every fixed term in place, and so on, so a case fails for one reason only.
//                   Three safety cases put their text where ZH_PARITY does not look: ZH_PARITY reads each key's string and each
//                   term's `zh` and `definition`, never a term's `official_url`, so the canary token, the secret-shaped string and the
//                   blocked address (a link shortener, t.co) stand in the fragment of the address of a 樂詞網 page that the pass really
//                   fetched (normalizeUrl() drops a fragment, so ZH_OFFICIAL still finds the page); the dual-use sentence names an
//                   agent and a procedure in Chinese characters alone, which carry no number and no Latin word.
//   S (`zhSoft`)    none: every code of the group is hard (H), as is every safety code that reads Chinese.
//   T (`zhNamed`)   the sentences of each row that one F case cannot show and the checks the weekday draft cannot reach: the rows' "Tests
//                   pass X and fail Y" lists, each boundary of a cap with its passing neighbour, each dash, each hype word, a Sunday
//                   deep dive, a Monday's big picture and a short Monday's, a backlog finding's group, an extra key and an extra
//                   term, and for DATE_MISMATCH each end of the time the pass may have finished in (the English draft's `generated_at`
//                   and the context's deadline, both inclusive) and a date a day after the context's, in every edition. A named case that passes states `{ errors: [], warnings: [] }`. Nothing is written to fixtures/: the group's
//                   tests (tests/fixtures-zh-invalid.test.ts) run each case and compare its exact result.
//
// Everything a case adds is invented and Traditional Chinese as used in Taiwan: a sentence for a reader to take as an example says
// 範例 (the Latin word SAMPLE is a Latin word the English lacks, which ZH_PARITY refuses), a made-up dual-use sentence names an agent and
// a procedure and gives no method (AGENTS rule 10), and the secret-shaped string is joined at run time, so no secret-shaped literal
// sits in this file. A dash is built from its code point, never typed (AGENTS rule 14, the writing rules of plan 1).
//
// New for this project; Cyber has no Chinese pass.

import { taipeiTimestamp } from "../../../lib/dates";
import { countZhChars } from "../../../lib/zh";
import type { DraftZh, DraftZhTerm } from "../../../lib/schema/draft-zh";
import { CANARY_TOKEN } from "../../../lib/vocab";
import { EDITIONS, EDITION_NAMES, type EditionName } from "../world";
import { ZH_CLOCK } from "../zh-inputs";

/** One Chinese F fixture: a mutation of an edition's valid Chinese draft that fails `validateZh()` with exactly `code`. */
export interface ZhInvalidCase {
  code: string;
  /** `invalid--<CODE>.zh.json`, written to fixtures/drafts-zh/. */
  file: string;
  /** The valid Chinese draft mutated, and whose inputs validate it; default "weekday". */
  edition?: EditionName;
  /** Changes the fresh Chinese draft in place, or returns a replacement (a value past the schema is written as is). */
  mutate: (draft: DraftZh) => unknown;
}

/** One Chinese S fixture: a mutation of an edition's valid Chinese draft that passes `validateZh()` with no error and exactly one warning (every ZH_ code is hard, so none exists today). */
export interface ZhSoftCase {
  code: string;
  /** `soft--<CODE>.zh.json`, written to fixtures/drafts-zh/. */
  file: string;
  edition?: EditionName;
  mutate: (draft: DraftZh) => unknown;
}

/** One Chinese T fixture: a named case for a check the weekday Chinese draft cannot reach, run by the tests, never written to fixtures/. */
export interface ZhNamedCase {
  /** A short unique description, such as "Sunday deep dive over its cap". */
  name: string;
  /** The code the case is about: among `expect.errors` unless the case passes (then `expect` holds neither list's codes). */
  code: string;
  edition: EditionName;
  mutate: (draft: DraftZh) => unknown;
  /** The exact result of `validateZh()`: the set of error codes and the set of warning codes, each in sorted order. */
  expect: { errors: readonly string[]; warnings: readonly string[] };
}

// ── Small helpers (each throws when the sample changes, so a case never changes nothing) ─────────

/** The Chinese string of a key; throws when the draft lacks it. */
function textOf(d: DraftZh, key: string): string {
  const s = d.strings[key];
  if (s === undefined) throw new Error(`The Chinese draft has no string ${key}`);
  return s;
}

/** Replaces the first `from` in the string of `key` with `to`; throws when the string lacks `from`. */
function replaceIn(d: DraftZh, key: string, from: string, to: string): void {
  const s = textOf(d, key);
  if (!s.includes(from)) throw new Error(`${key} does not hold ${from}`);
  d.strings[key] = s.replace(from, to);
}

/** Adds `extra` at the end of the string of `key`. */
function appendTo(d: DraftZh, key: string, extra: string): void {
  d.strings[key] = textOf(d, key) + extra;
}

/** A term of the draft by id; throws when the draft lacks it. */
function termOf(d: DraftZh, id: string): DraftZhTerm {
  const t = d.terms[id];
  if (t === undefined) throw new Error(`The Chinese draft has no term ${id}`);
  return t;
}

/** A term's `official_url`; throws when the term has none, so a case adds to a real address. */
function officialUrlOf(d: DraftZh, id: string): string {
  const url = termOf(d, id).official_url;
  if (url === null) throw new Error(`The term ${id} has no official_url`);
  return url;
}

/** Throws unless the string of `key` counts `n` characters (SPEC §4.1's length): a boundary case states the count it is about. */
function expectCount(d: DraftZh, key: string, n: number): void {
  const got = countZhChars(textOf(d, key));
  if (got !== n) throw new Error(`${key} counts ${got} characters, not ${n}`);
}

/** The set of codes a case must give: one error code, and no other error and no warning. */
const only = (code: string) => ({ errors: [code], warnings: [] as string[] });
/** A case that fails with these error codes (in sorted order) and has no warning. */
const fails = (...codes: string[]) => ({ errors: [...codes].sort(), warnings: [] as string[] });
/** A case that passes with no error and no warning. */
const passes = { errors: [] as string[], warnings: [] as string[] };

/** A character by its code point: no dash is ever typed in this file. */
const chr = (cp: number): string => String.fromCodePoint(cp);
const EM = chr(0x2014);
const EN = chr(0x2013);

// ── The strings the cases add ────────────────────────────────────────────────────────────────────

/** A string shaped like SECRET_LIKE's `sk-` pattern, joined at run time so no secret-shaped literal sits in this file. It matches no provider's real key. */
function sampleSecret(): string {
  return ["s", "k", "-"].join("") + "UTSAMPLE".repeat(3);
}

/** An address on BLOCKED_HOSTS (a link shortener) with an invented path, as the English BLOCKED_HOST case writes it. */
const BLOCKED_ADDRESS = "https://t.co/ut-sample-idea";

/** The calendar day before `date` ("2026-10-14" gives "2026-10-13"), as a date string. */
function dayBefore(date: string): string {
  return taipeiTimestamp(new Date(Date.parse(`${date}T12:00:00+08:00`) - 86_400_000)).slice(0, 10);
}

/** The calendar day after `date`. */
function dayAfter(date: string): string {
  return taipeiTimestamp(new Date(Date.parse(`${date}T12:00:00+08:00`) + 86_400_000)).slice(0, 10);
}

/** `at` (a Taipei timestamp) moved by `seconds`, as a Taipei timestamp. */
function secondsFrom(at: string, seconds: number): string {
  return taipeiTimestamp(new Date(Date.parse(at) + seconds * 1000));
}

/** A made-up sentence of the kind DUAL_USE refuses, in Chinese characters alone: it names an agent (炭疽) and a procedure (合成路徑), says it is an example and gives no method. */
const AGENT_PROCEDURE_ZH = "範例句子，僅供測試：它提到炭疽和合成路徑。";

/** Twenty-four letters of the four nucleotide letters in repeats: made up, and no organism's sequence. */
const NUCLEOTIDE_SAMPLE = "acgtacgtacgtacgtacgtacgt";

/** The twelve characters that Taiwan writes and that a mainland or Japanese list could mistake for its own (台 後 裡 面 乾 係 隻 準 制 才 了 勝), in three plain sentences. */
const TAIWAN_FORMS = "台灣的團隊後來才加入。樣本裡面有一隻小鼠，乾燥後準時送出。係數制約結果，最後勝出了。";

/** One plain sentence that only fills a string to a limit: 13 characters by `countZhChars()`, no number, no Latin word, no term. */
const FILLER = "這段說明文字用來測試字數上限。";

/** `FILLER` written `times` times in a row. */
const filler = (times: number): string => FILLER.repeat(times);

// ── F: one mutation of the weekday draft per code ────────────────────────────────────────────────

export const zhCases: readonly ZhInvalidCase[] = [
  {
    // A string the pass left empty: the schema wants at least one character in every string, so nothing but SCHEMA is judged.
    code: "SCHEMA", file: "invalid--SCHEMA.zh.json",
    mutate: (d) => {
      textOf(d, "also.1");
      d.strings["also.1"] = "";
    },
  },
  {
    // The draft's date is the day before the context's (the weekday's is 2026-10-14): the pass wrote the date of the news, not the edition's.
    code: "DATE_MISMATCH", file: "invalid--DATE_MISMATCH.zh.json",
    mutate: (d) => {
      d.date = dayBefore(d.date);
    },
  },
  {
    // A sentence that names an agent and a procedure, in Chinese characters alone, at the end of a correction's after.
    code: "DUAL_USE", file: "invalid--DUAL_USE.zh.json",
    mutate: (d) => {
      appendTo(d, "corrections.0.after", AGENT_PROCEDURE_ZH);
    },
  },
  {
    // A string shaped like an `sk-` key in the fragment of a term's official_url.
    code: "SECRET_LIKE", file: "invalid--SECRET_LIKE.zh.json",
    mutate: (d) => {
      const term = termOf(d, "numerical-weather-prediction");
      term.official_url = `${officialUrlOf(d, "numerical-weather-prediction")}#${sampleSecret()}`;
    },
  },
  {
    // The canary token in the fragment of a term's official_url: an instruction in a page was followed.
    code: "CANARY", file: "invalid--CANARY.zh.json",
    mutate: (d) => {
      const term = termOf(d, "antimicrobial-resistance");
      term.official_url = `${officialUrlOf(d, "antimicrobial-resistance")}#${CANARY_TOKEN}`;
    },
  },
  {
    // A link-shortener address (t.co, a host on BLOCKED_HOSTS) after the fragment mark of a term's official_url: the page is still the one the pass fetched.
    code: "BLOCKED_HOST", file: "invalid--BLOCKED_HOST.zh.json",
    mutate: (d) => {
      const term = termOf(d, "numerical-weather-prediction");
      term.official_url = `${officialUrlOf(d, "numerical-weather-prediction")}#${BLOCKED_ADDRESS}`;
    },
  },
  {
    // A key of the context is missing from `strings`: the last Also noted line.
    code: "ZH_KEYS", file: "invalid--ZH_KEYS.zh.json",
    mutate: (d) => {
      textOf(d, "also.1");
      delete d.strings["also.1"];
    },
  },
  {
    // One digit of the story's first part changed: 1,800 letters become 1,900.
    code: "ZH_PARITY", file: "invalid--ZH_PARITY.zh.json",
    mutate: (d) => {
      replaceIn(d, "new.new-1.explainer.found", "1,800", "1,900");
    },
  },
  {
    // 審 written in its simplified form: a character of `simplified_only`, in an idea line no fixed term depends on.
    code: "ZH_TRADITIONAL", file: "invalid--ZH_TRADITIONAL.zh.json",
    mutate: (d) => {
      replaceIn(d, "ideas.0", "審查", "审查");
    },
  },
  {
    // 算法 on its own (the spec's example), where 演算法 would pass: an idea line that no fixed translation covers.
    code: "ZH_AVOID", file: "invalid--ZH_AVOID.zh.json",
    mutate: (d) => {
      replaceIn(d, "ideas.1", "AI 工具", "AI 算法");
    },
  },
  {
    // The Also noted line about a dataset says 資料庫 where the fixed translation of "dataset" is 資料集.
    code: "ZH_TERMS", file: "invalid--ZH_TERMS.zh.json",
    mutate: (d) => {
      replaceIn(d, "also.1", "資料集", "資料庫");
    },
  },
  {
    // An item's how_sure whose English starts with the rung's label (Checked.) starts with a fresh translation (已查證) instead of 已查核.
    code: "ZH_RUNG_LABEL", file: "invalid--ZH_RUNG_LABEL.zh.json",
    mutate: (d) => {
      replaceIn(d, "new.new-3.explainer.how_sure", "已查核。", "已查證。");
    },
  },
  {
    // The first use of a story term loses its English in full-width brackets.
    code: "ZH_ENGLISH_ONCE", file: "invalid--ZH_ENGLISH_ONCE.zh.json",
    mutate: (d) => {
      replaceIn(d, "new.new-1.explainer.found", "（papyrus）", "");
    },
  },
  {
    // The story's title goes past its 22 characters (the spec's cap, ceil(12 words x 1.8)), by a clause that adds no number and no Latin word.
    code: "ZH_CHARS", file: "invalid--ZH_CHARS.zh.json",
    mutate: (d) => {
      appendTo(d, "new.new-1.title", "，而且卷軸完好無損");
    },
  },
  {
    // A term's official name is not the one on the page the pass fetched (預報 written as 預測): host and page are right, the text is not on it.
    code: "ZH_OFFICIAL", file: "invalid--ZH_OFFICIAL.zh.json",
    mutate: (d) => {
      const term = termOf(d, "numerical-weather-prediction");
      if (term.official === null) throw new Error("The term numerical-weather-prediction has no official");
      term.official = "數值天氣預測";
    },
  },
  {
    // A doubled Chinese dash in the middle of an Also noted line.
    code: "ZH_NO_DASH", file: "invalid--ZH_NO_DASH.zh.json",
    mutate: (d) => {
      replaceIn(d, "also.0", "預測", `預測${EM}${EM}`);
    },
  },
  {
    // 重大突破 in a Major finding's how_sure: 突破 stands only in a Landmark's text.
    code: "ZH_HYPE", file: "invalid--ZH_HYPE.zh.json",
    mutate: (d) => {
      appendTo(d, "new.new-2.explainer.how_sure", "這是重大突破。");
    },
  },
];

// ── S: none ──────────────────────────────────────────────────────────────────────────────────────

export const zhSoft: readonly ZhSoftCase[] = [];

// ── T: named cases ───────────────────────────────────────────────────────────────────────────────

/** The weekday Landmark's text, as the Chinese pass translates it: the story, a Landmark when published. */
const LANDMARK_MATTERS = "new.new-1.explainer.matters";

/** The dashes ZH_NO_DASH refuses, each written between two Han characters of an Also noted line, with the code point it names. */
const REFUSED_DASHES: readonly (readonly [string, number])[] = [
  ["a single em dash", 0x2014], ["a horizontal bar", 0x2015], ["a two-em dash", 0x2e3a], ["a small em dash", 0xfe58], ["a full-width hyphen-minus", 0xff0d],
  ["an en dash between Han characters", 0x2013], ["a box-drawing light line", 0x2500], ["a box-drawing heavy line", 0x2501],
];

/** The hyphens and marks ZH_NO_DASH lets through, each inside a bracketed phrase of words the English line holds (so ZH_PARITY lets it through too). */
const ALLOWED_MARKS: readonly (readonly [string, number])[] = [
  ["a hyphen-minus", 0x002d], ["a hyphen", 0x2010], ["a non-breaking hyphen", 0x2011], ["a minus sign", 0x2212],
];

/**
 * DATE_MISMATCH's named cases for one edition (SPEC §4.12): the draft's `date` is the context's; its `generated_at` lies between the
 * English draft's own (the Chinese pass starts after that draft validated) and the Chinese context's deadline, both ends inclusive. The
 * file-name test needs a file and so is the tests' (tests/rules-structure.test.ts, tests/validate-zh.test.ts).
 */
function dateCases(edition: EditionName): ZhNamedCase[] {
  const english = EDITIONS[edition].generatedAt;
  const { deadline } = ZH_CLOCK[edition];
  const at = (when: string) => (d: DraftZh) => {
    d.generated_at = when;
  };
  return [
    { name: `DATE_MISMATCH: ${edition}: a generated_at one second before the English draft's`, code: "DATE_MISMATCH", edition, mutate: at(secondsFrom(english, -1)), expect: only("DATE_MISMATCH") },
    { name: `DATE_MISMATCH: ${edition}: a generated_at exactly the English draft's`, code: "DATE_MISMATCH", edition, mutate: at(english), expect: passes },
    { name: `DATE_MISMATCH: ${edition}: a generated_at exactly the deadline`, code: "DATE_MISMATCH", edition, mutate: at(deadline), expect: passes },
    { name: `DATE_MISMATCH: ${edition}: a generated_at one second after the deadline`, code: "DATE_MISMATCH", edition, mutate: at(secondsFrom(deadline, 1)), expect: only("DATE_MISMATCH") },
    {
      name: `DATE_MISMATCH: ${edition}: a date the day after the context's`, code: "DATE_MISMATCH", edition,
      mutate: (d) => {
        d.date = dayAfter(d.date);
      },
      expect: only("DATE_MISMATCH"),
    },
  ];
}

export const zhNamed: readonly ZhNamedCase[] = [
  // ── SCHEMA: a Chinese draft past its schema is judged by SCHEMA alone, and no rule reads it ──
  {
    name: "SCHEMA: a key the schema does not have", code: "SCHEMA", edition: "weekday",
    mutate: (d) => ({ ...d, notes: "SAMPLE：多出來的欄位" }),
    expect: only("SCHEMA"),
  },
  {
    name: "SCHEMA: a schema_version the schema does not know", code: "SCHEMA", edition: "weekday",
    mutate: (d) => ({ ...d, schema_version: 2 }),
    expect: only("SCHEMA"),
  },
  {
    name: "SCHEMA: a generated_at that holds no time", code: "SCHEMA", edition: "weekday",
    mutate: (d) => ({ ...d, generated_at: d.date }),
    expect: only("SCHEMA"),
  },
  {
    name: "SCHEMA: strings written as a list instead of a record", code: "SCHEMA", edition: "weekday",
    mutate: (d) => ({ ...d, strings: Object.values(d.strings) }),
    expect: only("SCHEMA"),
  },
  {
    name: "SCHEMA: a term whose official is a number", code: "SCHEMA", edition: "weekday",
    mutate: (d) => {
      Object.assign(termOf(d, "papyrus"), { official: 5 });
    },
    expect: only("SCHEMA"),
  },
  {
    name: "SCHEMA: a draft with a text fault as well is judged by SCHEMA alone", code: "SCHEMA", edition: "weekday",
    mutate: (d) => {
      d.strings["also.1"] = "";
      replaceIn(d, "ideas.0", "審查", "审查");
    },
    expect: only("SCHEMA"),
  },

  // ── DATE_MISMATCH: the date and the time of the pass, in each edition ──
  ...EDITION_NAMES.flatMap(dateCases),

  // ── BLOCKED_HOST: a Chinese string, a term's own text and its address are read ──
  {
    name: "BLOCKED_HOST: an address in an Also noted line", code: "BLOCKED_HOST", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", ` ${BLOCKED_ADDRESS}`);
    },
    expect: fails("BLOCKED_HOST", "ZH_PARITY"),
  },
  {
    name: "BLOCKED_HOST: an address that is the whole official_url of a term", code: "BLOCKED_HOST", edition: "weekday",
    mutate: (d) => {
      termOf(d, "numerical-weather-prediction").official_url = BLOCKED_ADDRESS;
    },
    expect: fails("BLOCKED_HOST", "ZH_OFFICIAL"),
  },
  {
    name: "BLOCKED_HOST: a page of the term bank with no address in its fragment", code: "BLOCKED_HOST", edition: "weekday",
    mutate: (d) => {
      const term = termOf(d, "numerical-weather-prediction");
      term.official_url = `${officialUrlOf(d, "numerical-weather-prediction")}#ut-sample`;
    },
    expect: passes,
  },

  // ── ZH_KEYS ──
  {
    name: "ZH_KEYS: an extra string key", code: "ZH_KEYS", edition: "weekday",
    mutate: (d) => {
      d.strings["also.2"] = "SAMPLE：多出來的一行";
    },
    expect: only("ZH_KEYS"),
  },
  {
    name: "ZH_KEYS: a missing term", code: "ZH_KEYS", edition: "weekday",
    mutate: (d) => {
      termOf(d, "cryo-electron-microscopy");
      delete d.terms["cryo-electron-microscopy"];
    },
    expect: only("ZH_KEYS"),
  },
  {
    name: "ZH_KEYS: an extra term", code: "ZH_KEYS", edition: "weekday",
    mutate: (d) => {
      d.terms["extra-term"] = { zh: "額外詞彙", definition: "多出來的詞彙。", official: null, official_url: null };
    },
    expect: only("ZH_KEYS"),
  },
  {
    name: "ZH_KEYS: a short Monday has no strongest_against key, so a string there is an extra key", code: "ZH_KEYS", edition: "monday-short",
    mutate: (d) => {
      d.strings["review.strongest_against"] = "SAMPLE：沒有找到反對的證據";
    },
    expect: only("ZH_KEYS"),
  },

  // ── ZH_PARITY ──
  {
    name: "ZH_PARITY: an English number missing from the Chinese", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "new.new-1.explainer.found", "約 1,800 個", "許多");
    },
    expect: only("ZH_PARITY"),
  },
  {
    name: "ZH_PARITY: a percentage written as a plain number", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "backlog.earth-2026-0141.explainer.found", "12%", "12");
    },
    expect: only("ZH_PARITY"),
  },
  {
    name: "ZH_PARITY: full-width digits and a full-width percent sign count as ASCII ones", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "backlog.earth-2026-0141.explainer.found", "12%", "１２％");
    },
    expect: passes,
  },
  {
    name: "ZH_PARITY: a number added to a term's definition", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      const term = termOf(d, "papyrus");
      term.definition = "用紙莎草製成的書寫紙張，約 3,000 年前用於古代地中海世界。";
    },
    expect: only("ZH_PARITY"),
  },
  {
    name: "ZH_PARITY: a URL in a string", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", " https://example.org/page");
    },
    expect: only("ZH_PARITY"),
  },
  {
    name: "ZH_PARITY: a Latin word the English lacks", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", " Tsunami");
    },
    expect: only("ZH_PARITY"),
  },
  {
    name: "ZH_PARITY: a bracketed English phrase that is no term of the context and that the English lacks is a Latin word that counts", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", "（Tsunami）");
    },
    expect: only("ZH_PARITY"),
  },
  {
    name: "ZH_PARITY: the English name of a term of the context in brackets, where the English line does not hold it, passes", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", "（papyrus）");
    },
    expect: passes,
  },
  {
    name: "ZH_PARITY: a bracketed English word that the English line also holds passes", code: "ZH_PARITY", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", "（monsoon）");
    },
    expect: passes,
  },

  // ── ZH_TRADITIONAL ──
  {
    name: "ZH_TRADITIONAL: a Japanese-only character", code: "ZH_TRADITIONAL", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "also.0", "季風降雨", "季風圏降雨");
    },
    expect: only("ZH_TRADITIONAL"),
  },
  {
    name: "ZH_TRADITIONAL: a simplified-only character in a term's definition", code: "ZH_TRADITIONAL", edition: "weekday",
    mutate: (d) => {
      const term = termOf(d, "proof-assistant");
      if (!term.definition.includes("邏輯")) throw new Error("The definition of proof-assistant changed");
      term.definition = term.definition.replace("邏輯", "逻辑");
    },
    expect: only("ZH_TRADITIONAL"),
  },
  {
    name: "ZH_TRADITIONAL: the characters Taiwan writes pass (台 後 裡 面 乾 係 隻 準 制 才 了 勝)", code: "ZH_TRADITIONAL", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "corrections.0.after", TAIWAN_FORMS);
    },
    expect: passes,
  },

  // ── ZH_AVOID ──
  {
    name: "ZH_AVOID: 演算法, 納米比亞 and 電視頻道 pass", code: "ZH_AVOID", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "corrections.0.after", "範例句子：演算法、納米比亞和電視頻道都是正常的用詞。");
    },
    expect: passes,
  },
  {
    name: "ZH_AVOID: an avoid term in a term's definition", code: "ZH_AVOID", edition: "weekday",
    mutate: (d) => {
      const term = termOf(d, "proof-assistant");
      if (!term.definition.includes("電腦程式")) throw new Error("The definition of proof-assistant changed");
      term.definition = term.definition.replace("電腦程式", "電腦軟件");
    },
    expect: only("ZH_AVOID"),
  },
  {
    name: "ZH_AVOID: 軟件 where the fixed translation of software is 軟體 fails the fixed term as well", code: "ZH_AVOID", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "new.new-1.explainer.ai_helped", "軟體", "軟件");
    },
    expect: fails("ZH_AVOID", "ZH_TERMS"),
  },

  // ── ZH_TERMS ──
  {
    name: "ZH_TERMS: a fixed entry that holds in one field only (proof, mathematics) applies in a mathematics finding", code: "ZH_TERMS", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "new.new-4.title", "宣稱證明了", "宣稱解決了");
    },
    expect: only("ZH_TERMS"),
  },
  {
    name: "ZH_TERMS: that entry does not apply to an idea line, which belongs to no finding", code: "ZH_TERMS", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "ideas.0", "每一份投稿的證明", "每一份投稿");
    },
    expect: passes,
  },
  {
    name: "ZH_TERMS: a term whose name and definition lack the fixed translation (and whose name is no longer in the explainer)", code: "ZH_TERMS", edition: "weekday",
    mutate: (d) => {
      const term = termOf(d, "papyrus");
      term.zh = "古埃及紙";
      term.definition = "用紙草製成的書寫紙張，用於古代地中海世界。";
    },
    expect: fails("ZH_ENGLISH_ONCE", "ZH_TERMS"),
  },

  // ── ZH_RUNG_LABEL ──
  {
    name: "ZH_RUNG_LABEL: a correction's after on how_sure", code: "ZH_RUNG_LABEL", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "corrections.1.after", "已應用。", "已實際應用。");
    },
    expect: only("ZH_RUNG_LABEL"),
  },
  {
    name: "ZH_RUNG_LABEL: a backlog finding's how_sure without its label", code: "ZH_RUNG_LABEL", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "backlog.bio-2026-0143.explainer.how_sure", "已查核。", "");
    },
    expect: only("ZH_RUNG_LABEL"),
  },
  {
    name: "ZH_RUNG_LABEL: the label is there but not at the start", code: "ZH_RUNG_LABEL", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "new.new-4.explainer.how_sure", "預印本。", "這是預印本。");
    },
    expect: only("ZH_RUNG_LABEL"),
  },
  {
    name: "ZH_RUNG_LABEL: a fresh translation of Claimed (聲稱 for 宣稱)", code: "ZH_RUNG_LABEL", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "backlog.soc-2026-0145.explainer.how_sure", "宣稱。", "聲稱。");
    },
    expect: only("ZH_RUNG_LABEL"),
  },

  // ── ZH_ENGLISH_ONCE ──
  {
    name: "ZH_ENGLISH_ONCE: a later use with the English in brackets again", code: "ZH_ENGLISH_ONCE", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "new.new-1.explainer.background", "莎草紙卷軸", "莎草紙（papyrus）卷軸");
    },
    expect: only("ZH_ENGLISH_ONCE"),
  },
  {
    name: "ZH_ENGLISH_ONCE: the English term in brackets in a title", code: "ZH_ENGLISH_ONCE", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "new.new-1.title", "密封卷軸", "密封莎草紙（papyrus）卷軸");
    },
    expect: only("ZH_ENGLISH_ONCE"),
  },
  {
    name: "ZH_ENGLISH_ONCE: a term the finding lists that its Chinese explainer never uses", code: "ZH_ENGLISH_ONCE", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "new.new-1.explainer.ai_helped", "稱為虛擬展開（virtual unwrapping）", "稱為展開");
    },
    expect: only("ZH_ENGLISH_ONCE"),
  },
  {
    name: "ZH_ENGLISH_ONCE: a backlog finding's first use without its brackets", code: "ZH_ENGLISH_ONCE", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "backlog.bio-2026-0143.explainer.matters", "（antimicrobial resistance）", "");
    },
    expect: only("ZH_ENGLISH_ONCE"),
  },
  {
    name: "ZH_ENGLISH_ONCE: half-width brackets at the first use", code: "ZH_ENGLISH_ONCE", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "new.new-1.explainer.found", "（papyrus）", "(papyrus)");
    },
    expect: only("ZH_ENGLISH_ONCE"),
  },

  // ── ZH_CHARS ──
  {
    name: "ZH_CHARS: a title at exactly its cap passes", code: "ZH_CHARS", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "new.new-1.title", "，而且完好無損");
      expectCount(d, "new.new-1.title", 22);
    },
    expect: passes,
  },
  {
    name: "ZH_CHARS: a title one over its cap", code: "ZH_CHARS", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "new.new-1.title", "，而且仍完好無損");
      expectCount(d, "new.new-1.title", 23);
    },
    expect: only("ZH_CHARS"),
  },
  {
    name: "ZH_CHARS: the Lead's sentences are each within their cap and together over the group's 108", code: "ZH_CHARS", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "lead.0", filler(3));
    },
    expect: only("ZH_CHARS"),
  },
  {
    name: "ZH_CHARS: one story part over its own cap while the six parts stay within 504", code: "ZH_CHARS", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "new.new-1.explainer.background", filler(2));
    },
    expect: only("ZH_CHARS"),
  },
  {
    name: "ZH_CHARS: a backlog item's four parts together over the group's 180, each within its own cap", code: "ZH_CHARS", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "backlog.soc-2026-0144.explainer.found", filler(4));
    },
    expect: only("ZH_CHARS"),
  },
  {
    name: "ZH_CHARS: a term's definition over its context cap of 72", code: "ZH_CHARS", edition: "weekday",
    mutate: (d) => {
      const term = termOf(d, "papyrus");
      term.definition += filler(5);
    },
    expect: only("ZH_CHARS"),
  },
  {
    name: "ZH_CHARS: a correction's after over its flat 300", code: "ZH_CHARS", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "corrections.0.after", filler(19));
    },
    expect: only("ZH_CHARS"),
  },
  {
    name: "ZH_CHARS: a Sunday deep dive over its 990", code: "ZH_CHARS", edition: "sunday",
    mutate: (d) => {
      appendTo(d, "deep_dive", filler(12));
    },
    expect: only("ZH_CHARS"),
  },
  {
    name: "ZH_CHARS: a Monday's big picture over its 594", code: "ZH_CHARS", edition: "monday",
    mutate: (d) => {
      appendTo(d, "review.big_picture", filler(3));
    },
    expect: only("ZH_CHARS"),
  },
  {
    name: "ZH_CHARS: a short Monday's big picture over the context's 216 although far under 594", code: "ZH_CHARS", edition: "monday-short",
    mutate: (d) => {
      appendTo(d, "review.big_picture", filler(8));
    },
    expect: only("ZH_CHARS"),
  },

  // ── ZH_OFFICIAL ──
  {
    name: "ZH_OFFICIAL: an address on another host", code: "ZH_OFFICIAL", edition: "weekday",
    mutate: (d) => {
      termOf(d, "antimicrobial-resistance").official_url = "https://example.org/detail/ut-sample-0101/";
    },
    expect: only("ZH_OFFICIAL"),
  },
  {
    name: "ZH_OFFICIAL: a lookalike host that starts with terms.naer.edu.tw", code: "ZH_OFFICIAL", edition: "weekday",
    mutate: (d) => {
      termOf(d, "antimicrobial-resistance").official_url = "https://terms.naer.edu.tw.example.org/detail/ut-sample-0101/";
    },
    expect: only("ZH_OFFICIAL"),
  },
  {
    name: "ZH_OFFICIAL: a page on the right host that the pass never fetched", code: "ZH_OFFICIAL", edition: "weekday",
    mutate: (d) => {
      termOf(d, "antimicrobial-resistance").official_url = "https://terms.naer.edu.tw/detail/ut-sample-0199/";
    },
    expect: only("ZH_OFFICIAL"),
  },
  {
    name: "ZH_OFFICIAL: an official without an official_url", code: "ZH_OFFICIAL", edition: "weekday",
    mutate: (d) => {
      termOf(d, "antimicrobial-resistance").official_url = null;
    },
    expect: only("ZH_OFFICIAL"),
  },
  {
    name: "ZH_OFFICIAL: a stray address of another host on a term whose official is null", code: "ZH_OFFICIAL", edition: "weekday",
    mutate: (d) => {
      termOf(d, "cryo-electron-microscopy").official_url = "https://example.org/stray";
    },
    expect: only("ZH_OFFICIAL"),
  },
  {
    name: "ZH_OFFICIAL: a stray address on the host on a term whose official is null passes", code: "ZH_OFFICIAL", edition: "weekday",
    mutate: (d) => {
      termOf(d, "cryo-electron-microscopy").official_url = "https://terms.naer.edu.tw/detail/ut-sample-0101/";
    },
    expect: passes,
  },

  // ── ZH_NO_DASH ──
  ...REFUSED_DASHES.map(([what, cp]): ZhNamedCase => ({
    name: `ZH_NO_DASH: ${what} (U+${cp.toString(16).toUpperCase().padStart(4, "0")}) in a string`, code: "ZH_NO_DASH", edition: "weekday",
    mutate: (d) => {
      replaceIn(d, "also.1", "古代銘文", `古代${chr(cp)}銘文`);
    },
    expect: only("ZH_NO_DASH"),
  })),
  {
    name: "ZH_NO_DASH: an en dash between two digits passes", code: "ZH_NO_DASH", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "backlog.bio-2026-0143.explainer.found", `（8${EN}10）`);
    },
    expect: passes,
  },
  ...ALLOWED_MARKS.map(([what, cp]): ZhNamedCase => ({
    name: `ZH_NO_DASH: ${what} (U+${cp.toString(16).toUpperCase().padStart(4, "0")}) passes`, code: "ZH_NO_DASH", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", `（model${chr(cp)}rainfall）`);
    },
    expect: passes,
  })),
  {
    name: "ZH_NO_DASH: a dash in a term's definition", code: "ZH_NO_DASH", edition: "weekday",
    mutate: (d) => {
      termOf(d, "papyrus").definition = `用紙莎草製成的書寫紙張${EM}用於古代地中海世界。`;
    },
    expect: only("ZH_NO_DASH"),
  },

  // ── ZH_HYPE ──
  {
    name: "ZH_HYPE: 突破 stands in a Landmark finding's own text", code: "ZH_HYPE", edition: "weekday",
    mutate: (d) => {
      appendTo(d, LANDMARK_MATTERS, "這是重大突破。");
    },
    expect: passes,
  },
  {
    name: "ZH_HYPE: 革命性 is refused even in a Landmark finding's text", code: "ZH_HYPE", edition: "weekday",
    mutate: (d) => {
      appendTo(d, LANDMARK_MATTERS, "這是革命性的方法。");
    },
    expect: only("ZH_HYPE"),
  },
  {
    name: "ZH_HYPE: 突破獎委員會 passes in a Major finding's how_sure", code: "ZH_HYPE", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "new.new-2.explainer.how_sure", "突破獎委員會沒有參與。");
    },
    expect: passes,
  },
  {
    name: "ZH_HYPE: 突破 in the Lead, which is no finding's text", code: "ZH_HYPE", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "lead.0", "這是重大突破。");
    },
    expect: only("ZH_HYPE"),
  },
  {
    name: "ZH_HYPE: a hype word in a term's definition", code: "ZH_HYPE", edition: "weekday",
    mutate: (d) => {
      termOf(d, "papyrus").definition = "用紙莎草製成的神奇書寫紙張，用於古代地中海世界。";
    },
    expect: only("ZH_HYPE"),
  },
  {
    name: "ZH_HYPE: 突破 in a Sunday's deep dive on a Major finding", code: "ZH_HYPE", edition: "sunday",
    mutate: (d) => {
      appendTo(d, "deep_dive", "這是重大突破。");
    },
    expect: only("ZH_HYPE"),
  },
  {
    name: "ZH_HYPE: 突破 in a Monday's remarkable note on a Major finding", code: "ZH_HYPE", edition: "monday",
    mutate: (d) => {
      replaceIn(d, "review.remarkable", "。", "，是突破。");
    },
    expect: only("ZH_HYPE"),
  },

  // ── The safety group's rules, which also read the Chinese draft ──
  {
    name: "DUAL_USE: a lower-case nucleotide sequence in brackets, which is also a Latin word that no term or English line holds", code: "DUAL_USE", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", `（${NUCLEOTIDE_SAMPLE}）`);
    },
    expect: fails("DUAL_USE", "ZH_PARITY"),
  },
  {
    name: "CANARY: the canary token in a bracketed term of a string also breaks parity, by its digits", code: "CANARY", edition: "weekday",
    mutate: (d) => {
      appendTo(d, "also.0", `（${CANARY_TOKEN}）`);
    },
    expect: fails("CANARY", "ZH_PARITY"),
  },
];
