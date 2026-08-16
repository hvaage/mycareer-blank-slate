/**
 * Fremdrift i CV-gjennomgangen. Viser hvor brukeren er, hva som gjenstår og
 * hvilke trinn som må vurderes på nytt etter endringer høyere i kjeden.
 * Ren visning — all skriving går gjennom fremdrifts-RPC-ene.
 */
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReviewStepStatus {
  step: number;
  label: string;
  /** Antall som gjenstår i trinnet. */
  remaining: number;
  total: number;
  needsRecheck?: boolean;
}

export function CvReviewProgressBar({
  steps,
  currentStep,
  onGoToStep,
}: {
  steps: ReviewStepStatus[];
  currentStep: number;
  onGoToStep?: (step: number) => void;
}) {
  return (
    <nav aria-label="Fremdrift i gjennomgangen" className="rounded-md border bg-card p-2">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {steps.map((s) => {
          const done = s.step < currentStep;
          const active = s.step === currentStep;
          const clickable = Boolean(onGoToStep) && s.step < currentStep;
          return (
            <li key={s.step} className="min-w-0">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onGoToStep?.(s.step)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1",
                  active && "bg-primary/10 font-medium text-foreground",
                  !active && "text-muted-foreground",
                  clickable && "hover:bg-muted",
                )}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                ) : active ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
                ) : null}
                <span className="truncate">{s.label}</span>
                {!done && s.total > 0 && (
                  <span className="text-xs">
                    {s.total - s.remaining} av {s.total}
                  </span>
                )}
                {s.needsRecheck && (
                  <span className="text-xs text-amber-600">· ny vurdering</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="px-2 pb-1 text-xs text-muted-foreground">
        Du kan avbryte når som helst — vi husker hvor du var.
      </p>
    </nav>
  );
}
