/**
 * CV-gjennomgang: oppsummering når alle fire trinn er gjennomført, og
 * varsel når kandidatsettet er endret siden gjennomgangen startet.
 *
 * Dette erstatter den gamle flate fanevisningen som standarddestinasjon.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, RefreshCw } from "lucide-react";

export interface SummaryLine {
  step: number;
  label: string;
  confirmed: number;
  remaining: number;
}

export function CvReviewSummary({
  lines,
  onGoToStep,
}: {
  lines: SummaryLine[];
  onGoToStep: (step: number) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
          Gjennomgangen er fullført
        </CardTitle>
        <CardDescription>
          Slik ser importen ut nå. Du kan gå tilbake til et trinn når som helst.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {lines.map((l) => (
          <div
            key={l.step}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{l.label}</p>
              <p className="text-xs text-muted-foreground">
                {l.confirmed} bekreftet
                {l.remaining > 0 ? ` · ${l.remaining} står igjen` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {l.remaining > 0 ? (
                <Badge variant="outline">Ikke ferdig</Badge>
              ) : (
                <Badge variant="secondary">Ferdig</Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => onGoToStep(l.step)}>
                Gå til trinnet
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function CvReviewStaleNotice({
  onRestart,
  onShowChanges,
  showingChanges,
  changedCount,
}: {
  onRestart: () => void;
  onShowChanges: () => void;
  showingChanges: boolean;
  changedCount: number;
}) {
  return (
    <Card className="border-amber-500/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-4 w-4" aria-hidden />
          Innholdet i importen er endret
        </CardTitle>
        <CardDescription>
          Gjennomgangen du startet gjelder et annet innhold enn det som ligger her nå. Vi
          fortsetter derfor ikke som om ingenting har skjedd.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onRestart}>
          Start gjennomgangen på nytt
        </Button>
        <Button size="sm" variant="outline" onClick={onShowChanges}>
          {showingChanges ? "Skjul endringene" : `Se hva som er endret${changedCount ? ` (${changedCount})` : ""}`}
        </Button>
      </CardContent>
    </Card>
  );
}
