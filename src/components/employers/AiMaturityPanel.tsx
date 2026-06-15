import { Badge } from "@/components/ui/badge";
import { LoginCta } from "./LoginCta";

const SIGNALER = [
  { key: "strategy", label: "Strategi og ledelse" },
  { key: "capability", label: "Capability og deployment" },
  { key: "workforce", label: "Workforce og oppbygging av kompetanse" },
  { key: "governance", label: "AI-ansvarlighet og styring" },
  { key: "market", label: "Marked og produkt" },
] as const;

/**
 * AI-maturity / AI-kompetanse og fokus. Read-only status — ingen toggle.
 */
export function AiMaturityPanel({ orgnr }: { orgnr: string }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">AI-kompetanse og fokus</h3>
          <p className="text-xs text-muted-foreground">
            Vurdering av AI-modenhet på fem signalområder. Adskilt fra de 8 arbeidsgiverdimensjonene.
          </p>
        </div>
        <Badge variant="secondary" className="font-normal whitespace-nowrap">
          Relevans: Ikke vurdert
        </Badge>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            AI maturity score
          </span>
          <span className="text-2xl font-semibold tabular-nums text-muted-foreground">—</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Skala 1,0–5,0. Ikke vurdert ennå.</p>
      </div>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {SIGNALER.map((s) => (
          <li key={s.key} className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{s.label}</span>
              <Badge variant="outline" className="font-normal whitespace-nowrap">
                Ikke vurdert
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Funn og kilder vises her når extended-analyse er kjørt.
            </p>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border p-3">
        <p className="text-sm text-muted-foreground">
          AI-maturity vurderes som del av extended-analyse.
        </p>
        <LoginCta label="Logg inn for å starte" redirectTo={`/arbeidsgivere/${orgnr}`} />
      </div>
    </div>
  );
}
