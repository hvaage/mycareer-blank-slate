// @ts-nocheck
/**
 * CV-gjennomgang, trinn 4: språk, førerkort, sertifiseringer, vitnemål og
 * verktøy.
 *
 * Dette er ikke løse erfaringer. Hver post klassifiseres automatisk til én av
 * de fem artene, og brukeren kan korrigere arten, gradere språk og
 * førerkortklasse før bekreftelse. Dokumentasjon lastes opp under Erfaring og
 * kompetanse når posten er bekreftet.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  candidateTitle,
  invalidateCandidateQueries,
  promoteCandidate,
  rejectCandidate,
  type CvParseCandidateRow,
} from "@/lib/queries/cv-parse-candidates";
import { advanceReviewProgress } from "@/lib/queries/cv-review-progress";
import type { CareerAtomType } from "@/lib/career-atom-v4-mapping";
import {
  CREDENTIAL_ATOM_TYPE,
  CREDENTIAL_DOCUMENTABLE,
  CREDENTIAL_DOC_HINT,
  CREDENTIAL_KIND_LABEL,
  CREDENTIAL_KIND_ORDER,
  CREDENTIAL_KIND_SINGULAR,
  DRIVING_LICENSE_CLASSES,
  LANGUAGE_LEVELS,
  classifyCredential,
  credentialTitle,
  inferLanguageLevel,
  inferLicenseClasses,
  type CredentialKind,
} from "@/lib/credential-kinds";

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

const NO_LEVEL = "__ingen__";

type Decision = { kind: CredentialKind; level: string | null; classes: string[] };

function initialDecision(c: CvParseCandidateRow): Decision {
  const text = candidateTitle(c);
  const type = (c.resolved_atom_type ?? c.suggested_atom_type ?? "") as string;
  const kind =
    classifyCredential({ atomType: type, text, structured: c.structured_data as any }) ?? "sertifisering";
  return {
    kind,
    level: kind === "sprak" ? inferLanguageLevel(text) : null,
    classes: kind === "forerkort" ? inferLicenseClasses(text) : [],
  };
}

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

  const [overrides, setOverrides] = useState<Record<string, Partial<Decision>>>({});
  const decisionFor = (c: CvParseCandidateRow): Decision => ({
    ...initialDecision(c),
    ...(overrides[c.id] ?? {}),
  });

  const setDecision = (id: string, patch: Partial<Decision>) =>
    setOverrides((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));

  const groups = useMemo(() => {
    const map = new Map<CredentialKind, CvParseCandidateRow[]>();
    for (const c of pending) {
      const kind = decisionFor(c).kind;
      map.set(kind, [...(map.get(kind) ?? []), c]);
    }
    return CREDENTIAL_KIND_ORDER.filter((k) => (map.get(k) ?? []).length > 0).map(
      (k) => [k, map.get(k)!] as const,
    );
  }, [pending, overrides]);

  const confirm = useMutation({
    mutationFn: async (rows: CvParseCandidateRow[]) => {
      for (const c of rows) {
        const d = decisionFor(c);
        const extra: Record<string, unknown> = { credential_kind: d.kind };
        if (d.kind === "sprak" && d.level) extra.sprak_niva = d.level;
        if (d.kind === "forerkort" && d.classes.length > 0) extra.forerkort_klasser = d.classes;
        await promoteCandidate({
          userId,
          candidate: c,
          resolvedType: CREDENTIAL_ATOM_TYPE[d.kind] as CareerAtomType,
          verified: true,
          titleOverride: credentialTitle(d.kind, candidateTitle(c)),
          extraStructured: extra,
        });
      }
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "Bekreftet." : `${n} poster er bekreftet.`);
      invalidateCandidateQueries(qc, userId);
      void qc.invalidateQueries({ queryKey: ["credential-atoms", userId] });
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
          <CardTitle className="text-base">
            Trinn 4 av 4 · Språk, førerkort, sertifiseringer, vitnemål og verktøy
          </CardTitle>
          <CardDescription>
            Hver post er klassifisert automatisk. Rett arten hvis den er feil, sett språknivå eller
            førerkortklasse, og bekreft. Dokumentasjon laster du opp etterpå under Erfaring og
            kompetanse.
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

      {groups.map(([kind, rows]) => (
        <Card key={kind}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{CREDENTIAL_KIND_LABEL[kind]}</CardTitle>
            <CardDescription>
              {rows.length} poster fra importen.{" "}
              {CREDENTIAL_DOCUMENTABLE[kind] ? CREDENTIAL_DOC_HINT[kind] : ""}
            </CardDescription>
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
            {rows.map((c) => {
              const d = decisionFor(c);
              return (
                <div key={c.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
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

                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={d.kind}
                      onValueChange={(v) => setDecision(c.id, { kind: v as CredentialKind })}
                    >
                      <SelectTrigger className="h-7 w-[190px] text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CREDENTIAL_KIND_ORDER.map((k) => (
                          <SelectItem key={k} value={k}>
                            {CREDENTIAL_KIND_SINGULAR[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {d.kind === "sprak" && (
                      <Select
                        value={d.level ?? NO_LEVEL}
                        onValueChange={(v) =>
                          setDecision(c.id, { level: v === NO_LEVEL ? null : v })
                        }
                      >
                        <SelectTrigger className="h-7 w-[240px] text-[11px]">
                          <SelectValue placeholder="Velg nivå" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_LEVEL}>Nivå ikke satt</SelectItem>
                          {LANGUAGE_LEVELS.map((l) => (
                            <SelectItem key={l.value} value={l.value}>
                              {l.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {d.kind === "forerkort" && (
                      <div className="flex flex-wrap gap-1">
                        {DRIVING_LICENSE_CLASSES.map((cl) => {
                          const on = d.classes.includes(cl.value);
                          return (
                            <button
                              key={cl.value}
                              type="button"
                              title={cl.label}
                              onClick={() =>
                                setDecision(c.id, {
                                  classes: on
                                    ? d.classes.filter((v) => v !== cl.value)
                                    : [...d.classes, cl.value],
                                })
                              }
                              className={
                                "rounded border px-1.5 py-0.5 text-[11px] " +
                                (on
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "text-muted-foreground")
                              }
                            >
                              {cl.value}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
