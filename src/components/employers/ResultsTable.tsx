import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { EmployerSearchRow } from "@/lib/queries/employer-insight";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { RiskBadges, DataQualityBadges, TypeBadge } from "./Badges";
import { fmtNok, fmtPercent } from "./MetricTile";
import { fylkesnavn } from "@/lib/employers/no-regions";
import { formatAnsatte, ansatteErUkjent, ANSATTE_KILDEFORKLARING } from "@/lib/employers/ansatte";

function stedFra(r: EmployerSearchRow): string {
  return [
    r.forretningsadresse_kommune,
    r.forretningsadresse_fylke ?? fylkesnavn(r.forretningsadresse_fylkesnummer),
  ]
    .filter(Boolean)
    .join(", ");
}

function bransjeFra(r: EmployerSearchRow): string {
  return r.naeringskode1_beskrivelse ?? r.naeringskode1_kode ?? "";
}


export function ResultsTable({
  rows,
  loading,
  available,
  errorMessage,
}: {
  rows: EmployerSearchRow[];
  loading: boolean;
  available: boolean;
  errorMessage: string | null;
}) {
  if (!available) {
    return (
      <EmptyState
        title="Søket er ikke konfigurert ennå"
        description="search_employers RPC er ikke tilgjengelig. Backend-kontrakten må på plass før resultater kan vises."
      />
    );
  }
  if (errorMessage) {
    return <EmptyState title="Søket feilet" description={errorMessage} />;
  }
  if (loading && rows.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Ingen arbeidsgivere matcher"
        description="Juster filtre eller søkeord og prøv igjen."
      />
    );
  }

  const navigate = useNavigate();
  const goTo = (orgnr: string) => {
    navigate({ to: "/arbeidsgivere/$orgnr", params: { orgnr } });
  };

  return (
    <>
      {/* Desktop-tabell */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Navn</th>
              <th className="px-3 py-2 text-left font-medium">Orgnr</th>
              <th className="px-3 py-2 text-left font-medium">Sted</th>
              <th className="px-3 py-2 text-left font-medium">Bransje</th>
              <th className="px-3 py-2 text-right font-medium min-w-[7ch]">Ansatte</th>
              <th className="px-3 py-2 text-right font-medium min-w-[10ch]">Omsetning</th>
              <th className="px-3 py-2 text-right font-medium min-w-[6ch]">Margin</th>
              <th className="px-3 py-2 text-right font-medium min-w-[6ch]">EK-andel</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Flagg</th>
              <th className="px-3 py-2 text-right font-medium sr-only">Detaljer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sted = stedFra(r);
              const bransje = bransjeFra(r);
              return (
                <tr
                  key={r.organisasjonsnummer}
                  role="link"
                  tabIndex={0}
                  onClick={() => goTo(r.organisasjonsnummer)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      goTo(r.organisasjonsnummer);
                    }
                  }}
                  className="border-t border-border cursor-pointer hover:bg-muted/30 focus:outline-none focus:bg-muted/40"
                >
                  <td className="px-3 py-2">
                    <Link
                      to="/arbeidsgivere/$orgnr"
                      params={{ orgnr: r.organisasjonsnummer }}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-foreground hover:text-[var(--km-blue)] hover:underline"
                    >
                      {r.navn}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {r.organisasjonsnummer}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{sted || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{bransje || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span
                      className={ansatteErUkjent(r) ? "text-muted-foreground italic" : undefined}
                      title={ansatteErUkjent(r) ? ANSATTE_KILDEFORKLARING : undefined}
                    >
                      {formatAnsatte(r)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtNok(r.driftsinntekter) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtPercent(r.driftsmargin_prosent) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtPercent(r.egenkapitalandel_prosent) ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <TypeBadge value={r.arbeidsgiver_type} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <RiskBadges flags={r.risiko_flags} />
                      <DataQualityBadges flags={r.datakvalitet_flags} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to="/arbeidsgivere/$orgnr"
                      params={{ orgnr: r.organisasjonsnummer }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Se detaljer for ${r.navn}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--km-blue)] hover:underline whitespace-nowrap"
                    >
                      Se detaljer <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobil-kort */}
      <ul className="md:hidden space-y-2">
        {rows.map((r) => {
          const sted = stedFra(r);
          const bransje = bransjeFra(r);
          return (
            <li key={r.organisasjonsnummer}>
              <Link
                to="/arbeidsgivere/$orgnr"
                params={{ orgnr: r.organisasjonsnummer }}
                className="block rounded-lg border border-border bg-card p-3 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground">{r.navn}</div>
                  <TypeBadge value={r.arbeidsgiver_type} />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {r.organisasjonsnummer}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {sted || "—"} · {bransje || "—"}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Ansatte: </span>
                    <span className={ansatteErUkjent(r) ? "italic text-muted-foreground" : "tabular-nums"}>{formatAnsatte(r)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Omsetning: </span>
                    <span className="tabular-nums">{fmtNok(r.driftsinntekter) ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Margin: </span>
                    <span className="tabular-nums">{fmtPercent(r.driftsmargin_prosent) ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">EK: </span>
                    <span className="tabular-nums">{fmtPercent(r.egenkapitalandel_prosent) ?? "—"}</span>
                  </div>
                </div>
                {(r.risiko_flags?.length || r.datakvalitet_flags?.length) ? (
                  <div className="mt-2 flex flex-col gap-1">
                    <RiskBadges flags={r.risiko_flags} />
                    <DataQualityBadges flags={r.datakvalitet_flags} />
                  </div>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
