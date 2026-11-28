// lib/sources.ts (SPEC §3 `lib/sources.ts`, §4.12 GO_DEEPER, §5.8's script-added sources, §7's Go deeper line): the
// kinds a finding may point a reader to, a source's `title` and `publisher` from outside text, and the line Go
// deeper prints. Cyber's tier and publisher lookup is not carried over, so nothing here is adapted from its tests.
// Dashes are built with String.fromCodePoint, so no dash character stands in this file.
import { describe, expect, it } from "vitest";
import { DraftSource } from "@/lib/schema/common";
import {
  GO_DEEPER_KINDS, goDeeperKinds, SETBACK_GO_DEEPER_KINDS, SOURCE_PUBLISHER_MAX, SOURCE_TITLE_MAX, sourceLine, sourcePublisher, sourceTitle,
} from "@/lib/sources";
import { FINDING_KINDS, SOURCE_KINDS, type SourceKind } from "@/lib/vocab";

const cp = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

describe("GO_DEEPER_KINDS, SETBACK_GO_DEEPER_KINDS and goDeeperKinds (SPEC §4.12 GO_DEEPER)", () => {
  it("GO_DEEPER_KINDS is paper, preprint, proof, dataset, registry, checker, statement and lab_post, in the rule's order", () => {
    expect(GO_DEEPER_KINDS).toEqual(["paper", "preprint", "proof", "dataset", "registry", "checker", "statement", "lab_post"]);
  });

  it("holds only source kinds, each once", () => {
    for (const kind of SETBACK_GO_DEEPER_KINDS) expect(SOURCE_KINDS, kind).toContain(kind);
    expect(new Set(SETBACK_GO_DEEPER_KINDS).size).toBe(SETBACK_GO_DEEPER_KINDS.length);
  });

  it("SETBACK_GO_DEEPER_KINDS adds the notice, and a reaction is the one kind neither list may point to", () => {
    expect(SETBACK_GO_DEEPER_KINDS).toEqual([...GO_DEEPER_KINDS, "notice"]);
    expect(SOURCE_KINDS.filter((kind) => !SETBACK_GO_DEEPER_KINDS.includes(kind))).toEqual(["reaction"]);
    expect(GO_DEEPER_KINDS).not.toContain("notice");
  });

  it("goDeeperKinds gives a setback the list with the notice and every other finding kind the plain list", () => {
    expect(FINDING_KINDS).toContain("setback");
    for (const kind of FINDING_KINDS) {
      expect(goDeeperKinds(kind), kind).toEqual(kind === "setback" ? SETBACK_GO_DEEPER_KINDS : GO_DEEPER_KINDS);
    }
    expect(goDeeperKinds("setback")).toContain("notice");
    expect(goDeeperKinds("result")).not.toContain("notice");
  });
});

describe("sourceTitle (SPEC §5.8: a Crossref record's first title, sanitised and cut to 200)", () => {
  it("is 200 characters at most, the Source schema's bound", () => {
    expect(SOURCE_TITLE_MAX).toBe(200);
    expect(DraftSource.shape.title.safeParse("x".repeat(SOURCE_TITLE_MAX)).success).toBe(true);
    expect(DraftSource.shape.title.safeParse("x".repeat(SOURCE_TITLE_MAX + 1)).success).toBe(false);
  });

  it("strips markup, decodes entities and collapses whitespace, so a title's own tags and line breaks leave plain text", () => {
    expect(sourceTitle("  Folding <i>in vivo</i>:\n a  survey &amp; review  ")).toBe("Folding in vivo: a survey & review");
    expect(sourceTitle("Superconductivity in H<sub>3</sub>S &amp; <i>related</i> hydrides")).toBe("Superconductivity in H3S & related hydrides");
  });

  it("removes invisible characters and replaces a URL with [link]", () => {
    expect(sourceTitle(`A${cp(0x200b)}B`)).toBe("AB");
    expect(sourceTitle("Data at https://example.org/data")).toBe("Data at [link]");
  });

  it("keeps a title in any language as it is", () => {
    expect(sourceTitle("蛋白質摺疊的新方法")).toBe("蛋白質摺疊的新方法");
    expect(sourceTitle("Über die Faltung von Proteinen")).toBe("Über die Faltung von Proteinen");
  });

  it("keeps 200 characters whole and cuts 201 to 199 and an ellipsis", () => {
    expect(sourceTitle("x".repeat(200))).toBe("x".repeat(200));
    expect(sourceTitle("x".repeat(201))).toBe(`${"x".repeat(199)}…`);
    const long = sourceTitle("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(SOURCE_TITLE_MAX);
    expect(long.endsWith("word…")).toBe(true);
  });

  it("returns the empty string for text that sanitises to nothing, which the caller must not store (a title has a minimum of one)", () => {
    expect(sourceTitle("")).toBe("");
    expect(sourceTitle(`<!-- note -->${cp(0x200b)}`)).toBe("");
    expect(DraftSource.shape.title.safeParse(sourceTitle("")).success).toBe(false);
  });

  it("gives text the Source schema accepts", () => {
    for (const raw of ["Short", "word ".repeat(100), "<b>Marked up</b> &amp; long ".repeat(30), "蛋".repeat(300)]) {
      expect(DraftSource.shape.title.safeParse(sourceTitle(raw)).success, raw.slice(0, 20)).toBe(true);
    }
  });
});

describe("sourcePublisher (SPEC §5.8: a journal or a publisher's name, sanitised, cut to 80, dashes made hyphens)", () => {
  /** Each is in \p{Pd} (Dash_Punctuation): the en and em dashes, the wave dash, the full-width hyphen-minus and others. */
  const DASHES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2e3a, 0x2e3b, 0x301c, 0x30a0, 0xfe58, 0xfe63, 0xff0d, 0x058a, 0x05be, 0x1806, 0x2e17, 0x10ead];

  it("is 80 characters at most, the Source schema's bound", () => {
    expect(SOURCE_PUBLISHER_MAX).toBe(80);
    expect(DraftSource.shape.publisher.safeParse("x".repeat(SOURCE_PUBLISHER_MAX)).success).toBe(true);
    expect(DraftSource.shape.publisher.safeParse("x".repeat(SOURCE_PUBLISHER_MAX + 1)).success).toBe(false);
  });

  it("leaves a name as written when it holds no dash and no markup", () => {
    for (const name of ["Nature", "arXiv", "ClinicalTrials.gov", "Springer Science and Business Media LLC", "Proceedings of the National Academy of Sciences", "Cell-Reports"]) {
      expect(sourcePublisher(name), name).toBe(name);
    }
  });

  it("makes every dash a hyphen-minus: the en and em dashes, the wave dash, the full-width hyphen and the rest", () => {
    for (const dash of DASHES) expect(sourcePublisher(`Wiley${cp(dash)}Blackwell`), `U+${dash.toString(16)}`).toBe("Wiley-Blackwell");
    expect(sourcePublisher(`Annals of the New York Academy of Sciences ${cp(0x2013)} Special`)).toBe("Annals of the New York Academy of Sciences - Special");
  });

  it("is a name without a dash character other than the hyphen-minus", () => {
    const messy = `A${cp(0x2013)}B${cp(0x2014)}C${cp(0x301c)}D${cp(0xff0d)}E-F`;
    expect(sourcePublisher(messy)).toBe("A-B-C-D-E-F");
    expect(sourcePublisher(messy).replace(/-/g, "")).toBe("ABCDEF");
  });

  it("leaves the minus sign, a math symbol and no dash, as it is", () => {
    expect(sourcePublisher(`A${cp(0x2212)}B`)).toBe(`A${cp(0x2212)}B`);
  });

  it("strips markup and decodes entities", () => {
    expect(sourcePublisher("<b>Nature</b>")).toBe("Nature");
    expect(sourcePublisher("Wiley &amp; Sons")).toBe("Wiley & Sons");
    expect(sourcePublisher("  Springer\n Nature  ")).toBe("Springer Nature");
  });

  it("keeps 80 characters whole and cuts 81 to 79 and an ellipsis, which the dash step leaves alone", () => {
    expect(sourcePublisher("A".repeat(80))).toBe("A".repeat(80));
    expect(sourcePublisher("A".repeat(81))).toBe(`${"A".repeat(79)}…`);
    expect(sourcePublisher("A".repeat(300)).endsWith("…")).toBe(true);
  });

  it("returns the empty string for text that sanitises to nothing, which the caller must not store (a publisher has a minimum of one)", () => {
    expect(sourcePublisher("   ")).toBe("");
    expect(DraftSource.shape.publisher.safeParse(sourcePublisher("   ")).success).toBe(false);
  });

  it("gives text the Source schema accepts", () => {
    for (const raw of ["Nature", `Wiley ${cp(0x2013)} Blackwell`, "B".repeat(200), `${"Journal of Things ".repeat(10)}${cp(0x2014)}`]) {
      expect(DraftSource.shape.publisher.safeParse(sourcePublisher(raw)).success, raw.slice(0, 20)).toBe(true);
    }
  });
});

describe("sourceLine (SPEC §7: a source's kind and publisher as Go deeper prints them)", () => {
  /** Each kind in the order of SOURCE_KINDS: a publisher, the English line and the Chinese line (a full-width comma). */
  const LINES: readonly (readonly [SourceKind, string, string, string])[] = [
    ["paper", "Nature", "Paper, Nature", "論文，Nature"],
    ["preprint", "arXiv", "Preprint, arXiv", "預印本，arXiv"],
    ["proof", "Lean mathlib", "Proof, Lean mathlib", "形式證明，Lean mathlib"],
    ["dataset", "Zenodo", "Dataset, Zenodo", "資料集，Zenodo"],
    ["registry", "ClinicalTrials.gov", "Registry entry, ClinicalTrials.gov", "登錄紀錄，ClinicalTrials.gov"],
    ["statement", "Royal Swedish Academy of Sciences", "Statement, Royal Swedish Academy of Sciences", "官方聲明，Royal Swedish Academy of Sciences"],
    ["lab_post", "Example Lab", "Lab post, Example Lab", "實驗室文章，Example Lab"],
    ["checker", "Retraction Watch", "Checker's record, Retraction Watch", "查核紀錄，Retraction Watch"],
    ["reaction", "Example University", "Reaction, Example University", "學者回應，Example University"],
    ["notice", "Example Journal", "Notice, Example Journal", "撤稿、更正或關注聲明，Example Journal"],
  ];

  it("covers every source kind, in the vocabulary's order", () => {
    expect(LINES.map(([kind]) => kind)).toEqual([...SOURCE_KINDS]);
  });

  it("prints the kind's label, a comma and the publisher, in English", () => {
    for (const [kind, publisher, en] of LINES) expect(sourceLine(kind, publisher, "en"), kind).toBe(en);
  });

  it("prints the kind's Chinese label, a full-width comma and the publisher, in Chinese", () => {
    for (const [kind, publisher, , zh] of LINES) expect(sourceLine(kind, publisher, "zh"), kind).toBe(zh);
  });

  it("leaves the publisher as it was written, whatever its script", () => {
    expect(sourceLine("paper", "自然", "zh")).toBe("論文，自然");
    expect(sourceLine("paper", "Annals - Special", "en")).toBe("Paper, Annals - Special");
  });
});
