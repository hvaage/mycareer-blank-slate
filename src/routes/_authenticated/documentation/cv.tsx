// @ts-nocheck
// ============================================================
// Min dokumentasjon → CV-er
// Ett sted som viser alle CV-er, med tydelig skille mellom
// kildedokumenter (importert grunnlag) og søknadsklare CV-er.
// Ingen opplasting her — den skjer under «Importer eksisterende CV».
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/lib/auth-context";
import { useUserImports } from "@/lib/queries/cv-imports";
import { useArchivedCvSources } from "@/lib/queries/cv-archive-sources";
import {
  useGeneratedGeneralCvs,
  useGeneratedTailoredCvs,
  downloadDocument,
} from "@/lib/queries/cv-archive";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Download, FileText, Sparkles, Upload } from "lucide-react";

export const Route = createFileRoute("/_authenticated/documentation/cv")({
  head: () => ({
    meta: [
      { title: "CV-er — Min dokumentasjon — Karrierenmin" },
      {
        name: "description",
        content:
          "Samlet oversikt over importerte kilde-CV-er og søknadsklare CV-er generert fra karriereoversikten din.",
      },
      { property: "og:title", content: "CV-er — Min dokumentasjon" },
      {
        property: "og:description",
        content: "Se hvilke CV-er som er kildedokumenter og hvilke som kan sendes med søknader.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentationCvPage,
});

const IMPORT_STATUS_LABEL: Record<string, string> = {
  pending: "Venter på analyse",
  processing: "Analyseres",
  parsed: "Analysert — venter på gjennomgang",
  committed: "Gjennomgått",
  failed: "Analysen feilet",
};

function openDoc(path: string | null | undefined) {
  if (!path) {
    toast.error("Filen mangler en lagret sti.");
    return;
  }
  downloadDocument(path).catch((e) =>
    toast.error(e instanceof Error ? e.message : "Kunne ikke åpne filen"),
  );
}

function FileRow({
  title,
  meta,
  badge,
  badgeVariant = "secondary",
  onOpen,
}: {
  title: string;
  meta: string | null;
  badge: string;
  badgeVariant?: "secondary" | "default" | "outline";
  onOpen?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-start gap-2.5">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={badgeVariant} className="font-normal">
          {badge}
        </Badge>
        {onOpen ? (
          <Button size="sm" variant="ghost" onClick={onOpen}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Åpne
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DocumentationCvPage() {
  const { user } = useAuth();
  const uid = user?.id;

  const imports = useUserImports(uid);
  const archived = useArchivedCvSources(uid);
  const general = useGeneratedGeneralCvs(uid);
  const tailored = useGeneratedTailoredCvs(uid);

  const isLoading =
    imports.isLoading || archived.isLoading || general.isLoading || tailored.isLoading;

  const uploadedFiles = (archived.data ?? []).filter(
    (s) => s.group === "Egne CV-er (opplastet)",
  );
  const importRows = imports.data ?? [];
  const generalRows = general.data ?? [];
  const tailoredRows = tailored.data ?? [];

  const sourceCount = importRows.length + uploadedFiles.length;
  const readyCount = generalRows.length + tailoredRows.length;

  return (
    <DocumentationLayout>
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold tracking-tight">CV-er</CardTitle>
            <CardDescription className="max-w-3xl">
              Kilde-CV-er er filer du har importert for å bygge karriereoversikten. De er ikke
              kvalitetssikret eller ATS-vurdert, og skal ikke sendes med søknader. Søknadsklare
              CV-er lager du fra karriereoversikten under Søknader.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to="/soknadsdokumenter">Lag søknadsklar CV</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/kilder">
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Importer eksisterende CV
              </Link>
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <Card>
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Kilde-CV-er</CardTitle>
                    <CardDescription>
                      Brukes som grunnlag for karriereoversikten.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="shrink-0 font-normal">
                    Ikke for innsending
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {sourceCount === 0 ? (
                  <EmptyState
                    icon={Upload}
                    title="Ingen kilde-CV-er ennå"
                    description="Importer en eksisterende CV for å bygge karriereoversikten."
                  />
                ) : (
                  <div>
                    {importRows.map((row) => (
                      <FileRow
                        key={row.id}
                        title={row.source_filename ?? "CV-import"}
                        meta={[
                          IMPORT_STATUS_LABEL[row.status] ?? row.status,
                          row.created_at ? fmtDate(row.created_at) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        badge="Kildedokument"
                        badgeVariant="outline"
                      />
                    ))}
                    {uploadedFiles.map((f) => (
                      <FileRow
                        key={f.key}
                        title={f.label}
                        meta={[f.filename, f.updatedAt ? fmtDate(f.updatedAt) : null]
                          .filter(Boolean)
                          .join(" · ")}
                        badge="Kildedokument"
                        badgeVariant="outline"
                        onOpen={() => openDoc(f.path)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Søknadsklare CV-er</CardTitle>
                    <CardDescription>
                      Generert fra bekreftet karriereoversikt — generelle og stillingstilpassede.
                    </CardDescription>
                  </div>
                  <Badge className="shrink-0 font-normal">Klar for innsending</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {readyCount === 0 ? (
                  <EmptyState
                    icon={Sparkles}
                    title="Ingen søknadsklare CV-er ennå"
                    description="Lag en generell eller stillingstilpasset CV fra karriereoversikten din."
                  />
                ) : (
                  <div>
                    {generalRows.map((d) => (
                      <FileRow
                        key={d.id}
                        title={d.title ?? d.file_name ?? "Generell CV"}
                        meta={[
                          "Generell CV",
                          d.render_language === "en" ? "engelsk" : "norsk",
                          d.version ? `v${d.version}` : null,
                          d.created_at ? fmtDate(d.created_at) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        badge="Klar for innsending"
                        onOpen={() => openDoc(d.file_path)}
                      />
                    ))}
                    {tailoredRows.map((d) => (
                      <FileRow
                        key={d.id}
                        title={d.title ?? d.file_name ?? "Stillingstilpasset CV"}
                        meta={[
                          "Stillingstilpasset",
                          d.applications?.company_name ?? d.company_name,
                          d.applications?.role_title,
                          d.created_at ? fmtDate(d.created_at) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        badge="Klar for innsending"
                        onOpen={() => openDoc(d.file_path)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DocumentationLayout>
  );
}
