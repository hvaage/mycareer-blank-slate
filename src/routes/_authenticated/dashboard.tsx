// @ts-nocheck
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  applicationsListQuery,
  allNextStepsQuery,
} from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, PriorityBadge, UrgencyDot } from "@/components/badges";
import { STATUS_LABELS } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { useProfile, firstName } from "@/lib/use-profile";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const apps = useQuery(applicationsListQuery());
  const steps = useQuery(allNextStepsQuery());

  const total = apps.data?.length ?? 0;
  const aktive = apps.data?.filter((a) => a.status && !["avsluttet", "trukket"].includes(a.status)).length ?? 0;
  const tilbud = apps.data?.filter((a) => a.status === "tilbud_mottatt").length ?? 0;
  const needsAttention = (apps.data ?? []).filter(
    (a) =>
      a.urgency_level === "kritisk" ||
      a.urgency_level === "høy" ||
      a.status === "søknad_generert",
  );
  const krever = needsAttention.length;

  const today = new Date(new Date().toDateString());
  const overdue = (steps.data ?? []).filter(
    (s) => !s.completed && s.due_date && new Date(s.due_date) < today
  );

  // Build next-step lookup per application (earliest open due_date)
  const nextStepByApp = new Map<string, { title: string; due_date: string | null }>();
  for (const s of (steps.data ?? []) as any[]) {
    if (s.completed) continue;
    const existing = nextStepByApp.get(s.application_id);
    if (!existing) {
      nextStepByApp.set(s.application_id, { title: s.title, due_date: s.due_date });
      continue;
    }
    // Prefer the one with earliest due_date (nulls last)
    const a = existing.due_date ? new Date(existing.due_date).getTime() : Infinity;
    const b = s.due_date ? new Date(s.due_date).getTime() : Infinity;
    if (b < a) nextStepByApp.set(s.application_id, { title: s.title, due_date: s.due_date });
  }

  const activeApps = (apps.data ?? [])
    .filter((a) => a.status && !["avsluttet", "trukket"].includes(a.status))
    .sort((x, y) => {
      const xn = nextStepByApp.get(x.id!)?.due_date;
      const yn = nextStepByApp.get(y.id!)?.due_date;
      const a = xn ? new Date(xn).getTime() : Infinity;
      const b = yn ? new Date(yn).getTime() : Infinity;
      if (a !== b) return a - b;
      return (y.updated_at ?? "").localeCompare(x.updated_at ?? "");
    });

  const { data: profile } = useProfile();
  const fname = firstName(profile);
  const hour = new Date().getHours();
  const tod = hour < 5 ? "God natt" : hour < 10 ? "God morgen" : hour < 17 ? "Hei" : hour < 22 ? "God kveld" : "God natt";

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4">
        <UserAvatar size="lg" className="hidden sm:flex" />
        <UserAvatar size="md" className="sm:hidden" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">
            {tod}{fname ? `, ${fname}` : ""} 👋
          </h1>
          <p className="text-sm text-muted-foreground truncate">
            {profile?.linkedin_headline ?? "Oversikt over dine søknader"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard label="Totalt" value={total} loading={apps.isLoading} />
        <MetricCard label="Aktive" value={aktive} loading={apps.isLoading} />
        <MetricCard label="Tilbud" value={tilbud} loading={apps.isLoading} />
        <MetricCard label="Krever oppmerksomhet" value={krever} loading={apps.isLoading} tone="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status på søknader og jobb annonser</CardTitle>
        </CardHeader>
        <CardContent>
          {apps.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : !activeApps.length ? (
            <EmptyState title="Ingen aktive søknader" />
          ) : (
            <>
              {/* Mobile / iPad: kort med hele kortet klikkbart */}
              <ul className="md:hidden divide-y">
                {activeApps.map((a) => {
                  const ns = nextStepByApp.get(a.id!);
                  const overdueStep = ns?.due_date && new Date(ns.due_date) < today;
                  return (
                    <li key={a.id}>
                      <Link
                        to="/applications/$id"
                        params={{ id: a.id! }}
                        className="flex items-start gap-3 py-3 active:bg-accent/40 -mx-2 px-2 rounded-md"
                      >
                        <UrgencyDot level={a.urgency_level} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{a.company_name}</span>
                            <StatusBadge status={a.status} />
                            <PriorityBadge priority={a.priority} />
                          </div>
                          {a.role_title && (
                            <div className="text-sm text-muted-foreground truncate">{a.role_title}</div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">
                            {a.applied_date ? `Søkt ${fmtDate(a.applied_date)}` : "Ikke sendt"}
                            {ns ? (
                              <> · <span className={overdueStep ? "text-red-600 font-medium" : ""}>
                                {ns.title}{ns.due_date ? ` (${fmtDate(ns.due_date)})` : ""}
                              </span></>
                            ) : null}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* Desktop: tabell der hver rad er klikkbar */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left px-2 py-2 w-6"></th>
                      <th className="text-left px-2 py-2">Bedrift</th>
                      <th className="text-left px-2 py-2">Rolle</th>
                      <th className="text-left px-2 py-2">Status</th>
                      <th className="text-left px-2 py-2">Pipeline</th>
                      <th className="text-left px-2 py-2">Prioritet</th>
                      <th className="text-left px-2 py-2">Søkt</th>
                      <th className="text-left px-2 py-2">Neste oppfølging</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeApps.map((a) => {
                      const ns = nextStepByApp.get(a.id!);
                      const overdueStep = ns?.due_date && new Date(ns.due_date) < today;
                      return (
                        <tr
                          key={a.id}
                          className="border-b hover:bg-accent/30 cursor-pointer"
                          onClick={() => navigate({ to: "/applications/$id", params: { id: a.id! } })}
                        >
                          <td className="px-2 py-2"><UrgencyDot level={a.urgency_level} /></td>
                          <td className="px-2 py-2 font-medium">{a.company_name}</td>
                          <td className="px-2 py-2 text-muted-foreground">{a.role_title ?? "—"}</td>
                          <td className="px-2 py-2"><StatusBadge status={a.status} /></td>
                          <td className="px-2 py-2 text-muted-foreground text-xs">
                            {a.status ? STATUS_LABELS[a.status] ?? a.status : "—"}
                          </td>
                          <td className="px-2 py-2"><PriorityBadge priority={a.priority} /></td>
                          <td className="px-2 py-2 text-muted-foreground">{fmtDate(a.applied_date)}</td>
                          <td className="px-2 py-2">
                            {ns ? (
                              <div className="flex flex-col">
                                <span className="truncate max-w-[16rem]">{ns.title}</span>
                                {ns.due_date && (
                                  <span className={`text-xs ${overdueStep ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                                    {fmtDate(ns.due_date)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Krever oppmerksomhet</CardTitle>
          </CardHeader>
          <CardContent>
            {apps.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              (() => {
                const list = needsAttention;
                if (!list.length)
                  return <EmptyState title="Ingen som krever oppmerksomhet" />;
                return (
                  <ul className="divide-y">
                    {list.slice(0, 8).map((a) => (
                      <li key={a.id} className="py-2.5">
                        <Link
                          to="/applications/$id"
                          params={{ id: a.id! }}
                          className="flex items-center gap-3 hover:underline"
                        >
                          <UrgencyDot level={a.urgency_level} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{a.company_name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {a.role_title}
                            </div>
                          </div>
                          <StatusBadge status={a.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                );
              })()
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Forfalte oppgaver</CardTitle>
          </CardHeader>
          <CardContent>
            {steps.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : overdue.length === 0 ? (
              <EmptyState title="Ingen forfalte oppgaver" />
            ) : (
              <ul className="divide-y">
                {overdue.slice(0, 8).map((s: any) => (
                  <li key={s.id} className="py-2.5">
                    <Link
                      to="/applications/$id"
                      params={{ id: s.application_id }}
                      className="flex items-center justify-between hover:underline"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {s.applications?.company_name}
                        </div>
                      </div>
                      <span className="text-xs text-red-600 font-medium">
                        {fmtDate(s.due_date)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

function MetricCard({
  label,
  value,
  loading,
  tone,
}: {
  label: string;
  value: number;
  loading?: boolean;
  tone?: "warning";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <div className={`text-3xl font-bold ${tone === "warning" ? "text-orange-600" : ""}`}>
            {value}
          </div>
        )}
        <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
