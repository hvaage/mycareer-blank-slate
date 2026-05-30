// @ts-nocheck
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Linkedin, Mail, Trash2, Check, Loader2, FileText, PenLine, Plus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { JobSearchPrefs } from "@/components/job-search-prefs";
import { CvUploadFlow } from "@/components/cv-upload/cv-upload-flow";
import { useServerFn } from "@tanstack/react-start";
import { startLinkedInOAuth } from "@/lib/linkedin-oauth";

export const Route = createFileRoute("/_authenticated/onboarding/")({
  component: OnboardingPage,
});

const INDUSTRY_OPTIONS = [
  "Teknologi", "SaaS", "Fintech", "Eiendom", "Konsulentvirksomhet",
  "Industri", "Offentlig sektor", "Helse", "Energi", "Annet",
];

const STATUS_OPTIONS = [
  { value: "søknad_sendt", label: "Sendt" },
  { value: "intervju_1", label: "Til intervju" },
  { value: "avsluttet", label: "Avslag" },
  { value: "tilbud_mottatt", label: "Tilbud" },
  { value: "identifisert", label: "Avventer" },
] as const;

type AppRow = {
  localId: string;
  inserted: boolean;
  id?: string;
  company_name: string;
  role_title: string;
  job_url: string;
  status: string;
  applied_date: string;
};

function newRow(): AppRow {
  return {
    localId: crypto.randomUUID(),
    inserted: false,
    company_name: "",
    role_title: "",
    job_url: "",
    status: "søknad_sendt",
    applied_date: new Date().toISOString().slice(0, 10),
  };
}

const STEPS = [
  "Tilkoblinger",
  "Profil",
  "Karriereoversikt",
  "Tidligere søknader",
  "Søknadsbrev",
];
const TOTAL_STEPS = STEPS.length;

function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [profile, setProfile] = useState<any>(null);
  const [apps, setApps] = useState<AppRow[]>([newRow()]);

  // Step 2 form
  const [form, setForm] = useState({
    full_name: "", phone: "", target_city: "", target_role: "",
    target_industries: [] as string[],
    job_search_keywords: "",
    preferred_locations: [] as string[],
  });

  const [savingNext, setSavingNext] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const startGoogle = useServerFn(startGoogleOAuth);
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      setProfile(p);
      const step = (p?.onboarding_step as number | null) ?? 1;
      const startStep = Math.max(1, Math.min(TOTAL_STEPS, step));
      setCurrentStep(startStep);
      setForm({
        full_name: p?.full_name ?? p?.display_name ?? "",
        phone: p?.phone ?? "",
        target_city: p?.target_city ?? "",
        target_role: p?.target_role ?? "",
        target_industries: (p?.target_industries as string[] | null) ?? [],
        job_search_keywords: p?.job_search_keywords ?? "",
        preferred_locations: (p?.preferred_locations as string[] | null) ?? [],
      });

      // Mark started
      if (!p?.onboarding_started_at) {
        await (supabase.from("profiles") as any)
          .update({ onboarding_started_at: new Date().toISOString() })
          .eq("id", user.id);
      }

      // If step >= 4 (Tidligere søknader), load existing applications as inserted chips
      if (startStep >= 4) {
        const { data: existing } = await supabase
          .from("applications")
          .select("id, company_name, role_title, job_url, status, applied_date")
          .eq("user_id", user.id);
        if (existing && existing.length > 0) {
          setApps(
            existing.map((a: any) => ({
              localId: a.id,
              inserted: true,
              id: a.id,
              company_name: a.company_name ?? "",
              role_title: a.role_title ?? "",
              job_url: a.job_url ?? "",
              status: a.status ?? "søknad_sendt",
              applied_date: a.applied_date ?? new Date().toISOString().slice(0, 10),
            })),
          );
        }
      }
      setLoading(false);
    })();
  }, [user]);

  const persistStep = async (step: number) => {
    if (!user) return;
    await (supabase.from("profiles") as any).update({ onboarding_step: step }).eq("id", user.id);
  };

  const goNext = async () => {
    if (!user) return;
    setSavingNext(true);
    try {
      if (currentStep === 2) {
        const { error } = await (supabase.from("profiles") as any)
          .update({
            full_name: form.full_name || null,
            phone: form.phone || null,
            target_city: form.target_city || null,
            target_role: form.target_role || null,
            target_industries: form.target_industries.length ? form.target_industries : null,
            job_search_keywords: form.job_search_keywords || null,
            preferred_locations: form.preferred_locations,
          })
          .eq("id", user.id);
        if (error) throw error;
      }

      if (currentStep === 4) {
        const toInsert = apps.filter((a) => !a.inserted && a.company_name.trim());
        if (toInsert.length > 0) {
          const rows = toInsert.map((a) => ({
            user_id: user.id,
            company_name: a.company_name.trim(),
            role_title: a.role_title.trim() || null,
            job_url: a.job_url.trim() || null,
            status: a.status,
            applied_date: a.applied_date || null,
          }));
          const { data: inserted, error } = await supabase
            .from("applications")
            .insert(rows as any)
            .select("id, company_name");
          if (error) throw error;
          // Mark inserted in local state
          setApps((prev) =>
            prev.map((a) => {
              if (a.inserted || !a.company_name.trim()) return a;
              const match = inserted?.find(
                (x: any) => x.company_name === a.company_name.trim(),
              );
              return match ? { ...a, inserted: true, id: match.id } : a;
            }),
          );
        }
      }

      const next = Math.min(TOTAL_STEPS, currentStep + 1);
      await persistStep(next);
      setCurrentStep(next);
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke lagre");
    } finally {
      setSavingNext(false);
    }
  };

  const goBack = () => setCurrentStep((s) => Math.max(1, s - 1));

  const skipStep = async () => {
    const next = Math.min(TOTAL_STEPS, currentStep + 1);
    await persistStep(next);
    setCurrentStep(next);
  };

  const finish = async () => {
    if (!user) return;
    setSavingNext(true);
    try {
      const { error } = await (supabase.from("profiles") as any)
        .update({
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          onboarding_step: TOTAL_STEPS,
        })
        .eq("id", user.id);
      if (error) throw error;
      sessionStorage.removeItem("onboarding_checked");
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke fullføre");
    } finally {
      setSavingNext(false);
    }
  };

  const linkedInConnect = () => {
    try {
      startLinkedInOAuth();
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke åpne LinkedIn");
    }
  };

  const connectGmail = async () => {
    try {
      const { url } = await startGoogle({ data: { returnTo: window.location.href } });
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke starte Gmail (sjekk GOOGLE_OAUTH_CLIENT_ID).");
    }
  };

  const analyzeCompanies = async () => {
    const targets = apps
      .filter((a) => !a.inserted && a.company_name.trim())
      .map((a) => a.company_name.trim());
    if (targets.length === 0) {
      toast.info("Ingen selskaper å analysere");
      return;
    }
    setAnalyzing(true);
    try {
      // Limit concurrency to 5
      let i = 0;
      const runOne = async (name: string) => {
        try {
          const { data: u } = await supabase.auth.getUser();
          const uid = u.user?.id;
          if (!uid) return;
          await supabase.functions.invoke("analyze-company", {
            body: { user_id: uid, name },
          });
        } catch {
          /* skip silently */
        }
      };
      const queue = [...targets];
      const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
        while (queue.length) {
          const n = queue.shift();
          if (n) await runOne(n);
          i++;
        }
      });
      await Promise.all(workers);
      toast.success(`Analyserte ${targets.length} selskap`);
    } catch (e: any) {
      toast.error("Analyse-funksjonen er ikke tilgjengelig");
    } finally {
      setAnalyzing(false);
    }
  };

  const insertedApps = apps.filter((a) => a.inserted);
  const editableApps = apps.filter((a) => !a.inserted);

  if (loading || !user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-2xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Velkommen til sokr.online</h1>
        <p className="text-muted-foreground text-sm">
          La oss sette opp profilen din. Steg {currentStep} av {TOTAL_STEPS}
        </p>
      </div>

      {/* Progress */}
      <div className="flex gap-2">
        {STEPS.map((label, idx) => {
          const stepNum = idx + 1;
          const active = stepNum === currentStep;
          const done = stepNum < currentStep;
          return (
            <div key={label} className="flex-1 space-y-1.5">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  done ? "bg-primary" : active ? "bg-primary/70" : "bg-muted",
                )}
              />
              <div
                className={cn(
                  "text-[11px] font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>

      {currentStep === 1 && (
        <Step1
          profile={profile}
          onConnectLinkedIn={linkedInConnect}
          onConnectGmail={connectGmail}
        />
      )}

      {currentStep === 2 && (
        <Step2 form={form} setForm={setForm} />
      )}

      {currentStep === 3 && user && (
        <CvUploadFlow userId={user.id} />
      )}

      {currentStep === 4 && (
        <Step3
          insertedApps={insertedApps}
          editableApps={editableApps}
          onChange={(localId, patch) =>
            setApps((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)))
          }
          onAdd={() => setApps((prev) => [...prev, newRow()])}
          onRemove={(localId) =>
            setApps((prev) => prev.filter((a) => a.localId !== localId))
          }
          onAnalyze={analyzeCompanies}
          analyzing={analyzing}
        />
      )}

      {currentStep === 5 && (
        <Step4 applications={insertedApps} />
      )}

      <div className="flex items-center justify-between pt-4 border-t">
        <Button
          variant="ghost"
          onClick={goBack}
          disabled={currentStep === 1 || savingNext}
        >
          Tilbake
        </Button>
        <div className="flex items-center gap-3">
          {currentStep < TOTAL_STEPS && (
            <button
              onClick={skipStep}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Hopp over dette steget
            </button>
          )}
          {currentStep < TOTAL_STEPS ? (
            <Button onClick={goNext} disabled={savingNext}>
              {savingNext && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Neste
            </Button>
          ) : (
            <Button onClick={finish} disabled={savingNext}>
              {savingNext && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Fullfør oppsett
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Step 1 ---------------- */

function Step1({
  profile,
  onConnectLinkedIn,
  onConnectGmail,
}: {
  profile: any;
  onConnectLinkedIn: () => void;
  onConnectGmail: () => void | Promise<void>;
}) {
  const linkedInConnected = !!profile?.linkedin_connected_at;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Koble til dine kontoer</h2>
        <p className="text-sm text-muted-foreground">
          Vi bruker disse tilkoblingene til å hente profildata og holde søknadsprosessen din samlet på ett sted.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" /> Gmail
            </CardTitle>
          </div>
          <CardDescription>
            Les jobbvarsler fra LinkedIn (og senere andre aviser) rett inn i Jobb-leads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => void onConnectGmail()}>
            Koble til Gmail
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="flex items-center gap-2">
              <Linkedin className="h-5 w-5" /> LinkedIn
            </CardTitle>
            {linkedInConnected && (
              <Badge className="bg-green-600 hover:bg-green-600">
                <Check className="h-3 w-3 mr-1" /> Koblet
              </Badge>
            )}
          </div>
          <CardDescription>
            Hent profildata for automatisk utfylling av søknadsbrev og CV
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onConnectLinkedIn} variant={linkedInConnected ? "outline" : "default"}>
            <Linkedin className="h-4 w-4 mr-2" />
            {linkedInConnected ? "Oppdater tilkobling" : "Koble til LinkedIn"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- Step 2 ---------------- */

function Step2({
  form, setForm,
}: {
  form: any;
  setForm: (f: any) => void;
}) {
  const toggleIndustry = (name: string) => {
    setForm({
      ...form,
      target_industries: form.target_industries.includes(name)
        ? form.target_industries.filter((x: string) => x !== name)
        : [...form.target_industries, name],
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Din profil</h2>
        <p className="text-sm text-muted-foreground">
          Alle felt er valgfrie — du kan oppdatere dem senere.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Grunnleggende informasjon</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Fullt navn</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <Label>Telefon</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>Sted</Label>
              <Input value={form.target_city} onChange={(e) => setForm({ ...form, target_city: e.target.value })} placeholder="Oslo" />
            </div>
            <div>
              <Label>Hvilken type rolle?</Label>
              <Input value={form.target_role} onChange={(e) => setForm({ ...form, target_role: e.target.value })} placeholder="f.eks. Produktleder" />
            </div>
          </div>
          <div>
            <Label className="block mb-2">Bransjepreferanser</Label>
            <div className="flex flex-wrap gap-2">
              {INDUSTRY_OPTIONS.map((name) => {
                const active = form.target_industries.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleIndustry(name)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted border-input text-foreground",
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jobbsøk-preferanser</CardTitle>
          <CardDescription>
            Brukes til å hente relevante stillingsannonser fra Careerjet. Du kan endre dette når som helst under Profil.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JobSearchPrefs
            keywords={form.job_search_keywords}
            locations={form.preferred_locations}
            onKeywordsChange={(v) => setForm({ ...form, job_search_keywords: v })}
            onLocationsChange={(v) => setForm({ ...form, preferred_locations: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="text-base">Importer fra LinkedIn</CardTitle>
            <Badge variant="secondary">Kommer snart</Badge>
          </div>
          <CardDescription>
            Last opp ZIP-filen fra LinkedIn Data Export for å importere arbeidshistorikk.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

/* ---------------- Step 3 ---------------- */

function Step3({
  insertedApps, editableApps, onChange, onAdd, onRemove, onAnalyze, analyzing,
}: {
  insertedApps: AppRow[];
  editableApps: AppRow[];
  onChange: (id: string, patch: Partial<AppRow>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Legg inn søknader du allerede har sendt</h2>
        <p className="text-sm text-muted-foreground">
          Har du søkt på stillinger før du kom hit? Legg dem inn så vi kan følge dem opp og analysere arbeidsgiverne.
        </p>
      </div>

      {insertedApps.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {insertedApps.length} søknader er allerede lagret fra denne sesjonen.
          </p>
          <div className="flex flex-wrap gap-2">
            {insertedApps.map((a) => (
              <div
                key={a.localId}
                className="inline-flex items-center gap-2 bg-muted text-foreground rounded-full px-3 py-1.5 text-xs"
              >
                <Check className="h-3 w-3 text-green-600" />
                <span className="font-medium">{a.company_name}</span>
                {a.role_title && <span className="text-muted-foreground">— {a.role_title}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {editableApps.map((a) => (
          <Card key={a.localId}>
            <CardContent className="pt-6 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Selskap</Label>
                  <Input value={a.company_name} onChange={(e) => onChange(a.localId, { company_name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Stilling</Label>
                  <Input value={a.role_title} onChange={(e) => onChange(a.localId, { role_title: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Annonse-URL</Label>
                  <Input value={a.job_url} onChange={(e) => onChange(a.localId, { job_url: e.target.value })} placeholder="https://..." />
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={a.status} onValueChange={(v) => onChange(a.localId, { status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Dato</Label>
                  <Input type="date" value={a.applied_date} onChange={(e) => onChange(a.localId, { applied_date: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => onRemove(a.localId)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Fjern
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> Legg til søknad
        </Button>
        {editableApps.some((a) => a.company_name.trim()) && (
          <Button variant="outline" size="sm" onClick={onAnalyze} disabled={analyzing}>
            {analyzing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Analyser arbeidsgivere
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Step 4 ---------------- */

function Step4({ applications }: { applications: AppRow[] }) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string>("");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Du er klar — generer ditt første søknadsbrev</h2>
        <p className="text-sm text-muted-foreground">
          Søknadsbrev-generatoren bruker profilen din, CV-en og informasjonen om stillingen til å skrive et personlig og konkret brev.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="h-4 w-4" /> Start med en ny søknad
            </CardTitle>
            <CardDescription>
              Lim inn en stillingsannonse og generer et brev fra bunnen av
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => {
                sessionStorage.removeItem("onboarding_checked");
                navigate({ to: "/cover-letters" });
              }}
            >
              Gå til søknadsbrev
            </Button>
          </CardContent>
        </Card>

        {applications.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Bruk en søknad du la inn
              </CardTitle>
              <CardDescription>Velg fra søknadene du la inn i forrige steg</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger><SelectValue placeholder="Velg søknad..." /></SelectTrigger>
                <SelectContent>
                  {applications.map((a) => (
                    <SelectItem key={a.localId} value={a.id ?? a.localId}>
                      {a.company_name}{a.role_title ? ` — ${a.role_title}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="w-full"
                disabled={!selectedId}
                onClick={() => {
                  sessionStorage.removeItem("onboarding_checked");
                  navigate({ to: "/cover-letters", search: { application_id: selectedId } as any });
                }}
              >
                Generer brev for denne søknaden
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Du kan alltid komme tilbake og generere flere brev fra Søknadsbrev-menyen.
      </p>
    </div>
  );
}
