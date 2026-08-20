// Serveronly: HMAC-hjelpere for LinkedIn-nettverksavstemming (Leveranse B).
//
// Brukes til å utlede en stabil, ikke-reverserbar identitetshash for
// LinkedIn-forbindelser når vi ikke ønsker å lagre rå navn/URL i klartekst
// i avstemmingstabellene. Hemmeligheten leses kun inne i handlere, aldri
// på modulnivå.

import { normKey } from "./reconciliation/contract.server";

/** HMAC-SHA256 av `message` med `key`, returnert som heksadesimal streng. */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Deterministisk, hemmelighetsavhengig identitetshash for en LinkedIn-forfatter
 * (f.eks. avsender av en anbefaling eller en nettverksforbindelse).
 */
export async function hashRecommendationAuthor(params: {
  authorName: string | null;
  profileUrl: string | null;
  secret: string;
}): Promise<string> {
  const canonical = JSON.stringify({
    v: "linkedin_author_v1",
    name: normKey(params.authorName) || null,
    url: normKey(params.profileUrl) || null,
  });
  return hmacSha256Hex(params.secret, canonical);
}
