/**
 * CV-gjennomgang, trinn 3: kompetanse med foreslått plassering.
 *
 * Brukeren starter ikke med å plassere kompetanse manuelt — systemet foreslår
 * rolle- og resultatkoblinger med en konkret begrunnelse. Bekreftelse går
 * gjennom den kanoniske promoteringen, som skriver pekere til rolle/resultat.
 * Ingen handling her oppretter user_attested.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, SkipForward } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  invalidateCandidateQueries,
  promoteCandidate,
  type CvParseCandidateRow,
} from "@/lib/queries/cv-parse-candidates";
import { advanceReviewProgress } from "@/lib/queries/cv-review-progress";
import {
  SKILL_CONFIDENCE_LABEL,
  buildSkillSuggestions,
  type SkillSuggestion,
  type SuggestionResult,
  type SuggestionRole,
} from "@/lib/cv-review-skill-suggestions";
import type { CareerAtomType } from "@/lib/career-atom-v4-mapping";

export function CvReviewSkillsStep({
  userId,
  importId,
  signature,
  skillCandidates,
  roles,
  results,
  promotedByLocalRef,
  onContinue,
  onBack,
}: {
  userId: string;
  importId: string;
  signature: string;
  skillCandidates: CvParseCandidateRow[];
  roles: SuggestionRole[];
  results: SuggestionResult[];
  promotedByLocalRef: Map<string | null, string | null>;
  onContinue: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const pending = useMemo(
    () => skillCandidates.filter((c) => c.status === "ubehandlet" && !skipped.has(c.id)),
    [skillCandidates, skipped],
  );
  const suggestions = useMemo(
    () => buildSkillSuggestions({ candidates: pending, roles, results, promotedByLocalRef }),
    [pending, roles, results, promotedByLocalRef],
  );
  const bulk = suggestions.filter((s) => s.bulkEligible);

  const confirm = useMutation({
    mutationFn: async (items: { suggestion: SkillSuggestion; pointerIds: string[] }[]) => {
      for (const item of items) {
        const type = (item.suggestion.candidate.resolved_atom_type ??
          item.suggestion.candidate.suggested_atom_type ??
          "skill") as CareerAtomType;
        await promoteCandidate({
          userId,
          candidate: item.suggestion.candidate,
          resolvedType: type,
          verified: true,
          evidenceAtomIds: item.pointerIds,
          // Eksponering (domain) er alltid avledet av en rolle.
          parentAtomId: type === "domain" ? (item.suggestion.roles[0]?.atomId ?? null) : null,
        });
      }
      return items.length;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "Kompetansen er bekreftet." : `${n} kompetanser er bekreftet.`);
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const advance = useMutation({
    mutationFn: () =>
      advanceReviewProgress(importId, signature, 4, {
        step3_completed_at: new Date().toISOString(),
      }),
    onSuccess: onContinue,
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = confirm.isPending || advance.isPending;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trinn 3 av 4 · Kompetanse</CardTitle>
          <CardDescription>
            Vi har foreslått hvor kompetansen din hører hjemme, og hvorfor. Du bekrefter,
            retter eller hopper over. Samme kompetanse kan gjelde flere roller.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{suggestions.length} til gjennomgang</Badge>
          {bulk.length > 1 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                confirm.mutate(
                  bulk.map((s) => ({
                    suggestion: s,
                    pointerIds: [
                      ...s.roles.map((r) => r.atomId),
                      ...s.results.map((r) => r.atomId),
                    ],
                  })),
                )
              }
            >
              Bekreft alle {bulk.length}
            </Button>
          )}
        </CardContent>
      </Card>

      {suggestions.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Ingen kompetanser å gå gjennom i denne importen.
        </p>
      )}

      {suggestions.map((s) => (
        <SuggestionCard
          key={s.candidate.id}
          suggestion={s}
          roles={roles}
          results={results}
          busy={busy}
          onConfirm={(pointerIds) => confirm.mutate([{ suggestion: s, pointerIds }])}
          onSkip={() => setSkipped((prev) => new Set(prev).add(s.candidate.id))}
        />
      ))}

      <div className="flex justify-between">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          Tilbake til resultater
        </Button>
        <Button disabled={busy} onClick={() => advance.mutate()}>
          {advance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Fortsett til kvalifikasjoner
        </Button>
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  roles,
  results,
  busy,
  onConfirm,
  onSkip,
}: {
  suggestion: SkillSuggestion;
  roles: SuggestionRole[];
  results: SuggestionResult[];
  busy: boolean;
  onConfirm: (pointerIds: string[]) => void;
  onSkip: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(
    new Set(suggestion.roles.map((r) => r.atomId)),
  );
  const [selectedResults, setSelectedResults] = useState<Set<string>>(
    new Set(suggestion.results.map((r) => r.atomId)),
  );

  const pointerIds = [...selectedRoles, ...selectedResults];
  const isDomain =
    (suggestion.candidate.resolved_atom_type ?? suggestion.candidate.suggested_atom_type) ===
    "domain";
  const canConfirm = isDomain ? selectedRoles.size > 0 : pointerIds.length > 0;

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">{suggestion.title}</CardTitle>
          <Badge variant={suggestion.confidence === "hoy" ? "secondary" : "outline"}>
            {SKILL_CONFIDENCE_LABEL[suggestion.confidence]}
          </Badge>
        </div>
        <CardDescription>{suggestion.reason}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing && suggestion.roles.length > 0 && (
          <p className="text-sm">
            Foreslått rolle:{" "}
            {suggestion.roles.map((r) => r.title).join(", ")}
            {suggestion.results.length > 0 && (
              <>
                {" "}
                · resultat: {suggestion.results.map((r) => r.title).join(", ")}
              </>
            )}
          </p>
        )}

        {(editing || suggestion.roles.length === 0) && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-2">
              <Label className="text-xs">Hvilke roller gjelder kompetansen?</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((r) => (
                  <label key={r.atomId} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={selectedRoles.has(r.atomId)}
                      onCheckedChange={() => toggle(selectedRoles, r.atomId, setSelectedRoles)}
                    />
                    <span className="min-w-0">
                      {r.title}
                      {r.employer ? (
                        <span className="text-muted-foreground"> · {r.employer}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
                {roles.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Ingen bekreftede roller ennå. Gå tilbake til tidslinjen først.
                  </p>
                )}
              </div>
            </div>
            {results.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">Resultater som viser kompetansen (valgfritt)</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {results.map((r) => (
                    <label key={r.atomId} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={selectedResults.has(r.atomId)}
                        onCheckedChange={() =>
                          toggle(selectedResults, r.atomId, setSelectedResults)
                        }
                      />
                      <span className="min-w-0">{r.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !canConfirm} onClick={() => onConfirm(pointerIds)}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Bekreft
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Lukk" : "Rett"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>
            <SkipForward className="mr-1 h-3.5 w-3.5" /> Hopp over
          </Button>
        </div>
        {!canConfirm && (
          <p className="text-xs text-muted-foreground">
            Kompetanse belegges alltid indirekte. Velg minst én rolle eller ett resultat før du
            bekrefter.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
