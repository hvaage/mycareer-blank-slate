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

type RateStore = {
  insert: (sourceHash: string, occurredAt: string) => Promise<{ error: unknown }>;
  count: (
    sourceHash: string,
    sinceIso: string,
  ) => Promise<{ count: number | null; error: unknown }>;
  cleanup: (beforeIso: string) => Promise<void>;
};

async function defaultStore(): Promise<RateStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const table = () => supabaseAdmin.from("claim_rate_events");
  return {
    insert: async (sourceHash, occurredAt) =>
      await table().insert({ source_hash: sourceHash, occurred_at: occurredAt }),
    count: async (sourceHash, sinceIso) =>
      await table()
        .select("id", { count: "exact", head: true })
        .eq("source_hash", sourceHash)
        .gte("occurred_at", sinceIso),
    cleanup: async (beforeIso) => {
      await table().delete().lt("occurred_at", beforeIso);
    },
  };
}

/**
 * Registrerer forsøket og avgjør om det skal slippe gjennom.
 * Koden sendes aldri hit inn.
 */
export async function claimRateCheck(
  source: string,
  options: { now?: Date; store?: RateStore } = {},
): Promise<ClaimRateOutcome> {
  const secret = readHashSecret();
  if (!secret) return { allowed: false, reason: "not_configured" };

  const now = options.now ?? new Date();
  const store = options.store ?? (await defaultStore());
  const sourceHash = await hashClaimSource(source, secret);

  try {
    const inserted = await store.insert(sourceHash, now.toISOString());
    if (inserted.error) return { allowed: false, reason: "storage_error" };

    const since = new Date(now.getTime() - CLAIM_WINDOW_MS).toISOString();
    const { count, error } = await store.count(sourceHash, since);
    if (error || typeof count !== "number") return { allowed: false, reason: "storage_error" };

    // Opportunistisk opprydding; feiler den, påvirker det ikke avgjørelsen.
    if (count % 25 === 0) {
      void store
        .cleanup(new Date(now.getTime() - CLAIM_RETENTION_MS).toISOString())
        .catch(() => undefined);
    }

    if (count > CLAIM_MAX_ATTEMPTS) return { allowed: false, reason: "rate_limited" };
    return { allowed: true };
  } catch {
    return { allowed: false, reason: "storage_error" };
  }
}
