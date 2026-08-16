// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { norm } from "@/lib/cv-preview-items";

export type ExistingSignature = {
  /** Hvor elementet allerede finnes: bekreftet karriereoversikt eller tidligere import. */
  origin: "karriereoversikt" | "tidligere_import";
  compareValue: string;
};

function signatureFor(type: string, sd: any, content: string | null): string | null {
  const t = String(type ?? "");
  switch (t) {
    case "role":
      return `role|${norm(sd?.title)}|${norm(sd?.employer ?? sd?.company)}`;
    case "education":
      return `education|${norm(sd?.degree)}|${norm(sd?.institution)}`;
    case "skill":
    case "tool":
    case "domain":
      return `skill|${norm(sd?.name ?? content)}`;
    case "language":
      return `language|${norm(sd?.language ?? sd?.name ?? content)}`;
    case "certification":
      return `certification|${norm(sd?.name)}|${norm(sd?.issuer)}`;
    case "project":
      return `project|${norm(sd?.name ?? content)}`;
    case "volunteer":
      return `volunteer|${norm(sd?.role)}|${norm(sd?.organization)}`;
    case "achievement":
    case "result":
      return `achievement|${norm(sd?.what ?? content)}`;
    default:
      return content ? `${t}|${norm(content)}` : null;
  }
}

function compareValueFor(type: string, sd: any, content: string | null): string {
  const t = String(type ?? "");
  switch (t) {
    case "role":
      return `${sd?.start_date ?? "?"}–${sd?.end_date ?? "nå"}`;
    case "education":
      return `${sd?.field ?? ""}|${sd?.start_year ?? ""}|${sd?.end_year ?? ""}`;
    case "language":
      return norm(sd?.level);
    case "certification":
      return `${sd?.issued ?? ""}|${sd?.expires ?? ""}`;
    default:
      return norm(sd?.name ?? content);
  }
}

/**
 * Alt brukeren allerede har: bekreftede atomer i karriereoversikten og
 * kandidater fra tidligere importer. Brukes for å merke hvert funn som nytt,
 * kjent eller endret — aldri for å skjule noe.
 */
export function useExistingCvSignatures(userId: string | undefined) {
  return useQuery({
    queryKey: ["existing-cv-signatures", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Record<string, ExistingSignature>> => {
      const [atomsRes, candRes] = await Promise.all([
        supabase
          .from("career_atoms")
          .select("atom_type, structured_data, content_no")
          .eq("user_id", userId!)
          .eq("is_active", true),
        supabase
          .from("cv_parse_candidates")
          .select("suggested_atom_type, resolved_atom_type, structured_data, content_no, status")
          .eq("user_id", userId!),
      ]);
      if (atomsRes.error) throw atomsRes.error;
      if (candRes.error) throw candRes.error;

      const map: Record<string, ExistingSignature> = {};

      for (const c of (candRes.data ?? []) as any[]) {
        if (c.status === "avvist") continue;
        const type = c.resolved_atom_type ?? c.suggested_atom_type;
        const sig = signatureFor(type, c.structured_data, c.content_no);
        if (!sig) continue;
        map[sig] = {
          origin: "tidligere_import",
          compareValue: compareValueFor(type, c.structured_data, c.content_no),
        };
      }

      // Karriereoversikten vinner som opphav når begge finnes.
      for (const a of (atomsRes.data ?? []) as any[]) {
        const sig = signatureFor(a.atom_type, a.structured_data, a.content_no);
        if (!sig) continue;
        map[sig] = {
          origin: "karriereoversikt",
          compareValue: compareValueFor(a.atom_type, a.structured_data, a.content_no),
        };
      }

      return map;
    },
  });
}

export type ItemStatus = "ny" | "finnes" | "endret";

export function statusFor(
  item: { signature: string; compareValue: string },
  existing: Record<string, ExistingSignature> | undefined,
): ItemStatus {
  const hit = existing?.[item.signature];
  if (!hit) return "ny";
  return norm(hit.compareValue) === norm(item.compareValue) ? "finnes" : "endret";
}
