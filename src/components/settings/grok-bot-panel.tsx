import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Check, Copy, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ExternalUrlLink } from "@/components/external-url-link";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import {
  confirmGrokTestReceived,
  createGrokSetupCode,
  deactivateJobInboundAlias,
  ensureJobInboundAlias,
  getGrokSetupStatus,
  rotateJobInboundAlias,
} from "@/lib/job-leads/grok-bot.functions";
import { deriveGrokBotUiState, type GrokSetupStatusResult } from "@/lib/job-leads/grok-bot";

const STATUS_QUERY_KEY = ["grok-bot-setup-status"] as const;

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(success);
  } catch {
    toast.error("Kunne ikke kopiere. Marker teksten og kopier manuelt.");
  }
}

function AliasField({ alias }: { alias: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="flex-1 break-all rounded-md border bg-muted/40 px-3 py-2 text-sm">
        {alias}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => copyText(alias, "Jobb-adressen er kopiert")}
      >
        <Copy className="h-4 w-4" /> Kopier adresse
      </Button>
    </div>
  );
}

export function GrokBotPanel({ autoEnsure = false }: { autoEnsure?: boolean }) {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getGrokSetupStatus);
  const doEnsure = useServerFn(ensureJobInboundAlias);
  const doCreateCode = useServerFn(createGrokSetupCode);
  const doConfirm = useServerFn(confirmGrokTestReceived);
  const doDeactivate = useServerFn(deactivateJobInboundAlias);
  const doRotate = useServerFn(rotateJobInboundAlias);
  const [waitingForMail, setWaitingForMail] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const didAutoEnsure = useRef(false);

  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => fetchStatus(),
    refetchInterval: (query) => {
      const data = query.state.data as GrokSetupStatusResult | undefined;
      if (!data) return false;
      const ui = deriveGrokBotUiState({
        status: data.status,
        is_active: data.is_active,
        has_open_setup_session: Boolean(data.setup_session),
      });
      if (ui === "pending_verify" || (ui === "inactive" && data.alias)) return 8_000;
      return false;
    },
  });

  const data = statusQuery.data;
  const ui = data
    ? deriveGrokBotUiState({
        status: data.status,
        is_active: data.is_active,
        has_open_setup_session: Boolean(data.setup_session),
      })
    : "inactive";

  useEffect(() => {
    if (!autoEnsure || didAutoEnsure.current || statusQuery.isLoading) return;
    if (data?.alias) {
      didAutoEnsure.current = true;
      return;
    }
    didAutoEnsure.current = true;
    void doEnsure()
      .then(() => queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }))
      .catch((error: unknown) => {
        didAutoEnsure.current = false;
        toast.error(
          error instanceof Error ? error.message : "Kunne ikke aktivere jobb-adresse",
        );
      });
  }, [autoEnsure, data?.alias, doEnsure, queryClient, statusQuery.isLoading]);

  const ensureMutation = useMutation({
    mutationFn: () => doEnsure(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      toast.success("Jobb-adressen er klar. Kopier den inn i e-postregelen.");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Kunne ikke aktivere jobb-adresse");
    },
  });

  const connectMutation = useMutation({
    mutationFn: () => doCreateCode(),
    onSuccess: async () => {
      setWaitingForMail(false);
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      toast.success("Oppsettkoden er klar. Åpne Grok-malen og lim den inn.");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Kunne ikke lage oppsettkode");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (force?: boolean) => doConfirm({ data: { force } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      if (result.ok) {
        setWaitingForMail(false);
        toast.success("Jobbimport er aktiv.");
        return;
      }
      if (result.reason === "no_inbound") {
        setWaitingForMail(true);
        toast.info("Vi har ikke mottatt e-post til adressen ennå. Send en test og prøv igjen.");
        return;
      }
      toast.error("Aktiver jobb-adressen først.");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Kunne ikke sjekke test-e-post");
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () => doDeactivate(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      toast.success("Jobbimport er slått av. Adressen tar ikke imot nye e-poster.");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Kunne ikke deaktivere");
    },
  });

  const rotateMutation = useMutation({
    mutationFn: () => doRotate(),
    onSuccess: async (result) => {
      setWaitingForMail(false);
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      toast.success(`Ny adresse: ${result.alias}. Den gamle virker ikke lenger.`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Kunne ikke rullere adressen");
    },
  });

  const session = data?.setup_session ?? null;
  const alias = data?.alias ?? null;
  const busy =
    ensureMutation.isPending ||
    connectMutation.isPending ||
    confirmMutation.isPending ||
    deactivateMutation.isPending ||
    rotateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Grok Bot — jobbimport
          {ui === "active" ? (
            <Badge>Aktiv</Badge>
          ) : alias ? (
            <Badge variant="secondary">Ikke aktiv</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Videresend jobbvarsler fra LinkedIn, Finn, DN Jobb og andre via en e-postregel.
          Vi henter ikke stillinger ved å scrape portalene. Apple Mail settes opp som vanlig
          e-postregel — det finnes ingen egen Apple-tilkobling.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Henter status…</p>
        )}
        {statusQuery.error && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Kunne ikke hente status</AlertTitle>
            <AlertDescription>
              {statusQuery.error instanceof Error
                ? statusQuery.error.message
                : "Prøv å laste siden på nytt."}
            </AlertDescription>
          </Alert>
        )}

        {ui === "inactive" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Du får en privat adresse på jobb.karrierenmin.no. Lag en regel i Gmail, Outlook
              eller Apple Mail som videresender jobbvarsler dit. Grok Bot kan hjelpe deg med
              å sette opp regelen.
            </p>
            {!alias ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => ensureMutation.mutate()}
              >
                <Mail className="h-4 w-4" /> Aktiver jobb-adresse
              </Button>
            ) : (
              <div className="space-y-3">
                <AliasField alias={alias} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => connectMutation.mutate()}
                  >
                    <Bot className="h-4 w-4" /> Koble Grok Bot
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {ui === "pending_verify" && alias && (
          <div className="space-y-4">
            <AliasField alias={alias} />
            {session && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <p className="text-sm font-medium">Oppsettkode</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-lg tracking-widest">
                    {session.setup_code}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyText(session.setup_code, "Oppsettkoden er kopiert")}
                  >
                    <Copy className="h-4 w-4" /> Kopier kode
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Gyldig til {fmtDateTime(session.expires_at)}. Åpne Grok-malen, lim inn koden
                  og jobb-adressen, og følg instruksene der.
                </p>
                <ExternalUrlLink href={session.grok_template_url}>
                  Åpne Grok-malen
                </ExternalUrlLink>
              </div>
            )}
            <Alert>
              <Mail className="h-4 w-4" />
              <AlertTitle>Send en test</AlertTitle>
              <AlertDescription>
                Videresend et ekte jobbvarsel (eller send en stillings-e-post) til adressen
                over. Når e-posten er mottatt, blir jobbimport aktiv. Ingen portal-innlogging
                og ingen scraping.
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => confirmMutation.mutate(false)}
              >
                <Check className="h-4 w-4" /> Jeg har sendt test
              </Button>
              {!session && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => connectMutation.mutate()}
                >
                  Koble Grok Bot
                </Button>
              )}
            </div>
            {waitingForMail && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Vi venter på e-post til {alias}. Sjekk at regelen sender til nøyaktig denne
                  adressen, og at MX for jobb.karrierenmin.no er satt opp.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => confirmMutation.mutate(true)}
                >
                  Merk som aktiv likevel
                </Button>
              </div>
            )}
          </div>
        )}

        {ui === "active" && alias && (
          <div className="space-y-4">
            <Alert>
              <Check className="h-4 w-4" />
              <AlertTitle>Jobbimport aktiv</AlertTitle>
              <AlertDescription>
                Jobbvarsler til {alias} blir lest og lagt inn som stillingsleads.
                {data?.last_inbound_at
                  ? ` Sist mottatt ${fmtRelative(data.last_inbound_at)} (${fmtDateTime(data.last_inbound_at)}).`
                  : " Ingen e-post er registrert på adressen ennå."}
              </AlertDescription>
            </Alert>
            <AliasField alias={alias} />
          </div>
        )}

        {alias && (
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="px-0">
                Avansert
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Rullering dreper den gamle adressen</AlertTitle>
                <AlertDescription>
                  Hvis du rullerer, slutter den nåværende adressen å virke med én gang.
                  E-postregler som peker dit, må oppdateres manuelt.
                </AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-2">
                {data?.is_active ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => deactivateMutation.mutate()}
                  >
                    Deaktiver jobbimport
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => ensureMutation.mutate()}
                  >
                    Aktiver på nytt
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" size="sm" disabled={busy}>
                      Roter alias
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Lage ny jobb-adresse?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Den gamle adressen dør med én gang. All e-post til den blir avvist.
                        Du må oppdatere videresendingsregelen i e-posten din.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Avbryt</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => rotateMutation.mutate()}
                      >
                        Roter alias
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
