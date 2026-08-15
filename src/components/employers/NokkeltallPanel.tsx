/**
 * Nøkkeltall om arbeidsgiveren — det en jobbsøker spør om først.
 *
 * Ansatte står øverst og bruker de tre kategoriene fra ansatte-arbeidet:
 * et faktisk antall, "0–4", eller "Ukjent" sagt eksplisitt.
 */
import type { EmployerDetail } from "@/lib/queries/employer-insight";
import {
  ansatteKategori,
  formatAnsatte,
  ANSATTE_KILDEFORKLARING,
} from "@/lib/employers/ansatte";
import { fmtBelop, fmtAar } from "@/lib/employers/okonomi";

export function NokkeltallPanel({ d }: { d: EmployerDetail }) {
  const kat = ansatteKategori(d);
  const ukjentAnsatte = kat === "ukjent";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kort
        label="Ansatte"
        verdi={formatAnsatte(d)}
        dempet={ukjentAnsatte}
        hint={
          ukjentAnsatte
            ? "Registeret har ikke tallet"
            : kat === "null_til_fire"
              ? "Brreg oppgir ikke eksakt tall under fem"
              : "Registrert i Enhetsregisteret"
        }
        tittel={ukjentAnsatte || kat === "null_til_fire" ? ANSATTE_KILDEFORKLARING : undefined}
      />
      <Kort
        label="Omsetning"
        verdi={fmtBelop(d.driftsinntekter)}
        hint={d.regnskapsaar ? `Driftsinntekter ${d.regnskapsaar}` : "Driftsinntekter"}
      />
      <Kort
        label="Omsetning per ansatt"
        verdi={fmtBelop(d.omsetning_per_ansatt)}
        hint={ukjentAnsatte ? "Kan ikke beregnes uten ansattetall" : undefined}
      />
      <Kort
        label="Selskapsalder"
        verdi={fmtAar(d.selskapsalder_aar)}
        hint={d.stiftelsesdato ? `Stiftet ${d.stiftelsesdato}` : undefined}
      />
      <Kort
        label="Arbeidsgivertype"
        verdi={d.arbeidsgiver_type ? human(d.arbeidsgiver_type) : null}
        hint={d.hjemmeside ? undefined : "Hjemmeside ikke registrert"}
        lenke={
          d.hjemmeside
            ? { href: normalizeUrl(d.hjemmeside), tekst: d.hjemmeside }
            : undefined
        }
      />
    </div>
  );
}

function Kort({
  label,
  verdi,
  hint,
  dempet,
  tittel,
  lenke,
}: {
  label: string;
  verdi: string | null;
  hint?: string | undefined;
  dempet?: boolean;
  tittel?: string | undefined;
  lenke?: { href: string; tekst: string } | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3" title={tittel}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          dempet
            ? "mt-1 text-lg font-medium italic text-muted-foreground"
            : "mt-1 text-lg font-semibold tabular-nums text-foreground"
        }
      >
        {verdi ?? <span className="font-normal text-muted-foreground">Ikke oppgitt</span>}
      </div>
      {lenke && (
        <a
          href={lenke.href}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 block truncate text-xs text-[var(--km-blue)] hover:underline"
        >
          {lenke.tekst}
        </a>
      )}
      {hint && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

function human(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function normalizeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}
