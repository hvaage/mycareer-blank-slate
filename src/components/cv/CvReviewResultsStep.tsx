/**
 * CV-gjennomgang, trinn 2: resultater per rolle.
 *
 * Et resultat kan være riktig, men stå under feil rolle. Derfor har hvert
 * kort to primære handlinger: «Bekreft» og «Rolle». Avvisning ligger i en
 * diskret meny med bekreftelse.
 *
 * Lagringsregel:
 * - Et rollevalg som ikke er bekreftet, er review-state. Det lagres i
 *   `cv_review_progress.step_state.role_choices` gjennom RPC-en
 *   `cv_review_set_role_choice`, og overlever refresh.
 * - Først ved «Bekreft» kjøres den kanoniske flyten
 *   `cv_review_promote_result`: resultatatom + aktiv `oppnadd_i`-lenke +
 *   `career_atom_project_parent`. `parent_atom_id` skrives aldri direkte.
 * - Bekreftelse her er atom-tillit og påvirker ikke claim-attestasjoner.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MoreHorizontal, Pencil } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ATOM_TYPE_LABEL,
  candidateTitle,
  invalidateCandidateQueries,
  rejectCandidate,
  type CvParseCandidateRow,
} from "@/lib/queries/cv-parse-candidates";
import {
  addManualResult,
  advanceReviewProgress,
  invalidateReviewProgress,
  promoteResultToRole,
  setResultRoleChoice,
} from "@/lib/queries/cv-review-progress";
import type { CareerAtomType } from "@/lib/career-atom-v4-mapping";
import { roleFromCandidate, type TimelineRole } from "@/lib/cv-review-timeline";
import {
  STANDARD_ROLES,
  ensureStandardRole,
  parseStandardRoleValue,
  standardRoleValue,
} from "@/lib/standard-roles";

const RESULT_TYPES: CareerAtomType[] = ["achievement", "metric", "project", "volunteer"];

/** Prefiks for roller som ennå bare finnes som forslag i trinn 1. */
const CANDIDATE_ROLE_PREFIX = "cand:";
/** Sentinelverdi: brukeren finner ikke stillingen og sendes tilbake til trinn 1. */
const MISSING_ROLE = "__mangler__";

/**
 * Provisorisk rolle: perioden og arbeidsgiveren er strukturelt sikre, men
 * stillingstittelen mangler. Da stilles ett spørsmål på rollen — ikke ett per
 * resultat under den.
 */
function isProvisionalRole(role: TimelineRole): boolean {
  return role.titleMissing || !role.title.trim();
}

function rolePeriodLabel(role: TimelineRole): string {
  const fmt = (iso: string | null) => (iso ? iso.slice(0, 7) : null);
  const start = fmt(role.startIso);
  const end = role.isCurrent ? "i dag" : fmt(role.endIso);
  if (!start && !end) return "";
  return [start, end].filter(Boolean).join("–");
}

/** «Arbeidsgiver · Stilling (periode)» — arbeidsgiver først. */
function roleLabel(role: TimelineRole): string {
  const title = role.title.trim() || "Stilling ikke avklart";
  const base = role.employer ? `${role.employer} · ${title}` : title;
  const period = rolePeriodLabel(role);
  return period ? `${base} (${period})` : base;
}

export interface RoleOption {
  value: string;
  label: string;
  /** Roller som ennå ikke er bekreftet i trinn 1 kan velges, men ikke bekreftes. */
  pending: boolean;
  needsClarification: boolean;
}

/**
 * Rollevalg: bekreftede roller i karriereoversikten, ubekreftede rolleforslag
 * fra importen, og standardrollene Privat/Freelance.
 */
export function buildRoleOptions(
  savedRoles: TimelineRole[],
  roleCandidates: CvParseCandidateRow[],
): RoleOption[] {
  const options: RoleOption[] = [];
  for (const r of savedRoles.filter((r) => r.kind === "lagret")) {
    options.push({
      value: r.id,
      label: roleLabel(r),
      pending: false,
      needsClarification: isProvisionalRole(r),
    });
  }
  for (const c of roleCandidates.filter((c) => c.status === "ubehandlet")) {
    const r = roleFromCandidate(c);
    options.push({
      value: `${CANDIDATE_ROLE_PREFIX}${c.id}`,
      label: roleLabel(r),
      pending: true,
      needsClarification: isProvisionalRole(r),
    });
  }
  const taken = new Set(
    savedRoles.map((r) => (r.title ?? "").trim().toLowerCase()).filter(Boolean),
  );
  for (const sr of STANDARD_ROLES) {
    if (taken.has(sr.title.toLowerCase())) continue;
    options.push({
      value: standardRoleValue(sr),
      label: sr.title,
      pending: false,
      needsClarification: false,
    });
  }
  return options;
}

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

/** Kan valget bekreftes nå? Rolleforslag må først bekreftes i trinn 1. */
export function isConfirmableRoleValue(value: string | null): boolean {
  return Boolean(value) && !value!.startsWith(CANDIDATE_ROLE_PREFIX);
}

export function CvReviewResultsStep({
  userId,
  importId,
  signature,
  resultCandidates,
  roleCandidates,
  savedRoles,
  roleChoices,
  promotedByLocalRef,
  onContinue,
  onBack,
}: {
  userId: string;
  importId: string;
  signature: string;
  resultCandidates: CvParseCandidateRow[];
  roleCandidates: CvParseCandidateRow[];
  savedRoles: TimelineRole[];
  /** Påbegynte, ubekreftede rollevalg fra review-state (kandidat-id → verdi). */
  roleChoices: Record<string, string>;
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
  const roleOptions = useMemo(
    () => buildRoleOptions(savedRoles, roleCandidates),
    [savedRoles, roleCandidates],
  );
  const optionByValue = useMemo(
    () => new Map(roleOptions.map((o) => [o.value, o] as const)),
    [roleOptions],
  );
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState<CvParseCandidateRow | null>(null);

  /** Valgt rolle for et resultat: eksplisitt valg vinner over foreslått rolle. */
  function effectiveValue(c: CvParseCandidateRow, groupRoleAtomId: string | null): string | null {
    return roleChoices[c.id] ?? groupRoleAtomId ?? null;
  }

  const choose = useMutation({
    mutationFn: (v: { candidateId: string; choice: string | null }) =>
      setResultRoleChoice({
        importId,
        signature,
        candidateId: v.candidateId,
        choice: v.choice,
      }),
    onSuccess: () => invalidateReviewProgress(qc, userId),
    onError: (e: Error) => toast.error(e.message),
  });

  const confirm = useMutation({
    mutationFn: async (v: { rows: CvParseCandidateRow[]; groupRoleAtomId: string | null }) => {
      let done = 0;
      for (const c of v.rows) {
        const value = effectiveValue(c, v.groupRoleAtomId);
        if (!value) throw new Error("Velg rolle før du bekrefter resultatet.");
        if (!isConfirmableRoleValue(value)) {
          throw new Error(
            "Rollen er ennå bare et forslag. Bekreft den i trinn 1 før du bekrefter resultatet.",
          );
        }
        const std = parseStandardRoleValue(value);
        const roleAtomId = std
          ? await ensureStandardRole({
              userId,
              importId,
              role: std,
              existingRoles: savedRoles,
            })
          : value;

        const resolved = (c.resolved_atom_type ?? c.suggested_atom_type ?? "achievement") as
          | CareerAtomType
          | "achievement";
        await promoteResultToRole({
          candidateId: c.id,
          roleAtomId,
          resolvedType: RESULT_TYPES.includes(resolved as CareerAtomType)
            ? resolved
            : "achievement",
        });
        if (roleChoices[c.id]) {
          await setResultRoleChoice({ importId, signature, candidateId: c.id, choice: null });
        }
        done += 1;
      }
      return done;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "Resultatet er bekreftet." : `${n} resultater er bekreftet.`);
      invalidateCandidateQueries(qc, userId);
      invalidateReviewProgress(qc, userId);
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

  const busy =
    confirm.isPending ||
    reject.isPending ||
    addResult.isPending ||
    advance.isPending ||
    choose.isPending;

  /** Bulk gjelder kun resultater som peker på samme rolle og kan bekreftes nå. */
  function bulkRows(g: ResultGroup): CvParseCandidateRow[] {
    const values = g.candidates.map((c) => effectiveValue(c, g.roleAtomId));
    const first = values.find((v) => v) ?? null;
    if (!first || !isConfirmableRoleValue(first)) return [];
    return g.candidates.filter((c, i) => values[i] === first && Boolean(c));
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trinn 2 av 4 · Resultater per rolle</CardTitle>
          <CardDescription>
            Nå tar vi rollene én for én. Et resultat er noe du faktisk oppnådde i den rollen —
            det er dette som senere kan brukes i CV og søknad. Står et resultat under feil
            rolle, velger du «Rolle» og flytter det.
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

      {groups.map((g) => {
        const bulk = bulkRows(g);
        return (
          <Card key={g.roleAtomId ?? "uten-rolle"}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {g.role
                  ? isProvisionalRole(g.role)
                    ? "Stilling ikke avklart"
                    : g.role.title
                  : "Resultater uten kjent rolle"}
                {g.role?.employer ? (
                  <span className="text-muted-foreground"> · {g.role.employer}</span>
                ) : null}
              </CardTitle>
              <CardDescription>
                {g.role
                  ? "Bekreft det du kjenner igjen, eller velg «Rolle» for å flytte resultatet."
                  : "Disse fant vi ingen rolle for. Velg rolle — også «Privat» eller «Freelance» — før du bekrefter."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {g.role && isProvisionalRole(g.role) && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3">
                  <p className="text-sm">
                    Hva var rollen din hos {g.role.employer ?? "denne arbeidsgiveren"}
                    {rolePeriodLabel(g.role) ? ` i perioden ${rolePeriodLabel(g.role)}` : ""}?
                    Innholdet under hører til denne perioden — du trenger bare svare én gang.
                  </p>
                  <Button variant="outline" size="sm" disabled={busy} onClick={onBack}>
                    Legg inn stillingen i trinn 1
                  </Button>
                </div>
              )}

              {bulk.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => confirm.mutate({ rows: bulk, groupRoleAtomId: g.roleAtomId })}
                >
                  Bekreft alle med samme rolle ({bulk.length})
                </Button>
              )}

              {g.candidates.map((c) => {
                const value = effectiveValue(c, g.roleAtomId);
                const option = value ? (optionByValue.get(value) ?? null) : null;
                const chosenLabel =
                  option?.label ?? (value && g.role ? roleLabel(g.role) : null);
                const open = editing[c.id] ?? (!value && !g.roleAtomId);
                const confirmable = isConfirmableRoleValue(value);
                return (
                  <div key={c.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm">{candidateTitle(c)}</p>
                        <p className="text-xs text-muted-foreground">
                          {ATOM_TYPE_LABEL[
                            (c.resolved_atom_type ??
                              c.suggested_atom_type ??
                              "achievement") as CareerAtomType
                          ] ?? "Resultat"}{" "}
                          · fra importen
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={busy || !confirmable}
                          onClick={() =>
                            confirm.mutate({ rows: [c], groupRoleAtomId: g.roleAtomId })
                          }
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Bekreft
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setEditing((p) => ({ ...p, [c.id]: !open }))}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Rolle
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" disabled={busy} aria-label="Flere valg">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setRejecting(c)}>
                              Ikke mitt resultat
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {chosenLabel && !open && (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Valgt rolle: </span>
                        {chosenLabel}
                        {option?.pending && (
                          <Badge variant="outline" className="ml-2">
                            må bekreftes i trinn 1
                          </Badge>
                        )}
                        {option?.needsClarification && (
                          <Badge variant="outline" className="ml-2">
                            trenger avklaring
                          </Badge>
                        )}
                      </p>
                    )}
                    {!chosenLabel && !open && (
                      <p className="text-xs text-muted-foreground">
                        Ingen rolle valgt. Velg «Rolle» før du bekrefter.
                      </p>
                    )}

                    {open && (
                      <RoleSelect
                        options={roleOptions}
                        value={value ?? ""}
                        onChange={(v) => {
                          choose.mutate({ candidateId: c.id, choice: v });
                          setEditing((p) => ({ ...p, [c.id]: false }));
                        }}
                        onMissing={onBack}
                        placeholder="Velg rolle"
                        className="w-full sm:w-96"
                      />
                    )}
                  </div>
                );
              })}

              {g.roleAtomId && (
                <ManualResultForm
                  busy={busy}
                  onSubmit={(title) => addResult.mutate({ title, roleAtomId: g.roleAtomId })}
                />
              )}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex justify-between">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          Tilbake til tidslinjen
        </Button>
        <Button disabled={busy} onClick={() => advance.mutate()}>
          {advance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Fortsett til kompetanse
        </Button>
      </div>

      <AlertDialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Avvise dette resultatet?</AlertDialogTitle>
            <AlertDialogDescription>
              «{rejecting ? candidateTitle(rejecting) : ""}» tas ut av gjennomgangen. Raden
              slettes ikke, og du kan hente den fram igjen senere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejecting) reject.mutate(rejecting);
                setRejecting(null);
              }}
            >
              Avvis resultatet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Rollevelger. Arbeidsgiver vises først, så stilling og periode. */
function RoleSelect({
  options,
  value,
  onChange,
  onMissing,
  placeholder,
  className,
}: {
  options: RoleOption[];
  value: string;
  onChange: (v: string) => void;
  onMissing: () => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === MISSING_ROLE) {
          onMissing();
          return;
        }
        onChange(v);
      }}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
            {o.needsClarification ? " · trenger avklaring" : ""}
            {o.pending ? " · ikke bekreftet ennå" : ""}
          </SelectItem>
        ))}
        <SelectItem value={MISSING_ROLE}>Stilling mangler – legg den til i trinn 1</SelectItem>
      </SelectContent>
    </Select>
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
