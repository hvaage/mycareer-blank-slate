/**
 * Standardroller som alle brukere skal ha tilgjengelig i CV-gjennomgangen.
 *
 * «Privat» og «Freelance» dekker erfaring som sjelden står som en stilling hos
 * en arbeidsgiver (frivillig arbeid, egne prosjekter, oppdrag). Rollene lages
 * først når brukeren faktisk tar dem i bruk, og opprettes da som vanlige
 * bruker-lagte roller (source_type='user_input') — vi finner aldri opp
 * perioder eller arbeidsgivere på brukerens vegne.
 */
import { addManualRole } from "@/lib/queries/cv-review-progress";
import type { TimelineRole } from "@/lib/cv-review-timeline";

export interface StandardRole {
  /** Stabil nøkkel brukt i valglister, aldri lagret som atom-id. */
  key: string;
  title: string;
  description: string;
}

export const STANDARD_ROLES: StandardRole[] = [
  {
    key: "privat",
    title: "Privat",
    description: "Erfaring utenfor et ansettelsesforhold, f.eks. egne prosjekter eller verv.",
  },
  {
    key: "freelance",
    title: "Freelance",
    description: "Oppdrag du har utført for egen regning.",
  },
];

/** Prefiks for valgverdier som peker på en standardrolle som ennå ikke finnes. */
export const STANDARD_ROLE_VALUE_PREFIX = "std:";

export function standardRoleValue(role: StandardRole): string {
  return `${STANDARD_ROLE_VALUE_PREFIX}${role.key}`;
}

export function parseStandardRoleValue(value: string): StandardRole | null {
  if (!value.startsWith(STANDARD_ROLE_VALUE_PREFIX)) return null;
  const key = value.slice(STANDARD_ROLE_VALUE_PREFIX.length);
  return STANDARD_ROLES.find((r) => r.key === key) ?? null;
}

/** Finnes standardrollen allerede blant brukerens roller? */
export function findExistingStandardRole(
  roles: TimelineRole[],
  role: StandardRole,
): TimelineRole | null {
  const wanted = role.title.toLowerCase();
  return (
    roles.find(
      (r) =>
        r.kind === "lagret" &&
        (r.title ?? "").trim().toLowerCase() === wanted &&
        !(r.employer ?? "").trim(),
    ) ?? null
  );
}

/**
 * Returnerer atom-id for standardrollen, og oppretter den om den mangler.
 * Ingen datoer settes — brukeren kan fylle inn perioden selv i trinn 1.
 */
export async function ensureStandardRole(input: {
  userId: string;
  importId: string | null;
  role: StandardRole;
  existingRoles: TimelineRole[];
}): Promise<string> {
  const existing = findExistingStandardRole(input.existingRoles, input.role);
  if (existing) return existing.id;
  return addManualRole({
    userId: input.userId,
    importId: input.importId,
    title: input.role.title,
    employer: null,
    startIso: null,
    endIso: null,
    isCurrent: false,
  });
}
