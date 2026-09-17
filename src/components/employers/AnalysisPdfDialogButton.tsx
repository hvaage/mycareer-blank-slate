/**
 * Nedlasting av arbeidsgiveranalysen for innlogget bruker.
 *
 * Brukeren velger selv om rapporten skal inneholde egne/andres vurderinger,
 * jobbsøkerperspektivet og den personlige matchen. Ingenting personlig tas med
 * uten et aktivt valg.
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EmployerAnalysisViewEnvelope } from "@/lib/queries/employer-analysis-view";
import { candidateFitUiState, displayCandidateFitReasoning } from "@/lib/queries/companies";
import type { UserRatingRow } from "@/lib/queries/companies";
import type { PdfPersonalData } from "@/lib/employers/analysis-pdf";

const MY_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "culture_score", label: "Kultur og verdier" },
  { key: "leadership_score", label: "Ledelseskvalitet" },
  { key: "work_environment_score", label: "Arbeidsmiljø" },
  { key: "career_development_score", label: "Karriereutvikling" },
  { key: "financial_stability_score", label: "Finansiell stabilitet" },
  { key: "mission_score", label: "Formål og misjon" },
  { key: "overall_score", label: "Helhetsinntrykk" },
];

const AGG_DIMENSIONS: Array<{ key: string; label: string }> = MY_DIMENSIONS.map((d) => ({
  key: `agg_${d.key}`,
  label: d.label,
}));

const FLAG_LABELS: Array<{ key: string; label: string }> = [
  { key: "applied_here", label: "Har søkt her" },
  { key: "interviewed_here", label: "Har vært i intervju" },
  { key: "worked_here", label: "Har jobbet her" },
];

function num(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function buildPersonalData(
  myRating: UserRatingRow | null,
  company: Record<string, unknown> | null,
): PdfPersonalData {
  const r = (myRating ?? {}) as Record<string, unknown>;
  const c = company ?? {};
  const fitState = candidateFitUiState(myRating);
  const notesRaw = r["ai_candidate_scenario_notes"];
  return {
    reviews: {
      mine: myRating
        ? {
            items: MY_DIMENSIONS.map((d) => ({ label: d.label, value: num(r[d.key]) })),
            notes: (r["user_notes"] as string | null) ?? null,
            flags: FLAG_LABELS.filter((f) => Boolean(r[f.key])).map((f) => f.label),
          }
        : null,
      aggregate: {
        count: num(c["agg_rating_count"]) ?? 0,
        items: AGG_DIMENSIONS.map((d) => ({ label: d.label, value: num(c[d.key]) })),
      },
    },
    fit: {
      state: fitState,
      score: num(r["ai_candidate_fit_score"]),
      reasoning: displayCandidateFitReasoning(
        (r["ai_candidate_fit_reasoning"] as string | null) ?? "",
      ),
      scenarioNotes: Array.isArray(notesRaw)
        ? notesRaw.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        : [],
    },
  };
}

type Props = {
  envelope: EmployerAnalysisViewEnvelope;
  myRating: UserRatingRow | null;
  company: Record<string, unknown> | null;
  className?: string;
};

export function AnalysisPdfDialogButton({ envelope, myRating, company, className }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [includeJobseekerMeaning, setJobseeker] = useState(true);
  const [includeUserReviews, setReviews] = useState(false);
  const [includePersonalFit, setFit] = useState(false);

  async function handleDownload() {
    setBusy(true);
    try {
      const { downloadEmployerAnalysisPdf } = await import("@/lib/employers/analysis-pdf");
      const filename = await downloadEmployerAnalysisPdf(envelope, {
        options: { includeJobseekerMeaning, includeUserReviews, includePersonalFit },
        personal: buildPersonalData(myRating, company),
      });
      toast.success("PDF er lastet ned", { description: filename });
      setOpen(false);
    } catch (e) {
      toast.error("Kunne ikke lage PDF", {
        description: e instanceof Error ? e.message : "Ukjent feil",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={className}>
          <Download className="h-4 w-4" /> Last ned som PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Last ned arbeidsgiveranalysen</DialogTitle>
          <DialogDescription>
            Velg hva rapporten skal inneholde. Analysen av selskapet er alltid med.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex items-start gap-3">
            <Checkbox
              checked={includeUserReviews}
              onCheckedChange={(v) => setReviews(v === true)}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <Label className="cursor-pointer">Ta med vurderinger av selskapet</Label>
              <p className="text-xs text-muted-foreground">
                Din egen vurdering og gjennomsnittet fra andre brukere.
              </p>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <Checkbox
              checked={includeJobseekerMeaning}
              onCheckedChange={(v) => setJobseeker(v === true)}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <Label className="cursor-pointer">Ta med «Hva dette betyr for en jobbsøker»</Label>
              <p className="text-xs text-muted-foreground">
                Den generelle jobbsøkervinklingen under hver dimensjon.
              </p>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <Checkbox
              checked={includePersonalFit}
              onCheckedChange={(v) => setFit(v === true)}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <Label className="cursor-pointer">
                Ta med hvordan selskapet passer meg som ansatt
              </Label>
              <p className="text-xs text-muted-foreground">
                Din personlige match, begrunnelse og scenarienotater.
              </p>
            </span>
          </label>

          {includeUserReviews || includePersonalFit ? (
            <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              Rapporten vil inneholde personlige opplysninger om deg. Del den med omhu.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button type="button" onClick={handleDownload} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? "Lager PDF …" : "Last ned"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
