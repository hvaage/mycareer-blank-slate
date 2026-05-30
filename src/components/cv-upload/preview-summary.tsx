import { Badge } from "@/components/ui/badge";
import type { PreviewCounts } from "@/types/cv-upload";

const LABELS: Array<[keyof PreviewCounts, string]> = [
  ["experience", "Stillinger"],
  ["education", "Utdanning"],
  ["skills", "Ferdigheter"],
  ["languages", "Språk"],
  ["certifications", "Sertifiseringer"],
  ["projects", "Prosjekter"],
  ["achievements", "Prestasjoner"],
];

export function PreviewSummary({ counts }: { counts: PreviewCounts }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Vi fant <strong>{counts.total}</strong> elementer i CV-en din. Bekreft for å lagre dem
        i karriereoversikten.
      </p>
      <div className="flex flex-wrap gap-2">
        {LABELS.map(([key, label]) => {
          const n = counts[key];
          if (!n) return null;
          return (
            <Badge key={key} variant="secondary">
              {label}: {n}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
