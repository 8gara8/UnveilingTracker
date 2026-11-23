// Reading grade (SPEC §4.12 READING_LEVEL): countSyllables() and readingGrade(), the Flesch-Kincaid grade level
//
//   grade = 0.39 * (words / sentences) + 11.8 * (syllables / syllable words) - 15.59
//
// of one text, which the validator compares with `reading_grade_soft` (12, a soft gate) and `reading_grade_max` (14,
// a hard one) for each explainer, the Lead, the deep dive and the big picture. Words are countWords() of lib/text.ts
// and sentences are its splitSentences(), the one splitter. As the spec says, a finding's own terms, capitalised names
// inside a sentence and tokens with digits count as words but not in the syllable average (`syllable words` above is
// how many words the average is over). Pure: no clock, file or network. New in P1; Cyber has no reading check.
//
// Counting syllables in English by rule is a heuristic. This one is a vowel-group count with the silent e, -ed, -es,
// -le and -re endings, silent e before a suffix or inside a compound, vowels that make two syllables, a few
// whole-word beginnings (every, some, bio, science) and a short list of words whose final e is spoken (maybe, recipe).
// Measured offline against the CMU Pronouncing Dictionary on this project's own documents (the dictionary is not
// committed), it agrees on 98% of the word tokens, and on 99.6% of those of the style guide and the design, whose
// acronyms are mostly capitals; it counts about 0.010 syllables per word too few, which lowers a grade by about 0.12.
// The known misses are acronyms said as words (NASA counts 4), lower-case acronyms (ids), -ire endings in the past
// tense (inspired), -ian and -iant words, Latin and Greek endings (nucleotide) and names.

import { blankUrls, countWords, splitSentences, wordRe } from "./text";

// ── Syllables ────────────────────────────────────────────────────────────────────────────────────

const WORDISH_RE = /[\p{L}\p{N}]/u;
/** A contraction in n't: the word before it, as in didn't. */
const NT_RE = /^(.+)n['’]t$/i;
/** A word whose final e is spoken (maybe, recipe, apostrophe), which no rule of the ending could tell from a silent one. */
const SPOKEN_E_RE = /^(?:maybe|recipes?|apostrophes?|catastrophes?|epitome|similes?|sesame|finale|karate|adobe|anemones?)$/;
/** An -ier or -iest word that is no comparative (soldier, priest), so its "ie" stays one syllable. */
const IE_STAYS_RE = /^(?:soldier|frontier|cashier|premier|glacier|financier|priest)s?$/;

/** The lower-case Latin letters of a piece, accents folded and apostrophes dropped. */
const latinLetters = (piece: string): string => piece.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z]/g, "");

/** The syllables of one run of lower-case Latin letters (no digits, hyphens or apostrophes), at least 1. */
function syllablesOfLetters(word: string): number {
  if (SPOKEN_E_RE.test(word)) return word.match(/[aeiouy]+/g)!.length;
  let s = word;
  // Beginnings: a silent e in every and some, a vowel pair that splits in bio, geo, neo, theo, ideo, dia, peri-od and
  // pri-or, "science", re-act and cre-ate, and the 'ea' of idea and area.
  s = s.replace(/^every/, "evry").replace(/^(evry|any)(?=one)/, "$1-").replace(/^some(?=thing|one|body|how|what|where|times?|day)/, "som").replace(/^busi(?=ness)/, "bus");
  s = s.replace(/^(?:(?:bi|ge(?!org)|ne|the|ide)(?=o)|di(?=a)|peri(?=od)|pri(?=or))/, "$&-").replace(/^scien/, "sci-en");
  s = s.replace(/^(?:cre(?=at(?:e|ed|es|ing|ion|ions|ive|or|ors)$)|re(?=act))/, "$&-").replace(/^(id|ar)ea/, "$1e-a");
  // A silent e inside a compound: baseline, milestone, timeline, framework.
  s = s.replace(/([^aeiouy])e(?=(?:lines?|stones?|times?|works?|where)$)/, "$1");
  // The ending. -ed is silent after a consonant except t, d and a consonant plus le; -es is a syllable after a sibilant,
  // after consonant plus le and after consonant plus re (centres); a final e is silent except in consonant plus le and consonant
  // plus re (table, centre, metre); -gue and -que lose their ue.
  if (/[aeiou]yed$/.test(s)) s = s.slice(0, -2);
  else if (/[^aeiouy]ed$/.test(s) && !/[td]ed$/.test(s) && !/[^aeiouyl]led$/.test(s)) s = s.slice(0, -2);
  else if (/[^aeiouy]es$/.test(s)) {
    if (!/(?:[sxzcg]|ch|sh)es$/.test(s) && !/[^aeiouy]les$/.test(s) && !/[^aeiouy]res$/.test(s)) s = s.slice(0, -2);
  } else if (/(?<=[^r][gq])ue$/.test(s)) s = s.slice(0, -2);
  else if (/[^aeiou]e$/.test(s) && !/[^aeiouy]le$/.test(s) && !/[^aeiouy]re$/.test(s) && s.length > 2) s = s.slice(0, -1);
  // A silent e before a suffix: completely, careful, wireless, safety, management; "element" keeps its e.
  s = s.replace(/([aeiou][^aeiouy]+)e(?=(?:ly|ness|ful(?:ly)?|less(?:ly)?|ty)$)/, "$1");
  s = s.replace(/([aeiou][^aeiouy]*[^aeiouyl])e(?=ments?$)/, "$1");
  // Vowels that make two syllables: earlier and happiest; radio, video, duo; media, variable, variation; curious,
  // client, audience; manual, situation; poem, poet; society; quiet. After t, c, s or g the pair is one sound (social,
  // nation, Asia), so it stays.
  if (s.length >= 6 && !IE_STAYS_RE.test(s)) s = s.replace(/(?<=[^aeiouy]i)(?=e(?:rs?|st)$)/, "-");
  s = s.replace(/(?<=[^aeiou][ie])(?=o$)|(?<=[^aeiou]u)(?=o$)/, "-");
  s = s.replace(/(?<=[^aeiouytcsg]i)(?=a$|a(?:bl|t)|al(?:s|ly)?$)/, "-").replace(/(?<=[^aeiouytcgxs]i)(?=ous$|en(?:ce?|t)s?$)/, "-");
  s = s.replace(/(?<=[^q]u)(?=a[lbt])/, "-").replace(/(?<=po)(?=e[mt])/, "-").replace(/(?<=i)(?=ety$)/, "-").replace(/(?<=qui)(?=et)/, "-");
  // A final m after a consonant is a syllable of its own: organism, rhythm, prism.
  s = s.replace(/(?:is|as|ith|yth)m(?=s?$)/, "$&u");
  // y between vowels is a consonant (layer, beyond; at the start of a word it joins the vowel after it, which counts the
  // same), and after a consonant before -ing it ends a syllable (trying); -ing after a vowel is its own syllable too.
  s = s.replace(/(?<=[aeiou])y(?=[aeiou])/g, "j").replace(/(?<=[^aeiou])y(?=ing$)/, "y-");
  s = s.replace(/(?<=[aeiou])(?=ing$)/, "-");
  return s.match(/[aeiouy]+/g)?.length ?? 1;
}

/**
 * The syllables of one word. Pieces joined by a hyphen, a slash, a dot or a digit count apart and add up
 * ("state-of-the-art" 4, "and/or" 2, "U.S." 2); apostrophes are dropped, and n't after d, s, z or t is a syllable of its
 * own ("don't" 1, "didn't" 2, "doesn't" 2); accents are folded; a piece with no Latin letter adds nothing, so a number ("2024") is 0. A piece of two or more capitals is read
 * letter by letter (DNA 3, AI 2, FDA 3), which is wrong for an acronym said as a word (NASA); readingStats() leaves
 * such tokens out of the average inside a sentence, as capitalised names. Every other piece has at least one syllable.
 */
export function countSyllables(word: string): number {
  let total = 0;
  for (const piece of word.split(/[^\p{L}'’]+/u)) {
    const acronym = /^(\p{Lu}{2,})(?:['’]?s)?$/u.exec(piece);
    const contraction = NT_RE.exec(piece);
    if (acronym) total += latinLetters(acronym[1]!).length;
    else if (contraction && latinLetters(contraction[1]!) !== "") {
      const base = latinLetters(contraction[1]!);
      total += syllablesOfLetters(base) + (/[dszt]$/.test(base) ? 1 : 0);
    } else if (latinLetters(piece) !== "") total += syllablesOfLetters(latinLetters(piece));
  }
  return total;
}

// ── The grade ────────────────────────────────────────────────────────────────────────────────────

/** What readingGrade() computed from, so a message can say why. */
export interface ReadingStats {
  /** countWords() of the text. */
  words: number;
  /** The sentences of splitSentences() that hold a word: a stray "..." or "*" between two sentences is no sentence here. */
  sentences: number;
  /** The words the syllable average is over: every word but those left out (below), and any word with no Latin letter. */
  syllableWords: number;
  /** The syllables of those words. */
  syllables: number;
  /** The Flesch-Kincaid grade; 0 for a text with no words; negative for very short, simple sentences; not rounded. */
  grade: number;
}

/**
 * Which words count in the sentence's syllable average: not a word with a digit, not a capitalised word that is not
 * the sentence's first (a name or an acronym; the pronoun I and its contractions are not names), and not a word
 * that overlaps one of the finding's own terms (`ranges`, the term matches in the sentence).
 */
function inAverage(core: string, first: boolean, from: number, to: number, ranges: readonly (readonly [number, number])[]): boolean {
  if (/\p{N}/u.test(core)) return false;
  if (!first && /^\p{Lu}/u.test(core) && !/^I(?:['’]\p{Ll}+)?$/u.test(core)) return false;
  return !ranges.some(([a, b]) => a < to && from < b);
}

/**
 * The reading statistics of `text`. `terms` are the finding's own terms, as English strings; each match of a term
 * (whole words, plurals too, as wordRe() reads them) counts as words but stays out of the syllable average. With no
 * word in the average its mean is taken as 0, so such a text grades very low; with no words the grade is 0.
 */
export function readingStats(text: string, opts: { terms?: readonly string[] } = {}): ReadingStats {
  const termRes = (opts.terms ?? []).filter((term) => term.trim() !== "")
    .map((term) => new RegExp(wordRe(term, { plurals: true }).source, "giu"));
  let sentences = 0;
  let syllableWords = 0;
  let syllables = 0;
  for (const sentence of splitSentences(blankUrls(text))) {
    const ranges = termRes.flatMap((re) => [...sentence.matchAll(re)].map((m) => [m.index, m.index + m[0].length] as const));
    let first = true;
    for (const token of sentence.matchAll(/\S+/gu)) {
      if (!WORDISH_RE.test(token[0])) continue;
      if (first) sentences += 1;
      const core = token[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const count = countSyllables(token[0]);
      if (count > 0 && inAverage(core, first, token.index, token.index + token[0].length, ranges)) {
        syllableWords += 1;
        syllables += count;
      }
      first = false;
    }
  }
  const words = countWords(text);
  const average = syllableWords === 0 ? 0 : syllables / syllableWords;
  const grade = words === 0 ? 0 : 0.39 * (words / sentences) + 11.8 * average - 15.59;
  return { words, sentences, syllableWords, syllables, grade };
}

/** The Flesch-Kincaid grade of `text` (see readingStats()): what READING_LEVEL compares with 12 and 14. */
export function readingGrade(text: string, opts: { terms?: readonly string[] } = {}): number {
  return readingStats(text, opts).grade;
}
