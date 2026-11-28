// docs/SOURCES.md (SPEC §10 P2 step 1, §6 /about): each feed of config/sources.yaml has a section with its address, limits and terms,
// and a read feed has exactly two credit lines, `Credit:` and then `Credit (zh):` on the next line, which /about and /zh/about show.
// New for this project (the file is new in P2; docs/PROVENANCE.md).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { CONFIG_DIR, loadConfig } from "@/lib/config";
import { avoidHits, traditionalHits } from "@/lib/zh";

const root = path.join(__dirname, "..");
const doc = fs.readFileSync(path.join(root, "docs", "SOURCES.md"), "utf8");
const lines = doc.split("\n");
const registry = parseYaml(fs.readFileSync(path.join(root, CONFIG_DIR, "sources.yaml"), "utf8")) as { feeds: { id: string; url: string; fallback_url: string | null }[] };
const SEED = loadConfig(path.join(root, CONFIG_DIR));

/** The two dashes the spec bans (NO_EM_DASH): built from their code points, so no source line holds one. */
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

interface Section {
  /** The heading's text, as written. */
  heading: string;
  /** The feed id when the heading is exactly "### `id`", else null. */
  feed: string | null;
  lines: string[];
}

/** The document cut at every heading (levels 2 to 4). */
function sections(): Section[] {
  const out: Section[] = [];
  for (const line of lines) {
    const m = /^#{2,4}\s+(.*\S)\s*$/.exec(line);
    if (m !== null) {
      const feed = /^`([^`]+)`$/.exec(m[1]!);
      out.push({ heading: m[1]!, feed: feed === null ? null : feed[1]!, lines: [] });
    } else out.at(-1)?.lines.push(line);
  }
  return out;
}

const CREDIT = /^Credit: ?(.*)$/;
const CREDIT_ZH = /^Credit \(zh\): ?(.*)$/;
const creditLines = (ls: readonly string[]): string[] => ls.filter((l) => CREDIT.test(l) || CREDIT_ZH.test(l));

describe("docs/SOURCES.md", () => {
  it("has a section for every feed id of config/sources.yaml, once, and none for an id that is not a feed", () => {
    const ids = registry.feeds.map((f) => f.id);
    const headed = sections().filter((s) => s.feed !== null).map((s) => s.feed!);
    for (const id of ids) expect(headed.filter((h) => h === id), id).toHaveLength(1);
    expect(headed.filter((h) => !ids.includes(h))).toEqual([]);
    expect(headed).toEqual(ids);
  });

  it("gives each feed section the address its feed is read at, and a limits and a terms line", () => {
    for (const f of registry.feeds) {
      const s = sections().find((x) => x.feed === f.id)!;
      const read = s.lines.find((l) => l.startsWith("- **Read at:**"));
      expect(read, f.id).toContain(`\`${f.url}\``);
      if (f.fallback_url !== null) expect(read, f.id).toContain(`\`${f.fallback_url}\``);
      expect(s.lines.some((l) => l.startsWith("- **Limits:**") && l.length > 20), f.id).toBe(true);
      expect(s.lines.some((l) => l.startsWith("- **Terms:**") && l.length > 20), f.id).toBe(true);
    }
  });

  it("follows every `Credit:` line with a `Credit (zh):` line on the next line, and puts no `Credit (zh):` line anywhere else", () => {
    let english = 0;
    lines.forEach((line, i) => {
      if (CREDIT.test(line)) {
        english++;
        expect(lines[i + 1], `line ${i + 1}: ${line}`).toMatch(CREDIT_ZH);
      }
      if (CREDIT_ZH.test(line)) expect(lines[i - 1], `line ${i + 1}: ${line}`).toMatch(CREDIT);
    });
    expect(english).toBeGreaterThanOrEqual(registry.feeds.length);
  });

  it("holds no empty credit line, each a single trimmed line with a Chinese line that holds Chinese", () => {
    const han = /\p{Script=Han}/gu;
    for (const line of lines) {
      const en = CREDIT.exec(line);
      const zh = CREDIT_ZH.exec(line);
      if (en !== null) {
        expect(en[1]!.trim().length, line).toBeGreaterThan(10);
        expect(line, line).toBe(line.trimEnd());
        expect(en[1], line).toMatch(/[.)]$/);
      }
      if (zh !== null) {
        expect(zh[1]!.trim().length, line).toBeGreaterThan(3);
        expect(line, line).toBe(line.trimEnd());
        expect((zh[1]!.match(han) ?? []).length, line).toBeGreaterThanOrEqual(4);
        expect(zh[1], line).toMatch(/。$/);
      }
    }
  });

  it("gives every feed that is read exactly two credit lines, and every feed that is not read a note and none", () => {
    for (const f of registry.feeds) {
      const s = sections().find((x) => x.feed === f.id)!;
      const credits = creditLines(s.lines);
      const notRead = s.lines.some((l) => l.startsWith("- **Not read:**"));
      if (notRead) {
        expect(credits, `${f.id} is not read`).toEqual([]);
      } else {
        expect(credits, f.id).toHaveLength(2);
        expect(CREDIT.test(credits[0]!), f.id).toBe(true);
        expect(CREDIT_ZH.test(credits[1]!), f.id).toBe(true);
      }
    }
  });

  it("puts no credit line in the sections that hold only a note: the journals with no feed, E-utilities, doi.org and the erdosproblems wiki", () => {
    const noted = sections().filter((s) => /^(Journals with no feed|NCBI E-utilities|doi\.org|The AI contributions wiki)/.test(s.heading));
    expect(noted).toHaveLength(4);
    for (const s of noted) expect(creditLines(s.lines), s.heading).toEqual([]);
    const journals = noted.find((s) => s.heading === "Journals with no feed")!;
    const text = journals.lines.join(" ");
    for (const name of ["JACS", "Environmental Science & Technology", "Acta Mathematica", "Journal of Biblical Literature"]) expect(text, name).toContain(name);
    expect(text).toContain("crossref-journals");
    // those four journals have no feed in the registry
    expect(registry.feeds.map((f) => f.id).filter((id) => /jacs|es-and-t|environmental|acta|jbl|biblical/.test(id))).toEqual([]);
  });

  it("has a section for Wycliffe, whose figures the full_bibles counter holds, with its two credit lines", () => {
    const s = sections().find((x) => x.heading.startsWith("Wycliffe Global Alliance"))!;
    expect(creditLines(s.lines)).toHaveLength(2);
    const counters = JSON.parse(fs.readFileSync(path.join(root, CONFIG_DIR, "counters.json"), "utf8")) as { counters: { id: string; figures: { source_url: string }[] }[] };
    const figures = counters.counters.find((c) => c.id === "full_bibles")!.figures;
    expect(figures.length).toBeGreaterThan(0);
    // every page a figure came from is on the host the section names
    for (const fig of figures) expect(new URL(fig.source_url).hostname.replace(/^www\./, "")).toBe("wycliffe.net");
    expect(s.lines.join(" ")).toContain("https://wycliffe.net/global-scripture-access/");
  });

  it("holds no em dash and no en dash, and no Chinese credit line holds a character or a term that Taiwan does not write", () => {
    expect(doc.includes(EM), "em dash").toBe(false);
    expect(doc.includes(EN), "en dash").toBe(false);
    for (const line of lines.filter((l) => CREDIT_ZH.test(l))) {
      expect(traditionalHits(line, SEED.index), line).toEqual([]);
      expect(avoidHits(line, SEED.termsZh), line).toEqual([]);
    }
  });

  it("writes each Chinese credit line to STYLE-ZH.md's spacing: a space between Latin letters or digits and a Han character, none between two Han characters or beside a full-width mark", () => {
    const fullWidth = "（）「」，。；：、！？";
    const zhLines = lines.filter((l) => CREDIT_ZH.test(l)).map((l) => CREDIT_ZH.exec(l)![1]!);
    expect(zhLines.length).toBeGreaterThanOrEqual(registry.feeds.length);
    for (const zh of zhLines) {
      expect(zh, zh).not.toMatch(/\p{Script=Han} \p{Script=Han}/u);
      expect(zh, zh).not.toMatch(new RegExp(` [${fullWidth}]|[${fullWidth}] `, "u"));
      expect(zh, zh).not.toMatch(/[A-Za-z0-9]\p{Script=Han}|\p{Script=Han}[A-Za-z0-9]/u);
    }
  });

  it("writes a name that ends in s with an apostrophe alone in the English credit lines (Periodic Labs' own site)", () => {
    const en = lines.filter((l) => CREDIT.test(l));
    expect(en.some((l) => l.includes("Periodic Labs' own site"))).toBe(true);
    for (const line of en) expect(line, line).not.toMatch(/s's\b/);
  });

  it("states the limits K1c read, and the Retraction Watch citation line K1d gave", () => {
    const by = (id: string) => sections().find((x) => x.feed === id)!.lines.join(" ");
    for (const id of registry.feeds.map((f) => f.id).filter((i) => i.startsWith("arxiv-"))) expect(by(id), id).toMatch(/one request every 3 seconds/i);
    expect(by("pubmed")).toContain("3 requests a second");
    expect(by("crossref-journals")).toContain("5 requests a second");
    expect(by("crossref-updates")).toContain("1 at a time");
    expect(by("retraction-watch")).toContain("500");
    expect(by("retraction-watch")).toContain("Credit: Retraction Watch Database (Center for Scientific Integrity), made openly available by Crossref.");
    expect(by("rcsb-unreleased")).toContain("1.16 MB");
  });

  it("is the one place the credits are written: no other file of docs/ or config/ holds a `Credit:` line", () => {
    for (const dir of ["docs", CONFIG_DIR]) {
      for (const name of fs.readdirSync(path.join(root, dir))) {
        const file = path.join(root, dir, name);
        if (!fs.statSync(file).isFile() || name === "SOURCES.md") continue;
        expect(fs.readFileSync(file, "utf8").split("\n").some((l) => CREDIT.test(l) || CREDIT_ZH.test(l)), `${dir}/${name}`).toBe(false);
      }
    }
  });
});
