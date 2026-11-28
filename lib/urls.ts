// URL and DOI helpers (SPEC §4.1 "URLs" and DOIs, §4.2 BLOCKED_HOSTS with its four entry forms, §4.3 a source's
// `doi`, §4.12 SOURCE_URL and BLOCKED_HOST, §7 `safeHref()`): normalisation for evidence matching and duplicate
// checks, host helpers, the blocked-list matcher and the one function that turns a content URL into a link.
// Pure, and it reads no config file: the allowlist lookups (`isPrimary()` and the rest of §4.11) are
// lib/primary.ts's.
// Cyber's lib/urls.ts at the fork commit 3ced1fb, adapted: `blockedEntry()` also matches the label form of a
// BLOCKED_HOSTS entry (§4.2); `safeHref()` drops its github.com path check, so the file imports no config, and
// `githubPathTier1()` and `TIER1_PATH_FLAGS` go with it (§7); `defang()` is dropped with Cyber's indicator
// rules (§2); a query's parameters sort by code unit, never localeCompare (§4.1); `normalizeUrl()` also drops
// a host's trailing dot and the port 443, which name the same https endpoint; `extractUrls()` ends a URL where
// the next one begins, so a blocked host after a comma or in a query is found; `DOI_RE`, `normalizeDoi()` and
// `doiUrl()` are new, for §4.1's DOI form.

import { byCodeUnit } from "./ids";
import { BLOCKED_HOSTS, blockedForm, type BlockedHost } from "./vocab";

const ARCHIVE_RE = /^(?:https?:\/\/)?(?:www\.)?web\.archive\.org\/web\/[^/]+\/(.+)$/i;
const TRACKING_PARAM_RE = /^(?:utm_.*|fbclid|gclid|mc_cid|mc_eid)$/i;

/** Strips a `web.archive.org/web/<timestamp>/` prefix; returns the URL unchanged (trimmed) otherwise. */
export function stripArchivePrefix(url: string): string {
  const m = ARCHIVE_RE.exec(url.trim());
  if (!m) return url.trim();
  const inner = m[1]!;
  return /^https?:\/\//i.test(inner) ? inner : `https://${inner.replace(/^https?:\/+/i, "")}`;
}

/**
 * Canonical form used to compare URLs: https scheme, lower-case host without `www.` or a trailing dot, no
 * user name or password, no port 443, no fragment, no tracking parameters (`utm_*`, `fbclid`, `gclid`,
 * `mc_cid`, `mc_eid`), the other parameters in code-unit order, upper-case percent escapes, no trailing slash,
 * and any Wayback prefix removed. Input that is not an http(s) URL comes back trimmed but otherwise unchanged.
 */
export function normalizeUrl(url: string): string {
  const raw = stripArchivePrefix(url);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return raw;

  const host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const path = u.pathname.replace(/%[0-9a-f]{2}/gi, (s) => s.toUpperCase()).replace(/\/+$/, "");
  const params = [...u.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM_RE.test(key))
    .sort(([a, av], [b, bv]) => byCodeUnit(a, b) || byCodeUnit(av, bv));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const port = u.port && u.port !== "443" ? `:${u.port}` : "";
  return `https://${host}${port}${path}${query}`;
}

/** True for a well-formed absolute https URL. */
export function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** The lower-case host of a URL, without a trailing dot, or null when it doesn't parse. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/** True when `host` is `domain` or one of its subdomains. */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** An http(s) URL in running text: up to a space, a quote, an angle or closing bracket, or the start of the next URL. */
const URL_IN_TEXT_RE = /https?:\/\/(?:(?!https?:\/\/)[^\s"'<>\\)\]}])+/gi;

/**
 * Every http(s) URL in a block of text, with trailing punctuation trimmed. A URL ends where the next one
 * begins, so a second URL joined to the first by a comma, or written in its query (`?u=https://...`), is read
 * as a URL of its own and checked on its own host, never hidden inside the first one.
 */
export function extractUrls(text: string): string[] {
  const found = text.match(URL_IN_TEXT_RE) ?? [];
  return found.map((u) => u.replace(/[.,;:!?]+$/, ""));
}

// ── DOIs ─────────────────────────────────────────────────────────────────────────────────────────

/** A DOI as §4.1 and §4.3 store it: the `10.` prefix and a suffix without whitespace (lower case is checked apart). */
export const DOI_RE = /^10\.\d{4,9}\/\S+$/;

/** The start of a DOI resolver's URL: any scheme or none, `www.`, and the resolver's old `dx.` host. */
const DOI_RESOLVER_RE = /^(?:https?:\/\/)?(?:www\.)?(?:dx\.)?doi\.org\//i;
/** The text labels in front of a DOI: `doi:` and the OpenURL form `info:doi/`. */
const DOI_LABEL_RE = /^(?:doi:|info:doi\/)\s*/i;

/**
 * A DOI in the form §4.1 stores it: lower case, without `https://doi.org/` (or `http`, `dx.doi.org`, a bare
 * `doi.org/`, a `doi:` or `info:doi/` label), with a resolver URL's query and fragment cut off and its
 * percent escapes decoded (`10.1002%2Fabc` is `10.1002/abc`); null when the result is not `^10\.\d{4,9}/\S+$`.
 * A bare DOI is taken as written, so a `%` or `?` in it stays.
 */
export function normalizeDoi(input: string): string | null {
  const s = input.trim();
  let doi: string;
  const resolver = DOI_RESOLVER_RE.exec(s);
  if (resolver) {
    const path = s.slice(resolver[0].length).replace(/[?#][\s\S]*$/, "");
    try {
      doi = decodeURIComponent(path);
    } catch {
      doi = path;
    }
  } else {
    doi = s.replace(DOI_LABEL_RE, "");
  }
  doi = doi.toLowerCase();
  return DOI_RE.test(doi) ? doi : null;
}

/**
 * The resolver URL of a DOI, `https://doi.org/<doi>` (§5.8's script-added sources, §8.3's fallback for a DOI
 * filter). Takes a DOI in any form `normalizeDoi()` reads, and escapes the three characters a URL would
 * otherwise read as its own syntax (`%`, `?` and `#`), so `normalizeDoi(doiUrl(d))` is `d` again. Throws on
 * input that is no DOI.
 */
export function doiUrl(input: string): string {
  const doi = normalizeDoi(input);
  if (doi === null) throw new Error(`Not a DOI: ${JSON.stringify(input)}`);
  return `https://doi.org/${doi.replace(/[%?#]/g, encodeURIComponent)}`;
}

// ── The blocked list ─────────────────────────────────────────────────────────────────────────────

/**
 * A URL path in the one form every path rule compares (SPEC §4.2): percent-escapes of unreserved
 * characters decoded (RFC 3986 §6.2.2.2), other escapes kept, runs of slashes collapsed, lower-cased. So
 * `/%73earch` and `//search` compare as `/search`.
 */
export function matchPath(pathname: string): string {
  return pathname
    .replace(/%([0-9a-f]{2})/gi, (m: string, hex: string) => {
      const c = String.fromCharCode(parseInt(hex, 16));
      return /[A-Za-z0-9\-._~]/.test(c) ? c : m;
    })
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
}

/**
 * The BLOCKED_HOSTS entry a URL falls under, or null (§4.2, §9.5). By the entry's form (`blockedForm()`): a
 * host entry matches the host and every subdomain; a `host/path` entry matches that host (and its
 * subdomains) and the path prefix, on `matchPath()`; a suffix entry (`.onion`, `.i2p`) matches any host
 * ending so; a label entry (a pattern with no dot, such as `sci-hub`) matches any host with a whole
 * dot-separated label equal to it, so `sci-hub.tw`, `www.sci-hub.tw` and `sci-hub.co.uk` are blocked and
 * `my-sci-hub.org` and `scihub.org` are not. Unparseable URLs are not matched here.
 */
export function blockedEntry(url: string): BlockedHost | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  for (const entry of BLOCKED_HOSTS) {
    const p = entry.pattern.toLowerCase();
    switch (blockedForm(p)) {
      case "suffix":
        if (host.endsWith(p)) return entry;
        break;
      case "label":
        if (labels.includes(p)) return entry;
        break;
      case "path": {
        const slash = p.indexOf("/");
        if (hostMatches(host, p.slice(0, slash)) && matchPath(u.pathname).startsWith(p.slice(slash))) return entry;
        break;
      }
      case "host":
        if (hostMatches(host, p)) return entry;
        break;
    }
  }
  return null;
}

/** The longest URL safeHref() links (§7 "Untrusted text"). */
export const SAFE_HREF_MAX = 2_000;

/**
 * safeHref(url) (§7): the URL as given when `new URL()` parses it, the protocol is `https:`, there is no user
 * name or password, it is at most 2,000 characters and it is not on BLOCKED_HOSTS (`blockedEntry()`, §4.2);
 * else null, and the caller renders plain text. `ExternalLink` (components/ui/) is the only renderer of a
 * content URL and the only caller on the site. Unlike Cyber's it has no github.com path check: this
 * project's `PRIMARY_ONLY` limits github.com sources to two kinds instead (§4.12).
 */
export function safeHref(url: string): string | null {
  if (typeof url !== "string" || url.length === 0 || url.length > SAFE_HREF_MAX) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "") return null;
  if (blockedEntry(url) !== null) return null;
  return url;
}
