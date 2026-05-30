// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Info, Loader2, Save, Sparkles, Target } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { CAREER_STAGES, getCareerStage, type CareerStageId } from "@/lib/career-stage";
import { clampMatchScore, matchScoreBand, matchScoreBandLabelNb } from "@/lib/career-match-dimensions";
import {
  LEADERSHIP_LEVEL_OPTIONS,
  REMOTE_PREFERENCE_OPTIONS,
  SUGGESTED_COMPANY_SIZES,
  SUGGESTED_ROLE_TYPES,
  SUGGESTED_WORK_STYLES,
  TRAVEL_PREFERENCE_OPTIONS,
} from "@/lib/career-profile-ui-constants";
import { userCareerProfileQuery, type UserCareerProfileRow } from "@/lib/queries/user-career-profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PreferencesAtomsSection } from "@/components/career/PreferencesAtomsSection";
import { PreferencesMatchIntelligenceSection } from "@/components/career/PreferencesMatchIntelligenceSection";

export const Route = createFileRoute("/_authenticated/preferences")({
  component: CareerPreferencesPage,
});

const DEFAULT_SCALE = 3;

function rowToForm(r: UserCareerProfileRow | null) {
  return {
    career_stage: (r?.career_stage as CareerStageId | null) ?? "",
    leadership_level: r?.leadership_level ?? "",
    primary_industry: r?.primary_industry ?? "",
    years_experience: r?.years_experience != null ? String(r.years_experience) : "",
    desired_role_types: r?.desired_role_types ?? [],
    desired_industries: r?.desired_industries ?? [],
    preferred_company_sizes: r?.preferred_company_sizes ?? [],
    preferred_work_styles: r?.preferred_work_styles ?? [],
    preferred_locations: (r?.preferred_locations ?? []).join(", "),
    salary_expectation_min: r?.salary_expectation_min != null ? String(r.salary_expectation_min) : "",
    salary_expectation_max: r?.salary_expectation_max != null ? String(r.salary_expectation_max) : "",
    remote_preference: r?.remote_preference ?? "",
    travel_preference: r?.travel_preference ?? "",
    stability_vs_growth: r?.stability_vs_growth ?? DEFAULT_SCALE,
    mission_importance: r?.mission_importance ?? DEFAULT_SCALE,
    innovation_importance: r?.innovation_importance ?? DEFAULT_SCALE,
    sustainability_importance: r?.sustainability_importance ?? DEFAULT_SCALE,
    work_life_balance_importance: r?.work_life_balance_importance ?? DEFAULT_SCALE,
    compensation_importance: r?.compensation_importance ?? DEFAULT_SCALE,
    leadership_ambition: r?.leadership_ambition ?? DEFAULT_SCALE,
  };
}

type FormState = ReturnType<typeof rowToForm>;

function ScaleHint({ value }: { value: number }) {
  const band = matchScoreBand(value);
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {band ? matchScoreBandLabelNb(band) : "—"} ({value}/6)
    </span>
  );
}

function MotivationSlider({
  label,
  hint,
  value,
  onChange,
  left,
  right,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  left: string;
  right: string;
}) {
  return (
    <div className="space-y-2 py-1">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{hint}</p>
        </div>
        <ScaleHint value={value} />
      </div>
      <div className="flex items-center gap-3 px-0.5">
        <span className="text-[10px] text-muted-foreground w-16 shrink-0 leading-tight">{left}</span>
        <Slider
          value={[value]}
          min={1}
          max={6}
          step={1}
          onValueChange={(v) => onChange(clampMatchScore(v[0] ?? DEFAULT_SCALE))}
          className="flex-1 touch-pan-x"
        />
        <span className="text-[10px] text-muted-foreground w-16 shrink-0 text-right leading-tight">{right}</span>
      </div>
    </div>
  );
}

function ChipToggle({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] sm:min-h-0",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted/60",
      )}
    >
      {label}
    </button>
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

  const [form, setForm] = useState<FormState>(() => rowToForm(null));

  useEffect(() => {
    if (row !== undefined) setForm(rowToForm(row));
  }, [row]);

  const stageDef = useMemo(() => getCareerStage(form.career_stage), [form.career_stage]);

  const set = useCallback(<K extends keyof FormState>(key: K, v: FormState[K]) => {
    setForm((s) => ({ ...s, [key]: v }));
  }, []);

  const toggleArray = useCallback(
    (key: "desired_role_types" | "preferred_company_sizes" | "preferred_work_styles", item: string) => {
      setForm((s) => {
        const cur = s[key] as string[];
        const has = cur.includes(item);
        const next = has ? cur.filter((x) => x !== item) : [...cur, item];
        return { ...s, [key]: next };
      });
    },
    [],
  );

  const [industryDraft, setIndustryDraft] = useState("");
  const addIndustry = () => {
    const t = industryDraft.trim();
    if (!t) return;
    setForm((s) => ({
      ...s,
      desired_industries: s.desired_industries.includes(t) ? s.desired_industries : [...s.desired_industries, t],
    }));
    setIndustryDraft("");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!uid) throw new Error("Ikke innlogget");
      const years = form.years_experience.trim() ? parseInt(form.years_experience, 10) : null;
      const salMin = form.salary_expectation_min.trim() ? Number(form.salary_expectation_min) : null;
      const salMax = form.salary_expectation_max.trim() ? Number(form.salary_expectation_max) : null;
      const locs = form.preferred_locations
        .split(/[,;\n]/)
        .map((x) => x.trim())
        .filter(Boolean);

      const payload = {
        user_id: uid,
        career_stage: form.career_stage || null,
        leadership_level: form.leadership_level || null,
        primary_industry: form.primary_industry.trim() || null,
        years_experience: years != null && Number.isFinite(years) ? years : null,
        desired_role_types: form.desired_role_types.length ? form.desired_role_types : null,
        desired_industries: form.desired_industries.length ? form.desired_industries : null,
        preferred_company_sizes: form.preferred_company_sizes.length ? form.preferred_company_sizes : null,
        preferred_work_styles: form.preferred_work_styles.length ? form.preferred_work_styles : null,
        preferred_locations: locs.length ? locs : null,
        salary_expectation_min: salMin != null && Number.isFinite(salMin) ? salMin : null,
        salary_expectation_max: salMax != null && Number.isFinite(salMax) ? salMax : null,
        remote_preference: form.remote_preference || null,
        travel_preference: form.travel_preference || null,
        stability_vs_growth: form.stability_vs_growth,
        mission_importance: form.mission_importance,
        innovation_importance: form.innovation_importance,
        sustainability_importance: form.sustainability_importance,
        work_life_balance_importance: form.work_life_balance_importance,
        compensation_importance: form.compensation_importance,
        leadership_ambition: form.leadership_ambition,
      };

      const { error } = await supabase.from("user_career_profiles").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Karriereprofil lagret");
      qc.invalidateQueries({ queryKey: ["user-career-profile", uid] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke lagre"),
  });

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
          Dette er grunnlaget for <strong className="text-foreground/90">tilpasset matching</strong> mot jobber og
          arbeidsgivere — ikke bare generiske scorer. Jo tydeligere du er, jo bedre kan vi senere forklare treff,
          foreslå hvordan du skiller deg ut, og vurdere om en søknad er verdt innsatsen.
        </p>
        <p className="text-xs text-muted-foreground rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <Sparkles className="inline h-3.5 w-3.5 -mt-0.5 mr-1 text-primary" aria-hidden />
          Dette hjelper oss å personalisere jobbmatching og arbeidsgiveranbefalinger. Eksisterende AI-analyse og
          jobbleads endres ikke av dette steget — dataene lagres strukturert for neste moduler.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Karrieresti</CardTitle>
              <CardDescription>
                Vi bruker dette til standardprioriteringer og hint i grensesnittet — full vekting i scoring kommer
                senere.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="career_stage">Karrierestadium</Label>
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
              </div>

              {stageDef && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
                  <p className="text-muted-foreground">{stageDef.descriptionNb}</p>
                  <div>
                    <p className="text-xs font-semibold text-foreground/90 uppercase tracking-wide mb-1">
                      Vekting (hint)
                    </p>
                    <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                      {stageDef.weightingHintsNb.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="leadership_level">Lederambisjon / nivå</Label>
                <Select
                  value={form.leadership_level || "__empty"}
                  onValueChange={(v) => set("leadership_level", v === "__empty" ? "" : v)}
                >
                  <SelectTrigger id="leadership_level">
                    <SelectValue placeholder="Velg" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty">Ikke valgt</SelectItem>
                    {LEADERSHIP_LEVEL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="primary_industry">Primærbransje (fritekst)</Label>
                <Input
                  id="primary_industry"
                  placeholder="F.eks. helsetech, finans, energi…"
                  value={form.primary_industry}
                  onChange={(e) => set("primary_industry", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="years_experience">Års erfaring (tall)</Label>
                <Input
                  id="years_experience"
                  inputMode="numeric"
                  placeholder="F.eks. 5"
                  value={form.years_experience}
                  onChange={(e) => set("years_experience", e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ønsket rolle og arbeidsgiver</CardTitle>
              <CardDescription>Velg flere trekk — du kan kombinere fritt.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label className="mb-2 block">Ønskede rolletyper</Label>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_ROLE_TYPES.map((t) => (
                    <ChipToggle
                      key={t}
                      label={t}
                      selected={form.desired_role_types.includes(t)}
                      onClick={() => toggleArray("desired_role_types", t)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Ønskede bransjer</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="Skriv bransje og trykk Legg til"
                    value={industryDraft}
                    onChange={(e) => setIndustryDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addIndustry();
                      }
                    }}
                  />
                  <Button type="button" variant="secondary" className="shrink-0" onClick={addIndustry}>
                    Legg til
                  </Button>
                </div>
                {form.desired_industries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {form.desired_industries.map((ind) => (
                      <Badge
                        key={ind}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() =>
                          setForm((s) => ({
                            ...s,
                            desired_industries: s.desired_industries.filter((x) => x !== ind),
                          }))
                        }
                      >
                        {ind} ×
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label className="mb-2 block">Foretrukket selskapsstørrelse</Label>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_COMPANY_SIZES.map((t) => (
                    <ChipToggle
                      key={t}
                      label={t}
                      selected={form.preferred_company_sizes.includes(t)}
                      onClick={() => toggleArray("preferred_company_sizes", t)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Arbeidsstil</Label>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_WORK_STYLES.map((t) => (
                    <ChipToggle
                      key={t}
                      label={t}
                      selected={form.preferred_work_styles.includes(t)}
                      onClick={() => toggleArray("preferred_work_styles", t)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="preferred_locations">Steder (kommaseparert)</Label>
                <Input
                  id="preferred_locations"
                  placeholder="Oslo, Bergen, Remote EU…"
                  value={form.preferred_locations}
                  onChange={(e) => set("preferred_locations", e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="sal_min">Lønnsforventning min (valgfritt)</Label>
                  <Input
                    id="sal_min"
                    inputMode="decimal"
                    value={form.salary_expectation_min}
                    onChange={(e) => set("salary_expectation_min", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sal_max">Lønnsforventning maks (valgfritt)</Label>
                  <Input
                    id="sal_max"
                    inputMode="decimal"
                    value={form.salary_expectation_max}
                    onChange={(e) => set("salary_expectation_max", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Remote / kontor</Label>
                  <Select
                    value={form.remote_preference || "__empty"}
                    onValueChange={(v) => set("remote_preference", v === "__empty" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Velg" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__empty">Ikke valgt</SelectItem>
                      {REMOTE_PREFERENCE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Reise</Label>
                  <Select
                    value={form.travel_preference || "__empty"}
                    onValueChange={(v) => set("travel_preference", v === "__empty" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Velg" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__empty">Ikke valgt</SelectItem>
                      {TRAVEL_PREFERENCE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Motivasjon og vekting</CardTitle>
                  <CardDescription>
                    Alle skalaer er <strong>1–6</strong>: 1–2 svak betydning, 3–4 moderat, 5–6 svært viktig for deg.
                  </CardDescription>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground p-1 rounded-md"
                        aria-label="Forklaring"
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Senere brukes dette til forklarbar matching, «bør jeg søke?» og råd om hvordan du skiller deg
                      ut — uten å overskrive dagens arbeidsgiver-AI.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </CardHeader>
            <CardContent className="divide-y space-y-0">
              <div className="pb-4">
                <MotivationSlider
                  label="Stabilitet → vekst"
                  hint="Hvor mye prioriterer du forutsigbarhet versus rask utvikling og endring?"
                  value={form.stability_vs_growth}
                  onChange={(n) => set("stability_vs_growth", n)}
                  left="Stabilitet"
                  right="Vekst"
                />
              </div>
              <div className="py-4">
                <MotivationSlider
                  label="Misjon og mening"
                  hint="Hvor viktig er det at arbeidet føles meningsfullt?"
                  value={form.mission_importance}
                  onChange={(n) => set("mission_importance", n)}
                  left="Lavt"
                  right="Høyt"
                />
              </div>
              <div className="py-4">
                <MotivationSlider
                  label="Innovasjon"
                  hint="Vil du jobbe tett på ny teknologi, produkt og eksperiment?"
                  value={form.innovation_importance}
                  onChange={(n) => set("innovation_importance", n)}
                  left="Lavt"
                  right="Høyt"
                />
              </div>
              <div className="py-4">
                <MotivationSlider
                  label="Bærekraft og samfunnsansvar"
                  hint="ESG, etikk og samfunnsnytte som del av jobben."
                  value={form.sustainability_importance}
                  onChange={(n) => set("sustainability_importance", n)}
                  left="Lavt"
                  right="Høyt"
                />
              </div>
              <div className="py-4">
                <MotivationSlider
                  label="Work-life-balanse"
                  hint="Hvor sterkt skal hensyn til fritid og bærekraftig tempo veie?"
                  value={form.work_life_balance_importance}
                  onChange={(n) => set("work_life_balance_importance", n)}
                  left="Lavt"
                  right="Høyt"
                />
              </div>
              <div className="py-4">
                <MotivationSlider
                  label="Kompensasjon"
                  hint="Lønn, bonus og totalpakke — relativt til dine andre prioriteringer."
                  value={form.compensation_importance}
                  onChange={(n) => set("compensation_importance", n)}
                  left="Lavt"
                  right="Høyt"
                />
              </div>
              <div className="pt-4">
                <MotivationSlider
                  label="Lederambisjon"
                  hint="Ønske om å lede mennesker, budsjetter og strategi — uavhengig av nåværende tittel."
                  value={form.leadership_ambition}
                  onChange={(n) => set("leadership_ambition", n)}
                  left="Lavt"
                  right="Høyt"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Match-dimensjoner (forberedelse)</CardTitle>
              <CardDescription>
                Ti strukturerte dimensjoner (skala 1–6) brukes i neste moduler for forklarbar matching. Ingen beregning
                her ennå — bare synliggjøring av hva som kommer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Eksempler: kvalifikasjon, kultur, ledelse, bransje, misjon, vekst, kompensasjon, fleksibilitet,
                strategisk verdi for deg, og nettverksfordel. Disse kobles senere til blant annet CV, LinkedIn,
                søknad og intervju — uten å endre dagens arbeidsgiver-AI-kolonner.
              </p>
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
                    Lagre karriereprofil
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

      <PreferencesMatchIntelligenceSection userId={uid} />
    </div>
  );
}
