import type { EmployerDetail } from "@/lib/queries/employer-insight";
import { MetricTile, fmtNok, fmtPercent, fmtRatio } from "./MetricTile";

export function RegisterPanel({ d }: { d: EmployerDetail }) {
  const naceListe: string[] = [];
  for (const [kode, besk] of [
    [d.naeringskode1_kode, d.naeringskode1_beskrivelse],
    [d.naeringskode2_kode, d.naeringskode2_beskrivelse],
    [d.naeringskode3_kode, d.naeringskode3_beskrivelse],
  ] as const) {
    if (kode || besk) {
      naceListe.push([kode, besk].filter(Boolean).join(" – "));
    }
  }

  const orgform =
    d.organisasjonsform_beskrivelse && d.organisasjonsform_kode
      ? `${d.organisasjonsform_beskrivelse} (${d.organisasjonsform_kode})`
      : d.organisasjonsform_beskrivelse ?? d.organisasjonsform_kode ?? null;

  const ja = (v: boolean | null | undefined) =>
    typeof v === "boolean" ? (v ? "Ja" : "Nei") : null;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-foreground">Enhetsregisteret</h3>
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="Organisasjonsform" value={orgform} />
          <Row label="Stiftelsesdato" value={d.stiftelsesdato} />
          <Row label="Arbeidsgivertype" value={d.arbeidsgiver_type} />
          <Row label="MVA-registrert" value={ja(d.registrert_i_mvaregisteret)} />
          <Row label="I Foretaksregisteret" value={ja(d.registrert_i_foretaksregisteret)} />
          <Row label="I konsern" value={ja(d.er_i_konsern)} />
          <Row label="Overordnet enhet" value={d.overordnet_enhet} />
          <Row
            label="Næringskoder"
            value={naceListe.length > 0 ? naceListe.join(" · ") : null}
          />
          <Row label="Aktivitet" value={d.aktivitet} />
          <Row label="Sektorkode" value={d.institusjonell_sektorkode} />
        </dl>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">Kontakt</h3>
        {!d.hjemmeside ? (
          <p className="mt-2 text-sm text-muted-foreground">Ikke registrert.</p>
        ) : (
          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row
              label="Hjemmeside"
              value={
                <a
                  href={normalizeUrl(d.hjemmeside)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--km-blue)] hover:underline break-all"
                >
                  {d.hjemmeside}
                </a>
              }
            />
          </dl>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">
          Siste regnskapsår{" "}
          {d.regnskapsaar ? (
            <span className="tabular-nums font-normal text-muted-foreground">
              ({d.regnskapsaar})
            </span>
          ) : null}
        </h3>
        {d.regnskapsaar === null || d.regnskapsaar === undefined ? (
          <p className="mt-2 text-sm text-muted-foreground">Ingen regnskapsdata tilgjengelig ennå.</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
              <MetricTile label="Driftsinntekter" value={fmtNok(d.driftsinntekter)} />
              <MetricTile label="Driftsresultat" value={fmtNok(d.driftsresultat)} />
              <MetricTile label="Årsresultat" value={fmtNok(d.aarsresultat)} />
              <MetricTile label="Egenkapital" value={fmtNok(d.sum_egenkapital)} />
              <MetricTile label="Gjeld" value={fmtNok(d.sum_gjeld)} />
              <MetricTile label="Eiendeler" value={fmtNok(d.sum_eiendeler)} />
              <MetricTile label="Driftsmargin" value={fmtPercent(d.driftsmargin_prosent)} />
              <MetricTile label="EK-andel" value={fmtPercent(d.egenkapitalandel_prosent)} />
              <MetricTile label="Gjeldsgrad" value={fmtRatio(d.gjeldsgrad)} />
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
      <dd className="font-medium text-foreground">
        {value && value !== "" ? value : <span className="font-normal text-muted-foreground">—</span>}
      </dd>
    </>
  );
}

function normalizeUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}
