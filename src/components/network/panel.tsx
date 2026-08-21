// @ts-nocheck
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Arbeidsflate-panel: sticky overskrift, intern scroll ved overflyt,
 * kollapsbart til én linje. Ingen kort inni kort.
 */
export function NetworkPanel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  defaultOpen = true,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-foreground"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{title}</span>
        </button>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {open ? (
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm", bodyClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}
