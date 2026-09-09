// POST /api/public/oauth/register (RFC 7591) — KOMPATIBILITETSFALLBACK
//
// Foretrukket vei er CIMD: client_id er en https-URL til klientens eget
// metadatadokument, og ingen registrering trengs. DCR finnes bare for
// klienter som ikke støtter CIMD, og er AV som standard. Uten
// OAUTH_DYNAMIC_REGISTRATION=enabled svarer ruten 404, og
// registration_endpoint annonseres da heller ikke i discovery.
//
// Når den er slått på:
//   - kun public clients; det utstedes aldri en client_secret
//   - redirect_uris må treffe en EKSAKT allowliste (kjente callbacker
//     for ChatGPT og Claude, pluss driftsstyrte adresser)
//   - ingen loopback, ingen private adresser, ingen wildcard, ingen
//     userinfo, fragment eller ukjent port
//   - Microsoft Copilot og Grok har ingen innebygde adresser og er
//     blokkert til drift konfigurerer en faktisk callback
//   - klienten får kort utløp og ryddes bort automatisk
//   - distribuert ratebegrensning via den atomiske databasetelleren

import { createFileRoute } from "@tanstack/react-router";
import { dynamicRegistrationEnabled } from "@/lib/ai-integrations/oauth-config.server";
import { OAUTH_SCOPES, isValidScopeSet } from "@/lib/ai-integrations/oauth-contract";
import {
  isAllowlistedDcrRedirect,
  parseExtraRedirectAllowlist,
} from "@/lib/ai-integrations/oauth-client-policy";
import { randomToken } from "@/lib/ai-integrations/oauth-crypto.server";
import { claimRateCheck } from "@/lib/ai-integrations/claim-rate-limit.server";
import { admin } from "@/lib/ai-integrations/oauth-store.server";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** Maks størrelse på registreringsforespørselen. */
export const DCR_MAX_BODY_BYTES = 8 * 1024;
/** Registrerte DCR-klienter lever kort og revalideres ved behov. */
export const DCR_CLIENT_TTL_DAYS = 30;

/** Eksporteres for test: én enkelt redirect URI mot allowlisten. */
export function isRegistrableRedirectUri(value: unknown, extraAllowlist: string[] = []): boolean {
  return isAllowlistedDcrRedirect(value, extraAllowlist);
}

/** Eksporteres for test: faktisk UTF-8-lengde, ikke antall JS-tegn. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const Route = createFileRoute("/api/public/oauth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!dynamicRegistrationEnabled()) {
          return new Response("Not found", { status: 404, headers: noStore });
        }

        const source =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        const rate = await claimRateCheck(`oauth-register:${source}`);
        if (!rate.allowed) {
          return Response.json(
            { error: "invalid_request" },
            { status: rate.reason === "rate_limited" ? 429 : 500, headers: noStore },
          );
        }

        // Åpenbart for stor body avvises FØR den leses.
        const declared = Number(request.headers.get("content-length") ?? "");
        if (Number.isFinite(declared) && declared > DCR_MAX_BODY_BYTES) {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 413, headers: noStore },
          );
        }

        const raw = await request.text();
        // Grensen er UTF-8-byte, ikke JavaScript-tegn (multibyte teller riktig).
        if (utf8ByteLength(raw) > DCR_MAX_BODY_BYTES) {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 413, headers: noStore },
          );
        }

        let body: Record<string, unknown>;
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 400, headers: noStore },
          );
        }
        if (!body || typeof body !== "object" || Object.keys(body).length > 20) {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 400, headers: noStore },
          );
        }

        const name = body["client_name"];
        const uris = body["redirect_uris"];
        const authMethod = body["token_endpoint_auth_method"];
        if (typeof name !== "string" || name.trim() === "" || name.length > 120) {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 400, headers: noStore },
          );
        }
        if (authMethod !== undefined && authMethod !== "none") {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 400, headers: noStore },
          );
        }

        const extra = parseExtraRedirectAllowlist(process.env["OAUTH_EXTRA_REDIRECT_URIS"]);
        if (
          !Array.isArray(uris) ||
          uris.length === 0 ||
          uris.length > 3 ||
          new Set(uris).size !== uris.length ||
          !uris.every((u) => isRegistrableRedirectUri(u, extra))
        ) {
          return Response.json(
            { error: "invalid_redirect_uri" },
            { status: 400, headers: noStore },
          );
        }

        const requested =
          typeof body["scope"] === "string"
            ? (body["scope"] as string).trim().split(/\s+/).filter(Boolean)
            : [...OAUTH_SCOPES];
        if (!isValidScopeSet(requested)) {
          return Response.json({ error: "invalid_scope" }, { status: 400, headers: noStore });
        }

        const clientId = `dcr_${randomToken(16)}`;
        const expiresAt = new Date(
          Date.now() + DCR_CLIENT_TTL_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        const db = await admin();

        // Opportunistisk opprydding av utløpte DCR-klienter. Fail closed:
        // klarer vi ikke å rydde, registrerer vi heller ikke en ny klient.
        const cleanup = await db.rpc("oauth_cleanup_expired_clients");
        if (cleanup.error) {
          return Response.json({ error: "server_error" }, { status: 503, headers: noStore });
        }

        const { data: inserted, error } = await db
          .from("oauth_clients")
          .insert({
            client_id: clientId,
            client_name: name.trim(),
            client_type: "public",
            redirect_uris: uris as string[],
            allowed_scopes: requested,
            registration_method: "dcr",
            expires_at: expiresAt,
          })
          .select("id")
          .maybeSingle();
        if (error || !inserted) {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 400, headers: noStore },
          );
        }

        // Sikkerhetslogg uten hemmeligheter eller persondata.
        await db.from("oauth_security_events").insert({
          event_type: "dcr_client_registered",
          client_row_id: (inserted as { id: string }).id,
          detail: { redirect_uri_count: uris.length },
        });

        return Response.json(
          {
            client_id: clientId,
            client_name: name.trim(),
            redirect_uris: uris,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
            scope: requested.join(" "),
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_secret_expires_at: 0,
          },
          { status: 201, headers: noStore },
        );
      },
    },
  },
});
