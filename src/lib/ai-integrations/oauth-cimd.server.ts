// ============================================================
// Henting og validering av Client ID Metadata Documents — server-only.
//
// Sikkerhetsrammene:
//   - kun eksplisitt tillatte verter og baner (oauth-client-policy)
//   - redirect: "error" — vi følger aldri en omdirigering
//   - 3 sekunders timeout
//   - maks 32 kB respons, lest som strøm og avbrutt ved overskridelse
//   - Content-Type må være JSON
//   - metadata kan aldri utvide serverens tillatelser
//   - resultatet caches i databasen med utløp og revalideres når det går ut
// ============================================================

import {
  checkCimdUrl,
  validateCimdMetadata,
  type CimdMetadata,
} from "@/lib/ai-integrations/oauth-client-policy";
import { admin } from "@/lib/ai-integrations/oauth-store.server";
import type { ClientRecord } from "@/lib/ai-integrations/oauth-request";

export const CIMD_TIMEOUT_MS = 3000;
export const CIMD_MAX_BYTES = 32 * 1024;
/** Hvor lenge et validert dokument kan gjenbrukes før ny henting. */
export const CIMD_CACHE_TTL_SECONDS = 60 * 60 * 6;

export type CimdResult = { ok: true; client: ClientRecord } | { ok: false; reason: string };

async function readLimited(response: Response): Promise<string | null> {
  const body = response.body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > CIMD_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Løser en client_id som er en CIMD-URL til en registrert klientrad.
 * Gyldig cache brukes direkte; utløpt eller manglende cache henter på nytt.
 */
export async function resolveCimdClient(clientIdUrl: string): Promise<CimdResult> {
  const check = checkCimdUrl(clientIdUrl);
  if (!check.ok) return { ok: false, reason: check.reason };

  const db = await admin();
  const { data: cached } = await db
    .from("oauth_clients")
    .select(
      "id, client_id, client_name, client_type, is_active, redirect_uris, allowed_scopes, registration_method, metadata_expires_at",
    )
    .eq("client_id", clientIdUrl)
    .maybeSingle();

  const cachedRow = cached as
    | (ClientRecord & {
        registration_method?: string;
        metadata_expires_at?: string | null;
      })
    | null;

  if (cachedRow?.registration_method === "manual") {
    // En forhåndsregistrert klient overstyres aldri av et hentet dokument.
    return cachedRow.is_active
      ? { ok: true, client: cachedRow }
      : { ok: false, reason: "inactive_client" };
  }

  const fresh =
    cachedRow?.is_active === true &&
    cachedRow.metadata_expires_at != null &&
    new Date(cachedRow.metadata_expires_at).getTime() > Date.now();
  if (cachedRow && fresh) return { ok: true, client: cachedRow };

  // Henting med streng ramme.
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIMD_TIMEOUT_MS);
  try {
    response = await fetch(check.url, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    return { ok: false, reason: "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) return { ok: false, reason: "fetch_status" };
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) return { ok: false, reason: "content_type" };

  const text = await readLimited(response);
  if (text === null) return { ok: false, reason: "too_large" };

  let metadata: CimdMetadata;
  try {
    metadata = JSON.parse(text) as CimdMetadata;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!metadata || typeof metadata !== "object") return { ok: false, reason: "invalid_json" };

  const validated = validateCimdMetadata(metadata, { url: check.url, policy: check.policy });
  if (!validated.ok) return { ok: false, reason: validated.reason };

  const expiresAt = new Date(Date.now() + CIMD_CACHE_TTL_SECONDS * 1000).toISOString();
  const { data: upserted, error } = await db.rpc("oauth_upsert_cimd_client", {
    p_client_id: check.url,
    p_client_name: validated.clientName,
    p_metadata_url: check.url,
    p_redirect_uris: validated.redirectUris,
    p_allowed_scopes: validated.scopes,
    p_metadata_expires_at: expiresAt,
  });
  if (error) return { ok: false, reason: "store_failed" };

  const row = (Array.isArray(upserted) ? upserted[0] : upserted) as ClientRecord | undefined;
  if (!row) return { ok: false, reason: "store_failed" };
  return { ok: true, client: row };
}

/** True når client_id ser ut som en CIMD-URL i det hele tatt. */
export function looksLikeCimdClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}
