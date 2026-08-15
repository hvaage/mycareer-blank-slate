/**
 * Historisk regnskap med utvikling mellom år.
 *
 * Panelet skjuler seg selv: med bare ett registrert år vises ingenting —
 * ingen tom tabell og ingen fotnote om at historikk kommer. Registeret
 * leverer kun siste innsendte år, så historikken akkumuleres over tid og
 * funksjonen slår seg på av seg selv etter hvert som årene kommer inn.
 *
 * Regler for utviklingstallene:
 * - Prosentvis endring beregnes bare mellom samme regnskapstype
 *   (KONSERN mot KONSERN, SELSKAP mot SELSKAP). Typene er ikke sammenlignbare.
 * - Hull i årsrekken merkes eksplisitt, slik at et sprang fra 2022 til 2024
 *   ikke fremstår som utvikling fra ett år til det neste.
 */
import { useMemo } from "react";
import type { RegnskapAar } from "@/lib/queries/employer-insight";
import { fmtBelop } from "@/lib/employers/okonomi";

type Rad = {
  aar: RegnskapAar;
  endring: {
    driftsinntekter: number | null;
    driftsresultat: number | null;
    aarsresultat: number | null;
    motAar: number;
    hullAar: number[];
  } | null;
};

function pctEndring(ny: number | null | undefined, gammel: number | null | undefined) {
  if (typeof ny !== "number" || typeof gammel !== "number") return null;
  if (gammel === 0) return null;
  return ((ny - gammel) / Math.abs(gammel)) * 100;
}

function byggGrupper(rader: RegnskapAar[]): { type: string; rader: Rad[] }[] {
  const typer = new Map<string, RegnskapAar[]>();
  for (const r of rader) {
    const t = r.regnskapstype ?? "UKJENT";
    const liste = typer.get(t) ?? [];
    liste.push(r);
    typer.set(t, liste);
  }

  return [...typer.entries()]
    .map(([type, liste]) => {
      const sortert = [...liste].sort((a, b) => b.regnskapsaar - a.regnskapsaar);
      const medEndring: Rad[] = sortert.map((aar, i) => {
        const forrige = sortert[i + 1];
        if (!forrige) return { aar, endring: null };
        const hull: number[] = [];
        for (let y = forrige.regnskapsaar + 1; y < aar.regnskapsaar; y++) hull.push(y);
        return {
          aar,
          endring: {
            driftsinntekter: pctEndring(aar.driftsinntekter, forrige.driftsinntekter),
            driftsresultat: pctEndring(aar.driftsresultat, forrige.driftsresultat),
            aarsresultat: pctEndring(aar.aarsresultat, forrige.aarsresultat),
            motAar: forrige.regnskapsaar,
            hullAar: hull,
          },
        };
      });
      return { type, rader: medEndring };
    })
    .sort((a, b) => (b.rader[0]?.aar.regnskapsaar ?? 0) - (a.rader[0]?.aar.regnskapsaar ?? 0));
}

export function RegnskapHistorikk({ rader }: { rader: RegnskapAar[] | undefined }) {
  const grupper = useMemo(() => byggGrupper(rader ?? []), [rader]);

  // Skjuler seg selv: ett år er ingen historikk.
  if (!rader || rader.length < 2) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-display font-semibold tracking-tight text-foreground">
        Utvikling over tid
      </h2>
      <div className="space-y-6">
        {grupper.map((g) => (
          <div key={g.type}>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              {g.type === "KONSERN"
                ? "Konsernregnskap"
                : g.type === "SELSKAP"
                  ? "Selskapsregnskap"
                  : "Regnskapstype ikke oppgitt"}
              {g.rader.length < 2 && " — bare ett år, ingen utvikling å vise"}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">År</th>
                    <th className="px-3 py-2 text-right font-medium">Driftsinntekter</th>
                    <th className="px-3 py-2 text-right font-medium">Driftsresultat</th>
                    <th className="px-3 py-2 text-right font-medium">Årsresultat</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rader.map(({ aar, endring }) => (
                    <tr key={`${g.type}-${aar.regnskapsaar}`} className="border-t border-border">
                      <td className="px-3 py-2 font-medium tabular-nums text-foreground">
                        {aar.regnskapsaar}
                        {endring && endring.hullAar.length > 0 && (
                          <div className="text-xs font-normal text-muted-foreground">
                            {endring.hullAar.length === 1
                              ? `${endring.hullAar[0]} mangler i registeret`
                              : `${endring.hullAar[0]}–${endring.hullAar[endring.hullAar.length - 1]} mangler i registeret`}
                          </div>
                        )}
                      </td>
                      <Celle verdi={aar.driftsinntekter} pct={endring?.driftsinntekter ?? null} motAar={endring?.motAar} />
                      <Celle verdi={aar.driftsresultat} pct={endring?.driftsresultat ?? null} motAar={endring?.motAar} />
                      <Celle verdi={aar.aarsresultat} pct={endring?.aarsresultat ?? null} motAar={endring?.motAar} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      {grupper.length > 1 && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Selskapet har levert både konsern- og selskapsregnskap. Tallene er ikke sammenlignbare
          på tvers av typene, så utviklingen er beregnet innenfor hver type for seg.
        </p>
      )}
    </section>
  );
}

function Celle({
  verdi,
  pct,
  motAar,
}: {
  verdi: number | null | undefined;
  pct: number | null;
  motAar?: number;
}) {
  const opp = typeof pct === "number" && pct > 0;
  const ned = typeof pct === "number" && pct < 0;
  return (
    <td className="px-3 py-2 text-right tabular-nums text-foreground">
      {fmtBelop(verdi ?? null) ?? "—"}
      {typeof pct === "number" && (
        <div
          className={
            opp
              ? "text-xs font-medium text-[var(--km-green,theme(colors.emerald.600))]"
              : ned
                ? "text-xs font-medium text-destructive"
                : "text-xs text-muted-foreground"
          }
          title={motAar ? `Endring fra ${motAar}` : undefined}
        >
          {opp ? "+" : ""}
          {new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 }).format(pct)} %
        </div>
      )}
    </td>
  );
}
