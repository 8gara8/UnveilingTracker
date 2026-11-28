// A small, strict CSV reader for the Retraction Watch data file (SPEC §4.13 `retraction-watch`, parser `csv`;
// §5.7's counter and §5.8's Monday match read it). Pure: text in, rows out. It reads RFC 4180's form: comma
// separated, a field may be quoted, a quote inside a quoted field is doubled, a quoted field may hold commas
// and line breaks, a record ends at LF or CRLF, and a byte order mark in front of the header is dropped. It
// refuses what that form does not allow rather than guessing: a quote inside an unquoted field, text after a
// closing quote, a quoted field that never closes, a bare carriage return, a record whose field count is not the
// header's, a blank line, an empty or repeated header name (see below for the one exception), and a text over
// the size guard. Every refusal is a FeedParseError that names the line. The first record is the header; each
// later one comes back as an object by header name. Every value is raw feed data and stays a string.
//
// The one exception, found on the real file (Kobol's K1d): the Retraction Watch file ends its header and every
// record with a comma, which makes a 21st column with no name and no value. A header may therefore end in ONE
// empty name. That column is not returned in `header` or in any row, but each record must still carry it (the
// field count is the header's full width); an empty name anywhere else is still refused.
//
// New in this project (no Cyber source); the header and the guard are this project's, the form is RFC 4180's.

import { FEED_MAX_BYTES } from "./http";
import { FeedParseError } from "./types";

export interface CsvOptions {
  /** The most bytes of text read; a larger one is refused before any parsing. Default: the Retraction Watch cap of `FEED_MAX_BYTES`. */
  maxBytes?: number;
  /** Keep only these columns in each row (the others are read and dropped, which keeps a large file small); each must be in the header. */
  columns?: readonly string[];
}

export interface CsvTable {
  /** The header's names, in file order (all of them, whatever `columns` keeps, but not a trailing column with no name). */
  header: string[];
  /** One object for each record after the header, by header name; its keys are `columns` when that was given, else the whole header. */
  rows: Record<string, string>[];
}

/** The end of an unquoted field: the next comma or line break. A global regex, so that `lastIndex` sets where each search starts. */
const FIELD_END = /[,\n\r]/g;

function fail(message: string): never {
  throw new FeedParseError("parse", `CSV: ${message}`);
}

/**
 * Reads `input` (text, or a body read as UTF-8) as CSV. Throws a FeedParseError: `empty` for no record at all,
 * `schema` for a requested column that the header lacks, `parse` for malformed text or one over `maxBytes`.
 */
export function parseCsv(input: string | Buffer, options: CsvOptions = {}): CsvTable {
  const maxBytes = options.maxBytes ?? FEED_MAX_BYTES.retractionWatch;
  const size = typeof input === "string" ? Buffer.byteLength(input) : input.length;
  if (size > maxBytes) fail(`${size} bytes is over the limit of ${maxBytes}`);
  let text = typeof input === "string" ? input : input.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const n = text.length;
  const records: { fields: string[]; line: number }[] = [];
  let pos = 0;
  let line = 1;
  while (pos < n) {
    const fields: string[] = [];
    const startLine = line;
    for (;;) {
      if (text[pos] === '"') {
        let value = "";
        pos += 1;
        for (;;) {
          const close = text.indexOf('"', pos);
          if (close === -1) fail(`the quoted field that starts on line ${startLine} never closes`);
          const chunk = text.slice(pos, close);
          if (chunk.includes("\n")) line += chunk.split("\n").length - 1;
          value += chunk;
          if (text[close + 1] === '"') {
            value += '"';
            pos = close + 2;
            continue;
          }
          pos = close + 1;
          break;
        }
        fields.push(value);
        const after = text[pos];
        if (after !== undefined && after !== "," && after !== "\n" && after !== "\r") fail(`text follows a closing quote on line ${line}`);
      } else {
        FIELD_END.lastIndex = pos;
        const end = FIELD_END.exec(text)?.index ?? n;
        const value = text.slice(pos, end);
        if (value.includes('"')) fail(`a quote inside an unquoted field on line ${line}`);
        fields.push(value);
        pos = end;
      }
      const sep = text[pos];
      if (sep === ",") {
        pos += 1;
        continue;
      }
      if (sep === "\r") {
        if (text[pos + 1] !== "\n") fail(`a carriage return without a line feed on line ${line}`);
        pos += 2;
        line += 1;
      } else if (sep === "\n") {
        pos += 1;
        line += 1;
      }
      break;
    }
    records.push({ fields, line: startLine });
  }
  const head = records.shift();
  if (!head) throw new FeedParseError("empty", "CSV: no header");
  // A header that ends in a comma has one last column with no name (the Retraction Watch file's): it is read, not returned.
  const width = head.fields.length;
  const header = width > 1 && head.fields[width - 1] === "" ? head.fields.slice(0, -1) : head.fields;
  header.forEach((name, i) => {
    if (name === "") fail(`column ${i + 1} of the header has no name`);
    if (header.indexOf(name) !== i) fail(`the header names "${name}" twice`);
  });
  const keep = options.columns ?? header;
  for (const name of keep) {
    if (!header.includes(name)) throw new FeedParseError("schema", `CSV: the header has no column "${name}"`);
  }
  const at = keep.map((name) => header.indexOf(name));
  const rows = records.map((r) => {
    if (r.fields.length !== width) fail(`line ${r.line} has ${r.fields.length} fields, the header has ${width}`);
    const row: Record<string, string> = Object.create(null) as Record<string, string>;
    keep.forEach((name, k) => {
      row[name] = r.fields[at[k]!]!;
    });
    return row;
  });
  return { header, rows };
}
