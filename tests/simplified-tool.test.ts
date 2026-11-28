// fixtures/src/tools/simplified.ts: the pure parts that build `simplified_only` (SPEC §4.11) and the
// two 50-character lists it is checked against. The real build needs Unihan and the Ministry list, which
// no test downloads; the committed list is checked in tests/config.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOE_PACKAGE,
  MUST_HOLD,
  MUST_NOT_HOLD,
  TAIWAN_EXTRA,
  buildSimplifiedOnly,
  checkLists,
  main,
  parseMoeCommon,
  parseUnihanVariants,
  writeSimplified,
} from "../fixtures/src/tools/simplified";

const cp = (c: string) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");

/** A small Unihan_Variants.txt: a header, kTraditionalVariant lines (one with the character itself, one with an
 * annotation, one in an extension block) and lines of other fields that must be ignored. */
const SAMPLE = [
  "# Unihan_Variants.txt",
  "# Date: 2026-01-01 00:00:00 GMT [XX]",
  "# Sample, not the real file",
  "",
  `${cp("个")}\tkTraditionalVariant\t${cp("個")} ${cp("个")}`,
  `${cp("们")}\tkTraditionalVariant\t${cp("們")}`,
  `${cp("台")}\tkTraditionalVariant\t${cp("臺")} ${cp("颱")}`,
  `${cp("胜")}\tkTraditionalVariant\t${cp("勝")}`,
  `${cp("发")}\tkTraditionalVariant\t${cp("發")}<kXYZ ${cp("髮")}`,
  `U+2A6A5\tkTraditionalVariant\t${cp("們")}`,
  `${cp("們")}\tkSimplifiedVariant\t${cp("们")}`,
  `${cp("臺")}\tkSimplifiedVariant\t${cp("台")}`,
  `${cp("錶")}\tkSemanticVariant\t${cp("表")}`,
].join("\n");

describe("parseUnihanVariants", () => {
  const v = parseUnihanVariants(SAMPLE);
  it("reads only the kTraditionalVariant lines, in code points", () => {
    expect([...v.traditional.keys()].map((c) => String.fromCodePoint(c))).toEqual(["个", "们", "台", "胜", "发", "\u{2A6A5}"]);
    expect(v.traditional.get("个".codePointAt(0)!)).toEqual([0x500b, 0x4e2a]);
    expect(v.traditional.get("发".codePointAt(0)!)).toEqual([0x767c, 0x9aee]);
  });
  it("keeps the leading comment block as the header", () => {
    expect(v.header).toEqual(["# Unihan_Variants.txt", "# Date: 2026-01-01 00:00:00 GMT [XX]", "# Sample, not the real file"]);
  });
  it("rejects a malformed code point", () => {
    expect(() => parseUnihanVariants("U+4E2A\tkTraditionalVariant\tnot-a-code")).toThrow(/not a Unihan code point/);
  });
});

describe("buildSimplifiedOnly", () => {
  const variants = parseUnihanVariants(SAMPLE);
  it("keeps a character whose own variant list names itself (个), and drops the Ministry's (台) and the extras (胜)", () => {
    const built = buildSimplifiedOnly({ variants, common: ["台", "們"], extra: ["胜"] });
    expect([...built.chars]).toEqual(["个", "们", "发", "\u{2A6A5}"]);
    expect(built.count).toBe(4);
  });
  it("sorts by code point and counts the extension blocks", () => {
    const built = buildSimplifiedOnly({ variants, common: [], extra: [] });
    expect([...built.chars].map((c) => c.codePointAt(0)!)).toEqual([...[...built.chars].map((c) => c.codePointAt(0)!)].sort((a, b) => a - b));
    expect(built.extension).toBe(1);
  });
  it("refuses an entry that is not one character", () => {
    expect(() => buildSimplifiedOnly({ variants, common: ["ab"], extra: [] })).toThrow(/not one character/);
    expect(() => buildSimplifiedOnly({ variants, common: [], extra: [""] })).toThrow(/not one character/);
  });
});

describe("the two checking lists", () => {
  it("hold 50 distinct characters each, with none in both", () => {
    expect(MUST_HOLD).toHaveLength(50);
    expect(MUST_NOT_HOLD).toHaveLength(50);
    expect(new Set(MUST_HOLD).size).toBe(50);
    expect(new Set(MUST_NOT_HOLD).size).toBe(50);
    expect(MUST_HOLD.filter((c) => MUST_NOT_HOLD.includes(c))).toEqual([]);
  });
  it("name the characters SPEC §10 P1 and §4.11 give", () => {
    for (const c of [..."个这体极们说为发现学问题简"]) expect(MUST_HOLD).toContain(c);
    for (const c of [..."台后里面干系只准制才了胜"]) expect(MUST_NOT_HOLD).toContain(c);
  });
  it("include every TAIWAN_EXTRA character among those Taiwan writes", () => {
    expect([...TAIWAN_EXTRA]).toEqual(["胜", "筑", "坂", "涂", "芸"]);
    for (const c of TAIWAN_EXTRA) expect(MUST_NOT_HOLD).toContain(c);
  });
  it("checkLists reports a missing and a wrongly held character, and passes a right list", () => {
    expect(checkLists(MUST_HOLD.join(""))).toEqual([]);
    expect(checkLists(MUST_HOLD.slice(1).join(""))).toEqual(["missing 个 (U+4E2A)"]);
    expect(checkLists(MUST_HOLD.join("") + "台")).toEqual(["holds 台 (U+53F0), which Taiwan writes"]);
  });
});

describe("parseMoeCommon", () => {
  const chars = Array.from({ length: MOE_PACKAGE.count }, (_, i) => String.fromCodePoint(0x4e00 + i));
  it("accepts 4,808 distinct single characters", () => {
    expect(parseMoeCommon(JSON.stringify(chars))).toHaveLength(MOE_PACKAGE.count);
  });
  it("rejects a file of another size, a duplicate, a multi-character entry and a non-array", () => {
    expect(() => parseMoeCommon(JSON.stringify(chars.slice(1)))).toThrow(/not 4808/);
    expect(() => parseMoeCommon(JSON.stringify([...chars.slice(1), chars[1]]))).toThrow(/not 4808/);
    expect(() => parseMoeCommon(JSON.stringify([...chars.slice(1), "ab"]))).toThrow(/not one character/);
    expect(() => parseMoeCommon(JSON.stringify({ a: 1 }))).toThrow(/not an array of strings/);
  });
});

describe("writeSimplified and main", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ut-simplified-"));
  const moe = path.join(tmp, "common.json");
  const unihan = path.join(tmp, "Unihan_Variants.txt");
  // A 4,808-character stand-in for the Ministry list that holds 台 and 胜's neighbour, plus every must-not character.
  const filler = Array.from({ length: MOE_PACKAGE.count }, (_, i) => String.fromCodePoint(0x3400 + i));
  fs.writeFileSync(moe, JSON.stringify(filler));
  fs.writeFileSync(unihan, SAMPLE);

  it("creates the file with version 1, then replaces only simplified_only and keeps the other keys", () => {
    const file = path.join(tmp, "terms.json");
    writeSimplified(file, "个们");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1, simplified_only: "个们" });
    fs.writeFileSync(file, JSON.stringify({ version: 1, fixed: [], simplified_only: "x", japanese_only: "広" }));
    writeSimplified(file, "个们发");
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")))).toEqual(["version", "fixed", "simplified_only", "japanese_only"]);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).simplified_only).toBe("个们发");
  });

  it("main reports the lists' problems with exit 1, writes the file anyway, and --check sees the same list", async () => {
    const file = path.join(tmp, "out.json");
    const lines: string[] = [];
    expect(await main(["--unihan", unihan, "--moe", moe, "--write", file], (l) => lines.push(l))).toBe(1);
    expect(lines.join("\n")).toMatch(/simplified_only: 5 characters, 1 of them in the extension blocks/);
    expect(lines.join("\n")).toMatch(/missing 这/);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).simplified_only).toBe(buildSimplifiedOnly({ variants: parseUnihanVariants(SAMPLE), common: filler, extra: [...TAIWAN_EXTRA] }).chars);
    const again: string[] = [];
    await main(["--unihan", unihan, "--moe", moe, "--check", file], (l) => again.push(l));
    expect(again.join("\n")).toMatch(/holds exactly this list/);
  });

  it("--check exits 1 and says what differs", async () => {
    const file = path.join(tmp, "stale.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, simplified_only: "个" }));
    const lines: string[] = [];
    expect(await main(["--unihan", unihan, "--moe", moe, "--check", file], (l) => lines.push(l))).toBe(1);
    expect(lines.join("\n")).toMatch(/differs: 4 in the rebuilt list only, 0 in the file only/);
  });

  it("rejects bad options", async () => {
    await expect(main(["--fetch", "--unihan", "x"])).rejects.toThrow(/give --fetch, or --unihan with --moe/);
    await expect(main(["--unihan", "x"])).rejects.toThrow(/go together/);
    await expect(main(["--fetch", "--write", "a", "--check", "b"])).rejects.toThrow(/exclude each other/);
    await expect(main(["--nope"])).rejects.toThrow(/unknown option/);
  });
});
