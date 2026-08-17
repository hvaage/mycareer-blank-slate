/**
 * CV-gjennomgang, trinn 3: kompetanse med belegg fra v2.1.
 *
 * Datagrunnlaget er v2.1s konsoliderte kompetanseforslag, ikke rå
 * parsekandidater. Kompetanse med dokumentert belegg vises med ferdige
 * koblinger (forhåndsvalgt). Kompetanse uten belegg vises som «Trenger
 * vurdering» — uten forhåndsvalg, og uten å liste hele CV-ens resultater.
 * Bekreftelse går gjennom den kanoniske promoteringen. Ingen handling her
 * oppretter user_attested.
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
import type { SuggestionResult, SuggestionRole } from "@/lib/cv-review-skill-suggestions";
import {
  SKILL_PLACEMENT_CONFIDENCE_LABEL,
  type SkillBasis,
  type SkillBasisItem,
} from "@/lib/cv-review-skill-basis";
import type { CareerAtomType } from "@/lib/career-atom-v4-mapping";

export function CvReviewSkillsStep({
  userId,
  importId,
  signature,
  basis,
  roles,
  results,
  onContinue,
  onBack,
}: {
  userId: string;
  importId: string;
  signature: string;
  basis: SkillBasis;
  roles: SuggestionRole[];
  results: SuggestionResult[];
  onContinue: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const pending = useMemo(
    () =>
      basis.items.filter(
        (i) => i.candidate.status === "ubehandlet" && !skipped.has(i.candidate.id),
      ),
    [basis.items, skipped],
  );
  const documented = pending.filter((i) => !i.needsPlacement);
  const unresolved = pending.filter((i) => i.needsPlacement);

  const confirm = useMutation({
    mutationFn: async (items: { item: SkillBasisItem; pointerIds: string[] }[]) => {
      for (const entry of items) {
        const type = (entry.item.candidate.resolved_atom_type ??
          entry.item.candidate.suggested_atom_type ??
          "skill") as CareerAtomType;
        await promoteCandidate({
          userId,
          candidate: entry.item.candidate,
          resolvedType: type,
          verified: true,
          evidenceAtomIds: entry.pointerIds,
          // Eksponering (domain) er alltid avledet av en rolle.
          parentAtomId: type === "domain" ? (entry.item.roles[0]?.atomId ?? null) : null,
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
            Kompetanse med belegg i CV-en er allerede koblet til rolle og resultat. Du
            bekrefter, eller retter plasseringen. Kompetanse uten belegg må du plassere selv.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{pending.length} til gjennomgang</Badge>
          {documented.length > 0 && (
            <Badge variant="outline">{documented.length} med belegg</Badge>
          )}
          {unresolved.length > 0 && (
            <Badge variant="outline">{unresolved.length} trenger vurdering</Badge>
          )}
          {documented.length > 1 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                confirm.mutate(
                  documented.map((item) => ({
                    item,
                    pointerIds: [
                      ...item.roles.map((r) => r.atomId),
                      ...item.results.map((r) => r.atomId),
                    ],
                  })),
                )
              }
            >
              Bekreft alle {documented.length} med belegg
            </Button>
          )}
        </CardContent>
      </Card>

      {pending.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Ingen kompetanser å gå gjennom i denne importen.
        </p>
      )}

      {pending.map((item) => (
        <SkillCard
          key={item.candidate.id}
          item={item}
          roles={roles}
          results={results}
          busy={busy}
          onConfirm={(pointerIds) => confirm.mutate([{ item, pointerIds }])}
          onSkip={() => setSkipped((prev) => new Set(prev).add(item.candidate.id))}
        />
      ))}

      {basis.localSignals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Lokale evidenssignaler</CardTitle>
            <CardDescription>
              Disse hører til én bestemt rolle eller ett resultat, og blir stående der. De
              gjennomgås ikke som egne kompetanser.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {basis.localSignals.map((s) => (
              <Badge key={s.canonicalKey} variant="outline">
                {s.title}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {basis.deviations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Avvik fra CV-analysen</CardTitle>
            <CardDescription>
              {basis.deviations.length} funn i råteksten ble ikke tatt med som kompetanse av
              analysen. De blir ikke egne kort, men er beholdt som kilde.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {basis.deviations.map((c) => (
              <Badge key={c.id} variant="outline">
                {(c.content_no ?? c.content_en ?? "Uten tekst").slice(0, 48)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

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

function SkillCard({
  item,
  roles,
  results,
  busy,
  onConfirm,
  onSkip,
}: {
  item: SkillBasisItem;
  roles: SuggestionRole[];
  results: SuggestionResult[];
  busy: boolean;
  onConfirm: (pointerIds: string[]) => void;
  onSkip: () => void;
}) {
  // Forhåndsvalg kun fra dokumentert belegg. Trenger kompetansen vurdering,
  // starter vi tomt — ingen rolle, heller ikke Privat eller Freelance.
  const [editing, setEditing] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(
    new Set(item.roles.map((r) => r.atomId)),
  );
  const [selectedResults, setSelectedResults] = useState<Set<string>>(
    new Set(item.results.map((r) => r.atomId)),
  );

  const showPicker = editing || item.needsPlacement;
  const pointerIds = [...selectedRoles, ...selectedResults];
  const isDomain =
    (item.candidate.resolved_atom_type ?? item.candidate.suggested_atom_type) === "domain";
  const canConfirm = isDomain ? selectedRoles.size > 0 : pointerIds.length > 0;

  // Resultatvalg begrenses til den valgte rollen. Hele CV-ens resultater er
  // aldri en standard avhukingsliste.
  const selectableResults = useMemo(
    () =>
      results.filter(
        (r) =>
          selectedResults.has(r.atomId) ||
          (r.roleAtomId ? selectedRoles.has(r.roleAtomId) : false),
      ),
    [results, selectedRoles, selectedResults],
  );

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
          <CardTitle className="text-base">{item.title}</CardTitle>
          <Badge variant={item.needsPlacement ? "outline" : "secondary"}>
            {item.needsPlacement
              ? "Trenger vurdering"
              : (SKILL_PLACEMENT_CONFIDENCE_LABEL[item.confidence ?? ""] ?? "Belagt i CV-en")}
          </Badge>
        </div>
        <CardDescription>{item.reason}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!showPicker && (
          <p className="text-sm">
            Roller: {item.roles.map((r) => r.title).join(", ") || "ingen"}
            {item.results.length > 0 && (
              <> · resultater: {item.results.map((r) => r.title).join(", ")}</>
            )}
          </p>
        )}

        {showPicker && (
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
                      {r.employer ? (
                        <>
                          <span className="text-muted-foreground">{r.employer} · </span>
                          {r.title}
                        </>
                      ) : (
                        r.title
                      )}
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
            {selectableResults.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">
                  Resultater under valgt rolle som viser kompetansen (valgfritt)
                </Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {selectableResults.map((r) => (
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
          {!item.needsPlacement && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Lukk" : "Endre plassering"}
            </Button>
          )}
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

export type { CvParseCandidateRow };
