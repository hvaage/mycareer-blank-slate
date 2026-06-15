import type { EmployerDetail } from "@/lib/queries/employer-insight";
import { RiskBadges, DataQualityBadges } from "./Badges";

export function SourcesPanel({ d }: { d: EmployerDetail }) {
  const harResearch = Array.isArray(d.research_log) && (d.research_log as unknown[]).length > 0;
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-semibold text-foreground">Regnskap</h3>
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="Regnskapsår" value={d.regnskapsaar ?? null} />
          <Row label="Synk-status" value={d.regnskap_sync_status ?? null} />
          <Row label="Sist sjekket" value={d.regnskap_last_checked_at ?? null} />
        </dl>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">Flagg</h3>
        {(d.risiko_flags?.length ?? 0) + (d.datakvalitet_flags?.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Ingen flagg registrert.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {d.risiko_flags && d.risiko_flags.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Risiko</div>
                <RiskBadges flags={d.risiko_flags} />
              </div>
            )}
            {d.datakvalitet_flags && d.datakvalitet_flags.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Datakvalitet</div>
                <DataQualityBadges flags={d.datakvalitet_flags} />
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">Research-logg</h3>
        {!harResearch ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Ingen research-logg tilgjengelig ennå. Kilder fra extended-analyse vil dukke opp her.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {(d.research_log as Array<Record<string, unknown>>).slice(0, 20).map((item, i) => (
              <li key={i} className="truncate">
                {typeof item.title === "string" ? item.title : JSON.stringify(item)}
              </li>
            ))}
          </ul>
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
