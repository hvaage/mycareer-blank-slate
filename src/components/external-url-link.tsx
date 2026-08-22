// @ts-nocheck
import type { MouseEvent, ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ekstern lenke som alltid åpnes i ny fane, aldri innebygd.
 * LinkedIn og flere andre tjenester nekter visning i innebygde rammer,
 * så navigasjon i gjeldende ramme forsøkes ikke.
 */
export function ExternalUrlLink({
  href,
  children,
  className,
  showIcon = true,
  iconClassName = "h-3 w-3",
  title,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  showIcon?: boolean;
  iconClassName?: string;
  title?: string;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // I innebygd kontekst (forhåndsvisning) kan target="_blank" bli ignorert.
    // Åpne derfor eksplisitt i nytt vindu uten tilgang tilbake til appen.
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (opened) {
      event.preventDefault();
      opened.opener = null;
    }
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      onClick={handleClick}
      className={cn("inline-flex items-center gap-1 underline underline-offset-2", className)}
    >
      <span>{children}</span>
      {showIcon ? <ExternalLink className={iconClassName} aria-hidden="true" /> : null}
    </a>
  );
}

const EXTERNAL_URL_PATTERN = /^https?:\/\//i;

export function isExternalUrl(value: unknown): value is string {
  return typeof value === "string" && EXTERNAL_URL_PATTERN.test(value.trim());
}
