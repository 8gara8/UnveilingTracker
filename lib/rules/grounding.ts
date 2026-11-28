// Grounding (SPEC §4.12): ARTEFACT_FORMAT, QUOTE_VERBATIM and NUMBER_SOURCED, the hard rules that tie what the model wrote to what
// the run saw. A code goes in one rule only, so each row is one rule with two parts. The fixed limits and formats read the record
// alone and run in every mode: an artefact's form (§4.3) and a quote of at most 25 words judge every stored finding too, the
// records being published and the others, and the text a correction puts at an artefact or a quote path (`rewritesAt()`: the
// draft's own corrections, every stored one in published mode). The tests that read the run's evidence run in draft mode only and
// skip themselves when the run has none (`uses`): that each artefact appears in a cited source's URL or fetched text, and that each
// quote is in the fetched text of the source it cites. NUMBER_SOURCED is all evidence, so it is a draft-mode rule that needs it. A
// source's fetched text is `seenText()`, the evidence's text for its URL (the opening paragraph of §4.12); `evidenceOf()` is null
// when the run has none, and always in published mode. None of the three reads `config/` and none is an archive warning, so they
// stay errors on every record. A place a stored `removed` correction rewrote is skipped: a finding view's `removed` set names an
// artefact or a quote, a `removed` correction's own `after` is no text to judge while it is `REMOVED_TEXT`, and the string selector of
// NUMBER_SOURCED leaves out a prose string (§4.12 "Removed text"). The rules judge each finding's own record from its view, and NUMBER_SOURCED a finding's
// string by the view that holds it, so each finding is judged against its own sources, also when two new findings of a draft share a
// ref (REF_UNKNOWN reports that, and `Views.find()` can then name only one of them).
//
// Which sources a number may come from (§4.12 says "a cited source"): a finding's own prose, the finding's own sources; brief-level
// prose, the brief's sources and the sources of the findings it concerns (a Lead line's refs, an update's, rung note's, deep dive's
// or remarkable note's finding, a correction's finding) and, for a correction, the page its `source_url` names; and for every string
// the `quotable` figures of the context and of the metrics file, matched exactly. A number inside a link is no number, in our prose
// or on a page. `numbersIn()` reads 1990 to 2099 as a year, so a page's bare "2000" is kept apart and shows our "2,000" or "2 thousand",
// the same count written another way, which §4.12's example pair needs.
//
// New for this project. The patterns are those of Cyber's lib/rules/snapshots.ts at the fork commit 3ced1fb (its number and quote
// gates: a pool of the numbers of the seen text, `numberMatches()`'s rounding rule with units, a quote folded before it is searched
// for), which were soft gates there and are hard here; the artefact tests have no counterpart in Cyber.

import { ID_PATTERNS } from "../schema/common";
import { blankUrls, countWords, escapeRegExp, foldQuote, numberMatches, numbersIn, quoteInText, type NumberToken } from "../text";
import { normalizeDoi, normalizeUrl } from "../urls";
import { evidenceOf, extendPath, isDraft, resolveSource, seenText, shown } from "./shared";
import { isRemovedText, modelProse, type StringEntry } from "./strings";
import { defineRule, error, list, plural, type DraftInput, type Rule, type RuleInput, type ValidationIssue } from "./types";
import type { FindingView, Views } from "./views";

/** A quote is at most this many words: an evidence quote, a reaction's and a `licence_quote` (§4.3). */
const QUOTE_MAX_WORDS = 25;

/** A letter or digit, as a RegExp source. */
const ALNUM = "[\\p{L}\\p{N}]";

/**
 * A letter or number of Han, Hiragana, Katakana or Hangul, the scripts that write words with no space between them. Read by script
 * extensions, so the prolonged sound mark and the iteration marks count with their script. The lookahead leaves out the marks and
 * the punctuation that those scripts' extensions also take from other scripts' text (a middle dot, the combining marks of an
 * accented Latin letter), and so the ideographic comma and full stop and the other CJK punctuation count nothing.
 */
const CJK_LETTER = /(?=[\p{L}\p{N}])[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}]/gu;

/**
 * The words of a quote, which §4.3 limits to QUOTE_MAX_WORDS: `countWords()` of the quote with each Han, Hiragana, Katakana or Hangul
 * letter or number set aside as a space, plus one word for every two of those characters, rounded up. `countWords()` alone reads an
 * unspaced run of them as one word, so a Chinese, Japanese or Korean quote of any length would pass. The text is read in NFKC, the
 * form a quote is compared in (`foldQuote()`), so a squared compatibility character (a whole katakana word in one box) counts as the
 * letters it stands for, and a half-width kana with its voiced mark or a decomposed Hangul syllable as the one character it makes.
 * A text with none of them has the words `countWords()` gives it; a link counts nothing, as there.
 */
export function quoteWords(text: string): number {
  const plain = blankUrls(text.normalize("NFKC"));
  const characters = plain.match(CJK_LETTER)?.length ?? 0;
  return countWords(plain.replace(CJK_LETTER, " ")) + Math.ceil(characters / 2);
}

/**
 * `core`, a RegExp source, standing alone in a page, in any case: `before` may not stand just ahead of it and `after` may not stand
 * just behind it (both RegExp sources), unless `prefix`, a RegExp source, stands just ahead of it. The artefact kinds below differ
 * only in what may touch them.
 */
function standalone(core: string, before: string, after: string, prefix?: string): RegExp {
  const start = prefix === undefined ? `(?<!${before})` : `(?:(?<!${before})|(?<=${prefix}))`;
  return new RegExp(`${start}${core}(?!${after})`, "iu");
}

// ── Artefacts ────────────────────────────────────────────────────────────────────────────────────

type ArtefactKind = "doi" | "arxiv" | "lean" | "trial" | "pdb";

/** The kinds of `Artefacts`, in the order of the schema. */
const ARTEFACT_KINDS: readonly ArtefactKind[] = ["doi", "arxiv", "lean", "trial", "pdb"];

interface ArtefactSpec {
  /** The kind as a message names it. */
  readonly label: string;
  /** What a stored value looks like, for a message. */
  readonly form: string;
  /** True when the value is in the stored form (§4.3). */
  readonly valid: (value: string) => boolean;
  /** The value written in the stored form, when it is a known other way of writing it; else null. */
  readonly fixed: (value: string) => string | null;
  /** True when a source at `url` whose fetched text is `text` shows the value. */
  readonly appearsIn: (value: string, url: string, text: string) => boolean;
}

/** The URL as the page's text would show it: no scheme, no `www.`, lower case. */
const leanKey = (url: string): string => normalizeUrl(url).replace(/^https:\/\//, "").toLowerCase();

/** The URL with its percent escapes decoded, which is how a DOI is written in a resolver's path. */
function decoded(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** True for an https URL of a file ending `.lean` on github.com, with no user info, no port and no space (§4.3). */
function isLeanUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === ""
    && url.hostname.replace(/^www\./, "") === "github.com" && url.pathname.endsWith(".lean");
}

/** An arXiv id as the id of a page: written with a label or as a link, which the stored form leaves off. */
const ARXIV_LINKED = /^(?:arxiv:\s*|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?$/i;

/** What stands just ahead of the id in an arXiv paper's own DOI (`10.48550/arXiv.2501.01234`), which SPEC §5.9 reads as the id's carrier too. */
const ARXIV_DOI_PREFIX = "10\\.48550/arxiv\\.";

const ARTEFACTS: Readonly<Record<ArtefactKind, ArtefactSpec>> = {
  doi: {
    label: "DOI",
    form: "10.NNNN/suffix in lower case, without https://doi.org/",
    valid: (v) => ID_PATTERNS.doi.test(v) && v === v.toLowerCase(),
    fixed: (v) => normalizeDoi(v),
    // A longer DOI runs on from this one by a letter or digit, or by a dot, hyphen, underscore or slash and then one; a preprint
    // server's address adds a version after it ("10.1101/2026.09.02.990011v1").
    appearsIn: (v, url, text) => {
      const re = standalone(`${escapeRegExp(v)}(?:v\\d+)?`, ALNUM, `${ALNUM}|[.\\-_/]${ALNUM}`);
      return re.test(decoded(url)) || re.test(text);
    },
  },
  arxiv: {
    label: "arXiv id",
    form: "four digits, a dot and four or five digits, then optionally v and a number (2501.01234)",
    valid: (v) => ID_PATTERNS.arxiv.test(v),
    fixed: (v) => ARXIV_LINKED.exec(v.trim())?.[1] ?? null,
    // Matched without the version, in a label ("arXiv:2501.01234v2"), a path ("/abs/2501.01234", "/pdf/2501.01234v1.pdf") or the
    // paper's own DOI ("10.48550/arXiv.2501.01234"), whose dot before the id is no part of a longer number.
    appearsIn: (v, url, text) => {
      const re = standalone(`${escapeRegExp(v.replace(/v\d+$/, ""))}(?:v\\d+)?`, "[\\p{L}\\p{N}.]", `${ALNUM}|\\.\\d`, ARXIV_DOI_PREFIX);
      return re.test(url) || re.test(text);
    },
  },
  lean: {
    label: "Lean file URL",
    form: "the https URL of a .lean file on github.com",
    valid: isLeanUrl,
    fixed: () => null,
    appearsIn: (v, url, text) => leanKey(url) === leanKey(v) || standalone(escapeRegExp(leanKey(v)), ALNUM, ALNUM).test(text),
  },
  trial: {
    label: "NCT number",
    form: "NCT and eight digits (NCT01234567)",
    valid: (v) => ID_PATTERNS.trial.test(v),
    fixed: (v) => v.trim().toUpperCase(),
    appearsIn: (v, url, text) => {
      const re = standalone(escapeRegExp(v), ALNUM, ALNUM);
      return re.test(url) || re.test(text);
    },
  },
  pdb: {
    label: "PDB id",
    form: "a digit and three lower-case letters or digits (1abc), or pdb_ and eight (pdb_00001abc)",
    valid: (v) => ID_PATTERNS.pdb.test(v),
    fixed: (v) => v.trim().toLowerCase(),
    appearsIn: (v, url, text) => {
      const re = standalone(escapeRegExp(v), "[\\p{L}\\p{N}_]", "[\\p{L}\\p{N}_]");
      return re.test(url) || re.test(text);
    },
  },
};

/** The ids of a list of sources for a message. */
const idsOf = (sources: readonly { readonly id: string }[]): string => (sources.length === 0 ? "none" : list(sources.map((s) => s.id)));

/** The findings whose own record a run judges: every view but a context one, which holds only part of a stored finding (a draft's stored finding is one). */
const judged = (input: RuleInput): FindingView[] => input.views.findings.filter((view) => view.basis !== "context");

/** The issue for an artefact of `kind`, written `value`, that is not in its stored form (§4.3), or null when it is. `path` is where it points. */
function formIssue(kind: ArtefactKind, value: string, path: string): ValidationIssue | null {
  const spec = ARTEFACTS[kind];
  if (spec.valid(value)) return null;
  const fix = spec.fixed(value);
  return error("ARTEFACT_FORMAT", path,
    `The ${spec.label} "${shown(value)}" is not in the stored form: ${spec.form}. ${fix !== null && spec.valid(fix) ? `Write it as ${shown(fix)}.` : "Correct it, or take it out."}`,
    "A finding stores each artefact in one form (SPEC §4.3): a DOI in lower case without https://doi.org/, an arXiv id, an NCT number, a PDB id and the https URL of a Lean file on github.com.");
}

// ── A correction's text at an artefact or a quote ────────────────────────────────────────────────

/** The path of a correction that rewrites an artefact (`artefacts.doi.0`), with its kind captured. */
const ARTEFACT_PATH = new RegExp(`^artefacts\\.(${ARTEFACT_KINDS.join("|")})\\.(?:0|[1-9][0-9]*)$`);

/** The path of a correction that rewrites a quote: an evidence quote, a reaction's or the figure's `licence_quote`. */
const QUOTE_PATH = /^(?:ai\.evidence\.(?:0|[1-9][0-9]*)\.quote|reactions\.(?:0|[1-9][0-9]*)\.quote|figure\.licence_quote)$/;

/** One text that a correction puts at a path: the match of the pattern, the English text and the issue path of that text. */
interface Rewrite {
  readonly match: RegExpExecArray;
  readonly text: string;
  readonly path: string;
}

/**
 * The corrections whose path `pattern` matches, but a `removed` one whose `after` is `REMOVED_TEXT` (which every rule skips, §4.12
 * "Removed text"; `isRemovedText()`, the one definition: a stored `after` in both languages, a draft's in English): the draft's own in
 * draft mode, every stored one in published mode (`Views.corrections`). A correction typed `removed` whose `after` holds other text is
 * judged like any other, so the type alone never skips a text. The text is the `after`, a plain string in a draft and the `en` of an
 * `L10n` in a stored correction.
 */
function rewritesAt(views: Views, pattern: RegExp): Rewrite[] {
  const out: Rewrite[] = [];
  for (const c of views.corrections) {
    const match = pattern.exec(c.path);
    if (match === null || (c.type === "removed" && isRemovedText(c.draft ? c.after.en : c.after))) continue;
    out.push({ match, text: c.after.en, path: c.draft ? extendPath(c.where, "after") : extendPath(c.where, "after", "en") });
  }
  return out;
}

/**
 * ARTEFACT_FORMAT: each artefact of a finding is in its stored form (§4.3), in every mode and on every stored record; in draft mode,
 * with the run's evidence, each also appears in the URL or the fetched text of a source the finding cites. An artefact is the
 * finding's own record, so the finding's own sources are the ones that count. A value of the wrong form is not looked for. A
 * correction that rewrites an artefact (`artefacts.doi.0`) puts the text in `after`, so each such `after` is judged for its form
 * alone, in every mode and on every stored correction: a correction names no source to look for it in.
 */
const artefactFormat = defineRule({
  code: "ARTEFACT_FORMAT",
  scope: ["draft", "published"],
  uses: ["evidence"],
  check: (input) => {
    const out: ValidationIssue[] = [];
    const judgeAppearance = evidenceOf(input) !== null;
    for (const f of judged(input)) {
      const sources = f.sources!;
      const pages = sources.map((s) => ({ url: s.url, text: seenText(input, s.url) }));
      for (const kind of ARTEFACT_KINDS) {
        const spec = ARTEFACTS[kind];
        f.artefacts![kind].forEach((value, i) => {
          const at = `artefacts.${kind}.${i}`;
          if (f.removed.has(at)) return;
          const wrong = formIssue(kind, value, f.where(at));
          if (wrong !== null) {
            out.push(wrong);
            return;
          }
          if (!judgeAppearance || pages.some((p) => spec.appearsIn(value, p.url, p.text))) return;
          const unread = pages.length > 0 && pages.every((p) => p.text.trim() === "");
          out.push(error("ARTEFACT_FORMAT", f.where(at),
            `The ${spec.label} "${shown(value)}" appears in the URL or fetched text of none of this finding's sources (${idsOf(sources)})${unread ? ", and none of them has fetched text" : ""}.`,
            "An artefact is the finding's own record, such as its paper's DOI or its preprint's arXiv id. Cite the page that shows it among the finding's sources, or take the artefact out; never write one from memory."));
        });
      }
    }
    for (const r of rewritesAt(input.views, ARTEFACT_PATH)) {
      const wrong = formIssue(r.match[1] as ArtefactKind, r.text, r.path);
      if (wrong !== null) out.push(wrong);
    }
    return out;
  },
});

// ── Quotes ───────────────────────────────────────────────────────────────────────────────────────

/** One quote of a finding's record: its place in the finding (a correction's dotted form), its words and the id of the source it cites. */
interface Quote {
  readonly at: string;
  readonly text: string;
  readonly source_id: string;
}

/**
 * The quotes a finding's record holds, in the order of its record: each evidence quote, each reaction's and the figure's
 * `licence_quote`, leaving out a place that a stored `removed` correction rewrote. A finding view holds them in full, so each
 * finding is held to its own sources. A correction's text at one of these paths is judged by `rewritesAt()`, for its length alone.
 */
function quotesOf(f: FindingView): Quote[] {
  const quotes: Quote[] = [
    ...f.ai!.evidence.map((e) => ({ at: `ai.evidence.${e.index}.quote`, text: e.quote, source_id: e.source_id })),
    ...f.reactions!.map((r) => ({ at: `reactions.${r.index}.quote`, text: r.quote, source_id: r.source_id })),
    ...(f.figure === null ? [] : [{ at: "figure.licence_quote", text: f.figure.licence_quote, source_id: f.figure.source_id }]),
  ];
  return quotes.filter((q) => !f.removed.has(q.at));
}

/** The issue for a quote of `f` at `path` that is not in the fetched text of the source it cites, or null when it is, or cites no source that exists. */
function quoteNotFound(input: RuleInput, f: FindingView, quote: Quote, path: string): ValidationIssue | null {
  const id = quote.source_id;
  const { source } = resolveSource(input.views, f, id);
  if (source === null) return null;
  const text = seenText(input, source.url);
  if (quoteInText(quote.text, text)) return null;
  const hint = "A quote is the source's own words, copied exactly. Fix a quote only by copying it from the page; ignore the case, the spacing, the quotation marks and the dashes, which the check does too.";
  if (foldQuote(quote.text) === "") {
    return error("QUOTE_VERBATIM", path, `The quote has no words once spaces, quotation marks and invisible characters are set aside, so it cannot be found in ${id}. Quote the words themselves.`, hint);
  }
  if (text.trim() === "") {
    return error("QUOTE_VERBATIM", path,
      `The quote cites ${id} (${shown(source.url)}), whose page has no fetched text, so the quote cannot be checked. Cite a source the run could read, or take the quote out.`, hint);
  }
  const elsewhere = f.sources!.filter((s) => quoteInText(quote.text, seenText(input, s.url)));
  return error("QUOTE_VERBATIM", path,
    `The quote is not in the fetched text of ${id} (${shown(source.url)}). Copy it word for word from that page, or cite the source it comes from${elsewhere.length > 0 ? `; it is in the text of ${idsOf(elsewhere)}` : ""}.`,
    hint);
}

/** The issue for a quote of `text`, pointed at `path`, that has more than QUOTE_MAX_WORDS words (`quoteWords()`), or null when it has not. */
function tooLong(text: string, path: string): ValidationIssue | null {
  const words = quoteWords(text);
  if (words <= QUOTE_MAX_WORDS) return null;
  return error("QUOTE_VERBATIM", path,
    `The quote has ${plural(words, "word")}; the limit is ${QUOTE_MAX_WORDS}. Quote a shorter passage, still word for word.`,
    "Quotes are the source's own words and at most 25 words (SPEC §4.3); a Chinese, Japanese or Korean character counts as half a word. Cut the quote to the words that carry the point.");
}

/**
 * QUOTE_VERBATIM: every quote (an evidence quote, a reaction's, a figure's `licence_quote`) is at most 25 words by `quoteWords()`, in
 * every mode and on every stored finding; in draft mode, with the run's evidence, it is also in the fetched text of the source it
 * cites, after `foldQuote()`'s normalisation. A correction that rewrites a quote (`reactions.0.quote`) puts the quote in `after`, so
 * each such `after` is held to the 25 words too, in every mode and on every stored correction, but is not looked for in a page:
 * the correction names no source for it.
 */
const quoteVerbatim = defineRule({
  code: "QUOTE_VERBATIM",
  scope: ["draft", "published"],
  uses: ["evidence"],
  check: (input) => {
    const out: ValidationIssue[] = [];
    const judgeMatch = evidenceOf(input) !== null;
    for (const f of judged(input)) {
      for (const quote of quotesOf(f)) {
        const path = f.where(quote.at);
        const long = tooLong(quote.text, path);
        if (long !== null) out.push(long);
        const missing = judgeMatch ? quoteNotFound(input, f, quote, path) : null;
        if (missing !== null) out.push(missing);
      }
    }
    for (const r of rewritesAt(input.views, QUOTE_PATH)) {
      const long = tooLong(r.text, r.path);
      if (long !== null) out.push(long);
    }
    return out;
  },
});

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────

/** One page that may source a number: how a message names it, and its URL. */
interface Page {
  readonly label: string;
  readonly url: string;
}

const LEAD_AT = /^lead\.(\d+)\.text$/;
const CORRECTION_AT = /^corrections\.(\d+)\.(?:after|reason)$/;

/** The findings of a run, found by the place that begins their paths (`new_findings[10]`) and by key, built once for all the strings. */
interface FindingIndex {
  readonly byPlace: ReadonlyMap<string, FindingView>;
  readonly byKey: ReadonlyMap<string, readonly FindingView[]>;
}

function indexFindings(views: Views): FindingIndex {
  const byPlace = new Map<string, FindingView>();
  const byKey = new Map<string, FindingView[]>();
  for (const f of views.findings) {
    byPlace.set(f.where(), f);
    byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]);
  }
  return { byPlace, byKey };
}

/**
 * The view of the finding whose own record holds `entry`. It is found by the string's path, not by `Views.find()` of the finding's
 * ref: two new findings of a draft may share a ref (REF_UNKNOWN reports that), and `find()` names only the last of them. A path
 * begins with the place of its finding, which ends at the first closing bracket (`new_findings[10]`), so the place of one finding
 * is never the start of another's: `new_findings[1]` is not the start of `new_findings[10]`.
 */
const ownerOf = (index: FindingIndex, entry: StringEntry): FindingView => index.byPlace.get(entry.path.slice(0, entry.path.indexOf("]") + 1))!;

/**
 * The pages whose fetched text may source a number in `entry`: a finding's own string, the finding's own sources; a brief-level
 * string, the brief's sources and the own sources of each finding it concerns (a Lead line's refs, the finding of an update, a
 * rung note, the deep dive, the remarkable note or a correction), and a correction's `source_url`. A ref that two new findings
 * share concerns both of them, so the sources of either show a number. One page once, by its normalised URL.
 */
function pagesFor(views: Views, index: FindingIndex, entry: StringEntry): Page[] {
  const pages: Page[] = [];
  const add = (label: string, url: string): void => {
    if (!pages.some((p) => normalizeUrl(p.url) === normalizeUrl(url))) pages.push({ label, url });
  };
  if (entry.finding !== null) {
    for (const s of ownerOf(index, entry).sources!) add(s.id, s.url);
    return pages;
  }
  for (const s of views.brief.sources) add(s.id, s.url);
  const concerned: string[] = entry.about === null ? [] : [entry.about];
  const lead = LEAD_AT.exec(entry.at);
  if (lead !== null) concerned.push(...views.brief.lead[Number(lead[1])]!.refs);
  const fix = CORRECTION_AT.exec(entry.at);
  const correction = fix === null ? null : views.corrections[Number(fix[1])]!;
  if (correction?.finding_id != null) concerned.push(correction.finding_id);
  for (const key of concerned) {
    for (const f of index.byKey.get(key) ?? []) for (const s of f.sources ?? []) add(`${key} ${s.id}`, s.url);
  }
  if (correction?.source_url != null) add("the correction's source_url", correction.source_url);
  return pages;
}

/** The numbers of `text` one per written form: "5%" twice is one, "1,400" and "about 1,400" are two. */
function distinctNumbers(text: string): NumberToken[] {
  const seen = new Set<string>();
  return numbersIn(blankUrls(text), { words: true }).filter((n) => {
    const key = `${n.raw}|${n.approx}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Numbers written as words up to ten need no source (§4.12). */
const exempt = (n: NumberToken): boolean => n.word && n.value <= 10;

/**
 * A bare 1990 to 2099 standing alone on a page, and no percentage. `numbersIn()` reads it as a year and leaves it out of the page's
 * numbers, so a source's "2000 samples" would not show our "2,000" or "2 thousand" (a figure of ours is never a bare year, so it
 * is read as a number). The page's year shows only the same value, never a rounded one: a "2026" in a date line must not show
 * "about 2,000".
 */
const BARE_YEAR = /(?<![\p{L}\p{N}.,])(?:199\d|20\d\d)(?![\p{L}\p{N}]|[.,]\d|\s?(?:%|per\s?cent\b))/gu;

/** What one cited page shows: its numbers by `numbersIn()` and the bare years in its text, with links left out of both. */
interface PageFigures {
  readonly numbers: readonly NumberToken[];
  readonly years: ReadonlySet<number>;
}

function numberIssues(input: DraftInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const quotable = [...Object.values(input.draft.context.pace.quotable), ...Object.values(input.draft.metrics?.pace.quotable ?? {})]
    .flatMap((figure) => numbersIn(figure, { words: true }));
  const read = new Map<string, PageFigures>();
  const index = indexFindings(input.views);
  const figuresOf = (url: string): PageFigures => {
    const key = normalizeUrl(url);
    const known = read.get(key);
    if (known !== undefined) return known;
    const text = blankUrls(seenText(input, url));
    // NFKC first, as numbersIn() reads it, so a page's full-width digits are the year they are read as there.
    const figures = { numbers: numbersIn(text, { words: true }), years: new Set([...text.normalize("NFKC").matchAll(BARE_YEAR)].map((m) => Number(m[0]))) };
    read.set(key, figures);
    return figures;
  };
  for (const entry of modelProse(input.inventory)) {
    const pages = pagesFor(input.views, index, entry);
    // A page is read only for a number that needs it, so a string with no number (or only words up to ten) reads none.
    const shownBy = (n: NumberToken): boolean => pages.some((p) => {
      const page = figuresOf(p.url);
      return page.numbers.some((t) => t.percent === n.percent && numberMatches(n, t.value)) || (!n.percent && page.years.has(n.value));
    });
    const missing = distinctNumbers(entry.text).filter((n) => !exempt(n)
      && !quotable.some((q) => q.percent === n.percent && q.value === n.value) && !shownBy(n));
    if (missing.length === 0) continue;
    const found = list(missing.map((n) => shown(n.raw)));
    const named = `(${list(pages.map((p) => p.label))})`;
    const unread = pages.every((p) => seenText(input, p.url).trim() === "");
    out.push(error("NUMBER_SOURCED", entry.path,
      pages.length === 0
        ? `This text holds ${found}, but it has no cited source whose fetched text could show ${missing.length === 1 ? "that number" : "those numbers"}.`
        : unread
          ? `This text holds ${found}, but the fetched text of its cited sources ${named} is empty, so ${missing.length === 1 ? "it" : "they"} cannot be checked.`
          : `This text holds ${found}, which the fetched text of no cited source ${named} shows and no quotable figure gives.`,
      "Copy each number as a cited source writes it (2,000 and 2000, 5% and 5 per cent are the same), copy a quotable figure exactly, write a number up to ten as a word, or take the number out. Never add, subtract or compare numbers."));
  }
  return out;
}

/**
 * NUMBER_SOURCED: every number in the model's own prose appears in the fetched text of a cited source (`pagesFor()`) by
 * `numberMatches()`'s rule, a percentage only matching a percentage, or equals a `quotable` figure; a number written as a word up to
 * ten is exempt. Draft mode only, and it needs the run's evidence.
 */
const numberSourced = defineRule({
  code: "NUMBER_SOURCED",
  scope: "draft",
  needs: ["evidence"],
  check: (input) => (isDraft(input) ? numberIssues(input) : []),
});

export const groundingRules: Rule[] = [artefactFormat, quoteVerbatim, numberSourced];
