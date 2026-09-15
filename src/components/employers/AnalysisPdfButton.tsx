import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { EmployerAnalysisViewEnvelope } from "@/lib/queries/employer-analysis-view";

type Props = {
  envelope: EmployerAnalysisViewEnvelope;
  className?: string;
  size?: "sm" | "default";
};

/**
 * Laster ned arbeidsgiveranalysen som PDF. Eksporten bygges i nettleseren og
 * inneholder alltid kun den offentlige analysen — aldri kandidatmatch,
 * personlig vekting eller andre brukerdata.
 */
export function AnalysisPdfButton({ envelope, className, size = "sm" }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const { downloadEmployerAnalysisPdf } = await import(
        "@/lib/employers/analysis-pdf"
      );
      const filename = await downloadEmployerAnalysisPdf(envelope);
      toast.success("PDF er lastet ned", { description: filename });
    } catch (e) {
      toast.error("Kunne ikke lage PDF", {
        description: e instanceof Error ? e.message : "Ukjent feil",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      {busy ? "Lager PDF …" : "Last ned som PDF"}
    </Button>
  );
}
