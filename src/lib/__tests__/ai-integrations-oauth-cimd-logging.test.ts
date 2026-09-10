import { describe, expect, it } from "vitest";
import {
  CIMD_RESOLUTION_FAILED_EVENT,
  buildCimdFailureLog,
} from "@/lib/ai-integrations/oauth-cimd.server";

describe("CIMD-feillogg", () => {
  it("tar med kun stabilt event, årsak, origin og bane", () => {
    const log = buildCimdFailureLog(
      "https://chatgpt.com/oauth/codex/client.json?state=abc&code_challenge=xyz#frag",
      "fetch_status",
    );
    expect(log).toEqual({
      event: CIMD_RESOLUTION_FAILED_EVENT,
      reason: "fetch_status",
      metadata_origin: "https://chatgpt.com",
      metadata_path: "/oauth/codex/client.json",
    });
  });

  it("lekker aldri query, fragment eller hemmeligheter i serialisert form", () => {
    const serialized = JSON.stringify(
      buildCimdFailureLog(
        "https://evil.example/doc.json?token=SECRET_TOKEN&state=SECRET_STATE&code=SECRET_CODE",
        "store_failed",
      ),
    );
    for (const secret of ["SECRET_TOKEN", "SECRET_STATE", "SECRET_CODE", "token=", "state=", "?"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("håndterer ugyldig URL uten å lekke inndata", () => {
    const log = buildCimdFailureLog("not a url ?state=SECRET", "invalid_url");
    expect(log.metadata_origin).toBe("unknown");
    expect(log.metadata_path).toBe("unknown");
    expect(JSON.stringify(log)).not.toContain("SECRET");
  });

  it("bruker et stabilt hendelsesnavn", () => {
    expect(CIMD_RESOLUTION_FAILED_EVENT).toBe("oauth_cimd_resolution_failed");
  });
});
