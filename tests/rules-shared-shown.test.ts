// `shown()` of lib/rules/shared.ts (SPEC §4.12): a value as a message prints it. The count is of code points, so a character outside
// the Basic Multilingual Plane is one character and is never cut in two. It was written twice, in the sources rules and in the
// grounding rules, counting UTF-16 units and cutting by characters, which printed a text of 61 to 117 such characters with "..."
// added to all of it. Each group's messages are read once here, so a group that wrote its own copy again would show.
//
// New for this project.

import { describe, expect, it } from "vitest";
import { buildDraftInput, runRules } from "@/lib/rules/run";
import { shown } from "@/lib/rules/shared";
import { sourcesRules } from "@/lib/rules/sources";
import { DraftBrief } from "@/lib/schema/draft";
import { draftInputs, weekdayDraft, type Json } from "./helpers/rule-world";

const SMILE = String.fromCodePoint(0x1f600);
const CAT = String.fromCodePoint(0x1f431);

/** A lone half of a surrogate pair, which a cut in the middle of a character leaves at the end of the text. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("shown(): a value as a message prints it", () => {
  it("prints a text of up to 120 characters whole", () => {
    expect(shown("")).toBe("");
    expect(shown("short")).toBe("short");
    expect(shown("x".repeat(119))).toBe("x".repeat(119));
    expect(shown("x".repeat(120))).toBe("x".repeat(120));
  });

  it("cuts a text of 121 characters or more to its first 117 and three dots", () => {
    expect(shown("x".repeat(121))).toBe(`${"x".repeat(117)}...`);
    expect(shown(`${"a".repeat(117)}bcde`)).toBe(`${"a".repeat(117)}...`);
    expect(shown("x".repeat(5_000))).toBe(`${"x".repeat(117)}...`);
  });

  it("cuts at the 117th character, not before it and not after it", () => {
    const text = Array.from({ length: 130 }, (_, i) => String.fromCharCode(0x41 + (i % 26))).join("");
    expect(shown(text)).toBe(`${text.slice(0, 117)}...`);
    expect(shown(text)).toHaveLength(120);
  });

  it("counts a character outside the Basic Multilingual Plane as one: 61 to 120 of them are printed whole", () => {
    for (const n of [1, 60, 61, 100, 117, 118, 119, 120]) {
      expect(shown(SMILE.repeat(n))).toBe(SMILE.repeat(n));
    }
  });

  it("cuts 121 of them to 117 and three dots, which is 117 whole characters", () => {
    expect(shown(SMILE.repeat(121))).toBe(`${SMILE.repeat(117)}...`);
    expect(shown(SMILE.repeat(121))).toHaveLength(117 * 2 + 3);
    expect(shown(SMILE.repeat(5_000))).toBe(`${SMILE.repeat(117)}...`);
  });

  it("counts a mixed text by its code points", () => {
    expect(shown(`${"a".repeat(100)}${SMILE.repeat(20)}`)).toBe(`${"a".repeat(100)}${SMILE.repeat(20)}`);
    expect(shown(`${"a".repeat(100)}${SMILE.repeat(21)}`)).toBe(`${"a".repeat(100)}${SMILE.repeat(17)}...`);
    expect(shown(`${SMILE.repeat(60)}${"a".repeat(60)}`)).toBe(`${SMILE.repeat(60)}${"a".repeat(60)}`);
    expect(shown(`${SMILE.repeat(60)}${"a".repeat(61)}`)).toBe(`${SMILE.repeat(60)}${"a".repeat(57)}...`);
  });

  it("never leaves half of a surrogate pair at the end, wherever the cut falls", () => {
    for (let plain = 110; plain <= 120; plain++) {
      for (const astral of [1, 2, 3, 6, 11]) {
        const out = shown(`${"a".repeat(plain)}${SMILE.repeat(astral)}${CAT.repeat(5)}`);
        expect(LONE_SURROGATE.test(out), `${plain} plain, ${astral} astral`).toBe(false);
        expect(Array.from(out).length).toBeLessThanOrEqual(120);
      }
    }
    expect(shown(`${"a".repeat(116)}${SMILE.repeat(5)}`)).toBe(`${"a".repeat(116)}${SMILE}...`);
  });

  it("reads only the head of a very long text: 5 MB of one character, of astral characters or of Han characters give the same short result at once", () => {
    const start = performance.now();
    expect(shown("k".repeat(5_000_000))).toBe(`${"k".repeat(117)}...`);
    expect(shown(SMILE.repeat(2_500_000))).toBe(`${SMILE.repeat(117)}...`);
    expect(shown("\u7bc4".repeat(5_000_000))).toBe(`${"\u7bc4".repeat(117)}...`);
    expect(performance.now() - start).toBeLessThan(250);
  });

  it("gives what reading the whole text gives, around the head's limit of 241 UTF-16 units and for every mix of plain and astral characters", () => {
    /** The definition: the whole text read as characters. */
    const whole = (text: string): string => {
      const characters = Array.from(text);
      return characters.length <= 120 ? text : `${characters.slice(0, 117).join("")}...`;
    };
    let checked = 0;
    for (let plain = 0; plain <= 125; plain += 1) {
      for (const astral of [0, 1, 2, 60, 61, 62, 119, 120, 121, 122, 123]) {
        for (const tail of ["", "b", SMILE]) {
          const text = `${"a".repeat(plain)}${SMILE.repeat(astral)}${tail}`;
          expect(shown(text), `${plain} plain, ${astral} astral, tail ${tail.length}`).toBe(whole(text));
          checked++;
        }
      }
    }
    expect(checked).toBe(126 * 11 * 3);
    for (const units of [239, 240, 241, 242, 243]) {
      const text = `${"a".repeat(units - 120)}${SMILE.repeat(60)}`;
      expect(text).toHaveLength(units);
      expect(shown(text)).toBe(whole(text));
    }
  });

  it("leaves every character before the cut as it was", () => {
    const text = `${"é".repeat(60)}${"漢".repeat(40)}${SMILE.repeat(40)}`;
    expect(shown(text)).toBe(`${"é".repeat(60)}${"漢".repeat(40)}${SMILE.repeat(17)}...`);
  });
});

describe("the groups print their values through it", () => {
  /** The message of the SOURCE_URL failure for the first source of the first new finding when its address is `ftp://example.org/` and `path`. */
  function sourceUrlMessage(path: string): string {
    const draft = structuredClone(weekdayDraft()) as Json;
    draft.new_findings[0].sources[0].url = `ftp://example.org/${path}`;
    const rule = sourcesRules.find((r) => r.codes[0] === "SOURCE_URL")!;
    const issues = runRules(buildDraftInput(DraftBrief.parse(draft), draftInputs()), [rule]);
    const message = issues.find((i) => i.code === "SOURCE_URL" && i.path.startsWith("new_findings[0].sources[0]"))?.message;
    expect(message, "a SOURCE_URL issue on new_findings[0].sources[0]").toBeDefined();
    return message!;
  }

  it("the sources rules print a long address of 61 to 117 outside-the-plane characters whole", () => {
    expect(sourceUrlMessage(SMILE.repeat(100))).toContain(`Found: ftp://example.org/${SMILE.repeat(100)}`);
    expect(sourceUrlMessage(SMILE.repeat(100))).not.toContain("...");
  });

  it("the sources rules cut an address of 121 or more characters after its first 117", () => {
    expect(sourceUrlMessage(SMILE.repeat(140))).toContain(`Found: ftp://example.org/${SMILE.repeat(117 - "ftp://example.org/".length)}...`);
  });
});
