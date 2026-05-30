// @ts-nocheck
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, Lightbulb, Radar } from "lucide-react";
import { CAREER_MATCH_DIMENSIONS } from "@/lib/career-match-dimensions";
import { analyzeWhitespace, generateWhitespaceSummary } from "@/lib/whitespace-analysis";
import { computeShouldApply } from "@/lib/should-apply";
import {
  shouldApplyBand,
  shouldApplyBandLabelNb,
  MATCH_ASSESSMENT_TYPES,
} from "@/lib/match-assessment-model";
import {
  matchAssessmentsQuery,
  persistPreferencesMatchDraft,
} from "@/lib/queries/match-assessments";
import {
  userEvidenceAtomsQuery,
  userPreferenceAtomsQuery,
} from "@/lib/queries/career-atoms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

type Props = {
  userId: string;
};

const GAP_LABELS: Record<string, string> = {
  none: "Ingen dominerende hull i signalet",
  missing_evidence: "Hovedutfordring: manglende dokumentasjon",
  preference_mismatch: "Hovedutfordring: preferanser vs. eksisterende historie",
  weak_positioning: "Hovedutfordring: svak styrke på koblet evidens",
};

export function PreferencesMatchIntelligenceSection({ userId }: Props) {
  const qc = useQueryClient();
  const { data: prefRows = [] } = useQuery({ ...userPreferenceAtomsQuery(userId), enabled: !!userId });
  const { data: evRows = [] } = useQuery({ ...userEvidenceAtomsQuery(userId), enabled: !!userId });

  const activePrefs = useMemo(() => prefRows.filter((r) => r.is_active), [prefRows]);
  const activeEv = useMemo(() => evRows.filter((r) => r.is_active), [evRows]);

  const white = useMemo(
    () =>
      analyzeWhitespace({
        preferenceAtoms: activePrefs.map((p) => ({
          id: p.id,
          dimension: p.dimension,
          label: p.label,
          importance_score: p.importance_score,
        })),
        evidenceAtoms: activeEv.map((e) => ({
          id: e.id,
          category: e.category,
          label: e.label,
          strength_score: e.strength_score,
        })),
        targetDimensions: CAREER_MATCH_DIMENSIONS.map((d) => d.id),
        jobOrCompanyRequirements: [],
      }),
    [activePrefs, activeEv],
  );

  const shouldApply = useMemo(() => computeShouldApply(white), [white]);
  const summary = useMemo(() => generateWhitespaceSummary(white), [white]);

  const applyBand = shouldApplyBand(shouldApply.apply_recommendation_score);

  const saveDraft = useMutation({
    mutationFn: async () => {
      await persistPreferencesMatchDraft({
        userId,
        assessmentType: MATCH_ASSESSMENT_TYPES[3],
        white,
        shouldApply,
      });
    },
    onSuccess: () => {
      toast.success("Utkast til match-vurdering lagret");
      qc.invalidateQueries({ queryKey: ["match-assessments", userId] });
      qc.invalidateQueries({ queryKey: ["positioning-recommendations", userId] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke lagre"),
  });

  const { data: recent = [] } = useQuery({
    ...matchAssessmentsQuery(userId),
    enabled: !!userId,
  });
  const [showExamples] = useState(true);

  const lastCreated = recent[0]?.created_at ? new Date(recent[0].created_at).toLocaleString("nb-NO") : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/15 bg-muted/15 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
        <strong className="text-foreground/90">Modul 3 (MVP):</strong> Lokal, deterministisk analyse av preferanser og evidens.
        Endrer ikke Careerjet-rangering, arbeidsgiver-AI eller søknads-/CV-generator. Eksemplene under er
        illustrasjoner — ingen generativ AI her.
      </div>

      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary shrink-0" aria-hidden />
            <CardTitle className="text-base">Match-beredskap</CardTitle>
          </div>
          <CardDescription>
            Foreløpig «bør jeg søke?»-signal bygget kun på dine atomer (0–100).{" "}
            {showExamples && (
              <span className="italic">Eksempel på tolkning: «Du matcher selskapets vekstprofil godt» kommer senere når selskapsdata kobles på.</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tabular-nums">{shouldApply.apply_recommendation_score}/100</span>
            {applyBand && (
              <Badge variant="secondary">{shouldApplyBandLabelNb(applyBand)}</Badge>
            )}
            <Badge variant="outline">Konfidens {(shouldApply.confidence * 100).toFixed(0)}%</Badge>
            <Badge variant="outline">{GAP_LABELS[shouldApply.primaryGap] ?? shouldApply.primaryGap}</Badge>
          </div>
          <Progress value={shouldApply.apply_recommendation_score} className="h-2" />
          <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>
          <Button type="button" variant="secondary" size="sm" disabled={saveDraft.isPending} onClick={() => saveDraft.mutate()}>
            {saveDraft.isPending ? "Lagrer utkast…" : "Lagre utkast til match_assessments"}
          </Button>
          {recent.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Siste utkast i databasen: {recent[0]?.status ?? "—"}
              {lastCreated ? ` · ${lastCreated}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary shrink-0" aria-hidden />
            <CardTitle className="text-base">White-space</CardTitle>
          </div>
          <CardDescription>
            Hull og avvik mellom det du vil og det du kan vise.{" "}
            <span className="italic">
              Eksempel: «Du har sterk kommersiell erfaring, men lite dokumentert SaaS-erfaring.»
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {white.missingEvidence.length === 0 && white.preferenceStoryMismatch.length === 0 && white.matchedAreas.length === 0 ? (
            <p className="text-muted-foreground text-xs">Legg til atomer for å se mangler og treff.</p>
          ) : (
            <ul className="list-disc pl-4 space-y-1.5 text-xs text-muted-foreground leading-relaxed">
              {white.missingEvidence.slice(0, 5).map((t) => (
                <li key={`m-${t.slice(0, 40)}`}>{t}</li>
              ))}
              {white.preferenceStoryMismatch.slice(0, 4).map((t) => (
                <li key={`p-${t.slice(0, 40)}`} className="text-amber-900/90 dark:text-amber-200/90">
                  {t}
                </li>
              ))}
              {white.matchedAreas.slice(0, 4).map((t) => (
                <li key={`ok-${t.slice(0, 40)}`} className="text-emerald-900/85 dark:text-emerald-200/85">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary shrink-0" aria-hidden />
            <CardTitle className="text-base">Posisjoneringsmuligheter</CardTitle>
          </div>
          <CardDescription>
            Deterministiske forslag (CV, LinkedIn, nettverk) — ikke generert av språkmodell.{" "}
            <span className="italic">Eksempel: «LinkedIn-profilen din fremhever ikke lederansvar tydelig.»</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {white.positioningOpportunities.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ingen forslag ennå — fyll ut preferanser og evidens.</p>
          ) : (
            <ul className="list-disc pl-4 space-y-1.5 text-xs text-muted-foreground leading-relaxed">
              {white.positioningOpportunities.map((t) => (
                <li key={t.slice(0, 48)}>{t}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
