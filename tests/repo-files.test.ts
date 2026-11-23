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
    // `check` grows by phase (§8.1); Foundation's is typecheck and test.
    expect(pkg.scripts.check).toBe("npm run typecheck && npm test");
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
      "retraction-watch", "ctgov", "rcsb", "mathlib-stats", "erdos", "scrollprize", "naer-terms"]) {
      expect(ids, id).toContain(id);
    }
    for (const prefix of ["arxiv-", "journal-", "lab-"]) expect(ids.some((i) => i.startsWith(prefix)), prefix).toBe(true);
    // Collect never reads 樂詞網: the Chinese pass fetches it through its own sandbox (§9.5), and stage 8
    // snapshots the pages it fetched (§8.2), neither against a feed's budget (§4.13).
    expect(reg.feeds.find((f) => f.id === "naer-terms")).toMatchObject({ parser: "none", budget: 0 });
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
