// @ts-nocheck
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sanitert feiltilstand. Viser aldri rå databasefeil, og aldri «0 rader»
 * som erstatning for en tilgangsfeil.
 */
export function NetworkErrorState({
  onRetry,
  title = "Kunne ikke hente nettverksdataene",
}: {
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
        {title}
      </div>
      <p className="text-sm text-muted-foreground">
        Dataene ble ikke lastet. Ingenting er endret. Prøv igjen, eller logg inn på nytt hvis
        problemet vedvarer.
      </p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={() => onRetry()}>
          Prøv igjen
        </Button>
      ) : null}
    </div>
  );
}
