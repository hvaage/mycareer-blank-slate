/**
 * Felles vurdering og «Min vurdering» for en verifisert arbeidsgiver.
 *
 * Regler:
 * - Ingen forhåndsutfylte verdier. Uvurderte dimensjoner er «ikke nok grunnlag».
 * - Felles tall vises kun når minst fem kvalifiserte bidragsytere finnes i kohorten.
 * - Kandidatkohorten vises separat og kan kun inneholde rekruttering og retensjon.
 * - Klienten sender aldri bruker-ID. Alt skrives gjennom kontrollerte serverfunksjoner.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "culture", label: "Kultur" },
  { key: "leadership", label: "Ledelse" },
  { key: "work_environment", label: "Arbeidsmiljø" },
  { key: "career_development", label: "Karriereutvikling" },
  { key: "financial_stability", label: "Økonomisk stabilitet" },
  { key: "mission", label: "Formål og retning" },
  { key: "talent_attraction_retention", label: "Rekruttering og retensjon" },
  { key: "diversity_inclusion", label: "Mangfold og inkludering" },
];

const BASIS_OPTIONS: Array<{ value: string; label: string; cohort: string }> = [
  { value: "current_employee", label: "Ansatt i dag", cohort: "employee_experience" },
  { value: "former_employee", label: "Tidligere ansatt", cohort: "employee_experience" },
  { value: "contractor", label: "Innleid eller konsulent", cohort: "employee_experience" },
  { value: "applicant", label: "Har søkt jobb", cohort: "candidate_experience" },
  { value: "interviewed", label: "Har vært til intervju", cohort: "candidate_experience" },
  { value: "customer", label: "Kunde", cohort: "external_relationship" },
  { value: "partner", label: "Samarbeidspartner", cohort: "external_relationship" },
  { value: "other", label: "Annet grunnlag", cohort: "not_eligible" },
];

const COHORT_LABEL: Record<string, string> = {
  employee_experience: "Erfaring som ansatt",
  candidate_experience: "Erfaringer fra søknadsprosessen",
  external_relationship: "Erfaring som kunde eller partner",
};

type AggregateDto = {
  cohort: string;
  threshold: number;
  contributor_count: number;
  dimensions: Array<{ dimension: string; average_score: number; contributor_count: number }>;
  texts: Array<{ excerpt: string; basis: string; period: string | null }>;
  has_weighted_total?: boolean;
  weighted_total?: number | null;
};

type MyReviewDto = {
  id: string;
  experience_basis: string;
  experience_cohort: string;
  numeric_contribution_status: string;
  scores: Record<string, number | "insufficient_basis">;
  text: { body: string; publication_status: string } | null;
} | null;

function dimensionLabel(key: string) {
  return DIMENSIONS.find((d) => d.key === key)?.label ?? key;
}

function AggregateBlock({ agg }: { agg: AggregateDto }) {
  const dims = agg.dimensions ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{COHORT_LABEL[agg.cohort] ?? agg.cohort}</h3>
        <span className="text-xs text-muted-foreground">
          {agg.contributor_count} kvalifiserte bidrag
        </span>
      </div>
      {dims.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Felles vurdering vises først når minst {agg.threshold} ulike kvalifiserte bidragsytere har
          svart på samme dimensjon.
        </p>
      ) : (
        <>
          {agg.has_weighted_total && typeof agg.weighted_total === "number" ? (
            <p className="text-sm">
              Felles vektet vurdering:{" "}
              <span className="tabular-nums font-medium">{agg.weighted_total.toFixed(1)} / 5</span>{" "}
              <span className="text-muted-foreground">
                — basert på {agg.contributor_count} bidragsytere i denne kohorten
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Kun dimensjoner som selv oppfyller terskelen vises. Det beregnes ingen totalvurdering.
            </p>
          )}
          <ul className="grid gap-1 sm:grid-cols-2">
            {dims.map((d) => (
              <li key={d.dimension} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{dimensionLabel(d.dimension)}</span>
                <span className="tabular-nums font-medium">
                  {Number(d.average_score).toFixed(1)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({d.contributor_count})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(agg.texts ?? []).length > 0 && (
        <ul className="space-y-2">
          {agg.texts.map((t, i) => (
            <li key={i} className="rounded-md border bg-muted/20 p-3 text-sm">
              <p>{t.excerpt}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {BASIS_OPTIONS.find((b) => b.value === t.basis)?.label ?? t.basis}
                {t.period ? ` · ${t.period}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EmployerCommonReview({
  companyId,
  orgnr,
}: {
  companyId: string;
  orgnr: string | null;
}) {
  const qc = useQueryClient();
  const verified = !!orgnr && /^\d{9}$/.test(orgnr);

  const targetQuery = useQuery({
    queryKey: ["employer-review-target", companyId],
    enabled: verified,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employer_review_targets")
        .select("id")
        .eq("company_id", companyId)
        .eq("target_kind", "juridisk_enhet")
        .is("superseded_at", null)
        .maybeSingle();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
  });
  const targetId = targetQuery.data ?? null;

  const aggregatesQuery = useQuery({
    queryKey: ["employer-review-aggregates", targetId],
    enabled: !!targetId,
    queryFn: async () => {
      const cohorts = ["employee_experience", "candidate_experience", "external_relationship"];
      const results = await Promise.all(
        cohorts.map(async (c) => {
          const { data, error } = await supabase.rpc("get_employer_review_aggregate", {
            p_review_target_id: targetId!,
            p_cohort: c as never,
          });
          if (error) throw error;
          return data as unknown as AggregateDto;
        }),
      );
      return results;
    },
  });

  const myReviewQuery = useQuery({
    queryKey: ["employer-review-mine", targetId],
    enabled: !!targetId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_employer_review", {
        p_review_target_id: targetId!,
      });
      if (error) throw error;
      return (data as unknown as MyReviewDto) ?? null;
    },
  });
  const myReview = myReviewQuery.data ?? null;

  const [basis, setBasis] = useState<string>("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [body, setBody] = useState("");
  const [touched, setTouched] = useState(false);

  const effectiveBasis = touched ? basis : (myReview?.experience_basis ?? basis);
  const cohort = BASIS_OPTIONS.find((b) => b.value === effectiveBasis)?.cohort ?? null;
  const allowedDimensions = useMemo(() => {
    if (cohort === "candidate_experience") {
      return DIMENSIONS.filter((d) => d.key === "talent_attraction_retention");
    }
    return DIMENSIONS;
  }, [cohort]);

  const effectiveScores: Record<string, number> = useMemo(() => {
    if (touched) return scores;
    const from = myReview?.scores ?? {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(from)) if (typeof v === "number") out[k] = v;
    return out;
  }, [touched, scores, myReview]);

  const effectiveBody = touched ? body : (myReview?.text?.body ?? "");

  const submit = useMutation({
    mutationFn: async () => {
      if (!effectiveBasis) throw new Error("Velg erfaringsgrunnlag");
      let resolvedTarget = targetId;
      if (!resolvedTarget) {
        // Serveren oppretter vurderingsobjektet kun for verifisert organisasjonsnummer.
        const { data: ensured, error: ensureError } = await supabase.rpc(
          "employer_review_ensure_target",
          { p_company_id: companyId },
        );
        if (ensureError) throw ensureError;
        resolvedTarget = ensured as unknown as string;
      }
      const payload: Record<string, number | "insufficient_basis"> = {};
      for (const d of allowedDimensions) {
        const v = effectiveScores[d.key];
        payload[d.key] = typeof v === "number" ? Math.round(v) : "insufficient_basis";
      }
      const { data, error } = await supabase.rpc("employer_review_submit", {
        p_review_target_id: resolvedTarget,
        p_experience_basis: effectiveBasis as never,
        p_scores: payload as never,
        p_text: effectiveBody.trim() ? effectiveBody.trim() : null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Vurderingen er lagret");
      setTouched(false);
      qc.invalidateQueries({ queryKey: ["employer-review-target", companyId] });
      qc.invalidateQueries({ queryKey: ["employer-review-mine", targetId] });
      qc.invalidateQueries({ queryKey: ["employer-review-aggregates", targetId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre vurderingen"),
  });

  if (!verified) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vurdering av arbeidsgiver</CardTitle>
          <CardDescription>
            Selskapet mangler verifisert organisasjonsnummer. Vurderinger kan ikke publiseres eller
            inngå i felles tall før identiteten er bekreftet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vurdering av arbeidsgiver</CardTitle>
        <CardDescription>
          Felles tall er anonymiserte og vises kun over personverntersklene. Din egen vurdering er
          alltid synlig for deg.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {targetQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Henter vurderingsobjekt…</p>
        ) : !targetId ? (
          <p className="text-sm text-muted-foreground">
            Ingen vurderinger er registrert på denne arbeidsgiveren ennå.
          </p>
        ) : (
          <div className="space-y-6">
            {aggregatesQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Henter felles vurdering…</p>
            ) : (
              (aggregatesQuery.data ?? []).map((agg) => <AggregateBlock key={agg.cohort} agg={agg} />)
            )}
          </div>
        )}

        <div className="space-y-4 border-t pt-5">
          <div className="space-y-2">
            <Label>Min vurdering — erfaringsgrunnlag</Label>
            <Select
              value={effectiveBasis}
              onValueChange={(v) => {
                setTouched(true);
                setBasis(v);
                setScores(effectiveScores);
                setBody(effectiveBody);
              }}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Velg grunnlag" />
              </SelectTrigger>
              <SelectContent>
                {BASIS_OPTIONS.map((b) => (
                  <SelectItem key={b.value} value={b.value}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cohort === "not_eligible" && (
              <p className="text-xs text-muted-foreground">
                Dette grunnlaget lagres som privat utkast og inngår ikke i felles tall.
              </p>
            )}
          </div>

          {effectiveBasis ? (
            <div className="grid gap-4">
              {allowedDimensions.map((d) => {
                const v = effectiveScores[d.key];
                const rated = typeof v === "number";
                return (
                  <div key={d.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label>{d.label}</Label>
                      {rated ? (
                        <div className="flex items-center gap-3">
                          <span className="text-sm tabular-nums text-muted-foreground">
                            {v} / 5
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setTouched(true);
                              setScores(() => {
                                const next = { ...effectiveScores };
                                delete next[d.key];
                                return next;
                              });
                            }}
                          >
                            Ikke nok grunnlag
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">Ikke nok grunnlag</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setTouched(true);
                              setScores({ ...effectiveScores, [d.key]: 3 });
                            }}
                          >
                            Gi vurdering
                          </Button>
                        </div>
                      )}
                    </div>
                    {rated && (
                      <Slider
                        value={[v]}
                        min={1}
                        max={5}
                        step={1}
                        onValueChange={([nv]) => {
                          setTouched(true);
                          setScores({ ...effectiveScores, [d.key]: nv });
                        }}
                      />
                    )}
                  </div>
                );
              })}

              <div className="space-y-2">
                <Label htmlFor="review-body">Fritekst (valgfritt)</Label>
                <Textarea
                  id="review-body"
                  rows={3}
                  value={effectiveBody}
                  placeholder="Beskriv erfaringen din. Teksten blir moderert før den eventuelt vises for andre."
                  onChange={(e) => {
                    setTouched(true);
                    setScores(effectiveScores);
                    setBody(e.target.value);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Fritekst vises for andre først etter manuell godkjenning og når kohorten har nok
                  bidragsytere.
                </p>
              </div>

              <div>
                <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                  {submit.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Lagre vurdering
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Velg erfaringsgrunnlag for å gi en vurdering. Ingen verdier er forhåndsutfylt.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
