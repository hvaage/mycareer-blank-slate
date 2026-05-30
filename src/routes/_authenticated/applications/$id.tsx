// @ts-nocheck
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { applicationByIdQuery, updateApplication, deleteApplication } from "@/lib/queries/applications";
import {
  stagesQuery,
  documentsForApplicationQuery,
  meetingNotesQuery,
  nextStepsQuery,
  candidateProfileQuery,
  jobAdQuery,
  changeLogQuery,
} from "@/lib/queries/sub-resources";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge, PriorityBadge, SentimentBadge, StarToggle, RatingStars } from "@/components/badges";
import { AutoSaveTextarea, AutoSaveInput } from "@/components/auto-save";
import { InlineEdit } from "@/components/inline-edit";
import {
  STATUS_ORDER, STATUS_LABELS, PRIORITY_LABELS,
  STAGE_TYPE_LABELS, STAGE_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS, SENTIMENT_LABELS,
} from "@/lib/constants";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ArrowLeft, Plus, Trash2, ExternalLink, ChevronUp, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const tabSchema = z.object({
  tab: z.enum(["oversikt", "prosess", "dokumenter", "moter", "neste", "kandidat", "logg"]).optional(),
});

export const Route = createFileRoute("/_authenticated/applications/$id")({
  validateSearch: (s) => tabSchema.parse(s),
  component: ApplicationDetail,
});

function ApplicationDetail() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/applications/$id" });
  const qc = useQueryClient();

  const appQ = useQuery(applicationByIdQuery(id));

  const subs = useQueries({
    queries: [
      stagesQuery(id),
      documentsForApplicationQuery(id),
      meetingNotesQuery(id),
      nextStepsQuery(id),
      candidateProfileQuery(id),
      jobAdQuery(id),
      changeLogQuery(id),
    ],
  });
  const [stagesQ, docsQ, meetingsQ, stepsQ, candQ, jobAdQ, logQ] = subs;

  const upd = useMutation({
    mutationFn: (patch: any) => updateApplication(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["applications"] }),
  });

  const del = useMutation({
    mutationFn: () => deleteApplication(id),
    onSuccess: () => {
      toast.success("Søknad slettet");
      navigate({ to: "/applications" });
    },
  });

  if (appQ.isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }
  if (!appQ.data) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <EmptyState
          title="Søknad ikke funnet"
          action={<Button asChild><Link to="/applications">Tilbake til søknader</Link></Button>}
        />
      </div>
    );
  }

  const a = appQ.data;
  const tab = search.tab ?? "oversikt";
  const setTab = (t: string) => navigate({ search: { tab: t as any } });

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/applications"><ArrowLeft className="h-4 w-4 mr-2" /> Tilbake</Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-3">
            <StarToggle
              value={!!a.is_starred}
              onChange={(v) => upd.mutate({ is_starred: v })}
            />
            <InlineEdit
              value={a.company_name ?? ""}
              onSave={(v: string) => upd.mutateAsync({ company_name: v })}
              required
              label="Bedrift"
              successMessage="Bedriftsnavn lagret"
              className="text-2xl font-bold h-auto py-1 border-0 shadow-none px-2 -mx-2 hover:bg-accent/40 focus-visible:bg-background focus-visible:ring-1 md:text-2xl"
              placeholder="Bedriftsnavn"
            />
          </div>
          <InlineEdit
            value={a.role_title ?? ""}
            onSave={(v: string) => upd.mutateAsync({ role_title: v || null })}
            label="Rolle"
            successMessage="Rolle lagret"
            className="text-muted-foreground border-0 shadow-none px-2 -mx-2 hover:bg-accent/40 focus-visible:bg-background focus-visible:ring-1"
            placeholder="Rolle / stillingstittel"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Select value={a.status ?? undefined} onValueChange={(v) => upd.mutate({ status: v })}>
              <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={a.priority ?? undefined} onValueChange={(v) => upd.mutate({ priority: v })}>
              <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <RatingStars value={a.rating ?? undefined} onChange={(n) => upd.mutate({ rating: n })} />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (confirm("Slette søknad? Dette kan ikke angres.")) del.mutate();
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Slett
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="oversikt">Oversikt</TabsTrigger>
          <TabsTrigger value="prosess">Prosess</TabsTrigger>
          <TabsTrigger value="dokumenter">Dokumenter</TabsTrigger>
          <TabsTrigger value="moter">Møtenotater</TabsTrigger>
          <TabsTrigger value="neste">Neste steg</TabsTrigger>
          <TabsTrigger value="kandidat">Kandidatprofil</TabsTrigger>
          <TabsTrigger value="logg">Logg</TabsTrigger>
        </TabsList>

        <TabsContent value="oversikt" className="space-y-4">
          <OversiktTab a={a} jobAd={jobAdQ.data} applicationId={id} onChange={() => qc.invalidateQueries({ queryKey: ["job_ad", id] })} />
        </TabsContent>

        <TabsContent value="prosess">
          <ProsessTab applicationId={id} stages={stagesQ.data ?? []} loading={stagesQ.isLoading} />
        </TabsContent>

        <TabsContent value="dokumenter">
          <DokumenterTab applicationId={id} docs={docsQ.data ?? []} loading={docsQ.isLoading} />
        </TabsContent>

        <TabsContent value="moter">
          <MoterTab applicationId={id} meetings={meetingsQ.data ?? []} loading={meetingsQ.isLoading} />
        </TabsContent>

        <TabsContent value="neste">
          <NesteTab applicationId={id} steps={stepsQ.data ?? []} loading={stepsQ.isLoading} />
        </TabsContent>

        <TabsContent value="kandidat">
          <KandidatTab applicationId={id} profile={candQ.data} loading={candQ.isLoading} />
        </TabsContent>

        <TabsContent value="logg">
          <LoggTab entries={logQ.data ?? []} loading={logQ.isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- Tabs ---------- */

function OversiktTab({ a, jobAd, applicationId, onChange }: any) {
  const save = (field: string) => async (v: string) => {
    const { error } = await (supabase.from("applications") as any).update({ [field]: v || null }).eq("id", a.id);
    if (error) throw error;
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle>Detaljer</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <AutoSaveInput label="Sted" value={a.location} onSave={save("location")} />
          <AutoSaveInput label="Arbeidsform" value={a.work_type} onSave={save("work_type")} />
          <AutoSaveInput label="Bransje" value={a.industry} onSave={save("industry")} />
          <AutoSaveInput label="Selskapsstørrelse" value={a.company_size} onSave={save("company_size")} />
          <AutoSaveInput label="Søknadsdato (åååå-mm-dd)" value={a.applied_date} onSave={save("applied_date")} />
          <AutoSaveInput label="Tilgjengelig fra" value={a.available_from} onSave={save("available_from")} />
          <AutoSaveInput label="Stillingsannonse URL" value={a.job_url} onSave={save("job_url")} />
          {a.job_url && (
            <a
              href={a.job_url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              onClick={(e) => {
                e.preventDefault();
                const w = window.open(a.job_url, "_blank", "noopener,noreferrer");
                if (!w) window.top?.location.assign(a.job_url);
              }}
              className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Åpne annonse
            </a>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notater og vurdering</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <AutoSaveTextarea label="Notater" value={a.notes} onSave={save("notes")} rows={5} />
          <AutoSaveTextarea label="Intern vurdering" value={a.internal_assessment} onSave={save("internal_assessment")} rows={4} />
          <div className="grid grid-cols-2 gap-3">
            <AutoSaveInput label="Kontaktperson" value={a.contact_name} onSave={save("contact_name")} />
            <AutoSaveInput label="Kontakt telefon" value={a.contact_phone} onSave={save("contact_phone")} />
          </div>
          <AutoSaveInput label="Kontakt e-post" value={a.contact_email} onSave={save("contact_email")} />
          <div className="grid grid-cols-2 gap-3">
            <AutoSaveInput label="Rekrutterer" value={a.recruiter_name} onSave={save("recruiter_name")} />
            <AutoSaveInput label="Rekrutterer telefon" value={a.recruiter_phone} onSave={save("recruiter_phone")} />
          </div>
          <AutoSaveInput label="Rekrutterer e-post" value={a.recruiter_email} onSave={save("recruiter_email")} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Stillingsannonse</CardTitle>
          <ImportJobAdModal applicationId={applicationId} existing={jobAd} onSaved={onChange} />
        </CardHeader>
        <CardContent>
          {jobAd ? (
            <div className="space-y-4 text-sm">
              <div><span className="text-muted-foreground">Frist:</span> {fmtDate(jobAd.application_deadline)}</div>
              {jobAd.must_have_keywords?.length ? (
                <div><span className="text-muted-foreground">Må-ha:</span> {jobAd.must_have_keywords.join(", ")}</div>
              ) : null}
              {jobAd.about_role && (
                <Section title="Om rollen" markdown={jobAd.about_role} />
              )}
              {jobAd.about_company && (
                <Section title="Om selskapet" markdown={jobAd.about_company} />
              )}
              {jobAd.ideal_candidate && (
                <Section title="Hva slags person de ser etter" markdown={jobAd.ideal_candidate} />
              )}
              {jobAd.raw_text && (
                <details className="rounded-md bg-muted">
                  <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground">Vis full annonsetekst</summary>
                  <div className="max-h-96 overflow-auto p-4 prose prose-sm dark:prose-invert max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{jobAd.raw_text}</ReactMarkdown>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <EmptyState title="Ingen stillingsannonse importert" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, markdown }: { title: string; markdown: string }) {
  return (
    <div>
      <h4 className="font-semibold mb-1.5">{title}</h4>
      <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-1.5 prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

function ImportJobAdModal({ applicationId, existing, onSaved }: any) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(existing?.raw_text ?? "");
  const [url, setUrl] = useState(existing?.source_url ?? "");
  const [deadline, setDeadline] = useState(existing?.application_deadline ?? "");
  const [pdfLoading, setPdfLoading] = useState(false);

  const onPdf = async (file: File) => {
    setPdfLoading(true);
    try {
      const pdfjs: any = await import(/* @vite-ignore */ "pdfjs-dist/build/pdf.mjs" as any);
      const workerMod: any = await import(/* @vite-ignore */ "pdfjs-dist/build/pdf.worker.mjs?url" as any);
      pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      let extracted = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        extracted += content.items.map((it: any) => it.str).join(" ") + "\n\n";
      }
      setText((prev: string) => (prev ? prev + "\n\n" : "") + extracted.trim());
      toast.success(`Hentet tekst fra ${doc.numPages} side(r)`);
    } catch (err: any) {
      toast.error("Kunne ikke lese PDF: " + (err?.message ?? "ukjent feil"));
    } finally {
      setPdfLoading(false);
    }
  };

  const save = async () => {
    const deadlineMatch = text.match(/(?:frist|deadline)[^\d]{0,20}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i);
    const detectedDeadline = deadline || (deadlineMatch ? deadlineMatch[1] : null);
    const keywords = Array.from(
      text.matchAll(/(?:erfaring med|krav om|kunnskap om|må ha)\s+([A-Za-zÆØÅæøå0-9 +./#-]+)/gi)
    ).map((m: any) => String(m[1]).trim()).slice(0, 10);

    const payload: any = {
      application_id: applicationId,
      raw_text: text || null,
      source_url: url || null,
      application_deadline: detectedDeadline || null,
      must_have_keywords: keywords.length ? keywords : null,
    };

    if (existing) {
      const { error } = await supabase.from("job_ads").update(payload).eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("job_ads").insert(payload);
      if (error) return toast.error(error.message);
    }
    toast.success("Stillingsannonse lagret");
    setOpen(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">{existing ? "Rediger annonse" : "Importer annonse"}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Stillingsannonse</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          <div>
            <Label>Importer fra PDF</Label>
            <Input
              type="file"
              accept="application/pdf"
              disabled={pdfLoading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPdf(f);
              }}
            />
            {pdfLoading && <p className="text-xs text-muted-foreground mt-1">Leser PDF…</p>}
          </div>
          <div><Label>Søknadsfrist</Label><Input type="date" value={deadline ?? ""} onChange={(e) => setDeadline(e.target.value)} /></div>
          <div>
            <Label>Annonsetekst</Label>
            <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Lim inn hele annonsen, eller importer PDF…" />
            <p className="text-xs text-muted-foreground mt-1">Frist og nøkkelord forsøkes hentet automatisk.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Avbryt</Button>
          <Button onClick={save}>Lagre</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProsessTab({ applicationId, stages, loading }: any) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [stageType, setStageType] = useState("intervju_1");
  const [stageDate, setStageDate] = useState("");
  const [stageStatus, setStageStatus] = useState("planlagt");
  const [notes, setNotes] = useState("");

  const add = async () => {
    const { error } = await supabase.from("application_stages").insert({
      application_id: applicationId,
      stage_type: stageType as any,
      stage_status: stageStatus as any,
      stage_date: stageDate || null,
      stage_order: (stages.length ?? 0) + 1,
      notes: notes || null,
    });
    if (error) return toast.error(error.message);
    setOpen(false);
    setStageDate("");
    setNotes("");
    qc.invalidateQueries({ queryKey: ["stages", applicationId] });
  };

  const remove = async (id: string) => {
    if (!confirm("Slette steg?")) return;
    const { error } = await supabase.from("application_stages").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["stages", applicationId] });
  };

  const updateStage = async (id: string, patch: Record<string, any>) => {
    const { error } = await (supabase.from("application_stages") as any).update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["stages", applicationId] });
  };

  const move = async (index: number, dir: -1 | 1) => {
    const sorted = [...stages].sort((a: any, b: any) => (a.stage_order ?? 0) - (b.stage_order ?? 0));
    const target = index + dir;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[index], b = sorted[target];
    const oa = a.stage_order ?? index + 1;
    const ob = b.stage_order ?? target + 1;
    // Swap orders
    const { error: e1 } = await (supabase.from("application_stages") as any)
      .update({ stage_order: ob }).eq("id", a.id);
    const { error: e2 } = await (supabase.from("application_stages") as any)
      .update({ stage_order: oa }).eq("id", b.id);
    if (e1 || e2) return toast.error((e1 ?? e2)!.message);
    qc.invalidateQueries({ queryKey: ["stages", applicationId] });
  };

  if (loading) return <Skeleton className="h-40 w-full" />;

  const sorted = [...stages].sort((a: any, b: any) => (a.stage_order ?? 0) - (b.stage_order ?? 0));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Prosess</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-2" /> Nytt steg</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nytt prosessteg</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Type</Label>
                <Select value={stageType} onValueChange={setStageType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STAGE_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={stageStatus} onValueChange={setStageStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STAGE_STATUS_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Dato</Label><Input type="date" value={stageDate} onChange={(e) => setStageDate(e.target.value)} /></div>
              <div><Label>Notater</Label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={add}>Lagre</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!sorted.length ? (
          <EmptyState title="Ingen prosessteg ennå" />
        ) : (
          <ol className="space-y-3">
            {sorted.map((s: any, i: number) => (
              <li key={s.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1 pt-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-center text-muted-foreground">{i + 1}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={i === sorted.length - 1} onClick={() => move(i, 1)}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 grid sm:grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Type</Label>
                      <Select value={s.stage_type} onValueChange={(v) => updateStage(s.id, { stage_type: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(STAGE_TYPE_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Status</Label>
                      <Select value={s.stage_status} onValueChange={(v) => updateStage(s.id, { stage_status: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(STAGE_STATUS_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Dato</Label>
                      <Input
                        type="date"
                        className="h-8"
                        defaultValue={s.stage_date ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value || null;
                          if (v !== (s.stage_date ?? null)) updateStage(s.id, { stage_date: v });
                        }}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <AutoSaveTextarea
                        label="Notater"
                        value={s.notes}
                        rows={2}
                        onSave={async (v) => { await updateStage(s.id, { notes: v || null }); }}
                      />
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(s.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DokumenterTab({ applicationId, docs, loading }: any) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Dokumenter</CardTitle>
        <Button size="sm" asChild>
          <Link to="/documents/new" search={{ application_id: applicationId }}>
            <Plus className="h-4 w-4 mr-2" /> Nytt dokument
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {!docs.length ? (
          <EmptyState title="Ingen dokumenter knyttet til denne søknaden" />
        ) : (
          <ul className="divide-y">
            {docs.map((d: any) => (
              <li key={d.id} className="py-2.5 flex items-center justify-between">
                <Link to="/documents/$id" params={{ id: d.id }} className="hover:underline">
                  <div className="font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {DOCUMENT_TYPE_LABELS[d.document_type]} · v{d.version} · {fmtDate(d.updated_at)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MoterTab({ applicationId, meetings, loading }: any) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [type, setType] = useState("");
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [sentiment, setSentiment] = useState("usikker");

  const add = async () => {
    if (!date) return toast.error("Dato er påkrevd");
    const { error } = await supabase.from("meeting_notes").insert({
      application_id: applicationId,
      meeting_date: date,
      meeting_type: type || null,
      attendees: attendees || null,
      notes: notes || null,
      sentiment: sentiment as any,
    });
    if (error) return toast.error(error.message);
    setOpen(false); setDate(""); setType(""); setAttendees(""); setNotes(""); setSentiment("usikker");
    qc.invalidateQueries({ queryKey: ["meeting_notes", applicationId] });
  };

  if (loading) return <Skeleton className="h-40 w-full" />;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Møtenotater</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-2" /> Nytt møte</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nytt møte</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Dato</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><Label>Type</Label><Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Telefonsamtale, intervju, …" /></div>
              <div><Label>Deltakere</Label><Input value={attendees} onChange={(e) => setAttendees(e.target.value)} /></div>
              <div><Label>Stemning</Label>
                <Select value={sentiment} onValueChange={setSentiment}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SENTIMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notater</Label><Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={add}>Lagre</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!meetings.length ? <EmptyState title="Ingen møtenotater ennå" /> : (
          <ul className="space-y-3">
            {meetings.map((m: any) => (
              <MeetingItem key={m.id} m={m} applicationId={applicationId} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MeetingItem({ m, applicationId }: { m: any; applicationId: string }) {
  const qc = useQueryClient();
  const update = async (patch: Record<string, any>) => {
    const { error } = await (supabase.from("meeting_notes") as any).update(patch).eq("id", m.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["meeting_notes", applicationId] });
  };
  const remove = async () => {
    if (!confirm("Slette møtenotat?")) return;
    const { error } = await supabase.from("meeting_notes").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["meeting_notes", applicationId] });
  };

  return (
    <li className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 grid sm:grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Dato</Label>
            <Input
              type="date"
              className="h-8"
              defaultValue={m.meeting_date ?? ""}
              onBlur={(e) => {
                const v = e.target.value;
                if (v && v !== m.meeting_date) update({ meeting_date: v });
              }}
            />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <AutoSaveInput value={m.meeting_type} onSave={async (v) => { await update({ meeting_type: v || null }); }} />
          </div>
          <div>
            <Label className="text-xs">Stemning</Label>
            <Select value={m.sentiment ?? "usikker"} onValueChange={(v) => update({ sentiment: v })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SENTIMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={remove}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <AutoSaveInput label="Deltakere" value={m.attendees} onSave={async (v) => { await update({ attendees: v || null }); }} />
      <AutoSaveTextarea label="Notater" value={m.notes} rows={3} onSave={async (v) => { await update({ notes: v || null }); }} />
      <AutoSaveTextarea label="Viktigste punkter" value={m.key_takeaways} rows={2} onSave={async (v) => { await update({ key_takeaways: v || null }); }} />
      <AutoSaveTextarea label="Oppfølging" value={m.follow_up_items} rows={2} onSave={async (v) => { await update({ follow_up_items: v || null }); }} />
    </li>
  );
}

function NesteTab({ applicationId, steps, loading }: any) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("middels");

  const add = async () => {
    if (!title) return toast.error("Tittel er påkrevd");
    const { error } = await supabase.from("next_steps").insert({
      application_id: applicationId,
      title,
      due_date: due || null,
      priority: priority as any,
    });
    if (error) return toast.error(error.message);
    setOpen(false); setTitle(""); setDue("");
    qc.invalidateQueries({ queryKey: ["next_steps"] });
  };

  const toggle = async (s: any) => {
    const { error } = await supabase.from("next_steps").update({ completed: !s.completed }).eq("id", s.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["next_steps"] });
  };

  if (loading) return <Skeleton className="h-40 w-full" />;
  const open_ = steps.filter((s: any) => !s.completed);
  const done = steps.filter((s: any) => s.completed);
  const today = new Date(new Date().toDateString());

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Neste steg</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-2" /> Nytt steg</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nytt neste steg</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Tittel</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><Label>Frist</Label><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
              <div><Label>Prioritet</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button onClick={add}>Lagre</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        {!open_.length && !done.length ? <EmptyState title="Ingen oppgaver ennå" /> : null}
        <ul className="space-y-2">
          {open_.map((s: any) => {
            const overdue = s.due_date && new Date(s.due_date) < today;
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-md border p-2.5">
                <input type="checkbox" checked={false} onChange={() => toggle(s)} />
                <div className="flex-1">
                  <div className="font-medium">{s.title}</div>
                  {s.due_date && (
                    <div className={`text-xs ${overdue ? "text-red-600" : "text-muted-foreground"}`}>
                      Frist: {fmtDate(s.due_date)}
                    </div>
                  )}
                </div>
                <PriorityBadge priority={s.priority} />
              </li>
            );
          })}
        </ul>
        {done.length > 0 && (
          <details>
            <summary className="text-sm text-muted-foreground cursor-pointer">Fullførte ({done.length})</summary>
            <ul className="space-y-2 mt-2">
              {done.map((s: any) => (
                <li key={s.id} className="flex items-center gap-3 text-muted-foreground line-through">
                  <input type="checkbox" checked readOnly onClick={() => toggle(s)} />
                  <span>{s.title}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function KandidatTab({ applicationId, profile, loading }: any) {
  const qc = useQueryClient();
  const save = (field: string) => async (v: string) => {
    const payload: any = { application_id: applicationId, [field]: v || null };
    const { error } = await supabase
      .from("candidate_profiles")
      .upsert(payload, { onConflict: "application_id" });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["candidate_profile", applicationId] });
  };
  const saveArray = async (v: string) => {
    const arr = v.split("\n").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase
      .from("candidate_profiles")
      .upsert({ application_id: applicationId, key_selling_points: arr.length ? arr : null }, { onConflict: "application_id" });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["candidate_profile", applicationId] });
  };

  if (loading) return <Skeleton className="h-64 w-full" />;
  const p = profile ?? {};
  return (
    <Card>
      <CardHeader><CardTitle>Kandidatprofil</CardTitle></CardHeader>
      <CardContent className="grid lg:grid-cols-2 gap-4">
        <AutoSaveTextarea label="Posisjoneringsvinkel" value={p.positioning_angle} onSave={save("positioning_angle")} />
        <AutoSaveTextarea label="Differensiatorer" value={p.differentiators} onSave={save("differentiators")} />
        <AutoSaveTextarea label="Styrkesamsvar" value={p.strengths_match} onSave={save("strengths_match")} />
        <AutoSaveTextarea label="Gap" value={p.gaps} onSave={save("gaps")} />
        <AutoSaveTextarea label="Mulige bekymringer" value={p.potential_concerns} onSave={save("potential_concerns")} />
        <AutoSaveTextarea label="Bekymringshåndtering" value={p.concern_mitigation} onSave={save("concern_mitigation")} />
        <AutoSaveTextarea label="Selskapets prioriteringer" value={p.company_priorities} onSave={save("company_priorities")} />
        <AutoSaveTextarea label="Kulturell passform" value={p.cultural_fit_notes} onSave={save("cultural_fit_notes")} />
        <AutoSaveTextarea label="Referanser planlagt" value={p.references_planned} onSave={save("references_planned")} />
        <AutoSaveTextarea label="AI-analyse" value={p.ai_analysis} onSave={save("ai_analysis")} rows={6} />
        <div className="lg:col-span-2">
          <AutoSaveTextarea
            label="Nøkkelpunkter (ett per linje)"
            value={(p.key_selling_points ?? []).join("\n")}
            onSave={saveArray}
            rows={5}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function LoggTab({ entries, loading }: any) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!entries.length) return <EmptyState title="Ingen logghendelser ennå" />;
  return (
    <Card>
      <CardContent className="pt-6">
        <ul className="divide-y text-sm">
          {entries.map((e: any) => (
            <li key={e.id} className="py-2 flex items-center justify-between gap-3">
              <span>{e.description}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(e.changed_at)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

