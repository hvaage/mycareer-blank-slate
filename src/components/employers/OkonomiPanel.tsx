/**
 * Økonomisk bilde med forklaring.
 *
 * Tallene står ikke alene: der driftsresultat og årsresultat spriker,
 * forklares avviket, og soliditeten oversettes til klartekst. Risikoflagg
 * får en setning hver, og dempes når årsresultatet motsier dem.
 */
import { AlertTriangle, Info } from "lucide-react";
import type { EmployerDetail } from "@/lib/queries/employer-insight";
import {
  fmtBelop,
  fmtProsent,
  fmtGjeldsgrad,
  forklarResultatavvik,
  forklarSoliditet,
  forklarRisikoflagg,
  humaniserFlagg,
} from "@/lib/employers/okonomi";

export function OkonomiPanel({ d }: { d: EmployerDetail }) {
  if (d.regnskapsaar === null || d.regnskapsaar === undefined) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Ingen regnskapsdata i registeret for denne arbeidsgiveren ennå.
      </p>
    );
  }

  const avvik = forklarResultatavvik(d);
  const soliditet = forklarSoliditet(d);
  const flagg = d.risiko_flags ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tall label="Driftsinntekter" verdi={fmtBelop(d.driftsinntekter)} />
        <Tall label="Driftsresultat" verdi={fmtBelop(d.driftsresultat)} negativ={num(d.driftsresultat) < 0} />
        <Tall label="Årsresultat" verdi={fmtBelop(d.aarsresultat)} negativ={num(d.aarsresultat) < 0} />
        <Tall label="Driftsmargin" verdi={fmtProsent(d.driftsmargin_prosent)} negativ={num(d.driftsmargin_prosent) < 0} />
        <Tall label="Egenkapitalandel" verdi={fmtProsent(d.egenkapitalandel_prosent)} />
        <Tall label="Gjeldsgrad" verdi={fmtGjeldsgrad(d.gjeldsgrad)} />
      </div>

      {avvik && (
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">
          <Info className="mr-1.5 inline h-4 w-4 align-[-2px] text-muted-foreground" aria-hidden />
          {avvik}
        </p>
      )}

      {soliditet && (
        <p className="text-sm leading-relaxed text-muted-foreground">{soliditet.tekst}</p>
      )}

      {(typeof d.driftsresultat_per_ansatt === "number" ||
        typeof d.sum_egenkapital === "number") && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Linje label="Egenkapital" verdi={fmtBelop(d.sum_egenkapital)} />
          <Linje label="Gjeld" verdi={fmtBelop(d.sum_gjeld)} />
          <Linje label="Eiendeler" verdi={fmtBelop(d.sum_eiendeler)} />
          <Linje label="Driftsresultat per ansatt" verdi={fmtBelop(d.driftsresultat_per_ansatt)} />
        </dl>
      )}

      {flagg.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Flagg fra registerdataene</h3>
          <ul className="space-y-1.5">
            {flagg.map((f) => {
              const { tekst, dempet } = forklarRisikoflagg(f, d);
              return (
                <li
                  key={f}
                  className={
                    dempet
                      ? "flex gap-2 rounded-md border border-border bg-muted/20 p-2 text-sm"
                      : "flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm"
                  }
                >
                  <AlertTriangle
                    className={
                      dempet
                        ? "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        : "mt-0.5 h-4 w-4 shrink-0 text-destructive"
                    }
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium text-foreground">{humaniserFlagg(f)}.</span>{" "}
                    <span className="text-muted-foreground">{tekst}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Tallene er hentet fra innsendt årsregnskap for {d.regnskapsaar}
        {d.regnskapstype ? ` (${d.regnskapstype.toLowerCase()})` : ""}.
      </p>
    </div>
  );
}

function num(n: number | null | undefined): number {
  return typeof n === "number" ? n : 0;
}

function Tall({
  label,
  verdi,
  negativ,
}: {
  label: string;
  verdi: string | null;
  negativ?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          negativ
            ? "mt-1 text-lg font-semibold tabular-nums text-destructive"
            : "mt-1 text-lg font-semibold tabular-nums text-foreground"
        }
      >
        {verdi ?? <span className="font-normal text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function Linje({ label, verdi }: { label: string; verdi: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{verdi ?? "—"}</dd>
    </div>
  );
}
