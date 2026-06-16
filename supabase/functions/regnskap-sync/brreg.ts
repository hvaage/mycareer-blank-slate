// Brreg-fetch med retry/backoff og lokal rate-limit. Port fra src/lib/regnskap-sync.brreg.ts.

const BASE = "https://data.brreg.no/regnskapsregisteret/regnskap";
const UA = "karrierenmin.no regnskap-sync (kontakt@karrierenmin.no)";
const REQ_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;

export type BrregFetchResult =
  | { kind: "ok"; status: number; data: unknown[]; latencyMs: number; attempts: number; http429: number; http503: number }
  | { kind: "no_regnskap"; status: number; latencyMs: number; attempts: number; http429: number; http503: number }
  | { kind: "not_found"; status: 404; latencyMs: number; attempts: number; http429: number; http503: number }
  | { kind: "forbidden"; status: 403; latencyMs: number; attempts: number; http429: number; http503: number }
  | { kind: "client_error"; status: number; latencyMs: number; attempts: number; http429: number; http503: number; error: string }
  | { kind: "retry_exhausted"; status: number | null; latencyMs: number; attempts: number; http429: number; http503: number; error: string };

export type PdfYearsResult =
  | { kind: "ok"; years: number[]; latencyMs: number; attempts: number }
  | { kind: "none"; years: number[]; latencyMs: number; attempts: number }
  | { kind: "error"; latencyMs: number; attempts: number; status: number | null; error: string };

export class RateLimiter {
  private last = 0;
  constructor(private rps: number) {}
  async take(): Promise<void> {
    const now = Date.now();
    const minGap = 1000 / Math.max(this.rps, 0.001);
    const wait = Math.max(0, this.last + minGap - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }
}

async function timedFetch(url: string): Promise<{ res: Response | null; ms: number; err?: string }> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: ctrl.signal });
    return { res, ms: Date.now() - t0 };
  } catch (e) {
    return { res: null, ms: Date.now() - t0, err: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30_000) + Math.floor(Math.random() * 500);
}

export async function fetchRegnskap(orgnr: string, limiter: RateLimiter): Promise<BrregFetchResult> {
  let attempts = 0, http429 = 0, http503 = 0, totalMs = 0;
  let lastErr = "", lastStatus: number | null = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts++;
    await limiter.take();
    const { res, ms, err } = await timedFetch(`${BASE}/${encodeURIComponent(orgnr)}`);
    totalMs += ms;
    if (!res) { lastErr = err ?? "network"; lastStatus = null; await new Promise((r) => setTimeout(r, backoffMs(i))); continue; }
    lastStatus = res.status;
    if (res.status === 200) {
      let body: unknown;
      try { body = await res.json(); } catch (e) {
        lastErr = `json: ${e instanceof Error ? e.message : String(e)}`;
        await new Promise((r) => setTimeout(r, backoffMs(i))); continue;
      }
      const arr = Array.isArray(body) ? body : [];
      if (arr.length === 0) return { kind: "no_regnskap", status: 200, latencyMs: totalMs, attempts, http429, http503 };
      return { kind: "ok", status: 200, data: arr, latencyMs: totalMs, attempts, http429, http503 };
    }
    if (res.status === 404) return { kind: "not_found", status: 404, latencyMs: totalMs, attempts, http429, http503 };
    if (res.status === 403) return { kind: "forbidden", status: 403, latencyMs: totalMs, attempts, http429, http503 };
    if (res.status === 429) { http429++; lastErr = "http 429"; await new Promise((r) => setTimeout(r, backoffMs(i))); continue; }
    if (res.status === 503 || res.status === 504) {
      if (res.status === 503) http503++;
      lastErr = `http ${res.status}`;
      await new Promise((r) => setTimeout(r, backoffMs(i))); continue;
    }
    if (res.status >= 400 && res.status < 500) {
      const text = await res.text().catch(() => "");
      return { kind: "client_error", status: res.status, latencyMs: totalMs, attempts, http429, http503, error: `http ${res.status}: ${text.slice(0, 200)}` };
    }
    lastErr = `http ${res.status}`;
    await new Promise((r) => setTimeout(r, backoffMs(i)));
  }
  return { kind: "retry_exhausted", status: lastStatus, latencyMs: totalMs, attempts, http429, http503, error: lastErr || "retries exhausted" };
}

export async function fetchPdfYears(orgnr: string, limiter: RateLimiter): Promise<PdfYearsResult> {
  let attempts = 0, totalMs = 0;
  let lastStatus: number | null = null, lastErr = "";
  for (let i = 0; i < 3; i++) {
    attempts++;
    await limiter.take();
    const { res, ms, err } = await timedFetch(`${BASE}/aarsregnskap/kopi/${encodeURIComponent(orgnr)}/aar`);
    totalMs += ms;
    if (!res) { lastErr = err ?? "network"; await new Promise((r) => setTimeout(r, backoffMs(i))); continue; }
    lastStatus = res.status;
    if (res.status === 200) {
      try {
        const body = await res.json();
        const years = Array.isArray(body) ? (body as unknown[]).map((v) => Number(v)).filter((v) => Number.isInteger(v)) : [];
        return years.length === 0
          ? { kind: "none", years: [], latencyMs: totalMs, attempts }
          : { kind: "ok", years, latencyMs: totalMs, attempts };
      } catch (e) { lastErr = `json: ${e instanceof Error ? e.message : String(e)}`; continue; }
    }
    if (res.status === 404) return { kind: "none", years: [], latencyMs: totalMs, attempts };
    if (res.status === 429 || res.status === 503 || res.status === 504) {
      lastErr = `http ${res.status}`;
      await new Promise((r) => setTimeout(r, backoffMs(i))); continue;
    }
    lastErr = `http ${res.status}`;
    break;
  }
  return { kind: "error", latencyMs: totalMs, attempts, status: lastStatus, error: lastErr || "pdf-years failed" };
}
