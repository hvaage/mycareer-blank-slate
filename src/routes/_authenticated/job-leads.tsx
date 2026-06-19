// @ts-nocheck
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bookmark, X, Send, RefreshCw, ExternalLink, Sparkles,
  Mail, MapPin, Briefcase, Building2, Banknote, ChevronDown,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { fmtRelative, fmtDateTime } from "@/lib/format";
import { effectiveCareerjetCardUrl, preferredCareerjetBrowseUrl } from "@/lib/careerjet-links";
import {
  opportunityRequirementAtomsQuery,
  refreshOpportunityAtomsMutation,
} from "@/lib/queries/target-atoms";
import { extractOpportunityRequirementAtoms, type JobListingExtractInput } from "@/lib/target-atom-extraction";
import { opportunityRequirementLabelNb } from "@/lib/target-atoms";

export const Route = createFileRoute("/_authenticated/job-leads")({
  component: JobLeadsPage,
});

type StatusFilter = "all" | "new" | "saved" | "applied";
type SortBy = "relevance" | "newest";
type SourceFilter = "all" | "linkedin" | "careerjet" | "nav";
/** Client-side slice on top of status (RPC / job_leads still enforce status + not dismissed). */
type RelevanceView = "all" | "recommended" | "unreviewed";

/** In «Anbefalt»: only leads with numeric ai_score ≥ this (unevaluated rows excluded). */
const MIN_RECOMMENDED_SCORE = 40;

type LeadSource = "linkedin" | "careerjet" | "nav";

type Lead = {
  id: string;
  rowKind: "linkedin" | "careerjet" | "nav";
  rowId: string; // id used for status updates
  /** Canonical user_opportunity vs legacy user_job_listing_status (Careerjet only) */
  cjBackend?: "uo" | "legacy";
  source: LeadSource;
  title: string | null;
  company: string | null;
  location: string | null;
  work_type: string | null;
  salary: string | null;
  posted_at: string | null;
  posted_text: string | null;
  /** AI score when evaluated; null when not evaluated (badge: Ikke vurdert). */
  score: number | null;
  aiEvaluated: boolean;
  url: string | null;
  /** Careerjet: `job_listings.id` when known (legacy path). */
  listingId?: string | null;
  /** Canonical NAV/Careerjet: `canonical_opportunities.id`. */
  canonicalOpportunityId?: string | null;
  /** True when canonical opportunity is past live cutoff (NAV expired karens). */
  isExpired?: boolean;
  // linkedin extras
  ai_reasoning?: string | null;
  ai_match_highlights?: string | null;
  ai_concerns?: string | null;
  raw_snippet?: string | null;
  source_email_from?: string | null;
  source_subject?: string | null;
};

function relevanceBadge(score: number | null) {
  const s = Number(score ?? 0);
  if (s >= 70) return { label: `Høy match · ${s}`, cls: "bg-emerald-500 text-white" };
  if (s >= 40) return { label: `God match · ${s}`, cls: "bg-amber-500 text-white" };
  return { label: `Mulig match · ${s}`, cls: "bg-slate-300 text-slate-800" };
}

function isCareerjetAiEvaluated(
  aiScore: number | null | undefined,
  aiScoredAt: string | null | undefined,
): boolean {
  if (aiScoredAt != null && String(aiScoredAt).trim() !== "") return true;
  if (typeof aiScore === "number" && !Number.isNaN(aiScore)) return true;
  return false;
}

function isLinkedInAiEvaluated(aiScore: unknown): boolean {
  return typeof aiScore === "number" && !Number.isNaN(aiScore);
}

function relevanceReviewBadge(lead: Lead) {
  if (!lead.aiEvaluated) {
    return {
      label: "Ikke vurdert",
      cls: "bg-sky-600/15 text-sky-950 dark:text-sky-100 border border-sky-500/25",
    };
  }
  if (lead.score == null || Number.isNaN(lead.score)) {
    return {
      label: "Vurdert",
      cls: "bg-violet-600/15 text-violet-950 dark:text-violet-100 border border-violet-500/25",
    };
  }
  return relevanceBadge(lead.score);
}

function formatSalary(min: number | null, max: number | null, cur: string | null, raw: string | null) {
  if (min || max) {
    const fmt = (n: number) => n.toLocaleString("nb-NO");
    const range = min && max ? `${fmt(min)} – ${fmt(max)}` : fmt((min ?? max)!);
    return `${range} ${cur ?? ""}`.trim();
  }
  return raw;
}

function buildCareerjetSearchUrl(lead: Pick<Lead, "rowKind" | "title" | "company" | "location" | "url">) {
  if (lead.rowKind !== "careerjet") return lead.url;
  return (
    preferredCareerjetBrowseUrl({
      sourceUrl: lead.url,
      title: lead.title,
      company: lead.company,
      location: lead.location,
    }) ?? lead.url
  );
}

function JobLeadsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [relevanceView, setRelevanceView] = useState<RelevanceView>("all");
  const [sortBy, setSortBy] = useState<SortBy>("relevance");
  const [fetching, setFetching] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["profile-jobprefs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("job_search_keywords, preferred_locations, target_city, target_region, target_country, listings_last_fetched_at")
        .eq("id", user!.id)
        .maybeSingle();
      return data as any;
    },
  });

  // LinkedIn-leads (from email sync)
  const { data: linkedinLeads, isLoading: loadingLI } = useQuery({
    queryKey: ["job-leads-linkedin", user?.id, statusFilter],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("job_leads")
        .select("*")
        .eq("user_id", user!.id)
        .order("received_at", { ascending: false })
        .limit(300);
      if (statusFilter === "new") q = q.eq("status", "ny");
      else if (statusFilter === "applied") q = q.eq("status", "promotert");
      else if (statusFilter === "saved") q = q.in("status", []); // none — LinkedIn has no "saved"
      else q = q.neq("status", "avvist");
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Canonical (NAV + Careerjet) + legacy Careerjet via unified RPC.
  // LinkedIn beholdes i egen query (linkedinLeads) for å bevare ekstrafelt.
  const { data: cjLeads, isLoading: loadingCJ } = useQuery({
    queryKey: ["job-leads-careerjet", user?.id, statusFilter],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase.rpc("list_user_job_opportunities", {
        p_status: statusFilter,
        p_source: "all",
      });
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        row_kind: string;
        source: string;
        user_opportunity_id: string | null;
        listing_status_id: string | null;
        listing_id: string | null;
        canonical_opportunity_id: string | null;
        status: string;
        is_expired: boolean | null;
        relevance_score: number | null;
        ai_score: number | null;
        ai_scored_at: string | null;
        ai_reasoning: string | null;
        ai_match_highlights: string | null;
        ai_concerns: string | null;
        title: string | null;
        employer: string | null;
        location: string | null;
        salary: string | null;
        salary_min: number | null;
        salary_max: number | null;
        salary_currency: string | null;
        published_at: string | null;
        source_url: string | null;
        display_url: string | null;
        raw_url: string | null;
        identity_fingerprint: string | null;
      }>;
      // LinkedIn håndteres av egen query — filtrer bort her.
      return rows.filter((r) => r.source !== "linkedin");
    },
  });

  const merged: Lead[] = useMemo(() => {
    let skippedNoRowId = 0;
    const out: Lead[] = [];
    for (const r of linkedinLeads ?? []) {
      const aiEvaluated = isLinkedInAiEvaluated(r.ai_score);
      out.push({
        id: `li-${r.id}`,
        rowKind: "linkedin",
        rowId: r.id,
        source: "linkedin",
        title: r.title,
        company: r.company,
        location: r.location,
        work_type: r.work_type,
        salary: r.salary_text,
        posted_at: r.received_at,
        posted_text: r.posted_text,
        score: aiEvaluated ? (r.ai_score as number) : null,
        aiEvaluated,
        url: r.job_url,
        ai_reasoning: r.ai_reasoning,
        ai_match_highlights: r.ai_match_highlights,
        ai_concerns: r.ai_concerns,
        raw_snippet: r.raw_snippet,
        source_email_from: r.source_email_from,
        source_subject: r.source_subject,
      });
    }
    for (const row of cjLeads ?? []) {
      const uoId = row.user_opportunity_id;
      const isCanonical =
        uoId != null &&
        String(uoId).trim() !== "" &&
        String(uoId).toLowerCase() !== "null";
      const rowId = isCanonical ? String(uoId) : String(row.listing_status_id ?? "");
      if (!rowId) {
        skippedNoRowId += 1;
        continue;
      }
      const aiScore = row.ai_score;
      const aiEvaluated = isCareerjetAiEvaluated(aiScore, row.ai_scored_at);
      const score = aiEvaluated && typeof aiScore === "number" && !Number.isNaN(aiScore) ? aiScore : null;
      const leadSource: LeadSource = row.source === "nav" ? "nav" : "careerjet";
      const rawUrl = row.raw_url ?? row.source_url;
      const urlForCard =
        leadSource === "nav"
          ? (row.display_url ?? rawUrl ?? null)
          : effectiveCareerjetCardUrl({
              raw_url: rawUrl,
              display_url: row.display_url,
              title: row.title,
              company: row.employer,
              location: row.location,
            });
      out.push({
        id: `${leadSource}-${isCanonical ? "uo" : "legacy"}-${rowId}`,
        rowKind: leadSource === "nav" ? "nav" : "careerjet",
        rowId,
        cjBackend: isCanonical ? "uo" : "legacy",
        source: leadSource,
        title: row.title,
        company: row.employer,
        location: row.location,
        work_type: null,
        salary: formatSalary(row.salary_min, row.salary_max, row.salary_currency, row.salary),
        posted_at: row.published_at,
        posted_text: null,
        score,
        aiEvaluated,
        url: urlForCard,
        listingId: row.listing_id,
        canonicalOpportunityId: row.canonical_opportunity_id,
        isExpired: row.is_expired === true,
        ai_reasoning: row.ai_reasoning ?? null,
        ai_match_highlights: row.ai_match_highlights ?? null,
        ai_concerns: row.ai_concerns ?? null,
      });
    }

    let afterRelevance = out;
    if (relevanceView === "recommended") {
      afterRelevance = out.filter(
        (lead) =>
          lead.aiEvaluated &&
          typeof lead.score === "number" &&
          !Number.isNaN(lead.score) &&
          lead.score >= MIN_RECOMMENDED_SCORE,
      );
    } else if (relevanceView === "unreviewed") {
      afterRelevance = out.filter((lead) => !lead.aiEvaluated);
    }

    const filtered =
      sourceFilter === "all"
        ? afterRelevance
        : afterRelevance.filter((x) => x.source === sourceFilter);

    filtered.sort((a, b) => {
      if (sortBy === "newest") {
        return new Date(b.posted_at ?? 0).getTime() - new Date(a.posted_at ?? 0).getTime();
      }
      if (!a.aiEvaluated && b.aiEvaluated) return -1;
      if (a.aiEvaluated && !b.aiEvaluated) return 1;
      if (!a.aiEvaluated && !b.aiEvaluated) {
        return new Date(b.posted_at ?? 0).getTime() - new Date(a.posted_at ?? 0).getTime();
      }
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.posted_at ?? 0).getTime() - new Date(a.posted_at ?? 0).getTime();
    });

    if (import.meta.env.DEV) {
      const rpcCj = cjLeads?.length ?? 0;
      const hiddenByRelevance = out.length - afterRelevance.length;
      const hiddenBySource = afterRelevance.length - filtered.length;
      const log: Record<string, unknown> = {
        statusFilter,
        relevanceView,
        sourceFilter,
        sortBy,
        rpcCareerjetRows: rpcCj,
        merged: out.length,
        rendered: filtered.length,
        skippedNoRowId,
      };
      if (hiddenByRelevance > 0 && relevanceView === "recommended") {
        log.anbefaltExcluded = {
          unevaluated: out.filter((l) => !l.aiEvaluated).length,
          evaluatedBelowMin: out.filter(
            (l) =>
              l.aiEvaluated &&
              (l.score == null ||
                Number.isNaN(l.score) ||
                l.score < MIN_RECOMMENDED_SCORE),
          ).length,
        };
      }
      if (hiddenByRelevance > 0 && relevanceView === "unreviewed") {
        log.uvurderteExcludedEvaluated = out.filter((l) => l.aiEvaluated).length;
      }
      if (hiddenBySource > 0) log.hiddenBySourceFilter = hiddenBySource;
      if (
        skippedNoRowId > 0 ||
        hiddenByRelevance > 0 ||
        hiddenBySource > 0
      ) {
        console.debug("[job-leads] merge", log);
      }
    }
  return filtered;
  }, [linkedinLeads, cjLeads, sourceFilter, sortBy, statusFilter, relevanceView]);

  const handleFetch = async () => {
    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-careerjet-listings");
      if (error) {
        toast.error("Henting feilet");
        return;
      }
      if (!data?.ok) {
        toast.warning(data?.message ?? "Ingen treff");
        return;
      }
      const skipped = Number(data.skipped_duplicates ?? data.skipped ?? 0);
      const newLinks = Number(data.new_lead_links ?? data.scored ?? 0);
      const upserted = Number(data.listing_rows_upserted ?? data.upserted ?? 0);
      const refreshed = Number(data.existing_rows_refreshed ?? 0);
      const navMatched = Number(data.nav_matched ?? 0);
      const msg = [
        `${data.fetched} fra Careerjet`,
        upserted ? `${upserted} rader i jobbliste` : null,
        `${newLinks} nye koblinger til deg`,
        navMatched ? `${navMatched} NAV-treff` : null,
        skipped ? `${skipped} duplikater hoppet over` : null,
        refreshed ? `${refreshed} eksisterende oppdatert` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
      qc.invalidateQueries({ queryKey: ["profile-jobprefs"] });
      qc.invalidateQueries({ queryKey: ["user-opportunities"] });
    } finally {
      setFetching(false);
    }
  };

  const tombstoneDedupe = async (lead: Lead, status: "dismissed" | "promoted") => {
    if (!user) return;
    try {
      const useCmp = lead.source === "careerjet";
      const { data: keyData } = await supabase.rpc("normalize_lead_key", {
        p_url: useCmp ? "" : (lead.url ?? ""),
        p_company: lead.company ?? "",
        p_title: lead.title ?? "",
        p_location: lead.location ?? "",
      });
      if (!keyData) return;
      // Upsert dedupe key as tombstone
      await supabase.rpc("register_lead", {
        p_user_id: user.id,
        p_source: lead.source,
        p_priority: lead.source === "linkedin" ? 2 : 1,
        p_dedupe_key: keyData as unknown as string,
        p_ref_table:
          lead.rowKind === "linkedin"
            ? "job_leads"
            : lead.cjBackend === "uo"
              ? "user_opportunities"
              : "user_job_listing_status",
        p_ref_id: lead.rowId,
      });
      await supabase
        .from("lead_dedupe_keys")
        .update({ status })
        .eq("user_id", user.id)
        .eq("dedupe_key", keyData as unknown as string);
    } catch (e) {
      console.warn("[job-leads] tombstone failed", e);
    }
  };

  const promoteToApplication = async (lead: Lead): Promise<string | null> => {
    if (!user) return null;
    const jobUrl = lead.source === "careerjet"
      ? (buildCareerjetSearchUrl(lead) ?? lead.url)
      : lead.url;
    const sourceLabel =
      lead.source === "linkedin" ? "LinkedIn" : lead.source === "nav" ? "NAV" : "Careerjet";
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        company_name: lead.company ?? "Ukjent",
        role_title: lead.title ?? null,
        location: lead.location ?? null,
        work_type: lead.work_type ?? null,
        job_url: jobUrl ?? null,
        source: sourceLabel,
        status: "identifisert",
        priority: (lead.score ?? 0) >= 70 ? "høy" : "middels",
        ai_score: lead.score ?? null,
        ai_reasoning: lead.ai_reasoning ?? null,
        ai_match_highlights: lead.ai_match_highlights ?? null,
        ai_concerns: lead.ai_concerns ?? null,
        salary_text: lead.salary ?? null,
        posted_text: lead.posted_text ?? null,
        raw_snippet: lead.raw_snippet ?? null,
        source_subject: lead.source_subject ?? null,
        source_email_from: lead.source_email_from ?? null,
      } as any)
      .select("id")
      .single();
    if (appErr) {
      toast.error(`Kunne ikke flytte til søknader: ${appErr.message}`);
      return null;
    }

    // Tombstone dedupe key as promoted so it doesn't re-import
    await tombstoneDedupe(lead, "promoted");

    if (lead.source === "linkedin") {
      // LinkedIn: behold dagens flyt (delete from job_leads)
      await supabase.from("job_leads").delete().eq("id", lead.rowId);
      qc.invalidateQueries({ queryKey: ["job-leads-linkedin"] });
      qc.invalidateQueries({ queryKey: ["job-leads"] });
    } else if (lead.source === "nav") {
      // NAV: ALDRI delete. Sett status='applied' på user_opportunities.
      await (supabase.from("user_opportunities") as any)
        .update({ status: "applied", updated_at: new Date().toISOString() })
        .eq("id", lead.rowId);
      qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
    } else {
      // Careerjet: behold eksisterende flyt (delete)
      if (lead.cjBackend === "uo") {
        await supabase.from("user_opportunities").delete().eq("id", lead.rowId);
      } else {
        await supabase.from("user_job_listing_status").delete().eq("id", lead.rowId);
      }
      qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
    }
    qc.invalidateQueries({ queryKey: ["applications"] });
    return app.id;
  };

  const updateStatus = async (lead: Lead, action: "save" | "dismiss" | "apply") => {
    if (action === "save") {
      const id = await promoteToApplication(lead);
      if (id) toast.success("Lagret som søknad");
      return;
    }
    if (action === "apply") {
      const id = await promoteToApplication(lead);
      if (!id) return;
      navigate({
        to: "/cover-letters",
        search: { application: id } as any,
      });
      return;
    }
    // dismiss
    await tombstoneDedupe(lead, "dismissed");
    if (lead.source === "nav" || (lead.rowKind === "careerjet" && lead.cjBackend === "uo")) {
      // NAV + canonical Careerjet: status-update på user_opportunities (aldri delete for NAV)
      await (supabase.from("user_opportunities") as any)
        .update({ status: "dismissed", updated_at: new Date().toISOString() })
        .eq("id", lead.rowId);
      qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
    } else if (lead.rowKind === "careerjet") {
      await (supabase.from("user_job_listing_status") as any)
        .update({ status: "dismissed", updated_at: new Date().toISOString() })
        .eq("id", lead.rowId);
      qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
    } else {
      await (supabase.from("job_leads") as any)
        .update({ status: "avvist", updated_at: new Date().toISOString() })
        .eq("id", lead.rowId);
      qc.invalidateQueries({ queryKey: ["job-leads-linkedin"] });
    }
  };

  const hasPrefs =
    !!profile?.job_search_keywords?.trim() ||
    (Array.isArray(profile?.preferred_locations) && profile.preferred_locations.length > 0) ||
    !!profile?.target_city?.trim() ||
    !!profile?.target_region?.trim() ||
    !!profile?.target_country?.trim();

  const isLoading = loadingLI || loadingCJ;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> Jobb-leads
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {profile?.listings_last_fetched_at
              ? <>Sist hentet (Careerjet): {fmtDateTime(profile.listings_last_fetched_at)}</>
              : "LinkedIn-leads kommer fra e-post-synk · Careerjet hentes manuelt"}
          </p>
        </div>
        <Button onClick={handleFetch} disabled={fetching || !hasPrefs} className="shrink-0">
          <RefreshCw className={`h-4 w-4 mr-2 ${fetching ? "animate-spin" : ""}`} />
          {fetching ? "Henter…" : "Hent fra Careerjet"}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        <Select value={sourceFilter} onValueChange={(v: any) => setSourceFilter(v)}>
          <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kilder</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="careerjet">Careerjet</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="new">Nye</SelectItem>
            <SelectItem value="saved">Lagrede</SelectItem>
            <SelectItem value="applied">Søkt</SelectItem>
          </SelectContent>
        </Select>
        <Select value={relevanceView} onValueChange={(v: any) => setRelevanceView(v)}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Relevans" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle relevanser</SelectItem>
            <SelectItem value="unreviewed">Uvurderte</SelectItem>
            <SelectItem value="recommended">Anbefalt (≥{MIN_RECOMMENDED_SCORE})</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
          <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">Relevans</SelectItem>
            <SelectItem value="newest">Nyeste</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!hasPrefs && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-4 text-sm">
            Du har ikke satt opp jobbsøk-preferanser.{" "}
            <button
              onClick={() => navigate({ to: "/about-me" })}
              className="underline font-medium"
            >
              Gå til Profil → Jobbsøk-innstillinger
            </button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !merged.length ? (
        <EmptyState
          title="Ingen annonser ennå"
          description={
            hasPrefs
              ? "Trykk «Hent fra Careerjet» eller synkroniser e-post for LinkedIn-jobbvarsler."
              : "Sett opp søkeord og byer i profilen din først."
          }
        />
      ) : (
        <div className="space-y-3">
          {merged.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onSave={() => updateStatus(lead, "save")}
              onDismiss={() => updateStatus(lead, "dismiss")}
              onApply={() => updateStatus(lead, "apply")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function jobLeadToExtractInput(lead: Lead): JobListingExtractInput {
  const id =
    (lead.listingId && String(lead.listingId).trim()) ||
    (lead.canonicalOpportunityId && String(lead.canonicalOpportunityId).trim()) ||
    lead.rowId;
  return {
    id,
    title: lead.title,
    employer: lead.company,
    location: lead.location,
    description: lead.raw_snippet ?? null,
    salary: lead.salary,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    raw_data: null,
  };
}

function JobLeadTargetHints({ lead }: { lead: Lead }) {
  if (lead.source !== "careerjet") return null;
  const qc = useQueryClient();
  const atomKey = {
    listingId: lead.listingId ?? null,
    canonicalOpportunityId: lead.canonicalOpportunityId ?? null,
  };
  const enabled = !!(atomKey.listingId || atomKey.canonicalOpportunityId);
  const { data: rows = [], isLoading } = useQuery({
    ...opportunityRequirementAtomsQuery(atomKey),
    enabled,
  });
  const refresh = useMutation({
    ...refreshOpportunityAtomsMutation(qc, atomKey),
    onSuccess: (r) => {
      toast.success(`Krav-atomer oppdatert (${r.upserted} nye/oppdatert, ${r.deactivated} deaktivert).`);
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke oppdatere krav-atomer"),
  });

  const extracted = useMemo(() => extractOpportunityRequirementAtoms(jobLeadToExtractInput(lead)), [
    lead.listingId,
    lead.canonicalOpportunityId,
    lead.rowId,
    lead.title,
    lead.company,
    lead.location,
    lead.salary,
    lead.raw_snippet,
  ]);

  if (!enabled) return null;

  const fromDb = rows.length > 0;
  const list = fromDb ? rows.slice(0, 12) : extracted.slice(0, 10);

  return (
    <div className="text-xs border-t border-border/60 pt-2 mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">Det stillingen ser ut til å vektlegge</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] px-2 shrink-0"
          disabled={refresh.isPending || isLoading}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span className="ml-1">Oppdater</span>
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Strukturerte krav fra tittel, arbeidsgiver og sted (MVP). Full tekst brukes når du oppdaterer atomer mot databasen.
      </p>
      <div className="flex flex-wrap gap-1">
        {list.map((item, i) => {
          const key =
            "id" in item && item.id
              ? item.id
              : `${"source_hash" in item ? item.source_hash : "ex"}-${i}`;
          const label =
            typeof (item as { label?: string | null }).label === "string" &&
            String((item as { label?: string | null }).label).trim()
              ? String((item as { label: string }).label)
              : opportunityRequirementLabelNb(String((item as { category: string }).category));
          return (
            <Badge key={key} variant="secondary" className="text-[10px] font-normal">
              {label}
            </Badge>
          );
        })}
        {!list.length && !isLoading && (
          <span className="text-muted-foreground">Ingen trekk funnet i korttekst. Trykk Oppdater for å hente fra lagret annonse.</span>
        )}
      </div>
    </div>
  );
}

function LeadCard({
  lead, onSave, onDismiss, onApply,
}: {
  lead: Lead;
  onSave: () => void;
  onDismiss: () => void;
  onApply: () => void;
}) {
  const [open, setOpen] = useState(false);
  const badge = relevanceReviewBadge(lead);
  const isLI = lead.source === "linkedin";
  const actionUrl = isLI ? lead.url : buildCareerjetSearchUrl(lead);
  const hasAIDetails =
    !!(lead.ai_reasoning || lead.ai_match_highlights || lead.ai_concerns || lead.raw_snippet);

  const cardInner = (
    <div className="flex-1 min-w-0 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-semibold">{lead.title ?? "Ukjent rolle"}</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>
          {badge.label}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {isLI ? "LinkedIn" : "Careerjet"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {lead.company && (
          <span className="flex items-center gap-1 text-base font-semibold text-foreground"><Building2 className="h-4 w-4" />{lead.company}</span>
        )}
        {lead.location && (
          <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{lead.location}</span>
        )}
        {lead.work_type && (
          <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{lead.work_type}</span>
        )}
        {lead.salary && (
          <span className="flex items-center gap-1 text-foreground/80"><Banknote className="h-3.5 w-3.5" />{lead.salary}</span>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        {lead.posted_text ?? (lead.posted_at ? fmtRelative(lead.posted_at) : "—")}
      </div>

      {lead.ai_match_highlights && (
        <div className="text-xs rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 p-2">
          <span className="font-medium">Match: </span>{lead.ai_match_highlights}
        </div>
      )}
      {lead.ai_concerns && (
        <div className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 p-2">
          <span className="font-medium">Bekymringer: </span>{lead.ai_concerns}
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {actionUrl ? (
          <a
            href={actionUrl}
            target="_blank"
            rel="noopener"
            referrerPolicy="no-referrer-when-downgrade"
            className="block -m-4 p-4 rounded-md active:bg-accent/40 hover:bg-accent/20 transition-colors"
          >
            {cardInner}
          </a>
        ) : (
          cardInner
        )}

        <JobLeadTargetHints lead={lead} />

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          {actionUrl && (
            <Button asChild variant="outline" size="sm" className="h-9">
              <a
                href={actionUrl}
                target="_blank"
                rel="noopener"
                referrerPolicy="no-referrer-when-downgrade"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                {isLI ? "Se annonse" : "Finn i Careerjet"}
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-9" onClick={onSave}>
            <Bookmark className="h-4 w-4 mr-1" /> Lagre
          </Button>
          <Button variant="ghost" size="sm" className="h-9" onClick={onDismiss}>
            <X className="h-4 w-4 mr-1" /> Avvis
          </Button>
          <Button variant="default" size="sm" className="h-9 ml-auto" onClick={onApply}>
            <Send className="h-4 w-4 mr-1" /> Søk
          </Button>
        </div>

        {hasAIDetails && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs h-7 px-2">
                <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />
                {open ? "Skjul AI-vurdering" : "Vis AI-vurdering & detaljer"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2 text-xs">
              {lead.ai_reasoning && (
                <div>
                  <div className="font-medium text-foreground mb-0.5">AI-vurdering</div>
                  <div className="text-muted-foreground whitespace-pre-wrap">{lead.ai_reasoning}</div>
                </div>
              )}
              {lead.raw_snippet && (
                <div>
                  <div className="font-medium text-foreground mb-0.5">Utdrag fra annonse</div>
                  <div className="text-muted-foreground whitespace-pre-wrap">{lead.raw_snippet}</div>
                </div>
              )}
              {(lead.source_email_from || lead.source_subject) && (
                <div className="flex items-start gap-1 text-muted-foreground pt-1 border-t">
                  <Mail className="h-3 w-3 mt-0.5" />
                  <div>
                    {lead.source_email_from && <div>Fra: {lead.source_email_from}</div>}
                    {lead.source_subject && <div>Emne: {lead.source_subject}</div>}
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
