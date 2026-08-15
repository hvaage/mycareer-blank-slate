import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RiskBadges, DataQualityBadges, TypeBadge } from "@/components/employers/Badges";
import {
  searchEmployersQuery,
  type EmployerSearchRow,
} from "@/lib/queries/employer-insight";

const ORGNR_RE = /^[0-9]{9}$/;

export type ExistingEmployerMatch = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingByOrgnr: Map<string, ExistingEmployerMatch>;
  isPending: boolean;
  onAnalyzeConfirmed: (row: EmployerSearchRow) => Promise<void>;
  onOpenExisting: (companyId: string) => void;
};

export function EmployerAnalysisSearchDialog({
  open,
  onOpenChange,
  existingByOrgnr,
  isPending,
  onAnalyzeConfirmed,
  onOpenExisting,
}: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [step, setStep] = useState<"search" | "confirm">("search");
  const [selected, setSelected] = useState<EmployerSearchRow | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Reset state when dialog closes/opens
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setStep("search");
      setSelected(null);
      setConfirmed(false);
    }
  }, [open]);

  // Debounce search query (350ms), only while dialog is open
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query, open]);

  const searchEnabled = open && debounced.length >= 3;

  const {
    data: result,
    isFetching,
    isError,
    error,
  } = useQuery({
    ...searchEmployersQuery({
      q: debounced,
      page: 1,
      pageSize: 15,
    }),
    enabled: searchEnabled,
  });

  const rows = result?.rows ?? [];
  const available = result?.available ?? true;
  const errorMessage = result?.errorMessage ?? null;

  const orgnrValid = !!selected && ORGNR_RE.test(selected.organisasjonsnummer ?? "");
  const existing = selected
    ? existingByOrgnr.get(selected.organisasjonsnummer ?? "") ?? null
    : null;

  const handleOpenChange = (next: boolean) => {
    if (isPending) return;
    onOpenChange(next);
  };

  const handleSelect = (row: EmployerSearchRow) => {
    setSelected(row);
    setConfirmed(false);
    setStep("confirm");
  };

  const handleBack = () => {
    setStep("search");
    setConfirmed(false);
  };

  const handleConfirm = async () => {
    if (!selected || !confirmed || !orgnrValid || isPending) return;
    try {
      await onAnalyzeConfirmed(selected);
    } catch {
      // Mutation onError shows toast; keep dialog open so user can retry/cancel.
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle>
            {step === "search" ? "Finn ny arbeidsgiver" : "Bekreft arbeidsgiver"}
          </DialogTitle>
          <DialogDescription>
            {step === "search"
              ? "Søk i arbeidsgiverregisteret på juridisk navn eller organisasjonsnummer."
              : "Kontroller at dette er riktig juridisk enhet før analysen starter."}
          </DialogDescription>
        </DialogHeader>

        {step === "search" ? (
          <SearchStep
            query={query}
            setQuery={setQuery}
            debounced={debounced}
            isFetching={isFetching}
            isError={isError}
            queryError={error}
            available={available}
            errorMessage={errorMessage}
            rows={rows}
            onSelect={handleSelect}
          />
        ) : (
          <ConfirmStep
            row={selected!}
            existing={existing}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            orgnrValid={orgnrValid}
            isPending={isPending}
            onBack={handleBack}
            onCancel={() => handleOpenChange(false)}
            onConfirm={handleConfirm}
            onOpenExisting={onOpenExisting}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SearchStep({
  query,
  setQuery,
  debounced,
  isFetching,
  isError,
  queryError,
  available,
  errorMessage,
  rows,
  onSelect,
}: {
  query: string;
  setQuery: (v: string) => void;
  debounced: string;
  isFetching: boolean;
  isError: boolean;
  queryError: unknown;
  available: boolean;
  errorMessage: string | null;
  rows: EmployerSearchRow[];
  onSelect: (row: EmployerSearchRow) => void;
}) {
  const tooShort = debounced.length < 2;
  const showEmpty = !tooShort && !isFetching && rows.length === 0 && available && !errorMessage && !isError;

  return (
    <>
      <div className="px-6 py-3 border-b">
        <form onSubmit={(e) => e.preventDefault()} className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søk navn eller organisasjonsnummer"
            className="pl-8"
          />
        </form>
        <p className="mt-1 text-xs text-muted-foreground">
          Minimum 2 tegn. Enter utfører bare søket.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-3">
        {tooShort ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Skriv minst 2 tegn for å søke.
          </p>
        ) : !available ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Registersøk er ikke tilgjengelig akkurat nå.
          </p>
        ) : isError ? (
          <p className="text-sm text-destructive py-6 text-center">
            Kunne ikke utføre søket: {queryError instanceof Error ? queryError.message : "Ukjent feil"}
          </p>
        ) : errorMessage ? (
          <p className="text-sm text-destructive py-6 text-center">{errorMessage}</p>
        ) : isFetching && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Søker…
          </div>
        ) : showEmpty ? (
          <div className="py-6 text-center space-y-1">
            <p className="text-sm font-medium text-foreground">Ingen treff</p>
            <p className="text-xs text-muted-foreground">
              Fant du ikke riktig juridisk enhet? Kontroller skrivemåten eller
              søk med organisasjonsnummer.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.organisasjonsnummer} className="py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">{row.navn}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {row.organisasjonsnummer}
                    </span>
                    <TypeBadge value={row.arbeidsgiver_type} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
                    {(row.forretningsadresse_kommune || row.forretningsadresse_fylke) && (
                      <span>
                        {[row.forretningsadresse_kommune, row.forretningsadresse_fylke]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    )}
                    {(row.naeringskode1_beskrivelse || row.naeringskode1_kode) && (
                      <span>· {row.naeringskode1_beskrivelse ?? row.naeringskode1_kode}</span>
                    )}
                    {typeof row.antall_ansatte === "number" && (
                      <span>· {row.antall_ansatte} ansatte</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <Button size="sm" variant="outline" onClick={() => onSelect(row)}>
                    Velg
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ConfirmStep({
  row,
  existing,
  confirmed,
  setConfirmed,
  orgnrValid,
  isPending,
  onBack,
  onCancel,
  onConfirm,
  onOpenExisting,
}: {
  row: EmployerSearchRow;
  existing: ExistingEmployerMatch | null;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  orgnrValid: boolean;
  isPending: boolean;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenExisting: (id: string) => void;
}) {
  const sted = [row.forretningsadresse_kommune, row.forretningsadresse_fylke]
    .filter(Boolean)
    .join(", ");
  const bransje = row.naeringskode1_beskrivelse ?? row.naeringskode1_kode ?? null;

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        <div className="rounded-md border bg-muted/20 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground">{row.navn}</h3>
              <p className="text-xs text-muted-foreground tabular-nums">
                Orgnr {row.organisasjonsnummer}
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {sted && (
              <div>
                <dt className="text-xs text-muted-foreground">Sted</dt>
                <dd>{sted}</dd>
              </div>
            )}
            {bransje && (
              <div>
                <dt className="text-xs text-muted-foreground">Bransje</dt>
                <dd>{bransje}</dd>
              </div>
            )}
            {row.arbeidsgiver_type && (
              <div>
                <dt className="text-xs text-muted-foreground">Type</dt>
                <dd><TypeBadge value={row.arbeidsgiver_type} /></dd>
              </div>
            )}
            {typeof row.antall_ansatte === "number" && (
              <div>
                <dt className="text-xs text-muted-foreground">Ansatte</dt>
                <dd>{row.antall_ansatte}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-col gap-1">
            <RiskBadges flags={row.risiko_flags} />
            <DataQualityBadges flags={row.datakvalitet_flags} />
          </div>
        </div>

        {existing ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-2">
            <Badge variant="secondary" className="font-normal">Allerede lagt til</Badge>
            <p className="text-sm">
              Du har allerede denne arbeidsgiveren i listen din. Åpne den for å
              se eksisterende analyse eller starte en oppdatering derfra.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Kontroller at dette er riktig juridisk enhet. En analyse knyttes til
              organisasjonsnummeret og kan ta flere minutter å gjennomføre.
            </p>
            <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
                disabled={isPending}
                className="mt-0.5"
              />
              <span>Jeg bekrefter at dette er riktig arbeidsgiver</span>
            </label>
            {!orgnrValid && (
              <p className="text-xs text-destructive">
                Organisasjonsnummeret ser ugyldig ut. Gå tilbake og velg en
                annen oppføring.
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t px-6 py-3 flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={isPending}
          className="inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Tilbake til søkeresultater
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
            Avbryt
          </Button>
          {existing ? (
            <Button size="sm" onClick={() => onOpenExisting(existing.id)}>
              Åpne arbeidsgiver
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={!confirmed || !orgnrValid || isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Starter…
                </>
              ) : (
                "Bekreft og start analyse"
              )}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
