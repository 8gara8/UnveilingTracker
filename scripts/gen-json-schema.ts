// Writes routine/schema/draft-brief.schema.json and routine/schema/draft-zh.schema.json from the Zod DraftBrief and
// DraftZh schemas (SPEC §4.1, §8.1, §10 P1 item 4). `--check` exits 1 when a committed file is stale or missing and
// never writes (CI runs it as `npm run schema:check`). Exit 0 written or current, 1 a stale or missing file or a line
// too long for the agents' reader, 2 usage. The paths are relative to the working directory: run it from the
// repository root, as npm does.
//
// Cyber's scripts/gen-json-schema.ts at the fork commit 3ced1fb, adapted: both files, and a usage error for an
// argument it does not know, since a mistyped `--check` must never write.

import fs from "node:fs";
import path from "node:path";
import { SCHEMA_FILES, SCHEMA_LINE_LIMIT, schemaFileStats } from "../lib/json-schema";

const USAGE = "Usage: tsx scripts/gen-json-schema.ts [--check]";

const facts = (text: string): string => {
  const stats = schemaFileStats(text);
  return `${stats.bytes} bytes, ${stats.lines} lines, longest line ${stats.longestLine} characters`;
};

function main(args: string[]): number {
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    console.error(`Unknown argument ${unknown[0]}. ${USAGE}`);
    return 2;
  }
  const files = SCHEMA_FILES.map((f) => ({ path: f.path, text: f.render() }));

  // A line the agents' reader would cut is a fault in the schema, so nothing is written or passed.
  const tooLong = files.flatMap((f) => {
    const stats = schemaFileStats(f.text);
    return stats.longestLine >= SCHEMA_LINE_LIMIT
      ? [`Line ${stats.longestLineNo} of ${f.path} has ${stats.longestLine} characters; the limit is under ${SCHEMA_LINE_LIMIT}.`]
      : [];
  });
  if (tooLong.length > 0) {
    for (const message of tooLong) console.error(message);
    return 1;
  }

  if (args.includes("--check")) {
    const problems = files.flatMap((f) => {
      if (!fs.existsSync(f.path)) return [`${f.path} is missing; run npm run schema:gen and commit the result.`];
      return fs.readFileSync(f.path, "utf8") === f.text ? [] : [`${f.path} is stale; run npm run schema:gen and commit the result.`];
    });
    if (problems.length > 0) {
      for (const message of problems) console.error(message);
      return 1;
    }
    for (const f of files) console.log(`${f.path} is current (${facts(f.text)}).`);
    return 0;
  }

  for (const f of files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, f.text);
    console.log(`Wrote ${f.path} (${facts(f.text)}).`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
