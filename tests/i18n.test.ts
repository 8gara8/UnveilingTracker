// lib/i18n.ts (SPEC §4.1, §4.2, §6, §7): the language type, `t()`, the `<html lang>` and Open Graph values,
// `hrefFor()` and the language switch's pairs. New in P1; Cyber has no language layer (docs/PROVENANCE.md).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  HTML_LANG, LANGS, LANGUAGE_NAME, OG_LOCALE, alternateLanguages, hrefFor, langOfPath, languageSwitch, shownLang, t,
  type Bilingual, type L10n, type Lang,
} from "@/lib/i18n";

const root = path.join(__dirname, "..");
const spec = fs.readFileSync(path.join(root, "SPEC.md"), "utf8");

describe("the languages", () => {
  it("are English and Chinese, English first", () => {
    expect([...LANGS]).toEqual(["en", "zh"]);
    expectTypeOf<Lang>().toEqualTypeOf<"en" | "zh">();
  });

  it("have the <html lang> values of SPEC §6: en and zh-Hant-TW", () => {
    expect(HTML_LANG).toEqual({ en: "en", zh: "zh-Hant-TW" });
    expect(spec).toContain("`en`; `zh-Hant-TW`");
  });

  it("have the Open Graph locales of SPEC §6: en_US and zh_TW", () => {
    expect(OG_LOCALE).toEqual({ en: "en_US", zh: "zh_TW" });
    expect(spec).toContain("`locale` (`en_US`, `zh_TW`)");
  });

  it("are named in their own language, as the switch reads English · 中文 (SPEC §7)", () => {
    expect(LANGUAGE_NAME).toEqual({ en: "English", zh: "中文" });
    expect(LANGS.map((l) => LANGUAGE_NAME[l]).join(" · ")).toBe("English · 中文");
  });

  it("give every language a value in each of the three records", () => {
    for (const record of [HTML_LANG, OG_LOCALE, LANGUAGE_NAME]) {
      expect(Object.keys(record)).toEqual([...LANGS]);
      for (const l of LANGS) expect(record[l]).toMatch(/\S/);
    }
  });
});

describe("t() and shownLang()", () => {
  const both: L10n = { en: "Why it matters", zh: "為什麼重要" };
  const englishOnly: L10n = { en: "Why it matters", zh: null };

  it("pick the language asked for when both are there", () => {
    expect(t(both, "en")).toBe("Why it matters");
    expect(t(both, "zh")).toBe("為什麼重要");
    expect(shownLang(both, "en")).toBe("en");
    expect(shownLang(both, "zh")).toBe("zh");
  });

  it("show the English text on a Chinese page when zh is null, and say so", () => {
    expect(t(englishOnly, "zh")).toBe("Why it matters");
    expect(shownLang(englishOnly, "zh")).toBe("en");
    expect(t(englishOnly, "en")).toBe("Why it matters");
    expect(shownLang(englishOnly, "en")).toBe("en");
  });

  it("agree: shownLang() names the language t() returns", () => {
    for (const value of [both, englishOnly]) {
      for (const lang of LANGS) {
        const text = t(value, lang);
        expect(text).toBe(value[shownLang(value, lang)] as string);
      }
    }
  });

  it("take a fixed Bilingual string wherever an L10n is expected", () => {
    const fixed: Bilingual = { en: "Background", zh: "背景" };
    const asL10n: L10n = fixed;
    expect(t(asL10n, "zh")).toBe("背景");
    expect(shownLang(fixed, "zh")).toBe("zh");
    expectTypeOf<Bilingual>().toExtend<L10n>();
    expectTypeOf(t).returns.toEqualTypeOf<string>();
  });
});

describe("langOfPath()", () => {
  it("reads a path under /zh as Chinese and any other as English", () => {
    expect(langOfPath("/")).toBe("en");
    expect(langOfPath("/findings/math-2026-0142")).toBe("en");
    expect(langOfPath("/zh")).toBe("zh");
    expect(langOfPath("/zh/")).toBe("zh");
    expect(langOfPath("/zh/findings/math-2026-0142")).toBe("zh");
    expect(langOfPath("/zh/glossary#virtual-unwrapping")).toBe("zh");
  });

  it("looks at the pathname only, not at the query or the fragment", () => {
    expect(langOfPath("/zh?page=2")).toBe("zh");
    expect(langOfPath("/zh#top")).toBe("zh");
    expect(langOfPath("/?next=/zh/")).toBe("en");
    expect(langOfPath("/glossary#/zh/x")).toBe("en");
  });

  it("does not take a path that merely starts with the letters zh for Chinese", () => {
    expect(langOfPath("/zhang")).toBe("en");
    expect(langOfPath("/zh-extra/x")).toBe("en");
    expect(langOfPath("/findings/zh")).toBe("en");
  });

  it("throws on anything but a site path", () => {
    for (const bad of ["", "findings/x", "zh", "//evil.example/zh", "/\\evil.example", "https://example.org/zh", "/a b", "/a\tb", "/a\nb", "/zh\u0000"]) {
      expect(() => langOfPath(bad), JSON.stringify(bad)).toThrow(/Not a site path/);
    }
  });
});

describe("hrefFor() (SPEC §6)", () => {
  it("maps the two homes to each other", () => {
    expect(hrefFor("zh", "/")).toBe("/zh");
    expect(hrefFor("zh", "/zh")).toBe("/zh");
    expect(hrefFor("zh", "/zh/")).toBe("/zh");
    expect(hrefFor("en", "/")).toBe("/");
    expect(hrefFor("en", "/zh")).toBe("/");
    expect(hrefFor("en", "/zh/")).toBe("/");
  });

  it("maps /findings/x and /zh/findings/x to each other, as SPEC §6 says", () => {
    expect(hrefFor("zh", "/findings/x")).toBe("/zh/findings/x");
    expect(hrefFor("zh", "/zh/findings/x")).toBe("/zh/findings/x");
    expect(hrefFor("en", "/findings/x")).toBe("/findings/x");
    expect(hrefFor("en", "/zh/findings/x")).toBe("/findings/x");
    expect(spec).toContain("(`/findings/x` ↔ `/zh/findings/x`)");
  });

  it("maps every route of SPEC §6 the same way, the feed included", () => {
    for (const page of ["/brief/2026-11-23", "/ledger", "/ledger/field/physics", "/trends", "/glossary", "/didnt-hold-up", "/archive", "/methodology", "/about", "/feed.xml"]) {
      expect(hrefFor("zh", page)).toBe(`/zh${page}`);
      expect(hrefFor("zh", `/zh${page}`)).toBe(`/zh${page}`);
      expect(hrefFor("en", page)).toBe(page);
      expect(hrefFor("en", `/zh${page}`)).toBe(page);
    }
  });

  it("keeps a query and a fragment as written", () => {
    expect(hrefFor("zh", "/glossary#virtual-unwrapping")).toBe("/zh/glossary#virtual-unwrapping");
    expect(hrefFor("en", "/zh/glossary#virtual-unwrapping")).toBe("/glossary#virtual-unwrapping");
    expect(hrefFor("zh", "/ledger/field/physics?page=2#top")).toBe("/zh/ledger/field/physics?page=2#top");
    expect(hrefFor("en", "/zh/ledger/field/physics?page=2#top")).toBe("/ledger/field/physics?page=2#top");
    expect(hrefFor("zh", "/?a=1")).toBe("/zh?a=1");
    expect(hrefFor("zh", "/#top")).toBe("/zh#top");
    expect(hrefFor("en", "/zh?a=1")).toBe("/?a=1");
    expect(hrefFor("en", "/zh#top")).toBe("/#top");
  });

  it("does not take /zhang or a page named zh for the Chinese prefix", () => {
    expect(hrefFor("zh", "/zhang")).toBe("/zh/zhang");
    expect(hrefFor("en", "/zhang")).toBe("/zhang");
    expect(hrefFor("zh", "/findings/zh")).toBe("/zh/findings/zh");
    expect(hrefFor("en", "/zh/zh")).toBe("/zh");
  });

  it("is idempotent and round-trips: either language's path gives the same pair", () => {
    for (const page of ["/", "/findings/math-2026-0142", "/brief/2026-11-23", "/glossary#virtual-unwrapping", "/ledger/field/earth?page=2"]) {
      for (const lang of LANGS) {
        const once = hrefFor(lang, page);
        expect(hrefFor(lang, once)).toBe(once);
        for (const other of LANGS) expect(hrefFor(other, once)).toBe(hrefFor(other, page));
        expect(langOfPath(once)).toBe(lang);
      }
    }
  });

  it("never returns a path a browser would read as another site", () => {
    // What the /zh prefix leaves at the start would be `//host` or `/\host` once it is dropped.
    for (const page of ["/zh//evil.example/x", "/zh///evil.example", "/zh/\\evil.example", "/zh/\\/evil.example"]) {
      for (const lang of LANGS) {
        const href = hrefFor(lang, page);
        expect(href, `${lang} ${page}`).toMatch(/^\/(?![/\\])/);
      }
    }
    expect(hrefFor("en", "/zh//evil.example/x")).toBe("/evil.example/x");
    expect(hrefFor("zh", "/zh//evil.example/x")).toBe("/zh/evil.example/x");
    expect(hrefFor("en", "/zh///evil.example")).toBe("/evil.example");
    expect(hrefFor("en", "/zh/\\evil.example")).toBe("/evil.example");
    expect(hrefFor("en", "/zh/\\/evil.example")).toBe("/evil.example");
  });

  it("throws on a relative path, a URL, //host, a backslash start and whitespace", () => {
    for (const bad of ["", "findings/x", "zh/findings/x", "https://example.org/", "//evil.example/x", "/\\evil.example", "/ x", "/x\ty", "/x\ny", "/x\r", "/x\u007f"]) {
      for (const lang of LANGS) expect(() => hrefFor(lang, bad), `${lang} ${JSON.stringify(bad)}`).toThrow(/Not a site path/);
    }
  });
});

describe("languageSwitch() (SPEC §7)", () => {
  it("lists English then Chinese, with each one's own name", () => {
    expect(languageSwitch("/").map((e) => [e.lang, e.label])).toEqual([["en", "English"], ["zh", "中文"]]);
  });

  it("marks the page's own language and links to the same page in each", () => {
    expect(languageSwitch("/findings/math-2026-0142")).toEqual([
      { lang: "en", label: "English", href: "/findings/math-2026-0142", current: true },
      { lang: "zh", label: "中文", href: "/zh/findings/math-2026-0142", current: false },
    ]);
    expect(languageSwitch("/zh/findings/math-2026-0142")).toEqual([
      { lang: "en", label: "English", href: "/findings/math-2026-0142", current: false },
      { lang: "zh", label: "中文", href: "/zh/findings/math-2026-0142", current: true },
    ]);
  });

  it("pairs the two homes", () => {
    expect(languageSwitch("/").map((e) => e.href)).toEqual(["/", "/zh"]);
    expect(languageSwitch("/zh").map((e) => e.href)).toEqual(["/", "/zh"]);
    expect(languageSwitch("/").map((e) => e.current)).toEqual([true, false]);
    expect(languageSwitch("/zh").map((e) => e.current)).toEqual([false, true]);
  });

  it("marks exactly one language, whatever the page", () => {
    for (const page of ["/", "/zh", "/glossary#a", "/zh/glossary#a", "/zhang", "/zh/zhang"]) {
      expect(languageSwitch(page).filter((e) => e.current)).toHaveLength(1);
      expect(languageSwitch(page).find((e) => e.current)?.lang).toBe(langOfPath(page));
    }
  });

  it("throws on anything but a site path", () => {
    expect(() => languageSwitch("//evil.example")).toThrow(/Not a site path/);
    expect(() => languageSwitch("glossary")).toThrow(/Not a site path/);
  });
});

describe("alternateLanguages() (SPEC §6)", () => {
  it("keys each page's paths by the hreflang values en and zh-Hant-TW", () => {
    expect(alternateLanguages("/findings/x")).toEqual({ en: "/findings/x", "zh-Hant-TW": "/zh/findings/x" });
    expect(alternateLanguages("/zh/findings/x")).toEqual({ en: "/findings/x", "zh-Hant-TW": "/zh/findings/x" });
    expect(alternateLanguages("/")).toEqual({ en: "/", "zh-Hant-TW": "/zh" });
    expect(Object.keys(alternateLanguages("/"))).toEqual([HTML_LANG.en, HTML_LANG.zh]);
    expect(spec).toContain("`alternates.languages` (`en`, `zh-Hant-TW`)");
  });

  it("throws on anything but a site path", () => {
    expect(() => alternateLanguages("https://example.org/")).toThrow(/Not a site path/);
  });
});

describe("the module itself", () => {
  const source = fs.readFileSync(path.join(root, "lib/i18n.ts"), "utf8");

  it("imports nothing at run time, so a client component such as the language switch can use it", () => {
    const runtimeImports = source.split("\n").filter((line) => /^\s*(import|export)\b[^;]*\bfrom\b/.test(line) && !/^\s*(import|export) type\b/.test(line));
    expect(runtimeImports).toEqual([]);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("holds no em-dash (the character is written by its code point, so this file holds none either)", () => {
    expect(source).not.toContain(String.fromCharCode(0x2014));
  });
});
