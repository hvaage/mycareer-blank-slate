/**
 * CV-gjennomgang, trinn 4: kvalifikasjoner og resten.
 *
 * Utdanning, sertifiseringer, språk og verktøy vises samlet. Ingenting
 * slettes — avviste poster beholdes med status «avvist».
 */
import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ATOM_TYPE_LABEL,
  candidateTitle,
  invalidateCandidateQueries,
  promoteCandidate,
  rejectCandidate,
  type CvParseCandidateRow,
} from "@/lib/queries/cv-parse-candidates";
import { advanceReviewProgress } from "@/lib/queries/cv-review-progress";
import type { CareerAtomType } from "@/lib/career-atom-v4-mapping";

export const QUALIFICATION_TYPES: CareerAtomType[] = [
  "education",
  "certification",
  "language",
  "tool",
];

export function isQualificationCandidate(c: CvParseCandidateRow): boolean {
  const t = (c.resolved_atom_type ?? c.suggested_atom_type ?? "") as CareerAtomType;
  return QUALIFICATION_TYPES.includes(t);
}

const GROUP_TITLE: Record<string, string> = {
  education: "Utdanning",
  certification: "Sertifiseringer",
  language: "Språk",
  tool: "Verktøy",
};

export function CvReviewQualificationsStep({
  userId,
  importId,
  signature,
  candidates,
  onFinish,
  onBack,
}: {
  userId: string;
  importId: string;
  signature: string;
  candidates: CvParseCandidateRow[];
  onFinish: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const pending = useMemo(
    () => candidates.filter((c) => c.status === "ubehandlet"),
    [candidates],
  );

  const groups = useMemo(() => {
    const map = new Map<string, CvParseCandidateRow[]>();
    for (const c of pending) {
      const t = (c.resolved_atom_type ?? c.suggested_atom_type ?? "tool") as string;
      map.set(t, [...(map.get(t) ?? []), c]);
    }
    return [...map.entries()];
  }, [pending]);

  const confirm = useMutation({
    mutationFn: async (rows: CvParseCandidateRow[]) => {
      for (const c of rows) {
        const type = (c.resolved_atom_type ?? c.suggested_atom_type ?? "tool") as CareerAtomType;
        await promoteCandidate({ userId, candidate: c, resolvedType: type, verified: true });
      }
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "Bekreftet." : `${n} poster er bekreftet.`);
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (c: CvParseCandidateRow) => rejectCandidate(userId, c, "feil i importen"),
    onSuccess: () => {
      toast.success("Avvist. Raden beholdes.");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finish = useMutation({
    mutationFn: () =>
      advanceReviewProgress(importId, signature, 5, {
        step4_completed_at: new Date().toISOString(),
      }),
    onSuccess: onFinish,
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = confirm.isPending || reject.isPending || finish.isPending;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trinn 4 av 4 · Kvalifikasjoner og resten</CardTitle>
          <CardDescription>
            Utdanning, sertifiseringer, språk og verktøy. Bekreft det som stemmer — det du
            avviser blir stående som avvist, ikke slettet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{pending.length} til gjennomgang</Badge>
          {pending.length > 1 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => confirm.mutate(pending)}
            >
              Bekreft alle ({pending.length})
            </Button>
          )}
        </CardContent>
      </Card>

      {groups.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Ingen kvalifikasjoner å gå gjennom i denne importen.
        </p>
      )}

      {groups.map(([type, rows]) => (
        <Card key={type}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {GROUP_TITLE[type] ?? ATOM_TYPE_LABEL[type as CareerAtomType] ?? "Annet"}
            </CardTitle>
            <CardDescription>{rows.length} poster fra importen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => confirm.mutate(rows)}
              >
                Bekreft alle ({rows.length})
              </Button>
            )}
            {rows.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
              >
                <p className="min-w-0 text-sm">{candidateTitle(c)}</p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => confirm.mutate([c])}>
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Bekreft
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => reject.mutate(c)}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" /> Feil
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-between">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          Tilbake til kompetanse
        </Button>
        <Button disabled={busy} onClick={() => finish.mutate()}>
          {finish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Fullfør gjennomgangen
        </Button>
      </div>
    </div>
  );
}
