// @ts-nocheck
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { createApplication } from "@/lib/queries/applications";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ArrowLeft, Sparkles, FileText, Link2 } from "lucide-react";
import { STATUS_ORDER, STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants";
import { toast } from "sonner";

const schema = z.object({
  company_name: z.string().min(1, "Påkrevd"),
  role_title: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  applied_date: z.string().optional(),
  location: z.string().optional(),
  work_type: z.string().optional(),
  industry: z.string().optional(),
  company_size: z.string().optional(),
  company_website: z.string().optional(),
  recruiter_name: z.string().optional(),
  recruiter_email: z.string().optional(),
  job_url: z.string().url("Ugyldig URL").optional().or(z.literal("")),
  source: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/_authenticated/applications/new")({
  component: NewApplicationPage,
});

function NewApplicationPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<"import" | "form">("import");
  const [importUrl, setImportUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [extracted, setExtracted] = useState<any>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { status: "identifisert", priority: "middels" },
  });

  const onPdf = async (file: File) => {
    setPdfLoading(true);
    try {
      const pdfjs: any = await import(/* @vite-ignore */ "pdfjs-dist/build/pdf.mjs" as any);
      const workerMod: any = await import(/* @vite-ignore */ "pdfjs-dist/build/pdf.worker.mjs?url" as any);
      pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      let txt = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        txt += content.items.map((it: any) => it.str).join(" ") + "\n\n";
      }
      setImportText(txt.trim());
      toast.success(`Hentet tekst fra ${doc.numPages} side(r)`);
    } catch (err: any) {
      toast.error("Kunne ikke lese PDF: " + (err?.message ?? "ukjent feil"));
    } finally {
      setPdfLoading(false);
    }
  };

  const runAi = async () => {
    if (!importUrl && !importText.trim()) {
      toast.error("Lim inn URL, PDF eller tekst først");
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-job-ad", {
        body: { url: importUrl || undefined, text: importText || undefined },
      });
      if (error) throw error;
      const ex = data?.extracted ?? {};
      setExtracted({ ...ex, raw_text: data?.raw_text ?? importText });
      // Prefill form
      form.reset({
        ...form.getValues(),
        company_name: ex.company_name ?? "",
        role_title: ex.role_title ?? "",
        location: ex.location ?? "",
        work_type: normalizeWorkType(ex.work_type),
        industry: ex.industry ?? "",
        company_size: ex.company_size ?? "",
        company_website: ex.company_website ?? "",
        recruiter_name: ex.recruiter_name ?? "",
        recruiter_email: ex.recruiter_email ?? "",
        job_url: importUrl || "",
        notes: ex.summary ?? "",
        status: "identifisert",
        priority: "middels",
      });
      setStep("form");
      toast.success("Annonse analysert");
    } catch (e: any) {
      toast.error(e.message ?? "AI-analyse feilet");
    } finally {
      setAiLoading(false);
    }
  };

  const skipImport = () => setStep("form");

  const mut = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!user) throw new Error("Ikke innlogget");
      const a = await createApplication({
        user_id: user.id,
        company_name: values.company_name,
        role_title: values.role_title || null,
        status: values.status as any,
        priority: values.priority as any,
        applied_date: values.applied_date || null,
        location: values.location || null,
        work_type: values.work_type || null,
        industry: values.industry || null,
        company_size: values.company_size || null,
        company_website: values.company_website || null,
        recruiter_name: values.recruiter_name || null,
        recruiter_email: values.recruiter_email || null,
        recruiter_phone: extracted?.recruiter_phone || null,
        contact_name: extracted?.contact_name || null,
        contact_email: extracted?.contact_email || null,
        contact_phone: extracted?.contact_phone || null,
        job_url: values.job_url || null,
        source: values.source || null,
        notes: values.notes || null,
      });
      // If we ran AI, persist a job_ad row too
      if (extracted) {
        await supabase.from("job_ads").insert({
          application_id: a.id,
          raw_text: extracted.ad_markdown || extracted.raw_text || null,
          source_url: importUrl || null,
          application_deadline: extracted.application_deadline || null,
          must_have_keywords: extracted.must_have_keywords ?? null,
          nice_to_have: extracted.nice_to_have ?? null,
          key_requirements: extracted.key_requirements ?? null,
          parsed_company: extracted.company_name ?? null,
          parsed_role: extracted.role_title ?? null,
          parsed_location: extracted.location ?? null,
          parsed_work_type: extracted.work_type ?? null,
          about_role: extracted.about_role ?? null,
          about_company: extracted.about_company ?? null,
          ideal_candidate: extracted.ideal_candidate ?? null,
        });
      }
      // Register dedupe key as PDF (priority 3) and clean up matching leads
      try {
        const { data: keyData } = await supabase.rpc("normalize_lead_key", {
          p_url: values.job_url || "",
          p_company: values.company_name || "",
          p_title: values.role_title || "",
          p_location: values.location || "",
        });
        if (keyData) {
          await supabase.rpc("register_lead", {
            p_user_id: user.id,
            p_source: "pdf",
            p_priority: 3,
            p_dedupe_key: keyData as unknown as string,
            p_ref_table: "applications",
            p_ref_id: a.id,
          });
          // Mark dedupe row as promoted regardless (overrides any existing)
          await supabase
            .from("lead_dedupe_keys")
            .update({ status: "promoted", ref_table: "applications", ref_id: a.id })
            .eq("user_id", user.id)
            .eq("dedupe_key", keyData as unknown as string);
        }
        // Remove matching job_leads / careerjet status rows from the feed
        if (values.job_url) {
          await supabase.from("job_leads")
            .update({ status: "promotert", promoted_application_id: a.id })
            .eq("user_id", user.id)
            .eq("job_url", values.job_url);
        }
      } catch (e) {
        console.warn("[applications/new] dedupe registration failed", e);
      }
      return a;
    },
    onSuccess: (a) => {
      toast.success("Søknad opprettet");
      navigate({ to: "/applications/$id", params: { id: a.id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/applications"><ArrowLeft className="h-4 w-4 mr-2" /> Tilbake</Link>
      </Button>

      {step === "import" ? (
        <Card>
          <CardHeader>
            <CardTitle>Ny søknad – importer stillingsannonse</CardTitle>
            <p className="text-sm text-muted-foreground">
              Lim inn URL eller last opp PDF. AI fyller ut feltene automatisk.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2"><Link2 className="h-4 w-4" /> URL til annonse</Label>
              <Input
                type="url"
                placeholder="https://…"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2"><FileText className="h-4 w-4" /> eller PDF</Label>
              <Input
                type="file"
                accept="application/pdf"
                disabled={pdfLoading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPdf(f);
                }}
              />
              {pdfLoading && <p className="text-xs text-muted-foreground">Leser PDF…</p>}
            </div>
            <div className="space-y-1.5">
              <Label>eller lim inn annonsetekst</Label>
              <Textarea
                rows={6}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Lim inn hele stillingsannonsen her…"
              />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="ghost" onClick={skipImport}>
                Hopp over
              </Button>
              <Button type="button" onClick={runAi} disabled={aiLoading}>
                <Sparkles className="h-4 w-4 mr-2" />
                {aiLoading ? "Analyserer…" : "Analyser med AI"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Ny søknad</CardTitle>
            <Button type="button" size="sm" variant="ghost" onClick={() => setStep("import")}>
              ← Tilbake til import
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
              <Field label="Bedrift" error={form.formState.errors.company_name?.message}>
                <Input {...form.register("company_name")} />
              </Field>
              <Field label="Rolle">
                <Input {...form.register("role_title")} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Prioritet">
                  <Select value={form.watch("priority")} onValueChange={(v) => form.setValue("priority", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Collapsible defaultOpen={!!extracted}>
                <CollapsibleTrigger className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <ChevronDown className="h-4 w-4" /> Flere felt
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Søknadsdato"><Input type="date" {...form.register("applied_date")} /></Field>
                    <Field label="Sted"><Input {...form.register("location")} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Arbeidsform">
                      <Select value={form.watch("work_type") ?? ""} onValueChange={(v) => form.setValue("work_type", v)}>
                        <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="onsite">Onsite</SelectItem>
                          <SelectItem value="hybrid">Hybrid</SelectItem>
                          <SelectItem value="remote">Remote</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Kilde"><Input placeholder="LinkedIn, Finn, …" {...form.register("source")} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Bransje"><Input {...form.register("industry")} /></Field>
                    <Field label="Selskapsstørrelse"><Input {...form.register("company_size")} /></Field>
                  </div>
                  <Field label="Selskapets nettside"><Input {...form.register("company_website")} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rekrutterer"><Input {...form.register("recruiter_name")} /></Field>
                    <Field label="Rekrutterer e-post"><Input {...form.register("recruiter_email")} /></Field>
                  </div>
                  <Field label="Stillingsannonse URL" error={form.formState.errors.job_url?.message}>
                    <Input type="url" {...form.register("job_url")} />
                  </Field>
                  <Field label="Notater"><Textarea rows={4} {...form.register("notes")} /></Field>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex gap-3 justify-end pt-2">
                <Button type="button" variant="ghost" onClick={() => navigate({ to: "/applications" })}>
                  Avbryt
                </Button>
                <Button type="submit" disabled={mut.isPending}>
                  {mut.isPending ? "Lagrer…" : "Opprett"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function normalizeWorkType(v?: string): string {
  if (!v) return "";
  const x = v.toLowerCase();
  if (x.includes("remote") || x.includes("hjemme")) return "remote";
  if (x.includes("hybrid")) return "hybrid";
  if (x.includes("onsite") || x.includes("kontor") || x.includes("on-site")) return "onsite";
  return "";
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
