// lib/site.ts (SPEC §6 "Content loading", §9.7): the site's name and tagline and its address from config/run.json, the content folder
// from `UT_CONTENT_DIR` or run.json, and `isSampleData()`, which says whether a folder is one of the samples under `fixtures/`. The
// variable is set and restored around each case, run.json is replaced by a module mock where a case needs another address, and
// `isSampleData()` is given a root so that no case depends on where the tests run.
//
// Cyber's tests/site.test.tsx at the fork commit 3ced1fb, adapted: its cases for `siteUrl()`, `contentDir()` and `isSampleData()`
// are the pattern, with this project's variable and its tagline in both languages.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_NAME, SITE_TAGLINE, contentDir, isSampleData, siteUrl } from "@/lib/site";

const RUN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "run.json"), "utf8")) as {
  site: { name: string; tagline: { en: string; zh: string }; url: string };
  paths: { content_dir: string };
};

const VARIABLE = "UT_CONTENT_DIR";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[VARIABLE];
  delete process.env[VARIABLE];
});
afterEach(() => {
  if (saved === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = saved;
  vi.restoreAllMocks();
  vi.doUnmock("@/config/run.json");
  vi.resetModules();
});

/** lib/site.ts loaded again over a run.json whose site block and content folder are the ones given. */
async function siteOver(site: Partial<(typeof RUN)["site"]>, contentFolder = RUN.paths.content_dir): Promise<typeof import("@/lib/site")> {
  vi.resetModules();
  vi.doMock("@/config/run.json", () => ({ default: { ...RUN, site: { ...RUN.site, ...site }, paths: { ...RUN.paths, content_dir: contentFolder } } }));
  return import("@/lib/site");
}

describe("SITE_NAME and SITE_TAGLINE", () => {
  it("are run.json's name and its tagline in both languages", () => {
    expect(SITE_NAME).toBe(RUN.site.name);
    expect(SITE_NAME).toBe("Unveiling Tracker");
    expect(SITE_TAGLINE).toEqual(RUN.site.tagline);
    expect(Object.keys(SITE_TAGLINE).sort()).toEqual(["en", "zh"]);
    expect(SITE_TAGLINE.en).toBe("What AI is helping us discover, explained");
    expect(SITE_TAGLINE.zh.length).toBeGreaterThan(0);
  });

  it("follow run.json, not a value written into the module", async () => {
    const site = await siteOver({ name: "A made-up name", tagline: { en: "A made-up tagline.", zh: "A made-up Chinese tagline." } });
    expect(site.SITE_NAME).toBe("A made-up name");
    expect(site.SITE_TAGLINE).toEqual({ en: "A made-up tagline.", zh: "A made-up Chinese tagline." });
  });
});

describe("siteUrl()", () => {
  it("is run.json's address, which has no trailing slash", () => {
    expect(siteUrl()).toBe(RUN.site.url);
    expect(siteUrl()).toBe("https://unveilingtracker.vercel.app");
  });

  it("removes every trailing slash and nothing else", async () => {
    for (const [written, expected] of [
      ["https://made-up.example", "https://made-up.example"],
      ["https://made-up.example/", "https://made-up.example"],
      ["https://made-up.example///", "https://made-up.example"],
      ["https://made-up.example/a/b/", "https://made-up.example/a/b"],
      ["https://made-up.example/a//b/", "https://made-up.example/a//b"],
      ["http://made-up.example:8080/", "http://made-up.example:8080"],
    ] as const) {
      const site = await siteOver({ url: written });
      expect(site.siteUrl(), written).toBe(expected);
    }
  });

  it("is not moved by any variable", () => {
    const names = ["UT_SITE_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", VARIABLE];
    const before = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      for (const n of names) process.env[n] = "https://other.example";
      expect(siteUrl()).toBe("https://unveilingtracker.vercel.app");
    } finally {
      for (const n of names) {
        if (before[n] === undefined) delete process.env[n];
        else process.env[n] = before[n];
      }
    }
  });
});

describe("contentDir()", () => {
  it("is run.json's folder when the variable is not set", () => {
    expect(contentDir()).toBe(RUN.paths.content_dir);
    expect(contentDir()).toBe("content");
  });

  it("is the variable's value, as written, when it is set", () => {
    for (const value of ["fixtures/site-content", "logs/dry-run/tree", "/tmp/made-up/content", "../elsewhere", "./content/", "a b"]) {
      process.env[VARIABLE] = value;
      expect(contentDir(), value).toBe(value);
    }
  });

  it("is run.json's folder when the variable is empty", () => {
    process.env[VARIABLE] = "";
    expect(contentDir()).toBe("content");
  });

  it("reads the variable at each call, not once", () => {
    expect(contentDir()).toBe("content");
    process.env[VARIABLE] = "fixtures/empty-content";
    expect(contentDir()).toBe("fixtures/empty-content");
    delete process.env[VARIABLE];
    expect(contentDir()).toBe("content");
  });

  it("follows run.json's paths.content_dir, not a value written into the module", async () => {
    const site = await siteOver({}, "made-up-content");
    expect(site.contentDir()).toBe("made-up-content");
    process.env[VARIABLE] = "set-by-the-variable";
    expect(site.contentDir()).toBe("set-by-the-variable");
  });

  it("ignores variables it does not name", () => {
    const before = process.env.CONTENT_DIR;
    process.env.CONTENT_DIR = "fixtures/site-content";
    try {
      expect(contentDir()).toBe("content");
    } finally {
      if (before === undefined) delete process.env.CONTENT_DIR;
      else process.env.CONTENT_DIR = before;
    }
  });
});

describe("isSampleData()", () => {
  const root = path.resolve("/made-up/repo");
  const SAMPLES = ["fixtures/site-content", "fixtures/empty-content", "fixtures/site-content/", "./fixtures/site-content", "fixtures/a/b", "fixtures/a/../b", "fixtures/..odd", "fixtures/...", "fixtures/.hidden"];
  const NOT_SAMPLES = [
    "fixtures", "fixtures/", "./fixtures", "content", "logs/dry-run/tree", "fixtures-other", "fixtures-other/site-content", "fixturesX",
    "fixtures/..", "fixtures/../content", "../fixtures/site-content", "../../fixtures/x", "", ".", "site-content", "src/fixtures/site-content",
  ];

  it.each(SAMPLES)("is true for %s, a folder under fixtures/", (dir) => {
    expect(isSampleData(dir, root)).toBe(true);
  });

  it.each(NOT_SAMPLES)("is false for %j, which is fixtures/ itself or outside it", (dir) => {
    expect(isSampleData(dir, root)).toBe(false);
  });

  it("reads an absolute folder against the root: true inside fixtures/, false anywhere else", () => {
    expect(isSampleData(path.join(root, "fixtures", "site-content"), root)).toBe(true);
    expect(isSampleData(path.join(root, "fixtures"), root)).toBe(false);
    expect(isSampleData(path.join(root, "content"), root)).toBe(false);
    expect(isSampleData("/tmp/ut-copy-1/fixtures/site-content", root)).toBe(false);
    expect(isSampleData("/tmp/ut-copy-1/content", root)).toBe(false);
    expect(isSampleData("/fixtures/site-content", root)).toBe(false);
    expect(isSampleData(path.resolve("/made-up/fixtures/site-content"), root)).toBe(false);
  });

  it("reads a relative folder against the root it is given", () => {
    expect(isSampleData("fixtures/site-content", path.resolve("/another/repo"))).toBe(true);
    expect(isSampleData("fixtures/site-content", path.resolve("/another/repo/"))).toBe(true);
    expect(isSampleData("content", path.resolve("/another/repo"))).toBe(false);
    expect(isSampleData(path.resolve("/another/repo/fixtures/site-content"), root)).toBe(false);
  });

  it("takes the folder from contentDir() and the root from the working folder when they are not given", () => {
    vi.spyOn(process, "cwd").mockReturnValue(root);
    expect(isSampleData()).toBe(false);
    process.env[VARIABLE] = "fixtures/site-content";
    expect(isSampleData()).toBe(true);
    process.env[VARIABLE] = "fixtures";
    expect(isSampleData()).toBe(false);
    process.env[VARIABLE] = path.join(root, "fixtures", "empty-content");
    expect(isSampleData()).toBe(true);
    vi.spyOn(process, "cwd").mockReturnValue(path.resolve("/somewhere/else"));
    expect(isSampleData()).toBe(false);
    process.env[VARIABLE] = "fixtures/empty-content";
    expect(isSampleData()).toBe(true);
    expect(isSampleData("fixtures/empty-content")).toBe(true);
    expect(isSampleData("content")).toBe(false);
  });
});
