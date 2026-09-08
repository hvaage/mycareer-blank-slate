// ============================================================
// Distribuert ratebegrensning for claim — server-only.
//
// Lagres i public.claim_rate_events, slik at grensen gjelder på tvers av
// alle serverinstanser (den gamle per-instans-tellingen i minnet gjorde
// ikke det, og er fjernet).
//
// PERSONVERN: tabellen inneholder ALDRI engangskode, e-post, token eller
// annen persondata. Kilden (IP) lagres kun som HMAC-SHA256 med en egen
// hemmelighet, CLAIM_RATE_HASH_SECRET, som ikke deles med tokensigneringen.
// Hashen kan ikke reverseres til IP uten hemmeligheten, og brukes bare til
// telling.
//
// FAIL CLOSED: mangler hemmeligheten, eller feiler lagringen, avvises
// forsøket. Vi slipper heller en ærlig bruker gjennom en ny kode enn å
// åpne for ubegrenset gjetting.
// ============================================================

export const CLAIM_MAX_ATTEMPTS = 10;
export const CLAIM_WINDOW_MS = 10 * 60_000;
/** Rader eldre enn dette ryddes bort fortløpende. */
export const CLAIM_RETENTION_MS = 24 * 60 * 60_000;

/**
 * Kilde-nøkkel for begrensningen, i dokumentert tillitsrekkefølge.
 *
 * 1. `cf-connecting-ip` settes av Cloudflare-edge og kan ikke overstyres
 *    av klienten. Dette er den eneste headeren vi stoler fullt på.
 * 2. `x-forwarded-for` (første ledd) er kun trygg når edge/proxy
 *    *overskriver* headeren på hver innkommende forespørsel. Prosjektet
 *    kjører bak Cloudflare, som gjør det.
 * 3. `x-real-ip`, ellers `unknown` — én felles bøtte for trafikk uten
 *    kjent kilde.
 */
export function claimClientKey(request: Request): string {
  const edgeIp = request.headers.get("cf-connecting-ip");
  if (edgeIp) return edgeIp.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function readHashSecret(): string | null {
  const secret = process.env["CLAIM_RATE_HASH_SECRET"];
  if (!secret || secret.length < 32) return null;
  return secret;
}

export function isClaimRateStorageConfigured(): boolean {
  return readHashSecret() !== null;
}

/** HMAC-SHA256 av kildeidentifikatoren. Rå IP lagres aldri. */
export async function hashClaimSource(source: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(source) as unknown as ArrayBuffer);
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ClaimRateOutcome =
  | { allowed: true }
  | { allowed: false; reason: "not_configured" | "storage_error" | "rate_limited" };

/**
 * Ett atomisk databasekall. Låsing, opprydding, registrering og telling
 * skjer i samme transaksjon i `public.claim_rate_check`, slik at to
 * samtidige forsøk fra samme kilde ikke kan omgå grensen (det gamle
 * insert-så-tell-mønsteret var to operasjoner og ikke atomisk).
 *
 * Funksjonen returnerer bare `allowed` og `attempts` — aldri rådata.
 */
export type ClaimRateRpc = (args: {
  p_source_hash: string;
  p_max_attempts: number;
  p_window_seconds: number;
  p_retention_seconds: number;
}) => Promise<{ data: unknown; error: unknown }>;

async function defaultRpc(): Promise<ClaimRateRpc> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return (args) =>
    (
      supabaseAdmin as unknown as {
        rpc: (fn: string, a: unknown) => Promise<{ data: unknown; error: unknown }>;
      }
    ).rpc("claim_rate_check", args);
}

function readAllowed(data: unknown): boolean | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== "object" || row === null) return null;
  const allowed = (row as Record<string, unknown>)["allowed"];
  return typeof allowed === "boolean" ? allowed : null;
}

/**
 * Registrerer forsøket og avgjør om det skal slippe gjennom.
 * Koden sendes aldri hit inn. Fail closed ved enhver feil.
 */
export async function claimRateCheck(
  source: string,
  options: { rpc?: ClaimRateRpc } = {},
): Promise<ClaimRateOutcome> {
  const secret = readHashSecret();
  if (!secret) return { allowed: false, reason: "not_configured" };

  try {
    const rpc = options.rpc ?? (await defaultRpc());
    const sourceHash = await hashClaimSource(source, secret);
    const { data, error } = await rpc({
      p_source_hash: sourceHash,
      p_max_attempts: CLAIM_MAX_ATTEMPTS,
      p_window_seconds: Math.floor(CLAIM_WINDOW_MS / 1000),
      p_retention_seconds: Math.floor(CLAIM_RETENTION_MS / 1000),
    });
    if (error) return { allowed: false, reason: "storage_error" };

    const allowed = readAllowed(data);
    if (allowed === null) return { allowed: false, reason: "storage_error" };
    return allowed ? { allowed: true } : { allowed: false, reason: "rate_limited" };
  } catch {
    return { allowed: false, reason: "storage_error" };
  }
}
