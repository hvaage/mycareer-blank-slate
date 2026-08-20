// ============================================================
// Kildegjennomgang — brukerens beslutning per avstemmingsforslag.
//
// Fase 3-kontrakt: siden viser kun forslag. Ingenting skrives til
// karriereoversikten herfra. Alle handlinger går gjennom
// linkedin_reconciliation_decide og gir én ny rad i beslutningsloggen.
// ============================================================
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Check, X, Clock, PencilLine, ShieldAlert } from "lucide-react";

type Proposal = {
  id: string;
  proposal_domain: string;
  proposal_kind: string;
  status: string;
  confidence: number;
  match_method: string;
  source_snapshot_json: Record<string, unknown> | null;
  target_snapshot_json: Record<string, unknown> | null;
  comparison_json: Record<string, unknown> | null;
  reason_codes: string[] | null;
  review_message: string | null;
  linkedin_import_id: string;
};

const DOMAIN_LABELS: Record<string, string> = {
  profile: "Profil",
  career: "Erfaring og kvalifikasjoner",
  network: "Nettverk",
  jobs: "Jobbsignaler",
  learning: "Kurs",
  content: "Innhold",
  recommendations: "Anbefalinger",
  endorsements: "Attesteringer fra andre",
};

const KIND_LABELS: Record<string, string> = {
  create: "Ny",
  possible_update: "Mulig oppdatering",
  possible_duplicate: "Mulig dublett",
  conflict: "Motstrid",
  keep_existing: "Finnes allerede",
  deferred: "Utsatt",
  not_actionable_in_phase_3: "Kun kontekst",
};

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Til gjennomgang",
  approved_for_promotion: "Godkjent for overføring",
  dismissed: "Avvist",
  deferred_by_user: "Utsatt",
  needs_resolution: "Trenger manuell retting",
  superseded: "Erstattet",
  stale_source: "Kildegrunnlaget er slettet",
  stale_target: "Grunnlaget er endret",
};

export const Route = createFileRoute("/_authenticated/kildegjennomgang")({
  validateSearch: (search: Record<string, unknown>) => ({
    source: typeof search["source"] === "string" ? (search["source"] as string) : "linkedin",
    import: typeof search["import"] === "string" ? (search["import"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Kildegjennomgang | Karrieren min" },
      {
        name: "description",
        content:
          "Gå gjennom hva LinkedIn-eksporten foreslår å tilføre eller endre, sammenlign mot det du allerede har, og bestem selv per forslag.",
      },
      { property: "og:title", content: "Kildegjennomgang | Karrieren min" },
      {
        property: "og:description",
        content: "Sammenlign forslag fra LinkedIn mot din egen karriereoversikt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KildegjennomgangPage,
});

function KildegjennomgangPage() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const [activeDomain, setActiveDomain] = useState<string | null>(null);

  const proposalsQuery = useQuery({
    queryKey: ["linkedin-reconciliation-proposals", user?.id, search.import],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      let query = supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("linkedin_reconciliation_proposals" as any)
        .select(
          "id, proposal_domain, proposal_kind, status, confidence, match_method, source_snapshot_json, target_snapshot_json, comparison_json, reason_codes, review_message, linkedin_import_id",
        )
        .order("proposal_domain", { ascending: true })
        .order("created_at", { ascending: true });
      if (search.import) query = query.eq("linkedin_import_id", search.import);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Proposal[];
    },
  });

  const decide = useMutation({
    mutationFn: async (input: {
      proposalId: string;
      decision: string;
      reasonCode?: string | null;
    }) => {
      const { data, error } = await supabase.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "linkedin_reconciliation_decide" as any,
        {
          p_proposal_id: input.proposalId,
          p_decision: input.decision,
          p_reason_code: input.reasonCode ?? null,
          p_note: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      if (error) throw error;
      const result = data as unknown as { ok: boolean; error?: string };
      if (!result?.ok) throw new Error(result?.error ?? "ukjent_feil");
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-reconciliation-proposals"] });
    },
    onError: (error: Error) => {
      toast.error(
        error.message === "proposal_not_actionable"
          ? "Forslaget kan ikke besluttes lenger. Kjør en ny avstemming."
          : "Klarte ikke å lagre beslutningen.",
      );
    },
  });

  const proposals = proposalsQuery.data ?? [];
  const domains = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of proposals) {
      set.set(p.proposal_domain, (set.get(p.proposal_domain) ?? 0) + 1);
    }
    return [...set.entries()];
  }, [proposals]);

  const currentDomain = activeDomain ?? domains[0]?.[0] ?? null;
  const pendingCount = proposals.filter((p) => p.status === "pending_review").length;

  if (proposalsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Kildegjennomgang</h1>
        <p className="text-muted-foreground">
          Her ser du hva LinkedIn-eksporten foreslår, sammenlignet med det du allerede har. Ingenting
          overføres til karriereoversikten før du har bestemt deg — og aldri automatisk.
        </p>
      </header>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Forslag, ikke fakta</AlertTitle>
        <AlertDescription>
          LinkedIn-innhold er kildegrunnlag. Det blir aldri bekreftet av seg selv, og uttalelser fra
          andre kan aldri belegge dine egne påstander.
        </AlertDescription>
      </Alert>

      {proposals.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ingen forslag ennå</CardTitle>
            <CardDescription>
              Når en LinkedIn-eksport er importert og avstemt, dukker forslagene opp her.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/kilder">Gå til Legg til kilder</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {pendingCount} av {proposals.length} forslag venter på din beslutning.
          </p>
          <Tabs value={currentDomain ?? undefined} onValueChange={setActiveDomain}>
            <TabsList className="flex-wrap">
              {domains.map(([domain, count]) => (
                <TabsTrigger key={domain} value={domain}>
                  {DOMAIN_LABELS[domain] ?? domain} ({count})
                </TabsTrigger>
              ))}
            </TabsList>
            {domains.map(([domain]) => (
              <TabsContent key={domain} value={domain} className="space-y-3 pt-4">
                {proposals
                  .filter((p) => p.proposal_domain === domain)
                  .map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      busy={decide.isPending}
                      onDecide={(decision, reasonCode) =>
                        decide.mutate({ proposalId: proposal.id, decision, reasonCode })
                      }
                    />
                  ))}
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  busy,
  onDecide,
}: {
  proposal: Proposal;
  busy: boolean;
  onDecide: (decision: string, reasonCode?: string | null) => void;
}) {
  const source = proposal.source_snapshot_json ?? {};
  const target = proposal.target_snapshot_json;
  const decided = proposal.status !== "pending_review";
  const locked = ["stale_source", "stale_target", "superseded"].includes(proposal.status);
  const contextOnly = proposal.proposal_kind === "not_actionable_in_phase_3";

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={proposal.proposal_kind === "conflict" ? "destructive" : "secondary"}>
            {KIND_LABELS[proposal.proposal_kind] ?? proposal.proposal_kind}
          </Badge>
          {decided && <Badge variant="outline">{STATUS_LABELS[proposal.status] ?? proposal.status}</Badge>}
          <span className="text-xs text-muted-foreground">
            Sikkerhet {Math.round(Number(proposal.confidence) * 100)} %
          </span>
        </div>
        <CardTitle className="text-base font-medium">
          {proposal.review_message ?? "Forslag fra LinkedIn"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SnapshotBlock title="Fra LinkedIn" data={source} />
          <SnapshotBlock title="Det du har i dag" data={target} emptyLabel="Ingenting registrert" />
        </div>

        {locked ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              {STATUS_LABELS[proposal.status]}. Kjør en ny avstemming for å få et gyldig forslag.
            </AlertDescription>
          </Alert>
        ) : contextOnly ? (
          <p className="text-sm text-muted-foreground">
            Dette forslaget endrer ingenting i karriereoversikten. Du kan avvise det for å skjule det.
          </p>
        ) : null}

        {!locked && (
          <div className="flex flex-wrap gap-2">
            {!contextOnly && (
              <Button size="sm" disabled={busy} onClick={() => onDecide("approve_for_promotion")}>
                <Check className="mr-1 h-4 w-4" /> Godkjenn for overføring
              </Button>
            )}
            {target && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDecide("dismiss", "keep_existing")}
              >
                Behold det jeg har
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide("dismiss", "not_relevant")}>
              <X className="mr-1 h-4 w-4" /> Avvis
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("defer")}>
              <Clock className="mr-1 h-4 w-4" /> Utsett
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("request_manual_edit")}>
              <PencilLine className="mr-1 h-4 w-4" /> Rett manuelt senere
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SnapshotBlock({
  title,
  data,
  emptyLabel = "—",
}: {
  title: string;
  data: Record<string, unknown> | null;
  emptyLabel?: string;
}) {
  const entries = Object.entries(data ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <dl className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2 text-sm">
              <dt className="min-w-24 shrink-0 text-muted-foreground">{key}</dt>
              <dd className="break-words">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
