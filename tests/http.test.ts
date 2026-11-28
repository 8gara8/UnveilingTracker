// The fetch harness (SPEC §4.13 "Rate limits", §8.3, lib/feeds/http.ts): retries, caps, truncation, redirects,
// the deadline, fixture mode, the pool, the shared budget, the user agent and the per-host queues. Every request
// goes to a server on 127.0.0.1, to a stubbed fetch or to a temporary fixture folder; no test touches the network.
// The queue tests run on a fake clock that they drive themselves, so they prove the spacing in virtual time and
// wait for nothing. Cyber's tests/http.test.ts at the fork commit 3ced1fb, adapted (the variable is
// UT_FIXTURE_FEEDS; the queues, the clock, the user agent and the tables are new).
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyError, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, FALLBACK_USER_AGENT, FEED_MAX_BYTES, FEED_TIMEOUTS, fetchBudget, fetchFeed, pool, rateQueueOf,
  resetRateQueues, setHttpClock, userAgent, withoutApiKey, type HttpClock,
} from "@/lib/feeds/http";

const UA = "UnveilingTracker test";
const hits = new Map<string, number>();
let base = "";
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const n = (hits.get(url) ?? 0) + 1;
    hits.set(url, n);
    if (url.startsWith("/flaky-503")) {
      if (n === 1) { res.writeHead(503); res.end("busy"); return; }
      res.writeHead(200, { "Content-Type": "text/plain" }); res.end("second time"); return;
    }
    if (url.startsWith("/always-503")) { res.writeHead(503); res.end("busy"); return; }
    if (url.startsWith("/reset")) {
      if (n === 1) { req.socket.destroy(); return; }
      res.writeHead(200); res.end("after reset"); return;
    }
    if (url.startsWith("/missing")) { res.writeHead(404); res.end("no"); return; }
    if (url.startsWith("/limited")) { res.writeHead(429); res.end("slow down"); return; }
    if (url.startsWith("/declared-big")) { res.writeHead(200, { "Content-Length": "100" }); res.end("x".repeat(100)); return; }
    if (url.startsWith("/streamed-big")) {
      res.writeHead(200, { "Content-Type": "text/plain" }); // chunked: no Content-Length
      res.write("a".repeat(8)); res.write("b".repeat(8)); res.end("c".repeat(8)); return;
    }
    if (url.startsWith("/to-http")) { res.writeHead(302, { Location: `${base}/plain` }); res.end(); return; }
    if (url.startsWith("/to-keyed-http")) { res.writeHead(302, { Location: `${base}/plain?x=1&api_key=LEAKED-KEY` }); res.end(); return; }
    if (url.startsWith("/plain")) { res.writeHead(200); res.end("plain"); return; }
    if (url.startsWith("/agent")) { res.writeHead(200); res.end(String(req.headers["user-agent"])); return; }
    if (url.startsWith("/hang")) return; // never answers
    res.writeHead(200); res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const opts = { userAgent: UA, retryDelayMs: 10, timeoutMs: 5_000 };

describe("fetchFeed: retries", () => {
  it("retries once on a 503", async () => {
    const r = await fetchFeed(`${base}/flaky-503`, opts);
    expect(r).toMatchObject({ ok: true, status: 200, attempts: 2, error: null });
    expect(r.body?.toString()).toBe("second time");
  });

  it("retries once on a reset connection", async () => {
    const r = await fetchFeed(`${base}/reset`, opts);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(r.body?.toString()).toBe("after reset");
  });

  it("never retries a 4xx, a 429 included", async () => {
    const r = await fetchFeed(`${base}/missing`, opts);
    expect(r).toMatchObject({ ok: false, status: 404, error: "http_404", attempts: 1 });
    expect(hits.get("/missing")).toBe(1);
    const limited = await fetchFeed(`${base}/limited`, opts);
    expect(limited).toMatchObject({ ok: false, status: 429, error: "http_429", attempts: 1 });
    expect(hits.get("/limited")).toBe(1);
  });

  it("gives up after one retry", async () => {
    const r = await fetchFeed(`${base}/always-503?a`, opts);
    expect(r).toMatchObject({ ok: false, error: "http_503", attempts: 2 });
    expect(hits.get("/always-503?a")).toBe(2);
  });

  it("does not retry when retryDelayMs is 0", async () => {
    const r = await fetchFeed(`${base}/always-503?zero`, { ...opts, retryDelayMs: 0 });
    expect(r).toMatchObject({ ok: false, error: "http_503", attempts: 1 });
    expect(hits.get("/always-503?zero")).toBe(1);
  });
});

describe("fetchFeed: error classes", () => {
  it("reduces a thrown fetch error to a class and keeps its text short for the log", async () => {
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND sample.example"), { code: "ENOTFOUND" }) });
    });
    const r = await fetchFeed("https://sample.example/ut-sample/feed", { ...opts, retryDelayMs: 0 });
    expect(r).toMatchObject({ ok: false, status: null, error: "dns", body: null, attempts: 1 });
    expect(r.detail).toContain("ENOTFOUND");
    expect(r.detail!.length).toBeLessThanOrEqual(300);
  });

  it("classifyError: timeout, dns, tls and network", () => {
    for (const e of [{ name: "TimeoutError" }, { name: "AbortError" }, { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }, { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }, { cause: { code: "UND_ERR_BODY_TIMEOUT" } }]) {
      expect(classifyError(e)).toBe("timeout");
    }
    for (const code of ["ENOTFOUND", "EAI_AGAIN"]) expect(classifyError({ cause: { code } })).toBe("dns");
    expect(classifyError({ code: "ENOTFOUND" })).toBe("dns");
    expect(classifyError({ cause: { code: "CERT_HAS_EXPIRED" } })).toBe("tls");
    expect(classifyError({ cause: { code: "ERR_SSL_PROTOCOL_ERROR" } })).toBe("tls");
    expect(classifyError({ message: "unable to verify the first certificate" })).toBe("tls");
    expect(classifyError({ cause: { message: "TLS handshake failed" } })).toBe("tls");
    expect(classifyError({ cause: { code: "ECONNRESET" } })).toBe("network");
    expect(classifyError(new Error("something else"))).toBe("network");
  });

  it("is a timeout when the attempt is aborted, and the retry happens", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    });
    const r = await fetchFeed("https://sample.example/ut-sample/slow", { ...opts, retryDelayMs: 5 });
    expect(r).toMatchObject({ ok: false, error: "timeout", attempts: 2 });
    expect(calls).toBe(2);
  });

  it("is a network error for an option the harness did not foresee (a timeout that is no number), never a throw", async () => {
    const r = await fetchFeed("https://sample.example/ut-sample/feed", { ...opts, timeoutMs: Number.NaN });
    expect(r).toMatchObject({ ok: false, error: "network", attempts: 1, body: null });
  });
});

describe("fetchFeed: body caps", () => {
  it("is too_large from Content-Length", async () => {
    const r = await fetchFeed(`${base}/declared-big`, { ...opts, maxBytes: 10 });
    expect(r).toMatchObject({ ok: false, error: "too_large", body: null });
  });

  it("is too_large from the streamed size", async () => {
    const r = await fetchFeed(`${base}/streamed-big`, { ...opts, maxBytes: 20 });
    expect(r).toMatchObject({ ok: false, error: "too_large" });
  });

  it("cuts the body at the cap with truncate, both when declared and when streamed", async () => {
    const declared = await fetchFeed(`${base}/declared-big?t`, { ...opts, maxBytes: 10, truncate: true });
    expect(declared).toMatchObject({ ok: true, error: null });
    expect(declared.body?.toString()).toBe("x".repeat(10));
    const streamed = await fetchFeed(`${base}/streamed-big?t`, { ...opts, maxBytes: 12, truncate: true });
    expect(streamed.body?.toString()).toBe(`${"a".repeat(8)}${"b".repeat(4)}`);
  });

  it("returns a body under the cap whole, and one exactly at it", async () => {
    const r = await fetchFeed(`${base}/streamed-big?whole`, { ...opts, maxBytes: 24 });
    expect(r.body?.length).toBe(24);
    const under = await fetchFeed(`${base}/streamed-big?under`, { ...opts, maxBytes: 100 });
    expect(under.body?.length).toBe(24);
  });

  it("keeps a table of the caps and timeouts: 5 MB and 15 s by default, larger only where a feed needs it", () => {
    expect(FEED_MAX_BYTES.default).toBe(5 * 1024 * 1024);
    expect(FEED_TIMEOUTS.default).toBe(15_000);
    expect(Object.keys(FEED_MAX_BYTES)).toEqual(["default", "arxivList", "retractionWatch"]);
    expect(Object.keys(FEED_TIMEOUTS)).toEqual(["default", "arxivList", "retractionWatch"]);
    expect(FEED_MAX_BYTES.arxivList).toBeGreaterThan(FEED_MAX_BYTES.default);
    expect(FEED_MAX_BYTES.retractionWatch).toBeGreaterThan(FEED_MAX_BYTES.arxivList);
    expect(FEED_TIMEOUTS.arxivList).toBeGreaterThan(FEED_TIMEOUTS.default);
    expect(FEED_TIMEOUTS.retractionWatch).toBeGreaterThan(FEED_TIMEOUTS.arxivList);
  });
});

describe("fetchFeed: redirects", () => {
  it("refuses a non-https hop after the first", async () => {
    const r = await fetchFeed(`${base}/to-http`, opts);
    expect(r).toMatchObject({ ok: false, error: "redirects" });
    expect(r.finalUrl).toBe(`${base}/plain`);
    expect(r.detail).toBe("redirect to a non-https URL");
  });

  it("follows at most 5 redirects", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      calls++;
      const n = Number(new URL(url).searchParams.get("n") ?? "0");
      return new Response(null, { status: 302, headers: { location: `https://example.org/hop?n=${n + 1}` } });
    });
    const r = await fetchFeed("https://example.org/hop?n=0", { ...opts, retryDelayMs: 0 });
    expect(r).toMatchObject({ ok: false, error: "redirects", detail: "more than 5 redirects" });
    expect(calls).toBe(6);
  });

  it("asks refuseRedirect about every hop and stops before a refused one, which is never requested", async () => {
    const asked: string[] = [];
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      const n = Number(new URL(url).searchParams.get("n") ?? "0");
      return new Response(null, { status: 301, headers: { location: n === 1 ? "https://refused.example.net/x" : `https://example.org/hop?n=${n + 1}` } });
    });
    const refuseRedirect = (u: string) => {
      asked.push(u);
      return u.includes("refused.example.net") ? "sample reason" : null;
    };
    const r = await fetchFeed("https://example.org/hop?n=0", { ...opts, retryDelayMs: 0, refuseRedirect });
    expect(r).toMatchObject({ ok: false, status: 301, error: "redirects", detail: "a redirect to a refused URL (sample reason)", finalUrl: "https://refused.example.net/x", attempts: 1 });
    expect(asked).toEqual(["https://example.org/hop?n=1", "https://refused.example.net/x"]);
    expect(seen).toEqual(["https://example.org/hop?n=0", "https://example.org/hop?n=1"]);
  });

  it("answers after 5 redirects", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const n = Number(new URL(url).searchParams.get("n") ?? "0");
      if (n === 5) return new Response("done", { status: 200 });
      return new Response(null, { status: 301, headers: { location: `https://example.org/hop?n=${n + 1}` } });
    });
    const r = await fetchFeed("https://example.org/hop?n=0", opts);
    expect(r).toMatchObject({ ok: true, finalUrl: "https://example.org/hop?n=5" });
  });

  it("resolves a relative Location against the page that sent it", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return seen.length === 1 ? new Response(null, { status: 302, headers: { location: "/moved/here?x=1" } }) : new Response("there", { status: 200 });
    });
    const r = await fetchFeed("https://example.org/a/b", opts);
    expect(r).toMatchObject({ ok: true, finalUrl: "https://example.org/moved/here?x=1" });
    expect(seen).toEqual(["https://example.org/a/b", "https://example.org/moved/here?x=1"]);
  });

  it("is an error for a redirect with a Location that is no address, and for a 3xx with none", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("bad") ? new Response(null, { status: 302, headers: { location: "http://[" } }) : new Response(null, { status: 304 }));
    expect(await fetchFeed("https://example.org/bad", { ...opts, retryDelayMs: 0 })).toMatchObject({
      ok: false, status: 302, error: "redirects", detail: "a redirect with an invalid Location", finalUrl: "https://example.org/bad",
    });
    expect(await fetchFeed("https://example.org/none", { ...opts, retryDelayMs: 0 })).toMatchObject({ ok: false, status: 304, error: "http_304" });
  });
});

describe("fetchFeed: an api_key never comes back in a result (the OpenAlex client sends its key in the URL, §9.6)", () => {
  const KEY = "SECRET-KEY-123";
  const seenIn = (r: unknown) => JSON.stringify(r, (k, v) => (k === "body" ? undefined : v));

  it("withoutApiKey takes the parameter out wherever it stands, and leaves any other text alone", () => {
    expect(withoutApiKey(`https://h.example/w?a=1&api_key=${KEY}`)).toBe("https://h.example/w?a=1");
    expect(withoutApiKey(`https://h.example/w?api_key=${KEY}&a=1`)).toBe("https://h.example/w?a=1");
    expect(withoutApiKey(`https://h.example/w?a=1&api_key=${KEY}&b=2`)).toBe("https://h.example/w?a=1&b=2");
    expect(withoutApiKey(`https://h.example/w?api_key=${KEY}`)).toBe("https://h.example/w");
    expect(withoutApiKey(`https://h.example/w?a=1&api_key=${KEY}#top`)).toBe("https://h.example/w?a=1#top");
    expect(withoutApiKey(`https://h.example/w?API_KEY=${KEY}&a=1`)).toBe("https://h.example/w?a=1");
    expect(withoutApiKey(`https://h.example/w?a=1&api_key=&b=2`)).toBe("https://h.example/w?a=1&b=2");
    expect(withoutApiKey(`https://h.example/w?a=1&api_key=${encodeURIComponent("k/+= &z")}`)).not.toContain("z");
    // Every occurrence, in a message that quotes the URL twice.
    const message = `Failed to parse URL from https://h.example/w?api_key=${KEY}&a=1 and then https://h.example/w?a=1&api_key=${KEY} again`;
    expect(withoutApiKey(message)).toBe("Failed to parse URL from https://h.example/w?a=1 and then https://h.example/w?a=1 again");
    // Each URL of a message loses its dangling "&" or "?", not only the first.
    expect(withoutApiKey(`see https://h.example/w?a=1&api_key=${KEY} and https://h.example/v?api_key=${KEY} or https://h.example/u?b=2&api_key=${KEY} end`)).toBe(
      "see https://h.example/w?a=1 and https://h.example/v or https://h.example/u?b=2 end");
    // The value runs to the next "&", "#" or space, whatever characters it holds, so a key with `)` or `!` in it is taken out whole.
    expect(withoutApiKey("https://h.example/w?api_key=ab)c!d*e'f&a=1")).toBe("https://h.example/w?a=1");
    // Nothing to take out: the same text, even one with a trailing "?" or "&".
    for (const same of ["https://h.example/w?", "https://h.example/w?a=1&", "https://h.example/w?a=1", "api key", "an api_keyboard", ""]) {
      expect(withoutApiKey(same)).toBe(same);
    }
  });

  it("a request that carries a key still sends it, and the result that comes back does not repeat it", async () => {
    const r = await fetchFeed(`${base}/plain?a=1&api_key=${KEY}`, opts);
    expect(hits.get(`/plain?a=1&api_key=${KEY}`)).toBe(1); // the wire had it
    expect(r).toMatchObject({ ok: true, status: 200, finalUrl: `${base}/plain?a=1`, detail: null });
    expect(seenIn(r)).not.toContain(KEY);
  });

  it("a redirect whose Location carries a key does not put it in finalUrl or detail", async () => {
    const r = await fetchFeed(`${base}/to-keyed-http`, opts);
    expect(r).toMatchObject({ ok: false, error: "redirects", finalUrl: `${base}/plain?x=1`, detail: "redirect to a non-https URL" });
    expect(seenIn(r)).not.toContain("LEAKED-KEY");
    expect(seenIn(r)).not.toContain("api_key");
  });

  it("a refused redirect target and its reason do not carry the key either", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 302, headers: { location: `https://other.example/w?api_key=${KEY}&a=1` } }));
    const r = await fetchFeed("https://example.org/w", { ...opts, retryDelayMs: 0, refuseRedirect: (u) => `no to ${u}` });
    expect(r).toMatchObject({ ok: false, error: "redirects", finalUrl: "https://other.example/w?a=1", detail: "a redirect to a refused URL (no to https://other.example/w?a=1)" });
    expect(seenIn(r)).not.toContain(KEY);
  });

  it("an error message that quotes the URL does not carry the key, whether fetch threw it or the harness did", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      throw new TypeError(`Failed to parse URL from ${url}`);
    });
    const r = await fetchFeed(`https://example.org/w?a=1&api_key=${KEY}`, { ...opts, retryDelayMs: 0 });
    expect(r).toMatchObject({ ok: false, error: "network", finalUrl: "https://example.org/w?a=1", detail: "Failed to parse URL from https://example.org/w?a=1" });
    expect(seenIn(r)).not.toContain(KEY);
    // A cause that quotes it, and one that fetch's own body read throws.
    vi.stubGlobal("fetch", async (url: string) => {
      throw Object.assign(new TypeError("fetch failed"), { cause: new Error(`connect to ${url} refused`) });
    });
    const c = await fetchFeed(`https://example.org/w?api_key=${KEY}&a=1`, { ...opts, retryDelayMs: 0 });
    expect(c.detail).toBe("Error: connect to https://example.org/w?a=1 refused");
    expect(seenIn(c)).not.toContain(KEY);
  });

  it("an option the harness did not foresee ends as a network error that does not carry the key in finalUrl either", async () => {
    const r = await fetchFeed(`https://example.org/w?a=1&api_key=${KEY}`, { ...opts, timeoutMs: Number.NaN });
    expect(r).toMatchObject({ ok: false, error: "network", attempts: 1, finalUrl: "https://example.org/w?a=1" });
    expect(seenIn(r)).not.toContain(KEY);
  });

  it("the deadline, the retry and fixture mode answers do not carry it", async () => {
    const late = await fetchFeed(`https://example.org/w?api_key=${KEY}`, { ...opts, deadline: Date.now() - 1 });
    expect(late).toMatchObject({ error: "timeout", attempts: 0, finalUrl: "https://example.org/w" });
    expect(seenIn(late)).not.toContain(KEY);
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }));
    const retried = await fetchFeed(`https://example.org/w?api_key=${KEY}`, { ...opts, retryDelayMs: 1 });
    expect(retried).toMatchObject({ error: "http_503", attempts: 2, finalUrl: "https://example.org/w" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-fixtures-key-"));
    try {
      fs.writeFileSync(path.join(dir, "index.json"), "{}");
      vi.stubEnv("UT_FIXTURE_FEEDS", dir);
      const fixture = await fetchFeed(`https://example.org/w?api_key=${KEY}&a=1`, opts);
      expect(fixture).toMatchObject({ error: "dns", finalUrl: "https://example.org/w?a=1" });
      expect(seenIn(fixture)).not.toContain(KEY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fetchFeed: a timeout AbortSignal.timeout would refuse (a fraction, Infinity, a count past 32 bits)", () => {
  // AbortSignal.timeout throws ERR_OUT_OF_RANGE for each of these, which would end the fetch as `network` with no request made.
  it.each([1500.5, 1e12, Number.POSITIVE_INFINITY])("timeoutMs %s still requests, and answers", async (timeoutMs) => {
    const r = await fetchFeed(`${base}/plain?timeout-${String(timeoutMs)}`, { ...opts, timeoutMs });
    expect(r).toMatchObject({ ok: true, status: 200, attempts: 1, error: null });
    expect(r.body?.toString()).toBe("plain");
  });

  it("a deadline that leaves a fraction of a millisecond still requests", async () => {
    const r = await fetchFeed(`${base}/plain?deadline-fraction`, { ...opts, timeoutMs: 5_000, deadline: Date.now() + 10_000.5 });
    expect(r).toMatchObject({ ok: true, attempts: 1 });
  });

  it("still ends a hung request at a fractional timeout, rounded up to the next ms", async () => {
    const t0 = Date.now();
    const r = await fetchFeed(`${base}/hang?fraction`, { ...opts, timeoutMs: 150.2, retryDelayMs: 0 });
    expect(r).toMatchObject({ ok: false, error: "timeout", attempts: 1 });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("the signal given to fetch is the rounded and capped one", async () => {
    const delays: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      delays.push(ms);
      return real(ms);
    });
    try {
      vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
      await fetchFeed("https://example.org/a", { ...opts, timeoutMs: 1500.5 });
      await fetchFeed("https://example.org/a", { ...opts, timeoutMs: Number.POSITIVE_INFINITY });
      await fetchFeed("https://example.org/a", { ...opts, timeoutMs: 1e12 });
    } finally {
      vi.mocked(AbortSignal.timeout).mockRestore();
    }
    expect(delays).toEqual([1501, 2_147_483_647, 2_147_483_647]);
  });
});

describe("fetchFeed: the deadline", () => {
  it("starts nothing past the deadline", async () => {
    const before = hits.get("/plain?late") ?? 0;
    const r = await fetchFeed(`${base}/plain?late`, { ...opts, deadline: Date.now() - 1 });
    expect(r).toMatchObject({ ok: false, error: "timeout", attempts: 0, detail: "deadline passed before the request" });
    expect(hits.get("/plain?late") ?? 0).toBe(before);
  });

  it("skips the retry when its delay would cross the deadline", async () => {
    const r = await fetchFeed(`${base}/always-503?deadline`, { ...opts, retryDelayMs: 2_000, deadline: Date.now() + 1_000 });
    expect(r).toMatchObject({ ok: false, error: "http_503", attempts: 1 });
    expect(hits.get("/always-503?deadline")).toBe(1);
  });

  it("cuts an attempt's timeout to the deadline", async () => {
    const t0 = Date.now();
    const r = await fetchFeed(`${base}/hang`, { ...opts, timeoutMs: 30_000, retryDelayMs: 0, deadline: Date.now() + 300 });
    expect(r).toMatchObject({ ok: false, error: "timeout", attempts: 1 });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});

describe("fetchFeed with UT_FIXTURE_FEEDS", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-http-"));
  fs.writeFileSync(path.join(dir, "big.txt"), "z".repeat(50));
  fs.writeFileSync(path.join(dir, "feed.xml"), "<feed/>");
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
    "https://example.org/big": { file: "big.txt", content_type: "text/plain" },
    "https://example.org/feed": { file: "feed.xml", content_type: "application/atom+xml; charset=utf-8" },
    "https://example.org/gone": { status: 404 },
    "https://example.org/busy": { status: 503 },
    "https://example.org/empty": { status: 204 },
    "https://example.org/slow": { error: "timeout" },
  }));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("answers a known URL from its file, with the content type the index gives and one attempt", async () => {
    vi.stubEnv("UT_FIXTURE_FEEDS", dir);
    const r = await fetchFeed("https://example.org/feed");
    expect(r).toMatchObject({ ok: true, status: 200, finalUrl: "https://example.org/feed", contentType: "application/atom+xml; charset=utf-8", error: null, detail: null, attempts: 1 });
    expect(r.body?.toString()).toBe("<feed/>");
  });

  it("answers an unknown URL as a dns error", async () => {
    vi.stubEnv("UT_FIXTURE_FEEDS", dir);
    expect(await fetchFeed("https://example.org/nowhere")).toMatchObject({ ok: false, status: null, body: null, error: "dns", detail: "not in fixture index", attempts: 1 });
  });

  it("answers a status entry without a file: a 2xx with an empty body, any other status as its error class", async () => {
    vi.stubEnv("UT_FIXTURE_FEEDS", dir);
    const empty = await fetchFeed("https://example.org/empty");
    expect(empty).toMatchObject({ ok: true, status: 204, contentType: null, error: null });
    expect(empty.body?.length).toBe(0);
    expect(await fetchFeed("https://example.org/gone")).toMatchObject({ ok: false, status: 404, error: "http_404", body: null });
    expect(await fetchFeed("https://example.org/busy")).toMatchObject({ ok: false, status: 503, error: "http_503", attempts: 1 });
  });

  it("applies the body cap and truncate to saved files", async () => {
    vi.stubEnv("UT_FIXTURE_FEEDS", dir);
    expect(await fetchFeed("https://example.org/big", { maxBytes: 100 })).toMatchObject({ ok: true, contentType: "text/plain" });
    expect(await fetchFeed("https://example.org/big", { maxBytes: 10 })).toMatchObject({ ok: false, error: "too_large", body: null });
    const cut = await fetchFeed("https://example.org/big", { maxBytes: 10, truncate: true });
    expect(cut.body?.toString()).toBe("z".repeat(10));
  });

  it("answers errors from the index and ignores the deadline", async () => {
    vi.stubEnv("UT_FIXTURE_FEEDS", dir);
    expect(await fetchFeed("https://example.org/slow")).toMatchObject({ ok: false, error: "timeout", detail: "fixture error" });
    expect(await fetchFeed("https://example.org/big", { deadline: 0 })).toMatchObject({ ok: true });
  });

  it("turns an unreadable fixture folder into a network error, never a throw", async () => {
    vi.stubEnv("UT_FIXTURE_FEEDS", path.join(dir, "no-such-folder"));
    expect(await fetchFeed("https://example.org/feed")).toMatchObject({ ok: false, error: "network", attempts: 0 });
  });

  it("reads no other variable: a fixture folder named by the old variable of the fork is ignored", async () => {
    vi.stubEnv("UT_FIXTURE_FEEDS", "");
    vi.stubEnv(["C", "T_FIXTURE_FEEDS"].join(""), dir);
    vi.stubGlobal("fetch", async () => new Response("live", { status: 200 }));
    const r = await fetchFeed("https://example.org/feed", opts);
    expect(r.body?.toString()).toBe("live");
  });
});

describe("pool", () => {
  it("never runs more than the limit and keeps input order", async () => {
    let running = 0;
    let peak = 0;
    const out = await pool([5, 1, 4, 2, 3, 0, 6], 3, async (n, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n * 3));
      running--;
      return `${i}:${n}`;
    });
    expect(peak).toBe(3);
    expect(out).toEqual(["0:5", "1:1", "2:4", "3:2", "4:3", "5:0", "6:6"]);
  });

  it("handles an empty list and a limit below 1", async () => {
    expect(await pool([], 8, async () => 1)).toEqual([]);
    expect(await pool([1, 2], 0, async (n) => n * 2)).toEqual([2, 4]);
  });

  it("reads a limit that is no whole number at least 1: NaN, 0 and negatives run one at a time, 2.9 runs two, Infinity runs them all", async () => {
    const peakOf = async (limit: number, n = 6) => {
      let running = 0;
      let peak = 0;
      const out = await pool(Array.from({ length: n }, (_, i) => i), limit, async (i) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 2));
        running--;
        return i;
      });
      expect(out).toEqual(Array.from({ length: n }, (_, i) => i));
      return peak;
    };
    expect(await peakOf(Number.NaN)).toBe(1);
    expect(await peakOf(0)).toBe(1);
    expect(await peakOf(-3)).toBe(1);
    expect(await peakOf(1)).toBe(1);
    expect(await peakOf(2.9)).toBe(2);
    expect(await peakOf(Number.POSITIVE_INFINITY)).toBe(6);
    expect(await peakOf(4, 2)).toBe(2);
  });

  it("starts no call for an empty list", async () => {
    let calls = 0;
    expect(await pool([], 0, async () => { calls++; return 1; })).toEqual([]);
    expect(await pool([], Number.NaN, async () => { calls++; return 1; })).toEqual([]);
    expect(calls).toBe(0);
  });

  it("throws the very error of a single failure, and the first of two failures that were in flight together", async () => {
    const only = new Error("only");
    await expect(pool([1], 1, async () => { throw only; })).rejects.toBe(only);
    const first = new Error("first");
    const second = new Error("second");
    await expect(pool([1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 10));
      throw n === 1 ? first : second;
    })).rejects.toBe(first);
  });

  it("stops starting items after a failure and throws the first error", async () => {
    const started: number[] = [];
    await expect(pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 5));
      if (n === 2) throw new Error("boom 2");
      return n;
    })).rejects.toThrow("boom 2");
    expect(started.length).toBeLessThan(6);
  });
});

describe("fetchBudget", () => {
  it("starts at the first request and defaults to 240 s", () => {
    const b = fetchBudget();
    expect(b.capMs).toBe(240_000);
    expect(b.started).toBeNull();
    expect(b.deadline()).toBe(Number.POSITIVE_INFINITY);
    b.begin(1_000);
    b.begin(5_000);
    expect(b.started).toBe(1_000);
    expect(b.deadline()).toBe(241_000);
    expect(fetchBudget(10).capMs).toBe(10);
  });
});

describe("fetchFeed: Accept-Language", () => {
  let echo: http.Server;
  let echoBase = "";
  const seen: (string | undefined)[] = [];

  beforeAll(async () => {
    echo = http.createServer((req, res) => {
      const lang = req.headers["accept-language"];
      seen.push(typeof lang === "string" ? lang : undefined);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(typeof lang === "string" ? lang : "(none)");
    });
    await new Promise<void>((r) => echo.listen(0, "127.0.0.1", () => r()));
    echoBase = `http://127.0.0.1:${(echo.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    echo.closeAllConnections();
    await new Promise<void>((r) => echo.close(() => r()));
  });

  it("sends Accept-Language only when the option is set; fixture mode ignores it", async () => {
    const withLang = await fetchFeed(`${echoBase}/lang`, { ...opts, acceptLanguage: "en-US,en;q=0.9" });
    expect(withLang).toMatchObject({ ok: true, status: 200 });
    expect(withLang.body?.toString()).toBe("en-US,en;q=0.9");
    // Without the option fetchFeed adds no Accept-Language; Node's fetch then sends its own default ("*").
    const without = await fetchFeed(`${echoBase}/lang`, opts);
    expect(["(none)", "*"]).toContain(without.body?.toString());
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe("en-US,en;q=0.9");
    expect([undefined, "*"]).toContain(seen[1]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-http-al-"));
    try {
      fs.writeFileSync(path.join(dir, "page.html"), "<p>saved</p>");
      fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ "https://example.org/ut-sample/page": { file: "page.html", content_type: "text/html" } }));
      vi.stubEnv("UT_FIXTURE_FEEDS", dir);
      const saved = await fetchFeed("https://example.org/ut-sample/page", { acceptLanguage: "en-US,en;q=0.9" });
      expect(saved).toMatchObject({ ok: true, status: 200, contentType: "text/html" });
      expect(saved.body?.toString()).toBe("<p>saved</p>");
      expect(seen).toHaveLength(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("userAgent()", () => {
  const roots: string[] = [];
  const rootWith = (runJson: string | null): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ut-ua-"));
    roots.push(root);
    if (runJson !== null) {
      fs.mkdirSync(path.join(root, "config"));
      fs.writeFileSync(path.join(root, "config", "run.json"), runJson);
    }
    return root;
  };
  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  it("is run.json's user_agent, which names this project", () => {
    const fromFile = (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "run.json"), "utf8")) as { user_agent: string }).user_agent;
    expect(userAgent()).toBe(fromFile);
    expect(fromFile).toMatch(/^UnveilingTracker\/1\.0 /);
  });

  it("reads the file under the root it is given, once for each root", () => {
    const root = rootWith(JSON.stringify({ user_agent: "Sample/2 (+https://example.org/ut-sample)" }));
    expect(userAgent(root)).toBe("Sample/2 (+https://example.org/ut-sample)");
    fs.writeFileSync(path.join(root, "config", "run.json"), JSON.stringify({ user_agent: "Changed/3" }));
    expect(userAgent(root)).toBe("Sample/2 (+https://example.org/ut-sample)");
    expect(userAgent(rootWith(JSON.stringify({ user_agent: "Other/1" })))).toBe("Other/1");
  });

  it("falls back to this project's name when the file is missing, malformed or has no usable value", () => {
    expect(FALLBACK_USER_AGENT).toBe("UnveilingTracker/1.0");
    for (const runJson of [null, "{not json", "{}", JSON.stringify({ user_agent: 7 }), JSON.stringify({ user_agent: "   " }), JSON.stringify({ user_agent: null })]) {
      expect(userAgent(rootWith(runJson))).toBe(FALLBACK_USER_AGENT);
    }
  });

  it("is the User-Agent a request sends unless the call names its own", async () => {
    const standard = await fetchFeed(`${base}/agent`, { retryDelayMs: 0 });
    expect(standard.body?.toString()).toBe(userAgent());
    const own = await fetchFeed(`${base}/agent`, { retryDelayMs: 0, userAgent: "Own/9" });
    expect(own.body?.toString()).toBe("Own/9");
  });
});

// ── The per-host queues, on a fake clock (SPEC §4.13 "Rate limits") ──────────────────────────────

/**
 * A clock the test drives. `sleep` parks a timer; `run()` lets every ready promise finish, then moves the time to
 * the next timer, until the promise it was given settles. Time moves only there, so a test sees exact instants.
 */
class FakeClock implements HttpClock {
  t = 1_700_000_000_000;
  readonly origin = this.t;
  readonly sleeps: number[] = [];
  private timers: { at: number; seq: number; resolve: () => void }[] = [];
  private seq = 0;

  now(): number {
    return this.t;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return new Promise<void>((resolve) => this.timers.push({ at: this.t + Math.max(0, ms), seq: this.seq++, resolve }));
  }

  /** Virtual ms since the clock was made. */
  get elapsed(): number {
    return this.t - this.origin;
  }

  async run<T>(work: Promise<T>): Promise<T> {
    let settled = false;
    let value: T | undefined;
    let failure: unknown;
    work.then((v) => { value = v; settled = true; }, (e: unknown) => { failure = e; settled = true; });
    let idle = 0;
    while (!settled) {
      await new Promise<void>((r) => setImmediate(r));
      if (settled) break;
      const next = [...this.timers].sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) {
        idle += 1;
        if (idle > 200) throw new Error("fake clock: the work is waiting for nothing");
        continue;
      }
      idle = 0;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.resolve();
    }
    if (failure !== undefined) throw failure;
    return value as T;
  }
}

interface Call { url: string; start: number; end: number }
interface Reply { status?: number; body?: string; ms?: number; location?: string }

/** Stubs fetch: each call is logged with its start and end on the fake clock (times since the clock began), and takes `ms` of fake time. */
function stubFetch(clock: FakeClock, reply: (url: string, n: number) => Reply = () => ({})): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const call: Call = { url, start: clock.elapsed, end: 0 };
    calls.push(call);
    const r = reply(url, calls.filter((c) => c.url === url).length);
    await clock.sleep(r.ms ?? 0);
    call.end = clock.elapsed;
    return r.location !== undefined
      ? new Response(null, { status: r.status ?? 302, headers: { location: r.location } })
      : new Response(r.body ?? "ok", { status: r.status ?? 200 });
  });
  return calls;
}

describe("rateQueueOf()", () => {
  it("names the queue of each limited host, with arXiv's two hosts in one", () => {
    expect(rateQueueOf("https://export.arxiv.org/api/query?search_query=cat:math.CO")).toBe("arxiv");
    expect(rateQueueOf("https://rss.arxiv.org/atom/math")).toBe("arxiv");
    expect(rateQueueOf("https://api.crossref.org/works?filter=issn:0028-0836")).toBe("crossref");
    expect(rateQueueOf("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed")).toBe("eutils");
    expect(rateQueueOf("https://api.openalex.org/works?filter=type:article")).toBe("openalex");
  });

  it("reads the host as the URL parser does: any case, a trailing dot, a port, either scheme", () => {
    expect(rateQueueOf("https://EXPORT.arXiv.org./api/query")).toBe("arxiv");
    expect(rateQueueOf("https://export.arxiv.org:443/api/query")).toBe("arxiv");
    expect(rateQueueOf("http://api.openalex.org/works")).toBe("openalex");
  });

  it("gives no queue to any other host, a look-alike or something that is no URL", () => {
    for (const url of [
      "https://arxiv.org/abs/2501.01234", "https://api.biorxiv.org/details/biorxiv/2026-01-01/2026-01-08", "https://clinicaltrials.gov/api/v2/studies",
      "https://example.org/", "https://export.arxiv.org.example.net/api/query", "https://notexport.arxiv.org/x", "https://www.ncbi.nlm.nih.gov/pmc/",
      "not a url", "",
    ]) {
      expect(rateQueueOf(url), url).toBeNull();
    }
  });
});

describe("fetchFeed: one queue for each rate-limited host", () => {
  let clock: FakeClock;
  beforeEach(() => {
    resetRateQueues();
    clock = new FakeClock();
    setHttpClock(clock);
  });
  afterEach(() => {
    setHttpClock(null);
    resetRateQueues();
  });

  const arxiv = (n: number) => `https://export.arxiv.org/api/query?search_query=cat:math.CO&n=${n}`;
  const filter = (n: number) => `https://api.crossref.org/works?filter=issn:0028-0836&rows=1&n=${n}`;
  const record = (n: number) => `https://api.crossref.org/works/10.1000/ut-sample-${n}`;
  const eutils = (n: number) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&n=${n}`;
  const openalex = (n: number) => `https://api.openalex.org/works?filter=type:article&n=${n}`;
  const starts = (calls: Call[]) => calls.map((c) => c.start);
  /** The calls as [url, start], in time order and, for calls that start together, in URL order (the order the stub is reached in is not a rule). */
  const timeline = (calls: Call[]) => calls.map((c) => [c.url, c.start] as const).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  it("arXiv: two requests sent from two pool slots never overlap, and the second starts 3 s after the first ENDED", async () => {
    const calls = stubFetch(clock, () => ({ ms: 700 }));
    const results = await clock.run(pool([arxiv(1), arxiv(2)], 2, (u) => fetchFeed(u, { retryDelayMs: 0 })));
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(calls.map((c) => [c.url, c.start, c.end])).toEqual([[arxiv(1), 0, 700], [arxiv(2), 3_700, 4_400]]);
    expect(calls[1]!.start).toBeGreaterThanOrEqual(calls[0]!.end);
    expect(calls[1]!.start - calls[0]!.end).toBe(3_000);
  });

  it("arXiv: six requests from three slots run one after another, each 3 s after the one before ended", async () => {
    const calls = stubFetch(clock, () => ({ ms: 400 }));
    await clock.run(pool([1, 2, 3, 4, 5, 6], 3, (n) => fetchFeed(arxiv(n), { retryDelayMs: 0 })));
    expect(starts(calls)).toEqual([0, 3_400, 6_800, 10_200, 13_600, 17_000]);
    calls.slice(1).forEach((c, i) => {
      expect(c.start).toBeGreaterThanOrEqual(calls[i]!.end + 3_000);
    });
  });

  it("arXiv: the API and the listing feeds share one queue", async () => {
    const calls = stubFetch(clock);
    await clock.run(Promise.all([fetchFeed(arxiv(1), { retryDelayMs: 0 }), fetchFeed("https://rss.arxiv.org/atom/math", { retryDelayMs: 0 })]));
    expect(starts(calls)).toEqual([0, 3_000]);
  });

  it("arXiv: requests are served in the order they were asked, whatever the slot", async () => {
    const calls = stubFetch(clock);
    await clock.run(Promise.all([1, 2, 3, 4].map((n) => fetchFeed(arxiv(n), { retryDelayMs: 0 }))));
    expect(calls.map((c) => c.url)).toEqual([1, 2, 3, 4].map(arxiv));
    expect(starts(calls)).toEqual([0, 3_000, 6_000, 9_000]);
  });

  it("arXiv: a request that fails still counts as ended, and the next one waits the 3 s after it", async () => {
    const calls = stubFetch(clock, (url) => (url === arxiv(1) ? { status: 429, ms: 100 } : {}));
    const results = await clock.run(Promise.all([fetchFeed(arxiv(1), { retryDelayMs: 0 }), fetchFeed(arxiv(2), { retryDelayMs: 0 })]));
    expect(results.map((r) => r.error)).toEqual(["http_429", null]);
    expect(starts(calls)).toEqual([0, 3_100]);
  });

  it("a retry joins its host's queue behind the requests already waiting, and waits its 3 s too", async () => {
    // A fails once (503) and retries after 2 s; B was asked right after A, so B's turn comes before A's retry.
    const calls = stubFetch(clock, (url, n) => (url === arxiv(1) && n === 1 ? { status: 503 } : {}));
    const [a, b] = await clock.run(Promise.all([fetchFeed(arxiv(1)), fetchFeed(arxiv(2))]));
    expect(a).toMatchObject({ ok: true, attempts: 2 });
    expect(b).toMatchObject({ ok: true, attempts: 1 });
    expect(calls.map((c) => [c.url, c.start])).toEqual([[arxiv(1), 0], [arxiv(2), 3_000], [arxiv(1), 6_000]]);
    expect(a.durationMs).toBe(6_000);
    // The retry delay itself is the one the call asked for (2 s by default), read on the same clock.
    expect(clock.sleeps).toContain(2_000);
  });

  it("a retry alone still waits the 3 s that arXiv's terms need after the attempt that failed", async () => {
    const calls = stubFetch(clock, (_url, n) => (n === 1 ? { status: 503, ms: 250 } : {}));
    const r = await clock.run(fetchFeed(arxiv(1)));
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(calls.map((c) => [c.start, c.end])).toEqual([[0, 250], [3_250, 3_250]]);
  });

  it("Crossref: two filters never overlap and start at least a second apart", async () => {
    const calls = stubFetch(clock, () => ({ ms: 200 }));
    await clock.run(Promise.all([fetchFeed(filter(1), { retryDelayMs: 0 }), fetchFeed(filter(2), { retryDelayMs: 0 })]));
    expect(starts(calls)).toEqual([0, 1_000]);
    expect(calls[1]!.start).toBeGreaterThanOrEqual(calls[0]!.end);
    expect(calls[1]!.start - calls[0]!.start).toBeGreaterThanOrEqual(1_000);
  });

  it("Crossref: a filter that takes longer than a second is still alone, the next one starting when it ends", async () => {
    const calls = stubFetch(clock, () => ({ ms: 2_500 }));
    await clock.run(Promise.all([fetchFeed(filter(1), { retryDelayMs: 0 }), fetchFeed(filter(2), { retryDelayMs: 0 })]));
    expect(calls.map((c) => [c.start, c.end])).toEqual([[0, 2_500], [2_500, 5_000]]);
  });

  it("Crossref: single records go at most 5 a second, one at a time", async () => {
    const calls = stubFetch(clock, () => ({ ms: 50 }));
    await clock.run(Promise.all([1, 2, 3, 4].map((n) => fetchFeed(record(n), { retryDelayMs: 0 }))));
    expect(starts(calls)).toEqual([0, 200, 400, 600]);
    expect(calls.every((c, i) => i === 0 || c.start >= calls[i - 1]!.end)).toBe(true);
  });

  it("Crossref: a record right after a filter waits for its end only, and a filter after a record still keeps its second", async () => {
    const calls = stubFetch(clock, () => ({ ms: 100 }));
    await clock.run(Promise.all([fetchFeed(filter(1), { retryDelayMs: 0 }), fetchFeed(record(1), { retryDelayMs: 0 }), fetchFeed(filter(2), { retryDelayMs: 0 })]));
    expect(calls.map((c) => [c.url, c.start, c.end])).toEqual([[filter(1), 0, 100], [record(1), 100, 200], [filter(2), 1_000, 1_100]]);
  });

  it("Crossref: a versioned path reads as a record, and a path with nothing after works/ as a query", async () => {
    const calls = stubFetch(clock);
    await clock.run(Promise.all([
      fetchFeed("https://api.crossref.org/v1/works/10.1000/ut-sample-1", { retryDelayMs: 0 }),
      fetchFeed("https://api.crossref.org/v1/works/10.1000/ut-sample-2", { retryDelayMs: 0 }),
      fetchFeed("https://api.crossref.org/works/?rows=1", { retryDelayMs: 0 }),
      fetchFeed("https://api.crossref.org/works/?rows=2", { retryDelayMs: 0 }),
    ]));
    expect(starts(calls)).toEqual([0, 200, 200, 1_200]);
  });

  it("E-utilities: at most 3 a second, and requests in flight may overlap", async () => {
    const calls = stubFetch(clock, () => ({ ms: 2_000 }));
    await clock.run(Promise.all([1, 2, 3, 4, 5, 6, 7].map((n) => fetchFeed(eutils(n), { retryDelayMs: 0 }))));
    expect(starts(calls)).toEqual([0, 334, 668, 1_002, 1_336, 1_670, 2_004]);
    // Any 1000 ms holds at most 3 starts, and the first three really were in flight together.
    calls.forEach((c, i) => {
      if (i + 3 < calls.length) expect(calls[i + 3]!.start - c.start).toBeGreaterThanOrEqual(1_000);
    });
    expect(calls[2]!.start).toBeLessThan(calls[0]!.end);
  });

  it("OpenAlex: one a second, and requests in flight may overlap", async () => {
    const calls = stubFetch(clock, () => ({ ms: 2_500 }));
    await clock.run(Promise.all([1, 2, 3].map((n) => fetchFeed(openalex(n), { retryDelayMs: 0 }))));
    expect(starts(calls)).toEqual([0, 1_000, 2_000]);
    expect(calls[1]!.start).toBeLessThan(calls[0]!.end);
  });

  it("OpenAlex: a request after a quiet spell starts at once, not a second late", async () => {
    const calls = stubFetch(clock);
    await clock.run(fetchFeed(openalex(1), { retryDelayMs: 0 }));
    clock.t += 5_000;
    await clock.run(fetchFeed(openalex(2), { retryDelayMs: 0 }));
    expect(starts(calls)).toEqual([0, 5_000]);
  });

  it("each host has its own queue: a request to another host or an unlimited one never waits for a busy one", async () => {
    const calls = stubFetch(clock, (url) => (url.startsWith("https://export.arxiv.org") ? { ms: 1_000 } : {}));
    await clock.run(Promise.all([
      fetchFeed(arxiv(1), { retryDelayMs: 0 }), fetchFeed(arxiv(2), { retryDelayMs: 0 }), fetchFeed(filter(1), { retryDelayMs: 0 }),
      fetchFeed(eutils(1), { retryDelayMs: 0 }), fetchFeed(openalex(1), { retryDelayMs: 0 }),
      fetchFeed("https://example.org/ut-sample/a", { retryDelayMs: 0 }), fetchFeed("https://example.org/ut-sample/b", { retryDelayMs: 0 }),
    ]));
    const at = (url: string) => calls.find((c) => c.url === url)!.start;
    expect([at(arxiv(1)), at(arxiv(2))]).toEqual([0, 4_000]);
    for (const url of [filter(1), eutils(1), openalex(1), "https://example.org/ut-sample/a", "https://example.org/ut-sample/b"]) expect(at(url), url).toBe(0);
  });

  it("a host that is not limited gets no wait at all", async () => {
    const calls = stubFetch(clock);
    await clock.run(Promise.all([1, 2, 3].map((n) => fetchFeed(`https://api.biorxiv.org/details/biorxiv/2026-01-0${n}`, { retryDelayMs: 0 }))));
    expect(starts(calls)).toEqual([0, 0, 0]);
    expect(clock.sleeps).toEqual([0, 0, 0]);
  });

  it("the queue lets the next request through when the one in front is a hop that redirects away: each hop is a request of its own", async () => {
    // A's first hop (arXiv) redirects to a slow page elsewhere; B, asked at once, starts 3 s after that first hop ended, not after A's whole chain.
    const calls = stubFetch(clock, (url) => {
      if (url === arxiv(1)) return { location: "https://example.org/ut-sample/slow" };
      if (url === "https://example.org/ut-sample/slow") return { ms: 10_000 };
      return {};
    });
    const [a, b] = await clock.run(Promise.all([fetchFeed(arxiv(1), { retryDelayMs: 0 }), fetchFeed(arxiv(2), { retryDelayMs: 0 })]));
    expect(a).toMatchObject({ ok: true, finalUrl: "https://example.org/ut-sample/slow" });
    expect(b.ok).toBe(true);
    expect(timeline(calls)).toEqual([["https://example.org/ut-sample/slow", 0], [arxiv(1), 0], [arxiv(2), 3_000]]);
  });

  it("a redirect into a limited host joins that host's queue", async () => {
    const calls = stubFetch(clock, (url) => {
      if (url === arxiv(1)) return { ms: 500 };
      if (url === "https://example.org/ut-sample/old") return { location: arxiv(2) };
      return {};
    });
    const [, b] = await clock.run(Promise.all([fetchFeed(arxiv(1), { retryDelayMs: 0 }), fetchFeed("https://example.org/ut-sample/old", { retryDelayMs: 0 })]));
    expect(b).toMatchObject({ ok: true, finalUrl: arxiv(2) });
    expect(timeline(calls)).toEqual([["https://example.org/ut-sample/old", 0], [arxiv(1), 0], [arxiv(2), 3_500]]);
  });

  it("time spent waiting in a queue is not part of the request's timeout, but time on the wire is", async () => {
    // B's first hop takes 600 ms of a 1000 ms timeout, then waits 3.5 s for arXiv's queue; its second hop still has 400 ms.
    const first = stubFetch(clock, (url) => {
      if (url === arxiv(1)) return { ms: 500 };
      if (url === "https://example.org/ut-sample/old") return { location: arxiv(2), ms: 600 };
      return { ms: 300 };
    });
    const [, waited] = await clock.run(Promise.all([fetchFeed(arxiv(1), { retryDelayMs: 0 }), fetchFeed("https://example.org/ut-sample/old", { retryDelayMs: 0, timeoutMs: 1_000 })]));
    expect(waited).toMatchObject({ ok: true });
    expect(first.find((c) => c.url === arxiv(2))!.start).toBe(3_500);
    // The same chain with a second hop that has no time left on the wire ends as a timeout, without a request.
    vi.unstubAllGlobals();
    resetRateQueues();
    const second = stubFetch(clock, (url) => (url === "https://example.org/ut-sample/old" ? { location: "https://example.org/ut-sample/new", ms: 1_200 } : {}));
    const spent = await clock.run(fetchFeed("https://example.org/ut-sample/old", { retryDelayMs: 0, timeoutMs: 1_000 }));
    expect(spent).toMatchObject({ ok: false, error: "timeout", detail: "no time left for the request", finalUrl: "https://example.org/ut-sample/new", attempts: 1 });
    expect(second.map((c) => c.url)).toEqual(["https://example.org/ut-sample/old"]);
  });

  it("waiting in a queue counts against the deadline: a request that cannot start by it is a timeout and is never sent", async () => {
    const calls = stubFetch(clock);
    const [a, b, c] = await clock.run(Promise.all([
      fetchFeed(arxiv(1), { retryDelayMs: 0 }),
      fetchFeed(arxiv(2), { retryDelayMs: 0, deadline: clock.t + 1_000 }),
      fetchFeed(arxiv(3), { retryDelayMs: 0 }),
    ]));
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, error: "timeout", attempts: 1, detail: "deadline passed while waiting for its turn" });
    expect(c.ok).toBe(true);
    // B gave up at its deadline without sending anything, and C did not wait for B: it started 3 s after A ended.
    expect(calls.map((x) => [x.url, x.start])).toEqual([[arxiv(1), 0], [arxiv(3), 3_000]]);
    expect(b.durationMs).toBe(1_000);
  });

  it("a spaced queue gives up at the deadline too, and the retry is skipped when it would cross the deadline", async () => {
    const calls = stubFetch(clock);
    const [a, b] = await clock.run(Promise.all([
      fetchFeed(openalex(1), { retryDelayMs: 0 }),
      fetchFeed(openalex(2), { retryDelayMs: 2_000, deadline: clock.t + 500 }),
    ]));
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, error: "timeout", attempts: 1 });
    expect(starts(calls)).toEqual([0]);
  });

  it("a request whose deadline is already past never joins a queue", async () => {
    const calls = stubFetch(clock);
    const r = await clock.run(fetchFeed(arxiv(1), { retryDelayMs: 0, deadline: clock.t - 1 }));
    expect(r).toMatchObject({ ok: false, error: "timeout", attempts: 0 });
    expect(calls).toEqual([]);
    expect(clock.sleeps).toEqual([]);
  });

  it("reads the duration and the retry delay on the same clock", async () => {
    stubFetch(clock, (_url, n) => (n === 1 ? { status: 500, ms: 40 } : { ms: 60 }));
    const r = await clock.run(fetchFeed("https://example.org/ut-sample/x", { retryDelayMs: 2_000 }));
    expect(r).toMatchObject({ ok: true, attempts: 2, durationMs: 40 + 2_000 + 60 });
  });

  it("resetRateQueues() forgets the last request, and setHttpClock(null) puts the real clock back", async () => {
    const calls = stubFetch(clock);
    await clock.run(fetchFeed(arxiv(1), { retryDelayMs: 0 }));
    resetRateQueues();
    await clock.run(fetchFeed(arxiv(2), { retryDelayMs: 0 }));
    expect(starts(calls)).toEqual([0, 0]);
    setHttpClock(null);
    const before = clock.sleeps.length;
    vi.stubGlobal("fetch", async () => new Response("real", { status: 200 }));
    const r = await fetchFeed("https://example.org/ut-sample/real", { retryDelayMs: 0 });
    expect(r.ok).toBe(true);
    expect(clock.sleeps.length).toBe(before);
    expect(Math.abs(r.durationMs)).toBeLessThan(5_000);
  });

  it("fixture mode skips every wait: three arXiv answers in a row, and the clock is never asked to wait", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-http-rate-"));
    try {
      fs.writeFileSync(path.join(dir, "a.xml"), "<feed/>");
      fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ [arxiv(1)]: { file: "a.xml" }, [arxiv(2)]: { file: "a.xml" }, [filter(1)]: { file: "a.xml" }, [filter(2)]: { file: "a.xml" } }));
      vi.stubEnv("UT_FIXTURE_FEEDS", dir);
      const results = await Promise.all([arxiv(1), arxiv(2), filter(1), filter(2), arxiv(3)].map((u) => fetchFeed(u)));
      expect(results.map((r) => r.error)).toEqual([null, null, null, null, "dns"]);
      expect(clock.sleeps).toEqual([]);
      expect(clock.elapsed).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── The edges of the rules, on the fake clock ────────────────────────────────────────────────────

describe("fetchFeed: the table and the edges of its rules", () => {
  let clock: FakeClock;
  beforeEach(() => {
    resetRateQueues();
    clock = new FakeClock();
    setHttpClock(clock);
  });
  afterEach(() => {
    setHttpClock(null);
    resetRateQueues();
  });

  const url = (n: number) => `https://sample.example/ut-sample/${n}`;
  const openalex = (n: number) => `https://api.openalex.org/works?filter=type:article&n=${n}`;
  const crossref = (path: string) => `https://api.crossref.org/${path}`;

  it("pins the defaults and the provisional per-feed values (15 s, 5 MB; Kobol sets the arXiv list and Retraction Watch ones)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
    expect(DEFAULT_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(FEED_TIMEOUTS).toEqual({ default: 15_000, arxivList: 45_000, retractionWatch: 90_000 });
    expect(FEED_MAX_BYTES).toEqual({ default: 5_242_880, arxivList: 10_485_760, retractionWatch: 134_217_728 });
  });

  it("applies the 5 MB default cap: a body of exactly 5 MB is read, one byte more is too_large", async () => {
    vi.stubGlobal("fetch", async () => new Response(Buffer.alloc(DEFAULT_MAX_BYTES, 0x61), { status: 200 }));
    const exact = await clock.run(fetchFeed(url(1), { retryDelayMs: 0 }));
    expect(exact).toMatchObject({ ok: true, error: null });
    expect(exact.body?.length).toBe(DEFAULT_MAX_BYTES);
    vi.stubGlobal("fetch", async () => new Response(Buffer.alloc(DEFAULT_MAX_BYTES + 1, 0x61), { status: 200 }));
    expect(await clock.run(fetchFeed(url(2), { retryDelayMs: 0 }))).toMatchObject({ ok: false, error: "too_large", body: null });
  });

  it("is ok from 200 to 299 and an http_<status> error from 300 up, whether or not a Location comes with it (only 301, 302, 303, 307 and 308 are redirects)", async () => {
    const answer = async (status: number, location?: string) => {
      vi.stubGlobal("fetch", async () => new Response(status === 304 || status === 204 ? null : "body", { status, headers: location ? { location } : {} }));
      return clock.run(fetchFeed(url(status), { retryDelayMs: 0 }));
    };
    expect(await answer(200)).toMatchObject({ ok: true, status: 200 });
    expect(await answer(204)).toMatchObject({ ok: true, status: 204 });
    expect(await answer(299)).toMatchObject({ ok: true, status: 299 });
    for (const status of [300, 304, 305, 306, 399, 400]) {
      expect(await answer(status), String(status)).toMatchObject({ ok: false, status, error: `http_${status}`, body: null, attempts: 1 });
      expect(await answer(status, "https://sample.example/ut-sample/elsewhere"), `${status} with a Location`).toMatchObject({ ok: false, status, error: `http_${status}` });
    }
  });

  it("follows each of the five redirect statuses to the Location", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const calls = stubFetch(clock, (u) => (u === url(status) ? { status, location: `${url(status)}/next` } : { body: "landed" }));
      const r = await clock.run(fetchFeed(url(status), { retryDelayMs: 0 }));
      expect(r, String(status)).toMatchObject({ ok: true, finalUrl: `${url(status)}/next`, attempts: 1 });
      expect(calls.map((c) => c.url)).toEqual([url(status), `${url(status)}/next`]);
    }
  });

  it("returns the content type of the answer, on success and on an error status", async () => {
    vi.stubGlobal("fetch", async () => new Response("<rss/>", { status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" } }));
    expect(await clock.run(fetchFeed(url(1), { retryDelayMs: 0 }))).toMatchObject({ ok: true, contentType: "application/rss+xml; charset=utf-8" });
    vi.stubGlobal("fetch", async () => new Response("gone", { status: 404, headers: { "content-type": "text/html" } }));
    expect(await clock.run(fetchFeed(url(2), { retryDelayMs: 0 }))).toMatchObject({ ok: false, error: "http_404", contentType: "text/html" });
    vi.stubGlobal("fetch", async () => new Response("plain", { status: 200 }));
    expect((await clock.run(fetchFeed(url(3), { retryDelayMs: 0 }))).contentType).toBe("text/plain;charset=UTF-8");
  });

  it("trusts a declared Content-Length over the cap, but not one that equals it", async () => {
    vi.stubGlobal("fetch", async () => new Response("0123456789", { status: 200, headers: { "content-length": "10000" } }));
    expect(await clock.run(fetchFeed(url(1), { retryDelayMs: 0, maxBytes: 100 }))).toMatchObject({ ok: false, error: "too_large", body: null });
    vi.stubGlobal("fetch", async () => new Response("0123456789", { status: 200, headers: { "content-length": "100" } }));
    const equal = await clock.run(fetchFeed(url(2), { retryDelayMs: 0, maxBytes: 100 }));
    expect(equal).toMatchObject({ ok: true });
    expect(equal.body?.toString()).toBe("0123456789");
  });

  it("returns an empty body for an answer with no body at all", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
    const r = await clock.run(fetchFeed(url(1), { retryDelayMs: 0 }));
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(Buffer.isBuffer(r.body)).toBe(true);
    expect(r.body?.length).toBe(0);
  });

  it("truncate cuts a chunk that crosses the cap and drops the ones after it", async () => {
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({
      start(c) {
        for (const part of ["aaaa", "bbbb", "cccc"]) c.enqueue(new TextEncoder().encode(part));
        c.close();
      },
    }), { status: 200 }));
    const cut = await clock.run(fetchFeed(url(1), { retryDelayMs: 0, maxBytes: 6, truncate: true }));
    expect(cut.body?.toString()).toBe("aaaabb");
    const whole = await clock.run(fetchFeed(url(2), { retryDelayMs: 0, maxBytes: 12, truncate: true }));
    expect(whole.body?.toString()).toBe("aaaabbbbcccc");
    const refused = await clock.run(fetchFeed(url(3), { retryDelayMs: 0, maxBytes: 11 }));
    expect(refused).toMatchObject({ ok: false, error: "too_large" });
  });

  it("a body that fails while it is read is an error of the class of the failure, with its text cut at 300 characters", async () => {
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.error(new Error(`E${"x".repeat(499)}`));
      },
    }), { status: 200 }));
    const r = await clock.run(fetchFeed(url(1), { retryDelayMs: 0 }));
    expect(r).toMatchObject({ ok: false, status: 200, error: "network", body: null, attempts: 1 });
    expect(r.detail).toBe(`E${"x".repeat(299)}`);
  });

  it("cuts the text of a rejected fetch at 300 characters, from its first", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error(`E${"x".repeat(499)}`); });
    const r = await clock.run(fetchFeed(url(1), { retryDelayMs: 0 }));
    expect(r).toMatchObject({ ok: false, error: "network" });
    expect(r.detail).toBe(`E${"x".repeat(299)}`);
  });

  it("reads time on the clock it was given: a result of no time has a duration of 0, whichever way it ends", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-http-edges-"));
    try {
      fs.writeFileSync(path.join(dir, "a.xml"), "<feed/>");
      fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ [url(1)]: { file: "a.xml" } }));
      vi.stubEnv("UT_FIXTURE_FEEDS", dir);
      expect(await fetchFeed(url(1))).toMatchObject({ ok: true, durationMs: 0 });
      expect(await fetchFeed(url(2))).toMatchObject({ ok: false, error: "dns", durationMs: 0 });
      // The unforeseen: a fixture folder that cannot be read, named by a path that is long enough to cut.
      vi.stubEnv("UT_FIXTURE_FEEDS", path.join(dir, "n".repeat(200), "m".repeat(200)));
      const lost = await fetchFeed(url(1));
      expect(lost).toMatchObject({ ok: false, error: "network", attempts: 0, durationMs: 0 });
      expect(lost.detail).toHaveLength(300);
      expect(lost.detail!.startsWith("ENOENT")).toBe(true);
      vi.unstubAllEnvs();
      expect(await fetchFeed(url(1), { deadline: clock.now() })).toMatchObject({ ok: false, error: "timeout", attempts: 0, durationMs: 0 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fixture mode: a saved file of exactly the cap is read, a byte under it is too_large, and 299 is ok but 300 and 301 are errors", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-http-edges-"));
    try {
      fs.writeFileSync(path.join(dir, "f.txt"), "z".repeat(50));
      fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
        [url(1)]: { file: "f.txt" }, [url(299)]: { status: 299 }, [url(300)]: { status: 300 }, [url(301)]: { status: 301 },
      }));
      vi.stubEnv("UT_FIXTURE_FEEDS", dir);
      expect(await fetchFeed(url(1), { maxBytes: 50 })).toMatchObject({ ok: true });
      expect(await fetchFeed(url(1), { maxBytes: 49 })).toMatchObject({ ok: false, error: "too_large" });
      expect(await fetchFeed(url(299))).toMatchObject({ ok: true, status: 299 });
      expect(await fetchFeed(url(300))).toMatchObject({ ok: false, status: 300, error: "http_300" });
      expect(await fetchFeed(url(301))).toMatchObject({ ok: false, status: 301, error: "http_301" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the deadline: a deadline that is now starts nothing (attempts 0), one 1 ms ahead still makes the request", async () => {
    const calls = stubFetch(clock);
    expect(await clock.run(fetchFeed(url(1), { retryDelayMs: 0, deadline: clock.now() }))).toMatchObject({ ok: false, error: "timeout", attempts: 0, durationMs: 0 });
    expect(calls).toEqual([]);
    expect(await clock.run(fetchFeed(url(2), { retryDelayMs: 0, deadline: clock.now() + 1 }))).toMatchObject({ ok: true, attempts: 1 });
    expect(calls.map((c) => c.url)).toEqual([url(2)]);
  });

  it("a retry that wakes up exactly at the deadline is not made: the attempt reports that the deadline passed before the request", async () => {
    const wake = clock.sleep.bind(clock);
    clock.sleep = (ms: number) => wake(ms + 1); // timers that run 1 ms late, as real ones do: the first answer arrives at 1 ms, the retry wakes at 102
    const calls = stubFetch(clock, () => ({ status: 503 }));
    const r = await clock.run(fetchFeed(url(1), { retryDelayMs: 100, deadline: clock.now() + 102 }));
    expect(r).toMatchObject({ ok: false, error: "timeout", attempts: 2, detail: "deadline passed before the request" });
    expect(calls).toHaveLength(1);
  });

  it("the retry: it happens for a delay of 1 ms, and not when it would start at the deadline itself", async () => {
    const calls = stubFetch(clock, (_u, n) => (n === 1 ? { status: 503 } : {}));
    expect(await clock.run(fetchFeed(url(1), { retryDelayMs: 1 }))).toMatchObject({ ok: true, attempts: 2 });
    expect(calls).toHaveLength(2);
    const t = clock.now();
    stubFetch(clock, () => ({ status: 503 }));
    expect(await clock.run(fetchFeed(url(2), { retryDelayMs: 100, deadline: t + 100 }))).toMatchObject({ ok: false, error: "http_503", attempts: 1 });
    // One millisecond more and the retry starts, with 1 ms of the deadline left to make its request in.
    const t2 = clock.now();
    const later = stubFetch(clock, (_u, n) => (n === 1 ? { status: 503 } : {}));
    expect(await clock.run(fetchFeed(url(3), { retryDelayMs: 100, deadline: t2 + 101 }))).toMatchObject({ ok: true, attempts: 2 });
    expect(later).toHaveLength(2);
  });

  it("the attempt's time: redirect hops share timeoutMs, so a second hop with none left is never requested, and one with 1 ms left is", async () => {
    const hopsOf = async (timeoutMs: number) => {
      const calls = stubFetch(clock, (u) => (u === url(1) ? { status: 302, location: url(2), ms: 100 } : { body: "landed" }));
      const r = await clock.run(fetchFeed(url(1), { retryDelayMs: 0, timeoutMs }));
      return { r, urls: calls.map((c) => c.url) };
    };
    const spent = await hopsOf(100);
    expect(spent.r).toMatchObject({ ok: false, error: "timeout", attempts: 1 });
    expect(spent.r.detail).toBe("no time left for the request");
    expect(spent.urls).toEqual([url(1)]);
    const left = await hopsOf(101);
    expect(left.r).toMatchObject({ ok: true, finalUrl: url(2) });
    expect(left.urls).toEqual([url(1), url(2)]);
    const tight = await hopsOf(99);
    expect(tight.r).toMatchObject({ ok: false, error: "timeout" });
    expect(tight.urls).toEqual([url(1)]);
  });

  it("a queue wait of 1 ms is waited out: OpenAlex's second request, asked at 999 ms, starts at 1,000", async () => {
    const calls = stubFetch(clock);
    await clock.run(fetchFeed(openalex(1), { retryDelayMs: 0 }));
    await clock.run(clock.sleep(999));
    await clock.run(fetchFeed(openalex(2), { retryDelayMs: 0 }));
    expect(calls.map((c) => c.start)).toEqual([0, 1_000]);
  });

  it("Crossref: only a path that starts with works/ is a record; works/ deeper down is a list, a second apart", async () => {
    const calls = stubFetch(clock);
    await clock.run(Promise.all([fetchFeed(crossref("members/7/works/a"), { retryDelayMs: 0 }), fetchFeed(crossref("members/7/works/b"), { retryDelayMs: 0 })]));
    expect(calls.map((c) => c.start)).toEqual([0, 1_000]);
    const records = stubFetch(clock);
    const t = clock.elapsed;
    await clock.run(Promise.all([fetchFeed(crossref("works/10.1000/a"), { retryDelayMs: 0 }), fetchFeed(crossref("v1/works/10.1000/b"), { retryDelayMs: 0 })]));
    expect(records.map((c) => c.start - t)).toEqual([0, 200]);
  });

  it("a request to a host in capitals or with a trailing dot joins its queue", async () => {
    expect(rateQueueOf("https://API.OpenAlex.org/works")).toBe("openalex");
    expect(rateQueueOf("https://api.openalex.org./works")).toBe("openalex");
    expect(rateQueueOf("https://Export.arXiv.org/api/query")).toBe("arxiv");
  });
});
