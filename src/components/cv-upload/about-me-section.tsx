import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText } from "lucide-react";
import { CvUploadFlow } from "./cv-upload-flow";
import { useUserAtomCounts, useUserImports } from "@/lib/queries/cv-imports";
import { fmtDate } from "@/lib/format";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  committed: { label: "Lagret", className: "bg-green-600 hover:bg-green-600 text-white" },
  reviewed: { label: "Gjennomgått", className: "bg-sky-600 hover:bg-sky-600 text-white" },
  parsed: { label: "Klar for bekreftelse", className: "bg-amber-500 hover:bg-amber-500 text-white" },
  processing: { label: "Analyserer", className: "bg-amber-600 hover:bg-amber-600 text-white" },
  pending: { label: "Venter på analyse", className: "bg-muted-foreground/90 hover:bg-muted-foreground/90 text-background" },
  failed: { label: "Feilet", className: "bg-destructive hover:bg-destructive text-destructive-foreground" },
};

interface Props {
  userId: string;
}

export function AboutMeCvSection({ userId }: Props) {
  const imports = useUserImports(userId);
  const atomCount = useUserAtomCounts(userId);
  const hasExistingImport = !!imports.data?.length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
          <CardDescription>
            Karriereoversikten er en strukturert oversikt over stillinger, utdanning og
            ferdigheter — bygget fra CV-er du laster opp her. Den brukes av <strong>CV-bygger</strong>
            til å generere skreddersydde CV-er og søknadsbrev. Opplasting her er for å
            <strong> bygge karrieredata</strong> — ikke for å arkivere ferdige CV-filer
            (det gjøres under fanen <strong>CV</strong>). Manuell punkt-for-punkt-redigering
            og import fra LinkedIn-eksport kommer i en senere versjon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {atomCount.isLoading ? (
            <Skeleton className="h-6 w-32" />
          ) : atomCount.isError ? (
            <p className="text-sm text-destructive">
              Kunne ikke hente antall elementer:{" "}
              {atomCount.error instanceof Error ? atomCount.error.message : "ukjent årsak"}
            </p>
          ) : (
            <p className="text-sm">
              <strong>{atomCount.data ?? 0}</strong> elementer i karriereoversikten
            </p>
          )}
        </CardContent>
      </Card>

      <CvUploadFlow userId={userId} hasExistingImport={hasExistingImport} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tidligere opplastinger</CardTitle>
          <CardDescription>
            Logg over CV-er som er importert eller forsøkt importert hit. Filer som bare ligger i
            CV-arkivet (fanen <strong>CV</strong>) vises ikke her før du velger dem under «Bruk en
            CV du allerede har lagret». «Venter på analyse» betyr at filen
            er i bucket — trykk «Analyser CV» i opplasteren over. «Klar for bekreftelse» betyr at AI er
            ferdig — trykk «Bekreft og lagre» i opplasteren for å legge innhold inn i karriereoversikten.
          </CardDescription>

        </CardHeader>
        <CardContent>
          {imports.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : imports.isError ? (
            <p className="text-sm text-destructive">
              Kunne ikke hente opplastingene:{" "}
              {imports.error instanceof Error ? imports.error.message : "ukjent årsak"}. Dette betyr
              ikke at listen er tom.
            </p>
          ) : !imports.data?.length ? (
            <p className="text-sm text-muted-foreground">Ingen opplastinger ennå.</p>
          ) : (
            <ul className="divide-y">
              {imports.data.map((row) => {
                const badge = STATUS_BADGE[row.status] ?? STATUS_BADGE.failed;
                return (
                  <li key={row.id} className="py-3 flex items-start gap-3">
                    <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {row.source_filename ?? "Ukjent fil"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(row.created_at)}
                        {row.status === "failed" && row.error_message && (
                          <span className="ml-2 text-destructive">— {row.error_message.slice(0, 80)}</span>
                        )}
                      </p>
                    </div>
                    <Badge className={badge.className}>{badge.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
