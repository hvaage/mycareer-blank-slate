import type { EmployerDetail } from "@/lib/queries/employer-insight";
import { MetricTile } from "./MetricTile";
import { LoginCta } from "./LoginCta";

const SPM: Array<{ key: keyof EmployerDetail; label: string }> = [
  { key: "agg_process_q1", label: "Bekreftelse på mottatt søknad" },
  { key: "agg_process_q2", label: "Ryddig og forutsigbar kommunikasjon" },
  { key: "agg_process_q3", label: "Respektfull og profesjonell behandling" },
  { key: "agg_process_q4", label: "Konstruktiv tilbakemelding" },
  { key: "agg_process_q5", label: "Holdt avtaler om tidslinjer" },
  { key: "agg_process_q6", label: "Vil anbefale som arbeidsgiver" },
];

/**
 * Søkeres vurderinger av rekrutteringsprosessen. Aldri "candidate" i synlig norsk tekst.
 */
export function JobseekerProcessPanel({ d, orgnr }: { d: EmployerDetail; orgnr: string }) {
  const count = d.agg_process_count ?? 0;
  if (!count || count <= 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ingen vurderinger av søknadsprosessen ennå.
        </p>
        <LoginCta label="Logg inn for å vurdere prosessen" redirectTo={`/arbeidsgivere/${orgnr}`} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Basert på <span className="tabular-nums">{count}</span> vurdering{count === 1 ? "" : "er"} fra jobbsøkere.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <MetricTile label="Totalvurdering" value={fmtScore(d.agg_process_overall)} />
        {SPM.map((x) => (
          <MetricTile key={x.key} label={x.label} value={fmtScore(d[x.key] as number | null | undefined)} />
        ))}
      </div>
      <div>
        <LoginCta label="Logg inn for å vurdere prosessen" redirectTo={`/arbeidsgivere/${orgnr}`} />
      </div>
    </div>
  );
}

function fmtScore(n: number | null | undefined): string | null {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return n.toFixed(1).replace(".", ",");
}
