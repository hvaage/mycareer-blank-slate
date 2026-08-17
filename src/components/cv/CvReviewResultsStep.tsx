/**
 * CV-gjennomgang, trinn 2: resultater per rolle.
 *
 * Resultatene vises under rollen de hører til, slik brukeren faktisk husker
 * dem. Bekreftelse går gjennom den kanoniske kontrakten (promoteCandidate):
 * den skriver evidens i karriereprofilen, og aldri attestasjoner.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ATOM_TYPE_LABEL,
  candidateTitle,
  invalidateCandidateQueries,
  promoteCandidate,
  rejectCandidate,
  type CvParseCandidateRow,
} from "@/lib/queries/cv-parse-candidates";
import { addManualResult, advanceReviewProgress } from "@/lib/queries/cv-review-progress";
import type { CareerAtomType } from "@/lib/career-atom-v4-mapping";
import type { TimelineRole } from "@/lib/cv-review-timeline";

const RESULT_TYPES: CareerAtomType[] = ["achievement", "metric", "project", "volunteer"];

export interface ResultGroup {
  role: TimelineRole | null;
  roleAtomId: string | null;
  candidates: CvParseCandidateRow[];
}

/**
 * Grupperer resultatkandidater under rollen de hører til. Kandidater uten
 * kjent rolle havner i en egen gruppe — vi gjetter aldri på tilhørighet.
 */
export function groupResultsByRole(
  candidates: CvParseCandidateRow[],
  roles: TimelineRole[],
  promotedByLocalRef: Map<string | null, string | null>,
): ResultGroup[] {
  const byAtomId = new Map(roles.map((r) => [r.id, r] as const));
  const groups = new Map<string, ResultGroup>();
  const unassigned: CvParseCandidateRow[] = [];

  for (const c of candidates) {
    const atomId = c.parent_local_ref ? (promotedByLocalRef.get(c.parent_local_ref) ?? null) : null;
    const role = atomId ? (byAtomId.get(atomId) ?? null) : null;
    if (!role || !atomId) {
      unassigned.push(c);
      continue;
    }
    const g = groups.get(atomId) ?? { role, roleAtomId: atomId, candidates: [] };
    g.candidates.push(c);
    groups.set(atomId, g);
  }

  const ordered = roles
    .map((r) => groups.get(r.id))
    .filter((g): g is ResultGroup => Boolean(g));
  if (unassigned.length > 0) {
    ordered.push({ role: null, roleAtomId: null, candidates: unassigned });
  }
  return ordered;
}

export function CvReviewResultsStep({
  userId,
  importId,
  signature,
  resultCandidates,
  savedRoles,
  promotedByLocalRef,
  onContinue,
  onBack,
}: {
  userId: string;
  importId: string;
  signature: string;
  resultCandidates: CvParseCandidateRow[];
  savedRoles: TimelineRole[];
  promotedByLocalRef: Map<string | null, string | null>;
  onContinue: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const pending = useMemo(
    () => resultCandidates.filter((c) => c.status === "ubehandlet"),
    [resultCandidates],
  );
  const groups = useMemo(
    () => groupResultsByRole(pending, savedRoles, promotedByLocalRef),
    [pending, savedRoles, promotedByLocalRef],
  );
  /** Roller fra trinn 1 som er lagret, og som resultater kan knyttes til. */
  const selectableRoles = useMemo(
    () => savedRoles.filter((r) => r.kind === "lagret"),
    [savedRoles],
  );
  const [roleChoice, setRoleChoice] = useState<Record<string, string>>({});
  const [bulkRole, setBulkRole] = useState<string>("");

  const confirm = useMutation({
    mutationFn: async (v: { rows: CvParseCandidateRow[]; parentAtomId: string | null }) => {
      for (const c of v.rows) {
        const resolved = (c.resolved_atom_type ?? c.suggested_atom_type ?? "achievement") as
          | CareerAtomType
          | "achievement";
        await promoteCandidate({
          userId,
          candidate: c,
          resolvedType: RESULT_TYPES.includes(resolved as CareerAtomType)
            ? (resolved as CareerAtomType)
            : "achievement",
          parentAtomId: v.parentAtomId,
          verified: true,
        });
      }
      return v.rows.length;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "Resultatet er bekreftet." : `${n} resultater er bekreftet.`);
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (c: CvParseCandidateRow) => rejectCandidate(userId, c, "ikke mitt resultat"),
    onSuccess: () => {
      toast.success("Avvist. Raden beholdes.");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addResult = useMutation({
    mutationFn: (v: { title: string; roleAtomId: string | null }) =>
      addManualResult({ userId, importId, title: v.title, roleAtomId: v.roleAtomId }),
    onSuccess: () => {
      toast.success("Resultatet er lagt til.");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const advance = useMutation({
    mutationFn: () =>
      advanceReviewProgress(importId, signature, 3, {
        step2_completed_at: new Date().toISOString(),
      }),
    onSuccess: onContinue,
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = confirm.isPending || reject.isPending || addResult.isPending || advance.isPending;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trinn 2 av 4 · Resultater per rolle</CardTitle>
          <CardDescription>
            Nå tar vi rollene én for én. Et resultat er noe du faktisk oppnådde i den rollen —
            det er dette som senere kan brukes i CV og søknad.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{pending.length} til gjennomgang</Badge>
          <Badge variant="secondary">{groups.length} grupper</Badge>
        </CardContent>
      </Card>

      {groups.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Ingen resultater å gå gjennom. Du kan legge til et resultat selv, eller gå videre.
        </p>
      )}

      {groups.map((g) => (
        <Card key={g.roleAtomId ?? "uten-rolle"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {g.role ? g.role.title : "Resultater uten kjent rolle"}
              {g.role?.employer ? (
                <span className="text-muted-foreground"> · {g.role.employer}</span>
              ) : null}
            </CardTitle>
            <CardDescription>
              {g.role
                ? "Bekreft det du kjenner igjen. Resultatet knyttes til denne rollen."
                : selectableRoles.length > 0
                  ? "Disse fant vi ingen rolle for. Velg hvilken rolle fra trinn 1 hvert resultat hører til før du bekrefter."
                  : "Disse fant vi ingen rolle for. Bekreft rollene i trinn 1 først, så kan du koble resultatene hit."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!g.roleAtomId && selectableRoles.length > 0 && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
                <div className="min-w-56 flex-1 space-y-1">
                  <Label className="text-xs">Knytt alle til rolle</Label>
                  <Select value={bulkRole} onValueChange={setBulkRole}>
                    <SelectTrigger>
                      <SelectValue placeholder="Velg rolle fra trinn 1" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableRoles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.title}
                          {r.employer ? ` · ${r.employer}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !bulkRole}
                  onClick={() => confirm.mutate({ rows: g.candidates, parentAtomId: bulkRole })}
                >
                  Bekreft alle ({g.candidates.length})
                </Button>
              </div>
            )}
            {g.roleAtomId && g.candidates.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  confirm.mutate({ rows: g.candidates, parentAtomId: g.roleAtomId })
                }
              >
                Bekreft alle ({g.candidates.length})
              </Button>
            )}
            {g.candidates.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm">{candidateTitle(c)}</p>
                  <p className="text-xs text-muted-foreground">
                    {ATOM_TYPE_LABEL[
                      (c.resolved_atom_type ?? c.suggested_atom_type ?? "achievement") as CareerAtomType
                    ] ?? "Resultat"}{" "}
                    · fra importen
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!g.roleAtomId && selectableRoles.length > 0 && (
                    <Select
                      value={roleChoice[c.id] ?? ""}
                      onValueChange={(v) => setRoleChoice((p) => ({ ...p, [c.id]: v }))}
                    >
                      <SelectTrigger className="w-56">
                        <SelectValue placeholder="Velg rolle" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableRoles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.title}
                            {r.employer ? ` · ${r.employer}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      (!g.roleAtomId && selectableRoles.length > 0 && !(roleChoice[c.id] ?? bulkRole))
                    }
                    onClick={() =>
                      confirm.mutate({
                        rows: [c],
                        parentAtomId: g.roleAtomId ?? roleChoice[c.id] ?? bulkRole ?? null,
                      })
                    }
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Bekreft
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => reject.mutate(c)}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" /> Ikke mitt
                  </Button>
                </div>
              </div>
            ))}
            {g.roleAtomId && (
              <ManualResultForm
                busy={busy}
                onSubmit={(title) => addResult.mutate({ title, roleAtomId: g.roleAtomId })}
              />
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-between">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          Tilbake til tidslinjen
        </Button>
        <Button disabled={busy} onClick={() => advance.mutate()}>
          {advance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Fortsett til kompetanse
        </Button>
      </div>
    </div>
  );
}

function ManualResultForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
      <div className="min-w-56 flex-1 space-y-1">
        <Label className="text-xs">Mangler et resultat fra denne rollen?</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Kort beskrivelse av det du oppnådde"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !title.trim()}
        onClick={() => {
          onSubmit(title.trim());
          setTitle("");
        }}
      >
        Legg til
      </Button>
    </div>
  );
}

/** Eksportert for gjenbruk i tester og eventuelle andre visninger. */
export const RESULT_CANDIDATE_TYPES = RESULT_TYPES;

export function isResultCandidate(c: CvParseCandidateRow): boolean {
  const t = (c.resolved_atom_type ?? c.suggested_atom_type ?? "") as CareerAtomType;
  return RESULT_TYPES.includes(t);
}
