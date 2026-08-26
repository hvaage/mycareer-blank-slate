// @ts-nocheck
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { StartApplicationButton } from "@/components/network/start-application-button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bookmark, X, Send, RefreshCw, ExternalLink, Sparkles,
  Mail, MapPin, Briefcase, Building2, Banknote, ChevronDown,
  Link2, FileText, Upload, CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { fmtRelative, fmtDateTime, fmtDate } from "@/lib/format";
import { effectiveCareerjetCardUrl, preferredCareerjetBrowseUrl } from "@/lib/careerjet-links";
import { syncEmailConnection } from "@/lib/job-leads/sync.functions";
import { importManualJobLead } from "@/lib/job-leads/import.functions";
import {
  attachJobAdAndCompany,
  markOpportunitySelected,
  promoteJobLeadToOpportunity,
} from "@/lib/job-leads/promote.functions";
import {
  CompanyMatchDialog,
  type PendingCompanyMatch,
} from "@/components/job-leads/company-match-dialog";

export const Route = createFileRoute("/_authenticated/job-leads")({
  component: JobLeadsPage,
});

/** Locked contract: only NAV/Careerjet rows with an accepted version + non-null screening_status are V2-evaluated. */
const MATCH_SCORE_VERSION = "job_match_v6_2026_08_25";
/** Eldre scoringer før CxO-/forkortelsestaksonomien. Vises, men merkes. */
const MATCH_SCORE_VERSION_LEGACY = "job_match_v5_2026_08_25";
/** Eldre scoringer før rollefamilie-taksonomien. Vises, men merkes. */
const MATCH_SCORE_VERSION_LEGACY_V2 = "job_match_v4_2026_08_23";
/** Eldre scoringer mot et bredere evidensgrunnlag. Vises, men merkes. */
const MATCH_SCORE_VERSION_LEGACY_V3 = "job_match_v3_2026_08_15";
const MATCH_SCORE_VERSION_LEGACY_V4 = "job_match_v2_2026_06_24";
const ACCEPTED_MATCH_SCORE_VERSIONS = new Set<string>([
  MATCH_SCORE_VERSION,
  MATCH_SCORE_VERSION_LEGACY,
  MATCH_SCORE_VERSION_LEGACY_V2,
  MATCH_SCORE_VERSION_LEGACY_V3,
  MATCH_SCORE_VERSION_LEGACY_V4,
]);

type StatusFilter = "all" | "new" | "saved" | "applied";
type TimeFilter = "all" | "2d" | "1w" | "1m";
type SourceFilter = "all" | "linkedin" | "careerjet" | "nav" | "finn" | "other" | "manual";
type ExtentFilter = "all" | "full_time" | "part_time" | "unspecified";
type EngagementFilter = "all" | "permanent" | "temporary" | "project" | "interim" | "unspecified";
type RelevanceView = "relevant" | "high" | "needs_review" | "unreviewed" | "all";

const HIGH_MATCH_MIN = 70;
const RELEVANT_MIN = 40;

type LeadSource = "linkedin" | "careerjet" | "nav" | "finn" | "other" | "manual";
type ScreeningStatus = "eligible" | "excluded" | "needs_review" | null;

type ScreeningReason = {
  code?: string | null;
  label?: string | null;
  detail?: string | null;
};

type RequirementItem = {
  level?: "mandatory" | "preferred" | "context" | null;
  label?: string | null;
  met?: boolean | null;
  matched_evidence_refs?: string[] | null;
};

type EvidenceBasis = {
  status?: "empty" | "present" | null;
  items_used?: number | null;
  source?: string | null;
} | null;

type RequirementSummary = {
  requirements?: RequirementItem[];
  evidence_basis?: EvidenceBasis;
} | null;

/** Tomt evidensgrunnlag skal vises eksplisitt, ikke som et lavt tall uten forklaring. */
function hasEmptyEvidenceBasis(summary: RequirementSummary): boolean {
  return summary?.evidence_basis?.status === "empty";
}

type Lead = {
  id: string;
  rowKind: "linkedin" | "careerjet" | "nav" | "finn" | "other" | "manual";
  rowId: string;
  cjBackend?: "uo" | "legacy";
  source: LeadSource;
  title: string | null;
  company: string | null;
  location: string | null;
  work_type: string | null;
  salary: string | null;
  posted_at: string | null;
  posted_text: string | null;
  applicationDue?: string | null;
  /** LinkedIn: V1 ai_score. NAV/Careerjet: kun satt når V2-vurdert (versjon + screeningStatus). */
  score: number | null;
  /** LinkedIn: V1 evaluert. NAV/Careerjet: ekvivalent til isV2Evaluated (avledet). */
  aiEvaluated: boolean;
  url: string | null;
  listingId?: string | null;
  canonicalOpportunityId?: string | null;
  isExpired?: boolean;
  work_extent?: string | null;
  engagement_type?: string | null;
  // linkedin extras
  ai_reasoning?: string | null;
  ai_match_highlights?: string | null;
  ai_concerns?: string | null;
  raw_snippet?: string | null;
  source_email_from?: string | null;
  source_subject?: string | null;
  // V2 screening (NAV/Careerjet)
  screeningStatus?: ScreeningStatus;
  screeningReasons?: ScreeningReason[];
  requirementSummary?: RequirementSummary;
  matchScoreVersion?: string | null;
  matchScoredModel?: string | null;
  screeningEvaluatedAt?: string | null;
};

const REASON_LABELS_NB: Record<string, string> = {
  target_role_only_in_reporting_line: "Målrolle nevnes kun i rapporteringslinjen",
  target_role_mismatch: "Rollen avviker fra målrolle",
  missing_legal_qualification: "Mangler juridisk kvalifikasjon",
  missing_required_experience: "Mangler påkrevd erfaring",
  missing_required_education: "Mangler påkrevd utdanning",
  location_mismatch: "Lokasjon utenfor preferanse",
  language_mismatch: "Språkkrav ikke oppfylt",
  seniority_mismatch: "Seniornivå avviker",
  industry_mismatch: "Bransje avviker",
};

function reasonLabelNb(r: ScreeningReason): string {
  if (typeof r?.label === "string" && r.label.trim()) return r.label.trim();
  const code = typeof r?.code === "string" ? r.code : "";
  return REASON_LABELS_NB[code] ?? (code || "Uspesifisert årsak");
}

function isV2EvaluatedRaw(version: string | null | undefined, status: ScreeningStatus): boolean {
  return !!version && ACCEPTED_MATCH_SCORE_VERSIONS.has(version) && status != null;
}

function isLegacyScoreVersion(version: string | null | undefined): boolean {
  return (
    version === MATCH_SCORE_VERSION_LEGACY ||
    version === MATCH_SCORE_VERSION_LEGACY_V2 ||
    version === MATCH_SCORE_VERSION_LEGACY_V3 ||
    version === MATCH_SCORE_VERSION_LEGACY_V4
  );
}

function relevanceBadge(score: number | null) {
  const s = Number(score ?? 0);
  if (s >= 70) return { label: `Høy match · ${s}`, cls: "bg-emerald-500 text-white" };
  if (s >= 40) return { label: `God match · ${s}`, cls: "bg-amber-500 text-white" };
  return { label: `Mulig match · ${s}`, cls: "bg-slate-300 text-slate-800" };
}

function leadBadge(lead: Lead) {
  if (lead.source === "linkedin") {
    if (!lead.aiEvaluated) {
      return { label: "Ikke vurdert", cls: "bg-sky-600/15 text-sky-950 dark:text-sky-100 border border-sky-500/25" };
    }
    if (lead.score == null) {
      return { label: "Vurdert", cls: "bg-violet-600/15 text-violet-950 dark:text-violet-100 border border-violet-500/25" };
    }
    return relevanceBadge(lead.score);
  }
  // NAV / Careerjet — V2
  if (!isV2EvaluatedRaw(lead.matchScoreVersion ?? null, lead.screeningStatus ?? null)) {
    return { label: "Ikke vurdert", cls: "bg-sky-600/15 text-sky-950 dark:text-sky-100 border border-sky-500/25" };
  }
  if (lead.screeningStatus === "excluded") {
    return { label: "Ikke relevant", cls: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100" };
  }
  if (lead.screeningStatus === "needs_review") {
    return { label: "Må vurderes", cls: "bg-amber-500 text-white" };
  }
  // eligible
  if (typeof lead.score === "number") return relevanceBadge(lead.score);
  return { label: "Vurdert", cls: "bg-violet-600/15 text-violet-950 dark:text-violet-100 border border-violet-500/25" };
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

function isLinkedInAiEvaluated(aiScore: unknown): boolean {
  return typeof aiScore === "number" && !Number.isNaN(aiScore);
}

function JobLeadsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [relevanceView, setRelevanceView] = useState<RelevanceView>("relevant");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [extentFilter, setExtentFilter] = useState<ExtentFilter>("all");
  const [engagementFilter, setEngagementFilter] = useState<EngagementFilter>("all");
  const [fetching, setFetching] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [syncingMailbox, setSyncingMailbox] = useState(false);
  /** Optimistisk skjuling: raden forsvinner straks du velger, uten å vente på databasen. */
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState<"url" | "text" | "pdf" | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const doSyncMailbox = useServerFn(syncEmailConnection);
  const doImportManual = useServerFn(importManualJobLead);


  const { data: profile } = useQuery({
    queryKey: ["profile-jobprefs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select(
          "job_search_keywords, preferred_locations, target_city, target_region, target_country, target_role, target_roles, listings_last_fetched_at",
        )
        .eq("id", user!.id)
        .maybeSingle();
      return data as any;
    },
  });

  const { data: emailConnections } = useQuery({
    queryKey: ["email-connections", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("email_connections")
        .select("id, email_address, provider, status, last_sync_at")
        .eq("user_id", user.id)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });

  // LinkedIn-leads (uendret)
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
      else if (statusFilter === "saved") q = q.in("status", []);
      else q = q.neq("status", "avvist");
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // NAV + Careerjet via unified RPC (uendret)
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
      const rows = (data ?? []) as Array<any>;
      return rows.filter((r) => r.source !== "linkedin");
    },
  });

  // V2-screening fra user_opportunities
  const uoIds = useMemo(
    () =>
      Array.from(
        new Set(
          (cjLeads ?? [])
            .map((r: any) => r.user_opportunity_id)
            .filter((v: any) => typeof v === "string" && v.length > 0),
        ),
      ),
    [cjLeads],
  );
  const ujlsIds = useMemo(
    () =>
      Array.from(
        new Set(
          (cjLeads ?? [])
            .map((r: any) => r.listing_status_id)
            .filter((v: any) => typeof v === "string" && v.length > 0),
        ),
      ),
    [cjLeads],
  );

  const screeningCols =
    "id, screening_status, screening_reasons, requirement_summary, match_score_version, match_scored_model, screening_evaluated_at";

  const { data: screeningUo } = useQuery({
    queryKey: ["job-leads-screening-uo", user?.id, uoIds],
    enabled: !!user && uoIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_opportunities")
        .select(screeningCols)
        .eq("user_id", user!.id)
        .in("id", uoIds as string[]);
      if (error) throw error;
      const map = new Map<string, any>();
      for (const r of data ?? []) map.set((r as any).id, r);
      return map;
    },
  });

  const { data: screeningUjls } = useQuery({
    queryKey: ["job-leads-screening-ujls", user?.id, ujlsIds],
    enabled: !!user && ujlsIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_job_listing_status")
        .select(screeningCols)
        .eq("user_id", user!.id)
        .in("id", ujlsIds as string[]);
      if (error) throw error;
      const map = new Map<string, any>();
      for (const r of data ?? []) map.set((r as any).id, r);
      return map;
    },
  });

  // Bygg rå Lead-liste (uten match-/source-/time-filter) — brukes for empty-state-skille.
  const rawLeads: Lead[] = useMemo(() => {
    const out: Lead[] = [];
    for (const r of linkedinLeads ?? []) {
      const sourceSystem = ((r as any).source_system ?? "linkedin") as string;
      // Manuelle importer (URL/limt tekst) er V2-rader: screeningfeltene på
      // job_leads er fasit — ikke V1 ai_score-logikken for LinkedIn-e-post.
      const isManual = sourceSystem === "manual_url" || sourceSystem === "manual_paste";
      const rawSource: LeadSource = isManual ? "manual" : (sourceSystem as LeadSource);
      const screeningStatus: ScreeningStatus = isManual
        ? (((r as any).screening_status as ScreeningStatus) ?? null)
        : null;
      const matchScoreVersion: string | null = isManual
        ? ((r as any).match_score_version ?? null)
        : null;
      const v2 = isManual && isV2EvaluatedRaw(matchScoreVersion, screeningStatus);
      const aiEvaluated = isManual
        ? v2
        : rawSource === "linkedin"
          ? isLinkedInAiEvaluated((r as any).ai_score)
          : false;
      const idPrefix = isManual
        ? "man"
        : rawSource === "finn" ? "finn" : rawSource === "other" ? "other" : "li";
      let manualScreeningReasons: ScreeningReason[] = [];
      if (isManual && Array.isArray((r as any).screening_reasons)) {
        manualScreeningReasons = (r as any).screening_reasons.map((x: any) =>
          typeof x === "string" ? { code: x } : (x as ScreeningReason)
        );
      }
      // For excluded/needs_review: ikke vis gamle ai_match_highlights som positiv match.
      const manualExcludedOrNeeds = v2 &&
        (screeningStatus === "excluded" || screeningStatus === "needs_review");
      out.push({
        id: `${idPrefix}-${(r as any).id}`,
        rowKind: rawSource,
        rowId: (r as any).id,
        source: rawSource,
        title: (r as any).title,
        company: (r as any).company,
        location: (r as any).location,
        work_type: (r as any).work_type,
        salary: (r as any).salary_text,
        posted_at: (r as any).received_at,
        posted_text: (r as any).posted_text,
        applicationDue: (r as any).application_due ?? null,
        score: aiEvaluated ? ((r as any).ai_score as number) : null,
        aiEvaluated,
        url: (r as any).job_url,
        ai_reasoning: (r as any).ai_reasoning,
        ai_match_highlights: manualExcludedOrNeeds ? null : (r as any).ai_match_highlights,
        ai_concerns: (r as any).ai_concerns,
        raw_snippet: (r as any).raw_snippet,
        source_email_from: (r as any).source_email_from,
        source_subject: (r as any).source_subject,
        screeningStatus,
        screeningReasons: manualScreeningReasons,
        requirementSummary: isManual
          ? (((r as any).requirement_summary as RequirementSummary) ?? null)
          : undefined,
        matchScoreVersion,
        matchScoredModel: isManual ? ((r as any).match_scored_model ?? null) : undefined,
        screeningEvaluatedAt: isManual ? ((r as any).screening_evaluated_at ?? null) : undefined,
      });
    }
    for (const row of cjLeads ?? []) {
      const uoId = (row as any).user_opportunity_id;
      const isCanonical =
        uoId != null && String(uoId).trim() !== "" && String(uoId).toLowerCase() !== "null";
      const rowId = isCanonical ? String(uoId) : String((row as any).listing_status_id ?? "");
      if (!rowId) continue;

      const screening = isCanonical
        ? screeningUo?.get(rowId)
        : screeningUjls?.get(rowId);

      const screeningStatus: ScreeningStatus = (screening?.screening_status as any) ?? null;
      const matchScoreVersion: string | null = screening?.match_score_version ?? null;
      const v2 = isV2EvaluatedRaw(matchScoreVersion, screeningStatus);

      const rawAiScore = (row as any).ai_score;
      // Gamle V1-score nulles ut for NAV/Careerjet med mindre V2-vurdert.
      const score: number | null =
        v2 && typeof rawAiScore === "number" && !Number.isNaN(rawAiScore) ? rawAiScore : null;

      const leadSource: LeadSource = (row as any).source === "nav" ? "nav" : "careerjet";
      const rawUrl = (row as any).raw_url ?? (row as any).source_url;
      const urlForCard =
        leadSource === "nav"
          ? ((row as any).display_url ?? rawUrl ?? null)
          : effectiveCareerjetCardUrl({
              raw_url: rawUrl,
              display_url: (row as any).display_url,
              title: (row as any).title,
              company: (row as any).employer,
              location: (row as any).location,
            });

      // For excluded/needs_review: ikke vis gamle ai_match_highlights som positiv match.
      const isExcludedOrNeeds = v2 && (screeningStatus === "excluded" || screeningStatus === "needs_review");
      const highlights = isExcludedOrNeeds ? null : ((row as any).ai_match_highlights ?? null);

      let screeningReasons: ScreeningReason[] = [];
      const rawReasons = screening?.screening_reasons;
      if (Array.isArray(rawReasons)) {
        screeningReasons = rawReasons.map((r: any) =>
          typeof r === "string" ? { code: r } : (r as ScreeningReason),
        );
      }

      out.push({
        id: `${leadSource}-${isCanonical ? "uo" : "legacy"}-${rowId}`,
        rowKind: leadSource === "nav" ? "nav" : "careerjet",
        rowId,
        cjBackend: isCanonical ? "uo" : "legacy",
        source: leadSource,
        title: (row as any).title,
        company: (row as any).employer,
        location: (row as any).location,
        work_type: null,
        salary: formatSalary(
          (row as any).salary_min,
          (row as any).salary_max,
          (row as any).salary_currency,
          (row as any).salary,
        ),
        posted_at: (row as any).published_at,
        posted_text: null,
        score,
        aiEvaluated: v2,
        url: urlForCard,
        listingId: (row as any).listing_id,
        canonicalOpportunityId: (row as any).canonical_opportunity_id,
        isExpired: (row as any).is_expired === true,
        work_extent: (row as any).work_extent ?? null,
        engagement_type: (row as any).engagement_type ?? null,
        ai_reasoning: (row as any).ai_reasoning ?? null,
        ai_match_highlights: highlights,
        ai_concerns: (row as any).ai_concerns ?? null,
        screeningStatus,
        screeningReasons,
        requirementSummary: (screening?.requirement_summary as RequirementSummary) ?? null,
        matchScoreVersion,
        matchScoredModel: screening?.match_scored_model ?? null,
        screeningEvaluatedAt: screening?.screening_evaluated_at ?? null,
      });
    }
    return out;
  }, [linkedinLeads, cjLeads, screeningUo, screeningUjls]);

  const merged: Lead[] = useMemo(() => {
    const out = rawLeads;

    // Match-filter
    let afterRelevance: Lead[];
    if (relevanceView === "relevant") {
      afterRelevance = out.filter((lead) => {
        if (lead.source === "linkedin") {
          return lead.aiEvaluated && typeof lead.score === "number" && lead.score >= RELEVANT_MIN;
        }
        return (
          isV2EvaluatedRaw(lead.matchScoreVersion ?? null, lead.screeningStatus ?? null) &&
          lead.screeningStatus === "eligible" &&
          typeof lead.score === "number" &&
          lead.score >= RELEVANT_MIN
        );
      });
    } else if (relevanceView === "high") {
      afterRelevance = out.filter((lead) => {
        if (lead.source === "linkedin") {
          return lead.aiEvaluated && typeof lead.score === "number" && lead.score >= HIGH_MATCH_MIN;
        }
        return (
          isV2EvaluatedRaw(lead.matchScoreVersion ?? null, lead.screeningStatus ?? null) &&
          lead.screeningStatus === "eligible" &&
          typeof lead.score === "number" &&
          lead.score >= HIGH_MATCH_MIN
        );
      });
    } else if (relevanceView === "needs_review") {
      afterRelevance = out.filter(
        (lead) =>
          lead.source !== "linkedin" &&
          isV2EvaluatedRaw(lead.matchScoreVersion ?? null, lead.screeningStatus ?? null) &&
          lead.screeningStatus === "needs_review",
      );
    } else if (relevanceView === "unreviewed") {
      afterRelevance = out.filter((lead) => {
        if (lead.source === "linkedin") return !lead.aiEvaluated;
        return !isV2EvaluatedRaw(lead.matchScoreVersion ?? null, lead.screeningStatus ?? null);
      });
    } else {
      // "all" — alle vurderinger, inkluderer excluded
      afterRelevance = out;
    }

    // Excluded skal aldri vises utenfor "all"
    if (relevanceView !== "all") {
      afterRelevance = afterRelevance.filter((lead) => lead.screeningStatus !== "excluded");
    }

    const sourceMatched =
      sourceFilter === "all"
        ? afterRelevance
        : afterRelevance.filter((x) => x.source === sourceFilter);

    const extentMatched =
      extentFilter === "all"
        ? sourceMatched
        : extentFilter === "unspecified"
          ? sourceMatched.filter((x) => x.work_extent == null)
          : sourceMatched.filter((x) => x.work_extent === extentFilter);

    const engagementMatched =
      engagementFilter === "all"
        ? extentMatched
        : engagementFilter === "unspecified"
          ? extentMatched.filter((x) => x.engagement_type == null)
          : extentMatched.filter((x) => x.engagement_type === engagementFilter);

    const cutoffMs = (() => {
      const now = Date.now();
      switch (timeFilter) {
        case "2d": return now - 2 * 24 * 3600 * 1000;
        case "1w": return now - 7 * 24 * 3600 * 1000;
        case "1m": return now - 30 * 24 * 3600 * 1000;
        default: return null;
      }
    })();
    const filtered = cutoffMs == null
      ? engagementMatched
      : engagementMatched.filter((lead) => {
          if (!lead.posted_at) return false;
          const t = new Date(lead.posted_at).getTime();
          return Number.isFinite(t) && t >= cutoffMs;
        });

    const sorted = [...filtered].sort((a, b) => {
      if (!a.aiEvaluated && b.aiEvaluated) return -1;
      if (a.aiEvaluated && !b.aiEvaluated) return 1;
      if (!a.aiEvaluated && !b.aiEvaluated) {
        return new Date(b.posted_at ?? 0).getTime() - new Date(a.posted_at ?? 0).getTime();
      }
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.posted_at ?? 0).getTime() - new Date(a.posted_at ?? 0).getTime();
    });

    return sorted.filter((lead) => !hiddenIds.includes(lead.id));
  }, [rawLeads, sourceFilter, timeFilter, relevanceView, extentFilter, engagementFilter, hiddenIds]);


  // supabase.functions.invoke kaster bort responskroppen ved ikke-2xx. Uten dette
  // ville 503 (manglende konfigurasjon / midlertidig avslått) og 500 (feilet
  // kjøring) sett like ut for brukeren.
  const readInvokeErrorBody = async (error: unknown): Promise<any | null> => {
    const ctx = (error as any)?.context;
    if (!ctx || typeof ctx.text !== "function") return null;
    try {
      const text = await ctx.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  };

  const handleSyncMailbox = async () => {
    if (!user || !emailConnections?.length) return;
    setSyncingMailbox(true);
    try {
      let totalAccepted = 0;
      let totalSkipped = 0;
      for (const conn of emailConnections) {
        const result = await doSyncMailbox({ data: { connectionId: conn.id } });
        totalAccepted += result?.accepted ?? 0;
        totalSkipped += result?.skipped ?? 0;
      }
      toast.success(
        `E-post-synk fullført: ${totalAccepted} nye leads, ${totalSkipped} hoppet over.`,
      );
      qc.invalidateQueries({ queryKey: ["job-leads-linkedin", user.id] });
    } catch (e: any) {
      console.error("[job-leads] mailbox sync failed", e);
      toast.error(e?.message ?? "Synk av e-post feilet");
    } finally {
      setSyncingMailbox(false);
    }
  };

  const handleScorePending = async () => {
    setScoring(true);
    try {
      // score-pending-opportunities støtter nå alle fire kilder.
      const source =
        sourceFilter === "all" || sourceFilter === "other" || sourceFilter === "manual"
          ? "all"
          : sourceFilter;
      const { data: rawData, error } = await supabase.functions.invoke("score-pending-opportunities", {
        body: { source, limit: 20, mode: "stale" },
      });
      const data = (error ? await readInvokeErrorBody(error) : rawData) as any;
      if (error && !data) { toast.error("Score-kall feilet"); return; }
      const status = String(data?.status ?? "");

      const evaluated = Number((data as any)?.evaluated ?? 0);
      const counts = ((data as any)?.status_counts ?? {}) as Record<string, number>;
      const eligible = Number(counts.eligible ?? 0);
      const excluded = Number(counts.excluded ?? 0);
      const needs = Number(counts.needs_review ?? 0);
      const failed = Number((data as any)?.failed ?? 0);
      const parts = [`${evaluated} vurdert`, `${eligible} relevante`, `${excluded} ekskludert`];
      if (needs > 0) parts.push(`${needs} må vurderes`);
      if (failed > 0) parts.push(`${failed} feilet`);
      // Tomt, delvis og feilet er tre ulike utfall — de skal ikke se like ut.
      if (status === "failed" || (error && status !== "partial")) {
        const reason = data?.error === "missing_configuration"
          ? "tjenesten er ikke ferdig konfigurert"
          : data?.error
            ? String(data.error)
            : null;
        toast.error(reason ? `Vurderingen feilet: ${reason}` : "Vurderingen feilet");
      } else if (status === "empty") {

        toast.info("Ingen nye eller utdaterte annonser å vurdere");
      } else if (status === "partial") {
        toast.warning(`Delvis fullført · ${parts.join(" · ")}`);
      } else {
        toast.success(parts.join(" · "));
      }

      qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
      qc.invalidateQueries({ queryKey: ["job-leads-screening-uo"] });
      qc.invalidateQueries({ queryKey: ["job-leads-screening-ujls"] });
    } finally {
      setScoring(false);
    }
  };

  const handleFetch = async () => {
    setFetching(true);
    try {
      const { data: rawData, error } = await supabase.functions.invoke("fetch-careerjet-listings");
      // Ved ikke-2xx (503 = midlertidig avslått) gir invoke error og data = null.
      // Kroppen må hentes ut av error.context for at brukeren skal se årsaken
      // i stedet for en generisk feilmelding.
      const data = (error ? await readInvokeErrorBody(error) : rawData) as any;
      if (data?.disabled) {
        toast.info(
          data?.message ??
            "Careerjet-henting er midlertidig avslått under identity-resolverutrullingen.",
        );
        return;
      }
      if (error) {
        toast.error(data?.error ? `Henting feilet: ${String(data.error)}` : "Henting feilet");
        return;
      }
      if (!data?.ok) {
        toast.warning(data?.message ?? "Ingen treff");
        return;
      }

      if (data?.reason === "no_keywords") {
        toast.warning("Legg inn søkeord i jobbpreferansene dine først.");
        return;
      }
      const matched = Number((data as any).matched ?? (data as any).new_lead_links ?? 0);
      const aiScored = Number((data as any).ai_scored ?? 0);
      const msg = matched
        ? [
            `${matched} nye muligheter fra arkivet (Careerjet + NAV)`,
            aiScored ? `${aiScored} KI-scoret` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Ingen nye treff — alle aktuelle annonser er allerede koblet til deg";
      toast.success(msg);

      qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
      qc.invalidateQueries({ queryKey: ["profile-jobprefs"] });
      qc.invalidateQueries({ queryKey: ["user-opportunities"] });
    } finally {
      setFetching(false);
    }
  };

  /**
   * Én handling for brukeren: hent nye annonser og vurder dem i samme operasjon.
   * Hentingen scorer det den selv henter; vurderingen etterpå fanger opp
   * e-postleads og rader med utdatert vurdering.
   */
  const handleFetchAndScore = async () => {
    await handleFetch();
    await handleScorePending();
  };

  /**
   * Manuell import: frontend kaller kun importManualJobLead. Henting, parsing,
   * dedup og scoring skjer i én backend-operasjon — ingen ekstra «Vurder»-steg.
   */
  const handleManualImport = async (kind: "url" | "text" | "pdf", pdfText?: string) => {
    const url = importUrl.trim();
    const text = (pdfText ?? importText).trim();
    if (kind === "url" && !url) {
      toast.error("Lim inn en URL først");
      return;
    }
    if (kind === "text" && text.length < 80) {
      toast.error("Lim inn hele annonseteksten (minst 80 tegn)");
      return;
    }
    setImporting(kind);
    try {
      const result = await doImportManual({
        data: kind === "url"
          ? { inputKind: "url", jobUrl: url }
          : { inputKind: kind, rawText: text },
      });
      if (result?.scoringCompleted) {
        toast.success(
          result.wasInserted
            ? "Annonsen er lagt til og vurdert"
            : "Annonsen fantes fra før — vurderingen er oppdatert",
          result.score != null
            ? { description: `Matchscore: ${result.score}` }
            : undefined,
        );
        if (kind === "url") setImportUrl("");
        else setImportText("");
      } else {
        toast.warning(
          "Annonsen er lagret, men vurderingen er ikke klar ennå. Den fullføres ved neste «Hent og vurder nye annonser».",
        );
      }
      qc.invalidateQueries({ queryKey: ["job-leads-linkedin"] });
    } catch (e: any) {
      console.error("[job-leads] manual import failed", e);
      toast.error(e?.message ?? "Kunne ikke legge til annonsen");
    } finally {
      setImporting(null);
    }
  };

  const handlePdfImport = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("PDF-filen er for stor (maks 10 MB)");
      return;
    }
    setPdfLoading(true);
    try {
      const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
      const workerMod: any = await import("pdfjs-dist/build/pdf.worker.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
      const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      let text = "";
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(" ") + "\n\n";
      }
      const extractedText = text.trim();
      if (extractedText.length < 80) {
        throw new Error("Fant ikke nok lesbar tekst i PDF-filen");
      }
      setImportText(extractedText);
      await handleManualImport("pdf", extractedText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke lese PDF-filen");
    } finally {
      setPdfLoading(false);
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
      await supabase.rpc("register_lead", {
        p_user_id: user.id,
        p_source: lead.source,
        p_priority: lead.source === "linkedin" ? 2 : 1,
        p_dedupe_key: keyData as unknown as string,
        p_ref_table:
          lead.rowKind === "linkedin" || lead.rowKind === "finn" ||
              lead.rowKind === "other" || lead.rowKind === "manual"
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
      lead.source === "linkedin" ? "LinkedIn" :
      lead.source === "nav" ? "NAV" :
      lead.source === "careerjet" ? "Careerjet" :
      lead.source === "finn" ? "Finn.no" :
      lead.source === "manual" ? "Manuelt lagt inn" :
      "Jobb-e-post";
    // Prioritet: bruk lead.score som allerede er nullstilt ut for ikke-V2 NAV/Careerjet.
    const priority = (lead.score ?? 0) >= 70 ? "høy" : "middels";
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
        priority,
        ai_score: lead.score ?? null,
        ai_reasoning: lead.ai_reasoning ?? null,
        ai_match_highlights: lead.ai_match_highlights ?? null,
        ai_concerns: lead.ai_concerns ?? null,
        salary_text: lead.salary ?? null,
        posted_text: lead.posted_text ?? null,
        application_due: lead.applicationDue ?? null,
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

    // Dedupe-merket er ren opprydding — det skal aldri forsinke brukerens handling.
    void tombstoneDedupe(lead, "promoted");


    if (
      lead.rowKind === "linkedin" || lead.rowKind === "finn" ||
      lead.rowKind === "other" || lead.rowKind === "manual"
    ) {
      await supabase.from("job_leads").delete().eq("id", lead.rowId);
      qc.invalidateQueries({ queryKey: ["job-leads-linkedin"] });
      qc.invalidateQueries({ queryKey: ["job-leads"] });
    } else if (lead.source === "nav") {
      await (supabase.from("user_opportunities") as any)
        .update({ status: "applied", updated_at: new Date().toISOString() })
        .eq("id", lead.rowId);
      qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
    } else {
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
    // Raden forsvinner straks. Feiler skrivingen, legges den tilbake.
    const hide = () => setHiddenIds((ids) => [...ids, lead.id]);
    const unhide = () => setHiddenIds((ids) => ids.filter((x) => x !== lead.id));
    setPendingId(lead.id);
    hide();
    try {
      if (action === "save" || action === "apply") {
        const id = await promoteToApplication(lead);
        if (!id) {
          unhide();
          return;
        }
        if (action === "apply") {
          navigate({ to: "/cover-letters", search: { application: id } as any });
          return;
        }
        toast.success(`Flyttet til Søknader: ${lead.title ?? "stillingen"}`, {
          description: "Du finner den under Søknader med status «identifisert».",
          action: {
            label: "Åpne søknaden",
            onClick: () => navigate({ to: "/applications/$id", params: { id } }),
          },
        });
        return;
      }

      // dismiss
      void tombstoneDedupe(lead, "dismissed");
      let error: unknown = null;
      if (lead.source === "nav" || (lead.rowKind === "careerjet" && lead.cjBackend === "uo")) {
        ({ error } = await (supabase.from("user_opportunities") as any)
          .update({ status: "dismissed", updated_at: new Date().toISOString() })
          .eq("id", lead.rowId));
        qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
      } else if (lead.rowKind === "careerjet") {
        ({ error } = await (supabase.from("user_job_listing_status") as any)
          .update({ status: "dismissed", updated_at: new Date().toISOString() })
          .eq("id", lead.rowId));
        qc.invalidateQueries({ queryKey: ["job-leads-careerjet"] });
      } else {
        ({ error } = await (supabase.from("job_leads") as any)
          .update({ status: "avvist", updated_at: new Date().toISOString() })
          .eq("id", lead.rowId));
        qc.invalidateQueries({ queryKey: ["job-leads-linkedin"] });
      }
      if (error) {
        unhide();
        toast.error(`Kunne ikke avvise annonsen: ${(error as any)?.message ?? "ukjent feil"}`);
        return;
      }
      toast.success("Avvist — du får den ikke opp igjen.");
    } finally {
      setPendingId((current) => (current === lead.id ? null : current));
    }
  };



  const hasPrefs =
    !!profile?.job_search_keywords?.trim() ||
    (Array.isArray(profile?.preferred_locations) && profile.preferred_locations.length > 0) ||
    !!profile?.target_city?.trim() ||
    !!profile?.target_region?.trim() ||
    !!profile?.target_country?.trim() ||
    !!profile?.target_role?.trim() ||
    (Array.isArray(profile?.target_roles) && profile.target_roles.length > 0);

  const isLoading = loadingLI || loadingCJ;
  const totalRawRows = (linkedinLeads?.length ?? 0) + (cjLeads?.length ?? 0);
  const hasAnyRows = totalRawRows > 0;
  const filteredAway = hasAnyRows && merged.length === 0;

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
              : "Jobb-e-post fra Gmail/Outlook/videresending · Careerjet + NAV hentes manuelt"}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            onClick={handleSyncMailbox}
            disabled={syncingMailbox || !emailConnections?.length}
            variant="outline"
            title={!emailConnections?.length ? "Ingen aktiv e-posttilkobling" : undefined}
          >
            <Mail className={`h-4 w-4 mr-2 ${syncingMailbox ? "animate-spin" : ""}`} />
            {syncingMailbox ? "Synker e-post…" : "Synk e-post"}
          </Button>
          <Button onClick={handleFetchAndScore} disabled={fetching || scoring || !hasPrefs}>
            <RefreshCw className={`h-4 w-4 mr-2 ${fetching || scoring ? "animate-spin" : ""}`} />
            {fetching ? "Henter…" : scoring ? "Vurderer…" : "Hent og vurder nye annonser"}
          </Button>

        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium">Legg til annonse selv</div>
          <p className="text-xs text-muted-foreground">
            Lim inn en lenke til en stillingsannonse (Finn, LinkedIn eller en
            bedriftsside), last opp PDF eller lim inn hele annonseteksten.
            Annonsen tolkes, lagres og vurderes mot profilen din i én operasjon.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://www.finn.no/job/…"
              disabled={importing !== null}
              type="url"
            />
            <Button
              variant="outline"
              className="shrink-0"
              disabled={importing !== null || !importUrl.trim()}
              onClick={() => handleManualImport("url")}
            >
              <Link2 className={`h-4 w-4 mr-2 ${importing === "url" ? "animate-spin" : ""}`} />
              {importing === "url" ? "Henter og vurderer…" : "Hent fra URL"}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
            <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
              <Upload className={`mr-2 h-4 w-4 ${pdfLoading || importing === "pdf" ? "animate-pulse" : ""}`} />
              {pdfLoading ? "Leser PDF…" : importing === "pdf" ? "Tolker og vurderer…" : "Last opp PDF"}
              <input
                className="sr-only"
                type="file"
                accept="application/pdf,.pdf"
                disabled={importing !== null || pdfLoading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handlePdfImport(file);
                }}
              />
            </label>
            <span className="text-xs text-muted-foreground">Maks 10 MB</span>
          </div>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="…eller lim inn hele annonseteksten her"
            rows={3}
            disabled={importing !== null}
          />
          {importText.trim().length > 0 && (
            <Button
              variant="outline"
              disabled={importing !== null || importText.trim().length < 80}
              onClick={() => handleManualImport("text")}
            >
              <FileText className={`h-4 w-4 mr-2 ${importing === "text" ? "animate-spin" : ""}`} />
              {importing === "text" ? "Tolker og vurderer…" : "Legg til fra tekst"}
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        <Select value={sourceFilter} onValueChange={(v: any) => setSourceFilter(v)}>
          <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kilder</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="careerjet">Careerjet</SelectItem>
            <SelectItem value="nav">NAV</SelectItem>
            <SelectItem value="finn">Finn.no</SelectItem>
            <SelectItem value="manual">Manuelt lagt inn</SelectItem>
            <SelectItem value="other">Annen e-post</SelectItem>
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
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Match-vurdering" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevant">Relevante (≥40)</SelectItem>
            <SelectItem value="high">Høy match (≥70)</SelectItem>
            <SelectItem value="needs_review">Må vurderes</SelectItem>
            <SelectItem value="unreviewed">Uvurderte / utdaterte</SelectItem>
            <SelectItem value="all">Alle vurderinger</SelectItem>
          </SelectContent>
        </Select>
        <Select value={timeFilter} onValueChange={(v: any) => setTimeFilter(v)}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Tidsavgrensning" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle tider</SelectItem>
            <SelectItem value="2d">Siste 2 dager</SelectItem>
            <SelectItem value="1w">Siste uke</SelectItem>
            <SelectItem value="1m">Siste måned</SelectItem>
          </SelectContent>
        </Select>
        <Select value={extentFilter} onValueChange={(v: any) => setExtentFilter(v)}>
          <SelectTrigger className="w-full sm:w-36"><SelectValue placeholder="Stillingsomfang" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle omfang</SelectItem>
            <SelectItem value="full_time">Heltid</SelectItem>
            <SelectItem value="part_time">Deltid</SelectItem>
            <SelectItem value="unspecified">Uspesifisert</SelectItem>
          </SelectContent>
        </Select>
        <Select value={engagementFilter} onValueChange={(v: any) => setEngagementFilter(v)}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Ansettelse" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle ansettelser</SelectItem>
            <SelectItem value="permanent">Fast</SelectItem>
            <SelectItem value="temporary">Vikariat</SelectItem>
            <SelectItem value="project">Prosjekt</SelectItem>
            <SelectItem value="interim">Interim</SelectItem>
            <SelectItem value="unspecified">Uspesifisert</SelectItem>
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
      ) : !hasAnyRows ? (
        <EmptyState
          title="Ingen annonser ennå"
          description={
            hasPrefs
              ? "Trykk «Hent fra Careerjet + NAV» eller synkroniser e-post for LinkedIn-jobbvarsler."
              : "Sett opp søkeord og byer i profilen din først."
          }
        />
      ) : filteredAway ? (
        <EmptyState
          title="Ingen treff i valgt filter"
          description="Ingen relevante treff etter kvalifikasjons- og lokasjonskontroll."
          action={
            <Button variant="outline" onClick={() => setRelevanceView("all")}>
              Vis alle vurderinger
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {merged.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              busy={pendingId === lead.id}
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

function EvidenceBasisNotice({ summary }: { summary: RequirementSummary }) {
  if (!hasEmptyEvidenceBasis(summary)) return null;
  return (
    <div className="text-xs mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-900 dark:text-amber-100">
      Ingen karrieredata lastet opp ennå. Vurderingen er gjort uten evidensgrunnlag —
      poengsummen sier derfor ikke noe om hvor godt du passer.
    </div>
  );
}

function RequirementSummarySection({ summary }: { summary: RequirementSummary }) {
  const items = Array.isArray(summary?.requirements) ? summary!.requirements! : [];
  if (items.length === 0) return <EvidenceBasisNotice summary={summary} />;

  const groups: Array<{ key: "mandatory" | "preferred" | "context"; title: string; items: RequirementItem[] }> = [
    { key: "mandatory", title: "Obligatoriske krav", items: items.filter((r) => r.level === "mandatory") },
    { key: "preferred", title: "Ønskede kvalifikasjoner", items: items.filter((r) => r.level === "preferred") },
    { key: "context", title: "Annen kontekst", items: items.filter((r) => r.level === "context") },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0) return <EvidenceBasisNotice summary={summary} />;

  return (
    <div className="text-xs border-t border-border/60 pt-2 mt-2 space-y-2">
      <EvidenceBasisNotice summary={summary} />
      {groups.map((g) => (
        <div key={g.key} className="space-y-1">
          <div className="font-medium text-foreground/90">{g.title}</div>
          <ul className="space-y-1">
            {g.items.map((req, idx) => {
              const evidenceCount = Array.isArray(req.matched_evidence_refs)
                ? req.matched_evidence_refs.length
                : 0;
              let statusLabel = "Må verifiseres";
              let statusCls = "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100";
              if (req.met === true && evidenceCount > 0) {
                statusLabel = "Dokumentert";
                statusCls = "bg-emerald-500/15 text-emerald-900 dark:text-emerald-100 border border-emerald-500/30";
              } else if (req.met === false) {
                statusLabel = "Ikke dokumentert";
                statusCls = "bg-amber-500/15 text-amber-900 dark:text-amber-100 border border-amber-500/30";
              }
              return (
                <li key={`${g.key}-${idx}`} className="flex items-start gap-2">
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${statusCls}`}>{statusLabel}</span>
                  <span className="text-foreground/85">{req.label ?? "—"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ScreeningReasonsBlock({ lead }: { lead: Lead }) {
  if (lead.source === "linkedin") return null;
  if (lead.screeningStatus !== "excluded" && lead.screeningStatus !== "needs_review") return null;
  const reasons = Array.isArray(lead.screeningReasons) ? lead.screeningReasons : [];
  if (reasons.length === 0) return null;
  const title = lead.screeningStatus === "excluded" ? "Ekskludert fordi" : "Må avklares";
  return (
    <div className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 p-2 space-y-1">
      <div className="font-medium">{title}</div>
      <ul className="list-disc pl-4 space-y-0.5">
        {reasons.map((r, i) => (
          <li key={i}>
            {reasonLabelNb(r)}
            {r.detail ? <span className="text-amber-900/80 dark:text-amber-100/80"> — {r.detail}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LeadCard({
  lead, busy, onSave, onDismiss, onApply,
}: {
  lead: Lead;
  busy?: boolean;
  onSave: () => void;
  onDismiss: () => void;
  onApply: () => void;
}) {

  const [open, setOpen] = useState(false);
  const badge = leadBadge(lead);
  const isLI = lead.source === "linkedin";
  const isNav = lead.source === "nav";
  const sourceLabel =
    lead.source === "linkedin" ? "LinkedIn" :
    lead.source === "nav" ? "NAV" :
    lead.source === "careerjet" ? "Careerjet" :
    lead.source === "finn" ? "Finn.no" :
    lead.source === "manual" ? "Lagt inn manuelt" :
    "E-post";
  // Careerjet-rader har ingen stabil annonselenke — de får et søkeoppslag.
  // Alle job_leads- og NAV-rader bruker sin egen URL.
  const actionUrl = lead.rowKind === "careerjet" ? buildCareerjetSearchUrl(lead) : lead.url;
  const hasDetails =
    !!(lead.ai_reasoning || lead.ai_match_highlights || lead.ai_concerns || lead.raw_snippet);
  const showPositiveHighlight =
    !!lead.ai_match_highlights &&
    !(lead.source !== "linkedin" &&
      (lead.screeningStatus === "excluded" || lead.screeningStatus === "needs_review"));

  const cardInner = (
    <div className="flex-1 min-w-0 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-semibold">{lead.title ?? "Ukjent rolle"}</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>
          {badge.label}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {sourceLabel}
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

      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{lead.posted_text ?? (lead.posted_at ? fmtRelative(lead.posted_at) : "—")}</span>
        {lead.applicationDue && (
          <span className="flex items-center gap-1 font-medium text-foreground/80">
            <CalendarClock className="h-3 w-3" />Søknadsfrist: {fmtDate(lead.applicationDue)}
          </span>
        )}
      </div>

      {showPositiveHighlight && (
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

        <ScreeningReasonsBlock lead={lead} />
        <RequirementSummarySection summary={lead.requirementSummary ?? null} />
        {isLegacyScoreVersion(lead.matchScoreVersion) && (
          <div className="text-[11px] text-muted-foreground mt-1">
            Vurdert mot et eldre evidensgrunnlag ({lead.matchScoreVersion}). Kjør ny
            vurdering for å score mot bekreftede karriereatomer.
          </div>
        )}

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
                {lead.rowKind === "careerjet" ? "Finn i Careerjet" : isNav ? "Finn hos NAV" : "Se annonse"}
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            disabled={busy}
            onClick={onSave}
            title="Flytter annonsen til Søknader med status «identifisert», slik at du kan jobbe videre med den senere."
          >
            <Bookmark className="h-4 w-4 mr-1" /> Flytt til søknader
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            disabled={busy}
            onClick={onDismiss}
            title="Skjuler annonsen for deg og hindrer at den dukker opp igjen."
          >
            <X className="h-4 w-4 mr-1" /> Avvis
          </Button>
          <StartApplicationButton canonicalOpportunityId={lead.canonicalOpportunityId} />

          <Button
            variant="default"
            size="sm"
            className="h-9 ml-auto"
            disabled={busy}
            onClick={onApply}
            title="Oppretter søknaden og tar deg rett til søknadsteksten."
          >
            <Send className="h-4 w-4 mr-1" /> Skriv søknad
          </Button>

        </div>

        {hasDetails && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs h-7 px-2">
                <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />
                {open ? "Skjul vurdering og detaljer" : "Vis vurdering og detaljer"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2 text-xs">
              {lead.ai_reasoning && (
                <div>
                  <div className="font-medium text-foreground mb-0.5">Matchvurdering</div>
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
