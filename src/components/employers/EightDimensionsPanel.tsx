import { Badge } from "@/components/ui/badge";
import { LoginCta } from "./LoginCta";

const DIMENSJONER = [
  { key: "culture", no: "Kultur og verdier", en: "Culture and Values" },
  { key: "leadership", no: "Ledelseskvalitet", en: "Leadership Quality" },
  { key: "work_env", no: "Arbeidsmiljø", en: "Work Environment" },
  { key: "career", no: "Karriereutvikling", en: "Career Development" },
  { key: "financial", no: "Finansiell stabilitet", en: "Financial Stability" },
  { key: "mission", no: "Formål og samfunnsoppdrag", en: "Mission and Purpose" },
  { key: "talent", no: "Evne til å tiltrekke og beholde talent", en: "Talent Attraction and Retention" },
  { key: "diversity", no: "Mangfold og inkludering", en: "Diversity and Inclusion" },
] as const;

/**
 * 8-dimensjons extended-arbeidsgiveranalyse. UI-skall — ingen data ennå.
 * Holdes adskilt fra den eksisterende 6-dim AI-vurderingen.
 */
export function EightDimensionsPanel({ orgnr }: { orgnr: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Extended arbeidsgiveranalyse. Vurdering på 8 dimensjoner basert på offentlige kilder.
        Dette er <strong className="text-foreground">ikke</strong> det samme som den eksisterende
        AI-vurderingen med 6 dimensjoner lenger ned.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DIMENSJONER.map((dim) => (
          <article key={dim.key} className="rounded-lg border border-border bg-card p-3">
            <header className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">{dim.no}</h4>
                <p className="text-xs text-muted-foreground">{dim.en}</p>
              </div>
              <Badge variant="outline" className="font-normal whitespace-nowrap">
                Ikke analysert ennå
              </Badge>
            </header>
            <p className="mt-2 text-sm text-muted-foreground">
              Når extended-analyse er kjørt, vises score (1,0–5,0), styrker, risiko/gap, kilder og
              sist oppdatert her.
            </p>
          </article>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border p-3">
        <p className="text-sm text-muted-foreground">
          Extended-analyse krever innlogging. Resultatene lagres og deles aggregert.
        </p>
        <LoginCta
          label="Logg inn for å starte extended analyse"
          redirectTo={`/arbeidsgivere/${orgnr}`}
        />
      </div>
    </div>
  );
}
