import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

// Sikkerhetsheadere. CSP kjøres i Report-Only først: vi håndhever ikke før
// rapporten har vært stille. Rutene under /api/public/* kalles av eksterne
// tjenester og av databasens planlegger, og får ingen headere.
const APP_SUPABASE_URL = "https://miwzhbludgwvskmsfqnq.supabase.co";
const MARKET_SUPABASE_URL = "https://wcaqfupjatnjwbgatzjv.supabase.co";

function buildCsp(allowFraming: boolean): string {
  const directives = [
    "default-src 'self'",
    // Vite/TanStack injiserer inline-skript for hydrering.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${APP_SUPABASE_URL} wss://miwzhbludgwvskmsfqnq.supabase.co ${MARKET_SUPABASE_URL} https://fonts.googleapis.com https://fonts.gstatic.com`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  // Forhåndsvisningen i byggeverktøyet kjører i iframe — der rammes ikke framing inn.
  if (!allowFraming) directives.push("frame-ancestors 'none'");
  return directives.join("; ");
}

function withSecurityHeaders(response: Response, request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/public/")) return response;

  const isPublishedHost =
    url.hostname === "karrierenmin.no" ||
    url.hostname === "www.karrierenmin.no" ||
    url.hostname === "mycareer-blank-slate.lovable.app";

  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy-Report-Only", buildCsp(!isPublishedHost));
  if (isPublishedHost) headers.set("X-Frame-Options", "DENY");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), request);
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(brandedErrorResponse(), request);
    }
  },
};
