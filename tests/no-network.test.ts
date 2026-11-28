// The offline guard (SPEC §8.1 "No test touches the network"): tests/setup/offline.ts, loaded by
// vitest.config.ts before every test file, lets fetch reach only localhost and git only file:// remotes.
// Cyber's tests/no-network.test.ts at the fork commit, adapted: the fetchFeed() cases come back in P2 with
// lib/feeds/http.ts (docs/PROVENANCE.md).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchFeed } from "@/lib/feeds/http";
import { offlineGuard } from "./setup/offline";

/** Runs `probe`, then takes the URLs it got blocked on out of the guard, so this file's afterAll stays green. */
async function blockedBy(probe: () => Promise<unknown>): Promise<string[]> {
  const before = offlineGuard.blocked.length;
  await probe();
  return offlineGuard.blocked.splice(before);
}

describe("tests/setup/offline.ts", () => {
  it("is loaded before every test file (vitest.config.ts setupFiles)", () => {
    const config = fs.readFileSync(path.join(__dirname, "..", "vitest.config.ts"), "utf8");
    expect(config).toMatch(/setupFiles:\s*\["tests\/setup\/offline\.ts"\]/);
    expect(globalThis.fetch).not.toBe(offlineGuard.realFetch);
  });

  it("rejects fetch to any other host, and records it", async () => {
    let error: unknown = null;
    const blocked = await blockedBy(() => fetch("https://example.org/ut-sample/probe").catch((e: unknown) => { error = e; }));
    expect(String(error)).toMatch(/A test tried the network: example\.org/);
    expect(blocked).toEqual(["https://example.org/ut-sample/probe"]);
  });

  it("turns a blocked fetchFeed() into an error result instead of an exception, and the guard still records its URL", async () => {
    const url = "https://example.com/ut-sample/feed.xml";
    let result: Awaited<ReturnType<typeof fetchFeed>> | null = null;
    const blocked = await blockedBy(async () => {
      result = await fetchFeed(url, { retryDelayMs: 0, timeoutMs: 2_000 });
    });
    expect(result).toMatchObject({ ok: false, body: null, error: "network", attempts: 1 });
    expect(blocked).toEqual([url]);
  });

  it("answers fetchFeed() from UT_FIXTURE_FEEDS before fetch is ever called", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-fixture-feeds-"));
    const url = "https://example.com/ut-sample/saved.xml";
    const saved = process.env.UT_FIXTURE_FEEDS;
    try {
      fs.writeFileSync(path.join(dir, "saved.xml"), "<rss/>");
      fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ [url]: { file: "saved.xml", content_type: "application/xml" } }));
      process.env.UT_FIXTURE_FEEDS = dir;
      let result: Awaited<ReturnType<typeof fetchFeed>> | null = null;
      const blocked = await blockedBy(async () => {
        result = await fetchFeed(url);
      });
      expect(result).toMatchObject({ ok: true, status: 200, contentType: "application/xml", attempts: 1 });
      expect(String((result as unknown as { body: Buffer }).body)).toBe("<rss/>");
      expect(blocked).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.UT_FIXTURE_FEEDS;
      else process.env.UT_FIXTURE_FEEDS = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets fetch reach a server on 127.0.0.1", async () => {
    const server = http.createServer((_req, res) => res.end("local"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe("local");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
    expect(offlineGuard.blocked).toEqual([]);
  });

  it("limits git children to file:// remotes", () => {
    expect(process.env.GIT_ALLOW_PROTOCOL).toBe("file");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ut-offline-"));
    try {
      const r = spawnSync("git", ["ls-remote", "https://github.com/8gara8/UnveilingTracker.git", "refs/heads/main"], {
        cwd: tmp, encoding: "utf8", timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/transport 'https' not allowed/);
      const repo = path.join(tmp, "repo");
      expect(spawnSync("git", ["init", "-q", repo], { encoding: "utf8" }).status).toBe(0);
      const local = spawnSync("git", ["ls-remote", `file://${repo}`], { encoding: "utf8", timeout: 20_000 });
      expect(local.status).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
