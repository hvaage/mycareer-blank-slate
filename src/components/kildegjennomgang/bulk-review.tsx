// ============================================================
// Massegjennomgang av nye kvalifikasjoner og kompetanser.
//
// Dette er en arbeidsliste, ikke en kortvegg: tette avhukingsrader med navn,
// tre kolonner på vanlig desktop og fire på bred desktop, én på mobil.
// Detaljer åpnes først ved klikk.
//
// Regler:
//  * Alle handlingsbare NYE forslag er avhuket ved start.
//  * Allerede registrerte, konflikter, avviste og feilede vises i egne
//    seksjoner og er aldri forhåndsvalgt.
//  * Søk og filtrering endrer aldri brukerens avhukinger.
//  * Feil i ett forslag påvirker aldri de andre valgene.
//  * Ingenting overføres uten eksplisitt bekreftelse med antall per type.
// ============================================================
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, ChevronDown, Loader2 } from "lucide-react";

export type BulkItem = {
  id: string;
  label: string;
  atomType: string | null;
  status: string;
  proposalKind: string;
  details: Record<string, unknown> | null;
};

export type BulkOutcome = {
  promoted: number;
  alreadyRegistered: number;
  dismissed: number;
  deferred: number;
  failed: number;
};

const TYPE_LABELS: Record<string, string> = {
  skill: "Kompetanse",
  language: "Språk",
  certification: "Sertifisering",
  education: "Utdanning",
  course: "Kurs",
  role: "Rolle",
  volunteer: "Frivillig arbeid",
};

export function typeLabel(type: string | null): string {
  if (!type) return "Annet";
  return TYPE_LABELS[type] ?? type;
}

export function BulkReviewList({
  actionable,
  alreadyRegistered,
  conflicts,
  dismissed,
  failed,
  busy,
  progress,
  outcome,
  onSubmit,
}: {
  actionable: BulkItem[];
  alreadyRegistered: BulkItem[];
  conflicts: BulkItem[];
  dismissed: BulkItem[];
  failed: BulkItem[];
  busy: boolean;
  progress: { done: number; total: number } | null;
  outcome: BulkOutcome | null;
  onSubmit: (ids: string[]) => void;
}) {
  // Avhukinger holdes utenfor filtreringen, slik at søk aldri mister valg.
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selectedIds = useMemo(
    () => actionable.filter((item) => !unchecked.has(item.id)).map((item) => item.id),
    [actionable, unchecked],
  );

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of actionable) {
      const key = item.atomType ?? "annet";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [actionable]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actionable.filter((item) => {
      if (typeFilter && (item.atomType ?? "annet") !== typeFilter) return false;
      if (q && !item.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [actionable, query, typeFilter]);

  const selectedByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of actionable) {
      if (unchecked.has(item.id)) continue;
      const key = item.atomType ?? "annet";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [actionable, unchecked]);

  function toggle(id: string, checked: boolean) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAllVisible(checked: boolean) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const item of visible) {
        if (checked) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  if (actionable.length === 0 && alreadyRegistered.length === 0 && conflicts.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base font-medium">Godkjenn og overfør</CardTitle>
        <CardDescription>
          {actionable.length} forslag kan overføres. Alle er valgt på forhånd — fjern avhukingen på
          det du ikke vil ha. Ingenting overføres før du bekrefter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 border-b pb-4">
          <Button disabled={busy || selectedIds.length === 0} onClick={() => setConfirmOpen(true)}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
            Godkjenn og overfør ({selectedIds.length})
          </Button>
          {progress && <span className="text-sm text-muted-foreground">Behandler {progress.done} av {progress.total} …</span>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Søk i navn"
            className="w-full sm:max-w-64"
            aria-label="Søk i forslag"
          />

          <div className="flex shrink-0 flex-wrap gap-1">
            <Button
              size="sm"
              variant={typeFilter === null ? "secondary" : "ghost"}
              onClick={() => setTypeFilter(null)}
            >
              Alle ({actionable.length})
            </Button>
            {types.map(([type, count]) => (
              <Button
                key={type}
                size="sm"
                variant={typeFilter === type ? "secondary" : "ghost"}
                onClick={() => setTypeFilter(type)}
              >
                {typeLabel(type === "annet" ? null : type)} ({count})
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Button size="sm" variant="outline" onClick={() => setAllVisible(true)} disabled={busy}>
            Velg alle i visningen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAllVisible(false)} disabled={busy}>
            Fjern alle i visningen
          </Button>
          <span>
            {selectedIds.length} valgt av {actionable.length}
          </span>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen forslag treffer søket.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((item) => (
              <BulkRow
                key={item.id}
                item={item}
                checked={!unchecked.has(item.id)}
                disabled={busy}
                onToggle={(checked) => toggle(item.id, checked)}
              />
            ))}
          </ul>
        )}

        {outcome && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="mb-1 font-medium">Resultat</p>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>Overført: {outcome.promoted}</li>
              <li>Allerede registrert: {outcome.alreadyRegistered}</li>
              <li>Avvist: {outcome.dismissed}</li>
              <li>Utsatt: {outcome.deferred}</li>
              <li>Feilet: {outcome.failed}</li>
            </ul>
          </div>
        )}

        <SecondarySection title="Allerede registrert" items={alreadyRegistered} />
        <SecondarySection title="Motstrid og mulige dubletter" items={conflicts} />
        <SecondarySection title="Avvist" items={dismissed} />
        <SecondarySection title="Feilet ved overføring" items={failed} />
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Overfør {selectedIds.length} forslag?</DialogTitle>
            <DialogDescription>
              Innholdet legges til med LinkedIn-eksport som kilde. Ingenting regnes som bekreftet, og
              det du allerede har, blir ikke overskrevet.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {selectedByType.map(([type, count]) => (
              <li key={type} className="flex justify-between">
                <span>{typeLabel(type === "annet" ? null : type)}</span>
                <span className="font-medium">{count}</span>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                onSubmit(selectedIds);
              }}
            >
              <Check className="mr-1 h-4 w-4" /> Bekreft og overfør
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>
              Avbryt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function BulkRow({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: BulkItem;
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(item.details ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );

  return (
    <li className="min-w-0 border-b border-border/50 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 py-1.5">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onToggle(value === true)}
          aria-label={`Velg ${item.label}`}
          className="shrink-0"
        />
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="truncate text-sm">{item.label}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {typeLabel(item.atomType)}
          </Badge>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open && (
        <dl className="mb-2 space-y-0.5 rounded-md bg-muted/40 p-2 text-xs">
          {entries.length === 0 ? (
            <p className="text-muted-foreground">Ingen flere detaljer i kilden.</p>
          ) : (
            entries.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="min-w-20 shrink-0 text-muted-foreground">{key}</dt>
                <dd className="min-w-0 break-words">{String(value)}</dd>
              </div>
            ))
          )}
        </dl>
      )}
    </li>
  );
}

function SecondarySection({ title, items }: { title: string; items: BulkItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between text-sm font-medium"
      >
        <span>
          {title} ({items.length})
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {items.map((item) => (
            <li key={item.id} className="min-w-0 truncate py-1 text-sm text-muted-foreground">
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
