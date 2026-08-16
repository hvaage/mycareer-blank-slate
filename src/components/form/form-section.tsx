// ============================================================
// FormSection — sammenleggbart skjemakort med fremdriftsstatus.
//
// Regler fra skjemadesign-instruksen:
//  - status vises som ✓ ferdig / påbegynt / ikke startet, ikke som prosent
//  - ferdige seksjoner er lukket som standard, valget huskes
//  - beskrivelsen sier hva svaret brukes til, ikke hva systemet gjør
// ============================================================
import type { ReactNode } from "react";
import { Check, ChevronDown, Circle, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";

export type SectionStatus = "ferdig" | "påbegynt" | "tom";

export function sectionStatus(filled: number, total: number): SectionStatus {
  if (filled === 0) return "tom";
  if (filled >= total) return "ferdig";
  return "påbegynt";
}

export function StatusMark({ status, className }: { status: SectionStatus; className?: string }) {
  if (status === "ferdig")
    return <Check className={cn("h-3.5 w-3.5 text-emerald-600", className)} aria-label="Ferdig" />;
  if (status === "påbegynt")
    return <CircleDot className={cn("h-3.5 w-3.5 text-amber-600", className)} aria-label="Påbegynt" />;
  return <Circle className={cn("h-3.5 w-3.5 text-muted-foreground/60", className)} aria-label="Ikke startet" />;
}

const STATUS_TEXT: Record<SectionStatus, string> = {
  ferdig: "Ferdig",
  påbegynt: "Påbegynt",
  tom: "Ikke startet",
};

export function FormSection({
  id,
  title,
  why,
  filled,
  total,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  /** Én setning om hva svarene brukes til. */
  why: string;
  filled: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const status = sectionStatus(filled, total);
  return (
    <section id={id} className="rounded-lg border border-border bg-card scroll-mt-24">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <StatusMark status={status} className="mt-1 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{title}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {STATUS_TEXT[status]} · {filled} av {total}
            </span>
          </span>
          <span className="mt-0.5 block max-w-prose text-xs leading-relaxed text-muted-foreground">{why}</span>
        </span>
        <ChevronDown
          className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? <div className="space-y-3 border-t border-border px-4 py-4">{children}</div> : null}
    </section>
  );
}
