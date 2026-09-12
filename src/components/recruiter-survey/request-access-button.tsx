import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const SURVEY_ACCESS_EMAIL = "undersokelse@karrierenmin.no";

const SUBJECT = "Forespørsel om full tilgang til Rekruttererundersøkelsen";
const BODY = `Hei,

Jeg ønsker tilgang til den fullstendige resultatsiden for Rekruttererundersøkelsen.

Navn:
Selskap:
E-post:

Vennlig hilsen`;

export const surveyAccessMailto = `mailto:${SURVEY_ACCESS_EMAIL}?subject=${encodeURIComponent(
  SUBJECT,
)}&body=${encodeURIComponent(BODY)}`;

export function RequestFullAccessButton({
  variant = "outline",
  label = "Be om full tilgang",
}: {
  variant?: "default" | "outline";
  label?: string;
}) {
  async function handleClick() {
    if (typeof window === "undefined") return;
    try {
      window.location.href = surveyAccessMailto;
    } catch {
      /* ignore */
    }
    try {
      await navigator.clipboard.writeText(SURVEY_ACCESS_EMAIL);
      toast.success(`E-postadressen ${SURVEY_ACCESS_EMAIL} er kopiert`, {
        description: "Åpnes ikke e-postprogrammet? Lim inn adressen der du sender e-post.",
      });
    } catch {
      toast.message(`Send e-post til ${SURVEY_ACCESS_EMAIL}`);
    }
  }

  return (
    <Button variant={variant} onClick={handleClick}>
      {label}
    </Button>
  );
}
