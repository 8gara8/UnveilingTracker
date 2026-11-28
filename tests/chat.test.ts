// Tests for lib/chat.ts and scripts/chat.ts (SPEC §8.8, §8.2's error-code table, §8.9 and §8.13's Notes, §10 P1 step 6): the chat edition in
// every format, the reply file, the fixed tables, `chatInputFor()`'s notes, the last-step `chatGuard()`, and the command.
//
// Nothing here repeats a title, name, id list, count or date of the sample: each is read from `loadContent()`'s records (tests/helpers/
// chat-world.ts picks the editions by what they hold). The literals are §8.8's templates and labels, and the inputs built by hand for
// the formats the sample cannot feed (a failed run, a skipped one, a dry run, a partial or late edition, a trimmed More list).
//
// Cyber's tests/chat.test.ts at the fork commit 3ced1fb, adapted: its table-driven checks of the error-code tables, the notes and the
// last step are Cyber's pattern; the finding formats, the Monday and Sunday forms, the reply file, the loader-skip cases and the command's
// `Io` seam are this project's.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import runConfig from "../config/run.json";
import {
  BRIEF_LEFT_OUT, CHAT_MAX_LINES, CHAT_NOTES, CHECKOUT, DRY_RUN_FILES, DRY_RUN_NEXT_STEP, ERROR_CODES, NEXT_STEP, NOT_VALID, REPLY_INTRO,
  RERUN_BEFORE, RERUN_FROM, STAGE_NOTES, WHAT_HAPPENED, chatGuard, clockOf, minutesOf, chatInputFor, dryRunNextStepFor, fallbackChat, heldLockLine, kicker,
  lastRunRecords, nextStepFor, orderNotes, renderChat, renderReply, runCounts, runSpan, safePath, whatHappened, withForce,
  type ChatSource, type ErrorCode, type WhatFacts,
} from "../lib/chat";
import type { Content } from "../lib/content";
import { filedAs } from "../lib/items";
import type { RunRecord, RunStage } from "../lib/schema/status";
import { SITE_NAME, siteUrl } from "../lib/site";
import { splitSentences } from "../lib/text";
import {
  AI_ROLE_INFO, CANARY_TOKEN, DISCLOSURE, EXPLAINER_PARTS, EXPLAINER_PART_INFO, FIELD_INFO, NONE_FOUND, NO_AI_PART, RUNG_INFO, SIGNIFICANCE_INFO,
} from "../lib/vocab";
import { chatFromContent, main as chatMain, newestEdition, replyFromContent, type Io } from "../scripts/chat";
import {
  OTHER_DATE, SAMPLE_DIR, SEQUENCE, at, checkChat, copyFolder, copyOfSample, deepFreeze, loadFolder, patchJson, picks, removeCopies, runRecord, sample,
  stages, statusRuns,
} from "./helpers/chat-world";

type Brief = Content["briefs"][number];
type Finding = Content["findings"][number];

afterAll(removeCopies);

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

const SITE = siteUrl();
const ROOT = path.join(__dirname, "..");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const DOT = " · ";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Oct" from "2026-10-04", written out here rather than by `dayMonth()`. */
const dm = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
/** "HH:MM" of a Taipei timestamp (every sample and hand-built stamp ends +08:00). */
const hm = (iso: string) => iso.slice(11, 16);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const lines = (text: string) => text.slice(0, -1).split("\n");
const first = (text: string) => splitSentences(norm(text))[0]!;

function chatFor(content: Content, date: string, over: Partial<ChatSource> = {}): string {
  const runs = over.runs ?? lastRunRecords(statusRuns(content, date));
  return renderChat(chatInputFor({ date, content, siteUrl: SITE, ...over, runs }), SITE);
}

const briefIn = (c: Content, date: string): Brief => c.briefs.find((b) => b.date === date)!;
const findingIn = (c: Content, id: string): Finding => c.findings.find((f) => f.id === id)!;
const filed = (c: Content, id: string, date: string): Finding => filedAs(findingIn(c, id), c.corrections, date);

/** A copy of the sample with `edit` applied, and the brief of `date` in it. */
function variant(date: string, edit: (b: Brief, c: Content) => void): Content {
  const c = copyOfSample();
  edit(briefIn(c, date), c);
  return c;
}

/** The kicker of a finding, written from §8.8 and the vocabulary tables. */
function kickerOf(f: Finding): string {
  const s = SIGNIFICANCE_INFO[f.significance];
  const system = f.ai.systems[0];
  const claimed = f.ai.confidence === "claimed" && system !== undefined ? ` (claimed by ${system.maker})` : "";
  return [`${s.pips} ${s.en.toUpperCase()}`, FIELD_INFO[f.field].en, `${AI_ROLE_INFO[f.ai.role].en}${claimed}`, RUNG_INFO[f.rung].en].join(DOT);
}

const partLines = (f: Finding) =>
  EXPLAINER_PARTS.map((p) => `**${EXPLAINER_PART_INFO[p].en}.** ${norm(p === "ai_helped" ? (f.explainer.ai_helped?.en ?? NO_AI_PART.en) : f.explainer[p].en)}`);

function storyBlock(f: Finding, back?: string): string[] {
  return [
    `**Story of the day: ${norm(f.title.en)}**`, kickerOf(f), ...(back === undefined ? [] : [`Back: ${back}`]), ...partLines(f),
    ...(f.disclosure ? [DISCLOSURE.en] : []), `Read it: ${SITE}/findings/${f.id}`,
  ];
}

function moreLine(n: number, f: Finding, said: string): string {
  const s = SIGNIFICANCE_INFO[f.significance];
  return [`${n}. ${norm(f.title.en)}`, `${s.pips} ${s.en.toUpperCase()}`, FIELD_INFO[f.field].en, RUNG_INFO[f.rung].en,
    `${said}${f.disclosure ? ` ${DISCLOSURE.en}` : ""} ${SITE}/findings/${f.id}`].join(DOT);
}

const capped = (entries: string[]) => [...entries.slice(0, 3), ...(entries.length > 3 ? [`and ${entries.length - 3} more`] : [])].join("; ");

/** §8.8's published template, every line from the heading to "Full brief", written from the brief and the content (no Notes, no Run line). */
function expectedPublished(content: Content, b: Brief): string[] {
  const D = b.date;
  const find = (id: string) => filed(content, id, D);
  const known = (id: string) => content.findings.some((f) => f.id === id);
  const sunday = b.format === "sunday_deep_dive";
  const out: string[] = [
    `**${SITE_NAME} ${D} · ${b.edition === "data_only" ? "data-only" : b.edition} edition${b.languages.zh ? "" : ", English-only"}, published ${hm(b.published_at)}${b.late ? " (late)" : ""}**`,
    norm(b.pace.sentence.en),
    norm(b.lead.map((l) => l.text.en).join(" ")),
  ];
  if (b.story === null && b.items.length === 0) out.push("No new findings today.");
  if (b.review !== null) {
    const r = b.review;
    out.push("**The week in review**", ...r.big_picture.en.split(/\n\s*\n/).map(norm));
    if (r.remarkable !== null && known(r.remarkable.finding_id)) {
      out.push(`Most remarkable: ${norm(find(r.remarkable.finding_id).title.en)} · ${norm(r.remarkable.note.en)} ${SITE}/findings/${r.remarkable.finding_id}`);
    }
    out.push(`Strongest evidence against: ${norm(r.strongest_against.text.en)}`);
    if (b.disclosure.includes("review")) out.push(DISCLOSURE.en);
    out.push(`Charts: ${SITE}/brief/${D}#review`);
  }
  if (b.deep_dive !== null && known(b.deep_dive.finding_id)) {
    out.push(`**Sunday deep dive: ${norm(find(b.deep_dive.finding_id).title.en)}**`, ...b.deep_dive.text.en.split(/\n\s*\n/).map(norm).filter(Boolean));
    if (b.disclosure.includes("deep_dive")) out.push(DISCLOSURE.en);
  }
  if (!sunday && b.story !== null && known(b.story.finding_id)) {
    const entry = b.story;
    out.push(...storyBlock(find(entry.finding_id), entry.new ? undefined : first(entry.update!.en)));
  }
  const entries = [...(sunday && b.story !== null ? [b.story] : []), ...b.items].filter((e) => known(e.finding_id));
  if (entries.length) out.push("**More:**");
  entries.forEach((e, i) => out.push(moreLine(i + 1, find(e.finding_id), e.new ? first(find(e.finding_id).explainer.found.en) : `Back: ${first(e.update!.en)}`)));
  const changes = b.rung_changes.filter((c) => known(c.finding_id))
    .map((c) => `${norm(find(c.finding_id).title.en)} ${RUNG_INFO[c.from].en} → ${RUNG_INFO[c.to].en}`);
  if (changes.length) out.push(`Climbed or fell: ${capped(changes)}`);
  if (b.ideas.length || b.also.length) out.push(`Ideas and debate (${b.ideas.length}) · Also noted (${b.also.length}): ${SITE}/brief/${D}`);
  if (b.corrections.length) {
    out.push(`Corrections: ${capped(b.corrections.map((c) => `${c.id} ${c.type} to ${c.finding_id ?? c.edition_date ?? c.term_id}`))}`);
  }
  if (b.reports.length) out.push(`Reports: ${capped(b.reports.map((r) => `${r.id} ${r.status} (${r.finding_id})`))}`);
  out.push(`Full brief: ${SITE}/brief/${D}${b.languages.zh ? ` · 中文: ${SITE}/zh/brief/${D}` : ""}`);
  return out;
}

/** The run line of §8.8, written from the records. */
function expectedRunLine(runs: RunRecord[], b: Brief, full: boolean): string {
  const lastRun = runs.at(-1)!;
  const attempts = runs.filter((r) => r.stages.find((s) => s.id === "draft")!.status !== "skipped").length;
  const repairs = runs.reduce((n, r) => n + r.budgets.repair_rounds, 0);
  const dataOnly = runs.map((r) => r.data_only_published_at).find((t) => t !== null);
  const zh = [...runs].reverse().find((r) => r.zh !== null)?.zh?.outcome;
  return [
    `Run ${hm(runs[0]!.started_at)}${EN}${hm(lastRun.finished_at!)}`,
    ...(dataOnly === undefined ? [] : [`data-only ${hm(dataOnly)}`]),
    `${plural(attempts, "attempt")}${repairs ? `, ${plural(repairs, "repair")}` : ""}`,
    ...(full ? [`Chinese ${zh === "ok" ? "done" : zh === "failed" ? "failed" : "not run"}`, plural(b.computed.source_count, "source")] : []),
    `Pace data to ${dm(b.provenance.data_cutoff)}`,
  ].join(DOT);
}

/** A run record of `OTHER_DATE`'s failed form: the draft never validated. */
function failedRun(over: Partial<RunRecord> = {}): RunRecord {
  const base = runRecord(OTHER_DATE);
  return runRecord(OTHER_DATE, {
    outcome: "failed", edition: null, error_code: "E_VALIDATION", data_only_published_at: null, full_published_at: null,
    validation: { errors: 2, warnings: 0, codes: ["WORDS", "COUNTS"] }, budgets: { ...base.budgets, repair_rounds: 2 },
    deploy: { triggered: false, ready_at: null, shows_date: null, shows_edition: null }, zh: null, ...over,
  });
}

const budgets = (date: string, over: Partial<RunRecord["budgets"]>): RunRecord["budgets"] => ({ ...runRecord(date).budgets, ...over });

// ── Every sample edition ─────────────────────────────────────────────────────────────────────────

describe("every sample edition", () => {
  const content = sample();
  for (const brief of content.briefs) {
    it(`${brief.date} (${brief.format}, ${brief.edition}): chat edition and reply file hold §8.8's invariants`, () => {
      const chat = chatFor(content, brief.date);
      const ls = checkChat(chat, SITE, { cap: CHAT_MAX_LINES });
      expect(ls[0]!.startsWith(`**${SITE_NAME} ${brief.date} · `)).toBe(true);
      expect(chat).toBe(chatFromContent(content, brief.date, SITE));
      const reply = replyFromContent(content, brief.date, SITE);
      checkChat(reply, SITE, { blank: true });
      expect(reply).toBe(renderReply(brief, content, SITE));
    });
  }

  it("a full edition's lines are exactly §8.8's template, then Notes (if any) and the run line", () => {
    for (const brief of content.briefs.filter((b) => b.edition === "full")) {
      const runs = lastRunRecords(statusRuns(content, brief.date));
      const ls = lines(chatFor(content, brief.date));
      const expected = expectedPublished(content, brief);
      expect(ls.slice(0, expected.length), brief.date).toEqual(expected);
      const rest = ls.slice(expected.length);
      expect(rest.at(-1), brief.date).toBe(expectedRunLine(runs, brief, true));
      expect(rest.slice(0, -1).every((l) => l.startsWith("Notes: ")), brief.date).toBe(true);
    }
  });
});

// ── The published daily edition ──────────────────────────────────────────────────────────────────

describe("published daily edition", () => {
  const content = sample();
  const brief = picks().busiest;
  const ls = lines(chatFor(content, brief.date));

  it("prints the story's six labelled parts, each on one line, then the page link", () => {
    const story = filed(content, brief.story!.finding_id, brief.date);
    const i = ls.indexOf(`**Story of the day: ${norm(story.title.en)}**`);
    expect(i).toBeGreaterThan(0);
    expect(ls.slice(i, i + storyBlock(story).length)).toEqual(storyBlock(story));
    for (const part of EXPLAINER_PARTS) expect(ls.some((l) => l.startsWith(`**${EXPLAINER_PART_INFO[part].en}.** `))).toBe(true);
  });

  it("numbers the More lines from 1 with the title, pips and word, field, rung and the first sentence of found", () => {
    brief.items.forEach((entry, i) => {
      const f = filed(content, entry.finding_id, brief.date);
      const said = entry.new ? first(f.explainer.found.en) : `Back: ${first(entry.update!.en)}`;
      expect(ls).toContain(moreLine(i + 1, f, said));
    });
  });

  it("the run line matches the run records", () => {
    const runs = lastRunRecords(statusRuns(content, brief.date));
    expect(ls.at(-1)).toBe(expectedRunLine(runs, brief, true));
  });

  it("holds no tables, headings or emoji and no link off the site, whatever the model text holds", () => {
    const c = variant(brief.date, (b) => {
      b.lead = [{ text: { en: "> Quoted [here](https://evil.example/x) or https://evil.example/y, write to a@b.example", zh: null }, finding_ids: [] }];
      b.pace.sentence.en = `| a | b |${String.fromCodePoint(0x1f600)}`;
    });
    const f = findingIn(c, briefIn(c, brief.date).items[0]!.finding_id);
    f.title.en = "A title\n\n# with a heading";
    f.explainer.found.en = "One sentence about [a link](//evil.example/z).\nSecond line ![img](http://evil.example/i.png).";
    const out = chatFor(c, brief.date);
    const ols = checkChat(out, SITE, { cap: CHAT_MAX_LINES });
    expect(ols[1]).toBe("\\| a | b |");
    expect(ols[2]!.startsWith("\\> Quoted ")).toBe(true);
    expect(ols[2]).toContain("[here]([link removed])");
    expect(ols[2]).toContain("[link removed]");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("A title # with a heading");
    expect(out).not.toContain("a@b.example");
  });

  it("drops a blank Lead rather than printing a blank line", () => {
    const c = variant(brief.date, (b) => {
      b.lead = [];
    });
    const out = chatFor(c, brief.date);
    checkChat(out, SITE, { cap: CHAT_MAX_LINES });
    expect(lines(out).slice(0, 3)).toEqual([lines(out)[0], norm(brief.pace.sentence.en), "**Story of the day: " + norm(filed(content, brief.story!.finding_id, brief.date).title.en) + "**"]);
  });

  it("drops a Lead that holds nothing but emoji, which the last step empties, rather than printing a blank line", () => {
    const c = variant(brief.date, (b) => {
      b.lead = [{ text: { en: String.fromCodePoint(0x1f642, 0x1f680), zh: null }, finding_ids: [] }];
    });
    const out = chatFor(c, brief.date);
    checkChat(out, SITE, { cap: CHAT_MAX_LINES });
    expect(lines(out).slice(0, 3)).toEqual([lines(out)[0], norm(brief.pace.sentence.en), "**Story of the day: " + norm(filed(content, brief.story!.finding_id, brief.date).title.en) + "**"]);
  });

  it("is the same with a trailing slash on the site address", () => {
    const input = chatInputFor({ date: brief.date, content, runs: lastRunRecords(statusRuns(content, brief.date)), siteUrl: SITE });
    expect(renderChat(input, `${SITE}///`)).toBe(renderChat(input, SITE));
  });
});

describe("the heading", () => {
  const brief = picks().busiest;
  const head = (edit: (b: Brief) => void, over: Partial<ChatSource> = {}) => lines(chatFor(variant(brief.date, edit), brief.date, over))[0];
  const time = hm(brief.published_at);

  it("names a partial edition", () => {
    expect(head((b) => { b.edition = "partial"; })).toBe(`**${SITE_NAME} ${brief.date} · partial edition, published ${time}**`);
  });

  it("adds English-only and (late)", () => {
    expect(head((b) => { b.languages.zh = false; })).toBe(`**${SITE_NAME} ${brief.date} · full edition, English-only, published ${time}**`);
    expect(head((b) => { b.late = true; })).toBe(`**${SITE_NAME} ${brief.date} · full edition, published ${time} (late)**`);
    expect(head((b) => { b.edition = "partial"; b.languages.zh = false; b.late = true; }))
      .toBe(`**${SITE_NAME} ${brief.date} · partial edition, English-only, published ${time} (late)**`);
  });

  it("gives the Taipei time of a timestamp written in UTC", () => {
    expect(head((b) => { b.published_at = `${brief.date}T19:30:00Z`; })).toBe(`**${SITE_NAME} ${brief.date} · full edition, published 03:30**`);
  });

  it("leaves out the Chinese link of an English-only edition and keeps it otherwise", () => {
    const withZh = chatFor(variant(brief.date, () => {}), brief.date);
    const without = chatFor(variant(brief.date, (b) => { b.languages.zh = false; }), brief.date);
    expect(withZh).toContain(`Full brief: ${SITE}/brief/${brief.date} · 中文: ${SITE}/zh/brief/${brief.date}\n`);
    expect(without).toContain(`Full brief: ${SITE}/brief/${brief.date}\n`);
    expect(without).not.toContain("中文");
  });
});

// ── Returning findings, filing and disclosure ────────────────────────────────────────────────────

describe("returning findings, filing and disclosure", () => {
  const brief = picks().busiest;
  const D = brief.date;

  it("shows Back: and the first sentence of the update for a returning story", () => {
    const id = brief.story!.finding_id;
    const c = variant(D, (b) => {
      b.story = { finding_id: id, new: false, update: { en: "The update came on Tuesday.\nA second sentence follows.", zh: null } };
    });
    const ls = lines(chatFor(c, D));
    const i = ls.indexOf(`**Story of the day: ${norm(findingIn(c, id).title.en)}**`);
    expect(ls[i + 1]).toBe(kickerOf(findingIn(c, id)));
    expect(ls[i + 2]).toBe("Back: The update came on Tuesday.");
    expect(ls[i + 3]).toBe(partLines(findingIn(c, id))[0]);
  });

  it("shows no Back: for a new story and, defensively, for an entry that is not new but has no update", () => {
    const id = brief.story!.finding_id;
    const c = variant(D, (b) => {
      b.story = { finding_id: id, new: false, update: null };
      b.items[0] = { finding_id: b.items[0]!.finding_id, new: false, update: null };
    });
    const ls = lines(chatFor(c, D));
    const id0 = brief.items[0]!.finding_id;
    const i = ls.indexOf(`**Story of the day: ${norm(findingIn(c, id).title.en)}**`);
    expect(ls[i + 2]).toBe(partLines(findingIn(c, id))[0]);
    expect(ls).toContain(moreLine(1, filed(c, id0, D), first(findingIn(c, id0).explainer.found.en)));
  });

  it("prints a More line with nothing after the rung when found has no sentence, rather than a placeholder", () => {
    const id = brief.items[0]!.finding_id;
    const c = variant(D, () => {});
    findingIn(c, id).explainer.found.en = " \n ";
    const line = lines(chatFor(c, D)).find((l) => l.startsWith("1. "))!;
    expect(line.endsWith(`${RUNG_INFO[findingIn(c, id).rung].en} · ${SITE}/findings/${id}`)).toBe(true);
  });

  it("reads an entry flagged new as new, whatever update it carries", () => {
    const id = brief.story!.finding_id;
    const item = brief.items[0]!.finding_id;
    const c = variant(D, (b) => {
      b.story = { finding_id: id, new: true, update: { en: "An update that should not show.", zh: null } };
      b.items[0] = { finding_id: item, new: true, update: { en: "Another update that should not show.", zh: null } };
    });
    const out = lines(chatFor(c, D));
    expect(out.join("\n")).not.toContain("should not show");
    expect(out).toContain(moreLine(1, filed(c, item, D), first(findingIn(c, item).explainer.found.en)));
  });

  it("puts the update's first sentence in a returning More line instead of found", () => {
    const id = brief.items[0]!.finding_id;
    const c = variant(D, (b) => {
      b.items[0] = { finding_id: id, new: false, update: { en: "Later news. More later news.", zh: null } };
    });
    expect(lines(chatFor(c, D))).toContain(moreLine(1, filed(c, id, D), "Back: Later news."));
  });

  it("uses NO_AI_PART when ai_helped is null and the finding's own text otherwise", () => {
    const id = brief.story!.finding_id;
    const c = variant(D, () => {});
    const f = findingIn(c, id);
    f.ai.role = "none";
    f.ai.confidence = null;
    f.explainer.ai_helped = null;
    expect(chatFor(c, D)).toContain(`**${EXPLAINER_PART_INFO.ai_helped.en}.** ${NO_AI_PART.en}\n`);
    f.ai.role = "ai_tool";
    f.ai.confidence = "confirmed";
    f.explainer.ai_helped = { en: "A tool was used.", zh: null };
    expect(chatFor(c, D)).toContain(`**${EXPLAINER_PART_INFO.ai_helped.en}.** A tool was used.\n`);
  });

  it("prints DISCLOSURE under the story's last part and before a More line's link, and nowhere otherwise", () => {
    const c = variant(D, () => {});
    const story = findingIn(c, brief.story!.finding_id);
    const item = findingIn(c, brief.items[0]!.finding_id);
    for (const f of c.findings) f.disclosure = false;
    expect(chatFor(c, D)).not.toContain(DISCLOSURE.en);
    story.disclosure = true;
    let ls = lines(chatFor(c, D));
    const i = ls.indexOf(partLines(story).at(-1)!);
    expect(ls.slice(i + 1, i + 3)).toEqual([DISCLOSURE.en, `Read it: ${SITE}/findings/${story.id}`]);
    expect(ls.filter((l) => l === DISCLOSURE.en)).toHaveLength(1);
    story.disclosure = false;
    item.disclosure = true;
    ls = lines(chatFor(c, D));
    expect(ls).toContain(moreLine(1, item, first(item.explainer.found.en)));
    expect(ls.find((l) => l.startsWith("1. "))).toContain(` ${DISCLOSURE.en} ${SITE}/findings/${item.id}`);
    expect(ls).not.toContain(DISCLOSURE.en);
  });

  it("files each finding as the corrections file it on the edition's date", () => {
    const id = brief.items[0]!.finding_id;
    const c = variant(D, () => {});
    const f = findingIn(c, id);
    const target = f.significance === "watch" ? "landmark" : "watch";
    const correction = (cid: string, date: string, path: string, after: string) => ({
      id: cid, date, finding_id: id, edition_date: null, term_id: null, type: "correction" as const, path,
      before: { en: "x", zh: null }, after: { en: after, zh: null }, reason: { en: "y", zh: null }, source_url: null, trigger: "editor" as const, report_id: null,
    });
    c.corrections = [...c.corrections, correction("C-0090", D, "significance", target), correction("C-0091", D, "field", f.field === "physics" ? "earth" : "physics")];
    const out = lines(chatFor(c, D));
    const shown = out.find((l) => l.startsWith("1. "))!;
    const s = SIGNIFICANCE_INFO[target as keyof typeof SIGNIFICANCE_INFO];
    expect(shown).toContain(`${s.pips} ${s.en.toUpperCase()}`);
    expect(shown).toContain(FIELD_INFO[f.field === "physics" ? "earth" : "physics"].en);
    // A correction dated after the edition does not apply to it.
    c.corrections = c.corrections.map((x) => (x.id.startsWith("C-009") ? { ...x, date: `${D.slice(0, 8)}${String(Number(D.slice(8)) + 1).padStart(2, "0")}` } : x));
    expect(lines(chatFor(c, D)).find((l) => l.startsWith("1. "))).toBe(moreLine(1, filed(c, id, D), first(f.explainer.found.en)));
  });

  it("kicker(): the maker appears only with confidence claimed and a named system", () => {
    const base = { significance: "major", field: "biology", rung: "checked" } as const;
    const system = (maker: string) => ({ name: "Some Model", maker });
    expect(kicker({ ...base, ai: { role: "ai_solved", confidence: "claimed", systems: [system("Acme Labs"), system("Other Co")], evidence: [] } }))
      .toBe(["●●●○ MAJOR", FIELD_INFO.biology.en, `${AI_ROLE_INFO.ai_solved.en} (claimed by Acme Labs)`, RUNG_INFO.checked.en].join(DOT));
    expect(kicker({ ...base, ai: { role: "ai_solved", confidence: "claimed", systems: [system("Acme\n  Labs")], evidence: [] } })).toContain("(claimed by Acme Labs)");
    expect(kicker({ ...base, ai: { role: "ai_solved", confidence: "claimed", systems: [], evidence: [] } })).not.toContain("claimed by");
    expect(kicker({ ...base, ai: { role: "ai_solved", confidence: "confirmed", systems: [system("Acme Labs")], evidence: [] } })).not.toContain("claimed by");
    expect(kicker({ ...base, ai: { role: "none", confidence: null, systems: [], evidence: [] } }))
      .toBe(["●●●○ MAJOR", FIELD_INFO.biology.en, AI_ROLE_INFO.none.en, RUNG_INFO.checked.en].join(DOT));
    for (const sig of Object.keys(SIGNIFICANCE_INFO) as (keyof typeof SIGNIFICANCE_INFO)[]) {
      const s = SIGNIFICANCE_INFO[sig];
      expect(kicker({ ...base, significance: sig, ai: { role: "none", confidence: null, systems: [], evidence: [] } }).startsWith(`${s.pips} ${s.en.toUpperCase()}${DOT}`)).toBe(true);
    }
  });
});

// ── Monday ───────────────────────────────────────────────────────────────────────────────────────

describe("Monday: the week in review", () => {
  const content = sample();
  const monday = picks().monday;
  const D = monday.date;
  const ls = lines(chatFor(content, D));

  it("prints the short form of the sample's review: big picture, Strongest evidence against, Charts, no Most remarkable", () => {
    expect(monday.review!.remarkable).toBeNull();
    expect(monday.review!.strongest_against.text.en).toBe(NONE_FOUND.en);
    expect(ls.some((l) => l.startsWith("Most remarkable:"))).toBe(false);
    const i = ls.indexOf("**The week in review**");
    expect(i).toBeGreaterThan(2);
    expect(ls[i + 1]).toBe(norm(monday.review!.big_picture.en));
    expect(ls).toContain(`Strongest evidence against: ${NONE_FOUND.en}`);
    expect(ls).toContain(`Charts: ${SITE}/brief/${D}#review`);
  });

  it("puts the disclosure just before Charts when review is in disclosure, and drops it when it is not", () => {
    const listed = variant(D, (b) => { b.disclosure = ["review"]; });
    const out = lines(chatFor(listed, D));
    const i = out.indexOf(`Charts: ${SITE}/brief/${D}#review`);
    expect(out[i - 1]).toBe(DISCLOSURE.en);
    expect(out[i - 2]!.startsWith("Strongest evidence against: ")).toBe(true);
    expect(out.filter((l) => l === DISCLOSURE.en)).toHaveLength(1);
    const unlisted = variant(D, (b) => { b.disclosure = []; });
    expect(chatFor(unlisted, D)).not.toContain(DISCLOSURE.en);
  });

  it("prints Most remarkable between the big picture and Strongest evidence against when remarkable is set", () => {
    const id = monday.story!.finding_id;
    const c = variant(D, (b) => { b.review!.remarkable = { finding_id: id, note: { en: "A  short\nnote here.", zh: null } }; });
    const out = lines(chatFor(c, D));
    const line = `Most remarkable: ${norm(findingIn(c, id).title.en)} · A short note here. ${SITE}/findings/${id}`;
    const i = out.indexOf(line);
    expect(i).toBeGreaterThan(0);
    expect(out[i - 1]).toBe(norm(monday.review!.big_picture.en));
    expect(out[i + 1]).toBe(`Strongest evidence against: ${NONE_FOUND.en}`);
    checkChat(chatFor(c, D), SITE, { cap: CHAT_MAX_LINES });
  });

  it("leaves out Most remarkable when its finding did not load", () => {
    const id = monday.story!.finding_id;
    const c = variant(D, (b) => { b.review!.remarkable = { finding_id: id, note: { en: "A note.", zh: null } }; });
    c.findings = c.findings.filter((f) => f.id !== id);
    expect(chatFor(c, D)).not.toContain("Most remarkable");
  });

  it("puts each paragraph of the big picture on its own line and a single newline inside one as a space", () => {
    const c = variant(D, (b) => { b.review!.big_picture.en = "  \n\nFirst paragraph\nstill the first.\n\nSecond paragraph.\n  \nThird paragraph.\n\n  "; });
    const out = lines(chatFor(c, D));
    const i = out.indexOf("**The week in review**");
    expect(out.slice(i + 1, i + 4)).toEqual(["First paragraph still the first.", "Second paragraph.", "Third paragraph."]);
  });

  it("shows a counter-evidence text as given, and a quiet week's No new findings today. before the review", () => {
    const c = variant(D, (b) => {
      b.story = null;
      b.items = [];
      b.review!.strongest_against.text.en = "A trial failed.\nIt did not repeat.";
    });
    const out = lines(chatFor(c, D));
    expect(out).toContain("Strongest evidence against: A trial failed. It did not repeat.");
    expect(out.indexOf("No new findings today.")).toBe(out.indexOf("**The week in review**") - 1);
    expect(out.some((l) => l.startsWith("**More:**"))).toBe(false);
  });

  it("prints the story and the More list after the review", () => {
    const i = ls.indexOf(`Charts: ${SITE}/brief/${D}#review`);
    expect(ls[i + 1]).toBe(`**Story of the day: ${norm(filed(content, monday.story!.finding_id, D).title.en)}**`);
  });
});

// ── Sunday ───────────────────────────────────────────────────────────────────────────────────────

describe("Sunday: the deep dive", () => {
  const content = sample();
  const sunday = picks().sunday;
  const D = sunday.date;
  const ls = lines(chatFor(content, D));

  it("prints the deep dive in full, then the findings as More lines, with no story block", () => {
    const dive = sunday.deep_dive!;
    const f = filed(content, dive.finding_id, D);
    const i = ls.indexOf(`**Sunday deep dive: ${norm(f.title.en)}**`);
    expect(i).toBeGreaterThan(1);
    const paras = dive.text.en.split(/\n\s*\n/).map(norm).filter(Boolean);
    expect(paras.length, "the sample's deep dive has paragraphs").toBeGreaterThan(1);
    expect(ls.slice(i + 1, i + 1 + paras.length)).toEqual(paras);
    expect(ls.some((l) => l.startsWith("**Story of the day"))).toBe(false);
    expect(ls[i + 1 + paras.length]).toBe("**More:**");
    const entries = [...(sunday.story === null ? [] : [sunday.story]), ...sunday.items];
    entries.forEach((e, k) => expect(ls[i + 2 + paras.length + k]!.startsWith(`${k + 1}. ${norm(filed(content, e.finding_id, D).title.en)}`)).toBe(true));
  });

  it("puts a paragraph of the deep dive on each line and the whole text on one line only when the lines would pass the cap", () => {
    const text = Array.from({ length: 40 }, (_v, k) => `Paragraph ${k + 1} of the deep dive.`).join("\n\n");
    const few = variant(D, (b) => { b.deep_dive!.text.en = text.split("\n\n").slice(0, 3).join("\n\n"); });
    expect(lines(chatFor(few, D))).toContain("Paragraph 3 of the deep dive.");
    const many = variant(D, (b) => { b.deep_dive!.text.en = text; });
    const out = lines(chatFor(many, D));
    expect(out.length).toBeLessThanOrEqual(CHAT_MAX_LINES);
    expect(out).toContain(norm(text));
    expect(out.some((l) => l.startsWith("and "))).toBe(false);
  });

  it("makes a Sunday story the first More line", () => {
    const itemId = sunday.items[0]?.finding_id ?? picks().busiest.items[0]!.finding_id;
    const c = variant(D, (b) => {
      b.story = { finding_id: itemId, new: true, update: null };
      b.items = [];
    });
    const out = lines(chatFor(c, D));
    expect(out.some((l) => l.startsWith("**Story of the day"))).toBe(false);
    expect(out).toContain("**More:**");
    expect(out).toContain(moreLine(1, filed(c, itemId, D), first(findingIn(c, itemId).explainer.found.en)));
  });

  it("follows the deep dive with DISCLOSURE when deep_dive is in disclosure, and not otherwise", () => {
    const c = variant(D, (b) => { b.disclosure = ["deep_dive"]; });
    const out = lines(chatFor(c, D));
    const last = sunday.deep_dive!.text.en.split(/\n\s*\n/).map(norm).filter(Boolean).at(-1)!;
    const i = out.indexOf(last);
    expect(i).toBeGreaterThan(0);
    expect(out[i + 1]).toBe(DISCLOSURE.en);
    const d = variant(D, (b) => { b.disclosure = []; });
    expect(chatFor(d, D)).not.toContain(DISCLOSURE.en);
  });

  it("prints no deep dive when the brief has none or its finding did not load", () => {
    const none = variant(D, (b) => { b.deep_dive = null; });
    expect(chatFor(none, D)).not.toContain("Sunday deep dive");
    const gone = copyOfSample();
    gone.findings = gone.findings.filter((f) => f.id !== sunday.deep_dive!.finding_id);
    expect(chatFor(gone, D)).not.toContain("Sunday deep dive");
  });
});

// ── Days with no finding ─────────────────────────────────────────────────────────────────────────

describe("days with no finding", () => {
  const content = sample();
  const { noFindings, alsoOnly } = picks();

  it("prints No new findings today. after the Lead and still lists the rung changes", () => {
    const ls = lines(chatFor(content, noFindings.date));
    expect(ls[3]).toBe("No new findings today.");
    expect(ls[4]!.startsWith("Climbed or fell: ")).toBe(true);
    expect(ls.some((l) => l.startsWith("**More:**") || l.startsWith("**Story of the day"))).toBe(false);
  });

  it("counts Ideas and debate and Also noted lines, never printing them", () => {
    const ls = lines(chatFor(content, alsoOnly.date));
    expect(ls).toContain(`Ideas and debate (${alsoOnly.ideas.length}) · Also noted (${alsoOnly.also.length}): ${SITE}/brief/${alsoOnly.date}`);
    for (const line of alsoOnly.also) expect(ls.join("\n")).not.toContain(line.title.en);
  });

  it("leaves the counts line out when there are no ideas and no Also noted lines", () => {
    const c = variant(alsoOnly.date, (b) => { b.also = []; b.ideas = []; });
    expect(chatFor(c, alsoOnly.date)).not.toContain("Ideas and debate");
  });
});

// ── Climbed or fell, Corrections, Reports ────────────────────────────────────────────────────────

describe("Climbed or fell, Corrections and Reports", () => {
  const D = picks().busiest.date;

  it("lists at most three, then 'and k more', joined by semicolons", () => {
    const content = copyOfSample();
    const b = briefIn(content, D);
    const ids = content.findings.slice(0, 5).map((f) => f.id);
    b.rung_changes = ids.map((id) => ({ finding_id: id, from: "preprint", to: "checked", date: D, by: "script" }));
    const ls = lines(chatFor(content, D));
    const entries = ids.map((id) => `${norm(content.findings.find((f) => f.id === id)!.title.en)} ${RUNG_INFO.preprint.en} → ${RUNG_INFO.checked.en}`);
    expect(ls).toContain(`Climbed or fell: ${entries.slice(0, 3).join("; ")}; and 2 more`);
    b.rung_changes = b.rung_changes.slice(0, 3);
    expect(lines(chatFor(content, D))).toContain(`Climbed or fell: ${entries.slice(0, 3).join("; ")}`);
    b.rung_changes = [];
    expect(chatFor(content, D)).not.toContain("Climbed or fell");
  });

  it("leaves out a rung change whose finding did not load, as the site does, and does not count it in 'and k more'", () => {
    const content = copyOfSample();
    const b = briefIn(content, D);
    const ids = content.findings.slice(0, 5).map((f) => f.id);
    b.rung_changes = ids.map((id) => ({ finding_id: id, from: "preprint", to: "checked", date: D, by: "script" }));
    const entries = ids.map((id) => `${norm(content.findings.find((f) => f.id === id)!.title.en)} ${RUNG_INFO.preprint.en} → ${RUNG_INFO.checked.en}`);
    content.findings = content.findings.filter((f) => f.id !== ids[0]);
    expect(lines(chatFor(content, D))).toContain(`Climbed or fell: ${entries.slice(1, 4).join("; ")}; and 1 more`);
    expect(chatFor(content, D)).not.toContain(entries[0]!);
    b.rung_changes = b.rung_changes.slice(0, 1);
    expect(chatFor(content, D)).not.toContain("Climbed or fell");
  });

  it("lists corrections by id, type and target, and reports by id, status and finding, at most three and then 'and k more'", () => {
    const content = copyOfSample();
    const b = briefIn(content, D);
    const target = content.findings[0]!.id;
    const make = (n: number, over: object = {}) => ({
      id: `C-${String(n).padStart(4, "0")}`, date: D, finding_id: target, edition_date: null, term_id: null, type: "correction" as const,
      path: "explainer.found", before: { en: "a", zh: null }, after: { en: "b", zh: null }, reason: { en: "because", zh: null }, source_url: null,
      trigger: "editor" as const, report_id: null, ...over,
    });
    const stored = [make(70), make(71, { finding_id: null, edition_date: D, type: "update" }), make(72, { finding_id: null, term_id: content.terms[0]!.id, type: "clarification" }), make(73)];
    content.corrections = [...content.corrections, ...stored];
    b.corrections = stored.map((c) => ({ id: c.id, finding_id: c.finding_id, edition_date: c.edition_date, term_id: c.term_id, type: c.type, reason: c.reason }));
    b.reports = [
      { id: "R-0070", finding_id: target, status: "upheld" }, { id: "R-0071", finding_id: target, status: "rejected" },
      { id: "R-0072", finding_id: target, status: "upheld" }, { id: "R-0073", finding_id: target, status: "rejected" },
    ];
    content.reports = [...content.reports, ...b.reports.map((r, i) => ({
      id: r.id, received: `${D}T01:00:00+08:00`, issue_number: 70 + i, finding_id: r.finding_id, kind: "fact" as const, evidence_url: null, status: r.status,
      decided_by: "claude" as const, resolved_on: D, reason: { en: "Reason text.", zh: null }, correction_id: null,
    }))];
    const ls = lines(chatFor(content, D));
    expect(ls).toContain(`Corrections: C-0070 correction to ${target}; C-0071 update to ${D}; C-0072 clarification to ${content.terms[0]!.id}; and 1 more`);
    expect(ls).toContain(`Reports: R-0070 upheld (${target}); R-0071 rejected (${target}); R-0072 upheld (${target}); and 1 more`);
  });

  it("leaves out a correction that is not stored, one about a finding that did not load and one about a term that did not load", () => {
    const content = copyOfSample();
    const b = briefIn(content, D);
    const kept = content.findings[0]!.id;
    const gone = content.findings[1]!.id;
    const make = (n: number, over: object) => ({
      id: `C-${String(n).padStart(4, "0")}`, date: D, finding_id: kept, edition_date: null, term_id: null, type: "correction" as const, path: "explainer.found",
      before: { en: "a", zh: null }, after: { en: "b", zh: null }, reason: { en: "because", zh: null }, source_url: null, trigger: "editor" as const, report_id: null, ...over,
    });
    const listed = [make(80, {}), make(81, { finding_id: gone }), make(82, { finding_id: null, term_id: "no-such-term" }), make(83, {})];
    content.corrections = [...content.corrections, listed[0]!, listed[1]!, listed[2]!];
    content.findings = content.findings.filter((f) => f.id !== gone);
    b.corrections = listed.map((c) => ({ id: c.id, finding_id: c.finding_id, edition_date: c.edition_date, term_id: c.term_id, type: c.type, reason: c.reason }));
    b.reports = [{ id: "R-0080", finding_id: gone, status: "upheld" }, { id: "R-0081", finding_id: kept, status: "upheld" }];
    content.reports = [...content.reports, {
      id: "R-0080", received: `${D}T01:00:00+08:00`, issue_number: 80, finding_id: gone, kind: "fact", evidence_url: null, status: "upheld", decided_by: "jl",
      resolved_on: D, reason: null, correction_id: "C-0080",
    }];
    const out = chatFor(content, D);
    expect(out).toContain("Corrections: C-0080 correction to ");
    expect(out).not.toContain("C-0081");
    expect(out).not.toContain("C-0082");
    expect(out).not.toContain("C-0083");
    expect(out).not.toContain("R-0080 upheld");
    expect(out).not.toContain("R-0081");
  });

  it("prints a correction line that names no target with nothing after 'to', never a placeholder", () => {
    const content = copyOfSample();
    const b = briefIn(content, D);
    const stored = {
      id: "C-0095", date: D, finding_id: null, edition_date: null, term_id: null, type: "correction" as const, path: "lead.0.text", before: { en: "a", zh: null },
      after: { en: "b", zh: null }, reason: { en: "because", zh: null }, source_url: null, trigger: "editor" as const, report_id: null,
    };
    content.corrections = [...content.corrections, stored];
    b.corrections = [{ id: stored.id, finding_id: null, edition_date: null, term_id: null, type: "correction", reason: stored.reason }];
    expect(lines(chatFor(content, D))).toContain("Corrections: C-0095 correction to");
  });

  it("an edition with no correction or report has neither line", () => {
    const content = copyOfSample();
    const b = briefIn(content, D);
    b.corrections = [];
    b.reports = [];
    const out = chatFor(content, D);
    expect(out).not.toContain("Corrections:");
    expect(out).not.toContain("Reports:");
  });
});

// ── The 32-line cap ──────────────────────────────────────────────────────────────────────────────

describe("the 32-line cap", () => {
  const D = picks().busiest.date;

  it("is 32 lines (§8.8)", () => {
    expect(CHAT_MAX_LINES).toBe(32);
  });

  /** The busiest daily with `n` More items made from clones of one finding, ids made up. */
  function crowded(n: number): Content {
    const c = copyOfSample();
    const b = briefIn(c, D);
    const base = findingIn(c, b.items[0]!.finding_id);
    const added = Array.from({ length: n }, (_v, i) => ({ ...structuredClone(base), id: `phys-2026-${9000 + i}`, title: { en: `Crowded item ${i + 1}`, zh: null } }));
    c.findings = [...c.findings, ...added];
    b.items = added.map((f) => ({ finding_id: f.id, new: true, update: null }));
    return c;
  }

  it("trims the end of the More list to one 'and k more' line linking the brief, touching no other line", () => {
    const c = crowded(25);
    const out = chatFor(c, D);
    const ls = checkChat(out, SITE, { cap: CHAT_MAX_LINES });
    expect(ls).toHaveLength(CHAT_MAX_LINES);
    const i = ls.indexOf("**More:**");
    const shown = ls.filter((l) => /^\d+\. Crowded item /.test(l));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(25);
    shown.forEach((l, k) => expect(l.startsWith(`${k + 1}. Crowded item ${k + 1} · `)).toBe(true));
    expect(ls[i + 1 + shown.length]).toBe(`and ${25 - shown.length} more: ${SITE}/brief/${D}`);
    // Everything before More and after the trim line is what a short edition prints.
    const short = lines(chatFor(crowded(1), D));
    expect(ls.slice(0, i)).toEqual(short.slice(0, short.indexOf("**More:**")));
    expect(ls.slice(i + 2 + shown.length)).toEqual(short.slice(short.indexOf("**More:**") + 2));
  });

  it("does not trim a list that fits, and prints it whole at exactly the cap", () => {
    const base = lines(chatFor(crowded(0), D)).length;
    const room = CHAT_MAX_LINES - base - 1; // the More header is one line
    const fits = lines(chatFor(crowded(room), D));
    expect(fits).toHaveLength(CHAT_MAX_LINES);
    expect(fits.some((l) => l.startsWith("and "))).toBe(false);
    expect(fits.filter((l) => /^\d+\. Crowded item /.test(l))).toHaveLength(room);
    const over = lines(chatFor(crowded(room + 1), D));
    expect(over).toHaveLength(CHAT_MAX_LINES);
    expect(over.filter((l) => /^\d+\. Crowded item /.test(l))).toHaveLength(room - 1);
    expect(over.some((l) => l === `and 2 more: ${SITE}/brief/${D}`)).toBe(true);
  });

  /** The Monday of the sample with every optional group present and a big picture of `paragraphs` paragraphs. */
  function busyMonday(paragraphs: number): Content {
    const c = copyOfSample();
    const b = briefIn(c, picks().monday.date);
    b.review!.big_picture.en = Array.from({ length: paragraphs }, (_v, i) => `Paragraph ${i + 1} of the big picture.`).join("\n\n");
    b.review!.remarkable = { finding_id: b.story?.finding_id ?? b.items[0]!.finding_id, note: { en: "The week's note.", zh: null } };
    b.disclosure = ["review"];
    const busy = structuredClone(picks().busiest);
    b.ideas = busy.ideas;
    b.also = busy.also;
    b.rung_changes = busy.rung_changes;
    b.corrections = busy.corrections;
    b.reports = busy.reports;
    return c;
  }

  it("puts the big picture on one line, dropping no word, when its paragraphs would pass the cap, and keeps the More lines", () => {
    const D2 = picks().monday.date;
    const ten = lines(chatFor(busyMonday(10), D2));
    expect(ten.length).toBeLessThanOrEqual(CHAT_MAX_LINES);
    expect(ten).toContain(Array.from({ length: 10 }, (_v, i) => `Paragraph ${i + 1} of the big picture.`).join(" "));
    expect(ten.filter((l) => /^\d+\. /.test(l))).toHaveLength(picks().monday.items.length + (picks().monday.story === null ? 0 : 1) - 1);
    // Few enough paragraphs keep a line each.
    expect(lines(chatFor(busyMonday(2), D2))).toContain("Paragraph 2 of the big picture.");
  });

  it("keeps a line for each paragraph when they fill the cap exactly, and puts them on one line from one paragraph more", () => {
    const D2 = picks().monday.date;
    const one = lines(chatFor(busyMonday(1), D2)).length;
    expect(one).toBeLessThan(CHAT_MAX_LINES);
    const exact = CHAT_MAX_LINES - one + 1;
    const fits = lines(chatFor(busyMonday(exact), D2));
    expect(fits).toHaveLength(CHAT_MAX_LINES);
    expect(fits).toContain(`Paragraph ${exact} of the big picture.`);
    const over = lines(chatFor(busyMonday(exact + 1), D2));
    expect(over.length).toBeLessThanOrEqual(CHAT_MAX_LINES);
    expect(over).not.toContain(`Paragraph ${exact + 1} of the big picture.`);
    expect(over).toContain(Array.from({ length: exact + 1 }, (_v, i) => `Paragraph ${i + 1} of the big picture.`).join(" "));
  });

  it("holds the cap on a Monday of any number of paragraphs, with every optional line present", () => {
    for (const n of [1, 3, 4, 5, 6, 7, 12, 60]) {
      const out = chatFor(busyMonday(n), picks().monday.date);
      checkChat(out, SITE, { cap: CHAT_MAX_LINES });
    }
  });

  /** `crowded(k)` with a Monday review whose big picture has 80 paragraphs, too long for a line each. */
  function crowdedWithLongReview(k: number): Content {
    const c = crowded(k);
    const b = briefIn(c, D);
    b.review = copyOfSample().briefs.find((x) => x.review !== null)!.review;
    b.review!.big_picture.en = Array.from({ length: 80 }, (_v, i) => `Paragraph ${i + 1}.`).join("\n\n");
    return c;
  }

  it("prints the More lines whole at exactly the cap once the long text is on one line, and trims from one more", () => {
    const room = CHAT_MAX_LINES - lines(chatFor(crowdedWithLongReview(0), D)).length - 1; // the More header is one line
    expect(room).toBeGreaterThan(1);
    const fits = lines(chatFor(crowdedWithLongReview(room), D));
    expect(fits).toHaveLength(CHAT_MAX_LINES);
    expect(fits.some((l) => l.startsWith("and "))).toBe(false);
    expect(fits.filter((l) => /^\d+\. Crowded item /.test(l))).toHaveLength(room);
    const over = lines(chatFor(crowdedWithLongReview(room + 1), D));
    expect(over).toHaveLength(CHAT_MAX_LINES);
    expect(over.filter((l) => /^\d+\. Crowded item /.test(l))).toHaveLength(room - 1);
    expect(over).toContain(`and 2 more: ${SITE}/brief/${D}`);
  });

  it("trims the More lines only after the long text is on one line, and never shows a negative number of them", () => {
    const c = crowdedWithLongReview(25);
    const ls = lines(chatFor(c, D));
    expect(ls).toHaveLength(CHAT_MAX_LINES);
    expect(ls).toContain(Array.from({ length: 80 }, (_v, i) => `Paragraph ${i + 1}.`).join(" "));
    const shown = ls.filter((l) => /^\d+\. Crowded item /.test(l)).length;
    expect(shown).toBeGreaterThan(0);
    expect(ls).toContain(`and ${25 - shown} more: ${SITE}/brief/${D}`);
  });
});

// ── Data-only edition ────────────────────────────────────────────────────────────────────────────

describe("data-only edition", () => {
  const content = sample();
  const brief = picks().dataOnly;
  const D = brief.date;
  const runs = lastRunRecords(statusRuns(content, D));

  it("prints the sample's data-only edition: heading with its code, Pace, Climbed or fell, What happened, Next step, Brief, run line", () => {
    const ls = lines(chatFor(content, D));
    const code = runs.at(-1)!.error_code!;
    expect(ls[0]).toBe(`**${SITE_NAME} ${D} · data-only edition, published ${hm(brief.published_at)}** (${code})`);
    expect(ls[1]).toBe(norm(brief.pace.sentence.en));
    const { attempts, repairs } = runCounts(runs);
    expect(ls[3]).toBe(`What happened: ${whatHappened(code, {
      date: D, errors: runs.at(-1)!.validation?.errors ?? 0, repairs, attempts, agentMinutes: Math.max(1, Math.round(runs.at(-1)!.budgets.agent_seconds / 60)),
      hardStop: runConfig.schedule.hard_stop, publishUntil: runConfig.schedule.publish_until,
    })}`);
    expect(ls[4]).toBe(`Next step: ${nextStepFor(code, D)}`);
    expect(ls).toContain(`Brief: ${SITE}/brief/${D}`);
    expect(ls.at(-1)).toBe(expectedRunLine(runs, brief, false));
    expect(ls.at(-1)).not.toContain("Chinese");
    expect(ls.at(-1)).not.toContain("source");
    const changes = brief.rung_changes.map((c) => `${norm(filed(content, c.finding_id, D).title.en)} ${RUNG_INFO[c.from].en} → ${RUNG_INFO[c.to].en}`);
    expect(ls[2]).toBe(`Climbed or fell: ${capped(changes)}`);
  });

  /** The edition of `D` as a hand-built data-only run: `over` changes its record. */
  const handBuilt = (over: Partial<RunRecord>, extra: Partial<ChatSource> = {}, edit: (b: Brief) => void = () => {}) => {
    const c = variant(D, (b) => { b.rung_changes = []; edit(b); });
    return lines(chatFor(c, D, {
      runs: [runRecord(D, {
        outcome: "published_data_only", edition: "data_only", full_published_at: null, error_code: null,
        deploy: { triggered: true, ready_at: at(D, "03:58"), shows_date: D, shows_edition: "data_only" }, ...over,
      })], ...extra,
    }));
  };

  it("says 'none since the last edition' with no rung change", () => {
    expect(handBuilt({})[2]).toBe("Climbed or fell: none since the last edition.");
  });

  it("explains a data-only edition with no error code: requested, or started after the hard stop, with no Next step", () => {
    const requested = handBuilt({ stages: stages({ draft: { status: "skipped", note: STAGE_NOTES.dataOnlyRequested } }) });
    expect(requested).toContain(`What happened: ${STAGE_NOTES.dataOnlyRequested}`);
    expect(requested.some((l) => l.startsWith("Next step:"))).toBe(false);
    expect(requested[0]!.endsWith("**")).toBe(true);
    const late = handBuilt({ started_at: at(D, "04:40"), stages: stages({ draft: { status: "skipped", note: STAGE_NOTES.startedAfterHardStop("04:25") } }) });
    expect(late).toContain(`What happened: ${STAGE_NOTES.startedAfterHardStop("04:25")}`);
    const noNote = handBuilt({ started_at: at(D, "04:40") });
    expect(noNote).toContain(`What happened: ${STAGE_NOTES.startedAfterHardStop("04:25")}`);
    // The note as the run wrote it is echoed, whatever hard stop it named.
    const echoed = handBuilt({ started_at: at(D, "04:40"), stages: stages({ draft: { status: "skipped", note: STAGE_NOTES.startedAfterHardStop("04:10") } }) });
    expect(echoed).toContain(`What happened: ${STAGE_NOTES.startedAfterHardStop("04:10")}`);
    expect(handBuilt({ started_at: at(D, "04:20") })).toContain(`What happened: ${STAGE_NOTES.dataOnlyRequested}`);
    expect(handBuilt({ started_at: at(D, "04:25") })).toContain(`What happened: ${STAGE_NOTES.dataOnlyRequested}`);
  });

  it("uses the schedule given for the hard stop", () => {
    const out = handBuilt({ started_at: at(D, "04:40") }, { schedule: { hard_stop: "05:00", publish_until: "11:00" } });
    expect(out).toContain(`What happened: ${STAGE_NOTES.dataOnlyRequested}`);
  });

  it("names the code, what happened and the next step for an error code, in a dry run's own words too", () => {
    const out = handBuilt({ error_code: "E_AGENT" });
    expect(out[0]).toBe(`**${SITE_NAME} ${D} · data-only edition, published ${hm(brief.published_at)}** (E_AGENT)`);
    expect(out).toContain("Next step: " + nextStepFor("E_AGENT", D));
    const dry = handBuilt({ trigger: "dry_run", outcome: "dry_run", edition: "data_only", error_code: "E_AGENT" });
    expect(dry[0]).toBe(`**${SITE_NAME} ${D} · dry run (data-only edition)** (E_AGENT)`);
    expect(dry).toContain("Next step: " + dryRunNextStepFor("E_AGENT", D));
    expect(dry).toContain(`Dry run: nothing was published; files in logs/dry-run/${D}/`);
    expect(dry.some((l) => l.startsWith("Brief: "))).toBe(false);
  });

  it("keeps E_PUBLISH's hand command as it is for a stored data-only edition", () => {
    const out = handBuilt({ error_code: "E_PUBLISH" });
    expect(out.find((l) => l.startsWith("Next step: "))).toBe(`Next step: ${nextStepFor("E_PUBLISH", D)}`);
    expect(out.join("\n")).not.toContain("--force");
  });

  it("takes the notes of the run into its Notes line", () => {
    const out = handBuilt({ error_code: "E_AGENT", soft_gates: { checked: 4, dropped: 2, by_code: {} } });
    expect(out).toContain(`Notes: ${CHAT_NOTES.dropped(2)}`);
  });
});

// ── Failed ───────────────────────────────────────────────────────────────────────────────────────

describe("failed", () => {
  const content = sample();
  const input = (over: Partial<ChatSource> = {}, run: RunRecord[] = [failedRun()]) =>
    lines(chatFor(content, OTHER_DATE, { runs: run, ...over }));

  it("prints the heading with the code, What happened, First errors, Site shows, Draft and logs, Next step and the Run line", () => {
    const ls = input({ siteShows: { date: "2026-10-20", edition: "full" } });
    expect(ls).toEqual([
      `**${SITE_NAME} ${OTHER_DATE} · failed** (E_VALIDATION)`,
      `What happened: The draft still had 2 validation errors after 2 repairs and 1 attempt.`,
      "First errors:", "- WORDS", "- COUNTS",
      "Site shows: the 2026-10-20 full edition",
      `Draft and logs: needs-review/${OTHER_DATE}/`,
      `Next step: ${nextStepFor("E_VALIDATION", OTHER_DATE)}`,
      "Run: started 03:15, ended 04:01 · attempts 1, repairs 2",
    ]);
  });

  it("names the edition the site shows in the word of its edition, or says there is none", () => {
    expect(input({ siteShows: { date: "2026-10-20", edition: "data_only" } })).toContain("Site shows: the 2026-10-20 data-only edition");
    expect(input({ siteShows: { date: "2026-10-20", edition: "partial" } })).toContain("Site shows: the 2026-10-20 partial edition");
    expect(input({ siteShows: null })).toContain("Site shows: no edition yet.");
    expect(input()).toContain("Site shows: no edition yet.");
  });

  it("shows each validator issue's code and a safe path, at most five, errors only and never a message", () => {
    const issues = [
      { code: "WORDS", path: "items[2].explainer.found", severity: "error" as const, message: "MESSAGE-MARKER one" },
      { code: "SOURCES", path: "briefs/2026-10-21.json: lead[0].text.en", message: "MESSAGE-MARKER two" },
      { code: "COUNTS", path: "(root)", severity: "warning" as const },
      { code: "not-a-code", path: "a-b.c d", severity: "error" as const },
      { code: "DUAL_USE", path: `x.${CANARY_TOKEN}`, severity: "error" as const },
      { code: "ZH_PARITY", path: "[0].id", severity: "error" as const },
      { code: "EXTRA", path: "(file)", severity: "error" as const },
      { code: "SIXTH", path: "(run)", severity: "error" as const },
    ];
    const ls = input({ issues });
    const at5 = ls.slice(ls.indexOf("First errors:") + 1, ls.indexOf("First errors:") + 7);
    expect(at5).toEqual([
      "- WORDS at items[2].explainer.found", "- SOURCES at briefs/2026-10-21.json: lead[0].text.en", "- UNKNOWN at (path not shown)",
      "- DUAL_USE at (path not shown)", "- ZH_PARITY at [0].id", "Site shows: no edition yet.",
    ]);
    expect(ls.join("\n")).not.toContain("MESSAGE-MARKER");
    expect(ls[1]).toBe("What happened: The draft still had 7 validation errors after 2 repairs and 1 attempt.");
  });

  it("falls back to the run's validation codes with no issues, and prints SIMULATED at (run) for E_SIMULATED", () => {
    expect(input()).toContain("- WORDS");
    const sim = input({}, [failedRun({ error_code: "E_SIMULATED", validation: null })]);
    expect(sim).toContain("- SIMULATED at (run)");
    expect(sim).toContain("What happened: A simulated failure (--simulate-failure) stopped the run after a valid draft.");
    const other = input({}, [failedRun({ error_code: "E_AGENT" })]);
    expect(other).not.toContain("First errors:");
  });

  it("is E_INTERNAL with no code anywhere, and says so when the run left no end record", () => {
    const none = input({}, [failedRun({ error_code: null })]);
    expect(none[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · failed** (E_INTERNAL)`);
    expect(none[1]).toBe(`What happened: ${WHAT_HAPPENED.E_INTERNAL({} as WhatFacts)}`);
    const unfinished = input({}, [failedRun({ error_code: null, outcome: null, finished_at: null })]);
    expect(unfinished[1]).toBe("What happened: The run left no end record; it may have been stopped before it finished.");
    // A code that arrived through the source, for a failure that left no record, with no run line.
    const early = input({ code: "E_NET" }, []);
    expect(early[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · failed** (E_NET)`);
    expect(early[1]).toBe(`What happened: ${WHAT_HAPPENED.E_NET({} as WhatFacts)}`);
    expect(early.some((l) => l.startsWith("Run: "))).toBe(false);
    // An unfinished record that does carry a code is that code.
    const coded = input({}, [failedRun({ error_code: "E_AGENT", outcome: null, finished_at: null })]);
    expect(coded[1]).toBe("What happened: The agent wrote no draft in 1 attempt.");
  });

  it("takes the code of the newest record that has one, and a code that arrived alone needs no record", () => {
    const retry = failedRun({ trigger: "retry", attempt: 2, error_code: null, outcome: "failed", started_at: at(OTHER_DATE, "04:05"), finished_at: at(OTHER_DATE, "04:10") });
    expect(input({}, [failedRun({ error_code: "E_AGENT" }), retry])[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · failed** (E_AGENT)`);
    const newer = failedRun({ trigger: "retry", attempt: 2, error_code: "E_TIMEOUT", started_at: at(OTHER_DATE, "04:05"), finished_at: at(OTHER_DATE, "04:10") });
    expect(input({}, [failedRun({ error_code: "E_AGENT" }), newer])[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · failed** (E_TIMEOUT)`);
    // A record that has a code is the code, whatever else arrived with it.
    expect(input({ code: "E_NET" }, [failedRun({ error_code: "E_AGENT" })])[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · failed** (E_AGENT)`);
    expect(input({ code: "E_NET" }, [failedRun({ error_code: null })])[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · failed** (E_NET)`);
    const alone = input({ code: "E_PUBLISH" }, []);
    expect(alone[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · failed** (E_PUBLISH)`);
    expect(alone).toContain(`Next step: ${nextStepFor("E_PUBLISH", OTHER_DATE)}`);
  });

  it("gives the agent's time in whole minutes for E_TIMEOUT, at least one, and none when the agent never ran", () => {
    const timeout = (seconds: number) => input({}, [failedRun({ error_code: "E_TIMEOUT", budgets: budgets(OTHER_DATE, { agent_seconds: seconds }) })])[1];
    expect(timeout(1500)).toBe("What happened: The agent timed out after 25 minutes without writing a draft.");
    expect(timeout(20)).toBe("What happened: The agent timed out after 1 minute without writing a draft.");
    expect(timeout(89)).toBe("What happened: The agent timed out after 1 minute without writing a draft.");
    expect(timeout(91)).toBe("What happened: The agent timed out after 2 minutes without writing a draft.");
    expect(timeout(0)).toBe(`What happened: The run had too little time left for an editorial pass before ${runConfig.schedule.hard_stop}.`);
  });

  it("leaves out Draft and logs when needsReview is false, and for a dry run", () => {
    expect(input({ needsReview: false }).some((l) => l.startsWith("Draft and logs:"))).toBe(false);
    expect(input({ needsReview: true })).toContain(`Draft and logs: needs-review/${OTHER_DATE}/`);
    const dry = input({}, [failedRun({ trigger: "dry_run", outcome: "failed" })]);
    expect(dry[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · dry run (failed)** (E_VALIDATION)`);
    expect(dry).toContain("Dry run: nothing was published.");
    expect(dry.some((l) => l.startsWith("Draft and logs:") || l.startsWith("Site shows:"))).toBe(false);
    expect(dry).toContain(`Next step: ${dryRunNextStepFor("E_VALIDATION", OTHER_DATE)}`);
    expect(input({ needsReview: true }, [failedRun({ trigger: "dry_run", outcome: "failed" })])).toContain(`Draft and logs: needs-review/${OTHER_DATE}/`);
    const flagged = input({ dryRun: true, code: "E_CONFIG" }, []);
    expect(flagged[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · dry run (failed)** (E_CONFIG)`);
  });

  it("counts attempts and repairs across the run and its retries, in the Run line", () => {
    const retry = failedRun({
      trigger: "retry", attempt: 2, started_at: at(OTHER_DATE, "04:05"), finished_at: at(OTHER_DATE, "04:20"), budgets: budgets(OTHER_DATE, { repair_rounds: 1 }),
    });
    const ls = input({}, [failedRun(), retry]);
    expect(ls.at(-1)).toBe("Run: started 03:15, ended 04:20 · attempts 2, repairs 3");
    expect(ls[1]).toBe("What happened: The draft still had 2 validation errors after 3 repairs and 2 attempts.");
  });

  it("E_PUBLISH after a draft that failed whole-tree validation gives the Validation lines' step, and --force after an earlier full edition", () => {
    const notValid = failedRun({ error_code: "E_PUBLISH", stages: stages({ publish: { status: "failed", note: STAGE_NOTES.notValid } }) });
    const ls = input({}, [notValid]);
    expect(ls[1]).toBe(`What happened: ${NOT_VALID.what}`);
    expect(ls).toContain(`Next step: ${NOT_VALID.nextStep.replaceAll("{date}", OTHER_DATE)}`);
    const dry = input({}, [failedRun({ trigger: "dry_run", error_code: "E_PUBLISH", stages: stages({ publish: { status: "failed", note: STAGE_NOTES.notValid } }) })]);
    expect(dry[1]).toBe(`What happened: ${NOT_VALID.what}`);
    expect(dry).toContain(`Next step: ${NOT_VALID.dryRunStep.replaceAll("{date}", OTHER_DATE)}`);
    // A push failure keeps E_PUBLISH's own lines.
    const push = input({}, [failedRun({ error_code: "E_PUBLISH" })]);
    expect(push[1]).toBe(`What happened: ${WHAT_HAPPENED.E_PUBLISH({} as WhatFacts)}`);
    // With an edition of that date already stored as full, the hand command and the rerun take --force.
    const D = picks().busiest.date;
    const stored = lines(chatFor(content, D, { runs: [runRecord(D, { outcome: "failed", edition: null, error_code: "E_PUBLISH", full_published_at: null })] }));
    const step = stored.find((l) => l.startsWith("Next step: "))!;
    expect(step).toContain(`npm run publish -- --date ${D} --force`);
  });

  it("is the failed format, with BRIEF_LEFT_OUT's lines, when the run published an edition whose brief the loader left out", () => {
    const D = picks().busiest.date;
    const c = copyOfSample();
    c.briefs = c.briefs.filter((b) => b.date !== D);
    const runs = [runRecord(D)];
    const ls = lines(chatFor(c, D, { runs }));
    expect(ls[0]).toBe(`**${SITE_NAME} ${D} · failed** (E_INTERNAL)`);
    expect(ls[1]).toBe(`What happened: ${BRIEF_LEFT_OUT.what}`);
    expect(ls).toContain(`Next step: ${BRIEF_LEFT_OUT.nextStep}`);
    // A dry run has no brief in its copy only when its run failed, so it keeps the code's own lines.
    const dry = lines(chatFor(c, D, { runs: [runRecord(D, { trigger: "dry_run", outcome: "dry_run", edition: "full" })] }));
    expect(dry[1]).not.toContain("the site's checks");
  });

  it("uses the schedule given in What happened", () => {
    const ls = input({ schedule: { hard_stop: "05:00", publish_until: "12:00" } }, [failedRun({ error_code: "E_TOO_LATE" })]);
    expect(ls[1]).toBe("What happened: The full edition was not published: nothing is published after 12:00.");
    const timeout = input({ schedule: { hard_stop: "05:00", publish_until: "12:00" } }, [failedRun({ error_code: "E_TIMEOUT", budgets: budgets(OTHER_DATE, { agent_seconds: 0 }) })]);
    expect(timeout[1]).toBe("What happened: The run had too little time left for an editorial pass before 05:00.");
  });
});

// ── Skipped ──────────────────────────────────────────────────────────────────────────────────────

describe("skipped", () => {
  const content = sample();
  const D = picks().busiest.date;
  const skipRun = (date: string, over: Partial<RunRecord> = {}) =>
    runRecord(date, { outcome: "skipped", edition: null, error_code: null, data_only_published_at: null, full_published_at: null, ...over });
  const noted = (id: "preflight" | "draft", note: string) => stages({ [id]: { status: "skipped" as const, note } } as Parameters<typeof stages>[0]);

  it("prints the reason and the brief link when a brief exists, from the preflight note", () => {
    const note = STAGE_NOTES.alreadyPublished("03:56");
    const ls = lines(chatFor(content, D, { runs: [skipRun(D, { stages: noted("preflight", note) })] }));
    expect(ls).toEqual([`**${SITE_NAME} ${D} · skipped.** ${note}`, `${SITE}/brief/${D}`]);
  });

  it("prints the reason alone when no brief loaded", () => {
    const note = STAGE_NOTES.tooLate("11:00");
    const ls = lines(chatFor(content, OTHER_DATE, { runs: [skipRun(OTHER_DATE, { started_at: at(OTHER_DATE, "11:05"), stages: noted("preflight", note) })] }));
    expect(ls).toEqual([`**${SITE_NAME} ${OTHER_DATE} · skipped.** ${note}`]);
  });

  it("reads the too-early and Cyber's-run notes from the stage notes", () => {
    for (const note of [STAGE_NOTES.tooEarly("03:15"), STAGE_NOTES.cyberRun("04:30", "05:30"), STAGE_NOTES.alreadyPublished("04:01"), STAGE_NOTES.tooLate("11:00")]) {
      const ls = lines(chatFor(content, OTHER_DATE, { runs: [skipRun(OTHER_DATE, { stages: stages({ preflight: { status: "skipped", note: `${note} Dependencies changed since the last npm ci.` } }) })] }));
      expect(ls[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · skipped.** ${note}`);
    }
  });

  it("works out the reason from the times when no note says it", () => {
    const late = lines(chatFor(content, OTHER_DATE, { runs: [skipRun(OTHER_DATE, { started_at: at(OTHER_DATE, "11:30") })] }));
    expect(late[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · skipped.** ${STAGE_NOTES.tooLate("11:00")}`);
    const onTime = lines(chatFor(content, OTHER_DATE, { runs: [skipRun(OTHER_DATE, { started_at: at(OTHER_DATE, "11:00") })] }));
    expect(onTime[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · skipped.** ${STAGE_NOTES.alreadyPublished("11:00")}`);
    const stored = lines(chatFor(content, D, { runs: [skipRun(D, { started_at: at(D, "05:40") })] }));
    expect(stored[0]).toBe(`**${SITE_NAME} ${D} · skipped.** ${STAGE_NOTES.alreadyPublished(hm(picks().busiest.published_at))}`);
    const custom = lines(chatFor(content, OTHER_DATE, { schedule: { hard_stop: "04:25", publish_until: "12:00" }, runs: [skipRun(OTHER_DATE, { started_at: at(OTHER_DATE, "11:30") })] }));
    expect(custom[0]).toBe(`**${SITE_NAME} ${OTHER_DATE} · skipped.** ${STAGE_NOTES.alreadyPublished("11:30")}`);
  });

  it("prints a dry run that stopped at preflight step 6 as a dry-run skip", () => {
    const note = STAGE_NOTES.tooEarly("03:15");
    const run = runRecord(OTHER_DATE, { trigger: "dry_run", outcome: "dry_run", edition: null, stages: stages({ preflight: { status: "skipped", note } }) });
    expect(lines(chatFor(content, OTHER_DATE, { runs: [run] }))).toEqual([`**${SITE_NAME} ${OTHER_DATE} · dry run (skipped).** ${note}`]);
    const withBrief = lines(chatFor(content, D, { runs: [run] }));
    expect(withBrief).toEqual([`**${SITE_NAME} ${D} · dry run (skipped).** ${note}`, `${SITE}/brief/${D}`]);
  });

  it("builds the brief link from the site given", () => {
    const run = skipRun(D, { stages: noted("preflight", STAGE_NOTES.alreadyPublished("03:56")) });
    const input = chatInputFor({ date: D, content, runs: [run], siteUrl: "https://example.test//" });
    expect(input).toMatchObject({ kind: "skipped", briefUrl: `https://example.test/brief/${D}` });
  });

  it("drops a link line that holds only spaces", () => {
    expect(renderChat({ kind: "skipped", date: D, reason: "Reason.", briefUrl: "   ", dryRun: false }, SITE)).toBe(`**${SITE_NAME} ${D} · skipped.** Reason.\n`);
  });

  it("collapses a multi-line reason to one line", () => {
    expect(renderChat({ kind: "skipped", date: D, reason: "One\nTwo", briefUrl: null, dryRun: false }, SITE)).toBe(`**${SITE_NAME} ${D} · skipped.** One Two\n`);
  });
});

// ── Dry-run forms of a published edition ─────────────────────────────────────────────────────────

describe("dry run of a published edition", () => {
  const content = sample();
  const brief = picks().busiest;
  const D = brief.date;
  const dryRun = runRecord(D, { trigger: "dry_run", outcome: "dry_run", edition: "full" });

  it("is headed 'dry run (full edition)', has no Full brief line and names the dry-run folder", () => {
    const ls = lines(chatFor(content, D, { runs: [dryRun] }));
    expect(ls[0]).toBe(`**${SITE_NAME} ${D} · dry run (full edition)**`);
    expect(ls).toContain(`Dry run: nothing was published; files in logs/dry-run/${D}/`);
    expect(ls.some((l) => l.startsWith("Full brief:"))).toBe(false);
    expect(ls.join("\n")).not.toContain("site not yet showing");
  });

  it("is headed 'dry run (partial edition, English-only)' for a partial English-only edition", () => {
    const c = variant(D, (b) => { b.edition = "partial"; b.languages.zh = false; });
    expect(lines(chatFor(c, D, { runs: [runRecord(D, { trigger: "dry_run", outcome: "dry_run", edition: "partial" })] }))[0])
      .toBe(`**${SITE_NAME} ${D} · dry run (partial edition, English-only)**`);
  });
});

// ── Notes ────────────────────────────────────────────────────────────────────────────────────────

describe("Notes", () => {
  const content = sample();
  const brief = picks().busiest;
  const D = brief.date;
  const base = () => runRecord(D, { deploy: { triggered: true, ready_at: at(D, "03:58"), shows_date: D, shows_edition: brief.edition } });
  const notesOf = (runs: RunRecord[], over: Partial<ChatSource> = {}, c: Content = content): string | undefined =>
    lines(chatFor(c, D, { runs, ...over })).find((l) => l.startsWith("Notes: "));
  const feed = (id: string, status: "ok" | "stale" | "failed" | "skipped") => ({
    id, status, newest: null, checked_at: at(D, "03:16"), stale_since: status === "ok" ? null : D, records: null, note: null,
  });

  it("has no Notes line when nothing applies", () => {
    expect(notesOf([base()], {}, variant(D, (b) => { b.pace.status = "ok"; }))).toBeUndefined();
  });

  it("counts dropped findings across the records, singular for one", () => {
    expect(notesOf([runRecord(D, { soft_gates: { checked: 3, dropped: 1, by_code: {} } })])).toBe(`Notes: ${CHAT_NOTES.dropped(1)}`);
    expect(CHAT_NOTES.dropped(1)).toBe("1 finding dropped (unverified)");
    expect(CHAT_NOTES.dropped(3)).toBe("3 findings dropped (unverified)");
    const two = [runRecord(D, { soft_gates: { checked: 3, dropped: 2, by_code: {} } }), runRecord(D, { trigger: "retry", soft_gates: { checked: 3, dropped: 1, by_code: {} } })];
    expect(notesOf(two)).toBe("Notes: 3 findings dropped (unverified)");
    expect(notesOf([runRecord(D, { soft_gates: { checked: 3, dropped: 0, by_code: {} } })])).toBeUndefined();
  });

  it("lists the stale and failed feeds of the first record, in order, and not the ok or skipped ones", () => {
    const feeds = [feed("alpha", "stale"), feed("beta", "ok"), feed("gamma", "failed"), feed("delta", "skipped")];
    expect(notesOf([runRecord(D, { feeds })])).toBe("Notes: feeds stale: alpha, gamma");
    const retry = runRecord(D, { trigger: "retry", feeds: [feed("omega", "stale")] });
    expect(notesOf([runRecord(D, { feeds }), retry])).toBe("Notes: feeds stale: alpha, gamma");
    expect(notesOf([runRecord(D, { feeds: [feed("beta", "ok")] })])).toBeUndefined();
  });

  it("notes a stale Pace with the data's date, and nothing for an ok or missing Pace", () => {
    const stale = variant(D, (b) => { b.pace.status = "stale"; });
    expect(notesOf([base()], {}, stale)).toBe(`Notes: Pace stale: data to ${dm(brief.provenance.data_cutoff)}`);
    expect(notesOf([base()], {}, variant(D, (b) => { b.pace.status = "missing"; }))).toBeUndefined();
  });

  it("notes a Chinese pass that is not ready when any record carries E_ZH", () => {
    expect(notesOf([runRecord(D, { error_code: "E_ZH" })])).toBe("Notes: Chinese edition not ready (E_ZH)");
    expect(notesOf([runRecord(D, { error_code: "E_ZH" }), runRecord(D, { trigger: "retry" })])).toBe("Notes: Chinese edition not ready (E_ZH)");
  });

  it("counts broken and changed links in the newest record that has a link check", () => {
    const links = (broken: number, changed: number) => ({
      checked_at: at(D, "04:01"), checked: 5, ok: 5 - broken - changed, unknown: 0,
      broken: [
        ...Array.from({ length: broken }, (_v, i) => ({ url: `${SITE}/b${i}`, ref: `${D}/brief`, result: "broken" as const, http: 404 })),
        ...Array.from({ length: changed }, (_v, i) => ({ url: `${SITE}/c${i}`, ref: `${D}/brief`, result: "changed" as const, http: 200 })),
      ],
    });
    expect(notesOf([runRecord(D, { links: links(1, 2) })])).toBe("Notes: links: 1 broken, 2 changed");
    expect(notesOf([runRecord(D, { links: links(0, 0) })])).toBeUndefined();
    expect(notesOf([runRecord(D, { links: links(0, 3) })])).toBe("Notes: links: 0 broken, 3 changed");
    const newest = [runRecord(D, { links: links(2, 0) }), runRecord(D, { trigger: "retry", links: links(0, 1) })];
    expect(notesOf(newest)).toBe("Notes: links: 0 broken, 1 changed");
    const olderOnly = [runRecord(D, { links: links(2, 0) }), runRecord(D, { trigger: "retry", links: null })];
    expect(notesOf(olderOnly)).toBe("Notes: links: 2 broken, 0 changed");
  });

  it("notes a site that does not show the edition yet, for a published and a data-only edition, but not in a dry run", () => {
    const wrongDate = runRecord(D, { deploy: { triggered: true, ready_at: null, shows_date: null, shows_edition: null } });
    expect(notesOf([wrongDate])).toBe("Notes: site not yet showing this edition");
    const otherEdition = runRecord(D, { deploy: { triggered: true, ready_at: null, shows_date: D, shows_edition: "data_only" } });
    expect(notesOf([otherEdition])).toBe("Notes: site not yet showing this edition");
    const earlierDay = runRecord(D, { deploy: { triggered: true, ready_at: null, shows_date: OTHER_DATE, shows_edition: brief.edition } });
    expect(notesOf([earlierDay])).toBe("Notes: site not yet showing this edition");
    expect(notesOf([base()])).toBeUndefined();
    const dry = runRecord(D, { trigger: "dry_run", outcome: "dry_run", edition: "full", deploy: { triggered: false, ready_at: null, shows_date: null, shows_edition: null } });
    expect(notesOf([dry])).toBeUndefined();
    const dataOnly = picks().dataOnly;
    const dc = lines(chatFor(content, dataOnly.date, {
      runs: [runRecord(dataOnly.date, { outcome: "published_data_only", edition: "data_only", deploy: { triggered: true, ready_at: null, shows_date: null, shows_edition: null } })],
    }));
    expect(dc.find((l) => l.startsWith("Notes: "))).toBe("Notes: site not yet showing this edition");
  });

  it("notes usage from 80% in the newest record that has it, in the window's word", () => {
    const usage = (window: string, utilization: number) => runRecord(D, { budgets: budgets(D, { usage: { window, utilization } }) });
    expect(notesOf([usage("seven_day", 0.83)])).toBe("Notes: usage 83% of weekly limit");
    expect(notesOf([usage("seven_day_opus", 0.9)])).toBe("Notes: usage 90% of weekly limit");
    expect(notesOf([usage("weekly", 1.2)])).toBe("Notes: usage 120% of weekly limit");
    expect(notesOf([usage("five_hour", 0.8)])).toBe("Notes: usage 80% of 5-hour limit");
    expect(notesOf([usage("some_other_window", 0.85)])).toBe("Notes: usage 85% of some other window limit");
    expect(notesOf([usage("Seven_Day", 0.85)])).toBe("Notes: usage 85% of weekly limit");
    expect(notesOf([usage("FIVE_HOUR", 0.85)])).toBe("Notes: usage 85% of 5-hour limit");
    expect(notesOf([usage("seven_day", 0.79)])).toBeUndefined();
    const retry = runRecord(D, { trigger: "retry", budgets: budgets(D, { usage: null }) });
    expect(notesOf([usage("five_hour", 0.95), retry])).toBe("Notes: usage 95% of 5-hour limit");
    expect(notesOf([usage("five_hour", 0.95), runRecord(D, { trigger: "retry", budgets: budgets(D, { usage: { window: "seven_day", utilization: 0.5 } }) })])).toBeUndefined();
  });

  it("reads --force's replaced note and the dependency note back from the stage notes", () => {
    const replaced = runRecord(D, { stages: stages({ publish: { status: "ok", note: STAGE_NOTES.replaced("03:56") } }) });
    expect(notesOf([replaced])).toBe("Notes: replaced the 03:56 edition (--force)");
    const deps = runRecord(D, { stages: stages({ preflight: { status: "ok", note: STAGE_NOTES.depsChanged } }) });
    expect(notesOf([deps])).toBe("Notes: Dependencies changed since the last npm ci");
    const both = runRecord(D, { stages: stages({ preflight: { status: "ok", note: STAGE_NOTES.depsChanged }, publish: { status: "ok", note: STAGE_NOTES.replaced("04:10") } }) });
    expect(notesOf([both])).toBe("Notes: replaced the 04:10 edition (--force) · Dependencies changed since the last npm ci");
  });

  it("adds the caller's notes and the unremoved seed files, a plain file name only", () => {
    expect(notesOf([base()], { notes: [CHAT_NOTES.statusNotSaved] })).toBe("Notes: status not saved");
    expect(notesOf([base()], { unremovedSeeds: ["2026-10-01-03.json", "x_y.z-1.json"] }))
      .toBe("Notes: seed/ledger/2026-10-01-03.json still holds removed text · seed/ledger/x_y.z-1.json still holds removed text");
    const shown = (name: string) => `seed/ledger/${name} still holds removed text`;
    expect(notesOf([base()], { unremovedSeeds: ["../etc/passwd", "a b.json", "", "a".repeat(81), "a".repeat(80)] }))
      .toBe(`Notes: ${shown("(name not shown)")} · ${shown("a".repeat(80))}`);
  });

  it("names a hidden term by its first finding and each code, and an upheld report with no correction", () => {
    const c = copyOfSample();
    c.hiddenTerms = [{ first_finding: "bio-2026-0143", codes: ["DUAL_USE", "BLOCKED_HOST"] }, { first_finding: "chem-2026-0150", codes: ["DUAL_USE"] }];
    expect(notesOf([base()], {}, c)).toBe(`Notes: ${[
      "term first used in bio-2026-0143 hidden: DUAL_USE in its name; a PR removes it",
      "term first used in bio-2026-0143 hidden: BLOCKED_HOST in its name; a PR removes it",
      "term first used in chem-2026-0150 hidden: DUAL_USE in its name; a PR removes it",
    ].join(" · ")}`);
    const d = copyOfSample();
    const open = (id: string, over: object) => ({
      id, received: `${D}T01:00:00+08:00`, issue_number: 9, finding_id: d.findings[0]!.id, kind: "fact" as const, evidence_url: null, status: "upheld" as const,
      decided_by: "jl" as const, resolved_on: D, reason: null, correction_id: null, ...over,
    });
    d.reports = [
      open("R-0091", {}), open("R-0092", { decided_by: "claude", reason: { en: "Reason.", zh: null } }), open("R-0093", { correction_id: "C-0001" }),
      open("R-0094", { status: "rejected" }), open("R-0095", { status: "open", decided_by: null, resolved_on: null }), open("R-0096", {}),
    ];
    expect(notesOf([base()], {}, d)).toBe("Notes: report R-0091 (upheld by JL) has no correction yet · report R-0096 (upheld by JL) has no correction yet");
  });

  it("puts every note in §8.8's order, whichever way round they arrive", () => {
    const c = copyOfSample();
    c.hiddenTerms = [{ first_finding: "bio-2026-0143", codes: ["DUAL_USE"] }];
    c.reports = [{
      id: "R-0091", received: `${D}T01:00:00+08:00`, issue_number: 9, finding_id: c.findings[0]!.id, kind: "fact", evidence_url: null, status: "upheld",
      decided_by: "jl", resolved_on: D, reason: null, correction_id: null,
    }];
    c.briefs = c.briefs.map((b) => (b.date === D ? { ...b, pace: { ...b.pace, status: "stale" as const } } : b));
    const run = runRecord(D, {
      error_code: "E_ZH", soft_gates: { checked: 3, dropped: 2, by_code: {} }, feeds: [feed("alpha", "stale")], zh: { attempted: true, repair_rounds: 0, strings: 3, backlog: 0, outcome: "failed" },
      links: { checked_at: at(D, "04:01"), checked: 2, ok: 1, unknown: 0, broken: [{ url: `${SITE}/x`, ref: `${D}/brief`, result: "broken", http: 404 }] },
      deploy: { triggered: true, ready_at: null, shows_date: null, shows_edition: null }, budgets: budgets(D, { usage: { window: "seven_day", utilization: 0.9 } }),
      stages: stages({ preflight: { status: "ok", note: STAGE_NOTES.depsChanged }, publish: { status: "ok", note: STAGE_NOTES.replaced("03:50") } }),
    });
    const expected = [
      "2 findings dropped (unverified)", "feeds stale: alpha", `Pace stale: data to ${dm(brief.provenance.data_cutoff)}`, "Chinese edition not ready (E_ZH)",
      "links: 1 broken, 0 changed", "site not yet showing this edition", "usage 90% of weekly limit", "status not saved", "replaced the 03:50 edition (--force)",
      "Dependencies changed since the last npm ci", "seed/ledger/one.json still holds removed text", "term first used in bio-2026-0143 hidden: DUAL_USE in its name; a PR removes it",
      "report R-0091 (upheld by JL) has no correction yet",
    ];
    expect(notesOf([run], { notes: [CHAT_NOTES.statusNotSaved], unremovedSeeds: ["one.json"] }, c)).toBe(`Notes: ${expected.join(" · ")}`);
  });

  it("orderNotes() puts known notes in order, keeps unknown ones last in their own order, drops blanks and duplicates, and keeps one line each", () => {
    expect(orderNotes([
      "zzz later note", "Dependencies changed since the last npm ci", "  ", "feeds stale: a", "aaa another", "feeds stale: a", "status not saved", "1 finding dropped (unverified)",
    ])).toEqual(["1 finding dropped (unverified)", "feeds stale: a", "status not saved", "Dependencies changed since the last npm ci", "zzz later note", "aaa another"]);
    expect(orderNotes(["feeds stale: a\n  b", "usage 85% of weekly limit", "links: 0 broken, 1 changed"])).toEqual(["feeds stale: a b", "links: 0 broken, 1 changed", "usage 85% of weekly limit"]);
    expect(orderNotes([])).toEqual([]);
    expect(orderNotes(["site not yet showing this edition", "Pace stale: data to 4 Oct", "Chinese edition not ready (E_ZH)"]))
      .toEqual(["Pace stale: data to 4 Oct", "Chinese edition not ready (E_ZH)", "site not yet showing this edition"]);
    expect(orderNotes(["zzz unknown", "report R-0001 (upheld by JL) has no correction yet", "term first used in x hidden: DUAL_USE in its name; a PR removes it", "seed/ledger/a.json still holds removed text", "replaced the 03:50 edition (--force)"]))
      .toEqual(["replaced the 03:50 edition (--force)", "seed/ledger/a.json still holds removed text", "term first used in x hidden: DUAL_USE in its name; a PR removes it", "report R-0001 (upheld by JL) has no correction yet", "zzz unknown"]);
    // Notes of one kind keep the order they came in.
    expect(orderNotes(["seed/ledger/b.json still holds removed text", "seed/ledger/a.json still holds removed text"]))
      .toEqual(["seed/ledger/b.json still holds removed text", "seed/ledger/a.json still holds removed text"]);
  });

  it("collapses a note's whitespace so no note adds a line", () => {
    const out = notesOf([base()], { notes: ["a note\nwith  breaks"] });
    expect(out).toBe("Notes: a note with breaks");
  });
});

// ── The run line ─────────────────────────────────────────────────────────────────────────────────

describe("the run line", () => {
  const content = sample();
  const brief = picks().busiest;
  const D = brief.date;
  const last = (runs: RunRecord[], edit: (b: Brief) => void = () => {}) => lines(chatFor(variant(D, edit), D, { runs })).at(-1)!;
  const pace = `Pace data to ${dm(brief.provenance.data_cutoff)}`;
  const sources = plural(brief.computed.source_count, "source");

  it("counts attempts and repairs, with plurals, and leaves the repairs out at none", () => {
    const attempt = (repairs: number, status: "ok" | "skipped" = "ok") => runRecord(D, { stages: stages({ draft: { status } }), budgets: budgets(D, { repair_rounds: repairs }) });
    const span = `Run 03:15${EN}04:01 · data-only 03:19 · `;
    expect(last([attempt(0)])).toBe(`${span}1 attempt · Chinese done · ${sources} · ${pace}`);
    expect(last([attempt(1)])).toBe(`${span}1 attempt, 1 repair · Chinese done · ${sources} · ${pace}`);
    expect(last([attempt(2), attempt(0)])).toBe(`${span}2 attempts, 2 repairs · Chinese done · ${sources} · ${pace}`);
    expect(last([attempt(0, "skipped")])).toBe(`${span}0 attempts · Chinese done · ${sources} · ${pace}`);
  });

  it("says Chinese done, failed or not run from the last record that has a Chinese record", () => {
    const zh = (outcome: "ok" | "failed" | "skipped_late" | "skipped_flag" | "not_run" | null, trigger: RunRecord["trigger"] = "schedule") =>
      runRecord(D, { trigger, zh: outcome === null ? null : { attempted: outcome === "ok" || outcome === "failed", repair_rounds: 0, strings: 3, backlog: 0, outcome } });
    const word = (runs: RunRecord[]) => /Chinese (\w+(?: \w+)?) ·/.exec(last(runs))![1];
    expect(word([zh("ok")])).toBe("done");
    expect(word([zh("failed")])).toBe("failed");
    for (const outcome of ["skipped_late", "skipped_flag", "not_run", null] as const) expect(word([zh(outcome)])).toBe("not run");
    expect(word([zh("ok"), zh(null, "retry")])).toBe("done");
    expect(word([zh("failed"), zh("ok", "retry")])).toBe("done");
    expect(word([zh("ok"), zh("failed", "retry")])).toBe("failed");
    expect(word([zh(null), zh("failed", "retry")])).toBe("failed");
  });

  it("gives the first data-only time of the run, and leaves it out when there was none", () => {
    const at1 = (hhmm: string | null, trigger: RunRecord["trigger"] = "schedule") => runRecord(D, { trigger, data_only_published_at: hhmm === null ? null : at(D, hhmm) });
    expect(last([at1("03:19"), at1("03:30", "retry")])).toContain(" · data-only 03:19 · ");
    expect(last([at1(null), at1("03:30", "retry")])).toContain(" · data-only 03:30 · ");
    expect(last([at1(null)])).not.toContain("data-only");
  });

  it("ends the span at the last record's finish, or at its latest stage end while it is unfinished", () => {
    const retry = runRecord(D, { trigger: "retry", started_at: at(D, "04:05"), finished_at: at(D, "04:20") });
    expect(last([runRecord(D), retry])).toContain(`Run 03:15${EN}04:20 · `);
    const open = runRecord(D, { finished_at: null, stages: stages({ draft: { status: "ok", ended_at: at(D, "03:40") }, validate: { status: "ok", ended_at: at(D, "03:44") } }) });
    expect(last([open])).toContain(`Run 03:15${EN}03:44 · `);
  });

  it("counts the sources of the brief in the singular and plural, and names the Pace data's date", () => {
    expect(last([runRecord(D)], (b) => { b.computed.source_count = 1; })).toContain(" · 1 source · ");
    expect(last([runRecord(D)], (b) => { b.computed.source_count = 0; })).toContain(" · 0 sources · ");
    expect(last([runRecord(D)], (b) => { b.provenance.data_cutoff = "2026-01-04"; })).toMatch(/ · Pace data to 4 Jan$/);
  });

  it("leaves the run line and the notes out of a hand-built input that has no records, without failing", () => {
    const input = { kind: "published" as const, brief, content, runs: [], notes: [], dryRun: false };
    const ls = lines(renderChat(input, SITE));
    expect(ls.at(-1)).toBe(`Full brief: ${SITE}/brief/${D} · 中文: ${SITE}/zh/brief/${D}`);
    const dataOnly = picks().dataOnly;
    const d = lines(renderChat({ kind: "data_only", brief: dataOnly, content, runs: [], code: null, what: "Said.", nextStep: null, notes: [], dryRun: false }, SITE));
    expect(d.at(-1)).toBe(`Brief: ${SITE}/brief/${dataOnly.date}`);
    expect(d).toContain("What happened: Said.");
    const f = lines(renderChat({ kind: "failed", date: D, code: "E_AGENT", what: "Said.", errors: [], siteShows: null, nextStep: "Step.", runs: [], needsReview: false, notes: [], dryRun: false }, SITE));
    expect(f.at(-1)).toBe("Next step: Step.");
  });
});

// ── The clock helpers ────────────────────────────────────────────────────────────────────────────

describe("minutesOf and clockOf", () => {
  it("convert HH:MM to minutes and back, wrapping into one day", () => {
    expect([minutesOf("00:00"), minutesOf("00:59"), minutesOf("01:00"), minutesOf("09:45"), minutesOf("11:00"), minutesOf("23:59")]).toEqual([0, 59, 60, 585, 660, 1439]);
    for (const bad of ["9:45", "", "abc", "09:45:00", "0945", " 09:45", "09:45 "]) expect(() => minutesOf(bad), bad).toThrow(`Invalid time: ${bad}`);
    const cases: [number, string][] = [[0, "00:00"], [59, "00:59"], [60, "01:00"], [585, "09:45"], [1439, "23:59"], [1440, "00:00"], [1441, "00:01"], [-15, "23:45"], [-1440, "00:00"], [2000, "09:20"], [119, "01:59"]];
    for (const [minutes, text] of cases) expect(clockOf(minutes), String(minutes)).toBe(text);
    expect(clockOf(minutesOf("12:34"))).toBe("12:34");
  });
});

// ── The fixed tables (§8.2) ──────────────────────────────────────────────────────────────────────

describe("NEXT_STEP, WHAT_HAPPENED and the dry-run texts", () => {
  const facts: WhatFacts = { date: "2026-10-21", errors: 2, repairs: 1, attempts: 3, agentMinutes: 25, hardStop: "04:25", publishUntil: "11:00" };
  const withRerun: ErrorCode[] = ["E_ARCH", "E_NODE", "E_CONFIG", "E_NET", "E_GIT", "E_CLI", "E_AUTH", "E_PUSH", "E_DATA_ONLY", "E_AGENT", "E_TIMEOUT", "E_VALIDATION", "E_INTERNAL"];
  const rerun = `rerun from ${RERUN_FROM} to ${RERUN_BEFORE}: zsh ${CHECKOUT}/scripts/daily.sh --no-deadline`;

  it("has one entry for each of §8.2's codes, in its order, in each table", () => {
    expect([...ERROR_CODES]).toEqual([
      "E_ARCH", "E_NODE", "E_CONFIG", "E_NET", "E_GIT", "E_CLOCK", "E_CLI", "E_AUTH", "E_PUSH", "E_METRICS", "E_DATA_ONLY", "E_ZH", "E_SANDBOX", "E_LIMIT", "E_AGENT",
      "E_TIMEOUT", "E_VALIDATION", "E_PUBLISH", "E_TOO_LATE", "E_SIMULATED", "E_INTERNAL",
    ]);
    for (const table of [NEXT_STEP, DRY_RUN_NEXT_STEP, WHAT_HAPPENED]) expect(Object.keys(table)).toEqual([...ERROR_CODES]);
  });

  it("gives the rerun window as 05:30 to 09:45", () => {
    expect([RERUN_FROM, RERUN_BEFORE]).toEqual(["05:30", "09:45"]);
    expect(CHECKOUT).toBe("/Users/kobol/Projects/UnveilingTracker");
  });

  it("every next step is one plain line with no em dash, no placeholder left once the date is filled", () => {
    for (const code of ERROR_CODES) {
      for (const text of [nextStepFor(code, facts.date), dryRunNextStepFor(code, facts.date), whatHappened(code, facts)]) {
        expect(text, code).not.toContain("{date}");
        expect(text, code).not.toContain(EM);
        expect(text, code).not.toContain("\n");
        expect(text, code).not.toContain("undefined");
        expect(text.length, code).toBeGreaterThan(10);
      }
    }
  });

  it("names the rerun command in exactly the steps that rerun", () => {
    for (const code of ERROR_CODES) {
      expect(NEXT_STEP[code].includes(rerun), code).toBe(withRerun.includes(code));
    }
    expect(NEXT_STEP.E_AGENT).toBe(rerun);
    expect(NEXT_STEP.E_TIMEOUT).toBe(rerun);
    expect(NEXT_STEP.E_VALIDATION).toBe(`${rerun}; the draft is in needs-review/{date}/`);
    expect(NEXT_STEP.E_DATA_ONLY).toBe(`read logs/{date}.daily.log, then ${rerun}`);
    expect(NEXT_STEP.E_INTERNAL).toBe(`read logs/{date}.daily.log, then ${rerun}`);
  });

  it("fills {date} everywhere and gives an unknown code E_INTERNAL's lines", () => {
    expect(nextStepFor("E_VALIDATION", "2026-10-21")).toContain("needs-review/2026-10-21/");
    expect(nextStepFor("E_DATA_ONLY", "2026-10-21")).toContain("logs/2026-10-21.daily.log");
    expect(nextStepFor("E_PUBLISH", "2026-10-21")).toBe(
      `the draft is valid: in ${CHECKOUT} run PATH=/opt/homebrew/bin:$PATH npm run publish -- --date 2026-10-21 before 11:00`);
    expect(nextStepFor("E_NOT_A_CODE", "2026-10-21")).toBe(nextStepFor("E_INTERNAL", "2026-10-21"));
    expect(dryRunNextStepFor("E_NOT_A_CODE", "2026-10-21")).toBe(dryRunNextStepFor("E_INTERNAL", "2026-10-21"));
    expect(whatHappened("E_NOT_A_CODE", facts)).toBe(WHAT_HAPPENED.E_INTERNAL(facts));
    expect(nextStepFor("constructor", "2026-10-21")).toBe(nextStepFor("E_INTERNAL", "2026-10-21"));
    expect(nextStepFor("E_METRICS", "2026-10-21")).toBe(`run npm run backfill -- --pace --refresh --push in ${CHECKOUT}, started before 02:00 or from 04:30 (SPEC §5.4)`);
    expect(nextStepFor("E_CLOCK", "2026-10-21")).toBe("run this date after 03:15 Taipei on that day");
    expect(nextStepFor("E_TOO_LATE", "2026-10-21")).toBe("nothing: nothing is published after 11:00; the next morning's run will publish");
    expect(nextStepFor("E_SIMULATED", "2026-10-21")).toBe("nothing: this was a test of the failure path");
  });

  it("each dry-run step ends with the dry run's own files, except E_SIMULATED, which is the same as the real one", () => {
    const files = DRY_RUN_FILES.replaceAll("{date}", facts.date);
    for (const code of ERROR_CODES) {
      const text = dryRunNextStepFor(code, facts.date);
      if (code === "E_SIMULATED") {
        expect(text).toBe(nextStepFor(code, facts.date));
        continue;
      }
      expect(text.endsWith(files), code).toBe(true);
      expect(text, code).not.toMatch(/needs-review|npm run publish|--no-deadline/);
    }
    expect(dryRunNextStepFor("E_AGENT", facts.date)).toBe(files);
    expect(dryRunNextStepFor("E_NET", facts.date)).toBe(`Kobol had no network; ${files}`);
    expect(dryRunNextStepFor("E_CONFIG", facts.date)).toBe(`config/ fails its checks; fix it in a PR before the next run; ${files}`);
    expect(DRY_RUN_FILES).toBe("this was a dry run, so nothing needs rerunning: what it wrote is in logs/{date}.daily.log, drafts/{date}.json, logs/{date}.validation.json and logs/dry-run/{date}/");
    expect(DRY_RUN_NEXT_STEP.E_SANDBOX).toBe(`${NEXT_STEP.E_SANDBOX}; ${DRY_RUN_FILES}`);
    expect(DRY_RUN_NEXT_STEP.E_PUBLISH).toContain("logs/{date}.daily.log says why its edition was not written");
  });

  it("pins every next step, dry-run step and What happened sentence word for word", () => {
    const arch = `the run isn't native arm64 Node 22 or newer; check scripts/daily.sh's PATH and /opt/homebrew/bin/node (SPEC Appendix C)`;
    const next: Record<ErrorCode, string> = {
      E_ARCH: `${arch}, then ${rerun}`, E_NODE: `${arch}, then ${rerun}`, E_CONFIG: `config/ on main fails its checks; fix it in a PR, then ${rerun}`,
      E_NET: `Kobol had no network; ${rerun}`, E_GIT: `the checkout can't be synced with GitHub; see docs/RUNBOOK.md, then ${rerun}`,
      E_CLOCK: "run this date after 03:15 Taipei on that day", E_CLI: `the agent CLI is missing; reinstall it (SPEC §9.4), then ${rerun}`,
      E_AUTH: `the agent's sign-in token is missing or expired; JL renews it (SPEC §9.6), then ${rerun}`,
      E_PUSH: `the run can't push to GitHub; check gh's login on Kobol (SPEC §9.6), then ${rerun}`,
      E_METRICS: `run npm run backfill -- --pace --refresh --push in ${CHECKOUT}, started before 02:00 or from 04:30 (SPEC §5.4)`,
      E_DATA_ONLY: `read logs/{date}.daily.log, then ${rerun}`, E_ZH: "nothing: the English edition is published and later runs translate its findings",
      E_SANDBOX: "the agent's sandbox is wrong; run npm run agent:check -- --sandbox and fix SPEC §9.5's settings before the next run",
      E_LIMIT: "the account's usage limit stopped the agent; the data-only edition stands; runs resume when the limit window resets",
      E_AGENT: rerun, E_TIMEOUT: rerun, E_VALIDATION: `${rerun}; the draft is in needs-review/{date}/`,
      E_PUBLISH: `the draft is valid: in ${CHECKOUT} run PATH=/opt/homebrew/bin:$PATH npm run publish -- --date {date} before 11:00`,
      E_TOO_LATE: "nothing: nothing is published after 11:00; the next morning's run will publish", E_SIMULATED: "nothing: this was a test of the failure path",
      E_INTERNAL: `read logs/{date}.daily.log, then ${rerun}`,
    };
    const dryFix: Record<ErrorCode, string | undefined> = {
      E_ARCH: `${arch} before the next run`, E_NODE: `${arch} before the next run`, E_CONFIG: "config/ fails its checks; fix it in a PR before the next run",
      E_NET: "Kobol had no network", E_GIT: "the checkout can't be synced with GitHub; see docs/RUNBOOK.md before the next run",
      E_CLOCK: "the news window for this date closes at 03:15 Taipei on that day", E_CLI: "the agent CLI is missing; reinstall it (SPEC §9.4) before the next run",
      E_AUTH: "the agent's sign-in token is missing or expired; JL renews it (SPEC §9.6) before the next run",
      E_PUSH: "the run can't push to GitHub; check gh's login on Kobol (SPEC §9.6) before the next run",
      E_METRICS: "read logs/{date}.metrics.log; fix in a PR before the next run", E_DATA_ONLY: undefined, E_ZH: undefined, E_SANDBOX: NEXT_STEP.E_SANDBOX,
      E_LIMIT: "the account's usage limit stopped the agent; runs resume when the limit window resets", E_AGENT: undefined, E_TIMEOUT: undefined, E_VALIDATION: undefined,
      E_PUBLISH: "the draft was valid, and logs/{date}.daily.log says why its edition was not written", E_TOO_LATE: undefined, E_SIMULATED: undefined, E_INTERNAL: undefined,
    };
    const what: Record<ErrorCode, string> = {
      E_ARCH: "The run was not on native arm64 Node, so it stopped in preflight.", E_NODE: "The run's Node was older than 22, so it stopped in preflight.",
      E_CONFIG: "The files in config/ failed their checks, so the run stopped in preflight.",
      E_NET: "GitHub did not answer within 10 seconds, so the run stopped in preflight.",
      E_GIT: "The checkout could not be synced with GitHub, so the run stopped in preflight.",
      E_CLOCK: "The news window for 2026-10-21 has not closed yet, so nothing was computed.",
      E_CLI: "The agent CLI was missing or did not start, so no editorial pass ran.",
      E_AUTH: "The agent's sign-in token was missing or expired, so no editorial pass ran.",
      E_PUSH: "The start record could not be pushed to GitHub, so nothing else was tried.",
      E_METRICS: "The Pace's saved state does not match the config's version, so this edition has no Pace.",
      E_DATA_ONLY: "The data-only edition could not be composed, validated or pushed, and no full edition followed.",
      E_ZH: "The Chinese pass did not produce a valid edition; the English edition is published. Later runs translate its findings.",
      E_SANDBOX: "The agent started with tools beyond its sandbox and was stopped.",
      E_LIMIT: "The account's usage limit stopped the agent before it wrote a valid draft.", E_AGENT: "The agent wrote no draft in 3 attempts.",
      E_TIMEOUT: "The agent timed out after 25 minutes without writing a draft.",
      E_VALIDATION: "The draft still had 2 validation errors after 1 repair and 3 attempts.",
      E_PUBLISH: "The draft was valid, but the full edition failed whole-tree validation or its push.",
      E_TOO_LATE: "The full edition was not published: nothing is published after 11:00.",
      E_SIMULATED: "A simulated failure (--simulate-failure) stopped the run after a valid draft.",
      E_INTERNAL: "The run hit an unexpected error; the stack is in the run log.",
    };
    const files = DRY_RUN_FILES.replaceAll("{date}", facts.date);
    for (const code of ERROR_CODES) {
      expect(NEXT_STEP[code], `${code} next`).toBe(next[code]);
      const fix = dryFix[code];
      expect(dryRunNextStepFor(code, facts.date), `${code} dry`).toBe(code === "E_SIMULATED" ? NEXT_STEP.E_SIMULATED : (fix ? `${fix}; ` : "").replaceAll("{date}", facts.date) + files);
      expect(whatHappened(code, facts), `${code} what`).toBe(what[code]);
    }
    expect(NOT_VALID.nextStep).toBe(
      `read the Validation lines in logs/{date}.daily.log: if they name only briefs/{date}.json, fix drafts/{date}.json, then in ${CHECKOUT} run PATH=/opt/homebrew/bin:$PATH npm run publish -- --date {date} before 11:00; if they name another file under content/, today's full edition cannot publish and the fix goes through a PR`);
    expect(NOT_VALID.dryRunStep).toBe(`read the Validation lines in logs/{date}.daily.log: if they name another file than briefs/{date}.json, the fix goes through a PR before the next run; ${DRY_RUN_FILES}`);
  });

  it("fills What happened's templates from the facts", () => {
    expect(WHAT_HAPPENED.E_VALIDATION(facts)).toBe("The draft still had 2 validation errors after 1 repair and 3 attempts.");
    expect(WHAT_HAPPENED.E_VALIDATION({ ...facts, errors: 1, repairs: 2, attempts: 1 })).toBe("The draft still had 1 validation error after 2 repairs and 1 attempt.");
    expect(WHAT_HAPPENED.E_AGENT(facts)).toBe("The agent wrote no draft in 3 attempts.");
    expect(WHAT_HAPPENED.E_AGENT({ ...facts, attempts: 1 })).toBe("The agent wrote no draft in 1 attempt.");
    expect(WHAT_HAPPENED.E_TIMEOUT(facts)).toBe("The agent timed out after 25 minutes without writing a draft.");
    expect(WHAT_HAPPENED.E_TIMEOUT({ ...facts, agentMinutes: 1 })).toBe("The agent timed out after 1 minute without writing a draft.");
    expect(WHAT_HAPPENED.E_TIMEOUT({ ...facts, agentMinutes: null })).toBe("The run had too little time left for an editorial pass before 04:25.");
    expect(WHAT_HAPPENED.E_TIMEOUT({ ...facts, agentMinutes: 0 })).toBe("The run had too little time left for an editorial pass before 04:25.");
    expect(WHAT_HAPPENED.E_TOO_LATE(facts)).toBe("The full edition was not published: nothing is published after 11:00.");
    expect(WHAT_HAPPENED.E_CLOCK(facts)).toBe("The news window for 2026-10-21 has not closed yet, so nothing was computed.");
    expect(WHAT_HAPPENED.E_ZH(facts)).toBe("The Chinese pass did not produce a valid edition; the English edition is published. Later runs translate its findings.");
    expect(NEXT_STEP.E_ZH).toBe("nothing: the English edition is published and later runs translate its findings");
    expect(WHAT_HAPPENED.E_NET(facts)).toBe("GitHub did not answer within 10 seconds, so the run stopped in preflight.");
    expect(WHAT_HAPPENED.E_SIMULATED(facts)).toBe("A simulated failure (--simulate-failure) stopped the run after a valid draft.");
  });

  it("withForce() adds --force to the hand command and the rerun for a stored full or partial edition only", () => {
    const step = nextStepFor("E_PUBLISH", "2026-10-21");
    expect(withForce(step, "2026-10-21", null)).toBe(step);
    expect(withForce(step, "2026-10-21", { edition: "data_only" })).toBe(step);
    expect(withForce(step, "2026-10-21", { edition: "full" })).toBe(step.replace("--date 2026-10-21", "--date 2026-10-21 --force"));
    expect(withForce(step, "2026-10-21", { edition: "partial" })).toContain("--date 2026-10-21 --force before 11:00");
    const both = `${NOT_VALID.nextStep.replaceAll("{date}", "2026-10-21")}; ${rerun}`;
    const forced = withForce(both, "2026-10-21", { edition: "full" });
    expect(forced).toContain("--date 2026-10-21 --force before");
    expect(forced).toContain("daily.sh --no-deadline --force");
    // Only the given date's command is changed.
    expect(withForce(step, "2026-10-22", { edition: "full" })).toBe(step);
  });

  it("holds the fixed lines of NOT_VALID and BRIEF_LEFT_OUT", () => {
    expect(NOT_VALID.what).toBe("The draft was valid, but the full edition made from it failed whole-tree validation, so it was not pushed.");
    expect(NOT_VALID.nextStep).toContain("read the Validation lines in logs/{date}.daily.log");
    expect(NOT_VALID.nextStep).toContain("--date {date} before 11:00");
    expect(NOT_VALID.dryRunStep.endsWith(DRY_RUN_FILES)).toBe(true);
    expect(BRIEF_LEFT_OUT.what).toBe("The edition was published, but the site's checks leave its brief out, so the site does not show it.");
    expect(BRIEF_LEFT_OUT.nextStep).toBe(`in ${CHECKOUT} run PATH=/opt/homebrew/bin:$PATH npm run validate:all and read its first errors; the fix goes through a PR`);
  });

  it("STAGE_NOTES and CHAT_NOTES write the texts the status file keeps and the Notes line shows", () => {
    expect(STAGE_NOTES.dataOnlyRequested).toBe("Data-only run requested (--data-only).");
    expect(STAGE_NOTES.startedAfterHardStop("04:25")).toBe("Started after 04:25: no editorial pass today.");
    expect(STAGE_NOTES.alreadyPublished("03:56")).toBe("The full edition was already published at 03:56.");
    expect(STAGE_NOTES.tooLate("11:00")).toBe("Too late: nothing is published after 11:00.");
    expect(STAGE_NOTES.tooEarly("03:15")).toBe("Too early: the news window ends at 03:15; start the run then.");
    expect(STAGE_NOTES.cyberRun("04:30", "05:30")).toBe("Cyber's morning run is from 04:30 to 05:30: start the rerun from 05:30.");
    expect(STAGE_NOTES.replaced("03:56")).toBe("Replaced the 03:56 edition (--force).");
    expect(STAGE_NOTES.depsChanged).toBe("Dependencies changed since the last npm ci.");
    expect(STAGE_NOTES.notValid).toBe("Not valid: the full edition failed whole-tree validation (see the Validation lines in the daily log).");
    expect(CHAT_NOTES.feedsStale(["a", "b"])).toBe("feeds stale: a, b");
    expect(CHAT_NOTES.paceStale("2026-10-04")).toBe("Pace stale: data to 4 Oct");
    expect(CHAT_NOTES.chineseNotReady).toBe("Chinese edition not ready (E_ZH)");
    expect(CHAT_NOTES.links(1, 2)).toBe("links: 1 broken, 2 changed");
    expect(CHAT_NOTES.siteNotShowing).toBe("site not yet showing this edition");
    expect(CHAT_NOTES.usage(83, "weekly")).toBe("usage 83% of weekly limit");
    expect(CHAT_NOTES.statusNotSaved).toBe("status not saved");
    expect(CHAT_NOTES.replaced("03:56")).toBe("replaced the 03:56 edition (--force)");
    expect(CHAT_NOTES.depsChanged).toBe("Dependencies changed since the last npm ci");
    expect(CHAT_NOTES.seedRemoved("a.json")).toBe("seed/ledger/a.json still holds removed text");
    expect(CHAT_NOTES.termHidden("bio-2026-0143", "DUAL_USE")).toBe("term first used in bio-2026-0143 hidden: DUAL_USE in its name; a PR removes it");
    expect(CHAT_NOTES.reportUpheld("R-0007")).toBe("report R-0007 (upheld by JL) has no correction yet");
  });
});

// ── Run records ──────────────────────────────────────────────────────────────────────────────────

describe("lastRunRecords, runCounts and runSpan", () => {
  const D = OTHER_DATE;
  const rec = (trigger: RunRecord["trigger"], n: number, over: Partial<RunRecord> = {}) => runRecord(D, { trigger, attempt: n, run_id: `20261021-03${String(10 + n)}00`, ...over });

  it("lastRunRecords picks the last schedule, manual or dry_run record and the retries after it", () => {
    const [a, b, c, d, e] = [rec("schedule", 1), rec("retry", 2), rec("manual", 3), rec("retry", 4), rec("retry", 5)];
    expect(lastRunRecords([a, b, c, d, e])).toEqual([c, d, e]);
    expect(lastRunRecords([a, b])).toEqual([a, b]);
    expect(lastRunRecords([a, b, rec("dry_run", 3)]).map((r) => r.trigger)).toEqual(["dry_run"]);
    expect(lastRunRecords([b, d])).toEqual([b, d]);
    expect(lastRunRecords([])).toEqual([]);
    expect(lastRunRecords([a, c])).toEqual([c]);
    const input = [a, b];
    lastRunRecords(input).push(c);
    expect(input).toHaveLength(2);
  });

  it("runCounts counts records whose draft stage ran, and sums the repair rounds", () => {
    const ran = (repairs: number, status: "ok" | "degraded" | "failed" | "skipped") =>
      runRecord(D, { stages: stages({ draft: { status } }), budgets: budgets(D, { repair_rounds: repairs }) });
    expect(runCounts([ran(1, "ok"), ran(0, "skipped")])).toEqual({ attempts: 1, repairs: 1 });
    expect(runCounts([ran(2, "failed"), ran(3, "degraded"), ran(0, "ok")])).toEqual({ attempts: 3, repairs: 5 });
    expect(runCounts([ran(0, "skipped")])).toEqual({ attempts: 0, repairs: 0 });
    expect(runCounts([])).toEqual({ attempts: 0, repairs: 0 });
  });

  it("runSpan runs from the first record's start to the last one's end", () => {
    expect(runSpan([])).toBeNull();
    const a = rec("schedule", 1, { started_at: at(D, "03:15"), finished_at: at(D, "03:40") });
    const b = rec("retry", 2, { started_at: at(D, "04:00"), finished_at: at(D, "04:20") });
    expect(runSpan([a, b])).toEqual({ start: at(D, "03:15"), end: at(D, "04:20") });
    expect(runSpan([a])).toEqual({ start: at(D, "03:15"), end: at(D, "03:40") });
  });

  it("runSpan ends an unfinished record at its latest stage end, by time and not by text, else at its start", () => {
    const stamps = { early: `${D}T03:50:00+08:00`, late: "2026-10-20T20:10:00Z" }; // 19:50 UTC the day before, and 04:10 Taipei: the second is later
    const open = rec("schedule", 1, {
      started_at: at(D, "03:15"), finished_at: null,
      stages: stages({ draft: { ended_at: stamps.early, status: "ok" }, validate: { ended_at: stamps.late, status: "ok" }, preflight: { ended_at: null } }),
    });
    expect(runSpan([open])).toEqual({ start: at(D, "03:15"), end: stamps.late });
    expect(runSpan([rec("schedule", 1, { started_at: at(D, "03:15"), finished_at: null })])).toEqual({ start: at(D, "03:15"), end: at(D, "03:15") });
  });

  it("safePath keeps schema keys and indices, a '(root)'-style marker and one file prefix; anything else is not shown", () => {
    const hidden = "(path not shown)";
    for (const ok of ["items[2].explainer.found", "(root)", "(file)", "(run)", "[0].id", "[0][1].a", "briefs/2026-10-21.json: lead[0].text.en", "a", "_x.y1[3]", "findings/x-y_1.json: (file)"]) {
      expect(safePath(ok), ok).toBe(ok);
    }
    for (const bad of [
      "", "   ", "a-b.c", "a b", "1a", "a.", ".a", "a..b", "(other)", "x[a]", "a[1", "A/b.json: x", "a.json: b.json: c", "a.json:x", "a/.json: x", "a.json: (nothing)",
      `x.${CANARY_TOKEN}`, `${CANARY_TOKEN.toLowerCase()}.json: x`, "a".repeat(101), "[]",
    ]) {
      expect(safePath(bad), bad).toBe(hidden);
    }
    expect(safePath("  items[0]  ")).toBe("items[0]");
    expect(safePath("a".repeat(100))).toBe("a".repeat(100));
  });
});

// ── chatGuard ────────────────────────────────────────────────────────────────────────────────────

describe("chatGuard", () => {
  const g = (line: string) => chatGuard(line, SITE);
  const removed = "[link removed]";

  it("keeps links on the site, with a path, a fragment or a query, and the punctuation after them", () => {
    for (const keep of [`${SITE}/findings/a`, `${SITE}#a`, `${SITE}?q=1`, SITE, `${SITE}/brief/2026-10-12#review`]) expect(g(`see ${keep}`)).toBe(`see ${keep}`);
    expect(g(`(${SITE}/a), then ${SITE}/b.`)).toBe(`(${SITE}/a), then ${SITE}/b.`);
    expect(g(`a ${SITE}/1 b https://other.example/x c ${SITE}/2`)).toBe(`a ${SITE}/1 b ${removed} c ${SITE}/2`);
    expect(chatGuard(`see ${SITE}/a`, `${SITE}/`)).toBe(`see ${SITE}/a`);
  });

  it("removes every other URL, whatever its scheme, and a look-alike host", () => {
    expect(g("go to http://evil.example/x now")).toBe(`go to ${removed} now`);
    expect(g("ftp://evil.example/file and file://localhost/etc")).toBe(`${removed} and ${removed}`);
    expect(g(`${SITE}.evil.example/x`)).toBe(removed);
    expect(g(`${SITE}evil/x`)).toBe(removed);
    expect(g("see https://evil.example/x, and https://evil.example/y.")).toBe(`see ${removed}, and ${removed}.`);
    expect(g("kept hxxps://evil.example/x and hxxp://evil.example/y")).toBe("kept hxxps://evil.example/x and hxxp://evil.example/y");
    expect(g("HTTPS://EVIL.EXAMPLE/X")).toBe(removed);
    expect(g("HXXPS://EVIL.EXAMPLE/X")).toBe("HXXPS://EVIL.EXAMPLE/X");
    expect(g("wss://evil.example/x")).toBe(removed);
  });

  it("removes the destination of a Markdown link or image that is not on the site, whatever the link text says", () => {
    expect(g("[click](https://evil.example/x)")).toBe(`[click](${removed})`);
    expect(g(`[${SITE}/findings/a](https://evil.example/x)`)).toBe(`[${SITE}/findings/a](${removed})`);
    expect(g("![img](http://evil.example/i.png)")).toBe(`![img](${removed})`);
    expect(g("[x](<https://evil.example/a b>)")).toBe(`[x](${removed})`);
    expect(g("[x](/relative/path)")).toBe(`[x](${removed})`);
    expect(g("[x](javascript:alert(1))")).toBe(`[x](${removed}))`); // a destination with balanced brackets leaves its last one, which is inert
    expect(g("[x]( https://evil.example/x )")).toBe(`[x](${removed} )`);
    expect(g(`[x](${SITE}/findings/a)`)).toBe(`[x](${SITE}/findings/a)`);
    expect(g(`[x](<${SITE}/findings/a>)`)).toBe(`[x](<${SITE}/findings/a>)`);
    expect(g(`[x](<${SITE}>)`)).toBe(`[x](<${SITE}>)`);
    expect(g(`[x](<${SITE}evil>)`)).toBe(`[x](${removed})`);
  });

  it("removes autolinks, protocol-relative URLs, e-mail addresses and www hosts", () => {
    expect(g("<https://evil.example/x>")).toBe(removed);
    expect(g("<https:evil.example>")).toBe(removed);
    expect(g("<HTTPS:evil.example>")).toBe(removed);
    expect(g("<mailto:a@b.example>")).toBe(removed);
    expect(g(`<${SITE}/findings/a>`)).toBe(`<${SITE}/findings/a>`);
    expect(g("see //evil.example/x")).toBe(`see ${removed}`);
    expect(g("see //evil.example/p?a=b&c=d and more text, then //other.example/y too")).toBe(`see ${removed} and more text, then ${removed} too`);
    expect(g("(//evil.example/x)")).toBe(`(${removed})`);
    expect(g("//evil.example/x.")).toBe(`${removed}.`);
    expect(g(`${SITE}/a//b`)).toBe(`${SITE}/a//b`);
    expect(g("1//2 and a//b")).toBe("1//2 and a//b");
    expect(g("write to jl@example.org now")).toBe(`write to ${removed} now`);
    expect(g("a@b.example and c@d.example, then e@f.example")).toBe(`${removed} and ${removed}, then ${removed}`);
    expect(g("write to first.last+tag@sub.example.org")).toBe(`write to ${removed}`);
    expect(g("see www.example.org or WWW.EXAMPLE.ORG/path")).toBe(`see ${removed} or ${removed}/path`);
    expect(g("awww.example.org")).toBe("awww.example.org");
    expect(g("the www is not a host, www.")).toBe("the www is not a host, www.");
  });

  it("removes the canary in any case, and emoji, joiners and keycap marks, then tidies the spaces", () => {
    expect(g(`a ${CANARY_TOKEN} b`)).toBe("a [removed] b");
    expect(g(`a ${CANARY_TOKEN.toLowerCase()} and ${CANARY_TOKEN.toUpperCase()} b`)).toBe("a [removed] and [removed] b");
    expect(g(`x${CANARY_TOKEN}`)).toBe("x[removed]");
    const grin = String.fromCodePoint(0x1f600);
    expect(g(`a ${grin} b`)).toBe("a b");
    expect(g(`trailing ${grin}`)).toBe("trailing");
    expect(g(`flag ${String.fromCodePoint(0x1f1ef, 0x1f1f5)} here`)).toBe("flag here");
    expect(g(`family ${String.fromCodePoint(0x1f468, 0x200d, 0x1f469)} x`)).toBe("family x");
    expect(g(`key 1${String.fromCharCode(0xfe0f, 0x20e3)} x`)).toBe("key 1 x");
    expect(g("two   spaces")).toBe("two spaces");
    expect(g("a  b   c    d")).toBe("a b c d");
    expect(g("kept ●●●○ pips · and → arrows")).toBe("kept ●●●○ pips · and → arrows");
  });

  it("removes private-use characters first, so none can stand for a kept link", () => {
    const open = String.fromCharCode(0xe000);
    const close = String.fromCharCode(0xe001);
    expect(g(`${open}0${close}`)).toBe("0");
    expect(g(`${SITE}/a ${open}0${close}`)).toBe(`${SITE}/a 0`);
    expect(g(`${open}9${close} ${SITE}/a`)).toBe(`9 ${SITE}/a`);
    expect(g(`a${String.fromCharCode(0xf8ff)}b`)).toBe("ab");
  });

  it("escapes a line that would open a table, heading, quote, code block or link definition, last of all", () => {
    for (const start of ["|", "#", ">", "=", "```", "~~~", "[x]:"]) expect(g(`${start} rest`)).toBe(`\\${start} rest`);
    expect(g("[x]: https://evil.example")).toBe(`\\[x]: ${removed}`);
    expect(g(`${String.fromCodePoint(0x1f600)}# after the emoji`)).toBe("\\# after the emoji");
    for (const plain of ["- item", "1. item", "**bold**", "text # not first", "[x] checked", "a|b", "-- not a rule", "* a * b"]) expect(g(plain)).toBe(plain);
    // Spaces before a marker would still open the block in Markdown, so a line never starts with one.
    expect(g("  # indented")).toBe("\\# indented");
    expect(g(`${String.fromCodePoint(0x1f600)} | a | b |`)).toBe("\\| a | b |");
    expect(g("\t> quote")).toBe("\\> quote");
    // A rule, or the underline that turns the line above into a heading, is escaped too.
    for (const rule of ["---", "-", "***", "___", "- - -", "* * *", "_ _ _", "--"]) expect(g(rule), rule).toBe(`\\${rule}`);
    expect(g("   ")).toBe("");
    expect(g("")).toBe("");
  });
});

// ── chatGuard: HTML in model text, and a second pass ─────────────────────────────────────────────

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where in `text` a "<" opens HTML: one directly followed by a letter, "/", "!" or "?", with an even number of backslashes before it
 * (an odd number escape it) that does not start a `<site url>` autolink. Empty for a guarded line. */
function openTags(text: string): number[] {
  const autolink = new RegExp(`^<${escapeRe(SITE)}(?:[/#?][^\\s<>]*)?>`);
  const at: number[] = [];
  for (const m of text.matchAll(/(\\*)<(?=[\p{L}/!?])/gu)) {
    const start = m.index! + m[1]!.length;
    if (m[1]!.length % 2 === 0 && !autolink.test(text.slice(start))) at.push(start);
  }
  return at;
}

/** A seeded generator (mulberry32), so a failing line can be found again. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("chatGuard: HTML in model text, and a second pass", () => {
  const g = (line: string) => chatGuard(line, SITE);
  const removed = "[link removed]";
  const grin = String.fromCodePoint(0x1f600);
  const joiner = String.fromCharCode(0x200d);

  it("escapes the `<` of a tag, a closing tag, a comment, a declaration, a processing instruction and CDATA, so the text shows as written", () => {
    expect(g("<b>bold</b>")).toBe("\\<b>bold\\</b>");
    expect(g("a <script>x()</script> b")).toBe("a \\<script>x()\\</script> b");
    expect(g("<!-- hidden -->")).toBe("\\<!-- hidden -->");
    expect(g("<!DOCTYPE html>")).toBe("\\<!DOCTYPE html>");
    expect(g('<?xml version="1.0"?>')).toBe('\\<?xml version="1.0"?>');
    expect(g("<![CDATA[x]]>")).toBe("\\<![CDATA[x]]>");
    expect(g('<img src="javascript:alert(1)">')).toBe('\\<img src="javascript:alert(1)">');
    expect(g("<<b>")).toBe("<\\<b>");
    // A tag may end on the next line, and a line is guarded alone, so a "<" and a letter are enough, with or without a ">".
    expect(g("a<b")).toBe("a\\<b");
    expect(g("<b")).toBe("\\<b");
    expect(g("<é")).toBe("\\<é");
    expect(g(`<${String.fromCodePoint(0x4e2d)}`)).toBe(`\\<${String.fromCodePoint(0x4e2d)}`);
  });

  it("removes a URL inside a tag and escapes the tag", () => {
    expect(g("<img src=https://evil.example/x onerror=alert(1)>")).toBe(`\\<img src=${removed} onerror=alert(1)>`);
    expect(g('<a href="//evil.example/x">go</a>')).toBe(`\\<a href="${removed}">go\\</a>`);
    expect(g("<a href=http://evil.example/x>go</a>")).toBe(`\\<a href=${removed}>go\\</a>`);
    expect(g(`<img src=${SITE}/a.png>`)).toBe(`\\<img src=${SITE}/a.png>`);
  });

  it("leaves a `<` alone when nothing after it can open HTML", () => {
    for (const plain of ["p < 0.05", "x<=y", "1<2", "a <3", "5 < 6 and 7 > 3", "<", "a <", "<=", "<<", "< b>", "<-", "<3 you", "<_", "<.", "<9", "a<"]) {
      expect(g(plain), plain).toBe(plain);
    }
  });

  it("counts the backslashes before the `<`: an odd number already escape it, an even number do not", () => {
    expect(g("\\<b>")).toBe("\\<b>");
    expect(g("\\\\<b>")).toBe("\\\\\\<b>");
    expect(g("\\\\\\<b>")).toBe("\\\\\\<b>");
    expect(g("\\\\\\\\<b>")).toBe("\\\\\\\\\\<b>");
    expect(g("x\\<b>y<i>")).toBe("x\\<b>y\\<i>");
    expect(g("\\<!-- x --> <!-- y -->")).toBe("\\<!-- x --> \\<!-- y -->");
  });

  it("keeps a backslash that follows a URL out of the URL, so the `<` after a URL is escaped once", () => {
    // A space goes before the backslash: a renderer that links a bare URL to the next space would take the backslash into the link.
    expect(g(`${SITE}/a<b>`)).toBe(`${SITE}/a \\<b>`);
    expect(g(`${SITE}/a\\<b>`)).toBe(`${SITE}/a \\<b>`);
    expect(g("https://evil.example/x<b>")).toBe(`${removed}\\<b>`);
    expect(g("https://evil.example/x\\<b>")).toBe(`${removed}\\<b>`);
    expect(g("https://<b>")).toBe("https://\\<b>");
    expect(g("https://\\<b>")).toBe("https://\\<b>");
  });

  it("does not escape the `<` of a site autolink, and escapes one that is not a plain autolink", () => {
    for (const keep of [`<${SITE}/findings/a>`, `<${SITE}>`, `<${SITE}#a>`, `<${SITE}?q=1>`, `see <${SITE}/a>.`, `x<${SITE}/a>y`, `\\<${SITE}/a>`, `\\\\<${SITE}/a>`]) {
      expect(g(keep), keep).toBe(keep);
    }
    expect(g(`<${SITE}/a b>`)).toBe(`\\<${SITE}/a b>`);
    expect(g(`<${SITE}/a><b>`)).toBe(`<${SITE}/a>\\<b>`);
    expect(g(`<${SITE}/a`)).toBe(`\\<${SITE}/a`);
    expect(g(`<${SITE}.evil.example/x>`)).toBe(removed);
    expect(g("<https://evil.example/x>")).toBe(removed);
  });

  it("takes emoji and joiners out first, so taking them out cannot join the pieces of a tag, a link or the canary", () => {
    expect(g(`<${grin}b>`)).toBe("\\<b>");
    expect(g(`<${joiner}!-- x -->`)).toBe("\\<!-- x -->");
    expect(g(`https:/${grin}/evil.example/x`)).toBe(removed);
    expect(g(`www.${grin}example.org`)).toBe(removed);
    expect(g(`${CANARY_TOKEN.slice(0, 6)}${grin}${CANARY_TOKEN.slice(6)}`)).toBe("[removed]");
    expect(g(`<${grin}${SITE}/a>`)).toBe(`<${SITE}/a>`);
  });

  it("reads a Markdown destination last, so one that a removal creates is removed too, and its own text stays", () => {
    expect(g("www.evil.example(javascript:alert(1))")).toBe(`${removed}(${removed}))`);
    expect(g("jl@example.org(/relative)")).toBe(`${removed}(${removed})`);
    expect(g(`${CANARY_TOKEN}(/relative)`)).toBe(`[removed](${removed})`);
    expect(g(`[x](${removed})`)).toBe(`[x](${removed})`);
    expect(g(`[x]( ${removed} )`)).toBe(`[x](${removed} )`);
    expect(g(`[x](${removed}more)`)).toBe(`[x](${removed}more)`);
  });

  it("keeps a `<...>` destination only when it is one plain site URL", () => {
    expect(g(`[x](<${SITE}/a>)`)).toBe(`[x](<${SITE}/a>)`);
    for (const bad of [`[x](<${SITE}/a b>)`, `[x](<${SITE}/a)`, `[x](${SITE}/a<b>)`, `[x](<${SITE}/a<b>)`]) expect(g(bad), bad).toBe(`[x](${removed})`);
  });

  it("looks inside a defanged URL, and after a bracket of a site URL, for a URL of its own", () => {
    expect(g("hxxp://a.example/https://evil.example/x")).toBe(`hxxp://a.example/${removed}`);
    expect(g("hxxps://a.example/x, and https://evil.example/y")).toBe(`hxxps://a.example/x, and ${removed}`);
    expect(g(`${SITE}/a)http://evil.example/x`)).toBe(`${SITE}/a)${removed}`);
    expect(g(`[x](${SITE}/a)![i](http://evil.example/i.png)`)).toBe(`[x](${SITE}/a)![i](${removed})`);
    expect(g(`${SITE}/a(www.evil.example)`)).toBe(`${SITE}/a(${removed})`);
    expect(g(`${SITE}/a]//evil.example/x`)).toBe(`${SITE}/a]${removed}`);
    expect(g(`(${SITE}/a(b))`)).toBe(`(${SITE}/a(b))`);
    expect(g(`${SITE}/a,http://evil.example/x`)).toBe(`${SITE}/a,http://evil.example/x`);
  });

  it("removes an e-mail address or a www host before a protocol-relative URL, so nothing is left for a second pass", () => {
    expect(g("www.example.org//evil.example/x")).toBe(`${removed}${removed}`);
    expect(g("jl@example.org//evil.example/x")).toBe(`${removed}${removed}`);
  });

  it("guards a guarded line to the same line", () => {
    const lines = [
      "<b>bold</b>", "\\<b>", "\\\\<b>", "<!-- c -->", "<?x?>", "<!DOCTYPE x>", `<img src=https://evil.example/x onerror=1>`, `<${SITE}/a b>`, `<${SITE}/a>`,
      "[click](https://evil.example/x)", "[x](javascript:alert(1))", "![i](http://e.example/i.png)", `[x](<${SITE}/a b>)`, `[x](${SITE}/a)![i](http://e.example/i.png)`,
      "www.example.org//evil.example/x", "www.evil.example(javascript:alert(1))", "hxxp://a.example/https://evil.example/x", "https://<b>", `${SITE}/a<b>`,
      `<${grin}b>`, `https:/${grin}/evil.example/x`, "# <b>", "| <b> |", "> <i>", "[x]: <b>", "a<b", "p < 0.05", "x\\<b>y<i>", "<<b>",
    ];
    for (const line of lines) {
      const once = g(line);
      expect(g(once), line).toBe(once);
    }
  });

  // Lines made of pieces a model, or a source it read, could hold: text, URLs, tags, backslashes, Markdown, emoji. Each guarded line holds
  // no `<` that opens HTML, and guarding it again changes nothing.
  const PIECES = [
    "text", " ", " ", "p < 0.05", "a<b", "<b>", "</b>", "<!-- c -->", "<?x?>", "<!DOCTYPE x>", "<img src=https://evil.example/x onerror=1>",
    `<${SITE}/findings/a>`, `<${SITE}/a b>`, `<${SITE}/a"b>`, `${SITE}/findings/a`, "https://evil.example/x", "[click](https://evil.example/x)",
    `[x](${SITE}/a)`, `[x](<${SITE}/a>)`, `[x](<${SITE}/a b>)`, "![i](http://e.example/i.png)", "<", ">", "\\", "\\<", "\\\\<", "# h", "- li", "**b**",
    "jl@example.org", "www.example.org", "//evil.example/x", "<https:evil.example>", "[link removed]", "[removed]", "hxxp://a.example/", "https://", "(", ")",
    "é", "<é", "&lt;", "[x]: y", "www.example.org(javascript:alert(1))", grin, joiner, CANARY_TOKEN,
  ];
  const FRAGMENTS = [
    "<", ">", "\\", "/", "!", "?", "-", "a", "b", " ", "[", "]", "(", ")", ":", "//", "https://", "http:", "www.", "@", ".", "org", "x", "#", "|", "=", "&", ";",
    '"', "'", "`", "*", "_", "~", grin, joiner, "link removed", "removed", SITE, `${SITE}/`, "hxxp://",
  ];

  it("leaves no `<` that opens HTML and gives the same line when guarded again, for random lines of text, URLs, tags and Markdown", () => {
    const next = seeded(20261127);
    const pick = (pool: string[]) => pool[Math.floor(next() * pool.length)]!;
    let tagged = 0;
    for (let i = 0; i < 4000; i++) {
      const pool = i % 2 === 0 ? PIECES : FRAGMENTS;
      const line = Array.from({ length: 1 + Math.floor(next() * (i % 2 === 0 ? 7 : 14)) }, () => pick(pool)).join(next() < 0.5 ? "" : " ");
      const once = g(line);
      expect(openTags(once), `${JSON.stringify(line)} gave ${JSON.stringify(once)}`).toEqual([]);
      expect(g(once), `${JSON.stringify(line)} gave ${JSON.stringify(once)}`).toBe(once);
      if (once.includes("\\<")) tagged++;
    }
    expect(tagged).toBeGreaterThan(500);
  });

  it("openTags finds a `<` that opens HTML and passes an escaped one and a site autolink", () => {
    expect(openTags("<b>")).toEqual([0]);
    expect(openTags("a </b> <!-- c --> <?x?>")).toEqual([2, 7, 18]);
    expect(openTags("\\<b> \\\\<b>")).toEqual([7]);
    expect(openTags(`<${SITE}/a> <${SITE}/a b> <img>`)).toEqual([SITE.length + 5, 2 * SITE.length + 12]);
    expect(openTags("p < 0.05 and x<=y")).toEqual([]);
  });

  it("changes no line of any sample chat edition or reply file: they hold no HTML, and every line is already guarded", () => {
    const content = sample();
    for (const brief of content.briefs) {
      for (const text of [chatFor(content, brief.date), replyFromContent(content, brief.date, SITE)]) {
        expect(text, brief.date).not.toContain("\\<");
        for (const line of lines(text)) expect(g(line), `${brief.date}: ${line}`).toBe(line);
      }
    }
  });
});

/**
 * What a Markdown renderer could still link or render in a guarded line, found without the guard's own code: an off-site URL (a scheme
 * runs back from its "://" to the first letter), an address, a "www." host, a protocol-relative URL, a Markdown destination that is not
 * "[link removed" or the site's, a link reference definition (also inside a list item or a quote), a `<` that opens HTML, an emoji, a
 * private-use character, the canary, a space at either end. Empty for a guarded line.
 */
const PRIVATE_USE_FIRST = String.fromCharCode(0xe000);

function leaks(text: string): string[] {
  const found: string[] = [];
  const closer = (c: string) => c === "" || /[\s<>]/.test(c);
  let inside = 0; // a site URL holds what follows its "://" up to a bracket, a brace, a bar or a caret: a "://" in it is a path
  for (const m of text.matchAll(/:\/\/(?=[^\s<>"'`\\])/g)) {
    let start = m.index!;
    while (start > 0 && /[A-Za-z0-9+.-]/.test(text.charAt(start - 1))) start--;
    while (start < m.index! && !/[A-Za-z]/.test(text.charAt(start))) start++;
    if (start === m.index! || start < inside) continue;
    const tail = text.slice(start);
    if (/^hxxps?:\/\//i.test(tail)) continue;
    const run = /^[^\s<>"'`\\]*/.exec(tail)![0];
    const bare = tail.startsWith(SITE) && closer(tail.charAt(SITE.length)) && run === SITE;
    const own = tail.startsWith(SITE) && /^[/?#]/.test(tail.slice(SITE.length)) && !run.includes("@");
    const punctuated = tail.startsWith(SITE) && /^[.,;:!?)\]}]*$/.test(run.slice(SITE.length)) && closer(tail.charAt(run.length));
    if (!bare && !own && !punctuated) found.push(`off-site URL ${tail.slice(0, 60)}`);
    inside = start + /^[^()[\]{}|^]*/.exec(run)![0].length;
  }
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.test(text)) found.push("an address");
  // The site's URLs are masked by a private-use character, which a guarded line never holds and a host does not start with.
  const plain = text.replace(new RegExp(`${escapeRe(SITE)}[^\\s<>"'\`\\\\()[\\]{}|^]*`, "g"), PRIVATE_USE_FIRST);
  if (/(?<![\p{L}\p{N}])www\.[\p{L}\p{N}-]+/iu.test(plain)) found.push("a www host");
  if (/(?<![\p{L}\p{N}_:/\\])\/\/(?=[\p{L}\p{N}])/u.test(plain)) found.push("a protocol-relative URL");
  for (const m of text.matchAll(/\]\(\s*/g)) {
    const rest = text.slice(m.index! + m[0].length);
    if (!rest.startsWith("[link removed") && !rest.startsWith(SITE) && !rest.startsWith(`<${SITE}`)) found.push(`a destination ${rest.slice(0, 30)}`);
  }
  if (/^(?:(?:[-+*]|\d{1,9}[.)])[ \t]+|>[ \t]?)*\[(?:[^\]\\]|\\.)*\]:/.test(text)) found.push("a link reference definition");
  if (openTags(text).length > 0) found.push("a tag");
  if (/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(text) || new RegExp(`[${PRIVATE_USE_FIRST}-${String.fromCharCode(0xf8ff)}]`).test(text)) found.push("an emoji or a private-use character");
  if (text.toLowerCase().includes(CANARY_TOKEN.toLowerCase())) found.push("the canary");
  if (text !== text.trim()) found.push("a space at an end");
  return found;
}

describe("chatGuard: what a renderer may read past, and a long line", () => {
  const g = (line: string) => chatGuard(line, SITE);
  const removed = "[link removed]";
  const grin = String.fromCodePoint(0x1f600);

  it("puts a space before the backslash of an escaped `<` when a link comes earlier in its word, so a renderer cannot take the backslash into the link", () => {
    expect(g(`${SITE}/a<b>`)).toBe(`${SITE}/a \\<b>`);
    expect(g(`${SITE}/a\\<b>`)).toBe(`${SITE}/a \\<b>`);
    expect(g(`${SITE}/a\\\\<b>`)).toBe(`${SITE}/a \\\\\\<b>`);
    expect(g(`${SITE}/a \\<b>`)).toBe(`${SITE}/a \\<b>`);
    expect(g(`${SITE}<b>`)).toBe(`${SITE} \\<b>`);
    expect(g(`${SITE}/a<b>${SITE}/c<d>`)).toBe(`${SITE}/a \\<b>${SITE}/c \\<d>`);
    expect(g(`${SITE}/a(b<c>`)).toBe(`${SITE}/a(b \\<c>`);
    expect(g("awww.b<c>")).toBe("awww.b \\<c>");
    // The space is for the tag that follows the link: a later tag, past the first one, has no link in its own part of the word.
    expect(g(`${SITE}/a<b>y<c>`)).toBe(`${SITE}/a \\<b>y\\<c>`);
    expect(g(`${SITE}/a<b>y<c>(${SITE}/d<e>`)).toBe(`${SITE}/a \\<b>y\\<c>(${SITE}/d \\<e>`);
    // No space where nothing before could swallow the backslash: no link, a link only after it, a link that is gone, a `://` with no host,
    // an autolink that ends at its own ">", or a link in an earlier word.
    expect(g("a<b>")).toBe("a\\<b>");
    expect(g(`a<b>${SITE}/c`)).toBe(`a\\<b>${SITE}/c`);
    expect(g("https://evil.example/x\\<b>")).toBe(`${removed}\\<b>`);
    expect(g("www.example.org<b>")).toBe(`${removed}\\<b>`);
    expect(g(`${SITE}\\<b>`)).toBe(`${removed}\\<b>`);
    expect(g("https://<b>")).toBe("https://\\<b>");
    expect(g(`<${SITE}/a>\\<b>`)).toBe(`<${SITE}/a>\\<b>`);
    expect(g(`<${SITE}/a><b>`)).toBe(`<${SITE}/a>\\<b>`);
    expect(g(`${SITE}/a x<b>`)).toBe(`${SITE}/a x\\<b>`);
    // A `://` with no host character after it, and a `//` that is no URL's, link nothing, so no space goes in.
    expect(g(`a://"<b>`)).toBe(`a://"\\<b>`);
    expect(g("a://'<b>")).toBe("a://'\\<b>");
    expect(g("a://`<b>")).toBe("a://`\\<b>");
    expect(g("a://><b>")).toBe("a://>\\<b>");
    expect(g("a://\\<b>")).toBe("a://\\<b>");
    expect(g("a//b<c>")).toBe("a//b\\<c>");
    // A backslash after a URL with no "<" after it stays as written.
    expect(g(`${SITE}/a\\`)).toBe(`${SITE}/a\\`);
  });

  it("starts a URL's scheme at the first letter of the run before `://`, whatever comes before the run", () => {
    expect(g("1https://evil.example/x")).toBe(`1${removed}`);
    expect(g("_https://evil.example/x")).toBe(`_${removed}`);
    expect(g("a_https://evil.example/x")).toBe(`a_${removed}`);
    expect(g("a.b-c+d://x")).toBe(removed);
    expect(g(`bhttps://${SITE.slice("https://".length)}/a`)).toBe(removed);
    expect(g("1hxxps://a.example/x")).toBe("1hxxps://a.example/x");
    // Without a scheme, or without a character after `://` that a host starts with, there is no URL.
    for (const plain of ["://x", "a://", "a:// b", `a://"x`, "a://'x", "a://`x", "a://>x", "a://\\x"]) expect(g(plain), plain).toBe(plain);
  });

  it("keeps a bare site URL only when nothing can extend it: a renderer may read on past a quote or a backslash into a longer host name or a user name", () => {
    for (const bad of [`${SITE}"@evil.example/x`, `${SITE}".evil.example/x`, `${SITE}\\@evil.example/x`, `${SITE}>@evil.example/x`, `${SITE}'x`, `${SITE}\`x`, `${SITE}"x`]) {
      expect(g(bad), bad).toBe(bad.replace(SITE, removed));
    }
    expect(g(`${SITE}@evil.example`)).toBe(removed);
    expect(g(`${SITE}.evil.example/x`)).toBe(removed);
    for (const keep of [SITE, `${SITE}.`, `${SITE}/`, `${SITE}?`, `${SITE} @x`, `see ${SITE}`, `${SITE}) x`, `(${SITE})`, `<${SITE}>`, `<${SITE}>@evil.example`]) {
      expect(g(keep), keep).toBe(keep);
    }
    expect(g(`x<${SITE}>y`)).toBe(`x<${SITE}>y`);
    // The ">" ends the URL only for an autolink whose "<" is not escaped: an even number of backslashes before it leave it open.
    expect(g(`\\<${SITE}>`)).toBe(`\\<${removed}>`);
    expect(g(`\\\\<${SITE}>`)).toBe(`\\\\<${SITE}>`);
    expect(g(`\\\\\\<${SITE}>`)).toBe(`\\\\\\<${removed}>`);
    // A site URL with a path ends at the first "/" for every renderer.
    expect(g(`${SITE}/a"@evil.example`)).toBe(`${SITE}/a"@evil.example`);
  });

  it("ends a kept site URL at a bracket, a parenthesis, a brace, a bar or a caret, which a renderer may end a link at, and reads what follows", () => {
    expect(g(`${SITE}/a|https://evil.example/x`)).toBe(`${SITE}/a|${removed}`);
    expect(g(`${SITE}/a{https://evil.example/x`)).toBe(`${SITE}/a{${removed}`);
    expect(g(`${SITE}/a^https://evil.example/x`)).toBe(`${SITE}/a^${removed}`);
    expect(g(`${SITE}/a(https://evil.example/x`)).toBe(`${SITE}/a(${removed}`);
    expect(g(`${SITE}/a)https://evil.example/x`)).toBe(`${SITE}/a)${removed}`);
    expect(g(`${SITE}/a]|//evil.example/x`)).toBe(`${SITE}/a]|${removed}`);
    expect(g(`${SITE}/a}https://evil.example/x`)).toBe(`${SITE}/a}${removed}`);
    expect(g(`${SITE}/a}b`)).toBe(`${SITE}/a}b`);
  });

  it("removes a URL with an at sign in it, so a renderer cannot read an address in a kept URL", () => {
    expect(g(`${SITE}/a|jl@example.org`)).toBe(removed);
    expect(g(`${SITE}/a@b`)).toBe(removed);
    expect(g(`${SITE}/@a`)).toBe(removed);
    expect(g(`${SITE}/a jl@example.org`)).toBe(`${SITE}/a ${removed}`);
  });

  it("removes an address that follows another, and one whose local part holds only dots and signs", () => {
    expect(g("a@b.c%x@y.z")).toBe(`${removed}${removed}`);
    expect(g("a@b.c a@b.c")).toBe(`${removed} ${removed}`);
    expect(g(".@b.c")).toBe(removed);
    expect(g("a@b.c@d.e")).toBe(`${removed}@d.e`);
    // No local part, or no dot in the domain: not an address.
    for (const plain of ["@b.c", "a@b", "a @b.c", "x@", "a@.b.c", "a@b.", "a@b..c"]) expect(g(plain), plain).toBe(plain);
    expect(g("a@-b.c")).toBe(removed);
    // One that has no local part does not stop the search for the next.
    expect(g("x @b.c a@b.c")).toBe(`x @b.c ${removed}`);
  });

  it("leaves no link after a `](` that a removal made: a `(` after a removed `<...>` destination is escaped, and the guard's own text stays", () => {
    expect(g("[x](<>(javascript:alert(1))")).toBe(`[x](${removed}\\(javascript:alert(1))`);
    expect(g(`[x](${removed}(javascript:alert(1))`)).toBe(`[x](${removed}(${removed}))`);
    expect(g("[x](<javascript:alert(1)>(b)")).toBe(`[x](${removed}(${removed})`);
    expect(g(`[x](<${SITE}/a>(b)`)).toBe(`[x](<${SITE}/a>(b)`);
    expect(g(`[x](<${SITE}/a>) [y](<${SITE}/b>)`)).toBe(`[x](<${SITE}/a>) [y](<${SITE}/b>)`);
    expect(g(`[x](<a b>) [y](<${SITE}/b>)`)).toBe(`[x](${removed}) [y](<${SITE}/b>)`);
    expect(g(`[x](<${SITE}/a>) [y](<a b>)`)).toBe(`[x](<${SITE}/a>) [y](${removed})`);
    expect(g("[x]([link removed more")).toBe(`[x](${removed} removed more`);
    expect(g("](<")).toBe(`](${removed}`);
    expect(g("[x](a b")).toBe(`[x](${removed} b`);
    expect(g("[x](<a b")).toBe(`[x](${removed} b`);
    expect(g("](< ](< ")).toBe(`](${removed} ](${removed}`);
  });

  it("escapes a link reference definition inside a list item or a quote, which defines its label for the whole message", () => {
    expect(g("- [x]: javascript:alert(1)")).toBe("- \\[x]: javascript:alert(1)");
    expect(g("1. [x]: javascript:alert(1)")).toBe("1. \\[x]: javascript:alert(1)");
    expect(g("10) [x]: y")).toBe("10) \\[x]: y");
    expect(g("* [x]: y")).toBe("* \\[x]: y");
    expect(g("+ [x]: y")).toBe("+ \\[x]: y");
    expect(g("> [x]: y")).toBe("\\> \\[x]: y");
    expect(g("> - [x]: y")).toBe("\\> - \\[x]: y");
    expect(g("-  [x]: y")).toBe("- \\[x]: y");
    // A label may hold an escaped bracket, and a definition at the start of the line is escaped as before.
    expect(g("- [x\\]]: y")).toBe("- \\[x\\]]: y");
    expect(g("[x\\]]: y")).toBe("\\[x\\]]: y");
    // Not a definition: no marker with a space after it, no colon right after the label.
    for (const plain of ["-[x]: y", "- [x] y", "- [x]y: z", "a - [x]: y", "1.[x]: y"]) expect(g(plain), plain).toBe(plain);
  });

  it("gives nothing a renderer could still link or render, for random lines of URLs, addresses, destinations, definitions, tags and quotes", () => {
    const pieces = [
      "a", " ", " ", "<", ">", "\\", "/", "!", "?", "@", ".", ":", "//", "://", "#", "|", "{", "}", "^", "(", ")", "[", "]", "](", "](<", '"', "'", "`", "_", "1", "-", "*", "+",
      "[x]:", "- ", "1. ", "> ", "https://", "hxxp://", "www.", "x.y", "org", "<b>", "</i>", "<!--", "<?", "[link removed]", "[removed]", SITE, `${SITE}/`, `${SITE}/a`,
      `<${SITE}/a>`, `<${SITE}>`, "https://evil.example/x", "jl@example.org", "javascript:", grin, CANARY_TOKEN,
    ];
    const next = seeded(20261128);
    let kept = 0;
    for (let i = 0; i < 12000; i++) {
      const line = Array.from({ length: 1 + Math.floor(next() * 10) }, () => pieces[Math.floor(next() * pieces.length)]!).join(next() < 0.7 ? "" : " ");
      const once = g(line);
      expect(leaks(once), `${JSON.stringify(line)} gave ${JSON.stringify(once)}`).toEqual([]);
      expect(g(once), `${JSON.stringify(line)} gave ${JSON.stringify(once)}`).toBe(once);
      if (once.includes(SITE)) kept++;
    }
    expect(kept).toBeGreaterThan(1500);
  });

  it("leaks finds what a guarded line must not hold", () => {
    expect(leaks("see https://evil.example/x")).toEqual(["off-site URL https://evil.example/x"]);
    expect(leaks("1https://evil.example/x")).toHaveLength(1);
    expect(leaks(`${SITE}"@evil.example/x`)).toHaveLength(1);
    expect(leaks(`${SITE}/a|jl@example.org`)).toEqual(expect.arrayContaining(["an address"]));
    expect(leaks("www.example.org")).toEqual(["a www host"]);
    expect(leaks("//evil.example/x")).toEqual(["a protocol-relative URL"]);
    expect(leaks("[x](javascript:alert(1))")).toHaveLength(1);
    expect(leaks("- [x]: y")).toEqual(["a link reference definition"]);
    expect(leaks("<b>")).toEqual(["a tag"]);
    expect(leaks(` a`)).toEqual(["a space at an end"]);
    for (const clean of [`${SITE}/a`, SITE, `${SITE}.`, `<${SITE}/a>`, `[x](${SITE}/a)`, `[x](<${SITE}/a>)`, `[x](${removed})`, "hxxp://a.example/x", "- \\[x]: y", "\\<b>", "p < 0.05"]) {
      expect(leaks(clean), clean).toEqual([]);
    }
  });

  // A long line costs a long pass: a pattern that reads on from each start of a long run again would take seconds on these.
  const N = 200000;
  const repeat = (unit: string, size = N) => unit.repeat(Math.ceil(size / unit.length));
  const LONG: Array<[string, string]> = [
    ["a run of backslashes", "\\".repeat(N)],
    ["a run of backslashes then a tag", `${"\\".repeat(N)}<b>`],
    ["a run of `<`", "<".repeat(N)],
    ["a run of tags", repeat("<b>")],
    ["a run of tag starts with no end", repeat("<a:")],
    ["defanged URLs in a chain", repeat("hxxp://a/")],
    ["site URLs in a chain, each ended by a parenthesis", repeat(`${SITE}/a)`)],
    ["site URLs in a chain, each followed by a tag", repeat(`${SITE}/a<b>`)],
    ["site URLs in a chain, each followed by a quote", repeat(`${SITE}"`)],
    ["off-site URLs in a chain", repeat("https://e.example/x ")],
    ["a destination opener with no end, in a chain", repeat("](< ")],
    ["a destination opener with no space, in a chain", repeat("](<")],
    ["destinations with a space, in a chain", repeat("[x](a b) ")],
    ["a long run of scheme characters before `://`", `${"a".repeat(N)}://x`],
    ["a long run of scheme characters with no `://`", "a1".repeat(N / 2)],
    ["`://` in a chain with no scheme", repeat("://")],
    ["a long local part, then a domain", `${"a.".repeat(N / 2)}@b.c`],
    ["a long local part with no at sign", "a.".repeat(N / 2)],
    ["addresses in a chain", repeat("a@b.c%")],
    ["`@` in a chain", "@".repeat(N)],
    ["`www.` in a chain", repeat("www.")],
    ["`//` in a chain", repeat("//")],
    ["brackets", "[".repeat(N)],
    ["a long label with no end", `- [${"a".repeat(N)}`],
    ["a long label of escaped brackets", `[${"\\]".repeat(N / 2)}`],
    ["list markers in a chain", `${"- ".repeat(N / 2)}[x]:`],
    ["quote markers in a chain", `${"> ".repeat(N / 2)}[x]:`],
    ["a long line of spaces and a word", `${" ".repeat(N)}a`],
  ];

  it.each(LONG)("guards %s in under a second, and guarding it again changes nothing", (_name, line) => {
    const before = performance.now();
    const once = g(line);
    expect(performance.now() - before).toBeLessThan(1000);
    expect(g(once)).toBe(once);
  });

  // The search for the ">" that ends a "<...>" destination is done once for all of them; read again at each opener it takes seconds here, and
  // a search is so fast that a shorter line would not show it.
  it("guards a chain of 1.2 million characters of destination openers with no end in about a second", () => {
    const before = performance.now();
    const once = g(repeat("](< ", 1200000));
    expect(performance.now() - before).toBeLessThan(1500);
    expect(g(once)).toBe(once);
  });

  it("guards every line of up to 5 of the guard's special characters without a throw, and each result holds nothing a renderer could still link or render", () => {
    const alphabet = ["<", "\\", "/", ":", "]", "(", "@", "a", " ", "-", "["];
    let count = 0;
    const walk = (prefix: string, left: number) => {
      const once = g(prefix);
      expect(leaks(once), JSON.stringify(prefix)).toEqual([]);
      expect(g(once), JSON.stringify(prefix)).toBe(once);
      count++;
      if (left === 0) return;
      for (const c of alphabet) walk(prefix + c, left - 1);
    };
    walk("", 5);
    expect(count).toBe(1 + 11 + 11 ** 2 + 11 ** 3 + 11 ** 4 + 11 ** 5);
  });
});

describe("raw HTML in model text reaches neither the chat edition nor the reply file", () => {
  it("escapes it in the Lead, the big picture, the story, a More line and the Pace sentence, and in the reply file", () => {
    const monday = picks().monday;
    const D = monday.date;
    const c = variant(D, (b, content) => {
      b.lead = [{ text: { en: "<b>Lead</b> text <!-- note -->", zh: null }, finding_ids: [] }];
      b.pace.sentence.en = "Pace <?php x ?> sentence";
      b.review!.big_picture.en = "Big <img src=https://evil.example/x onerror=1> picture";
      findingIn(content, b.story!.finding_id).explainer.found.en = "Found <script>x()</script> it.";
      findingIn(content, b.items[0]!.finding_id).explainer.found.en = "First <i>sentence</i>. Second one.";
    });
    const chat = chatFor(c, D);
    const reply = renderReply(briefIn(c, D), c, SITE);
    checkChat(chat, SITE, { cap: CHAT_MAX_LINES });
    checkChat(reply, SITE, { blank: true });
    for (const text of [chat, reply]) {
      expect(openTags(text)).toEqual([]);
      expect(text).toContain("\\<b>Lead\\</b> text \\<!-- note -->");
      expect(text).toContain("Pace \\<?php x ?> sentence");
      expect(text).toContain("Big \\<img src=[link removed] onerror=1> picture");
      expect(text).toContain("Found \\<script>x()\\</script> it.");
      expect(text).not.toContain("evil.example");
    }
    expect(chat).toContain("First \\<i>sentence\\</i>.");
    expect(chat).not.toContain("Second one");
    expect(reply).toContain("First \\<i>sentence\\</i>. Second one.");
  });
});

// ── heldLockLine and fallbackChat ────────────────────────────────────────────────────────────────

describe("heldLockLine and fallbackChat", () => {
  it("heldLockLine gives the held-lock line with the Taipei start time", () => {
    expect(heldLockLine("2026-10-21", at("2026-10-21", "03:20"))).toBe(`${SITE_NAME} 2026-10-21: another run is in progress (started 03:20); nothing done.`);
    expect(heldLockLine("2026-10-21", "2026-10-20T19:20:00Z")).toBe(`${SITE_NAME} 2026-10-21: another run is in progress (started 03:20); nothing done.`);
  });

  it("fallbackChat names the class of the error and never its message", () => {
    const text = fallbackChat("2026-10-21", new TypeError("SECRET-MESSAGE-MARKER"));
    expect(text).toBe(`**${SITE_NAME} 2026-10-21 · failed** (E_INTERNAL)\nThe chat edition could not be rendered (TypeError).\n`);
    expect(text).not.toContain("SECRET");
    checkChat(text, SITE, { cap: CHAT_MAX_LINES });
    expect(fallbackChat("2026-10-21", "a thrown string")).toContain("(Error).");
    expect(fallbackChat("2026-10-21", { name: "Fake" })).toContain("(Error).");
    expect(fallbackChat("2026-10-21", null)).toContain("(Error).");
    class Custom extends Error {}
    expect(fallbackChat("2026-10-21", new Custom("x"))).toContain("(Custom).");
    const odd = new Error("x");
    Object.defineProperty(odd.constructor, "name", { value: "Bad-Name", configurable: true });
    expect(fallbackChat("2026-10-21", odd)).toContain("(Error).");
    Object.defineProperty(odd.constructor, "name", { value: "", configurable: true });
    expect(fallbackChat("2026-10-21", odd)).toContain("(Error).");
    Object.defineProperty(odd.constructor, "name", { value: "Error", configurable: true });
  });
});

// ── The reply file ───────────────────────────────────────────────────────────────────────────────

/** One finding's block of the reply file, from the spec's list of its parts. */
function replyBlock(content: Content, label: string, id: string, D: string, back?: string): string {
  const f = filed(content, id, D);
  const terms = f.terms.flatMap((t) => content.terms.find((x) => x.id === t) ?? []);
  return [
    "", `**${label}${norm(f.title.en)}** (${f.id})`, `Page: ${SITE}/findings/${f.id}`, `Filed as: ${kickerOf(f)}`, ...(back === undefined ? [] : [`Back: ${back}`]),
    ...partLines(f), ...(f.disclosure ? [DISCLOSURE.en] : []), `Rung: ${RUNG_INFO[f.rung].en}.`, "Rung history:",
    ...f.rung_history.map((e) => `- ${e.date} ${RUNG_INFO[e.rung].en}${e.note === null ? "" : `: ${norm(e.note.en)}`}`),
    ...(f.since_then.length ? ["Since then:", ...f.since_then.map((n) => `- ${n.date}: ${norm(n.text.en)}`)] : []),
    ...(terms.length ? ["Terms:", ...terms.map((t) => `- ${norm(t.en.term)}: ${norm(t.en.definition)}`)] : []),
  ].join("\n");
}

describe("the reply file", () => {
  const content = sample();
  const { monday, sunday } = picks();

  it("opens with its heading and fixed line, then the Lead and the Pace sentence", () => {
    const ls = lines(renderReply(monday, content, SITE));
    expect(ls.slice(0, 4)).toEqual([`**${SITE_NAME} ${monday.date} · reply file**`, REPLY_INTRO, "", "**Lead**"]);
    expect(REPLY_INTRO).toBe("This file holds the text of this edition, for answering a reader's reply. Answer only from it.");
    const i = ls.indexOf("**Pace**");
    expect(ls.slice(4, i)).toEqual([...monday.lead.map((l) => norm(l.text.en)), ""]);
    expect(ls[i + 1]).toBe(norm(monday.pace.sentence.en));
  });

  it("has no Lead heading when the brief has no Lead sentence, as a data-only edition has none", () => {
    const dataOnly = picks().dataOnly;
    expect(dataOnly.lead).toHaveLength(0);
    const ls = lines(renderReply(dataOnly, content, SITE));
    expect(ls.slice(0, 4)).toEqual([`**${SITE_NAME} ${dataOnly.date} · reply file**`, REPLY_INTRO, "", "**Pace**"]);
    expect(ls).not.toContain("**Lead**");
    const blankLead = variant(monday.date, (b) => { b.lead = [{ text: { en: " \n ", zh: null }, finding_ids: [] }]; });
    expect(renderReply(briefIn(blankLead, monday.date), blankLead, SITE)).not.toContain("**Lead**");
  });

  it("holds every part of the sample's Monday: review, story and items, climbed or fell, counts and decisions", () => {
    const D = monday.date;
    const text = renderReply(monday, content, SITE);
    expect(text).toContain(`**The week in review**\n${norm(monday.review!.big_picture.en)}\n`);
    expect(text).toContain(`Strongest evidence against: ${NONE_FOUND.en}\n${DISCLOSURE.en}\n`);
    expect(text).not.toContain("Most remarkable");
    expect(text).toContain(replyBlock(content, "Story of the day: ", monday.story!.finding_id, D));
    monday.items.forEach((e, i) => expect(text).toContain(replyBlock(content, `Item ${i + 1}: `, e.finding_id, D, e.new ? undefined : norm(e.update!.en))));
    expect(text).toContain(`Page: ${SITE}/findings/${monday.story!.finding_id}\n`);
  });

  it("prints each paragraph of the big picture once, with one blank line after it and none for a blank paragraph", () => {
    const D = monday.date;
    const c = variant(D, (b) => { b.review!.big_picture.en = "  \n\nFirst paragraph\nstill the first.\n\nSecond paragraph.\n\n  "; });
    const text = renderReply(briefIn(c, D), c, SITE);
    expect(text).toContain("**The week in review**\nFirst paragraph still the first.\n\nSecond paragraph.\n\nStrongest evidence against: ");
    expect(text).not.toContain("\n\n\n");
  });

  it("holds the remarkable finding of a Monday copy that sets it, and the review's disclosure only when it is listed", () => {
    const D = monday.date;
    const id = monday.story!.finding_id;
    const c = variant(D, (b) => { b.review!.remarkable = { finding_id: id, note: { en: "A note\nin two lines.", zh: null } }; });
    const text = renderReply(briefIn(c, D), c, SITE);
    expect(text).toContain(`Most remarkable: ${norm(findingIn(c, id).title.en)} (${id}) · A note in two lines.\n`);
    const unloaded = copyOfSample();
    briefIn(unloaded, D).review!.remarkable = { finding_id: id, note: { en: "A note.", zh: null } };
    unloaded.findings = unloaded.findings.filter((x) => x.id !== id);
    expect(renderReply(briefIn(unloaded, D), unloaded, SITE)).not.toContain("Most remarkable");
    const d = variant(D, (b) => { b.disclosure = []; });
    const quiet = renderReply(briefIn(d, D), d, SITE);
    expect(quiet).not.toContain(`Strongest evidence against: ${NONE_FOUND.en}\n${DISCLOSURE.en}`);
    expect(quiet).toContain(`Strongest evidence against: ${NONE_FOUND.en}\n`);
  });

  it("holds the Sunday's deep dive in full, its findings numbered as the chat edition numbers them, and the named finding", () => {
    const D = sunday.date;
    const dive = sunday.deep_dive!;
    const text = renderReply(sunday, content, SITE);
    const f = filed(content, dive.finding_id, D);
    const paragraphs = dive.text.en.split(/\n\s*\n/).map(norm).join("\n\n");
    expect(text).toContain(`**Sunday deep dive: ${norm(f.title.en)}** (${f.id})\n${paragraphs}\n\n`);
    expect(text).not.toContain("Story of the day");
    const entries = [...(sunday.story === null ? [] : [sunday.story]), ...sunday.items];
    entries.forEach((e, i) => expect(text).toContain(replyBlock(content, `Item ${i + 1}: `, e.finding_id, D, e.new ? undefined : norm(e.update!.en))));
    expect(text).toContain(replyBlock(content, "Also named: ", dive.finding_id, D));
    const quiet = variant(D, (b) => { b.deep_dive = null; });
    expect(renderReply(briefIn(quiet, D), quiet, SITE)).not.toContain("Sunday deep dive");
    const gone = copyOfSample();
    gone.findings = gone.findings.filter((x) => x.id !== dive.finding_id);
    const without = renderReply(briefIn(gone, D), gone, SITE);
    expect(without).not.toContain("Sunday deep dive");
    expect(without).not.toContain(dive.finding_id);
    const d = variant(D, (b) => { b.disclosure = ["deep_dive"]; });
    expect(renderReply(briefIn(d, D), d, SITE)).toContain(`${paragraphs}\n\n${DISCLOSURE.en}\n`);
  });

  it("holds the full Back: update, Climbed or fell, Ideas and debate, Also noted, Corrections and Reports of a busy daily", () => {
    const b = picks().busiest;
    const D = b.date;
    const text = renderReply(b, content, SITE);
    const changes = b.rung_changes.map((c) => `- ${norm(filed(content, c.finding_id, D).title.en)} ${RUNG_INFO[c.from].en} → ${RUNG_INFO[c.to].en}`);
    if (changes.length) expect(text).toContain(`**Climbed or fell**\n${changes.join("\n")}\n`);
    for (const c of b.rung_changes) expect(text).toContain(replyBlock(content, "Also named: ", c.finding_id, D));
    expect(b.corrections.length).toBeGreaterThan(0);
    expect(b.reports.length).toBeGreaterThan(0);
    expect(text).toContain("\n**Corrections**\n- ");
    expect(text).toContain("\n**Reports**\n- ");
    for (const c of b.corrections) {
      expect(text).toContain(`- ${c.id} ${c.type} to ${c.finding_id ?? c.edition_date ?? c.term_id}: ${norm(c.reason.en)}\n`);
    }
    for (const r of b.reports) {
      const reason = content.reports.find((x) => x.id === r.id)!.reason;
      expect(text).toContain(`- ${r.id} ${r.status} (${r.finding_id})${reason ? `: ${norm(reason.en)}` : ""}\n`);
    }
    b.items.forEach((e, i) => expect(text).toContain(replyBlock(content, `Item ${i + 1}: `, e.finding_id, D, e.new ? undefined : norm(e.update!.en))));
  });

  it("prints Ideas and debate texts and Also noted titles without any link or source", () => {
    const { alsoOnly } = picks();
    const c = variant(alsoOnly.date, (b) => {
      b.ideas = [{ text: { en: "An argument\nin two lines.", zh: null }, who: "WHO-MARKER", source_id: "b1" }];
      b.disclosure = ["ideas.0", "also.1"];
    });
    const text = renderReply(briefIn(c, alsoOnly.date), c, SITE);
    expect(text).toContain(`**Ideas and debate**\n- An argument in two lines.\n${DISCLOSURE.en}\n`);
    const also = briefIn(c, alsoOnly.date).also;
    expect(text).toContain(`**Also noted**\n- ${norm(also[0]!.title.en)} (${FIELD_INFO[also[0]!.field].en})\n- ${norm(also[1]!.title.en)} (${FIELD_INFO[also[1]!.field].en})\n${DISCLOSURE.en}\n`);
    expect(text).not.toContain("WHO-MARKER");
    const none = variant(alsoOnly.date, (b) => { b.ideas = []; b.also = []; });
    const quiet = renderReply(briefIn(none, alsoOnly.date), none, SITE);
    expect(quiet).not.toContain("**Ideas and debate**");
    expect(quiet).not.toContain("**Also noted**");
  });

  it("names a finding once, as the story or an item, and not again as 'Also named'", () => {
    const b = picks().busiest;
    const D = b.date;
    const c = variant(D, (x) => {
      x.lead = [{ text: { en: "A lead sentence.", zh: null }, finding_ids: [x.story!.finding_id, x.items[0]!.finding_id] }];
    });
    const text = renderReply(briefIn(c, D), c, SITE);
    expect(text.split(`(${b.story!.finding_id})\nPage:`).length - 1).toBe(1);
    expect(text).not.toContain("Also named: " + norm(findingIn(c, b.story!.finding_id).title.en));
  });

  it("names a finding as 'Also named' whichever part of the brief names it: the Lead, a rung change, the deep dive, each list of the review, a correction or a report", () => {
    const base = picks().monday;
    const D = base.date;
    const target = content.findings.find((f) => f.id !== base.story?.finding_id && !base.items.some((i) => i.finding_id === f.id))!.id;
    const dive = { ...picks().sunday.deep_dive!, finding_id: target };
    const sources: Record<string, (b: Brief) => void> = {
      lead: (b) => { b.lead = [{ text: { en: "A lead sentence.", zh: null }, finding_ids: [target] }]; },
      "rung change": (b) => { b.rung_changes = [{ finding_id: target, from: "preprint", to: "checked", date: D, by: "script" }]; },
      "deep dive": (b) => { b.deep_dive = dive; },
      remarkable: (b) => { b.review!.remarkable = { finding_id: target, note: { en: "A note.", zh: null } }; },
      "strongest against": (b) => { b.review!.strongest_against.finding_ids = [target]; },
      fell: (b) => { b.review!.fell = [target]; },
      setbacks: (b) => { b.review!.setbacks = [target]; },
      correction: (b) => { b.corrections = [{ id: "C-0095", finding_id: target, edition_date: null, term_id: null, type: "correction", reason: { en: "A reason.", zh: null } }]; },
      report: (b) => { b.reports = [{ id: "R-0095", finding_id: target, status: "upheld" }]; },
    };
    const bare = (c: Content) => {
      const b = briefIn(c, D);
      b.story = null; b.items = []; b.lead = []; b.rung_changes = []; b.deep_dive = null; b.corrections = []; b.reports = [];
      b.review!.remarkable = null; b.review!.strongest_against.finding_ids = []; b.review!.fell = []; b.review!.setbacks = [];
    };
    const none = variant(D, (_b, c) => bare(c));
    expect(renderReply(briefIn(none, D), none, SITE)).not.toContain(`(${target})`);
    for (const [name, set] of Object.entries(sources)) {
      const c = variant(D, (b, all) => { bare(all); set(b); });
      expect(renderReply(briefIn(c, D), c, SITE), `named by the ${name}`).toContain(replyBlock(c, "Also named: ", target, D));
    }
  });

  it("holds a Sunday that carries a story as the chat edition does: no 'Story of the day', the story the first of the others", () => {
    const D = sunday.date;
    const story = picks().busiest.story!;
    const c = variant(D, (b) => { b.story = { finding_id: story.finding_id, new: true, update: null }; });
    const text = renderReply(briefIn(c, D), c, SITE);
    expect(text).not.toContain("Story of the day");
    expect(text).toContain(replyBlock(c, "Item 1: ", story.finding_id, D));
    expect(chatFor(c, D)).not.toContain("Story of the day");
    expect(lines(chatFor(c, D)).some((l) => l.startsWith(`1. ${norm(findingIn(c, story.finding_id).title.en)} · `))).toBe(true);
  });

  it("names the findings a correction or a report is about, when the brief names them nowhere else", () => {
    const b = picks().busiest;
    const D = b.date;
    const named = new Set([b.story?.finding_id, ...b.items.map((i) => i.finding_id), ...b.lead.flatMap((l) => l.finding_ids), ...b.rung_changes.map((r) => r.finding_id)]);
    const [aboutCorrection, aboutReport] = content.findings.filter((f) => !named.has(f.id)).map((f) => f.id);
    const c = variant(D, (x) => {
      x.corrections = [{ id: "C-0095", finding_id: aboutCorrection!, edition_date: null, term_id: null, type: "correction", reason: { en: "A reason.", zh: null } }];
      x.reports = [{ id: "R-0095", finding_id: aboutReport!, status: "rejected" }];
    });
    c.corrections = [...c.corrections, {
      id: "C-0095", date: D, finding_id: aboutCorrection!, edition_date: null, term_id: null, type: "correction", path: "explainer.found", before: { en: "a", zh: null },
      after: { en: "b", zh: null }, reason: { en: "A reason.", zh: null }, source_url: null, trigger: "editor", report_id: null,
    }];
    c.reports = [...c.reports, {
      id: "R-0095", received: `${D}T01:00:00+08:00`, issue_number: 95, finding_id: aboutReport!, kind: "fact", evidence_url: null, status: "rejected", decided_by: "claude",
      resolved_on: D, reason: { en: "Not a fault.", zh: null }, correction_id: null,
    }];
    const text = renderReply(briefIn(c, D), c, SITE);
    expect(text).toContain(replyBlock(c, "Also named: ", aboutCorrection!, D));
    expect(text).toContain(replyBlock(c, "Also named: ", aboutReport!, D));
    expect(text).toContain(`- R-0095 rejected (${aboutReport}): Not a fault.\n`);
    expect(text).toContain(`- C-0095 correction to ${aboutCorrection}: A reason.\n`);
  });

  it("files each finding as the corrections file it, and gives a returning entry's whole update", () => {
    const b = picks().busiest;
    const D = b.date;
    const id = b.items[0]!.finding_id;
    const c = variant(D, (x) => { x.items[0] = { finding_id: id, new: false, update: { en: "First news. Second news.", zh: null } }; });
    c.corrections = [...c.corrections, {
      id: "C-0095", date: D, finding_id: id, edition_date: null, term_id: null, type: "correction", path: "ai.role", before: { en: "x", zh: null }, after: { en: "none", zh: null },
      reason: { en: "y", zh: null }, source_url: null, trigger: "editor", report_id: null,
    }];
    const text = renderReply(briefIn(c, D), c, SITE);
    expect(text).toContain(`Filed as: ${kickerOf(filed(c, id, D))}\nBack: First news. Second news.\n`);
    expect(kickerOf(filed(c, id, D))).toContain(AI_ROLE_INFO.none.en);
  });

  it("files a finding as the corrections dated on or before the edition file it: a later one changes nothing and a removed one never refiles", () => {
    const b = picks().busiest;
    const D = b.date;
    const id = b.story!.finding_id;
    const own = findingIn(sample(), id);
    const other = own.field === "mathematics" ? "physics" : "mathematics";
    const make = (n: number, over: object) => ({
      id: `C-009${n}`, date: D, finding_id: id, edition_date: null, term_id: null, type: "correction" as const, path: "field",
      before: { en: "x", zh: null }, after: { en: other, zh: null }, reason: { en: "y", zh: null }, source_url: null, trigger: "editor" as const, report_id: null, ...over,
    });
    const shows = (over: object) => {
      const c = variant(D, () => {});
      c.corrections = [...c.corrections, make(1, over)];
      // The story's own heading, then its kicker within the next few lines (the reply file puts "Filed as: " before it).
      const refiled = kickerOf({ ...own, field: other });
      const near = (text: string) => {
        const ls = lines(text);
        const i = ls.findIndex((l) => l.startsWith(`**Story of the day: ${norm(own.title.en)}**`));
        return i >= 0 && ls.slice(i, i + 5).some((l) => l === refiled || l === `Filed as: ${refiled}`);
      };
      return { chat: near(chatFor(c, D)), reply: near(renderReply(briefIn(c, D), c, SITE)) };
    };
    expect(shows({})).toEqual({ chat: true, reply: true });
    expect(shows({ date: "2020-01-01" })).toEqual({ chat: true, reply: true });
    expect(shows({ date: "2099-01-01" })).toEqual({ chat: false, reply: false });
    expect(shows({ type: "removed" })).toEqual({ chat: false, reply: false });
    expect(shows({ after: { en: "not-a-field", zh: null } })).toEqual({ chat: false, reply: false });
  });

  it("prints a finding's later facts, rung notes and the terms that loaded", () => {
    const D = picks().busiest.date;
    const c = variant(D, () => {});
    const id = briefIn(c, D).story!.finding_id;
    const f = findingIn(c, id);
    f.since_then = [{ date: D, text: { en: "A later fact.\nOn two lines.", zh: null }, source_ids: [] }];
    f.rung_history = f.rung_history.map((e, i) => (i === 0 ? { ...e, note: { en: "The first note.", zh: null } } : e));
    const known = c.terms[0]!;
    f.terms = [known.id, "a-term-that-did-not-load"];
    const text = renderReply(briefIn(c, D), c, SITE);
    expect(text).toContain("Since then:\n- " + D + ": A later fact. On two lines.\n");
    expect(text).toContain(`: The first note.\n`);
    expect(text).toContain(`Terms:\n- ${norm(known.en.term)}: ${norm(known.en.definition)}\n`);
    expect(text).not.toContain("a-term-that-did-not-load");
    expect(text).toContain(replyBlock(c, "Story of the day: ", id, D));
  });

  it("never prints a source's title, publisher or address, a quote, a who name or a reaction, however it is planted", () => {
    const c = copyOfSample();
    const markers: string[] = [];
    const mark = (kind: string, n: number, site = false) => {
      const m = site ? `${SITE}/ZQX-${kind}-${n}` : `ZQX-${kind}-${n}`;
      markers.push(m);
      return m;
    };
    c.findings.forEach((f, i) => {
      f.sources = f.sources.map((s, k) => ({ ...s, title: mark("title", i * 10 + k), publisher: mark("publisher", i * 10 + k), url: mark("url", i * 10 + k, true) }));
      f.ai = { ...f.ai, evidence: f.ai.evidence.map((e, k) => ({ ...e, quote: mark("evidence", i * 10 + k) })) };
      f.reactions = f.reactions.map((r, k) => ({ ...r, who: mark("who", i * 10 + k), affiliation: mark("affil", i * 10 + k), quote: mark("reaction", i * 10 + k) }));
      f.who = f.who.map((w, k) => ({ ...w, name: mark("name", i * 10 + k) }));
    });
    c.briefs.forEach((b, i) => {
      b.sources = b.sources.map((s, k) => ({ ...s, title: mark("btitle", i * 10 + k), publisher: mark("bpublisher", i * 10 + k), url: mark("burl", i * 10 + k, true) }));
      b.ideas = b.ideas.map((x, k) => ({ ...x, who: mark("idea-who", i * 10 + k) }));
    });
    c.reports = c.reports.map((r, i) => ({ ...r, evidence_url: mark("evidence-url", i, true) }));
    c.corrections = c.corrections.map((x, i) => ({ ...x, source_url: mark("source-url", i, true) }));
    expect(markers.length).toBeGreaterThan(20);
    for (const b of c.briefs) {
      const reply = renderReply(b, c, SITE);
      const chat = chatFor(c, b.date);
      for (const m of markers) {
        expect(reply.includes(m), `${m} in the reply of ${b.date}`).toBe(false);
        expect(chat.includes(m), `${m} in the chat edition of ${b.date}`).toBe(false);
      }
    }
  });

  it("is guarded like the chat edition: Markdown and off-site links in model text never reach it", () => {
    const D = picks().busiest.date;
    const c = variant(D, (b) => {
      b.lead = [{ text: { en: "# A heading [x](https://evil.example/y) mail a@b.example", zh: null }, finding_ids: [] }];
    });
    const text = renderReply(briefIn(c, D), c, SITE);
    checkChat(text, SITE, { blank: true });
    expect(text).not.toContain("evil.example");
    expect(text).toContain("\\# A heading");
  });

  it("leaves out a finding the loader left out and numbers the others as the chat edition does", () => {
    const b = picks().busiest;
    const D = b.date;
    const gone = b.items[0]!.finding_id;
    const c = copyOfSample();
    c.findings = c.findings.filter((f) => f.id !== gone);
    const text = renderReply(briefIn(c, D), c, SITE);
    expect(text).not.toContain(gone);
    expect(text).not.toContain(norm(findingIn(sample(), gone).title.en));
    const next = b.items[1]!;
    expect(text).toContain(replyBlock(c, "Item 1: ", next.finding_id, D, next.new ? undefined : norm(next.update!.en)));
    expect(text).not.toContain(`Item ${b.items.length}: `);
  });
});

// ── Records the loader skips ─────────────────────────────────────────────────────────────────────

describe("records the loader skips", () => {
  const content = sample();

  /** The finding the most briefs name, in any part. */
  function mostNamed(): string {
    const counts = new Map<string, number>();
    const add = (id: string | null | undefined) => id && counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const b of content.briefs) {
      add(b.story?.finding_id);
      b.items.forEach((i) => add(i.finding_id));
      b.lead.forEach((l) => l.finding_ids.forEach(add));
      b.rung_changes.forEach((r) => add(r.finding_id));
      add(b.deep_dive?.finding_id);
      b.corrections.forEach((x) => add(x.finding_id));
      b.reports.forEach((r) => add(r.finding_id));
    }
    return [...counts].sort((a, z) => z[1] - a[1] || a[0].localeCompare(z[0]))[0]![0];
  }

  it("prints no line for a finding that a safety code now fails: its title, its id and the planted text never appear", () => {
    const id = mostNamed();
    const title = findingIn(content, id).title.en;
    const dir = copyFolder();
    patchJson(dir, `findings/${id}.json`, (f) => { f.explainer.found.en = `${f.explainer.found.en} ${SEQUENCE}`; });
    const c = loadFolder(dir);
    expect(c.findings.some((f) => f.id === id)).toBe(false);
    expect(c.skipped.some((s) => JSON.stringify(s).includes(id) && JSON.stringify(s).includes("DUAL_USE"))).toBe(true);
    for (const b of c.briefs) {
      const chat = chatFor(c, b.date);
      const reply = renderReply(b, c, SITE);
      checkChat(chat, SITE, { cap: CHAT_MAX_LINES });
      for (const text of [chat, reply]) {
        expect(text, b.date).not.toContain(title);
        expect(text, b.date).not.toContain(id);
        expect(text, b.date).not.toContain(SEQUENCE);
      }
    }
    // The finding is named in at least one edition of the unplanted sample, so the check above had something to leave out.
    expect(content.briefs.some((b) => chatFor(content, b.date).includes(id))).toBe(true);
  });

  it("names a term whose own name fails a safety code by its first finding, and never prints the name", () => {
    const term = content.terms[0]!;
    const dir = copyFolder();
    patchJson(dir, "glossary.json", (g) => { g.terms[0].en.term = SEQUENCE; });
    const c = loadFolder(dir);
    expect(c.terms.some((t) => t.id === term.id)).toBe(false);
    expect(c.hiddenTerms).toContainEqual({ first_finding: term.first_finding, codes: ["DUAL_USE"] });
    for (const b of c.briefs) {
      const chat = chatFor(c, b.date);
      const reply = renderReply(b, c, SITE);
      expect(chat, b.date).toContain(`term first used in ${term.first_finding} hidden: DUAL_USE in its name; a PR removes it`);
      for (const text of [chat, reply]) {
        expect(text, b.date).not.toContain(SEQUENCE);
        expect(text, b.date).not.toContain(term.id);
      }
    }
  });
});

// ── chatInputFor: choosing the format ────────────────────────────────────────────────────────────

describe("chatInputFor", () => {
  const content = sample();
  const D = picks().busiest.date;

  it("is published for a published_full or published_partial outcome whose brief loaded, with the notes in order", () => {
    const full = chatInputFor({ date: D, content, runs: [runRecord(D)], siteUrl: SITE });
    expect(full).toMatchObject({ kind: "published", dryRun: false });
    const partial = chatInputFor({ date: D, content, runs: [runRecord(D, { outcome: "published_partial", edition: "partial" })], siteUrl: SITE });
    expect(partial.kind).toBe("published");
  });

  it("is data-only for a published_data_only outcome and for a data-only brief", () => {
    const dataOnly = picks().dataOnly;
    const input = chatInputFor({
      date: dataOnly.date, content, siteUrl: SITE,
      runs: [runRecord(dataOnly.date, { outcome: "published_data_only", edition: "data_only", error_code: "E_AGENT" })],
    });
    expect(input).toMatchObject({ kind: "data_only", code: "E_AGENT", dryRun: false });
    const unstored = chatInputFor({ date: D, content, siteUrl: SITE, runs: [runRecord(D, { outcome: "published_data_only", edition: "data_only", error_code: "E_AGENT" })] });
    expect(unstored.kind).toBe("published");
  });

  it("is failed for a failed outcome even when a brief of that date is stored, and skipped for a skipped one", () => {
    expect(chatInputFor({ date: D, content, siteUrl: SITE, runs: [failedRun({ error_code: "E_AGENT" })] }).kind).toBe("failed");
    expect(chatInputFor({ date: D, content, siteUrl: SITE, runs: [runRecord(D, { outcome: "skipped" })] }).kind).toBe("skipped");
    expect(chatInputFor({ date: D, content, siteUrl: SITE, runs: [] }).kind).toBe("failed");
  });

  it("is a dry run when the source says so or a record does, and carries the flag into each format", () => {
    expect(chatInputFor({ date: D, content, siteUrl: SITE, runs: [runRecord(D)], dryRun: true })).toMatchObject({ kind: "published" });
    expect(chatInputFor({ date: D, content, siteUrl: SITE, runs: [runRecord(D, { trigger: "dry_run", outcome: "dry_run", edition: "full" })] })).toMatchObject({ kind: "published", dryRun: true });
    expect(chatInputFor({ date: D, content, siteUrl: SITE, runs: [runRecord(D, { outcome: "dry_run", edition: "full" })] })).toMatchObject({ kind: "published", dryRun: true });
    expect(chatInputFor({ date: D, content, siteUrl: SITE, runs: [failedRun({ trigger: "dry_run" })] })).toMatchObject({ kind: "failed", dryRun: true });
    expect(chatInputFor({ date: D, content, siteUrl: SITE, runs: [] , dryRun: true })).toMatchObject({ kind: "failed", dryRun: true });
  });

  it("does not change the content or the records it is given", () => {
    const runs = [runRecord(D), runRecord(D, { trigger: "retry" })];
    const before = JSON.stringify(runs);
    chatInputFor({ date: D, content, siteUrl: SITE, runs, notes: ["x"], unremovedSeeds: ["a.json"] });
    expect(JSON.stringify(runs)).toBe(before);
  });
});

// ── Purity ───────────────────────────────────────────────────────────────────────────────────────

describe("purity: no clock, no network, nothing changed, the same text each time", () => {
  it("renders every edition of the sample and its reply file from frozen inputs, twice the same", () => {
    const frozen = deepFreeze(copyOfSample());
    const before = JSON.stringify(frozen);
    for (const b of frozen.briefs) {
      const text = chatFor(frozen, b.date);
      expect(chatFor(frozen, b.date)).toBe(text);
      const reply = renderReply(b, frozen, SITE);
      expect(renderReply(b, frozen, SITE)).toBe(reply);
    }
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("renders the failed, skipped, data-only and dry-run formats of every code from frozen inputs, twice the same", () => {
    const frozen = deepFreeze(copyOfSample());
    for (const code of ERROR_CODES) {
      for (const trigger of ["schedule", "dry_run"] as const) {
        const runs = deepFreeze([runRecord(OTHER_DATE, { trigger, outcome: trigger === "dry_run" ? "dry_run" : "failed", edition: null, error_code: code })]);
        const issues = deepFreeze([{ code: "WORDS", path: "lead[0].text", severity: "error" as const, message: "text" }]);
        const once = renderChat(chatInputFor({ date: OTHER_DATE, content: frozen, runs, issues, siteUrl: SITE }), SITE);
        expect(renderChat(chatInputFor({ date: OTHER_DATE, content: frozen, runs, issues, siteUrl: SITE }), SITE)).toBe(once);
      }
    }
    const D = picks().dataOnly.date;
    const runs = deepFreeze(lastRunRecords(statusRuns(frozen, D)));
    expect(chatFor(frozen, D, { runs })).toBe(chatFor(frozen, D, { runs }));
  });
});

// ── The negative list, swept over every string of the content ──────────────────────────────────

describe("the negative list: only the fields §8.8 names reach the chat edition or the reply file", () => {
  const KINDS = ["briefs", "findings", "corrections", "reports", "terms"] as const;
  type Kind = (typeof KINDS)[number];
  type Leaf = { kind: Kind; index: number; path: (string | number)[] };

  /** Every string of the content, grouped by its path with each array index as `*`: "briefs.lead.*.text.en". */
  function groups(content: Content): Map<string, Leaf[]> {
    const found = new Map<string, Leaf[]>();
    const walk = (value: unknown, kind: Kind, index: number, path: (string | number)[]) => {
      if (typeof value === "string") {
        const key = [kind, ...path.map((p) => (typeof p === "number" ? "*" : p))].join(".");
        found.set(key, [...(found.get(key) ?? []), { kind, index, path }]);
      } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, kind, index, [...path, i]));
      else if (typeof value === "object" && value !== null) for (const [k, v] of Object.entries(value)) walk(v, kind, index, [...path, k]);
    };
    for (const kind of KINDS) (content[kind] as unknown[]).forEach((record, index) => walk(record, kind, index, []));
    return found;
  }

  /** The fields §8.8 lists for both files, and the ones only the reply file adds. Nothing else of the content is shown, and no `zh`. */
  const BOTH = [
    "briefs.corrections.*.type", "briefs.deep_dive.text.en", "briefs.items.*.update.en", "briefs.lead.*.text.en", "briefs.pace.sentence.en",
    "briefs.reports.*.status", "briefs.review.big_picture.en", "briefs.review.strongest_against.text.en", "findings.explainer.ai_helped.en",
    "findings.explainer.background.en", "findings.explainer.could_lead.en", "findings.explainer.found.en", "findings.explainer.how_sure.en",
    "findings.explainer.matters.en", "findings.title.en",
  ];
  const REPLY_ONLY = [
    "briefs.also.*.title.en", "briefs.corrections.*.reason.en", "briefs.date", "briefs.ideas.*.text.en", "findings.ai.systems.*.maker",
    "findings.rung_history.*.date", "findings.rung_history.*.note.en", "findings.since_then.*.date", "findings.since_then.*.text.en",
    "reports.reason.en", "terms.en.definition", "terms.en.term",
  ];

  it("prints a string of the content only when its field is on §8.8's list, whatever its text", () => {
    const base = copyOfSample();
    const inChat = new Set<string>();
    const inReply = new Set<string>();
    let n = 0;
    for (const [key, leaves] of groups(base)) {
      const marker = `ZQSWEEP${n++}X`;
      const c = structuredClone(base) as Content;
      for (const { kind, index, path } of leaves) {
        let record = (c[kind] as unknown[])[index] as Record<string | number, unknown>;
        for (const step of path.slice(0, -1)) record = record[step] as Record<string | number, unknown>;
        record[path[path.length - 1]!] = marker;
      }
      for (const b of c.briefs) {
        // A marker in a field the loader would have checked can leave a record unrenderable; that prints nothing, so it counts as not shown.
        try { if (chatFor(c, b.date).includes(marker)) inChat.add(key); } catch { /* not renderable */ }
        try { if (renderReply(b, c, SITE).includes(marker)) inReply.add(key); } catch { /* not renderable */ }
      }
    }
    expect(n).toBeGreaterThan(150);
    // Both lists are exact: a field printed that is not named fails, and so does a named field that no longer prints.
    expect([...inChat].sort()).toEqual([...BOTH].filter((k) => inChat.has(k)).sort());
    expect([...inReply].sort()).toEqual([...BOTH, ...REPLY_ONLY].filter((k) => inReply.has(k)).sort());
    expect(BOTH.filter((k) => !inChat.has(k) && !k.includes("ai.systems"))).toEqual([]);
    expect([...BOTH, ...REPLY_ONLY].filter((k) => !inReply.has(k))).toEqual([]);
  });
});

// ── scripts/chat.ts ──────────────────────────────────────────────────────────────────────────────

describe("npm run chat", () => {
  const content = sample();
  const { busiest, monday } = picks();

  function run(argv: string[], dir: string = SAMPLE_DIR) {
    const out: string[] = [];
    const err: string[] = [];
    const prev = process.env.UT_CONTENT_DIR;
    process.env.UT_CONTENT_DIR = dir;
    try {
      const io: Io = { out: (t) => out.push(t), err: (l) => err.push(l), root: ROOT };
      return { code: chatMain(argv, io), out: out.join(""), err };
    } finally {
      if (prev === undefined) delete process.env.UT_CONTENT_DIR;
      else process.env.UT_CONTENT_DIR = prev;
    }
  }

  it("reads the content folder and config/ from the root it is given, not from the working folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ut-chat-root-"));
    const prev = process.env.UT_CONTENT_DIR;
    try {
      fs.cpSync(SAMPLE_DIR, path.join(root, "content"), { recursive: true });
      fs.cpSync(path.join(ROOT, "config"), path.join(root, "config"), { recursive: true });
      process.env.UT_CONTENT_DIR = "content";
      const out: string[] = [];
      expect(chatMain(["--date", busiest.date], { out: (t) => out.push(t), err: () => {}, root })).toBe(0);
      expect(out.join("")).toBe(chatFor(content, busiest.date));
      // Without a config/ under that root there is nothing to load, whatever the working folder holds.
      fs.rmSync(path.join(root, "config"), { recursive: true });
      const err: string[] = [];
      expect(chatMain(["--date", busiest.date], { out: () => {}, err: (l) => err.push(l), root })).toBe(1);
      expect(err).toHaveLength(1);
      expect(err[0]).not.toContain("\n    at ");
    } finally {
      if (prev === undefined) delete process.env.UT_CONTENT_DIR;
      else process.env.UT_CONTENT_DIR = prev;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints a date's chat edition, the same as the library renders it, and exits 0", () => {
    const r = run(["--date", busiest.date]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(chatFor(content, busiest.date));
    checkChat(r.out, SITE, { cap: CHAT_MAX_LINES });
  });

  it("prints the reply file with --reply", () => {
    const r = run(["--reply", "--date", monday.date]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(renderReply(monday, content, SITE));
    expect(r.out).toBe(replyFromContent(content, monday.date, SITE));
  });

  it("exits 2 with the usage line for a missing, malformed or unknown argument", () => {
    for (const argv of [[], ["--date"], ["--date", "not-a-date"], ["--date", "2026-02-30"], ["--date", "2026-10-12", "--bogus"], ["2026-10-12"], ["--reply"], ["--date", ""]]) {
      const r = run(argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.err, argv.join(" ")).toEqual(["Usage: npm run chat -- --date YYYY-MM-DD [--reply]"]);
      expect(r.out).toBe("");
    }
  });

  it("exits 1 with a plain message for a date with no status file, or (with --reply) no brief", () => {
    const none = run(["--date", OTHER_DATE]);
    expect(none.code).toBe(1);
    expect(none.err.at(-1)).toBe(`No status file for ${OTHER_DATE} in ${path.resolve(ROOT, SAMPLE_DIR)}.`);
    const noBrief = run(["--date", OTHER_DATE, "--reply"]);
    expect(noBrief.code).toBe(1);
    expect(noBrief.err.at(-1)).toBe(`No brief for ${OTHER_DATE} in ${path.resolve(ROOT, SAMPLE_DIR)}.`);
    expect(noBrief.out).toBe("");
  });

  it("prints the failed format with BRIEF_LEFT_OUT when a published edition's brief is gone from the folder, and logs what the loader skipped", () => {
    const dir = copyFolder();
    const id = briefIn(copyOfSample(), busiest.date).story!.finding_id;
    patchJson(dir, `findings/${id}.json`, (f) => { f.explainer.found.en = `${f.explainer.found.en} ${SEQUENCE}`; });
    const r = run(["--date", busiest.date], dir);
    expect(r.code).toBe(0);
    expect(r.err.some((l) => l.includes(`findings/${id}.json`) && l.includes("DUAL_USE"))).toBe(true);
    expect(r.out).not.toContain(SEQUENCE);
    expect(r.out).not.toContain(id);
    fs.rmSync(path.join(dir, "briefs", `${busiest.date}.json`));
    const gone = run(["--date", busiest.date], dir);
    expect(gone.code).toBe(0);
    expect(gone.out).toContain(`What happened: ${BRIEF_LEFT_OUT.what}`);
    expect(run(["--date", busiest.date, "--reply"], dir).code).toBe(1);
  });

  it("newestEdition gives the newest brief on or before the date, or null", () => {
    const dates = content.briefs.map((b) => b.date);
    const oldest = content.briefs[0]!;
    const newest = content.briefs.at(-1)!;
    expect(newestEdition(content, "2000-01-01")).toBeNull();
    expect(newestEdition(content, oldest.date)).toEqual({ date: oldest.date, edition: oldest.edition });
    expect(newestEdition(content, "2999-01-01")).toEqual({ date: newest.date, edition: newest.edition });
    const second = content.briefs[1]!;
    const between = `${second.date.slice(0, 8)}${String(Number(second.date.slice(8)) + 0).padStart(2, "0")}`;
    expect(newestEdition(content, between)).toEqual({ date: second.date, edition: second.edition });
    expect(dates).toEqual([...dates].sort());
  });

  it("chatFromContent gives a failed day the edition the site carries, as its 'Site shows' line", () => {
    const c = copyOfSample();
    c.status = [...c.status, { schema_version: 1, date: OTHER_DATE, runs: [failedRun()] }];
    const shown = newestEdition(c, OTHER_DATE)!;
    expect(shown.date < OTHER_DATE).toBe(true);
    expect(lines(chatFromContent(c, OTHER_DATE, SITE))).toContain(`Site shows: the ${shown.date} ${shown.edition === "data_only" ? "data-only" : shown.edition} edition`);
    const bare = { ...c, briefs: [] };
    expect(lines(chatFromContent(bare, OTHER_DATE, SITE))).toContain("Site shows: no edition yet.");
  });

  it("chatFromContent and replyFromContent throw plain Errors when there is nothing to print", () => {
    expect(() => chatFromContent(content, OTHER_DATE, SITE)).toThrow(`No status file for ${OTHER_DATE} in ${content.dir}.`);
    expect(() => replyFromContent(content, OTHER_DATE, SITE)).toThrow(`No brief for ${OTHER_DATE} in ${content.dir}.`);
    const empty = copyOfSample();
    empty.status = empty.status.map((s) => (s.date === busiest.date ? { ...s, runs: [] } : s));
    expect(() => chatFromContent(empty, busiest.date, SITE)).toThrow(`status/${busiest.date}.json holds no run record.`);
  });

  it("works as a script: standard output carries the text, the exit code is 0, and a usage error exits 2", () => {
    const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const spawn = (args: string[]) => spawnSync(process.execPath, [tsx, path.join(ROOT, "scripts", "chat.ts"), ...args], {
      cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: SAMPLE_DIR },
    });
    const ok = spawn(["--date", busiest.date]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe(chatFor(content, busiest.date));
    const bad = spawn(["--date", "nope"]);
    expect(bad.status).toBe(2);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toBe("Usage: npm run chat -- --date YYYY-MM-DD [--reply]\n");
    const none = spawn(["--date", OTHER_DATE]);
    expect(none.status).toBe(1);
  }, 120_000);
});
