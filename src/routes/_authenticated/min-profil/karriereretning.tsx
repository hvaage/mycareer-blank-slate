// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Target } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { CAREER_STAGES, getCareerStage, type CareerStageId } from "@/lib/career-stage";
import {
  CAREER_LIFE_PHASES,
  getCareerLifePhase,
  suggestCareerLifePhase,
  type CareerLifePhaseCode,
} from "@/lib/career-life-phase";
import { userCareerProfileQuery, type UserCareerProfileRow } from "@/lib/queries/user-career-profile";
import { AGE_GROUPS, getAgeGroup, suggestLifePhaseFromAgeGroup } from "@/lib/age-group";
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
import { ProfileConflictResolver } from "@/components/career/ProfileConflictResolver";
import { OccupationPicker, type OccupationSelection } from "@/components/career/occupation-picker";
import { AgeSalaryContext } from "@/components/career/age-salary-context";
import { useCareerProfileAutosave } from "@/lib/career-profile-save";


export const Route = createFileRoute("/_authenticated/min-profil/karriereretning")({
  component: CareerPreferencesPage,
});

/**
 * Karriereprofil eier bare karrierestadium og karrierefase. Alt annet i
 * jobbønskene ligger i `profiles` og redigeres under Om meg — det er kolonnene
 * jobbsøket leser. Motivasjonsskalaene er skjult inntil scoringen faktisk
 * vekter dem; kolonnene i basen står urørt (se docs/backend-gaps.md).
 */
function rowToForm(r: UserCareerProfileRow | null) {
  return {
    career_stage: (r?.career_stage as CareerStageId | null) ?? "",
    career_life_phase: (r?.career_life_phase as CareerLifePhaseCode | null) ?? "",
    age_group: ((r as any)?.age_group as string | null) ?? "",
    primary_industry: ((r as any)?.primary_industry as string | null) ?? "",
    occupation:
      (r as any)?.current_occupation_esco_uri && (r as any)?.current_occupation_title
        ? ({
            uri: (r as any).current_occupation_esco_uri as string,
            title: (r as any).current_occupation_title as string,
            source:
              ((r as any).current_occupation_source as "search" | "ai_suggestion" | null) ?? "search",
          } satisfies OccupationSelection)
        : null,
  };
}


type FormState = ReturnType<typeof rowToForm>;

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
  const lifePhaseDef = useMemo(() => getCareerLifePhase(form.career_life_phase), [form.career_life_phase]);

  /**
   * Forslag til karrierefase. Aldersgruppe har forrang når den er valgt,
   * ellers brukes erfaring som før. Forslaget vises kun som tekst med egen
   * handling: har brukeren allerede en fase, vises ingenting og ingenting
   * overskrives. Feltet lagres som null til brukeren aktivt velger.
   */
  const suggestedPhase = useMemo(() => {
    if (form.career_life_phase) return null;
    const fromAge = suggestLifePhaseFromAgeGroup(form.age_group);
    if (fromAge) return { def: getCareerLifePhase(fromAge), basis: "alder" as const };
    const years = profile?.years_experience;
    if (years == null) return null;
    return {
      def: getCareerLifePhase(suggestCareerLifePhase(Number(years))),
      basis: "erfaring" as const,
    };
  }, [form.career_life_phase, form.age_group, profile?.years_experience]);

  const autosave = useCareerProfileAutosave(uid);

  const columnsFor = useCallback((key: keyof FormState, v: FormState[keyof FormState]) => {
    if (key === "occupation") {
      const occ = v as FormState["occupation"];
      return {
        current_occupation_esco_uri: occ?.uri ?? null,
        current_occupation_title: occ?.title ?? null,
        current_occupation_source: occ?.source ?? null,
      };
    }
    return { [key]: (v as string) || null };
  }, []);

  const set = useCallback(
    <K extends keyof FormState>(key: K, v: FormState[K]) => {
      setForm((s) => ({ ...s, [key]: v }));
      void autosave.save(columnsFor(key, v as FormState[keyof FormState]));
    },
    [autosave, columnsFor],
  );

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="shrink-0 -ml-2">
          <Link to="/min-profil">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only sm:ml-1">Min profil</span>
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
              <p className="text-xs text-muted-foreground">
                Karrierefasen styrer hvilke nettverksaktiviteter som foreslås. Karrierestadiet styrer
                hvordan stillinger vektes. Begge er valgfrie.
              </p>

              <div className="space-y-2">
                <Label htmlFor="age_group">Aldersgruppe</Label>
                <Select
                  value={form.age_group || "__empty"}
                  onValueChange={(v) => set("age_group", v === "__empty" ? "" : v)}
                >
                  <SelectTrigger id="age_group" className="w-full">
                    <SelectValue placeholder="Velg aldersgruppe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty">Ikke valgt</SelectItem>
                    {AGE_GROUPS.map((a) => (
                      <SelectItem key={a.code} value={a.code}>
                        {a.labelNb}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Frivillig. Brukes kun til å sammenligne lønnsnivå med offisiell SSB-statistikk, og
                  som kontekst i forslag. Alder brukes aldri til å sile bort stillinger.
                </p>
              </div>

              <OccupationPicker
                value={form.occupation}
                onChange={(v) => set("occupation", v)}
                industryHint={
                  Array.isArray(profile?.target_industries) ? profile.target_industries[0] ?? null : null
                }
                backgroundHint={profile?.current_role_title ?? null}
              />

              <div className="space-y-2">
                <Label htmlFor="career_life_phase">Karrierefase</Label>
                <Select
                  value={form.career_life_phase || "__empty"}
                  onValueChange={(v) =>
                    set("career_life_phase", v === "__empty" ? "" : (v as CareerLifePhaseCode))
                  }
                >
                  <SelectTrigger id="career_life_phase" className="w-full">
                    <SelectValue placeholder="Velg karrierefase" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty">Ikke valgt</SelectItem>
                    {CAREER_LIFE_PHASES.map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.labelNb} ({p.ageRangeNb})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {suggestedPhase?.def && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      Foreslått ut fra din {suggestedPhase.basis}: {suggestedPhase.def.labelNb} (
                      {suggestedPhase.def.ageRangeNb}) — bekreft eller velg selv.
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={() => set("career_life_phase", suggestedPhase.def!.code)}
                    >
                      Bruk forslag
                    </Button>
                  </div>
                )}
                {lifePhaseDef && (
                  <p className="text-xs text-muted-foreground">{lifePhaseDef.suggestionGuidanceNb}</p>
                )}
              </div>


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

          {form.age_group ? (
            <AgeSalaryContext
              ageGroup={form.age_group}
              industrySlug={form.primary_industry || null}
              onIndustryChange={(slug) => set("primary_industry", slug ?? "")}
              preferredIndustryName={
                Array.isArray(profile?.target_industries) ? profile.target_industries[0] ?? null : null
              }
            />
          ) : null}




          <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            {autosave.saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Lagrer …
              </>
            ) : autosave.savedAt ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden />
                Endringene lagres automatisk
              </>
            ) : (
              "Endringene lagres automatisk."
            )}
          </p>
        </>
      )}

    </div>
  );
}
