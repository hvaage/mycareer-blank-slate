// @ts-nocheck
/**
 * Hvor komplett profilen er, målt mot det som faktisk brukes.
 *
 * Etter opprydningen 2026-08-16 eies jobbønskene av `profiles` (Om meg), og
 * `user_career_profiles` eier bare karrierestadium. Motivasjonsskalaene er
 * skjult fordi ingen leser dem, og teller derfor ikke lenger.
 *
 * Regelen: utfylte skjemafelter alene gir aldri full score. Uten registrerte
 * roller/resultater og minst ett ønske stanser skalaen på «påbegynt».
 */

import type { Tables } from "@/integrations/supabase/types";

type CareerProfile = Tables<"user_career_profiles"> | null;

export type CareerProfileCompleteness = {
  score: number;
  missingAreas: string[];
  summaryNb: string;
};

function hasText(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function hasArray(v: unknown): boolean {
  return Array.isArray(v) && v.some((x) => typeof x === "string" && x.trim().length > 0);
}

export function computeCareerProfileCompleteness(
  profile: CareerProfile,
  activePreferenceAtomCount: number,
  activeEvidenceAtomCount: number,
  options?: {
    /** Rad fra `profiles` — jobbønsker, LinkedIn og CV-stier. */
    userProfile?: Partial<Tables<"profiles">> | null;
    /** True hvis brukeren har minst ett aktivt CV-dokument i biblioteket. */
    hasCvDocument?: boolean;
  },
): CareerProfileCompleteness {
  const missingAreas: string[] = [];
  let pts = 0;

  const up = options?.userProfile ?? null;
  const linkedInPresent = !!(up?.linkedin_id?.trim?.() || up?.linkedin_vanity_url?.trim?.());
  const cvFromProfilePaths = !!(up?.cv_no_pdf_path?.trim?.() || up?.cv_en_pdf_path?.trim?.());
  const cvPresent = cvFromProfilePaths || !!options?.hasCvDocument;

  // Grunnlaget: det brukeren kan dokumentere og det han vil ha.
  const evidencePts = Math.min(35, activeEvidenceAtomCount * 5);
  pts += evidencePts;
  if (activeEvidenceAtomCount === 0) missingAreas.push("Roller og resultater du kan dokumentere");

  const prefPts = Math.min(25, activePreferenceAtomCount * 6);
  pts += prefPts;
  if (activePreferenceAtomCount === 0) missingAreas.push("Hva som er viktig for deg");

  // Jobbønskene (eies av Om meg).
  if (hasArray(up?.target_roles)) pts += 10;
  else missingAreas.push("Ønskede roller (Om meg)");

  if (hasArray(up?.target_industries)) pts += 6;
  else missingAreas.push("Ønskede bransjer (Om meg)");

  if (hasArray(up?.preferred_locations)) pts += 6;
  else missingAreas.push("Steder (Om meg)");

  if (hasText(up?.target_seniority)) pts += 6;
  else missingAreas.push("Hvilket nivå du søker (Om meg)");

  // Karriereprofilens eget felt.
  if (hasText(profile?.career_stage)) pts += 6;
  else missingAreas.push("Karrierestadium");

  if (linkedInPresent) pts += 3;
  else missingAreas.push("LinkedIn tilkoblet");

  if (cvPresent) pts += 3;
  else missingAreas.push("CV lastet opp");

  let score = Math.round(Math.min(100, pts));

  // Uten grunnlag kan skjemafelter aldri gi mer enn «påbegynt».
  const hasFoundation = activeEvidenceAtomCount > 0 && activePreferenceAtomCount > 0;
  if (!hasFoundation) score = Math.min(score, 40);

  let summaryNb: string;
  if (!hasFoundation) {
    summaryNb = "Skjemafeltene er fylt ut, men grunnlaget mangler. Det er rollene og ønskene som gjør profilen brukbar.";
  } else if (score >= 75) {
    summaryNb = "Sterkt grunnlag — vi kan filtrere godt og forklare hvorfor et treff passer.";
  } else if (score >= 45) {
    summaryNb = "God start — mer innhold gir bedre filtrering og mer presise treff.";
  } else {
    summaryNb = "Legg inn mer, så treffer jobbsøket bedre.";
  }

  return { score, missingAreas, summaryNb };
}
