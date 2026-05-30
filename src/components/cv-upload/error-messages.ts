import { normalizeAiErrorMessage } from "@/lib/ai-ux-messages";

export const errorMessages: Record<string, string> = {
  unauthorized: "Du må være innlogget for å laste opp CV.",
  invalid_input: "Filen kunne ikke leses. Sjekk at det er en gyldig PDF eller DOCX.",
  forbidden_path: "Du har ikke tilgang til denne filen.",
  method_not_allowed: "Teknisk feil. Prøv igjen.",
  database_error: "Kunne ikke lagre dataene. Prøv igjen om litt.",
  not_found: "Importen ble ikke funnet. Last opp filen på nytt.",
  invalid_status: "Importen er i feil tilstand. Last opp filen på nytt.",
  already_committed: "Denne filen er allerede importert.",
  download_failed: "Kunne ikke lese filen fra lager. Last opp på nytt.",
  parse_failed: "Vi klarte ikke å hente innholdet fra filen. Sjekk at den ikke er passordbeskyttet eller skannet som bilde.",
  claude_api_error:
    "AI-tjenesten returnerte en feil. Prøv igjen om litt, eller bruk en mindre fil.",
  schema_invalid: "AI returnerte data i uventet format. Prøv å laste opp filen på nytt.",
  internal_error: "Uventet feil under analyse. Prøv igjen.",
  ai_failed: "AI-tjenesten er ikke tilgjengelig akkurat nå. Prøv igjen om noen minutter.",
  ai_invalid_json: "Vi fikk uventet svar fra AI. Prøv igjen.",
  conversion_failed: "Vi klarte ikke å konvertere innholdet. Prøv en annen fil.",
  rate_limited: "For mange forespørsler. Vent litt og prøv igjen.",
  payment_required: "AI-kvoten er brukt opp. Kontakt support.",
  upload_failed: "Opplastingen feilet. Sjekk nettverket og prøv igjen.",
  file_too_large: "Filen er større enn 10 MB.",
  unsupported_format: "Bare PDF og DOCX er støttet.",
  unknown: "Noe gikk galt. Prøv igjen.",
};

export function messageFor(code: string, fallback?: string): string {
  const mapped = errorMessages[code];
  if (mapped) return mapped;
  return normalizeAiErrorMessage(fallback ?? "", { kind: "generic" });
}
