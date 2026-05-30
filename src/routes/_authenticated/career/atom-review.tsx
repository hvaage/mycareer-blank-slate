import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ClipboardList, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  approveAtomEnrichmentProposal,
  atomEnrichmentBatchesQuery,
  atomEnrichmentProposalsByStatusQuery,
  bulkApproveAtomEnrichmentProposals,
  bulkMarkAtomEnrichmentProposalsNeedsContext,
  bulkRejectAtomEnrichmentProposals,
  bulkReopenAtomEnrichmentProposalsToPending,
  insertLocalDevSamplePendingProposal,
  invalidateAtomEnrichmentQueries,
  markAtomEnrichmentProposalNeedsContext,
  pendingAtomEnrichmentProposalsQuery,
  proposalApprovalWritesAtoms,
  rejectAtomEnrichmentProposal,
  reopenAtomEnrichmentProposalToPending,
  type AtomEnrichmentProposalRow,
} from "@/lib/queries/atom-enrichment";
import { generateAtomEnrichmentProposals } from "@/lib/queries/atom-proposal-generation";
import { invalidateUserAtomQueries } from "@/lib/queries/career-atoms";
import {
  getProposalConfidenceLabel,
  getProposalImpactText,
  getProposalSourceLabel,
  getProposalStatusLabel,
  getProposalSummary,
  getProposalTechnicalMetaLines,
  getProposalTechnicalPayloadJson,
  getProposalTitle,
  getProposalWhySuggested,
  isDevSeedProposal,
} from "@/lib/atom-review-proposal-copy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/career/atom-review")({
  component: AtomReviewPage,
});

type ReviewTab = "pending" | "needs_more_context" | "approved" | "rejected";

function batchSourceUserLabel(sourceType: string | null | undefined): string {
  if (sourceType === "deterministic_module_5_1") return "Regelbasert forslag";
  if (sourceType === "dev_seed") return "Test (kun utvikling)";
  if (!sourceType) return "Ukjent opphav";
  return "Importert eller lagret kilde";
}

function filterProposalList(
  rows: AtomEnrichmentProposalRow[],
  opts: { showDevSamples: boolean },
): AtomEnrichmentProposalRow[] {
  if (opts.showDevSamples) return rows;
  return rows.filter((p) => !isDevSeedProposal(p));
}

type ProposalCardMode = "pending" | "needs" | "readonly";

function ProposalCard(props: {
  p: AtomEnrichmentProposalRow;
  busy: boolean;
  commentFor: string;
  onComment: (id: string, v: string) => void;
  mode: ProposalCardMode;
  showCheckbox: boolean;
  selected: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  onApprove: () => void;
  onNeeds?: () => void;
  onReject: () => void;
  onReopen?: () => void;
}) {
  const {
    p,
    busy,
    commentFor,
    onComment,
    mode,
    showCheckbox,
    selected,
    onToggleSelected,
    onApprove,
    onNeeds,
    onReject,
    onReopen,
  } = props;
  const confidenceLine = getProposalConfidenceLabel(p.confidence);
  const testBadge = isDevSeedProposal(p) ? (
    <Badge variant="destructive" className="text-xs">
      Testforslag
    </Badge>
  ) : null;

  const showActions = mode === "pending" || mode === "needs";

  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        {showCheckbox && (
          <Checkbox
            checked={selected}
            disabled={busy}
            onCheckedChange={(c) => onToggleSelected(p.id, c === true)}
            aria-label="Velg forslag"
            className="mt-1"
          />
        )}
        <div className="space-y-1 min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug">{getProposalTitle(p)}</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{getProposalStatusLabel(p.status)}</span>
            {p.inferred ? (
              <span className="rounded-full bg-muted px-2 py-0.5">Automatisk tolkning</span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5">Direkte fra kilde</span>
            )}
            {testBadge}
          </div>
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Hva foreslås
          </p>
          <p className="leading-relaxed">{getProposalSummary(p)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Hvorfor du ser dette
          </p>
          <p className="leading-relaxed text-muted-foreground">{getProposalWhySuggested(p)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Dette skjer hvis du godkjenner
          </p>
          <p className="leading-relaxed">{getProposalImpactText(p)}</p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1 border-t border-border/60 pt-3">
        <p>
          <span className="font-medium text-foreground">Kilde: </span>
          {getProposalSourceLabel(p)}
        </p>
        <p>
          <span className="font-medium text-foreground">Opprettet: </span>
          {fmtDateTime(p.created_at)}
        </p>
        {confidenceLine && <p>{confidenceLine}</p>}
      </div>

      {import.meta.env.DEV && (
        <Collapsible className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/20">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-muted/40">
            Tekniske detaljer
            <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-2 text-xs">
            <pre className="whitespace-pre-wrap rounded bg-muted/60 p-2 text-[11px] leading-relaxed">
              {getProposalTechnicalMetaLines(p).join("\n")}
            </pre>
            <p className="font-medium text-muted-foreground">Rå innhold (lagringsformat)</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2 text-[11px]">
              {getProposalTechnicalPayloadJson(p)}
            </pre>
            {p.existing_atom_snapshot != null && (
              <>
                <p className="font-medium text-muted-foreground">Tidligere lagret verdi (rådata)</p>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">
                  {(() => {
                    try {
                      return JSON.stringify(p.existing_atom_snapshot, null, 2);
                    } catch {
                      return String(p.existing_atom_snapshot);
                    }
                  })()}
                </pre>
              </>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {showActions && (
        <>
          <div className="space-y-2">
            <Label htmlFor={`c-${p.id}`} className="text-xs">
              Kommentar til beslutning (valgfritt)
            </Label>
            <Textarea
              id={`c-${p.id}`}
              rows={2}
              className="text-sm"
              value={commentFor}
              onChange={(e) => onComment(p.id, e.target.value)}
              placeholder="F.eks. hvorfor du avviser eller hva som mangler…"
            />
          </div>
          <Separator />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={onApprove}>
              Godkjenn
            </Button>
            {mode === "pending" && onNeeds && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onNeeds}>
                Trenger mer kontekst
              </Button>
            )}
            {mode === "needs" && onReopen && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReopen}>
                Tilbake til avventer
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={onReject}
            >
              Avvis
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function emptyCopy(t: ReviewTab): { title: string; description: string } {
  if (t === "pending") {
    return {
      title: "Ingen forslag som avventer vurdering",
      description:
        "Trykk «Generer forslag» for å hente regelbaserte forslag. Eksplisitte profilfelt og dokumenter struktureres automatisk når det er trygt — køen viser særlig tolkninger, avklaringer og mangler.",
    };
  }
  if (t === "needs_more_context") {
    return {
      title: "Ingen forslag her ennå",
      description:
        "Når du merker et forslag som trenger mer kontekst, dukker det opp her. Du kan flytte det tilbake til «Avventer», godkjenne eller avvise når som helst.",
    };
  }
  if (t === "approved") {
    return {
      title: "Ingen godkjente forslag i oversikten",
      description: "Nylig godkjente forslag vises her.",
    };
  }
  return {
    title: "Ingen avviste forslag i oversikten",
    description: "Avviste forslag vises her en stund for sporbarhet.",
  };
}

function AtomReviewPage() {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const qc = useQueryClient();
  const [commentById, setCommentById] = useState<Record<string, string>>({});
  const [bulkComment, setBulkComment] = useState("");
  const [tab, setTab] = useState<ReviewTab>("pending");
  const [showDevSamples, setShowDevSamples] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const pendingQ = useQuery({ ...pendingAtomEnrichmentProposalsQuery(uid), enabled: !!uid });
  const needsQ = useQuery({
    ...atomEnrichmentProposalsByStatusQuery(uid, "needs_more_context"),
    enabled: !!uid,
  });
  const approvedQ = useQuery({
    ...atomEnrichmentProposalsByStatusQuery(uid, "approved"),
    enabled: !!uid,
  });
  const rejectedQ = useQuery({
    ...atomEnrichmentProposalsByStatusQuery(uid, "rejected"),
    enabled: !!uid,
  });
  const batchesQ = useQuery({ ...atomEnrichmentBatchesQuery(uid), enabled: !!uid });

  const commentFor = (id: string) => commentById[id] ?? "";

  const onSettled = () => {
    invalidateAtomEnrichmentQueries(qc, uid);
    invalidateUserAtomQueries(qc, uid);
  };

  useEffect(() => {
    setSelected(new Set());
  }, [tab]);

  const approveM = useMutation({
    mutationFn: async (p: AtomEnrichmentProposalRow) => {
      await approveAtomEnrichmentProposal(uid, p.id, { reviewerComment: commentFor(p.id) });
    },
    onSuccess: (_void, p) => {
      toast.success(
        proposalApprovalWritesAtoms(p)
          ? "Forslag godkjent og lagt inn i karriereprofilen."
          : "Forslag godkjent. Karriereprofilen ble ikke endret automatisk for denne typen forslag.",
      );
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Godkjenning feilet"),
  });

  const rejectM = useMutation({
    mutationFn: async (p: AtomEnrichmentProposalRow) => {
      await rejectAtomEnrichmentProposal(uid, p.id, commentFor(p.id));
    },
    onSuccess: () => {
      toast.message("Forslaget er avvist.");
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Avvisning feilet"),
  });

  const needsM = useMutation({
    mutationFn: async (p: AtomEnrichmentProposalRow) => {
      await markAtomEnrichmentProposalNeedsContext(uid, p.id, commentFor(p.id));
    },
    onSuccess: () => {
      toast.success("Forslaget er flyttet til «Trenger mer kontekst».");
      setTab("needs_more_context");
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke oppdatere status"),
  });

  const reopenM = useMutation({
    mutationFn: async (p: AtomEnrichmentProposalRow) => {
      await reopenAtomEnrichmentProposalToPending(uid, p.id);
    },
    onSuccess: () => {
      toast.success("Forslaget er flyttet tilbake til «Avventer».");
      setTab("pending");
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke oppdatere status"),
  });

  const bulkApproveM = useMutation({
    mutationFn: (ids: string[]) =>
      bulkApproveAtomEnrichmentProposals(uid, ids, {
        reviewerComment: bulkComment.trim() || undefined,
      }),
    onSuccess: (r) => {
      if (r.failed.length) {
        toast.warning(`Godkjente ${r.ok} av ${r.ok + r.failed.length}. Noen feilet.`, {
          description: r.failed.map((f) => f.message).join(" · "),
        });
      } else {
        toast.success(`Godkjente ${r.ok} forslag.`);
      }
      setSelected(new Set());
      setBulkComment("");
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Masse-godkjenning feilet"),
  });

  const bulkRejectM = useMutation({
    mutationFn: (ids: string[]) =>
      bulkRejectAtomEnrichmentProposals(uid, ids, bulkComment.trim() || undefined),
    onSuccess: (r) => {
      if (r.failed.length) {
        toast.warning(`Avviste ${r.ok} av ${r.ok + r.failed.length}. Noen feilet.`, {
          description: r.failed.map((f) => f.message).join(" · "),
        });
      } else {
        toast.success(`Avviste ${r.ok} forslag.`);
      }
      setSelected(new Set());
      setBulkComment("");
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Masse-avvisning feilet"),
  });

  const bulkNeedsM = useMutation({
    mutationFn: (ids: string[]) =>
      bulkMarkAtomEnrichmentProposalsNeedsContext(uid, ids, bulkComment.trim() || undefined),
    onSuccess: (r) => {
      if (r.failed.length) {
        toast.warning(`Oppdaterte ${r.ok} av ${r.ok + r.failed.length}. Noen feilet.`, {
          description: r.failed.map((f) => f.message).join(" · "),
        });
      } else {
        toast.success(`Flyttet ${r.ok} forslag til «Trenger mer kontekst».`);
      }
      setSelected(new Set());
      setBulkComment("");
      setTab("needs_more_context");
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke oppdatere forslag"),
  });

  const bulkReopenM = useMutation({
    mutationFn: (ids: string[]) => bulkReopenAtomEnrichmentProposalsToPending(uid, ids),
    onSuccess: (r) => {
      if (r.failed.length) {
        toast.warning(`Flyttet ${r.ok} av ${r.ok + r.failed.length} tilbake. Noen feilet.`, {
          description: r.failed.map((f) => f.message).join(" · "),
        });
      } else {
        toast.success(`Flyttet ${r.ok} forslag tilbake til «Avventer».`);
      }
      setSelected(new Set());
      setTab("pending");
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke oppdatere forslag"),
  });

  const seedM = useMutation({
    mutationFn: async () => {
      const r = await insertLocalDevSamplePendingProposal(uid);
      if (!r) throw new Error("Kun tilgjengelig i utviklingsbygg.");
      return r;
    },
    onSuccess: () => {
      toast.success("Testforslag opprettet (kun utvikling).");
      setShowDevSamples(true);
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke opprette eksempel"),
  });

  const generateM = useMutation({
    mutationFn: () => generateAtomEnrichmentProposals(),
    onSuccess: (r) => {
      const auto =
        r.preferencesAutoStructured + r.evidenceAutoStructured > 0
          ? ` ${r.preferencesAutoStructured} preferanser og ${r.evidenceAutoStructured} erfaringer ble strukturert automatisk.`
          : "";
      if (r.proposalsInserted > 0) {
        const dup =
          r.proposalsSkippedDuplicate > 0
            ? ` ${r.proposalsSkippedDuplicate} lignende forslag var allerede i køen eller nylig avvist.`
            : "";
        toast.success(
          `${r.proposalsInserted} nye profilforslag er klare til gjennomgang.${dup}${auto}`,
        );
      } else if (r.proposalsSkippedDuplicate > 0) {
        toast.message(
          `Ingen nye forslag — ${r.proposalsSkippedDuplicate} lignende forslag ventet allerede eller var nylig avvist.${auto}`,
        );
      } else {
        toast.message(
          `Ingen nye forslag i køen akkurat nå.${auto} Oppdater karriereprofil eller dokumenter og prøv igjen.`,
        );
      }
      onSettled();
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke generere forslag"),
  });

  const includeDevSamples = import.meta.env.DEV && showDevSamples;

  const pendingFiltered = useMemo(
    () => filterProposalList(pendingQ.data ?? [], { showDevSamples: includeDevSamples }),
    [pendingQ.data, includeDevSamples],
  );

  const needsFiltered = useMemo(
    () => filterProposalList(needsQ.data ?? [], { showDevSamples: includeDevSamples }),
    [needsQ.data, includeDevSamples],
  );

  const approvedFiltered = useMemo(
    () => filterProposalList(approvedQ.data ?? [], { showDevSamples: includeDevSamples }),
    [approvedQ.data, includeDevSamples],
  );

  const rejectedFiltered = useMemo(
    () => filterProposalList(rejectedQ.data ?? [], { showDevSamples: includeDevSamples }),
    [rejectedQ.data, includeDevSamples],
  );

  const listForTab = (t: ReviewTab): AtomEnrichmentProposalRow[] => {
    if (t === "pending") return pendingFiltered;
    if (t === "needs_more_context") return needsFiltered;
    if (t === "approved") return approvedFiltered;
    return rejectedFiltered;
  };

  if (!uid) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Logg inn for å se AI-forslag.</p>
      </div>
    );
  }

  const bulkBusy =
    bulkApproveM.isPending ||
    bulkRejectM.isPending ||
    bulkNeedsM.isPending ||
    bulkReopenM.isPending;
  const busy =
    approveM.isPending ||
    rejectM.isPending ||
    needsM.isPending ||
    reopenM.isPending ||
    generateM.isPending ||
    bulkBusy;

  const tabLoading =
    (tab === "pending" && pendingQ.isLoading) ||
    (tab === "needs_more_context" && needsQ.isLoading) ||
    (tab === "approved" && approvedQ.isLoading) ||
    (tab === "rejected" && rejectedQ.isLoading);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  };

  const selectedIds = [...selected];
  const showBulk = selectedIds.length > 0 && (tab === "pending" || tab === "needs_more_context");

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <ClipboardList className="h-4 w-4" />
          <Link to="/preferences" className="hover:underline">
            Karriereprofil
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">AI-forslag</span>
        </div>
        <h1 className="text-2xl font-display font-bold tracking-tight">AI-forslag</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Her gjennomgår du forslag som krever tolkning eller avklaring. Eksplisitte valg du
          allerede har gjort i profilskjemaer og dokumenter speiles ofte automatisk til strukturert
          karrieregrunnlag — uten ekstra godkjenningstrinn.
        </p>
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3">
          <Button type="button" disabled={busy} onClick={() => generateM.mutate()}>
            {generateM.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Generer forslag
          </Button>
          <p className="text-xs text-muted-foreground max-w-xl sm:flex-1">
            Regelbasert — ingen AI-assistent i dette steget. Du beholder kontrollen over det som
            krever vurdering.
          </p>
        </div>
      </header>

      {import.meta.env.DEV && (
        <Card className="border-dashed">
          <CardHeader className="py-3 space-y-2">
            <CardTitle className="text-sm">Kun utvikling</CardTitle>
            <CardDescription className="text-xs">
              Testforslag opprettes bare lokalt og er merket tydelig. Skjul dem fra listen med
              bryteren under med mindre du jobber med skjema eller RLS.
            </CardDescription>
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDevSamples}
                onChange={(e) => setShowDevSamples(e.target.checked)}
                className="rounded border-input"
              />
              Vis testforslag i listene
            </label>
          </CardHeader>
          <CardContent className="pt-0 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={seedM.isPending}
              onClick={() => seedM.mutate()}
            >
              {seedM.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Opprett testforslag
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profilforslag</CardTitle>
          <CardDescription>
            Velg flere forslag for raske handlinger. Under «Trenger mer kontekst» kan du fortsatt
            godkjenne, avvise eller flytte tilbake til avventer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as ReviewTab)} className="space-y-4">
            <TabsList className="flex h-auto w-full flex-wrap gap-1">
              <TabsTrigger value="pending" className="flex-1 min-w-[7rem]">
                Avventer ({pendingFiltered.length})
              </TabsTrigger>
              <TabsTrigger value="needs_more_context" className="flex-1 min-w-[7rem]">
                Mer kontekst ({needsFiltered.length})
              </TabsTrigger>
              <TabsTrigger value="approved" className="flex-1 min-w-[7rem]">
                Godkjent ({approvedFiltered.length})
              </TabsTrigger>
              <TabsTrigger value="rejected" className="flex-1 min-w-[7rem]">
                Avvist ({rejectedFiltered.length})
              </TabsTrigger>
            </TabsList>

            {showBulk && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3 text-sm">
                <p className="font-medium">
                  {selectedIds.length} valgt — felles valgfri kommentar brukes der det støttes.
                </p>
                <Textarea
                  rows={2}
                  className="text-sm"
                  value={bulkComment}
                  onChange={(e) => setBulkComment(e.target.value)}
                  placeholder="Valgfri kommentar for alle valgte…"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => bulkApproveM.mutate(selectedIds)}
                  >
                    Godkjenn valgte
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => bulkRejectM.mutate(selectedIds)}
                  >
                    Avvis valgte
                  </Button>
                  {tab === "pending" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => bulkNeedsM.mutate(selectedIds)}
                    >
                      Mer kontekst for valgte
                    </Button>
                  )}
                  {tab === "needs_more_context" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => bulkReopenM.mutate(selectedIds)}
                    >
                      Tilbake til avventer for valgte
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    disabled={busy}
                    onClick={() => {
                      const all = listForTab(tab).map((x) => x.id);
                      setSelected(new Set(all));
                    }}
                  >
                    Velg alle i fanen
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    disabled={busy}
                    onClick={() => setSelected(new Set())}
                  >
                    Nullstill utvalg
                  </Button>
                </div>
              </div>
            )}

            {(["pending", "needs_more_context", "approved", "rejected"] as const).map((t) => {
              const list = listForTab(t);
              const mode: ProposalCardMode =
                t === "pending" ? "pending" : t === "needs_more_context" ? "needs" : "readonly";
              const showCb = t === "pending" || t === "needs_more_context";
              return (
                <TabsContent key={t} value={t} className="mt-0 space-y-4">
                  {tabLoading && t === tab ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                      <Loader2 className="h-4 w-4 animate-spin" /> Laster…
                    </div>
                  ) : list.length === 0 && t === tab ? (
                    (() => {
                      const ec = emptyCopy(t);
                      return <EmptyState title={ec.title} description={ec.description} />;
                    })()
                  ) : t === tab ? (
                    list.map((p) => (
                      <ProposalCard
                        key={p.id}
                        p={p}
                        busy={busy}
                        commentFor={commentFor(p.id)}
                        onComment={(id, v) => setCommentById((m) => ({ ...m, [id]: v }))}
                        mode={mode}
                        showCheckbox={showCb}
                        selected={selected.has(p.id)}
                        onToggleSelected={toggleSelected}
                        onApprove={() => approveM.mutate(p)}
                        onNeeds={t === "pending" ? () => needsM.mutate(p) : undefined}
                        onReject={() => rejectM.mutate(p)}
                        onReopen={t === "needs_more_context" ? () => reopenM.mutate(p) : undefined}
                      />
                    ))
                  ) : null}
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grupper av forslag</CardTitle>
          <CardDescription>Oversikt over sammenhengende kjøringer av forslag.</CardDescription>
        </CardHeader>
        <CardContent>
          {batchesQ.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (batchesQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen grupper ennå.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(batchesQ.data ?? []).map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap justify-between gap-2 border-b border-border/60 pb-2 last:border-0"
                >
                  <span className="font-medium">{b.title ?? "Uten tittel"}</span>
                  <span className="text-muted-foreground text-xs">
                    {batchSourceUserLabel(b.source_type)} · {fmtDateTime(b.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
