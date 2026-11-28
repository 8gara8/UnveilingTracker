// The Chinese rule group, second reader (SPEC §4.12 ZH_KEYS to ZH_HYPE): the tests that a mutation run over lib/rules/zh.ts showed the
// first suite (tests/rules-zh.test.ts) leaves open, and the edges that an adversarial read found. Each test breaks one thing in a valid
// world (tests/helpers/zh-world.ts) and expects one code, as the first suite does; a test here names the one-line change of the rule
// that it exists to catch. The engine around the rules is tests/validate-zh.test.ts, the fixtures are tests/fixtures-zh-invalid.test.ts.
//
// New for this project; Cyber had no Chinese pass.

import { describe, expect, it } from "vitest";
import { formatPath } from "@/lib/rules/types";
import { dropKey, setEn, setZh, zhIssues, zhWorld } from "./helpers/zh-world";

const KEY = (key: string): string => formatPath(["strings", key]);
const FOUND = "new.new-1.explainer.found";
const MATTERS = "new.new-1.explainer.matters";

// ── ZH_AVOID ─────────────────────────────────────────────────────────────────────────────────────

describe("ZH_AVOID masks every fixed translation before it looks for an avoid term", () => {
  it("passes an avoid term inside a fixed translation that no allow_in string covers, and fails the term on its own", () => {
    const w = zhWorld();
    // The seed config has no such pair (算法 sits inside 演算法, which its allow_in lists): a fixed translation made to hold 軟件.
    const kit = { en: "software kit", zh: "軟件包", fields: [], except: [] };
    w.config = { ...w.config, termsZh: { ...w.config.termsZh, fixed: [...w.config.termsZh.fixed, kit] } };
    expect(w.config.termsZh.avoid.find((a) => a.term === "軟件")?.allow_in).toEqual([]);
    setZh(w, "ideas.0", "一項關於軟件包的範例論點。");
    expect(zhIssues(w, "ZH_AVOID")).toEqual([]);
    setZh(w, "ideas.0", "一項關於軟件的範例論點。");
    expect(zhIssues(w, "ZH_AVOID").map((i) => i.path)).toEqual([KEY("ideas.0")]);
  });
});

// ── ZH_RUNG_LABEL ────────────────────────────────────────────────────────────────────────────────

describe("ZH_RUNG_LABEL reads a correction's after and nothing else of a correction", () => {
  it("leaves the reason of a correction on explainer.how_sure alone, whatever word it starts with", () => {
    const w = zhWorld();
    const path = (key: string): boolean => w.english.corrections.some((c, i) => key === `corrections.${i}.after` && c.path === "explainer.how_sure");
    expect(path("corrections.3.after")).toBe(true);
    setEn(w, "corrections.3.reason", "Checked again against the notice: the earlier version left out the other lab.");
    expect(zhIssues(w, "ZH_RUNG_LABEL")).toEqual([]);
    setEn(w, "corrections.3.after", "Checked. A second lab also repeated it, and Example Journal published both.");
    setZh(w, "corrections.3.after", "經查核，另一個實驗室也重複了它。");
    expect(zhIssues(w, "ZH_RUNG_LABEL").map((i) => i.path)).toEqual([KEY("corrections.3.after")]);
  });
});

// ── ZH_ENGLISH_ONCE ──────────────────────────────────────────────────────────────────────────────

describe("ZH_ENGLISH_ONCE reads a new finding as the context gives it", () => {
  it("does not take a part that a new finding's context lacks for a removed one: only a backlog finding has parts removed", () => {
    const w = zhWorld();
    dropKey(w, FOUND);
    setEn(w, MATTERS, "The enzyme matters.");
    setZh(w, MATTERS, "酵素很重要。");
    expect(zhIssues(w, "ZH_ENGLISH_ONCE").map((i) => i.path)).toEqual([KEY(MATTERS)]);
    setZh(w, MATTERS, "酵素（enzyme）很重要。");
    expect(zhIssues(w, "ZH_ENGLISH_ONCE")).toEqual([]);
  });

  it("names the first part the context has when a term is never used, not the first part of a whole explainer", () => {
    const w = zhWorld();
    dropKey(w, FOUND);
    setEn(w, MATTERS, "The enzyme matters.");
    setZh(w, MATTERS, "它很重要。");
    const found = zhIssues(w, "ZH_ENGLISH_ONCE");
    expect(found.map((i) => i.path)).toEqual([KEY(MATTERS)]);
    expect(found[0]!.message).toContain("never uses the term \"enzyme\" (酵素)");
  });
});
