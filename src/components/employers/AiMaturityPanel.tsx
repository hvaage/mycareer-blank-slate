import { Badge } from "@/components/ui/badge";
import type { EmployerDetail } from "@/lib/queries/employer-insight";

/**
 * AI-kompetanse / AI-modenhet — konsolidert panel.
 *
 * Fem signaldimensjoner med en samlet score som er gjennomsnittet av dimensjonene.
 * Vekting kommer senere (admin + bruker) når analysedelen legges på.
 *
 * Inntil dedikerte AI-maturity-felt finnes i registeret, mapper vi eksisterende
 * 6-dim AI-vurdering inn på de fem signalområdene:
 *   - Strategi og lederskap   ← ai_leadership_score
 *   - Kapabilitet og distribusjon ← ai_culture_score
 *   - Arbeidsstyrke            ← ai_career_development_score
 *   - Styring og ansvarlig bruk ← ai_mission_score
 *   - Marked og produkt        ← ai_work_environment_score
 */

const DIMENSIONS: Array<{
  key: string;
  label: string;
  source: keyof EmployerDetail;
  placeholder: string;
}> = [
  {
    key: "strategy",
    label: "Strategi og lederskap",
    source: "ai_leadership_score",
    placeholder: "Strategiske AI-initiativ, eierskap i ledelsen og uttalt satsing.",
  },
  {
    key: "capability",
    label: "Kapabilitet og distribusjon",
    source: "ai_culture_score",
    placeholder: "AI-produkter og -tjenester i drift, skala og distribusjon.",
  },
  {
    key: "workforce",
    label: "Arbeidsstyrke",
    source: "ai_career_development_score",
    placeholder: "AI-rekruttering, kompetansebygging og akademiske samarbeid.",
  },
  {
    key: "governance",
    label: "Styring og ansvarlig bruk",
    source: "ai_mission_score",
    placeholder: "Formell AI-styring, policy, ISO 42001 / EU AI Act.",
  },
  {
    key: "market",
    label: "Marked og produkt",
    source: "ai_work_environment_score",
    placeholder: "AI i markedstilbud, kundeverdi og produktposisjonering.",
  },
];

export function AiMaturityPanel({ d }: { d: EmployerDetail }) {
  const scores = DIMENSIONS.map((dim) => {
    const v = d[dim.source];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  });

  const present = scores.filter((s): s is number => s !== null);
  const computedAvg = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
  const overall = computedAvg ?? (typeof d.ai_overall_score === "number" ? d.ai_overall_score : null);

  const notes =
    typeof d.ai_dimension_notes === "string"
      ? (d.ai_dimension_notes as string)
      : null;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">AI-kompetanse</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Vurdering av hvor fremtidsrettet selskapet er i bruk, implementering og
          utnyttelse av kunstig intelligens. Kun i utvidet rapport.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 border-l-4 border-primary bg-muted/40 px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            AI-modenhet
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {overall !== null ? overall.toFixed(1).replace(".", ",") : "—"}
            </span>
            <span className="text-sm text-muted-foreground">/ 5,0</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Samlet score er gjennomsnitt av de fem dimensjonene. Vekting kan justeres av
          admin og bruker i en senere versjon.
        </p>
      </div>

      {notes && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          {notes}
        </p>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <tbody>
            {DIMENSIONS.map((dim, i) => {
              const score = scores[i];
              return (
                <tr key={dim.key} className="border-b border-border last:border-0 align-top">
                  <th
                    scope="row"
                    className="w-1/3 bg-muted/40 px-4 py-3 text-left font-medium text-foreground"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{dim.label}</span>
                      {score !== null ? (
                        <Badge variant="secondary" className="font-normal tabular-nums">
                          {score.toFixed(1).replace(".", ",")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="font-normal">
                          Ikke vurdert
                        </Badge>
                      )}
                    </div>
                  </th>
                  <td className="px-4 py-3 text-muted-foreground">{dim.placeholder}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Sentral evidens og kilder vises her når extended-analyse er kjørt for arbeidsgiveren.
      </p>
    </div>
  );
}
