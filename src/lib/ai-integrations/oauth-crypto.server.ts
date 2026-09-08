// ============================================================
// Kryptografiske hjelpere for OAuth — server-only.
//
// Ingen tredjepartsbibliotek. Web Crypto holder for HMAC-SHA256,
// SHA-256 og tilfeldige hemmeligheter.
// Klartekstkoder og -tokener logges aldri; bare hash lagres.
// ============================================================

const B64URL_ALPHABET = /^[A-Za-z0-9\-._~]+$/;

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function digest(value: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value) as unknown as ArrayBuffer,
  );
  return new Uint8Array(buf);
}

/** Heks-hash til lagring (koder, refresh tokens). */
export async function sha256Hex(value: string): Promise<string> {
  return Array.from(await digest(value))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** BASE64URL(SHA256(x)) uten padding — PKCE S256. */
export async function sha256B64Url(value: string): Promise<string> {
  return b64url(await digest(value));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** RFC 7636: 43–128 tegn fra unreserved-alfabetet. */
export function isValidCodeVerifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 43 &&
    value.length <= 128 &&
    B64URL_ALPHABET.test(value)
  );
}

/** code_challenge er base64url uten padding, samme lengde som en SHA-256. */
export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9\-_]{43}$/.test(value);
}

export async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data) as unknown as ArrayBuffer);
  return b64url(new Uint8Array(mac));
}

export async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  return timingSafeEqual(await hmacSign(data, secret), signature);
}

/**
 * Hemmeligheten for OAuth-signaturer er BEVISST en annen enn den gamle
 * agenttokennøkkelen. Et legacy claim-token kan derfor aldri verifisere
 * som OAuth-token, og omvendt.
 */
export function readOauthSecret(): string | null {
  const secret = process.env["AI_INTEGRATION_OAUTH_SECRET"];
  if (!secret || secret.length < 32) return null;
  return secret;
}
