// Four checks on the words of the sample world (fix pass 2): F-28 the invented setbacks name no real organisation, F-47 the sample Monday
// big picture does not contradict itself, F-51 the sample's first correction fits the budget of the text it corrects, and F-29 the
// archive index lists a URL's refs in compareFindingIds() order. Each reads the builder's own text in memory (`allOutputs()`,
// `siteOutputs()`, and the drafts of the F, S and T cases that no file holds), never the generated files, so none of them depends on
// `npm run fixtures:gen` having run.
// New for this project.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareFindingIds } from "@/lib/ids";
import { countWords, splitSentences } from "@/lib/text";
import { validateAll } from "@/lib/validate";
import { INVALID_CASES, NAMED_CASES, SOFT_CASES, ZH_INVALID_CASES, allOutputs, invalidDraft, softDraft, zhInvalidDraft } from "../fixtures/src/build";
import { editionDraft, mondayDraft } from "../fixtures/src/drafts";
import { fixtureConfig } from "../fixtures/src/inputs";
import type { DraftBrief } from "@/lib/schema/draft";
import { siteOutputs } from "../fixtures/src/site";
import { FINDING_KEYS, FINDING_SPECS, SOURCE_TABLE, WEEKDAY_CORRECTIONS, storedFinding, storedWeekdayCorrections, type EditionName } from "../fixtures/src/world";
import { zhText } from "../fixtures/src/world-zh";

const config = fixtureConfig();
const SITE = "fixtures/site-content/";

/** Every string a value holds, at any depth. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsOf);
  return [];
}

// ── F-28: no invented negative event names a real publisher or journal ───────────────────────────

describe("the invented setbacks, retractions and disputes of the sample world", () => {
  /** A finding is a negative event when it is a setback, or its rung history holds a retraction or a dispute. */
  const NEGATIVE = FINDING_KEYS.filter((k) => {
    const spec = FINDING_SPECS[k];
    return spec.kind === "setback" || spec.rung_history.some((r) => r.rung === "retracted" || r.rung === "disputed");
  });
  /** The organisations the world once named in them: a publisher, a journal and a society, as they write their names. */
  const REAL_NAMES = /Springer|eLife|Physical Review|American Physical Society|Elsevier|Wiley|PLOS|Nature Portfolio|Lancet|NEJM/u;
  /** Hosts that belong to one organisation or one journal: a page there would read as that organisation's own word. */
  const OWN_SITES = [
    "group.springernature.com", "elifesciences.org", "www.elifesciences.org", "journals.aps.org", "www.nature.com", "www.science.org", "www.cell.com",
    "www.pnas.org",
  ];

  it("are the four the sample was written around: two setbacks, a retraction and a dispute", () => {
    expect(NEGATIVE).toEqual(expect.arrayContaining(["retractW0", "retractWD", "fellW0", "disputedOld"]));
  });

  it.each(NEGATIVE.map((k) => [k] as const))("%s: no string of the finding, of its sources or of their pages names a real publisher", (key) => {
    const finding = storedFinding(key);
    const pages = finding.sources.flatMap((s) => {
      const entry = Object.values(SOURCE_TABLE).find((t) => t.url === s.url);
      return entry === undefined ? [] : stringsOf(entry.text);
    });
    const hits = [...stringsOf({ ...finding, sources: finding.sources.map((s) => [s.title, s.publisher]) }), ...pages].filter((s) => REAL_NAMES.test(s));
    expect(hits).toEqual([]);
  });

  it.each(NEGATIVE.map((k) => [k] as const))("%s: no source is by a leading journal of the config, and none is on one organisation's own site", (key) => {
    const finding = storedFinding(key);
    const leading = new Set(config.journals.journals.map((j) => j.name));
    expect(finding.sources.filter((s) => leading.has(s.publisher)).map((s) => s.publisher)).toEqual([]);
    expect(finding.sources.filter((s) => OWN_SITES.includes(new URL(s.url).host)).map((s) => s.url)).toEqual([]);
  });

  /** The three organisations the invented events once named, by name and by their own hosts (a landing in the evidence is a host too). */
  const FORMER_ACTORS = /Springer Nature|eLife|Physical Review Letters|elifesciences\.org|journals\.aps\.org|group\.springernature\.com/u;

  it("never reach the written fixtures under a real name or on a real publisher's own site: no draft, input, stored record or sample page names Springer Nature, eLife or Physical Review Letters", () => {
    // The context files and the injection context carry a copy of the config, whose lists of journals and newsroom paths do name them.
    const configCopies = (p: string): boolean => p.startsWith("fixtures/context/") || p === "fixtures/injection/context.json";
    const outputs = allOutputs().filter((o) => !configCopies(o.path));
    expect(outputs.length).toBeGreaterThan(100);
    expect(outputs.filter((o) => FORMER_ACTORS.test(o.text)).map((o) => o.path)).toEqual([]);
  });

  it("never reach a draft of any F, S or T case, in either language, which the written fixtures leave out when no file holds the case", () => {
    const mutated = (edition: EditionName | undefined, mutate: (d: DraftBrief) => unknown): unknown => {
      const draft = editionDraft(edition ?? "weekday");
      const out = mutate(draft);
      return out === undefined ? draft : out;
    };
    const drafts = [
      ...INVALID_CASES.map(invalidDraft), ...SOFT_CASES.map(softDraft), ...NAMED_CASES.map((c) => mutated(c.edition, c.mutate)), ...ZH_INVALID_CASES.map(zhInvalidDraft),
    ];
    expect(drafts.length).toBeGreaterThan(300);
    expect(drafts.filter((d) => FORMER_ACTORS.test(JSON.stringify(d))).length).toBe(0);
  });
});

// ── F-47: the sample Monday big picture agrees with itself ───────────────────────────────────────

describe("the sample Monday big picture", () => {
  const paragraphs = mondayDraft().review!.big_picture.split("\n\n");
  const OUTSIDE = /someone other than the makers/u;
  const MAKERS_OWN = /maker.s own/u;

  it("offers no weather result as progress that others checked, in the paragraph that opens with that progress", () => {
    const opening = paragraphs.filter((p) => OUTSIDE.test(p));
    expect(opening).toHaveLength(1);
    expect(opening[0]).not.toMatch(/weather/iu);
  });

  it("calls every sentence about the weather model one of the maker's own tests", () => {
    const about = paragraphs.flatMap(splitSentences).filter((s) => /weather/iu.test(s));
    expect(about.length).toBeGreaterThan(0);
    for (const s of about) expect(s).toMatch(MAKERS_OWN);
  });

  it("keeps the whole big picture in its 270 to 330 words", () => {
    const n = countWords(mondayDraft().review!.big_picture);
    expect(n).toBeGreaterThanOrEqual(270);
    expect(n).toBeLessThanOrEqual(330);
  });

  it("says the same in Chinese: the paragraph on outside checks has no weather, and the weather sentence says the maker ran the tests", () => {
    const zh = paragraphs.map(zhText);
    expect(zh).toHaveLength(paragraphs.length);
    const opening = zh[paragraphs.findIndex((p) => OUTSIDE.test(p))]!;
    expect(opening).not.toContain("天氣");
    const weather = zh.flatMap((p) => p.split("。")).filter((s) => s.includes("天氣"));
    expect(weather.length).toBeGreaterThan(0);
    for (const s of weather) expect(s).toContain("開發者自己做");
  });
});

// ── F-51: the first correction takes the budget of the text it corrects ──────────────────────────

describe("the sample's first correction, C-0001", () => {
  const correction = WEEKDAY_CORRECTIONS[0]!;
  const original = FINDING_SPECS[correction.finding].explainer.background;

  it("clarifies the background of the tilings finding, a story, whose parts hold at most 35 words in this part", () => {
    expect([correction.id, correction.finding, correction.type, correction.path]).toEqual(["C-0001", "tilings", "clarification", "explainer.background"]);
    expect(FINDING_SPECS.tilings.depth).toBe("story");
    expect(countWords(correction.after)).toBeLessThanOrEqual(35);
  });

  it("still says what the first text left out: the result is about the flat plane only", () => {
    expect(original).not.toMatch(/flat plane/u);
    expect(correction.after).toMatch(/flat plane only/u);
    expect(correction.reason).toMatch(/flat plane/u);
  });

  it("has a Chinese counterpart that says it too, and that the first text did not", () => {
    expect(zhText(original)).not.toContain("平面");
    expect(zhText(correction.after)).toContain("平面");
  });

  it("is stored with that text, in English alone", () => {
    const stored = storedWeekdayCorrections()[0]!;
    expect(stored.after.en).toBe(correction.after);
    expect(stored.before.en).toBe(original);
  });

  describe("the sample as built in memory", () => {
    let dir = "";
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "sample-text-"));
      for (const o of siteOutputs().filter((x) => x.path.startsWith(SITE))) {
        const file = path.join(dir, o.path.slice(SITE.length));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, o.text);
      }
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("finds no error and no warning, so the correction passes the budget of its path once stored", () => {
      const result = validateAll(dir, { config });
      expect(result.errors.map((e) => `${e.code} ${e.path}: ${e.message}`)).toEqual([]);
      expect(result.warnings.map((e) => `${e.code} ${e.path}: ${e.message}`)).toEqual([]);
    });
  });
});

// ── F-29: the archive index orders a URL's refs by compareFindingIds() ───────────────────────────

describe("the sample's archive index", () => {
  const index = JSON.parse(siteOutputs().find((o) => o.path === `${SITE}archive-index.json`)!.text) as { urls: Record<string, { refs: string[] }> };

  it("lists the refs of each URL with the finding ids first and each `date/brief` after them", () => {
    const urls = Object.entries(index.urls);
    expect(urls.length).toBeGreaterThan(20);
    for (const [url, entry] of urls) expect(entry.refs, url).toEqual([...entry.refs].sort(compareFindingIds));
    const mixed = urls.filter(([, e]) => e.refs.some((r) => r.endsWith("/brief")) && e.refs.some((r) => !r.endsWith("/brief")));
    expect(mixed.length).toBeGreaterThan(3);
    for (const [url, e] of mixed) expect(e.refs.findIndex((r) => r.endsWith("/brief")), url).toBeGreaterThan(e.refs.map((r) => r.endsWith("/brief")).lastIndexOf(false));
  });
});
