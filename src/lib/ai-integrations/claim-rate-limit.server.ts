// ============================================================
// Grunnrate/abuse guard for claim — server-only.
//
// BEGRENSNING, UTEN PYNT: dette er en per-instans teller i minnet.
// Den bremser gjentatt gjetting fra samme kilde mot samme
// serverinstans, men er IKKE distribuert. En angriper som treffer
// flere instanser får tilsvarende flere forsøk.
//
// Robust distribuert begrensning krever egen lagring (en tabell etter
// mønsteret til inbound_email_rate_events). Det ville vært en
// skjemaendring, som dette oppdraget ikke tillater. Begrensningen er
// derfor dokumentert i docs/operations/ai-integrations-e2e-test-plan.md
// i stedet for å bli fremstilt som fullverdig.
//
// Selve engangskoden gir uansett hovedbeskyttelsen: 32 tegn fra et
// alfabet på 32, 15 minutters levetid og engangsbruk.
// ============================================================

export const CLAIM_MAX_ATTEMPTS = 10;
export const CLAIM_WINDOW_MS = 10 * 60_000;

const attempts = new Map<string, number[]>();

export function claimClientKey(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Returnerer true når forsøket skal avvises. Koden sendes aldri hit inn. */
export function claimRateLimited(key: string, now: number = Date.now()): boolean {
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < CLAIM_WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (v.every((t) => now - t >= CLAIM_WINDOW_MS)) attempts.delete(k);
  }
  return recent.length > CLAIM_MAX_ATTEMPTS;
}

/** Kun for tester. */
export function resetClaimRateLimit(): void {
  attempts.clear();
}
