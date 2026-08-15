import { AlertTriangle } from "lucide-react";
import type { AnsatteFordelingResult } from "@/lib/queries/employer-insight";
import {
  ANSATTE_KATEGORI_LABEL,
  ANSATTE_KATEGORI_REKKEFOELGE,
  ANSATTE_KILDEFORKLARING,
  fmtAntall,
} from "@/lib/employers/ansatte";

function Ramme({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Ansattetall i utvalget" className="rounded-lg border border-border bg-card p-4">
      {children}
    </section>
  );
}

/**
 * Ansattetall vises aldri som ett tall alene, og banneret skjuler seg aldri
 * ved feil: noe som feiler skal ikke se ut som noe som er tomt.
 */
export function AnsatteFordelingBanner({
  fordeling,
  laster,
  ansatteFilterAktivt,
}: {
  fordeling: AnsatteFordelingResult | undefined;
  laster?: boolean;
  ansatteFilterAktivt: boolean;
}) {
  if (!fordeling && laster) {
    return (
      <Ramme>
        <h2 className="text-sm font-semibold text-foreground">Ansattetall i utvalget</h2>
        <p className="mt-1 text-sm text-muted-foreground">Teller …</p>
      </Ramme>
    );
  }

  if (!fordeling) return null;

  if (fordeling.status === "utilgjengelig") {
    return (
      <Ramme>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Ansattetall i utvalget</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Fordelingen kunne ikke beregnes for dette søket
              {fordeling.reason === "timeout" ? " (tidsgrensen ble nådd)" : ""}. Trefflisten under er
              ikke påvirket. Snevre inn søket for å få tallene.
            </p>
          </div>
        </div>
      </Ramme>
    );
  }

  if (fordeling.total === 0) return null;

  const erUtvalg = fordeling.status === "utvalg";

  return (
    <Ramme>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Ansattetall i utvalget</h2>
        <p className="text-xs text-muted-foreground">
          {erUtvalg
            ? `Utvalg: talt over de første ${fmtAntall(fordeling.total)} treffene, ikke hele trefflisten.`
            : fordeling.capped
              ? `Talt over de første ${fmtAntall(fordeling.total)} treffene.`
              : `Alle ${fmtAntall(fordeling.total)} treff, uten ansattefilter.`}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {ANSATTE_KATEGORI_REKKEFOELGE.map((k) => {
          const n = fordeling[k];
          const pct = fordeling.total > 0 ? Math.round((n / fordeling.total) * 100) : 0;
          return (
            <div key={k} className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted-foreground">{ANSATTE_KATEGORI_LABEL[k]}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {fmtAntall(n)}{" "}
                <span className="text-xs font-normal text-muted-foreground">({pct} %)</span>
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-2 text-xs leading-snug text-muted-foreground">{ANSATTE_KILDEFORKLARING}</p>

      {erUtvalg && (
        <p className="mt-2 rounded-md border border-dashed border-border p-2 text-xs leading-snug text-foreground">
          Tallene er et utvalg. Hele trefflisten var for stor til å telles innen tidsgrensen, så
          fordelingen er regnet over de første {fmtAntall(fordeling.total)} treffene. Andelene kan
          avvike fra hele trefflisten.
        </p>
      )}

      {ansatteFilterAktivt && (
        <p className="mt-2 rounded-md border border-dashed border-border p-2 text-xs leading-snug text-foreground">
          Du filtrerer på ansatteintervall. Da er både «ukjent» og «null til fire» utelatt, fordi
          registeret ikke har et tall å sammenligne med: det gjelder{" "}
          <span className="tabular-nums font-medium">
            {fmtAntall(fordeling.ukjent + fordeling.null_til_fire)}
          </span>{" "}
          av {fmtAntall(fordeling.total)} treff ({fmtAntall(fordeling.ukjent)} ukjent,{" "}
          {fmtAntall(fordeling.null_til_fire)} med null til fire).
        </p>
      )}
    </Ramme>
  );
}
