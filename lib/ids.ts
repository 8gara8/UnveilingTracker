// Explicit comparators for ids and sorted lists of them (SPEC §4.1 keeps Cyber's rule that no sort uses
// localeCompare, so every order here is the same on every platform and in every locale; §4.3 gives the id
// forms). Pure.
// Cyber's lib/ids.ts at the fork commit 3ced1fb, adapted: byCodeUnit() is kept; the CVE and advisory
// comparators (compareCveIds, compareIds) are dropped with their ids; compareFindingIds() and
// compareSourceIds() are new, for this project's ids. Correction ids (`C-0001`), report ids (`R-0001`) and
// glossary term ids need no comparator of their own: the first two have a fixed four-digit number, and term
// ids are plain kebab-case words, so byCodeUnit() already puts them in their natural order.

/** `math-2026-0142`: the field's code, the year of the first brief and the counter within that year (§4.3). */
const FINDING_ID_RE = /^(math|phys|chem|bio|earth|soc|hum)-(\d{4})-(\d{4})$/;

/** `s3` in a finding, `b12` in a brief (§4.3): a letter and a number without a leading zero. */
const SOURCE_ID_RE = /^([sb])([1-9][0-9]*)$/;

/** Plain UTF-16 code-unit order, the same on every platform and locale. Never localeCompare. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Orders the strings `parse` accepts by `order`, before every string it rejects, which follow in code-unit
 * order. One rule for each tier keeps the comparator transitive: mixing the two rules between a parsed and an
 * unparsed string could put three strings in a cycle, and a sort of a cycle has no defined result.
 */
function compareTiered<T>(a: string, b: string, parse: (id: string) => T | null, order: (x: T, y: T) => number): number {
  const pa = parse(a);
  const pb = parse(b);
  if (pa !== null && pb !== null) return order(pa, pb);
  if (pa !== null) return -1;
  if (pb !== null) return 1;
  return byCodeUnit(a, b);
}

/** Two digit strings without leading zeros, as numbers: the shorter is the smaller, equal lengths compare as text. */
function compareDigitStrings(a: string, b: string): number {
  return a.length - b.length || byCodeUnit(a, b);
}

/**
 * Finding ids in the order publish assigned them: year, then the counter within the year (which runs across
 * all fields, so `bio-2026-0099` comes before `math-2026-0142`), then the field's code, which only a hand-made
 * id with a repeated counter ever reaches. A string that is not a finding id comes after every finding id, in
 * code-unit order, so a list that mixes finding ids with the archive index's `<date>/brief` entries (§4.10)
 * sorts the same way everywhere, and distinct strings never compare equal.
 */
export function compareFindingIds(a: string, b: string): number {
  return compareTiered(
    a,
    b,
    (id) => {
      const m = FINDING_ID_RE.exec(id);
      return m ? { code: m[1]!, year: m[2]!, counter: m[3]! } : null;
    },
    (x, y) => byCodeUnit(x.year, y.year) || byCodeUnit(x.counter, y.counter) || byCodeUnit(x.code, y.code),
  );
}

/**
 * Source ids in numeric order, `s2` before `s10` (code-unit order would put `s10` first): the letter first
 * (`b` brief-level ids, then `s` finding-level ids, though one list never holds both), then the number. A
 * string that is not a source id comes after every source id, in code-unit order.
 */
export function compareSourceIds(a: string, b: string): number {
  return compareTiered(
    a,
    b,
    (id) => {
      const m = SOURCE_ID_RE.exec(id);
      return m ? { letter: m[1]!, number: m[2]! } : null;
    },
    (x, y) => byCodeUnit(x.letter, y.letter) || compareDigitStrings(x.number, y.number),
  );
}
