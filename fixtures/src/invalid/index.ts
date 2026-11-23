// The invalid-case groups of the fixtures (SPEC §4.12 "Fixtures and tests"), one file for each rule group and, from each file,
// three arrays (`<group>Cases`: F, `<group>Soft`: S, `<group>Named`: T), so `fixtures/src/build.ts` lists them in one import.
// The English groups hold `InvalidCase`s, `SoftCase`s and `NamedCase`s, mutations of the valid English drafts; the Chinese
// group holds `ZhInvalidCase`s, `ZhSoftCase`s and `ZhNamedCase`s, mutations of the valid Chinese drafts, and stays apart.
//
// New for this project; Cyber's builder imported each case file by name.

export { groundingCases, groundingNamed, groundingSoft } from "./grounding";
export { historyCases, historyNamed, historySoft } from "./history";
export { ladderAiCases, ladderAiNamed, ladderAiSoft } from "./ladder-ai";
export { safetyCases, safetyNamed, safetySoft } from "./safety";
export { sourcesCases, sourcesNamed, sourcesSoft } from "./sources";
export { structureCases, structureNamed, structureSoft } from "./structure";
export { wordsCases, wordsNamed, wordsSoft } from "./words";
export { zhCases, zhNamed, zhSoft, type ZhInvalidCase, type ZhNamedCase, type ZhSoftCase } from "./zh";
