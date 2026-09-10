import { describe, expect, it } from "vitest";
import {
  buildCimdFetchInit,
  isCimdRedirectResponse,
} from "@/lib/ai-integrations/oauth-cimd.server";

describe("CIMD-henting i serverkjøretiden", () => {
  it("bruker en redirect-modus som workerd faktisk støtter", () => {
    const init = buildCimdFetchInit(new AbortController().signal);
    // `error` kaster TypeError i Cloudflare workerd og ga fetch_failed i produksjon.
    expect(init.redirect).not.toBe("error");
    expect(init.redirect).toBe("manual");
  });

  it("beholder metode, Accept-header og abort-signal", () => {
    const controller = new AbortController();
    const init = buildCimdFetchInit(controller.signal);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(init.signal).toBe(controller.signal);
  });

  it("avviser omdirigeringer i stedet for å følge dem", () => {
    for (const status of [301, 302, 303, 307, 308]) {
      expect(isCimdRedirectResponse({ status })).toBe(true);
    }
    expect(isCimdRedirectResponse({ status: 200, type: "opaqueredirect" })).toBe(true);
  });

  it("godtar vanlige svar uten omdirigering", () => {
    expect(isCimdRedirectResponse({ status: 200, type: "default" })).toBe(false);
    expect(isCimdRedirectResponse({ status: 404 })).toBe(false);
  });
});
