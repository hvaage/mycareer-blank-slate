import type { AnsatteFordelingResult } from "@/lib/queries/employer-insight";
import {
  ANSATTE_KATEGORI_LABEL,
  ANSATTE_KATEGORI_REKKEFOELGE,
  ANSATTE_KILDEFORKLARING,
  fmtAntall,
} from "@/lib/employers/ansatte";

/**
 * Ansattetall vises aldri som ett tall alene. «71 914 selskaper med ansatte»
 * er misvisende når ansattetallet er ukjent for 283 048 av treffene.
 */
export function AnsatteFordelingBanner({
  fordeling,
  ansatteFilterAktivt,
}: {
  fordeling: AnsatteFordelingResult | undefined;
  ansatteFilterAktivt: boolean;
}) {
  if (!fordeling?.available || fordeling.total === 0) return null;

  const overGrense = fordeling.capped;

  return (
    <section
      aria-label="Ansattetall i utvalget"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Ansattetall i utvalget</h2>
        <p className="text-xs text-muted-foreground">
          {overGrense
            ? `Talt på de første ${fmtAntall(fordeling.total)} treffene.`
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

      <p className="mt-2 text-xs leading-snug text-muted-foreground">
        {ANSATTE_KILDEFORKLARING}
      </p>

      {ansatteFilterAktivt && (
        <p className="mt-2 rounded-md border border-dashed border-border p-2 text-xs leading-snug text-foreground">
          Du filtrerer på ansatteintervall. Da er både «ukjent» og «null til fire» utelatt,
          fordi registeret ikke har et tall å sammenligne med: det gjelder{" "}
          <span className="tabular-nums font-medium">
            {fmtAntall(fordeling.ukjent + fordeling.null_til_fire)}
          </span>{" "}
          av {fmtAntall(fordeling.total)} treff ({fmtAntall(fordeling.ukjent)} ukjent,{" "}
          {fmtAntall(fordeling.null_til_fire)} med null til fire).
        </p>
      )}
    </section>
  );
}
