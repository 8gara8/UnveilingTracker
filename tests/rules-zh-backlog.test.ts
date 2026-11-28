// The backlog of the Chinese run (SPEC §4.6 "the backlog", §4.12 ZH_HYPE and DUAL_USE; fix-list F-15 and F-15b). Besides the findings the
// English draft names, the Chinese pass translates a backlog of stored findings that only its own `backlog.<id>.*` keys name. In a
// zh run the roster of finding views holds each of them: `buildZhInput()` hands the ids of those keys, from the context and from the
// Chinese draft (`zhBacklogIds()`), to the views as `ViewSourceDraft.backlog`. A finding the run was given the record of
// (`ZhInputs.stored`) is a full view; any other is a partial one that knows no fact, and a rule skips what it cannot know. So ZH_HYPE
// does not judge 突破 where it cannot read the finding's significance, nor in a rung note of a finding whose history it lacks (the note
// is read on the day its entry was recorded), though every other hype word is still judged there, and a key that names no finding of
// the run is no finding's text; DUAL_USE does not read numbered steps where it cannot read the field. These tests pin the helper, the views, each rule's reading of a backlog
// string with and without the record, and what no code reports. The rules' other tests are tests/rules-zh.test.ts and
// tests/rules-safety.test.ts, the engine's tests/validate-zh.test.ts.
//
// New for this project; Cyber had no Chinese pass.

import { describe, expect, it } from "vitest";
import { runRules } from "@/lib/rules/run";
import { safetyRules } from "@/lib/rules/safety";
import { zhRules } from "@/lib/rules/zh";
import { formatPath, type ValidationIssue } from "@/lib/rules/types";
import { buildViews } from "@/lib/rules/views";
import { Correction } from "@/lib/schema/misc";
import { buildZhInput, validateZh, zhBacklogIds } from "@/lib/validate-zh";
import { EXPLAINER_PARTS } from "@/lib/vocab";
import { D, deepFreeze, l, storedFinding } from "./helpers/rule-world";
import { addString, inputsOf, setZh, zhInputOf, zhIssues, zhRun, zhWorld, type ZhWorld } from "./helpers/zh-world";

const KEY = (key: string): string => formatPath(["strings", key]);

const BREAKTHROUGH = "這是一項突破。";
const OTHER_HYPE = "這是一項革命性成果。";
const STEPS_ZH = "步驟一：混合。步驟二：加熱。";

/** The strings of a finding that are its own text, read as first published. */
const ownKeys = (id: string): string[] => [`backlog.${id}.title`, ...EXPLAINER_PARTS.map((p) => `backlog.${id}.explainer.${p}`), `backlog.${id}.figure.alt`];
/** The strings of a finding that are read on a date: its rung notes (on the date each entry was recorded) and its since updates (on D). */
const datedKeys = (id: string): string[] => [`backlog.${id}.rung.0`, `backlog.${id}.rung.1`, `backlog.${id}.since.0`];
const allKeys = (id: string): string[] => [...ownKeys(id), ...datedKeys(id)];

/** A Tuesday world whose context and Chinese draft also hold every backlog key of each id, with a plain sentence for each. */
function backlogWorld(ids: readonly string[]): ZhWorld {
  const w = zhWorld();
  for (const id of ids) for (const key of allKeys(id)) addString(w, { key, en: "A sample sentence.", zh: "這是範例句子。" });
  return w;
}

const withRecords = (w: ZhWorld, ...records: ReturnType<typeof storedFinding>[]): ZhWorld => {
  w.stored = { findings: records, corrections: [], terms: [] };
  return w;
};

/** A stored correction on a finding's path, in force from 2026-11-20. */
const correct = (id: string, finding: string, path: string, before: string, after: string): Correction => Correction.parse({
  id, date: "2026-11-20", finding_id: finding, edition_date: null, term_id: null, type: "correction", path,
  before: l(before), after: l(after), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
});

const BIO = "bio-2026-0143";
const hypeAt = (w: ZhWorld): string[] => zhIssues(w, "ZH_HYPE").map((i) => i.path).sort();
const keysAt = (keys: readonly string[]): string[] => keys.map(KEY).sort();
const dualUse = (w: ZhWorld): ValidationIssue[] => runRules(zhInputOf(w), safetyRules).filter((i) => i.code === "DUAL_USE" || i.code === "RULE_ERROR");

// ── zhBacklogIds() ───────────────────────────────────────────────────────────────────────────────

describe("zhBacklogIds(): the findings whose own strings a context or a draft names", () => {
  it("reads each of the five shapes of a backlog key (SPEC §4.6): title, explainer part, since update, figure alt and rung note", () => {
    for (const key of [`backlog.${BIO}.title`, `backlog.${BIO}.explainer.could_lead`, `backlog.${BIO}.since.2`, `backlog.${BIO}.figure.alt`, `backlog.${BIO}.rung.1`]) {
      expect(zhBacklogIds([key]), key).toEqual([BIO]);
    }
  });

  it("lists each id once, however many keys name it, in the order of finding ids (year, then counter, then code), not as the keys come or as text sorts", () => {
    const keys = [
      "backlog.soc-2026-0001.title", "backlog.chem-2026-0002.title", "backlog.math-2025-0009.explainer.found", "backlog.bio-2026-0002.title",
      "backlog.bio-2025-0009.title", "backlog.soc-2026-0001.explainer.found", "backlog.soc-2026-0001.rung.0",
    ];
    expect(zhBacklogIds(keys)).toEqual(["bio-2025-0009", "math-2025-0009", "soc-2026-0001", "bio-2026-0002", "chem-2026-0002"]);
  });

  it("leaves out every key of another section and a key of no section: a new finding's, a returning one's, a rung change's, a report's and the brief's own", () => {
    const others = [
      `new.new-1.title`, `new.new-1.explainer.found`, `returning.${BIO}.update`, `returning.${BIO}.rung`, `rung.${BIO}`, `reports.R-0001.reason`,
      "lead.0", "ideas.0", "also.0", "deep_dive", "review.big_picture", "review.remarkable", "review.strongest_against", "corrections.0.after",
      "no.such.key", "", `backlog.${BIO}`, `backlog.${BIO}.unknown`, `backlog.${BIO}.explainer.nope`, `backlog.${BIO}.rung.x`, `terms.${BIO}.zh`,
    ];
    expect(zhBacklogIds(others)).toEqual([]);
    expect(zhBacklogIds([...others, `backlog.${BIO}.title`])).toEqual([BIO]);
  });

  it("leaves out an id that is no finding id, so each id is safe to read a record by", () => {
    const keys = [
      "backlog.new-1.title", "backlog.R-0001.title", "backlog.bio-2026-143.title", "backlog.bio-26-0143.title", "backlog.xyz-2026-0143.title",
      "backlog.BIO-2026-0143.title", "backlog.bio-2026-01430.title", "backlog.a/b.title", "backlog..title", "backlog.%2e%2e.title", `backlog.${BIO}.title`,
    ];
    expect(zhBacklogIds(keys)).toEqual([BIO]);
  });

  it("takes any iterable, gives a fresh list each time and changes nothing it is given", () => {
    const keys = deepFreeze([`backlog.${BIO}.title`, "backlog.math-2026-0007.title"]);
    expect(zhBacklogIds(keys)).toEqual(["math-2026-0007", BIO]);
    expect(zhBacklogIds(new Set(keys))).toEqual(["math-2026-0007", BIO]);
    expect(zhBacklogIds(keys.values())).toEqual(["math-2026-0007", BIO]);
    expect(zhBacklogIds(keys)).not.toBe(zhBacklogIds(keys));
    expect(zhBacklogIds([])).toEqual([]);
  });
});

// ── The views of a Chinese run ───────────────────────────────────────────────────────────────────

describe("buildZhInput(): a view for each finding a backlog key names", () => {
  const OTHER = "chem-2026-0150";

  it("holds a view for each finding the context's keys name and each the draft's keys name, as a stored finding of the role backlog, after the findings the English draft names", () => {
    const w = backlogWorld([OTHER, BIO]);
    const views = zhInputOf(w).views;
    const keys = views.findings.map((f) => f.key);
    expect(keys.slice(-2)).toEqual([BIO, OTHER]);
    for (const id of [BIO, OTHER]) {
      const view = views.find(id)!;
      expect([view.key, view.id, view.ref, view.origin, view.isNew, view.roles]).toEqual([id, id, null, "stored", false, ["backlog"]]);
    }
    expect(views.find("math-2026-0002")!.roles).not.toContain("backlog");
    expect(keys.slice(0, -2)).toEqual(keys.slice(0, -2).filter((k) => k !== BIO && k !== OTHER));
  });

  it("adds the role to a finding the English draft names too, which keeps its place and its other roles in the order of the roles", () => {
    const w = zhWorld({ review: true });
    for (const key of ["backlog.math-2026-0002.title", "backlog.phys-2026-0003.explainer.found"]) addString(w, { key, en: "A sample sentence.", zh: "這是範例句子。" });
    const plain = zhInputOf(zhWorld({ review: true })).views;
    const views = zhInputOf(w).views;
    expect(views.findings.map((f) => f.key)).toEqual(plain.findings.map((f) => f.key));
    for (const id of ["math-2026-0002", "phys-2026-0003"]) {
      expect(views.find(id)!.roles, id).toEqual([...plain.find(id)!.roles, "backlog"]);
    }
    expect(plain.find("math-2026-0002")!.roles).toEqual(["item", "returning", "remarkable", "lead", "correction"]);
    expect(views.find("bio-2026-0001")!.roles).toEqual(plain.find("bio-2026-0001")!.roles);
  });

  it("knows a finding the context lists and not one only the Chinese draft names (the keys the context lacks)", () => {
    const w = backlogWorld([BIO]);
    w.draft.strings["backlog.math-2026-0160.title"] = "這是範例句子。";
    const views = zhInputOf(w).views;
    expect(views.find(BIO)!.known).toBe(true);
    const draftOnly = views.find("math-2026-0160")!;
    expect([draftOnly.known, draftOnly.roles]).toEqual([false, ["backlog"]]);
    // A finding the context lists is in the roster even when the draft holds none of its keys (ZH_KEYS reports each key left out)
    const contextOnly = backlogWorld([BIO]);
    for (const key of allKeys(BIO)) delete contextOnly.draft.strings[key];
    const left = zhInputOf(contextOnly).views.find(BIO)!;
    expect([left.known, left.roles, left.detail]).toEqual([true, ["backlog"], "partial"]);
  });

  it("is a full view of the record where the run holds it, with the facts as published and as filed", () => {
    const w = withRecords(backlogWorld([BIO]), storedFinding(BIO, { significance: "landmark" }));
    const view = zhInputOf(w).views.find(BIO)!;
    expect([view.basis, view.detail]).toEqual(["context", "full"]);
    expect([view.published.field, view.published.significance, view.published.role]).toEqual(["biology", "landmark", "ai_solved"]);
    expect(view.latest.significance).toBe("landmark");
    expect(view.current.field).toBe("biology");
    expect(view.title?.en).toBe("A sample protein result");
    expect(view.rung_history?.map((r) => r.recorded)).toEqual(["2026-10-05", D]);
  });

  it("is a partial view that knows no fact where the run holds no record, whatever else it holds", () => {
    const view = (w: ZhWorld) => zhInputOf(w).views.find(BIO)!;
    for (const w of [backlogWorld([BIO]), withRecords(backlogWorld([BIO])), withRecords(backlogWorld([BIO]), storedFinding("bio-2026-0999"))]) {
      const v = view(w);
      expect([v.basis, v.detail, v.origin, v.known]).toEqual(["context", "partial", "stored", true]);
      expect(v.published).toEqual({ field: null, subfield: null, kind: null, significance: null, role: null, confidence: null });
      expect(v.latest).toEqual(v.published);
      expect(v.current).toEqual(v.published);
      expect([v.title, v.explainer, v.rung_history, v.since_then, v.sources]).toEqual([null, null, null, null, null]);
    }
  });

  it("files a finding by the stored corrections in force, on a partial view too", () => {
    const w = backlogWorld([BIO]);
    w.stored = { findings: [], corrections: [correct("C-0001", BIO, "field", "biology", "chemistry"), correct("C-0002", BIO, "significance", "major", "landmark")], terms: [] };
    const v = zhInputOf(w).views.find(BIO)!;
    expect([v.detail, v.published.field, v.published.significance]).toEqual(["partial", null, null]);
    expect([v.latest.field, v.latest.significance, v.current.field, v.current.significance]).toEqual(["chemistry", "landmark", "chemistry", "landmark"]);
    expect(v.filedOn("2026-11-19").field).toBeNull();
  });

  it("gives a finding of the English draft no view of its own twice, and one view for an id both languages name", () => {
    const w = zhWorld();
    addString(w, { key: "backlog.math-2026-0002.title", en: "A sample sentence.", zh: "這是範例句子。" });
    const keys = zhInputOf(w).views.findings.map((f) => f.key);
    expect(keys.filter((k) => k === "math-2026-0002")).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reads no backlog from the English draft's own run: buildViews() with no backlog, or an empty one, gives the same views and no role backlog", () => {
    const w = backlogWorld([BIO]);
    const english = w.english;
    const filing = zhInputOf(w).filing;
    const project = (backlog?: { id: string; listed: boolean }[]) =>
      buildViews({ mode: "draft", date: D, draft: english, context: null, filing, stored: null, ...(backlog === undefined ? {} : { backlog }) })
        .findings.map((f) => [f.key, f.roles, f.known, f.detail, f.published]);
    expect(project([])).toEqual(project());
    expect(project().flat(2)).not.toContain("backlog");
    expect(project([{ id: BIO, listed: false }]).map((f) => f[0])).toEqual([...project().map((f) => f[0]), BIO]);
  });

  it("does not change the drafts, the context or the records it reads", () => {
    const w = withRecords(backlogWorld([BIO]), storedFinding(BIO));
    deepFreeze(w);
    expect(() => buildZhInput(w.draft, w.english, inputsOf(w))).not.toThrow();
    expect(() => validateZh(w.draft, w.english, inputsOf(w))).not.toThrow();
  });
});

// ── ZH_HYPE ──────────────────────────────────────────────────────────────────────────────────────

describe("ZH_HYPE in the backlog: 突破 stands in a Landmark's text, and where the run cannot read the finding it is not judged", () => {
  it("R1: passes 突破 in every string of a backlog Landmark that only backlog keys name, given its record, and fails every other hype word there", () => {
    const w = withRecords(backlogWorld([BIO]), storedFinding(BIO, { significance: "landmark" }));
    for (const key of allKeys(BIO)) setZh(w, key, BREAKTHROUGH);
    expect(w.english.new_findings.map((f) => f.ref)).not.toContain(BIO);
    expect(hypeAt(w)).toEqual([]);
    for (const key of allKeys(BIO)) setZh(w, key, OTHER_HYPE);
    expect(hypeAt(w)).toEqual(keysAt(allKeys(BIO)));
  });

  it("R2: fails the same 突破 in every string of a backlog finding that is not a Landmark, with the message that says where it stands", () => {
    const w = withRecords(backlogWorld([BIO]), storedFinding(BIO, { significance: "major" }));
    for (const key of allKeys(BIO)) setZh(w, key, BREAKTHROUGH);
    expect(hypeAt(w)).toEqual(keysAt(allKeys(BIO)));
    const found = zhIssues(w, "ZH_HYPE").find((i) => i.path === KEY(`backlog.${BIO}.title`))!;
    expect(found.message).toContain('"突破" at 4');
    expect(found.message).toContain("stands only in a Landmark finding's own text");
    for (const significance of ["notable", "watch"] as const) {
      const other = withRecords(backlogWorld([BIO]), storedFinding(BIO, { significance }));
      for (const key of allKeys(BIO)) setZh(other, key, BREAKTHROUGH);
      expect(hypeAt(other), significance).toEqual(keysAt(allKeys(BIO)));
    }
  });

  it("R3: judges no 突破 in the strings of a backlog finding whose record the run lacks, since it cannot tell its significance, and judges every other hype word there", () => {
    const w = backlogWorld([BIO]);
    expect(w.stored).toBeNull();
    for (const key of allKeys(BIO)) setZh(w, key, BREAKTHROUGH);
    expect(hypeAt(w)).toEqual([]);
    for (const key of allKeys(BIO)) setZh(w, key, OTHER_HYPE);
    expect(hypeAt(w)).toEqual(keysAt(allKeys(BIO)));
    // The same where records are given for other findings but not for this one
    const other = withRecords(backlogWorld([BIO]), storedFinding("bio-2026-0999", { significance: "major" }));
    for (const key of allKeys(BIO)) setZh(other, key, BREAKTHROUGH);
    expect(hypeAt(other)).toEqual([]);
    // 突破 next to another hype word: the other word is the only hit, and the message does not explain 突破
    const mixed = backlogWorld([BIO]);
    setZh(mixed, `backlog.${BIO}.title`, "革命性的突破");
    const found = zhIssues(mixed, "ZH_HYPE");
    expect(found.map((i) => i.path)).toEqual([KEY(`backlog.${BIO}.title`)]);
    expect(found[0]!.message).toContain("uses 1 hype word:");
    expect(found[0]!.message).toContain('"革命性" at 0');
    expect(found[0]!.message).not.toContain("stands only in a Landmark");
  });

  it("R3: reads the finding's significance from the stored corrections in force when the record is missing, on the date the string is filed", () => {
    const filed = (significance: string): ZhWorld => {
      const w = backlogWorld([BIO]);
      w.stored = { findings: [], corrections: [correct("C-0001", BIO, "significance", "major", significance)], terms: [] };
      for (const key of allKeys(BIO)) setZh(w, key, BREAKTHROUGH);
      return w;
    };
    // The since update is filed on D, so the correction counts there
    expect(hypeAt(filed("landmark"))).toEqual([]);
    expect(hypeAt(filed("major"))).toEqual(keysAt([`backlog.${BIO}.since.0`]));
    // The finding's own title, explainer and figure alt are read as first published, which no correction changes, so the run cannot tell
    expect(hypeAt(filed("major"))).not.toContain(KEY(`backlog.${BIO}.title`));
    // A rung note is read on the day its entry was recorded, which only the record holds: without it the run cannot tell, though a correction is in force
    expect(hypeAt(filed("major"))).not.toContain(KEY(`backlog.${BIO}.rung.0`));
    expect(hypeAt(filed("major"))).not.toContain(KEY(`backlog.${BIO}.rung.1`));
  });

  it("R3: judges no 突破 in a rung note of a Landmark that a stored correction lowered, where the run lacks the record that dates the note, and judges it once the record is given", () => {
    const lowered = (): ZhWorld => {
      const w = backlogWorld([BIO]);
      w.stored = { findings: [], corrections: [correct("C-0001", BIO, "significance", "landmark", "major")], terms: [] };
      for (const key of datedKeys(BIO)) setZh(w, key, BREAKTHROUGH);
      return w;
    };
    // No record: the first note may have been recorded before the lowering (2026-11-20), the second on D; neither is judged, the since update is
    expect(hypeAt(lowered())).toEqual(keysAt([`backlog.${BIO}.since.0`]));
    // With the record: the first was recorded on 2026-10-05, before it, so it stands; the second was recorded on D, after it, and fails
    const w = lowered();
    w.stored = { ...w.stored!, findings: [storedFinding(BIO, { significance: "landmark" })] };
    expect(hypeAt(w)).toEqual(keysAt([`backlog.${BIO}.rung.1`, `backlog.${BIO}.since.0`]));
    // Another hype word in a rung note is judged all the same
    const other = lowered();
    setZh(other, `backlog.${BIO}.rung.0`, OTHER_HYPE);
    expect(hypeAt(other)).toEqual(keysAt([`backlog.${BIO}.rung.0`, `backlog.${BIO}.since.0`]));
  });

  it("R3: reads a record that is given as it reads a Landmark whatever the other findings are", () => {
    const w = withRecords(backlogWorld([BIO, "chem-2026-0150"]), storedFinding(BIO, { significance: "landmark" }), storedFinding("chem-2026-0150", { significance: "major" }));
    for (const key of [...allKeys(BIO), ...allKeys("chem-2026-0150")]) setZh(w, key, BREAKTHROUGH);
    expect(hypeAt(w)).toEqual(keysAt(allKeys("chem-2026-0150")));
  });

  it("reads a rung note of a backlog finding on the day its entry was recorded, from the record, and a since update on D", () => {
    const w = backlogWorld([BIO]);
    const record = storedFinding(BIO, { significance: "landmark" });
    w.stored = { findings: [record], corrections: [correct("C-0001", BIO, "significance", "landmark", "major")], terms: [] };
    for (const key of datedKeys(BIO)) setZh(w, key, BREAKTHROUGH);
    // Lowered on 2026-11-20: the first entry was recorded on 2026-10-05, before it; the second on D, after it; a since update is read on D
    expect(hypeAt(w)).toEqual(keysAt([`backlog.${BIO}.rung.1`, `backlog.${BIO}.since.0`]));
  });

  it("reads a rung note that no entry of the record's history has on D, as it reads a since update", () => {
    const w = backlogWorld([BIO]);
    addString(w, { key: `backlog.${BIO}.rung.9`, en: "A sample sentence.", zh: BREAKTHROUGH });
    w.stored = { findings: [storedFinding(BIO, { significance: "landmark" })], corrections: [correct("C-0001", BIO, "significance", "landmark", "major")], terms: [] };
    expect(w.stored.findings[0]!.rung_history).toHaveLength(2);
    expect(hypeAt(w)).toEqual([KEY(`backlog.${BIO}.rung.9`)]);
    w.stored = { ...w.stored, corrections: [] };
    expect(hypeAt(w)).toEqual([]);
  });

  it("reads the rung notes of the English draft's own returning and rung-change entries on D, by the corrections in force, whether or not the run holds the record", () => {
    // The entries are the draft's own, recorded on D: a Landmark lowered on 2026-11-20 is a Major finding there, with or without its record
    const lowered = (record: boolean): ZhWorld => {
      const w = zhWorld();
      w.english.corrections.shift(); // the Tuesday's own correction on math-2026-0002 would refile it as a Landmark on D
      for (const key of ["returning.math-2026-0002.rung", "rung.phys-2026-0003"]) setZh(w, key, BREAKTHROUGH);
      w.stored = {
        findings: record ? [storedFinding("math-2026-0002", { significance: "landmark" }), storedFinding("phys-2026-0003", { significance: "landmark" })] : [],
        corrections: [correct("C-0001", "math-2026-0002", "significance", "landmark", "major"), correct("C-0002", "phys-2026-0003", "significance", "landmark", "major")],
        terms: [],
      };
      return w;
    };
    for (const record of [true, false]) {
      expect(hypeAt(lowered(record)), `record ${record}`).toEqual(keysAt(["returning.math-2026-0002.rung", "rung.phys-2026-0003"]));
    }
  });

  it("reads a key that names no finding of the run as no finding's text, so 突破 is judged in it: a new finding or a returning one the English draft lacks, an id that is no finding id", () => {
    const keys = ["new.new-9.title", "returning.math-2026-0099.update", "backlog.not-an-id.title", "backlog.bio-2026-143.explainer.found", "backlog.new-1.title"];
    const w = zhWorld();
    for (const key of keys) w.draft.strings[key] = BREAKTHROUGH;
    // Absent from the context, each key is ZH_KEYS's as well
    expect(zhIssues(w, "ZH_KEYS").map((i) => i.path).sort()).toEqual(keysAt(keys));
    expect(hypeAt(w)).toEqual(keysAt(keys));
    expect(zhInputOf(w).views.find("math-2026-0099")).toBeNull();
    // Present in the context, so that ZH_KEYS is silent: the finding is still none of the run's, and no record can make it a Landmark's text
    const listed = zhWorld();
    for (const key of keys) addString(listed, { key, en: "A sample sentence.", zh: BREAKTHROUGH });
    listed.stored = { findings: [storedFinding("math-2026-0099", { significance: "landmark" })], corrections: [], terms: [] };
    expect(zhIssues(listed, "ZH_KEYS")).toEqual([]);
    expect(hypeAt(listed)).toEqual(keysAt(keys));
  });

  it("still judges 突破 in a string that is no finding's, a report's reason included, though a report's key holds an id", () => {
    const w = withRecords(backlogWorld([BIO]), storedFinding(BIO, { significance: "landmark" }));
    const noFinding = ["lead.0", "ideas.0", "also.0", "reports.R-0001.reason", "reports.R-0002.reason", "corrections.0.reason"];
    for (const key of noFinding) setZh(w, key, BREAKTHROUGH);
    expect(hypeAt(w)).toEqual(keysAt(noFinding));
  });

  it("reads a Chinese string that carries no context key as no finding's text, so 突破 is judged in it", () => {
    const w = zhWorld();
    const input = zhInputOf(w);
    const entry = input.inventory.entries.find((e) => e.lang === "zh" && e.kind === "prose" && e.zh !== null)!;
    const keyless = { ...entry, zh: null, finding: null, about: null, at: "extra", path: KEY("extra"), text: BREAKTHROUGH };
    const withIt = { ...input, inventory: { ...input.inventory, entries: [...input.inventory.entries, keyless] } };
    const hype = zhRules.find((r) => r.codes[0] === "ZH_HYPE")!;
    expect(runRules(withIt, [hype]).map((i) => i.path)).toEqual([KEY("extra")]);
    expect(runRules(input, [hype])).toEqual([]);
  });

  it("reads a Sunday deep dive and a Monday remarkable note by the stored record of the finding the English draft names, and passes 突破 in neither when the run lacks it", () => {
    const named = (): ZhWorld => {
      const w = zhWorld({ review: true, deepDive: true });
      w.english.deep_dive!.finding_id = "bio-2026-0001";
      w.english.review!.remarkable!.finding_id = "phys-2026-0003";
      for (const key of ["deep_dive", "review.remarkable"]) setZh(w, key, BREAKTHROUGH);
      return w;
    };
    expect(hypeAt(named())).toEqual([]);
    const major = named();
    major.stored = { findings: [storedFinding("bio-2026-0001", { significance: "major" }), storedFinding("phys-2026-0003", { significance: "major" })], corrections: [], terms: [] };
    expect(hypeAt(major)).toEqual(keysAt(["deep_dive", "review.remarkable"]));
    const landmark = named();
    landmark.stored = { findings: [storedFinding("bio-2026-0001", { significance: "landmark" }), storedFinding("phys-2026-0003", { significance: "landmark" })], corrections: [], terms: [] };
    expect(hypeAt(landmark)).toEqual([]);
    const half = named();
    half.stored = { findings: [storedFinding("bio-2026-0001", { significance: "major" })], corrections: [], terms: [] };
    expect(hypeAt(half)).toEqual([KEY("deep_dive")]);
  });
});

// ── DUAL_USE ─────────────────────────────────────────────────────────────────────────────────────

describe("DUAL_USE in the backlog: numbered steps are read in a finding of biology or chemistry, by the field of its record", () => {
  const steps = (w: ZhWorld, keys: readonly string[]): ZhWorld => {
    for (const key of keys) setZh(w, key, STEPS_ZH);
    return w;
  };

  it("R4: reads the numbered steps of a biology or a chemistry backlog finding given its record, in every string of it, and not those of another field", () => {
    for (const id of ["bio-2026-0143", "chem-2026-0150"]) {
      const w = withRecords(steps(backlogWorld([id]), allKeys(id)), storedFinding(id));
      const found = dualUse(w);
      expect(found.map((i) => i.path).sort(), id).toEqual(keysAt(allKeys(id)));
      expect(found[0]!.message, id).toContain("2 numbered steps (步驟一, 步驟二), which a biology or chemistry finding may not hold");
    }
    for (const id of ["phys-2026-0151", "math-2026-0152"]) {
      expect(dualUse(withRecords(steps(backlogWorld([id]), allKeys(id)), storedFinding(id))), id).toEqual([]);
    }
  });

  it("R4: skips the steps of a backlog finding whose record the run lacks, which it cannot tell the field of, and reports nothing else", () => {
    const w = steps(backlogWorld([BIO]), allKeys(BIO));
    expect(dualUse(w)).toEqual([]);
    expect(dualUse(withRecords(w, storedFinding("bio-2026-0999")))).toEqual([]);
    expect(dualUse(withRecords(w, storedFinding(BIO)))).toHaveLength(allKeys(BIO).length);
  });

  it("reads a backlog finding's field as the stored corrections in force file it: first published or as filed now", () => {
    const refiled = (id: string, to: string, from: string): ZhWorld => {
      const w = steps(backlogWorld([id]), [`backlog.${id}.explainer.found`]);
      w.stored = { findings: [storedFinding(id)], corrections: [correct("C-0001", id, "field", from, to)], terms: [] };
      return w;
    };
    expect(dualUse(refiled("phys-2026-0151", "chemistry", "physics")).map((i) => i.path)).toEqual([KEY("backlog.phys-2026-0151.explainer.found")]);
    expect(dualUse(refiled("bio-2026-0143", "physics", "biology")).map((i) => i.path)).toEqual([KEY(`backlog.${BIO}.explainer.found`)]);
    expect(dualUse(refiled("math-2026-0152", "earth", "mathematics"))).toEqual([]);
    // With no record the correction alone gives the field as filed now
    const w = steps(backlogWorld(["math-2026-0152"]), ["backlog.math-2026-0152.explainer.found"]);
    w.stored = { findings: [], corrections: [correct("C-0001", "math-2026-0152", "field", "mathematics", "chemistry")], terms: [] };
    expect(dualUse(w).map((i) => i.path)).toEqual([KEY("backlog.math-2026-0152.explainer.found")]);
  });

  it("reads steps in a backlog finding that the English draft names too, by the same record, as filed now", () => {
    const w = zhWorld();
    addString(w, { key: "backlog.math-2026-0002.title", en: "A sample sentence.", zh: STEPS_ZH });
    setZh(w, "returning.math-2026-0002.update", STEPS_ZH);
    w.stored = { findings: [storedFinding("math-2026-0002")], corrections: [], terms: [] };
    expect(dualUse(w)).toEqual([]);
    w.stored = { findings: [storedFinding("math-2026-0002")], corrections: [correct("C-0001", "math-2026-0002", "field", "mathematics", "chemistry")], terms: [] };
    expect(dualUse(w).map((i) => i.path).sort()).toEqual(keysAt(["backlog.math-2026-0002.title", "returning.math-2026-0002.update"]));
    w.stored = null;
    expect(dualUse(w)).toEqual([]);
  });
});

// ── What no code reports ─────────────────────────────────────────────────────────────────────────

describe("a backlog id the run cannot find at all", () => {
  it("R5: throws nothing and raises no error of any rule for a context id that no record holds, so the draft that translates it is valid", () => {
    const w = backlogWorld([BIO]);
    expect(() => zhInputOf(w)).not.toThrow();
    expect(zhRun(w)).toEqual([]);
    const result = validateZh(w.draft, w.english, inputsOf(w));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    const text = backlogWorld([BIO]);
    for (const key of allKeys(BIO)) setZh(text, key, `${BREAKTHROUGH}${STEPS_ZH}`);
    expect(validateZh(text.draft, text.english, inputsOf(text)).issues).toEqual([]);
  });

  it("R5: has ZH_KEYS alone report a backlog key that the Chinese draft holds and the context lacks, at that key, and no rule fail on its view", () => {
    const w = zhWorld();
    const key = "backlog.bio-2099-0001.title";
    w.draft.strings[key] = `${BREAKTHROUGH}${STEPS_ZH}`;
    const found = zhRun(w);
    expect(found.map((i) => `${i.code} ${i.path}`)).toEqual([`ZH_KEYS ${KEY(key)}`]);
    expect(found[0]!.message).toContain("is not a key of the context");
    const view = zhInputOf(w).views.find("bio-2099-0001")!;
    expect([view.known, view.detail, view.roles]).toEqual([false, "partial", ["backlog"]]);
    const result = validateZh(w.draft, w.english, inputsOf(w));
    expect(result.issues.map((i) => i.code)).toEqual(["ZH_KEYS"]);
    expect(result.draft).not.toBeNull();
  });

  it("R5: has ZH_KEYS alone report a backlog key the draft lacks and the context holds, and no rule fail for the finding", () => {
    const w = backlogWorld([BIO]);
    delete w.draft.strings[`backlog.${BIO}.title`];
    const result = validateZh(w.draft, w.english, inputsOf(w));
    expect(result.issues.map((i) => `${i.code} ${i.path}`)).toEqual([`ZH_KEYS ${KEY(`backlog.${BIO}.title`)}`]);
  });
});
