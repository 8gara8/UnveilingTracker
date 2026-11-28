// Scrubs a feed body that `npm run sources:check` left in cache/check/ into a fixture (SPEC §4.12, §8.10), for Kobol's capture sessions:
//
//   npm exec -- tsx fixtures/src/scrub-feed.ts <kind> <cache file> <fixture file>
//   kind: rss | atom | json | csv | html | gz
//
// `rss` and `atom` are XML of any shape (RSS 2, RDF, Atom, the arXiv API's Atom, PubMed's XML); `json` is an API answer; `csv` is the Retraction Watch
// file; `html` is a saved page; `gz` is a gzip of a JSON or CSV body (RCSB's holdings file). The scrubber keeps the structure, the namespaces, the
// dates, the closed vocabularies (a trial status, a retraction reason, an arXiv category) and the counts, and:
//   - replaces titles, descriptions, abstracts and every other free text with invented SAMPLE text, keeping only the AI phrases the original held
//     (config/ai-terms.json), so the fixture still exercises the phrase matching;
//   - replaces authors, contributors, affiliations and every other name with SAMPLE Author or SAMPLE Institute, and every e-mail address with
//     sample@example.com;
//   - rewrites every DOI to 10.1000/ut-sample-NNNN, every arXiv number to the invented block 99NNN of its month, every trial number to NCT0999NNNN and
//     every PubMed number to 99NNNNNN, one invented id for each original, the same everywhere in the file;
//   - rewrites every link to https://<host>/ut-sample/item-N (a DOI address keeps its invented DOI, an arXiv address becomes the abstract address of its
//     invented number), where <host> is the link's own only when
//     it is a host the registry reads or the primary-source test lists and no blocked or press host, else www.example.com; no other text of the
//     original path survives, so a name in a slug never reaches a fixture;
//   - caps items and rows at 6.
// It refuses (exit 1, nothing written) when an unknown XML namespace stands in the file (the allowed ones are NAMESPACE_PREFIXES, which
// tests/captures.test.ts holds equal to tests/fixture-safety.test.ts's list), when a link in another scheme is left, or when an address is left that
// is not an invented one. Exit 2 is a usage error. The input is untrusted data: nothing in it is followed, fetched or run. Read the output in full
// before committing it. Not part of fixtures:gen (its inputs are Kobol's cache/).
//
// Cyber's fixtures/src/scrub-feed.ts at the fork commit 3ced1fb, adapted: its kinds (the vulnerability feeds, the scoring file, the exchange notices) give way to
// this project's six; the link rewriter, the namespace rule, the refusal and the command line are kept in shape. New here: the id rewriting, the
// CSV and gzip kinds, the PubMed XML, and the AI phrases kept in place of Cyber's registry keywords.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { loadConfig, type LoadedConfig } from "../../lib/config";
import { byCodeUnit } from "../../lib/ids";
import { escapeRegExp } from "../../lib/text";
import { pressHostFor, primaryTest } from "../../lib/primary";
import { blockedEntry, normalizeUrl } from "../../lib/urls";

export const SCRUB_KINDS = ["rss", "atom", "json", "csv", "html", "gz"] as const;
export type ScrubKind = (typeof SCRUB_KINDS)[number];
export const SCRUB_ITEMS_MAX = 6;

/** The scheme of those identifiers, written in two parts so that the builders' source holds no http link (tests/fixture-safety.test.ts). */
const HTTP_SCHEME = `http${":"}//`;

/**
 * The http XML namespace and schema identifiers kept as written: never links a reader follows. Exactly the list tests/fixture-safety.test.ts
 * allows over http (its XML_NAMESPACE_PREFIXES); a capture that declares another namespace is refused until the two lists grow together.
 */
export const NAMESPACE_PREFIXES: readonly string[] = [
  "purl.org/", "www.w3.org/", "prismstandard.org/", "a9.com/-/spec/opensearch/", "arxiv.org/schemas/",
  "webns.net/mvcb/", "wellformedweb.org/CommentAPI/", "search.yahoo.com/mrss/", "www.itunes.com/dtds/podcast-1.0.dtd",
].map((rest) => `${HTTP_SCHEME}${rest}`);
const isNamespace = (u: string): boolean => NAMESPACE_PREFIXES.some((p) => u.startsWith(p));

/** What the scrubber needs from the config: where a link may keep its host, and the AI phrases a text keeps. */
export interface ScrubOptions {
  /** True when a rewritten link may keep this host: not blocked, not a press host, and a host the run reads or the primary-source test lists. */
  keepHost: (candidate: string, host: string) => boolean;
  /** `config/ai-terms.json`'s phrases, kept in an invented text when the original held them. */
  phrases: readonly string[];
}

/** Raised when the output would keep an unsafe address or an unknown namespace; `urls` lists them (data from the input, for the operator). */
export class ScrubRefused extends Error {
  constructor(readonly urls: string[]) {
    super(`scrub-feed refused: ${urls.length} unsafe address(es) would be kept`);
    this.name = "ScrubRefused";
  }
}

/** The host a rewritten link takes when its own may not stay. */
export const SAMPLE_LINK_HOST = "www.example.com";
const URL_RE = /\bhttps?:\/\/[^\s"'<>\\)\]]+/gi;
const OTHER_SCHEME_RE = /\b(?:ftp|ftps|sftp|file|smb|ssh|ws|wss):\/\/[^\s"'<>]*|\b(?:javascript|vbscript|data):[^\s"'<>]+/gi;
const EMAIL_RE = /\b(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SAMPLE_EMAIL = "sample@example.com";
const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>\\&]+/g;
const ARXIV_URL_RE = /^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4})\.(\d{4,5})(v\d+)?(?:\.pdf)?$/i;
const ARXIV_TEXT_RE = /\barXiv:(\d{4})\.(\d{4,5})(v\d+)?/gi;
const NCT_RE = /\bNCT\d{8}\b/g;
/** An ORCID iD, a person's identifier (PubMed's author identifiers, a Crossref or arXiv author record): never kept. */
const ORCID_RE = /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g;
const SAMPLE_ORCID = "0000-0000-0000-0000";
/**
 * True for an address the scrubber itself writes (or that an earlier scrub wrote): a path with the `ut-sample` marker, or the abstract address of an arXiv
 * number in the invented block. A page number that merely begins 99 does not count, since a real article's number can (the shortcut would keep a real page).
 */
export function isInvented(host: string, pathname: string): boolean {
  return pathname.includes("ut-sample") || (host === "arxiv.org" && /^\/abs\/\d{4}\.99\d{3}(?:v\d+)?$/.test(pathname))
    || (host === "clinicaltrials.gov" && /^\/study\/NCT0999\d{4}$/.test(pathname)) || (host === "pubmed.ncbi.nlm.nih.gov" && /^\/99\d{6}\/$/.test(pathname));
}
const SAMPLE_AUTHOR = "SAMPLE Author";
const SAMPLE_INSTITUTE = "SAMPLE Institute";

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const scrubEmails = (s: string): string => s.replace(EMAIL_RE, (m) => (m.startsWith("mailto:") ? `mailto:${SAMPLE_EMAIL}` : SAMPLE_EMAIL));
const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/**
 * One file's invented ids: an original DOI, arXiv number, trial number or PubMed number always gets the same invented one, numbered in the order the
 * file first names it, so two items that cite one paper still do.
 */
export class IdMap {
  private readonly dois = new Map<string, string>();
  private readonly arxiv = new Map<string, string>();
  private readonly trials = new Map<string, string>();
  private readonly pmids = new Map<string, string>();
  private readonly counters = { doi: 0, arxiv: 0, trial: 0, pmid: 0 };

  /** `10.1000/ut-sample-0001`; a DOI is the same DOI in any case, and a trailing full stop or comma of the prose around it is not part of it. */
  doi(raw: string, tag = "ut-sample"): string {
    const key = raw.replace(/[.,;)\]]+$/, "").toLowerCase();
    // An id this scrubber wrote is not an original: it stays, so a scrubbed file scrubs to itself and an address and the text around it agree.
    if (/^10\.1000\/ut-sample(?:-[a-z]+)*-\d{4}$/.test(key)) return key;
    let out = this.dois.get(key);
    if (out === undefined) {
      out = `10.1000/${tag}-${pad(++this.counters.doi, 4)}`;
      this.dois.set(key, out);
    }
    return out;
  }

  /** The month's invented block: `2610.01234v2` becomes `2610.99001v2`. */
  arxivId(yymm: string, num: string): string {
    if (/^99\d{3}$/.test(num)) return `${yymm}.${num}`;
    const key = `${yymm}.${num}`;
    let out = this.arxiv.get(key);
    if (out === undefined) {
      out = `${yymm}.99${pad(++this.counters.arxiv, 3)}`;
      this.arxiv.set(key, out);
    }
    return out;
  }

  trial(raw: string): string {
    if (/^NCT0999\d{4}$/.test(raw)) return raw;
    let out = this.trials.get(raw);
    if (out === undefined) {
      out = `NCT0999${pad(++this.counters.trial, 4)}`;
      this.trials.set(raw, out);
    }
    return out;
  }

  pmid(raw: string): string {
    if (/^99\d{6}$/.test(raw)) return raw;
    let out = this.pmids.get(raw);
    if (out === undefined) {
      out = `99${pad(++this.counters.pmid, 6)}`;
      this.pmids.set(raw, out);
    }
    return out;
  }

  /** Every DOI, arXiv number, trial number and ORCID iD a text names, rewritten (an address is left to the link rewriter, which reads its DOI or arXiv id itself). */
  text(s: string): string {
    return s
      .replace(DOI_RE, (m) => {
        const tail = /[.,;)\]]+$/.exec(m)?.[0] ?? "";
        return this.doi(m) + tail;
      })
      .replace(ARXIV_TEXT_RE, (_m, yymm: string, num: string, v: string | undefined) => `arXiv:${this.arxivId(yymm, num)}${v ?? ""}`)
      .replace(NCT_RE, (m) => this.trial(m))
      .replace(ORCID_RE, SAMPLE_ORCID);
  }
}

/**
 * Rewrites links to https://<host>/ut-sample/item-N, one slug for each original address, unique within the file. The host is the link's own only when
 * `keep` allows it. A DOI address keeps its invented DOI and an arXiv address its invented number (a reader finds the id in the address); an address that
 * already holds an invented marker on a host that may stay is left as it is, so scrubbing a scrubbed file changes nothing.
 */
export class LinkRewriter {
  private readonly byUrl = new Map<string, string>();
  private readonly used = new Set<string>();
  private item = 0;

  constructor(private readonly keep: (candidate: string, host: string) => boolean, private readonly ids: IdMap) {}

  rewrite(raw: string): string {
    const url = raw.replace(/&amp;/g, "&");
    if (isNamespace(url)) return raw;
    // One page, one slug: tracking parameters, a fragment and a leading www do not make another page (lib/urls.ts).
    const key = normalizeUrl(url);
    const known = this.byUrl.get(key);
    if (known !== undefined) return known;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return raw;
    }
    const host = u.hostname.toLowerCase();
    const hostOk = /^[a-z0-9.-]+$/.test(host);
    let out: string;
    const arxiv = ARXIV_URL_RE.exec(url);
    if (isInvented(host, u.pathname) && hostOk && this.keep(url, host)) {
      out = `https://${host}${u.pathname}`;
    } else if (arxiv !== null) {
      out = `https://arxiv.org/abs/${this.ids.arxivId(arxiv[1]!, arxiv[2]!)}${arxiv[3] ?? ""}`;
    } else if (host === "clinicaltrials.gov" && /^\/study\/(NCT\d{8})\/?$/i.test(u.pathname)) {
      out = `https://clinicaltrials.gov/study/${this.ids.trial(/NCT\d{8}/i.exec(u.pathname)![0].toUpperCase())}`;
    } else if (host === "pubmed.ncbi.nlm.nih.gov" && /^\/\d{7,9}\/?$/.test(u.pathname)) {
      out = `https://pubmed.ncbi.nlm.nih.gov/${this.ids.pmid(u.pathname.replaceAll("/", ""))}/`;
    } else if ((host === "doi.org" || host === "dx.doi.org") && /^\/10\.\d{4,9}\//.test(u.pathname)) {
      out = `https://doi.org/${this.ids.doi(decodeURIComponent(u.pathname.slice(1)))}`;
    } else {
      const target = hostOk && this.keep(`https://${host}/ut-sample/item-0`, host) ? host : SAMPLE_LINK_HOST;
      let slug = `item-${++this.item}`;
      while (this.used.has(`${target}/${slug}`)) slug = `item-${++this.item}`;
      this.used.add(`${target}/${slug}`);
      out = `https://${target}/ut-sample/${slug}`;
    }
    this.byUrl.set(key, out);
    return out;
  }

  /** A relative address of an HTML page (`/research/real-title`): its first folder stays, the rest becomes an invented one. */
  relative(raw: string): string {
    if (!raw.startsWith("/") || raw.startsWith("//")) return raw;
    const parts = raw.split(/[?#]/)[0]!.split("/").filter(Boolean);
    if (parts.length === 0) return "/";
    const key = `rel:${raw}`;
    const known = this.byUrl.get(key);
    if (known !== undefined) return known;
    const folder = parts.length > 1 && /^[A-Za-z0-9-]{1,30}$/.test(parts[0]!) ? `/${parts[0]}` : "";
    const out = `${folder}/ut-sample-item-${++this.item}`;
    this.byUrl.set(key, out);
    return out;
  }
}

/** Invented text: "SAMPLE <label> <n>" plus the AI phrases the original held. */
function invented(label: string, n: number, original: string, o: ScrubOptions): string {
  const lower = original.toLowerCase();
  const hits = [...new Set(o.phrases.filter((p) => p !== "" && lower.includes(p.toLowerCase())))].sort(byCodeUnit).slice(0, 3);
  return [`SAMPLE ${label} ${n}`, ...hits].join(" ");
}

/** Every address left in `text` that is unsafe: another scheme, a namespace not on the list, or an address that is not an invented one. */
export function unsafeUrls(text: string, o: Pick<ScrubOptions, "keepHost">): string[] {
  const bad = new Set<string>();
  const decoded = text.replace(/&amp;/g, "&");
  for (const u of decoded.match(URL_RE) ?? []) {
    if (isNamespace(u)) continue;
    let parsed: URL | null = null;
    try {
      parsed = new URL(u);
    } catch {
      bad.add(u);
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    const isExample = host === SAMPLE_LINK_HOST || /(?:^|\.)example\.(?:com|org|net)$/.test(host);
    if (parsed.protocol !== "https:" || blockedEntry(u) !== null) bad.add(u);
    else if (!isExample && !(isInvented(host, parsed.pathname) && o.keepHost(u, host))) bad.add(u);
  }
  for (const u of decoded.match(OTHER_SCHEME_RE) ?? []) bad.add(u);
  return [...bad].sort(byCodeUnit);
}

// ── XML: rss, atom ───────────────────────────────────────────────────────────────────────────────

const ITEM_TAGS = ["item", "entry", "PubmedArticle"] as const;
const FREE_TEXT_TAGS = [
  "title", "description", "summary", "subtitle", "content:encoded", "content", "dc:title", "dc:description", "dc:subject", "dc:rights", "category", "rights", "copyright", "generator",
  "media:title", "media:description", "itunes:summary", "itunes:subtitle",
  "ArticleTitle", "VernacularTitle", "AbstractText", "CopyrightInformation", "CoiStatement", "GeneralNote", "BriefTitle", "OfficialTitle", "Keyword", "arxiv:comment", "arxiv:journal_ref",
] as const;
const PERSON_RE = /<((?:[\w.-]+:)?)(creator|contributor|author|credit|managingEditor|webMaster|LastName|ForeName|CollectiveName|Initials)(\s[^>]*)?>([\s\S]*?)<\/\1\2>/g;
const PERSON_PART_RE = /<((?:[\w.-]+:)?)(name|email|uri)(\s[^>]*)?>[\s\S]*?<\/\1\2>/g;
const AFFILIATION_RE = /<((?:[\w.-]+:)?)(affiliation|Affiliation)(\s[^>]*)?>[\s\S]*?<\/\1\2>/g;
/** Attributes that carry text a reader sees: an Atom link's title, a category's label, an image's alt. */
const TEXT_ATTR_RE = /(\s(?:[\w.-]+:)?(?:title|label|alt)\s*=\s*)(["'])([^"']*)\2/gi;
/** A category's `term` is kept when it has the shape of an arXiv category (`cs.LG`, `astro-ph.CO`, `math.AG`); any other becomes SAMPLE. */
const TERM_ATTR_RE = /(\sterm\s*=\s*)(["'])([^"']*)\2/gi;
const ARXIV_CATEGORY = /^[a-z][a-z-]*(?:\.[A-Za-z-]+)?$/;
const withoutCdata = (s: string): string => s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");

function replaceElements(xml: string, tag: string, label: string, counter: { n: number }, o: ScrubOptions): string {
  const t = tag.replace(":", "\\:");
  const re = new RegExp(`<${t}(\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "g");
  return xml.replace(re, (_m, attrs: string | undefined, inner: string) => {
    counter.n += 1;
    const text = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    return `<${tag}${attrs ?? ""}>${escapeXml(invented(label, counter.n, text, o))}</${tag}>`;
  });
}

/** One XML body: items capped, free text invented, names removed, ids and links rewritten, e-mail removed. Throws `ScrubRefused` for an unknown namespace. */
export function scrubXml(xml: string, o: ScrubOptions): string {
  const ids = new IdMap();
  let out = xml;
  for (const tag of ITEM_TAGS) {
    let kept = 0;
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>\\s*`, "g"), (m) => (++kept <= SCRUB_ITEMS_MAX ? m : ""));
  }
  // RDF lists the items' addresses in the channel: keep the first six there too.
  let li = 0;
  out = out.replace(/<rdf:li\b[^>]*\/>\s*/g, (m) => (++li <= SCRUB_ITEMS_MAX ? m : ""));
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // The pieces of a person first, so a free-text pass does not see a name.
  out = out.replace(AFFILIATION_RE, (_m, p: string, tag: string, attrs: string | undefined) => `<${p}${tag}${attrs ?? ""}>${SAMPLE_INSTITUTE}</${p}${tag}>`);
  out = out.replace(PERSON_RE, (m, p: string, tag: string, attrs: string | undefined, inner: string) => {
    if (/<[A-Za-z]/.test(withoutCdata(inner))) return m;
    const text = tag === "Initials" ? "S" : SAMPLE_AUTHOR;
    return /\S/.test(inner) ? `<${p}${tag}${attrs ?? ""}>${text}</${p}${tag}>` : m;
  });
  out = out.replace(PERSON_PART_RE, (_m, p: string, tag: string, attrs: string | undefined) =>
    `<${p}${tag}${attrs ?? ""}>${tag === "name" ? SAMPLE_AUTHOR : tag === "email" ? SAMPLE_EMAIL : "https://www.example.com/ut-sample/person"}</${p}${tag}>`);
  const counter = { n: 0 };
  for (const tag of FREE_TEXT_TAGS) out = replaceElements(out, tag, /(?:^|:)title$|[a-z]Title$/.test(tag) ? "title" : "text", counter, o);
  out = out.replace(TEXT_ATTR_RE, (m, a: string, q: string, v: string) => (/\S/.test(v) ? `${a}${q}SAMPLE${q}` : m));
  out = out.replace(TERM_ATTR_RE, (m, a: string, q: string, v: string) => (ARXIV_CATEGORY.test(v) || !/\S/.test(v) ? m : `${a}${q}SAMPLE${q}`));
  // PubMed's numbers: <PMID> and the pubmed ArticleId.
  out = out.replace(/(<PMID\b[^>]*>)(\d+)(<\/PMID>)/g, (_m, a: string, n: string, b: string) => `${a}${ids.pmid(n)}${b}`);
  out = out.replace(/(<ArticleId\s+IdType="pubmed">)(\d+)(<\/ArticleId>)/g, (_m, a: string, n: string, b: string) => `${a}${ids.pmid(n)}${b}`);
  out = scrubEmails(out);
  // xmlns values are identifiers: never rewritten, so an unknown one is refused below instead of disguised.
  const ns: string[] = [];
  out = out.replace(/(\sxmlns(?::[\w.-]+)?\s*=\s*)(["'])([^"']*)\2/g, (_m, a: string, q: string, v: string) => {
    ns.push(v);
    return `${a}${q}\u0000${ns.length - 1}\u0000${q}`;
  });
  const unknown = ns.filter((v) => /^https?:\/\//i.test(v) && !isNamespace(v));
  if (unknown.length > 0) throw new ScrubRefused([...new Set(unknown)].sort(byCodeUnit));
  const links = new LinkRewriter(o.keepHost, ids);
  // Addresses first (a DOI or arXiv address is read whole), then the ids that stand in text.
  out = out.replace(URL_RE, (u) => links.rewrite(u));
  out = ids.text(out);
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => ns[Number(i)]!);
}

// ── HTML ─────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

/** A saved page: scripts and styles emptied, text reduced to SAMPLE with its dates, figures and AI phrases, links and relative addresses rewritten. */
export function scrubHtml(html: string, o: ScrubOptions): string {
  const ids = new IdMap();
  let out = html.replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/gi, (_m, tag: string, attrs: string) => `<${tag}${attrs}></${tag}>`);
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  const phrase = o.phrases.length > 0 ? `|${[...o.phrases].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")}` : "";
  const KEEP = new RegExp(`\\b(?:${MONTHS})\\b\\.?|\\d[\\d,.:/-]*${phrase}`, "gi");
  let n = 0;
  out = out.replace(/>([^<]+)</g, (m, text: string) => {
    if (!/\p{L}/u.test(text) || /^\s*SAMPLE\b/.test(text)) return m;
    const kept = text.match(KEEP) ?? [];
    return `>${[`SAMPLE ${++n}`, ...kept].join(" ")}<`;
  });
  out = out.replace(/(\s(?:title|alt|aria-label|content|placeholder)=")([^"]*)(")/gi, (_m, a: string, v: string, b: string) => (/^https?:/i.test(v) ? `${a}${v}${b}` : `${a}SAMPLE${b}`));
  out = scrubEmails(out);
  const links = new LinkRewriter(o.keepHost, ids);
  out = out.replace(/(\s(?:href|src|srcset|data-href)=")(\/[^"]*)(")/gi, (_m, a: string, v: string, b: string) => `${a}${links.relative(v)}${b}`);
  out = out.replace(URL_RE, (u) => links.rewrite(u));
  return ids.text(out);
}

// ── JSON ─────────────────────────────────────────────────────────────────────────────────────────

/** A short string with no spaces (a date, a number, a code, a status word, an ISSN) is kept as written. */
const KEEP_STRING = /^(?:[\d\s:/.,+\-TZ]*|[A-Za-z0-9_.:/*+=()#\-]{1,120})$/;
const PERSON_KEYS = new Set(["author", "authors", "family", "given", "name", "orcid", "creator", "creators", "contributor", "editor", "lastname", "forename", "author_corresponding", "suffix"]);
const INSTITUTION_KEYS = new Set(["affiliation", "affiliations", "institution", "author_corresponding_institution", "sponsor", "leadsponsor"]);
const PMID_KEYS = new Set(["pmid", "uid", "idlist", "uids"]);
/** Keys whose strings are a journal's or publisher's name or a closed vocabulary (an article type, a language), kept as written although they hold spaces. */
const VOCAB_KEYS = new Set(["pubtype", "container-title", "short-container-title", "fulljournalname", "publisher", "type", "subtype", "language", "lang", "source"]);

/** One JSON body: arrays capped, free text invented, names removed, ids and links rewritten. */
export function scrubJson(value: unknown, o: ScrubOptions): unknown {
  const ids = new IdMap();
  const links = new LinkRewriter(o.keepHost, ids);
  const counter = { n: 0 };
  const walk = (v: unknown, key: string, mode: "person" | "institution" | null): unknown => {
    const lower = key.toLowerCase();
    if (Array.isArray(v)) return v.slice(0, SCRUB_ITEMS_MAX).map((x) => walk(x, key, mode));
    if (v !== null && typeof v === "object") {
      const next = PERSON_KEYS.has(lower) ? "person" : INSTITUTION_KEYS.has(lower) ? "institution" : mode;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[/^\d{7,9}$/.test(k) ? ids.pmid(k) : k] = walk(x, k, next);
      return out;
    }
    if (typeof v === "number" && PMID_KEYS.has(lower) && /^\d{7,9}$/.test(String(v))) return Number(ids.pmid(String(v)));
    if (typeof v !== "string") return v;
    if (mode === "person" || (mode === null && PERSON_KEYS.has(lower))) return v.trim() === "" ? v : SAMPLE_AUTHOR;
    if (mode === "institution" || INSTITUTION_KEYS.has(lower)) return v.trim() === "" ? v : SAMPLE_INSTITUTE;
    if (PMID_KEYS.has(lower) && /^\d{7,9}$/.test(v)) return ids.pmid(v);
    if (/^https?:\/\//i.test(v.trim())) return links.rewrite(v.trim());
    const mail = scrubEmails(v);
    if (mail !== v) return /^\s*(?:mailto:)?\S+@\S+\s*$/.test(v) ? mail : invented(key.trim() || "text", ++counter.n, v, o);
    if (KEEP_STRING.test(v.trim()) || VOCAB_KEYS.has(lower)) return ids.text(v);
    return invented(key.trim() || "text", ++counter.n, v, o);
  };
  return walk(value, "", null);
}

// ── CSV (Retraction Watch) ───────────────────────────────────────────────────────────────────────

/** Splits CSV text into records of fields (quoted fields may hold commas, quotes and line breaks). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const csvField = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
/** Columns kept as written: ids, dates and closed vocabularies. */
const CSV_KEEP = new Set(["Record ID", "Subject", "Country", "ArticleType", "RetractionDate", "OriginalPaperDate", "RetractionNature", "Reason", "Paywalled", "Journal", "Publisher"]);
const CSV_DOI = new Set(["RetractionDOI", "OriginalPaperDOI"]);
const CSV_ZERO = new Set(["RetractionPubMedID", "OriginalPaperPubMedID"]);
const CSV_BLANK = new Set(["URLS", "Notes"]);

/** The Retraction Watch file: its header, then at most 6 rows with titles, institutions and authors invented, DOIs rewritten, PubMed numbers zero and notes dropped. */
export function scrubCsv(text: string, o: ScrubOptions): string {
  const rows = parseCsv(text).filter((r) => r.length > 1 || (r[0] ?? "") !== "");
  if (rows.length === 0) return "";
  const [header, ...body] = rows as [string[], ...string[][]];
  const ids = new IdMap();
  let n = 0;
  const lines = body.slice(0, SCRUB_ITEMS_MAX).map((r) => header.map((h, i) => {
    const v = r[i] ?? "";
    if (v === "") return "";
    if (CSV_BLANK.has(h)) return "";
    if (CSV_ZERO.has(h)) return "0";
    if (CSV_DOI.has(h)) return /^10\./.test(v) ? ids.doi(v, "ut-sample-rw") : v;
    if (h === "Author") return SAMPLE_AUTHOR;
    if (h === "Institution") return SAMPLE_INSTITUTE;
    if (CSV_KEEP.has(h)) return v;
    return invented(h === "Title" ? "title" : h.toLowerCase() || "text", ++n, v, o);
  }));
  const body2 = lines.map((cells) => `${cells.map(csvField).join(",")}`);
  return `${[header.map(csvField).join(","), ...body2].join("\n")}\n`;
}

// ── One call ─────────────────────────────────────────────────────────────────────────────────────

/** Scrubs one body. Throws `ScrubRefused` when the output would keep an unsafe address or an unknown namespace. */
export function scrubFeed(kind: ScrubKind, body: Buffer, o: ScrubOptions): Buffer {
  const scrubText = (text: string): string => {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return `${JSON.stringify(scrubJson(JSON.parse(text), o), null, 2)}\n`;
    return scrubCsv(text, o);
  };
  let text: string;
  switch (kind) {
    case "rss": case "atom":
      text = scrubXml(body.toString("utf8"), o);
      break;
    case "html":
      text = scrubHtml(body.toString("utf8"), o);
      break;
    case "json":
      text = `${JSON.stringify(scrubJson(JSON.parse(body.toString("utf8")), o), null, 2)}\n`;
      break;
    case "csv":
      text = scrubCsv(body.toString("utf8"), o);
      break;
    case "gz":
      text = scrubText(gunzipSync(body).toString("utf8"));
      break;
  }
  const bad = unsafeUrls(text, o);
  if (bad.length > 0) throw new ScrubRefused(bad);
  return kind === "gz" ? gzipSync(Buffer.from(text, "utf8"), { level: 9 }) : Buffer.from(text, "utf8");
}

/** The hosts of the registry's own addresses (config/sources.yaml `url` and `fallback_url`), where a rewritten link keeps its host. */
export function registryHosts(cfg: Pick<LoadedConfig, "sources">): Set<string> {
  const out = new Set<string>();
  for (const f of cfg.sources.feeds) {
    for (const u of [f.url, f.fallback_url]) {
      if (typeof u !== "string") continue;
      try {
        out.add(new URL(u).hostname.toLowerCase());
      } catch {
        // A registry address that does not parse adds no host.
      }
    }
  }
  return out;
}

/** The options the command line scrubs with: a host stays when it is not blocked or a press host and the registry reads it or the primary-source test lists its page. */
export function scrubOptionsFor(cfg: LoadedConfig): ScrubOptions {
  const hosts = registryHosts(cfg);
  return {
    phrases: cfg.aiTerms.phrases.map((p) => p.phrase),
    keepHost: (candidate, host) => blockedEntry(candidate) === null && pressHostFor(candidate, cfg) === null && (hosts.has(host) || primaryTest(candidate, cfg).kinds.length > 0),
  };
}

const USAGE = `Usage: npm exec -- tsx fixtures/src/scrub-feed.ts <${SCRUB_KINDS.join(" | ")}> <cache file> <fixture file>`;

/** 0 written, 1 refused (nothing written), 2 usage. */
export function main(
  argv: string[],
  io: { out: (s: string) => void; err: (s: string) => void } = { out: console.log, err: console.error },
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
): number {
  const [kind, from, to] = argv;
  if (argv.length !== 3 || !SCRUB_KINDS.includes(kind as ScrubKind)) {
    io.err(USAGE);
    return 2;
  }
  if (!fs.existsSync(from!)) {
    io.err(`No such cache file: ${from}. ${USAGE}`);
    return 2;
  }
  try {
    const out = scrubFeed(kind as ScrubKind, fs.readFileSync(from!), scrubOptionsFor(loadConfig(path.join(root, "config"))));
    fs.mkdirSync(path.dirname(path.resolve(to!)), { recursive: true });
    fs.writeFileSync(to!, out);
    io.out(`Wrote ${to} (${out.length} bytes). Read it in full before committing it.`);
    return 0;
  } catch (e) {
    if (e instanceof ScrubRefused) {
      io.err(`${e.message}; nothing written. Unsafe addresses (data from the cache file, do not open them):`);
      for (const u of e.urls) io.err(`  ${u}`);
      return 1;
    }
    io.err(`scrub-feed: ${(e as Error).message}`);
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
