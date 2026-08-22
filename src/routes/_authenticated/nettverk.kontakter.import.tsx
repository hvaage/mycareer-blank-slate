// @ts-nocheck
// ============================================================
// Importgjennomgang for nettverkskontakter.
//
// Ingenting promoteres automatisk: den kanoniske serverhandlingen kalles
// kun fra klikkhandleren bak en eksplisitt bekreftelsesdialog.
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { BackLink } from "@/components/network/network-shell";
import { useAuthUserId } from "@/components/network/use-network-user";
import { networkBatchQuery } from "@/lib/queries/network";
import { promoteNetworkBatchContacts } from "@/lib/network.functions";

export const Route = createFileRoute("/_authenticated/nettverk/kontakter/import")({
  component: ContactImportReview,
});

const SIGNAL_LABEL: Record<string, string> = {
  company_observation: "Selskapssignaler",
  network_event: "Nettverksarrangementer",
  network_preference_signal: "Preferansesignaler",
  invitation: "Invitasjoner",
  ukjent: "Uklassifiserte signaler",
};

const ERROR_TEXT: Record<string, string> = {
  batch_not_found: "Importen ble ikke funnet for kontoen din.",
  batch_not_ready: "Importen er ikke lenger klar til gjennomgang.",
  too_many_items: "Importen er for stor til å kjøres i én omgang.",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "ukjent tidspunkt";
  return new Date(value).toLocaleString("nb-NO", { dateStyle: "long", timeStyle: "short" });
}

function ContactImportReview() {
  const userId = useAuthUserId();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(networkBatchQuery(userId));
  const promote = useServerFn(promoteNetworkBatchContacts);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<
    { createdCount: number; skippedCount: number; requestedCount: number } | null
  >(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const personCount = data?.pendingPersonItemIds?.length ?? 0;
  const kinds = data?.objectKindCounts ?? {};
  const withoutIdentity = Number(data?.batch?.without_stable_identity_count ?? 0);

  const promoteMutation = useMutation({
    mutationFn: async () => {
      const ids = data?.pendingPersonItemIds ?? [];
      if (data?.state !== "importable" || !data?.batch?.id || ids.length === 0) {
        throw new Error("Ingen personkontakter å importere.");
      }
      return promote({ data: { batchId: data.batch.id, itemIds: ids } });
    },
    onSuccess: (res: any) => {
      if (!res?.ok) {
        setErrorText(
          ERROR_TEXT[res?.errorCode as string] ??
            "Importen kunne ikke fullføres. Ingen kontakter ble opprettet.",
        );
        return;
      }
      setErrorText(null);
      setResult({
        createdCount: res.createdCount ?? 0,
        skippedCount: res.skippedCount ?? 0,
        requestedCount: personCount,
      });
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: () =>
      setErrorText("Importen kunne ikke fullføres. Ingen kontakter ble opprettet."),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-hidden">
      <div>
        <BackLink fallbackTo="/nettverk/kontakter" />
        <h2 className="text-lg font-semibold">Gjennomgang av LinkedIn-kontakter</h2>
        <p className="text-sm text-muted-foreground">
          Ingenting opprettes før du bekrefter importen.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 md:overflow-hidden">
        <NetworkPanel title="Oppsummering">
          {isLoading ? (
            <PanelEmpty>Laster importstatus…</PanelEmpty>
          ) : data?.state === "consumed" ? (
            <div className="space-y-2">
              <p className="font-medium">Kontaktene er allerede importert.</p>
              <p className="text-muted-foreground">
                Denne importen ble gjennomført {formatDate(data.batch?.consumed_at)}.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/nettverk/kontakter">Gå til kontaktregisteret</Link>
              </Button>
            </div>
          ) : data?.state === "superseded" ? (
            <div className="space-y-2">
              <p className="font-medium">Denne importen er erstattet.</p>
              <p className="text-muted-foreground">
                En nyere gjennomgang har overtatt. Last opp en ny LinkedIn-eksport for å få en
                gyldig import å ta stilling til.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/kildegjennomgang" search={{ source: "linkedin" }}>
                  Gå til kildegjennomgang
                </Link>
              </Button>
            </div>
          ) : data?.state !== "importable" ? (
            <div className="space-y-2">
              <p className="font-medium">Importer en ny LinkedIn-eksport.</p>
              <p className="text-muted-foreground">
                Vi finner ingen gyldig gjennomgang å importere fra.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/kildegjennomgang" search={{ source: "linkedin" }}>
                  Gå til kildegjennomgang
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <ul className="space-y-1">
                <Row label="Nye LinkedIn-kontakter" value={personCount.toLocaleString("nb-NO")} />
                <Row
                  label="Kontakter uten stabil LinkedIn-identitet"
                  value={withoutIdentity.toLocaleString("nb-NO")}
                />
                <Row label="Kilde" value="Connections.csv" />
                <Row
                  label="Importtidspunkt"
                  value={formatDate(data.batch?.prepared_at ?? data.batch?.created_at)}
                />
              </ul>

              <div>
                <p className="font-medium">Dette opprettes</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  <li>kontakt</li>
                  <li>kanonisk LinkedIn-identitet</li>
                  <li>observert selskaps- og rolletilknytning når den finnes</li>
                </ul>
              </div>

              <div>
                <p className="font-medium">Dette opprettes ikke</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  <li>ingen aktiviteter</li>
                  <li>ingen muligheter</li>
                  <li>ingen selskapsprioritet</li>
                  <li>ingen automatisk sammenslåing basert på navn</li>
                  <li>ingen e-post eller telefon</li>
                </ul>
              </div>

              {result ? (
                <div className="rounded-md border border-border p-2">
                  {result.createdCount > 0 ? (
                    <p className="font-medium">{result.createdCount} kontakter opprettet.</p>
                  ) : (
                    <p className="font-medium">Kontaktene er allerede importert.</p>
                  )}
                  <p className="text-muted-foreground">
                    {result.skippedCount} hoppet over · {result.requestedCount} vurdert
                  </p>
                  <Button asChild size="sm" variant="outline" className="mt-2">
                    <Link to="/nettverk/kontakter">Gå til kontaktregisteret</Link>
                  </Button>
                </div>
              ) : null}

              {errorText ? (
                <div className="rounded-md border border-destructive/40 p-2">
                  <p>{errorText}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={promoteMutation.isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Prøv igjen
                  </Button>
                </div>
              ) : null}

              {!result ? (
                <Button
                  className="w-full gap-2"
                  disabled={promoteMutation.isPending || personCount === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  {promoteMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Importerer…
                    </>
                  ) : (
                    <>
                      <Users className="h-4 w-4" aria-hidden /> Importer{" "}
                      {personCount.toLocaleString("nb-NO")} kontakter
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          )}
        </NetworkPanel>

        <NetworkPanel title="Andre signaler beholdt som kildeinformasjon">
          <ul className="space-y-1">
            {Object.entries(kinds)
              .filter(([kind]) => kind !== "person_contact")
              .map(([kind, count]) => (
                <li key={kind} className="flex items-baseline justify-between gap-2">
                  <span>{SIGNAL_LABEL[kind] ?? kind}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </li>
              ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Disse importeres ikke som kontakter. De beholdes som kildeinformasjon fra
            LinkedIn-eksporten.
          </p>
        </NetworkPanel>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Importer {personCount.toLocaleString("nb-NO")} kontakter?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Du er i ferd med å opprette {personCount.toLocaleString("nb-NO")} kontakter fra
              LinkedIn-eksporten din. Importen bruker LinkedIn-profil-URL som stabil identitet.
              Navnelikhet alene slår aldri sammen kontakter. Importen overskriver ikke senere
              manuelle endringer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={promoteMutation.isPending}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              disabled={promoteMutation.isPending}
              onClick={() => promoteMutation.mutate()}
            >
              Bekreft og importer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}
