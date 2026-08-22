// @ts-nocheck
import type { MouseEvent, ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Ekstern lenke som alltid åpnes i en ny toppnivåfane, aldri innebygd.
 * LinkedIn nekter visning i rammer (ERR_BLOCKED_BY_RESPONSE), så i
 * forhåndsvisning/WebView må vi hindre at lenken lastes i gjeldende ramme.
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
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;

    const inFrame = typeof window !== "undefined" && window.top !== window.self;
    if (!inFrame) return; // vanlig fane: la nettleseren håndtere target="_blank"

    // I innebygd kontekst kan target="_blank" havne i selve rammen.
    // Blokker standardatferden og åpne eksplisitt et nytt toppnivåvindu.
    event.preventDefault();
    let opened: Window | null = null;
    try {
      opened = window.open(href, "_blank", "noopener,noreferrer");
    } catch {
      opened = null;
    }
    if (opened) {
      opened.opener = null;
      return;
    }
    // Popup blokkert av rammen: kopier lenken i stedet for å laste den innebygd.
    const copy = navigator?.clipboard?.writeText?.(href);
    if (copy && typeof copy.then === "function") {
      copy.then(
        () => toast.success("Lenken er kopiert. Lim den inn i en ny fane."),
        () => toast.error("Kunne ikke åpne lenken her. Åpne appen i egen fane."),
      );
    } else {
      toast.error("Kunne ikke åpne lenken her. Åpne appen i egen fane.");
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
