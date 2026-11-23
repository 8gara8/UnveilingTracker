// scripts/lib/git.ts (SPEC §8.7): syncMain() never autostashes and refuses a dirty tree, fast-forwards, and
// rebases local content commits; ensureIdentity(), withRetry(), porcelainPaths(), onOriginMain() and the
// deadline. Each case runs on a bare remote standing in for GitHub and its clone, in a temporary folder;
// nothing reaches the network. Cyber's tests/git.test.ts at the fork commit, adapted: the publish cases
// (commit subjects and the content layout) return in P3 with scripts/publish.ts, so the layout here is a
// stand-in, and six cases check that syncMain() reads each local commit and the rebase's result: a revert,
// a rename into the layout, a merge with -s ours, a local merge of origin's main, a merge's own change and
// an edit that follows a file origin moved (docs/PROVENANCE.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureIdentity, git, GitError, isClean, onOriginMain, porcelainPaths, SyncError, syncMain, withRetry, type Layout,
} from "@/scripts/lib/git";

const T = 60_000;
const ID = ["-c", "user.name=ut-test", "-c", "user.email=ut-test@example.invalid"];
const LAYOUT: Layout = (p) => p.startsWith("content/");

interface Repo {
  root: string;
  remote: string;
  git: (...args: string[]) => string;
  commitOnRemote: (files: Record<string, string>, message: string) => string;
  dispose: () => void;
}

function gitIn(cwd: string, args: string[]): string {
  return execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(/\s+$/, "");
}

const made: Repo[] = [];
function makeRepo(): Repo {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ut-git-")));
  const remote = path.join(base, "remote.git");
  const root = path.join(base, "work");
  gitIn(base, ["init", "-q", "--bare", "-b", "main", remote]);
  gitIn(base, ["clone", "-q", `file://${remote}`, root]);
  fs.writeFileSync(path.join(root, ".gitignore"), "/cache/\n/logs/\n");
  fs.mkdirSync(path.join(root, "content", "status"), { recursive: true });
  fs.writeFileSync(path.join(root, "content", "status", "2026-11-23.json"), "{}\n");
  gitIn(root, ["add", "-A"]);
  gitIn(root, ["commit", "-q", "-m", "seed"]);
  gitIn(root, ["push", "-q", "origin", "main"]);
  let n = 0;
  const repo: Repo = {
    root,
    remote,
    git: (...args) => gitIn(root, args),
    commitOnRemote(files, message) {
      const other = path.join(base, `other-${n++}`);
      gitIn(base, ["clone", "-q", `file://${remote}`, other]);
      for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(other, rel)), { recursive: true });
        fs.writeFileSync(path.join(other, rel), text);
      }
      gitIn(other, ["add", "-A"]);
      gitIn(other, ["commit", "-q", "-m", message]);
      gitIn(other, ["push", "-q", "origin", "main"]);
      return gitIn(other, ["rev-parse", "HEAD"]);
    },
    dispose: () => fs.rmSync(base, { recursive: true, force: true }),
  };
  made.push(repo);
  return repo;
}
afterEach(() => {
  for (const r of made.splice(0)) r.dispose();
});

const write = (r: Repo, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(r.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(r.root, rel), text);
};

describe("syncMain", () => {
  it("G1: a dirty content/ file is a SyncError, never autostashed", async () => {
    const r = makeRepo();
    r.commitOnRemote({ "content/status/2026-11-24.json": "{}\n" }, "status: 2026-11-24");
    const before = r.git("rev-parse", "HEAD");
    const tracked = path.join(r.root, "content", "status", "2026-11-23.json");
    fs.appendFileSync(tracked, " ");
    write(r, "content/briefs/2026-11-23.json", "{}\n");
    await expect(syncMain(git(r.root), LAYOUT)).rejects.toBeInstanceOf(SyncError);
    expect(r.git("rev-parse", "HEAD")).toBe(before);
    expect(r.git("stash", "list")).toBe("");
    expect(fs.readFileSync(tracked, "utf8").endsWith(" ")).toBe(true);
    expect(fs.existsSync(path.join(r.root, "content", "briefs", "2026-11-23.json"))).toBe(true);
  }, T);

  it("G1: an untracked file outside content/ is a SyncError too", async () => {
    const r = makeRepo();
    write(r, "notes.txt", "x\n");
    await expect(syncMain(git(r.root), LAYOUT)).rejects.toThrow(/uncommitted changes: notes\.txt/);
  }, T);

  it("G1: gitignored folders do not count as dirty", async () => {
    const r = makeRepo();
    write(r, "logs/2026-11-23.daily.log", "x\n");
    write(r, "cache/staged/2026-11-23/metrics/2026-11-23.json", "{}\n");
    await expect(syncMain(git(r.root), LAYOUT)).resolves.toEqual({ ahead: 0, moved: false });
  }, T);

  it("G1: with no local commits it fast-forwards to origin's main", async () => {
    const r = makeRepo();
    const sha = r.commitOnRemote({ "scripts/README.txt": "code\n" }, "code: test");
    await expect(syncMain(git(r.root), LAYOUT)).resolves.toEqual({ ahead: 0, moved: false });
    expect(r.git("rev-parse", "HEAD")).toBe(sha);
  }, T);

  it("G1: local content commits are rebased onto origin's newer main (no --autostash)", async () => {
    const r = makeRepo();
    write(r, "content/status/2026-11-24.json", "{}\n");
    r.git("add", "content");
    r.git("commit", "-q", "-m", "status: 2026-11-24");
    const remote = r.commitOnRemote({ "scripts/README.txt": "code\n" }, "code: test");
    await expect(syncMain(git(r.root), LAYOUT)).resolves.toEqual({ ahead: 1, moved: true });
    expect(r.git("rev-parse", "HEAD^")).toBe(remote);
    expect(r.git("log", "-1", "--format=%s")).toBe("status: 2026-11-24");
  }, T);

  it("G1: a local commit touching a path outside the layout is a SyncError", async () => {
    const r = makeRepo();
    write(r, "scripts/README.txt", "local code\n");
    r.git("add", "scripts");
    r.git("commit", "-q", "-m", "code: local");
    await expect(syncMain(git(r.root), LAYOUT)).rejects.toThrow(/outside the content layout/);
  }, T);

  it("G1: a code commit and its revert are a SyncError, though the tip's tree changes content/ alone", async () => {
    const r = makeRepo();
    write(r, "content/briefs/2026-11-23.json", "{}\n");
    r.git("add", "content");
    r.git("commit", "-q", "-m", "edition: 2026-11-23 (full)");
    write(r, "scripts/x.ts", "export const x = 1;\n");
    r.git("add", "scripts");
    r.git("commit", "-q", "-m", "code: by mistake");
    r.git("revert", "--no-edit", "HEAD");
    r.commitOnRemote({ "content/status/2026-11-24.json": "{}\n" }, "status: 2026-11-24");
    const head = r.git("rev-parse", "HEAD");
    await expect(syncMain(git(r.root), LAYOUT)).rejects.toThrow(/touching scripts\/x\.ts, outside the content layout/);
    expect(r.git("rev-parse", "HEAD")).toBe(head);
  }, T);

  it("G1: moving a tracked file outside the layout into content/ is a SyncError (a rename counts as a delete)", async () => {
    const r = makeRepo();
    const code = Array.from({ length: 10 }, (_, i) => `export const k${i} = ${i};`).join("\n") + "\n";
    r.commitOnRemote({ "scripts/keep.ts": code }, "code: keep.ts");
    r.git("pull", "-q", "--ff-only", "origin", "main");
    r.git("mv", "scripts/keep.ts", "content/keep.ts");
    r.git("commit", "-q", "-m", "content: move keep");
    r.commitOnRemote({ "content/status/2026-11-24.json": "{}\n" }, "status: 2026-11-24");
    await expect(syncMain(git(r.root), LAYOUT)).rejects.toThrow(/touching scripts\/keep\.ts, outside the content layout/);
  }, T);

  it("G1: a side branch's code commit merged with -s ours is a SyncError (the rebase would replay it)", async () => {
    const r = makeRepo();
    r.git("switch", "-q", "-c", "side");
    write(r, "scripts/x.ts", "export const x = 1;\n");
    r.git("add", "scripts");
    r.git("commit", "-q", "-m", "code: side");
    r.git("switch", "-q", "main");
    write(r, "content/briefs/2026-11-23.json", "{}\n");
    r.git("add", "content");
    r.git("commit", "-q", "-m", "edition: 2026-11-23 (full)");
    r.git("merge", "-q", "-s", "ours", "-m", "merge side", "side");
    r.commitOnRemote({ "content/status/2026-11-24.json": "{}\n" }, "status: 2026-11-24");
    await expect(syncMain(git(r.root), LAYOUT)).rejects.toThrow(/touching scripts\/x\.ts, outside the content layout/);
  }, T);

  it("G1: a local merge of origin's main is rebased flat, leaving the content commits alone", async () => {
    const r = makeRepo();
    write(r, "content/briefs/2026-11-23.json", "{}\n");
    r.git("add", "content");
    r.git("commit", "-q", "-m", "edition: 2026-11-23 (full)");
    r.commitOnRemote({ "scripts/pr.ts": "export {};\n" }, "code: a merged PR");
    r.git("fetch", "-q", "origin", "main");
    r.git("merge", "-q", "--no-ff", "-m", "merge origin/main", "origin/main");
    write(r, "content/briefs/2026-11-24.json", "{}\n");
    r.git("add", "content");
    r.git("commit", "-q", "-m", "edition: 2026-11-24 (full)");
    r.commitOnRemote({ "content/status/2026-11-24.json": "{}\n" }, "status: 2026-11-24");
    await expect(syncMain(git(r.root), LAYOUT)).resolves.toEqual({ ahead: 3, moved: true });
    expect(r.git("rev-list", "--merges", "origin/main..HEAD")).toBe("");
    expect(r.git("log", "--no-renames", "--format=", "--name-only", "origin/main..HEAD").split("\n").sort()).toEqual(["content/briefs/2026-11-23.json", "content/briefs/2026-11-24.json"]);
  }, T);

  it("G1: a merge commit's own change outside the layout is still a SyncError", async () => {
    const r = makeRepo();
    r.git("switch", "-q", "-c", "side");
    write(r, "content/briefs/2026-11-22.json", "{}\n");
    r.git("add", "content");
    r.git("commit", "-q", "-m", "edition: 2026-11-22 (full)");
    r.git("switch", "-q", "main");
    r.git("merge", "-q", "--no-ff", "--no-commit", "side");
    write(r, "scripts/evil.ts", "export {};\n");
    r.git("add", "scripts");
    r.git("commit", "-q", "-m", "merge side");
    r.commitOnRemote({ "content/status/2026-11-24.json": "{}\n" }, "status: 2026-11-24");
    await expect(syncMain(git(r.root), LAYOUT)).rejects.toThrow(/touching scripts\/evil\.ts, outside the content layout/);
  }, T);

  it("G1: a content edit the rebase moves to where origin moved the file is a SyncError, and main is kept", async () => {
    const r = makeRepo();
    write(r, "content/status/2026-11-23.json", "{\"local\": true}\n");
    r.git("commit", "-q", "-am", "status: local");
    const head = r.git("rev-parse", "HEAD");
    const other = path.join(r.root, "..", "mover");
    gitIn(path.dirname(other), ["clone", "-q", `file://${r.remote}`, other]);
    fs.mkdirSync(path.join(other, "scripts"));
    gitIn(other, ["mv", "content/status/2026-11-23.json", "scripts/seed.json"]);
    gitIn(other, ["commit", "-q", "-m", "code: move the seed"]);
    gitIn(other, ["push", "-q", "origin", "main"]);
    await expect(syncMain(git(r.root), LAYOUT)).rejects.toThrow(/rebased commits touch scripts\/seed\.json/);
    expect(r.git("rev-parse", "HEAD")).toBe(head);
    expect(r.git("status", "--porcelain")).toBe("");
  }, T);

  it("G1: a rebase conflict is aborted and thrown as a SyncError", async () => {
    const r = makeRepo();
    write(r, "content/status/2026-11-23.json", "{\"local\": true}\n");
    r.git("commit", "-q", "-am", "status: local");
    r.commitOnRemote({ "content/status/2026-11-23.json": "{\"remote\": true}\n" }, "status: remote");
    const head = r.git("rev-parse", "HEAD");
    const err = await syncMain(git(r.root), LAYOUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect(err).toBeInstanceOf(GitError);
    expect(r.git("rev-parse", "HEAD")).toBe(head);
    expect(r.git("status", "--porcelain")).toBe("");
    expect(fs.existsSync(path.join(r.root, ".git", "rebase-merge"))).toBe(false);
    expect(fs.existsSync(path.join(r.root, ".git", "rebase-apply"))).toBe(false);
  }, T);

  it("G1: the rebase command carries no --autostash", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "lib", "git.ts"), "utf8");
    expect(src).not.toMatch(/"--autostash"/);
    expect(src).toContain('["rebase", "origin/main"]');
  });
});

describe("the other helpers", () => {
  it("G2: ensureIdentity sets this project's identity only when none is configured", async () => {
    const r = makeRepo();
    const keep = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
    process.env.GIT_CONFIG_GLOBAL = path.join(r.root, "..", "no-global-config");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    try {
      const g = git(r.root);
      await ensureIdentity(g);
      expect([await g(["config", "user.name"]), await g(["config", "user.email"])]).toEqual(["UnveilingTracker", "run@unveilingtracker.invalid"]);
      await g(["config", "user.name", "8gara8"]);
      await ensureIdentity(g);
      expect(await g(["config", "user.name"])).toBe("8gara8");
    } finally {
      for (const [k, v] of [["GIT_CONFIG_GLOBAL", keep.global], ["GIT_CONFIG_NOSYSTEM", keep.nosystem]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, T);

  it("G3: isClean, porcelainPaths with a rename, and onOriginMain against the remote", async () => {
    const r = makeRepo();
    const g = git(r.root);
    expect(await isClean(g)).toBe(true);
    r.git("mv", "content/status/2026-11-23.json", "content/status/2026-11-24.json");
    expect(porcelainPaths(await g(["status", "--porcelain"]))).toEqual(["content/status/2026-11-24.json"]);
    expect(porcelainPaths(' M "content/a b.json"\n?? notes.txt')).toEqual(["content/a b.json", "notes.txt"]);
    expect(await isClean(g)).toBe(false);
    const head = r.git("rev-parse", "HEAD");
    expect(await onOriginMain(g, head)).toBe(true);
    r.commitOnRemote({ "content/x.json": "{}\n" }, "status: later");
    expect(await onOriginMain(g, head)).toBe(false);
  }, T);

  it("G4: a git call after its deadline is not started", async () => {
    const r = makeRepo();
    await expect(git(r.root, { deadline: Date.now() - 1 })(["status"])).rejects.toThrow(/not started: the run's deadline has passed/);
    await expect(git(r.root)(["no-such-command"])).rejects.toBeInstanceOf(GitError);
  }, T);

  it("G5: withRetry retries after each delay, stops on a fatal error and before the deadline", async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error(`try ${calls}`);
      return "ok";
    }, [1, 1, 1], null)).resolves.toBe("ok");
    expect(calls).toBe(3);

    calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw new Error("fatal");
    }, [1, 1], null, () => true)).rejects.toThrow("fatal");
    expect(calls).toBe(1);

    calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw new Error(`try ${calls}`);
    }, [60_000], Date.now() + 1_000)).rejects.toThrow("try 1");
    expect(calls).toBe(1);
  });
});
