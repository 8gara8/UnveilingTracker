// The files whose contents SPEC.md states (SPEC §0.1 item 10: keep each fact in one place) and the
// Foundation's other repo files: config/run.json against §4.11's block, the CI workflow against §9.2's,
// .gitignore against §3's list, package.json against §2 and §8.1, the source registry's format (§4.13),
// the error-report form (§9.2, §4.2 REPORT_KINDS) and the PR template (§10). New in Foundation
// (docs/PROVENANCE.md).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const spec = read("SPEC.md");

/** The text of the first fenced block of `lang` after `marker` in SPEC.md. */
function specBlock(marker: string, lang: string): string {
  const at = spec.indexOf(marker);
  if (at < 0) throw new Error(`SPEC.md has no ${marker}`);
  const open = spec.indexOf("```" + lang + "\n", at);
  if (open < 0) throw new Error(`SPEC.md has no ${lang} block after ${marker}`);
  const start = open + 4 + lang.length;
  // The closing fence may be indented, as it is inside a list item.
  const close = /\n[ \t]*```/g;
  close.lastIndex = start - 1;
  const end = close.exec(spec);
  if (!end) throw new Error(`SPEC.md's ${lang} block after ${marker} is not closed`);
  return spec.slice(start, end.index + 1);
}

/** The block indented as a list item's code (§4.11's run.json sits inside a bullet). */
const dedent = (text: string) => {
  const lines = text.split("\n");
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(pad)).join("\n");
};

const FIELDS = ["mathematics", "physics", "chemistry", "biology", "earth", "social", "humanities"];

describe("config/run.json", () => {
  const run = JSON.parse(read("config/run.json"));

  it("R1: is exactly SPEC §4.11's block", () => {
    expect(run).toEqual(JSON.parse(dedent(specBlock("- **`run.json`:**", "json"))));
  });

  it("R2: the schedule runs in order and ends before 04:30, when Cyber's run starts (SPEC §0.2, §8.2)", () => {
    const s = run.schedule;
    const order = [s.start, s.data_only_target, s.retry_cutoff, s.zh_start_by, s.full_target, s.hard_stop, "04:30"];
    expect([...order].sort()).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    expect([s.timezone, s.start, s.hard_stop, s.stale_after, s.publish_until]).toEqual(["Asia/Taipei", "03:15", "04:25", "08:00", "11:00"]);
    expect(run.pack.window_end).toBe(s.start);
  });

  it("R3: names this project, its task and its siblings, with no e-mail address anywhere", () => {
    expect([run.site.name, run.repos.repo, run.repos.branch, run.task_name]).toEqual(["Unveiling Tracker", "8gara8/UnveilingTracker", "main", "Unveiling morning"]);
    expect(Object.keys(run.siblings)).toEqual(["me", "europe", "cyber"]);
    expect(run.site.tagline.zh).toBeTruthy();
    expect(read("config/run.json")).not.toMatch(/@/);
  });
});

describe("files the spec shows", () => {
  it("F1: the CI workflow is SPEC §9.2's block", () => {
    expect(read(".github/workflows/ci.yml")).toBe(specBlock("**CI.** `.github/workflows/ci.yml`", "yaml"));
  });

  it("F2: .gitignore is SPEC §3's list, in order", () => {
    const para = spec.slice(spec.indexOf("**Gitignored**, exactly:"), spec.indexOf("(as Cyber).", spec.indexOf("**Gitignored**")));
    const listed = [...para.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(read(".gitignore").split("\n").filter(Boolean)).toEqual(listed);
  });

  it("F3: package.json pins SPEC §2's versions and holds only §8.1's scripts, check as Foundation's", () => {
    const pkg = JSON.parse(read("package.json"));
    expect([pkg.name, pkg.private, pkg.type, pkg.engines]).toEqual(["unveilingtracker", true, "module", { node: ">=22" }]);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    expect(deps).toEqual({
      next: "16.4.3", react: "19.3.1", "react-dom": "19.3.1", zod: "4.6.7", "@tailwindcss/postcss": "4.3.3", tailwindcss: "4.3.3",
      "@types/node": "24.19.2", "@types/react": "19.3.0", "@types/react-dom": "19.3.0", cheerio: "1.2.0", "rss-parser": "3.13.0",
      tsx: "4.23.15", typescript: "5.9.3", vitest: "5.0.5", yaml: "2.9.1",
    });
    const block = JSON.parse(specBlock("### 8.1 package.json scripts", "json")).scripts as Record<string, string>;
    for (const [name, cmd] of Object.entries(pkg.scripts as Record<string, string>)) {
      if (name === "check") continue;
      expect(cmd, name).toBe(block[name]);
    }
    // `check` grows by phase (§8.1); P1's is Foundation's typecheck and test, then the schema, fixture and content checks.
    expect(pkg.scripts.check).toBe(
      "npm run typecheck && npm test && npm run schema:check && npm run fixtures:check && npm run validate:sample && npm run validate:all",
    );
    expect(block.check.startsWith(pkg.scripts.check)).toBe(true);
    const lock = JSON.parse(read("package-lock.json"));
    expect([lock.name, lock.packages[""].name]).toEqual(["unveilingtracker", "unveilingtracker"]);
    expect({ ...lock.packages[""].dependencies, ...lock.packages[""].devDependencies }).toEqual(deps);
  });
});

describe("config/sources.yaml (SPEC §4.13)", () => {
  const reg = parse(read("config/sources.yaml")) as { schema_version: number; arxiv_skipped: unknown[]; feeds: Record<string, unknown>[] };
  const KEYS = ["id", "name", "kind", "url", "fallback_url", "priority", "fresh_days", "must_match", "date_zone", "fields", "parser", "budget"];

  it("S1: every feed has every key, in order, with a value of the right kind", () => {
    expect(reg.schema_version).toBe(1);
    expect(Object.keys(reg)).toEqual(["schema_version", "arxiv_skipped", "feeds"]);
    // The US dates of the announcements arXiv skips (§4.13): arXiv announces Sunday to Thursday.
    const skipped = reg.arxiv_skipped as string[];
    expect(Array.isArray(skipped)).toBe(true);
    for (const d of skipped) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect([0, 1, 2, 3, 4], d).toContain(new Date(`${d}T00:00:00Z`).getUTCDay());
    }
    expect([...new Set(skipped)].sort()).toEqual(skipped);
    for (const f of reg.feeds) {
      expect(Object.keys(f), String(f.id)).toEqual(KEYS);
      expect(String(f.id)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(["api", "rss", "page", "file"]).toContain(f.kind);
      expect(["atom", "json", "rss", "html", "csv", "none"]).toContain(f.parser);
      expect(String(f.url)).toMatch(/^https:\/\//);
      if (f.fallback_url !== null) expect(String(f.fallback_url)).toMatch(/^https:\/\//);
      expect([1, 2, 3]).toContain(f.priority);
      expect(f.fresh_days === null || (Number.isInteger(f.fresh_days) && (f.fresh_days as number) >= 1), String(f.id)).toBe(true);
      expect(typeof f.must_match).toBe("boolean");
      // Cyber's UtcOffset: "+08:00", never "Z" (null reads zone-less times as UTC).
      if (f.date_zone !== null) expect(String(f.date_zone)).toMatch(/^[+-](?:0\d|1[0-4]):[0-5]\d$/);
      for (const field of f.fields as string[]) expect(FIELDS).toContain(field);
      expect(Number.isInteger(f.budget) && (f.budget as number) >= 0).toBe(true);
    }
    const ids = reg.feeds.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("S2: holds a feed for every row of the spec's table", () => {
    const ids = reg.feeds.map((f) => String(f.id));
    for (const id of ["biorxiv", "medrxiv", "pubmed", "crossref-journals", "eurekalert", "smc-reactions", "openalex", "crossref-updates",
      "retraction-watch", "ctgov", "rcsb", "rcsb-unreleased", "mathlib-stats", "erdos", "scrollprize", "naer-terms"]) {
      expect(ids, id).toContain(id);
    }
    for (const prefix of ["arxiv-", "journal-", "lab-"]) expect(ids.some((i) => i.startsWith(prefix)), prefix).toBe(true);
    // Collect never reads 樂詞網: the Chinese pass fetches it through its own sandbox (§9.5), and stage 8
    // snapshots the pages it fetched (§8.2), neither against a feed's budget (§4.13).
    expect(reg.feeds.find((f) => f.id === "naer-terms")).toMatchObject({ parser: "none", budget: 0 });
  });

  it("S3: the families have the counts §4.13's table gives, and every journal has its feed but the four with none", () => {
    const ids = reg.feeds.map((f) => String(f.id));
    expect(reg.feeds).toHaveLength(62);
    expect(ids.filter((i) => i.startsWith("arxiv-"))).toHaveLength(8);
    expect(ids.filter((i) => i.startsWith("journal-"))).toHaveLength(26);
    expect(ids.filter((i) => i.startsWith("lab-"))).toHaveLength(12);
    expect(spec).toContain("| `journal-<id>` (26 feeds) |");
    expect(spec).toContain("| `lab-<id>` (12 feeds) |");
    // §4.13: a journal's feed is `journal-` and its id, but for two shortened ids; four journals have no feed
    // (JACS and Environmental Science & Technology answer a browser check, Acta and the JBL publish none).
    const SHORT: Record<string, string> = { "geophysical-research-letters": "grl", "hts-theological-studies": "hts" };
    const NONE = ["jacs", "environmental-science-and-technology", "acta-mathematica", "journal-of-biblical-literature"];
    const journals = (JSON.parse(read("config/journals.json")) as { journals: { id: string; in_pace: boolean }[] }).journals;
    const expected = journals.filter((j) => !NONE.includes(j.id)).map((j) => `journal-${SHORT[j.id] ?? j.id}`);
    expect(NONE.every((n) => journals.some((j) => j.id === n))).toBe(true);
    expect(ids.filter((i) => i.startsWith("journal-")).sort()).toEqual([...expected].sort());
    // A journal's feed is read as RSS, maps each item by its journal and its text, and has priority 2 when the journal counts in the Pace
    // and 3 when it does not, but Nature's and Science's keep the 1 the Foundation drafted (the file's header, §4.13).
    for (const j of journals.filter((x) => !NONE.includes(x.id))) {
      const feed = reg.feeds.find((f) => f.id === `journal-${SHORT[j.id] ?? j.id}`);
      expect(feed, j.id).toMatchObject({ kind: "rss", parser: "rss", fields: [], must_match: true, priority: j.id === "nature" || j.id === "science" ? 1 : j.in_pace ? 2 : 3 });
    }
  });

  it("S4: arxiv_skipped holds the 19 dates K1c found, each in the spec's text, and the arXiv feeds follow §4.13", () => {
    const skipped = reg.arxiv_skipped as string[];
    expect(skipped).toHaveLength(19);
    const section = spec.slice(spec.indexOf("### 4.13 Source registry"), spec.indexOf("### 4.14 Source pack"));
    // The eight past dates, which the tests use, and the eleven of the next twelve months (§4.13).
    for (const d of skipped) expect(section, d).toContain(d);
    expect(skipped).toContain("2026-11-26");
    expect(skipped).toContain("2026-11-11");
    // Each arXiv feed has its category query in the spec's table and the listing feed as its fallback.
    const table = [...section.matchAll(/^\| `(arxiv-[a-z-]+)` \| `[^`]+` \|/gm)].map((m) => m[1]);
    const arxiv = reg.feeds.filter((f) => String(f.id).startsWith("arxiv-"));
    expect(table.sort()).toEqual(arxiv.map((f) => String(f.id)).sort());
    for (const f of arxiv) {
      expect(f, String(f.id)).toMatchObject({ kind: "api", parser: "atom", fresh_days: 5, must_match: true, budget: 2, url: "https://export.arxiv.org/api/query" });
      expect(String(f.fallback_url), String(f.id)).toMatch(/^https:\/\/rss\.arxiv\.org\/atom\/[A-Za-z.-]+$/);
    }
  });

  it("S5: a fallback is counted in the budget, a feed's kind fits its parser, the undated lab pages have no fresh_days and only Sakana AI sets a date_zone", () => {
    for (const f of reg.feeds) {
      const id = String(f.id);
      if (f.fallback_url !== null) expect(f.budget as number, id).toBeGreaterThanOrEqual(2);
      if (f.kind === "file") expect(f.parser, id).toBe(id === "rcsb-unreleased" ? "json" : "csv");
      if (f.kind === "rss") expect(f.parser, id).toBe("rss");
      if (f.kind === "page") expect(["html", "none"], id).toContain(f.parser);
      if (f.kind === "api") expect(["atom", "json"], id).toContain(f.parser);
      // The two lab pages that print no dates have no fresh_days to judge.
      if (id === "lab-futurehouse" || id === "lab-isomorphic-labs") expect(f.fresh_days, id).toBeNull();
    }
    // The one feed read as RSS whose fallback is an HTML page (§4.13): its reader hands the page to the HTML reader.
    expect(reg.feeds.find((f) => f.id === "smc-reactions")).toMatchObject({ kind: "rss", parser: "rss", fallback_url: "https://www.sciencemediacentre.org/" });
    // Sakana AI's feed is the one that sets a date_zone (§4.13).
    expect(reg.feeds.filter((f) => f.date_zone !== null).map((f) => f.id)).toEqual(["lab-sakana-ai"]);
    // §4.13's labs: must_match is false for lab-deepmind and the four companies whose every post is the point, true for the other seven;
    // `fields` is listed for the five labs that work in one or two, and the other seven are mapped one candidate at a time (§8.3).
    const labs = reg.feeds.filter((f) => String(f.id).startsWith("lab-"));
    expect(labs).toHaveLength(12);
    expect(labs.filter((f) => f.must_match === false).map((f) => f.id).sort()).toEqual(["lab-deepmind", "lab-futurehouse", "lab-isomorphic-labs", "lab-lila-sciences", "lab-periodic-labs"]);
    expect(labs.filter((f) => (f.fields as string[]).length > 0).map((f) => f.id).sort()).toEqual(["lab-arc-institute", "lab-futurehouse", "lab-isomorphic-labs", "lab-lila-sciences", "lab-periodic-labs"]);
  });
});

describe("the error-report form (SPEC §9.2)", () => {
  const form = parse(read(".github/ISSUE_TEMPLATE/error-report.yml")) as {
    name: string; description: string; labels: string[]; body: { type: string; id: string; attributes: { description?: string; options?: string[] }; validations: { required: boolean } }[];
  };
  const KINDS = [
    "A fact or number is wrong",
    "The source does not say this",
    "The ladder rung or AI role is wrong",
    "A link is broken or goes to the wrong page",
    "It gives detail that could help cause harm",
  ];

  it("E1: has exactly three fields: the finding id (required), what is wrong (required) and an evidence link", () => {
    expect(form.labels).toEqual(["error-report"]);
    expect(form.body.map((b) => [b.type, b.id, b.validations.required])).toEqual([
      ["input", "finding_id", true], ["dropdown", "report_kind", true], ["input", "evidence_url", false],
    ]);
  });

  it("E2: the options are REPORT_KINDS' labels in English then Chinese (SPEC §4.2)", () => {
    const options = form.body[1]!.attributes.options!;
    expect(options.map((o) => o.split(" · ")[0])).toEqual(KINDS);
    for (const o of options) expect(o).toMatch(/^[^·]+ · [^·\x00-\x7f]+[^·]*$/);
  });

  it("E3: says in both languages that only these fields are read and when the outcome appears", () => {
    expect(form.description).toMatch(/Only the three fields below are read/);
    expect(form.description).toMatch(/next morning/);
    expect(form.description).toMatch(/只讀取下方三個欄位/);
    expect(parse(read(".github/ISSUE_TEMPLATE/config.yml"))).toEqual({ blank_issues_enabled: false });
  });

  it("E4: the finding id's description says in both languages that an id matching no finding is ignored (SPEC §8.9)", () => {
    const description = form.body[0]!.attributes.description ?? "";
    expect(description).toMatch(/If the id matches no finding, the report is ignored\./);
    expect(description).toMatch(/若編號對應不到任何一則發現，這份回報會被略過。/);
  });
});

describe("the PR template (SPEC §10)", () => {
  it("P1: has the spec's sections in order", () => {
    const headings = read(".github/pull_request_template.md").split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
    expect(headings).toEqual(["What this delivers", "For JL", "Milestone", "Verify results", "Spec changes", "Screenshots", "Review"]);
  });
});
