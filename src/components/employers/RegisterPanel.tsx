import type { EmployerDetail } from "@/lib/queries/employer-insight";
import { MetricTile, fmtNok, fmtPercent } from "./MetricTile";

export function RegisterPanel({ d }: { d: EmployerDetail }) {
  const naceListe = d.naeringskoder && d.naeringskoder.length > 0
    ? d.naeringskoder
    : d.naeringskode
      ? [d.naeringskode]
      : [];

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-foreground">Enhetsregisteret</h3>
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="Organisasjonsform" value={d.organisasjonsform} />
          <Row label="Stiftelsesdato" value={d.stiftelsesdato} />
          <Row label="Arbeidsgivertype" value={d.arbeidsgiver_type} />
          <Row label="MVA-registrert" value={typeof d.mva_registrert === "boolean" ? (d.mva_registrert ? "Ja" : "Nei") : null} />
          <Row label="Overordnet enhet" value={d.overordnet_enhet} />
          <Row label="Konsern" value={d.konsern} />
          <Row
            label="Næringskoder"
            value={naceListe.length > 0 ? naceListe.join(", ") : null}
          />
          <Row label="Bransje" value={d.bransje} />
        </dl>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">Kontakt</h3>
        {!d.hjemmeside && !d.epostadresse && !d.telefon && !d.mobil ? (
          <p className="mt-2 text-sm text-muted-foreground">Ikke registrert.</p>
        ) : (
          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row
              label="Hjemmeside"
              value={
                d.hjemmeside ? (
                  <a
                    href={normalizeUrl(d.hjemmeside)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--km-blue)] hover:underline break-all"
                  >
                    {d.hjemmeside}
                  </a>
                ) : null
              }
            />
            <Row label="E-post" value={d.epostadresse} />
            <Row label="Telefon" value={d.telefon} />
            <Row label="Mobil" value={d.mobil} />
          </dl>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">
          Siste regnskapsår {d.regnskapsaar ? <span className="tabular-nums font-normal text-muted-foreground">({d.regnskapsaar})</span> : null}
        </h3>
        {d.regnskapsaar === null || d.regnskapsaar === undefined ? (
          <p className="mt-2 text-sm text-muted-foreground">Ingen regnskapsdata tilgjengelig ennå.</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
              <MetricTile label="Driftsinntekter" value={fmtNok(d.driftsinntekter)} />
              <MetricTile label="Driftsresultat" value={fmtNok(d.driftsresultat)} />
              <MetricTile label="Årsresultat" value={fmtNok(d.aarsresultat)} />
              <MetricTile label="Egenkapital" value={fmtNok(d.egenkapital)} />
              <MetricTile label="Gjeld" value={fmtNok(d.gjeld)} />
              <MetricTile label="Eiendeler" value={fmtNok(d.eiendeler)} />
              <MetricTile label="Driftsmargin" value={fmtPercent(d.driftsmargin_prosent)} />
              <MetricTile label="EK-andel" value={fmtPercent(d.egenkapitalandel_prosent)} />
              <MetricTile label="Gjeldsgrad" value={fmtPercent(d.gjeldsgrad)} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Historisk regnskapstabell kommer når egen history-RPC/view er på plass.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value && value !== "" ? value : <span className="font-normal text-muted-foreground">—</span>}</dd>
    </>
  );
}

function normalizeUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}
