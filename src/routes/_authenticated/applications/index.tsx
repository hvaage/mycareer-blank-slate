import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { applicationsListQuery, updateApplication } from "@/lib/queries/applications";
import { StatusBadge, PriorityBadge, StarToggle, UrgencyDot } from "@/components/badges";
import { STATUS_LABELS, STATUS_ORDER, PRIORITY_LABELS } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Plus } from "lucide-react";
import { fmtDate } from "@/lib/format";

const searchSchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  sort: z.enum(["updated", "created", "applied", "company"]).optional(),
});

export const Route = createFileRoute("/_authenticated/applications/")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ApplicationsListPage,
});

function ApplicationsListPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/applications" });
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(applicationsListQuery());

  const starMut = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      updateApplication(id, { is_starred: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["applications"] }),
  });

  let rows = data ?? [];
  if (search.status) rows = rows.filter((r) => r.status === search.status);
  if (search.priority) rows = rows.filter((r) => r.priority === search.priority);
  if (search.q) {
    const q = search.q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.company_name?.toLowerCase().includes(q) ||
        r.role_title?.toLowerCase().includes(q)
    );
  }
  const sort = search.sort ?? "updated";
  rows = [...rows].sort((a, b) => {
    if (sort === "company") return (a.company_name ?? "").localeCompare(b.company_name ?? "");
    const k = sort === "created" ? "created_at" : sort === "applied" ? "applied_date" : "updated_at";
    return (b[k as keyof typeof b] ?? "").toString().localeCompare((a[k as keyof typeof a] ?? "").toString());
  });

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: any) => ({ ...prev, ...patch }) });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold">Status på søknader og jobb annonser</h1>
        <Button asChild>
          <Link to="/applications/new">
            <Plus className="h-4 w-4 mr-2" /> Ny søknad
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3">
        <Input
          placeholder="Søk bedrift eller rolle…"
          value={search.q ?? ""}
          onChange={(e) => setSearch({ q: e.target.value || undefined })}
          className="md:max-w-xs"
        />
        <Select
          value={search.status ?? "_all"}
          onValueChange={(v) => setSearch({ status: v === "_all" ? undefined : v })}
        >
          <SelectTrigger className="md:w-48"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Alle statuser</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.priority ?? "_all"}
          onValueChange={(v) => setSearch({ priority: v === "_all" ? undefined : v })}
        >
          <SelectTrigger className="md:w-40"><SelectValue placeholder="Prioritet" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Alle prioriteter</SelectItem>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v: any) => setSearch({ sort: v })}>
          <SelectTrigger className="md:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Sist oppdatert</SelectItem>
            <SelectItem value="created">Opprettet</SelectItem>
            <SelectItem value="applied">Søknadsdato</SelectItem>
            <SelectItem value="company">Bedrift A–Å</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !rows.length ? (
        <EmptyState
          title="Ingen stillingsannonser ennå"
          description="Opprett din første søknad for å komme i gang."
          action={
            <Button asChild>
              <Link to="/applications/new"><Plus className="h-4 w-4 mr-2" /> Ny søknad</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Mobil: kort med hele kortet klikkbart */}
          <ul className="md:hidden divide-y rounded-md border bg-card">
            {rows.map((a) => (
              <li key={a.id} className="relative">
                <div className="absolute right-3 top-3 z-10">
                  <StarToggle
                    value={!!a.is_starred}
                    onChange={(v) => starMut.mutate({ id: a.id!, value: v })}
                  />
                </div>
                <Link
                  to="/applications/$id"
                  params={{ id: a.id! }}
                  className="block p-3 pr-12 active:bg-accent/40"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <UrgencyDot level={a.urgency_level} />
                    <span className="text-lg font-bold truncate">{a.company_name}</span>
                  </div>
                  {a.role_title && (
                    <div className="text-sm text-muted-foreground truncate mt-0.5">{a.role_title}</div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={a.status} />
                    <PriorityBadge priority={a.priority} />
                    {a.applied_date && (
                      <span className="text-xs text-muted-foreground">Søkt {fmtDate(a.applied_date)}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: tabell */}
          <div className="hidden md:block rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2 w-6"></th>
                  <th className="text-left px-3 py-2">Bedrift</th>
                  <th className="text-left px-3 py-2">Rolle</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Prioritet</th>
                  <th className="text-left px-3 py-2">Søkt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t hover:bg-accent/30 cursor-pointer"
                    onClick={() => navigate({ to: "/applications/$id", params: { id: a.id! } })}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <StarToggle
                        value={!!a.is_starred}
                        onChange={(v) => starMut.mutate({ id: a.id!, value: v })}
                      />
                    </td>
                    <td className="px-3 py-2"><UrgencyDot level={a.urgency_level} /></td>
                    <td className="px-3 py-2 text-base font-semibold">{a.company_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.role_title ?? "—"}</td>
                    <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                    <td className="px-3 py-2"><PriorityBadge priority={a.priority} /></td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(a.applied_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
