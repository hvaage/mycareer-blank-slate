// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { PanelEmpty } from "@/components/network/panel";
import { formatEventDate, type TimelineEvent } from "@/lib/queries/network-timeline";

/**
 * Felles tidslinjevisning: dato først på samme linje som beskrivelsen.
 * Planlagte hendelser skilles visuelt fra utførte.
 */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <PanelEmpty>Ingen registrerte hendelser ennå.</PanelEmpty>;
  }
  return (
    <ul className="divide-y divide-border">
      {events.map((e) => (
        <li key={e.id} className="flex gap-2 py-1.5">
          <span className="w-24 shrink-0 tabular-nums text-xs text-muted-foreground">
            {formatEventDate(e.at)}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={
                e.kind === "planned"
                  ? "rounded border border-dashed border-border px-1 text-[10px] uppercase text-muted-foreground"
                  : "rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground"
              }
            >
              {e.kind === "planned" ? "Planlagt" : "Utført"}
            </span>{" "}
            {e.href ? (
              <Link to={e.href.to} params={e.href.params} className="underline underline-offset-2">
                {e.label}
              </Link>
            ) : (
              e.label
            )}
            {e.detail ? (
              <span className="block text-xs text-muted-foreground">{e.detail}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
