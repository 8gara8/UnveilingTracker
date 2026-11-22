// No CyberTracker leftovers in the fork (SPEC §10 Foundation step 6). Scans the tracked (and not ignored)
// files under the code folders and the root config files, never SPEC.md, AGENTS.md, docs/,
// package-lock.json or saved and generated data. The one allowed mention is the sibling link
// `siblings.cyber` in config/run.json. This file is skipped, because it names the patterns. Cyber's
// tests/no-europe-strings.test.ts at the fork commit, adapted to Cyber's own strings (docs/PROVENANCE.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_FLAG_SOURCE, MODEL_ID_SOURCE, MODEL_SAMPLES } from "./helpers/model-names";

const root = path.join(__dirname, "..");
const DIRS = ["app/", "components/", "lib/", "scripts/", "config/", "routine/", "seed/", "fixtures/src/", "fixtures/injection/", ".github/", "tests/"];
const FILES = ["package.json", "next.config.ts", "tsconfig.json", "vitest.config.ts", "postcss.config.mjs"];
const SKIP = new Set(["tests/no-cyber-strings.test.ts"]);

/** Each pattern, with a planted sample it must catch (the self-test). */
const PATTERNS: { name: string; re: RegExp; sample: string }[] = [
  { name: "CyberTracker", re: /CyberTracker/, sample: "the CyberTracker brief" },
  { name: "cybertracker (except siblings.cyber)", re: /cybertracker/, sample: "https://cybertracker-alpha.vercel.app" },
  { name: "CT_ variable", re: /\bCT_[A-Z]/, sample: "process.env.CT_CONTENT_DIR" },
  { name: "KEV", re: /\bKEV\b/, sample: "the KEV catalog" },
  { name: "CVE-", re: /CVE-/, sample: "CVE-2026-12345" },
  { name: "EPSS", re: /\bEPSS\b/, sample: "EPSS scores" },
  { name: "GHSA", re: /GHSA/, sample: "GHSA-xxxx-yyyy-zzzz" },
  { name: "Taiwan Lens", re: /Taiwan Lens/, sample: "the Taiwan Lens" },
  { name: "Scoreboard", re: /scoreboard/i, sample: "content/scoreboard.json" },
  { name: "withheld", re: /\bwithh(?:eld|old)/i, sample: "an item withheld" },
  { name: "the Cyber keychain service", re: /cybertracker-claude-oauth/, sample: "service cybertracker-claude-oauth" },
  { name: "the Cyber folder", re: /\.cybertracker\b/, sample: "/Users/kobol/.cybertracker/cli" },
  { name: "model flags", re: new RegExp(MODEL_FLAG_SOURCE), sample: MODEL_SAMPLES.at(-1)! },
  { name: "model identifiers", re: new RegExp(MODEL_ID_SOURCE), sample: MODEL_SAMPLES[0]! },
];

function files(): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
  const all = [...new Set(out.split("\0").filter(Boolean))];
  return all
    .filter((f) => (DIRS.some((d) => f.startsWith(d)) || FILES.includes(f)) && !SKIP.has(f) && fs.existsSync(path.join(root, f)))
    .sort();
}

function text(file: string): string {
  const raw = fs.readFileSync(path.join(root, file), "utf8");
  if (file !== "config/run.json") return raw;
  // The one allowed mention: the sibling link in config/run.json.
  const cfg = JSON.parse(raw) as { siblings?: Record<string, string> };
  if (cfg.siblings?.cyber) cfg.siblings.cyber = "";
  return JSON.stringify(cfg, null, 2);
}

describe("no Cyber strings", () => {
  const list = files();
  const bodies = new Map(list.map((f) => [f, text(f)]));

  it("scans the code folders and root config files, and nothing else", () => {
    for (const f of ["lib/dates.ts", "scripts/lib/keychain.ts", "config/run.json", "config/sources.yaml", "package.json", ".github/workflows/ci.yml"]) {
      expect(list).toContain(f);
    }
    expect(list.some((f) => f.startsWith("docs/") || ["SPEC.md", "AGENTS.md", "package-lock.json"].includes(f))).toBe(false);
  });

  it("every pattern catches its planted sample, every model form included", () => {
    for (const p of PATTERNS) expect(p.re.test(`see ${p.sample} here`), p.name).toBe(true);
    const model = PATTERNS.filter((p) => p.name.startsWith("model "));
    for (const sample of MODEL_SAMPLES) expect(model.some((p) => p.re.test(`see ${sample} here`)), sample).toBe(true);
    expect(model.some((p) => p.re.test("npm install @anthropic-ai/claude-code@2.1.316"))).toBe(false);
    // Words this project uses freely are not hits.
    for (const fine of ["Cyber's lib/dates.ts", "unveiling-claude-oauth", "/Users/kobol/.unveiling/cli", "siblings"]) {
      expect(PATTERNS.some((p) => p.re.test(fine)), fine).toBe(false);
    }
  });

  it("the sibling link is the one mention allowed, and only in config/run.json", () => {
    const raw = fs.readFileSync(path.join(root, "config", "run.json"), "utf8");
    expect(JSON.parse(raw).siblings.cyber).toMatch(/^https:\/\/cybertracker[a-z0-9-]*\.vercel\.app$/);
    expect(bodies.get("config/run.json")).not.toMatch(/cybertracker/);
  });

  it("finds no hit for any pattern", () => {
    const report: string[] = [];
    const hits: string[] = [];
    for (const p of PATTERNS) {
      let n = 0;
      for (const [file, body] of bodies) {
        body.split("\n").forEach((line, i) => {
          if (p.re.test(line)) {
            n += 1;
            hits.push(`${p.name}: ${file}:${i + 1}`);
          }
        });
      }
      report.push(`${String(n).padStart(3)}  ${p.name}`);
    }
    console.log(`no-cyber-strings over ${bodies.size} files:\n${report.join("\n")}`);
    expect(hits).toEqual([]);
  });
});
