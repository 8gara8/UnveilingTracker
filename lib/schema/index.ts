// Zod is the single source of truth for every file the project reads or writes (SPEC §4.1): the validator, the site
// loaders, the config loader and the two JSON Schemas the agents read (`routine/schema/draft-brief.schema.json` and
// `draft-zh.schema.json`) all derive from these schemas. This barrel re-exports every schema file, so one import from
// `lib/schema` serves them all. A file added later adds its own line below: `reference.ts` (P2's Appendix D files, SPEC §3).
//
// Cyber's lib/schema/index.ts at the fork commit 3ced1fb, adapted: the files are this project's, grouped as the shared
// blocks, the stored records, then what the agents read and write; Cyber's item file and the files of its own domain
// are not this project's.
export * from "./common";
export * from "./finding";
export * from "./draft";
export * from "./brief";
export * from "./draft-zh";
export * from "./metrics";
export * from "./status";
export * from "./glossary";
export * from "./misc";
export * from "./registry";
export * from "./pack";
export * from "./context";
export * from "./config";
