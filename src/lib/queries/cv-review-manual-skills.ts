/**
 * CV-gjennomgang, trinn 3: kompetanse lagt inn av brukeren.
 *
 * To tilfeller dekkes her:
 *  1) Avvik — funn i råteksten (`cv_parse_candidates`) som analysen ikke tok
 *     med som kompetanse, men som brukeren vil beholde.
 *  2) Helt nye kompetanser brukeren ser mangler.
 *
 * Begge lagres som `career_atoms` med `source_type='user_input'`.
 * Kompetanse belegges alltid indirekte: minst én peker (rolle eller resultat)
 * kreves. `atom_class` og `attestation` settes aldri her — databasen eier dem.
 * Brukerens egen begrunnelse lagres som metadata, ikke som kildesitat fra CV-en.
 */
import { supabase } from "@/lib/supabase";
import type { Json } from "@/integrations/supabase/types";
import { careerAtomLogicalKey } from "@/lib/career-atom-refresh";
import type { CvParseCandidateRow } from "@/lib/queries/cv-parse-candidates";

export interface ManualSkillInput {
  userId: string;
  importId: string | null;
  title: string;
  /** Brukerens egen forklaring på hvorfor kompetansen hører hjemme her. */
  reason: string | null;
  /** Roller og resultater kompetansen belegges av. Minst én kreves. */
  evidenceAtomIds: string[];
  /** Kilderaden avviket kom fra, hvis kompetansen stammer fra råteksten. */
  candidate?: CvParseCandidateRow | null;
}

export async function addManualSkill(input: ManualSkillInput): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("Kompetansen må ha en tittel.");
  if (input.evidenceAtomIds.length === 0) {
    throw new Error(
      `«${title}» er en kompetanse og kan bare belegges indirekte. Velg minst én rolle eller ett resultat som viser hvor du har brukt den.`,
    );
  }

  const reason = input.reason?.trim() || null;
  const candidate = input.candidate ?? null;

  const structured: Record<string, unknown> = {
    ...((candidate?.structured_data as Record<string, unknown> | null) ?? {}),
    title,
    lagt_inn_av_bruker: true,
    kilde: "bruker_manuelt",
    bruker_begrunnelse: reason,
    review_import_id: input.importId,
  };
  if (candidate) {
    structured["parse_candidate_id"] = candidate.id;
    structured["parse_local_ref"] = candidate.local_ref;
    structured["import_id"] = candidate.import_id;
    structured["avvik_fra_analyse"] = true;
  }
  structured["logical_key"] = careerAtomLogicalKey({
    atom_kind: "evidens",
    atom_type: "skill",
    content_no: title,
    structured_data: structured,
  });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("career_atoms")
    .insert({
      user_id: input.userId,
      atom_kind: "evidens",
      atom_type: "skill",
      content_no: title,
      structured_data: structured as Json,
      source_type: "user_input",
      source_ref: "cv_review_skills",
      source_quote: candidate?.source_quote ?? null,
      evidence_atom_ids: input.evidenceAtomIds,
      confidence: "verified",
      user_confirmed: true,
      refreshed_at: now,
      last_seen_at: now,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (candidate) {
    const { error: updErr } = await supabase
      .from("cv_parse_candidates")
      .update({
        status: "bekreftet",
        resolved_atom_type: "skill",
        promoted_atom_id: data.id,
        reviewed_at: now,
      })
      .eq("id", candidate.id)
      .eq("user_id", input.userId);
    if (updErr) throw updErr;
  }

  return data.id;
}
