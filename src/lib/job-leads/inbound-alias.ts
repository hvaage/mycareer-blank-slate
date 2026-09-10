// ============================================================
// Ugjettbar, ugjennomsiktig importadresse (alias) per bruker.
//
// Tokenet er 160 tilfeldige bit kodet som lowercase base32 (32 tegn).
// Det avledes ALDRI av bruker-id, e-post eller annet gjenkjennelig.
// Rene funksjoner uten I/O, slik at de kan testes uten database.
// ============================================================

export const ALIAS_TOKEN_PATTERN = /^[a-z2-7]{26,64}$/;

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const TOKEN_BYTES = 20; // 160 bit -> 32 base32-tegn

export function base32LowerEncode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Genererer et nytt alias-token. `randomBytes` injiseres kun i tester. */
export function generateAliasToken(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): string {
  return base32LowerEncode(randomBytes(TOKEN_BYTES));
}

function defaultRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

export function isValidAliasToken(token: string | null | undefined): boolean {
  return typeof token === "string" && ALIAS_TOKEN_PATTERN.test(token);
}

/** Henter alias-tokenet fra en mottakeradresse. Null når det ikke er et gyldig token. */
export function aliasTokenFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const inner = address.includes("<") ? (address.match(/<([^>]+)>/)?.[1] ?? address) : address;
  const local = inner.split("@")[0]?.trim().toLowerCase();
  if (!local) return null;
  // Fjern plus-adressering: token+noe@domene
  const base = local.split("+")[0];
  return isValidAliasToken(base) ? base : null;
}

export function formatInboundAddress(token: string, domain: string): string | null {
  if (!isValidAliasToken(token)) return null;
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  if (!d || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  return `${token}@${d}`;
}
