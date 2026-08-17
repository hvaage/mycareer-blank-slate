/**
 * CV-gjennomgang, trinn 1: karrieretidslinjen.
 *
 * Brukeren ser rollene kronologisk som én liste — periode, stillingstittel og
 * arbeidsgiver — med hull vist på riktig plass i rekkefølgen. Han kan endre
 * tittel, arbeidsgiver og ansettelsesperiode, slette roller, legge til roller
 * maskinen ikke fant, og forklare hull. Forklaringen er privat: den brukes
 * aldri i CV, eksport eller modellgrunnlag.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, Plus, Trash2 } from "lucide-react";
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
  findDuplicateRoles,
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
  setRoleEmployer,
  setRolePeriod,
  setRoleTitle,
  timelineContextQuery,
} from "@/lib/queries/cv-review-progress";
import { deleteCareerAtom } from "@/lib/queries/career-atom-actions";
import { STANDARD_ROLES, findExistingStandardRole } from "@/lib/standard-roles";

const GAP_CATEGORIES: { value: string; label: string }[] = [
  { value: "studier", label: "Studier" },
  { value: "permisjon", label: "Permisjon" },
  { value: "sabbatsar", label: "Sabbatsår" },
  { value: "selvstendig", label: "Selvstendig arbeid" },
  { value: "annet", label: "Annet" },
];

function yearOf(iso: string | null): string {
  return iso ? iso.slice(0, 4) : "?";
}

function periodLabel(r: TimelineRole): string {
  if (!r.startIso) return "Uten dato";
  if (r.isCurrent) return `${yearOf(r.startIso)} – nå`;
  return r.endIso ? `${yearOf(r.startIso)} – ${yearOf(r.endIso)}` : `${yearOf(r.startIso)} – ?`;
}

function gapLength(months: number): string {
  if (months >= 12) {
    const years = Math.round(months / 12);
    return years === 1 ? "Ett år" : `${years} år`;
  }
  return `${months} måneder`;
}

function monthValue(iso: string | null): string {
  return iso ? iso.slice(0, 7) : "";
}

type Entry =
  | { type: "role"; sort: string; role: TimelineRole }
  | { type: "gap"; sort: string; gap: TimelineGap };

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
  const [openGap, setOpenGap] = useState<string | null>(null);
  const [fixMode, setFixMode] = useState(false);

  const pendingRoles = useMemo(
    () => sortRoles(roleCandidates.filter((c) => c.status === "ubehandlet").map(roleFromCandidate)),
    [roleCandidates],
  );
  const timeline = useMemo(
    () => sortRoles([...savedRoles, ...pendingRoles]),
    [savedRoles, pendingRoles],
  );
  const gaps = useMemo(() => detectGaps(timeline), [timeline]);
  const duplicates = useMemo(() => findDuplicateRoles(timeline), [timeline]);

  /** Roller og hull i én kronologisk liste, nyeste først. */
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      ...timeline.map((r) => ({
        type: "role" as const,
        sort: r.startIso ?? "0000-00-00",
        role: r,
      })),
      ...gaps.map((g) => ({ type: "gap" as const, sort: g.startIso, gap: g })),
    ];
    return list.sort((a, b) => b.sort.localeCompare(a.sort));
  }, [timeline, gaps]);

  const confirm = useMutation({
    mutationFn: async (rows: CvParseCandidateRow[]) => {
      for (const c of rows) {
        await promoteCandidate({ userId, candidate: c, resolvedType: "role", verified: true });
      }
      return rows.length;
    },
    onSuccess: (n) => {
      if (n > 0) toast.success(n === 1 ? "Rollen er bekreftet." : `${n} roller er bekreftet.`);
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRole = useMutation({
    mutationFn: async (role: TimelineRole) => {
      if (role.candidate) {
        await rejectCandidate(userId, role.candidate, "slettet av bruker i tidslinjen");
        return;
      }
      await deleteCareerAtom(role.id);
    },
    onSuccess: () => {
      toast.success("Rollen er fjernet fra tidslinjen.");
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

  const saveRole = useMutation({
    mutationFn: async (v: {
      role: TimelineRole;
      title: string;
      employer: string | null;
      startIso: string | null;
      endIso: string | null;
      isCurrent: boolean;
    }) => {
      const target = { userId, kind: v.role.kind, id: v.role.id };
      if (v.title.trim() && v.title.trim() !== v.role.title) {
        await setRoleTitle({ ...target, title: v.title });
      }
      if ((v.employer ?? null) !== (v.role.employer ?? null)) {
        await setRoleEmployer({ ...target, employer: v.employer });
      }
      await setRolePeriod({
        ...target,
        startIso: v.startIso,
        endIso: v.endIso,
        isCurrent: v.isCurrent,
      });
    },
    onSuccess: () => {
      toast.success("Rollen er oppdatert.");
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
      setOpenGap(null);
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
      advanceReviewProgress(importId, signature, 2, {
        step1_completed_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      invalidateReviewProgress(qc, userId);
      onContinue();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy =
    confirm.isPending ||
    removeRole.isPending ||
    addRole.isPending ||
    saveRole.isPending ||
    advance.isPending;
  // Roller uten stillingstittel bekreftes aldri i bulk — tittelen må komme fra brukeren.
  const datedPending = pendingRoles.filter((r) => !r.missingDates && !r.titleMissing && r.candidate);
  const missingTitles = timeline.filter((r) => r.titleMissing).length;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trinn 1 av 4 · Karrieretidslinjen</CardTitle>
          <CardDescription>
            Karrieren din slik CV-en beskriver den. Alt annet — resultater, kompetanse og
            kvalifikasjoner — henger på rollene, så tidslinjen må stemme før vi går videre.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{timeline.length} roller</Badge>
          {gaps.length > 0 && <Badge variant="outline">{gaps.length} tidsrom å avklare</Badge>}
          {missingTitles > 0 && (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              {missingTitles} mangler stillingstittel
            </Badge>
          )}
          {duplicates.length > 0 && (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              {duplicates.length} mulige dubletter
            </Badge>
          )}
        </CardContent>
      </Card>

      {duplicates.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Copy className="h-4 w-4" /> Roller som kan være samme ansettelse
            </CardTitle>
            <CardDescription>
              Flere importer av samme CV gir gjerne samme rolle to ganger. Vi slår aldri sammen
              automatisk — behold den som stemmer, og slett resten.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {duplicates.map((d) => (
              <div key={d.key} className="rounded-md border p-3 text-sm">
                <p className="text-muted-foreground">{d.reason}</p>
                <ul className="mt-1 space-y-1">
                  {d.roles.map((r) => (
                    <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-2">
                      <span>
                        {periodLabel(r)} · {r.title || "Uten stillingstittel"}
                        <span className="text-muted-foreground">
                          {r.kind === "lagret" ? " · lagret" : " · fra importen"}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => removeRole.mutate(r)}
                      >
                        Slett
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {entries.map((e) =>
              e.type === "role" ? (
                <RoleRow
                  key={`${e.role.kind}-${e.role.id}`}
                  role={e.role}
                  busy={busy}
                  forceEdit={fixMode && (e.role.titleMissing || e.role.missingDates)}
                  onSave={(v) => saveRole.mutate({ role: e.role, ...v })}
                  onDelete={() => removeRole.mutate(e.role)}
                />
              ) : (
                <GapRow
                  key={e.gap.key}
                  gap={e.gap}
                  open={openGap === e.gap.key}
                  saved={
                    (contexts.data ?? []).find(
                      (c) => c.gap_start === e.gap.startIso && c.gap_end === e.gap.endIso,
                    ) ?? null
                  }
                  busy={saveGap.isPending || removeGap.isPending}
                  onToggle={() => setOpenGap((v) => (v === e.gap.key ? null : e.gap.key))}
                  onAddRole={() => setShowAdd(true)}
                  onSave={(category, note) => saveGap.mutate({ gap: e.gap, category, note })}
                  onRemove={(id) => removeGap.mutate(id)}
                />
              ),
            )}
            {entries.length === 0 && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                Ingen roller funnet ennå. Legg inn den første rollen din for å komme i gang.
              </li>
            )}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t p-3">
            <Button variant="outline" size="sm" onClick={() => setShowAdd((v) => !v)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Legg til rolle
            </Button>
            {STANDARD_ROLES.map((sr) => {
              const exists = Boolean(findExistingStandardRole(timeline, sr));
              return (
                <Button
                  key={sr.key}
                  variant="ghost"
                  size="sm"
                  disabled={exists || addRole.isPending}
                  title={exists ? "Rollen finnes allerede i tidslinjen." : sr.description}
                  onClick={() =>
                    addRole.mutate({
                      title: sr.title,
                      employer: null,
                      startIso: null,
                      endIso: null,
                      isCurrent: false,
                    })
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> {sr.title}
                </Button>
              );
            })}
          </div>

        </CardContent>
      </Card>

      {showAdd && <ManualRoleForm busy={addRole.isPending} onSubmit={(v) => addRole.mutate(v)} />}

      {fixMode && (
        <p className="text-sm text-muted-foreground">
          Rett det som ikke stemmer i listen over. Når du er ferdig, velg «Alt stemmer, gå videre».
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setFixMode(true)}>
          Jeg må rette noe først
        </Button>
        <Button
          disabled={busy || missingTitles > 0}
          title={missingTitles > 0 ? "Oppgi stillingstittelen på alle roller først." : undefined}
          onClick={() => {
            const rows = datedPending.map((r) => r.candidate!);
            if (rows.length > 0) confirm.mutate(rows);
            advance.mutate();
          }}
        >
          {advance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Alt stemmer, gå videre
        </Button>
      </div>
    </div>
  );
}

function GapRow({
  gap,
  open,
  saved,
  busy,
  onToggle,
  onAddRole,
  onSave,
  onRemove,
}: {
  gap: TimelineGap;
  open: boolean;
  saved: { id: string; category: string; note: string | null } | null;
  busy: boolean;
  onToggle: () => void;
  onAddRole: () => void;
  onSave: (category: string, note: string) => void;
  onRemove: (id: string) => void;
}) {
  const [category, setCategory] = useState("annet");
  const [note, setNote] = useState("");

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
          {yearOf(gap.startIso)} – {yearOf(gap.endIso)}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {gapLength(gap.months)} uten registrert rolle
        </span>
        <div className="flex gap-1">
          {saved ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRemove(saved.id)}>
              Fjern forklaring
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onToggle}>
              Forklar
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onAddRole}>
            Legg til
          </Button>
        </div>
      </div>

      {saved && (
        <p className="mt-1 pl-28 text-xs text-muted-foreground">
          {GAP_CATEGORIES.find((c) => c.value === saved.category)?.label ?? saved.category}
          {saved.note ? ` · ${saved.note}` : ""} · privat
        </p>
      )}

      {open && !saved && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-3">
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
          <p className="w-full text-xs text-muted-foreground">
            Et tidsrom uten registrert rolle er ikke et problem. Forklaringen er privat og brukes
            aldri i CV eller søknad.
          </p>
        </div>
      )}
    </li>
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
          <Label>Stillingstittel</Label>
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
 * Én rad på tidslinjen: periode, stillingstittel og arbeidsgiver. Tittelen er
 * overskriften; rollebeskrivelsen er sekundær og brukes aldri som tittel.
 * Fant ikke importen en tittel, spør vi brukeren her — vi gjetter aldri.
 */
function RoleRow({
  role,
  busy,
  forceEdit,
  onSave,
  onDelete,
}: {
  role: TimelineRole;
  busy: boolean;
  forceEdit: boolean;
  onSave: (v: {
    title: string;
    employer: string | null;
    startIso: string | null;
    endIso: string | null;
    isCurrent: boolean;
  }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(role.titleMissing || forceEdit);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(role.title);
  const [employer, setEmployer] = useState(role.employer ?? "");
  const [start, setStart] = useState(monthValue(role.startIso));
  const [end, setEnd] = useState(monthValue(role.endIso));
  const [current, setCurrent] = useState(role.isCurrent);

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-28 shrink-0 pt-0.5 text-sm tabular-nums text-muted-foreground">
          {periodLabel(role)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {role.titleMissing ? (
              <span className="text-amber-700">Stillingstittel mangler</span>
            ) : (
              role.title
            )}
            {role.employer ? (
              <span className="font-normal text-muted-foreground"> · {role.employer}</span>
            ) : null}
          </p>
          {role.summary && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{role.summary}</p>
          )}
          {role.missingDates && (
            <p className="mt-0.5 text-xs text-amber-600">
              Datoene mangler i kilden. Legg dem inn for å få rollen riktig plassert.
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            Endre
          </Button>
          {confirmDelete ? (
            <>
              <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
                Bekreft sletting
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Avbryt
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label="Slett rollen"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid gap-3 rounded-md bg-muted/40 p-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Stillingstittel</Label>
            <Input
              value={title}
              placeholder="F.eks. Kommersiell direktør (CCO)"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Arbeidsgiver</Label>
            <Input value={employer} onChange={(e) => setEmployer(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fra</Label>
            <Input type="month" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Til</Label>
            <Input
              type="month"
              value={end}
              disabled={current}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`current-${role.kind}-${role.id}`}
              checked={current}
              onCheckedChange={(v) => setCurrent(v === true)}
            />
            <Label htmlFor={`current-${role.kind}-${role.id}`} className="text-sm font-normal">
              Jeg er i denne rollen nå
            </Label>
          </div>
          <div className="flex items-end justify-end gap-2">
            {!role.titleMissing && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Avbryt
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy || !title.trim()}
              onClick={() => {
                onSave({
                  title,
                  employer: employer.trim() || null,
                  startIso: start ? `${start}-01` : null,
                  endIso: end ? `${end}-01` : null,
                  isCurrent: current,
                });
                setEditing(false);
              }}
            >
              Lagre
            </Button>
          </div>
          <p className="text-xs text-muted-foreground md:col-span-2">
            Vi bruker det du skriver. Rollebeskrivelsen fra CV-en beholdes uendret.
          </p>
        </div>
      )}
    </li>
  );
}
