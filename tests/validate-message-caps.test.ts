// What a result prints of a draft's own text (SPEC §4.12; F-52). A draft is untrusted, and no key or value of it is limited, so a message
// that quotes one whole could print a line as long as the draft: a hostile draft with a 5 MB key would give a 5 MB line. The rules
// and the SCHEMA builder quote through `shown()` (120 characters), a schema's own message is cut at SCHEMA_MESSAGE_MAX, and
// `toResult()` bounds the place, the message and the hint of every issue it holds (RESULT_PATH_MAX, RESULT_MESSAGE_MAX), as the net
// under a place that no rule thought of. These tests feed a 5 MB key and a 5 MB value to each place found (an unknown key of either
// draft, a subfield, a correction's path, a string key of the Chinese draft, a Chinese number, link and Latin word, a term's Chinese,
// its official and its official_url) and check that the message is short, still says what is wrong, and that nothing else changed.
//
// New for this project; Cyber's CLI printed what the validator gave it.

import { describe, expect, it, vi } from "vitest";
import { subfieldIssue } from "@/lib/rules/history";
import { shown } from "@/lib/rules/shared";
import { error, warning, type ValidationIssue } from "@/lib/rules/types";
import { RESULT_MESSAGE_MAX, RESULT_PATH_MAX, SCHEMA_MESSAGE_MAX, schemaIssues, toResult, validateDraft } from "@/lib/validate";
import { DraftBrief } from "@/lib/schema/draft";
import { Evidence } from "@/lib/schema/misc";
import { validateZh } from "@/lib/validate-zh";
import { config, draftInputs, weekdayDraft, type Json } from "./helpers/rule-world";
import { OFFICIAL_URL, inputsOf, setZh, zhWorld, type ZhWorld } from "./helpers/zh-world";

// A hostile draft is read in whole by every rule: a case with 5 MB in it takes seconds on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

/** 5 MB of one letter, as a key or a value. */
const BIG = "k".repeat(5_000_000);
/** What the draft's text becomes in a message: its first 117 characters and three dots. */
const SHORT = `${"k".repeat(117)}...`;
/** Longer than any message needs to be, and far shorter than the draft's text. */
const A_FEW_HUNDRED = 700;

const draftOf = (change: (d: Json) => void): unknown => {
  const d = structuredClone(weekdayDraft()) as Json;
  change(d);
  return d;
};
const english = (change: (d: Json) => void): ValidationIssue[] => validateDraft(draftOf(change), draftInputs()).issues;
const zhRun = (w: ZhWorld): ValidationIssue[] => validateZh(w.draft, w.english, inputsOf(w)).issues;
const only = (issues: readonly ValidationIssue[], code: string): ValidationIssue[] => issues.filter((i) => i.code === code);

/** Every issue: the place, the message and the hint within bounds, and none of the draft's text whole. */
function expectShort(issues: readonly ValidationIssue[], label: string): void {
  expect(issues.length, label).toBeGreaterThan(0);
  for (const i of issues) {
    expect(i.path.length, `${label}: path of ${i.code}`).toBeLessThanOrEqual(RESULT_PATH_MAX);
    expect(i.message.length, `${label}: message of ${i.code}`).toBeLessThanOrEqual(A_FEW_HUNDRED);
    expect((i.hint ?? "").length, `${label}: hint of ${i.code}`).toBeLessThanOrEqual(A_FEW_HUNDRED);
  }
}

describe("the limits", () => {
  it("are a schema message of 400 characters, an issue's place of 400 and its message and hint of 1000: above any message a rule writes", () => {
    expect([SCHEMA_MESSAGE_MAX, RESULT_PATH_MAX, RESULT_MESSAGE_MAX]).toEqual([400, 400, 1000]);
  });
});

describe("the English draft's issues quote what the draft holds through shown()", () => {
  it("prints an unknown key of the draft shortened, in the message and in the place: a 5 MB key at the top, and in a finding", () => {
    const top = english((d) => { d[BIG] = 1; });
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ code: "SCHEMA", message: `Unknown key "${SHORT}"; remove it.` });
    expect(top[0]!.path.length).toBeLessThanOrEqual(RESULT_PATH_MAX);
    const nested = english((d) => { d.new_findings[0][BIG] = 1; });
    expect(nested[0]).toMatchObject({ code: "SCHEMA", message: `Unknown key "${SHORT}"; remove it.` });
    expect(nested[0]!.path.startsWith("new_findings[0]")).toBe(true);
    expectShort(top, "top");
    expectShort(nested, "nested");
  });

  it("prints a short unknown key whole, in the message and the place, as before", () => {
    const issues = english((d) => { d.extra_key = 1; });
    expect(issues).toEqual([error("SCHEMA", "extra_key", 'Unknown key "extra_key"; remove it.', expect.any(String))]);
  });

  it("prints a 5 MB subfield shortened in SUBFIELD_UNKNOWN, with the ids the field lists", () => {
    const issues = only(english((d) => { d.new_findings[0].subfield = BIG; }), "SUBFIELD_UNKNOWN");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message.startsWith(`Subfield "${SHORT}" of new-1 is not one of `)).toBe(true);
    expect(issues[0]!.message.endsWith("Use one of biology's ids exactly as written.")).toBe(true);
    expectShort(issues, "subfield");
  });

  it("prints a 5 MB subfield and a 5 MB field shortened where a seed gives a value that is no field (subfieldIssue() is the seed validator's too)", () => {
    const issue = subfieldIssue(config(), BIG, BIG, "seeds[0].subfield", "of seed 0")!;
    expect(issue.code).toBe("SUBFIELD_UNKNOWN");
    expect(issue.message.startsWith(`Subfield "${SHORT}" of seed 0 cannot be checked: "${SHORT}" is not one of the fields (`)).toBe(true);
    expect(issue.message.length).toBeLessThanOrEqual(A_FEW_HUNDRED);
    // A known field with a 5 MB subfield (the draft's case) says the same of its own field and lists what it accepts.
    const known = subfieldIssue(config(), "biology", BIG, "seeds[0].subfield", "of seed 0")!;
    expect(known.message.startsWith(`Subfield "${SHORT}" of seed 0 is not one of biology's subfields: `)).toBe(true);
    expect(known.message.length).toBeLessThanOrEqual(A_FEW_HUNDRED);
    // A subfield of another field is named whole, as its owner has it.
    expect(subfieldIssue(config(), "chemistry", "proteins", "seeds[0].subfield", "of seed 0")!.message).toContain(' "proteins" is a biology subfield. Use one of chemistry');
  });

  it("prints a 5 MB correction path shortened: the schema's own message is cut at 400 characters and ends in three dots", () => {
    const issues = english((d) => { d.corrections[0].type = "removed"; d.corrections[0].path = BIG; });
    const custom = issues.filter((i) => i.code === "SCHEMA" && i.message.length > 0 && i.message.endsWith("..."));
    expect(custom.length).toBeGreaterThan(0);
    for (const i of custom) expect(Array.from(i.message)).toHaveLength(SCHEMA_MESSAGE_MAX);
    expectShort(issues, "correction path");
  });

  it("gives a 5 MB value of any other string of the draft no long message", () => {
    for (const [label, change] of [
      ["a title", (d: Json) => { d.new_findings[0].title = BIG; }],
      ["an explainer part", (d: Json) => { d.new_findings[0].explainer.found += ` ${BIG}`; }],
      ["a source url", (d: Json) => { d.new_findings[0].sources[0].url = `https://example.org/${BIG}`; }],
      ["a quote", (d: Json) => { d.new_findings[0].ai.evidence[0].quote = BIG; }],
      ["a figure address", (d: Json) => { d.new_findings[0].figure = { ...d.new_findings[0].figure, image_url: `https://example.org/${BIG}.png` }; }],
      ["a date", (d: Json) => { d.date = BIG; }],
      ["a field", (d: Json) => { d.new_findings[0].field = BIG; }],
      ["a ref", (d: Json) => { d.story = BIG; }],
    ] as const) {
      const issues = english(change);
      for (const i of issues) {
        expect(i.path.length, `${label}: path of ${i.code}`).toBeLessThanOrEqual(RESULT_PATH_MAX);
        expect(i.message.length, `${label}: message of ${i.code}`).toBeLessThanOrEqual(A_FEW_HUNDRED);
      }
    }
  });

});

describe("schemaIssues() cuts a schema's own message and keeps a short one", () => {
  it("keeps every message of the draft schema that a fixture draft meets whole: the limit is above them", () => {
    const parsed = DraftBrief.safeParse(draftOf((d) => { d.corrections[0].type = "removed"; d.corrections[0].path = "kind"; }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = schemaIssues(parsed.error);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.message.includes('"kind" is none'))).toBe(true);
    for (const i of issues) expect(i.message.endsWith("...")).toBe(false);
  });
});

describe("the Chinese draft's issues quote what the draft holds through shown()", () => {
  it("prints a 5 MB string key shortened in ZH_KEYS, in the message and in the place", () => {
    const w = zhWorld();
    w.draft.strings[BIG] = "範例";
    const issues = only(zhRun(w), "ZH_KEYS");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message.startsWith(`"${SHORT}" is not a key of the context.`)).toBe(true);
    expectShort(issues, "string key");
  });

  it("prints a 5 MB unknown key of the Chinese draft shortened as SCHEMA", () => {
    const w = zhWorld();
    const result = validateZh({ ...w.draft, [BIG]: 1 }, w.english, inputsOf(w));
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: "SCHEMA", message: `Unknown key "${SHORT}"; remove it.` });
    expectShort(result.issues, "unknown key");
  });

  it("prints a 5 MB term id (a key of terms) with a short place", () => {
    const w = zhWorld();
    const result = validateZh({ ...w.draft, terms: { ...w.draft.terms, [BIG]: { zh: "範例", definition: "範例。", official: null, official_url: null } } }, w.english, inputsOf(w));
    expectShort(result.issues, "term id");
  });

  it("prints a run of a million digits, a link of two million letters and a long Latin word shortened in ZH_PARITY", () => {
    for (const [label, extra, word] of [
      ["digits", ` ${"9".repeat(1_000_000)}`, `${"9".repeat(117)}...`],
      ["a link", ` https://example.org/${"k".repeat(2_000_000)}`, `https://example.org/${"k".repeat(117 - "https://example.org/".length)}...`],
    ] as const) {
      const w = zhWorld();
      setZh(w, "ideas.0", `範例${extra}。`);
      const issues = only(zhRun(w), "ZH_PARITY");
      expect(issues, label).toHaveLength(1);
      expect(issues[0]!.message, label).toContain(word);
      expectShort(issues, label);
    }
    const w = zhWorld();
    setZh(w, "ideas.0", `範例 ${"k".repeat(20_000)}。`);
    const latin = only(zhRun(w), "ZH_PARITY");
    expect(latin).toHaveLength(1);
    expect(latin[0]!.message).toContain(`Latin word ${"k".repeat(117)}...`);
    expectShort(latin, "a Latin word");
  });

  it("gives a 5 MB run of digits and a 5 MB link no long message, whichever rule they stop", () => {
    for (const [label, text] of [["digits", `範例 ${"9".repeat(5_000_000)}。`], ["a link", `範例 https://example.org/${BIG}。`]] as const) {
      const w = zhWorld();
      setZh(w, "ideas.0", text);
      const issues = zhRun(w);
      expect(issues.length, label).toBeGreaterThan(0);
      expectShort(issues, `5 MB of ${label}`);
    }
  });

  it("gives ZH_PARITY, never RULE_ERROR, and a short message for a 5 MB run of digits, a 5 MB link and a 300,000-letter Latin run (F-70)", () => {
    for (const [label, text] of [
      ["digits", `範例 ${"9".repeat(5_000_000)}。`],
      ["a link", `範例 https://example.org/${BIG}。`],
      ["a Latin run", `範例 ${"é".repeat(300_000)}。`],
    ] as const) {
      const w = zhWorld();
      setZh(w, "ideas.0", text);
      const issues = zhRun(w);
      expect(only(issues, "RULE_ERROR"), label).toEqual([]);
      expect(only(issues, "ZH_PARITY"), label).toHaveLength(1);
      expectShort(issues, `${label} through validateZh`);
    }
  });

  it("gives ZH_AVOID, never RULE_ERROR, and a short message for 400,000 characters of one avoid term, 100,000 hits (the review of F-70)", () => {
    // 5 MB of it takes four seconds now; the case is cut to a size at which the old copy of the text for every hit fails in a minute, not in hours.
    const w = zhWorld();
    const term = w.config.termsZh.avoid[0]!.term;
    setZh(w, "ideas.0", term.repeat(Math.ceil(400_000 / term.length)));
    const issues = zhRun(w);
    expect(only(issues, "RULE_ERROR")).toEqual([]);
    expect(only(issues, "ZH_AVOID")).toHaveLength(1);
    expectShort(issues, "an avoid term said 100,000 times through validateZh");
  });

  it("prints a term's 5 MB Chinese shortened in ZH_ENGLISH_ONCE", () => {
    const w = zhWorld();
    w.draft.terms["protein-folding"]!.zh = "範".repeat(5_000_000);
    const issues = only(zhRun(w), "ZH_ENGLISH_ONCE");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.message).toContain(`(${"範".repeat(117)}...)`);
    expectShort(issues, "term zh");
  });

  it("prints a term's 5 MB official and 5 MB official_url shortened in ZH_OFFICIAL, in each of its four messages", () => {
    const BIG_OFFICIAL = "範".repeat(5_000_000);
    const SHORT_OFFICIAL = `${"範".repeat(117)}...`;
    const longUrl = `https://terms.naer.edu.tw/detail/${"9".repeat(5_000_000)}/`;
    const term = (official: string | null, official_url: string | null) => ({ zh: "蛋白質摺疊", definition: "一串胺基酸捲成立體形狀的過程。", official, official_url });

    // The page was fetched and does not hold the term: both the official and the address are quoted.
    const wrongPage = zhWorld();
    wrongPage.evidence = Evidence.parse({ ...wrongPage.evidence!, fetched: [...wrongPage.evidence!.fetched, longUrl] });
    wrongPage.draft.terms["protein-folding"] = term(BIG_OFFICIAL, longUrl);
    const notOnPage = only(zhRun(wrongPage), "ZH_OFFICIAL");
    expect(notOnPage).toHaveLength(1);
    expect(notOnPage[0]!.message).toContain(`"${SHORT_OFFICIAL}" is not in the page ${shown(longUrl)}: `);
    expectShort(notOnPage, "official not on the page");

    // The page was not fetched: the same two, in the other order.
    const unfetched = zhWorld();
    unfetched.draft.terms["protein-folding"] = term(BIG_OFFICIAL, longUrl);
    const notFetched = only(zhRun(unfetched), "ZH_OFFICIAL");
    expect(notFetched).toHaveLength(1);
    expect(notFetched[0]!.message).toContain(`did not fetch ${shown(longUrl)}, so the page cannot show "${SHORT_OFFICIAL}"`);
    expectShort(notFetched, "official_url not fetched");

    // The address is not on the host.
    const wrongHost = zhWorld();
    wrongHost.draft.terms["protein-folding"] = term(BIG_OFFICIAL, `https://example.org/${"9".repeat(5_000_000)}`);
    const notOnHost = only(zhRun(wrongHost), "ZH_OFFICIAL");
    expect(notOnHost).toHaveLength(1);
    expect(notOnHost[0]!.message).toContain(`Give the 樂詞網 page that shows "${SHORT_OFFICIAL}", or set official to null.`);
    expect(notOnHost[0]!.message).toContain("official_url \"https://example.org/");
    expectShort(notOnHost, "official_url on another host");

    // There is no address.
    const none = zhWorld();
    none.draft.terms["protein-folding"] = term(BIG_OFFICIAL, null);
    const noUrl = only(zhRun(none), "ZH_OFFICIAL");
    expect(noUrl).toHaveLength(1);
    expect(noUrl[0]!.message).toContain(`has the official "${SHORT_OFFICIAL}" but no official_url`);
    expectShort(noUrl, "no official_url");
  });

  it("leaves a valid Chinese draft with no issue", () => {
    expect(zhRun(zhWorld())).toEqual([]);
  });
});

describe("toResult() bounds the place, the message and the hint of every issue", () => {
  it("cuts a 5 MB place, message and hint to their limits with three dots, keeping the code and the severity", () => {
    const long = error("COUNTS", `strings["${BIG}"]`, BIG, BIG);
    const result = toResult([long, warning("DUAL_USE", "x", "a short message", null)]);
    const [first, second] = result.issues;
    expect(first).toMatchObject({ code: "COUNTS", severity: "error" });
    expect(Array.from(first!.path)).toHaveLength(RESULT_PATH_MAX);
    expect(first!.path.startsWith('strings["kkkk')).toBe(true);
    expect(first!.path.endsWith("...")).toBe(true);
    expect(Array.from(first!.message)).toHaveLength(RESULT_MESSAGE_MAX);
    expect(first!.message.endsWith("...")).toBe(true);
    expect(Array.from(first!.hint!)).toHaveLength(RESULT_MESSAGE_MAX);
    expect(second).toEqual(warning("DUAL_USE", "x", "a short message", null));
    expect(result.errors).toEqual([first]);
    expect(result.warnings).toEqual([second]);
    expect(result.ok).toBe(false);
  });

  it("cuts each of the place, the message and the hint alone, and no other: the long one is bounded and the short ones are as they were", () => {
    const smile = String.fromCodePoint(0x1f600);
    const over = [smile.repeat(RESULT_PATH_MAX + 1), smile.repeat(RESULT_MESSAGE_MAX + 1), smile.repeat(RESULT_MESSAGE_MAX + 1)];
    const cut = [`${smile.repeat(RESULT_PATH_MAX - 3)}...`, `${smile.repeat(RESULT_MESSAGE_MAX - 3)}...`, `${smile.repeat(RESULT_MESSAGE_MAX - 3)}...`];
    for (const long of [0, 1, 2]) {
      const parts = ["place", "message", "hint"].map((short, i) => (i === long ? over[i]! : short));
      const out = toResult([error("COUNTS", parts[0]!, parts[1]!, parts[2]!)]).issues[0]!;
      const expected = ["place", "message", "hint"].map((short, i) => (i === long ? cut[i]! : short));
      expect([out.path, out.message, out.hint], `only the ${["place", "message", "hint"][long]} is long`).toEqual(expected);
    }
  });

  it("keeps the issue itself, the same object, when the place, the message and the hint are within bounds", () => {
    const issues = [error("COUNTS", "a".repeat(RESULT_PATH_MAX), "m".repeat(RESULT_MESSAGE_MAX), "h".repeat(RESULT_MESSAGE_MAX)), warning("DUAL_USE", "x", "y", null)];
    const result = toResult(issues);
    expect(result.issues[0]).toBe(issues[0]);
    expect(result.issues[1]).toBe(issues[1]);
    expect(result.issues).not.toBe(issues);
  });

  it("cuts one character over each limit and no character at it, counting code points", () => {
    const smile = String.fromCodePoint(0x1f600);
    const over = toResult([error("COUNTS", smile.repeat(RESULT_PATH_MAX + 1), smile.repeat(RESULT_MESSAGE_MAX + 1), smile.repeat(RESULT_MESSAGE_MAX + 1))]).issues[0]!;
    expect(over.path).toBe(`${smile.repeat(RESULT_PATH_MAX - 3)}...`);
    expect(over.message).toBe(`${smile.repeat(RESULT_MESSAGE_MAX - 3)}...`);
    expect(over.hint).toBe(`${smile.repeat(RESULT_MESSAGE_MAX - 3)}...`);
    const at = toResult([error("COUNTS", smile.repeat(RESULT_PATH_MAX), smile.repeat(RESULT_MESSAGE_MAX), smile.repeat(RESULT_MESSAGE_MAX))]).issues[0]!;
    expect(at.path).toBe(smile.repeat(RESULT_PATH_MAX));
    expect(at.message).toBe(smile.repeat(RESULT_MESSAGE_MAX));
    expect(at.hint).toBe(smile.repeat(RESULT_MESSAGE_MAX));
  });

  it("changes no result that holds nothing long: the same issues in the same order, split by severity", () => {
    const issues = [warning("DUAL_USE", "b", "w", "h"), error("COUNTS", "a", "e", null)];
    const result = toResult(issues);
    expect(result.issues).toEqual(issues);
    expect(result.errors).toEqual([issues[1]]);
    expect(result.warnings).toEqual([issues[0]]);
    expect(toResult([])).toEqual({ ok: true, errors: [], warnings: [], issues: [] });
  });
});
