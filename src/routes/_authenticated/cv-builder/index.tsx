import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FileText } from "lucide-react";
import { ComingSoonStub } from "@/components/coming-soon-stub";

const cvBuilderSearchSchema = z.object({
  type: z.enum(["general", "tailored"]).optional(),
  lang: z.enum(["no", "en"]).optional(),
  translate: z.boolean().optional(),
  applicationId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/cv-builder/")({
  validateSearch: cvBuilderSearchSchema,
  component: CvBuilderPage,
});

function CvBuilderPage() {
  const { type, lang, translate } = Route.useSearch();

  let title = "CV-bygger";
  let translateNote: string | null = null;
  if (type === "general") {
    const langLabel = lang === "en" ? "engelsk" : lang === "no" ? "norsk" : null;
    title = langLabel ? `Generer generell ${langLabel} CV` : "Generer generell CV";
    if (translate && lang) {
      const other = lang === "no" ? "engelsk" : "norsk";
      translateNote = `CV-en oversettes automatisk til ${other} med formelt forretningsspråk slik at de to versjonene holdes synkronisert.`;
    } else if (lang) {
      translateNote = "Du har valgt å ikke oversette automatisk. Den andre språkversjonen må genereres separat.";
    }
  } else if (type === "tailored") {
    title = "Generer tilpasset CV";
  }

  return (
    <ComingSoonStub
      icon={FileText}
      title={title}
      description={`Generer en tilpasset CV på norsk eller engelsk basert på din karriereoversikt og den spesifikke stillingen du søker på.${translateNote ? "\n\n" + translateNote : ""}`}
      features={[
        "CV bygget fra strukturert karriereoversikt",
        "Generell versjon (norsk og engelsk) eller tilpasset en spesifikk stilling",
        "Automatisk oversettelse til andre språk med formelt forretningsspråk",
        "Eksport til PDF og Word",
        "Tilpasset stillingsannonsens nøkkelord ved tilpasset versjon",
      ]}
    />
  );
}
