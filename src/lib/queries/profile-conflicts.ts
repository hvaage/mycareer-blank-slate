/**
 * Motstridende svar mellom «Om meg» (`profiles`) og «Karriereprofil»
 * (`user_career_profiles`). Jobbsøket slår sammen begge sider, så to ulike
 * svar betyr at det søkes på begge. Brukeren velger, systemet velger aldri.
 *
 * Logikken bor her fordi både konfliktløseren og dashboardet trenger den.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { LEADERSHIP_LEVEL_OPTIONS } from "@/lib/career-profile-ui-constants";

export type FieldKind = "array" | "number" | "text";

export type FieldSpec = {
  key: string;
  label: string;
  profileCol: string;
  careerCol: string;
  kind: FieldKind;
};

export const CONFLICT_FIELDS: FieldSpec[] = [
  { key: "years", label: "År med erfaring", profileCol: "years_experience", careerCol: "years_experience", kind: "number" },
  { key: "roles", label: "Ønskede roller", profileCol: "target_roles", careerCol: "desired_role_types", kind: "array" },
  { key: "industries", label: "Ønskede bransjer", profileCol: "target_industries", careerCol: "desired_industries", kind: "array" },
  { key: "seniority", label: "Nivå du søker", profileCol: "target_seniority", careerCol: "leadership_level", kind: "text" },
  { key: "work", label: "Arbeidsform", profileCol: "work_types", careerCol: "preferred_work_styles", kind: "array" },
  { key: "locations", label: "Steder", profileCol: "preferred_locations", careerCol: "preferred_locations", kind: "array" },
  { key: "salmin", label: "Lønn min", profileCol: "salary_expectation_min", careerCol: "salary_expectation_min", kind: "number" },
  { key: "salmax", label: "Lønn maks", profileCol: "salary_expectation_max", careerCol: "salary_expectation_max", kind: "number" },
];

export function leadershipLabel(v: string): string {
  return LEADERSHIP_LEVEL_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

export function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.filter((x) => String(x ?? "").trim()).length === 0;
  return String(v).trim().length === 0;
}

export function sameValue(a: unknown, b: unknown, spec: FieldSpec): boolean {
  const norm = (v: unknown) =>
    Array.isArray(v)
      ? v.filter(Boolean).map((x) => String(x).trim().toLowerCase()).sort().join("|")
      : String(v ?? "").trim().toLowerCase();
  if (spec.key === "seniority") {
    return norm(a) === norm(b) || norm(a) === leadershipLabel(String(b ?? "")).trim().toLowerCase();
  }
  return norm(a) === norm(b);
}

export type Conflict = {
  spec: FieldSpec;
  profileValue: unknown;
  careerValue: unknown;
  onlyCareer: boolean;
};

export function computeConflicts(
  profile: Record<string, unknown> | null | undefined,
  career: Record<string, unknown> | null | undefined,
): Conflict[] {
  if (!profile || !career) return [];
  const out: Conflict[] = [];
  for (const spec of CONFLICT_FIELDS) {
    const pv = profile[spec.profileCol];
    const cv = career[spec.careerCol];
    if (isEmptyValue(cv)) continue;
    if (isEmptyValue(pv)) {
      out.push({ spec, profileValue: null, careerValue: cv, onlyCareer: true });
      continue;
    }
    if (!sameValue(pv, cv, spec)) {
      out.push({ spec, profileValue: pv, careerValue: cv, onlyCareer: false });
    }
  }
  return out;
}

export const profileConflictsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["profile-conflicts", userId],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async () => {
      const [pRes, cRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("user_career_profiles").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      if (pRes.error) throw pRes.error;
      if (cRes.error) throw cRes.error;
      return {
        profile: pRes.data as Record<string, unknown> | null,
        career: cRes.data as Record<string, unknown> | null,
      };
    },
  });
