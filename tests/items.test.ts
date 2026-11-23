// lib/items.ts (SPEC §4.10 filedAs(), §4.5 display order, §4.4 the fields a finding's own record fixes and "a finding counts",
// §4.12 STORY_PICK, CLAIMED_CAP, NON_AI_LANDMARK_ONLY and SETBACK_MAJOR, §4.15's ledger exclusions): each of the six filing
// paths, the date, id and tie rules that pick the latest correction, everything filedAs() ignores, the no-mutation guarantee,
// the draft's own corrections as filings, and a truth table for every predicate. The findings are a real stored `Finding`
// (parsed by its schema first) and small structural objects. New for this project; none of it has a counterpart in Cyber's tests.
import { describe, expect, it } from "vitest";
import {
  breaksNonAiLandmarkOnly, breaksSetbackMajor, compareSignificance, derivedFields, displayOrder, draftFilings, exceedsClaimedCap,
  FILING_PATHS, filedAs, firstOutrankingStory, hasAiRole, isBriefable, isCounted, isFilingPath, significanceAtLeast, significanceRank,
  type Filable, type FilingCorrection,
} from "@/lib/items";
import { Finding } from "@/lib/schema/finding";
import { ALL_RUNGS, FINDING_KINDS, FIELDS, SIGNIFICANCE, AI_ROLES, type AiRole, type FindingKind, type Rung, type Significance } from "@/lib/vocab";

const text = (en: string) => ({ en, zh: `${en} 樣本` });

/** A stored finding: a biology result at Checked, Major, with a confirmed AI role. Every string is sample text. */
const STORED: Finding = {
  schema_version: 1,
  id: "bio-2026-0001",
  field: "biology",
  subfield: "proteins",
  kind: "result",
  title: text("Sample protein result"),
  depth: "item",
  explainer: {
    found: text("Sample found."), matters: text("Sample matters."), ai_helped: text("Sample AI help."),
    how_sure: text("Checked by a sample journal."), background: text("Sample background."), could_lead: text("Sample could lead."),
  },
  go_deeper: ["s2"],
  ai: {
    role: "ai_solved", confidence: "confirmed",
    systems: [{ name: "SampleModel", maker: "Sample Lab" }],
    evidence: [{ source_id: "s1", quote: "a sample quote", from_claimant: false }],
  },
  significance: "major",
  rung: "checked",
  rung_history: [
    { rung: "preprint", date: "2026-03-01", recorded: "2026-03-05", source_id: "s1", by: "agent", note: null },
    { rung: "checked", date: "2026-05-01", recorded: "2026-05-04", source_id: "s2", by: "agent", note: null },
  ],
  since_then: [],
  sources: [
    { id: "s1", kind: "preprint", title: "Sample preprint", publisher: "arXiv", url: "https://example.org/sample-1", doi: null, published_at: "2026-03-01", seen_as: "pack", added: "2026-03-05" },
    { id: "s2", kind: "paper", title: "Sample paper", publisher: "Sample Journal", url: "https://example.org/sample-2", doi: "10.1234/sample", published_at: "2026-05-01", seen_as: "fetched", added: "2026-05-04" },
  ],
  reactions: [],
  artefacts: { doi: [], arxiv: [], lean: [], trial: [], pdb: [] },
  figure: null,
  who: [{ name: "Sample Lab", ror: null }],
  terms: [],
  related: [],
  first_published: "2026-03-01",
  first_brief: "2026-03-05",
  briefs: ["2026-03-05"],
  history: false,
  disclosure: false,
  applications: [],
  updated: "2026-05-04",
};

const correction = (id: string, date: string, path: string, after: string, over: Partial<FilingCorrection> = {}): FilingCorrection => ({
  id, date, finding_id: STORED.id, type: "update", path, after: { en: after }, ...over,
});

/** Freezes a value and everything in it, so any write to it throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe("the test finding", () => {
  it("is a valid stored Finding, so filedAs() is exercised on the real shape", () => {
    expect(Finding.safeParse(STORED).success).toBe(true);
  });
});

describe("FILING_PATHS and isFilingPath", () => {
  it("are the six paths of SPEC §4.10 in its order", () => {
    expect([...FILING_PATHS]).toEqual(["significance", "field", "subfield", "kind", "ai.role", "ai.confidence"]);
  });

  it("accept those and nothing else", () => {
    for (const path of FILING_PATHS) expect(isFilingPath(path)).toBe(true);
    for (const path of ["rung", "title", "explainer.how_sure", "ai", "ai.systems", "Significance", "", "ai.role.x"]) expect(isFilingPath(path)).toBe(false);
  });
});

describe("filedAs(): each of the six paths", () => {
  const D = "2026-06-10";
  const cases: [string, string, (f: Finding) => unknown][] = [
    ["significance", "landmark", (f) => f.significance],
    ["field", "chemistry", (f) => f.field],
    ["subfield", "genomics", (f) => f.subfield],
    ["kind", "capability", (f) => f.kind],
    ["ai.role", "ai_tool", (f) => f.ai.role],
    ["ai.confidence", "claimed", (f) => f.ai.confidence],
  ];

  for (const [path, after, read] of cases) {
    it(`takes ${path} from the correction's after.en`, () => {
      const filed = filedAs(STORED, [correction("C-0001", "2026-06-01", path, after)], D);
      expect(read(filed)).toBe(after);
    });
  }

  it("changes only the filed path and leaves every other value as published", () => {
    const filed = filedAs(STORED, [correction("C-0001", "2026-06-01", "significance", "landmark")], D);
    expect(filed).toEqual({ ...STORED, significance: "landmark" });
  });

  it("changes all six at once when six corrections name them", () => {
    const six = cases.map(([path, after], i) => correction(`C-000${i + 1}`, "2026-06-01", path, after));
    const filed = filedAs(STORED, six, D);
    expect([filed.significance, filed.field, filed.subfield, filed.kind, filed.ai.role, filed.ai.confidence]).toEqual([
      "landmark", "chemistry", "genomics", "capability", "ai_tool", "claimed",
    ]);
  });

  it("returns the finding as it is when there are no corrections", () => {
    expect(filedAs(STORED, [], D)).toEqual(STORED);
  });
});

describe("filedAs(): which correction is the latest", () => {
  it("uses only corrections dated on or before the date", () => {
    const c = [correction("C-0001", "2026-06-10", "significance", "landmark")];
    expect(filedAs(STORED, c, "2026-06-09").significance).toBe("major");
    expect(filedAs(STORED, c, "2026-06-10").significance).toBe("landmark");
    expect(filedAs(STORED, c, "2026-06-11").significance).toBe("landmark");
  });

  it("takes the later date, whatever the order of the list", () => {
    const early = correction("C-0009", "2026-06-01", "significance", "notable");
    const late = correction("C-0002", "2026-06-05", "significance", "landmark");
    expect(filedAs(STORED, [early, late], "2026-06-10").significance).toBe("landmark");
    expect(filedAs(STORED, [late, early], "2026-06-10").significance).toBe("landmark");
  });

  it("takes the higher id when the dates are equal, whatever the order of the list", () => {
    const first = correction("C-0001", "2026-06-05", "significance", "notable");
    const second = correction("C-0002", "2026-06-05", "significance", "landmark");
    expect(filedAs(STORED, [first, second], "2026-06-10").significance).toBe("landmark");
    expect(filedAs(STORED, [second, first], "2026-06-10").significance).toBe("landmark");
  });

  it("takes the later of two corrections with the same date and id", () => {
    const a = correction("C-0001", "2026-06-05", "significance", "notable");
    const b = correction("C-0001", "2026-06-05", "significance", "landmark");
    expect(filedAs(STORED, [a, b], "2026-06-10").significance).toBe("landmark");
    expect(filedAs(STORED, [b, a], "2026-06-10").significance).toBe("notable");
  });

  it("reads the date before the id: a later date with a lower id still wins", () => {
    const olderHighId = correction("C-0099", "2026-06-01", "significance", "notable");
    const newerLowId = correction("C-0003", "2026-06-02", "significance", "watch");
    expect(filedAs(STORED, [olderHighId, newerLowId], "2026-06-10").significance).toBe("watch");
  });

  it("keeps each path's latest apart: a later correction at one path does not hide an earlier one at another", () => {
    const c = [
      correction("C-0001", "2026-06-01", "significance", "landmark"),
      correction("C-0002", "2026-06-02", "kind", "check"),
    ];
    const filed = filedAs(STORED, c, "2026-06-10");
    expect([filed.significance, filed.kind]).toEqual(["landmark", "check"]);
  });

  it("falls back to an earlier correction when the date excludes the later one", () => {
    const c = [correction("C-0001", "2026-06-01", "significance", "notable"), correction("C-0002", "2026-06-08", "significance", "landmark")];
    expect(filedAs(STORED, c, "2026-06-07").significance).toBe("notable");
  });
});

describe("filedAs(): what it ignores", () => {
  const D = "2026-06-10";

  it("ignores a removed correction", () => {
    const c = [correction("C-0001", "2026-06-01", "significance", "landmark", { type: "removed" })];
    expect(filedAs(STORED, c, D).significance).toBe("major");
  });

  it("applies every other type: correction, clarification and update", () => {
    for (const type of ["correction", "clarification", "update"] as const) {
      const c = [correction("C-0001", "2026-06-01", "significance", "landmark", { type })];
      expect(filedAs(STORED, c, D).significance, type).toBe("landmark");
    }
  });

  it("ignores a correction of another finding, of an edition or of a term", () => {
    const c = [
      correction("C-0001", "2026-06-01", "significance", "landmark", { finding_id: "bio-2026-0002" }),
      correction("C-0002", "2026-06-01", "significance", "landmark", { finding_id: null }),
    ];
    expect(filedAs(STORED, c, D).significance).toBe("major");
  });

  it("ignores a correction at any other path, a rung and the explainer among them", () => {
    const c = [
      correction("C-0001", "2026-06-01", "rung", "retracted"),
      correction("C-0002", "2026-06-01", "explainer.how_sure", "landmark"),
      correction("C-0003", "2026-06-01", "Significance", "landmark"),
    ];
    expect(filedAs(STORED, c, D)).toEqual(STORED);
  });

  it("ignores an after that is not an id of the path's vocabulary, and an earlier valid correction still applies", () => {
    const bad: [string, string][] = [
      ["significance", "huge"], ["significance", "Landmark"], ["field", "astronomy"], ["kind", "idea"], ["kind", ""],
      ["ai.role", "robot"], ["ai.confidence", "sure"], ["ai.confidence", "null"], ["subfield", ""],
    ];
    for (const [path, after] of bad) {
      const filed = filedAs(STORED, [correction("C-0002", "2026-06-02", path, after)], D);
      expect(filed, `${path} -> ${after}`).toEqual(STORED);
    }
    const c = [correction("C-0001", "2026-06-01", "significance", "notable"), correction("C-0002", "2026-06-02", "significance", "huge")];
    expect(filedAs(STORED, c, D).significance).toBe("notable");
  });

  it("accepts every id of each vocabulary", () => {
    for (const s of SIGNIFICANCE) expect(filedAs(STORED, [correction("C-0001", "2026-06-01", "significance", s)], D).significance).toBe(s);
    for (const f of FIELDS) expect(filedAs(STORED, [correction("C-0001", "2026-06-01", "field", f)], D).field).toBe(f);
    for (const k of FINDING_KINDS) expect(filedAs(STORED, [correction("C-0001", "2026-06-01", "kind", k)], D).kind).toBe(k);
    for (const r of AI_ROLES) expect(filedAs(STORED, [correction("C-0001", "2026-06-01", "ai.role", r)], D).ai.role).toBe(r);
  });

  it("takes any non-empty subfield, since config/fields.json holds the ids", () => {
    expect(filedAs(STORED, [correction("C-0001", "2026-06-01", "subfield", "ancient-texts")], D).subfield).toBe("ancient-texts");
    expect(filedAs(STORED, [correction("C-0001", "2026-06-01", "subfield", "x")], D).subfield).toBe("x"); // one character is text enough
  });
});

describe("filedAs(): a finding filed with no AI role", () => {
  const D = "2026-06-10";
  const none = correction("C-0001", "2026-06-01", "ai.role", "none");

  it("is filed with confidence null, and keeps its published systems, evidence and ai_helped", () => {
    const filed = filedAs(STORED, [none], D);
    expect(filed.ai.role).toBe("none");
    expect(filed.ai.confidence).toBeNull();
    expect(filed.ai.systems).toEqual(STORED.ai.systems);
    expect(filed.ai.evidence).toEqual(STORED.ai.evidence);
    expect(filed.explainer.ai_helped).toEqual(STORED.explainer.ai_helped);
  });

  it("stays null even when a correction gives the confidence", () => {
    const filed = filedAs(STORED, [none, correction("C-0002", "2026-06-02", "ai.confidence", "claimed")], D);
    expect(filed.ai.confidence).toBeNull();
  });

  it("is filed with the stored confidence again for a date before the correction", () => {
    expect(filedAs(STORED, [none], "2026-05-31").ai).toEqual(STORED.ai);
  });

  it("keeps a published confidence of null when a later correction gives an AI role", () => {
    const published = { ...STORED, ai: { ...STORED.ai, role: "none" as const, confidence: null } };
    const filed = filedAs(published, [correction("C-0001", "2026-06-01", "ai.role", "ai_tool")], D);
    expect([filed.ai.role, filed.ai.confidence]).toEqual(["ai_tool", null]);
  });

  it("takes the corrected confidence of a finding that keeps an AI role", () => {
    const filed = filedAs(STORED, [correction("C-0001", "2026-06-01", "ai.confidence", "claimed")], D);
    expect(filed.ai.confidence).toBe("claimed");
  });
});

describe("filedAs(): inputs are never changed", () => {
  it("returns a new finding and a new ai object, and leaves frozen inputs alone", () => {
    const finding = deepFreeze(structuredClone(STORED));
    const corrections = deepFreeze([correction("C-0001", "2026-06-01", "ai.role", "none"), correction("C-0002", "2026-06-01", "significance", "landmark")]);
    const filed = filedAs(finding, corrections, "2026-06-10");
    expect(filed).not.toBe(finding);
    expect(filed.ai).not.toBe(finding.ai);
    expect(finding).toEqual(STORED);
    expect(finding.significance).toBe("major");
    expect(finding.ai.role).toBe("ai_solved");
  });

  it("returns a new object even when nothing is refiled", () => {
    const filed = filedAs(STORED, [], "2026-06-10");
    expect(filed).toEqual(STORED);
    expect(filed).not.toBe(STORED);
    expect(filed.ai).not.toBe(STORED.ai);
  });

  it("keeps the extra properties of any shape that has the six values, so a context candidate files too", () => {
    const candidate = { id: "bio-2026-0001", field: "biology", subfield: "proteins", kind: "result", significance: "major", ai: { role: "ai_tool", confidence: null }, reasons: ["news"] } as const;
    const filed = filedAs(candidate, [correction("C-0001", "2026-06-01", "significance", "landmark")], "2026-06-10");
    expect(filed.reasons).toEqual(["news"]);
    expect(filed.significance).toBe("landmark");
  });
});

describe("draftFilings()", () => {
  const draft = [
    { finding_id: STORED.id, type: "update" as const, path: "significance", after: "landmark" },
    { finding_id: null, type: "correction" as const, path: "lead.0.text", after: "A new sentence." },
    { finding_id: STORED.id, type: "removed" as const, path: "explainer.found", after: "removed text" },
  ];

  it("dates every correction D, gives them ids that continue after the highest stored id and keeps the draft's order", () => {
    const out = draftFilings(draft, [{ id: "C-0004" }, { id: "C-0017" }, { id: "C-0009" }], "2026-06-10");
    expect(out).toEqual([
      { id: "C-0018", date: "2026-06-10", finding_id: STORED.id, type: "update", path: "significance", after: { en: "landmark" } },
      { id: "C-0019", date: "2026-06-10", finding_id: null, type: "correction", path: "lead.0.text", after: { en: "A new sentence." } },
      { id: "C-0020", date: "2026-06-10", finding_id: STORED.id, type: "removed", path: "explainer.found", after: { en: "removed text" } },
    ]);
  });

  it("starts at C-0001 when nothing is stored, and ignores a stored id of another form", () => {
    expect(draftFilings(draft.slice(0, 1), [], "2026-06-10")[0]!.id).toBe("C-0001");
    const others = [{ id: "R-0099" }, { id: "C-12" }, { id: "x" }, { id: "C-00050" }, { id: "XC-0099" }, { id: "c-0099" }, { id: "C-0099x" }];
    expect(draftFilings(draft.slice(0, 1), others, "2026-06-10")[0]!.id).toBe("C-0001");
  });

  it("pads the number to four digits", () => {
    expect(draftFilings(draft.slice(0, 1), [{ id: "C-0008" }], "2026-06-10")[0]!.id).toBe("C-0009");
    expect(draftFilings(draft.slice(0, 1), [{ id: "C-0099" }], "2026-06-10")[0]!.id).toBe("C-0100");
  });

  it("makes a later draft correction beat an earlier one and a stored one dated the same day", () => {
    const stored = [correction("C-0005", "2026-06-10", "significance", "notable")];
    const filings = draftFilings(
      [
        { finding_id: STORED.id, type: "update", path: "significance", after: "landmark" },
        { finding_id: STORED.id, type: "update", path: "significance", after: "watch" },
      ],
      stored,
      "2026-06-10",
    );
    expect(filedAs(STORED, [...stored, ...filings], "2026-06-10").significance).toBe("watch");
    expect(filedAs(STORED, [...stored, ...filings.slice(0, 1)], "2026-06-10").significance).toBe("landmark");
    expect(filedAs(STORED, [...stored, ...filings], "2026-06-09").significance).toBe("major");
  });

  it("changes neither the draft nor the stored list", () => {
    const frozenDraft = deepFreeze(structuredClone(draft));
    const frozenStored = deepFreeze([{ id: "C-0001" }]);
    expect(draftFilings(frozenDraft, frozenStored, "2026-06-10")).toHaveLength(3);
  });
});

describe("displayOrder()", () => {
  it("puts the story first and then the items as listed", () => {
    expect(displayOrder("story", ["a", "b", "c"])).toEqual(["story", "a", "b", "c"]);
    expect(displayOrder({ id: 1 }, [{ id: 2 }, { id: 3 }]).map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("is the items alone when there is no story, and empty when there is nothing", () => {
    expect(displayOrder(null, ["a", "b"])).toEqual(["a", "b"]);
    expect(displayOrder(null, [])).toEqual([]);
    expect(displayOrder("story", [])).toEqual(["story"]);
  });

  it("returns a new array and leaves the items alone", () => {
    const items = deepFreeze(["a", "b"]);
    const out = displayOrder(null, items);
    expect(out).not.toBe(items);
    expect(out).toEqual(["a", "b"]);
  });
});

describe("derivedFields()", () => {
  it("gives the last rung entry's rung and the first brief", () => {
    expect(derivedFields(STORED)).toEqual({ rung: "checked", first_brief: "2026-03-05" });
    expect(derivedFields({ rung_history: [{ rung: "applied" }, { rung: "disputed" }, { rung: "retracted" }], briefs: ["2026-02-01", "2026-04-01"] })).toEqual({
      rung: "retracted", first_brief: "2026-02-01",
    });
  });

  it("has a first brief of null when no edition reported the finding", () => {
    expect(derivedFields({ rung_history: [{ rung: "claimed" }], briefs: [] })).toEqual({ rung: "claimed", first_brief: null });
  });

  it("refuses an empty rung history, which no finding has", () => {
    expect(() => derivedFields({ rung_history: [], briefs: [] })).toThrow(RangeError);
  });
});

describe("significance", () => {
  it("ranks Landmark 4, Major 3, Notable 2 and Watch 1", () => {
    expect(SIGNIFICANCE.map(significanceRank)).toEqual([4, 3, 2, 1]);
  });

  it("sorts the higher significance first", () => {
    expect(["watch", "landmark", "notable", "major"].sort((a, b) => compareSignificance(a as Significance, b as Significance))).toEqual([
      "landmark", "major", "notable", "watch",
    ]);
    expect(compareSignificance("major", "major")).toBe(0);
    expect(compareSignificance("watch", "landmark")).toBe(3);
    expect(compareSignificance("landmark", "watch")).toBe(-3);
  });

  it("answers at-least for every pair", () => {
    for (const a of SIGNIFICANCE) {
      for (const b of SIGNIFICANCE) expect(significanceAtLeast(a, b), `${a} >= ${b}`).toBe(SIGNIFICANCE.indexOf(a) <= SIGNIFICANCE.indexOf(b));
    }
  });

  it("finds the first item that outranks the story (STORY_PICK), or none", () => {
    expect(firstOutrankingStory("major", ["notable", "major", "watch"])).toBeNull();
    expect(firstOutrankingStory("major", ["notable", "landmark", "major"])).toBe(1);
    expect(firstOutrankingStory("notable", ["notable", "major", "landmark"])).toBe(1);
    expect(firstOutrankingStory("notable", ["major", "watch"])).toBe(0); // the first item itself outranks the story: index 0, not none
    expect(firstOutrankingStory("watch", ["landmark"])).toBe(0);
    expect(firstOutrankingStory("landmark", [])).toBeNull();
    expect(firstOutrankingStory("watch", ["watch"])).toBeNull();
  });
});

describe("hasAiRole()", () => {
  it("is true for every role but none", () => {
    for (const role of AI_ROLES) expect(hasAiRole({ ai: { role } }), role).toBe(role !== "none");
  });
});

describe("isCounted() (SPEC §4.4 'A finding counts')", () => {
  it("counts exactly Checked, Confirmed and Applied, and never a setback", () => {
    for (const rung of ALL_RUNGS) {
      for (const kind of FINDING_KINDS) {
        const expected = ["checked", "confirmed", "applied"].includes(rung) && kind !== "setback";
        expect(isCounted({ rung, kind }), `${rung} ${kind}`).toBe(expected);
      }
    }
  });
});

describe("exceedsClaimedCap() (CLAIMED_CAP)", () => {
  it("is true only for a claimed or preprint finding above Notable", () => {
    for (const rung of ALL_RUNGS) {
      for (const significance of SIGNIFICANCE) {
        const expected = (rung === "claimed" || rung === "preprint") && (significance === "landmark" || significance === "major");
        expect(exceedsClaimedCap(rung, significance), `${rung} ${significance}`).toBe(expected);
      }
    }
  });
});

describe("NON_AI_LANDMARK_ONLY and SETBACK_MAJOR", () => {
  const filed = (kind: FindingKind, significance: Significance, role: AiRole) => ({ kind, significance, ai: { role } });

  it("breaksNonAiLandmarkOnly: no AI role below Landmark, and nothing else", () => {
    for (const significance of SIGNIFICANCE) {
      expect(breaksNonAiLandmarkOnly(filed("result", significance, "none")), significance).toBe(significance !== "landmark");
      expect(breaksNonAiLandmarkOnly(filed("result", significance, "ai_tool")), significance).toBe(false);
    }
  });

  it("breaksSetbackMajor: a setback with no AI role or below Major, and nothing that is not a setback", () => {
    for (const significance of SIGNIFICANCE) {
      for (const role of AI_ROLES) {
        const expected = role === "none" || !["landmark", "major"].includes(significance);
        expect(breaksSetbackMajor(filed("setback", significance, role)), `${significance} ${role}`).toBe(expected);
        for (const kind of FINDING_KINDS.filter((k) => k !== "setback")) expect(breaksSetbackMajor(filed(kind, significance, role))).toBe(false);
      }
    }
  });

  it("isBriefable: neither rule broken", () => {
    expect(isBriefable(filed("result", "notable", "ai_tool"))).toBe(true);
    expect(isBriefable(filed("result", "landmark", "none"))).toBe(true);
    expect(isBriefable(filed("result", "notable", "none"))).toBe(false);
    expect(isBriefable(filed("setback", "major", "ai_tool"))).toBe(true);
    expect(isBriefable(filed("setback", "landmark", "ai_ran"))).toBe(true);
    expect(isBriefable(filed("setback", "notable", "ai_tool"))).toBe(false);
    expect(isBriefable(filed("setback", "landmark", "none"))).toBe(false);
    expect(isBriefable(filed("infrastructure", "watch", "ai_tool"))).toBe(true);
  });

  it("matches the ledger candidates' exclusions of SPEC §4.15 on a refiled finding", () => {
    // A Landmark that a correction lowered to Major is still briefable; a Notable one refiled with no AI role is not;
    // a Landmark setback refiled with no AI role is not.
    const lowered = filedAs(STORED, [correction("C-0001", "2026-06-01", "significance", "major")], "2026-06-10");
    const noRole = filedAs({ ...STORED, significance: "notable" }, [correction("C-0001", "2026-06-01", "ai.role", "none")], "2026-06-10");
    const setback = filedAs(
      { ...STORED, kind: "setback", significance: "landmark" },
      [correction("C-0001", "2026-06-01", "ai.role", "none")],
      "2026-06-10",
    );
    expect([isBriefable(lowered), isBriefable(noRole), isBriefable(setback)]).toEqual([true, false, false]);
  });
});

describe("types", () => {
  it("a stored Finding fits Filable", () => {
    const f: Filable = STORED;
    const rung: Rung = STORED.rung;
    expect([f.id, rung]).toEqual(["bio-2026-0001", "checked"]);
  });
});
