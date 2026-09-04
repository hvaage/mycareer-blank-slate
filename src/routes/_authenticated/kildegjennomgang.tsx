// ============================================================
// Kildegjennomgang — brukerens beslutning per avstemmingsforslag,
// og (Fase 4) eksplisitt promotering av godkjente forslag.
//
// Ingenting promoteres automatisk. «Behold det jeg har» og «Rett manuelt
// senere» går gjennom beslutningslaget og gir aldri en promotering.
// ============================================================
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Info, Check, X, Clock, PencilLine, ShieldAlert, ArrowRight } from "lucide-react";
import { ExternalUrlLink, isExternalUrl } from "@/components/external-url-link";
import {
  BulkReviewList,
  type BulkItem,
  type BulkOutcome,
} from "@/components/kildegjennomgang/bulk-review";
import {
  ALREADY_REGISTERED_CODE,
  PROMOTION_BUTTON_LABELS,
  promoteProposal,
  promotionActionForDomain,
  reopenFailedProposal,
  type PromotionAction,
  type PromotionResolution,
} from "@/lib/linkedin/promotion";

/** Alle nye forslag med en kjent promoteringsport kan behandles samlet. */
function bulkActionable(items: Proposal[]): Proposal[] {
  return items.filter(
    (p) =>
      p.proposal_kind === "create" &&
      (p.status === "pending_review" ||
        p.status === "approved_for_promotion" ||
        p.status === "promotion_failed") &&
      Boolean(promotionActionForDomain(p.proposal_domain, p.proposal_kind, proposalAtomType(p))),
  );
}

function proposalAtomType(proposal: Proposal): string | null {
  const payload = (proposal.proposed_payload_json ?? {}) as Record<string, unknown>;
  const value = payload["atom_type"] ?? payload["qualification_kind"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function proposalLabel(proposal: Proposal): string {
  const payload = (proposal.proposed_payload_json ?? {}) as Record<string, unknown>;
  const source = (proposal.source_snapshot_json ?? {}) as Record<string, unknown>;
  for (const value of [
    payload["label"],
    payload["title"],
    payload["name"],
    source["label"],
    source["title"],
    source["name"],
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return proposal.review_message ?? "Forslag fra LinkedIn";
}

function toBulkItem(proposal: Proposal): BulkItem {
  return {
    id: proposal.id,
    label: proposalLabel(proposal),
    atomType: proposalAtomType(proposal),
    status: proposal.status,
    proposalKind: proposal.proposal_kind,
    details: proposal.source_snapshot_json,
  };
}


type Proposal = {
  id: string;
  proposal_domain: string;
  proposal_kind: string;
  status: string;
  confidence: number;
  match_method: string;
  source_snapshot_json: Record<string, unknown> | null;
  target_snapshot_json: Record<string, unknown> | null;
  proposed_payload_json: Record<string, unknown> | null;
  comparison_json: Record<string, unknown> | null;
  reason_codes: string[] | null;
  review_message: string | null;
  linkedin_import_id: string;
};

const PROFILE_FIELD_LABELS: Record<string, string> = {
  headline: "Overskrift",
  summary: "Sammendrag",
  location: "Sted",
  industry: "Bransje",
  public_profile_url: "LinkedIn-adresse",
  languages: "Språk",
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
  promoted: "Lagt til",
  promotion_failed: "Overføringen feilet",
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
          "id, proposal_domain, proposal_kind, status, confidence, match_method, source_snapshot_json, target_snapshot_json, proposed_payload_json, comparison_json, reason_codes, review_message, linkedin_import_id",
        )
        .order("proposal_domain", { ascending: true })
        .order("created_at", { ascending: true });
      query = query.eq("user_id", user?.id ?? "");
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
      queryClient.invalidateQueries({ queryKey: ["review-inbox-counts"] });
      queryClient.invalidateQueries({ queryKey: ["profile-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-foundation"] });
    },
    onError: (error: Error) => {
      toast.error(
        error.message === "proposal_not_actionable"
          ? "Forslaget kan ikke besluttes lenger. Kjør en ny avstemming."
          : "Klarte ikke å lagre beslutningen.",
      );
    },
  });

  const [pendingPromotion, setPendingPromotion] = useState<{
    proposal: Proposal;
    action: PromotionAction;
  } | null>(null);

  const promote = useMutation({
    mutationFn: async (input: {
      proposalId: string;
      action: PromotionAction;
      resolution: PromotionResolution;
      field?: string;
    }) => promoteProposal(input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-reconciliation-proposals"] });
      if (result.ok) {
        setPendingPromotion(null);
        toast.success("Lagt til. Kilden er sporet i revisjonsloggen.");
      } else {
        toast.error(result.message, {
          description: result.retryable
            ? "Forslaget står fortsatt som godkjent, så du kan prøve igjen."
            : "Forslaget er markert som feilet. Åpne det på nytt for å avstemme igjen.",
        });
      }
    },
    onError: () => toast.error("Klarte ikke å gjennomføre overføringen."),
  });

  const reopen = useMutation({
    mutationFn: async (proposalId: string) => reopenFailedProposal(proposalId),
    onSuccess: (ok) => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-reconciliation-proposals"] });
      if (ok) toast.success("Forslaget er åpnet for ny beslutning.");
      else toast.error("Klarte ikke å åpne forslaget på nytt.");
    },
  });

  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkOutcome | null>(null);

  // Massehandling kjøres forslag for forslag. Feil i ett forslag stopper aldri
  // de andre, og ingenting skrives uten at forslaget først er godkjent.
  const bulkRun = useMutation({
    mutationFn: async (ids: string[]) => {
      const all = proposalsQuery.data ?? [];
      const outcome: BulkOutcome = {
        promoted: 0,
        alreadyRegistered: 0,
        dismissed: 0,
        deferred: 0,
        failed: 0,
      };
      setBulkOutcome(null);
      setBulkProgress({ done: 0, total: ids.length });

      for (const [index, id] of ids.entries()) {
        const proposal = all.find((p) => p.id === id);
        try {
          if (!proposal) {
            outcome.failed += 1;
            continue;
          }
          const action = promotionActionForDomain(
            proposal.proposal_domain,
            proposal.proposal_kind,
            proposalAtomType(proposal),
          );
          if (!action) {
            outcome.failed += 1;
            continue;
          }
          // Tidligere feilede forslag åpnes teknisk på nytt før de godkjennes
          // og overføres, slik at brukeren slipper å vurdere dem om igjen.
          if (proposal.status === "promotion_failed") {
            const reopened = await reopenFailedProposal(id);
            if (!reopened) {
              outcome.failed += 1;
              continue;
            }
          }
          if (proposal.status !== "approved_for_promotion") {
            const { data, error } = await supabase.rpc(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              "linkedin_reconciliation_decide" as any,
              {
                p_proposal_id: id,
                p_decision: "approve_for_promotion",
                p_reason_code: null,
                p_note: null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
            );
            if (error || !(data as unknown as { ok?: boolean } | null)?.ok) {
              outcome.failed += 1;
              continue;
            }
          }
          const result = await promoteProposal({ proposalId: id, action, resolution: "create_new" });
           if (result.ok && result.alreadyRegistered) outcome.alreadyRegistered += 1;
           else if (result.ok) outcome.promoted += 1;
          else if (result.errorCode === ALREADY_REGISTERED_CODE) outcome.alreadyRegistered += 1;
          else outcome.failed += 1;
        } catch {
          outcome.failed += 1;
        } finally {
          setBulkProgress({ done: index + 1, total: ids.length });
        }
      }
      return outcome;
    },
    onSuccess: (outcome) => {
      setBulkOutcome(outcome);
      setBulkProgress(null);
      queryClient.invalidateQueries({ queryKey: ["linkedin-reconciliation-proposals"] });
      toast.success(
        `Overført ${outcome.promoted}. Allerede registrert ${outcome.alreadyRegistered}. Feilet ${outcome.failed}.`,
      );
    },
    onError: () => {
      setBulkProgress(null);
      toast.error("Massehandlingen ble avbrutt. Ingenting mer ble overført.");
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
  const pendingCount = proposals.filter((p) => ["pending_review", "approved_for_promotion", "promotion_failed"].includes(p.status)).length;

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
             {pendingCount} av {proposals.length} forslag krever handling.
          </p>
          <Tabs value={currentDomain ?? undefined} onValueChange={setActiveDomain}>
            <TabsList className="flex-wrap">
              {domains.map(([domain, count]) => (
                <TabsTrigger key={domain} value={domain}>
                  {DOMAIN_LABELS[domain] ?? domain} ({count})
                </TabsTrigger>
              ))}
            </TabsList>
            {domains.map(([domain]) => {
              const inDomain = proposals.filter((p) => p.proposal_domain === domain);
              const actionable = bulkActionable(inDomain);
              const bulkIds = new Set(actionable.map((p) => p.id));
              return (
                <TabsContent key={domain} value={domain} className="space-y-3 pt-4">
                  {bulkIds.size > 0 && (
                    <BulkReviewList
                       actionable={actionable.map(toBulkItem)}
                      alreadyRegistered={inDomain
                        .filter((p) => p.status === "promoted" || p.proposal_kind === "keep_existing")
                        .map(toBulkItem)}
                      conflicts={inDomain
                        .filter(
                          (p) =>
                            p.proposal_kind === "conflict" || p.proposal_kind === "possible_duplicate",
                        )
                        .map(toBulkItem)}
                      dismissed={inDomain.filter((p) => p.status === "dismissed").map(toBulkItem)}
                      failed={inDomain
                        .filter((p) => p.status === "promotion_failed" && !bulkIds.has(p.id))
                        .map(toBulkItem)}
                      busy={bulkRun.isPending}
                      progress={bulkProgress}
                      outcome={bulkOutcome}
                      onSubmit={(ids) => bulkRun.mutate(ids)}
                    />
                  )}
                  {inDomain
                    .filter((p) => !bulkIds.has(p.id))
                    .map((proposal) => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        busy={decide.isPending || promote.isPending || bulkRun.isPending}
                        onDecide={(decision, reasonCode) =>
                          decide.mutate({ proposalId: proposal.id, decision, reasonCode })
                        }
                        onStartPromotion={(action) => setPendingPromotion({ proposal, action })}
                        onReopen={() => reopen.mutate(proposal.id)}
                      />
                    ))}
                </TabsContent>
              );
            })}

          </Tabs>
        </>
      )}

      <PromotionDialog
        pending={pendingPromotion}
        busy={promote.isPending}
        onClose={() => setPendingPromotion(null)}
        onConfirm={(resolution, field) => {
          if (!pendingPromotion) return;
          promote.mutate({
            proposalId: pendingPromotion.proposal.id,
            action: pendingPromotion.action,
            resolution,
            ...(field ? { field } : {}),
          });
        }}
        onKeepExisting={() => {
          if (!pendingPromotion) return;
          decide.mutate({ proposalId: pendingPromotion.proposal.id, decision: "dismiss", reasonCode: "keep_existing" });
          setPendingPromotion(null);
        }}
        onManualEdit={() => {
          if (!pendingPromotion) return;
          decide.mutate({ proposalId: pendingPromotion.proposal.id, decision: "request_manual_edit" });
          setPendingPromotion(null);
        }}
      />
    </div>
  );
}

function PromotionDialog({
  pending,
  busy,
  onClose,
  onConfirm,
  onKeepExisting,
  onManualEdit,
}: {
  pending: { proposal: Proposal; action: PromotionAction } | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (resolution: PromotionResolution, field?: string) => void;
  onKeepExisting: () => void;
  onManualEdit: () => void;
}) {
  const proposal = pending?.proposal ?? null;
  const action = pending?.action ?? null;
  const payload = (proposal?.proposed_payload_json ?? {}) as Record<string, unknown>;
  const field =
    action === "promote_profile_field"
      ? String(payload["field"] ?? (proposal?.comparison_json?.["field"] as string) ?? "headline")
      : undefined;
  const hasTarget = Boolean(proposal?.target_snapshot_json);

  return (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        {proposal && action && (
          <>
            <DialogHeader>
              <DialogTitle>{PROMOTION_BUTTON_LABELS[action]}</DialogTitle>
              <DialogDescription>
                {proposal.review_message ?? "Dette legges til fra LinkedIn-eksporten."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              {field && (
                <p>
                  Felt: <strong>{PROFILE_FIELD_LABELS[field] ?? field}</strong>
                </p>
              )}
              <SnapshotBlock title="Dette legges inn" data={proposal.source_snapshot_json} />
              {hasTarget && (
                <SnapshotBlock title="Det du har i dag" data={proposal.target_snapshot_json} />
              )}
              <p className="text-muted-foreground">
                Kilden merkes som LinkedIn-eksport. Ingenting annet endres, og ingenting blir regnet
                som bekreftet.
              </p>
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:justify-start">
              <Button disabled={busy} onClick={() => onConfirm(hasTarget && field ? "use_linkedin_value" : "create_new", field)}>
                <Check className="mr-1 h-4 w-4" />
                {hasTarget && field ? "Bruk LinkedIn-verdien" : "Bekreft og legg til"}
              </Button>
              {hasTarget && (
                <Button variant="outline" disabled={busy} onClick={onKeepExisting}>
                  Behold det jeg har
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={onManualEdit}>
                <PencilLine className="mr-1 h-4 w-4" /> Rett manuelt senere
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProposalCard({
  proposal,
  busy,
  onDecide,
  onStartPromotion,
  onReopen,
}: {
  proposal: Proposal;
  busy: boolean;
  onDecide: (decision: string, reasonCode?: string | null) => void;
  onStartPromotion: (action: PromotionAction) => void;
  onReopen: () => void;
}) {
  const source = proposal.source_snapshot_json ?? {};
  const target = proposal.target_snapshot_json;
  const decided = proposal.status !== "pending_review";
  const locked = ["stale_source", "stale_target", "superseded"].includes(proposal.status);
  const contextOnly = proposal.proposal_kind === "not_actionable_in_phase_3";
  const promotionAction = promotionActionForDomain(
    proposal.proposal_domain,
    proposal.proposal_kind,
    proposalAtomType(proposal),
  );

  const approved = proposal.status === "approved_for_promotion";
  const promoted = proposal.status === "promoted";
  const failed = proposal.status === "promotion_failed";


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

        {promoted && (
          <Alert>
            <Check className="h-4 w-4" />
            <AlertDescription>
              Lagt til fra LinkedIn. Kilden er sporet, og innholdet er ikke regnet som bekreftet.
            </AlertDescription>
          </Alert>
        )}

        {failed && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <span>
                Overføringen ble ikke gjennomført. Tidligere beslutning er beholdt. Åpne forslaget på
                nytt for å avstemme det igjen.
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={onReopen}>
                Åpne på nytt
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {approved && promotionAction && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onStartPromotion(promotionAction)}>
              <ArrowRight className="mr-1 h-4 w-4" /> {PROMOTION_BUTTON_LABELS[promotionAction]}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("dismiss", "keep_existing")}>
              Behold det jeg har
            </Button>
          </div>
        )}

        {approved && !promotionAction && (
          <p className="text-sm text-muted-foreground">
            Dette forslaget kan ikke overføres ennå (kun kontekst). Det står som godkjent.
          </p>
        )}

        {!locked && !promoted && !failed && !approved && (
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
              <dd className="break-words">
                {isExternalUrl(value) ? (
                  <ExternalUrlLink href={String(value).trim()}>{String(value)}</ExternalUrlLink>
                ) : (
                  String(value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
