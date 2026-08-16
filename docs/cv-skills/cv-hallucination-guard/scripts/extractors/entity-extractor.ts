// cv-hallucination-guard — Entity extractor
// Trekker ut navn-claims (selskap, institusjon) fra tekst.
//
// Strategi: Vi har ikke en NER-modell tilgjengelig, så vi bruker:
//   1. Eksplisitt liste av kjente entiteter fra atoms (passes inn som hint)
//   2. Heuristikk: capitalized phrases som ikke er starten av setning
//
// Edge-funksjonen passer inn liste av selskaper/institusjoner fra atoms
// som candidate-entiteter, og guarden sjekker hvilke som faktisk dukker
// opp i AI-tekst.

import type { AtomLike, ExtractedClaim } from "../types.ts";

interface EntityHint {
  text: string;
  kind: "company" | "institution" | "certification" | "tool";
  source_atom_id: string;
}

// ---------------------------------------------------------------------------
// Hovedfunksjon
// ---------------------------------------------------------------------------

export function extractEntityClaims(
  text: string,
  hints: EntityHint[],
): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();

  for (const hint of hints) {
    // Skip kortere enn 3 tegn (for støy-reduksjon)
    if (hint.text.length < 3) continue;

    const regex = new RegExp(`\\b${escapeRegex(hint.text)}\\b`, "gi");
    for (const match of text.matchAll(regex)) {
      const key = `${hint.text.toLowerCase()}:${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);

      claims.push({
        type: "entity",
        text: match[0],
        position: match.index ?? 0,
        parsed: {
          kind: hint.kind,
          name: hint.text,
          source_atom_id: hint.source_atom_id,
        },
        is_hard: true,
      });
    }
  }

  return claims;
}

/**
 * Bygg entitet-hints fra et sett med atoms. Brukes typisk slik:
 *
 *   const hints = buildEntityHintsFromAtoms(userAtoms);
 *   const claims = extractEntityClaims(text, hints);
 */
export function buildEntityHintsFromAtoms(atoms: AtomLike[]): EntityHint[] {
  const hints: EntityHint[] = [];

  for (const atom of atoms) {
    const sd = (atom.structured_data ?? {}) as Record<string, unknown>;

    if (atom.atom_type === "role") {
      const employer = typeof sd.employer === "string" ? sd.employer : null;
      if (employer) {
        hints.push({ text: employer, kind: "company", source_atom_id: atom.id });
      }
    }

    if (atom.atom_type === "education") {
      const institution = typeof sd.institution === "string" ? sd.institution : null;
      if (institution) {
        hints.push({ text: institution, kind: "institution", source_atom_id: atom.id });
      }
    }

    if (atom.atom_type === "certification") {
      const name = typeof sd.name === "string" ? sd.name : null;
      const issuer = typeof sd.issuer === "string" ? sd.issuer : null;
      if (name) hints.push({ text: name, kind: "certification", source_atom_id: atom.id });
      if (issuer) hints.push({ text: issuer, kind: "certification", source_atom_id: atom.id });
    }

    if (atom.atom_type === "tool") {
      const name = typeof sd.name === "string" ? sd.name : null;
      if (name) hints.push({ text: name, kind: "tool", source_atom_id: atom.id });
    }
  }

  return hints;
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
