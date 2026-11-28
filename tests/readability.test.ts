// countSyllables(), readingStats() and readingGrade() (SPEC §4.12 READING_LEVEL, §10 P1: "readingGrade() matches
// hand-computed values on five fixed paragraphs"). The paragraphs below are counted by hand: the words, the
// sentences and the syllables of each word are written out in the comments, then the grade, from the Flesch-Kincaid
// formula 0.39 * (words / sentences) + 11.8 * (syllables / syllable words) - 15.59, and the test expects that number.
import { describe, expect, it } from "vitest";
import { countSyllables, readingGrade, readingStats } from "@/lib/readability";
import { countWords } from "@/lib/text";

/** Each word with the syllables a reader hears in it; a failure lists every word that is off. */
function expectSyllables(table: Record<string, number>): void {
  const off = Object.entries(table).filter(([word, count]) => countSyllables(word) !== count)
    .map(([word, count]) => `${word}: counted ${countSyllables(word)}, expected ${count}`);
  expect(off).toEqual([]);
}

describe("countSyllables: the endings and the silent e", () => {
  it("counts vowel groups, at least one for a word", () => {
    expectSyllables({ cat: 1, the: 1, a: 1, I: 1, strengths: 1, rhythm: 2, why: 1, sky: 1, system: 2, water: 2, climate: 2, ocean: 2 });
  });

  it("drops a final e after a consonant, but not in a one-vowel word, an -ee word or consonant plus le or re", () => {
    expectSyllables({
      make: 1, time: 1, hope: 1, stone: 1, large: 1, care: 1, are: 1, type: 1, style: 1, whole: 1, complete: 2,
      he: 1, be: 1, see: 1, free: 1, queue: 1, table: 2, simple: 2, people: 2, little: 2, apple: 2, able: 2, centre: 2, metre: 2,
    });
  });

  it("reads -ed as a syllable only after t or d, or after consonant plus l (settled)", () => {
    expectSyllables({
      jumped: 1, walked: 1, fixed: 1, used: 1, shared: 1, behaved: 2, wanted: 2, needed: 2, created: 3, decided: 3,
      tried: 1, studied: 2, agreed: 2, settled: 2, labelled: 2, filled: 1, called: 1, rolled: 1,
    });
  });

  it("reads -yed as silent after a vowel (played, obeyed)", () => {
    expectSyllables({ played: 1, stayed: 1, obeyed: 2, enjoyed: 2, displayed: 2 });
  });

  it("reads -es as a syllable after a sibilant, after consonant plus le and after two consonants plus re", () => {
    expectSyllables({
      makes: 1, stones: 1, waves: 1, scores: 1, goes: 1, shoes: 1, tries: 1, studies: 2,
      boxes: 2, places: 2, changes: 2, uses: 2, causes: 2, wishes: 2, watches: 2, tables: 2, samples: 2, centres: 2,
    });
  });

  it("drops the ue of -gue and -que, but not in argue", () => {
    expectSyllables({ unique: 2, technique: 2, league: 1, tongue: 1, fatigue: 2, argue: 2, value: 2, continue: 3, statue: 2 });
  });

  it("drops a silent e before -ly, -ness, -ful, -less, -ty and -ment, but not in element", () => {
    expectSyllables({
      completely: 3, nicely: 2, largely: 2, careful: 2, carefully: 3, wireless: 2, safety: 2, ninety: 2, management: 3,
      statement: 2, statements: 2, announcement: 3, announcements: 3, movement: 2, achievement: 3, element: 3, supplement: 3,
      agreement: 3, cement: 2,
    });
  });

  it("drops a silent e inside a compound (baseline, milestone, timeline, framework, elsewhere)", () => {
    expectSyllables({ baseline: 2, milestone: 2, milestones: 2, pipeline: 2, timeline: 2, guideline: 2, framework: 2, elsewhere: 2, somewhere: 2 });
  });

  it("keeps the spoken final e of a few words (maybe, recipe, apostrophe)", () => {
    expectSyllables({
      maybe: 2, recipe: 3, recipes: 3, apostrophe: 4, apostrophes: 4, catastrophe: 4, epitome: 4, simile: 3, sesame: 3, finale: 3,
      karate: 3, adobe: 3, anemone: 4,
    });
  });

  it("reads every and some as two and one syllable at their start", () => {
    expectSyllables({ every: 2, everything: 3, everyone: 3, everywhere: 3, everyday: 3, something: 2, someone: 2, sometimes: 2, somebody: 3 });
  });
});

describe("countSyllables: vowels that make two syllables", () => {
  it("splits -ing after a vowel (being, going, saying, doing, seeing)", () => {
    expectSyllables({ being: 2, going: 2, saying: 2, doing: 2, seeing: 2, playing: 2, making: 2, running: 2 });
  });

  it("splits y before a vowel and y after a consonant before a vowel", () => {
    expectSyllables({ layer: 2, player: 2, beyond: 2, yes: 1, year: 1, lawyer: 2, any: 2, anyone: 3, canyon: 2 });
  });

  it("ends a syllable at a y after a consonant before -ing (trying, studying), and not at a y after a vowel (buying)", () => {
    expectSyllables({ trying: 2, flying: 2, dying: 2, applying: 3, studying: 3, copying: 3, carrying: 3, buying: 2 });
  });

  it("splits the prefixes bio, geo, neo, theo, dia, science, re-act and cre-ate, and idea and area", () => {
    expectSyllables({
      biology: 4, geology: 4, geometry: 4, neon: 2, theology: 4, theory: 3, theorem: 3, diagram: 3, diagnosis: 4,
      science: 2, scientist: 3, scientific: 4, react: 2, reaction: 3, create: 2, creation: 3, creative: 3, idea: 3, ideas: 3, area: 3,
      ideal: 3, george: 1, period: 3, prior: 2, priority: 4, business: 2, businesses: 3,
    });
  });

  it("splits -io, -eo and -uo at the end, and -ia after a sound that is not t, c, s or g", () => {
    expectSyllables({ radio: 3, video: 3, studio: 3, ratio: 3, duo: 2, media: 3, criteria: 4, trivia: 3, social: 2, special: 2, nation: 2, Asia: 2 });
  });

  it("splits -ious, -ial, -iab, -iat, -ient and -ience after a plain consonant", () => {
    expectSyllables({
      curious: 3, obvious: 3, various: 3, serious: 3, gracious: 2, religious: 3, delicious: 3, anxious: 2,
      material: 4, materials: 4, serial: 3, trial: 2, dial: 2, initial: 3, financial: 3, official: 3,
      variable: 4, variation: 4, client: 2, audience: 3, experience: 4, patient: 2, efficient: 3,
    });
  });

  it("splits -ua before l, b and t (manual, situation) but not in qu (equal, equation)", () => {
    expectSyllables({ manual: 3, annual: 3, actual: 3, usual: 3, dual: 2, situation: 4, punctuation: 4, equal: 2, equation: 3, quality: 3, language: 2 });
  });

  it("splits -ier and -iest comparatives, and keeps soldier and priest", () => {
    expectSyllables({ earlier: 3, easier: 3, happier: 3, earliest: 3, happiest: 3, heavier: 3, soldier: 2, priest: 1, tier: 1, brief: 1 });
  });

  it("splits poem and poet, quiet, society, and counts the final m of -ism and -ithm", () => {
    expectSyllables({ poem: 2, poet: 2, poetry: 3, quiet: 2, quietly: 3, society: 4, variety: 4, organism: 4, algorithm: 4, prism: 2 });
  });
});

describe("countSyllables: the shape of the word", () => {
  it("adds up the pieces of a hyphenated word or a word with a slash or dots", () => {
    expectSyllables({ "state-of-the-art": 4, "well-known": 2, "and/or": 2, "e.g.": 2, "U.S.": 2, "twenty-one": 3, "x-ray": 2, "long-term": 2 });
  });

  it("is 0 for a number or anything with no Latin letter, and counts the letters around digits", () => {
    expectSyllables({ "": 0, "2024": 0, "3.14": 0, "-": 0, "...": 0, "100%": 0, "日本語": 0, "x86": 1, "mp3": 1, "3rd": 1 });
  });

  it("reads a piece of two or more capitals letter by letter, with an s of plural or possessive", () => {
    expectSyllables({ DNA: 3, AI: 2, FDA: 3, GPU: 3, RNA: 3, "DNA's": 3, IDs: 2, USA: 3 });
  });

  it("reads one capital as an ordinary word", () => {
    expectSyllables({ A: 1, I: 1, B: 1, X: 1, Plan: 1 });
  });

  it("drops apostrophes of either kind, and a contraction in n't after d, s, z or t has its own syllable", () => {
    expectSyllables({
      "don't": 1, "it's": 1, "we're": 1, "they'll": 1, "can't": 1, "won't": 1, "didn't": 2, "doesn't": 2, "wasn't": 2, "wouldn't": 2,
      "mustn't": 2, "isn't": 2, "aren't": 1, "weren't": 1, "don’t": 1, "didn’t": 2, "scientist's": 3,
    });
  });

  it("folds accents and ignores case", () => {
    expectSyllables({ señor: 2, über: 2, Über: 2, SCIENCE: 7, Science: 2, THE: 3 });
  });

  it("counts a word of consonants only as one syllable and ignores punctuation around a word", () => {
    expectSyllables({ mm: 1, hmm: 1, sh: 1, "(see": 1, "result.": 2, "“Hello,”": 2, "water!": 2 });
  });
});

describe("countSyllables: the documented misses", () => {
  // The header of lib/readability.ts names these; if a rule is added for one, move it to the tables above.
  it("counts an acronym said as a word letter by letter, and a lower-case acronym as a word", () => {
    expect(countSyllables("NASA")).toBe(4);
    expect(countSyllables("CRISPR")).toBe(6);
    expect(countSyllables("ids")).toBe(1);
  });

  it("counts a past tense in -ire as two syllables, and haven't as one", () => {
    expect(countSyllables("inspired")).toBe(2);
    expect(countSyllables("haven't")).toBe(1);
  });
});

describe("readingStats and readingGrade on five fixed paragraphs, counted by hand", () => {
  it("1. a simple paragraph", () => {
    // "The cat sat on the mat. It was a big red cat."
    // Words: sentence 1 has 6 (The cat sat on the mat), sentence 2 has 6 (It was a big red cat): 12 words, 2 sentences.
    // Every word has 1 syllable: 12 syllables over 12 words.
    // Grade = 0.39 * (12 / 2) + 11.8 * (12 / 12) - 15.59 = 2.34 + 11.8 - 15.59 = -1.45
    const text = "The cat sat on the mat. It was a big red cat.";
    expect(readingStats(text)).toMatchObject({ words: 12, sentences: 2, syllableWords: 12, syllables: 12 });
    expect(readingGrade(text)).toBeCloseTo(-1.45, 2);
  });

  it("2. a paragraph of everyday words", () => {
    // "Scientists tested the new method on every sample. The results were clear, and the team shared them with other labs."
    // Sentence 1, syllables: Scientists 3 (sci-en-tists), tested 2, the 1, new 1, method 2, on 1, every 2, sample 2 = 14 over 8 words.
    // Sentence 2: The 1, results 2, were 1, clear 1, and 1, the 1, team 1, shared 1, them 1, with 1, other 2, labs 1 = 14 over 12 words.
    // 20 words, 2 sentences, 28 syllables over 20 words.
    // Grade = 0.39 * (20 / 2) + 11.8 * (28 / 20) - 15.59 = 3.9 + 16.52 - 15.59 = 4.83
    const text = "Scientists tested the new method on every sample. The results were clear, and the team shared them with other labs.";
    expect(readingStats(text)).toMatchObject({ words: 20, sentences: 2, syllableWords: 20, syllables: 28 });
    expect(readingGrade(text)).toBeCloseTo(4.83, 2);
  });

  it("3. a long-worded paragraph, just above 14", () => {
    // Sentence 1 (19 words): Chemists 2, used 1, a 1, machine 2, learning 2, model 2, to 1, predict 2, which 1, new 1,
    //   materials 4, could 1, conduct 2, electricity 5, without 2, losing 2, energy 3, as 1, heat 1 = 36 syllables.
    // Sentence 2 (21 words): Other 2, scientists 3, then 1, tested 2, those 1, predictions 3, in 1, the 1, lab 1, and 1,
    //   confirmed 2, that 1, many 2, candidates 3, behaved 2, exactly 3, as 1, the 1, computer 3, had 1, suggested 3 = 38 syllables.
    // 40 words, 2 sentences, 74 syllables over 40 words.
    // Grade = 0.39 * (40 / 2) + 11.8 * (74 / 40) - 15.59 = 7.8 + 21.83 - 15.59 = 14.04
    const text = "Chemists used a machine learning model to predict which new materials could conduct electricity without losing energy as heat. "
      + "Other scientists then tested those predictions in the lab and confirmed that many candidates behaved exactly as the computer had suggested.";
    expect(readingStats(text)).toMatchObject({ words: 40, sentences: 2, syllableWords: 40, syllables: 74 });
    expect(readingGrade(text)).toBeCloseTo(14.04, 2);
  });

  it("4. a paragraph with digits, names inside a sentence and the finding's own terms", () => {
    // "In 2024 Alice Turner showed that protein folding can be predicted. Three teams checked the result and Alice Turner agreed."
    // Sentence 1 has 11 words. Out of the average: 2024 (digits), Alice and Turner (capitalised, not first), protein and
    //   folding (the term "protein folding"). In it: In 1, showed 1, that 1, can 1, be 1, predicted 3 = 8 syllables over 6 words.
    // Sentence 2 has 9 words. Out of the average: Alice and Turner. In it: Three 1, teams 1, checked 1, the 1, result 2,
    //   and 1, agreed 2 = 9 syllables over 7 words.
    // 20 words, 2 sentences, 17 syllables over 13 words.
    // Grade = 0.39 * (20 / 2) + 11.8 * (17 / 13) - 15.59 = 3.9 + 15.430769 - 15.59 = 3.740769
    // Without the term, protein 2 and folding 2 join: 21 syllables over 15 words.
    // Grade = 3.9 + 11.8 * (21 / 15) - 15.59 = 3.9 + 16.52 - 15.59 = 4.83
    const text = "In 2024 Alice Turner showed that protein folding can be predicted. Three teams checked the result and Alice Turner agreed.";
    expect(readingStats(text, { terms: ["protein folding"] })).toMatchObject({ words: 20, sentences: 2, syllableWords: 13, syllables: 17 });
    expect(readingGrade(text, { terms: ["protein folding"] })).toBeCloseTo(3.740769, 5);
    expect(readingStats(text)).toMatchObject({ words: 20, sentences: 2, syllableWords: 15, syllables: 21 });
    expect(readingGrade(text)).toBeCloseTo(4.83, 2);
  });

  it("5. a paragraph with a quotation, which is not split", () => {
    // 'The lead author said, "The test worked. We checked it twice." Other teams agreed; the data were clear.'
    // The quotation is one span, so sentence 1 is everything up to the closing quote (11 words) and sentence 2 is the rest (7 words).
    // 18 words, 2 sentences. Out of the average: "The and We, which are capitalised inside sentence 1.
    // Sentence 1 in the average: The 1, lead 1, author 2, said 1, test 1, worked 1, checked 1, it 1, twice 1 = 10 syllables over 9 words.
    // Sentence 2: Other 2, teams 1, agreed 2, the 1, data 2, were 1, clear 1 = 10 syllables over 7 words.
    // 20 syllables over 16 words. Grade = 0.39 * (18 / 2) + 11.8 * (20 / 16) - 15.59 = 3.51 + 14.75 - 15.59 = 2.67
    const text = 'The lead author said, "The test worked. We checked it twice." Other teams agreed; the data were clear.';
    expect(readingStats(text)).toMatchObject({ words: 18, sentences: 2, syllableWords: 16, syllables: 20 });
    expect(readingGrade(text)).toBeCloseTo(2.67, 2);
  });
});

describe("readingStats: what stays out of the syllable average", () => {
  it("counts the first word of a sentence even when capitalised, and leaves out a capitalised word after it", () => {
    // Turing 2 (first word, counted); Church 1 is capitalised inside the sentence and left out.
    const stats = readingStats("Turing proved Church wrong.");
    expect(stats).toMatchObject({ words: 4, sentences: 1, syllableWords: 3, syllables: 4 });
  });

  it("does not treat the pronoun I or its contractions as names", () => {
    expect(readingStats("Then I saw it.")).toMatchObject({ words: 4, syllableWords: 4, syllables: 4 });
    expect(readingStats("Then I'm sure we know.")).toMatchObject({ words: 5, syllableWords: 5 });
    // Grade = 0.39 * 4 + 11.8 * 1 - 15.59 = -2.23
    expect(readingGrade("Then I saw it.")).toBeCloseTo(-2.23, 2);
  });

  it("leaves out every acronym inside a sentence, but counts one that opens it letter by letter", () => {
    // The 1 and matched 1 are in the average; DNA, capitalised inside the sentence, is out.
    expect(readingStats("The DNA matched.")).toMatchObject({ words: 3, syllableWords: 2, syllables: 2 });
    // Opening the sentence, DNA is counted letter by letter: 3 and matched 1.
    expect(readingStats("DNA matched.")).toMatchObject({ words: 2, syllableWords: 2, syllables: 4 });
  });

  it("leaves out each token with a digit, and each token with no Latin letter (still a word)", () => {
    // Seven words. In the average: Version 2 (first), of 1, and 1, works 1. Out: 3rd and h5n1 (digits, lower case, so no
    // capital rule leaves them out), 日本語 (no Latin letter).
    expect(readingStats("Version 3rd of h5n1 and 日本語 works.")).toMatchObject({ words: 7, syllableWords: 4, syllables: 5 });
  });

  it("leaves out the finding's terms as whole words, plurals and any case, but not a longer word", () => {
    // Ten words. Both Enzymes (the second is capitalised inside its own sentence only if it is not first; it is first) match
    // the term enzyme, as a plural and with a capital; enzymatic is a longer word and stays in.
    const text = "Enzymes speed reactions. Enzymes are proteins that enzymatic work needs.";
    expect(readingStats(text, { terms: ["enzyme"] })).toMatchObject({ words: 10, syllableWords: 8 });
    expect(readingStats(text)).toMatchObject({ words: 10, syllableWords: 10 });
  });

  it("reads each term across a hyphen or a space, and ignores an empty term", () => {
    expect(readingStats("A well-known result held.", { terms: ["well known"] })).toMatchObject({ words: 4, syllableWords: 3 });
    expect(readingStats("A well known result held.", { terms: ["", "  "] })).toMatchObject({ words: 5, syllableWords: 5 });
  });

  it("ignores URLs in the words and the sentences", () => {
    // See, now, Done = 3 words in 2 sentences, 3 syllables. Grade = 0.39 * 1.5 + 11.8 - 15.59 = -3.205
    const stats = readingStats("See https://example.org/a.b now. Done.");
    expect(stats).toMatchObject({ words: 3, sentences: 2, syllableWords: 3, syllables: 3 });
    expect(stats.grade).toBeCloseTo(-3.205, 3);
  });

  it("counts the words as countWords() does, and the sentences as splitSentences() does", () => {
    const text = 'Dr. Lee wrote "It works. It scales." Then 3.5 teams (e.g. Kyoto) agreed... Maybe? Yes!';
    expect(readingStats(text).words).toBe(countWords(text));
    // 1: Dr. Lee wrote "It works. It scales." (an abbreviation and a quoted span) 2: Then 3.5 teams (e.g. Kyoto) agreed... 3: Maybe? 4: Yes!
    expect(readingStats(text).sentences).toBe(4);
  });
});

describe("readingGrade: degenerate input", () => {
  it("is 0 with no words: empty, blank, only symbols or only a URL, and counts no sentence", () => {
    for (const text of ["", "   ", "\n\n", "...", "- *", "https://example.org/x"]) {
      expect(readingStats(text), JSON.stringify(text)).toEqual({ words: 0, sentences: 0, syllableWords: 0, syllables: 0, grade: 0 });
    }
  });

  it("does not count a stray stop between two sentences as a sentence", () => {
    // Yes. ... Maybe.: two sentences, not three. Yes 1 and Maybe 2: 2 words, 3 syllables.
    expect(readingStats("Yes. ... Maybe.")).toMatchObject({ words: 2, sentences: 2, syllableWords: 2, syllables: 3 });
  });

  it("grades one word as a sentence of one word", () => {
    // Hello: 2 syllables. Grade = 0.39 * 1 + 11.8 * 2 - 15.59 = 0.39 + 23.6 - 15.59 = 8.4
    expect(readingStats("Hello")).toMatchObject({ words: 1, sentences: 1, syllableWords: 1, syllables: 2 });
    expect(readingGrade("Hello")).toBeCloseTo(8.4, 2);
  });

  it("grades a text with no stop as one sentence", () => {
    // "a very short line with no stop at all": 9 words, 1 sentence, 1+2+1+1+1+1+1+1+1 = 10 syllables? very 2, so 10.
    // Grade = 0.39 * 9 + 11.8 * (10 / 9) - 15.59 = 3.51 + 13.111111 - 15.59 = 1.031111
    const text = "a very short line with no stop at all";
    expect(readingStats(text)).toMatchObject({ words: 9, sentences: 1, syllableWords: 9, syllables: 10 });
    expect(readingGrade(text)).toBeCloseTo(1.031111, 5);
  });

  it("takes the syllable mean as 0 when no word is in the average, so the grade is very low", () => {
    // Two words, one sentence, both digits: 0.39 * 2 - 15.59 = -14.81
    expect(readingStats("2024 2025")).toMatchObject({ words: 2, sentences: 1, syllableWords: 0, syllables: 0 });
    expect(readingGrade("2024 2025")).toBeCloseTo(-14.81, 2);
  });

  it("does not round, and equals readingStats().grade", () => {
    const text = "In 2024 Alice Turner showed that protein folding can be predicted.";
    expect(readingGrade(text, { terms: ["protein folding"] })).toBe(readingStats(text, { terms: ["protein folding"] }).grade);
    expect(Number.isInteger(readingGrade(text))).toBe(false);
  });
});
