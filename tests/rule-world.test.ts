// The hand-built world of the rules' tests (tests/helpers/rule-world.ts) keeps to the rules it is built for (fix pass 2, F-7 and F-10):
// every subfield it names is one of config/fields.json, every finding its draft relates to is one the contexts list, the Monday's week
// lists a setback as a setback, and the Tuesday draft passes the structure and history rules as it stands, with its one Landmark
// refiling kept in a draft of its own (`landmarkDraft()`) for the tests that need a Landmark.
// New for this project.

import { describe, expect, it } from "vitest";
import { RULE_GROUPS } from "@/lib/rules";
import { contextFindingIds } from "@/lib/rules/views";
import { validateDraft } from "@/lib/validate";
import {
  config, draftInputs, landmarkDraft, mondayContext, storedFinding, storedWorld, sundayContext, weekdayContext, weekdayDraft, type Json,
} from "./helpers/rule-world";

const fieldsOf = (): Map<string, Set<string>> => new Map(config().fields.fields.map((f) => [f.id, new Set(f.subfields.map((s) => s.id))]));
const groupRules = (group: string) => RULE_GROUPS.find((g) => g.group === group)!.rules;
const codes = (issues: readonly { code: string }[]): string[] => issues.map((i) => i.code);

describe("the subfields of the rules' world", () => {
  it("are subfields of config/fields.json, under the field each is filed in, on every new finding of the draft", () => {
    const fields = fieldsOf();
    const draft = weekdayDraft();
    expect(draft.new_findings.length).toBeGreaterThan(1);
    for (const f of draft.new_findings) expect(fields.get(f.field)?.has(f.subfield), `${f.ref}: ${f.field} / ${f.subfield}`).toBe(true);
  });

  it("are subfields of config/fields.json on every stored finding, whichever field its id names", () => {
    const fields = fieldsOf();
    for (const id of ["bio-2026-0001", "math-2026-0002", "phys-2026-0003", "chem-2026-0004"]) {
      const f = storedFinding(id);
      expect(fields.get(f.field)?.has(f.subfield), `${id}: ${f.field} / ${f.subfield}`).toBe(true);
    }
    for (const f of storedWorld().findings) expect(fields.get(f.field)?.has(f.subfield), `${f.id}: ${f.field} / ${f.subfield}`).toBe(true);
  });

  it("are subfields of config/fields.json in the config every context copies", () => {
    const fields = fieldsOf();
    for (const context of [weekdayContext(), mondayContext(), sundayContext()]) {
      expect(context.config.fields.length).toBeGreaterThan(0);
      for (const field of context.config.fields) {
        for (const s of field.subfields) expect(fields.get(field.id)?.has(s.id), `${field.id} / ${s.id}`).toBe(true);
      }
    }
  });

  it("let SUBFIELD_UNKNOWN pass the draft and the stored Tuesday as they stand", () => {
    expect(codes(validateDraft(weekdayDraft(), { ...draftInputs(), rules: groupRules("history") }).issues.filter((i) => i.code === "SUBFIELD_UNKNOWN"))).toEqual([]);
  });
});

describe("what the Tuesday draft names", () => {
  it("relates every new finding only to findings that the weekday context lists", () => {
    const listed = contextFindingIds(weekdayContext());
    const related = weekdayDraft().new_findings.flatMap((f) => f.related);
    expect(related.length).toBeGreaterThan(0);
    for (const id of related) expect(listed.has(id), id).toBe(true);
  });

  it("passes REF_UNKNOWN and STORY_PICK as it stands", () => {
    const issues = validateDraft(weekdayDraft(), { ...draftInputs(), rules: groupRules("structure") }).issues;
    expect(issues.filter((i) => i.code === "REF_UNKNOWN" || i.code === "STORY_PICK").map((i) => `${i.code} ${i.path}`)).toEqual([]);
  });

  it("files math-2026-0002 as Major, the story's own significance, so that no item outranks the story", () => {
    const first = weekdayDraft().corrections[0]!;
    expect([first.finding_id, first.path, first.after]).toEqual(["math-2026-0002", "significance", "major"]);
    expect(weekdayDraft().new_findings.find((f) => f.ref === weekdayDraft().story)!.significance).toBe("major");
  });
});

describe("landmarkDraft()", () => {
  it("is the Tuesday draft with its first correction raised to Landmark, and nothing else changed", () => {
    const plain = JSON.parse(JSON.stringify(weekdayDraft())) as Json;
    const landmark = JSON.parse(JSON.stringify(landmarkDraft())) as Json;
    expect(landmark.corrections[0]).toMatchObject({ finding_id: "math-2026-0002", path: "significance", after: "landmark", reason: "The result is a Landmark." });
    expect(plain.corrections[0]).toMatchObject({ after: "major", reason: "The result is Major." });
    plain.corrections[0].after = landmark.corrections[0].after;
    plain.corrections[0].reason = landmark.corrections[0].reason;
    expect(landmark).toEqual(plain);
  });

  it("fails STORY_PICK for the item it raises above the Major story, which is why the Tuesday draft does not hold it", () => {
    const issues = validateDraft(landmarkDraft(), { ...draftInputs(), rules: groupRules("structure") }).issues.filter((i) => i.code === "STORY_PICK");
    expect(issues.map((i) => i.path)).toEqual(["items[1]"]);
  });

  it("returns a fresh draft each time", () => {
    const a = landmarkDraft();
    a.corrections[0]!.after = "watch";
    expect(landmarkDraft().corrections[0]!.after).toBe("landmark");
    expect(weekdayDraft().corrections[0]!.after).toBe("major");
  });
});

describe("the Monday's week", () => {
  it.each([0, 1, 2, 3, 4])("lists as a setback only a finding that its entry files as one, with %i findings in the week", (n) => {
    const week = mondayContext(n).week!;
    for (const f of week.findings) {
      expect(week.setbacks.includes(f.id), `${f.id} (${f.kind})`).toBe(f.kind === "setback");
      if (f.kind === "setback") expect(f.significance, f.id).toBe("major");
    }
  });

  it("holds the setback chem-2026-0004 in a week of three, as the entry of a setback", () => {
    const week = mondayContext(3).week!;
    expect(week.setbacks).toEqual(["chem-2026-0004"]);
    expect(week.findings.find((f) => f.id === "chem-2026-0004")).toMatchObject({ kind: "setback", significance: "major" });
    expect(week.findings.filter((f) => f.kind === "setback")).toHaveLength(1);
  });

  it("still lists the setback by id in a short week whose findings do not show it, as the context may", () => {
    const week = mondayContext(2).week!;
    expect(week.findings.map((f) => f.id)).not.toContain("chem-2026-0004");
    expect(week.setbacks).toEqual(["chem-2026-0004"]);
  });
});
