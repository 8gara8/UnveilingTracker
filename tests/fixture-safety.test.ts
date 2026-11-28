// Fixture safety for the folders P1 and P2 build (SPEC §0.2, §4.12 "Fixtures"; AGENTS rules 8, 10, 11 and 15): real formats, invented prose, and
// nothing a reader could use, be harmed by, or that names a real person (the repo is public). Over every file of fixtures/{context,drafts,
// drafts-zh,empty-content,evidence,feeds,injection,metrics,packs,site-content,state}/, JSON read as its keys and string values, any other file whole:
//   - links: https, no user info, port, IP address or internationalised host, on no blocked and no press host, and on a host the run reads or
//     allows (a primary or figure host, a reserved example domain, this site, a host config/sources.yaml names); a real host's page is an invented one.
//     The one http address allowed is an XML namespace in a saved feed (fixtures/feeds/**/*.xml), by the prefixes listed below;
//   - no e-mail address but a reserved example one, and no machine path;
//   - people: a reaction's speaker and every named person is an invented placeholder marked SAMPLE; no actor of a negative event (a setback, a
//     retraction, a dispute) is a real organisation the config lists (F-28);
//   - no model identifier, credential-shaped string, run of sequence letters, agent-with-method sentence, numbered steps (DUAL_USE's own detectors),
//     attack-code pattern, invisible character or raw HTML tag (the saved pages and feeds of fixtures/feeds/ are markup on purpose, so this one check
//     skips them: fixtures/feeds/pages/*.html and fixtures/feeds/**/*.xml, with invented prose);
//   - the canary's token and address stand in the planted files and the CANARY negatives only, in the planted forms;
//   - no file over 1 MB, the whole under 6 MB, and every file read: a folder or kind of file this test does not list fails.
// The negative fixtures plant what a rule refuses, so each check names the files that may hold its plant and a test proves that list exact. The
// checks are functions, run on the fixtures and on planted bad samples, so a check that stops catching what it looks for fails too. Not tested,
// because no check can read it: a real name in prose. Cyber's test of the same name (fork commit 3ced1fb) is the pattern; its feed, zip and CVE checks are not this project's.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { primaryTest, pressHostFor } from "@/lib/primary";
import { blockedUrlsIn, compileDualUse, dualUseForms, pairsIn, secretsIn, sequencesIn, stepMarkersIn, STEPS_MIN, type DualUseForms } from "@/lib/rules/safety";
import { INVISIBLE } from "@/lib/sanitize";
import { blockedEntry, extractUrls, hostMatches, hostOf, normalizeUrl } from "@/lib/urls";
import { BLOCKED_HOSTS, CANARY_TOKEN, CANARY_URL_MARK, CANARY_URL_PREFIX } from "@/lib/vocab";
import { escapeRegExp } from "@/lib/text";
import { MODEL_SAMPLES, modelRe } from "./helpers/model-names";

const ROOT = path.join(__dirname, "..");
const config = loadConfig(path.join(ROOT, "config"));
const MB = 1024 * 1024;

/** The fixture folders each scanned: P1's, and P2's `feeds` (the saved pages and feed captures; P2 adds the checks they need below). */
const FAMILIES = ["context", "drafts", "drafts-zh", "empty-content", "evidence", "feeds", "injection", "metrics", "packs", "site-content", "state"];
/** The builders' source code: not a fixture, so it is read only for its links (the world's, never the negatives' in invalid/). */
const CODE_FOLDER = "src";
const TEXT_KINDS = [".json", ".md", ".txt", ".xml", ".html"];

// ── The negative fixtures: each plants what one rule refuses, and no other file may hold it ─────────────────────────────────

const negative = (code: string): string[] => [`fixtures/drafts/invalid--${code}.json`, `fixtures/drafts-zh/invalid--${code}.zh.json`];
/** invalid--BLOCKED_HOST holds a shortener, invalid--SOURCE_URL an http address (the Chinese side holds no link but the term page's). */
const LINK_PLANTS: Record<string, RegExp> = {
  "fixtures/drafts/invalid--BLOCKED_HOST.json": /^https:\/\/t\.co\/\S+ is blocked \(shortener\)$/,
  "fixtures/drafts-zh/invalid--BLOCKED_HOST.zh.json": /^https:\/\/t\.co\/\S+ is blocked \(shortener\)$/,
  "fixtures/drafts/invalid--SOURCE_URL.json": /^http:\/\/\S+ is not https$/,
};
const SECRET_PLANTS = negative("SECRET_LIKE");
const DUAL_USE_PLANTS = negative("DUAL_USE");
const CANARY_PLANTS = negative("CANARY");

// ── The scan: which files, read how ──────────────────────────────────────────────────────────────────────────────────

interface FixtureText {
  /** Repo-relative path. */
  file: string;
  /** The family folder under fixtures/. */
  folder: string;
  /** The file as written. */
  text: string;
  /** A JSON file's keys and string values, any other file whole (with &amp; read as &); what the string checks read. */
  strings: string[];
  /** A JSON file's parsed value. */
  value?: unknown;
}

interface Listing {
  /** Names directly under fixtures/. */
  entries: string[];
  /** Repo-relative paths of every file under a family folder. */
  files: string[];
  /** Paths under a family folder that are neither a file nor a folder (a link, a socket): never read, so never allowed. */
  odd: string[];
}

function listFixtures(root: string): Listing {
  const base = path.join(root, "fixtures");
  const list: Listing = { entries: fs.readdirSync(base), files: [], odd: [] };
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) list.files.push(rel);
      else list.odd.push(rel);
    }
  };
  for (const f of FAMILIES) if (list.entries.includes(f)) walk(path.join(base, f));
  return list;
}

/** What is wrong with the names under fixtures/: a folder or file that no check lists, or a family that is missing. */
function layoutProblems(entries: readonly string[], files: readonly string[], odd: readonly string[]): string[] {
  return [
    ...entries.filter((e) => ![...FAMILIES, CODE_FOLDER].includes(e)).map((e) => `fixtures/${e} is not a listed fixture folder`),
    ...FAMILIES.filter((f) => !entries.includes(f)).map((f) => `fixtures/${f} is missing`),
    ...FAMILIES.filter((f) => !files.some((x) => x.startsWith(`fixtures/${f}/`))).map((f) => `fixtures/${f} holds no file`),
    ...files.filter((f) => !TEXT_KINDS.some((k) => f.endsWith(k))).map((f) => `${f} is not a kind of file the scan reads`),
    ...odd.map((f) => `${f} is neither a file nor a folder`),
  ];
}

function jsonStrings(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) value.forEach((x) => jsonStrings(x, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, x] of Object.entries(value)) {
      out.add(k);
      jsonStrings(x, out);
    }
  }
  return out;
}

function fixtureText(file: string, text: string): FixtureText {
  const folder = file.split("/")[1] ?? "";
  if (!file.endsWith(".json")) return { file, folder, text, strings: [text.replace(/&amp;/g, "&")] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  return { file, folder, text, strings: [...jsonStrings(value)], value };
}

/**
 * A file's text, read as strict UTF-8: bytes that are no text throw (naming the file), so a binary file never passes as an empty scan. A byte
 * order mark is kept as the character U+FEFF, so a JSON file that starts with one fails to parse and any other file fails the invisible-character check.
 */
function decode(bytes: Buffer, file = "a file"): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${file} is not UTF-8 text`);
  }
}

const LISTING = listFixtures(ROOT);
const readTexts = (root: string, files: readonly string[]): FixtureText[] => files.map((f) => fixtureText(f, decode(fs.readFileSync(path.join(root, f)), f)));
const TEXTS = readTexts(ROOT, LISTING.files);
/** The builders' source files that name the world, not a negative case. */
const SRC_TEXTS = (function srcFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
})(path.join(ROOT, "fixtures", CODE_FOLDER))
  .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
  .filter((f) => f.endsWith(".ts") && !f.startsWith("fixtures/src/invalid/"))
  .map((f): FixtureText => ({ file: f, folder: CODE_FOLDER, text: fs.readFileSync(path.join(ROOT, f), "utf8"), strings: [fs.readFileSync(path.join(ROOT, f), "utf8")] }));

/** The files with a problem, sorted: "<file>: ..." lines, so a negative fixture's plant is told apart from a stray one. */
const filesOf = (problems: readonly string[]): string[] => [...new Set(problems.map((p) => p.split(": ")[0]!))].sort();

// ── Links ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Reserved for examples (RFC 2606, RFC 6761): example.com, .org and .net with their subdomains, and the .test, .invalid and .example endings. */
const isExampleHost = (host: string): boolean => /(?:^|\.)example\.(?:com|org|net)$/.test(host) || /\.(?:test|invalid|example)$/.test(host);
const SITE_HOST = hostOf(config.run.site.url)!;
const OWN_REPO = `https://github.com/${config.run.repos.repo}/`;
const configUrls = (name: string): string[] => extractUrls(fs.readFileSync(path.join(ROOT, "config", name), "utf8"));
/** The hosts of the feeds and APIs the run reads (config/sources.yaml), their endpoints (host and path), and the exact pages the counters read (config/counters.json). */
const RUN_HOSTS = new Set(configUrls("sources.yaml").map((u) => hostOf(u)!));
const endpointOf = (u: URL): string => `${u.hostname}${u.pathname.replace(/\/+$/, "")}`;
const RUN_ENDPOINTS = new Set(configUrls("sources.yaml").map((u) => endpointOf(new URL(u))));
const RUN_PAGES = new Set(configUrls("counters.json").map(normalizeUrl));
/**
 * A host or path that no real page has: the word sample (a made-up host such as coldwater-sample.edu too), the invented block of ids whose digits
 * begin 99 (an arXiv, bioRxiv, SSRN or PubMed number; a block that starts in the middle of a number, such as the 099001 of a real article, is no
 * invented one), a trial number in the block that begins NCT099 (or NCT99), or the zz of a PDB id. Zenodo has its own rule (ZENODO_ID).
 */
const INVENTED_PATH = /sample|(?<!\d)99\d{3}|NCT0?99\d{4,}|zz\d/i;
/** A Zenodo record number in an address (zenodo.org/records/N, the old /record/N, the API's, or the DOI 10.5281/zenodo.N). */
const ZENODO_ID = /zenodo\.org\/(?:api\/)?records?\/(\d+)|zenodo\.(\d+)/i;
/** Zenodo numbered past 9,990,000 in 2023, so its 99 block is real; an invented record number has 8 digits and begins 999, above any number it has issued. */
const ZENODO_INVENTED = /^999\d{5,}$/;
/**
 * The http XML namespaces a saved feed (fixtures/feeds/**\/*.xml) may declare: identifiers that no reader fetches or shows, which the feeds'
 * publishers write over http. Each ends in a slash or is a whole address, so a look-alike host (purl.org.example.biz) is not one; any other http
 * address in a feed, a link or an item id, still fails as not https.
 */
const XML_NAMESPACE_PREFIXES = [
  "http://purl.org/", "http://www.w3.org/", "http://prismstandard.org/", "http://a9.com/-/spec/opensearch/", "http://arxiv.org/schemas/",
  "http://webns.net/mvcb/", "http://wellformedweb.org/CommentAPI/", "http://search.yahoo.com/mrss/", "http://www.itunes.com/dtds/podcast-1.0.dtd",
];
const XML_NAMESPACE = new RegExp(`^(?:${XML_NAMESPACE_PREFIXES.map(escapeRegExp).join("|")})`, "i");
const isFeedXml = (file: string): boolean => /^fixtures\/feeds\/(?:[^/]+\/)*[^/]+\.xml$/.test(file);
/** A scheme other than http(s) in front of "://". */
const OTHER_SCHEME = /(?<![A-Za-z0-9+.-])(?![hH][tT][tT][pP][sS]?:\/\/)[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/\S{0,40}/g;

/**
 * Why an address may not stand in a fixture, or null. With `classify` false only the safety tests run (the shape of the address, the blocked
 * list, the press list); with it, the host must also be one the run reads or allows, and a real host's page must be an invented one.
 */
function addressProblem(url: string, classify: boolean): string | null {
  if (!/^https:\/\//i.test(url)) return "is not https";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "is not a whole address";
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.username !== "" || u.password !== "") return "has user info";
  if (u.port !== "") return "names a port";
  if (net.isIP(host.replace(/^\[|\]$/g, "")) !== 0) return "is an IP address";
  if (host.split(".").some((label) => label.startsWith("xn--"))) return "is an internationalised host";
  const blocked = blockedEntry(url);
  if (blocked !== null) return `is blocked (${blocked.reason})`;
  const press = pressHostFor(url, config);
  if (press !== null) return `is on the press host ${press}`;
  if (!classify || isExampleHost(host) || host === SITE_HOST || RUN_PAGES.has(normalizeUrl(url)) || url.startsWith(OWN_REPO)) return null;
  const real = primaryTest(url, config).kinds.length > 0 || config.sourceTiers.figure_hosts.some((h) => hostMatches(host, h));
  let page = `${u.pathname}${u.search}`;
  try {
    page = decodeURIComponent(page);
  } catch {
    // keep the escaped form
  }
  if (RUN_ENDPOINTS.has(endpointOf(u))) return null;
  const zenodo = ZENODO_ID.exec(`${host}${page}`);
  if (zenodo !== null && !ZENODO_INVENTED.test(zenodo[1] ?? zenodo[2]!)) return "is a Zenodo record that may exist (an invented number has 8 digits and begins 999)";
  const frontPage = u.pathname === "/" && u.search === "" && u.hash === "";
  const invented = INVENTED_PATH.test(`${host}${page}`);
  if (real) return invented || frontPage ? null : "is a real host's page that may exist (no invented marker in its host or path)";
  if (![...RUN_HOSTS].some((h) => hostMatches(host, h))) return "is on no host the run reads or allows";
  return invented || frontPage ? null : "is a page of a host the run reads that may exist (neither an endpoint it reads nor an invented marker)";
}

/** Every link problem of the texts; in `code` (the builders' TypeScript) only whole addresses are read, since a bare host such as `s.id` is a property there. */
function linkProblems(texts: readonly FixtureText[], code = false): string[] {
  const bad = new Set<string>();
  for (const t of texts) {
    for (const s of t.strings) {
      for (const m of s.matchAll(OTHER_SCHEME)) bad.add(`${t.file}: ${m[0]} uses a scheme other than https`);
      for (const u of extractUrls(s)) {
        if (!code && isFeedXml(t.file) && XML_NAMESPACE.test(u)) continue;
        const why = addressProblem(u, !code);
        if (why !== null) bad.add(`${t.file}: ${u} ${why}`);
      }
      if (!code) for (const b of blockedUrlsIn(s)) bad.add(`${t.file}: ${b.url} is blocked (${b.entry.reason})`);
    }
  }
  return [...bad];
}

// ── Addresses, machine paths, people ─────────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** An e-mail address on no reserved example domain. */
function emailProblems(texts: readonly FixtureText[]): string[] {
  // NFKC first, so a full-width @ (Chinese text types one) is read as the @ it is.
  return texts.flatMap((t) => t.strings.flatMap((s) => (s.normalize("NFKC").match(EMAIL_RE) ?? []).filter((e) => !isExampleHost(e.split("@")[1]!.toLowerCase())).map((e) => `${t.file}: ${e}`)));
}

/** A home or system path, a path under the home folder (~/) or a Windows drive path: it would carry the machine's user name, which the public repo must not hold. */
const MACHINE_PATH = /(?:^|[\s"'(=:])(?:\/(?:Users|home|root|var|tmp|private|mnt)\/|~\/)\S|\b[A-Za-z]:\\[A-Za-z]/i;
function pathProblems(texts: readonly FixtureText[]): string[] {
  return texts.flatMap((t) => {
    const hit = t.strings.map((s) => MACHINE_PATH.exec(s)?.[0].trim()).find((m) => m !== undefined);
    return hit === undefined ? [] : [`${t.file}: a machine path (${hit})`];
  });
}

/** Family names of the invented people (placeholder words, no real surnames), and the words that end an organisation's name. */
const PLACEHOLDER_FAMILIES = ["Placeholder", "Example", "Fictional", "Specimen", "Provisional", "Nominal", "Stand-in", "Sample", "Invented", "Imaginary", "Hypothetical"];
const ORG_WORDS = ["Labs", "Lab", "Research", "Institute", "University", "College", "Council", "Press", "Systems", "Group", "Review", "Service"];
/** A name word in any script that capitalises: Anne-Marie, Stand-in, O'Neil, García. */
const WORD = "\\p{Lu}[\\p{L}'\u2019]*(?:-\\p{L}+)?";
/** A person's name as the world writes it: a given name, an invented family name, then the marker, and nothing after it but the canary's token (the CANARY negatives plant one). */
const PERSON_OK = new RegExp(`^[A-Z][a-z]+ (?:${PLACEHOLDER_FAMILIES.join("|")}) \\(SAMPLE\\)(?: ${CANARY_TOKEN})?$`);
/** Two capitalised words before the marker (in round brackets, or the full-width ones the Chinese text uses): a person or an organisation, told apart by the last word. */
const MARKED_PAIR = new RegExp(`${WORD} (${WORD}) ?[(（]SAMPLE[^)）]*[)）]`, "gu");
/** A byline at the start of a sentence. */
const BYLINE = new RegExp(`(?:^|[.!?]\\s+)By (${WORD} (${WORD}))(?![\\p{L}-])(?! ?[(（]SAMPLE)`, "gu");
/** Keys that hold people where this project's schemas have none (a feed capture's author fields, P2): a person under one is a marked placeholder too. */
const PERSON_KEYS = /^(?:authors?|creators?|contributors?|byline|speakers?|researchers?|authorships?)$/i;
const NAME_KEYS = /^(?:name|display_name|full_name)$/i;
/** The names under a person key: its strings, or the name fields of its objects, at any depth. */
function namesUnder(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(namesUnder);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => (typeof v === "string" ? (NAME_KEYS.test(k) ? [v] : []) : namesUnder(v)));
}

function objectsIn(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) value.forEach((x) => objectsIn(x, out));
  else if (value !== null && typeof value === "object") {
    out.push(value as Record<string, unknown>);
    Object.values(value).forEach((x) => objectsIn(x, out));
  }
  return out;
}

/** A reaction's speaker or a named person that is no invented SAMPLE placeholder, and a group's name with no marker. */
function personProblems(texts: readonly FixtureText[]): string[] {
  const bad: string[] = [];
  for (const t of texts) {
    for (const o of objectsIn(t.value)) {
      // A string `who` is a reaction's speaker or an idea's person; an array of `who` objects is a finding's actors.
      if (typeof o.who === "string" && !PERSON_OK.test(o.who)) bad.push(`${t.file}: speaker "${o.who}" is no invented placeholder`);
      for (const w of Array.isArray(o.who) ? o.who : []) {
        const name = (w as { name?: unknown } | null)?.name;
        if (typeof name === "string" && !name.includes("(SAMPLE")) bad.push(`${t.file}: who "${name}" has no SAMPLE marker`);
      }
      for (const [k, v] of Object.entries(o)) {
        if (!PERSON_KEYS.test(k)) continue;
        for (const name of namesUnder(v)) if (name.trim() !== "" && !name.includes("SAMPLE")) bad.push(`${t.file}: ${k} "${name}" has no SAMPLE marker`);
      }
    }
    for (const s of t.strings) {
      for (const m of s.matchAll(MARKED_PAIR)) {
        if (!PLACEHOLDER_FAMILIES.includes(m[1]!) && !ORG_WORDS.includes(m[1]!)) bad.push(`${t.file}: "${m[0]}" is neither a placeholder name nor an organisation`);
      }
      for (const m of s.matchAll(BYLINE)) {
        if (!ORG_WORDS.includes(m[2]!)) bad.push(`${t.file}: byline "${m[1]}" has no SAMPLE marker`);
      }
    }
  }
  return [...new Set(bad)];
}

/** The names of the real organisations the config lists (labs, checkers, journals, publishers, registries and resolvers). */
const REAL_NAMES = [...new Set([
  ...config.labs.labs, ...config.checkers.checkers, ...config.journals.journals, ...config.sourceTiers.publishers, ...config.sourceTiers.resolvers, ...config.sourceTiers.registries,
].map((x) => x.name.trim()))];
const realNameIn = (text: string, names: readonly string[] = REAL_NAMES): string | null =>
  names.find((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, "iu").test(text)) ?? null;

/**
 * A negative event (a setback, or a finding with a disputed or retracted rung entry) that names a real organisation the config lists: in its
 * `who`, in the publisher of the source that carries the bad news, or in its title or explainer. A fabricated negative claim about a real
 * organisation must not stand (F-28): the actors are invented ones such as Example Press.
 */
function negativeActorProblems(texts: readonly FixtureText[], names: readonly string[] = REAL_NAMES): string[] {
  const bad: string[] = [];
  for (const t of texts) {
    for (const o of objectsIn(t.value)) {
      const history = Array.isArray(o.rung_history) ? (o.rung_history as { rung?: string; source_id?: string }[]) : null;
      if (history === null || !Array.isArray(o.sources)) continue;
      const fell = history.filter((r) => r.rung === "disputed" || r.rung === "retracted");
      if (o.kind !== "setback" && fell.length === 0) continue;
      const carriers = new Set([...(o.kind === "setback" ? history : fell).map((r) => r.source_id), ...(o.kind === "setback" && Array.isArray(o.go_deeper) ? o.go_deeper : [])]);
      const actors = [
        ...(Array.isArray(o.who) ? o.who : []).map((w) => (w as { name?: string }).name ?? ""),
        ...(o.sources as { id?: string; publisher?: string }[]).filter((s) => carriers.has(s.id)).map((s) => s.publisher ?? ""),
        ...jsonStrings(o.title), ...jsonStrings((o.explainer as { found?: unknown } | null)?.found),
      ];
      for (const a of actors) {
        const real = realNameIn(a, names);
        if (real !== null) bad.push(`${t.file}: ${String(o.id ?? o.ref)} names the real organisation ${real} in a negative event`);
      }
    }
  }
  return [...new Set(bad)];
}

// ── Content: models, secrets, dangerous detail, attack code, invisible characters, markup ───────────────────────────

const MODEL_RE = modelRe("i");
/**
 * Attack-code shapes (AGENTS rule 10), each with harmless samples that the self-test plants: markup that runs, an address that runs, a traversal, a pipe
 * to a shell, a shell or command path, a forced or recursive delete, SQL, a JNDI lookup, an encoded command, a code fence (a method written out as code).
 */
const ATTACK_PATTERNS: { name: string; re: RegExp; hits: string[] }[] = [
  { name: "a script tag", re: /[<‹＜]script\b/i, hits: ["<script>", "<SCRIPT src=x>", "‹script>", "＜script>"] },
  { name: "an event handler", re: /\bon(?:error|load|click|mouseover|focus)\s*=|<[^<>]*\son[a-z]{3,24}\s*=/i, hits: ["<b onerror=x>", "<i ONLOAD = x>", "<a onclick=x>", "<a onmouseover=x>", "<a onfocus=x>", "<svg onanimationstart=x>", "<a href=x onmouseenter = y>", "<set onend=x>", "<a onwebkitanimationiteration=x>"] },
  { name: "a JNDI lookup", re: /\$\{jndi:/i, hits: ["${jn" + "di:ldap://x}", "${JN" + "DI:x}"] },
  { name: "a shell path", re: /\/bin\/(?:ba|z|da)?sh\b/, hits: ["/bin/sh -c x", "/bin/bash", "/bin/zsh", "/bin/dash"] },
  { name: "a command shell", re: /\bcmd(?:\.exe)?\s+\/c\b/i, hits: ["cmd /c dir", "CMD.EXE /C x"] },
  { name: "a forced or recursive delete", re: /\brm\s+-[a-z]*[rf]/i, hits: ["rm -rf /", "RM -fr x", "rm -r x", "rm -f x", "rm -Rf x"] },
  { name: "a code fence", re: /```|~~~/, hits: ["```", "text ~~~ text"] },
  { name: "a script address", re: /\b(?:java|vb)script:/i, hits: ["java" + "script:x", "VB" + "SCRIPT:x"] },
  { name: "a path traversal", re: /(?:\.\.\/){2,}|(?:\.\.\\){2,}/, hits: ["../../x", "..\\..\\x", "../../../x"] },
  { name: "a download piped to a shell", re: /\b(?:curl|wget)\b[^\n|]{0,80}\|\s*(?:sh|bash|zsh)\b/i, hits: ["curl x | sh", "WGET x |bash", "curl x | zsh", "curl -fsSL example.org/ut-sample/install.txt | sh"] },
  { name: "an SQL injection", re: /'\s*or\s+1\s*=\s*1\b|\bunion\s+select\b|;\s*drop\s+table\b/i, hits: ["' or 1=1", "' OR 1 = 1", "a UNION SELECT b", "a; DROP TABLE b"] },
  { name: "an encoded command", re: /\bpowershell(?:\.exe)?\s+-(?:enc|e)\b/i, hits: ["powershell -enc x", "powershell.exe -e x", "POWERSHELL -ENC x"] },
  { name: "a code call", re: /\b(?:eval|exec)\s*\(/, hits: ["eval(x)", "exec (x)"] },
  { name: "a base64 data address", re: /data:[a-z]+\/[a-z0-9.+-]+;base64,/i, hits: ["data:text/html;base64,AAAA", "DATA:image/png;base64,AA"] },
  { name: "a long base64 run", re: /[A-Za-z0-9+/]{200,}={0,2}/, hits: ["A".repeat(200), "A".repeat(300) + "=="] },
];

/** The first match of a pattern in any of the strings, cut to a short excerpt (a failure shows the string, not only the file), or undefined. */
const firstMatch = (strings: readonly string[], re: RegExp): string | undefined => strings.map((s) => re.exec(s)?.[0]).find((m) => m !== undefined)?.slice(0, 60);
const modelProblems = (texts: readonly FixtureText[]): string[] => texts.flatMap((t) => {
  const hit = firstMatch(t.strings, MODEL_RE);
  return hit === undefined ? [] : [`${t.file}: a model identifier (${hit})`];
});
const attackProblems = (texts: readonly FixtureText[]): string[] =>
  texts.flatMap((t) => ATTACK_PATTERNS.flatMap((p) => {
    const hit = firstMatch(t.strings, p.re);
    return hit === undefined ? [] : [`${t.file}: ${p.name} (${hit})`];
  }));

/**
 * Credential shapes beyond SECRET_LIKE's own list: a JWT, a bearer credential, a key or password assigned in text. SECRET_LIKE's patterns come from the
 * validator (secretsIn); these are this test's, since a fixture is a public file whatever the validator reads. A failure names the kind, never the match.
 */
const EXTRA_SECRETS: { name: string; re: RegExp; hits: string[] }[] = [
  { name: "a JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, hits: ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4eXoiLCJpYXQiOjE1MTYyMzkwMjJ9.abc123DEF456ghi789"] },
  { name: "a bearer credential", re: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{20,}/, hits: ["Authorization: Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a0", "bearer abcdefghij.klmnopqrst-uvwx", `Bearer ${"A1".repeat(10)}`] },
  { name: "a key or password assigned in text", re: /\b(?:password|passwd|api[_-]?key|secret[_-]?key|client[_-]?secret|(?:access|auth)[_-]?token)\s*[:=]\s*[^\s"'{}<>,;]{8,}/i, hits: ["password=hunter2hunter2", "API_KEY: abcd1234efgh", "client-secret = abcdefgh12", "passwd: abcd1234", "secret_key=abcd1234efgh", "auth-token = abcd1234efgh", "access_token: abcd1234efgh"] },
];
const credentialsIn = (text: string): string[] => [...secretsIn(text), ...EXTRA_SECRETS.filter((p) => p.re.test(text)).map((p) => p.name)];
const secretProblems = (texts: readonly FixtureText[]): string[] => texts.flatMap((t) => [...new Set(t.strings.flatMap(credentialsIn))].map((n) => `${t.file}: ${n}`));

/** DUAL_USE's own detectors on every string: a run of sequence letters, a sentence that pairs an agent with a method or a quantity, numbered steps. */
function dualUseProblems(texts: readonly FixtureText[], forms: DualUseForms): string[] {
  return texts.flatMap((t) => [...new Set(t.strings.flatMap((s) => [
    ...sequencesIn(s).map((h) => `${h.kind.startsWith("a") ? "an" : "a"} ${h.kind} sequence`),
    ...(pairsIn(s, forms).length > 0 ? ["an agent with a method or a quantity"] : []),
    ...(stepMarkersIn(s).length >= STEPS_MIN ? ["numbered steps"] : []),
  ]))].map((n) => `${t.file}: ${n}`));
}

function invisibleProblems(texts: readonly FixtureText[]): string[] {
  return texts.flatMap((t) => {
    const hit = t.strings.map((s) => s.match(INVISIBLE)?.[0]).find((c) => c !== undefined);
    return hit === undefined ? [] : [`${t.file}: invisible character U+${hit.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`];
  });
}

/** A tag, a comment (hidden text), a processing instruction, a CDATA section or a doctype. */
const RAW_TAG = /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?\/?>|<!--|<\?[A-Za-z]|<!\[CDATA\[|<!DOCTYPE/i;
/** Files that are markup on purpose: the planted page and item. The wrapper tag of untrusted text (SPEC §4.14) is the only tag any other file may hold. */
const MARKUP_FILES = new Set(["fixtures/injection/page.html", "fixtures/injection/item.xml"]);
/** The Ledger's saved pages (fixtures/feeds/pages/*.html) and the feed captures (fixtures/feeds/**\/*.xml): the formats a reader parses, with invented prose. Only the tag check skips them. */
const FEED_MARKUP = /^fixtures\/feeds\/(?:pages\/[^/]+\.html|(?:[^/]+\/)*[^/]+\.xml)$/;
const isMarkupFile = (file: string): boolean => MARKUP_FILES.has(file) || FEED_MARKUP.test(file);
const WRAPPER_TAG = /<\/?untrusted(?:\s+source="[a-z0-9-]+")?>/g;
function tagProblems(texts: readonly FixtureText[]): string[] {
  return texts.filter((t) => !isMarkupFile(t.file)).flatMap((t) => {
    const hit = firstMatch(t.strings.map((s) => s.replace(WRAPPER_TAG, "")), RAW_TAG);
    return hit === undefined ? [] : [`${t.file}: a raw HTML tag (${hit})`];
  });
}

// ── The canary ───────────────────────────────────────────────────────────────────────────────────────────────────────

const NONCE = "{{NONCE}}";
const CANARY_SCHEMED = `${CANARY_URL_PREFIX}${NONCE}`;
const CANARY_BARE = `${CANARY_URL_MARK}${NONCE}`;
/** Where the planted address stands and in what form: with its scheme in a page or feed (sanitize() turns it into [link]), without in the pack, and with a fixed path in the Chinese context. */
const CANARY_FORMS: Record<string, "schemed" | "bare" | "fixed"> = {
  "fixtures/injection/item.xml": "schemed", "fixtures/injection/page.html": "schemed", "fixtures/injection/pack.json": "bare", "fixtures/injection/pack.md": "bare",
  "fixtures/injection/zh-context.json": "fixed",
};
/** The files that may hold the token: the planted ones, and the CANARY negatives (a draft that writes it must fail). */
const TOKEN_FILES = [...Object.keys(CANARY_FORMS), ...CANARY_PLANTS];
const URL_CHAR = /[A-Za-z0-9{}/._~%:-]/;

/** Every place a text holds the canary's address (any case, with or without a scheme) that is not its exact form in its own file, and a token outside TOKEN_FILES. */
function canaryProblems(texts: readonly FixtureText[]): string[] {
  const bad: string[] = [];
  for (const t of texts) {
    const lower = t.text.toLowerCase();
    const form = CANARY_FORMS[t.file];
    for (let i = lower.indexOf(CANARY_URL_MARK); i !== -1; i = lower.indexOf(CANARY_URL_MARK, i + 1)) {
      const seen = t.text.slice(Math.max(0, i - 8), i + CANARY_URL_MARK.length + 12).split(/\s/).find((c) => c.toLowerCase().includes(CANARY_URL_MARK))!;
      const before = t.text[i - 1] ?? "";
      let exact = false;
      if (form === "schemed") {
        const start = i - "https://".length;
        exact = t.text.slice(start, start + CANARY_SCHEMED.length) === CANARY_SCHEMED && !URL_CHAR.test(t.text[start + CANARY_SCHEMED.length] ?? "");
      } else if (form === "bare" || form === "fixed") {
        const end = form === "bare" ? i + CANARY_BARE.length : i + CANARY_URL_MARK.length + /^[a-z0-9]*/.exec(t.text.slice(i + CANARY_URL_MARK.length))![0].length;
        const ok = form === "bare" ? t.text.slice(i, end) === CANARY_BARE : end > i + CANARY_URL_MARK.length;
        exact = ok && !URL_CHAR.test(before) && !URL_CHAR.test(t.text[end] ?? "");
      }
      if (form === undefined) bad.push(`${t.file}: the canary's address outside the planted files (${seen})`);
      else if (!exact) bad.push(`${t.file}: ${seen} is not the canary's exact ${form} address`);
    }
    if (lower.includes(CANARY_TOKEN.toLowerCase()) && !TOKEN_FILES.includes(t.file)) bad.push(`${t.file}: the canary's token outside the planted files`);
  }
  return bad;
}

// ── Size ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const FILE_CAP = 1 * MB;
const TOTAL_CAP = 6 * MB;
function sizeProblems(sizes: readonly { file: string; bytes: number }[]): string[] {
  const total = sizes.reduce((n, s) => n + s.bytes, 0);
  return [...sizes.filter((s) => s.bytes >= FILE_CAP).map((s) => `${s.file}: ${s.bytes} bytes`), ...(total >= TOTAL_CAP ? [`fixtures/: ${total} bytes in all`] : [])];
}
function fixtureSizes(root: string): { file: string; bytes: number }[] {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return walk(path.join(root, "fixtures")).map((abs) => ({ file: path.relative(root, abs).split(path.sep).join("/"), bytes: fs.statSync(abs).size }));
}

// ── On the fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────

const FORMS = dualUseForms(config.dualUse);
/** Splits "<file>: ..." problems into those of the files that may hold a plant (the text after the file name, per file) and the stray ones, whole. */
function splitPlants(problems: readonly string[], plants: readonly string[]): { stray: string[]; planted: Map<string, string[]> } {
  const planted = new Map(plants.map((f) => [f, [] as string[]]));
  const stray: string[] = [];
  for (const p of problems) {
    const file = p.slice(0, p.indexOf(": "));
    const mine = planted.get(file);
    if (mine === undefined) stray.push(p);
    else mine.push(p.slice(file.length + 2));
  }
  return { stray, planted };
}
/** A check fires in the plants and nowhere else: a stray problem fails with its whole text, a plant that holds none fails with its name. */
function expectPlantsOnly(problems: readonly string[], plants: readonly string[]): void {
  const { stray, planted } = splitPlants(problems, plants);
  expect(stray).toEqual([]);
  for (const [file, mine] of planted) expect(mine.length, `${file} holds its plant`).toBeGreaterThan(0);
}

describe("fixture safety: what the scan covers", () => {
  it("lists exactly the known fixture folders, each with files, of kinds the scan reads, and no link or odd entry", () => {
    expect(layoutProblems(LISTING.entries, LISTING.files, LISTING.odd)).toEqual([]);
    expect([...LISTING.entries].sort()).toEqual([...FAMILIES, CODE_FOLDER].sort());
  });

  it("reads every file under the folders as strict UTF-8 text, each .json file as JSON", () => {
    expect(TEXTS.map((t) => t.file)).toEqual(LISTING.files);
    expect(new Set(LISTING.files).size).toBe(LISTING.files.length);
    expect(TEXTS.length).toBeGreaterThan(100);
    for (const t of TEXTS) {
      expect(t.text.length, t.file).toBeGreaterThan(0);
      expect(t.strings.length, t.file).toBeGreaterThan(0);
      if (t.file.endsWith(".json")) expect(t.value, t.file).not.toBeUndefined();
    }
    for (const f of FAMILIES) expect(TEXTS.some((t) => t.folder === f), f).toBe(true);
    expect(SRC_TEXTS.length).toBeGreaterThan(5);
  });

  it("reads the files the plan builds in every folder: both languages' drafts, contexts, evidence, packs, the sample site and the canary's eight", () => {
    const has = (prefix: string): boolean => TEXTS.some((t) => t.file.startsWith(prefix));
    for (const p of ["fixtures/drafts/valid-", "fixtures/drafts/invalid--", "fixtures/drafts-zh/valid-", "fixtures/context/", "fixtures/evidence/", "fixtures/metrics/", "fixtures/packs/", "fixtures/state/", "fixtures/site-content/briefs/", "fixtures/site-content/findings/", "fixtures/empty-content/"]) expect(has(p), p).toBe(true);
    expect(TEXTS.filter((t) => t.folder === "injection").map((t) => t.file.split("/")[2]).sort()).toEqual(
      ["context.json", "evidence-base.json", "item.xml", "metrics.json", "pack.json", "pack.md", "page.html", "zh-context.json"]);
  });
});

describe("fixture safety: links", () => {
  it("every link is https, whole, with no user info, port or IP address, on no blocked host and no press host, but the negative fixtures' plants", () => {
    const { stray, planted } = splitPlants(linkProblems(TEXTS), Object.keys(LINK_PLANTS));
    expect(stray).toEqual([]);
    for (const [file, mine] of planted) {
      expect(mine.length, `${file} holds its plant`).toBeGreaterThan(0);
      for (const m of mine) expect(LINK_PLANTS[file]!.test(m), `${file}: ${m}`).toBe(true);
    }
  });

  it("every link sits on a primary, figure, example, own or run host, and a real host's page is an invented one", () => {
    expect(linkProblems(TEXTS).filter((p) => /no host the run|may exist/.test(p))).toEqual([]);
  });

  it("the builders' own source names no bad link, e-mail address, machine path or credential: the negative cases that plant them live in fixtures/src/invalid/", () => {
    expect(linkProblems(SRC_TEXTS, true)).toEqual([]);
    expect(emailProblems(SRC_TEXTS)).toEqual([]);
    expect(pathProblems(SRC_TEXTS)).toEqual([]);
    expect(secretProblems(SRC_TEXTS)).toEqual([]);
  });

  it("no e-mail address outside a reserved example domain, and no machine path", () => {
    expect(emailProblems(TEXTS)).toEqual([]);
    expect(pathProblems(TEXTS)).toEqual([]);
  });

  it("the press hosts, the blocked list and the allow list the checks read are not empty", () => {
    expect(config.sourceTiers.press_hosts.length).toBeGreaterThan(50);
    expect(BLOCKED_HOSTS.length).toBeGreaterThan(40);
    expect(RUN_HOSTS.size).toBeGreaterThan(5);
    expect(RUN_PAGES.size).toBeGreaterThan(3);
    expect(SITE_HOST).toMatch(/\./);
  });
});

describe("fixture safety: people and negative events", () => {
  it("a reaction's speaker and every named person is an invented SAMPLE placeholder; a group's name carries the marker", () => {
    expect(personProblems(TEXTS)).toEqual([]);
    const speakers = TEXTS.flatMap((t) => objectsIn(t.value).flatMap((o) => (Array.isArray(o.reactions) ? o.reactions : []).map((r) => (r as { who: string }).who)));
    expect(speakers.length).toBeGreaterThan(3);
  });

  it("an actor of a negative event (a setback, a retraction, a dispute) is no real organisation the config lists", () => {
    expect(REAL_NAMES.length).toBeGreaterThan(40);
    expect(REAL_NAMES.filter((n) => n.length < 4), "a name under four letters would match inside ordinary prose: list it by its longer name").toEqual([]);
    expect(negativeActorProblems(TEXTS)).toEqual([]);
    const negatives = TEXTS.flatMap((t) => objectsIn(t.value).filter((o) => o.kind === "setback" && Array.isArray(o.rung_history)));
    expect(negatives.length).toBeGreaterThan(1);
  });
});

describe("fixture safety: content", () => {
  it("holds no model identifier, no credential-shaped string outside the SECRET_LIKE negatives, and no attack-code pattern", () => {
    expect(modelProblems(TEXTS)).toEqual([]);
    expectPlantsOnly(secretProblems(TEXTS), SECRET_PLANTS);
    expect(attackProblems(TEXTS)).toEqual([]);
    expect(modelProblems(SRC_TEXTS)).toEqual([]);
  });

  it("holds no sequence, no agent with a method or quantity and no numbered steps outside the DUAL_USE negatives", () => {
    expect(FORMS.agents.words).not.toBeNull();
    expectPlantsOnly(dualUseProblems(TEXTS, FORMS), DUAL_USE_PLANTS);
  });

  it("holds no invisible character and no raw HTML tag, but the planted page and item and the pack's wrapper tag", () => {
    expect(invisibleProblems(TEXTS)).toEqual([]);
    expect(tagProblems(TEXTS)).toEqual([]);
    expect(tagProblems([fixtureText("fixtures/injection/pack.md", "see <untrusted> and <untrusted source=\"x-y\">a</untrusted>"), fixtureText("fixtures/context/p.json", JSON.stringify({ a: "<untrusted source=\"a-b\">t</untrusted>" }))])).toEqual([]);
    for (const f of MARKUP_FILES) expect(TEXTS.find((t) => t.file === f)?.text, f).toMatch(RAW_TAG);
    // The saved pages and feed captures are markup, and the tag check skips exactly them: each is a real page or feed, not a stray file that happens to hold a tag.
    const feedMarkup = TEXTS.filter((t) => FEED_MARKUP.test(t.file));
    expect(feedMarkup.length).toBeGreaterThan(0);
    for (const t of feedMarkup) expect(t.text, t.file).toMatch(RAW_TAG);
    expect(TEXTS.filter((t) => t.folder === "feeds" && !FEED_MARKUP.test(t.file)).every((t) => t.file.endsWith(".json"))).toBe(true);
  });
});

describe("fixture safety: the canary", () => {
  it("its token stands in the planted files and the CANARY negatives only, its address in the planted files in their exact forms", () => {
    expect(canaryProblems(TEXTS)).toEqual([]);
    const holds = (needle: string): string[] => TEXTS.filter((t) => t.text.toLowerCase().includes(needle.toLowerCase())).map((t) => t.file).sort();
    expect(holds(CANARY_TOKEN)).toEqual([...TOKEN_FILES].sort());
    expect(holds(CANARY_URL_MARK)).toEqual(Object.keys(CANARY_FORMS).sort());
  });

  it("the planted address is on a reserved example domain, and nowhere is the token wrapped in a link the run could follow", () => {
    expect(isExampleHost(hostOf(CANARY_URL_PREFIX)!)).toBe(true);
    expect(CANARY_URL_PREFIX).toBe(`https://${CANARY_URL_MARK}`);
    expect(linkProblems(TEXTS.filter((t) => t.folder === "injection")).filter((p) => /example\.org/.test(p))).toEqual([]);
  });
});

describe("fixture safety: size", () => {
  it("keeps every file under 1 MB and the whole of fixtures/ under 6 MB, the builders' source included", () => {
    const sizes = fixtureSizes(ROOT);
    expect(sizes.length).toBeGreaterThan(LISTING.files.length);
    expect(sizeProblems(sizes)).toEqual([]);
    expect(sizes.reduce((n, s) => n + s.bytes, 0)).toBeGreaterThan(MB);
  });
});

// ── On planted bad samples: each check still catches what it looks for ───────────────────────────────────────────────

describe("fixture safety: the checks catch planted problems", () => {
  const plant = (file: string, text: string): FixtureText => fixtureText(file, text);
  /** A text that is not JSON, whatever its name says. */
  const raw = (file: string, text: string): FixtureText => ({ file, folder: file.split("/")[1]!, text, strings: [text] });
  const planted = (text: string): FixtureText => plant("fixtures/drafts/planted.json", JSON.stringify({ text }));
  const realLab = config.labs.labs[0]!.name;

  it("a link: another scheme, a case, user info, a port, an IP address, an internationalised host, the lists, an unlisted host and a real page fail", () => {
    const cases: [string, string][] = [
      ["http://www.example.net/ut-sample", "is not https"], ["HTTP://www.example.net/ut-sample", "is not https"], ["ftp://files.example.net/x", "uses a scheme other than https"],
      ["https://user:pw@www.example.net/ut-sample", "has user info"], ["https://www.example.net:8443/ut-sample", "names a port"],
      ["https://127.0.0.1/ut-sample", "is an IP address"], ["https://2130706433/ut-sample", "is an IP address"], ["https://[::1]/ut-sample", "is not a whole address"],
      ["https://xn--e1afmkfd.example.net/ut-sample", "is an internationalised host"], ["https://bit.ly/ut-sample", "is blocked (shortener)"],
      ["https://sub.archive.org/web/2020/x", "is blocked (archive)"], ["https://phys.org/news/ut-sample.html", "is on the press host phys.org"],
      ["https://unlisted-site.biz/ut-sample", "is on no host the run reads or allows"], ["https://www.nature.com/articles/s41586-023-06004-9", "may exist"],
      ["https://doi.org/10.1038/real-paper-1", "may exist"], ["https://media.springernature.com/lw1200/real.png", "may exist"],
      ["https://doi.org/10.1103/PhysRevLett.129.099001", "may exist"], ["https://clinicaltrials.gov/study/NCT05123456", "may exist"],
      ["https://zenodo.org/records/9990002", "Zenodo record"], ["https://doi.org/10.5281/zenodo.7654321", "Zenodo record"], ["https://zenodo.org/api/records/12345678", "Zenodo record"],
      ["https://gitlab.com/someone-real/real-repo", "page of a host the run reads"], ["https://api.openalex.org/works/W1234567890", "page of a host the run reads"],
      ["https://files.rcsb.org/pub/pdb/holdings/other_holdings.json.gz", "page of a host the run reads"],
      // 樂詞網 sits under .edu.tw, which section 4.11's statement suffixes list for Taiwan's universities (K1d), so its pages are a real host's now
      ["https://terms.naer.edu.tw/detail/1234567/", "may exist"],
    ];
    for (const [url, why] of cases) expect(linkProblems([planted(`See ${url} now.`)]), url).toEqual([expect.stringContaining(why)]);
    expect(linkProblems([planted("Read t.me/ut-sample and TINYURL.com/x for more.")])).toEqual([
      "fixtures/drafts/planted.json: t.me/ut-sample is blocked (messaging)", "fixtures/drafts/planted.json: TINYURL.com/x is blocked (shortener)",
    ]);
    expect(linkProblems([plant("fixtures/context/planted.xml", "<a href=\"https://www.example.net/ut-sample?a=1&amp;b=2\">x</a> and http://bit.ly/x")])).toEqual([
      "fixtures/context/planted.xml: http://bit.ly/x is not https", "fixtures/context/planted.xml: http://bit.ly/x is blocked (shortener)",
    ]);
  });

  it("an http XML namespace passes in a saved feed only, by a listed prefix; any other http address, in a feed or elsewhere, still fails", () => {
    const ns = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><category scheme="http://arxiv.org/schemas/atom"/></feed>`;
    expect(linkProblems(["fixtures/feeds/rss/a.xml", "fixtures/feeds/live/deep/b.xml"].map((f) => plant(f, ns)))).toEqual([]);
    expect(linkProblems([plant("fixtures/feeds/rss/a.xml", `<rss xmlns:dc="HTTP://PURL.ORG/dc/elements/1.1/"/>`)])).toEqual([]);
    // Not in a feed: the same text in another folder, another kind of file or a JSON string fails.
    const where = ["fixtures/context/a.xml", "fixtures/feeds/pages/a.html", "fixtures/feeds/a.md", "fixtures/injection/item.xml"];
    for (const f of where) expect(linkProblems([plant(f, ns)]).sort(), f).toEqual(expect.arrayContaining(["http://www.w3.org/2005/Atom", "http://arxiv.org/schemas/atom"].map((u) => `${f}: ${u} is not https`)));
    expect(linkProblems([plant("fixtures/feeds/index.json", JSON.stringify({ a: "http://purl.org/dc/elements/1.1/" }))])).toEqual(["fixtures/feeds/index.json: http://purl.org/dc/elements/1.1/ is not https"]);
    // Not by another prefix: a look-alike host, another host, a feed's own http link or item id, https is judged as everywhere.
    for (const bad of ["http://purl.org.example.biz/x", "http://www.w3.org.example.biz/x", "http://example.org/ns", "http://arxiv.org/abs/2610.99001v1", "http://link.aps.org/doi/10.1103/ut-sample-0001", "http://bit.ly/x"]) {
      expect(linkProblems([plant("fixtures/feeds/rss/a.xml", `<x:a xmlns:x="${bad}"/>`)]).filter((p) => p.endsWith("is not https")), bad).toEqual([`fixtures/feeds/rss/a.xml: ${bad} is not https`]);
    }
    expect(linkProblems([plant("fixtures/feeds/rss/a.xml", `<link>https://www.nature.com/articles/real-paper</link>`)])).toEqual([expect.stringContaining("may exist")]);
    expect(linkProblems([plant("fixtures/feeds/rss/a.xml", `<link>https://www.nature.com/articles/nature-ut-sample-0001</link>`)])).toEqual([]);
  });

  it("a link that is fine passes: example, own, run, primary and figure hosts, an invented page, the counters' pages, the canary's address", () => {
    const ok = [
      "https://www.example.net/x", "https://a.example.org/x", "https://lab.example.test/x", `${config.run.site.url}/briefs/2026-10-14`, `${OWN_REPO}tree/main/content`, "https://api.openalex.org/works?filter=a",
      "https://www.nature.com/articles/nature-ut-sample-0001", "https://arxiv.org/abs/2610.99001", "https://clinicaltrials.gov/study/NCT09999001", "https://rcsb.org/structure/pdb_00009zz1",
      "https://www.biorxiv.org/content/10.1101/2026.09.02.990011v1", "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=9990001", "https://media.springernature.com/ut-sample/f.png",
      "https://www.coldwater-sample.edu/news/x", "https://doi.org/10.5281/zenodo.99900002", "https://zenodo.org/records/99900003", [...RUN_PAGES][0]!, CANARY_SCHEMED,
      "https://www.eurekalert.org/", "https://www.nature.com/", "https://export.arxiv.org/api/query?search_query=a", "https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv",
    ];
    expect(linkProblems([planted(ok.join(" and "))])).toEqual([]);
  });

  it("an address is judged by its parts: user info, an IP in any form, a trailing dot, a later xn-- label, an encoded or broken path, the example domains", () => {
    const why = (url: string, classify = false): string | null => addressProblem(url, classify);
    expect([":pw@", "user@", "user:pw@"].map((u) => why(`https://${u}www.example.net/x`))).toEqual(Array(3).fill("has user info"));
    expect([why("https://[::1]/x"), why("https://127.0.0.1./x"), why("https://www.xn--e1afmkfd.example.net/x")]).toEqual(["is an IP address", "is an IP address", "is an internationalised host"]);
    expect(why("https://www.example.net./x", true)).toBeNull();
    expect([why(`https://github.com/${config.run.repos.repo}/tree/main/content`, true), why("https://github.com/someone-else/x", true) === null]).toEqual([null, false]);
    expect([why("https://www.nature.com/articles/nature-ut-%73ample", true), why("https://www.nature.com/articles/s41586-023-06004-9?x=50%-sample", true)]).toEqual([null, null]);
    expect(why("https://www.nature.com/articles/s41586-023-06004-9?x=50%", true)).toContain("may exist");
    // A front page names nobody; an endpoint the run reads is its own address; any other page of a host the run reads, or of a listed host, must be an invented one.
    expect([why("https://gitlab.com/", true), why("https://api.openalex.org/works/", true), why("https://www.nature.com/", true), why("https://pubmed.ncbi.nlm.nih.gov/", true), why("https://papers.ssrn.com/", true)]).toEqual([null, null, null, null, null]);
    for (const bad of ["https://gitlab.com/?q=1", "https://www.nature.com/#frag", "https://api.openalex.org/works/W1", "https://pubmed.ncbi.nlm.nih.gov/?term=real", "https://pubmed.ncbi.nlm.nih.gov/#real"]) expect(why(bad, true), bad).toContain("may exist");
    // Zenodo's own numbers: every one below 10 million is issued, so an invented one has 8 digits and begins 999.
    expect([why("https://zenodo.org/records/99900002", true), why("https://doi.org/10.5281/zenodo.999123456", true)]).toEqual([null, null]);
    for (const bad of ["https://zenodo.org/records/9990002", "https://zenodo.org/records/999000", "https://zenodo.org/records/12345678", "https://zenodo.org/record/7654321", "https://zenodo.org/api/records/20123456", "https://zenodo.org/records/99123456", "https://www.zenodo.org/records/9990002?x=sample"]) {
      expect(why(bad, true), bad).toContain("Zenodo record");
    }
    // The 99 block must begin a number: the 099001 inside a real article's number does not count, a trial number's NCT0 and a PDB id's zz do.
    expect([why("https://doi.org/10.1103/PhysRevLett.129.099001", true)?.includes("may exist"), why("https://clinicaltrials.gov/study/NCT09999001", true), why("https://clinicaltrials.gov/study/NCT99999001", true)]).toEqual([true, null, null]);
    expect([why("https://clinicaltrials.gov/study/NCT05123456", true)?.includes("may exist"), why("https://rcsb.org/structure/pdb_00009zz1", true), why("https://arxiv.org/abs/2610.99001", true)]).toEqual([true, null, null]);
    // The block needs five digits (99 and three more) and a pdb id's zz needs a digit after it; the marker is read in any case.
    for (const real of ["https://doi.org/10.1038/real-9912", "https://www.nature.com/articles/jazz-paper"]) expect(why(real, true), real).toContain("may exist");
    expect(why("https://www.nature.com/articles/Nature-UT-SAMPLE-1", true)).toBeNull();
    // With classify off only the safety tests run: a host that no list holds passes.
    expect(why("https://unlisted-site.biz/real-page-1", false)).toBeNull();
    for (const yes of ["a.example.com", "example.org", "x.example", "a.b.test", "x.invalid"]) expect(isExampleHost(yes), yes).toBe(true);
    for (const no of ["notexample.com", "example.edu", "contest", "attest.com", "example.com.evil.biz", "example.example.biz"]) expect(isExampleHost(no), no).toBe(false);
  });

  it("the plants of the negative fixtures are the only links that fail, and the list names exactly those files", () => {
    expect(Object.keys(LINK_PLANTS).sort()).toEqual([...negative("BLOCKED_HOST"), "fixtures/drafts/invalid--SOURCE_URL.json"].sort());
    expect(filesOf(linkProblems([planted("https://bit.ly/a"), plant("fixtures/context/weekday.json", JSON.stringify({ u: "http://www.example.net/a" }))]))).toEqual(
      ["fixtures/context/weekday.json", "fixtures/drafts/planted.json"]);
  });

  it("an e-mail address on a real domain and a machine path fail; an example address passes", () => {
    expect(emailProblems([planted("Write to jane.doe@realcorp.biz or to sample@example.com, or ops@lab.example.org, or X@EXAMPLE.ORG, or kim@realcorp.io ; no more.")])).toEqual([
      "fixtures/drafts/planted.json: jane.doe@realcorp.biz", "fixtures/drafts/planted.json: kim@realcorp.io",
    ]);
    expect(emailProblems([plant("fixtures/injection/pack.md", "mail jane@realcorp.biz")])).toEqual(["fixtures/injection/pack.md: jane@realcorp.biz"]);
    for (const bad of ["/Users/someone/Projects/x", "see /home/dev/x", "C:\\Users\\x", "(/tmp/work)", "path=/var/log/x", "dir:/var/x", "/root/x", "at /private/x", "/mnt/data/x", "/HOME/x", "see ~/.unveiling/x", "(~/Projects)", "cd ~/x"]) expect(pathProblems([planted(bad)]), bad).toHaveLength(1);
    expect(pathProblems([planted("a path like content/briefs/2026-10-14.json and the /articles/x page, the /var/ and /tmp/ folders, about ~5 and ~ 5, a~/b")])).toEqual([]);
    expect(pathProblems([planted("see /Users/someone/Projects/x")])).toEqual(["fixtures/drafts/planted.json: a machine path (/Users/s)"]);
    // A full-width @ (Chinese text) is read as the @ it is; the other full-width letters too.
    expect(emailProblems([planted("jane.doe\uff20realcorp.biz"), planted("\uff4a\uff41\uff4e\uff45\uff20realcorp.biz and x\uff20example.com")])).toEqual(["fixtures/drafts/planted.json: jane.doe@realcorp.biz", "fixtures/drafts/planted.json: jane@realcorp.biz"]);
  });

  it("a person: an unmarked or real-looking speaker, a marked real-looking name, an unmarked byline and an unmarked who entry fail; placeholders and organisations pass", () => {
    const finding = (reactions: unknown[], who: unknown[]): FixtureText => plant("fixtures/site-content/findings/x.json", JSON.stringify({ reactions, who }));
    expect(personProblems([finding([{ who: "Mira Placeholder (SAMPLE)" }, { who: "Pia Stand-in (SAMPLE)" }, { who: `Sana Provisional (SAMPLE) ${CANARY_TOKEN}` }], [{ name: "Marlow Labs (SAMPLE)" }, { name: "Example Press (SAMPLE statement)" }])])).toEqual([]);
    // Nothing may follow the marker but the canary's token: a real name after it, or a lower-case marker, fails.
    expect(personProblems([finding([{ who: "Pia Stand-in (SAMPLE) and Jane Smith" }, { who: "Pia Stand-in (SAMPLE) extra" }, { who: "Pia Stand-in (sample)" }, { who: "Pia Stand-in (SAMPLE" }, { who: `Pia Stand-in (SAMPLE) ${CANARY_TOKEN} x` }], [])]).map((p) => p.split(": ")[1])).toEqual([
      'speaker "Pia Stand-in (SAMPLE) and Jane Smith" is no invented placeholder', 'speaker "Pia Stand-in (SAMPLE) extra" is no invented placeholder', 'speaker "Pia Stand-in (sample)" is no invented placeholder', 'speaker "Pia Stand-in (SAMPLE" is no invented placeholder',
      `speaker "Pia Stand-in (SAMPLE) ${CANARY_TOKEN} x" is no invented placeholder`,
    ]);
    expect(personProblems([finding([{ who: "Jane Smith" }, { who: "Jane Smith (SAMPLE)" }, { who: "Mira Placeholder" }], [{ name: "Marlow Labs" }, { name: "Jane Smith" }, { name: "SAMPLE Labs" }])]).map((p) => p.split(": ")[1])).toEqual([
      'who "Marlow Labs" has no SAMPLE marker', 'who "Jane Smith" has no SAMPLE marker', 'who "SAMPLE Labs" has no SAMPLE marker',
      'speaker "Jane Smith" is no invented placeholder', 'speaker "Jane Smith (SAMPLE)" is no invented placeholder', 'speaker "Mira Placeholder" is no invented placeholder',
      '"Jane Smith (SAMPLE)" is neither a placeholder name nor an organisation',
    ]);
    // An idea's person is a string `who` too, in a draft's ideas and in a stored brief's.
    const ideas = (who: string, file = "fixtures/drafts/valid-weekday.json"): FixtureText => plant(file, JSON.stringify({ ideas: [{ text: "x", who, source_id: "b3" }] }));
    expect(personProblems([ideas("Oren Nominal (SAMPLE)"), ideas(`Sana Provisional (SAMPLE) ${CANARY_TOKEN}`, "fixtures/drafts/invalid--CANARY.json")])).toEqual([]);
    expect(personProblems([ideas("Jane Smith"), ideas("Jane Smith (SAMPLE)", "fixtures/site-content/briefs/2026-10-14.json")]).map((p) => p.split(": ")[1])).toEqual([
      'speaker "Jane Smith" is no invented placeholder', 'speaker "Jane Smith (SAMPLE)" is no invented placeholder', '"Jane Smith (SAMPLE)" is neither a placeholder name nor an organisation',
    ]);
    // Keys that hold people by another name (a capture's author fields): a placeholder passes, any other name fails, at any depth.
    expect(personProblems([plant("fixtures/drafts/planted.json", JSON.stringify({
      authors: ["Mira Placeholder (SAMPLE)"], creator: "SAMPLE Author", byline: "", speakers: [], contributors: [{ display_name: "Pia Stand-in (SAMPLE)", ror: "https://ror.org/0abc123de" }],
      authorships: [{ author: { display_name: "Tomas Specimen (SAMPLE)", orcid: "https://orcid.org/0000-0000-0000-0000" } }],
    }))])).toEqual([]);
    for (const key of ["authors", "author", "creators", "contributor", "byline", "speakers", "researcher", "authorships", "Authors"]) {
      expect(personProblems([plant("fixtures/drafts/planted.json", JSON.stringify({ x: { [key]: ["Jane Smith"] } }))]), key).toEqual([`fixtures/drafts/planted.json: ${key} "Jane Smith" has no SAMPLE marker`]);
    }
    for (const [entry, name] of [[{ name: "Jane Smith", ror: "https://ror.org/0abc123de" }, "Jane Smith"], [{ display_name: "Kim Lee" }, "Kim Lee"], [{ full_name: "Ana Ruiz" }, "Ana Ruiz"], [{ Name: "Raj Patel" }, "Raj Patel"], [{ Display_Name: "Sol Vega" }, "Sol Vega"]] as const) {
      expect(personProblems([plant("fixtures/drafts/planted.json", JSON.stringify({ authors: [entry] }))]), name).toEqual([`fixtures/drafts/planted.json: authors "${name}" has no SAMPLE marker`]);
    }
    expect(personProblems([plant("fixtures/drafts/planted.json", JSON.stringify({ authors: [{ author: { name: "Li Wei" } }] }))]).map((p) => p.split(": ")[1])).toEqual(['authors "Li Wei" has no SAMPLE marker', 'author "Li Wei" has no SAMPLE marker']);
    expect(personProblems([plant("fixtures/drafts/planted.json", JSON.stringify({ title: "The authors of the paper", note: "creator economy", authored: ["Jane Smith"] }))])).toEqual([]);
    // The Chinese text marks an invented name with full-width brackets: a real-looking marked name fails there too, and a placeholder or an organisation passes.
    expect(personProblems([planted("Jane Smith（SAMPLE）主張，Mira Placeholder（SAMPLE）與 Marlow Labs（SAMPLE）同意。")])).toEqual([
      'fixtures/drafts/planted.json: "Jane Smith（SAMPLE）" is neither a placeholder name nor an organisation',
    ]);
    expect(personProblems([planted("Jane Smith (SAMPLE) said it, and Marlow Labs (SAMPLE), Eastvale University (SAMPLE) and Tomas Specimen (SAMPLE) agree.")])).toEqual([
      'fixtures/drafts/planted.json: "Jane Smith (SAMPLE)" is neither a placeholder name nor an organisation',
    ]);
    expect(personProblems([finding([{ who: "Jane Smith and Mira Placeholder (SAMPLE)" }, { who: "Mira Placeholder (SAMPLED)" }, { who: "Jane Smith" }, { who: "Jane Smith" }], [])]).map((p) => p.split(": ")[1])).toEqual([
      'speaker "Jane Smith and Mira Placeholder (SAMPLE)" is no invented placeholder', 'speaker "Mira Placeholder (SAMPLED)" is no invented placeholder', 'speaker "Jane Smith" is no invented placeholder',
    ]);
    expect(personProblems([plant("fixtures/site-content/briefs/x.json", JSON.stringify({ items: [{ id: "a" }, { deep: { more: [{ reactions: [{ who: "Jane Smith" }] }] } }] }))])).toHaveLength(1);
    for (const name of ["Anne-Marie Smith", "María García", "Émile Zola", "Conan O'Neil", "Conan O\u2019Neil", "Li Wei", "Ana Müller-Smith"]) {
      expect(personProblems([planted(`${name} (SAMPLE) spoke.`)]), name).toEqual([`fixtures/drafts/planted.json: "${name} (SAMPLE)" is neither a placeholder name nor an organisation`]);
    }
    expect(personProblems([planted("By Jane Smith, Ravenhurst University. By Tomas Specimen (SAMPLE). By Example Press said so. It rose by Jane Smith.")])).toEqual([
      'fixtures/drafts/planted.json: byline "Jane Smith" has no SAMPLE marker',
    ]);
    expect(personProblems([planted("By Anne-Marie Smith, in 2026. By Example Pressure said so.")]).map((p) => p.split(": ")[1])).toEqual(['byline "Anne-Marie Smith" has no SAMPLE marker', 'byline "Example Pressure" has no SAMPLE marker']);
    expect(personProblems([planted("By Tomas Specimen（SAMPLE） spoke.")])).toEqual([]);
  });

  it("a negative event that names a real organisation fails, in who, in the carrying source's publisher or in its text; an invented actor and a positive event pass", () => {
    const finding = (o: Record<string, unknown>): FixtureText => plant("fixtures/site-content/findings/x.json", JSON.stringify({
      id: "soc-2026-0001", title: "SAMPLE: a title", explainer: { found: "Found.", matters: "It matters." }, who: [{ name: "Example Press (SAMPLE statement)" }],
      sources: [{ id: "s1", publisher: "Example Press" }, { id: "s2", publisher: "Sample Review" }], go_deeper: ["s1"], rung_history: [{ rung: "checked", source_id: "s1" }], kind: "setback", ...o,
    }));
    expect(negativeActorProblems([finding({})])).toEqual([]);
    expect(negativeActorProblems([finding({ who: [{ name: `${realLab} (SAMPLE)` }] })])).toHaveLength(1);
    expect(negativeActorProblems([finding({ sources: [{ id: "s1", publisher: "The journal of the Nature" }, { id: "s2", publisher: "Sample Review" }] })], ["nature"])).toHaveLength(1);
    expect(negativeActorProblems([finding({ title: `${realLab} retracts 84 papers` })])).toHaveLength(1);
    expect(negativeActorProblems([finding({ explainer: { found: `${realLab.toUpperCase()} said so.` } })])).toHaveLength(1);
    const fell = { kind: "result", who: [{ name: "Marlow Labs (SAMPLE)" }], rung_history: [{ rung: "checked", source_id: "s2" }, { rung: "retracted", source_id: "s1" }] };
    expect(negativeActorProblems([finding({ ...fell, sources: [{ id: "s1", publisher: realLab }, { id: "s2", publisher: "Sample Review" }] })])).toHaveLength(1);
    expect(negativeActorProblems([finding({ ...fell, sources: [{ id: "s1", publisher: "Sample Review" }, { id: "s2", publisher: realLab }] })])).toEqual([]);
    expect(negativeActorProblems([finding({ kind: "result", rung_history: [{ rung: "checked", source_id: "s1" }], who: [{ name: `${realLab} (SAMPLE)` }] })])).toEqual([]);
    expect(negativeActorProblems([finding({ title: "The Naturalist Society" })], ["nature"])).toEqual([]);
    const fall = (o: Record<string, unknown>): FixtureText => finding({ kind: "result", who: [{ name: "Marlow Labs (SAMPLE)" }], ...o });
    const src = (id: string, publisher: string): { id: string; publisher: string } => ({ id, publisher });
    expect(negativeActorProblems([fall({ rung_history: [{ rung: "disputed", source_id: "s1" }], sources: [src("s1", realLab)] })])).toHaveLength(1);
    expect(negativeActorProblems([finding({ go_deeper: [], sources: [src("s1", realLab)] })])).toHaveLength(1);
    expect(negativeActorProblems([finding({ rung_history: [{ rung: "checked", source_id: "s2" }], go_deeper: ["s1"], sources: [src("s1", realLab), src("s2", "Sample Review")] })])).toHaveLength(1);
    expect(negativeActorProblems([finding({ sources: undefined, who: [{ name: `${realLab} (SAMPLE)` }] })])).toEqual([]);
    const bad = finding({ who: [{ name: `${realLab} (SAMPLE)` }] });
    expect(negativeActorProblems([plant(bad.file, JSON.stringify({ items: [{ id: "x" }, { deep: { more: [bad.value] } }] }))])).toHaveLength(1);
    expect(negativeActorProblems([finding({ title: `${realLab} retracts`, who: [{ name: `${realLab} (SAMPLE)` }] })])).toHaveLength(1);
    expect(realNameIn("by the NATURE group", ["nature"])).toBe("nature");
    expect(["a naturalist", "denature", "natures", "the Nature2 line"].map((t) => realNameIn(t, ["nature"]))).toEqual([null, null, null, null]);
    expect(["(Nature)", "Nature, a journal", "x-nature-y"].map((t) => realNameIn(t, ["nature"]))).toEqual(["nature", "nature", "nature"]);
  });

  it("a model identifier of any family or a model flag fails; the CLI's package name does not", () => {
    for (const sample of MODEL_SAMPLES) expect(modelProblems([planted(`ran on ${sample.toUpperCase()}`)]), sample).toEqual([expect.stringMatching(/^fixtures\/drafts\/planted\.json: a model identifier \(.+\)$/)]);
    expect(modelProblems([planted("@anthropic-ai/claude-code@2.1.316 and unveiling-claude-oauth")])).toEqual([]);
    expect(modelProblems([plant("fixtures/drafts/planted.json", `{"a":"\\u0063${MODEL_SAMPLES[0]!.slice(1)}"}`)])).toEqual([expect.stringContaining("a model identifier")]);
    // The failure shows the string, not only the file.
    expect(modelProblems([planted(`ran on ${MODEL_SAMPLES[0]}`)])).toEqual([`fixtures/drafts/planted.json: a model identifier (${MODEL_SAMPLES[0]!.split("-").slice(0, 2).join("-")})`]);
  });

  it("a credential-shaped string fails, found in a string of a JSON file and in a whole text file", () => {
    const secret = ["gh", "p_", "UTSAMPLE".repeat(4), "0000"].join("");
    expect(secretProblems([planted(`key ${secret}`)])).toEqual(["fixtures/drafts/planted.json: a GitHub token"]);
    expect(secretProblems([plant("fixtures/injection/pack.md", `key ${secret}`)])).toEqual(["fixtures/injection/pack.md: a GitHub token"]);
    expect(secretProblems([planted("a sk-telecom-breach-2026 slug and AKIA in words")])).toEqual([]);
    expect(secretProblems([plant("fixtures/drafts/planted.json", JSON.stringify({ a: `key ${secret}`, b: `again ${secret}` }))])).toEqual(["fixtures/drafts/planted.json: a GitHub token"]);
  });

  it("a JWT, a bearer credential and a key or password assigned in text fail too, by kind and never by the match; prose that names them does not", () => {
    for (const p of EXTRA_SECRETS) for (const hit of p.hits) expect(secretProblems([planted(`text ${hit} text`)]), `${p.name}: ${hit}`).toEqual([`fixtures/drafts/planted.json: ${p.name}`]);
    for (const ok of ["A password is a secret, and a bearer of news carries a token of thanks.", "the API key: see the docs", "password=short", "eyJ is how a JWT starts", "Bearer of bad news and more words here", "bearer shortvalue123", "password=abcdefg"]) {
      expect(secretProblems([planted(ok)]), ok).toEqual([]);
    }
    expect(secretProblems([plant("fixtures/injection/pack.md", "Authorization: Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a0")])).toEqual(["fixtures/injection/pack.md: a bearer credential"]);
  });

  it("DUAL_USE's detectors fail a sequence, an agent with a method, an agent with a quantity and numbered steps, in any string; ordinary prose passes", () => {
    const agent = config.dualUse.agents[0]!.en[0]!;
    const method = config.dualUse.procedures[0]!.en[0]!;
    const unit = config.dualUse.units[0]!.en[0]!;
    const run = ["ACGT", "ACGT", "ACGT", "ACGT", "ACGT"].join("");
    const hit = (text: string): string[] => dualUseProblems([planted(text)], FORMS).map((p) => p.replace("fixtures/drafts/planted.json: ", ""));
    expect(hit(`A made-up run ${run} here.`)).toEqual(["a nucleotide sequence"]);
    expect(hit("A made-up protein MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVV here.")).toEqual(["an amino-acid sequence"]);
    expect(hit(`The note about ${agent} gives the ${method}.`)).toEqual(["an agent with a method or a quantity"]);
    expect(hit(`The note about ${agent} lists 5 ${unit}.`)).toEqual(["an agent with a method or a quantity"]);
    expect(hit("1. Mix the parts. 2. Wait a day.")).toEqual(["numbered steps"]);
    expect(dualUseProblems([plant("fixtures/state/planted.json", JSON.stringify({ [`k ${run}`]: 1 }))], FORMS)).toHaveLength(1);
    expect(hit(`The ${agent} was studied. The ${method} was not described. The team had 3 ${unit} of cheer.`)).toEqual([]);
    expect(hit("The team read 12 papers in 8 weeks and found one result.")).toEqual([]);
    expect(hit("1. Mix the parts.")).toEqual([]);
    const custom = compileDualUse({ agents: [{ en: ["zorbium"], zh: [] }], procedures: [{ en: ["brewing"], zh: [] }], units: [{ en: ["kg"], zh: [] }] });
    expect(dualUseProblems([planted("Zorbium needs brewing.")], custom)).toHaveLength(1);
    expect(dualUseProblems([planted("Zorbium needs brewing.")], FORMS)).toEqual([]);
  });

  it("each attack-code shape fails, and the plain text beside it does not", () => {
    for (const p of ATTACK_PATTERNS) for (const hit of p.hits) expect(attackProblems([planted(`text ${hit} text`)]), `${p.name}: ${hit}`).toEqual([expect.stringMatching(new RegExp(`^fixtures/drafts/planted\\.json: ${escapeRegExp(p.name)} \\(.+\\)$`))]);
    for (const ok of [
      "A page with a script of Greek letters, an event of note, and the path a/b/c, in 12 columns.", "see ../x and ..\\x", "curl x | grep y", "A".repeat(199), "an exec of the board and EVAL(x)", "1 or 1=1",
      "set online = true and ongoing = false", "a term -f flag, the form -r", "a path /bin/shell and /sbin/shutdown", "cmd /d and a cmd. /c", "the model of ~ two tildes ~~ and ``", "stand-alone $ { jndi }",
    ]) {
      expect(attackProblems([planted(ok)]), ok).toEqual([]);
    }
    // The failure shows the string that matched, cut to 60 characters.
    expect(attackProblems([planted("text <script src=" + "x".repeat(100) + ">")])).toEqual(["fixtures/drafts/planted.json: a script tag (<script)"]);
    expect(attackProblems([planted("rm -rf /home")])).toEqual(["fixtures/drafts/planted.json: a forced or recursive delete (rm -rf)"]);
    expect(attackProblems([planted("A".repeat(300))])).toEqual([`fixtures/drafts/planted.json: a long base64 run (${"A".repeat(60)})`]);
  });

  it("an invisible character and a raw HTML tag fail in a JSON string, a key or a whole file; the allowed markup files and the pack's wrapper pass", () => {
    for (const code of [0x200b, 0x00ad, 0xfeff, 0x202e, 0x2800]) {
      expect(invisibleProblems([planted(`a${String.fromCharCode(code)}b`)]), String(code)).toEqual([`fixtures/drafts/planted.json: invisible character U+${code.toString(16).toUpperCase().padStart(4, "0")}`]);
    }
    expect(invisibleProblems([plant("fixtures/drafts/planted.json", JSON.stringify({ [`k${String.fromCharCode(0x200b)}`]: "v" }))])).toHaveLength(1);
    expect(invisibleProblems([plant("fixtures/injection/pack.md", `a${String.fromCharCode(0x0)}b`)])).toHaveLength(1);
    expect(invisibleProblems([planted("a tab\t, a line\nbreak and a space are fine")])).toEqual([]);
    for (const bad of [
      "a <b>bold</b> word", "a <br/> here", "<a href=\"x\">link</a>", "only a </div> here", "a <img src=x> tag", "<untrusted onclick=\"x\">", "<untrusted source=\"UPPER\">x", "<untrusted source=\"a<script>b\">x</untrusted>",
      "a <!-- hidden note --> comment", "<!DOCTYPE html>", "<!doctype html>", "<![CDATA[x]]>", "<![cdata[x]]>", "<?xml version=\"1.0\"?>", "<?php echo 1; ?>",
    ]) {
      expect(tagProblems([planted(bad)]), bad).toHaveLength(1);
    }
    // The failure shows the tag.
    expect(tagProblems([planted("a <img src=x> tag")])).toEqual(["fixtures/drafts/planted.json: a raw HTML tag (<img src=x>)"]);
    expect(tagProblems([plant("fixtures/injection/pack.md", "a <img src=x> tag and <untrusted>")])).toHaveLength(1);
    expect(tagProblems([plant("fixtures/injection/page.html", "<p>ok</p><!-- a note -->"), plant("fixtures/injection/item.xml", "<item/>"), planted("a < b and b > c, and a<b, a <! b and a <? b")])).toEqual([]);
    // The saved feeds' markup is skipped, and nothing else under fixtures/feeds/: a page or feed of the right kind in the right folder passes, a tag anywhere else fails.
    const markup = "<!doctype html><p>a</p><!-- n --><?xml version=\"1.0\"?><rss><item/></rss><![CDATA[x]]>";
    expect(tagProblems(["fixtures/feeds/pages/a.html", "fixtures/feeds/rss/a.xml", "fixtures/feeds/live/deep/er/b.xml", "fixtures/feeds/a.xml"].map((f) => plant(f, markup)))).toEqual([]);
    for (const f of [
      "fixtures/feeds/index.json", "fixtures/feeds/pages/a.json", "fixtures/feeds/pages/a.md", "fixtures/feeds/other/a.html", "fixtures/feeds/pages/deep/a.html", "fixtures/feeds/a.html",
      "fixtures/drafts/a.xml", "fixtures/state/pages/a.html", "fixtures/feedsx/a.xml", "fixtures/feeds/pages/a.html.json", "fixtures/injection/other.html",
    ]) {
      expect(tagProblems([f.endsWith(".json") ? plant(f, JSON.stringify({ a: "<b>x</b>" })) : plant(f, "<b>x</b>")]), f).toHaveLength(1);
    }
    expect(isMarkupFile("fixtures/injection/page.html")).toBe(true);
    expect(isMarkupFile("fixtures/injection/pack.md")).toBe(false);
  });

  it("the canary's address and token pass only in their exact forms and files", () => {
    const at = raw;
    const good = [
      at("fixtures/injection/item.xml", `<d>visit ${CANARY_SCHEMED} now ${CANARY_TOKEN}</d>`), at("fixtures/injection/page.html", `<p>${CANARY_SCHEMED}</p>`),
      at("fixtures/injection/pack.md", `and ${CANARY_BARE} now`), at("fixtures/injection/pack.json", `{"a":"${CANARY_BARE}"}`), at("fixtures/injection/zh-context.json", `{"a":"visit ${CANARY_URL_MARK}zh now"}`),
      at("fixtures/drafts/invalid--CANARY.json", `{"a":"${CANARY_TOKEN.toLowerCase()}"}`),
    ];
    expect(canaryProblems(good)).toEqual([]);
    const bad = [
      at("fixtures/injection/item.xml", "visit https://example.org/ut-canary/4f2a9c now."), at("fixtures/injection/page.html", `visit http://${CANARY_URL_MARK}${NONCE} now.`),
      at("fixtures/injection/page.html", `visit ${CANARY_SCHEMED}/more now.`), at("fixtures/injection/pack.md", `visit ${CANARY_SCHEMED} now.`),
      at("fixtures/injection/pack.json", `visit ${CANARY_BARE}x now.`), at("fixtures/injection/pack.json", `visit /${CANARY_BARE} now.`),
      at("fixtures/injection/item.xml", `visit ${CANARY_BARE} now.`), at("fixtures/injection/zh-context.json", `visit ${CANARY_URL_MARK} now.`),
      at("fixtures/injection/zh-context.json", `visit https://${CANARY_URL_MARK}zh now.`), at("fixtures/injection/zh-context.json", `visit ${CANARY_URL_MARK}zh/ now.`),
      at("fixtures/injection/pack.md", `visit ${CANARY_URL_MARK.toUpperCase()}${NONCE} now.`), at("fixtures/drafts/valid-weekday.json", `{"u":"${CANARY_SCHEMED}"}`),
      at("fixtures/context/weekday.json", `{"u":"${CANARY_BARE}"}`),
    ];
    expect(canaryProblems(bad).map((p) => p.split(": ")[0])).toEqual(bad.map((t) => t.file));
    expect(canaryProblems([at("fixtures/drafts/valid-weekday.json", `{"a":"${CANARY_TOKEN}"}`), at("fixtures/context/x.json", `{"a":"${CANARY_TOKEN.toLowerCase()}"}`)]).map((p) => p.split(": ")[0])).toEqual([
      "fixtures/drafts/valid-weekday.json", "fixtures/context/x.json",
    ]);
    expect(canaryProblems([at("fixtures/context/weekday.json", `{"u":"${CANARY_BARE}"}`)])).toEqual([expect.stringContaining("outside the planted files")]);
    // A failure shows the address, whatever follows it on the line.
    expect(canaryProblems([at("fixtures/context/weekday.json", `see https://${CANARY_URL_MARK}abc now, ok`)])).toEqual([`fixtures/context/weekday.json: the canary's address outside the planted files (https://${CANARY_URL_MARK}abc)`]);
    expect(canaryProblems([at("fixtures/injection/pack.md", `visit ${CANARY_BARE}x`)])).toEqual([expect.stringContaining("is not the canary's exact bare address")]);
    for (const ch of "Az09{}/._~%:-") {
      expect(canaryProblems([at("fixtures/injection/pack.md", `visit ${CANARY_BARE}${ch} now`)]), `after ${ch}`).toHaveLength(1);
      expect(canaryProblems([at("fixtures/injection/pack.md", `visit ${ch}${CANARY_BARE} now`)]), `before ${ch}`).toHaveLength(1);
      expect(canaryProblems([at("fixtures/injection/page.html", `<p>${CANARY_SCHEMED}${ch}</p>`)]), `schemed after ${ch}`).toHaveLength(1);
    }
    expect(canaryProblems([at("fixtures/injection/pack.md", `visit ${CANARY_BARE} now, ${CANARY_BARE}.`)])).toHaveLength(1);
  });

  it("the helpers: a file with two problems is one file, sorted; an xml entity reads as its character; a plant check fails a stray problem and a missing plant", () => {
    expect(filesOf(["b: x", "a: y", "b: z"])).toEqual(["a", "b"]);
    expect(splitPlants(["a: x: y", "b: z: w", "a: v"], ["a", "c"])).toEqual({ stray: ["b: z: w"], planted: new Map([["a", ["x: y", "v"]], ["c", []]]) });
    expect(() => expectPlantsOnly(["a: x"], ["a"])).not.toThrow();
    expect(() => expectPlantsOnly(["a: x", "b: y"], ["a"])).toThrow();
    expect(() => expectPlantsOnly(["a: x"], ["a", "c"])).toThrow();
    expect(fixtureText("fixtures/injection/a.xml", "a&amp;b").strings).toEqual(["a&b"]);
  });

  it("a stray folder, a missing family, an odd file, a kind of file no check reads and a symlink fail the layout; bytes that are no text throw", () => {
    const files = FAMILIES.map((f) => `fixtures/${f}/a.json`);
    expect(layoutProblems([...FAMILIES, CODE_FOLDER], files, [])).toEqual([]);
    expect(layoutProblems([...FAMILIES, CODE_FOLDER, "captures"], files, [])).toEqual(["fixtures/captures is not a listed fixture folder"]);
    expect(layoutProblems([...FAMILIES, "stray.json"], files, [])).toEqual(["fixtures/stray.json is not a listed fixture folder"]);
    expect(layoutProblems(FAMILIES.slice(1), files, [])).toEqual([`fixtures/${FAMILIES[0]} is missing`]);
    expect(layoutProblems(FAMILIES, files.slice(1), [])).toEqual([`fixtures/${FAMILIES[0]} holds no file`]);
    expect(layoutProblems(FAMILIES, [...files, "fixtures/state/x.gz", "fixtures/state/y.png"], [])).toEqual(["fixtures/state/x.gz is not a kind of file the scan reads", "fixtures/state/y.png is not a kind of file the scan reads"]);
    expect(layoutProblems(FAMILIES, files, ["fixtures/state/link"])).toEqual(["fixtures/state/link is neither a file nor a folder"]);
    expect(() => decode(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), "fixtures/state/x.json")).toThrow("fixtures/state/x.json is not UTF-8 text");
    expect(decode(Buffer.from("plain text, 中文"))).toBe("plain text, 中文");
    // A failure names the file; a byte order mark stays in the text, so a JSON file with one fails and any other file fails the invisible-character check.
    expect(() => fixtureText("fixtures/state/x.json", "{ not json")).toThrow(/^fixtures\/state\/x\.json is not valid JSON: /);
    const bom = decode(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
    expect(bom.charCodeAt(0)).toBe(0xfeff);
    expect(() => fixtureText("fixtures/state/bom.json", bom)).toThrow("fixtures/state/bom.json is not valid JSON");
    expect(invisibleProblems([fixtureText("fixtures/injection/bom.md", decode(Buffer.from([0xef, 0xbb, 0xbf, 0x61])))])).toEqual(["fixtures/injection/bom.md: invisible character U+FEFF"]);
  });

  it("the listing reads a real tree: nested files, a symlink as odd, a stray folder and a stray file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-safety-"));
    try {
      fs.mkdirSync(path.join(dir, "fixtures"));
      expect(listFixtures(dir)).toEqual({ entries: [], files: [], odd: [] });
      for (const f of FAMILIES) fs.mkdirSync(path.join(dir, "fixtures", f), { recursive: true });
      fs.mkdirSync(path.join(dir, "fixtures", "context", "deep", "er"), { recursive: true });
      fs.writeFileSync(path.join(dir, "fixtures", "context", "deep", "er", "a.json"), "{}");
      fs.mkdirSync(path.join(dir, "fixtures", "captures"));
      fs.writeFileSync(path.join(dir, "fixtures", "captures", "a.xml"), "<a/>");
      fs.writeFileSync(path.join(dir, "fixtures", "feeds", "b.xml"), "<b/>");
      fs.writeFileSync(path.join(dir, "fixtures", "stray.txt"), "x");
      fs.symlinkSync(path.join(dir, "fixtures", "stray.txt"), path.join(dir, "fixtures", "state", "link.json"));
      const list = listFixtures(dir);
      expect(list.files).toEqual(["fixtures/context/deep/er/a.json", "fixtures/feeds/b.xml"]);
      expect(list.odd).toEqual(["fixtures/state/link.json"]);
      expect(list.entries).toContain("captures");
      expect(layoutProblems(list.entries, list.files, list.odd)).toEqual(expect.arrayContaining(["fixtures/captures is not a listed fixture folder", "fixtures/stray.txt is not a listed fixture folder"]));
      expect(layoutProblems(list.entries, list.files, list.odd)).not.toContain("fixtures/feeds is not a listed fixture folder");
      expect(fixtureSizes(dir).map((s) => s.file)).toContain("fixtures/captures/a.xml");
      expect(readTexts(dir, list.files).map((t) => t.value)).toEqual([{}, undefined]);
      fs.writeFileSync(path.join(dir, "fixtures", "context", "bad.md"), Buffer.from([0x61, 0xff, 0x62]));
      expect(() => readTexts(dir, ["fixtures/context/bad.md"])).toThrow("fixtures/context/bad.md is not UTF-8 text");
      fs.writeFileSync(path.join(dir, "fixtures", "context", "bad.json"), "{ not json");
      expect(() => readTexts(dir, ["fixtures/context/bad.json"])).toThrow("fixtures/context/bad.json is not valid JSON");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a file over 1 MB or a whole over 6 MB fails the size check; the limits sit between what is and what a runaway capture would be", () => {
    expect(sizeProblems([{ file: "a", bytes: MB - 1 }, { file: "b", bytes: 10 }])).toEqual([]);
    expect(sizeProblems([{ file: "a", bytes: MB }])).toEqual([`a: ${MB} bytes`]);
    expect(sizeProblems(Array.from({ length: 7 }, (_, i) => ({ file: `f${i}`, bytes: MB - 1 })))).toEqual([`fixtures/: ${7 * (MB - 1)} bytes in all`]);
    const six = Array.from({ length: 6 }, (_, i) => ({ file: `f${i}`, bytes: MB - 1 }));
    expect(sizeProblems([...six, { file: "g", bytes: 5 }])).toEqual([]);
    expect(sizeProblems([...six, { file: "g", bytes: 6 }])).toEqual([`fixtures/: ${6 * MB} bytes in all`]);
  });
});
