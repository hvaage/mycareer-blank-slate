/**
 * Lightweight local completeness for Career Intelligence (Module 2).
 * Display-only — does not persist to DB unless callers choose to update `completeness_score` later.
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

function hasArray(v: string[] | null | undefined): boolean {
  return Array.isArray(v) && v.some((x) => typeof x === "string" && x.trim().length > 0);
}

/**
 * Heuristic 0–100: structured profile fill + active atom counts.
 * Tuned for MVP guidance, not statistical rigor.
 */
export function computeCareerProfileCompleteness(
  profile: CareerProfile,
  activePreferenceAtomCount: number,
  activeEvidenceAtomCount: number,
  options?: {
    /** Sokrates `profiles` row — LinkedIn / CV paths. */
    userProfile?: Pick<
      Tables<"profiles">,
      "linkedin_id" | "linkedin_vanity_url" | "cv_no_pdf_path" | "cv_en_pdf_path"
    > | null;
    /** True if user has at least one active CV-type document in library. */
    hasCvDocument?: boolean;
  },
): CareerProfileCompleteness {
  const missingAreas: string[] = [];
  let pts = 0;
  const max = 100;

  const up = options?.userProfile;
  const linkedInPresent = !!(up?.linkedin_id?.trim() || up?.linkedin_vanity_url?.trim());
  const cvFromProfilePaths = !!(up?.cv_no_pdf_path?.trim() || up?.cv_en_pdf_path?.trim());
  const cvPresent = cvFromProfilePaths || !!options?.hasCvDocument;

  if (!profile) {
    missingAreas.push("Karriereprofil er ikke opprettet ennå");
    return {
      score: 0,
      missingAreas,
      summaryNb: "Opprett og lagre karriereprofilen for å komme i gang.",
    };
  }

  if (hasText(profile.career_stage)) pts += 12;
  else missingAreas.push("Karrierestadium");

  if (hasText(profile.leadership_level)) pts += 8;
  else missingAreas.push("Lederambisjon / nivå");

  if (hasText(profile.primary_industry) || hasArray(profile.desired_industries)) pts += 10;
  else missingAreas.push("Bransje eller ønskede bransjer");

  if (profile.years_experience != null && profile.years_experience >= 0) pts += 6;
  else missingAreas.push("Års erfaring");

  if (hasArray(profile.desired_role_types)) pts += 8;
  else missingAreas.push("Ønskede rolletyper");

  if (hasArray(profile.preferred_work_styles) || hasText(profile.remote_preference)) pts += 8;
  else missingAreas.push("Arbeidsstil / remote-preferanse");

  if (hasArray(profile.preferred_locations)) pts += 6;
  else missingAreas.push("Sted / lokasjon");

  if (profile.salary_expectation_min != null || profile.salary_expectation_max != null) pts += 4;
  else missingAreas.push("Lønnsforventning (valgfritt men nyttig)");

  const sliders = [
    profile.stability_vs_growth,
    profile.mission_importance,
    profile.innovation_importance,
    profile.sustainability_importance,
    profile.work_life_balance_importance,
    profile.compensation_importance,
    profile.leadership_ambition,
  ].filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  if (sliders.length >= 5) pts += 18;
  else missingAreas.push("Motivasjonsskalaer (fyll ut flere)");

  pts += Math.min(12, activePreferenceAtomCount * 4);
  if (activePreferenceAtomCount === 0) missingAreas.push("Preferanse-atomer (hva som er viktig for deg)");

  pts += Math.min(10, activeEvidenceAtomCount * 2);
  if (activeEvidenceAtomCount === 0) missingAreas.push("Evidens-atomer (hva du kan dokumentere)");

  if (linkedInPresent) pts += 5;
  else missingAreas.push("LinkedIn tilkoblet (valgfritt men styrker matching)");

  if (cvPresent) pts += 5;
  else missingAreas.push("CV i bibliotek eller generert CV-fil");

  const score = Math.round(Math.min(max, pts));

  let summaryNb: string;
  if (score >= 75) {
    summaryNb = "Sterkt grunnlag — du kan senere koble matching, CV og søknad tettere til profilen.";
  } else if (score >= 45) {
    summaryNb = "God start — flere felt eller atomer styrker forklarbar matching og råd.";
  } else {
    summaryNb = "Bygg ut karriereprofil og atomer for bedre treff og mer presise anbefalinger senere.";
  }

  return { score, missingAreas, summaryNb };
}
