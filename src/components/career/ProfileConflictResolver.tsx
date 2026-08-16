// @ts-nocheck
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LEADERSHIP_LEVEL_OPTIONS } from "@/lib/career-profile-ui-constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type FieldKind = "array" | "number" | "text";

type FieldSpec = {
  key: string;
  label: string;
  profileCol: string;
  careerCol: string;
  kind: FieldKind;
};

/**
 * Feltene som finnes både i `profiles` (Om meg) og `user_career_profiles`
 * (Karriereprofil). Jobbsøket slår sammen begge sider, så to ulike svar
 * betyr at det søkes på begge. Brukeren velger, systemet velger aldri.
 */
const FIELDS: FieldSpec[] = [
  { key: "years", label: "År med erfaring", profileCol: "years_experience", careerCol: "years_experience", kind: "number" },
  { key: "roles", label: "Ønskede roller", profileCol: "target_roles", careerCol: "desired_role_types", kind: "array" },
  { key: "industries", label: "Ønskede bransjer", profileCol: "target_industries", careerCol: "desired_industries", kind: "array" },
  { key: "seniority", label: "Nivå du søker", profileCol: "target_seniority", careerCol: "leadership_level", kind: "text" },
  { key: "work", label: "Arbeidsform", profileCol: "work_types", careerCol: "preferred_work_styles", kind: "array" },
  { key: "locations", label: "Steder", profileCol: "preferred_locations", careerCol: "preferred_locations", kind: "array" },
  { key: "salmin", label: "Lønn min", profileCol: "salary_expectation_min", careerCol: "salary_expectation_min", kind: "number" },
  { key: "salmax", label: "Lønn maks", profileCol: "salary_expectation_max", careerCol: "salary_expectation_max", kind: "number" },
];

function leadershipLabel(v: string): string {
  return LEADERSHIP_LEVEL_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.filter((x) => String(x ?? "").trim()).length === 0;
  return String(v).trim().length === 0;
}

function display(v: unknown, spec: FieldSpec, side: "profile" | "career"): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  if (spec.key === "seniority" && side === "career") return leadershipLabel(String(v));
  if (spec.kind === "number") return new Intl.NumberFormat("nb-NO").format(Number(v));
  return String(v);
}

function sameValue(a: unknown, b: unknown, spec: FieldSpec): boolean {
  const norm = (v: unknown) =>
    (Array.isArray(v) ? v.filter(Boolean).map((x) => String(x).trim().toLowerCase()).sort().join("|") : String(v ?? "").trim().toLowerCase());
  if (spec.key === "seniority") {
    return norm(a) === norm(b) || norm(a) === leadershipLabel(String(b ?? "")).trim().toLowerCase();
  }
  return norm(a) === norm(b);
}

type Conflict = {
  spec: FieldSpec;
  profileValue: unknown;
  careerValue: unknown;
  onlyCareer: boolean;
};

export function ProfileConflictResolver({ userId }: { userId: string }) {
  const qc = useQueryClient();

  const { data } = useQuery({
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
      return { profile: pRes.data, career: cRes.data };
    },
  });

  const conflicts = useMemo<Conflict[]>(() => {
    const p = data?.profile;
    const c = data?.career;
    if (!p || !c) return [];
    const out: Conflict[] = [];
    for (const spec of FIELDS) {
      const pv = p[spec.profileCol];
      const cv = c[spec.careerCol];
      if (isEmpty(cv)) continue;
      if (isEmpty(pv)) {
        out.push({ spec, profileValue: null, careerValue: cv, onlyCareer: true });
        continue;
      }
      if (!sameValue(pv, cv, spec)) {
        out.push({ spec, profileValue: pv, careerValue: cv, onlyCareer: false });
      }
    }
    return out;
  }, [data]);

  const resolve = useMutation({
    mutationFn: async ({ spec, value }: { spec: FieldSpec; value: unknown }) => {
      let toWrite: unknown = value;
      if (spec.key === "seniority" && typeof value === "string") toWrite = leadershipLabel(value);
      const { error: pErr } = await (supabase.from("profiles") as any)
        .update({ [spec.profileCol]: toWrite })
        .eq("id", userId);
      if (pErr) throw pErr;
      const { error: cErr } = await (supabase.from("user_career_profiles") as any)
        .update({ [spec.careerCol]: null })
        .eq("user_id", userId);
      if (cErr) throw cErr;
    },
    onSuccess: () => {
      toast.success("Valgt. Jobbsøket bruker nå bare dette svaret.");
      qc.invalidateQueries({ queryKey: ["profile-conflicts", userId] });
      qc.invalidateQueries({ queryKey: ["profile", userId] });
      qc.invalidateQueries({ queryKey: ["user-career-profile", userId] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke lagre valget"),
  });

  if (conflicts.length === 0) return null;

  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <CardTitle className="text-base">Du har svart to ganger på det samme</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Jobbsøket bruker begge svarene nå. Velg ett, så søkes det bare på det.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {conflicts.map(({ spec, profileValue, careerValue, onlyCareer }) => (
          <div key={spec.key} className="rounded-lg border bg-card p-3 space-y-2">
            <p className="text-sm font-medium">{spec.label}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {!onlyCareer && (
                <button
                  type="button"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ spec, value: profileValue })}
                  className="rounded-md border px-3 py-2 text-left text-sm hover:border-primary hover:bg-muted/50 transition-colors"
                >
                  <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">Fra Om meg</span>
                  <span className="block font-medium">{display(profileValue, spec, "profile")}</span>
                </button>
              )}
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ spec, value: careerValue })}
                className="rounded-md border px-3 py-2 text-left text-sm hover:border-primary hover:bg-muted/50 transition-colors"
              >
                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                  Fra Karriereprofil
                </span>
                <span className="block font-medium">{display(careerValue, spec, "career")}</span>
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
              {onlyCareer
                ? "Dette svaret finnes bare her. Velg det, så flyttes det til Om meg der det redigeres videre."
                : "Svaret du velger lagres under Om meg. Det andre slettes."}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
