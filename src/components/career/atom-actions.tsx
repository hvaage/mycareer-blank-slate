/**
 * 5b — handlinger på ett element i grunnlaget: bekreft, rediger, slett.
 * Sletting viser først konsekvensoppslaget fra basen, og krever et eget ja
 * når andre ledd i kjeden blir berørt.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  confirmCareerAtom,
  deleteCareerAtom,
  deleteImpactQuery,
  invalidateAfterAtomChange,
  updateCareerAtom,
  type CareerAtomRow,
  type ImpactAtom,
} from "@/lib/queries/career-atom-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

function sd(row: CareerAtomRow): Record<string, any> {
  const v = row.structured_data;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function atomWord(row: { atom_class?: string | null; atom_type?: string | null }): string {
  if (row.atom_type === "role") return "rollen";
  switch (row.atom_class) {
    case "resultat":
      return "resultatet";
    case "kompetanse":
      return "kompetansen";
    case "kvalifikasjon":
      return "kvalifikasjonen";
    case "eksponering":
      return "eksponeringen";
    case "instrument":
      return "verktøyet";
    default:
      return "elementet";
  }
}

function ImpactList({ title, note, rows }: { title: string; note: string; rows: ImpactAtom[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {title} ({rows.length})
      </p>
      <p className="text-xs text-muted-foreground">{note}</p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border bg-muted/40 p-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="truncate">
            {r.content_no ?? "(uten tekst)"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditDialog({
  row,
  open,
  onOpenChange,
}: {
  row: CareerAtomRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const d = sd(row);
  const isRole = row.atom_type === "role";
  const [text, setText] = useState(row.content_no ?? "");
  const [desc, setDesc] = useState<string>(d.beskrivelse ?? row.source_quote ?? "");
  const [employer, setEmployer] = useState<string>(d.employer ?? d.organization ?? d.company ?? "");
  const [from, setFrom] = useState<string>(d.start_date ?? d.from ?? "");
  const [to, setTo] = useState<string>(d.end_date ?? d.to ?? "");

  const save = useMutation({
    mutationFn: async () =>
      updateCareerAtom(user!.id, row, {
        content_no: text,
        beskrivelse: desc,
        employer,
        start_date: from,
        end_date: to,
      }),
    onSuccess: () => {
      invalidateAfterAtomChange(queryClient, user!.id);
      toast.success("Lagret. Elementet står nå som bekreftet av deg.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke lagre"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Endre {atomWord(row)}</DialogTitle>
          <DialogDescription>
            Skriv det slik du selv ville sagt det i et intervju. Når du lagrer, regnes påstanden som
            bekreftet av deg.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="atom-text">{isRole ? "Stillingstittel" : "Tekst"}</Label>
            <Input id="atom-text" value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          {isRole ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="atom-employer">Arbeidsgiver</Label>
                <Input
                  id="atom-employer"
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="atom-from">Fra (år)</Label>
                <Input
                  id="atom-from"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="2021"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="atom-to">Til (år)</Label>
                <Input
                  id="atom-to"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="tom hvis du er der nå"
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="atom-desc">Utdypning</Label>
            <Textarea
              id="atom-desc"
              rows={3}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Hva skjedde konkret? Tall og omfang hjelper søknadsbrevet."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !text.trim()}>
            {save.isPending ? "Lagrer…" : "Lagre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  row,
  open,
  onOpenChange,
}: {
  row: CareerAtomRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);
  const impact = useQuery({ ...deleteImpactQuery(row.id), enabled: open });

  const data = impact.data;
  const alsoRemoved = data?.descendants.length ?? 0;
  const unbacked = data?.orphaned.length ?? 0;
  const needsAccept = alsoRemoved > 0;

  const del = useMutation({
    mutationFn: async () => deleteCareerAtom(row.id),
    onSuccess: (res) => {
      invalidateAfterAtomChange(queryClient, user!.id);
      toast.success(
        res.deleted > 1 ? `Slettet ${res.deleted} elementer.` : "Slettet.",
        res.unbacked > 0
          ? {
              description: `${res.unbacked} kompetanse(r) står nå uten belegg. De er merket, ikke slettet.`,
            }
          : undefined,
      );
      onOpenChange(false);
      setAccepted(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke slette"),
  });


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Slette {atomWord(row)}?</DialogTitle>
          <DialogDescription className="line-clamp-2">
            «{row.content_no ?? "(uten tekst)"}»
          </DialogDescription>
        </DialogHeader>

        {impact.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : impact.isError ? (
          <p className="text-sm text-destructive">
            Kunne ikke hente konsekvensene. Prøv igjen før du sletter.
          </p>
        ) : !data?.found ? (
          <p className="text-sm text-muted-foreground">
            Elementet finnes ikke lenger. Ingenting å slette.
          </p>
        ) : (
          <div className="space-y-3">
            {alsoRemoved === 0 && (data.weakened.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ingenting annet hviler på dette. Bare denne linjen forsvinner.
              </p>
            ) : null}

            <ImpactList
              title="Forsvinner sammen med den"
              note="Disse hviler direkte på elementet og kan ikke stå alene."
              rows={data.descendants}
            />
            <ImpactList
              title="Mister hele belegget sitt"
              note="Uten dette har de ingenting å hvile på, og fjernes også."
              rows={data.orphaned}
            />
            <ImpactList
              title="Blir stående, men svakere belagt"
              note="De har annet belegg i tillegg, og beholdes."
              rows={data.weakened}
            />

            {data.parse_candidates > 0 ? (
              <p className="text-xs text-muted-foreground">
                {data.parse_candidates} linje(r) fra CV-importen mister koblingen sin, men blir
                liggende til gjennomgang.
              </p>
            ) : null}

            {needsAccept ? (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <Checkbox
                  checked={accepted}
                  onCheckedChange={(v) => setAccepted(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Jeg forstår at {alsoRemoved} element(er) til fjernes sammen med denne. Dette kan
                  ikke angres.
                </span>
              </label>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            variant="destructive"
            onClick={() => del.mutate()}
            disabled={
              del.isPending || impact.isLoading || !data?.found || (needsAccept && !accepted)
            }
          >
            {del.isPending ? "Sletter…" : "Slett"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AtomActions({ row }: { row: CareerAtomRow }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const confirm = useMutation({
    mutationFn: async () => confirmCareerAtom(user!.id, row.id),
    onSuccess: () => {
      invalidateAfterAtomChange(queryClient, user!.id);
      toast.success("Bekreftet.");
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke bekrefte"),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground"
            aria-label={`Handlinger for ${row.content_no ?? "elementet"}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!row.user_confirmed ? (
            <DropdownMenuItem onSelect={() => confirm.mutate()}>
              <Check className="mr-2 h-4 w-4" /> Dette stemmer
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Endre
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setDeleting(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Slett
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing ? <EditDialog row={row} open={editing} onOpenChange={setEditing} /> : null}
      {deleting ? <DeleteDialog row={row} open={deleting} onOpenChange={setDeleting} /> : null}
    </>
  );
}
