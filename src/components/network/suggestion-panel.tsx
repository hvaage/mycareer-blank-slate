// @ts-nocheck
// Fase 5D — KI-aktivitetsforslag i Nettverksarbeid.
//
// KI foreslår kun. Ingenting opprettes, sendes eller endres automatisk:
// brukeren må godta et forslag og selv bekrefte frist før aktiviteten lagres.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { NetworkErrorState } from "@/components/network/network-error";
import { useNetworkAuth } from "@/components/network/use-network-user";
import { startActivitySuggestionRun, decideActivitySuggestion } from "@/lib/network-suggestions.functions";
import { upsertActivity } from "@/lib/network.functions";
import { ACTIVITY_TYPE_LABEL } from "@/lib/queries/network";

export type SuggestionScope = "overview" | "company" | "contact" | "opportunity";

/** Fokusvalget avgjør hva forslagene skal handle om. Nettverksarbeid er standard. */
type SuggestionFocus = "nettverk" | "oppfolging" | "soknad" | "alle";

const FOCUS_OPTIONS: { code: SuggestionFocus; label: string }[] = [
  { code: "nettverk", label: "Nettverksarbeid" },
  { code: "oppfolging", label: "Oppfølging" },
  { code: "soknad", label: "Søknadsarbeid" },
  { code: "alle", label: "Alt" },
];

const ERROR_TEXT: Record<string, string> = {
  rate_limited: "Du har bedt om forslag mange ganger den siste timen. Prøv igjen senere.",
  too_many_active: "En forslagskjøring pågår allerede. Vent til den er ferdig.",
  invalid_scope: "Denne flaten kan ikke gi forslag for deg.",
  enqueue_failed: "Kunne ikke starte forslagskjøringen. Prøv igjen.",
  write_failed: "Kunne ikke lagre. Prøv igjen.",
};

const PRIORITY_LABEL: Record<string, string> = { low: "Lav", medium: "Middels", high: "Høy" };
const PRIORITY_TO_ACTIVITY: Record<string, string> = { low: "lav", medium: "middels", high: "høy" };

function scopeKey(scope: SuggestionScope, objectId: string | null) {
  return scope === "overview" ? "overview" : `${scope}:${objectId}`;
}

function isoPlusDays(days: number | null): string {
  const d = new Date();
  d.setDate(d.getDate() + (days ?? 7));
  return d.toISOString().slice(0, 10);
}

export function SuggestionPanel({
  scope,
  scopeObjectId = null,
  context,
}: {
  scope: SuggestionScope;
  scopeObjectId?: string | null;
  context?: {
    contactId?: string | null;
    companyId?: string | null;
    opportunityId?: string | null;
  };
}) {
  const { userId, isAuthPending } = useNetworkAuth();
  const qc = useQueryClient();
  const key = scopeKey(scope, scopeObjectId);
  const [accepting, setAccepting] = useState<any | null>(null);
  const [focus, setFocus] = useState<SuggestionFocus>("nettverk");

  const runQuery = useQuery({
    queryKey: ["network-suggestion-run", userId, key],
    enabled: Boolean(userId),
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.status;
      return status === "queued" || status === "running" ? 4000 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("network_activity_suggestion_runs")
        .select("id, status, error_code, suggestion_count, created_at")
        .eq("scope_key", key)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const runStatus = (runQuery.data as any)?.status ?? null;
  const isRunning = runStatus === "queued" || runStatus === "running";

  const suggestionsQuery = useQuery({
    queryKey: ["network-suggestions", userId, key, runStatus],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("network_activity_suggestions")
        .select(
          "id, activity_type, title, rationale, priority, suggested_timing, evidence, created_at, run:network_activity_suggestion_runs!inner(scope_key)",
        )
        .eq("status", "pending_review")
        .eq("run.scope_key", key)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const start = useMutation({
    mutationFn: (regenerate: boolean) =>
      startActivitySuggestionRun({ data: { scope, scopeObjectId, regenerate } }),
    onSuccess: (res: any) => {
      if (!res?.ok) {
        toast.error(ERROR_TEXT[res?.errorCode ?? "enqueue_failed"] ?? ERROR_TEXT.enqueue_failed);
        return;
      }
      toast.success(res.reused ? "Bruker eksisterende vurdering." : "Forslagskjøringen er startet.");
      void qc.invalidateQueries({ queryKey: ["network-suggestion-run", userId, key] });
      void qc.invalidateQueries({ queryKey: ["network-suggestions", userId, key] });
    },
    onError: () => toast.error(ERROR_TEXT.enqueue_failed),
  });

  const dismiss = useMutation({
    mutationFn: (suggestionId: string) =>
      decideActivitySuggestion({ data: { suggestionId, decision: "dismissed" } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["network-suggestions", userId, key] });
    },
    onError: () => toast.error(ERROR_TEXT.write_failed),
  });

  const suggestions = (suggestionsQuery.data ?? []) as any[];

  if (suggestionsQuery.isError || runQuery.isError) {
    return (
      <NetworkErrorState
        onRetry={() => {
          void runQuery.refetch();
          void suggestionsQuery.refetch();
        }}
      />
    );
  }

  return (
    <NetworkPanel
      title="Aktivitetsforslag"
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isAuthPending || isRunning || start.isPending}
            onClick={() => start.mutate(false)}
          >
            <Sparkles className="mr-1 h-4 w-4" />
            Få aktivitetsforslag
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isAuthPending || isRunning || start.isPending}
            onClick={() => start.mutate(true)}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Generer på nytt
          </Button>
        </div>
      }
    >
      <p className="mb-2 text-xs text-muted-foreground">
        Forslagene er KI-generert og basert på dine egne selskaper, kontakter, muligheter og åpne
        aktiviteter. Ingenting opprettes eller sendes uten at du godtar det.
      </p>

      {isAuthPending ? (
        <PanelEmpty>Laster…</PanelEmpty>
      ) : isRunning ? (
        <PanelEmpty>Vurderingen kjører. Du kan lukke siden – den fortsetter i bakgrunnen.</PanelEmpty>
      ) : suggestions.length === 0 ? (
        <PanelEmpty>
          {runStatus === "failed"
            ? "Forrige vurdering ble ikke fullført. Prøv igjen."
            : "Ingen forslag til vurdering. Trykk «Få aktivitetsforslag»."}
        </PanelEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {suggestions.map((s) => (
            <li key={s.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.title}</span>
                <Badge variant="outline">
                  {ACTIVITY_TYPE_LABEL[s.activity_type] ?? s.activity_type}
                </Badge>
                <Badge variant="secondary">{PRIORITY_LABEL[s.priority] ?? s.priority}</Badge>
                <Badge variant="outline">KI-forslag</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.rationale}</p>
              {Array.isArray(s.evidence) && s.evidence.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Grunnlag: {s.evidence.map((e: any) => e.label).filter(Boolean).join(", ")}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => setAccepting(s)}>
                  Godta og opprett
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate(s.id)}
                >
                  Avvis
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AcceptDialog
        suggestion={accepting}
        context={context ?? {}}
        onClose={() => setAccepting(null)}
        onDone={() => {
          setAccepting(null);
          void qc.invalidateQueries({ queryKey: ["network-suggestions", userId, key] });
          void qc.invalidateQueries({ queryKey: ["network"] });
        }}
      />
    </NetworkPanel>
  );
}

/** Frist må bekreftes eksplisitt før aktiviteten opprettes. */
function AcceptDialog({
  suggestion,
  context,
  onClose,
  onDone,
}: {
  suggestion: any | null;
  context: { contactId?: string | null; companyId?: string | null; opportunityId?: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const suggested = useMemo(
    () => isoPlusDays(suggestion?.suggested_timing?.horizonDays ?? null),
    [suggestion?.id],
  );
  const [dueDate, setDueDate] = useState(suggested);
  const [noDate, setNoDate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const evidenceContext = useMemo(() => {
    const refs = Array.isArray(suggestion?.evidence) ? suggestion.evidence : [];
    const pick = (kind: string) => refs.find((r: any) => r?.kind === kind)?.id ?? null;
    return {
      contactId: context.contactId ?? pick("contact"),
      companyId: context.companyId ?? pick("company"),
      opportunityId: context.opportunityId ?? pick("opportunity"),
    };
  }, [suggestion?.id, context.contactId, context.companyId, context.opportunityId]);

  const accept = useMutation({
    mutationFn: async () => {
      const created = await upsertActivity({
        data: {
          activityId: null,
          title: suggestion.title,
          description: suggestion.rationale,
          dueDate: noDate ? null : dueDate,
          priority: PRIORITY_TO_ACTIVITY[suggestion.priority] ?? "middels",
          activityType: suggestion.activity_type,
          status: "planlagt",
          resultNote: null,
          activityScope: "context",
          contactId: evidenceContext.contactId,
          companyId: evidenceContext.companyId,
          opportunityId: evidenceContext.opportunityId,
          applicationId: null,
        },
      });
      if (!created?.ok) throw new Error(created?.errorCode ?? "write_failed");
      const decided = await decideActivitySuggestion({
        data: {
          suggestionId: suggestion.id,
          decision: "accepted",
          activityId: created.activityId ?? null,
        },
      });
      if (!decided?.ok) throw new Error(decided?.errorCode ?? "write_failed");
      return created;
    },
    onSuccess: () => {
      toast.success("Aktiviteten er opprettet.");
      onDone();
    },
    onError: (err: any) => {
      toast.error(ERROR_TEXT[err?.message] ?? ERROR_TEXT.write_failed);
    },
  });

  const canSave = (noDate || Boolean(dueDate)) && confirmed && !accept.isPending;

  return (
    <Dialog
      open={Boolean(suggestion)}
      onOpenChange={(open) => {
        if (!open) {
          setNoDate(false);
          setConfirmed(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Godta forslag og opprett aktivitet</DialogTitle>
          <DialogDescription>
            Du bestemmer fristen. Aktiviteten opprettes først når du bekrefter.
          </DialogDescription>
        </DialogHeader>

        {suggestion ? (
          <div className="space-y-3">
            <div>
              <p className="font-medium">{suggestion.title}</p>
              <p className="text-sm text-muted-foreground">{suggestion.rationale}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sugg-due">Frist</Label>
              <Input
                id="sugg-due"
                type="date"
                value={dueDate}
                disabled={noDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={noDate} onCheckedChange={(v) => setNoDate(v === true)} />
              Ingen dato
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
              Jeg bekrefter fristen og at aktiviteten skal opprettes.
            </label>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button disabled={!canSave} onClick={() => accept.mutate()}>
            Opprett aktivitet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
