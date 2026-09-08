// Engangskode for AI-oppsett. Kun koden lages her; lagring skjer i serverruten,
// og bare hashen lagres. Klartekstkoden logges aldri.

import { SETUP_CODE_ALPHABET, SETUP_CODE_LENGTH } from "@/lib/ai-integrations/contract";

export function generateSetupCode(): string {
  const bytes = new Uint8Array(SETUP_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  const size = SETUP_CODE_ALPHABET.length;
  let out = "";
  for (const b of bytes) out += SETUP_CODE_ALPHABET[b % size];
  return out;
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
