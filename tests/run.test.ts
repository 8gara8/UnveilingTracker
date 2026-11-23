// scripts/lib/run.ts and the git helper on top of it (scripts/lib/git.ts): the per-call stdout limit, output
// cut at the limit flagged and refused, and output decoded whole across reads. Children are this Node binary
// and git on a local temporary repository; nothing touches the network. Cyber's tests/run.test.ts at the
// fork commit, adapted: the sample state file holds weekly counts, and the git-source case is dropped with
// Cyber's advisory reader (docs/PROVENANCE.md).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { git, GIT_STDOUT_MAX_BYTES, GitError, GitOutputCut } from "@/scripts/lib/git";
import { KEEP_BYTES, run } from "@/scripts/lib/run";

const node = (code: string): [string, string[]] => [process.execPath, ["-e", code]];
const MB = 1024 * 1024;

describe("run(): the stdout limit", () => {
  it("keeps the default 1,000,000 bytes and flags the rest as cut", async () => {
    const r = await run(...node(`process.stdout.write("x".repeat(${2 * MB}))`), { timeoutMs: 30_000 });
    expect(r.code).toBe(0);
    expect(KEEP_BYTES).toBe(1_000_000);
    expect([r.stdout.length, r.stdoutCut]).toEqual([KEEP_BYTES, true]);
  });

  it("keeps up to a per-call limit, whole and not flagged when the output fits", async () => {
    const r = await run(...node(`process.stdout.write("x".repeat(${2 * MB}))`), { timeoutMs: 30_000, maxStdoutBytes: 4 * MB });
    expect([r.stdout.length, r.stdoutCut]).toEqual([2 * MB, false]);
    const exact = await run(...node(`process.stdout.write("x".repeat(1000))`), { timeoutMs: 30_000, maxStdoutBytes: 1000 });
    expect([exact.stdout.length, exact.stdoutCut]).toEqual([1000, false]);
    const over = await run(...node(`process.stdout.write("x".repeat(1001))`), { timeoutMs: 30_000, maxStdoutBytes: 1000 });
    expect([over.stdout.length, over.stdoutCut]).toEqual([1000, true]);
  });

  it("decodes a character split across two reads whole, in stdout and in onLine", async () => {
    // 3-byte characters over many 64 KiB reads: a read boundary falls inside a character.
    const text = "あ".repeat(100_000);
    const write = `const t = "あ".repeat(100000); process.stdout.write(t + "\\n" + t)`;
    const r = await run(...node(write), { timeoutMs: 30_000 });
    expect(r.stdout).toBe(`${text}\n${text}`);
    expect(r.stdout).not.toContain("\uFFFD");
    const lines: string[] = [];
    await run(...node(write), { timeoutMs: 30_000, onLine: (l) => void lines.push(l) });
    expect(lines).toEqual([text, text]);
  });

  it("an output file takes stdout instead, and nothing is cut", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-run-"));
    try {
      const file = path.join(dir, "out.txt");
      const r = await run(...node(`process.stdout.write("x".repeat(${2 * MB}))`), { timeoutMs: 30_000, stdoutFile: file });
      expect([r.stdout, r.stdoutCut, fs.statSync(file).size]).toEqual(["", false, 2 * MB]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("git output past the limit", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ut-run-git-"));
  const sh = (...args: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=SAMPLE", "-c", "user.email=sample@example.invalid", ...args], { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
  };
  // A pretty-printed state file of about 1.5 MB with non-ASCII text, as a weekly-counts state file can grow to.
  const big = `${JSON.stringify({ rows: Array.from({ length: 20_000 }, (_, i) => ({ id: `week-${10_000 + i}`, label: "SAMPLE 數學 物理" })) }, null, 2)}\n`;
  sh("init", "-q", "-b", "main");
  fs.mkdirSync(path.join(repo, "state"));
  fs.writeFileSync(path.join(repo, "state", "big.json"), big);
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(repo, "state", `f${i}.json`), `${i}\n`);
  sh("add", "-A");
  sh("commit", "-q", "-m", "SAMPLE");
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("git show returns a committed file over 1 MB whole (the limit is 64 MiB)", async () => {
    expect(Buffer.byteLength(big)).toBeGreaterThan(1.4 * MB);
    expect(GIT_STDOUT_MAX_BYTES).toBe(64 * MB);
    const out = await git(repo)(["show", "HEAD:state/big.json"]);
    expect(`${out}\n`).toBe(big);
    expect(JSON.parse(out)).toMatchObject({ rows: expect.any(Array) });
  });

  it("output cut at the limit is a GitOutputCut error, never a string", async () => {
    const small = git(repo, { maxStdoutBytes: 64 * 1024 });
    await expect(small(["show", "HEAD:state/big.json"])).rejects.toBeInstanceOf(GitOutputCut);
    await expect(small(["show", "HEAD:state/big.json"])).rejects.toBeInstanceOf(GitError);
    await expect(small(["show", "HEAD:state/f1.json"])).resolves.toBe("1");
  });
});
