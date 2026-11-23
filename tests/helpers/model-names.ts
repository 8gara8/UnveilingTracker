// The model identifiers no committed file may hold (SPEC §0.2, AGENTS.md), shared by every scan that guards
// the rule (tests/no-cyber-strings.test.ts from Foundation; P1 to P3 add the fixture and prompt scans). Built
// from fragments, so this file never matches those scans. The pinned CLI's own --help names three of the
// families as aliases for the latest model; the generic form catches a family not listed yet. Cyber's
// tests/helpers/model-names.ts at the fork commit, copied; only comments changed (docs/PROVENANCE.md).

/** The model families, written as their aliases are. */
export const MODEL_FAMILIES: readonly string[] = [["fa", "ble"], ["op", "us"], ["son", "net"], ["hai", "ku"]].map((p) => p.join(""));

/**
 * A full model identifier: the vendor prefix and a hyphen, then a family name, or then any lower-case words and
 * a version digit (MODEL_SAMPLES shows each form). Package and service names such as the CLI's npm name or the
 * keychain item carry no digit after their words, so they do not match.
 */
export const MODEL_ID_SOURCE = `${"clau"}de-(?:${MODEL_FAMILIES.join("|")})|${"clau"}de-(?:[a-z]+-)*\\d`;

/** The two model flags. */
export const MODEL_FLAG_SOURCE = `${"-".repeat(2)}(?:fallback-)?mod${"el"}\\b`;

/** A model identifier or a model flag. */
export const modelRe = (flags = ""): RegExp => new RegExp(`${MODEL_ID_SOURCE}|${MODEL_FLAG_SOURCE}`, flags);

/** Planted samples every scan's self-test checks it still catches: one per family, the generic form and both flags. */
export const MODEL_SAMPLES: readonly string[] = [
  ...MODEL_FAMILIES.map((f) => `${"clau"}de-${f}-5-1`),
  `${"clau"}de-${["new", "family"].join("")}-6`,
  `${"clau"}de-7`,
  `${"-".repeat(2)}mod${"el"} x`,
  `${"-".repeat(2)}fallback-mod${"el"} x`,
];
