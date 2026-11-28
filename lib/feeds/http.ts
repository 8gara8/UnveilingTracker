import fs from "node:fs";
import path from "node:path";

// The fetch harness (SPEC §4.13 "Rate limits", §8.3): the only HTTP call in collect, the snapshot fetcher,
// the OpenAlex client and the link check (git reads go through scripts/lib/git-source.ts). GET only, at most 5
// redirects (https only after the first hop), one retry after 2 s on a timeout, a network error or a 5xx, a
// body cap (or a cut at the cap with `truncate`), an optional deadline, and errors reduced to a class. With
// UT_FIXTURE_FEEDS set, every URL is answered from <dir>/index.json and an unknown URL is a `dns` error.
// Collect runs requests through pool() (8 feeds, 16 per-id records at a time) under one fetchBudget() (240 s
// from the first request).
//
// Rate limits (§4.13): a host that limits how fast one client may ask has ONE queue in this file, which every
// request to it joins, a retry and every redirect hop included, whatever the stage or `pool()` slot that sends
// it. arXiv's two hosts share one queue, Crossref's API one, E-utilities one and OpenAlex one (RATE_RULES).
// Fixture mode answers before any queue is joined, so it never waits. The queues read the time and wait through
// an injectable clock (`setHttpClock`) and are emptied by `resetRateQueues`, so tests/http.test.ts can prove the
// spacing with a fake clock and no real waiting.
//
// Cyber's lib/feeds/http.ts at the fork commit 3ced1fb, adapted: the variable is UT_FIXTURE_FEEDS; the
// timeout and body-cap tables hold only this project's keys (Cyber's domain parts are gone); the queues,
// the clock and `rateQueueOf()` are new; a request's timeout now starts once its host's queue has let it go,
// so time spent waiting in a queue never counts against it (the deadline still does); the retry delay and
// every duration read the same clock; only 301, 302, 303, 307 and 308 are redirects (Cyber's took any 3xx);
// `userAgent()` falls back to this project's name; a result's `finalUrl` and `detail` never carry an `api_key`
// query parameter (`withoutApiKey()`, because the OpenAlex client sends its key in the URL); and a timeout is
// clamped to what `AbortSignal.timeout` accepts.

export type FetchErrorClass = "timeout" | "dns" | "tls" | `http_${number}` | "too_large" | "redirects" | "network" | "parse" | "schema" | "empty";

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  /** Sent as Accept-Language only when set (snapshots send a browser-like one, §4.12). Fixture mode ignores headers. */
  acceptLanguage?: string;
  userAgent?: string;
  /** Retry once after this delay on a timeout, network error or 5xx. 0 turns the retry off. */
  retryDelayMs?: number;
  /** A body over `maxBytes` is cut there instead of failing `too_large` (snapshots and the link check, §8.3). */
  truncate?: boolean;
  /** Epoch ms: each attempt's timeout is min(timeoutMs, deadline − now), and no attempt starts past it (`timeout`). */
  deadline?: number;
  /**
   * Asked about every redirect target before it is requested: a reason ends the fetch with `redirects` and that
   * hop is never requested. The snapshot fetcher and the link check pass the blocked-host test, so a page that
   * redirects into a BLOCKED_HOSTS host is not read (§4.12 step 1). Fixture mode has no redirects.
   */
  refuseRedirect?: (url: string) => string | null;
}

export interface FetchResult {
  ok: boolean;
  status: number | null;
  /** The URL that answered, after redirects. */
  finalUrl: string;
  body: Buffer | null;
  contentType: string | null;
  error: FetchErrorClass | null;
  /** The raw error message: for logs only, never for a status file or a report. */
  detail: string | null;
  durationMs: number;
  attempts: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Per-request timeouts (§8.3): 15 s by default. Larger ones only where a feed needs it:
 * - `arxivList`: arXiv's API answers a query for a whole announcement's list (hundreds of entries) slowly.
 * - `retractionWatch`: the Retraction Watch file is one large download. Provisional; Kobol confirms (§4.13).
 */
export const FEED_TIMEOUTS = { default: 15_000, arxivList: 45_000, retractionWatch: 90_000 } as const;

/**
 * Body caps (§8.3): 5 MB by default (§5.1's `select` keeps OpenAlex answers far under it). Larger ones only
 * where a feed needs it:
 * - `arxivList`: a Monday list (three days of submissions and cross-lists) of a large category can run to a few
 *   thousand entries of 2 to 4 KB each. Provisional; Kobol measures the largest list (§4.13).
 * - `retractionWatch`: the Retraction Watch data file is tens of megabytes. Provisional; Kobol confirms its
 *   size and this cap is set to what it reports (§4.13).
 */
export const FEED_MAX_BYTES = { default: 5 * 1024 * 1024, arxivList: 10 * 1024 * 1024, retractionWatch: 128 * 1024 * 1024 } as const;

const MAX_REDIRECTS = 5;

/** The statuses that mean "go to the Location" (RFC 9110): 300, 304, 305 and 306 are not redirects, so they are errors like any other non-2xx. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** The name sent when config/run.json cannot be read or has no `user_agent`. */
export const FALLBACK_USER_AGENT = "UnveilingTracker/1.0";

const userAgents = new Map<string, string>();

/** run.json `user_agent` under `root` (the working directory by default), read once for each root. */
export function userAgent(root: string = process.cwd()): string {
  const known = userAgents.get(root);
  if (known !== undefined) return known;
  let agent = FALLBACK_USER_AGENT;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "config", "run.json"), "utf8")) as { user_agent?: unknown };
    if (typeof cfg.user_agent === "string" && cfg.user_agent.trim() !== "") agent = cfg.user_agent;
  } catch {
    // An unreadable or malformed run.json leaves the fallback; the config loader reports it in its own place.
  }
  userAgents.set(root, agent);
  return agent;
}

/** The `api_key` query parameter, with the `?` or `&` before it and the `&` after it. */
const API_KEY_PARAM = /([?&])api_key=[^&#\s]*&?/gi;

/**
 * `text` with every `api_key=...` query parameter taken out (`?api_key=K&a=1` is `?a=1`, `?a=1&api_key=K` is
 * `?a=1`). The OpenAlex client sends its key in the URL (§9.6), so a result that repeats a URL, or an error
 * message that quotes one, must not carry it: `fetchFeed()` passes `finalUrl` and `detail` through this, so no
 * log, status file or cache entry built from a result can hold a key. Text without one is returned as it was.
 */
export function withoutApiKey(text: string): string {
  if (!/api_key=/i.test(text)) return text;
  return text.replace(API_KEY_PARAM, "$1").replace(/[?&](?=[#\s]|$)/g, "");
}

/** The same result with its URL and message cleaned by `withoutApiKey()`. */
function cleaned(r: FetchResult): FetchResult {
  return { ...r, finalUrl: withoutApiKey(r.finalUrl), detail: r.detail === null ? null : withoutApiKey(r.detail) };
}

/** The largest delay `AbortSignal.timeout` takes (a 32-bit count of ms is its limit; this is 24 days, which no request here needs). */
const MAX_SIGNAL_MS = 2_147_483_647;

/** Reduces a thrown fetch error to a class (SPEC §8.3). */
export function classifyError(e: unknown): FetchErrorClass {
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string; message?: string }; message?: string };
  const code = err.cause?.code ?? err.code ?? "";
  const msg = `${err.message ?? ""} ${err.cause?.message ?? ""}`;
  if (err.name === "TimeoutError" || err.name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return "timeout";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (/CERT|SSL|TLS/i.test(code) || /certificate|tls|ssl/i.test(msg)) return "tls";
  return "network";
}

// ── The clock ────────────────────────────────────────────────────────────────────────────────────

/** What the queues, the retry delay and the durations read: the time in epoch ms, and a wait. */
export interface HttpClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_CLOCK: HttpClock = { now: () => Date.now(), sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
let clock: HttpClock = REAL_CLOCK;

/**
 * Installs a clock (tests install a fake one); `null` puts the real one back. The clock reads every time this
 * file reads: queue waits, the retry delay, durations and the deadline test. `AbortSignal.timeout` stays real.
 */
export function setHttpClock(next: HttpClock | null): void {
  clock = next ?? REAL_CLOCK;
}

// ── One queue for each rate-limited host (§4.13 "Rate limits") ───────────────────────────────────

interface RateRule {
  /** The queue's name: every host of the rule shares it. */
  queue: string;
  /** Lower-case host names (no trailing dot) that join the queue. */
  hosts: readonly string[];
  /** One request at a time: the next waits for the one in front to end. */
  serial: boolean;
  /** At least this long from the end of a request to the start of the next (a serial queue's rule; default none). */
  afterEndMs?: number;
  /** The spacing class of a URL and the least time between the starts of two requests of that class, or null. */
  spacing(url: URL): { key: string; ms: number } | null;
}

/** Crossref's single-record form `works/<doi>` (with or without a version prefix); a list or filter is `works?...`. */
const CROSSREF_RECORD_PATH = /^\/(?:v\d+\/)?works\/.+/;

const RATE_RULES: readonly RateRule[] = [
  // arXiv's API terms: one request at a time, each starting at least 3 s after the previous one ended. The API
  // and the listing feeds are one service, so they share one queue.
  { queue: "arxiv", hosts: ["export.arxiv.org", "rss.arxiv.org"], serial: true, afterEndMs: 3_000, spacing: () => null },
  // Crossref's public pool: one request at a time; a query or filter at most one a second, a record 5 a second.
  {
    queue: "crossref", hosts: ["api.crossref.org"], serial: true,
    spacing: (u) => (CROSSREF_RECORD_PATH.test(u.pathname) ? { key: "record", ms: 200 } : { key: "query", ms: 1_000 }),
  },
  // NCBI without a key: at most 3 requests a second (starts 334 ms apart keep any second to 3).
  { queue: "eutils", hosts: ["eutils.ncbi.nlm.nih.gov"], serial: false, spacing: () => ({ key: "all", ms: 334 }) },
  // OpenAlex (§5.1): one request a second.
  { queue: "openalex", hosts: ["api.openalex.org"], serial: false, spacing: () => ({ key: "all", ms: 1_000 }) },
];

function ruleOf(url: URL): RateRule | null {
  const host = url.hostname.replace(/\.$/, ""); // URL has lower-cased it already
  return RATE_RULES.find((r) => r.hosts.includes(host)) ?? null;
}

/** The queue a request to `url` joins ("arxiv", "crossref", "eutils" or "openalex"), or null for a host with no queue. */
export function rateQueueOf(url: string): string | null {
  try {
    return ruleOf(new URL(url))?.queue ?? null;
  } catch {
    return null;
  }
}

interface QueueState {
  /** Serial queues: settles when the request in front has ended. */
  tail: Promise<void>;
  /** When the last request of a serial queue ended. */
  lastEnd: number;
  /** For each spacing class: the earliest the next request of that class may start. */
  nextStart: Map<string, number>;
}

const queues = new Map<string, QueueState>();

/** Forgets every queue, so the next request to a host waits for nothing (tests; a process starts with none). */
export function resetRateQueues(): void {
  queues.clear();
}

function queueState(name: string): QueueState {
  let q = queues.get(name);
  if (!q) {
    q = { tail: Promise.resolve(), lastEnd: Number.NEGATIVE_INFINITY, nextStart: new Map() };
    queues.set(name, q);
  }
  return q;
}

/** Waits until the clock reads `t`, or `limit` (the caller's deadline) if that comes first; a wait that wakes early is repeated, so no request starts before its time. */
async function sleepUntil(t: number, limit: number): Promise<void> {
  const until = Math.min(t, limit);
  for (let left = until - clock.now(); left > 0; left = until - clock.now()) await clock.sleep(left);
}

/** A turn at a host's queue: `done()` says the request has ended (or was never made); call it once. */
interface Turn {
  done(): void;
}

const NO_TURN: Turn = { done: () => {} };

/**
 * Takes a turn at the queue of `url`'s host, waiting for it; a host with no queue gets a turn at once. Turns are
 * handed out in the order they are asked for. A serial queue (arXiv, Crossref) holds the turn until `done()`,
 * and the next request starts no sooner than its rule says after that end and after the start of the last
 * request of its class; a spaced queue (E-utilities, OpenAlex) only spaces the starts. Returns null when the
 * deadline passed before the turn came: nothing was requested, and a serial queue's next waiter goes on.
 */
async function takeTurn(url: string, deadline: number | undefined): Promise<Turn | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NO_TURN; // fetch reports a malformed URL itself
  }
  const rule = ruleOf(parsed);
  if (!rule) return NO_TURN;
  const q = queueState(rule.queue);
  const spacing = rule.spacing(parsed);
  const limit = deadline ?? Number.POSITIVE_INFINITY;
  const late = () => clock.now() >= limit;
  if (!rule.serial) {
    // Reserved before any wait, so callers start in the order they asked.
    const start = Math.max(clock.now(), spacing ? q.nextStart.get(spacing.key) ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY);
    if (spacing) q.nextStart.set(spacing.key, start + spacing.ms);
    await sleepUntil(start, limit);
    return late() ? null : NO_TURN;
  }
  const front = q.tail;
  let release!: () => void;
  q.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await front;
  if (late()) {
    release();
    return null;
  }
  const ready = Math.max(q.lastEnd + (rule.afterEndMs ?? 0), spacing ? q.nextStart.get(spacing.key) ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY);
  await sleepUntil(ready, limit);
  if (late()) {
    release();
    return null;
  }
  if (spacing) q.nextStart.set(spacing.key, clock.now() + spacing.ms);
  return {
    done() {
      q.lastEnd = clock.now();
      release();
    },
  };
}

// ── Fixture mode ─────────────────────────────────────────────────────────────────────────────────

interface FixtureEntry { status?: number; file?: string; content_type?: string; error?: FetchErrorClass }

/**
 * A saved answer from `<dir>/index.json`. The body cap applies as it does live (`too_large`, or a cut with
 * `truncate`). The deadline does not: a saved file answers at once, and tests drive time with their own clock.
 */
function fromFixtures(dir: string, url: string, started: number, opts: FetchOptions): FetchResult {
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as Record<string, FixtureEntry>;
  const entry = index[url];
  const base = { finalUrl: url, durationMs: clock.now() - started, attempts: 1 };
  if (!entry) return { ...base, ok: false, status: null, body: null, contentType: null, error: "dns", detail: "not in fixture index" };
  if (entry.error) return { ...base, ok: false, status: null, body: null, contentType: null, error: entry.error, detail: "fixture error" };
  const status = entry.status ?? 200;
  const contentType = entry.content_type ?? null;
  const ok = status >= 200 && status < 300;
  if (!ok) return { ...base, ok, status, body: null, contentType, error: `http_${status}`, detail: null };
  let body = entry.file ? fs.readFileSync(path.join(dir, entry.file)) : Buffer.alloc(0);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (body.length > maxBytes) {
    if (!opts.truncate) return { ...base, ok: false, status, body: null, contentType, error: "too_large", detail: null };
    body = body.subarray(0, maxBytes);
  }
  return { ...base, ok, status, body, contentType, error: null, detail: null };
}

// ── One request ──────────────────────────────────────────────────────────────────────────────────

/** The body, at most `maxBytes`: "too_large" past it, or cut there when `truncate` is set. */
async function readCapped(res: Response, maxBytes: number, truncate: boolean): Promise<Buffer | "too_large"> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes && !truncate) return "too_large";
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      size += value.length;
      if (size > maxBytes) {
        if (!truncate) return "too_large";
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

type Attempt = Omit<FetchResult, "attempts" | "durationMs">;
type Options = Required<Pick<FetchOptions, "timeoutMs" | "maxBytes">> & FetchOptions;
/** One HTTP request's outcome: an answer to return, or a redirect to follow. */
type Hop = { answer: Attempt } | { redirect: string };

const timedOut = (url: string, detail: string): Attempt =>
  ({ ok: false, status: null, finalUrl: url, body: null, contentType: null, error: "timeout", detail });

/** One request to `current`, its body read; a redirect status with a Location comes back as the target to follow. */
async function hopOnce(current: string, opts: Options, signal: AbortSignal): Promise<Hop> {
  let res: Response;
  try {
    res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": opts.userAgent ?? userAgent(),
        Accept: opts.accept ?? "*/*",
        ...(opts.acceptLanguage ? { "Accept-Language": opts.acceptLanguage } : {}),
      },
    });
  } catch (e) {
    return { answer: { ok: false, status: null, finalUrl: current, body: null, contentType: null, error: classifyError(e), detail: String((e as Error).cause ?? (e as Error).message).slice(0, 300) } };
  }
  if (REDIRECT_STATUSES.has(res.status) && res.headers.get("location")) {
    await res.body?.cancel().catch(() => {});
    let next: string;
    try {
      next = new URL(res.headers.get("location")!, current).toString();
    } catch {
      return { answer: { ok: false, status: res.status, finalUrl: current, body: null, contentType: null, error: "redirects", detail: "a redirect with an invalid Location" } };
    }
    const refused = opts.refuseRedirect?.(next) ?? null;
    if (refused !== null) {
      return { answer: { ok: false, status: res.status, finalUrl: next, body: null, contentType: null, error: "redirects", detail: `a redirect to a refused URL (${refused})` } };
    }
    return { redirect: next };
  }
  const contentType = res.headers.get("content-type");
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel().catch(() => {});
    return { answer: { ok: false, status: res.status, finalUrl: current, body: null, contentType, error: `http_${res.status}`, detail: null } };
  }
  let body: Buffer | "too_large";
  try {
    body = await readCapped(res, opts.maxBytes, opts.truncate === true);
  } catch (e) {
    return { answer: { ok: false, status: res.status, finalUrl: current, body: null, contentType, error: classifyError(e), detail: String((e as Error).message).slice(0, 300) } };
  }
  if (body === "too_large") return { answer: { ok: false, status: res.status, finalUrl: current, body: null, contentType, error: "too_large", detail: null } };
  return { answer: { ok: true, status: res.status, finalUrl: current, body, contentType, error: null, detail: null } };
}

/**
 * One attempt: the request and its redirect hops. Each hop is a request of its own, so each takes a turn at its
 * host's queue (the turn ends when the hop's body has been read or dropped) and is timed from the moment the turn
 * comes: an attempt's requests share `timeoutMs`, and the wait in a queue is not part of it. `deadline` is
 * absolute, so waiting in a queue does count against it.
 */
async function once(url: string, opts: Options): Promise<Attempt> {
  let current = url;
  let spent = 0;
  const untilDeadline = () => (opts.deadline === undefined ? Number.POSITIVE_INFINITY : opts.deadline - clock.now());
  if (untilDeadline() <= 0) return timedOut(url, "deadline passed before the request");
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (hop > 0 && !current.startsWith("https:")) {
      return { ok: false, status: null, finalUrl: current, body: null, contentType: null, error: "redirects", detail: "redirect to a non-https URL" };
    }
    const turn = await takeTurn(current, opts.deadline);
    if (turn === null) return timedOut(current, "deadline passed while waiting for its turn");
    try {
      const left = Math.min(opts.timeoutMs - spent, untilDeadline());
      if (left <= 0) return timedOut(current, "no time left for the request");
      const began = clock.now();
      // AbortSignal.timeout throws on a fraction, on Infinity and on a count past 32 bits, so the time is rounded up and capped.
      const step = await hopOnce(current, opts, AbortSignal.timeout(Math.min(Math.ceil(left), MAX_SIGNAL_MS)));
      spent += clock.now() - began;
      if ("answer" in step) return step.answer;
      current = step.redirect;
    } finally {
      turn.done();
    }
  }
  return { ok: false, status: null, finalUrl: current, body: null, contentType: null, error: "redirects", detail: `more than ${MAX_REDIRECTS} redirects` };
}

function retryable(r: Attempt): boolean {
  if (r.ok) return false;
  if (r.error === "timeout" || r.error === "network") return true;
  return r.status !== null && r.status >= 500;
}

/**
 * One GET with SPEC §8.3's rules. Never throws. With `deadline`, no attempt starts past it (a first attempt
 * that cannot start is `timeout`, attempts 0) and the retry is skipped when its delay would cross it. A
 * request to a host with a queue (§4.13) waits its turn, the retry included.
 */
export async function fetchFeed(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const started = clock.now();
  let attempts = 0;
  try {
    const fixtures = process.env.UT_FIXTURE_FEEDS;
    if (fixtures) return cleaned(fromFixtures(fixtures, url, started, options));
    const opts = { timeoutMs: DEFAULT_TIMEOUT_MS, maxBytes: DEFAULT_MAX_BYTES, retryDelayMs: 2_000, ...options };
    if (opts.deadline !== undefined && clock.now() >= opts.deadline) {
      return cleaned({ ...timedOut(url, "deadline passed before the request"), attempts, durationMs: clock.now() - started });
    }
    attempts = 1;
    let r = await once(url, opts);
    const retryAt = clock.now() + opts.retryDelayMs;
    if (retryable(r) && opts.retryDelayMs > 0 && (opts.deadline === undefined || retryAt < opts.deadline)) {
      await clock.sleep(opts.retryDelayMs);
      attempts = 2;
      r = await once(url, opts);
    }
    return cleaned({ ...r, attempts, durationMs: clock.now() - started });
  } catch (e) {
    // Anything once() did not foresee (a bad option, an unreadable fixture index) is still a result.
    return cleaned({ ok: false, status: null, finalUrl: url, body: null, contentType: null, error: "network", detail: String((e as Error).message).slice(0, 300), attempts, durationMs: clock.now() - started });
  }
}

// ── The harness pieces collect needs (§8.3: 8 feeds at a time, the per-id pool 16, a 240 s total cap) ──

/**
 * Runs `fn` over `items` with at most `limit` (at least 1) in flight; results in input order. When a call
 * throws, no further item starts, the calls in flight finish, and the first error is thrown.
 */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  const width = Math.min(Math.max(1, Math.floor(limit) || 1), items.length);
  let next = 0;
  let failed = false;
  let firstError: unknown = null;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (e) {
        if (!failed) firstError = e;
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  if (failed) throw firstError;
  return out;
}

/** The shared 240 s cap: the clock starts at the first request (begin), and deadline() is begin + capMs. */
export interface FetchBudget {
  readonly started: number | null;
  readonly capMs: number;
  begin(now: number): void;
  deadline(): number;
}

/**
 * A fresh budget; capMs defaults to 240_000. begin() takes effect once (the first request); later calls
 * change nothing. Before begin(), deadline() is Infinity (nothing has started, so nothing is late).
 */
export function fetchBudget(capMs: number = 240_000): FetchBudget {
  let started: number | null = null;
  return {
    get started() {
      return started;
    },
    capMs,
    begin(now: number) {
      if (started === null) started = now;
    },
    deadline() {
      return started === null ? Number.POSITIVE_INFINITY : started + capMs;
    },
  };
}
