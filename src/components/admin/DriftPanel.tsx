import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DRIFTSVARSLING_VERIFISERT, DRIFT_KILDER } from "@/lib/ops/status";

type Varsel = {
  alert_key: string;
  source: string;
  severity: string;
  title: string;
  first_seen_at: string | null;
  last_notified_at: string | null;
  notify_count: number;
  resolved_at: string | null;
};

function fmt(dt: string | null | undefined): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("no-NO");
  } catch {
    return dt;
  }
}

export function DriftPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["drift-varsling"],
    queryFn: async () => {
      const [state, heartbeat] = await Promise.all([
        supabase
          .from("ops_alert_state")
          .select("alert_key, source, severity, title, first_seen_at, last_notified_at, notify_count, resolved_at")
          .order("last_seen_at", { ascending: false })
          .limit(50),
        supabase.from("ops_heartbeat").select("name, last_beat_at, details").eq("name", "watchdog").maybeSingle(),
      ]);
      if (state.error) throw state.error;
      if (heartbeat.error) throw heartbeat.error;
      return {
        varsler: (state.data ?? []) as unknown as Varsel[],
        hjerteslag: heartbeat.data as { last_beat_at: string | null } | null,
      };
    },
    refetchInterval: 60_000,
  });

  const aktive = (data?.varsler ?? []).filter((v) => !v.resolved_at);

  return (
    <div className="space-y-6">
      {!DRIFTSVARSLING_VERIFISERT && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-semibold">Driftsvarsling er ikke verifisert</p>
          <p className="mt-1 text-muted-foreground">
            Et testvarsel er sendt, men mottak i innboksen er ikke bekreftet av et menneske. Manuell sjekk kreves:
            overvåkingen kan ikke regnes som utplassert før et varsel er bekreftet mottatt.
          </p>
        </div>
      )}

      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Vaktjobbens hjerteslag</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Siste kjøring: {fmt(data?.hjerteslag?.last_beat_at)} — forventet hver time, varsel etter tre timer.
        </p>
      </section>

      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Overvåkede kilder</h3>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1">Kilde</th>
              <th className="py-1">Intervall</th>
              <th className="py-1">Varsler ved stillhet</th>
            </tr>
          </thead>
          <tbody>
            {DRIFT_KILDER.map((k) => (
              <tr key={k.key} className="border-t">
                <td className="py-1">{k.navn}</td>
                <td className="py-1">{k.intervall}</td>
                <td className="py-1">{k.varsler}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Aktive varsler ({aktive.length})</h3>
        {isLoading && <p className="mt-2 text-sm text-muted-foreground">Laster …</p>}
        {error && <p className="mt-2 text-sm text-destructive">Kunne ikke lese varslingstilstand.</p>}
        {!isLoading && aktive.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">Ingen aktive varsler.</p>
        )}
        {aktive.length > 0 && (
          <ul className="mt-2 space-y-2 text-sm">
            {aktive.map((v) => (
              <li key={v.alert_key} className="border-t pt-2">
                <span className="font-medium">{v.title}</span>{" "}
                <span className="text-muted-foreground">({v.severity})</span>
                <div className="text-muted-foreground">
                  Oppdaget {fmt(v.first_seen_at)} · sist varslet {fmt(v.last_notified_at)} · {v.notify_count} varsler
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Historikk</h3>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {(data?.varsler ?? [])
            .filter((v) => v.resolved_at)
            .slice(0, 20)
            .map((v) => (
              <li key={v.alert_key}>
                {v.title} — løst {fmt(v.resolved_at)}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
