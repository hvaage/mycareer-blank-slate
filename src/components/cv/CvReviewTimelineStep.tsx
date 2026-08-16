/**
 * CV-gjennomgang, trinn 1: karrieretidslinjen.
 *
 * Brukeren ser rollene kronologisk, bekrefter dem (enkeltvis eller samlet),
 * legger til roller maskinen ikke fant, og kan forklare hull i tidslinjen.
 * Forklaringen er privat: den brukes aldri i CV, eksport eller modellgrunnlag.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  detectGaps,
  roleFromCandidate,
  sortRoles,
  type TimelineGap,
  type TimelineRole,
} from "@/lib/cv-review-timeline";
import {
  invalidateCandidateQueries,
  promoteCandidate,
  rejectCandidate,
  type CvParseCandidateRow,
} from "@/lib/queries/cv-parse-candidates";
import {
  addManualRole,
  advanceReviewProgress,
  deleteTimelineContext,
  invalidateReviewProgress,
  saveTimelineContext,
  setRoleTitle,
  timelineContextQuery,
} from "@/lib/queries/cv-review-progress";

const GAP_CATEGORIES: { value: string; label: string }[] = [
  { value: "studier", label: "Studier" },
  { value: "permisjon", label: "Permisjon" },
  { value: "sabbatsar", label: "Sabbatsår" },
  { value: "selvstendig", label: "Selvstendig arbeid" },
  { value: "annet", label: "Annet" },
];

function periodLabel(r: TimelineRole): string {
  if (!r.startIso) return "Mangler datoer";
  const start = r.startIso.slice(0, 7);
  if (r.isCurrent) return `${start} – nå`;
  return r.endIso ? `${start} – ${r.endIso.slice(0, 7)}` : `${start} – ukjent slutt`;
}

export function CvReviewTimelineStep({
  userId,
  importId,
  signature,
  roleCandidates,
  savedRoles,
  onContinue,
}: {
  userId: string;
  importId: string;
  signature: string;
  roleCandidates: CvParseCandidateRow[];
  savedRoles: TimelineRole[];
  onContinue: () => void;
}) {
  const qc = useQueryClient();
  const contexts = useQuery(timelineContextQuery(userId));
  const [showAdd, setShowAdd] = useState(false);

  const pendingRoles = useMemo(
    () => sortRoles(roleCandidates.filter((c) => c.status === "ubehandlet").map(roleFromCandidate)),
    [roleCandidates],
  );
  const timeline = useMemo(
    () => sortRoles([...savedRoles, ...pendingRoles]),
    [savedRoles, pendingRoles],
  );
  const gaps = useMemo(() => detectGaps(timeline), [timeline]);

  const confirm = useMutation({
    mutationFn: async (rows: CvParseCandidateRow[]) => {
      for (const c of rows) {
        await promoteCandidate({ userId, candidate: c, resolvedType: "role", verified: true });
      }
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "Rollen er bekreftet." : `${n} roller er bekreftet.`);
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (c: CvParseCandidateRow) => rejectCandidate(userId, c, "ikke min rolle"),
    onSuccess: () => {
      toast.success("Avvist. Raden beholdes.");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRole = useMutation({
    mutationFn: (v: Omit<Parameters<typeof addManualRole>[0], "userId" | "importId">) =>
      addManualRole({ ...v, userId, importId }),
    onSuccess: () => {
      toast.success("Rollen er lagt til.");
      setShowAdd(false);
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTitle = useMutation({
    mutationFn: (v: { role: TimelineRole; title: string }) =>
      setRoleTitle({ userId, kind: v.role.kind, id: v.role.id, title: v.title }),
    onSuccess: () => {
      toast.success("Stillingstittelen er lagret.");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveGap = useMutation({
    mutationFn: (v: { gap: TimelineGap; category: string; note: string }) =>
      saveTimelineContext({
        userId,
        importId,
        gapStart: v.gap.startIso,
        gapEnd: v.gap.endIso,
        category: v.category,
        note: v.note,
      }),
    onSuccess: () => {
      toast.success("Forklaringen er lagret. Den er kun til eget bruk.");
      invalidateReviewProgress(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeGap = useMutation({
    mutationFn: (id: string) => deleteTimelineContext(userId, id),
    onSuccess: () => invalidateReviewProgress(qc, userId),
    onError: (e: Error) => toast.error(e.message),
  });

  const advance = useMutation({
    mutationFn: () =>
      advanceReviewProgress(importId, signature, 2, { step1_completed_at: new Date().toISOString() }),
    onSuccess: () => {
      invalidateReviewProgress(qc, userId);
      onContinue();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = confirm.isPending || reject.isPending || addRole.isPending || advance.isPending;
  // Roller uten stillingstittel bekreftes aldri i bulk — tittelen må komme fra brukeren.
  const datedPending = pendingRoles.filter((r) => !r.missingDates && !r.titleMissing && r.candidate);
  const missingTitles = timeline.filter((r) => r.titleMissing).length;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trinn 1 av 4 · Karrieretidslinjen</CardTitle>
          <CardDescription>
            Vi starter med rollene dine. Alt annet — resultater, kompetanse og kvalifikasjoner —
            henger på disse, så tidslinjen må stemme før vi går videre.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{timeline.length} roller</Badge>
          <Badge variant="secondary">{pendingRoles.length} til gjennomgang</Badge>
          {gaps.length > 0 && <Badge variant="outline">{gaps.length} tidsrom å avklare</Badge>}
          {missingTitles > 0 && (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              {missingTitles} mangler stillingstittel
            </Badge>
          )}
          <div className="ml-auto flex gap-2">
            {datedPending.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => confirm.mutate(datedPending.map((r) => r.candidate!))}
              >
                Bekreft alle med datoer ({datedPending.length})
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowAdd((v) => !v)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Legg til rolle
            </Button>
          </div>
        </CardContent>
      </Card>

      {showAdd && <ManualRoleForm busy={addRole.isPending} onSubmit={(v) => addRole.mutate(v)} />}

      <div className="space-y-3">
        {timeline.map((r) => (
          <RoleRow
            key={`${r.kind}-${r.id}`}
            role={r}
            busy={busy || saveTitle.isPending}
            onSaveTitle={(title) => saveTitle.mutate({ role: r, title })}
            onConfirm={() => r.candidate && confirm.mutate([r.candidate])}
            onReject={() => r.candidate && reject.mutate(r.candidate)}
          />
        ))}
        {timeline.length === 0 && (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Ingen roller funnet ennå. Legg inn den første rollen din for å komme i gang.
          </p>
        )}
      </div>

      {gaps.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> Mulig tidsrom å avklare
            </CardTitle>
            <CardDescription>
              Et tidsrom uten registrert rolle er ikke et problem. Du kan forklare det for deg
              selv her, eller la det stå. Forklaringen er privat og brukes aldri i CV eller søknad.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {gaps.map((g) => {
              const saved = (contexts.data ?? []).find(
                (c) => c.gap_start === g.startIso && c.gap_end === g.endIso,
              );
              return (
                <GapRow
                  key={g.key}
                  gap={g}
                  savedId={saved?.id ?? null}
                  savedLabel={
                    saved
                      ? `${GAP_CATEGORIES.find((c) => c.value === saved.category)?.label ?? saved.category}${saved.note ? ` · ${saved.note}` : ""}`
                      : null
                  }
                  busy={saveGap.isPending || removeGap.isPending}
                  onSave={(category, note) => saveGap.mutate({ gap: g, category, note })}
                  onRemove={(id) => removeGap.mutate(id)}
                />
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button disabled={busy} onClick={() => advance.mutate()}>
          {advance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Fortsett til resultater
        </Button>
      </div>
    </div>
  );
}

function GapRow({
  gap,
  savedId,
  savedLabel,
  busy,
  onSave,
  onRemove,
}: {
  gap: TimelineGap;
  savedId: string | null;
  savedLabel: string | null;
  busy: boolean;
  onSave: (category: string, note: string) => void;
  onRemove: (id: string) => void;
}) {
  const [category, setCategory] = useState("annet");
  const [note, setNote] = useState("");

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm">
        <strong>
          {gap.startIso.slice(0, 7)} – {gap.endIso.slice(0, 7)}
        </strong>{" "}
        <span className="text-muted-foreground">
          ({gap.months} måneder mellom «{gap.afterTitle}» og «{gap.beforeTitle}»)
        </span>
      </p>
      {savedId ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{savedLabel}</p>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRemove(savedId)}>
            Fjern
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48 space-y-1">
            <Label className="text-xs">Hva skjedde?</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GAP_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-56 flex-1 space-y-1">
            <Label className="text-xs">Notat (valgfritt, privat)</Label>
            <Textarea
              rows={1}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Kun for deg selv"
            />
          </div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onSave(category, note)}>
            Lagre
          </Button>
        </div>
      )}
    </div>
  );
}

function ManualRoleForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (v: {
    title: string;
    employer: string | null;
    startIso: string | null;
    endIso: string | null;
    isCurrent: boolean;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [employer, setEmployer] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [current, setCurrent] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Legg til en rolle</CardTitle>
        <CardDescription>
          Rollen merkes som lagt inn av deg. Den teller som ditt eget grunnlag.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Tittel</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Arbeidsgiver</Label>
          <Input value={employer} onChange={(e) => setEmployer(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Fra</Label>
          <Input type="month" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Til</Label>
          <Input
            type="month"
            value={end}
            disabled={current}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="current-role"
            checked={current}
            onCheckedChange={(v) => setCurrent(v === true)}
          />
          <Label htmlFor="current-role" className="text-sm font-normal">
            Jeg er i denne rollen nå
          </Label>
        </div>
        <div className="flex items-end justify-end">
          <Button
            disabled={busy || !title.trim()}
            onClick={() =>
              onSubmit({
                title,
                employer: employer.trim() || null,
                startIso: start ? `${start}-01` : null,
                endIso: end ? `${end}-01` : null,
                isCurrent: current,
              })
            }
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Lagre rollen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Én rad på tidslinjen. Stillingstittelen er overskriften; rollebeskrivelsen
 * er sekundær og brukes aldri som tittel. Fant ikke importen en tittel, spør
 * vi brukeren her — vi gjetter aldri.
 */
function RoleRow({
  role,
  busy,
  onSaveTitle,
  onConfirm,
  onReject,
}: {
  role: TimelineRole;
  busy: boolean;
  onSaveTitle: (title: string) => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const [editing, setEditing] = useState(role.titleMissing);
  const [value, setValue] = useState(role.title);

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {role.titleMissing ? (
              <span className="text-amber-700">Stillingstittel mangler</span>
            ) : (
              role.title
            )}
            {role.employer ? <span className="text-muted-foreground"> · {role.employer}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {periodLabel(role)}
            {role.kind === "lagret" ? " · lagret" : " · fra importen"}
          </p>
          {role.summary && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{role.summary}</p>
          )}
          {role.missingDates && (
            <p className="mt-1 text-xs text-amber-600">
              Datoene mangler i kilden. Legg dem inn manuelt hvis du vil ha rollen på tidslinjen.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Endre
            </Button>
          )}
          {role.candidate && (
            <>
              <Button
                size="sm"
                disabled={busy || role.titleMissing}
                title={role.titleMissing ? "Oppgi stillingstittelen først." : undefined}
                onClick={onConfirm}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Bekreft
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
                <XCircle className="mr-1 h-3.5 w-3.5" /> Ikke min
              </Button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-3">
          <Label htmlFor={`title-${role.kind}-${role.id}`} className="text-xs">
            Hva var stillingstittelen din
            {role.employer ? ` hos ${role.employer}` : ""}?
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`title-${role.kind}-${role.id}`}
              value={value}
              placeholder="F.eks. Kommersiell direktør (CCO)"
              className="max-w-xs"
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || !value.trim()}
              onClick={() => {
                onSaveTitle(value);
                setEditing(false);
              }}
            >
              Lagre tittel
            </Button>
            {!role.titleMissing && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setValue(role.title);
                  setEditing(false);
                }}
              >
                Avbryt
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Vi bruker tittelen slik du skriver den. Beskrivelsen av rollen beholdes uendret.
          </p>
        </div>
      )}
    </div>
  );
}
