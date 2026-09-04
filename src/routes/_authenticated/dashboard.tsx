// @ts-nocheck
/**
 * Dashboardet svarer på ett spørsmål: hva bør jeg gjøre nå?
 *
 * Regler som håndheves her:
 * - Alt som vises er enten en handling eller en mangel. Er det ingen av delene,
 *   hører det ikke hjemme på siden.
 * - Ingen tomme kort. Er en seksjon tom, skjules den.
 * - Ingen tall uten grunnlag. Er grunnlaget tomt, vises veien inn, ikke nuller.
 * - Hvert tall er en lenke til stedet det rettes.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileUp,
  Inbox,
  Layers,
} from "lucide-react";
import { applicationsListQuery, allNextStepsQuery } from "@/lib/queries";
import { foundationStatusQuery } from "@/lib/queries/dashboard-status";
import { pendingOverviewQuery } from "@/lib/queries/dashboard-pending";

import { computeConflicts, profileConflictsQuery } from "@/lib/queries/profile-conflicts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, PriorityBadge, UrgencyDot } from "@/components/badges";
import { fmtDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { useProfile, firstName } from "@/lib/use-profile";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type Blocker = {
  id: string;
  title: string;
  detail: string;
  to: string;
  cta: string;
  weight: number;
};

function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const apps = useQuery(applicationsListQuery());
  const steps = useQuery(allNextStepsQuery());
  const foundation = useQuery(foundationStatusQuery(userId));
  const pending = useQuery(pendingOverviewQuery(userId));

  const conflictData = useQuery(profileConflictsQuery(userId));

  const conflicts = useMemo(
    () => computeConflicts(conflictData.data?.profile, conflictData.data?.career),
    [conflictData.data],
  );

  const today = new Date(new Date().toDateString());

  const nextStepByApp = useMemo(() => {
    const map = new Map<string, { title: string; due_date: string | null }>();
    for (const s of (steps.data ?? []) as any[]) {
      if (s.completed) continue;
      const existing = map.get(s.application_id);
      if (!existing) {
        map.set(s.application_id, { title: s.title, due_date: s.due_date });
        continue;
      }
      const a = existing.due_date ? new Date(existing.due_date).getTime() : Infinity;
      const b = s.due_date ? new Date(s.due_date).getTime() : Infinity;
      if (b < a) map.set(s.application_id, { title: s.title, due_date: s.due_date });
    }
    return map;
  }, [steps.data]);

  const activeApps = useMemo(
    () =>
      (apps.data ?? [])
        .filter((a) => a.status && !["avsluttet", "trukket"].includes(a.status))
        .sort((x, y) => {
          const a = nextStepByApp.get(x.id!)?.due_date;
          const b = nextStepByApp.get(y.id!)?.due_date;
          const at = a ? new Date(a).getTime() : Infinity;
          const bt = b ? new Date(b).getTime() : Infinity;
          if (at !== bt) return at - bt;
          return (y.updated_at ?? "").localeCompare(x.updated_at ?? "");
        }),
    [apps.data, nextStepByApp],
  );

  const overdueSteps = (steps.data ?? []).filter(
    (s: any) => !s.completed && s.due_date && new Date(s.due_date) < today,
  );

  const f = foundation.data;
  const hasFoundation = (f?.total ?? 0) > 0;

  // ---- Blokkeringer: bare det som stopper noe, maks tre ----
  const blockers: Blocker[] = [];
  if (conflicts.length > 0) {
    blockers.push({
      id: "conflicts",
      title: `${conflicts.length} motstridende svar i profilen din`,
      detail: "Jobbsøket bruker begge svarene nå. Velg ett per konflikt.",
      to: "/preferences",
      cta: "Løs nå",
      weight: 100,
    });
  }
  // CV-linjer, KI-forslag og øvrige køer vises samlet under «Til gjennomgang».

  if (foundation.isSuccess && !hasFoundation) {
    blockers.push({
      id: "no-foundation",
      title: "Du har ikke registrert noen roller ennå",
      detail: "Uten roller finnes det ingenting å belegge kompetanse med.",
      to: "/karriere/erfaring",
      cta: "Bygg grunnlaget",
      weight: 95,
    });
  }
  if (hasFoundation && (f?.unbacked ?? 0) > 0) {
    blockers.push({
      id: "unbacked",
      title: `${f!.unbacked} kompetanser står uten belegg`,
      detail: "Koble dem til en rolle eller et resultat, så teller de i matchingen.",
      to: "/karriere/erfaring",
      cta: "Koble opp",
      weight: 60,
    });
  }
  if (overdueSteps.length > 0) {
    blockers.push({
      id: "overdue",
      title: `${overdueSteps.length} oppgaver har passert fristen`,
      detail: overdueSteps
        .slice(0, 2)
        .map((s: any) => s.title)
        .join(" · "),
      to: "/next-steps",
      cta: "Se oppgavene",
      weight: 80,
    });
  }
  blockers.sort((a, b) => b.weight - a.weight);
  const topBlockers = blockers.slice(0, 3);

  const { data: profile } = useProfile();
  const fname = firstName(profile);
  const hour = new Date().getHours();
  const tod =
    hour < 5 ? "God natt" : hour < 10 ? "God morgen" : hour < 17 ? "Hei" : hour < 22 ? "God kveld" : "God natt";

  const pendingItems = pending.data?.items ?? [];
  const pendingTotal = pending.data?.total ?? 0;
  const waitingCount = blockers.length + pendingItems.length;

  const loading = apps.isLoading || foundation.isLoading || pending.isLoading;
  const allClear =
    !loading && blockers.length === 0 && pendingTotal === 0 && activeApps.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <UserAvatar size="md" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">
            {tod}
            {fname ? `, ${fname}` : ""}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {waitingCount > 0
              ? `${waitingCount} ${waitingCount === 1 ? "ting venter" : "ting venter"} på deg`
              : "Ingenting krever et valg fra deg nå"}
          </p>
        </div>
      </div>


      {loading ? <Skeleton className="h-24 w-full" /> : null}

      {/* ---- Det som blokkerer ---- */}
      {topBlockers.length > 0 ? (
        <div className="space-y-2">
          {topBlockers.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 px-4 py-3"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{b.title}</p>
                <p className="text-xs text-muted-foreground">{b.detail}</p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={b.to}>{b.cta}</Link>
              </Button>
            </div>
          ))}
          {blockers.length > topBlockers.length ? (
            <Link
              to="/karriere/erfaring"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              Se alle {blockers.length} <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* ---- Grunnlaget ---- */}
      {foundation.isSuccess ? (
        hasFoundation ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
              Grunnlaget ditt
            </span>
            <Link to="/karriere/erfaring" className="text-sm hover:underline">
              {f!.roles} roller · {f!.results} resultater · {f!.competences} kompetanser
            </Link>
            {f!.unbacked > 0 ? (
              <Link
                to="/karriere/erfaring"
                className="text-sm text-amber-700 hover:underline dark:text-amber-400"
              >
                {f!.unbacked} mangler belegg
              </Link>
            ) : null}
            <Link to="/documentation" className="text-sm text-muted-foreground hover:underline">
              {f!.attested} av {f!.total} er bekreftet av andre
            </Link>
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-wrap items-center gap-4 py-5">
              <FileUp className="h-5 w-5 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Grunnlaget ditt er tomt</p>
                <p className="text-xs text-muted-foreground">
                  Last opp en CV, så foreslår vi roller, resultater og kompetanse du kan bekrefte.
                  Ingenting lagres før du har sagt ja.
                </p>
              </div>
              <Button asChild size="sm">
                <Link to="/forslag/cv">Last opp CV</Link>
              </Button>
            </CardContent>
          </Card>
        )
      ) : null}

      {/* ---- Til gjennomgang: alt som venter, på tvers av modulene ---- */}
      {pendingItems.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="h-4 w-4 text-muted-foreground" aria-hidden />
              Til gjennomgang
            </CardTitle>
            <span className="text-sm text-muted-foreground">{pendingTotal}</span>
          </CardHeader>
          <CardContent className="divide-y py-0 pb-2">
            {pendingItems.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-accent/40"
              >
                <span className="min-w-8 text-right text-sm font-semibold tabular-nums">
                  {item.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.detail}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}


      {/* ---- Søknader ---- */}
      {activeApps.length > 0 ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Søknader og jobbannonser</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-4">
            <ul className="divide-y md:hidden">
              {activeApps.map((a) => {
                const ns = nextStepByApp.get(a.id!);
                const overdueStep = ns?.due_date && new Date(ns.due_date) < today;
                return (
                  <li key={a.id}>
                    <Link
                      to="/applications/$id"
                      params={{ id: a.id! }}
                      className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 active:bg-accent/40"
                    >
                      <UrgencyDot level={a.urgency_level} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{a.company_name}</span>
                          <StatusBadge status={a.status} />
                        </div>
                        {a.role_title && (
                          <div className="truncate text-sm text-muted-foreground">{a.role_title}</div>
                        )}
                        {ns ? (
                          <div
                            className={`mt-0.5 text-xs ${overdueStep ? "font-medium text-red-600" : "text-muted-foreground"}`}
                          >
                            {ns.title}
                            {ns.due_date ? ` (${fmtDate(ns.due_date)})` : ""}
                          </div>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="w-6 px-2 py-1.5"></th>
                    <th className="px-2 py-1.5 text-left">Bedrift</th>
                    <th className="px-2 py-1.5 text-left">Rolle</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5 text-left">Prioritet</th>
                    <th className="px-2 py-1.5 text-left">Søkt</th>
                    <th className="px-2 py-1.5 text-left">Neste oppfølging</th>
                  </tr>
                </thead>
                <tbody>
                  {activeApps.map((a) => {
                    const ns = nextStepByApp.get(a.id!);
                    const overdueStep = ns?.due_date && new Date(ns.due_date) < today;
                    return (
                      <tr
                        key={a.id}
                        className="cursor-pointer border-b hover:bg-accent/30"
                        onClick={() => navigate({ to: "/applications/$id", params: { id: a.id! } })}
                      >
                        <td className="px-2 py-1.5">
                          <UrgencyDot level={a.urgency_level} />
                        </td>
                        <td className="px-2 py-1.5 font-medium">{a.company_name}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{a.role_title ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          <StatusBadge status={a.status} />
                        </td>
                        <td className="px-2 py-1.5">
                          <PriorityBadge priority={a.priority} />
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {fmtDate(a.applied_date)}
                        </td>
                        <td className="px-2 py-1.5">
                          {ns ? (
                            <span
                              className={overdueStep ? "font-medium text-red-600" : undefined}
                            >
                              {ns.title}
                              {ns.due_date ? ` · ${fmtDate(ns.due_date)}` : ""}
                            </span>
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
          </CardContent>
        </Card>
      ) : null}

      {allClear ? (
        <div className="flex items-center gap-3 rounded-lg border px-4 py-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
          Alt er ajour. Ingenting venter på deg akkurat nå.
        </div>
      ) : null}
    </div>
  );
}

