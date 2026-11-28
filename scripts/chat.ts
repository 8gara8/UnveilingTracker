// npm run chat -- --date D [--reply]: prints D's chat edition from the content folder alone (SPEC §8.8, §10 P1 step 6). It loads the
// folder as the site does (`loadContent()`, §6), reads the last run's records in status/D.json (the last schedule, manual or dry_run
// record and any retry after it), rebuilds every note from them through `chatInputFor()`, the same function daily.ts calls at finish,
// and prints `renderChat()`'s text. It equals logs/D.summary.md except "status not saved", the seed notes and, for a failed run, the
// paths in First errors (the status file keeps codes only). With --reply it prints the reply file, `renderReply()`'s text for D's
// committed brief, which equals logs/D.reply.md.
//
//   tsx scripts/chat.ts --date YYYY-MM-DD [--reply]
//
// The content folder is `contentDir()`: UT_CONTENT_DIR, else run.json paths.content_dir, read from the working folder (or `io.root`).
// Exit 0 printed, 1 no status file (or, with --reply, no brief) for D, or a folder that cannot be loaded, 2 usage. Nothing is written
// anywhere but standard output and standard error; the lines `loadContent()` prints for what it skipped go to standard error.
//
// Cyber's scripts/chat.ts at the fork commit 3ced1fb, adapted: the `--date` form, `newestEdition()` for the failed format's "Site
// shows" line, the exit codes and the `isMain` guard are Cyber's pattern. The `Io` seam (`main()` returns the exit code and never exits,
// a test passes its own `out`, `err` and root, as scripts/validate.ts does), `--reply`, and the read through `loadContent()` instead of
// a file by file read with Cyber's schemas are this project's: the brief, the findings, the terms and the reports reach the renderers
// exactly as the site gets them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chatInputFor, lastRunRecords, renderChat, renderReply } from "../lib/chat";
import { loadConfig } from "../lib/config";
import { loadContent, type Content } from "../lib/content";
import { isValidDate } from "../lib/dates";
import type { Edition } from "../lib/schema/common";
import { contentDir, siteUrl } from "../lib/site";

/** Where the text goes: `out` takes the text as it is (it ends in its own newline), `err` one line. */
export interface Io {
  out: (text: string) => void;
  err: (line: string) => void;
  /** The repository root the content folder and `config/` are read from; default the working directory. */
  root?: string;
}

const DEFAULT_IO: Io = { out: (text) => process.stdout.write(text), err: (line) => process.stderr.write(`${line}\n`) };

const USAGE = "Usage: npm run chat -- --date YYYY-MM-DD [--reply]";

/** The newest loaded brief dated on or before `date`: what the site shows for the failed format's "Site shows" line. Null when none. */
export function newestEdition(content: Pick<Content, "briefs">, date: string): { date: string; edition: Edition } | null {
  const dated = content.briefs.filter((b) => b.date <= date);
  const newest = dated.at(-1);
  return newest === undefined ? null : { date: newest.date, edition: newest.edition };
}

/** D's chat edition from the loaded content. Throws an Error with a plain message when it can't. */
export function chatFromContent(content: Content, date: string, site: string = siteUrl()): string {
  const status = content.status.find((s) => s.date === date);
  if (status === undefined) throw new Error(`No status file for ${date} in ${content.dir}.`);
  const runs = lastRunRecords(status.runs);
  if (!runs.length) throw new Error(`status/${date}.json holds no run record.`);
  return renderChat(chatInputFor({ date, content, runs, siteShows: newestEdition(content, date), siteUrl: site }), site);
}

/** D's reply file from the loaded content. Throws an Error with a plain message when D has no brief. */
export function replyFromContent(content: Content, date: string, site: string = siteUrl()): string {
  const brief = content.briefs.find((b) => b.date === date);
  if (brief === undefined) throw new Error(`No brief for ${date} in ${content.dir}.`);
  return renderReply(brief, content, site);
}

/** The command. Returns the exit code and never exits: 0 printed, 1 nothing to print, 2 usage. */
export function main(argv: string[] = process.argv.slice(2), io: Io = DEFAULT_IO): number {
  let date: string | undefined;
  let reply = false;
  try {
    const { values } = parseArgs({ args: argv, options: { date: { type: "string" }, reply: { type: "boolean" } }, strict: true });
    date = values.date;
    reply = values.reply === true;
  } catch {
    date = undefined;
  }
  if (!date || !isValidDate(date)) {
    io.err(USAGE);
    return 2;
  }
  try {
    const root = path.resolve(io.root ?? process.cwd());
    const content = loadContent(path.resolve(root, contentDir()), { fresh: true, config: loadConfig(path.join(root, "config")), log: io.err });
    io.out(reply ? replyFromContent(content, date) : chatFromContent(content, date));
    return 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** True when this file is the script that was started, not one that imported it: the two are compared by their real paths. */
function startedAsScript(): boolean {
  const started = process.argv[1];
  if (started === undefined) return false;
  try {
    return fs.realpathSync(started) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedAsScript()) process.exitCode = main();
