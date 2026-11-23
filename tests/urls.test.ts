// lib/urls.ts (SPEC §4.1 "URLs" and DOIs, §4.2 BLOCKED_HOSTS and its four entry forms, §4.3 `doi`, §4.12
// SOURCE_URL, §7 `safeHref()`): normalisation, host helpers, extraction, DOIs, the blocked-list matcher and
// safeHref. Cyber's cases (tests/lib.test.ts at the fork commit 3ced1fb) are adapted; the label form, the DOI
// helpers, the changes to normalizeUrl() (a trailing dot, the port 443, code-unit query order) and extractUrls()
// ending a URL where the next one begins are new.
import { describe, expect, it } from "vitest";
import {
  blockedEntry, doiUrl, DOI_RE, extractUrls, hostMatches, hostOf, isHttpsUrl, matchPath, normalizeDoi, normalizeUrl, SAFE_HREF_MAX,
  safeHref, stripArchivePrefix,
} from "@/lib/urls";
import { BLOCKED_HOSTS, blockedForm, blockedHostEntries } from "@/lib/vocab";

describe("stripArchivePrefix", () => {
  it("removes a Wayback prefix, with or without a scheme or www, and returns the archived URL", () => {
    expect(stripArchivePrefix("https://web.archive.org/web/20260101000000/https://example.org/a")).toBe("https://example.org/a");
    expect(stripArchivePrefix("http://web.archive.org/web/2026id_/http://example.org/a?b=1")).toBe("http://example.org/a?b=1");
    expect(stripArchivePrefix("web.archive.org/web/20260101/example.org/a")).toBe("https://example.org/a");
    expect(stripArchivePrefix("https://www.web.archive.org/web/2026/example.org")).toBe("https://example.org");
    expect(stripArchivePrefix("https://web.archive.org/web/2026/https:/example.org/a")).toBe("https://example.org/a");
  });

  it("returns any other input trimmed and otherwise unchanged", () => {
    expect(stripArchivePrefix("  https://example.org/a  ")).toBe("https://example.org/a");
    expect(stripArchivePrefix("https://example.org/web/2026/a")).toBe("https://example.org/web/2026/a");
    expect(stripArchivePrefix("https://archive.org/details/x")).toBe("https://archive.org/details/x");
    expect(stripArchivePrefix("")).toBe("");
  });
});

describe("normalizeUrl (SPEC §4.1: the form every URL comparison uses)", () => {
  it("upgrades http to https and lower-cases the host, drops www and keeps the path's case", () => {
    expect(normalizeUrl("http://example.org/a")).toBe("https://example.org/a");
    expect(normalizeUrl("https://WWW.Example.ORG/Path/To")).toBe("https://example.org/Path/To");
    expect(normalizeUrl("https://www.nature.com/articles/s41586-024-07487-w")).toBe("https://nature.com/articles/s41586-024-07487-w");
  });

  it("drops trailing slashes, the root's included, and a trailing dot on the host", () => {
    expect(normalizeUrl("https://example.org/a/")).toBe("https://example.org/a");
    expect(normalizeUrl("https://example.org/a//")).toBe("https://example.org/a");
    expect(normalizeUrl("https://example.org/")).toBe("https://example.org");
    expect(normalizeUrl("https://example.org")).toBe("https://example.org");
    expect(normalizeUrl("https://example.org./a")).toBe("https://example.org/a");
    expect(normalizeUrl("https://example.org/?x=1")).toBe("https://example.org?x=1");
  });

  it("drops the default ports and keeps the others", () => {
    expect(normalizeUrl("https://example.org:443/a")).toBe("https://example.org/a");
    expect(normalizeUrl("http://example.org:80/a")).toBe("https://example.org/a");
    expect(normalizeUrl("http://example.org:443/a")).toBe("https://example.org/a");
    expect(normalizeUrl("https://example.org:8443/a")).toBe("https://example.org:8443/a");
    expect(normalizeUrl("http://example.org:8080/a")).toBe("https://example.org:8080/a");
  });

  it("drops fragments and user information", () => {
    expect(normalizeUrl("https://example.org/a#section-2")).toBe("https://example.org/a");
    expect(normalizeUrl("https://example.org/a?b=1#c")).toBe("https://example.org/a?b=1");
    expect(normalizeUrl("https://user:secret@example.org/a")).toBe("https://example.org/a");
    expect(normalizeUrl("https://user@example.org/a")).toBe("https://example.org/a");
  });

  it("drops tracking parameters whatever their case and keeps the rest", () => {
    expect(normalizeUrl("https://example.org/a?utm_source=x&utm_medium=y&id=7&fbclid=abc&gclid=1&mc_cid=2&mc_eid=3")).toBe("https://example.org/a?id=7");
    expect(normalizeUrl("https://example.org/a?UTM_Campaign=x&Id=7")).toBe("https://example.org/a?Id=7");
    expect(normalizeUrl("https://example.org/a?utm_source=x")).toBe("https://example.org/a");
    expect(normalizeUrl("https://example.org/a?utmx=1&gclid2=2")).toBe("https://example.org/a?gclid2=2&utmx=1");
  });

  it("sorts the query by code unit, key then value, so the order a link was written in never matters", () => {
    expect(normalizeUrl("https://example.org/a?b=2&a=1&a=0")).toBe("https://example.org/a?a=0&a=1&b=2");
    expect(normalizeUrl("https://example.org/a?a=2&B=1")).toBe("https://example.org/a?B=1&a=2");
    expect(normalizeUrl("https://example.org/a?q=a%20b")).toBe(normalizeUrl("https://example.org/a?q=a+b"));
  });

  it("writes percent escapes in upper case and the host of an international name as punycode", () => {
    expect(normalizeUrl("https://example.org/caf%c3%a9")).toBe("https://example.org/caf%C3%A9");
    expect(normalizeUrl("https://Bücher.example/a")).toBe("https://xn--bcher-kva.example/a");
  });

  it("removes a Wayback prefix before it does the rest", () => {
    expect(normalizeUrl("https://web.archive.org/web/20260101000000/http://www.example.org/a/?utm_source=x#top")).toBe("https://example.org/a");
  });

  it("returns what is not an http(s) URL trimmed and unchanged", () => {
    expect(normalizeUrl("  not a url ")).toBe("not a url");
    expect(normalizeUrl("mailto:someone@example.org")).toBe("mailto:someone@example.org");
    expect(normalizeUrl("ftp://example.org/a/")).toBe("ftp://example.org/a/");
    expect(normalizeUrl("javascript:void(0)")).toBe("javascript:void(0)");
    expect(normalizeUrl("")).toBe("");
  });

  it("gives one string for every way of writing the same page, and is idempotent", () => {
    const forms = [
      "https://example.org/a/b?x=1&y=2",
      "http://www.example.org/a/b/?y=2&x=1",
      "HTTPS://EXAMPLE.ORG:443/a/b?utm_source=feed&y=2&x=1#top",
      "https://user:pw@example.org./a/b?y=2&x=1&fbclid=z",
      "https://web.archive.org/web/20260101/https://example.org/a/b?x=1&y=2",
    ];
    const normal = forms.map(normalizeUrl);
    expect(new Set(normal).size).toBe(1);
    expect(normal[0]).toBe("https://example.org/a/b?x=1&y=2");
    for (const form of [...forms, "https://example.org/caf%c3%a9/", "not a url", "mailto:a@b.org", "https://Bücher.example/"]) {
      expect(normalizeUrl(normalizeUrl(form)), form).toBe(normalizeUrl(form));
    }
  });
});

describe("isHttpsUrl, hostOf and hostMatches", () => {
  it("isHttpsUrl accepts an absolute https URL with a dotted host only", () => {
    expect(isHttpsUrl("https://example.org")).toBe(true);
    expect(isHttpsUrl("https://example.org/a?b=c#d")).toBe(true);
    for (const bad of ["http://example.org", "https://localhost", "example.org", "", "https://", "javascript:alert(1)", "https://exa mple.org", "ftp://example.org"]) {
      expect(isHttpsUrl(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("hostOf is the lower-case host without a trailing dot, or null", () => {
    expect(hostOf("https://WWW.Example.org:8443/a")).toBe("www.example.org");
    expect(hostOf("https://example.org./a")).toBe("example.org");
    expect(hostOf("http://127.0.0.1:3000/")).toBe("127.0.0.1");
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf("")).toBeNull();
  });

  it("hostMatches is the domain or a subdomain of it, never a longer name or a suffix trick", () => {
    expect(hostMatches("nature.com", "nature.com")).toBe(true);
    expect(hostMatches("www.nature.com", "nature.com")).toBe(true);
    expect(hostMatches("a.b.nature.com", "nature.com")).toBe(true);
    expect(hostMatches("WWW.Nature.COM", "nature.com")).toBe(true);
    expect(hostMatches("notnature.com", "nature.com")).toBe(false);
    expect(hostMatches("nature.com.evil.org", "nature.com")).toBe(false);
    expect(hostMatches("com", "nature.com")).toBe(false);
  });
});

describe("extractUrls", () => {
  it("reads the URLs of a prose line and trims the punctuation that follows them", () => {
    expect(extractUrls("See https://a.example/x, and (https://b.example/y). Also \"https://c.example/z?q=1&r=2\"; then https://d.example/w! Done."))
      .toEqual(["https://a.example/x", "https://b.example/y", "https://c.example/z?q=1&r=2", "https://d.example/w"]);
    expect(extractUrls("Is it https://a.example/x? Yes: https://a.example/y; or https://a.example/z:")).toEqual(
      ["https://a.example/x", "https://a.example/y", "https://a.example/z"],
    );
  });

  it("stops a URL at a closing bracket, an angle bracket, a quote or a space, so Markdown and HTML links read whole", () => {
    expect(extractUrls("[the paper](https://a.example/p) and <https://a.example/q> and [https://a.example/r] and {https://a.example/s}"))
      .toEqual(["https://a.example/p", "https://a.example/q", "https://a.example/r", "https://a.example/s"]);
    expect(extractUrls('<a href="https://a.example/h">link</a> and \'https://a.example/i\'')).toEqual(["https://a.example/h", "https://a.example/i"]);
  });

  it("keeps a query's and a fragment's own punctuation, reads either scheme in any case and ignores other schemes", () => {
    expect(extractUrls("http://a.example/p?x=1&y=a.b#frag-1.")).toEqual(["http://a.example/p?x=1&y=a.b#frag-1"]);
    expect(extractUrls("HTTPS://A.EXAMPLE/X and ftp://a.example/y and a.example/z")).toEqual(["HTTPS://A.EXAMPLE/X"]);
    expect(extractUrls("one\nhttps://a.example/1\ntwo\thttps://a.example/2")).toEqual(["https://a.example/1", "https://a.example/2"]);
  });

  it("ends a URL where the next one begins, so a second URL joined by a comma or written in a query is read on its own", () => {
    expect(extractUrls("https://a.example/x,https://b.example/y;http://c.example/z")).toEqual(["https://a.example/x", "https://b.example/y", "http://c.example/z"]);
    expect(extractUrls("https://a.example/go?u=https://b.example/y&v=1")).toEqual(["https://a.example/go?u=", "https://b.example/y&v=1"]);
    expect(extractUrls("https://https://a.example/x")).toEqual(["https://a.example/x"]);
    expect(extractUrls("https://web.archive.org/web/2026/https://example.org/a")).toEqual(["https://web.archive.org/web/2026/", "https://example.org/a"]);
  });

  it("lets blockedEntry() see a blocked host that follows a harmless URL without a space", () => {
    const urls = extractUrls("See https://a.example/x,https://sci-hub.se/10.1234/abc and https://a.example/go?next=https://pastebin.com/raw.");
    expect(urls.map((u) => blockedEntry(u)?.reason ?? null)).toEqual([null, "shadow_library", null, "paste"]);
  });

  it("returns an empty list when the text holds none", () => {
    expect(extractUrls("")).toEqual([]);
    expect(extractUrls("no links here, only example.org and https:// alone")).toEqual([]);
  });
});

describe("matchPath (SPEC §4.2: the one form every path rule compares)", () => {
  it("decodes the escapes of unreserved characters, collapses slashes and lower-cases", () => {
    expect(matchPath("/%73earch")).toBe("/search");
    expect(matchPath("//search")).toBe("/search");
    expect(matchPath("/a///b")).toBe("/a/b");
    expect(matchPath("/Search")).toBe("/search");
    expect(matchPath("/%7Euser")).toBe("/~user");
    expect(matchPath("/%41b%2d%2E_")).toBe("/ab-._");
  });

  it("keeps the escapes of reserved and other characters, in lower case", () => {
    expect(matchPath("/a%2Fb")).toBe("/a%2fb");
    expect(matchPath("/caf%C3%A9")).toBe("/caf%c3%a9");
    expect(matchPath("/a%20b")).toBe("/a%20b");
    expect(matchPath("")).toBe("");
  });
});

describe("DOIs (SPEC §4.1: lower case, stored without https://doi.org/)", () => {
  it("DOI_RE is a 10. prefix with 4 to 9 digits, a slash and a suffix without whitespace", () => {
    for (const ok of ["10.1038/s41586-024-07487-w", "10.1234/a", "10.123456789/x", "10.1002/(sici)1097-0258(19980430)17:8<873::aid-sim779>3.0.co;2-i"]) {
      expect(DOI_RE.test(ok), ok).toBe(true);
    }
    for (const bad of ["", "10.123/x", "10.1234567890/x", "10.1234/", "10.1234/a b", "11.1234/x", " 10.1234/x", "doi:10.1234/x", "10.1234x/y"]) {
      expect(DOI_RE.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("normalizeDoi reads a bare DOI and lower-cases it", () => {
    expect(normalizeDoi("10.1038/S41586-024-07487-W")).toBe("10.1038/s41586-024-07487-w");
    expect(normalizeDoi("  10.1038/x  ")).toBe("10.1038/x");
    expect(normalizeDoi("10.1234/ab?c%d")).toBe("10.1234/ab?c%d");
  });

  it("normalizeDoi strips a resolver URL in any of its forms, a query and a fragment", () => {
    const want = "10.1038/s41586-024-07487-w";
    for (const form of [
      "https://doi.org/10.1038/s41586-024-07487-w",
      "http://doi.org/10.1038/S41586-024-07487-W",
      "https://dx.doi.org/10.1038/s41586-024-07487-w",
      "http://dx.doi.org/10.1038/s41586-024-07487-w",
      "doi.org/10.1038/s41586-024-07487-w",
      "HTTPS://DOI.ORG/10.1038/s41586-024-07487-w",
      "https://www.doi.org/10.1038/s41586-024-07487-w",
      " https://doi.org/10.1038/s41586-024-07487-w?utm_source=feed#abstract ",
      "https://doi.org/10.1038/s41586-024-07487-w#sec1",
    ]) {
      expect(normalizeDoi(form), form).toBe(want);
    }
  });

  it("normalizeDoi strips the labels doi: and info:doi/, with or without a space after them", () => {
    expect(normalizeDoi("doi:10.1038/x")).toBe("10.1038/x");
    expect(normalizeDoi("DOI: 10.1038/X")).toBe("10.1038/x");
    expect(normalizeDoi("info:doi/10.1038/x")).toBe("10.1038/x");
  });

  it("normalizeDoi decodes the percent escapes of a resolver URL, as the resolver does, and leaves a bad escape as it is", () => {
    expect(normalizeDoi("https://doi.org/10.1002%2Fanie.201234")).toBe("10.1002/anie.201234");
    expect(normalizeDoi("https://doi.org/10.1002/%28SICI%291097-0258%2819980430%2917:8%3C873::AID-SIM779%3E3.0.CO;2-I"))
      .toBe("10.1002/(sici)1097-0258(19980430)17:8<873::aid-sim779>3.0.co;2-i");
    expect(normalizeDoi("https://doi.org/10.1234/x%zz")).toBe("10.1234/x%zz");
  });

  it("normalizeDoi returns null for anything that is not a DOI, a page of a publisher included", () => {
    for (const bad of [
      "", "   ", "doi:", "10.12/abc", "10.1234567890/x", "10.1234/", "10.1234/a b", "11.1234/x", "https://doi.org/", "https://doi.org/not-a-doi",
      "https://example.org/10.1234/x", "https://www.nature.com/articles/s41586-024-07487-w", "arXiv:2501.01234",
    ]) {
      expect(normalizeDoi(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("doiUrl is https://doi.org/ and the lower-case DOI, from a DOI in any form", () => {
    expect(doiUrl("10.1038/S41586-024-07487-W")).toBe("https://doi.org/10.1038/s41586-024-07487-w");
    expect(doiUrl("doi:10.1038/x")).toBe("https://doi.org/10.1038/x");
    expect(doiUrl("http://dx.doi.org/10.1038/x#a")).toBe("https://doi.org/10.1038/x");
  });

  it("doiUrl escapes the three characters a URL would read as its own syntax, so the DOI comes back out of it", () => {
    expect(doiUrl("10.1234/a#b?c%d")).toBe("https://doi.org/10.1234/a%23b%3Fc%25d");
    for (const doi of ["10.1234/a#b", "10.1234/a?b", "10.1234/50%25", "10.1234/(x)<y>", "10.1002/(sici)1097-0258(19980430)17:8<873::aid-sim779>3.0.co;2-i", "10.1038/plain"]) {
      expect(normalizeDoi(doiUrl(doi)), doi).toBe(doi);
      expect(new URL(doiUrl(doi)).hash, doi).toBe("");
      expect(new URL(doiUrl(doi)).search, doi).toBe("");
    }
  });

  it("doiUrl throws on input that is no DOI", () => {
    for (const bad of ["", "arXiv:2501.01234", "https://example.org/x", "10.1/x"]) expect(() => doiUrl(bad), bad).toThrow("Not a DOI");
  });
});

describe("blockedEntry (SPEC §4.2, §9.5: host, host/path, suffix and label entries)", () => {
  it("blocks a host entry's host and every subdomain, and no longer name", () => {
    expect(blockedEntry("https://pastebin.com/abc")).toEqual({ pattern: "pastebin.com", reason: "paste" });
    expect(blockedEntry("https://www.pastebin.com/abc")?.reason).toBe("paste");
    expect(blockedEntry("http://a.b.pastebin.com:8080/x?y=1#z")?.reason).toBe("paste");
    expect(blockedEntry("https://gist.github.com/someone/1")?.reason).toBe("paste");
    expect(blockedEntry("https://t.me/channel")?.reason).toBe("messaging");
    expect(blockedEntry("https://bit.ly/3abc")?.reason).toBe("shortener");
    expect(blockedEntry("https://archive.org/details/x")?.reason).toBe("archive");
    expect(blockedEntry("https://ransomware.live/x")?.reason).toBe("leak_site");
    expect(blockedEntry("https://notpastebin.com/abc")).toBeNull();
    expect(blockedEntry("https://pastebin.com.evil.example/abc")).toBeNull();
    expect(blockedEntry("https://example.org/pastebin.com")).toBeNull();
    expect(blockedEntry("https://github.com/someone/repo")).toBeNull();
  });

  it("blocks a host/path entry on its host (and subdomains) and the path prefix, on matchPath()", () => {
    expect(blockedEntry("https://www.google.com/url?q=https://example.org")).toEqual({ pattern: "google.com/url", reason: "redirect" });
    expect(blockedEntry("https://google.com/%75rl?q=x")?.reason).toBe("redirect");
    expect(blockedEntry("https://google.com//url?q=x")?.reason).toBe("redirect");
    expect(blockedEntry("https://GOOGLE.com/URL?q=x")?.reason).toBe("redirect");
    expect(blockedEntry("https://shodan.io/search?query=x")?.reason).toBe("scan_query");
    expect(blockedEntry("https://www.shodan.io/search/facet")?.reason).toBe("scan_query");
    expect(blockedEntry("https://google.com/search?q=x")).toBeNull();
    expect(blockedEntry("https://shodan.io/host/1.2.3.4")).toBeNull();
    expect(blockedEntry("https://example.org/url")).toBeNull();
  });

  it("blocks a suffix entry's hosts: .onion and .i2p", () => {
    expect(blockedEntry("http://abcdefghijklmnop.onion/x")).toEqual({ pattern: ".onion", reason: "leak_site" });
    expect(blockedEntry("https://www.example.i2p/")?.reason).toBe("leak_site");
    expect(blockedEntry("https://onion.example.org/")).toBeNull();
    expect(blockedEntry("https://example.org/page.onion")).toBeNull();
  });

  it("blocks a label entry's hosts: any host with a whole label equal to sci-hub, libgen, z-lib, z-library or annas-archive", () => {
    for (const blocked of [
      "https://sci-hub.tw/10.1234/abc", "https://www.sci-hub.tw/10.1234/abc", "https://sci-hub.co.uk/x", "https://sci-hub/x",
      "https://mirror.sci-hub.example.org/x", "https://libgen.rocks/x", "https://www.libgen.example/x", "https://z-lib.id/x",
      "https://z-library.example/x", "https://annas-archive.gs/x", "https://www.annas-archive.org/x", "http://sci-hub.tw:8080/x",
      "https://sci-hub.tw./x",
    ]) {
      expect(blockedEntry(blocked)?.reason, blocked).toBe("shadow_library");
    }
    for (const allowed of [
      "https://my-sci-hub.org/x", "https://scihub.org/x", "https://sci-hub-mirror.org/x", "https://libgenesis.org/x", "https://notlibgen.com/x",
      "https://zlib.example/x", "https://annas.archive.example/x", "https://example.org/sci-hub", "https://example.org/?q=sci-hub.tw",
    ]) {
      expect(blockedEntry(allowed), allowed).toBeNull();
    }
  });

  it("returns the listed host entry for a listed mirror, and the label entry for one the list lacks", () => {
    expect(blockedEntry("https://sci-hub.se/x")).toEqual({ pattern: "sci-hub.se", reason: "shadow_library" });
    expect(blockedEntry("https://www.libgen.is/x")).toEqual({ pattern: "libgen.is", reason: "shadow_library" });
    expect(blockedEntry("https://sci-hub.tw/x")).toEqual({ pattern: "sci-hub", reason: "shadow_library" });
  });

  it("sees through a trailing dot on the host, which names the same site, in every form", () => {
    expect(blockedEntry("https://pastebin.com./abc")?.reason).toBe("paste");
    expect(blockedEntry("https://www.pastebin.com./abc")?.reason).toBe("paste");
    expect(blockedEntry("https://google.com./url?q=x")?.reason).toBe("redirect");
    expect(blockedEntry("http://abcdefghijklmnop.onion./x")?.reason).toBe("leak_site");
    expect(blockedEntry("https://sci-hub.tw./x")?.reason).toBe("shadow_library");
    expect(blockedEntry("https://example.org./pastebin.com")).toBeNull();
  });

  it("reads the host the way a browser does: the user information and the port are not part of it", () => {
    expect(blockedEntry("https://sci-hub.se@example.org/x")).toBeNull();
    expect(blockedEntry("https://example.org@sci-hub.se/x")?.reason).toBe("shadow_library");
    expect(blockedEntry("https://example.org:pw@pastebin.com/x")?.reason).toBe("paste");
    expect(blockedEntry("https://127.0.0.1/x")).toBeNull();
  });

  it("matches nothing in input that is not a URL", () => {
    for (const bad of ["", "not a url", "pastebin.com/abc", "sci-hub.tw"]) expect(blockedEntry(bad), JSON.stringify(bad)).toBeNull();
  });

  it("blocks a URL built from every entry of BLOCKED_HOSTS, in each of its forms", () => {
    expect(BLOCKED_HOSTS.length).toBeGreaterThan(40);
    for (const entry of BLOCKED_HOSTS) {
      const p = entry.pattern;
      const urls: string[] = [];
      switch (blockedForm(p)) {
        case "host":
          urls.push(`https://${p}/x`, `https://www.${p}/x`, `http://sub.${p}:8080/x?y=1#z`);
          break;
        case "path": {
          const slash = p.indexOf("/");
          urls.push(`https://${p}?q=1`, `https://www.${p.slice(0, slash)}${p.slice(slash)}/more`);
          break;
        }
        case "suffix":
          urls.push(`https://abcdefghijklmnop${p}/x`, `http://a.b${p}:8080/`);
          break;
        case "label":
          urls.push(`https://${p}.example/x`, `https://www.${p}.example.org/x`, `https://mirror.${p}.tw/x`, `https://${p}/x`);
          break;
      }
      expect(urls.length, p).toBeGreaterThan(0);
      for (const url of urls) expect(blockedEntry(url), `${p}: ${url}`).not.toBeNull();
      // The pattern in a path, a query or the user information of another host blocks nothing.
      if (blockedForm(p) !== "path") {
        expect(blockedEntry(`https://example.org/${p}`), `${p} as a path`).toBeNull();
        expect(blockedEntry(`https://example.org/?q=${p}`), `${p} as a query`).toBeNull();
        expect(blockedEntry(`https://${p}@example.org/`), `${p} as user information`).toBeNull();
      }
    }
  });

  it("agrees with blockedHostEntries(): each plain host blocks itself and none of the other forms is listed there", () => {
    const hosts = blockedHostEntries();
    expect(hosts.length).toBeGreaterThan(30);
    for (const host of hosts) {
      expect(blockedForm(host), host).toBe("host");
      expect(blockedEntry(`https://${host}/`)?.pattern, host).toBe(host);
    }
    expect(hosts).not.toContain("sci-hub");
    expect(hosts).not.toContain(".onion");
    expect(hosts).not.toContain("google.com/url");
  });
});

describe("safeHref (SPEC §7: the one function that turns a content URL into a link)", () => {
  it("returns an https URL as it was given, query, fragment and case included", () => {
    for (const url of [
      "https://example.org/a",
      "https://example.org/a?b=c#d",
      "HTTPS://Example.ORG/Path",
      "https://www.nature.com/articles/s41586-024-07487-w",
      "https://doi.org/10.1038/s41586-024-07487-w",
      "https://example.org:8443/a",
    ]) {
      expect(safeHref(url), url).toBe(url);
    }
  });

  it("rejects a script, data or file URL in any case, with or without a leading space or control character", () => {
    for (const bad of [
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "\tjavascript:alert(1)", "java\nscript:alert(1)",
      "data:text/html,<b>x</b>", "data:text/html;base64,PGI+eDwvYj4=", "vbscript:msgbox(1)", "file:///etc/passwd", "blob:https://example.org/uuid",
    ]) {
      expect(safeHref(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rejects every scheme but https, and anything that is not an absolute URL", () => {
    for (const bad of ["http://example.org/a", "ftp://example.org/a", "mailto:someone@example.org", "//example.org/a", "/relative/path", "example.org", "", " ", "https://", "not a url"]) {
      expect(safeHref(bad), JSON.stringify(bad)).toBeNull();
    }
    for (const notText of [undefined, null, 42, {}]) expect(safeHref(notText as unknown as string)).toBeNull();
  });

  it("rejects a user name or a password", () => {
    for (const bad of ["https://user@example.org/", "https://user:pw@example.org/", "https://:pw@example.org/", "https://example.org@evil.example/"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });

  it("rejects a URL of more than 2,000 characters and accepts one of exactly that length", () => {
    expect(SAFE_HREF_MAX).toBe(2000);
    const base = "https://example.org/";
    expect(safeHref(base + "a".repeat(SAFE_HREF_MAX - base.length))).toHaveLength(SAFE_HREF_MAX);
    expect(safeHref(base + "a".repeat(SAFE_HREF_MAX - base.length + 1))).toBeNull();
  });

  it("rejects a URL on BLOCKED_HOSTS: a pasting site, a redirect wrapper, an archive, a shadow library and its mirrors", () => {
    for (const bad of [
      "https://pastebin.com/abc", "https://www.google.com/url?q=https://example.org", "https://web.archive.org/web/2026/https://example.org",
      "https://archive.org/details/x", "https://sci-hub.se/10.1234/abc", "https://sci-hub.tw/10.1234/abc", "https://www.sci-hub.co.uk/x",
      "https://libgen.rocks/x", "https://t.co/abc", "https://x.onion/",
    ]) {
      expect(safeHref(bad), bad).toBeNull();
    }
    expect(safeHref("https://my-sci-hub.org/x")).toBe("https://my-sci-hub.org/x");
    expect(safeHref("https://scihub.org/x")).toBe("https://scihub.org/x");
  });

  it("rejects the URL built from every entry of BLOCKED_HOSTS", () => {
    for (const entry of BLOCKED_HOSTS) {
      const p = entry.pattern;
      const form = blockedForm(p);
      const url = form === "suffix" ? `https://abcdefghijklmnop${p}/x` : form === "label" ? `https://www.${p}.example/x` : `https://www.${p}${form === "path" ? "" : "/x"}`;
      expect(safeHref(url), url).toBeNull();
    }
  });
});
