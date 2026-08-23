/**
 * Kort nøkkeltallsstripe for en verifisert arbeidsgiver.
 *
 * Viser antall ansatte og de viktigste tallene fra regnskapsregisteret.
 * Ingen tall vises uten regnskapsår og valuta — beløp uten kontekst er ikke sammenlignbare.
 */
import { useQuery } from "@tanstack/react-query";
import { employerDetailQuery } from "@/lib/queries/employer-insight";

function amount(value: number | null | undefined, currency: string): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

export function EmployerKeyFacts({ orgnr }: { orgnr: string | null }) {
  const detail = useQuery({ ...employerDetailQuery(orgnr ?? ""), enabled: Boolean(orgnr) });

  if (!orgnr) return null;
  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Henter nøkkeltall fra registeret…</p>;
  }

  const row = detail.data?.kind === "ok" ? detail.data.data : null;
  if (!row) return null;

  const facts: Array<{ label: string; value: string }> = [];
  if (row.antall_ansatte != null) {
    facts.push({ label: "Antall ansatte", value: String(row.antall_ansatte) });
  }

  const currency = row.valuta ?? null;
  const year = row.regnskapsaar ?? null;
  if (currency && year) {
    const push = (label: string, v: number | null | undefined) => {
      const f = amount(v, currency);
      if (f) facts.push({ label, value: f });
    };
    push("Driftsinntekter", row.driftsinntekter);
    push("Driftsresultat", row.driftsresultat);
    push("Årsresultat", row.aarsresultat);
    push("Egenkapital", row.sum_egenkapital);
  }

  if (facts.length === 0) return null;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {facts.map((f) => (
          <div key={f.label}>
            <p className="text-xs text-muted-foreground">{f.label}</p>
            <p className="text-sm font-medium tabular-nums">{f.value}</p>
          </div>
        ))}
      </div>
      {year ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Regnskapsår {year} · kilde Enhets- og regnskapsregisteret
        </p>
      ) : null}
    </section>
  );
}
