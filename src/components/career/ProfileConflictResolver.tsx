// @ts-nocheck
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  computeConflicts,
  leadershipLabel,
  profileConflictsQuery,
  type Conflict,
  type FieldSpec,
} from "@/lib/queries/profile-conflicts";

function display(v: unknown, spec: FieldSpec, side: "profile" | "career"): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  if (spec.key === "seniority" && side === "career") return leadershipLabel(String(v));
  if (spec.kind === "number") return new Intl.NumberFormat("nb-NO").format(Number(v));
  return String(v);
}

export function ProfileConflictResolver({ userId }: { userId: string }) {
  const qc = useQueryClient();

  const { data } = useQuery(profileConflictsQuery(userId));

  const conflicts = useMemo<Conflict[]>(
    () => computeConflicts(data?.profile, data?.career),
    [data],
  );


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
