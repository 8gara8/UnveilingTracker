// This file is a scaffold: the group author replaces it whole, and a scaffold is the only kind of stub allowed anywhere. The safety group
// (SPEC §4.12) holds dual-use text, secrets, the canary and blocked hosts, and will report DUAL_USE, SECRET_LIKE, CANARY,
// BLOCKED_HOST.
//
// New for this project; Cyber's lib/rules/ held one file per group in the same shape (`export const <group>Rules: Rule[]`).

import type { Rule } from "./types";

export const safetyRules: Rule[] = [];
