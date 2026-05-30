import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  generatedApplicationsListQuery,
  GENERATED_STATUSES,
} from "@/lib/queries/generated-applications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Send, Building2, MapPin, ExternalLink, FileText, Bell,
  Calendar, ChevronDown, CheckCircle2,
} from "lucide-react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fmtDate } from "@/lib/format";
import { CompanyAnalysisCard } from "@/components/company-analysis-card";
import { ProcessRatingDialog } from "@/components/process-rating-dialog";
import { isJobviewtrackUrl, preferredCareerjetBrowseUrl } from "@/lib/careerjet-links";

export const Route = createFileRoute("/_authenticated/my-applications")({
  component: MyApplicationsPage,
});

const STATUS_LABELS: Record<string, string> = {
  søknad_generert: "Søknad generert",
  søknad_sendt: "Søknad sendt",
  screening: "Screening",
  intervju_1: "1. intervju",
  intervju_2: "2. intervju",
  intervju_3: "3. intervju",
  intervju_4: "4. intervju",
  case_study: "Case",
  candidate_profiling: "Kandidatprofilering",
  tilbud_mottatt: "Tilbud mottatt",
};

function MyApplicationsPage() {
  const appsQ = useQuery(generatedApplicationsListQuery());

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Send className="h-5 w-5 sm:h-6 sm:w-6 text-primary" /> Mine genererte søknader
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Søknader hvor du har generert et brev. Følg opp status, neste aktivitet og purring her.
        </p>
      </div>

      {appsQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !appsQ.data?.length ? (
        <EmptyState
          title="Ingen genererte søknader ennå"
          description="Generer et søknadsbrev fra Søknader-siden for å flytte en record hit."
        />
      ) : (
        <div className="space-y-4">
          {appsQ.data.map((app: any) => (
            <ApplicationCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationCard({ app }: { app: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);

  const docs = useMemo(() => {
    const rows = (app.documents ?? []) as any[];
    return [...rows].sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
    );
  }, [app.documents]);

  const letterDoc = useMemo(
    () => docs.find((d: any) => d.document_type === "søknadsbrev"),
    [docs],
  );
  const matchDoc = useMemo(
    () =>
      docs.find(
        (d: any) =>
          d.document_type === "annet" &&
          /kandidatmatch|match assessment/i.test(d.title ?? ""),
      ),
    [docs],
  );
  const jobAnalysisDoc = useMemo(
    () => docs.find((d: any) => /stillingsanalyse/i.test(d.title ?? "")),
    [docs],
  );
  const companyResearchDoc = useMemo(
    () => docs.find((d: any) => /selskapsresearch/i.test(d.title ?? "")),
    [docs],
  );

  const companyQ = useQuery({
    queryKey: ["application-company", app.company_id],
    enabled: !!app.company_id,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      const [companyRes, ratingRes] = await Promise.all([
        supabase.from("companies").select("*").eq("id", app.company_id).maybeSingle(),
        uid
          ? supabase
              .from("user_company_ratings")
              .select("ai_candidate_fit_score, ai_candidate_fit_reasoning")
              .eq("user_id", uid)
              .eq("company_id", app.company_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
      ]);
      if (companyRes.error) throw companyRes.error;
      return {
        company: companyRes.data,
        myRating: (ratingRes as any).data ?? null,
      };
    },
  });

  const displayJobUrl =
    preferredCareerjetBrowseUrl({
      sourceUrl: app.job_url,
      title: app.role_title,
      company: app.company_name,
      location: app.location,
    }) ?? app.job_url;

  const update = async (patch: Record<string, any>) => {
    const { error } = await (supabase.from("applications") as any)
      .update(patch)
      .eq("id", app.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["applications"] });
    if (patch.status === "avsluttet" || patch.status === "trukket") {
      setRatingOpen(true);
    }
  };

  const cvUrl = useQuery({
    queryKey: ["cv-signed-url", app.cv_used_path],
    enabled: open && !!app.cv_used_path,
    queryFn: async () => {
      const { data } = await supabase.storage
        .from("cv-uploads")
        .createSignedUrl(app.cv_used_path, 3600);
      return data?.signedUrl ?? null;
    },
  });

  return (
    <>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{app.role_title ?? "Ukjent rolle"}</CardTitle>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1 text-base font-semibold text-foreground"><Building2 className="h-4 w-4" />{app.company_name}</span>
              {app.location && (
                <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{app.location}</span>
              )}
              {app.salary_text && <span>{app.salary_text}</span>}
              {app.ai_score != null && (
                <span className="font-medium">Score: {app.ai_score}</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
              {app.letter_generated_at && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Generert {fmtDate(app.letter_generated_at)}
                </span>
              )}
              {app.source && <Badge variant="secondary" className="text-[10px] font-normal">{app.source}</Badge>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant={letterDoc ? "default" : "outline"} className="text-[10px]">Søknadsbrev</Badge>
              <Badge variant={matchDoc ? "default" : "outline"} className="text-[10px]">Kandidatmatch</Badge>
              <Badge variant={jobAnalysisDoc ? "default" : "outline"} className="text-[10px]">Stillingsanalyse</Badge>
              <Badge variant={companyResearchDoc ? "default" : "outline"} className="text-[10px]">Selskapsresearch</Badge>
              <Badge variant={app.company_id ? "default" : "outline"} className="text-[10px]">Selskapsprofil</Badge>
            </div>
          </div>
          <Badge variant="outline">{STATUS_LABELS[app.status] ?? app.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select
              value={app.status}
              onValueChange={(v) => update({ status: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GENERATED_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>
                ))}
                <SelectItem value="avsluttet">Avsluttet</SelectItem>
                <SelectItem value="trukket">Trukket</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sendt-dato</Label>
            <Input
              type="date"
              defaultValue={app.letter_sent_at ? app.letter_sent_at.slice(0, 10) : ""}
              onBlur={(e) =>
                update({
                  letter_sent_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Neste aktivitet</Label>
            <Input
              type="date"
              defaultValue={app.next_followup_at ?? ""}
              onBlur={(e) => update({ next_followup_at: e.target.value || null })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Purring</Label>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => update({ reminder_sent_at: new Date().toISOString() })}
            >
              <Bell className="h-4 w-4 mr-2" />
              {app.reminder_sent_at
                ? `Purret ${fmtDate(app.reminder_sent_at)}`
                : "Marker purret"}
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Kontaktperson</Label>
            <Input
              defaultValue={app.contact_name ?? ""}
              placeholder="Navn"
              onBlur={(e) => update({ contact_name: e.target.value || null })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Kontakt e-post</Label>
            <Input
              type="email"
              defaultValue={app.contact_email ?? ""}
              placeholder="navn@firma.no"
              onBlur={(e) => update({ contact_email: e.target.value || null })}
            />
          </div>
        </div>

        {(app.contact_name || app.contact_email) && (
          <p className="text-xs text-muted-foreground">
            {app.contact_name && <span className="font-medium text-foreground">{app.contact_name}</span>}
            {app.contact_name && app.contact_email && " · "}
            {app.contact_email}
          </p>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Oppfølgingsnotater</Label>
          <Textarea
            rows={2}
            defaultValue={app.followup_notes ?? ""}
            placeholder="F.eks. «Sendt purring 12. mai», «Skal høre tilbake i uke 24»…"
            onBlur={(e) => update({ followup_notes: e.target.value || null })}
          />
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground pt-2 border-t">
          {app.letter_generated_at && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Brev generert {fmtDate(app.letter_generated_at)}
            </span>
          )}
          {displayJobUrl && (
            <a
              href={displayJobUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {isJobviewtrackUrl(app.job_url) ? "Åpne Careerjet-søk" : "Åpne annonse"}
            </a>
          )}
          {isJobviewtrackUrl(app.job_url) && (
            <span className="text-[11px] text-muted-foreground max-w-xs">
              Sporings-URL fra Careerjet kan gi 404; vi bruker søk der det er tryggere.
            </span>
          )}
          {app.cv_used_language && (
            <span>CV brukt: {app.cv_used_language === "en" ? "Engelsk" : "Norsk"}</span>
          )}
          <Link to="/applications/$id" params={{ id: app.id }} className="text-primary hover:underline ml-auto">
            Full søknadsside →
          </Link>
        </div>

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />
              {open ? "Skjul detaljer" : "Vis brev, CV og selskapsanalyse"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">
            {(app.ai_match_highlights || app.ai_concerns || app.ai_reasoning) && (
              <section className="space-y-2">
                <h4 className="text-sm font-semibold">AI-vurdering av leadet</h4>
                {app.ai_match_highlights && (
                  <div className="text-xs rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 p-2">
                    <span className="font-medium">Match: </span>{app.ai_match_highlights}
                  </div>
                )}
                {app.ai_concerns && (
                  <div className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 p-2">
                    <span className="font-medium">Bekymringer: </span>{app.ai_concerns}
                  </div>
                )}
                {app.ai_reasoning && (
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap">{app.ai_reasoning}</div>
                )}
              </section>
            )}

            {cvUrl.data && (
              <section>
                <h4 className="text-sm font-semibold mb-1">Valgt CV</h4>
                <a
                  href={cvUrl.data}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1 text-sm"
                >
                  <FileText className="h-4 w-4" /> Åpne CV ({app.cv_used_language === "en" ? "Engelsk" : "Norsk"})
                </a>
              </section>
            )}

            {jobAnalysisDoc?.content_text && (
              <section>
                <h4 className="text-sm font-semibold mb-1">Stillingsanalyse</h4>
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-3 bg-muted/20">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{jobAnalysisDoc.content_text}</ReactMarkdown>
                </div>
              </section>
            )}

            {companyResearchDoc?.content_text && (
              <section>
                <h4 className="text-sm font-semibold mb-1">Selskapsresearch</h4>
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-3 bg-muted/20">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{companyResearchDoc.content_text}</ReactMarkdown>
                </div>
              </section>
            )}

            {companyQ.data?.company && (
              <section>
                <h4 className="text-sm font-semibold mb-2">Selskapsanalyse</h4>
                <CompanyAnalysisCard
                  company={companyQ.data.company}
                  candidateFitScore={companyQ.data.myRating?.ai_candidate_fit_score ?? null}
                  candidateFitReasoning={companyQ.data.myRating?.ai_candidate_fit_reasoning ?? null}
                />
              </section>
            )}

            {matchDoc?.content_text && (
              <section>
                <h4 className="text-sm font-semibold mb-1">Kandidatmatch</h4>
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-3 bg-muted/20">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{matchDoc.content_text}</ReactMarkdown>
                </div>
              </section>
            )}

            {letterDoc?.content_text && (
              <section>
                <h4 className="text-sm font-semibold mb-1">Søknadsbrev</h4>
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-3 bg-muted/20">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{letterDoc.content_text}</ReactMarkdown>
                </div>
              </section>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
    <ProcessRatingDialog
      open={ratingOpen}
      onOpenChange={setRatingOpen}
      applicationId={app.id}
      companyId={app.company_id ?? null}
      companyName={app.company_name}
      onSubmitted={() => qc.invalidateQueries({ queryKey: ["application-company", app.company_id] })}
    />
    </>
  );
}
