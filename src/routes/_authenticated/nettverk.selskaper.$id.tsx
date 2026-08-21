// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { BackLink } from "@/components/network/network-shell";
import { useAuthUserId } from "@/components/network/use-network-user";
import {
  buildCompanies,
  buildContacts,
  isCompanyIdKey,
  networkGraphQuery,
} from "@/lib/queries/network";
import { setCompanyRelationship } from "@/lib/network.functions";
import { PRIORITY_LABEL, STATUS_LABEL } from "./nettverk.selskaper.index";

export const Route = createFileRoute("/_authenticated/nettverk/selskaper/$id")({
  component: CompanyDetail,
});

const NONE = "__none__";

function CompanyDetail() {
  const { id } = Route.useParams();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();
  const { data: graph, isLoading } = useQuery(networkGraphQuery(userId));
  const save = useServerFn(setCompanyRelationship);

  const company = useMemo(
    () => (graph ? buildCompanies(graph).find((c) => c.key === id) ?? null : null),
    [graph, id],
  );
  const contacts = useMemo(() => {
    if (!graph || !company) return [];
    const target = company.name.trim().toLowerCase();
    const relContactIds = new Set(
      graph.relations
        .filter(
          (r) =>
            (company.companyId && r.company_id === company.companyId) ||
            (r.company_name_observed ?? "").trim().toLowerCase() === target,
        )
        .map((r) => r.network_contact_id),
    );
    return buildContacts(graph).filter(
      (c) => relContactIds.has(c.id) || (c.company ?? "").trim().toLowerCase() === target,
    );
  }, [graph, company]);
  const opportunities = useMemo(() => {
    if (!graph || !company) return [];
    const target = company.name.trim().toLowerCase();
    return graph.opportunities.filter(
      (o) => (o.card_company ?? "").trim().toLowerCase() === target,
    );
  }, [graph, company]);
  const steps = useMemo(() => {
    if (!graph || !company?.companyId) return [];
    return graph.steps.filter((s) => s.company_id === company.companyId);
  }, [graph, company]);

  const [status, setStatus] = useState<string>(NONE);
  const [priority, setPriority] = useState<string>(NONE);
  useEffect(() => {
    setStatus(company?.status ?? NONE);
    setPriority(company?.priority ?? NONE);
  }, [company?.key, company?.status, company?.priority]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!company?.companyId) throw new Error("Selskapet mangler oppføring i selskapsregisteret.");
      return save({
        data: {
          companyId: company.companyId,
          companyName: company.name,
          status: status === NONE ? null : status,
          priority: priority === NONE ? null : priority,
        },
      });
    },
    onSuccess: (result: any) => {
      if (!result?.ok) {
        toast.error(`Kunne ikke lagre (${result?.errorCode ?? "ukjent feil"}).`);
        return;
      }
      toast.success("Selskapsforholdet er oppdatert.");
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunne ikke lagre."),
  });

  if (isLoading) return <p className="p-2 text-sm text-muted-foreground">Laster selskap…</p>;
  if (!company) return <p className="p-2 text-sm text-muted-foreground">Fant ikke selskapet.</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-hidden">
      <div>
        <BackLink fallbackTo="/nettverk/selskaper" />
        <h2 className="text-lg font-semibold">{company.name}</h2>
        <p className="text-sm text-muted-foreground">
          {[company.industry, company.location].filter(Boolean).join(" · ") ||
            "Bransje og sted ikke registrert"}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3 md:grid-rows-2 md:overflow-hidden">
        <NetworkPanel title="Selskapsprofil">
          <dl className="space-y-1">
            <Row label="Navn" value={company.name} />
            <Row label="Bransje" value={company.industry} />
            <Row label="Sted" value={company.location} />
            <Row label="Kilder" value={company.sources.join(", ")} />
          </dl>
        </NetworkPanel>

        <NetworkPanel title="Ditt selskapsforhold">
          {!isCompanyIdKey(company.key) ? (
            <PanelEmpty>
              Selskapet er kjent gjennom navn fra dine kontakter eller muligheter. Status og
              prioritet kan settes når selskapet finnes i selskapsregisteret.
            </PanelEmpty>
          ) : (
            <div className="space-y-2">
              <LabeledSelect
                label="Status"
                value={status}
                onChange={setStatus}
                options={STATUS_LABEL}
              />
              <LabeledSelect
                label="Prioritet"
                value={priority}
                onChange={setPriority}
                options={PRIORITY_LABEL}
              />
              <Button
                size="sm"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                Lagre
              </Button>
              <p className="text-xs text-muted-foreground">
                Verdiene settes kun av deg og fylles aldri automatisk fra importerte data.
              </p>
            </div>
          )}
        </NetworkPanel>

        <NetworkPanel title="Arbeidsgiverinnsikt">
          <PanelEmpty>Ikke analysert for dette selskapet i denne flaten.</PanelEmpty>
        </NetworkPanel>

        <NetworkPanel title={`Dine kontakter i selskapet (${contacts.length})`}>
          {contacts.length === 0 ? (
            <PanelEmpty>Ingen kontakter knyttet til selskapet.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {contacts.map((c) => (
                <li key={c.id} className="py-1">
                  <Link
                    to="/nettverk/kontakter/$id"
                    params={{ id: c.id }}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {c.display_name}
                  </Link>
                  {c.headline ? (
                    <span className="text-muted-foreground"> · {c.headline}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel title={`Muligheter (${opportunities.length})`}>
          {opportunities.length === 0 ? (
            <PanelEmpty>Ingen muligheter registrert på selskapet.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {opportunities.map((o) => (
                <li key={o.id} className="py-1">
                  <span className="font-medium">{o.card_title ?? "Uten tittel"}</span>
                  {o.status ? (
                    <span className="text-muted-foreground"> · {o.status}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel title={`Aktiviteter og neste steg (${steps.length})`}>
          {steps.length === 0 ? (
            <PanelEmpty>Ingen aktiviteter registrert på selskapet.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {steps.map((s) => (
                <li key={s.id} className="flex gap-2 py-1">
                  <span className="tabular-nums text-muted-foreground">
                    {s.due_date ? new Date(s.due_date).toLocaleDateString("nb-NO") : "—"}
                  </span>
                  <span>{s.title}</span>
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>
      </div>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8">
          <SelectValue placeholder="Ikke satt" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Ikke satt</SelectItem>
          {Object.entries(options).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value || "Ikke registrert"}</dd>
    </div>
  );
}
