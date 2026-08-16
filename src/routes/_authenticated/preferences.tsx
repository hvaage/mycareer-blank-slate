// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Pencil, Save, Target } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { CAREER_STAGES, getCareerStage, type CareerStageId } from "@/lib/career-stage";
import { userCareerProfileQuery, type UserCareerProfileRow } from "@/lib/queries/user-career-profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PreferencesAtomsSection } from "@/components/career/PreferencesAtomsSection";
import { ProfileConflictResolver } from "@/components/career/ProfileConflictResolver";

export const Route = createFileRoute("/_authenticated/preferences")({
  component: CareerPreferencesPage,
});

/**
 * Karriereprofil eier bare karrierestadium. Alt annet i jobbønskene ligger i
 * `profiles` og redigeres under Om meg — det er kolonnene jobbsøket leser.
 * Motivasjonsskalaene er skjult inntil scoringen faktisk vekter dem;
 * kolonnene i basen står urørt (se docs/backend-gaps.md).
 */
function rowToForm(r: UserCareerProfileRow | null) {
  return {
    career_stage: (r?.career_stage as CareerStageId | null) ?? "",
  };
}

type FormState = ReturnType<typeof rowToForm>;

function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-right min-w-0">{value?.trim() ? value : <span className="text-muted-foreground">Ikke utfylt</span>}</span>
    </div>
  );
}

function CareerPreferencesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "";

  const { data: row, isLoading } = useQuery({
    ...userCareerProfileQuery(uid),
    enabled: !!uid,
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<FormState>(() => rowToForm(null));

  useEffect(() => {
    if (row !== undefined) setForm(rowToForm(row));
  }, [row]);

  const stageDef = useMemo(() => getCareerStage(form.career_stage), [form.career_stage]);

  const set = useCallback(<K extends keyof FormState>(key: K, v: FormState[K]) => {
    setForm((s) => ({ ...s, [key]: v }));
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!uid) throw new Error("Ikke innlogget");
      const { error } = await supabase
        .from("user_career_profiles")
        .upsert({ user_id: uid, career_stage: form.career_stage || null }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lagret");
      qc.invalidateQueries({ queryKey: ["user-career-profile", uid] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke lagre"),
  });

  const list = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : null);
  const salary = useMemo(() => {
    if (!profile) return null;
    const min = profile.salary_expectation_min;
    const max = profile.salary_expectation_max;
    if (min == null && max == null) return null;
    const f = (n: number | null) => (n == null ? "?" : new Intl.NumberFormat("nb-NO").format(n));
    return `${f(min)}–${f(max)} ${profile.salary_currency ?? "NOK"}`.trim();
  }, [profile]);

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="shrink-0 -ml-2">
          <Link to="/about-me">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only sm:ml-1">Om meg</span>
          </Link>
        </Button>
      </div>

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Target className="h-7 w-7 text-primary shrink-0" aria-hidden />
          <h1 className="text-2xl font-display font-bold tracking-tight">Karriereprofil</h1>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Her sier du hvor du er i karrieren, hva som er viktig for deg, og hva du kan dokumentere. Vi bruker det til å
          filtrere bort stillinger som ikke passer, slik at du slipper å lese dem.
        </p>
      </header>

      <ProfileConflictResolver userId={uid} />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Hvor er du i karrieren?</CardTitle>
              <CardDescription>
                Vi bruker dette til å vurdere om en stilling er et steg opp, sidelengs eller ned for deg.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="career_stage">Karrierestadium i dag</Label>
                <Select
                  value={form.career_stage || "__empty"}
                  onValueChange={(v) => set("career_stage", v === "__empty" ? "" : (v as CareerStageId))}
                >
                  <SelectTrigger id="career_stage" className="w-full">
                    <SelectValue placeholder="Velg nærmeste treff" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty">Ikke valgt</SelectItem>
                    {CAREER_STAGES.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.labelNb}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Dette er hvor du står i dag. Hvilket nivå du <em>søker</em>, svarer du på under Om meg.
                </p>
              </div>

              {stageDef && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="text-muted-foreground">{stageDef.descriptionNb}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-lg">Jobbønskene dine</CardTitle>
                  <CardDescription>
                    Disse svarene styrer hvilke stillinger vi henter inn. De redigeres ett sted — under Om meg.
                  </CardDescription>
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <Link to="/about-me">
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Endre
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <SummaryRow label="År med erfaring" value={profile?.years_experience != null ? String(profile.years_experience) : null} />
              <SummaryRow label="Nivå du søker" value={profile?.target_seniority ?? null} />
              <SummaryRow label="Ønskede roller" value={list(profile?.target_roles)} />
              <SummaryRow label="Ønskede bransjer" value={list(profile?.target_industries)} />
              <SummaryRow label="Arbeidsform" value={list(profile?.work_types)} />
              <SummaryRow label="Steder" value={list(profile?.preferred_locations)} />
              <SummaryRow label="Lønnsforventning" value={salary} />
            </CardContent>
          </Card>

          <div className="fixed bottom-0 left-0 right-0 p-4 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:left-64 z-40">
            <div className="max-w-2xl mx-auto flex justify-end gap-2">
              <Button
                type="button"
                size="lg"
                className="w-full sm:w-auto min-h-[48px]"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Lagrer…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Lagre
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      <PreferencesAtomsSection
        userId={uid}
        careerProfileId={row?.id ?? null}
        profile={row ?? null}
        profileLoading={isLoading}
      />
    </div>
  );
}
