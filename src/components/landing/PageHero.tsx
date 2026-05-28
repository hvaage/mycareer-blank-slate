import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * PageHero — felles eyebrow + h1 + lead-tekst for alle undersider.
 * Sikrer lik font og størrelse på overskriftene på tvers av Markedsinnsikt,
 * Arbeidsgiveranalysen, Analysedatabasen osv.
 *
 * Brand-regler:
 *   - Eyebrow i mono caps (km-eyebrow)
 *   - h1 i IBM Plex Sans, 40px desktop / 32px mobil
 *   - 1px rule under tittelblokken
 *   - «min» kan markeres med <span className="text-[var(--km-blue)]">min</span>
 */

interface PageHeroProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function PageHero({ eyebrow, title, lead, action, className }: PageHeroProps) {
  return (
    <section
      className={cn(
        "border-b border-rule bg-[var(--km-paper-warm)]",
        className,
      )}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 md:py-14">
        {eyebrow ? (
          <div className="km-section-head">
            <span className="km-eyebrow">{eyebrow}</span>
            <span className="km-rule" />
          </div>
        ) : null}
        <h1 className="km-page-h1">{title}</h1>
        {lead ? (
          <p className="mt-4 max-w-2xl text-[15px] md:text-[17px] leading-relaxed text-[var(--km-ink-soft)]">
            {lead}
          </p>
        ) : null}
        {action ? <div className="mt-6 flex flex-wrap gap-3">{action}</div> : null}
      </div>
    </section>
  );
}
