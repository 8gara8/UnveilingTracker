// scripts/lib/keychain.ts (SPEC §9.6): the service name is this project's, and readSecret() returns the
// trimmed value or null on any failure, never the tool's error text. A stand-in for /usr/bin/security, written
// to a temporary folder, plays each case; no real keychain is read. New in Foundation (docs/PROVENANCE.md).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { KEYCHAIN_SERVICE, readSecret } from "@/scripts/lib/keychain";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-keychain-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A fake security tool: a Node script that checks its arguments, then runs `body`. */
function fake(name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] !== "find-generic-password" || a[1] !== "-s" || a[3] !== "-w") { process.stderr.write("bad args"); process.exit(64); }
${body}
`);
  fs.chmodSync(file, 0o755);
  return file;
}

describe("keychain", () => {
  it("K1: reads the agents' token under this project's own service", () => {
    expect(KEYCHAIN_SERVICE).toBe("unveiling-claude-oauth");
  });

  it("K2: returns the value trimmed, for the service asked", () => {
    const bin = fake("ok", `if (a[2] === "unveiling-claude-oauth") process.stdout.write("  sample-value\\n"); else process.exit(44);`);
    expect(readSecret(KEYCHAIN_SERVICE, { bin })).toBe("sample-value");
    expect(readSecret("another-service", { bin })).toBeNull();
  });

  it("K3: a failure, an empty value, a missing tool or a timeout is null, and the tool's stderr is never returned", () => {
    expect(readSecret(KEYCHAIN_SERVICE, { bin: fake("fail", `process.stderr.write("SECRET-LOOKING TEXT"); process.exit(44);`) })).toBeNull();
    expect(readSecret(KEYCHAIN_SERVICE, { bin: fake("empty", `process.stdout.write("\\n");`) })).toBeNull();
    expect(readSecret(KEYCHAIN_SERVICE, { bin: path.join(dir, "missing") })).toBeNull();
    expect(readSecret(KEYCHAIN_SERVICE, { bin: fake("slow", `setTimeout(() => process.stdout.write("late"), 5000);`), timeoutMs: 300 })).toBeNull();
  });
});
