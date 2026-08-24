// @ts-nocheck
import { toast } from "sonner";
import { completeActivity, upsertActivity } from "@/lib/network.functions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { allNextStepsQuery } from "@/lib/queries/sub-resources";
import { applicationsGeneratedNotSentQuery } from "@/lib/queries/applications";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { PriorityBadge } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";
import { Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/next-steps/")({
  component: NextStepsPage,
});

function NextStepsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(allNextStepsQuery());
  const { data: genApps, isLoading: loadingGen } = useQuery(applicationsGeneratedNotSentQuery());

  // Kanonisk skrivevei: statusendring går alltid via serverhandlingen.
  const toggle = async (s: any) => {
    const res = await completeActivity({
      data: { activityId: s.id, status: s.completed ? "planlagt" : "utfort" },
    });
    if (!res.ok) {
      toast.error("Kunne ikke oppdatere aktiviteten.");
      return;
    }
    qc.invalidateQueries({ queryKey: ["next_steps"] });
    qc.invalidateQueries({ queryKey: ["network"] });
    qc.invalidateQueries({ queryKey: ["applications", "søknad_generert_light"] });
  };

  const today = new Date(new Date().toDateString());
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
  const open = (data ?? []).filter((s: any) => !s.completed);

  // Synthetic tasks: applications with generated-but-not-sent status
  const generatedApps = genApps ?? [];
  const syntheticTasks = generatedApps.map((a: any) => ({
    id: `synthetic-send-${a.id}`,
    synthetic: true as const,
    application_id: a.id,
    title: `Send søknad til ${a.company_name}`,
    due_date: null,
    priority: a.priority ?? "høy",
    applications: { company_name: a.company_name },
    role_title: a.role_title,
  }));

  const groups = {
    Forfalt: open.filter((s: any) => s.due_date && new Date(s.due_date) < today),
    "I dag": open.filter((s: any) => s.due_date && new Date(s.due_date).toDateString() === today.toDateString()),
    "Denne uken": open.filter((s: any) => s.due_date && new Date(s.due_date) > today && new Date(s.due_date) <= weekEnd),
    Senere: open.filter((s: any) => s.due_date && new Date(s.due_date) > weekEnd),
    "Klar til å sendes": syntheticTasks,
    "Uten frist": open.filter((s: any) => !s.due_date),
  };

  const totalOpen = open.length + syntheticTasks.length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Neste steg</h1>
      {isLoading || loadingGen ? <Skeleton className="h-64 w-full" /> : !totalOpen ? (
        <EmptyState title="Ingen åpne oppgaver" />
      ) : (
        Object.entries(groups).map(([label, items]) => items.length ? (
          <Card key={label}>
            <CardHeader>
              <CardTitle className={label === "Forfalt" ? "text-red-600" : ""}>
                {label} ({items.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {items.map((s: any) => (
                  <li key={s.id} className="relative flex items-stretch gap-2 rounded-md border overflow-hidden">
                    {s.synthetic ? (
                      <div className="flex items-center justify-center px-3 bg-sky-50 dark:bg-sky-950/30">
                        <Send className="h-4 w-4 text-sky-600" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(s)}
                        className="flex items-center justify-center px-3 hover:bg-accent/40 active:bg-accent/60"
                        aria-label="Marker som fullført"
                      >
                        <input
                          type="checkbox"
                          checked={!!s.completed}
                          readOnly
                          className="h-4 w-4 pointer-events-none"
                        />
                      </button>
                    )}
                    <Link
                      to="/applications/$id"
                      params={{ id: s.application_id }}
                      className="flex-1 min-w-0 flex items-center gap-3 py-3 pr-3 active:bg-accent/40"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          <span className="truncate">{s.title}</span>
                          {s.synthetic && (
                            <Badge variant="outline" className="text-[10px]">Søknad generert</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {s.applications?.company_name}
                          {s.role_title ? ` · ${s.role_title}` : ""}
                          {s.due_date ? ` · ${fmtDate(s.due_date)}` : ""}
                        </div>
                      </div>
                      <PriorityBadge priority={s.priority} />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null)
      )}
    </div>
  );
}
