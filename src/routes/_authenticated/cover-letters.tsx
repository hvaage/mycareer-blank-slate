// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Sparkles, FileText, Building2, MapPin, ExternalLink, Copy, Save, Wand2, Loader2, Globe, User as UserIcon, X, CheckCircle2, AlertCircle, FileSearch, Megaphone, CalendarClock } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { coverLetterJobs, type CoverLetterStage, type InputSource } from "@/lib/cover-letter-job-store";
import { effectiveCareerjetCardUrl } from "@/lib/careerjet-links";

const STAGE_LABELS: Record<CoverLetterStage, string> = {
  preparing: "Forbereder data…",
  loading_profile: "Laster profil og stillingsannonse…",
  calling_ai: "Sender til AI…",
  web_research: "AI søker på nettet om selskapet…",
  structuring: "Strukturerer analyse, match og brev…",
  saving: "Lagrer selskapsdata…",
  done: "Fullført",
  cancelled: "Avbrutt",
  error: "Feilet",
};

const INPUT_KIND_ICON: Record<InputSource["kind"], typeof UserIcon> = {
  profile: UserIcon,
  cv: FileText,
  ad: Megaphone,
  annonse: Megaphone,
  lead: FileSearch,
};

export const Route = createFileRoute("/_authenticated/cover-letters")({
  component: CoverLettersPage,
  validateSearch: (search: Record<string, unknown>) => ({
    lead: typeof search.lead === "string" ? search.lead : undefined,
    application: typeof search.application === "string" ? search.application : undefined,
    job_url: typeof search.job_url === "string" ? search.job_url : undefined,
  }),
});

type Source = {
  kind: "application" | "lead" | "careerjet";
  id: string;
  company: string;
  role: string | null;
  location: string | null;
  job_url: string | null;
  ai_score?: number | null;
  work_type?: string | null;
  salary_text?: string | null;
  posted_text?: string | null;
  ai_match_highlights?: string | null;
  ai_concerns?: string | null;
  ai_reasoning?: string | null;
  raw_snippet?: string | null;
  application_due?: string | null;
};

const LETTER_TYPES = [
  { value: "standard", label: "Standard søknadsbrev" },
  { value: "motivasjon", label: "Motivasjonsbrev" },
  { value: "kort_intro", label: "Kort introduksjonsbrev (e-post)" },
  { value: "oppfolging", label: "Oppfølgingsbrev" },
];
const LENGTHS = [
  { value: "kort", label: "Kort (150–220 ord)" },
  { value: "medium", label: "Medium (280–380 ord)" },
  { value: "lang", label: "Lang (450–600 ord)" },
];

function extractFirstEmail(text: string): string | null {
  const m = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return m?.[0] ?? null;
}

type PersistArtifacts = {
  jobAnalysis?: string;
  companyResearch?: string;
  matchAssessment?: string;
  companyId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
};

async function insertArtifactDocument(opts: {
  userId: string;
  applicationId: string;
  title: string;
  content: string;
  companyName: string;
  role: string | null;
  customizationNotes: string;
}) {
  if (!opts.content.trim()) return;
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("application_id", opts.applicationId)
    .eq("title", opts.title)
    .maybeSingle();
  if (existing) return;
  const { error } = await supabase.from("documents").insert({
    user_id: opts.userId,
    application_id: opts.applicationId,
    document_type: "annet",
    title: opts.title,
    company_name: opts.companyName,
    content_text: opts.content,
    tailored_for: opts.role,
    customization_notes: opts.customizationNotes,
  });
  if (error) throw error;
}

/** Shared by manual «Lagre som dokument» and post-generation auto-save. */
async function persistCoverLetterAsDocument(opts: {
  user: { id: string };
  selected: Source;
  displayLetter: string;
  letterType: string;
  language: "no" | "en";
  length: string;
  focus: string;
  guidance: string;
  artifacts?: PersistArtifacts | null;
}): Promise<string | null> {
  const { user, selected, displayLetter, letterType, language, length, focus, guidance, artifacts } = opts;
  let applicationId: string | null = selected.kind === "application" ? selected.id : null;

  if (selected.kind === "lead") {
    const { data: lead } = await supabase
      .from("job_leads").select("*").eq("id", selected.id).maybeSingle();
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        company_name: lead?.company ?? selected.company,
        role_title: lead?.title ?? selected.role,
        location: lead?.location ?? selected.location,
        work_type: lead?.work_type ?? null,
        job_url: lead?.job_url ?? selected.job_url,
        source: "Job lead",
        status: "identifisert",
        company_id: artifacts?.companyId ?? null,
      })
      .select("id").single();
    if (appErr) throw appErr;
    applicationId = app.id;
    await supabase.from("job_leads")
      .update({ status: "promotert", promoted_application_id: app.id })
      .eq("id", selected.id);
  } else if (selected.kind === "careerjet") {
    const { data: uo } = await supabase
      .from("user_opportunities")
      .select("card_display_url, card_raw_url, legacy_listing_status_id")
      .eq("id", selected.id)
      .maybeSingle();
    const rawForBrowse = uo?.card_raw_url ?? selected.job_url;
    const jobUrl = effectiveCareerjetCardUrl({
      raw_url: rawForBrowse,
      display_url: uo?.card_display_url ?? selected.job_url,
      title: selected.role,
      company: selected.company,
      location: selected.location,
    });
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        company_name: selected.company,
        role_title: selected.role,
        location: selected.location,
        job_url: jobUrl,
        source: "Careerjet",
        status: "identifisert",
        company_id: artifacts?.companyId ?? null,
      })
      .select("id")
      .single();
    if (appErr) throw appErr;
    applicationId = app.id;
    if (uo) {
      await (supabase.from("user_opportunities") as any)
        .update({ status: "applied", updated_at: new Date().toISOString() })
        .eq("id", selected.id);
      if (uo.legacy_listing_status_id) {
        await (supabase.from("user_job_listing_status") as any)
          .update({ status: "applied", updated_at: new Date().toISOString() })
          .eq("id", uo.legacy_listing_status_id);
      }
    } else {
      await (supabase.from("user_job_listing_status") as any)
        .update({ status: "applied", updated_at: new Date().toISOString() })
        .eq("id", selected.id);
    }
  }

  const { error } = await supabase.from("documents").insert({
    user_id: user.id,
    application_id: applicationId,
    document_type: "søknadsbrev",
    title: `Søknadsbrev – ${selected.company}${selected.role ? " – " + selected.role : ""}`,
    company_name: selected.company,
    content_text: displayLetter,
    tailored_for: selected.role ?? null,
    customization_notes: [
      `Type: ${LETTER_TYPES.find((t) => t.value === letterType)?.label}`,
      `Språk: ${language === "no" ? "Norsk" : "Engelsk"}`,
      `Lengde: ${LENGTHS.find((l) => l.value === length)?.label}`,
      focus && `Fokus: ${focus}`,
      guidance && `Føringer: ${guidance}`,
    ].filter(Boolean).join(" • "),
  });
  if (error) throw error;

  if (applicationId && artifacts) {
    const role = selected.role ?? null;
    const co = selected.company;
    await insertArtifactDocument({
      userId: user.id,
      applicationId,
      title: `Stillingsanalyse – ${co}${role ? " – " + role : ""}`,
      content: artifacts.jobAnalysis ?? "",
      companyName: co,
      role,
      customizationNotes: "Stillingsanalyse (AI-generert)",
    });
    await insertArtifactDocument({
      userId: user.id,
      applicationId,
      title: `Selskapsresearch – ${co}`,
      content: artifacts.companyResearch ?? "",
      companyName: co,
      role,
      customizationNotes: "Selskapsresearch (AI-generert)",
    });
    await insertArtifactDocument({
      userId: user.id,
      applicationId,
      title: `Kandidatmatch – ${co}${role ? " – " + role : ""}`,
      content: artifacts.matchAssessment ?? "",
      companyName: co,
      role,
      customizationNotes: "Kandidatmatch (AI-generert, Markdown)",
    });
  }

  if (applicationId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("cv_no_pdf_path, cv_en_pdf_path")
      .eq("id", user.id)
      .maybeSingle();
    const cvPath =
      language === "en"
        ? (profile?.cv_en_pdf_path ?? profile?.cv_no_pdf_path ?? null)
        : (profile?.cv_no_pdf_path ?? profile?.cv_en_pdf_path ?? null);

    const textBlob = [artifacts?.jobAnalysis, artifacts?.matchAssessment, displayLetter]
      .filter(Boolean)
      .join("\n");
    const guessedEmail = artifacts?.contactEmail ?? extractFirstEmail(textBlob);

    const { error: appUpdErr } = await (supabase.from("applications") as any)
      .update({
        status: "søknad_generert",
        letter_generated_at: new Date().toISOString(),
        cv_used_path: cvPath,
        cv_used_language: language,
        ...(artifacts?.companyId ? { company_id: artifacts.companyId } : {}),
        ...(guessedEmail ? { contact_email: guessedEmail } : {}),
        ...(artifacts?.contactName ? { contact_name: artifacts.contactName } : {}),
      })
      .eq("id", applicationId);
    if (appUpdErr) throw appUpdErr;
  }

  return applicationId;
}

// Heuristic language detection: counts Norwegian-specific markers vs English stopwords.
function detectLanguage(raw: string): "no" | "en" | null {
  const text = ` ${raw.toLowerCase()} `;
  if (!text.trim()) return null;
  const noChars = (text.match(/[æøå]/g) ?? []).length;
  const noWords = (text.match(/\b(og|eller|ikke|som|med|for|til|fra|hos|vi|du|våre|våre|stilling|søker|erfaring|kompetanse|arbeidsoppgaver|kvalifikasjoner|ønsker|tilbyr|kontakt)\b/g) ?? []).length;
  const enWords = (text.match(/\b(the|and|or|with|for|you|we|our|are|will|experience|skills|requirements|responsibilities|offer|about|role|position|apply|join)\b/g) ?? []).length;
  const noScore = noChars * 3 + noWords;
  if (noScore === 0 && enWords === 0) return null;
  return noScore >= enWords ? "no" : "en";
}

function CoverLettersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const search = Route.useSearch();

  const appsQ = useQuery({
    queryKey: ["applications", "identifisert"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .eq("status", "identifisert")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  // Søknader-siden viser kun annonser brukeren selv har flyttet hit
  // («Flytt til søknader» på Jobb-leads oppretter applications-raden og
  // sletter lead-raden). Uvalgte jobb-leads og speilrader skal aldri listes her.
  const sources: Source[] = useMemo(() => {
    return (appsQ.data ?? [])
      .filter((a: any) => a.status === "identifisert")
      .map((a: any) => ({
        kind: "application" as const,
        id: a.id,
        company: a.company_name,
        role: a.role_title,
        location: a.location,
        job_url: a.job_url,
        ai_score: a.ai_score ?? null,
        work_type: a.work_type ?? null,
        salary_text: a.salary_text ?? null,
        posted_text: a.posted_text ?? null,
        ai_match_highlights: a.ai_match_highlights ?? null,
        ai_concerns: a.ai_concerns ?? null,
        ai_reasoning: a.ai_reasoning ?? null,
        raw_snippet: a.raw_snippet ?? null,
        application_due: a.application_due ?? null,
      }));
  }, [appsQ.data]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedSnippets, setExpandedSnippets] = useState<Record<string, boolean>>({});
  // Preselect from search param (?application=...)
  useEffect(() => {
    if (selectedKey) return;
    const targetId = search.application;
    if (!targetId) return;
    const match = sources.find((s) => s.id === targetId);
    if (match) {
      setSelectedKey(`${match.kind}:${match.id}`);
      requestAnimationFrame(() => {
        document
          .getElementById("cover-letter-settings")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [search.application, sources, selectedKey]);
  const selected = sources.find((s) => `${s.kind}:${s.id}` === selectedKey) ?? null;

  const [language, setLanguage] = useState<"no" | "en">("no");
  const [languageManuallySet, setLanguageManuallySet] = useState(false);

  // Auto-detect language from job ad / lead text when selection changes
  useEffect(() => {
    if (!selected || languageManuallySet) return;
    let cancelled = false;
    (async () => {
      let text = "";
      if (selected.kind === "application") {
        const { data: ja } = await supabase
          .from("job_ads")
          .select("raw_text, about_role, about_company, ideal_candidate")
          .eq("application_id", selected.id)
          .maybeSingle();
        text = [ja?.raw_text, ja?.about_role, ja?.about_company, ja?.ideal_candidate]
          .filter(Boolean).join(" ");
      } else if (selected.kind === "lead") {
        const { data: lead } = await supabase
          .from("job_leads")
          .select("title, raw_snippet, source_subject")
          .eq("id", selected.id)
          .maybeSingle();
        text = [lead?.title, lead?.raw_snippet, lead?.source_subject]
          .filter(Boolean).join(" ");
      } else {
        // careerjet
        text = [selected.role, selected.company, selected.location].filter(Boolean).join(" ");
      }
      if (cancelled || !text) return;
      const detected = detectLanguage(text);
      if (detected) setLanguage(detected);
    })();
    return () => { cancelled = true; };
  }, [selectedKey]);
  const [length, setLength] = useState("medium");
  const [letterType, setLetterType] = useState("standard");
  const [focus, setFocus] = useState("");
  const [guidance, setGuidance] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);

  // Subscribe to module-level job store so generation continues across navigation
  useSyncExternalStore(
    coverLetterJobs.subscribe,
    () => {
      const j = selectedKey ? coverLetterJobs.get(selectedKey) : undefined;
      return j ? `${j.status}:${j.stage}:${j.endedAt ?? ""}:${j.webSources.length}` : "none";
    },
    () => "none",
  );

  const job = selectedKey ? coverLetterJobs.get(selectedKey) : undefined;
  const generating = job?.status === "running";
  const letter = job?.letter ?? "";
  const jobAnalysis = job?.jobAnalysis ?? "";
  const companyResearch = job?.companyResearch ?? "";
  const matchAssessment = job?.matchAssessment ?? "";
  const webSources = job?.webSources ?? [];
  const inputSources = job?.inputSources ?? [];

  const [editedLetter, setEditedLetter] = useState<string | null>(null);
  useEffect(() => {
    setEditedLetter(null);
  }, [selectedKey, job?.endedAt]);
  const displayLetter = editedLetter ?? letter;

  const generate = async () => {
    if (!selected || !user) {
      toast.error("Velg en stillingsannonse / lead først");
      return;
    }
    const key = selectedKey!;
    const inputs: InputSource[] = [
      { label: "Min profil", kind: "profile", href: "/about-me", meta: "Bakgrunn, mål, styrker" },
      selected.kind === "application"
        ? { label: "Stillingsannonse", kind: "annonse", href: `/applications/${selected.id}`, meta: selected.role ?? undefined }
        : { label: "Job lead", kind: "lead", href: "/job-leads", meta: selected.role ?? undefined },
    ];
    const abort = new AbortController();
    coverLetterJobs.start(key, {
      company: selected.company,
      role: selected.role,
      inputSources: inputs,
      abort,
    });

    // Fire-and-forget: continue even if user navigates away
    (async () => {
      try {
        if (abort.signal.aborted) return;
        coverLetterJobs.setStage(key, "loading_profile");
        let applicationId = selected.kind === "application" ? selected.id : null;
        let jobAd: any = null;
        let appRow: any = null;

        if (selected.kind === "application") {
          const [{ data: app }, { data: ja }] = await Promise.all([
            supabase.from("applications").select("*").eq("id", selected.id).maybeSingle(),
            supabase.from("job_ads").select("*").eq("application_id", selected.id).maybeSingle(),
          ]);
          appRow = app;
          jobAd = ja;
          if (jobAd?.raw_text) {
            coverLetterJobs.addInputSources(key, [
              { label: "Annonsetekst", kind: "ad", meta: `${(jobAd.raw_text as string).length} tegn` },
            ]);
          }
        } else if (selected.kind === "lead") {
          const { data: lead } = await supabase
            .from("job_leads").select("*").eq("id", selected.id).maybeSingle();
          appRow = {
            company_name: lead?.company,
            role_title: lead?.title,
            location: lead?.location,
            job_url: lead?.job_url,
          };
        } else {
          // careerjet
          appRow = {
            company_name: selected.company,
            role_title: selected.role,
            location: selected.location,
            job_url: selected.job_url,
          };
        }
        if (abort.signal.aborted) return;

        const { data: profile } = await supabase
          .from("profiles").select("*").eq("id", user.id).maybeSingle();
        if (profile?.cv_no_pdf_path || profile?.cv_en_pdf_path) {
          coverLetterJobs.addInputSources(key, [
            { label: "CV", kind: "cv", href: "/about-me", meta: profile?.cv_no_pdf_path ? "Norsk" : "Engelsk" },
          ]);
        }

        const job = {
          company_name: appRow?.company_name ?? selected.company,
          role_title: appRow?.role_title ?? selected.role,
          location: appRow?.location ?? selected.location,
          job_url: appRow?.job_url ?? selected.job_url,
          contact_name: appRow?.contact_name ?? null,
          recruiter_name: appRow?.recruiter_name ?? null,
          ad_text: jobAd?.raw_text ?? null,
          about_role: jobAd?.about_role ?? null,
          about_company: jobAd?.about_company ?? null,
          ideal_candidate: jobAd?.ideal_candidate ?? null,
          key_requirements: jobAd?.key_requirements ?? null,
          must_have_keywords: jobAd?.must_have_keywords ?? null,
        };

        if (abort.signal.aborted) return;
        coverLetterJobs.setStage(key, "calling_ai");
        const t1 = setTimeout(() => coverLetterJobs.setStage(key, "web_research"), 4000);
        const t2 = setTimeout(() => coverLetterJobs.setStage(key, "structuring"), 25000);

        const invokePromise = supabase.functions.invoke("generate-cover-letter", {
          body: {
            language, length, letter_type: letterType, focus, guidance,
            job: { ...job, company_website: appRow?.company_website ?? null },
            profile,
            application_id: applicationId,
          },
        });
        const abortPromise = new Promise<never>((_, reject) => {
          abort.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Avbrutt", "AbortError")),
            { once: true },
          );
        });
        const { data, error } = (await Promise.race([invokePromise, abortPromise])) as Awaited<typeof invokePromise>;
        clearTimeout(t1); clearTimeout(t2);
        if (abort.signal.aborted) return;
        if (error) throw error;
        if (data?.error != null) {
          const raw =
            typeof data === "object" && data !== null && "message" in data && typeof (data as { message?: unknown }).message === "string"
              ? (data as { message: string }).message
              : String((data as { error?: unknown }).error ?? "");
          throw new Error(raw);
        }

        coverLetterJobs.setStage(key, "saving");
        let persisted = false;
        try {
          const textBlob = [data.job_analysis, data.match_assessment, data.letter]
            .filter(Boolean)
            .join("\n");
          await persistCoverLetterAsDocument({
            user,
            selected,
            displayLetter: data.letter ?? "",
            letterType,
            language,
            length,
            focus,
            guidance,
            artifacts: {
              jobAnalysis: data.job_analysis ?? "",
              companyResearch: data.company_research ?? "",
              matchAssessment: data.match_assessment ?? "",
              companyId: data.company_id ?? null,
              contactEmail: extractFirstEmail(textBlob),
            },
          });
          persisted = true;
        } catch (persistErr: any) {
          console.error("[cover-letter] auto-persist failed:", persistErr);
          toast.error(
            persistErr?.message ??
              "Kunne ikke lagre søknadsbrev automatisk. Brevet vises under — bruk «Lagre som dokument».",
          );
        }

        coverLetterJobs.succeed(key, {
          letter: data.letter ?? "",
          jobAnalysis: data.job_analysis ?? "",
          companyResearch: data.company_research ?? "",
          matchAssessment: data.match_assessment ?? "",
          webSources: Array.isArray(data.web_sources) ? data.web_sources : [],
          companyId: data.company_id ?? null,
          companyScoresUpdated: !!data.company_scores_updated,
          companyExistedAlready: !!data.company_existed_already,
          persisted,
        });

        if (persisted) {
          if (
            typeof window !== "undefined" &&
            (window.location.pathname === "/cover-letters" ||
              window.location.pathname === "/my-applications")
          ) {
            coverLetterJobs.markKeySeen(key);
          }
          toast.success(`Søknadsbrev for ${selected.company} er klart og lagret under Mine genererte søknader.`);
          qc.invalidateQueries({ queryKey: ["applications", "generated"] });
          qc.invalidateQueries({ queryKey: ["applications"] });
          qc.invalidateQueries({ queryKey: ["documents"] });
          qc.invalidateQueries({ queryKey: ["job-leads"] });
          qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
        }
        if (data?.company_id) {
          qc.invalidateQueries({ queryKey: ["employers"] });
          qc.invalidateQueries({ queryKey: ["company", data.company_id] });
        }
      } catch (e: any) {
        if (e?.name === "AbortError" || abort.signal.aborted) return;
        coverLetterJobs.fail(key, e?.message ?? "Ukjent feil");
      }
    })();
  };

  const cancelGeneration = () => {
    if (selectedKey) coverLetterJobs.cancel(selectedKey);
  };

  const saveAsDocument = async () => {
    if (!displayLetter || !selected || !user) return;
    setSavingDoc(true);
    try {
      const store = selectedKey ? coverLetterJobs.get(selectedKey) : undefined;
      const artifacts =
        store?.status === "done"
          ? {
              jobAnalysis: store.jobAnalysis,
              companyResearch: store.companyResearch,
              matchAssessment: store.matchAssessment,
              companyId: store.companyId ?? null,
            }
          : undefined;
      await persistCoverLetterAsDocument({
        user,
        selected,
        displayLetter,
        letterType,
        language,
        length,
        focus,
        guidance,
        artifacts,
      });
      toast.success("Lagret · flyttet til Mine genererte søknader");
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["applications", "generated"] });
      qc.invalidateQueries({ queryKey: ["job-leads"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke lagre");
    } finally {
      setSavingDoc(false);
    }
  };

  const saveMatchAssessment = async () => {
    if (!matchAssessment || !selected || !user) return;
    try {
      const applicationId = selected.kind === "application" ? selected.id : null;
      const { error } = await supabase.from("documents").insert({
        user_id: user.id,
        application_id: applicationId,
        document_type: "annet",
        title: `Kandidatmatch – ${selected.company}${selected.role ? " – " + selected.role : ""}`,
        company_name: selected.company,
        content_text: matchAssessment,
        tailored_for: selected.role ?? null,
        customization_notes: "Kandidatmatch generert av AI (Markdown)",
      });
      if (error) throw error;
      toast.success("Kandidatmatch lagret som dokument");
      qc.invalidateQueries({ queryKey: ["documents"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke lagre");
    }
  };

  const isLoading = appsQ.isLoading;

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 min-w-0">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" /> Søknader
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generer skreddersydde søknadsbrev med AI basert på stillingsannonser, leads, din profil og CV.
        </p>
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-4 sm:gap-6 min-w-0">
        <Card className="h-fit min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Velg utgangspunkt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : !sources.length ? (
              <EmptyState
                title="Ingen kandidater"
                description="Importer en stillingsannonse eller synk job-leads først."
              />
            ) : (
              sources.map((s) => {
                const key = `${s.kind}:${s.id}`;
                const active = key === selectedKey;
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedKey(key);
                      requestAnimationFrame(() => {
                        document
                          .getElementById("cover-letter-settings")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedKey(key);
                      }
                    }}
                    className={`w-full text-left rounded-md border p-3 transition-colors cursor-pointer ${
                      active ? "border-primary bg-primary/5" : "hover:bg-accent/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{s.role ?? "Ukjent rolle"}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <Building2 className="h-3 w-3" />
                          <span className="truncate">{s.company}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-1">
                          {s.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {s.location}
                            </span>
                          )}
                          {s.work_type && <span>{s.work_type}</span>}
                          {s.salary_text && <span>{s.salary_text}</span>}
                          {s.posted_text && s.posted_text.length < 160 && <span>{s.posted_text}</span>}
                          {s.application_due && (
                            <span className="flex items-center gap-1 font-medium text-foreground/80">
                              <CalendarClock className="h-3 w-3" /> Søknadsfrist: {fmtDate(s.application_due)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant={s.kind === "application" ? "outline" : "secondary"} className="text-[10px]">
                          {s.kind === "application" ? "Annonse" : s.kind === "careerjet" ? "Careerjet" : "Lead"}
                        </Badge>
                        {s.ai_score != null && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted">
                            {s.ai_score}
                          </span>
                        )}
                      </div>
                    </div>
                    {s.raw_snippet && (
                      <div className="mt-2">
                        <p
                          className={`text-[11px] text-muted-foreground whitespace-pre-line break-words ${
                            expandedSnippets[key] ? "" : "line-clamp-3"
                          }`}
                        >
                          {s.raw_snippet}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedSnippets((prev) => ({ ...prev, [key]: !prev[key] }));
                          }}
                          className="text-[11px] text-primary hover:underline mt-0.5"
                        >
                          {expandedSnippets[key] ? "Vis mindre" : "Vis mer"}
                        </button>
                      </div>
                    )}
                    {s.ai_match_highlights && (
                      <div className="mt-2 text-[11px] rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 p-1.5">
                        <span className="font-medium">Match: </span>{s.ai_match_highlights}
                      </div>
                    )}
                    {s.ai_concerns && (
                      <div className="mt-1 text-[11px] rounded bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 p-1.5">
                        <span className="font-medium">Bekymringer: </span>{s.ai_concerns}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-6 min-w-0">
          <Card id="cover-letter-settings" className="scroll-mt-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4" /> Innstillinger
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selected ? (
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <div className="font-medium">{selected.role ?? "Ukjent rolle"}</div>
                  <div className="text-muted-foreground">{selected.company}</div>
                  {selected.job_url && (
                    <a
                      href={selected.job_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs inline-flex items-center gap-1 mt-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Åpne annonse
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Velg en kandidat fra listen til venstre.</p>
              )}

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={letterType} onValueChange={setLetterType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LETTER_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Språk</Label>
                  <Select value={language} onValueChange={(v: any) => { setLanguage(v); setLanguageManuallySet(true); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">Norsk</SelectItem>
                      <SelectItem value="en">Engelsk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Lengde</Label>
                  <Select value={length} onValueChange={setLength}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LENGTHS.map((l) => (
                        <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Fokus i brevet</Label>
                <Input
                  placeholder="F.eks. lederskap, salg av komplekse SaaS-løsninger, CRM-erfaring…"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Føringer / tone</Label>
                <Textarea
                  placeholder="F.eks. «hold tonen ydmyk men trygg», «fremhev internasjonal erfaring», «nevn at jeg kan starte 1. juni»…"
                  rows={3}
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button onClick={generate} disabled={!selected || generating}>
                  <Sparkles className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
                  {generating ? "Skriver…" : "Generer med AI"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Generert brev
              </CardTitle>
              {displayLetter && !generating && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => {
                    navigator.clipboard.writeText(displayLetter);
                    toast.success("Kopiert");
                  }}>
                    <Copy className="h-4 w-4 mr-1" /> Kopier
                  </Button>
                  <Button size="sm" onClick={saveAsDocument} disabled={savingDoc}>
                    <Save className="h-4 w-4 mr-1" /> {savingDoc ? "Lagrer…" : "Lagre som dokument"}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {generating && job && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      {STAGE_LABELS[job.stage]}
                    </div>
                    <Button size="sm" variant="ghost" onClick={cancelGeneration}>
                      <X className="h-4 w-4 mr-1" /> Avbryt
                    </Button>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.round(job.progress * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Du kan navigere til andre sider — generering fortsetter i bakgrunnen, og du får varsel når den er ferdig.
                  </p>
                </div>
              )}

              {job?.status === "done" && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <CheckCircle2 className="h-4 w-4" /> Søknadsbrev klart
                  </div>
                  {job.persisted === false && (
                    <p className="text-xs text-amber-900 dark:text-amber-100">
                      Ikke lagret i databasen ennå. Trykk «Lagre som dokument» for å legge brevet til under Mine genererte søknader.
                    </p>
                  )}
                  <CompanyStatusLine status={job.companyStatus} />
                </div>
              )}

              {job?.status === "cancelled" && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm flex items-center gap-2">
                  <X className="h-4 w-4" /> Generering ble avbrutt.
                </div>
              )}

              {job?.status === "error" && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm flex items-start gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Generering feilet</div>
                    <div className="text-xs opacity-90">{job.error}</div>
                  </div>
                </div>
              )}

              {generating && !displayLetter ? (
                <Skeleton className="h-64 w-full" />
              ) : displayLetter ? (
                <div className="grid md:grid-cols-2 gap-4">
                  <Textarea
                    value={displayLetter}
                    onChange={(e) => setEditedLetter(e.target.value)}
                    rows={20}
                    className="font-mono text-sm w-full"
                  />
                  <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-4 bg-muted/20 break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayLetter}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Velg utgangspunkt, juster innstillinger og trykk «Generer med AI».
                </p>
              )}
            </CardContent>
          </Card>

          {(matchAssessment || jobAnalysis || companyResearch) && (
            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> Kandidatmatch og analyse
                </CardTitle>
                {matchAssessment && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => {
                      navigator.clipboard.writeText(matchAssessment);
                      toast.success("Kopiert");
                    }}>
                      <Copy className="h-4 w-4 mr-1" /> Kopier match
                    </Button>
                    <Button size="sm" variant="outline" onClick={saveMatchAssessment}>
                      <Save className="h-4 w-4 mr-1" /> Lagre match (.md)
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {matchAssessment && (
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Kandidatmatch
                    </h3>
                    <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-4 bg-muted/20 break-words">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{matchAssessment}</ReactMarkdown>
                    </div>
                  </section>
                )}
                {jobAnalysis && (
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Stillingsanalyse
                    </h3>
                    <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-4 bg-muted/20 break-words">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{jobAnalysis}</ReactMarkdown>
                    </div>
                  </section>
                )}
                {companyResearch && (
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Selskapsanalyse
                    </h3>
                    <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-4 bg-muted/20 break-words">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{companyResearch}</ReactMarkdown>
                    </div>
                  </section>
                )}
                {webSources.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
                      <Globe className="h-4 w-4" /> Kilder fra nettet (selskap)
                    </h3>
                    {(() => {
                      const groups: Record<string, string[]> = {
                        "Finansiell (proff.no/brreg)": [],
                        "Selskapets nettsider": [],
                        "Nyheter og presse": [],
                        "LinkedIn og sosiale": [],
                        "Andre kilder": [],
                      };
                      const companyHost = (job?.company ?? "").toLowerCase().replace(/\s+/g, "");
                      for (const u of webSources) {
                        let host = "";
                        try { host = new URL(u).hostname.toLowerCase(); } catch { host = u.toLowerCase(); }
                        if (/proff\.no|brreg\.no|purehelp|1881\.no/.test(host)) groups["Finansiell (proff.no/brreg)"].push(u);
                        else if (/linkedin\.com|facebook\.com|x\.com|twitter\.com|instagram\.com/.test(host)) groups["LinkedIn og sosiale"].push(u);
                        else if (/dn\.no|e24\.no|nrk\.no|aftenposten|vg\.no|tu\.no|kapital|finansavisen|hegnar|news|presse/.test(host)) groups["Nyheter og presse"].push(u);
                        else if (companyHost && host.includes(companyHost.replace(/[^a-z0-9]/g, ""))) groups["Selskapets nettsider"].push(u);
                        else groups["Andre kilder"].push(u);
                      }
                      return (
                        <div className="space-y-3">
                          {Object.entries(groups).filter(([, arr]) => arr.length > 0).map(([label, arr]) => (
                            <div key={label}>
                              <div className="text-xs font-semibold text-muted-foreground mb-1">{label} ({arr.length})</div>
                              <ul className="space-y-1 text-sm">
                                {arr.map((u) => (
                                  <li key={u}>
                                    <a href={u} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 break-all">
                                      <ExternalLink className="h-3 w-3 shrink-0" /> {u}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </section>
                )}
                {inputSources.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
                      <UserIcon className="h-4 w-4" /> Dine data brukt i analysen
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {inputSources.map((s) => {
                        const Icon = INPUT_KIND_ICON[s.kind] ?? UserIcon;
                        const inner = (
                          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm hover:border-primary/40 transition">
                            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{s.label}</div>
                              {s.meta && <div className="text-xs text-muted-foreground truncate">{s.meta}</div>}
                            </div>
                            {s.href && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
                          </div>
                        );
                        return s.href ? (
                          <Link key={s.label} to={s.href} className="block">{inner}</Link>
                        ) : (
                          <div key={s.label}>{inner}</div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </CardContent>
            </Card>
          )}

          {selected?.kind === "application" && (
            <p className="text-xs text-muted-foreground">
              Tips: Lagrede brev finnes også på <Link to="/applications/$id" params={{ id: selected.id }} className="underline">søknadens dokumenter</Link>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CompanyStatusLine({ status }: { status: import("@/lib/cover-letter-job-store").CompanyStatus }) {
  if (status.kind === "none") {
    return (
      <p className="text-xs text-muted-foreground">
        Ingen selskapsprofil ble koblet (manglet selskapsnavn, eller lagring til databasen feilet).
      </p>
    );
  }
  const text =
    status.kind === "created" ? "Selskapsprofil opprettet" :
    status.kind === "updated" ? "Selskapsprofil oppdatert" :
    "Selskapet er allerede analysert nylig";
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Building2 className="h-3.5 w-3.5" /> {text} ·{" "}
      <Link to="/employers/$companyId" params={{ companyId: status.companyId }} className="text-primary hover:underline inline-flex items-center gap-1">
        Åpne profil <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}
