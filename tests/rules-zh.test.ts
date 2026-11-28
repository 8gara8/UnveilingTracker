// The Chinese rule group (SPEC §4.12 ZH_KEYS, ZH_PARITY, ZH_TRADITIONAL, ZH_AVOID, ZH_TERMS, ZH_RUNG_LABEL, ZH_ENGLISH_ONCE, ZH_CHARS,
// ZH_OFFICIAL, ZH_NO_DASH, ZH_HYPE): every sentence of each row is a test that fails when its rule is wrong, in zh mode (a Chinese
// draft and its context, tests/helpers/zh-world.ts) and, where the "Stored records" paragraph says so, in published mode (the frame's
// stored Tuesday with Chinese). A world is valid when no rule gives an issue; each test breaks one thing and expects one code.
// The engine around the rules (SCHEMA short-circuit, the English draft, which rules run) is tests/validate-zh.test.ts.
//
// New for this project; Cyber had no Chinese pass.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/lib/config";
import { RULE_CODE_TABLE, codesOfGroup } from "@/lib/rules/index";
import { runRules } from "@/lib/rules/run";
import { formatPath, type RuleInput, type ValidationIssue } from "@/lib/rules/types";
import { CORRECTION_AFTER_CHARS, NAER_HOST, around, excerpt, officialUrlProblem, rungLabelProblem, zhCap, zhPageTotal, zhRules } from "@/lib/rules/zh";
import { ALL_RUNGS, RUNG_INFO } from "@/lib/vocab";
import { countZhChars } from "@/lib/zh";
import { BriefDeepDive, WeekReview } from "@/lib/schema/brief";
import { Figure } from "@/lib/schema/common";
import { DraftBrief } from "@/lib/schema/draft";
import { DraftZh, ZhContext } from "@/lib/schema/draft-zh";
import { Term } from "@/lib/schema/glossary";
import { Correction, Evidence } from "@/lib/schema/misc";
import { buildZhInput } from "@/lib/validate-zh";
import { FIELDS, type FieldId } from "@/lib/vocab";
import { normalizeUrl } from "@/lib/urls";
import { D, config, deepFreeze, l, lz, storedFinding, storedWorld } from "./helpers/rule-world";
import {
  OFFICIAL_PAGE, OFFICIAL_TERM, OFFICIAL_URL, addString, dropKey, publishedIssues, publishedRun, publishedZhWorld, refreshFixed, setEn, setPair, setZh,
  zhInputOf, zhIssues, zhRun, zhWorld, type PublishedZhWorld, type ZhWorld,
} from "./helpers/zh-world";
import { oldAround, oldExcerpt } from "./helpers/zh-reference";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const HAN = (n: number): string => "字".repeat(n);

const codesOf = (issues: readonly ValidationIssue[]): string[] => [...new Set(issues.map((i) => i.code))].sort();
const errorCodes = (w: ZhWorld): string[] => codesOf(zhRun(w).filter((i) => i.severity === "error"));
const published = (w: PublishedZhWorld, code: string, publishing: string | null = D): ValidationIssue[] => publishedIssues(w, code, publishing);

/** The paths of the issues of one code in zh mode. */
const pathsOf = (w: ZhWorld, code: string): string[] => zhIssues(w, code).map((i) => i.path);

const KEY = (key: string): string => formatPath(["strings", key]);

// ── The group ────────────────────────────────────────────────────────────────────────────────────

describe("the group and its rules", () => {
  const CODES = ["ZH_KEYS", "ZH_PARITY", "ZH_TRADITIONAL", "ZH_AVOID", "ZH_TERMS", "ZH_RUNG_LABEL", "ZH_ENGLISH_ONCE", "ZH_CHARS", "ZH_OFFICIAL", "ZH_NO_DASH", "ZH_HYPE"];

  it("has one rule for each code of the table's zh group, in the table's order", () => {
    expect(zhRules.map((r) => r.codes)).toEqual(CODES.map((c) => [c]));
    expect(codesOfGroup("zh")).toEqual(CODES);
  });

  it("runs each rule in the modes the table gives it: zh alone for the keys, the parity, the rung label and the official; zh and published for the rest", () => {
    for (const rule of zhRules) {
      const info = RULE_CODE_TABLE.find((r) => r.code === rule.codes[0])!;
      expect([...rule.scope].sort(), rule.codes[0]).toEqual(info.scopes.filter((s) => s !== "seed").sort());
    }
    const zhOnly = zhRules.filter((r) => r.scope.length === 1).map((r) => r.codes[0]);
    expect(zhOnly).toEqual(["ZH_KEYS", "ZH_PARITY", "ZH_RUNG_LABEL", "ZH_OFFICIAL"]);
    for (const rule of zhRules) if (rule.scope.length === 2) expect([...rule.scope].sort()).toEqual(["published", "zh"]);
  });

  it("makes every rule an error that needs no input, ZH_OFFICIAL alone using the evidence", () => {
    for (const rule of zhRules) {
      expect(rule.severity, rule.codes[0]).toBe("error");
      expect(rule.needs, rule.codes[0]).toEqual([]);
      expect(rule.uses, rule.codes[0]).toEqual(rule.codes[0] === "ZH_OFFICIAL" ? ["evidence"] : []);
    }
  });

  it("gives no issue on the valid worlds, a Tuesday, a Monday and a Sunday, nor on the stored Tuesday", () => {
    expect(zhRun(zhWorld())).toEqual([]);
    expect(zhRun(zhWorld({ review: true }))).toEqual([]);
    expect(zhRun(zhWorld({ deepDive: true }))).toEqual([]);
    expect(zhRun(zhWorld({ review: true, deepDive: true }))).toEqual([]);
    expect(runRules({ ...zhInputOf(zhWorld()), mode: "draft" } as unknown as RuleInput, zhRules)).toEqual([]);
    expect(publishedRun(publishedZhWorld())).toEqual([]);
    expect(publishedRun(publishedZhWorld(), null)).toEqual([]);
  });

  it("reports only the code of the rule, in a stable order, and changes no input", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", `这是${EM}算法 3`);
    delete w.draft.strings["lead.1"];
    const frozen = deepFreeze({ ...w, draft: structuredClone(w.draft), context: structuredClone(w.context), evidence: structuredClone(w.evidence), english: structuredClone(w.english) });
    const first = zhRun(frozen);
    expect(zhRun(frozen)).toEqual(first);
    expect(first.length).toBeGreaterThan(3);
    for (const rule of zhRules) {
      const own = zhRun(w).filter((i) => i.code === rule.codes[0]);
      expect(own.every((i) => i.code === rule.codes[0])).toBe(true);
    }
    const paths = first.map((i) => i.path);
    expect(first).toEqual([...first].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));
    expect(paths.length).toBe(first.length);
  });
});

// ── ZH_KEYS ──────────────────────────────────────────────────────────────────────────────────────

describe("ZH_KEYS: `strings` has exactly the context's keys; `terms` exactly its null-zh term ids", () => {
  it("passes a draft with exactly the keys and the ids", () => {
    const w = zhWorld();
    expect(w.context.strings.map((s) => s.key).sort()).toEqual(Object.keys(w.draft.strings).sort());
    expect(Object.keys(w.draft.terms)).toEqual(w.context.terms.filter((t) => t.zh === null).map((t) => t.id));
    expect(zhIssues(w, "ZH_KEYS")).toEqual([]);
  });

  it("fails a key of the context that the draft lacks, at the place it belongs, with the English to translate", () => {
    const w = zhWorld();
    delete w.draft.strings["lead.0"];
    const issues = zhIssues(w, "ZH_KEYS");
    expect(issues.map((i) => i.path)).toEqual([KEY("lead.0")]);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain('"lead.0"');
    expect(issues[0]!.message).toContain("A sample protein result leads today.");
    expect(issues[0]!.hint).not.toBeNull();
  });

  it("fails a key the context lacks, wherever it is, one issue each", () => {
    const w = zhWorld();
    w.draft.strings["lead.7"] = "多出來的一句。";
    w.draft.strings["made.up"] = "另一句。";
    const issues = zhIssues(w, "ZH_KEYS");
    expect(issues.map((i) => i.path)).toEqual([KEY("lead.7"), KEY("made.up")]);
    expect(issues[0]!.message).toContain("is not a key of the context");
    expect(codesOf(zhRun(w))).toEqual(["ZH_KEYS"]);
  });

  it("fails every key left out and every key added in one run, a missing one and an extra one together", () => {
    const w = zhWorld();
    for (const key of ["lead.0", "ideas.0", "also.0"]) delete w.draft.strings[key];
    w.draft.strings["lead.9"] = "多餘。";
    expect(pathsOf(w, "ZH_KEYS")).toEqual([KEY("also.0"), KEY("ideas.0"), KEY("lead.0"), KEY("lead.9")]);
  });

  it("fails a null-zh term the draft leaves out and a term the draft adds", () => {
    const w = zhWorld();
    delete w.draft.terms["protein-folding"];
    w.draft.terms["made-up"] = { zh: "杜撰詞", definition: "杜撰的定義。", official: null, official_url: null };
    const issues = zhIssues(w, "ZH_KEYS");
    expect(issues.map((i) => i.path)).toEqual(['terms["made-up"]', 'terms["protein-folding"]']);
    expect(issues[0]!.message).toContain("not a term of the context");
    expect(issues[1]!.message).toContain("protein folding");
  });

  it("fails a term whose Chinese the glossary already holds, which the draft must not write, by its id and not by its English", () => {
    const w = zhWorld();
    w.context.terms.push({ id: "peer-review", en: "peer review", definition: "Experts check a paper first.", zh: "同儕審查", official: null, cap_chars: 72 });
    w.draft.terms["enzyme"] = { zh: "酵素", definition: "加快化學反應的蛋白質。", official: null, official_url: null };
    w.draft.terms["peer-review"] = { zh: "同儕審查", definition: "專家先檢查論文。", official: null, official_url: null };
    const issues = zhIssues(w, "ZH_KEYS");
    expect(issues.map((i) => i.path)).toEqual(["terms.enzyme", 'terms["peer-review"]']);
    expect(issues.map((i) => i.message.includes("already holds its Chinese"))).toEqual([true, true]);
    w.draft.terms["peer review"] = { zh: "同儕審查", definition: "專家先檢查論文。", official: null, official_url: null };
    const after = zhIssues(w, "ZH_KEYS");
    expect(after.find((i) => i.path === 'terms["peer review"]')!.message).toContain("it is not a term of the context");
  });

  it("is the only rule that reports a key the draft lacks or the context lacks: the others skip it", () => {
    const w = zhWorld();
    delete w.draft.strings["new.new-1.explainer.how_sure"];
    delete w.draft.strings["corrections.3.after"];
    delete w.draft.strings["new.new-1.explainer.found"];
    dropKeyFromFixed(w, "new.new-1.explainer.found");
    w.draft.strings["extra.key"] = "多餘的一句。";
    w.draft.strings["new.new-9.explainer.found"] = "蛋白質摺疊。";
    w.draft.strings["corrections.9.after"] = "已查核，什麼都沒有。";
    expect(errorCodes(w)).toEqual(["ZH_KEYS"]);
  });

  it("does not run on a stored record (zh mode only: it reads the context)", () => {
    expect(published(publishedZhWorld(), "ZH_KEYS")).toEqual([]);
  });
});

/** Takes a key out of every `fixed` list of the context, as a draft with no such key has none. */
function dropKeyFromFixed(w: ZhWorld, key: string): void {
  for (const f of w.context.fixed) f.keys = f.keys.filter((k) => k !== key);
}

// ── ZH_PARITY ────────────────────────────────────────────────────────────────────────────────────

describe("ZH_PARITY: the numbers match, no URL, no Latin word the English lacks", () => {
  const parity = (en: string, zh: string): ValidationIssue[] => {
    const w = zhWorld();
    setEn(w, "ideas.0", en);
    setZh(w, "ideas.0", zh);
    return zhIssues(w, "ZH_PARITY");
  };

  it("passes the row's examples: 3 名學生 and 三名學生 for three students, 其中一個 for one of, 2024 年 2 月 for February 2024, 5 月 for published in May, 8 月 31 日 for 31 Aug, 70 萬美元 for $700,000 and 250 萬 for 2.5 million", () => {
    const pass: [string, string][] = [
      ["Three students joined.", "有 3 名學生加入。"],
      ["Three students joined.", "有三名學生加入。"],
      ["It was one of the labs.", "它是其中一個實驗室。"],
      ["It was published in February 2024.", "它在 2024 年 2 月發表。"],
      ["It was published in May.", "它在 5 月發表。"],
      ["It was posted on 31 Aug.", "它在 8 月 31 日發布。"],
      ["It cost $700,000.", "它花了 70 萬美元。"],
      ["It reached 2.5 million.", "它達到 250 萬。"],
    ];
    for (const [en, zh] of pass) expect(parity(en, zh), `${en} / ${zh}`).toEqual([]);
  });

  it("fails a changed digit in a string, with the English number and the Chinese one in the message and the Chinese text", () => {
    const issues = parity("It had 3 students.", "它有 4 名學生。");
    expect(issues.map((i) => i.path)).toEqual([KEY("ideas.0")]);
    expect(issues[0]!.message).toContain("the English has 3, which the Chinese lacks");
    expect(issues[0]!.message).toContain("the Chinese has 4, which the English lacks");
    expect(issues[0]!.message).toContain("它有 4 名學生。");
    expect(issues[0]!.severity).toBe("error");
  });

  it("fails a number the Chinese leaves out, a number it adds, and a percentage written as a plain number", () => {
    expect(parity("It had 3 students.", "它有學生。")).toHaveLength(1);
    expect(parity("It had students.", "它有 3 名學生。")).toHaveLength(1);
    expect(parity("It rose 5%.", "它上升了 5。")).toHaveLength(1);
    expect(parity("It rose 5%.", "它上升了 5%。")).toEqual([]);
    expect(parity("It rose 5 percent.", "它上升了百分之 5。")).toEqual([]);
  });

  it("reads full-width digits as ASCII ones, a thousands separator away and a decimal kept", () => {
    expect(parity("It had 1,200 students.", "它有１２００名學生。")).toEqual([]);
    expect(parity("It had 1.5 students.", "它有 1.5 名學生。")).toEqual([]);
    expect(parity("It had 1.5 students.", "它有 15 名學生。")).toHaveLength(1);
  });

  it("fails a URL in the Chinese, even one the English holds", () => {
    const issues = parity("See https://example.org/a for it.", "請見 https://example.org/a。");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("link https://example.org/a");
    expect(issues[0]!.message).not.toContain("Latin");
  });

  it("fails a Latin word the English lacks and passes one it holds and the English name of a term of the context in full-width brackets", () => {
    expect(parity("The tool is called Foo.", "這個工具叫 Foo。")).toEqual([]);
    const issues = parity("The tool is called Foo.", "這個工具叫 Foo 和 Bar。");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Latin word Bar");
    expect(parity("It folds.", "它會摺疊（protein folding）。")).toEqual([]);
    expect(parity("It folds.", "它會摺疊 protein folding。")).toHaveLength(1);
  });

  describe("a bracketed English phrase", () => {
    it("passes when it is the English name of a term of the context, in any case and spacing, and that term needs no place in the English string", () => {
      // The Tuesday's context holds protein folding (its Chinese is the pass's to write) and enzyme (its Chinese is the glossary's).
      expect(zhWorld().context.terms.map((t) => t.en)).toEqual(["protein folding", "enzyme"]);
      for (const run of ["protein folding", "Protein Folding", " protein  folding ", "enzyme", "ENZYME"]) {
        expect(parity("It folds.", `它會摺疊（${run}）。`), run).toEqual([]);
      }
    });

    it("fails an English phrase of the agent's own, and names its Latin words that the English lacks", () => {
      for (const phrase of ["quantum computing", "Tsunami", "protein folding in cells", "protein-folding", "protein", "protein folding, enzyme"]) {
        const issues = parity("It folds.", `它會摺疊（${phrase}）。`);
        expect(issues.map((i) => i.path), phrase).toEqual([KEY("ideas.0")]);
        expect(issues[0]!.message, phrase).toContain("the Chinese holds the Latin word");
        expect(issues[0]!.message, phrase).toContain("which the English lacks");
      }
      expect(parity("It folds.", "它會摺疊（quantum computing）。")[0]!.message).toContain("Latin words quantum, computing, which the English lacks");
      // Only the words the English lacks: protein is the English string's own.
      expect(parity("It is a protein.", "它是蛋白質（protein folding in cells）。")[0]!.message).toContain("Latin words folding, in, cells, which the English lacks");
    });

    it("passes when the English string holds every Latin word of it, a phrase that no term names", () => {
      expect(parity("A Foo bar is called baz.", "一個 Foo bar（Foo bar）叫 baz。")).toEqual([]);
      expect(parity("A Foo bar is called baz.", "一個 Foo bar（baz Foo）。")).toEqual([]);
      expect(parity("A Foo bar is called baz.", "一個 Foo bar（baz qux）。")).toHaveLength(1);
    });

    it("reads the context's terms for what a bracket may hold: one the context lacks fails, one it gains passes (the draft's own terms are no list)", () => {
      const w = zhWorld();
      setEn(w, "ideas.0", "It folds.");
      setZh(w, "ideas.0", "它會摺疊（peer review）。");
      expect(zhIssues(w, "ZH_PARITY").map((i) => i.path)).toEqual([KEY("ideas.0")]);
      w.context.terms.push({ id: "peer-review", en: "peer review", definition: "Experts check a paper first.", zh: "同儕審查", official: null, cap_chars: 72 });
      expect(zhIssues(w, "ZH_PARITY")).toEqual([]);
      w.context.terms = w.context.terms.filter((t) => t.id !== "peer-review");
      w.draft.terms["peer-review"] = { zh: "同儕審查", definition: "專家先檢查論文。", official: null, official_url: null };
      expect(zhIssues(w, "ZH_PARITY").map((i) => i.path)).toEqual([KEY("ideas.0")]);
    });

    it("is judged in a term's own zh and definition as well: the name of a context term passes there, any other phrase fails", () => {
      const w = zhWorld();
      w.draft.terms["protein-folding"]!.definition = "一串胺基酸捲成形狀（enzyme）。";
      expect(zhIssues(w, "ZH_PARITY")).toEqual([]);
      w.draft.terms["protein-folding"]!.definition = "一串胺基酸捲成形狀（quantum）。";
      const issues = zhIssues(w, "ZH_PARITY");
      expect(issues.map((i) => i.path)).toEqual(['terms["protein-folding"]']);
      expect(issues[0]!.message).toContain("the Chinese holds the Latin word quantum, which the English lacks");
      w.draft.terms["protein-folding"]!.definition = "一串胺基酸捲成形狀。";
      w.draft.terms["protein-folding"]!.zh = "蛋白質摺疊（quantum）";
      expect(zhIssues(w, "ZH_PARITY").map((i) => i.path)).toEqual(['terms["protein-folding"]']);
    });

    it("says in the hint that only the English name of a glossary term may stand in brackets", () => {
      const issue = parity("It folds.", "它會摺疊（quantum computing）。")[0]!;
      expect(issue.hint).toContain("adds no number, link or Latin word of its own.");
      expect(issue.hint).toContain("The one exception is the English name of a glossary term of the edition, written alone in full-width brackets after its Chinese");
    });

    it("is judged by ZH_PARITY alone: ZH_ENGLISH_ONCE and the other rules read the same bracket as they did", () => {
      const w = zhWorld();
      setEn(w, "ideas.0", "It folds.");
      setZh(w, "ideas.0", "它會摺疊（quantum computing）。");
      expect(codesOf(zhRun(w))).toEqual(["ZH_PARITY"]);
    });
  });

  it("fails a changed digit in a term's definition and one in its name, each term judged on its zh and definition together", () => {
    const w = zhWorld();
    w.context.terms[0]!.definition = "A chain of 20 amino acids.";
    w.draft.terms["protein-folding"]!.definition = "一串 20 種胺基酸。";
    expect(zhIssues(w, "ZH_PARITY")).toEqual([]);
    w.draft.terms["protein-folding"]!.definition = "一串 21 種胺基酸。";
    let issues = zhIssues(w, "ZH_PARITY");
    expect(issues.map((i) => i.path)).toEqual(['terms["protein-folding"]']);
    expect(issues[0]!.message).toContain("the English has 20");
    w.draft.terms["protein-folding"]!.definition = "一串 20 種胺基酸。";
    w.context.terms[0]!.en = "protein folding 2";
    w.draft.terms["protein-folding"]!.zh = "蛋白質摺疊 3";
    issues = zhIssues(w, "ZH_PARITY");
    expect(issues.map((i) => i.path)).toEqual(['terms["protein-folding"]']);
  });

  it("judges only the keys both sides have: a key the context lacks or the draft lacks is ZH_KEYS's alone", () => {
    const w = zhWorld();
    w.draft.strings["extra.key"] = "它有 7 名學生 https://example.org。";
    delete w.draft.strings["lead.0"];
    expect(zhIssues(w, "ZH_PARITY")).toEqual([]);
    expect(codesOf(zhRun(w))).toEqual(["ZH_KEYS"]);
  });

  it("does not run on a stored record", () => {
    const w = publishedZhWorld();
    w.brief.pace.sentence.zh = "進度：99.9% 的論文。";
    expect(published(w, "ZH_PARITY")).toEqual([]);
  });
});

// ── ZH_PARITY and the message excerpts on a hostile string (F-70) ────────────────────────────────
// The Chinese pass is a model run that a hostile page may steer, so a string of megabytes must cost this rule what its length costs and
// must give the issue the rule gives for it (ZH_PARITY), never a RULE_ERROR from a crash. The text checks themselves are tested with the
// same strings in tests/zh.test.ts; here the whole rule runs, with the message it prints.

const PARITY_RULE = zhRules.filter((r) => r.codes[0] === "ZH_PARITY");

/** The ZH_PARITY rule alone on a world with `text` as the Chinese of `ideas.0` (whose English is `en`), and the time it took. */
function parityOn(text: string, en = "It was a short idea."): { issues: ValidationIssue[]; ms: number } {
  const w = setZh(setEn(zhWorld(), "ideas.0", en), "ideas.0", text);
  const input = zhInputOf(w);
  const before = performance.now();
  const issues = runRules(input, PARITY_RULE);
  return { issues, ms: performance.now() - before };
}

describe("ZH_PARITY on a hostile string: the issue it should give, in time", () => {
  it("names a Latin run of 300,000 characters as one Latin word, in a few seconds at most (the earlier code took minutes)", () => {
    const { issues, ms } = parityOn(`範例 ${"a".repeat(300_000)}。`);
    expect(ms).toBeLessThan(4000);
    expect(issues.map((i) => i.code)).toEqual(["ZH_PARITY"]);
    expect(issues[0]!.path).toBe(KEY("ideas.0"));
    expect(issues[0]!.message).toBe(`ideas.0: the Chinese holds the Latin word ${"a".repeat(117)}..., which the English lacks. Chinese: "範例 ${"a".repeat(37)}…".`);
  });

  it("names a run of 5 MB of digits as one extra number, shortened, and does not crash", () => {
    const { issues, ms } = parityOn(`範例 ${"9".repeat(5_000_000)}。`);
    expect(ms).toBeLessThan(6000);
    expect(issues.map((i) => i.code)).toEqual(["ZH_PARITY"]);
    expect(issues[0]!.message).toBe(`ideas.0: the Chinese has ${"9".repeat(117)}..., which the English lacks. Chinese: "範例 ${"9".repeat(37)}…".`);
  });

  it("names a run of 5 MB of digits in the English as the number the Chinese lacks, shortened as the Chinese side is", () => {
    const { issues, ms } = parityOn("範例", `It had ${"9".repeat(5_000_000)} ideas.`);
    expect(ms).toBeLessThan(6000);
    expect(issues.map((i) => i.code)).toEqual(["ZH_PARITY"]);
    expect(issues[0]!.message).toBe(`ideas.0: the English has ${"9".repeat(117)}..., which the Chinese lacks. Chinese: "範例".`);
  });

  it("names one link of 5 MB as the link, shortened, with none of its letters as a Latin word of its own, and does not crash", () => {
    const { issues, ms } = parityOn(`範例 https://example.org/${"k".repeat(5_000_000)}。`);
    expect(ms).toBeLessThan(6000);
    expect(issues.map((i) => i.code)).toEqual(["ZH_PARITY"]);
    expect(issues[0]!.message).toBe(
      `ideas.0: the Chinese holds the link https://example.org/${"k".repeat(97)}.... Chinese: "範例 https://example.org/${"k".repeat(17)}…".`,
    );
  });

  it("names 5 MB of Chinese text or of brackets by no issue at all, and does not crash", () => {
    for (const text of ["範".repeat(5_000_000), "（".repeat(5_000_000), "）".repeat(5_000_000)]) {
      const { issues, ms } = parityOn(text);
      expect(ms).toBeLessThan(6000);
      expect(issues).toEqual([]);
    }
  });

  it("counts 20,000 different links and 20,000 different Latin words in one message of a few hundred characters, in a few seconds at most (the earlier code took minutes)", () => {
    const word = (i: number): string => `w${[0, 1, 2, 3].map((d) => String.fromCharCode(97 + (Math.floor(i / 26 ** d) % 26))).join("")}x`;
    const words = Array.from({ length: 20_000 }, (_, i) => word(i));
    const links = Array.from({ length: 20_000 }, (_, i) => `https://a.example/p${i}`);
    const { issues, ms } = parityOn(`範例 ${words.join(" ")} ${links.join(" ")}`);
    expect(ms).toBeLessThan(4000);
    expect(issues.map((i) => i.code)).toEqual(["ZH_PARITY"]);
    const message = issues[0]!.message;
    expect(message).toContain("the Chinese holds the links https://a.example/p0, https://a.example/p1, https://a.example/p2, https://a.example/p3, https://a.example/p4, https://a.example/p5 and 19994 more");
    expect(message).toContain(`the Chinese holds the Latin words ${words.slice(0, 6).join(", ")} and 19994 more, which the English lacks`);
    expect(message.length).toBeLessThan(700);
  });

  it("names a million numbers the English lacks once, and the one it has by none, in a few seconds at most (the earlier code took minutes)", () => {
    const { issues, ms } = parityOn(`範例 ${"1 ".repeat(1_000_000)}`, "It had 1 idea.");
    expect(ms).toBeLessThan(4000);
    expect(issues).toEqual([]);
    const extra = parityOn(`範例 ${"2 ".repeat(1_000_000)}`, "It had 1 idea.");
    expect(extra.ms).toBeLessThan(4000);
    expect(extra.issues.map((i) => i.message)).toEqual([`ideas.0: the English has 1, which the Chinese lacks; the Chinese has 2, which the English lacks. Chinese: "範例 ${"2 ".repeat(18)}2…".`]);
  });
});

describe("excerpt and around read the head of a text, never the whole of it", () => {
  const ASTRAL = String.fromCodePoint(0x20000);
  const EMOJI = String.fromCodePoint(0x1f600);
  const LONE_HIGH = String.fromCharCode(0xd800);
  const LONE_LOW = String.fromCharCode(0xdc00);
  /** Texts of every length from 0 to `most` characters of one kind, alone and with a lone surrogate at either end or between. */
  function textsOf(unit: string, most: number): string[] {
    const out: string[] = [];
    for (let n = 0; n <= most; n += 1) {
      const run = unit.repeat(n);
      out.push(run, `${LONE_HIGH}${run}`, `${run}${LONE_HIGH}`, `${LONE_LOW}${run}`, `${run}${LONE_LOW}`, `${run}${LONE_HIGH}${LONE_LOW}${run}`);
    }
    return out;
  }
  const UNITS = ["字", "a", ASTRAL, EMOJI, `字${ASTRAL}`, `${ASTRAL}a`];

  /** The longest string that `run` gives to Array.from (which both functions use to read by characters). */
  function longestRead(run: () => unknown): number {
    const real = Array.from;
    let longest = 0;
    const spy = vi.spyOn(Array, "from").mockImplementation(((input: ArrayLike<unknown>, ...rest: unknown[]) => {
      longest = Math.max(longest, input.length);
      return Reflect.apply(real, Array, [input, ...rest]) as unknown[];
    }) as typeof Array.from);
    try {
      run();
    } finally {
      spy.mockRestore();
    }
    return longest;
  }

  it("excerpt gives what it gave on every text of 0 to 2 * max + 4 characters, of every kind, for several limits", () => {
    for (const max of [1, 2, 12, 40, 60, 80]) {
      for (const unit of UNITS) {
        for (const text of textsOf(unit, 2 * max + 4)) expect(excerpt(text, max), `${JSON.stringify(text)} at ${max}`).toBe(oldExcerpt(text, max));
      }
    }
    expect(excerpt("")).toBe("");
    expect(excerpt("字".repeat(40))).toBe("字".repeat(40));
    expect(excerpt("字".repeat(41))).toBe(`${"字".repeat(40)}…`);
    expect(excerpt(ASTRAL.repeat(40))).toBe(ASTRAL.repeat(40));
    expect(excerpt(ASTRAL.repeat(41))).toBe(`${ASTRAL.repeat(40)}…`);
  });

  it("excerpt reads at most 2 * max + 1 units of a text, whatever its length", () => {
    for (const unit of ["範", ASTRAL]) {
      const text = unit.repeat(5_000_000);
      expect(longestRead(() => excerpt(text))).toBeLessThanOrEqual(81);
      expect(longestRead(() => excerpt(text, 12))).toBeLessThanOrEqual(25);
      expect(excerpt(text)).toBe(`${unit.repeat(40)}…`);
    }
    const huge = "範".repeat(10_000_000);
    const before = performance.now();
    excerpt(huge);
    expect(performance.now() - before).toBeLessThan(100);
  });

  it("around gives what it gave at every offset of every text of 0 to 30 characters, of every kind", () => {
    for (const unit of UNITS) {
      for (const text of textsOf(unit, 30)) {
        for (let at = 0; at <= text.length; at += 1) expect(around(text, at), `${JSON.stringify(text)} at ${at}`).toBe(oldAround(text, at));
      }
    }
  });

  it("around gives the ten characters before a hit and the twenty from it, with a mark where there are more, on a long text", () => {
    const text = `${"前".repeat(50)}${"中".repeat(50)}`;
    expect(around(text, 50)).toBe(`…${"前".repeat(10)}${"中".repeat(20)}…`);
    expect(around(text, 10)).toBe(`${"前".repeat(10)}${"前".repeat(20)}…`);
    expect(around(text, 0)).toBe(`${"前".repeat(20)}…`);
    expect(around(text, 100)).toBe(`…${"中".repeat(10)}`);
    expect(around(text, 11)).toBe(`…${"前".repeat(10)}${"前".repeat(20)}…`);
    expect(around(text, 80)).toBe(`…${"中".repeat(10)}${"中".repeat(20)}`);
    expect(around(text, 79)).toBe(`…${"中".repeat(10)}${"中".repeat(20)}…`);
    expect(around(`${ASTRAL.repeat(30)}`, 22)).toBe(oldAround(`${ASTRAL.repeat(30)}`, 22));
  });

  it("around reads at most 22 units before a hit and 41 from it, whatever the length of the text", () => {
    for (const unit of ["範", ASTRAL]) {
      const text = unit.repeat(5_000_000);
      const middle = text.length / 2;
      expect(longestRead(() => around(text, middle))).toBeLessThanOrEqual(41);
      expect(longestRead(() => around(text, 0))).toBeLessThanOrEqual(41);
      expect(longestRead(() => around(text, text.length))).toBeLessThanOrEqual(22);
      expect(around(text, middle)).toBe(`…${unit.repeat(10)}${unit.repeat(20)}…`);
    }
    const huge = "範".repeat(10_000_000);
    const before = performance.now();
    around(huge, 5_000_000);
    expect(performance.now() - before).toBeLessThan(100);
  });
});

// ── ZH_TRADITIONAL ───────────────────────────────────────────────────────────────────────────────

describe("ZH_TRADITIONAL: no simplified-only or Japanese-only character anywhere in the Chinese", () => {
  it("passes the characters Taiwan writes, which a simplified list must never hold", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", "台灣在後面的裡面乾了，準時制定才了勝係隻。");
    expect(zhIssues(w, "ZH_TRADITIONAL")).toEqual([]);
  });

  it("fails a simplified-only character in a string, naming the character, its code point and where it is", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", "一项关于方法的论点。");
    const issues = zhIssues(w, "ZH_TRADITIONAL");
    expect(issues.map((i) => i.path)).toEqual([KEY("ideas.0")]);
    expect(issues[0]!.message).toContain("simplified-only characters");
    expect(issues[0]!.message).toContain("项 (U+9879) at 1");
    expect(issues[0]!.message).toContain("一项关于方法的论点。");
  });

  it("writes a code point in at least four hex digits, though every listed character has that many already", () => {
    const w = zhWorld();
    const accent = String.fromCharCode(0xe9);
    w.config = { ...w.config, index: { ...w.config.index, simplifiedOnly: new Set([...w.config.index.simplifiedOnly, accent]) } };
    setZh(w, "ideas.0", `一段${accent}的文字。`);
    const issues = zhIssues(w, "ZH_TRADITIONAL");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain(`${accent} (U+00E9) at 2`);
  });

  it("fails a Japanese-only form, naming it as one", () => {
    const w = zhWorld();
    setZh(w, "ideas.0", "一項関於方法的論點。");
    const issues = zhIssues(w, "ZH_TRADITIONAL");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Japanese-only character 関 (U+95A2)");
  });

  it("reads the Chinese as written, with no NFKC: a compatibility form of a listed character is not that character", () => {
    // Each Kangxi radical below folds under NFKC to a listed simplified-only character, and no list holds the radical itself.
    const radicals = [0x2ef3, 0x2f09, 0x2f1a, 0x2f34, 0x2f46, 0x2f53, 0x2f79, 0x2faa].map((code) => String.fromCharCode(code)).join("");
    const folded = radicals.normalize("NFKC");
    const w = zhWorld();
    const listed = w.config.index.simplifiedOnly;
    expect([...folded].every((char) => listed.has(char))).toBe(true);
    expect([...radicals].some((char) => listed.has(char) || w.config.index.japaneseOnly.has(char))).toBe(false);
    setZh(w, "ideas.0", `一段文字${radicals}。`);
    expect(zhIssues(w, "ZH_TRADITIONAL")).toEqual([]);
    setZh(w, "ideas.0", `一段文字${folded}。`);
    const issues = zhIssues(w, "ZH_TRADITIONAL");
    expect(issues.map((i) => i.path)).toEqual([KEY("ideas.0")]);
    expect(issues[0]!.message).toContain("龟 (U+9F9F) at 4");
  });

  it("fails a character in every place the Chinese is: a term's zh, its definition and its official", () => {
    const w = zhWorld();
    const term = w.draft.terms["protein-folding"]!;
    term.zh = "蛋白质摺疊";
    term.definition = "一串氨基酸卷成形状。";
    term.official = "蛋白质折叠";
    term.official_url = OFFICIAL_URL;
    expect(pathsOf(w, "ZH_TRADITIONAL")).toEqual(["terms[\"protein-folding\"].definition", "terms[\"protein-folding\"].official", "terms[\"protein-folding\"].zh"]);
  });

  it("reads a key the context lacks too: the Chinese draft has no simplified character anywhere", () => {
    const w = zhWorld();
    w.draft.strings["extra.key"] = "这里有简体字。";
    expect(pathsOf(w, "ZH_TRADITIONAL")).toEqual([KEY("extra.key")]);
  });

  it("runs on the records being published: a finding's Chinese, a brief's, a term's official, but not on an archived one", () => {
    const w = publishedZhWorld();
    w.findings[0]!.title.zh = "范例蛋白质成果";
    w.brief.ideas[0]!.text.zh = "一项范例论点。";
    w.terms[0]!.zh!.official = "蛋白质折叠";
    w.terms[0]!.zh!.official_url = OFFICIAL_URL;
    expect(published(w, "ZH_TRADITIONAL").map((i) => i.path)).toEqual([
      "briefs/2026-11-24.json: ideas[0].text.zh", "findings/bio-2026-0001.json: title.zh", "glossary.json: terms[0].zh.official",
    ]);
    expect(published(w, "ZH_TRADITIONAL", null)).toEqual([]);
    expect(published(w, "ZH_TRADITIONAL", "2026-11-25")).toEqual([]);
  });
});

// ── ZH_AVOID ─────────────────────────────────────────────────────────────────────────────────────

describe("ZH_AVOID: no mainland term once the fixed translations and allow_in strings are masked", () => {
  const avoid = (zh: string): ValidationIssue[] => {
    const w = zhWorld();
    setZh(w, "ideas.0", zh);
    return zhIssues(w, "ZH_AVOID");
  };

  it("passes 演算法, 納米比亞 and 電視頻道, and fails 算法 on its own, naming the Taiwan term", () => {
    expect(avoid("一項關於演算法的論點。")).toEqual([]);
    expect(avoid("一項關於納米比亞的論點。")).toEqual([]);
    expect(avoid("一項關於電視頻道的論點。")).toEqual([]);
    const issues = avoid("一項關於算法的論點。");
    expect(issues.map((i) => i.path)).toEqual([KEY("ideas.0")]);
    expect(issues[0]!.message).toContain('"算法" at 4 (Taiwan writes "演算法")');
    expect(issues[0]!.message).toContain("一項關於算法的論點。");
  });

  it("reads the text as written and shows it as written: a character that is longer under NFKC moves no hit", () => {
    // U+3231 (a company sign) is one character here and three, (株), under NFKC; the hit after it must stay at its own offset.
    const sign = String.fromCharCode(0x3231);
    const issues = avoid(`${sign}的軟件很好。`);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('"軟件" at 2 (Taiwan writes "軟體")');
    expect(issues[0]!.message).toContain(`Chinese: "${sign}的軟件很好。".`);
  });

  it("names every hit with its Taiwan term", () => {
    const issues = avoid("軟件和視頻都用了激光。");
    expect(issues).toHaveLength(1);
    for (const hit of ['"軟件" at 0 (Taiwan writes "軟體")', '"視頻" at 3 (Taiwan writes "影片")', '"激光" at 8 (Taiwan writes "雷射")']) expect(issues[0]!.message).toContain(hit);
  });

  it("reads a term's zh and its definition, and not its official", () => {
    const w = zhWorld();
    const term = w.draft.terms["protein-folding"]!;
    term.zh = "蛋白質摺疊算法";
    term.definition = "一個芯片上的過程。";
    term.official = "硅";
    term.official_url = OFFICIAL_URL;
    expect(pathsOf(w, "ZH_AVOID")).toEqual(['terms["protein-folding"].definition', 'terms["protein-folding"].zh']);
  });

  it("reads a key the context lacks", () => {
    const w = zhWorld();
    w.draft.strings["extra.key"] = "一個互聯網的句子。";
    expect(pathsOf(w, "ZH_AVOID")).toEqual([KEY("extra.key")]);
  });

  it("runs on the records being published and not on an archived one", () => {
    const w = publishedZhWorld();
    w.brief.also[0]!.title.zh = "一項關於數據庫的研究";
    expect(published(w, "ZH_AVOID").map((i) => i.path)).toEqual(["briefs/2026-11-24.json: also[0].title.zh"]);
    expect(published(w, "ZH_AVOID", null)).toEqual([]);
  });
});

// ── ZH_TERMS ─────────────────────────────────────────────────────────────────────────────────────

describe("ZH_TERMS: wherever a fixed entry applies, the Chinese contains the entry's zh", () => {
  const terms = (en: string, zh: string, field: FieldId | null = null): ValidationIssue[] => {
    const w = zhWorld();
    setPair(w, "ideas.0", en, zh, field);
    return zhIssues(w, "ZH_TERMS");
  };
  const listed = (en: string, field: FieldId | null): string[] => {
    const w = zhWorld();
    setPair(w, "ideas.0", en, "略", field);
    return w.context.fixed.filter((f) => f.keys.includes("ideas.0")).map((f) => f.en);
  };

  it("passes blood plasma as 血漿 in a chemistry finding, which needs no 電漿, and plasma as 血漿 in a biology one", () => {
    expect(listed("Blood plasma carries it.", "chemistry")).toEqual(["blood plasma"]);
    expect(terms("Blood plasma carries it.", "血漿攜帶它。", "chemistry")).toEqual([]);
    expect(listed("The plasma carries it.", "biology")).toEqual([]);
    expect(terms("The plasma carries it.", "血漿攜帶它。", "biology")).toEqual([]);
  });

  it("fails plasma in a physics finding without 電漿, and passes it with 電漿", () => {
    expect(listed("The plasma carries it.", "physics")).toEqual(["plasma"]);
    const issues = terms("The plasma carries it.", "血漿攜帶它。", "physics");
    expect(issues.map((i) => i.path)).toEqual([KEY("ideas.0")]);
    expect(issues[0]!.message).toContain('"plasma"');
    expect(issues[0]!.message).toContain("電漿");
    expect(terms("The plasma carries it.", "電漿攜帶它。", "physics")).toEqual([]);
  });

  it("passes business model as 商業模式, which needs no 模型 outside its except phrases, and fails it without", () => {
    expect(listed("A business model.", null)).toEqual(["business model"]);
    expect(terms("A business model.", "一個商業模式。")).toEqual([]);
    expect(terms("A business model.", "一個模式。")).toHaveLength(1);
    expect(terms("A model of it.", "它的模型。")).toEqual([]);
    expect(terms("A model of it.", "它的樣子。")).toHaveLength(1);
  });

  it("passes a Protein Data Bank kept in English, letter for letter, and fails the name written in Chinese without 蛋白質", () => {
    expect(terms("The Protein Data Bank holds it.", "Protein Data Bank 收錄了它。")).toEqual([]);
    expect(terms("The Protein Data Bank holds it.", "蛋白質資料庫收錄了它。")).toEqual([]);
    expect(terms("The Protein Data Bank holds it.", "資料庫收錄了它。")).toHaveLength(1);
    expect(terms("The protein data holds it.", "Protein Data 收錄了它。")).toHaveLength(1);
  });

  it("fails algorithm without 演算法 and passes it with, with the Chinese text in the message", () => {
    const issues = terms("The algorithm works.", "這個方法有效。");
    expect(issues.map((i) => i.path)).toEqual([KEY("ideas.0")]);
    expect(issues[0]!.message).toContain("ideas.0");
    expect(issues[0]!.message).toContain('"algorithm"');
    expect(issues[0]!.message).toContain("演算法");
    expect(issues[0]!.message).toContain("這個方法有效。");
    expect(terms("The algorithm works.", "這個演算法有效。")).toEqual([]);
  });

  it("gives one issue for each entry missing and none for a plural or another case of the English", () => {
    expect(terms("The algorithm and the dataset.", "兩個東西。")).toHaveLength(2);
    expect(terms("Algorithms and Datasets.", "兩個東西。")).toHaveLength(2);
    expect(terms("Algorithms and Datasets.", "演算法與資料集。")).toEqual([]);
  });

  it("judges a term's zh and definition together where its English term or definition has the entry", () => {
    const w = zhWorld();
    w.context.terms[0]!.definition = "How a chain of amino acids curls into a shape.";
    refreshFixed(w);
    const term = w.draft.terms["protein-folding"]!;
    // The English name holds "protein folding" and "protein"; its definition holds "amino acid".
    term.zh = "蛋白質摺疊";
    term.definition = "一串胺基酸捲成形狀。";
    expect(zhIssues(w, "ZH_TERMS")).toEqual([]);
    term.definition = "一串東西捲成形狀。";
    let issues = zhIssues(w, "ZH_TERMS");
    expect(issues.map((i) => i.path)).toEqual(['terms["protein-folding"]']);
    expect(issues[0]!.message).toContain("terms.protein-folding");
    expect(issues[0]!.message).toContain('"amino acid"');
    expect(issues[0]!.message).toContain("胺基酸");
    expect(issues[0]!.message).toContain("蛋白質摺疊 / 一串東西捲成形狀。");
    // Together: the entry in the Chinese name serves as the entry in the definition would.
    term.zh = "蛋白質摺疊（胺基酸）";
    expect(zhIssues(w, "ZH_TERMS")).toEqual([]);
    // And the other way: the definition carries the entries of the name.
    term.zh = "摺疊";
    term.definition = "蛋白質摺疊：一串胺基酸捲成形狀。";
    expect(zhIssues(w, "ZH_TERMS")).toEqual([]);
    term.definition = "一串胺基酸捲成形狀。";
    issues = zhIssues(w, "ZH_TERMS");
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.path === 'terms["protein-folding"]')).toBe(true);
    expect(issues.map((i) => /"(protein folding|protein)"/.exec(i.message)![1])).toEqual(["protein folding", "protein"]);
  });

  it("reads the entries the context lists for a key and no others: an entry it does not list is not checked", () => {
    const w = zhWorld();
    setEn(w, "ideas.0", "The algorithm works.");
    setZh(w, "ideas.0", "這個方法有效。");
    expect(zhIssues(w, "ZH_TERMS")).toEqual([]);
    refreshFixed(w);
    expect(zhIssues(w, "ZH_TERMS")).toHaveLength(1);
  });

  it("re-reads the except phrases of config/terms-zh.json: a listed key whose English holds an except phrase is not an occurrence", () => {
    const w = zhWorld();
    setEn(w, "ideas.0", "A model organism.");
    setZh(w, "ideas.0", "一種動物。");
    w.context.fixed.push({ en: "model", zh: "模型", keys: ["ideas.0"] });
    expect(zhIssues(w, "ZH_TERMS")).toEqual([]);
  });

  it("skips a listed key or term the draft lacks and one the context lacks, which ZH_KEYS reports", () => {
    const w = zhWorld();
    w.context.fixed.push({ en: "algorithm", zh: "演算法", keys: ["no.such.key", "terms.no-such-term", "terms.enzyme"] });
    setEn(w, "ideas.0", "The algorithm works.");
    w.context.fixed.push({ en: "algorithm", zh: "演算法", keys: ["ideas.0"] });
    delete w.draft.strings["ideas.0"];
    delete w.draft.terms["protein-folding"];
    w.context.fixed.push({ en: "protein folding", zh: "蛋白質摺疊", keys: ["terms.protein-folding"] });
    expect(zhIssues(w, "ZH_TERMS")).toEqual([]);
    expect(codesOf(zhRun(w))).toEqual(["ZH_KEYS"]);
  });

  it("reads a fixed entry applying to a backlog string, a correction and a report like any other key", () => {
    const w = zhWorld();
    addString(w, { key: "backlog.chem-2025-0001.title", en: "A new material", zh: "一種新東西", kind: "title", cap: 22, field: "chemistry" });
    addString(w, { key: "backlog.math-2025-0009.title", en: "A new material", zh: "一種新東西", kind: "title", cap: 22, field: "mathematics" });
    expect(zhIssues(w, "ZH_TERMS").map((i) => i.path)).toEqual([KEY("backlog.chem-2025-0001.title")]);
    setZh(w, "corrections.1.reason", "領域有誤。");
    setEn(w, "corrections.1.reason", "The algorithm was wrong.");
    refreshFixed(w);
    expect(zhIssues(w, "ZH_TERMS").map((i) => i.path)).toEqual([KEY("backlog.chem-2025-0001.title"), KEY("corrections.1.reason")]);
  });

  describe("on the records being published", () => {
    const fixedStored = (): PublishedZhWorld => {
      const w = publishedZhWorld();
      w.brief.ideas[0]!.text = lz("An algorithm of a made-up kind.", "一種杜撰的方法。");
      return w;
    };

    it("fails a stored pair whose English has an entry and whose Chinese lacks it, and passes it with the entry", () => {
      const w = fixedStored();
      const issues = published(w, "ZH_TERMS");
      expect(issues.map((i) => i.path)).toEqual(["briefs/2026-11-24.json: ideas[0].text.zh"]);
      expect(issues[0]!.message).toContain("演算法");
      w.brief.ideas[0]!.text.zh = "一種杜撰的演算法。";
      expect(published(w, "ZH_TERMS")).toEqual([]);
    });

    it("does not read an archived record: the brief and findings that are not the ones being published", () => {
      const w = fixedStored();
      expect(published(w, "ZH_TERMS", null)).toEqual([]);
      expect(published(w, "ZH_TERMS", "2026-11-25")).toEqual([]);
    });

    it("applies an entry by the field the finding had as first published: lemma in mathematics but not in biology", () => {
      const w = publishedZhWorld();
      w.findings[0]!.explainer.found = lz("A new lemma.", "一個新東西。");
      expect(published(w, "ZH_TERMS")).toEqual([]);
      w.findings[1]!.explainer.found = lz("A new lemma.", "一個新東西。");
      const issues = published(w, "ZH_TERMS");
      expect(issues.map((i) => i.path)).toEqual(["findings/math-2026-0002.json: explainer.found.zh"]);
      expect(issues[0]!.message).toContain("引理");
      w.findings[1]!.explainer.found = lz("A new lemma.", "一個新引理。");
      expect(published(w, "ZH_TERMS")).toEqual([]);
    });

    it("reads a correction's after by the field its finding was filed with on the correction's date, and the finding's own text as first published", () => {
      const w = publishedZhWorld();
      // phys-2026-0003 was first published in physics, and C-0002 (dated D) files it in chemistry; "sequencing" is for chemistry and biology.
      w.findings[2] = storedFinding("phys-2026-0003", { depth: "item", first_brief: D, briefs: [D], terms: [], explainer: { ...w.findings[2]!.explainer, found: lz("The sequencing was new.", "新的測序。") } });
      expect(published(w, "ZH_TERMS")).toEqual([]);
      const correction = (finding: string): Correction => Correction.parse({
        id: "C-0003", date: D, finding_id: finding, edition_date: null, term_id: null, type: "correction", path: "explainer.found",
        before: l("before"), after: lz("The sequencing was new.", "新的測序。"), reason: lz("The text was wrong.", "文字有誤。"),
        source_url: null, trigger: "editor", report_id: null,
      });
      w.corrections.push(correction("phys-2026-0003"));
      const issues = published(w, "ZH_TERMS");
      expect(issues.map((i) => i.path)).toEqual(["corrections.json: corrections[2].after.zh"]);
      expect(issues[0]!.message).toContain("定序");
      w.corrections[2] = correction("math-2026-0002");
      expect(published(w, "ZH_TERMS")).toEqual([]);
    });

    it("applies no entry that is limited by field to a string about a finding the records do not hold, and does to one they do", () => {
      const w = publishedZhWorld();
      const about = (finding: string): Correction => Correction.parse({
        id: "C-0003", date: D, finding_id: finding, edition_date: null, term_id: null, type: "correction", path: "explainer.found",
        before: l("before"), after: lz("The sequencing was new.", "新的測序。"), reason: lz("The text was wrong.", "文字有誤。"),
        source_url: null, trigger: "editor", report_id: null,
      });
      w.corrections.push(about("chem-2026-0099"));
      expect(published(w, "ZH_TERMS")).toEqual([]);
      w.corrections[2] = about("bio-2026-0001");
      const issues = published(w, "ZH_TERMS");
      expect(issues.map((i) => i.path)).toEqual(["corrections.json: corrections[2].after.zh"]);
      expect(issues[0]!.message).toContain("定序");
    });

    it("applies only an entry with no fields to a string of no finding, and never reads a correction's before", () => {
      const w = publishedZhWorld();
      const make = (before: ReturnType<typeof lz>, reason: ReturnType<typeof lz>): Correction => Correction.parse({
        id: "C-0003", date: D, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "explainer.found",
        before, after: lz("Sample found text.", "範例發現。"), reason, source_url: null, trigger: "editor", report_id: null,
      });
      w.corrections.push(make(lz("The algorithm was here.", "舊的方法在這裡。"), lz("The plasma was wrong.", "文字有誤。")));
      expect(published(w, "ZH_TERMS")).toEqual([]);
      w.corrections[2] = make(lz("Before.", "之前。"), lz("The algorithm was wrong.", "文字有誤。"));
      const issues = published(w, "ZH_TERMS");
      expect(issues.map((i) => i.path)).toEqual(["corrections.json: corrections[2].reason.zh"]);
    });

    it("reads a glossary term's Chinese name and definition together, once for each entry missing", () => {
      const w = publishedZhWorld();
      expect(published(w, "ZH_TERMS")).toEqual([]);
      w.terms[0]!.zh!.term = "摺疊";
      w.terms[0]!.zh!.definition = "一串東西捲成立體形狀的過程。";
      const issues = published(w, "ZH_TERMS");
      expect(issues).toHaveLength(3);
      expect(issues.every((i) => i.path === "glossary.json: terms[0].zh.term")).toBe(true);
      expect(issues.map((i) => i.message).join(" ")).toContain("glossary term protein-folding");
      expect(published(w, "ZH_TERMS", null)).toEqual([]);
    });

    it("judges a string a stored removed correction names while the record still holds other text there, and has nothing to judge in REMOVED_TEXT", () => {
      const w = fixedStored();
      w.corrections.push(Correction.parse({
        id: "C-0003", date: D, finding_id: null, edition_date: D, term_id: null, type: "removed", path: "ideas.0.text",
        before: lz("[removed text]", "〔已移除的文字〕"), after: lz("This text was removed.", "此處文字已移除。"), reason: l("A removal."),
        source_url: null, trigger: "recheck", report_id: null,
      }));
      // the correction alone skips nothing (SPEC §4.12 "Removed text": only text that IS the marker is skipped)
      expect(published(w, "ZH_TERMS").map((i) => i.path)).toEqual(["briefs/2026-11-24.json: ideas[0].text.zh"]);
      w.brief.ideas[0]!.text = lz("This text was removed.", "此處文字已移除。");
      expect(published(w, "ZH_TERMS")).toEqual([]);
    });
  });
});

// ── ZH_RUNG_LABEL ────────────────────────────────────────────────────────────────────────────────

describe("ZH_RUNG_LABEL: a how_sure that starts with a rung's label starts in Chinese with that rung's zh label", () => {
  const HOW_SURE = "new.new-1.explainer.how_sure";
  const label = (en: string, zh: string): ValidationIssue[] => {
    const w = zhWorld();
    setEn(w, HOW_SURE, en);
    setZh(w, HOW_SURE, zh);
    return zhIssues(w, "ZH_RUNG_LABEL");
  };

  it("passes each rung's zh label from RUNGS and FELL_RUNGS and fails a fresh translation of it", () => {
    const fresh: Record<string, string> = {
      claimed: "聲稱", preprint: "預刊本", checked: "經查核", confirmed: "已確認", applied: "已使用", disputed: "有爭論", retracted: "已收回",
    };
    expect(ALL_RUNGS).toHaveLength(7);
    for (const rung of ALL_RUNGS) {
      const { en, zh } = RUNG_INFO[rung];
      expect(label(`${en} by Example Journal.`, `${zh}，來源是 Example Journal。`), rung).toEqual([]);
      const issues = label(`${en} by Example Journal.`, `${fresh[rung]}，來源是 Example Journal。`);
      expect(issues.map((i) => i.path), rung).toEqual([KEY(HOW_SURE)]);
      expect(issues[0]!.message).toContain(`"${en}"`);
      expect(issues[0]!.message).toContain(zh);
      expect(issues[0]!.message).toContain(fresh[rung]!);
    }
  });

  it("reads the label as WHO_SAYS does: then no letter or digit", () => {
    expect(label("Checked.", "已查核。")).toEqual([]);
    expect(label("Checked: by a lab.", "經查核：由實驗室。")).toHaveLength(1);
    expect(label("Checkedly it is.", "查核過了。")).toEqual([]);
    expect(label("Checked2 it is.", "查核過了。")).toEqual([]);
    expect(label("Not Checked yet.", "尚未查核。")).toEqual([]);
    expect(label("checked by a lab.", "由實驗室查核。")).toEqual([]);
  });

  it("needs the Chinese to start with the label itself: a space, a full-width space or a mark before it fails", () => {
    expect(label("Checked by a lab.", "已查核，由實驗室。")).toEqual([]);
    expect(label("Checked by a lab.", " 已查核，由實驗室。")).toHaveLength(1);
    expect(label("Checked by a lab.", "\u3000已查核，由實驗室。")).toHaveLength(1);
    expect(label("Checked by a lab.", "「已查核」，由實驗室。")).toHaveLength(1);
    expect(label("Checked by a lab.", "由實驗室已查核。")).toHaveLength(1);
  });

  it("asks nothing of a how_sure that starts with no label", () => {
    expect(label("Two labs agree.", "兩個實驗室一致。")).toEqual([]);
  });

  it("reads only a how_sure: a found, a title or an idea that starts with a label is no one's", () => {
    const w = zhWorld();
    setEn(w, "new.new-1.explainer.found", "Checked by Example Journal.");
    setZh(w, "new.new-1.explainer.found", "由 Example Journal 查核。");
    setEn(w, "ideas.0", "Confirmed by it.");
    setZh(w, "ideas.0", "它確認過。");
    expect(zhIssues(w, "ZH_RUNG_LABEL")).toEqual([]);
  });

  it("reads a backlog finding's how_sure", () => {
    const w = zhWorld();
    addString(w, { key: "backlog.math-2025-0009.explainer.how_sure", en: "Confirmed by a proof assistant.", zh: "經證實，由證明助手檢查。", kind: "part" });
    const issues = zhIssues(w, "ZH_RUNG_LABEL");
    expect(issues.map((i) => i.path)).toEqual([KEY("backlog.math-2025-0009.explainer.how_sure")]);
    expect(issues[0]!.message).toContain("已證實");
    setZh(w, "backlog.math-2025-0009.explainer.how_sure", "已證實，由證明助手檢查。");
    expect(zhIssues(w, "ZH_RUNG_LABEL")).toEqual([]);
  });

  it("reads a correction's after on explainer.how_sure and no other correction's", () => {
    const w = zhWorld();
    setZh(w, "corrections.3.after", "經查核，來源是 Example Journal 與另一個實驗室。");
    expect(zhIssues(w, "ZH_RUNG_LABEL").map((i) => i.path)).toEqual([KEY("corrections.3.after")]);
    w.english.corrections[3]!.path = "explainer.found";
    expect(zhIssues(w, "ZH_RUNG_LABEL")).toEqual([]);
    w.english.corrections[3]!.path = "explainer.how_sure";
    setZh(w, "corrections.3.after", "已查核，來源是 Example Journal 與另一個實驗室。");
    expect(zhIssues(w, "ZH_RUNG_LABEL")).toEqual([]);
  });

  it("skips a key the draft lacks, which ZH_KEYS reports", () => {
    const w = zhWorld();
    delete w.draft.strings[HOW_SURE];
    expect(zhIssues(w, "ZH_RUNG_LABEL")).toEqual([]);
  });

  it("does not run on a stored record: JL may change a label by PR, so a stored how_sure keeps the label it was written with", () => {
    const w = publishedZhWorld();
    w.findings[0]!.explainer.how_sure.zh = "經查核，來源是 Example Journal。";
    expect(published(w, "ZH_RUNG_LABEL")).toEqual([]);
  });

  it("is the check the seeder reads: rungLabelProblem() names the rung, the English label and the Chinese one", () => {
    expect(rungLabelProblem("Checked by a lab.", "已查核，由實驗室。")).toBeNull();
    expect(rungLabelProblem("Checked by a lab.", "經查核。")).toEqual({ rung: "checked", english: "Checked", label: "已查核" });
    expect(rungLabelProblem("Retracted by the journal.", "撤稿。")).toEqual({ rung: "retracted", english: "Retracted", label: "已撤稿" });
    expect(rungLabelProblem("Two labs agree.", "")).toBeNull();
  });
});

// ── ZH_ENGLISH_ONCE ──────────────────────────────────────────────────────────────────────────────

describe("ZH_ENGLISH_ONCE: each term appears, its first use carries the English in full-width brackets, no later use does, no title does", () => {
  const FOUND = "new.new-1.explainer.found";
  const MATTERS = "new.new-1.explainer.matters";
  const once = (w: ZhWorld): ValidationIssue[] => zhIssues(w, "ZH_ENGLISH_ONCE");

  it("passes the first use of each term bracketed once, in the first part that uses it", () => {
    const w = zhWorld();
    expect(w.draft.strings[FOUND]).toContain("蛋白質摺疊（protein folding）");
    expect(once(w)).toEqual([]);
    setZh(w, FOUND, "系統找出酵素（enzyme）的運作方式。");
    setZh(w, MATTERS, "蛋白質摺疊（protein folding）很重要。");
    expect(once(w)).toEqual([]);
  });

  it("fails a term the Chinese explainer never uses, saying how to write it", () => {
    const w = zhWorld();
    setZh(w, FOUND, "系統找出酵素（enzyme）的運作方式。");
    const issues = once(w);
    expect(issues.map((i) => i.path)).toEqual([KEY(FOUND)]);
    expect(issues[0]!.message).toContain('"protein folding"');
    expect(issues[0]!.message).toContain("蛋白質摺疊（protein folding）");
  });

  it("fails a first use with no English after it, and one with half-width brackets", () => {
    const w = zhWorld();
    setZh(w, FOUND, "系統找出蛋白質摺疊在酵素（enzyme）中的運作方式。");
    let issues = once(w);
    expect(issues.map((i) => i.path)).toEqual([KEY(FOUND)]);
    expect(issues[0]!.message).toContain("full-width brackets");
    expect(issues[0]!.message).toContain("蛋白質摺疊（protein folding）");
    setZh(w, FOUND, "系統找出蛋白質摺疊(protein folding)在酵素（enzyme）中的運作方式。");
    issues = once(w);
    expect(issues).toHaveLength(1);
    setZh(w, FOUND, "系統找出蛋白質摺疊 （ protein  Folding ）在酵素（enzyme）中的運作方式。");
    expect(once(w)).toHaveLength(1);
    setZh(w, FOUND, "系統找出蛋白質摺疊（ protein  Folding ）在酵素（enzyme）中的運作方式。");
    expect(once(w)).toEqual([]);
  });

  it("reads the first use in part order, not the first part that has one in the right place", () => {
    const w = zhWorld();
    setZh(w, FOUND, "系統找出酵素（enzyme）的運作方式。");
    setZh(w, MATTERS, "蛋白質摺疊很重要。");
    setZh(w, "new.new-1.explainer.background", "蛋白質摺疊（protein folding）是背景。");
    const issues = once(w);
    expect(issues.map((i) => [i.path, i.message.includes("is not followed by")])).toEqual([
      [KEY("new.new-1.explainer.background"), false], [KEY(MATTERS), true],
    ]);
    expect(issues[0]!.message).toContain("later use");
  });

  it("fails a later use that repeats the English, in either bracket width", () => {
    const w = zhWorld();
    setZh(w, MATTERS, "蛋白質摺疊（protein folding）很重要。");
    let issues = once(w);
    expect(issues.map((i) => i.path)).toEqual([KEY(MATTERS)]);
    expect(issues[0]!.message).toContain("Remove （protein folding）");
    setZh(w, MATTERS, "蛋白質摺疊(protein folding)很重要。");
    expect(once(w)).toHaveLength(1);
    setZh(w, MATTERS, "蛋白質摺疊很重要。");
    expect(once(w)).toEqual([]);
  });

  it("fails a title that carries a term's English in brackets", () => {
    const w = zhWorld();
    setZh(w, "new.new-1.title", "蛋白質摺疊（protein folding）成果");
    const issues = once(w);
    expect(issues.map((i) => i.path)).toEqual([KEY("new.new-1.title")]);
    expect(issues[0]!.message).toContain("title");
    setZh(w, "new.new-1.title", "蛋白質摺疊成果");
    expect(once(w)).toEqual([]);
  });

  // The order the context lists its terms in must not matter: the shorter term may come before or after the longer one.
  const PLACES = ["before", "after"] as const;
  const addProtein = (w: ZhWorld, place: (typeof PLACES)[number]): void => {
    const protein = { id: "protein", en: "protein", definition: "A chain of amino acids.", zh: "蛋白質", official: null, cap_chars: 72 };
    if (place === "before") w.context.terms.unshift(protein);
    else w.context.terms.push(protein);
  };

  for (const place of PLACES) {
    it(`counts a use as the term's Chinese longest term first, whether the shorter term is listed ${place} the longer: 蛋白質 inside 蛋白質摺疊 is a use of the longer term alone`, () => {
      const w = zhWorld();
      addProtein(w, place);
      expect(once(w)).toEqual([]);
      setEn(w, MATTERS, "A protein matters.");
      setZh(w, MATTERS, "蛋白質很重要。");
      let issues = once(w);
      expect(issues.map((i) => i.path)).toEqual([KEY(MATTERS)]);
      expect(issues[0]!.message).toContain("蛋白質（protein）");
      setZh(w, MATTERS, "蛋白質（protein）很重要。");
      expect(once(w)).toEqual([]);
      setZh(w, MATTERS, "很重要。");
      issues = once(w);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain('never uses the term "protein"');
    });

    it(`blanks a longer term's use whole before it looks for a shorter one (listed ${place} it), so a use of the shorter one at the very start of the text still counts`, () => {
      const w = zhWorld();
      addProtein(w, place);
      setEn(w, MATTERS, "protein is studied, and protein folding is hard.");
      setZh(w, MATTERS, "蛋白質摺疊很難。");
      const issues = once(w);
      expect(issues.map((i) => i.path)).toEqual([KEY(FOUND)]);
      expect(issues[0]!.message).toContain('never uses the term "protein"');
      setZh(w, MATTERS, "蛋白質（protein）受到研究，蛋白質摺疊很難。");
      expect(once(w)).toEqual([]);
    });
  }

  it("needs no brackets where the term's Chinese is its English, such as CRISPR, and still needs the term to appear", () => {
    const w = zhWorld();
    w.context.terms.push({ id: "crispr", en: "CRISPR", definition: "A gene editing tool.", zh: "CRISPR", official: null, cap_chars: 72 });
    setEn(w, MATTERS, "CRISPR matters.");
    setZh(w, MATTERS, "CRISPR 很重要。");
    expect(once(w)).toEqual([]);
    setZh(w, MATTERS, "很重要。");
    const issues = once(w);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Use CRISPR where");
    expect(issues[0]!.message).not.toContain("CRISPR（CRISPR）");
  });

  it("reads a term's Chinese as its English when they differ in case or in the spaces around them, as the check does", () => {
    for (const zh of ["Crispr", "crispr", " CRISPR", "CRISPR "]) {
      const w = zhWorld();
      w.context.terms.push({ id: "crispr", en: "CRISPR", definition: "A gene editing tool.", zh, official: null, cap_chars: 72 });
      setEn(w, MATTERS, "CRISPR matters.");
      setZh(w, MATTERS, "很重要。");
      const issues = once(w);
      expect(issues, zh).toHaveLength(1);
      expect(issues[0]!.message, zh).toContain(`Use ${zh} where`);
      expect(issues[0]!.message, zh).not.toContain("（CRISPR）");
    }
    const w = zhWorld();
    w.context.terms.push({ id: "crispr", en: "CRISPR", definition: "A gene editing tool.", zh: "基因剪刀", official: null, cap_chars: 72 });
    setEn(w, MATTERS, "CRISPR matters.");
    setZh(w, MATTERS, "很重要。");
    expect(once(w)[0]!.message).toContain("Use 基因剪刀（CRISPR） where");
  });

  describe("two terms that share one Chinese rendering are one group, as the config's pairs such as dataset and data set are (F-62)", () => {
    const pair = (w: ZhWorld): void => {
      w.context.terms.push(
        { id: "dataset", en: "dataset", definition: "A set of data.", zh: "資料集", official: null, cap_chars: 72 },
        { id: "data-set", en: "data set", definition: "A set of data.", zh: "資料集", official: null, cap_chars: 72 },
      );
      setEn(w, MATTERS, "The dataset, or data set, matters.");
    };

    it("is met by one bracket after the first use, which holds either English, and is no problem for the pass to fix", () => {
      for (const english of ["dataset", "data set"]) {
        const w = zhWorld();
        pair(w);
        setZh(w, MATTERS, `資料集（${english}）很重要。`);
        expect(once(w), english).toEqual([]);
      }
    });

    it("tells a missing bracket once, at the first use, for the group's first term; and a missing use once", () => {
      const w = zhWorld();
      pair(w);
      setZh(w, MATTERS, "資料集很重要。");
      let issues = once(w);
      expect(issues.map((i) => i.path)).toEqual([KEY(MATTERS)]);
      expect(issues[0]!.message).toContain("資料集（dataset）");
      setZh(w, MATTERS, "資料集（corpus）很重要。");
      expect(once(w)).toHaveLength(1);
      setZh(w, MATTERS, "很重要。");
      issues = once(w);
      expect(issues.map((i) => i.path)).toEqual([KEY(FOUND)]);
      expect(issues[0]!.message).toContain('never uses the term "dataset"');
    });

    it("refuses a later use that repeats the English of either term, naming the one it repeats", () => {
      const w = zhWorld();
      pair(w);
      setZh(w, FOUND, "系統找出蛋白質摺疊（protein folding）在酵素（enzyme）中的運作方式，也用到資料集（dataset）。");
      setZh(w, MATTERS, "資料集（data set）很重要。");
      const issues = once(w);
      expect(issues.map((i) => i.path)).toEqual([KEY(MATTERS)]);
      expect(issues[0]!.message).toContain("Remove （data set）");
    });
  });

  it("asks a finding only for the terms its English explainer uses: a term the other finding uses is not asked of this one", () => {
    const w = zhWorld();
    expect(w.draft.strings["new.new-2.explainer.found"]).not.toContain("酵素");
    setZh(w, "new.new-2.title", "酵素（enzyme）檢查");
    expect(once(w)).toEqual([]);
    setEn(w, "new.new-2.explainer.found", "The enzyme helps.");
    setZh(w, "new.new-2.explainer.found", "酵素有幫助。");
    expect(once(w).map((i) => i.path)).toEqual([KEY("new.new-2.explainer.found"), KEY("new.new-2.title")]);
  });

  it("uses the Chinese the draft gives a null-zh term, and skips a term that has none yet", () => {
    const w = zhWorld();
    w.draft.terms["protein-folding"]!.zh = "摺疊蛋白";
    expect(once(w).map((i) => i.path)).toEqual([KEY(FOUND)]);
    setZh(w, FOUND, "系統找出摺疊蛋白（protein folding）在酵素（enzyme）中的運作方式。");
    expect(once(w)).toEqual([]);
    delete w.draft.terms["protein-folding"];
    expect(once(w)).toEqual([]);
    expect(codesOf(zhRun(w).filter((i) => i.severity === "error"))).toContain("ZH_KEYS");
  });

  it("reads each backlog finding whose explainer it translates, as it reads a new finding", () => {
    const w = zhWorld();
    const parts: [string, string, string][] = [
      ["found", "The enzyme works.", "酵素有效。"], ["matters", "It matters.", "它很重要。"], ["how_sure", "It was checked.", "它查核過。"],
      ["background", "It has a past.", "它有過去。"], ["could_lead", "It may lead on.", "它可能延續。"],
    ];
    for (const [part, en, zh] of parts) addString(w, { key: `backlog.bio-2025-0003.explainer.${part}`, en, zh, kind: "part", cap: 180, group: { id: "backlog.bio-2025-0003.explainer", cap_chars: 180 } });
    addString(w, { key: "backlog.bio-2025-0003.title", en: "An enzyme result", zh: "酵素（enzyme）成果", kind: "title", cap: 22 });
    const paths = once(w).map((i) => i.path);
    expect(paths).toEqual([KEY("backlog.bio-2025-0003.explainer.found"), KEY("backlog.bio-2025-0003.title")]);
    setZh(w, "backlog.bio-2025-0003.explainer.found", "酵素（enzyme）有效。");
    setZh(w, "backlog.bio-2025-0003.title", "酵素成果");
    expect(once(w)).toEqual([]);
  });

  it("asks nothing of a backlog finding whose explainer is only partly in the context: its other parts are stored, or were removed", () => {
    const w = zhWorld();
    addString(w, { key: "backlog.bio-2025-0003.explainer.found", en: "The enzyme works.", zh: "酵素有效。", kind: "part", cap: 180 });
    addString(w, { key: "backlog.bio-2025-0003.explainer.matters", en: "It matters.", zh: "它很重要。", kind: "part", cap: 180 });
    expect(once(w)).toEqual([]);
    setZh(w, "backlog.bio-2025-0003.explainer.matters", "酵素（enzyme）很重要。");
    expect(once(w).map((i) => i.path)).toEqual([KEY("backlog.bio-2025-0003.explainer.matters")]);
  });

  it("skips a finding whose explainer is not whole in the draft: a missing part is ZH_KEYS's", () => {
    const w = zhWorld();
    delete w.draft.strings[MATTERS];
    setZh(w, FOUND, "系統找出酵素的運作方式。");
    expect(once(w)).toEqual([]);
  });

  describe("on every stored record", () => {
    const FOUND_AT = "findings/bio-2026-0001.json: explainer.found.zh";

    it("passes a stored finding whose explainer uses its listed term bracketed once", () => {
      expect(published(publishedZhWorld(), "ZH_ENGLISH_ONCE")).toEqual([]);
    });

    it("fails a listed term the Chinese never uses, a first use with no English and a later one that has it, and a title that has it", () => {
      const w = publishedZhWorld();
      const bio = w.findings[0]!;
      bio.explainer.found.zh = "範例發現。";
      expect(published(w, "ZH_ENGLISH_ONCE").map((i) => i.path)).toEqual([FOUND_AT]);
      bio.explainer.found.zh = "範例發現：蛋白質摺疊。";
      let issues = published(w, "ZH_ENGLISH_ONCE");
      expect(issues.map((i) => i.path)).toEqual([FOUND_AT]);
      expect(issues[0]!.message).toContain("蛋白質摺疊（protein folding）");
      bio.explainer.found.zh = "範例發現：蛋白質摺疊（protein folding）。";
      bio.explainer.matters.zh = "蛋白質摺疊（protein folding）有意義。";
      issues = published(w, "ZH_ENGLISH_ONCE");
      expect(issues.map((i) => i.path)).toEqual(["findings/bio-2026-0001.json: explainer.matters.zh"]);
      bio.explainer.matters.zh = "範例意義。";
      bio.title.zh = "蛋白質摺疊（protein folding）成果";
      expect(published(w, "ZH_ENGLISH_ONCE").map((i) => i.path)).toEqual(["findings/bio-2026-0001.json: title.zh"]);
    });

    it("meets two glossary terms that share one Chinese with one bracket after the first use, and tells a missing one once (F-62)", () => {
      const w = publishedZhWorld();
      const folding = w.terms[0]!;
      const named = (id: string, term: string): Term => Term.parse({ ...folding, id, en: { term, definition: "A set of data." }, zh: { ...folding.zh!, term: "資料集" } });
      w.terms.splice(0, w.terms.length, named("data-set", "data set"), named("dataset", "dataset"));
      w.findings[0]!.terms = ["data-set", "dataset"];
      w.findings[0]!.explainer.found.zh = "範例發現：資料集（dataset）的結果。";
      expect(published(w, "ZH_ENGLISH_ONCE")).toEqual([]);
      w.findings[0]!.explainer.found.zh = "範例發現：資料集（data set）的結果。";
      expect(published(w, "ZH_ENGLISH_ONCE")).toEqual([]);
      w.findings[0]!.explainer.found.zh = "範例發現：資料集的結果。";
      const issues = published(w, "ZH_ENGLISH_ONCE");
      expect(issues.map((i) => i.path)).toEqual([FOUND_AT]);
      expect(issues[0]!.message).toContain("資料集（data set）");
    });

    it("reads an archived record too: it reads no config, so a later change of config cannot make it fail", () => {
      const w = publishedZhWorld();
      w.findings[0]!.explainer.found.zh = "範例發現。";
      expect(published(w, "ZH_ENGLISH_ONCE", null)).toHaveLength(1);
      expect(published(w, "ZH_ENGLISH_ONCE", "2026-11-25")).toHaveLength(1);
    });

    it("asks nothing of a finding with no Chinese explainer, nor of a term the glossary has no Chinese for", () => {
      const w = publishedZhWorld();
      w.findings[0]!.explainer.found = l("Sample found text.");
      expect(published(w, "ZH_ENGLISH_ONCE")).toEqual([]);
      const v = publishedZhWorld();
      v.findings[0]!.explainer.found.zh = "範例發現。";
      v.terms[0]!.zh = null;
      expect(published(v, "ZH_ENGLISH_ONCE")).toEqual([]);
    });

    it("no longer needs a term to appear, nor the first remaining use to carry the English, in a finding with a removed explainer part", () => {
      const w = publishedZhWorld();
      w.findings[0]!.explainer.found.zh = "範例發現。";
      w.findings[0]!.explainer.matters.zh = "蛋白質摺疊很重要。";
      expect(published(w, "ZH_ENGLISH_ONCE")).toHaveLength(1);
      const removed = (path: string): Correction => Correction.parse({
        id: "C-0003", date: D, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "removed", path,
        before: lz("[removed text]", "〔已移除的文字〕"), after: lz("This text was removed.", "此處文字已移除。"), reason: l("A removal."),
        source_url: null, trigger: "recheck", report_id: null,
      });
      w.findings[0]!.explainer.could_lead = lz("This text was removed.", "此處文字已移除。");
      w.corrections.push(removed("explainer.could_lead"));
      expect(published(w, "ZH_ENGLISH_ONCE")).toEqual([]);
      w.findings[0]!.explainer.matters.zh = "蛋白質摺疊（protein folding）很重要。";
      w.findings[0]!.explainer.found.zh = "範例發現：蛋白質摺疊（protein folding）。";
      expect(published(w, "ZH_ENGLISH_ONCE").map((i) => i.path)).toEqual(["findings/bio-2026-0001.json: explainer.matters.zh"]);
    });
  });
});

// ── ZH_CHARS ─────────────────────────────────────────────────────────────────────────────────────

describe("ZH_CHARS: each string, each group and the page total are within their limits", () => {
  const chars = (w: ZhWorld): ValidationIssue[] => zhIssues(w, "ZH_CHARS");
  /** The issues about the page total: the Chinese draft's `strings` as a whole. */
  const page = (w: ZhWorld): ValidationIssue[] => chars(w).filter((i) => i.path === "strings");
  const withLen = (key: string, n: number): ValidationIssue[] => {
    const w = zhWorld();
    setZh(w, key, HAN(n));
    return chars(w);
  };

  it("computes a Chinese cap as the English budget times zh_factor rounded up, without float drift", () => {
    expect(zhCap(12, 1.8)).toBe(22);
    expect(zhCap(40, 1.8)).toBe(72);
    expect(zhCap(55, 1.8)).toBe(99);
    expect(zhCap(550, 1.8)).toBe(990);
    expect(zhCap(1300, 1.8)).toBe(2340);
    expect(zhCap(10, 1.1)).toBe(11);
    expect(zhCap(100, 1.1)).toBe(110);
    expect(zhCap(10, 1.15)).toBe(12);
    expect(zhCap(13, 1.8)).toBe(24);
    expect(zhCap(1, 1.1)).toBe(2);
    expect(zhCap(3, 1.2)).toBe(4);
    expect(zhCap(7, 1.31)).toBe(10);
    expect(CORRECTION_AFTER_CHARS).toBe(300);
  });

  it("passes a string at its cap and one under it, and fails one over, naming the key, its length, the limit and the cut", () => {
    expect(withLen("new.new-1.title", 22)).toEqual([]);
    expect(withLen("new.new-1.title", 21)).toEqual([]);
    const issues = withLen("new.new-1.title", 23);
    expect(issues.map((i) => i.path)).toEqual([KEY("new.new-1.title")]);
    expect(issues[0]!.message).toContain("new.new-1.title has 23 characters");
    expect(issues[0]!.message).toContain("the limit is 22");
    expect(issues[0]!.message).toContain("Cut at least 1");
    expect(issues[0]!.message).toContain(HAN(23));
    expect(withLen("new.new-1.title", 30)[0]!.message).toContain("Cut at least 8");
  });

  it("reads each cap from the context, whatever its kind: a title, a part, a line, a long text, a note", () => {
    for (const s of zhWorld().context.strings) {
      const w = zhWorld();
      setZh(w, s.key, HAN(s.cap_chars));
      expect(chars(w).filter((i) => i.message.startsWith(`${s.key} has`)), `${s.key} at ${s.cap_chars}`).toEqual([]);
      setZh(w, s.key, HAN(s.cap_chars + 1));
      expect(chars(w).filter((i) => i.path === KEY(s.key) && i.message.startsWith(`${s.key} has`)), `${s.key} over ${s.cap_chars}`).toHaveLength(1);
    }
    const w = zhWorld();
    w.context.strings.find((s) => s.key === "ideas.0")!.cap_chars = 5;
    setZh(w, "ideas.0", HAN(5));
    expect(chars(w)).toEqual([]);
    setZh(w, "ideas.0", HAN(6));
    expect(chars(w).map((i) => i.path)).toEqual([KEY("ideas.0")]);
  });

  it("counts as countZhChars() does: a run of Latin letters or digits is one character, punctuation and spaces are none", () => {
    const w = zhWorld();
    setZh(w, "new.new-1.title", `${HAN(21)}CRISPR，。 `);
    expect(chars(w)).toEqual([]);
    setZh(w, "new.new-1.title", `${HAN(22)} 2026 CRISPR`);
    const issues = chars(w);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("has 24 characters");
    expect(countZhChars(`${HAN(22)} 2026 CRISPR`)).toBe(24);
  });

  it("counts a string of no Han character as the count says, and an empty string as none", () => {
    const w = zhWorld();
    setZh(w, "new.new-1.title", "");
    expect(chars(w)).toEqual([]);
    setZh(w, "new.new-1.title", "x".repeat(300));
    expect(chars(w)).toEqual([]);
    setZh(w, "new.new-1.title", "a b ".repeat(30));
    expect(chars(w).map((i) => i.path)).toEqual([KEY("new.new-1.title")]);
  });

  it("reads a term's definition by the term's own cap, and gives its issue at the term", () => {
    const w = zhWorld();
    w.draft.terms["protein-folding"]!.definition = HAN(72);
    expect(chars(w)).toEqual([]);
    w.draft.terms["protein-folding"]!.definition = HAN(73);
    const issues = chars(w);
    expect(issues.map((i) => i.path)).toEqual(['terms["protein-folding"].definition']);
    expect(issues[0]!.message).toContain("terms.protein-folding definition has 73 characters");
    expect(issues[0]!.message).toContain("the limit is 72");
  });

  it("reads the cap of a correction's after as 300 characters and of its reason as the context's", () => {
    const w = zhWorld();
    setZh(w, "corrections.3.after", HAN(300));
    expect(chars(w)).toEqual([]);
    setZh(w, "corrections.3.after", HAN(301));
    expect(chars(w).map((i) => i.path)).toEqual([KEY("corrections.3.after")]);
  });

  describe("a group", () => {
    const setItem = (w: ZhWorld, found: number, matters: number, howSure: number): void => {
      setZh(w, "new.new-2.explainer.found", HAN(found));
      setZh(w, "new.new-2.explainer.matters", HAN(matters));
      setZh(w, "new.new-2.explainer.how_sure", HAN(howSure));
    };

    it("passes an item's first four parts at 180 together and one under, and fails one over, once, at its first string", () => {
      const w = zhWorld();
      setItem(w, 100, 60, 20);
      expect(chars(w)).toEqual([]);
      setItem(w, 100, 60, 19);
      expect(chars(w)).toEqual([]);
      setItem(w, 100, 60, 21);
      const issues = chars(w);
      expect(issues.map((i) => i.path)).toEqual([KEY("new.new-2.explainer.found")]);
      const message = issues[0]!.message;
      expect(message).toContain("The strings of the group new.new-2.explainer together have 181 characters");
      expect(message).toContain("new.new-2.explainer.found 100");
      expect(message).toContain("new.new-2.explainer.how_sure 21");
      expect(message).toContain("the limit is 180");
      expect(message).toContain("Cut at least 1");
    });

    it("passes a story's six parts at 504 together, each within its own cap, and fails one over", () => {
      const w = zhWorld();
      const parts: [string, number][] = [["found", 99], ["matters", 90], ["ai_helped", 108], ["how_sure", 108], ["background", 63], ["could_lead", 36]];
      for (const [part, n] of parts) setZh(w, `new.new-1.explainer.${part}`, HAN(n));
      expect(chars(w)).toEqual([]);
      setZh(w, "new.new-1.explainer.could_lead", HAN(37));
      const issues = chars(w);
      expect(issues.map((i) => i.path)).toEqual([KEY("new.new-1.explainer.ai_helped")]);
      expect(issues[0]!.message).toContain("the group new.new-1.explainer together have 505 characters");
      expect(issues[0]!.message).toContain("the limit is 504");
      expect(issues[0]!.message).toContain("Cut at least 1");
    });

    it("does not add an item's background and could_lead to its group: they have their own caps", () => {
      const w = zhWorld();
      setItem(w, 100, 60, 20);
      setZh(w, "new.new-2.explainer.background", HAN(72));
      setZh(w, "new.new-2.explainer.could_lead", HAN(72));
      expect(chars(w)).toEqual([]);
    });

    it("passes the lead lines at 108 together and fails one over, at the first line", () => {
      const w = zhWorld();
      setZh(w, "lead.0", HAN(100));
      setZh(w, "lead.1", HAN(8));
      expect(chars(w)).toEqual([]);
      setZh(w, "lead.1", HAN(9));
      const issues = chars(w);
      expect(issues.map((i) => i.path)).toEqual([KEY("lead.0")]);
      expect(issues[0]!.message).toContain("the group lead together have 109 characters");
    });

    it("reports a member over its own cap and the group it sits in as two issues, and another group's strings never join it", () => {
      const w = zhWorld();
      setZh(w, "new.new-2.explainer.found", HAN(181));
      const issues = chars(w);
      expect(issues.map((i) => [i.path, i.message.startsWith("new.new-2.explainer.found has 181") || i.message.startsWith("The strings of the group new.new-2.explainer")])).toEqual([
        [KEY("new.new-2.explainer.found"), true], [KEY("new.new-2.explainer.found"), true],
      ]);
      expect(issues).toHaveLength(2);
      setZh(w, "new.new-2.explainer.found", HAN(100));
      setZh(w, "new.new-1.explainer.found", HAN(99));
      expect(chars(w)).toEqual([]);
    });

    it("reads each group's cap from its first member by path, and a string with no group belongs to none", () => {
      const w = zhWorld();
      for (const s of w.context.strings) if (s.group?.id === "lead") s.group = { id: "lead", cap_chars: 10 };
      setZh(w, "lead.0", HAN(5));
      setZh(w, "lead.1", HAN(5));
      expect(chars(w)).toEqual([]);
      setZh(w, "lead.1", HAN(6));
      expect(chars(w).map((i) => i.message.includes("the limit is 10"))).toEqual([true]);
      w.context.strings.find((s) => s.key === "lead.1")!.group = null;
      expect(chars(w)).toEqual([]);
    });
  });

  describe("the page total", () => {
    const PAGE_LIMIT = 2340;
    /** Every key of the Monday-and-Sunday world whose English counts in WORDS' page total. */
    const COUNTED = [
      "lead.0", "lead.1", "new.new-1.title", "new.new-1.explainer.found", "new.new-1.explainer.matters", "new.new-1.explainer.ai_helped",
      "new.new-1.explainer.how_sure", "new.new-1.explainer.background", "new.new-1.explainer.could_lead", "new.new-2.title",
      "new.new-2.explainer.found", "new.new-2.explainer.matters", "new.new-2.explainer.how_sure", "returning.math-2026-0002.update",
      "ideas.0", "also.0", "deep_dive", "review.big_picture", "review.remarkable", "review.strongest_against",
    ];
    /** Every key that counts in none: an item's background and could_lead, a rung note, a correction, a report. */
    const NOT_COUNTED = [
      "new.new-2.explainer.background", "new.new-2.explainer.could_lead", "new.new-2.rung.0", "returning.math-2026-0002.rung",
      "rung.phys-2026-0003", "corrections.0.reason", "corrections.3.after", "corrections.3.reason", "reports.R-0001.reason",
    ];
    const world = (): ZhWorld => zhWorld({ review: true, deepDive: true });
    const total = (w: ZhWorld): number => COUNTED.reduce((n, k) => n + countZhChars(w.draft.strings[k]!), 0);
    /** The Monday-and-Sunday world with its page total made exactly `n` by the deep dive. */
    const atTotal = (n: number): ZhWorld => {
      const w = world();
      const rest = total(w) - countZhChars(w.draft.strings.deep_dive!);
      setZh(w, "deep_dive", HAN(n - rest));
      expect(total(w)).toBe(n);
      return w;
    };

    it("lists the keys whose English counts, and zhPageTotal() sums exactly those", () => {
      const w = world();
      expect(COUNTED.every((k) => Object.hasOwn(w.draft.strings, k))).toBe(true);
      expect(zhPageTotal(zhInputOf(w))).toBe(total(w));
      expect(zhPageTotal(zhInputOf(zhWorld()))).toBe(144);
    });

    it("passes the sample weekday edition's Chinese, whose strings together are well over the limit: only the page text counts", () => {
      const read = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(process.cwd(), "fixtures", file), "utf8"));
      const draft = DraftZh.parse(read("drafts-zh/valid-weekday.zh.json"));
      const input = buildZhInput(draft, DraftBrief.parse(read("drafts/valid-weekday.json")), {
        context: ZhContext.parse(read("drafts-zh/weekday.zh-context.json")), evidence: Evidence.parse(read("drafts-zh/weekday.zh-evidence.json")), config: config(),
      });
      const all = Object.values(draft.strings).reduce((n, s) => n + countZhChars(s), 0);
      expect(all).toBeGreaterThan(PAGE_LIMIT);
      expect(zhPageTotal(input)).toBeLessThanOrEqual(PAGE_LIMIT);
      expect(runRules(input, zhRules).filter((i) => i.code === "ZH_CHARS" || i.code === "RULE_ERROR")).toEqual([]);
    });

    it("passes a total of exactly 2,340 and one under it, and fails one over, at `strings`, with the total and the limit", () => {
      expect(page(atTotal(PAGE_LIMIT))).toEqual([]);
      expect(page(atTotal(PAGE_LIMIT - 1))).toEqual([]);
      const issues = page(atTotal(PAGE_LIMIT + 1));
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("The Chinese page text has 2341 characters");
      expect(issues[0]!.message).toContain("the limit is 2340");
      expect(issues[0]!.message).toContain("Cut at least 1");
      expect(page(atTotal(PAGE_LIMIT + 60))[0]!.message).toContain("Cut at least 60");
      expect(zhCap(1300, 1.8)).toBe(PAGE_LIMIT);
    });

    it("counts each key of WORDS' page total: one more character in any of them tips a total at the limit", () => {
      for (const key of COUNTED) {
        const w = atTotal(PAGE_LIMIT);
        setZh(w, key, `${w.draft.strings[key]}字`);
        expect(page(w), key).toHaveLength(1);
      }
    });

    it("counts none of the other keys, nor a backlog string: a long one leaves a total at the limit alone", () => {
      for (const key of NOT_COUNTED) {
        const w = atTotal(PAGE_LIMIT);
        setZh(w, key, HAN(400));
        expect(page(w), key).toEqual([]);
      }
      const w = atTotal(PAGE_LIMIT);
      const backlog: [string, string, "title" | "part" | "note" | "line", number][] = [
        ["backlog.bio-2025-0003.title", "An old finding", "title", 22], ["backlog.bio-2025-0003.explainer.found", "It found a thing.", "part", 180],
        ["backlog.bio-2025-0003.since.0", "A later fact.", "line", 108], ["backlog.bio-2025-0003.figure.alt", "A chart.", "line", 72],
        ["backlog.bio-2025-0003.rung.0", "A note.", "note", 45],
      ];
      for (const [key, en, kind, cap] of backlog) addString(w, { key, en, zh: HAN(400), kind, cap });
      expect(page(w)).toEqual([]);
    });

    it("counts a new finding the edition shows by its depth: the story's last two parts count, an item's do not", () => {
      const w = atTotal(PAGE_LIMIT);
      setZh(w, "new.new-1.explainer.background", `${w.draft.strings["new.new-1.explainer.background"]}字`);
      expect(page(w)).toHaveLength(1);
      const v = atTotal(PAGE_LIMIT);
      setZh(v, "new.new-2.explainer.background", `${v.draft.strings["new.new-2.explainer.background"]}字`);
      expect(page(v)).toEqual([]);
    });

    it("counts a new finding the edition does not show as nothing", () => {
      const w = world();
      const before = zhPageTotal(zhInputOf(w));
      w.english.items = w.english.items.filter((ref) => ref !== "new-2");
      expect(zhPageTotal(zhInputOf(w))).toBe(before - 22);
    });

    it("counts a key the draft lacks as nothing, and a key the context lacks as nothing", () => {
      const w = world();
      const before = zhPageTotal(zhInputOf(w));
      delete w.draft.strings["ideas.0"];
      expect(zhPageTotal(zhInputOf(w))).toBe(before - 11);
      dropKey(w, "also.0");
      expect(zhPageTotal(zhInputOf(w))).toBe(before - 11 - 8);
      setZh(w, "extra.key", HAN(3000));
      expect(page(w)).toEqual([]);
    });

    it("reads words_max and zh_factor from run.json: the limit is ceil(words_max x zh_factor)", () => {
      const run = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "run.json"), "utf8")) as { budgets: Record<string, number> };
      const make = (words_max: number, zh_factor: number): ReturnType<typeof loadConfig> =>
        loadConfig(undefined, { overrides: { run: { ...run, budgets: { ...run.budgets, words_max, words_target: Math.min(run.budgets.words_target!, words_max), zh_factor } } } });
      const w = atTotal(1801);
      w.config = make(1000, 1.8);
      expect(page(w).map((i) => i.message.includes("the limit is 1800"))).toEqual([true]);
      w.config = make(1000, 1.81);
      expect(page(w)).toEqual([]);
      w.config = make(1001, 1.8);
      expect(page(w)).toEqual([]);
      w.config = make(900, 2);
      expect(page(w).map((i) => i.message.includes("the limit is 1800"))).toEqual([true]);
    });
  });
});

describe("ZH_CHARS on the records being published: the word budgets of SPEC §4.12 times zh_factor", () => {
  const BRIEF = `briefs/${D}.json`;
  const BIO = "findings/bio-2026-0001.json";
  const MATH = "findings/math-2026-0002.json";

  /** The rows of SPEC §4.12's word budgets table, by field. */
  const specRows = (): Map<string, string> => {
    const text = fs.readFileSync(path.join(process.cwd(), "SPEC.md"), "utf8");
    const from = text.indexOf("**Word budgets**");
    const to = text.indexOf("**Setbacks, infrastructure", from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const rows = new Map<string, string>();
    for (const line of text.slice(from, to).split("\n")) {
      const m = /^\| (.+?) \| (.+) \|$/.exec(line);
      if (m !== null && m[1] !== "Field" && !m[1]!.startsWith("---")) rows.set(m[1]!, m[2]!);
    }
    return rows;
  };

  /** The stored Tuesday with the parts a brief of the other formats and a few records add: the deep dive, the review, a second lead line, the reasons and a figure. */
  const rich = (): PublishedZhWorld => {
    const w = publishedZhWorld();
    w.brief.deep_dive = BriefDeepDive.parse({ finding_id: "bio-2026-0001", text: lz("A sample long text.", "一段範例長文。"), source_ids: [], why_today: "rotation" });
    w.brief.review = WeekReview.parse({
      big_picture: lz("A sample week.", "範例的一週。"),
      remarkable: { finding_id: "bio-2026-0001", note: lz("A sample note.", "範例筆記。") },
      strongest_against: { text: lz("A sample dispute.", "範例爭議。"), finding_ids: [], source_ids: [] },
      field_counts: FIELDS.map((field) => ({ field, reported: 0, counted: 0 })),
      fell: [],
      setbacks: [],
    });
    w.brief.lead.push({ text: lz("A second line.", "第二行。"), finding_ids: [] });
    w.corrections[1]!.reason = lz("The record was wrong.", "記錄有誤。");
    w.reports[0]!.reason = lz("The source says this.", "來源是這樣說的。");
    w.findings[0]!.figure = Figure.parse({
      source_id: "s1", image_url: "https://example.org/figure.png", licence: "CC-BY-4.0", licence_quote: "Licensed under CC BY 4.0.",
      credit: "Figure 1 from Example Journal", alt: lz("A sample chart.", "一張範例圖表。"),
    });
    return w;
  };

  interface Case {
    name: string;
    row: string;
    re: RegExp;
    at: string;
    set: (w: PublishedZhWorld, zh: string) => void;
  }
  const part = (name: string, re: RegExp): Case => ({
    name: `a story's ${name}`, row: "Story of the day, six parts", re, at: `${BIO}: explainer.${name}.zh`,
    set: (w, zh) => { (w.findings[0]!.explainer as Record<string, { zh: string | null }>)[name]!.zh = zh; },
  });
  const itemPart = (name: string, re: RegExp): Case => ({
    name: `an item's ${name}`, row: "Other findings, first four parts", re, at: `${MATH}: explainer.${name}.zh`,
    set: (w, zh) => { (w.findings[1]!.explainer as Record<string, { zh: string | null }>)[name]!.zh = zh; },
  });
  const CASES: Case[] = [
    { name: "a finding's title", row: "Title", re: /≤ (\d+) words/, at: `${BIO}: title.zh`, set: (w, zh) => { w.findings[0]!.title.zh = zh; } },
    { name: "a lead line", row: "Lead", re: /≤ (\d+) words/, at: `${BRIEF}: lead[0].text.zh`, set: (w, zh) => { w.brief.lead[0]!.text.zh = zh; } },
    part("found", /found ≤ (\d+)/), part("matters", /matters ≤ (\d+)/), part("ai_helped", /ai_helped ≤ (\d+)/),
    part("how_sure", /how_sure ≤ (\d+)/), part("background", /background ≤ (\d+)/), part("could_lead", /could_lead ≤ (\d+)/),
    itemPart("found", /70 to (\d+) in all/), itemPart("matters", /70 to (\d+) in all/), itemPart("ai_helped", /70 to (\d+) in all/),
    itemPart("how_sure", /70 to (\d+) in all/), itemPart("background", /background and could_lead ≤ (\d+)/),
    itemPart("could_lead", /background and could_lead ≤ (\d+)/),
    { name: "a returning update", row: "Returning update, `since_then`", re: /≤ (\d+)/, at: `${BRIEF}: items[1].update.zh`, set: (w, zh) => { w.brief.items[1]!.update!.zh = zh; } },
    { name: "a since_then text", row: "Returning update, `since_then`", re: /≤ (\d+)/, at: `${BIO}: since_then[0].text.zh`, set: (w, zh) => { w.findings[0]!.since_then[0]!.text.zh = zh; } },
    { name: "a rung note", row: "Rung note", re: /≤ (\d+)/, at: `${BIO}: rung_history[1].note.zh`, set: (w, zh) => { w.findings[0]!.rung_history[1]!.note!.zh = zh; } },
    { name: "an idea line", row: "Idea line", re: /≤ (\d+)/, at: `${BRIEF}: ideas[0].text.zh`, set: (w, zh) => { w.brief.ideas[0]!.text.zh = zh; } },
    { name: "an Also noted title", row: "Also noted title", re: /≤ (\d+)/, at: `${BRIEF}: also[0].title.zh`, set: (w, zh) => { w.brief.also[0]!.title.zh = zh; } },
    { name: "the deep dive", row: "Deep dive", re: /450 to (\d+)/, at: `${BRIEF}: deep_dive.text.zh`, set: (w, zh) => { w.brief.deep_dive!.text.zh = zh; } },
    { name: "the big picture", row: "Big picture", re: /270 to (\d+)/, at: `${BRIEF}: review.big_picture.zh`, set: (w, zh) => { w.brief.review!.big_picture.zh = zh; } },
    { name: "the remarkable note", row: "Remarkable note", re: /≤ (\d+)/, at: `${BRIEF}: review.remarkable.note.zh`, set: (w, zh) => { w.brief.review!.remarkable!.note.zh = zh; } },
    { name: "the strongest evidence against", row: "Strongest evidence against", re: /≤ (\d+)/, at: `${BRIEF}: review.strongest_against.text.zh`, set: (w, zh) => { w.brief.review!.strongest_against.text.zh = zh; } },
    { name: "a term's definition", row: "Term definition", re: /≤ (\d+)/, at: "glossary.json: terms[0].zh.definition", set: (w, zh) => { w.terms[0]!.zh!.definition = zh; } },
    { name: "a correction's reason", row: "Correction reason, report reason", re: /≤ (\d+)/, at: "corrections.json: corrections[1].reason.zh", set: (w, zh) => { w.corrections[1]!.reason.zh = zh; } },
    { name: "a report's reason", row: "Correction reason, report reason", re: /≤ (\d+)/, at: "reports.json: reports[0].reason.zh", set: (w, zh) => { w.reports[0]!.reason!.zh = zh; } },
    { name: "a figure's alt text", row: "Figure alt text", re: /≤ (\d+)/, at: `${BIO}: figure.alt.zh`, set: (w, zh) => { w.findings[0]!.figure!.alt.zh = zh; } },
  ];

  it("has every row of the table in SPEC §4.12 and no other", () => {
    expect([...specRows().keys()]).toEqual([
      "Title", "Lead", "Story of the day, six parts", "Other findings, first four parts", "Returning update, `since_then`", "Rung note", "Idea line",
      "Also noted title", "Deep dive", "Big picture", "Remarkable note", "Strongest evidence against", "Term definition", "Correction reason, report reason",
      "Figure alt text", expect.stringMatching(/^Page total/),
    ]);
    expect(new Set(CASES.map((c) => c.row)).size).toBe(15);
  });

  for (const c of CASES) {
    it(`gives ${c.name} the cap of its row: the table's number of words times zh_factor, rounded up`, () => {
      const m = c.re.exec(specRows().get(c.row) ?? "");
      expect(m, `${c.row}: ${specRows().get(c.row)}`).not.toBeNull();
      const cap = zhCap(Number(m![1]), config().run.budgets.zh_factor);
      const own = (w: PublishedZhWorld): ValidationIssue[] => published(w, "ZH_CHARS").filter((i) => i.message.startsWith(`${c.at} has`));
      const w = rich();
      c.set(w, HAN(cap));
      expect(own(w), "at the cap").toEqual([]);
      c.set(w, HAN(cap - 1));
      expect(own(w), "one under").toEqual([]);
      c.set(w, HAN(cap + 1));
      const issues = own(w);
      expect(issues, "one over").toHaveLength(1);
      expect(issues[0]!.path).toBe(c.at);
      expect(issues[0]!.message).toContain(`has ${cap + 1} characters`);
      expect(issues[0]!.message).toContain(`the limit is ${cap}`);
      expect(issues[0]!.message).toContain("Cut at least 1");
      expect(published(w, "ZH_CHARS", null)).toEqual([]);
    });
  }

  it("gives a correction's after 300 characters, with no zh_factor", () => {
    const w = rich();
    const correction = (zh: string): Correction => Correction.parse({
      id: "C-0003", date: D, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "explainer.found",
      before: l("before"), after: lz("Sample found text.", zh), reason: lz("The text was wrong.", "文字有誤。"), source_url: null, trigger: "editor", report_id: null,
    });
    const own = (): ValidationIssue[] => published(w, "ZH_CHARS").filter((i) => i.path === "corrections.json: corrections[2].after.zh");
    w.corrections.push(correction(HAN(300)));
    expect(own()).toEqual([]);
    w.corrections[2] = correction(HAN(301));
    const issues = own();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("has 301 characters");
    expect(issues[0]!.message).toContain("the limit is 300");
    expect(CORRECTION_AFTER_CHARS).toBe(300);
  });

  it("shares one cap among a story's six parts and among an item's first four, and among the lead lines", () => {
    const w = rich();
    const story = (n: number): void => {
      const e = w.findings[0]!.explainer;
      e.found.zh = HAN(99); e.matters.zh = HAN(90); e.ai_helped!.zh = HAN(108); e.how_sure.zh = HAN(108); e.background.zh = HAN(63); e.could_lead.zh = HAN(n);
    };
    const groupIssues = (): ValidationIssue[] => published(w, "ZH_CHARS").filter((i) => i.message.startsWith("The strings of the group"));
    story(36);
    expect(groupIssues()).toEqual([]);
    story(37);
    let issues = groupIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe(`${BIO}: explainer.ai_helped.zh`);
    expect(issues[0]!.message).toContain("group bio-2026-0001.explainer together have 505 characters");
    expect(issues[0]!.message).toContain("the limit is 504");
    story(36);
    const item = (n: number): void => {
      const e = w.findings[1]!.explainer;
      e.found.zh = HAN(100); e.matters.zh = HAN(60); e.ai_helped!.zh = HAN(n); e.how_sure.zh = HAN(0); e.background.zh = HAN(72); e.could_lead.zh = HAN(72);
    };
    item(20);
    expect(groupIssues()).toEqual([]);
    item(21);
    issues = groupIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("group math-2026-0002.explainer together have 181 characters");
    expect(issues[0]!.message).toContain("the limit is 180");
    item(20);
    w.brief.lead[0]!.text.zh = HAN(100);
    w.brief.lead[1]!.text.zh = HAN(8);
    expect(groupIssues()).toEqual([]);
    w.brief.lead[1]!.text.zh = HAN(9);
    issues = groupIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe(`${BRIEF}: lead[0].text.zh`);
    expect(issues[0]!.message).toContain("group lead together have 109 characters");
  });

  it("reads no record that is not being published, and no string with no Chinese", () => {
    const w = rich();
    w.findings[2]!.explainer.found.zh = HAN(500);
    w.findings[2]!.title.zh = HAN(500);
    expect(published(w, "ZH_CHARS")).toEqual([]);
    w.findings[0]!.title.zh = null;
    w.brief.ideas[0]!.text.zh = null;
    expect(published(w, "ZH_CHARS")).toEqual([]);
  });

  it("gives no cap to a Chinese name or a status line: the Pace sentence and a source's title are not prose with a budget", () => {
    const w = rich();
    w.brief.pace.sentence.zh = HAN(400);
    expect(published(w, "ZH_CHARS")).toEqual([]);
  });

  describe("the page total of the brief being published", () => {
    const AT = `${BRIEF}: computed.zh_chars`;
    const limit = zhCap(config().run.budgets.words_max, config().run.budgets.zh_factor);
    const pageIssues = (w: PublishedZhWorld, publishing: string | null = D): ValidationIssue[] => published(w, "ZH_CHARS", publishing).filter((i) => i.path === AT);
    /** The brief's Chinese page total, read through the rule: the total with `ideas[0]` padded to 3,000 characters, less the padding. */
    const baseTotal = (w: PublishedZhWorld): number => {
      const old = countZhChars(w.brief.ideas[0]!.text.zh ?? "");
      w.brief.ideas[0]!.text.zh = HAN(3000);
      const m = /has (\d+) characters/.exec(pageIssues(w)[0]!.message);
      w.brief.ideas[0]!.text.zh = HAN(old);
      return Number(m![1]) - 3000 + old;
    };
    /** The world with its page total exactly `n`, the ideas line making up the difference. */
    const atTotal = (n: number): PublishedZhWorld => {
      const w = rich();
      const rest = baseTotal(w) - countZhChars(w.brief.ideas[0]!.text.zh!);
      w.brief.ideas[0]!.text.zh = HAN(n - rest);
      return w;
    };

    it("totals the characters of exactly the strings WORDS' page total counts, as the records hold them", () => {
      const w = rich();
      const story = w.findings[0]!.explainer;
      const item = w.findings[1]!.explainer;
      const counted = [
        ...w.brief.lead.map((x) => x.text.zh),
        w.findings[0]!.title.zh, story.found.zh, story.matters.zh, story.ai_helped?.zh, story.how_sure.zh, story.background.zh, story.could_lead.zh,
        w.findings[1]!.title.zh, item.found.zh, item.matters.zh, item.ai_helped?.zh, item.how_sure.zh,
        w.brief.items[1]!.update!.zh,
        ...w.brief.ideas.map((x) => x.text.zh), ...w.brief.also.map((x) => x.title.zh),
        w.brief.deep_dive!.text.zh, w.brief.review!.big_picture.zh, w.brief.review!.remarkable!.note.zh, w.brief.review!.strongest_against.text.zh,
      ];
      const total = counted.reduce((n, zh) => n + countZhChars(zh ?? ""), 0);
      expect(total).toBeGreaterThan(100);
      expect(baseTotal(w)).toBe(total);
      expect(pageIssues(atTotal(limit))).toEqual([]);
      expect(pageIssues(atTotal(limit + 1))[0]!.message).toContain("has 2341 characters");
    });

    it("passes a total of exactly 2,340 and one under it, and fails one over, at computed.zh_chars", () => {
      expect(limit).toBe(2340);
      expect(pageIssues(atTotal(limit))).toEqual([]);
      expect(pageIssues(atTotal(limit - 1))).toEqual([]);
      const issues = pageIssues(atTotal(limit + 1));
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("The Chinese page text has 2341 characters");
      expect(issues[0]!.message).toContain("the limit is 2340");
      expect(issues[0]!.message).toContain("Cut at least 1");
    });

    it("counts what WORDS' page total counts: the lead, a new finding's title and parts, an update, an idea, an Also noted title, the deep dive and the review", () => {
      const counted: [string, (w: PublishedZhWorld) => void][] = [
        ["lead", (w) => { w.brief.lead[0]!.text.zh += "字"; }],
        ["story title", (w) => { w.findings[0]!.title.zh += "字"; }],
        ["story found", (w) => { w.findings[0]!.explainer.found.zh += "字"; }],
        ["story how_sure", (w) => { w.findings[0]!.explainer.how_sure.zh += "字"; }],
        ["story background", (w) => { w.findings[0]!.explainer.background.zh += "字"; }],
        ["story could_lead", (w) => { w.findings[0]!.explainer.could_lead.zh += "字"; }],
        ["item title", (w) => { w.findings[1]!.title.zh += "字"; }],
        ["item found", (w) => { w.findings[1]!.explainer.found.zh += "字"; }],
        ["returning update", (w) => { w.brief.items[1]!.update!.zh += "字"; }],
        ["idea", (w) => { w.brief.ideas[0]!.text.zh += "字"; }],
        ["also", (w) => { w.brief.also[0]!.title.zh += "字"; }],
        ["deep dive", (w) => { w.brief.deep_dive!.text.zh += "字"; }],
        ["big picture", (w) => { w.brief.review!.big_picture.zh += "字"; }],
        ["remarkable", (w) => { w.brief.review!.remarkable!.note.zh += "字"; }],
        ["against", (w) => { w.brief.review!.strongest_against.text.zh += "字"; }],
      ];
      for (const [name, grow] of counted) {
        const w = atTotal(limit);
        grow(w);
        expect(pageIssues(w), name).toHaveLength(1);
      }
    });

    it("counts none of the rest: an item's background and could_lead, a rung note, a since_then text, a glossary definition, a correction, a report, a figure's alt", () => {
      const rest: [string, (w: PublishedZhWorld) => void][] = [
        ["item background", (w) => { w.findings[1]!.explainer.background.zh = HAN(400); }],
        ["item could_lead", (w) => { w.findings[1]!.explainer.could_lead.zh = HAN(400); }],
        ["rung note", (w) => { w.findings[0]!.rung_history[1]!.note!.zh = HAN(400); }],
        ["since_then", (w) => { w.findings[0]!.since_then[0]!.text.zh = HAN(400); }],
        ["definition", (w) => { w.terms[0]!.zh!.definition = HAN(400); }],
        ["correction reason", (w) => { w.corrections[1]!.reason.zh = HAN(400); }],
        ["report reason", (w) => { w.reports[0]!.reason!.zh = HAN(400); }],
        ["figure alt", (w) => { w.findings[0]!.figure!.alt.zh = HAN(400); }],
        ["the finding the brief only returns", (w) => { w.findings[2]!.explainer.found.zh = HAN(400); w.findings[2]!.title.zh = HAN(400); }],
      ];
      for (const [name, grow] of rest) {
        const w = atTotal(limit);
        grow(w);
        expect(pageIssues(w), name).toEqual([]);
      }
    });

    it("judges the page of the brief being published alone: another date, or none, has no page check", () => {
      const w = atTotal(limit + 100);
      expect(pageIssues(w)).toHaveLength(1);
      expect(pageIssues(w, "2026-11-25")).toEqual([]);
      expect(pageIssues(w, null)).toEqual([]);
    });

    it("reads words_max and zh_factor from run.json, not a constant", () => {
      const run = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "run.json"), "utf8")) as { budgets: Record<string, number> };
      const make = (words_max: number, zh_factor: number): ReturnType<typeof loadConfig> =>
        loadConfig(undefined, { overrides: { run: { ...run, budgets: { ...run.budgets, words_max, words_target: Math.min(run.budgets.words_target!, words_max), zh_factor } } } });
      const w = atTotal(1801);
      w.config = make(1000, 1.8);
      expect(pageIssues(w).map((i) => i.message.includes("the limit is 1800"))).toEqual([true]);
      w.config = make(1000, 1.81);
      expect(pageIssues(w)).toEqual([]);
      const v = rich();
      v.config = make(1000, 2);
      v.findings[0]!.title.zh = HAN(24);
      expect(published(v, "ZH_CHARS").map((i) => i.message.includes("the limit is 24"))).toEqual([]);
      v.findings[0]!.title.zh = HAN(25);
      expect(published(v, "ZH_CHARS").map((i) => i.message.includes("the limit is 24"))).toEqual([true]);
    });
  });
});

// ── ZH_OFFICIAL ──────────────────────────────────────────────────────────────────────────────────

describe("ZH_OFFICIAL: an official comes with an official_url on 樂詞網 that the pass fetched and that shows it", () => {
  const TERM = "protein-folding";
  const URL_PATH = `terms["${TERM}"].official_url`;
  const OFFICIAL_PATH = `terms["${TERM}"].official`;
  const official = (patch: { official?: string | null; official_url?: string | null } = {}): ZhWorld => {
    const w = zhWorld();
    Object.assign(w.draft.terms[TERM]!, { official: OFFICIAL_TERM, official_url: OFFICIAL_URL, ...patch });
    return w;
  };
  const issues = (w: ZhWorld): ValidationIssue[] => zhIssues(w, "ZH_OFFICIAL");
  const pageKey = normalizeUrl(OFFICIAL_URL);

  it("passes an official on a page of terms.naer.edu.tw that the pass fetched and whose text holds it, with no warning either", () => {
    const w = official();
    expect(issues(w)).toEqual([]);
    expect(zhRun(w)).toEqual([]);
    expect(w.evidence!.fetched).toEqual([OFFICIAL_URL]);
    expect(w.evidence!.texts[pageKey]).toContain(OFFICIAL_TERM);
  });

  it("asks nothing of a term whose official is null and whose official_url is null or on the host, fetched or not", () => {
    expect(issues(zhWorld())).toEqual([]);
    expect(issues(official({ official: null, official_url: null }))).toEqual([]);
    expect(issues(official({ official: null, official_url: OFFICIAL_URL }))).toEqual([]);
    expect(issues(official({ official: null, official_url: "https://terms.naer.edu.tw/detail/9999999/" }))).toEqual([]);
  });

  it("fails a stray official_url of another host on a term whose official is null, with or without the evidence", () => {
    for (const url of ["https://example.org/stray", "http://example.org/", "ftp://terms.naer.edu.tw/x", "javascript:alert(1)", "https://terms.naer.edu.tw.example.org/x", "https://terms.naer.edu.tw@example.org/"]) {
      const w = official({ official: null, official_url: url });
      for (const evidence of [w.evidence, null]) {
        w.evidence = evidence;
        const found = issues(w);
        expect(found.map((i) => i.path), url).toEqual([URL_PATH]);
        expect(found[0]!.message, url).toContain(`terms.${TERM} has no official, but its official_url`);
        expect(found[0]!.message, url).toContain("is not an http(s) address on terms.naer.edu.tw");
        expect(found[0]!.message, url).toContain("Set official_url to null");
      }
    }
  });

  it("shortens a long stray address in the message, as for a term with an official", () => {
    const url = `https://example.org/${"a".repeat(100)}`;
    const found = issues(official({ official: null, official_url: url }));
    expect(found.map((i) => i.path)).toEqual([URL_PATH]);
    expect(found[0]!.message).toContain(`"${url.slice(0, 80)}…"`);
    expect(found[0]!.message).not.toContain(url);
  });

  it("fails an official with no official_url, at the official_url, and says to give the page or set official to null", () => {
    const found = issues(official({ official_url: null }));
    expect(found.map((i) => i.path)).toEqual([URL_PATH]);
    expect(found[0]!.message).toContain(`terms.${TERM} has the official "${OFFICIAL_TERM}" but no official_url`);
    expect(found[0]!.message).toContain("or set official to null");
  });

  it("fails a URL that is not on terms.naer.edu.tw, whatever the evidence says", () => {
    const lookalikes = [
      "https://example.org/detail/1234567/", "https://terms.naer.edu.tw.example.org/detail/1", "https://example.org/terms.naer.edu.tw",
      "https://terms.naer.edu.tw@example.org/detail/1", "https://www.terms.naer.edu.tw/detail/1", "ftp://terms.naer.edu.tw/detail/1",
      "terms.naer.edu.tw/detail/1", "https://naer.edu.tw/detail/1", "javascript:alert(1)",
    ];
    for (const url of lookalikes) {
      const w = official({ official_url: url });
      const key = normalizeUrl(url);
      w.evidence = { ...w.evidence!, urls: [url], fetched: [url], texts: { [key]: OFFICIAL_PAGE }, seen_as: { [key]: "fetched" } };
      const found = issues(w);
      expect(found.map((i) => i.path), url).toEqual([URL_PATH]);
      expect(found[0]!.message, url).toContain("is not an http(s) address on terms.naer.edu.tw");
      expect(found[0]!.message, url).toContain(OFFICIAL_TERM);
      expect(found[0]!.message, url).toContain("set official to null");
    }
  });

  it("gives one issue for a URL that is not on the host, not a second about its fetch or its text", () => {
    for (const url of ["https://example.org/detail/1", "ftp://terms.naer.edu.tw/detail/1"]) {
      const w = official({ official_url: url });
      expect(w.evidence!.fetched).not.toContain(url);
      expect(issues(w).map((i) => i.path), url).toEqual([URL_PATH]);
      w.evidence = { ...w.evidence!, fetched: [], texts: {} };
      expect(issues(w).map((i) => i.path), url).toEqual([URL_PATH]);
    }
  });

  it("gives the host check as officialUrlProblem(), the one check the seeder reads: http and https, any case, on the one host", () => {
    for (const ok of ["https://terms.naer.edu.tw/detail/1234567/", "http://terms.naer.edu.tw/detail/1", "HTTPS://TERMS.NAER.EDU.TW/x", "https://terms.naer.edu.tw./x", "https://terms.naer.edu.tw/detail/1#top"]) {
      expect(officialUrlProblem(ok), ok).toBeNull();
    }
    for (const bad of ["https://example.org/", "https://terms.naer.edu.tw.example.org/", "https://terms.naer.edu.tw@example.org/", "ftp://terms.naer.edu.tw/x", "terms.naer.edu.tw", ""]) {
      expect(officialUrlProblem(bad), bad).toBe(`is not an http(s) address on ${NAER_HOST}`);
    }
    expect(NAER_HOST).toBe("terms.naer.edu.tw");
  });

  it("fails a URL the pass did not fetch, even when the evidence holds its text, and passes one written another way", () => {
    const w = official();
    w.evidence = { ...w.evidence!, fetched: [] };
    const found = issues(w);
    expect(found.map((i) => i.path)).toEqual([URL_PATH]);
    expect(found[0]!.message).toContain(`the Chinese pass did not fetch ${OFFICIAL_URL}`);
    expect(found[0]!.message).toContain(`"${OFFICIAL_TERM}"`);
    w.evidence = { ...w.evidence!, urls: [], fetched: ["https://terms.naer.edu.tw/detail/9999999/"] };
    expect(issues(w).map((i) => i.path)).toEqual([URL_PATH]);
    w.evidence = { ...w.evidence!, fetched: ["http://TERMS.naer.edu.tw/detail/1234567#top"] };
    expect(issues(w)).toEqual([]);
  });

  it("gives one issue for a URL the pass did not fetch, not a second about the page's text it has no snapshot of", () => {
    const w = official();
    w.evidence = { ...w.evidence!, fetched: [], texts: {} };
    const found = issues(w);
    expect(found.map((i) => i.path)).toEqual([URL_PATH]);
    expect(found[0]!.message).toContain("did not fetch");
  });

  it("fails an official that the page's text lacks, at the official, and says why", () => {
    const w = official({ official: "蛋白質折疊" });
    const found = issues(w);
    expect(found.map((i) => i.path)).toEqual([OFFICIAL_PATH]);
    expect(found[0]!.message).toContain(`"蛋白質折疊" is not in the page ${OFFICIAL_URL}: the page text does not hold it`);
    expect(found[0]!.message).toContain("character for character");
    delete w.evidence!.texts[pageKey];
    const none = issues(w);
    expect(none).toHaveLength(1);
    expect(none[0]!.message).toContain("the evidence holds no text of that page");
  });

  it("compares the official and the page's text in NFKC: a full-width form and its plain form are the same", () => {
    const w = official({ official: "ＡＩ蛋白質" });
    w.evidence!.texts[pageKey] = "SAMPLE page.\nAI蛋白質\n";
    expect(issues(w)).toEqual([]);
    const v = official({ official: "AI蛋白質１" });
    v.evidence!.texts[pageKey] = "SAMPLE page.\nＡＩ蛋白質1\n";
    expect(issues(v)).toEqual([]);
    v.evidence!.texts[pageKey] = "SAMPLE page.\nＡＩ蛋白質2\n";
    expect(issues(v).map((i) => i.path)).toEqual([OFFICIAL_PATH]);
  });

  it("judges every term the draft writes, each on its own url and page", () => {
    const w = official();
    w.context.terms.push({ id: "gradient-descent", en: "gradient descent", definition: "A way to improve a guess step by step.", zh: null, official: null, cap_chars: 72 });
    w.draft.terms["gradient-descent"] = { zh: "梯度下降", definition: "一步一步改進猜測的方法。", official: "梯度下降", official_url: "https://terms.naer.edu.tw/detail/7654321/" };
    const second = normalizeUrl("https://terms.naer.edu.tw/detail/7654321/");
    w.evidence = { ...w.evidence!, fetched: [OFFICIAL_URL, "https://terms.naer.edu.tw/detail/7654321/"], texts: { ...w.evidence!.texts, [second]: "SAMPLE page\n梯度下降\n" } };
    expect(issues(w)).toEqual([]);
    w.evidence!.texts[second] = "SAMPLE page\n沒有這個詞\n";
    w.draft.terms[TERM]!.official_url = "https://example.org/x";
    const found = issues(w);
    expect(found.map((i) => i.path)).toEqual([`terms["gradient-descent"].official`, URL_PATH]);
  });

  it("still checks the host without the evidence, skips the page checks, and the engine warns once that the check ran without it", () => {
    const w = official();
    w.evidence = null;
    expect(issues(w)).toEqual([]);
    const warnings = zhRun(w).filter((i) => i.code === "INPUT_MISSING");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe("warning");
    expect(warnings[0]!.message).toContain("ZH_OFFICIAL");
    w.draft.terms[TERM]!.official_url = "https://example.org/x";
    expect(issues(w).map((i) => i.path)).toEqual([URL_PATH]);
    w.draft.terms[TERM]!.official_url = null;
    expect(issues(w).map((i) => i.path)).toEqual([URL_PATH]);
  });

  it("does not run on a stored record: the host check of a seed or a stored term is the seeder's", () => {
    const w = publishedZhWorld();
    w.terms[0]!.zh!.official = "蛋白質摺疊";
    w.terms[0]!.zh!.official_url = "https://example.org/stray";
    expect(published(w, "ZH_OFFICIAL")).toEqual([]);
  });
});

// ── ZH_NO_DASH ───────────────────────────────────────────────────────────────────────────────────

describe("ZH_NO_DASH: no dash anywhere in the Chinese text", () => {
  const IDEA = "ideas.0";
  const dashes = (w: ZhWorld): ValidationIssue[] => zhIssues(w, "ZH_NO_DASH");
  const idea = (text: string): ValidationIssue[] => {
    const w = zhWorld();
    setZh(w, IDEA, text);
    return dashes(w);
  };
  const u = (code: number): string => String.fromCharCode(code);

  it("passes the hyphen-minus, the hyphens U+2010 and U+2011, and an en dash between digits", () => {
    expect(idea("一個小-大的詞")).toEqual([]);
    expect(idea(`一個小${u(0x2010)}大的詞`)).toEqual([]);
    expect(idea(`一個小${u(0x2011)}大的詞`)).toEqual([]);
    expect(idea(`在 2020${EN}2024 年之間`)).toEqual([]);
    expect(idea(`第 1${EN}2 名`)).toEqual([]);
    expect(idea("一個詞，另一個詞。")).toEqual([]);
  });

  it("fails each dash the row names, once, with its code point and where it is", () => {
    const cases: [string, string, number][] = [
      [`${EM}${EM}`, "U+2014", 2], [EM, "U+2014", 2], [u(0x2015), "U+2015", 2], [u(0x2e3a), "U+2E3A", 2], [u(0xfe58), "U+FE58", 2], [u(0xff0d), "U+FF0D", 2],
    ];
    for (const [dash, code] of cases) {
      const found = idea(`一個詞${dash}另一個詞`);
      expect(found.map((i) => i.path), dash).toEqual([KEY(IDEA)]);
      expect(found[0]!.message, dash).toContain(`${code} at 3`);
      expect(found[0]!.message, dash).toContain("Write the sentence without");
      expect(found[0]!.message, dash).toContain("一個詞");
    }
    expect(idea(`一個詞${EM}${EM}另一個`)[0]!.message).toContain("2 dashes: U+2014 at 3, U+2014 at 4");
    expect(idea(`一個詞${EM}另一個`)[0]!.message).toContain("1 dash: U+2014 at 3");
  });

  it("fails an en dash anywhere but between two digits", () => {
    for (const text of [`一個${EN}詞`, `a${EN}b`, `1${EN}b`, `a${EN}2`, `${EN}2`, `2${EN}`, `一${EN}二`]) {
      expect(idea(text).map((i) => i.path), text).toEqual([KEY(IDEA)]);
    }
  });

  it("fails the box-drawing lines U+2500 and U+2501, and the other dashes of the Unicode dash class", () => {
    for (const code of [0x2500, 0x2501, 0x2012, 0x2e3b, 0xfe63, 0x301c, 0x3030, 0x30a0]) {
      expect(idea(`一個詞${u(code)}另一個`), code.toString(16)).toHaveLength(1);
    }
    for (const code of [0x2502, 0x30fc, 0xff5e, 0x2212, 0x4e00]) {
      expect(idea(`一個詞${u(code)}另一個`), code.toString(16)).toEqual([]);
    }
  });

  it("reads the text as written, before any NFKC: a full-width hyphen fails though NFKC would make it a hyphen-minus", () => {
    expect(u(0xff0d).normalize("NFKC")).toBe("-");
    expect(idea(`一個詞${u(0xff0d)}另一個`)).toHaveLength(1);
    expect(idea("一個詞-另一個")).toEqual([]);
  });

  it("reads every Chinese string and each term's zh and definition, a key the context lacks too, and not an official", () => {
    for (const key of zhWorld().context.strings.map((s) => s.key)) {
      const w = zhWorld();
      setZh(w, key, `${w.draft.strings[key]}${EM}`);
      expect(dashes(w).map((i) => i.path), key).toEqual([KEY(key)]);
    }
    const w = zhWorld();
    w.draft.terms["protein-folding"]!.zh = `蛋白質${EM}摺疊`;
    w.draft.terms["protein-folding"]!.definition = `一串${EM}胺基酸捲成形狀的過程。`;
    w.draft.terms["protein-folding"]!.official = `蛋白質${EM}摺疊`;
    expect(dashes(w).map((i) => i.path)).toEqual(['terms["protein-folding"].definition', 'terms["protein-folding"].zh']);
    setZh(w, "no.such.key", `範例${EM}`);
    expect(dashes(w).map((i) => i.path)).toContain(KEY("no.such.key"));
  });

  describe("on every stored record", () => {
    it("fails a dash in the Chinese of a finding, a brief, a term, a correction's after and a report, archived or not", () => {
      const w = publishedZhWorld();
      w.findings[0]!.explainer.found.zh = `範例${EM}發現。`;
      w.findings[2]!.explainer.found.zh = `範例${EM}發現。`;
      w.brief.ideas[0]!.text.zh = `範例${EM}點子。`;
      w.terms[0]!.zh!.definition = `一串${EM}胺基酸捲成立體形狀的過程。`;
      w.terms[0]!.zh!.term = `蛋白質摺疊${EM}`;
      w.reports[0]!.reason!.zh = `理由${EM}`;
      const paths = ["briefs/2026-11-24.json: ideas[0].text.zh", "findings/bio-2026-0001.json: explainer.found.zh", "findings/phys-2026-0003.json: explainer.found.zh",
        "glossary.json: terms[0].zh.definition", "glossary.json: terms[0].zh.term", "reports.json: reports[0].reason.zh"];
      expect(published(w, "ZH_NO_DASH").map((i) => i.path)).toEqual(paths);
      expect(published(w, "ZH_NO_DASH", null).map((i) => i.path)).toEqual(paths);
      expect(published(w, "ZH_NO_DASH", "2026-11-25").map((i) => i.path)).toEqual(paths);
    });

    it("does not read a term's official, an English string, or a stored string with no Chinese", () => {
      const w = publishedZhWorld();
      w.terms[0]!.zh!.official = `蛋白質${EM}摺疊`;
      w.findings[0]!.explainer.found = lz(`Sample ${EM} found text.`, "範例發現：蛋白質摺疊（protein folding）的結果。");
      w.findings[1]!.explainer.found = l(`Sample ${EM} found text.`);
      expect(published(w, "ZH_NO_DASH")).toEqual([]);
    });
  });
});

// ── ZH_HYPE ──────────────────────────────────────────────────────────────────────────────────────

describe("ZH_HYPE: no hype word in the Chinese, and 突破 only in a Landmark's text", () => {
  const HOW_SURE = "new.new-1.explainer.how_sure";
  const hype = (w: ZhWorld): ValidationIssue[] => zhIssues(w, "ZH_HYPE");
  const text = (key: string, zh: string, tweak: (w: ZhWorld) => void = () => {}): ValidationIssue[] => {
    const w = zhWorld({ review: true, deepDive: true });
    tweak(w);
    setZh(w, key, zh);
    return hype(w);
  };
  const landmark = (ref: string) => (w: ZhWorld): void => {
    w.english.new_findings.find((f) => f.ref === ref)!.significance = "landmark";
  };
  const words = config().hypeWords.zh;

  it("passes 突破獎委員會 in a Major finding's how_sure and fails 重大突破 there", () => {
    expect(zhWorld().english.new_findings[0]!.significance).toBe("major");
    expect(text(HOW_SURE, "已查核，突破獎委員會表示這是一項成果。")).toEqual([]);
    const found = text(HOW_SURE, "已查核，這是重大突破。");
    expect(found.map((i) => i.path)).toEqual([KEY(HOW_SURE)]);
    expect(found[0]!.message).toContain('"突破" at 8');
    expect(found[0]!.message).toContain("Say what happened instead");
    expect(found[0]!.message).toContain("stands only in a Landmark finding's own text");
  });

  it("masks each name's zh that is not null wherever it appears, and leaves another 突破 to be judged", () => {
    expect(text(HOW_SURE, "突破獎，突破獎委員會，和突破獎的得主。")).toEqual([]);
    const found = text(HOW_SURE, "突破獎得主說這是突破。");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('"突破" at 8');
  });

  it("fails every hype word of config/hype-words.json wherever it sits, matched inside a longer text, with the word and where", () => {
    expect(words).toHaveLength(11);
    // The deep dive is on a Major finding whose record the run holds: where the run cannot read the finding, 突破 is not judged (the backlog tests)
    const onMajor = (w: ZhWorld): void => {
      w.english.deep_dive!.finding_id = "bio-2026-0001";
      w.stored = { findings: [storedFinding("bio-2026-0001", { significance: "major" })], corrections: [], terms: [] };
    };
    for (const word of words) {
      for (const key of ["ideas.0", "lead.0", HOW_SURE, "review.big_picture", "deep_dive", "corrections.0.reason", "reports.R-0001.reason"]) {
        const found = text(key, `這是${word}的成果`, onMajor);
        expect(found.map((i) => i.path), `${word} in ${key}`).toEqual([KEY(key)]);
        expect(found[0]!.message, `${word} in ${key}`).toContain(`"${word}" at 2`);
      }
    }
  });

  it("lists each hit of a string in one issue, and says plural when there are several", () => {
    const found = text("ideas.0", "革命性的突破，驚人的成果。");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("uses 3 hype words");
    expect(found[0]!.message).toContain('"革命性" at 0');
    expect(found[0]!.message).toContain('"突破" at 4');
    expect(found[0]!.message).toContain('"驚人" at 7');
    expect(text("ideas.0", "驚人的成果。")[0]!.message).toContain("uses 1 hype word:");
  });

  it("passes 突破 in a Landmark's own text and fails every other hype word there", () => {
    const own = ["new.new-1.title", "new.new-1.explainer.found", "new.new-1.explainer.matters", "new.new-1.explainer.ai_helped", HOW_SURE,
      "new.new-1.explainer.background", "new.new-1.explainer.could_lead"];
    for (const key of own) {
      expect(text(key, "這是一項突破。", landmark("new-1")), key).toEqual([]);
      expect(text(key, "這是一項革命性成果。", landmark("new-1")).map((i) => i.path), key).toEqual([KEY(key)]);
      expect(text(key, "這是一項突破。").map((i) => i.path), `${key} of a finding that is not a Landmark`).toEqual([KEY(key)]);
    }
    expect(text("new.new-2.title", "一項突破", landmark("new-1")).map((i) => i.path)).toEqual([KEY("new.new-2.title")]);
    expect(text("new.new-2.rung.0", "一項突破", landmark("new-2"))).toEqual([]);
  });

  it("fails 突破 in text that is no finding's: the Lead, an idea, an Also noted line, the big picture and a report", () => {
    for (const key of ["lead.0", "ideas.0", "also.0", "review.big_picture", "reports.R-0001.reason", "review.strongest_against"]) {
      expect(text(key, "一項突破。", landmark("new-1")).map((i) => i.path), key).toEqual([KEY(key)]);
    }
  });

  it("reads a returning update and its rung note as the text of the finding they are about, filed on D with the draft's own corrections in force", () => {
    // The draft's first correction files math-2026-0002 as a Landmark on D, so its update and its rung note are a Landmark's text.
    expect(text("returning.math-2026-0002.update", "一項突破。")).toEqual([]);
    expect(text("returning.math-2026-0002.rung", "一項突破。")).toEqual([]);
    expect(text("returning.math-2026-0002.update", "一項革命性成果。")).toHaveLength(1);
    const dropped = (w: ZhWorld): void => {
      w.english.corrections.shift();
    };
    // With no correction and no record the run cannot tell what the finding is filed as, so 突破 is not judged, and another hype word still is
    expect(text("returning.math-2026-0002.update", "一項突破。", dropped)).toEqual([]);
    expect(text("returning.math-2026-0002.update", "一項革命性成果。", dropped)).toHaveLength(1);
    const stored = (significance: "landmark" | "major") => (w: ZhWorld): void => {
      dropped(w);
      const s = storedWorld();
      const math = s.findings[1]!;
      math.significance = significance;
      w.stored = { findings: [math], corrections: [], terms: s.terms };
    };
    expect(text("returning.math-2026-0002.update", "一項突破。", stored("landmark"))).toEqual([]);
    expect(text("returning.math-2026-0002.update", "一項突破。", stored("major")).map((i) => i.path)).toEqual([KEY("returning.math-2026-0002.update")]);
  });

  it("reads a rung note of a finding the brief only mentions, a deep dive and a remarkable note as the text of the finding the English names, given its stored record", () => {
    const named = (w: ZhWorld): void => {
      w.english.deep_dive!.finding_id = "bio-2026-0001";
      w.english.review!.remarkable!.finding_id = "bio-2026-0001";
    };
    const stored = (id: string, significance: "landmark" | "major") => (w: ZhWorld): void => {
      named(w);
      w.stored = { findings: [storedFinding(id, { significance })], corrections: [], terms: [] };
    };
    for (const [key, id] of [["deep_dive", "bio-2026-0001"], ["review.remarkable", "bio-2026-0001"], ["rung.phys-2026-0003", "phys-2026-0003"]] as const) {
      expect(text(key, "一項突破。", named), `${key} with no record: 突破 is not judged`).toEqual([]);
      expect(text(key, "一項革命性成果。", named).map((i) => i.path), `${key} with no record: other hype`).toEqual([KEY(key)]);
      expect(text(key, "一項突破。", stored(id, "major")).map((i) => i.path), `${key} of a Major`).toEqual([KEY(key)]);
      expect(text(key, "一項突破。", stored(id, "landmark")), `${key} of a Landmark`).toEqual([]);
      expect(text(key, "一項革命性成果。", stored(id, "landmark")).map((i) => i.path), `${key} other hype`).toEqual([KEY(key)]);
    }
  });

  it("reads a Landmark's text as first published, and a correction's after as the finding is filed on D", () => {
    // bio-2026-0001 is made a Landmark in the English draft's own text; its own explainer is as first published.
    expect(text("new.new-1.explainer.found", "一項突破。", landmark("new-1"))).toEqual([]);
    // A correction's after about a finding the stored records show as a Landmark filed on D reads as a Landmark's text.
    const w = zhWorld();
    const s = storedWorld();
    const bio = s.findings[0]!;
    bio.significance = "landmark";
    w.stored = { findings: [bio], corrections: s.corrections, terms: s.terms };
    setZh(w, "corrections.3.after", "已查核，這是一項突破。");
    expect(hype(w)).toEqual([]);
    bio.significance = "major";
    expect(hype(w).map((i) => i.path)).toEqual([KEY("corrections.3.after")]);
  });

  it("reads a backlog finding's own text as first published, though the deep dive about the same finding is read as filed on D", () => {
    const w = zhWorld({ review: true, deepDive: true });
    w.english.deep_dive!.finding_id = "bio-2026-0001";
    const s = storedWorld();
    const bio = s.findings[0]!;
    bio.significance = "landmark";
    const lowered = Correction.parse({
      id: "C-0003", date: "2026-11-23", finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "significance",
      before: l("landmark"), after: l("major"), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
    });
    w.stored = { findings: [bio], corrections: [...s.corrections, lowered], terms: s.terms };
    addString(w, { key: "backlog.bio-2026-0001.title", en: "A breakthrough", zh: "一項突破" });
    addString(w, { key: "backlog.bio-2026-0001.explainer.found", en: "A breakthrough.", zh: "一項突破。" });
    setZh(w, "deep_dive", "一項突破。");
    expect(hype(w).map((i) => i.path)).toEqual([KEY("deep_dive")]);
    bio.significance = "major";
    expect(hype(w).map((i) => i.path)).toEqual([KEY("backlog.bio-2026-0001.explainer.found"), KEY("backlog.bio-2026-0001.title"), KEY("deep_dive")]);
  });

  it("reads a backlog finding's rung note on the date that history entry was recorded, and its since update on D", () => {
    // bio-2026-0001 was filed as a Landmark when published; a correction dated 2026-11-23 lowered it to Major. Its first rung entry was
    // recorded on 2026-10-05 (a Landmark then), its second on 2026-11-24 (Major by then), and a since update reads as filed on D.
    const w = zhWorld({ review: true, deepDive: true });
    w.english.deep_dive!.finding_id = "bio-2026-0001";
    const s = storedWorld();
    const bio = s.findings[0]!;
    bio.significance = "landmark";
    expect(bio.rung_history.map((r) => r.recorded)).toEqual(["2026-10-05", "2026-11-24"]);
    const lowered = Correction.parse({
      id: "C-0003", date: "2026-11-23", finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "significance",
      before: l("landmark"), after: l("major"), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
    });
    w.stored = { findings: [bio], corrections: [...s.corrections, lowered], terms: s.terms };
    for (const key of ["backlog.bio-2026-0001.rung.0", "backlog.bio-2026-0001.rung.1", "backlog.bio-2026-0001.since.0"]) {
      addString(w, { key, en: "A breakthrough.", zh: "一項突破。" });
    }
    expect(hype(w).map((i) => i.path)).toEqual([KEY("backlog.bio-2026-0001.rung.1"), KEY("backlog.bio-2026-0001.since.0")]);
    bio.significance = "major";
    expect(hype(w).map((i) => i.path)).toEqual([
      KEY("backlog.bio-2026-0001.rung.0"), KEY("backlog.bio-2026-0001.rung.1"), KEY("backlog.bio-2026-0001.since.0"),
    ]);
  });

  it("reads a new finding's rung note as the text of a finding first published on D: a Landmark's when the draft files it as one", () => {
    expect(text("new.new-1.rung.0", "一項突破。", landmark("new-1"))).toEqual([]);
    expect(text("new.new-1.rung.0", "一項突破。").map((i) => i.path)).toEqual([KEY("new.new-1.rung.0")]);
  });

  it("reads a backlog finding by its record, which the English draft need not name: a Landmark's text passes 突破, another finding's fails, and no record is not judged (tests/rules-zh-backlog.test.ts)", () => {
    const w = zhWorld();
    addString(w, { key: "backlog.bio-2026-0009.title", en: "An old finding", zh: "一項突破", kind: "title", cap: 22 });
    expect(hype(w)).toEqual([]);
    w.stored = { findings: [storedFinding("bio-2026-0009", { significance: "landmark" })], corrections: [], terms: [] };
    expect(hype(w)).toEqual([]);
    w.stored = { findings: [storedFinding("bio-2026-0009", { significance: "major" })], corrections: [], terms: [] };
    expect(hype(w).map((i) => i.path)).toEqual([KEY("backlog.bio-2026-0009.title")]);
  });

  it("reads a term's zh and definition, and not its official, and a term is no Landmark", () => {
    const w = zhWorld();
    const term = w.draft.terms["protein-folding"]!;
    term.definition = "一串胺基酸捲成立體形狀的突破。";
    expect(hype(w).map((i) => i.path)).toEqual(['terms["protein-folding"].definition']);
    term.definition = "一串胺基酸捲成立體形狀的過程。";
    term.zh = "革命性蛋白質摺疊";
    expect(hype(w).map((i) => i.path)).toEqual(['terms["protein-folding"].zh']);
    term.zh = "蛋白質摺疊";
    term.official = "革命性蛋白質摺疊";
    expect(hype(w)).toEqual([]);
  });

  it("reads the words of config/hype-words.json, not a list of its own, and each name's zh from it", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "hype-words.json"), "utf8")) as { zh: string[]; names: { en: string; zh: string | null }[] };
    const w = zhWorld();
    setZh(w, "ideas.0", "一個超強的想法，叫超強計畫。");
    expect(hype(w)).toEqual([]);
    w.config = loadConfig(undefined, { overrides: { hypeWords: { ...raw, zh: [...raw.zh, "超強"], names: [...raw.names, { en: "Breakthrough Super Plan", zh: "超強計畫" }] } } });
    const found = hype(w);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('"超強" at 2');
    expect(found[0]!.message).not.toContain('"超強" at 9');
    setZh(w, "ideas.0", "一個想法，叫超強計畫。");
    expect(hype(w)).toEqual([]);
  });

  it("reads a key the context lacks too", () => {
    const w = zhWorld();
    setZh(w, "no.such.key", "驚人的成果。");
    expect(hype(w).map((i) => i.path)).toEqual([KEY("no.such.key")]);
  });

  it("knows no Landmark behind a key of no section: 突破 in it is judged as in any text that is no finding's", () => {
    const w = zhWorld();
    setZh(w, "no.such.key", "這是突破。");
    expect(hype(w).map((i) => i.path)).toEqual([KEY("no.such.key")]);
    expect(hype(w)[0]!.message).toContain('"突破" at 2');
  });

  describe("on the records being published", () => {
    const BIO = "findings/bio-2026-0001.json";

    it("fails a hype word in a finding, the brief and a term being published, and none in an archived one", () => {
      const w = publishedZhWorld();
      w.findings[0]!.explainer.matters.zh = "這是革命性的意義。";
      w.findings[2]!.explainer.matters.zh = "這是革命性的意義。";
      w.brief.ideas[0]!.text.zh = "一個驚人的點子。";
      w.terms[0]!.zh!.definition = "一串胺基酸捲成立體形狀的神奇過程。";
      expect(published(w, "ZH_HYPE").map((i) => i.path)).toEqual([
        `briefs/${D}.json: ideas[0].text.zh`, `${BIO}: explainer.matters.zh`, "glossary.json: terms[0].zh.definition",
      ]);
      expect(published(w, "ZH_HYPE", null)).toEqual([]);
      expect(published(w, "ZH_HYPE", "2026-11-25")).toEqual([]);
    });

    it("passes 突破獎委員會 in a Major finding's how_sure and fails 重大突破 there", () => {
      const w = publishedZhWorld();
      expect(w.findings[0]!.significance).toBe("major");
      w.findings[0]!.explainer.how_sure.zh = "已查核，突破獎委員會表示。";
      expect(published(w, "ZH_HYPE")).toEqual([]);
      w.findings[0]!.explainer.how_sure.zh = "已查核，這是重大突破。";
      expect(published(w, "ZH_HYPE").map((i) => i.path)).toEqual([`${BIO}: explainer.how_sure.zh`]);
    });

    it("passes 突破 in a Landmark's own text and fails it in the brief's Lead", () => {
      const w = publishedZhWorld();
      w.findings[0]!.significance = "landmark";
      w.findings[0]!.explainer.matters.zh = "這是一項突破。";
      w.findings[0]!.title.zh = "突破成果";
      expect(published(w, "ZH_HYPE")).toEqual([]);
      w.brief.lead[0]!.text.zh = "今天有一項突破。";
      expect(published(w, "ZH_HYPE").map((i) => i.path)).toEqual([`briefs/${D}.json: lead[0].text.zh`]);
    });

    it("passes 突破 in a correction's before at the explainer.found of a Landmark that an earlier correction lowered to major, and fails it in the after", () => {
      const w = publishedZhWorld();
      w.findings[0]!.significance = "landmark";
      const correction = (id: string, date: string, path: string, after: { en: string; zh: string | null }, before: { en: string; zh: string | null } = l("before")): Correction => Correction.parse({
        id, date, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path, before, after,
        reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
      });
      w.corrections.push(correction("C-0003", "2026-11-23", "significance", l("major")));
      w.corrections.push(correction("C-0004", D, "explainer.found", lz("Sample found text.", "範例發現。"), lz("A breakthrough.", "一項突破。")));
      expect(published(w, "ZH_HYPE")).toEqual([]);
      w.corrections[3] = correction("C-0004", D, "explainer.found", lz("A breakthrough.", "一項突破。"), lz("A breakthrough.", "一項突破。"));
      expect(published(w, "ZH_HYPE").map((i) => i.path)).toEqual(["corrections.json: corrections[3].after.zh"]);
      w.corrections.splice(2, 1);
      w.corrections[2] = correction("C-0004", D, "explainer.found", lz("A breakthrough.", "一項突破。"), lz("A breakthrough.", "一項突破。"));
      expect(published(w, "ZH_HYPE")).toEqual([]);
    });
  });
});

// ── The text rules on stored records ─────────────────────────────────────────────────────────────

describe("the text rules on stored records: removed text, a correction's before, and which records are read", () => {
  const BIO = "findings/bio-2026-0001.json";
  const PHYS = "findings/phys-2026-0003.json";
  /** A Chinese string that breaks five rules at once: a simplified-only character, a mainland term, an em dash, a hype word and 70 characters of length. */
  const BAD = `这算法${EM}革命性${HAN(70)}`;
  const TEXT_CODES = ["ZH_TRADITIONAL", "ZH_AVOID", "ZH_NO_DASH", "ZH_HYPE", "ZH_CHARS"];
  const at = (w: PublishedZhWorld, code: string, where: string, publishing: string | null = D): ValidationIssue[] =>
    published(w, code, publishing).filter((i) => i.path === where);
  const correction = (type: "correction" | "removed", path: string, before: ReturnType<typeof lz>, after: ReturnType<typeof lz>, id = "C-0003"): Correction => Correction.parse({
    id, date: D, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type, path, before, after,
    reason: l("A change."), source_url: null, trigger: type === "removed" ? "recheck" : "editor", report_id: null,
  });

  it("fails each of the five rules on the string, so that the skips below mean something", () => {
    const w = publishedZhWorld();
    w.findings[0]!.explainer.could_lead.zh = BAD;
    for (const code of TEXT_CODES) expect(at(w, code, `${BIO}: explainer.could_lead.zh`), code).toHaveLength(1);
  });

  it("skips a string that a stored removed correction rewrote only where the record holds REMOVED_TEXT in both languages, in every text rule, and judges the same text elsewhere", () => {
    const w = publishedZhWorld();
    w.findings[0]!.explainer.could_lead = lz("This text was removed.", BAD);
    w.findings[0]!.explainer.background.zh = BAD;
    w.corrections.push(correction("removed", "explainer.could_lead", lz("[removed text]", "〔已移除的文字〕"), lz("This text was removed.", "此處文字已移除。")));
    // a removal that left the Chinese side as it was (the English side only is the marker) is no removal: the Chinese text is judged
    for (const code of TEXT_CODES) {
      expect(at(w, code, `${BIO}: explainer.could_lead.zh`), `${code} on a half-removed string`).toHaveLength(1);
      expect(at(w, code, `${BIO}: explainer.background.zh`), `${code} on its neighbour`).toHaveLength(1);
    }
    // holding the marker in both languages, it has nothing left for any of the five rules to find
    w.findings[0]!.explainer.could_lead = lz("This text was removed.", "此處文字已移除。");
    for (const code of TEXT_CODES) {
      expect(at(w, code, `${BIO}: explainer.could_lead.zh`), `${code} on the removed string`).toEqual([]);
      expect(at(w, code, `${BIO}: explainer.background.zh`), `${code} on its neighbour`).toHaveLength(1);
    }
  });

  it("never reads a correction's before, which publish copies from text published earlier, and reads its after", () => {
    const w = publishedZhWorld();
    w.corrections.push(correction("correction", "explainer.found", lz("Before.", `${BAD}${HAN(400)}`), lz("After.", BAD)));
    const before = "corrections.json: corrections[2].before.zh";
    const after = "corrections.json: corrections[2].after.zh";
    for (const code of TEXT_CODES) expect(at(w, code, before), `${code} on before`).toEqual([]);
    for (const code of ["ZH_TRADITIONAL", "ZH_AVOID", "ZH_NO_DASH", "ZH_HYPE"]) expect(at(w, code, after), `${code} on after`).toHaveLength(1);
    expect(at(w, "ZH_CHARS", after)).toEqual([]);
    w.corrections[2] = correction("correction", "explainer.found", lz("Before.", "之前。"), lz("After.", HAN(301)));
    expect(at(w, "ZH_CHARS", after)).toHaveLength(1);
  });

  it("judges a record that is not being published only by the rules that read no config: the dash and the English once", () => {
    const w = publishedZhWorld();
    w.findings[2]!.explainer.found.zh = BAD;
    w.findings[2]!.title.zh = `${HAN(30)}`;
    for (const code of ["ZH_TRADITIONAL", "ZH_AVOID", "ZH_HYPE", "ZH_CHARS", "ZH_TERMS"]) expect(at(w, code, `${PHYS}: explainer.found.zh`), code).toEqual([]);
    expect(at(w, "ZH_NO_DASH", `${PHYS}: explainer.found.zh`)).toHaveLength(1);
    expect(published(w, "ZH_CHARS").filter((i) => i.path.startsWith(PHYS))).toEqual([]);
  });

  it("judges the records being published against the config: a finding, a term, a correction, a report and the brief", () => {
    const w = publishedZhWorld();
    w.brief.ideas[0]!.text.zh = BAD;
    w.findings[0]!.explainer.matters.zh = `${BAD}${HAN(20)}`;
    w.terms[0]!.zh!.definition = BAD;
    w.corrections[1]!.reason = lz("The record was wrong.", BAD);
    w.reports[0]!.reason = lz("The source says this.", BAD);
    const where = [`briefs/${D}.json: ideas[0].text.zh`, `${BIO}: explainer.matters.zh`, "glossary.json: terms[0].zh.definition",
      "corrections.json: corrections[1].reason.zh", "reports.json: reports[0].reason.zh"];
    for (const code of ["ZH_TRADITIONAL", "ZH_AVOID", "ZH_NO_DASH", "ZH_HYPE"]) {
      expect(published(w, code).map((i) => i.path).sort(), code).toEqual([...where].sort());
    }
    expect(published(w, "ZH_CHARS").map((i) => i.path).sort()).toEqual([...where].sort());
    for (const code of ["ZH_TRADITIONAL", "ZH_AVOID", "ZH_HYPE", "ZH_CHARS"]) expect(published(w, code, null), `${code} with nothing being published`).toEqual([]);
    expect(published(w, "ZH_NO_DASH", null)).toHaveLength(5);
  });

  it("runs only the group's published codes on a stored record: no ZH_KEYS, ZH_PARITY, ZH_RUNG_LABEL or ZH_OFFICIAL, whatever it holds", () => {
    const w = publishedZhWorld();
    w.findings[0]!.explainer.how_sure.zh = "經查核，來源是 Example Journal 二。";
    w.findings[0]!.explainer.matters.zh = "範例意義 99 http://example.org。";
    w.terms[0]!.zh!.official_url = "https://example.org/x";
    w.terms[0]!.zh!.official = "蛋白質摺疊";
    const codes = [...new Set(publishedRun(w).map((i) => i.code))];
    for (const code of ["ZH_KEYS", "ZH_PARITY", "ZH_RUNG_LABEL", "ZH_OFFICIAL"]) expect(codes).not.toContain(code);
  });
});

// ── What the issues say ──────────────────────────────────────────────────────────────────────────

// ── A key of no known shape ──────────────────────────────────────────────────────────────────────

describe("a context key of a shape no section has: free text to the text rules, and no finding to any other rule", () => {
  const ODD = "odd.shape";
  const RUNG = "odd.rung";

  it("is read by each text rule, throws in none, and leaves ZH_RUNG_LABEL, ZH_ENGLISH_ONCE and ZH_KEYS nothing to say", () => {
    const w = zhWorld();
    // One line that breaks seven rules at once: a number and a fixed term missing, a simplified character, a mainland term, a dash,
    // 突破 (which no Landmark owns here) and more characters than the key's cap of 12.
    addString(w, { key: ODD, en: "An enzyme result of 2024 was studied.", zh: `这是軟件的突破${EM}一段很長的中文字。`, kind: "line", cap: 12 });
    // An English line that starts with a rung label, under a key that is no how_sure.
    addString(w, { key: RUNG, en: "Checked by a lab.", zh: "由實驗室查證。", kind: "line", cap: 100 });
    const issues = zhRun(w);
    expect(issues.filter((i) => i.code === "RULE_ERROR")).toEqual([]);
    expect(codesOf(issues)).toEqual(["ZH_AVOID", "ZH_CHARS", "ZH_HYPE", "ZH_NO_DASH", "ZH_PARITY", "ZH_TERMS", "ZH_TRADITIONAL"]);
    expect(issues.every((i) => i.path === KEY(ODD))).toBe(true);
    expect(issues.filter((i) => i.code === "ZH_HYPE")[0]!.message).toContain('"突破" at 5');
  });

  it("is no part of the page total, which counts the keys WORDS' page total counts", () => {
    const w = zhWorld();
    const before = zhPageTotal(zhInputOf(w));
    addString(w, { key: ODD, en: "An odd line.", zh: HAN(30), kind: "line", cap: 100 });
    expect(zhPageTotal(zhInputOf(w))).toBe(before);
  });
});

describe("the issues: what each says, where it points and the Chinese it shows", () => {
  /** The one issue of a code on a world. */
  const one = (w: ZhWorld, code: string): ValidationIssue => {
    const found = zhIssues(w, code);
    expect(found, code).toHaveLength(1);
    return found[0]!;
  };
  /** A world whose `ideas.0` has the given English and Chinese, and whose English has no number. */
  const idea = (en: string, zh: string): ZhWorld => setZh(setEn(zhWorld(), "ideas.0", en), "ideas.0", zh);
  const ideaZh = (zh: string): ZhWorld => setZh(zhWorld(), "ideas.0", zh);
  /** What a message shows of the Chinese: the text between `Chinese: "` and the closing quote and full stop. */
  const shown = (message: string): string => {
    const open = 'Chinese: "';
    return message.slice(message.lastIndexOf(open) + open.length, -2);
  };
  const point = (char: string, at: number): string => `${char} (U+${char.codePointAt(0)!.toString(16).toUpperCase()}) at ${at}`;

  describe("every rule is called by hand with an input of a mode it does not run in", () => {
    it("returns nothing, whatever the world holds: the rule never reads an input that is not its own", () => {
      const w = zhWorld();
      const breaks: [string, (w: ZhWorld) => void][] = [
        ["ZH_KEYS", (x) => { delete x.draft.strings["lead.1"]; }],
        ["ZH_PARITY", (x) => { setPair(x, "ideas.0", "It had 3 students.", "它有 4 名學生。"); }],
        ["ZH_TRADITIONAL", (x) => { setZh(x, "also.0", "这項範例土壤研究"); }],
        ["ZH_AVOID", (x) => { setZh(x, "reports.R-0001.reason", "這個算法說了這樣。"); }],
        ["ZH_TERMS", (x) => { setZh(x, "returning.math-2026-0002.update", "一家刊物刊出了這項證明。"); }],
        ["ZH_RUNG_LABEL", (x) => { setZh(x, "new.new-2.explainer.how_sure", "經查核，來源是 Example Journal。"); }],
        ["ZH_ENGLISH_ONCE", (x) => { setZh(x, "new.new-1.explainer.found", "系統找出蛋白質摺疊在酵素中的運作方式。"); }],
        ["ZH_CHARS", (x) => { setZh(x, "lead.0", HAN(150)); }],
        ["ZH_OFFICIAL", (x) => { x.draft.terms["protein-folding"]!.official = OFFICIAL_TERM; x.draft.terms["protein-folding"]!.official_url = "https://example.org/x"; }],
        ["ZH_NO_DASH", (x) => { setZh(x, "corrections.1.reason", `領域${EM}有誤。`); }],
        ["ZH_HYPE", (x) => { setZh(x, "corrections.2.reason", "子領域有驚人的誤。"); }],
      ];
      for (const [, edit] of breaks) edit(w);
      expect(codesOf(zhRun(w))).toEqual(breaks.map(([code]) => code).sort());
      const base = zhInputOf(w);
      for (const rule of zhRules) {
        const code = rule.codes[0]!;
        expect(rule.check({ ...base, mode: "draft" } as unknown as RuleInput), `${code} on a draft-mode input`).toEqual([]);
        if (rule.scope.length === 1) expect(rule.check({ ...base, mode: "published" } as unknown as RuleInput), `${code} on a published-mode input`).toEqual([]);
        expect(rule.check(base).length, `${code} on its own input`).toBeGreaterThan(0);
      }
    });
  });

  describe("ZH_PARITY says each kind of problem on its own, and joins several with a semicolon", () => {
    const parity = (en: string, zh: string): string => one(idea(en, zh), "ZH_PARITY").message;

    it("names a number the Chinese lacks, a number it adds, a link and a Latin word, each alone", () => {
      expect(parity("It had 3 students.", "它有學生。")).toBe('ideas.0: the English has 3, which the Chinese lacks. Chinese: "它有學生。".');
      expect(parity("It had students.", "它有 3 名學生。")).toBe('ideas.0: the Chinese has 3, which the English lacks. Chinese: "它有 3 名學生。".');
      expect(parity("See it.", "請見 https://example.org/a 。")).toBe('ideas.0: the Chinese holds the link https://example.org/a. Chinese: "請見 https://example.org/a 。".');
      expect(parity("The tool is called Foo.", "這個工具叫 Foo 和 Bar。")).toBe('ideas.0: the Chinese holds the Latin word Bar, which the English lacks. Chinese: "這個工具叫 Foo 和 Bar。".');
    });

    it("says links and words in the plural when there are several", () => {
      expect(parity("See it.", "請見 https://example.org/a 和 https://example.org/b 。")).toContain("the Chinese holds the links https://example.org/a, https://example.org/b. Chinese:");
      expect(parity("The tool is called Foo.", "這個工具叫 Foo、Bar 和 Baz。")).toContain("the Chinese holds the Latin words Bar, Baz, which the English lacks.");
    });

    it("joins the kinds in the order missing, extra, link, Latin word", () => {
      expect(parity("It had 3 students.", "它有 4 名學生，見 https://example.org/a 和 Bar 。")).toBe(
        'ideas.0: the English has 3, which the Chinese lacks; the Chinese has 4, which the English lacks; the Chinese holds the link https://example.org/a; '
        + 'the Chinese holds the Latin word Bar, which the English lacks. Chinese: "它有 4 名學生，見 https://example.org/a 和 Bar 。".',
      );
    });

    it("lists six numbers in full and names how many more beyond them", () => {
      expect(parity("Counts were 11, 12, 13, 14, 15 and 16.", "數量。")).toContain("the English has 11, 12, 13, 14, 15, 16, which the Chinese lacks");
      expect(parity("Counts were 11, 12, 13, 14, 15, 16 and 17.", "數量。")).toContain("the English has 11, 12, 13, 14, 15, 16 and 1 more, which the Chinese lacks");
      expect(parity("Counts were 11, 12, 13, 14, 15, 16, 17 and 18.", "數量。")).toContain("the English has 11, 12, 13, 14, 15, 16 and 2 more, which the Chinese lacks");
    });

    it("says the same for a term: its zh and definition together, each cut at forty characters", () => {
      const w = zhWorld();
      const t = w.draft.terms["protein-folding"]!;
      t.zh = `蛋白質摺疊${HAN(35)}`;
      t.definition = `4${HAN(40)}`;
      const issue = one(w, "ZH_PARITY");
      expect(issue.path).toBe('terms["protein-folding"]');
      expect(issue.message).toContain(`terms.protein-folding: the Chinese has 4, which the English lacks. Chinese: "${t.zh}" and "4${HAN(39)}…".`);
      t.zh = `蛋白質摺疊${HAN(36)}`;
      expect(one(w, "ZH_PARITY").message).toContain(`Chinese: "蛋白質摺疊${HAN(35)}…" and "`);
    });
  });

  describe("a Chinese text is shown whole to forty characters, and cut with a mark after that", () => {
    const wrong = (n: number): string => `有 4 名${HAN(n - 5)}`;
    const parity = (zh: string): string => one(idea("It had 3 students.", zh), "ZH_PARITY").message;

    it("cuts the text of ZH_PARITY at 40 characters", () => {
      expect(Array.from(wrong(40))).toHaveLength(40);
      expect(parity(wrong(40))).toContain(`Chinese: "${wrong(40)}".`);
      expect(parity(wrong(41))).toContain(`Chinese: "${Array.from(wrong(41)).slice(0, 40).join("")}…".`);
      expect(parity(wrong(41))).not.toContain(wrong(41));
    });

    it("cuts the text of ZH_CHARS at 40 characters", () => {
      const chars = (n: number): string => one(setZh(zhWorld(), "new.new-1.title", HAN(n)), "ZH_CHARS").message;
      expect(chars(40)).toContain(`Chinese: "${HAN(40)}".`);
      expect(chars(41)).toContain(`Chinese: "${HAN(40)}…".`);
    });

    it("cuts the text of ZH_TERMS at 40 characters", () => {
      const terms = (n: number): string => one(setZh(zhWorld(), "returning.math-2026-0002.update", `一家期刊${HAN(n - 4)}`), "ZH_TERMS").message;
      expect(terms(40)).toContain(`the Chinese lacks 證明. Use 證明 there. Chinese: "一家期刊${HAN(36)}".`);
      expect(terms(41)).toContain(`the Chinese lacks 證明. Use 證明 there. Chinese: "一家期刊${HAN(36)}…".`);
    });

    it("cuts the English that ZH_KEYS shows at 60 characters", () => {
      const keys = (n: number): string => {
        const w = zhWorld();
        w.context.strings.find((x) => x.key === "lead.0")!.en = "x".repeat(n);
        delete w.draft.strings["lead.0"];
        return one(w, "ZH_KEYS").message;
      };
      expect(keys(60)).toContain(`the English is: "${"x".repeat(60)}".`);
      expect(keys(61)).toContain(`the English is: "${"x".repeat(60)}…".`);
    });

    it("cuts the Chinese that ZH_RUNG_LABEL shows at 12 characters", () => {
      const rung = (n: number): string => one(setZh(zhWorld(), "new.new-1.explainer.how_sure", `經查核${HAN(n - 3)}`), "ZH_RUNG_LABEL").message;
      expect(rung(12)).toContain(`It starts "經查核${HAN(9)}".`);
      expect(rung(13)).toContain(`It starts "經查核${HAN(9)}…".`);
    });

    it("cuts the address that ZH_OFFICIAL shows at 80 characters", () => {
      const official = (url: string): string => {
        const w = zhWorld();
        w.draft.terms["protein-folding"]!.official = OFFICIAL_TERM;
        w.draft.terms["protein-folding"]!.official_url = url;
        return one(w, "ZH_OFFICIAL").message;
      };
      const url = (n: number): string => `https://example.org/${"a".repeat(n - 20)}`;
      expect(official(url(80))).toContain(`the official_url "${url(80)}" is not`);
      expect(official(url(81))).toContain(`the official_url "${url(80)}…" is not`);
    });
  });

  describe("the Chinese around the first hit: ten characters before it and twenty from it, with a mark where it is cut", () => {
    const trad = (zh: string): string => shown(one(ideaZh(zh), "ZH_TRADITIONAL").message);

    it("shows the whole text when at most ten characters come before the hit and at most twenty from it", () => {
      expect(trad(`${HAN(10)}这${HAN(19)}`)).toBe(`${HAN(10)}这${HAN(19)}`);
      expect(trad(`这${HAN(5)}`)).toBe(`这${HAN(5)}`);
      expect(trad("这")).toBe("这");
    });

    it("cuts the front with a mark from the eleventh character before the hit", () => {
      expect(trad(`${HAN(11)}这${HAN(19)}`)).toBe(`…${HAN(10)}这${HAN(19)}`);
      expect(trad(`${HAN(30)}这${HAN(3)}`)).toBe(`…${HAN(10)}这${HAN(3)}`);
    });

    it("cuts the end with a mark from the twenty-first character counted from the hit", () => {
      expect(trad(`${HAN(10)}这${HAN(20)}`)).toBe(`${HAN(10)}这${HAN(19)}…`);
      expect(trad(`${HAN(3)}这${HAN(40)}`)).toBe(`${HAN(3)}这${HAN(19)}…`);
    });

    it("cuts both ends, and centres on the first hit when there are several", () => {
      expect(trad(`${HAN(30)}这${HAN(30)}`)).toBe(`…${HAN(10)}这${HAN(19)}…`);
      expect(trad(`${HAN(15)}这${HAN(40)}们${HAN(15)}`)).toBe(`…${HAN(10)}这${HAN(19)}…`);
    });

    it("is the same in the other rules that show it: ZH_AVOID, ZH_NO_DASH and ZH_HYPE", () => {
      expect(shown(one(ideaZh(`${HAN(30)}算法${HAN(30)}`), "ZH_AVOID").message)).toBe(`…${HAN(10)}算法${HAN(18)}…`);
      expect(shown(one(ideaZh(`${HAN(30)}${EM}${HAN(30)}`), "ZH_NO_DASH").message)).toBe(`…${HAN(10)}${EM}${HAN(19)}…`);
      expect(shown(one(ideaZh(`${HAN(30)}驚人${HAN(30)}`), "ZH_HYPE").message)).toBe(`…${HAN(10)}驚人${HAN(18)}…`);
      expect(shown(one(ideaZh(`${HAN(5)}算法${HAN(5)}`), "ZH_AVOID").message)).toBe(`${HAN(5)}算法${HAN(5)}`);
      expect(shown(one(ideaZh(`${HAN(5)}${EM}${HAN(5)}`), "ZH_NO_DASH").message)).toBe(`${HAN(5)}${EM}${HAN(5)}`);
      expect(shown(one(ideaZh(`${HAN(5)}驚人${HAN(5)}`), "ZH_HYPE").message)).toBe(`${HAN(5)}驚人${HAN(5)}`);
    });

    it("centres on the first hit in those rules too, not on a later one", () => {
      expect(shown(one(ideaZh(`${HAN(15)}算法${HAN(40)}軟件${HAN(5)}`), "ZH_AVOID").message)).toBe(`…${HAN(10)}算法${HAN(18)}…`);
      expect(shown(one(ideaZh(`${HAN(15)}${EM}${HAN(40)}${EM}${HAN(5)}`), "ZH_NO_DASH").message)).toBe(`…${HAN(10)}${EM}${HAN(19)}…`);
      expect(shown(one(ideaZh(`${HAN(15)}驚人${HAN(40)}震撼${HAN(5)}`), "ZH_HYPE").message)).toBe(`…${HAN(10)}驚人${HAN(18)}…`);
    });
  });

  describe("a list in a message names six items and how many more", () => {
    const trad = (zh: string): string => one(ideaZh(zh), "ZH_TRADITIONAL").message;

    it("lists the characters of ZH_TRADITIONAL, singular for one and plural for several, with it and them", () => {
      expect(trad("这")).toContain(`The Chinese holds the simplified-only character ${point("这", 0)}: Taiwan does not write it.`);
      expect(trad("这个")).toContain(`The Chinese holds the simplified-only characters ${point("这", 0)}, ${point("个", 1)}: Taiwan does not write them.`);
      expect(trad("这両")).toContain(`The Chinese holds the simplified-only character ${point("这", 0)} and the Japanese-only character ${point("両", 1)}: Taiwan does not write them.`);
      expect(trad("両")).toContain(`The Chinese holds the Japanese-only character ${point("両", 0)}: Taiwan does not write it.`);
    });

    it("shows six of seven characters and says 1 more", () => {
      expect(trad("这个们东书买")).toContain(
        `The Chinese holds the simplified-only characters ${["这", "个", "们", "东", "书", "买"].map((c, i) => point(c, i)).join(", ")}: Taiwan does not write them.`,
      );
      expect(trad("这个们东书买乱")).toContain(
        `The Chinese holds the simplified-only characters ${["这", "个", "们", "东", "书", "买"].map((c, i) => point(c, i)).join(", ")} and 1 more: Taiwan does not write them.`,
      );
    });

    it("names the dashes of ZH_NO_DASH and the hype words of ZH_HYPE in the singular and the plural", () => {
      const dash = (zh: string): string => one(ideaZh(zh), "ZH_NO_DASH").message;
      expect(dash(`一個詞${EM}另一個`)).toContain("has 1 dash: U+2014 at 3. Write the sentence without it:");
      expect(dash(`一個詞${EM}${EM}另一個`)).toContain("has 2 dashes: U+2014 at 3, U+2014 at 4. Write the sentence without them:");
      const hype = (zh: string): string => one(ideaZh(zh), "ZH_HYPE").message;
      expect(hype("這是驚人的結果。")).toContain('uses 1 hype word: "驚人" at 2.');
      expect(hype("這是驚人也震撼的結果。")).toContain('uses 2 hype words: "驚人" at 2, "震撼" at 5.');
    });

    it("names each mainland term of ZH_AVOID with the Taiwan one, singular and plural alike", () => {
      const avoid = (zh: string): string => one(ideaZh(zh), "ZH_AVOID").message;
      expect(avoid("這個算法很好。")).toContain('mainland wording: "算法" at 2 (Taiwan writes "演算法"). Write the Taiwan term instead.');
      expect(avoid("這個算法和軟件很好。")).toContain('"算法" at 2 (Taiwan writes "演算法"), "軟件" at 5 (Taiwan writes "軟體"). Write the Taiwan term instead.');
    });
  });

  describe("ZH_HYPE says what 突破 means only when it is the word found", () => {
    it("adds the Landmark note for 突破 and for no other hype word", () => {
      const hype = (zh: string): string => one(ideaZh(zh), "ZH_HYPE").message;
      expect(hype("這是突破。")).toContain('突破 translates "breakthrough" and stands only in a Landmark finding\'s own text, a returning update, the deep dive or the remarkable note on one.');
      expect(hype("這是驚人的結果。")).not.toContain("translates");
      expect(hype("這是驚人的突破。")).toContain("translates");
      expect(hype("這是突破。")).toMatch(/Say what happened instead, with the figure if there is one\. 突破 translates/);
      expect(hype("這是驚人的結果。")).toMatch(/Say what happened instead, with the figure if there is one\. Chinese: /);
    });
  });
});
